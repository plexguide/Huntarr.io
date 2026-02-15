"""
Unified tagging logic for all Huntarr app modules.

This is the SINGLE SOURCE OF TRUTH for all tag-related decisions and operations.
Every app (Sonarr, Radarr, Lidarr, Readarr, Whisparr, Eros) must use these
helpers instead of inline tag logic.

Tag types:
    - "missing"        : Applied after a missing item search
    - "upgrade"        : Applied after a cutoff upgrade search
    - "upgraded"       : Applied after a cutoff upgrade search (legacy alias)
    - "shows_missing"  : Applied after a Sonarr show-level missing search

Default tag labels:
    - missing       -> "huntarr-missing"
    - upgrade       -> "huntarr-upgrade"
    - upgraded      -> "huntarr-upgraded"
    - shows_missing -> "huntarr-shows-missing"
"""

# ── Canonical defaults ──────────────────────────────────────────
DEFAULT_TAG_LABELS = {
    "missing":        "huntarr-missing",
    "upgrade":        "huntarr-upgrade",
    "upgraded":       "huntarr-upgraded",
    "shows_missing":  "huntarr-shows-missing",
}

# Maps each tag_type to the enable key it depends on
_TAG_ENABLE_KEYS = {
    "missing":        "tag_enable_missing",
    "upgrade":        "tag_enable_upgrade",
    "upgraded":       "tag_enable_upgraded",
    "shows_missing":  "tag_enable_shows_missing",
}


def extract_tag_settings(app_settings):
    """Extract all tag-related settings from an app_settings dict.

    This is the ONE place that decides defaults.  Every consumer should
    call this rather than reading tag keys directly.

    Args:
        app_settings: The combined settings dict for an instance.

    Returns:
        dict with keys:
            enabled              (bool) – master toggle
            tag_enable_missing   (bool)
            tag_enable_upgrade   (bool)
            tag_enable_upgraded  (bool)
            tag_enable_shows_missing (bool)
            custom_tags          (dict) – e.g. {"missing": "huntarr-missing", ...}
    """
    return {
        "enabled":                  bool(app_settings.get("tag_processed_items", False)),
        "tag_enable_missing":       bool(app_settings.get("tag_enable_missing", False)),
        "tag_enable_upgrade":       bool(app_settings.get("tag_enable_upgrade", False)),
        "tag_enable_upgraded":      bool(app_settings.get("tag_enable_upgraded", False)),
        "tag_enable_shows_missing": bool(app_settings.get("tag_enable_shows_missing", False)),
        "custom_tags":              app_settings.get("custom_tags") or {},
    }


def is_tag_enabled(tag_settings, tag_type):
    """Check whether a specific tag type should be applied.

    Args:
        tag_settings: Dict returned by extract_tag_settings().
        tag_type: One of "missing", "upgrade", "upgraded", "shows_missing".

    Returns:
        True if the master toggle AND the per-type toggle are both on.
    """
    if not tag_settings.get("enabled", False):
        return False
    enable_key = _TAG_ENABLE_KEYS.get(tag_type)
    if not enable_key:
        return False
    return bool(tag_settings.get(enable_key, False))


def get_tag_label(tag_settings, tag_type):
    """Return the custom tag label for a tag type, falling back to defaults.

    Args:
        tag_settings: Dict returned by extract_tag_settings().
        tag_type: One of "missing", "upgrade", "upgraded", "shows_missing".

    Returns:
        str – the tag label to use.
    """
    custom = tag_settings.get("custom_tags") or {}
    label = custom.get(tag_type, "")
    if not label:
        label = DEFAULT_TAG_LABELS.get(tag_type, f"huntarr-{tag_type}")
    return label


def try_tag_item(tag_settings, tag_type, tag_func,
                 api_url, api_key, api_timeout, item_id,
                 logger, item_desc="item"):
    """Apply a tag to an item if the tag type is enabled.

    Encapsulates the check-then-tag-with-error-handling pattern that was
    previously duplicated in every app's missing.py / upgrade.py.

    Args:
        tag_settings: Dict returned by extract_tag_settings().
        tag_type:     One of "missing", "upgrade", "upgraded", "shows_missing".
        tag_func:     Callable(api_url, api_key, api_timeout, item_id, tag_label) -> bool
                      e.g. radarr_api.tag_processed_movie
        api_url, api_key, api_timeout: API connection params.
        item_id:      ID of the item to tag (movie, series, artist, author).
        logger:       Logger instance for debug/warning messages.
        item_desc:    Human-readable description for log messages
                      (e.g. "movie 123", "series 456").

    Returns:
        True if the tag was applied, False if skipped or failed.
    """
    if not is_tag_enabled(tag_settings, tag_type):
        return False

    label = get_tag_label(tag_settings, tag_type)
    try:
        tag_func(api_url, api_key, api_timeout, item_id, label)
        logger.debug(f"Tagged {item_desc} with '{label}'")
        return True
    except Exception as e:
        logger.warning(f"Failed to tag {item_desc} with '{label}': {e}")
        return False
