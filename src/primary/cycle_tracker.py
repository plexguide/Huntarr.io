#!/usr/bin/env python3
"""
Cycle Tracker for Huntarr
Manages cycle timing and sleep data for all apps
Now uses SQLite database instead of JSON files for better performance and reliability.
"""

import datetime
import threading
from typing import Dict, Any, Optional
from src.primary.utils.logger import get_logger
from src.primary.utils.database import get_database

logger = get_logger("cycle_tracker")

# Lock for thread-safe operations
_lock = threading.Lock()

# Per-instance current activity (e.g. "Season Search (360/600)") for UI when cycle is running
_cycle_activity: Dict[str, Dict[str, str]] = {}

def set_cycle_activity(app_type: str, instance_name: str, activity: str) -> None:
    """Set current activity for an instance (e.g. command wait progress). Shown on frontend when cycle is running."""
    with _lock:
        if app_type not in _cycle_activity:
            _cycle_activity[app_type] = {}
        _cycle_activity[app_type][instance_name] = activity

def clear_cycle_activity(app_type: str, instance_name: str) -> None:
    """Clear current activity for an instance (e.g. when cycle ends or command completes)."""
    with _lock:
        if app_type in _cycle_activity and instance_name in _cycle_activity[app_type]:
            del _cycle_activity[app_type][instance_name]
            if not _cycle_activity[app_type]:
                del _cycle_activity[app_type]

def get_cycle_activity(app_type: str, instance_name: str) -> Optional[str]:
    """Get current activity string for an instance, or None."""
    with _lock:
        return (_cycle_activity.get(app_type) or {}).get(instance_name)

def _get_user_timezone():
    """Get the user's configured timezone"""
    try:
        from src.primary.settings_manager import load_settings
        general_settings = load_settings("general")
        timezone_str = general_settings.get("timezone", "UTC")
        
        import pytz
        return pytz.timezone(timezone_str)
    except Exception as e:
        logger.warning(f"Error getting user timezone, defaulting to UTC: {e}")
        import pytz
        return pytz.UTC

def update_sleep_json(app_type: str, next_cycle_time: datetime.datetime, cyclelock: bool = None,
                      instance_name: Optional[str] = None) -> None:
    """
    Update the sleep/cycle data in the database.
    instance_name=None for single-app (e.g. swaparr); set for *arr per-instance.
    """
    try:
        label = f"{app_type}" + (f" instance {instance_name}" if instance_name else "")
        logger.debug(f"Updating sleep data for {label}, cyclelock: {cyclelock}")
        
        user_tz = _get_user_timezone()
        if next_cycle_time.tzinfo is None:
            next_cycle_time = user_tz.localize(next_cycle_time)
        elif next_cycle_time.tzinfo != user_tz:
            next_cycle_time = next_cycle_time.astimezone(user_tz)
        next_cycle_time = next_cycle_time.replace(microsecond=0)
        
        db = get_database()
        if instance_name is not None:
            current_data = db.get_sleep_data_per_instance(app_type, instance_name)
            if cyclelock is None:
                cyclelock = current_data.get('cycle_lock', True)
            db.set_sleep_data_per_instance(
                app_type=app_type,
                instance_name=instance_name,
                next_cycle_time=next_cycle_time.isoformat(),
                cycle_lock=cyclelock,
                last_cycle_start=current_data.get('last_cycle_start'),
                last_cycle_end=current_data.get('last_cycle_end')
            )
        else:
            current_data = db.get_sleep_data(app_type)
            if cyclelock is None:
                cyclelock = current_data.get('cycle_lock', True)
            db.set_sleep_data(
                app_type=app_type,
                next_cycle_time=next_cycle_time.isoformat(),
                cycle_lock=cyclelock,
                last_cycle_start=current_data.get('last_cycle_start'),
                last_cycle_end=current_data.get('last_cycle_end')
            )
        logger.info(f"Updated sleep data for {label}: next_cycle={next_cycle_time.isoformat()}, cyclelock={cyclelock}")
    except Exception as e:
        logger.error(f"Error updating sleep data for {app_type}: {e}")

def update_next_cycle(app_type: str, next_cycle_time: datetime.datetime,
                     instance_name: Optional[str] = None) -> None:
    """Update the next cycle time for an app or (app, instance)."""
    with _lock:
        user_tz = _get_user_timezone()
        if next_cycle_time.tzinfo is None:
            next_cycle_time = user_tz.localize(next_cycle_time)
        elif next_cycle_time.tzinfo != user_tz:
            next_cycle_time = next_cycle_time.astimezone(user_tz)
        next_cycle_time = next_cycle_time.replace(microsecond=0)
        update_sleep_json(app_type, next_cycle_time, instance_name=instance_name)

