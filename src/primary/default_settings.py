"""
Default configuration settings for Huntarr applications.

This module contains all default settings for each application type.
These defaults are used when initializing a fresh database.
"""

from typing import Dict, Any


def get_default_instance_config(app_type: str) -> Dict[str, Any]:
    """
    Get default instance configuration for a given app type.
    
    Args:
        app_type: The application type (sonarr, radarr, lidarr, etc.)
        
    Returns:
        Dictionary containing default instance settings
    """
    base_instance = {
        "name": "Default",
        "api_url": "",
        "api_key": "",
        "enabled": False,
        "state_management_mode": "custom",
        "state_management_hours": 72,
        "monitored_only": True,
        "tag_processed_items": True,
        "tag_enable_missing": True,
        "tag_enable_upgrade": True,
        "tag_enable_upgraded": True,
        "custom_tags": {
            "missing": "huntarr-missing",
            "upgrade": "huntarr-upgrade"
        },
        "exempt_tags": [],  # Tags to skip for missing/upgrade (issue #676)
        # Advanced settings (per-instance)
        "api_timeout": 120,
        "command_wait_delay": 1,
        "command_wait_attempts": 600,
        "max_download_queue_size": -1,
        # Max seed queue (torrents only): skip hunts when active seeding count >= this (-1 = disabled). Requires seed_check_torrent_client.
        "max_seed_queue_size": -1,
        "seed_check_torrent_client": None,  # Optional: {"type": "qbittorrent"|"transmission", "host", "port", "username", "password"}
        # Cycle settings (per-instance; were global in 9.0.x)
        "sleep_duration": 900,
        "hourly_cap": 20
    }
    
    # Add app-specific fields
    if app_type == "sonarr":
        base_instance.update({
            "hunt_missing_items": 1,
            "hunt_upgrade_items": 0,
            "hunt_missing_mode": "seasons_packs",
            "upgrade_mode": "seasons_packs",
            "upgrade_selection_method": "cutoff",
            "upgrade_tag": "upgradinatorr",
            "skip_future_episodes": True,
            "tag_enable_shows_missing": True,
            "custom_tags": {
                "missing": "huntarr-missing",
                "upgrade": "huntarr-upgrade",
                "shows_missing": "huntarr-shows-missing"
            }
        })
    elif app_type == "radarr":
        base_instance.update({
            "hunt_missing_movies": 1,
            "hunt_upgrade_movies": 0,
            "upgrade_selection_method": "cutoff",
            "upgrade_tag": "upgradinatorr",
        })
    elif app_type == "lidarr":
        base_instance.update({
            "hunt_missing_items": 1,
            "hunt_upgrade_items": 0,
            "upgrade_selection_method": "cutoff",
            "upgrade_tag": "upgradinatorr",
        })
    elif app_type == "readarr":
        base_instance.update({
            "hunt_missing_books": 1,
            "hunt_upgrade_books": 0,
            "upgrade_selection_method": "cutoff",
            "upgrade_tag": "upgradinatorr",
        })
    elif app_type in ["whisparr", "eros"]:
        base_instance.update({
            "hunt_missing_items": 1,
            "hunt_upgrade_items": 0,
        })
    
    return base_instance


def get_movie_hunt_instance_settings_defaults() -> Dict[str, Any]:
    """
    Default per-instance settings for Movie Hunt (same as Radarr instance minus connection).
    Used for hunt/upgrade/state/cycle; no api_url, api_key, enabled, name (those come from movie_hunt_instances).
    """
    base = get_default_instance_config("radarr")
    # Drop connection-related keys; keep search, stateful, additional.
    # Movie Hunt instances default to enabled (unlike Radarr which defaults to false until API is set).
    out = {
        "enabled": True,
        "hunt_missing_movies": base.get("hunt_missing_movies", 1),
        "hunt_upgrade_movies": base.get("hunt_upgrade_movies", 0),
        "upgrade_selection_method": (base.get("upgrade_selection_method") or "cutoff").strip().lower(),
        "upgrade_tag": (base.get("upgrade_tag") or "").strip(),
        "release_date_delay_days": base.get("release_date_delay_days", 0),
        "state_management_mode": base.get("state_management_mode", "custom"),
        "state_management_hours": base.get("state_management_hours", 72),
        "sleep_duration": base.get("sleep_duration", 900),
        "hourly_cap": base.get("hourly_cap", 20),
        "exempt_tags": base.get("exempt_tags") or [],
        "api_timeout": base.get("api_timeout", 120),
        "command_wait_delay": base.get("command_wait_delay", 1),
        "command_wait_attempts": base.get("command_wait_attempts", 600),
        "max_download_queue_size": base.get("max_download_queue_size", -1),
        "max_seed_queue_size": base.get("max_seed_queue_size", -1),
        "seed_check_torrent_client": base.get("seed_check_torrent_client"),
        "monitored_only": base.get("monitored_only", True),
        "tag_processed_items": base.get("tag_processed_items", True),
        "tag_enable_missing": base.get("tag_enable_missing", True),
        "tag_enable_upgrade": base.get("tag_enable_upgrade", True),
        "tag_enable_upgraded": base.get("tag_enable_upgraded", True),
        "custom_tags": dict(base.get("custom_tags") or {}),
        "analyze_video_files": True,
        "video_scan_profile": "default",
    }
    return out


