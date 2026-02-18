"""TV Hunt discovery/request routes: search, NZB download, TMDB discover, collection."""

import json
import re
import requests
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta

from flask import request, jsonify

from .helpers import (
    _get_tv_hunt_instance_id_from_request,
    _get_tv_blocklist_source_titles,
    _blocklist_normalize_source_title,
    _add_tv_requested_queue_id,
    _tv_profiles_context,
    TV_HUNT_DEFAULT_CATEGORY,
    tv_hunt_logger,
)
from .indexers import get_tv_indexers_config, resolve_tv_indexer_api_url
from .profiles import get_profile_by_name_or_default, best_result_matching_profile
from .clients import get_tv_clients_config
from .storage import get_tv_root_folders_config, get_detected_episodes_from_all_roots
from ...utils.logger import logger


# --- TMDB API ---
TMDB_API_KEY = "9265b0bd0cd1962f7f3225989fcd7192"
TMDB_BASE = "https://api.themoviedb.org/3"

# TV Newznab categories (5000-series)
TV_HUNT_DEFAULT_CATEGORIES = [5000, 5010, 5020, 5030, 5040, 5045, 5050, 5060, 5070]

# Cache for TMDB→TVDB ID lookups (avoids repeated API calls in the same request).
# Bounded to 2000 entries to prevent unbounded memory growth.
_tvdb_id_cache = {}
_TVDB_CACHE_MAX = 2000


def _lookup_tvdb_id_from_tmdb(tmdb_id):
    """Look up the TVDB ID for a TV series using its TMDB ID via TMDB external_ids API."""
    if not tmdb_id:
        return None
    try:
        tmdb_id = int(tmdb_id)
    except (TypeError, ValueError):
        return None
    if tmdb_id in _tvdb_id_cache:
        return _tvdb_id_cache[tmdb_id]
    try:
        from src.primary.settings_manager import get_ssl_verify_setting
        verify_ssl = get_ssl_verify_setting()
        url = f"{TMDB_BASE}/tv/{tmdb_id}/external_ids?api_key={TMDB_API_KEY}"
        r = requests.get(url, timeout=10, verify=verify_ssl)
        if r.status_code == 200:
            data = r.json()
            tvdb_id = data.get('tvdb_id')
            if tvdb_id:
                if len(_tvdb_id_cache) >= _TVDB_CACHE_MAX:
                    _tvdb_id_cache.clear()
                _tvdb_id_cache[tmdb_id] = tvdb_id
                tv_hunt_logger.debug("Resolved TMDB %d → TVDB %s", tmdb_id, tvdb_id)
                return tvdb_id
    except Exception as e:
        tv_hunt_logger.debug("TVDB ID lookup failed for TMDB %d: %s", tmdb_id, e)
    return None


# --- Newznab search ---

def _clean_tv_search_title(title):
    """Clean a TV series title for Newznab search — strip problematic characters."""
    import re as _re
    cleaned = title.strip()
    cleaned = cleaned.replace('&', 'and')
    cleaned = _re.sub(r'[:\-!\'",.]', ' ', cleaned)
    cleaned = _re.sub(r'\s{2,}', ' ', cleaned).strip()
    return cleaned


def _search_newznab_tv(base_url, api_key, query, categories=None, timeout=15,
                       season=None, episode=None, tvdbid=None):
    """
    Search a Newznab indexer for TV NZBs.

    Uses t=tvsearch (structured TV search) first with season/ep params,
    then falls back to t=search (free text) if no results.

    Returns list of {title, nzb_url, size}.
    """
    if not (base_url and api_key and query and query.strip()):
        return []
    base_url = base_url.rstrip('/')
    api_key = api_key.strip()
    query = query.strip()
    if categories is None:
        categories = TV_HUNT_DEFAULT_CATEGORIES
    if isinstance(categories, (list, tuple)):
        cat_str = ','.join(str(c) for c in categories)
    else:
        cat_str = str(categories).strip() or '5000,5010,5020,5030,5040,5045'

    cleaned_title = _clean_tv_search_title(query)

    urls_to_try = []

    # Strategy 1: t=tvsearch with structured params (most reliable)
    tvsearch_url = f'{base_url}?t=tvsearch&apikey={requests.utils.quote(api_key)}&q={requests.utils.quote(cleaned_title)}&cat={cat_str}&limit=20'
    if season is not None:
        tvsearch_url += f'&season={int(season)}'
    if episode is not None:
        tvsearch_url += f'&ep={int(episode)}'
    if tvdbid:
        tvsearch_url += f'&tvdbid={tvdbid}'
    urls_to_try.append(tvsearch_url)

    # Strategy 2: t=tvsearch with TVDB ID only (no title — avoids title mismatch)
    if tvdbid and (season is not None or episode is not None):
        tvdb_url = f'{base_url}?t=tvsearch&apikey={requests.utils.quote(api_key)}&tvdbid={tvdbid}&cat={cat_str}&limit=20'
        if season is not None:
            tvdb_url += f'&season={int(season)}'
        if episode is not None:
            tvdb_url += f'&ep={int(episode)}'
        urls_to_try.append(tvdb_url)

    # Strategy 3: t=search with SxxExx appended (free text fallback)
    fallback_query = cleaned_title
    if season is not None and episode is not None:
        fallback_query += f' S{int(season):02d}E{int(episode):02d}'
    elif season is not None:
        fallback_query += f' S{int(season):02d}'
    fallback_url = f'{base_url}?t=search&apikey={requests.utils.quote(api_key)}&q={requests.utils.quote(fallback_query)}&cat={cat_str}&limit=20'
    urls_to_try.append(fallback_url)

    # Strategy 4: t=search with original (un-cleaned) title + SxxExx
    original_query = query
    if season is not None and episode is not None:
        original_query = f'{query} S{int(season):02d}E{int(episode):02d}'
    elif season is not None:
        original_query = f'{query} S{int(season):02d}'
    original_url = f'{base_url}?t=search&apikey={requests.utils.quote(api_key)}&q={requests.utils.quote(original_query)}&cat={cat_str}&limit=10'
    if original_url not in urls_to_try:
        urls_to_try.append(original_url)

    from src.primary.settings_manager import get_ssl_verify_setting
    verify_ssl = get_ssl_verify_setting()

    for url in urls_to_try:
        try:
            results = _parse_newznab_response(url, timeout, verify_ssl)
            if results:
                tv_hunt_logger.debug("TV search got %d results from: %s", len(results), url.split('&apikey=')[0])
                return results
        except Exception as e:
            tv_hunt_logger.debug("TV search attempt failed: %s", e)
            continue

    return []


