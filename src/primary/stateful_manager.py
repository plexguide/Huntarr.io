#!/usr/bin/env python3
"""
Stateful Manager for Huntarr
Handles storing and retrieving processed media IDs to prevent reprocessing
Now uses SQLite database instead of JSON files for better performance and reliability.
"""

import datetime
import logging
import time
from typing import Dict, Any, Set

import pytz

from src.primary.settings_manager import (
    get_advanced_setting,
    load_instance_settings,
    load_settings,
)
from src.primary.utils.database import get_database
from src.primary.utils.logger import get_logger

logger = get_logger("huntarr")
stateful_logger = logging.getLogger("stateful_manager")

DEFAULT_HOURS = 168  # Default 7 days (168 hours)
APP_TYPES = ["sonarr", "radarr", "lidarr", "readarr", "whisparr", "eros"]


def initialize_lock_file() -> None:
    """Initialize the lock file with the current timestamp if it doesn't exist."""
    db = get_database()
    lock_info = db.get_stateful_lock_info()

    if not lock_info:
        try:
            current_time = int(time.time())
            # Get the expiration hours setting
            expiration_hours = get_advanced_setting("stateful_management_hours", DEFAULT_HOURS)

            expires_at = current_time + (expiration_hours * 3600)

            db.set_stateful_lock_info(current_time, expires_at)
            stateful_logger.info("Initialized stateful lock in database with expiration in %d hours", expiration_hours)
        except Exception as e:
            stateful_logger.error("Error initializing stateful lock: %s", e)


def get_lock_info() -> Dict[str, Any]:
    """Get the current lock information."""
    initialize_lock_file()
    db = get_database()

    try:
        lock_info = db.get_stateful_lock_info()

        # Validate the structure and ensure required fields exist
        if not lock_info or "created_at" not in lock_info:
            current_time = int(time.time())
            expiration_hours = get_advanced_setting("stateful_management_hours", DEFAULT_HOURS)
            expires_at = current_time + (expiration_hours * 3600)

            lock_info = {
                "created_at": current_time,
                "expires_at": expires_at
            }
            db.set_stateful_lock_info(current_time, expires_at)

        if "expires_at" not in lock_info or lock_info["expires_at"] is None:
            # Recalculate expiration if missing
            expiration_hours = get_advanced_setting("stateful_management_hours", DEFAULT_HOURS)
            expires_at = lock_info["created_at"] + (expiration_hours * 3600)
            lock_info["expires_at"] = expires_at

            # Save the updated info
            db.set_stateful_lock_info(lock_info["created_at"], expires_at)

        return lock_info
    except Exception as e:
        stateful_logger.error("Error reading lock info from database: %s", e)
        # Return default values if there's an error
        current_time = int(time.time())
        expiration_hours = get_advanced_setting("stateful_management_hours", DEFAULT_HOURS)
        expires_at = current_time + (expiration_hours * 3600)

        return {
            "created_at": current_time,
            "expires_at": expires_at
        }


def update_lock_expiration(hours: int = None) -> bool:
    """Update the lock expiration based on the hours setting."""
    if hours is None:
        expiration_hours = get_advanced_setting("stateful_management_hours", DEFAULT_HOURS)
    else:
        expiration_hours = hours

    lock_info = get_lock_info()
    created_at = lock_info.get("created_at", int(time.time()))
    expires_at = created_at + (expiration_hours * 3600)

    try:
        db = get_database()
        db.set_stateful_lock_info(created_at, expires_at)
        stateful_logger.info("Updated lock expiration to %s", datetime.datetime.fromtimestamp(expires_at))
        return True
    except Exception as e:
        stateful_logger.error("Error updating lock expiration: %s", e)
        return False


def reset_stateful_management() -> bool:
    """
    Reset the stateful management system.

    This involves:
    1. Creating a new lock file with the current timestamp and a calculated expiration time
       based on the 'stateful_management_hours' setting.
    2. Deleting all stored processed ID data from the database.

    Returns:
        bool: True if the reset was successful, False otherwise.
    """
    try:
        db = get_database()

        # Get the expiration hours setting BEFORE writing the lock info
        expiration_hours = get_advanced_setting("stateful_management_hours", DEFAULT_HOURS)

        # Create new lock info with calculated expiration
        current_time = int(time.time())
        expires_at = current_time + (expiration_hours * 3600)

        # Clear all stateful data and set new lock info
        db.clear_all_stateful_data()
        db.set_stateful_lock_info(current_time, expires_at)

        stateful_logger.info("Successfully reset stateful management. New expiration: %s", datetime.datetime.fromtimestamp(expires_at))
        return True
    except Exception as e:
        stateful_logger.error("Error resetting stateful management: %s", e)
        return False


