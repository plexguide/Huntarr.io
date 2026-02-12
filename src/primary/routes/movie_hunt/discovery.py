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
from .indexers import _get_indexers_config, _resolve_indexer_api_url
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


def _collection_append(title, year, instance_id, tmdb_id=None, poster_path=None, root_folder=None,
                      quality_profile=None, minimum_availability=None):
    """Append one entry to Media Collection (add to library).
    Fetches TMDB release dates for the movie to support minimum availability enforcement.
    Does not add duplicates if the movie is already in the collection.
    """
    items = _get_collection_config(instance_id)

    # Check for duplicates using tmdb_id and/or title + year
    is_duplicate = False
    norm_title = _normalize_title_for_key(title)
    year_str = str(year or '').strip()
    
    for item in items:
        if not isinstance(item, dict):
            continue
        
        # Match by TMDB ID
        if tmdb_id and item.get('tmdb_id') == tmdb_id:
            is_duplicate = True
            break
            
        # Match by Title + Year
        item_title = _normalize_title_for_key(item.get('title'))
        item_year = str(item.get('year') or '').strip()
        if item_title == norm_title and item_year == year_str:
            is_duplicate = True
            break

    if is_duplicate:
        movie_hunt_logger.info("Collection: skipping duplicate add for '%s' (%s)", title, year or 'no year')
        return

    # Fetch release dates from TMDB for availability tracking
    release_dates = _fetch_tmdb_release_dates(tmdb_id)

    items.append({
        'title': title,
        'year': year or '',
        'tmdb_id': tmdb_id,
        'poster_path': poster_path or '',
        'root_folder': root_folder or '',
        'quality_profile': quality_profile or '',
        'minimum_availability': (minimum_availability or '').strip() or 'released',
        'in_cinemas': release_dates.get('in_cinemas', ''),
        'digital_release': release_dates.get('digital_release', ''),
        'physical_release': release_dates.get('physical_release', ''),
        'requested_at': datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ'),
        'status': 'requested'
    })
    _save_collection_config(items, instance_id)


def _get_tmdb_api_key_movie_hunt():
    """TMDB API key for Movie Hunt discover only."""
    return "9265b0bd0cd1962f7f3225989fcd7192"


def _fetch_tmdb_release_dates(tmdb_id):
    """Fetch detailed release dates from TMDB for a movie.
    Returns dict with 'in_cinemas', 'digital_release', 'physical_release' date strings (YYYY-MM-DD or '').
    Uses US region by default; falls back to earliest global dates.
    TMDB release_date types: 1=Premiere, 2=Theatrical(limited), 3=Theatrical, 4=Digital, 5=Physical, 6=TV
    """
    if not tmdb_id:
        return {'in_cinemas': '', 'digital_release': '', 'physical_release': ''}
    api_key = _get_tmdb_api_key_movie_hunt()
    try:
        resp = requests.get(
            f'https://api.themoviedb.org/3/movie/{tmdb_id}/release_dates',
            params={'api_key': api_key},
            timeout=10
        )
        if resp.status_code != 200:
            movie_hunt_logger.debug("TMDB release_dates for %s: HTTP %s", tmdb_id, resp.status_code)
            return {'in_cinemas': '', 'digital_release': '', 'physical_release': ''}
        data = resp.json()
        results = data.get('results', [])

        # Collect all dates by type across all countries
        all_theatrical = []  # types 2, 3
        all_digital = []     # type 4
        all_physical = []    # type 5

        # Prefer US dates, then fall back to earliest global date
        us_theatrical = ''
        us_digital = ''
        us_physical = ''

        for country_entry in results:
            iso = country_entry.get('iso_3166_1', '')
            for rd in country_entry.get('release_dates', []):
                rtype = rd.get('type', 0)
                date_str = (rd.get('release_date') or '')[:10]  # YYYY-MM-DD
                if not date_str:
                    continue
                if rtype in (2, 3):
                    all_theatrical.append(date_str)
                    if iso == 'US' and (not us_theatrical or date_str < us_theatrical):
                        us_theatrical = date_str
                elif rtype == 4:
                    all_digital.append(date_str)
                    if iso == 'US' and (not us_digital or date_str < us_digital):
                        us_digital = date_str
                elif rtype == 5:
                    all_physical.append(date_str)
                    if iso == 'US' and (not us_physical or date_str < us_physical):
                        us_physical = date_str

        in_cinemas = us_theatrical or (min(all_theatrical) if all_theatrical else '')
        digital_release = us_digital or (min(all_digital) if all_digital else '')
        physical_release = us_physical or (min(all_physical) if all_physical else '')

        return {
            'in_cinemas': in_cinemas,
            'digital_release': digital_release,
            'physical_release': physical_release,
        }
    except Exception as e:
        movie_hunt_logger.debug("TMDB release_dates fetch error for %s: %s", tmdb_id, e)
        return {'in_cinemas': '', 'digital_release': '', 'physical_release': ''}