def _parse_newznab_response(url, timeout=15, verify_ssl=True):
    """Parse a Newznab API response and return list of {title, nzb_url, size}."""
    try:
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
                    size = 0
                    if isinstance(enc, dict):
                        try:
                            size = int(enc.get('length') or enc.get('@length') or 0)
                        except (TypeError, ValueError):
                            size = 0
                    results.append({
                        'title': it.get('title') or '',
                        'nzb_url': nzb_url,
                        'size': size,
                    })
            except json.JSONDecodeError:
                pass
        else:
            try:
                root = ET.fromstring(text)
                ns = {'atom': 'http://www.w3.org/2005/Atom'}
                channel = root.find('channel')
                if channel is None:
                    channel = root
                for item in channel.findall('item'):
                    title_el = item.find('title')
                    link_el = item.find('link')
                    enc_el = item.find('enclosure')
                    nzb_url = None
                    if enc_el is not None and enc_el.get('url'):
                        nzb_url = enc_el.get('url')
                    elif link_el is not None and link_el.text:
                        nzb_url = link_el.text.strip()
                    if not nzb_url:
                        continue
                    size = 0
                    if enc_el is not None:
                        try:
                            size = int(enc_el.get('length') or 0)
                        except (TypeError, ValueError):
                            size = 0
                    results.append({
                        'title': (title_el.text or '').strip() if title_el is not None else '',
                        'nzb_url': nzb_url,
                        'size': size,
                    })
            except ET.ParseError:
                pass
        return results
    except Exception as e:
        tv_hunt_logger.debug("Newznab TV parse error: %s", e)
        return []


# --- Collection helpers ---

def _get_collection_config(instance_id):
    """Get the TV collection for an instance. Returns list of series dicts."""
    from src.primary.utils.database import get_database
    db = get_database()
    config = db.get_app_config_for_instance('tv_hunt_collection', instance_id)
    if not config or not isinstance(config.get('series'), list):
        return []
    return config['series']


def _save_collection_config(series_list, instance_id):
    """Save the TV collection for an instance."""
    from src.primary.utils.database import get_database
    db = get_database()
    db.save_app_config_for_instance('tv_hunt_collection', instance_id, {'series': series_list})


def _merge_detected_episodes_into_collection(instance_id, collection=None):
    """
    Merge filesystem-detected episodes into the collection so imported episodes
    show as available even before the importer has updated the collection.
    Mutates collection in place and persists if any episode was updated.
    If collection is None, fetches it from config.
    """
    import re
    if collection is None:
        collection = _get_collection_config(instance_id)
    if not collection:
        return
    detected = get_detected_episodes_from_all_roots(instance_id)
    if not detected:
        return

    def _normalize_series_for_match(title):
        s = (title or '').strip()
        s = re.sub(r'\s*\(\d{4}\)\s*$', '', s).strip()
        return s.lower()

    detected_by_series = {}
    for d in detected:
        folder_norm = _normalize_series_for_match(d.get('series_title') or '')
        if not folder_norm:
            continue
        key = (int(d.get('season_number') or 0), int(d.get('episode_number') or 0))
        if folder_norm not in detected_by_series:
            detected_by_series[folder_norm] = {}
        detected_by_series[folder_norm][key] = d.get('file_path') or ''

    collection_updated = False
    for s in collection:
        if not isinstance(s, dict):
            continue
        series_title = (s.get('title') or '').strip()
        series_norm = _normalize_series_for_match(series_title)
        detected_eps = detected_by_series.get(series_norm) or {}
        for sec in (s.get('seasons') or []):
            for ep in (sec.get('episodes') or []):
                if (ep.get('status') or '').lower() == 'available' or ep.get('file_path'):
                    continue
                season_num = int(sec.get('season_number') or 0)
                ep_num = int(ep.get('episode_number') or 0)
                detected_path = detected_eps.get((season_num, ep_num))
                if detected_path:
                    ep['status'] = 'available'
                    ep['file_path'] = detected_path
                    collection_updated = True
    if collection_updated:
        _save_collection_config(collection, instance_id)


# --- Add series to collection (used by Requestarr) ---

def _apply_monitor_option(normalized_seasons, monitor_option):
    """
    Apply monitor option to seasons/episodes. Mutates in place.
    At add time there are no files; 'has_file' is always False.
    """
    if not monitor_option:
        monitor_option = 'all_episodes'
    monitor_option = (monitor_option or '').strip().lower() or 'all_episodes'

    now = datetime.now()
    ninety_days_ago = now - timedelta(days=90)

    # Last season = highest season_number excluding specials
    regular_seasons = [s for s in normalized_seasons if s.get('season_number', 0) > 0]
    last_season_num = max((s['season_number'] for s in regular_seasons), default=1) if regular_seasons else 1

    def is_future_air_date(ad):
        if not ad:
            return False
        try:
            d = datetime.strptime(ad[:10], '%Y-%m-%d')
            if now.tzinfo and d.tzinfo is None:
                d = d.replace(tzinfo=now.tzinfo)
            return d > now
        except (ValueError, TypeError):
            return False

    def is_recent_or_future(ad):
        if not ad:
            return False
        try:
            d = datetime.strptime(ad[:10], '%Y-%m-%d')
            if now.tzinfo and d.tzinfo is None:
                d = d.replace(tzinfo=now.tzinfo)
            return d >= ninety_days_ago or d > now
        except (ValueError, TypeError):
            return False

    # First pass: set monitored per episode based on option
    for season in normalized_seasons:
        season_num = season.get('season_number', 0)
        is_specials = season_num == 0
        episodes = season.get('episodes') or []

        for ep in episodes:
            ep_num = ep.get('episode_number')
            air_date = ep.get('air_date') or ''
            # At add time no files
            has_file = False
            is_future = is_future_air_date(air_date)

            if monitor_option == 'none':
                ep['monitored'] = False
            elif monitor_option == 'all_episodes':
                ep['monitored'] = not is_specials
            elif monitor_option == 'future_episodes':
                ep['monitored'] = is_future
            elif monitor_option == 'missing_episodes':
                ep['monitored'] = not has_file or is_future
            elif monitor_option == 'existing_episodes':
                ep['monitored'] = has_file or is_future
            elif monitor_option == 'recent_episodes':
                ep['monitored'] = is_recent_or_future(air_date)
            elif monitor_option == 'pilot_episode':
                ep['monitored'] = (season_num == 1 and ep_num == 1)
            elif monitor_option == 'first_season':
                ep['monitored'] = (season_num == 1 and not is_specials)
            elif monitor_option == 'last_season':
                ep['monitored'] = (season_num == last_season_num and not is_specials)
            elif monitor_option == 'monitor_specials':
                ep['monitored'] = is_specials
            elif monitor_option == 'unmonitor_specials':
                ep['monitored'] = False if is_specials else True  # base: all regular, unmonitor specials
            else:
                ep['monitored'] = not is_specials

    # monitor_specials: only specials monitored, regular unmonitored
    if monitor_option == 'monitor_specials':
        for season in normalized_seasons:
            if season.get('season_number') != 0:
                for ep in (season.get('episodes') or []):
                    ep['monitored'] = False

    # Aggregate season.monitored = any episode monitored in that season
    for season in normalized_seasons:
        eps = season.get('episodes') or []
        season['monitored'] = any(ep.get('monitored', False) for ep in eps)




