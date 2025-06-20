"""
Requestor module for searching and requesting media through TMDB and *arr apps
"""

import requests
import logging
from typing import Dict, List, Any, Optional
from src.primary.utils.database import get_database

logger = logging.getLogger(__name__)

class RequestorAPI:
    """API handler for Requestor functionality"""
    
    def __init__(self):
        self.db = get_database()
        self.tmdb_base_url = "https://api.themoviedb.org/3"
        self.tmdb_image_base_url = "https://image.tmdb.org/t/p/w500"
    
    def get_tmdb_api_key(self) -> str:
        """Get hardcoded TMDB API key"""
        return "9265b0bd0cd1962f7f3225989fcd7192"
    
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
            return results[:20]  # Limit to top 20 results
            
        except Exception as e:
            logger.error(f"Error searching TMDB: {e}")
            return []
    
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
        if not instance.get('url') or not instance.get('api_key'):
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
        """Get enabled Sonarr and Radarr instances"""
        instances = {'sonarr': [], 'radarr': []}
        
        try:
            # Get Sonarr instances
            sonarr_config = self.db.get_app_config('sonarr')
            if sonarr_config and sonarr_config.get('instances'):
                for instance in sonarr_config['instances']:
                    if instance.get('enabled', False):
                        instances['sonarr'].append({
                            'name': instance.get('name', 'Default'),
                            'url': instance.get('url', ''),
                            'api_key': instance.get('api_key', '')
                        })
            
            # Get Radarr instances
            radarr_config = self.db.get_app_config('radarr')
            if radarr_config and radarr_config.get('instances'):
                for instance in radarr_config['instances']:
                    if instance.get('enabled', False):
                        instances['radarr'].append({
                            'name': instance.get('name', 'Default'),
                            'url': instance.get('url', ''),
                            'api_key': instance.get('api_key', '')
                        })
            
            return instances
            
        except Exception as e:
            logger.error(f"Error getting enabled instances: {e}")
            return {'sonarr': [], 'radarr': []}
    
    def request_media(self, tmdb_id: int, media_type: str, title: str, year: int,
                     overview: str, poster_path: str, backdrop_path: str,
                     app_type: str, instance_name: str) -> Dict[str, Any]:
        """Request media through the specified app instance"""
        try:
            # Check if already requested
            if self.db.is_already_requested(tmdb_id, media_type, app_type, instance_name):
                return {
                    'success': False,
                    'message': f'{title} is already requested for {app_type.title()} - {instance_name}',
                    'status': 'already_requested'
                }
            
            # Get instance configuration
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
            
            # Check if media already exists in the app
            existing_status = self._check_media_exists(tmdb_id, media_type, target_instance, app_type)
            if existing_status['exists']:
                return {
                    'success': False,
                    'message': f'{title} already exists in {app_type.title()} - {instance_name}',
                    'status': 'already_exists'
                }
            
            # Check if media exists and get detailed info
            exists_result = self._check_media_exists(tmdb_id, media_type, target_instance, app_type)
            
            if (exists_result.get('exists') and app_type == 'sonarr' and 
                'series_id' in exists_result):
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
            else:
                # Add new media to the app
                add_result = self._add_media_to_app(tmdb_id, media_type, target_instance, app_type)
                
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
            url = instance.get('url', '').rstrip('/')
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
                return {'exists': len(movies) > 0}
                
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
                        # Get episode statistics
                        series_id = series.get('id')
                        episode_file_count = series.get('episodeFileCount', 0)
                        episode_count = series.get('episodeCount', 0)
                        
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
            url = instance.get('url', '').rstrip('/')
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
    
    def _add_media_to_app(self, tmdb_id: int, media_type: str, instance: Dict[str, str], app_type: str) -> Dict[str, Any]:
        """Add media to the app instance"""
        try:
            url = instance['url'].rstrip('/')
            api_key = instance['api_key']
            
            if app_type == 'radarr' and media_type == 'movie':
                return self._add_movie_to_radarr(tmdb_id, url, api_key)
            elif app_type == 'sonarr' and media_type == 'tv':
                return self._add_series_to_sonarr(tmdb_id, url, api_key)
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
    
    def _add_movie_to_radarr(self, tmdb_id: int, url: str, api_key: str) -> Dict[str, Any]:
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
            
            # Prepare movie data for adding
            add_data = {
                'title': movie_data['title'],
                'tmdbId': movie_data['tmdbId'],
                'year': movie_data['year'],
                'rootFolderPath': root_folders[0]['path'],
                'qualityProfileId': profiles[0]['id'],
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
    
    def _add_series_to_sonarr(self, tmdb_id: int, url: str, api_key: str) -> Dict[str, Any]:
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
            
            # Prepare series data for adding
            add_data = {
                'title': series_data['title'],
                'tvdbId': series_data.get('tvdbId'),
                'year': series_data.get('year'),
                'rootFolderPath': root_folders[0]['path'],
                'qualityProfileId': profiles[0]['id'],
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
requestor_api = RequestorAPI() 