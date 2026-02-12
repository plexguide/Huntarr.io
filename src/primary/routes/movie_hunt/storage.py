"""Movie Hunt storage routes: root folders (Media Hunt), remote mappings, movie management, folder scanning."""

import os
import re

from flask import request, jsonify

from . import movie_hunt_bp
from ._helpers import _get_movie_hunt_instance_id_from_request
from ...utils.logger import logger


# --- Movie Management Settings (Movie Naming + Importing) ---

def _movie_management_defaults():
    """Default values for movie management settings."""
    return {
        'rename_movies': True,
        'replace_illegal_characters': True,
        'colon_replacement': 'Smart Replace',
        'standard_movie_format': '{Movie Title} ({Release Year}) {Quality Full}',
        'movie_folder_format': '{Movie Title} ({Release Year})',
        'minimum_free_space_gb': 10,
        'import_using_script': False,
        'import_extra_files': False,
    }


def _get_movie_management_config(instance_id):
    """Get movie management config from database; merge with defaults."""
    from src.primary.utils.database import get_database
    db = get_database()
    config = db.get_app_config_for_instance('movie_management', instance_id)
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
    """Get movie management settings."""
    try:
        instance_id = _get_movie_hunt_instance_id_from_request()
        data = _get_movie_management_config(instance_id)
        return jsonify(data), 200
    except Exception as e:
        logger.exception('Movie management get error')
        return jsonify(_movie_management_defaults()), 200


@movie_hunt_bp.route('/api/settings/movie-management', methods=['PATCH'])
def api_movie_management_patch():
    """Update movie management settings."""
    try:
        instance_id = _get_movie_hunt_instance_id_from_request()
        data = request.get_json() or {}
        current = _get_movie_management_config(instance_id)
        allowed = set(_movie_management_defaults().keys())
        for k, v in data.items():
            if k in allowed:
                current[k] = v
        from src.primary.utils.database import get_database
        db = get_database()
        db.save_app_config_for_instance('movie_management', instance_id, current)
        return jsonify(_get_movie_management_config(instance_id)), 200
    except Exception as e:
        logger.exception('Movie management patch error')
        return jsonify({'error': str(e)}), 500


# --- Root folder scanning ---

_VIDEO_EXTENSIONS = frozenset(('.mkv', '.mp4', '.avi', '.mov', '.wmv', '.m4v', '.mpg', '.mpeg', '.webm', '.flv', '.m2ts', '.ts'))


def _parse_title_year_from_name(name):
    """Extract (title, year) from a folder or file name."""
    if not name:
        return '', ''
    name = name.strip()
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
    """Scan one root folder and return list of { 'title': str, 'year': str } for each detected movie."""
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


def _get_root_folders_config(instance_id):
    """Get Movie Hunt root folders (delegates to Media Hunt with movie_hunt_root_folders config)."""
    from src.primary.routes.media_hunt import root_folders as media_hunt_root_folders
    return media_hunt_root_folders.get_root_folders_config(instance_id, 'movie_hunt_root_folders')


def _get_detected_movies_from_all_roots(instance_id):
    """Scan all configured Movie Hunt root folders and return list of { title, year } for every movie detected."""
    folders = _get_root_folders_config(instance_id)
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
    """Check if a movie appears to be present in root_path."""
    if not root_path or not title:
        return False
    title_lower = (title or '').lower().strip()
    year_str = (year or '').strip()
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
                            if title_norm in name.lower().replace('.', ' ').replace('_', ' ') or title_norm in base.lower().replace('.', ' ').replace('_', ' '):
                                return True
                            if year_str and year_str in name and title_norm in name.lower().replace('.', ' ').replace('_', ' '):
                                return True
    except OSError:
        pass
    return False


# --- Root folders (Media Hunt consolidated) ---

@movie_hunt_bp.route('/api/movie-hunt/root-folders', methods=['GET'])
def api_movie_hunt_root_folders_list():
    """List Movie Hunt root folders (Media Hunt)."""
    try:
        from src.primary.routes.media_hunt import root_folders as mh_rf
        instance_id = _get_movie_hunt_instance_id_from_request()
        out = mh_rf.list_root_folders(instance_id, 'movie_hunt_root_folders')
        return jsonify({'root_folders': out}), 200
    except Exception as e:
        logger.exception('Root folders list error')
        return jsonify({'root_folders': [], 'error': str(e)}), 200


@movie_hunt_bp.route('/api/movie-hunt/root-folders', methods=['POST'])
def api_movie_hunt_root_folders_add():
    """Add a root folder (Media Hunt)."""
    try:
        from src.primary.routes.media_hunt import root_folders as mh_rf
        instance_id = _get_movie_hunt_instance_id_from_request()
        data = request.get_json() or {}
        path = (data.get('path') or '').strip()
        success, result = mh_rf.add_root_folder(instance_id, 'movie_hunt_root_folders', path)
        if success:
            return jsonify({'success': True, 'index': result['index']}), 200
        return jsonify({'success': False, 'message': result.get('message', 'Add failed')}), 400
    except Exception as e:
        logger.exception('Root folders add error')
        return jsonify({'success': False, 'message': str(e)}), 500


@movie_hunt_bp.route('/api/movie-hunt/root-folders/<int:index>', methods=['DELETE'])
def api_movie_hunt_root_folders_delete(index):
    """Delete root folder at index (Media Hunt)."""
    try:
        from src.primary.routes.media_hunt import root_folders as mh_rf
        instance_id = _get_movie_hunt_instance_id_from_request()
        success, msg = mh_rf.delete_root_folder(instance_id, 'movie_hunt_root_folders', index)
        if success:
            return jsonify({'success': True}), 200
        return jsonify({'success': False, 'message': msg or 'Index out of range'}), 400
    except Exception as e:
        logger.exception('Root folders delete error')
        return jsonify({'success': False, 'message': str(e)}), 500


