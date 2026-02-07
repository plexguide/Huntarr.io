"""
NZB Hunt Download Manager - Orchestrates NZB downloading.

Manages a download queue backed by the database, coordinates NNTP article
downloads across configured servers, and assembles files.

This is the main integration point for Movie Hunt → NZB Hunt.
"""

import os
import json
import time
import uuid
import threading
import requests
from typing import Optional, List, Dict, Any, Tuple
from datetime import datetime, timezone

from src.primary.utils.logger import get_logger
from src.primary.apps.nzb_hunt.nzb_parser import parse_nzb, NZB
from src.primary.apps.nzb_hunt.yenc_decoder import decode_yenc
from src.primary.apps.nzb_hunt.nntp_client import NNTPManager

logger = get_logger("nzb_hunt.manager")


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
        self._config_dir = self._detect_config_dir()
        self._load_state()
    
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
    
    def get_status(self) -> dict:
        """Get overall download status."""
        with self._queue_lock:
            active = [i for i in self._queue if i.state == STATE_DOWNLOADING]
            queued = [i for i in self._queue if i.state == STATE_QUEUED]
            paused = [i for i in self._queue if i.state == STATE_PAUSED]
            
            total_speed = sum(i.speed_bps for i in active)
            
            return {
                "active_count": len(active),
                "queued_count": len(queued),
                "paused_count": len(paused),
                "total_count": len(self._queue),
                "history_count": len(self._history),
                "speed_bps": total_speed,
                "speed_human": _format_speed(total_speed),
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
    
    def _process_download(self, item: DownloadItem):
        """Process a single NZB download."""
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
            
            start_time = time.time()
            bytes_this_session = 0
            
            # Download each file in the NZB
            for file_idx, nzb_file in enumerate(nzb.files):
                filename = nzb_file.filename
                file_path = os.path.join(temp_path, filename)
                
                logger.info(f"[{item.id}] Downloading file {file_idx + 1}/{len(nzb.files)}: {filename}")
                
                # Download all segments for this file
                file_data = bytearray()
                segment_data = {}  # number -> decoded bytes
                
                for seg in nzb_file.segments:
                    if item.state == STATE_PAUSED:
                        self._save_state()
                        return
                    
                    # Download article
                    article_data = self._nntp.download_article(
                        seg.message_id, nzb_file.groups
                    )
                    
                    if article_data is None:
                        logger.warning(f"[{item.id}] Failed to download segment "
                                       f"{seg.number} of {filename}")
                        continue
                    
                    # Decode yEnc
                    try:
                        decoded, _ = decode_yenc(article_data)
                        segment_data[seg.number] = decoded
                        bytes_this_session += len(decoded)
                    except Exception as e:
                        logger.warning(f"[{item.id}] yEnc decode error for segment "
                                       f"{seg.number}: {e}")
                        continue
                    
                    # Update progress
                    item.completed_segments += 1
                    item.downloaded_bytes += len(decoded)
                    
                    # Calculate speed
                    elapsed = time.time() - start_time
                    if elapsed > 0:
                        item.speed_bps = int(bytes_this_session / elapsed)
                        remaining_bytes = item.total_bytes - item.downloaded_bytes
                        if item.speed_bps > 0:
                            item.eta_seconds = int(remaining_bytes / item.speed_bps)
                    
                    # Save state periodically (every 50 segments)
                    if item.completed_segments % 50 == 0:
                        self._save_state()
                
                # Assemble file from ordered segments
                for seg_num in sorted(segment_data.keys()):
                    file_data.extend(segment_data[seg_num])
                
                # Write file
                try:
                    with open(file_path, "wb") as f:
                        f.write(file_data)
                    logger.info(f"[{item.id}] Saved: {filename} ({len(file_data)} bytes)")
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
                        import shutil
                        for f in os.listdir(temp_path):
                            src = os.path.join(temp_path, f)
                            dst = os.path.join(final_path, f)
                            shutil.move(src, dst)
                        shutil.rmtree(temp_path, ignore_errors=True)
                    else:
                        import shutil
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
    if bps < 1024:
        return f"{bps} B/s"
    elif bps < 1024 * 1024:
        return f"{bps / 1024:.1f} KB/s"
    else:
        return f"{bps / (1024 * 1024):.1f} MB/s"


# ── Module-level convenience functions ────────────────────────────

def get_manager() -> NZBHuntDownloadManager:
    """Get the singleton download manager instance."""
    return NZBHuntDownloadManager.get_instance()
