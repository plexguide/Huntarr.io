"""
Tor Hunt – Built-in BitTorrent download engine.

This is the real engine that runs inside the child process (own GIL).
The web server process uses TorHuntProxy from tor_hunt_process.py.

Uses libtorrent (C library with Python bindings) for the BitTorrent
protocol — the same library used by most torrent clients.
"""

import os
import sys
import time
import json
import uuid
import threading
from typing import Optional, Dict, List, Any, Tuple

import libtorrent as lt

from src.primary.utils.logger import get_logger
from src.primary.utils.config_paths import CONFIG_DIR

logger = get_logger("tor_hunt_engine")

DEFAULT_LISTEN_PORT = 6881
DEFAULT_DOWNLOAD_DIR = "/downloads/tor-hunt"
DEFAULT_TEMP_DIR = "/downloads/tor-hunt/incomplete"


class TorrentItem:
    """Represents a single torrent in the queue."""

    def __init__(self, torrent_id: str, name: str, info_hash: str,
                 category: str = "", added_on: float = 0, save_path: str = ""):
        self.id = torrent_id
        self.name = name
        self.info_hash = info_hash
        self.category = category
        self.added_on = added_on or time.time()
        self.save_path = save_path
        self.status = "downloading"  # downloading, paused, checking, seeding, completed, error
        self.error_msg = ""
        self.size = 0
        self.downloaded = 0
        self.uploaded = 0
        self.progress = 0.0
        self.dl_speed = 0
        self.up_speed = 0
        self.num_seeds = 0
        self.num_peers = 0
        self.eta_seconds = 0
        self.completion_on = 0
        self.ratio = 0.0
        self.content_path = ""

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "hash": self.info_hash,
            "name": self.name,
            "category": self.category,
            "added_on": self.added_on,
            "save_path": self.save_path,
            "status": self.status,
            "error_msg": self.error_msg,
            "size": self.size,
            "size_str": _format_bytes(self.size),
            "downloaded": self.downloaded,
            "uploaded": self.uploaded,
            "progress": round(self.progress * 100, 1),
            "progress_str": f"{self.progress * 100:.1f}%",
            "dl_speed": self.dl_speed,
            "dl_speed_str": _format_speed(self.dl_speed),
            "up_speed": self.up_speed,
            "up_speed_str": _format_speed(self.up_speed),
            "num_seeds": self.num_seeds,
            "num_peers": self.num_peers,
            "time_left": _format_eta(self.eta_seconds),
            "eta_seconds": self.eta_seconds,
            "completion_on": self.completion_on,
            "ratio": round(self.ratio, 2),
            "content_path": self.content_path,
            "state": self.status.capitalize(),
            "raw_state": self.status,
        }

    @classmethod
    def from_dict(cls, d: dict) -> 'TorrentItem':
        item = cls(
            torrent_id=d.get("id", ""),
            name=d.get("name", ""),
            info_hash=d.get("hash", ""),
            category=d.get("category", ""),
            added_on=d.get("added_on", 0),
            save_path=d.get("save_path", ""),
        )
        item.status = d.get("status", "downloading")
        item.error_msg = d.get("error_msg", "")
        item.size = d.get("size", 0)
        item.downloaded = d.get("downloaded", 0)
        item.uploaded = d.get("uploaded", 0)
        item.progress = d.get("progress", 0) / 100.0 if d.get("progress", 0) > 1 else d.get("progress", 0)
        item.dl_speed = d.get("dl_speed", 0)
        item.up_speed = d.get("up_speed", 0)
        item.num_seeds = d.get("num_seeds", 0)
        item.num_peers = d.get("num_peers", 0)
        item.eta_seconds = d.get("eta_seconds", 0)
        item.completion_on = d.get("completion_on", 0)
        item.ratio = d.get("ratio", 0)
        item.content_path = d.get("content_path", "")
        return item


