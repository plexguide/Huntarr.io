"""Exempt tag filtering and processed-item filtering for app modules."""

from src.primary.stateful_manager import is_processed


def filter_exempt_items(items, exempt_tags, api_module, api_url, api_key,
                        api_timeout, get_tags_fn, get_id_fn, get_title_fn,
                        app_type, logger):
    """Filter out items whose parent entity has an exempt tag.

    Works for all apps -- caller provides lambdas to extract tags/id/title
    from their specific item dicts.

    Args:
        items: List of item dicts to filter
        exempt_tags: List of tag label strings from settings (e.g. ["no-hunt"])
        api_module: App API module with get_exempt_tag_ids(url, key, timeout, tags)
        api_url: API URL
        api_key: API key
        api_timeout: Request timeout
        get_tags_fn: Callable(item) -> list of tag IDs on the item/parent
        get_id_fn: Callable(item) -> item ID for logging
        get_title_fn: Callable(item) -> item title for logging
        app_type: e.g. "radarr" (for log messages)
        logger: Logger instance

    Returns:
        Filtered list with exempt items removed.
    """
    if not exempt_tags or not items:
        return items

    exempt_id_to_label = api_module.get_exempt_tag_ids(
        api_url, api_key, api_timeout, exempt_tags
    )
    if not exempt_id_to_label:
        return items

    filtered = []
    for item in items:
        tags = get_tags_fn(item)
        skip = False
        for tid in tags:
            if tid in exempt_id_to_label:
                logger.info(
                    'Skipping "%s" (ID: %s) - has exempt tag "%s"',
                    get_title_fn(item), get_id_fn(item),
                    exempt_id_to_label[tid]
                )
                skip = True
                break
        if not skip:
            filtered.append(item)

    logger.info(
        "Exempt tags filter: %d %s items remaining after excluding items with exempt tags.",
        len(filtered), app_type
    )
    return filtered


def filter_unprocessed(items, app_type, instance_key, get_id_fn, logger):
    """Filter to items not already processed in this cycle.

    Args:
        items: List of item dicts
        app_type: e.g. "radarr"
        instance_key: Instance key for processed-item tracking
        get_id_fn: Callable(item) -> unique ID string for the item
        logger: Logger instance

    Returns:
        Filtered list with already-processed items removed.
    """
    if not items:
        return items

    unprocessed = []
    for item in items:
        item_id = str(get_id_fn(item))
        if not is_processed(app_type, instance_key, item_id):
            unprocessed.append(item)

    skipped = len(items) - len(unprocessed)
    if skipped:
        logger.debug(
            "Skipped %d already-processed %s items (instance: %s).",
            skipped, app_type, instance_key
        )
    return unprocessed
