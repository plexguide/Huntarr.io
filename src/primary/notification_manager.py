#!/usr/bin/env python3
"""
Notification Manager for Huntarr
Multi-provider notification system supporting Discord, Telegram, Slack,
Pushover, Pushbullet, Email, Notifiarr, Apprise, and Webhook.

Each notification "connection" is stored in the database with:
  - provider type and credentials
  - per-connection event triggers (on_grab, on_import, on_upgrade, on_missing, etc.)
  - include metadata flags (app name, instance name)
"""

import json
import logging
import smtplib
import threading
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Any, Dict, List, Optional
from urllib.parse import urlencode

import requests

logger = logging.getLogger("notifications")

# Try importing Apprise for the Apprise provider
_apprise = None
try:
    import apprise as _apprise_lib
    _apprise = _apprise_lib
except ImportError:
    pass

# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------

def _get_db():
    from src.primary.utils.database import get_database
    return get_database()

def get_all_connections() -> List[Dict[str, Any]]:
    """Return all notification connections from the database."""
    db = _get_db()
    return db.get_notification_connections()

def get_connection(conn_id: int) -> Optional[Dict[str, Any]]:
    """Return a single notification connection by ID."""
    db = _get_db()
    return db.get_notification_connection(conn_id)

def save_connection(data: Dict[str, Any]) -> int:
    """Create or update a notification connection. Returns the connection ID."""
    db = _get_db()
    return db.save_notification_connection(data)

def delete_connection(conn_id: int) -> bool:
    """Delete a notification connection."""
    db = _get_db()
    return db.delete_notification_connection(conn_id)

# ---------------------------------------------------------------------------
# Event / Trigger constants
# ---------------------------------------------------------------------------

# Trigger keys that can be toggled per-connection
TRIGGER_KEYS = [
    "on_grab",           # Media grabbed / search initiated
    "on_import",         # Media file imported
    "on_upgrade",        # Media upgraded to better quality
    "on_missing",        # Missing media processed
    "on_rename",         # Media renamed
    "on_delete",         # Media deleted
    "on_health_issue",   # App health issue detected
    "on_app_update",     # App update available
    "on_manual_required",# Manual interaction required
    "on_test",           # Test notification (always sent)
]

# Default triggers for new connections
DEFAULT_TRIGGERS = {
    "on_grab": True,
    "on_import": True,
    "on_upgrade": True,
    "on_missing": True,
    "on_rename": False,
    "on_delete": True,
    "on_health_issue": False,
    "on_app_update": False,
    "on_manual_required": False,
}

# ---------------------------------------------------------------------------
# Provider definitions — each knows how to send a notification
# ---------------------------------------------------------------------------

PROVIDERS = {}  # populated by register_provider decorator


def register_provider(name):
    """Decorator to register a provider send function."""
    def decorator(fn):
        PROVIDERS[name] = fn
        return fn
    return decorator


def _http_post(url, json_body=None, data=None, headers=None, timeout=15):
    """Helper for HTTP POST with standard error handling."""
    try:
        resp = requests.post(url, json=json_body, data=data, headers=headers, timeout=timeout)
        if resp.status_code >= 400:
            logger.error("HTTP %s from %s: %s", resp.status_code, url[:60], resp.text[:300])
            return False, f"HTTP {resp.status_code}: {resp.text[:200]}"
        return True, "OK"
    except requests.RequestException as e:
        logger.error("Request error for %s: %s", url[:60], e)
        return False, str(e)


# ---- Discord ----
@register_provider("discord")
def _send_discord(settings: dict, title: str, message: str, event: str, **kw) -> tuple:
    """Send via Discord webhook."""
    webhook_url = settings.get("webhook_url", "").strip()
    if not webhook_url:
        return False, "Discord webhook URL is required"

    avatar_url = settings.get("avatar_url", "").strip() or None
    username = settings.get("username", "").strip() or "Huntarr"

    color = _event_color(event)
    embed = {
        "title": title,
        "description": message,
        "color": color,
        "footer": {"text": "Huntarr Notifications"},
    }

    payload = {
        "username": username,
        "embeds": [embed],
    }
    if avatar_url:
        payload["avatar_url"] = avatar_url

    return _http_post(webhook_url, json_body=payload)


