"""TV Hunt storage routes: root folders (Media Hunt), detected episodes."""

import os
import re

from flask import request, jsonify

from . import tv_hunt_bp
from ._helpers import _get_tv_hunt_instance_id_from_request
from ...utils.logger import logger


def _get_root_folders_config(instance_id):
    """Get TV Hunt root folders (delegates to Media Hunt with tv_hunt_root_folders config)."""
    from src.primary.routes.media_hunt import root_folders as media_hunt_root_folders
    return media_hunt_root_folders.get_root_folders_config(instance_id, 'tv_hunt_root_folders')


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


# --- Root folders (Media Hunt consolidated) ---

@tv_hunt_bp.route('/api/tv-hunt/root-folders', methods=['GET'])
def api_tv_hunt_root_folders_list():
    """List TV Hunt root folders (Media Hunt)."""
    try:
        from src.primary.routes.media_hunt import root_folders as mh_rf
        instance_id = _get_tv_hunt_instance_id_from_request()
        if not instance_id:
            return jsonify({'root_folders': []}), 200
        out = mh_rf.list_root_folders(instance_id, 'tv_hunt_root_folders')
        return jsonify({'root_folders': out}), 200
    except Exception as e:
        logger.exception('TV Hunt root folders list error')
        return jsonify({'root_folders': [], 'error': str(e)}), 200


@tv_hunt_bp.route('/api/tv-hunt/root-folders', methods=['POST'])
def api_tv_hunt_root_folders_add():
    """Add a TV Hunt root folder (Media Hunt)."""
    try:
        from src.primary.routes.media_hunt import root_folders as mh_rf
        instance_id = _get_tv_hunt_instance_id_from_request()
        if not instance_id:
            return jsonify({'success': False, 'message': 'No instance selected'}), 400
        data = request.get_json() or {}
        path = (data.get('path') or '').strip()
        success, result = mh_rf.add_root_folder(instance_id, 'tv_hunt_root_folders', path)
        if success:
            return jsonify({'success': True, 'index': result['index']}), 200
        return jsonify({'success': False, 'message': result.get('message', 'Add failed')}), 400
    except Exception as e:
        logger.exception('TV Hunt root folder add error')
        return jsonify({'success': False, 'message': str(e)}), 500


@tv_hunt_bp.route('/api/tv-hunt/root-folders/<int:index>', methods=['DELETE'])
def api_tv_hunt_root_folders_delete(index):
    """Delete TV Hunt root folder at index (Media Hunt)."""
    try:
        from src.primary.routes.media_hunt import root_folders as mh_rf
        instance_id = _get_tv_hunt_instance_id_from_request()
        if not instance_id:
            return jsonify({'success': False, 'message': 'No instance selected'}), 400
        success, msg = mh_rf.delete_root_folder(instance_id, 'tv_hunt_root_folders', index)
        if success:
            return jsonify({'success': True}), 200
        return jsonify({'success': False, 'message': msg or 'Index out of range'}), 400
    except Exception as e:
        logger.exception('TV Hunt root folder delete error')
        return jsonify({'success': False, 'message': str(e)}), 500


@tv_hunt_bp.route('/api/tv-hunt/root-folders/<int:index>/default', methods=['PATCH'])
def api_tv_hunt_root_folders_set_default(index):
    """Set TV Hunt root folder at index as default (Media Hunt)."""
    try:
        from src.primary.routes.media_hunt import root_folders as mh_rf
        instance_id = _get_tv_hunt_instance_id_from_request()
        if not instance_id:
            return jsonify({'success': False, 'message': 'No instance selected'}), 400
        success, msg = mh_rf.set_default_root_folder(instance_id, 'tv_hunt_root_folders', index)
        if success:
            return jsonify({'success': True}), 200
        return jsonify({'success': False, 'message': msg or 'Index out of range'}), 400
    except Exception as e:
        logger.exception('TV Hunt root folder set-default error')
        return jsonify({'success': False, 'message': str(e)}), 500


@tv_hunt_bp.route('/api/tv-hunt/root-folders/browse', methods=['GET'])
def api_tv_hunt_root_folders_browse():
    """List directories under a path (Media Hunt)."""
    try:
        from src.primary.routes.media_hunt import root_folders as mh_rf
        path = (request.args.get('path') or '').strip() or mh_rf.BROWSE_DEFAULT_PATH
        result = mh_rf.browse_root_folders(path)
        status = 400 if result.get('error') == 'Invalid path' else 200
        return jsonify(result), status
    except Exception as e:
        logger.exception('TV Hunt root folders browse error')
        return jsonify({'path': '', 'directories': [], 'error': str(e)}), 500


@tv_hunt_bp.route('/api/tv-hunt/root-folders/test', methods=['POST'])
def api_tv_hunt_root_folders_test():
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
        logger.exception('TV Hunt root folders test error')
        return jsonify({'success': False, 'message': str(e)}), 500
