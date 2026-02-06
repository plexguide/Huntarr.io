#!/usr/bin/env python3
"""
Movie Hunt routes: indexers, profiles, movie management, download clients,
activity queue, custom formats, collection, root folders, remote mappings.
"""

import os
import json
import string
import secrets
import requests
import xml.etree.ElementTree as ET
from datetime import datetime
from flask import Blueprint, request, jsonify

from ..utils.logger import logger, get_logger
from .. import settings_manager
from .. import trash_custom_formats

movie_hunt_logger = get_logger("movie_hunt")
movie_hunt_bp = Blueprint("movie_hunt", __name__)

# Newznab indexer preset base URLs (used for API key validation)
INDEXER_PRESET_URLS = {
    'nzbgeek': 'https://api.nzbgeek.info/api',
    'nzbfinder.ws': 'https://api.nzbfinder.ws/api',
}


def _validate_newznab_api_key(base_url, api_key, timeout=10):
    """
    Validate a Newznab API key by performing a minimal search request.
    Per Newznab API: t=search requires apikey; error codes 100/101/102 = invalid credentials.
    Success = 200 + XML with no error element AND valid RSS structure (channel or item).
    See https://inhies.github.io/Newznab-API/
    """
    if not (base_url and api_key and api_key.strip()):
        return False, 'API key is required'
    api_key = api_key.strip()
    url = f'{base_url.rstrip("/")}?t=search&apikey={requests.utils.quote(api_key)}&q=test&limit=1'
    try:
        r = requests.get(url, timeout=timeout)
        if r.status_code != 200:
            return False, f'Indexer returned HTTP {r.status_code}'
        text = (r.text or '').strip()
        if not text:
            return False, 'Empty response from indexer'
        # Check for common error phrases in body (some indexers don't use Newznab error element)
        text_lower = text.lower()
        for phrase in ('invalid api key', 'invalid key', 'api key is invalid', 'unauthorized', 'authentication failed', 'access denied', 'invalid apikey'):
            if phrase in text_lower:
                return False, 'Invalid API key or not authorized'
        # Try JSON first (some indexers return JSON by default)
        if text.lstrip().startswith('{'):
            try:
                data = json.loads(text)
                if data.get('error') or data.get('@attributes', {}).get('error'):
                    return False, data.get('description') or data.get('error') or 'Invalid API key'
                # JSON success: expect channel/items or similar
                if 'channel' in data or 'item' in data or 'items' in data:
                    return True, None
                return False, 'Invalid API key or unexpected response'
            except (ValueError, TypeError):
                pass
        # XML: check for Newznab error element (any namespace)
        root = ET.fromstring(text)
        err = root.find('.//{http://www.newznab.com/DTD/2010/feeds/attributes/}error')
        if err is None:
            err = root.find('.//error') or root.find('error')
        if err is not None:
            code = err.get('code') or err.get('description') or ''
            code_str = str(code).strip()
            if code_str in ('100', '101', '102'):
                return False, 'Invalid API key or account not authorized'
            desc = err.get('description') or err.text or ''
            return False, (desc.strip() or f'Error {code_str}')
        # No error element: require evidence of successful search - at least one <item> or non-empty channel
        channel = root.find('.//{http://www.newznab.com/DTD/2010/feeds/}channel') or root.find('.//channel') or root.find('channel')
        items = root.findall('.//{http://www.newznab.com/DTD/2010/feeds/}item') or root.findall('.//item') or root.findall('item')
        if items:
            return True, None
        if channel is not None:
            # Channel with any child (title, item, etc.) indicates accepted request; empty channel = no items = treat as invalid key
            if list(channel) or (channel.text and channel.text.strip()):
                return True, None
            return False, 'Invalid API key or account not authorized'
        if root.tag and ('rss' in root.tag.lower() or 'rss' in root.tag):
            return True, None
        logger.debug('Indexer validation: no error element but no channel/item; response sample: %s', text[:400].replace(api_key, '***'))
        return False, 'Invalid API key or unexpected response from indexer'
    except ET.ParseError:
        return False, 'Invalid response from indexer'
    except requests.RequestException as e:
        return False, str(e) if str(e) else 'Could not connect to indexer'


@movie_hunt_bp.route('/api/indexers/validate', methods=['POST'])
def api_indexers_validate():
    """
    Validate an indexer API key for a given preset (NZBGeek, NZBFinder.ws).
    Manual Configuration is not validated.
    Body: { "preset": "nzbgeek"|"nzbfinder.ws"|"manual", "api_key": "..." }
    """
    try:
        data = request.get_json() or {}
        preset = (data.get('preset') or '').strip().lower().replace(' ', '')
        api_key = (data.get('api_key') or '').strip()
        if preset == 'manual':
            return jsonify({'valid': True, 'message': 'Manual configuration is not validated'}), 200
        base_url = INDEXER_PRESET_URLS.get(preset)
        if not base_url:
            return jsonify({'valid': False, 'message': 'Unknown preset'}), 400
        valid, err_msg = _validate_newznab_api_key(base_url, api_key)
        if valid:
            return jsonify({'valid': True}), 200
        return jsonify({'valid': False, 'message': err_msg or 'Validation failed'}), 200
    except Exception as e:
        logger.exception('Indexer validation error')
        return jsonify({'valid': False, 'message': str(e)}), 200


def _get_indexers_config():
    """Get indexers list from database (app_config app_type=indexers)."""
    from src.primary.utils.database import get_database
    db = get_database()
    config = db.get_app_config('indexers')
    if not config or not isinstance(config.get('indexers'), list):
        return []
    return config['indexers']


def _save_indexers_list(indexers_list):
    """Save indexers list to database."""
    from src.primary.utils.database import get_database
    db = get_database()
    db.save_app_config('indexers', {'indexers': indexers_list})


# Indexer categories (Movies only). By default all selected except Movies/3D (2060).
INDEXER_CATEGORIES = [
    {'id': 2000, 'name': 'Movies'},
    {'id': 2010, 'name': 'Movies/Foreign'},
    {'id': 2020, 'name': 'Movies/Other'},
    {'id': 2030, 'name': 'Movies/SD'},
    {'id': 2040, 'name': 'Movies/HD'},
    {'id': 2045, 'name': 'Movies/UHD'},
    {'id': 2050, 'name': 'Movies/BluRay'},
    {'id': 2060, 'name': 'Movies/3D'},
    {'id': 2070, 'name': 'Movies/DVD'},
]
INDEXER_CATEGORIES_DEFAULT_IDS = [2000, 2010, 2020, 2030, 2040, 2045, 2050, 2070]


@movie_hunt_bp.route('/api/indexers', methods=['GET'])
def api_indexers_list():
    """List saved indexers (API key masked to last 4 chars). Includes categories for editor."""
    try:
        indexers = _get_indexers_config()
        out = []
        for i, idx in enumerate(indexers):
            key = (idx.get('api_key') or '')
            last4 = key[-4:] if len(key) >= 4 else '****'
            cats = idx.get('categories')
            if not isinstance(cats, list):
                cats = list(INDEXER_CATEGORIES_DEFAULT_IDS)
            out.append({
                'index': i,
                'name': idx.get('name') or 'Unnamed',
                'preset': idx.get('preset') or 'manual',
                'enabled': idx.get('enabled', True),
                'api_key_last4': last4,
                'categories': cats,
            })
        return jsonify({'indexers': out}), 200
    except Exception as e:
        logger.exception('Indexers list error')
        return jsonify({'indexers': [], 'error': str(e)}), 200


@movie_hunt_bp.route('/api/indexers', methods=['POST'])
def api_indexers_add():
    """Add a new indexer. Body: { name, preset, api_key, enabled, categories }."""
    try:
        data = request.get_json() or {}
        name = (data.get('name') or '').strip() or 'Unnamed'
        preset = (data.get('preset') or 'manual').strip().lower()
        api_key = (data.get('api_key') or '').strip()
        enabled = data.get('enabled', True)
        categories = data.get('categories')
        if not isinstance(categories, list):
            categories = list(INDEXER_CATEGORIES_DEFAULT_IDS)
        indexers = _get_indexers_config()
        indexers.append({
            'name': name,
            'preset': preset,
            'api_key': api_key,
            'enabled': enabled,
            'categories': categories,
        })
        _save_indexers_list(indexers)
        return jsonify({'success': True, 'index': len(indexers) - 1}), 200
    except Exception as e:
        logger.exception('Indexers add error')
        return jsonify({'success': False, 'error': str(e)}), 500


@movie_hunt_bp.route('/api/indexers/<int:index>', methods=['PUT'])
def api_indexers_update(index):
    """Update indexer at index. Body: { name, preset, api_key?, enabled, categories? }. Omit api_key to keep existing."""
    try:
        indexers = _get_indexers_config()
        if index < 0 or index >= len(indexers):
            return jsonify({'success': False, 'error': 'Index out of range'}), 400
        data = request.get_json() or {}
        name = (data.get('name') or '').strip() or 'Unnamed'
        preset = (data.get('preset') or 'manual').strip().lower()
        api_key_new = (data.get('api_key') or '').strip()
        enabled = data.get('enabled', True)
        categories = data.get('categories')
        if not isinstance(categories, list):
            existing_cats = indexers[index].get('categories')
            categories = list(existing_cats) if isinstance(existing_cats, list) else list(INDEXER_CATEGORIES_DEFAULT_IDS)
        existing = indexers[index]
        api_key = api_key_new if api_key_new else (existing.get('api_key') or '')
        indexers[index] = {
            'name': name,
            'preset': preset,
            'api_key': api_key,
            'enabled': enabled,
            'categories': categories,
        }
        _save_indexers_list(indexers)
        return jsonify({'success': True}), 200
    except Exception as e:
        logger.exception('Indexers update error')
        return jsonify({'success': False, 'error': str(e)}), 500


@movie_hunt_bp.route('/api/indexers/<int:index>', methods=['DELETE'])
def api_indexers_delete(index):
    """Delete indexer at index."""
    try:
        indexers = _get_indexers_config()
        if index < 0 or index >= len(indexers):
            return jsonify({'success': False, 'error': 'Index out of range'}), 400
        indexers.pop(index)
        _save_indexers_list(indexers)
        return jsonify({'success': True}), 200
    except Exception as e:
        logger.exception('Indexers delete error')
        return jsonify({'success': False, 'error': str(e)}), 500


# --- Movie Hunt Profiles (default "Standard" profile, app instances design) ---
PROFILES_DEFAULT_NAME = 'Standard'

# Default qualities for new profiles (Movie Hunt; id, name, enabled, order)
# Matches Movie Hunt quality list: Raw-HD, BR-DISK, Remux/WEB/Bluray/HDTV by resolution, SDTV, DVD, then scene/screener (DVDSCR, REGIONAL, TELECINE, TELESYNC, CAM, WORKPRINT, Unknown)
PROFILES_DEFAULT_QUALITIES = [
    {'id': 'rawhd', 'name': 'Raw-HD', 'enabled': False, 'order': 0},
    {'id': 'brdisk', 'name': 'BR-DISK', 'enabled': False, 'order': 1},
    {'id': 'remux2160', 'name': 'Remux-2160p', 'enabled': False, 'order': 2},
    {'id': 'web2160', 'name': 'WEB 2160p', 'enabled': True, 'order': 3},
    {'id': 'bluray2160', 'name': 'Bluray-2160p', 'enabled': True, 'order': 4},
    {'id': 'hdtv2160', 'name': 'HDTV-2160p', 'enabled': True, 'order': 5},
    {'id': 'remux1080', 'name': 'Remux-1080p', 'enabled': False, 'order': 6},
    {'id': 'web1080', 'name': 'WEB 1080p', 'enabled': True, 'order': 7},
    {'id': 'bluray1080', 'name': 'Bluray-1080p', 'enabled': True, 'order': 8},
    {'id': 'hdtv1080', 'name': 'HDTV-1080p', 'enabled': True, 'order': 9},
    {'id': 'web720', 'name': 'WEB 720p', 'enabled': True, 'order': 10},
    {'id': 'bluray720', 'name': 'Bluray-720p', 'enabled': True, 'order': 11},
    {'id': 'hdtv720', 'name': 'HDTV-720p', 'enabled': True, 'order': 12},
    {'id': 'web480', 'name': 'WEB 480p', 'enabled': True, 'order': 13},
    {'id': 'sdtv', 'name': 'SDTV', 'enabled': True, 'order': 14},
    {'id': 'dvd', 'name': 'DVD', 'enabled': False, 'order': 15},
    {'id': 'dvdscr', 'name': 'DVDSCR', 'enabled': False, 'order': 16},
    {'id': 'regional', 'name': 'REGIONAL', 'enabled': False, 'order': 17},
    {'id': 'telecine', 'name': 'TELECINE', 'enabled': False, 'order': 18},
    {'id': 'telesync', 'name': 'TELESYNC', 'enabled': False, 'order': 19},
    {'id': 'cam', 'name': 'CAM', 'enabled': False, 'order': 20},
    {'id': 'workprint', 'name': 'WORKPRINT', 'enabled': False, 'order': 21},
    {'id': 'unknown', 'name': 'Unknown', 'enabled': False, 'order': 22},
]


def _profile_defaults():
    """Return a full default profile dict (for new profiles)."""
    return {
        'name': PROFILES_DEFAULT_NAME,
        'is_default': True,
        'upgrades_allowed': True,
        'upgrade_until_quality': 'WEB 2160p',
        'min_custom_format_score': 0,
        'upgrade_until_custom_format_score': 0,
        'upgrade_score_increment': 100,
        'language': 'English',
        'qualities': [dict(q) for q in PROFILES_DEFAULT_QUALITIES],
    }


def _normalize_profile(p):
    """Ensure profile has all keys with defaults; qualities is list of {id, name, enabled, order}."""
    defaults = _profile_defaults()
    out = dict(defaults)
    for k, v in (p or {}).items():
        if k == 'qualities':
            continue
        if v is not None:
            out[k] = v
    if p and isinstance(p.get('qualities'), list) and len(p['qualities']) > 0:
        out['qualities'] = []
        seen_ids = set()
        for q in p['qualities']:
            if isinstance(q, dict) and q.get('id') is not None:
                qid = str(q.get('id', ''))
                seen_ids.add(qid)
                entry = {
                    'id': qid,
                    'name': str(q.get('name', q.get('id', ''))),
                    'enabled': bool(q.get('enabled', True)),
                    'order': int(q.get('order', 0)),
                }
                if q.get('score') is not None:
                    try:
                        entry['score'] = int(q['score'])
                    except (TypeError, ValueError):
                        pass
                out['qualities'].append(entry)
        # Merge in any default qualities missing from this profile (e.g. new Remux-1080p)
        for dq in PROFILES_DEFAULT_QUALITIES:
            if dq.get('id') not in seen_ids:
                out['qualities'].append({
                    'id': str(dq.get('id', '')),
                    'name': str(dq.get('name', '')),
                    'enabled': bool(dq.get('enabled', False)),
                    'order': int(dq.get('order', 0)),
                })
        out['qualities'].sort(key=lambda x: (x.get('order', 0), x.get('id', '')))
    return out


