"""
TV Hunt app module for Huntarr.
TV Hunt is its own thing and does not tie to Sonarr.
Manages TV series with seasons and episodes independently.
Activity (Queue, History, Blocklist) uses only TV Hunt's download clients
and tv_hunt_collection. No Sonarr API usage.
"""

from src.primary.apps.tv_hunt.api import get_instances, get_configured_instances

__all__ = ['get_instances', 'get_configured_instances']
