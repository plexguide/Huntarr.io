"""
Requestarr Instance Bundles Routes
CRUD for instance bundles — groups of instances that cascade requests.
Bundles reference instances by app_type + instance_name directly (no services table dependency).
Owner-only endpoints (except dropdown which is available to all authenticated users).
"""

from flask import Blueprint, request, jsonify
import logging
from src.primary.utils.database import get_database
from src.primary.auth import get_username_from_session, SESSION_COOKIE_NAME

logger = logging.getLogger(__name__)

requestarr_bundles_bp = Blueprint('requestarr_bundles', __name__, url_prefix='/api/requestarr/bundles')


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
    req_user = db.get_requestarr_user_by_username(username)
    role = (req_user or {}).get('role', 'owner')
    if role != 'owner':
        return None, (jsonify({'error': 'Insufficient permissions'}), 403)
    return user, None


def _require_auth():
    """Check that the current user is authenticated (any role)."""
    session_token = request.cookies.get(SESSION_COOKIE_NAME)
    username = get_username_from_session(session_token)
    if not username:
        try:
            from src.primary.settings_manager import load_settings
            settings = load_settings("general")
            if settings.get("local_access_bypass") or settings.get("proxy_auth_bypass"):
                return True, None
        except Exception:
            pass
        return False, (jsonify({'error': 'Not authenticated'}), 401)
    return True, None


def _get_all_available_instances():
    """Discover all known instances from settings/DB. Returns {movies: [...], tv: [...]}."""
    from src.primary.settings_manager import load_settings
    db = get_database()
    result = {'movies': [], 'tv': []}

    # Radarr instances
    try:
        radarr_config = load_settings('radarr')
        for inst in (radarr_config.get('instances') or []):
            name = (inst.get('name') or '').strip()
            if name and inst.get('api_url') and inst.get('api_key'):
                result['movies'].append({'app_type': 'radarr', 'instance_name': name})
    except Exception:
        pass

    # Movie Hunt instances
    for inst in (db.get_movie_hunt_instances() or []):
        name = (inst.get('name') or '').strip()
        if name:
            result['movies'].append({'app_type': 'movie_hunt', 'instance_name': name})

    # Sonarr instances
    try:
        sonarr_config = load_settings('sonarr')
        for inst in (sonarr_config.get('instances') or []):
            name = (inst.get('name') or '').strip()
            if name and inst.get('api_url') and inst.get('api_key'):
                result['tv'].append({'app_type': 'sonarr', 'instance_name': name})
    except Exception:
        pass

    # TV Hunt instances
    for inst in (db.get_tv_hunt_instances() or []):
        name = (inst.get('name') or '').strip()
        if name:
            result['tv'].append({'app_type': 'tv_hunt', 'instance_name': name})

    return result


@requestarr_bundles_bp.route('', methods=['GET'])
def get_bundles():
    """Get all bundles, optionally filtered by ?type=movies|tv."""
    _, err = _require_owner()
    if err:
        return err
    try:
        service_type = request.args.get('type', '').strip() or None
        db = get_database()
        bundles = db.get_bundles(service_type)
        return jsonify({'bundles': bundles})
    except Exception as e:
        logger.error(f"Error getting bundles: {e}")
        return jsonify({'error': 'Failed to get bundles'}), 500


@requestarr_bundles_bp.route('', methods=['POST'])
def create_bundle():
    """Create a new bundle."""
    _, err = _require_owner()
    if err:
        return err
    try:
        data = request.json or {}
        name = (data.get('name') or '').strip()
        service_type = (data.get('service_type') or '').strip()
        primary_app_type = (data.get('primary_app_type') or '').strip()
        primary_instance_name = (data.get('primary_instance_name') or '').strip()
        members = data.get('members', [])

        if not name:
            return jsonify({'error': 'Bundle name is required'}), 400
        if service_type not in ('movies', 'tv'):
            return jsonify({'error': 'service_type must be movies or tv'}), 400
        if not primary_app_type or not primary_instance_name:
            return jsonify({'error': 'primary_app_type and primary_instance_name are required'}), 400

        db = get_database()
        bundle_id = db.create_bundle(name, service_type, primary_app_type, primary_instance_name, members)
        if bundle_id:
            bundle = db.get_bundle_by_id(bundle_id)
            return jsonify({'success': True, 'bundle': bundle}), 201
        return jsonify({'error': 'Failed to create bundle'}), 500
    except Exception as e:
        logger.error(f"Error creating bundle: {e}")
        return jsonify({'error': 'Failed to create bundle'}), 500


