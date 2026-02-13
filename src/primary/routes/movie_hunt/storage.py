"""Movie Hunt storage — re-exports from media_hunt for backward compatibility.

Routes are registered via media_hunt.storage.register_movie_storage_routes in __init__.
"""
from ..media_hunt.storage import (
    get_movie_root_folders_config as _get_root_folders_config,
    get_detected_movies_from_all_roots as _get_detected_movies_from_all_roots,
    _VIDEO_EXTENSIONS,
)
