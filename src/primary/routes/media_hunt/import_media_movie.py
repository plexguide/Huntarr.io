"""Import Media system for Movie Hunt — scan root folders for unmapped movies,
match against TMDB, and let users confirm + import into their Media Collection.

Key design:
- Background daily scan detects folders/files in root folders not in the collection.
- Smart parser handles Plex, Emby, Jellyfin, and scene naming conventions.
- TMDB search finds best match for each unmapped item.
- On-demand scan when user visits the page processes any new/pending items.
- Users confirm matches and import into the Media Collection as "available".
"""

import os
import re
import time
import threading
from datetime import datetime

import requests
from flask import request, jsonify

from .helpers import _get_movie_hunt_instance_id_from_request, movie_hunt_logger
from .storage import get_movie_root_folders_config as _get_root_folders_config, _VIDEO_EXTENSIONS
from .discovery_movie import (
    _get_collection_config,
    _collection_append,
    _get_tmdb_api_key_movie_hunt,
    _normalize_title_for_key,
)

logger = movie_hunt_logger

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Additional video extensions beyond what storage.py defines
_EXTRA_VIDEO_EXTENSIONS = frozenset(('.iso', '.vob', '.divx', '.rmvb', '.3gp'))
_ALL_VIDEO_EXTENSIONS = _VIDEO_EXTENSIONS | _EXTRA_VIDEO_EXTENSIONS

# Sample/extra/junk patterns to skip
_SKIP_PATTERNS = re.compile(
    r'(?i)(^sample$|^extras?$|^bonus$|^featurettes?$|^behind.?the.?scenes?$'
    r'|^deleted.?scenes?$|^special.?features?$|^trailers?$|^subs?$|^subtitles?$'
    r'|^screenshots?$|^\..*|^@eaDir$|^#recycle$|^\.Trash|^lost\+found$'
    r'|^movies?$|^films?$|^downloads?$|^temp$|^tmp$|^incoming$|^incomplete$'
    r'|^moviehunt$|^movie.?hunt$|^plex$|^radarr$|^test$|^new$|^old$'
    r'|^backup$|^backups$|^archive$|^archives$)',
)

# Scene/release group tags to strip
_RELEASE_TAGS = re.compile(
    r'(?i)\b(REPACK|PROPER|RERIP|REAL|INTERNAL|READNFO|NFO|COMPLETE'
    r'|UNRATED|EXTENDED|THEATRICAL|DIRECTORS?.?CUT|FINAL.?CUT'
    r'|REMASTERED|RESTORED|IMAX|CRITERION|SPECIAL.?EDITION'
    r'|LIMITED|SUBBED|DUBBED|MULTI|DUAL|HYBRID'
    r'|BluRay|Blu-Ray|BDRip|BRRip|HDRip|WEB-?DL|WEBRip|WEB'
    r'|HDTV|DVDRip|DVDScr|DVDR?|CAM|TS|TC|SCR|R5|PPVRip'
    r'|REMUX|Remux|x264|x265|h\.?264|h\.?265|HEVC|AVC|AV1|VP9|XviD|DivX'
    r'|AAC|AC3|DD5\.?1|DDP5\.?1|DTS|DTS-?HD|DTS-?X|TrueHD|FLAC|EAC3|Atmos'
    r'|10bit|8bit|HDR10\+?|HDR|DV|DoVi|Dolby.?Vision'
    r'|2160p|1080p|1080i|720p|480p|576p|4K|UHD'
    r'|NF|AMZN|DSNP|HMAX|ATVP|PCOK|PMTP|iT|MA'
    r'|SPARKS|RARBG|YTS|YIFY|FGT|EVO|GECKOS|TERMINAL|AMIABLE'
    r'|TiGER|LOST|EPSiLON|d3g|STUTTERZ|NOGRP|ION10|playWEB'
    r')\b'
)

# Quality tags for extracting quality info
_QUALITY_PATTERN = re.compile(
    r'(?i)\b(2160p|1080p|1080i|720p|480p|576p|4K|UHD'
    r'|BluRay|Blu-Ray|BDRip|BRRip|WEB-?DL|WEBRip|WEB'
    r'|HDTV|DVDRip|REMUX|Remux)\b'
)

# Year range
_YEAR_RANGE = re.compile(r'\b(19\d{2}|20\d{2})\b')

# TMDB ID embedded in folder name (some tools do this)
_TMDB_PATTERN = re.compile(r'\{tmdb-(\d+)\}|\[tmdb[-=](\d+)\]|tmdbid[-=](\d+)', re.IGNORECASE)

# IMDB ID in folder name
_IMDB_PATTERN = re.compile(r'\{imdb-(tt\d+)\}|\[imdb[-=](tt\d+)\]|imdbid[-=](tt\d+)', re.IGNORECASE)

# Scan lock to prevent concurrent scans
_scan_lock = threading.Lock()

# ---------------------------------------------------------------------------
# Smart folder/file name parser
# ---------------------------------------------------------------------------

