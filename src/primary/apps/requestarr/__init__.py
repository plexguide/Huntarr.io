"""
Requestarr module for searching and requesting media through TMDB and *arr apps
"""

import requests
import logging
import os
import time
from typing import Dict, List, Any, Optional
from src.primary.utils.database import get_database

from src.primary.apps.requestarr.requestarr_discovery import DiscoveryMixin, _safe_int_list
from src.primary.apps.requestarr.requestarr_library import LibraryMixin
from src.primary.apps.requestarr.requestarr_requests import RequestsMixin

logger = logging.getLogger(__name__)


class RequestarrAPI(DiscoveryMixin, LibraryMixin, RequestsMixin):
    """API handler for Requestarr functionality.

    Discovery (TMDB trending/popular/search/genres/providers/filters) → DiscoveryMixin
    Library status (Sonarr/Radarr/Movie Hunt/TV Hunt checks, batch status) → LibraryMixin
    Request operations (add to Radarr/Sonarr/Movie Hunt/TV Hunt) → RequestsMixin
    Settings & preferences (quality profiles, root folders, defaults) → this file
    """

    def __init__(self):
        self.db = get_database()
        self.tmdb_base_url = "https://api.themoviedb.org/3"
        self.tmdb_image_base_url = "https://image.tmdb.org/t/p/w500"

    def get_tmdb_api_key(self) -> str:
        """Get hardcoded TMDB API key"""
        return "9265b0bd0cd1962f7f3225989fcd7192"

    # ------------------------------------------------------------------
    # Quality profiles
    # ------------------------------------------------------------------

    def get_quality_profiles(self, app_type: str, instance_name: str) -> List[Dict[str, Any]]:
        """Get quality profiles from Radarr, Sonarr, or Movie Hunt instance"""
        try:
            if app_type == 'movie_hunt':
                return self._get_movie_hunt_quality_profiles(instance_name)
            if app_type == 'tv_hunt':
                return self._get_tv_hunt_quality_profiles(instance_name)

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

            url = target_instance.get('api_url', '') or target_instance.get('url', '')
            api_key = target_instance.get('api_key', '')

            if not url or not api_key:
                logger.warning(f"Missing URL or API key for {app_type}/{instance_name}")
                return []

            url = url.rstrip('/')

            max_retries = 3
            timeout = 30

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
                    return [
                        {
                            'id': profile.get('id'),
                            'name': profile.get('name')
                        }
                        for profile in profiles
                    ]

                except (requests.exceptions.Timeout, requests.exceptions.ConnectionError) as e:
                    if attempt < max_retries - 1:
                        wait_time = 2 ** attempt
                        logger.warning(f"Timeout/connection error fetching quality profiles from {app_type}/{instance_name} (attempt {attempt+1}): {e}. Retrying in {wait_time}s...")
                        time.sleep(wait_time)
                        continue
                    else:
                        logger.error(f"Failed to fetch quality profiles after {max_retries} attempts: {e}")
                        return []
                except requests.exceptions.RequestException as e:
                    logger.error(f"API error fetching quality profiles from {app_type}/{instance_name}: {e}")
                    return []

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

            result = []
            for i, profile in enumerate(profiles):
                profile_name = (profile.get('name') or '').strip()
                if profile_name:
                    result.append({
                        'id': profile_name,
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

    # ------------------------------------------------------------------
    # Instance resolution helpers
    # ------------------------------------------------------------------

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

    # ------------------------------------------------------------------
    # Default instances & modal preferences
    # ------------------------------------------------------------------

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
            return {'movie_instance': '', 'tv_instance': ''}
        except Exception as e:
            logger.error(f"Error getting default instances: {e}")
            return {'movie_instance': '', 'tv_instance': ''}

    def set_default_instances(self, movie_instance: str, tv_instance: str):
        """Set default instance settings for discovery"""
        try:
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

    # ------------------------------------------------------------------
    # Default root folders
    # ------------------------------------------------------------------

    def get_default_root_folders(self) -> Dict[str, str]:
        """Get default root folder paths per app (issue #806)."""
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

    # ------------------------------------------------------------------
    # Root folders
    # ------------------------------------------------------------------

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

            max_retries = 3
            timeout = 30

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
                    break
                except (requests.exceptions.Timeout, requests.exceptions.ConnectionError) as e:
                    if attempt < max_retries - 1:
                        wait_time = 2 ** attempt
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
                logger.error(f"All {max_retries} attempts failed to fetch root folders")
                return []

            if not isinstance(raw, list):
                return []

            seen_ids = set()
            seen_paths = set()
            deduped = []
            for rf in raw:
                if not isinstance(rf, dict):
                    continue
                rf_id = rf.get('id')
                path = (rf.get('path') or '').strip().rstrip('/')
                if not path:
                    continue
                path_lower = path.lower()
                if rf_id is not None and rf_id in seen_ids:
                    logger.debug(f"Skipping duplicate root folder ID: {rf_id}")
                    continue
                if path_lower in seen_paths:
                    logger.debug(f"Skipping duplicate root folder path: {path}")
                    continue
                if rf_id is not None:
                    seen_ids.add(rf_id)
                seen_paths.add(path_lower)
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


# Global instance
requestarr_api = RequestarrAPI()
