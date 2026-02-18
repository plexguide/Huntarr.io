"""
TV Hunt Collection Management
Advanced collection features for organizing and managing TV series libraries.
"""
from typing import Dict, List, Any, Optional
from src.primary.utils.logger import get_logger

logger = get_logger("tv_hunt")


def get_collection_stats(instance_id: int) -> Dict[str, Any]:
    """
    Get comprehensive statistics about the TV series collection.
    
    Args:
        instance_id: TV Hunt instance ID
    
    Returns:
        Dict with collection statistics
    """
    from src.primary.utils.database import get_database
    
    try:
        db = get_database()
        config = db.get_app_config_for_instance('tv_hunt_collection', instance_id) or {}
        series_list = config.get('series', [])
        
        stats = {
            'total_series': len(series_list),
            'monitored_series': 0,
            'unmonitored_series': 0,
            'total_episodes': 0,
            'available_episodes': 0,
            'missing_episodes': 0,
            'by_quality': {},
            'by_series_type': {},
            'total_size_gb': 0,
        }
        
        for series in series_list:
            # Monitored status
            if series.get('monitored', True):
                stats['monitored_series'] += 1
            else:
                stats['unmonitored_series'] += 1
            
            # Series type
            series_type = series.get('series_type', 'standard')
            stats['by_series_type'][series_type] = stats['by_series_type'].get(series_type, 0) + 1
            
            # Episode stats
            seasons = series.get('seasons', [])
            for season in seasons:
                episodes = season.get('episodes', [])
                for episode in episodes:
                    stats['total_episodes'] += 1
                    
                    if episode.get('status') == 'available':
                        stats['available_episodes'] += 1
                    else:
                        stats['missing_episodes'] += 1
                    
                    # Quality breakdown
                    quality = episode.get('quality', 'Unknown')
                    stats['by_quality'][quality] = stats['by_quality'].get(quality, 0) + 1
                    
                    # Size calculation
                    size_bytes = episode.get('size_bytes', 0)
                    if size_bytes:
                        stats['total_size_gb'] += size_bytes / (1024**3)
        
        # Round size to 2 decimal places
        stats['total_size_gb'] = round(stats['total_size_gb'], 2)
        
        return stats
        
    except Exception as e:
        logger.error(f"Error getting collection stats: {e}")
        return {
            'total_series': 0,
            'monitored_series': 0,
            'unmonitored_series': 0,
            'total_episodes': 0,
            'available_episodes': 0,
            'missing_episodes': 0,
            'by_quality': {},
            'by_series_type': {},
            'total_size_gb': 0,
        }


def get_series_by_type(instance_id: int, series_type: str) -> List[Dict[str, Any]]:
    """
    Get all series of a specific type (standard, daily, anime).
    
    Args:
        instance_id: TV Hunt instance ID
        series_type: Series type to filter by
    
    Returns:
        List of series matching the type
    """
    from src.primary.utils.database import get_database
    
    try:
        db = get_database()
        config = db.get_app_config_for_instance('tv_hunt_collection', instance_id) or {}
        series_list = config.get('series', [])
        
        return [s for s in series_list if s.get('series_type', 'standard') == series_type]
        
    except Exception as e:
        logger.error(f"Error getting series by type: {e}")
        return []


def get_continuing_series(instance_id: int) -> List[Dict[str, Any]]:
    """
    Get all continuing (ongoing) series.
    
    Args:
        instance_id: TV Hunt instance ID
    
    Returns:
        List of continuing series
    """
    from src.primary.utils.database import get_database
    
    try:
        db = get_database()
        config = db.get_app_config_for_instance('tv_hunt_collection', instance_id) or {}
        series_list = config.get('series', [])
        
        return [s for s in series_list if s.get('status', '').lower() == 'continuing']
        
    except Exception as e:
        logger.error(f"Error getting continuing series: {e}")
        return []


def get_ended_series(instance_id: int) -> List[Dict[str, Any]]:
    """
    Get all ended series.
    
    Args:
        instance_id: TV Hunt instance ID
    
    Returns:
        List of ended series
    """
    from src.primary.utils.database import get_database
    
    try:
        db = get_database()
        config = db.get_app_config_for_instance('tv_hunt_collection', instance_id) or {}
        series_list = config.get('series', [])
        
        return [s for s in series_list if s.get('status', '').lower() == 'ended']
        
    except Exception as e:
        logger.error(f"Error getting ended series: {e}")
        return []


