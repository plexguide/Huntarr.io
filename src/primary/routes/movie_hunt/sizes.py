"""Movie Hunt size definitions routes – min / preferred / max per quality tier."""

import json

from flask import request, jsonify

from . import movie_hunt_bp
from ...utils.logger import logger
from ...utils.database import HuntarrDatabase


# ---------------------------------------------------------------------------
# Defaults – grouped by resolution tier for clarity.
# Values are in **megabytes per minute** of runtime.
# Radarr-style limits with sensible real-world defaults.
# ---------------------------------------------------------------------------

SIZES_DEFAULT = [
    # --- Low quality / legacy ---
    {'id': 'unknown',    'name': 'Unknown',     'group': 'Low Quality',  'min': 0,  'preferred': 75,  'max': 100},
    {'id': 'workprint',  'name': 'WORKPRINT',   'group': 'Low Quality',  'min': 0,  'preferred': 75,  'max': 100},
    {'id': 'cam',        'name': 'CAM',         'group': 'Low Quality',  'min': 0,  'preferred': 75,  'max': 100},
    {'id': 'telesync',   'name': 'TELESYNC',    'group': 'Low Quality',  'min': 0,  'preferred': 75,  'max': 100},
    {'id': 'telecine',   'name': 'TELECINE',    'group': 'Low Quality',  'min': 0,  'preferred': 75,  'max': 100},
    {'id': 'regional',   'name': 'REGIONAL',    'group': 'Low Quality',  'min': 0,  'preferred': 75,  'max': 100},
    {'id': 'dvdscr',     'name': 'DVDSCR',      'group': 'Low Quality',  'min': 0,  'preferred': 75,  'max': 100},

    # --- SD ---
    {'id': 'sdtv',       'name': 'SDTV',        'group': 'SD',  'min': 0,  'preferred': 20,  'max': 40},
    {'id': 'dvd',        'name': 'DVD',          'group': 'SD',  'min': 0,  'preferred': 20,  'max': 40},

    # --- 720p ---
    {'id': 'hdtv720',    'name': 'HDTV-720p',   'group': '720p',  'min': 0,  'preferred': 30,  'max': 60},
    {'id': 'web720',     'name': 'WEB 720p',     'group': '720p',  'min': 0,  'preferred': 30,  'max': 60},
    {'id': 'bluray720',  'name': 'Bluray-720p',  'group': '720p',  'min': 0,  'preferred': 30,  'max': 60},

    # --- 1080p ---
    {'id': 'hdtv1080',   'name': 'HDTV-1080p',   'group': '1080p',  'min': 0,  'preferred': 75,  'max': 150},
    {'id': 'web1080',    'name': 'WEB 1080p',     'group': '1080p',  'min': 0,  'preferred': 75,  'max': 150},
    {'id': 'bluray1080', 'name': 'Bluray-1080p',  'group': '1080p',  'min': 0,  'preferred': 75,  'max': 150},
    {'id': 'remux1080',  'name': 'Remux-1080p',   'group': '1080p',  'min': 0,  'preferred': 75,  'max': 150},

    # --- 2160p ---
    {'id': 'hdtv2160',   'name': 'HDTV-2160p',   'group': '2160p',  'min': 0,  'preferred': 100,  'max': 200},
    {'id': 'web2160',    'name': 'WEB 2160p',     'group': '2160p',  'min': 0,  'preferred': 100,  'max': 200},
    {'id': 'bluray2160', 'name': 'Bluray-2160p',  'group': '2160p',  'min': 0,  'preferred': 100,  'max': 200},
    {'id': 'remux2160',  'name': 'Remux-2160p',   'group': '2160p',  'min': 0,  'preferred': 100,  'max': 200},

    # --- Ultra-high ---
    {'id': 'brdisk',     'name': 'BR-DISK',  'group': 'Ultra',  'min': 0,  'preferred': 100,  'max': 200},
    {'id': 'rawhd',      'name': 'Raw-HD',   'group': 'Ultra',  'min': 0,  'preferred': 100,  'max': 200},
]


def _get_sizes():
    """Return stored sizes list or defaults."""
    db = HuntarrDatabase()
    config = db.get_app_config('movie_hunt_sizes')
    if config and isinstance(config, dict) and 'sizes' in config:
        return config['sizes']
    return [dict(s) for s in SIZES_DEFAULT]


def _save_sizes(sizes):
    db = HuntarrDatabase()
    db.save_app_config('movie_hunt_sizes', {'sizes': sizes})


# ---- Routes ---------------------------------------------------------------

@movie_hunt_bp.route('/api/sizes', methods=['GET'])
def get_sizes():
    """Return the current quality-size definitions."""
    return jsonify({'success': True, 'sizes': _get_sizes()})


@movie_hunt_bp.route('/api/sizes', methods=['PUT'])
def update_sizes():
    """Bulk-update size definitions."""
    data = request.get_json(silent=True) or {}
    incoming = data.get('sizes')
    if not isinstance(incoming, list):
        return jsonify({'success': False, 'error': 'sizes must be a list'}), 400

    # Merge incoming with defaults so we always have every quality.
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
        # Ensure min <= preferred <= max
        if base['min'] > base['preferred']:
            base['preferred'] = base['min']
        if base['preferred'] > base['max']:
            base['max'] = base['preferred']
        merged.append(base)
    # Append any missing defaults
    for s in SIZES_DEFAULT:
        if s['id'] not in seen:
            merged.append(dict(s))

    _save_sizes(merged)
    logger.info("Movie Hunt sizes updated (%d qualities)", len(merged))
    return jsonify({'success': True, 'sizes': merged})


@movie_hunt_bp.route('/api/sizes/reset', methods=['POST'])
def reset_sizes():
    """Reset to factory defaults."""
    defaults = [dict(s) for s in SIZES_DEFAULT]
    _save_sizes(defaults)
    logger.info("Movie Hunt sizes reset to defaults")
    return jsonify({'success': True, 'sizes': defaults})