def add_series_to_tv_hunt_collection(
    instance_id, tmdb_id, title, overview='', poster_path='', backdrop_path='',
    root_folder=None, quality_profile=None, monitor=None
):
    """
    Add a TV series to the TV Hunt collection.
    Fetches full series data from TMDB if needed.
    Returns (success: bool, message: str).
    """
    try:
        instance_id = int(instance_id)
    except (TypeError, ValueError):
        return False, "Invalid instance_id"
    collection = _get_collection_config(instance_id)
    for s in collection:
        if s.get('tmdb_id') == tmdb_id:
            return False, "Series already in collection"
    try:
        from src.primary.settings_manager import get_ssl_verify_setting
        verify_ssl = get_ssl_verify_setting()
        r = requests.get(f'{TMDB_BASE}/tv/{tmdb_id}', params={
            'api_key': TMDB_API_KEY, 'language': 'en-US'
        }, timeout=15, verify=verify_ssl)
        if r.status_code != 200:
            return False, f"Failed to fetch series from TMDB: {r.status_code}"
        tmdb_data = r.json()
        seasons_data = tmdb_data.get('seasons', [])
        normalized_seasons = []
        for s in seasons_data:
            season_num = s.get('season_number')
            if season_num is None:
                continue
            episodes = s.get('episodes') or []
            if not episodes:
                try:
                    sr = requests.get(f'{TMDB_BASE}/tv/{tmdb_id}/season/{season_num}', params={
                        'api_key': TMDB_API_KEY, 'language': 'en-US'
                    }, timeout=15, verify=verify_ssl)
                    if sr.status_code == 200:
                        episodes = sr.json().get('episodes', [])
                except Exception:
                    pass
            normalized_episodes = []
            for ep in episodes:
                normalized_episodes.append({
                    'episode_number': ep.get('episode_number'),
                    'title': ep.get('name') or ep.get('title') or '',
                    'air_date': ep.get('air_date') or '',
                    'overview': ep.get('overview') or '',
                    'still_path': ep.get('still_path') or '',
                    'monitored': True,
                })
            normalized_seasons.append({
                'season_number': season_num,
                'episode_count': s.get('episode_count') or len(normalized_episodes),
                'air_date': s.get('air_date') or '',
                'name': s.get('name') or f'Season {season_num}',
                'poster_path': s.get('poster_path') or '',
                'monitored': True if season_num > 0 else False,
                'episodes': normalized_episodes,
            })

        _apply_monitor_option(normalized_seasons, monitor)
        any_monitored = any(s.get('monitored', False) for s in normalized_seasons)
        root_folders = get_tv_root_folders_config(instance_id)
        default_root = root_folders[0]['path'] if root_folders else ''
        use_root = (root_folder or '').strip() or default_root
        series_entry = {
            'tmdb_id': tmdb_id,
            'title': title or tmdb_data.get('name', ''),
            'overview': overview or tmdb_data.get('overview', ''),
            'poster_path': poster_path or tmdb_data.get('poster_path', ''),
            'backdrop_path': backdrop_path or tmdb_data.get('backdrop_path', ''),
            'first_air_date': tmdb_data.get('first_air_date', ''),
            'vote_average': tmdb_data.get('vote_average', 0),
            'genres': tmdb_data.get('genres', []),
            'status': tmdb_data.get('status', ''),
            'number_of_seasons': tmdb_data.get('number_of_seasons') or len(normalized_seasons),
            'number_of_episodes': tmdb_data.get('number_of_episodes', 0),
            'networks': tmdb_data.get('networks', []),
            'root_folder': use_root,
            'quality_profile': (quality_profile or '').strip() or '',
            'monitored': any_monitored,
            'added_at': datetime.now().isoformat(),
            'seasons': normalized_seasons,
        }
        collection.append(series_entry)
        _save_collection_config(collection, instance_id)
        return True, "Series added to collection"
    except Exception as e:
        logger.exception("TV Hunt add series error")
        return False, str(e)


# --- Core request function ---

def _normalize_series_for_detected_match(title):
    """Normalize series title for matching against detected folder names."""
    s = (title or '').strip()
    s = re.sub(r'\s*\(\d{4}\)\s*$', '', s).strip()
    return s.lower()


