"""
Media Hunt RSS Decision Engine — match releases to collection, evaluate, grab.

This module processes RSS releases fetched by rss_sync.py:
1. Match releases to collection items (by TMDb/TVDb ID or fuzzy title)
2. Evaluate quality, size, custom format scores against profile
3. Send approved releases to download client
4. Track processed GUIDs to avoid re-grabbing
"""

import re
import datetime
import logging

from src.primary.utils.logger import get_logger


def _normalize_title(title):
    """Normalize title for fuzzy matching: lowercase, strip non-alphanumeric."""
    if not title:
        return ''
    t = re.sub(r'[^\w\s]', ' ', title.lower().strip())
    return ' '.join(t.split())


def _extract_year_from_title(title):
    """Try to extract a 4-digit year from a release title."""
    m = re.search(r'\b(19\d{2}|20\d{2})\b', title or '')
    return int(m.group(1)) if m else 0


def _parse_series_info(title):
    """Parse S00E00 from release title. Returns (season, episode) or (0, 0)."""
    m = re.search(r'[Ss](\d{1,2})[Ee](\d{1,3})', title or '')
    if m:
        return int(m.group(1)), int(m.group(2))
    return 0, 0


def match_movie_releases_to_collection(releases, collection_items):
    """
    Match parsed RSS releases to movie collection items.

    Matching priority:
    1. TMDb ID from newznab attr
    2. Fuzzy title + year match

    Returns list of (release, collection_item) pairs.
    """
    if not releases or not collection_items:
        return []

    tmdb_lookup = {}
    title_year_lookup = {}

    for item in collection_items:
        tmdb_id = item.get('tmdb_id') or item.get('tmdbId') or 0
        try:
            tmdb_id = int(tmdb_id)
        except (TypeError, ValueError):
            tmdb_id = 0
        if tmdb_id:
            tmdb_lookup[tmdb_id] = item

        title = _normalize_title(item.get('title', ''))
        year = item.get('year') or item.get('release_year') or 0
        try:
            year = int(year)
        except (TypeError, ValueError):
            year = 0
        if title:
            title_year_lookup[(title, year)] = item

    matched = []
    for rel in releases:
        coll_item = None

        rel_tmdb = rel.get('tmdb_id', 0)
        if rel_tmdb and rel_tmdb in tmdb_lookup:
            coll_item = tmdb_lookup[rel_tmdb]
        else:
            rel_title = _normalize_title(rel.get('title', ''))
            rel_year = _extract_year_from_title(rel.get('title', ''))
            for (ct, cy), ci in title_year_lookup.items():
                if rel_year and cy and rel_year != cy:
                    continue
                if ct and ct in rel_title:
                    coll_item = ci
                    break

        if coll_item:
            matched.append((rel, coll_item))

    return matched


def match_tv_releases_to_collection(releases, collection_series):
    """
    Match parsed RSS releases to TV collection series/episodes.

    Matching priority:
    1. TVDb ID from newznab attr
    2. Fuzzy series title match + S00E00 parsing

    Returns list of (release, series_item, season, episode) tuples.
    """
    if not releases or not collection_series:
        return []

    tvdb_lookup = {}
    title_lookup = {}

    for series in collection_series:
        tvdb_id = series.get('tvdb_id') or series.get('tvdbId') or 0
        try:
            tvdb_id = int(tvdb_id)
        except (TypeError, ValueError):
            tvdb_id = 0
        if tvdb_id:
            tvdb_lookup[tvdb_id] = series

        title = _normalize_title(series.get('title', ''))
        if title:
            title_lookup[title] = series

    matched = []
    for rel in releases:
        series_item = None

        rel_tvdb = rel.get('tvdb_id', 0)
        if rel_tvdb and rel_tvdb in tvdb_lookup:
            series_item = tvdb_lookup[rel_tvdb]
        else:
            rel_title = _normalize_title(rel.get('title', ''))
            for st, si in title_lookup.items():
                if st and st in rel_title:
                    series_item = si
                    break

        if series_item:
            season = rel.get('season', 0)
            episode = rel.get('episode', 0)
            if not season and not episode:
                season, episode = _parse_series_info(rel.get('title', ''))
            matched.append((rel, series_item, season, episode))

    return matched


