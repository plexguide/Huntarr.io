"""
Media Hunt: process missing movies/episodes from collection (requested but not yet on disk).
Consolidated logic for movie_hunt and tv_hunt. Used by background scheduler.
"""
from typing import Dict, Any, Callable

from ...utils.logger import get_logger
from src.primary.stateful_manager import add_processed_id
from src.primary.apps._common.filtering import filter_unprocessed

movie_hunt_logger = get_logger("movie_hunt")
tv_hunt_logger = get_logger("tv_hunt")


def process_missing_movies(
    app_settings: Dict[str, Any],
    stop_check: Callable[[], bool],
) -> bool:
    """Process missing movies for one Movie Hunt instance."""
    instance_id = app_settings.get("instance_id")
    instance_name = app_settings.get("instance_name", "Default")
    if instance_id is None:
        try:
            instance_id = int(app_settings.get("instance_id"))
        except (TypeError, ValueError):
            movie_hunt_logger.warning("Movie Hunt missing: no valid instance_id in settings")
            return False
    else:
        try:
            instance_id = int(instance_id)
        except (TypeError, ValueError):
            movie_hunt_logger.warning("Movie Hunt missing: instance_id not an integer")
            return False

    hunt_missing_movies = app_settings.get("hunt_missing_movies", 1)
    if hunt_missing_movies <= 0:
        movie_hunt_logger.info("Movie Hunt instance '%s': hunt_missing_movies is 0, skipping missing.", instance_name)
        return False

    if stop_check():
        return False

    from ...routes.media_hunt.discovery_movie import _get_collection_config, _save_collection_config, perform_movie_hunt_request, check_minimum_availability
    from ...routes.media_hunt.storage import get_detected_movies_from_all_roots

    collection = _get_collection_config(instance_id)
    detected = get_detected_movies_from_all_roots(instance_id)
    detected_set = set()
    for item in detected:
        t = (item.get("title") or "").strip().lower()
        y = str(item.get("year") or "").strip()
        if t:
            detected_set.add((t, y))

    missing_items = []
    dates_backfilled = False
    for it in collection:
        if not isinstance(it, dict):
            continue
        status = (it.get("status") or "").strip().lower()
        if status == "available":
            continue
        title = (it.get("title") or "").strip()
        if not title:
            continue
        year = str(it.get("year") or "").strip()
        key = (title.lower(), year)
        if key in detected_set:
            continue

        old_dates = (it.get('in_cinemas', ''), it.get('digital_release', ''), it.get('physical_release', ''))
        if not check_minimum_availability(it):
            movie_hunt_logger.debug(
                "Movie Hunt missing: skipping '%s' (%s) — minimum availability not met.",
                title, year or "no year"
            )
        else:
            missing_items.append({"title": title, "year": year, "tmdb_id": it.get("tmdb_id"), "root_folder": it.get("root_folder"), "quality_profile": it.get("quality_profile"), "poster_path": it.get("poster_path")})

        new_dates = (it.get('in_cinemas', ''), it.get('digital_release', ''), it.get('physical_release', ''))
        if new_dates != old_dates:
            dates_backfilled = True

    if dates_backfilled:
        try:
            _save_collection_config(collection, instance_id)
        except Exception as e:
            movie_hunt_logger.debug("Could not save backfilled dates: %s", e)

    if not missing_items:
        return False

    instance_key = str(instance_id)
    state_mode = app_settings.get("state_management_mode", "custom")
    if state_mode != "disabled":
        missing_items = filter_unprocessed(
            missing_items, "movie_hunt", instance_key,
            lambda it: str(it.get("tmdb_id") or it.get("title", "")),
            movie_hunt_logger,
        )

    if not missing_items:
        return False

    to_process = missing_items[:hunt_missing_movies]
    processed_any = False
    for item in to_process:
        if stop_check():
            break
        title = item.get("title", "").strip()
        year = item.get("year") or ""
        root_folder = item.get("root_folder") or None
        quality_profile = item.get("quality_profile") or None
        tmdb_id = item.get("tmdb_id")
        poster_path = item.get("poster_path") or None

        try:
            from src.primary.stats_manager import increment_stat_only
            increment_stat_only("movie_hunt", "hunted", 1, str(instance_id))
        except Exception:
            pass

        success, msg = perform_movie_hunt_request(
            instance_id, title, year,
            root_folder=root_folder, quality_profile=quality_profile,
            tmdb_id=tmdb_id, poster_path=poster_path,
        )

        if state_mode != "disabled":
            track_id = str(tmdb_id) if tmdb_id else title
            if track_id:
                add_processed_id("movie_hunt", instance_key, track_id)

        if success:
            processed_any = True
            try:
                from src.primary.stats_manager import increment_stat_only
                increment_stat_only("movie_hunt", "found", 1, str(instance_id))
            except Exception:
                pass
            try:
                from src.primary.utils.history_utils import log_processed_media
                log_processed_media("movie_hunt", f"{title} ({year})" if year else title, tmdb_id, str(instance_id), "missing", display_name_for_log=instance_name)
            except Exception:
                pass

    return processed_any


