"""Import Media system for TV Hunt — scan root folders for unmapped TV series,
match against TMDB, and let users confirm + import into their TV Collection.

Key design:
- Background daily scan detects series folders in root folders not in the collection.
- Smart parser handles Plex, Emby, Jellyfin, and scene naming conventions.
- TMDB search/tv finds best match with TV-specific confidence scoring.
- first_air_date year is critical for disambiguating reboots (e.g. Batman 1966 vs 2020).
- On-demand scan when user visits the page processes any new/pending items.
"""

import os
import re
import time
import threading
from datetime import datetime

import requests
from flask import request, jsonify

from .helpers import _get_tv_hunt_instance_id_from_request
from .storage import get_tv_root_folders_config as _get_root_folders_config
from .discovery_tv import (
    _get_collection_config,
    _save_collection_config,
    TMDB_BASE,
    TMDB_API_KEY,
)

from ...utils.logger import get_logger
logger = get_logger("tv_hunt")

# Video extensions for TV (same as storage)
_VIDEO_EXTENSIONS = frozenset(('.mkv', '.mp4', '.avi', '.m4v', '.ts', '.wmv', '.flv', '.mov', '.webm'))

# Sample/extra/junk patterns to skip (TV-specific additions)
_SKIP_PATTERNS = re.compile(
    r'(?i)(^sample$|^extras?$|^bonus$|^featurettes?$|^behind.?the.?scenes?$'
    r'|^deleted.?scenes?$|^special.?features?$|^trailers?$|^subs?$|^subtitles?$'
    r'|^\..*|^@eaDir$|^#recycle$|^\.Trash|^lost\+found$'
    r'|^tv$|^shows?$|^series$|^downloads?$|^temp$|^tmp$|^incoming$|^incomplete$'
    r'|^sonarr$|^tvhunt$|^tv.?hunt$|^test$|^new$|^old$'
    r'|^backup$|^backups$|^archive$|^archives$)',
)

# Scene/release tags to strip
_RELEASE_TAGS = re.compile(
    r'(?i)\b(REPACK|PROPER|2160p|1080p|720p|480p|BluRay|WEB-?DL|WEBRip|HDTV'
    r'|x264|x265|h\.?264|h\.?265|AAC|AC3|DTS|NF|AMZN|DSNP|HMAX)\b'
)

_YEAR_RANGE = re.compile(r'\b(19\d{2}|20\d{2})\b')
_TMDB_PATTERN = re.compile(r'\{tmdb-(\d+)\}|\[tmdb[-=](\d+)\]', re.IGNORECASE)
_TVDB_PATTERN = re.compile(r'\{tvdb-(\d+)\}|\[tvdb[-=](\d+)\]|tvdbid[-=](\d+)', re.IGNORECASE)

_scan_lock = threading.Lock()


def _normalize_title_for_key(title):
    """Normalize series title for comparison (lowercase, strip, collapse spaces)."""
    if not title or not isinstance(title, str):
        return ''
    s = title.lower().strip()
    s = re.sub(r'[^\w\s]', ' ', s)
    return ' '.join(s.split())


def _is_video_file(filename):
    _, ext = os.path.splitext(filename)
    return ext.lower() in _VIDEO_EXTENSIONS


def _should_skip_folder(name):
    return bool(_SKIP_PATTERNS.match(name))


def _has_video_files_recursive(path, max_depth=3, current_depth=0):
    """Check if a folder (or subfolders) contains video files."""
    if current_depth >= max_depth:
        return False
    try:
        for name in os.listdir(path):
            full = os.path.join(path, name)
            if os.path.isfile(full) and _is_video_file(name):
                return True
            if os.path.isdir(full) and not _should_skip_folder(name):
                if _has_video_files_recursive(full, max_depth, current_depth + 1):
                    return True
    except OSError:
        pass
    return False


def _count_seasons_on_disk(path):
    """Detect season folders (Season 1, S01, S1) for confidence scoring."""
    count = 0
    try:
        for name in os.listdir(path):
            if not os.path.isdir(os.path.join(path, name)):
                continue
            # Season 1, Season 01, S01, S1
            m = re.match(r'(?i)^(?:season\s*)?(\d{1,2})$', name.strip())
            if m:
                count += 1
            elif re.match(r'^[Ss]\d{1,2}$', name.strip()):
                count += 1
    except OSError:
        pass
    return count