# ---- Slack ----
@register_provider("slack")
def _send_slack(settings: dict, title: str, message: str, event: str, **kw) -> tuple:
    """Send via Slack incoming webhook."""
    webhook_url = settings.get("webhook_url", "").strip()
    if not webhook_url:
        return False, "Slack webhook URL is required"

    channel = settings.get("channel", "").strip()
    username = settings.get("username", "").strip() or "Huntarr"
    icon = settings.get("icon_emoji", "").strip() or ":bell:"

    payload = {
        "username": username,
        "icon_emoji": icon,
        "attachments": [{
            "fallback": f"{title}: {message}",
            "color": _event_hex_color(event),
            "title": title,
            "text": message,
            "footer": "Huntarr Notifications",
        }],
    }
    if channel:
        payload["channel"] = channel

    return _http_post(webhook_url, json_body=payload)


# ---- Telegram ----
@register_provider("telegram")
def _send_telegram(settings: dict, title: str, message: str, event: str, **kw) -> tuple:
    """Send via Telegram Bot API."""
    bot_token = settings.get("bot_token", "").strip()
    chat_id = settings.get("chat_id", "").strip()
    if not bot_token or not chat_id:
        return False, "Telegram bot token and chat ID are required"

    send_silently = settings.get("send_silently", False)
    text = f"<b>{title}</b>\n\n{message}"

    url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML",
        "disable_notification": bool(send_silently),
    }
    return _http_post(url, json_body=payload)


# ---- Pushover ----
@register_provider("pushover")
def _send_pushover(settings: dict, title: str, message: str, event: str, **kw) -> tuple:
    """Send via Pushover API."""
    user_key = settings.get("user_key", "").strip()
    api_token = settings.get("api_token", "").strip()
    if not user_key or not api_token:
        return False, "Pushover user key and API token are required"

    priority = int(settings.get("priority", 0))
    sound = settings.get("sound", "").strip() or "pushover"
    devices = settings.get("devices", "").strip()

    payload = {
        "token": api_token,
        "user": user_key,
        "title": title,
        "message": message,
        "priority": priority,
        "sound": sound,
        "html": 1,
    }
    if devices:
        payload["device"] = devices

    # Priority 2 (emergency) requires retry & expire
    if priority == 2:
        payload["retry"] = int(settings.get("retry", 60))
        payload["expire"] = int(settings.get("expire", 3600))

    return _http_post("https://api.pushover.net/1/messages.json", data=payload)


# ---- Pushbullet ----
@register_provider("pushbullet")
def _send_pushbullet(settings: dict, title: str, message: str, event: str, **kw) -> tuple:
    """Send via Pushbullet API."""
    api_key = settings.get("api_key", "").strip()
    if not api_key:
        return False, "Pushbullet API key is required"

    channel_tag = settings.get("channel_tag", "").strip()
    device_iden = settings.get("device_iden", "").strip()

    payload = {
        "type": "note",
        "title": title,
        "body": message,
    }
    if channel_tag:
        payload["channel_tag"] = channel_tag
    if device_iden:
        payload["device_iden"] = device_iden

    headers = {
        "Access-Token": api_key,
        "Content-Type": "application/json",
    }
    return _http_post("https://api.pushbullet.com/v2/pushes", json_body=payload, headers=headers)


# ---- Email (SMTP) ----
@register_provider("email")
def _send_email(settings: dict, title: str, message: str, event: str, **kw) -> tuple:
    """Send via SMTP email."""
    smtp_server = settings.get("smtp_server", "").strip()
    smtp_port = int(settings.get("smtp_port", 587))
    use_ssl = settings.get("use_ssl", False)
    username = settings.get("username", "").strip()
    password = settings.get("password", "").strip()
    from_addr = settings.get("from_address", "").strip() or username
    to_addrs = settings.get("to_addresses", "").strip()

    if not smtp_server or not to_addrs:
        return False, "SMTP server and recipient addresses are required"

    recipients = [a.strip() for a in to_addrs.replace(";", ",").split(",") if a.strip()]

    msg = MIMEMultipart("alternative")
    msg["Subject"] = title
    msg["From"] = from_addr
    msg["To"] = ", ".join(recipients)

    # Plain text body
    msg.attach(MIMEText(message, "plain"))

    # HTML body
    html_body = f"""
    <div style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: #1a1a2e; border-radius: 8px; padding: 20px; color: #e0e0e0;">
            <h2 style="color: #818cf8; margin-top: 0;">{title}</h2>
            <p style="line-height: 1.6;">{message}</p>
            <hr style="border: 1px solid #333;">
            <small style="color: #888;">Sent by Huntarr Notifications</small>
        </div>
    </div>
    """
    msg.attach(MIMEText(html_body, "html"))

    try:
        if use_ssl:
            server = smtplib.SMTP_SSL(smtp_server, smtp_port, timeout=15)
        else:
            server = smtplib.SMTP(smtp_server, smtp_port, timeout=15)
            server.ehlo()
            server.starttls()
            server.ehlo()

        if username and password:
            server.login(username, password)

        server.sendmail(from_addr, recipients, msg.as_string())
        server.quit()
        return True, "OK"
    except Exception as e:
        logger.error("Email send error: %s", e)
        return False, str(e)


