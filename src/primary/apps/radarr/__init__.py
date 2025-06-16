"""
Radarr app module for Huntarr
Contains functionality for missing movies and quality upgrades in Radarr
"""

# Module exports
from src.primary.apps.radarr.missing import process_missing_movies
from src.primary.apps.radarr.upgrade import process_cutoff_upgrades

# Add necessary imports for get_configured_instances
from src.primary.settings_manager import load_settings
from src.primary.utils.logger import get_logger

radarr_logger = get_logger("radarr") # Get the logger instance

def get_configured_instances():
    """Get all configured and enabled Radarr instances"""
    settings = load_settings("radarr")
    instances = []
    
    if not settings:
        radarr_logger.debug("No settings found for Radarr")
        return instances
        
    # Check if instances are configured
    if "instances" in settings and isinstance(settings["instances"], list) and settings["instances"]:
        for instance in settings["instances"]:
            if instance.get("enabled", True) and instance.get("api_url") and instance.get("api_key"):
                # Get URL and key with auto-correction
                api_url = instance.get("api_url", "").strip()
                api_key = instance.get("api_key", "").strip()

                # Enhanced URL validation - ensure URL has proper scheme
                if api_url and not (api_url.startswith('http://') or api_url.startswith('https://')):
                    radarr_logger.debug(f"Instance '{instance.get('name', 'Unnamed')}' has URL without http(s) scheme: {api_url}")
                    radarr_logger.debug(f"Auto-correcting URL to: {api_url}")
                    api_url = f"http://{api_url}"

                # Create a settings object for this instance by combining global settings with instance-specific ones
                instance_settings = settings.copy()
                # Remove instances list to avoid confusion
                if "instances" in instance_settings:
                    del instance_settings["instances"]
                
                # Override with instance-specific connection settings (using corrected URL)
                instance_settings["api_url"] = api_url
                instance_settings["api_key"] = api_key
                instance_settings["instance_name"] = instance.get("name", "Default")
                instance_settings["swaparr_enabled"] = instance.get("swaparr_enabled", False)
                
                # Add per-instance hunt values for missing/upgrade processing
                instance_settings["hunt_missing_movies"] = instance.get("hunt_missing_movies", 1)
                instance_settings["hunt_upgrade_movies"] = instance.get("hunt_upgrade_movies", 0)
                
                instances.append(instance_settings)
    else:
        # Fallback to legacy single-instance config
        api_url = settings.get("api_url", "").strip()
        api_key = settings.get("api_key", "").strip()
        
        # Ensure URL has proper scheme for legacy config too
        if api_url and not (api_url.startswith('http://') or api_url.startswith('https://')):
            radarr_logger.warning(f"API URL missing http(s) scheme: {api_url}")
            api_url = f"http://{api_url}"
            radarr_logger.warning(f"Auto-correcting URL to: {api_url}")
            
        if api_url and api_key:
            settings_copy = settings.copy()
            settings_copy["api_url"] = api_url  # Use corrected URL
            settings_copy["instance_name"] = "Default"
            settings_copy["swaparr_enabled"] = settings.get("swaparr_enabled", False)
            # Add per-instance hunt values for legacy config
            settings_copy["hunt_missing_movies"] = settings.get("hunt_missing_movies", 1)
            settings_copy["hunt_upgrade_movies"] = settings.get("hunt_upgrade_movies", 0)
            instances.append(settings_copy)
    
    # Use debug level to avoid spamming logs, especially with 0 instances
    return instances

__all__ = ["process_missing_movies", "process_cutoff_upgrades", "get_configured_instances"]