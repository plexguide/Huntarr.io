"""Movie Hunt download client routes and connection testing."""

import requests

from flask import request, jsonify

from . import movie_hunt_bp
from ._helpers import _get_movie_hunt_instance_id_from_request
from ...utils.logger import logger


def _get_clients_config(instance_id):
    """Get download clients list for a Movie Hunt instance. 100% independent of Radarr."""
    from src.primary.utils.database import get_database
    db = get_database()
    config = db.get_app_config_for_instance('clients', instance_id)
    if not config or not isinstance(config.get('clients'), list):
        return []
    return config['clients']


def _save_clients_list(clients_list, instance_id):
    """Save download clients list for a Movie Hunt instance."""
    from src.primary.utils.database import get_database
    db = get_database()
    db.save_app_config_for_instance('clients', instance_id, {'clients': clients_list})


def _clamp_priority(val, lo=1, hi=99, default=50):
    """Clamp client_priority to [lo, hi]; return default if invalid."""
    try:
        n = int(val)
        return max(lo, min(hi, n))
    except (TypeError, ValueError):
        return default


@movie_hunt_bp.route('/api/clients', methods=['GET'])
def api_clients_list():
    """List saved download clients (sensitive fields masked to last 4 chars)."""
    try:
        instance_id = _get_movie_hunt_instance_id_from_request()
        clients = _get_clients_config(instance_id)
        out = []
        for i, c in enumerate(clients):
            api_key = (c.get('api_key') or '')
            api_key_last4 = api_key[-4:] if len(api_key) >= 4 else '****'

            pwd = (c.get('password') or '')
            password_last4 = pwd[-4:] if len(pwd) >= 4 else '****'

            out.append({
                'index': i,
                'name': c.get('name') or 'Unnamed',
                'type': c.get('type') or 'nzbget',
                'host': c.get('host') or '',
                'port': c.get('port') or 8080,
                'enabled': c.get('enabled', True),
                'api_key_last4': api_key_last4,
                'username': c.get('username') or '',
                'password_last4': password_last4,
                'category': c.get('category') or 'movies',
                'recent_priority': c.get('recent_priority') or 'default',
                'older_priority': c.get('older_priority') or 'default',
                'client_priority': _clamp_priority(c.get('client_priority'), 1, 99, 50),
            })
        return jsonify({'clients': out}), 200
    except Exception as e:
        logger.exception('Clients list error')
        return jsonify({'clients': [], 'error': str(e)}), 200


@movie_hunt_bp.route('/api/clients', methods=['POST'])
def api_clients_add():
    """Add a new download client."""
    try:
        data = request.get_json() or {}
        name = (data.get('name') or '').strip() or 'Unnamed'
        client_type = (data.get('type') or 'nzbget').strip().lower()
        host = 'internal' if client_type == 'nzbhunt' else (data.get('host') or '').strip()
        raw_port = data.get('port')
        if raw_port is None or (isinstance(raw_port, str) and str(raw_port).strip() == ''):
            port = 8080
        else:
            try:
                port = int(raw_port)
            except (TypeError, ValueError):
                port = 8080
        enabled = data.get('enabled', True)
        api_key = (data.get('api_key') or '').strip()
        username = (data.get('username') or '').strip()
        password = (data.get('password') or '').strip()
        category = (data.get('category') or 'movies').strip() or 'movies'
        recent_priority = (data.get('recent_priority') or 'default').strip().lower() or 'default'
        older_priority = (data.get('older_priority') or 'default').strip().lower() or 'default'
        client_priority = _clamp_priority(data.get('client_priority'), 1, 99, 50)
        instance_id = _get_movie_hunt_instance_id_from_request()
        clients = _get_clients_config(instance_id)
        clients.append({
            'name': name,
            'type': client_type,
            'host': host,
            'port': port,
            'enabled': enabled,
            'api_key': api_key,
            'username': username,
            'password': password,
            'category': category,
            'recent_priority': recent_priority,
            'older_priority': older_priority,
            'client_priority': client_priority,
        })
        _save_clients_list(clients, instance_id)
        return jsonify({'success': True, 'index': len(clients) - 1}), 200
    except Exception as e:
        logger.exception('Clients add error')
        return jsonify({'success': False, 'error': str(e)}), 500