def evaluate_movie_release(release, collection_item, instance_id, log=None):
    """
    Evaluate whether a movie release should be grabbed.

    Checks:
    - Is the item monitored?
    - Is it missing (not available) or is this an upgrade candidate?
    - Quality profile match
    - Size within limits
    - Custom format score meets minimum

    Returns (approved, reason, score).
    """
    if log is None:
        log = get_logger('movie_hunt')

    monitored = collection_item.get('monitored', True)
    if not monitored:
        return False, 'Not monitored', 0

    has_file = collection_item.get('hasFile', False) or collection_item.get('has_file', False)
    is_available = collection_item.get('available', False)

    profile_name = collection_item.get('quality_profile') or collection_item.get('qualityProfileId') or ''

    from src.primary.routes.media_hunt.helpers import _movie_profiles_context
    from src.primary.routes.media_hunt.profiles import (
        get_profile_by_name_or_default,
        release_matches_quality,
        size_filter_and_preference,
        score_release,
    )

    ctx = _movie_profiles_context()
    profile = get_profile_by_name_or_default(str(profile_name), instance_id, ctx)

    rel_title = release.get('title', '')

    enabled_qualities = [
        q.get('name', '') for q in (profile.get('qualities') or [])
        if q.get('enabled')
    ]

    quality_matched = False
    matched_quality_name = ''
    for qname in enabled_qualities:
        if release_matches_quality(rel_title, qname):
            quality_matched = True
            matched_quality_name = qname
            break

    if not quality_matched and enabled_qualities:
        return False, 'Quality not in profile', 0

    runtime = collection_item.get('runtime') or 90
    passes_size, size_pref = size_filter_and_preference(
        release, matched_quality_name, runtime, instance_id, ctx
    )
    if not passes_size:
        return False, 'Size outside limits', 0

    cf_score, cf_breakdown = score_release(rel_title, profile, instance_id, ctx)
    min_cf_score = profile.get('min_custom_format_score', 0)
    if cf_score < min_cf_score:
        return False, f'CF score {cf_score} below minimum {min_cf_score}', cf_score

    total_score = cf_score + (size_pref or 0)

    if has_file and is_available:
        upgrades_allowed = profile.get('upgrades_allowed', True)
        if not upgrades_allowed:
            return False, 'Already have file, upgrades disabled', total_score
        return True, 'Upgrade candidate', total_score

    return True, 'Missing/wanted', total_score


def evaluate_tv_release(release, series_item, season, episode, instance_id, log=None):
    """
    Evaluate whether a TV release should be grabbed.

    Returns (approved, reason, score).
    """
    if log is None:
        log = get_logger('tv_hunt')

    monitored = series_item.get('monitored', True)
    if not monitored:
        return False, 'Series not monitored', 0

    profile_name = series_item.get('quality_profile') or series_item.get('qualityProfileId') or ''

    from src.primary.routes.media_hunt.profiles import (
        get_profile_by_name_or_default,
        release_matches_quality,
        size_filter_and_preference,
        score_release,
    )

    ctx = {
        'profiles_config_key': 'tv_hunt_profiles',
        'sizes_config_key': 'tv_hunt_sizes',
        'use_profile_id': True,
        'get_custom_formats': None,
    }
    try:
        from src.primary.routes.media_hunt.custom_formats import get_tv_custom_formats_config
        ctx['get_custom_formats'] = get_tv_custom_formats_config
    except ImportError:
        pass

    profile = get_profile_by_name_or_default(str(profile_name), instance_id, ctx)

    rel_title = release.get('title', '')

    enabled_qualities = [
        q.get('name', '') for q in (profile.get('qualities') or [])
        if q.get('enabled')
    ]

    quality_matched = False
    matched_quality_name = ''
    for qname in enabled_qualities:
        if release_matches_quality(rel_title, qname):
            quality_matched = True
            matched_quality_name = qname
            break

    if not quality_matched and enabled_qualities:
        return False, 'Quality not in profile', 0

    runtime = 45
    passes_size, size_pref = size_filter_and_preference(
        release, matched_quality_name, runtime, instance_id, ctx
    )
    if not passes_size:
        return False, 'Size outside limits', 0

    cf_score, cf_breakdown = score_release(rel_title, profile, instance_id, ctx)
    min_cf_score = profile.get('min_custom_format_score', 0)
    if cf_score < min_cf_score:
        return False, f'CF score {cf_score} below minimum {min_cf_score}', cf_score

    total_score = cf_score + (size_pref or 0)
    return True, 'Wanted', total_score


