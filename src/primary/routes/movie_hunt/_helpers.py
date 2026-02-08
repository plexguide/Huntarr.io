"""Shared private helpers for Movie Hunt routes."""

import re
import time
from flask import request

from ...utils.logger import logger, get_logger

movie_hunt_logger = get_logger("movie_hunt")

# --- Constants ---
MOVIE_HUNT_QUEUE_CATEGORY = 'moviehunt'
MOVIE_HUNT_DEFAULT_CATEGORY = 'moviehunt'


# --- Instance ID ---

def _get_movie_hunt_instance_id_from_request():
    """Current Movie Hunt instance: query param instance_id or server-stored current. Never tied to Radarr."""
    from src.primary.utils.database import get_database
    db = get_database()
    instance_id = request.args.get('instance_id', type=int)
    if instance_id is not None:
        return instance_id
    return db.get_current_movie_hunt_instance_id()


# --- Download client URL ---

def _download_client_base_url(client):
    """Build base URL for a download client (host:port)."""
    host = (client.get('host') or '').strip()
    if not host:
        return None
    if not (host.startswith('http://') or host.startswith('https://')):
        host = 'http://' + host
    port = client.get('port', 8080)
    return '%s:%s' % (host.rstrip('/'), port)


# --- Filename parsing ---

def _extract_year_from_filename(filename):
    """Extract a 4-digit year (1900-2099) from a release filename. Returns None if not found."""
    if not filename:
        return None
    m = re.search(r'\b(19\d{2}|20\d{2})\b', filename)
    return m.group(1) if m else None


def _extract_quality_from_filename(filename):
    """Extract a short quality/resolution string from a release filename for the queue QUALITY column."""
    if not filename or not (filename or '').strip():
        return '-'
    t = (filename or '').lower()
    parts = []
    if '2160' in t:
        parts.append('2160p')
    elif '1080' in t:
        parts.append('1080p')
    elif '720' in t:
        parts.append('720p')
    elif '480' in t:
        parts.append('480p')
    elif 'sdtv' in t or ('sd' in t and '720' not in t and '1080' not in t):
        parts.append('SDTV')
    if 'remux' in t:
        parts.append('Remux')
    if 'bluray' in t or 'blu-ray' in t or 'brrip' in t or 'bdrip' in t:
        parts.append('BluRay')
    elif 'web' in t or 'web-dl' in t or 'webdl' in t or 'webrip' in t:
        parts.append('WEB')
    elif 'hdtv' in t:
        parts.append('HDTV')
    elif 'dvd' in t and 'dvdscr' not in t:
        parts.append('DVD')
    if not parts:
        return '-'
    return ' '.join(parts)


def _extract_formats_from_filename(filename):
    """Extract video/audio format (codec) string from a release filename for the queue FORMATS column."""
    if not filename or not (filename or '').strip():
        return '-'
    t = (filename or '').upper()
    t_flat = t.replace('.', ' ').replace('-', ' ').replace('_', ' ')
    parts = []
    if 'HEVC' in t or 'X265' in t or 'H265' in t or 'H.265' in t:
        parts.append('H.265')
    elif 'AV1' in t:
        parts.append('AV1')
    elif 'VP9' in t:
        parts.append('VP9')
    elif 'X264' in t or 'H264' in t or 'H.264' in t:
        parts.append('H.264')
    elif 'XVID' in t or 'DIVX' in t:
        parts.append('XviD')
    if 'ATMOS' in t:
        parts.append('Atmos')
    if 'DDP' in t or 'DOLBY' in t and 'DIGITAL' in t_flat:
        if 'Atmos' not in parts:
            parts.append('DDP')
    elif 'DTS' in t:
        parts.append('DTS')
    if 'AAC' in t and 'AAC' not in ' '.join(parts):
        parts.append('AAC')
    if 'AC3' in t or 'DD 5' in t_flat or 'DD5' in t:
        if 'DDP' not in parts and 'AAC' not in parts:
            parts.append('AC3')
    if 'FLAC' in t:
        parts.append('FLAC')
    if not parts:
        return '-'
    return ' / '.join(parts)


# --- Queue display formatting ---

def _format_queue_scoring(score, score_breakdown=None):
    """Format scoring for queue column: '95 (1080p +30, WEB +20)' or '95' or '-'."""
    if score is None:
        return '-'
    try:
        s = int(score)
    except (TypeError, ValueError):
        return '-'
    br = (score_breakdown or '').strip()
    if br:
        return '%d (%s)' % (s, br)
    return str(s)


def _format_queue_display_name(filename, title=None, year=None):
    """Format display as 'Title (Year)' or 'Title'. Uses stored title/year if present, else parses filename."""
    display_title = (title or '').strip()
    display_year = (year or '').strip()
    if not display_year and filename:
        display_year = _extract_year_from_filename(filename) or ''
    if display_title:
        if display_year:
            return '%s (%s)' % (display_title, display_year)
        return display_title
    if not filename:
        return '-'
    clean = filename.replace('.', ' ').strip()
    if display_year:
        return '%s (%s)' % (clean, display_year)
    return clean


# --- Blocklist ---

def _blocklist_normalize_source_title(s):
    """Normalize release title for blocklist matching (case-insensitive, strip)."""
    if not s:
        return ''
    return str(s).strip().lower()


