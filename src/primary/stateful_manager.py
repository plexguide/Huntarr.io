#!/usr/bin/env python3
"""
Stateful Manager for Huntarr
Handles storing and retrieving processed media IDs to prevent reprocessing
Now uses SQLite database instead of JSON files for better performance and reliability.
"""

import datetime
import logging
import time
from typing import Any

from src.primary.settings_manager import (
    load_instance_settings,
    load_settings,
)
from src.primary.utils.database import get_database
from src.primary.utils.logger import get_logger
from src.primary.utils.timezone_utils import get_user_timezone

stateful_logger = logging.getLogger("stateful_manager")

DEFAULT_HOURS = 168  # Default 7 days (168 hours)
APP_TYPES = ["sonarr", "radarr", "lidarr", "readarr", "whisparr", "eros"]


def add_processed_id(app_type: str, instance_name: str, media_id: str) -> bool:
    """
    Add a media ID to the processed list for a specific app instance.

    Args:
        app_type: The type of app (sonarr, radarr, etc.)
        instance_name: The name of the instance
        media_id: The ID of the processed media

    Returns:
        bool: True if successful, False otherwise (or if state management is disabled)
    """
    if app_type not in APP_TYPES:
        stateful_logger.warning("Unknown app type: %s", app_type)
        return False

    try:
        # First check if state management is enabled for this instance
        instance_hours = 168  # Default
        instance_mode = "custom"

        try:
            settings = load_settings(app_type)

            if settings and 'instances' in settings:
                # Find the matching instance
                for instance in settings['instances']:
                    if instance.get('name') == instance_name:
                        instance_mode = instance.get('state_management_mode', 'custom')
                        instance_hours = instance.get('state_management_hours', 168)

                        # If state management is disabled for this instance, don't add to processed list
                        if instance_mode == 'disabled':
                            stateful_logger.debug("State management disabled for %s/%s, not adding item %s to processed list", app_type, instance_name, media_id)
                            return True  # Return True to indicate "success" (no error), but item wasn't actually added
                        break
        except Exception as e:
            stateful_logger.warning("Could not check state management mode for %s/%s: %s", app_type, instance_name, e)
            # Fall back to adding anyway if we can't determine the mode

        db = get_database()

        # Initialize per-instance state management if not already done
        db.initialize_instance_state_management(app_type, instance_name, instance_hours)

        # Check if this instance's state has expired
        if db.check_instance_expiration(app_type, instance_name):
            stateful_logger.info("State management expired for %s/%s, resetting before adding new ID...", app_type, instance_name)
            db.reset_instance_state_management(app_type, instance_name, instance_hours)

        # Check if already processed
        if db.is_processed(app_type, instance_name, media_id):
            stateful_logger.debug("[add_processed_id] ID %s already in database for %s/%s", media_id, app_type, instance_name)
            return True

        # Add the new ID
        success = db.add_processed_id(app_type, instance_name, media_id)
        if success:
            stateful_logger.debug("[add_processed_id] Added ID %s to database for %s/%s", media_id, app_type, instance_name)

        return success
    except Exception as e:
        stateful_logger.error("Error adding media ID %s to database: %s", media_id, e)
        return False


def is_processed(app_type: str, instance_name: str, media_id: str) -> bool:
    """
    Check if a media ID has already been processed.

    Args:
        app_type: The type of app (sonarr, radarr, etc.)
        instance_name: The name of the instance
        media_id: The ID of the media to check

    Returns:
        bool: True if already processed, False otherwise (or if state management is disabled)
    """
    try:
        # First check if state management is enabled for this instance
        instance_hours = 168  # Default
        instance_mode = "custom"

        try:
            settings = load_settings(app_type)

            if settings and 'instances' in settings:
                # Find the matching instance
                for instance in settings['instances']:
                    if instance.get('name') == instance_name:
                        instance_mode = instance.get('state_management_mode', 'custom')
                        instance_hours = instance.get('state_management_hours', 168)

                        # If state management is disabled for this instance, always return False (not processed)
                        if instance_mode == 'disabled':
                            stateful_logger.debug("State management disabled for %s/%s, treating item %s as unprocessed", app_type, instance_name, media_id)
                            return False
                        break
        except Exception as e:
            stateful_logger.warning("Could not check state management mode for %s/%s: %s", app_type, instance_name, e)
            # Fall back to checking anyway if we can't determine the mode

        db = get_database()

        # Initialize per-instance state management if not already done
        db.initialize_instance_state_management(app_type, instance_name, instance_hours)

        # Check if this instance's state has expired
        if db.check_instance_expiration(app_type, instance_name):
            stateful_logger.info("State management expired for %s/%s, resetting...", app_type, instance_name)
            db.reset_instance_state_management(app_type, instance_name, instance_hours)
            # After reset, item is not processed
            return False

        # Converting media_id to string since some callers might pass an integer
        media_id_str = str(media_id)
        is_in_db = db.is_processed(app_type, instance_name, media_id_str)

        # Get total count for logging
        processed_ids = db.get_processed_ids(app_type, instance_name)
        total_count = len(processed_ids)

        stateful_logger.info("is_processed check: %s/%s, ID:%s, Found:%s, Total IDs:%d", app_type, instance_name, media_id_str, is_in_db, total_count)

        return is_in_db
    except Exception as e:
        stateful_logger.error("Error checking if processed for %s/%s, ID:%s: %s", app_type, instance_name, media_id, e)
        return False


