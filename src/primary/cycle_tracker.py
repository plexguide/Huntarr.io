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
            db = get_database()
            # Per-instance data for *arr apps (sonarr, radarr, etc.)
            per_instance_all = db.get_all_sleep_data_per_instance()
            
            if app_type:
                # Return data for a specific app
                if app_type in per_instance_all and per_instance_all[app_type]:
                    instances = {}
                    for inst_name, data in per_instance_all[app_type].items():
                        pending = db.get_pending_reset_request(app_type, inst_name) is not None
                        instances[inst_name] = {
                            "next_cycle": data.get("next_cycle_time"),
                            "updated_at": data.get("last_cycle_end") or data.get("last_cycle_start"),
                            "cyclelock": data.get("cycle_lock", True),
                            "pending_reset": pending
                        }
                    return {"app": app_type, "instances": instances}
                data = db.get_sleep_data(app_type)
                if data:
                    pending = db.get_pending_reset_request(app_type, None) is not None
                    return {
                        "app": app_type,
                        "next_cycle": data.get("next_cycle_time"),
                        "updated_at": data.get("last_cycle_end") or data.get("last_cycle_start"),
                        "cyclelock": data.get("cycle_lock", True),
                        "pending_reset": pending
                    }
                return {"app": app_type, "error": f"No cycle data available for {app_type}"}
            else:
                # Return data for all apps
                result = {}
                # Single-app data (e.g. swaparr)
                all_data = db.get_sleep_data()
                for app, data in all_data.items():
                    result[app] = {
                        "next_cycle": data.get("next_cycle_time"),
                        "updated_at": data.get("last_cycle_end") or data.get("last_cycle_start"),
                        "cyclelock": data.get("cycle_lock", True)
                    }
                # Override with per-instance for *arr apps that have instances
                for app, instances in per_instance_all.items():
                    if instances:
                        inst_dict = {}
                        for inst_name, data in instances.items():
                            pending = db.get_pending_reset_request(app, inst_name) is not None
                            inst_dict[inst_name] = {
                                "next_cycle": data.get("next_cycle_time"),
                                "updated_at": data.get("last_cycle_end") or data.get("last_cycle_start"),
                                "cyclelock": data.get("cycle_lock", True),
                                "pending_reset": pending
                            }
                        result[app] = {"instances": inst_dict}
                # Add pending_reset for single-app (e.g. swaparr)
                for app, data in result.items():
                    if "instances" not in data and data:
                        data["pending_reset"] = db.get_pending_reset_request(app, None) is not None
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


