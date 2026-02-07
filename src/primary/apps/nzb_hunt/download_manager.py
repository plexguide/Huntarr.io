"""
NZB Hunt Download Manager - Orchestrates NZB downloading.

Manages a download queue backed by the database, coordinates NNTP article
downloads across configured servers using parallel connections, and assembles
files.  Supports speed limiting, per-server bandwidth tracking, and rolling
speed calculation.

This is the main integration point for Movie Hunt → NZB Hunt.
"""

import os
import json
import time
import uuid
import shutil
import threading
from collections import deque
from concurrent.futures import ThreadPoolExecutor, as_completed
import requests
from typing import Optional, List, Dict, Any, Tuple
from datetime import datetime, timezone

from src.primary.utils.logger import get_logger
from src.primary.apps.nzb_hunt.nzb_parser import parse_nzb, NZB
from src.primary.apps.nzb_hunt.yenc_decoder import decode_yenc
from src.primary.apps.nzb_hunt.nntp_client import NNTPManager

logger = get_logger("nzb_hunt.manager")


class _RateLimiter:
    """Thread-safe token-bucket rate limiter for download speed control."""
    
    def __init__(self):
        self._lock = threading.Lock()
        self._tokens = 0.0
        self._last_refill = time.time()
        self._rate = 0  # bytes per second, 0 = unlimited
    
    def set_rate(self, bps: int):
        with self._lock:
            self._rate = max(0, bps)
            # Give a burst allowance of 1 second
            self._tokens = min(self._tokens, float(self._rate))
    
    @property
    def rate(self) -> int:
        return self._rate
    
    def consume(self, nbytes: int):
        """Block until nbytes of bandwidth are available."""
        if self._rate <= 0:
            return  # Unlimited
        
        while True:
            with self._lock:
                # Re-check rate inside lock (may have changed to unlimited)
                if self._rate <= 0:
                    return
                
                now = time.time()
                elapsed = now - self._last_refill
                self._last_refill = now
                # Refill tokens based on elapsed time
                self._tokens += self._rate * elapsed
                # Cap burst to 2 seconds of bandwidth
                self._tokens = min(self._tokens, float(self._rate * 2))
                
                if self._tokens >= nbytes:
                    self._tokens -= nbytes
                    return
                
                # Calculate how long to wait for enough tokens
                deficit = nbytes - self._tokens
                current_rate = self._rate
            
            # Sleep outside the lock, in small increments
            if current_rate > 0:
                time.sleep(min(deficit / current_rate, 0.05))
            else:
                return  # Rate became unlimited


# Download states
STATE_QUEUED = "queued"
STATE_DOWNLOADING = "downloading"
STATE_PAUSED = "paused"
STATE_COMPLETED = "completed"
STATE_FAILED = "failed"
STATE_EXTRACTING = "extracting"


