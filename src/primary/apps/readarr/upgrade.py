#!/usr/bin/env python3
"""
Quality Upgrade Processing for Readarr
Handles searching for books that need quality upgrades in Readarr
"""

import time
import random
import datetime
from typing import List, Dict, Any, Set, Callable, Union, Optional
from src.primary.utils.logger import get_logger
from src.primary.apps.readarr import api as readarr_api
from src.primary.stats_manager import increment_stat, check_hourly_cap_exceeded
from src.primary.stateful_manager import add_processed_id
from src.primary.utils.history_utils import log_processed_media
from src.primary.state import check_state_reset
from src.primary.settings_manager import load_settings
from src.primary.apps._common.settings import extract_app_settings, validate_settings
from src.primary.apps._common.filtering import filter_exempt_items, filter_unprocessed
from src.primary.apps._common.processing import should_continue_processing
from src.primary.apps._common.tagging import try_tag_item

# Get logger for the app
readarr_logger = get_logger("readarr")

def process_cutoff_upgrades(
    app_settings: Dict[str, Any],
    stop_check: Callable[[], bool] # Function to check if stop is requested
) -> bool:
    """
    Process quality cutoff upgrades for Readarr based on settings.
    
    Args:
        app_settings: Dictionary containing all settings for Readarr
        stop_check: A function that returns True if the process should stop
        
    Returns:
        True if any books were processed for upgrades, False otherwise.
    """
    readarr_logger.info(f"Upgrade: checking for {hunt_upgrade_books} books for '{instance_name}'")
    
    # Reset state files if enough time has passed
    check_state_reset("readarr")
    
    processed_any = False
    
    # Extract common settings using shared utility
    s = extract_app_settings(app_settings, "readarr", "hunt_upgrade_books", "Readarr Default")
    instance_name = s['instance_name']
    instance_key = s['instance_key']
    api_url = s['api_url']
    api_key = s['api_key']
    api_timeout = s['api_timeout']
    monitored_only = s['monitored_only']
    hunt_upgrade_books = s['hunt_count']
    tag_settings = s['tag_settings']
    
    # App-specific settings
    upgrade_selection_method = (app_settings.get("upgrade_selection_method") or "cutoff").strip().lower()
    if upgrade_selection_method not in ("cutoff", "tags"):
        upgrade_selection_method = "cutoff"
    upgrade_tag = (app_settings.get("upgrade_tag") or "").strip()
    command_wait_delay = app_settings.get("command_wait_delay", 5)
    command_wait_attempts = app_settings.get("command_wait_attempts", 12)
    
    # Get books eligible for upgrade
    if upgrade_selection_method == "tags":
        if not upgrade_tag:
            readarr_logger.warning("Upgrade selection method is 'Tags' but no upgrade tag is configured. Skipping.")
            return False
        readarr_logger.info(f"Retrieving books whose authors DON'T have tag \"{upgrade_tag}\" (Upgradinatorr-style: tag tracks processed)...")
        upgrade_eligible_data = readarr_api.get_books_without_author_tag(
            api_url, api_key, api_timeout, upgrade_tag, monitored_only
        )
        if upgrade_eligible_data is None:
            return False
        if not upgrade_eligible_data:
            readarr_logger.info(f"No books found whose authors lack the tag \"{upgrade_tag}\" (all have been processed).")
            return False
        readarr_logger.info(f"Found {len(upgrade_eligible_data)} books whose authors DON'T have tag \"{upgrade_tag}\".")
    else:
        readarr_logger.info("Retrieving books eligible for quality upgrade...")
        # Pass API credentials explicitly
        upgrade_eligible_data = readarr_api.get_cutoff_unmet_books(api_url=api_url, api_key=api_key, api_timeout=api_timeout)
        if upgrade_eligible_data is None:  # Check if the API call failed (assuming it returns None on error)
            readarr_logger.error("Error retrieving books eligible for upgrade from Readarr API.")
            return False
        elif not upgrade_eligible_data:  # Check if the list is empty
            readarr_logger.info("No books found eligible for upgrade.")
            return False
        readarr_logger.info(f"Found {len(upgrade_eligible_data)} books eligible for quality upgrade.")

    # Filter out books whose author has an exempt tag (issue #676)
    upgrade_eligible_data = filter_exempt_items(
        upgrade_eligible_data, s['exempt_tags'], readarr_api,
        api_url, api_key, api_timeout,
        get_tags_fn=lambda b: (b.get("author") or {}).get("tags", []),
        get_id_fn=lambda b: b.get("id"),
        get_title_fn=lambda b: b.get("title", "Unknown"),
        app_type="readarr", logger=readarr_logger
    )

    # Filter out future releases if configured
    skip_future_releases = app_settings.get("skip_future_releases", True)
    if skip_future_releases:
        now = datetime.datetime.now().replace(tzinfo=datetime.timezone.utc)
        original_count = len(upgrade_eligible_data)
        filtered_books = []
        for book in upgrade_eligible_data:
            release_date_str = book.get('releaseDate')
            if release_date_str:
                try:
                    # Try to parse ISO format first (with time component)
                    try:
                        # Handle ISO format date strings like '2023-10-17T04:00:00Z'
                        # fromisoformat doesn't handle 'Z' timezone, so we replace it
                        release_date_str_fixed = release_date_str.replace('Z', '+00:00')
                        release_date = datetime.datetime.fromisoformat(release_date_str_fixed)
                    except ValueError:
                        # Fall back to simple YYYY-MM-DD format
                        release_date = datetime.datetime.strptime(release_date_str, '%Y-%m-%d')
                        # Add UTC timezone for consistent comparison
                        release_date = release_date.replace(tzinfo=datetime.timezone.utc)
                    
                    if release_date <= now:
                        filtered_books.append(book)
                    else:
                        readarr_logger.debug(f"Skipping future book ID {book.get('id')} with release date {release_date_str}")
                except ValueError:
                    readarr_logger.warning(f"Could not parse release date '{release_date_str}' for book ID {book.get('id')}. Including anyway.")
                    filtered_books.append(book)
            else:
                 filtered_books.append(book) # Include books without a release date

        upgrade_eligible_data = filtered_books
        skipped_count = original_count - len(upgrade_eligible_data)
        if skipped_count > 0:
            readarr_logger.info(f"Skipped {skipped_count} future books based on release date for upgrades.")

    if not upgrade_eligible_data:
        readarr_logger.info("No upgradeable books found to process (after potential filtering). Skipping.")
        return False
        
    # Filter out already processed books using shared utility
    unprocessed_books = filter_unprocessed(
        upgrade_eligible_data, "readarr", instance_key,
        get_id_fn=lambda b: b.get("id"), logger=readarr_logger
    )
    readarr_logger.info(f"Upgrade: {len(unprocessed_books)} unprocessed of {len(upgrade_eligible_data)} total books")
    
    if not unprocessed_books:
        readarr_logger.info(f"No unprocessed books found for {instance_name}. All available books have been processed.")
        return False

    books_to_process = random.sample(unprocessed_books, min(hunt_upgrade_books, len(unprocessed_books)))

    readarr_logger.info(f"Upgrade: selected {len(books_to_process)} books for search:")
    processed_count = 0
    processed_something = False

    book_ids_to_search = [book.get("id") for book in books_to_process]

    # Check API limit before processing books
    try:
        if check_hourly_cap_exceeded("readarr"):
            readarr_logger.warning(f"🛑 Readarr API hourly limit reached - stopping upgrade processing")
            return False
    except Exception as e:
        readarr_logger.error(f"Error checking hourly API cap: {e}")
        # Continue processing if cap check fails - safer than stopping

    # Mark books as processed BEFORE triggering any searches
    for book_id in book_ids_to_search:
        add_processed_id("readarr", instance_key, str(book_id))
        readarr_logger.debug(f"Added book ID {book_id} to processed list for {instance_name}")
        
    # Now trigger the search
    search_command_result = readarr_api.search_books(api_url, api_key, book_ids_to_search, api_timeout)
        
    if search_command_result:
        command_id = search_command_result
        readarr_logger.info(f"Triggered upgrade search command {command_id} for {len(book_ids_to_search)} books.")
        increment_stat("readarr", "upgraded", 1, instance_key)
        
        # For tag-based method: add the upgrade tag to authors to mark as processed (Upgradinatorr-style)
        if upgrade_selection_method == "tags" and upgrade_tag:
            tagged_authors = set()
            for book in books_to_process:
                author_id = book.get('authorId')
                if author_id and author_id not in tagged_authors:
                    try:
                        tag_id = readarr_api.get_or_create_tag(api_url, api_key, api_timeout, upgrade_tag)
                        if tag_id:
                            readarr_api.add_tag_to_author(api_url, api_key, api_timeout, author_id, tag_id)
                            readarr_logger.debug(f"Added upgrade tag '{upgrade_tag}' to author {author_id} to mark as processed")
                            tagged_authors.add(author_id)
                    except Exception as e:
                        readarr_logger.warning(f"Failed to add upgrade tag '{upgrade_tag}' to author {author_id}: {e}")
        
        # Tag authors with huntarr-upgraded if enabled (unified tagging)
        tagged_authors_upgraded = set()
        for book in books_to_process:
            author_id = book.get('authorId')
            if author_id and author_id not in tagged_authors_upgraded:
                try_tag_item(tag_settings, "upgraded", readarr_api.tag_processed_author,
                             api_url, api_key, api_timeout, author_id,
                             readarr_logger, f"author {author_id}")
                tagged_authors_upgraded.add(author_id)

        # Log to history system for each book
        for book in books_to_process:
            # Ensure we have a valid author name - if missing, fetch it
            author_name = book.get("authorName")
            author_id = book.get("authorId")
            if not author_name and author_id:
                try:
                    # Fetch author details to get the name
                    author_details = readarr_api.get_author_details(api_url, api_key, author_id, api_timeout)
                    if author_details:
                        author_name = author_details.get("authorName", f"Author ID {author_id}")
                    else:
                        author_name = f"Author ID {author_id}"
                except Exception as e:
                    readarr_logger.debug(f"Error fetching author details: {e}")
                    author_name = f"Author ID {author_id}"
            elif not author_name:
                author_name = "Unknown Author"
                
            book_title = book.get("title", f"Book ID {book.get('id')}")
            media_name = f"{author_name} - {book_title}"
            
            # Include full details in history entry
            log_processed_media("readarr", media_name, book.get("id"), instance_key, "upgrade", display_name_for_log=app_settings.get("instance_display_name") or instance_name)
            readarr_logger.debug(f"Logged quality upgrade to history for '{media_name}' (Book ID: {book.get('id')})")

            
        processed_count += len(book_ids_to_search)
        processed_something = True
        readarr_logger.info(f"Processed {processed_count} book upgrades this cycle.")
    else:
        readarr_logger.error(f"Failed to trigger search for book upgrades.")

    readarr_logger.info(f"Upgrade: processed {processed_count} books")
    
    return processed_something