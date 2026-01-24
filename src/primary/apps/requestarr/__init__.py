"""
Requestarr module for searching and requesting media through TMDB and *arr apps
"""

import requests
import logging
from typing import Dict, List, Any, Optional
from src.primary.utils.database import get_database

logger = logging.getLogger(__name__)

class RequestarrAPI:
    """API handler for Requestarr functionality"""
    
    def __init__(self):
        self.db = get_database()
        self.tmdb_base_url = "https://api.themoviedb.org/3"
        self.tmdb_image_base_url = "https://image.tmdb.org/t/p/w500"
    
    def get_tmdb_api_key(self) -> str:
        """Get hardcoded TMDB API key"""
        return "9265b0bd0cd1962f7f3225989fcd7192"
    
    def get_trending(self, time_window: str = 'week') -> List[Dict[str, Any]]:
        """Get trending movies and TV shows - fetch 3 pages for more content"""
        api_key = self.get_tmdb_api_key()
        all_results = []
        
        try:
            # Fetch 3 pages to get ~60 items
            for page in range(1, 4):
                url = f"{self.tmdb_base_url}/trending/all/{time_window}"
                params = {
                    'api_key': api_key,
                    'page': page
                }
                
                response = requests.get(url, params=params, timeout=10)
                response.raise_for_status()
                
                data = response.json()
                
                for item in data.get('results', []):
                    # Skip person results
                    if item.get('media_type') == 'person':
                        continue
                    
                    media_type = item.get('media_type')
                    title = item.get('title') or item.get('name', '')
                    release_date = item.get('release_date') or item.get('first_air_date', '')
                    year = None
                    if release_date:
                        try:
                            year = int(release_date.split('-')[0])
                        except (ValueError, IndexError):
                            pass
                    
                    poster_path = item.get('poster_path')
                    poster_url = f"{self.tmdb_image_base_url}{poster_path}" if poster_path else None
                    
                    backdrop_path = item.get('backdrop_path')
                    backdrop_url = f"{self.tmdb_image_base_url}{backdrop_path}" if backdrop_path else None
                    
                    all_results.append({
                        'tmdb_id': item.get('id'),
                        'media_type': media_type,
                        'title': title,
                        'year': year,
                        'overview': item.get('overview', ''),
                        'poster_path': poster_url,
                        'backdrop_path': backdrop_url,
                        'vote_average': item.get('vote_average', 0),
                        'popularity': item.get('popularity', 0)
                    })
            
            # Check library status for all items
            all_results = self.check_library_status_batch(all_results)
            
            return all_results
            
        except Exception as e:
            logger.error(f"Error getting trending: {e}")
            return []
    
    def get_popular_movies(self, page: int = 1) -> List[Dict[str, Any]]:
        """Get popular movies - fetch 3 pages for more content"""
        api_key = self.get_tmdb_api_key()
        all_results = []
        
        try:
            # Fetch 3 pages to get ~60 items
            for current_page in range(1, 4):
                url = f"{self.tmdb_base_url}/movie/popular"
                params = {
                    'api_key': api_key,
                    'page': current_page
                }
                
                response = requests.get(url, params=params, timeout=10)
                response.raise_for_status()
                
                data = response.json()
                
                for item in data.get('results', []):
                    release_date = item.get('release_date', '')
                    year = None
                    if release_date:
                        try:
                            year = int(release_date.split('-')[0])
                        except (ValueError, IndexError):
                            pass
                    
                    poster_path = item.get('poster_path')
                    poster_url = f"{self.tmdb_image_base_url}{poster_path}" if poster_path else None
                    
                    backdrop_path = item.get('backdrop_path')
                    backdrop_url = f"{self.tmdb_image_base_url}{backdrop_path}" if backdrop_path else None
                    
                    all_results.append({
                        'tmdb_id': item.get('id'),
                        'media_type': 'movie',
                        'title': item.get('title', ''),
                        'year': year,
                        'overview': item.get('overview', ''),
                        'poster_path': poster_url,
                        'backdrop_path': backdrop_url,
                        'vote_average': item.get('vote_average', 0),
                        'popularity': item.get('popularity', 0)
                    })
            
            # Check library status for all items
            all_results = self.check_library_status_batch(all_results)
            
            return all_results
            
        except Exception as e:
            logger.error(f"Error getting popular movies: {e}")
            return []
    
    def get_popular_tv(self, page: int = 1) -> List[Dict[str, Any]]:
        """Get popular TV shows - fetch 3 pages for more content"""
        api_key = self.get_tmdb_api_key()
        all_results = []
        
        try:
            # Fetch 3 pages to get ~60 items
            for current_page in range(1, 4):
                url = f"{self.tmdb_base_url}/tv/popular"
                params = {
                    'api_key': api_key,
                    'page': current_page
                }
                
                response = requests.get(url, params=params, timeout=10)
                response.raise_for_status()
                
                data = response.json()
                
                for item in data.get('results', []):
                    first_air_date = item.get('first_air_date', '')
                    year = None
                    if first_air_date:
                        try:
                            year = int(first_air_date.split('-')[0])
                        except (ValueError, IndexError):
                            pass
                    
                    poster_path = item.get('poster_path')
                    poster_url = f"{self.tmdb_image_base_url}{poster_path}" if poster_path else None
                    
                    backdrop_path = item.get('backdrop_path')
                    backdrop_url = f"{self.tmdb_image_base_url}{backdrop_path}" if backdrop_path else None
                    
                    all_results.append({
                        'tmdb_id': item.get('id'),
                        'media_type': 'tv',
                        'title': item.get('name', ''),
                        'year': year,
                        'overview': item.get('overview', ''),
                        'poster_path': poster_url,
                        'backdrop_path': backdrop_url,
                        'vote_average': item.get('vote_average', 0),
                        'popularity': item.get('popularity', 0)
                    })
            
            # Check library status for all items
            all_results = self.check_library_status_batch(all_results)
            
            return all_results
            
        except Exception as e:
            logger.error(f"Error getting popular TV: {e}")
            return []
    
    def get_media_details(self, tmdb_id: int, media_type: str) -> Dict[str, Any]:
        """Get detailed information about a movie or TV show"""
        api_key = self.get_tmdb_api_key()
        
        try:
            endpoint = "movie" if media_type == "movie" else "tv"
            url = f"{self.tmdb_base_url}/{endpoint}/{tmdb_id}"
            params = {
                'api_key': api_key,
                'append_to_response': 'credits,videos'
            }
            
            response = requests.get(url, params=params, timeout=10)
            response.raise_for_status()
            
            data = response.json()
            
            # Build poster and backdrop URLs
            poster_path = data.get('poster_path')
            poster_url = f"{self.tmdb_image_base_url}{poster_path}" if poster_path else None
            
            backdrop_path = data.get('backdrop_path')
            backdrop_url = f"{self.tmdb_image_base_url}{backdrop_path}" if backdrop_path else None
            
            # Get year
            release_date = data.get('release_date') or data.get('first_air_date', '')
            year = None
            if release_date:
                try:
                    year = int(release_date.split('-')[0])
                except (ValueError, IndexError):
                    pass
            
            # Get trailer
            videos = data.get('videos', {}).get('results', [])
            trailer = None
            for video in videos:
                if video.get('type') == 'Trailer' and video.get('site') == 'YouTube':
                    trailer = f"https://www.youtube.com/watch?v={video.get('key')}"
                    break
            
            # Get cast
            cast = []
            credits = data.get('credits', {})
            for person in credits.get('cast', [])[:5]:  # Top 5 cast
                cast.append({
                    'name': person.get('name'),
                    'character': person.get('character'),
                    'profile_path': f"{self.tmdb_image_base_url}{person.get('profile_path')}" if person.get('profile_path') else None
                })
            
            # Get crew (director)
            director = None
            for person in credits.get('crew', []):
                if person.get('job') == 'Director':
                    director = person.get('name')
                    break
            
            result = {
                'tmdb_id': tmdb_id,
                'media_type': media_type,
                'title': data.get('title') or data.get('name', ''),
                'year': year,
                'overview': data.get('overview', ''),
                'poster_path': poster_url,
                'backdrop_path': backdrop_url,
                'vote_average': data.get('vote_average', 0),
                'vote_count': data.get('vote_count', 0),
                'popularity': data.get('popularity', 0),
                'genres': [g.get('name') for g in data.get('genres', [])],
                'runtime': data.get('runtime') or (data.get('episode_run_time', [None])[0] if data.get('episode_run_time') else None),
                'status': data.get('status'),
                'trailer': trailer,
                'cast': cast,
                'director': director
            }
            
            # TV-specific fields
            if media_type == 'tv':
                result['number_of_seasons'] = data.get('number_of_seasons')
                result['number_of_episodes'] = data.get('number_of_episodes')
                result['networks'] = [n.get('name') for n in data.get('networks', [])]
            
            return result
            
        except Exception as e:
            logger.error(f"Error getting media details: {e}")
            return {}
    
    def get_series_status_from_sonarr(self, tmdb_id: int, instance_name: str) -> Dict[str, Any]:
        """Get series status from Sonarr - missing episodes, available, etc."""
        try:
            # Check cooldown status (configurable cooldown period)
            cooldown_hours = self.get_cooldown_hours()
            cooldown_status = self.db.get_request_cooldown_status(tmdb_id, 'tv', 'sonarr', instance_name, cooldown_hours)
            already_requested_in_db = cooldown_status['last_requested_at'] is not None
            
            # Get Sonarr instance config
            app_config = self.db.get_app_config('sonarr')
            if not app_config or not app_config.get('instances'):
                return {'exists': False, 'previously_requested': already_requested_in_db}
            
            target_instance = None
            for instance in app_config['instances']:
                if instance.get('name') == instance_name:
                    target_instance = instance
                    break
            
            if not target_instance:
                return {'exists': False, 'previously_requested': already_requested_in_db}
            
            # Get series from Sonarr
            sonarr_url = target_instance.get('api_url', '') or target_instance.get('url', '')
            sonarr_api_key = target_instance.get('api_key', '')
            
            if not sonarr_url or not sonarr_api_key:
                return {'exists': False, 'previously_requested': already_requested_in_db}
            
            sonarr_url = sonarr_url.rstrip('/')
            
            # Search for series by TMDB ID
            headers = {'X-Api-Key': sonarr_api_key}
            response = requests.get(
                f"{sonarr_url}/api/v3/series",
                headers=headers,
                timeout=10
            )
            
            if response.status_code != 200:
                logger.error(f"Failed to get series from Sonarr: {response.status_code}")
                return {'exists': False, 'previously_requested': already_requested_in_db}
            
            series_list = response.json()
            
            logger.info(f"Searching for TMDB ID {tmdb_id} in {len(series_list)} series")
            
            # Find series with matching TMDB ID
            for series in series_list:
                series_tmdb = series.get('tmdbId')
                logger.debug(f"Checking series: {series.get('title')} - TMDB ID: {series_tmdb}")
                
                # Only check tmdbId field (tvdbId is TVDB, not TMDB)
                if series_tmdb == tmdb_id:
                    # Series exists in Sonarr
                    statistics = series.get('statistics', {})
                    
                    total_episodes = statistics.get('episodeCount', 0)
                    available_episodes = statistics.get('episodeFileCount', 0)
                    missing_episodes = total_episodes - available_episodes
                    
                    # Determine "previously_requested" status intelligently:
                    # - Only mark as "previously requested" if series was requested but has NO episodes yet
                    # - If there are missing episodes, DON'T mark as previously requested (could be new episodes)
                    # - This allows users to request new episodes that air after their initial request
                    
                    previously_requested = False
                    
                    if already_requested_in_db:
                        # Series was requested through Requestarr
                        if total_episodes > 0 and available_episodes == 0:
                            # No episodes downloaded yet - still waiting on initial request
                            previously_requested = True
                        elif missing_episodes > 0:
                            # Has missing episodes - could be new episodes that aired
                            # Don't mark as previously requested so user can request them
                            previously_requested = False
                        else:
                            # All episodes downloaded or no episodes to download
                            previously_requested = False
                    elif total_episodes > 0 and available_episodes == 0:
                        # Not in Requestarr DB but in Sonarr with no episodes = requested elsewhere
                        previously_requested = True
                    
                    logger.info(f"Found series in Sonarr: {series.get('title')} - {available_episodes}/{total_episodes} episodes, missing: {missing_episodes}, previously_requested: {previously_requested}, cooldown: {cooldown_status['in_cooldown']}")
                    
                    return {
                        'exists': True,
                        'monitored': series.get('monitored', False),
                        'total_episodes': total_episodes,
                        'available_episodes': available_episodes,
                        'missing_episodes': missing_episodes,
                        'previously_requested': previously_requested,
                        'cooldown_status': cooldown_status,
                        'seasons': series.get('seasons', [])
                    }
            
            logger.info(f"Series with TMDB ID {tmdb_id} not found in Sonarr")
            return {
                'exists': False,
                'previously_requested': already_requested_in_db,
                'cooldown_status': cooldown_status
            }
            
        except Exception as e:
            logger.error(f"Error getting series status from Sonarr: {e}")
            # Still check cooldown even if Sonarr check fails
            cooldown_hours = self.get_cooldown_hours()
            cooldown_status = self.db.get_request_cooldown_status(tmdb_id, 'tv', 'sonarr', instance_name, cooldown_hours)
            already_requested_in_db = cooldown_status['last_requested_at'] is not None
            return {
                'exists': False,
                'previously_requested': already_requested_in_db,
                'cooldown_status': cooldown_status
            }
    
    def check_seasons_in_sonarr(self, tmdb_id: int, instance_name: str) -> List[int]:
        """Check which seasons of a TV show are already in Sonarr"""
        status = self.get_series_status_from_sonarr(tmdb_id, instance_name)
        if status.get('exists'):
            seasons = status.get('seasons', [])
            return [s.get('seasonNumber') for s in seasons if s.get('seasonNumber') is not None]
        return []
    
    def get_movie_status_from_radarr(self, tmdb_id: int, instance_name: str) -> Dict[str, Any]:
        """Get movie status from Radarr - in library, previously requested, etc."""
        try:
            # Check cooldown status (configurable cooldown period)
            cooldown_hours = self.get_cooldown_hours()
            cooldown_status = self.db.get_request_cooldown_status(tmdb_id, 'movie', 'radarr', instance_name, cooldown_hours)
            already_requested_in_db = cooldown_status['last_requested_at'] is not None
            
            # Get Radarr instance config
            app_config = self.db.get_app_config('radarr')
            if not app_config or not app_config.get('instances'):
                return {'in_library': False, 'previously_requested': already_requested_in_db}
            
            target_instance = None
            for instance in app_config['instances']:
                if instance.get('name') == instance_name:
                    target_instance = instance
                    break
            
            if not target_instance:
                return {'in_library': False, 'previously_requested': already_requested_in_db}
            
            # Get movie from Radarr
            radarr_url = target_instance.get('api_url', '') or target_instance.get('url', '')
            radarr_api_key = target_instance.get('api_key', '')
            
            if not radarr_url or not radarr_api_key:
                return {'in_library': False, 'previously_requested': already_requested_in_db}
            
            radarr_url = radarr_url.rstrip('/')
            
            # Search for movie by TMDB ID
            headers = {'X-Api-Key': radarr_api_key}
            response = requests.get(
                f"{radarr_url}/api/v3/movie",
                headers=headers,
                timeout=10
            )
            
            if response.status_code != 200:
                logger.error(f"Failed to get movies from Radarr: {response.status_code}")
                return {'in_library': False, 'previously_requested': already_requested_in_db}
            
            movies_list = response.json()
            
            logger.info(f"Searching for TMDB ID {tmdb_id} in {len(movies_list)} movies")
            
            for movie in movies_list:
                movie_tmdb = movie.get('tmdbId')
                if movie_tmdb == tmdb_id:
                    has_file = movie.get('hasFile', False)
                    logger.info(f"Found movie in Radarr: {movie.get('title')} - Has file: {has_file}")
                    
                    # Check if previously requested
                    # Priority: Requestarr DB > Radarr status
                    previously_requested = already_requested_in_db or (not has_file)
                    
                    return {
                        'in_library': has_file,
                        'previously_requested': previously_requested,
                        'monitored': movie.get('monitored', False),
                        'cooldown_status': cooldown_status
                    }
            
            logger.info(f"Movie with TMDB ID {tmdb_id} not found in Radarr")
            return {
                'in_library': False,
                'previously_requested': already_requested_in_db,
                'cooldown_status': cooldown_status
            }
            
        except Exception as e:
            logger.error(f"Error getting movie status from Radarr: {e}")
            # Still check cooldown even if Radarr check fails
            cooldown_hours = self.get_cooldown_hours()
            cooldown_status = self.db.get_request_cooldown_status(tmdb_id, 'movie', 'radarr', instance_name, cooldown_hours)
            already_requested_in_db = cooldown_status['last_requested_at'] is not None
            return {
                'in_library': False,
                'previously_requested': already_requested_in_db,
                'cooldown_status': cooldown_status
            }
    
    def check_library_status_batch(self, items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Check library status for a batch of media items.
        Adds status flags to each item:
        - 'in_library': Complete (all episodes for TV, has file for movies)
        - 'partial': TV shows with some but not all episodes
        - 'in_cooldown': Recently requested (within 12 hours)
        """
        try:
            # Get enabled instances
            instances = self.get_enabled_instances()
            
            if not instances['radarr'] and not instances['sonarr']:
                # No instances configured, mark all as not in library
                for item in items:
                    item['in_library'] = False
                    item['partial'] = False
                    item['in_cooldown'] = False
                return items
            
            # Get all movies from all Radarr instances
            radarr_tmdb_ids = set()
            for instance in instances['radarr']:
                try:
                    headers = {'X-Api-Key': instance['api_key']}
                    response = requests.get(
                        f"{instance['url'].rstrip('/')}/api/v3/movie",
                        headers=headers,
                        timeout=10
                    )
                    if response.status_code == 200:
                        movies = response.json()
                        for movie in movies:
                            if movie.get('hasFile', False):  # Only count movies with files
                                radarr_tmdb_ids.add(movie.get('tmdbId'))
                except Exception as e:
                    logger.error(f"Error checking Radarr instance {instance['name']}: {e}")
            
            # Get all series from all Sonarr instances
            sonarr_tmdb_ids = set()
            sonarr_partial_tmdb_ids = set()
            for instance in instances['sonarr']:
                try:
                    headers = {'X-Api-Key': instance['api_key']}
                    response = requests.get(
                        f"{instance['url'].rstrip('/')}/api/v3/series",
                        headers=headers,
                        timeout=10
                    )
                    if response.status_code == 200:
                        series_list = response.json()
                        for series in series_list:
                            # Check if series has all episodes
                            statistics = series.get('statistics', {})
                            total_episodes = statistics.get('episodeCount', 0)
                            available_episodes = statistics.get('episodeFileCount', 0)
                            
                            tmdb_id = series.get('tmdbId')
                            # Mark as in_library if all episodes are available
                            if total_episodes > 0 and available_episodes == total_episodes:
                                sonarr_tmdb_ids.add(tmdb_id)
                            # Mark as partial if some episodes are available
                            elif available_episodes > 0 and available_episodes < total_episodes:
                                sonarr_partial_tmdb_ids.add(tmdb_id)
                except Exception as e:
                    logger.error(f"Error checking Sonarr instance {instance['name']}: {e}")
            
            # Mark each item with status
            for item in items:
                tmdb_id = item.get('tmdb_id')
                media_type = item.get('media_type')
                
                # Check cooldown status across ALL instances (not just first one)
                item['in_cooldown'] = False
                cooldown_hours = self.get_cooldown_hours()
                if instances['radarr'] and media_type == 'movie':
                    # Check ALL Radarr instances for cooldown
                    for instance in instances['radarr']:
                        instance_name = instance['name']
                        cooldown_status = self.db.get_request_cooldown_status(tmdb_id, media_type, 'radarr', instance_name, cooldown_hours)
                        if cooldown_status['in_cooldown']:
                            item['in_cooldown'] = True
                            break  # Found cooldown, no need to check other instances
                elif instances['sonarr'] and media_type == 'tv':
                    # Check ALL Sonarr instances for cooldown
                    for instance in instances['sonarr']:
                        instance_name = instance['name']
                        cooldown_status = self.db.get_request_cooldown_status(tmdb_id, media_type, 'sonarr', instance_name, cooldown_hours)
                        if cooldown_status['in_cooldown']:
                            item['in_cooldown'] = True
                            break  # Found cooldown, no need to check other instances
                
                # Set library status
                if media_type == 'movie':
                    item['in_library'] = tmdb_id in radarr_tmdb_ids
                    item['partial'] = False
                elif media_type == 'tv':
                    item['in_library'] = tmdb_id in sonarr_tmdb_ids
                    item['partial'] = tmdb_id in sonarr_partial_tmdb_ids
                else:
                    item['in_library'] = False
                    item['partial'] = False
            
            return items
            
        except Exception as e:
            logger.error(f"Error checking library status batch: {e}")
            # On error, mark all as not in library
            for item in items:
                item['in_library'] = False
                item['partial'] = False
                item['in_cooldown'] = False
            return items
    
    def get_quality_profiles(self, app_type: str, instance_name: str) -> List[Dict[str, Any]]:
        """Get quality profiles from Radarr or Sonarr instance"""
        try:
            # Get instance config
            app_config = self.db.get_app_config(app_type)
            if not app_config or not app_config.get('instances'):
                return []
            
            target_instance = None
            for instance in app_config['instances']:
                if instance.get('name') == instance_name:
                    target_instance = instance
                    break
            
            if not target_instance:
                return []
            
            # Get URL and API key
            url = target_instance.get('api_url', '') or target_instance.get('url', '')
            api_key = target_instance.get('api_key', '')
            
            if not url or not api_key:
                return []
            
            url = url.rstrip('/')
            
            # Fetch quality profiles
            headers = {'X-Api-Key': api_key}
            response = requests.get(
                f"{url}/api/v3/qualityprofile",
                headers=headers,
                timeout=10
            )
            
            if response.status_code != 200:
                logger.error(f"Failed to get quality profiles: {response.status_code}")
                return []
            
            profiles = response.json()
            
            # Return simplified profile data
            return [
                {
                    'id': profile.get('id'),
                    'name': profile.get('name')
                }
                for profile in profiles
            ]
            
        except Exception as e:
            logger.error(f"Error getting quality profiles from {app_type}: {e}")
            return []
    
    def get_default_instances(self) -> Dict[str, str]:
        """Get default Sonarr and Radarr instances from database"""
        try:
            sonarr_default = self.db.get_setting('requestarr', 'default_sonarr_instance')
            radarr_default = self.db.get_setting('requestarr', 'default_radarr_instance')
            
            # If no defaults set, use first available instance
            if not sonarr_default:
                enabled = self.get_enabled_instances()
                if enabled['sonarr']:
                    sonarr_default = enabled['sonarr'][0]['name']
                    self.db.set_setting('requestarr', 'default_sonarr_instance', sonarr_default)
            
            if not radarr_default:
                enabled = self.get_enabled_instances()
                if enabled['radarr']:
                    radarr_default = enabled['radarr'][0]['name']
                    self.db.set_setting('requestarr', 'default_radarr_instance', radarr_default)
            
            return {
                'sonarr_instance': sonarr_default or '',
                'radarr_instance': radarr_default or ''
            }
        except Exception as e:
            logger.error(f"Error getting default instances: {e}")
            return {'sonarr_instance': '', 'radarr_instance': ''}
    
    def set_default_instances(self, sonarr_instance: str = None, radarr_instance: str = None):
        """Set default Sonarr and Radarr instances in database"""
        try:
            if sonarr_instance is not None:
                self.db.set_setting('requestarr', 'default_sonarr_instance', sonarr_instance)
            if radarr_instance is not None:
                self.db.set_setting('requestarr', 'default_radarr_instance', radarr_instance)
        except Exception as e:
            logger.error(f"Error setting default instances: {e}")
            raise
    
    def get_cooldown_hours(self) -> int:
        """Get cooldown period in hours from database (default: 168 hours / 7 days)"""
        try:
            requestarr_config = self.db.get_app_config('requestarr')
            if requestarr_config and 'cooldown_hours' in requestarr_config:
                return int(requestarr_config['cooldown_hours'])
            return 168  # Default to 7 days
        except Exception as e:
            logger.error(f"Error getting cooldown hours: {e}")
            return 168
    
    def set_cooldown_hours(self, hours: int):
        """Set cooldown period in hours in database"""
        try:
            # Get existing config or create new one
            requestarr_config = self.db.get_app_config('requestarr') or {}
            requestarr_config['cooldown_hours'] = hours
            self.db.save_app_config('requestarr', requestarr_config)
            logger.info(f"Set cooldown hours to {hours}")
        except Exception as e:
            logger.error(f"Error setting cooldown hours: {e}")
            raise
    
    def reset_cooldowns(self) -> int:
        """Reset all cooldowns with 25+ hours remaining. Returns count of reset items."""
        try:
            count = self.db.reset_cooldowns_over_threshold(25)
            logger.info(f"Reset {count} cooldowns with 25+ hours remaining")
            return count
        except Exception as e:
            logger.error(f"Error resetting cooldowns: {e}")
            raise
    
    def search_media_with_availability(self, query: str, app_type: str, instance_name: str) -> List[Dict[str, Any]]:
        """Search for media using TMDB API and check availability in specified app instance"""
        api_key = self.get_tmdb_api_key()
        
        # Determine search type based on app
        media_type = "movie" if app_type == "radarr" else "tv" if app_type == "sonarr" else "multi"
        
        try:
            # Use search to get movies or TV shows
            url = f"{self.tmdb_base_url}/search/{media_type}"
            params = {
                'api_key': api_key,
                'query': query,
                'include_adult': False
            }
            
            response = requests.get(url, params=params, timeout=10)
            response.raise_for_status()
            
            data = response.json()
            results = []
            
            # Get instance configuration for availability checking
            app_config = self.db.get_app_config(app_type)
            target_instance = None
            if app_config and app_config.get('instances'):
                for instance in app_config['instances']:
                    if instance.get('name') == instance_name:
                        target_instance = instance
                        break
            
            for item in data.get('results', []):
                # Skip person results in multi search
                if item.get('media_type') == 'person':
                    continue
                
                # Determine media type
                item_type = item.get('media_type')
                if not item_type:
                    # For single-type searches
                    item_type = 'movie' if media_type == 'movie' else 'tv'
                
                # Skip if media type doesn't match app type
                if app_type == "radarr" and item_type != "movie":
                    continue
                if app_type == "sonarr" and item_type != "tv":
                    continue
                
                # Get title and year
                title = item.get('title') or item.get('name', '')
                release_date = item.get('release_date') or item.get('first_air_date', '')
                year = None
                if release_date:
                    try:
                        year = int(release_date.split('-')[0])
                    except (ValueError, IndexError):
                        pass
                
                # Build poster URL
                poster_path = item.get('poster_path')
                poster_url = f"{self.tmdb_image_base_url}{poster_path}" if poster_path else None
                
                # Build backdrop URL
                backdrop_path = item.get('backdrop_path')
                backdrop_url = f"{self.tmdb_image_base_url}{backdrop_path}" if backdrop_path else None
                
                # Check availability status
                tmdb_id = item.get('id')
                availability_status = self._get_availability_status(tmdb_id, item_type, target_instance, app_type)
                
                results.append({
                    'tmdb_id': tmdb_id,
                    'media_type': item_type,
                    'title': title,
                    'year': year,
                    'overview': item.get('overview', ''),
                    'poster_path': poster_url,
                    'backdrop_path': backdrop_url,
                    'vote_average': item.get('vote_average', 0),
                    'popularity': item.get('popularity', 0),
                    'availability': availability_status
                })
            
            # Sort by popularity
            results.sort(key=lambda x: x['popularity'], reverse=True)
            top_results = results[:20]  # Limit to top 20 results
            
            # Check library status for all results
            top_results = self.check_library_status_batch(top_results)
            
            return top_results
            
        except Exception as e:
            logger.error(f"Error searching TMDB: {e}")
            return []

    def search_media_with_availability_stream(self, query: str, app_type: str, instance_name: str):
        """Stream search results as they become available"""
        api_key = self.get_tmdb_api_key()
        
        # Determine search type based on app
        media_type = "movie" if app_type == "radarr" else "tv" if app_type == "sonarr" else "multi"
        
        try:
            # Use search to get movies or TV shows
            url = f"{self.tmdb_base_url}/search/{media_type}"
            params = {
                'api_key': api_key,
                'query': query,
                'include_adult': False
            }
            
            response = requests.get(url, params=params, timeout=10)
            response.raise_for_status()
            
            data = response.json()
            
            # Get instance configuration for availability checking
            app_config = self.db.get_app_config(app_type)
            target_instance = None
            if app_config and app_config.get('instances'):
                for instance in app_config['instances']:
                    if instance.get('name') == instance_name:
                        target_instance = instance
                        break
            
            # Process items and yield results as they become available
            processed_items = []
            
            for item in data.get('results', []):
                # Skip person results in multi search
                if item.get('media_type') == 'person':
                    continue
                
                # Determine media type
                item_type = item.get('media_type')
                if not item_type:
                    # For single-type searches
                    item_type = 'movie' if media_type == 'movie' else 'tv'
                
                # Skip if media type doesn't match app type
                if app_type == "radarr" and item_type != "movie":
                    continue
                if app_type == "sonarr" and item_type != "tv":
                    continue
                
                # Get title and year
                title = item.get('title') or item.get('name', '')
                release_date = item.get('release_date') or item.get('first_air_date', '')
                year = None
                if release_date:
                    try:
                        year = int(release_date.split('-')[0])
                    except (ValueError, IndexError):
                        pass
                
                # Build poster URL
                poster_path = item.get('poster_path')
                poster_url = f"{self.tmdb_image_base_url}{poster_path}" if poster_path else None
                
                # Build backdrop URL
                backdrop_path = item.get('backdrop_path')
                backdrop_url = f"{self.tmdb_image_base_url}{backdrop_path}" if backdrop_path else None
                
                # Create basic result first (without availability check)
                basic_result = {
                    'tmdb_id': item.get('id'),
                    'media_type': item_type,
                    'title': title,
                    'year': year,
                    'overview': item.get('overview', ''),
                    'poster_path': poster_url,
                    'backdrop_path': backdrop_url,
                    'vote_average': item.get('vote_average', 0),
                    'popularity': item.get('popularity', 0),
                    'availability': {
                        'status': 'checking',
                        'message': 'Checking availability...',
                        'in_app': False,
                        'already_requested': False
                    }
                }
                
                processed_items.append((basic_result, item.get('id'), item_type))
            
            # Sort by popularity before streaming
            processed_items.sort(key=lambda x: x[0]['popularity'], reverse=True)
            processed_items = processed_items[:20]  # Limit to top 20 results
            
            # Yield basic results first
            for basic_result, tmdb_id, item_type in processed_items:
                yield basic_result
            
            # Now check availability for each item and yield updates
            for basic_result, tmdb_id, item_type in processed_items:
                try:
                    availability_status = self._get_availability_status(tmdb_id, item_type, target_instance, app_type)
                    
                    # Yield updated result with availability
                    updated_result = basic_result.copy()
                    updated_result['availability'] = availability_status
                    updated_result['_update'] = True  # Flag to indicate this is an update
                    
                    yield updated_result
                    
                except Exception as e:
                    logger.error(f"Error checking availability for {tmdb_id}: {e}")
                    # Yield error status
                    error_result = basic_result.copy()
                    error_result['availability'] = {
                        'status': 'error',
                        'message': 'Error checking availability',
                        'in_app': False,
                        'already_requested': False
                    }
                    error_result['_update'] = True
                    yield error_result
            
        except Exception as e:
            logger.error(f"Error in streaming search: {e}")
            yield {'error': str(e)}
    
    def _get_availability_status(self, tmdb_id: int, media_type: str, instance: Dict[str, str], app_type: str) -> Dict[str, Any]:
        """Get availability status for media item"""
        if not instance:
            return {
                'status': 'error',
                'message': 'Instance not found',
                'in_app': False,
                'already_requested': False
            }
        
        # Check if already requested first (this doesn't require API connection)
        try:
            already_requested = self.db.is_already_requested(tmdb_id, media_type, app_type, instance.get('name'))
            if already_requested:
                return {
                    'status': 'requested',
                    'message': 'Previously requested',
                    'in_app': False,
                    'already_requested': True
                }
        except Exception as e:
            logger.error(f"Error checking request history: {e}")
        
        # Check if instance is properly configured
        url = instance.get('api_url', '') or instance.get('url', '')
        if not url or not instance.get('api_key'):
            return {
                'status': 'available_to_request',
                'message': 'Ready to request (instance needs configuration)',
                'in_app': False,
                'already_requested': False
            }
        
        try:
            # Check if exists in app
            exists_result = self._check_media_exists(tmdb_id, media_type, instance, app_type)
            
            if exists_result['exists']:
                # Handle Sonarr series with episode completion logic
                if app_type == 'sonarr' and 'episode_file_count' in exists_result:
                    episode_file_count = exists_result['episode_file_count']
                    episode_count = exists_result['episode_count']
                    
                    if episode_count == 0:
                        # Series exists but no episodes expected yet
                        return {
                            'status': 'available',
                            'message': f'Series in library (no episodes available yet)',
                            'in_app': True,
                            'already_requested': False,
                            'episode_stats': f'{episode_file_count}/{episode_count}'
                        }
                    elif episode_file_count >= episode_count:
                        # All episodes downloaded
                        return {
                            'status': 'available',
                            'message': f'Complete series in library ({episode_file_count}/{episode_count})',
                            'in_app': True,
                            'already_requested': False,
                            'episode_stats': f'{episode_file_count}/{episode_count}'
                        }
                    else:
                        # Missing episodes - allow requesting missing ones
                        missing_count = episode_count - episode_file_count
                        return {
                            'status': 'available_to_request_missing',
                            'message': f'Request missing episodes ({episode_file_count}/{episode_count}, {missing_count} missing)',
                            'in_app': True,
                            'already_requested': False,
                            'episode_stats': f'{episode_file_count}/{episode_count}',
                            'missing_episodes': missing_count,
                            'series_id': exists_result.get('series_id')
                        }
                else:
                    # Radarr or other apps - simple exists check
                    return {
                        'status': 'available',
                        'message': 'Already in library',
                        'in_app': True,
                        'already_requested': False
                    }
            else:
                return {
                    'status': 'available_to_request',
                    'message': 'Available to request',
                    'in_app': False,
                    'already_requested': False
                }
                
        except Exception as e:
            logger.error(f"Error checking availability in {app_type}: {e}")
            # If we can't check the app, still allow requesting
            return {
                'status': 'available_to_request',
                'message': 'Available to request (could not verify library)',
                'in_app': False,
                'already_requested': False
            }
    
    def get_enabled_instances(self) -> Dict[str, List[Dict[str, str]]]:
        """Get enabled and properly configured Sonarr and Radarr instances"""
        instances = {'sonarr': [], 'radarr': []}
        
        try:
            # Get Sonarr instances
            sonarr_config = self.db.get_app_config('sonarr')
            if sonarr_config and sonarr_config.get('instances'):
                for instance in sonarr_config['instances']:
                    # Database stores URL as 'api_url', map it to 'url' for consistency
                    url = instance.get('api_url', '') or instance.get('url', '')
                    api_key = instance.get('api_key', '')
                    
                    # Only include instances that are enabled AND have proper configuration
                    if (instance.get('enabled', False) and 
                        url.strip() and 
                        api_key.strip()):
                        instances['sonarr'].append({
                            'name': instance.get('name', 'Default'),
                            'url': url,
                            'api_key': api_key
                        })
            
            # Get Radarr instances
            radarr_config = self.db.get_app_config('radarr')
            if radarr_config and radarr_config.get('instances'):
                for instance in radarr_config['instances']:
                    # Database stores URL as 'api_url', map it to 'url' for consistency
                    url = instance.get('api_url', '') or instance.get('url', '')
                    api_key = instance.get('api_key', '')
                    
                    # Only include instances that are enabled AND have proper configuration
                    if (instance.get('enabled', False) and 
                        url.strip() and 
                        api_key.strip()):
                        instances['radarr'].append({
                            'name': instance.get('name', 'Default'),
                            'url': url,
                            'api_key': api_key
                        })
            
            return instances
            
        except Exception as e:
            logger.error(f"Error getting enabled instances: {e}")
            return {'sonarr': [], 'radarr': []}
    
    def request_media(self, tmdb_id: int, media_type: str, title: str, year: int,
                     overview: str, poster_path: str, backdrop_path: str,
                     app_type: str, instance_name: str, quality_profile_id: int = None) -> Dict[str, Any]:
        """Request media through the specified app instance"""
        try:
            # Get instance configuration first
            app_config = self.db.get_app_config(app_type)
            if not app_config or not app_config.get('instances'):
                return {
                    'success': False,
                    'message': f'No {app_type.title()} instances configured',
                    'status': 'no_instances'
                }
            
            # Find the specific instance
            target_instance = None
            for instance in app_config['instances']:
                if instance.get('name') == instance_name:
                    target_instance = instance
                    break
            
            if not target_instance:
                return {
                    'success': False,
                    'message': f'{app_type.title()} instance "{instance_name}" not found',
                    'status': 'instance_not_found'
                }
            
            # Check if media exists and get detailed info
            exists_result = self._check_media_exists(tmdb_id, media_type, target_instance, app_type)
            
            # Check configurable cooldown period
            cooldown_hours = self.get_cooldown_hours()
            cooldown_status = self.db.get_request_cooldown_status(tmdb_id, media_type, app_type, instance_name, cooldown_hours)
            
            if cooldown_status['in_cooldown']:
                hours_remaining = cooldown_status['hours_remaining']
                
                # Format time display based on duration
                if hours_remaining <= 24:
                    # 24 hours or less: show as hours and minutes (12h 23m)
                    hours = int(hours_remaining)
                    minutes = int((hours_remaining - hours) * 60)
                    time_msg = f"{hours}h {minutes}m" if hours > 0 else f"{minutes}m"
                else:
                    # More than 24 hours: show as days, hours, minutes (1d 1h 5m)
                    days = int(hours_remaining / 24)
                    remaining_hours = hours_remaining - (days * 24)
                    hours = int(remaining_hours)
                    minutes = int((remaining_hours - hours) * 60)
                    time_msg = f"{days}d {hours}h {minutes}m"
                
                return {
                    'success': False,
                    'message': f'{title} was recently requested. Please wait {time_msg} before requesting again',
                    'status': 'in_cooldown',
                    'hours_remaining': hours_remaining
                }
            
            if exists_result.get('exists'):
                if app_type == 'sonarr' and 'series_id' in exists_result:
                    # Series exists in Sonarr - check if we should request missing episodes
                    episode_file_count = exists_result.get('episode_file_count', 0)
                    episode_count = exists_result.get('episode_count', 0)
                    
                    if episode_file_count < episode_count and episode_count > 0:
                        # Request missing episodes for existing series
                        missing_result = self._request_missing_episodes(exists_result['series_id'], target_instance)
                        
                        if missing_result['success']:
                            # Save request to database
                            self.db.add_request(
                                tmdb_id, media_type, title, year, overview, 
                                poster_path, backdrop_path, app_type, instance_name
                            )
                            
                            missing_count = episode_count - episode_file_count
                            return {
                                'success': True,
                                'message': f'Search initiated for {missing_count} missing episodes of {title}',
                                'status': 'requested'
                            }
                        else:
                            return {
                                'success': False,
                                'message': missing_result['message'],
                                'status': 'request_failed'
                            }
                    else:
                        # Series is complete or no episodes expected
                        return {
                            'success': False,
                            'message': f'{title} is already complete in your library',
                            'status': 'already_complete'
                        }
                elif app_type == 'radarr':
                    # Movie exists in Radarr - check if it has file
                    has_file = exists_result.get('has_file', False)
                    if has_file:
                        # Movie is already downloaded
                        return {
                            'success': False,
                            'message': f'{title} already exists in {app_type.title()} - {instance_name}',
                            'status': 'already_exists'
                        }
                    else:
                        # Movie is monitored but not downloaded yet - trigger search
                        movie_data = exists_result.get('movie_data', {})
                        movie_id = movie_data.get('id')
                        
                        if movie_id:
                            # Trigger movie search
                            try:
                                url = (target_instance.get('api_url', '') or target_instance.get('url', '')).rstrip('/')
                                api_key = target_instance.get('api_key', '')
                                
                                search_response = requests.post(
                                    f"{url}/api/v3/command",
                                    headers={'X-Api-Key': api_key},
                                    json={'name': 'MoviesSearch', 'movieIds': [movie_id]},
                                    timeout=10
                                )
                                search_response.raise_for_status()
                                
                                # Save request to database
                                self.db.add_request(
                                    tmdb_id, media_type, title, year, overview, 
                                    poster_path, backdrop_path, app_type, instance_name
                                )
                                
                                return {
                                    'success': True,
                                    'message': f'Search initiated for {title} (already in Radarr, triggering download)',
                                    'status': 'requested'
                                }
                            except Exception as e:
                                logger.error(f"Error triggering movie search: {e}")
                                return {
                                    'success': False,
                                    'message': f'{title} is in Radarr but search failed: {str(e)}',
                                    'status': 'request_failed'
                                }
                        else:
                            return {
                                'success': False,
                                'message': f'{title} already exists in {app_type.title()} - {instance_name}',
                                'status': 'already_exists'
                            }
                else:
                    # Media exists in app - can't add again
                    return {
                        'success': False,
                        'message': f'{title} already exists in {app_type.title()} - {instance_name}',
                        'status': 'already_exists'
                    }
            else:
                # Add new media to the app
                add_result = self._add_media_to_app(tmdb_id, media_type, target_instance, app_type, quality_profile_id)
                
                if add_result['success']:
                    # Save request to database
                    self.db.add_request(
                        tmdb_id, media_type, title, year, overview, 
                        poster_path, backdrop_path, app_type, instance_name
                    )
                    
                    return {
                        'success': True,
                        'message': f'{title} successfully requested to {app_type.title()} - {instance_name}',
                        'status': 'requested'
                    }
                else:
                    return {
                        'success': False,
                        'message': add_result['message'],
                        'status': 'request_failed'
                    }
                
        except Exception as e:
            logger.error(f"Error requesting media: {e}")
            return {
                'success': False,
                'message': f'Error requesting {title}: {str(e)}',
                'status': 'error'
            }
    
    def _check_media_exists(self, tmdb_id: int, media_type: str, instance: Dict[str, str], app_type: str) -> Dict[str, Any]:
        """Check if media already exists in the app instance"""
        try:
            # Database stores URL as 'api_url', map it to 'url' for consistency
            url = (instance.get('api_url', '') or instance.get('url', '')).rstrip('/')
            api_key = instance.get('api_key', '')
            
            # If no URL or API key, we can't check
            if not url or not api_key:
                logger.debug(f"Instance {instance.get('name')} not configured with URL/API key")
                return {'exists': False}
            
            if app_type == 'radarr':
                # Search for movie by TMDB ID
                response = requests.get(
                    f"{url}/api/v3/movie",
                    headers={'X-Api-Key': api_key},
                    params={'tmdbId': tmdb_id},
                    timeout=10
                )
                response.raise_for_status()
                movies = response.json()
                
                # Check if movie exists AND has file
                if len(movies) > 0:
                    movie = movies[0]
                    has_file = movie.get('hasFile', False)
                    return {
                        'exists': True,
                        'has_file': has_file,
                        'movie_data': movie
                    }
                
                return {'exists': False}
                
            elif app_type == 'sonarr':
                # Search for series
                response = requests.get(
                    f"{url}/api/v3/series",
                    headers={'X-Api-Key': api_key},
                    timeout=10
                )
                response.raise_for_status()
                series_list = response.json()
                
                # Check if any series has matching TMDB ID
                for series in series_list:
                    if series.get('tmdbId') == tmdb_id:
                        # Get episode statistics from the statistics object
                        series_id = series.get('id')
                        statistics = series.get('statistics', {})
                        episode_file_count = statistics.get('episodeFileCount', 0)
                        episode_count = statistics.get('episodeCount', 0)
                        
                        return {
                            'exists': True,
                            'series_id': series_id,
                            'episode_file_count': episode_file_count,
                            'episode_count': episode_count,
                            'series_data': series
                        }
                
                return {'exists': False}
            
            return {'exists': False}
            
        except requests.exceptions.ConnectionError:
            logger.debug(f"Could not connect to {app_type} instance at {url}")
            return {'exists': False}
        except requests.exceptions.Timeout:
            logger.debug(f"Timeout connecting to {app_type} instance at {url}")
            return {'exists': False}
        except requests.exceptions.HTTPError as e:
            if e.response.status_code == 401:
                logger.debug(f"Authentication failed for {app_type} instance")
            elif e.response.status_code == 404:
                logger.debug(f"API endpoint not found for {app_type} instance")
            else:
                logger.debug(f"HTTP error checking {app_type}: {e}")
            return {'exists': False}
        except Exception as e:
            logger.debug(f"Error checking if media exists in {app_type}: {e}")
            return {'exists': False}
    
    def _request_missing_episodes(self, series_id: int, instance: Dict[str, str]) -> Dict[str, Any]:
        """Request missing episodes for an existing series in Sonarr"""
        try:
            # Database stores URL as 'api_url', map it to 'url' for consistency
            url = (instance.get('api_url', '') or instance.get('url', '')).rstrip('/')
            api_key = instance.get('api_key', '')
            
            if not url or not api_key:
                return {
                    'success': False,
                    'message': 'Instance not configured with URL/API key'
                }
            
            # Trigger a series search for missing episodes
            response = requests.post(
                f"{url}/api/v3/command",
                headers={'X-Api-Key': api_key, 'Content-Type': 'application/json'},
                json={
                    'name': 'SeriesSearch',
                    'seriesId': series_id
                },
                timeout=10
            )
            response.raise_for_status()
            
            return {
                'success': True,
                'message': 'Missing episodes search initiated'
            }
            
        except Exception as e:
            logger.error(f"Error requesting missing episodes: {e}")
            return {
                'success': False,
                'message': f'Error requesting missing episodes: {str(e)}'
            }
    
    def _add_media_to_app(self, tmdb_id: int, media_type: str, instance: Dict[str, str], app_type: str, quality_profile_id: int = None) -> Dict[str, Any]:
        """Add media to the app instance"""
        try:
            # Database stores URL as 'api_url', map it to 'url' for consistency
            url = (instance.get('api_url', '') or instance.get('url', '')).rstrip('/')
            api_key = instance.get('api_key', '')
            
            if not url or not api_key:
                return {
                    'success': False,
                    'message': 'Instance not configured with URL/API key'
                }
            
            if app_type == 'radarr' and media_type == 'movie':
                return self._add_movie_to_radarr(tmdb_id, url, api_key, quality_profile_id)
            elif app_type == 'sonarr' and media_type == 'tv':
                return self._add_series_to_sonarr(tmdb_id, url, api_key, quality_profile_id)
            else:
                return {
                    'success': False,
                    'message': f'Invalid combination: {media_type} to {app_type}'
                }
                
        except Exception as e:
            logger.error(f"Error adding media to app: {e}")
            return {
                'success': False,
                'message': f'Error adding media: {str(e)}'
            }
    
    def _add_movie_to_radarr(self, tmdb_id: int, url: str, api_key: str, quality_profile_id: int = None) -> Dict[str, Any]:
        """Add movie to Radarr"""
        try:
            # First, get movie details from Radarr's lookup
            lookup_response = requests.get(
                f"{url}/api/v3/movie/lookup",
                headers={'X-Api-Key': api_key},
                params={'term': f'tmdb:{tmdb_id}'},
                timeout=10
            )
            lookup_response.raise_for_status()
            lookup_results = lookup_response.json()
            
            if not lookup_results:
                return {
                    'success': False,
                    'message': 'Movie not found in Radarr lookup'
                }
            
            movie_data = lookup_results[0]
            
            # Get root folders
            root_folders_response = requests.get(
                f"{url}/api/v3/rootfolder",
                headers={'X-Api-Key': api_key},
                timeout=10
            )
            root_folders_response.raise_for_status()
            root_folders = root_folders_response.json()
            
            if not root_folders:
                return {
                    'success': False,
                    'message': 'No root folders configured in Radarr'
                }
            
            # Get quality profiles
            profiles_response = requests.get(
                f"{url}/api/v3/qualityprofile",
                headers={'X-Api-Key': api_key},
                timeout=10
            )
            profiles_response.raise_for_status()
            profiles = profiles_response.json()
            
            if not profiles:
                return {
                    'success': False,
                    'message': 'No quality profiles configured in Radarr'
                }
            
            # Use provided quality profile ID or default to first one
            selected_profile_id = quality_profile_id if quality_profile_id else profiles[0]['id']
            
            # Prepare movie data for adding
            add_data = {
                'title': movie_data['title'],
                'tmdbId': movie_data['tmdbId'],
                'year': movie_data['year'],
                'rootFolderPath': root_folders[0]['path'],
                'qualityProfileId': selected_profile_id,
                'monitored': True,
                'addOptions': {
                    'searchForMovie': True
                }
            }
            
            # Add additional fields from lookup
            for field in ['imdbId', 'overview', 'images', 'genres', 'runtime']:
                if field in movie_data:
                    add_data[field] = movie_data[field]
            
            # Add the movie
            add_response = requests.post(
                f"{url}/api/v3/movie",
                headers={'X-Api-Key': api_key, 'Content-Type': 'application/json'},
                json=add_data,
                timeout=10
            )
            add_response.raise_for_status()
            
            return {
                'success': True,
                'message': 'Movie successfully added to Radarr'
            }
            
        except Exception as e:
            logger.error(f"Error adding movie to Radarr: {e}")
            return {
                'success': False,
                'message': f'Error adding movie to Radarr: {str(e)}'
            }
    
    def _add_series_to_sonarr(self, tmdb_id: int, url: str, api_key: str, quality_profile_id: int = None) -> Dict[str, Any]:
        """Add series to Sonarr"""
        try:
            # First, get series details from Sonarr's lookup
            lookup_response = requests.get(
                f"{url}/api/v3/series/lookup",
                headers={'X-Api-Key': api_key},
                params={'term': f'tmdb:{tmdb_id}'},
                timeout=10
            )
            lookup_response.raise_for_status()
            lookup_results = lookup_response.json()
            
            if not lookup_results:
                return {
                    'success': False,
                    'message': 'Series not found in Sonarr lookup'
                }
            
            series_data = lookup_results[0]
            
            # Get root folders
            root_folders_response = requests.get(
                f"{url}/api/v3/rootfolder",
                headers={'X-Api-Key': api_key},
                timeout=10
            )
            root_folders_response.raise_for_status()
            root_folders = root_folders_response.json()
            
            if not root_folders:
                return {
                    'success': False,
                    'message': 'No root folders configured in Sonarr'
                }
            
            # Get quality profiles
            profiles_response = requests.get(
                f"{url}/api/v3/qualityprofile",
                headers={'X-Api-Key': api_key},
                timeout=10
            )
            profiles_response.raise_for_status()
            profiles = profiles_response.json()
            
            if not profiles:
                return {
                    'success': False,
                    'message': 'No quality profiles configured in Sonarr'
                }
            
            # Use provided quality profile ID or default to first one
            selected_profile_id = quality_profile_id if quality_profile_id else profiles[0]['id']
            
            # Prepare series data for adding
            add_data = {
                'title': series_data['title'],
                'tvdbId': series_data.get('tvdbId'),
                'year': series_data.get('year'),
                'rootFolderPath': root_folders[0]['path'],
                'qualityProfileId': selected_profile_id,
                'monitored': True,
                'addOptions': {
                    'searchForMissingEpisodes': True
                }
            }
            
            # Add additional fields from lookup
            for field in ['imdbId', 'overview', 'images', 'genres', 'network', 'seasons']:
                if field in series_data:
                    add_data[field] = series_data[field]
            
            # Add the series
            add_response = requests.post(
                f"{url}/api/v3/series",
                headers={'X-Api-Key': api_key, 'Content-Type': 'application/json'},
                json=add_data,
                timeout=10
            )
            add_response.raise_for_status()
            
            return {
                'success': True,
                'message': 'Series successfully added to Sonarr'
            }
            
        except Exception as e:
            logger.error(f"Error adding series to Sonarr: {e}")
            return {
                'success': False,
                'message': f'Error adding series to Sonarr: {str(e)}'
            }

# Global instance
requestarr_api = RequestarrAPI() 