@movie_hunt_bp.route('/api/clients/<int:index>', methods=['PUT'])
def api_clients_update(index):
    """Update download client at index."""
    try:
        instance_id = _get_movie_hunt_instance_id_from_request()
        clients = _get_clients_config(instance_id)
        if index < 0 or index >= len(clients):
            return jsonify({'success': False, 'error': 'Index out of range'}), 400
        data = request.get_json() or {}
        name = (data.get('name') or '').strip() or 'Unnamed'
        client_type = (data.get('type') or 'nzbget').strip().lower()
        host = (data.get('host') or '').strip()
        raw_port = data.get('port')
        if raw_port is None or (isinstance(raw_port, str) and str(raw_port).strip() == ''):
            port = clients[index].get('port', 8080)
        else:
            try:
                port = int(raw_port)
            except (TypeError, ValueError):
                port = clients[index].get('port', 8080)
        enabled = data.get('enabled', True)

        api_key_new = (data.get('api_key') or '').strip()
        existing = clients[index]
        api_key = api_key_new if api_key_new else (existing.get('api_key') or '')

        username_new = (data.get('username') or '').strip()
        username = username_new if username_new else (existing.get('username') or '')

        password_new = (data.get('password') or '').strip()
        password = password_new if password_new else (existing.get('password') or '')

        category = (data.get('category') or existing.get('category') or 'movies').strip() or 'movies'
        recent_priority = (data.get('recent_priority') or existing.get('recent_priority') or 'default').strip().lower() or 'default'
        older_priority = (data.get('older_priority') or existing.get('older_priority') or 'default').strip().lower() or 'default'
        client_priority = _clamp_priority(data.get('client_priority') if 'client_priority' in data else existing.get('client_priority'), 1, 99, 50)
        clients[index] = {
            'name': name,
            'type': client_type,
            'host': host,
            'port': port,
            'enabled': enabled,
            'api_key': api_key,
            'username': username,
            'password': password,
            'category': category,
            'recent_priority': recent_priority,
            'older_priority': older_priority,
            'client_priority': client_priority,
        }
        _save_clients_list(clients, instance_id)
        return jsonify({'success': True}), 200
    except Exception as e:
        logger.exception('Clients update error')
        return jsonify({'success': False, 'error': str(e)}), 500


@movie_hunt_bp.route('/api/clients/<int:index>', methods=['DELETE'])
def api_clients_delete(index):
    """Delete download client at index."""
    try:
        instance_id = _get_movie_hunt_instance_id_from_request()
        clients = _get_clients_config(instance_id)
        if index < 0 or index >= len(clients):
            return jsonify({'success': False, 'error': 'Index out of range'}), 400
        clients.pop(index)
        _save_clients_list(clients, instance_id)
        return jsonify({'success': True}), 200
    except Exception as e:
        logger.exception('Clients delete error')
        return jsonify({'success': False, 'error': str(e)}), 500


