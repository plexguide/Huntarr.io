"""
TV Hunt Import Handler
Handles importing completed TV episode downloads to root folders with renaming
and history tracking. Uses the shared media_rename engine for format-token
replacement, matching Sonarr-style naming behaviour.
"""

import os
import shutil
import logging
from pathlib import Path
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)


def _tv_log():
    """Return the TV Hunt logger (writes to Activity -> Logs)."""
    from src.primary.utils.logger import get_logger
    return get_logger('tv_hunt')


_VIDEO_EXTENSIONS = frozenset((
    '.mkv', '.mp4', '.avi', '.mov', '.wmv', '.m4v',
    '.mpg', '.mpeg', '.webm', '.flv', '.m2ts', '.ts',
))

_SAMPLE_INDICATORS = frozenset(('sample', 'trailer', 'preview', 'extra', 'bonus'))

_MIN_EPISODE_SIZE_MB = 25
_MIN_EPISODE_SIZE_BYTES = _MIN_EPISODE_SIZE_MB * 1024 * 1024


def _translate_remote_path(remote_path: str, client_host: str) -> str:
    """Translate a remote download client path to local path using remote path mappings."""
    try:
        from src.primary.utils.database import get_database
        db = get_database()
        config = db.get_app_config('tv_hunt_remote_mappings')

        if not config or not isinstance(config.get('mappings'), list):
            return remote_path

        host_clean = client_host.replace('http://', '').replace('https://', '').strip()

        for mapping in config['mappings']:
            mapping_host = (mapping.get('host') or '').strip()
            mapping_host_clean = mapping_host.replace('http://', '').replace('https://', '').strip()

            if mapping_host_clean == host_clean:
                remote = (mapping.get('remote_path') or '').strip()
                local = (mapping.get('local_path') or '').strip()

                if not remote or not local:
                    continue

                remote_normalized = remote.rstrip('/') + '/'
                remote_path_normalized = remote_path.rstrip('/') + '/'

                if remote_path_normalized.startswith(remote_normalized):
                    translated = remote_path.replace(remote.rstrip('/'), local.rstrip('/'), 1)
                    _tv_log().info("Import: path translated: %s -> %s", remote_path, translated)
                    return translated

        return remote_path

    except Exception as e:
        logger.error("Error translating TV remote path: %s", e)
        return remote_path


def _find_largest_video_file(download_path: str) -> Optional[str]:
    """Find the largest video file in the download path."""
    try:
        path = Path(download_path)

        if not path.exists():
            _tv_log().error(
                "Import: download path does not exist: %s. "
                "Check Remote Path Mapping in TV Hunt Settings -> Clients.",
                download_path,
            )
            return None

        video_files = []

        if path.is_file():
            if path.suffix.lower() in _VIDEO_EXTENSIONS:
                file_size = path.stat().st_size
                if file_size >= _MIN_EPISODE_SIZE_BYTES:
                    return str(path)
                else:
                    _tv_log().warning("Import: video file too small (%.1f MB): %s",
                                      file_size / 1024 / 1024, path.name)
            return None

        for item in path.rglob('*'):
            if item.is_file() and item.suffix.lower() in _VIDEO_EXTENSIONS:
                name_lower = item.name.lower()
                if any(indicator in name_lower for indicator in _SAMPLE_INDICATORS):
                    continue
                file_size = item.stat().st_size
                if file_size < _MIN_EPISODE_SIZE_BYTES:
                    continue
                video_files.append((str(item), file_size))

        if not video_files:
            _tv_log().error(
                "Import: no valid video files (min %d MB) in %s",
                _MIN_EPISODE_SIZE_MB, download_path,
            )
            return None

        largest = max(video_files, key=lambda x: x[1])
        _tv_log().info("Import: using video %s (%.1f MB)", Path(largest[0]).name, largest[1] / 1024 / 1024)
        return largest[0]

    except Exception as e:
        _tv_log().error("Import: error finding video in %s: %s", download_path, e)
        return None


def _get_default_root_folder(instance_id: int) -> Optional[str]:
    """Get the default TV Hunt root folder path."""
    try:
        from src.primary.routes.media_hunt import root_folders as mh_rf
        root_folders = mh_rf.get_root_folders_config(instance_id, 'tv_hunt_root_folders')
        if not root_folders:
            return None
        for rf in root_folders:
            if rf.get('is_default'):
                return rf.get('path')
        return root_folders[0].get('path')
    except Exception as e:
        logger.error("Error getting TV default root folder: %s", e)
        return None


