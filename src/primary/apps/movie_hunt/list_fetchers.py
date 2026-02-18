"""
Import List Fetchers — fetch movies from various external sources.
Each fetcher returns a list of dicts: [{'title': str, 'year': str, 'tmdb_id': int|None, 'imdb_id': str|None, 'poster_path': str}]
"""

import re
import time
import requests
import xml.etree.ElementTree as ET
from src.primary.utils.logger import get_logger

logger = get_logger("import_lists")

# TMDb API key (same as Movie Hunt discovery)
TMDB_API_KEY = "9265b0bd0cd1962f7f3225989fcd7192"
TMDB_BASE = "https://api.themoviedb.org/3"
REQUEST_TIMEOUT = 20


def fetch_list(list_type, settings):
    """Dispatch to the correct fetcher. Returns list of movie dicts."""
    fetchers = {
        'imdb': _fetch_imdb,
        'tmdb': _fetch_tmdb,
        'trakt': _fetch_trakt,
        'rss': _fetch_rss,
        'stevenlu': _fetch_stevenlu,
        'plex': _fetch_plex,
        'custom_json': _fetch_custom_json,
    }
    fn = fetchers.get(list_type)
    if not fn:
        raise ValueError(f"Unknown list type: {list_type}")
    return fn(settings)


# ---------------------------------------------------------------------------
# TMDb resolution helper
# ---------------------------------------------------------------------------

def _resolve_imdb_to_tmdb(imdb_id):
    """Resolve an IMDb ID to TMDb ID and metadata. Cached 24h (server-side)."""
    if not imdb_id:
        return None
    try:
        from src.primary.utils.tmdb_metadata_cache import get_find, set_find

        cached = get_find('imdb', imdb_id)
        if cached is not None:
            return {
                'title': cached.get('title', ''),
                'year': (cached.get('release_date') or '')[:4],
                'tmdb_id': cached.get('id'),
                'poster_path': cached.get('poster_path') or '',
                'imdb_id': imdb_id,
            }

        resp = requests.get(
            f"{TMDB_BASE}/find/{imdb_id}",
            params={'api_key': TMDB_API_KEY, 'external_source': 'imdb_id'},
            timeout=REQUEST_TIMEOUT
        )
        if resp.status_code != 200:
            return None
        data = resp.json()
        results = data.get('movie_results', [])
        if results:
            m = results[0]
            set_find('imdb', imdb_id, m)
            return {
                'title': m.get('title', ''),
                'year': (m.get('release_date') or '')[:4],
                'tmdb_id': m.get('id'),
                'poster_path': m.get('poster_path') or '',
                'imdb_id': imdb_id,
            }
    except Exception as e:
        logger.debug("IMDb->TMDb resolve failed for %s: %s", imdb_id, e)
    return None


def _search_tmdb_by_title(title, year=None):
    """Search TMDb by title and optional year. Cached 1h (server-side)."""
    if not title:
        return None
    try:
        from src.primary.utils.tmdb_metadata_cache import get_search, set_search

        cache_key = f"{title}:y{year or ''}"
        data = get_search('movie', cache_key)
        if data is None:
            params = {'api_key': TMDB_API_KEY, 'query': title}
            if year:
                params['year'] = year
            resp = requests.get(f"{TMDB_BASE}/search/movie", params=params, timeout=REQUEST_TIMEOUT)
            if resp.status_code != 200:
                return None
            data = resp.json()
            set_search('movie', cache_key, data)
        results = data.get('results', [])
        if results:
            m = results[0]
            return {
                'title': m.get('title', ''),
                'year': (m.get('release_date') or '')[:4],
                'tmdb_id': m.get('id'),
                'poster_path': m.get('poster_path') or '',
            }
    except Exception as e:
        logger.debug("TMDb search failed for '%s': %s", title, e)
    return None


