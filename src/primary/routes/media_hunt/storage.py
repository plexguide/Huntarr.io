"""Media Hunt storage — root folders, movie/TV detection, movie management, remote mappings.
Consolidated from movie_hunt/storage and tv_hunt/storage.
Routes are registered on movie_hunt_bp and tv_hunt_bp via register_*_storage_routes().
"""

import os
import re
import threading

from flask import request, jsonify

from . import root_folders as mh_rf
from ...utils.logger import logger

# --- Shared constants ---
_VIDEO_EXTENSIONS = frozenset(('.mkv', '.mp4', '.avi', '.mov', '.wmv', '.m4v', '.mpg', '.mpeg', '.webm', '.flv', '.m2ts', '.ts'))


def get_root_folders_config(instance_id, config_key):
    """Get root folders for instance. config_key: 'movie_hunt_root_folders' or 'tv_hunt_root_folders'."""
    return mh_rf.get_root_folders_config(instance_id, config_key)


def get_movie_root_folders_config(instance_id):
    """Get Movie Hunt root folders (backward compat)."""
    return get_root_folders_config(instance_id, 'movie_hunt_root_folders')


def get_tv_root_folders_config(instance_id):
    """Get TV Hunt root folders (backward compat)."""
    return get_root_folders_config(instance_id, 'tv_hunt_root_folders')


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
    """Scan one root folder for movies. Returns list of { title, year }."""
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


def get_detected_movies_from_all_roots(instance_id):
    """Scan Movie Hunt root folders for detected movies. Returns list of { title, year }."""
    folders = get_root_folders_config(instance_id, 'movie_hunt_root_folders')
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


def get_detected_episodes_from_all_roots(instance_id):
    """Scan TV Hunt root folders for detected episodes."""
    root_folders = get_root_folders_config(instance_id, 'tv_hunt_root_folders')
    detected = []
    for rf in root_folders:
        path = rf.get('path', '').strip()
        if not path or not os.path.isdir(path):
            continue
        try:
            for series_dir in os.listdir(path):
                series_path = os.path.join(path, series_dir)
                if not os.path.isdir(series_path):
                    continue
                for root, dirs, files in os.walk(series_path):
                    for f in files:
                        ext = os.path.splitext(f)[1].lower()
                        if ext not in ('.mkv', '.mp4', '.avi', '.m4v', '.ts', '.wmv', '.flv'):
                            continue
                        match = re.search(r'[Ss](\d{1,2})[Ee](\d{1,3})', f)
                        if match:
                            detected.append({
                                'series_title': series_dir,
                                'season_number': int(match.group(1)),
                                'episode_number': int(match.group(2)),
                                'file_path': os.path.join(root, f),
                                'file_name': f,
                            })
        except (PermissionError, Exception) as e:
            logger.debug("TV Hunt root scan error for '%s': %s", path, e)
    return detected


def detect_available_in_root_folder(root_path, title, year):
    """Check if a movie appears to be present in root_path."""
    if not root_path or not title:
        return False
    title_norm = re.sub(r'[^\w\s]', ' ', (title or '').lower().strip())
    title_norm = ' '.join(title_norm.split())
    if not title_norm:
        return False
    if not os.path.isdir(root_path):
        return False
    year_str = (year or '').strip()
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


