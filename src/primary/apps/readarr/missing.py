#!/usr/bin/env python3
"""
Missing Books Processing for Readarr
Handles searching for missing books in Readarr
"""

import time
import random
from typing import List, Dict, Any, Set, Callable
from src.primary.utils.logger import get_logger
from src.primary.apps.readarr import api as readarr_api
from src.primary.stats_manager import increment_stat
from src.primary.stateful_manager import add_processed_id
from src.primary.utils.history_utils import log_processed_media
from src.primary.settings_manager import load_settings
from src.primary.state import check_state_reset
from src.primary.apps._common.settings import extract_app_settings, validate_settings
from src.primary.apps._common.filtering import filter_exempt_items, filter_unprocessed
from src.primary.apps._common.processing import should_continue_processing
from src.primary.apps._common.tagging import try_tag_item

# Get logger for the app
readarr_logger = get_logger("readarr")

def process_missing_books(
    app_settings: Dict[str, Any],
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
    processed_any = False
    
    # Reset state files if enough time has passed
    check_state_reset("readarr")
    
    # Extract common settings using shared utility
    s = extract_app_settings(app_settings, "readarr", "hunt_missing_books", "Readarr Default")
    instance_name = s['instance_name']
    instance_key = s['instance_key']
    api_url = s['api_url']
    api_key = s['api_key']
    api_timeout = s['api_timeout']
    monitored_only = s['monitored_only']
    hunt_missing_books = s['hunt_count']
    tag_settings = s['tag_settings']
    
    readarr_logger.info(f"Missing: checking for {hunt_missing_books} books for '{instance_name}'")
    
    if not validate_settings(api_url, api_key, hunt_missing_books, "readarr", readarr_logger):
        return False

    # Check for stop signal
    if stop_check():
        readarr_logger.info("Stop requested before starting missing books. Aborting...")
        return False

    # Get missing books
    readarr_logger.info(f"Retrieving books with missing files...")
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
    
    readarr_logger.info(f"Retrieved {len(missing_books_data)} missing books from random page selection.")

    # Filter out books whose author has an exempt tag (issue #676)
    missing_books_data = filter_exempt_items(
        missing_books_data, s['exempt_tags'], readarr_api,
        api_url, api_key, api_timeout,
        get_tags_fn=lambda b: (b.get("author") or {}).get("tags", []),
        get_id_fn=lambda b: b.get("id"),
        get_title_fn=lambda b: b.get("title", "Unknown"),
        app_type="readarr", logger=readarr_logger
    )

    # Check for stop signal after retrieving books
    if stop_check():
        readarr_logger.info("Stop requested after retrieving missing books. Aborting...")
        return False

    # Filter out already processed books using shared utility
    unprocessed_books = filter_unprocessed(
        missing_books_data, "readarr", instance_key,
        get_id_fn=lambda b: b.get("id"), logger=readarr_logger
    )
    readarr_logger.info(f"Missing: {len(unprocessed_books)} unprocessed of {len(missing_books_data)} total books")
    
    if not unprocessed_books:
        readarr_logger.info("No unprocessed missing books found. All available books have been processed.")
        return False

    # Select individual books to process (fixed: was selecting authors, now selects books)
    books_to_process = random.sample(unprocessed_books, min(hunt_missing_books, len(unprocessed_books)))

    readarr_logger.info(f"Missing: selected {len(books_to_process)} books for search:")
    for idx, book in enumerate(books_to_process):
        book_id = book.get("id")
        book_title = book.get("title", "Unknown Title")
        author_id = book.get("authorId", "Unknown")
        readarr_logger.info(f"  {idx+1}. '{book_title}' (ID: {book_id}, Author ID: {author_id})")

    processed_count = 0

    # Process each individual book
    for book in books_to_process:
        if not should_continue_processing("readarr", stop_check, readarr_logger):
            break

        book_id = book.get("id")
        book_title = book.get("title", f"Unknown Book ID {book_id}")
        author_id = book.get("authorId")
        
        # Get author name for logging
        author_info = readarr_api.get_author_details(api_url, api_key, author_id, api_timeout) if author_id else None
        author_name = author_info.get("authorName", f"Author ID {author_id}") if author_info else "Unknown Author"

        readarr_logger.info(f"Processing missing book: '{book_title}' by {author_name} (Book ID: {book_id})")

        # Search for this individual book (fixed: was searching all books by author)
        readarr_logger.info(f"  - Searching for individual book: '{book_title}'...")
        
        # Mark book as processed BEFORE triggering search to prevent duplicates
        add_processed_id("readarr", instance_key, str(book_id))
        readarr_logger.debug(f"Added book ID {book_id} to processed list for {instance_name}")
        
        # Search for the specific book (using book search instead of author search)
        search_command_result = readarr_api.search_books(api_url, api_key, [book_id], api_timeout)

        if search_command_result:
            # Extract command ID if the result is a dictionary, otherwise use the result directly
            command_id = search_command_result.get('id') if isinstance(search_command_result, dict) else search_command_result
            readarr_logger.info(f"Triggered book search command {command_id} for '{book_title}' by {author_name}.")
            increment_stat("readarr", "hunted", 1, instance_key)
            
            if author_id:
                try_tag_item(tag_settings, "missing", readarr_api.tag_processed_author,
                             api_url, api_key, api_timeout, author_id,
                             readarr_logger, f"author {author_id}")
            
            # Log history entry for this specific book
            media_name = f"{author_name} - {book_title}"
            log_processed_media("readarr", media_name, book_id, instance_key, "missing", display_name_for_log=app_settings.get("instance_display_name") or instance_name)
            readarr_logger.debug(f"Logged missing book history entry: {media_name} (ID: {book_id})")
            
            processed_count += 1
            processed_any = True
        else:
            readarr_logger.error(f"Failed to trigger search for book '{book_title}' by {author_name}.")

        if processed_count >= hunt_missing_books:
            readarr_logger.info(f"Reached target of {hunt_missing_books} books processed for this cycle.")
            break

    readarr_logger.info(f"Missing: processed {processed_count} of {len(books_to_process)} books")

    return processed_any