"""Movie Hunt profile routes and scoring/matching helpers."""

import re
import json
import copy
import string
import secrets

from flask import request, jsonify

from . import movie_hunt_bp
from ._helpers import _get_movie_hunt_instance_id_from_request
from .custom_formats import _get_custom_formats_config
from ...utils.logger import logger


# --- Profile defaults ---

PROFILES_DEFAULT_NAME = 'Standard'

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


def _get_profiles_config(instance_id):
    """Get Movie Hunt profiles list from database. Ensures at least default 'Standard' exists."""
    from src.primary.utils.database import get_database
    db = get_database()
    config = db.get_app_config_for_instance('movie_hunt_profiles', instance_id)
    if not config or not isinstance(config.get('profiles'), list):
        profiles = []
    else:
        profiles = list(config['profiles'])
    if not profiles:
        first = _profile_defaults()
        first['name'] = PROFILES_DEFAULT_NAME
        first['is_default'] = True
        profiles = [first]
        db.save_app_config_for_instance('movie_hunt_profiles', instance_id, {'profiles': profiles})
    return profiles


def _save_profiles_config(profiles_list, instance_id):
    """Save Movie Hunt profiles to database."""
    from src.primary.utils.database import get_database
    db = get_database()
    db.save_app_config_for_instance('movie_hunt_profiles', instance_id, {'profiles': profiles_list})


def _get_profile_by_name_or_default(quality_profile_name, instance_id):
    """Resolve quality_profile to the actual profile from config. Returns normalized profile dict."""
    profiles = _get_profiles_config(instance_id)
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


# --- Release matching and scoring ---

def _release_matches_quality(release_title, quality_name):
    """Return True if release_title appears to match the quality (e.g. 'WEB 1080p', 'Bluray-2160p')."""
    if not release_title or not quality_name:
        return False
    t = (release_title or '').lower()
    q = (quality_name or '').lower().replace('-', ' ')
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


def _score_release(release_title, profile, instance_id):
    """
    Score a release using only custom format scores stored by the user.
    Returns (total_score, breakdown_str).
    """
    if not release_title or not (release_title or '').strip():
        return 0, '-'
    parts = []
    total = 0
    try:
        custom_formats = _get_custom_formats_config(instance_id)
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

            specifications = obj.get('specifications') or []
            if not isinstance(specifications, list):
                continue

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

                if 'resolution' in implementation.lower():
                    resolution_value = fields.get('value') if isinstance(fields, dict) else None
                    if resolution_value is not None:
                        has_any_spec = True
                        try:
                            res_int = int(resolution_value)
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
                        if found:
                            all_negative_pass = False
                            break
                    else:
                        if found:
                            has_positive_match = True
                except re.error:
                    continue

            if has_any_spec and has_positive_match and all_negative_pass:
                total += score_val
                if score_val >= 0:
                    parts.append('%s +%d' % (name, score_val))
                else:
                    parts.append('%s %d' % (name, score_val))
    except Exception:
        pass
    if not parts:
        return 0, '-'
    return total, ', '.join(parts)


def _best_result_matching_profile(results, profile, instance_id):
    """
    From Newznab results list, return the best result that matches the profile.
    Returns (result, score, breakdown_str).
    """
    if not results:
        return None, 0, ''
    enabled_names = [q.get('name') or '' for q in (profile.get('qualities') or []) if q.get('enabled')]
    if not enabled_names:
        scored = []
        for r in results:
            title = (r.get('title') or '').strip()
            sc, br = _score_release(title, profile, instance_id)
            scored.append((sc, br, r))
        scored.sort(key=lambda x: (-x[0], x[2].get('title') or ''))
        best = scored[0]
        return best[2], best[0], best[1]
    candidates = []
    for r in results:
        title = (r.get('title') or '').strip()
        for qname in enabled_names:
            if _release_matches_quality(title, qname):
                sc, br = _score_release(title, profile, instance_id)
                candidates.append((sc, br, r))
                break
    if not candidates:
        return None, 0, ''
    candidates.sort(key=lambda x: (-x[0], x[2].get('title') or ''))
    best = candidates[0]
    return best[2], best[0], best[1]


