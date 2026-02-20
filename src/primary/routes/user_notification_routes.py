"""
User Notification Settings Routes
Allows each user to configure their own notification providers and event types.
"""

import json
import logging
from flask import Blueprint, request, jsonify

from src.primary.utils.database import get_database
from src.primary.auth import get_username_from_session, SESSION_COOKIE_NAME
from src.primary.notification_manager import PROVIDERS

logger = logging.getLogger("user_notifications")

user_notification_bp = Blueprint('user_notifications', __name__, url_prefix='/api/user-notifications')

# User notification event types (request lifecycle)
USER_EVENT_TYPES = [
    'request_pending',
    'request_approved',
    'request_denied',
    'request_auto_approved',
    'media_available',
    'media_failed',
]

USER_EVENT_LABELS = {
    'request_pending': 'Request Pending',
    'request_approved': 'Request Approved',
    'request_denied': 'Request Denied',
    'request_auto_approved': 'Request Auto-Approved',
    'media_available': 'Media Available',
    'media_failed': 'Media Failed',
}

# Per-user provider field definitions (user provides their own credentials)
USER_PROVIDER_FIELDS = {
    "discord": [
        {"key": "webhook_url", "label": "Webhook URL", "type": "text", "required": True,
         "placeholder": "https://discord.com/api/webhooks/...",
         "help": "Create a webhook in your Discord channel settings"},
    ],
    "telegram": [
        {"key": "chat_id", "label": "Chat ID", "type": "text", "required": True,
         "placeholder": "-1001234567890", "help": "Your personal chat ID"},
        {"key": "send_silently", "label": "Send Silently", "type": "checkbox", "required": False,
         "help": "Send without notification sound"},
    ],
    "pushover": [
        {"key": "user_key", "label": "User Key", "type": "password", "required": True,
         "placeholder": "Your Pushover user key"},
        {"key": "api_token", "label": "App Token (optional)", "type": "password", "required": False,
         "placeholder": "Override admin app token"},
    ],
    "pushbullet": [
        {"key": "api_key", "label": "Access Token", "type": "password", "required": True,
         "placeholder": "Your Pushbullet access token"},
    ],
    "email": [
        {"key": "email_address", "label": "Email Address", "type": "text", "required": True,
         "placeholder": "you@example.com", "help": "Uses the admin SMTP configuration"},
    ],
    "gotify": [
        {"key": "server_url", "label": "Server URL", "type": "text", "required": True,
         "placeholder": "https://gotify.example.com"},
        {"key": "app_token", "label": "App Token", "type": "password", "required": True,
         "placeholder": "Your Gotify app token"},
    ],
    "ntfy": [
        {"key": "server_url", "label": "Server URL", "type": "text", "required": False,
         "placeholder": "https://ntfy.sh", "help": "Defaults to ntfy.sh"},
        {"key": "topic", "label": "Topic", "type": "text", "required": True,
         "placeholder": "my-notifications"},
    ],
    "lunasea": [
        {"key": "webhook_url", "label": "Webhook URL", "type": "text", "required": False,
         "placeholder": "https://notify.lunasea.app/v1/custom/..."},
        {"key": "user_id", "label": "User ID", "type": "text", "required": False,
         "placeholder": "Your LunaSea user ID"},
    ],
    "slack": [
        {"key": "webhook_url", "label": "Webhook URL", "type": "text", "required": True,
         "placeholder": "https://hooks.slack.com/services/..."},
    ],
    "webhook": [
        {"key": "webhook_url", "label": "Webhook URL", "type": "text", "required": True,
         "placeholder": "https://your-server.com/webhook"},
    ],
    "notifiarr": [
        {"key": "api_key", "label": "API Key", "type": "password", "required": True,
         "placeholder": "Your Notifiarr API key"},
    ],
    "apprise": [
        {"key": "urls", "label": "Apprise URLs", "type": "textarea", "required": True,
         "placeholder": "One URL per line"},
    ],
}


