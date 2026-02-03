"""
Movie Hunt API – unique API for Movie Hunt (Activity queue, etc.).
Movie Hunt is its own thing and does not use Radarr app instances.
Activity (Queue, History, Blocklist) uses only Movie Hunt's own instance config.
"""

from typing import Dict, Any, List, Optional

from src.primary.apps.radarr.api import get_queue as _radarr_get_queue
from src.primary.apps.radarr.api import delete_queue_bulk as _radarr_delete_queue_bulk


def get_instances(quiet: bool = True) -> List[Dict[str, Any]]:
    """
    Get all configured Movie Hunt instances for Activity (queue, history, blocklist).
    These are Movie Hunt's own instances, not Radarr app instances.

    Returns:
        List of instance dicts with api_url, api_key, instance_name.
        Empty list if no Movie Hunt instances are configured.
    """
    try:
        from src.primary.utils.database import get_database
        db = get_database()
        config = db.get_app_config('movie_hunt_instances')
        if not config or not isinstance(config.get('instances'), list):
            return []
        instances = []
        for inst in config['instances']:
            if not isinstance(inst, dict):
                continue
            api_url = (inst.get('api_url') or '').strip()
            api_key = (inst.get('api_key') or '').strip()
            if not api_url or not api_key:
                continue
            if not (api_url.startswith('http://') or api_url.startswith('https://')):
                api_url = 'http://' + api_url
            name = (inst.get('name') or inst.get('instance_name') or 'Default').strip() or 'Default'
            instances.append({
                'instance_name': name,
                'api_url': api_url,
                'api_key': api_key,
            })
        return instances
    except Exception:
        return []


def get_queue(api_url: str, api_key: str, api_timeout: int,
              page: int = 1, page_size: int = 100) -> Dict[str, Any]:
    """
    Get the download queue for a Movie Hunt instance.

    Args:
        api_url: Instance API base URL
        api_key: Instance API key
        api_timeout: Request timeout
        page: Page number (1-based)
        page_size: Records per page

    Returns:
        Dict with 'records' (list of queue items) and 'totalRecords' (int).
    """
    return _radarr_get_queue(api_url, api_key, api_timeout, page=page, page_size=page_size)


def delete_queue_bulk(api_url: str, api_key: str, api_timeout: int, ids: List[int],
                     remove_from_client: bool = True, blocklist: bool = False) -> bool:
    """
    Remove multiple items from a Movie Hunt instance queue (and from download client if requested).

    Args:
        api_url: Instance API base URL
        api_key: Instance API key
        api_timeout: Request timeout
        ids: Queue record ids to remove
        remove_from_client: If True, also remove from download client (e.g. SABnzbd)
        blocklist: If True, add release to blocklist

    Returns:
        True if the request succeeded, False otherwise.
    """
    return _radarr_delete_queue_bulk(
        api_url, api_key, api_timeout, ids,
        remove_from_client=remove_from_client, blocklist=blocklist,
    )


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