#!/usr/bin/env python3
"""
Hunt Manager for Huntarr
Handles storing and retrieving processed media history using manager.db
"""

import time
from datetime import datetime
import threading
import logging
from typing import Dict, Any, Optional

# Create a logger
logger = logging.getLogger(__name__)

# Import manager database
from src.primary.utils.database import get_manager_database

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
        logger.error(f"Invalid app type: {app_type}")
        return None
    
    # Extract instance name from entry data
    instance_name = entry_data.get("instance_name", "Default")
    
    logger.debug(f"Adding history entry for {app_type} with instance_name: '{instance_name}'")
    
    # Thread-safe database operation
    with history_locks[app_type]:
        try:
            manager_db = get_manager_database()
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
            
            logger.info(f"Added history entry for {app_type}-{instance_name}: {entry_data['name']}")
            
            # Send notification about this history entry
            try:
                # Import here to avoid circular imports
                from src.primary.notification_manager import send_history_notification
                send_history_notification(entry)
            except Exception as e:
                logger.error(f"Failed to send notification for history entry: {e}")
            
            return entry
            
        except Exception as e:
            logger.error(f"Database error adding history entry for {app_type}: {e}")
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
        logger.error(f"Invalid app type: {app_type}")
        return {"entries": [], "total_entries": 0, "total_pages": 0, "current_page": 1}
    
    try:
        manager_db = get_manager_database()
        result = manager_db.get_hunt_history(
            app_type=app_type,
            search_query=search_query,
            page=page,
            page_size=page_size
        )
        
        logger.debug(f"Retrieved {len(result['entries'])} history entries for {app_type} (page {page})")
        return result
        
    except Exception as e:
        logger.error(f"Database error getting history for {app_type}: {e}")
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
        logger.error(f"Invalid app type: {app_type}")
        return False
    
    try:
        manager_db = get_manager_database()
        manager_db.clear_hunt_history(app_type)
        logger.info(f"Successfully cleared hunt history for {app_type}")
        return True
        
    except Exception as e:
        logger.error(f"Database error clearing history for {app_type}: {e}")
        return False

def handle_instance_rename(app_type, old_instance_name, new_instance_name):
    """
    Handle renaming of an instance by updating history entries in the database.
    
    Parameters:
    - app_type: str - The app type (sonarr, radarr, etc)
    - old_instance_name: str - Previous instance name
    - new_instance_name: str - New instance name
    
    Returns:
    - bool - Success or failure
    """
    if app_type not in history_locks:
        logger.error(f"Invalid app type: {app_type}")
        return False
    
    # If names are the same, nothing to do
    if old_instance_name == new_instance_name:
        return True
    
    logger.info(f"Handling instance rename for {app_type}: {old_instance_name} -> {new_instance_name}")
    
    # Thread-safe operation
    with history_locks[app_type]:
        try:
            manager_db = get_manager_database()
            manager_db.handle_instance_rename(app_type, old_instance_name, new_instance_name)
            return True
            
        except Exception as e:
            logger.error(f"Database error renaming instance history: {e}")
            return False

# No longer need to run synchronization on module import since we're using database
logger.info("History manager initialized with database backend")