# Provider display metadata (icon, color, name)
PROVIDER_DISPLAY = {
    "discord": {"name": "Discord", "icon": "fab fa-discord", "color": "#5865F2"},
    "telegram": {"name": "Telegram", "icon": "fab fa-telegram", "color": "#0088CC"},
    "pushover": {"name": "Pushover", "icon": "fas fa-bell", "color": "#249DF1"},
    "pushbullet": {"name": "Pushbullet", "icon": "fas fa-comment-dots", "color": "#4AB367"},
    "email": {"name": "Email", "icon": "fas fa-envelope", "color": "#EA4335"},
    "gotify": {"name": "Gotify", "icon": "fas fa-server", "color": "#2196F3"},
    "ntfy": {"name": "ntfy", "icon": "fas fa-paper-plane", "color": "#57A64A"},
    "lunasea": {"name": "LunaSea", "icon": "fas fa-moon", "color": "#4ECCA3"},
    "slack": {"name": "Slack", "icon": "fab fa-slack", "color": "#4A154B"},
    "webhook": {"name": "Webhook", "icon": "fas fa-plug", "color": "#8B5CF6"},
    "notifiarr": {"name": "Notifiarr", "icon": "fas fa-satellite-dish", "color": "#4FD1C5"},
    "apprise": {"name": "Apprise", "icon": "fas fa-globe", "color": "#F59E0B"},
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


@user_notification_bp.route('/providers', methods=['GET'])
def get_available_providers():
    """Return providers available for user configuration (only admin-enabled ones)."""
    username = _get_current_username()
    if not username:
        return jsonify({'error': 'Not authenticated'}), 401

    providers = {}
    for key in USER_PROVIDER_FIELDS:
        display = PROVIDER_DISPLAY.get(key, {})
        providers[key] = {
            'name': display.get('name', key),
            'icon': display.get('icon', 'fas fa-bell'),
            'color': display.get('color', '#64748b'),
            'fields': USER_PROVIDER_FIELDS[key],
        }

    return jsonify({
        'providers': providers,
        'event_types': USER_EVENT_TYPES,
        'event_labels': USER_EVENT_LABELS,
    })


@user_notification_bp.route('/settings', methods=['GET'])
def get_settings():
    """Get current user's notification settings."""
    username = _get_current_username()
    if not username:
        return jsonify({'error': 'Not authenticated'}), 401

    db = get_database()
    settings = db.get_user_notification_settings(username)
    return jsonify({'settings': settings})


@user_notification_bp.route('/settings', methods=['POST'])
def save_setting():
    """Save a provider setting for the current user."""
    username = _get_current_username()
    if not username:
        return jsonify({'error': 'Not authenticated'}), 401

    data = request.get_json(silent=True) or {}
    provider = data.get('provider', '').strip()
    if not provider or provider not in USER_PROVIDER_FIELDS:
        return jsonify({'error': 'Invalid provider'}), 400

    db = get_database()
    db.save_user_notification_setting(username, provider, {
        'enabled': data.get('enabled', True),
        'settings': data.get('settings', {}),
        'types': data.get('types', {}),
    })

    return jsonify({'success': True})


@user_notification_bp.route('/settings/<provider>', methods=['DELETE'])
def delete_setting(provider):
    """Remove a provider setting for the current user."""
    username = _get_current_username()
    if not username:
        return jsonify({'error': 'Not authenticated'}), 401

    db = get_database()
    ok = db.delete_user_notification_setting(username, provider)
    if not ok:
        return jsonify({'error': 'Setting not found'}), 404
    return jsonify({'success': True})


@user_notification_bp.route('/test/<provider>', methods=['POST'])
def test_provider(provider):
    """Test a user's notification config by sending a test message."""
    username = _get_current_username()
    if not username:
        return jsonify({'error': 'Not authenticated'}), 401

    if provider not in USER_PROVIDER_FIELDS:
        return jsonify({'success': False, 'error': 'Unknown provider'}), 400

    db = get_database()
    setting = db.get_user_notification_setting(username, provider)
    if not setting:
        return jsonify({'success': False, 'error': 'No settings saved for this provider'}), 404

    user_settings = setting.get('settings', {})
    if isinstance(user_settings, str):
        try:
            user_settings = json.loads(user_settings)
        except (json.JSONDecodeError, TypeError):
            user_settings = {}

    # Build effective settings by merging user settings with admin config where needed
    effective_settings = _build_effective_settings(provider, user_settings)

    send_fn = PROVIDERS.get(provider)
    if not send_fn:
        return jsonify({'success': False, 'error': f'Provider {provider} not available'}), 400

    title = "Huntarr Test Notification"
    message = f"This is a test notification for {username}. Your {PROVIDER_DISPLAY.get(provider, {}).get('name', provider)} configuration is working! 🎉"

    try:
        ok, err = send_fn(effective_settings, title, message, "on_test")
        if ok:
            return jsonify({'success': True, 'message': 'Test notification sent!'})
        return jsonify({'success': False, 'error': err}), 400
    except Exception as e:
        logger.error(f"Test notification error for {username}/{provider}: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


def _build_effective_settings(provider, user_settings):
    """Build effective settings, merging admin config where needed (e.g. email SMTP)."""
    if provider == 'email':
        # User provides email address, admin provides SMTP config
        db = get_database()
        connections = db.get_notification_connections()
        admin_email = None
        for conn in connections:
            if conn.get('provider') == 'email' and conn.get('enabled'):
                s = conn.get('settings', {})
                if isinstance(s, str):
                    try:
                        s = json.loads(s)
                    except (json.JSONDecodeError, TypeError):
                        s = {}
                admin_email = s
                break
        if admin_email:
            return {
                'smtp_server': admin_email.get('smtp_server', ''),
                'smtp_port': admin_email.get('smtp_port', 587),
                'use_ssl': admin_email.get('use_ssl', False),
                'username': admin_email.get('username', ''),
                'password': admin_email.get('password', ''),
                'from_address': admin_email.get('from_address', '') or admin_email.get('username', ''),
                'to_addresses': user_settings.get('email_address', ''),
            }
        return {'to_addresses': user_settings.get('email_address', '')}

    if provider == 'telegram':
        # User provides chat_id, admin provides bot_token
        db = get_database()
        connections = db.get_notification_connections()
        for conn in connections:
            if conn.get('provider') == 'telegram' and conn.get('enabled'):
                s = conn.get('settings', {})
                if isinstance(s, str):
                    try:
                        s = json.loads(s)
                    except (json.JSONDecodeError, TypeError):
                        s = {}
                return {
                    'bot_token': s.get('bot_token', ''),
                    'chat_id': user_settings.get('chat_id', ''),
                    'send_silently': user_settings.get('send_silently', False),
                }
        return user_settings

    if provider == 'pushover':
        # User provides user_key, optionally overrides api_token
        if not user_settings.get('api_token'):
            db = get_database()
            connections = db.get_notification_connections()
            for conn in connections:
                if conn.get('provider') == 'pushover' and conn.get('enabled'):
                    s = conn.get('settings', {})
                    if isinstance(s, str):
                        try:
                            s = json.loads(s)
                        except (json.JSONDecodeError, TypeError):
                            s = {}
                    return {
                        'user_key': user_settings.get('user_key', ''),
                        'api_token': s.get('api_token', ''),
                    }
        return user_settings

    # All other providers: user provides everything
    return user_settings


# ── Dispatch helper for user notifications ────────────────────

def dispatch_user_notification(username, event_type, title, message):
    """Send notification to a specific user based on their notification settings."""
    db = get_database()
    settings_list = db.get_user_notification_settings(username)
    if not settings_list:
        return

    for setting in settings_list:
        if not setting.get('enabled', True):
            continue

        types = setting.get('types', {})
        if isinstance(types, str):
            try:
                types = json.loads(types)
            except (json.JSONDecodeError, TypeError):
                types = {}

        if not types.get(event_type, False):
            continue

        provider = setting.get('provider', '')
        user_settings = setting.get('settings', {})
        if isinstance(user_settings, str):
            try:
                user_settings = json.loads(user_settings)
            except (json.JSONDecodeError, TypeError):
                user_settings = {}

        effective = _build_effective_settings(provider, user_settings)
        send_fn = PROVIDERS.get(provider)
        if not send_fn:
            continue

        try:
            ok, err = send_fn(effective, title, message, "on_request")
            if ok:
                logger.debug(f"User notification sent to {username} via {provider}")
            else:
                logger.warning(f"User notification failed for {username} via {provider}: {err}")
        except Exception as e:
            logger.error(f"User notification error for {username}/{provider}: {e}")
