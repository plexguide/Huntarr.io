#!/usr/bin/env python3
"""
Notification API Routes for Huntarr
CRUD for notification connections and test endpoint.
"""

import logging
from flask import Blueprint, jsonify, request

from src.primary.notification_manager import (
    get_all_connections,
    get_connection,
    save_connection,
    delete_connection,
    test_connection,
    PROVIDERS,
    TRIGGER_KEYS,
    DEFAULT_TRIGGERS,
)

logger = logging.getLogger("notifications")

notification_api = Blueprint("notification_api", __name__)

# Provider metadata for the frontend
PROVIDER_META = {
    "discord": {
        "name": "Discord",
        "icon": "fab fa-discord",
        "color": "#5865F2",
        "description": "Send notifications to a Discord channel via webhook",
        "fields": [
            {"key": "webhook_url", "label": "Webhook URL", "type": "text", "required": True,
             "placeholder": "https://discord.com/api/webhooks/...",
             "help": "Create a webhook in your Discord channel settings → Integrations → Webhooks"},
            {"key": "username", "label": "Bot Username", "type": "text", "required": False,
             "placeholder": "Huntarr", "help": "Display name for the bot (optional)"},
            {"key": "avatar_url", "label": "Avatar URL", "type": "text", "required": False,
             "placeholder": "https://...", "help": "Custom avatar image URL (optional)"},
        ],
    },
    "slack": {
        "name": "Slack",
        "icon": "fab fa-slack",
        "color": "#4A154B",
        "description": "Send notifications to a Slack channel via incoming webhook",
        "fields": [
            {"key": "webhook_url", "label": "Webhook URL", "type": "text", "required": True,
             "placeholder": "https://hooks.slack.com/services/...",
             "help": "Create an Incoming Webhook in your Slack workspace settings"},
            {"key": "channel", "label": "Channel", "type": "text", "required": False,
             "placeholder": "#notifications", "help": "Override default webhook channel (optional)"},
            {"key": "username", "label": "Bot Username", "type": "text", "required": False,
             "placeholder": "Huntarr", "help": "Display name (optional)"},
            {"key": "icon_emoji", "label": "Icon Emoji", "type": "text", "required": False,
             "placeholder": ":bell:", "help": "Emoji icon for messages (optional)"},
        ],
    },
    "telegram": {
        "name": "Telegram",
        "icon": "fab fa-telegram",
        "color": "#0088CC",
        "description": "Send notifications via Telegram bot",
        "fields": [
            {"key": "bot_token", "label": "Bot Token", "type": "password", "required": True,
             "placeholder": "123456:ABC-DEF1234...",
             "help": "Get this from @BotFather on Telegram"},
            {"key": "chat_id", "label": "Chat ID", "type": "text", "required": True,
             "placeholder": "-1001234567890",
             "help": "Your chat, group, or channel ID. Use @userinfobot to find it"},
            {"key": "send_silently", "label": "Send Silently", "type": "checkbox", "required": False,
             "help": "Send without notification sound"},
        ],
    },
    "pushover": {
        "name": "Pushover",
        "icon": "fas fa-bell",
        "color": "#249DF1",
        "description": "Send push notifications via Pushover",
        "fields": [
            {"key": "user_key", "label": "User Key", "type": "password", "required": True,
             "placeholder": "Your Pushover user key",
             "help": "Found on your Pushover dashboard"},
            {"key": "api_token", "label": "API Token", "type": "password", "required": True,
             "placeholder": "Your application API token",
             "help": "Create an application at pushover.net/apps"},
            {"key": "priority", "label": "Priority", "type": "select", "required": False,
             "options": [
                 {"value": "-2", "label": "Lowest"},
                 {"value": "-1", "label": "Low"},
                 {"value": "0", "label": "Normal"},
                 {"value": "1", "label": "High"},
                 {"value": "2", "label": "Emergency"},
             ],
             "help": "Message priority level"},
            {"key": "sound", "label": "Sound", "type": "text", "required": False,
             "placeholder": "pushover", "help": "Notification sound name (optional)"},
            {"key": "devices", "label": "Devices", "type": "text", "required": False,
             "placeholder": "device1,device2", "help": "Comma-separated device names (optional, all devices if empty)"},
        ],
    },
    "pushbullet": {
        "name": "Pushbullet",
        "icon": "fas fa-comment-dots",
        "color": "#4AB367",
        "description": "Send push notifications via Pushbullet",
        "fields": [
            {"key": "api_key", "label": "Access Token", "type": "password", "required": True,
             "placeholder": "Your Pushbullet access token",
             "help": "Found at pushbullet.com → Settings → Access Token"},
            {"key": "channel_tag", "label": "Channel Tag", "type": "text", "required": False,
             "placeholder": "my-channel", "help": "Send to a specific channel (optional)"},
            {"key": "device_iden", "label": "Device ID", "type": "text", "required": False,
             "placeholder": "device_iden", "help": "Send to a specific device (optional)"},
        ],
    },
    "email": {
        "name": "Email",
        "icon": "fas fa-envelope",
        "color": "#EA4335",
        "description": "Send notifications via email (SMTP)",
        "fields": [
            {"key": "smtp_server", "label": "SMTP Server", "type": "text", "required": True,
             "placeholder": "smtp.gmail.com", "help": "SMTP server hostname"},
            {"key": "smtp_port", "label": "SMTP Port", "type": "number", "required": True,
             "placeholder": "587", "help": "Usually 587 (TLS) or 465 (SSL)"},
            {"key": "use_ssl", "label": "Use SSL", "type": "checkbox", "required": False,
             "help": "Use SSL instead of STARTTLS (for port 465)"},
            {"key": "username", "label": "Username", "type": "text", "required": False,
             "placeholder": "user@gmail.com", "help": "SMTP login username"},
            {"key": "password", "label": "Password", "type": "password", "required": False,
             "placeholder": "App password", "help": "SMTP login password or app-specific password"},
            {"key": "from_address", "label": "From Address", "type": "text", "required": False,
             "placeholder": "huntarr@example.com", "help": "Sender address (defaults to username)"},
            {"key": "to_addresses", "label": "To Addresses", "type": "text", "required": True,
             "placeholder": "user@example.com, user2@example.com",
             "help": "Comma-separated list of recipient email addresses"},
        ],
    },
    "notifiarr": {
        "name": "Notifiarr",
        "icon": "fas fa-satellite-dish",
        "color": "#4FD1C5",
        "description": "Send notifications via Notifiarr integration platform",
        "fields": [
            {"key": "api_key", "label": "API Key", "type": "password", "required": True,
             "placeholder": "Your Notifiarr API key",
             "help": "Found on your Notifiarr dashboard → Integration Keys"},
            {"key": "discord_channel_id", "label": "Discord Channel ID", "type": "text", "required": False,
             "placeholder": "123456789012345678",
             "help": "Discord channel ID for passthrough notifications (optional)"},
        ],
    },
    "webhook": {
        "name": "Webhook",
        "icon": "fas fa-plug",
        "color": "#8B5CF6",
        "description": "Send notifications to a custom webhook URL",
        "fields": [
            {"key": "webhook_url", "label": "Webhook URL", "type": "text", "required": True,
             "placeholder": "https://your-server.com/webhook",
             "help": "The URL to POST notification data to"},
            {"key": "method", "label": "HTTP Method", "type": "select", "required": False,
             "options": [
                 {"value": "POST", "label": "POST"},
                 {"value": "GET", "label": "GET"},
             ],
             "help": "HTTP method to use"},
            {"key": "headers", "label": "Custom Headers (JSON)", "type": "textarea", "required": False,
             "placeholder": '{"Authorization": "Bearer ..."}',
             "help": "Custom headers as JSON object (optional)"},
        ],
    },
    "apprise": {
        "name": "Apprise",
        "icon": "fas fa-globe",
        "color": "#F59E0B",
        "description": "Use Apprise URLs to reach 90+ notification services",
        "fields": [
            {"key": "urls", "label": "Apprise URLs", "type": "textarea", "required": True,
             "placeholder": "discord://webhook_id/webhook_token\ntgram://bot_token/chat_id",
             "help": "One Apprise URL per line. See github.com/caronc/apprise for supported URLs"},
        ],
    },
    "gotify": {
        "name": "Gotify",
        "icon": "fas fa-server",
        "color": "#2196F3",
        "description": "Send notifications to a self-hosted Gotify server",
        "fields": [
            {"key": "server_url", "label": "Server URL", "type": "text", "required": True,
             "placeholder": "https://gotify.example.com",
             "help": "Your Gotify server URL (include http:// or https://)"},
            {"key": "app_token", "label": "App Token", "type": "password", "required": True,
             "placeholder": "Your Gotify application token",
             "help": "Create an application in Gotify and copy its token"},
            {"key": "priority", "label": "Priority", "type": "select", "required": False,
             "options": [
                 {"value": "0", "label": "Min"},
                 {"value": "3", "label": "Low"},
                 {"value": "5", "label": "Normal"},
                 {"value": "8", "label": "High"},
                 {"value": "10", "label": "Max"},
             ],
             "help": "Message priority (affects notification behavior on clients)"},
        ],
    },
    "ntfy": {
        "name": "ntfy",
        "icon": "fas fa-paper-plane",
        "color": "#57A64A",
        "description": "Send notifications via ntfy.sh or a self-hosted ntfy server",
        "fields": [
            {"key": "server_url", "label": "Server URL", "type": "text", "required": False,
             "placeholder": "https://ntfy.sh",
             "help": "ntfy server URL (defaults to ntfy.sh if empty)"},
            {"key": "topic", "label": "Topic", "type": "text", "required": True,
             "placeholder": "huntarr-notifications",
             "help": "The topic to publish to (acts as the channel name)"},
            {"key": "priority", "label": "Priority", "type": "select", "required": False,
             "options": [
                 {"value": "1", "label": "Min"},
                 {"value": "2", "label": "Low"},
                 {"value": "3", "label": "Default"},
                 {"value": "4", "label": "High"},
                 {"value": "5", "label": "Urgent"},
             ],
             "help": "Message priority level"},
            {"key": "access_token", "label": "Access Token", "type": "password", "required": False,
             "placeholder": "tk_...",
             "help": "Access token for authentication (optional, for private topics)"},
            {"key": "username", "label": "Username", "type": "text", "required": False,
             "placeholder": "Username",
             "help": "Basic auth username (alternative to access token)"},
            {"key": "password", "label": "Password", "type": "password", "required": False,
             "placeholder": "Password",
             "help": "Basic auth password (alternative to access token)"},
        ],
    },
    "lunasea": {
        "name": "LunaSea",
        "icon": "fas fa-moon",
        "color": "#4ECCA3",
        "description": "Send push notifications to the LunaSea mobile app",
        "fields": [
            {"key": "webhook_url", "label": "Webhook URL", "type": "text", "required": False,
             "placeholder": "https://notify.lunasea.app/v1/custom/...",
             "help": "Full LunaSea webhook URL (overrides user/device ID if set)"},
            {"key": "user_id", "label": "User ID", "type": "text", "required": False,
             "placeholder": "Your LunaSea user ID",
             "help": "LunaSea user ID (found in LunaSea app settings)"},
            {"key": "device_id", "label": "Device ID", "type": "text", "required": False,
             "placeholder": "Your LunaSea device ID",
             "help": "LunaSea device ID (for single-device notifications)"},
        ],
    },
}


