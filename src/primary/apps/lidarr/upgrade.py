#!/usr/bin/env python3
"""
Lidarr cutoff upgrade processing module for Huntarr
Handles albums that do not meet the configured quality cutoff.
"""

import time
import random
from typing import Dict, Any, Optional, Callable, List, Union, Set # Added List, Union and Set
from src.primary.utils.logger import get_logger
from src.primary.apps.lidarr import api as lidarr_api
from src.primary.utils.history_utils import log_processed_media
from src.primary.stateful_manager import is_processed, add_processed_id
from src.primary.stats_manager import increment_stat, check_hourly_cap_exceeded
from src.primary.settings_manager import load_settings, get_advanced_setting
from src.primary.state import check_state_reset  # Add the missing import

# Get logger for the app
lidarr_logger = get_logger(__name__) # Use __name__ for correct logger hierarchy

def process_cutoff_upgrades(
    app_settings: Dict[str, Any], # Changed signature: Use app_settings
    stop_check: Callable[[], bool] # Changed signature: Use stop_check
) -> bool:
    """
    Processes cutoff upgrades for albums in a specific Lidarr instance.

    Args:
        app_settings (dict): Dictionary containing combined instance and general Lidarr settings.
        stop_check (Callable[[], bool]): Function to check if shutdown is requested.

    Returns:
        bool: True if any items were processed, False otherwise.
    """
    lidarr_logger.info("Starting quality cutoff upgrades processing cycle for Lidarr.")
    processed_any = False

    # --- Extract Settings --- #
    # Instance details are now part of app_settings passed from background loop
    instance_name = app_settings.get("instance_name", "Lidarr Default")
    
    # Extract necessary settings
    api_url = app_settings.get("api_url", "").strip()
    api_key = app_settings.get("api_key", "").strip()
    api_timeout = get_advanced_setting("api_timeout", 120)  # Use database value
    
    # Get command wait settings from database
    command_wait_delay = get_advanced_setting("command_wait_delay", 1)
    command_wait_attempts = get_advanced_setting("command_wait_attempts", 600)

    # General Lidarr settings (also from app_settings)
    hunt_upgrade_items = app_settings.get("hunt_upgrade_items", 0)
    monitored_only = app_settings.get("monitored_only", True)

    lidarr_logger.info(f"Using API timeout of {api_timeout} seconds for Lidarr upgrades")

    lidarr_logger.debug(f"Processing upgrades for instance: {instance_name}")
    # lidarr_logger.debug(f"Instance Config (extracted): {{ 'api_url': '{api_url}', 'api_key': '***' }}")
    # lidarr_logger.debug(f"General Settings (from app_settings): {app_settings}") # Avoid logging full settings potentially containing sensitive info

    # Check if API URL or Key are missing
    if not api_url or not api_key:
        lidarr_logger.error(f"Missing API URL or Key for instance '{instance_name}'. Cannot process upgrades.")
        return False

    # Check if upgrade hunting is enabled
    if hunt_upgrade_items <= 0:
        lidarr_logger.info(f"'hunt_upgrade_items' is {hunt_upgrade_items} or less. Skipping upgrade processing for {instance_name}.")
        return False

    lidarr_logger.info(f"Looking for quality upgrades for {instance_name}")
    lidarr_logger.debug(f"Processing up to {hunt_upgrade_items} items for quality upgrade")
    
    # Reset state files if enough time has passed
    check_state_reset("lidarr")
    
    processed_count = 0
    processed_any = False

    # Load settings to check if tagging is enabled
    lidarr_settings = load_settings("lidarr")
    tag_processed_items = lidarr_settings.get("tag_processed_items", True)

    try:
        lidarr_logger.info(f"Retrieving cutoff unmet albums...")
        # Use efficient random page selection instead of fetching all albums
        cutoff_unmet_data = lidarr_api.get_cutoff_unmet_albums_random_page(
            api_url, api_key, api_timeout, monitored_only, hunt_upgrade_items * 2
        )
        
        if cutoff_unmet_data is None: # API call failed
            lidarr_logger.error("Failed to retrieve cutoff unmet albums from Lidarr API.")
            return False
        
        if not cutoff_unmet_data:
            lidarr_logger.info("No cutoff unmet albums found.")
            return False
        
        lidarr_logger.info(f"Retrieved {len(cutoff_unmet_data)} cutoff unmet albums from random page selection.")

        # Filter out already processed items
        unprocessed_albums = []
        for album in cutoff_unmet_data:
            album_id = str(album.get('id'))
            if not is_processed("lidarr", instance_name, album_id):
                unprocessed_albums.append(album)
            else:
                lidarr_logger.debug(f"Skipping already processed album ID: {album_id}")
        
        lidarr_logger.info(f"Found {len(unprocessed_albums)} unprocessed albums out of {len(cutoff_unmet_data)} total albums eligible for quality upgrade.")
        
        if not unprocessed_albums:
            lidarr_logger.info("No unprocessed albums found for quality upgrade. Skipping cycle.")
            return False

        # Always select albums randomly
        albums_to_search = random.sample(unprocessed_albums, min(len(unprocessed_albums), hunt_upgrade_items))
        lidarr_logger.info(f"Randomly selected {len(albums_to_search)} albums for upgrade search.")

        album_ids_to_search = [album['id'] for album in albums_to_search]

        if not album_ids_to_search:
             lidarr_logger.info("No album IDs selected for upgrade search. Skipping trigger.")
             return False

        # Prepare detailed album information for logging
        album_details_log = []
        for i, album in enumerate(albums_to_search):
            # Extract useful information for logging
            album_title = album.get('title', f'Album ID {album["id"]}')
            artist_name = album.get('artist', {}).get('artistName', 'Unknown Artist')
            quality = album.get('quality', {}).get('quality', {}).get('name', 'Unknown Quality')
            album_details_log.append(f"{i+1}. {artist_name} - {album_title} (ID: {album['id']}, Current Quality: {quality})")

        # Log each album on a separate line for better readability
        if album_details_log:
            lidarr_logger.info(f"Albums selected for quality upgrade in this cycle:")
            for album_detail in album_details_log:
                lidarr_logger.info(f" {album_detail}")

        # Check stop event before triggering search
        if stop_check(): # Use the new stop_check function
            lidarr_logger.warning("Shutdown requested before album upgrade search trigger.")
            return False
        
        # Check API limit before processing albums
        try:
            if check_hourly_cap_exceeded("lidarr"):
                lidarr_logger.warning(f"🛑 Lidarr API hourly limit reached - stopping upgrade processing")
                return False
        except Exception as e:
            lidarr_logger.error(f"Error checking hourly API cap: {e}")
            # Continue processing if cap check fails - safer than stopping

        # Mark the albums as processed BEFORE triggering the search
        for album_id in album_ids_to_search:
            success = add_processed_id("lidarr", instance_name, str(album_id))
            lidarr_logger.debug(f"Added album ID {album_id} to processed list for {instance_name}, success: {success}")

        lidarr_logger.info(f"Triggering Album Search for {len(album_ids_to_search)} albums for upgrade on instance {instance_name}: {album_ids_to_search}")
        # Pass necessary details extracted above to the API function
        command_id = lidarr_api.search_albums(
            api_url,
            api_key,
            api_timeout,
            album_ids_to_search
        )
        if command_id:
            lidarr_logger.debug(f"Upgrade album search command triggered with ID: {command_id} for albums: {album_ids_to_search}")
            increment_stat("lidarr", "upgraded") # Use appropriate stat key
            
            # Tag artists if enabled (from albums)
            if tag_processed_items:
                from src.primary.settings_manager import get_custom_tag
                custom_tag = get_custom_tag("lidarr", "upgrade", "huntarr-upgraded")
                tagged_artists = set()  # Track which artists we've already tagged
                for album in albums_to_search:
                    artist_id = album.get('artistId')
                    if artist_id and artist_id not in tagged_artists:
                        try:
                            lidarr_api.tag_processed_artist(api_url, api_key, api_timeout, artist_id, custom_tag)
                            lidarr_logger.debug(f"Tagged artist {artist_id} with '{custom_tag}'")
                            tagged_artists.add(artist_id)
                        except Exception as e:
                            lidarr_logger.warning(f"Failed to tag artist {artist_id} with '{custom_tag}': {e}")
            
            # Log to history
            for album_id in album_ids_to_search:
                # Find the album info for this ID to log to history
                for album in albums_to_search:
                    if album['id'] == album_id:
                        album_title = album.get('title', f'Album ID {album_id}')
                        artist_name = album.get('artist', {}).get('artistName', 'Unknown Artist')
                        media_name = f"{artist_name} - {album_title}"
                        log_processed_media("lidarr", media_name, album_id, instance_name, "upgrade")
                        lidarr_logger.debug(f"Logged quality upgrade to history for album ID {album_id}")
                        break
                
            time.sleep(command_wait_delay) # Basic delay
            processed_count += len(album_ids_to_search)
            processed_any = True # Mark that we processed something
            # Consider adding wait_for_command logic if needed
            # wait_for_command(api_url, api_key, command_id, command_wait_delay, command_wait_attempts)
        else:
            lidarr_logger.warning(f"Failed to trigger upgrade album search for IDs {album_ids_to_search} on {instance_name}.")

    except Exception as e:
        lidarr_logger.error(f"An error occurred during upgrade album processing for {instance_name}: {e}", exc_info=True)
        return False # Indicate failure

    lidarr_logger.info(f"Upgrade album processing finished for {instance_name}. Triggered searches for {processed_count} items.")
    return processed_any # Return True if anything was processed