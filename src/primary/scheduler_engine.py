#!/usr/bin/env python3
"""
Scheduler Engine for Huntarr
Handles execution of scheduled actions from database.

Instance identification uses stable `instance_id` fields (not array indices).
Schedule entries use `app_instance` in the format:
  - "global"          → all apps, all instances
  - "sonarr::all"     → all sonarr instances
  - "sonarr::<id>"    → specific sonarr instance by instance_id
  Legacy formats like "sonarr-0" are handled for backward compatibility.
"""

import json
import threading
import datetime
import time
import traceback
from typing import Dict, List, Any, Optional, Tuple
import collections

from src.primary.settings_manager import clear_cache, load_settings, save_settings
from src.primary.utils.logger import get_logger
from src.primary.stateful_manager import check_expiration as check_stateful_expiration
from src.primary.utils.database import get_database

scheduler_logger = get_logger("scheduler")

# Constants
SCHEDULE_CHECK_INTERVAL = 60  # seconds between checks
EXECUTION_WINDOW_MINUTES = 2  # minutes after scheduled time to still execute
COOLDOWN_MINUTES = 5          # minutes before same schedule can re-execute

# Supported app types
SUPPORTED_APPS = ['sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros', 'movie_hunt', 'tv_hunt']

# Track last executed actions to prevent duplicates
last_executed_actions = {}

# Execution history ring buffer
max_history_entries = 50
execution_history = collections.deque(maxlen=max_history_entries)

stop_event = threading.Event()
scheduler_thread = None


def _get_user_timezone():
    """Get the user's selected timezone from general settings"""
    try:
        from src.primary.utils.timezone_utils import get_user_timezone
        return get_user_timezone()
    except Exception:
        import pytz
        return pytz.UTC


def _add_history(entry, status, message):
    """Add an action execution to the history log"""
    user_tz = _get_user_timezone()
    now = datetime.datetime.now(user_tz)
    tz_name = str(user_tz)

    execution_history.appendleft({
        "timestamp": now.strftime("%Y-%m-%d %H:%M:%S"),
        "timestamp_tz": f"{now.strftime('%Y-%m-%d %H:%M:%S')} {tz_name}",
        "id": entry.get("id", "unknown"),
        "action": entry.get("action", "unknown"),
        "app": entry.get("app", "unknown"),
        "status": status,
        "message": message
    })
    scheduler_logger.debug(f"History: {entry.get('action')} for {entry.get('app')} - {status} - {message}")


# ---------------------------------------------------------------------------
# Instance resolution
# ---------------------------------------------------------------------------

def _parse_app_instance(app_instance: str) -> Tuple[str, Optional[str]]:
    """Parse app_instance into (base_app, instance_id_or_none).

    Formats:
      "global"            → ("global", None)
      "sonarr::all"       → ("sonarr", None)     – all instances of sonarr
      "sonarr::<id>"      → ("sonarr", "<id>")    – specific instance
      "sonarr-all"        → ("sonarr", None)       – legacy format
      "sonarr-0"          → ("sonarr", "0")        – legacy numeric index
    """
    if not app_instance or app_instance == "global":
        return "global", None

    # New format: app::instance_id
    if "::" in app_instance:
        parts = app_instance.split("::", 1)
        base = parts[0].lower()
        inst = parts[1] if len(parts) > 1 else None
        if inst == "all":
            return base, None
        return base, inst

    # Legacy format: app-index or app-all
    if "-" in app_instance:
        parts = app_instance.split("-", 1)
        base = parts[0].lower()
        suffix = parts[1] if len(parts) > 1 else None

        if base not in SUPPORTED_APPS:
            return app_instance, None

        if suffix is None or suffix == "all" or suffix in ("v2", "v3"):
            return base, None

        # Legacy numeric index — try to resolve to instance_id
        try:
            idx = int(suffix)
            config = load_settings(base)
            if config and "instances" in config:
                instances = config["instances"]
                if 0 <= idx < len(instances) and isinstance(instances[idx], dict):
                    resolved_id = instances[idx].get("instance_id")
                    if resolved_id:
                        scheduler_logger.info(f"Legacy index {base}-{idx} resolved to instance_id {resolved_id}")
                        return base, resolved_id
            # Could not resolve — return the raw numeric string
            return base, suffix
        except (ValueError, TypeError):
            pass

        return base, suffix

    return app_instance, None