def _tmdb_movie_details(tmdb_id):
    """Get TMDb movie details by ID. Uses server-side cache when available."""
    if not tmdb_id:
        return None
    try:
        from src.primary.utils.tmdb_metadata_cache import get

        cached = get('movie', tmdb_id)
        if cached is not None:
            return {
                'title': cached.get('title', ''),
                'year': (cached.get('release_date') or '')[:4],
                'tmdb_id': cached.get('id'),
                'poster_path': cached.get('poster_path') or '',
                'imdb_id': cached.get('imdb_id') or '',
            }

        resp = requests.get(
            f"{TMDB_BASE}/movie/{tmdb_id}",
            params={'api_key': TMDB_API_KEY},
            timeout=REQUEST_TIMEOUT
        )
        if resp.status_code != 200:
            return None
        m = resp.json()
        return {
            'title': m.get('title', ''),
            'year': (m.get('release_date') or '')[:4],
            'tmdb_id': m.get('id'),
            'poster_path': m.get('poster_path') or '',
            'imdb_id': m.get('imdb_id') or '',
        }
    except Exception as e:
        logger.debug("TMDb detail failed for %s: %s", tmdb_id, e)
    return None


# ---------------------------------------------------------------------------
# IMDb
# ---------------------------------------------------------------------------

def _fetch_imdb(settings):
    """Fetch movies from IMDb lists."""
    list_type = settings.get('list_type', 'top_250')
    movies = []

    if list_type == 'top_250':
        movies = _fetch_imdb_chart('top')
    elif list_type == 'popular':
        movies = _fetch_imdb_chart('popular')
    elif list_type == 'custom':
        list_id = (settings.get('list_id') or '').strip()
        if not list_id:
            raise ValueError("IMDb List ID is required")
        movies = _fetch_imdb_custom_list(list_id)

    return movies


def _fetch_imdb_chart(chart_type):
    """Fetch IMDb chart via TMDb discover (since IMDb has no public API)."""
    movies = []
    try:
        # Use TMDb's curated lists as proxy for IMDb charts
        if chart_type == 'top':
            # TMDb top rated is a close proxy for IMDb Top 250
            for page in range(1, 6):  # ~100 movies
                resp = requests.get(
                    f"{TMDB_BASE}/movie/top_rated",
                    params={'api_key': TMDB_API_KEY, 'page': page},
                    timeout=REQUEST_TIMEOUT
                )
                if resp.status_code != 200:
                    break
                for m in resp.json().get('results', []):
                    movies.append({
                        'title': m.get('title', ''),
                        'year': (m.get('release_date') or '')[:4],
                        'tmdb_id': m.get('id'),
                        'poster_path': m.get('poster_path') or '',
                    })
        elif chart_type == 'popular':
            for page in range(1, 4):  # ~60 movies
                resp = requests.get(
                    f"{TMDB_BASE}/movie/popular",
                    params={'api_key': TMDB_API_KEY, 'page': page},
                    timeout=REQUEST_TIMEOUT
                )
                if resp.status_code != 200:
                    break
                for m in resp.json().get('results', []):
                    movies.append({
                        'title': m.get('title', ''),
                        'year': (m.get('release_date') or '')[:4],
                        'tmdb_id': m.get('id'),
                        'poster_path': m.get('poster_path') or '',
                    })
    except Exception as e:
        logger.error("IMDb chart fetch failed: %s", e)
        raise

    return movies


