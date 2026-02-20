"""
Movie Hunt: quality upgrade processing (cutoff-based and PROPER/REPACK detection).
Handles automatic quality upgrades for movies that haven't met their cutoff quality.
"""

from typing import Dict, Any, Callable, List, Optional
import random

from ...utils.logger import get_logger

movie_hunt_logger = get_logger("movie_hunt")


def get_movies_needing_upgrade(instance_id: int) -> List[Dict[str, Any]]:
    """
    Get movies that are available but haven't met their quality cutoff.
    
    Args:
        instance_id: Movie Hunt instance ID
    
    Returns:
        List of movies needing upgrade
    """
    from ...utils.database import get_database
    from ...routes.media_hunt.profiles import get_profile_by_name_or_default, _movie_profiles_context
    
    try:
        db = get_database()
        config = db.get_app_config_for_instance('movie_hunt_collection', instance_id) or {}
        movies = config.get('movies', [])
        
        movies_needing_upgrade = []
        
        for movie in movies:
            title = movie.get('title', '')
            year = movie.get('year', '')
            status = movie.get('status', '')
            file_path = movie.get('file_path', '')
            current_quality = movie.get('quality', '')
            quality_profile_name = movie.get('quality_profile', '')
            
            # Only consider available movies
            if status != 'available' or not file_path:
                continue
            
            # Get quality profile and check cutoff
            if quality_profile_name:
                try:
                    profile = get_profile_by_name_or_default(quality_profile_name, instance_id, _movie_profiles_context())
                    cutoff_quality = profile.get('cutoff', '')
                    
                    if cutoff_quality and current_quality:
                        if not _quality_meets_cutoff(current_quality, cutoff_quality):
                            movies_needing_upgrade.append({
                                'title': title,
                                'year': year,
                                'current_quality': current_quality,
                                'target_quality': cutoff_quality,
                                'file_path': file_path,
                                'quality_profile': quality_profile_name,
                                'root_folder': movie.get('root_folder'),
                                'tmdb_id': movie.get('tmdb_id'),
                                'poster_path': movie.get('poster_path'),
                                'instance_id': instance_id
                            })
                except Exception as e:
                    movie_hunt_logger.debug(f"Error checking quality for {title}: {e}")
        
        return movies_needing_upgrade
        
    except Exception as e:
        movie_hunt_logger.error(f"Error getting movies needing upgrade: {e}")
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


def update_movie_quality(title: str, year: str, new_quality: str, 
                        new_file_path: str, instance_id: int) -> bool:
    """
    Update movie quality after successful upgrade.
    
    Args:
        title: Movie title
        year: Movie year
        new_quality: New quality string
        new_file_path: New file path
        instance_id: Movie Hunt instance ID
    
    Returns:
        True if update successful
    """
    from ...utils.database import get_database
    import time
    
    try:
        db = get_database()
        config = db.get_app_config_for_instance('movie_hunt_collection', instance_id) or {}
        movies = config.get('movies', [])
        
        for movie in movies:
            if movie.get('title', '').lower() == title.lower() and str(movie.get('year', '')) == str(year):
                movie['quality'] = new_quality
                movie['file_path'] = new_file_path
                movie['upgraded_at'] = time.time()
                
                db.save_app_config_for_instance('movie_hunt_collection', instance_id, config)
                movie_hunt_logger.info(f"Updated quality for {title} ({year}) to {new_quality}")
                return True
        
        return False
        
    except Exception as e:
        movie_hunt_logger.error(f"Error updating movie quality: {e}")
        return False