class DownloadItem:
    """Represents a single NZB download in the queue."""
    
    def __init__(self, nzb_id: str, name: str, category: str = "",
                 nzb_content: str = "", nzb_url: str = "",
                 priority: str = "normal", added_by: str = ""):
        self.id = nzb_id
        self.name = name
        self.category = category
        self.nzb_content = nzb_content
        self.nzb_url = nzb_url
        self.priority = priority
        self.added_by = added_by  # "movie_hunt", "manual", etc.
        self.state = STATE_QUEUED
        self.added_at = datetime.now(timezone.utc).isoformat()
        self.started_at = None
        self.completed_at = None
        self.error_message = ""
        
        # Progress tracking
        self.total_bytes = 0
        self.downloaded_bytes = 0
        self.total_segments = 0
        self.completed_segments = 0
        self.total_files = 0
        self.completed_files = 0
        self.speed_bps = 0  # bytes per second
        self.eta_seconds = 0
    
    @property
    def progress_pct(self) -> float:
        if self.total_segments == 0:
            return 0.0
        return min(100.0, (self.completed_segments / self.total_segments) * 100)
    
    @property
    def time_left_str(self) -> str:
        if self.eta_seconds <= 0:
            return ""
        mins, secs = divmod(int(self.eta_seconds), 60)
        hours, mins = divmod(mins, 60)
        if hours > 0:
            return f"{hours}h {mins}m"
        if mins > 0:
            return f"{mins}m {secs}s"
        return f"{secs}s"
    
    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "category": self.category,
            "priority": self.priority,
            "added_by": self.added_by,
            "state": self.state,
            "added_at": self.added_at,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
            "error_message": self.error_message,
            "total_bytes": self.total_bytes,
            "downloaded_bytes": self.downloaded_bytes,
            "total_segments": self.total_segments,
            "completed_segments": self.completed_segments,
            "total_files": self.total_files,
            "completed_files": self.completed_files,
            "progress_pct": round(self.progress_pct, 1),
            "speed_bps": self.speed_bps,
            "eta_seconds": self.eta_seconds,
            "time_left": self.time_left_str,
        }
    
    @classmethod
    def from_dict(cls, d: dict) -> 'DownloadItem':
        item = cls(
            nzb_id=d.get("id", str(uuid.uuid4())),
            name=d.get("name", "Unknown"),
            category=d.get("category", ""),
            nzb_content=d.get("nzb_content", ""),
            nzb_url=d.get("nzb_url", ""),
            priority=d.get("priority", "normal"),
            added_by=d.get("added_by", ""),
        )
        item.state = d.get("state", STATE_QUEUED)
        item.added_at = d.get("added_at", item.added_at)
        item.started_at = d.get("started_at")
        item.completed_at = d.get("completed_at")
        item.error_message = d.get("error_message", "")
        item.total_bytes = d.get("total_bytes", 0)
        item.downloaded_bytes = d.get("downloaded_bytes", 0)
        item.total_segments = d.get("total_segments", 0)
        item.completed_segments = d.get("completed_segments", 0)
        item.total_files = d.get("total_files", 0)
        item.completed_files = d.get("completed_files", 0)
        item.speed_bps = d.get("speed_bps", 0)
        item.eta_seconds = d.get("eta_seconds", 0)
        return item


