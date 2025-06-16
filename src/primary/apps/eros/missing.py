#!/usr/bin/env python3
"""
Missing Items Processing for Eros
Handles searching for missing items in Eros

Exclusively supports the v3 API.
"""

import time
import random
import datetime
from typing import List, Dict, Any, Set, Callable
from src.primary.utils.logger import get_logger
from src.primary.apps.eros import api as eros_api
from src.primary.settings_manager import load_settings, get_advanced_setting
from src.primary.stateful_manager import is_processed, add_processed_id
from src.primary.stats_manager import increment_stat, check_hourly_cap_exceeded
from src.primary.utils.history_utils import log_processed_media
from src.primary.state import check_state_reset

# Get logger for the app
eros_logger = get_logger("eros")

def process_missing_items(
    app_settings: Dict[str, Any],
    stop_check: Callable[[], bool] # Function to check if stop is requested
) -> bool:
    """
    Process missing items in Eros based on provided settings.
    
    Args:
        app_settings: Dictionary containing all settings for Eros
        stop_check: A function that returns True if the process should stop
    
    Returns:
        True if any items were processed, False otherwise.
    """
    eros_logger.info("Starting missing items processing cycle for Eros.")
    processed_any = False
    
    # Reset state files if enough time has passed
    check_state_reset("eros")
    
    # Load settings to check if tagging is enabled
    eros_settings = load_settings("eros")
    tag_processed_items = eros_settings.get("tag_processed_items", True)
    
    # Extract necessary settings
    api_url = app_settings.get("api_url", "").strip()
    api_key = app_settings.get("api_key", "").strip()
    api_timeout = get_advanced_setting("api_timeout", 120)  # Use database value
    instance_name = app_settings.get("instance_name", "Eros Default")
    
    # Load general settings to get centralized timeout
    general_settings = load_settings('general')
    
    monitored_only = app_settings.get("monitored_only", True)
    skip_future_releases = app_settings.get("skip_future_releases", True)
    # skip_item_refresh setting removed as it was a performance bottleneck
    search_mode = app_settings.get("search_mode", "movie")  # Default to movie mode if not specified
    
    eros_logger.info(f"Using search mode: {search_mode} for missing items")
    
    # Use the new hunt_missing_items parameter name, falling back to hunt_missing_scenes for backwards compatibility
    hunt_missing_items = app_settings.get("hunt_missing_items", app_settings.get("hunt_missing_scenes", 0))
    
    # Use advanced settings from database for command operations
    command_wait_delay = get_advanced_setting("command_wait_delay", 1)
    command_wait_attempts = get_advanced_setting("command_wait_attempts", 600)
    
    # Use the centralized advanced setting for stateful management hours
    stateful_management_hours = get_advanced_setting("stateful_management_hours", 168)
    
    # Log that we're using Eros v3 API
    eros_logger.debug(f"Using Eros API v3 for instance: {instance_name}")

    # Skip if hunt_missing_items is set to a negative value or 0
    if hunt_missing_items <= 0:
        eros_logger.info("'hunt_missing_items' setting is 0 or less. Skipping missing item processing.")
        return False

    # Check for stop signal
    if stop_check():
        eros_logger.info("Stop requested before starting missing items. Aborting...")
        return False
    
    # Get missing items
    eros_logger.info(f"Retrieving items with missing files...")
    missing_items = eros_api.get_items_with_missing(api_url, api_key, api_timeout, monitored_only, search_mode) 
    
    if missing_items is None: # API call failed
        eros_logger.error("Failed to retrieve missing items from Eros API.")
        return False
        
    if not missing_items:
        eros_logger.info("No missing items found.")
        return False
    
    # Check for stop signal after retrieving items
    if stop_check():
        eros_logger.info("Stop requested after retrieving missing items. Aborting...")
        return False
    
    eros_logger.info(f"Found {len(missing_items)} items with missing files.")
    
    # Filter out future releases if configured
    if skip_future_releases:
        now = datetime.datetime.now().replace(tzinfo=datetime.timezone.utc)
        original_count = len(missing_items)
        # Eros item object has 'airDateUtc' for release dates
        missing_items = [
            item for item in missing_items
            if not item.get('airDateUtc') or (
                item.get('airDateUtc') and 
                datetime.datetime.fromisoformat(item['airDateUtc'].replace('Z', '+00:00')) < now
            )
        ]
        skipped_count = original_count - len(missing_items)
        if skipped_count > 0:
            eros_logger.info(f"Skipped {skipped_count} future item releases based on air date.")

    if not missing_items:
        eros_logger.info("No missing items left to process after filtering future releases.")
        return False
        
    # Filter out already processed items using stateful management
    unprocessed_items = []
    for item in missing_items:
        item_id = str(item.get("id"))
        if not is_processed("eros", instance_name, item_id):
            unprocessed_items.append(item)
        else:
            eros_logger.debug(f"Skipping already processed item ID: {item_id}")
    
    eros_logger.info(f"Found {len(unprocessed_items)} unprocessed items out of {len(missing_items)} total items with missing files.")
    
    if not unprocessed_items:
        eros_logger.info(f"No unprocessed items found for {instance_name}. All available items have been processed.")
        return False
        
    items_processed = 0
    processing_done = False
    
    # Select items to search based on configuration
    eros_logger.info(f"Randomly selecting up to {hunt_missing_items} missing items.")
    items_to_search = random.sample(unprocessed_items, min(len(unprocessed_items), hunt_missing_items))
    
    eros_logger.info(f"Selected {len(items_to_search)} missing items to search.")

    # Process selected items
    for item in items_to_search:
        # Check for stop signal before each item
        if stop_check():
            eros_logger.info("Stop requested during item processing. Aborting...")
            break
        
        # Check API limit before processing each item
        try:
            if check_hourly_cap_exceeded("eros"):
                eros_logger.warning(f"🛑 Eros API hourly limit reached - stopping missing items processing after {items_processed} items")
                break
        except Exception as e:
            eros_logger.error(f"Error checking hourly API cap: {e}")
            # Continue processing if cap check fails - safer than stopping
        
        # Re-check limit in case it changed
        current_limit = app_settings.get("hunt_missing_items", app_settings.get("hunt_missing_scenes", 1))
        if items_processed >= current_limit:
             eros_logger.info(f"Reached HUNT_MISSING_ITEMS limit ({current_limit}) for this cycle.")
             break

        item_id = item.get("id")
        title = item.get("title", "Unknown Title")
        
        # For movies, we don't use season/episode format
        if search_mode == "movie":
            item_info = title
        else:
            # If somehow using scene mode, try to format as S/E if available
            season_number = item.get('seasonNumber')
            episode_number = item.get('episodeNumber')
            if season_number is not None and episode_number is not None:
                season_episode = f"S{season_number:02d}E{episode_number:02d}"
                item_info = f"{title} - {season_episode}"
            else:
                item_info = title
        
        eros_logger.info(f"Processing missing item: \"{item_info}\" (Item ID: {item_id})")
        
        # Mark the item as processed BEFORE triggering any searches
        add_processed_id("eros", instance_name, str(item_id))
        eros_logger.debug(f"Added item ID {item_id} to processed list for {instance_name}")
        
        # Refresh functionality has been removed as it was identified as a performance bottleneck
        
        # Check for stop signal before searching
        if stop_check():
            eros_logger.info(f"Stop requested before searching for {title}. Aborting...")
            break
        
        # Search for the item
        eros_logger.info(" - Searching for missing item...")
        search_command_id = eros_api.item_search(api_url, api_key, api_timeout, [item_id])
        if search_command_id:
            eros_logger.info(f"Triggered search command {search_command_id}. Assuming success for now.")
            
            # Tag the movie if enabled
            if tag_processed_items:
                from src.primary.settings_manager import get_custom_tag
                custom_tag = get_custom_tag("eros", "missing", "huntarr-missing")
                try:
                    eros_api.tag_processed_movie(api_url, api_key, api_timeout, item_id, custom_tag)
                    eros_logger.debug(f"Tagged movie {item_id} with '{custom_tag}'")
                except Exception as e:
                    eros_logger.warning(f"Failed to tag movie {item_id} with '{custom_tag}': {e}")
            
            # Log to history system
            log_processed_media("eros", item_info, item_id, instance_name, "missing")
            eros_logger.debug(f"Logged history entry for item: {item_info}")
            
            items_processed += 1
            processing_done = True
            
            # Increment the hunted statistics for Eros
            increment_stat("eros", "hunted", 1)
            eros_logger.debug(f"Incremented eros hunted statistics by 1")

            # Log progress
            current_limit = app_settings.get("hunt_missing_items", app_settings.get("hunt_missing_scenes", 1))
            eros_logger.info(f"Processed {items_processed}/{current_limit} missing items this cycle.")
        else:
            eros_logger.warning(f"Failed to trigger search command for item ID {item_id}.")
            # Do not mark as processed if search couldn't be triggered
            continue
    
    # Log final status
    if items_processed > 0:
        eros_logger.info(f"Completed processing {items_processed} missing items for this cycle.")
    else:
        eros_logger.info("No new missing items were processed in this run.")
        
    return processing_done

# For backward compatibility with the background processing system
def process_missing_scenes(app_settings, stop_check):
    """
    Backwards compatibility function that calls process_missing_items.
    
    Args:
        app_settings: Dictionary containing all settings for Eros
        stop_check: A function that returns True if the process should stop
    
    Returns:
        Result from process_missing_items
    """
    return process_missing_items(app_settings, stop_check)
