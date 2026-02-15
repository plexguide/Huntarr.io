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

def get_configured_instances(quiet=False):
    """Get all configured and enabled Radarr instances"""
    settings = load_settings("radarr")
    instances = []
    
    if not settings:
        if not quiet:
            radarr_logger.debug("No settings found for Radarr")
        return instances
        
    # Check if instances are configured
    if "instances" in settings and isinstance(settings["instances"], list) and settings["instances"]:
        for idx, instance in enumerate(settings["instances"]):
            if instance.get("enabled", True) and instance.get("api_url") and instance.get("api_key"):
                # Get URL and key with auto-correction
                api_url = instance.get("api_url", "").strip()
                api_key = instance.get("api_key", "").strip()

                # Enhanced URL validation - ensure URL has proper scheme
                if api_url and not (api_url.startswith('http://') or api_url.startswith('https://')):
                    if not quiet:
                        radarr_logger.debug(f"Instance '{instance.get('name', 'Unnamed')}' has URL without http(s) scheme: {api_url}")
                        radarr_logger.debug(f"Auto-correcting URL to: {api_url}")
                    api_url = f"http://{api_url}"

                instance_name = instance.get("name", "Default") or "Default"
                instance_name = (instance_name.strip() if isinstance(instance_name, str) else "Default") or "Default"
                # Ensure stable instance_id so renaming does not break tracking
                instance_id = instance.get("instance_id")
                if not instance_id:
                    from src.primary.utils.instance_id import generate_instance_id
                    from src.primary.settings_manager import save_settings
                    from src.primary.utils.database import get_database
                    existing_ids = {inst.get("instance_id") for inst in settings["instances"] if isinstance(inst, dict) and inst.get("instance_id")}
                    instance_id = generate_instance_id("radarr", existing_ids)
                    settings["instances"][idx]["instance_id"] = instance_id
                    save_settings("radarr", settings)
                    get_database().migrate_instance_identifier("radarr", instance_name, instance_id)
                    instance = settings["instances"][idx]

                # Create a settings object for this instance by combining global settings with instance-specific ones
                instance_settings = settings.copy()
                # Remove instances list to avoid confusion
                if "instances" in instance_settings:
                    del instance_settings["instances"]
                
                # Override with instance-specific connection settings (using corrected URL)
                instance_settings["api_url"] = api_url
                instance_settings["api_key"] = api_key
                instance_settings["instance_name"] = instance_name
                instance_settings["instance_id"] = instance.get("instance_id")
                instance_settings["swaparr_enabled"] = instance.get("swaparr_enabled", False)
                
                # Add per-instance hunt values for missing/upgrade processing
                instance_settings["hunt_missing_movies"] = instance.get("hunt_missing_movies", 1)
                instance_settings["hunt_upgrade_movies"] = instance.get("hunt_upgrade_movies", 0)
                instance_settings["upgrade_selection_method"] = (instance.get("upgrade_selection_method") or "cutoff").strip().lower()
                instance_settings["upgrade_tag"] = (instance.get("upgrade_tag") or "").strip()
                instance_settings["release_date_delay_days"] = instance.get("release_date_delay_days", 0)
                instance_settings["sleep_duration"] = instance.get("sleep_duration", settings.get("sleep_duration", 900))
                instance_settings["hourly_cap"] = instance.get("hourly_cap", settings.get("hourly_cap", 20))
                instance_settings["exempt_tags"] = instance.get("exempt_tags") or []
                
                # Add state management settings (CRITICAL for Issue #717 fix)
                instance_settings["state_management_hours"] = instance.get("state_management_hours", 72)
                instance_settings["state_management_mode"] = instance.get("state_management_mode", "custom")
                # Queue gating and seed queue (torrents only)
                instance_settings["api_timeout"] = instance.get("api_timeout", 120)
                instance_settings["command_wait_delay"] = instance.get("command_wait_delay", 1)
                instance_settings["command_wait_attempts"] = instance.get("command_wait_attempts", 600)
                instance_settings["max_download_queue_size"] = instance.get("max_download_queue_size", -1)
                instance_settings["max_seed_queue_size"] = instance.get("max_seed_queue_size", -1)
                instance_settings["seed_check_torrent_client"] = instance.get("seed_check_torrent_client")
                
                # Tag settings (CRITICAL: must be passed through or they default to True)
                instance_settings["tag_processed_items"] = instance.get("tag_processed_items", False)
                instance_settings["tag_enable_missing"] = instance.get("tag_enable_missing", False)
                instance_settings["tag_enable_upgrade"] = instance.get("tag_enable_upgrade", False)
                instance_settings["tag_enable_upgraded"] = instance.get("tag_enable_upgraded", False)
                instance_settings["custom_tags"] = instance.get("custom_tags", {})
                
                instances.append(instance_settings)
    else:
        # Fallback to legacy single-instance config
        api_url = settings.get("api_url", "").strip()
        api_key = settings.get("api_key", "").strip()
        
        # Ensure URL has proper scheme for legacy config too
        if api_url and not (api_url.startswith('http://') or api_url.startswith('https://')):
            if not quiet:
                radarr_logger.warning(f"API URL missing http(s) scheme: {api_url}")
            api_url = f"http://{api_url}"
            if not quiet:
                radarr_logger.warning(f"Auto-correcting URL to: {api_url}")
            
        if api_url and api_key:
            settings_copy = settings.copy()
            settings_copy["api_url"] = api_url  # Use corrected URL
            settings_copy["instance_name"] = "Default"
            # Legacy: ensure stable instance_id for default instance
            legacy_id = settings.get("instance_id")
            if not legacy_id:
                from src.primary.utils.instance_id import generate_instance_id
                from src.primary.settings_manager import save_settings
                from src.primary.utils.database import get_database
                legacy_id = generate_instance_id("radarr", set())
                settings["instance_id"] = legacy_id
                save_settings("radarr", settings)
                get_database().migrate_instance_identifier("radarr", "Default", legacy_id)
            settings_copy["instance_id"] = legacy_id
            settings_copy["swaparr_enabled"] = settings.get("swaparr_enabled", False)
            # Add per-instance hunt values for legacy config
            settings_copy["hunt_missing_movies"] = settings.get("hunt_missing_movies", 1)
            settings_copy["hunt_upgrade_movies"] = settings.get("hunt_upgrade_movies", 0)
            settings_copy["upgrade_selection_method"] = (settings.get("upgrade_selection_method") or "cutoff").strip().lower()
            settings_copy["upgrade_tag"] = (settings.get("upgrade_tag") or "").strip()
            settings_copy["release_date_delay_days"] = settings.get("release_date_delay_days", 0)
            settings_copy["sleep_duration"] = settings.get("sleep_duration", 900)
            settings_copy["hourly_cap"] = settings.get("hourly_cap", 20)
            # Add state management settings for legacy config (CRITICAL for Issue #717 fix)
            settings_copy["state_management_hours"] = settings.get("state_management_hours", 72)
            settings_copy["state_management_mode"] = settings.get("state_management_mode", "custom")
            # Queue gating and seed queue (torrents only)
            settings_copy["max_download_queue_size"] = settings.get("max_download_queue_size", -1)
            settings_copy["max_seed_queue_size"] = settings.get("max_seed_queue_size", -1)
            settings_copy["seed_check_torrent_client"] = settings.get("seed_check_torrent_client")
            instances.append(settings_copy)
    
    # Use debug level to avoid spamming logs, especially with 0 instances
    return instances

__all__ = ["process_missing_movies", "process_cutoff_upgrades", "get_configured_instances"]