def _get_blocklist_raw(instance_id):
    """Return list of blocklist entries: { source_title, movie_title, year, reason_failed, date_added }."""
    try:
        from src.primary.utils.database import get_database
        db = get_database()
        config = db.get_app_config_for_instance('movie_hunt_blocklist', instance_id)
        if not config or not isinstance(config.get('entries'), list):
            return []
        return list(config['entries'])
    except Exception as e:
        logger.debug("Blocklist get error: %s", e)
        return []


def _get_blocklist_source_titles(instance_id):
    """Return set of normalized source titles for filtering search results."""
    entries = _get_blocklist_raw(instance_id)
    return frozenset(_blocklist_normalize_source_title(e.get('source_title')) for e in entries if (e.get('source_title') or '').strip())


def _blocklist_add(movie_title, year, source_title, reason_failed, instance_id):
    """Add a release to the blocklist (e.g. after SAB reports failed)."""
    if not (source_title or '').strip():
        return
    try:
        from src.primary.utils.database import get_database
        db = get_database()
        config = db.get_app_config_for_instance('movie_hunt_blocklist', instance_id) or {}
        entries = list(config.get('entries') or [])
        norm = _blocklist_normalize_source_title(source_title)
        if any(_blocklist_normalize_source_title(e.get('source_title')) == norm for e in entries):
            return
        entries.append({
            'source_title': (source_title or '').strip(),
            'movie_title': (movie_title or '').strip(),
            'year': (year or '').strip(),
            'reason_failed': (reason_failed or 'Download failed').strip()[:500],
            'date_added': time.time()
        })
        config['entries'] = entries
        db.save_app_config_for_instance('movie_hunt_blocklist', instance_id, config)
    except Exception as e:
        logger.error("Blocklist add error: %s", e)


def _blocklist_remove(source_titles, instance_id):
    """Remove one or more entries by source_title. source_titles: list of str."""
    if not source_titles or not isinstance(source_titles, list):
        return
    try:
        from src.primary.utils.database import get_database
        db = get_database()
        config = db.get_app_config_for_instance('movie_hunt_blocklist', instance_id)
        if not config or not isinstance(config.get('entries'), list):
            return
        to_remove = frozenset(_blocklist_normalize_source_title(s) for s in source_titles if (s or '').strip())
        if not to_remove:
            return
        entries = [e for e in config['entries'] if _blocklist_normalize_source_title(e.get('source_title')) not in to_remove]
        config['entries'] = entries
        db.save_app_config_for_instance('movie_hunt_blocklist', instance_id, config)
    except Exception as e:
        logger.error("Blocklist remove error: %s", e)


# --- Requested queue ID tracking ---

def _get_requested_queue_ids(instance_id):
    """Return dict of client_name -> set of queue ids (nzo_id / NZBID) that we requested for this instance."""
    from src.primary.utils.database import get_database
    db = get_database()
    config = db.get_app_config_for_instance('movie_hunt_requested', instance_id)
    if not config or not isinstance(config.get('by_client'), dict):
        return {}
    out = {}
    for cname, entries in config['by_client'].items():
        if not isinstance(entries, list):
            out[cname] = set()
            continue
        ids = set()
        for e in entries:
            if isinstance(e, dict):
                ids.add(str(e.get('id', '')))
            else:
                ids.add(str(e))
        out[cname] = ids
    return out


def _get_requested_display(client_name, queue_id, instance_id):
    """Return {title, year, score, score_breakdown} for a requested queue item for display."""
    from src.primary.utils.database import get_database
    db = get_database()
    config = db.get_app_config_for_instance('movie_hunt_requested', instance_id)
    if not config or not isinstance(config.get('by_client'), dict):
        return {'title': '', 'year': '', 'score': None, 'score_breakdown': ''}
    cname = (client_name or 'Download client').strip() or 'Download client'
    entries = config.get('by_client', {}).get(cname) or []
    sid = str(queue_id)
    for e in entries:
        if isinstance(e, dict) and str(e.get('id', '')) == sid:
            score = e.get('score')
            if score is not None:
                try:
                    score = int(score)
                except (TypeError, ValueError):
                    score = None
            return {
                'title': (e.get('title') or '').strip(),
                'year': (e.get('year') or '').strip(),
                'score': score,
                'score_breakdown': (e.get('score_breakdown') or '').strip(),
            }
    return {'title': '', 'year': '', 'score': None, 'score_breakdown': ''}


def _add_requested_queue_id(client_name, queue_id, instance_id, title=None, year=None, score=None, score_breakdown=None):
    """Record that we requested this queue item (so we only show it in Activity queue)."""
    from src.primary.utils.database import get_database
    db = get_database()
    config = db.get_app_config_for_instance('movie_hunt_requested', instance_id) or {}
    by_client = config.get('by_client') or {}
    cname = (client_name or 'Download client').strip() or 'Download client'
    entries = list(by_client.get(cname) or [])
    sid = str(queue_id)
    normalized = []
    for e in entries:
        if isinstance(e, dict):
            normalized.append(e)
        else:
            normalized.append({'id': str(e), 'title': '', 'year': ''})
    existing_ids = {e.get('id') for e in normalized}
    entry = {'id': sid, 'title': (title or '').strip(), 'year': (year or '').strip()}
    if score is not None:
        entry['score'] = int(score)
    if score_breakdown is not None:
        entry['score_breakdown'] = (score_breakdown or '').strip()
    if sid not in existing_ids:
        normalized.append(entry)
    else:
        for i, e in enumerate(normalized):
            if e.get('id') == sid:
                normalized[i] = {**e, **entry}
                break
    by_client[cname] = normalized
    config['by_client'] = by_client
    db.save_app_config_for_instance('movie_hunt_requested', instance_id, config)
