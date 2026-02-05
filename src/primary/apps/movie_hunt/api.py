"""
Movie Hunt API – unique API for Movie Hunt (Activity queue, etc.).
Movie Hunt is its own thing and does not use Radarr.
Activity (Queue, History, Blocklist) uses only Movie Hunt's download clients (SABnzbd/NZBGet)
and movie_hunt_collection / movie_hunt_requested; no Radarr coupling.
"""

from typing import Dict, Any, List


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
