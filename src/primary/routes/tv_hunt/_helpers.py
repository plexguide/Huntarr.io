"""TV Hunt shared helpers."""

from flask import request
from ...utils.logger import logger

TV_HUNT_DEFAULT_CATEGORY = "tv"


def _get_tv_hunt_instance_id_from_request():
    """Resolve TV Hunt instance_id from query or JSON body."""
    instance_id = request.args.get('instance_id')
    if instance_id is None:
        data = request.get_json(silent=True) or {}
        instance_id = data.get('instance_id')
    if instance_id is None:
        from src.primary.utils.database import get_database
        db = get_database()
        instance_id = db.get_current_tv_hunt_instance_id()
    if instance_id is not None:
        try:
            instance_id = int(instance_id)
        except (TypeError, ValueError):
            instance_id = 0
    return instance_id or 0


def _get_blocklist_source_titles(instance_id):
    """Return set of normalized source titles on the blocklist for this instance."""
    from src.primary.utils.database import get_database
    db = get_database()
    config = db.get_app_config_for_instance('tv_hunt_blocklist', instance_id)
    if not config or not isinstance(config.get('items'), list):
        return set()
    return {_blocklist_normalize_source_title(it.get('source_title') or '') for it in config['items'] if it.get('source_title')}


def _blocklist_normalize_source_title(title):
    """Normalize a source title for blocklist comparison."""
    return (title or '').strip().lower()


def _add_requested_queue_id(instance_id, queue_id):
    """Track a queue_id that was requested by TV Hunt."""
    if not queue_id:
        return
    from src.primary.utils.database import get_database
    db = get_database()
    config = db.get_app_config_for_instance('tv_hunt_requested_queue_ids', instance_id)
    if not config or not isinstance(config, dict):
        config = {'ids': []}
    ids = config.get('ids') or []
    if queue_id not in ids:
        ids.append(queue_id)
        # Keep last 200 queue IDs
        if len(ids) > 200:
            ids = ids[-200:]
    config['ids'] = ids
    db.save_app_config_for_instance('tv_hunt_requested_queue_ids', instance_id, config)