def _get_profiles_config():
    """Get Movie Hunt profiles list from database. Ensures at least default 'Standard' exists."""
    from src.primary.utils.database import get_database
    db = get_database()
    config = db.get_app_config('movie_hunt_profiles')
    if not config or not isinstance(config.get('profiles'), list):
        profiles = []
    else:
        profiles = list(config['profiles'])
    if not profiles:
        first = _profile_defaults()
        first['name'] = PROFILES_DEFAULT_NAME
        first['is_default'] = True
        profiles = [first]
        db.save_app_config('movie_hunt_profiles', {'profiles': profiles})
    return profiles


def _save_profiles_config(profiles_list):
    """Save Movie Hunt profiles to database."""
    from src.primary.utils.database import get_database
    db = get_database()
    db.save_app_config('movie_hunt_profiles', {'profiles': profiles_list})


def _get_profile_by_name_or_default(quality_profile_name):
    """
    Resolve quality_profile (e.g. 'Standard (Default)' or '4K') to the actual profile from config.
    Returns normalized profile dict, or the default profile if not found / empty.
    """
    profiles = _get_profiles_config()
    if not quality_profile_name or not (quality_profile_name or '').strip():
        for p in profiles:
            if p.get('is_default'):
                return _normalize_profile(p)
        return _normalize_profile(profiles[0]) if profiles else _profile_defaults()
    want = (quality_profile_name or '').strip()
    want_base = want.replace(' (Default)', '').replace('(Default)', '').strip()
    for p in profiles:
        name = (p.get('name') or '').strip()
        if name == want or name == want_base:
            return _normalize_profile(p)
        if name.replace(' (Default)', '').strip() == want_base:
            return _normalize_profile(p)
    for p in profiles:
        if p.get('is_default'):
            return _normalize_profile(p)
    return _normalize_profile(profiles[0]) if profiles else _profile_defaults()


def _release_matches_quality(release_title, quality_name):
    """
    Return True if release_title (indexer result) appears to match the quality (e.g. 'WEB 1080p', 'Bluray-2160p').
    Uses simple keyword/resolution matching; release_title is the NZB release name.
    """
    if not release_title or not quality_name:
        return False
    t = (release_title or '').lower()
    q = (quality_name or '').lower().replace('-', ' ')
    # Resolution: 2160p -> 2160, 1080p -> 1080, 720p -> 720, 480p -> 480
    if '2160' in q or '2160p' in q:
        if '2160' not in t:
            return False
    elif '1080' in q or '1080p' in q:
        if '1080' not in t:
            return False
    elif '720' in q or '720p' in q:
        if '720' not in t:
            return False
    elif '480' in q or '480p' in q:
        if '480' not in t:
            return False
    # Source keywords
    if 'web' in q:
        if 'web' not in t and 'web-dl' not in t and 'webdl' not in t and 'webrip' not in t:
            return False
    if 'bluray' in q or 'blu-ray' in q:
        if 'bluray' not in t and 'blu-ray' not in t and 'brrip' not in t and 'bdrip' not in t:
            return False
    if 'hdtv' in q:
        if 'hdtv' not in t:
            return False
    if 'remux' in q:
        if 'remux' not in t:
            return False
    if 'sdtv' in q:
        if 'sdtv' not in t and 'sd' not in t and '480' not in t:
            return False
    if 'dvd' in q and 'dvdscr' not in q:
        if 'dvd' not in t:
            return False
    return True


def _score_release(release_title, profile):
    """
    Score a release using only custom format scores stored by the user (Settings -> Custom Formats).
    Each custom format's regex (from its JSON specifications) is run against the release title;
    if it matches, that format's configured score is added. Total = sum of all matching format scores.
    No hardcoded values. Returns (total_score, breakdown_str) for display in queue. Higher is better.
    """
    import re
    if not release_title or not (release_title or '').strip():
        return 0, '-'
    parts = []
    total = 0
    try:
        custom_formats = _get_custom_formats_config()
        for cf in custom_formats:
            cf_json = cf.get('custom_format_json')
            score_val = cf.get('score')
            if score_val is None:
                score_val = 0
            try:
                score_val = int(score_val)
            except (TypeError, ValueError):
                score_val = 0
            name = (cf.get('title') or cf.get('name') or 'CF').strip() or 'CF'
            if not cf_json:
                continue
            obj = json.loads(cf_json) if isinstance(cf_json, str) else cf_json
            if not isinstance(obj, dict):
                continue
            
            # TRaSH/Radarr custom format: specifications array with required=true items that have regex in fields.value
            specifications = obj.get('specifications') or []
            if not isinstance(specifications, list):
                continue
            
            # TRaSH formats have positive specs (identify the feature) and negative specs (exclude false positives)
            # A format matches if: (1) at least one positive required spec matches, (2) all negative required specs pass
            has_positive_match = False
            all_negative_pass = True
            has_any_spec = False
            
            for spec in specifications:
                if not isinstance(spec, dict):
                    continue
                required = spec.get('required', False)
                if not required:
                    continue
                negate = spec.get('negate', False)
                fields = spec.get('fields') or {}
                
                implementation = spec.get('implementation', '')
                
                # ResolutionSpecification: check if title contains the resolution (e.g. 720p, 1080p, 2160p)
                if 'resolution' in implementation.lower():
                    resolution_value = fields.get('value') if isinstance(fields, dict) else None
                    if resolution_value is not None:
                        has_any_spec = True
                        try:
                            res_int = int(resolution_value)
                            # Look for e.g. "1080p", "1080", "720p", "2160p" in title
                            res_pattern = r'\b' + str(res_int) + r'p?\b'
                            found = bool(re.search(res_pattern, release_title, re.IGNORECASE))
                            if negate:
                                if found:
                                    all_negative_pass = False
                                    break
                            else:
                                if found:
                                    has_positive_match = True
                        except (TypeError, ValueError):
                            pass
                    continue
                
                pattern = fields.get('value') if isinstance(fields, dict) else None
                if not pattern or not isinstance(pattern, str):
                    continue
                
                has_any_spec = True
                try:
                    found = bool(re.search(pattern, release_title, re.IGNORECASE))
                    if negate:
                        # Negative spec: pattern must NOT match
                        if found:
                            all_negative_pass = False
                            break
                    else:
                        # Positive spec: pattern must match
                        if found:
                            has_positive_match = True
                except re.error:
                    continue
            
            # Format matches if we checked specs, found at least one positive match, and all negatives passed
            if has_any_spec and has_positive_match and all_negative_pass:
                total += score_val
                # Format: show +N for positive, -N for negative (no + prefix on negative)
                if score_val >= 0:
                    parts.append('%s +%d' % (name, score_val))
                else:
                    parts.append('%s %d' % (name, score_val))
    except Exception:
        pass
    if not parts:
        return 0, '-'
    return total, ', '.join(parts)


def _best_result_matching_profile(results, profile):
    """
    From Newznab results list [{title, nzb_url}, ...], return the best result that matches
    the profile (enabled qualities). Best = highest _score_release. Returns (result, score, breakdown_str).
    If none match profile, returns (None, 0, '').
    """
    if not results:
        return None, 0, ''
    enabled_names = [q.get('name') or '' for q in (profile.get('qualities') or []) if q.get('enabled')]
    if not enabled_names:
        # No profile filter: score all and pick best
        scored = []
        for r in results:
            title = (r.get('title') or '').strip()
            sc, br = _score_release(title, profile)
            scored.append((sc, br, r))
        scored.sort(key=lambda x: (-x[0], x[2].get('title') or ''))
        best = scored[0]
        return best[2], best[0], best[1]
    # Filter to profile-matching only, then pick best by score
    candidates = []
    for r in results:
        title = (r.get('title') or '').strip()
        for qname in enabled_names:
            if _release_matches_quality(title, qname):
                sc, br = _score_release(title, profile)
                candidates.append((sc, br, r))
                break
    if not candidates:
        return None, 0, ''
    candidates.sort(key=lambda x: (-x[0], x[2].get('title') or ''))
    best = candidates[0]
    return best[2], best[0], best[1]


def _first_result_matching_profile(results, profile):
    """
    From Newznab results list [{title, nzb_url}, ...], return the first result whose title
    matches any enabled quality in the profile. If none match, return None (do not use a
    release that violates the profile).
    """
    if not results:
        return None
    enabled_names = [q.get('name') or '' for q in (profile.get('qualities') or []) if q.get('enabled')]
    if not enabled_names:
        return results[0]
    for r in results:
        title = (r.get('title') or '').strip()
        for qname in enabled_names:
            if _release_matches_quality(title, qname):
                return r
    return None


@movie_hunt_bp.route('/api/profiles', methods=['GET'])
def api_profiles_list():
    """List Movie Hunt profiles (default Standard ensured). Returns full profile objects."""
    try:
        profiles = _get_profiles_config()
        out = []
        for i, p in enumerate(profiles):
            normalized = _normalize_profile(p)
            normalized['index'] = i
            out.append(normalized)
        return jsonify({'profiles': out}), 200
    except Exception as e:
        logger.exception('Profiles list error')
        return jsonify({'profiles': [], 'error': str(e)}), 200


def _unique_profile_name(base_name, existing_profiles):
    """If base_name is already used, append -<random alphanumeric> until unique."""
    existing_names = {(p.get('name') or '').strip() for p in existing_profiles}
    base = (base_name or 'Unnamed').strip() or 'Unnamed'
    if base not in existing_names:
        return base
    alphabet = string.ascii_lowercase + string.digits
    name = base
    while name in existing_names:
        suffix = ''.join(secrets.choice(alphabet) for _ in range(4))
        name = base + '-' + suffix
    return name


@movie_hunt_bp.route('/api/profiles', methods=['POST'])
def api_profiles_add():
    """Add a profile. Body: { name }. New profile uses full defaults, is_default=False.
    If name duplicates an existing profile, appends -<random alphanumeric> (e.g. -a3f2)."""
    try:
        data = request.get_json() or {}
        base_name = (data.get('name') or '').strip() or 'Unnamed'
        profiles = _get_profiles_config()
        name = _unique_profile_name(base_name, profiles)
        new_profile = _profile_defaults()
        new_profile['name'] = name
        new_profile['is_default'] = False
        profiles.append(new_profile)
        _save_profiles_config(profiles)
        return jsonify({'success': True, 'index': len(profiles) - 1, 'name': name}), 200
    except Exception as e:
        logger.exception('Profiles add error')
        return jsonify({'success': False, 'error': str(e)}), 500


@movie_hunt_bp.route('/api/profiles/<int:index>', methods=['PATCH'])
def api_profiles_patch(index):
    """Update profile: body can include name, is_default, upgrades_allowed, upgrade_until_quality,
    min_custom_format_score, upgrade_until_custom_format_score, upgrade_score_increment,
    language, qualities. Only one default allowed."""
    try:
        profiles = _get_profiles_config()
        if index < 0 or index >= len(profiles):
            return jsonify({'success': False, 'error': 'Index out of range'}), 400
        data = request.get_json() or {}
        if data.get('is_default') is True:
            # Move this profile to index 0 (leftmost) and set as default
            profile = profiles.pop(index)
            for i in range(len(profiles)):
                profiles[i]['is_default'] = False
            profile['is_default'] = True
            profiles.insert(0, profile)
            index = 0  # rest of PATCH applies to the moved profile (now at 0)
        name = (data.get('name') or '').strip()
        if name:
            profiles[index]['name'] = name
        if 'upgrades_allowed' in data:
            profiles[index]['upgrades_allowed'] = bool(data['upgrades_allowed'])
        if 'upgrade_until_quality' in data:
            profiles[index]['upgrade_until_quality'] = str(data.get('upgrade_until_quality') or 'WEB 2160p').strip()
        if 'min_custom_format_score' in data:
            try:
                profiles[index]['min_custom_format_score'] = int(data['min_custom_format_score'])
            except (TypeError, ValueError):
                pass
        if 'upgrade_until_custom_format_score' in data:
            try:
                profiles[index]['upgrade_until_custom_format_score'] = int(data['upgrade_until_custom_format_score'])
            except (TypeError, ValueError):
                pass
        if 'upgrade_score_increment' in data:
            try:
                profiles[index]['upgrade_score_increment'] = int(data['upgrade_score_increment'])
            except (TypeError, ValueError):
                pass
        if 'language' in data:
            profiles[index]['language'] = str(data.get('language') or 'English').strip()
        if 'qualities' in data and isinstance(data['qualities'], list):
            qualities = []
            for q in data['qualities']:
                if isinstance(q, dict) and q.get('id') is not None:
                    entry = {
                        'id': str(q.get('id', '')),
                        'name': str(q.get('name', q.get('id', ''))),
                        'enabled': bool(q.get('enabled', True)),
                        'order': int(q.get('order', 0)),
                    }
                    if q.get('score') is not None:
                        try:
                            entry['score'] = int(q['score'])
                        except (TypeError, ValueError):
                            pass
                    qualities.append(entry)
            qualities.sort(key=lambda x: (x.get('order', 0), x.get('id', '')))
            profiles[index]['qualities'] = qualities
        _save_profiles_config(profiles)
        return jsonify({'success': True}), 200
    except Exception as e:
        logger.exception('Profiles patch error')
        return jsonify({'success': False, 'error': str(e)}), 500


@movie_hunt_bp.route('/api/profiles/<int:index>/clone', methods=['POST'])
def api_profiles_clone(index):
    """Duplicate profile at index. New profile has name + ' (Copy)' and is_default=False."""
    try:
        profiles = _get_profiles_config()
        if index < 0 or index >= len(profiles):
            return jsonify({'success': False, 'error': 'Index out of range'}), 400
        source = profiles[index]
        import copy
        new_profile = copy.deepcopy(source)
        new_profile['name'] = ((source.get('name') or '').strip() or 'Unnamed') + ' (Copy)'
        new_profile['is_default'] = False
        profiles.append(new_profile)
        _save_profiles_config(profiles)
        return jsonify({'success': True, 'index': len(profiles) - 1}), 200
    except Exception as e:
        logger.exception('Profiles clone error')
        return jsonify({'success': False, 'error': str(e)}), 500


@movie_hunt_bp.route('/api/profiles/<int:index>', methods=['DELETE'])
def api_profiles_delete(index):
    """Delete profile. Any profile can be deleted; empty list triggers auto-creation of default Standard on next read."""
    try:
        profiles = _get_profiles_config()
        if index < 0 or index >= len(profiles):
            return jsonify({'success': False, 'error': 'Index out of range'}), 400
        was_default = profiles[index].get('is_default')
        profiles.pop(index)
        if was_default and profiles:
            profiles[0]['is_default'] = True
            _save_profiles_config(profiles)
        else:
            _save_profiles_config(profiles)
        return jsonify({'success': True}), 200
    except Exception as e:
        logger.exception('Profiles delete error')
        return jsonify({'success': False, 'error': str(e)}), 500