class TorHuntEngine:
    """Built-in BitTorrent download engine using libtorrent."""

    _instance = None
    _inst_lock = threading.Lock()

    @classmethod
    def get_instance(cls) -> 'TorHuntEngine':
        if cls._instance is None:
            with cls._inst_lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance

    def __init__(self):
        self._session: Optional[lt.session] = None
        self._handles: Dict[str, lt.torrent_handle] = {}  # info_hash_hex -> handle
        self._items: Dict[str, TorrentItem] = {}  # torrent_id -> TorrentItem
        self._hash_to_id: Dict[str, str] = {}  # info_hash_hex -> torrent_id
        self._history: List[dict] = []
        self._known_completed: set = set()
        self._config: Dict[str, Any] = {}
        self._speed_limit: int = 0
        self._lock = threading.Lock()
        self._running = False
        self._paused_global = False

        self._load_config()
        self._load_history()
        self._init_session()
        self._load_state()
        self._running = True
        logger.info("Tor Hunt engine initialized")

    # ── Session setup ──

    def _init_session(self):
        """Initialize libtorrent session."""
        port = self._config.get("listen_port", DEFAULT_LISTEN_PORT)
        settings = {
            'listen_interfaces': f'0.0.0.0:{port},[::0]:{port}',
            'enable_dht': True,
            'enable_lsd': True,
            'enable_natpmp': True,
            'enable_upnp': True,
            'alert_mask': (
                lt.alert.category_t.error_notification |
                lt.alert.category_t.status_notification |
                lt.alert.category_t.storage_notification
            ),
            'download_rate_limit': self._speed_limit,
            'connections_limit': 200,
            'active_downloads': 8,
            'active_seeds': 10,
            'active_limit': 20,
        }
        self._session = lt.session(settings)
        # Bootstrap DHT nodes
        for router, rport in [
            ("router.bittorrent.com", 6881),
            ("router.utorrent.com", 6881),
            ("dht.transmissionbt.com", 6881),
        ]:
            self._session.add_dht_router(router, rport)
        logger.info("libtorrent session started on port %d (version %s)", port, lt.version)

    # ── Config ──

    def _config_path(self) -> str:
        return os.path.join(CONFIG_DIR, "tor_hunt_config.json")

    def _load_config(self):
        path = self._config_path()
        if os.path.exists(path):
            try:
                with open(path, 'r') as f:
                    self._config = json.load(f)
            except Exception as e:
                logger.warning("Config load error: %s", e)
                self._config = {}
        dl_dir = self._config.get("download_dir", DEFAULT_DOWNLOAD_DIR)
        temp_dir = self._config.get("temp_dir", DEFAULT_TEMP_DIR)
        os.makedirs(dl_dir, exist_ok=True)
        os.makedirs(temp_dir, exist_ok=True)

    def _save_config(self):
        path = self._config_path()
        try:
            tmp = path + '.tmp'
            with open(tmp, 'w') as f:
                json.dump(self._config, f, indent=2)
            os.replace(tmp, path)
        except Exception as e:
            logger.error("Config save error: %s", e)

    def get_config(self) -> Dict[str, Any]:
        return dict(self._config)

    def save_config(self, cfg: Dict[str, Any]):
        self._config = cfg
        self._save_config()
        # Apply runtime settings
        if self._session:
            port = cfg.get("listen_port", DEFAULT_LISTEN_PORT)
            self._session.apply_settings({
                'listen_interfaces': f'0.0.0.0:{port},[::0]:{port}'
            })

    def _get_download_dir(self) -> str:
        return self._config.get("download_dir", DEFAULT_DOWNLOAD_DIR)

    def _get_temp_dir(self) -> str:
        return self._config.get("temp_dir", DEFAULT_TEMP_DIR)

    def _get_category_folder(self, category: str) -> Optional[str]:
        if not category:
            return self._get_download_dir()
        path = os.path.join(self._get_download_dir(), category)
        os.makedirs(path, exist_ok=True)
        return path

    # ── State persistence (resume data) ──

    def _state_path(self) -> str:
        return os.path.join(CONFIG_DIR, "tor_hunt_state.json")

    def _resume_dir(self) -> str:
        d = os.path.join(CONFIG_DIR, "tor_hunt_resume")
        os.makedirs(d, exist_ok=True)
        return d

    def _save_state(self):
        """Save torrent metadata and resume data."""
        state = {
            "items": {tid: item.to_dict() for tid, item in self._items.items()},
            "hash_to_id": dict(self._hash_to_id),
        }
        path = self._state_path()
        try:
            tmp = path + '.tmp'
            with open(tmp, 'w') as f:
                json.dump(state, f)
            os.replace(tmp, path)
        except Exception as e:
            logger.error("State save error: %s", e)

        # Save resume data for each torrent
        resume_dir = self._resume_dir()
        for info_hash, handle in list(self._handles.items()):
            try:
                if not handle.is_valid():
                    continue
                handle.save_resume_data(lt.save_resume_data_flags_t.flush_disk_cache)
            except Exception:
                pass

    def _load_state(self):
        """Load torrent metadata and re-add torrents from resume data."""
        path = self._state_path()
        if not os.path.exists(path):
            return
        try:
            with open(path, 'r') as f:
                state = json.load(f)
        except Exception as e:
            logger.warning("State load error: %s", e)
            return

        items_data = state.get("items", {})
        self._hash_to_id = state.get("hash_to_id", {})

        # Re-add torrents from resume data
        resume_dir = self._resume_dir()
        for tid, item_data in items_data.items():
            info_hash = item_data.get("hash", "")
            if not info_hash:
                continue
            item = TorrentItem.from_dict(item_data)
            self._items[tid] = item

            # Try to load resume data
            resume_file = os.path.join(resume_dir, f"{info_hash}.fastresume")
            if os.path.exists(resume_file):
                try:
                    with open(resume_file, 'rb') as f:
                        resume_data = f.read()
                    atp = lt.read_resume_data(resume_data)
                    atp.save_path = item.save_path or self._get_download_dir()
                    handle = self._session.add_torrent(atp)
                    self._handles[info_hash] = handle
                    if item.status == "paused":
                        handle.pause()
                    logger.info("Resumed torrent: %s", item.name)
                except Exception as e:
                    logger.warning("Failed to resume %s: %s", item.name, e)
            else:
                # No resume data — try re-adding via magnet if we have the hash
                try:
                    magnet = f"magnet:?xt=urn:btih:{info_hash}"
                    atp = lt.parse_magnet_uri(magnet)
                    atp.save_path = item.save_path or self._get_download_dir()
                    handle = self._session.add_torrent(atp)
                    self._handles[info_hash] = handle
                    if item.status == "paused":
                        handle.pause()
                    logger.info("Re-added torrent from hash: %s", item.name)
                except Exception as e:
                    logger.warning("Failed to re-add %s: %s", item.name, e)

        logger.info("Loaded %d torrents from state", len(self._items))

    def _save_resume_data_for_handle(self, info_hash: str, handle: lt.torrent_handle):
        """Save fastresume data for a single torrent."""
        try:
            if not handle.is_valid():
                return
            status = handle.status()
            if not status.has_metadata:
                return
            resume_data = lt.write_resume_data_buf(status)
            resume_dir = self._resume_dir()
            resume_file = os.path.join(resume_dir, f"{info_hash}.fastresume")
            tmp = resume_file + '.tmp'
            with open(tmp, 'wb') as f:
                f.write(resume_data)
            os.replace(tmp, resume_file)
        except Exception as e:
            logger.debug("Resume data save error for %s: %s", info_hash, e)

    # ── History ──

    def _history_path(self) -> str:
        return os.path.join(CONFIG_DIR, "tor_hunt_history.json")

    def _load_history(self):
        path = self._history_path()
        if os.path.exists(path):
            try:
                with open(path, 'r') as f:
                    data = json.load(f)
                self._history = data if isinstance(data, list) else []
                for h in self._history:
                    hh = h.get('hash')
                    if hh:
                        self._known_completed.add(hh)
            except Exception:
                self._history = []

    def _save_history(self):
        path = self._history_path()
        try:
            tmp = path + '.tmp'
            with open(tmp, 'w') as f:
                json.dump(self._history[-500:], f)
            os.replace(tmp, path)
        except Exception as e:
            logger.error("History save error: %s", e)

    def get_history(self, limit: int = 100) -> List[dict]:
        return list(self._history[-limit:])

    def clear_history(self):
        self._history = []
        self._known_completed.clear()
        self._save_history()

    def delete_history_item(self, item_id: str) -> bool:
        before = len(self._history)
        self._history = [h for h in self._history if h.get('id') != item_id and h.get('hash') != item_id]
        if len(self._history) < before:
            self._save_history()
            return True
        return False

    # ── Torrent operations ──

    def add_torrent(self, magnet_url: str = "", torrent_data: bytes = None,
                    category: str = "", save_path: str = "",
                    name: str = "") -> Tuple[bool, str, str]:
        """Add a torrent via magnet link or .torrent file bytes.
        Returns (success, message, torrent_id)."""
        try:
            save_dir = save_path or self._get_category_folder(category) or self._get_download_dir()
            os.makedirs(save_dir, exist_ok=True)

            if torrent_data:
                # .torrent file
                ti = lt.torrent_info(lt.bdecode(torrent_data))
                atp = lt.add_torrent_params()
                atp.ti = ti
                atp.save_path = save_dir
            elif magnet_url:
                atp = lt.parse_magnet_uri(magnet_url)
                atp.save_path = save_dir
            else:
                return (False, "No magnet URL or torrent file provided", "")

            # Check for duplicate
            info_hash = str(atp.info_hashes.v1) if hasattr(atp.info_hashes, 'v1') else str(atp.info_hash)
            info_hash = info_hash.lower() if info_hash else ""

            # For magnet links, info_hash might be in the atp differently
            if not info_hash or info_hash == "0000000000000000000000000000000000000000":
                # Try to extract from magnet URL
                if magnet_url:
                    import re
                    m = re.search(r'btih:([a-fA-F0-9]{40})', magnet_url)
                    if m:
                        info_hash = m.group(1).lower()

            with self._lock:
                if info_hash in self._handles:
                    return (False, "Torrent already in queue", "")

                handle = self._session.add_torrent(atp)
                if not handle.is_valid():
                    return (False, "Failed to add torrent", "")

                # Generate ID
                torrent_id = str(uuid.uuid4())[:8]
                torrent_name = name or handle.name() or f"Torrent-{info_hash[:8]}"

                item = TorrentItem(
                    torrent_id=torrent_id,
                    name=torrent_name,
                    info_hash=info_hash,
                    category=category,
                    save_path=save_dir,
                )
                self._items[torrent_id] = item
                self._handles[info_hash] = handle
                self._hash_to_id[info_hash] = torrent_id

                if self._paused_global:
                    handle.pause()
                    item.status = "paused"

            self._save_state()
            logger.info("Added torrent: %s (hash: %s)", torrent_name, info_hash)
            return (True, f"Added: {torrent_name}", torrent_id)

        except Exception as e:
            logger.error("add_torrent error: %s", e)
            return (False, str(e), "")

    def pause_item(self, torrent_id: str) -> bool:
        with self._lock:
            item = self._items.get(torrent_id)
            if not item:
                # Try by hash
                torrent_id = self._hash_to_id.get(torrent_id, torrent_id)
                item = self._items.get(torrent_id)
            if not item:
                return False
            handle = self._handles.get(item.info_hash)
            if handle and handle.is_valid():
                handle.pause()
                item.status = "paused"
                return True
        return False

    def resume_item(self, torrent_id: str) -> bool:
        with self._lock:
            item = self._items.get(torrent_id)
            if not item:
                torrent_id = self._hash_to_id.get(torrent_id, torrent_id)
                item = self._items.get(torrent_id)
            if not item:
                return False
            handle = self._handles.get(item.info_hash)
            if handle and handle.is_valid():
                handle.resume()
                item.status = "downloading"
                return True
        return False

    def remove_item(self, torrent_id: str, delete_files: bool = False) -> bool:
        with self._lock:
            item = self._items.get(torrent_id)
            if not item:
                torrent_id = self._hash_to_id.get(torrent_id, torrent_id)
                item = self._items.get(torrent_id)
            if not item:
                return False
            handle = self._handles.get(item.info_hash)
            if handle and handle.is_valid():
                if delete_files:
                    self._session.remove_torrent(handle, lt.options_t.delete_files)
                else:
                    self._session.remove_torrent(handle)
            self._handles.pop(item.info_hash, None)
            self._hash_to_id.pop(item.info_hash, None)
            self._items.pop(item.id, None)
            # Clean up resume data
            resume_file = os.path.join(self._resume_dir(), f"{item.info_hash}.fastresume")
            try:
                os.unlink(resume_file)
            except Exception:
                pass
        self._save_state()
        return True

    def pause_all(self):
        self._paused_global = True
        if self._session:
            self._session.pause()

    def resume_all(self):
        self._paused_global = False
        if self._session:
            self._session.resume()

    # ── Speed limits ──

    def set_speed_limit(self, bps: int):
        self._speed_limit = max(0, bps)
        if self._session:
            self._session.apply_settings({'download_rate_limit': self._speed_limit})

    def get_speed_limit(self) -> int:
        return self._speed_limit

    # ── Status / Queue (called by IPC writer) ──

    def update_items_from_session(self):
        """Sync TorrentItem state from libtorrent handles. Called periodically."""
        with self._lock:
            for info_hash, handle in list(self._handles.items()):
                tid = self._hash_to_id.get(info_hash)
                if not tid or tid not in self._items:
                    continue
                item = self._items[tid]
                if not handle.is_valid():
                    item.status = "error"
                    item.error_msg = "Invalid handle"
                    continue

                try:
                    s = handle.status()
                except Exception:
                    continue

                item.progress = s.progress
                item.dl_speed = s.download_rate
                item.up_speed = s.upload_rate
                item.num_seeds = s.num_seeds
                item.num_peers = s.num_peers
                item.downloaded = s.total_done
                item.uploaded = s.total_upload
                item.size = s.total_wanted or item.size

                # Update name once metadata arrives
                if s.has_metadata and (not item.name or item.name.startswith("Torrent-")):
                    ti = handle.torrent_file()
                    if ti:
                        item.name = ti.name()
                        item.size = ti.total_size()

                # Content path
                if s.has_metadata:
                    ti = handle.torrent_file()
                    if ti:
                        if ti.num_files() == 1:
                            item.content_path = os.path.join(item.save_path, ti.files().file_path(0))
                        else:
                            item.content_path = os.path.join(item.save_path, ti.name())

                # Ratio
                if item.downloaded > 0:
                    item.ratio = item.uploaded / item.downloaded

                # ETA
                if item.dl_speed > 0 and item.size > 0:
                    remaining = item.size - item.downloaded
                    item.eta_seconds = int(remaining / item.dl_speed) if item.dl_speed > 0 else 0
                else:
                    item.eta_seconds = 0

                # Map libtorrent state to our status
                lt_state = s.state
                if s.paused and not self._paused_global:
                    if s.progress >= 1.0:
                        if item.status != "completed":
                            item.status = "completed"
                            item.completion_on = time.time()
                            self._on_torrent_completed(item)
                    else:
                        item.status = "paused"
                elif self._paused_global:
                    item.status = "paused"
                elif lt_state == lt.torrent_status.states.checking_files:
                    item.status = "checking"
                elif lt_state == lt.torrent_status.states.downloading_metadata:
                    item.status = "metadata"
                elif lt_state == lt.torrent_status.states.downloading:
                    item.status = "downloading"
                elif lt_state == lt.torrent_status.states.finished:
                    item.status = "seeding"
                    if item.info_hash not in self._known_completed:
                        item.completion_on = time.time()
                        self._on_torrent_completed(item)
                elif lt_state == lt.torrent_status.states.seeding:
                    item.status = "seeding"
                    if item.info_hash not in self._known_completed:
                        item.completion_on = time.time()
                        self._on_torrent_completed(item)
                elif lt_state == lt.torrent_status.states.checking_resume_data:
                    item.status = "checking"

                # Check for errors
                if s.errc.value() != 0:
                    item.status = "error"
                    item.error_msg = s.errc.message()

    def _on_torrent_completed(self, item: TorrentItem):
        """Called when a torrent finishes downloading."""
        if item.info_hash in self._known_completed:
            return
        self._known_completed.add(item.info_hash)
        hist_entry = {
            "id": item.id,
            "hash": item.info_hash,
            "name": item.name,
            "category": item.category,
            "size": item.size,
            "size_str": _format_bytes(item.size),
            "save_path": item.save_path,
            "content_path": item.content_path,
            "completed_at": time.time(),
            "status": "completed",
        }
        self._history.append(hist_entry)
        self._save_history()
        logger.info("Torrent completed: %s", item.name)

        # Save resume data
        handle = self._handles.get(item.info_hash)
        if handle:
            self._save_resume_data_for_handle(item.info_hash, handle)

    def get_status(self) -> dict:
        """Get overall engine status."""
        downloading = 0
        seeding = 0
        paused = 0
        errored = 0
        total_dl_speed = 0
        total_up_speed = 0

        for item in self._items.values():
            if item.status == "downloading" or item.status == "metadata":
                downloading += 1
            elif item.status == "seeding":
                seeding += 1
            elif item.status == "paused":
                paused += 1
            elif item.status == "error":
                errored += 1
            total_dl_speed += item.dl_speed
            total_up_speed += item.up_speed

        dht_running = self._session.is_dht_running() if self._session else False

        return {
            "engine": "built-in",
            "connected": True,
            "dht_running": dht_running,
            "dl_speed": total_dl_speed,
            "dl_speed_str": _format_speed(total_dl_speed),
            "up_speed": total_up_speed,
            "up_speed_str": _format_speed(total_up_speed),
            "downloading": downloading,
            "seeding": seeding,
            "paused": paused,
            "errored": errored,
            "total": len(self._items),
            "history_count": len(self._history),
            "speed_limit_bps": self._speed_limit,
            "speed_limit_str": _format_speed(self._speed_limit) if self._speed_limit > 0 else "Unlimited",
            "paused_global": self._paused_global,
            "listen_port": self._config.get("listen_port", DEFAULT_LISTEN_PORT),
            "version": lt.version,
        }

    def get_queue(self) -> List[dict]:
        """Get all active torrents (not in history-only state)."""
        items = []
        for item in self._items.values():
            items.append(item.to_dict())
        # Sort: downloading first, then by added_on
        items.sort(key=lambda x: (
            0 if x["raw_state"] in ("downloading", "metadata") else
            1 if x["raw_state"] == "checking" else
            2 if x["raw_state"] == "paused" else
            3 if x["raw_state"] == "seeding" else 4,
            x.get("added_on", 0)
        ))
        return items

    def get_completed_torrents(self, category: str = None) -> List[dict]:
        """Get torrents that are completed/seeding."""
        result = []
        for item in self._items.values():
            if item.status in ("seeding", "completed") and item.progress >= 0.99:
                if category and item.category != category:
                    continue
                result.append(item.to_dict())
        return result

    # ── Cleanup ──

    def stop(self):
        """Gracefully shut down the engine."""
        self._running = False
        logger.info("Stopping Tor Hunt engine...")
        # Save resume data for all torrents
        for info_hash, handle in list(self._handles.items()):
            self._save_resume_data_for_handle(info_hash, handle)
        self._save_state()
        self._save_history()
        if self._session:
            self._session.pause()
            # Wait briefly for resume data alerts
            time.sleep(1)
        logger.info("Tor Hunt engine stopped")


# ── Formatting helpers ──

def _format_bytes(b: int) -> str:
    if b <= 0:
        return '0 B'
    for unit in ('B', 'KB', 'MB', 'GB', 'TB'):
        if abs(b) < 1024:
            return f"{b:.1f} {unit}"
        b /= 1024
    return f"{b:.1f} PB"


def _format_speed(bps: int) -> str:
    if bps <= 0:
        return '0 B/s'
    for unit in ('B/s', 'KB/s', 'MB/s', 'GB/s'):
        if abs(bps) < 1024:
            return f"{bps:.1f} {unit}"
        bps /= 1024
    return f"{bps:.1f} TB/s"


def _format_eta(seconds: int) -> str:
    if seconds <= 0 or seconds > 8640000:
        return '-'
    hours = seconds // 3600
    mins = (seconds % 3600) // 60
    secs = seconds % 60
    if hours > 0:
        return f"{hours}h {mins}m"
    elif mins > 0:
        return f"{mins}m {secs}s"
    return f"{secs}s"
