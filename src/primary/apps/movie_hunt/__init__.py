"""
Movie Hunt app module for Huntarr.
Movie Hunt is its own thing and does not tie to Radarr app instances.
Activity (Queue, History, Blocklist) uses only Movie Hunt's own download clients
(SABnzbd/NZBGet). 100% decoupled from Radarr - Movie Hunt is completely independent.
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
