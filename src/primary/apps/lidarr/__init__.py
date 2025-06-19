"""
Lidarr app module for Huntarr
Contains functionality for missing albums and quality upgrades in Lidarr
"""

# Module exports
from src.primary.apps.lidarr.missing import process_missing_albums
from src.primary.apps.lidarr.upgrade import process_cutoff_upgrades
from src.primary.settings_manager import load_settings
from src.primary.utils.logger import get_logger

# Define logger for this module
lidarr_logger = get_logger("lidarr")

def get_configured_instances():
    """Get all configured and enabled Lidarr instances"""
    settings = load_settings("lidarr")
    instances = []


    if not settings:
        lidarr_logger.debug("No settings found for Lidarr")
        return instances

    # Check if instances are configured
    if "instances" in settings and isinstance(settings["instances"], list) and settings["instances"]:

        for idx, instance in enumerate(settings["instances"]):
    
            # Enhanced validation
            api_url = instance.get("api_url", "").strip()
            api_key = instance.get("api_key", "").strip()

            # Enhanced URL validation - ensure URL has proper scheme
            if api_url and not (api_url.startswith('http://') or api_url.startswith('https://')):
                lidarr_logger.debug(f"Instance '{instance.get('name', 'Unnamed')}' has URL without http(s) scheme: {api_url}")
                api_url = f"http://{api_url}"
                lidarr_logger.debug(f"Auto-correcting URL to: {api_url}")

            is_enabled = instance.get("enabled", True)

            # Only include properly configured instances
            if is_enabled and api_url and api_key:
                # Return only essential instance details including per-instance hunt values
                instance_data = {
                    "instance_name": instance.get("name", "Default"),
                    "api_url": api_url,
                    "api_key": api_key,
                    "swaparr_enabled": instance.get("swaparr_enabled", False),
                    "hunt_missing_items": instance.get("hunt_missing_items", 1),  # Per-instance missing hunt value
                    "hunt_upgrade_items": instance.get("hunt_upgrade_items", 0),  # Per-instance upgrade hunt value
                }
                instances.append(instance_data)
    
            elif not is_enabled:
                lidarr_logger.debug(f"Skipping disabled instance: {instance.get('name', 'Unnamed')}")
            else:
                # For brand new installations, don't spam logs with warnings about default instances
                instance_name = instance.get('name', 'Unnamed')
                if instance_name == 'Default':
                    # Use debug level for default instances to avoid log spam on new installations
                    pass
                else:
                    # Still log warnings for non-default instances
                    lidarr_logger.warning(f"Skipping instance '{instance_name}' due to missing API URL or key (URL: '{api_url}', Key Set: {bool(api_key)})")
    else:

        # Fallback to legacy single-instance config
        api_url = settings.get("api_url", "").strip()
        api_key = settings.get("api_key", "").strip()

        # Ensure URL has proper scheme
        if api_url and not (api_url.startswith('http://') or api_url.startswith('https://')):
            lidarr_logger.warning(f"API URL missing http(s) scheme: {api_url}")
            api_url = f"http://{api_url}"
            lidarr_logger.warning(f"Auto-correcting URL to: {api_url}")

        if api_url and api_key:
            # Create a clean instance_data dict for the legacy instance
            instance_data = {
                "instance_name": "Default",
                "api_url": api_url,
                "api_key": api_key,
                "swaparr_enabled": settings.get("swaparr_enabled", False),
                "hunt_missing_items": settings.get("hunt_missing_items", 1),  # Legacy missing hunt value
                "hunt_upgrade_items": settings.get("hunt_upgrade_items", 0),  # Legacy upgrade hunt value
            }
            instances.append(instance_data)

        else:
            lidarr_logger.warning("No API URL or key found in legacy configuration")

    # Use debug level to avoid spamming logs, especially with 0 instances
    return instances

__all__ = ["process_missing_albums", "process_cutoff_upgrades", "get_configured_instances"]