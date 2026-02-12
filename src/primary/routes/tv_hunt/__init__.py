"""TV Hunt routes package."""
from flask import Blueprint

from ...utils.logger import logger, get_logger

tv_hunt_logger = get_logger("tv_hunt")
tv_hunt_bp = Blueprint("tv_hunt", __name__)

# Import sub-modules to register their routes on tv_hunt_bp
from . import instances       # noqa: E402, F401
from . import indexers        # noqa: E402, F401
from . import profiles        # noqa: E402, F401
from . import clients         # noqa: E402, F401
from . import activity        # noqa: E402, F401
from . import discovery       # noqa: E402, F401
from . import storage         # noqa: E402, F401
from . import custom_formats  # noqa: E402, F401