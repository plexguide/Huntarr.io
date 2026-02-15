"""
TV Hunt API – instances and configured instances for cycle/missing/upgrade.
TV Hunt does not use Sonarr API; instances come from the tv_hunt_instances table.
Per-instance hunt settings (missing/upgrade counts, state, etc.) come from app_config
tv_hunt_hunt_settings (same blueprint as Sonarr instance editor, minus connection).
"""

from typing import Dict, Any, List


def check_connection(api_url: str, api_key: str, api_timeout: int = 120) -> bool:
    """Stub: TV Hunt has no *arr API to check. Always return True so the cycle runs."""
    return True


def get_download_queue_size(api_url: str, api_key: str, api_timeout: int = 120) -> int:
    """Stub: TV Hunt uses its own indexers/clients. Return 0 so queue check is skipped."""
    return 0

# Config key for per-instance hunt settings (must match routes/tv_hunt/instances.py)
TV_HUNT_HUNT_SETTINGS_KEY = "tv_hunt_hunt_settings"


def _get_instance_hunt_settings(instance_id: int) -> Dict[str, Any]:
    """Get per-instance hunt settings for a TV Hunt instance (merged with defaults)."""
    from src.primary.utils.database import get_database
    from src.primary.default_settings import get_tv_hunt_instance_settings_defaults
    db = get_database()
    defaults = get_tv_hunt_instance_settings_defaults()
    saved = db.get_app_config_for_instance(TV_HUNT_HUNT_SETTINGS_KEY, instance_id)
    if not saved or not isinstance(saved, dict):
        return dict(defaults)
    return {k: saved.get(k, defaults[k]) for k in defaults}


def get_instances(quiet: bool = True) -> List[Dict[str, Any]]:
    """
    Get all TV Hunt instances from the database (tv_hunt_instances table).
    Used by code that needs the canonical instance list. TV Hunt has no api_url/api_key
    per instance; connection is via indexers/clients configured elsewhere.

    Returns:
        List of dicts with id, name, instance_name (same as name), instance_id (str(id)).
    """
    try:
        from src.primary.utils.database import get_database
        db = get_database()
        rows = db.get_tv_hunt_instances()
        return [
            {
                "id": r["id"],
                "name": r["name"],
                "instance_name": r["name"],
                "instance_id": str(r["id"]),
            }
            for r in rows
        ]
    except Exception:
        return []


def get_configured_instances(quiet: bool = False) -> List[Dict[str, Any]]:
    """
    Get all TV Hunt instances with their per-instance hunt settings (for background cycle).
    Same shape as Movie Hunt get_configured_instances but for TV shows.
    """
    try:
        from src.primary.utils.database import get_database
        db = get_database()
        rows = db.get_tv_hunt_instances()
        instances = []
        for r in rows:
            instance_id = r["id"]
            settings = _get_instance_hunt_settings(instance_id)
            if not settings.get("enabled", True):
                continue
            name = (r.get("name") or "").strip() or "Default"
            instance_details = {
                "instance_name": name,
                "instance_id": str(instance_id),
                "hunt_missing_episodes": settings.get("hunt_missing_episodes", 1),
                "hunt_upgrade_episodes": settings.get("hunt_upgrade_episodes", 0),
                "hunt_missing_mode": settings.get("hunt_missing_mode", "seasons_packs"),
                "upgrade_mode": settings.get("upgrade_mode", "seasons_packs"),
                "upgrade_selection_method": settings.get("upgrade_selection_method", "cutoff"),
                "upgrade_tag": settings.get("upgrade_tag", ""),
                "skip_future_episodes": settings.get("skip_future_episodes", True),
                "state_management_mode": settings.get("state_management_mode", "custom"),
                "state_management_hours": settings.get("state_management_hours", 72),
                "sleep_duration": settings.get("sleep_duration", 900),
                "hourly_cap": settings.get("hourly_cap", 20),
                "exempt_tags": settings.get("exempt_tags") or [],
                "api_timeout": settings.get("api_timeout", 120),
                "command_wait_delay": settings.get("command_wait_delay", 1),
                "command_wait_attempts": settings.get("command_wait_attempts", 600),
                "max_download_queue_size": settings.get("max_download_queue_size", -1),
                "max_seed_queue_size": settings.get("max_seed_queue_size", -1),
                "seed_check_torrent_client": settings.get("seed_check_torrent_client"),
                "monitored_only": settings.get("monitored_only", True),
                "tag_processed_items": settings.get("tag_processed_items", False),
                "tag_enable_missing": settings.get("tag_enable_missing", False),
                "tag_enable_upgrade": settings.get("tag_enable_upgrade", False),
                "tag_enable_upgraded": settings.get("tag_enable_upgraded", False),
                "custom_tags": settings.get("custom_tags") or {},
            }
            instances.append(instance_details)
        return instances
    except Exception as e:
        if not quiet:
            try:
                from src.primary.utils.logger import get_logger
                get_logger("tv_hunt").warning("get_configured_instances failed: %s", e)
            except Exception:
                pass
        return []
