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
    # sonarr_logger.info(f"Loaded Sonarr settings for instance check: {settings}") # Removed verbose log

    if not settings:
        sonarr_logger.debug("No settings found for Sonarr")
        return instances

    # Check if instances are configured
    if "instances" in settings and isinstance(settings["instances"], list) and settings["instances"]:
        # sonarr_logger.info(f"Found 'instances' list with {len(settings['instances'])} items. Processing...") # Removed verbose log
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
                }
                instances.append(instance_data)
                # sonarr_logger.info(f"Added valid instance: {instance_data}") # Removed verbose log
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
        # sonarr_logger.info("No 'instances' list found or list is empty. Checking legacy config.") # Removed verbose log
        # Fallback to legacy single-instance config
        api_url = settings.get("api_url", "").strip()
        api_key = settings.get("api_key", "").strip()

        # Ensure URL has proper scheme
        if api_url and not (api_url.startswith('http://') or api_url.startswith('https://')):
            sonarr_logger.warning(f"API URL missing http(s) scheme: {api_url}")
            api_url = f"http://{api_url}"
            sonarr_logger.warning(f"Auto-correcting URL to: {api_url}")

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
            sonarr_logger.info(f"Using legacy configuration with instance name: 'Default'")
        else:
            sonarr_logger.warning("No API URL or key found in legacy configuration")

    # Use debug level to avoid spamming logs, especially with 0 instances
    return instances

__all__ = ["process_missing_episodes", "process_cutoff_upgrades", "get_configured_instances"]