def get_cycle_status(app_type: Optional[str] = None) -> Dict[str, Any]:
    """
    Get the cycle status for all apps or a specific app.
    For *arr apps with multiple instances, returns per-instance data under "instances".
    """
    with _lock:
        try:
            from src.primary.settings_manager import load_settings
            db = get_database()
            # Per-instance data for *arr apps (sonarr, radarr, etc.)
            per_instance_all = db.get_all_sleep_data_per_instance()
            
            # List of apps that support multiple instances
            arr_apps = ["sonarr", "radarr", "lidarr", "readarr", "whisparr", "eros"]
            
            if app_type:
                # Return data for a specific app
                if app_type in arr_apps:
                    instances = {}
                    # Get configured instance names
                    app_settings = load_settings(app_type)
                    instance_names = []
                    if app_settings and isinstance(app_settings.get("instances"), list):
                        for inst in app_settings["instances"]:
                            if inst.get("enabled", True) and inst.get("api_url") and inst.get("api_key"):
                                from src.primary.stats_manager import _normalize_instance_name
                                instance_names.append(_normalize_instance_name(inst.get("name") or inst.get("instance_name")))
                    
                    # Start with all configured instances (set default state)
                    for name in instance_names:
                        instances[name] = {
                            "next_cycle": None,
                            "updated_at": None,
                            "cyclelock": False,
                            "pending_reset": db.get_pending_reset_request(app_type, name) is not None
                        }
                    
                    # Merge with actual data from DB and current activity (e.g. "Season Search (360/600)")
                    if app_type in per_instance_all:
                        for inst_name, data in per_instance_all[app_type].items():
                            if inst_name in instances:
                                instances[inst_name].update({
                                    "next_cycle": data.get("next_cycle_time"),
                                    "updated_at": data.get("last_cycle_end") or data.get("last_cycle_start"),
                                    "cyclelock": data.get("cycle_lock", False),
                                    "cycle_activity": _cycle_activity.get(app_type, {}).get(inst_name)
                                })
                    for name in instances:
                        if "cycle_activity" not in instances[name]:
                            instances[name]["cycle_activity"] = _cycle_activity.get(app_type, {}).get(name)
                    return {"app": app_type, "instances": instances}
                
                # Single-app logic (e.g. swaparr)
                data = db.get_sleep_data(app_type)
                pending = db.get_pending_reset_request(app_type, None) is not None
                if data:
                    return {
                        "app": app_type,
                        "next_cycle": data.get("next_cycle_time"),
                        "updated_at": data.get("last_cycle_end") or data.get("last_cycle_start"),
                        "cyclelock": data.get("cycle_lock", False),
                        "pending_reset": pending
                    }
                return {
                    "app": app_type,
                    "next_cycle": None,
                    "updated_at": None,
                    "cyclelock": False,
                    "pending_reset": pending
                }
            else:
                # Return data for all apps
                result = {}
                
                # First, initialize all configured apps and instances
                for app in arr_apps:
                    app_settings = load_settings(app)
                    instance_names = []
                    if app_settings and isinstance(app_settings.get("instances"), list):
                        for inst in app_settings["instances"]:
                            if inst.get("enabled", True) and inst.get("api_url") and inst.get("api_key"):
                                from src.primary.stats_manager import _normalize_instance_name
                                instance_names.append(_normalize_instance_name(inst.get("name") or inst.get("instance_name")))
                    
                    if instance_names:
                        inst_dict = {}
                        for name in instance_names:
                            inst_dict[name] = {
                                "next_cycle": None,
                                "updated_at": None,
                                "cyclelock": False,
                                "pending_reset": db.get_pending_reset_request(app, name) is not None
                            }
                        result[app] = {"instances": inst_dict}
                    else:
                        # Fallback for single-app apps or legacy
                        result[app] = {
                            "next_cycle": None,
                            "updated_at": None,
                            "cyclelock": False,
                            "pending_reset": db.get_pending_reset_request(app, None) is not None
                        }
                
                # Add/Update with actual DB data
                all_single_data = db.get_sleep_data()
                for app, data in all_single_data.items():
                    if app in result and "instances" not in result[app]:
                        result[app].update({
                            "next_cycle": data.get("next_cycle_time"),
                            "updated_at": data.get("last_cycle_end") or data.get("last_cycle_start"),
                            "cyclelock": data.get("cycle_lock", False)
                        })
                    elif app not in result:
                        result[app] = {
                            "next_cycle": data.get("next_cycle_time"),
                            "updated_at": data.get("last_cycle_end") or data.get("last_cycle_start"),
                            "cyclelock": data.get("cycle_lock", False),
                            "pending_reset": db.get_pending_reset_request(app, None) is not None
                        }
                
                # Merge per-instance actual data and current activity
                for app, instances in per_instance_all.items():
                    if app in result and "instances" in result[app]:
                        for inst_name, data in instances.items():
                            if inst_name in result[app]["instances"]:
                                result[app]["instances"][inst_name].update({
                                    "next_cycle": data.get("next_cycle_time"),
                                    "updated_at": data.get("last_cycle_end") or data.get("last_cycle_start"),
                                    "cyclelock": data.get("cycle_lock", False),
                                    "cycle_activity": _cycle_activity.get(app, {}).get(inst_name)
                                })
                for app in result:
                    if "instances" in result[app]:
                        for inst_name in result[app]["instances"]:
                            if "cycle_activity" not in result[app]["instances"][inst_name]:
                                result[app]["instances"][inst_name]["cycle_activity"] = _cycle_activity.get(app, {}).get(inst_name)
                return result
        except Exception as e:
            logger.error(f"Error getting cycle status: {e}")
            return {"error": str(e)}

