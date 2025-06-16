"""
Swaparr app module for Huntarr
Contains functionality for handling stalled downloads in Starr apps

Based on the original Swaparr project by ThijmenGThN:
https://github.com/ThijmenGThN/swaparr/releases/tag/0.10.0
"""

# Add necessary imports for get_configured_instances
from src.primary.settings_manager import load_settings
from src.primary.utils.logger import get_logger

swaparr_logger = get_logger("swaparr")  # Get the logger instance

def get_configured_instances():
    """Get all configured Starr app instances from their respective settings"""
    try:
        from src.primary.apps.radarr import get_configured_instances as get_radarr_instances
        from src.primary.apps.sonarr import get_configured_instances as get_sonarr_instances
        from src.primary.apps.lidarr import get_configured_instances as get_lidarr_instances
        from src.primary.apps.readarr import get_configured_instances as get_readarr_instances
        
        # Try to import Whisparr instances (may not exist in all installations)
        try:
            from src.primary.apps.whisparr import get_configured_instances as get_whisparr_instances
            whisparr_instances = get_whisparr_instances()
        except ImportError:
            whisparr_instances = []
        
        # Try to import Eros instances (may not exist in all installations)
        try:
            from src.primary.apps.eros import get_configured_instances as get_eros_instances
            eros_instances = get_eros_instances()
        except ImportError:
            eros_instances = []
        
        instances = {
            "radarr": get_radarr_instances(),
            "sonarr": get_sonarr_instances(),
            "lidarr": get_lidarr_instances(),
            "readarr": get_readarr_instances(),
            "whisparr": whisparr_instances,
            "eros": eros_instances
        }
        
        return instances
        
    except Exception as e:
        swaparr_logger.error(f"Error getting configured instances: {str(e)}")
        return {}

def is_configured():
    """Check if Swaparr has any configured Starr app instances"""
    instances = get_configured_instances()
    return any(len(app_instances) > 0 for app_instances in instances.values())

# Export the logger and functions
__all__ = ["swaparr_logger", "get_configured_instances", "is_configured"] 