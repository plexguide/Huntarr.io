#!/usr/bin/env python3
"""
Quality Upgrade Processing for Readarr
Handles searching for books that need quality upgrades in Readarr
"""

import random
import datetime
from typing import Any, Callable

from src.primary.utils.logger import get_logger
from src.primary.apps.readarr import api as readarr_api
from src.primary.settings_manager import get_custom_tag, load_settings
from src.primary.stats_manager import increment_stat, check_hourly_cap_exceeded
from src.primary.stateful_manager import is_processed, add_processed_id
from src.primary.utils.history_utils import log_processed_media

readarr_logger = get_logger("readarr")


def process_cutoff_upgrades(
    app_settings: dict[str, Any],
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

    readarr_logger.info("Using API timeout of %s seconds for Readarr", api_timeout)

    # Extract necessary settings
    instance_name = app_settings.get("instance_name", "Readarr Default")
    # skip_author_refresh setting removed as it was a performance bottleneck
    hunt_upgrade_books = app_settings.get("hunt_upgrade_books", 0)

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

    readarr_logger.info("Found %s books eligible for quality upgrade.", len(upgrade_eligible_data))

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
                        readarr_logger.debug("Skipping future book ID %s with release date %s", book.get('id'), release_date_str)
                except ValueError:
                    readarr_logger.warning("Could not parse release date '%s' for book ID %s. Including anyway.", release_date_str, book.get('id'))
                    filtered_books.append(book)
            else:
                 filtered_books.append(book) # Include books without a release date

        upgrade_eligible_data = filtered_books
        skipped_count = original_count - len(upgrade_eligible_data)
        if skipped_count > 0:
            readarr_logger.info("Skipped %s future books based on release date for upgrades.", skipped_count)

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
            readarr_logger.debug("Skipping already processed book ID: %s", book_id)

    readarr_logger.info("Found %s unprocessed books out of %s total books eligible for upgrade.", len(unprocessed_books), len(upgrade_eligible_data))

    if not unprocessed_books:
        readarr_logger.info("No unprocessed books found for %s. All available books have been processed.", instance_name)
        return False

    # Always randomly select books to process
    readarr_logger.info("Randomly selecting up to %s books for upgrade search.", hunt_upgrade_books)
    books_to_process = random.sample(unprocessed_books, min(hunt_upgrade_books, len(unprocessed_books)))

    readarr_logger.info("Selected %s books to search for upgrades.", len(books_to_process))
    processed_count = 0
    processed_something = False

    book_ids_to_search = [book.get("id") for book in books_to_process]

    # Check API limit before processing books
    try:
        if check_hourly_cap_exceeded("readarr"):
            readarr_logger.warning("🛑 Readarr API hourly limit reached - stopping upgrade processing")
            return False
    except Exception as e:
        readarr_logger.error("Error checking hourly API cap: %s", e)
        # Continue processing if cap check fails - safer than stopping

    # Mark books as processed BEFORE triggering any searches
    for book_id in book_ids_to_search:
        add_processed_id("readarr", instance_name, str(book_id))
        readarr_logger.debug("Added book ID %s to processed list for %s", book_id, instance_name)

    # Now trigger the search
    search_command_result = readarr_api.search_books(api_url, api_key, book_ids_to_search, api_timeout)

    if search_command_result:
        command_id = search_command_result
        readarr_logger.info("Triggered upgrade search command %s for %s books.", command_id, len(book_ids_to_search))
        increment_stat("readarr", "upgraded")

        # Tag authors if enabled (from books)
        if tag_processed_items:
            custom_tag = get_custom_tag("readarr", "upgrade", "huntarr-upgraded")
            tagged_authors = set()  # Track which authors we've already tagged
            for book in books_to_process:
                author_id = book.get('authorId')
                if author_id and author_id not in tagged_authors:
                    try:
                        readarr_api.tag_processed_author(api_url, api_key, api_timeout, author_id, custom_tag)
                        readarr_logger.debug("Tagged author %s with '%s'", author_id, custom_tag)
                        tagged_authors.add(author_id)
                    except Exception as e:
                        readarr_logger.warning("Failed to tag author %s with '%s': %s", author_id, custom_tag, e)

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
                    readarr_logger.debug("Error fetching author details: %s", e)
                    author_name = f"Author ID {author_id}"
            elif not author_name:
                author_name = "Unknown Author"

            book_title = book.get("title", f"Book ID {book.get('id')}")
            media_name = f"{author_name} - {book_title}"

            # Include full details in history entry
            log_processed_media("readarr", media_name, book.get("id"), instance_name, "upgrade")
            readarr_logger.debug("Logged quality upgrade to history for '%s' (Book ID: %s)", media_name, book.get('id'))


        processed_count += len(book_ids_to_search)
        processed_something = True
        readarr_logger.info("Processed %s book upgrades this cycle.", processed_count)
    else:
        readarr_logger.error("Failed to trigger search for book upgrades.")

    readarr_logger.info("Completed processing %s books for upgrade this cycle.", processed_count)

    return processed_something
