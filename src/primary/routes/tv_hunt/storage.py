"""TV Hunt storage routes: root folders, detected episodes."""

import os
import re
from flask import request, jsonify

from . import tv_hunt_bp
from ._helpers import _get_tv_hunt_instance_id_from_request
from ...utils.logger import logger


def _get_root_folders_config(instance_id):
    """Get root folders for a TV Hunt instance."""
    from src.primary.utils.database import get_database
    db = get_database()
    config = db.get_app_config_for_instance('tv_hunt_root_folders', instance_id)
    if config and isinstance(config.get('root_folders'), list):
        return config['root_folders']
    return []


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


@tv_hunt_bp.route('/api/tv-hunt/root-folders', methods=['GET'])
def api_tv_hunt_root_folders_list():
    """List root folders for the current TV Hunt instance."""
    try:
        instance_id = _get_tv_hunt_instance_id_from_request()
        if not instance_id:
            return jsonify({'root_folders': []}), 200
        root_folders = _get_root_folders_config(instance_id)
        # Add free space info
        for rf in root_folders:
            path = rf.get('path', '')
            if path and os.path.isdir(path):
                try:
                    stat = os.statvfs(path)
                    rf['free_space'] = stat.f_bavail * stat.f_frsize
                except (OSError, AttributeError):
                    rf['free_space'] = 0
            else:
                rf['free_space'] = 0
        return jsonify({'root_folders': root_folders}), 200
    except Exception as e:
        logger.exception('TV Hunt root folders list error')
        return jsonify({'root_folders': [], 'error': str(e)}), 200


@tv_hunt_bp.route('/api/tv-hunt/root-folders', methods=['POST'])
def api_tv_hunt_root_folders_add():
    """Add a root folder."""
    try:
        instance_id = _get_tv_hunt_instance_id_from_request()
        if not instance_id:
            return jsonify({'error': 'No instance selected'}), 400
        data = request.get_json() or {}
        path = (data.get('path') or '').strip()
        if not path:
            return jsonify({'error': 'Path is required'}), 400
        from src.primary.utils.database import get_database
        db = get_database()
        config = db.get_app_config_for_instance('tv_hunt_root_folders', instance_id)
        if not config or not isinstance(config.get('root_folders'), list):
            config = {'root_folders': []}
        
        # Check for duplicate
        for rf in config['root_folders']:
            if rf.get('path', '') == path:
                return jsonify({'error': 'Root folder already exists'}), 409
        
        import uuid
        new_rf = {
            'id': str(uuid.uuid4())[:8],
            'path': path,
        }
        config['root_folders'].append(new_rf)
        db.save_app_config_for_instance('tv_hunt_root_folders', instance_id, config)
        return jsonify({'root_folder': new_rf}), 201
    except Exception as e:
        logger.exception('TV Hunt root folder add error')
        return jsonify({'error': str(e)}), 500


@tv_hunt_bp.route('/api/tv-hunt/root-folders/<folder_id>', methods=['DELETE'])
def api_tv_hunt_root_folders_delete(folder_id):
    """Delete a root folder."""
    try:
        instance_id = _get_tv_hunt_instance_id_from_request()
        if not instance_id:
            return jsonify({'error': 'No instance selected'}), 400
        from src.primary.utils.database import get_database
        db = get_database()
        config = db.get_app_config_for_instance('tv_hunt_root_folders', instance_id)
        if not config or not isinstance(config.get('root_folders'), list):
            return jsonify({'error': 'Root folder not found'}), 404
        config['root_folders'] = [rf for rf in config['root_folders'] if rf.get('id') != folder_id]
        db.save_app_config_for_instance('tv_hunt_root_folders', instance_id, config)
        return jsonify({'success': True}), 200
    except Exception as e:
        logger.exception('TV Hunt root folder delete error')
        return jsonify({'error': str(e)}), 500