# Movie Hunt default configuration (no instances list; uses movie_hunt_instances table)
MOVIE_HUNT_DEFAULTS = {
    "sleep_duration": 900,
    "hourly_cap": 20
}

# Sonarr default configuration
SONARR_DEFAULTS = {
    "instances": [],  # No default instances - user creates first instance
    "sleep_duration": 900,
    "hourly_cap": 20
}

# Radarr default configuration
RADARR_DEFAULTS = {
    "instances": [],  # No default instances - user creates first instance
    "sleep_duration": 900,
    "hourly_cap": 20
}

# Lidarr default configuration
LIDARR_DEFAULTS = {
    "instances": [],  # No default instances - user creates first instance
    "hunt_missing_mode": "album",
    "sleep_duration": 900,
    "hourly_cap": 20,
    "skip_future_releases": True
}

# Readarr default configuration
READARR_DEFAULTS = {
    "instances": [],  # No default instances - user creates first instance
    "sleep_duration": 900,
    "skip_future_releases": True,
    "hourly_cap": 20
}

# Whisparr default configuration
WHISPARR_DEFAULTS = {
    "instances": [],  # No default instances - user creates first instance
    "sleep_duration": 900,
    "skip_future_releases": True,
    "hourly_cap": 20
}

# Eros default configuration
EROS_DEFAULTS = {
    "instances": [],  # No default instances - user creates first instance
    "search_mode": "movie",
    "sleep_duration": 900,
    "skip_future_releases": True,
    "hourly_cap": 20
}

# Prowlarr default configuration
PROWLARR_DEFAULTS = {
    "name": "Prowlarr",
    "api_url": "",
    "api_key": "",
    "enabled": False
}

# Swaparr default configuration
SWAPARR_DEFAULTS = {
    "enabled": False,
    "max_strikes": 3,
    "max_download_time": "2h",
    "ignore_above_size": "25GB",
    "remove_from_client": True,
    "dry_run": False,
    "ignore_usenet_queued": True,
    "remove_completed_stalled": True,
    "sleep_duration": 900,
    "malicious_file_detection": False,
    "malicious_extensions": [
        ".lnk", ".exe", ".bat", ".cmd", ".scr", ".pif", ".com", 
        ".zipx", ".jar", ".vbs", ".js", ".jse", ".wsf", ".wsh"
    ],
    "suspicious_patterns": [
        "password.txt", "readme.txt", "install.exe", "setup.exe",
        "keygen", "crack", "patch.exe", "activator"
    ],
    "age_based_removal": False,
    "max_age_days": 7,
    "quality_based_removal": False,
    "blocked_quality_patterns": [
        "cam", "camrip", "hdcam", "ts", "telesync", "tc", "telecine",
        "r6", "dvdscr", "dvdscreener", "workprint", "wp"
    ]
}

# General settings default configuration
GENERAL_DEFAULTS = {
    "tmdb_image_cache_days": 30,
    "display_community_resources": True,
    "display_huntarr_support": True,
    "log_refresh_interval_seconds": 30,
    "ui_theme": "dark",
    "check_for_updates": True,
    "enable_requestarr": True,
    "show_trending": True,
    "low_usage_mode": True,
    "enable_notifications": False,
    "notification_level": "info",
    "apprise_urls": [],
    "notify_on_missing": True,
    "notify_on_upgrade": True,
    "notification_include_instance": True,
    "notification_include_app": True,
    "local_access_bypass": False,
    "proxy_auth_bypass": False,
    "stateful_management_hours": 72,
    "command_wait_delay": 1,
    "command_wait_attempts": 600,
    "minimum_download_queue_size": -1,
    "ssl_verify": True,
    "base_url": "",
    "dev_key": "",
    "log_rotation_enabled": True,
    "log_max_size_mb": 50,
    "log_backup_count": 5,
    "log_retention_days": 30,
    "log_auto_cleanup": True,
    "log_max_entries_per_app": 10000,
    "enable_debug_logs": True,
    "web_server_threads": 8,
    "ui_preferences": {}
}


def get_default_config(app_type: str) -> Dict[str, Any]:
    """
    Get default configuration for a given app type.
    
    Args:
        app_type: The application type (sonarr, radarr, lidarr, readarr, 
                  whisparr, eros, prowlarr, swaparr, or general)
                  
    Returns:
        Dictionary containing default configuration for the app type
        
    Raises:
        ValueError: If app_type is not recognized
    """
    defaults_map = {
        'sonarr': SONARR_DEFAULTS,
        'radarr': RADARR_DEFAULTS,
        'lidarr': LIDARR_DEFAULTS,
        'readarr': READARR_DEFAULTS,
        'whisparr': WHISPARR_DEFAULTS,
        'eros': EROS_DEFAULTS,
        'prowlarr': PROWLARR_DEFAULTS,
        'swaparr': SWAPARR_DEFAULTS,
        'movie_hunt': MOVIE_HUNT_DEFAULTS,
        'general': GENERAL_DEFAULTS
    }
    
    if app_type not in defaults_map:
        raise ValueError(f"Unknown app type: {app_type}")
    
    # Return a deep copy to prevent modifications to the original
    import copy
    return copy.deepcopy(defaults_map[app_type])


def get_all_app_types() -> list:
    """Get list of all supported app types."""
    return ['sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros', 'swaparr', 'prowlarr', 'general']
