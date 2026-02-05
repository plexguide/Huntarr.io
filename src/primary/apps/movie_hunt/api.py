"""
Movie Hunt API – unique API for Movie Hunt (Activity queue, etc.).
Movie Hunt is its own thing and does not use Radarr app instances.
Activity (Queue, History, Blocklist) uses only Movie Hunt's own download clients.
100% decoupled from Radarr - Movie Hunt is completely independent.
"""

from typing import Dict, Any, List, Optional


def get_instances(quiet: bool = True) -> List[Dict[str, Any]]:
    """
    Get all configured Movie Hunt instances for Activity (queue, history, blocklist).
    Movie Hunt is 100% independent and does not use Radarr instances.
    This function returns empty list as Movie Hunt uses download clients directly.

    Returns:
        Empty list - Movie Hunt does not use instances, only download clients.
    """
    # Movie Hunt is 100% independent - no instances needed
    # Activity queue uses download clients directly (SABnzbd/NZBGet)
    return []


def get_queue(api_url: str, api_key: str, api_timeout: int,
              page: int = 1, page_size: int = 100) -> Dict[str, Any]:
    """
    Get the download queue for a Movie Hunt instance.
    
    NOTE: This function is not used by Movie Hunt. Movie Hunt uses download clients
    directly (SABnzbd/NZBGet) via the routes in movie_hunt_routes.py.
    This is a stub to maintain API compatibility.

    Returns:
        Empty queue - Movie Hunt does not use this function.
    """
    # Movie Hunt is 100% independent - uses download clients directly
    # This function is not called by Movie Hunt routes
    return {'records': [], 'totalRecords': 0}


def delete_queue_bulk(api_url: str, api_key: str, api_timeout: int, ids: List[int],
                     remove_from_client: bool = True, blocklist: bool = False) -> bool:
    """
    Remove multiple items from a Movie Hunt instance queue.
    
    NOTE: This function is not used by Movie Hunt. Movie Hunt uses download clients
    directly (SABnzbd/NZBGet) via the routes in movie_hunt_routes.py.
    This is a stub to maintain API compatibility.

    Returns:
        False - Movie Hunt does not use this function.
    """
    # Movie Hunt is 100% independent - uses download clients directly
    # This function is not called by Movie Hunt routes
    return False


def queue_record_to_activity_item(record: Dict[str, Any],
                                  instance_name: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """
    Map a Movie Hunt queue API record to Activity queue item format (movie, year, quality, etc.).
    Handles camelCase fields from the backend.
    """
    if not isinstance(record, dict):
        return None
    movie_obj = record.get('movie') or {}
    title = movie_obj.get('title') or record.get('title') or '-'
    year = movie_obj.get('year')
    quality_obj = record.get('quality') or {}
    quality_inner = quality_obj.get('quality') if isinstance(quality_obj, dict) else {}
    quality_name = (quality_inner.get('name') if isinstance(quality_inner, dict) else
                    quality_obj.get('name') if isinstance(quality_obj, dict) else
                    record.get('status') or '-')
    cf = record.get('customFormats') or record.get('custom_formats') or []
    formats_str = ', '.join([x.get('name', '') for x in cf if isinstance(x, dict) and x.get('name')]) if cf else '-'
    size = record.get('size') or 0
    sizeleft = record.get('sizeLeft') or record.get('sizeleft') or 0
    progress = '-'
    if size and size > 0 and sizeleft is not None:
        try:
            pct = round((float(size - sizeleft) / float(size)) * 100)
            progress = str(min(100, max(0, pct))) + '%'
        except (TypeError, ZeroDivisionError):
            pass
    time_left = record.get('timeLeft') or record.get('timeleft') or '-'
    out = {
        'id': record.get('id'),
        'movie': title,
        'title': title,
        'year': year,
        'languages': '-',
        'quality': quality_name or '-',
        'formats': formats_str if formats_str else '-',
        'time_left': time_left,
        'progress': progress,
        'instance_name': instance_name or '',
    }
    return out