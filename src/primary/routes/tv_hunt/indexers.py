"""TV Hunt indexer management routes — TV uses 5000-series Newznab categories."""

from flask import request, jsonify

from . import tv_hunt_bp
from ...utils.logger import logger

# TV Newznab categories
TV_INDEXER_DEFAULT_CATEGORIES = [5000, 5010, 5020, 5030, 5040, 5045, 5050, 5060, 5070]

# TV indexer presets
TV_INDEXER_PRESETS = [
    {"name": "NZBgeek", "url": "https://api.nzbgeek.info", "protocol": "usenet", "default_categories": [5000, 5030, 5040, 5045]},
    {"name": "DrunkenSlug", "url": "https://api.drunkenslug.com", "protocol": "usenet", "default_categories": [5000, 5030, 5040, 5045]},
    {"name": "NZBFinder", "url": "https://nzbfinder.ws", "protocol": "usenet", "default_categories": [5000, 5030, 5040, 5045]},
    {"name": "Tabula Rasa", "url": "https://www.tabula-rasa.pw", "protocol": "usenet", "default_categories": [5000, 5030, 5040, 5045]},
    {"name": "altHUB", "url": "https://api.althub.co.za", "protocol": "usenet", "default_categories": [5000, 5030, 5040, 5045]},
    {"name": "NZB.su", "url": "https://api.nzb.su", "protocol": "usenet", "default_categories": [5000, 5030, 5040, 5045]},
    {"name": "Custom Newznab", "url": "", "protocol": "usenet", "default_categories": [5000, 5030, 5040, 5045]},
]


def _get_indexers_config(instance_id):
    """Get indexer list for a TV Hunt instance. Falls back to Movie Hunt indexers if shared."""
    from src.primary.utils.database import get_database
    db = get_database()
    config = db.get_app_config_for_instance('tv_hunt_indexers', instance_id)
    if config and isinstance(config.get('indexers'), list):
        return config['indexers']
    # Fall back to shared indexers (movie hunt indexers)
    config = db.get_app_config_for_instance('indexers', instance_id)
    if config and isinstance(config.get('indexers'), list):
        return config['indexers']
    return []


def _resolve_indexer_api_url(indexer):
    """Get the effective API URL for an indexer."""
    url = (indexer.get('api_url') or indexer.get('url') or '').strip().rstrip('/')
    if url and '/api' not in url.lower():
        url = url + '/api'
    return url


@tv_hunt_bp.route('/api/tv-hunt/indexers', methods=['GET'])
def api_tv_hunt_indexers_list():
    """List indexers for the current TV Hunt instance."""
    try:
        from ._helpers import _get_tv_hunt_instance_id_from_request
        instance_id = _get_tv_hunt_instance_id_from_request()
        if not instance_id:
            return jsonify({'indexers': []}), 200
        indexers = _get_indexers_config(instance_id)
        return jsonify({'indexers': indexers}), 200
    except Exception as e:
        logger.exception('TV Hunt indexers list error')
        return jsonify({'indexers': [], 'error': str(e)}), 200


@tv_hunt_bp.route('/api/tv-hunt/indexers', methods=['POST'])
def api_tv_hunt_indexers_add():
    """Add an indexer. Body: indexer object."""
    try:
        from ._helpers import _get_tv_hunt_instance_id_from_request
        instance_id = _get_tv_hunt_instance_id_from_request()
        if not instance_id:
            return jsonify({'error': 'No instance selected'}), 400
        data = request.get_json() or {}
        from src.primary.utils.database import get_database
        db = get_database()
        config = db.get_app_config_for_instance('tv_hunt_indexers', instance_id)
        if not config or not isinstance(config.get('indexers'), list):
            config = {'indexers': []}
        
        import uuid
        new_indexer = {
            'id': str(uuid.uuid4())[:8],
            'name': (data.get('name') or 'Unnamed').strip(),
            'display_name': (data.get('display_name') or '').strip(),
            'url': (data.get('url') or '').strip(),
            'api_url': (data.get('api_url') or data.get('url') or '').strip(),
            'api_key': (data.get('api_key') or '').strip(),
            'protocol': (data.get('protocol') or 'usenet').strip().lower(),
            'categories': data.get('categories') or TV_INDEXER_DEFAULT_CATEGORIES,
            'priority': int(data.get('priority', 25)),
            'enabled': data.get('enabled', True),
        }
        config['indexers'].append(new_indexer)
        db.save_app_config_for_instance('tv_hunt_indexers', instance_id, config)
        return jsonify({'indexer': new_indexer}), 201
    except Exception as e:
        logger.exception('TV Hunt indexer add error')
        return jsonify({'error': str(e)}), 500


@tv_hunt_bp.route('/api/tv-hunt/indexers/<indexer_id>', methods=['PUT'])
def api_tv_hunt_indexers_update(indexer_id):
    """Update an indexer."""
    try:
        from ._helpers import _get_tv_hunt_instance_id_from_request
        instance_id = _get_tv_hunt_instance_id_from_request()
        if not instance_id:
            return jsonify({'error': 'No instance selected'}), 400
        data = request.get_json() or {}
        from src.primary.utils.database import get_database
        db = get_database()
        config = db.get_app_config_for_instance('tv_hunt_indexers', instance_id)
        if not config or not isinstance(config.get('indexers'), list):
            return jsonify({'error': 'Indexer not found'}), 404
        
        for idx in config['indexers']:
            if idx.get('id') == indexer_id:
                for key in ('name', 'display_name', 'url', 'api_url', 'api_key', 'protocol', 'categories', 'priority', 'enabled'):
                    if key in data:
                        idx[key] = data[key]
                db.save_app_config_for_instance('tv_hunt_indexers', instance_id, config)
                return jsonify({'indexer': idx}), 200
        
        return jsonify({'error': 'Indexer not found'}), 404
    except Exception as e:
        logger.exception('TV Hunt indexer update error')
        return jsonify({'error': str(e)}), 500


@tv_hunt_bp.route('/api/tv-hunt/indexers/<indexer_id>', methods=['DELETE'])
def api_tv_hunt_indexers_delete(indexer_id):
    """Delete an indexer."""
    try:
        from ._helpers import _get_tv_hunt_instance_id_from_request
        instance_id = _get_tv_hunt_instance_id_from_request()
        if not instance_id:
            return jsonify({'error': 'No instance selected'}), 400
        from src.primary.utils.database import get_database
        db = get_database()
        config = db.get_app_config_for_instance('tv_hunt_indexers', instance_id)
        if not config or not isinstance(config.get('indexers'), list):
            return jsonify({'error': 'Indexer not found'}), 404
        
        config['indexers'] = [i for i in config['indexers'] if i.get('id') != indexer_id]
        db.save_app_config_for_instance('tv_hunt_indexers', instance_id, config)
        return jsonify({'success': True}), 200
    except Exception as e:
        logger.exception('TV Hunt indexer delete error')
        return jsonify({'error': str(e)}), 500


@tv_hunt_bp.route('/api/tv-hunt/indexers/presets', methods=['GET'])
def api_tv_hunt_indexers_presets():
    """List TV indexer presets."""
    return jsonify({'presets': TV_INDEXER_PRESETS}), 200
