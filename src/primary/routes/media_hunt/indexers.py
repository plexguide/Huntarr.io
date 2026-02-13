"""
Media Hunt – consolidated indexer routes for Movie Hunt and TV Hunt.
Movie: /api/indexers (index-based, preset dict), config 'indexers'
TV: /api/tv-hunt/indexers (uuid-based, preset list), config 'tv_hunt_indexers' with fallback
"""

import json
import uuid as _uuid

import requests
import xml.etree.ElementTree as ET

from flask import request, jsonify

from ...utils.logger import logger

# Movie presets/categories
MOVIE_INDEXER_PRESETS = {
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
MOVIE_INDEXER_DEFAULT_CATEGORIES = [2000, 2010, 2020, 2030, 2040, 2045, 2050, 2060]
MOVIE_INDEXER_CATEGORIES = [
    {'id': 2000, 'name': 'Movies'}, {'id': 2010, 'name': 'Movies/Foreign'}, {'id': 2020, 'name': 'Movies/Other'},
    {'id': 2030, 'name': 'Movies/SD'}, {'id': 2040, 'name': 'Movies/HD'}, {'id': 2045, 'name': 'Movies/UHD'},
    {'id': 2050, 'name': 'Movies/BluRay'}, {'id': 2060, 'name': 'Movies/3D'}, {'id': 2070, 'name': 'Movies/DVD'},
]
MOVIE_INDEXER_CATEGORIES_DEFAULT_IDS = [2000, 2010, 2020, 2030, 2040, 2045, 2050, 2070]

# TV presets/categories
TV_INDEXER_PRESETS = [
    {"name": "NZBgeek", "url": "https://api.nzbgeek.info", "protocol": "usenet", "default_categories": [5000, 5030, 5040, 5045]},
    {"name": "DrunkenSlug", "url": "https://api.drunkenslug.com", "protocol": "usenet", "default_categories": [5000, 5030, 5040, 5045]},
    {"name": "NZBFinder", "url": "https://nzbfinder.ws", "protocol": "usenet", "default_categories": [5000, 5030, 5040, 5045]},
    {"name": "Tabula Rasa", "url": "https://www.tabula-rasa.pw", "protocol": "usenet", "default_categories": [5000, 5030, 5040, 5045]},
    {"name": "altHUB", "url": "https://api.althub.co.za", "protocol": "usenet", "default_categories": [5000, 5030, 5040, 5045]},
    {"name": "NZB.su", "url": "https://api.nzb.su", "protocol": "usenet", "default_categories": [5000, 5030, 5040, 5045]},
    {"name": "Custom Newznab", "url": "", "protocol": "usenet", "default_categories": [5000, 5030, 5040, 5045]},
]
TV_INDEXER_DEFAULT_CATEGORIES = [5000, 5010, 5020, 5030, 5040, 5045, 5050, 5060, 5070]

# Backward-compat aliases for requestarr, indexer_hunt
INDEXER_PRESETS = MOVIE_INDEXER_PRESETS
INDEXER_DEFAULT_CATEGORIES = MOVIE_INDEXER_DEFAULT_CATEGORIES
INDEXER_CATEGORIES = MOVIE_INDEXER_CATEGORIES


def _get_indexers_config(instance_id):
    """Get movie indexers list. Used by requestarr, indexer_hunt."""
    from src.primary.utils.database import get_database
    db = get_database()
    config = db.get_app_config_for_instance('indexers', instance_id)
    if not config or not isinstance(config.get('indexers'), list):
        return []
    return config['indexers']


def _save_indexers_list(indexers_list, instance_id):
    """Save movie indexers list. Used by indexer_hunt sync."""
    from src.primary.utils.database import get_database
    db = get_database()
    db.save_app_config_for_instance('indexers', instance_id, {'indexers': indexers_list})


def get_tv_indexers_config(instance_id):
    """Get TV indexers list. Used by tv_hunt discovery."""
    from src.primary.utils.database import get_database
    db = get_database()
    config = db.get_app_config_for_instance('tv_hunt_indexers', instance_id)
    if config and isinstance(config.get('indexers'), list):
        return config['indexers']
    config = db.get_app_config_for_instance('indexers', instance_id)
    if config and isinstance(config.get('indexers'), list):
        return config['indexers']
    return []


def _resolve_indexer_api_url(indexer_dict):
    """Resolve full API URL for movie indexer (preset or manual). Used by requestarr."""
    preset = (indexer_dict.get('preset') or 'manual').strip().lower()
    url = (indexer_dict.get('url') or '').strip()
    api_path = (indexer_dict.get('api_path') or '').strip()
    if not url and preset in MOVIE_INDEXER_PRESETS:
        url = MOVIE_INDEXER_PRESETS[preset].get('url', '')
    if not api_path:
        api_path = MOVIE_INDEXER_PRESETS.get(preset, {}).get('api_path', '/api')
    if not url:
        return ''
    return url.rstrip('/') + api_path


def resolve_tv_indexer_api_url(indexer):
    """Resolve full API URL for TV indexer. Used by tv_hunt discovery."""
    url = (indexer.get('api_url') or indexer.get('url') or '').strip().rstrip('/')
    if url and '/api' not in url.lower():
        url = url + '/api'
    return url


def _validate_newznab_api_key(base_url, api_key, timeout=10):
    """Validate a Newznab API key via minimal search. Shared by movie and TV."""
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
            if str(code).strip() in ('100', '101', '102'):
                return False, 'Invalid API key or account not authorized'
            return False, (err.get('description') or err.text or '').strip() or f'Error {code}'
        channel = root.find('.//{http://www.newznab.com/DTD/2010/feeds/}channel') or root.find('.//channel') or root.find('channel')
        items = root.findall('.//{http://www.newznab.com/DTD/2010/feeds/}item') or root.findall('.//item') or root.findall('item')
        if items:
            return True, None
        if channel is not None and (list(channel) or (channel.text and channel.text.strip())):
            return True, None
        if root.tag and ('rss' in root.tag.lower() or 'rss' in root.tag):
            return True, None
        return False, 'Invalid API key or unexpected response from indexer'
    except ET.ParseError:
        return False, 'Invalid response from indexer'
    except requests.RequestException as e:
        return False, str(e) if str(e) else 'Could not connect to indexer'


def _get_movie_preset_api_url(preset_key):
    p = MOVIE_INDEXER_PRESETS.get(preset_key, {})
    url = (p.get('url') or '').rstrip('/')
    api_path = p.get('api_path', '/api')
    return (url + api_path) if url else ''


def register_movie_indexers_routes(bp, get_instance_id):
    """Register Movie Hunt indexer routes (/api/indexers)."""

    @bp.route('/api/indexers/presets', methods=['GET'])
    def api_indexers_presets():
        presets = []
        for key, info in MOVIE_INDEXER_PRESETS.items():
            presets.append({
                'key': key,
                'name': info['name'],
                'url': info['url'],
                'api_path': info.get('api_path', '/api'),
                'categories': info.get('categories', list(MOVIE_INDEXER_DEFAULT_CATEGORIES)),
            })
        presets.sort(key=lambda p: p['name'].lower())
        return jsonify({'presets': presets, 'all_categories': MOVIE_INDEXER_CATEGORIES}), 200

    @bp.route('/api/indexers/validate', methods=['POST'])
    def api_indexers_validate():
        try:
            data = request.get_json() or {}
            preset = (data.get('preset') or '').strip().lower().replace(' ', '')
            api_key = (data.get('api_key') or '').strip()
            custom_url = (data.get('url') or '').strip()
            if preset == 'manual':
                if not custom_url:
                    return jsonify({'valid': False, 'message': 'URL is required for custom indexers'}), 200
                api_path = (data.get('api_path') or '/api').strip()
                base_url = custom_url.rstrip('/') + api_path
            else:
                base_url = _get_movie_preset_api_url(preset)
                if not base_url:
                    return jsonify({'valid': False, 'message': 'Unknown preset'}), 400
            valid, err_msg = _validate_newznab_api_key(base_url, api_key)
            return jsonify({'valid': True} if valid else {'valid': False, 'message': err_msg or 'Validation failed'}), 200
        except Exception as e:
            logger.exception('Indexer validation error')
            return jsonify({'valid': False, 'message': str(e)}), 200

    @bp.route('/api/indexers', methods=['GET'])
    def api_indexers_list():
        try:
            instance_id = get_instance_id()
            indexers = _get_indexers_config(instance_id)
            out = []
            for i, idx in enumerate(indexers):
                key = (idx.get('api_key') or '')
                last4 = key[-4:] if len(key) >= 4 else '****'
                cats = idx.get('categories')
                if not isinstance(cats, list):
                    cats = list(MOVIE_INDEXER_CATEGORIES_DEFAULT_IDS)
                out.append({
                    'index': i, 'name': idx.get('name') or 'Unnamed', 'display_name': idx.get('display_name', ''),
                    'preset': idx.get('preset') or 'manual', 'enabled': idx.get('enabled', True),
                    'api_key_last4': last4, 'categories': cats, 'url': idx.get('url', ''),
                    'api_path': idx.get('api_path', '/api'), 'priority': idx.get('priority', 50),
                    'indexer_hunt_id': idx.get('indexer_hunt_id', ''),
                })
            return jsonify({'indexers': out}), 200
        except Exception as e:
            logger.exception('Indexers list error')
            return jsonify({'indexers': [], 'error': str(e)}), 200

    @bp.route('/api/indexers', methods=['POST'])
    def api_indexers_add():
        try:
            data = request.get_json() or {}
            name = (data.get('name') or '').strip() or 'Unnamed'
            preset = (data.get('preset') or 'manual').strip().lower()
            api_key = (data.get('api_key') or '').strip()
            enabled = data.get('enabled', True)
            categories = data.get('categories')
            if not isinstance(categories, list):
                categories = list(MOVIE_INDEXER_CATEGORIES_DEFAULT_IDS)
            url = (data.get('url') or '').strip()
            api_path = (data.get('api_path') or '/api').strip()
            if preset != 'manual' and preset in MOVIE_INDEXER_PRESETS:
                url = url or MOVIE_INDEXER_PRESETS[preset]['url']
                api_path = api_path or MOVIE_INDEXER_PRESETS[preset].get('api_path', '/api')
            priority = data.get('priority', 50)
            try:
                priority = max(1, min(99, int(priority)))
            except (TypeError, ValueError):
                priority = 50
            indexer_hunt_id = (data.get('indexer_hunt_id') or '').strip() or None
            instance_id = get_instance_id()
            indexers = _get_indexers_config(instance_id)
            new_idx = {
                'name': name, 'preset': preset, 'api_key': api_key, 'enabled': enabled,
                'categories': categories, 'url': url, 'api_path': api_path, 'priority': priority,
            }
            if indexer_hunt_id:
                new_idx['indexer_hunt_id'] = indexer_hunt_id
            indexers.append(new_idx)
            _save_indexers_list(indexers, instance_id)
            return jsonify({'success': True, 'index': len(indexers) - 1}), 200
        except Exception as e:
            logger.exception('Indexers add error')
            return jsonify({'success': False, 'error': str(e)}), 500

    @bp.route('/api/indexers/<int:index>', methods=['PUT'])
    def api_indexers_update(index):
        try:
            instance_id = get_instance_id()
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
                categories = list(existing_cats) if isinstance(existing_cats, list) else list(MOVIE_INDEXER_CATEGORIES_DEFAULT_IDS)
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
                'name': name, 'preset': preset, 'api_key': api_key, 'enabled': enabled,
                'categories': categories, 'url': url, 'api_path': api_path, 'priority': priority,
            }
            if existing.get('indexer_hunt_id'):
                updated['indexer_hunt_id'] = existing['indexer_hunt_id']
            indexers[index] = updated
            _save_indexers_list(indexers, instance_id)
            return jsonify({'success': True}), 200
        except Exception as e:
            logger.exception('Indexers update error')
            return jsonify({'success': False, 'error': str(e)}), 500

    @bp.route('/api/indexers/<int:index>', methods=['DELETE'])
    def api_indexers_delete(index):
        try:
            instance_id = get_instance_id()
            indexers = _get_indexers_config(instance_id)
            if index < 0 or index >= len(indexers):
                return jsonify({'success': False, 'error': 'Index out of range'}), 400
            indexers.pop(index)
            _save_indexers_list(indexers, instance_id)
            return jsonify({'success': True}), 200
        except Exception as e:
            logger.exception('Indexers delete error')
            return jsonify({'success': False, 'error': str(e)}), 500


