"""
NZB Hunt Download Manager - Orchestrates NZB downloading.

Manages a download queue backed by the database, coordinates NNTP article
downloads across configured servers using parallel connections, and assembles
files.  Supports speed limiting, per-server bandwidth tracking, and rolling
speed calculation.

This is the main integration point for Movie Hunt → NZB Hunt.
"""

import os
import re
import json
import time
import uuid
import shutil
import hashlib
import threading
from collections import deque
from concurrent.futures import ThreadPoolExecutor, as_completed
import requests
from typing import Optional, List, Dict, Any, Tuple
from datetime import datetime, timezone

from src.primary.utils.logger import get_logger
from src.primary.apps.nzb_hunt.nzb_parser import parse_nzb, NZB
from src.primary.apps.nzb_hunt.yenc_decoder import decode_yenc  # C-level fast decoder
from src.primary.apps.nzb_hunt.nntp_client import NNTPManager
from src.primary.apps.nzb_hunt.post_processor import post_process

logger = get_logger("nzb_hunt.manager")


def _nzb_content_hash(content: str) -> str:
    """Compute SHA256 hash of NZB content for identical detection."""
    return hashlib.sha256(content.encode("utf-8", errors="replace")).hexdigest()


def _release_key(name: str) -> str:
    """
    Extract a normalized release key for smart duplicate detection.
    Strips PROPER/REAL/REPACK/INTERNAL, lowercases, removes extension.
    E.g. "Movie.Name.2024.1080p.PROPER.BluRay" -> "movie.name.2024.1080p.bluray"
    """
    s = (name or "").strip()
    if not s:
        return ""
    # Remove extension
    if "." in s:
        s = s.rsplit(".", 1)[0]
    # Remove common upgrade suffixes (case insensitive)
    for suffix in ("PROPER", "REAL", "REPACK", "INTERNAL"):
        s = re.sub(rf"\.{re.escape(suffix)}\b", "", s, flags=re.I)
        s = re.sub(rf"\b{re.escape(suffix)}\b", "", s, flags=re.I)
    return " ".join(s.lower().split())


def _has_proper_real_repack(name: str) -> bool:
    """Check if name contains PROPER, REAL, or REPACK (upgrade indicators)."""
    n = (name or "").upper()
    return "PROPER" in n or "REAL" in n or "REPACK" in n


def _folder_ensure_loop(manager: "NZBHuntDownloadManager"):
    """Every 15 min, when NZB Hunt has servers, ensure category folders exist and are writeable."""
    while True:
        try:
            time.sleep(900)  # 15 minutes
            if len(manager._get_servers()) == 0:
                continue
            try:
                from src.primary.routes.nzb_hunt_routes import (
                    _get_categories_from_instances,
                    _ensure_category_folders_and_status,
                    _load_config,
                )
                cfg = _load_config()
                folders = cfg.get("folders", {})
                temp_folder = folders.get("temp_folder", "/downloads/incomplete")
                category_names = _get_categories_from_instances()
                if category_names:
                    for s in _ensure_category_folders_and_status(temp_folder, category_names):
                        if not s.get("ok") and s.get("error"):
                            logger.warning("Category folder %r not writeable: %s", s.get("folder"), s.get("error"))
            except Exception as e:
                logger.warning("Category folder ensure failed: %s", e)
        except Exception as e:
            logger.warning("Folder ensure loop error: %s", e)


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
STATE_ASSEMBLING = "assembling"  # 100% segments done, writing files to disk
STATE_PAUSED = "paused"
STATE_COMPLETED = "completed"
STATE_FAILED = "failed"
STATE_EXTRACTING = "extracting"