def _is_video_file(filename):
    """Check if a file has a video extension."""
    _, ext = os.path.splitext(filename)
    return ext.lower() in _ALL_VIDEO_EXTENSIONS


def _should_skip_folder(name):
    """Check if a folder should be skipped (samples, extras, system folders)."""
    return bool(_SKIP_PATTERNS.match(name))


def _get_folder_media_info(folder_path):
    """Get media file info from a folder: largest video file, total size, file count."""
    if not os.path.isdir(folder_path):
        return None

    video_files = []
    total_size = 0

    try:
        for name in os.listdir(folder_path):
            full = os.path.join(folder_path, name)
            if os.path.isfile(full) and _is_video_file(name):
                try:
                    size = os.path.getsize(full)
                    video_files.append({'name': name, 'path': full, 'size': size})
                    total_size += size
                except OSError:
                    pass
            elif os.path.isdir(full) and not _should_skip_folder(name):
                # Check one level deep for nested structures
                try:
                    for subname in os.listdir(full):
                        subfull = os.path.join(full, subname)
                        if os.path.isfile(subfull) and _is_video_file(subname):
                            try:
                                size = os.path.getsize(subfull)
                                video_files.append({'name': subname, 'path': subfull, 'size': size})
                                total_size += size
                            except OSError:
                                pass
                except OSError:
                    pass
    except OSError:
        return None

    if not video_files:
        return None

    # Sort by size descending - largest file is most likely the main feature
    video_files.sort(key=lambda f: f['size'], reverse=True)

    return {
        'main_file': video_files[0],
        'all_files': video_files,
        'total_size': total_size,
        'file_count': len(video_files),
    }


def _extract_embedded_ids(name):
    """Extract TMDB or IMDB IDs embedded in folder/file name."""
    tmdb_id = None
    imdb_id = None

    m = _TMDB_PATTERN.search(name)
    if m:
        tmdb_id = int(m.group(1) or m.group(2) or m.group(3))

    m = _IMDB_PATTERN.search(name)
    if m:
        imdb_id = (m.group(1) or m.group(2) or m.group(3))

    return tmdb_id, imdb_id


def _parse_movie_name(raw_name):
    """Parse a movie title and year from a folder or file name.

    Handles conventions from:
    - Plex: "Movie Title (2020)" or "Movie Title (2020) {tmdb-12345}"
    - Emby/Jellyfin: "Movie Title (2020) [tmdbid=12345]"
    - Scene: "Movie.Title.2020.1080p.BluRay.x264-GROUP"
    - Simple: "Movie Title 2020" or "Movie-Title-2020"
    - With quality tags: "Movie Title (2020) - 1080p BluRay"
    - Bracket metadata: "Movie Title [2020] [1080p]"

    Returns dict with: title, year, quality, tmdb_id, imdb_id
    """
    if not raw_name:
        return {'title': '', 'year': '', 'quality': '', 'tmdb_id': None, 'imdb_id': None}

    name = raw_name.strip()

    # Remove file extension if present
    for ext in _ALL_VIDEO_EXTENSIONS:
        if name.lower().endswith(ext):
            name = name[:-len(ext)].strip()
            break

    # Extract embedded IDs first (before we modify the string)
    tmdb_id, imdb_id = _extract_embedded_ids(name)

    # Remove embedded ID tags
    name = _TMDB_PATTERN.sub('', name)
    name = _IMDB_PATTERN.sub('', name)

    # Extract quality info before removing tags
    quality_matches = _QUALITY_PATTERN.findall(name)
    quality = ' '.join(quality_matches) if quality_matches else ''

    # Try to find year - check multiple patterns
    year = ''
    year_pos = -1

    # Pattern 1: Year in parentheses "(2020)" - Plex/Emby style
    paren_year = re.search(r'\((\d{4})\)', name)
    if paren_year:
        y = int(paren_year.group(1))
        if 1900 <= y <= 2099:
            year = str(y)
            year_pos = paren_year.start()

    # Pattern 2: Year in brackets "[2020]"
    if not year:
        bracket_year = re.search(r'\[(\d{4})\]', name)
        if bracket_year:
            y = int(bracket_year.group(1))
            if 1900 <= y <= 2099:
                year = str(y)
                year_pos = bracket_year.start()

    # Pattern 3: Bare year in scene naming "Movie.Title.2020.1080p"
    if not year:
        # Find years - prefer one followed by quality/release tags
        for m in _YEAR_RANGE.finditer(name):
            y = int(m.group(1))
            if 1900 <= y <= 2099:
                # Check what follows - if it's quality/release tags or end of string, this is the year
                after = name[m.end():].strip()
                after_clean = after.lstrip('.').lstrip('-').lstrip(' ')
                if not after_clean or _QUALITY_PATTERN.match(after_clean) or _RELEASE_TAGS.match(after_clean):
                    year = str(y)
                    year_pos = m.start()
                    break
        # If no year found with tag validation, take the last valid year
        if not year:
            all_years = list(_YEAR_RANGE.finditer(name))
            if all_years:
                for m in reversed(all_years):
                    y = int(m.group(1))
                    if 1900 <= y <= 2099:
                        year = str(y)
                        year_pos = m.start()
                        break

    # Extract title - everything before the year (or quality tags if no year)
    if year_pos >= 0:
        title_part = name[:year_pos].strip()
    else:
        # No year found - try to find where quality/release tags start
        first_tag = None
        for m in _RELEASE_TAGS.finditer(name):
            if m.start() > 5:  # Must be after at least some title chars
                first_tag = m.start()
                break
        if first_tag:
            title_part = name[:first_tag].strip()
        else:
            title_part = name.strip()

    # Clean up title
    # Remove trailing separators
    title_part = re.sub(r'[\.\-_\s]+$', '', title_part)
    # Remove leading separators
    title_part = re.sub(r'^[\.\-_\s]+', '', title_part)
    # Replace dots/underscores/hyphens with spaces (scene naming)
    title_part = title_part.replace('.', ' ').replace('_', ' ')
    # Collapse multiple hyphens but keep single ones (e.g. "Spider-Man")
    title_part = re.sub(r'\s*-\s*-+\s*', ' ', title_part)
    title_part = re.sub(r'\s+-\s*$', '', title_part)
    # Remove parenthesized tags like "(Extended)" "(IMAX)"
    title_part = re.sub(r'\s*\([^)]*\)\s*$', '', title_part)
    # Remove bracketed tags like "[Extended]" "[IMAX]"
    title_part = re.sub(r'\s*\[[^\]]*\]\s*$', '', title_part)
    # Remove remaining release tags
    title_part = _RELEASE_TAGS.sub(' ', title_part)
    # Collapse whitespace
    title_part = ' '.join(title_part.split()).strip()
    # Remove trailing "The" issue from bad splits
    title_part = re.sub(r'\s*,\s*The\s*$', '', title_part, flags=re.IGNORECASE)

    return {
        'title': title_part,
        'year': year,
        'quality': quality,
        'tmdb_id': tmdb_id,
        'imdb_id': imdb_id,
    }