def process_missing_episodes(
    app_settings: Dict[str, Any],
    stop_check: Callable[[], bool],
) -> bool:
    """Process missing episodes for one TV Hunt instance."""
    from datetime import datetime
    instance_id = app_settings.get("instance_id")
    instance_name = app_settings.get("instance_name", "Default")
    if instance_id is None:
        try:
            instance_id = int(app_settings.get("instance_id"))
        except (TypeError, ValueError):
            tv_hunt_logger.warning("TV Hunt missing: no valid instance_id in settings")
            return False
    else:
        try:
            instance_id = int(instance_id)
        except (TypeError, ValueError):
            tv_hunt_logger.warning("TV Hunt missing: instance_id not an integer")
            return False

    hunt_missing_episodes = app_settings.get("hunt_missing_episodes", 1)
    if hunt_missing_episodes <= 0:
        return False

    hunt_missing_mode = app_settings.get("hunt_missing_mode", "seasons_packs")
    skip_future = app_settings.get("skip_future_episodes", True)

    if stop_check():
        return False

    from ...routes.tv_hunt.discovery import _get_collection_config, perform_tv_hunt_request
    from ...routes.media_hunt.storage import get_detected_episodes_from_all_roots

    collection = _get_collection_config(instance_id)
    detected = get_detected_episodes_from_all_roots(instance_id)
    detected_set = set()
    for item in detected:
        t = (item.get("series_title") or "").strip().lower()
        s = item.get("season_number")
        e = item.get("episode_number")
        if t and s is not None and e is not None:
            detected_set.add((t, int(s), int(e)))

    missing_items = []
    now = datetime.now()
    for series in collection:
        if not isinstance(series, dict):
            continue
        series_title = (series.get("title") or "").strip()
        if not series_title:
            continue
        tvdb_id = series.get("tvdb_id") or series.get("tmdb_id")
        seasons = series.get("seasons") or []
        for season in seasons:
            if not isinstance(season, dict):
                continue
            season_number = season.get("season_number")
            if season_number is None or not season.get("monitored", True):
                continue
            episodes = season.get("episodes") or []
            for ep in episodes:
                if not isinstance(ep, dict):
                    continue
                ep_number = ep.get("episode_number")
                if ep_number is None or not ep.get("monitored", True):
                    continue
                key = (series_title.lower(), int(season_number), int(ep_number))
                if key in detected_set:
                    continue
                if skip_future and ep.get("air_date"):
                    try:
                        if datetime.strptime(ep["air_date"][:10], "%Y-%m-%d") > now:
                            continue
                    except (ValueError, TypeError):
                        pass
                missing_items.append({
                    "series_title": series_title, "tvdb_id": tvdb_id,
                    "season_number": int(season_number), "episode_number": int(ep_number),
                    "episode_title": ep.get("title") or "", "root_folder": series.get("root_folder"),
                    "quality_profile": series.get("quality_profile"), "poster_path": series.get("poster_path"),
                })

    if not missing_items:
        return False

    instance_key = str(instance_id)
    state_mode = app_settings.get("state_management_mode", "custom")
    if state_mode != "disabled":
        missing_items = filter_unprocessed(
            missing_items, "tv_hunt", instance_key,
            lambda it: f"{it.get('tvdb_id', it.get('series_title', ''))}S{it['season_number']:02d}E{it['episode_number']:02d}",
            tv_hunt_logger,
        )

    if not missing_items:
        return False

    if hunt_missing_mode == "seasons_packs":
        return _process_season_packs(missing_items, instance_id, instance_name, instance_key, hunt_missing_episodes, state_mode, stop_check)
    return _process_individual_episodes(missing_items, instance_id, instance_name, instance_key, hunt_missing_episodes, state_mode, stop_check)