def check_expiration() -> bool:
    """
    Check if the stateful management has expired.

    Returns:
        bool: True if expired, False otherwise
    """
    lock_info = get_lock_info()
    expires_at = lock_info.get("expires_at")

    # If expires_at is None, update it based on settings
    if expires_at is None:
        update_lock_expiration()
        lock_info = get_lock_info()
        expires_at = lock_info.get("expires_at")

    current_time = int(time.time())

    if current_time >= expires_at:
        stateful_logger.info("Stateful management has expired, resetting...")
        reset_stateful_management()
        return True

    return False


def get_processed_ids(app_type: str, instance_name: str) -> Set[str]:
    """
    Get the set of processed media IDs for a specific app instance.

    Args:
        app_type: The type of app (sonarr, radarr, etc.)
        instance_name: The name of the instance

    Returns:
        Set[str]: Set of processed media IDs
    """
    if app_type not in APP_TYPES:
        stateful_logger.warning("Unknown app type: %s", app_type)
        return set()

    try:
        db = get_database()
        processed_ids_set = db.get_processed_ids(app_type, instance_name)
        stateful_logger.debug("[get_processed_ids] Read %d IDs from database for %s/%s: %s", len(processed_ids_set), app_type, instance_name, processed_ids_set)
        return processed_ids_set
    except Exception as e:
        stateful_logger.error("Error reading processed IDs for %s from database: %s", instance_name, e)
        return set()


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


def get_stateful_management_info() -> Dict[str, Any]:
    """Get information about the stateful management system."""
    lock_info = get_lock_info()
    created_at_ts = lock_info.get("created_at")
    expires_at_ts = lock_info.get("expires_at")

    # Get the interval setting
    expiration_hours = get_advanced_setting("stateful_management_hours", DEFAULT_HOURS)

    return {
        "created_at_ts": created_at_ts,
        "expires_at_ts": expires_at_ts,
        "interval_hours": expiration_hours
    }


def get_instance_state_management_summary(app_type: str, instance_name: str) -> Dict[str, Any]:
    """
    Get a summary of stateful management for an app instance.

    Args:
        app_type: The type of app (sonarr, radarr, etc.)
        instance_name: The name of the instance

    Returns:
        Dict containing processed count, next reset time, and other useful info
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
            user_tz = _get_user_timezone()
            utc_time = datetime.datetime.fromtimestamp(expires_at, tz=datetime.timezone.utc)
            local_time = utc_time.astimezone(user_tz)
            next_reset_time = local_time.strftime('%Y-%m-%d %H:%M:%S')
        else:
            # This should not happen since initialize_instance_state_management was called above
            stateful_logger.warning("No lock info found for %s/%s after initialization", app_type, instance_name)
            next_reset_time = None

        # Get processed IDs count
        processed_ids = get_processed_ids(app_type, instance_name)
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

    logger.debug(
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
    return get_database().reset_instance_state_management(app_type, instance_name, settings["state_management_hours"])


def _get_user_timezone():
    """Get the user's selected timezone from general settings"""
    try:
        from src.primary.utils.timezone_utils import get_user_timezone
        return get_user_timezone()
    except Exception as e:
        stateful_logger.warning("Could not get user timezone, defaulting to UTC: %s", e)
        return pytz.UTC


def initialize_stateful_system():
    """Perform a complete initialization of the stateful management system."""
    stateful_logger.info("Initializing stateful management system")

    # Initialize the database and lock info
    try:
        initialize_lock_file()
        expiration_hours = get_advanced_setting("stateful_management_hours", DEFAULT_HOURS)
        update_lock_expiration(expiration_hours)
        stateful_logger.info("Stateful lock initialized in database with %d hour expiration", expiration_hours)
    except Exception as e:
        stateful_logger.error("Failed to initialize stateful lock: %s", e)

    # Check for existing processed IDs in database
    try:
        db = get_database()
        total_ids = 0
        for app_type in APP_TYPES:
            # Get a sample of instance names to count processed IDs
            # This is a rough count since we don't track instance names separately
            processed_ids = db.get_processed_ids(app_type, "Default")  # Check default instance
            total_ids += len(processed_ids)

        if total_ids > 0:
            stateful_logger.info("Found %d existing processed IDs in database", total_ids)
        else:
            stateful_logger.info("No existing processed IDs found in database")
    except Exception as e:
        stateful_logger.error("Failed to check for existing processed IDs: %s", e)

    stateful_logger.info("Stateful management system initialization complete")


# Initialize the stateful system on module import
initialize_stateful_system()
