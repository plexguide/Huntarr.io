#!/usr/bin/env python3
"""
Statistics Manager for Huntarr
Handles tracking, storing, and retrieving statistics about hunted and upgraded media
and monitoring hourly API usage for rate limiting
Now uses SQLite database instead of JSON files for better performance and reliability.
"""

import datetime
import threading
from typing import Dict, Any, Optional
from src.primary.utils.logger import get_logger
from src.primary.utils.database import get_database

logger = get_logger("stats")

# Lock for thread-safe operations
stats_lock = threading.Lock()
hourly_lock = threading.Lock()

# Store the last hour we checked for resetting hourly caps
last_hour_checked = None

# Schedule the next hourly reset check
next_reset_check = None

def load_stats() -> Dict[str, Dict[str, int]]:
    """
    Load statistics from the database
    
    Returns:
        Dictionary containing statistics for each app
    """
    try:
        db = get_database()
        stats = db.get_media_stats()
        
        # Ensure all apps have default structure
        default_stats = get_default_stats()
        for app in default_stats:
            if app not in stats:
                stats[app] = default_stats[app]
            else:
                # Ensure all stat types exist
                for stat_type in default_stats[app]:
                    if stat_type not in stats[app]:
                        stats[app][stat_type] = 0
        
        # Stats loaded - debug spam removed
        return stats
    except Exception as e:
        logger.error(f"Error loading stats from database: {e}")
        return get_default_stats()

def get_default_stats() -> Dict[str, Dict[str, int]]:
    """Get the default statistics structure"""
    return {
        "sonarr": {"hunted": 0, "upgraded": 0},
        "radarr": {"hunted": 0, "upgraded": 0},
        "lidarr": {"hunted": 0, "upgraded": 0},
        "readarr": {"hunted": 0, "upgraded": 0},
        "whisparr": {"hunted": 0, "upgraded": 0},
        "eros": {"hunted": 0, "upgraded": 0}
    }

def get_default_hourly_caps() -> Dict[str, Dict[str, int]]:
    """Get the default hourly caps structure"""
    return {
        "sonarr": {"api_hits": 0},
        "radarr": {"api_hits": 0},
        "lidarr": {"api_hits": 0},
        "readarr": {"api_hits": 0},
        "whisparr": {"api_hits": 0},
        "eros": {"api_hits": 0}
    }

def load_hourly_caps() -> Dict[str, Dict[str, int]]:
    """
    Load hourly API caps from the database
    
    Returns:
        Dictionary containing hourly API usage for each app
    """
    try:
        db = get_database()
        caps = db.get_hourly_caps()
        
        # Ensure all apps are in the caps
        default_caps = get_default_hourly_caps()
        for app in default_caps:
            if app not in caps:
                caps[app] = default_caps[app]
        
        return caps
    except Exception as e:
        logger.error(f"Error loading hourly caps from database: {e}")
        return get_default_hourly_caps()

def save_hourly_caps(caps: Dict[str, Dict[str, int]]) -> bool:
    """
    Save hourly API caps to the database
    
    Args:
        caps: Dictionary containing hourly API usage for each app
        
    Returns:
        True if successful, False otherwise
    """
    try:
        db = get_database()
        for app_type, app_caps in caps.items():
            api_hits = app_caps.get("api_hits", 0)
            last_reset_hour = app_caps.get("last_reset_hour", datetime.datetime.now().hour)
            db.set_hourly_cap(app_type, api_hits, last_reset_hour)
        
        logger.debug(f"Saved hourly caps to database: {caps}")
        return True
    except Exception as e:
        logger.error(f"Error saving hourly caps to database: {e}")
        return False

def check_hourly_reset():
    """
    Check if we need to reset hourly caps based on the current hour
    """
    global last_hour_checked, next_reset_check
    
    current_time = datetime.datetime.now()
    current_hour = current_time.hour
    
    # Skip if we've already checked this hour
    if last_hour_checked == current_hour:
        return
    
    # Only reset at the top of the hour (00 minute mark)
    if current_time.minute == 0:
        logger.debug(f"Hour changed to {current_hour}:00, resetting hourly API caps")
        reset_hourly_caps()
        last_hour_checked = current_hour