def perform_tv_hunt_request(
    instance_id, series_title, season_number=None, episode_number=None,
    tvdb_id=None, root_folder=None, quality_profile=None, poster_path=None,
    search_type="episode",
):
    """
    Core TV Hunt request: search indexers for a TV episode/season, pick best result,
    send NZB to download client.
    
    search_type: "episode" for S01E01 format, "season" for S01 format
    
    Returns (success: bool, message: str).
    """
    if not series_title or not series_title.strip():
        return False, "No series title provided"

    try:
        instance_id = int(instance_id)
    except (TypeError, ValueError):
        return False, "Invalid instance_id"

    # Refresh scan: check if episode(s) already on disk before requesting
    detected = get_detected_episodes_from_all_roots(instance_id)
    detected_set = set()
    for d in detected:
        folder_norm = _normalize_series_for_detected_match(d.get('series_title') or '')
        if folder_norm:
            detected_set.add((folder_norm, int(d.get('season_number') or 0), int(d.get('episode_number') or 0)))
    series_norm = _normalize_series_for_detected_match(series_title)
    if search_type == "episode" and season_number is not None and episode_number is not None:
        key = (series_norm, int(season_number), int(episode_number))
        if key in detected_set:
            tv_hunt_logger.info("Request: '%s' S%02dE%02d already on disk, skipping download", series_title.strip(), int(season_number), int(episode_number))
            _merge_detected_episodes_into_collection(instance_id)
            return False, "Already available on disk"
    elif search_type == "season" and season_number is not None:
        # For season pack: skip only if we have a contiguous run 1..N (likely full season)
        ep_nums = sorted(e for (sn, s, e) in detected_set if sn == series_norm and s == int(season_number))
        if ep_nums and ep_nums == list(range(1, len(ep_nums) + 1)) and len(ep_nums) >= 3:
            tv_hunt_logger.info("Request: '%s' S%02d already on disk (%d episodes), skipping download", series_title.strip(), int(season_number), len(ep_nums))
            _merge_detected_episodes_into_collection(instance_id)
            return False, "Already available on disk"

    # Prepare search parameters
    title_clean = series_title.strip()
    search_season = int(season_number) if season_number is not None else None
    search_episode = int(episode_number) if episode_number is not None else None

    # If search_type is "season", don't pass episode so we get season packs
    if search_type == "season":
        search_episode = None

    # Resolve TVDB ID for structured Newznab search
    resolved_tvdbid = tvdb_id
    if not resolved_tvdbid:
        # Check if the collection stores a TVDB ID for this series
        collection = _get_collection_config(instance_id)
        for s in collection:
            if s.get('title', '').strip().lower() == title_clean.lower():
                resolved_tvdbid = s.get('tvdb_id') or s.get('tvdbid')
                if not resolved_tvdbid:
                    # Try to lookup via TMDB external IDs
                    s_tmdb = s.get('tmdb_id')
                    if s_tmdb:
                        resolved_tvdbid = _lookup_tvdb_id_from_tmdb(s_tmdb)
                break

    # Build display query for error messages
    if search_type == "season" and search_season is not None:
        display_query = f"{title_clean} S{search_season:02d}"
    elif search_season is not None and search_episode is not None:
        display_query = f"{title_clean} S{search_season:02d}E{search_episode:02d}"
    else:
        display_query = title_clean

    tv_hunt_logger.debug("TV request: title='%s', S%sE%s, tvdbid=%s",
                         title_clean, search_season, search_episode, resolved_tvdbid)

    # Get indexers
    indexers = get_tv_indexers_config(instance_id)
    if not indexers:
        return False, "No indexers configured"

    # Get clients
    clients = get_tv_clients_config(instance_id)
    if not clients:
        return False, "No download clients configured"

    # Get profile
    profile = get_profile_by_name_or_default(quality_profile, instance_id, _tv_profiles_context()) if quality_profile else None

    # Get blocklist
    blocklist = _get_tv_blocklist_source_titles(instance_id)

    # Search each indexer (ordered by priority)
    all_results = []
    sorted_indexers = sorted(indexers, key=lambda x: x.get('priority', 50))
    for idx in sorted_indexers:
        if not idx.get('enabled', True):
            continue
        base_url = resolve_tv_indexer_api_url(idx)
        api_key = (idx.get('api_key') or '').strip()
        if not base_url or not api_key:
            continue
        cats = idx.get('categories') or TV_HUNT_DEFAULT_CATEGORIES
        ih_id = idx.get('indexer_hunt_id', '')
        import time as _time
        _search_start = _time.time()
        results = _search_newznab_tv(
            base_url, api_key, title_clean, cats,
            season=search_season,
            episode=search_episode,
            tvdbid=resolved_tvdbid,
        )
        _search_ms = int((_time.time() - _search_start) * 1000)

        # Record search event for Indexer Hunt stats (if linked)
        if ih_id:
            try:
                from src.primary.utils.database import get_database as _get_db
                _get_db().record_indexer_hunt_event(
                    indexer_id=ih_id, indexer_name=idx.get('name', ''),
                    event_type='search', query=title_clean,
                    response_time_ms=_search_ms,
                    success=bool(results),
                    instance_id=instance_id, instance_name='',
                )
            except Exception:
                pass

        for r in results:
            r['indexer_name'] = idx.get('name', 'Unknown')
            r['indexer_priority'] = idx.get('priority', 50)
            r['indexer_hunt_id'] = ih_id
            # Ensure size_bytes for size filtering (TV search returns 'size' in bytes)
            if 'size_bytes' not in r and r.get('size') is not None:
                r['size_bytes'] = r.get('size')
            # Filter blocklist
            if _blocklist_normalize_source_title(r.get('title', '')) in blocklist:
                continue
            all_results.append(r)

    if not all_results:
        return False, f"No results found for '{display_query}'"

    # Runtime for size filtering: episode ~45 min, season pack ~450 min (10 eps)
    runtime_minutes = 450 if search_type == "season" else 45

    # Score against profile if available
    if profile:
        best = best_result_matching_profile(all_results, profile, instance_id, _tv_profiles_context(), runtime_minutes=runtime_minutes)
    else:
        # Pick best by priority then size
        all_results.sort(key=lambda x: (x.get('indexer_priority', 50), -(x.get('size', 0))))
        best = all_results[0] if all_results else None

    if not best:
        return False, f"No matching results for '{display_query}' after profile filtering"

    # Send to download client
    nzb_url = best.get('nzb_url', '')
    nzb_title = best.get('title', display_query)
    if not nzb_url:
        return False, "Best result has no NZB URL"

    # Use instance-based category (TV-InstanceName) for NZB Hunt, SABnzbd, NZBGet
    from .helpers import _get_tv_hunt_instance_display_name, _instance_name_to_category
    inst_name = _get_tv_hunt_instance_display_name(instance_id)
    category = _instance_name_to_category(inst_name, "TV") if inst_name else (TV_HUNT_DEFAULT_CATEGORY or "tv")

    # Try each enabled client
    for client in clients:
        if not client.get('enabled', True):
            continue
        client_type = (client.get('type') or 'nzb_hunt').strip().lower()

        if client_type in ('nzbhunt', 'nzb_hunt'):
            success, queue_id = _send_to_nzb_hunt(nzb_url, nzb_title, category, instance_id=instance_id, instance_name=inst_name)
        elif client_type == 'sabnzbd':
            success, queue_id = _send_to_sabnzbd(client, nzb_url, nzb_title, category)
        elif client_type == 'nzbget':
            success, queue_id = _send_to_nzbget(client, nzb_url, nzb_title, category)
        else:
            continue

        if success:
            if queue_id:
                _add_tv_requested_queue_id(
                    instance_id, queue_id,
                    series_title=title_clean,
                    year='',
                    season=int(season_number) if season_number is not None else None,
                    episode=int(episode_number) if episode_number is not None else None,
                    episode_title='',
                    client_name=(client.get('name') or '').strip(),
                )
            # Record grab event for Indexer Hunt stats
            _grab_ih_id = best.get('indexer_hunt_id', '')
            if _grab_ih_id:
                try:
                    from src.primary.utils.database import get_database as _get_db
                    _get_db().record_indexer_hunt_event(
                        indexer_id=_grab_ih_id, indexer_name=best.get('indexer_name', ''),
                        event_type='grab', query=title_clean,
                        result_title=nzb_title,
                        instance_id=instance_id, instance_name='',
                    )
                except Exception:
                    pass
            return True, f"Sent '{nzb_title}' to {client_type}"

    return False, "All download clients failed"


