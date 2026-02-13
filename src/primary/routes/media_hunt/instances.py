"""Media Hunt – Movie Hunt and TV Hunt instance management (list, create, rename, delete, current)."""

from flask import request, jsonify

from ...utils.database import get_database
from ...utils.logger import get_logger
from ...default_settings import get_movie_hunt_instance_settings_defaults

movie_hunt_logger = get_logger("movie_hunt")
tv_hunt_logger = get_logger("tv_hunt")

MOVIE_HUNT_HUNT_SETTINGS_KEY = "movie_hunt_hunt_settings"
TV_HUNT_HUNT_SETTINGS_KEY = "tv_hunt_hunt_settings"


def _get_movie_hunt_instance_settings(instance_id: int) -> dict:
    """Get per-instance hunt settings for a Movie Hunt instance (merged with defaults)."""
    from src.primary.default_settings import get_movie_hunt_instance_settings_defaults
    db = get_database()
    defaults = get_movie_hunt_instance_settings_defaults()
    saved = db.get_app_config_for_instance(MOVIE_HUNT_HUNT_SETTINGS_KEY, instance_id)
    if not saved or not isinstance(saved, dict):
        return dict(defaults)
    return {k: saved.get(k, defaults[k]) for k in defaults}


def _get_tv_hunt_instance_settings(instance_id: int) -> dict:
    """Get per-instance hunt settings for a TV Hunt instance (merged with defaults)."""
    from src.primary.default_settings import get_tv_hunt_instance_settings_defaults
    db = get_database()
    defaults = get_tv_hunt_instance_settings_defaults()
    saved = db.get_app_config_for_instance(TV_HUNT_HUNT_SETTINGS_KEY, instance_id)
    if not saved or not isinstance(saved, dict):
        return dict(defaults)
    return {k: saved.get(k, defaults[k]) for k in defaults}


def get_universal_video_settings() -> dict:
    """Return universal video settings (shared across all Movie/TV Hunt instances).
    Used for analyze_video_files, video_scan_profile, video_scan_strategy."""
    defaults = {
        "analyze_video_files": True,
        "video_scan_profile": "default",
        "video_scan_strategy": "trust_filename",
    }
    try:
        db = get_database()
        # Try dedicated universal config first
        raw = db.get_app_config("media_hunt_universal_video")
        if raw and isinstance(raw, dict):
            return {
                "analyze_video_files": raw.get("analyze_video_files", defaults["analyze_video_files"]),
                "video_scan_profile": (raw.get("video_scan_profile") or defaults["video_scan_profile"]).strip(),
                "video_scan_strategy": (raw.get("video_scan_strategy") or defaults["video_scan_strategy"]).strip(),
            }
        # Fallback: use first Movie Hunt instance's settings if available
        instances = db.get_movie_hunt_instances()
        if instances:
            inst_id = instances[0]["id"]
            settings = _get_movie_hunt_instance_settings(inst_id)
            return {
                "analyze_video_files": settings.get("analyze_video_files", defaults["analyze_video_files"]),
                "video_scan_profile": (settings.get("video_scan_profile") or defaults["video_scan_profile"]).strip(),
                "video_scan_strategy": (settings.get("video_scan_strategy") or defaults["video_scan_strategy"]).strip(),
            }
    except Exception:
        pass
    return defaults


def register_movie_instances_routes(bp):
    """Register Movie Hunt instance routes: list, create, update, delete, current."""

    @bp.route('/api/movie-hunt/instances', methods=['GET'])
    def list_instances():
        try:
            db = get_database()
            instances = db.get_movie_hunt_instances()
            current_id = db.get_current_movie_hunt_instance_id()
            return jsonify({
                'instances': instances,
                'current_instance_id': current_id,
                'success': True,
            }), 200
        except Exception as e:
            movie_hunt_logger.exception('Movie Hunt instances list error')
            return jsonify({'instances': [], 'error': str(e), 'success': False}), 500

    @bp.route('/api/movie-hunt/instances', methods=['POST'])
    def create_instance():
        try:
            data = request.get_json() or {}
            name = (data.get('name') or '').strip() or 'Unnamed'
            db = get_database()
            new_id = db.create_movie_hunt_instance(name)
            instances = db.get_movie_hunt_instances()
            return jsonify({
                'success': True,
                'id': new_id,
                'instances': instances,
            }), 201
        except Exception as e:
            movie_hunt_logger.exception('Movie Hunt create instance error')
            return jsonify({'success': False, 'error': str(e)}), 500

    @bp.route('/api/movie-hunt/instances/<int:instance_id>', methods=['PUT'])
    def update_instance(instance_id):
        try:
            data = request.get_json() or {}
            name = (data.get('name') or '').strip() or 'Unnamed'
            db = get_database()
            if not db.update_movie_hunt_instance(instance_id, name):
                return jsonify({'success': False, 'error': 'Instance not found'}), 404
            instances = db.get_movie_hunt_instances()
            return jsonify({'success': True, 'instances': instances}), 200
        except Exception as e:
            movie_hunt_logger.exception('Movie Hunt update instance error')
            return jsonify({'success': False, 'error': str(e)}), 500

    @bp.route('/api/movie-hunt/instances/<int:instance_id>', methods=['DELETE'])
    def delete_instance(instance_id):
        try:
            db = get_database()
            if not db.delete_movie_hunt_instance(instance_id):
                return jsonify({'success': False, 'error': 'Instance not found'}), 404
            instances = db.get_movie_hunt_instances()
            current_id = db.get_current_movie_hunt_instance_id()
            return jsonify({'success': True, 'instances': instances, 'current_instance_id': current_id}), 200
        except Exception as e:
            movie_hunt_logger.exception('Movie Hunt delete instance error')
            return jsonify({'success': False, 'error': str(e)}), 500

    @bp.route('/api/movie-hunt/instances/current', methods=['GET'])
    def get_current_instance():
        try:
            db = get_database()
            current_id = db.get_current_movie_hunt_instance_id()
            return jsonify({'current_instance_id': current_id, 'success': True}), 200
        except Exception as e:
            movie_hunt_logger.exception('Movie Hunt get current instance error')
            return jsonify({'error': str(e), 'success': False}), 500

    @bp.route('/api/movie-hunt/instances/current', methods=['PUT'])
    def set_current_instance():
        try:
            data = request.get_json() or {}
            instance_id = data.get('instance_id')
            if instance_id is None:
                instance_id = request.args.get('instance_id', type=int)
            if instance_id is None:
                return jsonify({'success': False, 'error': 'instance_id required'}), 400
            instance_id = int(instance_id)
            db = get_database()
            ids = [i['id'] for i in db.get_movie_hunt_instances()]
            if instance_id not in ids:
                return jsonify({'success': False, 'error': 'Instance not found'}), 404
            db.set_current_movie_hunt_instance_id(instance_id)
            return jsonify({'success': True, 'current_instance_id': instance_id}), 200
        except (TypeError, ValueError) as e:
            return jsonify({'success': False, 'error': str(e)}), 400
        except Exception as e:
            movie_hunt_logger.exception('Movie Hunt set current instance error')
            return jsonify({'success': False, 'error': str(e)}), 500