# ---- Notifiarr ----
@register_provider("notifiarr")
def _send_notifiarr(settings: dict, title: str, message: str, event: str, **kw) -> tuple:
    """Send via Notifiarr passthrough API."""
    api_key = settings.get("api_key", "").strip()
    if not api_key:
        return False, "Notifiarr API key is required"

    # Notifiarr passthrough notification endpoint
    url = "https://notifiarr.com/api/v1/notification/passthrough"
    
    channel_id = settings.get("discord_channel_id", "").strip()
    
    payload = {
        "notification": {
            "update": False,
            "name": title,
            "event": event or "test",
        },
        "discord": {
            "color": _event_hex_color(event),
            "text": {
                "title": title,
                "content": "",
                "description": message,
                "footer": "Huntarr Notifications",
            },
        },
    }
    
    if channel_id:
        payload["discord"]["ids"] = {"channel": int(channel_id)}

    headers = {"x-api-key": api_key, "Content-Type": "application/json"}
    return _http_post(url, json_body=payload, headers=headers)


# ---- Webhook (generic) ----
@register_provider("webhook")
def _send_webhook(settings: dict, title: str, message: str, event: str, **kw) -> tuple:
    """Send to a generic webhook URL."""
    webhook_url = settings.get("webhook_url", "").strip()
    if not webhook_url:
        return False, "Webhook URL is required"

    method = settings.get("method", "POST").upper()
    headers_raw = settings.get("headers", "").strip()
    
    headers = {"Content-Type": "application/json"}
    if headers_raw:
        try:
            custom_headers = json.loads(headers_raw)
            if isinstance(custom_headers, dict):
                headers.update(custom_headers)
        except json.JSONDecodeError:
            pass

    payload = {
        "event": event,
        "title": title,
        "message": message,
        "source": "huntarr",
    }
    # Merge any extra context passed by the dispatcher
    extra = kw.get("extra_data")
    if extra and isinstance(extra, dict):
        payload["data"] = extra

    try:
        if method == "GET":
            resp = requests.get(webhook_url, params=payload, headers=headers, timeout=15)
        else:
            resp = requests.post(webhook_url, json=payload, headers=headers, timeout=15)
        if resp.status_code >= 400:
            return False, f"HTTP {resp.status_code}"
        return True, "OK"
    except requests.RequestException as e:
        return False, str(e)


# ---- Apprise (catch-all) ----
@register_provider("apprise")
def _send_apprise(settings: dict, title: str, message: str, event: str, **kw) -> tuple:
    """Send via Apprise URLs (supports hundreds of services)."""
    if _apprise is None:
        return False, "Apprise library is not installed"

    urls_raw = settings.get("urls", "").strip()
    if not urls_raw:
        return False, "At least one Apprise URL is required"

    urls = [u.strip() for u in urls_raw.split("\n") if u.strip()]

    try:
        apobj = _apprise.Apprise()
        for url in urls:
            apobj.add(url)

        notify_type = _apprise.NotifyType.INFO
        if event in ("on_upgrade", "on_import"):
            notify_type = _apprise.NotifyType.SUCCESS
        elif event in ("on_health_issue",):
            notify_type = _apprise.NotifyType.WARNING
        elif event in ("on_delete",):
            notify_type = _apprise.NotifyType.FAILURE

        result = apobj.notify(body=message, title=title, notify_type=notify_type)
        return (True, "OK") if result else (False, "Apprise returned False")
    except Exception as e:
        return False, str(e)


# ---------------------------------------------------------------------------
# Color helpers for embeds
# ---------------------------------------------------------------------------

