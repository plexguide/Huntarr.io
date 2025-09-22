#!/usr/bin/env python3
"""
Hunt Manager for Huntarr
Handles storing and retrieving processed media history using manager.db
"""

import threading
import logging

from src.primary.notification_manager import send_history_notification
from src.primary.utils.database import get_database

logger = logging.getLogger(__name__)

# Lock to prevent race conditions during database operations
history_locks = {
    "sonarr": threading.Lock(),
    "radarr": threading.Lock(),
    "lidarr": threading.Lock(),
    "readarr": threading.Lock(),
    "whisparr": threading.Lock(),
    "eros": threading.Lock(),
    "swaparr": threading.Lock()
}


def add_history_entry(app_type, entry_data):
    """
    Add a history entry for processed media

    Parameters:
    - app_type: str - The app type (sonarr, radarr, etc)
    - entry_data: dict - Entry data containing id, name, operation_type, instance_name

    Returns:
    - dict - The created history entry or None if failed
    """
    if app_type not in history_locks:
        logger.error("Invalid app type: %s", app_type)
        return None

    # Extract instance name from entry data
    instance_name = entry_data.get("instance_name", "Default")
    logger.debug("Adding history entry for %s with instance_name: '%s'", app_type, instance_name)

    # Thread-safe database operation
    with history_locks[app_type]:
        try:
            manager_db = get_database()
            entry = manager_db.add_hunt_history_entry(
                app_type=app_type,
                instance_name=instance_name,
                media_id=entry_data["id"],
                processed_info=entry_data["name"],
                operation_type=entry_data.get("operation_type", "missing"),
                discovered=False  # Default to false - will be updated by discovery tracker
            )

            # Add additional fields for compatibility
            entry["app_type"] = app_type  # Include app_type in the entry for display in UI

            logger.info("Added history entry for %s-%s: %s", app_type, instance_name, entry_data['name'])

            try:
                send_history_notification(entry)
            except Exception as e:
                logger.error("Failed to send notification for history entry: %s", e)

            return entry

        except Exception as e:
            logger.error("Database error adding history entry for %s: %s", app_type, e)
            return None


def get_history(app_type, search_query=None, page=1, page_size=20):
    """
    Get history entries for an app

    Parameters:
    - app_type: str - The app type (sonarr, radarr, etc)
    - search_query: str - Optional search query to filter results
    - page: int - Page number (1-based)
    - page_size: int - Number of entries per page

    Returns:
    - dict with entries, total_entries, and total_pages
    """
    if app_type not in history_locks and app_type != "all":
        logger.error("Invalid app type: %s", app_type)
        return {"entries": [], "total_entries": 0, "total_pages": 0, "current_page": 1}

    try:
        manager_db = get_database()
        result = manager_db.get_hunt_history(
            app_type=app_type,
            search_query=search_query,
            page=page,
            page_size=page_size
        )

        logger.debug("Retrieved %d history entries for %s (page %d)", len(result['entries']), app_type, page)
        return result

    except Exception as e:
        logger.error("Database error getting history for %s: %s", app_type, e)
        return {"entries": [], "total_entries": 0, "total_pages": 0, "current_page": 1}


def clear_history(app_type):
    """
    Clear history for an app

    Parameters:
    - app_type: str - The app type (sonarr, radarr, etc) or "all" to clear all history

    Returns:
    - bool - Success or failure
    """
    if app_type not in history_locks and app_type != "all":
        logger.error("Invalid app type: %s", app_type)
        return False

    try:
        manager_db = get_database()
        manager_db.clear_hunt_history(app_type)
        logger.info("Successfully cleared hunt history for %s", app_type)
        return True

    except Exception as e:
        logger.error("Database error clearing history for %s: %s", app_type, e)
        return False

# No longer need to run synchronization on module import since we're using database
logger.info("History manager initialized with database backend")
