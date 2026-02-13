"""TV Hunt routes package."""
from flask import Blueprint

from ...utils.logger import logger, get_logger

tv_hunt_logger = get_logger("tv_hunt")
tv_hunt_bp = Blueprint("tv_hunt", __name__)

# Import sub-modules to register their routes on tv_hunt_bp
from . import instances       # noqa: E402, F401
from . import indexers        # noqa: E402, F401
from ._helpers import _get_tv_hunt_instance_id_from_request
from ..media_hunt.profiles import register_tv_profiles_routes
register_tv_profiles_routes(tv_hunt_bp, _get_tv_hunt_instance_id_from_request)  # noqa: E402
from . import clients         # noqa: E402, F401
from . import activity        # noqa: E402, F401
from . import discovery       # noqa: E402, F401
from . import storage         # noqa: E402, F401
from . import custom_formats  # noqa: E402, F401
from . import import_lists  # noqa: E402, F401
from . import import_media  # noqa: E402, F401
from . import settings_routes  # noqa: E402, F401
from ._helpers import _get_tv_hunt_instance_id_from_request
from ..media_hunt.sizes import register_tv_sizes_routes
register_tv_sizes_routes(tv_hunt_bp, _get_tv_hunt_instance_id_from_request)  # noqa: E402