# ---------------------------------------------------------------------------
# TMDB matching engine
# ---------------------------------------------------------------------------

def _search_tmdb(query, year=None):
    """Search TMDB for a movie by title (and optional year). Returns list of results."""
    api_key = _get_tmdb_api_key_movie_hunt()
    if not api_key:
        return []

    try:
        params = {'api_key': api_key, 'query': query, 'include_adult': 'false'}
        if year:
            params['year'] = year

        resp = requests.get(
            'https://api.themoviedb.org/3/search/movie',
            params=params, timeout=10,
        )
        if resp.status_code != 200:
            return []

        results = resp.json().get('results', [])
        return results[:10]  # Limit to top 10
    except Exception as e:
        logger.debug("TMDB search error for '%s': %s", query, e)
        return []


def _lookup_tmdb_by_id(tmdb_id):
    """Look up a movie by TMDB ID. Returns movie data or None."""
    api_key = _get_tmdb_api_key_movie_hunt()
    if not api_key or not tmdb_id:
        return None

    try:
        resp = requests.get(
            f'https://api.themoviedb.org/3/movie/{tmdb_id}',
            params={'api_key': api_key}, timeout=10,
        )
        if resp.status_code == 200:
            return resp.json()
    except Exception as e:
        logger.debug("TMDB lookup error for ID %s: %s", tmdb_id, e)
    return None


def _lookup_tmdb_by_imdb(imdb_id):
    """Look up a movie by IMDB ID via TMDB find. Returns TMDB movie data or None."""
    api_key = _get_tmdb_api_key_movie_hunt()
    if not api_key or not imdb_id:
        return None

    try:
        resp = requests.get(
            f'https://api.themoviedb.org/3/find/{imdb_id}',
            params={'api_key': api_key, 'external_source': 'imdb_id'}, timeout=10,
        )
        if resp.status_code == 200:
            results = resp.json().get('movie_results', [])
            if results:
                return results[0]
    except Exception as e:
        logger.debug("TMDB find by IMDB error for %s: %s", imdb_id, e)
    return None


