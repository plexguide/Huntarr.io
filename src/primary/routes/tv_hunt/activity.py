"""TV Hunt activity routes: queue, history, blocklist."""

from flask import request, jsonify

from . import tv_hunt_bp
from ._helpers import _get_tv_hunt_instance_id_from_request
from ...utils.logger import logger


@tv_hunt_bp.route('/api/tv-hunt/queue', methods=['GET'])
def api_tv_hunt_queue():
    """Get the download queue for TV Hunt."""
    try:
        instance_id = _get_tv_hunt_instance_id_from_request()
        if not instance_id:
            return jsonify({'queue': []}), 200
        # For now, return empty queue — will be populated as downloads are tracked
        return jsonify({'queue': []}), 200
    except Exception as e:
        logger.exception('TV Hunt queue error')
        return jsonify({'queue': [], 'error': str(e)}), 200


@tv_hunt_bp.route('/api/tv-hunt/history', methods=['GET'])
def api_tv_hunt_history():
    """Get download history for TV Hunt."""
    try:
        instance_id = _get_tv_hunt_instance_id_from_request()
        if not instance_id:
            return jsonify({'history': []}), 200
        # Query from history manager
        try:
            from src.primary.utils.history_manager import get_processed_media
            history = get_processed_media("tv_hunt", str(instance_id))
            return jsonify({'history': history}), 200
        except Exception:
            return jsonify({'history': []}), 200
    except Exception as e:
        logger.exception('TV Hunt history error')
        return jsonify({'history': [], 'error': str(e)}), 200


@tv_hunt_bp.route('/api/tv-hunt/blocklist', methods=['GET'])
def api_tv_hunt_blocklist_list():
    """Get blocklist for TV Hunt."""
    try:
        instance_id = _get_tv_hunt_instance_id_from_request()
        if not instance_id:
            return jsonify({'items': []}), 200
        from src.primary.utils.database import get_database
        db = get_database()
        config = db.get_app_config_for_instance('tv_hunt_blocklist', instance_id)
        items = config.get('items', []) if config and isinstance(config.get('items'), list) else []
        return jsonify({'items': items}), 200
    except Exception as e:
        logger.exception('TV Hunt blocklist list error')
        return jsonify({'items': [], 'error': str(e)}), 200


@tv_hunt_bp.route('/api/tv-hunt/blocklist', methods=['POST'])
def api_tv_hunt_blocklist_add():
    """Add item to blocklist."""
    try:
        instance_id = _get_tv_hunt_instance_id_from_request()
        if not instance_id:
            return jsonify({'error': 'No instance selected'}), 400
        data = request.get_json() or {}
        source_title = (data.get('source_title') or '').strip()
        if not source_title:
            return jsonify({'error': 'source_title required'}), 400
        from src.primary.utils.database import get_database
        db = get_database()
        config = db.get_app_config_for_instance('tv_hunt_blocklist', instance_id)
        if not config or not isinstance(config.get('items'), list):
            config = {'items': []}
        
        import uuid
        from datetime import datetime
        config['items'].append({
            'id': str(uuid.uuid4())[:8],
            'source_title': source_title,
            'added_at': datetime.now().isoformat(),
        })
        db.save_app_config_for_instance('tv_hunt_blocklist', instance_id, config)
        return jsonify({'success': True}), 201
    except Exception as e:
        logger.exception('TV Hunt blocklist add error')
        return jsonify({'error': str(e)}), 500


@tv_hunt_bp.route('/api/tv-hunt/blocklist/<item_id>', methods=['DELETE'])
def api_tv_hunt_blocklist_delete(item_id):
    """Remove item from blocklist."""
    try:
        instance_id = _get_tv_hunt_instance_id_from_request()
        if not instance_id:
            return jsonify({'error': 'No instance selected'}), 400
        from src.primary.utils.database import get_database
        db = get_database()
        config = db.get_app_config_for_instance('tv_hunt_blocklist', instance_id)
        if not config or not isinstance(config.get('items'), list):
            return jsonify({'error': 'Item not found'}), 404
        config['items'] = [i for i in config['items'] if i.get('id') != item_id]
        db.save_app_config_for_instance('tv_hunt_blocklist', instance_id, config)
        return jsonify({'success': True}), 200
    except Exception as e:
        logger.exception('TV Hunt blocklist delete error')
        return jsonify({'error': str(e)}), 500