def check_minimum_availability(item):
    """Check if a collection item meets its minimum availability threshold.
    Returns True if the movie is available for download according to its setting.
    - 'announced': always available
    - 'inCinemas': available if in_cinemas date has passed (or release_date fallback)
    - 'released': available if digital_release or physical_release date has passed

    When no release date data is stored, uses a year-based fallback:
    - If movie year is 2+ years before current year, assume released (clearly old movie)
    - If movie year is 1 year before current year, assume at least in cinemas
    - If no year or current/future year and no dates, try TMDB fetch as last resort
    """
    min_avail = (item.get('minimum_availability') or 'released').strip()
    if min_avail == 'announced':
        return True

    today = datetime.utcnow().strftime('%Y-%m-%d')
    current_year = datetime.utcnow().year

    # Gather stored dates
    in_cinemas = (item.get('in_cinemas') or '').strip()
    digital = (item.get('digital_release') or '').strip()
    physical = (item.get('physical_release') or '').strip()
    has_any_dates = bool(in_cinemas or digital or physical)

    # --- Year-based fallback when NO dates are stored ---
    if not has_any_dates:
        movie_year = None
        try:
            movie_year = int(str(item.get('year', '')).strip())
        except (ValueError, TypeError):
            pass

        if movie_year is not None:
            year_diff = current_year - movie_year
            if min_avail == 'released' and year_diff >= 2:
                # Movie is 2+ years old — definitely released digitally/physically
                return True
            if min_avail == 'inCinemas' and year_diff >= 1:
                # Movie is 1+ years old — definitely been in cinemas
                return True

        # No dates AND no helpful year — try to fetch from TMDB and cache for future
        tmdb_id = item.get('tmdb_id')
        if tmdb_id:
            try:
                dates = _fetch_tmdb_release_dates(tmdb_id)
                in_cinemas = dates.get('in_cinemas', '')
                digital = dates.get('digital_release', '')
                physical = dates.get('physical_release', '')
                # Store fetched dates back on the item dict (caller can persist)
                item['in_cinemas'] = in_cinemas
                item['digital_release'] = digital
                item['physical_release'] = physical
                has_any_dates = bool(in_cinemas or digital or physical)
            except Exception:
                pass

        # Still no dates at all — default to available rather than blocking forever
        if not has_any_dates:
            return True

    # --- Date-based checks ---
    if min_avail == 'inCinemas':
        if in_cinemas and in_cinemas <= today:
            return True
        # Fallback: if no in_cinemas date, check if digital/physical is set (movie was at least in cinemas)
        if digital and digital <= today:
            return True
        if physical and physical <= today:
            return True
        return False

    if min_avail == 'released':
        if digital and digital <= today:
            return True
        if physical and physical <= today:
            return True
        # If no digital/physical dates but in_cinemas was months ago, estimate digital release
        if in_cinemas:
            try:
                cinema_date = datetime.strptime(in_cinemas, '%Y-%m-%d')
                # Typical theatrical window is ~90 days before digital
                estimated_digital = cinema_date + timedelta(days=90)
                if datetime.utcnow() >= estimated_digital:
                    return True
            except (ValueError, TypeError):
                pass
        return False

    # Unknown value - default to available
    return True


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


# --- Programmatic request (used by API and by background missing cycle) ---

def perform_movie_hunt_request(instance_id, title, year='', root_folder=None, quality_profile=None,
                               tmdb_id=None, poster_path=None, runtime_minutes=90, minimum_availability=None):
    """
    Search indexers for a movie and send first matching NZB to first enabled download client.
    Used by the API route and by the background missing cycle.
    Returns (success: bool, message: str).
    """
    title = (title or '').strip()
    if not title:
        return False, 'Title is required'
    year = str(year).strip() if year is not None else ''
    quality_profile = (quality_profile or '').strip() or None
    indexers = _get_indexers_config(instance_id)
    clients = _get_clients_config(instance_id)
    enabled_indexers = [i for i in indexers if i.get('enabled', True)]
    enabled_clients = [c for c in clients if c.get('enabled', True)]
    if not enabled_indexers:
        movie_hunt_logger.warning("Request: no indexers configured or enabled for '%s'", title)
        return False, 'No indexers configured or enabled. Add indexers in Movie Hunt Settings.'
    if not enabled_clients:
        movie_hunt_logger.warning("Request: no download clients configured or enabled for '%s'", title)
        return False, 'No download clients configured or enabled. Add a client in Movie Hunt Settings.'
    query = f'{title}'
    if year:
        query = f'{title} {year}'
    profile = _get_profile_by_name_or_default(quality_profile, instance_id)
    from src.primary.settings_manager import get_ssl_verify_setting
    verify_ssl = get_ssl_verify_setting()
    import time as _time
    nzb_url = None
    nzb_title = None
    indexer_used = None
    request_score = 0
    request_score_breakdown = ''
    # Search ALL indexers, collect results with priority (Prowlarr-like strategy)
    all_candidates = []  # [(priority, idx_name, chosen, score, breakdown, ih_id, idx_ref)]
    blocklist_titles = _get_blocklist_source_titles(instance_id)
    min_score = profile.get('min_custom_format_score', 0)
    try:
        min_score = int(min_score)
    except (TypeError, ValueError):
        min_score = 0
    for idx in enabled_indexers:
        base_url = _resolve_indexer_api_url(idx)
        if not base_url:
            continue
        api_key = (idx.get('api_key') or '').strip()
        if not api_key:
            continue
        categories = idx.get('categories') or [2000, 2010, 2020, 2030, 2040, 2045, 2050, 2070]
        priority = idx.get('priority', 50)
        ih_id = idx.get('indexer_hunt_id', '')
        _search_start = _time.time()
        results = _search_newznab_movie(base_url, api_key, query, categories, timeout=15)
        _search_ms = int((_time.time() - _search_start) * 1000)
        # Record search event for Indexer Hunt stats (if linked)
        if ih_id:
            try:
                from src.primary.utils.database import get_database as _get_db
                _get_db().record_indexer_hunt_event(
                    indexer_id=ih_id, indexer_name=idx.get('name', ''),
                    event_type='search', query=query,
                    response_time_ms=_search_ms,
                    success=bool(results),
                    instance_id=instance_id, instance_name='',
                )
            except Exception:
                pass
        if results:
            if blocklist_titles:
                results = [r for r in results if _blocklist_normalize_source_title(r.get('title')) not in blocklist_titles]
                if not results:
                    continue
            chosen, chosen_score, chosen_breakdown = _best_result_matching_profile(
                results, profile, instance_id, runtime_minutes=runtime_minutes
            )
            if chosen and chosen_score >= min_score:
                all_candidates.append((priority, idx.get('name', ''), chosen, chosen_score, chosen_breakdown or '', ih_id, idx))
    # Pick best: lowest priority number first (highest priority), then highest score
    if all_candidates:
        all_candidates.sort(key=lambda x: (x[0], -x[3]))
        _, indexer_used, chosen, request_score, request_score_breakdown, _grab_ih_id, _ = all_candidates[0]
        nzb_url = chosen.get('nzb_url')
        nzb_title = chosen.get('title', 'Unknown')
        movie_hunt_logger.info(
            "Request: chosen release for '%s' (%s) — score %s (min %s). %s",
            title, year or 'no year', request_score, min_score,
            request_score_breakdown if request_score_breakdown else 'No breakdown'
        )
        # Record grab event
        if _grab_ih_id:
            try:
                from src.primary.utils.database import get_database as _get_db
                _get_db().record_indexer_hunt_event(
                    indexer_id=_grab_ih_id, indexer_name=indexer_used,
                    event_type='grab', query=query,
                    result_title=nzb_title,
                    instance_id=instance_id, instance_name='',
                )
            except Exception:
                pass
    if not nzb_url:
        profile_name = (profile.get('name') or 'Standard').strip()
        min_score = profile.get('min_custom_format_score', 0)
        try:
            min_score = int(min_score)
        except (TypeError, ValueError):
            min_score = 0
        movie_hunt_logger.warning("Request: no release found for '%s' (%s) matching profile '%s' (min score %s)", title, year or 'no year', profile_name, min_score)
        return False, f'No release found matching profile "{profile_name}" (min score {min_score}).'
    client = enabled_clients[0]
    raw_cat = (client.get('category') or '').strip()
    request_category = MOVIE_HUNT_DEFAULT_CATEGORY if raw_cat.lower() in ('default', '*', '') else (raw_cat or MOVIE_HUNT_DEFAULT_CATEGORY)
    ok, msg, queue_id = _add_nzb_to_download_client(client, nzb_url, nzb_title or f'{title}.nzb', request_category, verify_ssl, indexer=indexer_used or '')
    if not ok:
        movie_hunt_logger.error("Request: send to download client failed for '%s': %s", title, msg)
        return False, f'Sent to download client but failed: {msg}'
    movie_hunt_logger.info(
        "Request: '%s' (%s) sent to %s. Indexer: %s. Score: %s — %s",
        title, year or 'no year', client.get('name') or 'download client',
        indexer_used or '-', request_score,
        request_score_breakdown if request_score_breakdown else 'no breakdown'
    )
    if queue_id:
        client_name = (client.get('name') or 'Download client').strip() or 'Download client'
        _add_requested_queue_id(client_name, queue_id, instance_id, title=title, year=year or '', score=request_score, score_breakdown=request_score_breakdown)
    _collection_append(
        title=title, year=year, instance_id=instance_id, tmdb_id=tmdb_id, poster_path=poster_path,
        root_folder=root_folder, quality_profile=quality_profile, minimum_availability=minimum_availability
    )
    return True, f'"{title}" sent to {client.get("name") or "download client"}.'


