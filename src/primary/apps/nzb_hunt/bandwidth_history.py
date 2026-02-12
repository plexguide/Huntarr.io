"""
NZB Hunt Bandwidth History - Persistent per-server bandwidth tracking.

Stores hourly snapshots for last 30 days. Computes:
  - 24h: bytes downloaded in last 24 hours
  - 30d: bytes downloaded in last 30 days
  - total: all-time persisted + current session
"""

import os
import json
import time
import threading
from typing import Dict, Optional
from src.primary.utils.logger import get_logger

logger = get_logger("nzb_hunt.bandwidth")

# Keep 30 days of hourly samples (720 hours)
_MAX_HOURLY_SAMPLES = 720
_FLUSH_INTERVAL_SEC = 60


def _server_key(name: str, host: str) -> str:
    return f"{name} ({host})"


def _hour_ts(ts: float) -> int:
    """Unix timestamp truncated to hour."""
    return int(ts // 3600) * 3600


class BandwidthHistory:
    def __init__(self, config_dir: str):
        self._config_dir = config_dir
        self._path = os.path.join(config_dir, "nzb_hunt_bandwidth.json")
        self._lock = threading.Lock()
        self._last_flush_ts = 0.0
        self._last_snapshot: Dict[str, int] = {}

        # In-memory: { server_key: { "total": int, "hourly": [(hour_ts, bytes), ...] } }
        self._data: Dict[str, dict] = {}
        self._load()

    def _load(self):
        if not os.path.exists(self._path):
            self._data = {}
            return
        try:
            with open(self._path, "r") as f:
                raw = json.load(f)
            self._data = raw.get("servers", {})
            if not isinstance(self._data, dict):
                self._data = {}
        except Exception as e:
            logger.warning(f"Failed to load bandwidth history: {e}")
            self._data = {}

    def _save(self):
        try:
            tmp = self._path + ".tmp"
            with open(tmp, "w") as f:
                json.dump({"servers": self._data}, f, indent=0)
                f.flush()
                if hasattr(f, "fileno"):
                    os.fsync(f.fileno())
            os.replace(tmp, self._path)
        except Exception as e:
            logger.error(f"Failed to save bandwidth history: {e}")

    def flush(self, bandwidth_by_server: Dict[str, int]):
        """Record current bandwidth snapshot. Call periodically (e.g. every 60s)."""
        now = time.time()
        with self._lock:
            if now - self._last_flush_ts < _FLUSH_INTERVAL_SEC:
                return
            self._last_flush_ts = now

            for key, current_bytes in bandwidth_by_server.items():
                last = self._last_snapshot.get(key, 0)
                delta = max(0, current_bytes - last)
                self._last_snapshot[key] = current_bytes

                if key not in self._data:
                    self._data[key] = {"total": 0, "hourly": []}

                self._data[key]["total"] += delta
                hour = _hour_ts(now)
                hourly = self._data[key]["hourly"]

                if hourly and hourly[-1][0] == hour:
                    hourly[-1] = (hour, hourly[-1][1] + delta)
                else:
                    hourly.append((hour, delta))

                # Prune to last 30 days
                cutoff = _hour_ts(now - 30 * 24 * 3600)
                self._data[key]["hourly"] = [(h, b) for h, b in hourly if h >= cutoff][-_MAX_HOURLY_SAMPLES:]

            self._save()

    def get_stats(self, server_key: str, session_bytes: int = 0) -> Dict[str, int]:
        """Return { bandwidth_1h, bandwidth_24h, bandwidth_30d, bandwidth_total } for a server."""
        with self._lock:
            entry = self._data.get(server_key, {"total": 0, "hourly": []})
            last = self._last_snapshot.get(server_key, 0)
            unflushed = max(0, session_bytes - last)
            total = entry.get("total", 0) + unflushed
            now = time.time()
            cutoff_1h = _hour_ts(now - 3600)
            cutoff_24h = _hour_ts(now - 24 * 3600)
            cutoff_30d = _hour_ts(now - 30 * 24 * 3600)

            b1 = 0
            b24 = 0
            b30 = 0
            for h, b in entry.get("hourly", []):
                if h >= cutoff_1h:
                    b1 += b
                if h >= cutoff_24h:
                    b24 += b
                if h >= cutoff_30d:
                    b30 += b

            return {
                "bandwidth_1h": b1,
                "bandwidth_24h": b24,
                "bandwidth_30d": b30,
                "bandwidth_total": total,
            }

    def get_all_stats(self, bandwidth_by_server: Dict[str, int]) -> Dict[str, Dict[str, int]]:
        """Return per-server stats for all servers in bandwidth_by_server."""
        return {
            key: self.get_stats(key, bandwidth_by_server.get(key, 0))
            for key in bandwidth_by_server
        }


# Module-level instance (lazy init with config dir)
_instance: Optional[BandwidthHistory] = None
_instance_lock = threading.Lock()


def get_bandwidth_history(config_dir: str) -> BandwidthHistory:
    global _instance
    with _instance_lock:
        if _instance is None:
            _instance = BandwidthHistory(config_dir)
        return _instance
