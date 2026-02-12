"""Indexer Hunt — History API routes."""

from flask import request, jsonify

from . import indexer_hunt_bp
from ...utils.logger import logger


@indexer_hunt_bp.route('/api/indexer-hunt/history', methods=['GET'])
def api_ih_history():
    """Paginated event history with optional filters."""
    try:
        from src.primary.utils.database import get_database
        db = get_database()

        indexer_id = request.args.get('indexer_id')
        event_type = request.args.get('event_type')
        page = request.args.get('page', 1, type=int)
        page_size = request.args.get('page_size', 50, type=int)

        result = db.get_indexer_hunt_history(
            indexer_id=indexer_id,
            event_type=event_type,
            page=page,
            page_size=min(page_size, 200),
        )
        return jsonify(result), 200
    except Exception as e:
        logger.exception('Indexer Hunt history error')
        return jsonify({'items': [], 'total': 0, 'page': 1, 'page_size': 50, 'total_pages': 1, 'error': str(e)}), 200


@indexer_hunt_bp.route('/api/indexer-hunt/history', methods=['DELETE'])
def api_ih_history_clear():
    """Clear all Indexer Hunt history."""
    try:
        from src.primary.utils.database import get_database
        db = get_database()
        with db.get_connection() as conn:
            conn.execute('DELETE FROM indexer_hunt_history')
            conn.execute('DELETE FROM indexer_hunt_stats')
            conn.commit()
        return jsonify({'success': True}), 200
    except Exception as e:
        logger.exception('Indexer Hunt history clear error')
        return jsonify({'success': False, 'error': str(e)}), 500