def _score_tmdb_match(parsed, tmdb_result):
    """Score how well a TMDB result matches our parsed folder info (0-100)."""
    score = 0

    parsed_title = (parsed.get('title') or '').strip().lower()
    parsed_year = (parsed.get('year') or '').strip()

    tmdb_title = (tmdb_result.get('title') or '').lower()
    tmdb_original = (tmdb_result.get('original_title') or '').lower()
    tmdb_release = (tmdb_result.get('release_date') or '')
    tmdb_year = tmdb_release[:4] if len(tmdb_release) >= 4 else ''

    # Normalize for comparison
    def norm(s):
        s = re.sub(r'[^\w\s]', ' ', s.lower())
        return ' '.join(s.split())

    n_parsed = norm(parsed_title)
    n_tmdb = norm(tmdb_title)
    n_original = norm(tmdb_original)

    # Exact title match
    if n_parsed == n_tmdb or n_parsed == n_original:
        score += 50
    # Title contained in other
    elif n_parsed in n_tmdb or n_tmdb in n_parsed:
        score += 35
    elif n_parsed in n_original or n_original in n_parsed:
        score += 30
    # Word overlap
    else:
        p_words = set(n_parsed.split())
        t_words = set(n_tmdb.split())
        if p_words and t_words:
            overlap = len(p_words & t_words) / max(len(p_words), len(t_words))
            score += int(overlap * 30)

    # Year match
    if parsed_year and tmdb_year:
        if parsed_year == tmdb_year:
            score += 30
        elif abs(int(parsed_year) - int(tmdb_year)) <= 1:
            score += 15  # Off by one year (common with release date variations)

    # Popularity bonus (well-known movies more likely to be correct)
    popularity = tmdb_result.get('popularity', 0)
    if popularity > 50:
        score += 10
    elif popularity > 20:
        score += 7
    elif popularity > 5:
        score += 3

    # Vote count bonus (well-reviewed = more likely correct)
    vote_count = tmdb_result.get('vote_count', 0)
    if vote_count > 500:
        score += 5
    elif vote_count > 100:
        score += 3

    # Has poster (real movies tend to have posters)
    if tmdb_result.get('poster_path'):
        score += 5

    return min(score, 100)


def _match_folder_to_tmdb(parsed):
    """Try multiple strategies to match a parsed folder to a TMDB movie.

    Strategy order:
    1. Direct TMDB ID lookup (if embedded in folder name)
    2. IMDB ID lookup -> TMDB (if embedded)
    3. TMDB search with title + year
    4. TMDB search with title only (broader)
    5. TMDB search with simplified title (remove articles, suffixes)

    Returns list of matches: [{tmdb_id, title, year, poster_path, score, vote_average}, ...]
    """
    matches = []
    seen_ids = set()

    title = (parsed.get('title') or '').strip()
    year = (parsed.get('year') or '').strip()
    embedded_tmdb_id = parsed.get('tmdb_id')
    embedded_imdb_id = parsed.get('imdb_id')

    def _add_result(tmdb_data, strategy, bonus=0):
        """Add a TMDB result to matches if not already seen."""
        tid = tmdb_data.get('id') or tmdb_data.get('tmdb_id')
        if not tid or tid in seen_ids:
            return
        seen_ids.add(tid)
        s = _score_tmdb_match(parsed, tmdb_data) + bonus
        release_date = tmdb_data.get('release_date') or ''
        m_year = release_date[:4] if len(release_date) >= 4 else ''
        poster = tmdb_data.get('poster_path') or ''
        matches.append({
            'tmdb_id': tid,
            'title': tmdb_data.get('title') or '',
            'original_title': tmdb_data.get('original_title') or '',
            'year': m_year,
            'poster_path': poster,
            'overview': (tmdb_data.get('overview') or '')[:300],
            'vote_average': tmdb_data.get('vote_average', 0),
            'popularity': tmdb_data.get('popularity', 0),
            'score': min(s, 100),
            'strategy': strategy,
        })

    # Strategy 1: Direct TMDB ID
    if embedded_tmdb_id:
        data = _lookup_tmdb_by_id(embedded_tmdb_id)
        if data:
            _add_result(data, 'tmdb_id', bonus=20)

    # Strategy 2: IMDB ID -> TMDB
    if embedded_imdb_id:
        data = _lookup_tmdb_by_imdb(embedded_imdb_id)
        if data:
            _add_result(data, 'imdb_id', bonus=15)

    # Strategy 3: Title + Year search
    if title:
        results = _search_tmdb(title, year=year if year else None)
        for r in results:
            _add_result(r, 'title_year' if year else 'title_only')

    # Strategy 4: Title only (if we searched with year and got < 3 results)
    if title and year and len(matches) < 3:
        results = _search_tmdb(title)
        for r in results:
            _add_result(r, 'title_only')

    # Strategy 5: Simplified title (remove common prefixes/suffixes/articles)
    if title and len(matches) < 3:
        simplified = re.sub(r'^(the|a|an|el|la|le|les|der|die|das)\s+', '', title.lower(), flags=re.IGNORECASE)
        # Remove "Part X", "Vol X", etc.
        simplified = re.sub(r'\s*(part|vol|volume)\s*\d+\s*$', '', simplified, flags=re.IGNORECASE)
        simplified = simplified.strip()
        if simplified and simplified.lower() != title.lower():
            results = _search_tmdb(simplified, year=year if year else None)
            for r in results:
                _add_result(r, 'simplified')

    # Sort by score descending
    matches.sort(key=lambda m: m['score'], reverse=True)

    return matches[:5]  # Return top 5


# ---------------------------------------------------------------------------
# Database: Unmapped folder storage
# ---------------------------------------------------------------------------

