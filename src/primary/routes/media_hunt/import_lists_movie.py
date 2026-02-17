"""Import Lists routes for Movie Hunt — CRUD, sync, and OAuth."""

import os
import time
import uuid
import threading
from flask import request, jsonify

from .helpers import _get_movie_hunt_instance_id_from_request, movie_hunt_logger
from .discovery_movie import (
    _get_collection_config, _save_collection_config, _collection_append,
    _get_tmdb_api_key_movie_hunt
)

logger = movie_hunt_logger

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

LIST_TYPES = [
    'imdb', 'tmdb', 'trakt', 'rss', 'stevenlu', 'plex', 'custom_json'
]

SYNC_INTERVAL_OPTIONS = [1, 3, 6, 12, 24, 48, 72, 168]  # hours


def _get_import_lists(instance_id):
    """Return list of import list configs for an instance."""
    from src.primary.utils.database import get_database
    db = get_database()
    config = db.get_app_config_for_instance('movie_hunt_import_lists', instance_id)
    if not config or not isinstance(config.get('lists'), list):
        return []
    return config['lists']


def _save_import_lists(lists, instance_id):
    """Persist import lists for an instance."""
    from src.primary.utils.database import get_database
    db = get_database()
    db.save_app_config_for_instance('movie_hunt_import_lists', instance_id, {'lists': lists})


def _find_list_by_id(lists, list_id):
    """Find a list dict and its index by id. Returns (index, dict) or (None, None)."""
    for i, lst in enumerate(lists):
        if lst.get('id') == list_id:
            return i, lst
    return None, None


def _build_default_list(list_type, name=None):
    """Return a new list dict with defaults."""
    return {
        'id': str(uuid.uuid4()),
        'name': name or '',
        'type': list_type,
        'enabled': True,
        'auto_add': False,
        'sync_interval_hours': 12,
        'last_sync': None,
        'last_sync_count': 0,
        'last_error': None,
        'settings': _default_settings_for_type(list_type),
    }


def _default_settings_for_type(list_type):
    """Return default type-specific settings."""
    if list_type == 'imdb':
        return {'list_type': 'top_250', 'list_id': ''}
    elif list_type == 'tmdb':
        return {'list_type': 'popular', 'list_id': '', 'keyword_id': '', 'company_id': '', 'person_id': ''}
    elif list_type == 'trakt':
        return {
            'list_type': 'popular',
            'username': '', 'list_name': '',
            'access_token': '', 'refresh_token': '', 'expires_at': 0,
            'years': '', 'additional_parameters': '',
            'limit': 5000,
        }
    elif list_type == 'rss':
        return {'url': ''}
    elif list_type == 'stevenlu':
        return {'url': 'https://popular-movies-data.stevenlu.com/movies.json'}
    elif list_type == 'plex':
        return {'access_token': ''}
    elif list_type == 'custom_json':
        return {'url': ''}
    return {}


# ---------------------------------------------------------------------------
# Sync engine (module-level for background.py import)
# ---------------------------------------------------------------------------

