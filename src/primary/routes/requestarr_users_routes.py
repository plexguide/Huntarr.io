"""
Requestarr User Management Routes
Handles CRUD for local users, role management, and Plex user import.
Admin-only endpoints (role == 'owner' or 'admin').
"""

from flask import Blueprint, request, jsonify
import logging
import secrets
import string
from src.primary.utils.database import get_database
from src.primary.auth import hash_password, verify_password, get_username_from_session, SESSION_COOKIE_NAME

logger = logging.getLogger(__name__)

requestarr_users_bp = Blueprint('requestarr_users', __name__, url_prefix='/api/requestarr/users')


# ── Helpers ──────────────────────────────────────────────────

def _get_current_user():
    """Get the current authenticated user's requestarr profile (with role).
    Falls back to treating the main Huntarr user as 'owner' if they exist
    in the main users table but haven't been synced to requestarr_users yet.
    """
    session_token = request.cookies.get(SESSION_COOKIE_NAME)
    username = get_username_from_session(session_token)
    if not username:
        # Check bypass modes
        try:
            from src.primary.settings_manager import load_settings
            settings = load_settings("general")
            if settings.get("local_access_bypass") or settings.get("proxy_auth_bypass"):
                db = get_database()
                main_user = db.get_first_user()
                if main_user:
                    username = main_user.get('username')
        except Exception:
            pass
    if not username:
        return None
    db = get_database()
    # First try requestarr_users table (has role info)
    req_user = db.get_requestarr_user_by_username(username)
    if req_user:
        return req_user
    # Fallback: main Huntarr user — treat as owner (they are the server admin)
    main_user = db.get_user_by_username(username)
    if main_user:
        main_user['role'] = 'owner'
        return main_user
    return None


def _require_admin():
    """Returns (user_dict, error_response). If error_response is not None, return it."""
    user = _get_current_user()
    if not user:
        return None, (jsonify({'error': 'Not authenticated'}), 401)
    role = user.get('role', 'user')
    if role not in ('owner', 'admin'):
        return None, (jsonify({'error': 'Insufficient permissions'}), 403)
    return user, None


def _sanitize_user(user_dict):
    """Strip sensitive fields before sending to frontend."""
    if not user_dict:
        return None
    safe = {
        'id': user_dict.get('id'),
        'username': user_dict.get('username'),
        'email': user_dict.get('email', ''),
        'role': user_dict.get('role', 'user'),
        'permissions': user_dict.get('permissions', '{}'),
        'created_at': user_dict.get('created_at'),
        'plex_user_data': user_dict.get('plex_user_data'),
        'avatar_url': None,
        'request_count': user_dict.get('request_count', 0),
    }
    # Extract avatar from plex data if available
    if isinstance(safe['plex_user_data'], dict):
        safe['avatar_url'] = safe['plex_user_data'].get('thumb')
    # Parse permissions JSON
    if isinstance(safe['permissions'], str):
        import json
        try:
            safe['permissions'] = json.loads(safe['permissions'])
        except Exception:
            safe['permissions'] = {}
    return safe


# ── Default permissions per role ─────────────────────────────

DEFAULT_PERMISSIONS = {
    'owner': {
        'request_movies': True,
        'request_tv': True,
        'auto_approve': True,
        'auto_approve_movies': True,
        'auto_approve_tv': True,
        'manage_requests': True,
        'manage_users': True,
        'view_requests': True,
        'hide_media_global': True,
    },
    'admin': {
        'request_movies': True,
        'request_tv': True,
        'auto_approve': True,
        'auto_approve_movies': True,
        'auto_approve_tv': True,
        'manage_requests': True,
        'manage_users': True,
        'view_requests': True,
        'hide_media_global': False,
    },
    'user': {
        'request_movies': True,
        'request_tv': True,
        'auto_approve': False,
        'auto_approve_movies': False,
        'auto_approve_tv': False,
        'manage_requests': False,
        'manage_users': False,
        'view_requests': False,
        'hide_media_global': False,
    },
}


# ── Routes ───────────────────────────────────────────────────

@requestarr_users_bp.route('', methods=['GET'])
def list_users():
    """List all users (admin only)."""
    _, err = _require_admin()
    if err:
        return err
    try:
        db = get_database()
        users = db.get_all_requestarr_users()
        return jsonify({'users': [_sanitize_user(u) for u in users]})
    except Exception as e:
        logger.error(f"Error listing users: {e}")
        return jsonify({'error': 'Failed to list users'}), 500


