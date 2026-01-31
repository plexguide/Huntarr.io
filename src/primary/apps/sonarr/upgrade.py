#!/usr/bin/env python3
"""
Sonarr cutoff upgrade processing module for Huntarr
"""

import time
import random
from typing import List, Dict, Any, Set, Callable, Union, Optional, Optional
from src.primary.utils.logger import get_logger
from src.primary.apps.sonarr import api as sonarr_api
from src.primary.apps.sonarr.missing import _normalize_exempt_tags
from src.primary.stats_manager import increment_stat, check_hourly_cap_exceeded
from src.primary.stateful_manager import is_processed, add_processed_id
from src.primary.utils.history_utils import log_processed_media
from src.primary.settings_manager import get_advanced_setting, load_settings

# Get logger for the Sonarr app
sonarr_logger = get_logger("sonarr")

def process_cutoff_upgrades(
    api_url: str,
    api_key: str,
    instance_name: str,
    api_timeout: int = 120,
    monitored_only: bool = True,
    # series_type: str = "standard",  # TODO: Add series type filtering (standard, daily, anime)
    hunt_upgrade_items: int = 5,
    upgrade_mode: str = "seasons_packs",
    command_wait_delay: int = get_advanced_setting("command_wait_delay", 1),
    command_wait_attempts: int = get_advanced_setting("command_wait_attempts", 600),
    stop_check: Callable[[], bool] = lambda: False,
    tag_processed_items: bool = True,
    custom_tags: dict = None,
    upgrade_selection_method: str = "cutoff",
    upgrade_tag: str = "",
    exempt_tags: list = None,
) -> bool:
    """
    Process quality cutoff upgrades for Sonarr.
    Supports seasons_packs and episodes modes. Episodes mode has been reinstated in 7.5.1+ as a non-default option with limitations.
    upgrade_selection_method: "cutoff" (default) or "tags" for tag-based selection.
    """
    if hunt_upgrade_items <= 0:
        sonarr_logger.info("'hunt_upgrade_items' setting is 0 or less. Skipping upgrade processing.")
        return False

    method = (upgrade_selection_method or "cutoff").strip().lower()
    if method not in ("cutoff", "tags"):
        method = "cutoff"
    tag_label = (upgrade_tag or "").strip()
        
    sonarr_logger.info(f"Checking for {hunt_upgrade_items} quality upgrades for instance '{instance_name}'...")
    
    # Use custom tags if provided, otherwise use defaults
    if custom_tags is None:
        custom_tags = {
            "missing": "huntarr-missing",
            "upgrade": "huntarr-upgrade",
            "shows_missing": "huntarr-shows-missing"
        }
    
    # Tag-based upgrade path (Upgradinatorr-style): series WITHOUT tag -> SeriesSearch -> add tag
    if method == "tags":
        if not tag_label:
            sonarr_logger.warning("Upgrade selection method is 'Tags' but no upgrade tag is configured. Skipping.")
            return False
        sonarr_logger.info(f"Retrieving series WITHOUT tag \"{tag_label}\" (Upgradinatorr-style: tag tracks processed)...")
        series_list = sonarr_api.get_series_without_tag(api_url, api_key, api_timeout, tag_label, monitored_only)
        if series_list is None:
            return False
        if not series_list:
            sonarr_logger.info(f"No series found without the tag \"{tag_label}\" (all have been processed).")
            return False
        sonarr_logger.info(f"Found {len(series_list)} series without tag \"{tag_label}\".")
        # Filter out series with exempt tags (issue #676)
        if exempt_tags:
            exempt_id_to_label = sonarr_api.get_exempt_tag_ids(api_url, api_key, api_timeout, exempt_tags)
            if exempt_id_to_label:
                filtered = []
                for s in series_list:
                    skip = False
                    for tid in s.get("tags", []):
                        if tid in exempt_id_to_label:
                            sonarr_logger.info(
                                f"Skipping series \"{s.get('title', 'Unknown')}\" (ID: {s.get('id')}) - has exempt tag \"{exempt_id_to_label[tid]}\""
                            )
                            skip = True
                            break
                    if not skip:
                        filtered.append(s)
                series_list = filtered
                sonarr_logger.info(f"Exempt tags filter: {len(series_list)} series remaining for upgrades after excluding series with exempt tags.")
        unprocessed = [
            s for s in series_list
            if not is_processed("sonarr", instance_name, f"series_{s.get('id')}")
        ]
        if not unprocessed:
            sonarr_logger.info("All series with the upgrade tag have been processed recently. Skipping.")
            return False
        to_process = random.sample(unprocessed, min(hunt_upgrade_items, len(unprocessed)))
        processed_count = 0
        for s in to_process:
            if stop_check():
                break
            series_id = s.get("id")
            title = s.get("title", f"Series {series_id}")
            sonarr_logger.info(f"Processing tag-based upgrade for series: \"{title}\" (ID: {series_id})")
            if sonarr_api.series_search(api_url, api_key, api_timeout, series_id):
                add_processed_id("sonarr", instance_name, f"series_{series_id}")
                from src.primary.stats_manager import increment_stat_only
                increment_stat_only("sonarr", "upgraded", 1, instance_name)
                log_processed_media("sonarr", title, str(series_id), instance_name, "upgrade")
                
                # Add the upgrade tag to mark as processed (Upgradinatorr-style)
                tag_id = sonarr_api.get_or_create_tag(api_url, api_key, api_timeout, tag_label)
                if tag_id:
                    try:
                        sonarr_api.add_tag_to_series(api_url, api_key, api_timeout, series_id, tag_id)
                        sonarr_logger.debug(f"Added upgrade tag '{tag_label}' to series {series_id} to mark as processed")
                    except Exception as e:
                        sonarr_logger.warning(f"Failed to add upgrade tag '{tag_label}' to series {series_id}: {e}")
                
                # Also tag with huntarr-upgraded if enabled (separate tracking feature)
                if tag_processed_items and custom_tags:
                    from src.primary.settings_manager import get_custom_tag
                    custom_tag = get_custom_tag("sonarr", "upgrade", "huntarr-upgraded")
                    tag_id = sonarr_api.get_or_create_tag(api_url, api_key, api_timeout, custom_tag)
                    if tag_id:
                        try:
                            sonarr_api.add_tag_to_series(api_url, api_key, api_timeout, series_id, tag_id)
                        except Exception:
                            pass
                processed_count += 1
        sonarr_logger.info(f"Finished tag-based upgrade cycle: processed {processed_count} series.")
        return processed_count > 0
    
    sonarr_logger.info(f"Using {upgrade_mode.upper()} mode for quality upgrades")

    # Use seasons_packs mode or episodes mode (exempt_tags already normalized above)
    if upgrade_mode == "seasons_packs":
        return process_upgrade_seasons_mode(
            api_url, api_key, instance_name, api_timeout, monitored_only, 
            hunt_upgrade_items, command_wait_delay, command_wait_attempts, stop_check,
            tag_processed_items, custom_tags, exempt_tags=exempt_tags
        )
    elif upgrade_mode == "episodes":
        # Handle individual episode upgrades (reinstated with warnings)
        sonarr_logger.warning("Episodes mode selected for upgrades - WARNING: This mode makes excessive API calls and does not support tagging. Consider using Season Packs mode instead.")
        return process_upgrade_episodes_mode(
            api_url, api_key, instance_name, api_timeout, monitored_only, 
            hunt_upgrade_items, command_wait_delay, command_wait_attempts, stop_check,
            tag_processed_items, custom_tags, exempt_tags=exempt_tags
        )
    else:
        sonarr_logger.error(f"Invalid upgrade_mode: {upgrade_mode}. Valid options are 'seasons_packs' or 'episodes'.")
        return False

