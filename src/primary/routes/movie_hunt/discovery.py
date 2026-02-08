"""Movie Hunt discovery/request routes: search, NZB download, TMDB discover, collection."""

import json
import requests
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta

from flask import request, jsonify

from . import movie_hunt_bp, movie_hunt_logger
from ._helpers import (
    _get_movie_hunt_instance_id_from_request,
    _get_blocklist_source_titles,
    _blocklist_normalize_source_title,
    _add_requested_queue_id,
    MOVIE_HUNT_DEFAULT_CATEGORY,
)
from .indexers import _get_indexers_config, INDEXER_PRESET_URLS
from .profiles import _get_profile_by_name_or_default, _best_result_matching_profile
from .clients import _get_clients_config
from .storage import _get_root_folders_config
from ...utils.logger import logger


# --- Newznab search ---

def _parse_size_from_item(it, enc):
    """Extract size in bytes from JSON API item. Returns 0 if missing."""
    size = it.get('size')
    if size is not None:
        try:
            return int(size)
        except (TypeError, ValueError):
            pass
    if isinstance(enc, dict):
        length = enc.get('length') or enc.get('@length')
        if length is not None:
            try:
                return int(length)
            except (TypeError, ValueError):
                pass
    attrs = it.get('newznab:attr') or it.get('attr') or []
    if isinstance(attrs, dict):
        attrs = [attrs]
    for a in attrs:
        if isinstance(a, dict) and (a.get('@name') or a.get('name')) == 'size':
            v = a.get('@value') or a.get('value')
            if v is not None:
                try:
                    return int(v)
                except (TypeError, ValueError):
                    pass
    return 0


def _parse_size_from_xml_item(item, enc, ns, attr_ns):
    """Extract size in bytes from XML item (enclosure length or newznab:attr). Returns 0 if missing."""
    if enc is not None:
        length = enc.get('length')
        if length is not None:
            try:
                return int(length)
            except (TypeError, ValueError):
                pass
    for attr in item:
        tag = (attr.tag or '').split('}')[-1] if '}' in str(attr.tag) else (attr.tag or '')
        if tag.lower() != 'attr':
            continue
        name = attr.get('name') or attr.get('{http://www.newznab.com/DTD/2010/feeds/attributes/}name')
        if name != 'size':
            continue
        v = attr.get('value') or attr.get('{http://www.newznab.com/DTD/2010/feeds/attributes/}value')
        if v is not None:
            try:
                return int(v)
            except (TypeError, ValueError):
                pass
    return 0


def _search_newznab_movie(base_url, api_key, query, categories, timeout=15):
    """Search a Newznab indexer for movie NZBs. Returns list of {title, nzb_url}."""
    if not (base_url and api_key and query and query.strip()):
        return []
    base_url = base_url.rstrip('/')
    api_key = api_key.strip()
    query = query.strip()
    if isinstance(categories, (list, tuple)):
        cat_str = ','.join(str(c) for c in categories)
    else:
        cat_str = str(categories).strip() or '2000,2010,2020,2030,2040,2045,2050,2070'
    url = f'{base_url}?t=search&apikey={requests.utils.quote(api_key)}&q={requests.utils.quote(query)}&cat={cat_str}&limit=10'
    try:
        from src.primary.settings_manager import get_ssl_verify_setting
        verify_ssl = get_ssl_verify_setting()
        r = requests.get(url, timeout=timeout, verify=verify_ssl)
        if r.status_code != 200:
            return []
        text = (r.text or '').strip()
        if not text:
            return []
        results = []
        if text.lstrip().startswith('{'):
            try:
                data = json.loads(text)
                channel = data.get('channel') or data.get('rss', {}).get('channel') or {}
                items = channel.get('item') or channel.get('items') or []
                if isinstance(items, dict):
                    items = [items]
                for it in items:
                    nzb_url = None
                    enc = it.get('enclosure') or (it.get('enclosures') or [{}])[0] if isinstance(it.get('enclosures'), list) else None
                    if isinstance(enc, dict) and enc.get('@url'):
                        nzb_url = enc.get('@url')
                    elif isinstance(enc, dict) and enc.get('url'):
                        nzb_url = enc.get('url')
                    if not nzb_url and it.get('link'):
                        nzb_url = it.get('link')
                    if not nzb_url:
                        continue
                    title = (it.get('title') or '').strip() or 'Unknown'
                    size_bytes = _parse_size_from_item(it, enc)
                    results.append({'title': title, 'nzb_url': nzb_url, 'size_bytes': size_bytes})
                return results
            except (ValueError, TypeError, KeyError):
                pass
        root = ET.fromstring(text)
        ns = {'nzb': 'http://www.newznab.com/DTD/2010/feeds/'}
        items = root.findall('.//nzb:item', ns) or root.findall('.//item')
        attr_ns = 'http://www.newznab.com/DTD/2010/feeds/attributes/'
        for item in items:
            nzb_url = None
            enc = item.find('nzb:enclosure', ns) or item.find('enclosure')
            if enc is not None and enc.get('url'):
                nzb_url = enc.get('url')
            if not nzb_url:
                link = item.find('nzb:link', ns) or item.find('link')
                if link is not None and (link.text or '').strip():
                    nzb_url = (link.text or '').strip()
            if not nzb_url:
                continue
            title_el = item.find('nzb:title', ns) or item.find('title')
            title = (title_el.text or '').strip() if title_el is not None else 'Unknown'
            size_bytes = _parse_size_from_xml_item(item, enc, ns, attr_ns)
            results.append({'title': title, 'nzb_url': nzb_url, 'size_bytes': size_bytes})
        return results
    except (ET.ParseError, requests.RequestException) as e:
        logger.debug('Newznab search error: %s', e)
        return []


