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


def get_user_timezone(use_cache: bool = True, prefer_database_for_display: bool = False) -> pytz.BaseTzInfo:
    """
    Get the effective timezone for display and calculations.

    This function is robust and will NEVER crash, even with invalid timezones.
    It gracefully handles any timezone string and falls back safely.

    Fallback order (default):
    1. TZ environment variable (if set) — overrides settings
    2. User's timezone from general settings
    3. UTC as final fallback

    When prefer_database_for_display=True (e.g. logs, history, scheduling UI):
    1. User's timezone from general settings (so in-app choice wins in Docker where TZ=UTC)
    2. TZ environment variable
    3. UTC as final fallback

    Args:
        use_cache: If False, always read timezone from settings (e.g. for log display).
        prefer_database_for_display: If True, use database timezone first so UI choice wins over TZ env.

    Returns:
        pytz.BaseTzInfo: The timezone object to use (always valid)
    """
    global _timezone_cache, _cache_timestamp

    import time
    current_time = time.time()

    # Check cache first (unless bypass requested)
    if use_cache and _timezone_cache and (current_time - _cache_timestamp) < _cache_ttl:
        return _timezone_cache

    try:
        # Option A: Prefer database for display (logs, history, scheduling) so in-app timezone wins in Docker
        if prefer_database_for_display:
            try:
                from src.primary import settings_manager
                general_settings = settings_manager.load_settings("general", use_cache=False)
                timezone_name = general_settings.get("timezone")
                if timezone_name:
                    tz = safe_get_timezone(timezone_name)
                    if tz:
                        _timezone_cache = tz
                        _cache_timestamp = current_time
                        return tz
            except Exception:
                pass
            # Fall through to TZ env then UTC

        # 1. TZ environment variable (overrides settings when not prefer_database_for_display)
        tz_env = os.environ.get('TZ')
        if tz_env and tz_env.strip():
            tz = safe_get_timezone(tz_env.strip())
            if tz:
                _timezone_cache = tz
                _cache_timestamp = current_time
                return tz

        # 2. User's timezone from general settings (when not already used above)
        if not prefer_database_for_display:
            try:
                from src.primary import settings_manager
                general_settings = settings_manager.load_settings("general", use_cache=False)
                timezone_name = general_settings.get("timezone")
                if timezone_name:
                    tz = safe_get_timezone(timezone_name)
                    if tz:
                        _timezone_cache = tz
                        _cache_timestamp = current_time
                        return tz
            except Exception:
                pass

        # 3. Final fallback to UTC
        tz = pytz.UTC
        _timezone_cache = tz
        _cache_timestamp = current_time
        return tz

    except Exception:
        tz = pytz.UTC
        _timezone_cache = tz
        _cache_timestamp = current_time
        return tz


def get_timezone_name() -> str:
    """
    Get the timezone name as a string (for display; prefers database so UI choice wins in Docker).
    
    Returns:
        str: The timezone name (e.g., 'Pacific/Honolulu', 'UTC')
    """
    try:
        timezone = get_user_timezone(prefer_database_for_display=True)
        return str(timezone)
    except Exception:
        return "UTC" 