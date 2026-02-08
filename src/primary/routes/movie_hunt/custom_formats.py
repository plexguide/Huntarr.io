"""Movie Hunt custom format routes (JSON; Pre-Format + Import)."""

import json

from flask import request, jsonify

from . import movie_hunt_bp
from ._helpers import _get_movie_hunt_instance_id_from_request
from ...utils.logger import logger
from ... import trash_custom_formats


def _custom_format_name_from_json(obj):
    """Extract display name from Movie Hunt custom format JSON (top-level 'name' field)."""
    if isinstance(obj, dict) and obj.get('name') is not None:
        return str(obj.get('name', '')).strip() or 'Unnamed'
    return 'Unnamed'


def _recommended_score_from_json(custom_format_json):
    """Extract recommended score from Movie Hunt/TRaSH custom format JSON (trash_scores.default)."""
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


def _get_custom_formats_config(instance_id):
    """Get Movie Hunt custom formats list from database. Default: empty list."""
    from src.primary.utils.database import get_database
    db = get_database()
    config = db.get_app_config_for_instance('movie_hunt_custom_formats', instance_id)
    if not config or not isinstance(config.get('custom_formats'), list):
        return []
    return list(config['custom_formats'])


def _save_custom_formats_config(formats_list, instance_id):
    """Save Movie Hunt custom formats list to database."""
    from src.primary.utils.database import get_database
    db = get_database()
    db.save_app_config_for_instance('movie_hunt_custom_formats', instance_id, {'custom_formats': formats_list})


@movie_hunt_bp.route('/api/custom-formats', methods=['GET'])
def api_custom_formats_list():
    """List Movie Hunt custom formats."""
    try:
        instance_id = _get_movie_hunt_instance_id_from_request()
        formats = _get_custom_formats_config(instance_id)
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
    """List TRaSH categories (with subcategories and formats) and flat preformats."""
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
        instance_id = _get_movie_hunt_instance_id_from_request()
        formats = _get_custom_formats_config(instance_id)
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
        _save_custom_formats_config(formats, instance_id)
        return jsonify({'success': True, 'index': len(formats) - 1}), 200
    except Exception as e:
        logger.exception('Custom formats add error')
        return jsonify({'success': False, 'error': str(e)}), 500


@movie_hunt_bp.route('/api/custom-formats/scores', methods=['PUT'])
def api_custom_formats_scores_batch():
    """Update all custom format scores in one request."""
    try:
        data = request.get_json() or {}
        scores = data.get('scores')
        if not isinstance(scores, list):
            return jsonify({'success': False, 'message': 'scores array required'}), 400
        instance_id = _get_movie_hunt_instance_id_from_request()
        formats = _get_custom_formats_config(instance_id)
        if len(scores) != len(formats):
            return jsonify({'success': False, 'message': 'scores length must match custom formats count'}), 400
        for i in range(len(formats)):
            try:
                val = int(scores[i])
            except (TypeError, ValueError, IndexError):
                val = 0
            formats[i]['score'] = val
        _save_custom_formats_config(formats, instance_id)
        return jsonify({'success': True}), 200
    except Exception as e:
        logger.exception('Custom formats scores batch error')
        return jsonify({'success': False, 'error': str(e)}), 500


@movie_hunt_bp.route('/api/custom-formats/<int:index>', methods=['PATCH'])
def api_custom_formats_patch(index):
    """Update custom format. Body: title?, custom_format_json?, score?."""
    try:
        instance_id = _get_movie_hunt_instance_id_from_request()
        formats = _get_custom_formats_config(instance_id)
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
        _save_custom_formats_config(formats, instance_id)
        return jsonify({'success': True}), 200
    except Exception as e:
        logger.exception('Custom formats patch error')
        return jsonify({'success': False, 'error': str(e)}), 500


@movie_hunt_bp.route('/api/custom-formats/<int:index>', methods=['DELETE'])
def api_custom_formats_delete(index):
    """Delete custom format at index."""
    try:
        instance_id = _get_movie_hunt_instance_id_from_request()
        formats = _get_custom_formats_config(instance_id)
        if index < 0 or index >= len(formats):
            return jsonify({'success': False, 'message': 'Index out of range'}), 400
        formats.pop(index)
        _save_custom_formats_config(formats, instance_id)
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
