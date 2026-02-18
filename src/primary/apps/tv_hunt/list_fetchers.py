"""
TV Import List Fetchers — fetch TV shows from various external sources.
Each fetcher returns a list of dicts:
  [{'title': str, 'year': str, 'tmdb_id': int|None, 'poster_path': str}]
"""

import os
import time
import requests
from src.primary.utils.logger import get_logger

logger = get_logger("tv_import_lists")

TMDB_API_KEY = "9265b0bd0cd1962f7f3225989fcd7192"
TMDB_BASE = "https://api.themoviedb.org/3"
REQUEST_TIMEOUT = 20

# Trakt embedded credentials (shared with Movie Hunt OAuth)
TRAKT_CLIENT_ID = os.environ.get(
    'TRAKT_CLIENT_ID',
    '9ee2169e48c064874e7591ab76e0e26ae49a22d4b1dcb893076b46cf634a769e'
)


def fetch_tv_list(list_type, settings):
    """Dispatch to the correct TV fetcher. Returns list of show dicts."""
    fetchers = {
        'trakt': _fetch_trakt_tv,
        'plex': _fetch_plex_tv,
        'custom_json': _fetch_custom_json_tv,
        'imdb': _fetch_imdb_tv,
        'simkl': _fetch_simkl_tv,
        'anilist': _fetch_anilist_tv,
        'myanimelist': _fetch_myanimelist_tv,
    }
    fn = fetchers.get(list_type)
    if not fn:
        raise ValueError(f"Unknown TV list type: {list_type}")
    return fn(settings)


# ---------------------------------------------------------------------------
# TMDb TV helpers
# ---------------------------------------------------------------------------

def _search_tmdb_tv(title, year=None):
    """Search TMDb for a TV series by title. Cached 1h (server-side)."""
    if not title:
        return None
    try:
        from src.primary.utils.tmdb_metadata_cache import get_search, set_search

        cache_key = f"{title}:y{year or ''}"
        data = get_search('tv', cache_key)
        if data is None:
            params = {'api_key': TMDB_API_KEY, 'query': title}
            if year:
                params['first_air_date_year'] = year
            resp = requests.get(f"{TMDB_BASE}/search/tv", params=params, timeout=REQUEST_TIMEOUT)
            if resp.status_code != 200:
                return None
            data = resp.json()
            set_search('tv', cache_key, data)
        results = data.get('results', [])
        if results:
            s = results[0]
            return {
                'title': s.get('name', ''),
                'year': (s.get('first_air_date') or '')[:4],
                'tmdb_id': s.get('id'),
                'poster_path': s.get('poster_path') or '',
            }
    except Exception as e:
        logger.debug("TMDb TV search failed for '%s': %s", title, e)
    return None


def _tmdb_tv_details(tmdb_id):
    """Get TMDb TV series details by ID. Uses server-side cache when available."""
    if not tmdb_id:
        return None
    try:
        from src.primary.utils.tmdb_metadata_cache import get

        cached = get('tv', tmdb_id)
        if cached is not None:
            return {
                'title': cached.get('name', ''),
                'year': (cached.get('first_air_date') or '')[:4],
                'tmdb_id': cached.get('id'),
                'poster_path': cached.get('poster_path') or '',
            }

        resp = requests.get(
            f"{TMDB_BASE}/tv/{tmdb_id}",
            params={'api_key': TMDB_API_KEY},
            timeout=REQUEST_TIMEOUT
        )
        if resp.status_code != 200:
            return None
        s = resp.json()
        return {
            'title': s.get('name', ''),
            'year': (s.get('first_air_date') or '')[:4],
            'tmdb_id': s.get('id'),
            'poster_path': s.get('poster_path') or '',
        }
    except Exception as e:
        logger.debug("TMDb TV detail failed for %s: %s", tmdb_id, e)
    return None


def _resolve_imdb_to_tmdb_tv(imdb_id):
    """Resolve an IMDb ID to a TMDb TV series. Cached 24h (server-side)."""
    if not imdb_id:
        return None
    try:
        from src.primary.utils.tmdb_metadata_cache import get_find, set_find

        cached = get_find('imdb_tv', imdb_id)
        if cached is not None:
            return cached

        resp = requests.get(
            f"{TMDB_BASE}/find/{imdb_id}",
            params={'api_key': TMDB_API_KEY, 'external_source': 'imdb_id'},
            timeout=REQUEST_TIMEOUT
        )
        if resp.status_code != 200:
            return None
        data = resp.json()
        results = data.get('tv_results', [])
        if results:
            s = results[0]
            result = {
                'title': s.get('name', ''),
                'year': (s.get('first_air_date') or '')[:4],
                'tmdb_id': s.get('id'),
                'poster_path': s.get('poster_path') or '',
            }
            set_find('imdb_tv', imdb_id, result)
            return result
    except Exception as e:
        logger.debug("IMDb->TMDb TV resolve failed for %s: %s", imdb_id, e)
    return None