def _fetch_imdb_custom_list(list_id):
    """Fetch a custom IMDb list by its ID (e.g. ls123456789). Scrapes the export CSV."""
    movies = []
    # Clean up list ID
    list_id = list_id.strip().lstrip('/')
    if not list_id.startswith('ls'):
        list_id = 'ls' + list_id

    try:
        # IMDb list export endpoint
        url = f"https://www.imdb.com/list/{list_id}/export"
        resp = requests.get(url, timeout=REQUEST_TIMEOUT, headers={
            'User-Agent': 'Mozilla/5.0 (compatible; Huntarr/1.0)'
        })

        if resp.status_code == 200 and resp.text.strip():
            import csv
            import io
            reader = csv.DictReader(io.StringIO(resp.text))
            for row in reader:
                imdb_id = row.get('Const', '').strip()
                title = row.get('Title', '').strip()
                year = str(row.get('Year', '')).strip()
                if not imdb_id and not title:
                    continue
                movie = {
                    'title': title,
                    'year': year,
                    'imdb_id': imdb_id,
                    'tmdb_id': None,
                    'poster_path': '',
                }
                # Resolve to TMDb
                if imdb_id:
                    resolved = _resolve_imdb_to_tmdb(imdb_id)
                    if resolved:
                        movie.update(resolved)
                elif title:
                    resolved = _search_tmdb_by_title(title, year)
                    if resolved:
                        movie.update(resolved)
                movies.append(movie)
                # Rate limit
                time.sleep(0.25)
        else:
            # Fallback: try to scrape the list page for IMDb IDs
            url = f"https://www.imdb.com/list/{list_id}/"
            resp = requests.get(url, timeout=REQUEST_TIMEOUT, headers={
                'User-Agent': 'Mozilla/5.0 (compatible; Huntarr/1.0)'
            })
            if resp.status_code == 200:
                imdb_ids = re.findall(r'(tt\d{7,10})', resp.text)
                seen = set()
                for iid in imdb_ids:
                    if iid in seen:
                        continue
                    seen.add(iid)
                    resolved = _resolve_imdb_to_tmdb(iid)
                    if resolved:
                        movies.append(resolved)
                    time.sleep(0.25)
    except Exception as e:
        logger.error("IMDb custom list fetch failed for %s: %s", list_id, e)
        raise

    return movies


# ---------------------------------------------------------------------------
# TMDb
# ---------------------------------------------------------------------------

