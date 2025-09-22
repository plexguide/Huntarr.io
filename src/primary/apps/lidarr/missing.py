#!/usr/bin/env python3
"""
Lidarr missing content processing module for Huntarr
Handles missing albums or artists based on configuration.
"""

import random
import time
from typing import Dict, Any, Callable

from src.primary.apps.lidarr import api as lidarr_api
from src.primary.stats_manager import increment_stat, check_hourly_cap_exceeded
from src.primary.stateful_manager import is_processed, add_processed_id
from src.primary.utils.history_utils import log_processed_media
from src.primary.settings_manager import get_custom_tag, load_settings, get_advanced_setting
from src.primary.utils.logger import get_logger

# Get the logger for the Lidarr module
lidarr_logger = get_logger(__name__) # Use __name__ for correct logger hierarchy


def process_missing_albums(
    app_settings: Dict[str, Any],      # Combined settings dictionary
    stop_check: Callable[[], bool] = None      # Function to check for stop signal
) -> bool:
    """
    Processes missing albums for a specific Lidarr instance based on settings.

    Args:
        app_settings (dict): Dictionary containing combined instance and general settings.
        stop_check (Callable[[], bool]): Function to check if shutdown is requested.

    Returns:
        bool: True if any items were processed, False otherwise.
    """

    # Copy instance-specific information
    instance_name = app_settings.get("instance_name", "Default")
    api_url = app_settings.get("api_url", "").strip()
    api_key = app_settings.get("api_key", "").strip()
    api_timeout = get_advanced_setting("api_timeout", 120)  # Use database value
    monitored_only = app_settings.get("monitored_only", True)
    hunt_missing_items = app_settings.get("hunt_missing_items", 0)
    hunt_missing_mode = app_settings.get("hunt_missing_mode", "album")
    command_wait_delay = get_advanced_setting("command_wait_delay", 1)

    # Early exit for disabled features
    if not api_url or not api_key:
        lidarr_logger.warning("Missing API URL or API key, skipping missing processing for %s", instance_name)
        return False

    if hunt_missing_items <= 0:
        lidarr_logger.debug("Hunting for missing items is disabled (hunt_missing_items=%s) for %s", hunt_missing_items, instance_name)
        return False

    # Make sure any requested stop function is executable
    stop_check = stop_check if callable(stop_check) else lambda: False

    lidarr_logger.info("Looking for missing albums for %s", instance_name)
    lidarr_logger.debug("Processing up to %s missing items in %s mode", hunt_missing_items, hunt_missing_mode)

    # Initialize processed counter and tracking containers
    processed_count = 0
    processed_artists_or_albums = set()
    total_items_to_process = hunt_missing_items

    # Load settings to check if tagging is enabled
    lidarr_settings = load_settings("lidarr")
    tag_processed_items = lidarr_settings.get("tag_processed_items", True)

    try:
        # Get missing albums or artists data based on the hunt_missing_mode
        if hunt_missing_mode == "album":
            lidarr_logger.info("Retrieving missing albums for album-based processing...")
            # Use efficient random page selection instead of fetching all albums
            missing_albums_data = lidarr_api.get_missing_albums_random_page(
                api_url, api_key, api_timeout, monitored_only, total_items_to_process * 2
            )

            if missing_albums_data is None:
                lidarr_logger.error("Failed to retrieve missing albums from Lidarr API.")
                return False

            if not missing_albums_data:
                lidarr_logger.info("No missing albums found.")
                return False

            lidarr_logger.info("Retrieved %s missing albums from random page selection.", len(missing_albums_data))

            # Convert to the expected format for album processing - keep IDs as integers
            unprocessed_entities = []
            for album in missing_albums_data:
                album_id = album.get("id")  # Keep as integer, don't convert to string
                if album_id and not is_processed("lidarr", instance_name, str(album_id)):  # Convert to string only for processed check
                    unprocessed_entities.append(album_id)

            search_entity_type = "album"

        elif hunt_missing_mode == "artist":
            # For artist mode, we still need to get all missing albums to group by artist
            lidarr_logger.info("Retrieving missing albums for artist-based processing...")
            missing_albums_data = lidarr_api.get_missing_albums(api_url, api_key, api_timeout, monitored_only)

            if missing_albums_data is None:
                lidarr_logger.error("Failed to retrieve missing albums from Lidarr API.")
                return False

            if not missing_albums_data:
                lidarr_logger.info("No missing albums found.")
                return False

            lidarr_logger.info("Retrieved %s missing albums.", len(missing_albums_data))

            # Group by artist ID
            items_by_artist = {}
            for item in missing_albums_data: # Use the potentially filtered missing_items list
                artist_id = item.get('artistId')
                lidarr_logger.debug("Missing album item: %s by artistId: %s", item.get('title'), artist_id)
                if artist_id:
                    if artist_id not in items_by_artist:
                        items_by_artist[artist_id] = []
                    items_by_artist[artist_id].append(item)

            # In artist mode, map from artists to their albums
            # First, get all artist IDs
            target_entities = list(items_by_artist.keys())

            # Filter out already processed artists
            lidarr_logger.info("Found %s artists with missing albums before filtering", len(target_entities))
            unprocessed_entities = [eid for eid in target_entities
                                   if not is_processed("lidarr", instance_name, str(eid))]

            lidarr_logger.info("Found %s unprocessed artists out of %s total", len(unprocessed_entities), len(target_entities))
            search_entity_type = "artist"
        else:
            # Fallback case - this should not normally be reached
            lidarr_logger.error("Invalid hunt_missing_mode: %s. Expected 'album' or 'artist'.", hunt_missing_mode)
            return False

        if not unprocessed_entities:
            lidarr_logger.info("No unprocessed %ss found for %s. All available %ss have been processed.", search_entity_type, instance_name, search_entity_type)
            return False

        # Select entities to search
        entities_to_search_ids = random.sample(unprocessed_entities, min(len(unprocessed_entities), total_items_to_process))
        lidarr_logger.info("Randomly selected %s %ss to search.", len(entities_to_search_ids), search_entity_type)
        lidarr_logger.debug("Unprocessed entities: %s", unprocessed_entities)
        lidarr_logger.debug("Entities to search: %s", entities_to_search_ids)

        # --- Trigger Search (Artist or Album) ---
        if hunt_missing_mode == "artist":
            lidarr_logger.info("Artist-based missing mode selected")
            lidarr_logger.info("Found %s unprocessed artists to search.", len(entities_to_search_ids))

            # Prepare a list for artist details log
            artist_details_log = []

            # First, fetch detailed artist info for each artist ID to enhance logs
            artist_details = {}
            for artist_id in entities_to_search_ids:
                # Get artist details from API for better logging
                artist_data = lidarr_api.get_artist_by_id(api_url, api_key, api_timeout, artist_id)
                if artist_data:
                    artist_details[artist_id] = artist_data

            lidarr_logger.info("Artists selected for processing in this cycle:")
            for i, artist_id in enumerate(entities_to_search_ids):
                # Get artist name and any additional details
                artist_name = f"Artist ID {artist_id}" # Default if name not found
                artist_metadata = ""

                if artist_id in artist_details:
                    artist_data = artist_details[artist_id]
                    artist_name = artist_data.get('artistName', artist_name)
                    # Add year active or debut year if available
                    if 'statistics' in artist_data and 'albumCount' in artist_data['statistics']:
                        album_count = artist_data['statistics']['albumCount']
                        artist_metadata = f"({album_count} albums)"
                    # Get genre info if available
                    if 'genres' in artist_data and artist_data['genres']:
                        genres = ", ".join(artist_data['genres'][:2])  # Limit to first 2 genres
                        if artist_metadata:
                            artist_metadata = f"{artist_metadata} - {genres}"
                        else:
                            artist_metadata = f"({genres})"

                detail_line = f"{i+1}. {artist_name} {artist_metadata} - ID: {artist_id}"
                artist_details_log.append(detail_line)
                lidarr_logger.info(" %s", detail_line)

            lidarr_logger.info("Triggering Artist Search for %s artists on %s...", len(entities_to_search_ids), instance_name)
            for i, artist_id in enumerate(entities_to_search_ids):
                if stop_check(): # Use the new stop_check function
                    lidarr_logger.warning("Shutdown requested during artist search trigger.")
                    break

                # Check API limit before processing each artist
                try:
                    if check_hourly_cap_exceeded("lidarr"):
                        lidarr_logger.warning("🛑 Lidarr API hourly limit reached - stopping artist processing after %s artists", processed_count)
                        break
                except Exception as e:
                    lidarr_logger.error("Error checking hourly API cap: %s", e)
                    # Continue processing if cap check fails - safer than stopping

                # Get artist name from cached details or first album
                artist_name = f"Artist ID {artist_id}" # Default if name not found
                if artist_id in artist_details:
                    artist_data = artist_details[artist_id]
                    artist_name = artist_data.get('artistName', artist_name)
                elif artist_id in items_by_artist and items_by_artist[artist_id]:
                    # Fallback to album info if direct artist details not available
                    first_album = items_by_artist[artist_id][0]
                    artist_info = first_album.get('artist')
                    if artist_info and isinstance(artist_info, dict):
                        artist_name = artist_info.get('artistName', artist_name)

                # Mark the artist as processed right away - BEFORE triggering the search
                success = add_processed_id("lidarr", instance_name, str(artist_id))
                lidarr_logger.debug("Added artist ID %s to processed list for %s, success: %s", artist_id, instance_name, success)

                # Trigger the search AFTER marking as processed
                command_result = lidarr_api.search_artist(api_url, api_key, api_timeout, artist_id)
                command_id = command_result.get('id', 'unknown') if command_result else 'failed'
                lidarr_logger.info("Triggered Lidarr ArtistSearch for artist ID: %s, Command ID: %s", artist_id, command_id)

                # Increment stats for UI tracking
                if command_result:
                    increment_stat("lidarr", "hunted")
                    processed_count += 1  # Count successful searches
                    processed_artists_or_albums.add(artist_id)

                    # Tag the artist if enabled
                    if tag_processed_items:
                        custom_tag = get_custom_tag("lidarr", "missing", "huntarr-missing")
                        try:
                            lidarr_api.tag_processed_artist(api_url, api_key, api_timeout, artist_id, custom_tag)
                            lidarr_logger.debug("Tagged artist %s with '%s'", artist_id, custom_tag)
                        except Exception as e:
                            lidarr_logger.warning("Failed to tag artist %s with '%s': %s", artist_id, custom_tag, e)

                # Also mark all albums from this artist as processed
                if artist_id in items_by_artist:
                    for album in items_by_artist[artist_id]:
                        album_id = album.get('id')
                        if album_id:
                            album_success = add_processed_id("lidarr", instance_name, str(album_id))
                            lidarr_logger.debug("Added album ID %s to processed list for %s, success: %s", album_id, instance_name, album_success)

                # Log to history system
                log_processed_media("lidarr", f"{artist_name}", artist_id, instance_name, "missing")
                lidarr_logger.debug("Logged history entry for artist: %s", artist_name)

                time.sleep(0.1) # Small delay between triggers
        else: # Album mode
            album_ids_to_search = list(entities_to_search_ids)
            if stop_check(): # Use the new stop_check function
                lidarr_logger.warning("Shutdown requested before album search trigger.")
                return False

            # Prepare descriptive list for logging
            album_details_log = []
            # Create a dict for quick lookup based on album ID
            missing_items_dict = {item['id']: item for item in missing_albums_data if 'id' in item}

            # First, fetch additional album details for better logging if needed
            album_details = {}
            for album_id in album_ids_to_search:
                album_details[album_id] = lidarr_api.get_albums(api_url, api_key, api_timeout, album_id)

            lidarr_logger.info("Albums selected for processing in this cycle:")
            for idx, album_id in enumerate(album_ids_to_search):
                album_info = missing_items_dict.get(album_id)
                if album_info:
                    # Safely get title and artist name, provide defaults
                    title = album_info.get('title', f'Album ID {album_id}')
                    artist_name = album_info.get('artist', {}).get('artistName', 'Unknown Artist')

                    # Get additional metadata if available
                    release_year = ""
                    if 'releaseDate' in album_info and album_info['releaseDate']:
                        try:
                            release_date = album_info['releaseDate'].split('T')[0]
                            release_year = f"({release_date[:4]})"
                        except (IndexError, ValueError):
                            pass

                    # Get quality if available
                    quality_info = ""
                    if album_details.get(album_id) and 'quality' in album_details[album_id]:
                        quality = album_details[album_id]['quality'].get('quality', {}).get('name', '')
                        if quality:
                            quality_info = f"[{quality}]"

                    detail_line = f"{idx+1}. {artist_name} - {title} {release_year} {quality_info} - ID: {album_id}"
                    album_details_log.append(detail_line)
                    lidarr_logger.info(" %s", detail_line)
                else:
                    # Fallback if album ID wasn't found in the fetched missing items (should be rare)
                    detail_line = f"{idx+1}. Album ID {album_id} (Details not found)"
                    album_details_log.append(detail_line)
                    lidarr_logger.info(" %s", detail_line)

            # Mark the albums as processed BEFORE triggering the search
            for album_id in album_ids_to_search:
                success = add_processed_id("lidarr", instance_name, str(album_id))
                lidarr_logger.debug("Added album ID %s to processed list for %s, success: %s", album_id, instance_name, success)

            # Now trigger the search
            command_id = lidarr_api.search_albums(api_url, api_key, api_timeout, album_ids_to_search)
            if command_id:
                # Log after successful search
                lidarr_logger.debug("Album search command triggered with ID: %s for albums: [%s]", command_id, ', '.join(album_details_log))
                increment_stat("lidarr", "hunted") # Changed from "missing" to "hunted"
                processed_count += len(album_ids_to_search) # Count albums searched
                processed_artists_or_albums.update(album_ids_to_search)

                # Tag artists if enabled (from albums)
                if tag_processed_items:
                    custom_tag = get_custom_tag("lidarr", "missing", "huntarr-missing")
                    tagged_artists = set()  # Track which artists we've already tagged
                    for album_id in album_ids_to_search:
                        album_info = missing_items_dict.get(album_id)
                        if album_info:
                            artist_id = album_info.get('artistId')
                            if artist_id and artist_id not in tagged_artists:
                                try:
                                    lidarr_api.tag_processed_artist(api_url, api_key, api_timeout, artist_id, custom_tag)
                                    lidarr_logger.debug("Tagged artist %s with '%s'", artist_id, custom_tag)
                                    tagged_artists.add(artist_id)
                                except Exception as e:
                                    lidarr_logger.warning("Failed to tag artist %s with '%s': %s", artist_id, custom_tag, e)

                # Log to history system
                for album_id in album_ids_to_search:
                    album_info = missing_items_dict.get(album_id)
                    if album_info:
                        # Get title and artist name for the history entry
                        title = album_info.get('title', f'Album ID {album_id}')
                        artist_name = album_info.get('artist', {}).get('artistName', 'Unknown Artist')
                        media_name = f"{artist_name} - {title}"
                        log_processed_media("lidarr", media_name, album_id, instance_name, "missing")
                        lidarr_logger.debug("Logged history entry for album: %s", media_name)

                time.sleep(command_wait_delay) # Basic delay after the single command
            else:
                lidarr_logger.warning("Failed to trigger album search for IDs %s on %s.", album_ids_to_search, instance_name)

    except Exception as e:
        lidarr_logger.error("An error occurred during missing album processing for %s: %s", instance_name, e, exc_info=True)
        return False

    lidarr_logger.info("Missing album processing finished for %s. Processed %s items/searches (%s unique %ss).", instance_name, processed_count, len(processed_artists_or_albums), search_entity_type)
    return processed_count > 0
