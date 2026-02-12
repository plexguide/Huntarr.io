"""
TV Hunt: process missing episodes from collection (requested but not yet on disk).
Uses collection + root folder detection; triggers request via discovery.perform_tv_hunt_request.
Supports season pack and individual episode search modes.
"""

from typing import Dict, Any, Callable

from ...utils.logger import get_logger
from src.primary.stateful_manager import add_processed_id
from src.primary.apps._common.filtering import filter_unprocessed

tv_hunt_logger = get_logger("tv_hunt")


def process_missing_episodes(
    app_settings: Dict[str, Any],
    stop_check: Callable[[], bool],
) -> bool:
    """
    Process missing episodes for one TV Hunt instance.
    Gets collection series that have missing episodes (not yet detected on disk),
    up to hunt_missing_episodes, and triggers a request (search + send to client) for each.
    Returns True if any episode was sent to the download client.
    """
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
        tv_hunt_logger.info("TV Hunt instance '%s': hunt_missing_episodes is 0, skipping missing.", instance_name)
        return False

    hunt_missing_mode = app_settings.get("hunt_missing_mode", "seasons_packs")
    skip_future = app_settings.get("skip_future_episodes", True)

    if stop_check():
        return False

    from ...routes.tv_hunt.discovery import _get_collection_config, perform_tv_hunt_request
    from ...routes.tv_hunt.storage import _get_detected_episodes_from_all_roots

    collection = _get_collection_config(instance_id)
    detected = _get_detected_episodes_from_all_roots(instance_id)
    detected_set = set()
    for item in detected:
        t = (item.get("series_title") or "").strip().lower()
        s = item.get("season_number")
        e = item.get("episode_number")
        if t and s is not None and e is not None:
            detected_set.add((t, int(s), int(e)))

    # Build list of missing episodes from collection
    missing_items = []
    from datetime import datetime
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
            if season_number is None:
                continue
            monitored = season.get("monitored", True)
            if not monitored:
                continue
            
            episodes = season.get("episodes") or []
            season_missing = []
            for ep in episodes:
                if not isinstance(ep, dict):
                    continue
                ep_number = ep.get("episode_number")
                if ep_number is None:
                    continue
                ep_monitored = ep.get("monitored", True)
                if not ep_monitored:
                    continue
                
                # Check if already on disk
                key = (series_title.lower(), int(season_number), int(ep_number))
                if key in detected_set:
                    continue
                
                # Skip future episodes
                if skip_future:
                    air_date_str = ep.get("air_date") or ""
                    if air_date_str:
                        try:
                            air_date = datetime.strptime(air_date_str[:10], "%Y-%m-%d")
                            if air_date > now:
                                continue
                        except (ValueError, TypeError):
                            pass
                
                season_missing.append({
                    "series_title": series_title,
                    "tvdb_id": tvdb_id,
                    "season_number": int(season_number),
                    "episode_number": int(ep_number),
                    "episode_title": ep.get("title") or "",
                    "root_folder": series.get("root_folder"),
                    "quality_profile": series.get("quality_profile"),
                    "poster_path": series.get("poster_path"),
                })
            
            missing_items.extend(season_missing)

    if not missing_items:
        tv_hunt_logger.info("TV Hunt instance '%s': no missing collection episodes to process.", instance_name)
        return False

    # Filter out already-processed items (state management)
    instance_key = str(instance_id)
    state_mode = app_settings.get("state_management_mode", "custom")
    if state_mode != "disabled":
        before_count = len(missing_items)
        missing_items = filter_unprocessed(
            missing_items, "tv_hunt", instance_key,
            lambda it: f"{it.get('tvdb_id', it.get('series_title', ''))}S{it['season_number']:02d}E{it['episode_number']:02d}",
            tv_hunt_logger,
        )
        tv_hunt_logger.info(
            "TV Hunt instance '%s': %d unprocessed missing episodes out of %d total.",
            instance_name, len(missing_items), before_count,
        )

    if not missing_items:
        tv_hunt_logger.info("TV Hunt instance '%s': all missing episodes already processed.", instance_name)
        return False

    # Group by season for season pack mode
    if hunt_missing_mode == "seasons_packs":
        return _process_season_packs(missing_items, instance_id, instance_name, instance_key,
                                      hunt_missing_episodes, state_mode, stop_check)
    else:
        return _process_individual_episodes(missing_items, instance_id, instance_name, instance_key,
                                            hunt_missing_episodes, state_mode, stop_check)