def log_season_pack_upgrade(api_url: str, api_key: str, api_timeout: int, series_id: int, season_number: int, instance_name: str):
    """Log a season pack upgrade to the history."""
    try:
        # Get series details for better history logging
        series_details = sonarr_api.get_series(api_url, api_key, api_timeout, series_id)
        if series_details:
            series_title = series_details.get('title', f"Series ID {series_id}")
            
            # Format season number for display
            try:
                season_id = f"S{season_number:02d}" if isinstance(season_number, int) else f"S{season_number}"
            except (ValueError, TypeError):
                season_id = f"S{season_number}"
            
            # Use the season ID directly - format as series_id + season number
            # This matches how Sonarr would identify a season
            season_id_num = f"{series_id}_{season_number}"
            
            # Create a descriptive name for the history entry
            media_name = f"{series_title} - {season_id}"
            
            # Log the season pack upgrade to history with normal 'upgrade' operation type
            log_processed_media("sonarr", media_name, season_id_num, instance_name, "upgrade")
            sonarr_logger.debug(f"Logged season pack upgrade to history for {series_title} Season {season_number}")
    except Exception as e:
        sonarr_logger.error(f"Failed to log season pack upgrade to history: {str(e)}")

def process_upgrade_seasons_mode(
    api_url: str,
    api_key: str,
    instance_name: str,
    api_timeout: int,
    monitored_only: bool,
    hunt_upgrade_items: int,
    command_wait_delay: int,
    command_wait_attempts: int,
    stop_check: Callable[[], bool],
    tag_processed_items: bool = True,
    custom_tags: dict = None,
    exempt_tags: list = None,
) -> bool:
    """Process upgrades in season mode - groups episodes by season."""
    processed_any = False
    exempt_tags = exempt_tags or []

    # Use custom tags if provided, otherwise use defaults
    if custom_tags is None:
        custom_tags = {
            "missing": "huntarr-missing",
            "upgrade": "huntarr-upgrade",
            "shows_missing": "huntarr-shows-missing"
        }
    
    # Flag to skip individual episode history logging since we log the whole season pack
    skip_episode_history = True
    
    # Use the efficient random page selection method to get a sample of cutoff unmet episodes
    sonarr_logger.debug(f"Using random page selection for cutoff unmet episodes")
    # Request slightly more episodes than needed to ensure we have enough for a few seasons
    sample_size = hunt_upgrade_items * 10
    cutoff_unmet_episodes = sonarr_api.get_cutoff_unmet_episodes_random_page(
        api_url, api_key, api_timeout, monitored_only, sample_size)

    # Filter out episodes whose series has an exempt tag (issue #676)
    if exempt_tags and cutoff_unmet_episodes:
        exempt_id_to_label = sonarr_api.get_exempt_tag_ids(api_url, api_key, api_timeout, exempt_tags)
        if exempt_id_to_label:
            all_series = sonarr_api.get_series(api_url, api_key, api_timeout)
            exempt_series_ids = set()
            if all_series:
                if not isinstance(all_series, list):
                    all_series = [all_series]
                for s in all_series:
                    for tid in s.get("tags", []):
                        if tid in exempt_id_to_label:
                            exempt_series_ids.add(s.get("id"))
                            sonarr_logger.info(
                                f"Skipping series \"{s.get('title', 'Unknown')}\" (ID: {s.get('id')}) - has exempt tag \"{exempt_id_to_label[tid]}\""
                            )
                            break
            cutoff_unmet_episodes = [ep for ep in cutoff_unmet_episodes if ep.get("seriesId") not in exempt_series_ids]
            sonarr_logger.info(f"Exempt tags filter: {len(cutoff_unmet_episodes)} episodes remaining for upgrades after excluding series with exempt tags.")
    
    sonarr_logger.info(f"Received {len(cutoff_unmet_episodes)} cutoff unmet episodes from random page (before filtering).")
    
    if not cutoff_unmet_episodes:
        sonarr_logger.info("No cutoff unmet episodes found in Sonarr.")
        return False
        
    # Always filter out future episodes (previously tied to skip_series_refresh)
    now_unix = time.time()
    original_count = len(cutoff_unmet_episodes)
    # Ensure airDateUtc exists and is not None before parsing
    cutoff_unmet_episodes = [
        ep for ep in cutoff_unmet_episodes
        if ep.get('airDateUtc') and time.mktime(time.strptime(ep['airDateUtc'], '%Y-%m-%dT%H:%M:%SZ')) < now_unix
    ]
    skipped_count = original_count - len(cutoff_unmet_episodes)
    if skipped_count > 0:
        sonarr_logger.info(f"Skipped {skipped_count} future episodes based on air date for upgrades.")
    
    if stop_check(): 
        sonarr_logger.info("Stop requested during upgrade processing.")
        return processed_any
    
    # Group episodes by series and season
    series_season_episodes: Dict[int, Dict[int, List[Dict]]] = {}
    for episode in cutoff_unmet_episodes:
        series_id = episode.get('seriesId')
        season_number = episode.get('seasonNumber')
        
        if series_id is not None and season_number is not None:
            if series_id not in series_season_episodes:
                series_season_episodes[series_id] = {}
            
            if season_number not in series_season_episodes[series_id]:
                series_season_episodes[series_id][season_number] = []
                
            series_season_episodes[series_id][season_number].append(episode)
    
    # Create a list of (series_id, season_number) tuples for selection
    available_seasons = []
    for series_id, seasons in series_season_episodes.items():
        for season_number, episodes in seasons.items():
            # Get series title from the first episode for this season
            series_title = episodes[0].get('series', {}).get('title', f"Series ID {series_id}")
            available_seasons.append((series_id, season_number, len(episodes), series_title))
    
    if not available_seasons:
        sonarr_logger.info("No valid seasons with cutoff unmet episodes found.")
        return False
    
    # CRITICAL FIX: Filter out already processed seasons at the season level
    # This prevents the same season pack upgrade from being processed repeatedly
    unprocessed_seasons = []
    for series_id, season_number, episode_count, series_title in available_seasons:
        season_id = f"{series_id}_{season_number}"
        if not is_processed("sonarr", instance_name, season_id):
            unprocessed_seasons.append((series_id, season_number, episode_count, series_title))
        else:
            sonarr_logger.debug(f"Skipping already processed season ID: {season_id} ({series_title} - Season {season_number})")
    
    sonarr_logger.info(f"Found {len(unprocessed_seasons)} unprocessed seasons out of {len(available_seasons)} total seasons with cutoff unmet episodes.")
    
    if not unprocessed_seasons:
        sonarr_logger.info("All seasons with cutoff unmet episodes have been processed.")
        return False
    
    # Select seasons to process - always randomly
    random.shuffle(unprocessed_seasons)
    seasons_to_process = unprocessed_seasons[:hunt_upgrade_items]
    
    sonarr_logger.info(f"Selected {len(seasons_to_process)} seasons with cutoff unmet episodes to process")
    
    # Log selected seasons
    for idx, (series_id, season_number, episode_count, series_title) in enumerate(seasons_to_process):
        sonarr_logger.info(f" {idx+1}. {series_title} - Season {season_number} - {episode_count} cutoff unmet episodes")
    
    # Process each selected season
    for series_id, season_number, _, series_title in seasons_to_process:
        if stop_check():
            sonarr_logger.info("Stop requested during upgrade processing.")
            break
        
        # Check API limit before processing each season
        try:
            if check_hourly_cap_exceeded("sonarr"):
                sonarr_logger.warning(f"🛑 Sonarr API hourly limit reached - stopping upgrade season processing")
                break
        except Exception as e:
            sonarr_logger.error(f"Error checking hourly API cap: {e}")
            # Continue processing if cap check fails - safer than stopping
            
        sonarr_logger.info(f"Processing season pack upgrade: {series_title} Season {season_number} ({episode_count} cutoff unmet episodes)")
        
        episodes = series_season_episodes[series_id][season_number]
        episode_ids = [episode["id"] for episode in episodes]
        
        sonarr_logger.info(f"Processing {series_title} - Season {season_number} with {len(episode_ids)} cutoff unmet episodes")
        
        if stop_check(): 
            sonarr_logger.info("Stop requested during season processing.")
            break
            
        # Trigger search for the entire season instead of individual episodes
        sonarr_logger.debug(f"Attempting to search for entire Season {season_number} of {series_title} for upgrades")
        search_command_id = sonarr_api.search_season(api_url, api_key, api_timeout, series_id, season_number, instance_name=instance_name)
        
        if search_command_id:
            # Wait for search command to complete
            if wait_for_command(
                api_url, api_key, api_timeout, search_command_id,
                command_wait_delay, command_wait_attempts, "Episode Upgrade Search", stop_check,
                instance_name=instance_name
            ):
                # Mark as processed if search command completed successfully
                processed_any = True
                sonarr_logger.info(f"Successfully triggered season pack search for {series_title} Season {season_number} with {len(episode_ids)} cutoff unmet episodes")
                
                # Tag the series if enabled
                if tag_processed_items:
                    custom_tag = custom_tags.get("upgrade", "huntarr-upgrade")
                    try:
                        sonarr_api.tag_processed_series(api_url, api_key, api_timeout, series_id, custom_tag)
                        sonarr_logger.debug(f"Tagged series {series_id} with '{custom_tag}'")
                    except Exception as e:
                        sonarr_logger.warning(f"Failed to tag series {series_id} with '{custom_tag}': {e}")
                
                # Log this as a season pack upgrade in the history
                log_season_pack_upgrade(api_url, api_key, api_timeout, series_id, season_number, instance_name)
                
                # CRITICAL FIX: Mark the season as processed at the season level to prevent reprocessing
                season_id = f"{series_id}_{season_number}"
                add_processed_id("sonarr", instance_name, season_id)
                sonarr_logger.debug(f"Marked season ID {season_id} as processed for upgrades ({series_title} - Season {season_number})")
                
                # We'll increment stats individually for each episode instead of in batch
                # increment_stat("sonarr", "upgraded", len(episode_ids))
                # sonarr_logger.debug(f"Incremented sonarr upgraded statistics by {len(episode_ids)}")
                
                # Mark episodes as processed using stateful management
                for episode_id in episode_ids:
                    add_processed_id("sonarr", instance_name, str(episode_id))
                    sonarr_logger.debug(f"Marked episode ID {episode_id} as processed for upgrades")
                    
                    # CRITICAL FIX: Use increment_stat_only to avoid double-counting API calls
                    # The API call is already tracked in search_season(), so we only increment stats here
                    from src.primary.stats_manager import increment_stat_only
                    increment_stat_only("sonarr", "upgraded", 1, instance_name)
                    sonarr_logger.debug(f"Incremented sonarr upgraded statistic for episode {episode_id} (API call already tracked separately)")
                    
                    # Find the episode information for history logging
                    # We need to get the episode details from the API to include proper info in history
                    try:
                        episode_details = sonarr_api.get_episode(api_url, api_key, api_timeout, episode_id)
                        if episode_details:
                            series_title = episode_details.get('series', {}).get('title', 'Unknown Series')
                            episode_title = episode_details.get('title', 'Unknown Episode')
                            season_number = episode_details.get('seasonNumber', 'Unknown Season')
                            episode_number = episode_details.get('episodeNumber', 'Unknown Episode')
                            
                            try:
                                season_episode = f"S{season_number:02d}E{episode_number:02d}"
                            except (ValueError, TypeError):
                                season_episode = f"S{season_number}E{episode_number}"
                                
                            # Record the upgrade in history with quality upgrade identifier
                            media_name = f"{series_title} - {season_episode} - {episode_title}"
                            # Skip logging individual episodes since we log the season pack
                            if not skip_episode_history:
                                log_processed_media("sonarr", media_name, episode_id, instance_name, "upgrade")
                            sonarr_logger.debug(f"Logged quality upgrade to history for episode ID {episode_id}")
                    except Exception as e:
                        sonarr_logger.error(f"Failed to log history for episode ID {episode_id}: {str(e)}")
            else:
                sonarr_logger.warning(f"Season pack search command for {series_title} Season {season_number} did not complete successfully")
        else:
            sonarr_logger.error(f"Failed to trigger season pack search command for {series_title} Season {season_number}")
    
    sonarr_logger.info("Finished quality cutoff upgrades processing cycle (season mode) for Sonarr.")
    return processed_any

