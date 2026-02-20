"""
User Notification Routes
Connection-based CRUD for per-user notification providers, mirroring admin notifications.
"""

import json
import logging
from flask import Blueprint, request, jsonify

from src.primary.utils.database import get_database
from src.primary.auth import get_username_from_session, SESSION_COOKIE_NAME
from src.primary.notification_manager import PROVIDERS

logger = logging.getLogger("user_notifications")

user_notification_bp = Blueprint('user_notifications', __name__, url_prefix='/api/user-notifications')

# Event types for user notifications (request lifecycle)
TRIGGER_KEYS = [
    'request_pending',
    'request_approved',
    'request_denied',
    'request_auto_approved',
    'media_available',
    'media_failed',
]

TRIGGER_LABELS = {
    'request_pending': 'Request Pending',
    'request_approved': 'Request Approved',
    'request_denied': 'Request Denied',
    'request_auto_approved': 'Request Auto-Approved',
    'media_available': 'Media Available',
    'media_failed': 'Media Failed',
}

DEFAULT_TRIGGERS = {k: True for k in TRIGGER_KEYS}

# Provider metadata — same structure as admin notifications
PROVIDER_META = {
    "discord": {
        "name": "Discord", "icon": "fab fa-discord", "color": "#5865F2",
        "fields": [
            {"key": "webhook_url", "label": "Webhook URL", "type": "text", "required": True,
             "placeholder": "https://discord.com/api/webhooks/...",
             "help": "Create a webhook in your Discord channel settings"},
        ],
    },
    "telegram": {
        "name": "Telegram", "icon": "fab fa-telegram", "color": "#0088CC",
        "fields": [
            {"key": "chat_id", "label": "Chat ID", "type": "text", "required": True,
             "placeholder": "-1001234567890", "help": "Your personal chat ID"},
            {"key": "send_silently", "label": "Send Silently", "type": "checkbox", "required": False,
             "help": "Send without notification sound"},
        ],
    },
    "slack": {
        "name": "Slack", "icon": "fab fa-slack", "color": "#4A154B",
        "fields": [
            {"key": "webhook_url", "label": "Webhook URL", "type": "text", "required": True,
             "placeholder": "https://hooks.slack.com/services/..."},
        ],
    },
    "pushover": {
        "name": "Pushover", "icon": "fas fa-bell", "color": "#249DF1",
        "fields": [
            {"key": "user_key", "label": "User Key", "type": "password", "required": True,
             "placeholder": "Your Pushover user key"},
            {"key": "api_token", "label": "App Token (optional)", "type": "password", "required": False,
             "placeholder": "Override admin app token"},
        ],
    },
    "pushbullet": {
        "name": "Pushbullet", "icon": "fas fa-comment-dots", "color": "#4AB367",
        "fields": [
            {"key": "api_key", "label": "Access Token", "type": "password", "required": True,
             "placeholder": "Your Pushbullet access token"},
        ],
    },
    "email": {
        "name": "Email", "icon": "fas fa-envelope", "color": "#EA4335",
        "fields": [
            {"key": "email_address", "label": "Email Address", "type": "text", "required": True,
             "placeholder": "you@example.com", "help": "Uses the admin SMTP configuration"},
        ],
    },
    "gotify": {
        "name": "Gotify", "icon": "fas fa-server", "color": "#2196F3",
        "fields": [
            {"key": "server_url", "label": "Server URL", "type": "text", "required": True,
             "placeholder": "https://gotify.example.com"},
            {"key": "app_token", "label": "App Token", "type": "password", "required": True,
             "placeholder": "Your Gotify app token"},
        ],
    },
    "ntfy": {
        "name": "ntfy", "icon": "fas fa-paper-plane", "color": "#57A64A",
        "fields": [
            {"key": "server_url", "label": "Server URL", "type": "text", "required": False,
             "placeholder": "https://ntfy.sh", "help": "Defaults to ntfy.sh"},
            {"key": "topic", "label": "Topic", "type": "text", "required": True,
             "placeholder": "my-notifications"},
        ],
    },
    "lunasea": {
        "name": "LunaSea", "icon": "fas fa-moon", "color": "#4ECCA3",
        "fields": [
            {"key": "webhook_url", "label": "Webhook URL", "type": "text", "required": False,
             "placeholder": "https://notify.lunasea.app/v1/custom/..."},
            {"key": "user_id", "label": "User ID", "type": "text", "required": False,
             "placeholder": "Your LunaSea user ID"},
        ],
    },
    "notifiarr": {
        "name": "Notifiarr", "icon": "fas fa-satellite-dish", "color": "#4FD1C5",
        "fields": [
            {"key": "api_key", "label": "API Key", "type": "password", "required": True,
             "placeholder": "Your Notifiarr API key"},
        ],
    },
    "webhook": {
        "name": "Webhook", "icon": "fas fa-plug", "color": "#8B5CF6",
        "fields": [
            {"key": "webhook_url", "label": "Webhook URL", "type": "text", "required": True,
             "placeholder": "https://your-server.com/webhook"},
        ],
    },
    "apprise": {
        "name": "Apprise", "icon": "fas fa-globe", "color": "#F59E0B",
        "fields": [
            {"key": "urls", "label": "Apprise URLs", "type": "textarea", "required": True,
             "placeholder": "One URL per line"},
        ],
    },
}