def _get_unmapped_config(instance_id):
    """Get import media unmapped items from database."""
    from src.primary.utils.database import get_database
    db = get_database()
    config = db.get_app_config_for_instance('movie_hunt_import_media', instance_id)
    if not config or not isinstance(config, dict):
        return {'items': [], 'last_scan': None, 'scan_in_progress': False}
    return config


def _save_unmapped_config(config, instance_id):
    """Save import media unmapped items to database."""
    from src.primary.utils.database import get_database
    db = get_database()
    db.save_app_config_for_instance('movie_hunt_import_media', instance_id, config)


# ---------------------------------------------------------------------------
# Scanner: Find unmapped folders
# ---------------------------------------------------------------------------

def _scan_for_unmapped_folders(instance_id):
    """Scan root folders and find folders not in the Media Collection.

    Returns list of unmapped items with parsed info.
    """
    folders = _get_root_folders_config(instance_id)
    collection = _get_collection_config(instance_id)

    # Build set of known movies (by normalized title+year and by tmdb_id)
    known_tmdb_ids = set()
    known_title_year = set()
    for item in collection:
        if not isinstance(item, dict):
            continue
        tid = item.get('tmdb_id')
        if tid:
            known_tmdb_ids.add(int(tid) if isinstance(tid, (int, float)) else tid)
        title = _normalize_title_for_key(item.get('title'))
        year = str(item.get('year') or '').strip()
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

                # Skip non-directories and system/sample folders
                if not os.path.isdir(full_path):
                    # Handle loose video files at root level
                    if os.path.isfile(full_path) and _is_video_file(name):
                        if full_path in seen_paths:
                            continue
                        seen_paths.add(full_path)

                        parsed = _parse_movie_name(name)
                        title = parsed.get('title', '').strip()
                        if not title:
                            continue

                        # Check if already in collection
                        norm_title = _normalize_title_for_key(title)
                        year = parsed.get('year', '')
                        if (norm_title, year) in known_title_year:
                            continue
                        if parsed.get('tmdb_id') and parsed['tmdb_id'] in known_tmdb_ids:
                            continue

                        try:
                            file_size = os.path.getsize(full_path)
                        except OSError:
                            file_size = 0

                        unmapped.append({
                            'folder_path': full_path,
                            'folder_name': name,
                            'root_folder': root_path,
                            'is_file': True,
                            'parsed': parsed,
                            'media_info': {
                                'main_file': {'name': name, 'path': full_path, 'size': file_size},
                                'total_size': file_size,
                                'file_count': 1,
                            },
                        })
                    continue

                if _should_skip_folder(name):
                    continue

                if full_path in seen_paths:
                    continue
                seen_paths.add(full_path)

                # Get media info from folder
                media_info = _get_folder_media_info(full_path)
                if not media_info:
                    continue  # No video files = skip

                # Parse the folder name
                parsed = _parse_movie_name(name)
                title = parsed.get('title', '').strip()

                # If folder name didn't yield a good title, try the main video file
                if not title or len(title) < 2:
                    main_file = media_info['main_file']['name']
                    parsed = _parse_movie_name(main_file)
                    title = parsed.get('title', '').strip()

                if not title:
                    continue

                # Check if already in collection
                norm_title = _normalize_title_for_key(title)
                year = parsed.get('year', '')

                if (norm_title, year) in known_title_year:
                    continue
                if parsed.get('tmdb_id') and parsed['tmdb_id'] in known_tmdb_ids:
                    continue

                unmapped.append({
                    'folder_path': full_path,
                    'folder_name': name,
                    'root_folder': root_path,
                    'is_file': False,
                    'parsed': parsed,
                    'media_info': {
                        'main_file': media_info['main_file'],
                        'total_size': media_info['total_size'],
                        'file_count': media_info['file_count'],
                    },
                })
        except OSError as e:
            logger.warning("Import Media: error scanning %s: %s", root_path, e)

    return unmapped


def _process_one_unmapped_item(item, tmdb_delay=0.2):
    """Process a single unmapped item through TMDB. Mutates item in place. Returns True if processed.
    tmdb_delay: seconds between items (0.2=fast for on-demand, 1.0=lightweight for background).
    """
    if item.get('status') in ('matched', 'confirmed'):
        return False
    parsed = item.get('parsed', {})
    matches = _match_folder_to_tmdb(parsed)
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


# ---------------------------------------------------------------------------
# Full scan cycle (background or on-demand)
# ---------------------------------------------------------------------------

