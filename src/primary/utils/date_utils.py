#!/usr/bin/env python3
"""
Date Utilities for Huntarr
Handles date parsing and validation across all apps
"""

import datetime
from typing import Optional
from src.primary.utils.logger import get_logger

# Get logger for the utility
date_logger = get_logger(__name__)


def parse_date(date_str: Optional[str]) -> Optional[datetime.datetime]:
    """
    Parse a date string into a datetime object.
    
    Args:
        date_str: Date string in various formats (ISO, etc.)
        
    Returns:
        datetime object if parsing successful, None otherwise
    """
    if not date_str:
        return None
    
    # Handle empty or whitespace-only strings
    if not isinstance(date_str, str) or not date_str.strip():
        return None
    
    date_str = date_str.strip()
    
    # Common date formats to try
    date_formats = [
        "%Y-%m-%dT%H:%M:%S.%fZ",  # ISO with microseconds and Z
        "%Y-%m-%dT%H:%M:%SZ",     # ISO with Z
        "%Y-%m-%dT%H:%M:%S",      # ISO without Z
        "%Y-%m-%d",               # Simple date
        "%Y-%m-%dT%H:%M:%S.%f",   # ISO with microseconds no Z
    ]
    
    for date_format in date_formats:
        try:
            parsed_date = datetime.datetime.strptime(date_str, date_format)
            # If the date has no timezone info and ends with Z, it's UTC
            if date_str.endswith('Z') and parsed_date.tzinfo is None:
                parsed_date = parsed_date.replace(tzinfo=datetime.timezone.utc)
            return parsed_date
        except ValueError:
            continue
    
    # If all formats fail, log a debug message
    date_logger.debug(f"Failed to parse date string: '{date_str}'")
    return None


def is_future_date(date_obj: Optional[datetime.datetime]) -> bool:
    """
    Check if a datetime object represents a future date.
    
    Args:
        date_obj: datetime object to check
        
    Returns:
        True if date is in the future, False otherwise
    """
    if not date_obj:
        return False
    
    # Get current time in UTC for comparison
    now = datetime.datetime.now(datetime.timezone.utc)
    
    # If the date object doesn't have timezone info, assume it's UTC
    if date_obj.tzinfo is None:
        date_obj = date_obj.replace(tzinfo=datetime.timezone.utc)
    
    return date_obj > now


def is_valid_date(date_str: Optional[str]) -> bool:
    """
    Check if a date string can be parsed into a valid date.
    
    Args:
        date_str: Date string to validate
        
    Returns:
        True if date string is valid, False otherwise
    """
    return parse_date(date_str) is not None 