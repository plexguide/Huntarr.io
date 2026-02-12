"""
Media Hunt – consolidated root folders logic.
Used by both Movie Hunt and TV Hunt; config_key determines storage (movie_hunt_root_folders vs tv_hunt_root_folders).
Test file: media-hunt.test
"""

import os
import shutil
from datetime import datetime

from ...utils.logger import logger


TEST_FILENAME = 'media-hunt.test'
BROWSE_DEFAULT_PATH = '/'
BROWSE_ALWAYS_INCLUDE_PATHS = ('/media',)


def normalize_root_folders(folders):
    """Ensure list of { path, is_default }; exactly one default."""
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


def get_root_folders_config(instance_id, config_key):
    """Get root folders list from database for the given config_key (movie_hunt_root_folders or tv_hunt_root_folders)."""
    from src.primary.utils.database import get_database
    db = get_database()
    config = db.get_app_config_for_instance(config_key, instance_id)
    if not config or not isinstance(config.get('root_folders'), list):
        return []
    raw = config['root_folders']
    normalized = normalize_root_folders(raw)
    # One-time migrate: persist normalized shape if we had string paths or id-based entries
    if raw and len(raw) > 0:
        first = raw[0]
        if isinstance(first, str) or (isinstance(first, dict) and 'id' in first):
            save_root_folders_config(normalized, instance_id, config_key)
    return normalized


def save_root_folders_config(root_folders_list, instance_id, config_key):
    """Save root folders list to database for the given config_key."""
    from src.primary.utils.database import get_database
    db = get_database()
    normalized = normalize_root_folders(root_folders_list)
    db.save_app_config_for_instance(config_key, instance_id, {'root_folders': normalized})


def list_root_folders(instance_id, config_key):
    """Return list of { index, path, freeSpace, is_default } for API response."""
    folders = get_root_folders_config(instance_id, config_key)
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
    return out


def add_root_folder(instance_id, config_key, path):
    """
    Add a root folder. Returns (success, result).
    result is either dict with 'message' (error) or dict with 'index' (success).
    """
    path = (path or '').strip()
    if not path:
        return False, {'message': 'Path is required'}
    if '..' in path:
        return False, {'message': 'Path cannot contain ..'}
    folders = get_root_folders_config(instance_id, config_key)
    normalized = os.path.normpath(path)
    if any((f.get('path') or '').strip() == normalized for f in folders):
        return False, {'message': 'That path is already added'}
    is_first = len(folders) == 0
    folders.append({'path': normalized, 'is_default': is_first})
    save_root_folders_config(folders, instance_id, config_key)
    return True, {'index': len(folders) - 1}


def delete_root_folder(instance_id, config_key, index):
    """Delete root folder at index. Returns (success, message)."""
    folders = get_root_folders_config(instance_id, config_key)
    if index < 0 or index >= len(folders):
        return False, 'Index out of range'
    was_default = folders[index].get('is_default')
    folders.pop(index)
    if was_default and folders:
        folders[0]['is_default'] = True
    save_root_folders_config(folders, instance_id, config_key)
    return True, None


def set_default_root_folder(instance_id, config_key, index):
    """Set root folder at index as default. Returns (success, message)."""
    folders = get_root_folders_config(instance_id, config_key)
    if index < 0 or index >= len(folders):
        return False, 'Index out of range'
    for i in range(len(folders)):
        folders[i]['is_default'] = (i == index)
    save_root_folders_config(folders, instance_id, config_key)
    return True, None


def browse_root_folders(path):
    """List directories under path. Returns dict with path, directories, and optional error."""
    path = (path or '').strip() or BROWSE_DEFAULT_PATH
    if '..' in path:
        return {'path': path, 'directories': [], 'error': 'Invalid path'}
    dir_path = os.path.abspath(os.path.normpath(path))
    if not os.path.isdir(dir_path):
        return {'path': dir_path, 'directories': [], 'error': 'Not a directory'}
    entries = []
    try:
        for name in sorted(os.listdir(dir_path)):
            full = os.path.join(dir_path, name)
            if os.path.isdir(full):
                entries.append({'name': name, 'path': full})
    except OSError as e:
        return {'path': dir_path, 'directories': [], 'error': str(e)}
    if dir_path == os.path.abspath(BROWSE_DEFAULT_PATH) or dir_path == os.path.abspath('/'):
        for extra in BROWSE_ALWAYS_INCLUDE_PATHS:
            if not any(e['path'] == extra for e in entries):
                name = os.path.basename(extra.rstrip(os.sep)) or 'media'
                entries.append({'name': name, 'path': extra})
        entries.sort(key=lambda e: (e['name'].lower(), e['path']))
    return {'path': dir_path, 'directories': entries}


def test_root_folder(path):
    """Test write/read on path using media-hunt.test. Returns (success, message)."""
    path = (path or '').strip()
    if not path:
        return False, 'Path is required'
    if '..' in path:
        return False, 'Path cannot contain ..'
    dir_path = os.path.abspath(os.path.normpath(path))
    if not os.path.isdir(dir_path):
        return False, f'Path is not a directory: {path}'
    test_path = os.path.join(dir_path, TEST_FILENAME)
    content = 'media-hunt test ' + datetime.utcnow().isoformat() + 'Z'
    try:
        with open(test_path, 'w') as f:
            f.write(content)
    except OSError as e:
        return False, f'Could not write: {e}'
    try:
        with open(test_path, 'r') as f:
            read_back = f.read()
        if read_back != content:
            return False, 'Read back content did not match'
    except OSError as e:
        try:
            os.remove(test_path)
        except OSError:
            pass
        return False, f'Could not read: {e}'
    try:
        os.remove(test_path)
    except OSError:
        pass
    return True, 'Write and read test passed.'
