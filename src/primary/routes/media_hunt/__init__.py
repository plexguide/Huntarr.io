"""Media Hunt routes – shared logic for Movie Hunt and TV Hunt.

Exports movie_hunt_bp and tv_hunt_bp with all routes registered.
"""
from flask import Blueprint

from ...utils.logger import get_logger

movie_hunt_bp = Blueprint("movie_hunt", __name__)
tv_hunt_bp = Blueprint("tv_hunt", __name__)

movie_hunt_logger = get_logger("movie_hunt")
tv_hunt_logger = get_logger("tv_hunt")

# --- Movie Hunt routes ---
from .helpers import _get_movie_hunt_instance_id_from_request
from .instances import register_movie_instances_routes  # noqa: E402
register_movie_instances_routes(movie_hunt_bp)  # noqa: E402
from .indexers import register_movie_indexers_routes
register_movie_indexers_routes(movie_hunt_bp, _get_movie_hunt_instance_id_from_request)  # noqa: E402
from .profiles import register_movie_profiles_routes
register_movie_profiles_routes(movie_hunt_bp, _get_movie_hunt_instance_id_from_request)  # noqa: E402
from .clients import register_movie_clients_routes
register_movie_clients_routes(movie_hunt_bp, _get_movie_hunt_instance_id_from_request)  # noqa: E402
from .custom_formats import register_movie_custom_formats_routes
register_movie_custom_formats_routes(movie_hunt_bp, _get_movie_hunt_instance_id_from_request)  # noqa: E402
from .activity_movie import register_movie_activity_routes
register_movie_activity_routes(movie_hunt_bp)  # noqa: E402
from .discovery_movie import register_movie_discovery_routes
register_movie_discovery_routes(movie_hunt_bp)  # noqa: E402
from .storage import register_movie_storage_routes
register_movie_storage_routes(movie_hunt_bp, _get_movie_hunt_instance_id_from_request)  # noqa: E402
from .sizes import register_movie_sizes_routes
register_movie_sizes_routes(movie_hunt_bp)  # noqa: E402
from .import_lists_movie import register_movie_import_lists_routes
register_movie_import_lists_routes(movie_hunt_bp)  # noqa: E402
from .import_media_movie import register_movie_import_media_routes
register_movie_import_media_routes(movie_hunt_bp)  # noqa: E402
from .stream_routes import register_movie_stream_routes
register_movie_stream_routes(movie_hunt_bp)  # noqa: E402

# --- TV Hunt routes ---
from .helpers import _get_tv_hunt_instance_id_from_request  # noqa: E402
from .instances import register_tv_instances_routes  # noqa: E402
register_tv_instances_routes(tv_hunt_bp)  # noqa: E402
from .indexers import register_tv_indexers_routes  # noqa: E402
register_tv_indexers_routes(tv_hunt_bp, _get_tv_hunt_instance_id_from_request)  # noqa: E402
from .profiles import register_tv_profiles_routes  # noqa: E402
register_tv_profiles_routes(tv_hunt_bp, _get_tv_hunt_instance_id_from_request)  # noqa: E402
from .clients import register_tv_clients_routes  # noqa: E402
register_tv_clients_routes(tv_hunt_bp, _get_tv_hunt_instance_id_from_request)  # noqa: E402
from .activity import register_tv_activity_routes  # noqa: E402
register_tv_activity_routes(tv_hunt_bp, _get_tv_hunt_instance_id_from_request)  # noqa: E402
from .discovery_tv import register_tv_discovery_routes  # noqa: E402
register_tv_discovery_routes(tv_hunt_bp)  # noqa: E402
from .storage import register_tv_storage_routes  # noqa: E402
register_tv_storage_routes(tv_hunt_bp, _get_tv_hunt_instance_id_from_request)  # noqa: E402
from .custom_formats import register_tv_custom_formats_routes  # noqa: E402
register_tv_custom_formats_routes(tv_hunt_bp, _get_tv_hunt_instance_id_from_request)  # noqa: E402
from .import_lists_tv import register_tv_import_lists_routes  # noqa: E402
register_tv_import_lists_routes(tv_hunt_bp)  # noqa: E402
from .import_media_tv import register_tv_import_media_routes  # noqa: E402
register_tv_import_media_routes(tv_hunt_bp)  # noqa: E402
from .settings_routes import register_tv_settings_routes  # noqa: E402
register_tv_settings_routes(tv_hunt_bp)  # noqa: E402
from .sizes import register_tv_sizes_routes  # noqa: E402
register_tv_sizes_routes(tv_hunt_bp, _get_tv_hunt_instance_id_from_request)  # noqa: E402
