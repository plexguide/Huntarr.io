"""
Media Hunt – consolidated download client routes for Movie Hunt and TV Hunt.
Movie: /api/clients (index-based), config 'clients'
TV: /api/tv-hunt/clients (uuid-based), config 'tv_hunt_clients' with fallback to 'clients'
"""

import uuid as _uuid

import requests

from flask import request, jsonify

from ...utils.logger import logger


def _clamp_priority(val, lo=1, hi=99, default=50):
    """Clamp client_priority to [lo, hi]; return default if invalid."""
    try:
        n = int(val)
        return max(lo, min(hi, n))
    except (TypeError, ValueError):
        return default


def _register_clients_routes(bp, get_instance_id, config_key, route_prefix, use_uuid, fallback_config_key=None):
    """
    Register client CRUD and test-connection routes.
    use_uuid: True for TV (id string), False for Movie (index int)
    fallback_config_key: TV can fall back to 'clients' when reading
    """
    from src.primary.utils.database import get_database

    def _get_clients(instance_id):
        db = get_database()
        config = db.get_app_config_for_instance(config_key, instance_id)
        if config and isinstance(config.get('clients'), list):
            return config['clients']
        if fallback_config_key:
            config = db.get_app_config_for_instance(fallback_config_key, instance_id)
            if config and isinstance(config.get('clients'), list):
                return config['clients']
        return []

    def _save_clients(clients_list, instance_id):
        db = get_database()
        db.save_app_config_for_instance(config_key, instance_id, {'clients': clients_list})

    prefix = '/api/' + (route_prefix.strip('/') + '/' if route_prefix else '') + 'clients'
    test_path = prefix + '/test-connection'

    # --- List ---
    @bp.route(prefix, methods=['GET'])
    def api_clients_list():
        try:
            instance_id = get_instance_id()
            if not instance_id and route_prefix:
                return jsonify({'clients': []}), 200
            clients = _get_clients(instance_id)
            out = []
            for i, c in enumerate(clients):
                api_key = (c.get('api_key') or '')
                api_key_last4 = api_key[-4:] if len(api_key) >= 4 else '****'
                pwd = (c.get('password') or '')
                password_last4 = pwd[-4:] if len(pwd) >= 4 else '****'
                item = {
                    'index' if not use_uuid else 'id': i if not use_uuid else c.get('id', ''),
                    'name': c.get('name') or 'Unnamed',
                    'type': c.get('type') or ('nzbget' if not route_prefix else 'nzb_hunt'),
                    'host': c.get('host') or '',
                    'port': c.get('port', 8080),
                    'enabled': c.get('enabled', True),
                    'api_key_last4': api_key_last4,
                    'username': c.get('username') or '',
                    'password_last4': password_last4,
                    'category': c.get('category') or ('movies' if not route_prefix else 'tv'),
                }
                if not use_uuid:
                    item['recent_priority'] = c.get('recent_priority') or 'default'
                    item['older_priority'] = c.get('older_priority') or 'default'
                    item['client_priority'] = _clamp_priority(c.get('client_priority'), 1, 99, 50)
                out.append(item)
            return jsonify({'clients': out}), 200
        except Exception as e:
            logger.exception('Clients list error')
            return jsonify({'clients': [], 'error': str(e)}), 200

    # --- Add ---
    @bp.route(prefix, methods=['POST'])
    def api_clients_add():
        try:
            instance_id = get_instance_id()
            if not instance_id and route_prefix:
                return jsonify({'error': 'No instance selected', 'success': False}), 400
            data = request.get_json() or {}
            name = (data.get('name') or '').strip() or 'Unnamed'
            client_type = (data.get('type') or ('nzbget' if not route_prefix else 'nzb_hunt')).strip().lower()
            host = 'internal' if client_type in ('nzbhunt', 'nzb_hunt') else (data.get('host') or '').strip()
            raw_port = data.get('port')
            default_port = 6789 if client_type == 'nzbget' else 8080
            if raw_port is None or (isinstance(raw_port, str) and str(raw_port).strip() == ''):
                port = default_port
            else:
                try:
                    port = int(raw_port)
                except (TypeError, ValueError):
                    port = default_port
            enabled = data.get('enabled', True)
            api_key = (data.get('api_key') or '').strip()
            username = (data.get('username') or '').strip()
            password = (data.get('password') or '').strip()
            category = (data.get('category') or ('movies' if not route_prefix else 'tv')).strip() or ('movies' if not route_prefix else 'tv')

            clients = _get_clients(instance_id)
            new_client = {
                'name': name,
                'type': client_type,
                'host': host,
                'port': port,
                'enabled': enabled,
                'api_key': api_key,
                'username': username,
                'password': password,
                'category': category,
            }
            if use_uuid:
                new_client['id'] = str(_uuid.uuid4())[:8]
            else:
                new_client['recent_priority'] = (data.get('recent_priority') or 'default').strip().lower() or 'default'
                new_client['older_priority'] = (data.get('older_priority') or 'default').strip().lower() or 'default'
                new_client['client_priority'] = _clamp_priority(data.get('client_priority'), 1, 99, 50)

            clients.append(new_client)
            _save_clients(clients, instance_id)
            if use_uuid:
                return jsonify({'client': new_client, 'success': True}), 201
            return jsonify({'success': True, 'index': len(clients) - 1}), 200
        except Exception as e:
            logger.exception('Clients add error')
            return jsonify({'success': False, 'error': str(e)}), 500

    # --- Update (index or uuid) ---
    if use_uuid:
        @bp.route(prefix + '/<client_id>', methods=['PUT'])
        def api_clients_update(client_id):
            try:
                instance_id = get_instance_id()
                if not instance_id:
                    return jsonify({'error': 'No instance selected', 'success': False}), 400
                data = request.get_json() or {}
                clients = _get_clients(instance_id)
                for c in clients:
                    if c.get('id') == client_id:
                        for key in ('name', 'type', 'host', 'api_key', 'username', 'password', 'category', 'enabled'):
                            if key in data:
                                c[key] = data[key]
                        # NZB Hunt uses internal host - ensure it stays set
                        ct = (c.get('type') or '').strip().lower()
                        if ct in ('nzbhunt', 'nzb_hunt'):
                            c['host'] = 'internal'
                        _save_clients(clients, instance_id)
                        return jsonify({'client': c, 'success': True}), 200
                return jsonify({'error': 'Client not found', 'success': False}), 404
            except Exception as e:
                logger.exception('Clients update error')
                return jsonify({'success': False, 'error': str(e)}), 500
    else:
        @bp.route(prefix + '/<int:index>', methods=['PUT'])
        def api_clients_update(index):
            try:
                instance_id = get_instance_id()
                clients = _get_clients(instance_id)
                if index < 0 or index >= len(clients):
                    return jsonify({'success': False, 'error': 'Index out of range'}), 400
                data = request.get_json() or {}
                name = (data.get('name') or '').strip() or 'Unnamed'
                client_type = (data.get('type') or 'nzbget').strip().lower()
                host = 'internal' if client_type in ('nzbhunt', 'nzb_hunt') else (data.get('host') or '').strip()
                raw_port = data.get('port')
                if raw_port is None or (isinstance(raw_port, str) and str(raw_port).strip() == ''):
                    port = clients[index].get('port', 8080)
                else:
                    try:
                        port = int(raw_port)
                    except (TypeError, ValueError):
                        port = clients[index].get('port', 8080)
                enabled = data.get('enabled', True)
                existing = clients[index]
                api_key = (data.get('api_key') or '').strip() or (existing.get('api_key') or '')
                username = (data.get('username') or '').strip() or (existing.get('username') or '')
                password = (data.get('password') or '').strip() or (existing.get('password') or '')
                category = (data.get('category') or existing.get('category') or 'movies').strip() or 'movies'
                recent_priority = (data.get('recent_priority') or existing.get('recent_priority') or 'default').strip().lower() or 'default'
                older_priority = (data.get('older_priority') or existing.get('older_priority') or 'default').strip().lower() or 'default'
                client_priority = _clamp_priority(data.get('client_priority') if 'client_priority' in data else existing.get('client_priority'), 1, 99, 50)
                clients[index] = {
                    'name': name, 'type': client_type, 'host': host, 'port': port, 'enabled': enabled,
                    'api_key': api_key, 'username': username, 'password': password, 'category': category,
                    'recent_priority': recent_priority, 'older_priority': older_priority, 'client_priority': client_priority,
                }
                _save_clients(clients, instance_id)
                return jsonify({'success': True}), 200
            except Exception as e:
                logger.exception('Clients update error')
                return jsonify({'success': False, 'error': str(e)}), 500

    # --- Delete ---
    if use_uuid:
        @bp.route(prefix + '/<client_id>', methods=['DELETE'])
        def api_clients_delete(client_id):
            try:
                instance_id = get_instance_id()
                if not instance_id:
                    return jsonify({'error': 'No instance selected', 'success': False}), 400
                clients = _get_clients(instance_id)
                clients = [c for c in clients if c.get('id') != client_id]
                _save_clients(clients, instance_id)
                return jsonify({'success': True}), 200
            except Exception as e:
                logger.exception('Clients delete error')
                return jsonify({'success': False, 'error': str(e)}), 500
    else:
        @bp.route(prefix + '/<int:index>', methods=['DELETE'])
        def api_clients_delete(index):
            try:
                instance_id = get_instance_id()
                clients = _get_clients(instance_id)
                if index < 0 or index >= len(clients):
                    return jsonify({'success': False, 'error': 'Index out of range'}), 400
                clients.pop(index)
                _save_clients(clients, instance_id)
                return jsonify({'success': True}), 200
            except Exception as e:
                logger.exception('Clients delete error')
                return jsonify({'success': False, 'error': str(e)}), 500

    # --- Test connection ---
    @bp.route(test_path, methods=['POST'])
    def api_clients_test_connection():
        try:
            data = request.get_json() or {}
            client_type = (data.get('type') or 'nzbget').strip().lower()

            if client_type in ('nzbhunt', 'nzb_hunt'):
                try:
                    from src.primary.routes.nzb_hunt_routes import has_nzb_servers
                    from src.primary.apps.nzb_hunt.download_manager import get_manager
                    if not has_nzb_servers():
                        return jsonify({
                            'success': False,
                            'message': 'No usenet servers configured. Go to NZB Hunt → Settings to add servers.'
                        }), 200
                    mgr = get_manager()
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
            use_ssl = data.get('use_ssl', False)

            if not host:
                return jsonify({'success': False, 'message': 'Host is required'}), 400

            scheme = 'https' if use_ssl else 'http'
            if not (host.startswith('http://') or host.startswith('https://')):
                host = f"{scheme}://{host}"
            else:
                scheme = 'https' if host.startswith('https') else 'http'
            base_url = f"{host.rstrip('/')}:{port}" if '://' in host else f"{scheme}://{host.rstrip('/')}:{port}"

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
                        return jsonify({'success': True, 'message': f'Connected to SABnzbd {rdata["version"]}'}), 200
                    return jsonify({'success': False, 'message': 'Connected but unexpected response format'}), 200
                except requests.exceptions.HTTPError:
                    if response.status_code in (401, 403):
                        return jsonify({'success': False, 'message': 'Authentication failed: Invalid API key'}), 200
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
                        return jsonify({'success': True, 'message': f'Connected to NZBGet {rdata["result"]}'}), 200
                    if 'error' in rdata:
                        return jsonify({'success': False, 'message': f'NZBGet error: {rdata["error"].get("message", "Unknown")}'}), 200
                    return jsonify({'success': False, 'message': 'Connected but unexpected response format'}), 200
                except requests.exceptions.HTTPError:
                    if response.status_code in (401, 403):
                        return jsonify({'success': False, 'message': 'Authentication failed: Invalid username or password'}), 200
                    return jsonify({'success': False, 'message': f'HTTP Error {response.status_code}'}), 200
                except requests.exceptions.Timeout:
                    return jsonify({'success': False, 'message': 'Connection timeout'}), 200
                except requests.exceptions.ConnectionError:
                    return jsonify({'success': False, 'message': 'Connection refused - Check host and port'}), 200
                except Exception as e:
                    return jsonify({'success': False, 'message': str(e)}), 200

            return jsonify({'success': False, 'message': f'Unknown client type: {client_type}'}), 400
        except Exception as e:
            logger.exception('Client connection test error')
            return jsonify({'success': False, 'message': 'Internal server error'}), 500


