"""
Requestarr Services Routes
Manages which instances (Radarr, Sonarr, Movie Hunt, TV Hunt) are available for requests.
Owner-only endpoints.
"""

from flask import Blueprint, request, jsonify
import logging
from src.primary.utils.database import get_database
from src.primary.auth import get_username_from_session, SESSION_COOKIE_NAME

logger = logging.getLogger(__name__)

requestarr_services_bp = Blueprint('requestarr_services', __name__, url_prefix='/api/requestarr/services')


def _require_owner():
    """Check that the current user is owner."""
    session_token = request.cookies.get(SESSION_COOKIE_NAME)
    username = get_username_from_session(session_token)
    if not username:
        try:
            from src.primary.settings_manager import load_settings
            settings = load_settings("general")
            if settings.get("local_access_bypass") or settings.get("proxy_auth_bypass"):
                db = get_database()
                user = db.get_first_user()
                if user:
                    return user, None
        except Exception:
            pass
        return None, (jsonify({'error': 'Not authenticated'}), 401)
    db = get_database()
    user = db.get_user_by_username(username)
    if not user:
        return None, (jsonify({'error': 'Not authenticated'}), 401)
    # Check requestarr_users role, fallback to owner for main admin
    req_user = db.get_requestarr_user_by_username(username)
    role = (req_user or {}).get('role', 'owner')
    if role != 'owner':
        return None, (jsonify({'error': 'Insufficient permissions'}), 403)
    return user, None


@requestarr_services_bp.route('', methods=['GET'])
def get_services():
    """Get all configured requestarr services."""
    _, err = _require_owner()
    if err:
        return err
    try:
        service_type = request.args.get('type', '').strip()
        db = get_database()
        services = db.get_requestarr_services(service_type or None)
        return jsonify({'services': services})
    except Exception as e:
        logger.error(f"Error getting services: {e}")
        return jsonify({'error': 'Failed to get services'}), 500


@requestarr_services_bp.route('/available', methods=['GET'])
def get_available_instances():
    """Get all available instances that can be added as services.
    Returns Radarr + Movie Hunt instances for movies, Sonarr + TV Hunt for TV.
    """
    _, err = _require_owner()
    if err:
        return err
    try:
        db = get_database()
        from src.primary.settings_manager import load_settings

        result = {'movies': [], 'tv': []}

        # Radarr instances
        try:
            radarr_config = load_settings('radarr')
            for inst in (radarr_config.get('instances') or []):
                name = inst.get('name', '')
                if name and inst.get('url') and inst.get('api_key'):
                    result['movies'].append({
                        'app_type': 'radarr',
                        'instance_name': name,
                        'label': f'Radarr – {name}',
                    })
        except Exception:
            pass

        # Movie Hunt instances
        for inst in (db.get_movie_hunt_instances() or []):
            result['movies'].append({
                'app_type': 'movie_hunt',
                'instance_name': inst.get('name', ''),
                'instance_id': inst.get('id'),
                'label': f'Movie Hunt – {inst.get("name", "")}',
            })

        # Sonarr instances
        try:
            sonarr_config = load_settings('sonarr')
            for inst in (sonarr_config.get('instances') or []):
                name = inst.get('name', '')
                if name and inst.get('url') and inst.get('api_key'):
                    result['tv'].append({
                        'app_type': 'sonarr',
                        'instance_name': name,
                        'label': f'Sonarr – {name}',
                    })
        except Exception:
            pass

        # TV Hunt instances
        for inst in (db.get_tv_hunt_instances() or []):
            result['tv'].append({
                'app_type': 'tv_hunt',
                'instance_name': inst.get('name', ''),
                'instance_id': inst.get('id'),
                'label': f'TV Hunt – {inst.get("name", "")}',
            })

        return jsonify(result)
    except Exception as e:
        logger.error(f"Error getting available instances: {e}")
        return jsonify({'error': 'Failed to get available instances'}), 500


@requestarr_services_bp.route('', methods=['POST'])
def add_service():
    """Add an instance as a requestarr service."""
    _, err = _require_owner()
    if err:
        return err
    try:
        data = request.json or {}
        service_type = data.get('service_type', '').strip()
        app_type = data.get('app_type', '').strip()
        instance_name = data.get('instance_name', '').strip()
        instance_id = data.get('instance_id')
        is_default = data.get('is_default', False)
        is_4k = data.get('is_4k', False)

        if service_type not in ('movies', 'tv'):
            return jsonify({'error': 'service_type must be movies or tv'}), 400
        if not app_type or not instance_name:
            return jsonify({'error': 'app_type and instance_name are required'}), 400

        db = get_database()
        success = db.add_requestarr_service(service_type, app_type, instance_name, instance_id, is_default, is_4k)
        if success:
            services = db.get_requestarr_services(service_type)
            return jsonify({'success': True, 'services': services}), 201
        return jsonify({'error': 'Failed to add service'}), 500
    except Exception as e:
        logger.error(f"Error adding service: {e}")
        return jsonify({'error': 'Failed to add service'}), 500


@requestarr_services_bp.route('/<int:service_id>', methods=['PUT'])
def update_service(service_id):
    """Update a service (toggle default, 4K, enabled)."""
    _, err = _require_owner()
    if err:
        return err
    try:
        data = request.json or {}
        db = get_database()
        success = db.update_requestarr_service(service_id, data)
        if success:
            return jsonify({'success': True})
        return jsonify({'error': 'Failed to update service'}), 500
    except Exception as e:
        logger.error(f"Error updating service: {e}")
        return jsonify({'error': 'Failed to update service'}), 500


@requestarr_services_bp.route('/<int:service_id>', methods=['DELETE'])
def remove_service(service_id):
    """Remove a service."""
    _, err = _require_owner()
    if err:
        return err
    try:
        db = get_database()
        success = db.remove_requestarr_service(service_id)
        if success:
            return jsonify({'success': True})
        return jsonify({'error': 'Failed to remove service'}), 500
    except Exception as e:
        logger.error(f"Error removing service: {e}")
        return jsonify({'error': 'Failed to remove service'}), 500
