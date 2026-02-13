"""Import Media — thin wrapper delegating to movie_hunt and tv_hunt.

Storage triggers background scans when adding root folders; this module
provides the entry points used by media_hunt.storage.
"""
from src.primary.routes.movie_hunt.import_media import run_import_media_scan as run_movie_import_media_scan
from src.primary.routes.tv_hunt.import_media import run_import_media_scan as run_tv_import_media_scan

__all__ = ['run_movie_import_media_scan', 'run_tv_import_media_scan']
