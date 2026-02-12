"""TV Hunt settings – TV Management stub (naming/folder/episode settings in a future update)."""
from flask import jsonify

from . import tv_hunt_bp
from ._helpers import _get_tv_hunt_instance_id_from_request


@tv_hunt_bp.route('/api/tv-hunt/settings/tv-management', methods=['GET'])
def api_tv_hunt_tv_management_get():
    """Get TV management settings. Stub: returns empty until TV management is implemented."""
    try:
        _get_tv_hunt_instance_id_from_request()
    except Exception:
        pass
    return jsonify({}), 200


@tv_hunt_bp.route('/api/tv-hunt/settings/tv-management', methods=['PATCH'])
def api_tv_hunt_tv_management_patch():
    """Update TV management settings. Stub: no-op until TV management is implemented."""
    try:
        _get_tv_hunt_instance_id_from_request()
    except Exception:
        pass
    return jsonify({}), 200
