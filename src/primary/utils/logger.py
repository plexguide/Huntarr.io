#!/usr/bin/env python3
"""
Logging configuration for Huntarr
Supports separate log files for each application type
Includes log rotation and cleanup functionality
"""

import logging
import logging.handlers
import sys
import os
import pathlib
import time
import glob
from typing import Dict, Optional

# Use the centralized path configuration
from src.primary.utils.config_paths import LOG_DIR

# Log directory is already created by config_paths module
# LOG_DIR already exists as pathlib.Path object pointing to the correct location

# Default log file for general messages
MAIN_LOG_FILE = LOG_DIR / "huntarr.log"

# App-specific log files (movie_hunt is independent - Activity → Logs only, no *arr)
APP_LOG_FILES = {
    "sonarr": LOG_DIR / "sonarr.log",
    "radarr": LOG_DIR / "radarr.log",
    "lidarr": LOG_DIR / "lidarr.log",
    "readarr": LOG_DIR / "readarr.log",
    "whisparr": LOG_DIR / "whisparr.log",
    "eros": LOG_DIR / "eros.log",
    "swaparr": LOG_DIR / "swaparr.log",
    "movie_hunt": LOG_DIR / "movie_hunt.log",
    "tv_hunt": LOG_DIR / "tv_hunt.log",
}

# Global logger instances
logger: Optional[logging.Logger] = None
app_loggers: Dict[str, logging.Logger] = {}

def get_rotation_settings():
    """
    Get log rotation settings from settings manager.
    Imports locally to avoid circular dependencies.
    """
    try:
        import src.primary.settings_manager as settings_manager
        settings = settings_manager.load_settings("general")
        return {
            "enabled": settings.get("log_rotation_enabled", True),
            "max_bytes": int(settings.get("log_max_size_mb", 50)) * 1024 * 1024,
            "backup_count": int(settings.get("log_backup_count", 5)),
            "retention_days": int(settings.get("log_retention_days", 30)),
            "auto_cleanup": settings.get("log_auto_cleanup", True)
        }
    except Exception as e:
        print(f"[Logger] Error loading log settings: {e}")
        # Return defaults if settings can't be loaded
        return {
            "enabled": True,
            "max_bytes": 50 * 1024 * 1024,
            "backup_count": 5,
            "retention_days": 30,
            "auto_cleanup": True
        }

# Custom formatter that uses user's selected timezone instead of UTC
class LocalTimeFormatter(logging.Formatter):
    """Custom formatter that uses user's selected timezone for log timestamps"""
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.converter = time.localtime  # Still use local time as fallback
    
    def _get_user_timezone(self):
        """Get the user's selected timezone from general settings"""
        try:
            from src.primary.utils.timezone_utils import get_user_timezone
            return get_user_timezone()
        except Exception:
            # Final fallback if timezone_utils can't be imported
            import pytz
            return pytz.UTC
    
    def formatTime(self, record, datefmt=None):
        try:
            # Try to use user's selected timezone
            user_tz = self._get_user_timezone()
            import datetime
            ct = datetime.datetime.fromtimestamp(record.created, tz=user_tz)
            
            if datefmt:
                s = ct.strftime(datefmt)
            else:
                # Use timezone-aware format
                s = ct.strftime("%Y-%m-%d %H:%M:%S")
                
            # Add timezone information for clarity
            timezone_name = str(user_tz)
            s += f" {timezone_name}"
            
            return s
        except Exception:
            # Fallback to system local time if timezone handling fails
            ct = self.converter(record.created)
            if datefmt:
                s = time.strftime(datefmt, ct)
            else:
                s = time.strftime("%Y-%m-%d %H:%M:%S", ct)
                
            # Add timezone information to help identify which timezone logs are in
            tz_name = time.tzname[time.daylight] if time.daylight else time.tzname[0]
            if tz_name:
                s += f" {tz_name}"
                
            return s


class DebugLogsFilter(logging.Filter):
    """
    Filter that suppresses DEBUG records when "Enable Debug Logs" is off in settings.
    Used on console and file handlers so Docker console and log files don't flood
    when the user disables debug in the UI (GitHub #756, #813).
    """
    def filter(self, record: logging.LogRecord) -> bool:
        if record.levelno != logging.DEBUG:
            return True
        try:
            from src.primary.settings_manager import get_advanced_setting
            if get_advanced_setting("enable_debug_logs", True):
                return True
            return False
        except Exception:
            return True  # Allow DEBUG if setting can't be read (e.g. during early startup)