def _process_season_packs(missing_items, instance_id, instance_name, instance_key, hunt_limit, state_mode, stop_check):
    from ...routes.tv_hunt.discovery import perform_tv_hunt_request
    season_groups = {}
    for item in missing_items:
        key = (item["series_title"], item["season_number"])
        if key not in season_groups:
            season_groups[key] = item.copy()
            season_groups[key]["episode_count"] = 1
        else:
            season_groups[key]["episode_count"] += 1

    processed_any = False
    processed_count = 0
    for (series_title, season_number), rep_item in season_groups.items():
        if processed_count >= hunt_limit or stop_check():
            break
        try:
            from src.primary.stats_manager import increment_stat_only
            increment_stat_only("tv_hunt", "hunted", 1, str(instance_id))
        except Exception:
            pass

        success, msg = perform_tv_hunt_request(
            instance_id, series_title, season_number=season_number,
            tvdb_id=rep_item.get("tvdb_id"), root_folder=rep_item.get("root_folder"),
            quality_profile=rep_item.get("quality_profile"), poster_path=rep_item.get("poster_path"),
            search_type="season",
        )

        if state_mode != "disabled":
            for it in missing_items:
                if it["series_title"] == series_title and it["season_number"] == season_number:
                    add_processed_id("tv_hunt", instance_key, f"{rep_item.get('tvdb_id', series_title)}S{season_number:02d}E{it['episode_number']:02d}")

        if success:
            processed_any = True
            processed_count += 1
            try:
                from src.primary.stats_manager import increment_stat_only
                increment_stat_only("tv_hunt", "found", 1, str(instance_id))
            except Exception:
                pass
            try:
                from src.primary.utils.history_utils import log_processed_media
                log_processed_media("tv_hunt", f"{series_title} S{season_number:02d}", rep_item.get("tvdb_id"), str(instance_id), "missing", display_name_for_log=instance_name)
            except Exception:
                pass

    return processed_any


def _process_individual_episodes(missing_items, instance_id, instance_name, instance_key, hunt_limit, state_mode, stop_check):
    from ...routes.tv_hunt.discovery import perform_tv_hunt_request
    to_process = missing_items[:hunt_limit]
    processed_any = False
    for item in to_process:
        if stop_check():
            break
        series_title = item.get("series_title", "").strip()
        season_number = item.get("season_number")
        episode_number = item.get("episode_number")
        tvdb_id = item.get("tvdb_id")

        try:
            from src.primary.stats_manager import increment_stat_only
            increment_stat_only("tv_hunt", "hunted", 1, str(instance_id))
        except Exception:
            pass

        success, msg = perform_tv_hunt_request(
            instance_id, series_title,
            season_number=season_number, episode_number=episode_number, tvdb_id=tvdb_id,
            root_folder=item.get("root_folder"), quality_profile=item.get("quality_profile"),
            poster_path=item.get("poster_path"), search_type="episode",
        )

        if state_mode != "disabled":
            add_processed_id("tv_hunt", instance_key, f"{tvdb_id or series_title}S{season_number:02d}E{episode_number:02d}")

        if success:
            processed_any = True
            try:
                from src.primary.stats_manager import increment_stat_only
                increment_stat_only("tv_hunt", "found", 1, str(instance_id))
            except Exception:
                pass
            try:
                from src.primary.utils.history_utils import log_processed_media
                log_processed_media("tv_hunt", f"{series_title} S{season_number:02d}E{episode_number:02d}", tvdb_id, str(instance_id), "missing", display_name_for_log=instance_name)
            except Exception:
                pass

    return processed_any


__all__ = ['process_missing_movies', 'process_missing_episodes']