def _get_processed_guids(instance_id, hunt_type):
    """Get set of already-processed GUIDs for this instance (TTL: 24 hours)."""
    from src.primary.utils.database import get_database
    db = get_database()
    config_key = f'{hunt_type}_rss_processed_guids'
    config = db.get_app_config_for_instance(config_key, instance_id)
    if not config or not isinstance(config, dict):
        return set(), {}
    entries = config.get('entries', {})
    now = datetime.datetime.utcnow()
    ttl_hours = 24
    active = {}
    for guid, ts_str in entries.items():
        try:
            ts = datetime.datetime.fromisoformat(ts_str.replace('Z', '+00:00'))
            if ts.tzinfo:
                ts = ts.replace(tzinfo=None)
            if (now - ts).total_seconds() < ttl_hours * 3600:
                active[guid] = ts_str
        except (ValueError, TypeError):
            pass
    return set(active.keys()), active


def _save_processed_guids(instance_id, hunt_type, entries_dict):
    """Save processed GUIDs dict."""
    from src.primary.utils.database import get_database
    db = get_database()
    config_key = f'{hunt_type}_rss_processed_guids'
    db.save_app_config_for_instance(config_key, instance_id, {'entries': entries_dict})


def _grab_movie_release(release, collection_item, instance_id, log):
    """Send a movie release to the download client."""
    from src.primary.routes.media_hunt.clients import get_movie_clients_config
    from src.primary.routes.media_hunt.discovery_movie import _add_nzb_to_download_client
    from src.primary.routes.media_hunt.helpers import MOVIE_HUNT_DEFAULT_CATEGORY

    try:
        from src.primary.settings_manager import get_ssl_verify_setting
        verify_ssl = get_ssl_verify_setting()
    except Exception:
        verify_ssl = True

    clients = get_movie_clients_config(instance_id)
    if not clients:
        log.warning("[RSS Sync] No download clients configured for Movie Hunt instance %s", instance_id)
        return False

    client = clients[0]
    nzb_url = release.get('nzb_url', '')
    title = release.get('title', 'Unknown')
    indexer_name = release.get('indexer_name', '')

    success, message, queue_id = _add_nzb_to_download_client(
        client, nzb_url, title, MOVIE_HUNT_DEFAULT_CATEGORY,
        verify_ssl, indexer=indexer_name, instance_id=instance_id
    )

    if success:
        log.info("[RSS Sync] Grabbed: %s via %s", title, client.get('name') or client.get('type', 'client'))
    else:
        log.warning("[RSS Sync] Failed to grab %s: %s", title, message)

    return success


