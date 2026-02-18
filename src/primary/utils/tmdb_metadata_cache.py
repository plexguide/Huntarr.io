"""
TMDB metadata cache — reduces API load for detail pages, discover, search, etc.

INTEGRATION WITH 18-HOUR METADATA REFRESH (metadata_refresh.py):
- The background metadata refresh updates collection data (episode titles, air dates,
  series status, movie release dates) every 18 hours.
- When metadata refresh updates an item, it calls invalidate_*() here so the detail
  page cache is cleared. Next time the user opens that movie/TV detail, fresh data
  is fetched and cached.
- This keeps the cache and the collection in sync: refreshed collection data is
  reflected in the UI when users open detail pages.
- See metadata_refresh.py docstring for the refresh schedule and skip logic.

SERVER-SIDE ONLY: All cache data lives in process memory on the server. No localStorage,
sessionStorage, or any client-side storage. This ensures:
- Consistent cache across page refreshes
- Same cache when using multiple devices/browsers
- No stale client-side data

Smart TTL logic:
- Ended TV series: 7 days (metadata finalized)
- Continuing TV series: 24 hours
- TV seasons: same as parent series when known, else 24 hours
- Old movies (2+ years): 7 days
- Recent movies: 24 hours
- Release dates: 24 hours
- Discover: 2 hours
- Search: 1 hour
- Genre list: 24 hours
"""

import hashlib
import threading
import time
from datetime import datetime, timezone
from typing import Any, Dict, Optional

# TTL in seconds
CACHE_TTL_ACTIVE = 24 * 3600   # 24 hours — continuing shows, recent movies
CACHE_TTL_STATIC = 7 * 24 * 3600  # 7 days — ended shows, old movies
CACHE_TTL_RELEASE_DATES = 24 * 3600   # 24 hours
CACHE_TTL_DISCOVER = 2 * 3600   # 2 hours
CACHE_TTL_SEARCH = 1 * 3600   # 1 hour
CACHE_TTL_GENRE = 24 * 3600   # 24 hours
CACHE_TTL_WATCH_PROVIDERS = 24 * 3600   # 24 hours
CACHE_TTL_FIND = 24 * 3600   # 24 hours (find by imdb/tvdb)

_CACHE: Dict[str, tuple[Any, float]] = {}
_CACHE_LOCK = threading.Lock()
_MAX_ENTRIES = 4000


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


# ── Invalidation (called by 18-hour metadata refresh when it updates items) ──

def invalidate_movie(tmdb_id: int) -> None:
    """
    Invalidate cached movie data. Call when metadata refresh updates a movie.
    Ensures detail page shows fresh data after the 18-hour refresh cycle.
    """
    with _CACHE_LOCK:
        for key in (f"movie:{tmdb_id}", f"release_dates:{tmdb_id}"):
            _CACHE.pop(key, None)


def invalidate_tv_series(tmdb_id: int) -> None:
    """
    Invalidate cached TV series and all its seasons. Call when metadata refresh
    updates a series. Ensures detail page shows fresh data after the 18-hour
    refresh cycle.
    """
    with _CACHE_LOCK:
        to_del = [k for k in _CACHE if k == f"tv:{tmdb_id}" or k.startswith(f"tv:{tmdb_id}:")]
        for k in to_del:
            del _CACHE[k]


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


# ── Release dates cache ──

def get_release_dates(tmdb_id: int) -> Optional[Dict[str, str]]:
    """Return cached release dates for a movie, or None."""
    return get("release_dates", tmdb_id)


def set_release_dates(tmdb_id: int, data: Dict[str, str]) -> None:
    """Cache release dates for a movie."""
    key = _cache_key("release_dates", tmdb_id)
    with _CACHE_LOCK:
        _evict_if_needed()
        _CACHE[key] = (data, time.time() + CACHE_TTL_RELEASE_DATES)


# ── Query cache (discover, search, genre) ──

def _query_key(prefix: str, *parts: str) -> str:
    """Build a cache key from prefix and parts. Long params are hashed."""
    joined = ":".join(str(p) for p in parts if p is not None)
    if len(joined) > 120:
        h = hashlib.sha256(joined.encode()).hexdigest()[:16]
        return f"{prefix}:{h}"
    return f"{prefix}:{joined}"


def get_discover(media_type: str, params: Dict[str, Any]) -> Optional[Dict]:
    """Return cached discover response."""
    parts = [f"p:{params.get('page', 1)}", f"s:{params.get('sort_by', '')}"]
    for k in sorted(params.keys()):
        if k not in ("api_key", "page"):
            v = params.get(k)
            if v is not None:
                parts.append(f"{k}:{v}")
    key = _query_key("disc", media_type, *parts)
    with _CACHE_LOCK:
        entry = _CACHE.get(key)
        if not entry:
            return None
        data, expiry = entry
        if time.time() > expiry:
            del _CACHE[key]
            return None
        return data