def _fetch_tmdb(settings):
    """Fetch movies from TMDb."""
    list_type = settings.get('list_type', 'popular')
    movies = []

    if list_type in ('popular', 'top_rated', 'now_playing', 'upcoming'):
        from src.primary.utils.tmdb_metadata_cache import get_list, set_list

        for page in range(1, 6):
            cache_key = f"movie:{list_type}:{page}"
            data = get_list(cache_key)
            if data is None:
                resp = requests.get(
                    f"{TMDB_BASE}/movie/{list_type}",
                    params={'api_key': TMDB_API_KEY, 'page': page},
                    timeout=REQUEST_TIMEOUT
                )
                if resp.status_code != 200:
                    break
                data = resp.json()
                set_list(cache_key, data)
            for m in data.get('results', []):
                movies.append({
                    'title': m.get('title', ''),
                    'year': (m.get('release_date') or '')[:4],
                    'tmdb_id': m.get('id'),
                    'poster_path': m.get('poster_path') or '',
                })

    elif list_type == 'list':
        from src.primary.utils.tmdb_metadata_cache import get_list, set_list

        list_id = (settings.get('list_id') or '').strip()
        if not list_id:
            raise ValueError("TMDb List ID is required")
        page = 1
        while True:
            cache_key = f"movie:list:{list_id}:{page}"
            data = get_list(cache_key)
            if data is None:
                resp = requests.get(
                    f"{TMDB_BASE}/list/{list_id}",
                    params={'api_key': TMDB_API_KEY, 'page': page},
                    timeout=REQUEST_TIMEOUT
                )
                if resp.status_code != 200:
                    if page == 1:
                        raise ValueError(f"TMDb list {list_id} not found or not accessible")
                    break
                data = resp.json()
                set_list(cache_key, data)
            items = data.get('items', [])
            if not items:
                break
            for m in items:
                if m.get('media_type', 'movie') != 'movie' and 'title' not in m:
                    continue
                movies.append({
                    'title': m.get('title', ''),
                    'year': (m.get('release_date') or '')[:4],
                    'tmdb_id': m.get('id'),
                    'poster_path': m.get('poster_path') or '',
                })
            page += 1
            if page > data.get('total_pages', 1):
                break

    elif list_type == 'keyword':
        from src.primary.utils.tmdb_metadata_cache import get_discover, set_discover

        keyword_id = (settings.get('keyword_id') or '').strip()
        if not keyword_id:
            raise ValueError("TMDb Keyword ID is required")
        for page in range(1, 6):
            cache_params = {'page': page, 'with_keywords': keyword_id}
            data = get_discover('movie', cache_params)
            if data is None:
                resp = requests.get(
                    f"{TMDB_BASE}/discover/movie",
                    params={'api_key': TMDB_API_KEY, 'with_keywords': keyword_id, 'page': page},
                    timeout=REQUEST_TIMEOUT
                )
                if resp.status_code != 200:
                    break
                data = resp.json()
                set_discover('movie', cache_params, data)
            for m in data.get('results', []):
                movies.append({
                    'title': m.get('title', ''),
                    'year': (m.get('release_date') or '')[:4],
                    'tmdb_id': m.get('id'),
                    'poster_path': m.get('poster_path') or '',
                })

    elif list_type == 'company':
        from src.primary.utils.tmdb_metadata_cache import get_discover, set_discover

        company_id = (settings.get('company_id') or '').strip()
        if not company_id:
            raise ValueError("TMDb Company ID is required")
        for page in range(1, 6):
            cache_params = {'page': page, 'with_companies': company_id}
            data = get_discover('movie', cache_params)
            if data is None:
                resp = requests.get(
                    f"{TMDB_BASE}/discover/movie",
                    params={'api_key': TMDB_API_KEY, 'with_companies': company_id, 'page': page},
                    timeout=REQUEST_TIMEOUT
                )
                if resp.status_code != 200:
                    break
                data = resp.json()
                set_discover('movie', cache_params, data)
            for m in data.get('results', []):
                movies.append({
                    'title': m.get('title', ''),
                    'year': (m.get('release_date') or '')[:4],
                    'tmdb_id': m.get('id'),
                    'poster_path': m.get('poster_path') or '',
                })

    elif list_type == 'person':
        from src.primary.utils.tmdb_metadata_cache import get_discover, set_discover

        person_id = (settings.get('person_id') or '').strip()
        if not person_id:
            raise ValueError("TMDb Person ID is required")
        for page in range(1, 6):
            cache_params = {'page': page, 'with_people': person_id}
            data = get_discover('movie', cache_params)
            if data is None:
                resp = requests.get(
                    f"{TMDB_BASE}/discover/movie",
                    params={'api_key': TMDB_API_KEY, 'with_people': person_id, 'page': page},
                    timeout=REQUEST_TIMEOUT
                )
                if resp.status_code != 200:
                    break
                data = resp.json()
                set_discover('movie', cache_params, data)
            for m in data.get('results', []):
                movies.append({
                    'title': m.get('title', ''),
                    'year': (m.get('release_date') or '')[:4],
                    'tmdb_id': m.get('id'),
                    'poster_path': m.get('poster_path') or '',
                })

    return movies


# ---------------------------------------------------------------------------
# Trakt
# ---------------------------------------------------------------------------

