"""
Movie Hunt app module for Huntarr.
Movie Hunt is its own thing and does not tie to Radarr.
Activity (Queue, History, Blocklist) uses only Movie Hunt's download clients (SABnzbd/NZBGet)
and movie_hunt_requested / movie_hunt_collection. No Radarr API usage.
"""

from src.primary.apps.movie_hunt.api import get_instances

__all__ = ['get_instances']