def _send_to_nzb_hunt(nzb_url, title, category, instance_id=None, instance_name=None):
    """Send NZB to NZB Hunt internal client."""
    try:
        from src.primary.apps.nzb_hunt.download_manager import get_manager
        from .helpers import _get_tv_hunt_instance_display_name
        mgr = get_manager()
        src_id = str(instance_id) if instance_id is not None else ""
        src_name = (instance_name or "").strip() or (_get_tv_hunt_instance_display_name(instance_id) if instance_id is not None else "")
        success, message, queue_id = mgr.add_nzb(
            nzb_url=nzb_url,
            name=title or '',
            category=category or TV_HUNT_DEFAULT_CATEGORY,
            priority='normal',
            added_by='tv_hunt',
            nzb_name=title or '',
            indexer='',
            source_instance_id=src_id,
            source_instance_name=src_name,
        )
        return success, queue_id or ''
    except Exception as e:
        tv_hunt_logger.debug("NZB Hunt send error: %s", e)
        return False, ''


def _send_to_sabnzbd(client, nzb_url, title, category):
    """Send NZB to SABnzbd."""
    try:
        host = (client.get('host') or '').strip().rstrip('/')
        if not host:
            return False, ''
        if not (host.startswith('http://') or host.startswith('https://')):
            host = f'http://{host}'
        port = client.get('port', 8080)
        base_url = f'{host}:{port}'
        api_key = (client.get('api_key') or '').strip()
        params = {
            'mode': 'addurl',
            'name': nzb_url,
            'nzbname': title,
            'cat': category,
            'output': 'json',
        }
        if api_key:
            params['apikey'] = api_key
        from src.primary.settings_manager import get_ssl_verify_setting
        verify_ssl = get_ssl_verify_setting()
        r = requests.get(f'{base_url}/api', params=params, timeout=30, verify=verify_ssl)
        r.raise_for_status()
        data = r.json()
        if data.get('status') is True or data.get('nzo_ids'):
            nzo_ids = data.get('nzo_ids') or []
            return True, nzo_ids[0] if nzo_ids else ''
        return False, data.get('error', 'SABnzbd returned an error')
    except Exception as e:
        tv_hunt_logger.debug("SABnzbd send error: %s", e)
        return False, str(e) or 'Connection failed'


def _send_to_nzbget(client, nzb_url, title, category):
    """Send NZB to NZBGet."""
    try:
        host = (client.get('host') or '').strip().rstrip('/')
        if not host:
            return False, ''
        if not (host.startswith('http://') or host.startswith('https://')):
            host = f'http://{host}'
        port = client.get('port', 6789)
        base_url = f'{host}:{port}'
        username = (client.get('username') or '').strip()
        password = (client.get('password') or '').strip()
        from src.primary.settings_manager import get_ssl_verify_setting
        verify_ssl = get_ssl_verify_setting()
        jsonrpc_url = f'{base_url}/jsonrpc'
        payload = {
            'method': 'append',
            'params': [title, nzb_url, category, 0, False, False, '', 0, 'SCORE'],
            'id': 1,
        }
        auth = (username, password) if (username or password) else None
        r = requests.post(jsonrpc_url, json=payload, auth=auth, timeout=30, verify=verify_ssl)
        r.raise_for_status()
        data = r.json()
        if data.get('result') and data.get('result') != 0:
            return True, str(data.get('result'))
        err = data.get('error', {})
        return False, err.get('message', 'NZBGet returned an error') if isinstance(err, dict) else str(err)
    except Exception as e:
        tv_hunt_logger.debug("NZBGet send error: %s", e)
        return False, str(e) or 'Connection failed'


# ── TMDB Discovery Endpoints ──

