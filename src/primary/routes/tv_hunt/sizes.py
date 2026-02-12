"""TV Hunt size definitions routes – min / preferred / max per quality tier.
Per-instance config, independent from Movie Hunt."""

from flask import request, jsonify

from . import tv_hunt_bp
from ._helpers import _get_tv_hunt_instance_id_from_request
from ...utils.logger import logger
from ...utils.database import get_database


# ---------------------------------------------------------------------------
# Defaults – same structure as Movie Hunt (grouped by resolution tier).
# Values are in **megabytes per minute** of runtime.
# ---------------------------------------------------------------------------

SIZES_DEFAULT = [
    {'id': 'unknown',    'name': 'Unknown',     'group': 'Low Quality',  'min': 0,  'preferred': 75,  'max': 100},
    {'id': 'workprint',  'name': 'WORKPRINT',   'group': 'Low Quality',  'min': 0,  'preferred': 75,  'max': 100},
    {'id': 'cam',        'name': 'CAM',         'group': 'Low Quality',  'min': 0,  'preferred': 75,  'max': 100},
    {'id': 'telesync',   'name': 'TELESYNC',    'group': 'Low Quality',  'min': 0,  'preferred': 75,  'max': 100},
    {'id': 'telecine',   'name': 'TELECINE',    'group': 'Low Quality',  'min': 0,  'preferred': 75,  'max': 100},
    {'id': 'regional',   'name': 'REGIONAL',    'group': 'Low Quality',  'min': 0,  'preferred': 75,  'max': 100},
    {'id': 'dvdscr',     'name': 'DVDSCR',      'group': 'Low Quality',  'min': 0,  'preferred': 75,  'max': 100},
    {'id': 'sdtv',       'name': 'SDTV',        'group': 'SD',  'min': 0,  'preferred': 20,  'max': 40},
    {'id': 'dvd',        'name': 'DVD',          'group': 'SD',  'min': 0,  'preferred': 20,  'max': 40},
    {'id': 'hdtv720',    'name': 'HDTV-720p',   'group': '720p',  'min': 0,  'preferred': 30,  'max': 60},
    {'id': 'web720',     'name': 'WEB 720p',     'group': '720p',  'min': 0,  'preferred': 30,  'max': 60},
    {'id': 'bluray720',  'name': 'Bluray-720p',  'group': '720p',  'min': 0,  'preferred': 30,  'max': 60},
    {'id': 'hdtv1080',   'name': 'HDTV-1080p',   'group': '1080p',  'min': 0,  'preferred': 75,  'max': 150},
    {'id': 'web1080',    'name': 'WEB 1080p',     'group': '1080p',  'min': 0,  'preferred': 75,  'max': 150},
    {'id': 'bluray1080', 'name': 'Bluray-1080p',  'group': '1080p',  'min': 0,  'preferred': 75,  'max': 150},
    {'id': 'remux1080',  'name': 'Remux-1080p',   'group': '1080p',  'min': 0,  'preferred': 75,  'max': 150},
    {'id': 'hdtv2160',   'name': 'HDTV-2160p',   'group': '2160p',  'min': 0,  'preferred': 100,  'max': 200},
    {'id': 'web2160',    'name': 'WEB 2160p',     'group': '2160p',  'min': 0,  'preferred': 100,  'max': 200},
    {'id': 'bluray2160', 'name': 'Bluray-2160p',  'group': '2160p',  'min': 0,  'preferred': 100,  'max': 200},
    {'id': 'remux2160',  'name': 'Remux-2160p',   'group': '2160p',  'min': 0,  'preferred': 100,  'max': 200},
    {'id': 'brdisk',     'name': 'BR-DISK',  'group': 'Ultra',  'min': 0,  'preferred': 100,  'max': 200},
    {'id': 'rawhd',      'name': 'Raw-HD',   'group': 'Ultra',  'min': 0,  'preferred': 100,  'max': 200},
]


def _get_sizes(instance_id):
    """Return stored sizes list or defaults for the given TV Hunt instance."""
    db = get_database()
    config = db.get_app_config_for_instance('tv_hunt_sizes', instance_id)
    if config and isinstance(config, dict) and 'sizes' in config:
        return config['sizes']
    return [dict(s) for s in SIZES_DEFAULT]


def _save_sizes(instance_id, sizes):
    """Save sizes for the given TV Hunt instance."""
    db = get_database()
    db.save_app_config_for_instance('tv_hunt_sizes', instance_id, {'sizes': sizes})


# ---- Routes ---------------------------------------------------------------

@tv_hunt_bp.route('/api/tv-hunt/sizes', methods=['GET'])
def get_tv_hunt_sizes():
    """Return the current quality-size definitions for the selected TV Hunt instance."""
    instance_id = _get_tv_hunt_instance_id_from_request()
    if not instance_id:
        return jsonify({'success': False, 'error': 'No instance selected'}), 400
    return jsonify({'success': True, 'sizes': _get_sizes(instance_id)})


@tv_hunt_bp.route('/api/tv-hunt/sizes', methods=['PUT'])
def update_tv_hunt_sizes():
    """Bulk-update size definitions for the selected TV Hunt instance."""
    instance_id = _get_tv_hunt_instance_id_from_request()
    if not instance_id:
        return jsonify({'success': False, 'error': 'No instance selected'}), 400
    data = request.get_json(silent=True) or {}
    incoming = data.get('sizes')
    if not isinstance(incoming, list):
        return jsonify({'success': False, 'error': 'sizes must be a list'}), 400

    default_map = {s['id']: dict(s) for s in SIZES_DEFAULT}
    merged = []
    seen = set()
    for item in incoming:
        qid = item.get('id', '')
        if not qid or qid in seen:
            continue
        seen.add(qid)
        base = default_map.get(qid, {})
        base.update({
            'id': qid,
            'name': item.get('name', base.get('name', qid)),
            'group': item.get('group', base.get('group', '')),
            'min': max(0, int(item.get('min', base.get('min', 0)))),
            'preferred': max(0, int(item.get('preferred', base.get('preferred', 95)))),
            'max': max(1, int(item.get('max', base.get('max', 100)))),
        })
        if base['min'] > base['preferred']:
            base['preferred'] = base['min']
        if base['preferred'] > base['max']:
            base['max'] = base['preferred']
        merged.append(base)
    for s in SIZES_DEFAULT:
        if s['id'] not in seen:
            merged.append(dict(s))

    _save_sizes(instance_id, merged)
    logger.info("TV Hunt sizes updated for instance %s (%d qualities)", instance_id, len(merged))
    return jsonify({'success': True, 'sizes': merged})


@tv_hunt_bp.route('/api/tv-hunt/sizes/reset', methods=['POST'])
def reset_tv_hunt_sizes():
    """Reset TV Hunt sizes to factory defaults for the selected instance."""
    instance_id = _get_tv_hunt_instance_id_from_request()
    if not instance_id:
        return jsonify({'success': False, 'error': 'No instance selected'}), 400
    defaults = [dict(s) for s in SIZES_DEFAULT]
    _save_sizes(instance_id, defaults)
    logger.info("TV Hunt sizes reset to defaults for instance %s", instance_id)
    return jsonify({'success': True, 'sizes': defaults})
