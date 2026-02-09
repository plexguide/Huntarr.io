"""
Movie Hunt API – instances and configured instances for cycle/missing/upgrade.
Movie Hunt does not use Radarr API; instances come from the movie_hunt_instances table.
Per-instance hunt settings (missing/upgrade counts, state, etc.) come from app_config
movie_hunt_hunt_settings (same blueprint as Radarr instance editor, minus connection).
"""

from typing import Dict, Any, List

# Config key for per-instance hunt settings (must match routes/movie_hunt/instances.py)
MOVIE_HUNT_HUNT_SETTINGS_KEY = "movie_hunt_hunt_settings"


def _get_instance_hunt_settings(instance_id: int) -> Dict[str, Any]:
    """Get per-instance hunt settings for a Movie Hunt instance (merged with defaults)."""
    from src.primary.utils.database import get_database
    from src.primary.default_settings import get_movie_hunt_instance_settings_defaults
    db = get_database()
    defaults = get_movie_hunt_instance_settings_defaults()
    saved = db.get_app_config_for_instance(MOVIE_HUNT_HUNT_SETTINGS_KEY, instance_id)
    if not saved or not isinstance(saved, dict):
        return dict(defaults)
    return {k: saved.get(k, defaults[k]) for k in defaults}


def get_instances(quiet: bool = True) -> List[Dict[str, Any]]:
    """
    Get all Movie Hunt instances from the database (movie_hunt_instances table).
    Used by code that needs the canonical instance list. Movie Hunt has no api_url/api_key
    per instance; connection is via indexers/clients configured elsewhere.

    Returns:
        List of dicts with id, name, instance_name (same as name), instance_id (str(id)).
    """
    try:
        from src.primary.utils.database import get_database
        db = get_database()
        rows = db.get_movie_hunt_instances()
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
    Get all Movie Hunt instances with their per-instance hunt settings (for background cycle).
    Same shape as Radarr get_configured_instances but without api_url, api_key (Movie Hunt
    uses its own indexers/clients). Used when Movie Hunt is added to the cyclical loop.
    """
    try:
        from src.primary.utils.database import get_database
        db = get_database()
        rows = db.get_movie_hunt_instances()
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
                "hunt_missing_movies": settings.get("hunt_missing_movies", 1),
                "hunt_upgrade_movies": settings.get("hunt_upgrade_movies", 0),
                "upgrade_selection_method": settings.get("upgrade_selection_method", "cutoff"),
                "upgrade_tag": settings.get("upgrade_tag", ""),
                "release_date_delay_days": settings.get("release_date_delay_days", 0),
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
                "tag_processed_items": settings.get("tag_processed_items", True),
                "tag_enable_missing": settings.get("tag_enable_missing", True),
                "tag_enable_upgrade": settings.get("tag_enable_upgrade", True),
                "tag_enable_upgraded": settings.get("tag_enable_upgraded", True),
                "custom_tags": settings.get("custom_tags") or {},
            }
            instances.append(instance_details)
        return instances
    except Exception as e:
        if not quiet:
            try:
                from src.primary.utils.logger import get_logger
                get_logger("movie_hunt").warning("get_configured_instances failed: %s", e)
            except Exception:
                pass
        return []
