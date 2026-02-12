"""TV Hunt Import Lists – stub (returns empty list until TV import lists are implemented)."""
from flask import jsonify

from . import tv_hunt_bp
from ._helpers import _get_tv_hunt_instance_id_from_request


@tv_hunt_bp.route('/api/tv-hunt/import-lists', methods=['GET'])
def api_tv_hunt_import_lists_list():
    """List TV Hunt import lists. Stub: always returns empty list."""
    try:
        _get_tv_hunt_instance_id_from_request()
        return jsonify({'lists': []}), 200
    except Exception:
        return jsonify({'lists': []}), 200


@tv_hunt_bp.route('/api/tv-hunt/import-lists/types', methods=['GET'])
def api_tv_hunt_import_lists_types():
    """List types for TV Hunt import lists. Stub: returns empty until implemented."""
    return jsonify({'types': []}), 200