def run_import_media_scan(instance_id, max_match=None, lightweight=False):
    """Run a full scan cycle for an instance:
    1. Scan root folders for unmapped items
    2. Merge with existing unmapped config (keep user confirmations)
    3. Process unmatched items through TMDB (one at a time, save after each)
    4. Save results
    max_match: None = process all pending; int = limit (e.g. for background scans).
    lightweight: if True, use longer delays (1s) between TMDB calls to reduce CPU/network load when running in background.
    """
    tmdb_delay = 1.0 if lightweight else 0.2
    if not _scan_lock.acquire(blocking=False):
        logger.info("Import Media: scan already in progress, skipping")
        return False

    try:
        config = _get_unmapped_config(instance_id)
        config['scan_in_progress'] = True
        _save_unmapped_config(config, instance_id)

        # Step 1: Scan filesystem
        logger.info("Import Media: scanning root folders for instance %s", instance_id)
        new_unmapped = _scan_for_unmapped_folders(instance_id)
        logger.info("Import Media: found %d unmapped items on disk", len(new_unmapped))

        # Step 2: Merge with existing data (preserve matches and user actions)
        existing_items = config.get('items', [])
        existing_by_path = {item.get('folder_path'): item for item in existing_items if isinstance(item, dict)}

        merged = []
        new_paths = set()

        for new_item in new_unmapped:
            path = new_item['folder_path']
            new_paths.add(path)

            if path in existing_by_path:
                existing = existing_by_path[path]
                # Keep existing data if already processed (don't restart/reprocess)
                if existing.get('status') in ('matched', 'confirmed', 'skipped', 'no_match'):
                    merged.append(existing)
                else:
                    merged.append(new_item)
            else:
                new_item['status'] = 'pending'
                merged.append(new_item)

        # Remove items whose folders no longer exist
        # (they were moved, deleted, or added to collection)

        # Step 3: Process one item at a time, save after each (avoids stall/timeout)
        pending_count = len([i for i in merged if i.get('status') in ('pending', None)])
        if pending_count:
            logger.info("Import Media: processing %d pending items (one at a time)", pending_count)
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

        logger.info("Import Media: scan complete. %d unmapped items total (%d processed).", len(merged), processed)
        return True

    except Exception as e:
        logger.exception("Import Media: scan error for instance %s: %s", instance_id, e)
        try:
            config = _get_unmapped_config(instance_id)
            config['scan_in_progress'] = False
            _save_unmapped_config(config, instance_id)
        except Exception:
            pass
        return False
    finally:
        _scan_lock.release()


# ---------------------------------------------------------------------------
# Background daily scan
# ---------------------------------------------------------------------------

def run_import_media_background_cycle():
    """Background cycle: run daily scan for all Movie Hunt instances.
    Called by the background thread.
    """
    try:
        from src.primary.utils.database import get_database
        db = get_database()
        instances = db.get_movie_hunt_instances()
        if not instances:
            return

        for inst in instances:
            instance_id = inst.get('id', 1)
            config = _get_unmapped_config(instance_id)

            # Check if we need to scan (once per day)
            last_scan = config.get('last_scan')
            if last_scan:
                try:
                    last_dt = datetime.strptime(last_scan, '%Y-%m-%dT%H:%M:%SZ')
                    elapsed = (datetime.utcnow() - last_dt).total_seconds()
                    if elapsed < 86400:  # 24 hours
                        continue
                except (ValueError, TypeError):
                    pass

            # Check if root folders are configured
            folders = _get_root_folders_config(instance_id)
            if not folders:
                continue

            logger.info("Import Media: starting daily background scan for instance %s", instance_id)
            run_import_media_scan(instance_id, max_match=None, lightweight=True)

    except Exception as e:
        logger.error("Import Media: background cycle error: %s", e)


# ---------------------------------------------------------------------------
# API Routes
# ---------------------------------------------------------------------------