def _get_folder_media_info(path):
    """Get total size and file count for a series folder (recursive)."""
    total_size = 0
    file_count = 0
    main_file = None
    main_size = 0
    try:
        for root, dirs, files in os.walk(path):
            for f in files:
                if _is_video_file(f):
                    full = os.path.join(root, f)
                    try:
                        size = os.path.getsize(full)
                        total_size += size
                        file_count += 1
                        if size > main_size:
                            main_size = size
                            main_file = {'name': f, 'path': full, 'size': size}
                    except OSError:
                        pass
            if file_count > 500:  # Cap traversal
                break
    except OSError:
        pass
    if not main_file:
        return None
    return {
        'main_file': main_file,
        'total_size': total_size,
        'file_count': file_count,
    }


def _parse_series_name(raw_name):
    """Parse a TV series title and year from a folder name.

    Handles: "Show Name (2020)", "Show.Name.2020", "Show Name {tvdb-12345}", etc.
    Returns: title, year, tmdb_id, tvdb_id
    """
    if not raw_name:
        return {'title': '', 'year': '', 'tmdb_id': None, 'tvdb_id': None}

    name = raw_name.strip()
    for ext in _VIDEO_EXTENSIONS:
        if name.lower().endswith(ext):
            name = name[:-len(ext)].strip()
            break

    tmdb_id = None
    tvdb_id = None
    m = _TMDB_PATTERN.search(name)
    if m:
        tmdb_id = int(m.group(1) or m.group(2))
    m = _TVDB_PATTERN.search(name)
    if m:
        tvdb_id = int(m.group(1) or m.group(2) or m.group(3))

    name = _TMDB_PATTERN.sub('', name)
    name = _TVDB_PATTERN.sub('', name)
    name = _RELEASE_TAGS.sub(' ', name)
    name = ' '.join(name.split()).strip()

    year = ''
    year_pos = -1
    paren_year = re.search(r'\((\d{4})\)', name)
    if paren_year:
        y = int(paren_year.group(1))
        if 1900 <= y <= 2099:
            year = str(y)
            year_pos = paren_year.start()
    if not year:
        bracket_year = re.search(r'\[(\d{4})\]', name)
        if bracket_year:
            y = int(bracket_year.group(1))
            if 1900 <= y <= 2099:
                year = str(y)
                year_pos = bracket_year.start()
    if not year:
        for m in _YEAR_RANGE.finditer(name):
            y = int(m.group(1))
            if 1900 <= y <= 2099:
                year = str(y)
                year_pos = m.start()
                break

    if year_pos >= 0:
        title_part = name[:year_pos].strip()
    else:
        first_tag = None
        for m in _RELEASE_TAGS.finditer(name):
            if m.start() > 5:
                first_tag = m.start()
                break
        title_part = name[:first_tag].strip() if first_tag else name.strip()

    title_part = re.sub(r'[\.\-_\s]+$', '', title_part)
    title_part = re.sub(r'^[\.\-_\s]+', '', title_part)
    title_part = title_part.replace('.', ' ').replace('_', ' ')
    title_part = re.sub(r'\s+', ' ', title_part).strip()
    title_part = re.sub(r'\s*,\s*The\s*$', '', title_part, flags=re.IGNORECASE)

    return {
        'title': title_part,
        'year': year,
        'tmdb_id': tmdb_id,
        'tvdb_id': tvdb_id,
    }


# ---------------------------------------------------------------------------
# TMDB TV matching
# ---------------------------------------------------------------------------

def _search_tmdb_tv(query, year=None):
    """Search TMDB for a TV series. first_air_date_year for year filter."""
    try:
        params = {
            'api_key': TMDB_API_KEY,
            'language': 'en-US',
            'query': query,
        }
        if year:
            params['first_air_date_year'] = int(year)
        from src.primary.settings_manager import get_ssl_verify_setting
        verify_ssl = get_ssl_verify_setting()
        resp = requests.get(
            f'{TMDB_BASE}/search/tv',
            params=params, timeout=10, verify=verify_ssl
        )
        if resp.status_code != 200:
            return []
        return resp.json().get('results', [])[:10]
    except Exception as e:
        logger.debug("TMDB TV search error for '%s': %s", query, e)
        return []


def _lookup_tmdb_tv_by_id(tmdb_id):
    """Look up a TV series by TMDB ID."""
    try:
        from src.primary.settings_manager import get_ssl_verify_setting
        verify_ssl = get_ssl_verify_setting()
        resp = requests.get(
            f'{TMDB_BASE}/tv/{tmdb_id}',
            params={'api_key': TMDB_API_KEY, 'language': 'en-US'},
            timeout=10, verify=verify_ssl
        )
        if resp.status_code == 200:
            return resp.json()
    except Exception as e:
        logger.debug("TMDB TV lookup error for ID %s: %s", tmdb_id, e)
    return None