def increment_hourly_cap(app_type: str, count: int = 1) -> bool:
    """
    Increment hourly API usage cap for a specific app
    
    Args:
        app_type: The application type (sonarr, radarr, etc.)
        count: The amount to increment by (default: 1)
        
    Returns:
        True if successful, False otherwise
    """
    if app_type not in ["sonarr", "radarr", "lidarr", "readarr", "whisparr", "eros"]:
        logger.error(f"Invalid app_type for hourly cap: {app_type}")
        return False
    
    # Check if we need to reset hourly caps
    check_hourly_reset()
    
    with hourly_lock:
        try:
            db = get_database()
            
            # Get current usage before incrementing
            caps = db.get_hourly_caps()
            prev_value = caps.get(app_type, {}).get("api_hits", 0)
            
            # Increment in database
            db.increment_hourly_cap(app_type, count)
            new_value = prev_value + count
            
            # Get the hourly cap from the app's specific configuration
            from src.primary.settings_manager import load_settings
            app_settings = load_settings(app_type)
            hourly_limit = app_settings.get("hourly_cap", 20)  # Default to 20 if not set
            
            # Log current usage vs limit
            logger.debug(f"*** HOURLY API INCREMENT *** {app_type} by {count}: {prev_value} -> {new_value} (hourly limit: {hourly_limit})")
            
            # Warn if approaching limit
            if new_value >= int(hourly_limit * 0.8) and prev_value < int(hourly_limit * 0.8):
                logger.warning(f"{app_type} is approaching hourly API cap: {new_value}/{hourly_limit}")
            
            # Alert if exceeding limit
            if new_value >= hourly_limit and prev_value < hourly_limit:
                logger.error(f"{app_type} has exceeded hourly API cap: {new_value}/{hourly_limit}")
            
            return True
        except Exception as e:
            logger.error(f"Error incrementing hourly cap for {app_type}: {e}")
            return False

def get_hourly_cap_status(app_type: str) -> Dict[str, Any]:
    """
    Get current API usage status for an app
    
    Args:
        app_type: The application type (sonarr, radarr, etc.)
        
    Returns:
        Dictionary with usage information
    """
    if app_type not in ["sonarr", "radarr", "lidarr", "readarr", "whisparr", "eros"]:
        return {"error": f"Invalid app_type: {app_type}"}
    
    with hourly_lock:
        try:
            db = get_database()
            caps = db.get_hourly_caps()
            
            # Get the hourly cap from the app's specific configuration
            from src.primary.settings_manager import load_settings
            app_settings = load_settings(app_type)
            hourly_limit = app_settings.get("hourly_cap", 20)  # Default to 20 if not set
            
            current_usage = caps.get(app_type, {}).get("api_hits", 0)
            
            return {
                "app": app_type,
                "current_usage": current_usage,
                "limit": hourly_limit,
                "remaining": max(0, hourly_limit - current_usage),
                "percent_used": int((current_usage / hourly_limit) * 100) if hourly_limit > 0 else 0,
                "exceeded": current_usage >= hourly_limit
            }
        except Exception as e:
            logger.error(f"Error getting hourly cap status for {app_type}: {e}")
            return {"error": f"Database error: {e}"}