@movie_hunt_bp.route('/api/movie-hunt/request', methods=['POST'])
def api_movie_hunt_request():
    """Add movie to library and optionally start search (indexers -> download client)."""
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
        start_search = data.get('start_search', True)
        if isinstance(start_search, str):
            start_search = start_search.strip().lower() not in ('false', '0', 'no', '')
        elif start_search is None:
            start_search = True
        minimum_availability = (data.get('minimum_availability') or '').strip() or 'released'
        movie_hunt_logger.info("Request: received for '%s' (%s), start_search=%s", title, year or 'no year', start_search)
        instance_id = _get_movie_hunt_instance_id_from_request()
        root_folder = (data.get('root_folder') or '').strip() or None
        quality_profile = (data.get('quality_profile') or '').strip() or None
        tmdb_id = data.get('tmdb_id')
        poster_path = (data.get('poster_path') or '').strip() or None
        runtime_minutes = data.get('runtime')
        if runtime_minutes is not None:
            try:
                runtime_minutes = max(1, int(runtime_minutes))
            except (TypeError, ValueError):
                runtime_minutes = 90
        else:
            runtime_minutes = 90

        if not start_search:
            _collection_append(
                title=title, year=year, instance_id=instance_id, tmdb_id=tmdb_id, poster_path=poster_path,
                root_folder=root_folder, quality_profile=quality_profile, minimum_availability=minimum_availability
            )
            return jsonify({'success': True, 'message': 'Successfully added to library.'}), 200

        success, message = perform_movie_hunt_request(
            instance_id, title, year, root_folder=root_folder, quality_profile=quality_profile,
            tmdb_id=tmdb_id, poster_path=poster_path, runtime_minutes=runtime_minutes,
            minimum_availability=minimum_availability
        )
        if success:
            return jsonify({'success': True, 'message': message}), 200
        if 'No indexers' in message or 'No download clients' in message:
            return jsonify({'success': False, 'message': message}), 400
        if 'No release found' in message:
            return jsonify({'success': False, 'message': message}), 404
        return jsonify({'success': False, 'message': message}), 500
    except Exception as e:
        try:
            req_title = (request.get_json() or {}).get('title') or 'unknown'
        except Exception:
            req_title = 'unknown'
        movie_hunt_logger.exception("Request: error for '%s': %s", req_title, e)
        return jsonify({'success': False, 'message': str(e)}), 500


