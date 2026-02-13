"""
Media Hunt – consolidated custom format routes for Movie Hunt and TV Hunt.
Uses trash_custom_formats (Radarr) for Movie, trash_custom_formats_sonarr for TV.
Routes are registered on movie_hunt_bp and tv_hunt_bp via register_*_custom_formats_routes().
"""

import json

from flask import request, jsonify

from ...utils.logger import logger


def _custom_format_name_from_json(obj):
    """Extract display name from custom format JSON (top-level 'name' field)."""
    if isinstance(obj, dict) and obj.get('name') is not None:
        return str(obj.get('name', '')).strip() or 'Unnamed'
    return 'Unnamed'


def _recommended_score_from_json(custom_format_json):
    """Extract recommended score from TRaSH custom format JSON (trash_scores.default)."""
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


def _get_custom_formats_config(instance_id, config_key):
    """Return custom formats list for the given instance and config key."""
    from src.primary.utils.database import get_database
    db = get_database()
    config = db.get_app_config_for_instance(config_key, instance_id)
    if not config or not isinstance(config.get('custom_formats'), list):
        return []
    return list(config['custom_formats'])


def get_movie_custom_formats_config(instance_id):
    """Return movie custom formats list for profiles. Used by media_hunt.profiles."""
    return _get_custom_formats_config(instance_id, 'movie_hunt_custom_formats')


def get_tv_custom_formats_config(instance_id):
    """Return TV custom formats list for profiles. Used by media_hunt.profiles."""
    return _get_custom_formats_config(instance_id, 'tv_hunt_custom_formats')


def _register_custom_formats_routes(bp, get_instance_id, config_key, trash_module, route_prefix):
    """
    Register custom format routes on blueprint.
    config_key: 'movie_hunt_custom_formats' or 'tv_hunt_custom_formats'
    trash_module: trash_custom_formats (Radarr) or trash_custom_formats_sonarr
    route_prefix: '' for Movie (/api/custom-formats) or '/tv-hunt' for TV (/api/tv-hunt/custom-formats)
    """
    from src.primary.utils.database import get_database

    def _get_config(instance_id):
        return _get_custom_formats_config(instance_id, config_key)

    def _save_config(formats_list, instance_id):
        db = get_database()
        db.save_app_config_for_instance(config_key, instance_id, {'custom_formats': formats_list})

    prefix = '/api/' + (route_prefix.strip('/') + '/' if route_prefix else '') + 'custom-formats'

    @bp.route(prefix, methods=['GET'])
    def api_custom_formats_list():
        try:
            instance_id = get_instance_id()
            formats = _get_config(instance_id)
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

    @bp.route(prefix + '/preformats', methods=['GET'])
    def api_custom_formats_preformats():
        try:
            categories = trash_module.get_trash_categories()
            all_ids = trash_module.get_all_preformat_ids()
            preformats = [{'id': pid, 'name': trash_module.get_trash_format_name(pid) or pid} for pid in all_ids]
            return jsonify({'categories': categories, 'preformats': preformats}), 200
        except Exception as e:
            logger.exception('Preformats list error')
            return jsonify({'categories': [], 'preformats': [], 'error': str(e)}), 200

    @bp.route(prefix, methods=['POST'])
    def api_custom_formats_add():
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
                preformat_id = ''
            else:
                preformat_id = (data.get('preformat_id') or '').strip()
                if not preformat_id:
                    return jsonify({'success': False, 'message': 'preformat_id is required for preformat'}), 400
                custom_format_json = trash_module.get_trash_format_json(preformat_id)
                name = trash_module.get_trash_format_name(preformat_id)
                if not custom_format_json or not name:
                    return jsonify({'success': False, 'message': 'Unknown preformat_id'}), 400
                if isinstance(custom_format_json, dict):
                    custom_format_json = json.dumps(custom_format_json)

            title = (data.get('title') or '').strip() or name
            instance_id = get_instance_id()
            formats = _get_config(instance_id)
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
            _save_config(formats, instance_id)
            return jsonify({'success': True, 'index': len(formats) - 1}), 200
        except Exception as e:
            logger.exception('Custom formats add error')
            return jsonify({'success': False, 'error': str(e)}), 500

    @bp.route(prefix + '/scores', methods=['PUT'])
    def api_custom_formats_scores_batch():
        try:
            data = request.get_json() or {}
            scores = data.get('scores')
            if not isinstance(scores, list):
                return jsonify({'success': False, 'message': 'scores array required'}), 400
            instance_id = get_instance_id()
            formats = _get_config(instance_id)
            if len(scores) != len(formats):
                return jsonify({'success': False, 'message': 'scores length must match custom formats count'}), 400
            for i in range(len(formats)):
                try:
                    val = int(scores[i])
                except (TypeError, ValueError, IndexError):
                    val = 0
                formats[i]['score'] = val
            _save_config(formats, instance_id)
            return jsonify({'success': True}), 200
        except Exception as e:
            logger.exception('Custom formats scores batch error')
            return jsonify({'success': False, 'error': str(e)}), 500

    @bp.route(prefix + '/<int:index>', methods=['PATCH'])
    def api_custom_formats_patch(index):
        try:
            instance_id = get_instance_id()
            formats = _get_config(instance_id)
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
            _save_config(formats, instance_id)
            return jsonify({'success': True}), 200
        except Exception as e:
            logger.exception('Custom formats patch error')
            return jsonify({'success': False, 'error': str(e)}), 500

    @bp.route(prefix + '/<int:index>', methods=['DELETE'])
    def api_custom_formats_delete(index):
        try:
            instance_id = get_instance_id()
            formats = _get_config(instance_id)
            if index < 0 or index >= len(formats):
                return jsonify({'success': False, 'message': 'Index out of range'}), 400
            formats.pop(index)
            _save_config(formats, instance_id)
            return jsonify({'success': True}), 200
        except Exception as e:
            logger.exception('Custom formats delete error')
            return jsonify({'success': False, 'error': str(e)}), 500

    @bp.route(prefix + '/preformats/<path:preformat_id>', methods=['GET'])
    def api_custom_formats_preformat_json(preformat_id):
        try:
            custom_format_json = trash_module.get_trash_format_json(preformat_id)
            name = trash_module.get_trash_format_name(preformat_id)
            if not custom_format_json:
                return jsonify({'success': False, 'message': 'Not found'}), 404
            if isinstance(custom_format_json, dict):
                custom_format_json = json.dumps(custom_format_json)
            return jsonify({'success': True, 'name': name or preformat_id, 'custom_format_json': custom_format_json}), 200
        except Exception as e:
            logger.exception('Preformat get error')
            return jsonify({'success': False, 'error': str(e)}), 500


def register_movie_custom_formats_routes(bp, get_instance_id):
    """Register Movie Hunt custom format routes (/api/custom-formats)."""
    from src.primary import trash_custom_formats
    _register_custom_formats_routes(bp, get_instance_id, 'movie_hunt_custom_formats', trash_custom_formats, '')


def register_tv_custom_formats_routes(bp, get_instance_id):
    """Register TV Hunt custom format routes (/api/tv-hunt/custom-formats)."""
    from src.primary import trash_custom_formats_sonarr
    _register_custom_formats_routes(bp, get_instance_id, 'tv_hunt_custom_formats', trash_custom_formats_sonarr, 'tv-hunt')