def _first_result_matching_profile(results, profile):
    """From Newznab results list, return the first result matching any enabled quality."""
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


# --- Routes ---

@movie_hunt_bp.route('/api/profiles', methods=['GET'])
def api_profiles_list():
    """List Movie Hunt profiles."""
    try:
        instance_id = _get_movie_hunt_instance_id_from_request()
        profiles = _get_profiles_config(instance_id)
        out = []
        for i, p in enumerate(profiles):
            normalized = _normalize_profile(p)
            normalized['index'] = i
            out.append(normalized)
        return jsonify({'profiles': out}), 200
    except Exception as e:
        logger.exception('Profiles list error')
        return jsonify({'profiles': [], 'error': str(e)}), 200


@movie_hunt_bp.route('/api/profiles', methods=['POST'])
def api_profiles_add():
    """Add a profile. Body: { name }."""
    try:
        instance_id = _get_movie_hunt_instance_id_from_request()
        data = request.get_json() or {}
        base_name = (data.get('name') or '').strip() or 'Unnamed'
        profiles = _get_profiles_config(instance_id)
        name = _unique_profile_name(base_name, profiles)
        new_profile = _profile_defaults()
        new_profile['name'] = name
        new_profile['is_default'] = False
        profiles.append(new_profile)
        _save_profiles_config(profiles, instance_id)
        return jsonify({'success': True, 'index': len(profiles) - 1, 'name': name}), 200
    except Exception as e:
        logger.exception('Profiles add error')
        return jsonify({'success': False, 'error': str(e)}), 500


@movie_hunt_bp.route('/api/profiles/<int:index>', methods=['PATCH'])
def api_profiles_patch(index):
    """Update profile."""
    try:
        instance_id = _get_movie_hunt_instance_id_from_request()
        profiles = _get_profiles_config(instance_id)
        if index < 0 or index >= len(profiles):
            return jsonify({'success': False, 'error': 'Index out of range'}), 400
        data = request.get_json() or {}
        if data.get('is_default') is True:
            profile = profiles.pop(index)
            for i in range(len(profiles)):
                profiles[i]['is_default'] = False
            profile['is_default'] = True
            profiles.insert(0, profile)
            index = 0
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
        _save_profiles_config(profiles, instance_id)
        return jsonify({'success': True}), 200
    except Exception as e:
        logger.exception('Profiles patch error')
        return jsonify({'success': False, 'error': str(e)}), 500


@movie_hunt_bp.route('/api/profiles/<int:index>/clone', methods=['POST'])
def api_profiles_clone(index):
    """Duplicate profile at index."""
    try:
        instance_id = _get_movie_hunt_instance_id_from_request()
        profiles = _get_profiles_config(instance_id)
        if index < 0 or index >= len(profiles):
            return jsonify({'success': False, 'error': 'Index out of range'}), 400
        source = profiles[index]
        new_profile = copy.deepcopy(source)
        new_profile['name'] = ((source.get('name') or '').strip() or 'Unnamed') + ' (Copy)'
        new_profile['is_default'] = False
        profiles.append(new_profile)
        _save_profiles_config(profiles, instance_id)
        return jsonify({'success': True, 'index': len(profiles) - 1}), 200
    except Exception as e:
        logger.exception('Profiles clone error')
        return jsonify({'success': False, 'error': str(e)}), 500


@movie_hunt_bp.route('/api/profiles/<int:index>', methods=['DELETE'])
def api_profiles_delete(index):
    """Delete profile."""
    try:
        instance_id = _get_movie_hunt_instance_id_from_request()
        profiles = _get_profiles_config(instance_id)
        if index < 0 or index >= len(profiles):
            return jsonify({'success': False, 'error': 'Index out of range'}), 400
        was_default = profiles[index].get('is_default')
        profiles.pop(index)
        if was_default and profiles:
            profiles[0]['is_default'] = True
            _save_profiles_config(profiles, instance_id)
        else:
            _save_profiles_config(profiles, instance_id)
        return jsonify({'success': True}), 200
    except Exception as e:
        logger.exception('Profiles delete error')
        return jsonify({'success': False, 'error': str(e)}), 500