# --- Send NZB to download client ---

def _add_nzb_to_download_client(client, nzb_url, nzb_name, category, verify_ssl, indexer=""):
    """Send NZB URL to NZB Hunt, SABnzbd, or NZBGet. Returns (success, message, queue_id)."""
    client_type = (client.get('type') or 'nzbget').strip().lower()

    raw = (category or client.get('category') or '').strip()
    if raw.lower() in ('default', '*', ''):
        cat = MOVIE_HUNT_DEFAULT_CATEGORY
    else:
        cat = raw or MOVIE_HUNT_DEFAULT_CATEGORY

    try:
        if client_type == 'nzbhunt':
            from src.primary.apps.nzb_hunt.download_manager import get_manager
            mgr = get_manager()
            success, message, queue_id = mgr.add_nzb(
                nzb_url=nzb_url,
                name=nzb_name or '',
                category=cat,
                priority=client.get('recent_priority', 'normal'),
                added_by='movie_hunt',
                nzb_name=nzb_name or '',
                indexer=indexer,
            )
            return success, message, queue_id

        host = (client.get('host') or '').strip()
        if not host:
            return False, 'Download client has no host', None
        if not (host.startswith('http://') or host.startswith('https://')):
            host = f'http://{host}'
        port = client.get('port', 8080)
        base_url = f'{host.rstrip("/")}:{port}'

        if client_type == 'sabnzbd':
            api_key = (client.get('api_key') or '').strip()
            url = f'{base_url}/api'
            params = {'mode': 'addurl', 'name': nzb_url, 'output': 'json'}
            if api_key:
                params['apikey'] = api_key
            if cat:
                params['cat'] = cat
            r = requests.get(url, params=params, timeout=15, verify=verify_ssl)
            r.raise_for_status()
            data = r.json()
            if data.get('status') is True or data.get('nzo_ids'):
                nzo_ids = data.get('nzo_ids') or []
                queue_id = nzo_ids[0] if nzo_ids else None
                return True, 'Added to SABnzbd', queue_id
            return False, data.get('error', 'SABnzbd returned an error'), None
        elif client_type == 'nzbget':
            jsonrpc_url = f'{base_url}/jsonrpc'
            username = (client.get('username') or '').strip()
            password = (client.get('password') or '').strip()
            auth = (username, password) if (username or password) else None
            payload = {
                'method': 'append',
                'params': ['', nzb_url, cat, 0, False, False, '', 0, 'SCORE', False, []],
                'id': 1
            }
            r = requests.post(jsonrpc_url, json=payload, auth=auth, timeout=15, verify=verify_ssl)
            r.raise_for_status()
            data = r.json()
            if data.get('result') and data.get('result') != 0:
                return True, 'Added to NZBGet', data.get('result')
            err = data.get('error', {})
            return False, err.get('message', 'NZBGet returned an error'), None
        return False, f'Unknown client type: {client_type}', None
    except requests.RequestException as e:
        return False, str(e) or 'Connection failed', None


# --- Collection helpers ---

