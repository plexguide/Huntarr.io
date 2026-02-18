"""
Movie Hunt Collection Management
Advanced collection features for organizing and managing movie libraries.
"""
from typing import Dict, List, Any, Optional
from src.primary.utils.logger import get_logger

logger = get_logger("movie_hunt")


def get_collection_stats(instance_id: int) -> Dict[str, Any]:
    """
    Get comprehensive statistics about the movie collection.
    
    Args:
        instance_id: Movie Hunt instance ID
    
    Returns:
        Dict with collection statistics
    """
    from src.primary.utils.database import get_database
    
    try:
        db = get_database()
        config = db.get_app_config_for_instance('movie_hunt_collection', instance_id) or {}
        movies = config.get('movies', [])
        
        stats = {
            'total': len(movies),
            'monitored': 0,
            'unmonitored': 0,
            'available': 0,
            'missing': 0,
            'by_quality': {},
            'by_year': {},
            'total_size_gb': 0,
        }
        
        for movie in movies:
            # Monitored status
            if movie.get('monitored', True):
                stats['monitored'] += 1
            else:
                stats['unmonitored'] += 1
            
            # Availability status
            if movie.get('status') == 'available':
                stats['available'] += 1
            else:
                stats['missing'] += 1
            
            # Quality breakdown
            quality = movie.get('quality', 'Unknown')
            stats['by_quality'][quality] = stats['by_quality'].get(quality, 0) + 1
            
            # Year breakdown
            year = str(movie.get('year', 'Unknown'))
            stats['by_year'][year] = stats['by_year'].get(year, 0) + 1
            
            # Size calculation
            size_bytes = movie.get('size_bytes', 0)
            if size_bytes:
                stats['total_size_gb'] += size_bytes / (1024**3)
        
        # Round size to 2 decimal places
        stats['total_size_gb'] = round(stats['total_size_gb'], 2)
        
        return stats
        
    except Exception as e:
        logger.error(f"Error getting collection stats: {e}")
        return {
            'total': 0,
            'monitored': 0,
            'unmonitored': 0,
            'available': 0,
            'missing': 0,
            'by_quality': {},
            'by_year': {},
            'total_size_gb': 0,
        }


def get_movies_by_quality(instance_id: int, quality: str) -> List[Dict[str, Any]]:
    """
    Get all movies with a specific quality.
    
    Args:
        instance_id: Movie Hunt instance ID
        quality: Quality string to filter by
    
    Returns:
        List of movies matching the quality
    """
    from src.primary.utils.database import get_database
    
    try:
        db = get_database()
        config = db.get_app_config_for_instance('movie_hunt_collection', instance_id) or {}
        movies = config.get('movies', [])
        
        return [m for m in movies if m.get('quality', '') == quality]
        
    except Exception as e:
        logger.error(f"Error getting movies by quality: {e}")
        return []


def get_movies_by_year_range(instance_id: int, start_year: int, end_year: int) -> List[Dict[str, Any]]:
    """
    Get movies within a year range.
    
    Args:
        instance_id: Movie Hunt instance ID
        start_year: Start year (inclusive)
        end_year: End year (inclusive)
    
    Returns:
        List of movies in the year range
    """
    from src.primary.utils.database import get_database
    
    try:
        db = get_database()
        config = db.get_app_config_for_instance('movie_hunt_collection', instance_id) or {}
        movies = config.get('movies', [])
        
        filtered = []
        for movie in movies:
            try:
                year = int(movie.get('year', 0))
                if start_year <= year <= end_year:
                    filtered.append(movie)
            except (ValueError, TypeError):
                continue
        
        return filtered
        
    except Exception as e:
        logger.error(f"Error getting movies by year range: {e}")
        return []


def get_recently_added(instance_id: int, limit: int = 20) -> List[Dict[str, Any]]:
    """
    Get recently added movies to the collection.
    
    Args:
        instance_id: Movie Hunt instance ID
        limit: Maximum number of movies to return
    
    Returns:
        List of recently added movies
    """
    from src.primary.utils.database import get_database
    
    try:
        db = get_database()
        config = db.get_app_config_for_instance('movie_hunt_collection', instance_id) or {}
        movies = config.get('movies', [])
        
        # Sort by added_at timestamp if available
        movies_with_time = [m for m in movies if m.get('added_at')]
        movies_with_time.sort(key=lambda x: x.get('added_at', 0), reverse=True)
        
        return movies_with_time[:limit]
        
    except Exception as e:
        logger.error(f"Error getting recently added movies: {e}")
        return []


def get_recently_available(instance_id: int, limit: int = 20) -> List[Dict[str, Any]]:
    """
    Get movies that recently became available (downloaded).
    
    Args:
        instance_id: Movie Hunt instance ID
        limit: Maximum number of movies to return
    
    Returns:
        List of recently available movies
    """
    from src.primary.utils.database import get_database
    
    try:
        db = get_database()
        config = db.get_app_config_for_instance('movie_hunt_collection', instance_id) or {}
        movies = config.get('movies', [])
        
        # Filter available movies and sort by when they became available
        available = [m for m in movies if m.get('status') == 'available' and m.get('available_at')]
        available.sort(key=lambda x: x.get('available_at', 0), reverse=True)
        
        return available[:limit]
        
    except Exception as e:
        logger.error(f"Error getting recently available movies: {e}")
        return []


def bulk_update_monitoring(instance_id: int, movie_ids: List[int], monitored: bool) -> int:
    """
    Bulk update monitoring status for multiple movies.
    
    Args:
        instance_id: Movie Hunt instance ID
        movie_ids: List of movie IDs (tmdb_id) to update
        monitored: New monitoring status
    
    Returns:
        Number of movies updated
    """
    from src.primary.utils.database import get_database
    
    try:
        db = get_database()
        config = db.get_app_config_for_instance('movie_hunt_collection', instance_id) or {}
        movies = config.get('movies', [])
        
        updated_count = 0
        for movie in movies:
            if movie.get('tmdb_id') in movie_ids:
                movie['monitored'] = monitored
                updated_count += 1
        
        if updated_count > 0:
            db.save_app_config_for_instance('movie_hunt_collection', instance_id, config)
            logger.info(f"Bulk updated monitoring for {updated_count} movies")
        
        return updated_count
        
    except Exception as e:
        logger.error(f"Error bulk updating monitoring: {e}")
        return 0


def bulk_update_quality_profile(instance_id: int, movie_ids: List[int], quality_profile: str) -> int:
    """
    Bulk update quality profile for multiple movies.
    
    Args:
        instance_id: Movie Hunt instance ID
        movie_ids: List of movie IDs (tmdb_id) to update
        quality_profile: New quality profile name
    
    Returns:
        Number of movies updated
    """
    from src.primary.utils.database import get_database
    
    try:
        db = get_database()
        config = db.get_app_config_for_instance('movie_hunt_collection', instance_id) or {}
        movies = config.get('movies', [])
        
        updated_count = 0
        for movie in movies:
            if movie.get('tmdb_id') in movie_ids:
                movie['quality_profile'] = quality_profile
                updated_count += 1
        
        if updated_count > 0:
            db.save_app_config_for_instance('movie_hunt_collection', instance_id, config)
            logger.info(f"Bulk updated quality profile for {updated_count} movies")
        
        return updated_count
        
    except Exception as e:
        logger.error(f"Error bulk updating quality profile: {e}")
        return 0
