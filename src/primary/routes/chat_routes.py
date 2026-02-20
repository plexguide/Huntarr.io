"""
Huntarr Chat Routes — lightweight in-app messaging.
Owner has moderator powers (delete any message, clear all).
"""

from flask import Blueprint, request, jsonify
import logging
import html
import time
from src.primary.utils.database import get_database
from src.primary.auth import get_username_from_session, SESSION_COOKIE_NAME

logger = logging.getLogger(__name__)

chat_bp = Blueprint('chat', __name__, url_prefix='/api/chat')

MAX_MESSAGE_LENGTH = 500

# Simple per-user rate limiting: {username: [timestamp, ...]}
_rate_limits = {}
RATE_LIMIT_WINDOW = 10  # seconds
RATE_LIMIT_MAX = 5      # max messages per window


def _check_rate_limit(username):
    """Returns True if allowed, False if rate-limited."""
    now = time.time()
    if username not in _rate_limits:
        _rate_limits[username] = []
    # Prune old entries
    _rate_limits[username] = [t for t in _rate_limits[username] if now - t < RATE_LIMIT_WINDOW]
    if len(_rate_limits[username]) >= RATE_LIMIT_MAX:
        return False
    _rate_limits[username].append(now)
    return True


def _get_current_user():
    """Get the current authenticated user with role info."""
    session_token = request.cookies.get(SESSION_COOKIE_NAME)
    if not session_token:
        return None
    username = get_username_from_session(session_token)
    if not username:
        return None
    db = get_database()
    # Check main users table (owner)
    owner = db.get_user_by_username(username)
    if owner:
        return {'id': owner.get('id', 1), 'username': username, 'role': 'owner'}
    # Check requestarr users table
    req_user = db.get_requestarr_user_by_username(username)
    if req_user:
        return {'id': req_user['id'], 'username': username, 'role': req_user.get('role', 'user')}
    return None


@chat_bp.route('', methods=['GET'])
def get_messages():
    """Get recent chat messages. Any authenticated user."""
    user = _get_current_user()
    if not user:
        return jsonify({'error': 'Not authenticated'}), 401
    before_id = request.args.get('before_id', type=int)
    limit = min(request.args.get('limit', 50, type=int), 200)
    db = get_database()
    messages = db.get_chat_messages(limit=limit, before_id=before_id)
    return jsonify({'messages': messages, 'user': {'username': user['username'], 'role': user['role']}})


@chat_bp.route('', methods=['POST'])
def send_message():
    """Send a chat message. Any authenticated user."""
    user = _get_current_user()
    if not user:
        return jsonify({'error': 'Not authenticated'}), 401
    data = request.json or {}
    message = (data.get('message') or '').strip()
    if not message:
        return jsonify({'error': 'Message cannot be empty'}), 400
    if len(message) > MAX_MESSAGE_LENGTH:
        return jsonify({'error': f'Message too long (max {MAX_MESSAGE_LENGTH} chars)'}), 400
    # Rate limit
    if not _check_rate_limit(user['username']):
        return jsonify({'error': 'Too many messages. Slow down.'}), 429
    # Sanitize
    message = html.escape(message)
    db = get_database()
    msg_id = db.create_chat_message(user['id'], user['username'], user['role'], message)
    if msg_id:
        msg = db.get_chat_message_by_id(msg_id)
        return jsonify({'success': True, 'message': msg}), 201
    return jsonify({'error': 'Failed to send message'}), 500


@chat_bp.route('/<int:message_id>', methods=['DELETE'])
def delete_message(message_id):
    """Delete a message. Owner can delete any; users can delete their own."""
    user = _get_current_user()
    if not user:
        return jsonify({'error': 'Not authenticated'}), 401
    db = get_database()
    msg = db.get_chat_message_by_id(message_id)
    if not msg:
        return jsonify({'error': 'Message not found'}), 404
    if user['role'] != 'owner' and msg['username'] != user['username']:
        return jsonify({'error': 'Not authorized'}), 403
    db.delete_chat_message(message_id)
    return jsonify({'success': True})


@chat_bp.route('/clear', methods=['POST'])
def clear_all():
    """Clear all messages. Owner only."""
    user = _get_current_user()
    if not user:
        return jsonify({'error': 'Not authenticated'}), 401
    if user['role'] != 'owner':
        return jsonify({'error': 'Owner only'}), 403
    db = get_database()
    db.clear_chat_messages()
    return jsonify({'success': True})
