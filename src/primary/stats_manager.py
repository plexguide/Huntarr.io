#!/usr/bin/env python3
"""
Statistics Manager for Huntarr
Handles tracking, storing, and retrieving statistics about hunted and upgraded media
and monitoring hourly API usage for rate limiting
Now uses SQLite database instead of JSON files for better performance and reliability.
"""

import datetime
import threading
from typing import Dict, Any, Optional
from src.primary.utils.logger import get_logger
from src.primary.utils.database import get_database

logger = get_logger("stats")

# Lock for thread-safe operations
stats_lock = threading.Lock()
hourly_lock = threading.Lock()

# Store the last hour we checked for resetting hourly caps
last_hour_checked = None

# Schedule the next hourly reset check
next_reset_check = None


def _normalize_instance_name(name: Optional[str]) -> str:
    """Normalize instance name for consistent DB keys and API responses (avoids lost counts on refresh)."""
    if name is None or not isinstance(name, str):
        return "Default"
    s = (name or "").strip()
    return s if s else "Default"

def load_stats() -> Dict[str, Dict[str, int]]:
    """
    Load statistics from the database
    
    Returns:
        Dictionary containing statistics for each app
    """
    try:
        db = get_database()
        stats = db.get_media_stats()
        
        # Ensure all apps have default structure
        default_stats = get_default_stats()
        for app in default_stats:
            if app not in stats:
                stats[app] = default_stats[app]
            else:
                # Ensure all stat types exist
                for stat_type in default_stats[app]:
                    if stat_type not in stats[app]:
                        stats[app][stat_type] = 0
        
        # Stats loaded - debug spam removed
        return stats
    except Exception as e:
        logger.error(f"Error loading stats from database: {e}")
        return get_default_stats()

def get_default_stats() -> Dict[str, Dict[str, int]]:
    """Get the default statistics structure"""
    return {
        "sonarr": {"hunted": 0, "upgraded": 0},
        "radarr": {"hunted": 0, "upgraded": 0},
        "lidarr": {"hunted": 0, "upgraded": 0},
        "readarr": {"hunted": 0, "upgraded": 0},
        "whisparr": {"hunted": 0, "upgraded": 0},
        "eros": {"hunted": 0, "upgraded": 0}
    }

def get_default_hourly_caps() -> Dict[str, Dict[str, int]]:
    """Get the default hourly caps structure"""
    return {
        "sonarr": {"api_hits": 0},
        "radarr": {"api_hits": 0},
        "lidarr": {"api_hits": 0},
        "readarr": {"api_hits": 0},
        "whisparr": {"api_hits": 0},
        "eros": {"api_hits": 0}
    }

def load_hourly_caps() -> Dict[str, Dict[str, int]]:
    """
    Load hourly API caps from the database
    
    Returns:
        Dictionary containing hourly API usage for each app
    """
    try:
        db = get_database()
        caps = db.get_hourly_caps()
        
        # Ensure all apps are in the caps
        default_caps = get_default_hourly_caps()
        for app in default_caps:
            if app not in caps:
                caps[app] = default_caps[app]
        
        return caps
    except Exception as e:
        logger.error(f"Error loading hourly caps from database: {e}")
        return get_default_hourly_caps()

def save_hourly_caps(caps: Dict[str, Dict[str, int]]) -> bool:
    """
    Save hourly API caps to the database
    
    Args:
        caps: Dictionary containing hourly API usage for each app
        
    Returns:
        True if successful, False otherwise
    """
    try:
        db = get_database()
        for app_type, app_caps in caps.items():
            api_hits = app_caps.get("api_hits", 0)
            last_reset_hour = app_caps.get("last_reset_hour", datetime.datetime.now().hour)
            db.set_hourly_cap(app_type, api_hits, last_reset_hour)
        
        logger.debug(f"Saved hourly caps to database: {caps}")
        return True
    except Exception as e:
        logger.error(f"Error saving hourly caps to database: {e}")
        return False

def check_hourly_reset():
    """
    Check if we need to reset hourly caps based on the current hour
    """
    global last_hour_checked, next_reset_check
    
    current_time = datetime.datetime.now()
    current_hour = current_time.hour
    
    # Skip if we've already checked this hour
    if last_hour_checked == current_hour:
        return
    
    # Only reset at the top of the hour (00 minute mark)
    if current_time.minute == 0:
        logger.debug(f"Hour changed to {current_hour}:00, resetting hourly API caps")
        reset_hourly_caps()
        last_hour_checked = current_hour

