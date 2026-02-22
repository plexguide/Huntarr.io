"""
Tor Hunt Download Process — runs the torrent engine in a separate process.

Same architecture as NZB Hunt's download_process.py:

  Web Server Process (Waitress)
    └─ TorHuntProxy  (drop-in singleton)
         ├─ reads status/queue from IPC JSON file (no GIL contention)
         └─ sends commands via multiprocessing.Queue → child process

  Download Process (child)
    └─ TorHuntEngine (libtorrent session, own GIL)
         └─ writes status/queue to IPC JSON file every ~1.5 seconds
"""

import os
import sys
import json
import time
import signal
import logging
import threading
import traceback
import multiprocessing
from multiprocessing import Process, Queue
from queue import Empty
from typing import Optional, Dict, Any, Tuple, List

logger = logging.getLogger("tor_hunt.process")

_STATUS_FILENAME = "tor_hunt_ipc_status.json"


def _get_ipc_path() -> str:
    from src.primary.utils.config_paths import CONFIG_DIR
    return os.path.join(str(CONFIG_DIR), _STATUS_FILENAME)


# ── Child Process ─────────────────────────────────────────────────

def _child_main(cmd_queue, result_queue, ready_event):
    """Entry point for the torrent download child process."""
    signal.signal(signal.SIGINT, signal.SIG_IGN)

    engine = None
    try:
        from src.primary.utils.logger import get_logger
        child_log = get_logger("tor_hunt.child")
        child_log.info("Tor Hunt child process starting (PID %d)", os.getpid())

        from src.primary.apps.tor_hunt.libtorrent_engine import TorHuntEngine
        engine = TorHuntEngine.get_instance()

        ipc_path = _get_ipc_path()
        ready_event.set()

        _last_write = 0.0
        _last_save = 0.0
        _WRITE_INTERVAL = 1.5
        _SAVE_INTERVAL = 30.0  # Save resume data every 30s

        while True:
            if not _drain_commands(engine, cmd_queue, result_queue, child_log):
                break

            # Update torrent states from libtorrent
            engine.update_items_from_session()

            # Write IPC status periodically
            now = time.monotonic()
            if now - _last_write >= _WRITE_INTERVAL:
                _last_write = now
                _write_ipc(engine, ipc_path)

            # Periodic resume data save
            if now - _last_save >= _SAVE_INTERVAL:
                _last_save = now
                engine._save_state()

            time.sleep(0.05)

    except KeyboardInterrupt:
        pass
    except Exception as e:
        logger.error("Tor Hunt child fatal: %s\n%s", e, traceback.format_exc())
    finally:
        if engine:
            try:
                engine.stop()
            except Exception:
                pass
        try:
            os.unlink(_get_ipc_path())
        except Exception:
            pass
        logger.info("Tor Hunt child process exiting")


def _drain_commands(engine, cmd_queue, result_queue, log):
    """Process pending commands from the parent. Returns False on 'stop'."""
    for _ in range(50):
        try:
            cmd = cmd_queue.get_nowait()
        except Empty:
            break

        cmd_id = cmd.get("id")
        method = cmd.get("method")
        args = cmd.get("args", [])
        kwargs = cmd.get("kwargs", {})

        if method == "stop":
            result_queue.put({"id": cmd_id, "result": True})
            return False

        try:
            fn = getattr(engine, method, None)
            if fn is None:
                result_queue.put({"id": cmd_id, "error": f"Unknown method: {method}"})
                continue
            result = fn(*args, **kwargs)
            result_queue.put({"id": cmd_id, "result": result})
        except Exception as e:
            log.error("Command %s error: %s", method, e)
            result_queue.put({"id": cmd_id, "error": str(e)})
    return True


def _write_ipc(engine, ipc_path):
    """Atomically write status + queue to the IPC file."""
    try:
        status = engine.get_status()
        queue = engine.get_queue()
        history = engine.get_history(limit=200)
        data = {
            "status": status,
            "queue": queue,
            "history": history,
            "ts": time.time(),
        }
        tmp = ipc_path + ".tmp"
        with open(tmp, "w") as f:
            json.dump(data, f)
        os.replace(tmp, ipc_path)
    except Exception:
        pass


# ── Proxy (runs in web server process) ────────────────────────────