def _get_collection_config(instance_id):
    """Get Movie Hunt collection (requested media) from database."""
    from src.primary.utils.database import get_database
    db = get_database()
    config = db.get_app_config_for_instance('movie_hunt_collection', instance_id)
    if not config or not isinstance(config.get('items'), list):
        return []
    return config['items']


def _save_collection_config(items_list, instance_id):
    """Save Movie Hunt collection to database."""
    from src.primary.utils.database import get_database
    db = get_database()
    db.save_app_config_for_instance('movie_hunt_collection', instance_id, {'items': items_list})


def _collection_append(title, year, instance_id, tmdb_id=None, poster_path=None, root_folder=None):
    """Append one entry to Media Collection after successful request."""
    items = _get_collection_config(instance_id)
    items.append({
        'title': title,
        'year': year or '',
        'tmdb_id': tmdb_id,
        'poster_path': poster_path or '',
        'root_folder': root_folder or '',
        'requested_at': datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ'),
        'status': 'requested'
    })
    _save_collection_config(items, instance_id)


def _get_tmdb_api_key_movie_hunt():
    """TMDB API key for Movie Hunt discover only."""
    return "9265b0bd0cd1962f7f3225989fcd7192"


def _movie_hunt_collection_lookups(instance_id):
    """Build sets for in_library and in_cooldown from Movie Hunt collection."""
    items = _get_collection_config(instance_id)
    available_tmdb_ids = set()
    available_title_year = set()
    cooldown_tmdb_ids = set()
    cooldown_title_year = set()
    now = datetime.utcnow()
    cooldown_cutoff = now - timedelta(hours=12)
    for it in items:
        if not isinstance(it, dict):
            continue
        status = (it.get('status') or '').strip().lower()
        title = (it.get('title') or '').strip()
        year = str(it.get('year') or '').strip()
        tmdb_id = it.get('tmdb_id')
        if tmdb_id is not None:
            try:
                tmdb_id = int(tmdb_id)
            except (TypeError, ValueError):
                tmdb_id = None
        key_title_year = (title.lower(), year) if title else None
        if status == 'available':
            if tmdb_id is not None:
                available_tmdb_ids.add(tmdb_id)
            if key_title_year:
                available_title_year.add(key_title_year)
        requested_at = it.get('requested_at') or ''
        try:
            if requested_at:
                dt = datetime.strptime(requested_at.replace('Z', '+00:00')[:19], '%Y-%m-%dT%H:%M:%S')
                if dt.tzinfo:
                    dt = dt.replace(tzinfo=None)
                if dt >= cooldown_cutoff:
                    if tmdb_id is not None:
                        cooldown_tmdb_ids.add(tmdb_id)
                    if key_title_year:
                        cooldown_title_year.add(key_title_year)
        except (ValueError, TypeError):
            pass
    return available_tmdb_ids, available_title_year, cooldown_tmdb_ids, cooldown_title_year


def _normalize_title_for_key(title):
    """Normalize title for matching."""
    if not title:
        return ''
    import re
    s = (title or '').strip().lower()
    s = re.sub(r'[^\w\s]', '', s)
    s = ' '.join(s.split())
    return s


def _dedupe_collection_items(combined):
    """Merge duplicates: one entry per (tmdb_id) or (normalized_title, year)."""
    by_key = {}
    for item in combined:
        title = (item.get('title') or '').strip()
        year = str(item.get('year') or '').strip()
        tmdb_id = item.get('tmdb_id')
        try:
            if tmdb_id is not None:
                tmdb_id = int(tmdb_id)
        except (TypeError, ValueError):
            tmdb_id = None
        key = (tmdb_id,) if tmdb_id is not None else (_normalize_title_for_key(title), year)
        if key not in by_key:
            by_key[key] = dict(item)
        else:
            existing = by_key[key]
            if (item.get('status') or '').lower() == 'available':
                existing['status'] = 'available'
            if (item.get('poster_path') or '').strip():
                existing['poster_path'] = item.get('poster_path') or existing.get('poster_path') or ''
            if item.get('tmdb_id') is not None:
                existing['tmdb_id'] = item.get('tmdb_id')
            if (item.get('title') or '').strip() and len((item.get('title') or '').strip()) > len((existing.get('title') or '').strip()):
                existing['title'] = item.get('title')
    return list(by_key.values())


