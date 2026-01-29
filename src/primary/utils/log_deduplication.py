#!/usr/bin/env python3
"""
Log deduplication utility to prevent log spam
Tracks recent log messages and suppresses duplicates within a time window
"""

import time
import hashlib
from typing import Dict, Tuple
from threading import Lock

class LogDeduplicator:
    """
    Prevents duplicate log messages from spamming the logs.
    Tracks message hashes and timestamps to suppress repeated messages within a time window.
    """
    
    def __init__(self, time_window: int = 60):
        """
        Initialize the log deduplicator.
        
        Args:
            time_window: Time window in seconds to suppress duplicate messages (default: 60 seconds)
        """
        self.time_window = time_window
        self._message_cache: Dict[str, Tuple[float, int]] = {}  # hash -> (last_seen_time, count)
        self._lock = Lock()
    
    def _hash_message(self, logger_name: str, level: str, message: str) -> str:
        """
        Create a hash for the log message to identify duplicates.
        
        Args:
            logger_name: Name of the logger
            level: Log level (ERROR, WARNING, INFO, DEBUG)
            message: Log message content
            
        Returns:
            Hash string for the message
        """
        # Combine logger name, level, and message for unique identification
        combined = f"{logger_name}:{level}:{message}"
        return hashlib.md5(combined.encode()).hexdigest()
    
    def should_log(self, logger_name: str, level: str, message: str) -> Tuple[bool, int]:
        """
        Check if a message should be logged based on deduplication rules.
        
        Args:
            logger_name: Name of the logger
            level: Log level (ERROR, WARNING, INFO, DEBUG)
            message: Log message content
            
        Returns:
            Tuple of (should_log: bool, suppressed_count: int)
            - should_log: True if message should be logged, False if it should be suppressed
            - suppressed_count: Number of times this message was suppressed since last log
        """
        with self._lock:
            current_time = time.time()
            message_hash = self._hash_message(logger_name, level, message)
            
            # Clean up old entries (messages older than time window)
            self._cleanup_old_entries(current_time)
            
            if message_hash in self._message_cache:
                last_seen_time, count = self._message_cache[message_hash]
                time_since_last_seen = current_time - last_seen_time
                
                if time_since_last_seen < self.time_window:
                    # Within time window - suppress and increment count
                    self._message_cache[message_hash] = (current_time, count + 1)
                    return False, count + 1
                else:
                    # Outside time window - log with suppression count if any
                    suppressed_count = count
                    self._message_cache[message_hash] = (current_time, 0)
                    return True, suppressed_count
            else:
                # First time seeing this message
                self._message_cache[message_hash] = (current_time, 0)
                return True, 0
    
    def _cleanup_old_entries(self, current_time: float):
        """
        Remove entries older than the time window.
        
        Args:
            current_time: Current timestamp
        """
        # Find entries to remove
        to_remove = [
            msg_hash for msg_hash, (last_seen, _) in self._message_cache.items()
            if current_time - last_seen > self.time_window * 2  # Keep for 2x time window for safety
        ]
        
        # Remove old entries
        for msg_hash in to_remove:
            del self._message_cache[msg_hash]
    
    def reset(self):
        """Clear all cached messages."""
        with self._lock:
            self._message_cache.clear()


# Global deduplicator instance with 60-second window
_global_deduplicator = LogDeduplicator(time_window=60)


def should_log_message(logger_name: str, level: str, message: str) -> Tuple[bool, int]:
    """
    Check if a log message should be logged (not a duplicate within time window).
    
    Args:
        logger_name: Name of the logger
        level: Log level (ERROR, WARNING, INFO, DEBUG)
        message: Log message content
        
    Returns:
        Tuple of (should_log: bool, suppressed_count: int)
    """
    return _global_deduplicator.should_log(logger_name, level, message)


def format_suppressed_message(original_message: str, suppressed_count: int) -> str:
    """
    Format a message to include suppression count information.
    
    Args:
        original_message: Original log message
        suppressed_count: Number of times the message was suppressed
        
    Returns:
        Formatted message with suppression info
    """
    if suppressed_count > 0:
        return f"{original_message} (repeated {suppressed_count} times in last 60s)"
    return original_message


def reset_deduplicator():
    """Reset the global deduplicator (useful for testing)."""
    _global_deduplicator.reset()
