"""
Movie Hunt: upgrade processing (cutoff/tags).
Movie Hunt does not have Radarr-style quality profiles or cutoff upgrades yet.
This stub returns False so the cycle still runs but skips upgrade step.
"""

from typing import Dict, Any, Callable

from ...utils.logger import get_logger

movie_hunt_logger = get_logger("movie_hunt")


def process_cutoff_upgrades(
    app_settings: Dict[str, Any],
    stop_check: Callable[[], bool],
) -> bool:
    """
    Stub: Movie Hunt does not support upgrade cycles yet (no Radarr API / quality cutoff).
    Returns False so no upgrade processing is done.
    """
    return False
