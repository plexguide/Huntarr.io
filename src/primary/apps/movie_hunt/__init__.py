"""
Movie Hunt app module for Huntarr.
Provides the unique API for Movie Hunt (Activity queue, etc.) so the rest of the app
does not depend on apps/radarr directly. Movie Hunt backend is configured via Radarr
instances; this module is the only place that talks to Radarr for Movie Hunt features.
"""

from src.primary.apps.movie_hunt.api import (
    get_instances,
    get_queue,
    delete_queue_bulk,
    queue_record_to_activity_item,
)

__all__ = [
    'get_instances',
    'get_queue',
    'delete_queue_bulk',
    'queue_record_to_activity_item',
]