def increment_hourly_cap(app_type: str, count: int = 1, instance_name: Optional[str] = None) -> bool:
    """
    Increment hourly API usage for an app or (app, instance).
    When instance_name is set (or from thread-local in per-instance context), uses per-instance counter.
    """
    if app_type not in ["sonarr", "radarr", "lidarr", "readarr", "whisparr", "eros"]:
        logger.error(f"Invalid app_type for hourly cap: {app_type}")
        return False
    if instance_name is None:
        try:
            from src.primary.utils.clean_logger import get_instance_name_for_cap
            instance_name = get_instance_name_for_cap()
        except Exception:
            pass
    if instance_name is not None:
        instance_name = _normalize_instance_name(instance_name)
    check_hourly_reset()
    with hourly_lock:
        try:
            db = get_database()
            if instance_name is not None:
                db.increment_hourly_cap_per_instance(app_type, instance_name, count)
                # Per-increment INFO log removed; one summary is logged at end of instance cycle in background.py
                logger.debug(f"*** HOURLY API INCREMENT *** {app_type} instance '{instance_name}' by {count}")
                return True
            caps = db.get_hourly_caps()
            prev_value = caps.get(app_type, {}).get("api_hits", 0)
            db.increment_hourly_cap(app_type, count)
            new_value = prev_value + count
            hourly_limit = _get_app_hourly_cap_limit(app_type)
            logger.debug(f"*** HOURLY API INCREMENT *** {app_type} by {count}: {prev_value} -> {new_value} (hourly limit: {hourly_limit})")
            if new_value >= int(hourly_limit * 0.8) and prev_value < int(hourly_limit * 0.8):
                logger.warning(f"{app_type} is approaching hourly API cap: {new_value}/{hourly_limit}")
            if new_value >= hourly_limit and prev_value < hourly_limit:
                logger.error(f"{app_type} has exceeded hourly API cap: {new_value}/{hourly_limit}")
            return True
        except Exception as e:
            logger.error(f"Error incrementing hourly cap for {app_type}: {e}")
            return False

def _get_instance_hourly_cap_limit(app_type: str, instance_key: str) -> int:
    """Get the hourly API cap limit for a single instance from settings. instance_key may be display name or instance_id."""
    try:
        from src.primary.settings_manager import load_settings
        app_settings = load_settings(app_type)
        if not app_settings:
            return 20
        for inst in app_settings.get("instances", []):
            if (inst.get("name") == instance_key or inst.get("instance_name") == instance_key
                    or inst.get("instance_id") == instance_key):
                return int(inst.get("hourly_cap", app_settings.get("hourly_cap", 20)))
        return int(app_settings.get("hourly_cap", 20))
    except Exception as e:
        logger.error(f"Error getting instance hourly cap limit for {app_type}/{instance_key}: {e}")
        return 20

def get_hourly_cap_status(app_type: str, instance_name: Optional[str] = None) -> Dict[str, Any]:
    """
    Get current API usage status for an app or (app, instance).
    When instance_name is set, returns that instance's usage and limit.
    """
    if app_type not in ["sonarr", "radarr", "lidarr", "readarr", "whisparr", "eros"]:
        return {"error": f"Invalid app_type: {app_type}"}
    with hourly_lock:
        try:
            db = get_database()
            if instance_name is not None:
                per_instance = db.get_hourly_caps_per_instance(app_type)
                current_usage = per_instance.get(instance_name, {}).get("api_hits", 0)
                hourly_limit = _get_instance_hourly_cap_limit(app_type, instance_name)
                return {
                    "app": app_type,
                    "instance_name": instance_name,
                    "current_usage": current_usage,
                    "limit": hourly_limit,
                    "remaining": max(0, hourly_limit - current_usage),
                    "percent_used": int((current_usage / hourly_limit) * 100) if hourly_limit > 0 else 0,
                    "exceeded": current_usage >= hourly_limit
                }
            caps = db.get_hourly_caps()
            hourly_limit = _get_app_hourly_cap_limit(app_type)
            current_usage = caps.get(app_type, {}).get("api_hits", 0)
            return {
                "app": app_type,
                "current_usage": current_usage,
                "limit": hourly_limit,
                "remaining": max(0, hourly_limit - current_usage),
                "percent_used": int((current_usage / hourly_limit) * 100) if hourly_limit > 0 else 0,
                "exceeded": current_usage >= hourly_limit
            }
        except Exception as e:
            logger.error(f"Error getting hourly cap status for {app_type}: {e}")
            return {"error": f"Database error: {e}"}

