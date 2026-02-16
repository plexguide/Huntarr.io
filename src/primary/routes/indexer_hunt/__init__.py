"""Indexer Hunt — centralized indexer management blueprint."""

from flask import Blueprint

indexer_hunt_bp = Blueprint('indexer_hunt', __name__)

# Import route modules so their decorators register on the blueprint
from . import indexers  # noqa: F401, E402
from . import sync      # noqa: F401, E402
from . import stats     # noqa: F401, E402
from . import history   # noqa: F401, E402
from . import health    # noqa: F401, E402
