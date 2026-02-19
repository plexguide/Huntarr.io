"""
Requestarr Request Tracking Routes
Handles media request creation, approval/denial, and listing.
"""

from flask import Blueprint, request, jsonify
import logging
from src.primary.utils.database import get_database
from src.primary.auth import get_username_from_session, SESSION_COOKIE_NAME

logger = logging.getLogger(__name__)

requestarr_requests_bp = Blueprint('requestarr_requests', __name__, url_prefix='/api/requestarr/requests')


def _get_current_user():
    """Get the current authenticated user's requestarr profile."""
    session_token = request.cookies.get(SESSION_COOKIE_NAME)
    username = get_username_from_session(session_token)
    if not username:
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
    req_user = db.get_requestarr_user_by_username(username)
    if req_user:
        return req_user
    main_user = db.get_user_by_username(username)
    if main_user:
        main_user['role'] = 'owner'
        return main_user
    return None


def _require_owner():
    """Returns (user_dict, error_response)."""
    user = _get_current_user()
    if not user:
        return None, (jsonify({'error': 'Not authenticated'}), 401)
    role = user.get('role', 'user')
    if role != 'owner':
        return None, (jsonify({'error': 'Insufficient permissions'}), 403)
    return user, None


def _has_permission(user, perm_key):
    """Check if user has a specific permission."""
    if not user:
        return False
    role = user.get('role', 'user')
    if role == 'owner':
        return True
    perms = user.get('permissions', {})
    if isinstance(perms, str):
        import json
        try:
            perms = json.loads(perms)
        except Exception:
            perms = {}
    return perms.get(perm_key, False)


def _send_request_notification(req_data, action, actor_username=None):
    """Send notification about a request action via the existing notification system."""
    try:
        from src.primary.notification_manager import dispatch_notification
        title_map = {
            'created': 'New Media Request',
            'approved': 'Request Approved',
            'denied': 'Request Denied',
            'auto_approved': 'Request Auto-Approved',
        }
        emoji_map = {
            'created': '📥',
            'approved': '✅',
            'denied': '❌',
            'auto_approved': '✅',
        }
        media_title = req_data.get('title', 'Unknown')
        media_year = req_data.get('year', '')
        media_type = req_data.get('media_type', 'movie').capitalize()
        requester = req_data.get('username', 'Unknown')

        title = f"{emoji_map.get(action, '📋')} {title_map.get(action, 'Request Update')}"
        if action == 'created':
            message = f"{requester} requested {media_type}: {media_title} ({media_year})"
        elif action == 'approved':
            message = f"{media_type}: {media_title} ({media_year}) was approved by {actor_username or 'admin'}"
        elif action == 'denied':
            message = f"{media_type}: {media_title} ({media_year}) was denied by {actor_username or 'admin'}"
            if req_data.get('notes'):
                message += f"\nReason: {req_data['notes']}"
        elif action == 'auto_approved':
            message = f"{media_type}: {media_title} ({media_year}) was auto-approved for {requester}"
        else:
            message = f"Request update for {media_type}: {media_title} ({media_year})"

        dispatch_notification('request', title, message)
    except Exception as e:
        logger.debug(f"Could not send request notification: {e}")


# ── Routes ───────────────────────────────────────────────────

@requestarr_requests_bp.route('', methods=['GET'])
def list_requests():
    """List requests. Admins see all, users see only their own."""
    user = _get_current_user()
    if not user:
        return jsonify({'error': 'Not authenticated'}), 401

    status_filter = request.args.get('status', '').strip() or None
    media_type = request.args.get('media_type', '').strip() or None
    limit = min(int(request.args.get('limit', 100)), 500)
    offset = int(request.args.get('offset', 0))

    db = get_database()
    role = user.get('role', 'user')
    can_view_all = role == 'owner' or _has_permission(user, 'view_requests')

    user_id_filter = None if can_view_all else user.get('id')
    requests_list = db.get_requestarr_requests(
        status=status_filter, user_id=user_id_filter,
        media_type=media_type, limit=limit, offset=offset
    )
    total = db.get_requestarr_request_count(user_id=user_id_filter, status=status_filter)
    return jsonify({'requests': requests_list, 'total': total})