def setup_main_logger():
    """Set up the main Huntarr logger."""
    global logger
    log_name = "huntarr"
    log_file = MAIN_LOG_FILE

    # Always use DEBUG level - let frontend filter what users see
    use_log_level = logging.DEBUG

    # Get or create the main logger instance
    current_logger = logging.getLogger(log_name)

    # Reset handlers to avoid duplicates
    current_logger.handlers.clear()
    current_logger.setLevel(use_log_level)
    
    # Prevent propagation to root logger to avoid duplicate messages
    current_logger.propagate = False

    # Create console handler
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(use_log_level)
    console_handler.addFilter(DebugLogsFilter())

    # Get rotation settings
    rotation_settings = get_rotation_settings()

    # Create file handler (Rotating or Standard)
    if rotation_settings["enabled"]:
        file_handler = logging.handlers.RotatingFileHandler(
            log_file,
            maxBytes=rotation_settings["max_bytes"],
            backupCount=rotation_settings["backup_count"]
        )
    else:
        file_handler = logging.FileHandler(log_file)
        
    file_handler.setLevel(use_log_level)
    file_handler.addFilter(DebugLogsFilter())

    # Set format for the main logger
    log_format = "%(asctime)s - huntarr - %(levelname)s - %(message)s"
    formatter = LocalTimeFormatter(log_format, datefmt="%Y-%m-%d %H:%M:%S")
    console_handler.setFormatter(formatter)
    file_handler.setFormatter(formatter)

    # Add handlers to the main logger
    current_logger.addHandler(console_handler)
    current_logger.addHandler(file_handler)

    current_logger.debug("Debug logging enabled for main logger")

    logger = current_logger # Assign to the global variable
    return current_logger

def get_logger(app_type: str) -> logging.Logger:
    """
    Get or create a logger for a specific app type.
    
    Args:
        app_type: The app type (e.g., 'sonarr', 'radarr').
        
    Returns:
        A logger specific to the app type, or the main logger if app_type is invalid.
    """
    if app_type not in APP_LOG_FILES:
        # Fallback to main logger if the app type is not recognized
        global logger
        if logger is None:
            # Ensure main logger is initialized if accessed before module-level setup
            setup_main_logger()
        # We checked logger is not None, so we can assert its type
        assert logger is not None
        return logger

    log_name = f"huntarr.{app_type}"
    if log_name in app_loggers:
        # Return cached logger instance
        return app_loggers[log_name]
    
    # If not cached, set up a new logger for this app type
    app_logger = logging.getLogger(log_name)
    
    # Prevent propagation to the main 'huntarr' logger or root logger
    app_logger.propagate = False
    
    # Always use DEBUG level - let frontend filter what users see
    log_level = logging.DEBUG
        
    app_logger.setLevel(log_level)
    
    # Reset handlers in case this logger existed before but wasn't cached
    # (e.g., across restarts without clearing logging._handlers)
    for handler in app_logger.handlers[:]:
        app_logger.removeHandler(handler)

    # Create console handler
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(logging.DEBUG)
    console_handler.addFilter(DebugLogsFilter())

    # Get rotation settings
    rotation_settings = get_rotation_settings()
    
    # Create file handler for the specific app log file
    log_file = APP_LOG_FILES[app_type]
    
    if rotation_settings["enabled"]:
        file_handler = logging.handlers.RotatingFileHandler(
            log_file,
            maxBytes=rotation_settings["max_bytes"],
            backupCount=rotation_settings["backup_count"]
        )
    else:
        file_handler = logging.FileHandler(log_file)
        
    file_handler.setLevel(logging.DEBUG)
    file_handler.addFilter(DebugLogsFilter())
    
    # Set a distinct format for this app log
    log_format = f"%(asctime)s - huntarr.{app_type} - %(levelname)s - %(message)s"
    formatter = LocalTimeFormatter(log_format, datefmt="%Y-%m-%d %H:%M:%S")
    
    console_handler.setFormatter(formatter)
    file_handler.setFormatter(formatter)
    
    # Add the handlers specific to this app logger
    app_logger.addHandler(console_handler)
    app_logger.addHandler(file_handler)
    
    # Cache the configured logger
    app_loggers[log_name] = app_logger

    app_logger.debug(f"Debug logging enabled for {app_type} logger")
        
    return app_logger

