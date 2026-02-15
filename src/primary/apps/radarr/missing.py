#!/usr/bin/env python3
"""
Missing Movies Processing for Radarr
Handles searching for missing movies in Radarr
"""

import os
import time
import random
import datetime
from typing import List, Dict, Any, Set, Callable
from src.primary.utils.logger import get_logger
from src.primary.apps.radarr import api as radarr_api
from src.primary.stats_manager import increment_stat_only
from src.primary.stateful_manager import add_processed_id
from src.primary.utils.history_utils import log_processed_media
from src.primary.settings_manager import load_settings
from src.primary.apps._common.settings import extract_app_settings, validate_settings
from src.primary.apps._common.filtering import filter_exempt_items, filter_unprocessed
from src.primary.apps._common.processing import should_continue_processing
from src.primary.apps._common.tagging import try_tag_item

# Get logger for the app
radarr_logger = get_logger("radarr")

def should_delay_movie_search(release_date_str: str, delay_days: int) -> bool:
    """
    Check if a movie search should be delayed based on its release date.
    
    Args:
        release_date_str: Movie release date in ISO format (e.g., '2024-01-15T00:00:00Z')
        delay_days: Number of days to delay search after release date
        
    Returns:
        True if search should be delayed, False if ready to search
    """
    if delay_days <= 0:
        return False  # No delay configured
        
    if not release_date_str:
        return False  # No release date, don't delay (process immediately)
        
    try:
        # Parse the release date
        release_date = parse_date(release_date_str)
        if not release_date:
            return False  # Invalid date, don't delay
            
        current_time = datetime.datetime.now(datetime.timezone.utc)
        
        # Calculate when search should start (release date + delay)
        search_start_time = release_date + datetime.timedelta(days=delay_days)
        
        # Return True if we should still delay (current time < search start time)
        return current_time < search_start_time
        
    except Exception as e:
        radarr_logger.warning(f"Could not parse release date '{release_date_str}' for delay calculation: {e}")
        return False  # Don't delay if we can't parse the date

def parse_date(date_str):
    """Parse date string, handling various ISO formats from Radarr API"""
    if not date_str:
        return None
    
    try:
        # Handle milliseconds (e.g., "2024-01-01T00:00:00.000Z")
        clean_date_str = date_str
        if '.' in clean_date_str and 'Z' in clean_date_str:
            clean_date_str = clean_date_str.split('.')[0] + 'Z'
        
        # Handle different timezone formats
        if clean_date_str.endswith('Z'):
            clean_date_str = clean_date_str[:-1] + '+00:00'
        elif '+' not in clean_date_str and '-' not in clean_date_str[-6:]:
            # No timezone info, assume UTC
            clean_date_str += '+00:00'
        
        # Parse the release date
        return datetime.datetime.fromisoformat(clean_date_str)
    except (ValueError, TypeError):
        return None