def _sort_collection_items(items, sort_key):
    """Sort collection list by sort_key."""
    if not items or not sort_key:
        return items
    key = (sort_key or 'title.asc').strip().lower()
    reverse = key.endswith('.desc')
    if key.startswith('title.'):
        return sorted(items, key=lambda x: ((x.get('title') or '').lower(), str(x.get('year') or '')), reverse=reverse)
    if key.startswith('year.'):
        return sorted(items, key=lambda x: (str(x.get('year') or '0'), (x.get('title') or '').lower()), reverse=reverse)
    if key.startswith('status.'):
        return sorted(items, key=lambda x: ((x.get('status') or 'requested').lower(), (x.get('title') or '').lower()), reverse=reverse)
    return items


# --- Routes ---

@movie_hunt_bp.route('/api/movie-hunt/request', methods=['POST'])
def api_movie_hunt_request():
    """Request a movie via Movie Hunt: search configured indexers, send first NZB to first enabled download client."""
    try:
        data = request.get_json() or {}
        title = (data.get('title') or '').strip()
        if not title:
            return jsonify({'success': False, 'message': 'Title is required'}), 400
        year = data.get('year')
        if year is not None:
            year = str(year).strip()
        else:
            year = ''
        instance = (data.get('instance') or 'default').strip() or 'default'
        root_folder = (data.get('root_folder') or '').strip() or None
        quality_profile = (data.get('quality_profile') or '').strip() or None

        movie_hunt_logger.info("Request: received for '%s' (%s)", title, year or 'no year')

        instance_id = _get_movie_hunt_instance_id_from_request()
        indexers = _get_indexers_config(instance_id)
        clients = _get_clients_config(instance_id)
        enabled_indexers = [i for i in indexers if i.get('enabled', True) and (i.get('preset') or '').strip().lower() != 'manual']
        enabled_clients = [c for c in clients if c.get('enabled', True)]

        if not enabled_indexers:
            movie_hunt_logger.warning("Request: no indexers configured or enabled for '%s'", title)
            return jsonify({'success': False, 'message': 'No indexers configured or enabled. Add indexers in Movie Hunt Settings.'}), 400
        if not enabled_clients:
            movie_hunt_logger.warning("Request: no download clients configured or enabled for '%s'", title)
            return jsonify({'success': False, 'message': 'No download clients configured or enabled. Add a client in Movie Hunt Settings.'}), 400

        query = f'{title}'
        if year:
            query = f'{title} {year}'
        runtime_minutes = data.get('runtime')
        if runtime_minutes is not None:
            try:
                runtime_minutes = max(1, int(runtime_minutes))
            except (TypeError, ValueError):
                runtime_minutes = 90
        else:
            runtime_minutes = 90
        profile = _get_profile_by_name_or_default(quality_profile, instance_id)
        from src.primary.settings_manager import get_ssl_verify_setting
        verify_ssl = get_ssl_verify_setting()
        nzb_url = None
        nzb_title = None
        indexer_used = None
        request_score = 0
        request_score_breakdown = ''
        for idx in enabled_indexers:
            preset = (idx.get('preset') or '').strip().lower()
            base_url = INDEXER_PRESET_URLS.get(preset)
            if not base_url:
                continue
            api_key = (idx.get('api_key') or '').strip()
            if not api_key:
                continue
            categories = idx.get('categories') or [2000, 2010, 2020, 2030, 2040, 2045, 2050, 2070]
            results = _search_newznab_movie(base_url, api_key, query, categories, timeout=15)
            if results:
                blocklist_titles = _get_blocklist_source_titles(instance_id)
                if blocklist_titles:
                    results = [r for r in results if _blocklist_normalize_source_title(r.get('title')) not in blocklist_titles]
                    if not results:
                        continue
                chosen, chosen_score, chosen_breakdown = _best_result_matching_profile(
                    results, profile, instance_id, runtime_minutes=runtime_minutes
                )
                min_score = profile.get('min_custom_format_score', 0)
                try:
                    min_score = int(min_score)
                except (TypeError, ValueError):
                    min_score = 0
                if chosen and chosen_score >= min_score:
                    nzb_url = chosen.get('nzb_url')
                    nzb_title = chosen.get('title', 'Unknown')
                    indexer_used = idx.get('name') or preset
                    request_score = chosen_score
                    request_score_breakdown = chosen_breakdown or ''
                    movie_hunt_logger.info(
                        "Request: chosen release for '%s' (%s) — score %s (min %s). %s",
                        title, year or 'no year', request_score, min_score,
                        request_score_breakdown if request_score_breakdown else 'No breakdown'
                    )
                    break
        if not nzb_url:
            profile_name = (profile.get('name') or 'Standard').strip()
            min_score = profile.get('min_custom_format_score', 0)
            try:
                min_score = int(min_score)
            except (TypeError, ValueError):
                min_score = 0
            movie_hunt_logger.warning("Request: no release found for '%s' (%s) matching profile '%s' (min score %s)", title, year or 'no year', profile_name, min_score)
            return jsonify({
                'success': False,
                'message': f'No release found that matches your quality profile "{profile_name}" or meets the minimum custom format score ({min_score}). The indexer had results but none were in the allowed resolutions/sources or had a score at or above the minimum. Try a different profile, lower the minimum score, or search again later.'
            }), 404
        client = enabled_clients[0]
        raw_cat = (client.get('category') or '').strip()
        request_category = MOVIE_HUNT_DEFAULT_CATEGORY if raw_cat.lower() in ('default', '*', '') else (raw_cat or MOVIE_HUNT_DEFAULT_CATEGORY)
        ok, msg, queue_id = _add_nzb_to_download_client(client, nzb_url, nzb_title or f'{title}.nzb', request_category, verify_ssl, indexer=indexer_used or '')
        if not ok:
            movie_hunt_logger.error("Request: send to download client failed for '%s': %s", title, msg)
            return jsonify({'success': False, 'message': f'Sent to download client but failed: {msg}'}), 500
        movie_hunt_logger.info(
            "Request: '%s' (%s) sent to %s. Indexer: %s. Score: %s — %s",
            title, year or 'no year', client.get('name') or 'download client',
            indexer_used or '-', request_score,
            request_score_breakdown if request_score_breakdown else 'no breakdown'
        )
        if queue_id:
            client_name = (client.get('name') or 'Download client').strip() or 'Download client'
            _add_requested_queue_id(client_name, queue_id, instance_id, title=title, year=year or '', score=request_score, score_breakdown=request_score_breakdown)
        tmdb_id = data.get('tmdb_id')
        poster_path = (data.get('poster_path') or '').strip() or None
        root_folder = (data.get('root_folder') or '').strip() or None
        _collection_append(title=title, year=year, instance_id=instance_id, tmdb_id=tmdb_id, poster_path=poster_path, root_folder=root_folder)
        return jsonify({
            'success': True,
            'message': f'"{title}" sent to {client.get("name") or "download client"}.',
            'indexer': indexer_used,
            'client': client.get('name') or 'download client'
        }), 200
    except Exception as e:
        try:
            req_title = (request.get_json() or {}).get('title') or 'unknown'
        except Exception:
            req_title = 'unknown'
        movie_hunt_logger.exception("Request: error for '%s': %s", req_title, e)
        return jsonify({'success': False, 'message': str(e)}), 500


