"""Indexer Hunt — Sync logic between Indexer Hunt (global) and Movie Hunt instances."""

import json
from flask import request, jsonify

from . import indexer_hunt_bp
from ...utils.logger import logger


def _get_all_movie_hunt_instance_ids():
    """Return list of all Movie Hunt instance IDs."""
    from src.primary.utils.database import get_database
    db = get_database()
    try:
        with db.get_connection() as conn:
            rows = conn.execute('SELECT id FROM movie_hunt_instances ORDER BY id').fetchall()
            return [r[0] for r in rows]
    except Exception:
        return [1]  # fallback to legacy single instance


def _get_indexers_for_instance(instance_id):
    """Get Movie Hunt indexer list for an instance."""
    from src.primary.routes.movie_hunt.indexers import _get_indexers_config
    return _get_indexers_config(instance_id)


def _save_indexers_for_instance(indexers_list, instance_id):
    """Save Movie Hunt indexer list for an instance."""
    from src.primary.routes.movie_hunt.indexers import _save_indexers_list
    _save_indexers_list(indexers_list, instance_id)


def _push_edit_to_instances(indexer_hunt_id, changes):
    """Push API key / enabled changes to all linked Movie Hunt instances.
    Returns count of instances updated."""
    count = 0
    for inst_id in _get_all_movie_hunt_instance_ids():
        indexers = _get_indexers_for_instance(inst_id)
        modified = False
        for idx in indexers:
            if idx.get('indexer_hunt_id') == indexer_hunt_id:
                for k, v in changes.items():
                    idx[k] = v
                modified = True
        if modified:
            _save_indexers_for_instance(indexers, inst_id)
            count += 1
    return count


def _cascade_delete_from_instances(indexer_hunt_id):
    """Delete all Movie Hunt indexers linked to this Indexer Hunt id.
    Returns count of instances affected."""
    count = 0
    for inst_id in _get_all_movie_hunt_instance_ids():
        indexers = _get_indexers_for_instance(inst_id)
        before = len(indexers)
        indexers = [idx for idx in indexers if idx.get('indexer_hunt_id') != indexer_hunt_id]
        if len(indexers) < before:
            _save_indexers_for_instance(indexers, inst_id)
            count += 1
    return count


def _read_instance_priorities(indexer_hunt_id):
    """Read current priority values from Movie Hunt instances for an Indexer Hunt indexer.
    Returns list of {instance_id, instance_name, priority}."""
    results = []
    from src.primary.utils.database import get_database
    db = get_database()
    for inst_id in _get_all_movie_hunt_instance_ids():
        indexers = _get_indexers_for_instance(inst_id)
        for idx in indexers:
            if idx.get('indexer_hunt_id') == indexer_hunt_id:
                # Get instance name
                inst_name = f'Instance {inst_id}'
                try:
                    with db.get_connection() as conn:
                        row = conn.execute('SELECT name FROM movie_hunt_instances WHERE id = ?', (inst_id,)).fetchone()
                        if row:
                            inst_name = row[0]
                except Exception:
                    pass
                results.append({
                    'instance_id': inst_id,
                    'instance_name': inst_name,
                    'priority': idx.get('priority', 50),
                })
    return results


# ── API Routes ───────────────────────────────────────────────────────

@indexer_hunt_bp.route('/api/indexer-hunt/sync', methods=['POST'])
def api_ih_sync():
    """Sync selected Indexer Hunt indexers to a Movie Hunt instance.
    Body: { instance_id: int, indexer_ids: [str, ...] }
    Copies: priority, default categories, API key, name, URL, api_path, enabled.
    """
    try:
        data = request.get_json() or {}
        instance_id = data.get('instance_id')
        indexer_ids = data.get('indexer_ids', [])

        if instance_id is None:
            return jsonify({'success': False, 'error': 'instance_id is required'}), 400
        if not isinstance(indexer_ids, list) or not indexer_ids:
            return jsonify({'success': False, 'error': 'indexer_ids list is required'}), 400

        instance_id = int(instance_id)

        from src.primary.utils.database import get_database
        from src.primary.routes.movie_hunt.indexers import INDEXER_PRESETS, INDEXER_DEFAULT_CATEGORIES
        db = get_database()

        existing = _get_indexers_for_instance(instance_id)
        existing_ih_ids = {idx.get('indexer_hunt_id') for idx in existing if idx.get('indexer_hunt_id')}

        added = 0
        for ih_id in indexer_ids:
            if ih_id in existing_ih_ids:
                continue  # already synced
            ih_idx = db.get_indexer_hunt_indexer(ih_id)
            if not ih_idx:
                continue

            # Determine default categories from preset
            preset = ih_idx.get('preset', 'manual')
            if preset in INDEXER_PRESETS:
                default_cats = list(INDEXER_PRESETS[preset].get('categories', INDEXER_DEFAULT_CATEGORIES))
            else:
                default_cats = list(ih_idx.get('categories', INDEXER_DEFAULT_CATEGORIES))

            existing.append({
                'name': ih_idx.get('name', 'Unnamed'),
                'display_name': ih_idx.get('display_name', ''),
                'preset': preset,
                'api_key': ih_idx.get('api_key', ''),
                'enabled': ih_idx.get('enabled', True),
                'categories': default_cats,
                'url': ih_idx.get('url', ''),
                'api_path': ih_idx.get('api_path', '/api'),
                'priority': ih_idx.get('priority', 50),
                'indexer_hunt_id': ih_id,
            })
            added += 1

        if added > 0:
            _save_indexers_for_instance(existing, instance_id)

        return jsonify({'success': True, 'added': added}), 200
    except Exception as e:
        logger.exception('Indexer Hunt sync error')
        return jsonify({'success': False, 'error': str(e)}), 500


@indexer_hunt_bp.route('/api/indexer-hunt/linked-instances/<idx_id>', methods=['GET'])
def api_ih_linked(idx_id):
    """Return which Movie Hunt instances use this Indexer Hunt indexer."""
    try:
        priorities = _read_instance_priorities(idx_id)
        return jsonify({'linked': priorities}), 200
    except Exception as e:
        logger.exception('Indexer Hunt linked instances error')
        return jsonify({'linked': [], 'error': str(e)}), 200


@indexer_hunt_bp.route('/api/indexer-hunt/available/<int:instance_id>', methods=['GET'])
def api_ih_available(instance_id):
    """Return Indexer Hunt indexers not yet synced to this Movie Hunt instance."""
    try:
        from src.primary.utils.database import get_database
        db = get_database()
        all_ih = db.get_indexer_hunt_indexers()
        existing = _get_indexers_for_instance(instance_id)
        existing_ih_ids = {idx.get('indexer_hunt_id') for idx in existing if idx.get('indexer_hunt_id')}

        available = []
        for idx in all_ih:
            if idx['id'] not in existing_ih_ids and idx.get('enabled', True):
                key = idx.get('api_key') or ''
                last4 = key[-4:] if len(key) >= 4 else '****'
                available.append({
                    'id': idx['id'],
                    'name': idx.get('name', 'Unnamed'),
                    'preset': idx.get('preset', 'manual'),
                    'protocol': idx.get('protocol', 'usenet'),
                    'priority': idx.get('priority', 50),
                    'api_key_last4': last4,
                    'url': idx.get('url', ''),
                })
        return jsonify({'available': available}), 200
    except Exception as e:
        logger.exception('Indexer Hunt available error')
        return jsonify({'available': [], 'error': str(e)}), 200
