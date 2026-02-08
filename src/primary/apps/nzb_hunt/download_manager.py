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
from concurrent.futures import ThreadPoolExecutor, ProcessPoolExecutor, as_completed
import requests
from typing import Optional, List, Dict, Any, Tuple
from datetime import datetime, timezone

from src.primary.utils.logger import get_logger
from src.primary.apps.nzb_hunt.nzb_parser import parse_nzb, NZB
from src.primary.apps.nzb_hunt.yenc_decoder import decode_yenc
from src.primary.apps.nzb_hunt.nntp_client import NNTPManager
from src.primary.apps.nzb_hunt.post_processor import post_process

logger = get_logger("nzb_hunt.manager")


# ── Top-level function for ProcessPoolExecutor (must be picklable) ──────────
def _decode_yenc_in_process(article_data: bytes) -> Optional[bytes]:
    """Decode yEnc data in a worker process. Runs outside the main GIL.
    
    This function runs in a separate process to avoid GIL contention
    from CPU-bound yEnc decoding, keeping the web server responsive.
    """
    try:
        from src.primary.apps.nzb_hunt.yenc_decoder import decode_yenc
        decoded, _ = decode_yenc(article_data)
        return decoded
    except Exception:
        return None


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
                 priority: str = "normal", added_by: str = "",
                 nzb_name: str = "", indexer: str = ""):
        self.id = nzb_id
        self.seq_id = 0  # Sequential ID, assigned by DownloadManager
        self.name = name
        self.nzb_name = nzb_name or name  # Original NZB filename
        self.indexer = indexer  # Which indexer provided this NZB
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
        self.status_message = ""  # User-facing status detail (e.g., "Missing articles: 150/500")
        
        # Progress tracking
        self.total_bytes = 0
        self.downloaded_bytes = 0
        self.total_segments = 0
        self.completed_segments = 0
        self.failed_segments = 0  # Segments that couldn't be downloaded (missing articles)
        self.missing_bytes = 0    # Estimated bytes of missing articles (like SABnzbd's mbmissing)
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
            "seq_id": self.seq_id,
            "name": self.name,
            "nzb_name": self.nzb_name,
            "indexer": self.indexer,
            "category": self.category,
            "priority": self.priority,
            "added_by": self.added_by,
            "state": self.state,
            "added_at": self.added_at,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
            "error_message": self.error_message,
            "status_message": self.status_message,
            "total_bytes": self.total_bytes,
            "downloaded_bytes": self.downloaded_bytes,
            "total_segments": self.total_segments,
            "completed_segments": self.completed_segments,
            "failed_segments": self.failed_segments,
            "missing_bytes": self.missing_bytes,
            "total_files": self.total_files,
            "completed_files": self.completed_files,
            "progress_pct": round(self.progress_pct, 1),
            "speed_bps": self.speed_bps,
            "eta_seconds": self.eta_seconds,
            "time_left": self.time_left_str,
            "nzb_url": self.nzb_url,
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
            nzb_name=d.get("nzb_name", ""),
            indexer=d.get("indexer", ""),
        )
        item.seq_id = d.get("seq_id", 0)
        item.state = d.get("state", STATE_QUEUED)
        item.added_at = d.get("added_at", item.added_at)
        item.started_at = d.get("started_at")
        item.completed_at = d.get("completed_at")
        item.error_message = d.get("error_message", "")
        item.status_message = d.get("status_message", "")
        item.total_bytes = d.get("total_bytes", 0)
        item.downloaded_bytes = d.get("downloaded_bytes", 0)
        item.total_segments = d.get("total_segments", 0)
        item.completed_segments = d.get("completed_segments", 0)
        item.failed_segments = d.get("failed_segments", 0)
        item.missing_bytes = d.get("missing_bytes", 0)
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
        self._next_seq_id: int = 1  # Sequential download counter
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
        
        # Process pool for CPU-bound yEnc decoding.
        # Runs in separate processes so decoding doesn't hold the main GIL,
        # keeping the web server responsive during heavy downloads.
        import multiprocessing
        cpu_count = multiprocessing.cpu_count()
        decode_workers = max(2, min(cpu_count, 8))
        self._decode_pool = ProcessPoolExecutor(max_workers=decode_workers)
        logger.info(f"yEnc decode process pool: {decode_workers} workers "
                    f"(CPUs: {cpu_count})")
        
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
            self._next_seq_id = data.get("next_seq_id", 1)
            self._queue = [DownloadItem.from_dict(d) for d in data.get("queue", [])]
            self._history = [DownloadItem.from_dict(d) for d in data.get("history", [])]
            
            # Load NZB content: try separate file first, fall back to inline (migration)
            migrated = 0
            for item in self._queue:
                content_from_file = self._load_nzb_content(item.id)
                if content_from_file:
                    item.nzb_content = content_from_file
                elif item.nzb_content:
                    # Migrate: save inline content to separate file for future loads
                    self._save_nzb_content(item.id, item.nzb_content)
                    migrated += 1
                elif item.nzb_url:
                    # Try re-fetching NZB from URL
                    try:
                        import requests
                        resp = requests.get(item.nzb_url, timeout=30)
                        if resp.status_code == 200:
                            item.nzb_content = resp.text
                            self._save_nzb_content(item.id, item.nzb_content)
                            migrated += 1
                            logger.info(f"Re-fetched NZB content for {item.name}")
                    except Exception as e:
                        logger.warning(f"Failed to re-fetch NZB for {item.name}: {e}")
            
            if migrated > 0:
                logger.info(f"Migrated {migrated} NZB content files to separate storage")
            
            # Reset any items that were downloading when we crashed
            for item in self._queue:
                if item.state in (STATE_DOWNLOADING, STATE_EXTRACTING):
                    item.state = STATE_QUEUED
            logger.info(f"Loaded NZB Hunt state: {len(self._queue)} queued, {len(self._history)} history")
        except Exception as e:
            logger.error(f"Failed to load NZB Hunt state: {e}")
    
    def _nzb_content_dir(self) -> str:
        """Directory for storing NZB content files separately from state."""
        d = os.path.join(self._config_dir, "nzb_content")
        os.makedirs(d, exist_ok=True)
        return d

    def _save_nzb_content(self, item_id: str, nzb_content: str):
        """Save NZB content to a separate file (called once on add)."""
        try:
            path = os.path.join(self._nzb_content_dir(), f"{item_id}.nzb")
            with open(path, "w") as f:
                f.write(nzb_content)
        except Exception as e:
            logger.error(f"Failed to save NZB content for {item_id}: {e}")

    def _load_nzb_content(self, item_id: str) -> str:
        """Load NZB content from separate file."""
        try:
            path = os.path.join(self._nzb_content_dir(), f"{item_id}.nzb")
            if os.path.exists(path):
                with open(path, "r") as f:
                    return f.read()
        except Exception as e:
            logger.debug(f"Failed to load NZB content for {item_id}: {e}")
        return ""

    def _delete_nzb_content(self, item_id: str):
        """Delete NZB content file when item is removed from queue."""
        try:
            path = os.path.join(self._nzb_content_dir(), f"{item_id}.nzb")
            if os.path.exists(path):
                os.remove(path)
        except Exception:
            pass

    def _save_state(self):
        """Persist queue state to disk (atomic write to prevent corruption).
        
        NZB content is stored in separate files, so the main state file stays small
        and all saves are fast (~1ms instead of seconds).
        """
        try:
            data = {
                "next_seq_id": self._next_seq_id,
                "queue": [item.to_dict() for item in self._queue],
                "history": [item.to_dict() for item in self._history[-100:]],  # Keep last 100
            }
            
            path = self._state_path()
            tmp_path = path + ".tmp"
            with open(tmp_path, "w") as f:
                json.dump(data, f)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp_path, path)
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
    
    def _get_processing_settings(self) -> dict:
        """Get processing settings from config."""
        defaults = {
            "max_retries": 3,
            "abort_hopeless": True,
            "abort_threshold_pct": 5,
            "propagation_delay": 0,
            "disconnect_on_empty": True,
            "direct_unpack": False,
            "encrypted_rar_action": "pause",
            "unwanted_ext_action": "off",
            "unwanted_extensions": "exe",
        }
        try:
            config_path = os.path.join(self._config_dir, "nzb_hunt_config.json")
            if os.path.exists(config_path):
                with open(config_path, "r") as f:
                    cfg = json.load(f)
                proc = cfg.get("processing", {})
                for key, default in defaults.items():
                    if key in proc:
                        defaults[key] = proc[key]
        except Exception:
            pass
        return defaults

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
                priority: str = "normal", added_by: str = "",
                nzb_name: str = "", indexer: str = "") -> Tuple[bool, str, str]:
        """Add an NZB to the download queue.
        
        Args:
            nzb_url: URL to download NZB from
            nzb_content: NZB XML content (if already have it)
            name: Display name for the download
            category: Category for organization
            priority: Priority level
            added_by: Who added it (e.g., "movie_hunt")
            nzb_name: Original NZB filename (for tooltip display)
            indexer: Name of the indexer that provided this NZB
            
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
            nzb_name=nzb_name or name,
            indexer=indexer,
        )
        item.total_bytes = nzb.total_bytes
        item.total_segments = nzb.total_segments
        item.total_files = len(nzb.files)
        
        # Save NZB content to separate file (large, only once)
        self._save_nzb_content(nzb_id, nzb_content)
        
        with self._queue_lock:
            # Assign sequential ID
            item.seq_id = self._next_seq_id
            self._next_seq_id += 1
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
                    self._delete_nzb_content(nzb_id)
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
                           item: DownloadItem,
                           max_retries: int = 3) -> Tuple[int, Optional[bytes], str]:
        """Download and decode a single segment with retry logic.
        
        NNTP download runs in the calling thread (I/O bound, releases GIL).
        yEnc decode runs in a separate process (CPU bound, no GIL contention).
        Retries up to max_retries times on failure (like SABnzbd's max_art_tries).
        
        Returns:
            (decoded_length, decoded_bytes_or_None, server_name)
        """
        # Check if paused
        if item.state == STATE_PAUSED or self._paused_global:
            return 0, None, ""
        
        server_name = ""
        
        for attempt in range(max_retries):
            if item.state == STATE_PAUSED or self._paused_global:
                return 0, None, ""
            
            # Download the article – I/O bound, releases GIL during socket ops
            article_data, server_name = self._nntp.download_article_tracked(
                message_id, groups, conn_timeout=1.0
            )
            
            if article_data is not None:
                # Decode yEnc in a separate process (CPU bound → avoids GIL contention)
                try:
                    future = self._decode_pool.submit(_decode_yenc_in_process, article_data)
                    decoded = future.result(timeout=60)
                    if decoded is not None:
                        # Apply rate limiting (lightweight, stays in main process)
                        self._rate_limiter.consume(len(decoded))
                        # Record for rolling speed
                        self._record_speed(len(decoded))
                        return len(decoded), decoded, server_name
                except Exception:
                    pass
            
            # Retry after a brief pause (only if not last attempt)
            if attempt < max_retries - 1:
                time.sleep(0.5 * (attempt + 1))  # Back off: 0.5s, 1s, 1.5s
        
        # All retries exhausted after max_retries attempts
        return 0, None, server_name
    
    def _process_download(self, item: DownloadItem):
        """Process a single NZB download using parallel connections."""
        item.state = STATE_DOWNLOADING
        item.started_at = datetime.now(timezone.utc).isoformat()
        self._save_state()
        
        try:
            # Load processing settings from config
            proc_settings = self._get_processing_settings()
            max_retries = proc_settings.get("max_retries", 3)
            abort_hopeless = proc_settings.get("abort_hopeless", True)
            abort_threshold_pct = proc_settings.get("abort_threshold_pct", 5)
            
            logger.info(f"[{item.id}] Processing settings: retries={max_retries}, "
                        f"abort_hopeless={abort_hopeless}, threshold={abort_threshold_pct}%")
            
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
            
            # Thread pool for NNTP I/O (releases GIL during socket ops).
            # yEnc decoding runs in a separate ProcessPoolExecutor, so threads
            # no longer cause GIL contention. Safe to use more workers.
            max_workers = self._nntp.get_total_max_connections()
            max_workers = max(4, min(max_workers, 50))
            
            # Sort files: data files first, par2 files last (like SABnzbd)
            # This ensures the actual content downloads before recovery data
            sorted_files = sorted(nzb.files, key=lambda f: (
                1 if f.filename.lower().endswith('.par2') else 0,
                f.filename.lower()
            ))
            
            logger.info(f"[{item.id}] Starting parallel download with {max_workers} workers")
            
            # Track consecutive failed segments for early abort
            consecutive_failures = 0
            MAX_CONSECUTIVE_FAILURES = 500  # Abort if 500+ segments fail in a row
            MAX_FAILURE_PCT = float(abort_threshold_pct)  # From processing settings
            MIN_SEGMENTS_FOR_PCT_CHECK = 200  # Need at least this many before checking %
            aborted = False
            
            # Download each file in the NZB
            # NOTE: We manage the executor manually (not with 'with') so we can
            # call shutdown(wait=False, cancel_futures=True) for fast abort.
            executor = ThreadPoolExecutor(max_workers=max_workers)
            try:
                for file_idx, nzb_file in enumerate(sorted_files):
                    if item.state == STATE_PAUSED or self._paused_global:
                        self._save_state()
                        executor.shutdown(wait=False, cancel_futures=True)
                        return
                    if aborted:
                        break
                    
                    filename = nzb_file.filename
                    file_path = os.path.join(temp_path, filename)
                    
                    logger.info(f"[{item.id}] Downloading file {file_idx + 1}/"
                                f"{len(sorted_files)}: {filename} "
                                f"({len(nzb_file.segments)} segments)")
                    
                    # Submit all segments for this file in parallel
                    future_to_seg = {}
                    for seg in nzb_file.segments:
                        if item.state == STATE_PAUSED or self._paused_global:
                            break
                        if aborted:
                            break
                        future = executor.submit(
                            self._download_segment,
                            seg.message_id, nzb_file.groups, item,
                            max_retries
                        )
                        future_to_seg[future] = seg
                    
                    # Collect results as they complete
                    segment_data = {}  # number -> decoded bytes
                    file_failed = 0
                    
                    for future in as_completed(future_to_seg):
                        if item.state == STATE_PAUSED or self._paused_global:
                            for f in future_to_seg:
                                f.cancel()
                            break
                        if aborted:
                            for f in future_to_seg:
                                f.cancel()
                            break
                        
                        seg = future_to_seg[future]
                        try:
                            nbytes, decoded, server_name = future.result()
                            if decoded is not None:
                                segment_data[seg.number] = decoded
                                consecutive_failures = 0  # Reset on success
                                
                                # Update progress (thread-safe via GIL for simple assignments)
                                item.completed_segments += 1
                                item.downloaded_bytes += nbytes
                                
                                # Update item speed from rolling window
                                speed = self._get_rolling_speed()
                                item.speed_bps = speed
                                remaining = max(0, item.total_bytes - item.downloaded_bytes)
                                item.eta_seconds = int(remaining / speed) if speed > 0 else 0
                                
                                # Update status message with progress
                                if item.failed_segments > 0:
                                    mb_missing = item.missing_bytes / (1024 * 1024)
                                    if mb_missing >= 1.0:
                                        item.status_message = (
                                            f"{mb_missing:.1f} MB Missing articles"
                                        )
                                    else:
                                        item.status_message = (
                                            f"Missing articles: {item.failed_segments}"
                                        )
                                
                                # Save state periodically (lightweight, no NZB content)
                                if item.completed_segments % 200 == 0:
                                    self._save_state()
                            else:
                                file_failed += 1
                                item.failed_segments += 1
                                consecutive_failures += 1
                                
                                # Track missing bytes (encoded segment size from NZB)
                                item.missing_bytes += seg.bytes if seg.bytes else 0
                                
                                # Update status message with MB missing (like SABnzbd)
                                total_attempted = item.completed_segments + item.failed_segments
                                mb_missing = item.missing_bytes / (1024 * 1024)
                                if mb_missing >= 1.0:
                                    item.status_message = (
                                        f"{mb_missing:.1f} MB Missing articles"
                                    )
                                else:
                                    item.status_message = (
                                        f"Missing articles: {item.failed_segments}"
                                    )
                                
                                # Check for early abort (only if abort_hopeless is enabled)
                                if abort_hopeless:
                                    # Too many consecutive failures (content likely DMCA'd)
                                    if consecutive_failures >= MAX_CONSECUTIVE_FAILURES:
                                        logger.error(
                                            f"[{item.id}] ABORTING: {consecutive_failures} consecutive "
                                            f"missing articles - content likely removed (DMCA)"
                                        )
                                        aborted = True
                                        break
                                    
                                    # Check failure percentage after enough samples
                                    if total_attempted >= MIN_SEGMENTS_FOR_PCT_CHECK:
                                        fail_pct = (item.failed_segments / total_attempted) * 100
                                        if fail_pct > MAX_FAILURE_PCT:
                                            logger.error(
                                                f"[{item.id}] ABORTING: {fail_pct:.1f}% segments "
                                                f"missing ({item.failed_segments}/{total_attempted}) "
                                                f"- download cannot be completed"
                                            )
                                            aborted = True
                                            break
                        except Exception as e:
                            file_failed += 1
                            item.failed_segments += 1
                            consecutive_failures += 1
                            item.missing_bytes += seg.bytes if seg.bytes else 0
                            logger.debug(f"[{item.id}] Segment {seg.number} error: {e}")
                    
                    if item.state == STATE_PAUSED or self._paused_global:
                        self._save_state()
                        executor.shutdown(wait=False, cancel_futures=True)
                        return
                    
                    if file_failed > 0:
                        logger.warning(f"[{item.id}] {file_failed}/{len(nzb_file.segments)} "
                                       f"segments failed for {filename}")
                    
                    if aborted:
                        break
                    
                    # Assemble file from ordered segments.
                    # If segments are missing, write zero-filled gaps at the
                    # correct offsets so par2 can locate the damage and repair it.
                    # (Simply concatenating available segments would shift all
                    # offsets and make par2 repair impossible.)
                    if file_failed > 0 and len(nzb_file.segments) > 0:
                        # Build a segment-number → expected-size map from the NZB
                        seg_sizes = {s.number: s.bytes for s in nzb_file.segments}
                        all_seg_nums = sorted(seg_sizes.keys())
                        
                        file_data = bytearray()
                        for seg_num in all_seg_nums:
                            if seg_num in segment_data:
                                file_data.extend(segment_data[seg_num])
                            else:
                                # Zero-fill at the expected encoded size
                                # (close enough for par2 to locate the damage)
                                gap_size = seg_sizes.get(seg_num, 0)
                                file_data.extend(b'\x00' * gap_size)
                        
                        logger.info(f"[{item.id}] Assembled {filename} with "
                                    f"{file_failed} zero-filled gaps for par2 repair")
                    else:
                        # No missing segments - simple concatenation
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
            finally:
                executor.shutdown(wait=False, cancel_futures=True)
            
            # Check if download was aborted due to missing articles
            if aborted:
                total_attempted = item.completed_segments + item.failed_segments
                fail_pct = (item.failed_segments / max(1, total_attempted)) * 100
                mb_missing = item.missing_bytes / (1024 * 1024)
                mb_str = f"{mb_missing:.1f} MB" if mb_missing >= 1.0 else f"{item.missing_bytes / 1024:.0f} KB"
                err_msg = (
                    f"Aborted: {mb_str} missing articles "
                    f"({item.failed_segments}/{total_attempted} segments, {fail_pct:.1f}%). "
                    f"Content may have been removed (DMCA)."
                )
                item.state = STATE_FAILED
                item.error_message = err_msg
                item.status_message = f"Failed: {mb_str} missing articles"
                item.speed_bps = 0
                item.eta_seconds = 0
                logger.error(f"[{item.id}] {err_msg}")
                # Clean up temp files
                try:
                    shutil.rmtree(temp_path, ignore_errors=True)
                except Exception:
                    pass
                # Move to history as failed
                with self._queue_lock:
                    self._queue = [i for i in self._queue if i.id != item.id]
                    self._delete_nzb_content(item.id)
                    self._history.append(item)
                    self._save_state()
                return
            
            # Log overall missing article stats
            if item.failed_segments > 0:
                total_attempted = item.completed_segments + item.failed_segments
                fail_pct = (item.failed_segments / max(1, total_attempted)) * 100
                logger.warning(f"[{item.id}] Total missing articles: "
                               f"{item.failed_segments}/{total_attempted} "
                               f"({fail_pct:.1f}%)")
                item.status_message = f"Missing articles: {item.failed_segments} ({fail_pct:.1f}%)"
            
            # ── Post-processing (par2 repair + archive extraction) ──
            item.state = STATE_EXTRACTING
            if item.failed_segments > 0:
                ext_mb = item.missing_bytes / (1024 * 1024)
                ext_mb_str = f"{ext_mb:.1f} MB" if ext_mb >= 1.0 else f"{item.failed_segments} segments"
                item.status_message = f"Verifying & repairing ({ext_mb_str} missing articles)..."
            else:
                item.status_message = "Post-processing..."
            self._save_state()
            logger.info(f"[{item.id}] Starting post-processing for {item.name}")
            
            pp_ok, pp_msg = post_process(temp_path, item_name=item.id)
            if pp_ok:
                logger.info(f"[{item.id}] Post-processing success: {pp_msg}")
                if item.failed_segments > 0:
                    pp_mb = item.missing_bytes / (1024 * 1024)
                    pp_mb_str = f"{pp_mb:.1f} MB" if pp_mb >= 1.0 else f"{item.failed_segments} segments"
                    item.status_message = f"Repaired ({pp_mb_str} missing articles recovered via par2)"
                else:
                    item.status_message = ""
            else:
                logger.error(f"[{item.id}] Post-processing failed: {pp_msg}")
                # If post-processing fails (par2 repair failed, extraction failed, 
                # no video files found), mark the download as failed so Movie Hunt
                # can blocklist it and try a different release
                item.state = STATE_FAILED
                if item.failed_segments > 0:
                    err_mb = item.missing_bytes / (1024 * 1024)
                    err_mb_str = f"{err_mb:.1f} MB" if err_mb >= 1.0 else f"{item.failed_segments} segments"
                    item.error_message = (
                        f"{pp_msg} ({err_mb_str} missing articles could not be repaired)"
                    )
                else:
                    item.error_message = pp_msg
                item.speed_bps = 0
                item.eta_seconds = 0
                logger.error(f"[{item.id}] Download marked as FAILED: {pp_msg}")
                # Clean up the temp directory on failure
                try:
                    shutil.rmtree(temp_path, ignore_errors=True)
                except Exception:
                    pass
                # Move to history as failed
                with self._queue_lock:
                    self._queue = [i for i in self._queue if i.id != item.id]
                    self._delete_nzb_content(item.id)
                    self._history.append(item)
                    self._save_state()
                return  # Skip the rest (move to final, mark completed)
            
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
                self._delete_nzb_content(item.id)  # Clean up NZB file
                self._history.append(item)
            self._save_state()
    
    def stop(self):
        """Stop the download worker and process pool."""
        self._running = False
        if self._worker_thread and self._worker_thread.is_alive():
            self._worker_thread.join(timeout=10)
        self._nntp.close_all()
        try:
            self._decode_pool.shutdown(wait=False)
        except Exception:
            pass


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