# --- Movie Management Settings (Movie Naming + Importing) ---

def _movie_management_defaults():
    """Default values for movie management settings (Movie Naming first, then Importing; no skip free space check)."""
    return {
        'rename_movies': True,
        'replace_illegal_characters': True,
        'colon_replacement': 'Smart Replace',
        'standard_movie_format': '{Movie Title} ({Release Year}) {Quality Full}',
        'movie_folder_format': '{Movie Title} ({Release Year})',
        'minimum_free_space_gb': 10,
        'use_hardlinks_instead_of_copy': True,
        'import_using_script': False,
        'import_extra_files': False,
    }


def _get_movie_management_config():
    """Get movie management config from database; merge with defaults."""
    from src.primary.utils.database import get_database
    db = get_database()
    config = db.get_app_config('movie_management')
    defaults = _movie_management_defaults()
    if not config or not isinstance(config, dict):
        return dict(defaults)
    out = dict(defaults)
    for k, v in config.items():
        if k in out:
            out[k] = v
    return out


@movie_hunt_bp.route('/api/settings/movie-management', methods=['GET'])
def api_movie_management_get():
    """Get movie management settings (Movie Naming + Importing)."""
    try:
        data = _get_movie_management_config()
        return jsonify(data), 200
    except Exception as e:
        logger.exception('Movie management get error')
        return jsonify(_movie_management_defaults()), 200


@movie_hunt_bp.route('/api/settings/movie-management', methods=['PATCH'])
def api_movie_management_patch():
    """Update movie management settings. Body: same keys as GET (partial allowed)."""
    try:
        data = request.get_json() or {}
        current = _get_movie_management_config()
        allowed = set(_movie_management_defaults().keys())
        for k, v in data.items():
            if k in allowed:
                current[k] = v
        from src.primary.utils.database import get_database
        db = get_database()
        db.save_app_config('movie_management', current)
        return jsonify(_get_movie_management_config()), 200
    except Exception as e:
        logger.exception('Movie management patch error')
        return jsonify({'error': str(e)}), 500


# --- Movie Hunt Activity (Queue, History, Blocklist) ---
# 100% independent: uses only Movie Hunt's download clients (SABnzbd/NZBGet). No Radarr.
# Use a dedicated category so Radarr (which typically watches "movies") never sees Movie Hunt's downloads.
MOVIE_HUNT_QUEUE_CATEGORY = 'moviehunt'
# Category we send to SAB/NZBGet and filter queue by. Must be moviehunt to keep Radarr fully decoupled.
MOVIE_HUNT_DEFAULT_CATEGORY = 'moviehunt'

def _download_client_base_url(client):
    """Build base URL for a download client (host:port)."""
    host = (client.get('host') or '').strip()
    if not host:
        return None
    if not (host.startswith('http://') or host.startswith('https://')):
        host = 'http://' + host
    port = client.get('port', 8080)
    return '%s:%s' % (host.rstrip('/'), port)


def _get_requested_queue_ids():
    """Return dict of client_name -> set of queue ids (nzo_id / NZBID) that we requested."""
    from src.primary.utils.database import get_database
    db = get_database()
    config = db.get_app_config('movie_hunt_requested')
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


def _get_requested_display(client_name, queue_id):
    """Return {title, year, score, score_breakdown} for a requested queue item for display. Empty/0 if not found."""
    from src.primary.utils.database import get_database
    db = get_database()
    config = db.get_app_config('movie_hunt_requested')
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


def _add_requested_queue_id(client_name, queue_id, title=None, year=None, score=None, score_breakdown=None):
    """Record that we requested this queue item (so we only show it in Activity queue). Store title/year and optional score for display."""
    from src.primary.utils.database import get_database
    db = get_database()
    config = db.get_app_config('movie_hunt_requested') or {}
    by_client = config.get('by_client') or {}
    cname = (client_name or 'Download client').strip() or 'Download client'
    entries = list(by_client.get(cname) or [])
    sid = str(queue_id)
    # Normalize old format (list of strings) to list of dicts
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
        # Update existing entry with new title/year/score if we're re-adding
        for i, e in enumerate(normalized):
            if e.get('id') == sid:
                normalized[i] = {**e, **entry}
                break
    by_client[cname] = normalized
    config['by_client'] = by_client
    db.save_app_config('movie_hunt_requested', config)


# --- Blocklist (failed downloads: block by source/release title so we pick a different release next time) ---

def _blocklist_normalize_source_title(s):
    """Normalize release title for blocklist matching (case-insensitive, strip)."""
    if not s:
        return ''
    return str(s).strip().lower()


def _get_blocklist_raw():
    """Return list of blocklist entries: { source_title, movie_title, year, reason_failed, date_added }."""
    try:
        from src.primary.utils.database import get_database
        db = get_database()
        config = db.get_app_config('movie_hunt_blocklist')
        if not config or not isinstance(config.get('entries'), list):
            return []
        return list(config['entries'])
    except Exception as e:
        logger.debug("Blocklist get error: %s", e)
        return []


def _get_blocklist_source_titles():
    """Return set of normalized source titles for filtering search results."""
    entries = _get_blocklist_raw()
    return frozenset(_blocklist_normalize_source_title(e.get('source_title')) for e in entries if (e.get('source_title') or '').strip())


def _blocklist_add(movie_title, year, source_title, reason_failed):
    """Add a release to the blocklist (e.g. after SAB reports failed)."""
    if not (source_title or '').strip():
        return
    try:
        from src.primary.utils.database import get_database
        import time
        db = get_database()
        config = db.get_app_config('movie_hunt_blocklist') or {}
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
        db.save_app_config('movie_hunt_blocklist', config)
    except Exception as e:
        logger.error("Blocklist add error: %s", e)


def _blocklist_remove(source_titles):
    """Remove one or more entries by source_title. source_titles: list of str."""
    if not source_titles or not isinstance(source_titles, list):
        return
    try:
        from src.primary.utils.database import get_database
        db = get_database()
        config = db.get_app_config('movie_hunt_blocklist')
        if not config or not isinstance(config.get('entries'), list):
            return
        to_remove = frozenset(_blocklist_normalize_source_title(s) for s in source_titles if (s or '').strip())
        if not to_remove:
            return
        entries = [e for e in config['entries'] if _blocklist_normalize_source_title(e.get('source_title')) not in to_remove]
        config['entries'] = entries
        db.save_app_config('movie_hunt_blocklist', config)
    except Exception as e:
        logger.error("Blocklist remove error: %s", e)


def _get_sabnzbd_history_item(client, queue_id):
    """
    Get a specific item from SABnzbd history by nzo_id.
    Returns dict with status, storage (path), name, category or None if not found.
    SAB may return history.slots as list or dict keyed by nzo_id; we normalize and compare as string.
    """
    try:
        base_url = _download_client_base_url(client)
        if not base_url:
            return None
        
        api_key = (client.get('api_key') or '').strip()
        url = f"{base_url}/api"
        params = {'mode': 'history', 'output': 'json', 'limit': 500}
        if api_key:
            params['apikey'] = api_key
        
        from src.primary.settings_manager import get_ssl_verify_setting
        verify_ssl = get_ssl_verify_setting()
        
        r = requests.get(url, params=params, timeout=10, verify=verify_ssl)
        r.raise_for_status()
        data = r.json()
        
        raw_slots = data.get('history', {}).get('slots', [])
        if isinstance(raw_slots, dict):
            slots = list(raw_slots.values())
        elif isinstance(raw_slots, list):
            slots = raw_slots
        else:
            slots = []
        
        def _normalize_nzo_id(nzo_id):
            """SAB may use 'SABnzbd_nzo_xxx' in queue and 'xxx' in history (or vice versa)."""
            s = str(nzo_id).strip()
            for prefix in ('SABnzbd_nzo_', 'sabnzbd_nzo_'):
                if s.lower().startswith(prefix.lower()):
                    return s[len(prefix):].strip()
            return s

        queue_id_str = str(queue_id).strip()
        queue_id_norm = _normalize_nzo_id(queue_id_str)
        for slot in slots:
            if not isinstance(slot, dict):
                continue
            slot_id = slot.get('nzo_id') or slot.get('id')
            if slot_id is None:
                continue
            slot_id_str = str(slot_id).strip()
            if slot_id_str == queue_id_str or _normalize_nzo_id(slot_id_str) == queue_id_norm:
                return {
                    'status': slot.get('status', ''),
                    'storage': slot.get('storage', ''),
                    'name': slot.get('name', ''),
                    'category': slot.get('category', ''),
                    'fail_message': (slot.get('fail_message') or '').strip() or '',
                    'nzb_name': (slot.get('nzb_name') or '').strip() or ''
                }
        
        sample_ids = [str(s.get('nzo_id') or s.get('id')) for s in slots[:5] if isinstance(s, dict)]
        movie_hunt_logger.info(
            "Import: nzo_id %s not found in SAB history (history has %s entries). Sample ids: %s",
            queue_id_str, len(slots), sample_ids
        )
        return None
        
    except Exception as e:
        movie_hunt_logger.error("Import: error fetching SABnzbd history for queue id %s: %s", queue_id, e)
        return None


def _check_and_import_completed(client_name, queue_item):
    """
    Check if a removed queue item completed successfully and trigger import.
    queue_item: { id, title, year, score, score_breakdown }
    """
    try:
        # Get the download client config
        clients = _get_clients_config()
        client = next((c for c in clients if (c.get('name') or '').strip() == client_name), None)
        
        if not client:
            movie_hunt_logger.warning("Import: download client '%s' not found in config", client_name)
            return
        
        client_type = (client.get('type') or 'nzbget').strip().lower()
        queue_id = queue_item.get('id')
        title = queue_item.get('title', '').strip()
        year = queue_item.get('year', '').strip()
        
        if not title:
            movie_hunt_logger.warning("Import: queue item %s has no title, skipping import", queue_id)
            return
        
        # Only support SABnzbd for now (NZBGet implementation can be added later)
        if client_type != 'sabnzbd':
            movie_hunt_logger.debug("Import: only SABnzbd supported (client type: %s)", client_type)
            return
        
        movie_hunt_logger.info(
            "Import: item left queue (nzo_id=%s, title='%s'). Checking SAB history for completed download.",
            queue_id, title
        )
        history_item = _get_sabnzbd_history_item(client, queue_id)
        
        if not history_item:
            movie_hunt_logger.warning(
                "Import: item left queue but not found in SAB history (nzo_id=%s, title='%s'). "
                "If the download completed in SAB, refresh the Queue page to trigger another check, or SAB may use a different id in history.",
                queue_id, title
            )
            return
        
        status = history_item.get('status', '')
        storage_path = (history_item.get('storage') or '').strip()
        movie_hunt_logger.info(
            "Import: download completed for '%s' (%s). SAB status=%s, SAB storage path=%s",
            title, year or 'no year', status, storage_path or '(empty)'
        )
        
        # If not completed, add to blocklist so we don't pick this release again
        if status.lower() != 'completed':
            source_title = (history_item.get('name') or history_item.get('nzb_name') or '').strip()
            if source_title and source_title.endswith('.nzb'):
                source_title = source_title[:-4]
            reason_failed = (history_item.get('fail_message') or '').strip() or status or 'Download failed'
            _blocklist_add(movie_title=title, year=year, source_title=source_title, reason_failed=reason_failed)
            movie_hunt_logger.warning(
                "Import: download '%s' (%s) did not complete (status: %s). Added to blocklist: %s",
                title, year, status, source_title or '(no name)'
            )
            return

        # Get download path from history
        download_path = storage_path
        
        if not download_path:
            movie_hunt_logger.error("Import: no storage path in history for '%s' (%s). Cannot import.", title, year)
            return
        
        # Trigger import
        movie_hunt_logger.info("Import: attempting import for '%s' (%s) from path: %s", title, year, download_path)
        
        # Import the file (using thread to avoid blocking queue polling)
        import threading
        from src.primary.apps.movie_hunt.importer import import_movie
        
        def _do_import():
            try:
                success = import_movie(
                    client=client,
                    title=title,
                    year=year,
                    download_path=download_path
                )
                if success:
                    movie_hunt_logger.info("Import: successfully imported '%s' (%s)", title, year)
                else:
                    movie_hunt_logger.error("Import: failed to import '%s' (%s)", title, year)
            except Exception as e:
                movie_hunt_logger.exception("Import: error for '%s' (%s): %s", title, year, e)
        
        import_thread = threading.Thread(target=_do_import, daemon=True)
        import_thread.start()
        
    except Exception as e:
        movie_hunt_logger.exception("Import: error checking completed download: %s", e)


def _prune_requested_queue_ids(client_name, current_queue_ids):
    """Remove from our requested list any id no longer in the client's queue (completed/removed). Trigger import for completed items."""
    # When queue is empty (e.g. last item just completed), current_queue_ids is empty - we must still
    # run so that all our requested items are treated as "removed" and we trigger import checks.
    from src.primary.utils.database import get_database
    db = get_database()
    config = db.get_app_config('movie_hunt_requested')
    if not config or not isinstance(config.get('by_client'), dict):
        return
    cname = (client_name or 'Download client').strip() or 'Download client'
    if cname not in config['by_client']:
        return
    current = set(str(i) for i in current_queue_ids)
    entries = config['by_client'][cname]
    kept = []
    removed = []  # Track removed items for import detection
    
    for e in entries:
        eid = e.get('id') if isinstance(e, dict) else str(e)
        if str(eid) in current:
            kept.append(e)
        else:
            # Item no longer in queue - it completed or was removed
            removed.append(e)
    
    config['by_client'][cname] = kept
    db.save_app_config('movie_hunt_requested', config)
    
    # Trigger import for completed items (when queue is empty, all requested items are in removed)
    if removed:
        movie_hunt_logger.info(
            "Import: %s item(s) left queue for client '%s', checking SAB history and running import.",
            len(removed), client_name
        )
    for item in removed:
        if isinstance(item, dict):
            _check_and_import_completed(client_name, item)


def _extract_year_from_filename(filename):
    """Extract a 4-digit year (1900-2099) from a release filename. Returns None if not found."""
    if not filename:
        return None
    import re
    m = re.search(r'\b(19\d{2}|20\d{2})\b', filename)
    return m.group(1) if m else None


def _extract_quality_from_filename(filename):
    """
    Extract a short quality/resolution string from a release filename for the queue QUALITY column.
    e.g. "Movie.2024.1080p.WEB.H.264-GROUP" -> "1080p WEB", "Movie.2160p.BluRay.Remux..." -> "2160p BluRay Remux"
    """
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
    """
    Extract video/audio format (codec) string from a release filename for the queue FORMATS column.
    e.g. "Movie.1080p.WEB.H.264-GROUP" -> "H.264", "Movie.2160p.HEVC.Atmos" -> "H.265 / Atmos"
    """
    if not filename or not (filename or '').strip():
        return '-'
    t = (filename or '').upper()
    # Normalize separators for matching (dots, hyphens, underscores)
    t_flat = t.replace('.', ' ').replace('-', ' ').replace('_', ' ')
    parts = []
    # Video codecs (order matters: prefer HEVC before H.264 to avoid partial match)
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
    # Audio
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
    # Fallback: clean filename (dots to spaces, remove trailing group like -NTb) and add year if found
    if not filename:
        return '-'
    clean = filename.replace('.', ' ').strip()
    if display_year:
        return '%s (%s)' % (clean, display_year)
    return clean


