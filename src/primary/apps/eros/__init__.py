"""
Eros app module for Huntarr
Contains functionality for missing items and quality upgrades in Eros

Exclusively supports the v3 API.
"""

# Module exports
from src.primary.apps.eros.missing import process_missing_items
from src.primary.apps.eros.upgrade import process_cutoff_upgrades
from src.primary.settings_manager import load_settings
from src.primary.utils.logger import get_logger

# Define logger for this module
eros_logger = get_logger("eros")

# For backward compatibility
process_missing_scenes = process_missing_items

def get_configured_instances():
    """Get all configured and enabled Eros instances"""
    settings = load_settings("eros")
    instances = []
    # Use debug level to avoid log spam on new installations
    # eros_logger.debug(f"Loaded Eros settings for instance check: {settings}") # Removed verbose log

    if not settings:
        eros_logger.debug("No settings found for Eros")
        return instances

    # Always use Eros V3 API
    # Use debug level to avoid log spam on new installations


    # Check if instances are configured
    if "instances" in settings and isinstance(settings["instances"], list) and settings["instances"]:
        # Use debug level to avoid log spam on new installations
        # Instance count debug removed to reduce log spam
        for idx, instance in enumerate(settings["instances"]):
    
            # Enhanced validation
            api_url = instance.get("api_url", "").strip()
            api_key = instance.get("api_key", "").strip()

            # Enhanced URL validation - ensure URL has proper scheme
            if api_url and not (api_url.startswith('http://') or api_url.startswith('https://')):
                eros_logger.debug(f"Instance '{instance.get('name', 'Unnamed')}' has URL without http(s) scheme: {api_url}")
                api_url = f"http://{api_url}"
                eros_logger.debug(f"Auto-correcting URL to: {api_url}")

            is_enabled = instance.get("enabled", True)

            # Only include properly configured instances
            if is_enabled and api_url and api_key:
                instance_name = instance.get("name", "Default")
                
                # Create a settings object for this instance by combining global settings with instance-specific ones
                instance_settings = settings.copy()
                
                # Remove instances list to avoid confusion
                if "instances" in instance_settings:
                    del instance_settings["instances"]
                
                # Override with instance-specific settings
                instance_settings["api_url"] = api_url
                instance_settings["api_key"] = api_key
                instance_settings["instance_name"] = instance_name
                instance_settings["swaparr_enabled"] = instance.get("swaparr_enabled", False)
                
                # Add timeout setting with default if not present
                if "api_timeout" not in instance_settings:
                    instance_settings["api_timeout"] = 30
                
                # Use debug level to prevent log spam
                eros_logger.debug(f"Adding configured Eros instance: {instance_name}")

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
            else:
                name = instance.get("name", "Unnamed")
                if not is_enabled:
                    eros_logger.debug(f"Skipping disabled instance: {name}")
                else:
                    # For brand new installations, don't spam logs with warnings about default instances
                    if name == 'Default':
                        # Use debug level for default instances to avoid log spam on new installations
                        pass
                    else:
                        # Still log warnings for non-default instances
                        eros_logger.warning(f"Skipping instance {name} due to missing API URL or API Key")
    else:
        eros_logger.debug("No instances array found in settings or it's empty")
    
    # Use debug level to avoid spamming logs, especially with 0 instances
    return instances

__all__ = ["process_missing_items", "process_missing_scenes", "process_cutoff_upgrades", "get_configured_instances"]
