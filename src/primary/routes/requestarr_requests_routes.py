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

    # For owner: enrich each request with all requesters for that media item
    if can_view_all:
        for req in requests_list:
            requesters = db.get_requesters_for_media(req.get('media_type', ''), req.get('tmdb_id', 0))
            # Filter out the primary requester to show "also requested by" list
            req['all_requesters'] = requesters

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

    # Block if globally blacklisted — even auto-approve users cannot request
    if db.is_globally_blacklisted(tmdb_id, media_type):
        return jsonify({'error': 'This media is on the global blacklist and cannot be requested'}), 403

    # Check for existing request — denied requests CAN be re-requested by other users
    existing = db.check_existing_request(media_type, tmdb_id)
    if existing and existing.get('status') in ('pending', 'approved'):
        return jsonify({'error': 'This media has already been requested', 'existing': existing}), 409
    if existing and existing.get('status') == 'denied' and existing.get('user_id') == user.get('id'):
        return jsonify({'error': 'Your request for this media was denied', 'existing': existing}), 409

    # If a withdrawn request exists, delete it so a fresh one can be created
    if existing and existing.get('status') == 'withdrawn':
        db.delete_requestarr_request(existing['id'])

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
        app_type=data.get('app_type', ''),
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
    """Approve a pending request and trigger the search/download pipeline."""
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
    if not success:
        return jsonify({'error': 'Failed to approve request'}), 500

    req['status'] = 'approved'
    req['notes'] = (request.json or {}).get('notes', '')
    _send_request_notification(req, 'approved', current_user.get('username'))

    # Trigger the actual search/download pipeline now that the request is approved
    media_result = None
    try:
        from src.primary.apps.requestarr import requestarr_api

        instance_name = req.get('instance_name', '')
        media_type = req.get('media_type', 'movie')
        tmdb_id = req.get('tmdb_id')
        app_type = req.get('app_type', '').strip()

        # If app_type not stored on the request, resolve from services table
        if not app_type:
            svc_type = 'tv' if media_type == 'tv' else 'movies'
            all_svcs = db.get_requestarr_services(svc_type)
            matched_svc = next((s for s in all_svcs if s.get('instance_name') == instance_name), None)
            if not matched_svc:
                matched_svc = next((s for s in all_svcs if s.get('is_default')), None)
            if not matched_svc and all_svcs:
                matched_svc = all_svcs[0]
            if matched_svc:
                app_type = matched_svc.get('app_type', '')
                instance_name = matched_svc.get('instance_name', instance_name)

        if not app_type:
            app_type = 'radarr' if media_type == 'movie' else 'sonarr'

        # Resolve default quality profile and root folder for the instance
        default_quality_profile = None
        default_root_folder = None
        try:
            if app_type in ('movie_hunt', 'tv_hunt'):
                # Resolve instance ID for Hunt apps
                if app_type == 'movie_hunt':
                    inst_id = requestarr_api._resolve_movie_hunt_instance_id(instance_name)
                else:
                    inst_id = requestarr_api._resolve_tv_hunt_instance_id(instance_name)

                if inst_id is not None:
                    # Get default quality profile
                    profiles = requestarr_api.get_quality_profiles(app_type, instance_name)
                    default_prof = next((p for p in profiles if p.get('is_default')), None)
                    if default_prof:
                        default_quality_profile = default_prof.get('name') or default_prof.get('id')
                    elif profiles:
                        default_quality_profile = profiles[0].get('name') or profiles[0].get('id')

                    # Get default root folder
                    root_folders = requestarr_api.get_root_folders(app_type, instance_name)
                    default_rf = next((rf for rf in root_folders if rf.get('is_default')), None)
                    if default_rf:
                        default_root_folder = default_rf.get('path')
                    elif root_folders:
                        default_root_folder = root_folders[0].get('path')
            else:
                # Radarr/Sonarr: get root folders and quality profiles from the instance
                root_folders = requestarr_api.get_root_folders(app_type, instance_name)
                if root_folders:
                    default_root_folder = root_folders[0].get('path')
                profiles = requestarr_api.get_quality_profiles(app_type, instance_name)
                if profiles:
                    default_quality_profile = profiles[0].get('id')
        except Exception as defaults_err:
            logger.warning(f"[Requestarr] Could not resolve defaults for {app_type}/{instance_name}: {defaults_err}")

        if tmdb_id:
            # Build kwargs with proper defaults for each app type
            request_kwargs = dict(
                tmdb_id=tmdb_id,
                media_type=media_type,
                title=req.get('title', ''),
                year=req.get('year'),
                overview='',
                poster_path=req.get('poster_path', ''),
                backdrop_path='',
                app_type=app_type,
                instance_name=instance_name,
                start_search=True,
                minimum_availability='released',
                root_folder_path=default_root_folder,
                skip_tracking=True,
            )

            if app_type in ('movie_hunt', 'tv_hunt'):
                request_kwargs['quality_profile_name'] = default_quality_profile
            else:
                request_kwargs['quality_profile_id'] = default_quality_profile

            # Set monitor defaults per media type
            if media_type == 'tv':
                request_kwargs['monitor'] = 'all_episodes'
            else:
                request_kwargs['movie_monitor'] = 'movie_only'

            media_result = requestarr_api.request_media(**request_kwargs)
            logger.info(f"[Requestarr] Approve triggered search for request {request_id}: {media_result}")
        else:
            logger.warning(f"[Requestarr] No tmdb_id for approved request {request_id}")
    except Exception as e:
        logger.error(f"[Requestarr] Error triggering search for approved request {request_id}: {e}", exc_info=True)

    updated = db.get_requestarr_request_by_id(request_id)
    resp = {'success': True, 'request': updated}
    if media_result:
        resp['media_result'] = media_result
    return jsonify(resp)


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


