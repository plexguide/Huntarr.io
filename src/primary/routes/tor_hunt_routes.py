"""
Tor Hunt Routes — API routes for the built-in torrent download engine.

The built-in engine uses libtorrent in a child process (same pattern as NZB Hunt).
External qBittorrent support is handled via the client system in Movie/TV Hunt settings.
"""

import os
import json

from flask import Blueprint, request, jsonify
from src.primary.utils.logger import get_logger
from src.primary.utils.config_paths import CONFIG_DIR

logger = get_logger("tor_hunt")

tor_hunt_bp = Blueprint("tor_hunt", __name__)


def _get_manager():
    """Lazy import to avoid circular imports."""
    from src.primary.apps.tor_hunt.tor_hunt_manager import get_manager
    return get_manager()


# ──────────────────────────────────────────────────────────────────
# Settings
# ──────────────────────────────────────────────────────────────────

@tor_hunt_bp.route("/api/tor-hunt/settings", methods=["GET"])
def get_tor_hunt_settings():
    """Get Tor Hunt engine settings."""
    try:
        mgr = _get_manager()
        cfg = mgr.get_config()
        return jsonify(cfg)
    except Exception as e:
        logger.exception("Tor Hunt settings GET error")
        return jsonify({"error": str(e)}), 500


@tor_hunt_bp.route("/api/tor-hunt/settings", methods=["POST"])
def save_tor_hunt_settings():
    """Save Tor Hunt engine settings."""
    try:
        data = request.get_json(silent=True) or {}
        mgr = _get_manager()
        cfg = {
            'listen_port': int(data.get('listen_port', 6881)),
            'download_dir': (data.get('download_dir') or '/downloads/tor-hunt').strip(),
            'temp_dir': (data.get('temp_dir') or '/downloads/tor-hunt/incomplete').strip(),
            'max_connections': int(data.get('max_connections', 200)),
            'max_uploads': int(data.get('max_uploads', -1)),
            'active_downloads': int(data.get('active_downloads', 8)),
            'active_seeds': int(data.get('active_seeds', 10)),
            'active_limit': int(data.get('active_limit', 20)),
            'enable_dht': bool(data.get('enable_dht', True)),
            'enable_lsd': bool(data.get('enable_lsd', True)),
            'enable_upnp': bool(data.get('enable_upnp', True)),
            'enable_natpmp': bool(data.get('enable_natpmp', True)),
            'seed_ratio_limit': float(data.get('seed_ratio_limit', 0)),
            'seed_time_limit': int(data.get('seed_time_limit', 0)),
            'download_rate_limit': int(data.get('download_rate_limit', 0)),
            'upload_rate_limit': int(data.get('upload_rate_limit', 0)),
            'encryption_mode': int(data.get('encryption_mode', 0)),
        }
        mgr.save_config(cfg)
        return jsonify({"success": True})
    except Exception as e:
        logger.exception("Tor Hunt settings POST error")
        return jsonify({"success": False, "error": str(e)}), 500


# ──────────────────────────────────────────────────────────────────
# Poll / Status / Queue
# ──────────────────────────────────────────────────────────────────

@tor_hunt_bp.route("/api/tor-hunt/poll", methods=["GET"])
def tor_hunt_poll():
    """Combined queue + status endpoint."""
    try:
        mgr = _get_manager()
        status = mgr.get_status()
        queue = mgr.get_queue()
        return jsonify({"status": status, "queue": queue})
    except Exception as e:
        logger.exception("Tor Hunt poll error")
        return jsonify({"status": {}, "queue": [], "error": str(e)}), 500


@tor_hunt_bp.route("/api/tor-hunt/status", methods=["GET"])
def tor_hunt_status():
    """Get overall Tor Hunt status."""
    try:
        mgr = _get_manager()
        return jsonify(mgr.get_status())
    except Exception as e:
        logger.exception("Tor Hunt status error")
        return jsonify({"error": str(e)}), 500


@tor_hunt_bp.route("/api/tor-hunt/queue", methods=["GET"])
def tor_hunt_queue():
    """Get active torrent queue."""
    try:
        mgr = _get_manager()
        category = request.args.get('category')
        return jsonify(mgr.get_queue(category=category))
    except Exception as e:
        logger.exception("Tor Hunt queue error")
        return jsonify([])


@tor_hunt_bp.route("/api/tor-hunt/queue/add", methods=["POST"])
def tor_hunt_queue_add():
    """Add torrent via magnet link, URL, or .torrent file upload."""
    try:
        mgr = _get_manager()

        # File upload
        if request.files and 'torrent' in request.files:
            torrent_data = request.files['torrent'].read()
            category = request.form.get('category', '')
            save_path = request.form.get('savepath', '')
            ok, msg, tid = mgr.add_torrent(
                torrent_data=torrent_data, category=category, save_path=save_path
            )
            return jsonify({"success": ok, "message": msg, "id": tid})

        # JSON body
        data = request.get_json(silent=True) or {}
        magnet_url = (data.get('urls') or data.get('url') or data.get('magnet') or '').strip()
        category = (data.get('category') or '').strip()
        save_path = (data.get('savepath') or '').strip()
        name = (data.get('name') or '').strip()

        if not magnet_url:
            return jsonify({"success": False, "error": "No magnet link or URL provided"}), 400

        ok, msg, tid = mgr.add_torrent(
            magnet_url=magnet_url, category=category,
            save_path=save_path, name=name
        )
        return jsonify({"success": ok, "message": msg, "id": tid})
    except Exception as e:
        logger.exception("Tor Hunt queue add error")
        return jsonify({"success": False, "error": str(e)}), 500


