"""
Smart Hunt Discovery Engine — intelligent recommendation system combining
multiple TMDB discovery strategies with percentage-based mixing, deduplication,
library filtering, and caching.
"""

import logging
import random
import hashlib
import json
import time
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Dict, List, Any, Optional, Tuple

import requests

from src.primary.utils.database import get_database

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Default settings
# ---------------------------------------------------------------------------

SMARTHUNT_DEFAULTS = {
    "enabled": True,
    "hide_library_items": True,
    "cache_ttl_minutes": 60,
    "min_tmdb_rating": 6.0,
    "min_vote_count": 50,
    "year_start": 2000,
    "year_end": datetime.now().year + 1,
    "percentages": {
        "similar_library": 40,
        "trending": 15,
        "hidden_gems": 10,
        "new_releases": 10,
        "top_rated": 10,
        "genre_mix": 5,
        "upcoming": 5,
        "random": 5,
    },
}

# Cache TTL mapping (minutes -> seconds); 0 = disabled
CACHE_TTL_OPTIONS = {0: 0, 30: 1800, 60: 3600, 360: 21600, 720: 43200, 1440: 86400}

BATCH_SIZE = 20
MAX_PAGES = 5  # 100 items total

# ---------------------------------------------------------------------------
# In-memory result cache  (settings hash -> {results, timestamp})
# ---------------------------------------------------------------------------
_result_cache: Dict[str, dict] = {}


def _safe_int(val, default):
    """Safely parse value to int, returning default on failure."""
    try:
        return int(val) if val is not None else default
    except (TypeError, ValueError):
        return default


def _safe_float(val, default):
    """Safely parse value to float, returning default on failure."""
    try:
        return float(val) if val is not None else default
    except (TypeError, ValueError):
        return default


def _cache_key(settings: dict, movie_instance: str, tv_instance: str, movie_app_type: str, tv_app_type: str = "sonarr") -> str:
    """Produce a deterministic hash of the settings + instance combo."""
    blob = json.dumps(
        {"s": settings, "mi": movie_instance, "ti": tv_instance, "mat": movie_app_type, "tat": tv_app_type},
        sort_keys=True,
    )
    return hashlib.md5(blob.encode()).hexdigest()


def invalidate_cache():
    """Clear the entire Smart Hunt result cache (called when settings change)."""
    _result_cache.clear()


# ---------------------------------------------------------------------------
# Engine
# ---------------------------------------------------------------------------


