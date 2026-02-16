"""
Movie Hunt Import Handler
Handles importing completed downloads to root folders with renaming and history tracking.
"""

import os
import shutil
import logging
from pathlib import Path
from typing import Dict, Any, Optional, List, Tuple

logger = logging.getLogger(__name__)


def _mh_log():
    """Return the Movie Hunt logger (writes to Activity → Logs)."""
    from src.primary.utils.logger import get_logger
    return get_logger('movie_hunt')

# Video file extensions (same as root folder detection)
_VIDEO_EXTENSIONS = frozenset(('.mkv', '.mp4', '.avi', '.mov', '.wmv', '.m4v', '.mpg', '.mpeg', '.webm', '.flv', '.m2ts', '.ts'))

# Sample file indicators (skip these)
_SAMPLE_INDICATORS = frozenset(('sample', 'trailer', 'preview', 'extra', 'bonus'))

# Minimum file size to be considered a movie (100 MB)
_MIN_MOVIE_SIZE_MB = 100
_MIN_MOVIE_SIZE_BYTES = _MIN_MOVIE_SIZE_MB * 1024 * 1024


def _translate_remote_path(remote_path: str, client_host: str) -> str:
    """
    Translate a remote download client path to local path using remote path mappings.
    
    Args:
        remote_path: Path from download client (e.g., /data/downloads/Movie/)
        client_host: Download client host (e.g., "192.168.1.100:8080")
    
    Returns:
        Translated local path (e.g., /mnt/user/downloads/Movie/)
    """
    try:
        from src.primary.utils.database import get_database
        db = get_database()
        config = db.get_app_config('movie_hunt_remote_mappings')
        
        if not config or not isinstance(config.get('mappings'), list):
            logger.debug("No remote path mappings configured, using path as-is")
            return remote_path
        
        mappings = config['mappings']
        
        # Match by host (strip protocol if present)
        host_clean = client_host.replace('http://', '').replace('https://', '').strip()
        
        for mapping in mappings:
            mapping_host = (mapping.get('host') or '').strip()
            mapping_host_clean = mapping_host.replace('http://', '').replace('https://', '').strip()
            
            if mapping_host_clean == host_clean:
                remote = (mapping.get('remote_path') or '').strip()
                local = (mapping.get('local_path') or '').strip()
                
                if not remote or not local:
                    continue
                
                # Normalize paths for comparison (handle trailing slashes)
                remote_normalized = remote.rstrip('/') + '/'
                remote_path_normalized = remote_path.rstrip('/') + '/'
                
                if remote_path_normalized.startswith(remote_normalized):
                    # Replace remote prefix with local prefix
                    translated = remote_path.replace(remote.rstrip('/'), local.rstrip('/'), 1)
                    _mh_log().info("Import: path translated (remote -> local): %s -> %s", remote_path, translated)
                    return translated
        
        _mh_log().info(
            "Import: no remote path mapping matched. Host=%s, path from SAB=%s. Using path as-is. "
            "If import fails (path not found), set Remote Path in Movie Hunt → Settings → Clients to match "
            "SAB's completed folder (e.g. /sab1/huntarr/movies if your SAB category uses folder 'huntarr/movies').",
            client_host, remote_path
        )
        return remote_path
        
    except Exception as e:
        logger.error(f"Error translating remote path: {e}")
        return remote_path


