"""Movie Hunt instance management routes (multi-instance)."""

from flask import request, jsonify

from . import movie_hunt_bp
from ...utils.logger import logger

# Per-instance settings config key (search, stateful, additional — same as Radarr instance minus connection)
MOVIE_HUNT_HUNT_SETTINGS_KEY = "movie_hunt_hunt_settings"


@movie_hunt_bp.route('/api/movie-hunt/instances', methods=['GET'])
def api_movie_hunt_instances_list():
    """List all Movie Hunt instances (id, name, created_at, enabled)."""
    try:
        from src.primary.utils.database import get_database
        db = get_database()
        instances = db.get_movie_hunt_instances()
        for inst in instances:
            settings = _get_movie_hunt_instance_settings(inst['id'])
            inst['enabled'] = settings.get('enabled', True)
        return jsonify({'instances': instances}), 200
    except Exception as e:
        logger.exception('Movie Hunt instances list error')
        return jsonify({'instances': [], 'error': str(e)}), 200


@movie_hunt_bp.route('/api/movie-hunt/instances', methods=['POST'])
def api_movie_hunt_instances_create():
    """Create a new Movie Hunt instance. Body: { "name": "User-provided name" }."""
    try:
        data = request.get_json() or {}
        name = (data.get('name') or '').strip() or 'Unnamed'
        from src.primary.utils.database import get_database
        db = get_database()
        new_id = db.create_movie_hunt_instance(name)
        instances = db.get_movie_hunt_instances()
        new_instance = next((i for i in instances if i['id'] == new_id), None)
        return jsonify({'instance_id': new_id, 'instance': new_instance}), 201
    except Exception as e:
        logger.exception('Movie Hunt instance create error')
        return jsonify({'error': str(e)}), 500


@movie_hunt_bp.route('/api/movie-hunt/instances/<int:instance_id>', methods=['GET'])
def api_movie_hunt_instance_get(instance_id):
    """Get one Movie Hunt instance by id."""
    try:
        from src.primary.utils.database import get_database
        db = get_database()
        instances = db.get_movie_hunt_instances()
        one = next((i for i in instances if i['id'] == instance_id), None)
        if not one:
            return jsonify({'error': 'Instance not found'}), 404
        return jsonify(one), 200
    except Exception as e:
        logger.exception('Movie Hunt instance get error')
        return jsonify({'error': str(e)}), 500


@movie_hunt_bp.route('/api/movie-hunt/instances/<int:instance_id>', methods=['PATCH'])
def api_movie_hunt_instance_update(instance_id):
    """Rename a Movie Hunt instance. Body: { "name": "New name" }."""
    try:
        data = request.get_json() or {}
        name = (data.get('name') or '').strip() or 'Unnamed'
        from src.primary.utils.database import get_database
        db = get_database()
        if not db.update_movie_hunt_instance(instance_id, name):
            return jsonify({'error': 'Instance not found'}), 404
        instances = db.get_movie_hunt_instances()
        one = next((i for i in instances if i['id'] == instance_id), None)
        return jsonify(one), 200
    except Exception as e:
        logger.exception('Movie Hunt instance update error')
        return jsonify({'error': str(e)}), 500


@movie_hunt_bp.route('/api/movie-hunt/instances/<int:instance_id>', methods=['DELETE'])
def api_movie_hunt_instance_delete(instance_id):
    """Delete a Movie Hunt instance. ID is never reused."""
    try:
        from src.primary.utils.database import get_database
        db = get_database()
        if not db.delete_movie_hunt_instance(instance_id):
            return jsonify({'error': 'Instance not found'}), 404
        return jsonify({'success': True}), 200
    except Exception as e:
        logger.exception('Movie Hunt instance delete error')
        return jsonify({'error': str(e)}), 500


@movie_hunt_bp.route('/api/movie-hunt/current-instance', methods=['GET'])
def api_movie_hunt_current_instance_get():
    """Get current Movie Hunt instance id (server-stored)."""
    try:
        from src.primary.utils.database import get_database
        db = get_database()
        instance_id = db.get_current_movie_hunt_instance_id()
        return jsonify({'instance_id': instance_id}), 200
    except Exception as e:
        logger.exception('Movie Hunt current instance get error')
        return jsonify({'instance_id': 1, 'error': str(e)}), 200


