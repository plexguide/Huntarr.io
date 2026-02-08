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
    
    def get_trending(self, time_window: str = 'week', movie_instance: str = '', tv_instance: str = '') -> List[Dict[str, Any]]:
        """Get trending movies and TV shows sorted by popularity"""
        api_key = self.get_tmdb_api_key()
        filters = self.get_discover_filters()
        region = filters.get('region', '')
        languages = filters.get('languages', [])
        providers = filters.get('providers', [])
        blacklisted = self.get_blacklisted_genres()
        blacklisted_movie = [int(x) for x in blacklisted.get('blacklisted_movie_genres', [])]
        blacklisted_tv = [int(x) for x in blacklisted.get('blacklisted_tv_genres', [])]
        
        all_results = []
        movie_results = []
        tv_results = []
        
        try:
            # Use discover endpoint for better filtering
            # Get both movies and TV shows
            for media_type in ['movie', 'tv']:
                url = f"{self.tmdb_base_url}/discover/{media_type}"
                params = {
                    'api_key': api_key,
                    'page': 1,
                    'sort_by': 'popularity.desc'
                }
                if media_type == 'movie' and blacklisted_movie:
                    params['without_genres'] = '|'.join(str(g) for g in blacklisted_movie)
                elif media_type == 'tv' and blacklisted_tv:
                    params['without_genres'] = '|'.join(str(g) for g in blacklisted_tv)
                
                # Add region filter if set (not empty string)
                if region:
                    params['region'] = region
                
                # Add language filter if languages are selected
                if languages:
                    params['with_original_language'] = '|'.join(languages)

                # Add watch provider filters if selected
                if providers:
                    if region:
                        params['watch_region'] = region
                    params['with_watch_providers'] = '|'.join([str(p) for p in providers])
                
                response = requests.get(url, params=params, timeout=10)
                response.raise_for_status()
                
                data = response.json()
                bl_set = set(blacklisted_movie) if media_type == 'movie' else set(blacklisted_tv)
                count = 0
                for item in data.get('results', []):
                    if count >= 10:
                        break
                    # Skip blacklisted genres (fallback filter)
                    item_genre_ids = set(item.get('genre_ids') or [])
                    if bl_set and item_genre_ids.intersection(bl_set):
                        continue
                    count += 1
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
                    
                    result_item = {
                        'tmdb_id': item.get('id'),
                        'media_type': media_type,
                        'title': title,
                        'year': year,
                        'overview': item.get('overview', ''),
                        'poster_path': poster_url,
                        'backdrop_path': backdrop_url,
                        'vote_average': item.get('vote_average', 0),
                        'popularity': item.get('popularity', 0)
                    }
                    
                    # Separate movies and TV shows for instance-specific checking
                    if media_type == 'movie':
                        movie_results.append(result_item)
                    else:
                        tv_results.append(result_item)
            
            # Check library status separately for movies and TV shows using their respective instances
            if movie_results and movie_instance:
                logger.info(f"[get_trending] Checking {len(movie_results)} movies against Radarr instance: {movie_instance}")
                movie_results = self.check_library_status_batch(movie_results, app_type='radarr', instance_name=movie_instance)
            elif movie_results:
                logger.info(f"[get_trending] Checking {len(movie_results)} movies against all Radarr instances")
                movie_results = self.check_library_status_batch(movie_results)
            
            if tv_results and tv_instance:
                logger.info(f"[get_trending] Checking {len(tv_results)} TV shows against Sonarr instance: {tv_instance}")
                tv_results = self.check_library_status_batch(tv_results, app_type='sonarr', instance_name=tv_instance)
            elif tv_results:
                logger.info(f"[get_trending] Checking {len(tv_results)} TV shows against all Sonarr instances")
                tv_results = self.check_library_status_batch(tv_results)
            
            # Combine and sort by popularity
            all_results = movie_results + tv_results
            all_results.sort(key=lambda x: x.get('popularity', 0), reverse=True)
            
            return all_results
            
        except Exception as e:
            logger.error(f"Error getting trending: {e}")
            return []
    
    def get_popular_movies(self, page: int = 1, **kwargs) -> List[Dict[str, Any]]:
        """Get popular movies sorted by popularity descending with optional filters"""
        api_key = self.get_tmdb_api_key()
        filters = self.get_discover_filters()
        region = filters.get('region', '')
        languages = filters.get('languages', [])
        providers = filters.get('providers', [])
        blacklisted = self.get_blacklisted_genres()
        blacklisted_movie = [int(x) for x in blacklisted.get('blacklisted_movie_genres', [])]
        
        all_results = []
        
        try:
            # Use discover endpoint with single page request
            url = f"{self.tmdb_base_url}/discover/movie"
            params = {
                'api_key': api_key,
                'page': page,
                'sort_by': kwargs.get('sort_by', 'popularity.desc')
            }
            
            # Exclude blacklisted genres (TMDB uses pipe-separated for without_genres)
            if blacklisted_movie:
                params['without_genres'] = '|'.join(str(g) for g in blacklisted_movie)
            
            # Add region filter if set
            if region:
                params['region'] = region
            
            # Add language filter if languages are selected
            if languages:
                params['with_original_language'] = '|'.join(languages)

            # Add watch provider filters if selected
            if providers:
                if region:
                    params['watch_region'] = region
                params['with_watch_providers'] = '|'.join([str(p) for p in providers])
            
            # Add custom filter parameters
            if kwargs.get('with_genres'):
                params['with_genres'] = kwargs['with_genres']
            if kwargs.get('with_original_language'):
                params['with_original_language'] = kwargs['with_original_language']
            if kwargs.get('release_date.gte'):
                params['release_date.gte'] = kwargs['release_date.gte']
            if kwargs.get('release_date.lte'):
                params['release_date.lte'] = kwargs['release_date.lte']
            if kwargs.get('with_runtime.gte'):
                params['with_runtime.gte'] = kwargs['with_runtime.gte']
            if kwargs.get('with_runtime.lte'):
                params['with_runtime.lte'] = kwargs['with_runtime.lte']
            if kwargs.get('vote_average.gte'):
                params['vote_average.gte'] = kwargs['vote_average.gte']
            if kwargs.get('vote_average.lte'):
                params['vote_average.lte'] = kwargs['vote_average.lte']
            if kwargs.get('vote_count.gte'):
                params['vote_count.gte'] = kwargs['vote_count.gte']
            if kwargs.get('vote_count.lte'):
                params['vote_count.lte'] = kwargs['vote_count.lte']
            
            logger.info(f"Fetching movies from TMDB - Page: {page}, Sort: {params['sort_by']}")
            
            response = requests.get(url, params=params, timeout=10)
            response.raise_for_status()
            
            data = response.json()
            
            for item in data.get('results', []):
                # Skip if item has any blacklisted genre (fallback if TMDB ignores without_genres)
                item_genre_ids = set(item.get('genre_ids') or [])
                if blacklisted_movie and item_genre_ids.intersection(blacklisted_movie):
                    continue
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
            
            logger.info(f"Found {len(all_results)} movies on page {page}")
            
            # Check library status for all items - pass instance info if available from kwargs
            app_type = kwargs.get('app_type', 'radarr')
            instance_name = kwargs.get('instance_name')
            
            if instance_name:
                logger.debug(f"Checking library status for Radarr instance: {instance_name}")
                logger.info(f"[get_popular_movies] Calling check_library_status_batch WITH instance: {instance_name}")
                all_results = self.check_library_status_batch(all_results, app_type, instance_name)
            else:
                # No instance specified, check all instances (old behavior)
                logger.info(f"[get_popular_movies] Calling check_library_status_batch WITHOUT instance")
                all_results = self.check_library_status_batch(all_results)
            
            return all_results
            
        except Exception as e:
            logger.error(f"Error getting popular movies: {e}")
            return []
    
    def get_popular_tv(self, page: int = 1, **kwargs) -> List[Dict[str, Any]]:
        """Get popular TV shows sorted by popularity descending with optional filters"""
        api_key = self.get_tmdb_api_key()
        filters = self.get_discover_filters()
        region = filters.get('region', '')
        languages = filters.get('languages', [])
        providers = filters.get('providers', [])
        blacklisted = self.get_blacklisted_genres()
        blacklisted_tv = [int(x) for x in blacklisted.get('blacklisted_tv_genres', [])]
        
        all_results = []
        
        try:
            # Use discover endpoint with single page request
            url = f"{self.tmdb_base_url}/discover/tv"
            params = {
                'api_key': api_key,
                'page': page,
                'sort_by': kwargs.get('sort_by', 'popularity.desc')
            }
            
            # Exclude blacklisted genres (TMDB uses pipe-separated for without_genres)
            if blacklisted_tv:
                params['without_genres'] = '|'.join(str(g) for g in blacklisted_tv)
            
            # Add region filter if set
            if region:
                params['region'] = region
            
            # Add language filter if languages are selected
            if languages:
                params['with_original_language'] = '|'.join(languages)

            # Add watch provider filters if selected
            if providers:
                if region:
                    params['watch_region'] = region
                params['with_watch_providers'] = '|'.join([str(p) for p in providers])
            
            # Add custom filter parameters
            if kwargs.get('with_genres'):
                params['with_genres'] = kwargs['with_genres']
            if kwargs.get('with_original_language'):
                params['with_original_language'] = kwargs['with_original_language']
            if kwargs.get('first_air_date.gte'):
                params['first_air_date.gte'] = kwargs['first_air_date.gte']
            if kwargs.get('first_air_date.lte'):
                params['first_air_date.lte'] = kwargs['first_air_date.lte']
            if kwargs.get('vote_average.gte'):
                params['vote_average.gte'] = kwargs['vote_average.gte']
            if kwargs.get('vote_average.lte'):
                params['vote_average.lte'] = kwargs['vote_average.lte']
            if kwargs.get('vote_count.gte'):
                params['vote_count.gte'] = kwargs['vote_count.gte']
            if kwargs.get('vote_count.lte'):
                params['vote_count.lte'] = kwargs['vote_count.lte']
            
            logger.info(f"Fetching TV shows from TMDB - Page: {page}, Sort: {params['sort_by']}")
            logger.debug(f"TMDB Request URL: {url}")
            logger.debug(f"TMDB Request Params: {params}")
            
            response = requests.get(url, params=params, timeout=10)
            response.raise_for_status()
            
            data = response.json()
            
            for item in data.get('results', []):
                # Skip if item has any blacklisted genre (fallback if TMDB ignores without_genres)
                item_genre_ids = set(item.get('genre_ids') or [])
                if blacklisted_tv and item_genre_ids.intersection(blacklisted_tv):
                    continue
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
            
            logger.info(f"Found {len(all_results)} TV shows on page {page}")
            
            # Check library status for all items - pass instance info if available from kwargs
            app_type = kwargs.get('app_type', 'sonarr')
            instance_name = kwargs.get('instance_name')
            
            if instance_name:
                logger.debug(f"Checking library status for Sonarr instance: {instance_name}")
                logger.info(f"[get_popular_tv] Calling check_library_status_batch WITH instance: {instance_name}")
                all_results = self.check_library_status_batch(all_results, app_type, instance_name)
            else:
                # No instance specified, check all instances (old behavior)
                logger.info(f"[get_popular_tv] Calling check_library_status_batch WITHOUT instance")
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
    
    def get_movie_status_from_movie_hunt(self, tmdb_id: int, instance_name: str) -> Dict[str, Any]:
        """Get movie status from Movie Hunt's collection - in library, previously requested, etc."""
        try:
            # Check cooldown status
            cooldown_hours = self.get_cooldown_hours()
            cooldown_status = self.db.get_request_cooldown_status(tmdb_id, 'movie', 'movie_hunt', instance_name, cooldown_hours)
            already_requested_in_db = cooldown_status['last_requested_at'] is not None
            
            # Resolve Movie Hunt instance ID
            instance_id = self._resolve_movie_hunt_instance_id(instance_name)
            if instance_id is None:
                return {
                    'in_library': False,
                    'previously_requested': already_requested_in_db,
                    'cooldown_status': cooldown_status
                }
            
            # Check Movie Hunt's collection for this movie
            from src.primary.routes.movie_hunt.discovery import _get_collection_config
            items = _get_collection_config(instance_id)
            
            movie = None
            for item in items:
                if item.get('tmdb_id') == tmdb_id:
                    movie = item
                    break
            
            if not movie:
                # Also check detected movies from root folders
                try:
                    from src.primary.routes.movie_hunt.storage import _get_detected_movies_from_all_roots
                    detected = _get_detected_movies_from_all_roots(instance_id)
                    for d in detected:
                        if d.get('tmdb_id') == tmdb_id:
                            movie = d
                            break
                except Exception:
                    pass
            
            if not movie:
                return {
                    'in_library': False,
                    'previously_requested': already_requested_in_db,
                    'cooldown_status': cooldown_status
                }
            
            # Determine status
            import os
            status_raw = (movie.get('status') or '').lower()
            file_path = (movie.get('file_path') or '').strip()
            has_file = False
            
            if file_path and os.path.isfile(file_path):
                has_file = True
            elif status_raw == 'available':
                has_file = True
            
            return {
                'in_library': has_file,
                'previously_requested': already_requested_in_db or status_raw == 'requested',
                'monitored': True,
                'cooldown_status': cooldown_status
            }
            
        except Exception as e:
            logger.error(f"Error getting movie status from Movie Hunt: {e}")
            cooldown_hours = self.get_cooldown_hours()
            cooldown_status = self.db.get_request_cooldown_status(tmdb_id, 'movie', 'movie_hunt', instance_name, cooldown_hours)
            already_requested_in_db = cooldown_status['last_requested_at'] is not None
            return {
                'in_library': False,
                'previously_requested': already_requested_in_db,
                'cooldown_status': cooldown_status
            }
    
    def check_library_status_batch(self, items: List[Dict[str, Any]], app_type: str = None, instance_name: str = None) -> List[Dict[str, Any]]:
        """
        Check library status for a batch of media items.
        Adds status flags to each item:
        - 'in_library': Complete (all episodes for TV, has file for movies)
        - 'partial': TV shows with some but not all episodes
        - 'in_cooldown': Recently requested (within 12 hours)
        
        Args:
            items: List of media items to check
            app_type: Optional app type to check (radarr/sonarr). If None, checks all instances.
            instance_name: Optional instance name to check. If None, checks all instances.
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
            
            # Filter instances based on app_type and instance_name if provided
            radarr_instances = instances['radarr']
            sonarr_instances = instances['sonarr']
            
            if app_type and instance_name:
                logger.info(f"Filtering instances - app_type: {app_type}, instance_name: {instance_name}")
                if app_type == 'radarr':
                    original_count = len(radarr_instances)
                    radarr_instances = [inst for inst in radarr_instances if inst['name'] == instance_name]
                    sonarr_instances = []  # Don't check Sonarr if Radarr is specified
                    logger.info(f"Filtered Radarr instances from {original_count} to {len(radarr_instances)}: {[inst['name'] for inst in radarr_instances]}")
                elif app_type == 'sonarr':
                    original_count = len(sonarr_instances)
                    sonarr_instances = [inst for inst in sonarr_instances if inst['name'] == instance_name]
                    radarr_instances = []  # Don't check Radarr if Sonarr is specified
                    logger.info(f"Filtered Sonarr instances from {original_count} to {len(sonarr_instances)}: {[inst['name'] for inst in sonarr_instances]}")
            else:
                logger.info(f"No instance filtering - checking all instances (Radarr: {len(radarr_instances)}, Sonarr: {len(sonarr_instances)})")
            
            # Get all movies from filtered Radarr instances
            radarr_tmdb_ids = set()
            for instance in radarr_instances:
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
                        logger.info(f"Found {len(radarr_tmdb_ids)} movies with files in Radarr instance {instance['name']}")
                except Exception as e:
                    logger.error(f"Error checking Radarr instance {instance['name']}: {e}")
            
            # Get all series from filtered Sonarr instances
            sonarr_tmdb_ids = set()
            sonarr_partial_tmdb_ids = set()
            for instance in sonarr_instances:
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
                        logger.info(f"Found {len(sonarr_tmdb_ids)} complete series and {len(sonarr_partial_tmdb_ids)} partial series in Sonarr instance {instance['name']}")
                except Exception as e:
                    logger.error(f"Error checking Sonarr instance {instance['name']}: {e}")
            
            # Mark each item with status
            for item in items:
                tmdb_id = item.get('tmdb_id')
                media_type = item.get('media_type')
                
                # Check cooldown status for the specified instance or all instances
                item['in_cooldown'] = False
                cooldown_hours = self.get_cooldown_hours()
                
                if app_type and instance_name:
                    # Check only the specified instance
                    cooldown_status = self.db.get_request_cooldown_status(tmdb_id, media_type, app_type, instance_name, cooldown_hours)
                    item['in_cooldown'] = cooldown_status['in_cooldown']
                else:
                    # Check ALL instances for cooldown (old behavior)
                    if instances['radarr'] and media_type == 'movie':
                        for instance in instances['radarr']:
                            instance_name_check = instance['name']
                            cooldown_status = self.db.get_request_cooldown_status(tmdb_id, media_type, 'radarr', instance_name_check, cooldown_hours)
                            if cooldown_status['in_cooldown']:
                                item['in_cooldown'] = True
                                break
                    elif instances['sonarr'] and media_type == 'tv':
                        for instance in instances['sonarr']:
                            instance_name_check = instance['name']
                            cooldown_status = self.db.get_request_cooldown_status(tmdb_id, media_type, 'sonarr', instance_name_check, cooldown_hours)
                            if cooldown_status['in_cooldown']:
                                item['in_cooldown'] = True
                                break
                
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
    
    def filter_available_media(self, items: List[Dict[str, Any]], media_type: str) -> List[Dict[str, Any]]:
        """
        Filter out media items that are already available in library.
        Returns only items where in_library is False (not available).
        
        Args:
            items: List of media items with 'in_library' status
            media_type: 'movie' or 'tv'
            
        Returns:
            Filtered list excluding items already in library
        """
        try:
            filtered_items = [item for item in items if not item.get('in_library', False)]
            logger.info(f"Filtered {media_type} results: {len(items)} total -> {len(filtered_items)} not in library")
            return filtered_items
        except Exception as e:
            logger.error(f"Error filtering available media: {e}")
            return items  # Return all items on error
    
    def filter_hidden_media(self, items: List[Dict[str, Any]], app_type: str = None, instance_name: str = None) -> List[Dict[str, Any]]:
        """
        Filter out media items that have been permanently hidden by the user for a specific instance.
        
        Args:
            items: List of media items with 'tmdb_id' and 'media_type'
            app_type: App type (radarr/sonarr) - if None, checks all instances
            instance_name: Instance name - if None, checks all instances
            
        Returns:
            Filtered list excluding hidden media
        """
        try:
            # Get set of hidden media IDs for faster lookup
            filtered_items = []
            for item in items:
                tmdb_id = item.get('tmdb_id')
                media_type = item.get('media_type')
                
                # If instance specified, check only for that instance
                # Otherwise, skip filtering (show all)
                if app_type and instance_name:
                    if not self.db.is_media_hidden(tmdb_id, media_type, app_type, instance_name):
                        filtered_items.append(item)
                else:
                    # No instance specified, show all
                    filtered_items.append(item)
            
            if len(filtered_items) < len(items):
                logger.info(f"Filtered hidden media: {len(items)} total -> {len(filtered_items)} after removing hidden for {app_type}/{instance_name}")
            
            return filtered_items
        except Exception as e:
            logger.error(f"Error filtering hidden media: {e}")
            return items  # Return all items on error
    
    def get_quality_profiles(self, app_type: str, instance_name: str) -> List[Dict[str, Any]]:
        """Get quality profiles from Radarr, Sonarr, or Movie Hunt instance"""
        try:
            # Movie Hunt profiles come from internal database, not external API
            if app_type == 'movie_hunt':
                return self._get_movie_hunt_quality_profiles(instance_name)
            
            # Get instance config
            app_config = self.db.get_app_config(app_type)
            if not app_config or not app_config.get('instances'):
                logger.warning(f"No app config found for {app_type}")
                return []
            
            target_instance = None
            for instance in app_config['instances']:
                if instance.get('name') == instance_name:
                    target_instance = instance
                    break
            
            if not target_instance:
                logger.warning(f"Instance {instance_name} not found in {app_type} config")
                return []
            
            # Get URL and API key
            url = target_instance.get('api_url', '') or target_instance.get('url', '')
            api_key = target_instance.get('api_key', '')
            
            if not url or not api_key:
                logger.warning(f"Missing URL or API key for {app_type}/{instance_name}")
                return []
            
            url = url.rstrip('/')
            
            # Retry logic with exponential backoff for slow/busy instances
            import time
            max_retries = 3
            timeout = 30  # Increased from 10s to 30s for slow Unraid environments
            
            for attempt in range(max_retries):
                try:
                    logger.info(f"Fetching quality profiles from {app_type}/{instance_name} (attempt {attempt+1}/{max_retries})")
                    headers = {'X-Api-Key': api_key}
                    response = requests.get(
                        f"{url}/api/v3/qualityprofile",
                        headers=headers,
                        timeout=timeout
                    )
                    
                    if response.status_code != 200:
                        logger.error(f"Failed to get quality profiles: {response.status_code}")
                        if attempt < max_retries - 1:
                            wait_time = 2 ** attempt
                            logger.warning(f"Retrying in {wait_time}s...")
                            time.sleep(wait_time)
                            continue
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
                    
                except (requests.exceptions.Timeout, requests.exceptions.ConnectionError) as e:
                    if attempt < max_retries - 1:
                        wait_time = 2 ** attempt  # Exponential backoff: 1s, 2s, 4s
                        logger.warning(f"Timeout/connection error fetching quality profiles from {app_type}/{instance_name} (attempt {attempt+1}): {e}. Retrying in {wait_time}s...")
                        time.sleep(wait_time)
                        continue
                    else:
                        logger.error(f"Failed to fetch quality profiles after {max_retries} attempts: {e}")
                        return []
                except requests.exceptions.RequestException as e:
                    logger.error(f"API error fetching quality profiles from {app_type}/{instance_name}: {e}")
                    return []
            
            # If we get here, all retries failed
            logger.error(f"All {max_retries} attempts failed to fetch quality profiles")
            return []
            
        except Exception as e:
            logger.error(f"Error getting quality profiles from {app_type}: {e}")
            return []
    
    def _get_movie_hunt_quality_profiles(self, instance_name: str) -> List[Dict[str, Any]]:
        """Get quality profiles from a Movie Hunt instance (internal database)"""
        try:
            instance_id = self._resolve_movie_hunt_instance_id(instance_name)
            if instance_id is None:
                logger.warning(f"Movie Hunt instance '{instance_name}' not found")
                return []
            
            from src.primary.routes.movie_hunt.profiles import _get_profiles_config
            profiles = _get_profiles_config(instance_id)
            
            # Return in same format as Radarr/Sonarr profiles (id + name)
            # Movie Hunt profiles use name-based identification, so use name as both id and name
            result = []
            for i, profile in enumerate(profiles):
                profile_name = (profile.get('name') or '').strip()
                if profile_name:
                    result.append({
                        'id': profile_name,  # Movie Hunt uses names, not integer IDs
                        'name': profile_name
                    })
            return result
        except Exception as e:
            logger.error(f"Error getting Movie Hunt quality profiles for '{instance_name}': {e}")
            return []
    
    def _resolve_movie_hunt_instance_id(self, instance_name: str) -> Optional[int]:
        """Resolve a Movie Hunt instance name to its database ID"""
        try:
            mh_instances = self.db.get_movie_hunt_instances()
            for inst in mh_instances:
                if (inst.get('name') or '').strip() == instance_name:
                    return inst.get('id')
            return None
        except Exception as e:
            logger.error(f"Error resolving Movie Hunt instance '{instance_name}': {e}")
            return None
    
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
        """Get cooldown period in hours from database (default: 24 hours / 1 day)"""
        try:
            requestarr_config = self.db.get_app_config('requestarr')
            if requestarr_config and 'cooldown_hours' in requestarr_config:
                return int(requestarr_config['cooldown_hours'])
            return 24  # Default to 1 day
        except Exception as e:
            logger.error(f"Error getting cooldown hours: {e}")
            return 24
    
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
    
    def get_discover_filters(self) -> dict:
        """Get discover filter settings from database"""
        try:
            requestarr_config = self.db.get_app_config('requestarr')
            if requestarr_config and 'discover_filters' in requestarr_config:
                filters = requestarr_config['discover_filters']
                if 'providers' not in filters:
                    filters['providers'] = []
                if 'languages' not in filters:
                    filters['languages'] = []
                if 'region' not in filters:
                    filters['region'] = 'US'
                return filters
            # Default to US region
            return {'region': 'US', 'languages': [], 'providers': []}
        except Exception as e:
            logger.error(f"Error getting discover filters: {e}")
            return {'region': 'US', 'languages': [], 'providers': []}
    
    def set_discover_filters(self, region: str, languages: list, providers: list):
        """Set discover filter settings in database"""
        try:
            # Get existing config or create new one
            requestarr_config = self.db.get_app_config('requestarr') or {}
            requestarr_config['discover_filters'] = {
                'region': region,
                'languages': languages,
                'providers': providers
            }
            self.db.save_app_config('requestarr', requestarr_config)
            logger.info(f"Set discover filters - Region: {region}, Languages: {languages}, Providers: {providers}")
        except Exception as e:
            logger.error(f"Error setting discover filters: {e}")
            raise

    def get_blacklisted_genres(self) -> dict:
        """Get blacklisted TV and movie genre IDs (excluded from filter dropdowns everywhere)."""
        try:
            requestarr_config = self.db.get_app_config('requestarr')
            if requestarr_config:
                return {
                    'blacklisted_tv_genres': list(requestarr_config.get('blacklisted_tv_genres') or []),
                    'blacklisted_movie_genres': list(requestarr_config.get('blacklisted_movie_genres') or [])
                }
            return {'blacklisted_tv_genres': [], 'blacklisted_movie_genres': []}
        except Exception as e:
            logger.error(f"Error getting blacklisted genres: {e}")
            return {'blacklisted_tv_genres': [], 'blacklisted_movie_genres': []}

    def set_blacklisted_genres(self, blacklisted_tv_genres: list, blacklisted_movie_genres: list):
        """Set blacklisted TV and movie genre IDs."""
        try:
            requestarr_config = self.db.get_app_config('requestarr') or {}
            requestarr_config['blacklisted_tv_genres'] = [int(x) for x in blacklisted_tv_genres if x is not None]
            requestarr_config['blacklisted_movie_genres'] = [int(x) for x in blacklisted_movie_genres if x is not None]
            self.db.save_app_config('requestarr', requestarr_config)
            logger.info(f"Set blacklisted genres - TV: {requestarr_config['blacklisted_tv_genres']}, Movie: {requestarr_config['blacklisted_movie_genres']}")
        except Exception as e:
            logger.error(f"Error setting blacklisted genres: {e}")
            raise

    def get_default_instances(self) -> dict:
        """Get default instance settings for discovery"""
        try:
            requestarr_config = self.db.get_app_config('requestarr')
            if requestarr_config and 'default_instances' in requestarr_config:
                defaults = requestarr_config['default_instances']
                return {
                    'movie_instance': defaults.get('movie_instance', ''),
                    'tv_instance': defaults.get('tv_instance', '')
                }
            # No defaults set
            return {'movie_instance': '', 'tv_instance': ''}
        except Exception as e:
            logger.error(f"Error getting default instances: {e}")
            return {'movie_instance': '', 'tv_instance': ''}
    
    def set_default_instances(self, movie_instance: str, tv_instance: str):
        """Set default instance settings for discovery"""
        try:
            # Get existing config or create new one
            requestarr_config = self.db.get_app_config('requestarr') or {}
            requestarr_config['default_instances'] = {
                'movie_instance': movie_instance,
                'tv_instance': tv_instance
            }
            self.db.save_app_config('requestarr', requestarr_config)
            logger.info(f"Set default instances - Movies: {movie_instance or 'None'}, TV: {tv_instance or 'None'}")
        except Exception as e:
            logger.error(f"Error setting default instances: {e}")
            raise

    def get_default_root_folders(self) -> Dict[str, str]:
        """Get default root folder paths per app (issue #806). Returns paths for radarr/sonarr/movie_hunt."""
        try:
            requestarr_config = self.db.get_app_config('requestarr')
            if requestarr_config:
                return {
                    'default_root_folder_radarr': (requestarr_config.get('default_root_folder_radarr') or '').strip(),
                    'default_root_folder_sonarr': (requestarr_config.get('default_root_folder_sonarr') or '').strip(),
                    'default_root_folder_movie_hunt': (requestarr_config.get('default_root_folder_movie_hunt') or '').strip()
                }
            return {'default_root_folder_radarr': '', 'default_root_folder_sonarr': '', 'default_root_folder_movie_hunt': ''}
        except Exception as e:
            logger.error(f"Error getting default root folders: {e}")
            return {'default_root_folder_radarr': '', 'default_root_folder_sonarr': '', 'default_root_folder_movie_hunt': ''}

    def set_default_root_folders(self, default_root_folder_radarr: str = None, default_root_folder_sonarr: str = None, default_root_folder_movie_hunt: str = None):
        """Set default root folder path per app (issue #806)."""
        try:
            requestarr_config = self.db.get_app_config('requestarr') or {}
            if default_root_folder_radarr is not None:
                requestarr_config['default_root_folder_radarr'] = (default_root_folder_radarr or '').strip()
            if default_root_folder_sonarr is not None:
                requestarr_config['default_root_folder_sonarr'] = (default_root_folder_sonarr or '').strip()
            if default_root_folder_movie_hunt is not None:
                requestarr_config['default_root_folder_movie_hunt'] = (default_root_folder_movie_hunt or '').strip()
            self.db.save_app_config('requestarr', requestarr_config)
            logger.info(f"Set default root folders - Radarr: {requestarr_config.get('default_root_folder_radarr') or 'None'}, Sonarr: {requestarr_config.get('default_root_folder_sonarr') or 'None'}, Movie Hunt: {requestarr_config.get('default_root_folder_movie_hunt') or 'None'}")
        except Exception as e:
            logger.error(f"Error setting default root folders: {e}")
            raise

    def get_root_folders(self, app_type: str, instance_name: str) -> List[Dict[str, Any]]:
        """Fetch root folders from *arr or Movie Hunt instance (for settings UI, issue #806). Deduped by ID and path."""
        if app_type == 'movie_hunt':
            return self._get_movie_hunt_root_folders(instance_name)
        if app_type not in ('radarr', 'sonarr'):
            return []
        try:
            app_config = self.db.get_app_config(app_type)
            if not app_config or not app_config.get('instances'):
                logger.warning(f"No app config found for {app_type}")
                return []
            instance = None
            for inst in app_config['instances']:
                if inst.get('name') == instance_name:
                    instance = inst
                    break
            if not instance:
                logger.warning(f"Instance {instance_name} not found in {app_type} config")
                return []
            url = (instance.get('api_url') or instance.get('url') or '').rstrip('/')
            api_key = instance.get('api_key', '')
            if not url or not api_key:
                logger.warning(f"Missing URL or API key for {app_type}/{instance_name}")
                return []
            
            # Retry logic with exponential backoff for slow/busy instances
            import time
            max_retries = 3
            timeout = 30  # Increased from 10s to 30s for slow Unraid environments
            
            for attempt in range(max_retries):
                try:
                    logger.info(f"Fetching root folders from {app_type}/{instance_name} (attempt {attempt+1}/{max_retries})")
                    resp = requests.get(
                        f"{url}/api/v3/rootfolder",
                        headers={'X-Api-Key': api_key},
                        timeout=timeout
                    )
                    resp.raise_for_status()
                    raw = resp.json()
                    break  # Success, exit retry loop
                except (requests.exceptions.Timeout, requests.exceptions.ConnectionError) as e:
                    if attempt < max_retries - 1:
                        wait_time = 2 ** attempt  # Exponential backoff: 1s, 2s, 4s
                        logger.warning(f"Timeout/connection error fetching root folders from {app_type}/{instance_name} (attempt {attempt+1}): {e}. Retrying in {wait_time}s...")
                        time.sleep(wait_time)
                        continue
                    else:
                        logger.error(f"Failed to fetch root folders after {max_retries} attempts: {e}")
                        return []
                except requests.exceptions.RequestException as e:
                    logger.error(f"API error fetching root folders from {app_type}/{instance_name}: {e}")
                    return []
            else:
                # Loop completed without break (all retries failed)
                logger.error(f"All {max_retries} attempts failed to fetch root folders")
                return []
            
            # Dedupe by BOTH ID and path - *arr APIs can return duplicates (issue #806)
            if not isinstance(raw, list):
                return []
            
            seen_ids = set()
            seen_paths = set()
            deduped = []
            for rf in raw:
                if not isinstance(rf, dict):
                    continue
                
                # Check both ID and path for duplicates
                rf_id = rf.get('id')
                path = (rf.get('path') or '').strip().rstrip('/')
                
                if not path:
                    continue
                
                # Normalize path for comparison (lowercase, no trailing slash)
                path_lower = path.lower()
                
                # Skip if we've seen this ID or this path
                if rf_id is not None and rf_id in seen_ids:
                    logger.debug(f"Skipping duplicate root folder ID: {rf_id}")
                    continue
                if path_lower in seen_paths:
                    logger.debug(f"Skipping duplicate root folder path: {path}")
                    continue
                
                # Add to seen sets
                if rf_id is not None:
                    seen_ids.add(rf_id)
                seen_paths.add(path_lower)
                
                # Keep original object
                deduped.append(rf)
            
            logger.info(f"Root folders for {app_type}/{instance_name}: {len(raw)} raw, {len(deduped)} after dedupe")
            return deduped
            
        except Exception as e:
            logger.error(f"Error fetching root folders from {app_type}/{instance_name}: {e}")
            return []
    
    def _get_movie_hunt_root_folders(self, instance_name: str) -> List[Dict[str, Any]]:
        """Get root folders from a Movie Hunt instance (internal database)"""
        try:
            instance_id = self._resolve_movie_hunt_instance_id(instance_name)
            if instance_id is None:
                logger.warning(f"Movie Hunt instance '{instance_name}' not found")
                return []
            
            from src.primary.routes.movie_hunt.storage import _get_root_folders_config
            folders = _get_root_folders_config(instance_id)
            
            # Convert to same format as Radarr/Sonarr root folders
            import os
            result = []
            for folder in folders:
                path = (folder.get('path') or '').strip()
                if not path:
                    continue
                
                # Try to get free space info
                free_space = None
                try:
                    if os.path.isdir(path):
                        stat = os.statvfs(path)
                        free_space = stat.f_bavail * stat.f_frsize
                except (OSError, AttributeError):
                    pass
                
                result.append({
                    'path': path,
                    'freeSpace': free_space,
                    'is_default': folder.get('is_default', False)
                })
            
            return result
        except Exception as e:
            logger.error(f"Error getting Movie Hunt root folders for '{instance_name}': {e}")
            return []

    def get_watch_providers(self, media_type: str, region: str = '') -> List[Dict[str, Any]]:
        """Get watch providers for a media type and region"""
        api_key = self.get_tmdb_api_key()

        try:
            url = f"{self.tmdb_base_url}/watch/providers/{media_type}"
            params = {'api_key': api_key}
            if region:
                params['watch_region'] = region

            response = requests.get(url, params=params, timeout=10)
            response.raise_for_status()
            data = response.json()

            providers = data.get('results', [])
            providers.sort(key=lambda p: p.get('display_priority', 9999))
            return providers
        except Exception as e:
            logger.error(f"Error getting watch providers: {e}")
            return []
    
    def reset_cooldowns(self) -> int:
        """Reset all cooldowns with 25+ hours remaining. Returns count of reset items."""
        try:
            count = self.db.reset_cooldowns_over_threshold(25)
            logger.info(f"Reset {count} cooldowns with 25+ hours remaining")
            return count
        except Exception as e:
            logger.error(f"Error resetting cooldowns: {e}")
            raise
    
    def get_genres(self, media_type: str) -> List[Dict[str, Any]]:
        """Get genre list from TMDB"""
        api_key = self.get_tmdb_api_key()
        
        try:
            url = f"{self.tmdb_base_url}/genre/{media_type}/list"
            params = {'api_key': api_key}
            
            response = requests.get(url, params=params, timeout=10)
            response.raise_for_status()
            
            data = response.json()
            return data.get('genres', [])
            
        except Exception as e:
            logger.error(f"Error getting genres: {e}")
            return []
    
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
        """Get enabled and properly configured Sonarr, Radarr, and Movie Hunt instances"""
        instances = {'sonarr': [], 'radarr': [], 'movie_hunt': []}
        seen_names = {'sonarr': set(), 'radarr': set(), 'movie_hunt': set()}
        
        try:
            # Get Sonarr instances
            sonarr_config = self.db.get_app_config('sonarr')
            if sonarr_config and sonarr_config.get('instances'):
                for instance in sonarr_config['instances']:
                    # Database stores URL as 'api_url', map it to 'url' for consistency
                    url = instance.get('api_url', '') or instance.get('url', '')
                    api_key = instance.get('api_key', '')
                    name = instance.get('name', 'Default')
                    
                    # Only include instances that are enabled AND have proper configuration
                    # AND not already added (deduplicate by name case-insensitively)
                    name_lower = name.strip().lower()
                    if (instance.get('enabled', False) and 
                        url.strip() and 
                        api_key.strip() and
                        name_lower not in seen_names['sonarr']):
                        instances['sonarr'].append({
                            'name': name.strip(),
                            'url': url.strip(),
                            'api_key': api_key.strip()
                        })
                        seen_names['sonarr'].add(name_lower)
            
            # Get Radarr instances
            radarr_config = self.db.get_app_config('radarr')
            if radarr_config and radarr_config.get('instances'):
                for instance in radarr_config['instances']:
                    # Database stores URL as 'api_url', map it to 'url' for consistency
                    url = instance.get('api_url', '') or instance.get('url', '')
                    api_key = instance.get('api_key', '')
                    name = instance.get('name', 'Default')
                    
                    # Only include instances that are enabled AND have proper configuration
                    # AND not already added (deduplicate by name case-insensitively)
                    name_lower = name.strip().lower()
                    if (instance.get('enabled', False) and 
                        url.strip() and 
                        api_key.strip() and
                        name_lower not in seen_names['radarr']):
                        instances['radarr'].append({
                            'name': name.strip(),
                            'url': url.strip(),
                            'api_key': api_key.strip()
                        })
                        seen_names['radarr'].add(name_lower)
            
            # Get Movie Hunt instances (from dedicated database table)
            try:
                mh_instances = self.db.get_movie_hunt_instances()
                for inst in mh_instances:
                    name = (inst.get('name') or '').strip()
                    if not name:
                        continue
                    name_lower = name.lower()
                    if name_lower not in seen_names['movie_hunt']:
                        instances['movie_hunt'].append({
                            'name': name,
                            'id': inst.get('id'),
                            'url': 'internal'
                        })
                        seen_names['movie_hunt'].add(name_lower)
            except Exception as e:
                logger.warning(f"Error loading Movie Hunt instances: {e}")
            
            return instances
            
        except Exception as e:
            logger.error(f"Error getting enabled instances: {e}")
            return {'sonarr': [], 'radarr': [], 'movie_hunt': []}
    
    def request_media(self, tmdb_id: int, media_type: str, title: str, year: int,
                     overview: str, poster_path: str, backdrop_path: str,
                     app_type: str, instance_name: str, quality_profile_id: int = None,
                     root_folder_path: str = None, quality_profile_name: str = None) -> Dict[str, Any]:
        """Request media through the specified app instance"""
        try:
            # Movie Hunt has its own request pipeline
            if app_type == 'movie_hunt':
                return self._request_media_via_movie_hunt(
                    tmdb_id=tmdb_id, title=title, year=year,
                    overview=overview, poster_path=poster_path,
                    backdrop_path=backdrop_path, instance_name=instance_name,
                    quality_profile_name=quality_profile_name,
                    root_folder_path=root_folder_path, media_type=media_type
                )
            
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
                add_result = self._add_media_to_app(tmdb_id, media_type, target_instance, app_type, quality_profile_id, root_folder_path)
                
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
    
    def _request_media_via_movie_hunt(self, tmdb_id: int, title: str, year: int,
                                      overview: str, poster_path: str, backdrop_path: str,
                                      instance_name: str, quality_profile_name: str = None,
                                      root_folder_path: str = None, media_type: str = 'movie') -> Dict[str, Any]:
        """Request a movie through Movie Hunt's own search-score-download pipeline"""
        try:
            # Resolve instance ID
            instance_id = self._resolve_movie_hunt_instance_id(instance_name)
            if instance_id is None:
                return {
                    'success': False,
                    'message': f'Movie Hunt instance "{instance_name}" not found',
                    'status': 'instance_not_found'
                }
            
            # Check cooldown
            cooldown_hours = self.get_cooldown_hours()
            cooldown_status = self.db.get_request_cooldown_status(tmdb_id, 'movie', 'movie_hunt', instance_name, cooldown_hours)
            
            if cooldown_status['in_cooldown']:
                hours_remaining = cooldown_status['hours_remaining']
                if hours_remaining <= 24:
                    hours = int(hours_remaining)
                    minutes = int((hours_remaining - hours) * 60)
                    time_msg = f"{hours}h {minutes}m" if hours > 0 else f"{minutes}m"
                else:
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
            
            # Check if movie already exists in Movie Hunt collection
            status = self.get_movie_status_from_movie_hunt(tmdb_id, instance_name)
            if status.get('in_library'):
                return {
                    'success': False,
                    'message': f'{title} already exists in Movie Hunt - {instance_name}',
                    'status': 'already_exists'
                }
            
            # Build request data for Movie Hunt's internal request endpoint
            # We call the discovery module's internal functions directly
            from src.primary.routes.movie_hunt.discovery import _get_collection_config
            from src.primary.routes.movie_hunt.indexers import _get_indexers_config, INDEXER_PRESET_URLS
            from src.primary.routes.movie_hunt.profiles import _get_profile_by_name_or_default, _best_result_matching_profile
            from src.primary.routes.movie_hunt.clients import _get_clients_config
            from src.primary.routes.movie_hunt._helpers import (
                _get_blocklist_source_titles, _blocklist_normalize_source_title,
                _add_requested_queue_id, MOVIE_HUNT_DEFAULT_CATEGORY
            )
            from src.primary.routes.movie_hunt.discovery import (
                _search_newznab_movie, _add_nzb_to_download_client, _collection_append
            )
            from src.primary.settings_manager import get_ssl_verify_setting
            
            indexers = _get_indexers_config(instance_id)
            clients = _get_clients_config(instance_id)
            enabled_indexers = [i for i in indexers if i.get('enabled', True) and (i.get('preset') or '').strip().lower() != 'manual']
            enabled_clients = [c for c in clients if c.get('enabled', True)]
            
            if not enabled_indexers:
                return {
                    'success': False,
                    'message': 'No indexers configured or enabled in Movie Hunt. Add indexers in Movie Hunt Settings.',
                    'status': 'no_indexers'
                }
            if not enabled_clients:
                return {
                    'success': False,
                    'message': 'No download clients configured or enabled in Movie Hunt. Add a client in Movie Hunt Settings.',
                    'status': 'no_clients'
                }
            
            year_str = str(year).strip() if year else ''
            query = f'{title} {year_str}'.strip()
            runtime_minutes = 90  # Default runtime
            
            profile = _get_profile_by_name_or_default(quality_profile_name, instance_id)
            verify_ssl = get_ssl_verify_setting()
            
            nzb_url = None
            nzb_title = None
            indexer_used = None
            request_score = 0
            request_score_breakdown = ''
            
            for idx in enabled_indexers:
                preset = (idx.get('preset') or '').strip().lower()
                base_url = INDEXER_PRESET_URLS.get(preset)
                if not base_url:
                    continue
                api_key = (idx.get('api_key') or '').strip()
                if not api_key:
                    continue
                categories = idx.get('categories') or [2000, 2010, 2020, 2030, 2040, 2045, 2050, 2070]
                results = _search_newznab_movie(base_url, api_key, query, categories, timeout=15)
                if results:
                    blocklist_titles = _get_blocklist_source_titles(instance_id)
                    if blocklist_titles:
                        results = [r for r in results if _blocklist_normalize_source_title(r.get('title')) not in blocklist_titles]
                        if not results:
                            continue
                    chosen, chosen_score, chosen_breakdown = _best_result_matching_profile(
                        results, profile, instance_id, runtime_minutes=runtime_minutes
                    )
                    min_score = profile.get('min_custom_format_score', 0)
                    try:
                        min_score = int(min_score)
                    except (TypeError, ValueError):
                        min_score = 0
                    if chosen and chosen_score >= min_score:
                        nzb_url = chosen.get('nzb_url')
                        nzb_title = chosen.get('title', 'Unknown')
                        indexer_used = idx.get('name') or preset
                        request_score = chosen_score
                        request_score_breakdown = chosen_breakdown or ''
                        break
            
            if not nzb_url:
                profile_name = (profile.get('name') or 'Standard').strip()
                min_score = profile.get('min_custom_format_score', 0)
                try:
                    min_score = int(min_score)
                except (TypeError, ValueError):
                    min_score = 0
                return {
                    'success': False,
                    'message': f'No release found matching quality profile "{profile_name}" (min score {min_score}). Try a different profile or search again later.',
                    'status': 'no_release'
                }
            
            # Send to download client
            client = enabled_clients[0]
            raw_cat = (client.get('category') or '').strip()
            request_category = MOVIE_HUNT_DEFAULT_CATEGORY if raw_cat.lower() in ('default', '*', '') else (raw_cat or MOVIE_HUNT_DEFAULT_CATEGORY)
            ok, msg, queue_id = _add_nzb_to_download_client(client, nzb_url, nzb_title or f'{title}.nzb', request_category, verify_ssl, indexer=indexer_used or '')
            
            if not ok:
                return {
                    'success': False,
                    'message': f'Failed to send to download client: {msg}',
                    'status': 'client_failed'
                }
            
            # Track the request in Movie Hunt's queue
            if queue_id:
                client_name = (client.get('name') or 'Download client').strip() or 'Download client'
                _add_requested_queue_id(client_name, queue_id, instance_id, title=title, year=year_str, score=request_score, score_breakdown=request_score_breakdown)
            
            # Add to Movie Hunt collection
            _collection_append(title=title, year=year_str, instance_id=instance_id, tmdb_id=tmdb_id, poster_path=poster_path, root_folder=root_folder_path)
            
            # Save request to Requestarr's DB for cooldown tracking
            self.db.add_request(
                tmdb_id, media_type, title, year, overview,
                poster_path, backdrop_path, 'movie_hunt', instance_name
            )
            
            return {
                'success': True,
                'message': f'"{title}" sent to {client.get("name") or "download client"} via Movie Hunt.',
                'status': 'requested'
            }
            
        except Exception as e:
            logger.error(f"Error requesting media via Movie Hunt: {e}", exc_info=True)
            return {
                'success': False,
                'message': f'Error requesting {title} via Movie Hunt: {str(e)}',
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
    
    def _add_media_to_app(self, tmdb_id: int, media_type: str, instance: Dict[str, str], app_type: str, quality_profile_id: int = None, root_folder_path: str = None) -> Dict[str, Any]:
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
                return self._add_movie_to_radarr(tmdb_id, url, api_key, quality_profile_id, root_folder_path)
            elif app_type == 'sonarr' and media_type == 'tv':
                return self._add_series_to_sonarr(tmdb_id, url, api_key, quality_profile_id, root_folder_path)
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
    
    def _add_movie_to_radarr(self, tmdb_id: int, url: str, api_key: str, quality_profile_id: int = None, root_folder_path: str = None) -> Dict[str, Any]:
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
            
            # Get root folders with retry logic
            import time
            max_retries = 3
            timeout = 30  # Increased for slow Unraid environments
            
            root_folders = None
            for attempt in range(max_retries):
                try:
                    logger.info(f"Fetching root folders from Radarr (attempt {attempt+1}/{max_retries})")
                    root_folders_response = requests.get(
                        f"{url}/api/v3/rootfolder",
                        headers={'X-Api-Key': api_key},
                        timeout=timeout
                    )
                    root_folders_response.raise_for_status()
                    root_folders = root_folders_response.json()
                    break  # Success
                except (requests.exceptions.Timeout, requests.exceptions.ConnectionError) as e:
                    if attempt < max_retries - 1:
                        wait_time = 2 ** attempt
                        logger.warning(f"Timeout/connection error fetching root folders (attempt {attempt+1}): {e}. Retrying in {wait_time}s...")
                        time.sleep(wait_time)
                        continue
                    else:
                        logger.error(f"Failed to fetch root folders after {max_retries} attempts: {e}")
                        return {
                            'success': False,
                            'message': 'Timeout connecting to Radarr. Please check your instance and try again.'
                        }
                except requests.exceptions.RequestException as e:
                    logger.error(f"API error fetching root folders: {e}")
                    return {
                        'success': False,
                        'message': f'Error fetching root folders: {str(e)}'
                    }
            
            if not root_folders:
                return {
                    'success': False,
                    'message': 'No root folders configured in Radarr'
                }
            
            # Use per-request root, then default from settings, then first folder (issue #806)
            root_paths = [rf['path'] for rf in root_folders]
            selected_root = root_folders[0]['path']
            if root_folder_path and root_folder_path in root_paths:
                selected_root = root_folder_path
            else:
                default_radarr = (self.get_default_root_folders().get('default_root_folder_radarr') or '').strip()
                if default_radarr and default_radarr in root_paths:
                    selected_root = default_radarr
            
            # Get quality profiles with retry logic
            profiles = None
            for attempt in range(max_retries):
                try:
                    logger.info(f"Fetching quality profiles from Radarr (attempt {attempt+1}/{max_retries})")
                    profiles_response = requests.get(
                        f"{url}/api/v3/qualityprofile",
                        headers={'X-Api-Key': api_key},
                        timeout=timeout
                    )
                    profiles_response.raise_for_status()
                    profiles = profiles_response.json()
                    break  # Success
                except (requests.exceptions.Timeout, requests.exceptions.ConnectionError) as e:
                    if attempt < max_retries - 1:
                        wait_time = 2 ** attempt
                        logger.warning(f"Timeout/connection error fetching quality profiles (attempt {attempt+1}): {e}. Retrying in {wait_time}s...")
                        time.sleep(wait_time)
                        continue
                    else:
                        logger.error(f"Failed to fetch quality profiles after {max_retries} attempts: {e}")
                        return {
                            'success': False,
                            'message': 'Timeout fetching quality profiles from Radarr. Please check your instance and try again.'
                        }
                except requests.exceptions.RequestException as e:
                    logger.error(f"API error fetching quality profiles: {e}")
                    return {
                        'success': False,
                        'message': f'Error fetching quality profiles: {str(e)}'
                    }
            
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
                'rootFolderPath': selected_root,
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
    
    def _add_series_to_sonarr(self, tmdb_id: int, url: str, api_key: str, quality_profile_id: int = None, root_folder_path: str = None) -> Dict[str, Any]:
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
            
            # Get root folders with retry logic
            import time
            max_retries = 3
            timeout = 30  # Increased for slow Unraid environments
            
            root_folders = None
            for attempt in range(max_retries):
                try:
                    logger.info(f"Fetching root folders from Sonarr (attempt {attempt+1}/{max_retries})")
                    root_folders_response = requests.get(
                        f"{url}/api/v3/rootfolder",
                        headers={'X-Api-Key': api_key},
                        timeout=timeout
                    )
                    root_folders_response.raise_for_status()
                    root_folders = root_folders_response.json()
                    break  # Success
                except (requests.exceptions.Timeout, requests.exceptions.ConnectionError) as e:
                    if attempt < max_retries - 1:
                        wait_time = 2 ** attempt
                        logger.warning(f"Timeout/connection error fetching root folders (attempt {attempt+1}): {e}. Retrying in {wait_time}s...")
                        time.sleep(wait_time)
                        continue
                    else:
                        logger.error(f"Failed to fetch root folders after {max_retries} attempts: {e}")
                        return {
                            'success': False,
                            'message': 'Timeout connecting to Sonarr. Please check your instance and try again.'
                        }
                except requests.exceptions.RequestException as e:
                    logger.error(f"API error fetching root folders: {e}")
                    return {
                        'success': False,
                        'message': f'Error fetching root folders: {str(e)}'
                    }
            
            if not root_folders:
                return {
                    'success': False,
                    'message': 'No root folders configured in Sonarr'
                }
            
            # Use per-request root, then default from settings, then first folder (issue #806)
            root_paths = [rf['path'] for rf in root_folders]
            selected_root = root_folders[0]['path']
            if root_folder_path and root_folder_path in root_paths:
                selected_root = root_folder_path
            else:
                default_sonarr = (self.get_default_root_folders().get('default_root_folder_sonarr') or '').strip()
                if default_sonarr and default_sonarr in root_paths:
                    selected_root = default_sonarr
            
            # Get quality profiles with retry logic
            profiles = None
            for attempt in range(max_retries):
                try:
                    logger.info(f"Fetching quality profiles from Sonarr (attempt {attempt+1}/{max_retries})")
                    profiles_response = requests.get(
                        f"{url}/api/v3/qualityprofile",
                        headers={'X-Api-Key': api_key},
                        timeout=timeout
                    )
                    profiles_response.raise_for_status()
                    profiles = profiles_response.json()
                    break  # Success
                except (requests.exceptions.Timeout, requests.exceptions.ConnectionError) as e:
                    if attempt < max_retries - 1:
                        wait_time = 2 ** attempt
                        logger.warning(f"Timeout/connection error fetching quality profiles (attempt {attempt+1}): {e}. Retrying in {wait_time}s...")
                        time.sleep(wait_time)
                        continue
                    else:
                        logger.error(f"Failed to fetch quality profiles after {max_retries} attempts: {e}")
                        return {
                            'success': False,
                            'message': 'Timeout fetching quality profiles from Sonarr. Please check your instance and try again.'
                        }
                except requests.exceptions.RequestException as e:
                    logger.error(f"API error fetching quality profiles: {e}")
                    return {
                        'success': False,
                        'message': f'Error fetching quality profiles: {str(e)}'
                    }
            
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
                'rootFolderPath': selected_root,
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