def get_instance_state_management_summary(app_type: str, instance_name: str) -> dict[str, Any]:
    """
    Get a summary of stateful management for an app instance.

    Args:
        app_type: The type of app (sonarr, radarr, etc.)
        instance_name: The name of the instance

    Returns:
        dict containing processed count, next reset time, and other useful info
    """
    try:
        settings = load_instance_settings(app_type, instance_name)

        if settings["state_management_mode"] == "disabled":
            return {
                "state_management_mode": settings["state_management_mode"],
                "state_management_enabled": False,
                "processed_count": 0,
                "next_reset_time": None,
                "state_management_hours": settings["state_management_hours"],
                "has_processed_items": False
            }

        db = get_database()

        # Initialize per-instance state management if not already done
        db.initialize_instance_state_management(app_type, instance_name, settings["state_management_hours"])

        # Get per-instance lock info for accurate next reset time
        lock_info = db.get_instance_lock_info(app_type, instance_name)
        if lock_info and lock_info.get("expires_at"):
            expires_at = lock_info["expires_at"]
            # Convert to user timezone for display
            user_tz = get_user_timezone()
            utc_time = datetime.datetime.fromtimestamp(expires_at, tz=datetime.timezone.utc)
            local_time = utc_time.astimezone(user_tz)
            next_reset_time = local_time.strftime('%Y-%m-%d %H:%M:%S')
        else:
            # This should not happen since initialize_instance_state_management was called above
            stateful_logger.warning("No lock info found for %s/%s after initialization", app_type, instance_name)
            next_reset_time = None

        # Get processed IDs count
        processed_ids = db.get_processed_ids(app_type, instance_name)
        processed_count = len(processed_ids)

        return {
            "state_management_mode": settings["state_management_mode"],
            "state_management_enabled": settings["state_management_mode"] != "disabled",
            "processed_count": processed_count,
            "next_reset_time": next_reset_time,
            "state_management_hours": settings["state_management_hours"],
            "has_processed_items": processed_count > 0
        }
    except Exception as e:
        stateful_logger.error("Error getting state management summary for %s/%s: %s", app_type, instance_name, e)
        return {
            "state_management_mode": "custom",
            "state_management_enabled": True,
            "processed_count": 0,
            "next_reset_time": None,
            "state_management_hours": DEFAULT_HOURS,
            "has_processed_items": False
        }


def has_instance_state_expired(app_type: str, instance_name: str) -> bool:
    """
    Check if the instance's state needs to be reset based on the reset interval.

    Args:
        app_type: The type of app (sonarr, radarr, etc.)
        instance_name: The name of the instance for which to reset state

    Returns:
        bool: True if the state has expired, False otherwise.
    """
    lock_info = get_database().get_instance_lock_info(app_type, instance_name)

    get_logger(app_type).debug(
        "State check for %s.%s: %.1f hours since last reset (interval: %dh)",
        app_type,
        instance_name,
        (time.time() - lock_info.get("created_at")) / 3600,  # hours since last reset
        lock_info.get("expiration_hours"),
    )

    return int(time.time()) >= lock_info.get("expires_at", float('inf'))


def reset_instance_state_management(app_type: str, instance_name: str) -> bool:
    """
    Reset the state management for a specific app instance.

    Args:
        app_type: The type of app (sonarr, radarr, etc.)
        instance_name: The name of the instance for which to reset state

    Returns:
        bool: True if successful, False otherwise.
    """
    settings = load_instance_settings(app_type, instance_name)
    return get_database().reset_instance_state_management(
        app_type,
        instance_name,
        settings["state_management_hours"],
    )