# ---------------------------------------------------------------------------
# Trakt TV
# ---------------------------------------------------------------------------

# Trakt popular list type -> API endpoint mapping
_TRAKT_POPULAR_ENDPOINTS = {
    'trending': '/shows/trending',
    'popular': '/shows/popular',
    'anticipated': '/shows/anticipated',
    'top_watched_week': '/shows/watched/weekly',
    'top_watched_month': '/shows/watched/monthly',
    'top_watched_alltime': '/shows/watched/all',
    'recommended_week': '/shows/recommended/weekly',
    'recommended_month': '/shows/recommended/monthly',
    'recommended_alltime': '/shows/recommended/all',
}

# Trakt user list type -> API path template
_TRAKT_USER_ENDPOINTS = {
    'watchlist': '/users/{user}/watchlist/shows',
    'watched': '/users/{user}/watched/shows',
    'collection': '/users/{user}/collection/shows',
}


def _fetch_trakt_tv(settings):
    """Fetch TV shows from Trakt."""
    list_type = settings.get('list_type', 'popular')
    access_token = settings.get('access_token', '')

    headers = {
        'Content-Type': 'application/json',
        'trakt-api-version': '2',
        'trakt-api-key': TRAKT_CLIENT_ID,
    }
    if access_token:
        headers['Authorization'] = f'Bearer {access_token}'

    shows = []
    limit = min(int(settings.get('limit', 100)), 500)

    try:
        # Popular-style endpoints (no auth required)
        if list_type in _TRAKT_POPULAR_ENDPOINTS:
            path = _TRAKT_POPULAR_ENDPOINTS[list_type]
            url = f'https://api.trakt.tv{path}'
            resp = requests.get(url, headers=headers,
                                params={'limit': limit, 'extended': 'full'},
                                timeout=REQUEST_TIMEOUT)

        # User endpoints (auth required for private data)
        elif list_type in _TRAKT_USER_ENDPOINTS:
            if list_type == 'watchlist' and not access_token:
                raise ValueError("Trakt OAuth is required for Watchlist")
            username = (settings.get('username') or 'me').strip()
            path = _TRAKT_USER_ENDPOINTS[list_type].format(user=username)
            url = f'https://api.trakt.tv{path}'
            resp = requests.get(url, headers=headers,
                                params={'extended': 'full'},
                                timeout=REQUEST_TIMEOUT)

        # Custom list
        elif list_type == 'custom':
            username = (settings.get('username') or '').strip()
            list_name = (settings.get('list_name') or '').strip()
            if not username or not list_name:
                raise ValueError("Trakt username and list name are required for custom lists")
            list_slug = list_name.lower().replace(' ', '-')
            url = f'https://api.trakt.tv/users/{username}/lists/{list_slug}/items/shows'
            resp = requests.get(url, headers=headers,
                                params={'extended': 'full'},
                                timeout=REQUEST_TIMEOUT)
        else:
            raise ValueError(f"Unknown Trakt TV list type: {list_type}")

        if resp.status_code != 200:
            raise ValueError(f"Trakt API returned {resp.status_code}: {resp.text[:200]}")

        data = resp.json()
        for item in data:
            show = item.get('show', item)
            ids = show.get('ids', {})
            tmdb_id = ids.get('tmdb')
            title = show.get('title', '')
            year = str(show.get('year') or '')

            entry = {
                'title': title,
                'year': year,
                'tmdb_id': tmdb_id,
                'poster_path': '',
            }

            if tmdb_id:
                detail = _tmdb_tv_details(tmdb_id)
                if detail:
                    entry['poster_path'] = detail.get('poster_path', '')
                time.sleep(0.1)

            shows.append(entry)

    except requests.RequestException as e:
        logger.error("Trakt TV fetch failed: %s", e)
        raise
    except ValueError:
        raise

    return shows


# ---------------------------------------------------------------------------
# Plex Watchlist (TV)
# ---------------------------------------------------------------------------

