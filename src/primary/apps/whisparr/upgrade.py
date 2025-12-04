#!/usr/bin/env python3
"""
Quality Upgrade Processing for Whisparr
Handles searching for items that need quality upgrades in Whisparr

Supports both v2 (legacy) and v3 (Eros) API versions
"""

import random
from typing import Any, Callable

from src.primary.utils.logger import get_logger
from src.primary.apps.whisparr import api as whisparr_api
from src.primary.settings_manager import get_custom_tag, load_settings, get_advanced_setting
from src.primary.stateful_manager import is_processed, add_processed_id
from src.primary.stats_manager import increment_stat, check_hourly_cap_exceeded
from src.primary.utils.history_utils import log_processed_media

# Get logger for the app
whisparr_logger = get_logger("whisparr")

def process_cutoff_upgrades(
    app_settings: dict[str, Any],
    stop_check: Callable[[], bool] # Function to check if stop is requested
) -> bool:
    """
    Process quality cutoff upgrades for Whisparr based on settings.

    Args:
        app_settings: Dictionary containing all settings for Whisparr
        stop_check: A function that returns True if the process should stop

    Returns:
        True if any items were processed for upgrades, False otherwise.
    """
    whisparr_logger.info("Starting quality cutoff upgrades processing cycle for Whisparr.")

    # Load settings to check if tagging is enabled
    whisparr_settings = load_settings("whisparr")
    tag_processed_items = whisparr_settings.get("tag_processed_items", True)

    # Extract necessary settings
    api_url = app_settings.get("api_url", "").strip()
    api_key = app_settings.get("api_key", "").strip()
    api_timeout = get_advanced_setting("api_timeout", 120)  # Use database value
    instance_name = app_settings.get("instance_name", "Whisparr Default")

    monitored_only = app_settings.get("monitored_only", True)
    # skip_item_refresh setting removed as it was a performance bottleneck

    # Use the new hunt_upgrade_items parameter name, falling back to hunt_upgrade_scenes for backwards compatibility
    hunt_upgrade_items = app_settings.get("hunt_upgrade_items", app_settings.get("hunt_upgrade_scenes", 0))

    # Log that we're using Whisparr V2 API
    whisparr_logger.debug("Using Whisparr V2 API for instance: %s", instance_name)

    # Skip if hunt_upgrade_items is set to 0
    if hunt_upgrade_items <= 0:
        whisparr_logger.info("'hunt_upgrade_items' setting is 0 or less. Skipping quality upgrade processing.")
        return False

    # Check for stop signal
    if stop_check():
        whisparr_logger.info("Stop requested before starting quality upgrades. Aborting...")
        return False

    # Get items eligible for upgrade
    whisparr_logger.info("Retrieving items eligible for cutoff upgrade...")
    upgrade_eligible_data = whisparr_api.get_cutoff_unmet_items(api_url, api_key, api_timeout, monitored_only)

    if not upgrade_eligible_data:
        whisparr_logger.info("No items found eligible for upgrade or error retrieving them.")
        return False

    # Check for stop signal after retrieving eligible items
    if stop_check():
        whisparr_logger.info("Stop requested after retrieving upgrade eligible items. Aborting...")
        return False

    whisparr_logger.info("Found %s items eligible for quality upgrade.", len(upgrade_eligible_data))

    # Filter out already processed items using stateful management
    unprocessed_items = []
    for item in upgrade_eligible_data:
        item_id = str(item.get("id"))
        if not is_processed("whisparr", instance_name, item_id):
            unprocessed_items.append(item)
        else:
            whisparr_logger.debug("Skipping already processed item ID: %s", item_id)

    whisparr_logger.info("Found %s unprocessed items out of %s total items eligible for quality upgrade.", len(unprocessed_items), len(upgrade_eligible_data))

    if not unprocessed_items:
        whisparr_logger.info("No unprocessed items found for %s. All available items have been processed.", instance_name)
        return False

    items_processed = 0
    processing_done = False

    # Always use random selection for upgrades
    whisparr_logger.info("Randomly selecting up to %s items for quality upgrade.", hunt_upgrade_items)
    items_to_upgrade = random.sample(unprocessed_items, min(len(unprocessed_items), hunt_upgrade_items))

    whisparr_logger.info("Selected %s items for quality upgrade.", len(items_to_upgrade))

    # Process selected items
    for item in items_to_upgrade:
        # Check for stop signal before each item
        if stop_check():
            whisparr_logger.info("Stop requested during item processing. Aborting...")
            break

        # Check API limit before processing each item
        try:
            if check_hourly_cap_exceeded("whisparr"):
                whisparr_logger.warning("🛑 Whisparr API hourly limit reached - stopping upgrade processing after %s items", items_processed)
                break
        except Exception as e:
            whisparr_logger.error("Error checking hourly API cap: %s", e)
            # Continue processing if cap check fails - safer than stopping

        # Re-check limit in case it changed
        current_limit = app_settings.get("hunt_upgrade_items", app_settings.get("hunt_upgrade_scenes", 1))
        if items_processed >= current_limit:
            whisparr_logger.info("Reached HUNT_UPGRADE_ITEMS limit (%s) for this cycle.", current_limit)
            break

        item_id = item.get("id")
        title = item.get("title", "Unknown Title")
        season_episode = f"S{item.get('seasonNumber', 0):02d}E{item.get('episodeNumber', 0):02d}"

        current_quality = item.get("episodeFile", {}).get("quality", {}).get("quality", {}).get("name", "Unknown")

        whisparr_logger.info("Processing item for quality upgrade: \"%s\" - %s (Item ID: %s)", title, season_episode, item_id)
        whisparr_logger.info(" - Current quality: %s", current_quality)

        # Refresh functionality has been removed as it was identified as a performance bottleneck

        # Check for stop signal before searching
        if stop_check():
            whisparr_logger.info("Stop requested before searching for %s. Aborting...", title)
            break

        # Mark the item as processed BEFORE triggering any searches
        add_processed_id("whisparr", instance_name, str(item_id))
        whisparr_logger.debug("Added item ID %s to processed list for %s", item_id, instance_name)

        # Search for the item
        whisparr_logger.info(" - Searching for quality upgrade...")
        search_command_id = whisparr_api.item_search(api_url, api_key, api_timeout, [item_id])
        if search_command_id:
            whisparr_logger.info("Triggered search command %s. Assuming success for now.", search_command_id)

            # Tag the series if enabled
            if tag_processed_items:
                custom_tag = get_custom_tag("whisparr", "upgrade", "huntarr-upgraded")
                series_id = item.get('seriesId')
                if series_id:
                    try:
                        whisparr_api.tag_processed_series(api_url, api_key, api_timeout, series_id, custom_tag)
                        whisparr_logger.debug("Tagged series %s with '%s'", series_id, custom_tag)
                    except Exception as e:
                        whisparr_logger.warning("Failed to tag series %s with '%s': %s", series_id, custom_tag, e)

            # Log to history so the upgrade appears in the history UI
            series_title = item.get("series", {}).get("title", "Unknown Series")
            media_name = f"{series_title} - {season_episode} - {title}"
            log_processed_media("whisparr", media_name, item_id, instance_name, "upgrade")
            whisparr_logger.debug("Logged quality upgrade to history for item ID %s", item_id)

            items_processed += 1
            processing_done = True

            # Increment the upgraded statistics for Whisparr
            increment_stat("whisparr", "upgraded", 1)
            whisparr_logger.debug("Incremented whisparr upgraded statistics by 1")

            # Log progress
            current_limit = app_settings.get("hunt_upgrade_items", app_settings.get("hunt_upgrade_scenes", 1))
            whisparr_logger.info("Processed %s/%s items for quality upgrade this cycle.", items_processed, current_limit)
        else:
            whisparr_logger.warning("Failed to trigger search command for item ID %s.", item_id)
            # Do not mark as processed if search couldn't be triggered
            continue

    # Log final status
    if items_processed > 0:
        whisparr_logger.info("Completed processing %s items for quality upgrade for this cycle.", items_processed)
    else:
        whisparr_logger.info("No new items were processed for quality upgrade in this run.")

    return processing_done
