#!/usr/bin/env python3
"""
Swaparr Statistics Manager
Handles tracking, storing, and retrieving Swaparr-specific statistics
Now uses SQLite database instead of JSON files for better performance and reliability.
"""

import threading
from typing import Dict, Any
from src.primary.utils.logger import get_logger
from src.primary.utils.database import get_database

logger = get_logger("swaparr_stats")

# Lock for thread-safe operations
swaparr_stats_lock = threading.Lock()

def get_default_swaparr_stats() -> Dict[str, int]:
    """Get the default Swaparr stats structure"""
    return {
        "processed": 0,
        "strikes": 0,
        "removals": 0,
        "ignored": 0
    }

def load_swaparr_stats() -> Dict[str, int]:
    """
    Load Swaparr statistics from the database
    
    Returns:
        Dictionary containing Swaparr statistics
    """
    try:
        db = get_database()
        stats = db.get_swaparr_stats()
        
        # Ensure all expected keys are present
        default_stats = get_default_swaparr_stats()
        for key in default_stats:
            if key not in stats:
                stats[key] = default_stats[key]
        
        logger.debug(f"Loaded Swaparr stats from database: {stats}")
        return stats
    except Exception as e:
        logger.error(f"Error loading Swaparr stats from database: {e}")
        return get_default_swaparr_stats()

def save_swaparr_stats(stats: Dict[str, int]) -> bool:
    """
    Save Swaparr statistics to the database
    
    Args:
        stats: Dictionary containing Swaparr statistics
        
    Returns:
        True if successful, False otherwise
    """
    try:
        db = get_database()
        for stat_key, value in stats.items():
            db.set_swaparr_stat(stat_key, value)
        
        logger.debug(f"Saved Swaparr stats to database: {stats}")
        return True
    except Exception as e:
        logger.error(f"Error saving Swaparr stats to database: {e}")
        return False

def increment_swaparr_stat(stat_type: str, count: int = 1) -> bool:
    """
    Increment a Swaparr statistic by the specified count
    
    Args:
        stat_type: Type of stat to increment ('processed', 'strikes', 'removals', 'ignored')
        count: Amount to increment by (default 1)
        
    Returns:
        True if successful, False otherwise
    """
    valid_stats = ['processed', 'strikes', 'removals', 'ignored']
    if stat_type not in valid_stats:
        logger.error(f"Invalid Swaparr stat type: {stat_type}. Valid types: {valid_stats}")
        return False
    
    with swaparr_stats_lock:
        try:
            db = get_database()
            db.increment_swaparr_stat(stat_type, count)
            logger.debug(f"Incremented Swaparr {stat_type} by {count}")
            return True
        except Exception as e:
            logger.error(f"Error incrementing Swaparr {stat_type}: {e}")
            return False

def get_swaparr_stats() -> Dict[str, int]:
    """
    Get current Swaparr statistics
    
    Returns:
        Dictionary containing current Swaparr statistics
    """
    with swaparr_stats_lock:
        return load_swaparr_stats()

def reset_swaparr_stats() -> bool:
    """
    Reset all Swaparr statistics to zero
    
    Returns:
        True if successful, False otherwise
    """
    with swaparr_stats_lock:
        try:
            default_stats = get_default_swaparr_stats()
            success = save_swaparr_stats(default_stats)
            if success:
                logger.info("Reset all Swaparr statistics to zero")
            return success
        except Exception as e:
            logger.error(f"Error resetting Swaparr stats: {e}")
            return False 