"""
TV Hunt: process episode upgrades from collection.
Handles automatic quality upgrades for episodes that haven't met their cutoff quality.
"""

from typing import Dict, Any, Callable, List, Optional
import random

from ...utils.logger import get_logger

tv_hunt_logger = get_logger("tv_hunt")


def get_episodes_needing_upgrade(instance_id: int) -> List[Dict[str, Any]]:
    """
    Get episodes that are available but haven't met their quality cutoff.
    
    Args:
        instance_id: TV Hunt instance ID
    
    Returns:
        List of episodes needing upgrade
    """
    from ...utils.database import get_database
    from ...routes.media_hunt.profiles import get_profile_by_name_or_default, _tv_profiles_context
    
    try:
        db = get_database()
        config = db.get_app_config_for_instance('tv_hunt_collection', instance_id) or {}
        series_list = config.get('series', [])
        
        episodes_needing_upgrade = []
        
        for series in series_list:
            series_title = series.get('title', '')
            tmdb_id = series.get('tmdb_id', '')
            tvdb_id = series.get('tvdb_id')
            quality_profile_name = series.get('quality_profile', '')
            root_folder = series.get('root_folder')
            poster_path = series.get('poster_path')
            
            # Get quality profile and cutoff
            if not quality_profile_name:
                continue
                
            try:
                profile = get_profile_by_name_or_default(quality_profile_name, instance_id, _tv_profiles_context())
                cutoff_quality = profile.get('cutoff', '')
                
                if not cutoff_quality:
                    continue
                    
                # Check each season
                for season in series.get('seasons', []):
                    season_num = season.get('season_number', 0)
                    
                    # Check each episode
                    for episode in season.get('episodes', []):
                        episode_num = episode.get('episode_number', 0)
                        status = episode.get('status', '')
                        file_path = episode.get('file_path', '')
                        current_quality = episode.get('quality', '')
                        
                        # Only consider available episodes
                        if status != 'available' or not file_path:
                            continue
                        
                        # Check if quality meets cutoff
                        if current_quality and not _quality_meets_cutoff(current_quality, cutoff_quality):
                            episodes_needing_upgrade.append({
                                'series_title': series_title,
                                'tmdb_id': tmdb_id,
                                'tvdb_id': tvdb_id,
                                'season': season_num,
                                'episode': episode_num,
                                'episode_title': episode.get('name', ''),
                                'current_quality': current_quality,
                                'target_quality': cutoff_quality,
                                'file_path': file_path,
                                'quality_profile': quality_profile_name,
                                'root_folder': root_folder,
                                'poster_path': poster_path,
                                'instance_id': instance_id
                            })
            except Exception as e:
                tv_hunt_logger.debug(f"Error checking quality for {series_title}: {e}")
        
        return episodes_needing_upgrade
        
    except Exception as e:
        tv_hunt_logger.error(f"Error getting episodes needing upgrade: {e}")
        return []


def _quality_meets_cutoff(current: str, cutoff: str) -> bool:
    """
    Check if current quality meets or exceeds cutoff quality.
    
    Quality hierarchy (lowest to highest):
    SDTV < HDTV-720p < HDTV-1080p < WEBDL-720p < WEBDL-1080p < Bluray-720p < Bluray-1080p < WEBDL-2160p < Bluray-2160p
    """
    quality_ranks = {
        'SDTV': 1,
        'HDTV-720p': 2,
        'HDTV-1080p': 3,
        'WEBDL-720p': 4,
        'WEBDL-1080p': 5,
        'Bluray-720p': 6,
        'Bluray-1080p': 7,
        'WEBDL-2160p': 8,
        'Bluray-2160p': 9,
    }
    
    current_rank = quality_ranks.get(current, 0)
    cutoff_rank = quality_ranks.get(cutoff, 999)
    
    return current_rank >= cutoff_rank


