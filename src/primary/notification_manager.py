#!/usr/bin/env python3
"""
Notification manager for Huntarr
Handles sending notifications via Apprise
"""

import logging

# Lazy import Apprise to avoid startup issues if the package is not installed
apprise_import_error = None
try:
    import apprise
except ImportError as e:
    apprise_import_error = str(e)

from src.primary.settings_manager import load_settings

# Create a logger for the notification manager
logger = logging.getLogger(__name__)


def get_notification_config():
    """
    Get the notification configuration from general settings

    Returns:
        dict: The notification configuration
    """
    general_settings = load_settings('general')
    notification_config = {
        'enabled': general_settings.get('enable_notifications', False),
        'level': general_settings.get('notification_level', 'info'),
        'apprise_urls': general_settings.get('apprise_urls', []),
        'notify_on_missing': general_settings.get('notify_on_missing', True),
        'notify_on_upgrade': general_settings.get('notify_on_upgrade', True),
        'include_instance_name': general_settings.get('notification_include_instance', True),
        'include_app_name': general_settings.get('notification_include_app', True)
    }

    return notification_config


def create_apprise_object():
    """
    Create and configure an Apprise object with the URLs from settings

    Returns:
        apprise.Apprise: Configured Apprise object or None if there was an error
    """
    if apprise_import_error:
        logger.error(f"Apprise is not available: {apprise_import_error}")
        return None

    config = get_notification_config()

    if not config['enabled'] or not config['apprise_urls']:
        return None

    try:
        # Create an Apprise instance
        apobj = apprise.Apprise()

        # Add all the URLs to our Apprise object
        for url in config['apprise_urls']:
            if url and url.strip():
                added = apobj.add(url.strip())
                if added:
                    logger.debug(f"Added Apprise URL: {url[:15]}...")
                else:
                    logger.warning(f"Failed to add Apprise URL: {url[:15]}...")

        return apobj
    except Exception as e:
        logger.error(f"Error creating Apprise object: {e}")
        return None


def send_notification(title, message, level='info', attach=None):
    """
    Send a notification via Apprise

    Args:
        title (str): The notification title
        message (str): The notification message
        level (str): The notification level (info, success, warning, error)
        attach (str, optional): Path to a file to attach

    Returns:
        bool: True if notification was sent successfully, False otherwise
    """
    if apprise_import_error:
        logger.error(f"Cannot send notification, Apprise is not available: {apprise_import_error}")
        return False

    config = get_notification_config()

    if not config['enabled']:
        logger.debug("Notifications are disabled in settings")
        return False

    # Check if the notification level is high enough to send
    levels = {
        'debug': 0,
        'info': 1,
        'success': 1,
        'warning': 2,
        'error': 3
    }

    if levels.get(level, 0) < levels.get(config['level'], 1):
        logger.debug(f"Notification level {level} is below configured level {config['level']}")
        return False

    # Create Apprise object
    apobj = create_apprise_object()
    if not apobj:
        return False

    # Set notification type based on level
    notify_type = apprise.NotifyType.INFO

    if level == 'success':
        notify_type = apprise.NotifyType.SUCCESS
    elif level == 'warning':
        notify_type = apprise.NotifyType.WARNING
    elif level == 'error':
        notify_type = apprise.NotifyType.FAILURE

    try:
        # Send notification
        result = apobj.notify(
            body=message,
            title=title,
            notify_type=notify_type,
            attach=attach
        )

        logger.info(f"Notification sent (level={level}): {title}")
        return result

    except Exception as e:
        logger.error(f"Failed to send notification: {e}")
        return False


def send_history_notification(entry_data, operation_type=None):
    """
    Send a notification about a history entry

    Args:
        entry_data (dict): The history entry data
        operation_type (str, optional): Override the operation type

    Returns:
        bool: True if notification was sent successfully, False otherwise
    """
    config = get_notification_config()

    if not config['enabled']:
        return False

    # Skip if we shouldn't notify on this operation type
    op_type = operation_type or entry_data.get('operation_type', 'missing')
    if op_type == 'missing' and not config.get('notify_on_missing', True):
        return False
    if op_type == 'upgrade' and not config.get('notify_on_upgrade', True):
        return False

    # Determine notification level based on operation type
    level = 'info'
    if op_type == 'error':
        level = 'error'
    elif op_type == 'upgrade':
        level = 'success'

    # Build notification title
    title_parts = ["Huntarr"]

    if config.get('include_app_name', True) and 'app_type' in entry_data:
        app_type = entry_data['app_type']
        # Capitalize app name
        title_parts.append(app_type.capitalize())

    if config.get('include_instance_name', True) and 'instance_name' in entry_data:
        title_parts.append(f"({entry_data['instance_name']})")

    title = " ".join(title_parts)

    # Build notification message
    if op_type == 'missing':
        message = f"Added Missing: {entry_data.get('processed_info', 'Unknown')}"
    elif op_type == 'upgrade':
        message = f"Added Upgrade: {entry_data.get('processed_info', 'Unknown')}"
    elif op_type == 'error':
        message = f"Error Processing: {entry_data.get('processed_info', 'Unknown')}"
    else:
        message = f"{op_type.capitalize()}: {entry_data.get('processed_info', 'Unknown')}"

    # Send the notification
    return send_notification(title, message, level=level)


# Example usage (for testing)
if __name__ == "__main__":
    logging.basicConfig(level=logging.DEBUG,
                        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
                        datefmt='%Y-%m-%d %H:%M:%S')

    # Test notification
    result = send_notification(
        title="Huntarr Test Notification",
        message="This is a test notification from Huntarr",
        level="info"
    )

    logger.info(f"Notification result: {result}")
