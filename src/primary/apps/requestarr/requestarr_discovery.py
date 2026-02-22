"""
Requestarr Discovery Mixin
TMDB discovery, search, genres, providers, and filter preferences.
Extracted from requestarr/__init__.py to reduce file size.
"""

import requests
import logging
from typing import Dict, List, Any

logger = logging.getLogger(__name__)


def _safe_int_list(lst):
    """Safely parse list of values to ints, skipping invalid entries."""
    out = []
    for x in lst or []:
        try:
            out.append(int(x))
        except (TypeError, ValueError):
            pass
    return out


class DiscoveryMixin:
    """TMDB discovery, search, genres, providers, and filter preferences."""

    def get_trending(self, time_window: str = 'week', movie_instance: str = '', tv_instance: str = '', movie_app_type: str = 'radarr', tv_app_type: str = 'sonarr', page: int = 1) -> List[Dict[str, Any]]:
        """Get trending movies and TV shows sorted by popularity"""
        api_key = self.get_tmdb_api_key()
        filters = self.get_discover_filters()
        region = filters.get('region', '')
        languages = filters.get('languages', [])
        providers = filters.get('providers', [])
        blacklisted = self.get_blacklisted_genres()
        blacklisted_movie = _safe_int_list(blacklisted.get('blacklisted_movie_genres', []))
        blacklisted_tv = _safe_int_list(blacklisted.get('blacklisted_tv_genres', []))
        
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
                    'page': page,
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

                from src.primary.utils.tmdb_metadata_cache import get_discover, set_discover

                cache_params = {k: v for k, v in params.items() if k != 'api_key'}
                data = get_discover(media_type, cache_params)
                if data is None:
                    response = requests.get(url, params=params, timeout=10)
                    response.raise_for_status()
                    data = response.json()
                    set_discover(media_type, cache_params, data)

                bl_set = set(blacklisted_movie) if media_type == 'movie' else set(blacklisted_tv)
                count = 0
                for item in data.get('results', []):
                    if count >= 20:
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
                logger.debug(f"[get_trending] Checking {len(movie_results)} movies against {movie_app_type} instance: {movie_instance}")
                movie_results = self.check_library_status_batch(movie_results, app_type=movie_app_type, instance_name=movie_instance)
            elif movie_results:
                logger.debug(f"[get_trending] Checking {len(movie_results)} movies against all instances")
                movie_results = self.check_library_status_batch(movie_results)
            
            if tv_results and tv_instance:
                logger.debug(f"[get_trending] Checking {len(tv_results)} TV shows against {tv_app_type} instance: {tv_instance}")
                tv_results = self.check_library_status_batch(tv_results, app_type=tv_app_type, instance_name=tv_instance)
            elif tv_results:
                logger.debug(f"[get_trending] Checking {len(tv_results)} TV shows against all TV instances")
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
        blacklisted_movie = _safe_int_list(blacklisted.get('blacklisted_movie_genres', []))
        
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
            
            # Keyword blacklist: resolve keywords to TMDB keyword IDs, then use without_keywords
            if kwargs.get('keyword_blacklist'):
                kw_ids = self._resolve_keyword_ids(kwargs['keyword_blacklist'], api_key)
                if kw_ids:
                    params['without_keywords'] = '|'.join(str(k) for k in kw_ids)
            
            # Certification filter (US ratings)
            if kwargs.get('certification_lte'):
                params['certification_country'] = 'US'
                params['certification.lte'] = kwargs['certification_lte']
            
            logger.debug(f"Fetching movies from TMDB - Page: {page}, Sort: {params['sort_by']}")

            from src.primary.utils.tmdb_metadata_cache import get_discover, set_discover

            cache_params = {k: v for k, v in params.items() if k != 'api_key'}
            data = get_discover('movie', cache_params)
            if data is None:
                response = requests.get(url, params=params, timeout=10)
                response.raise_for_status()
                data = response.json()
                set_discover('movie', cache_params, data)

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
            
            logger.debug(f"Found {len(all_results)} movies on page {page}")
            
            # Check library status for all items - pass instance info if available from kwargs
            app_type = kwargs.get('app_type', 'radarr')
            instance_name = kwargs.get('instance_name')
            
            if instance_name:
                logger.debug(f"Checking library status for {app_type} instance: {instance_name}")
                all_results = self.check_library_status_batch(all_results, app_type, instance_name)
            else:
                # No instance specified, check all instances (old behavior)
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
        blacklisted_tv = _safe_int_list(blacklisted.get('blacklisted_tv_genres', []))
        
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
            
            # Keyword blacklist: resolve keywords to TMDB keyword IDs, then use without_keywords
            if kwargs.get('keyword_blacklist'):
                kw_ids = self._resolve_keyword_ids(kwargs['keyword_blacklist'], api_key)
                if kw_ids:
                    params['without_keywords'] = '|'.join(str(k) for k in kw_ids)
            
            # Certification filter (US TV ratings)
            if kwargs.get('certification_lte'):
                params['certification_country'] = 'US'
                params['certification.lte'] = kwargs['certification_lte']
            
            logger.debug(f"Fetching TV shows from TMDB - Page: {page}, Sort: {params['sort_by']}")
            logger.debug(f"TMDB Request URL: {url}")
            logger.debug(f"TMDB Request Params: {params}")

            from src.primary.utils.tmdb_metadata_cache import get_discover, set_discover

            cache_params = {k: v for k, v in params.items() if k != 'api_key'}
            data = get_discover('tv', cache_params)
            if data is None:
                response = requests.get(url, params=params, timeout=10)
                response.raise_for_status()
                data = response.json()
                set_discover('tv', cache_params, data)

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
            
            logger.debug(f"Found {len(all_results)} TV shows on page {page}")
            
            # Check library status for all items - pass instance info if available from kwargs
            app_type = kwargs.get('app_type', 'sonarr')
            instance_name = kwargs.get('instance_name')
            
            if instance_name:
                logger.debug(f"Checking library status for Sonarr instance: {instance_name}")
                all_results = self.check_library_status_batch(all_results, app_type, instance_name)
            else:
                # No instance specified, check all instances (old behavior)
                all_results = self.check_library_status_batch(all_results)
            
            return all_results
            
        except Exception as e:
            logger.error(f"Error getting popular TV: {e}")
            return []
    
    def get_media_details(self, tmdb_id: int, media_type: str) -> Dict[str, Any]:
        """Get detailed information about a movie or TV show. Uses smart TMDB metadata cache."""
        try:
            from src.primary.utils.tmdb_metadata_cache import get, set_movie, set_tv_series

            cached = get(media_type, tmdb_id)
            if cached is not None:
                data = cached
            else:
                api_key = self.get_tmdb_api_key()
                endpoint = "movie" if media_type == "movie" else "tv"
                url = f"{self.tmdb_base_url}/{endpoint}/{tmdb_id}"
                params = {'api_key': api_key, 'append_to_response': 'credits,videos'}

                response = requests.get(url, params=params, timeout=10)
                response.raise_for_status()
                data = response.json()
                if media_type == "movie":
                    set_movie(tmdb_id, data)
                else:
                    set_tv_series(tmdb_id, data)
            
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
            requestarr_config['blacklisted_tv_genres'] = _safe_int_list([x for x in blacklisted_tv_genres if x is not None])
            requestarr_config['blacklisted_movie_genres'] = _safe_int_list([x for x in blacklisted_movie_genres if x is not None])
            self.db.save_app_config('requestarr', requestarr_config)
            logger.info(f"Set blacklisted genres - TV: {requestarr_config['blacklisted_tv_genres']}, Movie: {requestarr_config['blacklisted_movie_genres']}")
        except Exception as e:
            logger.error(f"Error setting blacklisted genres: {e}")
            raise

    def get_watch_providers(self, media_type: str, region: str = '') -> List[Dict[str, Any]]:
        """Get watch providers for a media type and region. Cached 24h (server-side)."""
        from src.primary.utils.tmdb_metadata_cache import get_watch_providers as get_cached, set_watch_providers

        try:
            cached = get_cached(media_type, region)
            if cached is not None:
                return cached
        except Exception:
            pass
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
            try:
                set_watch_providers(media_type, region, providers)
            except Exception:
                pass
            return providers
        except Exception as e:
            logger.error(f"Error getting watch providers: {e}")
            return []
    
    def get_genres(self, media_type: str) -> List[Dict[str, Any]]:
        """Get genre list from TMDB. Cached 24h."""
        from src.primary.utils.tmdb_metadata_cache import get_genres as get_cached_genres, set_genres

        try:
            cached = get_cached_genres(media_type)
            if cached is not None:
                return cached
        except Exception:
            pass
        api_key = self.get_tmdb_api_key()
        try:
            url = f"{self.tmdb_base_url}/genre/{media_type}/list"
            params = {'api_key': api_key}
            
            response = requests.get(url, params=params, timeout=10)
            response.raise_for_status()
            data = response.json()
            genres = data.get('genres', [])
            try:
                set_genres(media_type, genres)
            except Exception:
                pass
            return genres
        except Exception as e:
            logger.error(f"Error getting genres: {e}")
            return []

    def _resolve_keyword_ids(self, keyword_blacklist: str, api_key: str) -> List[int]:
        """Resolve comma-separated keyword strings to TMDB keyword IDs via search.
        Caches results in memory for the lifetime of the process."""
        if not keyword_blacklist or not keyword_blacklist.strip():
            return []
        if not hasattr(self, '_keyword_id_cache'):
            self._keyword_id_cache = {}
        keywords = [k.strip().lower() for k in keyword_blacklist.split(',') if k.strip()]
        ids = []
        for kw in keywords:
            if kw in self._keyword_id_cache:
                ids.extend(self._keyword_id_cache[kw])
                continue
            try:
                url = f"{self.tmdb_base_url}/search/keyword"
                resp = requests.get(url, params={'api_key': api_key, 'query': kw}, timeout=10)
                if resp.status_code == 200:
                    results = resp.json().get('results', [])
                    matched = [r['id'] for r in results if r.get('name', '').lower() == kw]
                    if not matched and results:
                        matched = [results[0]['id']]
                    self._keyword_id_cache[kw] = matched
                    ids.extend(matched)
                else:
                    self._keyword_id_cache[kw] = []
            except Exception as e:
                logger.debug(f"Keyword search failed for '{kw}': {e}")
                self._keyword_id_cache[kw] = []
        return ids

    def search_media_with_availability(self, query: str, app_type: str, instance_name: str) -> List[Dict[str, Any]]:
        """Search for media using TMDB API and check availability in specified app instance. Raw TMDB cached 1h."""
        # Determine search type based on app (movie_hunt searches movies; tv_hunt searches TV)
        if app_type in ("radarr", "movie_hunt"):
            media_type = "movie"
        elif app_type in ("sonarr", "tv_hunt"):
            media_type = "tv"
        else:
            media_type = "multi"

        from src.primary.utils.tmdb_metadata_cache import get_search, set_search

        try:
            data = get_search(media_type, query)
            if data is None:
                api_key = self.get_tmdb_api_key()
                url = f"{self.tmdb_base_url}/search/{media_type}"
                params = {'api_key': api_key, 'query': query, 'include_adult': False}
                response = requests.get(url, params=params, timeout=10)
                response.raise_for_status()
                data = response.json()
                set_search(media_type, query, data)
            results = []
            
            # Get instance configuration for availability checking
            # Movie Hunt / TV Hunt instances don't use requestarr app_config, so skip
            target_instance = None
            if app_type not in ('movie_hunt', 'tv_hunt'):
                app_config = self.db.get_app_config(app_type)
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
                if app_type in ("radarr", "movie_hunt") and item_type != "movie":
                    continue
                if app_type in ("sonarr", "tv_hunt") and item_type != "tv":
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
                
                # Check availability status (skip per-item check for movie_hunt/tv_hunt — batch check handles it)
                tmdb_id = item.get('id')
                if app_type in ('movie_hunt', 'tv_hunt'):
                    availability_status = {'status': 'unknown', 'in_app': False, 'already_requested': False}
                else:
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
            
            # Check library status for all results using the specified instance
            if instance_name:
                top_results = self.check_library_status_batch(top_results, app_type, instance_name)
            else:
                top_results = self.check_library_status_batch(top_results)
            
            return top_results
            
        except Exception as e:
            logger.error(f"Error searching TMDB: {e}")
            return []

    def search_media_with_availability_stream(self, query: str, app_type: str, instance_name: str):
        """Stream search results as they become available. Raw TMDB cached 1h (server-side)."""
        from src.primary.utils.tmdb_metadata_cache import get_search, set_search

        media_type = "movie" if app_type in ("radarr", "movie_hunt") else "tv" if app_type in ("sonarr", "tv_hunt") else "multi"

        try:
            data = get_search(media_type, query)
            if data is None:
                api_key = self.get_tmdb_api_key()
                url = f"{self.tmdb_base_url}/search/{media_type}"
                params = {'api_key': api_key, 'query': query, 'include_adult': False}
                response = requests.get(url, params=params, timeout=10)
                response.raise_for_status()
                data = response.json()
                set_search(media_type, query, data)
            
            # Get instance configuration for availability checking (skip for hunt apps)
            app_config = self.db.get_app_config(app_type) if app_type not in ('movie_hunt', 'tv_hunt') else None
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
                if app_type in ("radarr", "movie_hunt") and item_type != "movie":
                    continue
                if app_type in ("sonarr", "tv_hunt") and item_type != "tv":
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