def register_movie_import_media_routes(bp):
    @bp.route('/api/movie-hunt/import-media', methods=['GET'])
    def api_import_media_list():
        """List unmapped folders with their match status."""
        try:
            instance_id = _get_movie_hunt_instance_id_from_request()
            config = _get_unmapped_config(instance_id)
    
            items = config.get('items', [])
            # Filter by status if requested
            status_filter = request.args.get('status', '').strip()
            if status_filter:
                items = [i for i in items if i.get('status') == status_filter]
    
            # Prepare items for frontend (strip large data)
            out = []
            for item in items:
                if item.get('status') == 'confirmed':
                    continue  # Don't show already-imported items
    
                media_info = item.get('media_info', {})
                main_file = media_info.get('main_file', {})
    
                entry = {
                    'folder_path': item.get('folder_path', ''),
                    'folder_name': item.get('folder_name', ''),
                    'root_folder': item.get('root_folder', ''),
                    'is_file': item.get('is_file', False),
                    'parsed_title': item.get('parsed', {}).get('title', ''),
                    'parsed_year': item.get('parsed', {}).get('year', ''),
                    'parsed_quality': item.get('parsed', {}).get('quality', ''),
                    'status': item.get('status', 'pending'),
                    'file_size': media_info.get('total_size', 0),
                    'file_count': media_info.get('file_count', 0),
                    'main_file': main_file.get('name', ''),
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
            logger.exception("Import Media list error")
            return jsonify({'success': False, 'items': [], 'total': 0, 'error': str(e)}), 200
    
    
    @bp.route('/api/movie-hunt/import-media/scan', methods=['POST'])
    def api_import_media_scan():
        """Trigger an on-demand scan for unmapped folders."""
        try:
            instance_id = _get_movie_hunt_instance_id_from_request()
            config = _get_unmapped_config(instance_id)
    
            if config.get('scan_in_progress'):
                return jsonify({'success': False, 'message': 'Scan already in progress'}), 200
    
            # Run scan in background thread so we don't block the request
            def _scan():
                run_import_media_scan(instance_id, max_match=None)
    
            thread = threading.Thread(target=_scan, name="ImportMediaScan", daemon=True)
            thread.start()
    
            return jsonify({'success': True, 'message': 'Scan started'}), 200
    
        except Exception as e:
            logger.exception("Import Media scan trigger error")
            return jsonify({'success': False, 'message': str(e)}), 500
    
    
    @bp.route('/api/movie-hunt/import-media/search', methods=['GET'])
    def api_import_media_search():
        """Manual TMDB search for a specific unmapped folder (user override)."""
        try:
            query = (request.args.get('q') or '').strip()
            year = (request.args.get('year') or '').strip()
            if not query:
                return jsonify({'success': False, 'results': [], 'message': 'Query is required'}), 400
    
            results = _search_tmdb(query, year=year if year else None)
            out = []
            for r in results:
                release_date = r.get('release_date') or ''
                m_year = release_date[:4] if len(release_date) >= 4 else ''
                out.append({
                    'tmdb_id': r.get('id'),
                    'title': r.get('title', ''),
                    'original_title': r.get('original_title', ''),
                    'year': m_year,
                    'poster_path': r.get('poster_path') or '',
                    'overview': (r.get('overview') or '')[:300],
                    'vote_average': r.get('vote_average', 0),
                    'popularity': r.get('popularity', 0),
                })
    
            return jsonify({'success': True, 'results': out}), 200
    
        except Exception as e:
            logger.exception("Import Media search error")
            return jsonify({'success': False, 'results': [], 'error': str(e)}), 200
    
    
    @bp.route('/api/movie-hunt/import-media/confirm', methods=['POST'])
    def api_import_media_confirm():
        """Confirm and import a matched movie into the Media Collection."""
        try:
            data = request.get_json() or {}
            folder_path = (data.get('folder_path') or '').strip()
            tmdb_id = data.get('tmdb_id')
            title = (data.get('title') or '').strip()
            year = (data.get('year') or '').strip()
            poster_path = (data.get('poster_path') or '').strip()
    
            if not folder_path:
                return jsonify({'success': False, 'message': 'folder_path is required'}), 400
            if not tmdb_id or not title:
                return jsonify({'success': False, 'message': 'tmdb_id and title are required'}), 400
    
            instance_id = _get_movie_hunt_instance_id_from_request()
    
            # Check if already in collection
            collection = _get_collection_config(instance_id)
            for item in collection:
                if item.get('tmdb_id') == tmdb_id:
                    return jsonify({
                        'success': False,
                        'message': f'"{title}" is already in your Media Collection.',
                        'already_exists': True,
                    }), 200
    
            # Determine root folder from the path
            root_folder = data.get('root_folder') or ''
    
            # Add to collection as "available" (it's already on disk)
            _collection_append(
                title=title,
                year=year,
                instance_id=instance_id,
                tmdb_id=tmdb_id,
                poster_path=poster_path,
                root_folder=root_folder,
            )
    
            # Mark item as confirmed in unmapped config
            config = _get_unmapped_config(instance_id)
            items = config.get('items', [])
            for item in items:
                if item.get('folder_path') == folder_path:
                    item['status'] = 'confirmed'
                    item['confirmed_tmdb_id'] = tmdb_id
                    item['confirmed_at'] = datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')
                    break
            config['items'] = items
            _save_unmapped_config(config, instance_id)
    
            # Update the collection item status to available since it's on disk
            collection = _get_collection_config(instance_id)
            for item in collection:
                if item.get('tmdb_id') == tmdb_id and (item.get('status') or '').lower() != 'available':
                    item['status'] = 'available'
                    from .discovery_movie import _save_collection_config
                    _save_collection_config(collection, instance_id)
                    break
    
            logger.info("Import Media: confirmed '%s' (%s) [TMDB %s] from %s", title, year, tmdb_id, folder_path)
    
            return jsonify({
                'success': True,
                'message': f'"{title}" ({year}) imported to your Media Collection.',
            }), 200
    
        except Exception as e:
            logger.exception("Import Media confirm error")
            return jsonify({'success': False, 'message': str(e)}), 500
    
    
    @bp.route('/api/movie-hunt/import-media/confirm-all', methods=['POST'])
    def api_import_media_confirm_all():
        """Confirm and import all matched movies at once."""
        try:
            instance_id = _get_movie_hunt_instance_id_from_request()
            config = _get_unmapped_config(instance_id)
            items = config.get('items', [])
    
            imported_count = 0
            skipped_count = 0
            errors = []
    
            collection = _get_collection_config(instance_id)
            known_tmdb_ids = {item.get('tmdb_id') for item in collection if item.get('tmdb_id')}
    
            for item in items:
                if item.get('status') != 'matched':
                    continue
    
                best = item.get('best_match')
                if not best or not best.get('tmdb_id') or not best.get('title'):
                    continue
    
                tmdb_id = best['tmdb_id']
                if tmdb_id in known_tmdb_ids:
                    skipped_count += 1
                    item['status'] = 'confirmed'
                    continue
    
                try:
                    _collection_append(
                        title=best['title'],
                        year=best.get('year', ''),
                        instance_id=instance_id,
                        tmdb_id=tmdb_id,
                        poster_path=best.get('poster_path', ''),
                        root_folder=item.get('root_folder', ''),
                    )
                    known_tmdb_ids.add(tmdb_id)
                    item['status'] = 'confirmed'
                    item['confirmed_tmdb_id'] = tmdb_id
                    item['confirmed_at'] = datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')
                    imported_count += 1
                except Exception as e:
                    errors.append(f"{best['title']}: {str(e)}")
    
            # Update all imported items to available
            updated_collection = _get_collection_config(instance_id)
            collection_updated = False
            for c_item in updated_collection:
                if c_item.get('tmdb_id') in known_tmdb_ids and (c_item.get('status') or '').lower() != 'available':
                    c_item['status'] = 'available'
                    collection_updated = True
            if collection_updated:
                from .discovery_movie import _save_collection_config
                _save_collection_config(updated_collection, instance_id)
    
            config['items'] = items
            _save_unmapped_config(config, instance_id)
    
            msg = f'Imported {imported_count} movie{"s" if imported_count != 1 else ""}.'
            if skipped_count:
                msg += f' {skipped_count} already in collection.'
            if errors:
                msg += f' {len(errors)} error(s).'
    
            logger.info("Import Media: bulk confirm — %d imported, %d skipped, %d errors", imported_count, skipped_count, len(errors))
    
            return jsonify({
                'success': True,
                'message': msg,
                'imported': imported_count,
                'skipped': skipped_count,
                'errors': errors,
            }), 200
    
        except Exception as e:
            logger.exception("Import Media confirm-all error")
            return jsonify({'success': False, 'message': str(e)}), 500
    
    
    @bp.route('/api/movie-hunt/import-media/skip', methods=['POST'])
    def api_import_media_skip():
        """Skip/dismiss an unmapped item so it doesn't show again."""
        try:
            data = request.get_json() or {}
            folder_path = (data.get('folder_path') or '').strip()
            if not folder_path:
                return jsonify({'success': False, 'message': 'folder_path is required'}), 400
    
            instance_id = _get_movie_hunt_instance_id_from_request()
            config = _get_unmapped_config(instance_id)
            items = config.get('items', [])
            found = False
            for item in items:
                if item.get('folder_path') == folder_path:
                    item['status'] = 'skipped'
                    found = True
                    break
    
            if not found:
                return jsonify({'success': False, 'message': 'Item not found'}), 404
    
            config['items'] = items
            _save_unmapped_config(config, instance_id)
    
            return jsonify({'success': True}), 200
    
        except Exception as e:
            logger.exception("Import Media skip error")
            return jsonify({'success': False, 'message': str(e)}), 500
    
    
    @bp.route('/api/movie-hunt/import-media/rematch', methods=['POST'])
    def api_import_media_rematch():
        """Re-match a specific item with a user-provided title/year."""
        try:
            data = request.get_json() or {}
            folder_path = (data.get('folder_path') or '').strip()
            query = (data.get('query') or '').strip()
            year = (data.get('year') or '').strip()
    
            if not folder_path:
                return jsonify({'success': False, 'message': 'folder_path is required'}), 400
            if not query:
                return jsonify({'success': False, 'message': 'query is required'}), 400
    
            instance_id = _get_movie_hunt_instance_id_from_request()
            config = _get_unmapped_config(instance_id)
            items = config.get('items', [])
    
            target = None
            for item in items:
                if item.get('folder_path') == folder_path:
                    target = item
                    break
    
            if not target:
                return jsonify({'success': False, 'message': 'Item not found'}), 404
    
            # Search TMDB with user-provided query
            parsed = {'title': query, 'year': year, 'tmdb_id': None, 'imdb_id': None}
            matches = _match_folder_to_tmdb(parsed)
    
            target['matches'] = matches
            target['best_match'] = matches[0] if matches else None
            target['status'] = 'matched' if matches else 'no_match'
            target['processed_at'] = datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')
    
            config['items'] = items
            _save_unmapped_config(config, instance_id)
    
            return jsonify({
                'success': True,
                'matches': matches,
                'best_match': matches[0] if matches else None,
            }), 200
    
        except Exception as e:
            logger.exception("Import Media rematch error")
            return jsonify({'success': False, 'message': str(e)}), 500
