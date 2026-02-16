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

def get_configured_instances(quiet=False):
    """Get all configured and enabled Lidarr instances"""
    settings = load_settings("lidarr")
    instances = []


    if not settings:
        if not quiet:
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
                if not quiet:
                    lidarr_logger.debug(f"Instance '{instance.get('name', 'Unnamed')}' has URL without http(s) scheme: {api_url}")
                api_url = f"http://{api_url}"
                if not quiet:
                    lidarr_logger.debug(f"Auto-correcting URL to: {api_url}")

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
                    instance_id = generate_instance_id("lidarr", existing_ids)
                    settings["instances"][idx]["instance_id"] = instance_id
                    save_settings("lidarr", settings)
                    get_database().migrate_instance_identifier("lidarr", instance_name, instance_id)
                    instance_id = settings["instances"][idx].get("instance_id")

                # Return only essential instance details including per-instance hunt values
                instance_data = {
                    "instance_id": instance_id,
                    "instance_name": instance_name,
                    "api_url": api_url,
                    "api_key": api_key,
                    "swaparr_enabled": instance.get("swaparr_enabled", False),
                    "hunt_missing_items": instance.get("hunt_missing_items", 1),  # Per-instance missing hunt value
                    "hunt_upgrade_items": instance.get("hunt_upgrade_items", 0),  # Per-instance upgrade hunt value
                    "hunt_missing_mode": instance.get("hunt_missing_mode", "album"),  # Per-instance missing mode
                    "upgrade_mode": instance.get("upgrade_mode", "seasons_packs"),  # Per-instance upgrade mode
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
    
            elif not is_enabled:
                if not quiet:
                    lidarr_logger.debug(f"Skipping disabled instance: {instance.get('name', 'Unnamed')}")
            else:
                # For brand new installations, don't spam logs with warnings about default instances
                instance_name = instance.get('name', 'Unnamed')
                if instance_name == 'Default':
                    # Use debug level for default instances to avoid log spam on new installations
                    pass
                else:
                    # Still log warnings for non-default instances
                    if not quiet:
                        lidarr_logger.warning(f"Skipping instance '{instance_name}' due to missing API URL or key (URL: '{api_url}', Key Set: {bool(api_key)})")
    else:

        # Fallback to legacy single-instance config
        api_url = settings.get("api_url", "").strip()
        api_key = settings.get("api_key", "").strip()
        is_enabled = settings.get("enabled", True)

        # Ensure URL has proper scheme
        if api_url and not (api_url.startswith('http://') or api_url.startswith('https://')):
            if not quiet:
                lidarr_logger.warning(f"API URL missing http(s) scheme: {api_url}")
            api_url = f"http://{api_url}"
            if not quiet:
                lidarr_logger.warning(f"Auto-correcting URL to: {api_url}")

        if not is_enabled:
            if not quiet:
                lidarr_logger.debug("Skipping disabled legacy Lidarr instance")
        elif api_url and api_key:
            # Create a clean instance_data dict for the legacy instance
            instance_data = {
                "instance_name": "Default",
                "api_url": api_url,
                "api_key": api_key,
                "swaparr_enabled": settings.get("swaparr_enabled", False),
                "hunt_missing_items": settings.get("hunt_missing_items", 1),  # Legacy missing hunt value
                "hunt_upgrade_items": settings.get("hunt_upgrade_items", 0),  # Legacy upgrade hunt value
                "upgrade_selection_method": (settings.get("upgrade_selection_method") or "cutoff").strip().lower(),
                "upgrade_tag": (settings.get("upgrade_tag") or "").strip(),
                "sleep_duration": settings.get("sleep_duration", 900),
                "hourly_cap": settings.get("hourly_cap", 20),
                "state_management_hours": settings.get("state_management_hours", 72),  # CRITICAL for Issue #717 fix
                "state_management_mode": settings.get("state_management_mode", "custom"),  # CRITICAL for Issue #717 fix
                "api_timeout": settings.get("api_timeout", 120),
                "max_download_queue_size": settings.get("max_download_queue_size", -1),
                "max_seed_queue_size": settings.get("max_seed_queue_size", -1),
                "seed_check_torrent_client": settings.get("seed_check_torrent_client"),
            }
            instances.append(instance_data)

        else:
            if not quiet:
                lidarr_logger.warning("No API URL or key found in legacy configuration")

    # Use debug level to avoid spamming logs, especially with 0 instances
    return instances

__all__ = ["process_missing_albums", "process_cutoff_upgrades", "get_configured_instances"]