def update_logging_levels():
    """
    Update all logger levels to DEBUG level.
    This function is kept for compatibility but now always sets DEBUG level.
    """
    # Always use DEBUG level - let frontend filter what users see
    level = logging.DEBUG
    
    # Set level for main logger
    if logger:
        logger.setLevel(level)
    
    # Set level for all app loggers
    for app_logger in app_loggers.values():
        app_logger.setLevel(level)
    
    print(f"[Logger] Updated all logger levels to {logging.getLevelName(level)}")

def refresh_timezone_formatters():
    """
    Force refresh of all logger formatters to use updated timezone settings.
    This should be called when the timezone setting changes.
    """
    print("[Logger] Refreshing timezone formatters for all loggers")
    
    # Create new formatter with updated timezone handling
    log_format = "%(asctime)s - huntarr - %(levelname)s - %(message)s"
    new_formatter = LocalTimeFormatter(log_format, datefmt="%Y-%m-%d %H:%M:%S")
    
    # Update main logger handlers
    if logger:
        for handler in logger.handlers:
            handler.setFormatter(new_formatter)
    
    # Update all app logger handlers
    for app_name, app_logger in app_loggers.items():
        app_type = app_name.split('.')[-1] if '.' in app_name else app_name
        app_format = f"%(asctime)s - huntarr.{app_type} - %(levelname)s - %(message)s"
        app_formatter = LocalTimeFormatter(app_format, datefmt="%Y-%m-%d %H:%M:%S")
        
        for handler in app_logger.handlers:
            handler.setFormatter(app_formatter)
    
    print("[Logger] Timezone formatters refreshed for all loggers")

def refresh_log_handlers():
    """
    Recreate log handlers with new rotation settings.
    Should be called when log settings change.
    """
    print("[Logger] Refreshing log handlers with new settings")
    
    # Re-setup main logger
    setup_main_logger()
    
    # Re-setup all app loggers
    # We need to clear the cache so get_logger creates new handlers
    global app_loggers
    current_apps = list(app_loggers.keys())
    app_loggers = {}
    
    for log_name in current_apps:
        app_type = log_name.split('.')[-1] if '.' in log_name else log_name
        get_logger(app_type)
        
    print("[Logger] Log handlers refreshed")

def cleanup_old_logs():
    """Delete log files older than retention days."""
    settings = get_rotation_settings()
    if not settings["auto_cleanup"] or settings["retention_days"] <= 0:
        return

    retention_days = settings["retention_days"]
    now = time.time()
    cutoff = now - (retention_days * 86400)
    
    print(f"[Logger] Cleaning up logs older than {retention_days} days...")
    
    count = 0
    # Check all files in log directory
    # Look for rotated files like .log.1, .log.2 etc.
    for log_file in LOG_DIR.glob("*.log*"): 
        try:
            # Skip current active log files (no suffix or just .log)
            if log_file.suffix == '.log':
                continue
                
            if log_file.stat().st_mtime < cutoff:
                log_file.unlink()
                count += 1
                print(f"[Logger] Deleted old log file: {log_file.name}")
        except Exception as e:
            print(f"[Logger] Error deleting {log_file.name}: {e}")
            
    print(f"[Logger] Cleanup complete. Removed {count} files.")

def debug_log(message: str, data: object = None, app_type: Optional[str] = None) -> None:
    """
    Log debug messages with optional data.
    
    Args:
        message: The message to log.
        data: Optional data to include with the message.
        app_type: Optional app type to log to a specific app's log file.
    """
    current_logger = get_logger(app_type) if app_type else logger
    
    if current_logger.level <= logging.DEBUG:
        if data is not None:
            try:
                import json
                as_json = json.dumps(data)
                if len(as_json) > 500:
                    as_json = as_json[:500] + "..."
                # Combine message and data in single log entry to prevent fragmentation
                current_logger.debug(f"{message} | Data: {as_json}")
            except:
                data_str = str(data)
                if len(data_str) > 500:
                    data_str = data_str[:500] + "..."
                # Combine message and data in single log entry to prevent fragmentation
                current_logger.debug(f"{message} | Data: {data_str}")
        else:
            current_logger.debug(f"{message}")

# Initialize the main logger instance when the module is imported
logger = setup_main_logger()

# Run cleanup on startup if enabled
try:
    cleanup_old_logs()
except Exception as e:
    print(f"[Logger] Error running startup cleanup: {e}")