@requestarr_requests_bp.route('/<int:request_id>/withdraw', methods=['POST'])
def withdraw_request(request_id):
    """Withdraw a pending request. Users can only withdraw their own pending requests."""
    user = _get_current_user()
    if not user:
        return jsonify({'error': 'Not authenticated'}), 401

    db = get_database()
    req = db.get_requestarr_request_by_id(request_id)
    if not req:
        return jsonify({'error': 'Request not found'}), 404

    if req.get('status') != 'pending':
        return jsonify({'error': 'Only pending requests can be withdrawn'}), 400

    # Users can only withdraw their own requests
    role = user.get('role', 'user')
    if role != 'owner' and req.get('user_id') != user.get('id'):
        return jsonify({'error': 'You can only withdraw your own requests'}), 403

    success = db.update_requestarr_request_status(
        request_id, 'withdrawn',
        responded_by=user.get('username', ''),
        notes='Withdrawn by requester'
    )
    if success:
        updated = db.get_requestarr_request_by_id(request_id)
        return jsonify({'success': True, 'request': updated})
    return jsonify({'error': 'Failed to withdraw request'}), 500


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


# ── Blacklist Routes ─────────────────────────────────────────

@requestarr_requests_bp.route('/<int:request_id>/blacklist', methods=['POST'])
def blacklist_request(request_id):
    """Blacklist a request — sets status to 'blacklisted' and adds to global blacklist."""
    current_user, err = _require_owner()
    if err:
        return err
    db = get_database()
    req = db.get_requestarr_request_by_id(request_id)
    if not req:
        return jsonify({'error': 'Request not found'}), 404

    notes = (request.json or {}).get('notes', '')

    # Update request status to blacklisted
    db.update_requestarr_request_status(
        request_id, 'blacklisted',
        responded_by=current_user.get('username', ''),
        notes=notes
    )

    # Add to global blacklist
    db.add_to_global_blacklist(
        tmdb_id=req.get('tmdb_id'),
        media_type=req.get('media_type'),
        title=req.get('title', ''),
        year=req.get('year', ''),
        poster_path=req.get('poster_path', ''),
        blacklisted_by=current_user.get('username', ''),
        notes=notes
    )

    updated = db.get_requestarr_request_by_id(request_id)
    return jsonify({'success': True, 'request': updated})


# ── Global Blacklist CRUD ────────────────────────────────────

@requestarr_requests_bp.route('/global-blacklist', methods=['GET'])
def get_global_blacklist():
    """Get paginated global blacklist. Owner only."""
    current_user, err = _require_owner()
    if err:
        return err
    media_type = request.args.get('media_type', '').strip() or None
    page = int(request.args.get('page', 1))
    page_size = int(request.args.get('page_size', 100))
    search = request.args.get('search', '').strip()

    db = get_database()
    result = db.get_global_blacklist(media_type=media_type, page=page, page_size=page_size)

    items = result.get('items', [])
    # Client-side search filter
    if search:
        search_lower = search.lower()
        items = [i for i in items if search_lower in (i.get('title', '') or '').lower()]

    return jsonify({
        'items': items,
        'total': len(items) if search else result.get('total', 0),
        'page': page,
        'page_size': page_size
    })


@requestarr_requests_bp.route('/global-blacklist/<int:tmdb_id>/<media_type>', methods=['DELETE'])
def remove_from_blacklist(tmdb_id, media_type):
    """Remove an item from the global blacklist. Owner only."""
    current_user, err = _require_owner()
    if err:
        return err
    db = get_database()
    success = db.remove_from_global_blacklist(tmdb_id, media_type)
    if success:
        return jsonify({'success': True})
    return jsonify({'error': 'Failed to remove from blacklist'}), 500


@requestarr_requests_bp.route('/global-blacklist/check/<media_type>/<int:tmdb_id>', methods=['GET'])
def check_blacklist(media_type, tmdb_id):
    """Check if a media item is globally blacklisted."""
    db = get_database()
    blacklisted = db.is_globally_blacklisted(tmdb_id, media_type)
    return jsonify({'blacklisted': blacklisted})


@requestarr_requests_bp.route('/global-blacklist/ids', methods=['GET'])
def get_global_blacklist_ids():
    """Get all globally blacklisted tmdb_id:media_type pairs for frontend filtering.
    Any authenticated user can call this — needed for discovery/search filtering."""
    user = _get_current_user()
    if not user:
        return jsonify({'items': []})
    db = get_database()
    result = db.get_global_blacklist(page=1, page_size=10000)
    items = [{'tmdb_id': i['tmdb_id'], 'media_type': i['media_type'], 'title': i.get('title', ''), 'poster_path': i.get('poster_path', '')} for i in result.get('items', [])]
    return jsonify({'items': items})


@requestarr_requests_bp.route('/global-blacklist', methods=['POST'])
def add_to_blacklist():
    """Add media directly to global blacklist (owner only). Used by the blacklist modal."""
    current_user, err = _require_owner()
    if err:
        return err
    data = request.json or {}
    tmdb_id = data.get('tmdb_id')
    media_type = data.get('media_type')
    title = data.get('title', '')
    if not tmdb_id or not media_type:
        return jsonify({'error': 'tmdb_id and media_type are required'}), 400
    db = get_database()
    success = db.add_to_global_blacklist(
        tmdb_id=tmdb_id,
        media_type=media_type,
        title=title,
        year=data.get('year', ''),
        poster_path=data.get('poster_path', ''),
        blacklisted_by=current_user.get('username', ''),
        notes=data.get('notes', '')
    )
    if success:
        return jsonify({'success': True})
    return jsonify({'error': 'Failed to add to blacklist'}), 500