@movie_hunt_bp.route('/api/movie-hunt/tmdb-key', methods=['GET'])
def api_movie_hunt_tmdb_key():
    """Return TMDB API key for Movie Hunt detail page."""
    key = _get_tmdb_api_key_movie_hunt()
    return jsonify({'api_key': key or ''})


@movie_hunt_bp.route('/api/movie-hunt/discover/movies', methods=['GET'])
def api_movie_hunt_discover_movies():
    """Movie Hunt–only discover: TMDB discover/movie with in_library and in_cooldown from Movie Hunt collection."""
    try:
        instance_id = _get_movie_hunt_instance_id_from_request()
        page = max(1, request.args.get('page', 1, type=int))
        sort_by = (request.args.get('sort_by') or 'popularity.desc').strip()
        hide_available = request.args.get('hide_available', 'false').lower() == 'true'
        api_key = _get_tmdb_api_key_movie_hunt()
        url = 'https://api.themoviedb.org/3/discover/movie'
        params = {'api_key': api_key, 'page': page, 'sort_by': sort_by}
        if request.args.get('with_genres'):
            params['with_genres'] = request.args.get('with_genres')
        if request.args.get('release_date.gte'):
            params['release_date.gte'] = request.args.get('release_date.gte')
        if request.args.get('release_date.lte'):
            params['release_date.lte'] = request.args.get('release_date.lte')
        if request.args.get('with_runtime.gte'):
            params['with_runtime.gte'] = request.args.get('with_runtime.gte')
        if request.args.get('with_runtime.lte'):
            params['with_runtime.lte'] = request.args.get('with_runtime.lte')
        if request.args.get('vote_average.gte'):
            params['vote_average.gte'] = request.args.get('vote_average.gte')
        if request.args.get('vote_average.lte'):
            params['vote_average.lte'] = request.args.get('vote_average.lte')
        if request.args.get('vote_count.gte'):
            params['vote_count.gte'] = request.args.get('vote_count.gte')
        if request.args.get('vote_count.lte'):
            params['vote_count.lte'] = request.args.get('vote_count.lte')
        r = requests.get(url, params=params, timeout=10)
        r.raise_for_status()
        rdata = r.json()
        available_tmdb_ids, available_title_year, cooldown_tmdb_ids, cooldown_title_year = _movie_hunt_collection_lookups(instance_id)
        results = []
        for item in rdata.get('results', []):
            release_date = item.get('release_date') or ''
            year = None
            if release_date:
                try:
                    year = int(release_date.split('-')[0])
                except (ValueError, IndexError):
                    pass
            title = (item.get('title') or '').strip()
            year_str = str(year) if year is not None else ''
            poster_path = item.get('poster_path')
            poster_url = f"https://image.tmdb.org/t/p/w500{poster_path}" if poster_path else None
            backdrop_path = item.get('backdrop_path')
            backdrop_url = f"https://image.tmdb.org/t/p/w500{backdrop_path}" if backdrop_path else None
            tmdb_id = item.get('id')
            in_library = (tmdb_id is not None and tmdb_id in available_tmdb_ids) or (
                (title.lower(), year_str) in available_title_year
            )
            in_cooldown = (tmdb_id is not None and tmdb_id in cooldown_tmdb_ids) or (
                (title.lower(), year_str) in cooldown_title_year
            )
            results.append({
                'tmdb_id': tmdb_id,
                'id': tmdb_id,
                'media_type': 'movie',
                'title': title,
                'year': year,
                'overview': item.get('overview', ''),
                'poster_path': poster_url,
                'backdrop_path': backdrop_url,
                'vote_average': item.get('vote_average', 0),
                'popularity': item.get('popularity', 0),
                'in_library': in_library,
                'in_cooldown': in_cooldown,
                'partial': False,
            })
        if hide_available:
            results = [r for r in results if not r.get('in_library')]
        has_more = (rdata.get('total_pages') or 0) >= page + 1
        return jsonify({
            'results': results,
            'page': page,
            'has_more': has_more,
        }), 200
    except requests.RequestException as e:
        movie_hunt_logger.warning("Discover: TMDB request failed: %s", e)
        return jsonify({'results': [], 'page': 1, 'has_more': False, 'error': str(e)}), 200
    except Exception as e:
        movie_hunt_logger.exception("Discover: error %s", e)
        return jsonify({'results': [], 'page': 1, 'has_more': False, 'error': str(e)}), 200


