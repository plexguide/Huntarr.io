"""
Whisparr app module for Huntarr
Contains functionality for missing items and quality upgrades in Whisparr

Exclusively supports the v2 API (legacy).
"""

# Module exports
from src.primary.apps.whisparr.missing import process_missing_items
from src.primary.apps.whisparr.upgrade import process_cutoff_upgrades
from src.primary.settings_manager import load_settings
from src.primary.utils.logger import get_logger

# Define logger for this module
whisparr_logger = get_logger("whisparr")



def get_configured_instances(quiet=False):
    """Get all configured and enabled Whisparr instances"""
    settings = load_settings("whisparr")
    instances = []
    # Use debug level to avoid log spam on new installations


    if not settings:
        if not quiet:
            whisparr_logger.debug("No settings found for Whisparr")
        return instances

    # Always use Whisparr V2 API
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
                if not quiet:
                    whisparr_logger.debug(f"Instance '{instance.get('name', 'Unnamed')}' has URL without http(s) scheme: {api_url}")
                api_url = f"http://{api_url}"
                if not quiet:
                    whisparr_logger.debug(f"Auto-correcting URL to: {api_url}")

            is_enabled = instance.get("enabled", True)

            # Only include properly configured instances
            if is_enabled and api_url and api_key:
                raw = instance.get("name", "Default") or "Default"
                instance_name = (raw.strip() if isinstance(raw, str) else "Default") or "Default"
                # Ensure stable instance_id so renaming does not break tracking
                instance_id = instance.get("instance_id")
                if not instance_id:
                    from src.primary.utils.instance_id import generate_instance_id
                    from src.primary.settings_manager import save_settings
                    from src.primary.utils.database import get_database
                    existing_ids = {inst.get("instance_id") for inst in settings["instances"] if isinstance(inst, dict) and inst.get("instance_id")}
                    instance_id = generate_instance_id("whisparr", existing_ids)
                    settings["instances"][idx]["instance_id"] = instance_id
                    save_settings("whisparr", settings)
                    get_database().migrate_instance_identifier("whisparr", instance_name, instance_id)
                    instance_id = settings["instances"][idx].get("instance_id")

                # Create a settings object for this instance by combining global settings with instance-specific ones
                instance_settings = settings.copy()
                
                # Remove instances list to avoid confusion
                if "instances" in instance_settings:
                    del instance_settings["instances"]
                
                # Override with instance-specific settings
                instance_settings["api_url"] = api_url
                instance_settings["api_key"] = api_key
                instance_settings["instance_name"] = instance_name
                instance_settings["instance_id"] = instance_id
                instance_settings["swaparr_enabled"] = instance.get("swaparr_enabled", False)
                
                # Add timeout setting with default if not present
                if "api_timeout" not in instance_settings:
                    instance_settings["api_timeout"] = 30
                
                # Use debug level to prevent log spam
                if not quiet:
                    whisparr_logger.debug(f"Adding configured Whisparr instance: {instance_name}")

                # Return only essential instance details including per-instance hunt values
                instance_data = {
                    "instance_id": instance_id,
                    "instance_name": instance_name,
                    "api_url": api_url,
                    "api_key": api_key,
                    "swaparr_enabled": instance.get("swaparr_enabled", False),
                    "hunt_missing_items": instance.get("hunt_missing_items", 1),  # Per-instance missing hunt value
                    "hunt_upgrade_items": instance.get("hunt_upgrade_items", 0),  # Per-instance upgrade hunt value
                    "upgrade_selection_method": (instance.get("upgrade_selection_method") or "cutoff").strip().lower(),
                    "upgrade_tag": (instance.get("upgrade_tag") or "").strip(),
                    "sleep_duration": instance.get("sleep_duration", settings.get("sleep_duration", 900)),
                    "hourly_cap": instance.get("hourly_cap", settings.get("hourly_cap", 20)),
                    "exempt_tags": instance.get("exempt_tags") or [],
                    "state_management_hours": instance.get("state_management_hours", 72),  # CRITICAL for Issue #717 fix
                    "state_management_mode": instance.get("state_management_mode", "custom"),  # CRITICAL for Issue #717 fix
                    "api_timeout": instance.get("api_timeout", 120),
                    "command_wait_delay": instance.get("command_wait_delay", 1),
                    "command_wait_attempts": instance.get("command_wait_attempts", 600),
                    "max_download_queue_size": instance.get("max_download_queue_size", -1),
                    "max_seed_queue_size": instance.get("max_seed_queue_size", -1),
                    "seed_check_torrent_client": instance.get("seed_check_torrent_client"),
                    # Tag settings (CRITICAL: must be passed through or they default to True)
                    "tag_processed_items": instance.get("tag_processed_items", False),
                    "tag_enable_missing": instance.get("tag_enable_missing", False),
                    "tag_enable_upgrade": instance.get("tag_enable_upgrade", False),
                    "tag_enable_upgraded": instance.get("tag_enable_upgraded", False),
                    "custom_tags": instance.get("custom_tags", {}),
                }
                instances.append(instance_data)
            else:
                name = instance.get("name", "Unnamed")
                if not is_enabled:
                    if not quiet:
                        whisparr_logger.debug(f"Skipping disabled instance: {name}")
                else:
                    # For brand new installations, don't spam logs with warnings about default instances
                    if name == 'Default':
                        # Use debug level for default instances to avoid log spam on new installations
                        pass
                    else:
                        # Still log warnings for non-default instances
                        if not quiet:
                            whisparr_logger.warning(f"Skipping instance {name} due to missing API URL or API Key")
    else:
        if not quiet:
            whisparr_logger.debug("No instances array found in settings or it's empty")
    
    # Use debug level to avoid spamming logs, especially with 0 instances
    return instances

__all__ = ["process_missing_items", "process_cutoff_upgrades", "get_configured_instances"]