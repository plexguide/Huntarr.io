"""TV Hunt quality profile management routes (same profile setup as Movie Hunt, independent)."""

import re
import json
import copy
import uuid
from flask import request, jsonify

from . import tv_hunt_bp
from .custom_formats import _get_custom_formats_config
from ...utils.logger import logger

# Same default qualities as Movie Hunt so profile structure is identical
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
    """Return full default profile dict (same structure as Movie Hunt)."""
    return {
        'id': str(uuid.uuid4())[:8],
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
    """Ensure profile has all keys; qualities list of {id, name, enabled, order}."""
    defaults = _profile_defaults()
    out = dict(defaults)
    out['id'] = (p or {}).get('id') or out.get('id', str(uuid.uuid4())[:8])
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


def _unique_profile_name(base_name, profiles):
    """Return a unique name for a new profile."""
    names = {str(p.get('name', '')).strip().lower() for p in (profiles or [])}
    name = (base_name or 'Unnamed').strip() or 'Unnamed'
    if name.lower() not in names:
        return name
    for i in range(1, 999):
        candidate = name + ' (' + str(i) + ')'
        if candidate.lower() not in names:
            return candidate
    return name + ' (Copy)'


def _save_profiles_config(profiles_list, instance_id):
    """Save TV Hunt profiles to database."""
    from src.primary.utils.database import get_database
    db = get_database()
    db.save_app_config_for_instance('tv_hunt_profiles', instance_id, {'profiles': profiles_list})


def _get_profiles_config(instance_id):
    """Get TV Hunt profiles; ensure at least one default exists (same as Movie Hunt)."""
    from src.primary.utils.database import get_database
    db = get_database()
    config = db.get_app_config_for_instance('tv_hunt_profiles', instance_id)
    if not config or not isinstance(config.get('profiles'), list):
        profiles = []
    else:
        profiles = list(config['profiles'])
    if not profiles:
        first = _profile_defaults()
        first['name'] = PROFILES_DEFAULT_NAME
        first['is_default'] = True
        profiles = [first]
        db.save_app_config_for_instance('tv_hunt_profiles', instance_id, {'profiles': profiles})
    return profiles


def _get_profile_by_name_or_default(profile_name, instance_id):
    """Get a named profile, or the first profile, or None."""
    profiles = _get_profiles_config(instance_id)
    if not profiles:
        return None
    if profile_name:
        for p in profiles:
            if p.get('name', '').lower() == profile_name.lower():
                return p
    return profiles[0] if profiles else None


def _score_release(release_title, profile, instance_id):
    """
    Score a release using custom format scores stored by the user.
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


def _best_result_matching_profile(results, profile, instance_id=None):
    """Score results against a quality profile with custom format scoring and return the best match."""
    if not results:
        return None
    if not profile:
        return results[0]
    
    qualities = profile.get('qualities') or []
    quality_order = {}
    for i, q in enumerate(qualities):
        if isinstance(q, dict) and q.get('enabled', True):
            name = (q.get('name') or '').lower()
            quality_order[name] = i
    
    def score_result(r):
        title = (r.get('title') or '').lower()
        best_quality_idx = len(qualities)
        for qname, idx in quality_order.items():
            if qname in title:
                best_quality_idx = min(best_quality_idx, idx)
        # Apply custom format scoring if instance_id is available
        cf_score = 0
        if instance_id:
            cf_score, _ = _score_release(r.get('title') or '', profile, instance_id)
        priority = r.get('indexer_priority', 50)
        # Sort: best quality first, then highest CF score, then priority
        return (best_quality_idx, -cf_score, priority)
    
    results_sorted = sorted(results, key=score_result)
    return results_sorted[0]


@tv_hunt_bp.route('/api/tv-hunt/profiles', methods=['GET'])
def api_tv_hunt_profiles_list():
    """List quality profiles for the current TV Hunt instance (same shape as Movie Hunt)."""
    try:
        from ._helpers import _get_tv_hunt_instance_id_from_request
        instance_id = _get_tv_hunt_instance_id_from_request()
        if not instance_id:
            return jsonify({'profiles': []}), 200
        profiles = _get_profiles_config(instance_id)
        out = []
        for i, p in enumerate(profiles):
            normalized = _normalize_profile(p)
            normalized['index'] = i
            out.append(normalized)
        return jsonify({'profiles': out}), 200
    except Exception as e:
        logger.exception('TV Hunt profiles list error')
        return jsonify({'profiles': [], 'error': str(e)}), 200


@tv_hunt_bp.route('/api/tv-hunt/profiles', methods=['POST'])
def api_tv_hunt_profiles_add():
    """Add a profile (same as Movie Hunt: body { name })."""
    try:
        from ._helpers import _get_tv_hunt_instance_id_from_request
        instance_id = _get_tv_hunt_instance_id_from_request()
        if not instance_id:
            return jsonify({'error': 'No instance selected'}), 400
        data = request.get_json() or {}
        base_name = (data.get('name') or '').strip() or 'Unnamed'
        profiles = _get_profiles_config(instance_id)
        name = _unique_profile_name(base_name, profiles)
        new_profile = _profile_defaults()
        new_profile['name'] = name
        new_profile['is_default'] = False
        profiles.append(new_profile)
        _save_profiles_config(profiles, instance_id)
        return jsonify({'success': True, 'profile': new_profile, 'name': name}), 201
    except Exception as e:
        logger.exception('TV Hunt profile add error')
        return jsonify({'error': str(e)}), 500


@tv_hunt_bp.route('/api/tv-hunt/profiles/<profile_id>', methods=['PATCH'])
def api_tv_hunt_profiles_update(profile_id):
    """Update a profile (same fields as Movie Hunt, including is_default)."""
    try:
        from ._helpers import _get_tv_hunt_instance_id_from_request
        instance_id = _get_tv_hunt_instance_id_from_request()
        if not instance_id:
            return jsonify({'error': 'No instance selected'}), 400
        data = request.get_json(silent=True) or {}
        profiles = _get_profiles_config(instance_id)
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

        _save_profiles_config(profiles, instance_id)
        return jsonify({'success': True}), 200
    except Exception as e:
        logger.exception('TV Hunt profile update error')
        return jsonify({'error': str(e)}), 500


@tv_hunt_bp.route('/api/tv-hunt/profiles/<profile_id>/clone', methods=['POST'])
def api_tv_hunt_profiles_clone(profile_id):
    """Duplicate a profile (same as Movie Hunt clone)."""
    try:
        from ._helpers import _get_tv_hunt_instance_id_from_request
        instance_id = _get_tv_hunt_instance_id_from_request()
        if not instance_id:
            return jsonify({'error': 'No instance selected'}), 400
        profiles = _get_profiles_config(instance_id)
        source = next((p for p in profiles if p.get('id') == profile_id), None)
        if not source:
            return jsonify({'success': False, 'error': 'Profile not found'}), 404
        new_profile = copy.deepcopy(source)
        new_profile['id'] = str(uuid.uuid4())[:8]
        new_profile['name'] = ((source.get('name') or '').strip() or 'Unnamed') + ' (Copy)'
        new_profile['is_default'] = False
        profiles.append(new_profile)
        _save_profiles_config(profiles, instance_id)
        return jsonify({'success': True, 'profile': new_profile}), 200
    except Exception as e:
        logger.exception('TV Hunt profile clone error')
        return jsonify({'error': str(e)}), 500


@tv_hunt_bp.route('/api/tv-hunt/profiles/<profile_id>', methods=['DELETE'])
def api_tv_hunt_profiles_delete(profile_id):
    """Delete a profile; if it was default, set first to default."""
    try:
        from ._helpers import _get_tv_hunt_instance_id_from_request
        instance_id = _get_tv_hunt_instance_id_from_request()
        if not instance_id:
            return jsonify({'error': 'No instance selected'}), 400
        profiles = _get_profiles_config(instance_id)
        idx = next((i for i, p in enumerate(profiles) if p.get('id') == profile_id), None)
        if idx is None:
            return jsonify({'error': 'Profile not found'}), 404
        was_default = profiles[idx].get('is_default')
        profiles.pop(idx)
        if was_default and profiles:
            profiles[0]['is_default'] = True
        _save_profiles_config(profiles, instance_id)
        return jsonify({'success': True}), 200
    except Exception as e:
        logger.exception('TV Hunt profile delete error')
        return jsonify({'error': str(e)}), 500