def _get_series_collection_item(series_title: str, instance_id: int) -> Optional[Dict[str, Any]]:
    """Get the series from TV Hunt collection by title."""
    try:
        from src.primary.utils.database import get_database
        db = get_database()
        config = db.get_app_config_for_instance('tv_hunt_collection', instance_id)
        if not config or not isinstance(config.get('series'), list):
            return None
        title_clean = (series_title or '').strip().lower()
        for series in config['series']:
            if (series.get('title') or '').strip().lower() == title_clean:
                return series
        return None
    except Exception as e:
        logger.error("Error getting TV series collection item: %s", e)
        return None


def _update_episode_status(series_title: str, season: int, episode: int,
                           status: str, file_path: Optional[str] = None,
                           instance_id: int = None):
    """Update the status of an episode in the TV Hunt collection."""
    try:
        from src.primary.utils.database import get_database
        db = get_database()
        config = db.get_app_config_for_instance('tv_hunt_collection', instance_id)
        if not config or not isinstance(config.get('series'), list):
            return

        title_clean = (series_title or '').strip().lower()
        updated = False
        season_int = int(season) if season is not None else None
        episode_int = int(episode) if episode is not None else None
        for series in config['series']:
            if (series.get('title') or '').strip().lower() != title_clean:
                continue
            for s in (series.get('seasons') or []):
                s_num = s.get('season_number')
                s_num = int(s_num) if s_num is not None else None
                if s_num != season_int:
                    continue
                for ep in (s.get('episodes') or []):
                    ep_num = ep.get('episode_number')
                    ep_num = int(ep_num) if ep_num is not None else None
                    if ep_num == episode_int:
                        ep['status'] = status
                        if file_path:
                            ep['file_path'] = file_path
                        updated = True
                        break
                break
            break

        if updated:
            db.save_app_config_for_instance('tv_hunt_collection', instance_id, config)
            _tv_log().info("Updated episode status: '%s' S%02dE%02d -> %s",
                           series_title, season or 0, episode or 0, status)

    except Exception as e:
        logger.error("Error updating episode status: %s", e)


def _add_import_history(series_title: str, season: int, episode: int,
                        client_name: str, dest_file: str, success: bool = True):
    """Add import entry to TV Hunt history."""
    try:
        from src.primary.history_manager import add_history_entry

        display_name = f"{series_title} - S{(season or 0):02d}E{(episode or 0):02d}"
        if success:
            display_name += f" -> {Path(dest_file).parent.name}"

        entry_data = {
            'id': f"{series_title}_s{season}e{episode}",
            'name': display_name,
            'operation_type': 'import',
            'instance_name': client_name,
        }

        add_history_entry('tv_hunt', entry_data)
        _tv_log().info("Import: added history for '%s' S%02dE%02d",
                        series_title, season or 0, episode or 0)

    except Exception as e:
        logger.error("Error adding TV import history: %s", e)


def _cleanup_on_import_failure(local_path: str, root_folder: str,
                              series_title: str, season: int, episode: int) -> None:
    """Remove the source download folder when import fails. Frees disk space."""
    if not local_path or not root_folder:
        return
    try:
        _cleanup_source_folder(local_path, root_folder, series_title, season, episode)
        _tv_log().info("Import: discarded failed download for '%s' S%02dE%02d to free space",
                       series_title, season or 0, episode or 0)
    except Exception as e:
        _tv_log().warning("Import: could not discard failed download folder %s: %s", local_path, e)


def _cleanup_source_folder(local_path: str, root_folder: str,
                           series_title: str, season: int, episode: int) -> None:
    """Remove the source download folder after successful import."""
    if not local_path or not os.path.isdir(local_path):
        return
    local_real = os.path.realpath(local_path)
    root_real = os.path.realpath(root_folder)
    if local_real == root_real:
        return
    if local_real.rstrip(os.sep) == os.path.realpath('/').rstrip(os.sep):
        return
    parts = Path(local_path).parts
    if len(parts) < 2:
        return
    try:
        shutil.rmtree(local_path)
        _tv_log().info("Import: cleaned up source folder '%s' S%02dE%02d: %s",
                        series_title, season or 0, episode or 0, local_path)
    except OSError as e:
        _tv_log().warning("Import: could not remove source folder %s: %s", local_path, e)