def _run_sync(list_config, instance_id):
    """Fetch movies from a list and add new ones to the collection. Returns result dict."""
    from src.primary.apps.movie_hunt.list_fetchers import fetch_list

    list_type = list_config.get('type', '')
    list_name = list_config.get('name', list_type)
    settings = list_config.get('settings') or {}
    auto_add = list_config.get('auto_add', False)

    logger.info("Syncing import list: %s (%s) [auto_add=%s]", list_name, list_type, auto_add)

    try:
        movies = fetch_list(list_type, settings)
    except Exception as e:
        logger.error("Failed to fetch list %s: %s", list_name, e)
        return {'added': 0, 'skipped': 0, 'total': 0, 'error': str(e)}

    if not movies:
        logger.info("No movies returned from list: %s", list_name)
        return {'added': 0, 'skipped': 0, 'total': len(movies) if movies else 0, 'error': None}

    # If auto_add is disabled, sync succeeds but nothing is added to the library
    if not auto_add:
        logger.info("Import list %s: auto-add disabled, %d items fetched but not added", list_name, len(movies))
        return {'added': 0, 'skipped': len(movies), 'total': len(movies), 'error': None}

    # Get existing collection to check for dupes
    collection = _get_collection_config(instance_id)
    existing_tmdb_ids = set()
    existing_title_years = set()
    for item in collection:
        if not isinstance(item, dict):
            continue
        tmdb_id = item.get('tmdb_id')
        if tmdb_id:
            try:
                existing_tmdb_ids.add(int(tmdb_id))
            except (TypeError, ValueError):
                pass
        title = (item.get('title') or '').strip().lower()
        year = str(item.get('year') or '').strip()
        if title:
            existing_title_years.add((title, year))

    added = 0
    skipped = 0
    for movie in movies:
        tmdb_id = movie.get('tmdb_id')
        title = (movie.get('title') or '').strip()
        year = str(movie.get('year') or '').strip()

        # Skip if already in collection
        if tmdb_id and int(tmdb_id) in existing_tmdb_ids:
            skipped += 1
            continue
        if title and (title.lower(), year) in existing_title_years:
            skipped += 1
            continue

        # Get default root folder for this instance (Media Hunt)
        from src.primary.routes.media_hunt import root_folders as mh_rf
        root_folders = mh_rf.get_root_folders_config(instance_id, 'movie_hunt_root_folders')
        default_rf = ''
        for rf in root_folders:
            if rf.get('is_default'):
                default_rf = rf.get('path', '')
                break
        if not default_rf and root_folders:
            default_rf = root_folders[0].get('path', '')

        _collection_append(
            title=title,
            year=year,
            instance_id=instance_id,
            tmdb_id=tmdb_id,
            poster_path=movie.get('poster_path', ''),
            root_folder=default_rf,
        )

        # Track to avoid dupes within same sync
        if tmdb_id:
            existing_tmdb_ids.add(int(tmdb_id))
        if title:
            existing_title_years.add((title.lower(), year))

        added += 1

    logger.info("Import list %s sync complete: %d added, %d skipped, %d total",
                list_name, added, skipped, len(movies))

    return {'added': added, 'skipped': skipped, 'total': len(movies), 'error': None}


def run_import_list_sync_cycle():
    """Check all instances for import lists due for sync. Called periodically from background.
    Skips disabled Movie Hunt instances (same as main hunt cycle)."""
    from src.primary.utils.database import get_database
    from .instances import _get_movie_hunt_instance_settings
    db = get_database()

    try:
        instance_list = db.get_movie_hunt_instances()
    except Exception:
        instance_list = []

    now = time.time()

    for inst in instance_list:
        inst_id = inst.get('id', 0)
        settings = _get_movie_hunt_instance_settings(inst_id)
        if not settings.get("enabled", True):
            continue
        lists = _get_import_lists(inst_id)
        changed = False

        for i, lst in enumerate(lists):
            if not lst.get('enabled', True):
                continue

            interval_sec = lst.get('sync_interval_hours', 12) * 3600
            last_sync = lst.get('last_sync') or 0

            if now - last_sync < interval_sec:
                continue

            logger.info("Auto-sync import list: %s (instance %s)", lst.get('name', '?'), inst_id)
            result = _run_sync(lst, inst_id)
            lst['last_sync'] = now
            lst['last_sync_count'] = result.get('added', 0)
            lst['last_error'] = result.get('error')
            lists[i] = lst
            changed = True

        if changed:
            _save_import_lists(lists, inst_id)


# ---------------------------------------------------------------------------
# CRUD routes
# ---------------------------------------------------------------------------