@movie_hunt_bp.route('/api/clients/test-connection', methods=['POST'])
def api_clients_test_connection():
    """Test connection to a download client (NZB Hunt, SABnzbd, or NZBGet)."""
    try:
        data = request.get_json() or {}
        client_type = (data.get('type') or 'nzbget').strip().lower()

        if client_type == 'nzbhunt':
            try:
                from src.primary.apps.nzb_hunt.download_manager import get_manager
                mgr = get_manager()
                if not mgr.has_servers():
                    return jsonify({
                        'success': False,
                        'message': 'No usenet servers configured. Go to NZB Hunt → Settings to add servers.'
                    }), 200
                results = mgr.test_servers()
                connected = [r for r in results if r[1]]
                if connected:
                    names = ', '.join(r[0] for r in connected)
                    return jsonify({
                        'success': True,
                        'message': f'NZB Hunt ready ({len(connected)} server(s): {names})'
                    }), 200
                else:
                    failed = ', '.join(r[2] for r in results)
                    return jsonify({
                        'success': False,
                        'message': f'Could not connect to any usenet servers: {failed}'
                    }), 200
            except Exception as e:
                return jsonify({'success': False, 'message': f'NZB Hunt error: {e}'}), 200

        host = (data.get('host') or '').strip()
        port = data.get('port', 8080)
        api_key = (data.get('api_key') or '').strip()
        username = (data.get('username') or '').strip()
        password = (data.get('password') or '').strip()

        if not host:
            return jsonify({'success': False, 'message': 'Host is required'}), 400

        if not (host.startswith('http://') or host.startswith('https://')):
            host = f"http://{host}"

        base_url = f"{host.rstrip('/')}:{port}"

        from src.primary.settings_manager import get_ssl_verify_setting
        verify_ssl = get_ssl_verify_setting()

        if client_type == 'sabnzbd':
            test_url = f"{base_url}/api"
            params = {'mode': 'version', 'output': 'json'}
            if api_key:
                params['apikey'] = api_key
            try:
                response = requests.get(test_url, params=params, timeout=10, verify=verify_ssl)
                response.raise_for_status()
                rdata = response.json()
                if 'version' in rdata:
                    version = rdata['version']
                    return jsonify({'success': True, 'message': f'Connected to SABnzbd {version}'}), 200
                else:
                    return jsonify({'success': False, 'message': 'Connected but unexpected response format'}), 200
            except requests.exceptions.HTTPError:
                if response.status_code == 401 or response.status_code == 403:
                    return jsonify({'success': False, 'message': 'Authentication failed: Invalid API key'}), 200
                else:
                    return jsonify({'success': False, 'message': f'HTTP Error {response.status_code}'}), 200
            except requests.exceptions.Timeout:
                return jsonify({'success': False, 'message': 'Connection timeout'}), 200
            except requests.exceptions.ConnectionError:
                return jsonify({'success': False, 'message': 'Connection refused - Check host and port'}), 200
            except Exception as e:
                return jsonify({'success': False, 'message': str(e)}), 200

        elif client_type == 'nzbget':
            test_url = f"{base_url}/jsonrpc"
            payload = {'method': 'version', 'params': [], 'id': 1}
            try:
                auth = (username, password) if username and password else None
                response = requests.post(test_url, json=payload, auth=auth, timeout=10, verify=verify_ssl)
                response.raise_for_status()
                rdata = response.json()
                if 'result' in rdata:
                    version = rdata['result']
                    return jsonify({'success': True, 'message': f'Connected to NZBGet {version}'}), 200
                elif 'error' in rdata:
                    error_msg = rdata['error'].get('message', 'Unknown error')
                    return jsonify({'success': False, 'message': f'NZBGet error: {error_msg}'}), 200
                else:
                    return jsonify({'success': False, 'message': 'Connected but unexpected response format'}), 200
            except requests.exceptions.HTTPError:
                if response.status_code == 401 or response.status_code == 403:
                    return jsonify({'success': False, 'message': 'Authentication failed: Invalid username or password'}), 200
                else:
                    return jsonify({'success': False, 'message': f'HTTP Error {response.status_code}'}), 200
            except requests.exceptions.Timeout:
                return jsonify({'success': False, 'message': 'Connection timeout'}), 200
            except requests.exceptions.ConnectionError:
                return jsonify({'success': False, 'message': 'Connection refused - Check host and port'}), 200
            except Exception as e:
                return jsonify({'success': False, 'message': str(e)}), 200
        else:
            return jsonify({'success': False, 'message': f'Unknown client type: {client_type}'}), 400

    except Exception as e:
        logger.exception('Client connection test error')
        return jsonify({'success': False, 'message': 'Internal server error'}), 500