def _find_largest_video_file(download_path: str) -> Optional[str]:
    """
    Find the largest video file in the download path (handles both single file and directory).
    Skips sample files and files below minimum size.
    
    Args:
        download_path: Path where download client stored the file(s)
    
    Returns:
        Full path to the largest video file, or None if not found
    """
    try:
        path = Path(download_path)
        
        if not path.exists():
            _mh_log().error(
                "Import: download path does not exist: %s. "
                "Check Remote Path Mapping in Movie Hunt → Settings → Clients: Remote Path must match "
                "the path SAB reports (e.g. /sab1/huntarr/movies) and Local Path must be where that folder is mounted in this container (e.g. /downloads).",
                download_path
            )
            return None
        
        video_files = []
        
        # If it's a single file
        if path.is_file():
            if path.suffix.lower() in _VIDEO_EXTENSIONS:
                file_size = path.stat().st_size
                if file_size >= _MIN_MOVIE_SIZE_BYTES:
                    return str(path)
                else:
                    _mh_log().warning("Import: video file too small (%.1f MB): %s", file_size / 1024 / 1024, path.name)
            return None
        
        # If it's a directory, search for video files
        for item in path.rglob('*'):
            if item.is_file() and item.suffix.lower() in _VIDEO_EXTENSIONS:
                # Skip sample files
                name_lower = item.name.lower()
                if any(indicator in name_lower for indicator in _SAMPLE_INDICATORS):
                    logger.debug(f"Skipping sample file: {item.name}")
                    continue
                
                # Check file size
                file_size = item.stat().st_size
                if file_size < _MIN_MOVIE_SIZE_BYTES:
                    logger.debug(f"Skipping small file ({file_size / 1024 / 1024:.1f} MB): {item.name}")
                    continue
                
                video_files.append((str(item), file_size))
        
        if not video_files:
            _mh_log().error(
                "Import: no valid video files (min %d MB, excluding samples) in %s",
                _MIN_MOVIE_SIZE_MB, download_path
            )
            return None
        
        # Return the largest file
        largest_file = max(video_files, key=lambda x: x[1])
        _mh_log().info("Import: using video %s (%.1f MB)", Path(largest_file[0]).name, largest_file[1] / 1024 / 1024)
        return largest_file[0]
        
    except Exception as e:
        _mh_log().error("Import: error finding video in %s: %s", download_path, e)
        return None


def _get_collection_item(title: str, year: str, instance_id: int = None) -> Optional[Dict[str, Any]]:
    """Get collection item by title and year. Checks per-instance storage first, then global."""
    try:
        from src.primary.utils.database import get_database
        db = get_database()
        
        # Try per-instance first (the actual storage format)
        if instance_id is None:
            instance_id = db.get_current_movie_hunt_instance_id()
        
        config = db.get_app_config_for_instance('movie_hunt_collection', instance_id)
        
        # Fall back to global config if per-instance is empty
        if not config or not isinstance(config.get('items'), list):
            config = db.get_app_config('movie_hunt_collection')
        
        if not config or not isinstance(config.get('items'), list):
            return None
        
        items = config['items']
        for item in items:
            if item.get('title') == title and item.get('year') == year:
                return item
        
        return None
        
    except Exception as e:
        logger.error(f"Error getting collection item: {e}")
        return None


def _update_collection_status(title: str, year: str, status: str, file_path: Optional[str] = None, instance_id: int = None):
    """Update collection item status and file path. Uses per-instance storage."""
    try:
        from src.primary.utils.database import get_database
        db = get_database()
        
        if instance_id is None:
            instance_id = db.get_current_movie_hunt_instance_id()
        
        config = db.get_app_config_for_instance('movie_hunt_collection', instance_id)
        
        if not config or not isinstance(config.get('items'), list):
            return
        
        items = config['items']
        updated = False
        
        for item in items:
            if item.get('title') == title and item.get('year') == year:
                item['status'] = status
                if file_path:
                    item['file_path'] = file_path
                updated = True
                break
        
        if updated:
            db.save_app_config_for_instance('movie_hunt_collection', instance_id, {'items': items})
            logger.info(f"Updated collection status for '{title}' ({year}): {status}")
        
    except Exception as e:
        logger.error(f"Error updating collection status: {e}")


def _get_default_root_folder(instance_id: int = None) -> Optional[str]:
    """Get the default root folder path (Media Hunt, per-instance)."""
    try:
        from src.primary.utils.database import get_database
        from src.primary.routes.media_hunt import root_folders as mh_rf
        db = get_database()
        if instance_id is None:
            instance_id = db.get_current_movie_hunt_instance_id()
        root_folders = mh_rf.get_root_folders_config(instance_id, 'movie_hunt_root_folders')
        if not root_folders:
            return None
        for rf in root_folders:
            if rf.get('is_default'):
                return rf.get('path')
        return root_folders[0].get('path')
    except Exception as e:
        logger.error(f"Error getting default root folder: {e}")
        return None


