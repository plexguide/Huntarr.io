"""Common settings extraction and validation for app modules."""

from src.primary.settings_manager import get_advanced_setting
from src.primary.apps._common.tagging import extract_tag_settings


def extract_app_settings(app_settings, app_type, hunt_key, default_instance_name=None):
    """Extract common settings from app_settings dict.

    Args:
        app_settings: Raw settings dict from background.py
        app_type: e.g. "radarr", "lidarr"
        hunt_key: e.g. "hunt_missing_movies", "hunt_upgrade_items"
        default_instance_name: Fallback instance name (e.g. "Radarr Default")

    Returns dict with normalized keys:
        api_url, api_key, api_timeout, instance_name, instance_key,
        hunt_count, monitored_only, skip_future_releases,
        tag_settings (dict from extract_tag_settings — the single source of truth),
        command_wait_delay, command_wait_attempts, exempt_tags
    """
    if default_instance_name is None:
        default_instance_name = f"{app_type.capitalize()} Default"

    instance_name = app_settings.get("instance_name", app_settings.get("name", default_instance_name))
    instance_key = app_settings.get("instance_id") or instance_name

    return {
        'api_url': app_settings.get("api_url", "").strip(),
        'api_key': app_settings.get("api_key", "").strip(),
        'api_timeout': app_settings.get("api_timeout", 120),
        'instance_name': instance_name,
        'instance_key': instance_key,
        'hunt_count': app_settings.get(hunt_key, 0),
        'monitored_only': app_settings.get("monitored_only", True),
        'skip_future_releases': app_settings.get("skip_future_releases", True),
        # Tag settings — single source of truth via tagging module
        'tag_settings': extract_tag_settings(app_settings),
        'command_wait_delay': get_advanced_setting("command_wait_delay", 1),
        'command_wait_attempts': get_advanced_setting("command_wait_attempts", 600),
        'exempt_tags': app_settings.get("exempt_tags") or [],
    }


def validate_settings(api_url, api_key, hunt_count, app_type, logger):
    """Common early-exit validation. Returns False if processing should stop.

    Checks:
        1. api_url and api_key are non-empty
        2. hunt_count > 0

    Args:
        api_url: API URL string
        api_key: API key string
        hunt_count: Number of items to hunt (0 = disabled)
        app_type: e.g. "radarr" (for log messages)
        logger: Logger instance

    Returns:
        True if validation passes and processing should continue,
        False if processing should stop.
    """
    if not api_url or not api_key:
        logger.error(
            "API URL or Key not configured for %s. Cannot process.", app_type
        )
        return False

    if hunt_count <= 0:
        logger.info(
            "Hunt count is 0 or less for %s. Skipping processing.", app_type
        )
        return False

    return True
