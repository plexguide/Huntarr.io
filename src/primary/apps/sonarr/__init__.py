"""
Sonarr module initialization
"""

# Use src.primary imports
from src.primary.apps.sonarr.missing import process_missing_episodes
from src.primary.apps.sonarr.upgrade import process_cutoff_upgrades
from src.primary.settings_manager import load_settings
from src.primary.utils.logger import get_logger

# Define logger for this module
sonarr_logger = get_logger("sonarr")

def get_configured_instances():
    """Get all configured and enabled Sonarr instances"""
    settings = load_settings("sonarr")
    instances = []


    if not settings:
        sonarr_logger.debug("No settings found for Sonarr")
        return instances

    # Check if instances are configured
    if "instances" in settings and isinstance(settings["instances"], list) and settings["instances"]:

        for idx, instance in enumerate(settings["instances"]):
    
            # Enhanced validation
            api_url = instance.get("api_url", "").strip()
            api_key = instance.get("api_key", "").strip()

            # Enhanced URL validation - ensure URL has proper scheme
            if api_url and not (api_url.startswith('http://') or api_url.startswith('https://')):
                sonarr_logger.debug(f"Instance '{instance.get('name', 'Unnamed')}' has URL without http(s) scheme: {api_url}")
                api_url = f"http://{api_url}"
                sonarr_logger.debug(f"Auto-correcting URL to: {api_url}")

            is_enabled = instance.get("enabled", True)

            # Only include properly configured instances
            if is_enabled and api_url and api_key:
                # Get the exact instance name as configured in the UI
                instance_name = instance.get("name", "Default") 
    
                
                # Return only essential instance details including per-instance hunt values
                instance_data = {
                    "instance_name": instance_name,
                    "api_url": api_url,
                    "api_key": api_key,
                    "swaparr_enabled": instance.get("swaparr_enabled", False),
                    "hunt_missing_items": instance.get("hunt_missing_items", 1),  # Per-instance missing hunt value
                    "hunt_upgrade_items": instance.get("hunt_upgrade_items", 0),  # Per-instance upgrade hunt value
                    "hunt_missing_mode": instance.get("hunt_missing_mode", "seasons_packs"),  # Per-instance missing mode
                    "upgrade_mode": instance.get("upgrade_mode", "seasons_packs"),  # Per-instance upgrade mode
                }
                instances.append(instance_data)
    
            elif not is_enabled:
                sonarr_logger.debug(f"Skipping disabled instance: {instance.get('name', 'Unnamed')}")
            else:
                # For brand new installations, don't spam logs with warnings about default instances
                instance_name = instance.get('name', 'Unnamed')
                if instance_name == 'Default':
                    # Use debug level for default instances to avoid log spam on new installations
                    pass
                else:
                    # Still log warnings for non-default instances
                    sonarr_logger.warning(f"Skipping instance '{instance_name}' due to missing API URL or key (URL: '{api_url}', Key Set: {bool(api_key)})")
    else:
        sonarr_logger.debug("No instances configured")

    # Use debug level to avoid spamming logs, especially with 0 instances
    return instances

__all__ = ["process_missing_episodes", "process_cutoff_upgrades", "get_configured_instances"]