# --- Register Movie Hunt storage routes ---
def register_movie_storage_routes(bp, get_instance_id):
    """Register root folders, movie management, remote mappings on movie_hunt_bp."""
    _gid = get_instance_id

    def _movie_management_defaults():
        return {
            'rename_movies': True, 'replace_illegal_characters': True, 'colon_replacement': 'Smart Replace',
            'standard_movie_format': '{Movie Title} ({Release Year}) {Quality Full}',
            'movie_folder_format': '{Movie Title} ({Release Year})',
            'minimum_free_space_gb': 10, 'import_using_script': False, 'import_extra_files': False,
        }

    def _get_movie_management_config(instance_id):
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

    @bp.route('/api/settings/movie-management', methods=['GET'])
    def api_movie_management_get():
        try:
            instance_id = _gid()
            return jsonify(_get_movie_management_config(instance_id)), 200
        except Exception:
            return jsonify(_movie_management_defaults()), 200

    @bp.route('/api/settings/movie-management', methods=['PATCH'])
    def api_movie_management_patch():
        try:
            instance_id = _gid()
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

    # Root folders
    @bp.route('/api/movie-hunt/root-folders', methods=['GET'])
    def api_movie_hunt_root_folders_list():
        try:
            instance_id = _gid()
            out = mh_rf.list_root_folders(instance_id, 'movie_hunt_root_folders')
            return jsonify({'root_folders': out}), 200
        except Exception as e:
            logger.exception('Root folders list error')
            return jsonify({'root_folders': [], 'error': str(e)}), 200

    @bp.route('/api/movie-hunt/root-folders', methods=['POST'])
    def api_movie_hunt_root_folders_add():
        try:
            instance_id = _gid()
            data = request.get_json() or {}
            path = (data.get('path') or '').strip()
            success, result = mh_rf.add_root_folder(instance_id, 'movie_hunt_root_folders', path)
            if success:
                def _run():
                    try:
                        from . import import_media
                        import_media.run_movie_import_media_scan(instance_id, max_match=None, lightweight=True)
                    except Exception as e:
                        logger.warning("Import Media: background scan failed: %s", e)
                threading.Thread(target=_run, daemon=True).start()
                return jsonify({'success': True, 'index': result['index']}), 200
            return jsonify({'success': False, 'message': result.get('message', 'Add failed')}), 400
        except Exception as e:
            logger.exception('Root folders add error')
            return jsonify({'success': False, 'message': str(e)}), 500

    @bp.route('/api/movie-hunt/root-folders/<int:index>', methods=['DELETE'])
    def api_movie_hunt_root_folders_delete(index):
        try:
            instance_id = _gid()
            success, msg = mh_rf.delete_root_folder(instance_id, 'movie_hunt_root_folders', index)
            return jsonify({'success': success, 'message': msg or 'Index out of range'}), 200 if success else 400
        except Exception as e:
            logger.exception('Root folders delete error')
            return jsonify({'success': False, 'message': str(e)}), 500

    @bp.route('/api/movie-hunt/root-folders/<int:index>/default', methods=['PATCH'])
    def api_movie_hunt_root_folders_set_default(index):
        try:
            instance_id = _gid()
            success, msg = mh_rf.set_default_root_folder(instance_id, 'movie_hunt_root_folders', index)
            return jsonify({'success': success, 'message': msg or 'Index out of range'}), 200 if success else 400
        except Exception as e:
            logger.exception('Root folders set-default error')
            return jsonify({'success': False, 'message': str(e)}), 500

    @bp.route('/api/movie-hunt/root-folders/browse', methods=['GET'])
    def api_movie_hunt_root_folders_browse():
        try:
            path = (request.args.get('path') or '').strip() or mh_rf.BROWSE_DEFAULT_PATH
            result = mh_rf.browse_root_folders(path)
            return jsonify(result), 400 if result.get('error') == 'Invalid path' else 200
        except Exception as e:
            logger.exception('Root folders browse error')
            return jsonify({'path': '', 'directories': [], 'error': str(e)}), 500

    @bp.route('/api/movie-hunt/root-folders/browse/create', methods=['POST'])
    def api_movie_hunt_root_folders_browse_create():
        try:
            data = request.get_json() or {}
            parent = (data.get('parent_path') or data.get('path') or '').strip()
            name = (data.get('name') or '').strip()
            success, result = mh_rf.create_folder(parent, name)
            if success:
                return jsonify({'success': True, 'path': result['path']}), 200
            return jsonify({'success': False, 'error': result.get('error', 'Failed')}), 400
        except Exception as e:
            logger.exception('Root folders browse create error')
            return jsonify({'success': False, 'error': str(e)}), 500

    @bp.route('/api/movie-hunt/root-folders/browse/delete', methods=['POST'])
    def api_movie_hunt_root_folders_browse_delete():
        try:
            data = request.get_json() or {}
            path = (data.get('path') or '').strip()
            success, err = mh_rf.delete_folder(path)
            if success:
                return jsonify({'success': True}), 200
            return jsonify({'success': False, 'error': err or 'Failed'}), 400
        except Exception as e:
            logger.exception('Root folders browse delete error')
            return jsonify({'success': False, 'error': str(e)}), 500

    @bp.route('/api/movie-hunt/root-folders/browse/rename', methods=['POST'])
    def api_movie_hunt_root_folders_browse_rename():
        try:
            data = request.get_json() or {}
            path = (data.get('path') or '').strip()
            new_name = (data.get('new_name') or '').strip()
            success, result = mh_rf.rename_folder(path, new_name)
            if success:
                return jsonify({'success': True, 'path': result['path']}), 200
            return jsonify({'success': False, 'error': result.get('error', 'Failed')}), 400
        except Exception as e:
            logger.exception('Root folders browse rename error')
            return jsonify({'success': False, 'error': str(e)}), 500

    @bp.route('/api/movie-hunt/root-folders/test', methods=['POST'])
    def api_movie_hunt_root_folders_test():
        try:
            data = request.get_json() or {}
            path = (data.get('path') or '').strip()
            success, message = mh_rf.test_root_folder(path)
            return jsonify({'success': success, 'message': message}), 200
        except Exception as e:
            logger.exception('Root folders test error')
            return jsonify({'success': False, 'message': str(e)}), 500

    # Remote mappings
    def _get_remote_mappings(instance_id):
        from src.primary.utils.database import get_database
        db = get_database()
        config = db.get_app_config_for_instance('movie_hunt_remote_mappings', instance_id)
        return config.get('mappings', []) if config and isinstance(config.get('mappings'), list) else []

    def _save_remote_mappings(mappings, instance_id):
        from src.primary.utils.database import get_database
        get_database().save_app_config_for_instance('movie_hunt_remote_mappings', instance_id, {'mappings': mappings})

    @bp.route('/api/movie-hunt/remote-mappings', methods=['GET'])
    def api_movie_hunt_remote_mappings_list():
        try:
            mappings = _get_remote_mappings(_gid())
            return jsonify({'success': True, 'mappings': mappings}), 200
        except Exception as e:
            return jsonify({'success': False, 'mappings': [], 'error': str(e)}), 500

    @bp.route('/api/movie-hunt/remote-mappings', methods=['POST'])
    def api_movie_hunt_remote_mappings_add():
        try:
            data = request.get_json() or {}
            host, remote_path, local_path = (data.get('host') or '').strip(), (data.get('remote_path') or '').strip(), (data.get('local_path') or '').strip()
            if not host or not remote_path or not local_path:
                return jsonify({'success': False, 'message': 'Host, remote_path, local_path required'}), 400
            mappings = _get_remote_mappings(_gid())
            mappings.append({'host': host, 'remote_path': remote_path, 'local_path': local_path})
            _save_remote_mappings(mappings, _gid())
            return jsonify({'success': True, 'mapping': mappings[-1]}), 200
        except Exception as e:
            return jsonify({'success': False, 'message': str(e)}), 500

    @bp.route('/api/movie-hunt/remote-mappings/<int:index>', methods=['PUT'])
    def api_movie_hunt_remote_mappings_update(index):
        try:
            data = request.get_json() or {}
            host, remote_path, local_path = (data.get('host') or '').strip(), (data.get('remote_path') or '').strip(), (data.get('local_path') or '').strip()
            if not host or not remote_path or not local_path:
                return jsonify({'success': False, 'message': 'Required'}), 400
            mappings = _get_remote_mappings(_gid())
            if index < 0 or index >= len(mappings):
                return jsonify({'success': False, 'message': 'Not found'}), 404
            mappings[index] = {'host': host, 'remote_path': remote_path, 'local_path': local_path}
            _save_remote_mappings(mappings, _gid())
            return jsonify({'success': True, 'mapping': mappings[index]}), 200
        except Exception as e:
            return jsonify({'success': False, 'message': str(e)}), 500

    @bp.route('/api/movie-hunt/remote-mappings/<int:index>', methods=['DELETE'])
    def api_movie_hunt_remote_mappings_delete(index):
        try:
            mappings = _get_remote_mappings(_gid())
            if index < 0 or index >= len(mappings):
                return jsonify({'success': False, 'message': 'Not found'}), 404
            mappings.pop(index)
            _save_remote_mappings(mappings, _gid())
            return jsonify({'success': True}), 200
        except Exception as e:
            return jsonify({'success': False, 'message': str(e)}), 500