@movie_hunt_bp.route('/api/movie-hunt/force-upgrade', methods=['POST'])
def api_movie_hunt_force_upgrade():
    """Search indexers for a higher-scoring release than the current file.
    Only grabs if the best available release scores higher than the current file.
    """
    try:
        data = request.get_json() or {}
        title = (data.get('title') or '').strip()
        if not title:
            return jsonify({'success': False, 'message': 'Title is required'}), 400
        year = str(data.get('year') or '').strip()
        tmdb_id = data.get('tmdb_id')
        current_score = data.get('current_score')
        if current_score is None:
            current_score = 0
        try:
            current_score = int(current_score)
        except (TypeError, ValueError):
            current_score = 0

        instance_id = _get_movie_hunt_instance_id_from_request()
        quality_profile = (data.get('quality_profile') or '').strip() or None
        runtime_minutes = data.get('runtime')
        if runtime_minutes is not None:
            try:
                runtime_minutes = max(1, int(runtime_minutes))
            except (TypeError, ValueError):
                runtime_minutes = 90
        else:
            runtime_minutes = 90

        movie_hunt_logger.info(
            "Upgrade: searching for '%s' (%s), current score=%s",
            title, year or 'no year', current_score
        )

        # Search indexers for candidates
        from .profiles import _get_profile_by_name_or_default, _best_result_matching_profile
        from .indexers import _get_indexers_config, _resolve_indexer_api_url
        from .clients import _get_clients_config

        indexers = _get_indexers_config(instance_id)
        clients = _get_clients_config(instance_id)
        enabled_indexers = [i for i in indexers if i.get('enabled', True)]
        enabled_clients = [c for c in clients if c.get('enabled', True)]

        if not enabled_indexers:
            return jsonify({'success': False, 'message': 'No indexers configured or enabled.'}), 400
        if not enabled_clients:
            return jsonify({'success': False, 'message': 'No download clients configured or enabled.'}), 400

        query = f'{title} {year}'.strip() if year else title
        profile = _get_profile_by_name_or_default(quality_profile, instance_id)

        from src.primary.settings_manager import get_ssl_verify_setting
        verify_ssl = get_ssl_verify_setting()

        best_result = None
        best_score = current_score
        best_breakdown = ''
        best_indexer = None

        blocklist_titles = _get_blocklist_source_titles(instance_id)

        for idx in enabled_indexers:
            base_url = _resolve_indexer_api_url(idx)
            if not base_url:
                continue
            api_key = (idx.get('api_key') or '').strip()
            if not api_key:
                continue
            categories = idx.get('categories') or [2000, 2010, 2020, 2030, 2040, 2045, 2050, 2070]
            results = _search_newznab_movie(base_url, api_key, query, categories, timeout=15)
            if not results:
                continue
            if blocklist_titles:
                results = [r for r in results if _blocklist_normalize_source_title(r.get('title')) not in blocklist_titles]
            if not results:
                continue
            chosen, chosen_score, chosen_breakdown = _best_result_matching_profile(
                results, profile, instance_id, runtime_minutes=runtime_minutes
            )
            if chosen and chosen_score > best_score:
                best_result = chosen
                best_score = chosen_score
                best_breakdown = chosen_breakdown
                best_indexer = idx.get('name') or idx.get('preset', 'Unknown')

        if not best_result:
            movie_hunt_logger.info(
                "Upgrade: no higher-scoring release found for '%s' (current=%s)", title, current_score
            )
            return jsonify({
                'success': False,
                'message': f'No release found with a score higher than {current_score}.'
            }), 200

        # Send to download client
        nzb_url = best_result.get('nzb_url')
        nzb_title = best_result.get('title', 'Unknown')
        client = enabled_clients[0]
        raw_cat = (client.get('category') or '').strip()
        category = MOVIE_HUNT_DEFAULT_CATEGORY if raw_cat.lower() in ('default', '*', '') else (raw_cat or MOVIE_HUNT_DEFAULT_CATEGORY)

        ok, msg, queue_id = _add_nzb_to_download_client(
            client, nzb_url, nzb_title or f'{title}.nzb', category, verify_ssl,
            indexer=best_indexer or ''
        )
        if not ok:
            return jsonify({'success': False, 'message': f'Download client error: {msg}'}), 500

        movie_hunt_logger.info(
            "Upgrade: '%s' (%s) upgrading from score %s → %s. Release: %s. Indexer: %s",
            title, year or 'no year', current_score, best_score, nzb_title, best_indexer or '-'
        )

        if queue_id:
            client_name = (client.get('name') or 'Download client').strip() or 'Download client'
            _add_requested_queue_id(
                client_name, queue_id, instance_id,
                title=title, year=year or '', score=best_score, score_breakdown=best_breakdown
            )

        return jsonify({
            'success': True,
            'message': f'Upgrade found! Score {current_score} → {best_score}. Sent to download client.',
            'new_score': best_score,
            'new_breakdown': best_breakdown,
        }), 200

    except Exception as e:
        movie_hunt_logger.exception("Upgrade: error: %s", e)
        return jsonify({'success': False, 'message': str(e)}), 500


@movie_hunt_bp.route('/api/movie-hunt/tmdb-key', methods=['GET'])
def api_movie_hunt_tmdb_key():
    """Return TMDB API key for Movie Hunt detail page."""
    key = _get_tmdb_api_key_movie_hunt()
    return jsonify({'api_key': key or ''})