def _find_instance_by_id(instances: list, instance_id: str) -> Optional[dict]:
    """Find an instance in the instances list by instance_id."""
    for inst in instances:
        if isinstance(inst, dict) and inst.get("instance_id") == instance_id:
            return inst
    return None


def _find_instance_index_by_id(instances: list, instance_id: str) -> int:
    """Find index of an instance in the list by instance_id. Returns -1 if not found."""
    for idx, inst in enumerate(instances):
        if isinstance(inst, dict) and inst.get("instance_id") == instance_id:
            return idx
    return -1


# ---------------------------------------------------------------------------
# Action execution
# ---------------------------------------------------------------------------

def _apply_to_all_apps(action_fn, action_label: str) -> Tuple[bool, str]:
    """Apply an action function to all supported apps. Returns (success, message)."""
    errors = []
    for app in SUPPORTED_APPS:
        try:
            if app == 'movie_hunt':
                _apply_to_movie_hunt(None, action_fn, action_label)
            elif app == 'tv_hunt':
                _apply_to_tv_hunt(None, action_fn, action_label)
            else:
                config = load_settings(app)
                if config:
                    action_fn(config, app, None)
                    save_settings(app, config)
                    clear_cache(app)
        except Exception as e:
            errors.append(f"{app}: {e}")

    if errors:
        return False, f"Errors during {action_label}: {'; '.join(errors)}"
    return True, f"{action_label} completed for all apps"


def _apply_to_app(base_app: str, instance_id: Optional[str], action_fn, action_label: str) -> Tuple[bool, str]:
    """Apply an action to a specific app/instance. Returns (success, message)."""
    if base_app == 'movie_hunt':
        return _apply_to_movie_hunt(instance_id, action_fn, action_label)
    if base_app == 'tv_hunt':
        return _apply_to_tv_hunt(instance_id, action_fn, action_label)

    config = load_settings(base_app)
    if not config:
        return False, f"Settings not found for {base_app}"

    try:
        action_fn(config, base_app, instance_id)
        save_settings(base_app, config)
        clear_cache(base_app)

        target = f"{base_app}::{instance_id}" if instance_id else f"all {base_app} instances"
        return True, f"{action_label} for {target}"
    except Exception as e:
        return False, f"Error in {action_label} for {base_app}: {e}"


def _apply_to_movie_hunt(instance_id: Optional[str], action_fn, action_label: str) -> Tuple[bool, str]:
    """Apply an action to Movie Hunt instances.
    
    Movie Hunt uses a different config model: instances are in a DB table
    and per-instance settings are stored via save_app_config_for_instance().
    """
    try:
        db = get_database()
        from src.primary.routes.movie_hunt.instances import _get_movie_hunt_instance_settings
        SETTINGS_KEY = "movie_hunt_hunt_settings"

        all_instances = db.get_movie_hunt_instances()

        if instance_id:
            # Target a specific instance by its numeric ID
            int_id = int(instance_id)
            target = next((i for i in all_instances if i['id'] == int_id), None)
            if not target:
                return False, f"Movie Hunt instance {instance_id} not found"
            
            settings = _get_movie_hunt_instance_settings(int_id)
            # Use a wrapper config so the action_fn can modify it
            wrapper = {"enabled": settings.get("enabled", True), "hourly_cap": settings.get("hourly_cap", 20)}
            action_fn(wrapper, 'movie_hunt', None)  # None instance_id since we're already targeting
            settings["enabled"] = wrapper.get("enabled", settings.get("enabled"))
            settings["hourly_cap"] = wrapper.get("hourly_cap", settings.get("hourly_cap"))
            db.save_app_config_for_instance(SETTINGS_KEY, int_id, settings)
            return True, f"{action_label} for Movie Hunt instance {target.get('name', int_id)}"
        else:
            # Target all Movie Hunt instances
            for inst in all_instances:
                int_id = inst['id']
                settings = _get_movie_hunt_instance_settings(int_id)
                wrapper = {"enabled": settings.get("enabled", True), "hourly_cap": settings.get("hourly_cap", 20)}
                action_fn(wrapper, 'movie_hunt', None)
                settings["enabled"] = wrapper.get("enabled", settings.get("enabled"))
                settings["hourly_cap"] = wrapper.get("hourly_cap", settings.get("hourly_cap"))
                db.save_app_config_for_instance(SETTINGS_KEY, int_id, settings)
            return True, f"{action_label} for all Movie Hunt instances"

    except Exception as e:
        return False, f"Error in {action_label} for movie_hunt: {e}"