def _get_movie_hunt_instance_settings(instance_id: int):
    """Get per-instance hunt settings for a Movie Hunt instance (merged with defaults).
    Returns only keys from defaults to avoid leaking unknown keys from older schema."""
    from src.primary.utils.database import get_database
    from src.primary.default_settings import get_movie_hunt_instance_settings_defaults
    db = get_database()
    defaults = get_movie_hunt_instance_settings_defaults()
    saved = db.get_app_config_for_instance(MOVIE_HUNT_HUNT_SETTINGS_KEY, instance_id)
    if not saved or not isinstance(saved, dict):
        return dict(defaults)
    return {k: saved.get(k, defaults[k]) for k in defaults}


def _validate_movie_hunt_settings(data: dict) -> tuple:
    """Validate and normalize settings. Returns (normalized_dict, error_message or None)."""
    from src.primary.default_settings import get_movie_hunt_instance_settings_defaults
    defaults = get_movie_hunt_instance_settings_defaults()
    out = dict(defaults)
    if not isinstance(data, dict):
        return None, "Settings must be an object"
    for key in out:
        if key not in data:
            continue
        val = data[key]
        if key in ("hunt_missing_movies", "hunt_upgrade_movies", "release_date_delay_days",
                   "state_management_hours", "api_timeout", "command_wait_delay", "command_wait_attempts",
                   "max_download_queue_size", "max_seed_queue_size", "sleep_duration", "hourly_cap"):
            try:
                n = int(val) if val is not None else defaults[key]
                # Basic bounds to avoid invalid stored values
                if key == "sleep_duration" and (n < 60 or n > 86400):
                    n = max(60, min(86400, n)) if n >= 0 else defaults[key]
                elif key == "hourly_cap" and (n < 1 or n > 500):
                    n = max(1, min(500, n)) if n >= 0 else defaults[key]
                elif key == "state_management_hours" and (n < 1 or n > 8760):
                    n = max(1, min(8760, n)) if n >= 0 else defaults[key]
                out[key] = n
            except (TypeError, ValueError):
                out[key] = defaults[key]
        elif key == "exempt_tags":
            out[key] = [x for x in ([str(x).strip() for x in val] if isinstance(val, list) else []) if x]
        elif key == "custom_tags":
            out[key] = dict(val) if isinstance(val, dict) else dict(defaults[key])
        elif key == "upgrade_selection_method":
            raw = (str(val) or "cutoff").strip().lower() if val is not None else "cutoff"
            out[key] = raw if raw in ("cutoff", "tags") else "cutoff"
        elif key == "upgrade_tag":
            out[key] = (str(val) or "").strip()
        elif key == "state_management_mode":
            raw = (str(val) or "custom").strip().lower() if val is not None else "custom"
            out[key] = raw if raw in ("custom", "disabled") else "custom"
        elif key == "enabled":
            out[key] = bool(val)
        elif key in ("monitored_only", "tag_processed_items", "tag_enable_missing",
                     "tag_enable_upgrade", "tag_enable_upgraded"):
            out[key] = bool(val)
        elif key == "seed_check_torrent_client":
            out[key] = val if isinstance(val, dict) and val else None
        else:
            out[key] = val
    return out, None


@movie_hunt_bp.route('/api/movie-hunt/instances/<int:instance_id>/settings', methods=['GET'])
def api_movie_hunt_instance_settings_get(instance_id):
    """Get per-instance hunt settings plus name and instance_id for the Information section."""
    try:
        from src.primary.utils.database import get_database
        db = get_database()
        instances = db.get_movie_hunt_instances()
        one = next((i for i in instances if i["id"] == instance_id), None)
        if not one:
            return jsonify({'error': 'Instance not found'}), 404
        settings = _get_movie_hunt_instance_settings(instance_id)
        settings["name"] = one.get("name", "")
        settings["instance_id"] = str(instance_id)
        return jsonify(settings), 200
    except Exception as e:
        logger.exception('Movie Hunt instance settings get error')
        return jsonify({'error': str(e)}), 500