def _get_app_hourly_cap_limit(app_type: str) -> int:
    """
    Get the hourly API cap limit: sum of per-instance hourly_cap for enabled instances,
    or app-level fallback for legacy config.
    """
    try:
        from src.primary.settings_manager import load_settings
        app_settings = load_settings(app_type)
        if not app_settings:
            return 20
        instances = app_settings.get("instances", [])
        if not instances:
            return int(app_settings.get("hourly_cap", 20))
        total = 0
        for inst in instances:
            if inst.get("enabled", True):
                total += int(inst.get("hourly_cap", app_settings.get("hourly_cap", 20)))
        return max(total, 1) if total else int(app_settings.get("hourly_cap", 20))
    except Exception as e:
        logger.error(f"Error getting hourly cap limit for {app_type}: {e}")
        return 20

def _calculate_per_instance_hourly_limit(app_type: str) -> int:
    """
    Calculate the hourly limit based on the sum of all enabled instances' hunt values
    
    Args:
        app_type: The application type (sonarr, radarr, etc.)
        
    Returns:
        The calculated hourly limit based on per-instance hunt values
    """
    try:
        # Import here to avoid circular imports
        from src.primary.settings_manager import load_settings
        
        # Load app settings to get instances
        app_settings = load_settings(app_type)
        if not app_settings:
            logger.warning(f"No settings found for {app_type}, using default limit 20")
            return 20
        
        instances = app_settings.get("instances", [])
        if not instances:
            # Fallback to legacy single instance if no instances array
            logger.debug(f"No instances array found for {app_type}, using legacy single instance calculation")
            missing_limit = app_settings.get("hunt_missing_items", 1) if app_type in ["sonarr", "lidarr", "whisparr", "eros"] else app_settings.get("hunt_missing_movies" if app_type == "radarr" else "hunt_missing_books", 1)
            upgrade_limit = app_settings.get("hunt_upgrade_items", 0) if app_type in ["sonarr", "lidarr", "whisparr", "eros"] else app_settings.get("hunt_upgrade_movies" if app_type == "radarr" else "hunt_upgrade_books", 0)
            total_limit = missing_limit + upgrade_limit
            return max(total_limit, 1)  # Ensure minimum of 1
        
        # Calculate total hunt values across all enabled instances
        total_missing = 0
        total_upgrade = 0
        enabled_instances = 0
        
        # Get the correct field names based on app type
        if app_type == "radarr":
            missing_field = "hunt_missing_movies"
            upgrade_field = "hunt_upgrade_movies"
        elif app_type == "readarr":
            missing_field = "hunt_missing_books"
            upgrade_field = "hunt_upgrade_books"
        else:  # sonarr, lidarr, whisparr, eros
            missing_field = "hunt_missing_items"
            upgrade_field = "hunt_upgrade_items"
        
        for instance in instances:
            # Only count enabled instances
            if instance.get("enabled", True):  # Default to enabled if not specified
                enabled_instances += 1
                total_missing += instance.get(missing_field, 1)  # Default to 1 if not specified
                total_upgrade += instance.get(upgrade_field, 0)  # Default to 0 if not specified
        
        total_limit = total_missing + total_upgrade
        
        logger.debug(f"Calculated hourly limit for {app_type}: {total_limit} (missing: {total_missing}, upgrade: {total_upgrade}, enabled instances: {enabled_instances})")
        
        # Ensure minimum of 1 even if all values are 0
        return max(total_limit, 1)
        
    except Exception as e:
        logger.error(f"Error calculating per-instance hourly limit for {app_type}: {e}")
        # Fallback to app-level hourly_cap or default
        from src.primary.settings_manager import load_settings
        app_settings = load_settings(app_type)
        return app_settings.get("hourly_cap", 20) if app_settings else 20