def process_upgrade_shows_mode(
    api_url: str,
    api_key: str,
    instance_name: str,
    api_timeout: int,
    monitored_only: bool,
    hunt_upgrade_items: int,
    command_wait_delay: int,
    command_wait_attempts: int,
    stop_check: Callable[[], bool]
) -> bool:
    """Process upgrades in show mode - gets all cutoff unmet episodes for entire shows."""
    processed_any = False
    
    # Load settings to check if tagging is enabled
    sonarr_settings = load_settings("sonarr")
    tag_processed_items = sonarr_settings.get("tag_processed_items", True)
    
    # For shows mode, we want individual episode history entries
    skip_episode_history = False
    
    # Use the efficient random page selection method to get a sample of cutoff unmet episodes
    sonarr_logger.debug(f"Using random page selection for cutoff unmet episodes in shows mode")
    # Request slightly more episodes than needed to ensure we have enough for a few shows
    sample_size = hunt_upgrade_items * 20  # Use a larger multiplier for shows mode
    cutoff_unmet_sample = sonarr_api.get_cutoff_unmet_episodes_random_page(
        api_url, api_key, api_timeout, monitored_only, sample_size)
    
    sonarr_logger.info(f"Received {len(cutoff_unmet_sample)} cutoff unmet episodes from random page (before filtering).")
    
    if not cutoff_unmet_sample:
        sonarr_logger.info("No cutoff unmet episodes found in Sonarr.")
        return False
        
    # Always filter out future episodes (previously tied to skip_series_refresh)
    now_unix = time.time()
    original_count = len(cutoff_unmet_sample)
    # Ensure airDateUtc exists and is not None before parsing
    cutoff_unmet_sample = [
        ep for ep in cutoff_unmet_sample
        if ep.get('airDateUtc') and time.mktime(time.strptime(ep['airDateUtc'], '%Y-%m-%dT%H:%M:%SZ')) < now_unix
    ]
    skipped_count = original_count - len(cutoff_unmet_sample)
    if skipped_count > 0:
        sonarr_logger.info(f"Skipped {skipped_count} future episodes based on air date for upgrades.")
    
    if stop_check(): 
        sonarr_logger.info("Stop requested during upgrade processing.")
        return processed_any
    
    # Group episodes by series to identify candidate shows
    series_info: Dict[int, Dict] = {}  # Store series ID -> {title, sample_count}
    
    for episode in cutoff_unmet_sample:
        series_id = episode.get('seriesId')
        if series_id is not None:
            if series_id not in series_info:
                series_info[series_id] = {
                    'title': episode.get('series', {}).get('title', f"Series ID {series_id}"),
                    'sample_count': 0
                }
            series_info[series_id]['sample_count'] += 1

    # Get list of candidate series from the sample
    series_candidates = []
    for series_id, info in series_info.items():
        series_candidates.append((series_id, info['sample_count'], info['title']))
    
    if not series_candidates:
        sonarr_logger.info("No valid series with cutoff unmet episodes found in sample.")
        return False
        
    # Randomly select up to hunt_upgrade_items series to process
    random.shuffle(series_candidates)
    series_to_process = series_candidates[:hunt_upgrade_items]
    
    sonarr_logger.info(f"Selected {len(series_to_process)} series with cutoff unmet episodes to process")
    
    # Log selected series from sample
    for idx, (series_id, sample_count, series_title) in enumerate(series_to_process):
        sonarr_logger.info(f" {idx+1}. {series_title} - {sample_count} cutoff unmet episodes found in sample")
    
    # Process each selected series
    for series_id, _, series_title in series_to_process:
        if stop_check(): 
            sonarr_logger.info("Stop requested before processing next series.")
            break
            
        # Get ALL cutoff unmet episodes for this series (not just the ones in the sample)
        all_series_episodes = sonarr_api.get_cutoff_unmet_episodes_for_series(
            api_url, api_key, api_timeout, series_id, monitored_only)
        
        # Always filter future episodes (previously tied to skip_series_refresh)
        now_unix = time.time()
        original_count = len(all_series_episodes)
        all_series_episodes = [
            ep for ep in all_series_episodes
            if ep.get('airDateUtc') and time.mktime(time.strptime(ep['airDateUtc'], '%Y-%m-%dT%H:%M:%SZ')) < now_unix
        ]
        filtered_count = original_count - len(all_series_episodes)
        if filtered_count > 0:
            sonarr_logger.info(f"Filtered {filtered_count} future episodes from {series_title}")
        
        episode_ids = [episode["id"] for episode in all_series_episodes]
        
        if not episode_ids:
            sonarr_logger.warning(f"No valid episodes found for {series_title} after filtering")
            continue
            
        sonarr_logger.info(f"Processing {series_title} with {len(episode_ids)} cutoff unmet episodes")
        
        if stop_check(): 
            sonarr_logger.info("Stop requested during show processing.")
            break
            
        # Trigger search for all cutoff unmet episodes in this series
        sonarr_logger.debug(f"Attempting to search for {len(episode_ids)} episodes in {series_title} for upgrades")
        search_command_id = sonarr_api.search_episode(api_url, api_key, api_timeout, episode_ids, instance_name=instance_name)
        
        if search_command_id:
            # Wait for search command to complete
            if wait_for_command(
                api_url, api_key, api_timeout, search_command_id,
                command_wait_delay, command_wait_attempts, "Episode Upgrade Search", stop_check,
                instance_name=instance_name
            ):
                # Mark as processed if search command completed successfully
                processed_any = True
                sonarr_logger.info(f"Successfully processed {len(episode_ids)} cutoff unmet episodes in {series_title}")
                
                # Tag the series if enabled
                if tag_processed_items:
                    from src.primary.settings_manager import get_custom_tag
                    custom_tag = get_custom_tag("sonarr", "upgrade", "huntarr-upgrade")
                    try:
                        sonarr_api.tag_processed_series(api_url, api_key, api_timeout, series_id, custom_tag)
                        sonarr_logger.debug(f"Tagged series {series_id} with '{custom_tag}'")
                    except Exception as e:
                        sonarr_logger.warning(f"Failed to tag series {series_id} with '{custom_tag}': {e}")
                
                # We'll increment stats individually for each episode instead of in batch
                # increment_stat("sonarr", "upgraded", len(episode_ids))
                # sonarr_logger.debug(f"Incremented sonarr upgraded statistics by {len(episode_ids)}")
                
                # Mark episodes as processed using stateful management
                for episode_id in episode_ids:
                    add_processed_id("sonarr", instance_name, str(episode_id))
                    sonarr_logger.debug(f"Marked episode ID {episode_id} as processed for upgrades")
                    
                    # Increment stats for this episode (consistent with Radarr's approach)
                    increment_stat("sonarr", "upgraded", 1, instance_name)
                    sonarr_logger.debug(f"Incremented sonarr upgraded statistic for episode {episode_id}")
                    
                    # Find the episode information for history logging
                    # We need to get the episode details from the API to include proper info in history
                    try:
                        episode_details = sonarr_api.get_episode(api_url, api_key, api_timeout, episode_id)
                        if episode_details:
                            series_title = episode_details.get('series', {}).get('title', 'Unknown Series')
                            episode_title = episode_details.get('title', 'Unknown Episode')
                            season_number = episode_details.get('seasonNumber', 'Unknown Season')
                            episode_number = episode_details.get('episodeNumber', 'Unknown Episode')
                            
                            try:
                                season_episode = f"S{season_number:02d}E{episode_number:02d}"
                            except (ValueError, TypeError):
                                season_episode = f"S{season_number}E{episode_number}"
                                
                            # Record the upgrade in history with quality upgrade identifier
                            media_name = f"{series_title} - {season_episode} - {episode_title}"
                            # Skip logging individual episodes since we log the season pack
                            if not skip_episode_history:
                                log_processed_media("sonarr", media_name, episode_id, instance_name, "upgrade")
                            sonarr_logger.debug(f"Logged quality upgrade to history for episode ID {episode_id}")
                    except Exception as e:
                        sonarr_logger.error(f"Failed to log history for episode ID {episode_id}: {str(e)}")
            else:
                sonarr_logger.warning(f"Episode upgrade search command for {series_title} did not complete successfully")
        else:
            sonarr_logger.error(f"Failed to trigger upgrade search command for {series_title}")
    
    sonarr_logger.info("Finished quality cutoff upgrades processing cycle (show mode) for Sonarr.")
    return processed_any