def register_tv_discovery_routes(bp):
    @bp.route('/api/tv-hunt/discover/tv', methods=['GET'])
    def api_tv_hunt_discover():
        """Discover TV shows from TMDB."""
        try:
            page = request.args.get('page', 1, type=int)
            sort_by = request.args.get('sort_by', 'popularity.desc')
            genre = request.args.get('genre', '')
            year = request.args.get('year', '')
            
            params = {
                'api_key': TMDB_API_KEY,
                'language': 'en-US',
                'sort_by': sort_by,
                'page': page,
                'include_adult': 'false',
            }
            if genre:
                params['with_genres'] = genre
            if year:
                params['first_air_date_year'] = year
            
            from src.primary.settings_manager import get_ssl_verify_setting
            verify_ssl = get_ssl_verify_setting()
            r = requests.get(f'{TMDB_BASE}/discover/tv', params=params, timeout=15, verify=verify_ssl)
            if r.status_code != 200:
                return jsonify({'results': [], 'total_pages': 0}), 200
            data = r.json()
            return jsonify({
                'results': data.get('results', []),
                'total_pages': data.get('total_pages', 0),
                'total_results': data.get('total_results', 0),
                'page': data.get('page', 1),
            }), 200
        except Exception as e:
            logger.exception('TV Hunt discover error')
            return jsonify({'results': [], 'error': str(e)}), 200
    
    
    @bp.route('/api/tv-hunt/search', methods=['GET'])
    def api_tv_hunt_search():
        """Search TV shows on TMDB."""
        try:
            q = request.args.get('q', '').strip()
            if not q:
                return jsonify({'results': []}), 200
            page = request.args.get('page', 1, type=int)
            params = {
                'api_key': TMDB_API_KEY,
                'language': 'en-US',
                'query': q,
                'page': page,
            }
            from src.primary.settings_manager import get_ssl_verify_setting
            verify_ssl = get_ssl_verify_setting()
            r = requests.get(f'{TMDB_BASE}/search/tv', params=params, timeout=15, verify=verify_ssl)
            if r.status_code != 200:
                return jsonify({'results': []}), 200
            data = r.json()
            return jsonify({
                'results': data.get('results', []),
                'total_pages': data.get('total_pages', 0),
                'page': data.get('page', 1),
            }), 200
        except Exception as e:
            logger.exception('TV Hunt search error')
            return jsonify({'results': [], 'error': str(e)}), 200
    
    
    @bp.route('/api/tv-hunt/series/<int:tmdb_id>', methods=['GET'])
    def api_tv_hunt_series_detail(tmdb_id):
        """Get detailed TV series info from TMDB including seasons. Cached with smart TTL."""
        try:
            from src.primary.utils.tmdb_metadata_cache import get, set_tv_series

            cached = get('tv', tmdb_id)
            if cached is not None:
                return jsonify(cached), 200

            params = {
                'api_key': TMDB_API_KEY,
                'language': 'en-US',
                'append_to_response': 'external_ids,content_ratings',
            }
            from src.primary.settings_manager import get_ssl_verify_setting
            verify_ssl = get_ssl_verify_setting()
            r = requests.get(f'{TMDB_BASE}/tv/{tmdb_id}', params=params, timeout=15, verify=verify_ssl)
            if r.status_code != 200:
                return jsonify({'error': 'Series not found'}), 404
            data = r.json()
            set_tv_series(tmdb_id, data)
            return jsonify(data), 200
        except Exception as e:
            logger.exception('TV Hunt series detail error')
            return jsonify({'error': str(e)}), 500
    
    
    @bp.route('/api/tv-hunt/series/<int:tmdb_id>/season/<int:season_number>', methods=['GET'])
    def api_tv_hunt_season_detail(tmdb_id, season_number):
        """Get detailed season info from TMDB including all episodes. Cached with smart TTL."""
        try:
            from src.primary.utils.tmdb_metadata_cache import get, set_tv_season

            cached = get('tv', tmdb_id, f'season:{season_number}')
            if cached is not None:
                return jsonify(cached), 200

            params = {
                'api_key': TMDB_API_KEY,
                'language': 'en-US',
            }
            from src.primary.settings_manager import get_ssl_verify_setting
            verify_ssl = get_ssl_verify_setting()
            r = requests.get(f'{TMDB_BASE}/tv/{tmdb_id}/season/{season_number}', params=params, timeout=15, verify=verify_ssl)
            if r.status_code != 200:
                return jsonify({'error': 'Season not found'}), 404
            data = r.json()
            set_tv_season(tmdb_id, season_number, data, series_data=None)
            return jsonify(data), 200
        except Exception as e:
            logger.exception('TV Hunt season detail error')
            return jsonify({'error': str(e)}), 500
    
    
    # ── Collection CRUD ──
    
    @bp.route('/api/tv-hunt/collection', methods=['GET'])
    def api_tv_hunt_collection_get():
        """Get the TV series collection for the current instance.
        Merges detected episodes from disk so imported episodes show as available."""
        try:
            instance_id = _get_tv_hunt_instance_id_from_request()
            if not instance_id:
                return jsonify({'series': []}), 200
            series = _get_collection_config(instance_id)
            _merge_detected_episodes_into_collection(instance_id, series)
            return jsonify({'series': series}), 200
        except Exception as e:
            logger.exception('TV Hunt collection get error')
            return jsonify({'series': [], 'error': str(e)}), 200
    
    
    @bp.route('/api/tv-hunt/collection', methods=['POST'])
    def api_tv_hunt_collection_add():
        """Add a TV series to the collection. Body: series object with seasons/episodes from TMDB."""
        try:
            instance_id = _get_tv_hunt_instance_id_from_request()
            if not instance_id:
                return jsonify({'error': 'No instance selected'}), 400
            data = request.get_json(silent=True) or {}
            if not data or not isinstance(data, dict):
                return jsonify({'error': 'Invalid data'}), 400
            
            title = (data.get('title') or data.get('name') or '').strip()
            tmdb_id = data.get('tmdb_id') or data.get('id')
            if not title:
                return jsonify({'error': 'Title is required'}), 400
            
            collection = _get_collection_config(instance_id)
            
            # Check for duplicate
            for s in collection:
                if s.get('tmdb_id') == tmdb_id:
                    return jsonify({'error': 'Series already in collection', 'exists': True}), 409
            
            # Fetch full series details from TMDB if not provided
            seasons_data = data.get('seasons') or []
            if not seasons_data and tmdb_id:
                try:
                    from src.primary.settings_manager import get_ssl_verify_setting
                    verify_ssl = get_ssl_verify_setting()
                    r = requests.get(f'{TMDB_BASE}/tv/{tmdb_id}', params={
                        'api_key': TMDB_API_KEY, 'language': 'en-US'
                    }, timeout=15, verify=verify_ssl)
                    if r.status_code == 200:
                        tmdb_data = r.json()
                        seasons_data = tmdb_data.get('seasons', [])
                        if not data.get('overview'):
                            data['overview'] = tmdb_data.get('overview', '')
                        if not data.get('first_air_date'):
                            data['first_air_date'] = tmdb_data.get('first_air_date', '')
                        if not data.get('vote_average'):
                            data['vote_average'] = tmdb_data.get('vote_average', 0)
                        if not data.get('number_of_seasons'):
                            data['number_of_seasons'] = tmdb_data.get('number_of_seasons', 0)
                        if not data.get('number_of_episodes'):
                            data['number_of_episodes'] = tmdb_data.get('number_of_episodes', 0)
                        if not data.get('genres'):
                            data['genres'] = tmdb_data.get('genres', [])
                        if not data.get('status'):
                            data['status'] = tmdb_data.get('status', '')
                        if not data.get('networks'):
                            data['networks'] = tmdb_data.get('networks', [])
                except Exception:
                    pass
            
            # Build normalized seasons list (fetch episode details per season)
            normalized_seasons = []
            for s in seasons_data:
                season_num = s.get('season_number')
                if season_num is None:
                    continue
                episodes = s.get('episodes') or []
                if not episodes and tmdb_id:
                    # Fetch episode list for this season
                    try:
                        from src.primary.settings_manager import get_ssl_verify_setting
                        verify_ssl = get_ssl_verify_setting()
                        sr = requests.get(f'{TMDB_BASE}/tv/{tmdb_id}/season/{season_num}', params={
                            'api_key': TMDB_API_KEY, 'language': 'en-US'
                        }, timeout=15, verify=verify_ssl)
                        if sr.status_code == 200:
                            episodes = sr.json().get('episodes', [])
                    except Exception:
                        pass
                
                normalized_episodes = []
                for ep in episodes:
                    normalized_episodes.append({
                        'episode_number': ep.get('episode_number'),
                        'title': ep.get('name') or ep.get('title') or '',
                        'air_date': ep.get('air_date') or '',
                        'overview': ep.get('overview') or '',
                        'still_path': ep.get('still_path') or '',
                        'monitored': True,
                    })
                
                normalized_seasons.append({
                    'season_number': season_num,
                    'episode_count': s.get('episode_count') or len(normalized_episodes),
                    'air_date': s.get('air_date') or '',
                    'name': s.get('name') or f'Season {season_num}',
                    'poster_path': s.get('poster_path') or '',
                    'monitored': True if season_num > 0 else False,  # Don't monitor Specials by default
                    'episodes': normalized_episodes,
                })
            
            # Get root folders for default assignment
            root_folders = get_tv_root_folders_config(instance_id)
            default_root = root_folders[0]['path'] if root_folders else ''
            
            series_entry = {
                'tmdb_id': tmdb_id,
                'title': title,
                'overview': data.get('overview') or '',
                'poster_path': data.get('poster_path') or data.get('poster') or '',
                'backdrop_path': data.get('backdrop_path') or '',
                'first_air_date': data.get('first_air_date') or '',
                'vote_average': data.get('vote_average') or 0,
                'genres': data.get('genres') or [],
                'status': data.get('status') or '',
                'number_of_seasons': data.get('number_of_seasons') or len(normalized_seasons),
                'number_of_episodes': data.get('number_of_episodes') or 0,
                'networks': data.get('networks') or [],
                'root_folder': data.get('root_folder') or default_root,
                'quality_profile': data.get('quality_profile') or '',
                'monitored': True,
                'added_at': datetime.now().isoformat(),
                'seasons': normalized_seasons,
            }
            
            collection.append(series_entry)
            _save_collection_config(collection, instance_id)
            
            return jsonify({'success': True, 'series': series_entry}), 201
        except Exception as e:
            logger.exception('TV Hunt collection add error')
            return jsonify({'error': str(e)}), 500
    
    
    @bp.route('/api/tv-hunt/collection/<int:tmdb_id>', methods=['DELETE'])
    def api_tv_hunt_collection_remove(tmdb_id):
        """Remove a TV series from the collection."""
        try:
            instance_id = _get_tv_hunt_instance_id_from_request()
            if not instance_id:
                return jsonify({'error': 'No instance selected'}), 400
            collection = _get_collection_config(instance_id)
            new_collection = [s for s in collection if s.get('tmdb_id') != tmdb_id]
            if len(new_collection) == len(collection):
                return jsonify({'error': 'Series not found in collection'}), 404
            _save_collection_config(new_collection, instance_id)
            return jsonify({'success': True}), 200
        except Exception as e:
            logger.exception('TV Hunt collection remove error')
            return jsonify({'error': str(e)}), 500
    
    
    @bp.route('/api/tv-hunt/collection/update', methods=['POST'])
    def api_tv_hunt_collection_update():
        """Update a TV series' editable fields (root_folder, quality_profile)."""
        try:
            instance_id = _get_tv_hunt_instance_id_from_request()
            if not instance_id:
                return jsonify({'error': 'No instance selected'}), 400
            data = request.get_json() or {}
            tmdb_id = data.get('tmdb_id')
            if not tmdb_id:
                return jsonify({'error': 'tmdb_id required'}), 400
            collection = _get_collection_config(instance_id)
            found = False
            for series in collection:
                if series.get('tmdb_id') == tmdb_id:
                    if 'root_folder' in data:
                        series['root_folder'] = data['root_folder']
                    if 'quality_profile' in data:
                        series['quality_profile'] = data['quality_profile']
                    found = True
                    break
            if not found:
                return jsonify({'error': 'Series not found in collection'}), 404
            _save_collection_config(collection, instance_id)
            return jsonify({'success': True}), 200
        except Exception as e:
            logger.exception('TV Hunt collection update error')
            return jsonify({'error': str(e)}), 500


    @bp.route('/api/tv-hunt/collection/<int:tmdb_id>/monitor', methods=['PUT'])
    def api_tv_hunt_collection_monitor(tmdb_id):
        """Update monitoring settings for a series, season, or episode."""
        try:
            instance_id = _get_tv_hunt_instance_id_from_request()
            if not instance_id:
                return jsonify({'error': 'No instance selected'}), 400
            data = request.get_json() or {}
            collection = _get_collection_config(instance_id)
            
            for series in collection:
                try:
                    s_tmdb_id = int(series.get('tmdb_id'))
                except (TypeError, ValueError):
                    continue
                
                if s_tmdb_id != tmdb_id:
                    continue
                
                # Monitor whole series: cascade to all seasons and episodes
                if 'monitored' in data and 'season_number' not in data:
                    monitored = bool(data['monitored'])
                    logger.info(f"Toggling series monitor for TMDB {tmdb_id} to {monitored}")
                    series['monitored'] = monitored
                    for season in (series.get('seasons') or []):
                        season['monitored'] = monitored
                        for ep in (season.get('episodes') or []):
                            ep['monitored'] = monitored
                    _save_collection_config(collection, instance_id)
                    return jsonify({'success': True}), 200
                
                season_number = data.get('season_number')
                episode_number = data.get('episode_number')
                monitored = data.get('monitored', True)
                
                for season in (series.get('seasons') or []):
                    if season.get('season_number') != season_number:
                        continue
                    
                    if episode_number is not None:
                        # Monitor specific episode
                        for ep in (season.get('episodes') or []):
                            if ep.get('episode_number') == episode_number:
                                ep['monitored'] = bool(monitored)
                                break
                    else:
                        # Monitor whole season
                        season['monitored'] = bool(monitored)
                        for ep in (season.get('episodes') or []):
                            ep['monitored'] = bool(monitored)
                    break
                
                _save_collection_config(collection, instance_id)
                return jsonify({'success': True}), 200
            
            return jsonify({'error': 'Series not found'}), 404
        except Exception as e:
            logger.exception('TV Hunt monitor update error')
            return jsonify({'error': str(e)}), 500
    
    
    # ── Request endpoint (manual search) ──
    
    @bp.route('/api/tv-hunt/request', methods=['POST'])
    def api_tv_hunt_request():
        """Manually request a TV search (episode or season)."""
        try:
            data = request.get_json() or {}
            instance_id = _get_tv_hunt_instance_id_from_request()
            if not instance_id:
                return jsonify({'success': False, 'message': 'No instance selected'}), 400
            
            series_title = (data.get('series_title') or data.get('title') or '').strip()
            season_number = data.get('season_number')
            episode_number = data.get('episode_number')
            tmdb_id = data.get('tmdb_id')
            tvdb_id = data.get('tvdb_id')
            root_folder = data.get('root_folder')
            quality_profile = data.get('quality_profile')
            search_type = data.get('search_type', 'episode')

            # Resolve TVDB ID from TMDB if not provided
            if not tvdb_id and tmdb_id:
                tvdb_id = _lookup_tvdb_id_from_tmdb(tmdb_id)
            
            if search_type == 'monitored':
                collection = _get_collection_config(instance_id)
                
                # Robust ID and title matching
                series = None
                search_tmdb_id = None
                try:
                    if tmdb_id is not None:
                        search_tmdb_id = int(tmdb_id)
                except (TypeError, ValueError):
                    pass
                
                for s in collection:
                    s_tmdb_id = s.get('tmdb_id')
                    try:
                        if s_tmdb_id is not None:
                            s_tmdb_id = int(s_tmdb_id)
                    except (TypeError, ValueError):
                        pass
                    
                    if search_tmdb_id is not None and s_tmdb_id == search_tmdb_id:
                        series = s
                        break
                    if series_title and s.get('title') == series_title:
                        series = s
                        break
                
                if not series:
                    logger.warning(f"Search monitored: Series not found for TMDB {search_tmdb_id} or title '{series_title}'")
                    return jsonify({'success': False, 'message': 'Series not found in collection'}), 404
                
                # Use title from collection if missing from request
                if not series_title:
                    series_title = series.get('title', '').strip()
                
                if not series_title:
                    return jsonify({'success': False, 'message': 'Series title required for search'}), 400
                
                missing_monitored = []
                for season in (series.get('seasons') or []):
                    for ep in (season.get('episodes') or []):
                        monitored = ep.get('monitored', True)
                        status = (ep.get('status') or '').lower()
                        has_file = status == 'available' or ep.get('file_path')
                        
                        if monitored and not has_file:
                            missing_monitored.append({
                                'season': season.get('season_number'),
                                'episode': ep.get('episode_number')
                            })
                
                if not missing_monitored:
                    return jsonify({'success': True, 'message': 'No monitored missing episodes found.'}), 200
                
                # Limit to first 20 missing to avoid extreme timeouts
                to_search = missing_monitored[:20]
                success_count = 0
                for item in to_search:
                    s, m = perform_tv_hunt_request(
                        instance_id, series_title,
                        season_number=item['season'],
                        episode_number=item['episode'],
                        tvdb_id=tvdb_id,
                        root_folder=root_folder,
                        quality_profile=quality_profile,
                        search_type='episode'
                    )
                    if s:
                        success_count += 1
                
                msg = f"Requested {success_count} of {len(to_search)} monitored missing episodes."
                if len(missing_monitored) > 20:
                    msg += f" (Total missing: {len(missing_monitored)})"
                return jsonify({'success': success_count > 0, 'message': msg}), 200

            success, msg = perform_tv_hunt_request(
                instance_id, series_title,
                season_number=season_number,
                episode_number=episode_number,
                tvdb_id=tvdb_id,
                root_folder=root_folder,
                quality_profile=quality_profile,
                search_type=search_type,
            )
            
            return jsonify({'success': success, 'message': msg}), 200
        except Exception as e:
            logger.exception('TV Hunt request error')
            return jsonify({'success': False, 'message': str(e)}), 500
    
    
    # ── Calendar ──
    
    @bp.route('/api/tv-hunt/calendar', methods=['GET'])
    def api_tv_hunt_calendar():
        """Get upcoming episodes from collection (for calendar view)."""
        try:
            instance_id = _get_tv_hunt_instance_id_from_request()
            if not instance_id:
                return jsonify({'episodes': []}), 200
            
            collection = _get_collection_config(instance_id)
            now = datetime.now()
            upcoming = []
            
            for series in collection:
                if not isinstance(series, dict):
                    continue
                series_title = series.get('title', '')
                poster_path = series.get('poster_path', '')
                
                for season in (series.get('seasons') or []):
                    season_num = season.get('season_number')
                    for ep in (season.get('episodes') or []):
                        air_date_str = ep.get('air_date') or ''
                        if not air_date_str:
                            continue
                        try:
                            air_date = datetime.strptime(air_date_str[:10], '%Y-%m-%d')
                        except (ValueError, TypeError):
                            continue
                        
                        # Show episodes from 30 days ago to 90 days in the future
                        if (now - timedelta(days=30)) <= air_date <= (now + timedelta(days=90)):
                            upcoming.append({
                                'series_title': series_title,
                                'tmdb_id': series.get('tmdb_id'),
                                'season_number': season_num,
                                'episode_number': ep.get('episode_number'),
                                'episode_title': ep.get('title', ''),
                                'air_date': air_date_str,
                                'poster_path': poster_path,
                                'monitored': ep.get('monitored', True),
                            })
            
            # Sort by air date
            upcoming.sort(key=lambda x: x.get('air_date', ''))
            return jsonify({'episodes': upcoming}), 200
        except Exception as e:
            logger.exception('TV Hunt calendar error')
            return jsonify({'episodes': [], 'error': str(e)}), 200
