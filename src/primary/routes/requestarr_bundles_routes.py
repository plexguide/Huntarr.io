"""
Requestarr Instance Bundles Routes
CRUD for instance bundles — groups of services that cascade requests.
Owner-only endpoints.
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
        primary_service_id = data.get('primary_service_id')
        member_service_ids = data.get('member_service_ids', [])

        if not name:
            return jsonify({'error': 'Bundle name is required'}), 400
        if service_type not in ('movies', 'tv'):
            return jsonify({'error': 'service_type must be movies or tv'}), 400
        if not primary_service_id:
            return jsonify({'error': 'primary_service_id is required'}), 400

        db = get_database()
        bundle_id = db.create_bundle(name, service_type, primary_service_id, member_service_ids)
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
        primary_service_id = data.get('primary_service_id')
        member_service_ids = data.get('member_service_ids')

        success = db.update_bundle(bundle_id, name=name,
                                   primary_service_id=primary_service_id,
                                   member_service_ids=member_service_ids)
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
    """Get bundles formatted for dropdown selectors.
    Any authenticated user can call this.
    Returns: { movie_options: [...], tv_options: [...] }
    Each option: { value: "bundle:<id>", label: "Bundle Name", primary_app_type, primary_instance_name }
    Unbundled instances are also included as standalone options.
    """
    try:
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
                        username = user.get('username')
            except Exception:
                pass
        if not username:
            return jsonify({'error': 'Not authenticated'}), 401

        db = get_database()
        bundles = db.get_bundles()
        services = db.get_requestarr_services()

        # Track which service IDs are used in bundles (as primary)
        bundled_primary_ids = set()
        for b in bundles:
            bundled_primary_ids.add(b['primary_service_id'])

        movie_options = []
        tv_options = []

        # Add bundles first
        for b in bundles:
            primary_svc = next((s for s in services if s['id'] == b['primary_service_id']), None)
            if not primary_svc:
                continue
            opt = {
                'value': f"bundle:{b['id']}",
                'label': b['name'],
                'primary_app_type': primary_svc['app_type'],
                'primary_instance_name': primary_svc['instance_name'],
                'is_bundle': True,
                'bundle_id': b['id'],
            }
            if b['service_type'] == 'movies':
                movie_options.append(opt)
            else:
                tv_options.append(opt)

        # Add unbundled services (not used as primary in any bundle)
        for s in services:
            if s['id'] in bundled_primary_ids:
                continue
            app_label = {'radarr': 'Radarr', 'sonarr': 'Sonarr',
                         'movie_hunt': 'Movie Hunt', 'tv_hunt': 'TV Hunt'}.get(s['app_type'], s['app_type'])
            opt = {
                'value': f"{s['app_type']}:{s['instance_name']}",
                'label': f"{app_label} \u2013 {s['instance_name']}",
                'primary_app_type': s['app_type'],
                'primary_instance_name': s['instance_name'],
                'is_bundle': False,
            }
            if s['service_type'] == 'movies':
                movie_options.append(opt)
            else:
                tv_options.append(opt)

        return jsonify({
            'movie_options': movie_options,
            'tv_options': tv_options,
        })
    except Exception as e:
        logger.error(f"Error getting bundles dropdown: {e}")
        return jsonify({'error': 'Failed to get dropdown options'}), 500