def _apply_to_tv_hunt(instance_id: Optional[str], action_fn, action_label: str) -> Tuple[bool, str]:
    """Apply an action to TV Hunt instances.

    TV Hunt uses a different config model: instances are in a DB table
    and per-instance settings are stored via save_app_config_for_instance().
    """
    try:
        db = get_database()
        from src.primary.routes.tv_hunt.instances import _get_tv_hunt_instance_settings
        SETTINGS_KEY = "tv_hunt_hunt_settings"

        all_instances = db.get_tv_hunt_instances()

        if instance_id:
            # Target a specific instance by its numeric ID
            int_id = int(instance_id)
            target = next((i for i in all_instances if i['id'] == int_id), None)
            if not target:
                return False, f"TV Hunt instance {instance_id} not found"

            settings = _get_tv_hunt_instance_settings(int_id)
            # Use a wrapper config so the action_fn can modify it
            wrapper = {"enabled": settings.get("enabled", True), "hourly_cap": settings.get("hourly_cap", 20)}
            action_fn(wrapper, 'tv_hunt', None)  # None instance_id since we're already targeting
            settings["enabled"] = wrapper.get("enabled", settings.get("enabled"))
            settings["hourly_cap"] = wrapper.get("hourly_cap", settings.get("hourly_cap"))
            db.save_app_config_for_instance(SETTINGS_KEY, int_id, settings)
            return True, f"{action_label} for TV Hunt instance {target.get('name', int_id)}"
        else:
            # Target all TV Hunt instances
            for inst in all_instances:
                int_id = inst['id']
                settings = _get_tv_hunt_instance_settings(int_id)
                wrapper = {"enabled": settings.get("enabled", True), "hourly_cap": settings.get("hourly_cap", 20)}
                action_fn(wrapper, 'tv_hunt', None)
                settings["enabled"] = wrapper.get("enabled", settings.get("enabled"))
                settings["hourly_cap"] = wrapper.get("hourly_cap", settings.get("hourly_cap"))
                db.save_app_config_for_instance(SETTINGS_KEY, int_id, settings)
            return True, f"{action_label} for all TV Hunt instances"

    except Exception as e:
        return False, f"Error in {action_label} for tv_hunt: {e}"


def _set_enabled(config, app_name, instance_id, enabled_value):
    """Set enabled state on config. If instance_id is None, affects all instances."""
    instances = config.get("instances", [])

    if instance_id:
        inst = _find_instance_by_id(instances, instance_id)
        if inst:
            inst["enabled"] = enabled_value
        else:
            raise ValueError(f"Instance {instance_id} not found in {app_name}")
    else:
        config["enabled"] = enabled_value
        for inst in instances:
            if isinstance(inst, dict):
                inst["enabled"] = enabled_value


def _set_api_cap(config, app_name, instance_id, api_limit):
    """Set hourly_cap on config. If instance_id is None, affects all instances."""
    instances = config.get("instances", [])

    if instance_id:
        inst = _find_instance_by_id(instances, instance_id)
        if inst:
            inst["hourly_cap"] = api_limit
        else:
            raise ValueError(f"Instance {instance_id} not found in {app_name}")
    else:
        config["hourly_cap"] = api_limit
        for inst in instances:
            if isinstance(inst, dict):
                inst["hourly_cap"] = api_limit


