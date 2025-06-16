"""
Readarr module initialization
"""

# Use src.primary imports
from src.primary.apps.readarr.missing import process_missing_books
from src.primary.apps.readarr.upgrade import process_cutoff_upgrades
# Add necessary imports
from src.primary.settings_manager import load_settings
from src.primary.utils.logger import get_logger

# Define logger for this module
readarr_logger = get_logger("readarr")

def get_configured_instances():
    """Get all configured and enabled Readarr instances"""
    settings = load_settings("readarr")
    instances = []
    # readarr_logger.info(f"Loaded Readarr settings for instance check: {settings}") # Removed verbose log

    if not settings:
        readarr_logger.debug("No settings found for Readarr")
        return instances

    # Check if instances are configured
    if "instances" in settings and isinstance(settings["instances"], list) and settings["instances"]:
        # readarr_logger.info(f"Found 'instances' list with {len(settings['instances'])} items. Processing...") # Removed verbose log
        for idx, instance in enumerate(settings["instances"]):
    
            # Enhanced validation
            api_url = instance.get("api_url", "").strip()
            api_key = instance.get("api_key", "").strip()

            # Enhanced URL validation - ensure URL has proper scheme
            if api_url and not (api_url.startswith('http://') or api_url.startswith('https://')):
                readarr_logger.debug(f"Instance '{instance.get('name', 'Unnamed')}' has URL without http(s) scheme: {api_url}")
                readarr_logger.debug(f"Auto-correcting URL to: {api_url}")
                api_url = f"http://{api_url}"

            is_enabled = instance.get("enabled", True)

            # Only include properly configured instances
            if is_enabled and api_url and api_key:
                # Return only essential instance details including per-instance hunt values
                instance_data = {
                    "instance_name": instance.get("name", "Default"),
                    "api_url": api_url,
                    "api_key": api_key,
                    "swaparr_enabled": instance.get("swaparr_enabled", False),
                    "hunt_missing_books": instance.get("hunt_missing_books", 1),  # Per-instance missing hunt value
                    "hunt_upgrade_books": instance.get("hunt_upgrade_books", 0),  # Per-instance upgrade hunt value
                }
                instances.append(instance_data)
                # readarr_logger.info(f"Added valid instance: {instance_data}") # Removed verbose log
            elif not is_enabled:
                readarr_logger.debug(f"Skipping disabled instance: {instance.get('name', 'Unnamed')}")
            else:
                # For brand new installations, don't spam logs with warnings about default instances
                instance_name = instance.get('name', 'Unnamed')
                if instance_name == 'Default':
                    # Use debug level for default instances to avoid log spam on new installations
                    pass
                else:
                    # Still log warnings for non-default instances
                    readarr_logger.warning(f"Skipping instance '{instance_name}' due to missing API URL or key (URL: '{api_url}', Key Set: {bool(api_key)})")
    else:
        # readarr_logger.info("No 'instances' list found or list is empty. Checking legacy config.") # Removed verbose log
        # Fallback to legacy single-instance config
        api_url = settings.get("api_url", "").strip()
        api_key = settings.get("api_key", "").strip()

        # Ensure URL has proper scheme
        if api_url and not (api_url.startswith('http://') or api_url.startswith('https://')):
            readarr_logger.warning(f"API URL missing http(s) scheme: {api_url}")
            api_url = f"http://{api_url}"
            readarr_logger.warning(f"Auto-correcting URL to: {api_url}")

        if api_url and api_key:
            # Create a clean instance_data dict for the legacy instance
            instance_data = {
                "instance_name": "Default",
                "api_url": api_url,
                "api_key": api_key,
                "swaparr_enabled": settings.get("swaparr_enabled", False),
                "hunt_missing_books": settings.get("hunt_missing_books", 1),  # Legacy missing hunt value
                "hunt_upgrade_books": settings.get("hunt_upgrade_books", 0),  # Legacy upgrade hunt value
            }
            instances.append(instance_data)
            # readarr_logger.info(f"Added valid legacy instance: {instance_data}") # Removed verbose log
        else:
            readarr_logger.warning("No API URL or key found in legacy configuration")

    # Use debug level to avoid spamming logs, especially with 0 instances
    return instances

__all__ = ["process_missing_books", "process_cutoff_upgrades", "get_configured_instances"]