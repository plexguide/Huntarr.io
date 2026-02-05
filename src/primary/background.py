#!/usr/bin/env python3
"""
Huntarr - Main entry point for the application
Supports multiple Arr applications running concurrently
"""

import time
import sys
import os
# import socket # No longer used directly
import signal
import importlib
import logging
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Dict, List, Optional, Callable, Union, Tuple
import datetime
import traceback
import pytz

# Define the version number
__version__ = "1.0.0" # Consider updating this based on changes

# Set up logging first
from src.primary.utils.logger import setup_main_logger, get_logger # Import get_logger
logger = setup_main_logger()

# Import necessary modules
from src.primary import config, settings_manager
# Removed keys_manager import as settings_manager handles API details
from src.primary.state import check_state_reset, calculate_reset_time
from src.primary.stats_manager import check_hourly_cap_exceeded
# Instance list generator has been removed
from src.primary.scheduler_engine import start_scheduler, stop_scheduler

# from src.primary.utils.app_utils import get_ip_address # No longer used here

# Global state for managing app threads and their status
app_threads: Dict[str, threading.Thread] = {}
stop_event = threading.Event() # Use an event for clearer stop signaling

# Hourly cap scheduler thread
hourly_cap_scheduler_thread = None

# Swaparr processing thread
swaparr_thread = None

# Background refresher for Prowlarr statistics
prowlarr_stats_thread = None

# Define which apps have background processing cycles
CYCLICAL_APP_TYPES = ["sonarr", "radarr", "lidarr", "readarr", "whisparr", "eros"]

# Apps that schedule each instance on its own interval (only run an instance when its next_cycle_time is due)
# All cyclical *arr apps use per-instance scheduling for true independent timing.
PER_INSTANCE_SCHEDULING_APP_TYPES = {"sonarr", "radarr", "lidarr", "readarr", "whisparr", "eros"}

# Instance list generator has been removed

def _get_user_timezone():
    """Get the user's selected timezone from general settings"""
    try:
        from src.primary.utils.timezone_utils import get_user_timezone
        return get_user_timezone()
    except Exception:
        return pytz.UTC


def _responsive_sleep(
    app_type: str,
    sleep_seconds: float,
    app_logger: logging.Logger,
    instances_for_reset: Optional[List[Dict]] = None,
    wait_interval: int = 1,
) -> None:
    """
    Sleep for up to sleep_seconds while checking stop_event and optional per-instance
    reset requests every wait_interval seconds. Uses threading.Event.wait() so the
    thread can be woken quickly on shutdown or manual "run now".
    """
    elapsed = 0
    instances = instances_for_reset or []
    while elapsed < sleep_seconds:
        if stop_event.is_set():
            app_logger.info("Stop event detected during sleep. Breaking out of sleep cycle.")
            return
        try:
            from src.primary.utils.database import get_database
            db = get_database()
            for inst in instances:
                iname = inst.get("instance_id") or inst.get("instance_name", "Default")
                reset_ts = db.get_pending_reset_request(app_type, iname)
                if reset_ts:
                    app_logger.info(
                        f"!!! RESET REQUEST DETECTED !!! Manual cycle reset triggered for {app_type} instance {inst.get('instance_name', iname)}. Starting new cycle immediately."
                    )
                    db.mark_reset_request_processed(app_type, iname)
                    return
        except Exception as e:
            app_logger.error(f"Error checking reset request during sleep for {app_type}: {e}", exc_info=True)
        stop_event.wait(wait_interval)
        elapsed += wait_interval


