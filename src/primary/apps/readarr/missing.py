#!/usr/bin/env python3
"""
Missing Books Processing for Readarr
Handles searching for missing books in Readarr
"""

import random
from typing import Any, Callable

from src.primary.utils.logger import get_logger
from src.primary.apps.readarr import api as readarr_api
from src.primary.stats_manager import increment_stat, check_hourly_cap_exceeded
from src.primary.stateful_manager import is_processed, add_processed_id
from src.primary.utils.history_utils import log_processed_media
from src.primary.settings_manager import get_custom_tag, load_settings, get_advanced_setting

readarr_logger = get_logger("readarr")


def process_missing_books(
    app_settings: dict[str, Any],
    stop_check: Callable[[], bool] # Function to check if stop is requested
) -> bool:
    """
    Process missing books in Readarr based on provided settings.

    Args:
        app_settings: Dictionary containing all settings for Readarr
        stop_check: A function that returns True if the process should stop

    Returns:
        True if any books were processed, False otherwise.
    """
    readarr_logger.info("Starting missing books processing cycle for Readarr.")
    processed_any = False

    # Load settings to check if tagging is enabled
    readarr_settings = load_settings("readarr")
    tag_processed_items = readarr_settings.get("tag_processed_items", True)

    # Extract necessary settings
    api_url = app_settings.get("api_url", "").strip()
    api_key = app_settings.get("api_key", "").strip()
    api_timeout = get_advanced_setting("api_timeout", 120)  # Use database value
    instance_name = app_settings.get("instance_name", "Readarr Default")

    readarr_logger.info("Using API timeout of %s seconds for Readarr", api_timeout)

    monitored_only = app_settings.get("monitored_only", True)
    hunt_missing_books = app_settings.get("hunt_missing_books", 0)

    if not api_url or not api_key:
        readarr_logger.error("API URL or Key not configured in settings. Cannot process missing books.")
        return False

    # Skip if hunt_missing_books is set to 0
    if hunt_missing_books <= 0:
        readarr_logger.info("'hunt_missing_books' setting is 0 or less. Skipping missing book processing.")
        return False

    # Check for stop signal
    if stop_check():
        readarr_logger.info("Stop requested before starting missing books. Aborting...")
        return False

    # Get missing books
    readarr_logger.info("Retrieving books with missing files...")
    # Use efficient random page selection instead of fetching all books
    missing_books_data = readarr_api.get_wanted_missing_books_random_page(
        api_url, api_key, api_timeout, monitored_only, hunt_missing_books * 2
    )

    if missing_books_data is None or not missing_books_data: # API call failed or no books
        if missing_books_data is None:
            readarr_logger.error("Failed to retrieve missing books from Readarr API.")
        else:
            readarr_logger.info("No missing books found.")
        return False

    readarr_logger.info("Retrieved %s missing books from random page selection.", len(missing_books_data))

    # Check for stop signal after retrieving books
    if stop_check():
        readarr_logger.info("Stop requested after retrieving missing books. Aborting...")
        return False

    # Filter out already processed books using stateful management (now book-based instead of author-based)
    unprocessed_books = []
    for book in missing_books_data:
        book_id = str(book.get("id"))
        if not is_processed("readarr", instance_name, book_id):
            unprocessed_books.append(book)
        else:
            readarr_logger.debug("Skipping already processed book ID: %s", book_id)

    readarr_logger.info("Found %s unprocessed missing books out of %s total.", len(unprocessed_books), len(missing_books_data))

    if not unprocessed_books:
        readarr_logger.info("No unprocessed missing books found. All available books have been processed.")
        return False

    # Select individual books to process (fixed: was selecting authors, now selects books)
    readarr_logger.info("Randomly selecting up to %s individual books to search.", hunt_missing_books)
    books_to_process = random.sample(unprocessed_books, min(hunt_missing_books, len(unprocessed_books)))

    readarr_logger.info("Selected %s individual books to search for missing items.", len(books_to_process))

    # Add detailed logging for selected books
    if books_to_process:
        readarr_logger.info("Books selected for processing in this cycle:")
        for idx, book in enumerate(books_to_process):
            book_id = book.get("id")
            book_title = book.get("title", "Unknown Title")
            author_id = book.get("authorId", "Unknown")
            readarr_logger.info("  %s. '%s' (ID: %s, Author ID: %s)", idx+1, book_title, book_id, author_id)

    processed_count = 0
    processed_books = [] # Track book titles processed

    # Process each individual book
    for book in books_to_process:
        if stop_check():
            readarr_logger.info("Stop signal received, aborting Readarr missing cycle.")
            break

        # Check API limit before processing each book
        try:
            if check_hourly_cap_exceeded("readarr"):
                readarr_logger.warning("🛑 Readarr API hourly limit reached - stopping missing books processing after %s books", processed_count)
                break
        except Exception as e:
            readarr_logger.error("Error checking hourly API cap: %s", e)
            # Continue processing if cap check fails - safer than stopping

        book_id = book.get("id")
        book_title = book.get("title", f"Unknown Book ID {book_id}")
        author_id = book.get("authorId")

        # Get author name for logging
        author_info = readarr_api.get_author_details(api_url, api_key, author_id, api_timeout) if author_id else None
        author_name = author_info.get("authorName", f"Author ID {author_id}") if author_info else "Unknown Author"

        readarr_logger.info("Processing missing book: '%s' by %s (Book ID: %s)", book_title, author_name, book_id)

        # Search for this individual book (fixed: was searching all books by author)
        readarr_logger.info("  - Searching for individual book: '%s'...", book_title)

        # Mark book as processed BEFORE triggering search to prevent duplicates
        add_processed_id("readarr", instance_name, str(book_id))
        readarr_logger.debug("Added book ID %s to processed list for %s", book_id, instance_name)

        # Search for the specific book (using book search instead of author search)
        search_command_result = readarr_api.search_books(api_url, api_key, [book_id], api_timeout)

        if search_command_result:
            # Extract command ID if the result is a dictionary, otherwise use the result directly
            command_id = search_command_result.get('id') if isinstance(search_command_result, dict) else search_command_result
            readarr_logger.info("Triggered book search command %s for '%s' by %s.", command_id, book_title, author_name)
            increment_stat("readarr", "hunted")

            # Tag the book's author if enabled (keep author tagging as it's still useful)
            if tag_processed_items and author_id:
                custom_tag = get_custom_tag("readarr", "missing", "huntarr-missing")
                try:
                    readarr_api.tag_processed_author(api_url, api_key, api_timeout, author_id, custom_tag)
                    readarr_logger.debug("Tagged author %s with '%s'", author_id, custom_tag)
                except Exception as e:
                    readarr_logger.warning("Failed to tag author %s with '%s': %s", author_id, custom_tag, e)

            # Log history entry for this specific book
            media_name = f"{author_name} - {book_title}"
            log_processed_media("readarr", media_name, book_id, instance_name, "missing")
            readarr_logger.debug("Logged missing book history entry: %s (ID: %s)", media_name, book_id)

            processed_count += 1
            processed_books.append(f"'{book_title}' by {author_name}")
            processed_any = True
            readarr_logger.info("Processed %s/%s books for missing search this cycle.", processed_count, len(books_to_process))
        else:
            readarr_logger.error("Failed to trigger search for book '%s' by %s.", book_title, author_name)

        if processed_count >= hunt_missing_books:
            readarr_logger.info("Reached target of %s books processed for this cycle.", hunt_missing_books)
            break

    if processed_books:
        # Log first few books, then summarize if there are many
        if len(processed_books) <= 3:
            books_list = ', '.join(processed_books)
            readarr_logger.info('Completed processing %s books for missing search this cycle: %s', processed_count, books_list)
        else:
            first_books = ', '.join(processed_books[:3])
            readarr_logger.info('Completed processing %s books for missing search this cycle: %s and %s others', processed_count, first_books, len(processed_books)-3)
    else:
        readarr_logger.info("Completed processing %s books for missing search this cycle.", processed_count)

    return processed_any