# --- Register TV Hunt storage routes ---
def register_tv_storage_routes(bp, get_instance_id):
    """Register TV Hunt root folders on tv_hunt_bp."""
    _gid = get_instance_id

    @bp.route('/api/tv-hunt/root-folders', methods=['GET'])
    def api_tv_hunt_root_folders_list():
        try:
            instance_id = _gid()
            if not instance_id:
                return jsonify({'root_folders': []}), 200
            out = mh_rf.list_root_folders(instance_id, 'tv_hunt_root_folders')
            return jsonify({'root_folders': out}), 200
        except Exception as e:
            return jsonify({'root_folders': [], 'error': str(e)}), 200

    @bp.route('/api/tv-hunt/root-folders', methods=['POST'])
    def api_tv_hunt_root_folders_add():
        try:
            instance_id = _gid()
            if not instance_id:
                return jsonify({'success': False, 'message': 'No instance selected'}), 400
            data = request.get_json() or {}
            path = (data.get('path') or '').strip()
            success, result = mh_rf.add_root_folder(instance_id, 'tv_hunt_root_folders', path)
            if success:
                def _run():
                    try:
                        from . import import_media
                        import_media.run_tv_import_media_scan(instance_id, max_match=None, lightweight=True)
                    except Exception as e:
                        logger.warning("TV Import Media: background scan failed: %s", e)
                threading.Thread(target=_run, daemon=True).start()
                return jsonify({'success': True, 'index': result['index']}), 200
            return jsonify({'success': False, 'message': result.get('message', 'Add failed')}), 400
        except Exception as e:
            logger.exception('TV Hunt root folder add error')
            return jsonify({'success': False, 'message': str(e)}), 500

    @bp.route('/api/tv-hunt/root-folders/<int:index>', methods=['DELETE'])
    def api_tv_hunt_root_folders_delete(index):
        try:
            instance_id = _gid()
            if not instance_id:
                return jsonify({'success': False, 'message': 'No instance selected'}), 400
            success, msg = mh_rf.delete_root_folder(instance_id, 'tv_hunt_root_folders', index)
            return jsonify({'success': success, 'message': msg or 'Index out of range'}), 200 if success else 400
        except Exception as e:
            return jsonify({'success': False, 'message': str(e)}), 500

    @bp.route('/api/tv-hunt/root-folders/<int:index>/default', methods=['PATCH'])
    def api_tv_hunt_root_folders_set_default(index):
        try:
            instance_id = _gid()
            if not instance_id:
                return jsonify({'success': False, 'message': 'No instance selected'}), 400
            success, msg = mh_rf.set_default_root_folder(instance_id, 'tv_hunt_root_folders', index)
            return jsonify({'success': success, 'message': msg or 'Index out of range'}), 200 if success else 400
        except Exception as e:
            return jsonify({'success': False, 'message': str(e)}), 500

    @bp.route('/api/tv-hunt/root-folders/browse', methods=['GET'])
    def api_tv_hunt_root_folders_browse():
        try:
            path = (request.args.get('path') or '').strip() or mh_rf.BROWSE_DEFAULT_PATH
            result = mh_rf.browse_root_folders(path)
            return jsonify(result), 400 if result.get('error') == 'Invalid path' else 200
        except Exception as e:
            return jsonify({'path': '', 'directories': [], 'error': str(e)}), 500

    @bp.route('/api/tv-hunt/root-folders/browse/create', methods=['POST'])
    def api_tv_hunt_root_folders_browse_create():
        try:
            data = request.get_json() or {}
            parent = (data.get('parent_path') or data.get('path') or '').strip()
            name = (data.get('name') or '').strip()
            success, result = mh_rf.create_folder(parent, name)
            if success:
                return jsonify({'success': True, 'path': result['path']}), 200
            return jsonify({'success': False, 'error': result.get('error', 'Failed')}), 400
        except Exception as e:
            logger.exception('TV Hunt root folders browse create error')
            return jsonify({'success': False, 'error': str(e)}), 500

    @bp.route('/api/tv-hunt/root-folders/browse/delete', methods=['POST'])
    def api_tv_hunt_root_folders_browse_delete():
        try:
            data = request.get_json() or {}
            path = (data.get('path') or '').strip()
            success, err = mh_rf.delete_folder(path)
            if success:
                return jsonify({'success': True}), 200
            return jsonify({'success': False, 'error': err or 'Failed'}), 400
        except Exception as e:
            logger.exception('TV Hunt root folders browse delete error')
            return jsonify({'success': False, 'error': str(e)}), 500

    @bp.route('/api/tv-hunt/root-folders/browse/rename', methods=['POST'])
    def api_tv_hunt_root_folders_browse_rename():
        try:
            data = request.get_json() or {}
            path = (data.get('path') or '').strip()
            new_name = (data.get('new_name') or '').strip()
            success, result = mh_rf.rename_folder(path, new_name)
            if success:
                return jsonify({'success': True, 'path': result['path']}), 200
            return jsonify({'success': False, 'error': result.get('error', 'Failed')}), 400
        except Exception as e:
            logger.exception('TV Hunt root folders browse rename error')
            return jsonify({'success': False, 'error': str(e)}), 500

    @bp.route('/api/tv-hunt/root-folders/test', methods=['POST'])
    def api_tv_hunt_root_folders_test():
        try:
            data = request.get_json() or {}
            path = (data.get('path') or '').strip()
            success, message = mh_rf.test_root_folder(path)
            return jsonify({'success': success, 'message': message}), 200
        except Exception as e:
            return jsonify({'success': False, 'message': str(e)}), 500