def _fetch_trakt(settings):
    """Fetch movies from Trakt."""
    import os
    list_type = settings.get('list_type', 'popular')
    access_token = settings.get('access_token', '')

    # Use embedded credentials (same as the OAuth routes)
    client_id = os.environ.get(
        'TRAKT_CLIENT_ID',
        '9ee2169e48c064874e7591ab76e0e26ae49a22d4b1dcb893076b46cf634a769e'
    )

    headers = {
        'Content-Type': 'application/json',
        'trakt-api-version': '2',
        'trakt-api-key': client_id,
    }
    if access_token:
        headers['Authorization'] = f'Bearer {access_token}'

    movies = []
    limit = min(int(settings.get('limit', 100)), 500)

    try:
        if list_type == 'popular':
            url = 'https://api.trakt.tv/movies/popular'
            resp = requests.get(url, headers=headers, params={'limit': limit, 'extended': 'full'},
                                timeout=REQUEST_TIMEOUT)
        elif list_type == 'trending':
            url = 'https://api.trakt.tv/movies/trending'
            resp = requests.get(url, headers=headers, params={'limit': limit, 'extended': 'full'},
                                timeout=REQUEST_TIMEOUT)
        elif list_type == 'watchlist':
            if not access_token:
                raise ValueError("Trakt OAuth is required for Watchlist")
            username = (settings.get('username') or 'me').strip()
            url = f'https://api.trakt.tv/users/{username}/watchlist/movies'
            resp = requests.get(url, headers=headers, params={'extended': 'full'},
                                timeout=REQUEST_TIMEOUT)
        elif list_type == 'custom':
            username = (settings.get('username') or '').strip()
            list_name = (settings.get('list_name') or '').strip()
            if not username or not list_name:
                raise ValueError("Trakt username and list name are required for custom lists")
            # Slug-ify list name
            list_slug = list_name.lower().replace(' ', '-')
            url = f'https://api.trakt.tv/users/{username}/lists/{list_slug}/items/movies'
            resp = requests.get(url, headers=headers, params={'extended': 'full'},
                                timeout=REQUEST_TIMEOUT)
        else:
            raise ValueError(f"Unknown Trakt list type: {list_type}")

        if resp.status_code != 200:
            raise ValueError(f"Trakt API returned {resp.status_code}: {resp.text[:200]}")

        data = resp.json()
        for item in data:
            # Trakt returns differently for trending (has 'movie' wrapper) vs popular (direct)
            movie = item.get('movie', item)
            ids = movie.get('ids', {})
            tmdb_id = ids.get('tmdb')
            title = movie.get('title', '')
            year = str(movie.get('year') or '')

            entry = {
                'title': title,
                'year': year,
                'tmdb_id': tmdb_id,
                'imdb_id': ids.get('imdb', ''),
                'poster_path': '',
            }

            # Resolve poster from TMDb if we have tmdb_id
            if tmdb_id:
                detail = _tmdb_movie_details(tmdb_id)
                if detail:
                    entry['poster_path'] = detail.get('poster_path', '')
                time.sleep(0.1)

            movies.append(entry)

    except requests.RequestException as e:
        logger.error("Trakt fetch failed: %s", e)
        raise
    except ValueError:
        raise

    return movies


# ---------------------------------------------------------------------------
# RSS
# ---------------------------------------------------------------------------

def _fetch_rss(settings):
    """Fetch movies from an RSS feed."""
    url = (settings.get('url') or '').strip()
    if not url:
        raise ValueError("RSS feed URL is required")

    movies = []
    try:
        resp = requests.get(url, timeout=REQUEST_TIMEOUT, headers={
            'User-Agent': 'Huntarr/1.0 (Import Lists)'
        })
        if resp.status_code != 200:
            raise ValueError(f"RSS feed returned {resp.status_code}")

        root = ET.fromstring(resp.content)

        # Standard RSS
        for item in root.findall('.//item'):
            title_el = item.find('title')
            title = title_el.text.strip() if title_el is not None and title_el.text else ''
            if not title:
                continue

            # Try to extract IMDb ID from link or description
            link_el = item.find('link')
            desc_el = item.find('description')
            imdb_id = None
            for el in [link_el, desc_el]:
                if el is not None and el.text:
                    match = re.search(r'(tt\d{7,10})', el.text)
                    if match:
                        imdb_id = match.group(1)
                        break

            # Extract year from title
            year_match = re.search(r'\((\d{4})\)', title)
            year = year_match.group(1) if year_match else ''
            clean_title = re.sub(r'\s*\(\d{4}\)\s*', '', title).strip() if year_match else title

            entry = {
                'title': clean_title,
                'year': year,
                'tmdb_id': None,
                'imdb_id': imdb_id,
                'poster_path': '',
            }

            # Resolve to TMDb
            if imdb_id:
                resolved = _resolve_imdb_to_tmdb(imdb_id)
                if resolved:
                    entry.update(resolved)
            elif clean_title:
                resolved = _search_tmdb_by_title(clean_title, year)
                if resolved:
                    entry.update(resolved)

            movies.append(entry)
            time.sleep(0.15)

    except ET.ParseError as e:
        logger.error("RSS parse error: %s", e)
        raise ValueError(f"Invalid RSS feed format: {e}")
    except Exception as e:
        logger.error("RSS fetch failed: %s", e)
        raise

    return movies


