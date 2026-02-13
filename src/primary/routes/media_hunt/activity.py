"""
Media Hunt – activity routes (queue, history, blocklist).
TV Hunt: register_tv_activity_routes. Movie Hunt activity remains in movie_hunt/activity.py (large, coupled).
"""

import uuid as _uuid
from datetime import datetime

from flask import request, jsonify

from ...utils.logger import logger


def register_tv_activity_routes(bp, get_instance_id):
    """Register TV Hunt activity routes: queue, history, blocklist."""
    from src.primary.utils.database import get_database

    @bp.route('/api/tv-hunt/queue', methods=['GET'])
    def api_tv_hunt_queue():
        try:
            instance_id = get_instance_id()
            if not instance_id:
                return jsonify({'queue': []}), 200
            return jsonify({'queue': []}), 200
        except Exception as e:
            logger.exception('TV Hunt queue error')
            return jsonify({'queue': [], 'error': str(e)}), 200

    @bp.route('/api/tv-hunt/history', methods=['GET'])
    def api_tv_hunt_history():
        try:
            instance_id = get_instance_id()
            if not instance_id:
                return jsonify({'history': []}), 200
            try:
                from src.primary.history_manager import get_history
                result = get_history("tv_hunt", page=1, page_size=100)
                entries = result.get("entries") or []
                instance_key = str(instance_id)
                entries = [e for e in entries if (e.get("instance_name") or "") == instance_key]
                return jsonify({'history': entries}), 200
            except Exception:
                return jsonify({'history': []}), 200
        except Exception as e:
            logger.exception('TV Hunt history error')
            return jsonify({'history': [], 'error': str(e)}), 200

    @bp.route('/api/tv-hunt/blocklist', methods=['GET'])
    def api_tv_hunt_blocklist_list():
        try:
            instance_id = get_instance_id()
            if not instance_id:
                return jsonify({'items': []}), 200
            db = get_database()
            config = db.get_app_config_for_instance('tv_hunt_blocklist', instance_id)
            items = config.get('items', []) if config and isinstance(config.get('items'), list) else []
            return jsonify({'items': items}), 200
        except Exception as e:
            logger.exception('TV Hunt blocklist list error')
            return jsonify({'items': [], 'error': str(e)}), 200

    @bp.route('/api/tv-hunt/blocklist', methods=['POST'])
    def api_tv_hunt_blocklist_add():
        try:
            instance_id = get_instance_id()
            if not instance_id:
                return jsonify({'error': 'No instance selected'}), 400
            data = request.get_json() or {}
            source_title = (data.get('source_title') or '').strip()
            if not source_title:
                return jsonify({'error': 'source_title required'}), 400
            db = get_database()
            config = db.get_app_config_for_instance('tv_hunt_blocklist', instance_id)
            if not config or not isinstance(config.get('items'), list):
                config = {'items': []}
            config['items'].append({
                'id': str(_uuid.uuid4())[:8],
                'source_title': source_title,
                'added_at': datetime.now().isoformat(),
            })
            db.save_app_config_for_instance('tv_hunt_blocklist', instance_id, config)
            return jsonify({'success': True}), 201
        except Exception as e:
            logger.exception('TV Hunt blocklist add error')
            return jsonify({'error': str(e)}), 500

    @bp.route('/api/tv-hunt/blocklist/<item_id>', methods=['DELETE'])
    def api_tv_hunt_blocklist_delete(item_id):
        try:
            instance_id = get_instance_id()
            if not instance_id:
                return jsonify({'error': 'No instance selected'}), 400
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
