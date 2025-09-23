#!/usr/bin/env python3
"""
Stateful Manager for Huntarr
Handles storing and retrieving processed media IDs to prevent reprocessing
"""

import datetime
import logging
import time
from typing import Any

from src.primary.settings_manager import load_settings, load_instance_settings
from src.primary.utils.database import get_database
from src.primary.utils.timezone_utils import get_user_timezone

logger = logging.getLogger("stateful_manager")

DEFAULT_HOURS = 168  # Default 7 days (168 hours)
APP_TYPES = ["sonarr", "radarr", "lidarr", "readarr", "whisparr", "eros"]


def initialize_state_management():
    """
    Initialize reset intervals for all app instances based on their settings.
    """
    for app in APP_TYPES:

        try:
            app_settings = load_settings(app)
        except Exception as e:
            logger.error("Skipping %s. Could not load settings: %s", app, e)
            continue

        for i, instance_settings in enumerate(app_settings.get("instances", [])):

            try:
                instance_enabled = instance_settings["enabled"]
                instance_name = instance_settings["name"]
            except KeyError as e:
                logger.error(
                    "Skipping initialization of instance %d in %s app. Missing setting: %s",
                    i, app, e,
                )
                continue

            try:
                instance_initialized = get_database().get_instance_lock_info(app, instance_name)
            except Exception as e:
                logger.error(
                    "Skipping initialization of %s/%s. Could not verify existing lock: %s",
                    app, instance_name, e,
                )
                continue

            if not instance_enabled or instance_initialized:
                continue  # Skip disabled or already initialized instances

            initialize_instance_state_management(
                app,
                instance_settings["name"],
                instance_settings["state_management_hours"],
            )


def initialize_instance_state_management(app: str, instance: str, expiration_hours: int) -> bool:
    """
    Initialize state management for a specific app instance.

    Args:
        app: The type of app (sonarr, radarr, etc.)
        instance: The name of the instance
        expiration_hours: The duration for state management in hours

    Returns:
        bool: True if initialization was successful, False otherwise
    """
    if app not in APP_TYPES:
        logger.error("Unknown app type: %s", app)
        return False

    current_time = int(time.time())
    expires_at = current_time + (expiration_hours * 3600)

    try:
        db = get_database()
        db.set_instance_lock_info(app, instance, current_time, expires_at, expiration_hours)
    except Exception as e:
        logger.error("Error initializing state management for %s/%s: %s", app, instance, e)
        return False

    logger.info(
        "Initialized state management for %s/%s with %dh interval",
        app, instance, expiration_hours,
    )

    return True


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
        logger.warning("Unknown app type: %s", app_type)
        return False

    if is_processed(app_type, instance_name, media_id):
        logger.info("[add_processed_id] ID %s already in database for %s/%s", media_id, app_type, instance_name)
        return True

    try:
        get_database().add_processed_id(app_type, instance_name, media_id)
    except Exception as e:
        logger.error("Error adding media ID %s to database: %s", media_id, e)

    logger.info("[add_processed_id] Added ID %s to database for %s/%s", media_id, app_type, instance_name)

    return True


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
    if app_type not in APP_TYPES:
        logger.warning("Unknown app type: %s", app_type)
        return False

    media_id = str(media_id)  # Ensure media_id is a string for consistent checking

    try:
        processed_ids = get_database().get_processed_ids(app_type, instance_name)
    except Exception as e:
        logger.error("Could not load processed IDs for %s/%s: %s", app_type, instance_name, e)
        return False

    is_item_processed = media_id in processed_ids
    total_processed_ids = len(processed_ids)

    logger.info(
        "is_processed check: %s/%s, ID:%s, Found:%s, Total IDs:%d",
        app_type, instance_name, media_id, is_item_processed, total_processed_ids,
    )

    return is_item_processed


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
            logger.warning("No lock info found for %s/%s after initialization", app_type, instance_name)
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
        logger.error("Error getting state management summary for %s/%s: %s", app_type, instance_name, e)
        return {
            "state_management_mode": "custom",
            "state_management_enabled": True,
            "processed_count": 0,
            "next_reset_time": None,
            "state_management_hours": DEFAULT_HOURS,
            "has_processed_items": False
        }


def should_state_management_reset(app: str, instance: str) -> bool:
    """
    Check if the instance's state needs to be reset based on the reset interval.

    Args:
        app: The type of app (sonarr, radarr, etc.)
        instance: The name of the instance for which to reset state

    Returns:
        bool: True if the state has expired, False otherwise.
    """
    if app not in APP_TYPES:
        logger.error("Unknown app type: %s", app)
        return False

    try:
        lock_info = get_database().get_instance_lock_info(app, instance)
    except Exception as e:
        logger.error("Could not load lock info for %s/%s: %s", app, instance, e)
        return False

    logger.info(
        "State check for %s.%s: %.1f hours since last reset (interval: %dh)",
        app,
        instance,
        (time.time() - lock_info.get("created_at")) / 3600,  # hours since last reset
        lock_info.get("expiration_hours"),
    )

    return int(time.time()) >= lock_info.get("expires_at", float('inf'))


def reset_state_management(app: str, instance: str) -> bool:
    """
    Reset the state management for a specific app instance.

    Args:
        app: The type of app (sonarr, radarr, etc.)
        instance: The name of the instance for which to reset state

    Returns:
        bool: True if successful, False otherwise.
    """
    if app not in APP_TYPES:
        logger.error("Unknown app type: %s", app)
        return False

    try:
        settings = load_instance_settings(app, instance)
        state_management_hours = settings["state_management_hours"]
    except Exception as e:
        logger.error("Could not load settings for %s/%s: %s", app, instance, e)
        state_management_hours = DEFAULT_HOURS

    now = int(time.time())
    expires_at = now + (state_management_hours * 3600)

    try:
        db = get_database()
        db.clear_instance_processed_ids(app, instance)
        db.set_instance_lock_info(app, instance, now, expires_at, state_management_hours)
    except Exception as e:
        logger.error("Error resetting state management for %s/%s: %s", app, instance, e)
        return False

    return True