def set_discover(media_type: str, params: Dict[str, Any], data: Dict) -> None:
    """Cache discover response."""
    parts = [f"p:{params.get('page', 1)}", f"s:{params.get('sort_by', '')}"]
    for k in sorted(params.keys()):
        if k not in ("api_key", "page"):
            v = params.get(k)
            if v is not None:
                parts.append(f"{k}:{v}")
    key = _query_key("disc", media_type, *parts)
    with _CACHE_LOCK:
        _evict_if_needed()
        _CACHE[key] = (data, time.time() + CACHE_TTL_DISCOVER)


def get_search(media_type: str, query: str) -> Optional[Dict]:
    """Return cached search response."""
    q = (query or "").strip().lower()[:100]
    key = _query_key("search", media_type, q)
    with _CACHE_LOCK:
        entry = _CACHE.get(key)
        if not entry:
            return None
        data, expiry = entry
        if time.time() > expiry:
            del _CACHE[key]
            return None
        return data


def set_search(media_type: str, query: str, data: Dict) -> None:
    """Cache search response."""
    q = (query or "").strip().lower()[:100]
    key = _query_key("search", media_type, q)
    with _CACHE_LOCK:
        _evict_if_needed()
        _CACHE[key] = (data, time.time() + CACHE_TTL_SEARCH)


def get_genres(media_type: str) -> Optional[list]:
    """Return cached genre list."""
    key = _query_key("genre", media_type)
    with _CACHE_LOCK:
        entry = _CACHE.get(key)
        if not entry:
            return None
        data, expiry = entry
        if time.time() > expiry:
            del _CACHE[key]
            return None
        return data


def set_genres(media_type: str, data: list) -> None:
    """Cache genre list."""
    key = _query_key("genre", media_type)
    with _CACHE_LOCK:
        _evict_if_needed()
        _CACHE[key] = (data, time.time() + CACHE_TTL_GENRE)


# ── Watch providers cache ──

def get_watch_providers(media_type: str, region: str = "") -> Optional[list]:
    """Return cached watch providers list."""
    key = _query_key("providers", media_type, region or "all")
    with _CACHE_LOCK:
        entry = _CACHE.get(key)
        if not entry:
            return None
        data, expiry = entry
        if time.time() > expiry:
            del _CACHE[key]
            return None
        return data


def set_watch_providers(media_type: str, region: str, data: list) -> None:
    """Cache watch providers list."""
    key = _query_key("providers", media_type, region or "all")
    with _CACHE_LOCK:
        _evict_if_needed()
        _CACHE[key] = (data, time.time() + CACHE_TTL_WATCH_PROVIDERS)


# ── Find by external ID cache (imdb_id, tvdb_id) ──

def get_find(source: str, ext_id: str) -> Optional[Dict]:
    """Return cached find result. source: 'imdb', 'imdb_tv', 'tvdb'."""
    key = _query_key("find", source, ext_id)
    with _CACHE_LOCK:
        entry = _CACHE.get(key)
        if not entry:
            return None
        data, expiry = entry
        if time.time() > expiry:
            del _CACHE[key]
            return None
        return data


def set_find(source: str, ext_id: str, data: Dict) -> None:
    """Cache find result."""
    key = _query_key("find", source, ext_id)
    with _CACHE_LOCK:
        _evict_if_needed()
        _CACHE[key] = (data, time.time() + CACHE_TTL_FIND)


# ── List response cache (movie/popular, movie/list/xxx, etc.) ──

def get_list(key: str) -> Optional[Dict]:
    """Return cached list response. key e.g. 'movie:popular:1' or 'movie:list:123:2'."""
    k = _query_key("list", key)
    with _CACHE_LOCK:
        entry = _CACHE.get(k)
        if not entry:
            return None
        data, expiry = entry
        if time.time() > expiry:
            del _CACHE[k]
            return None
        return data


def set_list(key: str, data: Dict) -> None:
    """Cache list response."""
    k = _query_key("list", key)
    with _CACHE_LOCK:
        _evict_if_needed()
        _CACHE[k] = (data, time.time() + CACHE_TTL_DISCOVER)


# ── Recommendations cache ──

def get_recommendations(media_type: str, tmdb_id: int) -> Optional[Dict]:
    """Return cached recommendations response."""
    key = _query_key("rec", media_type, str(tmdb_id))
    with _CACHE_LOCK:
        entry = _CACHE.get(key)
        if not entry:
            return None
        data, expiry = entry
        if time.time() > expiry:
            del _CACHE[key]
            return None
        return data


def set_recommendations(media_type: str, tmdb_id: int, data: Dict) -> None:
    """Cache recommendations response."""
    key = _query_key("rec", media_type, str(tmdb_id))
    with _CACHE_LOCK:
        _evict_if_needed()
        _CACHE[key] = (data, time.time() + CACHE_TTL_DISCOVER)


