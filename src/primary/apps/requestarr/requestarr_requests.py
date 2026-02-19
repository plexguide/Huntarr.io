"""
Requestarr Requests Mixin
Media request/add operations for Radarr, Sonarr, Movie Hunt, and TV Hunt.
Extracted from requestarr/__init__.py to reduce file size.
"""

import requests
import logging
import json
import time
from typing import Dict, List, Any, Optional

logger = logging.getLogger(__name__)


class RequestsMixin:
    """Media request/add operations for Radarr, Sonarr, Movie Hunt, and TV Hunt."""

    def request_media(self, tmdb_id: int, media_type: str, title: str, year: int,
                     overview: str, poster_path: str, backdrop_path: str,
                     app_type: str, instance_name: str, quality_profile_id: int = None,
                     root_folder_path: str = None, quality_profile_name: str = None,
                     start_search: bool = True, minimum_availability: str = 'released',
                     monitor: str = None, movie_monitor: str = None) -> Dict[str, Any]:
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
                    start_search=start_search, minimum_availability=minimum_availability or 'released',
                    movie_monitor=movie_monitor
                )
            
            # TV Hunt has its own request pipeline (add to collection, optionally start search)
            if app_type == 'tv_hunt':
                return self._request_media_via_tv_hunt(
                    tmdb_id=tmdb_id, title=title,
                    overview=overview, poster_path=poster_path,
                    backdrop_path=backdrop_path, instance_name=instance_name,
                    quality_profile_name=quality_profile_name,
                    root_folder_path=root_folder_path,
                    start_search=start_search,
                    monitor=monitor
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
                                      start_search: bool = True, minimum_availability: str = 'released',
                                      movie_monitor: str = None) -> Dict[str, Any]:
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
                from src.primary.routes.media_hunt.discovery_movie import _collection_append, _get_collection_config, _save_collection_config
                _collection_append(
                    title=title, year=year_str, instance_id=instance_id,
                    tmdb_id=tmdb_id, poster_path=poster_path_str, root_folder=root_folder,
                    quality_profile=quality_profile, minimum_availability=min_avail
                )
                # Apply movie_monitor setting
                self._apply_movie_monitor(movie_monitor, tmdb_id, instance_id, root_folder, quality_profile, min_avail)
                return {
                    'success': True,
                    'message': f'"{title}" added to Movie Hunt \u2013 {instance_name}.',
                    'status': 'added'
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
            
            # Apply movie_monitor setting
            self._apply_movie_monitor(movie_monitor, tmdb_id, instance_id, root_folder, quality_profile, min_avail)
            
            # Save request to Requestarr's DB for tracking
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

    def _apply_movie_monitor(self, movie_monitor, tmdb_id, instance_id, root_folder, quality_profile, min_avail):
        """Apply movie monitor option: set monitored flag and handle collection auto-add."""
        if not movie_monitor:
            return
        
        from src.primary.routes.media_hunt.discovery_movie import (
            _get_collection_config, _save_collection_config, _collection_append,
            _get_tmdb_api_key_movie_hunt
        )
        
        # If 'none', unmonitor the just-added movie
        if movie_monitor == 'none':
            items = _get_collection_config(instance_id)
            for item in items:
                try:
                    if int(item.get('tmdb_id', 0)) == int(tmdb_id):
                        item['monitored'] = False
                        break
                except (TypeError, ValueError):
                    continue
            _save_collection_config(items, instance_id)
            logger.info(f"Movie Hunt: set movie TMDB {tmdb_id} to unmonitored")
        
        # If 'movie_and_collection', fetch TMDB collection and add all movies
        elif movie_monitor == 'movie_and_collection':
            try:
                import requests as _requests
                api_key = _get_tmdb_api_key_movie_hunt()
                if not api_key:
                    logger.warning("Movie Hunt: no TMDB API key for collection fetch")
                    return
                
                # Fetch movie details to get belongs_to_collection
                resp = _requests.get(
                    f'https://api.themoviedb.org/3/movie/{tmdb_id}',
                    params={'api_key': api_key},
                    timeout=10
                )
                if resp.status_code != 200:
                    logger.warning(f"Movie Hunt: TMDB movie fetch failed ({resp.status_code})")
                    return
                
                movie_data = resp.json()
                collection_info = movie_data.get('belongs_to_collection')
                if not collection_info or not collection_info.get('id'):
                    logger.info(f"Movie Hunt: movie TMDB {tmdb_id} has no collection")
                    return
                
                collection_id = collection_info['id']
                collection_name = collection_info.get('name', 'Unknown Collection')
                logger.info(f"Movie Hunt: fetching collection '{collection_name}' (ID {collection_id})")
                
                # Fetch collection details
                col_resp = _requests.get(
                    f'https://api.themoviedb.org/3/collection/{collection_id}',
                    params={'api_key': api_key},
                    timeout=10
                )
                if col_resp.status_code != 200:
                    logger.warning(f"Movie Hunt: TMDB collection fetch failed ({col_resp.status_code})")
                    return
                
                col_data = col_resp.json()
                parts = col_data.get('parts', [])
                added_count = 0
                for part in parts:
                    part_tmdb_id = part.get('id')
                    part_title = (part.get('title') or '').strip()
                    if not part_tmdb_id or not part_title:
                        continue
                    # Skip the movie we already added
                    if int(part_tmdb_id) == int(tmdb_id):
                        continue
                    part_year = ''
                    if part.get('release_date'):
                        try:
                            part_year = part['release_date'][:4]
                        except Exception:
                            pass
                    part_poster = part.get('poster_path') or ''
                    _collection_append(
                        title=part_title, year=part_year, instance_id=instance_id,
                        tmdb_id=part_tmdb_id, poster_path=part_poster,
                        root_folder=root_folder, quality_profile=quality_profile,
                        minimum_availability=min_avail
                    )
                    added_count += 1
                
                logger.info(f"Movie Hunt: added {added_count} movies from collection '{collection_name}'")
            except Exception as e:
                logger.error(f"Movie Hunt: error fetching TMDB collection: {e}", exc_info=True)
    
    def _request_media_via_tv_hunt(self, tmdb_id: int, title: str, overview: str = '',
                                  poster_path: str = '', backdrop_path: str = '',
                                  instance_name: str = '', quality_profile_name: str = None,
                                  root_folder_path: str = None, start_search: bool = True,
                                  monitor: str = None) -> Dict[str, Any]:
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
                root_folder=root_folder, quality_profile=quality_profile,
                monitor=monitor
            )
            if not success:
                return {'success': False, 'message': msg, 'status': 'add_failed'}
            # Merge detected episodes from disk so files already present show as available
            try:
                from src.primary.routes.media_hunt.discovery_tv import _merge_detected_episodes_into_collection
                _merge_detected_episodes_into_collection(instance_id)
            except Exception as merge_err:
                logger.warning(f"TV Hunt: episode merge after add failed: {merge_err}")
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
