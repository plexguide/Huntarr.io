"""TV Hunt download client management routes (shares patterns with Movie Hunt)."""

from flask import request, jsonify
import requests as http_requests

from . import tv_hunt_bp
from ...utils.logger import logger


def _get_clients_config(instance_id):
    """Get download clients for a TV Hunt instance. Falls back to Movie Hunt clients if shared."""
    from src.primary.utils.database import get_database
    db = get_database()
    config = db.get_app_config_for_instance('tv_hunt_clients', instance_id)
    if config and isinstance(config.get('clients'), list):
        return config['clients']
    # Fall back to shared clients (movie hunt clients)
    config = db.get_app_config_for_instance('clients', instance_id)
    if config and isinstance(config.get('clients'), list):
        return config['clients']
    return []


@tv_hunt_bp.route('/api/tv-hunt/clients', methods=['GET'])
def api_tv_hunt_clients_list():
    """List download clients for the current TV Hunt instance."""
    try:
        from ._helpers import _get_tv_hunt_instance_id_from_request
        instance_id = _get_tv_hunt_instance_id_from_request()
        if not instance_id:
            return jsonify({'clients': []}), 200
        clients = _get_clients_config(instance_id)
        return jsonify({'clients': clients}), 200
    except Exception as e:
        logger.exception('TV Hunt clients list error')
        return jsonify({'clients': [], 'error': str(e)}), 200


@tv_hunt_bp.route('/api/tv-hunt/clients', methods=['POST'])
def api_tv_hunt_clients_add():
    """Add a download client."""
    try:
        from ._helpers import _get_tv_hunt_instance_id_from_request
        instance_id = _get_tv_hunt_instance_id_from_request()
        if not instance_id:
            return jsonify({'error': 'No instance selected'}), 400
        data = request.get_json() or {}
        from src.primary.utils.database import get_database
        db = get_database()
        config = db.get_app_config_for_instance('tv_hunt_clients', instance_id)
        if not config or not isinstance(config.get('clients'), list):
            config = {'clients': []}
        
        import uuid
        new_client = {
            'id': str(uuid.uuid4())[:8],
            'name': (data.get('name') or 'Unnamed').strip(),
            'type': (data.get('type') or 'nzb_hunt').strip().lower(),
            'host': (data.get('host') or '').strip(),
            'api_key': (data.get('api_key') or '').strip(),
            'username': (data.get('username') or '').strip(),
            'password': (data.get('password') or '').strip(),
            'category': (data.get('category') or 'tv').strip(),
            'enabled': data.get('enabled', True),
        }
        config['clients'].append(new_client)
        db.save_app_config_for_instance('tv_hunt_clients', instance_id, config)
        return jsonify({'client': new_client}), 201
    except Exception as e:
        logger.exception('TV Hunt client add error')
        return jsonify({'error': str(e)}), 500


@tv_hunt_bp.route('/api/tv-hunt/clients/<client_id>', methods=['PUT'])
def api_tv_hunt_clients_update(client_id):
    """Update a download client."""
    try:
        from ._helpers import _get_tv_hunt_instance_id_from_request
        instance_id = _get_tv_hunt_instance_id_from_request()
        if not instance_id:
            return jsonify({'error': 'No instance selected'}), 400
        data = request.get_json() or {}
        from src.primary.utils.database import get_database
        db = get_database()
        config = db.get_app_config_for_instance('tv_hunt_clients', instance_id)
        if not config or not isinstance(config.get('clients'), list):
            return jsonify({'error': 'Client not found'}), 404
        
        for c in config['clients']:
            if c.get('id') == client_id:
                for key in ('name', 'type', 'host', 'api_key', 'username', 'password', 'category', 'enabled'):
                    if key in data:
                        c[key] = data[key]
                db.save_app_config_for_instance('tv_hunt_clients', instance_id, config)
                return jsonify({'client': c}), 200
        
        return jsonify({'error': 'Client not found'}), 404
    except Exception as e:
        logger.exception('TV Hunt client update error')
        return jsonify({'error': str(e)}), 500


@tv_hunt_bp.route('/api/tv-hunt/clients/<client_id>', methods=['DELETE'])
def api_tv_hunt_clients_delete(client_id):
    """Delete a download client."""
    try:
        from ._helpers import _get_tv_hunt_instance_id_from_request
        instance_id = _get_tv_hunt_instance_id_from_request()
        if not instance_id:
            return jsonify({'error': 'No instance selected'}), 400
        from src.primary.utils.database import get_database
        db = get_database()
        config = db.get_app_config_for_instance('tv_hunt_clients', instance_id)
        if not config or not isinstance(config.get('clients'), list):
            return jsonify({'error': 'Client not found'}), 404
        
        config['clients'] = [c for c in config['clients'] if c.get('id') != client_id]
        db.save_app_config_for_instance('tv_hunt_clients', instance_id, config)
        return jsonify({'success': True}), 200
    except Exception as e:
        logger.exception('TV Hunt client delete error')
        return jsonify({'error': str(e)}), 500


@tv_hunt_bp.route('/api/tv-hunt/clients/test-connection', methods=['POST'])
def api_tv_hunt_clients_test():
    """Test connection to a download client."""
    try:
        data = request.get_json(silent=True) or {}
        client_type = (data.get('type') or '').lower()
        host = (data.get('host') or '').strip().rstrip('/')
        port = data.get('port')
        api_key = (data.get('api_key') or '').strip()
        use_ssl = data.get('use_ssl', False)

        if not host:
            return jsonify({'success': False, 'message': 'Host is required'}), 400

        if client_type == 'sabnzbd':
            scheme = 'https' if use_ssl else 'http'
            url = f"{scheme}://{host}:{port}/api?mode=version&apikey={api_key}&output=json"
            r = http_requests.get(url, timeout=10)
            if r.ok:
                return jsonify({'success': True, 'message': 'Connected to SABnzbd'})
            return jsonify({'success': False, 'message': f'SABnzbd returned status {r.status_code}'})
        elif client_type == 'nzbget':
            scheme = 'https' if use_ssl else 'http'
            url = f"{scheme}://{host}:{port}/jsonrpc"
            r = http_requests.post(url, json={"method": "version"}, timeout=10)
            if r.ok:
                return jsonify({'success': True, 'message': 'Connected to NZBGet'})
            return jsonify({'success': False, 'message': f'NZBGet returned status {r.status_code}'})
        else:
            return jsonify({'success': False, 'message': f'Unknown client type: {client_type}'}), 400
    except http_requests.exceptions.ConnectionError:
        return jsonify({'success': False, 'message': 'Connection refused'}), 200
    except http_requests.exceptions.Timeout:
        return jsonify({'success': False, 'message': 'Connection timed out'}), 200
    except Exception as e:
        logger.exception('TV Hunt client test error')
        return jsonify({'success': False, 'message': str(e)}), 500