@requestarr_requests_bp.route('', methods=['POST'])
def create_request():
    """Create a new media request."""
    user = _get_current_user()
    if not user:
        return jsonify({'error': 'Not authenticated'}), 401

    data = request.json or {}
    media_type = (data.get('media_type') or '').strip()
    tmdb_id = data.get('tmdb_id')
    title = (data.get('title') or '').strip()

    if media_type not in ('movie', 'tv'):
        return jsonify({'error': 'media_type must be movie or tv'}), 400
    if not tmdb_id or not title:
        return jsonify({'error': 'tmdb_id and title are required'}), 400

    perm_key = 'request_movies' if media_type == 'movie' else 'request_tv'
    if not _has_permission(user, perm_key):
        return jsonify({'error': f'You do not have permission to request {media_type}'}), 403

    db = get_database()

    # Check for existing request
    existing = db.check_existing_request(media_type, tmdb_id)
    if existing and existing.get('status') in ('pending', 'approved'):
        return jsonify({'error': 'This media has already been requested', 'existing': existing}), 409

    # Check auto-approve
    auto_approve_key = 'auto_approve_movies' if media_type == 'movie' else 'auto_approve_tv'
    auto_approve = _has_permission(user, 'auto_approve') or _has_permission(user, auto_approve_key)
    status = 'approved' if auto_approve else 'pending'

    request_id = db.create_requestarr_request(
        user_id=user.get('id', 0),
        username=user.get('username', ''),
        media_type=media_type,
        tmdb_id=tmdb_id,
        title=title,
        year=data.get('year', ''),
        poster_path=data.get('poster_path', ''),
        tvdb_id=data.get('tvdb_id'),
        instance_name=data.get('instance_name', ''),
        status=status,
    )

    if request_id:
        # Increment user's request count
        try:
            user_id = user.get('id')
            if user_id:
                current_count = user.get('request_count', 0) or 0
                db.update_requestarr_user(user_id, {'request_count': current_count + 1})
        except Exception:
            pass

        req_data = db.get_requestarr_request_by_id(request_id)
        action = 'auto_approved' if auto_approve else 'created'
        _send_request_notification(req_data or data, action)
        return jsonify({'success': True, 'request': req_data, 'auto_approved': auto_approve}), 201

    return jsonify({'error': 'Failed to create request'}), 500


@requestarr_requests_bp.route('/<int:request_id>/approve', methods=['POST'])
def approve_request(request_id):
    """Approve a pending request (admin only)."""
    current_user, err = _require_owner()
    if err:
        return err
    db = get_database()
    req = db.get_requestarr_request_by_id(request_id)
    if not req:
        return jsonify({'error': 'Request not found'}), 404

    success = db.update_requestarr_request_status(
        request_id, 'approved',
        responded_by=current_user.get('username', ''),
        notes=request.json.get('notes', '') if request.json else ''
    )
    if success:
        req['status'] = 'approved'
        req['notes'] = (request.json or {}).get('notes', '')
        _send_request_notification(req, 'approved', current_user.get('username'))
        updated = db.get_requestarr_request_by_id(request_id)
        return jsonify({'success': True, 'request': updated})
    return jsonify({'error': 'Failed to approve request'}), 500


@requestarr_requests_bp.route('/<int:request_id>/deny', methods=['POST'])
def deny_request(request_id):
    """Deny a pending request (admin only)."""
    current_user, err = _require_owner()
    if err:
        return err
    db = get_database()
    req = db.get_requestarr_request_by_id(request_id)
    if not req:
        return jsonify({'error': 'Request not found'}), 404

    notes = (request.json or {}).get('notes', '')
    success = db.update_requestarr_request_status(
        request_id, 'denied',
        responded_by=current_user.get('username', ''),
        notes=notes
    )
    if success:
        req['status'] = 'denied'
        req['notes'] = notes
        _send_request_notification(req, 'denied', current_user.get('username'))
        updated = db.get_requestarr_request_by_id(request_id)
        return jsonify({'success': True, 'request': updated})
    return jsonify({'error': 'Failed to deny request'}), 500


@requestarr_requests_bp.route('/<int:request_id>', methods=['DELETE'])
def delete_request(request_id):
    """Delete a request. Admins can delete any, users can delete their own pending requests."""
    user = _get_current_user()
    if not user:
        return jsonify({'error': 'Not authenticated'}), 401

    db = get_database()
    req = db.get_requestarr_request_by_id(request_id)
    if not req:
        return jsonify({'error': 'Request not found'}), 404

    role = user.get('role', 'user')
    is_owner = role == 'owner'
    is_own = req.get('user_id') == user.get('id')

    if not is_owner and not (is_own and req.get('status') == 'pending'):
        return jsonify({'error': 'Cannot delete this request'}), 403

    if db.delete_requestarr_request(request_id):
        return jsonify({'success': True})
    return jsonify({'error': 'Failed to delete request'}), 500


@requestarr_requests_bp.route('/check/<media_type>/<int:tmdb_id>', methods=['GET'])
def check_request(media_type, tmdb_id):
    """Check if a request exists for a given media item."""
    db = get_database()
    existing = db.check_existing_request(media_type, tmdb_id)
    return jsonify({'exists': existing is not None, 'request': existing})


@requestarr_requests_bp.route('/pending-count', methods=['GET'])
def pending_count():
    """Get count of pending requests (lightweight endpoint for badge)."""
    user = _get_current_user()
    if not user:
        return jsonify({'count': 0})
    role = user.get('role', 'user')
    can_view = role == 'owner' or _has_permission(user, 'manage_requests')
    if not can_view:
        return jsonify({'count': 0})
    db = get_database()
    count = db.get_requestarr_request_count(status='pending')
    return jsonify({'count': count})