def _calculate_per_instance_hourly_limit(app_type: str) -> int:
    """
    Calculate the hourly limit based on the sum of all enabled instances' hunt values
    
    Args:
        app_type: The application type (sonarr, radarr, etc.)
        
    Returns:
        The calculated hourly limit based on per-instance hunt values
    """
    try:
        # Import here to avoid circular imports
        from src.primary.settings_manager import load_settings
        
        # Load app settings to get instances
        app_settings = load_settings(app_type)
        if not app_settings:
            logger.warning(f"No settings found for {app_type}, using default limit 20")
            return 20
        
        instances = app_settings.get("instances", [])
        if not instances:
            # Fallback to legacy single instance if no instances array
            logger.debug(f"No instances array found for {app_type}, using legacy single instance calculation")
            missing_limit = app_settings.get("hunt_missing_items", 1) if app_type in ["sonarr", "lidarr", "whisparr", "eros"] else app_settings.get("hunt_missing_movies" if app_type == "radarr" else "hunt_missing_books", 1)
            upgrade_limit = app_settings.get("hunt_upgrade_items", 0) if app_type in ["sonarr", "lidarr", "whisparr", "eros"] else app_settings.get("hunt_upgrade_movies" if app_type == "radarr" else "hunt_upgrade_books", 0)
            total_limit = missing_limit + upgrade_limit
            return max(total_limit, 1)  # Ensure minimum of 1
        
        # Calculate total hunt values across all enabled instances
        total_missing = 0
        total_upgrade = 0
        enabled_instances = 0
        
        # Get the correct field names based on app type
        if app_type == "radarr":
            missing_field = "hunt_missing_movies"
            upgrade_field = "hunt_upgrade_movies"
        elif app_type == "readarr":
            missing_field = "hunt_missing_books"
            upgrade_field = "hunt_upgrade_books"
        else:  # sonarr, lidarr, whisparr, eros
            missing_field = "hunt_missing_items"
            upgrade_field = "hunt_upgrade_items"
        
        for instance in instances:
            # Only count enabled instances
            if instance.get("enabled", True):  # Default to enabled if not specified
                enabled_instances += 1
                total_missing += instance.get(missing_field, 1)  # Default to 1 if not specified
                total_upgrade += instance.get(upgrade_field, 0)  # Default to 0 if not specified
        
        total_limit = total_missing + total_upgrade
        
        logger.debug(f"Calculated hourly limit for {app_type}: {total_limit} (missing: {total_missing}, upgrade: {total_upgrade}, enabled instances: {enabled_instances})")
        
        # Ensure minimum of 1 even if all values are 0
        return max(total_limit, 1)
        
    except Exception as e:
        logger.error(f"Error calculating per-instance hourly limit for {app_type}: {e}")
        # Fallback to app-level hourly_cap or default
        from src.primary.settings_manager import load_settings
        app_settings = load_settings(app_type)
        return app_settings.get("hourly_cap", 20) if app_settings else 20

def check_hourly_cap_exceeded(app_type: str) -> bool:
    """
    Check if an app has exceeded its hourly API cap
    
    Args:
        app_type: The application type (sonarr, radarr, etc.)
        
    Returns:
        True if exceeded, False otherwise
    """
    status = get_hourly_cap_status(app_type)
    return status.get("exceeded", False)

def save_stats(stats: Dict[str, Dict[str, int]]) -> bool:
    """
    Save statistics to the database
    
    Args:
        stats: Dictionary containing statistics for each app
        
    Returns:
        True if successful, False otherwise
    """
    try:
        db = get_database()
        for app_type, app_stats in stats.items():
            for stat_type, value in app_stats.items():
                db.set_media_stat(app_type, stat_type, value)
        
        logger.debug(f"Saved stats to database: {stats}")
        return True
    except Exception as e:
        logger.error(f"Error saving stats to database: {e}")
        return False