def _get_download_client_queue(client):
    """
    Fetch queue from one download client (SABnzbd or NZBGet). Returns list of activity-shaped dicts:
    { id, movie, year, languages, quality, formats, time_left, progress, instance_name }.
    """
    base_url = _download_client_base_url(client)
    if not base_url:
        return []
    client_type = (client.get('type') or 'nzbget').strip().lower()
    name = (client.get('name') or 'Download client').strip() or 'Download client'
    # Filter by the category configured for this client (same category we use when sending NZBs).
    # When client category is empty or "default", we use "moviehunt" so Radarr never sees these items.
    # Case-insensitive: SAB may return "Default", we compare in lowercase.
    raw_cat = (client.get('category') or '').strip()
    raw_cat_lower = raw_cat.lower()
    if raw_cat_lower in ('default', '*', ''):
        client_cat_lower = MOVIE_HUNT_DEFAULT_CATEGORY.lower()
    else:
        client_cat_lower = raw_cat_lower
    allowed_cats = frozenset((client_cat_lower,))
    requested_ids = _get_requested_queue_ids().get(name, set())
    try:
        from src.primary.settings_manager import get_ssl_verify_setting
        verify_ssl = get_ssl_verify_setting()
    except Exception:
        verify_ssl = True
    items = []
    current_queue_ids = set()
    try:
        if client_type == 'sabnzbd':
            api_key = (client.get('api_key') or '').strip()
            url = '%s/api' % base_url
            params = {'mode': 'queue', 'output': 'json'}
            if api_key:
                params['apikey'] = api_key
            movie_hunt_logger.debug("Queue: requesting SABnzbd queue from %s (%s)", name, base_url)
            try:
                r = requests.get(url, params=params, timeout=15, verify=verify_ssl)
                r.raise_for_status()
            except requests.RequestException as e:
                movie_hunt_logger.warning("Queue: SABnzbd request failed for %s: %s", name, e)
                return []
            data = r.json()
            if not isinstance(data, dict):
                movie_hunt_logger.warning("Queue: SABnzbd returned non-dict for %s", name)
                return []
            # SABnzbd may return {"error": "API Key Required"} or {"error": "API Key Incorrect"}
            sab_error = data.get('error') or data.get('error_msg')
            if sab_error:
                movie_hunt_logger.warning("Queue: SABnzbd %s returned error: %s", name, sab_error)
                return []
            # SABnzbd can put slots under queue.slots or at top-level slots; slots can be list or dict
            slots_raw = (data.get('queue') or {}).get('slots') or data.get('slots') or []
            if isinstance(slots_raw, dict):
                slots = list(slots_raw.values())
            elif isinstance(slots_raw, list):
                slots = slots_raw
            else:
                slots = []
            if not slots and (data.get('queue') or data):
                movie_hunt_logger.debug("Queue: SABnzbd %s returned 0 slots (response keys: %s)", name, list(data.keys()))
            for slot in slots:
                if not isinstance(slot, dict):
                    continue
                nzo_id = slot.get('nzo_id') or slot.get('id')
                if nzo_id is not None:
                    current_queue_ids.add(str(nzo_id))
                slot_cat = (slot.get('category') or slot.get('cat') or '').strip().lower()
                if slot_cat not in allowed_cats:
                    continue
                if nzo_id is None:
                    continue
                if str(nzo_id) not in requested_ids:
                    continue
                filename = (slot.get('filename') or slot.get('name') or '-').strip()
                if not filename:
                    filename = '-'
                display = _get_requested_display(name, nzo_id)
                display_name = _format_queue_display_name(filename, display.get('title'), display.get('year'))
                scoring_str = _format_queue_scoring(display.get('score'), display.get('score_breakdown'))
                # SABnzbd slot: mb (total MB), mbleft (remaining MB), timeleft, percentage, cat
                size_mb = slot.get('mb') or slot.get('size') or 0
                try:
                    size_mb = float(size_mb)
                except (TypeError, ValueError):
                    size_mb = 0
                mbleft = slot.get('mbleft')
                try:
                    mbleft = float(mbleft) if mbleft is not None else None
                except (TypeError, ValueError):
                    mbleft = None
                size_bytes = size_mb * (1024 * 1024) if size_mb else 0
                # SABnzbd uses mbleft (MB remaining); some APIs also give sizeleft (bytes or string)
                bytes_left = None
                if mbleft is not None and size_mb and size_mb > 0:
                    bytes_left = mbleft * (1024 * 1024)
                else:
                    raw_left = slot.get('bytes_left') or slot.get('sizeleft') or slot.get('size_left')
                    try:
                        bytes_left = float(raw_left) if raw_left is not None else None
                    except (TypeError, ValueError):
                        bytes_left = None
                if size_bytes and size_bytes > 0 and bytes_left is not None:
                    try:
                        pct = round((float(size_bytes - bytes_left) / float(size_bytes)) * 100)
                        progress = str(min(100, max(0, pct))) + '%'
                    except (TypeError, ZeroDivisionError):
                        progress = '-'
                else:
                    progress = slot.get('percentage') or '-'
                if progress == '100%':
                    progress = 'Pending Import'
                time_left = slot.get('time_left') or slot.get('timeleft') or '-'
                quality_str = _extract_quality_from_filename(filename)
                formats_str = _extract_formats_from_filename(filename)
                items.append({
                    'id': nzo_id,
                    'movie': display_name,
                    'title': display_name,
                    'year': None,
                    'languages': '-',
                    'quality': quality_str,
                    'formats': formats_str,
                    'scoring': scoring_str,
                    'time_left': time_left,
                    'progress': progress,
                    'instance_name': name,
                    'original_release': filename,
                })
            _prune_requested_queue_ids(name, current_queue_ids)
        elif client_type == 'nzbget':
            jsonrpc_url = '%s/jsonrpc' % base_url
            username = (client.get('username') or '').strip()
            password = (client.get('password') or '').strip()
            auth = (username, password) if (username or password) else None
            payload = {'method': 'listgroups', 'params': [0], 'id': 1}
            r = requests.post(jsonrpc_url, json=payload, auth=auth, timeout=15, verify=verify_ssl)
            r.raise_for_status()
            data = r.json()
            result = data.get('result') if isinstance(data.get('result'), list) else []
            for grp in result:
                if not isinstance(grp, dict):
                    continue
                nzb_id = grp.get('NZBID') or grp.get('ID')
                if nzb_id is not None:
                    current_queue_ids.add(str(nzb_id))
                grp_cat = (grp.get('Category') or grp.get('category') or '').strip().lower()
                if grp_cat not in allowed_cats:
                    continue
                if nzb_id is None:
                    continue
                if str(nzb_id) not in requested_ids:
                    continue
                nzb_name = (grp.get('NZBName') or grp.get('NZBFilename') or grp.get('Name') or '-').strip()
                if not nzb_name:
                    nzb_name = '-'
                display = _get_requested_display(name, nzb_id)
                display_name = _format_queue_display_name(nzb_name, display.get('title'), display.get('year'))
                scoring_str = _format_queue_scoring(display.get('score'), display.get('score_breakdown'))
                size_mb = grp.get('FileSizeMB') or 0
                try:
                    size_mb = float(size_mb)
                except (TypeError, ValueError):
                    size_mb = 0
                remaining_mb = grp.get('RemainingSizeMB') or 0
                try:
                    remaining_mb = float(remaining_mb)
                except (TypeError, ValueError):
                    remaining_mb = 0
                if size_mb and size_mb > 0 and remaining_mb is not None:
                    try:
                        pct = round((float(size_mb - remaining_mb) / float(size_mb)) * 100)
                        progress = str(min(100, max(0, pct))) + '%'
                    except (TypeError, ZeroDivisionError):
                        progress = '-'
                else:
                    progress = '-'
                if progress == '100%':
                    progress = 'Pending Import'
                quality_str = _extract_quality_from_filename(nzb_name)
                formats_str = _extract_formats_from_filename(nzb_name)
                items.append({
                    'id': nzb_id,
                    'movie': display_name,
                    'title': display_name,
                    'year': None,
                    'languages': '-',
                    'quality': quality_str,
                    'formats': formats_str,
                    'scoring': scoring_str,
                    'time_left': '-',
                    'progress': progress,
                    'instance_name': name,
                    'original_release': nzb_name,
                })
            _prune_requested_queue_ids(name, current_queue_ids)
    except Exception as e:
        logger.debug("Movie Hunt activity queue from download client %s: %s", name, e)
    return items


def _delete_from_download_client(client, item_ids):
    """
    Delete queue items from one download client by id(s). item_ids: list of str/int (nzo_id for SABnzbd, NZBID for NZBGet).
    Returns (removed_count, error_message). error_message is None on full success.
    """
    if not item_ids:
        return 0, None
    base_url = _download_client_base_url(client)
    if not base_url:
        return 0, 'Invalid client'
    client_type = (client.get('type') or 'nzbget').strip().lower()
    name = (client.get('name') or 'Download client').strip() or 'Download client'
    try:
        from src.primary.settings_manager import get_ssl_verify_setting
        verify_ssl = get_ssl_verify_setting()
    except Exception:
        verify_ssl = True
    removed = 0
    try:
        if client_type == 'sabnzbd':
            api_key = (client.get('api_key') or '').strip()
            url = '%s/api' % base_url
            for iid in item_ids:
                # SABnzbd API: mode=queue&name=delete&value=NZO_ID (not mode=queue.delete)
                params = {'mode': 'queue', 'name': 'delete', 'value': str(iid), 'output': 'json'}
                if api_key:
                    params['apikey'] = api_key
                r = requests.get(url, params=params, timeout=15, verify=verify_ssl)
                r.raise_for_status()
                data = r.json()
                if data.get('status') is True and not data.get('error'):
                    removed += 1
                else:
                    err = data.get('error') or data.get('error_msg')
                    if err:
                        movie_hunt_logger.warning("Queue: SABnzbd delete failed for %s: %s", name, err)
        elif client_type == 'nzbget':
            jsonrpc_url = '%s/jsonrpc' % base_url
            username = (client.get('username') or '').strip()
            password = (client.get('password') or '').strip()
            auth = (username, password) if (username or password) else None
            ids_int = []
            for iid in item_ids:
                try:
                    ids_int.append(int(iid))
                except (TypeError, ValueError):
                    pass
            if ids_int:
                payload = {'method': 'editqueue', 'params': ['GroupDelete', '', ids_int], 'id': 1}
                r = requests.post(jsonrpc_url, json=payload, auth=auth, timeout=15, verify=verify_ssl)
                r.raise_for_status()
                data = r.json()
                if data.get('result') is True:
                    removed = len(ids_int)
    except Exception as e:
        return removed, str(e) or 'Delete failed'
    failed = len(item_ids) - removed
    err = ('Failed to remove %d item(s) from %s' % (failed, name)) if failed else None
    return removed, err


# Background poller: detect completed downloads without requiring user to open Queue page
_movie_hunt_poller_thread = None
_movie_hunt_poller_started = False
_MOVIE_HUNT_POLL_INTERVAL_SEC = 90


def _movie_hunt_poll_completions():
    """Fetch queue from all clients to trigger prune/import check. Runs in background thread."""
    try:
        _get_activity_queue()
    except Exception as e:
        movie_hunt_logger.debug("Movie Hunt background poll: %s", e)


def _ensure_movie_hunt_poller_started():
    """Start the Movie Hunt completion poller thread once, so we detect completed downloads even when Queue page is not open."""
    global _movie_hunt_poller_thread, _movie_hunt_poller_started
    if _movie_hunt_poller_started:
        return
    import threading
    _movie_hunt_poller_started = True

    def _run():
        import time
        while True:
            time.sleep(_MOVIE_HUNT_POLL_INTERVAL_SEC)
            try:
                _movie_hunt_poll_completions()
            except Exception:
                pass

    _movie_hunt_poller_thread = threading.Thread(target=_run, daemon=True)
    _movie_hunt_poller_thread.start()
    movie_hunt_logger.info("Import: background poll started (every %s s) to detect completed downloads.", _MOVIE_HUNT_POLL_INTERVAL_SEC)


def _get_activity_queue():
    """Fetch queue from Movie Hunt download clients only (SABnzbd/NZBGet). 100% independent of Radarr."""
    _ensure_movie_hunt_poller_started()
    clients = _get_clients_config()
    enabled = [c for c in clients if c.get('enabled', True)]
    if not enabled:
        movie_hunt_logger.info("Queue: no download clients configured or enabled. Add SABnzbd/NZBGet in Settings → Movie Hunt → Clients (total in config: %s).", len(clients))
        return [], 0
    movie_hunt_logger.debug("Queue: fetching from %s download client(s)", len(enabled))
    all_items = []
    for client in enabled:
        items = _get_download_client_queue(client)
        all_items.extend(items)
    if all_items:
        movie_hunt_logger.debug("Queue: returning %s item(s) from download client(s)", len(all_items))
    else:
        movie_hunt_logger.debug("Queue: no items in download client(s)")
    return all_items, len(all_items)


