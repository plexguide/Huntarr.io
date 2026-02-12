"""Indexer Hunt — Stats API routes."""

from flask import request, jsonify

from . import indexer_hunt_bp
from ...utils.logger import logger


@indexer_hunt_bp.route('/api/indexer-hunt/stats', methods=['GET'])
def api_ih_stats():
    """Aggregated stats across all indexers."""
    try:
        from src.primary.utils.database import get_database
        db = get_database()
        all_stats = db.get_indexer_hunt_stats()

        # Aggregate
        totals = {'search': 0, 'grab': 0, 'failure': 0, 'test': 0, 'avg_response_ms': 0}
        response_count = 0
        for s in all_stats:
            st = s.get('stat_type', '')
            val = s.get('stat_value', 0)
            if st in totals:
                if st == 'avg_response_ms':
                    totals['avg_response_ms'] += val
                    response_count += 1
                else:
                    totals[st] += int(val)

        if response_count > 0:
            totals['avg_response_ms'] = round(totals['avg_response_ms'] / response_count, 1)

        total_queries = totals['search'] + totals['test']
        failure_rate = 0
        if total_queries > 0:
            failure_rate = round((totals['failure'] / total_queries) * 100, 1)

        return jsonify({
            'total_queries': totals['search'],
            'total_grabs': totals['grab'],
            'total_failures': totals['failure'],
            'avg_response_ms': totals['avg_response_ms'],
            'failure_rate': failure_rate,
        }), 200
    except Exception as e:
        logger.exception('Indexer Hunt stats error')
        return jsonify({'error': str(e)}), 500


@indexer_hunt_bp.route('/api/indexer-hunt/stats/per-indexer', methods=['GET'])
def api_ih_stats_per_indexer():
    """Per-indexer stats breakdown."""
    try:
        from src.primary.utils.database import get_database
        db = get_database()
        indexers = db.get_indexer_hunt_indexers()
        all_stats = db.get_indexer_hunt_stats()

        # Group stats by indexer_id
        by_indexer = {}
        for s in all_stats:
            iid = s.get('indexer_id', '')
            if iid not in by_indexer:
                by_indexer[iid] = {}
            by_indexer[iid][s['stat_type']] = s['stat_value']

        result = []
        for idx in indexers:
            iid = idx['id']
            st = by_indexer.get(iid, {})
            searches = int(st.get('search', 0))
            grabs = int(st.get('grab', 0))
            failures = int(st.get('failure', 0))
            avg_ms = round(st.get('avg_response_ms', 0), 1)
            failure_rate = 0
            if searches > 0:
                failure_rate = round((failures / searches) * 100, 1)
            result.append({
                'id': iid,
                'name': idx.get('name', 'Unnamed'),
                'enabled': idx.get('enabled', True),
                'priority': idx.get('priority', 50),
                'searches': searches,
                'grabs': grabs,
                'failures': failures,
                'avg_response_ms': avg_ms,
                'failure_rate': failure_rate,
            })

        return jsonify({'indexers': result}), 200
    except Exception as e:
        logger.exception('Indexer Hunt per-indexer stats error')
        return jsonify({'indexers': [], 'error': str(e)}), 500