def increment_stat(app_type: str, stat_type: str, count: int = 1) -> bool:
    """
    Increment a specific statistic
    
    Args:
        app_type: The application type (sonarr, radarr, etc.)
        stat_type: The type of statistic (hunted or upgraded)
        count: The amount to increment by (default: 1)
        
    Returns:
        True if successful, False otherwise
    """
    if app_type not in ["sonarr", "radarr", "lidarr", "readarr", "whisparr", "eros"]:
        logger.error(f"Invalid app_type: {app_type}")
        return False
        
    if stat_type not in ["hunted", "upgraded"]:
        logger.error(f"Invalid stat_type: {stat_type}")
        return False
    
    # Also increment the hourly API cap for this app
    increment_hourly_cap(app_type, count)
    
    with stats_lock:
        try:
            db = get_database()
            db.increment_media_stat(app_type, stat_type, count)
            logger.debug(f"*** STATS INCREMENT *** {app_type} {stat_type} by {count}")
            return True
        except Exception as e:
            logger.error(f"Error incrementing stat {app_type}.{stat_type}: {e}")
            return False

def increment_stat_only(app_type: str, stat_type: str, count: int = 1) -> bool:
    """
    Increment a specific statistic WITHOUT incrementing API cap counter
    
    This function is specifically for season packs where the API call is already tracked
    separately and we only want to increment the stats for each episode.
    
    Args:
        app_type: The application type (sonarr, radarr, etc.)
        stat_type: The type of statistic (hunted or upgraded)
        count: The amount to increment by (default: 1)
        
    Returns:
        True if successful, False otherwise
    """
    if app_type not in ["sonarr", "radarr", "lidarr", "readarr", "whisparr", "eros"]:
        logger.error(f"Invalid app_type: {app_type}")
        return False
        
    if stat_type not in ["hunted", "upgraded"]:
        logger.error(f"Invalid stat_type: {stat_type}")
        return False
    
    # CRITICAL: Do NOT increment hourly API cap - this is for season packs where
    # the API call is already tracked separately in search_season()
    
    with stats_lock:
        try:
            db = get_database()
            db.increment_media_stat(app_type, stat_type, count)
            logger.debug(f"*** STATS ONLY INCREMENT *** {app_type} {stat_type} by {count} (API cap NOT incremented)")
            return True
        except Exception as e:
            logger.error(f"Error incrementing stat {app_type}.{stat_type}: {e}")
            return False

def get_stats() -> Dict[str, Dict[str, int]]:
    """
    Get the current statistics
    
    Returns:
        Dictionary containing statistics for each app
    """
    with stats_lock:
        stats = load_stats()
        # Stats retrieved - debug spam removed
        return stats

def get_hourly_caps() -> Dict[str, Dict[str, int]]:
    """
    Get current hourly API caps
    
    Returns:
        Dictionary containing current hourly API usage for each app
    """
    with hourly_lock:
        return load_hourly_caps()

def reset_stats(app_type: Optional[str] = None) -> bool:
    """
    Reset statistics for a specific app or all apps
    
    Args:
        app_type: The application type to reset, or None to reset all
        
    Returns:
        True if successful, False otherwise
    """
    with stats_lock:
        try:
            db = get_database()
            
            if app_type is None:
                # Reset all stats
                logger.info("Resetting all app statistics")
                default_stats = get_default_stats()
                for app in default_stats:
                    for stat_type in default_stats[app]:
                        db.set_media_stat(app, stat_type, 0)
            else:
                # Reset specific app stats
                logger.info(f"Resetting statistics for {app_type}")
                db.set_media_stat(app_type, "hunted", 0)
                db.set_media_stat(app_type, "upgraded", 0)
            
            return True
        except Exception as e:
            logger.error(f"Error resetting stats: {e}")
            return False

def reset_hourly_caps() -> bool:
    """
    Reset all hourly API caps to zero
    
    Returns:
        True if successful, False otherwise
    """
    with hourly_lock:
        try:
            db = get_database()
            db.reset_hourly_caps()
            logger.debug("Reset all hourly API caps")
            return True
        except Exception as e:
            logger.error(f"Error resetting hourly caps: {e}")
            return False

# Initialize the database-based stats system
try:
    # Set up the initial hour check
    last_hour_checked = datetime.datetime.now().hour
    logger.info("Stats system initialized using database")
except Exception as e:
    logger.error(f"Error initializing stats system: {e}")