@requestarr_users_bp.route('', methods=['POST'])
def create_user():
    """Create a local user (admin only)."""
    current_user, err = _require_admin()
    if err:
        return err
    try:
        data = request.json or {}
        username = (data.get('username') or '').strip()
        email = (data.get('email') or '').strip()
        password = data.get('password', '')
        role = data.get('role', 'user')

        if not username or len(username) < 3:
            return jsonify({'error': 'Username must be at least 3 characters'}), 400
        if not password or len(password) < 8:
            return jsonify({'error': 'Password must be at least 8 characters'}), 400
        if role not in ('admin', 'user'):
            return jsonify({'error': 'Invalid role. Must be admin or user'}), 400

        # Generate default permissions for the role
        import json
        permissions = json.dumps(DEFAULT_PERMISSIONS.get(role, DEFAULT_PERMISSIONS['user']))

        db = get_database()
        # Check if username already exists in requestarr_users
        existing = db.get_requestarr_user_by_username(username)
        if existing:
            return jsonify({'error': 'Username already exists'}), 409
        # Also check main users table to avoid conflicts
        existing_main = db.get_user_by_username(username)
        if existing_main:
            return jsonify({'error': 'Username already exists'}), 409

        success = db.create_requestarr_user(username, password, email, role, permissions)
        if success:
            logger.info(f"User '{username}' created by '{current_user.get('username')}' with role '{role}'")
            new_user = db.get_requestarr_user_by_username(username)
            return jsonify({'success': True, 'user': _sanitize_user(new_user)}), 201
        return jsonify({'error': 'Failed to create user'}), 500
    except Exception as e:
        logger.error(f"Error creating user: {e}")
        return jsonify({'error': 'Failed to create user'}), 500


@requestarr_users_bp.route('/<int:user_id>', methods=['PUT'])
def update_user(user_id):
    """Update a user (admin only)."""
    current_user, err = _require_admin()
    if err:
        return err
    try:
        data = request.json or {}
        db = get_database()
        target = db.get_requestarr_user_by_id(user_id)
        if not target:
            return jsonify({'error': 'User not found'}), 404

        # Can't change the owner's role
        if target.get('role') == 'owner' and data.get('role') and data['role'] != 'owner':
            return jsonify({'error': 'Cannot change the owner role'}), 403

        updates = {}
        if 'username' in data and data['username'].strip():
            updates['username'] = data['username'].strip()
        if 'email' in data:
            updates['email'] = (data['email'] or '').strip()
        if 'role' in data and data['role'] in ('admin', 'user'):
            if target.get('role') != 'owner':
                updates['role'] = data['role']
        if 'password' in data and data['password']:
            if len(data['password']) < 8:
                return jsonify({'error': 'Password must be at least 8 characters'}), 400
            updates['password'] = hash_password(data['password'])
        if 'permissions' in data and isinstance(data['permissions'], dict):
            import json
            updates['permissions'] = json.dumps(data['permissions'])

        if updates:
            success = db.update_requestarr_user(user_id, updates)
            if not success:
                return jsonify({'error': 'Failed to update user'}), 500

        updated = db.get_requestarr_user_by_id(user_id)
        return jsonify({'success': True, 'user': _sanitize_user(updated)})
    except Exception as e:
        logger.error(f"Error updating user {user_id}: {e}")
        return jsonify({'error': 'Failed to update user'}), 500


@requestarr_users_bp.route('/<int:user_id>', methods=['DELETE'])
def delete_user(user_id):
    """Delete a user (admin only). Cannot delete owner."""
    current_user, err = _require_admin()
    if err:
        return err
    try:
        db = get_database()
        target = db.get_requestarr_user_by_id(user_id)
        if not target:
            return jsonify({'error': 'User not found'}), 404
        if target.get('role') == 'owner':
            return jsonify({'error': 'Cannot delete the owner account'}), 403
        if target.get('id') == current_user.get('id'):
            return jsonify({'error': 'Cannot delete your own account'}), 403

        success = db.delete_requestarr_user(user_id)
        if success:
            logger.info(f"User '{target.get('username')}' deleted by '{current_user.get('username')}'")
            return jsonify({'success': True})
        return jsonify({'error': 'Failed to delete user'}), 500
    except Exception as e:
        logger.error(f"Error deleting user {user_id}: {e}")
        return jsonify({'error': 'Failed to delete user'}), 500


@requestarr_users_bp.route('/me', methods=['GET'])
def get_current_user_info():
    """Get the current user's info (any authenticated user)."""
    user = _get_current_user()
    if not user:
        return jsonify({'error': 'Not authenticated'}), 401
    # Also check if they have a requestarr user record
    db = get_database()
    req_user = db.get_requestarr_user_by_username(user.get('username'))
    if req_user:
        return jsonify({'user': _sanitize_user(req_user)})
    # Return basic info from the main users table
    return jsonify({'user': {
        'id': user.get('id'),
        'username': user.get('username'),
        'role': user.get('role', 'owner'),
        'permissions': DEFAULT_PERMISSIONS.get('owner', {}),
        'created_at': user.get('created_at'),
    }})