@movie_hunt_bp.route('/api/movie-hunt/movie-status', methods=['GET'])
def api_movie_hunt_movie_status():
    """Return movie status from Movie Hunt's own collection, profiles, and root folders."""
    import os
    from src.primary.utils.database import get_database

    tmdb_id = request.args.get('tmdb_id', type=int)
    instance_id = _get_movie_hunt_instance_id_from_request()
    skip_probe = request.args.get('skip_probe', 'false').lower() == 'true'
    force_probe = request.args.get('force_probe', 'false').lower() == 'true'

    if not tmdb_id:
        return jsonify({'success': False, 'error': 'tmdb_id required'}), 400

    try:
        # Search Movie Hunt's own collection for this movie
        items = _get_collection_config(instance_id)
        movie = None
        for item in items:
            if item.get('tmdb_id') == tmdb_id:
                movie = item
                break

        # Also check detected movies from root folders
        from .storage import _get_detected_movies_from_all_roots
        detected = _get_detected_movies_from_all_roots(instance_id)

        if not movie:
            # Check if movie is detected on disk but not in requested collection
            for d in detected:
                if d.get('tmdb_id') == tmdb_id:
                    movie = d
                    break
            # Try matching by title+year
            if not movie:
                for d in detected:
                    title_norm = _normalize_title_for_key(d.get('title'))
                    # We can't match without tmdb_id from detected, skip title match for now
                    pass

        if not movie:
            return jsonify({'success': True, 'found': False})

        # Determine status
        status_raw = (movie.get('status') or '').lower()
        file_path = (movie.get('file_path') or '').strip()
        root_folder = (movie.get('root_folder') or '').strip()

        # Check if the movie file actually exists on disk
        has_file = False
        file_size = 0

        if file_path and os.path.isfile(file_path):
            has_file = True
            try:
                file_size = os.path.getsize(file_path)
            except OSError:
                file_size = 0
        elif root_folder:
            # Check if movie folder exists in the root folder
            title = (movie.get('title') or '').strip()
            year = str(movie.get('year') or '').strip()
            if title:
                folder_name = '%s (%s)' % (title, year) if year else title
                movie_folder = os.path.join(root_folder, folder_name)
                if os.path.isdir(movie_folder):
                    # Find largest video file
                    video_exts = {'.mkv', '.mp4', '.avi', '.mov', '.wmv', '.m4v', '.ts', '.flv'}
                    for f in os.listdir(movie_folder):
                        ext = os.path.splitext(f)[1].lower()
                        if ext in video_exts:
                            fpath = os.path.join(movie_folder, f)
                            try:
                                fsize = os.path.getsize(fpath)
                                if fsize > file_size:
                                    file_size = fsize
                                    file_path = fpath
                                    has_file = True
                            except OSError:
                                pass

        # Also check detected list for status
        if not has_file and status_raw != 'available':
            detected_keys = {(_normalize_title_for_key(d.get('title')), str(d.get('year') or '').strip()) for d in detected}
            movie_key = (_normalize_title_for_key(movie.get('title')), str(movie.get('year') or '').strip())
            if movie_key in detected_keys:
                has_file = True
                status_raw = 'available'

        # Final status
        if has_file or status_raw == 'available':
            status = 'downloaded'
        elif status_raw == 'requested':
            status = 'missing'
        else:
            status = 'requested'

        # Get quality profile info — check per-movie first, then default
        from .profiles import _get_profiles_config
        profiles = _get_profiles_config(instance_id)
        quality_profile_name = (movie.get('quality_profile') or '').strip()
        if not quality_profile_name:
            for p in profiles:
                if p.get('is_default'):
                    quality_profile_name = (p.get('name') or 'Standard').strip()
                    break
            if not quality_profile_name and profiles:
                quality_profile_name = (profiles[0].get('name') or 'Standard').strip()

        # ── Extract file quality, codec, resolution ──
        # Strategy: Try ffprobe first (cached), fall back to filename parsing
        file_quality = ''
        file_codec = ''
        file_resolution = ''
        file_video_codec = ''
        file_audio_codec = ''
        file_audio_channels = ''
        file_duration = 0
        file_score = None
        file_score_breakdown = ''
        probe_status = 'not_needed'  # not_needed | disabled | pending | cached | scanned | failed

        if has_file and file_path:
            # 1) Filename-based extraction (always, as baseline + for scoring)
            from ._helpers import _extract_quality_from_filename, _extract_formats_from_filename
            fname = os.path.basename(file_path)
            file_quality = _extract_quality_from_filename(fname)
            if file_quality == '-':
                file_quality = ''
            file_codec = _extract_formats_from_filename(fname)
            if file_codec == '-':
                file_codec = ''
            fl = fname.lower()
            if '2160' in fl or '4k' in fl:
                file_resolution = '2160p'
            elif '1080' in fl:
                file_resolution = '1080p'
            elif '720' in fl:
                file_resolution = '720p'
            elif '480' in fl:
                file_resolution = '480p'

            # Score the current file against the quality profile's custom formats
            try:
                from .profiles import _score_release, _get_profile_by_name_or_default
                profile = _get_profile_by_name_or_default(quality_profile_name, instance_id)
                file_score, file_score_breakdown = _score_release(fname, profile, instance_id)
            except Exception:
                file_score = None
                file_score_breakdown = ''

            # 2) ffprobe-based extraction (if analyze_video_files is enabled)
            # Read from universal video settings (shared across all instances)
            analyze_enabled = True  # default
            scan_profile = 'default'
            scan_strategy = 'trust_filename'
            try:
                from .instances import get_universal_video_settings
                uvs = get_universal_video_settings()
                analyze_enabled = uvs.get('analyze_video_files', True)
                scan_profile = (uvs.get('video_scan_profile') or 'default').strip().lower()
                scan_strategy = (uvs.get('video_scan_strategy') or 'trust_filename').strip().lower()
            except Exception:
                pass

            # Decide whether to probe:
            # - "trust_filename": only probe when filename can't provide resolution/codec
            # - "always_verify": always probe to confirm actual file contents
            # - force_probe: user explicitly clicked rescan, always probe
            filename_has_info = bool(file_resolution) or bool(file_codec)
            should_probe = (
                force_probe
                or scan_strategy == 'always_verify'
                or not filename_has_info
            )

            if not analyze_enabled and not force_probe:
                probe_status = 'disabled'
            elif skip_probe:
                # Quick-load mode: caller will make a second request for the actual probe
                probe_status = 'pending'
            elif not should_probe:
                # trust_filename strategy and filename provided enough info — skip probe
                probe_status = 'filename'
            else:
                current_mtime = 0
                try:
                    current_mtime = int(os.path.getmtime(file_path))
                except OSError:
                    current_mtime = 0
                # Check for cached media_info on the collection item (skip cache on force_probe)
                cached_info = movie.get('media_info')
                cached_profile = cached_info.get('scan_profile', 'default') if cached_info else ''
                profile_match = (
                    cached_profile == scan_profile
                    or cached_profile == 'mediainfo'  # mediainfo fallback results are always valid
                )
                if (
                    not force_probe
                    and cached_info
                    and isinstance(cached_info, dict)
                    and cached_info.get('file_size') == file_size
                    and cached_info.get('file_mtime') == current_mtime
                    and profile_match
                ):
                    # Cache hit — use probed data
                    probe_data = cached_info
                    probe_status = 'cached'
                else:
                    # Cache miss or force_probe — probe the file
                    try:
                        from src.primary.utils.media_probe import probe_media_file
                        probe_data = probe_media_file(file_path, scan_profile=scan_profile)
                    except Exception as probe_err:
                        movie_hunt_logger.debug("ffprobe failed for %s: %s", file_path, probe_err)
                        probe_data = None

                    if probe_data:
                        probe_status = 'scanned'
                    else:
                        probe_status = 'failed'

                    # Cache the result on the collection item
                    if probe_data and movie.get('tmdb_id') is not None:
                        try:
                            all_items = _get_collection_config(instance_id)
                            saved = False
                            for item in all_items:
                                if item.get('tmdb_id') == tmdb_id:
                                    item['media_info'] = probe_data
                                    saved = True
                                    break
                            if saved:
                                _save_collection_config(all_items, instance_id)
                            else:
                                movie_hunt_logger.debug("Could not cache: tmdb_id=%s not found in collection reload", tmdb_id)
                        except Exception as cache_err:
                            movie_hunt_logger.debug("Cache save error for tmdb_id=%s: %s", tmdb_id, cache_err)

                # Override filename-based values with probed data (if available)
                if probe_data and isinstance(probe_data, dict):
                    if probe_data.get('video_resolution'):
                        file_resolution = probe_data['video_resolution']
                    if probe_data.get('video_codec'):
                        file_video_codec = probe_data['video_codec']
                    if probe_data.get('audio_codec'):
                        file_audio_codec = probe_data['audio_codec']
                    if probe_data.get('audio_layout'):
                        file_audio_channels = probe_data['audio_layout']
                    if probe_data.get('duration_seconds'):
                        file_duration = probe_data['duration_seconds']
                    # Build combined codec string from probed data
                    parts = []
                    if file_video_codec:
                        parts.append(file_video_codec)
                    if file_audio_codec:
                        audio_str = file_audio_codec
                        if file_audio_channels and file_audio_channels not in ('Mono', 'Stereo', '0ch'):
                            audio_str += ' ' + file_audio_channels
                        parts.append(audio_str)
                    if parts:
                        file_codec = ' / '.join(parts)

                    # Re-score using enriched title (probe-verified resolution/codec)
                    # so the custom format score reflects the actual file, not just filename
                    try:
                        enriched = fname
                        # Append probe-detected tokens that may be missing from filename
                        tokens_to_add = []
                        fl_lower = fname.lower()
                        if file_resolution and file_resolution.replace('p', '') not in fl_lower:
                            tokens_to_add.append(file_resolution)
                        if file_video_codec:
                            # Normalize codec for filename matching (H.265 -> x265/hevc)
                            vc_lower = file_video_codec.lower().replace('.', '').replace('-', '')
                            if vc_lower not in fl_lower and vc_lower.replace('h', 'x') not in fl_lower:
                                tokens_to_add.append(file_video_codec)
                        if file_audio_codec:
                            ac_lower = file_audio_codec.lower().replace('-', '').replace(' ', '')
                            if ac_lower not in fl_lower.replace('-', '').replace(' ', ''):
                                tokens_to_add.append(file_audio_codec)
                        if file_audio_channels:
                            ch_lower = file_audio_channels.lower().replace('.', '').replace(' ', '')
                            if ch_lower not in fl_lower.replace('.', '').replace(' ', ''):
                                tokens_to_add.append(file_audio_channels)
                        if tokens_to_add:
                            enriched = fname + ' ' + ' '.join(tokens_to_add)
                        from .profiles import _score_release, _get_profile_by_name_or_default
                        profile = _get_profile_by_name_or_default(quality_profile_name, instance_id)
                        probe_score, probe_breakdown = _score_release(enriched, profile, instance_id)
                        file_score = probe_score
                        file_score_breakdown = probe_breakdown
                    except Exception:
                        pass  # keep filename-based score

        # Minimum availability
        min_availability = (movie.get('minimum_availability') or 'released').strip()

        return jsonify({
            'success': True,
            'found': True,
            'status': status,
            'has_file': has_file,
            'path': file_path,
            'root_folder_path': root_folder,
            'quality_profile': quality_profile_name or 'Standard',
            'file_size': file_size,
            'file_quality': file_quality,
            'file_codec': file_codec,
            'file_video_codec': file_video_codec,
            'file_audio_codec': file_audio_codec,
            'file_audio_channels': file_audio_channels,
            'file_resolution': file_resolution,
            'file_duration': file_duration,
            'file_score': file_score,
            'file_score_breakdown': file_score_breakdown,
            'minimum_availability': min_availability,
            'requested_at': movie.get('requested_at', ''),
            'probe_status': probe_status,
        })

    except Exception as e:
        movie_hunt_logger.error("Movie Hunt status fetch failed: %s", e)
        return jsonify({'success': True, 'found': False, 'reason': 'error'})


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
    """List Media Collection: only movies the user has requested. Status = available if on disk, else requested."""
    try:
        instance_id = _get_movie_hunt_instance_id_from_request()
        from .storage import _get_detected_movies_from_all_roots
        detected_list = _get_detected_movies_from_all_roots(instance_id)
        detected_key_set = {(_normalize_title_for_key(d.get('title')), str(d.get('year') or '').strip()) for d in detected_list}
        requested_list = _get_collection_config(instance_id)
        
        # Build list from requested items only (no detected-only entries)
        combined = []
        seen_tmdb = set()
        seen_title_year = set()
        
        for req in requested_list:
            if not isinstance(req, dict):
                continue
            
            title = (req.get('title') or '').strip()
            year = str(req.get('year') or '').strip()
            tmdb_id = req.get('tmdb_id')
            norm_title = _normalize_title_for_key(title)
            title_year_key = (norm_title, year)
            
            is_dupe = False
            if tmdb_id and tmdb_id in seen_tmdb:
                is_dupe = True
            elif title_year_key in seen_title_year:
                is_dupe = True
            
            if is_dupe:
                continue
            
            if tmdb_id:
                seen_tmdb.add(tmdb_id)
            seen_title_year.add(title_year_key)
            
            norm_key = (_normalize_title_for_key(title), year)
            status = 'available' if norm_key in detected_key_set else 'requested'
            combined.append({
                'title': title,
                'year': year,
                'status': status,
                'poster_path': req.get('poster_path') or '',
                'tmdb_id': tmdb_id,
                'root_folder': req.get('root_folder') or '',
                'requested_at': req.get('requested_at') or '',
            })
        
        # Persist status updates and cleanup duplicates in the background config
        items_full = _get_collection_config(instance_id)
        collection_updated = False
        deduped_items_full = []
        seen_full_tmdb = set()
        seen_full_title_year = set()
        
        for i, full_item in enumerate(items_full):
            if not isinstance(full_item, dict):
                continue
            
            t = (full_item.get('title') or '').strip()
            y = str(full_item.get('year') or '').strip()
            tid = full_item.get('tmdb_id')
            nt = _normalize_title_for_key(t)
            tyk = (nt, y)
            
            is_full_dupe = False
            if tid and tid in seen_full_tmdb:
                is_full_dupe = True
            elif tyk in seen_full_title_year:
                is_full_dupe = True
                
            if is_full_dupe:
                collection_updated = True # We found a duplicate to remove
                continue
            
            if tid:
                seen_full_tmdb.add(tid)
            seen_full_title_year.add(tyk)
            
            norm_key = (_normalize_title_for_key(t), y)
            if norm_key in detected_key_set and (full_item.get('status') or '').lower() != 'available':
                full_item['status'] = 'available'
                collection_updated = True
            
            deduped_items_full.append(full_item)
            
        if collection_updated:
            _save_collection_config(deduped_items_full, instance_id)
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
    """Remove item from requested list by index or by title+year/tmdb_id in JSON body."""
    try:
        body = request.get_json(silent=True) or {}
        title = (body.get('title') or '').strip()
        year = str(body.get('year') or '').strip()
        tmdb_id = body.get('tmdb_id')
        instance_id = _get_movie_hunt_instance_id_from_request()
        
        if tmdb_id or title:
            items = _get_collection_config(instance_id)
            new_items = []
            found = False
            for it in items:
                if not isinstance(it, dict):
                    continue
                
                match = False
                if tmdb_id and it.get('tmdb_id') == tmdb_id:
                    match = True
                elif not tmdb_id and (it.get('title') or '').strip() == title and str(it.get('year') or '') == year:
                    match = True
                
                if match:
                    found = True
                else:
                    new_items.append(it)
            
            if found:
                _save_collection_config(new_items, instance_id)
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