def process_cutoff_upgrades(
    app_settings: Dict[str, Any],
    stop_check: Callable[[], bool],
) -> bool:
    """
    Process quality cutoff upgrades for TV Hunt based on settings.
    
    Args:
        app_settings: Instance settings dict
        stop_check: Function to check if stop is requested
    
    Returns:
        True if any episodes were processed for upgrades, False otherwise
    """
    tv_hunt_logger.info("=== Starting TV Hunt Quality Cutoff Upgrades ===")
    
    processed_any = False
    instance_id = app_settings.get('instance_id')
    instance_name = app_settings.get("instance_name", "Default")
    hunt_upgrade_episodes = app_settings.get('hunt_upgrade_episodes', 0)
    
    if not instance_id:
        tv_hunt_logger.warning("No instance_id in app_settings, skipping upgrade cycle.")
        return False
    
    if hunt_upgrade_episodes <= 0:
        tv_hunt_logger.info(f"'hunt_upgrade_episodes' setting is 0 or less for instance '{instance_name}'. Skipping upgrade processing.")
        return False
    
    if stop_check and stop_check():
        tv_hunt_logger.info("Stop requested before upgrade cycle started.")
        return False
    
    # Get episodes eligible for upgrade
    tv_hunt_logger.info(f"Retrieving episodes eligible for cutoff upgrade for instance '{instance_name}'...")
    upgrade_eligible = get_episodes_needing_upgrade(instance_id)
    
    if not upgrade_eligible:
        tv_hunt_logger.info("No episodes found that need quality upgrades.")
        return False
    
    tv_hunt_logger.info(f"Found {len(upgrade_eligible)} episodes eligible for quality upgrade.")
    
    # Randomly select episodes to upgrade
    tv_hunt_logger.info(f"Randomly selecting up to {hunt_upgrade_episodes} episodes for quality upgrade.")
    episodes_to_upgrade = random.sample(upgrade_eligible, min(len(upgrade_eligible), hunt_upgrade_episodes))
    
    tv_hunt_logger.info(f"Selected {len(episodes_to_upgrade)} episodes to search for upgrades.")
    
    # Log selected episodes
    if episodes_to_upgrade:
        tv_hunt_logger.info("Episodes selected for upgrade processing in this cycle:")
        for idx, episode in enumerate(episodes_to_upgrade):
            series_title = episode.get('series_title', 'Unknown')
            season = episode.get('season', 0)
            episode_num = episode.get('episode', 0)
            current_q = episode.get('current_quality', 'Unknown')
            target_q = episode.get('target_quality', 'Unknown')
            tv_hunt_logger.info(f"  {idx+1}. {series_title} S{season:02d}E{episode_num:02d} - {current_q} -> {target_q}")
    
    # Process selected episodes (trigger search for better quality)
    processed_count = 0
    for episode in episodes_to_upgrade:
        if stop_check and stop_check():
            tv_hunt_logger.info("Stop requested during upgrade processing.")
            break
        
        series_title = episode.get('series_title', '')
        season = episode.get('season', 0)
        episode_num = episode.get('episode', 0)
        episode_title = episode.get('episode_title', '')
        current_quality = episode.get('current_quality', '')
        target_quality = episode.get('target_quality', '')
        
        tv_hunt_logger.info(f"Processing upgrade for '{series_title}' S{season:02d}E{episode_num:02d}: {current_quality} -> {target_quality}")
        
        # Trigger search for better quality
        from ...routes.media_hunt.discovery_tv import perform_tv_hunt_request
        
        try:
            from src.primary.stats_manager import increment_stat_only
            increment_stat_only("tv_hunt", "hunted", 1, str(instance_id))
        except Exception:
            pass
        
        success, msg = perform_tv_hunt_request(
            instance_id, series_title,
            season_number=season,
            episode_number=episode_num,
            tvdb_id=episode.get('tvdb_id'),
            root_folder=episode.get('root_folder'),
            quality_profile=episode.get('quality_profile'),
            poster_path=episode.get('poster_path')
        )
        
        if success:
            processed_any = True
            processed_count += 1
            tv_hunt_logger.info(f"  - Successfully triggered upgrade search for '{series_title}' S{season:02d}E{episode_num:02d}")
            
            try:
                from src.primary.stats_manager import increment_stat_only
                increment_stat_only("tv_hunt", "found", 1, str(instance_id))
            except Exception:
                pass
            
            try:
                from src.primary.utils.history_utils import log_processed_media
                display = f"{series_title} S{season:02d}E{episode_num:02d}"
                if episode_title:
                    display += f" - {episode_title}"
                log_processed_media("tv_hunt", display, episode.get('tmdb_id'), 
                                   str(instance_id), "upgrade", 
                                   display_name_for_log=instance_name)
                tv_hunt_logger.debug(f"Logged quality upgrade to history for episode: {display}")
            except Exception as e:
                tv_hunt_logger.warning(f"Failed to log history for '{series_title}' S{season:02d}E{episode_num:02d}: {e}")
        else:
            tv_hunt_logger.warning(f"  - Failed to trigger upgrade search for '{series_title}' S{season:02d}E{episode_num:02d}: {msg}")
    
    tv_hunt_logger.info(f"=== Completed TV Hunt Upgrade Cycle: Processed {processed_count} of {len(episodes_to_upgrade)} selected episodes ===")
    return processed_any