# ---------------------------------------------------------------------------
# StevenLu
# ---------------------------------------------------------------------------

def _fetch_stevenlu(settings):
    """Fetch popular movies from StevenLu JSON feed."""
    url = (settings.get('url') or 'https://popular-movies-data.stevenlu.com/movies.json').strip()
    movies = []

    try:
        resp = requests.get(url, timeout=REQUEST_TIMEOUT)
        if resp.status_code != 200:
            raise ValueError(f"StevenLu feed returned {resp.status_code}")

        data = resp.json()
        for item in data:
            title = item.get('title', '').strip()
            imdb_id = item.get('imdb_id', '').strip()
            poster = item.get('poster_url', '')

            if not title and not imdb_id:
                continue

            entry = {
                'title': title,
                'year': '',
                'tmdb_id': None,
                'imdb_id': imdb_id,
                'poster_path': '',
            }

            # Resolve to TMDb
            if imdb_id:
                resolved = _resolve_imdb_to_tmdb(imdb_id)
                if resolved:
                    entry.update(resolved)
                time.sleep(0.1)
            elif title:
                resolved = _search_tmdb_by_title(title)
                if resolved:
                    entry.update(resolved)
                time.sleep(0.1)

            movies.append(entry)

    except Exception as e:
        logger.error("StevenLu fetch failed: %s", e)
        raise

    return movies


# ---------------------------------------------------------------------------
# Plex Watchlist
# ---------------------------------------------------------------------------

def _fetch_plex(settings):
    """Fetch movies from Plex Watchlist."""
    access_token = settings.get('access_token', '')
    if not access_token:
        raise ValueError("Plex authentication is required. Please sign in with Plex.")

    # Get client identifier for Plex API
    try:
        from src.primary.auth import get_client_identifier
        client_id = get_client_identifier()
    except Exception:
        client_id = 'huntarr-import-lists'

    movies = []
    try:
        headers = {
            'X-Plex-Token': access_token,
            'X-Plex-Client-Identifier': client_id,
            'X-Plex-Product': 'Huntarr',
            'Accept': 'application/json',
        }

        # Plex watchlist API — type=1 for movies, includeGuids for external IDs
        params = {
            'type': '1',
            'includeGuids': '1',
            'includeFields': 'title,year,type',
            'sort': 'watchlistedAt:desc',
        }

        # Try multiple Plex API endpoints (they've changed over time)
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
            if item.get('type') != 'movie':
                continue
            title = item.get('title', '')
            year = str(item.get('year', ''))
            guid = item.get('guid', '')

            # Extract TMDb/IMDb from Plex guid
            tmdb_id = None
            imdb_id = None
            guids = item.get('Guid', [])
            for g in guids:
                gid = g.get('id', '')
                if 'tmdb://' in gid:
                    tmdb_id = int(gid.replace('tmdb://', ''))
                elif 'imdb://' in gid:
                    imdb_id = gid.replace('imdb://', '')

            entry = {
                'title': title,
                'year': year,
                'tmdb_id': tmdb_id,
                'imdb_id': imdb_id,
                'poster_path': '',
            }

            # Resolve if needed
            if tmdb_id:
                detail = _tmdb_movie_details(tmdb_id)
                if detail:
                    entry['poster_path'] = detail.get('poster_path', '')
            elif imdb_id:
                resolved = _resolve_imdb_to_tmdb(imdb_id)
                if resolved:
                    entry.update(resolved)
            elif title:
                resolved = _search_tmdb_by_title(title, year)
                if resolved:
                    entry.update(resolved)

            movies.append(entry)
            time.sleep(0.1)

    except ValueError:
        raise
    except Exception as e:
        logger.error("Plex watchlist fetch failed: %s", e)
        raise

    return movies


