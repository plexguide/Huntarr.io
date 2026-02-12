"""TV Hunt instance management routes (multi-instance)."""

from flask import request, jsonify

from . import tv_hunt_bp
from ...utils.logger import logger

# Per-instance settings config key
TV_HUNT_HUNT_SETTINGS_KEY = "tv_hunt_hunt_settings"


@tv_hunt_bp.route('/api/tv-hunt/instances', methods=['GET'])
def api_tv_hunt_instances_list():
    """List all TV Hunt instances (id, name, created_at, enabled)."""
    try:
        from src.primary.utils.database import get_database
        db = get_database()
        instances = db.get_tv_hunt_instances()
        for inst in instances:
            settings = _get_tv_hunt_instance_settings(inst['id'])
            inst['enabled'] = settings.get('enabled', True)
        return jsonify({'instances': instances}), 200
    except Exception as e:
        logger.exception('TV Hunt instances list error')
        return jsonify({'instances': [], 'error': str(e)}), 200


@tv_hunt_bp.route('/api/tv-hunt/instances', methods=['POST'])
def api_tv_hunt_instances_create():
    """Create a new TV Hunt instance. Body: { "name": "User-provided name" }."""
    try:
        data = request.get_json() or {}
        name = (data.get('name') or '').strip() or 'Unnamed'
        from src.primary.utils.database import get_database
        db = get_database()
        new_id = db.create_tv_hunt_instance(name)
        instances = db.get_tv_hunt_instances()
        new_instance = next((i for i in instances if i['id'] == new_id), None)
        return jsonify({'instance_id': new_id, 'instance': new_instance}), 201
    except Exception as e:
        logger.exception('TV Hunt instance create error')
        return jsonify({'error': str(e)}), 500


@tv_hunt_bp.route('/api/tv-hunt/instances/<int:instance_id>', methods=['GET'])
def api_tv_hunt_instance_get(instance_id):
    """Get one TV Hunt instance by id."""
    try:
        from src.primary.utils.database import get_database
        db = get_database()
        instances = db.get_tv_hunt_instances()
        one = next((i for i in instances if i['id'] == instance_id), None)
        if not one:
            return jsonify({'error': 'Instance not found'}), 404
        return jsonify(one), 200
    except Exception as e:
        logger.exception('TV Hunt instance get error')
        return jsonify({'error': str(e)}), 500


@tv_hunt_bp.route('/api/tv-hunt/instances/<int:instance_id>', methods=['PATCH'])
def api_tv_hunt_instance_update(instance_id):
    """Rename a TV Hunt instance. Body: { "name": "New name" }."""
    try:
        data = request.get_json() or {}
        name = (data.get('name') or '').strip() or 'Unnamed'
        from src.primary.utils.database import get_database
        db = get_database()
        if not db.update_tv_hunt_instance(instance_id, name):
            return jsonify({'error': 'Instance not found'}), 404
        instances = db.get_tv_hunt_instances()
        one = next((i for i in instances if i['id'] == instance_id), None)
        return jsonify(one), 200
    except Exception as e:
        logger.exception('TV Hunt instance update error')
        return jsonify({'error': str(e)}), 500


@tv_hunt_bp.route('/api/tv-hunt/instances/<int:instance_id>', methods=['DELETE'])
def api_tv_hunt_instance_delete(instance_id):
    """Delete a TV Hunt instance. ID is never reused."""
    try:
        from src.primary.utils.database import get_database
        db = get_database()
        if not db.delete_tv_hunt_instance(instance_id):
            return jsonify({'error': 'Instance not found'}), 404
        return jsonify({'success': True}), 200
    except Exception as e:
        logger.exception('TV Hunt instance delete error')
        return jsonify({'error': str(e)}), 500


