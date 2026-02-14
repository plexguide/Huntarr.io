"""TV Hunt discovery/request routes: search, NZB download, TMDB discover, collection."""

import json
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
from .storage import get_tv_root_folders_config
from ...utils.logger import logger


# --- TMDB API ---
TMDB_API_KEY = "9265b0bd0cd1962f7f3225989fcd7192"
TMDB_BASE = "https://api.themoviedb.org/3"

# TV Newznab categories (5000-series)
TV_HUNT_DEFAULT_CATEGORIES = [5000, 5010, 5020, 5030, 5040, 5045, 5050, 5060, 5070]


# --- Newznab search ---

def _search_newznab_tv(base_url, api_key, query, categories=None, timeout=15):
    """Search a Newznab indexer for TV NZBs. Returns list of {title, nzb_url, size}."""
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
        tv_hunt_logger.debug("Newznab TV search error for %s: %s", base_url, e)
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

    # Build search query
    title_clean = series_title.strip()
    if search_type == "season" and season_number is not None:
        query = f"{title_clean} S{int(season_number):02d}"
    elif season_number is not None and episode_number is not None:
        query = f"{title_clean} S{int(season_number):02d}E{int(episode_number):02d}"
    else:
        query = title_clean

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
        results = _search_newznab_tv(base_url, api_key, query, cats)

        # Track indexer event for Indexer Hunt stats
        try:
            from ...routes.indexer_hunt.stats import record_indexer_event
            record_indexer_event(idx.get('name', 'Unknown'), 'query', success=bool(results))
        except Exception:
            pass

        for r in results:
            r['indexer_name'] = idx.get('name', 'Unknown')
            r['indexer_priority'] = idx.get('priority', 50)
            # Ensure size_bytes for size filtering (TV search returns 'size' in bytes)
            if 'size_bytes' not in r and r.get('size') is not None:
                r['size_bytes'] = r.get('size')
            # Filter blocklist
            if _blocklist_normalize_source_title(r.get('title', '')) in blocklist:
                continue
            all_results.append(r)

    if not all_results:
        return False, f"No results found for '{query}'"

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
        return False, f"No matching results for '{query}' after profile filtering"

    # Send to download client
    nzb_url = best.get('nzb_url', '')
    nzb_title = best.get('title', query)
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
                _add_tv_requested_queue_id(instance_id, queue_id)
            # Track grab event for Indexer Hunt
            try:
                from ...routes.indexer_hunt.stats import record_indexer_event
                record_indexer_event(best.get('indexer_name', 'Unknown'), 'grab', success=True)
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
        api_key = (client.get('api_key') or '').strip()
        if not host or not api_key:
            return False, ''
        params = {
            'mode': 'addurl',
            'name': nzb_url,
            'nzbname': title,
            'cat': category,
            'apikey': api_key,
            'output': 'json',
        }
        from src.primary.settings_manager import get_ssl_verify_setting
        verify_ssl = get_ssl_verify_setting()
        r = requests.get(f'{host}/api', params=params, timeout=30, verify=verify_ssl)
        data = r.json() if r.status_code == 200 else {}
        if data.get('status'):
            nzo_ids = data.get('nzo_ids') or []
            return True, nzo_ids[0] if nzo_ids else ''
        return False, ''
    except Exception as e:
        tv_hunt_logger.debug("SABnzbd send error: %s", e)
        return False, ''


def _send_to_nzbget(client, nzb_url, title, category):
    """Send NZB to NZBGet."""
    try:
        host = (client.get('host') or '').strip().rstrip('/')
        username = (client.get('username') or '').strip()
        password = (client.get('password') or '').strip()
        if not host:
            return False, ''
        from src.primary.settings_manager import get_ssl_verify_setting
        verify_ssl = get_ssl_verify_setting()
        url = f'{host}/jsonrpc'
        payload = {
            'method': 'append',
            'params': [title, nzb_url, category, 0, False, False, '', 0, 'SCORE'],
        }
        auth = (username, password) if username else None
        r = requests.post(url, json=payload, auth=auth, timeout=30, verify=verify_ssl)
        data = r.json() if r.status_code == 200 else {}
        result_id = data.get('result')
        if result_id and result_id > 0:
            return True, str(result_id)
        return False, ''
    except Exception as e:
        tv_hunt_logger.debug("NZBGet send error: %s", e)
        return False, ''


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
        """Get detailed TV series info from TMDB including seasons."""
        try:
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
            return jsonify(r.json()), 200
        except Exception as e:
            logger.exception('TV Hunt series detail error')
            return jsonify({'error': str(e)}), 500
    
    
    @bp.route('/api/tv-hunt/series/<int:tmdb_id>/season/<int:season_number>', methods=['GET'])
    def api_tv_hunt_season_detail(tmdb_id, season_number):
        """Get detailed season info from TMDB including all episodes."""
        try:
            params = {
                'api_key': TMDB_API_KEY,
                'language': 'en-US',
            }
            from src.primary.settings_manager import get_ssl_verify_setting
            verify_ssl = get_ssl_verify_setting()
            r = requests.get(f'{TMDB_BASE}/tv/{tmdb_id}/season/{season_number}', params=params, timeout=15, verify=verify_ssl)
            if r.status_code != 200:
                return jsonify({'error': 'Season not found'}), 404
            return jsonify(r.json()), 200
        except Exception as e:
            logger.exception('TV Hunt season detail error')
            return jsonify({'error': str(e)}), 500
    
    
    # ── Collection CRUD ──
    
    @bp.route('/api/tv-hunt/collection', methods=['GET'])
    def api_tv_hunt_collection_get():
        """Get the TV series collection for the current instance."""
        try:
            instance_id = _get_tv_hunt_instance_id_from_request()
            if not instance_id:
                return jsonify({'series': []}), 200
            series = _get_collection_config(instance_id)
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
            tvdb_id = data.get('tvdb_id') or data.get('tmdb_id')
            root_folder = data.get('root_folder')
            quality_profile = data.get('quality_profile')
            search_type = data.get('search_type', 'episode')
            
            if search_type == 'monitored':
                collection = _get_collection_config(instance_id)
                
                # Robust ID and title matching
                series = None
                search_tmdb_id = None
                try:
                    if tvdb_id is not None:
                        search_tmdb_id = int(tvdb_id)
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
