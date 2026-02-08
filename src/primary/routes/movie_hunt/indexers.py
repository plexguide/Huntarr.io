"""Movie Hunt indexer routes and validation."""

import json
import requests
import xml.etree.ElementTree as ET

from flask import request, jsonify

from . import movie_hunt_bp
from ._helpers import _get_movie_hunt_instance_id_from_request
from ...utils.logger import logger


# Newznab indexer preset base URLs (used for API key validation)
INDEXER_PRESET_URLS = {
    'nzbgeek': 'https://api.nzbgeek.info/api',
    'nzbfinder.ws': 'https://api.nzbfinder.ws/api',
}

# Indexer categories (Movies only). By default all selected except Movies/3D (2060).
INDEXER_CATEGORIES = [
    {'id': 2000, 'name': 'Movies'},
    {'id': 2010, 'name': 'Movies/Foreign'},
    {'id': 2020, 'name': 'Movies/Other'},
    {'id': 2030, 'name': 'Movies/SD'},
    {'id': 2040, 'name': 'Movies/HD'},
    {'id': 2045, 'name': 'Movies/UHD'},
    {'id': 2050, 'name': 'Movies/BluRay'},
    {'id': 2060, 'name': 'Movies/3D'},
    {'id': 2070, 'name': 'Movies/DVD'},
]
INDEXER_CATEGORIES_DEFAULT_IDS = [2000, 2010, 2020, 2030, 2040, 2045, 2050, 2070]


def _validate_newznab_api_key(base_url, api_key, timeout=10):
    """
    Validate a Newznab API key by performing a minimal search request.
    Per Newznab API: t=search requires apikey; error codes 100/101/102 = invalid credentials.
    """
    if not (base_url and api_key and api_key.strip()):
        return False, 'API key is required'
    api_key = api_key.strip()
    url = f'{base_url.rstrip("/")}?t=search&apikey={requests.utils.quote(api_key)}&q=test&limit=1'
    try:
        r = requests.get(url, timeout=timeout)
        if r.status_code != 200:
            return False, f'Indexer returned HTTP {r.status_code}'
        text = (r.text or '').strip()
        if not text:
            return False, 'Empty response from indexer'
        text_lower = text.lower()
        for phrase in ('invalid api key', 'invalid key', 'api key is invalid', 'unauthorized', 'authentication failed', 'access denied', 'invalid apikey'):
            if phrase in text_lower:
                return False, 'Invalid API key or not authorized'
        if text.lstrip().startswith('{'):
            try:
                data = json.loads(text)
                if data.get('error') or data.get('@attributes', {}).get('error'):
                    return False, data.get('description') or data.get('error') or 'Invalid API key'
                if 'channel' in data or 'item' in data or 'items' in data:
                    return True, None
                return False, 'Invalid API key or unexpected response'
            except (ValueError, TypeError):
                pass
        root = ET.fromstring(text)
        err = root.find('.//{http://www.newznab.com/DTD/2010/feeds/attributes/}error')
        if err is None:
            err = root.find('.//error') or root.find('error')
        if err is not None:
            code = err.get('code') or err.get('description') or ''
            code_str = str(code).strip()
            if code_str in ('100', '101', '102'):
                return False, 'Invalid API key or account not authorized'
            desc = err.get('description') or err.text or ''
            return False, (desc.strip() or f'Error {code_str}')
        channel = root.find('.//{http://www.newznab.com/DTD/2010/feeds/}channel') or root.find('.//channel') or root.find('channel')
        items = root.findall('.//{http://www.newznab.com/DTD/2010/feeds/}item') or root.findall('.//item') or root.findall('item')
        if items:
            return True, None
        if channel is not None:
            if list(channel) or (channel.text and channel.text.strip()):
                return True, None
            return False, 'Invalid API key or account not authorized'
        if root.tag and ('rss' in root.tag.lower() or 'rss' in root.tag):
            return True, None
        logger.debug('Indexer validation: no error element but no channel/item; response sample: %s', text[:400].replace(api_key, '***'))
        return False, 'Invalid API key or unexpected response from indexer'
    except ET.ParseError:
        return False, 'Invalid response from indexer'
    except requests.RequestException as e:
        return False, str(e) if str(e) else 'Could not connect to indexer'


def _get_indexers_config(instance_id):
    """Get indexers list for a Movie Hunt instance."""
    from src.primary.utils.database import get_database
    db = get_database()
    config = db.get_app_config_for_instance('indexers', instance_id)
    if not config or not isinstance(config.get('indexers'), list):
        return []
    return config['indexers']


def _save_indexers_list(indexers_list, instance_id):
    """Save indexers list for a Movie Hunt instance."""
    from src.primary.utils.database import get_database
    db = get_database()
    db.save_app_config_for_instance('indexers', instance_id, {'indexers': indexers_list})


