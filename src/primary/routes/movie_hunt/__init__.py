"""Movie Hunt routes package."""
from flask import Blueprint

from ...utils.logger import logger, get_logger

movie_hunt_logger = get_logger("movie_hunt")
movie_hunt_bp = Blueprint("movie_hunt", __name__)

# Import sub-modules to register their routes on movie_hunt_bp
from ._helpers import _get_movie_hunt_instance_id_from_request
from ..media_hunt.instances import register_movie_instances_routes  # noqa: E402
register_movie_instances_routes(movie_hunt_bp)  # noqa: E402
from ..media_hunt.indexers import register_movie_indexers_routes
register_movie_indexers_routes(movie_hunt_bp, _get_movie_hunt_instance_id_from_request)  # noqa: E402
from ..media_hunt.profiles import register_movie_profiles_routes
register_movie_profiles_routes(movie_hunt_bp, _get_movie_hunt_instance_id_from_request)  # noqa: E402
from ..media_hunt.clients import register_movie_clients_routes
register_movie_clients_routes(movie_hunt_bp, _get_movie_hunt_instance_id_from_request)  # noqa: E402
from ..media_hunt.custom_formats import register_movie_custom_formats_routes
register_movie_custom_formats_routes(movie_hunt_bp, _get_movie_hunt_instance_id_from_request)  # noqa: E402
from . import activity        # noqa: E402, F401
from ..media_hunt.discovery_movie import register_movie_discovery_routes  # noqa: E402
register_movie_discovery_routes(movie_hunt_bp)  # noqa: E402
from ..media_hunt.storage import register_movie_storage_routes
register_movie_storage_routes(movie_hunt_bp, _get_movie_hunt_instance_id_from_request)  # noqa: E402
from . import storage         # noqa: E402, F401 - re-exports for discovery, import_media
from ..media_hunt.sizes import register_movie_sizes_routes
register_movie_sizes_routes(movie_hunt_bp)  # noqa: E402
from . import import_lists    # noqa: E402, F401
from . import import_media    # noqa: E402, F401
