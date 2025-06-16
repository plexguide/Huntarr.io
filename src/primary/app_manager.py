# If this file doesn't exist, we'll create it

import os
from src.primary.utils.logger import get_logger
from src.primary.settings_manager import load_settings

logger = get_logger("app_manager")

# List of supported app types
SUPPORTED_APP_TYPES = ["sonarr", "radarr", "lidarr", "readarr", "whisparr", "eros"]

def initialize_apps():
    """Initialize all supported applications"""
    for app_type in SUPPORTED_APP_TYPES:
        initialize_app(app_type)
    
    # Also load general settings but don't treat it as a regular app
    load_general_settings()

def initialize_app(app_type):
    """Initialize a specific application"""
    if app_type not in SUPPORTED_APP_TYPES:
        logger.warning(f"Attempted to initialize unsupported app type: {app_type}")
        return False
    
    # Load settings for this app
    settings = load_settings(app_type)
    
    # Additional initialization as needed
    # ...

    return True

def load_general_settings():
    """Load general settings without treating it as a regular app"""
    settings = load_settings("general")
    # Configuration logging removed to reduce log spam
    return settings