def _fetch_plex_tv(settings):
    """Fetch TV shows from Plex Watchlist."""
    access_token = settings.get('access_token', '')
    if not access_token:
        raise ValueError("Plex authentication is required. Please sign in with Plex.")

    try:
        from src.primary.auth import get_client_identifier
        client_id = get_client_identifier()
    except Exception:
        client_id = 'huntarr-import-lists'

    shows = []
    try:
        headers = {
            'X-Plex-Token': access_token,
            'X-Plex-Client-Identifier': client_id,
            'X-Plex-Product': 'Huntarr',
            'Accept': 'application/json',
        }

        # type=2 for TV shows (type=1 is movies)
        params = {
            'type': '2',
            'includeGuids': '1',
            'includeFields': 'title,year,type',
            'sort': 'watchlistedAt:desc',
        }

        endpoints = [
            'https://discover.provider.plex.tv/library/sections/watchlist/all',
            'https://metadata.provider.plex.tv/library/sections/watchlist/all',
        ]

        resp = None
        for url in endpoints:
            try:
                resp = requests.get(url, headers=headers, params=params, timeout=REQUEST_TIMEOUT)
                if resp.status_code == 200:
                    break
                logger.debug("Plex endpoint %s returned %d, trying next...", url, resp.status_code)
            except Exception as ep_err:
                logger.debug("Plex endpoint %s failed: %s", url, ep_err)
                continue

        if resp is None or resp.status_code == 401:
            raise ValueError("Plex token expired or invalid. Please re-authenticate.")
        if resp.status_code != 200:
            raise ValueError(f"Plex API returned {resp.status_code}")

        data = resp.json()
        metadata = data.get('MediaContainer', {}).get('Metadata', [])

        for item in metadata:
            if item.get('type') != 'show':
                continue
            title = item.get('title', '')
            year = str(item.get('year', ''))

            tmdb_id = None
            imdb_id = None
            guids = item.get('Guid', [])
            for g in guids:
                gid = g.get('id', '')
                if 'tmdb://' in gid:
                    try:
                        tmdb_id = int(gid.replace('tmdb://', ''))
                    except (TypeError, ValueError):
                        pass
                elif 'imdb://' in gid:
                    imdb_id = gid.replace('imdb://', '')

            entry = {
                'title': title,
                'year': year,
                'tmdb_id': tmdb_id,
                'poster_path': '',
            }

            if tmdb_id:
                detail = _tmdb_tv_details(tmdb_id)
                if detail:
                    entry['poster_path'] = detail.get('poster_path', '')
            elif imdb_id:
                resolved = _resolve_imdb_to_tmdb_tv(imdb_id)
                if resolved:
                    entry.update(resolved)
            elif title:
                resolved = _search_tmdb_tv(title, year)
                if resolved:
                    entry.update(resolved)

            shows.append(entry)
            time.sleep(0.1)

    except ValueError:
        raise
    except Exception as e:
        logger.error("Plex TV watchlist fetch failed: %s", e)
        raise

    return shows


# ---------------------------------------------------------------------------
# Custom JSON (TV)
# ---------------------------------------------------------------------------

def _fetch_custom_json_tv(settings):
    """Fetch TV shows from a custom JSON URL."""
    url = (settings.get('url') or '').strip()
    if not url:
        raise ValueError("Custom JSON URL is required")

    shows = []
    try:
        resp = requests.get(url, timeout=REQUEST_TIMEOUT, headers={
            'User-Agent': 'Huntarr/1.0 (TV Import Lists)',
            'Accept': 'application/json',
        })
        if resp.status_code != 200:
            raise ValueError(f"Custom JSON URL returned {resp.status_code}")

        data = resp.json()
        if not isinstance(data, list):
            raise ValueError("Expected JSON array of TV show objects")

        for item in data:
            if not isinstance(item, dict):
                continue

            title = (item.get('title') or item.get('Title') or
                     item.get('name') or item.get('Name') or '').strip()
            year = str(item.get('year') or item.get('Year') or '').strip()
            tmdb_id = item.get('tmdb_id') or item.get('tmdbId') or item.get('TmdbId')
            imdb_id = (item.get('imdb_id') or item.get('imdbId') or item.get('ImdbId') or '').strip()

            if not title and not tmdb_id and not imdb_id:
                continue

            entry = {
                'title': title,
                'year': year,
                'tmdb_id': int(tmdb_id) if tmdb_id else None,
                'poster_path': '',
            }

            if entry['tmdb_id']:
                detail = _tmdb_tv_details(entry['tmdb_id'])
                if detail:
                    if not entry['title']:
                        entry['title'] = detail.get('title', '')
                    if not entry['year']:
                        entry['year'] = detail.get('year', '')
                    entry['poster_path'] = detail.get('poster_path', '')
            elif imdb_id:
                resolved = _resolve_imdb_to_tmdb_tv(imdb_id)
                if resolved:
                    entry.update(resolved)
            elif title:
                resolved = _search_tmdb_tv(title, year)
                if resolved:
                    entry.update(resolved)

            shows.append(entry)
            time.sleep(0.1)

    except ValueError:
        raise
    except Exception as e:
        logger.error("Custom JSON TV fetch failed: %s", e)
        raise

    return shows