@tor_hunt_bp.route("/api/tor-hunt/queue/<torrent_id>/pause", methods=["POST"])
def tor_hunt_queue_pause(torrent_id):
    """Pause a torrent."""
    try:
        return jsonify({"success": _get_manager().pause_item(torrent_id)})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@tor_hunt_bp.route("/api/tor-hunt/queue/<torrent_id>/resume", methods=["POST"])
def tor_hunt_queue_resume(torrent_id):
    """Resume a torrent."""
    try:
        return jsonify({"success": _get_manager().resume_item(torrent_id)})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@tor_hunt_bp.route("/api/tor-hunt/queue/<torrent_id>", methods=["DELETE"])
def tor_hunt_queue_remove(torrent_id):
    """Remove a torrent. Query param delete_files=true to also delete data."""
    try:
        delete_files = request.args.get('delete_files', 'false').lower() == 'true'
        ok = _get_manager().remove_item(torrent_id, delete_files=delete_files)
        return jsonify({"success": ok})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@tor_hunt_bp.route("/api/tor-hunt/queue/pause-all", methods=["POST"])
def tor_hunt_pause_all():
    """Pause all torrents."""
    try:
        return jsonify({"success": _get_manager().pause_all()})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@tor_hunt_bp.route("/api/tor-hunt/queue/resume-all", methods=["POST"])
def tor_hunt_resume_all():
    """Resume all torrents."""
    try:
        return jsonify({"success": _get_manager().resume_all()})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ──────────────────────────────────────────────────────────────────
# History
# ──────────────────────────────────────────────────────────────────

@tor_hunt_bp.route("/api/tor-hunt/history", methods=["GET"])
def tor_hunt_history():
    """Get download history."""
    try:
        return jsonify(_get_manager().get_history())
    except Exception:
        return jsonify([])


@tor_hunt_bp.route("/api/tor-hunt/history", methods=["DELETE"])
def tor_hunt_clear_history():
    """Clear download history."""
    try:
        _get_manager().clear_history()
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@tor_hunt_bp.route("/api/tor-hunt/history/<path:item_id>", methods=["DELETE"])
def tor_hunt_delete_history_item(item_id):
    """Delete a single history item."""
    try:
        ok = _get_manager().delete_history_item(item_id)
        return jsonify({"success": ok})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ──────────────────────────────────────────────────────────────────
# Speed limits
# ──────────────────────────────────────────────────────────────────

@tor_hunt_bp.route("/api/tor-hunt/speed-limit", methods=["GET"])
def tor_hunt_get_speed_limit():
    """Get current speed limit."""
    try:
        limit = _get_manager().get_speed_limit()
        return jsonify({"download_limit": limit, "upload_limit": 0})
    except Exception:
        return jsonify({"download_limit": 0, "upload_limit": 0})


@tor_hunt_bp.route("/api/tor-hunt/speed-limit", methods=["POST"])
def tor_hunt_set_speed_limit():
    """Set download speed limit. Body: {limit: bytes_per_sec} (0 = unlimited)."""
    try:
        data = request.get_json(silent=True) or {}
        limit = int(data.get('limit', 0))
        ok = _get_manager().set_speed_limit(limit)
        return jsonify({"success": ok})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ──────────────────────────────────────────────────────────────────
# Home stats
# ──────────────────────────────────────────────────────────────────

@tor_hunt_bp.route("/api/tor-hunt/home-stats", methods=["GET"])
def tor_hunt_home_stats():
    """Aggregated stats for home page card."""
    try:
        mgr = _get_manager()
        if not mgr.has_connection():
            return jsonify({"configured": False})
        status = mgr.get_status()
        history = mgr.get_history()
        return jsonify({
            "configured": True,
            "connected": status.get('connected', False),
            "engine": status.get('engine', 'built-in'),
            "downloading": status.get('downloading', 0),
            "seeding": status.get('seeding', 0),
            "dl_speed": status.get('dl_speed', 0),
            "up_speed": status.get('up_speed', 0),
            "total_completed": len(history),
        })
    except Exception:
        return jsonify({"configured": False})


@tor_hunt_bp.route("/api/tor-hunt/is-client-configured", methods=["GET"])
def tor_hunt_is_client_configured():
    """Check if Tor Hunt engine is available."""
    try:
        mgr = _get_manager()
        return jsonify({"configured": mgr.has_connection()})
    except Exception:
        return jsonify({"configured": False})