def register_tv_indexers_routes(bp, get_instance_id):
    """Register TV Hunt indexer routes (/api/tv-hunt/indexers)."""
    from src.primary.utils.database import get_database

    def _get_config(instance_id):
        db = get_database()
        config = db.get_app_config_for_instance('tv_hunt_indexers', instance_id)
        if config and isinstance(config.get('indexers'), list):
            return config['indexers']
        config = db.get_app_config_for_instance('indexers', instance_id)
        if config and isinstance(config.get('indexers'), list):
            return config['indexers']
        return []

    def _save(indexers_list, instance_id):
        db = get_database()
        db.save_app_config_for_instance('tv_hunt_indexers', instance_id, {'indexers': indexers_list})

    @bp.route('/api/tv-hunt/indexers/presets', methods=['GET'])
    def api_tv_indexers_presets():
        return jsonify({'presets': TV_INDEXER_PRESETS}), 200

    @bp.route('/api/tv-hunt/indexers', methods=['GET'])
    def api_tv_indexers_list():
        try:
            instance_id = get_instance_id()
            if not instance_id:
                return jsonify({'indexers': []}), 200
            return jsonify({'indexers': _get_config(instance_id)}), 200
        except Exception as e:
            logger.exception('TV Hunt indexers list error')
            return jsonify({'indexers': [], 'error': str(e)}), 200

    @bp.route('/api/tv-hunt/indexers', methods=['POST'])
    def api_tv_indexers_add():
        try:
            instance_id = get_instance_id()
            if not instance_id:
                return jsonify({'error': 'No instance selected'}), 400
            data = request.get_json() or {}
            new_indexer = {
                'id': str(_uuid.uuid4())[:8],
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
            indexers = _get_config(instance_id)
            indexers.append(new_indexer)
            _save(indexers, instance_id)
            return jsonify({'indexer': new_indexer}), 201
        except Exception as e:
            logger.exception('TV Hunt indexer add error')
            return jsonify({'error': str(e)}), 500

    @bp.route('/api/tv-hunt/indexers/<indexer_id>', methods=['PUT'])
    def api_tv_indexers_update(indexer_id):
        try:
            instance_id = get_instance_id()
            if not instance_id:
                return jsonify({'error': 'No instance selected'}), 400
            data = request.get_json() or {}
            indexers = _get_config(instance_id)
            for idx in indexers:
                if idx.get('id') == indexer_id:
                    for key in ('name', 'display_name', 'url', 'api_url', 'api_key', 'protocol', 'categories', 'priority', 'enabled'):
                        if key in data:
                            idx[key] = data[key]
                    _save(indexers, instance_id)
                    return jsonify({'indexer': idx}), 200
            return jsonify({'error': 'Indexer not found'}), 404
        except Exception as e:
            logger.exception('TV Hunt indexer update error')
            return jsonify({'error': str(e)}), 500

    @bp.route('/api/tv-hunt/indexers/<indexer_id>', methods=['DELETE'])
    def api_tv_indexers_delete(indexer_id):
        try:
            instance_id = get_instance_id()
            if not instance_id:
                return jsonify({'error': 'No instance selected'}), 400
            indexers = [i for i in _get_config(instance_id) if i.get('id') != indexer_id]
            _save(indexers, instance_id)
            return jsonify({'success': True}), 200
        except Exception as e:
            logger.exception('TV Hunt indexer delete error')
            return jsonify({'error': str(e)}), 500