def start_cycle(app_type: str, instance_name: Optional[str] = None) -> None:
    """Mark that a cycle has started for an app or (app, instance). instance_name=None for swaparr."""
    try:
        db = get_database()
        user_tz = _get_user_timezone()
        now_user_tz = datetime.datetime.now(user_tz).replace(microsecond=0)
        label = f"{app_type}" + (f" instance {instance_name}" if instance_name else "")
        if instance_name is not None:
            current_data = db.get_sleep_data_per_instance(app_type, instance_name)
            db.set_sleep_data_per_instance(
                app_type=app_type,
                instance_name=instance_name,
                next_cycle_time=current_data.get('next_cycle_time'),
                cycle_lock=True,
                last_cycle_start=now_user_tz.isoformat(),
                last_cycle_end=current_data.get('last_cycle_end')
            )
        else:
            current_data = db.get_sleep_data(app_type)
            db.set_sleep_data(
                app_type=app_type,
                next_cycle_time=current_data.get('next_cycle_time'),
                cycle_lock=True,
                last_cycle_start=now_user_tz.isoformat(),
                last_cycle_end=current_data.get('last_cycle_end')
            )
        if app_type == "swaparr":
            logger.debug(f"Started cycle for {label} (cyclelock = True)")
        else:
            logger.info(f"Started cycle for {label} (cyclelock = True)")
    except Exception as e:
        logger.error(f"Error starting cycle for {app_type}: {e}")

def end_cycle(app_type: str, next_cycle_time: datetime.datetime,
              instance_name: Optional[str] = None) -> None:
    """Mark that a cycle has ended for an app or (app, instance). instance_name=None for swaparr."""
    try:
        label = f"{app_type}" + (f" instance {instance_name}" if instance_name else "")
        logger.info(f"Ending cycle for {label}, next cycle at {next_cycle_time.isoformat()}")
        db = get_database()
        user_tz = _get_user_timezone()
        now_user_tz = datetime.datetime.now(user_tz).replace(microsecond=0)
        if next_cycle_time.tzinfo is None:
            next_cycle_time = user_tz.localize(next_cycle_time)
        elif next_cycle_time.tzinfo != user_tz:
            next_cycle_time = next_cycle_time.astimezone(user_tz)
        next_cycle_time = next_cycle_time.replace(microsecond=0)
        with _lock:
            if instance_name is not None:
                current_data = db.get_sleep_data_per_instance(app_type, instance_name)
                db.set_sleep_data_per_instance(
                    app_type=app_type,
                    instance_name=instance_name,
                    next_cycle_time=next_cycle_time.isoformat(),
                    cycle_lock=False,
                    last_cycle_start=current_data.get('last_cycle_start'),
                    last_cycle_end=now_user_tz.isoformat()
                )
            else:
                current_data = db.get_sleep_data(app_type)
                db.set_sleep_data(
                    app_type=app_type,
                    next_cycle_time=next_cycle_time.isoformat(),
                    cycle_lock=False,
                    last_cycle_start=current_data.get('last_cycle_start'),
                    last_cycle_end=now_user_tz.isoformat()
                )
        if app_type == "swaparr":
            logger.debug(f"Ended cycle for {label} (cyclelock = False)")
        else:
            logger.info(f"Ended cycle for {label} (cyclelock = False)")
    except Exception as e:
        logger.error(f"Error ending cycle for {app_type}: {e}")

def reset_cycle(app_type: str, instance_name: Optional[str] = None,
                sleep_minutes: int = 15) -> bool:
    """Reset the cycle for an app or (app, instance). instance_name=None for swaparr."""
    with _lock:
        try:
            db = get_database()
            user_tz = _get_user_timezone()
            now = datetime.datetime.now(user_tz).replace(microsecond=0)
            future_time = now + datetime.timedelta(minutes=sleep_minutes)
            label = f"{app_type}" + (f" instance {instance_name}" if instance_name else "")
            if instance_name is not None:
                db.set_sleep_data_per_instance(
                    app_type=app_type,
                    instance_name=instance_name,
                    next_cycle_time=future_time.isoformat(),
                    cycle_lock=True,
                    last_cycle_start=None,
                    last_cycle_end=None
                )
            else:
                db.set_sleep_data(
                    app_type=app_type,
                    next_cycle_time=future_time.isoformat(),
                    cycle_lock=True,
                    last_cycle_start=None,
                    last_cycle_end=None
                )
            logger.info(f"Reset cycle for {label} - set cyclelock to True")
            return True
        except Exception as e:
            logger.error(f"Error resetting cycle for {app_type}: {e}")
            return False