def execute_action(action_entry):
    """Execute a scheduled action."""
    action_type = action_entry.get("action", "")
    app_instance = action_entry.get("app", "global")
    schedule_id = action_entry.get("id", "unknown")

    user_tz = _get_user_timezone()
    today_str = datetime.datetime.now(user_tz).strftime("%Y-%m-%d")
    exec_key = f"{schedule_id}_{today_str}"

    # Check daily execution guard
    if exec_key in last_executed_actions:
        _add_history(action_entry, "skipped", f"Already executed today")
        return False

    base_app, instance_id = _parse_app_instance(app_instance)

    try:
        # ---- Enable / Disable ----
        if action_type in ("pause", "disable"):
            fn = lambda cfg, app, iid: _set_enabled(cfg, app, iid, False)
            label = "Disable"
        elif action_type in ("resume", "enable"):
            fn = lambda cfg, app, iid: _set_enabled(cfg, app, iid, True)
            label = "Enable"

        # ---- API Limits ----
        elif action_type.startswith("api-") or action_type.startswith("API Limits "):
            try:
                if action_type.startswith("api-"):
                    api_limit = int(action_type.replace("api-", ""))
                else:
                    api_limit = int(action_type.replace("API Limits ", ""))
            except ValueError:
                _add_history(action_entry, "error", f"Invalid API limit format: {action_type}")
                return False

            fn = lambda cfg, app, iid, lim=api_limit: _set_api_cap(cfg, app, iid, lim)
            label = f"Set API cap to {api_limit}"

        else:
            _add_history(action_entry, "error", f"Unknown action type: {action_type}")
            return False

        # Execute
        if base_app == "global":
            success, message = _apply_to_all_apps(fn, label)
        else:
            success, message = _apply_to_app(base_app, instance_id, fn, label)

        status = "success" if success else "error"
        _add_history(action_entry, status, message)

        if success:
            last_executed_actions[exec_key] = datetime.datetime.now(user_tz)
            scheduler_logger.info(message)
        else:
            scheduler_logger.error(message)

        return success

    except Exception as e:
        msg = f"Error executing {action_type} for {app_instance}: {e}"
        scheduler_logger.error(msg)
        scheduler_logger.error(traceback.format_exc())
        _add_history(action_entry, "error", msg)
        return False


# ---------------------------------------------------------------------------
# Schedule matching
# ---------------------------------------------------------------------------

def should_execute_schedule(schedule_entry):
    """Check if a schedule entry should be executed now."""
    schedule_id = schedule_entry.get("id", "unknown")

    if not schedule_entry.get("enabled", True):
        return False

    user_tz = _get_user_timezone()
    now = datetime.datetime.now(user_tz)

    # ---- Day check ----
    days = schedule_entry.get("days", [])
    if days:
        current_day = now.strftime("%A").lower()
        lowercase_days = [str(d).lower() for d in days]
        if current_day not in lowercase_days:
            return False

    # ---- Time extraction ----
    try:
        schedule_hour = schedule_entry.get("hour")
        schedule_minute = schedule_entry.get("minute")

        if schedule_hour is None or schedule_minute is None:
            time_value = schedule_entry.get("time")
            if isinstance(time_value, dict):
                schedule_hour = time_value.get("hour")
                schedule_minute = time_value.get("minute")
            elif isinstance(time_value, str):
                parts = time_value.split(":")
                schedule_hour = int(parts[0])
                schedule_minute = int(parts[1]) if len(parts) > 1 else 0

        schedule_hour = int(schedule_hour)
        schedule_minute = int(schedule_minute)
    except (TypeError, ValueError, IndexError):
        scheduler_logger.warning(f"Invalid time format for schedule {schedule_id}: {schedule_entry}")
        return False

    # ---- Time window check ----
    # Calculate minutes since midnight for both current time and scheduled time
    current_minutes = now.hour * 60 + now.minute
    scheduled_minutes = schedule_hour * 60 + schedule_minute

    # Execute if current time is at or within EXECUTION_WINDOW_MINUTES after scheduled time
    diff = current_minutes - scheduled_minutes
    if 0 <= diff < EXECUTION_WINDOW_MINUTES:
        scheduler_logger.info(
            f"Schedule {schedule_id}: time match — "
            f"now={now.hour:02d}:{now.minute:02d}, scheduled={schedule_hour:02d}:{schedule_minute:02d}"
        )
        return True

    return False