def _get_current_username():
    """Get the current authenticated username."""
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
    return username


# ── Routes ────────────────────────────────────────────────────

@user_notification_bp.route('/providers', methods=['GET'])
def get_providers():
    """Return available providers and trigger definitions."""
    username = _get_current_username()
    if not username:
        return jsonify({'error': 'Not authenticated'}), 401

    return jsonify({
        'providers': PROVIDER_META,
        'trigger_keys': TRIGGER_KEYS,
        'trigger_labels': TRIGGER_LABELS,
        'default_triggers': DEFAULT_TRIGGERS,
    })


@user_notification_bp.route('/connections', methods=['GET'])
def list_connections():
    """Return all connections for the current user."""
    username = _get_current_username()
    if not username:
        return jsonify({'error': 'Not authenticated'}), 401

    db = get_database()
    connections = db.get_user_notification_connections(username)
    return jsonify({'connections': connections})


@user_notification_bp.route('/connections', methods=['POST'])
def create_connection():
    """Create a new notification connection."""
    username = _get_current_username()
    if not username:
        return jsonify({'error': 'Not authenticated'}), 401

    data = request.get_json(silent=True) or {}
    provider = data.get('provider', '').strip()
    if not provider or provider not in PROVIDER_META:
        return jsonify({'error': 'Invalid provider'}), 400

    data.pop('id', None)
    if 'triggers' not in data:
        data['triggers'] = dict(DEFAULT_TRIGGERS)

    db = get_database()
    conn_id = db.save_user_notification_connection(username, data)
    conn = db.get_user_notification_connection(conn_id)
    return jsonify({'connection': conn, 'id': conn_id}), 201


@user_notification_bp.route('/connections/<int:conn_id>', methods=['PUT'])
def update_connection(conn_id):
    """Update an existing connection."""
    username = _get_current_username()
    if not username:
        return jsonify({'error': 'Not authenticated'}), 401

    db = get_database()
    existing = db.get_user_notification_connection(conn_id)
    if not existing or existing.get('username') != username:
        return jsonify({'error': 'Connection not found'}), 404

    data = request.get_json(silent=True) or {}
    data['id'] = conn_id
    db.save_user_notification_connection(username, data)
    conn = db.get_user_notification_connection(conn_id)
    return jsonify({'connection': conn})


@user_notification_bp.route('/connections/<int:conn_id>', methods=['DELETE'])
def delete_connection(conn_id):
    """Delete a connection."""
    username = _get_current_username()
    if not username:
        return jsonify({'error': 'Not authenticated'}), 401

    db = get_database()
    ok = db.delete_user_notification_connection(username, conn_id)
    if not ok:
        return jsonify({'error': 'Connection not found'}), 404
    return jsonify({'success': True})


