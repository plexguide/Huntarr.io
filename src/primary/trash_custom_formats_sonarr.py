"""
TRaSH Guides Sonarr custom formats: categories, subcategories, and format JSON.
Data from https://trash-guides.info/Sonarr/sonarr-collection-of-custom-formats/
"""
import json
import os
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

# In-memory cache of loaded data
_TRASH_DATA = None
_TRASH_DATA_PATH = None


def _data_path():
    global _TRASH_DATA_PATH
    if _TRASH_DATA_PATH is None:
        _TRASH_DATA_PATH = Path(__file__).parent / "data" / "trash_custom_formats_sonarr.json"
    return _TRASH_DATA_PATH


def _load_trash_data():
    global _TRASH_DATA
    if _TRASH_DATA is not None:
        return _TRASH_DATA
    path = _data_path()
    if not path.exists():
        logger.warning("TRaSH Sonarr custom formats data not found: %s", path)
        _TRASH_DATA = {"categories": [], "format_json_by_id": {}}
        return _TRASH_DATA
    try:
        with open(path, "r", encoding="utf-8") as f:
            _TRASH_DATA = json.load(f)
    except Exception as e:
        logger.exception("Failed to load TRaSH Sonarr custom formats: %s", e)
        _TRASH_DATA = {"categories": [], "format_json_by_id": {}}
    return _TRASH_DATA


def _build_preformat_id(cat_id, sub_id, fmt_id):
    """Build unique preformat_id: category.format or category.subcategory.format."""
    if sub_id:
        return "{}.{}.{}".format(cat_id, sub_id, fmt_id)
    return "{}.{}".format(cat_id, fmt_id)


def get_trash_categories():
    """
    Return categories with subcategories and formats. Each format has id (preformat_id) and name.
    Structure: [ { "id", "name", "formats": [ { "id", "name" } ] } ] for simple categories,
    or [ { "id", "name", "subcategories": [ { "id", "name", "formats": [ { "id", "name" } ] } ] } ].
    """
    data = _load_trash_data()
    return data.get("categories") or []


def get_trash_format_json(preformat_id):
    """Return Sonarr custom format JSON string for preformat_id, or None if not found."""
    data = _load_trash_data()
    by_id = data.get("format_json_by_id") or {}
    obj = by_id.get(preformat_id)
    if obj is None:
        return None
    if isinstance(obj, dict):
        return json.dumps(obj)
    if isinstance(obj, str):
        return obj
    return None


def get_trash_format_name(preformat_id):
    """Return display name for preformat_id by scanning categories, or None."""
    for cat in get_trash_categories():
        cat_id = cat.get("id") or ""
        for fmt in cat.get("formats") or []:
            fid = _build_preformat_id(cat_id, None, fmt.get("id") or "")
            if fid == preformat_id:
                return fmt.get("name") or preformat_id
        for sub in cat.get("subcategories") or []:
            sub_id = sub.get("id") or ""
            for fmt in sub.get("formats") or []:
                fid = _build_preformat_id(cat_id, sub_id, fmt.get("id") or "")
                if fid == preformat_id:
                    return fmt.get("name") or preformat_id
    return None


def get_all_preformat_ids():
    """Return list of all preformat_id strings (for backward compat / listing)."""
    ids = []
    for cat in get_trash_categories():
        cat_id = cat.get("id") or ""
        for fmt in cat.get("formats") or []:
            ids.append(_build_preformat_id(cat_id, None, fmt.get("id") or ""))
        for sub in cat.get("subcategories") or []:
            sub_id = sub.get("id") or ""
            for fmt in sub.get("formats") or []:
                ids.append(_build_preformat_id(cat_id, sub_id, fmt.get("id") or ""))
    return ids