class TorHuntProxy:
    """Drop-in proxy for TorHuntEngine that runs in the web server process.

    Read-only methods are served from the cached IPC file.
    Mutating methods are forwarded to the child process via Queue.
    """

    _instance = None
    _lock = threading.Lock()

    @classmethod
    def get_instance(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance

    def __init__(self):
        self._process: Optional[Process] = None
        self._cmd_queue: Optional[Queue] = None
        self._result_queue: Optional[Queue] = None
        self._cmd_counter = 0
        self._cmd_lock = threading.Lock()
        self._pending: Dict[int, Any] = {}
        self._pending_lock = threading.Lock()

        self._ipc_path = _get_ipc_path()
        self._cached_data: Optional[dict] = None
        self._cached_ts: float = 0.0
        self._cache_ttl: float = 1.0

        self._start_child()

    def _start_child(self):
        """Spawn the torrent download child process."""
        logger.info("Starting Tor Hunt download child process...")
        ctx = multiprocessing.get_context("fork")
        self._cmd_queue = ctx.Queue(maxsize=500)
        self._result_queue = ctx.Queue(maxsize=500)
        ready = ctx.Event()

        self._process = ctx.Process(
            target=_child_main,
            args=(self._cmd_queue, self._result_queue, ready),
            name="tor-hunt-download",
            daemon=True,
        )
        self._process.start()
        logger.info("Tor Hunt child process spawned (PID %d)", self._process.pid)

        if not ready.wait(timeout=30):
            logger.error("Tor Hunt child process failed to start within 30s")
        else:
            logger.info("Tor Hunt child process ready")

    def _ensure_alive(self):
        if self._process is None or not self._process.is_alive():
            logger.warning("Tor Hunt child process died, restarting...")
            self._start_child()

    def _read_ipc(self) -> dict:
        now = time.monotonic()
        if self._cached_data and (now - self._cached_ts) < self._cache_ttl:
            return self._cached_data
        try:
            with open(self._ipc_path, "r") as f:
                data = json.load(f)
            self._cached_data = data
            self._cached_ts = now
            return data
        except (FileNotFoundError, json.JSONDecodeError):
            if self._cached_data:
                return self._cached_data
            return {"status": self._empty_status(), "queue": [], "history": [], "ts": 0}

    def _send_command(self, method: str, args=None, kwargs=None, timeout=15.0):
        self._ensure_alive()
        with self._cmd_lock:
            self._cmd_counter += 1
            cmd_id = self._cmd_counter

        cmd = {"id": cmd_id, "method": method, "args": args or [], "kwargs": kwargs or {}}
        try:
            self._cmd_queue.put(cmd, timeout=5.0)
        except Exception as e:
            logger.error("Failed to send command %s: %s", method, e)
            raise RuntimeError(f"Tor Hunt process command failed: {e}")

        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                result = self._result_queue.get(timeout=0.1)
                if result.get("id") == cmd_id:
                    if "error" in result:
                        raise RuntimeError(result["error"])
                    return result.get("result")
                else:
                    with self._pending_lock:
                        self._pending[result["id"]] = result
            except Empty:
                with self._pending_lock:
                    if cmd_id in self._pending:
                        r = self._pending.pop(cmd_id)
                        if "error" in r:
                            raise RuntimeError(r["error"])
                        return r.get("result")
                continue

        raise TimeoutError(f"Command {method} timed out after {timeout}s")

    def _empty_status(self) -> dict:
        return {
            "engine": "built-in",
            "connected": False,
            "dht_running": False,
            "dl_speed": 0, "dl_speed_str": "0 B/s",
            "up_speed": 0, "up_speed_str": "0 B/s",
            "downloading": 0, "seeding": 0, "paused": 0,
            "errored": 0, "total": 0, "history_count": 0,
            "speed_limit_bps": 0, "speed_limit_str": "Unlimited",
            "paused_global": False, "listen_port": 6881,
            "version": "unknown",
        }

    # ── Read-only (from IPC cache) ──

    def get_status(self) -> dict:
        data = self._read_ipc()
        return data.get("status", self._empty_status())

    def get_queue(self) -> list:
        data = self._read_ipc()
        return data.get("queue", [])

    def get_history(self, limit: int = 100) -> list:
        data = self._read_ipc()
        history = data.get("history", [])
        return history[-limit:]

    def get_completed_torrents(self, category: str = None) -> list:
        queue = self.get_queue()
        result = []
        for item in queue:
            if item.get("raw_state") in ("seeding", "completed") and item.get("progress", 0) >= 99:
                if category and item.get("category") != category:
                    continue
                result.append(item)
        return result

    def get_speed_limit(self) -> int:
        return self.get_status().get("speed_limit_bps", 0)

    def get_config(self) -> dict:
        return self._send_command("get_config", timeout=5.0) or {}

    # ── Mutating (forwarded to child) ──

    def add_torrent(self, **kwargs) -> Tuple[bool, str, str]:
        result = self._send_command("add_torrent", kwargs=kwargs, timeout=30.0)
        if isinstance(result, (list, tuple)) and len(result) == 3:
            return tuple(result)
        return (False, "Unexpected response", "")

    def save_config(self, cfg: dict):
        self._send_command("save_config", args=[cfg], timeout=5.0)

    def pause_item(self, torrent_id: str) -> bool:
        return bool(self._send_command("pause_item", args=[torrent_id]))

    def resume_item(self, torrent_id: str) -> bool:
        return bool(self._send_command("resume_item", args=[torrent_id]))

    def remove_item(self, torrent_id: str, delete_files: bool = False) -> bool:
        return bool(self._send_command("remove_item", args=[torrent_id, delete_files]))

    def set_speed_limit(self, bps: int):
        self._send_command("set_speed_limit", args=[bps])

    def pause_all(self):
        self._send_command("pause_all")

    def resume_all(self):
        self._send_command("resume_all")

    def clear_history(self):
        self._send_command("clear_history")

    def delete_history_item(self, item_id: str):
        self._send_command("delete_history_item", args=[item_id])

    def stop(self):
        if self._process and self._process.is_alive():
            logger.info("Stopping Tor Hunt child process...")
            try:
                self._send_command("stop", timeout=10.0)
            except Exception:
                pass
            self._process.terminate()
            self._process.join(timeout=5)
            if self._process.is_alive():
                self._process.kill()
            logger.info("Tor Hunt child process stopped")
        try:
            os.unlink(self._ipc_path)
        except Exception:
            pass
