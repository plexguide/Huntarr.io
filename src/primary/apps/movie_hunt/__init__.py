"""
Movie Hunt app module for Huntarr.
Movie Hunt is its own thing and does not tie to Radarr.
Activity (Queue, History, Blocklist) uses only Movie Hunt's download clients (NZB Hunt/Tor Hunt)
and movie_hunt_requested / movie_hunt_collection. No Radarr API usage.
"""

from src.primary.apps.movie_hunt.api import get_instances, get_configured_instances

__all__ = ['get_instances', 'get_configured_instances']
