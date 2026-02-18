"""
Media Hunt metadata refresh — periodic update of collection metadata from TMDB.

Refreshes episode titles, air dates, series status (Ended vs Continuing) for TV,
and release dates (in_cinemas, digital_release, physical_release) for movies.
Does not request or download media; only updates information.

Skips items to reduce TMDB API load:
- TV: Ended series (metadata finalized), recently refreshed (< 7 days)
- Movies: Old releases (2+ years), fully released > 12 months ago, recently refreshed (< 30 days)
"""

import time
from datetime import date, datetime, timedelta, timezone

import requests

from src.primary.utils.logger import get_logger

tv_logger = get_logger("tv_hunt")
movie_logger = get_logger("movie_hunt")

TMDB_BASE = "https://api.themoviedb.org/3"
TMDB_API_KEY = "9265b0bd0cd1962f7f3225989fcd7192"

# Throttling: minimum days between refreshes per item
TV_REFRESH_COOLDOWN_DAYS = 7
MOVIE_REFRESH_COOLDOWN_DAYS = 30
MOVIE_OLD_YEARS = 2  # Skip movies 2+ years old
MOVIE_RELEASED_MONTHS = 12  # Skip movies with physical release > 12 months ago


def _get_ssl_verify():
    try:
        from src.primary.settings_manager import get_ssl_verify_setting
        return get_ssl_verify_setting()
    except Exception:
        return True


def _parse_iso_date(s: str):
    """Parse YYYY-MM-DD or YYYY-MM to date. Returns None on failure."""
    if not s or not isinstance(s, str):
        return None
    s = s.strip()[:10]
    if not s:
        return None
    try:
        parts = s.split("-")
        y = int(parts[0])
        m = int(parts[1]) if len(parts) > 1 else 1
        d = int(parts[2]) if len(parts) > 2 else 1
        return date(y, m, d)
    except (ValueError, IndexError):
        return None


