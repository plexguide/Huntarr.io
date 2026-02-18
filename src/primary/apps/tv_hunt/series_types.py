"""
TV Hunt Series Type Support
Handles different series types: standard, daily, and anime.
"""
from typing import Dict, Optional
from src.primary.utils.logger import get_logger

logger = get_logger("tv_hunt")


SERIES_TYPES = {
    'standard': {
        'name': 'Standard',
        'description': 'Standard episode numbering (S01E01)',
        'search_format': 'S{season:02d}E{episode:02d}',
        'naming_format': '{Series Title} - S{season:02d}E{episode:02d}',
    },
    'daily': {
        'name': 'Daily',
        'description': 'Daily shows with date-based episodes (2024-01-15)',
        'search_format': '{year}-{month:02d}-{day:02d}',
        'naming_format': '{Series Title} - {year}-{month:02d}-{day:02d}',
    },
    'anime': {
        'name': 'Anime',
        'description': 'Anime with absolute episode numbering',
        'search_format': '{absolute:03d}',
        'naming_format': '{Series Title} - {absolute:03d}',
    }
}


def get_series_type(series_title: str, instance_id: int) -> str:
    """
    Get the series type for a given series.
    
    Args:
        series_title: Series title
        instance_id: TV Hunt instance ID
    
    Returns:
        Series type ('standard', 'daily', or 'anime')
    """
    from src.primary.utils.database import get_database
    
    try:
        db = get_database()
        config = db.get_app_config_for_instance('tv_hunt_collection', instance_id) or {}
        series_list = config.get('series', [])
        
        for series in series_list:
            if series.get('title', '').lower() == series_title.lower():
                return series.get('series_type', 'standard')
        
        return 'standard'
        
    except Exception as e:
        logger.error(f"Error getting series type: {e}")
        return 'standard'


def set_series_type(series_title: str, series_type: str, instance_id: int) -> bool:
    """
    Set the series type for a given series.
    
    Args:
        series_title: Series title
        series_type: Series type ('standard', 'daily', or 'anime')
        instance_id: TV Hunt instance ID
    
    Returns:
        True if successful
    """
    from src.primary.utils.database import get_database
    
    if series_type not in SERIES_TYPES:
        logger.error(f"Invalid series type: {series_type}")
        return False
    
    try:
        db = get_database()
        config = db.get_app_config_for_instance('tv_hunt_collection', instance_id) or {}
        series_list = config.get('series', [])
        
        for series in series_list:
            if series.get('title', '').lower() == series_title.lower():
                series['series_type'] = series_type
                db.save_app_config_for_instance('tv_hunt_collection', instance_id, config)
                logger.info(f"Set series type for {series_title} to {series_type}")
                return True
        
        return False
        
    except Exception as e:
        logger.error(f"Error setting series type: {e}")
        return False


def format_episode_search_query(series_title: str, season: int, episode: int, 
                                series_type: str = 'standard', 
                                air_date: Optional[Dict] = None,
                                absolute_episode: Optional[int] = None) -> str:
    """
    Format episode search query based on series type.
    
    Args:
        series_title: Series title
        season: Season number
        episode: Episode number
        series_type: Series type
        air_date: Air date dict with 'year', 'month', 'day' keys (for daily shows)
        absolute_episode: Absolute episode number (for anime)
    
    Returns:
        Formatted search query
    """
    type_config = SERIES_TYPES.get(series_type, SERIES_TYPES['standard'])
    
    if series_type == 'daily' and air_date:
        episode_part = type_config['search_format'].format(
            year=air_date.get('year', 2024),
            month=air_date.get('month', 1),
            day=air_date.get('day', 1)
        )
    elif series_type == 'anime' and absolute_episode:
        episode_part = type_config['search_format'].format(absolute=absolute_episode)
    else:
        episode_part = type_config['search_format'].format(season=season, episode=episode)
    
    return f"{series_title} {episode_part}"


def get_episode_naming_format(series_type: str = 'standard') -> str:
    """
    Get the naming format template for a series type.
    
    Args:
        series_type: Series type
    
    Returns:
        Naming format template
    """
    type_config = SERIES_TYPES.get(series_type, SERIES_TYPES['standard'])
    return type_config['naming_format']
