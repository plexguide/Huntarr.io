"""Indexer Hunt — CRUD routes for centralized indexer management."""

import json
import uuid
import time
import requests
import xml.etree.ElementTree as ET

from flask import request, jsonify

from . import indexer_hunt_bp
from ...utils.logger import logger

# Re-use the same presets from Movie Hunt so they stay in sync
from ..media_hunt.indexers import (
    INDEXER_PRESETS, INDEXER_CATEGORIES, INDEXER_DEFAULT_CATEGORIES,
    _validate_newznab_api_key, _resolve_indexer_api_url,
)


def _dedupe_name(name, db, exclude_id=None):
    """Ensure name is unique among Indexer Hunt indexers.
    If a duplicate exists, append -1, -2, etc. until unique.
    ``exclude_id`` lets us skip the indexer being edited so it doesn't conflict with itself."""
    if not name:
        return name
    all_indexers = db.get_indexer_hunt_indexers()
    existing_names = set()
    for idx in all_indexers:
        if exclude_id and idx['id'] == exclude_id:
            continue
        n = (idx.get('name') or idx.get('display_name') or '').strip()
        if n:
            existing_names.add(n.lower())
    if name.strip().lower() not in existing_names:
        return name.strip()
    counter = 1
    while True:
        candidate = f'{name.strip()}-{counter}'
        if candidate.lower() not in existing_names:
            return candidate
        counter += 1


# ── List / Read ─────────────────────────────────────────────────────

@indexer_hunt_bp.route('/api/indexer-hunt/indexers', methods=['GET'])
def api_ih_list():
    """Return all Indexer Hunt indexers (API key masked)."""
    try:
        from src.primary.utils.database import get_database
        db = get_database()
        indexers = db.get_indexer_hunt_indexers()
        out = []
        for idx in indexers:
            key = idx.get('api_key') or ''
            last4 = key[-4:] if len(key) >= 4 else '****'
            out.append({
                'id': idx['id'],
                'name': idx.get('name', 'Unnamed'),
                'display_name': idx.get('display_name', ''),
                'preset': idx.get('preset', 'manual'),
                'protocol': idx.get('protocol', 'usenet'),
                'url': idx.get('url', ''),
                'api_path': idx.get('api_path', '/api'),
                'api_key_last4': last4,
                'enabled': idx.get('enabled', True),
                'priority': idx.get('priority', 50),
                'categories': idx.get('categories', []),
                'created_at': idx.get('created_at', ''),
                'updated_at': idx.get('updated_at', ''),
            })
        return jsonify({'indexers': out}), 200
    except Exception as e:
        logger.exception('Indexer Hunt list error')
        return jsonify({'indexers': [], 'error': str(e)}), 200


# ── Presets ──────────────────────────────────────────────────────────

@indexer_hunt_bp.route('/api/indexer-hunt/presets', methods=['GET'])
def api_ih_presets():
    """Return available indexer presets."""
    presets = []
    for key, info in INDEXER_PRESETS.items():
        cats = info.get('categories', list(INDEXER_DEFAULT_CATEGORIES))
        presets.append({
            'key': key,
            'name': info['name'],
            'url': info['url'],
            'api_path': info.get('api_path', '/api'),
            'categories': cats,
        })
    presets.sort(key=lambda p: p['name'].lower())
    return jsonify({'presets': presets, 'all_categories': INDEXER_CATEGORIES}), 200


# ── Create ───────────────────────────────────────────────────────────