def _lookup_tmdb_by_tvdb(tvdb_id):
    """Look up TMDB via TVDB ID using find endpoint."""
    try:
        from src.primary.settings_manager import get_ssl_verify_setting
        verify_ssl = get_ssl_verify_setting()
        resp = requests.get(
            f'{TMDB_BASE}/find/{tvdb_id}',
            params={'api_key': TMDB_API_KEY, 'external_source': 'tvdb_id'},
            timeout=10, verify=verify_ssl
        )
        if resp.status_code == 200:
            results = resp.json().get('tv_results', [])
            if results:
                return results[0]
    except Exception as e:
        logger.debug("TMDB find by TVDB error for %s: %s", tvdb_id, e)
    return None


def _score_tv_match(parsed, tmdb_result, seasons_on_disk=None):
    """TV-specific confidence scoring. first_air_date is critical for reboots."""
    score = 0
    parsed_title = (parsed.get('title') or '').strip().lower()
    parsed_year = (parsed.get('year') or '').strip()

    tmdb_name = (tmdb_result.get('name') or '').lower()
    tmdb_original = (tmdb_result.get('original_name') or '').lower()
    first_air = tmdb_result.get('first_air_date') or ''
    tmdb_year = first_air[:4] if len(first_air) >= 4 else ''

    def norm(s):
        s = re.sub(r'[^\w\s]', ' ', (s or '').lower())
        return ' '.join(s.split())

    n_parsed = norm(parsed_title)
    n_tmdb = norm(tmdb_name)
    n_original = norm(tmdb_original)

    # Title match (TV uses 'name' not 'title')
    if n_parsed == n_tmdb or n_parsed == n_original:
        score += 50
    elif n_parsed in n_tmdb or n_tmdb in n_parsed:
        score += 35
    elif n_parsed in n_original or n_original in n_parsed:
        score += 30
    else:
        p_words = set(n_parsed.split())
        t_words = set(n_tmdb.split())
        if p_words and t_words:
            overlap = len(p_words & t_words) / max(len(p_words), len(t_words))
            score += int(overlap * 30)

    # first_air_date year — CRITICAL for TV (reboots, remakes)
    if parsed_year and tmdb_year:
        if parsed_year == tmdb_year:
            score += 35  # Higher than movie — year disambiguates more for TV
        elif abs(int(parsed_year) - int(tmdb_year)) <= 1:
            score += 15

    # Seasons on disk vs TMDB (if we detected them)
    if seasons_on_disk is not None and seasons_on_disk > 0:
        tmdb_seasons = tmdb_result.get('number_of_seasons') or 0
        if tmdb_seasons > 0 and seasons_on_disk <= tmdb_seasons:
            if seasons_on_disk == tmdb_seasons:
                score += 10  # Exact season count match
            else:
                score += 5   # Partial (e.g. we have 2, TMDB says 5)

    # Popularity
    popularity = tmdb_result.get('popularity', 0)
    if popularity > 30:
        score += 8
    elif popularity > 10:
        score += 5
    elif popularity > 2:
        score += 2

    # Vote count
    vote_count = tmdb_result.get('vote_count', 0)
    if vote_count > 1000:
        score += 5
    elif vote_count > 200:
        score += 3

    # Poster
    if tmdb_result.get('poster_path'):
        score += 5

    return min(score, 100)


