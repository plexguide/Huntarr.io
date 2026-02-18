"""
TV Hunt Episode Monitoring System
Handles per-season and per-episode monitoring controls.
"""
from typing import List, Dict, Optional
from src.primary.utils.logger import get_logger

logger = get_logger("tv_hunt")


def set_season_monitoring(series_title: str, season: int, monitored: bool, instance_id: int) -> bool:
    """
    Set monitoring status for an entire season.
    
    Args:
        series_title: Series title
        season: Season number
        monitored: True to monitor, False to unmonitor
        instance_id: TV Hunt instance ID
    
    Returns:
        True if successful
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
                        s['monitored'] = monitored
                        # Update all episodes in season
                        for ep in s.get('episodes', []):
                            ep['monitored'] = monitored
                        
                        db.save_app_config_for_instance('tv_hunt_collection', instance_id, config)
                        logger.info(f"Set season {season} monitoring to {monitored} for {series_title}")
                        return True
        
        return False
        
    except Exception as e:
        logger.error(f"Error setting season monitoring: {e}")
        return False


def set_episode_monitoring(series_title: str, season: int, episode: int, 
                          monitored: bool, instance_id: int) -> bool:
    """
    Set monitoring status for a specific episode.
    
    Args:
        series_title: Series title
        season: Season number
        episode: Episode number
        monitored: True to monitor, False to unmonitor
        instance_id: TV Hunt instance ID
    
    Returns:
        True if successful
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
                                ep['monitored'] = monitored
                                db.save_app_config_for_instance('tv_hunt_collection', instance_id, config)
                                logger.info(f"Set episode S{season:02d}E{episode:02d} monitoring to {monitored} for {series_title}")
                                return True
        
        return False
        
    except Exception as e:
        logger.error(f"Error setting episode monitoring: {e}")
        return False


def get_monitored_episodes(series_title: str, instance_id: int) -> List[Dict]:
    """
    Get all monitored episodes for a series.
    
    Args:
        series_title: Series title
        instance_id: TV Hunt instance ID
    
    Returns:
        List of monitored episodes
    """
    from src.primary.utils.database import get_database
    
    try:
        db = get_database()
        config = db.get_app_config_for_instance('tv_hunt_collection', instance_id) or {}
        series_list = config.get('series', [])
        
        monitored_episodes = []
        
        for series in series_list:
            if series.get('title', '').lower() == series_title.lower():
                seasons = series.get('seasons', [])
                for season in seasons:
                    season_num = season.get('season_number')
                    episodes = season.get('episodes', [])
                    
                    for episode in episodes:
                        if episode.get('monitored', True):
                            monitored_episodes.append({
                                'season': season_num,
                                'episode': episode.get('episode_number'),
                                'title': episode.get('title', ''),
                                'status': episode.get('status', 'missing')
                            })
        
        return monitored_episodes
        
    except Exception as e:
        logger.error(f"Error getting monitored episodes: {e}")
        return []


def apply_monitoring_preset(series_title: str, preset: str, instance_id: int) -> bool:
    """
    Apply a monitoring preset to a series.
    
    Presets:
    - 'all': Monitor all episodes
    - 'none': Unmonitor all episodes
    - 'future': Monitor only future episodes
    - 'missing': Monitor only missing episodes
    - 'existing': Monitor only existing episodes
    - 'first_season': Monitor only first season
    - 'latest_season': Monitor only latest season
    
    Args:
        series_title: Series title
        preset: Preset name
        instance_id: TV Hunt instance ID
    
    Returns:
        True if successful
    """
    from src.primary.utils.database import get_database
    import time
    
    try:
        db = get_database()
        config = db.get_app_config_for_instance('tv_hunt_collection', instance_id) or {}
        series_list = config.get('series', [])
        
        for series in series_list:
            if series.get('title', '').lower() == series_title.lower():
                seasons = series.get('seasons', [])
                
                if preset == 'all':
                    for season in seasons:
                        season['monitored'] = True
                        for ep in season.get('episodes', []):
                            ep['monitored'] = True
                
                elif preset == 'none':
                    for season in seasons:
                        season['monitored'] = False
                        for ep in season.get('episodes', []):
                            ep['monitored'] = False
                
                elif preset == 'missing':
                    for season in seasons:
                        for ep in season.get('episodes', []):
                            ep['monitored'] = ep.get('status') == 'missing'
                
                elif preset == 'existing':
                    for season in seasons:
                        for ep in season.get('episodes', []):
                            ep['monitored'] = ep.get('status') == 'available'
                
                elif preset == 'first_season':
                    for idx, season in enumerate(seasons):
                        monitored = (idx == 0)
                        season['monitored'] = monitored
                        for ep in season.get('episodes', []):
                            ep['monitored'] = monitored
                
                elif preset == 'latest_season':
                    for idx, season in enumerate(seasons):
                        monitored = (idx == len(seasons) - 1)
                        season['monitored'] = monitored
                        for ep in season.get('episodes', []):
                            ep['monitored'] = monitored
                
                else:
                    logger.error(f"Unknown monitoring preset: {preset}")
                    return False
                
                db.save_app_config_for_instance('tv_hunt_collection', instance_id, config)
                logger.info(f"Applied monitoring preset '{preset}' to {series_title}")
                return True
        
        return False
        
    except Exception as e:
        logger.error(f"Error applying monitoring preset: {e}")
        return False
