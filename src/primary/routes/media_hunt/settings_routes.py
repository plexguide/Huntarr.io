"""TV Hunt settings – TV Management stub."""
from flask import jsonify

from .helpers import _get_tv_hunt_instance_id_from_request


def register_tv_settings_routes(bp):
    """Register TV Hunt settings routes."""

    @bp.route('/api/tv-hunt/settings/tv-management', methods=['GET'])
    def api_tv_hunt_tv_management_get():
        """Get TV management settings. Stub: returns empty until TV management is implemented."""
        try:
            _get_tv_hunt_instance_id_from_request()
        except Exception:
            pass
        return jsonify({}), 200

    @bp.route('/api/tv-hunt/settings/tv-management', methods=['PATCH'])
    def api_tv_hunt_tv_management_patch():
        """Update TV management settings. Stub: no-op until TV management is implemented."""
        try:
            _get_tv_hunt_instance_id_from_request()
        except Exception:
            pass
        return jsonify({}), 200