@movie_hunt_bp.route('/api/indexers/validate', methods=['POST'])
def api_indexers_validate():
    """Validate an indexer API key for a given preset."""
    try:
        data = request.get_json() or {}
        preset = (data.get('preset') or '').strip().lower().replace(' ', '')
        api_key = (data.get('api_key') or '').strip()
        if preset == 'manual':
            return jsonify({'valid': True, 'message': 'Manual configuration is not validated'}), 200
        base_url = INDEXER_PRESET_URLS.get(preset)
        if not base_url:
            return jsonify({'valid': False, 'message': 'Unknown preset'}), 400
        valid, err_msg = _validate_newznab_api_key(base_url, api_key)
        if valid:
            return jsonify({'valid': True}), 200
        return jsonify({'valid': False, 'message': err_msg or 'Validation failed'}), 200
    except Exception as e:
        logger.exception('Indexer validation error')
        return jsonify({'valid': False, 'message': str(e)}), 200


@movie_hunt_bp.route('/api/indexers', methods=['GET'])
def api_indexers_list():
    """List saved indexers (API key masked to last 4 chars). Includes categories for editor."""
    try:
        instance_id = _get_movie_hunt_instance_id_from_request()
        indexers = _get_indexers_config(instance_id)
        out = []
        for i, idx in enumerate(indexers):
            key = (idx.get('api_key') or '')
            last4 = key[-4:] if len(key) >= 4 else '****'
            cats = idx.get('categories')
            if not isinstance(cats, list):
                cats = list(INDEXER_CATEGORIES_DEFAULT_IDS)
            out.append({
                'index': i,
                'name': idx.get('name') or 'Unnamed',
                'preset': idx.get('preset') or 'manual',
                'enabled': idx.get('enabled', True),
                'api_key_last4': last4,
                'categories': cats,
            })
        return jsonify({'indexers': out}), 200
    except Exception as e:
        logger.exception('Indexers list error')
        return jsonify({'indexers': [], 'error': str(e)}), 200


@movie_hunt_bp.route('/api/indexers', methods=['POST'])
def api_indexers_add():
    """Add a new indexer. Body: { name, preset, api_key, enabled, categories }."""
    try:
        data = request.get_json() or {}
        name = (data.get('name') or '').strip() or 'Unnamed'
        preset = (data.get('preset') or 'manual').strip().lower()
        api_key = (data.get('api_key') or '').strip()
        enabled = data.get('enabled', True)
        categories = data.get('categories')
        if not isinstance(categories, list):
            categories = list(INDEXER_CATEGORIES_DEFAULT_IDS)
        instance_id = _get_movie_hunt_instance_id_from_request()
        indexers = _get_indexers_config(instance_id)
        indexers.append({
            'name': name,
            'preset': preset,
            'api_key': api_key,
            'enabled': enabled,
            'categories': categories,
        })
        _save_indexers_list(indexers, instance_id)
        return jsonify({'success': True, 'index': len(indexers) - 1}), 200
    except Exception as e:
        logger.exception('Indexers add error')
        return jsonify({'success': False, 'error': str(e)}), 500


@movie_hunt_bp.route('/api/indexers/<int:index>', methods=['PUT'])
def api_indexers_update(index):
    """Update indexer at index."""
    try:
        instance_id = _get_movie_hunt_instance_id_from_request()
        indexers = _get_indexers_config(instance_id)
        if index < 0 or index >= len(indexers):
            return jsonify({'success': False, 'error': 'Index out of range'}), 400
        data = request.get_json() or {}
        name = (data.get('name') or '').strip() or 'Unnamed'
        preset = (data.get('preset') or 'manual').strip().lower()
        api_key_new = (data.get('api_key') or '').strip()
        enabled = data.get('enabled', True)
        categories = data.get('categories')
        if not isinstance(categories, list):
            existing_cats = indexers[index].get('categories')
            categories = list(existing_cats) if isinstance(existing_cats, list) else list(INDEXER_CATEGORIES_DEFAULT_IDS)
        existing = indexers[index]
        api_key = api_key_new if api_key_new else (existing.get('api_key') or '')
        indexers[index] = {
            'name': name,
            'preset': preset,
            'api_key': api_key,
            'enabled': enabled,
            'categories': categories,
        }
        _save_indexers_list(indexers, instance_id)
        return jsonify({'success': True}), 200
    except Exception as e:
        logger.exception('Indexers update error')
        return jsonify({'success': False, 'error': str(e)}), 500


@movie_hunt_bp.route('/api/indexers/<int:index>', methods=['DELETE'])
def api_indexers_delete(index):
    """Delete indexer at index."""
    try:
        instance_id = _get_movie_hunt_instance_id_from_request()
        indexers = _get_indexers_config(instance_id)
        if index < 0 or index >= len(indexers):
            return jsonify({'success': False, 'error': 'Index out of range'}), 400
        indexers.pop(index)
        _save_indexers_list(indexers, instance_id)
        return jsonify({'success': True}), 200
    except Exception as e:
        logger.exception('Indexers delete error')
        return jsonify({'success': False, 'error': str(e)}), 500