@movie_hunt_bp.route('/api/activity/<view>', methods=['GET'])
def api_activity_get(view):
    """Get activity items (queue, history, or blocklist). Queue uses Movie Hunt download clients; history uses Movie Hunt import history."""
    if view not in ('queue', 'history', 'blocklist'):
        return jsonify({'error': 'Invalid view'}), 400
    page = max(1, request.args.get('page', 1, type=int))
    page_size = max(1, min(100, request.args.get('page_size', 20, type=int)))
    search = (request.args.get('search') or '').strip().lower()

    if view == 'queue':
        all_items, total = _get_activity_queue()
        if search:
            all_items = [i for i in all_items if search in (i.get('movie') or '').lower() or search in str(i.get('year') or '').lower()]
            total = len(all_items)
        else:
            total = len(all_items)
        total_pages = max(1, (total + page_size - 1) // page_size)
        start = (page - 1) * page_size
        page_items = all_items[start:start + page_size]
        return jsonify({
            'items': page_items,
            'total': total,
            'page': page,
            'total_pages': total_pages
        }), 200

    # History: Get Movie Hunt import history
    if view == 'history':
        try:
            from src.primary.history_manager import get_history
            result = get_history('movie_hunt', search_query=search if search else None, page=page, page_size=page_size)
            
            # Map history entries to activity format
            history_items = []
            for entry in result.get('entries', []):
                # Extract title/year from processed_info (format: "Movie Title (2020) → FolderName")
                processed_info = entry.get('processed_info', '')
                title_part = processed_info.split(' → ')[0] if ' → ' in processed_info else processed_info
                
                history_items.append({
                    'id': entry.get('id'),
                    'movie': title_part,
                    'title': title_part,
                    'year': '',
                    'languages': '-',
                    'quality': '-',
                    'formats': '-',
                    'date': entry.get('date_time_readable', ''),
                    'instance_name': entry.get('instance_name', 'Download client'),
                })
            
            return jsonify({
                'items': history_items,
                'total': result.get('total_entries', 0),
                'page': page,
                'total_pages': result.get('total_pages', 1)
            }), 200
            
        except Exception as e:
            logger.error(f"Error getting Movie Hunt history: {e}")
            return jsonify({
                'items': [],
                'total': 0,
                'page': page,
                'total_pages': 1
            }), 200
    
    # Blocklist: list of failed releases (movie_title, source_title, reason_failed, date)
    if view == 'blocklist':
        all_entries = _get_blocklist_raw()
        if search:
            q = search
            all_entries = [
                e for e in all_entries
                if q in (e.get('movie_title') or '').lower() or q in (e.get('source_title') or '').lower() or q in (e.get('reason_failed') or '').lower()
            ]
        total = len(all_entries)
        total_pages = max(1, (total + page_size - 1) // page_size)
        start = (page - 1) * page_size
        page_entries = all_entries[start:start + page_size]
        # Format for frontend: movie, source_title, reason_failed, date (readable)
        items = []
        for e in page_entries:
            ts = e.get('date_added')
            if isinstance(ts, (int, float)):
                try:
                    from datetime import datetime
                    dt = datetime.utcfromtimestamp(ts)
                    date_str = dt.strftime('%b %d %Y')
                except Exception:
                    date_str = str(ts)
            else:
                date_str = str(ts) if ts else '-'
            items.append({
                'movie': (e.get('movie_title') or '').strip() or '-',
                'movie_title': (e.get('movie_title') or '').strip(),
                'source_title': (e.get('source_title') or '').strip(),
                'reason_failed': (e.get('reason_failed') or '').strip() or 'Download failed',
                'date': date_str,
            })
        return jsonify({
            'items': items,
            'total': total,
            'page': page,
            'total_pages': total_pages
        }), 200

    return jsonify({
        'items': [],
        'total': 0,
        'page': page,
        'total_pages': 1
    }), 200


def _remove_activity_queue_items(items):
    """Remove selected items from Movie Hunt download client queue. items = [ {id, instance_name}, ... ]. Returns (success, error_message)."""
    if not items or not isinstance(items, list):
        return False, 'No items selected'
    clients = _get_clients_config()
    enabled = [c for c in clients if c.get('enabled', True)]
    if not enabled:
        return False, 'No download clients configured or enabled'
    by_name = {}
    for it in items:
        if not isinstance(it, dict):
            continue
        iid = it.get('id')
        name = (it.get('instance_name') or 'Default').strip()
        if iid is None:
            continue
        by_name.setdefault(name, []).append(iid)
    if not by_name:
        return False, 'No valid items selected'
    client_by_name = {(c.get('name') or 'Download client').strip() or 'Download client': c for c in enabled}
    removed = 0
    errors = []
    for name, ids in by_name.items():
        client = client_by_name.get(name)
        if not client:
            errors.append(name)
            continue
        try:
            n, err = _delete_from_download_client(client, ids)
            removed += n
            if err:
                errors.append(name)
        except Exception as e:
            logger.debug("Movie Hunt remove selected for %s: %s", name, e)
            errors.append(name)
    if errors:
        return removed > 0, ('Removed %d item(s). Failed for: %s' % (removed, ', '.join(errors))) if removed else ('Failed for: %s' % ', '.join(errors))
    return True, None


def _clear_activity_queue():
    """Remove all items from Movie Hunt download client queue. Returns (success, error_message)."""
    all_items, _ = _get_activity_queue()
    if not all_items:
        return True, None
    to_remove = [{'id': i.get('id'), 'instance_name': i.get('instance_name') or 'Download client'} for i in all_items if i.get('id') is not None]
    if not to_remove:
        return True, None
    return _remove_activity_queue_items(to_remove)


@movie_hunt_bp.route('/api/activity/<view>', methods=['DELETE'])
def api_activity_delete(view):
    """Remove selected queue items (body: { items: [{ id, instance_name }, ...] }). Blocklist: body { source_title } or { items: [{ source_title }] }."""
    if view not in ('queue', 'history', 'blocklist'):
        return jsonify({'error': 'Invalid view'}), 400
    if view == 'queue':
        body = request.get_json(silent=True) or {}
        items = body.get('items') if isinstance(body, dict) else None
        if not items or not isinstance(items, list) or len(items) == 0:
            return jsonify({'success': False, 'error': 'No items selected'}), 200
        success, err_msg = _remove_activity_queue_items(items)
        if not success and err_msg:
            return jsonify({'success': False, 'error': err_msg}), 200
        return jsonify({'success': True}), 200
    if view == 'blocklist':
        body = request.get_json(silent=True) or {}
        source_titles = []
        if isinstance(body.get('source_title'), str):
            source_titles.append(body['source_title'].strip())
        for it in (body.get('items') or []):
            if isinstance(it, dict) and (it.get('source_title') or '').strip():
                source_titles.append(it['source_title'].strip())
        if not source_titles:
            return jsonify({'success': False, 'error': 'No blocklist entry specified (source_title)'}), 200
        _blocklist_remove(source_titles)
        return jsonify({'success': True}), 200
    return jsonify({'success': True}), 200


# --- Movie Hunt Custom Formats (JSON; Pre-Format + Import) ---
# TRaSH Guides categories and format JSONs from src/primary/trash_custom_formats.py
from .. import trash_custom_formats


def _custom_format_name_from_json(obj):
    """Extract display name from Movie Hunt custom format JSON (top-level 'name' field)."""
    if isinstance(obj, dict) and obj.get('name') is not None:
        return str(obj.get('name', '')).strip() or 'Unnamed'
    return 'Unnamed'


def _recommended_score_from_json(custom_format_json):
    """Extract recommended score from Movie Hunt/TRaSH custom format JSON (trash_scores.default). Returns None if not present."""
    if not custom_format_json:
        return None
    try:
        obj = json.loads(custom_format_json) if isinstance(custom_format_json, str) else custom_format_json
    except (TypeError, json.JSONDecodeError):
        return None
    if not isinstance(obj, dict):
        return None
    trash_scores = obj.get('trash_scores')
    if isinstance(trash_scores, dict) and 'default' in trash_scores:
        try:
            return int(trash_scores['default'])
        except (TypeError, ValueError):
            pass
    return None


def _get_custom_formats_config():
    """Get Movie Hunt custom formats list from database. Default: empty list."""
    from src.primary.utils.database import get_database
    db = get_database()
    config = db.get_app_config('movie_hunt_custom_formats')
    if not config or not isinstance(config.get('custom_formats'), list):
        return []
    return list(config['custom_formats'])


def _save_custom_formats_config(formats_list):
    """Save Movie Hunt custom formats list to database."""
    from src.primary.utils.database import get_database
    db = get_database()
    db.save_app_config('movie_hunt_custom_formats', {'custom_formats': formats_list})


@movie_hunt_bp.route('/api/custom-formats', methods=['GET'])
def api_custom_formats_list():
    """List Movie Hunt custom formats. Returns list of { index, title, name, custom_format_json, score, recommended_score }."""
    try:
        formats = _get_custom_formats_config()
        out = []
        for i, f in enumerate(formats):
            src = (f.get('source') or 'import').strip().lower()
            if src not in ('import', 'preformat'):
                src = 'import'
            cf_json = f.get('custom_format_json') or '{}'
            score = f.get('score')
            if score is None:
                score = 0
            try:
                score = int(score)
            except (TypeError, ValueError):
                score = 0
            recommended = _recommended_score_from_json(cf_json)
            item = {
                'index': i,
                'title': (f.get('title') or f.get('name') or 'Unnamed').strip() or 'Unnamed',
                'name': (f.get('name') or 'Unnamed').strip() or 'Unnamed',
                'custom_format_json': cf_json,
                'source': src,
                'score': score,
                'recommended_score': recommended,
            }
            if src == 'preformat' and f.get('preformat_id'):
                item['preformat_id'] = f.get('preformat_id')
            out.append(item)
        return jsonify({'custom_formats': out}), 200
    except Exception as e:
        logger.exception('Custom formats list error')
        return jsonify({'custom_formats': [], 'error': str(e)}), 200


@movie_hunt_bp.route('/api/custom-formats/preformats', methods=['GET'])
def api_custom_formats_preformats():
    """List TRaSH categories (with subcategories and formats) and flat preformats for backward compat."""
    try:
        categories = trash_custom_formats.get_trash_categories()
        all_ids = trash_custom_formats.get_all_preformat_ids()
        preformats = [{'id': pid, 'name': trash_custom_formats.get_trash_format_name(pid) or pid} for pid in all_ids]
        return jsonify({'categories': categories, 'preformats': preformats}), 200
    except Exception as e:
        logger.exception('Preformats list error')
        return jsonify({'categories': [], 'preformats': [], 'error': str(e)}), 200


@movie_hunt_bp.route('/api/custom-formats', methods=['POST'])
def api_custom_formats_add():
    """Add custom format. Body: source='import'|'preformat', custom_format_json? (for import), preformat_id? (for preformat), title? (optional override)."""
    try:
        data = request.get_json() or {}
        source = (data.get('source') or 'import').strip().lower()
        if source not in ('import', 'preformat'):
            return jsonify({'success': False, 'message': 'source must be import or preformat'}), 400

        if source == 'import':
            raw = data.get('custom_format_json')
            if raw is None or (isinstance(raw, str) and not raw.strip()):
                return jsonify({'success': False, 'message': 'custom_format_json is required for import'}), 400
            if isinstance(raw, str):
                try:
                    obj = json.loads(raw)
                except json.JSONDecodeError as e:
                    return jsonify({'success': False, 'message': f'Invalid JSON: {e}'}), 400
            else:
                obj = raw
            name = _custom_format_name_from_json(obj)
            custom_format_json = json.dumps(obj) if isinstance(obj, dict) else json.dumps(raw)
        else:
            preformat_id = (data.get('preformat_id') or '').strip()
            if not preformat_id:
                return jsonify({'success': False, 'message': 'preformat_id is required for preformat'}), 400
            custom_format_json = trash_custom_formats.get_trash_format_json(preformat_id)
            name = trash_custom_formats.get_trash_format_name(preformat_id)
            if not custom_format_json or not name:
                return jsonify({'success': False, 'message': 'Unknown preformat_id'}), 400
            if isinstance(custom_format_json, dict):
                custom_format_json = json.dumps(custom_format_json)

        title = (data.get('title') or '').strip() or name
        formats = _get_custom_formats_config()
        new_item = {
            'title': title,
            'name': name,
            'custom_format_json': custom_format_json,
            'source': source,
            'score': 0,
        }
        if source == 'preformat' and preformat_id:
            new_item['preformat_id'] = preformat_id
        formats.append(new_item)
        _save_custom_formats_config(formats)
        return jsonify({'success': True, 'index': len(formats) - 1}), 200
    except Exception as e:
        logger.exception('Custom formats add error')
        return jsonify({'success': False, 'error': str(e)}), 500


@movie_hunt_bp.route('/api/custom-formats/scores', methods=['PUT'])
def api_custom_formats_scores_batch():
    """Update all custom format scores in one request. Body: { scores: [ ... ] } (array by index). Avoids race when saving many."""
    try:
        data = request.get_json() or {}
        scores = data.get('scores')
        if not isinstance(scores, list):
            return jsonify({'success': False, 'message': 'scores array required'}), 400
        formats = _get_custom_formats_config()
        if len(scores) != len(formats):
            return jsonify({'success': False, 'message': 'scores length must match custom formats count'}), 400
        for i in range(len(formats)):
            try:
                val = int(scores[i])
            except (TypeError, ValueError, IndexError):
                val = 0
            formats[i]['score'] = val
        _save_custom_formats_config(formats)
        return jsonify({'success': True}), 200
    except Exception as e:
        logger.exception('Custom formats scores batch error')
        return jsonify({'success': False, 'error': str(e)}), 500


@movie_hunt_bp.route('/api/custom-formats/<int:index>', methods=['PATCH'])
def api_custom_formats_patch(index):
    """Update custom format. Body: title?, custom_format_json?, score?."""
    try:
        formats = _get_custom_formats_config()
        if index < 0 or index >= len(formats):
            return jsonify({'success': False, 'message': 'Index out of range'}), 400
        data = request.get_json() or {}
        if data.get('title') is not None:
            formats[index]['title'] = (data.get('title') or '').strip() or formats[index].get('name') or 'Unnamed'
        if data.get('score') is not None:
            try:
                formats[index]['score'] = int(data['score'])
            except (TypeError, ValueError):
                formats[index]['score'] = 0
        if data.get('custom_format_json') is not None:
            raw = data['custom_format_json']
            if isinstance(raw, str) and raw.strip():
                try:
                    obj = json.loads(raw)
                    formats[index]['custom_format_json'] = json.dumps(obj)
                    formats[index]['name'] = _custom_format_name_from_json(obj)
                except json.JSONDecodeError:
                    pass
            elif isinstance(raw, dict):
                formats[index]['custom_format_json'] = json.dumps(raw)
                formats[index]['name'] = _custom_format_name_from_json(raw)
        _save_custom_formats_config(formats)
        return jsonify({'success': True}), 200
    except Exception as e:
        logger.exception('Custom formats patch error')
        return jsonify({'success': False, 'error': str(e)}), 500


@movie_hunt_bp.route('/api/custom-formats/<int:index>', methods=['DELETE'])
def api_custom_formats_delete(index):
    """Delete custom format at index."""
    try:
        formats = _get_custom_formats_config()
        if index < 0 or index >= len(formats):
            return jsonify({'success': False, 'message': 'Index out of range'}), 400
        formats.pop(index)
        _save_custom_formats_config(formats)
        return jsonify({'success': True}), 200
    except Exception as e:
        logger.exception('Custom formats delete error')
        return jsonify({'success': False, 'error': str(e)}), 500


@movie_hunt_bp.route('/api/custom-formats/preformats/<preformat_id>', methods=['GET'])
def api_custom_formats_preformat_json(preformat_id):
    """Get full JSON for a TRaSH pre-made format by id."""
    try:
        custom_format_json = trash_custom_formats.get_trash_format_json(preformat_id)
        name = trash_custom_formats.get_trash_format_name(preformat_id)
        if not custom_format_json:
            return jsonify({'success': False, 'message': 'Not found'}), 404
        if isinstance(custom_format_json, dict):
            custom_format_json = json.dumps(custom_format_json)
        return jsonify({'success': True, 'name': name or preformat_id, 'custom_format_json': custom_format_json}), 200
    except Exception as e:
        logger.exception('Preformat get error')
        return jsonify({'success': False, 'error': str(e)}), 500


def _get_clients_config():
    """Get download clients list from database (app_config app_type=clients)."""
    from src.primary.utils.database import get_database
    db = get_database()
    config = db.get_app_config('clients')
    if not config or not isinstance(config.get('clients'), list):
        return []
    return config['clients']


def _save_clients_list(clients_list):
    """Save download clients list to database."""
    from src.primary.utils.database import get_database
    db = get_database()
    db.save_app_config('clients', {'clients': clients_list})


def _clamp_priority(val, lo=1, hi=99, default=50):
    """Clamp client_priority to [lo, hi]; return default if invalid."""
    try:
        n = int(val)  # accept str or int (JSON may send number)
        return max(lo, min(hi, n))
    except (TypeError, ValueError):
        return default


@movie_hunt_bp.route('/api/clients', methods=['GET'])
def api_clients_list():
    """List saved download clients (sensitive fields masked to last 4 chars)."""
    try:
        clients = _get_clients_config()
        out = []
        for i, c in enumerate(clients):
            api_key = (c.get('api_key') or '')
            api_key_last4 = api_key[-4:] if len(api_key) >= 4 else '****'
            
            pwd = (c.get('password') or '')
            password_last4 = pwd[-4:] if len(pwd) >= 4 else '****'
            
            out.append({
                'index': i,
                'name': c.get('name') or 'Unnamed',
                'type': c.get('type') or 'nzbget',
                'host': c.get('host') or '',
                'port': c.get('port') or 8080,
                'enabled': c.get('enabled', True),
                'api_key_last4': api_key_last4,
                'username': c.get('username') or '',
                'password_last4': password_last4,
                'category': c.get('category') or 'movies',
                'recent_priority': c.get('recent_priority') or 'default',
                'older_priority': c.get('older_priority') or 'default',
                'client_priority': _clamp_priority(c.get('client_priority'), 1, 99, 50),
            })
        return jsonify({'clients': out}), 200
    except Exception as e:
        logger.exception('Clients list error')
        return jsonify({'clients': [], 'error': str(e)}), 200


@movie_hunt_bp.route('/api/clients', methods=['POST'])
def api_clients_add():
    """Add a new download client. Body: { name, type, host, port, enabled, api_key, username, password, category, recent_priority, older_priority, client_priority }."""
    try:
        data = request.get_json() or {}
        name = (data.get('name') or '').strip() or 'Unnamed'
        client_type = (data.get('type') or 'nzbget').strip().lower()
        host = (data.get('host') or '').strip()
        raw_port = data.get('port')
        if raw_port is None or (isinstance(raw_port, str) and str(raw_port).strip() == ''):
            port = 8080
        else:
            try:
                port = int(raw_port)  # accept str or int (JSON may send number)
            except (TypeError, ValueError):
                port = 8080
        enabled = data.get('enabled', True)
        api_key = (data.get('api_key') or '').strip()
        username = (data.get('username') or '').strip()
        password = (data.get('password') or '').strip()
        category = (data.get('category') or 'movies').strip() or 'movies'
        recent_priority = (data.get('recent_priority') or 'default').strip().lower() or 'default'
        older_priority = (data.get('older_priority') or 'default').strip().lower() or 'default'
        client_priority = _clamp_priority(data.get('client_priority'), 1, 99, 50)
        clients = _get_clients_config()
        clients.append({
            'name': name,
            'type': client_type,
            'host': host,
            'port': port,
            'enabled': enabled,
            'api_key': api_key,
            'username': username,
            'password': password,
            'category': category,
            'recent_priority': recent_priority,
            'older_priority': older_priority,
            'client_priority': client_priority,
        })
        _save_clients_list(clients)
        return jsonify({'success': True, 'index': len(clients) - 1}), 200
    except Exception as e:
        logger.exception('Clients add error')
        return jsonify({'success': False, 'error': str(e)}), 500


@movie_hunt_bp.route('/api/clients/<int:index>', methods=['PUT'])
def api_clients_update(index):
    """Update download client at index. Body: { name, type, host, port, enabled, api_key?, username?, password? }. Omit credentials to keep existing."""
    try:
        clients = _get_clients_config()
        if index < 0 or index >= len(clients):
            return jsonify({'success': False, 'error': 'Index out of range'}), 400
        data = request.get_json() or {}
        name = (data.get('name') or '').strip() or 'Unnamed'
        client_type = (data.get('type') or 'nzbget').strip().lower()
        host = (data.get('host') or '').strip()
        raw_port = data.get('port')
        if raw_port is None or (isinstance(raw_port, str) and str(raw_port).strip() == ''):
            port = clients[index].get('port', 8080)
        else:
            try:
                port = int(raw_port)  # accept str or int (JSON may send number)
            except (TypeError, ValueError):
                port = clients[index].get('port', 8080)
        enabled = data.get('enabled', True)
        
        # Handle API key
        api_key_new = (data.get('api_key') or '').strip()
        existing = clients[index]
        api_key = api_key_new if api_key_new else (existing.get('api_key') or '')
        
        # Handle username
        username_new = (data.get('username') or '').strip()
        username = username_new if username_new else (existing.get('username') or '')
        
        # Handle password
        password_new = (data.get('password') or '').strip()
        password = password_new if password_new else (existing.get('password') or '')
        
        category = (data.get('category') or existing.get('category') or 'movies').strip() or 'movies'
        recent_priority = (data.get('recent_priority') or existing.get('recent_priority') or 'default').strip().lower() or 'default'
        older_priority = (data.get('older_priority') or existing.get('older_priority') or 'default').strip().lower() or 'default'
        client_priority = _clamp_priority(data.get('client_priority') if 'client_priority' in data else existing.get('client_priority'), 1, 99, 50)
        clients[index] = {
            'name': name,
            'type': client_type,
            'host': host,
            'port': port,
            'enabled': enabled,
            'api_key': api_key,
            'username': username,
            'password': password,
            'category': category,
            'recent_priority': recent_priority,
            'older_priority': older_priority,
            'client_priority': client_priority,
        }
        _save_clients_list(clients)
        return jsonify({'success': True}), 200
    except Exception as e:
        logger.exception('Clients update error')
        return jsonify({'success': False, 'error': str(e)}), 500


@movie_hunt_bp.route('/api/clients/<int:index>', methods=['DELETE'])
def api_clients_delete(index):
    """Delete download client at index."""
    try:
        clients = _get_clients_config()
        if index < 0 or index >= len(clients):
            return jsonify({'success': False, 'error': 'Index out of range'}), 400
        clients.pop(index)
        _save_clients_list(clients)
        return jsonify({'success': True}), 200
    except Exception as e:
        logger.exception('Clients delete error')
        return jsonify({'success': False, 'error': str(e)}), 500


@movie_hunt_bp.route('/api/clients/test-connection', methods=['POST'])
def api_clients_test_connection():
    """Test connection to a download client (SABnzbd or NZBGet)."""
    try:
        data = request.get_json() or {}
        client_type = (data.get('type') or 'nzbget').strip().lower()
        host = (data.get('host') or '').strip()
        port = data.get('port', 8080)
        api_key = (data.get('api_key') or '').strip()
        username = (data.get('username') or '').strip()
        password = (data.get('password') or '').strip()
        
        if not host:
            return jsonify({'success': False, 'message': 'Host is required'}), 400
        
        # Auto-correct URL if missing http(s) scheme
        if not (host.startswith('http://') or host.startswith('https://')):
            host = f"http://{host}"
        
        # Build the base URL
        base_url = f"{host.rstrip('/')}:{port}"
        
        # Get SSL verification setting
        from src.primary.settings_manager import get_ssl_verify_setting
        verify_ssl = get_ssl_verify_setting()
        
        # Test connection based on client type
        if client_type == 'sabnzbd':
            # SABnzbd uses /api?mode=version
            test_url = f"{base_url}/api"
            params = {'mode': 'version', 'output': 'json'}
            if api_key:
                params['apikey'] = api_key
            
            try:
                response = requests.get(test_url, params=params, timeout=10, verify=verify_ssl)
                response.raise_for_status()
                data = response.json()
                
                # SABnzbd returns version in the 'version' key
                if 'version' in data:
                    version = data['version']
                    return jsonify({'success': True, 'message': f'Connected to SABnzbd {version}'}), 200
                else:
                    return jsonify({'success': False, 'message': 'Connected but unexpected response format'}), 200
                    
            except requests.exceptions.HTTPError as e:
                if response.status_code == 401 or response.status_code == 403:
                    return jsonify({'success': False, 'message': 'Authentication failed: Invalid API key'}), 200
                else:
                    return jsonify({'success': False, 'message': f'HTTP Error {response.status_code}'}), 200
            except requests.exceptions.Timeout:
                return jsonify({'success': False, 'message': 'Connection timeout'}), 200
            except requests.exceptions.ConnectionError:
                return jsonify({'success': False, 'message': 'Connection refused - Check host and port'}), 200
            except Exception as e:
                return jsonify({'success': False, 'message': str(e)}), 200
                
        elif client_type == 'nzbget':
            # NZBGet uses JSON-RPC API
            test_url = f"{base_url}/jsonrpc"
            
            # Build JSON-RPC request for version
            payload = {
                'method': 'version',
                'params': [],
                'id': 1
            }
            
            try:
                # NZBGet uses HTTP basic auth
                auth = (username, password) if username and password else None
                
                response = requests.post(test_url, json=payload, auth=auth, timeout=10, verify=verify_ssl)
                response.raise_for_status()
                data = response.json()
                
                # NZBGet returns version in the 'result' key
                if 'result' in data:
                    version = data['result']
                    return jsonify({'success': True, 'message': f'Connected to NZBGet {version}'}), 200
                elif 'error' in data:
                    error_msg = data['error'].get('message', 'Unknown error')
                    return jsonify({'success': False, 'message': f'NZBGet error: {error_msg}'}), 200
                else:
                    return jsonify({'success': False, 'message': 'Connected but unexpected response format'}), 200
                    
            except requests.exceptions.HTTPError as e:
                if response.status_code == 401 or response.status_code == 403:
                    return jsonify({'success': False, 'message': 'Authentication failed: Invalid username or password'}), 200
                else:
                    return jsonify({'success': False, 'message': f'HTTP Error {response.status_code}'}), 200
            except requests.exceptions.Timeout:
                return jsonify({'success': False, 'message': 'Connection timeout'}), 200
            except requests.exceptions.ConnectionError:
                return jsonify({'success': False, 'message': 'Connection refused - Check host and port'}), 200
            except Exception as e:
                return jsonify({'success': False, 'message': str(e)}), 200
        else:
            return jsonify({'success': False, 'message': f'Unknown client type: {client_type}'}), 400
            
    except Exception as e:
        logger.exception('Client connection test error')
        return jsonify({'success': False, 'message': 'Internal server error'}), 500


def _search_newznab_movie(base_url, api_key, query, categories, timeout=15):
    """
    Search a Newznab indexer for movie NZBs. Returns list of {title, nzb_url}.
    categories: list of category ids (e.g. 2000,2010) or comma string.
    """
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
        # Parse JSON (some indexers return JSON)
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
                    results.append({'title': title, 'nzb_url': nzb_url})
                return results
            except (ValueError, TypeError, KeyError):
                pass
        # Parse XML (default Newznab response)
        root = ET.fromstring(text)
        ns = {'nzb': 'http://www.newznab.com/DTD/2010/feeds/'}
        items = root.findall('.//nzb:item', ns) or root.findall('.//item')
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
            results.append({'title': title, 'nzb_url': nzb_url})
        return results
    except (ET.ParseError, requests.RequestException) as e:
        logger.debug('Newznab search error: %s', e)
        return []


def _add_nzb_to_download_client(client, nzb_url, nzb_name, category, verify_ssl):
    """
    Send NZB URL to SABnzbd or NZBGet. Returns (success: bool, message: str, queue_id: str|int|None).
    queue_id is the nzo_id (SAB) or NZBGet group id so we can track this as a requested item.
    """
    client_type = (client.get('type') or 'nzbget').strip().lower()
    host = (client.get('host') or '').strip()
    if not host:
        return False, 'Download client has no host', None
    if not (host.startswith('http://') or host.startswith('https://')):
        host = f'http://{host}'
    port = client.get('port', 8080)
    base_url = f'{host.rstrip("/")}:{port}'
    # When category is empty or "default", send "movies" so SAB gets a proper category.
    raw = (category or client.get('category') or '').strip()
    if raw.lower() in ('default', '*', ''):
        cat = MOVIE_HUNT_DEFAULT_CATEGORY
    else:
        cat = raw or MOVIE_HUNT_DEFAULT_CATEGORY
    try:
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
                # NZBGet append returns group id in result
                return True, 'Added to NZBGet', data.get('result')
            err = data.get('error', {})
            return False, err.get('message', 'NZBGet returned an error'), None
        return False, f'Unknown client type: {client_type}', None
    except requests.RequestException as e:
        return False, str(e) or 'Connection failed', None


@movie_hunt_bp.route('/api/movie-hunt/request', methods=['POST'])
def api_movie_hunt_request():
    """
    Request a movie via Movie Hunt: search configured indexers, send first NZB to first enabled download client.
    Body: { title, year?, instance?, root_folder?, quality_profile? }. Instance defaults to "default".
    """
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
        instance = (data.get('instance') or 'default').strip() or 'default'
        root_folder = (data.get('root_folder') or '').strip() or None
        quality_profile = (data.get('quality_profile') or '').strip() or None

        movie_hunt_logger.info("Request: received for '%s' (%s)", title, year or 'no year')

        indexers = _get_indexers_config()
        clients = _get_clients_config()
        enabled_indexers = [i for i in indexers if i.get('enabled', True) and (i.get('preset') or '').strip().lower() != 'manual']
        enabled_clients = [c for c in clients if c.get('enabled', True)]

        if not enabled_indexers:
            movie_hunt_logger.warning("Request: no indexers configured or enabled for '%s'", title)
            return jsonify({'success': False, 'message': 'No indexers configured or enabled. Add indexers in Movie Hunt Settings.'}), 400
        if not enabled_clients:
            movie_hunt_logger.warning("Request: no download clients configured or enabled for '%s'", title)
            return jsonify({'success': False, 'message': 'No download clients configured or enabled. Add a client in Movie Hunt Settings.'}), 400

        query = f'{title}'
        if year:
            query = f'{title} {year}'
        # Resolve selected quality profile so we only pick a release that matches its setup
        profile = _get_profile_by_name_or_default(quality_profile)
        from src.primary.settings_manager import get_ssl_verify_setting
        verify_ssl = get_ssl_verify_setting()
        nzb_url = None
        nzb_title = None
        indexer_used = None
        request_score = 0
        request_score_breakdown = ''
        for idx in enabled_indexers:
            preset = (idx.get('preset') or '').strip().lower()
            base_url = INDEXER_PRESET_URLS.get(preset)
            if not base_url:
                continue
            api_key = (idx.get('api_key') or '').strip()
            if not api_key:
                continue
            categories = idx.get('categories') or [2000, 2010, 2020, 2030, 2040, 2045, 2050, 2070]
            results = _search_newznab_movie(base_url, api_key, query, categories, timeout=15)
            if results:
                # Exclude blocklisted releases so we pick a different one
                blocklist_titles = _get_blocklist_source_titles()
                if blocklist_titles:
                    results = [r for r in results if _blocklist_normalize_source_title(r.get('title')) not in blocklist_titles]
                    if not results:
                        continue
                # Pick best release by score among those matching the profile (not just first)
                chosen, chosen_score, chosen_breakdown = _best_result_matching_profile(results, profile)
                min_score = profile.get('min_custom_format_score', 0)
                try:
                    min_score = int(min_score)
                except (TypeError, ValueError):
                    min_score = 0
                # Only request if the best matching release meets the profile's minimum custom format score
                if chosen and chosen_score >= min_score:
                    nzb_url = chosen.get('nzb_url')
                    nzb_title = chosen.get('title', 'Unknown')
                    indexer_used = idx.get('name') or preset
                    request_score = chosen_score
                    request_score_breakdown = chosen_breakdown or ''
                    movie_hunt_logger.info(
                        "Request: chosen release for '%s' (%s) — score %s (min %s). %s",
                        title, year or 'no year', request_score, min_score,
                        request_score_breakdown if request_score_breakdown else 'No breakdown'
                    )
                    break
        if not nzb_url:
            profile_name = (profile.get('name') or 'Standard').strip()
            min_score = profile.get('min_custom_format_score', 0)
            try:
                min_score = int(min_score)
            except (TypeError, ValueError):
                min_score = 0
            movie_hunt_logger.warning("Request: no release found for '%s' (%s) matching profile '%s' (min score %s)", title, year or 'no year', profile_name, min_score)
            return jsonify({
                'success': False,
                'message': f'No release found that matches your quality profile "{profile_name}" or meets the minimum custom format score ({min_score}). The indexer had results but none were in the allowed resolutions/sources or had a score at or above the minimum. Try a different profile, lower the minimum score, or search again later.'
            }), 404
        client = enabled_clients[0]
        # Use client's category; empty/default → "movies" so we send and filter by "movies"
        raw_cat = (client.get('category') or '').strip()
        request_category = MOVIE_HUNT_DEFAULT_CATEGORY if raw_cat.lower() in ('default', '*', '') else (raw_cat or MOVIE_HUNT_DEFAULT_CATEGORY)
        ok, msg, queue_id = _add_nzb_to_download_client(client, nzb_url, nzb_title or f'{title}.nzb', request_category, verify_ssl)
        if not ok:
            movie_hunt_logger.error("Request: send to download client failed for '%s': %s", title, msg)
            return jsonify({'success': False, 'message': f'Sent to download client but failed: {msg}'}), 500
        movie_hunt_logger.info(
            "Request: '%s' (%s) sent to %s. Indexer: %s. Score: %s — %s",
            title, year or 'no year', client.get('name') or 'download client',
            indexer_used or '-', request_score,
            request_score_breakdown if request_score_breakdown else 'no breakdown'
        )
        # Track this request so Activity queue only shows items we requested (with title/year and score for display)
        if queue_id:
            client_name = (client.get('name') or 'Download client').strip() or 'Download client'
            _add_requested_queue_id(client_name, queue_id, title=title, year=year or '', score=request_score, score_breakdown=request_score_breakdown)
        # Add to Media Collection for tracking (with root_folder for auto availability detection)
        tmdb_id = data.get('tmdb_id')
        poster_path = (data.get('poster_path') or '').strip() or None
        root_folder = (data.get('root_folder') or '').strip() or None
        _collection_append(title=title, year=year, tmdb_id=tmdb_id, poster_path=poster_path, root_folder=root_folder)
        return jsonify({
            'success': True,
            'message': f'"{title}" sent to {client.get("name") or "download client"}.',
            'indexer': indexer_used,
            'client': client.get('name') or 'download client'
        }), 200
    except Exception as e:
        try:
            req_title = (request.get_json() or {}).get('title') or 'unknown'
        except Exception:
            req_title = 'unknown'
        movie_hunt_logger.exception("Request: error for '%s': %s", req_title, e)
        return jsonify({'success': False, 'message': str(e)}), 500


def _get_collection_config():
    """Get Movie Hunt collection (requested media) from database."""
    from src.primary.utils.database import get_database
    db = get_database()
    config = db.get_app_config('movie_hunt_collection')
    if not config or not isinstance(config.get('items'), list):
        return []
    return config['items']


def _save_collection_config(items_list):
    """Save Movie Hunt collection to database."""
    from src.primary.utils.database import get_database
    db = get_database()
    db.save_app_config('movie_hunt_collection', {'items': items_list})


def _collection_append(title, year, tmdb_id=None, poster_path=None, root_folder=None):
    """Append one entry to Media Collection after successful request."""
    from datetime import datetime
    items = _get_collection_config()
    items.append({
        'title': title,
        'year': year or '',
        'tmdb_id': tmdb_id,
        'poster_path': poster_path or '',
        'root_folder': root_folder or '',
        'requested_at': datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ'),
        'status': 'requested'
    })
    _save_collection_config(items)


def _get_tmdb_api_key_movie_hunt():
    """TMDB API key for Movie Hunt discover only (same key as Requestarr; do not mix with Radarr/Requestarr logic)."""
    return "9265b0bd0cd1962f7f3225989fcd7192"


@movie_hunt_bp.route('/api/movie-hunt/tmdb-key', methods=['GET'])
def api_movie_hunt_tmdb_key():
    """Return TMDB API key for Movie Hunt detail page (frontend needs it to fetch movie details from TMDB)."""
    key = _get_tmdb_api_key_movie_hunt()
    return jsonify({'api_key': key or ''})


def _movie_hunt_collection_lookups():
    """
    Build sets for in_library and in_cooldown from Movie Hunt collection.
    Returns (available_tmdb_ids, available_title_year_set, cooldown_tmdb_ids, cooldown_title_year_set).
    available_title_year_set and cooldown_title_year_set contain (title_lower, year_str) tuples.
    Cooldown = requested within last 12 hours.
    """
    from datetime import datetime, timedelta
    items = _get_collection_config()
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


@movie_hunt_bp.route('/api/movie-hunt/discover/movies', methods=['GET'])
def api_movie_hunt_discover_movies():
    """
    Movie Hunt–only discover: TMDB discover/movie with in_library and in_cooldown from Movie Hunt collection.
    Accepts same filter params as Requestarr discover (genres, year, runtime, rating, votes, hide_available).
    """
    try:
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
        data = r.json()
        available_tmdb_ids, available_title_year, cooldown_tmdb_ids, cooldown_title_year = _movie_hunt_collection_lookups()
        results = []
        for item in data.get('results', []):
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
        has_more = (data.get('total_pages') or 0) >= page + 1
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


# Video extensions for availability detection in root folder
_VIDEO_EXTENSIONS = frozenset(('.mkv', '.mp4', '.avi', '.mov', '.wmv', '.m4v', '.mpg', '.mpeg', '.webm', '.flv', '.m2ts', '.ts'))


def _parse_title_year_from_name(name):
    """
    Extract (title, year) from a folder or file name. Returns (title_str, year_str).
    Handles: "Movie Title (2024)", "Movie.Title.2024.1080p.mkv", "Movie Title 2024".
    """
    import re
    if not name:
        return '', ''
    name = name.strip()
    # Strip extension if present
    if '.' in name:
        base = name
        for ext in _VIDEO_EXTENSIONS:
            if name.lower().endswith(ext):
                base = name[:-len(ext)].strip()
                break
        name = base
    year_match = re.search(r'\(?(19\d{2}|20\d{2})\)?', name)
    year_str = year_match.group(1) if year_match else ''
    if year_match:
        title_part = name[:year_match.start()].strip()
        title_part = re.sub(r'^[.\s\-_]+|[.\s\-_]+$', '', title_part)
        title_part = title_part.replace('.', ' ').replace('_', ' ').replace('-', ' ')
        title_part = ' '.join(title_part.split())
    else:
        title_part = name.replace('.', ' ').replace('_', ' ').replace('-', ' ')
        title_part = ' '.join(title_part.split())
    return title_part or name, year_str


def _scan_root_folder_for_movies(root_path):
    """
    Scan one root folder and return list of { 'title': str, 'year': str } for each detected movie.
    Looks at direct video files and one level of subdirs (folder name or video filename).
    """
    if not root_path or not os.path.isdir(root_path):
        return []
    found = []
    seen = set()
    try:
        for name in os.listdir(root_path):
            full = os.path.join(root_path, name)
            if os.path.isfile(full):
                base, ext = os.path.splitext(name)
                if ext.lower() in _VIDEO_EXTENSIONS:
                    title, year = _parse_title_year_from_name(name)
                    key = (title.lower(), year)
                    if key not in seen and title:
                        seen.add(key)
                        found.append({'title': title, 'year': year})
            elif os.path.isdir(full):
                # Prefer folder name for title/year (e.g. "Movie Title (2024)")
                title, year = _parse_title_year_from_name(name)
                if not title:
                    for subname in os.listdir(full):
                        subfull = os.path.join(full, subname)
                        if os.path.isfile(subfull):
                            base, ext = os.path.splitext(subname)
                            if ext.lower() in _VIDEO_EXTENSIONS:
                                title, year = _parse_title_year_from_name(subname)
                                break
                if title:
                    key = (title.lower(), year)
                    if key not in seen:
                        seen.add(key)
                        found.append({'title': title, 'year': year})
    except OSError:
        pass
    return found


def _get_detected_movies_from_all_roots():
    """
    Scan all configured Movie Hunt root folders and return list of { title, year } for every movie detected.
    This is the source of truth for "what's in the library" / Media Collection.
    """
    folders = _get_root_folders_config()
    all_detected = []
    seen = set()
    for f in folders:
        path = (f.get('path') or '').strip()
        if not path:
            continue
        for item in _scan_root_folder_for_movies(path):
            title = (item.get('title') or '').strip()
            year = (item.get('year') or '').strip()
            if not title:
                continue
            key = (title.lower(), year)
            if key not in seen:
                seen.add(key)
                all_detected.append({'title': title, 'year': year})
    return all_detected


def _detect_available_in_root_folder(root_path, title, year):
    """
    Check if a movie appears to be present in root_path (direct files or one level of subdirs).
    Matches by video extension and title (or title+year) in filename or parent dir name.
    """
    if not root_path or not title:
        return False
    import re
    title_lower = (title or '').lower().strip()
    year_str = (year or '').strip()
    # Normalize for matching: strip punctuation, collapse spaces
    title_norm = re.sub(r'[^\w\s]', ' ', title_lower)
    title_norm = ' '.join(title_norm.split())
    if not title_norm:
        return False
    if not os.path.isdir(root_path):
        return False
    try:
        for name in os.listdir(root_path):
            full = os.path.join(root_path, name)
            if os.path.isfile(full):
                base, ext = os.path.splitext(name)
                if ext.lower() in _VIDEO_EXTENSIONS and title_norm in base.lower().replace('.', ' ').replace('_', ' '):
                    return True
            elif os.path.isdir(full):
                for subname in os.listdir(full):
                    subfull = os.path.join(full, subname)
                    if os.path.isfile(subfull):
                        base, ext = os.path.splitext(subname)
                        if ext.lower() in _VIDEO_EXTENSIONS:
                            # Match by dir name or filename
                            if title_norm in name.lower().replace('.', ' ').replace('_', ' ') or title_norm in base.lower().replace('.', ' ').replace('_', ' '):
                                return True
                            if year_str and year_str in name and title_norm in name.lower().replace('.', ' ').replace('_', ' '):
                                return True
    except OSError:
        pass
    return False


def _normalize_root_folders(folders):
    """Ensure list of { path, is_default }; exactly one default. Accepts legacy list of strings."""
    if not folders:
        return []
    out = []
    for i, f in enumerate(folders):
        if isinstance(f, str):
            path = (f or '').strip()
        else:
            path = (f.get('path') or '').strip()
        out.append({'path': path, 'is_default': bool(f.get('is_default') if isinstance(f, dict) else False)})
    # Ensure exactly one default: if none or multiple, set first as default
    defaults = [j for j, o in enumerate(out) if o.get('is_default')]
    if len(defaults) != 1:
        for j in range(len(out)):
            out[j]['is_default'] = (j == 0)
    return out


def _get_root_folders_config():
    """Get Movie Hunt root folders list from database. Returns list of { path, is_default }."""
    from src.primary.utils.database import get_database
    db = get_database()
    config = db.get_app_config('movie_hunt_root_folders')
    if not config or not isinstance(config.get('root_folders'), list):
        return []
    raw = config['root_folders']
    normalized = _normalize_root_folders(raw)
    # Migrate legacy format (list of strings) to list of { path, is_default }
    if raw and isinstance(raw[0], str):
        db.save_app_config('movie_hunt_root_folders', {'root_folders': normalized})
    return normalized


def _save_root_folders_config(root_folders_list):
    """Save Movie Hunt root folders list to database."""
    from src.primary.utils.database import get_database
    db = get_database()
    normalized = _normalize_root_folders(root_folders_list)
    db.save_app_config('movie_hunt_root_folders', {'root_folders': normalized})


TEST_FILENAME = 'movie-hunt.test'


@movie_hunt_bp.route('/api/movie-hunt/root-folders', methods=['GET'])
def api_movie_hunt_root_folders_list():
    """List Movie Hunt root folders with free space and is_default (like Requestarr)."""
    import shutil
    try:
        folders = _get_root_folders_config()
        out = []
        for i, f in enumerate(folders):
            path = (f.get('path') or '').strip()
            free_space = None
            if path:
                try:
                    usage = shutil.disk_usage(path)
                    free_space = usage.free
                except (OSError, FileNotFoundError):
                    pass
            out.append({
                'index': i,
                'path': path,
                'freeSpace': free_space,
                'is_default': bool(f.get('is_default', False)),
            })
        return jsonify({'root_folders': out}), 200
    except Exception as e:
        logger.exception('Root folders list error')
        return jsonify({'root_folders': [], 'error': str(e)}), 200


@movie_hunt_bp.route('/api/movie-hunt/root-folders', methods=['POST'])
def api_movie_hunt_root_folders_add():
    """Add a root folder. Body: { path }. First folder is default; additional ones are not."""
    try:
        data = request.get_json() or {}
        path = (data.get('path') or '').strip()
        if not path:
            return jsonify({'success': False, 'message': 'Path is required'}), 400
        if '..' in path:
            return jsonify({'success': False, 'message': 'Path cannot contain ..'}), 400
        folders = _get_root_folders_config()
        normalized = os.path.normpath(path)
        if any((f.get('path') or '').strip() == normalized for f in folders):
            return jsonify({'success': False, 'message': 'That path is already added'}), 400
        # First folder is default; additional ones are not
        is_first = len(folders) == 0
        folders.append({'path': normalized, 'is_default': is_first})
        _save_root_folders_config(folders)
        return jsonify({'success': True, 'index': len(folders) - 1}), 200
    except Exception as e:
        logger.exception('Root folders add error')
        return jsonify({'success': False, 'message': str(e)}), 500


@movie_hunt_bp.route('/api/movie-hunt/root-folders/<int:index>', methods=['DELETE'])
def api_movie_hunt_root_folders_delete(index):
    """Delete root folder at index. If default was removed, first remaining becomes default."""
    try:
        folders = _get_root_folders_config()
        if index < 0 or index >= len(folders):
            return jsonify({'success': False, 'message': 'Index out of range'}), 400
        was_default = folders[index].get('is_default')
        folders.pop(index)
        if was_default and folders:
            folders[0]['is_default'] = True
        _save_root_folders_config(folders)
        return jsonify({'success': True}), 200
    except Exception as e:
        logger.exception('Root folders delete error')
        return jsonify({'success': False, 'message': str(e)}), 500


@movie_hunt_bp.route('/api/movie-hunt/root-folders/<int:index>/default', methods=['PATCH'])
def api_movie_hunt_root_folders_set_default(index):
    """Set root folder at index as default; others become non-default."""
    try:
        folders = _get_root_folders_config()
        if index < 0 or index >= len(folders):
            return jsonify({'success': False, 'message': 'Index out of range'}), 400
        for i in range(len(folders)):
            folders[i]['is_default'] = (i == index)
        _save_root_folders_config(folders)
        return jsonify({'success': True}), 200
    except Exception as e:
        logger.exception('Root folders set-default error')
        return jsonify({'success': False, 'message': str(e)}), 500


# Default browse root for Docker; /media is a common mount point for media
BROWSE_DEFAULT_PATH = '/'
BROWSE_ALWAYS_INCLUDE_PATHS = ('/media',)


@movie_hunt_bp.route('/api/movie-hunt/root-folders/browse', methods=['GET'])
def api_movie_hunt_root_folders_browse():
    """
    List directories under a path for the file browser. ?path= (default /).
    Returns { path, directories: [ { name, path } ] }. Ensures /media is included at root for Docker.
    """
    try:
        path = (request.args.get('path') or '').strip() or BROWSE_DEFAULT_PATH
        if '..' in path:
            return jsonify({'path': path, 'directories': [], 'error': 'Invalid path'}), 400
        dir_path = os.path.abspath(os.path.normpath(path))
        if not os.path.isdir(dir_path):
            return jsonify({'path': dir_path, 'directories': [], 'error': 'Not a directory'}), 200
        entries = []
        try:
            for name in sorted(os.listdir(dir_path)):
                full = os.path.join(dir_path, name)
                if os.path.isdir(full):
                    entries.append({'name': name, 'path': full})
        except OSError as e:
            return jsonify({'path': dir_path, 'directories': [], 'error': str(e)}), 200
        if dir_path == os.path.abspath(BROWSE_DEFAULT_PATH) or dir_path == os.path.abspath('/'):
            for extra in BROWSE_ALWAYS_INCLUDE_PATHS:
                if not any(e['path'] == extra for e in entries):
                    name = os.path.basename(extra.rstrip(os.sep)) or 'media'
                    entries.append({'name': name, 'path': extra})
            entries.sort(key=lambda e: (e['name'].lower(), e['path']))
        return jsonify({'path': dir_path, 'directories': entries}), 200
    except Exception as e:
        logger.exception('Root folders browse error')
        return jsonify({'path': '', 'directories': [], 'error': str(e)}), 500


@movie_hunt_bp.route('/api/movie-hunt/root-folders/test', methods=['POST'])
def api_movie_hunt_root_folders_test():
    """
    Test write/read on a path: write movie-hunt.test, read it back, delete it.
    Body: { path }. Ensures no permission errors for Movie Hunt media detection.
    """
    try:
        data = request.get_json() or {}
        path = (data.get('path') or '').strip()
        if not path:
            return jsonify({'success': False, 'message': 'Path is required'}), 400
        if '..' in path:
            return jsonify({'success': False, 'message': 'Path cannot contain ..'}), 400
        dir_path = os.path.abspath(os.path.normpath(path))
        if not os.path.isdir(dir_path):
            return jsonify({'success': False, 'message': f'Path is not a directory: {path}'}), 400
        test_path = os.path.join(dir_path, TEST_FILENAME)
        content = 'movie-hunt test ' + datetime.utcnow().isoformat() + 'Z'
        try:
            with open(test_path, 'w') as f:
                f.write(content)
        except OSError as e:
            return jsonify({'success': False, 'message': f'Could not write: {e}'}), 200
        try:
            with open(test_path, 'r') as f:
                read_back = f.read()
            if read_back != content:
                return jsonify({'success': False, 'message': 'Read back content did not match'}), 200
        except OSError as e:
            try:
                os.remove(test_path)
            except OSError:
                pass
            return jsonify({'success': False, 'message': f'Could not read: {e}'}), 200
        try:
            os.remove(test_path)
        except OSError:
            pass
        return jsonify({'success': True, 'message': 'Write and read test passed.'}), 200
    except Exception as e:
        logger.exception('Root folders test error')
        return jsonify({'success': False, 'message': str(e)}), 500


# --- Remote Path Mappings API --- #

def _get_remote_mappings_config():
    """Get remote path mappings list from database. Returns list of { host, remote_path, local_path }."""
    from src.primary.utils.database import get_database
    db = get_database()
    config = db.get_app_config('movie_hunt_remote_mappings')
    if not config or not isinstance(config.get('mappings'), list):
        return []
    return config['mappings']


def _save_remote_mappings_config(mappings_list):
    """Save remote path mappings list to database."""
    from src.primary.utils.database import get_database
    db = get_database()
    db.save_app_config('movie_hunt_remote_mappings', {'mappings': mappings_list})


@movie_hunt_bp.route('/api/movie-hunt/remote-mappings', methods=['GET'])
def api_movie_hunt_remote_mappings_list():
    """List Movie Hunt remote path mappings."""
    try:
        mappings = _get_remote_mappings_config()
        return jsonify({'success': True, 'mappings': mappings}), 200
    except Exception as e:
        logger.exception('Remote mappings list error')
        return jsonify({'success': False, 'mappings': [], 'error': str(e)}), 500


@movie_hunt_bp.route('/api/movie-hunt/remote-mappings', methods=['POST'])
def api_movie_hunt_remote_mappings_add():
    """Add a remote path mapping. Body: { host, remote_path, local_path }."""
    try:
        data = request.get_json() or {}
        host = (data.get('host') or '').strip()
        remote_path = (data.get('remote_path') or '').strip()
        local_path = (data.get('local_path') or '').strip()
        
        if not host:
            return jsonify({'success': False, 'message': 'Host is required'}), 400
        if not remote_path:
            return jsonify({'success': False, 'message': 'Remote path is required'}), 400
        if not local_path:
            return jsonify({'success': False, 'message': 'Local path is required'}), 400
        
        mappings = _get_remote_mappings_config()
        mappings.append({
            'host': host,
            'remote_path': remote_path,
            'local_path': local_path
        })
        _save_remote_mappings_config(mappings)
        return jsonify({'success': True, 'mapping': mappings[-1]}), 200
    except Exception as e:
        logger.exception('Remote mappings add error')
        return jsonify({'success': False, 'message': str(e)}), 500


@movie_hunt_bp.route('/api/movie-hunt/remote-mappings/<int:index>', methods=['PUT'])
def api_movie_hunt_remote_mappings_update(index):
    """Update a remote path mapping. Body: { host, remote_path, local_path }."""
    try:
        data = request.get_json() or {}
        host = (data.get('host') or '').strip()
        remote_path = (data.get('remote_path') or '').strip()
        local_path = (data.get('local_path') or '').strip()
        
        if not host:
            return jsonify({'success': False, 'message': 'Host is required'}), 400
        if not remote_path:
            return jsonify({'success': False, 'message': 'Remote path is required'}), 400
        if not local_path:
            return jsonify({'success': False, 'message': 'Local path is required'}), 400
        
        mappings = _get_remote_mappings_config()
        if index < 0 or index >= len(mappings):
            return jsonify({'success': False, 'message': 'Not found'}), 404
        
        mappings[index] = {
            'host': host,
            'remote_path': remote_path,
            'local_path': local_path
        }
        _save_remote_mappings_config(mappings)
        return jsonify({'success': True, 'mapping': mappings[index]}), 200
    except Exception as e:
        logger.exception('Remote mappings update error')
        return jsonify({'success': False, 'message': str(e)}), 500


@movie_hunt_bp.route('/api/movie-hunt/remote-mappings/<int:index>', methods=['DELETE'])
def api_movie_hunt_remote_mappings_delete(index):
    """Delete a remote path mapping at index."""
    try:
        mappings = _get_remote_mappings_config()
        if index < 0 or index >= len(mappings):
            return jsonify({'success': False, 'message': 'Not found'}), 404
        
        mappings.pop(index)
        _save_remote_mappings_config(mappings)
        return jsonify({'success': True}), 200
    except Exception as e:
        logger.exception('Remote mappings delete error')
        return jsonify({'success': False, 'message': str(e)}), 500


def _normalize_title_for_key(title):
    """Normalize title for matching (e.g. 'Demon Slayer: X' and 'Demon Slayer X' -> same key)."""
    if not title:
        return ''
    import re
    s = (title or '').strip().lower()
    s = re.sub(r'[^\w\s]', '', s)  # remove punctuation
    s = ' '.join(s.split())
    return s


def _dedupe_collection_items(combined):
    """Merge duplicates: one entry per (tmdb_id) or (normalized_title, year). Prefer available, merge poster/tmdb."""
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
    """Sort collection list by sort_key: title.asc, title.desc, year.asc, year.desc, status.asc, status.desc."""
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


@movie_hunt_bp.route('/api/movie-hunt/collection', methods=['GET'])
def api_movie_hunt_collection_list():
    """
    List Media Collection based on root folder detection.
    Collection = what we detect in all configured root folders (available) + what was requested but not yet on disk (requested).
    ?q= search, ?page=1&page_size=20, ?sort=title.asc.
    """
    try:
        # 1) Source of truth: scan all root folders for movies on disk
        detected_list = _get_detected_movies_from_all_roots()
        # Build list: each detected item as { title, year, status: 'available', poster_path, tmdb_id }
        combined = []
        for d in detected_list:
            combined.append({
                'title': d.get('title') or '',
                'year': d.get('year') or '',
                'status': 'available',
                'poster_path': '',
                'tmdb_id': None,
                'root_folder': '',
                'requested_at': '',
            })
        # 2) Merge requested list: enrich detected with poster/tmdb; add requested-only as 'requested'
        # Use normalized (title, year) so "Demon Slayer: X" matches "Demon Slayer X" from disk
        requested_list = _get_collection_config()
        combined_key_set = {(_normalize_title_for_key(item.get('title')), str(item.get('year') or '').strip()) for item in combined}
        combined_tmdb_set = {item.get('tmdb_id') for item in combined if item.get('tmdb_id') is not None}
        for req in requested_list:
            if not isinstance(req, dict):
                continue
            title = (req.get('title') or '').strip()
            year = str(req.get('year') or '').strip()
            norm_key = (_normalize_title_for_key(title), year)
            req_tmdb = req.get('tmdb_id')
            try:
                if req_tmdb is not None:
                    req_tmdb = int(req_tmdb)
            except (TypeError, ValueError):
                req_tmdb = None
            matched = False
            if norm_key in combined_key_set:
                for c in combined:
                    if (_normalize_title_for_key(c.get('title')), str(c.get('year') or '').strip()) == norm_key:
                        c['poster_path'] = req.get('poster_path') or c.get('poster_path') or ''
                        c['tmdb_id'] = req_tmdb if req_tmdb is not None else c.get('tmdb_id')
                        matched = True
                        break
            if not matched and req_tmdb is not None and req_tmdb in combined_tmdb_set:
                for c in combined:
                    if c.get('tmdb_id') == req_tmdb:
                        c['poster_path'] = req.get('poster_path') or c.get('poster_path') or ''
                        matched = True
                        break
            if not matched:
                combined.append({
                    'title': title,
                    'year': year,
                    'status': 'requested',
                    'poster_path': req.get('poster_path') or '',
                    'tmdb_id': req.get('tmdb_id'),
                    'root_folder': req.get('root_folder') or '',
                    'requested_at': req.get('requested_at') or '',
                })
        # 2b) Deduplicate: one entry per movie (by tmdb_id or normalized title+year)
        combined = _dedupe_collection_items(combined)
        # 3) Persist 'available' back to requested items that we detected (so discover/Home stay in sync)
        items_full = _get_collection_config()
        collection_updated = False
        detected_key_set = {(_normalize_title_for_key(d.get('title')), str(d.get('year') or '').strip()) for d in detected_list}
        for i, full_item in enumerate(items_full):
            if not isinstance(full_item, dict):
                continue
            t = (full_item.get('title') or '').strip()
            y = str(full_item.get('year') or '').strip()
            norm_key = (_normalize_title_for_key(t), y)
            if norm_key in detected_key_set and (full_item.get('status') or '').lower() != 'available':
                items_full[i]['status'] = 'available'
                collection_updated = True
        if collection_updated:
            _save_collection_config(items_full)
        # 4) Search, sort, paginate
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
    """Update collection item status. Body: { status } e.g. 'requested' or 'available'."""
    try:
        data = request.get_json() or {}
        status = (data.get('status') or '').strip() or None
        if not status:
            return jsonify({'success': False, 'message': 'status is required'}), 400
        items = _get_collection_config()
        if index < 0 or index >= len(items):
            return jsonify({'success': False, 'message': 'Not found'}), 404
        items[index]['status'] = status
        _save_collection_config(items)
        return jsonify({'success': True, 'item': items[index]}), 200
    except Exception as e:
        logger.exception('Movie Hunt collection patch error')
        return jsonify({'success': False, 'message': str(e)}), 500


@movie_hunt_bp.route('/api/movie-hunt/collection/<int:index>', methods=['DELETE'])
def api_movie_hunt_collection_delete(index):
    """Remove item from requested list by index (legacy) or by title+year in JSON body."""
    try:
        body = request.get_json(silent=True) or {}
        title = (body.get('title') or '').strip()
        year = str(body.get('year') or '').strip()
        if title:
            # Remove by title+year (for dynamic collection list where index != config index)
            items = _get_collection_config()
            for i, it in enumerate(items):
                if not isinstance(it, dict):
                    continue
                if (it.get('title') or '').strip() == title and str(it.get('year') or '') == year:
                    items.pop(i)
                    _save_collection_config(items)
                    return jsonify({'success': True}), 200
            return jsonify({'success': False, 'message': 'Not found in requested list'}), 404
        items = _get_collection_config()
        if index < 0 or index >= len(items):
            return jsonify({'success': False, 'message': 'Not found'}), 404
        items.pop(index)
        _save_collection_config(items)
        return jsonify({'success': True}), 200
    except Exception as e:
        logger.exception('Movie Hunt collection delete error')
        return jsonify({'success': False, 'message': str(e)}), 500

