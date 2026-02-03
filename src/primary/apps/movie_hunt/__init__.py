"""
Movie Hunt app module for Huntarr.
Movie Hunt is its own thing and does not tie to Radarr app instances.
Activity (Queue, History, Blocklist) uses only Movie Hunt's own instance config
(movie_hunt_instances in DB). This module is the only place that talks to Radarr
API for queue/delete when Movie Hunt instances are Radarr-compatible backends.
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