_EVENT_COLORS = {
    "on_grab":       0x818CF8,  # Indigo
    "on_import":     0x34D399,  # Green
    "on_upgrade":    0x60A5FA,  # Blue
    "on_missing":    0xFBBF24,  # Amber
    "on_rename":     0xA78BFA,  # Purple
    "on_delete":     0xF87171,  # Red
    "on_health_issue": 0xF97316,  # Orange
    "on_app_update": 0x2DD4BF,  # Teal
    "on_manual_required": 0xE879F9,  # Fuchsia
    "on_test":       0x818CF8,  # Indigo
}


def _event_color(event: str) -> int:
    return _EVENT_COLORS.get(event, 0x818CF8)


def _event_hex_color(event: str) -> str:
    c = _event_color(event)
    return f"#{c:06x}"


# ---------------------------------------------------------------------------
# Public dispatch API
# ---------------------------------------------------------------------------

def dispatch_notification(event: str, title: str, message: str, extra_data: Optional[dict] = None):
    """
    Dispatch a notification to all enabled connections whose triggers match the event.

    Parameters:
        event: one of TRIGGER_KEYS (e.g. "on_grab", "on_missing")
        title: notification title
        message: notification body
        extra_data: optional dict merged into webhook payloads
    """
    connections = get_all_connections()
    if not connections:
        return

    sent = 0
    for conn in connections:
        if not conn.get("enabled", True):
            continue

        triggers = conn.get("triggers", {})
        if isinstance(triggers, str):
            try:
                triggers = json.loads(triggers)
            except (json.JSONDecodeError, TypeError):
                triggers = {}

        # on_test always goes through
        if event != "on_test" and not triggers.get(event, False):
            continue

        # Check app/instance scope filtering
        if event != "on_test" and extra_data and not _matches_scope(conn, extra_data):
            continue

        provider = conn.get("provider", "")
        settings = conn.get("settings", {})
        if isinstance(settings, str):
            try:
                settings = json.loads(settings)
            except (json.JSONDecodeError, TypeError):
                settings = {}

        send_fn = PROVIDERS.get(provider)
        if not send_fn:
            logger.warning("Unknown notification provider: %s", provider)
            continue

        # Build title with optional app/instance prefix
        full_title = _build_title(title, conn, extra_data)

        try:
            ok, err = send_fn(settings, full_title, message, event, extra_data=extra_data)
            if ok:
                sent += 1
                logger.debug("Notification sent via %s (conn=%s)", provider, conn.get("id"))
            else:
                logger.warning("Notification failed via %s (conn=%s): %s", provider, conn.get("id"), err)
        except Exception as e:
            logger.error("Exception sending via %s (conn=%s): %s", provider, conn.get("id"), e)

    if sent:
        logger.info("Dispatched '%s' notification to %d connection(s)", event, sent)


def test_connection(conn_id: int) -> tuple:
    """
    Send a test notification through a specific connection.
    Returns (success: bool, error_message: str).
    """
    conn = get_connection(conn_id)
    if not conn:
        return False, "Connection not found"

    provider = conn.get("provider", "")
    settings = conn.get("settings", {})
    if isinstance(settings, str):
        try:
            settings = json.loads(settings)
        except (json.JSONDecodeError, TypeError):
            settings = {}

    send_fn = PROVIDERS.get(provider)
    if not send_fn:
        return False, f"Unknown provider: {provider}"

    title = "Huntarr Test Notification"
    message = "This is a test notification from Huntarr. If you see this, your notification connection is working correctly! 🎉"

    try:
        ok, err = send_fn(settings, title, message, "on_test")
        return ok, err
    except Exception as e:
        return False, str(e)


def _matches_scope(conn: dict, extra_data: dict) -> bool:
    """Check if a connection's app/instance scope matches the event's source."""
    app_scope = conn.get("app_scope", "all")
    instance_scope = conn.get("instance_scope", "all")

    if app_scope == "all":
        return True

    event_app = extra_data.get("app_type", "")
    if app_scope != event_app:
        return False

    if instance_scope == "all":
        return True

    event_instance = str(extra_data.get("instance_name", "") or extra_data.get("instance_id", ""))
    return instance_scope == event_instance