@movie_hunt_bp.route('/api/movie-hunt/collection/update', methods=['POST'])
def api_movie_hunt_collection_update_by_tmdb():
    """Update a collection item's editable fields by tmdb_id."""
    try:
        instance_id = _get_movie_hunt_instance_id_from_request()
        data = request.get_json() or {}
        tmdb_id = data.get('tmdb_id')
        if not tmdb_id:
            return jsonify({'success': False, 'error': 'tmdb_id required'}), 400
        tmdb_id = int(tmdb_id)

        items = _get_collection_config(instance_id)
        found = False
        for item in items:
            if item.get('tmdb_id') == tmdb_id:
                if 'root_folder' in data:
                    item['root_folder'] = (data['root_folder'] or '').strip()
                if 'quality_profile' in data:
                    item['quality_profile'] = (data['quality_profile'] or '').strip()
                if 'status' in data:
                    item['status'] = (data['status'] or '').strip()
                if 'minimum_availability' in data:
                    item['minimum_availability'] = (data['minimum_availability'] or '').strip() or 'released'
                found = True
                break

        if not found:
            return jsonify({'success': False, 'error': 'Movie not found in collection'}), 404

        _save_collection_config(items, instance_id)
        return jsonify({'success': True}), 200
    except Exception as e:
        logger.exception('Collection update error')
        return jsonify({'success': False, 'error': str(e)}), 500