@movie_hunt_bp.route('/api/movie-hunt/collection', methods=['GET'])
def api_movie_hunt_collection_list():
    """List Media Collection based on root folder detection."""
    try:
        instance_id = _get_movie_hunt_instance_id_from_request()
        from .storage import _get_detected_movies_from_all_roots
        detected_list = _get_detected_movies_from_all_roots(instance_id)
        combined = []
        for d in detected_list:
            combined.append({
                'title': d.get('title') or '',
                'year': d.get('year') or '',
                'status': 'available',
                'poster_path': '',
                'tmdb_id': None,
                'root_folder': '',
                'requested_at': '',
            })
        requested_list = _get_collection_config(instance_id)
        combined_key_set = {(_normalize_title_for_key(item.get('title')), str(item.get('year') or '').strip()) for item in combined}
        combined_tmdb_set = {item.get('tmdb_id') for item in combined if item.get('tmdb_id') is not None}
        for req in requested_list:
            if not isinstance(req, dict):
                continue
            title = (req.get('title') or '').strip()
            year = str(req.get('year') or '').strip()
            norm_key = (_normalize_title_for_key(title), year)
            req_tmdb = req.get('tmdb_id')
            try:
                if req_tmdb is not None:
                    req_tmdb = int(req_tmdb)
            except (TypeError, ValueError):
                req_tmdb = None
            matched = False
            if norm_key in combined_key_set:
                for c in combined:
                    if (_normalize_title_for_key(c.get('title')), str(c.get('year') or '').strip()) == norm_key:
                        c['poster_path'] = req.get('poster_path') or c.get('poster_path') or ''
                        c['tmdb_id'] = req_tmdb if req_tmdb is not None else c.get('tmdb_id')
                        matched = True
                        break
            if not matched and req_tmdb is not None and req_tmdb in combined_tmdb_set:
                for c in combined:
                    if c.get('tmdb_id') == req_tmdb:
                        c['poster_path'] = req.get('poster_path') or c.get('poster_path') or ''
                        matched = True
                        break
            if not matched:
                combined.append({
                    'title': title,
                    'year': year,
                    'status': 'requested',
                    'poster_path': req.get('poster_path') or '',
                    'tmdb_id': req.get('tmdb_id'),
                    'root_folder': req.get('root_folder') or '',
                    'requested_at': req.get('requested_at') or '',
                })
        combined = _dedupe_collection_items(combined)
        items_full = _get_collection_config(instance_id)
        collection_updated = False
        detected_key_set = {(_normalize_title_for_key(d.get('title')), str(d.get('year') or '').strip()) for d in detected_list}
        for i, full_item in enumerate(items_full):
            if not isinstance(full_item, dict):
                continue
            t = (full_item.get('title') or '').strip()
            y = str(full_item.get('year') or '').strip()
            norm_key = (_normalize_title_for_key(t), y)
            if norm_key in detected_key_set and (full_item.get('status') or '').lower() != 'available':
                items_full[i]['status'] = 'available'
                collection_updated = True
        if collection_updated:
            _save_collection_config(items_full, instance_id)
        q = (request.args.get('q') or '').strip().lower()
        items = [x for x in combined if not q or q in ((x.get('title') or '') + ' ' + str(x.get('year') or '')).lower()]
        sort_key = (request.args.get('sort') or 'title.asc').strip()
        items = _sort_collection_items(items, sort_key)
        total = len(items)
        page = max(1, int(request.args.get('page', 1)))
        page_size = max(1, min(100, int(request.args.get('page_size', 20))))
        start = (page - 1) * page_size
        page_items = items[start:start + page_size]
        return jsonify({
            'items': page_items,
            'total': total,
            'page': page,
            'page_size': page_size
        }), 200
    except Exception as e:
        logger.exception('Movie Hunt collection list error')
        return jsonify({'items': [], 'total': 0, 'page': 1, 'page_size': 20, 'error': str(e)}), 200


