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
from src.primary.stateful_manager import is_processed, add_processed_id
from src.primary.utils.history_utils import log_processed_media
from src.primary.state import check_state_reset
from src.primary.settings_manager import load_settings # Import load_settings function

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
    readarr_logger.info("Starting quality cutoff upgrades processing cycle for Readarr.")
    
    # Reset state files if enough time has passed
    check_state_reset("readarr")
    
    processed_any = False
    
    # Load general settings to get centralized timeout
    general_settings = load_settings('general')
    
    # Load settings to check if tagging is enabled
    readarr_settings = load_settings("readarr")
    tag_processed_items = readarr_settings.get("tag_processed_items", True)
    
    # Get the API credentials for this instance
    api_url = app_settings.get('api_url', '')
    api_key = app_settings.get('api_key', '')
    
    # Use the centralized timeout from general settings with app-specific as fallback
    api_timeout = general_settings.get("api_timeout", app_settings.get("api_timeout", 90))  # Use centralized timeout
    
    readarr_logger.info(f"Using API timeout of {api_timeout} seconds for Readarr")
    
    # Extract necessary settings
    instance_name = app_settings.get("instance_name", "Readarr Default")
    monitored_only = app_settings.get("monitored_only", True)
    # skip_author_refresh setting removed as it was a performance bottleneck
    hunt_upgrade_books = app_settings.get("hunt_upgrade_books", 0)
    command_wait_delay = app_settings.get("command_wait_delay", 5)
    command_wait_attempts = app_settings.get("command_wait_attempts", 12)
    
    # Get books eligible for upgrade
    readarr_logger.info("Retrieving books eligible for quality upgrade...")
    # Pass API credentials explicitly
    upgrade_eligible_data = readarr_api.get_cutoff_unmet_books(api_url=api_url, api_key=api_key, api_timeout=api_timeout)
    
    if upgrade_eligible_data is None: # Check if the API call failed (assuming it returns None on error)
        readarr_logger.error("Error retrieving books eligible for upgrade from Readarr API.")
        return False
    elif not upgrade_eligible_data: # Check if the list is empty
        readarr_logger.info("No books found eligible for upgrade.")
        return False
        
    readarr_logger.info(f"Found {len(upgrade_eligible_data)} books eligible for quality upgrade.")

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
        
    # Filter out already processed books using stateful management
    unprocessed_books = []
    for book in upgrade_eligible_data:
        book_id = str(book.get("id"))
        if not is_processed("readarr", instance_name, book_id):
            unprocessed_books.append(book)
        else:
            readarr_logger.debug(f"Skipping already processed book ID: {book_id}")
    
    readarr_logger.info(f"Found {len(unprocessed_books)} unprocessed books out of {len(upgrade_eligible_data)} total books eligible for upgrade.")
    
    if not unprocessed_books:
        readarr_logger.info(f"No unprocessed books found for {instance_name}. All available books have been processed.")
        return False

    # Always randomly select books to process
    readarr_logger.info(f"Randomly selecting up to {hunt_upgrade_books} books for upgrade search.")
    books_to_process = random.sample(unprocessed_books, min(hunt_upgrade_books, len(unprocessed_books)))

    readarr_logger.info(f"Selected {len(books_to_process)} books to search for upgrades.")
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
        add_processed_id("readarr", instance_name, str(book_id))
        readarr_logger.debug(f"Added book ID {book_id} to processed list for {instance_name}")
        
    # Now trigger the search
    search_command_result = readarr_api.search_books(api_url, api_key, book_ids_to_search, api_timeout)
        
    if search_command_result:
        command_id = search_command_result
        readarr_logger.info(f"Triggered upgrade search command {command_id} for {len(book_ids_to_search)} books.")
        increment_stat("readarr", "upgraded")
        
        # Tag authors if enabled (from books)
        if tag_processed_items:
            from src.primary.settings_manager import get_custom_tag
            custom_tag = get_custom_tag("readarr", "upgrade", "huntarr-upgraded")
            tagged_authors = set()  # Track which authors we've already tagged
            for book in books_to_process:
                author_id = book.get('authorId')
                if author_id and author_id not in tagged_authors:
                    try:
                        readarr_api.tag_processed_author(api_url, api_key, api_timeout, author_id, custom_tag)
                        readarr_logger.debug(f"Tagged author {author_id} with '{custom_tag}'")
                        tagged_authors.add(author_id)
                    except Exception as e:
                        readarr_logger.warning(f"Failed to tag author {author_id} with '{custom_tag}': {e}")
            
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
            log_processed_media("readarr", media_name, book.get("id"), instance_name, "upgrade")
            readarr_logger.debug(f"Logged quality upgrade to history for '{media_name}' (Book ID: {book.get('id')})")

            
        processed_count += len(book_ids_to_search)
        processed_something = True
        readarr_logger.info(f"Processed {processed_count} book upgrades this cycle.")
    else:
        readarr_logger.error(f"Failed to trigger search for book upgrades.")

    readarr_logger.info(f"Completed processing {processed_count} books for upgrade this cycle.")
    
    return processed_something