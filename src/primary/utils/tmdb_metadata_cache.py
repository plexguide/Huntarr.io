"""
TMDB metadata cache — reduces API load for detail pages (actors, air dates, etc.).

Smart TTL logic:
- Ended TV series: 7 days (metadata finalized)
- Continuing TV series: 24 hours
- TV seasons: same as parent series when known, else 24 hours
- Old movies (2+ years): 7 days
- Recent movies: 24 hours
"""

import threading
import time
from datetime import datetime, timezone
from typing import Any, Dict, Optional

# TTL in seconds
CACHE_TTL_ACTIVE = 24 * 3600   # 24 hours — continuing shows, recent movies
CACHE_TTL_STATIC = 7 * 24 * 3600  # 7 days — ended shows, old movies

_CACHE: Dict[str, tuple[Any, float]] = {}
_CACHE_LOCK = threading.Lock()
_MAX_ENTRIES = 2000


def _cache_key(media_type: str, tmdb_id: int, extra: str = "") -> str:
    base = f"{media_type}:{tmdb_id}"
    return f"{base}:{extra}" if extra else base


def _ttl_for_tv_series(data: dict) -> int:
    """Return TTL in seconds based on series status."""
    status = (data.get("status") or "").strip()
    if status == "Ended":
        return CACHE_TTL_STATIC
    return CACHE_TTL_ACTIVE


def _ttl_for_movie(data: dict) -> int:
    """Return TTL in seconds based on movie age."""
    release = (data.get("release_date") or "")[:10]
    if not release:
        return CACHE_TTL_ACTIVE
    try:
        year = int(release.split("-")[0])
        if year <= datetime.now(timezone.utc).year - 2:
            return CACHE_TTL_STATIC
    except (ValueError, IndexError):
        pass
    return CACHE_TTL_ACTIVE


def _ttl_for_tv_season(series_data: Optional[dict]) -> int:
    """Return TTL for a season (inherits from series if available)."""
    if series_data:
        return _ttl_for_tv_series(series_data)
    return CACHE_TTL_ACTIVE


def get(media_type: str, tmdb_id: int, extra: str = "") -> Optional[Any]:
    """Return cached data if valid, else None."""
    key = _cache_key(media_type, tmdb_id, extra)
    with _CACHE_LOCK:
        entry = _CACHE.get(key)
        if not entry:
            return None
        data, expiry = entry
        if time.time() > expiry:
            del _CACHE[key]
            return None
        return data


def set_movie(tmdb_id: int, data: dict) -> None:
    """Cache movie detail. TTL based on release year."""
    key = _cache_key("movie", tmdb_id)
    ttl = _ttl_for_movie(data)
    with _CACHE_LOCK:
        _evict_if_needed()
        _CACHE[key] = (data, time.time() + ttl)


def set_tv_series(tmdb_id: int, data: dict) -> None:
    """Cache TV series detail. TTL based on status (Ended vs Continuing)."""
    key = _cache_key("tv", tmdb_id)
    ttl = _ttl_for_tv_series(data)
    with _CACHE_LOCK:
        _evict_if_needed()
        _CACHE[key] = (data, time.time() + ttl)


def set_tv_season(tmdb_id: int, season_number: int, data: dict, series_data: Optional[dict] = None) -> None:
    """Cache TV season detail. TTL inherits from series if provided."""
    key = _cache_key("tv", tmdb_id, f"season:{season_number}")
    ttl = _ttl_for_tv_season(series_data)
    with _CACHE_LOCK:
        _evict_if_needed()
        _CACHE[key] = (data, time.time() + ttl)


def _evict_if_needed() -> None:
    """Evict oldest entries if over limit."""
    if len(_CACHE) < _MAX_ENTRIES:
        return
    # Remove expired first
    now = time.time()
    expired = [k for k, (_, exp) in _CACHE.items() if exp <= now]
    for k in expired:
        del _CACHE[k]
    if len(_CACHE) < _MAX_ENTRIES:
        return
    # Evict oldest by expiry
    sorted_keys = sorted(_CACHE.keys(), key=lambda k: _CACHE[k][1])
    to_remove = len(sorted_keys) - _MAX_ENTRIES
    for k in sorted_keys[: to_remove + 1]:
        del _CACHE[k]