def _parse_next_cycle_time(next_str: Optional[str], user_tz) -> Optional[datetime.datetime]:
    """Parse next_cycle_time from DB (isoformat string) to datetime in user_tz. Returns None if missing/invalid."""
    if not next_str or not isinstance(next_str, str):
        return None
    try:
        dt = datetime.datetime.fromisoformat(next_str.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = user_tz.localize(dt)
        elif dt.tzinfo != user_tz:
            dt = dt.astimezone(user_tz)
        return dt.replace(microsecond=0)
    except (ValueError, TypeError):
        return None


def _get_instances_due_and_sleep(
    app_type: str,
    instances_to_process: List[Dict],
    app_settings: Dict,
    app_logger: logging.Logger,
) -> Tuple[List[Dict], float]:
    """
    Per-instance scheduling: return (instances that are due now, seconds to sleep until next due).
    Used when PER_INSTANCE_SCHEDULING_APP_TYPES contains app_type so each instance runs on its own interval.
    """
    from src.primary.utils.database import get_database
    user_tz = _get_user_timezone()
    now = datetime.datetime.now(user_tz).replace(microsecond=0)
    default_sleep = app_settings.get("sleep_duration", 900)
    sleep_data = get_database().get_sleep_data_per_instance(app_type)  # instance_id -> { next_cycle_time, ... }
    instances_due = []
    next_cycle_times = []  # list of datetime for instances not due (future)
    for inst in instances_to_process:
        iname = inst.get("instance_id") or inst.get("instance_name", "Default")
        next_str = (sleep_data.get(iname) or {}).get("next_cycle_time")
        next_dt = _parse_next_cycle_time(next_str, user_tz)
        inst["_next_cycle_dt"] = next_dt
        if next_dt is None or now >= next_dt:
            instances_due.append(inst)
        else:
            next_cycle_times.append(next_dt)
    # Seconds until soonest next cycle (any instance)
    if next_cycle_times:
        soonest = min(next_cycle_times)
        sleep_seconds = (soonest - now).total_seconds()
        sleep_seconds = max(1, min(sleep_seconds, 24 * 3600))  # clamp 1s to 24h (avoid negative from clock skew)
    else:
        sleep_seconds = min(
            (d.get("sleep_duration", default_sleep) for d in instances_to_process),
            default=default_sleep
        )
    return (instances_due, float(sleep_seconds))


def _get_sleep_seconds_until_next_cycle(
    app_type: str,
    instances_to_process: List[Dict],
    app_settings: Dict,
) -> float:
    """After processing, return seconds to sleep until the soonest next_cycle_time across all instances."""
    from src.primary.utils.database import get_database
    user_tz = _get_user_timezone()
    now = datetime.datetime.now(user_tz).replace(microsecond=0)
    default_sleep = app_settings.get("sleep_duration", 900)
    sleep_data = get_database().get_sleep_data_per_instance(app_type)
    next_times = []
    for inst in instances_to_process:
        iname = inst.get("instance_id") or inst.get("instance_name", "Default")
        next_str = (sleep_data.get(iname) or {}).get("next_cycle_time")
        next_dt = _parse_next_cycle_time(next_str, user_tz)
        if next_dt is not None and next_dt > now:
            next_times.append(next_dt)
    if next_times:
        soonest = min(next_times)
        secs = (soonest - now).total_seconds()
        return max(1, min(secs, 24 * 3600))  # clamp 1s to 24h (avoid negative from clock skew)
    return min(
        (d.get("sleep_duration", default_sleep) for d in instances_to_process),
        default=default_sleep
    )


def app_specific_loop(app_type: str) -> None:
    """
    Main processing loop for a specific Arr application.

    Args:
        app_type: The type of Arr application (sonarr, radarr, lidarr, readarr)
    """
    from src.primary.cycle_tracker import update_next_cycle
    
    app_logger = get_logger(app_type)
    app_logger.info(f"=== [{app_type.upper()}] Thread starting ===")

    # Immediately exit for non-cyclical apps (e.g., prowlarr, swaparr)
    if app_type not in CYCLICAL_APP_TYPES:
        app_logger.info(f"Skipping background loop for non-cyclical app: {app_type}")
        return

    # Dynamically import app-specific modules
    process_missing = None
    process_upgrades = None
    get_queue_size = None
    check_connection = None
    get_instances_func = None # Default: No multi-instance function found
    hunt_missing_setting = ""
    hunt_upgrade_setting = ""

    try:
        # Import the main app module first to check for get_configured_instances
        app_module = importlib.import_module(f'src.primary.apps.{app_type}')
        api_module = importlib.import_module(f'src.primary.apps.{app_type}.api')
        missing_module = importlib.import_module(f'src.primary.apps.{app_type}.missing')
        upgrade_module = importlib.import_module(f'src.primary.apps.{app_type}.upgrade')

        # Try to get the multi-instance function from the main app module
        try:
            get_instances_func = getattr(app_module, 'get_configured_instances')
        except AttributeError:
            get_instances_func = None # Explicitly set to None if not found

        check_connection = getattr(api_module, 'check_connection')
        get_queue_size = getattr(api_module, 'get_download_queue_size', lambda api_url, api_key, api_timeout: 0) # Default if not found

        if app_type == "sonarr":
            missing_module = importlib.import_module('src.primary.apps.sonarr.missing')
            upgrade_module = importlib.import_module('src.primary.apps.sonarr.upgrade')
            process_missing = getattr(missing_module, 'process_missing_episodes')
            process_upgrades = getattr(upgrade_module, 'process_cutoff_upgrades')
            hunt_missing_setting = "hunt_missing_items"
            hunt_upgrade_setting = "hunt_upgrade_items"
        elif app_type == "radarr":
            missing_module = importlib.import_module('src.primary.apps.radarr.missing')
            upgrade_module = importlib.import_module('src.primary.apps.radarr.upgrade')
            process_missing = getattr(missing_module, 'process_missing_movies')
            process_upgrades = getattr(upgrade_module, 'process_cutoff_upgrades')
            hunt_missing_setting = "hunt_missing_movies"
            hunt_upgrade_setting = "hunt_upgrade_movies"
        elif app_type == "lidarr":
            missing_module = importlib.import_module('src.primary.apps.lidarr.missing')
            upgrade_module = importlib.import_module('src.primary.apps.lidarr.upgrade')
            # Use process_missing_albums as the function name
            process_missing = getattr(missing_module, 'process_missing_albums') 
            process_upgrades = getattr(upgrade_module, 'process_cutoff_upgrades')
            hunt_missing_setting = "hunt_missing_items"
            # Use hunt_upgrade_items
            hunt_upgrade_setting = "hunt_upgrade_items" 
        elif app_type == "readarr":
            missing_module = importlib.import_module('src.primary.apps.readarr.missing')
            upgrade_module = importlib.import_module('src.primary.apps.readarr.upgrade')
            process_missing = getattr(missing_module, 'process_missing_books')
            process_upgrades = getattr(upgrade_module, 'process_cutoff_upgrades')
            hunt_missing_setting = "hunt_missing_books"
            hunt_upgrade_setting = "hunt_upgrade_books"
        elif app_type == "whisparr":
            missing_module = importlib.import_module('src.primary.apps.whisparr.missing')
            upgrade_module = importlib.import_module('src.primary.apps.whisparr.upgrade')
            process_missing = getattr(missing_module, 'process_missing_items')
            process_upgrades = getattr(upgrade_module, 'process_cutoff_upgrades')
            hunt_missing_setting = "hunt_missing_items"  # Updated to new name
            hunt_upgrade_setting = "hunt_upgrade_items"  # Updated to new name
        elif app_type == "eros":
            missing_module = importlib.import_module('src.primary.apps.eros.missing')
            upgrade_module = importlib.import_module('src.primary.apps.eros.upgrade')
            process_missing = getattr(missing_module, 'process_missing_items')
            process_upgrades = getattr(upgrade_module, 'process_cutoff_upgrades')
            hunt_missing_setting = "hunt_missing_items"
            hunt_upgrade_setting = "hunt_upgrade_items"

        else:
            app_logger.error(f"Unsupported app_type: {app_type}")
            return # Exit thread if app type is invalid

    except (ImportError, AttributeError) as e:
        app_logger.error(f"Failed to import modules or functions for {app_type}: {e}", exc_info=True)
        return # Exit thread if essential modules fail to load

    # Create app-specific logger using provided function
    app_logger = logging.getLogger(f"huntarr.{app_type}")
    
    while not stop_event.is_set():
        # --- Load Settings for this Cycle --- #
        try:
            # Load all settings for this app for the current cycle
            app_settings = settings_manager.load_settings(app_type) # Corrected function name
            if not app_settings: # Handle case where loading fails
                app_logger.error("Failed to load settings. Skipping cycle.")
                stop_event.wait(60) # Wait a minute before retrying
                continue

            # Get global settings needed for cycle timing
            sleep_duration = app_settings.get("sleep_duration", 900)
            api_timeout = app_settings.get("api_timeout", 120) # Default to 120 seconds

        except Exception as e:
            app_logger.error(f"Error loading settings for cycle: {e}", exc_info=True)
            stop_event.wait(60) # Wait before retrying
            continue

        # --- State Reset Check --- #
        # REMOVED: Global check_state_reset(app_type) - this was resetting ALL instances at once!
        # Per-instance state reset now happens inside _process_one_instance() for each instance individually

        app_logger.info(f"=== Starting {app_type.upper()} cycle ===")

        # Check if we need to use multi-instance mode
        instances_to_process = []
        
        # Use the dynamically loaded function (if found)
        if get_instances_func:
            # Multi-instance mode supported
            try:
                instances_to_process = get_instances_func(quiet=True) # Call the dynamically loaded function
                if instances_to_process:
                    # Instance count logging removed to reduce log spam
                    pass
                else:
                    # No instances found via get_configured_instances
                    app_logger.debug(f"No configured {app_type} instances found. Skipping cycle.")
                    
                    # Mark cycle as ended even if no instances (set cyclelock to False)
                    try:
                        from src.primary.cycle_tracker import end_cycle, update_next_cycle
                        user_tz = _get_user_timezone()
                        now_user_tz = datetime.datetime.now(user_tz).replace(microsecond=0)
                        next_cycle_time = now_user_tz + datetime.timedelta(seconds=sleep_duration)
                        next_cycle_naive = next_cycle_time.replace(tzinfo=None) if next_cycle_time.tzinfo else next_cycle_time
                        end_cycle(app_type, next_cycle_naive)
                        update_next_cycle(app_type, next_cycle_naive)
                    except Exception as e:
                        app_logger.warning(f"Failed to update cycle tracking for {app_type}: {e}")

                    _responsive_sleep(app_type, sleep_duration, app_logger, [])
                    continue
            except Exception as e:
                app_logger.error(f"Error calling get_configured_instances function: {e}", exc_info=True)
                stop_event.wait(60)
                continue
        else:
            # get_instances_func is None (either not defined in app module or import failed earlier)
            # Fallback to single instance mode using base settings if available
            api_url = app_settings.get("api_url")
            api_key = app_settings.get("api_key")
            instance_name = app_settings.get("name", f"{app_type.capitalize()} Default") # Use 'name' or default
            
            if api_url and api_key:
                app_logger.info(f"Processing {app_type} as single instance: {instance_name}")
                # Create a list with a single dict matching the multi-instance structure
                instances_to_process = [{
                    "instance_name": instance_name, 
                    "api_url": api_url, 
                    "api_key": api_key
                }]
            else:
                app_logger.warning(f"No 'get_configured_instances' function found and no valid single instance config (URL/Key) for {app_type}. Skipping cycle.")
                _responsive_sleep(app_type, sleep_duration, app_logger, [])
                continue
            
        # If after all checks, instances_to_process is still empty
        if not instances_to_process:
            app_logger.warning(f"No valid {app_type} instances to process this cycle (unexpected state). Skipping.")
            _responsive_sleep(app_type, sleep_duration, app_logger, [])
            continue

        # Use minimum sleep_duration across instances (wake for soonest instance)
        sleep_duration = min(
            (d.get("sleep_duration", app_settings.get("sleep_duration", 900)) for d in instances_to_process)
        )
        all_instances = list(instances_to_process)  # full list for per-instance sleep calculation

        # Per-instance scheduling: only run instances whose next_cycle_time is due; sleep until soonest next
        if app_type in PER_INSTANCE_SCHEDULING_APP_TYPES:
            instances_due, sleep_until_next = _get_instances_due_and_sleep(
                app_type, instances_to_process, app_settings, app_logger
            )
            if not instances_due:
                names = [inst.get("instance_name", "Default") for inst in all_instances]
                app_logger.info(
                    f"No {app_type} instances due this cycle (instances: {', '.join(names)}). Sleeping {sleep_until_next:.0f}s until next."
                )
                _responsive_sleep(app_type, sleep_until_next, app_logger, all_instances, wait_interval=1)
                continue
            instances_to_process = instances_due
            due_names = [inst.get("instance_name", "Default") for inst in instances_to_process]
            all_names = [inst.get("instance_name", "Default") for inst in all_instances]
            app_logger.info(
                f"Per-instance schedule: running due instances: {', '.join(due_names)} ({len(instances_to_process)} of {len(all_instances)} total: {', '.join(all_names)})"
            )
            
        # Process each instance dictionary returned by get_configured_instances (or only due instances if per-instance scheduling)
        processed_any_items = False
        enabled_instances = []
        
        try:
            from src.primary.cycle_tracker import start_cycle, end_cycle, set_cycle_activity, clear_cycle_activity
            from src.primary.utils.clean_logger import set_instance_log_context, clear_instance_log_context, set_instance_name_for_cap
        except Exception:
            start_cycle = end_cycle = set_cycle_activity = clear_cycle_activity = None
            set_instance_log_context = clear_instance_log_context = set_instance_name_for_cap = None

        def _has_pending_reset(atype: str, iname: str) -> bool:
            """True if a reset was requested for this instance (so we can stop current work and restart)."""
            try:
                from src.primary.utils.database import get_database
                return get_database().get_pending_reset_request(atype, iname) is not None
            except Exception:
                return False

        def _process_one_instance(instance_details):
            """Process a single instance in parallel; returns (processed_any, instance_name, had_reset, should_append)."""
            processed_any_this = False
            instance_name = instance_details.get("instance_name", "Default")  # Display name (can be renamed)
            instance_key = instance_details.get("instance_id") or instance_details.get("instance_name", "Default")  # Stable key for DB
            instance_sleep = instance_details.get("sleep_duration", app_settings.get("sleep_duration", 900))
            user_tz = _get_user_timezone()
            now_user_tz = datetime.datetime.now(user_tz).replace(microsecond=0)
            next_cycle_time = now_user_tz + datetime.timedelta(seconds=instance_sleep)
            next_cycle_naive = next_cycle_time.replace(tzinfo=None) if next_cycle_time.tzinfo else next_cycle_time

            try:
                # Per-instance cycle and logs: start cycle for this instance, set log context so DB shows e.g. Sonarr-TestInstance
                if start_cycle:
                    start_cycle(app_type, instance_name=instance_key, log_name=instance_name)
                if set_instance_log_context:
                    set_instance_log_context(f"{app_type.capitalize()}-{instance_name}")
                if set_instance_name_for_cap:
                    set_instance_name_for_cap(instance_key)
                if _has_pending_reset(app_type, instance_key):
                    app_logger.info(f"Reset requested for {app_type} instance {instance_name}; ending cycle and restarting.")
                    if end_cycle:
                        end_cycle(app_type, next_cycle_naive, instance_name=instance_key, log_name=instance_name)
                    if clear_instance_log_context:
                        clear_instance_log_context()
                    return (processed_any_this, instance_name, True, False)
            except Exception as e:
                app_logger.warning(f"Failed to set instance context for {instance_name}: {e}")
            app_logger.info(f"Processing {app_type} instance: {instance_name}")
            
            # Get instance-specific settings from the instance_details dict
            api_url = instance_details.get("api_url", "")
            api_key = instance_details.get("api_key", "")
            api_timeout = instance_details.get("api_timeout", 120)

            # Get global/shared settings from app_settings loaded at the start of the loop
            # Example: monitored_only = app_settings.get("monitored_only", True)

            # --- Per-Instance State Reset Check --- #
            # Check if THIS INSTANCE's state has expired (not global, per instance!)
            try:
                from src.primary.utils.database import get_database
                db = get_database()
                
                # Get instance-specific state management hours
                instance_hours = instance_details.get("state_management_hours", 72)
                
                # Initialize if not already done (safe, only runs once per instance)
                db.initialize_instance_state_management(app_type, instance_key, instance_hours)
                
                # Check if THIS instance's state has expired
                if db.check_instance_expiration(app_type, instance_key):
                    app_logger.info(f"State management expired for {app_type}/{instance_name}, resetting this instance only...")
                    db.reset_instance_state_management(app_type, instance_key, instance_hours)
            except Exception as e:
                app_logger.warning(f"Error checking state expiration for {instance_name}: {e}")
                # Continue processing even if state check fails

            # --- Connection Check --- #
            if not api_url or not api_key:
                app_logger.warning(f"Missing API URL or Key for instance '{instance_name}'. Skipping.")
                if end_cycle:
                    end_cycle(app_type, next_cycle_naive, instance_name=instance_key, log_name=instance_name)
                if clear_instance_log_context:
                    clear_instance_log_context()
                return (False, instance_name, False, False)
            try:
                # Use instance details for connection check
                app_logger.debug(f"Checking connection to {app_type} instance '{instance_name}' at {api_url} with timeout {api_timeout}s")
                connected = check_connection(api_url, api_key, api_timeout=api_timeout)
                if not connected:
                    app_logger.warning(f"Failed to connect to {app_type} instance '{instance_name}' at {api_url}. Skipping.")
                    if end_cycle:
                        end_cycle(app_type, next_cycle_naive, instance_name=instance_key, log_name=instance_name)
                    if clear_instance_log_context:
                        clear_instance_log_context()
                    return (False, instance_name, False, False)
                app_logger.debug(f"Successfully connected to {app_type} instance: {instance_name}")
            except Exception as e:
                app_logger.error(f"Error connecting to {app_type} instance '{instance_name}': {e}", exc_info=True)
                if end_cycle:
                    end_cycle(app_type, next_cycle_naive, instance_name=instance_key, log_name=instance_name)
                if clear_instance_log_context:
                    clear_instance_log_context()
                return (False, instance_name, False, False) # Skip this instance if connection fails
                
            # --- API Cap Check --- #
            try:
                # Check if this instance's hourly API cap is exceeded (per-instance when multiple instances)
                if check_hourly_cap_exceeded(app_type, instance_name=instance_key):
                    # Get the current cap status for logging
                    from src.primary.stats_manager import get_hourly_cap_status
                    cap_status = get_hourly_cap_status(app_type, instance_name=instance_key)
                    app_logger.info(f"{app_type.upper()} instance '{instance_name}' hourly cap reached {cap_status.get('current_usage', 0)} of {cap_status.get('limit', 0)}. Skipping cycle!")
                    if end_cycle:
                        end_cycle(app_type, next_cycle_naive, instance_name=instance_key, log_name=instance_name)
                    if clear_instance_log_context:
                        clear_instance_log_context()
                    return (False, instance_name, False, False)  # Skip this instance if API cap is exceeded
            except Exception as e:
                app_logger.error(f"Error checking hourly API cap for {app_type}: {e}", exc_info=True)
                # Continue with the cycle even if cap check fails - safer than skipping

            # Capture API usage at start so we can log one summary at end (instead of per-increment spam)
            api_usage_at_start = 0
            try:
                from src.primary.stats_manager import get_hourly_cap_status
                api_usage_at_start = get_hourly_cap_status(app_type, instance_name=instance_key).get("current_usage", 0)
            except Exception:
                pass

            # --- Check if Hunt Modes are Enabled --- #
            # For per-instance settings, get values from instance details
            # For apps without per-instance settings, fall back to global app settings
            if app_type == "sonarr":
                hunt_missing_value = instance_details.get("hunt_missing_items", 1)  # Default to 1
                hunt_upgrade_value = instance_details.get("hunt_upgrade_items", 0)  # Default to 0
            elif app_type == "radarr":
                hunt_missing_value = instance_details.get("hunt_missing_movies", 1)  # Default to 1
                hunt_upgrade_value = instance_details.get("hunt_upgrade_movies", 0)  # Default to 0
            elif app_type == "lidarr":
                hunt_missing_value = instance_details.get("hunt_missing_items", 1)  # Default to 1
                hunt_upgrade_value = instance_details.get("hunt_upgrade_items", 0)  # Default to 0
            elif app_type == "readarr":
                hunt_missing_value = instance_details.get("hunt_missing_books", 1)  # Default to 1
                hunt_upgrade_value = instance_details.get("hunt_upgrade_books", 0)  # Default to 0
            elif app_type == "whisparr":
                hunt_missing_value = instance_details.get("hunt_missing_items", 1)  # Default to 1
                hunt_upgrade_value = instance_details.get("hunt_upgrade_items", 0)  # Default to 0
            elif app_type == "eros":
                hunt_missing_value = instance_details.get("hunt_missing_items", 1)  # Default to 1
                hunt_upgrade_value = instance_details.get("hunt_upgrade_items", 0)  # Default to 0
            else:
                # Fall back to global settings for other apps
                hunt_missing_value = app_settings.get(hunt_missing_setting, 0)
                hunt_upgrade_value = app_settings.get(hunt_upgrade_setting, 0)

            hunt_missing_enabled = hunt_missing_value > 0
            hunt_upgrade_enabled = hunt_upgrade_value > 0
            
            # Debug logging for per-instance hunt values
            app_logger.info(f"Instance '{instance_name}' - Missing: {hunt_missing_value} (enabled: {hunt_missing_enabled}), Upgrade: {hunt_upgrade_value} (enabled: {hunt_upgrade_enabled})")

            # --- Queue Size Check --- # Now using per-instance setting
            # Get max queue size from instance settings, fallback to general settings for backward compatibility
            max_queue_size = instance_details.get("max_download_queue_size", -1)
            if max_queue_size == -1:
                # Fallback to general settings if instance doesn't have it set
                general_settings = settings_manager.load_settings('general')
                max_queue_size = general_settings.get("minimum_download_queue_size", -1)
    
            
            if max_queue_size >= 0:
                try:
                    # Use instance details for queue check
                    # Get api_timeout from instance settings
                    instance_api_timeout = instance_details.get("api_timeout", 120)
                    current_queue_size = get_queue_size(api_url, api_key, instance_api_timeout)
                    if current_queue_size >= max_queue_size:
                        app_logger.info(f"Download queue size ({current_queue_size}) meets or exceeds maximum ({max_queue_size}) for {instance_name}. Skipping cycle for this instance.")
                        if end_cycle:
                            end_cycle(app_type, next_cycle_naive, instance_name=instance_key, log_name=instance_name)
                        if clear_instance_log_context:
                            clear_instance_log_context()
                        return (False, instance_name, False, False) # Skip processing for this instance
                    else:
                        app_logger.info(f"Queue size ({current_queue_size}) is below maximum ({max_queue_size}). Proceeding.")
                except Exception as e:
                    app_logger.warning(f"Could not get download queue size for {instance_name}. Proceeding anyway. Error: {e}", exc_info=False) # Log less verbosely

            # --- Max Seed Queue Check (torrents only) ---
            # When disabled (max_seed_queue_size < 0): no network calls, no imports, no side effects.
            # When enabled: call torrent client for seeding count; skip this instance's hunt if count >= limit.
            try:
                raw = instance_details.get("max_seed_queue_size", -1)
                max_seed_queue_size = int(raw) if raw is not None and str(raw).strip() != "" else -1
            except (TypeError, ValueError):
                max_seed_queue_size = -1
            if max_seed_queue_size >= 0:
                seed_client = instance_details.get("seed_check_torrent_client")
                if seed_client and isinstance(seed_client, dict) and (seed_client.get("host") or "").strip():
                    try:
                        from src.primary.utils.seed_queue_client import get_seeding_count
                        timeout = instance_details.get("api_timeout", 120)
                        if timeout <= 0 or timeout > 300:
                            timeout = 15
                        current_seed_count, err = get_seeding_count(seed_client, timeout=min(timeout, 30))
                        if err:
                            app_logger.warning(f"Could not get torrent seeding count for {instance_name}. Proceeding anyway. Error: {err}")
                        elif current_seed_count >= max_seed_queue_size:
                            app_logger.info(f"Torrent seed queue gating: active seeders ({current_seed_count}) meets or exceeds limit ({max_seed_queue_size}) for {instance_name}. Skipping cycle (torrents only).")
                            if end_cycle:
                                end_cycle(app_type, next_cycle_naive, instance_name=instance_key, log_name=instance_name)
                            if clear_instance_log_context:
                                clear_instance_log_context()
                            return (False, instance_name, False, False)
                        else:
                            app_logger.info(f"Torrent seed count ({current_seed_count}) is below limit ({max_seed_queue_size}). Proceeding.")
                    except Exception as e:
                        app_logger.warning(f"Could not get torrent seeding count for {instance_name}. Proceeding anyway. Error: {e}", exc_info=False)
                else:
                    app_logger.debug(f"Max seed queue size set ({max_seed_queue_size}) but no torrent client configured for {instance_name}; skipping seed check.")
            
            # Prepare args dictionary for processing functions
            # Combine instance details with general app settings for the processing functions
            # Assuming app_settings already contains most general settings, add instance specifics
            combined_settings = app_settings.copy() # Start with general settings
            combined_settings.update(instance_details) # Add/overwrite with instance specifics (name, url, key)
            
            # Use per-instance api_timeout only (no global setting)
            combined_settings["api_timeout"] = instance_details.get("api_timeout", 120)
            combined_settings["command_wait_delay"] = instance_details.get("command_wait_delay", settings_manager.get_advanced_setting("command_wait_delay", 1))
            combined_settings["command_wait_attempts"] = instance_details.get("command_wait_attempts", settings_manager.get_advanced_setting("command_wait_attempts", 600))
            combined_settings["instance_display_name"] = instance_name  # For log_processed_media display in logs

            # Define the stop check function (also abort when user hits Reset for this instance)
            def _stop_check():
                if stop_event.is_set():
                    return True
                if _has_pending_reset(app_type, instance_key):
                    return True
                return False
            stop_check_func = _stop_check

            # --- Process Missing --- #
            if hunt_missing_enabled and process_missing:
                try:
                    if set_cycle_activity:
                        set_cycle_activity(app_type, instance_key, "Processing missing")
                    # Extract settings for direct function calls
                    api_url = combined_settings.get("api_url", "").strip()
                    api_key = combined_settings.get("api_key", "").strip()
                    api_timeout = combined_settings.get("api_timeout", 120)
                    monitored_only = combined_settings.get("monitored_only", True)
                    skip_future_episodes = combined_settings.get("skip_future_episodes", True)
                    hunt_missing_items = hunt_missing_value  # Use per-instance value
                    hunt_missing_mode = instance_details.get("hunt_missing_mode", "seasons_packs")
                    command_wait_delay = combined_settings.get("command_wait_delay", 1)
                    command_wait_attempts = combined_settings.get("command_wait_attempts", 600)
                    
                    if app_type == "sonarr":
                        air_date_delay_days = instance_details.get("air_date_delay_days", 0)
                        tag_processed_items = instance_details.get("tag_processed_items", True)
                        tag_enable_missing = instance_details.get("tag_enable_missing", True)
                        tag_enable_shows_missing = instance_details.get("tag_enable_shows_missing", True)
                        custom_tags = instance_details.get("custom_tags", {
                            "missing": "huntarr-missing",
                            "upgrade": "huntarr-upgrade",
                            "shows_missing": "huntarr-shows-missing"
                        })
                        exempt_tags = instance_details.get("exempt_tags") or []
                        processed_missing = process_missing(
                            api_url=api_url,
                            api_key=api_key,
                            instance_name=instance_key,  # Stable ID for DB/history keying
                            instance_display_name=instance_name,
                            api_timeout=api_timeout,
                            monitored_only=monitored_only,
                            skip_future_episodes=skip_future_episodes,
                            hunt_missing_items=hunt_missing_items,
                            hunt_missing_mode=hunt_missing_mode,
                            air_date_delay_days=air_date_delay_days,
                            command_wait_delay=command_wait_delay,
                            command_wait_attempts=command_wait_attempts,
                            stop_check=stop_check_func,
                            tag_processed_items=tag_processed_items,
                            tag_enable_missing=tag_enable_missing,
                            tag_enable_shows_missing=tag_enable_shows_missing,
                            custom_tags=custom_tags,
                            exempt_tags=exempt_tags
                        )
                    else:
                        # For other apps that still use the old signature
                        processed_missing = process_missing(app_settings=combined_settings, stop_check=stop_check_func)
                        
                    if processed_missing:
                        processed_any_this = True
                except Exception as e:
                    app_logger.error(f"Error during missing processing for {instance_name}: {e}", exc_info=True)
                finally:
                    if clear_cycle_activity:
                        clear_cycle_activity(app_type, instance_key)
                    if _has_pending_reset(app_type, instance_key):
                        app_logger.info(f"Reset requested for {app_type} instance {instance_name}; ending cycle after missing.")
                        if end_cycle:
                            end_cycle(app_type, next_cycle_naive, instance_name=instance_key, log_name=instance_name)
                        if clear_instance_log_context:
                            clear_instance_log_context()
                        return (processed_any_this, instance_name, True, False)

            # --- Process Upgrades --- #
            if hunt_upgrade_enabled and process_upgrades:
                try:
                    if set_cycle_activity:
                        set_cycle_activity(app_type, instance_key, "Processing upgrades")
                    # Extract settings for direct function calls (only for Sonarr)
                    if app_type == "sonarr":
                        api_url = combined_settings.get("api_url", "").strip()
                        api_key = combined_settings.get("api_key", "").strip()
                        api_timeout = combined_settings.get("api_timeout", 120)
                        monitored_only = combined_settings.get("monitored_only", True)
                        hunt_upgrade_items = hunt_upgrade_value  # Use per-instance value
                        upgrade_mode = instance_details.get("upgrade_mode", "seasons_packs")
                        upgrade_selection_method = (instance_details.get("upgrade_selection_method") or "cutoff").strip().lower()
                        if upgrade_selection_method not in ("cutoff", "tags"):
                            upgrade_selection_method = "cutoff"
                        upgrade_tag = (instance_details.get("upgrade_tag") or "").strip()
                        command_wait_delay = combined_settings.get("command_wait_delay", 1)
                        command_wait_attempts = combined_settings.get("command_wait_attempts", 600)
                        tag_processed_items = instance_details.get("tag_processed_items", True)
                        tag_enable_upgrade = instance_details.get("tag_enable_upgrade", True)
                        tag_enable_upgraded = instance_details.get("tag_enable_upgraded", True)
                        custom_tags = instance_details.get("custom_tags", {
                            "missing": "huntarr-missing",
                            "upgrade": "huntarr-upgrade",
                            "shows_missing": "huntarr-shows-missing"
                        })
                        exempt_tags = instance_details.get("exempt_tags") or []
                        processed_upgrades = process_upgrades(
                            api_url=api_url,
                            api_key=api_key,
                            instance_name=instance_key,  # Stable ID for DB/history keying
                            instance_display_name=instance_name,
                            api_timeout=api_timeout,
                            monitored_only=monitored_only,
                            hunt_upgrade_items=hunt_upgrade_items,
                            upgrade_mode=upgrade_mode,
                            command_wait_delay=command_wait_delay,
                            command_wait_attempts=command_wait_attempts,
                            stop_check=stop_check_func,
                            tag_processed_items=tag_processed_items,
                            tag_enable_upgrade=tag_enable_upgrade,
                            tag_enable_upgraded=tag_enable_upgraded,
                            custom_tags=custom_tags,
                            upgrade_selection_method=upgrade_selection_method,
                            upgrade_tag=upgrade_tag,
                            exempt_tags=exempt_tags
                        )
                    else:
                        # For other apps that still use the old signature
                        processed_upgrades = process_upgrades(app_settings=combined_settings, stop_check=stop_check_func)
                        
                    if processed_upgrades:
                        processed_any_this = True
                except Exception as e:
                    app_logger.error(f"Error during upgrade processing for {instance_name}: {e}", exc_info=True)
                finally:
                    if clear_cycle_activity:
                        clear_cycle_activity(app_type, instance_key)
                if _has_pending_reset(app_type, instance_key):
                    app_logger.info(f"Reset requested for {app_type} instance {instance_name}; ending cycle after upgrades.")
                    if end_cycle:
                        end_cycle(app_type, next_cycle_naive, instance_name=instance_key, log_name=instance_name)
                    if clear_instance_log_context:
                        clear_instance_log_context()
                    return (processed_any_this, instance_name, True, False)

            # Per-instance cycle end: set this instance's next_cycle from its sleep_duration
            try:
                if end_cycle:
                    user_tz = _get_user_timezone()
                    now_user_tz = datetime.datetime.now(user_tz).replace(microsecond=0)
                    instance_sleep = instance_details.get("sleep_duration", app_settings.get("sleep_duration", 900))
                    next_cycle_time = now_user_tz + datetime.timedelta(seconds=instance_sleep)
                    next_cycle_naive = next_cycle_time.replace(tzinfo=None) if next_cycle_time.tzinfo else next_cycle_time
                    end_cycle(app_type, next_cycle_naive, instance_name=instance_key, log_name=instance_name)
            except Exception as e:
                app_logger.warning(f"Failed to set cycle end for {instance_name}: {e}")
            # One HOURLY API summary for this instance (replaces per-increment log spam)
            try:
                from src.primary.stats_manager import get_hourly_cap_status
                status = get_hourly_cap_status(app_type, instance_name=instance_key)
                end_usage = status.get("current_usage", 0)
                limit = status.get("limit", 0)
                delta = end_usage - api_usage_at_start
                if delta > 0:
                    app_logger.info(f"*** HOURLY API *** {app_type} instance '{instance_name}' increased by {delta} this cycle → usage: {end_usage}/{limit}")
            except Exception:
                pass
            if clear_instance_log_context:
                clear_instance_log_context()
            return (processed_any_this, instance_name, False, True)

        # Run all instances in parallel (each has its own settings; they do not run in order)
        reset_requested_any = False
        with ThreadPoolExecutor(max_workers=max(len(instances_to_process), 1)) as executor:
            futures = {executor.submit(_process_one_instance, inst): inst for inst in instances_to_process}
            for future in as_completed(futures):
                if stop_event.is_set():
                    break
                try:
                    result = future.result()
                    if result is None:
                        continue
                    processed_any_inst, iname, had_reset, should_append = result
                    if processed_any_inst:
                        processed_any_items = True
                    if had_reset:
                        reset_requested_any = True
                    if should_append:
                        enabled_instances.append(iname)
                except Exception as e:
                    app_logger.error(f"Instance worker failed: {e}", exc_info=True)

        # --- Cycle End & Sleep --- #
        calculate_reset_time(app_type) # Pass app_type here if needed by the function

        # Log cycle completion
        if processed_any_items:
            app_logger.info(f"=== {app_type.upper()} cycle finished. Processed items across instances. ===")
        else:
            app_logger.info(f"=== {app_type.upper()} cycle finished. No items processed in any instance. ===")
            
        # Add state management summary logging for user clarity (only for hunting apps, not Swaparr)
        if app_type != "swaparr":
            try:
                from src.primary.stateful_manager import get_state_management_summary
                
                # Get summary for each enabled instance with per-instance settings
                instance_summaries = []
                total_processed = 0
                has_any_processed = False
                
                for instance_name in enabled_instances:
                    # Get per-instance settings
                    instance_hours = None
                    instance_enabled = True
                    instance_mode = "custom"
                    
                    instance_key = None
                    try:
                        # Look up the instance in all_instances (not instances_to_process, which may be filtered to due-only)
                        for instance_details in all_instances:
                            if instance_details.get("instance_name") == instance_name:
                                instance_key = instance_details.get("instance_id") or instance_details.get("instance_name", "Default")
                                instance_hours = instance_details.get("state_management_hours", 72)
                                instance_mode = instance_details.get("state_management_mode", "custom")
                                instance_enabled = (instance_mode != "disabled")
                                break
                        if instance_key is None:
                            instance_key = instance_name  # Fallback for legacy
                    except Exception as e:
                        from src.primary.utils.log_deduplication import should_log_message, format_suppressed_message
                        
                        error_msg = f"Could not load instance settings for {instance_name}: {e}"
                        should_log, suppressed_count = should_log_message("background", "WARNING", error_msg)
                        if should_log:
                            formatted_msg = format_suppressed_message(error_msg, suppressed_count)
                            app_logger.warning(formatted_msg)
                        
                        instance_hours = 72  # Default fallback
                        instance_key = instance_name
                    
                    # Get summary for this instance (use instance_key for DB lookup)
                    summary = get_state_management_summary(app_type, instance_key, instance_hours)
                    
                    # Store instance-specific information
                    instance_summaries.append({
                        "name": instance_name,
                        "enabled": instance_enabled,
                        "mode": instance_mode,
                        "hours": instance_hours,
                        "processed_count": summary["processed_count"],
                        "next_reset_time": summary["next_reset_time"],
                        "has_processed_items": summary["has_processed_items"]
                    })
                    
                    # Only count if state management is enabled for this instance
                    if instance_enabled and summary["has_processed_items"]:
                        total_processed += summary["processed_count"]
                        has_any_processed = True
                
                # Log per-instance state management info
                if instance_summaries:
                    app_logger.info(f"=== STATE MANAGEMENT SUMMARY FOR {app_type.upper()} ===")
                    
                    for inst in instance_summaries:
                        if inst["enabled"]:
                            if inst["processed_count"] > 0:
                                app_logger.info(f"  {inst['name']}: {inst['processed_count']} items tracked, next reset: {inst['next_reset_time']} ({inst['hours']}h interval)")
                            else:
                                app_logger.info(f"  {inst['name']}: No items tracked yet, next reset: {inst['next_reset_time']} ({inst['hours']}h interval)")
                        else:
                            app_logger.info(f"  {inst['name']}: State management disabled")
                    
                    # Overall summary
                    if not processed_any_items and has_any_processed:
                        # Items were skipped due to state management
                        app_logger.info(f"RESULT: {total_processed} items skipped due to state management (already processed)")
                    elif processed_any_items:
                        # Items were processed, show summary
                        app_logger.info(f"RESULT: Items processed successfully. Total tracked across instances: {total_processed}")
                    else:
                        # No items processed and no state management blocking
                        if total_processed > 0:
                            app_logger.info(f"RESULT: No new items found. Total tracked across instances: {total_processed}")
                        else:
                            app_logger.info(f"RESULT: No items to process and no items tracked yet")
                    
            except Exception as e:
                app_logger.warning(f"Could not generate state management summary: {e}")
        else:
            # Swaparr uses its own state management for strikes and removed downloads
            app_logger.debug(f"Swaparr uses its own strike/removal tracking, not the hunting state manager")
            
        # Sleep: until soonest next cycle (per-instance scheduling) or min sleep_duration (legacy)
        if app_type in PER_INSTANCE_SCHEDULING_APP_TYPES:
            sleep_seconds = _get_sleep_seconds_until_next_cycle(app_type, all_instances, app_settings)
        else:
            sleep_seconds = min(
                (d.get("sleep_duration", app_settings.get("sleep_duration", 900)) for d in instances_to_process),
                default=app_settings.get("sleep_duration", 900)
            )
        user_tz = _get_user_timezone()
        now_user_tz = datetime.datetime.now(user_tz).replace(microsecond=0)
        app_logger.debug(f"Current time ({user_tz}): {now_user_tz.strftime('%Y-%m-%d %H:%M:%S')}")
        app_logger.info(f"Sleep duration: {sleep_seconds:.0f} seconds before next cycle")
        app_logger.debug(f"Sleeping for {sleep_seconds:.0f} seconds before next cycle...")
        # Responsive wait: wake every second to check stop_event and per-instance reset requests
        _responsive_sleep(app_type, sleep_seconds, app_logger, all_instances, wait_interval=1)
                
    app_logger.info(f"=== [{app_type.upper()}] Thread stopped ====")

def reset_app_cycle(app_type: str) -> bool:
    """
    Trigger a manual reset of an app's cycle.
    
    Args:
        app_type: The type of Arr application (sonarr, radarr, lidarr, readarr, etc.)
        
    Returns:
        bool: True if the reset was triggered, False if the app is not running
    """
    logger.info(f"Manual cycle reset requested for {app_type} - Creating reset request")
    
    # Create a reset request in the database
    try:
        from src.primary.utils.database import get_database
        db = get_database()
        success = db.create_reset_request(app_type)
        if success:
            logger.info(f"Reset request created for {app_type}. Cycle will reset on next check.")
        return success
    except Exception as e:
        logger.error(f"Error creating reset request for {app_type}: {e}", exc_info=True)
        return False

def start_app_threads():
    """Start threads for all configured and enabled apps."""
    configured_apps_list = settings_manager.get_configured_apps() # Corrected function name
    configured_apps = {app: True for app in configured_apps_list} # Convert list to dict format expected below

    for app_type, is_configured in configured_apps.items():
        if is_configured:
            # Skip non-cyclical apps (e.g., prowlarr handled via routes, swaparr has its own thread)
            if app_type not in CYCLICAL_APP_TYPES:
                logger.debug(f"Configured non-cyclical app detected; not starting background thread: {app_type}")
                continue

            # Optional: Add an explicit 'enabled' setting check if desired
            # enabled = settings_manager.get_setting(app_type, "enabled", True)
            # if not enabled:
            #     logger.info(f"Skipping {app_type} thread as it is disabled in settings.")
            #     continue

            if app_type not in app_threads or not app_threads[app_type].is_alive():
                if app_type in app_threads: # If it existed but died
                    logger.warning(f"{app_type} thread died, restarting...")
                    del app_threads[app_type]
                else: # Starting for the first time
                    logger.info(f"Starting thread for {app_type}...")

                thread = threading.Thread(target=app_specific_loop, args=(app_type,), name=f"{app_type}-Loop", daemon=True)
                app_threads[app_type] = thread
                thread.start()
        elif app_type in app_threads and app_threads[app_type].is_alive():
             # If app becomes un-configured, stop its thread? Or let it fail connection check?
             # For now, let it run and fail connection check.
             logger.warning(f"{app_type} is no longer configured. Thread will likely stop after failing connection checks.")
        # else: # App not configured and no thread running - do nothing
            # logger.debug(f"{app_type} is not configured. No thread started.")
        pass # Corrected indentation

def check_and_restart_threads():
    """Check if any threads have died and restart them if the app is still configured."""
    configured_apps_list = settings_manager.get_configured_apps() # Corrected function name
    configured_apps = {app: True for app in configured_apps_list} # Convert list to dict format expected below

    for app_type, thread in list(app_threads.items()):
        # Only monitor cyclical apps for restarts
        if app_type not in CYCLICAL_APP_TYPES:
            continue
        if not thread.is_alive():
            logger.warning(f"{app_type} thread died unexpectedly.")
            del app_threads[app_type] # Remove dead thread
            # Only restart if it's still configured
            if configured_apps.get(app_type, False):
                logger.info(f"Restarting thread for {app_type}...")
                new_thread = threading.Thread(target=app_specific_loop, args=(app_type,), name=f"{app_type}-Loop", daemon=True)
                app_threads[app_type] = new_thread
                new_thread.start()
            else:
                logger.info(f"Not restarting {app_type} thread as it is no longer configured.")

def shutdown_handler(signum, frame):
    """Handle termination signals (SIGINT, SIGTERM)."""
    signal_name = "SIGINT" if signum == signal.SIGINT else "SIGTERM" if signum == signal.SIGTERM else f"Signal {signum}"
    logger.info(f"Received {signal_name}. Initiating background tasks shutdown...")
    stop_event.set() # Signal all threads to stop
    
    # Log shutdown progress for Docker diagnostics
    logger.info("Background shutdown initiated - threads will stop gracefully")

def shutdown_threads():
    """Wait for all threads to finish."""
    import time
    shutdown_start = time.time()
    logger.info("Waiting for all app threads to stop...")
    
    # Stop the hourly API cap scheduler
    global hourly_cap_scheduler_thread
    if hourly_cap_scheduler_thread and hourly_cap_scheduler_thread.is_alive():
        # The thread should exit naturally due to the stop_event being set
        logger.info("Waiting for hourly API cap scheduler to stop...")
        hourly_cap_scheduler_thread.join(timeout=5.0)
        if hourly_cap_scheduler_thread.is_alive():
            logger.warning("Hourly API cap scheduler did not stop gracefully")
        else:
            logger.info("Hourly API cap scheduler stopped")
    
    # Stop the Prowlarr stats refresher
    global prowlarr_stats_thread
    if prowlarr_stats_thread and prowlarr_stats_thread.is_alive():
        logger.info("Waiting for Prowlarr stats refresher to stop...")
        prowlarr_stats_thread.join(timeout=5.0)
        if prowlarr_stats_thread.is_alive():
            logger.warning("Prowlarr stats refresher did not stop gracefully")
        else:
            logger.info("Prowlarr stats refresher stopped")

    # Stop the Swaparr processing thread
    global swaparr_thread
    if swaparr_thread and swaparr_thread.is_alive():
        # The thread should exit naturally due to the stop_event being set
        logger.info("Waiting for Swaparr thread to stop...")
        swaparr_thread.join(timeout=5.0)
        if swaparr_thread.is_alive():
            logger.warning("Swaparr thread did not stop gracefully")
        else:
            logger.info("Swaparr thread stopped")
    
    # Stop the scheduler engine
    try:
        logger.info("Stopping schedule action engine...")
        stop_scheduler()
        logger.info("Schedule action engine stopped successfully")
    except Exception as e:
        logger.error(f"Error stopping schedule action engine: {e}")
    
    # Wait for all app threads to terminate
    active_threads = [name for name, thread in app_threads.items() if thread.is_alive()]
    if active_threads:
        logger.info(f"Waiting for {len(active_threads)} app threads to stop: {', '.join(active_threads)}")
        
        for name, thread in app_threads.items():
            if thread.is_alive():
                logger.debug(f"Waiting for {name} thread to stop...")
                thread.join(timeout=10.0)
                if thread.is_alive():
                    logger.warning(f"{name} thread did not stop gracefully within 10 seconds")
                else:
                    logger.debug(f"{name} thread stopped successfully")
    
    shutdown_duration = time.time() - shutdown_start
    logger.info(f"All app threads stopped. Shutdown completed in {shutdown_duration:.2f} seconds")

def hourly_cap_scheduler_loop():
    """Main loop for the hourly API cap scheduler thread
    Checks time every 30 seconds and resets caps if needed at the top of the hour
    """
    logger.info("Starting hourly API cap scheduler loop")
    
    try:
        from src.primary.stats_manager import reset_hourly_caps
        
        # Initial check in case we're starting right at the top of an hour
        current_time = datetime.datetime.now()
        if current_time.minute == 0:
            logger.debug(f"Initial hourly reset triggered at {current_time.hour}:00")
            reset_hourly_caps()
        
        # Main monitoring loop
        while not stop_event.is_set():
            try:
                # Sleep for 30 seconds between checks
                # This ensures we won't miss the top of the hour
                stop_event.wait(30)
                
                if stop_event.is_set():
                    break
                    
                # Check if it's the top of the hour (00 minute mark)
                current_time = datetime.datetime.now()
                if current_time.minute == 0:
                    logger.debug(f"Hourly reset triggered at {current_time.hour}:00")
                    success = reset_hourly_caps()
                    if success:
                        logger.debug(f"Successfully reset hourly API caps at {current_time.hour}:00")
                    else:
                        logger.error(f"Failed to reset hourly API caps at {current_time.hour}:00")
                
            except Exception as e:
                logger.error(f"Error in hourly cap scheduler: {e}")
                logger.error(traceback.format_exc())
                # Sleep briefly to avoid spinning in case of repeated errors
                time.sleep(5)
                
    except Exception as e:
        logger.error(f"Fatal error in hourly cap scheduler: {e}")
        logger.error(traceback.format_exc())
    
    logger.info("Hourly API cap scheduler stopped")

def prowlarr_stats_loop():
    """Background loop to refresh Prowlarr statistics cache every 5 minutes.
    Runs independently of the frontend and does nothing if Prowlarr is not configured or disabled.
    """
    refresher_logger = get_logger("prowlarr")
    refresher_logger.info("Prowlarr stats refresher thread started")
    try:
        from src.primary.settings_manager import load_settings
        # Import inside loop target to avoid circular issues at module import time
        from src.primary.apps import prowlarr_routes as prow

        refresh_interval_seconds = 300  # 5 minutes

        # Do an immediate pass on start
        while not stop_event.is_set():
            try:
                settings = load_settings("prowlarr")
                api_url = (settings.get("api_url", "") or "").strip()
                api_key = (settings.get("api_key", "") or "").strip()
                enabled = settings.get("enabled", True)

                if not api_url or not api_key or not enabled:
                    # Not configured or disabled; sleep a bit and check again
                    if stop_event.wait(60):
                        break
                    continue

                # Trigger cache update (safe even if cache is warm)
                try:
                    prow._update_stats_cache()
                except Exception as e:
                    refresher_logger.error(f"Prowlarr stats refresh error: {e}", exc_info=True)

                # Sleep until next refresh or until stop requested
                if stop_event.wait(refresh_interval_seconds):
                    break

            except Exception as loop_error:
                refresher_logger.error(f"Unexpected error in Prowlarr stats refresher: {loop_error}", exc_info=True)
                # Back off briefly to avoid tight error loops
                if stop_event.wait(60):
                    break
    finally:
        refresher_logger.info("Prowlarr stats refresher thread stopped")


def swaparr_app_loop():
    """Dedicated Swaparr processing loop that follows same patterns as other apps"""
    swaparr_logger = get_logger("swaparr")
    swaparr_logger.debug("Swaparr thread started")
    
    try:
        from src.primary.apps.swaparr.handler import run_swaparr
        from src.primary.settings_manager import load_settings
        from src.primary.cycle_tracker import start_cycle, end_cycle, update_next_cycle
        
        while not stop_event.is_set():
            try:
                # Load Swaparr settings
                swaparr_settings = load_settings("swaparr")
                
                if not swaparr_settings or not swaparr_settings.get("enabled", False):
                    # Swaparr is disabled - no need to log this repeatedly
                    # Sleep for 30 seconds when disabled, then check again
                    if stop_event.wait(30):
                        break
                    continue
                
                # Get sleep duration from settings
                sleep_duration = swaparr_settings.get("sleep_duration", 900)
                
                # Get user's timezone
                user_tz = _get_user_timezone()
                
                # Calculate next cycle time in user's timezone
                now_user_tz = datetime.datetime.now(user_tz).replace(microsecond=0)
                next_cycle_time = now_user_tz + datetime.timedelta(seconds=sleep_duration)
                
                # Start cycle tracking
                start_cycle("swaparr")
                
                # Start cycle
                # swaparr_logger.info("=== SWAPARR cycle started. Processing stalled downloads across all instances. ===")
                
                try:
                    # Run Swaparr processing
                    run_swaparr()
                    # swaparr_logger.info("=== SWAPARR cycle finished. Processed stalled downloads across instances. ===")
                except Exception as e:
                    swaparr_logger.error(f"Error during Swaparr processing: {e}", exc_info=True)
                    # swaparr_logger.info("=== SWAPARR cycle finished with errors. ===")
                
                # End cycle tracking
                next_cycle_naive = next_cycle_time.replace(tzinfo=None) if next_cycle_time.tzinfo else next_cycle_time
                end_cycle("swaparr", next_cycle_naive)
                update_next_cycle("swaparr", next_cycle_naive)
                
                # Sleep duration and next cycle info (like other apps)
                # swaparr_logger.debug(f"Current time ({user_tz}): {now_user_tz.strftime('%Y-%m-%d %H:%M:%S')}")
                # swaparr_logger.debug(f"Next cycle will begin at {next_cycle_time.strftime('%Y-%m-%d %H:%M:%S')} ({user_tz})")
                # swaparr_logger.debug(f"Sleep duration: {sleep_duration} seconds")
                
                # Sleep with responsiveness to stop events and reset requests (like other apps)
                elapsed = 0
                wait_interval = 60  # Check every 60 seconds for responsiveness (reduced from 5s to reduce log spam)
                while elapsed < sleep_duration and not stop_event.is_set():
                    # Check for database reset request (same logic as other apps)
                    try:
                        from src.primary.utils.database import get_database
                        db = get_database()
                        reset_timestamp = db.get_pending_reset_request("swaparr")
                        if reset_timestamp:
                            swaparr_logger.info(f"!!! RESET REQUEST DETECTED !!! Manual cycle reset triggered for swaparr (timestamp: {reset_timestamp}). Starting new cycle immediately.")
                            
                            # Mark the reset request as processed
                            db.mark_reset_request_processed("swaparr")
                            swaparr_logger.info(f"Reset request processed for swaparr. Starting new cycle now.")
                            break
                    except Exception as e:
                        swaparr_logger.error(f"Error checking reset request for swaparr: {e}", exc_info=True)
                    
                    # Check for stop event
                    if stop_event.is_set():
                        swaparr_logger.info("Stop event detected during sleep. Breaking out of sleep cycle.")
                        break
                    
                    # Sleep for a short interval
                    stop_event.wait(wait_interval)
                    elapsed += wait_interval
                    
                    # Log progress every 30 seconds (like other apps)
                    # if elapsed > 0 and elapsed % 30 == 0:
                    #     swaparr_logger.debug(f"Still sleeping, {sleep_duration - elapsed} seconds remaining before next cycle...")
                
            except Exception as e:
                swaparr_logger.error(f"Unexpected error in Swaparr loop: {e}", exc_info=True)
                # Sleep briefly to avoid spinning in case of repeated errors
                time.sleep(60)
                
    except Exception as e:
        swaparr_logger.error(f"Fatal error in Swaparr thread: {e}", exc_info=True)
    
    swaparr_logger.info("Swaparr thread stopped")

def start_hourly_cap_scheduler():
    """Start the hourly API cap scheduler thread"""
    global hourly_cap_scheduler_thread
    
    if hourly_cap_scheduler_thread and hourly_cap_scheduler_thread.is_alive():
        logger.info("Hourly API cap scheduler already running")
        return
    
    # Create and start the scheduler thread
    hourly_cap_scheduler_thread = threading.Thread(
        target=hourly_cap_scheduler_loop, 
        name="HourlyCapScheduler", 
        daemon=True
    )
    hourly_cap_scheduler_thread.start()
    
    logger.info(f"Hourly API cap scheduler started. Thread is alive: {hourly_cap_scheduler_thread.is_alive()}")

def start_prowlarr_stats_thread():
    """Start the Prowlarr statistics refresher thread (5-minute cadence)."""
    global prowlarr_stats_thread
    if prowlarr_stats_thread and prowlarr_stats_thread.is_alive():
        logger.info("Prowlarr stats refresher already running")
        return
    prowlarr_stats_thread = threading.Thread(
        target=prowlarr_stats_loop,
        name="ProwlarrStatsRefresher",
        daemon=True,
    )
    prowlarr_stats_thread.start()
    logger.info(f"Prowlarr stats refresher started. Thread is alive: {prowlarr_stats_thread.is_alive()}")

def start_swaparr_thread():
    """Start the dedicated Swaparr processing thread"""
    global swaparr_thread
    
    if swaparr_thread and swaparr_thread.is_alive():
        logger.info("Swaparr thread already running")
        return
    
    # Create and start the Swaparr thread
    swaparr_thread = threading.Thread(
        target=swaparr_app_loop, 
        name="SwaparrApp", 
        daemon=True
    )
    swaparr_thread.start()
    
    logger.info(f"Swaparr thread started. Thread is alive: {swaparr_thread.is_alive()}")

def start_huntarr():
    """Main entry point for Huntarr background tasks."""
    logger.info(f"--- Starting Huntarr Background Tasks v{__version__} --- ")
    

    # Migration environment variable no longer used
        
    # Start the hourly API cap scheduler
    try:
        start_hourly_cap_scheduler()
        logger.info("Hourly API cap scheduler started successfully")
    except Exception as e:
        logger.error(f"Failed to start hourly API cap scheduler: {e}")
        
    # Start the Swaparr processing thread
    try:
        start_swaparr_thread()
        logger.info("Swaparr thread started successfully")
    except Exception as e:
        logger.error(f"Failed to start Swaparr thread: {e}")
    
    # Start the Prowlarr stats refresher
    try:
        start_prowlarr_stats_thread()
        logger.info("Prowlarr stats refresher started successfully")
    except Exception as e:
        logger.error(f"Failed to start Prowlarr stats refresher: {e}")
         
    # Start the scheduler engine
    try:
        start_scheduler()
        logger.info("Schedule action engine started successfully")
    except Exception as e:
        logger.error(f"Failed to start schedule action engine: {e}")
        
    # Configuration logging has been disabled to reduce log spam
    # Settings are loaded and used internally without verbose logging

    try:
        # Main loop: Start and monitor app threads
        while not stop_event.is_set():
            start_app_threads() # Start/Restart threads for configured apps
            # check_and_restart_threads() # This is implicitly handled by start_app_threads checking is_alive
            stop_event.wait(15) # Check for stop signal every 15 seconds

    except Exception as e:
        logger.exception(f"Unexpected error in main monitoring loop: {e}")
    finally:
        logger.info("Background task main loop exited. Shutting down threads...")
        if not stop_event.is_set():
             stop_event.set() # Ensure stop is signaled if loop exited unexpectedly
        shutdown_threads()
        logger.info("--- Huntarr Background Tasks stopped --- ")