def _match_series_to_tmdb(parsed, seasons_on_disk=None):
    """Match a parsed series folder to TMDB TV. Returns top 5 matches with scores."""
    matches = []
    seen_ids = set()

    title = (parsed.get('title') or '').strip()
    year = (parsed.get('year') or '').strip()
    embedded_tmdb = parsed.get('tmdb_id')
    embedded_tvdb = parsed.get('tvdb_id')

    def _add(tmdb_data, strategy, bonus=0):
        tid = tmdb_data.get('id') or tmdb_data.get('tmdb_id')
        if not tid or tid in seen_ids:
            return
        seen_ids.add(tid)
        s = _score_tv_match(parsed, tmdb_data, seasons_on_disk) + bonus
        first_air = tmdb_data.get('first_air_date') or ''
        m_year = first_air[:4] if len(first_air) >= 4 else ''
        matches.append({
            'tmdb_id': tid,
            'title': tmdb_data.get('name') or tmdb_data.get('title') or '',
            'original_title': tmdb_data.get('original_name') or '',
            'year': m_year,
            'poster_path': tmdb_data.get('poster_path') or '',
            'overview': (tmdb_data.get('overview') or '')[:300],
            'vote_average': tmdb_data.get('vote_average', 0),
            'popularity': tmdb_data.get('popularity', 0),
            'number_of_seasons': tmdb_data.get('number_of_seasons', 0),
            'score': min(s, 100),
            'strategy': strategy,
        })

    # 1. Direct TMDB ID
    if embedded_tmdb:
        data = _lookup_tmdb_tv_by_id(embedded_tmdb)
        if data:
            _add(data, 'tmdb_id', bonus=25)

    # 2. TVDB ID -> TMDB
    if embedded_tvdb:
        data = _lookup_tmdb_by_tvdb(embedded_tvdb)
        if data:
            _add(data, 'tvdb_id', bonus=20)

    # 3. Title + year
    if title:
        results = _search_tmdb_tv(title, year=year if year else None)
        for r in results:
            _add(r, 'title_year' if year else 'title_only')

    # 4. Title only (if year search gave few results)
    if title and year and len(matches) < 3:
        results = _search_tmdb_tv(title)
        for r in results:
            _add(r, 'title_only')

    # 5. Simplified title (articles)
    if title and len(matches) < 3:
        simplified = re.sub(r'^(the|a|an)\s+', '', title.lower(), flags=re.IGNORECASE).strip()
        if simplified and simplified != title.lower():
            results = _search_tmdb_tv(simplified, year=year if year else None)
            for r in results:
                _add(r, 'simplified')

    matches.sort(key=lambda m: m['score'], reverse=True)
    return matches[:5]


# ---------------------------------------------------------------------------
# DB and scanner
# ---------------------------------------------------------------------------

def _get_unmapped_config(instance_id):
    from src.primary.utils.database import get_database
    db = get_database()
    config = db.get_app_config_for_instance('tv_hunt_import_media', instance_id)
    if not config or not isinstance(config, dict):
        return {'items': [], 'last_scan': None, 'scan_in_progress': False}
    return config


def _save_unmapped_config(config, instance_id):
    from src.primary.utils.database import get_database
    db = get_database()
    db.save_app_config_for_instance('tv_hunt_import_media', instance_id, config)


def _scan_for_unmapped_series(instance_id):
    """Scan root folders for series folders not in TV collection."""
    folders = _get_root_folders_config(instance_id)
    collection = _get_collection_config(instance_id)

    known_tmdb_ids = set()
    known_title_year = set()
    for s in collection:
        if not isinstance(s, dict):
            continue
        tid = s.get('tmdb_id')
        if tid:
            known_tmdb_ids.add(int(tid) if isinstance(tid, (int, float)) else tid)
        title = _normalize_title_for_key(s.get('title') or s.get('name'))
        first_air = s.get('first_air_date') or ''
        year = first_air[:4] if len(first_air) >= 4 else ''
        if title:
            known_title_year.add((title, year))

    unmapped = []
    seen_paths = set()

    for folder_config in folders:
        root_path = (folder_config.get('path') or '').strip()
        if not root_path or not os.path.isdir(root_path):
            continue
        try:
            for name in sorted(os.listdir(root_path)):
                full_path = os.path.join(root_path, name)
                if not os.path.isdir(full_path):
                    continue
                if _should_skip_folder(name):
                    continue
                if full_path in seen_paths:
                    continue
                if not _has_video_files_recursive(full_path):
                    continue

                seen_paths.add(full_path)
                parsed = _parse_series_name(name)
                title = (parsed.get('title') or '').strip()
                if not title or len(title) < 2:
                    continue

                norm_title = _normalize_title_for_key(title)
                year = parsed.get('year', '')
                if (norm_title, year) in known_title_year:
                    continue
                if parsed.get('tmdb_id') and parsed['tmdb_id'] in known_tmdb_ids:
                    continue

                media_info = _get_folder_media_info(full_path)
                seasons_on_disk = _count_seasons_on_disk(full_path)

                unmapped.append({
                    'folder_path': full_path,
                    'folder_name': name,
                    'root_folder': root_path,
                    'parsed': parsed,
                    'seasons_on_disk': seasons_on_disk,
                    'media_info': media_info or {
                        'main_file': {'name': name, 'path': full_path, 'size': 0},
                        'total_size': 0,
                        'file_count': 0,
                    },
                })
        except OSError as e:
            logger.warning("TV Import Media: scan error for %s: %s", root_path, e)

    return unmapped


