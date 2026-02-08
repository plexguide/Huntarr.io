"""Movie Hunt instance management routes (multi-instance)."""

from flask import request, jsonify

from . import movie_hunt_bp
from ...utils.logger import logger


@movie_hunt_bp.route('/api/movie-hunt/instances', methods=['GET'])
def api_movie_hunt_instances_list():
    """List all Movie Hunt instances (id, name, created_at)."""
    try:
        from src.primary.utils.database import get_database
        db = get_database()
        instances = db.get_movie_hunt_instances()
        return jsonify({'instances': instances}), 200
    except Exception as e:
        logger.exception('Movie Hunt instances list error')
        return jsonify({'instances': [], 'error': str(e)}), 200


@movie_hunt_bp.route('/api/movie-hunt/instances', methods=['POST'])
def api_movie_hunt_instances_create():
    """Create a new Movie Hunt instance. Body: { "name": "User-provided name" }."""
    try:
        data = request.get_json() or {}
        name = (data.get('name') or '').strip() or 'Unnamed'
        from src.primary.utils.database import get_database
        db = get_database()
        new_id = db.create_movie_hunt_instance(name)
        instances = db.get_movie_hunt_instances()
        new_instance = next((i for i in instances if i['id'] == new_id), None)
        return jsonify({'instance_id': new_id, 'instance': new_instance}), 201
    except Exception as e:
        logger.exception('Movie Hunt instance create error')
        return jsonify({'error': str(e)}), 500


@movie_hunt_bp.route('/api/movie-hunt/instances/<int:instance_id>', methods=['GET'])
def api_movie_hunt_instance_get(instance_id):
    """Get one Movie Hunt instance by id."""
    try:
        from src.primary.utils.database import get_database
        db = get_database()
        instances = db.get_movie_hunt_instances()
        one = next((i for i in instances if i['id'] == instance_id), None)
        if not one:
            return jsonify({'error': 'Instance not found'}), 404
        return jsonify(one), 200
    except Exception as e:
        logger.exception('Movie Hunt instance get error')
        return jsonify({'error': str(e)}), 500


@movie_hunt_bp.route('/api/movie-hunt/instances/<int:instance_id>', methods=['PATCH'])
def api_movie_hunt_instance_update(instance_id):
    """Rename a Movie Hunt instance. Body: { "name": "New name" }."""
    try:
        data = request.get_json() or {}
        name = (data.get('name') or '').strip() or 'Unnamed'
        from src.primary.utils.database import get_database
        db = get_database()
        if not db.update_movie_hunt_instance(instance_id, name):
            return jsonify({'error': 'Instance not found'}), 404
        instances = db.get_movie_hunt_instances()
        one = next((i for i in instances if i['id'] == instance_id), None)
        return jsonify(one), 200
    except Exception as e:
        logger.exception('Movie Hunt instance update error')
        return jsonify({'error': str(e)}), 500


@movie_hunt_bp.route('/api/movie-hunt/instances/<int:instance_id>', methods=['DELETE'])
def api_movie_hunt_instance_delete(instance_id):
    """Delete a Movie Hunt instance. ID is never reused."""
    try:
        from src.primary.utils.database import get_database
        db = get_database()
        if not db.delete_movie_hunt_instance(instance_id):
            return jsonify({'error': 'Instance not found'}), 404
        return jsonify({'success': True}), 200
    except Exception as e:
        logger.exception('Movie Hunt instance delete error')
        return jsonify({'error': str(e)}), 500


@movie_hunt_bp.route('/api/movie-hunt/current-instance', methods=['GET'])
def api_movie_hunt_current_instance_get():
    """Get current Movie Hunt instance id (server-stored)."""
    try:
        from src.primary.utils.database import get_database
        db = get_database()
        instance_id = db.get_current_movie_hunt_instance_id()
        return jsonify({'instance_id': instance_id}), 200
    except Exception as e:
        logger.exception('Movie Hunt current instance get error')
        return jsonify({'instance_id': 1, 'error': str(e)}), 200


@movie_hunt_bp.route('/api/movie-hunt/current-instance', methods=['POST'])
def api_movie_hunt_current_instance_set():
    """Set current Movie Hunt instance (server-stored). Body: { "instance_id": int }."""
    try:
        data = request.get_json() or {}
        instance_id = data.get('instance_id')
        if instance_id is None:
            return jsonify({'error': 'instance_id required'}), 400
        try:
            instance_id = int(instance_id)
        except (TypeError, ValueError):
            return jsonify({'error': 'instance_id must be an integer'}), 400
        from src.primary.utils.database import get_database
        db = get_database()
        instances = db.get_movie_hunt_instances()
        if not any(i['id'] == instance_id for i in instances):
            return jsonify({'error': 'Instance not found'}), 404
        db.set_current_movie_hunt_instance_id(instance_id)
        return jsonify({'instance_id': instance_id}), 200
    except Exception as e:
        logger.exception('Movie Hunt current instance set error')
        return jsonify({'error': str(e)}), 500
