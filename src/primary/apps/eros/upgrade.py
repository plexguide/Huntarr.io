#!/usr/bin/env python3
"""
Quality Upgrade Processing for Eros
Handles searching for items that need quality upgrades in Eros

Exclusively supports the v3 API.
"""

import time
import random
import datetime
from typing import List, Dict, Any, Set, Callable
from src.primary.utils.logger import get_logger
from src.primary.apps.eros import api as eros_api
from src.primary.settings_manager import load_settings, get_advanced_setting
from src.primary.stateful_manager import add_processed_id
from src.primary.stats_manager import increment_stat
from src.primary.utils.history_utils import log_processed_media
from src.primary.state import check_state_reset
from src.primary.apps._common.settings import extract_app_settings, validate_settings
from src.primary.apps._common.filtering import filter_exempt_items, filter_unprocessed
from src.primary.apps._common.processing import should_continue_processing
from src.primary.apps._common.tagging import try_tag_item, extract_tag_settings

# Get logger for the app
eros_logger = get_logger("eros")

def process_cutoff_upgrades(
    app_settings: Dict[str, Any],
    stop_check: Callable[[], bool] # Function to check if stop is requested
) -> bool:
    """
    Process quality cutoff upgrades for Eros based on settings.
    
    Args:
        app_settings: Dictionary containing all settings for Eros
        stop_check: A function that returns True if the process should stop
        
    Returns:
        True if any items were processed for upgrades, False otherwise.
    """
    eros_logger.info(f"Upgrade: checking for {hunt_upgrade_items} items for '{instance_name}'")
    processed_any = False
    
    # Reset state files if enough time has passed
    check_state_reset("eros")
    
    # Extract common settings using shared utility
    # Eros uses hunt_upgrade_items with fallback to hunt_upgrade_scenes
    hunt_key_value = app_settings.get("hunt_upgrade_items", app_settings.get("hunt_upgrade_scenes", 0))
    app_settings["hunt_upgrade_items"] = hunt_key_value  # Normalize for extract
    s = extract_app_settings(app_settings, "eros", "hunt_upgrade_items", "Eros Default")
    instance_name = s['instance_name']
    instance_key = s['instance_key']
    api_url = s['api_url']
    api_key = s['api_key']
    api_timeout = s['api_timeout']
    monitored_only = s['monitored_only']
    hunt_upgrade_items = s['hunt_count']
    tag_settings = extract_tag_settings(app_settings)
    
    # App-specific settings
    search_mode = app_settings.get("search_mode", "movie")
    
    eros_logger.info(f"Using search mode: {search_mode} for quality upgrades")
    eros_logger.debug(f"Using Eros API v3 for instance: {instance_name}")

    if not validate_settings(api_url, api_key, hunt_upgrade_items, "eros", eros_logger):
        return False

    # Check for stop signal
    if stop_check():
        eros_logger.info("Stop requested before starting quality upgrades. Aborting...")
        return False

    # Get items eligible for upgrade
    eros_logger.info(f"Retrieving items eligible for cutoff upgrade...")
    upgrade_eligible_data = eros_api.get_quality_upgrades(api_url, api_key, api_timeout, monitored_only, search_mode)
    
    if not upgrade_eligible_data:
        eros_logger.info("No items found eligible for upgrade or error retrieving them.")
        return False
    
    # Check for stop signal after retrieving eligible items
    if stop_check():
        eros_logger.info("Stop requested after retrieving upgrade eligible items. Aborting...")
        return False
        
    eros_logger.info(f"Found {len(upgrade_eligible_data)} items eligible for quality upgrade.")

    # Filter out items with exempt tags (issue #676)
    upgrade_eligible_data = filter_exempt_items(
        upgrade_eligible_data, s['exempt_tags'], eros_api,
        api_url, api_key, api_timeout,
        get_tags_fn=lambda item: item.get("tags", []),
        get_id_fn=lambda item: item.get("id"),
        get_title_fn=lambda item: item.get("title", "Unknown"),
        app_type="eros", logger=eros_logger
    )

    # Filter out already processed items using shared utility
    unprocessed_items = filter_unprocessed(
        upgrade_eligible_data, "eros", instance_key,
        get_id_fn=lambda item: item.get("id"), logger=eros_logger
    )
    eros_logger.info(f"Upgrade: {len(unprocessed_items)} unprocessed of {len(upgrade_eligible_data)} total items")
    
    if not unprocessed_items:
        eros_logger.info(f"No unprocessed items found for {instance_name}. All available items have been processed.")
        return False
    
    items_processed = 0
    processing_done = False
    
    items_to_upgrade = random.sample(unprocessed_items, min(len(unprocessed_items), hunt_upgrade_items))
    
    eros_logger.info(f"Upgrade: selected {len(items_to_upgrade)} items for search:")
    
    # Process selected items
    for item in items_to_upgrade:
        if not should_continue_processing("eros", stop_check, eros_logger):
            break
            
        # Re-check limit in case it changed
        current_limit = app_settings.get("hunt_upgrade_items", app_settings.get("hunt_upgrade_scenes", 1))
        if items_processed >= current_limit:
            eros_logger.info(f"Reached HUNT_UPGRADE_ITEMS limit ({current_limit}) for this cycle.")
            break
        
        item_id = item.get("id")
        title = item.get("title", "Unknown Title")
        
        # For movies, we don't use season/episode format
        if search_mode == "movie":
            item_info = title
            # In Whisparr, movie quality is stored differently than TV shows
            current_quality = item.get("movieFile", {}).get("quality", {}).get("quality", {}).get("name", "Unknown")
        else:
            # If somehow using scene mode, try to format as S/E if available
            season_number = item.get('seasonNumber')
            episode_number = item.get('episodeNumber')
            if season_number is not None and episode_number is not None:
                season_episode = f"S{season_number:02d}E{episode_number:02d}"
                item_info = f"{title} - {season_episode}"
            else:
                item_info = title
            # Legacy episode quality path
            current_quality = item.get("episodeFile", {}).get("quality", {}).get("quality", {}).get("name", "Unknown")
        
        eros_logger.info(f"Processing item for quality upgrade: \"{item_info}\" (Item ID: {item_id})")
        eros_logger.info(f" - Current quality: {current_quality}")
        
        # Mark the item as processed BEFORE triggering any searches
        add_processed_id("eros", instance_name, str(item_id))
        eros_logger.debug(f"Added item ID {item_id} to processed list for {instance_name}")
        
        # Refresh the item information if not skipped
        refresh_command_id = None
        # Refresh functionality has been removed as it was identified as a performance bottleneck
        
        # Check for stop signal before searching
        if stop_check():
            eros_logger.info(f"Stop requested before searching for {title}. Aborting...")
            break
        
        # Search for the item
        eros_logger.info(" - Searching for quality upgrade...")
        search_command_id = eros_api.item_search(api_url, api_key, api_timeout, [item_id])
        if search_command_id:
            eros_logger.info(f"Triggered search command {search_command_id}. Assuming success for now.")
            
            # Tag the movie if enabled (unified tagging)
            try_tag_item(tag_settings, "upgraded", eros_api.tag_processed_movie,
                         api_url, api_key, api_timeout, item_id,
                         eros_logger, f"movie {item_id}")
            
            # Log to history so the upgrade appears in the history UI
            log_processed_media("eros", item_info, item_id, instance_key, "upgrade", display_name_for_log=app_settings.get("instance_display_name") or instance_name)
            eros_logger.debug(f"Logged quality upgrade to history for item ID {item_id}")
            
            items_processed += 1
            processing_done = True
            
            # Increment the upgraded statistics for Eros
            increment_stat("eros", "upgraded", 1, instance_key)
            eros_logger.debug(f"Incremented eros upgraded statistics by 1")
        else:
            eros_logger.warning(f"Failed to trigger search command for item ID {item_id}.")
            # Do not mark as processed if search couldn't be triggered
            continue
    
    # Log final status
    eros_logger.info(f"Upgrade: processed {items_processed} of {len(items_to_upgrade)} items")
        
    return processing_done