@notification_api.route("/api/notifications/providers", methods=["GET"])
def get_providers():
    """Return available notification providers and their field definitions."""
    return jsonify({
        "providers": PROVIDER_META,
        "trigger_keys": TRIGGER_KEYS,
        "default_triggers": DEFAULT_TRIGGERS,
    })


@notification_api.route("/api/notifications/connections", methods=["GET"])
def list_connections():
    """Return all notification connections."""
    try:
        connections = get_all_connections()
        return jsonify({"connections": connections})
    except Exception as e:
        logger.exception("Error listing notification connections")
        return jsonify({"error": "Failed to list notification connections"}), 500


@notification_api.route("/api/notifications/connections", methods=["POST"])
def create_connection():
    """Create a new notification connection."""
    try:
        data = request.get_json(silent=True) or {}
        if not data:
            return jsonify({"error": "JSON body required"}), 400

        if not data.get("provider"):
            return jsonify({"error": "Provider is required"}), 400

        if data.get("provider") not in PROVIDER_META:
            return jsonify({"error": f"Unknown provider: {data['provider']}"}), 400

        # Don't pass an id so the DB creates a new row
        data.pop("id", None)

        # Set default triggers if none provided
        if "triggers" not in data:
            data["triggers"] = dict(DEFAULT_TRIGGERS)

        conn_id = save_connection(data)
        conn = get_connection(conn_id)
        return jsonify({"connection": conn, "id": conn_id}), 201
    except Exception as e:
        logger.exception("Error creating notification connection")
        return jsonify({"error": "Failed to create notification connection"}), 500