# ---------------------------------------------------------------------------
# IMDb (TV series from custom list)
# ---------------------------------------------------------------------------

def _fetch_imdb_tv(settings):
    """Fetch TV shows from an IMDb list by list ID (e.g. ls123456789)."""
    import re
    list_id = (settings.get('list_id') or '').strip()
    if not list_id:
        raise ValueError("IMDb List ID is required (e.g. ls123456789)")

    if not list_id.startswith('ls'):
        list_id = 'ls' + list_id

    shows = []
    try:
        url = f"https://www.imdb.com/list/{list_id}/"
        resp = requests.get(url, timeout=REQUEST_TIMEOUT, headers={
            'User-Agent': 'Mozilla/5.0 (compatible; Huntarr/1.0)'
        })
        if resp.status_code != 200:
            raise ValueError(f"IMDb list returned {resp.status_code}")

        imdb_ids = re.findall(r'(tt\d{7,10})', resp.text)
        seen = set()
        for iid in imdb_ids:
            if iid in seen:
                continue
            seen.add(iid)
            resolved = _resolve_imdb_to_tmdb_tv(iid)
            if resolved:
                shows.append(resolved)
            time.sleep(0.15)

    except ValueError:
        raise
    except Exception as e:
        logger.error("IMDb TV list fetch failed for %s: %s", list_id, e)
        raise

    return shows


# ---------------------------------------------------------------------------
# Simkl
# ---------------------------------------------------------------------------

def _fetch_simkl_tv(settings):
    """Fetch TV shows from Simkl user lists."""
    list_type = settings.get('list_type', 'watching')
    access_token = settings.get('access_token', '')

    simkl_status_map = {
        'watching': 'watching',
        'plantowatch': 'plantowatch',
        'hold': 'hold',
        'completed': 'completed',
        'dropped': 'dropped',
    }
    status = simkl_status_map.get(list_type, 'watching')

    headers = {
        'Content-Type': 'application/json',
        'simkl-api-key': 'a756ee57e85cbda1286261bdf06',
    }
    if access_token:
        headers['Authorization'] = f'Bearer {access_token}'

    shows = []
    try:
        url = f'https://api.simkl.com/sync/all-items/shows/{status}'
        resp = requests.get(url, headers=headers, timeout=REQUEST_TIMEOUT)

        if resp.status_code == 401:
            raise ValueError("Simkl authentication required or token expired")
        if resp.status_code != 200:
            raise ValueError(f"Simkl API returned {resp.status_code}")

        data = resp.json()
        if not isinstance(data, dict):
            data = {'shows': data if isinstance(data, list) else []}

        items = data.get('shows', data) if isinstance(data, dict) else data
        if not isinstance(items, list):
            items = []

        for item in items:
            show = item.get('show', item)
            ids = show.get('ids', {})
            title = show.get('title', '')
            year = str(show.get('year') or '')
            tmdb_id = ids.get('tmdb')

            entry = {
                'title': title,
                'year': year,
                'tmdb_id': tmdb_id,
                'poster_path': '',
            }

            if tmdb_id:
                detail = _tmdb_tv_details(tmdb_id)
                if detail:
                    entry['poster_path'] = detail.get('poster_path', '')
                time.sleep(0.1)
            elif ids.get('imdb'):
                resolved = _resolve_imdb_to_tmdb_tv(ids['imdb'])
                if resolved:
                    entry.update(resolved)
                time.sleep(0.1)
            elif title:
                resolved = _search_tmdb_tv(title, year)
                if resolved:
                    entry.update(resolved)
                time.sleep(0.1)

            if entry.get('tmdb_id'):
                shows.append(entry)

    except ValueError:
        raise
    except Exception as e:
        logger.error("Simkl TV fetch failed: %s", e)
        raise

    return shows