@indexer_hunt_bp.route('/api/indexer-hunt/indexers', methods=['POST'])
def api_ih_add():
    """Add a new centralized indexer."""
    try:
        data = request.get_json() or {}
        preset = (data.get('preset') or 'manual').strip().lower()
        name = (data.get('name') or '').strip()
        protocol = (data.get('protocol') or 'usenet').strip().lower()

        # Resolve URL / api_path from preset if applicable
        url = (data.get('url') or '').strip()
        api_path = (data.get('api_path') or '/api').strip()
        if preset != 'manual' and preset in INDEXER_PRESETS:
            p = INDEXER_PRESETS[preset]
            name = name or p['name']
            url = url or p['url']
            api_path = api_path or p.get('api_path', '/api')

        api_key = (data.get('api_key') or '').strip()
        enabled = data.get('enabled', True)
        priority = data.get('priority', 50)
        try:
            priority = max(1, min(99, int(priority)))
        except (TypeError, ValueError):
            priority = 50
        categories = data.get('categories')
        if not isinstance(categories, list):
            if preset in INDEXER_PRESETS:
                categories = list(INDEXER_PRESETS[preset].get('categories', INDEXER_DEFAULT_CATEGORIES))
            else:
                categories = list(INDEXER_DEFAULT_CATEGORIES)

        from src.primary.utils.database import get_database
        db = get_database()
        name = _dedupe_name(name or 'Unnamed', db)
        idx_id = db.add_indexer_hunt_indexer({
            'name': name,
            'display_name': name,
            'preset': preset,
            'protocol': protocol,
            'url': url,
            'api_path': api_path,
            'api_key': api_key,
            'enabled': enabled,
            'priority': priority,
            'categories': categories,
        })
        return jsonify({'success': True, 'id': idx_id}), 200
    except Exception as e:
        logger.exception('Indexer Hunt add error')
        return jsonify({'success': False, 'error': str(e)}), 500


# ── Update ───────────────────────────────────────────────────────────

@indexer_hunt_bp.route('/api/indexer-hunt/indexers/<idx_id>', methods=['PUT'])
def api_ih_update(idx_id):
    """Update an Indexer Hunt indexer."""
    try:
        from src.primary.utils.database import get_database
        db = get_database()
        existing = db.get_indexer_hunt_indexer(idx_id)
        if not existing:
            return jsonify({'success': False, 'error': 'Indexer not found'}), 404

        data = request.get_json() or {}
        updates = {}

        for field in ['preset', 'protocol', 'url', 'api_path', 'enabled', 'categories']:
            if field in data:
                updates[field] = data[field]
        if 'name' in data:
            raw = (data.get('name') or '').strip()
            updates['name'] = _dedupe_name(raw or 'Unnamed', db, exclude_id=idx_id)
            updates['display_name'] = updates['name']

        # API key: only update if non-empty (front-end sends empty when unchanged)
        api_key_new = (data.get('api_key') or '').strip()
        if api_key_new:
            updates['api_key'] = api_key_new

        if 'priority' in data:
            try:
                updates['priority'] = max(1, min(99, int(data['priority'])))
            except (TypeError, ValueError):
                pass

        db.update_indexer_hunt_indexer(idx_id, updates)

        # Check if API key, enabled, or name changed — those propagate to linked instances
        propagated_fields = {}
        if 'api_key' in updates:
            propagated_fields['api_key'] = updates['api_key']
        if 'enabled' in updates:
            propagated_fields['enabled'] = updates['enabled']
        if 'name' in updates:
            propagated_fields['display_name'] = updates['name']

        linked_count = 0
        if propagated_fields:
            from .sync import _push_edit_to_instances
            linked_count = _push_edit_to_instances(idx_id, propagated_fields)

        return jsonify({'success': True, 'linked_instances_updated': linked_count}), 200
    except Exception as e:
        logger.exception('Indexer Hunt update error')
        return jsonify({'success': False, 'error': str(e)}), 500


# ── Delete ───────────────────────────────────────────────────────────

@indexer_hunt_bp.route('/api/indexer-hunt/indexers/<idx_id>', methods=['DELETE'])
def api_ih_delete(idx_id):
    """Delete an Indexer Hunt indexer and cascade to all linked Movie and TV Hunt instances."""
    try:
        from src.primary.utils.database import get_database
        db = get_database()
        existing = db.get_indexer_hunt_indexer(idx_id)
        if not existing:
            return jsonify({'success': False, 'error': 'Indexer not found'}), 404

        # Cascade delete from all linked instances
        from .sync import _cascade_delete_from_instances
        from .health import remove_cached_status
        removed_count = _cascade_delete_from_instances(idx_id)
        remove_cached_status(idx_id)

        db.delete_indexer_hunt_indexer(idx_id)
        return jsonify({'success': True, 'instances_cleaned': removed_count}), 200
    except Exception as e:
        logger.exception('Indexer Hunt delete error')
        return jsonify({'success': False, 'error': str(e)}), 500