@notification_api.route("/api/notifications/connections/<int:conn_id>", methods=["PUT"])
def update_connection(conn_id):
    """Update an existing notification connection."""
    try:
        data = request.get_json(silent=True) or {}
        if not data:
            return jsonify({"error": "JSON body required"}), 400

        existing = get_connection(conn_id)
        if not existing:
            return jsonify({"error": "Connection not found"}), 404

        data["id"] = conn_id
        save_connection(data)
        conn = get_connection(conn_id)
        return jsonify({"connection": conn})
    except Exception as e:
        logger.exception("Error updating notification connection")
        return jsonify({"error": "Failed to update notification connection"}), 500


@notification_api.route("/api/notifications/connections/<int:conn_id>", methods=["DELETE"])
def remove_connection(conn_id):
    """Delete a notification connection."""
    try:
        ok = delete_connection(conn_id)
        if not ok:
            return jsonify({"error": "Connection not found"}), 404
        return jsonify({"success": True})
    except Exception as e:
        logger.exception("Error deleting notification connection")
        return jsonify({"error": "Failed to delete notification connection"}), 500


@notification_api.route("/api/notifications/connections/<int:conn_id>/test", methods=["POST"])
def test_conn(conn_id):
    """Send a test notification through a specific connection."""
    try:
        ok, err = test_connection(conn_id)
        if ok:
            return jsonify({"success": True, "message": "Test notification sent successfully!"})
        else:
            return jsonify({"success": False, "error": err}), 400
    except Exception as e:
        logger.exception("Error testing notification connection")
        return jsonify({"success": False, "error": "Failed to test notification connection"}), 500
