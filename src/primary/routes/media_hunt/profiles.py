"""
Media Hunt – consolidated quality profiles for Movie Hunt and TV Hunt.
Single module; behavior is determined by a context dict (profiles_config_key, sizes_config_key, use_profile_id, get_custom_formats).
Routes are registered on movie_hunt_bp and tv_hunt_bp via register_*_profiles_routes().
"""

import re
import json
import copy
import string
import secrets
import uuid

from flask import request, jsonify

from ...utils.database import get_database
from ...utils.logger import logger

from .sizes import get_sizes as _get_sizes_config


# --- Shared defaults ---

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


def _profile_defaults(use_profile_id=False):
    """Return full default profile dict."""
    out = {
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
    if use_profile_id:
        out['id'] = str(uuid.uuid4())[:8]
    return out


def _normalize_profile(p, use_profile_id=False):
    """Ensure profile has all keys; qualities list of {id, name, enabled, order}."""
    defaults = _profile_defaults(use_profile_id)
    out = dict(defaults)
    if use_profile_id and p and p.get('id'):
        out['id'] = str(p.get('id', ''))[:8]
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


def _unique_profile_name(base_name, existing_profiles, strategy='random'):
    """Return a unique name. strategy 'random' = suffix -xxxx (movie), 'numbered' = name (1), name (2) (tv)."""
    if strategy == 'numbered':
        names = {str(p.get('name', '')).strip().lower() for p in (existing_profiles or [])}
        name = (base_name or 'Unnamed').strip() or 'Unnamed'
        if name.lower() not in names:
            return name
        for i in range(1, 999):
            candidate = name + ' (' + str(i) + ')'
            if candidate.lower() not in names:
                return candidate
        return name + ' (Copy)'
    existing_names = {(p.get('name') or '').strip() for p in (existing_profiles or [])}
    base = (base_name or 'Unnamed').strip() or 'Unnamed'
    if base not in existing_names:
        return base
    alphabet = string.ascii_lowercase + string.digits
    name = base
    while name in existing_names:
        suffix = ''.join(secrets.choice(alphabet) for _ in range(4))
        name = base + '-' + suffix
    return name


# --- Config (context: profiles_config_key, sizes_config_key, use_profile_id, get_custom_formats) ---

def get_profiles_config(instance_id, context):
    """Get profiles list from database; ensure at least one default exists."""
    config_key = context['profiles_config_key']
    use_profile_id = context.get('use_profile_id', False)
    db = get_database()
    config = db.get_app_config_for_instance(config_key, instance_id)
    if not config or not isinstance(config.get('profiles'), list):
        profiles = []
    else:
        profiles = list(config['profiles'])
    if not profiles:
        first = _profile_defaults(use_profile_id)
        first['name'] = PROFILES_DEFAULT_NAME
        first['is_default'] = True
        profiles = [first]
        db.save_app_config_for_instance(config_key, instance_id, {'profiles': profiles})
    return profiles


def save_profiles_config(profiles_list, instance_id, context):
    """Save profiles to database."""
    config_key = context['profiles_config_key']
    get_database().save_app_config_for_instance(config_key, instance_id, {'profiles': profiles_list})


def get_profile_by_name_or_default(profile_name, instance_id, context):
    """Resolve name to normalized profile, or default. Returns normalized profile dict."""
    profiles = get_profiles_config(instance_id, context)
    use_profile_id = context.get('use_profile_id', False)
    if not profile_name or not (profile_name or '').strip():
        for p in profiles:
            if p.get('is_default'):
                return _normalize_profile(p, use_profile_id)
        return _normalize_profile(profiles[0], use_profile_id) if profiles else _profile_defaults(use_profile_id)
    want = (profile_name or '').strip()
    want_base = want.replace(' (Default)', '').replace('(Default)', '').strip()
    for p in profiles:
        name = (p.get('name') or '').strip()
        if name == want or name == want_base:
            return _normalize_profile(p, use_profile_id)
        if name.replace(' (Default)', '').strip() == want_base:
            return _normalize_profile(p, use_profile_id)
    for p in profiles:
        if p.get('is_default'):
            return _normalize_profile(p, use_profile_id)
    return _normalize_profile(profiles[0], use_profile_id) if profiles else _profile_defaults(use_profile_id)


# --- Size limits (from Sizes config) ---

def get_size_limits_for_quality(quality_name, instance_id, context):
    """Return (min, preferred, max) MB/min for the given quality from Sizes config."""
    sizes_config_key = context['sizes_config_key']
    sizes_instance_id = None if sizes_config_key == 'movie_hunt_sizes' else instance_id
    try:
        sizes = _get_sizes_config(sizes_instance_id, sizes_config_key)
    except Exception:
        return 0, 0, 400
    q = (quality_name or '').strip()
    for s in (sizes or []):
        if (s.get('name') or '').strip() == q:
            return (
                max(0, int(s.get('min', 0))),
                max(0, int(s.get('preferred', 0))),
                max(1, int(s.get('max', 400))),
            )
    return 0, 0, 400


def size_mb_per_min(size_bytes, runtime_minutes):
    """Convert size in bytes and runtime in minutes to MB per minute. Returns None if invalid."""
    if not size_bytes or size_bytes <= 0 or not runtime_minutes or runtime_minutes <= 0:
        return None
    return (float(size_bytes) / (1024.0 * 1024.0)) / float(runtime_minutes)


def size_filter_and_preference(result, quality_name, runtime_minutes, instance_id, context):
    """Check result size against Sizes config. Returns (passes_filter, preference_score)."""
    size_bytes = result.get('size_bytes') or result.get('size') or 0
    mb_per_min = size_mb_per_min(size_bytes, runtime_minutes) if size_bytes else None
    min_s, pref_s, max_s = get_size_limits_for_quality(quality_name, instance_id, context)
    if mb_per_min is None:
        return True, 50
    if mb_per_min < min_s or mb_per_min > max_s:
        return False, None
    if max_s <= min_s:
        return True, 100
    dist = abs(mb_per_min - pref_s)
    range_len = max_s - min_s
    pref_score = max(0, min(100, 100 - (dist / range_len) * 100))
    return True, pref_score


# --- Release matching ---

def release_matches_quality(release_title, quality_name):
    """Return True if release_title appears to match the quality."""
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


def score_release(release_title, profile, instance_id, context):
    """Score a release using custom format scores. Returns (total_score, breakdown_str)."""
    if not release_title or not (release_title or '').strip():
        return 0, '-'
    get_custom_formats = context.get('get_custom_formats')
    if not get_custom_formats:
        return 0, '-'
    parts = []
    total = 0
    try:
        custom_formats = get_custom_formats(instance_id)
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


def best_result_matching_profile(results, profile, instance_id, context, runtime_minutes=90, return_breakdown=False):
    """
    From Newznab results, return the best result matching the profile (size + custom format score).
    If return_breakdown=True (movie): returns (result, score, breakdown_str).
    If return_breakdown=False (tv): returns result only.
    """
    if not results:
        return (None, 0, '') if return_breakdown else None
    runtime = max(1, int(runtime_minutes)) if runtime_minutes is not None else 90
    enabled_names = [q.get('name') or '' for q in (profile.get('qualities') or []) if q.get('enabled')]
    if not enabled_names:
        scored = []
        for r in results:
            title = (r.get('title') or '').strip()
            sc, br = score_release(title, profile, instance_id, context)
            passes, pref = size_filter_and_preference(r, '', runtime, instance_id, context)
            if not passes:
                continue
            scored.append((sc, pref or 50, br, r))
        if not scored:
            return (None, 0, '') if return_breakdown else None
        scored.sort(key=lambda x: (-x[0], -x[1], x[3].get('title') or ''))
        best = scored[0]
        if return_breakdown:
            return best[3], best[0], best[2]
        return best[3]
    candidates = []
    for r in results:
        title = (r.get('title') or '').strip()
        for qname in enabled_names:
            if release_matches_quality(title, qname):
                passes, pref = size_filter_and_preference(r, qname, runtime, instance_id, context)
                if not passes:
                    break
                sc, br = score_release(title, profile, instance_id, context)
                candidates.append((sc, pref or 50, br, r))
                break
    if not candidates:
        return (None, 0, '') if return_breakdown else None
    candidates.sort(key=lambda x: (-x[0], -x[1], x[3].get('title') or ''))
    best = candidates[0]
    if return_breakdown:
        return best[3], best[0], best[2]
    return best[3]


def first_result_matching_profile(results, profile):
    """From Newznab results, return the first result matching any enabled quality (no size check)."""
    if not results:
        return None
    enabled_names = [q.get('name') or '' for q in (profile.get('qualities') or []) if q.get('enabled')]
    if not enabled_names:
        return results[0]
    for r in results:
        title = (r.get('title') or '').strip()
        for qname in enabled_names:
            if release_matches_quality(title, qname):
                return r
    return None


# ---- Route registration ----

def register_movie_profiles_routes(bp, get_instance_id):
    """Register /api/profiles GET, POST, PATCH, DELETE, clone on movie_hunt_bp. Uses index (int)."""
    context = {'profiles_config_key': 'movie_hunt_profiles', 'sizes_config_key': 'movie_hunt_sizes', 'use_profile_id': False, 'get_custom_formats': None}

    def _ctx():
        from ..media_hunt.custom_formats import get_movie_custom_formats_config
        c = dict(context)
        c['get_custom_formats'] = get_movie_custom_formats_config
        return c

    @bp.route('/api/profiles', methods=['GET'])
    def api_profiles_list():
        try:
            instance_id = get_instance_id()
            ctx = _ctx()
            profiles = get_profiles_config(instance_id, ctx)
            out = []
            for i, p in enumerate(profiles):
                normalized = _normalize_profile(p, False)
                normalized['index'] = i
                out.append(normalized)
            return jsonify({'profiles': out}), 200
        except Exception as e:
            logger.exception('Profiles list error')
            return jsonify({'profiles': [], 'error': str(e)}), 200

    @bp.route('/api/profiles', methods=['POST'])
    def api_profiles_add():
        try:
            instance_id = get_instance_id()
            ctx = _ctx()
            data = request.get_json() or {}
            base_name = (data.get('name') or '').strip() or 'Unnamed'
            profiles = get_profiles_config(instance_id, ctx)
            name = _unique_profile_name(base_name, profiles, 'random')
            new_profile = _profile_defaults(False)
            new_profile['name'] = name
            new_profile['is_default'] = False
            profiles.append(new_profile)
            save_profiles_config(profiles, instance_id, ctx)
            return jsonify({'success': True, 'index': len(profiles) - 1, 'name': name}), 200
        except Exception as e:
            logger.exception('Profiles add error')
            return jsonify({'success': False, 'error': str(e)}), 500

    @bp.route('/api/profiles/<int:index>', methods=['PATCH'])
    def api_profiles_patch(index):
        try:
            instance_id = get_instance_id()
            ctx = _ctx()
            profiles = get_profiles_config(instance_id, ctx)
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
            save_profiles_config(profiles, instance_id, ctx)
            return jsonify({'success': True}), 200
        except Exception as e:
            logger.exception('Profiles patch error')
            return jsonify({'success': False, 'error': str(e)}), 500

    @bp.route('/api/profiles/<int:index>/clone', methods=['POST'])
    def api_profiles_clone(index):
        try:
            instance_id = get_instance_id()
            ctx = _ctx()
            profiles = get_profiles_config(instance_id, ctx)
            if index < 0 or index >= len(profiles):
                return jsonify({'success': False, 'error': 'Index out of range'}), 400
            source = profiles[index]
            new_profile = copy.deepcopy(source)
            new_profile['name'] = ((source.get('name') or '').strip() or 'Unnamed') + ' (Copy)'
            new_profile['is_default'] = False
            profiles.append(new_profile)
            save_profiles_config(profiles, instance_id, ctx)
            return jsonify({'success': True, 'index': len(profiles) - 1}), 200
        except Exception as e:
            logger.exception('Profiles clone error')
            return jsonify({'success': False, 'error': str(e)}), 500

    @bp.route('/api/profiles/<int:index>', methods=['DELETE'])
    def api_profiles_delete(index):
        try:
            instance_id = get_instance_id()
            ctx = _ctx()
            profiles = get_profiles_config(instance_id, ctx)
            if index < 0 or index >= len(profiles):
                return jsonify({'success': False, 'error': 'Index out of range'}), 400
            was_default = profiles[index].get('is_default')
            profiles.pop(index)
            if was_default and profiles:
                profiles[0]['is_default'] = True
            save_profiles_config(profiles, instance_id, ctx)
            return jsonify({'success': True}), 200
        except Exception as e:
            logger.exception('Profiles delete error')
            return jsonify({'success': False, 'error': str(e)}), 500


def register_tv_profiles_routes(bp, get_instance_id):
    """Register /api/tv-hunt/profiles GET, POST, PATCH, DELETE, clone on tv_hunt_bp. Uses profile_id (string)."""
    context = {'profiles_config_key': 'tv_hunt_profiles', 'sizes_config_key': 'tv_hunt_sizes', 'use_profile_id': True, 'get_custom_formats': None}

    def _ctx():
        from ..media_hunt.custom_formats import get_tv_custom_formats_config
        c = dict(context)
        c['get_custom_formats'] = get_tv_custom_formats_config
        return c

    @bp.route('/api/tv-hunt/profiles', methods=['GET'])
    def api_tv_hunt_profiles_list():
        try:
            instance_id = get_instance_id()
            if not instance_id:
                return jsonify({'profiles': []}), 200
            ctx = _ctx()
            profiles = get_profiles_config(instance_id, ctx)
            out = []
            for i, p in enumerate(profiles):
                normalized = _normalize_profile(p, True)
                normalized['index'] = i
                out.append(normalized)
            return jsonify({'profiles': out}), 200
        except Exception as e:
            logger.exception('TV Hunt profiles list error')
            return jsonify({'profiles': [], 'error': str(e)}), 200

    @bp.route('/api/tv-hunt/profiles', methods=['POST'])
    def api_tv_hunt_profiles_add():
        try:
            instance_id = get_instance_id()
            if not instance_id:
                return jsonify({'error': 'No instance selected'}), 400
            ctx = _ctx()
            data = request.get_json() or {}
            base_name = (data.get('name') or '').strip() or 'Unnamed'
            profiles = get_profiles_config(instance_id, ctx)
            name = _unique_profile_name(base_name, profiles, 'numbered')
            new_profile = _profile_defaults(True)
            new_profile['name'] = name
            new_profile['is_default'] = False
            profiles.append(new_profile)
            save_profiles_config(profiles, instance_id, ctx)
            return jsonify({'success': True, 'profile': new_profile, 'name': name}), 201
        except Exception as e:
            logger.exception('TV Hunt profile add error')
            return jsonify({'error': str(e)}), 500

    @bp.route('/api/tv-hunt/profiles/<profile_id>', methods=['PATCH'])
    def api_tv_hunt_profiles_update(profile_id):
        try:
            instance_id = get_instance_id()
            if not instance_id:
                return jsonify({'error': 'No instance selected'}), 400
            ctx = _ctx()
            data = request.get_json(silent=True) or {}
            profiles = get_profiles_config(instance_id, ctx)
            idx = next((i for i, p in enumerate(profiles) if p.get('id') == profile_id), None)
            if idx is None:
                return jsonify({'error': 'Profile not found'}), 404
            if data.get('is_default') is True:
                profile = profiles.pop(idx)
                for i in range(len(profiles)):
                    profiles[i]['is_default'] = False
                profile['is_default'] = True
                profiles.insert(0, profile)
                idx = 0
            name = (data.get('name') or '').strip()
            if name:
                profiles[idx]['name'] = name
            if 'upgrades_allowed' in data:
                profiles[idx]['upgrades_allowed'] = bool(data['upgrades_allowed'])
            if 'upgrade_until_quality' in data:
                profiles[idx]['upgrade_until_quality'] = str(data.get('upgrade_until_quality') or 'WEB 2160p').strip()
            if 'min_custom_format_score' in data:
                try:
                    profiles[idx]['min_custom_format_score'] = int(data['min_custom_format_score'])
                except (TypeError, ValueError):
                    pass
            if 'upgrade_until_custom_format_score' in data:
                try:
                    profiles[idx]['upgrade_until_custom_format_score'] = int(data['upgrade_until_custom_format_score'])
                except (TypeError, ValueError):
                    pass
            if 'upgrade_score_increment' in data:
                try:
                    profiles[idx]['upgrade_score_increment'] = int(data['upgrade_score_increment'])
                except (TypeError, ValueError):
                    pass
            if 'language' in data:
                profiles[idx]['language'] = str(data.get('language') or 'English').strip()
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
                profiles[idx]['qualities'] = qualities
            save_profiles_config(profiles, instance_id, ctx)
            return jsonify({'success': True}), 200
        except Exception as e:
            logger.exception('TV Hunt profile update error')
            return jsonify({'error': str(e)}), 500

    @bp.route('/api/tv-hunt/profiles/<profile_id>/clone', methods=['POST'])
    def api_tv_hunt_profiles_clone(profile_id):
        try:
            instance_id = get_instance_id()
            if not instance_id:
                return jsonify({'error': 'No instance selected'}), 400
            ctx = _ctx()
            profiles = get_profiles_config(instance_id, ctx)
            source = next((p for p in profiles if p.get('id') == profile_id), None)
            if not source:
                return jsonify({'success': False, 'error': 'Profile not found'}), 404
            new_profile = copy.deepcopy(source)
            new_profile['id'] = str(uuid.uuid4())[:8]
            new_profile['name'] = ((source.get('name') or '').strip() or 'Unnamed') + ' (Copy)'
            new_profile['is_default'] = False
            profiles.append(new_profile)
            save_profiles_config(profiles, instance_id, ctx)
            return jsonify({'success': True, 'profile': new_profile}), 200
        except Exception as e:
            logger.exception('TV Hunt profile clone error')
            return jsonify({'error': str(e)}), 500

    @bp.route('/api/tv-hunt/profiles/<profile_id>', methods=['DELETE'])
    def api_tv_hunt_profiles_delete(profile_id):
        try:
            instance_id = get_instance_id()
            if not instance_id:
                return jsonify({'error': 'No instance selected'}), 400
            ctx = _ctx()
            profiles = get_profiles_config(instance_id, ctx)
            idx = next((i for i, p in enumerate(profiles) if p.get('id') == profile_id), None)
            if idx is None:
                return jsonify({'error': 'Profile not found'}), 404
            was_default = profiles[idx].get('is_default')
            profiles.pop(idx)
            if was_default and profiles:
                profiles[0]['is_default'] = True
            save_profiles_config(profiles, instance_id, ctx)
            return jsonify({'success': True}), 200
        except Exception as e:
            logger.exception('TV Hunt profile delete error')
            return jsonify({'error': str(e)}), 500
