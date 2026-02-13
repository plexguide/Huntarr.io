"""Shared helpers for Import Media (movie and TV). Reduces duplication between import_media_movie and import_media_tv."""

import os
import re

# Base video extensions (used by both movie and TV)
VIDEO_EXTENSIONS = frozenset(
    ('.mkv', '.mp4', '.avi', '.m4v', '.ts', '.wmv', '.flv', '.mov', '.webm', '.mpg', '.mpeg', '.m2ts')
)
# Movie-specific extras (e.g. .iso, .vob)
EXTRA_VIDEO_EXTENSIONS = frozenset(('.iso', '.vob', '.divx', '.rmvb', '.3gp'))


def is_video_file(filename: str, extra_extensions: frozenset = None) -> bool:
    """Check if a file has a video extension."""
    if not filename:
        return False
    _, ext = os.path.splitext(filename)
    ext = ext.lower()
    if ext in VIDEO_EXTENSIONS:
        return True
    if extra_extensions and ext in extra_extensions:
        return True
    return False


def should_skip_folder(name: str, skip_pattern: re.Pattern) -> bool:
    """Check if a folder should be skipped (samples, extras, system folders)."""
    return bool(skip_pattern.match(name)) if name else False


def year_range_pattern():
    """Shared regex for extracting year from names."""
    return re.compile(r'\b(19\d{2}|20\d{2})\b')


def tmdb_pattern():
    """Shared regex for TMDB ID in folder names."""
    return re.compile(r'\{tmdb-(\d+)\}|\[tmdb[-=](\d+)\]|tmdbid[-=](\d+)', re.IGNORECASE)