def process_missing_movies(
    app_settings: Dict[str, Any],
    stop_check: Callable[[], bool] # Function to check if stop is requested
) -> bool:
    """
    Process missing movies in Radarr based on provided settings.
    
    Args:
        app_settings: Dictionary containing all settings for Radarr
        stop_check: A function that returns True if the process should stop
    
    Returns:
        True if any movies were processed, False otherwise.
    """
    processed_any = False
    
    # Extract common settings using shared utility
    s = extract_app_settings(app_settings, "radarr", "hunt_missing_movies", "Radarr Default")
    instance_name = s['instance_name']
    instance_key = s['instance_key']
    api_url = s['api_url']
    api_key = s['api_key']
    api_timeout = s['api_timeout']
    monitored_only = s['monitored_only']
    hunt_missing_movies = s['hunt_count']
    tag_settings = s['tag_settings']
    
    # App-specific settings
    skip_future_releases = app_settings.get("skip_future_releases", True)
    
    radarr_logger.info("=== Radarr Missing Movies Settings ===")
    radarr_logger.debug(f"Instance Name: {instance_name}")
    radarr_logger.info("Starting missing movies processing cycle for Radarr.")
    
    if not validate_settings(api_url, api_key, hunt_missing_movies, "radarr", radarr_logger):
        return False

    # Check for stop signal
    if stop_check():
        radarr_logger.info("Stop requested before starting missing movies. Aborting...")
        return False
    
    # Get missing movies 
    radarr_logger.info("Retrieving movies with missing files...")
    # Use efficient random page selection instead of fetching all movies
    missing_movies = radarr_api.get_movies_with_missing_random_page(
        api_url, api_key, api_timeout, monitored_only, hunt_missing_movies * 2
    ) 
    
    if missing_movies is None: # API call failed
        radarr_logger.error("Failed to retrieve missing movies from Radarr API.")
        return False
        
    if not missing_movies:
        radarr_logger.info("No missing movies found.")
        return False
    
    radarr_logger.info(f"Retrieved {len(missing_movies)} missing movies from random page selection.")
    
    # Skip future releases if enabled
    if skip_future_releases:
        radarr_logger.info("Filtering out future releases...")
        now = datetime.datetime.now(datetime.timezone.utc)
        
        filtered_movies = []
        skipped_count = 0
        no_date_count = 0
        for movie in missing_movies:
            movie_id = movie.get('id')
            movie_title = movie.get('title', 'Unknown Title')
            release_date_str = movie.get('releaseDate')
            
            if release_date_str:
                release_date = parse_date(release_date_str)
                if release_date:
                    if release_date > now:
                        # Movie has a future release date, skip it
                        radarr_logger.debug(f"Skipping future movie ID {movie_id} ('{movie_title}') - releaseDate is in the future: {release_date}")
                        skipped_count += 1
                        continue
                    else:
                        # Movie release date is in the past, include it
                        radarr_logger.debug(f"Movie ID {movie_id} ('{movie_title}') releaseDate is in the past: {release_date}, including in search")
                        filtered_movies.append(movie)
                else:
                    # Could not parse release date, treat as no date
                    radarr_logger.debug(f"Movie ID {movie_id} ('{movie_title}') has unparseable releaseDate '{release_date_str}' - treating as no release date")
                    if app_settings.get('process_no_release_dates', False):
                        radarr_logger.debug(f"Movie ID {movie_id} ('{movie_title}') has no valid release date but process_no_release_dates is enabled - including in search")
                        filtered_movies.append(movie)
                    else:
                        radarr_logger.debug(f"Skipping movie ID {movie_id} ('{movie_title}') - no valid release date and process_no_release_dates is disabled")
                        no_date_count += 1
            else:
                # No release date available at all
                if app_settings.get('process_no_release_dates', False):
                    radarr_logger.debug(f"Movie ID {movie_id} ('{movie_title}') has no releaseDate field but process_no_release_dates is enabled - including in search")
                    filtered_movies.append(movie)
                else:
                    radarr_logger.debug(f"Skipping movie ID {movie_id} ('{movie_title}') - no releaseDate field and process_no_release_dates is disabled")
                    no_date_count += 1
        
        radarr_logger.info(f"Filtered out {skipped_count} future releases and {no_date_count} movies with no release dates")
        radarr_logger.debug(f"After filtering: {len(filtered_movies)} movies remaining from {len(missing_movies)} original")
        missing_movies = filtered_movies
    else:
        radarr_logger.info("Skip future releases is disabled - processing all movies regardless of release date")

    # Apply release date delay if configured
    release_date_delay_days = app_settings.get("release_date_delay_days", 0)
    if release_date_delay_days > 0:
        radarr_logger.info(f"Applying {release_date_delay_days}-day release date delay...")
        original_count = len(missing_movies)
        delayed_movies = []
        delayed_count = 0
        
        for movie in missing_movies:
            movie_id = movie.get('id')
            movie_title = movie.get('title', 'Unknown Title')
            release_date_str = movie.get('releaseDate')
            
            if should_delay_movie_search(release_date_str, release_date_delay_days):
                delayed_count += 1
                radarr_logger.debug(f"Delaying search for movie ID {movie_id} ('{movie_title}') - released {release_date_str}, waiting {release_date_delay_days} days")
            else:
                delayed_movies.append(movie)
        
        missing_movies = delayed_movies
        if delayed_count > 0:
            radarr_logger.info(f"Delayed {delayed_count} movies due to {release_date_delay_days}-day release date delay setting.")
    
    if not missing_movies:
        radarr_logger.info("No missing movies left to process after filtering future releases.")
        return False

    # Filter out movies with exempt tags (issue #676)
    missing_movies = filter_exempt_items(
        missing_movies, s['exempt_tags'], radarr_api,
        api_url, api_key, api_timeout,
        get_tags_fn=lambda m: m.get("tags", []),
        get_id_fn=lambda m: m.get("id"),
        get_title_fn=lambda m: m.get("title", "Unknown"),
        app_type="radarr", logger=radarr_logger
    )

    movies_processed = 0
    processing_done = False
    
    # Filter out already processed movies using shared utility
    unprocessed_movies = filter_unprocessed(
        missing_movies, "radarr", instance_key,
        get_id_fn=lambda m: m.get("id"), logger=radarr_logger
    )
    radarr_logger.info(f"Found {len(unprocessed_movies)} unprocessed missing movies out of {len(missing_movies)} total.")
    
    if not unprocessed_movies:
        radarr_logger.info("No unprocessed missing movies found. All available movies have been processed.")
        return False
    
    # Always use random selection for missing movies
    radarr_logger.info(f"Using random selection for missing movies")
    if len(unprocessed_movies) > hunt_missing_movies:
        movies_to_process = random.sample(unprocessed_movies, hunt_missing_movies)
    else:
        movies_to_process = unprocessed_movies
    
    radarr_logger.info(f"Selected {len(movies_to_process)} movies to process.")
    
    # Add detailed logging for selected movies
    if movies_to_process:
        radarr_logger.info(f"Movies selected for processing in this cycle:")
        for idx, movie in enumerate(movies_to_process):
            movie_id = movie.get("id")
            movie_title = movie.get("title", "Unknown Title")
            year = movie.get("year", "Unknown Year")
            radarr_logger.info(f"  {idx+1}. {movie_title} ({year}) - ID: {movie_id}")
    
    # Process each movie
    for movie in movies_to_process:
        if not should_continue_processing("radarr", stop_check, radarr_logger):
            break
            
        movie_id = movie.get("id")
        movie_title = movie.get("title", "Unknown Title")
        
        # Refresh functionality has been removed as it was identified as a performance bottleneck
        
        # Search for the movie
        radarr_logger.info(f"Searching for movie '{movie_title}' (ID: {movie_id})...")
        search_success = radarr_api.movie_search(api_url, api_key, api_timeout, [movie_id])
        
        if search_success:
            radarr_logger.info(f"Successfully triggered search for movie '{movie_title}'")
            
            # Tag the movie if enabled (unified tagging)
            try_tag_item(tag_settings, "missing", radarr_api.tag_processed_movie,
                         api_url, api_key, api_timeout, movie_id,
                         radarr_logger, f"movie {movie_id}")
            
            # Immediately add to processed IDs to prevent duplicate processing
            success = add_processed_id("radarr", instance_key, str(movie_id))
            radarr_logger.debug(f"Added processed ID: {movie_id}, success: {success}")
            
            # Log to history system
            year = movie.get("year", "Unknown Year")
            media_name = f"{movie_title} ({year})"
            # Use TMDb ID for Radarr URLs (falls back to internal ID if TMDb ID not available)
            tmdb_id = movie.get("tmdbId", movie_id)
            log_processed_media("radarr", media_name, tmdb_id, instance_key, "missing", display_name_for_log=app_settings.get("instance_display_name") or instance_name)
            radarr_logger.debug(f"Logged history entry for movie: {media_name}")
            
            increment_stat_only("radarr", "hunted", 1, instance_key)
            movies_processed += 1
            processed_any = True
        else:
            radarr_logger.warning(f"Failed to trigger search for movie '{movie_title}'")
    
    radarr_logger.info(f"Finished processing missing movies. Processed {movies_processed} of {len(movies_to_process)} selected movies.")
    return processed_any