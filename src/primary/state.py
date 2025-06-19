#!/usr/bin/env python3
"""
State management module for Huntarr
Handles all persistence of program state using database
"""

import os
import datetime
import time
from typing import List, Dict, Any, Optional
from src.primary import settings_manager

# Import database
from src.primary.utils.database import get_database

# Get the logger at module level
from src.primary.utils.logger import get_logger
logger = get_logger("huntarr")



def get_last_reset_time(app_type: str) -> datetime.datetime:
    """
    Get the last time the state was reset for a specific app type.
    
    Args:
        app_type: The type of app to get last reset time for.
        
    Returns:
        The datetime of the last reset, or current time if no reset has occurred.
    """
    if not app_type:
        logger.error("get_last_reset_time called without app_type.")
        return datetime.datetime.now()
        
    try:
        db = get_database()
        reset_time_str = db.get_last_reset_time_state(app_type)
        if reset_time_str:
            return datetime.datetime.fromisoformat(reset_time_str)
    except Exception as e:
        logger.error(f"Error reading last reset time for {app_type}: {e}")
    
    # If no reset time exists, initialize it with current time and return current time
    logger.info(f"No reset time found for {app_type}, initializing with current time")
    current_time = datetime.datetime.now()
    set_last_reset_time(current_time, app_type)
    return current_time

def set_last_reset_time(reset_time: datetime.datetime, app_type: str) -> None:
    """
    Set the last time the state was reset for a specific app type.
    
    Args:
        reset_time: The datetime to set
        app_type: The type of app to set last reset time for.
    """
    if not app_type:
        logger.error("set_last_reset_time called without app_type.")
        return
        
    try:
        db = get_database()
        db.set_last_reset_time_state(app_type, reset_time.isoformat())
    except Exception as e:
        logger.error(f"Error writing last reset time for {app_type}: {e}")

def check_state_reset(app_type: str) -> bool:
    """
    Check if the state needs to be reset based on the reset interval.
    If it's time to reset, clears the processed IDs and updates the last reset time.
    
    Args:
        app_type: The type of app to check state reset for.
        
    Returns:
        True if the state was reset, False otherwise.
    """
    if not app_type:
        logger.error("check_state_reset called without app_type.")
        return False
        
    # Use a much longer default interval (1 week = 168 hours) to prevent frequent resets
    reset_interval = settings_manager.get_advanced_setting("stateful_management_hours", 168)
    
    last_reset = get_last_reset_time(app_type)
    now = datetime.datetime.now()
    
    delta = now - last_reset
    hours_passed = delta.total_seconds() / 3600
    
    # Log every cycle to help diagnose state reset issues
    logger.debug(f"State check for {app_type}: {hours_passed:.1f} hours since last reset (interval: {reset_interval}h)")
    
    if hours_passed >= reset_interval:
        logger.warning(f"State files for {app_type} will be reset after {hours_passed:.1f} hours (interval: {reset_interval}h)")
        logger.warning(f"This will cause all previously processed media to be eligible for processing again")
        
        # Add additional safeguard - only reset if more than double the interval has passed
        # This helps prevent accidental resets due to clock issues or other anomalies
        if hours_passed >= (reset_interval * 2):
            logger.info(f"Confirmed state reset for {app_type} after {hours_passed:.1f} hours")
            clear_processed_ids(app_type)
            set_last_reset_time(now, app_type)
            return True
        else:
            logger.info(f"State reset postponed for {app_type} - will proceed when {reset_interval * 2}h have passed")
            # Update last reset time partially to avoid immediate reset next cycle
            half_delta = datetime.timedelta(hours=reset_interval/2)
            set_last_reset_time(now - half_delta, app_type)
            
    return False

def clear_processed_ids(app_type: str) -> None:
    """
    Clear all processed IDs for a specific app type.
    
    Args:
        app_type: The type of app to clear processed IDs for.
    """
    if not app_type:
        logger.error("clear_processed_ids called without app_type.")
        return
        
    try:
        db = get_database()
        db.clear_processed_ids_state(app_type)
        logger.info(f"Cleared processed IDs for {app_type}")
    except Exception as e:
        logger.error(f"Error clearing processed IDs for {app_type}: {e}")

def _get_user_timezone():
    """Get the user's selected timezone from general settings"""
    try:
        from src.primary.utils.timezone_utils import get_user_timezone
        return get_user_timezone()
    except Exception as e:
        logger.warning(f"Could not get user timezone, defaulting to UTC: {e}")
        import pytz
        return pytz.UTC

def calculate_reset_time(app_type: str) -> str:
    """
    Calculate when the next state reset will occur.
    
    Args:
        app_type: The type of app to calculate reset time for.
        
    Returns:
        A string representation of when the next reset will occur.
    """
    if not app_type:
        logger.error("calculate_reset_time called without app_type.")
        return "Next reset: Unknown (app type not provided)"
        
    reset_interval = settings_manager.get_advanced_setting("stateful_management_hours", 168)
    
    last_reset = get_last_reset_time(app_type)
    
    # Get user's timezone for consistent time display
    user_tz = _get_user_timezone()
    
    # Convert last reset to user timezone (assuming it was stored as naive UTC)
    import pytz
    if last_reset.tzinfo is None:
        last_reset_utc = pytz.UTC.localize(last_reset)
    else:
        last_reset_utc = last_reset
    
    next_reset = last_reset_utc + datetime.timedelta(hours=reset_interval)
    now_user_tz = datetime.datetime.now(user_tz)
    
    # Convert next_reset to user timezone for comparison
    next_reset_user_tz = next_reset.astimezone(user_tz)
    
    if next_reset_user_tz < now_user_tz:
        return "Next reset: at the start of the next cycle"
    
    delta = next_reset_user_tz - now_user_tz
    hours = delta.total_seconds() / 3600
    
    if hours < 1:
        minutes = delta.total_seconds() / 60
        return f"Next reset: in {int(minutes)} minutes"
    elif hours < 24:
        return f"Next reset: in {int(hours)} hours"
    else:
        days = hours / 24
        return f"Next reset: in {int(days)} days"

def reset_state_file(app_type: str, state_type: str) -> bool:
    """
    Reset a specific state file for an app type.
    
    Args:
        app_type: The type of app (sonarr, radarr, etc.)
        state_type: The type of state file (processed_missing, processed_upgrades)
        
    Returns:
        True if successful, False otherwise
    """
    if not app_type:
        logger.error("reset_state_file called without app_type.")
        return False
        
    try:
        db = get_database()
        db.set_processed_ids_state(app_type, state_type, [])
        logger.info(f"Reset {state_type} state for {app_type}")
        return True
    except Exception as e:
        logger.error(f"Error resetting {state_type} state for {app_type}: {e}")
        return False

def init_state_files() -> None:
    """Initialize state data for all app types in database"""
    app_types = settings_manager.KNOWN_APP_TYPES 
    
    try:
        db = get_database()
        for app_type in app_types:
            # Initialize processed IDs if they don't exist
            if not db.get_processed_ids_state(app_type, "processed_missing"):
                db.set_processed_ids_state(app_type, "processed_missing", [])
            if not db.get_processed_ids_state(app_type, "processed_upgrades"):
                db.set_processed_ids_state(app_type, "processed_upgrades", [])
            
            # Initialize reset time if it doesn't exist
            if not db.get_last_reset_time_state(app_type):
                db.set_last_reset_time_state(app_type, datetime.datetime.fromtimestamp(0).isoformat())
    except Exception as e:
        logger.error(f"Error initializing state data: {e}")

init_state_files()