def _add_import_history(title: str, year: str, client_name: str, dest_file: str, success: bool = True):
    """Add import entry to Movie Hunt history."""
    try:
        from src.primary.history_manager import add_history_entry
        
        # Format display name
        display_name = f"{title} ({year})" if year else title
        if success:
            display_name += f" → {Path(dest_file).parent.name}"
        
        entry_data = {
            'id': f"{title}_{year}",  # Use title_year as media_id
            'name': display_name,
            'operation_type': 'import',
            'instance_name': client_name,
        }
        
        add_history_entry('movie_hunt', entry_data)
        _mh_log().info("Import: added history for '%s' (%s)", title, year)
        
    except Exception as e:
        logger.error(f"Error adding import history: {e}")


def _auto_probe_file(title: str, year: str, file_path: str, instance_id: int = None):
    """
    Auto-probe a newly imported file and cache media_info on the collection item.
    Respects universal video settings (analyze_video_files toggle, scan profile).
    Non-fatal: any failure is logged but does not affect the import result.
    """
    try:
        # Check if video analysis is enabled
        from src.primary.routes.media_hunt.instances import get_universal_video_settings
        uvs = get_universal_video_settings()
        if not uvs.get('analyze_video_files', True):
            return  # Analysis disabled by user

        scan_profile = (uvs.get('video_scan_profile') or 'default').strip().lower()

        from src.primary.utils.media_probe import probe_media_file
        probe_data = probe_media_file(file_path, scan_profile=scan_profile)

        if not probe_data:
            _mh_log().debug("Import probe: no data for '%s' (%s)", title, year)
            return

        # Save probe data to collection item
        from src.primary.utils.database import get_database
        db = get_database()
        if instance_id is None:
            instance_id = db.get_current_movie_hunt_instance_id()

        config = db.get_app_config_for_instance('movie_hunt_collection', instance_id)
        if not config or not isinstance(config.get('items'), list):
            return

        for item in config['items']:
            if item.get('title') == title and item.get('year') == year:
                item['media_info'] = probe_data
                db.save_app_config_for_instance(
                    'movie_hunt_collection', instance_id, {'items': config['items']}
                )
                res = probe_data.get('video_resolution', '')
                codec = probe_data.get('video_codec', '')
                _mh_log().info(
                    "Import probe: cached media info for '%s' (%s) — %s %s",
                    title, year, res, codec,
                )
                break

    except Exception as e:
        _mh_log().debug("Import probe: error for '%s' (%s): %s", title, year, e)


def _cleanup_source_folder(local_path: str, root_folder: str, title: str, year: str) -> None:
    """
    Remove the source download folder after successful import.
    Prevents leftover folders with samples, .nfo, .par2, etc. from accumulating.
    """
    if not local_path or not os.path.isdir(local_path):
        return
    # Safety: don't delete root-level or destination paths
    local_real = os.path.realpath(local_path)
    root_real = os.path.realpath(root_folder)
    if local_real == root_real:
        return
    if local_real.rstrip(os.sep) == os.path.realpath('/').rstrip(os.sep):
        return
    # Require at least 2 path components (e.g. /downloads/foo, not just /downloads)
    parts = Path(local_path).parts
    if len(parts) < 2:
        return
    try:
        shutil.rmtree(local_path)
        _mh_log().info("Import: cleaned up source folder '%s' (%s): %s", title, year, local_path)
    except OSError as e:
        # Don't raise - import succeeded, cleanup is best-effort
        _mh_log().warning("Import: could not remove source folder %s: %s", local_path, e)