@tv_hunt_bp.route('/api/tv-hunt/current-instance', methods=['GET'])
def api_tv_hunt_current_instance_get():
    """Get current TV Hunt instance id (server-stored)."""
    try:
        from src.primary.utils.database import get_database
        db = get_database()
        instance_id = db.get_current_tv_hunt_instance_id()
        return jsonify({'instance_id': instance_id}), 200
    except Exception as e:
        logger.exception('TV Hunt current instance get error')
        return jsonify({'instance_id': 0, 'error': str(e)}), 200


@tv_hunt_bp.route('/api/tv-hunt/current-instance', methods=['POST'])
def api_tv_hunt_current_instance_set():
    """Set current TV Hunt instance (server-stored). Body: { "instance_id": int }."""
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
        instances = db.get_tv_hunt_instances()
        if not any(i['id'] == instance_id for i in instances):
            return jsonify({'error': 'Instance not found'}), 404
        db.set_current_tv_hunt_instance_id(instance_id)
        return jsonify({'instance_id': instance_id}), 200
    except Exception as e:
        logger.exception('TV Hunt current instance set error')
        return jsonify({'error': str(e)}), 500


def _get_tv_hunt_instance_settings(instance_id: int):
    """Get per-instance hunt settings for a TV Hunt instance (merged with defaults)."""
    from src.primary.utils.database import get_database
    from src.primary.default_settings import get_tv_hunt_instance_settings_defaults
    db = get_database()
    defaults = get_tv_hunt_instance_settings_defaults()
    saved = db.get_app_config_for_instance(TV_HUNT_HUNT_SETTINGS_KEY, instance_id)
    if not saved or not isinstance(saved, dict):
        return dict(defaults)
    return {k: saved.get(k, defaults[k]) for k in defaults}


@tv_hunt_bp.route('/api/tv-hunt/instances/<int:instance_id>/settings', methods=['GET'])
def api_tv_hunt_instance_settings_get(instance_id):
    """Get per-instance hunt settings plus name and instance_id."""
    try:
        from src.primary.utils.database import get_database
        db = get_database()
        instances = db.get_tv_hunt_instances()
        one = next((i for i in instances if i["id"] == instance_id), None)
        if not one:
            return jsonify({'error': 'Instance not found'}), 404
        settings = _get_tv_hunt_instance_settings(instance_id)
        settings["name"] = one.get("name", "")
        settings["instance_id"] = str(instance_id)
        return jsonify(settings), 200
    except Exception as e:
        logger.exception('TV Hunt instance settings get error')
        return jsonify({'error': str(e)}), 500


