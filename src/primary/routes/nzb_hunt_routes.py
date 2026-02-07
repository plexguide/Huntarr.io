"""
NZB Hunt Routes - Standalone API routes (independent of Movie Hunt / Requestarr)

Provides:
  - /api/nzb-hunt/settings/folders  GET / POST  - folder configuration
  - /api/nzb-hunt/servers           GET / POST  - list / add servers
  - /api/nzb-hunt/servers/<idx>     PUT / DELETE - update / remove a server
  - /api/nzb-hunt/browse            GET         - file-system directory browser
"""

import os
import json

from flask import Blueprint, request, jsonify
from src.primary.utils.logger import get_logger

logger = get_logger("nzb_hunt")

nzb_hunt_bp = Blueprint("nzb_hunt", __name__)

# ──────────────────────────────────────────────────────────────────
# Persistence helpers  (simple JSON file inside /config or data/)
# ──────────────────────────────────────────────────────────────────

def _config_dir():
    """Return the config directory - /config in Docker, <project>/data locally."""
    if os.path.isdir("/config"):
        return "/config"
    # Local dev fallback
    base = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
    data_dir = os.path.join(base, "data")
    os.makedirs(data_dir, exist_ok=True)
    return data_dir


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
        "download_folder": folders.get("download_folder", "/downloads"),
        "temp_folder": folders.get("temp_folder", "/downloads/incomplete"),
        "watched_folder": folders.get("watched_folder", ""),
    })


@nzb_hunt_bp.route("/api/nzb-hunt/settings/folders", methods=["POST"])
def save_nzb_folders():
    data = request.get_json(silent=True) or {}
    cfg = _load_config()
    cfg["folders"] = {
        "download_folder": data.get("download_folder", "/downloads"),
        "temp_folder": data.get("temp_folder", "/downloads/incomplete"),
        "watched_folder": data.get("watched_folder", ""),
    }
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


@nzb_hunt_bp.route("/api/nzb-hunt/servers", methods=["GET"])
def list_nzb_servers():
    cfg = _load_config()
    servers = cfg.get("servers", [])
    # Return servers with masked passwords
    result = []
    for srv in servers:
        s = dict(srv)
        s["password"] = ""  # never return password
        s.setdefault("bandwidth_used", 0)
        s.setdefault("bandwidth_pct", 0)
        result.append(s)
    return jsonify({"servers": result})