def check_hourly_cap_exceeded(app_type: str, instance_name: Optional[str] = None) -> bool:
    """
    Check if an app or (app, instance) has exceeded its hourly API cap.
    When instance_name is set (or from thread-local), checks that instance.
    """
    if instance_name is None:
        try:
            from src.primary.utils.clean_logger import get_instance_name_for_cap
            instance_name = get_instance_name_for_cap()
        except Exception:
            pass
    status = get_hourly_cap_status(app_type, instance_name=instance_name)
    return status.get("exceeded", False)

def save_stats(stats: Dict[str, Dict[str, int]]) -> bool:
    """
    Save statistics to the database
    
    Args:
        stats: Dictionary containing statistics for each app
        
    Returns:
        True if successful, False otherwise
    """
    try:
        db = get_database()
        for app_type, app_stats in stats.items():
            for stat_type, value in app_stats.items():
                db.set_media_stat(app_type, stat_type, value)
        
        logger.debug(f"Saved stats to database: {stats}")
        return True
    except Exception as e:
        logger.error(f"Error saving stats to database: {e}")
        return False

def increment_stat(app_type: str, stat_type: str, count: int = 1, instance_name: Optional[str] = None) -> bool:
    """
    Increment a specific statistic (app-level and optionally per-instance).
    
    Args:
        app_type: The application type (sonarr, radarr, etc.)
        stat_type: The type of statistic (hunted or upgraded)
        count: The amount to increment by (default: 1)
        instance_name: If set, also increment per-instance stat for Home dashboard
    """
    if app_type not in ["sonarr", "radarr", "lidarr", "readarr", "whisparr", "eros"]:
        logger.error(f"Invalid app_type: {app_type}")
        return False
        
    if stat_type not in ["hunted", "upgraded"]:
        logger.error(f"Invalid stat_type: {stat_type}")
        return False
    
    # Also increment the hourly API cap (per-instance when instance_name is set)
    increment_hourly_cap(app_type, count, instance_name=instance_name)
    
    if instance_name is not None:
        instance_name = _normalize_instance_name(instance_name)
    with stats_lock:
        try:
            db = get_database()
            db.increment_media_stat(app_type, stat_type, count)
            if instance_name:
                db.increment_media_stat_per_instance(app_type, instance_name, stat_type, count)
            logger.debug(f"*** STATS INCREMENT *** {app_type} {stat_type} by {count}" + (f" (instance: {instance_name})" if instance_name else ""))
            return True
        except Exception as e:
            logger.error(f"Error incrementing stat {app_type}.{stat_type}: {e}")
            return False

def increment_stat_only(app_type: str, stat_type: str, count: int = 1, instance_name: Optional[str] = None) -> bool:
    """
    Increment a specific statistic and the hourly API cap (so the API bar matches searches/upgrades).
    Optionally increments per-instance stat for Home dashboard.
    """
    if app_type not in ["sonarr", "radarr", "lidarr", "readarr", "whisparr", "eros"]:
        logger.error(f"Invalid app_type: {app_type}")
        return False
        
    if stat_type not in ["hunted", "upgraded"]:
        logger.error(f"Invalid stat_type: {stat_type}")
        return False

    # Count towards API limit bar so it matches SEARCHES TRIGGERED / UPGRADES TRIGGERED (per-instance when set)
    increment_hourly_cap(app_type, count, instance_name=instance_name)
    
    if instance_name is not None:
        instance_name = _normalize_instance_name(instance_name)
    with stats_lock:
        try:
            db = get_database()
            db.increment_media_stat(app_type, stat_type, count)
            if instance_name:
                db.increment_media_stat_per_instance(app_type, instance_name, stat_type, count)
            logger.debug(f"*** STATS ONLY INCREMENT *** {app_type} {stat_type} by {count}" + (f" (instance: {instance_name})" if instance_name else ""))
            return True
        except Exception as e:
            logger.error(f"Error incrementing stat {app_type}.{stat_type}: {e}")
            return False

