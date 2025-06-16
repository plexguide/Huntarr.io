#!/usr/bin/env python3
"""
Timezone utilities for Huntarr
Centralized timezone handling with proper fallbacks
"""

import os
import pytz
from typing import Union

# Cache for timezone to avoid repeated settings lookups
_timezone_cache = None
_cache_timestamp = 0
_cache_ttl = 5  # 5 seconds cache TTL


def clear_timezone_cache():
    """Clear the timezone cache to force a fresh lookup."""
    global _timezone_cache, _cache_timestamp
    _timezone_cache = None
    _cache_timestamp = 0


def validate_timezone(timezone_str: str) -> bool:
    """
    Validate if a timezone string is valid using pytz.
    
    Args:
        timezone_str: The timezone string to validate (e.g., 'Europe/Bucharest')
        
    Returns:
        bool: True if valid, False otherwise
    """
    if not timezone_str:
        return False
        
    try:
        pytz.timezone(timezone_str)
        return True
    except pytz.UnknownTimeZoneError:
        return False
    except Exception:
        return False


def safe_get_timezone(timezone_name: str) -> pytz.BaseTzInfo:
    """
    Safely get a timezone object with validation.
    
    Args:
        timezone_name: The timezone name to get
        
    Returns:
        pytz.BaseTzInfo: The timezone object, or None if invalid
    """
    if not timezone_name:
        return None
    try:
        return pytz.timezone(timezone_name)
    except pytz.UnknownTimeZoneError:
        return None
    except Exception:
        return None


def get_user_timezone() -> pytz.BaseTzInfo:
    """
    Get the user's selected timezone with proper fallback handling.
    
    This function is robust and will NEVER crash, even with invalid timezones.
    It gracefully handles any timezone string and falls back safely.
    
    Fallback order:
    1. User's timezone setting from general settings
    2. TZ environment variable
    3. UTC as final fallback
    
    Returns:
        pytz.BaseTzInfo: The timezone object to use (always valid)
    """
    global _timezone_cache, _cache_timestamp
    
    # Check cache first
    import time
    current_time = time.time()
    if _timezone_cache and (current_time - _cache_timestamp) < _cache_ttl:
        return _timezone_cache
    
    try:
        # First try to get timezone from user settings
        try:
            from src.primary import settings_manager
            general_settings = settings_manager.load_settings("general", use_cache=False)  # Force fresh read
            timezone_name = general_settings.get("timezone")
            
            if timezone_name and timezone_name != "UTC":
                tz = safe_get_timezone(timezone_name)
                if tz:
                    # Cache the result
                    _timezone_cache = tz
                    _cache_timestamp = current_time
                    return tz
        except Exception:
            pass  # Fall through to TZ environment variable
        
        # Second try TZ environment variable
        tz_env = os.environ.get('TZ')
        if tz_env:
            tz = safe_get_timezone(tz_env)
            if tz:
                # Cache the result
                _timezone_cache = tz
                _cache_timestamp = current_time
                return tz
        
        # Final fallback to UTC
        tz = pytz.UTC
        _timezone_cache = tz
        _cache_timestamp = current_time
        return tz
        
    except Exception:
        # Ultimate fallback if everything fails
        tz = pytz.UTC
        _timezone_cache = tz
        _cache_timestamp = current_time
        return tz


def get_timezone_name() -> str:
    """
    Get the timezone name as a string.
    
    Returns:
        str: The timezone name (e.g., 'Pacific/Honolulu', 'UTC')
    """
    try:
        timezone = get_user_timezone()
        return str(timezone)
    except Exception:
        return "UTC" 