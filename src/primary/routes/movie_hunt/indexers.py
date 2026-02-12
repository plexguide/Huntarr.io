"""Movie Hunt indexer routes and validation."""

import json
import requests
import xml.etree.ElementTree as ET

from flask import request, jsonify

from . import movie_hunt_bp
from ._helpers import _get_movie_hunt_instance_id_from_request
from ...utils.logger import logger


# ── Indexer presets (pulled from Radarr source) ───────────────────────
# Each preset has: url, api_path, default_categories
# Categories follow Newznab standard: 2000-series = Movies
INDEXER_PRESETS = {
    'dognzb':         {'name': 'DOGnzb',         'url': 'https://api.dognzb.cr',      'api_path': '/api'},
    'drunkenslug':    {'name': 'DrunkenSlug',     'url': 'https://drunkenslug.com',     'api_path': '/api',
                       'categories': [2000, 2010, 2030, 2040, 2045, 2050, 2060]},
    'nzb.su':         {'name': 'Nzb.su',          'url': 'https://api.nzb.su',          'api_path': '/api',
                       'categories': [2000, 2010, 2020, 2030, 2040, 2045]},
    'nzbcat':         {'name': 'NZBCat',          'url': 'https://nzb.cat',             'api_path': '/api',
                       'categories': [2000, 2010, 2020, 2030, 2040, 2045, 2050, 2060]},
    'nzbfinder.ws':   {'name': 'NZBFinder.ws',    'url': 'https://nzbfinder.ws',        'api_path': '/api',
                       'categories': [2030, 2040, 2045, 2050, 2060, 2070]},
    'nzbgeek':        {'name': 'NZBgeek',         'url': 'https://api.nzbgeek.info',    'api_path': '/api'},
    'nzbplanet.net':  {'name': 'nzbplanet.net',   'url': 'https://api.nzbplanet.net',   'api_path': '/api',
                       'categories': [2000, 2010, 2020, 2030, 2040, 2050, 2060]},
    'simplynzbs':     {'name': 'SimplyNZBs',      'url': 'https://simplynzbs.com',      'api_path': '/api',
                       'categories': [2000, 2010, 2020, 2030, 2040, 2045, 2050, 2060]},
    'tabularasa':     {'name': 'Tabula Rasa',     'url': 'https://www.tabula-rasa.pw',  'api_path': '/api/v1/api',
                       'categories': [2000, 2010, 2030, 2040, 2045, 2050, 2060]},
    'usenetcrawler':  {'name': 'Usenet Crawler',  'url': 'https://www.usenet-crawler.com', 'api_path': '/api',
                       'categories': [2000, 2010, 2020, 2030, 2040, 2045, 2050, 2060]},
}

# Default categories from Radarr: Movies sub-genres
INDEXER_DEFAULT_CATEGORIES = [2000, 2010, 2020, 2030, 2040, 2045, 2050, 2060]

# All available Newznab movie categories
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

def _get_preset_url(preset_key):
    """Get base URL for a preset indexer."""
    p = INDEXER_PRESETS.get(preset_key, {})
    return p.get('url', '')

def _get_preset_api_url(preset_key):
    """Get full API URL for a preset (url + api_path)."""
    p = INDEXER_PRESETS.get(preset_key, {})
    url = p.get('url', '').rstrip('/')
    api_path = p.get('api_path', '/api')
    if not url:
        return ''
    return url + api_path

def _resolve_indexer_api_url(indexer_dict):
    """Resolve the full API URL for an indexer dict (preset or custom).
    Uses stored url/api_path fields, falling back to preset metadata."""
    preset = (indexer_dict.get('preset') or 'manual').strip().lower()
    url = (indexer_dict.get('url') or '').strip()
    api_path = (indexer_dict.get('api_path') or '').strip()
    # For presets, fall back to hardcoded metadata
    if not url and preset in INDEXER_PRESETS:
        url = INDEXER_PRESETS[preset].get('url', '')
    if not api_path:
        if preset in INDEXER_PRESETS:
            api_path = INDEXER_PRESETS[preset].get('api_path', '/api')
        else:
            api_path = '/api'
    if not url:
        return ''
    return url.rstrip('/') + api_path


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