def _process_one_unmapped_item(item, tmdb_delay=0.2):
    if item.get('status') in ('matched', 'confirmed'):
        return False
    parsed = item.get('parsed', {})
    seasons_on_disk = item.get('seasons_on_disk')
    matches = _match_series_to_tmdb(parsed, seasons_on_disk=seasons_on_disk)
    if matches:
        item['matches'] = matches
        item['best_match'] = matches[0]
        item['status'] = 'matched'
    else:
        item['matches'] = []
        item['best_match'] = None
        item['status'] = 'no_match'
    item['processed_at'] = datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')
    time.sleep(tmdb_delay)
    return True


def run_import_media_scan(instance_id, max_match=None, lightweight=False):
    """Run full TV Import Media scan for an instance."""
    tmdb_delay = 1.0 if lightweight else 0.2
    if not _scan_lock.acquire(blocking=False):
        logger.info("TV Import Media: scan already in progress, skipping")
        return False

    try:
        config = _get_unmapped_config(instance_id)
        config['scan_in_progress'] = True
        _save_unmapped_config(config, instance_id)

        new_unmapped = _scan_for_unmapped_series(instance_id)
        logger.info("TV Import Media: found %d unmapped series for instance %s", len(new_unmapped), instance_id)

        existing_items = config.get('items', [])
        existing_by_path = {i.get('folder_path'): i for i in existing_items if isinstance(i, dict)}

        merged = []
        for new_item in new_unmapped:
            path = new_item['folder_path']
            if path in existing_by_path:
                existing = existing_by_path[path]
                if existing.get('status') in ('matched', 'confirmed', 'skipped', 'no_match'):
                    merged.append(existing)
                    continue
            new_item['status'] = 'pending'
            merged.append(new_item)

        pending_count = len([i for i in merged if i.get('status') in ('pending', None)])
        if pending_count:
            logger.info("TV Import Media: processing %d pending (one at a time)", pending_count)
        processed = 0
        while True:
            pending = [i for i in merged if i.get('status') in ('pending', None)]
            if not pending:
                break
            if max_match is not None and processed >= max_match:
                break
            item = pending[0]
            if _process_one_unmapped_item(item, tmdb_delay=tmdb_delay):
                processed += 1
                config['items'] = merged
                config['last_scan'] = datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')
                _save_unmapped_config(config, instance_id)

        config['items'] = merged
        config['last_scan'] = datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')
        config['scan_in_progress'] = False
        _save_unmapped_config(config, instance_id)

        logger.info("TV Import Media: scan complete. %d items (%d processed)", len(merged), processed)
        return True
    except Exception as e:
        logger.exception("TV Import Media scan error for instance %s: %s", instance_id, e)
        try:
            cfg = _get_unmapped_config(instance_id)
            cfg['scan_in_progress'] = False
            _save_unmapped_config(cfg, instance_id)
        except Exception:
            pass
        return False
    finally:
        _scan_lock.release()


# ---------------------------------------------------------------------------
# API routes
# ---------------------------------------------------------------------------

