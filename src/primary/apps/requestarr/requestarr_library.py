"""
Requestarr Library Mixin
Library status checks, batch status, availability, and enabled instances.
Extracted from requestarr/__init__.py to reduce file size.
"""

import requests
import logging
from typing import Dict, List, Any, Optional

logger = logging.getLogger(__name__)


class LibraryMixin:
    """Library status checks, batch status, availability, and enabled instances."""

    def get_series_status_from_sonarr(self, tmdb_id: int, instance_name: str) -> Dict[str, Any]:
        """Get series status from Sonarr - missing episodes, available, etc."""
        try:
            already_requested_in_db = self.db.is_already_requested(tmdb_id, 'tv', 'sonarr', instance_name)
            
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
                    
                    logger.info(f"Found series in Sonarr: {series.get('title')} - {available_episodes}/{total_episodes} episodes, missing: {missing_episodes}, previously_requested: {previously_requested}")
                    
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
                        'seasons': seasons_with_episodes,
                    }
            
            logger.info(f"Series with TMDB ID {tmdb_id} not found in Sonarr")
            return {
                'exists': False,
                'previously_requested': already_requested_in_db,
            }
            
        except Exception as e:
            logger.error(f"Error getting series status from Sonarr: {e}")
            return {
                'exists': False,
                'previously_requested': False,
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
        """Get series status from TV Hunt collection - exists, missing episodes, etc.
        Merges with filesystem scan (get_detected_episodes) so imported episodes show as available
        even before the importer has updated the collection."""
        try:
            import re
            import os
            already_requested_in_db = self.db.is_already_requested(tmdb_id, 'tv', 'tv_hunt', instance_name)

            instance_id = self._resolve_tv_hunt_instance_id(instance_name)
            if instance_id is None:
                return {'exists': False, 'previously_requested': already_requested_in_db}

            from src.primary.routes.media_hunt.discovery_tv import _get_collection_config, _save_collection_config
            from src.primary.routes.media_hunt.helpers import _extract_quality_from_filename
            from src.primary.routes.media_hunt.storage import get_detected_episodes_from_all_roots

            def _normalize_series_for_match(title):
                """Strip (YYYY) from folder name for matching."""
                s = (title or '').strip()
                s = re.sub(r'\s*\(\d{4}\)\s*$', '', s).strip()
                return s.lower()

            collection = _get_collection_config(instance_id)
            detected = get_detected_episodes_from_all_roots(instance_id)
            detected_by_series = {}
            for d in detected:
                folder_norm = _normalize_series_for_match(d.get('series_title') or '')
                if not folder_norm:
                    continue
                key = (int(d.get('season_number') or 0), int(d.get('episode_number') or 0))
                if folder_norm not in detected_by_series:
                    detected_by_series[folder_norm] = {}
                detected_by_series[folder_norm][key] = d.get('file_path') or ''

            for s in collection:
                if s.get('tmdb_id') == tmdb_id:
                    series_title = (s.get('title') or '').strip()
                    series_norm = _normalize_series_for_match(series_title)
                    detected_eps = detected_by_series.get(series_norm) or {}

                    seasons_raw = s.get('seasons') or []
                    total_eps = 0
                    available_eps = 0
                    seasons = []
                    collection_updated = False
                    for sec in seasons_raw:
                        eps = sec.get('episodes') or []
                        total_eps += len(eps)
                        eps_enriched = []
                        for ep in eps:
                            has_file = (ep.get('status') or '').lower() == 'available' or ep.get('file_path')
                            if not has_file:
                                season_num = int(sec.get('season_number') or 0)
                                ep_num = int(ep.get('episode_number') or 0)
                                detected_path = detected_eps.get((season_num, ep_num))
                                if detected_path:
                                    ep['status'] = 'available'
                                    ep['file_path'] = detected_path
                                    has_file = True
                                    collection_updated = True
                            if has_file:
                                available_eps += 1
                            ep_copy = dict(ep)
                            file_path = ep.get('file_path')
                            if file_path:
                                fname = os.path.basename(file_path)
                                q = _extract_quality_from_filename(fname)
                                if q and q != '-':
                                    ep_copy['quality'] = q
                            eps_enriched.append(ep_copy)
                        seasons.append(dict(sec, episodes=eps_enriched))
                    if collection_updated:
                        _save_collection_config(collection, instance_id)
                    missing_eps = total_eps - available_eps
                    previously_requested = already_requested_in_db or (total_eps > 0 and available_eps == 0)
                    return {
                        'exists': True,
                        'total_episodes': total_eps,
                        'available_episodes': available_eps,
                        'missing_episodes': missing_eps,
                        'previously_requested': previously_requested,
                        'seasons': seasons,
                        'monitored': s.get('monitored', True),
                        'path': s.get('root_folder', ''),
                        'root_folder_path': s.get('root_folder', ''),
                        'quality_profile': s.get('quality_profile', ''),
                    }
            return {'exists': False, 'previously_requested': already_requested_in_db}
        except Exception as e:
            logger.error(f"Error getting series status from TV Hunt: {e}")
            return {'exists': False, 'previously_requested': False}

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
            already_requested_in_db = self.db.is_already_requested(tmdb_id, 'movie', 'radarr', instance_name)
            
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
                    }
            
            logger.info(f"Movie with TMDB ID {tmdb_id} not found in Radarr")
            return {
                'in_library': False,
                'previously_requested': already_requested_in_db,
            }
            
        except Exception as e:
            logger.error(f"Error getting movie status from Radarr: {e}")
            return {
                'in_library': False,
                'previously_requested': False,
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
            already_requested_in_db = self.db.is_already_requested(tmdb_id, 'movie', 'movie_hunt', instance_name)
            
            # Resolve Movie Hunt instance ID
            instance_id = self._resolve_movie_hunt_instance_id(instance_name)
            if instance_id is None:
                return {
                    'in_library': False,
                    'previously_requested': already_requested_in_db,
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
            else:
                # Refresh scan: check if movie is on disk via filesystem scan
                try:
                    from src.primary.routes.media_hunt.storage import get_detected_movies_from_all_roots
                    from src.primary.routes.media_hunt.discovery_movie import _normalize_title_for_key
                    detected = get_detected_movies_from_all_roots(instance_id)
                    movie_key = (_normalize_title_for_key(movie.get('title')), str(movie.get('year') or '').strip())
                    detected_keys = {(_normalize_title_for_key(d.get('title')), str(d.get('year') or '').strip()) for d in detected}
                    if movie_key in detected_keys:
                        has_file = True
                except Exception:
                    pass

            return {
                'in_library': has_file,
                'previously_requested': already_requested_in_db or status_raw == 'requested',
                'monitored': True,
            }
            
        except Exception as e:
            logger.error(f"Error getting movie status from Movie Hunt: {e}")
            return {
                'in_library': False,
                'previously_requested': False,
            }
    
    def check_library_status_batch(self, items: List[Dict[str, Any]], app_type: str = None, instance_name: str = None) -> List[Dict[str, Any]]:
        """
        Check library status for a batch of media items.
        Adds status flags to each item:
        - 'in_library': Complete (all episodes for TV, has file for movies)
        - 'partial': TV shows with some but not all episodes
        - 'pending': Item has a pending request from the current user
        
        Args:
            items: List of media items to check
            app_type: Optional app type to check (radarr/sonarr/movie_hunt). If None, checks all instances.
            instance_name: Optional instance name to check. If None, checks all instances.
        """
        try:
            # Get pending + approved request tmdb_ids for badge enrichment
            pending_tmdb_ids = set()
            approved_tmdb_ids = set()
            try:
                from flask import request as flask_request
                from src.primary.auth import get_username_from_session, SESSION_COOKIE_NAME
                from src.primary.utils.database import get_database as _get_db
                session_token = flask_request.cookies.get(SESSION_COOKIE_NAME)
                username = get_username_from_session(session_token)
                if username:
                    _db = _get_db()
                    # Owner is in `users` table, non-owner users are in `requestarr_users`
                    user = _db.get_user_by_username(username) or _db.get_requestarr_user_by_username(username)
                    if user:
                        pending_tmdb_ids = _db.get_pending_request_tmdb_ids(user_id=user.get('id'))
                    # Approved requests (any user) — movies approved but possibly not yet in collection
                    approved_tmdb_ids = _db.get_approved_request_tmdb_ids()
            except Exception:
                pass  # Not in a request context or auth unavailable — skip pending check

            # Get enabled instances
            instances = self.get_enabled_instances()
            
            if not instances['radarr'] and not instances['sonarr'] and not instances.get('movie_hunt') and not instances.get('tv_hunt'):
                # No instances configured, mark all as not in library
                for item in items:
                    item['in_library'] = False
                    item['partial'] = False
                    item['pending'] = False
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
            movie_hunt_monitored_tmdb_ids = set()  # In collection but no file yet
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
                            # Normalize to int for consistent set lookups
                            try:
                                tmdb_id = int(tmdb_id)
                            except (TypeError, ValueError):
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
                            else:
                                # In collection but no file yet — treat as partial (like TV shows)
                                movie_hunt_monitored_tmdb_ids.add(tmdb_id)
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
                        logger.info(f"Found {len(movie_hunt_tmdb_ids)} movies with files + {len(movie_hunt_monitored_tmdb_ids)} monitored in Movie Hunt instance {mh_inst['name']}")
                    except Exception as e:
                        logger.error(f"Error checking Movie Hunt instance {mh_inst.get('name', '?')}: {e}")
            
            # Get all movies from filtered Radarr instances
            radarr_tmdb_ids = set()
            radarr_monitored_tmdb_ids = set()  # In Radarr but no file yet
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
                            else:
                                # In Radarr but no file yet — treat as partial (monitored)
                                radarr_monitored_tmdb_ids.add(movie.get('tmdbId'))
                        logger.info(f"Found {len(radarr_tmdb_ids)} movies with files + {len(radarr_monitored_tmdb_ids)} monitored in Radarr instance {instance['name']}")
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
                            # Normalize to int for consistent set lookups
                            try:
                                tmdb_id = int(tmdb_id)
                            except (TypeError, ValueError):
                                continue
                            # In collection = at minimum partial (exists in library)
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
                                # In collection but no episodes downloaded yet — mark as partial
                                # so the card shows the bookmark icon (not download)
                                tv_hunt_partial_tmdb_ids.add(tmdb_id)
                        logger.info(f"Found {len(tv_hunt_tmdb_ids)} complete + {len(tv_hunt_partial_tmdb_ids)} partial series in TV Hunt instance {th_inst['name']} (IDs: complete={tv_hunt_tmdb_ids}, partial={tv_hunt_partial_tmdb_ids})")
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
                            # Mark as partial if some but not all episodes are available,
                            # or if the series exists but has no episodes downloaded yet
                            elif total_episodes > 0:
                                sonarr_partial_tmdb_ids.add(tmdb_id)
                        logger.info(f"Found {len(sonarr_tmdb_ids)} complete series and {len(sonarr_partial_tmdb_ids)} partial series in Sonarr instance {instance['name']}")
                except Exception as e:
                    logger.error(f"Error checking Sonarr instance {instance['name']}: {e}")
            
            # Build importable TMDB ID sets from cached import-media scans
            # (no filesystem access — reads from DB only)
            importable_movie_ids = set()
            importable_tv_ids = set()
            try:
                from src.primary.utils.database import get_database as _get_db
                _db = _get_db()
                # Movie Hunt importable items
                for mh_inst in (movie_hunt_instances or []):
                    try:
                        mh_id = mh_inst.get('id') or self._resolve_movie_hunt_instance_id(mh_inst['name'])
                        if not mh_id:
                            continue
                        cfg = _db.get_app_config_for_instance('movie_hunt_import_media', mh_id)
                        if cfg and isinstance(cfg, dict):
                            for itm in (cfg.get('items') or []):
                                if itm.get('status') in ('matched', 'pending', 'no_match'):
                                    best = itm.get('best_match') or {}
                                    tid = best.get('tmdb_id')
                                    if tid:
                                        try:
                                            importable_movie_ids.add(int(tid))
                                        except (TypeError, ValueError):
                                            pass
                    except Exception:
                        pass
                # TV Hunt importable items
                for th_inst in (tv_hunt_instances or []):
                    try:
                        th_id = th_inst.get('id') or self._resolve_tv_hunt_instance_id(th_inst['name'])
                        if not th_id:
                            continue
                        cfg = _db.get_app_config_for_instance('tv_hunt_import_media', th_id)
                        if cfg and isinstance(cfg, dict):
                            for itm in (cfg.get('items') or []):
                                if itm.get('status') in ('matched', 'pending', 'no_match'):
                                    best = itm.get('best_match') or {}
                                    tid = best.get('tmdb_id')
                                    if tid:
                                        try:
                                            importable_tv_ids.add(int(tid))
                                        except (TypeError, ValueError):
                                            pass
                    except Exception:
                        pass
            except Exception:
                pass

            # Mark each item with status
            for item in items:
                tmdb_id = item.get('tmdb_id')
                # Normalize to int for consistent set lookups
                try:
                    tmdb_id = int(tmdb_id)
                except (TypeError, ValueError):
                    pass
                media_type = item.get('media_type')
                
                # Set library status
                if media_type == 'movie':
                    # Check Movie Hunt first (if applicable), then Radarr
                    item['in_library'] = tmdb_id in movie_hunt_tmdb_ids or tmdb_id in radarr_tmdb_ids
                    # Movies in collection but without files yet → partial (shows bookmark, not download icon)
                    item['partial'] = (not item['in_library']) and (tmdb_id in movie_hunt_monitored_tmdb_ids or tmdb_id in radarr_monitored_tmdb_ids)
                    # Fallback: approved in DB but not yet in any collection → still partial
                    if not item['in_library'] and not item['partial'] and tmdb_id in approved_tmdb_ids:
                        item['partial'] = True
                    item['importable'] = tmdb_id in importable_movie_ids and not item['in_library'] and not item['partial']
                elif media_type == 'tv':
                    item['in_library'] = tmdb_id in sonarr_tmdb_ids or tmdb_id in tv_hunt_tmdb_ids
                    item['partial'] = tmdb_id in sonarr_partial_tmdb_ids or tmdb_id in tv_hunt_partial_tmdb_ids
                    # Fallback: approved in DB but not yet in any collection → still partial
                    if not item['in_library'] and not item['partial'] and tmdb_id in approved_tmdb_ids:
                        item['partial'] = True
                    item['importable'] = tmdb_id in importable_tv_ids and not item['in_library'] and not item['partial']
                else:
                    item['in_library'] = False
                    item['partial'] = False
                    item['importable'] = False

                # Pending request badge: only show if NOT already in library or partial
                item['pending'] = (tmdb_id in pending_tmdb_ids) and not item['in_library'] and not item['partial']
            
            return items
            
        except Exception as e:
            logger.error(f"Error checking library status batch: {e}")
            # On error, mark all as not in library
            for item in items:
                item['in_library'] = False
                item['partial'] = False
                item['pending'] = False
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
        Filter out media items that have been permanently hidden (cross-instance).
        Personal blacklist now applies across ALL instances for the user.
        
        Args:
            items: List of media items with 'tmdb_id' and 'media_type'
            app_type: Kept for backward compat, no longer used for filtering
            instance_name: Kept for backward compat, no longer used for filtering
            
        Returns:
            Filtered list excluding hidden media
        """
        try:
            filtered_items = []
            for item in items:
                tmdb_id = item.get('tmdb_id')
                media_type = item.get('media_type')
                
                if not self.db.is_media_hidden(tmdb_id, media_type):
                    filtered_items.append(item)
            
            if len(filtered_items) < len(items):
                logger.info(f"Filtered hidden media: {len(items)} total -> {len(filtered_items)} after removing hidden")
            
            return filtered_items
        except Exception as e:
            logger.error(f"Error filtering hidden media: {e}")
            return items  # Return all items on error
    

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