class NZBHuntDownloadManager:
    """Manages the NZB Hunt download queue and worker threads."""
    
    _instance = None
    _lock = threading.Lock()
    
    @classmethod
    def get_instance(cls) -> 'NZBHuntDownloadManager':
        """Get the singleton instance."""
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance
    
    def __init__(self):
        self._queue: List[DownloadItem] = []
        self._history: List[DownloadItem] = []
        self._queue_lock = threading.Lock()
        self._nntp = NNTPManager()
        self._worker_thread: Optional[threading.Thread] = None
        self._running = False
        self._paused_global = False
        self._config_dir = self._detect_config_dir()
        
        # Speed tracking – rolling window
        self._speed_lock = threading.Lock()
        self._speed_samples: deque = deque()
        self._speed_window = 3.0  # seconds
        
        # Rate limiter (token-bucket, thread-safe)
        self._rate_limiter = _RateLimiter()
        
        self._load_state()
        self._load_speed_limit()
        
        # Auto-start worker if there are queued items (e.g., after restart)
        self._ensure_worker_running()
    
    def _detect_config_dir(self) -> str:
        """Detect config directory."""
        if os.path.isdir("/config"):
            return "/config"
        base = os.path.dirname(os.path.dirname(os.path.dirname(
            os.path.dirname(os.path.abspath(__file__)))))
        data_dir = os.path.join(base, "data")
        os.makedirs(data_dir, exist_ok=True)
        return data_dir
    
    def _state_path(self) -> str:
        return os.path.join(self._config_dir, "nzb_hunt_queue.json")
    
    def _load_state(self):
        """Load queue state from disk."""
        path = self._state_path()
        if not os.path.exists(path):
            return
        try:
            with open(path, "r") as f:
                data = json.load(f)
            self._queue = [DownloadItem.from_dict(d) for d in data.get("queue", [])]
            self._history = [DownloadItem.from_dict(d) for d in data.get("history", [])]
            # Reset any items that were downloading when we crashed
            for item in self._queue:
                if item.state == STATE_DOWNLOADING:
                    item.state = STATE_QUEUED
            logger.info(f"Loaded NZB Hunt state: {len(self._queue)} queued, {len(self._history)} history")
        except Exception as e:
            logger.error(f"Failed to load NZB Hunt state: {e}")
    
    def _save_state(self):
        """Persist queue state to disk."""
        try:
            data = {
                "queue": [item.to_dict() for item in self._queue],
                "history": [item.to_dict() for item in self._history[-100:]],  # Keep last 100
            }
            # Add NZB content separately (not in to_dict to keep API responses clean)
            for i, item in enumerate(self._queue):
                data["queue"][i]["nzb_content"] = item.nzb_content
                data["queue"][i]["nzb_url"] = item.nzb_url
            
            path = self._state_path()
            with open(path, "w") as f:
                json.dump(data, f, indent=2)
        except Exception as e:
            logger.error(f"Failed to save NZB Hunt state: {e}")
    
    def _get_folders(self) -> dict:
        """Get configured folder settings."""
        try:
            config_path = os.path.join(self._config_dir, "nzb_hunt_config.json")
            if os.path.exists(config_path):
                with open(config_path, "r") as f:
                    cfg = json.load(f)
                return cfg.get("folders", {})
        except Exception:
            pass
        return {
            "download_folder": "/downloads",
            "temp_folder": "/downloads/incomplete",
        }
    
    def _get_servers(self) -> List[dict]:
        """Get configured NNTP servers."""
        try:
            config_path = os.path.join(self._config_dir, "nzb_hunt_config.json")
            if os.path.exists(config_path):
                with open(config_path, "r") as f:
                    cfg = json.load(f)
                return cfg.get("servers", [])
        except Exception:
            pass
        return []
    
    def _get_category_folder(self, category: str) -> Optional[str]:
        """Get the download folder for a specific category."""
        try:
            config_path = os.path.join(self._config_dir, "nzb_hunt_config.json")
            if os.path.exists(config_path):
                with open(config_path, "r") as f:
                    cfg = json.load(f)
                categories = cfg.get("categories", [])
                for cat in categories:
                    if cat.get("name", "").lower() == category.lower():
                        return cat.get("folder", "")
        except Exception:
            pass
        return None
    
    # ── Speed Limit ──────────────────────────────────────────────
    
    def _load_speed_limit(self):
        """Load speed limit from config on startup."""
        try:
            config_path = os.path.join(self._config_dir, "nzb_hunt_config.json")
            if os.path.exists(config_path):
                with open(config_path, "r") as f:
                    cfg = json.load(f)
                limit = cfg.get("speed_limit_bps", 0)
                self._rate_limiter.set_rate(limit)
        except Exception:
            pass
    
    def set_speed_limit(self, bps: int):
        """Set download speed limit in bytes/sec.  0 = unlimited."""
        bps = max(0, bps)
        self._rate_limiter.set_rate(bps)
        # Persist to config
        try:
            config_path = os.path.join(self._config_dir, "nzb_hunt_config.json")
            cfg = {}
            if os.path.exists(config_path):
                with open(config_path, "r") as f:
                    cfg = json.load(f)
            cfg["speed_limit_bps"] = bps
            with open(config_path, "w") as f:
                json.dump(cfg, f, indent=2)
        except Exception as e:
            logger.error(f"Failed to save speed limit: {e}")
    
    def get_speed_limit(self) -> int:
        """Get current speed limit in bytes/sec (0 = unlimited)."""
        return self._rate_limiter.rate
    
    # ── Rolling Speed ─────────────────────────────────────────────
    
    def _record_speed(self, nbytes: int):
        """Record a downloaded chunk for rolling speed calculation."""
        now = time.time()
        with self._speed_lock:
            self._speed_samples.append((now, nbytes))
            # Prune old samples
            cutoff = now - self._speed_window
            while self._speed_samples and self._speed_samples[0][0] < cutoff:
                self._speed_samples.popleft()
    
    def _get_rolling_speed(self) -> int:
        """Return current speed in bytes/sec from rolling window."""
        now = time.time()
        with self._speed_lock:
            cutoff = now - self._speed_window
            while self._speed_samples and self._speed_samples[0][0] < cutoff:
                self._speed_samples.popleft()
            if not self._speed_samples:
                return 0
            total = sum(b for _, b in self._speed_samples)
            oldest = self._speed_samples[0][0]
            elapsed = now - oldest
            if elapsed <= 0:
                return total  # All samples in same instant
            return int(total / elapsed)
    
    def configure_servers(self):
        """Load server configs and configure the NNTP manager."""
        servers = self._get_servers()
        self._nntp.configure(servers)
    
    def has_servers(self) -> bool:
        """Check if NNTP servers are configured."""
        return len(self._get_servers()) > 0
    
    def test_servers(self) -> List[Tuple[str, bool, str]]:
        """Test all configured server connections."""
        self.configure_servers()
        return self._nntp.test_servers()
    
    # ── Queue Management ──────────────────────────────────────────
    
    def add_nzb(self, nzb_url: str = "", nzb_content: str = "",
                name: str = "", category: str = "",
                priority: str = "normal", added_by: str = "") -> Tuple[bool, str, str]:
        """Add an NZB to the download queue.
        
        Args:
            nzb_url: URL to download NZB from
            nzb_content: NZB XML content (if already have it)
            name: Display name for the download
            category: Category for organization
            priority: Priority level
            added_by: Who added it (e.g., "movie_hunt")
            
        Returns:
            Tuple of (success, message, queue_id)
        """
        nzb_id = str(uuid.uuid4())[:8]
        
        # If we have a URL but no content, download the NZB file
        if nzb_url and not nzb_content:
            try:
                from src.primary.settings_manager import get_ssl_verify_setting
                verify_ssl = get_ssl_verify_setting()
                r = requests.get(nzb_url, timeout=30, verify=verify_ssl)
                r.raise_for_status()
                nzb_content = r.text
                if not name:
                    # Try to extract name from URL
                    name = nzb_url.split("/")[-1].split("?")[0]
                    if name.endswith(".nzb"):
                        name = name[:-4]
            except Exception as e:
                logger.error(f"Failed to download NZB from {nzb_url}: {e}")
                return False, f"Failed to download NZB: {e}", ""
        
        if not nzb_content:
            return False, "No NZB content provided", ""
        
        # Parse NZB to validate and get metadata
        try:
            nzb = parse_nzb(nzb_content)
            if not nzb.files:
                return False, "NZB contains no files", ""
        except Exception as e:
            return False, f"Invalid NZB: {e}", ""
        
        if not name:
            name = nzb.files[0].filename if nzb.files else "Unknown"
        
        item = DownloadItem(
            nzb_id=nzb_id,
            name=name,
            category=category,
            nzb_content=nzb_content,
            nzb_url=nzb_url,
            priority=priority,
            added_by=added_by,
        )
        item.total_bytes = nzb.total_bytes
        item.total_segments = nzb.total_segments
        item.total_files = len(nzb.files)
        
        with self._queue_lock:
            self._queue.append(item)
            self._save_state()
        
        logger.info(f"Added NZB to queue: {name} ({nzb_id}) - {len(nzb.files)} files, "
                     f"{nzb.total_segments} segments, {nzb.total_bytes} bytes")
        
        # Start worker if not running
        self._ensure_worker_running()
        
        return True, f"Added to NZB Hunt queue", nzb_id
    
    def get_queue(self) -> List[dict]:
        """Get current download queue."""
        with self._queue_lock:
            return [item.to_dict() for item in self._queue]
    
    def get_history(self, limit: int = 50) -> List[dict]:
        """Get download history."""
        with self._queue_lock:
            return [item.to_dict() for item in self._history[-limit:]]
    
    def get_item(self, nzb_id: str) -> Optional[dict]:
        """Get a specific queue item by ID."""
        with self._queue_lock:
            for item in self._queue:
                if item.id == nzb_id:
                    return item.to_dict()
            for item in self._history:
                if item.id == nzb_id:
                    return item.to_dict()
        return None
    
    def pause_item(self, nzb_id: str) -> bool:
        """Pause a queued/downloading item."""
        with self._queue_lock:
            for item in self._queue:
                if item.id == nzb_id and item.state in (STATE_QUEUED, STATE_DOWNLOADING):
                    item.state = STATE_PAUSED
                    self._save_state()
                    return True
        return False
    
    def resume_item(self, nzb_id: str) -> bool:
        """Resume a paused item."""
        with self._queue_lock:
            for item in self._queue:
                if item.id == nzb_id and item.state == STATE_PAUSED:
                    item.state = STATE_QUEUED
                    self._save_state()
                    self._ensure_worker_running()
                    return True
        return False
    
    def remove_item(self, nzb_id: str) -> bool:
        """Remove an item from the queue."""
        with self._queue_lock:
            for i, item in enumerate(self._queue):
                if item.id == nzb_id:
                    self._queue.pop(i)
                    self._save_state()
                    return True
        return False
    
    def clear_history(self):
        """Clear download history."""
        with self._queue_lock:
            self._history.clear()
            self._save_state()
    
    def pause_all(self):
        """Pause all active and queued downloads."""
        self._paused_global = True
        with self._queue_lock:
            for item in self._queue:
                if item.state in (STATE_QUEUED, STATE_DOWNLOADING):
                    item.state = STATE_PAUSED
            self._save_state()
    
    def resume_all(self):
        """Resume all paused downloads."""
        self._paused_global = False
        with self._queue_lock:
            for item in self._queue:
                if item.state == STATE_PAUSED:
                    item.state = STATE_QUEUED
            self._save_state()
        self._ensure_worker_running()
    
    def get_status(self) -> dict:
        """Get overall download status."""
        with self._queue_lock:
            active = [i for i in self._queue if i.state == STATE_DOWNLOADING]
            queued = [i for i in self._queue if i.state == STATE_QUEUED]
            paused = [i for i in self._queue if i.state == STATE_PAUSED]
        
        # Use rolling speed instead of summing item speeds
        total_speed = self._get_rolling_speed()
        
        # Calculate remaining bytes and ETA
        total_remaining = 0
        with self._queue_lock:
            for i in self._queue:
                if i.state in (STATE_DOWNLOADING, STATE_QUEUED):
                    total_remaining += max(0, i.total_bytes - i.downloaded_bytes)
        
        eta_seconds = int(total_remaining / total_speed) if total_speed > 0 else 0
        
        # Free disk space
        free_space = 0
        free_space_human = "--"
        try:
            folders = self._get_folders()
            dl_folder = folders.get("download_folder", "/downloads")
            if os.path.isdir(dl_folder):
                usage = shutil.disk_usage(dl_folder)
                free_space = usage.free
                free_space_human = _format_bytes(free_space)
        except Exception:
            pass
        
        # Per-server bandwidth
        bandwidth_stats = self._nntp.get_bandwidth_stats()
        
        return {
            "active_count": len(active),
            "queued_count": len(queued),
            "paused_count": len(paused),
            "total_count": len(self._queue),
            "history_count": len(self._history),
            "speed_bps": total_speed,
            "speed_human": _format_speed(total_speed),
            "remaining_bytes": total_remaining,
            "remaining_human": _format_bytes(total_remaining),
            "eta_seconds": eta_seconds,
            "eta_human": _format_eta(eta_seconds),
            "free_space": free_space,
            "free_space_human": free_space_human,
            "speed_limit_bps": self.get_speed_limit(),
            "speed_limit_human": _format_speed(self.get_speed_limit()) if self.get_speed_limit() > 0 else "Unlimited",
            "paused_global": self._paused_global,
            "bandwidth_by_server": bandwidth_stats,
            "servers_configured": self.has_servers(),
            "worker_running": self._running,
        }
    
    # ── Worker Thread ─────────────────────────────────────────────
    
    def _ensure_worker_running(self):
        """Start the worker thread if it's not running."""
        if self._running:
            return
        if not self._queue:
            return
        has_work = any(item.state == STATE_QUEUED for item in self._queue)
        if not has_work:
            return
        
        self._running = True
        self._worker_thread = threading.Thread(
            target=self._worker_loop,
            name="nzb-hunt-worker",
            daemon=True
        )
        self._worker_thread.start()
    
    def _worker_loop(self):
        """Main worker loop - processes queued downloads."""
        logger.info("NZB Hunt download worker started")
        try:
            self.configure_servers()
            
            while self._running:
                # Find next queued item
                item = None
                with self._queue_lock:
                    for i in self._queue:
                        if i.state == STATE_QUEUED:
                            item = i
                            break
                
                if item is None:
                    # No more work
                    break
                
                # Process this download
                self._process_download(item)
        except Exception as e:
            logger.error(f"Worker loop error: {e}")
        finally:
            self._running = False
            self._nntp.close_all()
            logger.info("NZB Hunt download worker stopped")
    
    def _download_segment(self, message_id: str, groups: List[str],
                           item: DownloadItem) -> Tuple[int, Optional[bytes], str]:
        """Download and decode a single segment (runs in thread pool).
        
        Returns:
            (segment_number_unused, decoded_bytes_or_None, server_name)
        """
        # Check if paused
        if item.state == STATE_PAUSED or self._paused_global:
            return 0, None, ""
        
        # Download the article – tracked version returns server name
        article_data, server_name = self._nntp.download_article_tracked(
            message_id, groups, conn_timeout=1.0
        )
        
        if article_data is None:
            return 0, None, server_name
        
        # Decode yEnc
        try:
            decoded, _ = decode_yenc(article_data)
        except Exception:
            return 0, None, server_name
        
        # Apply rate limiting
        self._rate_limiter.consume(len(decoded))
        
        # Record for rolling speed
        self._record_speed(len(decoded))
        
        return len(decoded), decoded, server_name
    
    def _process_download(self, item: DownloadItem):
        """Process a single NZB download using parallel connections."""
        item.state = STATE_DOWNLOADING
        item.started_at = datetime.now(timezone.utc).isoformat()
        self._save_state()
        
        try:
            # Parse the NZB
            nzb = parse_nzb(item.nzb_content)
            
            # Determine output directory
            folders = self._get_folders()
            temp_dir = folders.get("temp_folder", "/downloads/incomplete")
            download_dir = folders.get("download_folder", "/downloads")
            
            # Check if there's a category-specific folder
            if item.category:
                cat_folder = self._get_category_folder(item.category)
                if cat_folder:
                    download_dir = cat_folder
            
            # Create a directory for this download
            safe_name = "".join(c for c in item.name if c.isalnum() or c in " ._-")[:100].strip()
            if not safe_name:
                safe_name = item.id
            
            temp_path = os.path.join(temp_dir, safe_name)
            final_path = os.path.join(download_dir, safe_name)
            os.makedirs(temp_path, exist_ok=True)
            
            # Determine thread pool size from total available connections
            max_workers = self._nntp.get_total_max_connections()
            max_workers = max(4, min(max_workers, 64))  # Clamp 4–64
            
            logger.info(f"[{item.id}] Starting parallel download with {max_workers} workers")
            
            # Download each file in the NZB
            with ThreadPoolExecutor(max_workers=max_workers) as executor:
                for file_idx, nzb_file in enumerate(nzb.files):
                    if item.state == STATE_PAUSED or self._paused_global:
                        self._save_state()
                        return
                    
                    filename = nzb_file.filename
                    file_path = os.path.join(temp_path, filename)
                    
                    logger.info(f"[{item.id}] Downloading file {file_idx + 1}/"
                                f"{len(nzb.files)}: {filename} "
                                f"({len(nzb_file.segments)} segments)")
                    
                    # Submit all segments for this file in parallel
                    future_to_seg = {}
                    for seg in nzb_file.segments:
                        if item.state == STATE_PAUSED or self._paused_global:
                            break
                        future = executor.submit(
                            self._download_segment,
                            seg.message_id, nzb_file.groups, item
                        )
                        future_to_seg[future] = seg
                    
                    # Collect results as they complete
                    segment_data = {}  # number -> decoded bytes
                    failed_segments = 0
                    
                    for future in as_completed(future_to_seg):
                        if item.state == STATE_PAUSED or self._paused_global:
                            # Cancel remaining futures
                            for f in future_to_seg:
                                f.cancel()
                            break
                        
                        seg = future_to_seg[future]
                        try:
                            nbytes, decoded, server_name = future.result()
                            if decoded is not None:
                                segment_data[seg.number] = decoded
                                
                                # Update progress (thread-safe via GIL for simple assignments)
                                item.completed_segments += 1
                                item.downloaded_bytes += nbytes
                                
                                # Update item speed from rolling window
                                speed = self._get_rolling_speed()
                                item.speed_bps = speed
                                remaining = max(0, item.total_bytes - item.downloaded_bytes)
                                item.eta_seconds = int(remaining / speed) if speed > 0 else 0
                                
                                # Save state periodically
                                if item.completed_segments % 100 == 0:
                                    self._save_state()
                            else:
                                failed_segments += 1
                        except Exception as e:
                            failed_segments += 1
                            logger.debug(f"[{item.id}] Segment {seg.number} error: {e}")
                    
                    if item.state == STATE_PAUSED or self._paused_global:
                        self._save_state()
                        return
                    
                    if failed_segments > 0:
                        logger.warning(f"[{item.id}] {failed_segments} segments failed "
                                       f"for {filename}")
                    
                    # Assemble file from ordered segments
                    file_data = bytearray()
                    for seg_num in sorted(segment_data.keys()):
                        file_data.extend(segment_data[seg_num])
                    
                    # Write file
                    try:
                        with open(file_path, "wb") as f:
                            f.write(file_data)
                        logger.info(f"[{item.id}] Saved: {filename} "
                                    f"({len(file_data):,} bytes)")
                    except Exception as e:
                        logger.error(f"[{item.id}] Failed to write {filename}: {e}")
                    
                    item.completed_files += 1
                    self._save_state()
            
            # Move from temp to final destination
            try:
                if temp_path != final_path:
                    os.makedirs(os.path.dirname(final_path), exist_ok=True)
                    if os.path.exists(final_path):
                        # Merge contents
                        for f_name in os.listdir(temp_path):
                            src = os.path.join(temp_path, f_name)
                            dst = os.path.join(final_path, f_name)
                            shutil.move(src, dst)
                        shutil.rmtree(temp_path, ignore_errors=True)
                    else:
                        shutil.move(temp_path, final_path)
            except Exception as e:
                logger.error(f"[{item.id}] Failed to move to final path: {e}")
            
            # Mark as completed
            item.state = STATE_COMPLETED
            item.completed_at = datetime.now(timezone.utc).isoformat()
            item.speed_bps = 0
            item.eta_seconds = 0
            
            logger.info(f"[{item.id}] Download completed: {item.name}")
            
        except Exception as e:
            item.state = STATE_FAILED
            item.error_message = str(e)
            item.speed_bps = 0
            item.eta_seconds = 0
            logger.error(f"[{item.id}] Download failed: {e}")
        
        # Move completed/failed items to history
        with self._queue_lock:
            if item.state in (STATE_COMPLETED, STATE_FAILED):
                self._queue = [i for i in self._queue if i.id != item.id]
                self._history.append(item)
            self._save_state()
    
    def stop(self):
        """Stop the download worker."""
        self._running = False
        if self._worker_thread and self._worker_thread.is_alive():
            self._worker_thread.join(timeout=10)
        self._nntp.close_all()


