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

def get_configured_instances(quiet=False):
    """Get all configured and enabled Sonarr instances"""
    settings = load_settings("sonarr")
    instances = []


    if not settings:
        if not quiet:
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
                if not quiet:
                    sonarr_logger.debug(f"Instance '{instance.get('name', 'Unnamed')}' has URL without http(s) scheme: {api_url}")
                api_url = f"http://{api_url}"
                if not quiet:
                    sonarr_logger.debug(f"Auto-correcting URL to: {api_url}")

            is_enabled = instance.get("enabled", True)

            # Only include properly configured instances
            if is_enabled and api_url and api_key:
                # Normalize instance name (display only; can be renamed by user)
                raw = instance.get("name", "Default") or "Default"
                instance_name = (raw.strip() if isinstance(raw, str) else "Default") or "Default"

                # Ensure stable instance_id so renaming does not break tracking
                instance_id = instance.get("instance_id")
                if not instance_id:
                    from src.primary.utils.instance_id import generate_instance_id
                    from src.primary.settings_manager import save_settings
                    from src.primary.utils.database import get_database
                    existing_ids = {inst.get("instance_id") for inst in settings["instances"] if isinstance(inst, dict) and inst.get("instance_id")}
                    instance_id = generate_instance_id("sonarr", existing_ids)
                    settings["instances"][idx]["instance_id"] = instance_id
                    save_settings("sonarr", settings)
                    get_database().migrate_instance_identifier("sonarr", instance_name, instance_id)
                    instance["instance_id"] = instance_id

                # Return essential instance details; instance_id for DB keying, instance_name for display
                instance_data = {
                    "instance_id": instance_id,
                    "instance_name": instance_name,
                    "api_url": api_url,
                    "api_key": api_key,
                    "swaparr_enabled": instance.get("swaparr_enabled", False),
                    "hunt_missing_items": instance.get("hunt_missing_items", 1),  # Per-instance missing hunt value
                    "hunt_upgrade_items": instance.get("hunt_upgrade_items", 0),  # Per-instance upgrade hunt value
                    "hunt_missing_mode": instance.get("hunt_missing_mode", "seasons_packs"),  # Per-instance missing mode
                    "upgrade_mode": instance.get("upgrade_mode", "seasons_packs"),  # Per-instance upgrade mode
                    "upgrade_selection_method": (instance.get("upgrade_selection_method") or "cutoff").strip().lower(),  # cutoff or tags (Upgradinatorr)
                    "upgrade_tag": (instance.get("upgrade_tag") or "").strip(),  # Tag to add after processing when method=tags
                    "air_date_delay_days": instance.get("air_date_delay_days", 0),  # Per-instance air date delay
                    "sleep_duration": instance.get("sleep_duration", settings.get("sleep_duration", 900)),  # Per-instance cycle interval
                    "hourly_cap": instance.get("hourly_cap", settings.get("hourly_cap", 20)),  # Per-instance API cap
                    "exempt_tags": instance.get("exempt_tags") or [],
                    "tag_processed_items": instance.get("tag_processed_items", True),  # Add huntarr-upgraded etc. when processing
                    "state_management_hours": instance.get("state_management_hours", 72),  # CRITICAL for Issue #717 fix
                    "state_management_mode": instance.get("state_management_mode", "custom"),  # CRITICAL for Issue #717 fix
                }
                instances.append(instance_data)
    
            elif not is_enabled:
                if not quiet:
                    sonarr_logger.debug(f"Skipping disabled instance: {instance.get('name', 'Unnamed')}")
            else:
                # For brand new installations, don't spam logs with warnings about default instances
                instance_name = instance.get('name', 'Unnamed')
                if instance_name == 'Default':
                    # Use debug level for default instances to avoid log spam on new installations
                    pass
                else:
                    # Still log warnings for non-default instances
                    if not quiet:
                        sonarr_logger.warning(f"Skipping instance '{instance_name}' due to missing API URL or key (URL: '{api_url}', Key Set: {bool(api_key)})")
    else:
        if not quiet:
            sonarr_logger.debug("No instances configured")

    # Use debug level to avoid spamming logs, especially with 0 instances
    return instances

__all__ = ["process_missing_episodes", "process_cutoff_upgrades", "get_configured_instances"]