@user_notification_bp.route('/connections/<int:conn_id>/test', methods=['POST'])
def test_connection(conn_id):
    """Send a test notification through a connection."""
    username = _get_current_username()
    if not username:
        return jsonify({'error': 'Not authenticated'}), 401

    db = get_database()
    conn = db.get_user_notification_connection(conn_id)
    if not conn or conn.get('username') != username:
        return jsonify({'success': False, 'error': 'Connection not found'}), 404

    provider = conn.get('provider', '')
    user_settings = conn.get('settings', {})
    if isinstance(user_settings, str):
        try:
            user_settings = json.loads(user_settings)
        except (json.JSONDecodeError, TypeError):
            user_settings = {}

    effective = _build_effective_settings(provider, user_settings)
    send_fn = PROVIDERS.get(provider)
    if not send_fn:
        return jsonify({'success': False, 'error': f'Provider {provider} not available'}), 400

    conn_name = conn.get('name', provider)
    title = "Huntarr Test Notification"
    message = f"Test for \"{conn_name}\" — your {PROVIDER_META.get(provider, {}).get('name', provider)} configuration is working! 🎉"

    try:
        ok, err = send_fn(effective, title, message, "on_test")
        if ok:
            return jsonify({'success': True, 'message': 'Test notification sent!'})
        return jsonify({'success': False, 'error': err}), 400
    except Exception as e:
        logger.error(f"Test notification error for {username}/{provider}: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


# ── Effective settings builder ────────────────────────────────

def _build_effective_settings(provider, user_settings):
    """Build effective settings, merging admin config where needed (e.g. email SMTP, telegram bot_token)."""
    if provider == 'email':
        db = get_database()
        connections = db.get_notification_connections()
        for c in connections:
            if c.get('provider') == 'email' and c.get('enabled'):
                s = c.get('settings', {})
                if isinstance(s, str):
                    try: s = json.loads(s)
                    except: s = {}
                return {
                    'smtp_server': s.get('smtp_server', ''),
                    'smtp_port': s.get('smtp_port', 587),
                    'use_ssl': s.get('use_ssl', False),
                    'username': s.get('username', ''),
                    'password': s.get('password', ''),
                    'from_address': s.get('from_address', '') or s.get('username', ''),
                    'to_addresses': user_settings.get('email_address', ''),
                }
        return {'to_addresses': user_settings.get('email_address', '')}

    if provider == 'telegram':
        db = get_database()
        connections = db.get_notification_connections()
        for c in connections:
            if c.get('provider') == 'telegram' and c.get('enabled'):
                s = c.get('settings', {})
                if isinstance(s, str):
                    try: s = json.loads(s)
                    except: s = {}
                return {
                    'bot_token': s.get('bot_token', ''),
                    'chat_id': user_settings.get('chat_id', ''),
                    'send_silently': user_settings.get('send_silently', False),
                }
        return user_settings

    if provider == 'pushover':
        if not user_settings.get('api_token'):
            db = get_database()
            connections = db.get_notification_connections()
            for c in connections:
                if c.get('provider') == 'pushover' and c.get('enabled'):
                    s = c.get('settings', {})
                    if isinstance(s, str):
                        try: s = json.loads(s)
                        except: s = {}
                    return {
                        'user_key': user_settings.get('user_key', ''),
                        'api_token': s.get('api_token', ''),
                    }
        return user_settings

    return user_settings


# ── Dispatch helper ───────────────────────────────────────────

def dispatch_user_notification(username, event_type, title, message):
    """Send notification to a specific user based on their notification connections."""
    db = get_database()
    connections = db.get_user_notification_connections(username)
    if not connections:
        return

    for conn in connections:
        if not conn.get('enabled', True):
            continue

        triggers = conn.get('triggers', {})
        if isinstance(triggers, str):
            try: triggers = json.loads(triggers)
            except: triggers = {}

        if not triggers.get(event_type, False):
            continue

        provider = conn.get('provider', '')
        user_settings = conn.get('settings', {})
        if isinstance(user_settings, str):
            try: user_settings = json.loads(user_settings)
            except: user_settings = {}

        effective = _build_effective_settings(provider, user_settings)
        send_fn = PROVIDERS.get(provider)
        if not send_fn:
            continue

        try:
            ok, err = send_fn(effective, title, message, "on_request")
            if ok:
                logger.debug(f"User notification sent to {username} via {provider} (conn {conn.get('id')})")
            else:
                logger.warning(f"User notification failed for {username} via {provider}: {err}")
        except Exception as e:
            logger.error(f"User notification error for {username}/{provider}: {e}")