def import_movie(client: Dict[str, Any], title: str, year: str, download_path: str,
                  instance_id: int = None, release_name: str = '') -> bool:
    """
    Import a completed movie download to its root folder.
    
    Args:
        client: Download client config dict
        title: Movie title
        year: Movie year
        download_path: Path where download client stored the file
        instance_id: Movie Hunt instance ID (for per-instance collection/root folder lookup)
        release_name: Original release/NZB name for quality parsing (optional)
    
    Returns:
        True if import succeeded, False otherwise
    """
    try:
        _mh_log().info("Import: starting for '%s' (%s) from %s", title, year, download_path)
        
        # 1. Get collection item to determine root folder
        collection_item = _get_collection_item(title, year, instance_id)
        
        if not collection_item:
            _mh_log().warning(
                "Import: '%s' (%s) not in Movie Hunt collection, skipping. "
                "Only movies requested via Movie Hunt are imported; add the movie from Movie Home first.",
                title, year
            )
            return False
        
        # Get root folder (from collection or default)
        root_folder = collection_item.get('root_folder')
        if not root_folder:
            root_folder = _get_default_root_folder(instance_id)
        
        if not root_folder:
            _mh_log().error("Import: no root folder for '%s' (%s)", title, year)
            return False
        
        # Verify root folder exists
        if not os.path.exists(root_folder):
            _mh_log().error("Import: root folder does not exist: %s", root_folder)
            return False
        
        # 2. Translate path using remote mappings
        client_host = f"{client.get('host', '')}:{client.get('port', 8080)}"
        local_path = _translate_remote_path(download_path, client_host)
        _mh_log().info("Import: using local path for '%s': %s", title, local_path)
        
        # 3. Find video file
        video_file = _find_largest_video_file(local_path)
        if not video_file:
            _mh_log().error("Import: no video file found in %s", local_path)
            return False
        
        # 4. Create movie folder and filename using format settings
        ext = os.path.splitext(video_file)[1]
        try:
            from src.primary.apps.media_rename import format_movie_filename
            folder_name, file_name = format_movie_filename(
                title=title, year=year, ext=ext,
                collection_item=collection_item,
                release_name=release_name,
                instance_id=instance_id,
            )
            _mh_log().info("Import: format engine -> folder='%s', file='%s'", folder_name, file_name)
        except Exception as fmt_err:
            _mh_log().warning(
                "Import: format engine failed (%s), using fallback naming", fmt_err)
            folder_name = f"{title} ({year})" if year else title
            folder_name = "".join(c for c in folder_name if c not in r'<>:"/\\|?*')
            file_name = f"{title} ({year}){ext}" if year else f"{title}{ext}"
            file_name = "".join(c for c in file_name if c not in r'<>:"/\\|?*')

        dest_folder = os.path.join(root_folder, folder_name)

        try:
            os.makedirs(dest_folder, exist_ok=True)
        except Exception as e:
            _mh_log().error("Import: failed to create folder %s: %s", dest_folder, e)
            return False

        dest_file = os.path.join(dest_folder, file_name)
        
        # 6. Check if file already exists
        if os.path.exists(dest_file):
            _mh_log().warning("Import: file already exists, updating collection: %s", dest_file)
            # Update collection status anyway
            _update_collection_status(title, year, 'available', dest_file, instance_id=instance_id)
            client_name = client.get('name', 'Download client')
            _add_import_history(title, year, client_name, dest_file, success=True)
            _auto_probe_file(title, year, dest_file, instance_id)
            # Clean up source folder (redundant download + junk)
            try:
                _cleanup_source_folder(local_path, root_folder, title, year)
            except Exception as e:
                _mh_log().warning("Import: cleanup of source folder failed (non-fatal): %s", e)
            return True
        
        # 7. Move file (use shutil.move which handles cross-filesystem moves)
        _mh_log().info("Import: moving %s -> %s", video_file, dest_file)
        
        try:
            shutil.move(video_file, dest_file)
        except Exception as e:
            _mh_log().error(
                "Import: failed to move file: %s. Reason: %s. Check permissions and that destination is writable.",
                video_file, e
            )
            return False
        
        # 8. Update collection status
        _update_collection_status(title, year, 'available', dest_file, instance_id=instance_id)
        
        # 9. Add to history
        client_name = client.get('name', 'Download client')
        _add_import_history(title, year, client_name, dest_file, success=True)
        
        # 10. Auto-probe the imported file (cache media info for detail page)
        _auto_probe_file(title, year, dest_file, instance_id)
        
        # 11. Clean up source folder (remove download folder and any leftover trash)
        try:
            _cleanup_source_folder(local_path, root_folder, title, year)
        except Exception as e:
            _mh_log().warning("Import: cleanup of source folder failed (non-fatal): %s", e)
        
        _mh_log().info("Import: completed '%s' (%s) -> %s", title, year, dest_file)
        return True
        
    except Exception as e:
        _mh_log().exception("Import: error for '%s' (%s): %s", title, year, e)
        return False