class SmartHuntEngine:
    """Generates Smart Hunt results by mixing multiple TMDB discovery strategies."""

    TMDB_BASE = "https://api.themoviedb.org/3"
    IMAGE_BASE = "https://image.tmdb.org/t/p/w500"

    def __init__(self):
        self.db = get_database()

    # ------------------------------------------------------------------
    # Public entry point
    # ------------------------------------------------------------------

    def get_results(
        self,
        page: int,
        settings: dict,
        movie_instance: str,
        tv_instance: str,
        movie_app_type: str = "radarr",
        tv_app_type: str = "sonarr",
        discover_filters: Optional[dict] = None,
        blacklisted_genres: Optional[dict] = None,
    ) -> List[Dict[str, Any]]:
        """Return *page* (1-based) of Smart Hunt results (20 items per page).

        All 100 items (5 pages) are generated in one shot, cached, and sliced.
        """
        if page < 1:
            page = 1
        if page > MAX_PAGES:
            page = MAX_PAGES

        # Determine cache TTL from settings (0 = disabled)
        ttl_minutes = _safe_int(settings.get("cache_ttl_minutes"), SMARTHUNT_DEFAULTS["cache_ttl_minutes"])
        ttl_seconds = CACHE_TTL_OPTIONS.get(ttl_minutes, ttl_minutes * 60)

        ck = _cache_key(settings, movie_instance, tv_instance, movie_app_type, tv_app_type)
        cached = _result_cache.get(ck)
        if ttl_seconds > 0 and cached and time.time() - cached["ts"] < ttl_seconds:
            items = cached["results"]
        else:
            items = self._generate_all(
                settings, movie_instance, tv_instance, movie_app_type, tv_app_type,
                discover_filters or {}, blacklisted_genres or {},
            )
            if ttl_seconds > 0:
                _result_cache[ck] = {"results": items, "ts": time.time()}
            else:
                # Cache disabled — clear any stale entry
                _result_cache.pop(ck, None)

        start = (page - 1) * BATCH_SIZE
        end = start + BATCH_SIZE
        return items[start:end]

    # ------------------------------------------------------------------
    # Main generation pipeline
    # ------------------------------------------------------------------

    def _generate_all(
        self,
        settings: dict,
        movie_instance: str,
        tv_instance: str,
        movie_app_type: str,
        tv_app_type: str,
        discover_filters: dict,
        blacklisted_genres: dict,
    ) -> List[Dict[str, Any]]:
        """Build the full 100-item pool across all categories."""

        pcts = settings.get("percentages", SMARTHUNT_DEFAULTS["percentages"])
        min_rating = _safe_float(settings.get("min_tmdb_rating"), SMARTHUNT_DEFAULTS["min_tmdb_rating"])
        min_votes = _safe_int(settings.get("min_vote_count"), SMARTHUNT_DEFAULTS["min_vote_count"])
        year_start = _safe_int(settings.get("year_start"), SMARTHUNT_DEFAULTS["year_start"])
        year_end = _safe_int(settings.get("year_end"), SMARTHUNT_DEFAULTS["year_end"])
        api_key = self._get_api_key()

        region = discover_filters.get("region", "")
        languages = discover_filters.get("languages", [])
        providers = discover_filters.get("providers", [])
        def _safe_int_set(lst):
            out = set()
            for x in lst or []:
                try:
                    out.add(int(x))
                except (TypeError, ValueError):
                    pass
            return out
        bl_movie = _safe_int_set(blacklisted_genres.get("blacklisted_movie_genres", []))
        bl_tv = _safe_int_set(blacklisted_genres.get("blacklisted_tv_genres", []))

        total_target = BATCH_SIZE * MAX_PAGES  # 100

        # Calculate how many items each category should contribute
        def _safe_pct(val):
            try:
                return max(0, min(100, int(val)))
            except (TypeError, ValueError):
                return 0
        category_counts = {}
        for cat, pct in pcts.items():
            p = _safe_pct(pct)
            category_counts[cat] = max(1, round(total_target * p / 100)) if p > 0 else 0

        # Common params shared by most fetchers
        common = {
            "api_key": api_key,
            "region": region,
            "languages": languages,
            "providers": providers,
            "bl_movie": bl_movie,
            "bl_tv": bl_tv,
            "min_rating": min_rating,
            "min_votes": min_votes,
            "year_start": year_start,
            "year_end": year_end,
        }

        # Map category name -> fetcher callable
        fetchers = {
            "trending": (self._fetch_trending, category_counts.get("trending", 0)),
            "top_rated": (self._fetch_top_rated, category_counts.get("top_rated", 0)),
            "new_releases": (self._fetch_new_releases, category_counts.get("new_releases", 0)),
            "upcoming": (self._fetch_upcoming, category_counts.get("upcoming", 0)),
            "hidden_gems": (self._fetch_hidden_gems, category_counts.get("hidden_gems", 0)),
            "genre_mix": (self._fetch_genre_mix, category_counts.get("genre_mix", 0)),
            "random": (self._fetch_random, category_counts.get("random", 0)),
            "similar_library": (self._fetch_similar_library, category_counts.get("similar_library", 0)),
        }

        # Fetch all categories in parallel
        all_items: Dict[str, List[dict]] = {}
        with ThreadPoolExecutor(max_workers=8) as pool:
            futures = {}
            for cat, (fn, count) in fetchers.items():
                if count <= 0:
                    all_items[cat] = []
                    continue
                # Each fetcher returns List[dict]
                futures[pool.submit(fn, count, common)] = cat

            for future in as_completed(futures):
                cat = futures[future]
                try:
                    all_items[cat] = future.result()
                except Exception as e:
                    logger.error(f"[SmartHunt] Category '{cat}' failed: {e}")
                    all_items[cat] = []

        # ------------------------------------------------------------------
        # Critic's Pick: intersection of trending + top_rated
        # ------------------------------------------------------------------
        trending_ids = {(i["tmdb_id"], i["media_type"]) for i in all_items.get("trending", [])}
        top_rated_ids = {(i["tmdb_id"], i["media_type"]) for i in all_items.get("top_rated", [])}
        overlap_ids = trending_ids & top_rated_ids
        critics_picks = []
        if overlap_ids:
            tr_map = {(i["tmdb_id"], i["media_type"]): i for i in all_items.get("trending", [])}
            for key in overlap_ids:
                item = tr_map.get(key)
                if item:
                    cp = dict(item)
                    cp["smart_hunt_category"] = "critics_pick"
                    critics_picks.append(cp)

        # ------------------------------------------------------------------
        # Deduplicate across categories, keeping first occurrence
        # ------------------------------------------------------------------
        seen = set()
        deduped: List[dict] = []

        # Priority order for interleaving
        category_order = [
            "similar_library", "trending", "hidden_gems",
            "new_releases", "top_rated", "genre_mix", "upcoming", "random",
        ]

        # Tag items with their category
        for cat in category_order:
            items = all_items.get(cat, [])
            random.shuffle(items)
            target = category_counts.get(cat, 0)
            added = 0
            for item in items:
                key = (item.get("tmdb_id"), item.get("media_type"))
                if key in seen:
                    continue
                seen.add(key)
                item["smart_hunt_category"] = cat
                deduped.append(item)
                added += 1
                if added >= target:
                    break

        # Sprinkle in critic's picks (these are bonus — don't double-count)
        for cp in critics_picks:
            key = (cp["tmdb_id"], cp["media_type"])
            if key in seen:
                # Already in pool — just tag it
                for d in deduped:
                    if d.get("tmdb_id") == cp["tmdb_id"] and d.get("media_type") == cp["media_type"]:
                        d["smart_hunt_category"] = "critics_pick"
                        break

        # Apply minimum rating filter
        if min_rating > 0:
            deduped = [i for i in deduped if (i.get("vote_average") or 0) >= min_rating]

        # Apply minimum vote count filter (for items from recommendations etc.)
        if min_votes > 0:
            deduped = [i for i in deduped if (i.get("vote_count") or 0) >= min_votes]

        # Trim to total target
        if len(deduped) > total_target:
            deduped = deduped[:total_target]

        # Shuffle for a natural mixed feel
        random.shuffle(deduped)

        # ------------------------------------------------------------------
        # Library / hidden / requested filtering
        # ------------------------------------------------------------------
        hide_library = settings.get("hide_library_items", True)
        if hide_library:
            deduped = self._filter_library_items(
                deduped, movie_instance, tv_instance, movie_app_type, tv_app_type,
            )

        return deduped

    # ------------------------------------------------------------------
    # Category fetchers
    # ------------------------------------------------------------------

    def _fetch_trending(self, count: int, common: dict) -> List[dict]:
        """Popular items sorted by popularity descending."""
        items = []
        for media_type in ["movie", "tv"]:
            params = self._base_params(common, media_type)
            params["sort_by"] = "popularity.desc"
            self._apply_year_filter(params, media_type, common)
            fetched = self._tmdb_discover(media_type, params, count, common)
            items.extend(fetched)
        return items

    def _fetch_top_rated(self, count: int, common: dict) -> List[dict]:
        """Highest-rated items with a minimum vote count."""
        items = []
        for media_type in ["movie", "tv"]:
            params = self._base_params(common, media_type)
            params["sort_by"] = "vote_average.desc"
            params["vote_count.gte"] = "200"
            self._apply_year_filter(params, media_type, common)
            fetched = self._tmdb_discover(media_type, params, count, common)
            items.extend(fetched)
        return items

    def _fetch_new_releases(self, count: int, common: dict) -> List[dict]:
        """Items released in the last 90 days."""
        items = []
        ninety_days_ago = (datetime.now() - timedelta(days=90)).strftime("%Y-%m-%d")
        today = datetime.now().strftime("%Y-%m-%d")
        for media_type in ["movie", "tv"]:
            params = self._base_params(common, media_type)
            params["sort_by"] = "popularity.desc"
            date_key_gte = "primary_release_date.gte" if media_type == "movie" else "first_air_date.gte"
            date_key_lte = "primary_release_date.lte" if media_type == "movie" else "first_air_date.lte"
            params[date_key_gte] = ninety_days_ago
            params[date_key_lte] = today
            fetched = self._tmdb_discover(media_type, params, count, common)
            items.extend(fetched)
        return items

    def _fetch_upcoming(self, count: int, common: dict) -> List[dict]:
        """Items not yet released."""
        items = []
        today = datetime.now().strftime("%Y-%m-%d")
        for media_type in ["movie", "tv"]:
            params = self._base_params(common, media_type)
            params["sort_by"] = "popularity.desc"
            date_key = "primary_release_date.gte" if media_type == "movie" else "first_air_date.gte"
            params[date_key] = today
            fetched = self._tmdb_discover(media_type, params, count, common)
            items.extend(fetched)
        return items

    def _fetch_hidden_gems(self, count: int, common: dict) -> List[dict]:
        """High quality, low popularity picks."""
        items = []
        for media_type in ["movie", "tv"]:
            params = self._base_params(common, media_type)
            params["sort_by"] = "vote_average.desc"
            params["vote_average.gte"] = "7.0"
            params["vote_count.gte"] = "50"
            params["vote_count.lte"] = "500"  # Hidden gems: low vote count
            self._apply_year_filter(params, media_type, common)
            fetched = self._tmdb_discover(media_type, params, count, common)
            items.extend(fetched)
        return items

    def _fetch_genre_mix(self, count: int, common: dict) -> List[dict]:
        """Genre deep dive — pick popular genres and discover within them."""
        items = []
        # Use a diverse set of popular genre IDs
        movie_genres = [28, 12, 16, 35, 80, 18, 14, 27, 9648, 878, 53, 10752]
        tv_genres = [10759, 16, 35, 80, 18, 10765, 9648, 10768]
        for media_type in ["movie", "tv"]:
            genre_pool = movie_genres if media_type == "movie" else tv_genres
            chosen = random.sample(genre_pool, min(3, len(genre_pool)))
            for genre_id in chosen:
                params = self._base_params(common, media_type)
                params["sort_by"] = "popularity.desc"
                params["with_genres"] = str(genre_id)
                self._apply_year_filter(params, media_type, common)
                fetched = self._tmdb_discover(media_type, params, max(count // 3, 2), common)
                items.extend(fetched)
        return items

    def _fetch_random(self, count: int, common: dict) -> List[dict]:
        """Random discovery — pick a random page from TMDB."""
        items = []
        for media_type in ["movie", "tv"]:
            params = self._base_params(common, media_type)
            params["sort_by"] = "popularity.desc"
            params["page"] = str(random.randint(2, 100))
            self._apply_year_filter(params, media_type, common)
            fetched = self._tmdb_discover(media_type, params, count, common)
            items.extend(fetched)
        return items

    def _fetch_similar_library(self, count: int, common: dict) -> List[dict]:
        """Recommendations based on items already in the user's library."""
        items = []
        api_key = common["api_key"]

        # Get library items to use as seeds
        seeds = self._get_library_seeds(api_key)
        if not seeds:
            # Fallback: treat as additional trending
            return self._fetch_trending(count, common)

        # Fetch recommendations for each seed in parallel
        rec_pool: List[dict] = []
        with ThreadPoolExecutor(max_workers=5) as pool:
            futures = []
            for seed in seeds:
                futures.append(
                    pool.submit(self._fetch_recommendations, seed["tmdb_id"], seed["media_type"], api_key, common)
                )
            for future in as_completed(futures):
                try:
                    rec_pool.extend(future.result())
                except Exception as e:
                    logger.warning(f"[SmartHunt] Recommendation fetch failed: {e}")

        if not rec_pool:
            return self._fetch_trending(count, common)

        # Score: items recommended by multiple seeds get a bonus
        rec_counts: Dict[Tuple[int, str], int] = {}
        rec_map: Dict[Tuple[int, str], dict] = {}
        for item in rec_pool:
            key = (item["tmdb_id"], item["media_type"])
            rec_counts[key] = rec_counts.get(key, 0) + 1
            rec_map[key] = item

        scored = []
        for key, item in rec_map.items():
            overlap_bonus = rec_counts.get(key, 1) * 2
            vote_score = item.get("vote_average", 0)
            item["_score"] = overlap_bonus + vote_score
            scored.append(item)

        scored.sort(key=lambda x: x.get("_score", 0), reverse=True)

        # Apply min rating filter
        min_rating = common.get("min_rating", 0)
        if min_rating > 0:
            scored = [i for i in scored if (i.get("vote_average") or 0) >= min_rating]

        return scored[:count * 2]  # Return more than needed; dedup will trim

    def _fetch_recommendations(self, tmdb_id: int, media_type: str, api_key: str, common: dict) -> List[dict]:
        """Fetch /recommendations for a single seed item."""
        url = f"{self.TMDB_BASE}/{media_type}/{tmdb_id}/recommendations"
        params = {"api_key": api_key, "page": 1}
        try:
            resp = requests.get(url, params=params, timeout=10)
            resp.raise_for_status()
            data = resp.json()
            bl = common.get("bl_movie") if media_type == "movie" else common.get("bl_tv")
            return self._parse_results(data.get("results", [])[:20], media_type, bl or set())
        except Exception as e:
            logger.warning(f"[SmartHunt] Recommendations for {media_type}/{tmdb_id} failed: {e}")
            return []

    def _get_library_seeds(self, api_key: str) -> List[dict]:
        """Pick seed items from the user's library for Similar to Library.

        Strategy: 2 random, 2 recently added, 1 highest rated (5 total).
        Falls back to whatever is available.
        """
        from src.primary.apps.requestarr import requestarr_api
        try:
            instances = requestarr_api.get_enabled_instances()
        except Exception:
            return []

        library_items = []

        # Gather movie library items from Radarr
        for inst in instances.get("radarr", []):
            try:
                headers = {"X-Api-Key": inst["api_key"]}
                resp = requests.get(
                    f"{inst['url'].rstrip('/')}/api/v3/movie",
                    headers=headers, timeout=10,
                )
                if resp.status_code == 200:
                    for m in resp.json():
                        if m.get("hasFile") and m.get("tmdbId"):
                            library_items.append({
                                "tmdb_id": m["tmdbId"],
                                "media_type": "movie",
                                "vote_average": m.get("ratings", {}).get("tmdb", {}).get("value", 0),
                                "added": m.get("added", ""),
                            })
            except Exception:
                pass

        # Gather TV library items from Sonarr
        for inst in instances.get("sonarr", []):
            try:
                headers = {"X-Api-Key": inst["api_key"]}
                resp = requests.get(
                    f"{inst['url'].rstrip('/')}/api/v3/series",
                    headers=headers, timeout=10,
                )
                if resp.status_code == 200:
                    for s in resp.json():
                        if s.get("tmdbId"):
                            stats = s.get("statistics", {})
                            if stats.get("episodeFileCount", 0) > 0:
                                library_items.append({
                                    "tmdb_id": s["tmdbId"],
                                    "media_type": "tv",
                                    "vote_average": s.get("ratings", {}).get("value", 0),
                                    "added": s.get("added", ""),
                                })
            except Exception:
                pass

        # Gather from Movie Hunt instances
        for inst in instances.get("movie_hunt", []):
            try:
                mh_id = inst.get("id")
                if mh_id is None:
                    continue
                from src.primary.routes.media_hunt.discovery_movie import _get_collection_config
                collection = _get_collection_config(mh_id)
                for ci in collection:
                    tmdb_id = ci.get("tmdb_id")
                    status = (ci.get("status") or "").lower()
                    if tmdb_id and status == "available":
                        library_items.append({
                            "tmdb_id": tmdb_id,
                            "media_type": "movie",
                            "vote_average": 0,
                            "added": "",
                        })
            except Exception:
                pass

        # Gather from TV Hunt instances
        for inst in instances.get("tv_hunt", []):
            try:
                th_id = inst.get("id")
                if th_id is None:
                    continue
                from src.primary.routes.media_hunt.discovery_tv import _get_collection_config as _get_tv_collection
                collection = _get_tv_collection(th_id)
                for si in collection:
                    tmdb_id = si.get("tmdb_id")
                    status = (si.get("status") or "").lower()
                    if tmdb_id and status in ("available", "continuing", "ended"):
                        library_items.append({
                            "tmdb_id": tmdb_id,
                            "media_type": "tv",
                            "vote_average": 0,
                            "added": "",
                        })
            except Exception:
                pass

        if not library_items:
            return []

        # Pick seeds: 2 random, 2 recent, 1 highest rated
        seeds = []

        # Sort by added date descending for "recent"
        by_date = sorted(library_items, key=lambda x: x.get("added", ""), reverse=True)
        recent = by_date[:2]
        seeds.extend(recent)

        # Highest rated
        by_rating = sorted(library_items, key=lambda x: x.get("vote_average", 0), reverse=True)
        for item in by_rating:
            if item not in seeds:
                seeds.append(item)
                break

        # Random picks
        remaining = [i for i in library_items if i not in seeds]
        if remaining:
            randoms = random.sample(remaining, min(2, len(remaining)))
            seeds.extend(randoms)

        return seeds[:5]

    # ------------------------------------------------------------------
    # TMDB helpers
    # ------------------------------------------------------------------

    def _base_params(self, common: dict, media_type: str) -> dict:
        """Build the base TMDB discover params from common config."""
        params = {"api_key": common["api_key"], "page": "1"}
        bl = common.get("bl_movie") if media_type == "movie" else common.get("bl_tv")
        if bl:
            params["without_genres"] = "|".join(str(g) for g in bl)
        region = common.get("region", "")
        if region:
            params["region"] = region
        languages = common.get("languages", [])
        if languages:
            params["with_original_language"] = "|".join(languages)
        providers = common.get("providers", [])
        if providers:
            if region:
                params["watch_region"] = region
            params["with_watch_providers"] = "|".join(str(p) for p in providers)
        # Apply minimum vote count at the API level
        min_votes = common.get("min_votes", 0)
        if min_votes and min_votes > 0:
            params["vote_count.gte"] = str(min_votes)
        return params

    def _apply_year_filter(self, params: dict, media_type: str, common: dict):
        """Add year range filters to the params."""
        ys = common.get("year_start", 2000)
        ye = common.get("year_end", datetime.now().year + 1)
        if media_type == "movie":
            params["primary_release_date.gte"] = f"{ys}-01-01"
            params["primary_release_date.lte"] = f"{ye}-12-31"
        else:
            params["first_air_date.gte"] = f"{ys}-01-01"
            params["first_air_date.lte"] = f"{ye}-12-31"

    def _tmdb_discover(self, media_type: str, params: dict, count: int, common: dict) -> List[dict]:
        """Hit TMDB /discover/{media_type} and parse results."""
        url = f"{self.TMDB_BASE}/discover/{media_type}"
        bl = common.get("bl_movie") if media_type == "movie" else common.get("bl_tv")
        try:
            resp = requests.get(url, params=params, timeout=10)
            resp.raise_for_status()
            data = resp.json()
            results = data.get("results", [])
            return self._parse_results(results[:count * 2], media_type, bl or set())
        except Exception as e:
            logger.warning(f"[SmartHunt] TMDB discover {media_type} failed: {e}")
            return []

    def _parse_results(self, raw_items: list, media_type: str, bl_genres: set) -> List[dict]:
        """Convert raw TMDB results into our standard item format."""
        parsed = []
        for item in raw_items:
            # Skip blacklisted genres
            genre_ids = set(item.get("genre_ids") or [])
            if bl_genres and genre_ids.intersection(bl_genres):
                continue

            title = item.get("title") or item.get("name", "")
            release_date = item.get("release_date") or item.get("first_air_date", "")
            year = None
            if release_date:
                try:
                    year = int(release_date.split("-")[0])
                except (ValueError, IndexError):
                    pass

            poster_path = item.get("poster_path")
            poster_url = f"{self.IMAGE_BASE}{poster_path}" if poster_path else None
            backdrop_path = item.get("backdrop_path")
            backdrop_url = f"{self.IMAGE_BASE}{backdrop_path}" if backdrop_path else None

            parsed.append({
                "tmdb_id": item.get("id"),
                "media_type": media_type,
                "title": title,
                "year": year,
                "overview": item.get("overview", ""),
                "poster_path": poster_url,
                "backdrop_path": backdrop_url,
                "vote_average": item.get("vote_average", 0),
                "vote_count": item.get("vote_count", 0),
                "popularity": item.get("popularity", 0),
            })
        return parsed

    def _get_api_key(self) -> str:
        """Return the shared TMDB API key."""
        return "9265b0bd0cd1962f7f3225989fcd7192"

    # ------------------------------------------------------------------
    # Library filtering
    # ------------------------------------------------------------------

    def _filter_library_items(
        self,
        items: List[dict],
        movie_instance: str,
        tv_instance: str,
        movie_app_type: str,
        tv_app_type: str = "sonarr",
    ) -> List[dict]:
        """Remove items that are already in the user's library, requested, or hidden."""
        from src.primary.apps.requestarr import requestarr_api

        if not items:
            return items

        # Split into movie and TV items for separate instance checks
        movie_items = [i for i in items if i.get("media_type") == "movie"]
        tv_items = [i for i in items if i.get("media_type") == "tv"]

        if movie_items and movie_instance:
            movie_items = requestarr_api.check_library_status_batch(
                movie_items, app_type=movie_app_type, instance_name=movie_instance,
            )
        elif movie_items:
            movie_items = requestarr_api.check_library_status_batch(movie_items)

        if tv_items and tv_instance:
            tv_items = requestarr_api.check_library_status_batch(
                tv_items, app_type=tv_app_type, instance_name=tv_instance,
            )
        elif tv_items:
            tv_items = requestarr_api.check_library_status_batch(tv_items)

        # Also filter hidden media
        try:
            if movie_items and movie_instance:
                movie_items = requestarr_api.filter_hidden_media(
                    movie_items, app_type=movie_app_type, instance_name=movie_instance,
                )
            if tv_items and tv_instance:
                tv_items = requestarr_api.filter_hidden_media(
                    tv_items, app_type=tv_app_type, instance_name=tv_instance,
                )
        except Exception as e:
            logger.warning(f"[SmartHunt] Hidden media filter failed: {e}")

        # Recombine and filter out in-library items
        all_items = movie_items + tv_items
        filtered = [
            i for i in all_items
            if not i.get("in_library")
        ]

        # Shuffle so movies and TV are mixed randomly (not movie-block then TV-block)
        random.shuffle(filtered)
        return filtered


# ---------------------------------------------------------------------------
# Settings helpers  (used by routes)
# ---------------------------------------------------------------------------

def get_smarthunt_settings() -> dict:
    """Load Smart Hunt settings from the database, merging with defaults."""
    db = get_database()
    try:
        config = db.get_app_config("requestarr") or {}
        saved = config.get("smarthunt_settings", {})
        # Merge with defaults
        merged = dict(SMARTHUNT_DEFAULTS)
        merged.update(saved)
        # Ensure percentages are fully populated
        merged_pcts = dict(SMARTHUNT_DEFAULTS["percentages"])
        merged_pcts.update(saved.get("percentages", {}))
        merged["percentages"] = merged_pcts
        return merged
    except Exception as e:
        logger.error(f"[SmartHunt] Error loading settings: {e}")
        return dict(SMARTHUNT_DEFAULTS)


def save_smarthunt_settings(settings: dict) -> None:
    """Persist Smart Hunt settings to the database."""
    db = get_database()
    try:
        config = db.get_app_config("requestarr") or {}
        config["smarthunt_settings"] = settings
        db.save_app_config("requestarr", config)
        invalidate_cache()
        logger.info("[SmartHunt] Settings saved successfully")
    except Exception as e:
        logger.error(f"[SmartHunt] Error saving settings: {e}")
        raise
