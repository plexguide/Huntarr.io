"""
Tor Hunt Manager — unified interface for torrent downloads.

Supports two modes:
  1. Built-in engine (Tor Hunt) — uses libtorrent in a child process
  2. External qBittorrent — proxies to an external qBittorrent instance

The built-in engine is always running (like NZB Hunt). External qBittorrent
is used when configured as a download client in Movie Hunt / TV Hunt settings.

get_manager() returns this singleton. Routes and activity systems call it.
"""

import os
import json
import threading
from typing import Optional, Dict, List, Any, Tuple

from src.primary.utils.logger import get_logger
from src.primary.utils.config_paths import CONFIG_DIR

logger = get_logger("tor_hunt")

_lock = threading.Lock()
_instance: Optional['TorHuntManager'] = None


def get_manager() -> 'TorHuntManager':
    """Get or create the singleton TorHuntManager."""
    global _instance
    if _instance is None:
        with _lock:
            if _instance is None:
                _instance = TorHuntManager()
    return _instance


class TorHuntManager:
    """Unified torrent download manager.

    The built-in engine (TorHuntProxy) is always available.
    External qBittorrent client is available when configured.
    """

    def __init__(self):
        self._proxy = None  # Lazy-init to avoid import at module load
        self._proxy_init_lock = threading.Lock()

    def _get_proxy(self):
        """Get the built-in engine proxy (lazy init)."""
        if self._proxy is None:
            with self._proxy_init_lock:
                if self._proxy is None:
                    try:
                        from src.primary.apps.tor_hunt.tor_hunt_process import TorHuntProxy
                        self._proxy = TorHuntProxy.get_instance()
                    except ImportError as e:
                        logger.error("Failed to import TorHuntProxy (libtorrent missing?): %s", e)
                        return None
        return self._proxy

    # ── Built-in engine methods (delegated to proxy) ──

    def get_status(self) -> Dict[str, Any]:
        proxy = self._get_proxy()
        if proxy:
            return proxy.get_status()
        return {"engine": "built-in", "connected": False, "dl_speed": 0, "up_speed": 0,
                "error": "Engine not available (libtorrent not installed?)"}

    def get_queue(self, category: str = None) -> List[Dict[str, Any]]:
        proxy = self._get_proxy()
        if not proxy:
            return []
        queue = proxy.get_queue()
        if category:
            queue = [q for q in queue if q.get("category") == category]
        return queue

    def get_history(self, limit: int = 100) -> List[Dict[str, Any]]:
        proxy = self._get_proxy()
        if not proxy:
            return []
        return proxy.get_history(limit=limit)

    def get_completed_torrents(self, category: str = None) -> List[Dict[str, Any]]:
        proxy = self._get_proxy()
        if not proxy:
            return []
        return proxy.get_completed_torrents(category=category)

    def add_torrent(self, magnet_url: str = "", torrent_data: bytes = None,
                    category: str = "", save_path: str = "",
                    name: str = "") -> Tuple[bool, str, str]:
        """Add torrent to the built-in engine.
        Returns (success, message, torrent_id)."""
        proxy = self._get_proxy()
        if not proxy:
            return (False, "Tor Hunt engine not available", "")
        return proxy.add_torrent(
            magnet_url=magnet_url, torrent_data=torrent_data,
            category=category, save_path=save_path, name=name
        )

    def pause_item(self, torrent_id: str) -> bool:
        proxy = self._get_proxy()
        return proxy.pause_item(torrent_id) if proxy else False

    def resume_item(self, torrent_id: str) -> bool:
        proxy = self._get_proxy()
        return proxy.resume_item(torrent_id) if proxy else False

    def remove_item(self, torrent_id: str, delete_files: bool = False) -> bool:
        proxy = self._get_proxy()
        return proxy.remove_item(torrent_id, delete_files=delete_files) if proxy else False

    def pause_all(self) -> bool:
        proxy = self._get_proxy()
        if proxy:
            proxy.pause_all()
            return True
        return False

    def resume_all(self) -> bool:
        proxy = self._get_proxy()
        if proxy:
            proxy.resume_all()
            return True
        return False

    def get_speed_limit(self) -> int:
        proxy = self._get_proxy()
        return proxy.get_speed_limit() if proxy else 0

    def set_speed_limit(self, bps: int) -> bool:
        proxy = self._get_proxy()
        if proxy:
            proxy.set_speed_limit(bps)
            return True
        return False

    def clear_history(self):
        proxy = self._get_proxy()
        if proxy:
            proxy.clear_history()

    def delete_history_item(self, item_id: str) -> bool:
        proxy = self._get_proxy()
        if proxy:
            proxy.delete_history_item(item_id)
            return True
        return False

    def get_config(self) -> Dict[str, Any]:
        proxy = self._get_proxy()
        return proxy.get_config() if proxy else {}

    def save_config(self, cfg: Dict[str, Any]):
        proxy = self._get_proxy()
        if proxy:
            proxy.save_config(cfg)

    def has_connection(self) -> bool:
        """Built-in engine is always available (if libtorrent is installed)."""
        proxy = self._get_proxy()
        return proxy is not None

    def stop(self):
        """Stop the built-in engine."""
        if self._proxy:
            self._proxy.stop()

    # ── External qBittorrent client (used by activity/import system) ──

    def get_qbittorrent_client(self, host: str, port: int, username: str,
                                password: str, use_ssl: bool = False):
        """Create a qBittorrent client for external client support."""
        from src.primary.apps.tor_hunt.qbittorrent_client import QBittorrentClient
        return QBittorrentClient(
            host=host, port=port, username=username,
            password=password, use_ssl=use_ssl
        )
