"""TV Hunt quality profile management routes (shares patterns with Movie Hunt)."""

import re
import json
from flask import request, jsonify

from . import tv_hunt_bp
from .custom_formats import _get_custom_formats_config
from ...utils.logger import logger


def _get_profiles_config(instance_id):
    """Get quality profiles for a TV Hunt instance."""
    from src.primary.utils.database import get_database
    db = get_database()
    config = db.get_app_config_for_instance('tv_hunt_profiles', instance_id)
    if config and isinstance(config.get('profiles'), list):
        return config['profiles']
    return []


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
    """List quality profiles for the current TV Hunt instance."""
    try:
        from ._helpers import _get_tv_hunt_instance_id_from_request
        instance_id = _get_tv_hunt_instance_id_from_request()
        if not instance_id:
            return jsonify({'profiles': []}), 200
        profiles = _get_profiles_config(instance_id)
        return jsonify({'profiles': profiles}), 200
    except Exception as e:
        logger.exception('TV Hunt profiles list error')
        return jsonify({'profiles': [], 'error': str(e)}), 200


@tv_hunt_bp.route('/api/tv-hunt/profiles', methods=['POST'])
def api_tv_hunt_profiles_add():
    """Add a quality profile."""
    try:
        from ._helpers import _get_tv_hunt_instance_id_from_request
        instance_id = _get_tv_hunt_instance_id_from_request()
        if not instance_id:
            return jsonify({'error': 'No instance selected'}), 400
        data = request.get_json() or {}
        from src.primary.utils.database import get_database
        db = get_database()
        config = db.get_app_config_for_instance('tv_hunt_profiles', instance_id)
        if not config or not isinstance(config.get('profiles'), list):
            config = {'profiles': []}
        
        import uuid
        new_profile = {
            'id': str(uuid.uuid4())[:8],
            'name': (data.get('name') or 'Default').strip(),
            'qualities': data.get('qualities') or [],
            'cutoff': data.get('cutoff') or '',
        }
        config['profiles'].append(new_profile)
        db.save_app_config_for_instance('tv_hunt_profiles', instance_id, config)
        return jsonify({'profile': new_profile}), 201
    except Exception as e:
        logger.exception('TV Hunt profile add error')
        return jsonify({'error': str(e)}), 500


@tv_hunt_bp.route('/api/tv-hunt/profiles/<profile_id>', methods=['PATCH'])
def api_tv_hunt_profiles_update(profile_id):
    """Update a quality profile."""
    try:
        from ._helpers import _get_tv_hunt_instance_id_from_request
        instance_id = _get_tv_hunt_instance_id_from_request()
        if not instance_id:
            return jsonify({'error': 'No instance selected'}), 400
        data = request.get_json(silent=True) or {}
        from src.primary.utils.database import get_database
        db = get_database()
        config = db.get_app_config_for_instance('tv_hunt_profiles', instance_id)
        if not config or not isinstance(config.get('profiles'), list):
            return jsonify({'error': 'Profile not found'}), 404

        found = False
        for p in config['profiles']:
            if p.get('id') == profile_id:
                p.update(data)
                found = True
                break
        if not found:
            return jsonify({'error': 'Profile not found'}), 404

        db.save_app_config_for_instance('tv_hunt_profiles', instance_id, config)
        return jsonify({'success': True}), 200
    except Exception as e:
        logger.exception('TV Hunt profile update error')
        return jsonify({'error': str(e)}), 500


@tv_hunt_bp.route('/api/tv-hunt/profiles/<profile_id>', methods=['DELETE'])
def api_tv_hunt_profiles_delete(profile_id):
    """Delete a quality profile."""
    try:
        from ._helpers import _get_tv_hunt_instance_id_from_request
        instance_id = _get_tv_hunt_instance_id_from_request()
        if not instance_id:
            return jsonify({'error': 'No instance selected'}), 400
        from src.primary.utils.database import get_database
        db = get_database()
        config = db.get_app_config_for_instance('tv_hunt_profiles', instance_id)
        if not config or not isinstance(config.get('profiles'), list):
            return jsonify({'error': 'Profile not found'}), 404
        
        config['profiles'] = [p for p in config['profiles'] if p.get('id') != profile_id]
        db.save_app_config_for_instance('tv_hunt_profiles', instance_id, config)
        return jsonify({'success': True}), 200
    except Exception as e:
        logger.exception('TV Hunt profile delete error')
        return jsonify({'error': str(e)}), 500
