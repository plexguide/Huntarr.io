"""Indexer Hunt — Stats API routes (rolling 24-hour window)."""

from flask import request, jsonify

from . import indexer_hunt_bp
from ...utils.logger import logger


@indexer_hunt_bp.route('/api/indexer-hunt/stats', methods=['GET'])
def api_ih_stats():
    """Aggregated stats across all indexers (rolling 24h window)."""
    try:
        from src.primary.utils.database import get_database
        db = get_database()
        stats = db.get_indexer_hunt_stats_24h()

        total_queries = stats['searches']
        failures = stats['failures']
        failure_rate = round((failures / total_queries) * 100, 1) if total_queries > 0 else 0

        return jsonify({
            'total_queries': total_queries,
            'total_grabs': stats['grabs'],
            'total_failures': failures,
            'avg_response_ms': stats['avg_response_ms'],
            'failure_rate': failure_rate,
        }), 200
    except Exception as e:
        logger.exception('Indexer Hunt stats error')
        return jsonify({'error': str(e)}), 500


@indexer_hunt_bp.route('/api/indexer-hunt/stats/per-indexer', methods=['GET'])
def api_ih_stats_per_indexer():
    """Per-indexer stats breakdown (rolling 24h window)."""
    try:
        from src.primary.utils.database import get_database
        db = get_database()
        indexers = db.get_indexer_hunt_indexers()
        per_indexer = db.get_indexer_hunt_stats_24h_per_indexer()

        # Merge with indexer config to include all indexers (even those with 0 activity)
        stats_by_id = {s['id']: s for s in per_indexer}
        result = []
        for idx in indexers:
            iid = idx['id']
            if iid in stats_by_id:
                entry = stats_by_id[iid]
                entry['enabled'] = idx.get('enabled', True)
                entry['priority'] = idx.get('priority', 50)
                entry['name'] = idx.get('name', entry.get('name', 'Unknown'))
                result.append(entry)
            else:
                result.append({
                    'id': iid,
                    'name': idx.get('name', 'Unnamed'),
                    'enabled': idx.get('enabled', True),
                    'priority': idx.get('priority', 50),
                    'searches': 0,
                    'grabs': 0,
                    'failures': 0,
                    'avg_response_ms': 0,
                    'failure_rate': 0,
                })

        return jsonify({'indexers': result}), 200
    except Exception as e:
        logger.exception('Indexer Hunt per-indexer stats error')
        return jsonify({'indexers': [], 'error': str(e)}), 500
