"""TV Hunt storage — re-exports from media_hunt for backward compatibility.

Routes are registered via media_hunt.storage.register_tv_storage_routes in __init__.
"""
from ..media_hunt.storage import (
    get_tv_root_folders_config as _get_root_folders_config,
    get_detected_episodes_from_all_roots as _get_detected_episodes_from_all_roots,
)