def get_recently_added_series(instance_id: int, limit: int = 20) -> List[Dict[str, Any]]:
    """
    Get recently added series to the collection.
    
    Args:
        instance_id: TV Hunt instance ID
        limit: Maximum number of series to return
    
    Returns:
        List of recently added series
    """
    from src.primary.utils.database import get_database
    
    try:
        db = get_database()
        config = db.get_app_config_for_instance('tv_hunt_collection', instance_id) or {}
        series_list = config.get('series', [])
        
        # Sort by added_at timestamp if available
        series_with_time = [s for s in series_list if s.get('added_at')]
        series_with_time.sort(key=lambda x: x.get('added_at', 0), reverse=True)
        
        return series_with_time[:limit]
        
    except Exception as e:
        logger.error(f"Error getting recently added series: {e}")
        return []


def bulk_update_series_monitoring(instance_id: int, series_ids: List[int], monitored: bool) -> int:
    """
    Bulk update monitoring status for multiple series.
    
    Args:
        instance_id: TV Hunt instance ID
        series_ids: List of series IDs (tvdb_id) to update
        monitored: New monitoring status
    
    Returns:
        Number of series updated
    """
    from src.primary.utils.database import get_database
    
    try:
        db = get_database()
        config = db.get_app_config_for_instance('tv_hunt_collection', instance_id) or {}
        series_list = config.get('series', [])
        
        updated_count = 0
        for series in series_list:
            if series.get('tvdb_id') in series_ids:
                series['monitored'] = monitored
                updated_count += 1
        
        if updated_count > 0:
            db.save_app_config_for_instance('tv_hunt_collection', instance_id, config)
            logger.info(f"Bulk updated monitoring for {updated_count} series")
        
        return updated_count
        
    except Exception as e:
        logger.error(f"Error bulk updating series monitoring: {e}")
        return 0


def bulk_update_season_monitoring(instance_id: int, series_id: int, season_numbers: List[int], monitored: bool) -> int:
    """
    Bulk update monitoring status for multiple seasons of a series.
    
    Args:
        instance_id: TV Hunt instance ID
        series_id: Series ID (tvdb_id)
        season_numbers: List of season numbers to update
        monitored: New monitoring status
    
    Returns:
        Number of seasons updated
    """
    from src.primary.utils.database import get_database
    
    try:
        db = get_database()
        config = db.get_app_config_for_instance('tv_hunt_collection', instance_id) or {}
        series_list = config.get('series', [])
        
        updated_count = 0
        for series in series_list:
            if series.get('tvdb_id') == series_id:
                seasons = series.get('seasons', [])
                for season in seasons:
                    if season.get('season_number') in season_numbers:
                        season['monitored'] = monitored
                        updated_count += 1
                break
        
        if updated_count > 0:
            db.save_app_config_for_instance('tv_hunt_collection', instance_id, config)
            logger.info(f"Bulk updated monitoring for {updated_count} seasons")
        
        return updated_count
        
    except Exception as e:
        logger.error(f"Error bulk updating season monitoring: {e}")
        return 0


def bulk_update_quality_profile(instance_id: int, series_ids: List[int], quality_profile: str) -> int:
    """
    Bulk update quality profile for multiple series.
    
    Args:
        instance_id: TV Hunt instance ID
        series_ids: List of series IDs (tvdb_id) to update
        quality_profile: New quality profile name
    
    Returns:
        Number of series updated
    """
    from src.primary.utils.database import get_database
    
    try:
        db = get_database()
        config = db.get_app_config_for_instance('tv_hunt_collection', instance_id) or {}
        series_list = config.get('series', [])
        
        updated_count = 0
        for series in series_list:
            if series.get('tvdb_id') in series_ids:
                series['quality_profile'] = quality_profile
                updated_count += 1
        
        if updated_count > 0:
            db.save_app_config_for_instance('tv_hunt_collection', instance_id, config)
            logger.info(f"Bulk updated quality profile for {updated_count} series")
        
        return updated_count
        
    except Exception as e:
        logger.error(f"Error bulk updating quality profile: {e}")
        return 0
