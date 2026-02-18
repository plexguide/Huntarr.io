"""
TV Hunt Quality Upgrade System
Handles automatic quality upgrades for episodes that haven't met their cutoff quality.
"""
import time
from typing import Dict, List, Optional, Any
from src.primary.utils.logger import get_logger

logger = get_logger("tv_hunt")


def get_episodes_needing_upgrade(instance_id: int, cutoff_quality: str = None) -> List[Dict[str, Any]]:
    """
    Get episodes that are available but haven't met their quality cutoff.
    
    Args:
        instance_id: TV Hunt instance ID
        cutoff_quality: Target quality cutoff (e.g., 'WEBDL-1080p')
    
    Returns:
        List of episodes needing upgrade
    """
    from src.primary.utils.database import get_database
    
    try:
        db = get_database()
        config = db.get_app_config_for_instance('tv_hunt_collection', instance_id) or {}
        series_list = config.get('series', [])
        
        episodes_needing_upgrade = []
        
        for series in series_list:
            series_title = series.get('title', '')
            seasons = series.get('seasons', [])
            
            for season in seasons:
                season_num = season.get('season_number')
                episodes = season.get('episodes', [])
                
                for episode in episodes:
                    episode_num = episode.get('episode_number')
                    status = episode.get('status', '')
                    current_quality = episode.get('quality', '')
                    file_path = episode.get('file_path', '')
                    
                    # Only consider available episodes
                    if status != 'available' or not file_path:
                        continue
                    
                    # Check if quality is below cutoff
                    if cutoff_quality and current_quality:
                        if not _quality_meets_cutoff(current_quality, cutoff_quality):
                            episodes_needing_upgrade.append({
                                'series_title': series_title,
                                'season': season_num,
                                'episode': episode_num,
                                'current_quality': current_quality,
                                'target_quality': cutoff_quality,
                                'file_path': file_path,
                                'instance_id': instance_id
                            })
        
        return episodes_needing_upgrade
        
    except Exception as e:
        logger.error(f"Error getting episodes needing upgrade: {e}")
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


def detect_proper_repack(release_name: str) -> Optional[str]:
    """
    Detect if a release is a PROPER, REPACK, REAL, or RERIP.
    
    Args:
        release_name: Release name to check
    
    Returns:
        Modifier string ('PROPER', 'REPACK', 'REAL', 'RERIP') or None
    """
    import re
    
    release_upper = release_name.upper()
    
    if 'PROPER' in release_upper:
        return 'PROPER'
    elif 'REPACK' in release_upper:
        return 'REPACK'
    elif 'REAL' in release_upper:
        return 'REAL'
    elif 'RERIP' in release_upper:
        return 'RERIP'
    
    return None


def should_upgrade_for_proper(current_file: str, new_release: str) -> bool:
    """
    Determine if a new release should replace current file based on PROPER/REPACK status.
    
    Args:
        current_file: Current filename
        new_release: New release name
    
    Returns:
        True if new release should replace current file
    """
    current_modifier = detect_proper_repack(current_file)
    new_modifier = detect_proper_repack(new_release)
    
    # If new release is PROPER/REPACK and current isn't, upgrade
    if new_modifier and not current_modifier:
        return True
    
    # If both have modifiers, prefer REAL > PROPER > REPACK > RERIP
    if current_modifier and new_modifier:
        modifier_priority = {'REAL': 4, 'PROPER': 3, 'REPACK': 2, 'RERIP': 1}
        current_priority = modifier_priority.get(current_modifier, 0)
        new_priority = modifier_priority.get(new_modifier, 0)
        return new_priority > current_priority
    
    return False


def update_episode_quality(series_title: str, season: int, episode: int, 
                          new_quality: str, new_file_path: str, instance_id: int) -> bool:
    """
    Update episode quality after successful upgrade.
    
    Args:
        series_title: Series title
        season: Season number
        episode: Episode number
        new_quality: New quality string
        new_file_path: New file path
        instance_id: TV Hunt instance ID
    
    Returns:
        True if update successful
    """
    from src.primary.utils.database import get_database
    
    try:
        db = get_database()
        config = db.get_app_config_for_instance('tv_hunt_collection', instance_id) or {}
        series_list = config.get('series', [])
        
        for series in series_list:
            if series.get('title', '').lower() == series_title.lower():
                seasons = series.get('seasons', [])
                for s in seasons:
                    if s.get('season_number') == season:
                        episodes = s.get('episodes', [])
                        for ep in episodes:
                            if ep.get('episode_number') == episode:
                                ep['quality'] = new_quality
                                ep['file_path'] = new_file_path
                                ep['upgraded_at'] = time.time()
                                
                                db.save_app_config_for_instance('tv_hunt_collection', instance_id, config)
                                logger.info(f"Updated quality for {series_title} S{season:02d}E{episode:02d} to {new_quality}")
                                return True
        
        return False
        
    except Exception as e:
        logger.error(f"Error updating episode quality: {e}")
        return False