def _grab_tv_release(release, series_item, instance_id, log):
    """Send a TV release to the download client."""
    from src.primary.routes.media_hunt.clients import get_tv_clients_config
    from src.primary.routes.media_hunt.helpers import TV_HUNT_DEFAULT_CATEGORY, _instance_name_to_category, _get_tv_hunt_instance_display_name

    try:
        from src.primary.settings_manager import get_ssl_verify_setting
        verify_ssl = get_ssl_verify_setting()
    except Exception:
        verify_ssl = True

    clients = get_tv_clients_config(instance_id)
    if not clients:
        log.warning("[RSS Sync] No download clients configured for TV Hunt instance %s", instance_id)
        return False

    client = clients[0]
    client_type = (client.get('type') or 'nzbget').strip().lower()
    nzb_url = release.get('nzb_url', '')
    title = release.get('title', 'Unknown')

    inst_name = _get_tv_hunt_instance_display_name(instance_id) or ""
    if inst_name:
        category = _instance_name_to_category(inst_name, "TV")
    else:
        category = TV_HUNT_DEFAULT_CATEGORY

    success = False
    if client_type in ('nzbhunt', 'nzb_hunt'):
        from src.primary.routes.media_hunt.discovery_tv import _send_to_nzb_hunt
        success, _ = _send_to_nzb_hunt(nzb_url, title, category, instance_id=instance_id)
    elif client_type == 'sabnzbd':
        from src.primary.routes.media_hunt.discovery_tv import _send_to_sabnzbd
        success, _ = _send_to_sabnzbd(client, nzb_url, title, category)
    elif client_type == 'nzbget':
        from src.primary.routes.media_hunt.discovery_tv import _send_to_nzbget
        success, _ = _send_to_nzbget(client, nzb_url, title, category)
    else:
        log.warning("[RSS Sync] Unknown TV download client type: %s", client_type)

    if success:
        log.info("[RSS Sync] Grabbed: %s via %s", title, client.get('name') or client_type)
    else:
        log.warning("[RSS Sync] Failed to grab %s", title)

    return success