def register_movie_import_lists_routes(bp):
    @bp.route('/api/movie-hunt/import-lists', methods=['GET'])
    def get_import_lists():
        """List all import lists for the current instance."""
        instance_id = _get_movie_hunt_instance_id_from_request()
        lists = _get_import_lists(instance_id)
        # Sanitise: strip tokens from response
        safe = []
        for lst in lists:
            s = dict(lst)
            settings = dict(s.get('settings') or {})
            for key in ('access_token', 'refresh_token', 'client_secret'):
                if key in settings and settings[key]:
                    settings[key] = '••••••••'
            s['settings'] = settings
            safe.append(s)
        return jsonify({'success': True, 'lists': safe})
    
    
    @bp.route('/api/movie-hunt/import-lists', methods=['POST'])
    def add_import_list():
        """Create a new import list."""
        instance_id = _get_movie_hunt_instance_id_from_request()
        data = request.get_json(force=True) or {}
        list_type = data.get('type', '').strip()
        if list_type not in LIST_TYPES:
            return jsonify({'success': False, 'error': f'Invalid list type: {list_type}'}), 400
    
        name = (data.get('name') or '').strip()
        if not name:
            return jsonify({'success': False, 'error': 'Name is required'}), 400
    
        new_list = _build_default_list(list_type, name)
        # Merge any provided settings
        if 'settings' in data and isinstance(data['settings'], dict):
            new_list['settings'].update(data['settings'])
        if 'sync_interval_hours' in data:
            try:
                new_list['sync_interval_hours'] = int(data['sync_interval_hours'])
            except (TypeError, ValueError):
                pass
        if 'enabled' in data:
            new_list['enabled'] = bool(data['enabled'])
        if 'auto_add' in data:
            new_list['auto_add'] = bool(data['auto_add'])
    
        lists = _get_import_lists(instance_id)
        lists.append(new_list)
        _save_import_lists(lists, instance_id)
    
        logger.info("Import list created: %s (%s) for instance %s", name, list_type, instance_id)
        return jsonify({'success': True, 'list': new_list}), 201
    
    
    @bp.route('/api/movie-hunt/import-lists/<list_id>', methods=['PUT'])
    def update_import_list(list_id):
        """Update an existing import list."""
        instance_id = _get_movie_hunt_instance_id_from_request()
        data = request.get_json(force=True) or {}
    
        lists = _get_import_lists(instance_id)
        idx, existing = _find_list_by_id(lists, list_id)
        if existing is None:
            return jsonify({'success': False, 'error': 'List not found'}), 404
    
        # Update allowed fields
        for field in ('name', 'enabled', 'auto_add', 'sync_interval_hours'):
            if field in data:
                existing[field] = data[field]
    
        if 'settings' in data and isinstance(data['settings'], dict):
            merged = dict(existing.get('settings') or {})
            for k, v in data['settings'].items():
                # Don't overwrite tokens with masked values
                if k in ('access_token', 'refresh_token', 'client_secret') and v == '••••••••':
                    continue
                merged[k] = v
            existing['settings'] = merged
    
        lists[idx] = existing
        _save_import_lists(lists, instance_id)
    
        logger.info("Import list updated: %s for instance %s", list_id, instance_id)
        return jsonify({'success': True, 'list': existing})
    
    
    @bp.route('/api/movie-hunt/import-lists/<list_id>', methods=['DELETE'])
    def delete_import_list(list_id):
        """Delete an import list."""
        instance_id = _get_movie_hunt_instance_id_from_request()
        lists = _get_import_lists(instance_id)
        idx, existing = _find_list_by_id(lists, list_id)
        if existing is None:
            return jsonify({'success': False, 'error': 'List not found'}), 404
    
        lists.pop(idx)
        _save_import_lists(lists, instance_id)
    
        logger.info("Import list deleted: %s for instance %s", list_id, instance_id)
        return jsonify({'success': True})
    
    
    @bp.route('/api/movie-hunt/import-lists/<list_id>/toggle', methods=['POST'])
    def toggle_import_list(list_id):
        """Toggle enabled/disabled."""
        instance_id = _get_movie_hunt_instance_id_from_request()
        lists = _get_import_lists(instance_id)
        idx, existing = _find_list_by_id(lists, list_id)
        if existing is None:
            return jsonify({'success': False, 'error': 'List not found'}), 404
    
        existing['enabled'] = not existing.get('enabled', True)
        lists[idx] = existing
        _save_import_lists(lists, instance_id)
    
        return jsonify({'success': True, 'enabled': existing['enabled']})
    
    
    # ---------------------------------------------------------------------------
    # Sync routes
    # ---------------------------------------------------------------------------
    
    @bp.route('/api/movie-hunt/import-lists/<list_id>/sync', methods=['POST'])
    def sync_import_list(list_id):
        """Manually sync a single import list."""
        instance_id = _get_movie_hunt_instance_id_from_request()
        lists = _get_import_lists(instance_id)
        idx, existing = _find_list_by_id(lists, list_id)
        if existing is None:
            return jsonify({'success': False, 'error': 'List not found'}), 404
    
        result = _run_sync(existing, instance_id)
    
        # Update sync metadata
        existing['last_sync'] = time.time()
        existing['last_sync_count'] = result.get('added', 0)
        existing['last_error'] = result.get('error')
        lists[idx] = existing
        _save_import_lists(lists, instance_id)
    
        return jsonify({'success': True, 'result': result})
    
    
    @bp.route('/api/movie-hunt/import-lists/sync-all', methods=['POST'])
    def sync_all_import_lists():
        """Sync all enabled import lists."""
        instance_id = _get_movie_hunt_instance_id_from_request()
        lists = _get_import_lists(instance_id)
        results = {}
    
        for i, lst in enumerate(lists):
            if not lst.get('enabled', True):
                continue
            result = _run_sync(lst, instance_id)
            lst['last_sync'] = time.time()
            lst['last_sync_count'] = result.get('added', 0)
            lst['last_error'] = result.get('error')
            lists[i] = lst
            results[lst['id']] = result
    
        _save_import_lists(lists, instance_id)
        return jsonify({'success': True, 'results': results})
    
    
    @bp.route('/api/movie-hunt/import-lists/types', methods=['GET'])
    def get_list_types():
        """Return available list types and their metadata."""
        types = [
            {'id': 'imdb', 'name': 'IMDb', 'icon': 'fab fa-imdb',
             'subtypes': [
                 {'id': 'top_250', 'name': 'IMDb Top 250'},
                 {'id': 'popular', 'name': 'IMDb Popular Movies'},
                 {'id': 'custom', 'name': 'IMDb List (by ID)'},
             ]},
            {'id': 'tmdb', 'name': 'TMDb', 'icon': 'fas fa-film',
             'subtypes': [
                 {'id': 'popular', 'name': 'Popular Movies'},
                 {'id': 'top_rated', 'name': 'Top Rated'},
                 {'id': 'now_playing', 'name': 'Now Playing'},
                 {'id': 'upcoming', 'name': 'Upcoming'},
                 {'id': 'list', 'name': 'TMDb List (by ID)'},
                 {'id': 'keyword', 'name': 'By Keyword'},
                 {'id': 'company', 'name': 'By Company'},
                 {'id': 'person', 'name': 'By Person'},
             ]},
            {'id': 'trakt', 'name': 'Trakt', 'icon': 'fas fa-play-circle',
             'subtypes': [
                 {'id': 'popular', 'name': 'Popular'},
                 {'id': 'trending', 'name': 'Trending'},
                 {'id': 'watchlist', 'name': 'Watchlist'},
                 {'id': 'custom', 'name': 'Custom List'},
             ],
             'requires_oauth': True},
            {'id': 'plex', 'name': 'Plex Watchlist', 'icon': 'fas fa-tv',
             'subtypes': [],
             'requires_oauth': True},
            {'id': 'rss', 'name': 'RSS Feed', 'icon': 'fas fa-rss',
             'subtypes': []},
            {'id': 'stevenlu', 'name': 'StevenLu Popular', 'icon': 'fas fa-chart-line',
             'subtypes': []},
            {'id': 'custom_json', 'name': 'Custom JSON', 'icon': 'fas fa-code',
             'subtypes': []},
        ]
        return jsonify({'success': True, 'types': types})
    
    
    # ---------------------------------------------------------------------------
    # Trakt OAuth — embedded app credentials (device code flow)
    # ---------------------------------------------------------------------------
    
    # Huntarr's registered Trakt application credentials.
    # Override with environment variables if needed.
    TRAKT_CLIENT_ID = os.environ.get(
        'TRAKT_CLIENT_ID',
        '9ee2169e48c064874e7591ab76e0e26ae49a22d4b1dcb893076b46cf634a769e'
    )
    TRAKT_CLIENT_SECRET = os.environ.get(
        'TRAKT_CLIENT_SECRET',
        '65ad5c1b292586f6d453a15c918afe32b574de417aa4c01c1ccddb0ea2808df3'
    )
    
    
    def _get_trakt_credentials():
        """Return (client_id, client_secret) — embedded or from env."""
        return TRAKT_CLIENT_ID, TRAKT_CLIENT_SECRET
    
    
    @bp.route('/api/movie-hunt/import-lists/trakt/device-code', methods=['POST'])
    def trakt_device_code():
        """Initiate Trakt device code OAuth flow. Returns user_code and verification_url."""
        import requests as req
        client_id, _ = _get_trakt_credentials()
    
        try:
            resp = req.post('https://api.trakt.tv/oauth/device/code', json={
                'client_id': client_id,
            }, headers={'Content-Type': 'application/json'}, timeout=15)
    
            if resp.status_code != 200:
                return jsonify({'success': False, 'error': f'Trakt returned {resp.status_code}: {resp.text[:200]}'}), 400
    
            body = resp.json()
            return jsonify({
                'success': True,
                'device_code': body.get('device_code', ''),
                'user_code': body.get('user_code', ''),
                'verification_url': body.get('verification_url', 'https://trakt.tv/activate'),
                'expires_in': body.get('expires_in', 600),
                'interval': body.get('interval', 5),
            })
        except Exception as e:
            logger.error("Trakt device code request failed: %s", e)
            return jsonify({'success': False, 'error': str(e)}), 500
    
    
    @bp.route('/api/movie-hunt/import-lists/trakt/device-token', methods=['POST'])
    def trakt_device_token():
        """Poll for Trakt device token after user authorizes."""
        import requests as req
        data = request.get_json(force=True) or {}
        device_code = (data.get('device_code') or '').strip()
        if not device_code:
            return jsonify({'success': False, 'error': 'device_code is required'}), 400
    
        client_id, client_secret = _get_trakt_credentials()
    
        try:
            resp = req.post('https://api.trakt.tv/oauth/device/token', json={
                'code': device_code,
                'client_id': client_id,
                'client_secret': client_secret,
            }, headers={'Content-Type': 'application/json'}, timeout=15)
    
            if resp.status_code == 200:
                tokens = resp.json()
                return jsonify({
                    'success': True,
                    'access_token': tokens.get('access_token', ''),
                    'refresh_token': tokens.get('refresh_token', ''),
                    'expires_at': int(time.time()) + tokens.get('expires_in', 7776000),
                })
            elif resp.status_code == 400:
                return jsonify({'success': False, 'pending': True, 'error': 'Authorization pending'}), 200
            elif resp.status_code == 404:
                return jsonify({'success': False, 'error': 'Invalid device code'}), 400
            elif resp.status_code == 409:
                return jsonify({'success': False, 'error': 'Code already approved'}), 400
            elif resp.status_code == 410:
                return jsonify({'success': False, 'error': 'Code expired — try again'}), 400
            elif resp.status_code == 418:
                return jsonify({'success': False, 'error': 'User denied authorization'}), 400
            elif resp.status_code == 429:
                return jsonify({'success': False, 'pending': True, 'error': 'Slow down'}), 200
            else:
                return jsonify({'success': False, 'error': f'Trakt returned {resp.status_code}'}), 400
    
        except Exception as e:
            logger.error("Trakt device token poll failed: %s", e)
            return jsonify({'success': False, 'error': str(e)}), 500
    
    
    # ---------------------------------------------------------------------------
    # Plex OAuth — PIN-based flow for Import Lists
    # ---------------------------------------------------------------------------
    
    @bp.route('/api/movie-hunt/import-lists/plex/pin', methods=['POST'])
    def plex_create_pin():
        """Create a Plex PIN for import list authentication (no redirect)."""
        import requests as req
    
        from src.primary.auth import get_client_identifier, PLEX_PRODUCT_NAME
    
        client_id = get_client_identifier()
    
        headers = {
            'accept': 'application/json',
            'X-Plex-Client-Identifier': client_id,
        }
        data = {
            'strong': 'true',
            'X-Plex-Product': PLEX_PRODUCT_NAME,
            'X-Plex-Client-Identifier': client_id,
        }
    
        try:
            resp = req.post('https://plex.tv/api/v2/pins', headers=headers, data=data, timeout=15)
            resp.raise_for_status()
            pin_data = resp.json()
    
            pin_id = pin_data['id']
            pin_code = pin_data['code']
    
            # Build auth URL (no forwardUrl — user stays on Huntarr and we poll)
            auth_url = (
                f"https://app.plex.tv/auth#?clientID={client_id}"
                f"&code={pin_code}"
                f"&context%5Bdevice%5D%5Bproduct%5D={PLEX_PRODUCT_NAME}"
            )
    
            return jsonify({
                'success': True,
                'pin_id': pin_id,
                'pin_code': pin_code,
                'auth_url': auth_url,
            })
        except Exception as e:
            logger.error("Plex PIN creation failed: %s", e)
            return jsonify({'success': False, 'error': str(e)}), 500
    
    
    @bp.route('/api/movie-hunt/import-lists/plex/check/<int:pin_id>', methods=['GET'])
    def plex_check_pin(pin_id):
        """Poll whether Plex PIN has been claimed. Returns token if yes."""
        import requests as req
    
        from src.primary.auth import get_client_identifier
    
        client_id = get_client_identifier()
    
        headers = {
            'accept': 'application/json',
            'X-Plex-Client-Identifier': client_id,
        }
    
        try:
            resp = req.get(
                f'https://plex.tv/api/v2/pins/{pin_id}',
                headers=headers,
                params={'code': ''},
                timeout=15,
            )
            resp.raise_for_status()
            result = resp.json()
            auth_token = result.get('authToken')
    
            if auth_token:
                return jsonify({'success': True, 'claimed': True, 'token': auth_token})
            else:
                return jsonify({'success': True, 'claimed': False})
        except Exception as e:
            logger.error("Plex PIN check failed: %s", e)
            return jsonify({'success': False, 'error': str(e)}), 500
    
    
    # ---------------------------------------------------------------------------
    # Sync engine (uses module-level _run_sync)
    # ---------------------------------------------------------------------------