def _add_series_to_collection(instance_id, tmdb_id, title, root_folder, poster_path, first_air_date=''):
    """Add a TV series to the collection (fetches full details from TMDB)."""
    collection = _get_collection_config(instance_id)
    for s in collection:
        if s.get('tmdb_id') == tmdb_id:
            return False, 'already_exists'

    from src.primary.settings_manager import get_ssl_verify_setting
    verify_ssl = get_ssl_verify_setting()
    try:
        r = requests.get(
            f'{TMDB_BASE}/tv/{tmdb_id}',
            params={'api_key': TMDB_API_KEY, 'language': 'en-US'},
            timeout=15, verify=verify_ssl
        )
        if r.status_code != 200:
            return False, 'tmdb_fetch_failed'
        tmdb_data = r.json()
    except Exception as e:
        logger.debug("TV Import: TMDB fetch error: %s", e)
        return False, 'tmdb_fetch_failed'

    seasons_data = tmdb_data.get('seasons', [])
    normalized_seasons = []
    for s in seasons_data:
        season_num = s.get('season_number')
        if season_num is None:
            continue
        episodes = s.get('episodes') or []
        if not episodes:
            try:
                sr = requests.get(
                    f'{TMDB_BASE}/tv/{tmdb_id}/season/{season_num}',
                    params={'api_key': TMDB_API_KEY, 'language': 'en-US'},
                    timeout=10, verify=verify_ssl
                )
                if sr.status_code == 200:
                    episodes = sr.json().get('episodes', [])
            except Exception:
                pass
        normalized_episodes = [
            {'episode_number': ep.get('episode_number'), 'title': ep.get('name') or '', 'air_date': ep.get('air_date') or '',
             'overview': ep.get('overview') or '', 'still_path': ep.get('still_path') or '', 'monitored': True}
            for ep in episodes
        ]
        normalized_seasons.append({
            'season_number': season_num,
            'episode_count': s.get('episode_count') or len(normalized_episodes),
            'air_date': s.get('air_date') or '',
            'name': s.get('name') or f'Season {season_num}',
            'poster_path': s.get('poster_path') or '',
            'monitored': season_num > 0,
            'episodes': normalized_episodes,
        })

    root_folders = _get_root_folders_config(instance_id)
    default_root = root_folders[0]['path'] if root_folders else ''
    root_folder = (root_folder or default_root).strip() or default_root

    series_entry = {
        'tmdb_id': tmdb_id,
        'title': title or tmdb_data.get('name', ''),
        'overview': tmdb_data.get('overview', ''),
        'poster_path': poster_path or tmdb_data.get('poster_path', ''),
        'backdrop_path': tmdb_data.get('backdrop_path', ''),
        'first_air_date': first_air_date or tmdb_data.get('first_air_date', ''),
        'vote_average': tmdb_data.get('vote_average', 0),
        'genres': tmdb_data.get('genres', []),
        'status': tmdb_data.get('status', ''),
        'number_of_seasons': tmdb_data.get('number_of_seasons', 0),
        'number_of_episodes': tmdb_data.get('number_of_episodes', 0),
        'networks': tmdb_data.get('networks', []),
        'root_folder': root_folder,
        'quality_profile': '',
        'monitored': True,
        'added_at': datetime.now().isoformat(),
        'seasons': normalized_seasons,
    }
    collection.append(series_entry)
    _save_collection_config(collection, instance_id)
    return True, 'ok'


def run_import_media_background_cycle():
    """Daily background scan for all TV Hunt instances."""
    try:
        from src.primary.utils.database import get_database
        db = get_database()
        instances = db.get_tv_hunt_instances()
        if not instances:
            return
        for inst in instances:
            instance_id = inst.get('id', 1)
            config = _get_unmapped_config(instance_id)
            last_scan = config.get('last_scan')
            if last_scan:
                try:
                    last_dt = datetime.strptime(last_scan, '%Y-%m-%dT%H:%M:%SZ')
                    if (datetime.utcnow() - last_dt).total_seconds() < 86400:
                        continue
                except (ValueError, TypeError):
                    pass
            folders = _get_root_folders_config(instance_id)
            if not folders:
                continue
            logger.info("TV Import Media: starting daily background scan for instance %s", instance_id)
            run_import_media_scan(instance_id, max_match=None, lightweight=True)
    except Exception as e:
        logger.error("TV Import Media background cycle error: %s", e)


# ---------------------------------------------------------------------------
# HTTP API routes
# ---------------------------------------------------------------------------

