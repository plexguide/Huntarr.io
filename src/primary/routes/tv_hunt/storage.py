"""TV Hunt storage routes: root folders, detected episodes. Independent from Movie Hunt."""

import os
import re
import shutil
from datetime import datetime

from flask import request, jsonify

from . import tv_hunt_bp
from ._helpers import _get_tv_hunt_instance_id_from_request
from ...utils.logger import logger


def _normalize_root_folders(folders):
    """Ensure list of { path, is_default }; exactly one default (same shape as Movie Hunt)."""
    if not folders:
        return []
    out = []
    for f in folders:
        if isinstance(f, str):
            path = (f or '').strip()
        else:
            path = (f.get('path') or '').strip()
        out.append({'path': path, 'is_default': bool(f.get('is_default') if isinstance(f, dict) else False)})
    defaults = [j for j, o in enumerate(out) if o.get('is_default')]
    if len(defaults) != 1:
        for j in range(len(out)):
            out[j]['is_default'] = (j == 0)
    return out


def _get_root_folders_config(instance_id):
    """Get TV Hunt root folders list from database (normalized: path, is_default)."""
    from src.primary.utils.database import get_database
    db = get_database()
    config = db.get_app_config_for_instance('tv_hunt_root_folders', instance_id)
    if not config or not isinstance(config.get('root_folders'), list):
        return []
    raw = config['root_folders']
    # Migrate old id-based entries to path/is_default
    normalized = _normalize_root_folders(raw)
    # If we had string paths or id-based items, persist normalized shape
    if raw and (isinstance(raw[0], str) or 'id' in (raw[0] or {})):
        _save_root_folders_config(normalized, instance_id)
    return normalized


def _save_root_folders_config(root_folders_list, instance_id):
    """Save TV Hunt root folders list to database."""
    from src.primary.utils.database import get_database
    db = get_database()
    normalized = _normalize_root_folders(root_folders_list)
    db.save_app_config_for_instance('tv_hunt_root_folders', instance_id, {'root_folders': normalized})


def _get_detected_episodes_from_all_roots(instance_id):
    """Scan all root folders for detected TV episodes. Returns list of episode dicts."""
    root_folders = _get_root_folders_config(instance_id)
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
                # Walk through season folders
                for root, dirs, files in os.walk(series_path):
                    for f in files:
                        # Match video files
                        ext = os.path.splitext(f)[1].lower()
                        if ext not in ('.mkv', '.mp4', '.avi', '.m4v', '.ts', '.wmv', '.flv'):
                            continue
                        # Try to extract S01E01 pattern
                        match = re.search(r'[Ss](\d{1,2})[Ee](\d{1,3})', f)
                        if match:
                            season_num = int(match.group(1))
                            episode_num = int(match.group(2))
                            detected.append({
                                'series_title': series_dir,
                                'season_number': season_num,
                                'episode_number': episode_num,
                                'file_path': os.path.join(root, f),
                                'file_name': f,
                            })
        except PermissionError:
            continue
        except Exception as e:
            logger.debug("TV Hunt root scan error for '%s': %s", path, e)
            continue
    return detected


TV_HUNT_TEST_FILENAME = 'tv-hunt.test'
BROWSE_DEFAULT_PATH = '/'
BROWSE_ALWAYS_INCLUDE_PATHS = ('/media',)


@tv_hunt_bp.route('/api/tv-hunt/root-folders', methods=['GET'])
def api_tv_hunt_root_folders_list():
    """List TV Hunt root folders with free space and is_default (same shape as Movie Hunt)."""
    try:
        instance_id = _get_tv_hunt_instance_id_from_request()
        if not instance_id:
            return jsonify({'root_folders': []}), 200
        folders = _get_root_folders_config(instance_id)
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
        logger.exception('TV Hunt root folders list error')
        return jsonify({'root_folders': [], 'error': str(e)}), 200


@tv_hunt_bp.route('/api/tv-hunt/root-folders', methods=['POST'])
def api_tv_hunt_root_folders_add():
    """Add a TV Hunt root folder."""
    try:
        instance_id = _get_tv_hunt_instance_id_from_request()
        if not instance_id:
            return jsonify({'success': False, 'message': 'No instance selected'}), 400
        data = request.get_json() or {}
        path = (data.get('path') or '').strip()
        if not path:
            return jsonify({'success': False, 'message': 'Path is required'}), 400
        if '..' in path:
            return jsonify({'success': False, 'message': 'Path cannot contain ..'}), 400
        folders = _get_root_folders_config(instance_id)
        normalized = os.path.normpath(path)
        if any((f.get('path') or '').strip() == normalized for f in folders):
            return jsonify({'success': False, 'message': 'That path is already added'}), 400
        is_first = len(folders) == 0
        folders.append({'path': normalized, 'is_default': is_first})
        _save_root_folders_config(folders, instance_id)
        return jsonify({'success': True, 'index': len(folders) - 1}), 200
    except Exception as e:
        logger.exception('TV Hunt root folder add error')
        return jsonify({'success': False, 'message': str(e)}), 500


@tv_hunt_bp.route('/api/tv-hunt/root-folders/<int:index>', methods=['DELETE'])
def api_tv_hunt_root_folders_delete(index):
    """Delete TV Hunt root folder at index."""
    try:
        instance_id = _get_tv_hunt_instance_id_from_request()
        if not instance_id:
            return jsonify({'success': False, 'message': 'No instance selected'}), 400
        folders = _get_root_folders_config(instance_id)
        if index < 0 or index >= len(folders):
            return jsonify({'success': False, 'message': 'Index out of range'}), 400
        was_default = folders[index].get('is_default')
        folders.pop(index)
        if was_default and folders:
            folders[0]['is_default'] = True
        _save_root_folders_config(folders, instance_id)
        return jsonify({'success': True}), 200
    except Exception as e:
        logger.exception('TV Hunt root folder delete error')
        return jsonify({'success': False, 'message': str(e)}), 500


@tv_hunt_bp.route('/api/tv-hunt/root-folders/<int:index>/default', methods=['PATCH'])
def api_tv_hunt_root_folders_set_default(index):
    """Set TV Hunt root folder at index as default."""
    try:
        instance_id = _get_tv_hunt_instance_id_from_request()
        if not instance_id:
            return jsonify({'success': False, 'message': 'No instance selected'}), 400
        folders = _get_root_folders_config(instance_id)
        if index < 0 or index >= len(folders):
            return jsonify({'success': False, 'message': 'Index out of range'}), 400
        for i in range(len(folders)):
            folders[i]['is_default'] = (i == index)
        _save_root_folders_config(folders, instance_id)
        return jsonify({'success': True}), 200
    except Exception as e:
        logger.exception('TV Hunt root folder set-default error')
        return jsonify({'success': False, 'message': str(e)}), 500


@tv_hunt_bp.route('/api/tv-hunt/root-folders/browse', methods=['GET'])
def api_tv_hunt_root_folders_browse():
    """List directories under a path for the file browser."""
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
        logger.exception('TV Hunt root folders browse error')
        return jsonify({'path': '', 'directories': [], 'error': str(e)}), 500


@tv_hunt_bp.route('/api/tv-hunt/root-folders/test', methods=['POST'])
def api_tv_hunt_root_folders_test():
    """Test write/read on a path (TV Hunt)."""
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
        test_path = os.path.join(dir_path, TV_HUNT_TEST_FILENAME)
        content = 'tv-hunt test ' + datetime.utcnow().isoformat() + 'Z'
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
        logger.exception('TV Hunt root folders test error')
        return jsonify({'success': False, 'message': str(e)}), 500