# ---------------------------------------------------------------------------
# Main check loop
# ---------------------------------------------------------------------------

def check_and_execute_schedules():
    """Check all schedules and execute those that should run now."""
    try:
        user_tz = _get_user_timezone()
        now = datetime.datetime.now(user_tz)

        schedule_data = load_schedule()
        if not schedule_data:
            return

        for app_type, schedules_list in schedule_data.items():
            for entry in schedules_list:
                if should_execute_schedule(entry):
                    entry_id = entry.get("id")

                    # Cooldown check
                    if entry_id and entry_id in last_executed_actions:
                        last_time = last_executed_actions[entry_id]
                        delta_min = (now - last_time).total_seconds() / 60
                        if delta_min < COOLDOWN_MINUTES:
                            continue

                    entry["appType"] = app_type
                    execute_action(entry)

                    if entry_id:
                        last_executed_actions[entry_id] = now

    except Exception as e:
        scheduler_logger.error(f"Error checking schedules: {e}")
        scheduler_logger.error(traceback.format_exc())


def load_schedule():
    """Load the schedule configuration from database."""
    try:
        db = get_database()
        return db.get_schedules()
    except Exception as e:
        scheduler_logger.error(f"Error loading schedule from database: {e}")
        return {"global": [], "sonarr": [], "radarr": [], "lidarr": [], "readarr": [], "whisparr": [], "eros": [], "movie_hunt": [], "tv_hunt": []}


# ---------------------------------------------------------------------------
# Scheduler thread management
# ---------------------------------------------------------------------------

def scheduler_loop():
    """Main scheduler loop — runs in a background thread."""
    scheduler_logger.info("Scheduler loop started.")
    while not stop_event.is_set():
        try:
            check_stateful_expiration()
            check_and_execute_schedules()
            stop_event.wait(SCHEDULE_CHECK_INTERVAL)
        except Exception as e:
            scheduler_logger.error(f"Error in scheduler loop: {e}")
            scheduler_logger.error(traceback.format_exc())
            time.sleep(5)
    scheduler_logger.info("Scheduler loop stopped")


def get_execution_history():
    """Get the execution history for the scheduler."""
    return list(execution_history)


def start_scheduler():
    """Start the scheduler engine."""
    global scheduler_thread
    if scheduler_thread and scheduler_thread.is_alive():
        scheduler_logger.info("Scheduler already running")
        return

    stop_event.clear()
    scheduler_thread = threading.Thread(target=scheduler_loop, name="SchedulerEngine", daemon=True)
    scheduler_thread.start()

    _add_history({"id": "system", "action": "startup", "app": "scheduler"}, "info", "Scheduler engine started")
    scheduler_logger.info(f"Scheduler engine started. Thread alive: {scheduler_thread.is_alive()}")
    return True


def stop_scheduler():
    """Stop the scheduler engine."""
    global scheduler_thread
    if not scheduler_thread or not scheduler_thread.is_alive():
        scheduler_logger.info("Scheduler not running")
        return

    stop_event.set()
    scheduler_thread.join(timeout=5.0)

    if scheduler_thread.is_alive():
        scheduler_logger.warning("Scheduler did not terminate gracefully")
    else:
        scheduler_logger.info("Scheduler stopped gracefully")


# Keep old name as alias for compatibility
add_to_history = _add_history