def register_tv_import_media_routes(bp):
    @bp.route('/api/tv-hunt/import-media', methods=['GET'])
    def api_tv_import_media_list():
        """List unmapped TV series with match status."""
        try:
            instance_id = _get_tv_hunt_instance_id_from_request()
            if not instance_id:
                return jsonify({'success': False, 'items': [], 'total': 0}), 200
            config = _get_unmapped_config(instance_id)
            items = config.get('items', [])
            status_filter = (request.args.get('status') or '').strip()
            if status_filter:
                items = [i for i in items if i.get('status') == status_filter]
            out = []
            for item in items:
                if item.get('status') == 'confirmed':
                    continue
                mi = item.get('media_info', {})
                mf = mi.get('main_file', {})
                entry = {
                    'folder_path': item.get('folder_path', ''),
                    'folder_name': item.get('folder_name', ''),
                    'root_folder': item.get('root_folder', ''),
                    'parsed_title': item.get('parsed', {}).get('title', ''),
                    'parsed_year': item.get('parsed', {}).get('year', ''),
                    'status': item.get('status', 'pending'),
                    'file_size': mi.get('total_size', 0),
                    'file_count': mi.get('file_count', 0),
                    'main_file': mf.get('name', ''),
                    'best_match': item.get('best_match'),
                    'matches': item.get('matches', []),
                    'processed_at': item.get('processed_at'),
                }
                out.append(entry)
            return jsonify({
                'success': True,
                'items': out,
                'total': len(out),
                'last_scan': config.get('last_scan'),
                'scan_in_progress': config.get('scan_in_progress', False),
            }), 200
        except Exception as e:
            logger.exception("TV Import Media list error")
            return jsonify({'success': False, 'items': [], 'total': 0, 'error': str(e)}), 200
    
    
    @bp.route('/api/tv-hunt/import-media/scan', methods=['POST'])
    def api_tv_import_media_scan():
        """Trigger on-demand TV Import Media scan."""
        try:
            instance_id = _get_tv_hunt_instance_id_from_request()
            if not instance_id:
                return jsonify({'success': False, 'message': 'No instance selected'}), 400
            config = _get_unmapped_config(instance_id)
            if config.get('scan_in_progress'):
                return jsonify({'success': False, 'message': 'Scan already in progress'}), 200
    
            def _scan():
                run_import_media_scan(instance_id, max_match=None)
            threading.Thread(target=_scan, name="TVImportMediaScan", daemon=True).start()
            return jsonify({'success': True, 'message': 'Scan started'}), 200
        except Exception as e:
            logger.exception("TV Import Media scan trigger error")
            return jsonify({'success': False, 'message': str(e)}), 500
    
    
    @bp.route('/api/tv-hunt/import-media/search', methods=['GET'])
    def api_tv_import_media_search():
        """Manual TMDB TV search for rematch."""
        try:
            query = (request.args.get('q') or '').strip()
            year = (request.args.get('year') or '').strip()
            if not query:
                return jsonify({'success': False, 'results': [], 'message': 'Query is required'}), 400
            results = _search_tmdb_tv(query, year=year if year else None)
            out = []
            for r in results:
                first_air = r.get('first_air_date') or ''
                m_year = first_air[:4] if len(first_air) >= 4 else ''
                out.append({
                    'tmdb_id': r.get('id'),
                    'title': r.get('name', ''),
                    'original_title': r.get('original_name', ''),
                    'year': m_year,
                    'poster_path': r.get('poster_path') or '',
                    'overview': (r.get('overview') or '')[:300],
                    'vote_average': r.get('vote_average', 0),
                    'popularity': r.get('popularity', 0),
                })
            return jsonify({'success': True, 'results': out}), 200
        except Exception as e:
            logger.exception("TV Import Media search error")
            return jsonify({'success': False, 'results': [], 'error': str(e)}), 200
    
    
    @bp.route('/api/tv-hunt/import-media/confirm', methods=['POST'])
    def api_tv_import_media_confirm():
        """Confirm and import a matched TV series into the collection."""
        try:
            data = request.get_json() or {}
            folder_path = (data.get('folder_path') or '').strip()
            tmdb_id = data.get('tmdb_id')
            title = (data.get('title') or '').strip()
            year = (data.get('year') or '').strip()
            poster_path = (data.get('poster_path') or '').strip()
            root_folder = (data.get('root_folder') or '').strip()
    
            if not folder_path:
                return jsonify({'success': False, 'message': 'folder_path is required'}), 400
            if not tmdb_id or not title:
                return jsonify({'success': False, 'message': 'tmdb_id and title are required'}), 400
    
            instance_id = _get_tv_hunt_instance_id_from_request()
            if not instance_id:
                return jsonify({'success': False, 'message': 'No instance selected'}), 400
    
            ok, msg = _add_series_to_collection(
                instance_id, tmdb_id, title, root_folder, poster_path,
                first_air_date=year + '-01-01' if year else ''
            )
            if not ok:
                if msg == 'already_exists':
                    return jsonify({
                        'success': False,
                        'message': f'"{title}" is already in your TV Collection.',
                        'already_exists': True,
                    }), 200
                return jsonify({'success': False, 'message': 'Failed to add to collection'}), 200
    
            config = _get_unmapped_config(instance_id)
            for item in config.get('items', []):
                if item.get('folder_path') == folder_path:
                    item['status'] = 'confirmed'
                    item['confirmed_tmdb_id'] = tmdb_id
                    item['confirmed_at'] = datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')
                    break
            config['items'] = config.get('items', [])
            _save_unmapped_config(config, instance_id)
    
            logger.info("TV Import Media: confirmed '%s' (%s) [TMDB %s]", title, year, tmdb_id)
            return jsonify({'success': True, 'message': f'"{title}" imported to your TV Collection.'}), 200
        except Exception as e:
            logger.exception("TV Import Media confirm error")
            return jsonify({'success': False, 'message': str(e)}), 500
    
    
    @bp.route('/api/tv-hunt/import-media/confirm-all', methods=['POST'])
    def api_tv_import_media_confirm_all():
        """Confirm and import all matched TV series."""
        try:
            instance_id = _get_tv_hunt_instance_id_from_request()
            if not instance_id:
                return jsonify({'success': False, 'message': 'No instance selected'}), 400
            config = _get_unmapped_config(instance_id)
            items = config.get('items', [])
            collection = _get_collection_config(instance_id)
            known_tmdb_ids = {s.get('tmdb_id') for s in collection if s.get('tmdb_id')}
    
            imported = 0
            skipped = 0
            errors = []
            for item in items:
                if item.get('status') != 'matched':
                    continue
                best = item.get('best_match')
                if not best or not best.get('tmdb_id') or not best.get('title'):
                    continue
                tmdb_id = best['tmdb_id']
                if tmdb_id in known_tmdb_ids:
                    skipped += 1
                    item['status'] = 'confirmed'
                    continue
                y = (best.get('year') or '').strip()
                first_air = (y + '-01-01') if y else ''
                ok, msg = _add_series_to_collection(
                    instance_id, tmdb_id, best['title'],
                    item.get('root_folder', ''),
                    best.get('poster_path', ''),
                    first_air_date=first_air
                )
                if ok:
                    known_tmdb_ids.add(tmdb_id)
                    item['status'] = 'confirmed'
                    imported += 1
                else:
                    errors.append(f"{best['title']}: {msg}")
    
            config['items'] = items
            _save_unmapped_config(config, instance_id)
    
            msg = f'Imported {imported} series.'
            if skipped:
                msg += f' {skipped} already in collection.'
            if errors:
                msg += f' {len(errors)} error(s).'
            return jsonify({
                'success': True,
                'message': msg,
                'imported': imported,
                'skipped': skipped,
                'errors': errors,
            }), 200
        except Exception as e:
            logger.exception("TV Import Media confirm-all error")
            return jsonify({'success': False, 'message': str(e)}), 500
    
    
    @bp.route('/api/tv-hunt/import-media/skip', methods=['POST'])
    def api_tv_import_media_skip():
        """Skip an unmapped TV series."""
        try:
            data = request.get_json() or {}
            folder_path = (data.get('folder_path') or '').strip()
            if not folder_path:
                return jsonify({'success': False, 'message': 'folder_path is required'}), 400
            instance_id = _get_tv_hunt_instance_id_from_request()
            if not instance_id:
                return jsonify({'success': False, 'message': 'No instance selected'}), 400
            config = _get_unmapped_config(instance_id)
            for item in config.get('items', []):
                if item.get('folder_path') == folder_path:
                    item['status'] = 'skipped'
                    config['items'] = config.get('items', [])
                    _save_unmapped_config(config, instance_id)
                    return jsonify({'success': True}), 200
            return jsonify({'success': False, 'message': 'Item not found'}), 404
        except Exception as e:
            logger.exception("TV Import Media skip error")
            return jsonify({'success': False, 'message': str(e)}), 500
    
    
    @bp.route('/api/tv-hunt/import-media/rematch', methods=['POST'])
    def api_tv_import_media_rematch():
        """Re-match with user-provided query/year."""
        try:
            data = request.get_json() or {}
            folder_path = (data.get('folder_path') or '').strip()
            query = (data.get('query') or '').strip()
            year = (data.get('year') or '').strip()
            if not folder_path or not query:
                return jsonify({'success': False, 'message': 'folder_path and query required'}), 400
            instance_id = _get_tv_hunt_instance_id_from_request()
            if not instance_id:
                return jsonify({'success': False, 'message': 'No instance selected'}), 400
            config = _get_unmapped_config(instance_id)
            target = next((i for i in config.get('items', []) if i.get('folder_path') == folder_path), None)
            if not target:
                return jsonify({'success': False, 'message': 'Item not found'}), 404
            parsed = {'title': query, 'year': year, 'tmdb_id': None, 'tvdb_id': None}
            matches = _match_series_to_tmdb(parsed, target.get('seasons_on_disk'))
            target['matches'] = matches
            target['best_match'] = matches[0] if matches else None
            target['status'] = 'matched' if matches else 'no_match'
            target['processed_at'] = datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')
            config['items'] = config.get('items', [])
            _save_unmapped_config(config, instance_id)
            return jsonify({'success': True, 'matches': matches, 'best_match': matches[0] if matches else None}), 200
        except Exception as e:
            logger.exception("TV Import Media rematch error")
            return jsonify({'success': False, 'message': str(e)}), 500