@movie_hunt_bp.route('/api/indexers/presets', methods=['GET'])
def api_indexers_presets():
    """Return all available indexer presets with their metadata."""
    presets = []
    for key, info in INDEXER_PRESETS.items():
        cats = info.get('categories', list(INDEXER_DEFAULT_CATEGORIES))
        presets.append({
            'key': key,
            'name': info['name'],
            'url': info['url'],
            'api_path': info.get('api_path', '/api'),
            'categories': cats,
        })
    # Sort alphabetically
    presets.sort(key=lambda p: p['name'].lower())
    return jsonify({'presets': presets, 'all_categories': INDEXER_CATEGORIES}), 200


@movie_hunt_bp.route('/api/indexers/validate', methods=['POST'])
def api_indexers_validate():
    """Validate an indexer API key for a given preset or custom URL."""
    try:
        data = request.get_json() or {}
        preset = (data.get('preset') or '').strip().lower().replace(' ', '')
        api_key = (data.get('api_key') or '').strip()
        custom_url = (data.get('url') or '').strip()

        if preset == 'manual':
            # For manual/custom indexers, use the provided URL
            if not custom_url:
                return jsonify({'valid': False, 'message': 'URL is required for custom indexers'}), 200
            api_path = (data.get('api_path') or '/api').strip()
            base_url = custom_url.rstrip('/') + api_path
        else:
            base_url = _get_preset_api_url(preset)
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
                'display_name': idx.get('display_name', ''),
                'preset': idx.get('preset') or 'manual',
                'enabled': idx.get('enabled', True),
                'api_key_last4': last4,
                'categories': cats,
                'url': idx.get('url', ''),
                'api_path': idx.get('api_path', '/api'),
                'priority': idx.get('priority', 50),
                'indexer_hunt_id': idx.get('indexer_hunt_id', ''),
            })
        return jsonify({'indexers': out}), 200
    except Exception as e:
        logger.exception('Indexers list error')
        return jsonify({'indexers': [], 'error': str(e)}), 200


@movie_hunt_bp.route('/api/indexers', methods=['POST'])
def api_indexers_add():
    """Add a new indexer. Body: { name, preset, api_key, enabled, categories, url, api_path }."""
    try:
        data = request.get_json() or {}
        name = (data.get('name') or '').strip() or 'Unnamed'
        preset = (data.get('preset') or 'manual').strip().lower()
        api_key = (data.get('api_key') or '').strip()
        enabled = data.get('enabled', True)
        categories = data.get('categories')
        if not isinstance(categories, list):
            categories = list(INDEXER_CATEGORIES_DEFAULT_IDS)
        # URL: use preset URL if available, otherwise use provided URL
        url = (data.get('url') or '').strip()
        api_path = (data.get('api_path') or '/api').strip()
        if preset != 'manual' and preset in INDEXER_PRESETS:
            url = url or INDEXER_PRESETS[preset]['url']
            api_path = api_path or INDEXER_PRESETS[preset].get('api_path', '/api')

        # Priority (1-99, default 50)
        priority = data.get('priority', 50)
        try:
            priority = max(1, min(99, int(priority)))
        except (TypeError, ValueError):
            priority = 50
        # Indexer Hunt link (set when synced from Indexer Hunt)
        indexer_hunt_id = (data.get('indexer_hunt_id') or '').strip() or None

        instance_id = _get_movie_hunt_instance_id_from_request()
        indexers = _get_indexers_config(instance_id)
        new_idx = {
            'name': name,
            'preset': preset,
            'api_key': api_key,
            'enabled': enabled,
            'categories': categories,
            'url': url,
            'api_path': api_path,
            'priority': priority,
        }
        if indexer_hunt_id:
            new_idx['indexer_hunt_id'] = indexer_hunt_id
        indexers.append(new_idx)
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
        url = (data.get('url') or '').strip() or existing.get('url', '')
        api_path = (data.get('api_path') or '').strip() or existing.get('api_path', '/api')
        priority = data.get('priority', existing.get('priority', 50))
        try:
            priority = max(1, min(99, int(priority)))
        except (TypeError, ValueError):
            priority = existing.get('priority', 50)
        updated = {
            'name': name,
            'preset': preset,
            'api_key': api_key,
            'enabled': enabled,
            'categories': categories,
            'url': url,
            'api_path': api_path,
            'priority': priority,
        }
        # Preserve Indexer Hunt link if present
        ih_id = existing.get('indexer_hunt_id')
        if ih_id:
            updated['indexer_hunt_id'] = ih_id
        indexers[index] = updated
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