def get_stats() -> Dict[str, Any]:
    """
    Get the current statistics (app-level + per-instance for Home dashboard).
    Returns dict: app_type -> { hunted, upgraded, instances: [{ instance_name, hunted, upgraded, api_hits, api_limit, state_reset_hours_until? }] }.
    Per-instance api_hits/api_limit are read directly from the database so all instance cards display correctly.
    state_reset_hours_until is set when per-instance state reset is active (hours until next reset).
    """
    import time
    with stats_lock:
        stats = load_stats()
        try:
            from src.primary.settings_manager import load_settings
            db = get_database()
            now_ts = int(time.time())
            for app_type in ["sonarr", "radarr", "lidarr", "readarr", "whisparr", "eros"]:
                if app_type not in stats:
                    stats[app_type] = {"hunted": 0, "upgraded": 0}
                # Get configured instances (name + id) so we show cards; DB is keyed by instance_id
                configured = []
                try:
                    app_module = __import__(f"src.primary.apps.{app_type}", fromlist=["get_configured_instances"])
                    get_instances = getattr(app_module, "get_configured_instances", None)
                    if get_instances:
                        configured = list(get_instances(quiet=True))
                except Exception:
                    pass
                if not configured:
                    app_settings = load_settings(app_type)
                    if app_settings and isinstance(app_settings.get("instances"), list):
                        for inst in app_settings["instances"]:
                            if inst.get("enabled", True) and inst.get("api_url") and inst.get("api_key"):
                                name = _normalize_instance_name(inst.get("name") or inst.get("instance_name"))
                                configured.append({"instance_name": name, "instance_id": inst.get("instance_id") or name})
                # Get per-instance stats/caps from DB (keyed by instance_id after migration)
                per_instance = db.get_media_stats_per_instance(app_type) if hasattr(db, "get_media_stats_per_instance") else []
                per_instance_caps = db.get_hourly_caps_per_instance(app_type) if hasattr(db, "get_hourly_caps_per_instance") else {}
                by_id = {p["instance_name"]: p for p in per_instance}  # "instance_name" column holds instance_id
                if configured:
                    stats[app_type]["instances"] = []
                    for inst in configured:
                        display_name = inst.get("instance_name", "Default")
                        instance_id = inst.get("instance_id") or display_name
                        inst_stats = by_id.get(instance_id, {})
                        cap_data = per_instance_caps.get(instance_id, {})
                        api_hits = cap_data.get("api_hits", 0)
                        api_limit = _get_instance_hourly_cap_limit(app_type, instance_id)
                        stateful_enabled = inst.get("state_management_mode", "custom") != "disabled"
                        state_reset_hours_until = None
                        if stateful_enabled and hasattr(db, "get_instance_lock_info"):
                            lock_info = db.get_instance_lock_info(app_type, instance_id)
                            if lock_info:
                                expires_at = lock_info.get("expires_at") or 0
                                if expires_at > now_ts:
                                    state_reset_hours_until = round((expires_at - now_ts) / 3600.0, 1)
                        api_url = (inst.get("api_url") or "").strip().rstrip("/") or None
                        stats[app_type]["instances"].append({
                            "instance_name": display_name,
                            "api_url": api_url,
                            "hunted": inst_stats.get("hunted", 0),
                            "upgraded": inst_stats.get("upgraded", 0),
                            "api_hits": api_hits,
                            "api_limit": api_limit,
                            "state_reset_hours_until": state_reset_hours_until,
                            "state_reset_enabled": stateful_enabled
                        })
                else:
                    stats[app_type]["instances"] = per_instance if per_instance else []
        except Exception as e:
            logger.error(f"Error attaching per-instance stats: {e}")
        return stats

def get_hourly_caps() -> Dict[str, Dict[str, int]]:
    """
    Get current hourly API caps
    
    Returns:
        Dictionary containing current hourly API usage for each app
    """
    with hourly_lock:
        return load_hourly_caps()