@movie_hunt_bp.route('/api/movie-hunt/root-folders/<int:index>/default', methods=['PATCH'])
def api_movie_hunt_root_folders_set_default(index):
    """Set root folder at index as default (Media Hunt)."""
    try:
        from src.primary.routes.media_hunt import root_folders as mh_rf
        instance_id = _get_movie_hunt_instance_id_from_request()
        success, msg = mh_rf.set_default_root_folder(instance_id, 'movie_hunt_root_folders', index)
        if success:
            return jsonify({'success': True}), 200
        return jsonify({'success': False, 'message': msg or 'Index out of range'}), 400
    except Exception as e:
        logger.exception('Root folders set-default error')
        return jsonify({'success': False, 'message': str(e)}), 500


@movie_hunt_bp.route('/api/movie-hunt/root-folders/browse', methods=['GET'])
def api_movie_hunt_root_folders_browse():
    """List directories under a path (Media Hunt)."""
    try:
        from src.primary.routes.media_hunt import root_folders as mh_rf
        path = (request.args.get('path') or '').strip() or mh_rf.BROWSE_DEFAULT_PATH
        result = mh_rf.browse_root_folders(path)
        status = 400 if result.get('error') == 'Invalid path' else 200
        return jsonify(result), status
    except Exception as e:
        logger.exception('Root folders browse error')
        return jsonify({'path': '', 'directories': [], 'error': str(e)}), 500


@movie_hunt_bp.route('/api/movie-hunt/root-folders/test', methods=['POST'])
def api_movie_hunt_root_folders_test():
    """Test write/read on a path (Media Hunt)."""
    try:
        from src.primary.routes.media_hunt import root_folders as mh_rf
        data = request.get_json() or {}
        path = (data.get('path') or '').strip()
        success, message = mh_rf.test_root_folder(path)
        if success:
            return jsonify({'success': True, 'message': message}), 200
        return jsonify({'success': False, 'message': message}), 200
    except Exception as e:
        logger.exception('Root folders test error')
        return jsonify({'success': False, 'message': str(e)}), 500


# --- Remote Path Mappings ---

def _get_remote_mappings_config(instance_id):
    """Get remote path mappings list from database."""
    from src.primary.utils.database import get_database
    db = get_database()
    config = db.get_app_config_for_instance('movie_hunt_remote_mappings', instance_id)
    if not config or not isinstance(config.get('mappings'), list):
        return []
    return config['mappings']


def _save_remote_mappings_config(mappings_list, instance_id):
    """Save remote path mappings list to database."""
    from src.primary.utils.database import get_database
    db = get_database()
    db.save_app_config_for_instance('movie_hunt_remote_mappings', instance_id, {'mappings': mappings_list})


@movie_hunt_bp.route('/api/movie-hunt/remote-mappings', methods=['GET'])
def api_movie_hunt_remote_mappings_list():
    """List Movie Hunt remote path mappings."""
    try:
        instance_id = _get_movie_hunt_instance_id_from_request()
        mappings = _get_remote_mappings_config(instance_id)
        return jsonify({'success': True, 'mappings': mappings}), 200
    except Exception as e:
        logger.exception('Remote mappings list error')
        return jsonify({'success': False, 'mappings': [], 'error': str(e)}), 500


@movie_hunt_bp.route('/api/movie-hunt/remote-mappings', methods=['POST'])
def api_movie_hunt_remote_mappings_add():
    """Add a remote path mapping."""
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

        instance_id = _get_movie_hunt_instance_id_from_request()
        mappings = _get_remote_mappings_config(instance_id)
        mappings.append({
            'host': host,
            'remote_path': remote_path,
            'local_path': local_path
        })
        _save_remote_mappings_config(mappings, instance_id)
        return jsonify({'success': True, 'mapping': mappings[-1]}), 200
    except Exception as e:
        logger.exception('Remote mappings add error')
        return jsonify({'success': False, 'message': str(e)}), 500


@movie_hunt_bp.route('/api/movie-hunt/remote-mappings/<int:index>', methods=['PUT'])
def api_movie_hunt_remote_mappings_update(index):
    """Update a remote path mapping."""
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

        instance_id = _get_movie_hunt_instance_id_from_request()
        mappings = _get_remote_mappings_config(instance_id)
        if index < 0 or index >= len(mappings):
            return jsonify({'success': False, 'message': 'Not found'}), 404

        mappings[index] = {
            'host': host,
            'remote_path': remote_path,
            'local_path': local_path
        }
        _save_remote_mappings_config(mappings, instance_id)
        return jsonify({'success': True, 'mapping': mappings[index]}), 200
    except Exception as e:
        logger.exception('Remote mappings update error')
        return jsonify({'success': False, 'message': str(e)}), 500


@movie_hunt_bp.route('/api/movie-hunt/remote-mappings/<int:index>', methods=['DELETE'])
def api_movie_hunt_remote_mappings_delete(index):
    """Delete a remote path mapping at index."""
    try:
        instance_id = _get_movie_hunt_instance_id_from_request()
        mappings = _get_remote_mappings_config(instance_id)
        if index < 0 or index >= len(mappings):
            return jsonify({'success': False, 'message': 'Not found'}), 404

        mappings.pop(index)
        _save_remote_mappings_config(mappings, instance_id)
        return jsonify({'success': True}), 200
    except Exception as e:
        logger.exception('Remote mappings delete error')
        return jsonify({'success': False, 'message': str(e)}), 500