@movie_hunt_bp.route('/api/movie-hunt/collection/remove', methods=['POST'])
def api_movie_hunt_collection_remove_by_tmdb():
    """Remove a collection item by tmdb_id, optionally adding to exclusion list."""
    import os
    import shutil

    try:
        instance_id = _get_movie_hunt_instance_id_from_request()
        data = request.get_json() or {}
        tmdb_id = data.get('tmdb_id')
        title = (data.get('title') or '').strip()
        year = str(data.get('year') or '').strip()
        add_to_blocklist = data.get('add_to_blocklist', False)
        delete_files = data.get('delete_files', False)

        items = _get_collection_config(instance_id)
        removed = False
        removed_item = None

        if tmdb_id:
            tmdb_id = int(tmdb_id)
            for i, item in enumerate(items):
                if item.get('tmdb_id') == tmdb_id:
                    removed_item = items.pop(i)
                    removed = True
                    break

        if not removed and title:
            for i, item in enumerate(items):
                if (item.get('title') or '').strip() == title and str(item.get('year') or '') == year:
                    removed_item = items.pop(i)
                    removed = True
                    break

        if not removed:
            return jsonify({'success': False, 'error': 'Movie not found in collection'}), 404

        _save_collection_config(items, instance_id)

        if add_to_blocklist and removed_item:
            from src.primary.utils.database import get_database
            db = get_database()
            exclusions = db.get_app_config_for_instance('movie_hunt_exclusions', instance_id) or {}
            excluded = exclusions.get('movies', [])
            entry = {
                'tmdb_id': removed_item.get('tmdb_id'),
                'title': removed_item.get('title', ''),
                'year': removed_item.get('year', ''),
                'excluded_at': datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')
            }
            existing_ids = {e.get('tmdb_id') for e in excluded if e.get('tmdb_id')}
            if removed_item.get('tmdb_id') and removed_item['tmdb_id'] not in existing_ids:
                excluded.append(entry)
            exclusions['movies'] = excluded
            db.save_app_config_for_instance('movie_hunt_exclusions', instance_id, exclusions)

        if delete_files and removed_item:
            root_folder = (removed_item.get('root_folder') or '').strip()
            file_path = (removed_item.get('file_path') or '').strip()
            movie_title = (removed_item.get('title') or '').strip()
            movie_year = str(removed_item.get('year') or '').strip()

            if file_path and os.path.isfile(file_path):
                folder = os.path.dirname(os.path.abspath(file_path))
                # Safety: ensure the folder is under a known root folder to prevent deleting arbitrary paths
                if root_folder and not folder.startswith(os.path.abspath(root_folder)):
                    movie_hunt_logger.warning("Refusing to delete folder outside root: %s", folder)
                elif os.path.isdir(folder):
                    try:
                        shutil.rmtree(folder)
                        movie_hunt_logger.info("Deleted movie folder: %s", folder)
                    except Exception as e:
                        movie_hunt_logger.error("Failed to delete folder %s: %s", folder, e)
            elif root_folder and movie_title:
                folder_name = '%s (%s)' % (movie_title, movie_year) if movie_year else movie_title
                folder_path = os.path.join(os.path.abspath(root_folder), folder_name)
                # Safety: ensure the constructed path stays under root_folder
                if not folder_path.startswith(os.path.abspath(root_folder)):
                    movie_hunt_logger.warning("Refusing to delete folder outside root: %s", folder_path)
                elif os.path.isdir(folder_path):
                    try:
                        shutil.rmtree(folder_path)
                        movie_hunt_logger.info("Deleted movie folder: %s", folder_path)
                    except Exception as e:
                        movie_hunt_logger.error("Failed to delete folder %s: %s", folder_path, e)

        return jsonify({'success': True}), 200
    except Exception as e:
        logger.exception('Collection remove error')
        return jsonify({'success': False, 'error': str(e)}), 500