def _parse_plex_rss(content):
    """Parse Plex watchlist RSS feed."""
    movies = []
    try:
        root = ET.fromstring(content)
        for item in root.findall('.//item'):
            title_el = item.find('title')
            title = title_el.text.strip() if title_el is not None and title_el.text else ''
            if not title:
                continue

            year_match = re.search(r'\((\d{4})\)', title)
            year = year_match.group(1) if year_match else ''
            clean_title = re.sub(r'\s*\(\d{4}\)\s*', '', title).strip() if year_match else title

            resolved = _search_tmdb_by_title(clean_title, year)
            entry = {
                'title': clean_title,
                'year': year,
                'tmdb_id': None,
                'poster_path': '',
            }
            if resolved:
                entry.update(resolved)
            movies.append(entry)
            time.sleep(0.15)
    except Exception as e:
        logger.error("Plex RSS parse failed: %s", e)
    return movies


# ---------------------------------------------------------------------------
# Custom JSON
# ---------------------------------------------------------------------------

def _fetch_custom_json(settings):
    """Fetch movies from a custom JSON URL."""
    url = (settings.get('url') or '').strip()
    if not url:
        raise ValueError("Custom JSON URL is required")

    movies = []
    try:
        resp = requests.get(url, timeout=REQUEST_TIMEOUT, headers={
            'User-Agent': 'Huntarr/1.0 (Import Lists)',
            'Accept': 'application/json',
        })
        if resp.status_code != 200:
            raise ValueError(f"Custom JSON URL returned {resp.status_code}")

        data = resp.json()
        if not isinstance(data, list):
            raise ValueError("Expected JSON array of movie objects")

        for item in data:
            if not isinstance(item, dict):
                continue

            title = (item.get('title') or item.get('Title') or '').strip()
            year = str(item.get('year') or item.get('Year') or '').strip()
            tmdb_id = item.get('tmdb_id') or item.get('tmdbId') or item.get('TmdbId')
            imdb_id = (item.get('imdb_id') or item.get('imdbId') or item.get('ImdbId') or
                       item.get('Const') or '').strip()

            if not title and not tmdb_id and not imdb_id:
                continue

            entry = {
                'title': title,
                'year': year,
                'tmdb_id': int(tmdb_id) if tmdb_id else None,
                'imdb_id': imdb_id,
                'poster_path': '',
            }

            # Resolve metadata if needed
            if entry['tmdb_id']:
                detail = _tmdb_movie_details(entry['tmdb_id'])
                if detail:
                    if not entry['title']:
                        entry['title'] = detail.get('title', '')
                    if not entry['year']:
                        entry['year'] = detail.get('year', '')
                    entry['poster_path'] = detail.get('poster_path', '')
            elif imdb_id:
                resolved = _resolve_imdb_to_tmdb(imdb_id)
                if resolved:
                    entry.update(resolved)
            elif title:
                resolved = _search_tmdb_by_title(title, year)
                if resolved:
                    entry.update(resolved)

            movies.append(entry)
            time.sleep(0.1)

    except ValueError:
        raise
    except Exception as e:
        logger.error("Custom JSON fetch failed: %s", e)
        raise

    return movies