def _build_title(base_title: str, conn: dict, extra_data: Optional[dict] = None) -> str:
    """Build notification title with optional app/instance prefix."""
    parts = ["Huntarr"]

    include_app = conn.get("include_app_name", True)
    include_instance = conn.get("include_instance_name", True)

    if extra_data:
        if include_app and extra_data.get("app_type"):
            app_name = extra_data["app_type"]
            if app_name == "movie_hunt":
                app_name = "Movie Hunt"
            else:
                app_name = app_name.capitalize()
            parts.append(app_name)

        if include_instance and extra_data.get("instance_name"):
            parts.append(f"({extra_data['instance_name']})")

    prefix = " ".join(parts)
    return f"{prefix} — {base_title}" if base_title else prefix


# ---------------------------------------------------------------------------
# Legacy compatibility — called from history_manager.py
# ---------------------------------------------------------------------------

def send_history_notification(entry_data: dict, operation_type: str = None):
    """
    Bridge for the existing history_manager call path.
    Maps operation_type to the new event system and dispatches.
    """
    op = operation_type or entry_data.get("operation_type", "missing")

    event_map = {
        "missing": "on_missing",
        "upgrade": "on_upgrade",
        "import": "on_import",
        "grab": "on_grab",
        "error": "on_health_issue",
        "delete": "on_delete",
        "rename": "on_rename",
    }
    event = event_map.get(op, "on_missing")

    # Build a human-friendly message
    info = entry_data.get("processed_info", "Unknown")
    msg_map = {
        "on_missing":  f"Missing media processed: {info}",
        "on_upgrade":  f"Media upgraded: {info}",
        "on_import":   f"Media imported: {info}",
        "on_grab":     f"Media grabbed: {info}",
        "on_delete":   f"Media deleted: {info}",
        "on_rename":   f"Media renamed: {info}",
        "on_health_issue": f"Processing error: {info}",
    }
    message = msg_map.get(event, f"{op.capitalize()}: {info}")

    title_map = {
        "on_missing":  "Missing Media",
        "on_upgrade":  "Media Upgraded",
        "on_import":   "Media Imported",
        "on_grab":     "Media Grabbed",
        "on_delete":   "Media Deleted",
        "on_rename":   "Media Renamed",
        "on_health_issue": "Health Issue",
    }
    title = title_map.get(event, op.capitalize())

    extra = {
        "app_type": entry_data.get("app_type", ""),
        "instance_name": entry_data.get("instance_name", ""),
        "media_id": entry_data.get("media_id", ""),
    }

    dispatch_notification(event, title, message, extra_data=extra)


# Legacy function kept for backward compatibility with test endpoint
def get_notification_config():
    """Return legacy notification config from general settings."""
    from src.primary.settings_manager import load_settings
    gs = load_settings("general")
    return {
        "enabled": gs.get("enable_notifications", False),
        "level": gs.get("notification_level", "info"),
        "apprise_urls": gs.get("apprise_urls", []),
        "notify_on_missing": gs.get("notify_on_missing", True),
        "notify_on_upgrade": gs.get("notify_on_upgrade", True),
        "include_instance_name": gs.get("notification_include_instance", True),
        "include_app_name": gs.get("notification_include_app", True),
    }


def send_notification(title, message, level="info", attach=None):
    """Legacy send_notification — maps to dispatch if connections exist, else Apprise fallback."""
    # Try new system first
    connections = get_all_connections()
    if connections:
        event_map = {"info": "on_missing", "success": "on_import", "warning": "on_health_issue", "error": "on_health_issue"}
        event = event_map.get(level, "on_test")
        dispatch_notification(event, title, message)
        return True

    # Fallback to legacy Apprise
    if _apprise is None:
        return False

    config = get_notification_config()
    if not config["enabled"] or not config["apprise_urls"]:
        return False

    try:
        apobj = _apprise.Apprise()
        for url in config["apprise_urls"]:
            if url and url.strip():
                apobj.add(url.strip())

        notify_type = _apprise.NotifyType.INFO
        if level == "success":
            notify_type = _apprise.NotifyType.SUCCESS
        elif level == "warning":
            notify_type = _apprise.NotifyType.WARNING
        elif level == "error":
            notify_type = _apprise.NotifyType.FAILURE

        return apobj.notify(body=message, title=title, notify_type=notify_type, attach=attach)
    except Exception as e:
        logger.error("Legacy Apprise send failed: %s", e)
        return False