def process_upgrade_episodes_mode(
    api_url: str,
    api_key: str,
    instance_name: str,
    api_timeout: int,
    monitored_only: bool,
    hunt_upgrade_items: int,
    command_wait_delay: int,
    command_wait_attempts: int,
    stop_check: Callable[[], bool],
    tag_processed_items: bool = True,
    custom_tags: dict = None,
    exempt_tags: list = None,
) -> bool:
    """
    Process upgrades in individual episode mode.
    
    WARNING: This mode is less efficient than season packs mode and makes more API calls.
    It does not support tagging functionality due to the way it processes individual episodes.
    
    This mode searches for individual episode upgrades rather than complete seasons,
    which can be useful for targeting specific episodes but is not recommended for most users.
    """
    processed_any = False
    exempt_tags = exempt_tags or []

    # Use custom tags if provided, otherwise use defaults
    if custom_tags is None:
        custom_tags = {
            "missing": "huntarr-missing",
            "upgrade": "huntarr-upgrade",
            "shows_missing": "huntarr-shows-missing"
        }
    
    sonarr_logger.warning("Using Episodes mode for upgrades - This will make more API calls and does not support tagging")
    
    # Use the efficient random page selection method to get a sample of cutoff unmet episodes
    sonarr_logger.debug(f"Using random page selection for cutoff unmet episodes in episodes mode")
    cutoff_unmet_episodes = sonarr_api.get_cutoff_unmet_episodes_random_page(
        api_url, api_key, api_timeout, monitored_only, hunt_upgrade_items * 2)

    # Filter out episodes whose series has an exempt tag (issue #676)
    if exempt_tags and cutoff_unmet_episodes:
        exempt_id_to_label = sonarr_api.get_exempt_tag_ids(api_url, api_key, api_timeout, exempt_tags)
        if exempt_id_to_label:
            all_series = sonarr_api.get_series(api_url, api_key, api_timeout)
            exempt_series_ids = set()
            if all_series:
                if not isinstance(all_series, list):
                    all_series = [all_series]
                for s in all_series:
                    for tid in s.get("tags", []):
                        if tid in exempt_id_to_label:
                            exempt_series_ids.add(s.get("id"))
                            sonarr_logger.info(
                                f"Skipping series \"{s.get('title', 'Unknown')}\" (ID: {s.get('id')}) - has exempt tag \"{exempt_id_to_label[tid]}\""
                            )
                            break
            cutoff_unmet_episodes = [ep for ep in cutoff_unmet_episodes if ep.get("seriesId") not in exempt_series_ids]
            sonarr_logger.info(f"Exempt tags filter: {len(cutoff_unmet_episodes)} episodes remaining for upgrades (episodes mode) after excluding series with exempt tags.")
    
    sonarr_logger.info(f"Received {len(cutoff_unmet_episodes)} cutoff unmet episodes from random page (before filtering).")
    
    if not cutoff_unmet_episodes:
        sonarr_logger.info("No cutoff unmet episodes found in Sonarr for individual processing.")
        return False
        
    # Always filter out future episodes
    now_unix = time.time()
    original_count = len(cutoff_unmet_episodes)
    # Ensure airDateUtc exists and is not None before parsing
    cutoff_unmet_episodes = [
        ep for ep in cutoff_unmet_episodes
        if ep.get('airDateUtc') and time.mktime(time.strptime(ep['airDateUtc'], '%Y-%m-%dT%H:%M:%SZ')) < now_unix
    ]
    skipped_count = original_count - len(cutoff_unmet_episodes)
    if skipped_count > 0:
        sonarr_logger.info(f"Skipped {skipped_count} future episodes based on air date for upgrades.")
    
    if stop_check(): 
        sonarr_logger.info("Stop requested during upgrade processing.")
        return processed_any
    
    # Filter out already processed episodes
    unprocessed_episodes = []
    for episode in cutoff_unmet_episodes:
        episode_id = str(episode.get('id'))
        if not is_processed("sonarr", instance_name, episode_id):
            unprocessed_episodes.append(episode)
        else:
            sonarr_logger.debug(f"Skipping already processed episode ID: {episode_id}")
    
    sonarr_logger.info(f"Found {len(unprocessed_episodes)} unprocessed episodes needing upgrades out of {len(cutoff_unmet_episodes)} total.")
    
    if not unprocessed_episodes:
        sonarr_logger.info("All cutoff unmet episodes have been processed.")
        return False
    
    # Apply randomization and limit
    random.shuffle(unprocessed_episodes)
    episodes_to_process = unprocessed_episodes[:hunt_upgrade_items]
    
    sonarr_logger.info(f"Processing {len(episodes_to_process)} individual episodes for quality upgrades...")
    
    # Process each episode individually
    processed_count = 0
    for episode in episodes_to_process:
        if stop_check():
            sonarr_logger.info("Stop requested. Aborting episode upgrade processing.")
            break
        
        # Check API limit before processing each episode
        try:
            if check_hourly_cap_exceeded("sonarr"):
                sonarr_logger.warning(f"🛑 Sonarr API hourly limit reached - stopping episode upgrade processing after {processed_count} episodes")
                break
        except Exception as e:
            sonarr_logger.error(f"Error checking hourly API cap: {e}")
            # Continue processing if cap check fails - safer than stopping
        
        episode_id = episode.get('id')
        series_info = episode.get('series', {})
        series_title = series_info.get('title', 'Unknown Series')
        season_number = episode.get('seasonNumber', 'Unknown')
        episode_number = episode.get('episodeNumber', 'Unknown')
        episode_title = episode.get('title', 'Unknown Episode')
        
        try:
            season_episode = f"S{season_number:02d}E{episode_number:02d}"
        except (ValueError, TypeError):
            season_episode = f"S{season_number}E{episode_number}"
        
        sonarr_logger.info(f"Processing upgrade for episode: {series_title} - {season_episode} - {episode_title}")
        
        # Search for this specific episode upgrade
        search_successful = sonarr_api.search_episode(api_url, api_key, api_timeout, [episode_id], instance_name=instance_name)
        
        if search_successful:
            # Wait for command to complete if configured
            if command_wait_delay > 0 and command_wait_attempts > 0:
                if wait_for_command(
                    api_url, api_key, api_timeout, search_successful,
                    command_wait_delay, command_wait_attempts, "Episode Upgrade Search", stop_check,
                    instance_name=instance_name
                ):
                    processed_any = True
                    processed_count += 1
                    
                    # Mark episode as processed
                    success = add_processed_id("sonarr", instance_name, str(episode_id))
                    sonarr_logger.debug(f"Added episode ID {episode_id} to processed list for upgrades, success: {success}")
                    
                    # Log to history system
                    media_name = f"{series_title} - {season_episode} - {episode_title}"
                    log_processed_media("sonarr", media_name, str(episode_id), instance_name, "upgrade")
                    sonarr_logger.debug(f"Logged upgrade to history for episode: {media_name}")
                    
                    # Increment statistics
                    increment_stat("sonarr", "upgraded", 1, instance_name)
                    sonarr_logger.debug(f"Incremented sonarr upgraded statistics for episode {episode_id}")
                    
                    # Note: No tagging is performed in episodes mode as it would be inefficient
                    # and could overwhelm the API with individual episode tag operations
                else:
                    sonarr_logger.warning(f"Episode upgrade search command for {series_title} - {season_episode} did not complete successfully")
            else:
                # No command waiting configured, consider it successful
                processed_any = True
                processed_count += 1
                
                # Mark episode as processed
                success = add_processed_id("sonarr", instance_name, str(episode_id))
                sonarr_logger.debug(f"Added episode ID {episode_id} to processed list for upgrades, success: {success}")
                
                # Log to history system
                media_name = f"{series_title} - {season_episode} - {episode_title}"
                log_processed_media("sonarr", media_name, str(episode_id), instance_name, "upgrade")
                sonarr_logger.debug(f"Logged upgrade to history for episode: {media_name}")
                
                # Increment statistics
                increment_stat("sonarr", "upgraded", 1, instance_name)
                sonarr_logger.debug(f"Incremented sonarr upgraded statistics for episode {episode_id}")
        else:
            sonarr_logger.error(f"Failed to trigger upgrade search for episode: {series_title} - {season_episode}")
    
    sonarr_logger.info(f"Processed {processed_count} individual episode upgrades for Sonarr.")
    sonarr_logger.warning("Episodes mode upgrade processing complete - consider using Season Packs mode for better efficiency")
    return processed_any

