#!/usr/bin/env python3

import time
from src.primary.history_manager import add_history_entry
from src.primary.utils.logger import get_logger

logger = get_logger("history")

# Cache to prevent duplicate log entries within a short time window
_recent_log_entries = {}
_DUPLICATE_WINDOW_SECONDS = 30

def log_processed_media(app_type, media_name, media_id, instance_name, operation_type="missing"):
    """
    Log when media is processed by an app instance
    
    Parameters:
    - app_type: str - The app type (sonarr, radarr, etc)
    - media_name: str - Name of the processed media
    - media_id: str/int - ID of the processed media
    - instance_name: str - Name of the instance that processed it
    - operation_type: str - Type of operation ("missing" or "upgrade")
    
    Returns:
    - bool - Success or failure
    """
    try:
        # Create a unique key for this log entry
        entry_key = f"{app_type}|{instance_name}|{media_name}|{operation_type}"
        current_time = time.time()
        
        # Check if this exact entry was logged recently
        if entry_key in _recent_log_entries:
            last_logged = _recent_log_entries[entry_key]
            if current_time - last_logged < _DUPLICATE_WINDOW_SECONDS:
                logger.debug(f"Skipping duplicate history entry for {app_type} - {instance_name}: {media_name} (last logged {current_time - last_logged:.1f}s ago)")
                return True
        
        # Clean up old entries from cache
        expired_keys = [k for k, v in _recent_log_entries.items() if current_time - v > _DUPLICATE_WINDOW_SECONDS]
        for key in expired_keys:
            del _recent_log_entries[key]
        
        logger.debug(f"Logging history entry for {app_type} - {instance_name}: '{media_name}' (ID: {media_id})")
        
        entry_data = {
            "name": media_name,
            "id": str(media_id),
            "instance_name": instance_name,
            "operation_type": operation_type
        }
        
        result = add_history_entry(app_type, entry_data)
        if result:
            # Record this entry in our cache
            _recent_log_entries[entry_key] = current_time
            logger.info(f"Logged history entry for {app_type} - {instance_name}: {media_name} ({operation_type})")
            return True
        else:
            logger.error(f"Failed to log history entry for {app_type} - {instance_name}: {media_name}")
            return False
    except Exception as e:
        logger.error(f"Error logging history entry: {str(e)}")
        return False
