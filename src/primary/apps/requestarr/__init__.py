"""
Requestarr module for searching and requesting media through TMDB and *arr apps
"""

import requests
import logging
from typing import Dict, List, Any, Optional
from src.primary.utils.database import get_database

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


class RequestarrAPI:
    """API handler for Requestarr functionality"""
    
    def __init__(self):
        self.db = get_database()
        self.tmdb_base_url = "https://api.themoviedb.org/3"
        self.tmdb_image_base_url = "https://image.tmdb.org/t/p/w500"
    
    def get_tmdb_api_key(self) -> str:
        """Get hardcoded TMDB API key"""
        return "9265b0bd0cd1962f7f3225989fcd7192"
    
    def get_trending(self, time_window: str = 'week', movie_instance: str = '', tv_instance: str = '', movie_app_type: str = 'radarr', tv_app_type: str = 'sonarr') -> List[Dict[str, Any]]:
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
                logger.info(f"[get_trending] Checking {len(movie_results)} movies against {movie_app_type} instance: {movie_instance}")
                movie_results = self.check_library_status_batch(movie_results, app_type=movie_app_type, instance_name=movie_instance)
            elif movie_results:
                logger.info(f"[get_trending] Checking {len(movie_results)} movies against all instances")
                movie_results = self.check_library_status_batch(movie_results)
            
            if tv_results and tv_instance:
                logger.info(f"[get_trending] Checking {len(tv_results)} TV shows against {tv_app_type} instance: {tv_instance}")
                tv_results = self.check_library_status_batch(tv_results, app_type=tv_app_type, instance_name=tv_instance)
            elif tv_results:
                logger.info(f"[get_trending] Checking {len(tv_results)} TV shows against all TV instances")
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
                logger.debug(f"Checking library status for {app_type} instance: {instance_name}")
                logger.info(f"[get_popular_movies] Calling check_library_status_batch WITH {app_type} instance: {instance_name}")
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
                    series_id = series.get('id')

                    def _extract_quality_from_episode_file(ef: dict) -> Optional[str]:
                        """Extract quality/resolution from Sonarr episodeFile. Tries multiple JSON paths."""
                        if not ef:
                            return None
                        # Try quality.quality.name, qualityQuality.name, quality.name (Sonarr/Radarr structure)
                        for qkey in ('quality', 'Quality', 'qualityQuality'):
                            q = ef.get(qkey) or {}
                            if not isinstance(q, dict):
                                continue
                            inner = q.get('quality') or q.get('Quality') or {}
                            if isinstance(inner, dict):
                                name = (inner.get('name') or inner.get('Name') or '').strip()
                                if name:
                                    return name
                            name = (q.get('name') or q.get('Name') or '').strip()
                            if name:
                                return name
                        # Fallback: parse from filename (relativePath, path)
                        import os
                        fpath = ef.get('relativePath') or ef.get('path') or ef.get('RelativePath') or ef.get('Path') or ''
                        if fpath:
                            from src.primary.routes.media_hunt.helpers import _extract_quality_from_filename
                            fname = os.path.basename(str(fpath))
                            parsed = _extract_quality_from_filename(fname)
                            if parsed and parsed != '-':
                                return parsed
                        return None

                    # Fetch episode-level details (status, quality) for per-episode display
                    seasons_with_episodes = []
                    try:
                        ep_resp = requests.get(
                            f"{sonarr_url}/api/v3/episode",
                            params={"seriesId": series_id},
                            headers=headers,
                            timeout=15
                        )
                        if ep_resp.status_code == 200:
                            all_episodes = ep_resp.json()
                            # Fetch episode files for quality via GET /api/v3/episodefile?seriesId=X
                            episode_id_to_quality = {}
                            try:
                                ef_resp = requests.get(
                                    f"{sonarr_url}/api/v3/episodefile",
                                    params={"seriesId": series_id},
                                    headers=headers,
                                    timeout=15
                                )
                                if ef_resp.status_code == 200:
                                    episode_files = ef_resp.json()
                                    files_list = episode_files if isinstance(episode_files, list) else ([episode_files] if episode_files else [])
                                    for ef_item in files_list:
                                        q = _extract_quality_from_episode_file(ef_item)
                                        if q:
                                            eids = ef_item.get('episodeIds')
                                            if not eids and ef_item.get('episodeId') is not None:
                                                eids = [ef_item.get('episodeId')]
                                            for eid in (eids or []):
                                                if eid is not None:
                                                    episode_id_to_quality[eid] = q
                            except Exception as ef_err:
                                logger.debug(f"Sonarr episodefile fetch for series {series_id}: {ef_err}")
                            by_season = {}
                            per_episode_fetch_count = 0
                            max_per_episode_fetches = 100  # cap to avoid hammering API on huge series
                            for ep in all_episodes:
                                sn = ep.get('seasonNumber')
                                if sn is None:
                                    continue
                                if sn not in by_season:
                                    by_season[sn] = []
                                ef = ep.get('episodeFile') or {}
                                qname = _extract_quality_from_episode_file(ef)
                                if not qname and ep.get('hasFile') and ep.get('id'):
                                    qname = episode_id_to_quality.get(ep['id'])
                                # Fallback: episode has episodeFile.id but no quality - fetch file directly
                                if not qname and ep.get('hasFile') and ef and per_episode_fetch_count < max_per_episode_fetches:
                                    ef_id = ef.get('id') or ef.get('Id')
                                    if ef_id is not None:
                                        try:
                                            per_episode_fetch_count += 1
                                            efr = requests.get(
                                                f"{sonarr_url}/api/v3/episodefile/{ef_id}",
                                                headers=headers,
                                                timeout=5
                                            )
                                            if efr.status_code == 200:
                                                qname = _extract_quality_from_episode_file(efr.json())
                                        except Exception:
                                            pass
                                by_season[sn].append({
                                    'season_number': sn,
                                    'seasonNumber': sn,
                                    'episode_number': ep.get('episodeNumber'),
                                    'episodeNumber': ep.get('episodeNumber'),
                                    'title': ep.get('title') or ep.get('name') or '',
                                    'name': ep.get('title') or ep.get('name') or '',
                                    'air_date': ep.get('airDate') or '',
                                    'airDate': ep.get('airDate') or '',
                                    'status': 'available' if ep.get('hasFile') else 'missing',
                                    'episodeFile': ef if ep.get('hasFile') else None,
                                    'quality': qname if qname else None,
                                })
                            for sn in sorted(by_season.keys()):
                                eps_sorted = sorted(by_season[sn], key=lambda e: (e.get('episode_number') or 0), reverse=True)
                                seasons_with_episodes.append({
                                    'season_number': sn,
                                    'seasonNumber': sn,
                                    'episodes': eps_sorted,
                                })
                    except Exception as ep_err:
                        logger.warning(f"Sonarr episode fetch for series {series_id} failed (no per-episode status): {ep_err}")
                        seasons_with_episodes = []  # Avoid series.get('seasons') - lacks episode-level status/quality

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
                    
                    path_val = (series.get('path') or series.get('Path') or series.get('rootFolderPath') or series.get('RootFolderPath') or '').strip()
                    return {
                        'exists': True,
                        'monitored': series.get('monitored', False),
                        'path': path_val,
                        'root_folder_path': path_val,
                        'total_episodes': total_episodes,
                        'available_episodes': available_episodes,
                        'missing_episodes': missing_episodes,
                        'previously_requested': previously_requested,
                        'cooldown_status': cooldown_status,
                        'seasons': seasons_with_episodes,
                    }
            
            logger.info(f"Series with TMDB ID {tmdb_id} not found in Sonarr")
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

    def trigger_sonarr_season_search(self, tmdb_id: int, instance_name: str, season_number: int) -> Dict[str, Any]:
        """Trigger Sonarr SeasonSearch command for a series/season. Series must exist in Sonarr."""
        try:
            app_config = self.db.get_app_config('sonarr')
            if not app_config or not app_config.get('instances'):
                return {'success': False, 'message': 'No Sonarr instance configured'}
            target = next((i for i in app_config['instances'] if (i.get('name') or '').strip() == instance_name), None)
            if not target:
                return {'success': False, 'message': f'Sonarr instance "{instance_name}" not found'}
            url = (target.get('api_url') or target.get('url') or '').rstrip('/')
            api_key = (target.get('api_key') or '').strip()
            if not url or not api_key:
                return {'success': False, 'message': 'Invalid Sonarr instance configuration'}
            headers = {'X-Api-Key': api_key}
            resp = requests.get(f"{url}/api/v3/series", headers=headers, timeout=10)
            if resp.status_code != 200:
                return {'success': False, 'message': 'Failed to reach Sonarr'}
            for s in resp.json():
                if s.get('tmdbId') == tmdb_id:
                    series_id = s.get('id')
                    if series_id is None:
                        break
                    from src.primary.apps.sonarr.api import search_season
                    cmd_id = search_season(url, api_key, 15, series_id, season_number)
                    if cmd_id:
                        return {'success': True, 'message': 'Season search started'}
                    return {'success': False, 'message': 'Failed to trigger season search'}
            return {'success': False, 'message': 'Series not in Sonarr. Add it first.'}
        except Exception as e:
            logger.error(f"Sonarr season search error: {e}")
            return {'success': False, 'message': str(e) or 'Request failed'}

    def trigger_sonarr_episode_search(self, tmdb_id: int, instance_name: str, season_number: int, episode_number: int) -> Dict[str, Any]:
        """Trigger Sonarr EpisodeSearch command for a specific episode. Series must exist in Sonarr."""
        try:
            app_config = self.db.get_app_config('sonarr')
            if not app_config or not app_config.get('instances'):
                return {'success': False, 'message': 'No Sonarr instance configured'}
            target = next((i for i in app_config['instances'] if (i.get('name') or '').strip() == instance_name), None)
            if not target:
                return {'success': False, 'message': f'Sonarr instance "{instance_name}" not found'}
            url = (target.get('api_url') or target.get('url') or '').rstrip('/')
            api_key = (target.get('api_key') or '').strip()
            if not url or not api_key:
                return {'success': False, 'message': 'Invalid Sonarr instance configuration'}
            headers = {'X-Api-Key': api_key}
            resp = requests.get(f"{url}/api/v3/series", headers=headers, timeout=10)
            if resp.status_code != 200:
                return {'success': False, 'message': 'Failed to reach Sonarr'}
            series_id = None
            for s in resp.json():
                if s.get('tmdbId') == tmdb_id:
                    series_id = s.get('id')
                    break
            if series_id is None:
                return {'success': False, 'message': 'Series not in Sonarr. Add it first.'}
            ep_resp = requests.get(f"{url}/api/v3/episode", params={"seriesId": series_id}, headers=headers, timeout=15)
            if ep_resp.status_code != 200:
                return {'success': False, 'message': 'Failed to fetch episodes'}
            for ep in ep_resp.json():
                if ep.get('seasonNumber') == season_number and ep.get('episodeNumber') == episode_number:
                    ep_id = ep.get('id')
                    if ep_id is not None:
                        from src.primary.apps.sonarr.api import search_episode
                        cmd_id = search_episode(url, api_key, 15, [ep_id])
                        if cmd_id:
                            return {'success': True, 'message': 'Episode search started'}
                        return {'success': False, 'message': 'Failed to trigger episode search'}
                    break
            return {'success': False, 'message': 'Episode not found in Sonarr'}
        except Exception as e:
            logger.error(f"Sonarr episode search error: {e}")
            return {'success': False, 'message': str(e) or 'Request failed'}

    def get_series_status_from_tv_hunt(self, tmdb_id: int, instance_name: str) -> Dict[str, Any]:
        """Get series status from TV Hunt collection - exists, missing episodes, etc."""
        try:
            cooldown_hours = self.get_cooldown_hours()
            cooldown_status = self.db.get_request_cooldown_status(tmdb_id, 'tv', 'tv_hunt', instance_name, cooldown_hours)
            already_requested_in_db = cooldown_status['last_requested_at'] is not None

            instance_id = self._resolve_tv_hunt_instance_id(instance_name)
            if instance_id is None:
                return {'exists': False, 'previously_requested': already_requested_in_db, 'cooldown_status': cooldown_status}

            from src.primary.routes.media_hunt.discovery_tv import _get_collection_config
            from src.primary.routes.media_hunt.helpers import _extract_quality_from_filename
            collection = _get_collection_config(instance_id)
            for s in collection:
                if s.get('tmdb_id') == tmdb_id:
                    seasons_raw = s.get('seasons') or []
                    total_eps = 0
                    available_eps = 0
                    seasons = []
                    for sec in seasons_raw:
                        eps = sec.get('episodes') or []
                        total_eps += len(eps)
                        eps_enriched = []
                        for ep in eps:
                            has_file = (ep.get('status') or '').lower() == 'available' or ep.get('file_path')
                            if has_file:
                                available_eps += 1
                            ep_copy = dict(ep)
                            file_path = ep.get('file_path')
                            if file_path:
                                import os
                                fname = os.path.basename(file_path)
                                q = _extract_quality_from_filename(fname)
                                if q and q != '-':
                                    ep_copy['quality'] = q
                            eps_enriched.append(ep_copy)
                        seasons.append(dict(sec, episodes=eps_enriched))
                    missing_eps = total_eps - available_eps
                    previously_requested = already_requested_in_db or (total_eps > 0 and available_eps == 0)
                    return {
                        'exists': True,
                        'total_episodes': total_eps,
                        'available_episodes': available_eps,
                        'missing_episodes': missing_eps,
                        'previously_requested': previously_requested,
                        'cooldown_status': cooldown_status,
                        'seasons': seasons
                    }
            return {'exists': False, 'previously_requested': already_requested_in_db, 'cooldown_status': cooldown_status}
        except Exception as e:
            logger.error(f"Error getting series status from TV Hunt: {e}")
            cooldown_hours = self.get_cooldown_hours()
            cooldown_status = self.db.get_request_cooldown_status(tmdb_id, 'tv', 'tv_hunt', instance_name, cooldown_hours)
            return {'exists': False, 'previously_requested': False, 'cooldown_status': cooldown_status}

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

    def get_radarr_movie_detail_status(self, tmdb_id: int, instance_name: str) -> Dict[str, Any]:
        """Get movie detail for Requestarr info bar: path, status, quality_profile, file_size (same shape as Movie Hunt movie-status)."""
        try:
            app_config = self.db.get_app_config('radarr')
            if not app_config or not app_config.get('instances'):
                return {'success': True, 'found': False}

            target_instance = None
            for instance in app_config['instances']:
                if instance.get('name') == instance_name:
                    target_instance = instance
                    break

            if not target_instance:
                return {'success': True, 'found': False}

            radarr_url = (target_instance.get('api_url') or target_instance.get('url') or '').rstrip('/')
            radarr_api_key = (target_instance.get('api_key') or '').strip()
            if not radarr_url or not radarr_api_key:
                return {'success': True, 'found': False}

            headers = {'X-Api-Key': radarr_api_key}
            response = requests.get(f"{radarr_url}/api/v3/movie", headers=headers, timeout=10)
            if response.status_code != 200:
                logger.error("Radarr movie list failed: %s", response.status_code)
                return {'success': False, 'found': False}

            movies_list = response.json()
            for movie in movies_list:
                if movie.get('tmdbId') != tmdb_id:
                    continue
                has_file = movie.get('hasFile', False)
                movie_file = movie.get('movieFile') or {}
                path = (movie_file.get('path') or movie_file.get('relativePath') or '').strip() or '-'
                file_size = movie_file.get('size') or 0
                quality_profile = '-'
                quality_profile_obj = movie.get('qualityProfile')
                if isinstance(quality_profile_obj, dict) and quality_profile_obj.get('name'):
                    quality_profile = quality_profile_obj['name']
                elif has_file:
                    q = (movie_file.get('quality') or {}).get('quality')
                    if isinstance(q, dict) and q.get('name'):
                        quality_profile = q['name']

                if has_file:
                    status = 'downloaded'
                else:
                    status = 'missing'  # in Radarr but no file -> requested

                return {
                    'success': True,
                    'found': True,
                    'path': path,
                    'status': status,
                    'quality_profile': quality_profile,
                    'file_size': file_size,
                }

            return {'success': True, 'found': False}
        except Exception as e:
            logger.error("Error getting Radarr movie detail: %s", e)
            return {'success': False, 'found': False}

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
            from src.primary.routes.media_hunt.discovery_movie import _get_collection_config
            items = _get_collection_config(instance_id)
            
            movie = None
            for item in items:
                if item.get('tmdb_id') == tmdb_id:
                    movie = item
                    break
            
            if not movie:
                # Also check detected movies from root folders
                try:
                    from src.primary.routes.media_hunt.storage import get_detected_movies_from_all_roots
                    detected = get_detected_movies_from_all_roots(instance_id)
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
            app_type: Optional app type to check (radarr/sonarr/movie_hunt). If None, checks all instances.
            instance_name: Optional instance name to check. If None, checks all instances.
        """
        try:
            # Get enabled instances
            instances = self.get_enabled_instances()
            
            if not instances['radarr'] and not instances['sonarr'] and not instances.get('movie_hunt') and not instances.get('tv_hunt'):
                # No instances configured, mark all as not in library
                for item in items:
                    item['in_library'] = False
                    item['partial'] = False
                    item['in_cooldown'] = False
                return items
            
            # Filter instances based on app_type and instance_name if provided
            radarr_instances = instances['radarr']
            sonarr_instances = instances['sonarr']
            movie_hunt_instances = instances.get('movie_hunt', [])
            tv_hunt_instances = instances.get('tv_hunt', [])
            use_movie_hunt = False
            use_tv_hunt = False
            
            if app_type and instance_name:
                logger.info(f"Filtering instances - app_type: {app_type}, instance_name: {instance_name}")
                if app_type == 'movie_hunt':
                    # Movie Hunt handles movies — skip Radarr, Sonarr, TV Hunt
                    movie_hunt_instances = [inst for inst in movie_hunt_instances if inst['name'] == instance_name]
                    radarr_instances = []
                    sonarr_instances = []
                    tv_hunt_instances = []
                    use_movie_hunt = True
                    logger.info(f"Using Movie Hunt instance: {[inst['name'] for inst in movie_hunt_instances]}")
                elif app_type == 'tv_hunt':
                    # TV Hunt handles TV — skip Sonarr, Radarr
                    tv_hunt_instances = [inst for inst in tv_hunt_instances if inst['name'] == instance_name]
                    sonarr_instances = []
                    radarr_instances = []
                    movie_hunt_instances = []
                    use_tv_hunt = True
                    logger.info(f"Using TV Hunt instance: {[inst['name'] for inst in tv_hunt_instances]}")
                elif app_type == 'radarr':
                    original_count = len(radarr_instances)
                    radarr_instances = [inst for inst in radarr_instances if inst['name'] == instance_name]
                    sonarr_instances = []
                    tv_hunt_instances = []
                    movie_hunt_instances = []
                    logger.info(f"Filtered Radarr instances from {original_count} to {len(radarr_instances)}: {[inst['name'] for inst in radarr_instances]}")
                elif app_type == 'sonarr':
                    original_count = len(sonarr_instances)
                    sonarr_instances = [inst for inst in sonarr_instances if inst['name'] == instance_name]
                    radarr_instances = []
                    tv_hunt_instances = []
                    movie_hunt_instances = []
                    logger.info(f"Filtered Sonarr instances from {original_count} to {len(sonarr_instances)}: {[inst['name'] for inst in sonarr_instances]}")
            else:
                logger.info(f"No instance filtering - checking all instances (Radarr: {len(radarr_instances)}, Sonarr: {len(sonarr_instances)}, Movie Hunt: {len(movie_hunt_instances)}, TV Hunt: {len(tv_hunt_instances)})")
            
            # Get all movies from Movie Hunt instances (batch check)
            movie_hunt_tmdb_ids = set()
            if use_movie_hunt or (not app_type and movie_hunt_instances):
                import os as _os
                for mh_inst in movie_hunt_instances:
                    try:
                        mh_instance_id = mh_inst.get('id')
                        if mh_instance_id is None:
                            mh_instance_id = self._resolve_movie_hunt_instance_id(mh_inst['name'])
                        if mh_instance_id is None:
                            continue
                        from src.primary.routes.media_hunt.discovery_movie import _get_collection_config
                        collection_items = _get_collection_config(mh_instance_id)
                        for ci in collection_items:
                            tmdb_id = ci.get('tmdb_id')
                            if not tmdb_id:
                                continue
                            status_raw = (ci.get('status') or '').lower()
                            file_path = (ci.get('file_path') or '').strip()
                            has_file = False
                            if file_path and _os.path.isfile(file_path):
                                has_file = True
                            elif status_raw == 'available':
                                has_file = True
                            if has_file:
                                movie_hunt_tmdb_ids.add(tmdb_id)
                        # Also check detected movies from root folders
                        try:
                            from src.primary.routes.media_hunt.storage import get_detected_movies_from_all_roots
                            detected = get_detected_movies_from_all_roots(mh_instance_id)
                            for d in detected:
                                dtmdb = d.get('tmdb_id')
                                if dtmdb:
                                    movie_hunt_tmdb_ids.add(dtmdb)
                        except Exception:
                            pass
                        logger.info(f"Found {len(movie_hunt_tmdb_ids)} movies in Movie Hunt instance {mh_inst['name']}")
                    except Exception as e:
                        logger.error(f"Error checking Movie Hunt instance {mh_inst.get('name', '?')}: {e}")
            
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
            
            # Get all series from filtered TV Hunt instances
            tv_hunt_tmdb_ids = set()
            tv_hunt_partial_tmdb_ids = set()
            if use_tv_hunt or (not app_type and tv_hunt_instances):
                for th_inst in tv_hunt_instances:
                    try:
                        th_instance_id = th_inst.get('id')
                        if th_instance_id is None:
                            th_instance_id = self._resolve_tv_hunt_instance_id(th_inst['name'])
                        if th_instance_id is None:
                            continue
                        from src.primary.routes.media_hunt.discovery_tv import _get_collection_config
                        collection = _get_collection_config(th_instance_id)
                        for s in collection:
                            tmdb_id = s.get('tmdb_id')
                            if not tmdb_id:
                                continue
                            # Check if complete (all episodes available) or partial
                            seasons = s.get('seasons') or []
                            total_eps = 0
                            available_eps = 0
                            for sec in seasons:
                                eps = (sec.get('episodes') or [])
                                total_eps += len(eps)
                                for ep in eps:
                                    if (ep.get('status') or '').lower() == 'available' or ep.get('file_path'):
                                        available_eps += 1
                            if total_eps > 0 and available_eps == total_eps:
                                tv_hunt_tmdb_ids.add(tmdb_id)
                            elif available_eps > 0:
                                tv_hunt_partial_tmdb_ids.add(tmdb_id)
                            else:
                                tv_hunt_tmdb_ids.add(tmdb_id)  # In collection = in library
                        logger.info(f"Found {len(tv_hunt_tmdb_ids)} series in TV Hunt instance {th_inst['name']}")
                    except Exception as e:
                        logger.error(f"Error checking TV Hunt instance {th_inst.get('name', '?')}: {e}")
            
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
            cooldown_hours = self.get_cooldown_hours()
            for item in items:
                tmdb_id = item.get('tmdb_id')
                media_type = item.get('media_type')
                
                # Check cooldown status for the specified instance or all instances
                item['in_cooldown'] = False
                
                if app_type and instance_name:
                    # Check only the specified instance
                    cooldown_status = self.db.get_request_cooldown_status(tmdb_id, media_type, app_type, instance_name, cooldown_hours)
                    item['in_cooldown'] = cooldown_status['in_cooldown']
                else:
                    # Check ALL instances for cooldown (old behavior)
                    if media_type == 'movie':
                        # Check Radarr instances
                        for instance in instances['radarr']:
                            instance_name_check = instance['name']
                            cooldown_status = self.db.get_request_cooldown_status(tmdb_id, media_type, 'radarr', instance_name_check, cooldown_hours)
                            if cooldown_status['in_cooldown']:
                                item['in_cooldown'] = True
                                break
                        # Also check Movie Hunt instances
                        if not item['in_cooldown']:
                            for mh_inst in instances.get('movie_hunt', []):
                                cooldown_status = self.db.get_request_cooldown_status(tmdb_id, media_type, 'movie_hunt', mh_inst['name'], cooldown_hours)
                                if cooldown_status['in_cooldown']:
                                    item['in_cooldown'] = True
                                    break
                    elif media_type == 'tv':
                        for instance in instances.get('sonarr', []):
                            instance_name_check = instance['name']
                            cooldown_status = self.db.get_request_cooldown_status(tmdb_id, media_type, 'sonarr', instance_name_check, cooldown_hours)
                            if cooldown_status['in_cooldown']:
                                item['in_cooldown'] = True
                                break
                        if not item['in_cooldown']:
                            for th_inst in instances.get('tv_hunt', []):
                                cooldown_status = self.db.get_request_cooldown_status(tmdb_id, media_type, 'tv_hunt', th_inst['name'], cooldown_hours)
                                if cooldown_status['in_cooldown']:
                                    item['in_cooldown'] = True
                                    break
                
                # Set library status
                if media_type == 'movie':
                    # Check Movie Hunt first (if applicable), then Radarr
                    item['in_library'] = tmdb_id in movie_hunt_tmdb_ids or tmdb_id in radarr_tmdb_ids
                    item['partial'] = False
                elif media_type == 'tv':
                    item['in_library'] = tmdb_id in sonarr_tmdb_ids or tmdb_id in tv_hunt_tmdb_ids
                    item['partial'] = tmdb_id in sonarr_partial_tmdb_ids or tmdb_id in tv_hunt_partial_tmdb_ids
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
            # TV Hunt profiles come from internal database
            if app_type == 'tv_hunt':
                return self._get_tv_hunt_quality_profiles(instance_name)
            
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
            
            from src.primary.routes.media_hunt.helpers import _movie_profiles_context
            from src.primary.routes.media_hunt.profiles import get_profiles_config
            profiles = get_profiles_config(instance_id, _movie_profiles_context())
            
            # Return in same format as Radarr/Sonarr profiles (id + name)
            # Movie Hunt profiles use name-based identification, so use name as both id and name
            # Include is_default flag so frontend can pre-select the correct profile
            result = []
            for i, profile in enumerate(profiles):
                profile_name = (profile.get('name') or '').strip()
                if profile_name:
                    result.append({
                        'id': profile_name,  # Movie Hunt uses names, not integer IDs
                        'name': profile_name,
                        'is_default': bool(profile.get('is_default', False))
                    })
            return result
        except Exception as e:
            logger.error(f"Error getting Movie Hunt quality profiles for '{instance_name}': {e}")
            return []
    
    def _get_tv_hunt_quality_profiles(self, instance_name: str) -> List[Dict[str, Any]]:
        """Get quality profiles from a TV Hunt instance (internal database)"""
        try:
            instance_id = self._resolve_tv_hunt_instance_id(instance_name)
            if instance_id is None:
                logger.warning(f"TV Hunt instance '{instance_name}' not found")
                return []
            from src.primary.routes.media_hunt.helpers import _tv_profiles_context
            from src.primary.routes.media_hunt.profiles import get_profiles_config
            profiles = get_profiles_config(instance_id, _tv_profiles_context())
            result = []
            for profile in profiles:
                profile_name = (profile.get('name') or '').strip()
                if profile_name:
                    result.append({
                        'id': profile_name,
                        'name': profile_name,
                        'is_default': bool(profile.get('is_default', False))
                    })
            return result
        except Exception as e:
            logger.error(f"Error getting TV Hunt quality profiles for '{instance_name}': {e}")
            return []
    
    def _resolve_movie_hunt_instance_id(self, instance_name: str) -> Optional[int]:
        """Resolve a Movie Hunt instance name to its database ID"""
        try:
            name = (instance_name or '').strip()
            if not name:
                return None
            mh_instances = self.db.get_movie_hunt_instances()
            for inst in mh_instances:
                if (inst.get('name') or '').strip() == name:
                    return inst.get('id')
            return None
        except Exception as e:
            logger.error(f"Error resolving Movie Hunt instance '{instance_name}': {e}")
            return None
    
    def _resolve_tv_hunt_instance_id(self, instance_name: str) -> Optional[int]:
        """Resolve a TV Hunt instance name to its database ID"""
        try:
            name = (instance_name or '').strip()
            if not name:
                return None
            th_instances = self.db.get_tv_hunt_instances()
            for inst in th_instances:
                if (inst.get('name') or '').strip() == name:
                    return inst.get('id')
            return None
        except Exception as e:
            logger.error(f"Error resolving TV Hunt instance '{instance_name}': {e}")
            return None
    
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
            requestarr_config['blacklisted_tv_genres'] = _safe_int_list([x for x in blacklisted_tv_genres if x is not None])
            requestarr_config['blacklisted_movie_genres'] = _safe_int_list([x for x in blacklisted_movie_genres if x is not None])
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

    def get_modal_preferences(self) -> Dict[str, Any]:
        """Get user preferences for the request modal (e.g. start_search, minimum_availability)"""
        try:
            requestarr_config = self.db.get_app_config('requestarr') or {}
            return requestarr_config.get('modal_preferences', {
                'start_search': True,
                'minimum_availability': 'released',
                'movie_instance': '',
                'tv_instance': ''
            })
        except Exception as e:
            logger.error(f"Error getting modal preferences: {e}")
            return {'start_search': True, 'minimum_availability': 'released', 'movie_instance': '', 'tv_instance': ''}

    def set_modal_preferences(self, preferences: Dict[str, Any]):
        """Set user preferences for the request modal"""
        try:
            requestarr_config = self.db.get_app_config('requestarr') or {}
            current_prefs = requestarr_config.get('modal_preferences', {})
            current_prefs.update(preferences)
            requestarr_config['modal_preferences'] = current_prefs
            self.db.save_app_config('requestarr', requestarr_config)
            logger.info(f"Updated modal preferences: {preferences}")
        except Exception as e:
            logger.error(f"Error setting modal preferences: {e}")
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
        """Fetch root folders from *arr or Movie/TV Hunt instance (for settings UI, issue #806). Deduped by ID and path."""
        if app_type == 'movie_hunt':
            return self._get_movie_hunt_root_folders(instance_name)
        if app_type == 'tv_hunt':
            return self._get_tv_hunt_root_folders(instance_name)
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
            
            from src.primary.routes.media_hunt.storage import get_movie_root_folders_config
            folders = get_movie_root_folders_config(instance_id)
            
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

    def _get_tv_hunt_root_folders(self, instance_name: str) -> List[Dict[str, Any]]:
        """Get root folders from a TV Hunt instance (internal database)"""
        try:
            instance_id = self._resolve_tv_hunt_instance_id(instance_name)
            if instance_id is None:
                logger.warning(f"TV Hunt instance '{instance_name}' not found")
                return []
            from src.primary.routes.media_hunt.storage import get_tv_root_folders_config
            folders = get_tv_root_folders_config(instance_id)
            import os
            result = []
            for folder in folders:
                path = (folder.get('path') or '').strip()
                if not path:
                    continue
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
            logger.error(f"Error getting TV Hunt root folders for '{instance_name}': {e}")
            return []

    def get_root_folders_by_id(self, instance_id: int) -> List[Dict[str, Any]]:
        """Get root folders from a Movie Hunt instance by ID (for modal when instance_id is known)."""
        try:
            from src.primary.routes.media_hunt.storage import get_movie_root_folders_config
            folders = get_movie_root_folders_config(instance_id)
            import os
            result = []
            for folder in folders:
                path = (folder.get('path') or '').strip()
                if not path:
                    continue
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
            logger.error(f"Error getting Movie Hunt root folders for instance_id={instance_id}: {e}")
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
        
        # Determine search type based on app (movie_hunt searches movies; tv_hunt searches TV)
        if app_type in ("radarr", "movie_hunt"):
            media_type = "movie"
        elif app_type in ("sonarr", "tv_hunt"):
            media_type = "tv"
        else:
            media_type = "multi"
        
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
        """Stream search results as they become available"""
        api_key = self.get_tmdb_api_key()
        
        # Determine search type based on app
        media_type = "movie" if app_type in ("radarr", "movie_hunt") else "tv" if app_type in ("sonarr", "tv_hunt") else "multi"
        
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
        """Get enabled and properly configured Sonarr, Radarr, Movie Hunt, and TV Hunt instances"""
        instances = {'sonarr': [], 'radarr': [], 'movie_hunt': [], 'tv_hunt': []}
        seen_names = {'sonarr': set(), 'radarr': set(), 'movie_hunt': set(), 'tv_hunt': set()}
        
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
            
            # Get TV Hunt instances (from dedicated database table)
            try:
                th_instances = self.db.get_tv_hunt_instances()
                for inst in th_instances:
                    name = (inst.get('name') or '').strip()
                    if not name:
                        continue
                    name_lower = name.lower()
                    if name_lower not in seen_names['tv_hunt']:
                        instances['tv_hunt'].append({
                            'name': name,
                            'id': inst.get('id'),
                            'url': 'internal'
                        })
                        seen_names['tv_hunt'].add(name_lower)
            except Exception as e:
                logger.warning(f"Error loading TV Hunt instances: {e}")
            
            return instances
            
        except Exception as e:
            logger.error(f"Error getting enabled instances: {e}")
            return {'sonarr': [], 'radarr': [], 'movie_hunt': [], 'tv_hunt': []}
    
    def request_media(self, tmdb_id: int, media_type: str, title: str, year: int,
                     overview: str, poster_path: str, backdrop_path: str,
                     app_type: str, instance_name: str, quality_profile_id: int = None,
                     root_folder_path: str = None, quality_profile_name: str = None,
                     start_search: bool = True, minimum_availability: str = 'released') -> Dict[str, Any]:
        """Request media through the specified app instance"""
        try:
            # Movie Hunt has its own request pipeline (add to library, optionally start search)
            if app_type == 'movie_hunt':
                return self._request_media_via_movie_hunt(
                    tmdb_id=tmdb_id, title=title, year=year,
                    overview=overview, poster_path=poster_path,
                    backdrop_path=backdrop_path, instance_name=instance_name,
                    quality_profile_name=quality_profile_name,
                    root_folder_path=root_folder_path, media_type=media_type,
                    start_search=start_search, minimum_availability=minimum_availability or 'released'
                )
            
            # TV Hunt has its own request pipeline (add to collection, optionally start search)
            if app_type == 'tv_hunt':
                return self._request_media_via_tv_hunt(
                    tmdb_id=tmdb_id, title=title,
                    overview=overview, poster_path=poster_path,
                    backdrop_path=backdrop_path, instance_name=instance_name,
                    quality_profile_name=quality_profile_name,
                    root_folder_path=root_folder_path,
                    start_search=start_search
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
                add_result = self._add_media_to_app(tmdb_id, media_type, target_instance, app_type, quality_profile_id, root_folder_path, minimum_availability=minimum_availability)
                
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
                                      root_folder_path: str = None, media_type: str = 'movie',
                                      start_search: bool = True, minimum_availability: str = 'released') -> Dict[str, Any]:
        """Add movie to Movie Hunt library; optionally start search (indexers -> download client)."""
        try:
            # Resolve instance ID
            instance_id = self._resolve_movie_hunt_instance_id(instance_name)
            if instance_id is None:
                return {
                    'success': False,
                    'message': f'Movie Hunt instance "{instance_name}" not found',
                    'status': 'instance_not_found'
                }
            
            # Check if movie already in library (by status lookup)
            status = self.get_movie_status_from_movie_hunt(tmdb_id, instance_name)
            if status.get('in_library'):
                return {
                    'success': False,
                    'message': f'{title} is already in your library for this instance.',
                    'status': 'already_exists'
                }
            
            year_str = str(year).strip() if year else ''
            poster_path_str = (poster_path or '').strip() or None
            root_folder = (root_folder_path or '').strip() or None
            quality_profile = (quality_profile_name or '').strip() or None
            min_avail = (minimum_availability or '').strip() or 'released'
            
            # Add to library only (no search): append to collection and return
            if not start_search:
                from src.primary.routes.media_hunt.discovery_movie import _collection_append
                _collection_append(
                    title=title, year=year_str, instance_id=instance_id,
                    tmdb_id=tmdb_id, poster_path=poster_path_str, root_folder=root_folder,
                    quality_profile=quality_profile, minimum_availability=min_avail
                )
                return {
                    'success': True,
                    'message': f'"{title}" added to Movie Hunt \u2013 {instance_name}.',
                    'status': 'added'
                }
            
            # Check cooldown before starting search
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
                    'message': f'{title} was recently requested. Please wait {time_msg} before searching again.',
                    'status': 'in_cooldown',
                    'hours_remaining': hours_remaining
                }
            
            # Build request data for Movie Hunt's internal search+download pipeline
            # We call the discovery module's internal functions directly
            from src.primary.routes.media_hunt.discovery_movie import _get_collection_config
            from src.primary.routes.media_hunt.indexers import _get_indexers_config, _resolve_indexer_api_url
            from src.primary.routes.media_hunt.helpers import _movie_profiles_context
            from src.primary.routes.media_hunt.profiles import get_profile_by_name_or_default, best_result_matching_profile
            from src.primary.routes.media_hunt.clients import get_movie_clients_config
            from src.primary.routes.media_hunt.helpers import (
                _get_blocklist_source_titles, _blocklist_normalize_source_title,
                _add_requested_queue_id, MOVIE_HUNT_DEFAULT_CATEGORY
            )
            from src.primary.routes.media_hunt.discovery_movie import (
                _search_newznab_movie, _add_nzb_to_download_client, _collection_append
            )
            from src.primary.settings_manager import get_ssl_verify_setting
            
            indexers = _get_indexers_config(instance_id)
            clients = get_movie_clients_config(instance_id)
            enabled_indexers = [i for i in indexers if i.get('enabled', True)]
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
            
            profile = get_profile_by_name_or_default(quality_profile_name, instance_id, _movie_profiles_context())
            verify_ssl = get_ssl_verify_setting()
            
            import time as _time
            nzb_url = None
            nzb_title = None
            indexer_used = None
            request_score = 0
            request_score_breakdown = ''
            
            # Search ALL indexers, collect results with priority (Prowlarr-like strategy)
            all_candidates = []
            blocklist_titles = _get_blocklist_source_titles(instance_id)
            min_score = profile.get('min_custom_format_score', 0)
            try:
                min_score = int(min_score)
            except (TypeError, ValueError):
                min_score = 0
            for idx in enabled_indexers:
                base_url = _resolve_indexer_api_url(idx)
                if not base_url:
                    continue
                api_key = (idx.get('api_key') or '').strip()
                if not api_key:
                    continue
                categories = idx.get('categories') or [2000, 2010, 2020, 2030, 2040, 2045, 2050, 2070]
                priority = idx.get('priority', 50)
                ih_id = idx.get('indexer_hunt_id', '')
                _search_start = _time.time()
                results = _search_newznab_movie(base_url, api_key, query, categories, timeout=15)
                _search_ms = int((_time.time() - _search_start) * 1000)
                if ih_id:
                    try:
                        from src.primary.utils.database import get_database as _get_db
                        _get_db().record_indexer_hunt_event(
                            indexer_id=ih_id, indexer_name=idx.get('name', ''),
                            event_type='search', query=query,
                            response_time_ms=_search_ms,
                            success=bool(results),
                            instance_id=instance_id, instance_name='',
                        )
                    except Exception:
                        pass
                if results:
                    if blocklist_titles:
                        results = [r for r in results if _blocklist_normalize_source_title(r.get('title')) not in blocklist_titles]
                        if not results:
                            continue
                    chosen, chosen_score, chosen_breakdown = best_result_matching_profile(
                        results, profile, instance_id, _movie_profiles_context(), runtime_minutes=runtime_minutes, return_breakdown=True
                    )
                    if chosen and chosen_score >= min_score:
                        all_candidates.append((priority, idx.get('name', ''), chosen, chosen_score, chosen_breakdown or '', ih_id))
            # Pick best: lowest priority number first, then highest score
            if all_candidates:
                all_candidates.sort(key=lambda x: (x[0], -x[3]))
                _, indexer_used, chosen, request_score, request_score_breakdown, _grab_ih_id = all_candidates[0]
                nzb_url = chosen.get('nzb_url')
                nzb_title = chosen.get('title', 'Unknown')
                if _grab_ih_id:
                    try:
                        from src.primary.utils.database import get_database as _get_db
                        _get_db().record_indexer_hunt_event(
                            indexer_id=_grab_ih_id, indexer_name=indexer_used,
                            event_type='grab', query=query,
                            result_title=nzb_title,
                            instance_id=instance_id, instance_name='',
                        )
                    except Exception:
                        pass
            
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
            ok, msg, queue_id = _add_nzb_to_download_client(client, nzb_url, nzb_title or f'{title}.nzb', request_category, verify_ssl, indexer=indexer_used or '', instance_id=instance_id)
            
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
            
            # Add to Movie Hunt collection (with quality and minimum_availability)
            _collection_append(
                title=title, year=year_str, instance_id=instance_id, tmdb_id=tmdb_id,
                poster_path=poster_path_str, root_folder=root_folder,
                quality_profile=quality_profile, minimum_availability=min_avail
            )
            
            # Save request to Requestarr's DB for cooldown tracking
            self.db.add_request(
                tmdb_id, media_type, title, year, overview,
                poster_path, backdrop_path, 'movie_hunt', instance_name
            )
            
            return {
                'success': True,
                'message': f'"{title}" sent to {client.get("name") or "download client"} via Movie Hunt \u2013 {instance_name}.',
                'status': 'requested'
            }
            
        except Exception as e:
            logger.error(f"Error requesting media via Movie Hunt: {e}", exc_info=True)
            return {
                'success': False,
                'message': f'Error requesting {title} via Movie Hunt: {str(e)}',
                'status': 'error'
            }
    
    def _request_media_via_tv_hunt(self, tmdb_id: int, title: str, overview: str = '',
                                  poster_path: str = '', backdrop_path: str = '',
                                  instance_name: str = '', quality_profile_name: str = None,
                                  root_folder_path: str = None, start_search: bool = True) -> Dict[str, Any]:
        """Add TV series to TV Hunt collection; optionally start search for season 1."""
        try:
            instance_id = self._resolve_tv_hunt_instance_id(instance_name)
            if instance_id is None:
                return {
                    'success': False,
                    'message': f'TV Hunt instance "{instance_name}" not found',
                    'status': 'instance_not_found'
                }
            status = self.get_series_status_from_tv_hunt(tmdb_id, instance_name)
            if status.get('exists'):
                return {
                    'success': False,
                    'message': f'{title} is already in your TV Hunt collection.',
                    'status': 'already_exists'
                }
            from src.primary.routes.media_hunt.discovery_tv import add_series_to_tv_hunt_collection, perform_tv_hunt_request
            root_folder = (root_folder_path or '').strip() or None
            quality_profile = (quality_profile_name or '').strip() or None
            success, msg = add_series_to_tv_hunt_collection(
                instance_id, tmdb_id, title, overview=overview or '',
                poster_path=(poster_path or '').strip() or '', backdrop_path=(backdrop_path or '').strip() or '',
                root_folder=root_folder, quality_profile=quality_profile
            )
            if not success:
                return {'success': False, 'message': msg, 'status': 'add_failed'}
            self.db.add_request(
                tmdb_id, 'tv', title, None, overview,
                (poster_path or '').strip(), (backdrop_path or '').strip(),
                'tv_hunt', instance_name
            )
            if start_search:
                search_success, search_msg = perform_tv_hunt_request(
                    instance_id, title, season_number=1,
                    root_folder=root_folder, quality_profile=quality_profile,
                    search_type='season'
                )
                if search_success:
                    return {'success': True, 'message': f'{title} added and search initiated for season 1.', 'status': 'requested'}
            return {'success': True, 'message': f'"{title}" added to TV Hunt \u2013 {instance_name}.', 'status': 'added'}
        except Exception as e:
            logger.error(f"Error requesting TV via TV Hunt: {e}", exc_info=True)
            return {'success': False, 'message': str(e), 'status': 'error'}
    
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
            
            if app_type in ('radarr', 'movie_hunt'):
                # Search for movie by TMDB ID (movie_hunt uses Radarr API)
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
    
    def _add_media_to_app(self, tmdb_id: int, media_type: str, instance: Dict[str, str], app_type: str, quality_profile_id: int = None, root_folder_path: str = None, minimum_availability: str = None) -> Dict[str, Any]:
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
                return self._add_movie_to_radarr(tmdb_id, url, api_key, quality_profile_id, root_folder_path, minimum_availability=minimum_availability)
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
    
    def _add_movie_to_radarr(self, tmdb_id: int, url: str, api_key: str, quality_profile_id: int = None, root_folder_path: str = None, minimum_availability: str = None) -> Dict[str, Any]:
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
            
            # Pass minimumAvailability to Radarr if provided (Radarr API v3 top-level field)
            # Valid values: 'announced', 'inCinemas', 'released'
            if minimum_availability and minimum_availability in ('announced', 'inCinemas', 'released'):
                add_data['minimumAvailability'] = minimum_availability
            
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