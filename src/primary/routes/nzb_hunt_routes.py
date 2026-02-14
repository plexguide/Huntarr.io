"""
NZB Hunt Routes - Standalone API routes (independent of Movie Hunt / Requestarr)

Provides:
  - /api/nzb-hunt/settings/folders  GET / POST  - folder configuration
  - /api/nzb-hunt/servers           GET / POST  - list / add servers
  - /api/nzb-hunt/servers/<idx>     PUT / DELETE - update / remove a server
  - /api/nzb-hunt/browse            GET         - file-system directory browser
  - /api/nzb-hunt/queue             GET         - download queue
  - /api/nzb-hunt/queue/add         POST        - add NZB to queue
  - /api/nzb-hunt/queue/<id>/*      POST/DELETE - pause/resume/remove queue items
  - /api/nzb-hunt/status            GET         - overall status
  - /api/nzb-hunt/history           GET         - download history
  - /api/nzb-hunt/universal-settings GET / PUT  - universal settings (show on home)
  - /api/nzb-hunt/home-stats        GET         - aggregated stats for home page card
"""

import os
import json

from flask import Blueprint, request, jsonify
from src.primary.utils.logger import get_logger
from src.primary.utils.config_paths import CONFIG_DIR

logger = get_logger("nzb_hunt")

nzb_hunt_bp = Blueprint("nzb_hunt", __name__)

# ──────────────────────────────────────────────────────────────────
# Persistence helpers  (simple JSON file inside /config or data/)
# ──────────────────────────────────────────────────────────────────

def _config_dir():
    """Return the config directory — uses centralized CONFIG_DIR from config_paths."""
    return CONFIG_DIR


def _nzb_config_path():
    return os.path.join(_config_dir(), "nzb_hunt_config.json")


def _load_config():
    path = _nzb_config_path()
    if os.path.exists(path):
        try:
            with open(path, "r") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def has_nzb_servers() -> bool:
    """Check if any usenet servers are configured. Uses same config path as server add/edit."""
    return len(_load_config().get("servers", [])) > 0


def _save_config(cfg):
    path = _nzb_config_path()
    try:
        with open(path, "w") as f:
            json.dump(cfg, f, indent=2)
    except Exception as e:
        logger.error(f"Failed to save NZB Hunt config: {e}")


# ──────────────────────────────────────────────────────────────────
# Folder settings
# ──────────────────────────────────────────────────────────────────

@nzb_hunt_bp.route("/api/nzb-hunt/settings/folders", methods=["GET"])
def get_nzb_folders():
    cfg = _load_config()
    folders = cfg.get("folders", {})
    return jsonify({
        "temp_folder": folders.get("temp_folder", "/downloads/incomplete"),
    })


@nzb_hunt_bp.route("/api/nzb-hunt/settings/folders", methods=["POST"])
def save_nzb_folders():
    data = request.get_json(silent=True) or {}
    cfg = _load_config()
    temp_folder = data.get("temp_folder", "/downloads/incomplete")
    # Derive complete base from temp so download_folder stays in sync
    complete_base = _temp_to_complete_base(temp_folder)
    cfg["folders"] = {
        "download_folder": complete_base,
        "temp_folder": temp_folder,
    }
    _save_config(cfg)
    return jsonify({"success": True})


# ──────────────────────────────────────────────────────────────────
# Processing settings
# ──────────────────────────────────────────────────────────────────