def import_episode(client: Dict[str, Any], series_title: str, year: str,
                   season: int, episode: int, episode_title: str = '',
                   download_path: str = '', instance_id: int = None,
                   release_name: str = '', series_type: str = 'standard') -> bool:
    """
    Import a completed TV episode download to its root folder.

    Args:
        client: Download client config dict
        series_title: Series title
        year: Series premiere year
        season: Season number
        episode: Episode number
        episode_title: Episode title (if known)
        download_path: Path where download client stored the file
        instance_id: TV Hunt instance ID
        release_name: Original release/NZB name for quality parsing
        series_type: 'standard', 'daily', or 'anime'

    Returns:
        True if import succeeded, False otherwise
    """
    try:
        _tv_log().info("Import: starting for '%s' S%02dE%02d from %s",
                        series_title, season or 0, episode or 0, download_path)

        # 1. Get series from collection
        series_item = _get_series_collection_item(series_title, instance_id)

        # Get root folder from series item or default
        root_folder = None
        if series_item:
            root_folder = series_item.get('root_folder')
        if not root_folder:
            root_folder = _get_default_root_folder(instance_id)

        if not root_folder:
            _tv_log().error("Import: no root folder for '%s'", series_title)
            return False

        if not os.path.exists(root_folder):
            _tv_log().error("Import: root folder does not exist: %s", root_folder)
            return False

        # 2. Translate path using remote mappings
        client_host = f"{client.get('host', '')}:{client.get('port', 8080)}"
        local_path = _translate_remote_path(download_path, client_host)
        _tv_log().info("Import: using local path for '%s': %s", series_title, local_path)

        # 3. Find video file
        video_file = _find_largest_video_file(local_path)
        if not video_file:
            _tv_log().error("Import: no video file found in %s", local_path)
            _cleanup_on_import_failure(local_path, root_folder, series_title, season, episode)
            return False

        # 4. Generate folder and file names using format settings
        ext = os.path.splitext(video_file)[1]
        try:
            from src.primary.apps.media_rename import format_episode_filename
            series_folder, season_folder, file_name = format_episode_filename(
                series_title=series_title, year=year,
                season=season, episode=episode,
                episode_title=episode_title, ext=ext,
                series_type=series_type,
                series_item=series_item,
                release_name=release_name,
                instance_id=instance_id,
            )
            _tv_log().info(
                "Import: format engine -> series='%s', season='%s', file='%s'",
                series_folder, season_folder, file_name,
            )
        except Exception as fmt_err:
            _tv_log().warning(
                "Import: format engine failed (%s), using fallback naming", fmt_err)
            series_folder = f"{series_title} ({year})" if year else series_title
            series_folder = "".join(c for c in series_folder if c not in r'<>:"/\\|?*')
            season_folder = f"Season {str(season).zfill(2)}" if season is not None else 'Season 01'
            file_name = f"{series_title} - S{str(season).zfill(2)}E{str(episode).zfill(2)}{ext}"
            file_name = "".join(c for c in file_name if c not in r'<>:"/\\|?*')

        # Build full destination path: root_folder / series / season / file
        dest_series_folder = os.path.join(root_folder, series_folder)
        dest_season_folder = os.path.join(dest_series_folder, season_folder)
        dest_file = os.path.join(dest_season_folder, file_name)

        try:
            os.makedirs(dest_season_folder, exist_ok=True)
        except Exception as e:
            _tv_log().error("Import: failed to create folder %s: %s", dest_season_folder, e)
            _cleanup_on_import_failure(local_path, root_folder, series_title, season, episode)
            return False

        # 5. Check if file already exists
        if os.path.exists(dest_file):
            _tv_log().warning("Import: file already exists, updating collection: %s", dest_file)
            _update_episode_status(series_title, season, episode, 'available', dest_file, instance_id)
            client_name = client.get('name', 'Download client')
            _add_import_history(series_title, season, episode, client_name, dest_file)
            try:
                _cleanup_source_folder(local_path, root_folder, series_title, season, episode)
            except Exception:
                pass
            return True

        # 6. Move file
        _tv_log().info("Import: moving %s -> %s", video_file, dest_file)
        try:
            shutil.move(video_file, dest_file)
        except Exception as e:
            _tv_log().error("Import: failed to move file: %s -> %s. Reason: %s", video_file, dest_file, e)
            _cleanup_on_import_failure(local_path, root_folder, series_title, season, episode)
            return False

        # 7. Update collection status
        _update_episode_status(series_title, season, episode, 'available', dest_file, instance_id)

        # 8. Add to history
        client_name = client.get('name', 'Download client')
        _add_import_history(series_title, season, episode, client_name, dest_file)

        # 9. Clean up source folder
        try:
            _cleanup_source_folder(local_path, root_folder, series_title, season, episode)
        except Exception:
            pass

        _tv_log().info("Import: completed '%s' S%02dE%02d -> %s",
                        series_title, season or 0, episode or 0, dest_file)
        return True

    except Exception as e:
        _tv_log().exception("Import: error for '%s' S%02dE%02d: %s",
                            series_title, season or 0, episode or 0, e)
        try:
            local_path = locals().get('local_path')
            root_folder = locals().get('root_folder')
            if local_path and root_folder:
                _cleanup_on_import_failure(local_path, root_folder, series_title, season, episode)
        except Exception:
            pass
        return False