def load_hourly_caps_for_api() -> tuple:
    """
    Load hourly caps and limits in shape suitable for API/frontend.
    When an app has multiple instances, returns per-instance usage and limit per instance.
    Uses same instance name key as get_stats (name or Default) so frontend cards match.
    Returns (caps, limits) where caps/limits may have app[instances][instanceName] for *arr apps.
    """
    try:
        from src.primary.settings_manager import load_settings
        db = get_database()
        per_instance_caps = db.get_hourly_caps_per_instance()
        app_caps = db.get_hourly_caps()
        default_caps = get_default_hourly_caps()
        caps_out = {}
        limits_out = {}
        for app in ["sonarr", "radarr", "lidarr", "readarr", "whisparr", "eros"]:
            try:
                configured = []
                try:
                    app_module = __import__(f"src.primary.apps.{app}", fromlist=["get_configured_instances"])
                    get_instances = getattr(app_module, "get_configured_instances", None)
                    if get_instances:
                        configured = list(get_instances(quiet=True))
                except Exception:
                    pass
                if not configured:
                    app_settings = load_settings(app)
                    instances = (app_settings or {}).get("instances", [])
                    for inst in instances:
                        if inst.get("enabled", True) and inst.get("api_url") and inst.get("api_key"):
                            name = _normalize_instance_name(inst.get("name") or inst.get("instance_name"))
                            configured.append({"instance_name": name, "instance_id": inst.get("instance_id") or name})
                if configured:
                    inst_caps = per_instance_caps.get(app, {})
                    instances_dict = {}
                    limits_dict = {}
                    for inst in configured:
                        display_name = inst.get("instance_name", "Default")
                        instance_id = inst.get("instance_id") or display_name
                        cap_data = inst_caps.get(instance_id, {})
                        instances_dict[display_name] = {"api_hits": cap_data.get("api_hits", 0)}
                        limits_dict[display_name] = _get_instance_hourly_cap_limit(app, instance_id)
                    caps_out[app] = {"instances": instances_dict}
                    limits_out[app] = {"instances": limits_dict}
                    logger.debug(f"*** HOURLY API READ *** {app} instances: " + ', '.join([f"{k}={v['api_hits']}" for k, v in instances_dict.items()]))
                else:
                    caps_out[app] = app_caps.get(app, default_caps.get(app, {"api_hits": 0}))
                    limits_out[app] = _get_app_hourly_cap_limit(app)
            except Exception as app_err:
                logger.warning(f"Error loading hourly caps for {app}: {app_err}, using app-level fallback for this app")
                caps_out[app] = app_caps.get(app, default_caps.get(app, {"api_hits": 0}))
                limits_out[app] = _get_app_hourly_cap_limit(app)
        return caps_out, limits_out
    except Exception as e:
        logger.error(f"Error loading hourly caps for API: {e}")
        return load_hourly_caps(), {app: _get_app_hourly_cap_limit(app) for app in ["sonarr", "radarr", "lidarr", "readarr", "whisparr", "eros"]}

def reset_stats(app_type: Optional[str] = None) -> bool:
    """
    Reset statistics for a specific app or all apps
    
    Args:
        app_type: The application type to reset, or None to reset all
        
    Returns:
        True if successful, False otherwise
    """
    with stats_lock:
        try:
            db = get_database()
            
            if app_type is None:
                # Reset all stats (app-level + per-instance)
                logger.info("Resetting all app statistics")
                default_stats = get_default_stats()
                for app in default_stats:
                    for stat_type in default_stats[app]:
                        db.set_media_stat(app, stat_type, 0)
                    if hasattr(db, "reset_media_stats_per_instance"):
                        db.reset_media_stats_per_instance(app)
            else:
                # Reset specific app stats (app-level + per-instance)
                logger.info(f"Resetting statistics for {app_type}")
                db.set_media_stat(app_type, "hunted", 0)
                db.set_media_stat(app_type, "upgraded", 0)
                if hasattr(db, "reset_media_stats_per_instance"):
                    db.reset_media_stats_per_instance(app_type)
            
            return True
        except Exception as e:
            logger.error(f"Error resetting stats: {e}")
            return False

def reset_hourly_caps() -> bool:
    """
    Reset all hourly API caps to zero
    
    Returns:
        True if successful, False otherwise
    """
    with hourly_lock:
        try:
            db = get_database()
            db.reset_hourly_caps()
            logger.debug("Reset all hourly API caps")
            return True
        except Exception as e:
            logger.error(f"Error resetting hourly caps: {e}")
            return False

# Initialize the database-based stats system
try:
    # Set up the initial hour check
    last_hour_checked = datetime.datetime.now().hour
    logger.info("Stats system initialized using database")
except Exception as e:
    logger.error(f"Error initializing stats system: {e}")