def get_movie_clients_config(instance_id):
    """Return raw clients list for Movie Hunt. Used by activity, discovery."""
    from src.primary.utils.database import get_database
    db = get_database()
    config = db.get_app_config_for_instance('clients', instance_id)
    if not config or not isinstance(config.get('clients'), list):
        return []
    return config['clients']


def get_tv_clients_config(instance_id):
    """Return raw clients list for TV Hunt. Used by discovery."""
    from src.primary.utils.database import get_database
    db = get_database()
    config = db.get_app_config_for_instance('tv_hunt_clients', instance_id)
    if config and isinstance(config.get('clients'), list):
        return config['clients']
    config = db.get_app_config_for_instance('clients', instance_id)
    if config and isinstance(config.get('clients'), list):
        return config['clients']
    return []


def register_movie_clients_routes(bp, get_instance_id):
    """Register Movie Hunt client routes (/api/clients, index-based)."""
    _register_clients_routes(bp, get_instance_id, 'clients', '', use_uuid=False, fallback_config_key=None)


def register_tv_clients_routes(bp, get_instance_id):
    """Register TV Hunt client routes (/api/tv-hunt/clients, uuid-based)."""
    _register_clients_routes(bp, get_instance_id, 'tv_hunt_clients', 'tv-hunt', use_uuid=True, fallback_config_key='clients')