def _should_skip_tv_series(s: dict) -> tuple[bool, str | None]:
    """Returns (skip, reason). Skip=True means do not call TMDB for this series."""
    status = (s.get("status") or "").strip()
    if status == "Ended":
        return True, "ended"
    last = s.get("metadata_last_refreshed")
    if last:
        try:
            dt = datetime.fromisoformat(last.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            if (datetime.now(timezone.utc) - dt) < timedelta(days=TV_REFRESH_COOLDOWN_DAYS):
                return True, "recent"
        except (ValueError, TypeError):
            pass
    return False, None


def _should_skip_movie(item: dict) -> tuple[bool, str | None]:
    """Returns (skip, reason). Skip=True means do not call TMDB for this movie."""
    now = datetime.now(timezone.utc)
    current_year = now.year
    year_str = str(item.get("year") or "").strip()
    if year_str:
        try:
            y = int(year_str)
            if y <= current_year - MOVIE_OLD_YEARS:
                return True, "old"
        except ValueError:
            pass
    phys = (item.get("physical_release") or "").strip()
    if phys:
        d = _parse_iso_date(phys)
        if d:
            today = date(now.year, now.month, now.day)
            days = (today - d).days
            if days > MOVIE_RELEASED_MONTHS * 30:
                return True, "released"
    last = item.get("metadata_last_refreshed")
    if last:
        try:
            dt = datetime.fromisoformat(last.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            if (now - dt) < timedelta(days=MOVIE_REFRESH_COOLDOWN_DAYS):
                return True, "recent"
        except (ValueError, TypeError):
            pass
    return False, None


def refresh_tv_hunt_metadata(instance_id: int, stop_check=None) -> int:
    """
    Refresh TV Hunt collection metadata from TMDB.
    Updates episode titles, air dates, series status (Ended/Continuing).
    Preserves status, file_path, monitored on episodes.
    Returns number of series refreshed.
    """
    try:
        from src.primary.utils.database import get_database
        from src.primary.routes.media_hunt.discovery_tv import _get_collection_config, _save_collection_config

        db = get_database()
        config = db.get_app_config_for_instance('tv_hunt_collection', instance_id)
        if not config or not isinstance(config.get('series'), list):
            return 0

        collection = config['series']
        if not collection:
            return 0

        verify_ssl = _get_ssl_verify()
        refreshed = 0
        collection_modified = False

        for s in collection:
            if stop_check and stop_check():
                break
            tmdb_id = s.get('tmdb_id')
            if not tmdb_id:
                continue
            skip, reason = _should_skip_tv_series(s)
            if skip:
                tv_logger.debug("Metadata refresh: skipping TV tmdb_id=%s (%s)", tmdb_id, reason)
                continue

            try:
                r = requests.get(
                    f'{TMDB_BASE}/tv/{tmdb_id}',
                    params={'api_key': TMDB_API_KEY, 'language': 'en-US'},
                    timeout=15, verify=verify_ssl
                )
                if r.status_code != 200:
                    continue
                tmdb_data = r.json()

                series_updated = False
                s['status'] = tmdb_data.get('status', '') or s.get('status', '')
                s['number_of_seasons'] = tmdb_data.get('number_of_seasons') or s.get('number_of_seasons', 0)
                s['number_of_episodes'] = tmdb_data.get('number_of_episodes') or s.get('number_of_episodes', 0)
                s['overview'] = tmdb_data.get('overview', '') or s.get('overview', '')
                s['first_air_date'] = tmdb_data.get('first_air_date', '') or s.get('first_air_date', '')
                series_updated = True

                seasons = s.get('seasons') or []
                for sec in seasons:
                    if stop_check and stop_check():
                        break
                    season_num = sec.get('season_number')
                    if season_num is None:
                        continue

                    try:
                        sr = requests.get(
                            f'{TMDB_BASE}/tv/{tmdb_id}/season/{season_num}',
                            params={'api_key': TMDB_API_KEY, 'language': 'en-US'},
                            timeout=15, verify=verify_ssl
                        )
                        if sr.status_code != 200:
                            continue
                        season_data = sr.json()
                    except Exception:
                        continue

                    episodes_tmdb = season_data.get('episodes') or []
                    episodes_coll = sec.get('episodes') or []
                    tmdb_by_ep = {int(ep.get('episode_number', 0)): ep for ep in episodes_tmdb if ep.get('episode_number') is not None}

                    for ep in episodes_coll:
                        ep_num = ep.get('episode_number')
                        if ep_num is None:
                            continue
                        tmdb_ep = tmdb_by_ep.get(int(ep_num))
                        if not tmdb_ep:
                            continue
                        new_title = (tmdb_ep.get('name') or tmdb_ep.get('title') or '').strip()
                        new_air_date = (tmdb_ep.get('air_date') or '')[:10] if tmdb_ep.get('air_date') else ''
                        new_overview = (tmdb_ep.get('overview') or '').strip()
                        new_still = (tmdb_ep.get('still_path') or '').strip()
                        if new_title:
                            ep['title'] = new_title
                        if new_air_date:
                            ep['air_date'] = new_air_date
                        if new_overview is not None:
                            ep['overview'] = new_overview
                        if new_still:
                            ep['still_path'] = new_still
                        series_updated = True

                    time.sleep(0.2)

                s["metadata_last_refreshed"] = datetime.now(timezone.utc).isoformat()
                collection_modified = True
                if series_updated:
                    refreshed += 1
                    tv_logger.debug("Metadata refresh: updated series tmdb_id=%s", tmdb_id)

                time.sleep(0.25)
            except Exception as e:
                tv_logger.debug("Metadata refresh TV series %s: %s", tmdb_id, e)

        if collection_modified:
            db.save_app_config_for_instance('tv_hunt_collection', instance_id, {'series': collection})
            tv_logger.info("Metadata refresh TV: updated %d series for instance %s", refreshed, instance_id)

        return refreshed
    except Exception as e:
        tv_logger.exception("Metadata refresh TV error: %s", e)
        return 0


def refresh_movie_hunt_metadata(instance_id: int, stop_check=None) -> int:
    """
    Refresh Movie Hunt collection metadata from TMDB.
    Updates release dates (in_cinemas, digital_release, physical_release), title, year.
    Returns number of movies refreshed.
    """
    try:
        from src.primary.utils.database import get_database
        from src.primary.routes.media_hunt.discovery_movie import _fetch_tmdb_release_dates

        db = get_database()
        config = db.get_app_config_for_instance('movie_hunt_collection', instance_id)
        if not config or not isinstance(config.get('items'), list):
            return 0

        items = config['items']
        if not items:
            return 0

        refreshed = 0
        collection_modified = False
        for item in items:
            if stop_check and stop_check():
                break
            tmdb_id = item.get('tmdb_id')
            if not tmdb_id:
                continue
            skip, reason = _should_skip_movie(item)
            if skip:
                movie_logger.debug("Metadata refresh: skipping movie tmdb_id=%s (%s)", tmdb_id, reason)
                continue

            try:
                item_changed = False
                release_dates = _fetch_tmdb_release_dates(tmdb_id)
                if release_dates:
                    for key in ('in_cinemas', 'digital_release', 'physical_release'):
                        new_val = release_dates.get(key, '')
                        if new_val and item.get(key) != new_val:
                            item[key] = new_val
                            item_changed = True

                verify_ssl = _get_ssl_verify()
                r = requests.get(
                    f'{TMDB_BASE}/movie/{tmdb_id}',
                    params={'api_key': TMDB_API_KEY, 'language': 'en-US'},
                    timeout=10, verify=verify_ssl
                )
                if r.status_code == 200:
                    m = r.json()
                    new_title = (m.get('title') or '').strip()
                    new_year = (m.get('release_date') or '')[:4] if m.get('release_date') else ''
                    if new_title and item.get('title') != new_title:
                        item['title'] = new_title
                        item_changed = True
                    if new_year and str(item.get('year') or '').strip() != new_year:
                        item['year'] = new_year
                        item_changed = True

                item["metadata_last_refreshed"] = datetime.now(timezone.utc).isoformat()
                collection_modified = True
                if item_changed:
                    refreshed += 1
                    movie_logger.debug("Metadata refresh: updated movie tmdb_id=%s", tmdb_id)

                time.sleep(0.25)
            except Exception as e:
                movie_logger.debug("Metadata refresh movie %s: %s", tmdb_id, e)

        if collection_modified:
            db.save_app_config_for_instance('movie_hunt_collection', instance_id, {'items': items})
            movie_logger.info("Metadata refresh Movie: updated %d movies for instance %s", refreshed, instance_id)

        return refreshed
    except Exception as e:
        movie_logger.exception("Metadata refresh Movie error: %s", e)
        return 0


def run_metadata_refresh_cycle(stop_check=None):
    """Run metadata refresh for all Movie Hunt and TV Hunt instances."""
    try:
        from src.primary.utils.database import get_database
        db = get_database()

        movie_instances = []
        tv_instances = []
        try:
            movie_instances = db.get_movie_hunt_instances() or []
        except Exception:
            pass
        try:
            tv_instances = db.get_tv_hunt_instances() or []
        except Exception:
            pass

        total_movie = 0
        total_tv = 0
        for inst in movie_instances:
            if stop_check and stop_check():
                break
            try:
                iid = inst.get('id') or inst.get('instance_id')
                if iid is not None:
                    total_movie += refresh_movie_hunt_metadata(int(iid), stop_check)
            except (TypeError, ValueError):
                pass

        for inst in tv_instances:
            if stop_check and stop_check():
                break
            try:
                iid = inst.get('id') or inst.get('instance_id')
                if iid is not None:
                    total_tv += refresh_tv_hunt_metadata(int(iid), stop_check)
            except (TypeError, ValueError):
                pass

        if total_movie > 0 or total_tv > 0:
            get_logger("metadata_refresh").info(
                "Metadata refresh cycle complete: %d movies, %d TV series updated",
                total_movie, total_tv
            )
    except Exception as e:
        get_logger("metadata_refresh").exception("Metadata refresh cycle error: %s", e)