def _process_season_packs(missing_items, instance_id, instance_name, instance_key,
                          hunt_limit, state_mode, stop_check):
    """Search for season packs first, grouping missing episodes by series+season."""
    from ...routes.tv_hunt.discovery import perform_tv_hunt_request

    # Group by (series_title, season_number)
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
        if processed_count >= hunt_limit:
            break
        if stop_check():
            break

        # Increment "hunted" stat
        try:
            from src.primary.stats_manager import increment_stat_only
            increment_stat_only("tv_hunt", "hunted", 1, str(instance_id))
        except Exception as e:
            tv_hunt_logger.debug("Could not increment hunted stat: %s", e)

        # Search for season pack: "Show Name S01"
        query = f"{series_title} S{season_number:02d}"
        success, msg = perform_tv_hunt_request(
            instance_id, series_title, season_number=season_number,
            tvdb_id=rep_item.get("tvdb_id"),
            root_folder=rep_item.get("root_folder"),
            quality_profile=rep_item.get("quality_profile"),
            poster_path=rep_item.get("poster_path"),
            search_type="season",
        )

        # Mark all episodes in this season as processed
        if state_mode != "disabled":
            for item in missing_items:
                if item["series_title"] == series_title and item["season_number"] == season_number:
                    track_id = f"{rep_item.get('tvdb_id', series_title)}S{season_number:02d}E{item['episode_number']:02d}"
                    add_processed_id("tv_hunt", instance_key, track_id)

        if success:
            processed_any = True
            processed_count += 1
            tv_hunt_logger.info("TV Hunt missing: '%s' S%02d sent to download client.", series_title, season_number)

            try:
                from src.primary.stats_manager import increment_stat_only
                increment_stat_only("tv_hunt", "found", 1, str(instance_id))
            except Exception as e:
                tv_hunt_logger.debug("Could not increment found stat: %s", e)

            try:
                from ...utils.history_manager import log_processed_media
                log_processed_media("tv_hunt", f"{series_title} S{season_number:02d}", rep_item.get("tvdb_id"), str(instance_id), "missing", display_name_for_log=instance_name)
            except Exception as e:
                tv_hunt_logger.debug("Could not log to history: %s", e)
        else:
            tv_hunt_logger.debug("TV Hunt missing: '%s' S%02d not sent: %s", series_title, season_number, msg)

    return processed_any


def _process_individual_episodes(missing_items, instance_id, instance_name, instance_key,
                                 hunt_limit, state_mode, stop_check):
    """Search for individual episodes."""
    from ...routes.tv_hunt.discovery import perform_tv_hunt_request

    to_process = missing_items[:hunt_limit]
    tv_hunt_logger.info("TV Hunt instance '%s': processing %s missing episode(s) from collection.", instance_name, len(to_process))

    processed_any = False
    for item in to_process:
        if stop_check():
            break
        series_title = item.get("series_title", "").strip()
        season_number = item.get("season_number")
        episode_number = item.get("episode_number")
        tvdb_id = item.get("tvdb_id")

        # Increment "hunted" stat
        try:
            from src.primary.stats_manager import increment_stat_only
            increment_stat_only("tv_hunt", "hunted", 1, str(instance_id))
        except Exception as e:
            tv_hunt_logger.debug("Could not increment hunted stat: %s", e)

        success, msg = perform_tv_hunt_request(
            instance_id, series_title,
            season_number=season_number,
            episode_number=episode_number,
            tvdb_id=tvdb_id,
            root_folder=item.get("root_folder"),
            quality_profile=item.get("quality_profile"),
            poster_path=item.get("poster_path"),
            search_type="episode",
        )

        # Mark as processed
        if state_mode != "disabled":
            track_id = f"{tvdb_id or series_title}S{season_number:02d}E{episode_number:02d}"
            add_processed_id("tv_hunt", instance_key, track_id)

        if success:
            processed_any = True
            tv_hunt_logger.info("TV Hunt missing: '%s' S%02dE%02d sent to download client.", series_title, season_number, episode_number)

            try:
                from src.primary.stats_manager import increment_stat_only
                increment_stat_only("tv_hunt", "found", 1, str(instance_id))
            except Exception as e:
                tv_hunt_logger.debug("Could not increment found stat: %s", e)

            try:
                from ...utils.history_manager import log_processed_media
                log_processed_media("tv_hunt", f"{series_title} S{season_number:02d}E{episode_number:02d}", tvdb_id, str(instance_id), "missing", display_name_for_log=instance_name)
            except Exception as e:
                tv_hunt_logger.debug("Could not log to history: %s", e)
        else:
            tv_hunt_logger.debug("TV Hunt missing: '%s' S%02dE%02d not sent: %s", series_title, season_number, episode_number, msg)

    return processed_any