@nzb_hunt_bp.route("/api/nzb-hunt/servers", methods=["POST"])
def add_nzb_server():
    data = request.get_json(silent=True) or {}
    cfg = _load_config()
    servers = cfg.get("servers", [])
    server = {
        "name": data.get("name", "Server"),
        "host": data.get("host", ""),
        "port": int(data.get("port", 563)),
        "ssl": bool(data.get("ssl", True)),
        "username": data.get("username", ""),
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
    return jsonify({"success": True, "index": len(servers) - 1})


@nzb_hunt_bp.route("/api/nzb-hunt/servers/<int:index>", methods=["PUT"])
def update_nzb_server(index):
    data = request.get_json(silent=True) or {}
    cfg = _load_config()
    servers = cfg.get("servers", [])
    if index < 0 or index >= len(servers):
        return jsonify({"success": False, "error": "Invalid index"}), 400
    srv = servers[index]
    srv["name"] = data.get("name", srv.get("name", "Server"))
    srv["host"] = data.get("host", srv.get("host", ""))
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
    return jsonify({"success": True})


# ──────────────────────────────────────────────────────────────────
# Category CRUD
# ──────────────────────────────────────────────────────────────────

@nzb_hunt_bp.route("/api/nzb-hunt/settings/categories-base", methods=["POST"])
def save_nzb_categories_base():
    data = request.get_json(silent=True) or {}
    cfg = _load_config()
    cfg["categories_base_folder"] = data.get("base_folder", "/downloads/complete")
    _save_config(cfg)
    return jsonify({"success": True})


@nzb_hunt_bp.route("/api/nzb-hunt/categories", methods=["GET"])
def list_nzb_categories():
    cfg = _load_config()
    return jsonify({
        "categories": cfg.get("categories", []),
        "base_folder": cfg.get("categories_base_folder", "/downloads/complete"),
    })


@nzb_hunt_bp.route("/api/nzb-hunt/categories", methods=["POST"])
def add_nzb_category():
    data = request.get_json(silent=True) or {}
    cfg = _load_config()
    cats = cfg.get("categories", [])
    base = cfg.get("categories_base_folder", "/downloads/complete")
    name = data.get("name", "").strip()
    if not name:
        return jsonify({"success": False, "error": "Name required"}), 400

    folder = data.get("folder", "").strip()
    if not folder:
        safe_name = "".join(c for c in name.lower() if c.isalnum() or c in "_-")
        folder = os.path.join(base, safe_name)

    cat = {
        "name": name,
        "folder": folder,
        "priority": data.get("priority", "normal"),
        "processing": data.get("processing", "default"),
        "indexer_groups": data.get("indexer_groups", ""),
    }
    cats.append(cat)
    cfg["categories"] = cats
    _save_config(cfg)

    # Try to create the folder if it doesn't exist
    try:
        os.makedirs(folder, exist_ok=True)
    except Exception as e:
        logger.warning(f"Could not create category folder {folder}: {e}")

    return jsonify({"success": True, "index": len(cats) - 1})


@nzb_hunt_bp.route("/api/nzb-hunt/categories/<int:index>", methods=["PUT"])
def update_nzb_category(index):
    data = request.get_json(silent=True) or {}
    cfg = _load_config()
    cats = cfg.get("categories", [])
    if index < 0 or index >= len(cats):
        return jsonify({"success": False, "error": "Invalid index"}), 400

    cat = cats[index]
    cat["name"] = data.get("name", cat.get("name", ""))
    cat["folder"] = data.get("folder", cat.get("folder", ""))
    cat["priority"] = data.get("priority", cat.get("priority", "normal"))
    cat["processing"] = data.get("processing", cat.get("processing", "default"))
    cat["indexer_groups"] = data.get("indexer_groups", cat.get("indexer_groups", ""))
    cfg["categories"] = cats
    _save_config(cfg)

    # Try to create the folder if it doesn't exist
    try:
        os.makedirs(cat["folder"], exist_ok=True)
    except Exception as e:
        logger.warning(f"Could not create category folder {cat['folder']}: {e}")

    return jsonify({"success": True})


@nzb_hunt_bp.route("/api/nzb-hunt/categories/<int:index>", methods=["DELETE"])
def delete_nzb_category(index):
    cfg = _load_config()
    cats = cfg.get("categories", [])
    if index < 0 or index >= len(cats):
        return jsonify({"success": False, "error": "Invalid index"}), 400
    cats.pop(index)
    cfg["categories"] = cats
    _save_config(cfg)
    return jsonify({"success": True})


# ──────────────────────────────────────────────────────────────────
# File browser
# ──────────────────────────────────────────────────────────────────

@nzb_hunt_bp.route("/api/nzb-hunt/browse", methods=["GET"])
def browse_nzb_dirs():
    path = request.args.get("path", "/")
    if ".." in path:
        return jsonify({"path": "/", "directories": [], "error": "Invalid path"}), 400

    path = os.path.abspath(os.path.normpath(path))

    try:
        entries = sorted(os.listdir(path))
    except Exception as e:
        return jsonify({"path": path, "directories": [], "error": str(e)})

    dirs = []
    for entry in entries:
        full = os.path.join(path, entry)
        if os.path.isdir(full):
            dirs.append({"name": entry, "path": full})

    # At root, always include /media and /downloads if they exist
    if path == "/":
        for special in ["/media", "/downloads"]:
            if os.path.isdir(special) and not any(d["path"] == special for d in dirs):
                dirs.append({"name": os.path.basename(special), "path": special})
        dirs.sort(key=lambda d: d["name"])

    return jsonify({"path": path, "directories": dirs})