# ---------------------------------------------------------------------------
# AniList
# ---------------------------------------------------------------------------

def _fetch_anilist_tv(settings):
    """Fetch anime (TV) from AniList user lists via GraphQL."""
    username = (settings.get('username') or '').strip()
    if not username:
        raise ValueError("AniList username is required")

    list_type = settings.get('list_type', 'watching')
    status_map = {
        'watching': 'CURRENT',
        'planning': 'PLANNING',
        'completed': 'COMPLETED',
        'paused': 'PAUSED',
        'dropped': 'DROPPED',
    }
    al_status = status_map.get(list_type, 'CURRENT')

    query = '''
    query ($username: String, $status: MediaListStatus) {
      MediaListCollection(userName: $username, type: ANIME, status: $status) {
        lists {
          entries {
            media {
              title { romaji english }
              startDate { year }
              idMal
              id
            }
          }
        }
      }
    }
    '''

    shows = []
    try:
        resp = requests.post(
            'https://graphql.anilist.co',
            json={'query': query, 'variables': {'username': username, 'status': al_status}},
            headers={'Content-Type': 'application/json', 'Accept': 'application/json'},
            timeout=REQUEST_TIMEOUT
        )

        if resp.status_code != 200:
            raise ValueError(f"AniList API returned {resp.status_code}")

        data = resp.json()
        lists = (data.get('data') or {}).get('MediaListCollection', {}).get('lists', [])

        for lst in lists:
            for entry in lst.get('entries', []):
                media = entry.get('media', {})
                title_obj = media.get('title', {})
                title = title_obj.get('english') or title_obj.get('romaji') or ''
                year = str((media.get('startDate') or {}).get('year') or '')

                entry_data = {
                    'title': title,
                    'year': year,
                    'tmdb_id': None,
                    'poster_path': '',
                }

                if title:
                    resolved = _search_tmdb_tv(title, year)
                    if resolved:
                        entry_data.update(resolved)
                    time.sleep(0.1)

                if entry_data.get('tmdb_id'):
                    shows.append(entry_data)

    except ValueError:
        raise
    except Exception as e:
        logger.error("AniList TV fetch failed: %s", e)
        raise

    return shows


# ---------------------------------------------------------------------------
# MyAnimeList
# ---------------------------------------------------------------------------

def _fetch_myanimelist_tv(settings):
    """Fetch anime (TV) from MyAnimeList user lists."""
    username = (settings.get('username') or '').strip()
    if not username:
        raise ValueError("MyAnimeList username is required")

    list_type = settings.get('list_type', 'all')
    status_map = {
        'all': '',
        'watching': 'watching',
        'completed': 'completed',
        'on_hold': 'on_hold',
        'dropped': 'dropped',
        'plan_to_watch': 'plan_to_watch',
    }
    mal_status = status_map.get(list_type, '')

    shows = []
    try:
        offset = 0
        limit = 100
        while True:
            url = f'https://api.jikan.moe/v4/users/{username}/animelist'
            params = {'limit': limit, 'offset': offset}
            if mal_status:
                params['status'] = mal_status

            resp = requests.get(url, params=params, timeout=REQUEST_TIMEOUT, headers={
                'User-Agent': 'Huntarr/1.0'
            })

            if resp.status_code == 429:
                time.sleep(2)
                continue
            if resp.status_code != 200:
                raise ValueError(f"MyAnimeList API returned {resp.status_code}")

            data = resp.json()
            items = data.get('data', [])
            if not items:
                break

            for item in items:
                entry = item.get('entry', item)
                title = entry.get('title', '')
                mal_id = entry.get('mal_id', '')

                entry_data = {
                    'title': title,
                    'year': '',
                    'tmdb_id': None,
                    'poster_path': '',
                }

                if title:
                    resolved = _search_tmdb_tv(title)
                    if resolved:
                        entry_data.update(resolved)
                    time.sleep(0.15)

                if entry_data.get('tmdb_id'):
                    shows.append(entry_data)

            if not data.get('pagination', {}).get('has_next_page', False):
                break
            offset += limit
            time.sleep(1)

    except ValueError:
        raise
    except Exception as e:
        logger.error("MyAnimeList TV fetch failed: %s", e)
        raise

    return shows