def process_rss_sync(instance_id, hunt_type):
    """
    Main orchestrator for one instance's RSS sync cycle.

    1. Load instance config, indexers, collection, download clients
    2. Fetch RSS from all RSS-enabled indexers
    3. Match releases to collection
    4. Evaluate each matched release
    5. Rank approved releases by score (one grab per item per sync)
    6. Send to download client
    7. Log results
    8. Update rss_sync_status with timestamps
    """
    log = get_logger(hunt_type)
    instance_id_int = int(instance_id)

    from src.primary.utils.database import get_database
    db = get_database()

    if hunt_type == 'movie_hunt':
        inst_name_func = 'movie_hunt'
        try:
            from src.primary.routes.media_hunt.helpers import _get_movie_hunt_instance_display_name
            inst_display = _get_movie_hunt_instance_display_name(instance_id_int) or f"Instance {instance_id}"
        except Exception:
            inst_display = f"Instance {instance_id}"
    else:
        inst_name_func = 'tv_hunt'
        try:
            from src.primary.routes.media_hunt.helpers import _get_tv_hunt_instance_display_name
            inst_display = _get_tv_hunt_instance_display_name(instance_id_int) or f"Instance {instance_id}"
        except Exception:
            inst_display = f"Instance {instance_id}"

    log.info("[RSS Sync] Starting RSS sync for %s instance: %s",
             "Movie Hunt" if hunt_type == 'movie_hunt' else "TV Hunt", inst_display)

    # Check if RSS sync is enabled for this instance
    if hunt_type == 'movie_hunt':
        mgmt_config = db.get_app_config_for_instance('movie_management', instance_id_int) or {}
    else:
        mgmt_config = db.get_app_config_for_instance('tv_management', instance_id_int) or {}

    if not mgmt_config.get('rss_sync_enabled', True):
        log.info("[RSS Sync] RSS sync disabled for %s instance %s", hunt_type, inst_display)
        return

    # Fetch RSS releases
    from .rss_sync import fetch_all_rss
    all_releases = fetch_all_rss(instance_id_int, hunt_type, log)

    if not all_releases:
        log.info("[RSS Sync] No releases found from RSS feeds")
        _update_sync_status(instance_id_int, hunt_type, mgmt_config, db)
        return

    # Load processed GUIDs (dedup)
    processed_guids, guid_entries = _get_processed_guids(instance_id_int, hunt_type)
    new_releases = [r for r in all_releases if r.get('guid', '') not in processed_guids]

    if not new_releases:
        log.info("[RSS Sync] All %d releases already processed", len(all_releases))
        _update_sync_status(instance_id_int, hunt_type, mgmt_config, db)
        return

    log.info("[RSS Sync] %d new releases to evaluate (of %d total)", len(new_releases), len(all_releases))

    # Load collection
    if hunt_type == 'movie_hunt':
        config = db.get_app_config_for_instance('movie_hunt_collection', instance_id_int)
        collection_items = (config.get('items') or []) if config else []
        matched = match_movie_releases_to_collection(new_releases, collection_items)
        log.info("[RSS Sync] Matched %d releases to collection items", len(matched))
    else:
        config = db.get_app_config_for_instance('tv_hunt_collection', instance_id_int)
        collection_series = (config.get('series') or []) if config else []
        matched = match_tv_releases_to_collection(new_releases, collection_series)
        log.info("[RSS Sync] Matched %d releases to collection series", len(matched))

    # Evaluate and rank
    approved = []
    rejected_count = 0

    if hunt_type == 'movie_hunt':
        for rel, coll_item in matched:
            ok, reason, score = evaluate_movie_release(rel, coll_item, instance_id_int, log)
            if ok:
                approved.append((rel, coll_item, score, reason))
                log.info("[RSS Sync] Approved: %s (%s) - Score: %d",
                         rel.get('title', '?'), reason, score)
            else:
                rejected_count += 1
                log.debug("[RSS Sync] Rejected: %s - Reason: %s", rel.get('title', '?'), reason)
    else:
        for rel, series_item, season, episode in matched:
            ok, reason, score = evaluate_tv_release(rel, series_item, season, episode, instance_id_int, log)
            if ok:
                approved.append((rel, series_item, score, reason))
                log.info("[RSS Sync] Approved: %s (S%02dE%02d) - Score: %d",
                         rel.get('title', '?'), season, episode, score)
            else:
                rejected_count += 1
                log.debug("[RSS Sync] Rejected: %s - Reason: %s", rel.get('title', '?'), reason)

    # Sort by score descending, then grab best per collection item
    approved.sort(key=lambda x: -x[2])

    grabbed_items = set()
    grabbed_count = 0

    for rel, coll_item, score, reason in approved:
        item_key = coll_item.get('tmdb_id') or coll_item.get('tmdbId') or coll_item.get('tvdb_id') or coll_item.get('title', '')
        if item_key in grabbed_items:
            continue

        if hunt_type == 'movie_hunt':
            success = _grab_movie_release(rel, coll_item, instance_id_int, log)
        else:
            success = _grab_tv_release(rel, coll_item, instance_id_int, log)

        if success:
            grabbed_items.add(item_key)
            grabbed_count += 1

    # Mark all new releases as processed (even unmatched/rejected, to avoid re-evaluating)
    now_iso = datetime.datetime.utcnow().isoformat() + 'Z'
    for rel in new_releases:
        guid = rel.get('guid', '')
        if guid:
            guid_entries[guid] = now_iso
    _save_processed_guids(instance_id_int, hunt_type, guid_entries)

    log.info("[RSS Sync] Completed - Processed: %d, Grabbed: %d, Skipped: %d",
             len(new_releases), grabbed_count, rejected_count)

    _update_sync_status(instance_id_int, hunt_type, mgmt_config, db)


def _update_sync_status(instance_id, hunt_type, mgmt_config, db):
    """Update RSS sync status with last/next sync times."""
    now = datetime.datetime.utcnow()
    interval_minutes = mgmt_config.get('rss_sync_interval_minutes', 15)
    try:
        interval_minutes = max(15, min(60, int(interval_minutes)))
    except (TypeError, ValueError):
        interval_minutes = 15

    next_sync = now + datetime.timedelta(minutes=interval_minutes)

    status = {
        'last_sync_time': now.isoformat() + 'Z',
        'next_sync_time': next_sync.isoformat() + 'Z',
    }

    if hunt_type == 'movie_hunt':
        db.save_app_config_for_instance('rss_sync_status', instance_id, status)
    else:
        db.save_app_config_for_instance('tv_rss_sync_status', instance_id, status)