@requestarr_bundles_bp.route('/<int:bundle_id>', methods=['PUT'])
def update_bundle(bundle_id):
    """Update a bundle."""
    _, err = _require_owner()
    if err:
        return err
    try:
        data = request.json or {}
        db = get_database()
        name = data.get('name')
        primary_app_type = data.get('primary_app_type')
        primary_instance_name = data.get('primary_instance_name')
        members = data.get('members')

        success = db.update_bundle(bundle_id, name=name,
                                   primary_app_type=primary_app_type,
                                   primary_instance_name=primary_instance_name,
                                   members=members)
        if success:
            bundle = db.get_bundle_by_id(bundle_id)
            return jsonify({'success': True, 'bundle': bundle})
        return jsonify({'error': 'Failed to update bundle'}), 500
    except Exception as e:
        logger.error(f"Error updating bundle: {e}")
        return jsonify({'error': 'Failed to update bundle'}), 500


@requestarr_bundles_bp.route('/<int:bundle_id>', methods=['DELETE'])
def delete_bundle(bundle_id):
    """Delete a bundle."""
    _, err = _require_owner()
    if err:
        return err
    try:
        db = get_database()
        success = db.delete_bundle(bundle_id)
        if success:
            return jsonify({'success': True})
        return jsonify({'error': 'Failed to delete bundle'}), 500
    except Exception as e:
        logger.error(f"Error deleting bundle: {e}")
        return jsonify({'error': 'Failed to delete bundle'}), 500


@requestarr_bundles_bp.route('/dropdown', methods=['GET'])
def get_bundles_dropdown():
    """Get bundles + unbundled instances formatted for dropdown selectors.
    Any authenticated user can call this.
    Returns: { movie_options: [...], tv_options: [...] }
    Bundles first, then unbundled instances.
    """
    _, err = _require_auth()
    if err:
        return err
    try:
        db = get_database()
        bundles = db.get_bundles()
        available = _get_all_available_instances()

        app_labels = {'radarr': 'Radarr', 'sonarr': 'Sonarr',
                      'movie_hunt': 'Movie Hunt', 'tv_hunt': 'TV Hunt'}

        # Track which instances are used as primary in a bundle
        bundled_primaries = set()
        for b in bundles:
            bundled_primaries.add((b['primary_app_type'], b['primary_instance_name']))

        movie_options = []
        tv_options = []

        # Add bundles first
        for b in bundles:
            opt = {
                'value': f"bundle:{b['id']}",
                'label': b['name'],
                'primary_app_type': b['primary_app_type'],
                'primary_instance_name': b['primary_instance_name'],
                'is_bundle': True,
                'bundle_id': b['id'],
            }
            if b['service_type'] == 'movies':
                movie_options.append(opt)
            else:
                tv_options.append(opt)

        # Add unbundled instances
        for inst in available.get('movies', []):
            key = (inst['app_type'], inst['instance_name'])
            if key in bundled_primaries:
                continue
            label = f"{app_labels.get(inst['app_type'], inst['app_type'])} \u2013 {inst['instance_name']}"
            movie_options.append({
                'value': f"{inst['app_type']}:{inst['instance_name']}",
                'label': label,
                'primary_app_type': inst['app_type'],
                'primary_instance_name': inst['instance_name'],
                'is_bundle': False,
            })

        for inst in available.get('tv', []):
            key = (inst['app_type'], inst['instance_name'])
            if key in bundled_primaries:
                continue
            label = f"{app_labels.get(inst['app_type'], inst['app_type'])} \u2013 {inst['instance_name']}"
            tv_options.append({
                'value': f"{inst['app_type']}:{inst['instance_name']}",
                'label': label,
                'primary_app_type': inst['app_type'],
                'primary_instance_name': inst['instance_name'],
                'is_bundle': False,
            })

        return jsonify({
            'movie_options': movie_options,
            'tv_options': tv_options,
        })
    except Exception as e:
        logger.error(f"Error getting bundles dropdown: {e}")
        return jsonify({'error': 'Failed to get dropdown options'}), 500


@requestarr_bundles_bp.route('/available', methods=['GET'])
def get_available_instances():
    """Get all available instances for bundle creation. Owner-only."""
    _, err = _require_owner()
    if err:
        return err
    try:
        available = _get_all_available_instances()
        return jsonify(available)
    except Exception as e:
        logger.error(f"Error getting available instances: {e}")
        return jsonify({'error': 'Failed to get available instances'}), 500