@movie_hunt_bp.route('/api/movie-hunt/collection/<int:index>', methods=['PATCH'])
def api_movie_hunt_collection_patch(index):
    """Update collection item status."""
    try:
        instance_id = _get_movie_hunt_instance_id_from_request()
        data = request.get_json() or {}
        status = (data.get('status') or '').strip() or None
        if not status:
            return jsonify({'success': False, 'message': 'status is required'}), 400
        items = _get_collection_config(instance_id)
        if index < 0 or index >= len(items):
            return jsonify({'success': False, 'message': 'Not found'}), 404
        items[index]['status'] = status
        _save_collection_config(items, instance_id)
        return jsonify({'success': True, 'item': items[index]}), 200
    except Exception as e:
        logger.exception('Movie Hunt collection patch error')
        return jsonify({'success': False, 'message': str(e)}), 500


@movie_hunt_bp.route('/api/movie-hunt/collection/<int:index>', methods=['DELETE'])
def api_movie_hunt_collection_delete(index):
    """Remove item from requested list by index or by title+year in JSON body."""
    try:
        body = request.get_json(silent=True) or {}
        title = (body.get('title') or '').strip()
        year = str(body.get('year') or '').strip()
        instance_id = _get_movie_hunt_instance_id_from_request()
        if title:
            items = _get_collection_config(instance_id)
            for i, it in enumerate(items):
                if not isinstance(it, dict):
                    continue
                if (it.get('title') or '').strip() == title and str(it.get('year') or '') == year:
                    items.pop(i)
                    _save_collection_config(items, instance_id)
                    return jsonify({'success': True}), 200
            return jsonify({'success': False, 'message': 'Not found in requested list'}), 404
        items = _get_collection_config(instance_id)
        if index < 0 or index >= len(items):
            return jsonify({'success': False, 'message': 'Not found'}), 404
        items.pop(index)
        _save_collection_config(items, instance_id)
        return jsonify({'success': True}), 200
    except Exception as e:
        logger.exception('Movie Hunt collection delete error')
        return jsonify({'success': False, 'message': str(e)}), 500
