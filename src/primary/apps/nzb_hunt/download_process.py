"""
NZB Hunt Download Process — runs the download engine in a separate process.

Solves GIL contention: 120 NNTP download threads + Waitress web threads
fighting for the same GIL caused 45+ second UI freezes.  By running the
download engine in its own process, each has its own GIL and the web
server stays responsive regardless of download load.

Architecture:
  Web Server Process (Waitress)
    └─ DownloadManagerProxy  (drop-in replacement for NZBHuntDownloadManager)
         ├─ reads status/queue from IPC JSON file (no GIL contention)
         └─ sends commands via multiprocessing.Queue → child process

  Download Process (child)
    └─ NZBHuntDownloadManager (real engine, 120 NNTP threads, own GIL)
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
from typing import Optional, List, Tuple, Dict, Any

logger = logging.getLogger("nzb_hunt.download_process")

# IPC status file (written by child, read by parent)
_STATUS_FILENAME = "nzb_hunt_ipc_status.json"


def _get_ipc_path() -> str:
    from src.primary.utils.config_paths import CONFIG_DIR
    return os.path.join(str(CONFIG_DIR), _STATUS_FILENAME)


# ── Child Process ─────────────────────────────────────────────────

def _child_main(cmd_queue, result_queue, ready_event):
    """Entry point for the download child process."""
    signal.signal(signal.SIGINT, signal.SIG_IGN)

    # ── GIL tuning for the download process ──
    # Default switch interval is 5ms (0.005s).  With 120 threads, that
    # means ~24,000 involuntary context switches per second — each one
    # interrupts a thread mid-read to give another thread a turn, even
    # though the interrupted thread was about to release the GIL for I/O
    # anyway.  Raising to 10ms lets each thread complete more Python
    # bytecode (loop control, chunk append, len check) before yielding,
    # cutting context-switch overhead by ~2x while still allowing the
    # main thread (IPC writes, command processing) to get timely turns.
    #
    # Safe here because this is an isolated child process — the web
    # server has its own GIL at the default interval.
    sys.setswitchinterval(0.010)

    mgr = None
    try:
        from src.primary.utils.logger import get_logger
        child_log = get_logger("nzb_hunt.child")
        child_log.info("Download child process starting (PID %d)", os.getpid())

        from src.primary.apps.nzb_hunt import download_manager as _dm_mod
        _dm_mod._force_direct = True  # Use real manager, not proxy
        from src.primary.apps.nzb_hunt.download_manager import NZBHuntDownloadManager
        mgr = NZBHuntDownloadManager()

        ipc_path = _get_ipc_path()
        ready_event.set()

        _last_write = 0.0
        _INTERVAL = 1.5

        while True:
            # Process commands (returns False on 'stop')
            if not _drain_commands(mgr, cmd_queue, result_queue, child_log):
                break

            # Write status periodically
            now = time.monotonic()
            if now - _last_write >= _INTERVAL:
                _last_write = now
                _write_ipc(mgr, ipc_path)

            time.sleep(0.05)

    except KeyboardInterrupt:
        pass
    except Exception as e:
        logger.error("Child fatal: %s\n%s", e, traceback.format_exc())
    finally:
        if mgr:
            try:
                mgr.stop()
            except Exception:
                pass
        # Clean up IPC file
        try:
            os.unlink(_get_ipc_path())
        except Exception:
            pass
        logger.info("Download child process exiting")


def _drain_commands(mgr, cmd_queue, result_queue, log):
    """Process all pending commands from the parent.
    Returns False if a 'stop' command was received."""
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
            fn = getattr(mgr, method, None)
            if fn is None:
                result_queue.put({"id": cmd_id, "error": f"Unknown method: {method}"})
                continue
            result = fn(*args, **kwargs)
            result_queue.put({"id": cmd_id, "result": result})
        except Exception as e:
            log.error("Command %s error: %s", method, e)
            result_queue.put({"id": cmd_id, "error": str(e)})
    return True


def _write_ipc(mgr, ipc_path):
    """Atomically write status + queue to the IPC file."""
    try:
        status = mgr.get_status()
        queue = mgr.get_queue()
        history = mgr.get_history(limit=200)
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

class DownloadManagerProxy:
    """Drop-in replacement for NZBHuntDownloadManager that runs in the
    web server process.  All heavy lifting happens in a child process;
    this proxy just reads cached status from a JSON file and sends
    commands over a multiprocessing.Queue.

    Read-only methods (get_status, get_queue, get_history) are served
    from the cached IPC file — zero GIL contention, instant response.

    Mutating methods (add_nzb, pause_item, etc.) are sent as commands
    to the child process and block until the child responds (typically
    < 50ms).
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

        # Pending results from child (cmd_id -> result)
        self._pending: Dict[int, Any] = {}
        self._pending_lock = threading.Lock()

        # Cached IPC data
        self._ipc_path = _get_ipc_path()
        self._cached_data: Optional[dict] = None
        self._cached_ts: float = 0.0
        self._cache_ttl: float = 1.0  # re-read file at most every 1s

        # Start the child process
        self._start_child()

    def _start_child(self):
        """Spawn the download child process."""
        logger.info("Starting NZB Hunt download child process...")
        ctx = multiprocessing.get_context("fork")
        self._cmd_queue = ctx.Queue(maxsize=500)
        self._result_queue = ctx.Queue(maxsize=500)
        ready = ctx.Event()

        self._process = ctx.Process(
            target=_child_main,
            args=(self._cmd_queue, self._result_queue, ready),
            name="nzb-hunt-download",
            daemon=True,
        )
        self._process.start()
        logger.info("Download child process spawned (PID %d)", self._process.pid)

        # Wait for child to be ready (up to 30s)
        if not ready.wait(timeout=30):
            logger.error("Download child process failed to start within 30s")
        else:
            logger.info("Download child process ready")

    def _ensure_alive(self):
        """Restart child if it died."""
        if self._process is None or not self._process.is_alive():
            logger.warning("Download child process died, restarting...")
            self._start_child()

    def _read_ipc(self) -> dict:
        """Read the IPC status file with caching."""
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
            # Child hasn't written yet or file is being replaced
            if self._cached_data:
                return self._cached_data
            return {"status": self._empty_status(), "queue": [], "history": [], "ts": 0}

    def _send_command(self, method: str, args=None, kwargs=None, timeout=15.0):
        """Send a command to the child process and wait for the result."""
        self._ensure_alive()
        with self._cmd_lock:
            self._cmd_counter += 1
            cmd_id = self._cmd_counter

        cmd = {"id": cmd_id, "method": method, "args": args or [], "kwargs": kwargs or {}}
        try:
            self._cmd_queue.put(cmd, timeout=5.0)
        except Exception as e:
            logger.error("Failed to send command %s: %s", method, e)
            raise RuntimeError(f"Download process command failed: {e}")

        # Wait for result
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            # Drain result queue looking for our cmd_id
            try:
                result = self._result_queue.get(timeout=0.1)
                if result.get("id") == cmd_id:
                    if "error" in result:
                        raise RuntimeError(result["error"])
                    return result.get("result")
                else:
                    # Not ours — stash it for another thread
                    with self._pending_lock:
                        self._pending[result["id"]] = result
            except Empty:
                # Check if someone else got our result
                with self._pending_lock:
                    if cmd_id in self._pending:
                        r = self._pending.pop(cmd_id)
                        if "error" in r:
                            raise RuntimeError(r["error"])
                        return r.get("result")
                continue

        raise TimeoutError(f"Command {method} timed out after {timeout}s")

    def _empty_status(self) -> dict:
        """Return an empty status dict for when child isn't ready yet."""
        return {
            "active_count": 0, "queued_count": 0, "paused_count": 0,
            "total_count": 0, "history_count": 0, "speed_bps": 0,
            "speed_human": "0 B/s", "remaining_bytes": 0,
            "remaining_human": "0 B", "eta_seconds": 0, "eta_human": "--",
            "free_space": 0, "free_space_human": "--",
            "speed_limit_bps": 0, "speed_limit_human": "Unlimited",
            "paused_global": False, "bandwidth_by_server": {},
            "connection_stats": [], "servers_configured": False,
            "connection_ok": False, "worker_running": False,
            "warnings": [], "warnings_count": 0,
        }

    # ── Read-only methods (served from IPC cache, no GIL contention) ──

    def get_status(self) -> dict:
        data = self._read_ipc()
        return data.get("status", self._empty_status())

    def get_queue(self) -> list:
        data = self._read_ipc()
        return data.get("queue", [])

    def get_history(self, limit: int = 50) -> list:
        data = self._read_ipc()
        history = data.get("history", [])
        return history[-limit:]

    def get_item(self, nzb_id: str) -> Optional[dict]:
        data = self._read_ipc()
        for item in data.get("queue", []):
            if item.get("id") == nzb_id:
                return item
        for item in data.get("history", []):
            if item.get("id") == nzb_id:
                return item
        return None

    def get_warnings(self) -> list:
        return self.get_status().get("warnings", [])

    def get_speed_limit(self) -> int:
        return self.get_status().get("speed_limit_bps", 0)

    def has_servers(self) -> bool:
        return self.get_status().get("servers_configured", False)

    def _get_folders(self) -> dict:
        """Get configured folder settings (read-only, reads config directly)."""
        try:
            import json, os
            config_dir = os.environ.get("CONFIG_DIR", "/config")
            config_path = os.path.join(config_dir, "nzb_hunt_config.json")
            if os.path.exists(config_path):
                with open(config_path, "r") as f:
                    cfg = json.load(f)
                return cfg.get("folders", {
                    "download_folder": "/downloads",
                    "temp_folder": "/downloads/incomplete",
                })
        except Exception:
            pass
        return {
            "download_folder": "/downloads",
            "temp_folder": "/downloads/incomplete",
        }

    def _temp_to_complete_base(self, temp_folder: str) -> str:
        """Derive complete base from temp: /downloads/incomplete -> /downloads/complete."""
        import os
        if not temp_folder or temp_folder.rstrip("/") == "":
            return "/downloads/complete"
        parent = os.path.dirname(temp_folder.rstrip(os.sep))
        if not parent or parent == temp_folder:
            return "/downloads/complete"
        return os.path.join(parent, "complete")

    def _get_category_folder(self, category: str) -> Optional[str]:
        """Get the completed download folder for a category."""
        import os
        if not category:
            return None
        folders = self._get_folders()
        temp_folder = folders.get("temp_folder", "/downloads/incomplete")
        complete_base = self._temp_to_complete_base(temp_folder)
        return os.path.join(complete_base, category)

    def _get_category_temp_folder(self, category: str) -> Optional[str]:
        """Get the incomplete (temp) folder for a category."""
        import os
        if not category:
            return None
        folders = self._get_folders()
        temp_folder = folders.get("temp_folder", "/downloads/incomplete")
        return os.path.join(temp_folder, category)

    # ── Mutating methods (forwarded to child process) ──

    def add_nzb(self, **kwargs) -> Tuple[bool, str, str]:
        # Longer timeout — add_nzb fetches the NZB URL, parses XML, and
        # saves state.  During heavy downloads (120 threads), the child's
        # main thread competes for the GIL and may take a while.
        result = self._send_command("add_nzb", kwargs=kwargs, timeout=120.0)
        if isinstance(result, (list, tuple)) and len(result) == 3:
            return tuple(result)
        return (False, "Unexpected response from download process", "")

    def pause_item(self, nzb_id: str) -> bool:
        return bool(self._send_command("pause_item", args=[nzb_id]))

    def resume_item(self, nzb_id: str) -> bool:
        return bool(self._send_command("resume_item", args=[nzb_id]))

    def remove_item(self, nzb_id: str) -> bool:
        return bool(self._send_command("remove_item", args=[nzb_id]))

    def remove_items(self, nzb_ids: list) -> int:
        return int(self._send_command("remove_items", args=[nzb_ids]) or 0)

    def set_item_priority(self, nzb_id: str, priority: str) -> bool:
        return bool(self._send_command("set_item_priority", args=[nzb_id, priority]))

    def set_items_priority(self, nzb_ids: list, priority: str) -> int:
        return int(self._send_command("set_items_priority", args=[nzb_ids, priority]) or 0)

    def set_speed_limit(self, bps: int):
        self._send_command("set_speed_limit", args=[bps])

    def pause_all(self):
        self._send_command("pause_all")

    def resume_all(self):
        self._send_command("resume_all")

    def clear_history(self):
        self._send_command("clear_history")

    def delete_history_item(self, nzb_id: str):
        self._send_command("delete_history_item", args=[nzb_id])

    def dismiss_warning(self, warning_id: str):
        self._send_command("dismiss_warning", args=[warning_id])

    def dismiss_all_warnings(self):
        self._send_command("dismiss_all_warnings")

    def configure_servers(self):
        self._send_command("configure_servers", timeout=10.0)

    def test_servers(self):
        return self._send_command("test_servers", timeout=30.0) or []

    def stop(self):
        """Stop the child process."""
        if self._process and self._process.is_alive():
            logger.info("Stopping download child process...")
            try:
                self._send_command("stop", timeout=10.0)
            except Exception:
                pass
            self._process.terminate()
            self._process.join(timeout=5)
            if self._process.is_alive():
                self._process.kill()
            logger.info("Download child process stopped")
        # Clean up IPC file
        try:
            os.unlink(self._ipc_path)
        except Exception:
            pass
