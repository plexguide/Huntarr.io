"""Media Hunt routes – shared logic for Movie Hunt and TV Hunt (root folders, etc.)."""
from flask import Blueprint

media_hunt_bp = Blueprint("media_hunt", __name__)

# Root folders logic lives in root_folders.py (used by movie_hunt and tv_hunt routes).
# No Media Hunt routes exposed here yet; routes stay on movie_hunt and tv_hunt.
