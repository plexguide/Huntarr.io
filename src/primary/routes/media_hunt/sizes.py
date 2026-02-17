"""
Media Hunt – consolidated size limits (min/preferred/max per quality).
Single module for both Movie Hunt and TV Hunt (both per-instance).
Routes are registered on movie_hunt_bp and tv_hunt_bp via register_*_sizes_routes().
Values are MB per minute of runtime.
"""

from flask import request, jsonify

from ...utils.database import get_database
from ...utils.logger import logger


# Same defaults for both Movie and TV Hunt
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


def get_sizes(instance_id, config_key):
    """
    Return stored sizes list or defaults.
    Both movie_hunt_sizes and tv_hunt_sizes are per-instance.
    """
    db = get_database()
    config = db.get_app_config_for_instance(config_key, instance_id or 0)
    if config and isinstance(config, dict) and 'sizes' in config:
        return config['sizes']
    return [dict(s) for s in SIZES_DEFAULT]


def save_sizes(instance_id, config_key, sizes):
    """Save sizes. Both movie and TV sizes are per-instance."""
    db = get_database()
    db.save_app_config_for_instance(config_key, instance_id or 0, {'sizes': sizes})


def merge_incoming_sizes(incoming):
    """Merge incoming API payload with defaults; return merged list. Validates min <= preferred <= max."""
    if not isinstance(incoming, list):
        return None
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
    return merged


# ---- Route registration (no sizes.py in movie_hunt or tv_hunt) ----

MOVIE_CONFIG = 'movie_hunt_sizes'
TV_CONFIG = 'tv_hunt_sizes'


def register_movie_sizes_routes(bp, get_instance_id):
    """Register /api/sizes GET, PUT, POST reset on the given blueprint (movie_hunt_bp). Per-instance."""
    @bp.route('/api/sizes', methods=['GET'])
    def get_sizes_route():
        instance_id = get_instance_id()
        if not instance_id:
            return jsonify({'success': False, 'error': 'No instance selected'}), 400
        return jsonify({'success': True, 'sizes': get_sizes(instance_id, MOVIE_CONFIG)})

    @bp.route('/api/sizes', methods=['PUT'])
    def update_sizes_route():
        instance_id = get_instance_id()
        if not instance_id:
            return jsonify({'success': False, 'error': 'No instance selected'}), 400
        data = request.get_json(silent=True) or {}
        merged = merge_incoming_sizes(data.get('sizes'))
        if merged is None:
            return jsonify({'success': False, 'error': 'sizes must be a list'}), 400
        save_sizes(instance_id, MOVIE_CONFIG, merged)
        logger.info("Movie Hunt sizes updated for instance %s (%d qualities)", instance_id, len(merged))
        return jsonify({'success': True, 'sizes': merged})

    @bp.route('/api/sizes/reset', methods=['POST'])
    def reset_sizes_route():
        instance_id = get_instance_id()
        if not instance_id:
            return jsonify({'success': False, 'error': 'No instance selected'}), 400
        defaults = [dict(s) for s in SIZES_DEFAULT]
        save_sizes(instance_id, MOVIE_CONFIG, defaults)
        logger.info("Movie Hunt sizes reset to defaults for instance %s", instance_id)
        return jsonify({'success': True, 'sizes': defaults})


def register_tv_sizes_routes(bp, get_instance_id):
    """Register /api/tv-hunt/sizes GET, PUT, POST reset. get_instance_id() must return instance id from request."""
    @bp.route('/api/tv-hunt/sizes', methods=['GET'])
    def get_sizes_route():
        instance_id = get_instance_id()
        if not instance_id:
            return jsonify({'success': False, 'error': 'No instance selected'}), 400
        return jsonify({'success': True, 'sizes': get_sizes(instance_id, TV_CONFIG)})

    @bp.route('/api/tv-hunt/sizes', methods=['PUT'])
    def update_sizes_route():
        instance_id = get_instance_id()
        if not instance_id:
            return jsonify({'success': False, 'error': 'No instance selected'}), 400
        data = request.get_json(silent=True) or {}
        merged = merge_incoming_sizes(data.get('sizes'))
        if merged is None:
            return jsonify({'success': False, 'error': 'sizes must be a list'}), 400
        save_sizes(instance_id, TV_CONFIG, merged)
        logger.info("TV Hunt sizes updated for instance %s (%d qualities)", instance_id, len(merged))
        return jsonify({'success': True, 'sizes': merged})

    @bp.route('/api/tv-hunt/sizes/reset', methods=['POST'])
    def reset_sizes_route():
        instance_id = get_instance_id()
        if not instance_id:
            return jsonify({'success': False, 'error': 'No instance selected'}), 400
        defaults = [dict(s) for s in SIZES_DEFAULT]
        save_sizes(instance_id, TV_CONFIG, defaults)
        logger.info("TV Hunt sizes reset to defaults for instance %s", instance_id)
        return jsonify({'success': True, 'sizes': defaults})
