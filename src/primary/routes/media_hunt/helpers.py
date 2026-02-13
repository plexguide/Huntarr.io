"""Shared helpers for Movie Hunt and TV Hunt routes (instance ID, blocklist, queue, etc.)."""

import re
import time
from flask import request

from ...utils.logger import logger, get_logger

movie_hunt_logger = get_logger("movie_hunt")
tv_hunt_logger = get_logger("tv_hunt")

# --- Movie Hunt constants ---
MOVIE_HUNT_QUEUE_CATEGORY = 'moviehunt'
MOVIE_HUNT_DEFAULT_CATEGORY = 'moviehunt'

# --- Movie Hunt instance ID ---
def _get_movie_hunt_instance_id_from_request():
    """Current Movie Hunt instance: query param instance_id, POST body instance_id, or server-stored current."""
    from src.primary.utils.database import get_database
    db = get_database()
    instance_id = request.args.get('instance_id', type=int)
    if instance_id is not None:
        return instance_id
    if request.method in ('POST', 'DELETE', 'PUT') and request.is_json:
        try:
            body = request.get_json(silent=True) or {}
            bid = body.get('instance_id')
            if bid is not None:
                instance_id = int(bid) if bid is not None else None
                if instance_id is not None:
                    return instance_id
        except (TypeError, ValueError):
            pass
    return db.get_current_movie_hunt_instance_id()


def _movie_profiles_context():
    """Context for media_hunt.profiles (movie)."""
    from .custom_formats import get_movie_custom_formats_config
    return {
        'profiles_config_key': 'movie_hunt_profiles',
        'sizes_config_key': 'movie_hunt_sizes',
        'use_profile_id': False,
        'get_custom_formats': get_movie_custom_formats_config,
    }


def _get_movie_hunt_instance_display_name(instance_id):
    """Get display name for a Movie Hunt instance."""
    if instance_id is None:
        return ""
    try:
        from src.primary.utils.database import get_database
        db = get_database()
        instances = db.get_movie_hunt_instances()
        one = next((i for i in instances if i.get("id") == instance_id), None)
        return (one.get("name") or "").strip() if one else str(instance_id)
    except Exception:
        return str(instance_id)


def _get_tv_hunt_instance_display_name(instance_id):
    """Get display name for a TV Hunt instance."""
    if instance_id is None:
        return ""
    try:
        from src.primary.utils.database import get_database
        db = get_database()
        instances = db.get_tv_hunt_instances()
        one = next((i for i in instances if i.get("id") == instance_id), None)
        return (one.get("name") or "").strip() if one else str(instance_id)
    except Exception:
        return str(instance_id)


# --- TV Hunt instance ID ---
def _get_tv_hunt_instance_id_from_request():
    """Resolve TV Hunt instance_id from query or JSON body."""
    instance_id = request.args.get('instance_id')
    if instance_id is None:
        data = request.get_json(silent=True) or {}
        instance_id = data.get('instance_id')
    if instance_id is None:
        from src.primary.utils.database import get_database
        db = get_database()
        instance_id = db.get_current_tv_hunt_instance_id()
    if instance_id is not None:
        try:
            instance_id = int(instance_id)
        except (TypeError, ValueError):
            instance_id = 0
    return instance_id or 0


def _tv_profiles_context():
    """Context for media_hunt.profiles (tv)."""
    from .custom_formats import get_tv_custom_formats_config
    return {
        'profiles_config_key': 'tv_hunt_profiles',
        'sizes_config_key': 'tv_hunt_sizes',
        'use_profile_id': True,
        'get_custom_formats': get_tv_custom_formats_config,
    }


# --- Download client URL (movie) ---
def _download_client_base_url(client):
    """Build base URL for a download client (host:port)."""
    host = (client.get('host') or '').strip()
    if not host:
        return None
    if not (host.startswith('http://') or host.startswith('https://')):
        host = 'http://' + host
    port = client.get('port', 8080)
    return '%s:%s' % (host.rstrip('/'), port)


# --- Filename parsing (movie) ---
def _extract_year_from_filename(filename):
    if not filename:
        return None
    m = re.search(r'\b(19\d{2}|20\d{2})\b', filename)
    return m.group(1) if m else None


def _extract_quality_from_filename(filename):
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
    return ' '.join(parts) if parts else '-'


def _extract_formats_from_filename(filename):
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
    if 'DDP' in t or ('DOLBY' in t and 'DIGITAL' in t_flat):
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
    return ' / '.join(parts) if parts else '-'


def _format_queue_scoring(score, score_breakdown=None):
    if score is None:
        return '-'
    try:
        s = int(score)
    except (TypeError, ValueError):
        return '-'
    br = (score_breakdown or '').strip()
    return '%d (%s)' % (s, br) if br else str(s)


def _format_queue_display_name(filename, title=None, year=None):
    display_title = (title or '').strip()
    display_year = (year or '').strip()
    if not display_year and filename:
        display_year = _extract_year_from_filename(filename) or ''
    if display_title:
        return '%s (%s)' % (display_title, display_year) if display_year else display_title
    if not filename:
        return '-'
    clean = filename.replace('.', ' ').strip()
    return '%s (%s)' % (clean, display_year) if display_year else clean


# --- Blocklist (movie) ---
def _blocklist_normalize_source_title(s):
    return (s or '').strip().lower() if s else ''


def _get_blocklist_raw(instance_id):
    """Movie blocklist entries."""
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
    """Movie: set of normalized source titles for filtering."""
    entries = _get_blocklist_raw(instance_id)
    return frozenset(_blocklist_normalize_source_title(e.get('source_title')) for e in entries if (e.get('source_title') or '').strip())


def _get_tv_blocklist_source_titles(instance_id):
    """TV: set of normalized source titles on blocklist."""
    from src.primary.utils.database import get_database
    db = get_database()
    config = db.get_app_config_for_instance('tv_hunt_blocklist', instance_id)
    if not config or not isinstance(config.get('items'), list):
        return set()
    return {_blocklist_normalize_source_title(it.get('source_title') or '') for it in config['items'] if it.get('source_title')}


def _blocklist_add(movie_title, year, source_title, reason_failed, instance_id):
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


# --- Requested queue ID tracking (movie) ---
def _get_requested_queue_ids(instance_id):
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


# --- TV Hunt requested queue ---
def _add_tv_requested_queue_id(instance_id, queue_id):
    if not queue_id:
        return
    from src.primary.utils.database import get_database
    db = get_database()
    config = db.get_app_config_for_instance('tv_hunt_requested_queue_ids', instance_id)
    if not config or not isinstance(config, dict):
        config = {'ids': []}
    ids = config.get('ids') or []
    if queue_id not in ids:
        ids.append(queue_id)
        if len(ids) > 200:
            ids = ids[-200:]
    config['ids'] = ids
    db.save_app_config_for_instance('tv_hunt_requested_queue_ids', instance_id, config)


# TV Hunt constant
TV_HUNT_DEFAULT_CATEGORY = "tv"