@tv_hunt_bp.route('/api/tv-hunt/instances/<int:instance_id>/settings', methods=['PUT', 'PATCH'])
def api_tv_hunt_instance_settings_put(instance_id):
    """Save per-instance hunt settings and optional name for a TV Hunt instance."""
    try:
        data = request.get_json()
        if data is None:
            return jsonify({'error': 'JSON body required'}), 400
        from src.primary.default_settings import get_tv_hunt_instance_settings_defaults
        defaults = get_tv_hunt_instance_settings_defaults()
        normalized = dict(defaults)
        if isinstance(data, dict):
            for key in normalized:
                if key not in data:
                    continue
                val = data[key]
                if key in ("hunt_missing_episodes", "hunt_upgrade_episodes",
                           "state_management_hours", "api_timeout", "command_wait_delay",
                           "command_wait_attempts", "max_download_queue_size", "max_seed_queue_size",
                           "sleep_duration", "hourly_cap"):
                    try:
                        normalized[key] = int(val) if val is not None else defaults[key]
                    except (TypeError, ValueError):
                        normalized[key] = defaults[key]
                elif key == "enabled":
                    normalized[key] = bool(val)
                elif key in ("monitored_only", "tag_processed_items", "tag_enable_missing",
                             "tag_enable_upgrade", "tag_enable_upgraded", "skip_future_episodes"):
                    normalized[key] = bool(val)
                elif key == "hunt_missing_mode":
                    raw = (str(val) or "seasons_packs").strip().lower()
                    normalized[key] = raw if raw in ("seasons_packs", "episodes") else "seasons_packs"
                elif key == "upgrade_mode":
                    raw = (str(val) or "seasons_packs").strip().lower()
                    normalized[key] = raw if raw in ("seasons_packs", "episodes") else "seasons_packs"
                elif key == "state_management_mode":
                    raw = (str(val) or "custom").strip().lower()
                    normalized[key] = raw if raw in ("custom", "disabled") else "custom"
                elif key == "exempt_tags":
                    normalized[key] = [x for x in ([str(x).strip() for x in val] if isinstance(val, list) else []) if x]
                elif key == "custom_tags":
                    normalized[key] = dict(val) if isinstance(val, dict) else dict(defaults[key])
                else:
                    normalized[key] = val

        from src.primary.utils.database import get_database
        db = get_database()
        instances = db.get_tv_hunt_instances()
        if not any(i["id"] == instance_id for i in instances):
            return jsonify({'error': 'Instance not found'}), 404
        name = (data.get("name") or "").strip() if isinstance(data.get("name"), str) else None
        if name is not None and name != "":
            db.update_tv_hunt_instance(instance_id, name)
        db.save_app_config_for_instance(TV_HUNT_HUNT_SETTINGS_KEY, instance_id, normalized)
        out = dict(normalized)
        one = next((i for i in db.get_tv_hunt_instances() if i["id"] == instance_id), None)
        out["name"] = one.get("name", "") if one else ""
        out["instance_id"] = str(instance_id)
        return jsonify(out), 200
    except Exception as e:
        logger.exception('TV Hunt instance settings save error')
        return jsonify({'error': str(e)}), 500


@tv_hunt_bp.route('/api/tv-hunt/instances/<int:instance_id>/reset-state', methods=['POST'])
def api_tv_hunt_instance_reset_state(instance_id):
    """Reset processed state for this TV Hunt instance."""
    try:
        from src.primary.utils.database import get_database
        db = get_database()
        instances = db.get_tv_hunt_instances()
        if not any(i["id"] == instance_id for i in instances):
            return jsonify({'error': 'Instance not found'}), 404
        settings = _get_tv_hunt_instance_settings(instance_id)
        hours = int(settings.get("state_management_hours", 72))
        instance_key = str(instance_id)
        db.reset_instance_state_management("tv_hunt", instance_key, hours)
        return jsonify({'success': True}), 200
    except Exception as e:
        logger.exception('TV Hunt instance reset state error')
        return jsonify({'error': str(e)}), 500


@tv_hunt_bp.route('/api/tv-hunt/instances/<int:instance_id>/reset-collection', methods=['DELETE'])
def api_tv_hunt_instance_reset_collection(instance_id):
    """Permanently delete the entire TV Collection for a TV Hunt instance."""
    try:
        from src.primary.utils.database import get_database
        db = get_database()
        instances = db.get_tv_hunt_instances()
        inst = next((i for i in instances if i["id"] == instance_id), None)
        if not inst:
            return jsonify({'success': False, 'message': 'Instance not found'}), 404
        inst_name = inst.get('name', 'Instance %d' % instance_id)
        config = db.get_app_config_for_instance('tv_hunt_collection', instance_id)
        count = len(config.get('series', [])) if config and isinstance(config.get('series'), list) else 0
        db.save_app_config_for_instance('tv_hunt_collection', instance_id, {'series': []})
        logger.info("TV Hunt collection reset for instance %d (%s): %d series deleted", instance_id, inst_name, count)
        return jsonify({
            'success': True,
            'message': 'TV collection reset. %d series deleted from "%s".' % (count, inst_name)
        }), 200
    except Exception as e:
        logger.exception('TV Hunt collection reset error for instance %d', instance_id)
        return jsonify({'success': False, 'message': str(e)}), 500