class DownloadItem:
    """Represents a single NZB download in the queue."""
    
    def __init__(self, nzb_id: str, name: str, category: str = "",
                 nzb_content: str = "", nzb_url: str = "",
                 priority: str = "normal", added_by: str = "",
                 nzb_name: str = "", indexer: str = "",
                 source_instance_id: str = "", source_instance_name: str = ""):
        self.id = nzb_id
        self.seq_id = 0  # Sequential ID, assigned by DownloadManager
        self.name = name
        self.nzb_name = nzb_name or name  # Original NZB filename
        self.indexer = indexer  # Which indexer provided this NZB
        self.category = category
        self.nzb_content = nzb_content
        self.nzb_url = nzb_url
        self.priority = priority
        self.added_by = added_by  # "movie_hunt", "tv_hunt", "manual", etc.
        self.source_instance_id = source_instance_id or ""
        self.source_instance_name = source_instance_name or ""
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
        self.nzb_hash = ""  # SHA256 of NZB content for duplicate detection

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
            "source_instance_id": getattr(self, "source_instance_id", "") or "",
            "source_instance_name": getattr(self, "source_instance_name", "") or "",
            "state": self.state,
            "added_at": self.added_at,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
            "error_message": self.error_message,
            "status_message": self.status_message,
            "total_bytes": self.total_bytes,
            "downloaded_bytes": min(self.downloaded_bytes, self.total_bytes) if self.total_bytes > 0 else self.downloaded_bytes,
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
            "nzb_hash": getattr(self, "nzb_hash", ""),
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
            source_instance_id=d.get("source_instance_id", ""),
            source_instance_name=d.get("source_instance_name", ""),
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
        item.nzb_hash = d.get("nzb_hash", "")
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
        from src.primary.utils.config_paths import CONFIG_DIR
        self._config_dir = str(CONFIG_DIR)
        # Connection check cache (same Usenet servers used by Movie Hunt / future TV Hunt)
        self._connection_ok = False
        self._connection_check_time = 0.0
        self._connection_lock = threading.Lock()
        self._connection_cache_seconds = 120

        # Speed tracking – rolling window
        self._speed_lock = threading.Lock()
        self._speed_samples: deque = deque()
        self._speed_window = 3.0  # seconds
        
        # Rate limiter (token-bucket, thread-safe)
        self._rate_limiter = _RateLimiter()
        
        # Warnings system (like SABnzbd)
        self._warnings: List[dict] = []
        self._warnings_lock = threading.Lock()
        self._dismissed_warnings: set = set()  # dismissed warning IDs
        
        # yEnc decoding now runs in-thread using sabyenc3 (C extension,
        # releases GIL) or a fast bytes.translate() decoder.  No more
        # ProcessPoolExecutor — eliminates ~2ms of pickling overhead per
        # segment and removes the subprocess communication bottleneck.
        logger.info("yEnc decode: in-thread (sabyenc3 C extension or fast translate)")
        
        self._load_state()
        self._load_speed_limit()
        
        # Auto-start worker if there are queued items (e.g., after restart)
        self._ensure_worker_running()

        # Background: ensure category folders every 15 min when NZB Hunt has servers
        self._folder_ensure_thread = threading.Thread(
            target=_folder_ensure_loop,
            args=(self,),
            name="NZBHuntFolderEnsure",
            daemon=True,
        )
        self._folder_ensure_thread.start()
    
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
            
            # Reset items that were downloading when we crashed, but mark hopeless ones as FAILED
            # so they don't retry forever on restart (same bad download looping)
            proc = self._get_processing_settings()
            abort_hopeless = proc.get("abort_hopeless", True)
            abort_threshold_pct = float(proc.get("abort_threshold_pct", 5))
            to_remove = []
            for item in self._queue:
                if item.state in (STATE_DOWNLOADING, STATE_ASSEMBLING, STATE_EXTRACTING):
                    total_attempted = item.completed_segments + item.failed_segments
                    if abort_hopeless and item.failed_segments > 0 and total_attempted >= 50:
                        fail_pct = (item.failed_segments / total_attempted) * 100
                        if fail_pct > abort_threshold_pct:
                            mb = item.missing_bytes / (1024 * 1024)
                            mb_str = f"{mb:.1f} MB" if mb >= 1.0 else f"{item.missing_bytes / 1024:.0f} KB"
                            item.state = STATE_FAILED
                            item.error_message = (
                                f"Aborted on restart: {mb_str} missing articles "
                                f"({item.failed_segments}/{total_attempted} segments, {fail_pct:.1f}%). "
                                f"Content may have been removed."
                            )
                            item.status_message = f"Failed: {mb_str} missing articles"
                            to_remove.append(item)
                            logger.warning(f"[{item.id}] Marked as FAILED on load (hopeless: {fail_pct:.1f}% missing)")
                            try:
                                folders = self._get_folders()
                                temp_base = folders.get("temp_folder", "/downloads/incomplete")
                                temp_dir = self._get_category_temp_folder(item.category) if item.category else temp_base
                                safe_name = "".join(c for c in (item.name or "") if c.isalnum() or c in " ._-")[:100].strip() or item.id
                                temp_path = os.path.join(temp_dir, safe_name)
                                if os.path.isdir(temp_path):
                                    shutil.rmtree(temp_path, ignore_errors=True)
                                    logger.info(f"[{item.id}] Cleaned up orphaned temp dir")
                            except Exception:
                                pass
                            continue
                    # Reset to queued AND clear all progress counters —
                    # in-memory segment data is gone after restart, so the
                    # download must start fresh.
                    item.state = STATE_QUEUED
                    item.completed_segments = 0
                    item.downloaded_bytes = 0
                    item.completed_files = 0
                    item.failed_segments = 0
                    item.missing_bytes = 0
                    item.speed_bps = 0
                    item.eta_seconds = 0
                    item.status_message = ""
                    item.error_message = ""
                    item.started_at = None
                    logger.info(f"[{item.id}] Reset to QUEUED with cleared counters (restart recovery)")
            for item in to_remove:
                self._queue = [i for i in self._queue if i.id != item.id]
                self._history.append(item)
            # Always save after recovery (counters were reset)
            self._save_state()
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

    def _cleanup_temp_for_item(self, item: DownloadItem):
        """Remove temp directory for a download item (partial/incomplete files)."""
        try:
            folders = self._get_folders()
            temp_base = folders.get("temp_folder", "/downloads/incomplete")
            temp_dir = self._get_category_temp_folder(item.category) if item.category else temp_base
            safe_name = "".join(c for c in (item.name or "") if c.isalnum() or c in " ._-")[:100].strip() or item.id
            temp_path = os.path.join(temp_dir, safe_name)
            if os.path.isdir(temp_path):
                shutil.rmtree(temp_path, ignore_errors=True)
                logger.info(f"[{item.id}] Cleaned up temp dir for removed item")
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
            "identical_detection": "on",
            "smart_detection": "on",
            "allow_proper": True,
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

    def _temp_to_complete_base(self, temp_folder: str) -> str:
        """Derive complete base from temp: /downloads/incomplete -> /downloads/complete."""
        if not temp_folder or temp_folder.rstrip("/") == "":
            return "/downloads/complete"
        parent = os.path.dirname(temp_folder.rstrip(os.sep))
        if not parent or parent == temp_folder:
            return "/downloads/complete"
        return os.path.join(parent, "complete")

    def _get_category_folder(self, category: str) -> Optional[str]:
        """Get the completed download folder for a category. Auto-derived from temp_folder + category name."""
        if not category:
            return None
        folders = self._get_folders()
        temp_folder = folders.get("temp_folder", "/downloads/incomplete")
        complete_base = self._temp_to_complete_base(temp_folder)
        return os.path.join(complete_base, category)

    def _get_category_temp_folder(self, category: str) -> Optional[str]:
        """Get the incomplete (temp) folder for a category: temp_base/category_name."""
        if not category:
            return None
        folders = self._get_folders()
        temp_folder = folders.get("temp_folder", "/downloads/incomplete")
        return os.path.join(temp_folder, category)
    
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
        results = self._nntp.test_servers()
        # Update connection cache so UI and worker see a successful test
        with self._connection_lock:
            self._connection_ok = any(r[1] for r in results)
            self._connection_check_time = time.time()
        return results

    def _has_working_connection(self) -> bool:
        """True if at least one Usenet server is configured and connects (cached).
        Same servers are used when Movie Hunt (or future TV Hunt) sends NZBs here."""
        if not self.has_servers():
            return False
        with self._connection_lock:
            if time.time() - self._connection_check_time < self._connection_cache_seconds:
                return self._connection_ok
            # Cache stale – run test and update
            self._connection_check_time = time.time()
        self.configure_servers()
        results = self._nntp.test_servers()
        with self._connection_lock:
            self._connection_ok = any(r[1] for r in results)
        return self._connection_ok

    # ── Queue Management ──────────────────────────────────────────
    
    def add_nzb(self, nzb_url: str = "", nzb_content: str = "",
                name: str = "", category: str = "",
                priority: str = "normal", added_by: str = "",
                nzb_name: str = "", indexer: str = "",
                source_instance_id: str = "", source_instance_name: str = "") -> Tuple[bool, str, str]:
        """Add an NZB to the download queue.
        
        Args:
            nzb_url: URL to download NZB from
            nzb_content: NZB XML content (if already have it)
            name: Display name for the download
            category: Category for organization
            priority: Priority level
            added_by: Who added it (e.g., "movie_hunt", "tv_hunt")
            nzb_name: Original NZB filename (for tooltip display)
            indexer: Name of the indexer that provided this NZB
            source_instance_id: Instance ID of the source (Movie Hunt / TV Hunt)
            source_instance_name: Display name of the source instance
            
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

        # Duplicate detection (SABnzbd-style)
        proc = self._get_processing_settings()
        identical_on = (proc.get("identical_detection", "on") or "").lower() == "on"
        smart_on = (proc.get("smart_detection", "on") or "").lower() == "on"
        allow_proper = proc.get("allow_proper", True)

        new_hash = _nzb_content_hash(nzb_content)
        new_release_key = _release_key(name)
        bypass_smart = allow_proper and _has_proper_real_repack(name)

        with self._queue_lock:
            for existing in self._queue:
                if existing.state in (STATE_QUEUED, STATE_DOWNLOADING, STATE_PAUSED):
                    # Identical: same NZB content
                    if identical_on:
                        exist_hash = getattr(existing, "nzb_hash", "") or ""
                        if not exist_hash:
                            try:
                                content = self._load_nzb_content(existing.id)
                                if content:
                                    exist_hash = _nzb_content_hash(content)
                                    existing.nzb_hash = exist_hash
                            except Exception:
                                pass
                        if exist_hash and exist_hash == new_hash:
                            return False, f"Identical download already in queue: {existing.name[:50]}...", ""

                    # Smart: same release (unless new is PROPER/REAL/REPACK)
                    if smart_on and not bypass_smart and new_release_key:
                        exist_key = _release_key(existing.name or "")
                        if exist_key and exist_key == new_release_key:
                            return False, f"Duplicate release already in queue: {existing.name[:50]}...", ""
        
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
            source_instance_id=source_instance_id or "",
            source_instance_name=source_instance_name or "",
        )
        item.total_bytes = nzb.total_bytes
        item.total_segments = nzb.total_segments
        item.total_files = len(nzb.files)
        item.nzb_hash = new_hash

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
                if item.id == nzb_id and item.state in (STATE_QUEUED, STATE_DOWNLOADING, STATE_ASSEMBLING):
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
        """Remove an item from the queue and delete its temp/incomplete files."""
        with self._queue_lock:
            for i, item in enumerate(self._queue):
                if item.id == nzb_id:
                    self._queue.pop(i)
                    self._cleanup_temp_for_item(item)
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
                if item.state in (STATE_QUEUED, STATE_DOWNLOADING, STATE_ASSEMBLING):
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
    
    # ── Warnings System ──────────────────────────────────────────
    
    def _add_warning(self, warning_id: str, level: str, title: str, message: str):
        """Add or update a warning. Deduplicates by warning_id."""
        if warning_id in self._dismissed_warnings:
            return
        with self._warnings_lock:
            # Update existing or add new
            for w in self._warnings:
                if w["id"] == warning_id:
                    w["title"] = title
                    w["message"] = message
                    w["level"] = level
                    w["time"] = datetime.now(timezone.utc).isoformat()
                    return
            self._warnings.append({
                "id": warning_id,
                "level": level,  # "warning", "error", "info"
                "title": title,
                "message": message,
                "time": datetime.now(timezone.utc).isoformat(),
            })
    
    def _remove_warning(self, warning_id: str):
        """Remove a warning by ID (condition cleared)."""
        with self._warnings_lock:
            self._warnings = [w for w in self._warnings if w["id"] != warning_id]
    
    def _check_warnings(self, connection_stats: list):
        """Run warning detectors and update the warnings list."""
        # 1. Too many connections – server may reject or throttle
        servers = self._get_servers()
        for srv in servers:
            if not srv.get("enabled", True):
                continue
            name = srv.get("name", srv.get("host", "Server"))
            max_conns = int(srv.get("connections", 8))
            host = srv.get("host", "")
            wid = f"too_many_conns_{host}"
            if max_conns > 50:
                self._add_warning(wid, "warning",
                    f"High connection count: {name}",
                    f"{max_conns} connections configured for {name} ({host}). "
                    f"Most Usenet providers allow 20-50 connections per account. "
                    f"Too many connections can cause throttling, disconnects, or account suspension. "
                    f"Check your provider's limit."
                )
            else:
                self._remove_warning(wid)
        
        # 2. Connection failures in stats
        for stat in connection_stats:
            host = stat.get("host", "")
            active = stat.get("active", 0)
            max_c = stat.get("max", 0)
            name = stat.get("name", host)
            wid = f"conn_underutilized_{host}"
            # If we're downloading but barely using connections
            has_downloading = any(
                i.state == STATE_DOWNLOADING 
                for i in self._queue
            )
            if has_downloading and max_c > 10 and active < max_c * 0.1:
                self._add_warning(wid, "info",
                    f"Low connection utilization: {name}",
                    f"Only {active}/{max_c} connections active on {name}. "
                    f"This may indicate server-side throttling or connection issues."
                )
            else:
                self._remove_warning(wid)
        
        # 3. Disk space warning (use complete base derived from temp)
        try:
            folders = self._get_folders()
            temp_folder = folders.get("temp_folder", "/downloads/incomplete")
            dl_folder = self._temp_to_complete_base(temp_folder)
            if os.path.isdir(dl_folder):
                usage = shutil.disk_usage(dl_folder)
                free_gb = usage.free / (1024 ** 3)
                total_gb = usage.total / (1024 ** 3)
                pct_free = (usage.free / usage.total) * 100 if usage.total > 0 else 100
                wid = "low_disk_space"
                if free_gb < 5 or pct_free < 5:
                    self._add_warning(wid, "error",
                        "Low disk space",
                        f"Only {free_gb:.1f} GB ({pct_free:.0f}%) free on download volume. "
                        f"Downloads may fail if disk fills up."
                    )
                elif free_gb < 20 or pct_free < 10:
                    self._add_warning(wid, "warning",
                        "Disk space getting low",
                        f"{free_gb:.1f} GB ({pct_free:.0f}%) free on download volume."
                    )
                else:
                    self._remove_warning(wid)
        except Exception:
            pass
    
    def get_warnings(self) -> list:
        """Get current active warnings."""
        with self._warnings_lock:
            return list(self._warnings)
    
    def dismiss_warning(self, warning_id: str):
        """Dismiss a specific warning."""
        self._dismissed_warnings.add(warning_id)
        self._remove_warning(warning_id)
    
    def dismiss_all_warnings(self):
        """Dismiss all current warnings."""
        with self._warnings_lock:
            for w in self._warnings:
                self._dismissed_warnings.add(w["id"])
            self._warnings.clear()

    def get_status(self) -> dict:
        """Get overall download status."""
        with self._queue_lock:
            active = [i for i in self._queue if i.state in (STATE_DOWNLOADING, STATE_ASSEMBLING)]
            queued = [i for i in self._queue if i.state == STATE_QUEUED]
            paused = [i for i in self._queue if i.state == STATE_PAUSED]
        
        # Use rolling speed when actually downloading; 0 when only assembling/extracting
        _actually_downloading = [i for i in active if getattr(i, 'progress_pct', 0) < 100]
        total_speed = self._get_rolling_speed() if _actually_downloading else 0
        
        # Calculate remaining bytes and ETA
        total_remaining = 0
        with self._queue_lock:
            for i in self._queue:
                if i.state in (STATE_DOWNLOADING, STATE_ASSEMBLING, STATE_QUEUED):
                    total_remaining += max(0, i.total_bytes - i.downloaded_bytes)
        
        eta_seconds = int(total_remaining / total_speed) if total_speed > 0 else 0
        
        # Free disk space (use complete base derived from temp)
        free_space = 0
        free_space_human = "--"
        try:
            folders = self._get_folders()
            temp_folder = folders.get("temp_folder", "/downloads/incomplete")
            dl_folder = self._temp_to_complete_base(temp_folder)
            if os.path.isdir(dl_folder):
                usage = shutil.disk_usage(dl_folder)
                free_space = usage.free
                free_space_human = _format_bytes(free_space)
        except Exception:
            pass
        
        # Per-server bandwidth and connection stats
        bandwidth_stats = self._nntp.get_bandwidth_stats()
        connection_stats = self._nntp.get_connection_stats()
        # When worker hasn't run yet, pools are empty - show server config with 0 active
        if not connection_stats and self.has_servers():
            for srv in self._get_servers():
                if srv.get("enabled", True):
                    connection_stats.append({
                        "name": srv.get("name", srv.get("host", "Server")),
                        "host": srv.get("host", ""),
                        "active": 0,
                        "max": int(srv.get("connections", 8)),
                    })
        
        # Run warning detectors
        self._check_warnings(connection_stats)
        warnings = self.get_warnings()
        
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
            "connection_stats": connection_stats,
            "servers_configured": self.has_servers(),
            "connection_ok": self._has_working_connection(),
            "worker_running": self._running,
            "warnings": warnings,
            "warnings_count": len(warnings),
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
        """Main worker loop - processes queued downloads.
        Items stay queued until at least one Usenet server is configured and connected
        (same servers used by Movie Hunt / future TV Hunt).
        """
        logger.info("NZB Hunt download worker started")
        try:
            self.configure_servers()

            while self._running:
                # Do not start any download until we have a working server connection
                if not self.has_servers():
                    logger.debug("NZB Hunt: no servers configured, waiting...")
                    time.sleep(5)
                    continue
                if not self._has_working_connection():
                    logger.debug("NZB Hunt: no successful server connection, retrying shortly...")
                    time.sleep(5)
                    continue

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
        
        Uses a persistent per-thread NNTP connection (SABnzbd/NZBGet model).
        Each ThreadPoolExecutor worker holds its own dedicated connection for
        the entire download session, keeping all connections active and
        saturated instead of cycling get/release per article.
        
        NNTP download runs in the calling thread (I/O bound, releases GIL).
        yEnc decode runs in a separate process (CPU bound, no GIL contention).
        Retries up to max_retries times on failure (like SABnzbd's max_art_tries).
        
        Returns:
            (decoded_length, decoded_bytes_or_None, server_name)
        """
        # Check if paused
        if item.state == STATE_PAUSED or self._paused_global:
            return 0, None, ""
        
        # ── Persistent per-thread connection ──
        # On first call, acquire a dedicated connection from the pool.
        # The connection stays checked out (shows as "active" in stats) for
        # the entire download, just like SABnzbd/NZBGet do.
        conn = getattr(self._worker_conns, 'conn', None)
        pool = getattr(self._worker_conns, 'pool', None)
        
        if conn is None or conn._conn is None:
            conn, pool = self._nntp.acquire_connection(timeout=30.0)
            if conn is None:
                return 0, None, ""
            self._worker_conns.conn = conn
            self._worker_conns.pool = pool
            # Track so we can release after download finishes
            with self._held_conns_lock:
                self._held_conns.append((conn, pool))
        
        server_name = pool.server_name if pool else ""
        
        for attempt in range(max_retries):
            if item.state == STATE_PAUSED or self._paused_global:
                return 0, None, ""
            
            try:
                # Select newsgroup on our persistent connection
                if groups:
                    for group in groups:
                        if conn.select_group(group):
                            break
                
                # Download article using our held connection (I/O bound, releases GIL)
                data = conn.download_article(message_id)
                
                if data is not None:
                    if pool:
                        pool.add_bandwidth(len(data))
                    
                    # Mark connection as OK
                    with self._connection_lock:
                        self._connection_ok = True
                        self._connection_check_time = time.time()
                    
                    # Decode yEnc in-thread (fast C-level decode via sabyenc3
                    # or bytes.translate — no ProcessPoolExecutor serialization
                    # overhead, no subprocess pickling of 750KB per segment).
                    try:
                        decoded, _ = decode_yenc(data)
                        if decoded is not None and len(decoded) > 0:
                            self._rate_limiter.consume(len(decoded))
                            self._record_speed(len(decoded))
                            return len(decoded), decoded, server_name
                    except Exception:
                        pass
                
                # Article not found — retry (might be a transient issue)
            except Exception:
                # Connection broken — try to reconnect in place
                try:
                    conn.disconnect()
                    if conn.connect():
                        # Reconnected on same socket — keep using it
                        pass
                    else:
                        # Dead connection — remove from pool, get a fresh one
                        if pool:
                            with pool._lock:
                                if conn in pool._connections:
                                    pool._connections.remove(conn)
                        conn, pool = self._nntp.acquire_connection(timeout=15.0)
                        if conn is None:
                            self._worker_conns.conn = None
                            self._worker_conns.pool = None
                            return 0, None, ""
                        self._worker_conns.conn = conn
                        self._worker_conns.pool = pool
                        with self._held_conns_lock:
                            self._held_conns.append((conn, pool))
                        server_name = pool.server_name if pool else ""
                except Exception:
                    self._worker_conns.conn = None
                    self._worker_conns.pool = None
                    return 0, None, ""
            
            # Retry after a brief pause (only if not last attempt)
            if attempt < max_retries - 1:
                time.sleep(0.5 * (attempt + 1))
        
        # All retries exhausted
        return 0, None, server_name
    
    def _release_held_connections(self):
        """Release all persistent connections held by worker threads.
        
        Called after a download completes (or is aborted/paused) to return
        all connections to their pools so they show as idle in stats.
        """
        with self._held_conns_lock:
            for conn, pool in self._held_conns:
                try:
                    pool.release_connection(conn)
                except Exception:
                    pass
            self._held_conns.clear()
    
    def _process_download(self, item: DownloadItem):
        """Process a single NZB download using parallel connections."""
        item.state = STATE_DOWNLOADING
        item.started_at = datetime.now(timezone.utc).isoformat()
        # Reset all progress counters (critical after restart recovery –
        # in-memory segment data is gone, must download everything fresh)
        item.completed_segments = 0
        item.downloaded_bytes = 0
        item.completed_files = 0
        item.failed_segments = 0
        item.missing_bytes = 0
        item.speed_bps = 0
        item.eta_seconds = 0
        item.status_message = ""
        item.error_message = ""
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
            
            # Determine output directory — category subfolders under both incomplete and complete
            folders = self._get_folders()
            temp_base = folders.get("temp_folder", "/downloads/incomplete")
            if item.category:
                temp_dir = self._get_category_temp_folder(item.category) or temp_base
                download_dir = self._get_category_folder(item.category) or os.path.join(self._temp_to_complete_base(temp_base), "misc")
            else:
                temp_dir = temp_base
                download_dir = folders.get("download_folder", self._temp_to_complete_base(temp_base))
            
            # Create a directory for this download
            safe_name = "".join(c for c in item.name if c.isalnum() or c in " ._-")[:100].strip()
            if not safe_name:
                safe_name = item.id
            
            temp_path = os.path.join(temp_dir, safe_name)
            final_path = os.path.join(download_dir, safe_name)
            os.makedirs(temp_path, exist_ok=True)
            
            # Thread pool for NNTP I/O — one thread per connection (SABnzbd model).
            # Each thread holds a persistent connection, so we need as many
            # workers as total connections.  Most time is spent in socket I/O
            # (releases GIL) and sabyenc3 decode (C extension, releases GIL),
            # so many threads cause minimal GIL contention.
            max_workers = self._nntp.get_total_max_connections()
            max_workers = max(4, min(max_workers, 200))
            
            # Sort files: data files first, par2 files last (like SABnzbd)
            # This ensures the actual content downloads before recovery data
            sorted_files = sorted(nzb.files, key=lambda f: (
                1 if f.filename.lower().endswith('.par2') else 0,
                f.filename.lower()
            ))
            
            logger.info(f"[{item.id}] Starting parallel download with {max_workers} workers")
            
            # Persistent per-thread connection tracking (SABnzbd/NZBGet model).
            # Each worker thread acquires one NNTP connection on its first
            # segment and holds it for the entire download.  This keeps all
            # connections active and saturated instead of cycling per-article.
            self._worker_conns = threading.local()
            self._held_conns = []
            self._held_conns_lock = threading.Lock()
            
            # Track consecutive failed segments for early abort
            consecutive_failures = 0
            MAX_CONSECUTIVE_FAILURES = 500  # Abort if 500+ segments fail in a row
            MAX_FAILURE_PCT = float(abort_threshold_pct)  # From processing settings
            MIN_SEGMENTS_FOR_PCT_CHECK = 200  # Need at least this many before checking %
            aborted = False
            
            # ── Full-pipeline download (SABnzbd/NZBGet approach) ──
            # Submit ALL segments from ALL files into a single thread pool so
            # every connection stays saturated.  The old file-by-file approach
            # drained the pipeline between files → idle connections → low speed.
            #
            # We track which file each segment belongs to so we can still
            # assemble files in order and write them as soon as all their
            # segments are done.

            # Build global segment list with file association
            all_segments = []  # list of (file_idx, seg, groups)
            for file_idx, nzb_file in enumerate(sorted_files):
                for seg in nzb_file.segments:
                    all_segments.append((file_idx, seg, nzb_file.groups))
            
            total_segments = len(all_segments)
            logger.info(f"[{item.id}] Submitting {total_segments} segments from "
                        f"{len(sorted_files)} files into pipeline ({max_workers} workers)")
            
            # Per-file tracking
            file_segment_data = {}   # file_idx -> {seg_number -> decoded_bytes}
            file_failed_count = {}   # file_idx -> int (failed segment count)
            file_pending = {}        # file_idx -> int (segments still in flight)
            for file_idx in range(len(sorted_files)):
                file_segment_data[file_idx] = {}
                file_failed_count[file_idx] = 0
                file_pending[file_idx] = len(sorted_files[file_idx].segments)
            
            next_file_to_write = 0  # Write files in order as they complete

            executor = ThreadPoolExecutor(max_workers=max_workers)
            try:
                # Submit everything at once — the thread pool queues
                # excess work and workers pick up new segments immediately
                # when they finish (no idle time between files).
                future_to_info = {}  # future -> (file_idx, seg)
                for file_idx, seg, groups in all_segments:
                    if item.state == STATE_PAUSED or self._paused_global:
                        break
                    if aborted:
                        break
                    future = executor.submit(
                        self._download_segment,
                        seg.message_id, groups, item,
                        max_retries
                    )
                    future_to_info[future] = (file_idx, seg)
                
                # Collect results as they complete (from any file)
                for future in as_completed(future_to_info):
                    if item.state == STATE_PAUSED or self._paused_global:
                        for f in future_to_info:
                            f.cancel()
                        break
                    if aborted:
                        for f in future_to_info:
                            f.cancel()
                        break
                    
                    file_idx, seg = future_to_info[future]
                    try:
                        nbytes, decoded, server_name = future.result()
                        if decoded is not None:
                            file_segment_data[file_idx][seg.number] = decoded
                            consecutive_failures = 0  # Reset on success
                            
                            # Update progress
                            item.completed_segments += 1
                            item.downloaded_bytes = min(
                                item.total_bytes,
                                item.downloaded_bytes + nbytes
                            )
                            
                            # Update speed/ETA
                            speed = self._get_rolling_speed()
                            item.speed_bps = speed
                            remaining = max(0, item.total_bytes - item.downloaded_bytes)
                            item.eta_seconds = int(remaining / speed) if speed > 0 else 0
                            
                            # Update status message and state
                            if item.completed_segments >= total_segments:
                                item.state = STATE_ASSEMBLING
                                item.speed_bps = 0
                                item.eta_seconds = 0
                                # Assemble status with file progress
                                msg = (
                                    "Assembling files (par2 repair needed)" if item.failed_segments > 0
                                    else "Assembling files"
                                )
                                item.status_message = f"{msg} ({item.completed_files}/{len(sorted_files)})"
                            elif item.failed_segments > 0:
                                mb_missing = item.missing_bytes / (1024 * 1024)
                                if mb_missing >= 1.0:
                                    item.status_message = f"{mb_missing:.1f} MB Missing articles"
                                else:
                                    item.status_message = f"Missing articles: {item.failed_segments}"
                            
                            # Save state periodically
                            if item.completed_segments % 200 == 0:
                                self._save_state()
                        else:
                            file_failed_count[file_idx] = file_failed_count.get(file_idx, 0) + 1
                            item.failed_segments += 1
                            consecutive_failures += 1
                            item.missing_bytes += seg.bytes if seg.bytes else 0
                            
                            total_attempted = item.completed_segments + item.failed_segments
                            mb_missing = item.missing_bytes / (1024 * 1024)
                            if mb_missing >= 1.0:
                                item.status_message = f"{mb_missing:.1f} MB Missing articles"
                            else:
                                item.status_message = f"Missing articles: {item.failed_segments}"
                            
                            # Early abort checks
                            if abort_hopeless:
                                if consecutive_failures >= MAX_CONSECUTIVE_FAILURES:
                                    logger.error(
                                        f"[{item.id}] ABORTING: {consecutive_failures} consecutive "
                                        f"missing articles - content likely removed (DMCA)"
                                    )
                                    aborted = True
                                    break
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
                        file_failed_count[file_idx] = file_failed_count.get(file_idx, 0) + 1
                        item.failed_segments += 1
                        consecutive_failures += 1
                        item.missing_bytes += seg.bytes if seg.bytes else 0
                        logger.debug(f"[{item.id}] Segment {seg.number} error: {e}")
                    
                    # Decrement pending count for this file
                    file_pending[file_idx] = file_pending.get(file_idx, 1) - 1
                    
                    # Write completed files in order as they finish
                    while next_file_to_write < len(sorted_files) and file_pending.get(next_file_to_write, 0) <= 0:
                        fidx = next_file_to_write
                        nzb_file = sorted_files[fidx]
                        filename = nzb_file.filename
                        file_path = os.path.join(temp_path, filename)
                        seg_data = file_segment_data.get(fidx, {})
                        ff = file_failed_count.get(fidx, 0)
                        
                        if ff > 0:
                            logger.warning(f"[{item.id}] {ff}/{len(nzb_file.segments)} "
                                           f"segments failed for {filename}")
                        
                        # Assemble file from ordered segments
                        if ff > 0 and len(nzb_file.segments) > 0:
                            seg_sizes = {s.number: s.bytes for s in nzb_file.segments}
                            all_seg_nums = sorted(seg_sizes.keys())
                            file_data = bytearray()
                            for seg_num in all_seg_nums:
                                if seg_num in seg_data:
                                    file_data.extend(seg_data[seg_num])
                                else:
                                    gap_size = seg_sizes.get(seg_num, 0)
                                    file_data.extend(b'\x00' * gap_size)
                            logger.info(f"[{item.id}] Assembled {filename} with "
                                        f"{ff} zero-filled gaps for par2 repair")
                        else:
                            file_data = bytearray()
                            for seg_num in sorted(seg_data.keys()):
                                file_data.extend(seg_data[seg_num])
                        
                        # Write file
                        try:
                            with open(file_path, "wb") as f:
                                f.write(file_data)
                            logger.info(f"[{item.id}] Saved: {filename} "
                                        f"({len(file_data):,} bytes)")
                        except Exception as e:
                            logger.error(f"[{item.id}] Failed to write {filename}: {e}")
                        
                        # Free memory for this file's segment data
                        file_segment_data[fidx] = {}
                        
                        item.completed_files += 1
                        msg = "Assembling files (par2 repair needed)" if item.failed_segments > 0 else "Assembling files"
                        item.status_message = f"{msg} ({item.completed_files}/{len(sorted_files)})"
                        self._save_state()
                        next_file_to_write += 1
                
                # All futures done – release connections immediately so the
                # header shows 0 connections during assembly/post-processing.
                executor.shutdown(wait=False, cancel_futures=True)
                self._release_held_connections()

                # Handle pause
                if item.state == STATE_PAUSED or self._paused_global:
                    self._save_state()
                    return
                
                # Write any remaining completed files (edge case: last file(s)
                # completed but the while-loop exited before we got to them)
                while next_file_to_write < len(sorted_files):
                    if item.state == STATE_PAUSED or self._paused_global:
                        self._save_state()
                        return
                    fidx = next_file_to_write
                    nzb_file = sorted_files[fidx]
                    filename = nzb_file.filename
                    file_path = os.path.join(temp_path, filename)
                    seg_data = file_segment_data.get(fidx, {})
                    ff = file_failed_count.get(fidx, 0)
                    
                    if ff > 0 and len(nzb_file.segments) > 0:
                        seg_sizes = {s.number: s.bytes for s in nzb_file.segments}
                        all_seg_nums = sorted(seg_sizes.keys())
                        file_data = bytearray()
                        for seg_num in all_seg_nums:
                            if seg_num in seg_data:
                                file_data.extend(seg_data[seg_num])
                            else:
                                file_data.extend(b'\x00' * seg_sizes.get(seg_num, 0))
                    else:
                        file_data = bytearray()
                        for seg_num in sorted(seg_data.keys()):
                            file_data.extend(seg_data[seg_num])
                    
                    try:
                        with open(file_path, "wb") as f:
                            f.write(file_data)
                        logger.info(f"[{item.id}] Saved: {filename} ({len(file_data):,} bytes)")
                    except Exception as e:
                        logger.error(f"[{item.id}] Failed to write {filename}: {e}")
                    
                    file_segment_data[fidx] = {}
                    item.completed_files += 1
                    msg = "Assembling files (par2 repair needed)" if item.failed_segments > 0 else "Assembling files"
                    item.status_message = f"{msg} ({item.completed_files}/{len(sorted_files)})"
                    self._save_state()
                    next_file_to_write += 1
            finally:
                executor.shutdown(wait=False, cancel_futures=True)
                # Release all persistent worker connections back to pools
                self._release_held_connections()
            
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
                item.status_message = "Verifying (par2) & extracting..."
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
            self._cleanup_temp_for_item(item)
        
        # Move completed/failed items to history
        with self._queue_lock:
            if item.state in (STATE_COMPLETED, STATE_FAILED):
                self._queue = [i for i in self._queue if i.id != item.id]
                self._delete_nzb_content(item.id)  # Clean up NZB file
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