def wait_for_command(
    api_url: str,
    api_key: str,
    api_timeout: int,
    command_id: Union[int, str],
    wait_delay: int,
    max_attempts: int,
    command_name: str = "Command",
    stop_check: Callable[[], bool] = lambda: False,
    instance_name: Optional[str] = None
) -> bool:
    """
    Wait for a Sonarr command to complete or timeout.
    
    Args:
        api_url: The Sonarr API URL
        api_key: The Sonarr API key
        api_timeout: API request timeout
        command_id: The ID of the command to monitor
        wait_delay: Seconds to wait between status checks
        max_attempts: Maximum number of status check attempts
        command_name: Name of the command (for logging)
        stop_check: Optional function to check if operation should be aborted
        instance_name: Optional instance name for UI cycle activity (e.g. "Episode Upgrade Search (360/600)")
        
    Returns:
        True if command completed successfully, False otherwise
    """
    try:
        if wait_delay <= 0 or max_attempts <= 0:
            sonarr_logger.debug(f"Not waiting for command to complete (wait_delay={wait_delay}, max_attempts={max_attempts})")
            return True  # Return as if successful since we're not checking
        
        sonarr_logger.debug(f"Waiting for {command_name} to complete (command ID: {command_id}). Adaptive backoff, max {max_attempts} attempts")
        
        # Wait for command completion with adaptive backoff: poll less often over time to reduce API load when Sonarr is slow/queued
        attempts = 0
        while attempts < max_attempts:
            if stop_check():
                sonarr_logger.info(f"Stopping wait for {command_name} due to stop request")
                return False
            if instance_name and attempts % 5 == 0:
                try:
                    from src.primary.cycle_tracker import set_cycle_activity
                    set_cycle_activity("sonarr", instance_name, f"Search {attempts+1}/{max_attempts}")
                except Exception:
                    pass
            command_status = sonarr_api.get_command_status(api_url, api_key, api_timeout, command_id)
            if command_status is None:
                sonarr_logger.warning(
                    f"Failed to get status for {command_name} (ID: {command_id}), attempt {attempts+1}. "
                    f"Command may have already completed or the ID is no longer valid."
                )
                return False
            status = command_status.get('status')
            if status == 'completed':
                sonarr_logger.debug(f"Sonarr {command_name} (ID: {command_id}) completed successfully")
                return True
            elif status in ['failed', 'aborted']:
                sonarr_logger.warning(f"Sonarr {command_name} (ID: {command_id}) {status}")
                return False
            if attempts % 15 == 0:
                sonarr_logger.debug(f"Sonarr {command_name} (ID: {command_id}) status: {status}, attempt {attempts+1}/{max_attempts}")
            effective_delay = min(wait_delay + (attempts // 10), 15)
            attempts += 1
            time.sleep(effective_delay)
        
        sonarr_logger.error(f"Sonarr command '{command_name}' (ID: {command_id}) timed out after {max_attempts} attempts.")
        return False
    finally:
        if instance_name:
            try:
                from src.primary.cycle_tracker import clear_cycle_activity
                clear_cycle_activity("sonarr", instance_name)
            except Exception:
                pass