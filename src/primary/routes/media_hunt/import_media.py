"""Import Media — movie and TV import from disk.

Storage triggers background scans when adding root folders; this module
provides the entry points used by media_hunt.storage.
"""
from .import_media_movie import run_import_media_scan as run_movie_import_media_scan
from .import_media_tv import run_import_media_scan as run_tv_import_media_scan

__all__ = ['run_movie_import_media_scan', 'run_tv_import_media_scan']