@movie_hunt_bp.route('/api/movie-hunt/instances/<int:instance_id>/settings', methods=['PUT', 'PATCH'])
def api_movie_hunt_instance_settings_put(instance_id):
    """Save per-instance hunt settings (search, stateful, additional) and optional name for a Movie Hunt instance."""
    try:
        data = request.get_json()
        if data is None:
            return jsonify({'error': 'JSON body required'}), 400
        normalized, err = _validate_movie_hunt_settings(data)
        if err:
            return jsonify({'error': err}), 400
        from src.primary.utils.database import get_database
        db = get_database()
        instances = db.get_movie_hunt_instances()
        if not any(i["id"] == instance_id for i in instances):
            return jsonify({'error': 'Instance not found'}), 404
        name = (data.get("name") or "").strip() if isinstance(data.get("name"), str) else None
        if name is not None and name != "":
            db.update_movie_hunt_instance(instance_id, name)
        db.save_app_config_for_instance(MOVIE_HUNT_HUNT_SETTINGS_KEY, instance_id, normalized)
        out = dict(normalized)
        one = next((i for i in db.get_movie_hunt_instances() if i["id"] == instance_id), None)
        out["name"] = one.get("name", "") if one else ""
        out["instance_id"] = str(instance_id)
        return jsonify(out), 200
    except Exception as e:
        logger.exception('Movie Hunt instance settings save error')
        return jsonify({'error': str(e)}), 500


@movie_hunt_bp.route('/api/movie-hunt/instances/<int:instance_id>/reset-state', methods=['POST'])
def api_movie_hunt_instance_reset_state(instance_id):
    """Reset processed state for this Movie Hunt instance (same as Radarr state reset)."""
    try:
        from src.primary.utils.database import get_database
        db = get_database()
        instances = db.get_movie_hunt_instances()
        if not any(i["id"] == instance_id for i in instances):
            return jsonify({'error': 'Instance not found'}), 404
        settings = _get_movie_hunt_instance_settings(instance_id)
        hours = int(settings.get("state_management_hours", 72))
        instance_key = str(instance_id)
        db.reset_instance_state_management("movie_hunt", instance_key, hours)
        return jsonify({'success': True}), 200
    except Exception as e:
        logger.exception('Movie Hunt instance reset state error')
        return jsonify({'error': str(e)}), 500


@movie_hunt_bp.route('/api/movie-hunt/instances/<int:instance_id>/reset-collection', methods=['DELETE'])
def api_movie_hunt_instance_reset_collection(instance_id):
    """Permanently delete the entire Media Collection for a Movie Hunt instance."""
    try:
        from src.primary.utils.database import get_database
        db = get_database()
        instances = db.get_movie_hunt_instances()
        inst = next((i for i in instances if i["id"] == instance_id), None)
        if not inst:
            return jsonify({'success': False, 'message': 'Instance not found'}), 404
        inst_name = inst.get('name', 'Instance %d' % instance_id)
        # Load current collection to report count
        config = db.get_app_config_for_instance('movie_hunt_collection', instance_id)
        count = len(config.get('items', [])) if config and isinstance(config.get('items'), list) else 0
        # Wipe the collection
        db.save_app_config_for_instance('movie_hunt_collection', instance_id, {'items': []})
        logger.info("Movie Hunt collection reset for instance %d (%s): %d items deleted", instance_id, inst_name, count)
        return jsonify({
            'success': True,
            'message': 'Media collection reset. %d item%s deleted from "%s".' % (count, 's' if count != 1 else '', inst_name)
        }), 200
    except Exception as e:
        logger.exception('Movie Hunt collection reset error for instance %d', instance_id)
        return jsonify({'success': False, 'message': str(e)}), 500


@movie_hunt_bp.route('/api/movie-hunt/current-instance', methods=['POST'])
def api_movie_hunt_current_instance_set():
    """Set current Movie Hunt instance (server-stored). Body: { "instance_id": int }."""
    try:
        data = request.get_json() or {}
        instance_id = data.get('instance_id')
        if instance_id is None:
            return jsonify({'error': 'instance_id required'}), 400
        try:
            instance_id = int(instance_id)
        except (TypeError, ValueError):
            return jsonify({'error': 'instance_id must be an integer'}), 400
        from src.primary.utils.database import get_database
        db = get_database()
        instances = db.get_movie_hunt_instances()
        if not any(i['id'] == instance_id for i in instances):
            return jsonify({'error': 'Instance not found'}), 404
        db.set_current_movie_hunt_instance_id(instance_id)
        return jsonify({'instance_id': instance_id}), 200
    except Exception as e:
        logger.exception('Movie Hunt current instance set error')
        return jsonify({'error': str(e)}), 500