_PROCESSING_DEFAULTS = {
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


@nzb_hunt_bp.route("/api/nzb-hunt/settings/processing", methods=["GET"])
def get_nzb_processing():
    cfg = _load_config()
    proc = cfg.get("processing", {})
    result = {}
    for key, default in _PROCESSING_DEFAULTS.items():
        result[key] = proc.get(key, default)
    return jsonify(result)


@nzb_hunt_bp.route("/api/nzb-hunt/settings/processing", methods=["POST"])
def save_nzb_processing():
    data = request.get_json(silent=True) or {}
    cfg = _load_config()
    proc = {}
    for key, default in _PROCESSING_DEFAULTS.items():
        if key in data:
            # Ensure correct types
            if isinstance(default, bool):
                proc[key] = bool(data[key])
            elif isinstance(default, int):
                try:
                    proc[key] = int(data[key])
                except (ValueError, TypeError):
                    proc[key] = default
            else:
                proc[key] = str(data[key])
        else:
            proc[key] = cfg.get("processing", {}).get(key, default)
    cfg["processing"] = proc
    _save_config(cfg)
    return jsonify({"success": True})


# ──────────────────────────────────────────────────────────────────
# Advanced settings
# ──────────────────────────────────────────────────────────────────

_ADVANCED_DEFAULTS = {
    "receive_threads": 2,
    "downloader_sleep_time": 10,
    "direct_unpack_threads": 3,
    "size_limit": "",
    "req_completion_rate": 100.2,
    "max_url_retries": 10,
}


@nzb_hunt_bp.route("/api/nzb-hunt/settings/advanced", methods=["GET"])
def get_nzb_advanced():
    cfg = _load_config()
    adv = cfg.get("advanced", {})
    result = {}
    for key, default in _ADVANCED_DEFAULTS.items():
        result[key] = adv.get(key, default)
    return jsonify(result)


@nzb_hunt_bp.route("/api/nzb-hunt/settings/advanced", methods=["POST"])
def save_nzb_advanced():
    data = request.get_json(silent=True) or {}
    cfg = _load_config()
    adv = {}
    for key, default in _ADVANCED_DEFAULTS.items():
        if key in data:
            if isinstance(default, bool):
                adv[key] = bool(data[key])
            elif isinstance(default, int):
                try:
                    adv[key] = int(data[key])
                except (ValueError, TypeError):
                    adv[key] = default
            elif isinstance(default, float):
                try:
                    adv[key] = float(data[key])
                except (ValueError, TypeError):
                    adv[key] = default
            else:
                adv[key] = str(data[key])
        else:
            adv[key] = cfg.get("advanced", {}).get(key, default)
    cfg["advanced"] = adv
    _save_config(cfg)
    return jsonify({"success": True})


# ──────────────────────────────────────────────────────────────────
# Display preferences (queue / history view settings)
# ──────────────────────────────────────────────────────────────────

_DISPLAY_PREFS_DEFAULTS = {
    "queue":   {"refreshRate": 3, "perPage": 20},
    "history": {
        "refreshRate": 30,
        "perPage": 20,
        "dateFormat": "relative",
        "showCategory": False,
        "showSize": False,
        "showIndexer": False,
    },
}


@nzb_hunt_bp.route("/api/nzb-hunt/settings/display-prefs", methods=["GET"])
def get_nzb_display_prefs():
    cfg = _load_config()
    saved = cfg.get("display_prefs", {})
    result = {}
    for ctx in ("queue", "history"):
        defaults = _DISPLAY_PREFS_DEFAULTS[ctx]
        section = saved.get(ctx, {})
        result[ctx] = {}
        for key, default in defaults.items():
            result[ctx][key] = section.get(key, default)
    return jsonify(result)


@nzb_hunt_bp.route("/api/nzb-hunt/settings/display-prefs", methods=["POST"])
def save_nzb_display_prefs():
    data = request.get_json(silent=True) or {}
    cfg = _load_config()
    prefs = cfg.get("display_prefs", {})
    for ctx in ("queue", "history"):
        if ctx not in data:
            continue
        incoming = data[ctx]
        defaults = _DISPLAY_PREFS_DEFAULTS[ctx]
        section = prefs.get(ctx, {})
        for key, default in defaults.items():
            if key in incoming:
                if isinstance(default, bool):
                    section[key] = bool(incoming[key])
                elif isinstance(default, int):
                    try:
                        section[key] = int(incoming[key])
                    except (ValueError, TypeError):
                        section[key] = default
                else:
                    section[key] = str(incoming[key])
            else:
                section.setdefault(key, default)
        prefs[ctx] = section
    cfg["display_prefs"] = prefs
    _save_config(cfg)
    return jsonify({"success": True})


# ──────────────────────────────────────────────────────────────────
# Server CRUD
# ──────────────────────────────────────────────────────────────────

def _mask_field(value, show_last=4):
    """Return a masked version of sensitive fields."""
    if not value:
        return ""
    if len(value) <= show_last:
        return "*" * len(value)
    return "*" * (len(value) - show_last) + value[-show_last:]


def _server_bandwidth_key(name: str, host: str) -> str:
    return f"{name} ({host})"


@nzb_hunt_bp.route("/api/nzb-hunt/servers", methods=["GET"])
def list_nzb_servers():
    cfg = _load_config()
    servers = cfg.get("servers", [])
    bandwidth_by_server = {}
    try:
        mgr = _get_download_manager()
        bandwidth_by_server = mgr.get_status().get("bandwidth_by_server", {})
        # Flush bandwidth history periodically
        from src.primary.apps.nzb_hunt.bandwidth_history import get_bandwidth_history
        hist = get_bandwidth_history(_config_dir())
        hist.flush(bandwidth_by_server)
    except Exception:
        pass

    bw_stats = {}
    try:
        from src.primary.apps.nzb_hunt.bandwidth_history import get_bandwidth_history
        hist = get_bandwidth_history(_config_dir())
        bw_stats = hist.get_all_stats(bandwidth_by_server)
    except Exception:
        pass

    result = []
    for srv in servers:
        s = dict(srv)
        raw_pw = s.get("password", "")
        s["has_password"] = bool(raw_pw)
        s["password_masked"] = _mask_field(raw_pw, show_last=4) if raw_pw else ""
        s["password"] = ""  # never return actual password

        key = _server_bandwidth_key(s.get("name", "Server"), s.get("host", ""))
        stats = bw_stats.get(key, {})
        s["bandwidth_1h"] = stats.get("bandwidth_1h", 0)
        s["bandwidth_24h"] = stats.get("bandwidth_24h", 0)
        s["bandwidth_30d"] = stats.get("bandwidth_30d", 0)
        s["bandwidth_total"] = stats.get("bandwidth_total", 0)
        s["bandwidth_used"] = s["bandwidth_total"]  # legacy
        result.append(s)

    # Bar scale: relative to max across servers (min 1GB so bar is visible)
    max_total = max((s["bandwidth_total"] for s in result), default=0)
    scale = max(max_total, 1024 ** 3)
    for s in result:
        s["bandwidth_pct"] = min(100, 100 * s["bandwidth_total"] / scale) if scale else 0

    return jsonify({"servers": result})


@nzb_hunt_bp.route("/api/nzb-hunt/servers", methods=["POST"])
def add_nzb_server():
    data = request.get_json(silent=True) or {}
    host = (data.get("host") or "").strip()
    if not host:
        return jsonify({"success": False, "error": "Host is required"}), 400
    cfg = _load_config()
    servers = cfg.get("servers", [])
    server = {
        "name": (data.get("name") or "Server").strip() or "Server",
        "host": host,
        "port": int(data.get("port", 563)),
        "ssl": bool(data.get("ssl", True)),
        "username": (data.get("username") or "").strip(),
        "password": data.get("password", ""),
        "connections": int(data.get("connections", 8)),
        "priority": int(data.get("priority", 0)),
        "enabled": bool(data.get("enabled", True)),
        "bandwidth_used": 0,
        "bandwidth_pct": 0,
    }
    servers.append(server)
    cfg["servers"] = servers
    _save_config(cfg)
    try:
        mgr = _get_download_manager()
        mgr.configure_servers()
    except Exception:
        pass
    return jsonify({"success": True, "index": len(servers) - 1})


@nzb_hunt_bp.route("/api/nzb-hunt/servers/<int:index>", methods=["PUT"])
def update_nzb_server(index):
    data = request.get_json(silent=True) or {}
    host = (data.get("host") or "").strip()
    if not host:
        return jsonify({"success": False, "error": "Host is required"}), 400
    cfg = _load_config()
    servers = cfg.get("servers", [])
    if index < 0 or index >= len(servers):
        return jsonify({"success": False, "error": "Invalid index"}), 400
    srv = servers[index]
    srv["name"] = (data.get("name", srv.get("name", "Server")) or "Server").strip() or "Server"
    srv["host"] = host
    srv["port"] = int(data.get("port", srv.get("port", 563)))
    srv["ssl"] = bool(data.get("ssl", srv.get("ssl", True)))
    srv["username"] = data.get("username", srv.get("username", ""))
    # Only update password if a non-empty value is provided
    pw = data.get("password", "")
    if pw:
        srv["password"] = pw
    srv["connections"] = int(data.get("connections", srv.get("connections", 8)))
    srv["priority"] = int(data.get("priority", srv.get("priority", 0)))
    srv["enabled"] = bool(data.get("enabled", srv.get("enabled", True)))
    cfg["servers"] = servers
    _save_config(cfg)
    try:
        mgr = _get_download_manager()
        mgr.configure_servers()
    except Exception:
        pass
    return jsonify({"success": True})


@nzb_hunt_bp.route("/api/nzb-hunt/servers/<int:index>", methods=["DELETE"])
def delete_nzb_server(index):
    cfg = _load_config()
    servers = cfg.get("servers", [])
    if index < 0 or index >= len(servers):
        return jsonify({"success": False, "error": "Invalid index"}), 400
    servers.pop(index)
    cfg["servers"] = servers
    _save_config(cfg)
    try:
        mgr = _get_download_manager()
        mgr.configure_servers()
    except Exception:
        pass
    return jsonify({"success": True})


# ──────────────────────────────────────────────────────────────────
# Auto-generated categories from Movie Hunt + TV Hunt instances
# ──────────────────────────────────────────────────────────────────

def _instance_name_to_category(name: str, prefix: str) -> str:
    """Convert instance name to category: Movies-Instance_Name or TV-Instance_Name (spaces -> _)."""
    safe = (name or "").strip() or "Unnamed"
    safe = safe.replace(" ", "_")
    return f"{prefix}-{safe}"


def _get_categories_from_instances():
    """Build category list from Movie Hunt and TV Hunt instances. Merge with persisted known (never remove)."""
    from src.primary.utils.database import get_database
    cfg = _load_config()
    known = set(cfg.get("known_category_names", []))

    try:
        db = get_database()
        mh = db.get_movie_hunt_instances() or []
        th = db.get_tv_hunt_instances() or []
    except Exception:
        mh, th = [], []

    for inst in mh:
        name = inst.get("name") or "Unnamed"
        known.add(_instance_name_to_category(name, "Movies"))
    for inst in th:
        name = inst.get("name") or "Unnamed"
        known.add(_instance_name_to_category(name, "TV"))

    # Persist known (grows over time, never shrinks on instance delete/rename)
    cfg["known_category_names"] = sorted(known)
    _save_config(cfg)

    return sorted(known)


def _temp_to_complete_base(temp_folder: str) -> str:
    """Derive complete base from temp folder: /downloads/incomplete -> /downloads/complete."""
    if not temp_folder or temp_folder == "/":
        return "/downloads/complete"
    parent = os.path.dirname(temp_folder.rstrip("/"))
    if not parent:
        parent = "/"
    return os.path.join(parent, "complete")


def _ensure_category_folders_and_status(temp_folder: str, category_names: list) -> list:
    """Create incomplete + complete subfolders for each category. Return status per category."""
    complete_base = _temp_to_complete_base(temp_folder)
    results = []

    for cat_name in category_names:
        inc_path = os.path.join(temp_folder, cat_name)
        com_path = os.path.join(complete_base, cat_name)
        status = {"name": cat_name, "folder": com_path, "incomplete_folder": inc_path, "ok": False, "error": None}

        try:
            os.makedirs(inc_path, exist_ok=True)
            os.makedirs(com_path, exist_ok=True)
            # Quick write check: create a temp file and remove it
            test = os.path.join(com_path, ".nzbhunt_write_test")
            with open(test, "w") as f:
                f.write("")
            os.remove(test)
            status["ok"] = True
        except PermissionError as e:
            status["error"] = "Not writeable"
            logger.warning("Category folder %r not writeable: %s", com_path, e)
        except OSError as e:
            status["error"] = str(e) or "Cannot create"
            logger.warning("Could not create category folder %r: %s", com_path, e)

        results.append(status)

    return results


@nzb_hunt_bp.route("/api/nzb-hunt/categories", methods=["GET"])
def list_nzb_categories():
    """Return auto-generated categories from instances. No manual add/edit/delete."""
    cfg = _load_config()
    folders = cfg.get("folders", {})
    temp_folder = folders.get("temp_folder", "/downloads/incomplete")
    complete_base = _temp_to_complete_base(temp_folder)

    category_names = _get_categories_from_instances()
    categories = []
    for name in category_names:
        inc_path = os.path.join(temp_folder, name)
        com_path = os.path.join(complete_base, name)
        categories.append({
            "name": name,
            "folder": com_path,
            "incomplete_folder": inc_path,
            "priority": "normal",
        })

    return jsonify({
        "categories": categories,
        "base_folder": complete_base,
        "temp_folder": temp_folder,
    })


@nzb_hunt_bp.route("/api/nzb-hunt/categories/ensure-folders", methods=["POST"])
def ensure_category_folders():
    """Create category folders (incomplete + complete). Call on page load + every 15 min when NZB Hunt runs."""
    cfg = _load_config()
    folders = cfg.get("folders", {})
    temp_folder = folders.get("temp_folder", "/downloads/incomplete")
    category_names = _get_categories_from_instances()

    if not category_names:
        return jsonify({"success": True, "status": []})

    status_list = _ensure_category_folders_and_status(temp_folder, category_names)
    return jsonify({"success": True, "status": status_list})


# ──────────────────────────────────────────────────────────────────
# File browser
# ──────────────────────────────────────────────────────────────────

@nzb_hunt_bp.route("/api/nzb-hunt/browse", methods=["GET"])
def browse_nzb_dirs():
    path = request.args.get("path", "/")
    if ".." in path:
        return jsonify({"path": "/", "directories": [], "error": "Invalid path"}), 400

    path = os.path.abspath(os.path.normpath(path))
    
    # Security: restrict browsing to allowed root directories to prevent directory traversal
    ALLOWED_ROOTS = ["/media", "/downloads", "/data", "/mnt", "/config", "/share", "/shares"]
    if path != "/" and not any(path == root or path.startswith(root + os.sep) for root in ALLOWED_ROOTS):
        return jsonify({"path": "/", "directories": [], "error": "Access denied: path outside allowed directories"}), 403

    try:
        entries = sorted(os.listdir(path))
    except Exception as e:
        return jsonify({"path": path, "directories": [], "error": "Cannot list directory"})

    dirs = []
    for entry in entries:
        full = os.path.join(path, entry)
        if os.path.isdir(full):
            dirs.append({"name": entry, "path": full})

    # At root, always include common directories if they exist
    if path == "/":
        for special in ALLOWED_ROOTS:
            if os.path.isdir(special) and not any(d["path"] == special for d in dirs):
                dirs.append({"name": os.path.basename(special), "path": special})
        dirs.sort(key=lambda d: d["name"])

    return jsonify({"path": path, "directories": dirs})


# ──────────────────────────────────────────────────────────────────
# Download Queue & Status (used by NZB Hunt UI and Movie Hunt integration)
# ──────────────────────────────────────────────────────────────────

def _get_download_manager():
    """Lazy import to avoid circular imports."""
    from src.primary.apps.nzb_hunt.download_manager import get_manager
    return get_manager()


@nzb_hunt_bp.route("/api/nzb-hunt/status", methods=["GET"])
def nzb_hunt_status():
    """Get overall NZB Hunt download status."""
    try:
        mgr = _get_download_manager()
        status = mgr.get_status()
        bandwidth = status.get("bandwidth_by_server", {})
        if bandwidth:
            try:
                from src.primary.apps.nzb_hunt.bandwidth_history import get_bandwidth_history
                get_bandwidth_history(_config_dir()).flush(bandwidth)
            except Exception:
                pass
        return jsonify(status)
    except Exception as e:
        logger.exception("NZB Hunt status error")
        return jsonify({"error": str(e)}), 500


@nzb_hunt_bp.route("/api/nzb-hunt/queue", methods=["GET"])
def nzb_hunt_queue():
    """Get current download queue."""
    try:
        mgr = _get_download_manager()
        return jsonify({"queue": mgr.get_queue()})
    except Exception as e:
        logger.exception("NZB Hunt queue error")
        return jsonify({"queue": [], "error": str(e)}), 500


@nzb_hunt_bp.route("/api/nzb-hunt/queue/add", methods=["POST"])
def nzb_hunt_queue_add():
    """Add an NZB to the download queue.
    
    Body: { nzb_url, nzb_content, name, category, priority, added_by, nzb_name, indexer, source_instance_id, source_instance_name }
    At least one of nzb_url or nzb_content is required.
    """
    try:
        data = request.get_json(silent=True) or {}
        nzb_url = (data.get("nzb_url") or "").strip()
        nzb_content = (data.get("nzb_content") or "").strip()
        name = (data.get("name") or "").strip()
        category = (data.get("category") or "").strip()
        priority = (data.get("priority") or "normal").strip()
        added_by = (data.get("added_by") or "manual").strip()
        nzb_name = (data.get("nzb_name") or "").strip()
        indexer = (data.get("indexer") or "").strip()
        source_instance_id = str(data.get("source_instance_id", "") or "").strip()
        source_instance_name = (data.get("source_instance_name") or "").strip()

        if not nzb_url and not nzb_content:
            return jsonify({"success": False, "error": "nzb_url or nzb_content required"}), 400

        mgr = _get_download_manager()
        success, message, queue_id = mgr.add_nzb(
            nzb_url=nzb_url,
            nzb_content=nzb_content,
            name=name,
            category=category,
            priority=priority,
            added_by=added_by,
            nzb_name=nzb_name,
            indexer=indexer,
            source_instance_id=source_instance_id,
            source_instance_name=source_instance_name,
        )
        return jsonify({"success": success, "message": message, "queue_id": queue_id})
    except Exception as e:
        logger.exception("NZB Hunt queue add error")
        return jsonify({"success": False, "error": str(e)}), 500


@nzb_hunt_bp.route("/api/nzb-hunt/queue/<nzb_id>/pause", methods=["POST"])
def nzb_hunt_queue_pause(nzb_id):
    """Pause a download."""
    try:
        mgr = _get_download_manager()
        return jsonify({"success": mgr.pause_item(nzb_id)})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@nzb_hunt_bp.route("/api/nzb-hunt/queue/<nzb_id>/resume", methods=["POST"])
def nzb_hunt_queue_resume(nzb_id):
    """Resume a paused download."""
    try:
        mgr = _get_download_manager()
        return jsonify({"success": mgr.resume_item(nzb_id)})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@nzb_hunt_bp.route("/api/nzb-hunt/queue/<nzb_id>", methods=["DELETE"])
def nzb_hunt_queue_remove(nzb_id):
    """Remove a download from the queue."""
    try:
        mgr = _get_download_manager()
        return jsonify({"success": mgr.remove_item(nzb_id)})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@nzb_hunt_bp.route("/api/nzb-hunt/history", methods=["GET"])
def nzb_hunt_history():
    """Get download history."""
    try:
        limit = request.args.get("limit", 5000, type=int)
        mgr = _get_download_manager()
        return jsonify({"history": mgr.get_history(limit=limit)})
    except Exception as e:
        logger.exception("NZB Hunt history error")
        return jsonify({"history": [], "error": str(e)}), 500


@nzb_hunt_bp.route("/api/nzb-hunt/history", methods=["DELETE"])
def nzb_hunt_clear_history():
    """Clear download history."""
    try:
        mgr = _get_download_manager()
        mgr.clear_history()
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@nzb_hunt_bp.route("/api/nzb-hunt/history/<path:nzb_id>", methods=["DELETE"])
def nzb_hunt_delete_history_item(nzb_id):
    """Delete a single history item by its nzo_id."""
    try:
        mgr = _get_download_manager()
        if hasattr(mgr, 'delete_history_item'):
            mgr.delete_history_item(nzb_id)
        else:
            # Fallback: filter from history file
            history = mgr.get_history(limit=10000)
            history = [h for h in history if h.get('nzo_id') != nzb_id and h.get('id') != nzb_id]
            mgr._save_history(history)
        return jsonify({"success": True})
    except Exception as e:
        logger.exception("Delete history item error: %s", nzb_id)
        return jsonify({"success": False, "error": str(e)}), 500


# ──────────────────────────────────────────────────────────────────
# Speed Limit
# ──────────────────────────────────────────────────────────────────

@nzb_hunt_bp.route("/api/nzb-hunt/speed-limit", methods=["GET"])
def nzb_hunt_get_speed_limit():
    """Get current download speed limit."""
    try:
        mgr = _get_download_manager()
        bps = mgr.get_speed_limit()
        return jsonify({
            "speed_limit_bps": bps,
            "speed_limit_human": f"{bps / (1024*1024):.1f} MB/s" if bps > 0 else "Unlimited",
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@nzb_hunt_bp.route("/api/nzb-hunt/speed-limit", methods=["POST"])
def nzb_hunt_set_speed_limit():
    """Set download speed limit.
    Body: { speed_limit_bps: int }  (0 = unlimited)
    """
    try:
        data = request.get_json(silent=True) or {}
        bps = int(data.get("speed_limit_bps", 0))
        mgr = _get_download_manager()
        mgr.set_speed_limit(bps)
        return jsonify({
            "success": True,
            "speed_limit_bps": bps,
            "speed_limit_human": f"{bps / (1024*1024):.1f} MB/s" if bps > 0 else "Unlimited",
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ──────────────────────────────────────────────────────────────────
# Pause / Resume All
# ──────────────────────────────────────────────────────────────────

@nzb_hunt_bp.route("/api/nzb-hunt/queue/pause-all", methods=["POST"])
def nzb_hunt_pause_all():
    """Pause all downloads."""
    try:
        mgr = _get_download_manager()
        mgr.pause_all()
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@nzb_hunt_bp.route("/api/nzb-hunt/queue/resume-all", methods=["POST"])
def nzb_hunt_resume_all():
    """Resume all paused downloads."""
    try:
        mgr = _get_download_manager()
        mgr.resume_all()
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@nzb_hunt_bp.route("/api/nzb-hunt/warnings", methods=["GET"])
def nzb_hunt_warnings():
    """Get active warnings."""
    try:
        mgr = _get_download_manager()
        return jsonify({"warnings": mgr.get_warnings()})
    except Exception as e:
        return jsonify({"warnings": [], "error": str(e)}), 500


@nzb_hunt_bp.route("/api/nzb-hunt/warnings/dismiss", methods=["POST"])
def nzb_hunt_dismiss_warning():
    """Dismiss a specific warning or all warnings."""
    try:
        data = request.get_json(silent=True) or {}
        mgr = _get_download_manager()
        warning_id = data.get("id")
        if warning_id == "__all__":
            mgr.dismiss_all_warnings()
        elif warning_id:
            mgr.dismiss_warning(warning_id)
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@nzb_hunt_bp.route("/api/nzb-hunt/test-servers", methods=["POST"])
def nzb_hunt_test_servers():
    """Test all configured NNTP server connections."""
    try:
        mgr = _get_download_manager()
        results = mgr.test_servers()
        return jsonify({
            "success": any(r[1] for r in results),
            "results": [
                {"name": r[0], "success": r[1], "message": r[2]}
                for r in results
            ]
        })
    except Exception as e:
        logger.exception("NZB Hunt test servers error")
        return jsonify({"success": False, "error": str(e)}), 500


@nzb_hunt_bp.route("/api/nzb-hunt/test-server", methods=["POST"])
def nzb_hunt_test_single_server():
    """Test a single NNTP server connection (used by modal auto-test).
    Body: { host, port, ssl, username, password, server_index? }
    If password is empty and server_index is provided, uses the saved password.
    """
    try:
        data = request.get_json(silent=True) or {}
        host = (data.get("host") or "").strip()
        if not host:
            return jsonify({"success": False, "message": "Host is required"}), 200

        port = int(data.get("port", 563))
        use_ssl = bool(data.get("ssl", True))
        username = (data.get("username") or "").strip()
        password = (data.get("password") or "").strip()

        # If no password provided but we have a server_index, use the saved password
        if not password and data.get("server_index") is not None:
            try:
                idx = int(data["server_index"])
                cfg = _load_config()
                servers = cfg.get("servers", [])
                if 0 <= idx < len(servers):
                    password = servers[idx].get("password", "")
            except (ValueError, TypeError):
                pass

        from src.primary.apps.nzb_hunt.nntp_client import NNTPConnectionPool
        pool = NNTPConnectionPool({
            "name": "test",
            "host": host,
            "port": port,
            "ssl": use_ssl,
            "username": username,
            "password": password,
            "connections": 1,
            "enabled": True,
        }, max_connections=1)
        success, msg = pool.test_connection()
        return jsonify({"success": success, "message": msg})
    except Exception as e:
        logger.exception("NZB Hunt test single server error")
        return jsonify({"success": False, "message": str(e)}), 200


# ──────────────────────────────────────────────────────────────────
# Universal Settings (show on home page toggle)
# ──────────────────────────────────────────────────────────────────

@nzb_hunt_bp.route("/api/nzb-hunt/universal-settings", methods=["GET"])
def get_nzb_universal_settings():
    """Return NZB Hunt universal settings."""
    try:
        cfg = _load_config()
        universal = cfg.get("universal", {})
        folders = cfg.get("folders", {})
        category_names = _get_categories_from_instances()
        return jsonify({
            "show_on_home": universal.get("show_on_home", True),
            "temp_folder": folders.get("temp_folder", "/downloads/incomplete"),
            "category_count": len(category_names),
        })
    except Exception as e:
        logger.exception("NZB Hunt universal settings GET error")
        return jsonify({"show_on_home": True, "temp_folder": "/downloads/incomplete", "category_count": 0}), 200


@nzb_hunt_bp.route("/api/nzb-hunt/universal-settings", methods=["PUT"])
def save_nzb_universal_settings():
    """Save NZB Hunt universal settings."""
    try:
        data = request.get_json(silent=True) or {}
        cfg = _load_config()
        universal = cfg.get("universal", {})
        if "show_on_home" in data:
            universal["show_on_home"] = bool(data["show_on_home"])
        cfg["universal"] = universal
        _save_config(cfg)
        return jsonify({"success": True})
    except Exception as e:
        logger.exception("NZB Hunt universal settings PUT error")
        return jsonify({"success": False, "error": str(e)}), 500


# ──────────────────────────────────────────────────────────────────
# Home Page Stats (aggregated for dashboard card)
# ──────────────────────────────────────────────────────────────────

@nzb_hunt_bp.route("/api/nzb-hunt/home-stats", methods=["GET"])
def nzb_hunt_home_stats():
    """Return aggregated NZB Hunt stats for the home page activity card."""
    try:
        cfg = _load_config()
        show_on_home = cfg.get("universal", {}).get("show_on_home", True)
        if not show_on_home:
            return jsonify({"visible": False})

        # Live status from download manager
        speed_bps = 0
        active_count = 0
        queued_count = 0
        try:
            mgr = _get_download_manager()
            status = mgr.get_status()
            speed_bps = status.get("speed_bps", 0)
            active_count = status.get("active_count", 0)
            queued_count = status.get("queued_count", 0)
        except Exception:
            pass

        # Cumulative stats from history
        completed = 0
        failed = 0
        try:
            mgr = _get_download_manager()
            history = mgr.get_history(limit=50000)
            for item in history:
                state = item.get("state", "")
                if state == "completed":
                    completed += 1
                elif state == "failed":
                    failed += 1
        except Exception:
            pass

        return jsonify({
            "visible": True,
            "speed_bps": speed_bps,
            "active_count": active_count,
            "queued_count": queued_count,
            "completed": completed,
            "failed": failed,
        })
    except Exception as e:
        logger.exception("NZB Hunt home stats error")
        return jsonify({"visible": False, "error": str(e)}), 200
