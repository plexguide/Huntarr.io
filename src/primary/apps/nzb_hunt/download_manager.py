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
from queue import Queue, Empty
from concurrent.futures import ThreadPoolExecutor
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
    """Thread-safe token-bucket rate limiter for download speed control.
    
    Optimized to minimize lock contention under high thread counts:
    - Lock held only for the brief token arithmetic (no sleep under lock)
    - Single check-and-sleep loop instead of repeated lock acquisition
    - Early exit for unlimited mode avoids lock entirely
    """
    
    def __init__(self):
        self._lock = threading.Lock()
        self._tokens = 0.0
        self._last_refill = time.time()
        self._rate = 0  # bytes per second, 0 = unlimited
    
    def set_rate(self, bps: int):
        with self._lock:
            self._rate = max(0, bps)
            self._tokens = min(self._tokens, float(self._rate))
    
    @property
    def rate(self) -> int:
        return self._rate
    
    def consume(self, nbytes: int):
        """Block until nbytes of bandwidth are available."""
        # Fast path: unlimited mode — no lock needed
        if self._rate <= 0:
            return
        
        while True:
            sleep_time = 0.0
            with self._lock:
                if self._rate <= 0:
                    return
                
                now = time.time()
                elapsed = now - self._last_refill
                self._last_refill = now
                self._tokens += self._rate * elapsed
                self._tokens = min(self._tokens, float(self._rate * 2))
                
                if self._tokens >= nbytes:
                    self._tokens -= nbytes
                    return
                
                deficit = nbytes - self._tokens
                sleep_time = min(deficit / self._rate, 0.05)
            
            # Sleep outside lock to avoid blocking other threads
            time.sleep(sleep_time)


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
    __slots__ = (
        'id', 'seq_id', 'name', 'nzb_name', 'indexer', 'category',
        'nzb_content', 'nzb_url', 'priority', 'added_by',
        'source_instance_id', 'source_instance_name',
        'state', 'added_at', 'started_at', 'completed_at',
        'error_message', 'status_message',
        'total_bytes', 'downloaded_bytes', 'total_segments',
        'completed_segments', 'failed_segments', 'missing_bytes',
        'total_files', 'completed_files', 'speed_bps', 'eta_seconds',
        'nzb_hash',
    )
    
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
        self.missing_bytes = 0    # Estimated bytes of missing articles
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
    
    # Maximum number of history items to keep in memory (disk saves last 100)
    _MAX_HISTORY_IN_MEMORY = 200
    
    def __init__(self):
        self._queue: List[DownloadItem] = []
        self._history: List[DownloadItem] = []
        self._next_seq_id: int = 1  # Sequential download counter
        self._queue_lock = threading.RLock()
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

        # Speed tracking – rolling window with monotonic accumulator.
        # Worker threads do lock-free += on _speed_accum_bytes (monotonic).
        # The drain thread computes the delta since last flush — no read-
        # then-clear race, so speed is never under-reported.
        self._speed_lock = threading.Lock()
        self._speed_samples: deque = deque()
        self._speed_window = 3.0  # seconds
        self._speed_accum_bytes = 0       # monotonically increasing (workers +=)
        self._speed_last_flushed = 0      # last value flushed (drain thread only)
        
        # Rate limiter (token-bucket, thread-safe)
        self._rate_limiter = _RateLimiter()
        
        # Warnings system
        self._warnings: List[dict] = []
        self._warnings_lock = threading.Lock()
        self._dismissed_warnings: set = set()  # dismissed warning IDs
        
        # State save throttling
        self._state_dirty = False
        self._state_saver_running = False
        
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
            
            # Ensure NZB content files exist on disk (migration from inline)
            # NZB content is NOT kept in memory — loaded on demand when download starts
            migrated = 0
            for item in self._queue:
                content_from_file = self._load_nzb_content(item.id)
                if content_from_file:
                    pass  # Already on disk, good
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
                            self._save_nzb_content(item.id, resp.text)
                            migrated += 1
                            logger.info(f"Re-fetched NZB content for {item.name}")
                    except Exception as e:
                        logger.warning(f"Failed to re-fetch NZB for {item.name}: {e}")
                # Always clear from memory — content lives on disk
                item.nzb_content = ""
            
            # Clear nzb_content from history items too (they don't need it)
            for item in self._history:
                item.nzb_content = ""
            
            if migrated > 0:
                logger.info(f"Migrated {migrated} NZB content files to separate storage")
            
            # Reset items that were downloading when we crashed, but mark hopeless ones as FAILED
            # so they don't retry forever on restart (same bad download looping)
            proc = self._get_processing_settings()
            abort_hopeless = proc.get("abort_hopeless", True)
            try:
                abort_threshold_pct = float(proc.get("abort_threshold_pct", 5))
            except (TypeError, ValueError):
                abort_threshold_pct = 5.0
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
                self._append_history(item)
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

    def _append_history(self, item: DownloadItem):
        """Append an item to history with memory management.
        
        Clears nzb_content from the item (already saved to disk separately)
        and trims the history list to _MAX_HISTORY_IN_MEMORY to prevent
        unbounded RAM growth.
        """
        # Free NZB XML content from memory — it's saved on disk already
        item.nzb_content = ""
        self._history.append(item)
        # Trim oldest entries to prevent unbounded growth
        if len(self._history) > self._MAX_HISTORY_IN_MEMORY:
            excess = len(self._history) - self._MAX_HISTORY_IN_MEMORY
            del self._history[:excess]
    
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

    def _save_state(self, force: bool = False):
        """Persist queue state to disk (atomic write to prevent corruption).
        
        During active downloads, coalesces rapid save requests to avoid
        blocking download workers with frequent fsync.  The `force` parameter
        triggers an immediate synchronous write (used on shutdown / completion).
        
        NZB content is stored in separate files, so the main state file stays
        small and all saves are fast (~1ms instead of seconds).
        """
        if force:
            self._do_save_state()
        else:
            # Coalesce: mark dirty, spawn saver if not already running
            self._state_dirty = True
            if not getattr(self, '_state_saver_running', False):
                self._state_saver_running = True
                t = threading.Thread(target=self._bg_save_state, daemon=True,
                                     name="nzb-state-save")
                t.start()
    
    def _bg_save_state(self):
        """Background saver — keeps running while state is dirty."""
        try:
            while getattr(self, '_state_dirty', False):
                self._state_dirty = False
                self._do_save_state()
                # Brief pause to coalesce rapid saves
                time.sleep(0.1)
        finally:
            self._state_saver_running = False
    
    def _do_save_state(self):
        """Actual disk write — snapshot data under lock, write outside lock."""
        try:
            # Snapshot under lock (fast — just list copies)
            with self._queue_lock:
                data = {
                    "next_seq_id": self._next_seq_id,
                    "queue": [item.to_dict() for item in self._queue],
                    "history": [item.to_dict() for item in self._history[-100:]],
                }
            
            # Write outside lock — doesn't block API or download threads
            path = self._state_path()
            tmp_path = path + ".tmp"
            with open(tmp_path, "w") as f:
                json.dump(data, f)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp_path, path)
        except Exception as e:
            logger.error(f"Failed to save NZB Hunt state: {e}")
    
    def _load_config_safe(self) -> dict:
        """Load nzb_hunt_config.json with automatic backup recovery."""
        config_path = os.path.join(self._config_dir, "nzb_hunt_config.json")
        
        # Try primary
        if os.path.exists(config_path):
            try:
                with open(config_path, "r") as f:
                    data = json.load(f)
                if isinstance(data, dict):
                    return data
            except Exception:
                logger.warning("NZB Hunt config corrupt in download_manager, trying backup")
        
        # Try backup
        bak_path = config_path + ".bak"
        if os.path.exists(bak_path):
            try:
                with open(bak_path, "r") as f:
                    data = json.load(f)
                if isinstance(data, dict):
                    # Restore backup
                    try:
                        import shutil
                        shutil.copy2(bak_path, config_path)
                        logger.info("NZB Hunt config restored from backup in download_manager")
                    except Exception:
                        pass
                    return data
            except Exception:
                pass
        
        return {}
    
    def _get_folders(self) -> dict:
        """Get configured folder settings."""
        cfg = self._load_config_safe()
        return cfg.get("folders", {
            "download_folder": "/downloads",
            "temp_folder": "/downloads/incomplete",
        })
    
    def _get_servers(self) -> List[dict]:
        """Get configured NNTP servers."""
        cfg = self._load_config_safe()
        return cfg.get("servers", [])
    
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
            cfg = self._load_config_safe()
            limit = cfg.get("speed_limit_bps", 0)
            self._rate_limiter.set_rate(limit)
        except Exception:
            pass
    
    def set_speed_limit(self, bps: int):
        """Set download speed limit in bytes/sec.  0 = unlimited."""
        bps = max(0, bps)
        self._rate_limiter.set_rate(bps)
        # Persist to config — must read-modify-write safely
        try:
            config_path = os.path.join(self._config_dir, "nzb_hunt_config.json")
            cfg = None
            if os.path.exists(config_path):
                try:
                    with open(config_path, "r") as f:
                        cfg = json.load(f)
                except Exception:
                    cfg = None
            
            if cfg is None or not isinstance(cfg, dict):
                # Config unreadable — only update speed limit, don't wipe
                # Try backup
                bak_path = config_path + ".bak"
                if os.path.exists(bak_path):
                    try:
                        with open(bak_path, "r") as f:
                            cfg = json.load(f)
                    except Exception:
                        pass
                if cfg is None or not isinstance(cfg, dict):
                    logger.warning("Cannot save speed limit: config file unreadable, skipping to avoid data loss")
                    return
            
            cfg["speed_limit_bps"] = bps
            # Atomic write
            tmp_path = config_path + ".tmp"
            with open(tmp_path, "w") as f:
                json.dump(cfg, f, indent=2)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp_path, config_path)
        except Exception as e:
            logger.error(f"Failed to save speed limit: {e}")
    
    def get_speed_limit(self) -> int:
        """Get current speed limit in bytes/sec (0 = unlimited)."""
        return self._rate_limiter.rate
    
    # ── Rolling Speed ─────────────────────────────────────────────
    
    def _record_speed(self, nbytes: int):
        """Record downloaded bytes — lock-free, called from worker threads."""
        self._speed_accum_bytes += nbytes
    
    def _get_rolling_speed(self) -> int:
        """Return current speed in bytes/sec from rolling window.
        
        Uses monotonic accumulator: reads the current total, computes
        delta since last flush.  No read-then-clear race — speed is
        never under-reported even under heavy thread contention.
        """
        now = time.time()
        # Delta since last flush (monotonic — never loses bytes)
        current = self._speed_accum_bytes
        delta = current - self._speed_last_flushed
        if delta > 0:
            self._speed_last_flushed = current
            with self._speed_lock:
                self._speed_samples.append((now, delta))
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
                return total
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
        Same servers are used when Movie Hunt (or future TV Hunt) sends NZBs here.
        
        Uses a cached result to avoid repeated test_connection() overhead.
        Cache TTL is 60 seconds.  Does NOT call configure_servers() to avoid
        destroying live connection pools during active downloads.
        """
        if not self.has_servers():
            return False
        with self._connection_lock:
            if time.time() - self._connection_check_time < 60:
                return self._connection_ok
            self._connection_check_time = time.time()
        # Only configure pools if they're empty (first check or after reset)
        if not self._nntp.has_servers():
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

        # Duplicate detection
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
        # Clear from DownloadItem memory — content is on disk now, loaded on demand
        item.nzb_content = ""
        
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

    def delete_history_item(self, nzb_id: str):
        """Remove a single item from history by id."""
        with self._queue_lock:
            self._history = [h for h in self._history if h.id != nzb_id]
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
        """Run warning detectors and update the warnings list.
        
        Only raises warnings based on actual server errors/behaviour,
        not superficial heuristics like configured connection counts.
        """
        # 1. Connection failures in stats
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
            "connection_ok": self._connection_ok or self._running,
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
        
        Connections are kept alive between downloads to eliminate SSL
        handshake overhead (3-5 seconds per connection × 30 connections =
        90-150 seconds wasted between NZBs).  Connections are only closed
        when the worker exits (no more work).
        
        On startup, retries server configuration with exponential backoff
        (1s → 2s → 4s → 8s → 10s max) instead of looping with fixed 5s
        delays that could keep the queue stuck for minutes.
        """
        logger.info("NZB Hunt download worker started")
        try:
            # ── Startup: configure servers with retry ──
            # After a container restart the config file may not be ready
            # immediately.  Retry with backoff instead of giving up.
            server_backoff = 1.0
            servers_ready = False
            while self._running and not servers_ready:
                servers = self._get_servers()
                if servers:
                    self._nntp.configure(servers)
                    # Quick connection test (don't use cached result)
                    results = self._nntp.test_servers()
                    if any(r[1] for r in results):
                        with self._connection_lock:
                            self._connection_ok = True
                            self._connection_check_time = time.time()
                        servers_ready = True
                        logger.info("NZB Hunt: server connection verified, starting downloads")
                    else:
                        logger.warning("NZB Hunt: servers configured but connection test failed, "
                                       f"retrying in {server_backoff:.0f}s...")
                        time.sleep(server_backoff)
                        server_backoff = min(server_backoff * 2, 10.0)
                else:
                    logger.debug("NZB Hunt: no servers in config, waiting %.0fs...", server_backoff)
                    time.sleep(server_backoff)
                    server_backoff = min(server_backoff * 2, 10.0)

            while self._running:
                # Re-check server config periodically (handles config changes)
                if not self._nntp.has_servers():
                    servers = self._get_servers()
                    if servers:
                        self._nntp.configure(servers)
                    else:
                        logger.debug("NZB Hunt: no servers configured, waiting...")
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
                    break

                self._process_download(item)
                
                # Don't close connections — they'll be reused for next download
        except Exception as e:
            logger.error(f"Worker loop error: {e}")
        finally:
            self._running = False
            self._nntp._reset_active()
            self._nntp.close_all()
            logger.info("NZB Hunt download worker stopped")
    
    def _download_segment(self, message_id: str, groups: List[str],
                           item: DownloadItem,
                           max_retries: int = 3) -> Tuple[int, Optional[bytes], str, Optional[int], Optional[int]]:
        """Download and decode a single segment with retry logic.
        
        Uses a persistent per-thread NNTP connection. Each ThreadPoolExecutor
        worker holds its own dedicated connection for the entire download
        session, keeping all connections active and saturated instead of
        cycling get/release per article.
        
        NNTP download runs in the calling thread (I/O bound, releases GIL).
        yEnc decode runs in-thread via sabyenc3 C extension or fast translate.
        Retries up to max_retries times on failure.
        
        Returns:
            (decoded_length, decoded_bytes_or_None, server_name,
             yenc_begin_or_None, yenc_file_size_or_None)
             yenc_begin: 1-based byte offset in the output file (for direct write)
             yenc_file_size: total decoded file size (for pre-allocation)
        """
        # Check if paused
        if item.state == STATE_PAUSED or self._paused_global:
            return 0, None, "", None, None
        
        # ── Persistent per-thread connection ──
        # On first call, acquire a dedicated connection from the pool.
        # The connection stays checked out (shows as "active" in stats) for
        # the entire download.
        conn = getattr(self._worker_conns, 'conn', None)
        pool = getattr(self._worker_conns, 'pool', None)
        
        if conn is None or conn._conn is None:
            conn, pool = self._nntp.acquire_connection(timeout=30.0)
            if conn is None:
                return 0, None, "", None, None
            self._worker_conns.conn = conn
            self._worker_conns.pool = pool
            # Track so we can release after download finishes
            with self._held_conns_lock:
                self._held_conns.append((conn, pool))
        
        server_name = pool.server_name if pool else ""
        
        for attempt in range(max_retries):
            if item.state == STATE_PAUSED or self._paused_global:
                return 0, None, "", None, None
            
            try:
                # Select newsgroup — NNTPConnection caches current group
                # so this is a no-op when already in the right group.
                if groups:
                    for group in groups:
                        if conn.select_group(group):
                            break
                
                data = conn.download_article(message_id)
                
                if data is not None:
                    if pool:
                        pool.add_bandwidth(len(data))
                    
                    # Mark connection as OK (skip lock if already set)
                    if not self._connection_ok:
                        self._connection_ok = True
                        self._connection_check_time = time.time()
                    
                    # Decode yEnc in-thread (fast C-level decode via sabyenc3
                    # or bytes.translate — no ProcessPoolExecutor serialization
                    # overhead, no subprocess pickling of 750KB per segment).
                    try:
                        decoded, yenc_hdr = decode_yenc(data)
                        # Free raw article bytes — only decoded data is needed
                        del data
                        if decoded is not None and len(decoded) > 0:
                            self._rate_limiter.consume(len(decoded))
                            self._record_speed(len(decoded))
                            yenc_begin = yenc_hdr.get("begin")
                            yenc_size = yenc_hdr.get("size")
                            return len(decoded), decoded, server_name, yenc_begin, yenc_size
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
                            self._nntp._dec_active(pool.host)
                        conn, pool = self._nntp.acquire_connection(timeout=15.0)
                        if conn is None:
                            self._worker_conns.conn = None
                            self._worker_conns.pool = None
                            return 0, None, "", None, None
                        self._worker_conns.conn = conn
                        self._worker_conns.pool = pool
                        with self._held_conns_lock:
                            self._held_conns.append((conn, pool))
                        server_name = pool.server_name if pool else ""
                except Exception:
                    self._worker_conns.conn = None
                    self._worker_conns.pool = None
                    return 0, None, "", None, None
            
            # Retry after a brief pause (only if not last attempt)
            if attempt < max_retries - 1:
                time.sleep(0.5 * (attempt + 1))
        
        # All retries exhausted
        return 0, None, server_name, None, None
    
    def _release_held_connections(self):
        """Release all persistent connections held by worker threads.
        
        Called after a download completes (or is aborted/paused) to return
        all connections to their pools so they show as idle in stats.
        """
        with self._held_conns_lock:
            for conn, pool in self._held_conns:
                try:
                    pool.release_connection(conn)
                    self._nntp._dec_active(pool.host)
                except Exception:
                    pass
            self._held_conns.clear()
    
    def _assemble_file_from_cache(self, item, sorted_files, file_idx,
                                    seg_cache_dir, temp_path, file_failed_count):
        """Assemble a single file by reading cached segments from disk.
        
        Streams segments sequentially from disk to the output file, using
        only a small buffer instead of loading the entire file into RAM.
        """
        nzb_file = sorted_files[file_idx]
        filename = nzb_file.filename
        file_path = os.path.join(temp_path, filename)
        ff = file_failed_count.get(file_idx, 0)
        seg_dir = os.path.join(seg_cache_dir, str(file_idx))
        
        if ff > 0:
            logger.warning(f"[{item.id}] {ff}/{len(nzb_file.segments)} "
                           f"segments failed for {filename}")
        
        # Stream-assemble: read each segment from disk in order, write to file
        try:
            with open(file_path, "wb") as out_f:
                seg_sizes = {s.number: s.bytes for s in nzb_file.segments}
                for seg_num in sorted(seg_sizes.keys()):
                    seg_path = os.path.join(seg_dir, f"{seg_num}.seg")
                    if os.path.exists(seg_path):
                        with open(seg_path, "rb") as sf:
                            while True:
                                chunk = sf.read(1048576)  # 1MB chunks
                                if not chunk:
                                    break
                                out_f.write(chunk)
                    elif ff > 0:
                        # Zero-fill gap for par2 repair
                        gap_size = seg_sizes.get(seg_num, 0)
                        if gap_size > 0:
                            out_f.write(b'\x00' * gap_size)
            
            total_size = os.path.getsize(file_path) if os.path.exists(file_path) else 0
            if ff > 0:
                logger.info(f"[{item.id}] Assembled {filename} with "
                            f"{ff} zero-filled gaps ({total_size:,} bytes)")
            else:
                logger.info(f"[{item.id}] Saved: {filename} ({total_size:,} bytes)")
        except Exception as e:
            logger.error(f"[{item.id}] Failed to write {filename}: {e}")
        
        # Clean up segment cache for this file immediately to free disk space
        try:
            shutil.rmtree(seg_dir, ignore_errors=True)
        except Exception:
            pass
        
        item.completed_files += 1
        msg = "Assembling files (par2 repair needed)" if item.failed_segments > 0 else "Assembling files"
        item.status_message = f"{msg} ({item.completed_files}/{len(sorted_files)})"
        self._save_state()
    
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
            
            # Load NZB content from disk (not kept in memory to save RAM)
            nzb_content = item.nzb_content or self._load_nzb_content(item.id)
            if not nzb_content:
                raise RuntimeError("NZB content not found on disk or in memory")
            nzb = parse_nzb(nzb_content)
            # Free the NZB XML string immediately after parsing
            del nzb_content
            item.nzb_content = ""
            
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
            
            # Thread pool for NNTP I/O — one thread per connection.
            # Each thread holds a persistent connection, so we need as many
            # workers as total connections.  Most time is spent in socket I/O
            # (releases GIL) and sabyenc3 decode (C extension, releases GIL),
            # so many threads cause minimal GIL contention.
            max_workers = self._nntp.get_total_max_connections()
            max_workers = max(4, min(max_workers, 500))
            
            # Sort files: data files first, par2 files last
            # This ensures the actual content downloads before recovery data
            sorted_files = sorted(nzb.files, key=lambda f: (
                1 if f.filename.lower().endswith('.par2') else 0,
                f.filename.lower()
            ))
            
            logger.info(f"[{item.id}] Starting parallel download with {max_workers} workers")
            
            # Persistent per-thread connection tracking.
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
            
            # ── High-performance Direct-Write pipeline ──
            #
            # Key design decisions for maximum throughput:
            #
            # 1. Completion Queue (O(1) drain, no as_completed overhead)
            # 2. os.pwrite() — single atomic syscall, no buffering layer
            # 3. NO pre-allocation — posix_fallocate on FUSE/btrfs writes
            #    zeros for the entire file (8GB = 8GB of zeros = 30s stall).
            #    pwrite() extends the file automatically; sparse holes are
            #    zero-filled by the OS and perfect for par2 repair.
            # 4. Pre-open ALL fds before download — no mkdir/open in drain path
            # 5. Batch drain — drain ALL available futures per cycle
            # 6. O(1) file completion, list-based tracking, time-based saves

            seg_cache_dir = os.path.join(temp_path, "_segments")

            def _segment_iter():
                for fi, nzb_file in enumerate(sorted_files):
                    for seg in nzb_file.segments:
                        yield (fi, seg, nzb_file.groups)

            n_files = len(sorted_files)
            total_segments = sum(len(f.segments) for f in sorted_files)
            logger.info(f"[{item.id}] Downloading {total_segments} segments from "
                        f"{n_files} files ({max_workers} workers) [DirectWrite v3]")

            # ── List-based per-file tracking ──
            file_completed  = [0] * n_files
            file_failed_cnt = [0] * n_files
            file_total_segs = [len(sorted_files[i].segments) for i in range(n_files)]
            file_handled    = [False] * n_files

            _last_save_time = time.time()
            _SAVE_INTERVAL  = 5.0

            # ── Direct-Write via OS file descriptors ──
            _has_pwrite = hasattr(os, 'pwrite')
            dw_fds      = [None] * n_files  # raw OS fd (int) or None
            dw_fhs      = [None] * n_files  # Python file obj (pwrite fallback)
            dw_used     = [False] * n_files
            dw_max_pos  = [0] * n_files
            dw_fallback = set()

            # ── Pre-open ALL output files before download starts ──
            # This moves all mkdir + open() syscalls OUT of the drain loop.
            # No pre-allocation (no fallocate/truncate) — pwrite extends
            # the file on demand; the OS handles sparse regions.
            for _pre_fi in range(n_files):
                try:
                    fpath = os.path.join(temp_path, sorted_files[_pre_fi].filename)
                    fdir = os.path.dirname(fpath)
                    if fdir and fdir != temp_path:
                        os.makedirs(fdir, exist_ok=True)
                    if _has_pwrite:
                        dw_fds[_pre_fi] = os.open(fpath, os.O_CREAT | os.O_RDWR, 0o644)
                    else:
                        dw_fhs[_pre_fi] = open(fpath, "wb+", buffering=1 << 20)
                except Exception as _oe:
                    logger.debug(f"[{item.id}] Pre-open failed for file {_pre_fi}: {_oe}")

            def _dw_write(fi, offset, data):
                """Write data at offset. pwrite = 1 syscall, no seek."""
                fd = dw_fds[fi]
                if fd is not None:
                    os.pwrite(fd, data, offset)
                else:
                    fh = dw_fhs[fi]
                    if fh is not None:
                        fh.seek(offset)
                        fh.write(data)

            def _dw_finalize(fi):
                """Close a direct-write file, truncate to actual written extent."""
                fd = dw_fds[fi]
                if fd is not None:
                    try:
                        max_pos = dw_max_pos[fi]
                        if max_pos > 0:
                            os.ftruncate(fd, max_pos)
                        os.close(fd)
                    except Exception:
                        pass
                    dw_fds[fi] = None
                fh = dw_fhs[fi]
                if fh is not None:
                    try:
                        max_pos = dw_max_pos[fi]
                        if max_pos > 0:
                            fh.truncate(max_pos)
                        fh.close()
                    except Exception:
                        pass
                    dw_fhs[fi] = None

            def _dw_close_all():
                for fi in range(n_files):
                    _dw_finalize(fi)

            def _seg_cache_write(fi, seg_d, decoded):
                """Fallback: write segment to cache file."""
                dw_fallback.add(fi)
                fsd = os.path.join(seg_cache_dir, str(fi))
                os.makedirs(fsd, exist_ok=True)
                seg_path = os.path.join(fsd, f"{seg_d.number}.seg")
                with open(seg_path, "wb") as sf:
                    sf.write(decoded)

            max_inflight = max(max_workers * 4, 128)

            # ── Completion Queue ──
            done_q: Queue = Queue()

            def _on_done(fut):
                done_q.put_nowait(fut)

            executor = ThreadPoolExecutor(max_workers=max_workers)
            try:
                pending = {}
                seg_source = _segment_iter()
                segments_exhausted = False

                def _process_future(future):
                    """Process one completed future. Returns False if aborted."""
                    nonlocal aborted, consecutive_failures, _last_save_time

                    if future not in pending:
                        return True
                    file_idx_d, seg_d = pending.pop(future)

                    try:
                        nbytes, decoded, server_name, yenc_begin, yenc_size = future.result()
                        future._result = None

                        if decoded is not None:
                            if yenc_begin is not None and yenc_begin > 0:
                                try:
                                    _dw_write(file_idx_d, yenc_begin - 1, decoded)
                                    dw_used[file_idx_d] = True
                                    end_pos = yenc_begin - 1 + len(decoded)
                                    if end_pos > dw_max_pos[file_idx_d]:
                                        dw_max_pos[file_idx_d] = end_pos
                                except Exception as we:
                                    logger.debug(f"[{item.id}] pwrite failed, using cache: {we}")
                                    try:
                                        _seg_cache_write(file_idx_d, seg_d, decoded)
                                    except Exception as we2:
                                        logger.error(f"[{item.id}] Segment cache also failed: {we2}")
                            else:
                                try:
                                    _seg_cache_write(file_idx_d, seg_d, decoded)
                                except Exception as we:
                                    logger.error(f"[{item.id}] Failed to cache segment: {we}")
                            del decoded

                            file_completed[file_idx_d] += 1
                            consecutive_failures = 0

                            item.completed_segments += 1
                            item.downloaded_bytes = min(
                                item.total_bytes,
                                item.downloaded_bytes + nbytes
                            )

                            if item.completed_segments & 15 == 0:
                                speed = self._get_rolling_speed()
                                item.speed_bps = speed
                                remaining = max(0, item.total_bytes - item.downloaded_bytes)
                                item.eta_seconds = int(remaining / speed) if speed > 0 else 0

                            if item.completed_segments + item.failed_segments >= total_segments:
                                item.state = STATE_ASSEMBLING
                                item.speed_bps = 0
                                item.eta_seconds = 0
                                msg = (
                                    "Assembling files (par2 repair needed)" if item.failed_segments > 0
                                    else "Assembling files"
                                )
                                item.status_message = f"{msg} ({item.completed_files}/{n_files})"
                            elif item.failed_segments > 0:
                                mb_missing = item.missing_bytes / (1024 * 1024)
                                if mb_missing >= 1.0:
                                    item.status_message = f"{mb_missing:.1f} MB Missing articles"
                                else:
                                    item.status_message = f"Missing articles: {item.failed_segments}"

                            now = time.time()
                            if now - _last_save_time >= _SAVE_INTERVAL:
                                _last_save_time = now
                                self._save_state()

                            # O(1) file completion check
                            if (not file_handled[file_idx_d] and
                                    file_completed[file_idx_d] >= file_total_segs[file_idx_d]):
                                file_handled[file_idx_d] = True
                                if dw_used[file_idx_d] and file_idx_d not in dw_fallback:
                                    _dw_finalize(file_idx_d)
                                    item.completed_files += 1
                                    ff = file_failed_cnt[file_idx_d]
                                    fname = sorted_files[file_idx_d].filename
                                    fpath = os.path.join(temp_path, fname)
                                    fsize = os.path.getsize(fpath) if os.path.exists(fpath) else 0
                                    if ff > 0:
                                        logger.info(f"[{item.id}] DirectWrite: {fname} ({fsize:,} bytes, {ff} gaps)")
                                    else:
                                        logger.info(f"[{item.id}] DirectWrite: {fname} ({fsize:,} bytes)")
                                    msg = "Assembling files (par2 repair needed)" if item.failed_segments > 0 else "Assembling files"
                                    item.status_message = f"{msg} ({item.completed_files}/{n_files})"
                                elif file_idx_d in dw_fallback:
                                    _dw_finalize(file_idx_d)
                                    if dw_used[file_idx_d]:
                                        try:
                                            p = os.path.join(temp_path, sorted_files[file_idx_d].filename)
                                            if os.path.exists(p):
                                                os.remove(p)
                                        except Exception:
                                            pass
                                    self._assemble_file_from_cache(
                                        item, sorted_files, file_idx_d,
                                        seg_cache_dir, temp_path,
                                        {file_idx_d: file_failed_cnt[file_idx_d]}
                                    )
                        else:
                            file_failed_cnt[file_idx_d] += 1
                            file_completed[file_idx_d] += 1
                            item.failed_segments += 1
                            consecutive_failures += 1
                            item.missing_bytes += seg_d.bytes if seg_d.bytes else 0

                            mb_missing = item.missing_bytes / (1024 * 1024)
                            if mb_missing >= 1.0:
                                item.status_message = f"{mb_missing:.1f} MB Missing articles"
                            else:
                                item.status_message = f"Missing articles: {item.failed_segments}"

                            if abort_hopeless:
                                if consecutive_failures >= MAX_CONSECUTIVE_FAILURES:
                                    logger.error(
                                        f"[{item.id}] ABORTING: {consecutive_failures} consecutive "
                                        f"missing articles - content likely removed (DMCA)"
                                    )
                                    aborted = True
                                total_attempted = item.completed_segments + item.failed_segments
                                if not aborted and total_attempted >= MIN_SEGMENTS_FOR_PCT_CHECK:
                                    fail_pct = (item.failed_segments / total_attempted) * 100
                                    if fail_pct > MAX_FAILURE_PCT:
                                        logger.error(
                                            f"[{item.id}] ABORTING: {fail_pct:.1f}% segments "
                                            f"missing ({item.failed_segments}/{total_attempted}) "
                                            f"- download cannot be completed"
                                        )
                                        aborted = True

                            if (not file_handled[file_idx_d] and
                                    file_completed[file_idx_d] >= file_total_segs[file_idx_d]):
                                file_handled[file_idx_d] = True
                                if dw_used[file_idx_d] and file_idx_d not in dw_fallback:
                                    _dw_finalize(file_idx_d)
                                    item.completed_files += 1
                                    fname = sorted_files[file_idx_d].filename
                                    logger.info(f"[{item.id}] DirectWrite: {fname} ({file_failed_cnt[file_idx_d]} failed segs)")
                                    msg = "Assembling files (par2 repair needed)" if item.failed_segments > 0 else "Assembling files"
                                    item.status_message = f"{msg} ({item.completed_files}/{n_files})"
                                elif file_idx_d in dw_fallback:
                                    _dw_finalize(file_idx_d)
                                    self._assemble_file_from_cache(
                                        item, sorted_files, file_idx_d,
                                        seg_cache_dir, temp_path,
                                        {file_idx_d: file_failed_cnt[file_idx_d]}
                                    )

                    except MemoryError:
                        logger.error(f"[{item.id}] Out of memory — pausing downloads")
                        self._paused_global = True
                        aborted = True
                    except Exception as e:
                        file_failed_cnt[file_idx_d] += 1
                        file_completed[file_idx_d] += 1
                        item.failed_segments += 1
                        consecutive_failures += 1
                        item.missing_bytes += seg_d.bytes if seg_d.bytes else 0
                        logger.debug(f"[{item.id}] Segment {seg_d.number} error: {e}")

                    future = None
                    return not aborted

                # ── Main download loop: batch-drain + batch-submit ──
                while not segments_exhausted and not aborted:
                    if item.state == STATE_PAUSED or self._paused_global:
                        break

                    # Fill submission window
                    while len(pending) < max_inflight and not segments_exhausted:
                        if item.state == STATE_PAUSED or self._paused_global:
                            break
                        if aborted:
                            break
                        try:
                            file_idx, seg, groups = next(seg_source)
                            future = executor.submit(
                                self._download_segment,
                                seg.message_id, groups, item,
                                max_retries
                            )
                            future.add_done_callback(_on_done)
                            pending[future] = (file_idx, seg)
                            future = None
                        except StopIteration:
                            segments_exhausted = True
                            break

                    # ── Batch drain: process ALL available completed futures ──
                    # Block for the first one, then drain everything else
                    # that's ready without blocking.  This catches up fast
                    # after any stall and keeps workers fully saturated.
                    if pending:
                        first = done_q.get()  # block for at least one
                        if not _process_future(first):
                            break
                        # Drain all others that are already done (non-blocking)
                        while not done_q.empty() and pending:
                            try:
                                fut = done_q.get_nowait()
                                if not _process_future(fut):
                                    aborted = True
                                    break
                            except Empty:
                                break

                # Drain remaining
                while pending and not (item.state == STATE_PAUSED or self._paused_global):
                    fut = done_q.get()
                    if not _process_future(fut):
                        break

                # Cancel outstanding
                if pending:
                    for f in pending:
                        f.cancel()
                    pending.clear()

                executor.shutdown(wait=False, cancel_futures=True)
                self._release_held_connections()
                _dw_close_all()

                if item.state == STATE_PAUSED or self._paused_global:
                    self._save_state(force=True)
                    return

                # Assemble any remaining fallback files
                for fi_rem in range(n_files):
                    if file_handled[fi_rem]:
                        continue
                    if item.state == STATE_PAUSED or self._paused_global:
                        self._save_state(force=True)
                        return
                    if fi_rem in dw_fallback:
                        self._assemble_file_from_cache(
                            item, sorted_files, fi_rem,
                            seg_cache_dir, temp_path,
                            {fi_rem: file_failed_cnt[fi_rem]}
                        )

                if dw_fallback:
                    try:
                        shutil.rmtree(seg_cache_dir, ignore_errors=True)
                    except Exception:
                        pass

                dw_count = sum(1 for fi in range(n_files)
                               if dw_used[fi] and fi not in dw_fallback)
                logger.info(f"[{item.id}] Write stats: {dw_count} direct-write, "
                            f"{len(dw_fallback)} fallback-assembled")
            finally:
                _dw_close_all()
                executor.shutdown(wait=False, cancel_futures=True)
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
                    self._append_history(item)
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
            # Run in a background thread so the next download can start
            # immediately without waiting for par2/extraction to complete.
            # This is a major throughput improvement — post-processing a
            # 50GB download can take 10+ minutes.
            item.state = STATE_EXTRACTING
            if item.failed_segments > 0:
                ext_mb = item.missing_bytes / (1024 * 1024)
                ext_mb_str = f"{ext_mb:.1f} MB" if ext_mb >= 1.0 else f"{item.failed_segments} segments"
                item.status_message = f"Verifying & repairing ({ext_mb_str} missing articles)..."
            else:
                item.status_message = "Verifying (par2) & extracting..."
            self._save_state(force=True)
            logger.info(f"[{item.id}] Starting post-processing for {item.name}")
            
            pp_thread = threading.Thread(
                target=self._post_process_async,
                args=(item, temp_path, final_path),
                name=f"nzb-pp-{item.id[:8]}",
                daemon=True,
            )
            pp_thread.start()
            # Worker continues to next download immediately
            return
            
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
                self._delete_nzb_content(item.id)
                self._append_history(item)
            self._save_state(force=True)
    
    def _post_process_async(self, item: DownloadItem, temp_path: str, final_path: str):
        """Run post-processing in a background thread.
        
        Handles par2 repair, archive extraction, file move, and status updates.
        Runs independently so the download worker can start the next NZB.
        """
        try:
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
                try:
                    shutil.rmtree(temp_path, ignore_errors=True)
                except Exception:
                    pass
                with self._queue_lock:
                    self._queue = [i for i in self._queue if i.id != item.id]
                    self._delete_nzb_content(item.id)
                    self._append_history(item)
                    self._save_state(force=True)
                return
            
            # Move from temp to final destination
            try:
                if temp_path != final_path:
                    os.makedirs(os.path.dirname(final_path), exist_ok=True)
                    if os.path.exists(final_path):
                        for f_name in os.listdir(temp_path):
                            src = os.path.join(temp_path, f_name)
                            dst = os.path.join(final_path, f_name)
                            shutil.move(src, dst)
                        shutil.rmtree(temp_path, ignore_errors=True)
                    else:
                        shutil.move(temp_path, final_path)
            except Exception as e:
                logger.error(f"[{item.id}] Failed to move to final path: {e}")
            
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
            logger.error(f"[{item.id}] Post-processing error: {e}")
            try:
                shutil.rmtree(temp_path, ignore_errors=True)
            except Exception:
                pass
        
        # Move to history
        with self._queue_lock:
            if item.state in (STATE_COMPLETED, STATE_FAILED):
                self._queue = [i for i in self._queue if i.id != item.id]
                self._delete_nzb_content(item.id)
                self._append_history(item)
            self._save_state(force=True)
    
    def stop(self):
        """Stop the download worker."""
        self._running = False
        if self._worker_thread and self._worker_thread.is_alive():
            self._worker_thread.join(timeout=10)
        self._nntp._reset_active()
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
