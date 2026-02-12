"""
Movie Hunt: process missing movies from collection (requested but not yet on disk).
Uses collection + root folder detection; triggers request via discovery.perform_movie_hunt_request.
"""

from typing import Dict, Any, Callable

from ...utils.logger import get_logger
from src.primary.stateful_manager import add_processed_id
from src.primary.apps._common.filtering import filter_unprocessed

movie_hunt_logger = get_logger("movie_hunt")


def process_missing_movies(
    app_settings: Dict[str, Any],
    stop_check: Callable[[], bool],
) -> bool:
    """
    Process missing movies for one Movie Hunt instance.
    Gets collection items that are requested but not yet detected on disk,
    up to hunt_missing_movies, and triggers a request (search + send to client) for each.
    Returns True if any movie was sent to the download client.
    """
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

    from ...routes.movie_hunt.discovery import _get_collection_config, _save_collection_config, perform_movie_hunt_request, check_minimum_availability
    from ...routes.movie_hunt.storage import _get_detected_movies_from_all_roots

    collection = _get_collection_config(instance_id)
    detected = _get_detected_movies_from_all_roots(instance_id)
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

        # Track if check_minimum_availability backfilled dates (it mutates the item dict)
        old_dates = (it.get('in_cinemas', ''), it.get('digital_release', ''), it.get('physical_release', ''))

        # Check minimum availability before adding to search queue
        if not check_minimum_availability(it):
            min_avail = it.get("minimum_availability", "released")
            movie_hunt_logger.debug(
                "Movie Hunt missing: skipping '%s' (%s) — minimum availability '%s' not met yet.",
                title, year or "no year", min_avail
            )
        else:
            missing_items.append({"title": title, "year": year, "tmdb_id": it.get("tmdb_id"), "root_folder": it.get("root_folder"), "quality_profile": it.get("quality_profile"), "poster_path": it.get("poster_path")})

        # If check_minimum_availability fetched and stored new dates on the item, mark for save
        new_dates = (it.get('in_cinemas', ''), it.get('digital_release', ''), it.get('physical_release', ''))
        if new_dates != old_dates:
            dates_backfilled = True

    # Persist any backfilled release dates so future cycles don't re-fetch
    if dates_backfilled:
        try:
            _save_collection_config(collection, instance_id)
            movie_hunt_logger.info("Movie Hunt instance '%s': backfilled release dates for collection items.", instance_name)
        except Exception as e:
            movie_hunt_logger.debug("Could not save backfilled dates: %s", e)

    if not missing_items:
        movie_hunt_logger.info("Movie Hunt instance '%s': no missing collection items to process.", instance_name)
        return False

    # Filter out already-processed items (state management) — same pattern as Radarr
    instance_key = str(instance_id)
    state_mode = app_settings.get("state_management_mode", "custom")
    if state_mode != "disabled":
        before_count = len(missing_items)
        missing_items = filter_unprocessed(
            missing_items, "movie_hunt", instance_key,
            lambda it: str(it.get("tmdb_id") or it.get("title", "")),
            movie_hunt_logger,
        )
        movie_hunt_logger.info(
            "Movie Hunt instance '%s': %d unprocessed missing movies out of %d total.",
            instance_name, len(missing_items), before_count,
        )

    if not missing_items:
        movie_hunt_logger.info("Movie Hunt instance '%s': all missing movies already processed.", instance_name)
        return False

    to_process = missing_items[:hunt_missing_movies]
    movie_hunt_logger.info("Movie Hunt instance '%s': processing %s missing movie(s) from collection.", instance_name, len(to_process))

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

        # Increment "hunted" stat on every search ATTEMPT (matches Radarr/Sonarr behavior
        # where hunted = "triggered search", not just "found and downloaded").
        # Use str(instance_id) as the key — must match what get_configured_instances returns
        # as "instance_id" so the stats API lookup finds the right per-instance record.
        try:
            from src.primary.stats_manager import increment_stat_only
            increment_stat_only("movie_hunt", "hunted", 1, str(instance_id))
        except Exception as e:
            movie_hunt_logger.debug("Could not increment hunted stat: %s", e)

        success, msg = perform_movie_hunt_request(
            instance_id, title, year,
            root_folder=root_folder, quality_profile=quality_profile,
            tmdb_id=tmdb_id, poster_path=poster_path,
        )

        # Mark as processed after every search ATTEMPT (not just success).
        # This matches Radarr/Sonarr behavior — "processed" means "we searched for it",
        # not "we found and downloaded it".  The reset interval will clear tracked items
        # so they can be re-checked later.
        # Use same ID derivation as filter_unprocessed: tmdb_id first, title fallback.
        if state_mode != "disabled":
            track_id = str(tmdb_id) if tmdb_id else title
            if track_id:
                add_processed_id("movie_hunt", instance_key, track_id)
                movie_hunt_logger.debug("Movie Hunt state: tracked '%s' (id=%s) for instance '%s'.", title, track_id, instance_name)

        if success:
            processed_any = True
            movie_hunt_logger.info("Movie Hunt missing: '%s' (%s) sent to download client.", title, year or "no year")

            # Increment "found" stat (successful search — release was found and sent to client)
            try:
                from src.primary.stats_manager import increment_stat_only
                increment_stat_only("movie_hunt", "found", 1, str(instance_id))
            except Exception as e:
                movie_hunt_logger.debug("Could not increment found stat: %s", e)

            try:
                from ...utils.history_manager import log_processed_media
                log_processed_media("movie_hunt", f"{title} ({year})" if year else title, tmdb_id, str(instance_id), "missing", display_name_for_log=instance_name)
            except Exception as e:
                movie_hunt_logger.debug("Could not log to history: %s", e)
        else:
            movie_hunt_logger.debug("Movie Hunt missing: '%s' (%s) not sent: %s", title, year or "no year", msg)

    return processed_any