@requestarr_users_bp.route('/permissions-template', methods=['GET'])
def get_permissions_template():
    """Get the default permissions for each role."""
    return jsonify(DEFAULT_PERMISSIONS)


@requestarr_users_bp.route('/generate-password', methods=['GET'])
def generate_password():
    """Generate a random secure password."""
    chars = string.ascii_letters + string.digits + '!@#$%'
    pwd = ''.join(secrets.choice(chars) for _ in range(16))
    return jsonify({'password': pwd})


# ── Plex Import ──────────────────────────────────────────────

@requestarr_users_bp.route('/plex/friends', methods=['GET'])
def get_plex_friends():
    """Get Plex friends list for import (admin only). Requires the owner to have linked Plex."""
    _, err = _require_admin()
    if err:
        return err
    try:
        db = get_database()
        # Get the owner's Plex token
        owner = db.get_first_user()
        if not owner or not owner.get('plex_token'):
            return jsonify({'error': 'No Plex account linked. Link your Plex account in User settings first.'}), 400

        import requests as req
        plex_token = owner['plex_token']
        resp = req.get(
            'https://plex.tv/api/v2/friends',
            headers={
                'X-Plex-Token': plex_token,
                'Accept': 'application/json',
            },
            timeout=15
        )
        if resp.status_code != 200:
            return jsonify({'error': f'Plex API returned {resp.status_code}'}), 502

        friends = resp.json()
        result = []
        for f in friends:
            result.append({
                'id': f.get('id'),
                'username': f.get('username') or f.get('title', ''),
                'email': f.get('email', ''),
                'thumb': f.get('thumb', ''),
            })
        return jsonify({'friends': result})
    except Exception as e:
        logger.error(f"Error fetching Plex friends: {e}")
        return jsonify({'error': 'Failed to fetch Plex friends'}), 500


@requestarr_users_bp.route('/plex/import', methods=['POST'])
def import_plex_users():
    """Import selected Plex friends as local users (admin only)."""
    current_user, err = _require_admin()
    if err:
        return err
    try:
        data = request.json or {}
        friend_ids = data.get('friend_ids', [])
        if not friend_ids:
            return jsonify({'error': 'No friends selected'}), 400

        db = get_database()
        owner = db.get_first_user()
        if not owner or not owner.get('plex_token'):
            return jsonify({'error': 'No Plex account linked'}), 400

        import requests as req
        import json
        plex_token = owner['plex_token']
        resp = req.get(
            'https://plex.tv/api/v2/friends',
            headers={'X-Plex-Token': plex_token, 'Accept': 'application/json'},
            timeout=15
        )
        if resp.status_code != 200:
            return jsonify({'error': 'Failed to fetch Plex friends'}), 502

        friends = resp.json()
        friends_map = {f.get('id'): f for f in friends}

        imported = []
        skipped = []
        for fid in friend_ids:
            friend = friends_map.get(fid)
            if not friend:
                skipped.append({'id': fid, 'reason': 'Not found in friends list'})
                continue

            username = friend.get('username') or friend.get('title', f'plex_{fid}')
            email = friend.get('email', '')

            # Check if already exists
            existing = db.get_requestarr_user_by_username(username)
            if existing:
                skipped.append({'id': fid, 'username': username, 'reason': 'Already exists'})
                continue

            # Generate random password (Plex users won't use it directly)
            temp_password = ''.join(secrets.choice(string.ascii_letters + string.digits) for _ in range(24))
            permissions = json.dumps(DEFAULT_PERMISSIONS['user'])
            plex_data = json.dumps({
                'plex_id': friend.get('id'),
                'username': username,
                'email': email,
                'thumb': friend.get('thumb', ''),
            })

            success = db.create_requestarr_user(
                username=username,
                password=temp_password,
                email=email,
                role='user',
                permissions=permissions,
                plex_user_data=plex_data
            )
            if success:
                imported.append(username)
            else:
                skipped.append({'id': fid, 'username': username, 'reason': 'Creation failed'})

        logger.info(f"Plex import by '{current_user.get('username')}': {len(imported)} imported, {len(skipped)} skipped")
        return jsonify({'success': True, 'imported': imported, 'skipped': skipped})
    except Exception as e:
        logger.error(f"Error importing Plex users: {e}")
        return jsonify({'error': 'Failed to import Plex users'}), 500