def process_cutoff_upgrades(
    app_settings: Dict[str, Any],
    stop_check: Callable[[], bool],
) -> bool:
    """
    Process quality cutoff upgrades for Movie Hunt based on settings.
    
    Args:
        app_settings: Instance settings dict
        stop_check: Function to check if stop is requested
    
    Returns:
        True if any movies were processed for upgrades, False otherwise
    """
    movie_hunt_logger.info(f"Upgrade: checking for {hunt_upgrade_movies} movies for '{instance_name}'")
    
    processed_any = False
    instance_id = app_settings.get('instance_id')
    instance_name = app_settings.get("instance_name", "Default")
    hunt_upgrade_movies = app_settings.get('hunt_upgrade_movies', 0)
    
    if not instance_id:
        movie_hunt_logger.warning("No instance_id in app_settings, skipping upgrade cycle.")
        return False
    
    if hunt_upgrade_movies <= 0:
        movie_hunt_logger.info(f"'hunt_upgrade_movies' setting is 0 or less for instance '{instance_name}'. Skipping upgrade processing.")
        return False
    
    if stop_check and stop_check():
        movie_hunt_logger.info("Stop requested before upgrade cycle started.")
        return False
    
    # Get movies eligible for upgrade
    movie_hunt_logger.info(f"Retrieving movies eligible for cutoff upgrade for instance '{instance_name}'...")
    upgrade_eligible = get_movies_needing_upgrade(instance_id)
    
    if not upgrade_eligible:
        movie_hunt_logger.info("No movies found that need quality upgrades.")
        return False
    
    movie_hunt_logger.info(f"Found {len(upgrade_eligible)} movies eligible for quality upgrade.")
    
    # Randomly select movies to upgrade
    movie_hunt_logger.info(f"Randomly selecting up to {hunt_upgrade_movies} movies for quality upgrade.")
    movies_to_upgrade = random.sample(upgrade_eligible, min(len(upgrade_eligible), hunt_upgrade_movies))
    
    movie_hunt_logger.info(f"Upgrade: selected {len(movies_to_upgrade)} movies for search:")
    
    # Log selected movies
    if movies_to_upgrade:
        for idx, movie in enumerate(movies_to_upgrade):
            title = movie.get('title', 'Unknown')
            year = movie.get('year', '')
            current_q = movie.get('current_quality', 'Unknown')
            target_q = movie.get('target_quality', 'Unknown')
            movie_hunt_logger.info(f"  {idx+1}. {title} ({year}) - {current_q} -> {target_q}")
    
    # Process selected movies (trigger search for better quality)
    processed_count = 0
    for movie in movies_to_upgrade:
        if stop_check and stop_check():
            movie_hunt_logger.info("Stop requested during upgrade processing.")
            break
        
        title = movie.get('title', '')
        year = movie.get('year', '')
        current_quality = movie.get('current_quality', '')
        target_quality = movie.get('target_quality', '')
        
        movie_hunt_logger.info(f"Processing upgrade for '{title}' ({year}): {current_quality} -> {target_quality}")
        
        # Trigger search for better quality
        from ...routes.media_hunt.discovery_movie import perform_movie_hunt_request
        
        try:
            from src.primary.stats_manager import increment_stat_only
            increment_stat_only("movie_hunt", "hunted", 1, str(instance_id))
        except Exception:
            pass
        
        success, msg = perform_movie_hunt_request(
            instance_id, title, year,
            root_folder=movie.get('root_folder'),
            quality_profile=movie.get('quality_profile'),
            tmdb_id=movie.get('tmdb_id'),
            poster_path=movie.get('poster_path')
        )
        
        if success:
            processed_any = True
            processed_count += 1
            movie_hunt_logger.info(f"  - Successfully triggered upgrade search for '{title}' ({year})")
            
            try:
                from src.primary.stats_manager import increment_stat_only
                increment_stat_only("movie_hunt", "found", 1, str(instance_id))
            except Exception:
                pass
            
            try:
                from src.primary.utils.history_utils import log_processed_media
                media_name = f"{title} ({year})" if year else title
                log_processed_media("movie_hunt", media_name, 
                                   movie.get('tmdb_id'), str(instance_id), "upgrade", 
                                   display_name_for_log=instance_name)
                movie_hunt_logger.debug(f"Logged quality upgrade to history for movie: {media_name}")
            except Exception as e:
                movie_hunt_logger.warning(f"Failed to log history for '{title}': {e}")
        else:
            movie_hunt_logger.warning(f"  - Failed to trigger upgrade search for '{title}' ({year}): {msg}")
    
    movie_hunt_logger.info(f"Upgrade: processed {processed_count} of {len(movies_to_upgrade)} movies")
    return processed_any
