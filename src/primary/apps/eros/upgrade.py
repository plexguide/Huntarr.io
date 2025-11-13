#!/usr/bin/env python3
"""
Quality Upgrade Processing for Eros
Handles searching for items that need quality upgrades in Eros

Exclusively supports the v3 API.
"""

import random
from typing import Any, Callable

from src.primary.apps.eros import api as eros_api
from src.primary.settings_manager import load_settings, get_advanced_setting
from src.primary.stateful_manager import is_processed, add_processed_id
from src.primary.stats_manager import increment_stat, check_hourly_cap_exceeded
from src.primary.utils.history_utils import log_processed_media
from src.primary.utils.logger import get_logger

eros_logger = get_logger("eros")


def process_cutoff_upgrades(
    app_settings: dict[str, Any],
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
    eros_logger.info("Starting quality cutoff upgrades processing cycle for Eros.")

    # Load settings to check if tagging is enabled
    eros_settings = load_settings("eros")
    tag_processed_items = eros_settings.get("tag_processed_items", True)

    # Extract necessary settings
    api_url = app_settings.get("api_url", "").strip()
    api_key = app_settings.get("api_key", "").strip()
    api_timeout = get_advanced_setting("api_timeout", 120)  # Use database value
    instance_name = app_settings.get("instance_name", "Eros Default")

    monitored_only = app_settings.get("monitored_only", True)
    # skip_item_refresh setting removed as it was a performance bottleneck
    search_mode = app_settings.get("search_mode", "movie")  # Default to movie mode if not specified

    eros_logger.info("Using search mode: %s for quality upgrades", search_mode)

    # Use the new hunt_upgrade_items parameter name, falling back to hunt_upgrade_scenes for backwards compatibility
    hunt_upgrade_items = app_settings.get("hunt_upgrade_items", app_settings.get("hunt_upgrade_scenes", 0))

    # Log that we're using Eros API v3
    eros_logger.debug("Using Eros API v3 for instance: %s", instance_name)

    # Skip if hunt_upgrade_items is set to 0
    if hunt_upgrade_items <= 0:
        eros_logger.info("'hunt_upgrade_items' setting is 0 or less. Skipping quality upgrade processing.")
        return False

    # Check for stop signal
    if stop_check():
        eros_logger.info("Stop requested before starting quality upgrades. Aborting...")
        return False

    # Get items eligible for upgrade
    eros_logger.info("Retrieving items eligible for cutoff upgrade...")
    upgrade_eligible_data = eros_api.get_quality_upgrades(api_url, api_key, api_timeout, monitored_only, search_mode)

    if not upgrade_eligible_data:
        eros_logger.info("No items found eligible for upgrade or error retrieving them.")
        return False

    # Check for stop signal after retrieving eligible items
    if stop_check():
        eros_logger.info("Stop requested after retrieving upgrade eligible items. Aborting...")
        return False

    eros_logger.info("Found %s items eligible for quality upgrade.", len(upgrade_eligible_data))

    # Filter out already processed items using stateful management
    unprocessed_items = []
    for item in upgrade_eligible_data:
        item_id = str(item.get("id"))
        if not is_processed("eros", instance_name, item_id):
            unprocessed_items.append(item)
        else:
            eros_logger.debug("Skipping already processed item ID: %s", item_id)

    eros_logger.info("Found %s unprocessed items out of %s total items eligible for quality upgrade.", len(unprocessed_items), len(upgrade_eligible_data))

    if not unprocessed_items:
        eros_logger.info("No unprocessed items found for %s. All available items have been processed.", instance_name)
        return False

    items_processed = 0
    processing_done = False

    # Always use random selection for upgrades
    eros_logger.info("Randomly selecting up to %s items for quality upgrade.", hunt_upgrade_items)
    items_to_upgrade = random.sample(unprocessed_items, min(len(unprocessed_items), hunt_upgrade_items))

    eros_logger.info("Selected %s items for quality upgrade.", len(items_to_upgrade))

    # Process selected items
    for item in items_to_upgrade:
        # Check for stop signal before each item
        if stop_check():
            eros_logger.info("Stop requested during item processing. Aborting...")
            break

        # Check API limit before processing each item
        try:
            if check_hourly_cap_exceeded("eros"):
                eros_logger.warning("🛑 Eros API hourly limit reached - stopping upgrade processing after %s items", items_processed)
                break
        except Exception as e:
            eros_logger.error("Error checking hourly API cap: %s", e)
            # Continue processing if cap check fails - safer than stopping

        # Re-check limit in case it changed
        current_limit = app_settings.get("hunt_upgrade_items", app_settings.get("hunt_upgrade_scenes", 1))
        if items_processed >= current_limit:
            eros_logger.info("Reached HUNT_UPGRADE_ITEMS limit (%s) for this cycle.", current_limit)
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

        eros_logger.info("Processing item for quality upgrade: \"%s\" (Item ID: %s)", item_info, item_id)
        eros_logger.info(" - Current quality: %s", current_quality)

        # Mark the item as processed BEFORE triggering any searches
        add_processed_id("eros", instance_name, str(item_id))
        eros_logger.debug("Added item ID %s to processed list for %s", item_id, instance_name)

        # Check for stop signal before searching
        if stop_check():
            eros_logger.info("Stop requested before searching for %s. Aborting...", title)
            break

        # Search for the item
        eros_logger.info(" - Searching for quality upgrade...")
        search_command_id = eros_api.item_search(api_url, api_key, api_timeout, [item_id])
        if search_command_id:
            eros_logger.info("Triggered search command %s. Assuming success for now.", search_command_id)

            # Tag the movie if enabled
            if tag_processed_items:
                from src.primary.settings_manager import get_custom_tag
                custom_tag = get_custom_tag("eros", "upgrade", "huntarr-upgraded")
                try:
                    eros_api.tag_processed_movie(api_url, api_key, api_timeout, item_id, custom_tag)
                    eros_logger.debug("Tagged movie %s with '%s'", item_id, custom_tag)
                except Exception as e:
                    eros_logger.warning("Failed to tag movie %s with '%s': %s", item_id, custom_tag, e)

            # Log to history so the upgrade appears in the history UI
            log_processed_media("eros", item_info, item_id, instance_name, "upgrade")
            eros_logger.debug("Logged quality upgrade to history for item ID %s", item_id)

            items_processed += 1
            processing_done = True

            # Increment the upgraded statistics for Eros
            increment_stat("eros", "upgraded", 1)
            eros_logger.debug("Incremented eros upgraded statistics by 1")

            # Log progress
            current_limit = app_settings.get("hunt_upgrade_items", app_settings.get("hunt_upgrade_scenes", 1))
            eros_logger.info("Processed %s/%s items for quality upgrade this cycle.", items_processed, current_limit)
        else:
            eros_logger.warning("Failed to trigger search command for item ID %s.", item_id)
            # Do not mark as processed if search couldn't be triggered
            continue

    # Log final status
    if items_processed > 0:
        eros_logger.info("Completed processing %s items for quality upgrade for this cycle.", items_processed)
    else:
        eros_logger.info("No new items were processed for quality upgrade in this run.")

    return processing_done
