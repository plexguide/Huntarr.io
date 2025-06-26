#!/usr/bin/env python3
"""
Clean Logger for Huntarr
Provides database-only logging with clean, formatted messages for the web interface.
"""

import logging
import time
import re
import os
from datetime import datetime
from pathlib import Path
from typing import Dict, Optional
import pytz


class CleanLogFormatter(logging.Formatter):
    """
    Custom formatter that creates clean, readable log messages.
    Stores timestamps in UTC for timezone-agnostic storage.
    """
    
    def __init__(self):
        super().__init__()
        # No longer cache timezone since we store in UTC
    
    def _get_app_type_from_logger_name(self, logger_name: str) -> str:
        """Extract app type from logger name"""
        if not logger_name:
            return "system"
        
        # Handle logger names like "huntarr.sonarr" or just "huntarr"
        if "huntarr" in logger_name.lower():
            parts = logger_name.split(".")
            if len(parts) > 1:
                return parts[-1]  # Return the last part (e.g., "sonarr")
            else:
                return "system"  # Just "huntarr" becomes "system"
        
        # For other logger names, try to extract app type
        known_apps = ["sonarr", "radarr", "lidarr", "readarr", "whisparr", "eros", "swaparr"]
        logger_lower = logger_name.lower()
        for app in known_apps:
            if app in logger_lower:
                return app
        
        return "system"
    
    def _clean_message(self, message: str) -> str:
        """Clean and format the log message"""
        if not message:
            return ""
        
        # Remove ANSI color codes
        ansi_escape = re.compile(r'\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])')
        message = ansi_escape.sub('', message)
        
        # Remove excessive whitespace
        message = re.sub(r'\s+', ' ', message).strip()
        
        # Remove common prefixes that add noise
        prefixes_to_remove = [
            r'^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},\d{3} ',  # Timestamp prefixes
            r'^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] ',     # Bracketed timestamps
            r'^INFO:',
            r'^DEBUG:',
            r'^WARNING:',
            r'^ERROR:',
            r'^CRITICAL:',
        ]
        
        for prefix_pattern in prefixes_to_remove:
            message = re.sub(prefix_pattern, '', message)
        
        return message.strip()
    
    def format(self, record):
        """Format the log record into a clean message"""
        # Get timezone-aware timestamp
        dt = datetime.fromtimestamp(record.created, tz=pytz.UTC)
        timestamp_str = dt.strftime('%Y-%m-%d %H:%M:%S')
        
        # Get app type from logger name
        app_type = self._get_app_type_from_logger_name(record.name)
        
        # Clean the message
        clean_message = self._clean_message(record.getMessage())
        
        # Return formatted message: timestamp|level|app_type|message
        return f"{timestamp_str}|{record.levelname}|{app_type}|{clean_message}"


class DatabaseLogHandler(logging.Handler):
    """
    Custom log handler that writes clean log messages to the logs database.
    """
    
    def __init__(self, app_type: str):
        super().__init__()
        self.formatter = CleanLogFormatter()
        self._logs_db = None
        self.app_type = app_type
    
    @property
    def logs_db(self):
        """Lazy load the logs database instance"""
        if self._logs_db is None:
            from src.primary.utils.database import get_logs_database
            self._logs_db = get_logs_database()
        return self._logs_db
    
    def emit(self, record):
        """Write the log record to the database"""
        try:
            # Get only the clean message part, not the full formatted string
            # Check if formatter has _clean_message method (safety check)
            if hasattr(self.formatter, '_clean_message'):
                clean_message = self.formatter._clean_message(record.getMessage())
            else:
                # Fallback: use raw message if formatter doesn't have _clean_message
                clean_message = record.getMessage()
            
            # Use the app_type from constructor, or detect from logger name
            app_type = self.app_type
            if not app_type:
                # Fallback: detect from logger name
                if hasattr(record, 'name'):
                    if 'huntarr' in record.name.lower():
                        if '.' in record.name:
                            app_type = record.name.split('.')[-1]
                        else:
                            app_type = 'system'
                    else:
                        app_type = 'system'
                else:
                    app_type = 'system'
            
            # Insert into database with UTC timestamp for timezone-agnostic storage
            utc_timestamp = datetime.fromtimestamp(record.created, tz=pytz.UTC)
            self.logs_db.insert_log(
                timestamp=utc_timestamp,
                level=record.levelname,
                app_type=app_type,
                message=clean_message,
                logger_name=getattr(record, 'name', None)
            )
        except Exception as e:
            # Don't use logger here to avoid infinite recursion
            print(f"Error writing log to database: {e}")


# Global database handlers registry
_database_handlers: Dict[str, DatabaseLogHandler] = {}
_setup_complete = False


def setup_clean_logging():
    """
    Set up database logging handlers for all known logger types.
    This should be called once during application startup.
    """
    global _setup_complete
    
    # Prevent multiple setups
    if _setup_complete:
        return
    
    from src.primary.utils.logger import get_logger
    
    # Known app types for Huntarr
    app_types = ['system', 'sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros', 'swaparr']
    
    # Set up database handlers for each app type
    for app_type in app_types:
        # Database handler
        if app_type not in _database_handlers:
            database_handler = DatabaseLogHandler(app_type)
            database_handler.setLevel(logging.DEBUG)
            _database_handlers[app_type] = database_handler
        
        # Get the logger for this app type and add database handler
        logger = get_logger(app_type)
        
        # Add database handler if not already added
        if _database_handlers[app_type] not in logger.handlers:
            logger.addHandler(_database_handlers[app_type])
    
    _setup_complete = True


# Removed refresh_clean_log_formatters() function since we now store logs in UTC 
# and convert timezone on-the-fly, eliminating the need for formatter refreshing