# --- Calendar: upcoming release dates ---

@movie_hunt_bp.route('/api/movie-hunt/calendar', methods=['GET'])
def api_movie_hunt_calendar():
    """Return upcoming and recent release dates for collection items.
    Combines collection data with TMDB release dates.
    Query params: instance_id, days_past (default 14), days_future (default 90).
    """
    try:
        instance_id = _get_movie_hunt_instance_id_from_request()
        days_past = request.args.get('days_past', 14, type=int)
        days_future = request.args.get('days_future', 90, type=int)

        collection = _get_collection_config(instance_id)
        today = datetime.utcnow()
        range_start = (today - timedelta(days=days_past)).strftime('%Y-%m-%d')
        range_end = (today + timedelta(days=days_future)).strftime('%Y-%m-%d')
        today_str = today.strftime('%Y-%m-%d')

        events = []
        for item in collection:
            if not isinstance(item, dict):
                continue
            title = (item.get('title') or '').strip()
            if not title:
                continue
            tmdb_id = item.get('tmdb_id')
            year = str(item.get('year') or '').strip()
            poster = item.get('poster_path') or ''
            status = (item.get('status') or 'requested').strip()
            min_avail = (item.get('minimum_availability') or 'released').strip()

            # Get release dates - use stored dates or fetch if missing
            in_cinemas = (item.get('in_cinemas') or '').strip()
            digital_release = (item.get('digital_release') or '').strip()
            physical_release = (item.get('physical_release') or '').strip()

            # If no dates stored, try to fetch from TMDB
            if not in_cinemas and not digital_release and not physical_release and tmdb_id:
                dates = _fetch_tmdb_release_dates(tmdb_id)
                in_cinemas = dates.get('in_cinemas', '')
                digital_release = dates.get('digital_release', '')
                physical_release = dates.get('physical_release', '')

            base = {
                'title': title,
                'year': year,
                'tmdb_id': tmdb_id,
                'poster_path': poster,
                'status': status,
                'minimum_availability': min_avail,
            }

            # Add events for each known date within range
            if in_cinemas and range_start <= in_cinemas <= range_end:
                events.append({**base, 'date': in_cinemas, 'event_type': 'inCinemas', 'event_label': 'In Cinemas'})
            if digital_release and range_start <= digital_release <= range_end:
                events.append({**base, 'date': digital_release, 'event_type': 'digitalRelease', 'event_label': 'Digital Release'})
            if physical_release and range_start <= physical_release <= range_end:
                events.append({**base, 'date': physical_release, 'event_type': 'physicalRelease', 'event_label': 'Physical Release'})

            # If no dates at all, still include the movie so user sees it
            if not in_cinemas and not digital_release and not physical_release:
                events.append({**base, 'date': '', 'event_type': 'unknown', 'event_label': 'Date TBA'})

        # Sort: events with dates first (chronologically), then TBA items
        events.sort(key=lambda e: (0 if e['date'] else 1, e['date'] or '9999', e['title']))

        return jsonify({
            'success': True,
            'events': events,
            'range_start': range_start,
            'range_end': range_end,
            'today': today_str,
        }), 200

    except Exception as e:
        logger.exception('Calendar error')
        return jsonify({'success': False, 'error': str(e)}), 500


@movie_hunt_bp.route('/api/movie-hunt/calendar/upcoming', methods=['GET'])
def api_movie_hunt_calendar_upcoming():
    """Return upcoming TMDB releases (not limited to collection) for discovery.
    Uses TMDB discover/movie with upcoming release dates.
    """
    try:
        api_key = _get_tmdb_api_key_movie_hunt()
        today = datetime.utcnow()
        start_date = today.strftime('%Y-%m-%d')
        end_date = (today + timedelta(days=90)).strftime('%Y-%m-%d')
        page = request.args.get('page', 1, type=int)
        region = request.args.get('region', 'US')

        resp = requests.get(
            'https://api.themoviedb.org/3/discover/movie',
            params={
                'api_key': api_key,
                'primary_release_date.gte': start_date,
                'primary_release_date.lte': end_date,
                'sort_by': 'primary_release_date.asc',
                'page': page,
                'region': region,
                'with_release_type': '2|3|4|5',  # Theatrical, Digital, Physical
            },
            timeout=10
        )
        resp.raise_for_status()
        data = resp.json()

        movies = []
        for item in data.get('results', []):
            release_date = item.get('release_date') or ''
            year = ''
            if release_date:
                try:
                    year = str(int(release_date.split('-')[0]))
                except (ValueError, IndexError):
                    pass
            movies.append({
                'tmdb_id': item.get('id'),
                'title': (item.get('title') or '').strip(),
                'year': year,
                'release_date': release_date,
                'poster_path': item.get('poster_path') or '',
                'overview': (item.get('overview') or '').strip(),
                'vote_average': item.get('vote_average', 0),
                'popularity': item.get('popularity', 0),
            })

        return jsonify({
            'success': True,
            'movies': movies,
            'page': data.get('page', 1),
            'total_pages': data.get('total_pages', 1),
        }), 200

    except Exception as e:
        logger.exception('Calendar upcoming error')
        return jsonify({'success': False, 'error': str(e)}), 500