# ── Cached connection status ─────────────────────────────────────────

@indexer_hunt_bp.route('/api/indexer-hunt/status', methods=['GET'])
def api_ih_status():
    """Return cached connection status for all IH indexers (from hourly checks)."""
    try:
        from .health import get_cached_statuses
        return jsonify({'statuses': get_cached_statuses()}), 200
    except Exception as e:
        logger.exception('Indexer Hunt status error')
        return jsonify({'statuses': {}, 'error': str(e)}), 200


# ── Test connection ──────────────────────────────────────────────────

@indexer_hunt_bp.route('/api/indexer-hunt/indexers/<idx_id>/test', methods=['POST'])
def api_ih_test(idx_id):
    """Test connection to an Indexer Hunt indexer (manual Connection Test)."""
    try:
        from src.primary.utils.database import get_database
        from .health import update_cached_status
        db = get_database()
        idx = db.get_indexer_hunt_indexer(idx_id)
        if not idx:
            return jsonify({'valid': False, 'message': 'Indexer not found'}), 404

        base_url = _resolve_indexer_api_url(idx)
        if not base_url:
            update_cached_status(idx_id, 'failed', error_message='No URL configured')
            return jsonify({'valid': False, 'message': 'No URL configured'}), 200

        api_key = idx.get('api_key', '')
        start = time.time()
        valid, err_msg = _validate_newznab_api_key(base_url, api_key)
        elapsed_ms = int((time.time() - start) * 1000)

        # Update the cached status immediately
        status = 'connected' if valid else 'failed'
        update_cached_status(idx_id, status, elapsed_ms, err_msg or '')

        # Record event as 'test' (Connection Test)
        db.record_indexer_hunt_event(
            indexer_id=idx_id,
            indexer_name=idx.get('name', ''),
            event_type='test',
            response_time_ms=elapsed_ms,
            success=valid,
            error_message=err_msg or '',
        )

        if valid:
            return jsonify({'valid': True, 'response_time_ms': elapsed_ms}), 200
        return jsonify({'valid': False, 'message': err_msg or 'Validation failed', 'response_time_ms': elapsed_ms}), 200
    except Exception as e:
        logger.exception('Indexer Hunt test error')
        return jsonify({'valid': False, 'message': str(e)}), 200


# ── Validate (before save — for add/edit forms) ─────────────────────

@indexer_hunt_bp.route('/api/indexer-hunt/validate', methods=['POST'])
def api_ih_validate():
    """Validate an API key for a preset or custom indexer (before saving)."""
    try:
        data = request.get_json() or {}
        preset = (data.get('preset') or 'manual').strip().lower()
        api_key = (data.get('api_key') or '').strip()
        custom_url = (data.get('url') or '').strip()
        api_path = (data.get('api_path') or '/api').strip()

        if preset == 'manual':
            if not custom_url:
                return jsonify({'valid': False, 'message': 'URL is required for custom indexers'}), 200
            base_url = custom_url.rstrip('/') + api_path
        elif preset in INDEXER_PRESETS:
            p = INDEXER_PRESETS[preset]
            base_url = p['url'].rstrip('/') + p.get('api_path', '/api')
        else:
            return jsonify({'valid': False, 'message': 'Unknown preset'}), 400

        valid, err_msg = _validate_newznab_api_key(base_url, api_key)
        if valid:
            return jsonify({'valid': True}), 200
        return jsonify({'valid': False, 'message': err_msg or 'Validation failed'}), 200
    except Exception as e:
        logger.exception('Indexer Hunt validate error')
        return jsonify({'valid': False, 'message': str(e)}), 200