def register_tv_instances_routes(bp):
    """Register TV Hunt instance routes: list, create, update, delete, current."""

    @bp.route('/api/tv-hunt/instances', methods=['GET'])
    def list_instances():
        try:
            db = get_database()
            instances = db.get_tv_hunt_instances()
            current_id = db.get_current_tv_hunt_instance_id()
            return jsonify({
                'instances': instances,
                'current_instance_id': current_id,
                'success': True,
            }), 200
        except Exception as e:
            tv_hunt_logger.exception('TV Hunt instances list error')
            return jsonify({'instances': [], 'error': str(e), 'success': False}), 500

    @bp.route('/api/tv-hunt/instances', methods=['POST'])
    def create_instance():
        try:
            data = request.get_json() or {}
            name = (data.get('name') or '').strip() or 'Unnamed'
            db = get_database()
            new_id = db.create_tv_hunt_instance(name)
            instances = db.get_tv_hunt_instances()
            return jsonify({
                'success': True,
                'id': new_id,
                'instances': instances,
            }), 201
        except Exception as e:
            tv_hunt_logger.exception('TV Hunt create instance error')
            return jsonify({'success': False, 'error': str(e)}), 500

    @bp.route('/api/tv-hunt/instances/<int:instance_id>', methods=['PUT'])
    def update_instance(instance_id):
        try:
            data = request.get_json() or {}
            name = (data.get('name') or '').strip() or 'Unnamed'
            db = get_database()
            if not db.update_tv_hunt_instance(instance_id, name):
                return jsonify({'success': False, 'error': 'Instance not found'}), 404
            instances = db.get_tv_hunt_instances()
            return jsonify({'success': True, 'instances': instances}), 200
        except Exception as e:
            tv_hunt_logger.exception('TV Hunt update instance error')
            return jsonify({'success': False, 'error': str(e)}), 500

    @bp.route('/api/tv-hunt/instances/<int:instance_id>', methods=['DELETE'])
    def delete_instance(instance_id):
        try:
            db = get_database()
            if not db.delete_tv_hunt_instance(instance_id):
                return jsonify({'success': False, 'error': 'Instance not found'}), 404
            instances = db.get_tv_hunt_instances()
            current_id = db.get_current_tv_hunt_instance_id()
            return jsonify({'success': True, 'instances': instances, 'current_instance_id': current_id}), 200
        except Exception as e:
            tv_hunt_logger.exception('TV Hunt delete instance error')
            return jsonify({'success': False, 'error': str(e)}), 500

    @bp.route('/api/tv-hunt/instances/current', methods=['GET'])
    def get_current_instance():
        try:
            db = get_database()
            current_id = db.get_current_tv_hunt_instance_id()
            return jsonify({'current_instance_id': current_id, 'success': True}), 200
        except Exception as e:
            tv_hunt_logger.exception('TV Hunt get current instance error')
            return jsonify({'error': str(e), 'success': False}), 500

    @bp.route('/api/tv-hunt/instances/current', methods=['PUT'])
    def set_current_instance():
        try:
            data = request.get_json() or {}
            instance_id = data.get('instance_id')
            if instance_id is None:
                instance_id = request.args.get('instance_id', type=int)
            if instance_id is None:
                return jsonify({'success': False, 'error': 'instance_id required'}), 400
            instance_id = int(instance_id)
            db = get_database()
            ids = [i['id'] for i in db.get_tv_hunt_instances()]
            if instance_id not in ids:
                return jsonify({'success': False, 'error': 'Instance not found'}), 404
            db.set_current_tv_hunt_instance_id(instance_id)
            return jsonify({'success': True, 'current_instance_id': instance_id}), 200
        except (TypeError, ValueError) as e:
            return jsonify({'success': False, 'error': str(e)}), 400
        except Exception as e:
            tv_hunt_logger.exception('TV Hunt set current instance error')
            return jsonify({'success': False, 'error': str(e)}), 500
