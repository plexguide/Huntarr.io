"""Shared Arr API utilities: check_connection used by Sonarr, Radarr, Lidarr, Readarr."""

import requests
from src.primary.settings_manager import get_ssl_verify_setting

# API version: v3 for Sonarr/Radarr/Whisparr/Eros, v1 for Lidarr/Readarr
ARR_API_VERSIONS = {
    "sonarr": "v3",
    "radarr": "v3",
    "lidarr": "v1",
    "readarr": "v1",
    "whisparr": "v3",
    "eros": "v3",
}


def check_connection(
    api_url: str,
    api_key: str,
    api_timeout: int,
    app_type: str,
    logger,
    api_version: str = None,
) -> bool:
    """Check connection to an Arr API by fetching system/status.

    Args:
        api_url: Base API URL
        api_key: API key
        api_timeout: Request timeout (uses min(api_timeout, 15) for quick check)
        app_type: e.g. "radarr" (for logging)
        logger: App logger instance
        api_version: "v1" or "v3". Defaults from ARR_API_VERSIONS[app_type].

    Returns:
        True if connection succeeds and response has 'version', False otherwise.
    """
    if not api_url:
        logger.error("API URL is empty or not set")
        return False
    if not api_key:
        logger.error("API Key is empty or not set")
        return False
    if not (api_url.startswith("http://") or api_url.startswith("https://")):
        logger.error(f"Invalid URL format: {api_url} - URL must start with http:// or https://")
        return False

    version = api_version or ARR_API_VERSIONS.get(app_type, "v3")
    quick_timeout = min(api_timeout, 15)
    base_url = api_url.rstrip("/")
    full_url = f"{base_url}/api/{version}/system/status"
    headers = {
        "X-Api-Key": api_key,
        "Content-Type": "application/json",
        "User-Agent": "Huntarr/1.0 (https://github.com/plexguide/Huntarr.io)",
    }
    verify_ssl = get_ssl_verify_setting()

    try:
        response = requests.get(full_url, headers=headers, timeout=quick_timeout, verify=verify_ssl)
        response.raise_for_status()
        data = response.json() if response.content else {}
        if isinstance(data, dict) and "version" in data:
            logger.debug(f"Connection check successful for {api_url}. Version: {data.get('version')}")
            return True
        logger.warning(f"Connection check for {api_url} returned unexpected status: {str(data)[:200]}")
        return False
    except requests.exceptions.RequestException as e:
        logger.error(f"Error connecting to {app_type}: {e}")
        return False
    except Exception as e:
        logger.error(f"An unexpected error during {app_type} connection check: {e}")
        return False