def _format_speed(bps: int) -> str:
    """Format bytes per second to human-readable string."""
    if bps <= 0:
        return "0 B/s"
    if bps < 1024:
        return f"{bps} B/s"
    elif bps < 1024 * 1024:
        return f"{bps / 1024:.1f} KB/s"
    else:
        return f"{bps / (1024 * 1024):.1f} MB/s"


def _format_bytes(nbytes: int) -> str:
    """Format bytes to human-readable string (no /s)."""
    if nbytes <= 0:
        return "0 B"
    units = ["B", "KB", "MB", "GB", "TB"]
    i = 0
    b = float(nbytes)
    while b >= 1024 and i < len(units) - 1:
        b /= 1024
        i += 1
    return f"{b:.1f} {units[i]}" if i > 0 else f"{int(b)} B"


def _format_eta(seconds: int) -> str:
    """Format seconds to human-readable ETA."""
    if seconds <= 0:
        return "--"
    h = seconds // 3600
    m = (seconds % 3600) // 60
    s = seconds % 60
    if h > 0:
        return f"{h}h {m:02d}m"
    return f"{m}m {s:02d}s"


# ── Module-level convenience functions ────────────────────────────

def get_manager() -> NZBHuntDownloadManager:
    """Get the singleton download manager instance."""
    return NZBHuntDownloadManager.get_instance()
