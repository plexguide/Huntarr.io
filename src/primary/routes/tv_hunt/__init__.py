"""TV Hunt routes package."""
from flask import Blueprint

from ...utils.logger import logger, get_logger

tv_hunt_logger = get_logger("tv_hunt")
tv_hunt_bp = Blueprint("tv_hunt", __name__)

# Import sub-modules to register their routes on tv_hunt_bp
from ._helpers import _get_tv_hunt_instance_id_from_request
from ..media_hunt.instances import register_tv_instances_routes  # noqa: E402
register_tv_instances_routes(tv_hunt_bp)  # noqa: E402
from ..media_hunt.indexers import register_tv_indexers_routes
register_tv_indexers_routes(tv_hunt_bp, _get_tv_hunt_instance_id_from_request)  # noqa: E402
from ..media_hunt.profiles import register_tv_profiles_routes
register_tv_profiles_routes(tv_hunt_bp, _get_tv_hunt_instance_id_from_request)  # noqa: E402
from ..media_hunt.clients import register_tv_clients_routes
register_tv_clients_routes(tv_hunt_bp, _get_tv_hunt_instance_id_from_request)  # noqa: E402
from ..media_hunt.activity import register_tv_activity_routes
register_tv_activity_routes(tv_hunt_bp, _get_tv_hunt_instance_id_from_request)  # noqa: E402
from ..media_hunt.discovery_tv import register_tv_discovery_routes  # noqa: E402
register_tv_discovery_routes(tv_hunt_bp)  # noqa: E402
from ..media_hunt.storage import register_tv_storage_routes
register_tv_storage_routes(tv_hunt_bp, _get_tv_hunt_instance_id_from_request)  # noqa: E402
from . import storage         # noqa: E402, F401 - re-exports for discovery, import_media
from ..media_hunt.custom_formats import register_tv_custom_formats_routes
register_tv_custom_formats_routes(tv_hunt_bp, _get_tv_hunt_instance_id_from_request)  # noqa: E402
from . import import_lists  # noqa: E402, F401
from . import import_media  # noqa: E402, F401
from . import settings_routes  # noqa: E402, F401
from ..media_hunt.sizes import register_tv_sizes_routes
register_tv_sizes_routes(tv_hunt_bp, _get_tv_hunt_instance_id_from_request)  # noqa: E402