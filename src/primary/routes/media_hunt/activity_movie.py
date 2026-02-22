"""Movie Hunt activity routes: queue management, import/completion, background poller."""

import os
import threading
import requests
from datetime import datetime

from flask import request, jsonify

from .helpers import (
    _get_movie_hunt_instance_id_from_request,
    _get_movie_hunt_instance_display_name,
    _instance_name_to_category,
    _download_client_base_url,
    _extract_quality_from_filename,
    _extract_formats_from_filename,
    _format_queue_scoring,
    _format_queue_display_name,
    _blocklist_normalize_source_title,
    _get_blocklist_raw,
    _blocklist_add,
    _blocklist_remove,
    _get_requested_queue_ids,
    _get_requested_display,
    MOVIE_HUNT_DEFAULT_CATEGORY,
    movie_hunt_logger,
)
from .clients import get_movie_clients_config
from ...utils.logger import logger


# --- NZB Hunt history lookup ---

def _get_nzb_hunt_history_item(queue_id):
    """Get the full history item from NZB Hunt by queue ID."""
    try:
        from src.primary.apps.nzb_hunt.download_manager import get_manager
        mgr = get_manager()
        history = mgr.get_history()
        for h in history:
            if h.get('id') == queue_id:
                return h
        return None
    except Exception as e:
        movie_hunt_logger.error("Import: error getting NZB Hunt history item %s: %s", queue_id, e)
        return None


def _get_nzb_hunt_completed_path(queue_id, title, year, instance_id):
    """Get the completed download path from NZB Hunt history."""
    try:
        from src.primary.apps.nzb_hunt.download_manager import get_manager
        mgr = get_manager()

        history = mgr.get_history()
        history_item = None
        for h in history:
            if h.get('id') == queue_id:
                history_item = h
                break

        if not history_item:
            movie_hunt_logger.warning(
                "Import: NZB Hunt item %s not found in history for '%s'", queue_id, title
            )
            return None

        state = history_item.get('state', '')
        if state != 'completed':
            movie_hunt_logger.warning(
                "Import: NZB Hunt item %s for '%s' not completed (state: %s)", queue_id, title, state
            )
            return None

        folders = mgr._get_folders()
        download_dir = folders.get("download_folder", "/downloads")

        category = history_item.get('category', '')
        if category:
            cat_folder = mgr._get_category_folder(category)
            if cat_folder:
                download_dir = cat_folder

        item_name = history_item.get('name', '')
        safe_name = "".join(c for c in item_name if c.isalnum() or c in " ._-")[:100].strip()
        if not safe_name:
            safe_name = queue_id

        download_path = os.path.join(download_dir, safe_name)

        movie_hunt_logger.info(
            "Import: NZB Hunt download '%s' completed, path: %s", title, download_path
        )

        return download_path

    except Exception as e:
        movie_hunt_logger.error("Import: error getting NZB Hunt path for '%s': %s", title, e)
        return None


# --- Import completed downloads ---

def _check_and_import_completed(client_name, queue_item, instance_id):
    """Check if a removed queue item completed successfully and trigger import."""
    try:
        clients = get_movie_clients_config(instance_id)
        client = next((c for c in clients if (c.get('name') or '').strip() == client_name), None)

        if not client:
            movie_hunt_logger.warning("Import: download client '%s' not found in config", client_name)
            return

        client_type = (client.get('type') or 'nzbhunt').strip().lower()
        queue_id = queue_item.get('id')
        title = queue_item.get('title', '').strip()
        year = queue_item.get('year', '').strip()

        if not title:
            movie_hunt_logger.warning("Import: queue item %s has no title, skipping import", queue_id)
            return

        release_name = ''

        # ── NZB Hunt (built-in) ──
        if client_type in ('nzbhunt', 'nzb_hunt'):
            movie_hunt_logger.info(
                "Import: item left NZB Hunt queue (id=%s, title='%s'). Checking NZB Hunt history.",
                queue_id, title
            )
            nzb_hunt_history = _get_nzb_hunt_history_item(queue_id)

            if not nzb_hunt_history:
                movie_hunt_logger.warning(
                    "Import: NZB Hunt item %s not found in history for '%s'", queue_id, title
                )
                return

            nzb_state = nzb_hunt_history.get('state', '')

            if nzb_state == 'failed':
                source_title = (nzb_hunt_history.get('name') or '').strip()
                if source_title and source_title.endswith('.nzb'):
                    source_title = source_title[:-4]
                reason_failed = (nzb_hunt_history.get('error_message') or '').strip() or 'Download failed'
                _blocklist_add(
                    movie_title=title, year=year,
                    source_title=source_title,
                    reason_failed=reason_failed,
                    instance_id=instance_id
                )
                movie_hunt_logger.warning(
                    "Import: NZB Hunt download '%s' (%s) FAILED (state: %s, reason: %s). "
                    "Added to blocklist so a different release will be chosen next time.",
                    title, year, nzb_state, reason_failed[:100]
                )
                return

            if nzb_state != 'completed':
                movie_hunt_logger.warning(
                    "Import: NZB Hunt item %s for '%s' not completed (state: %s), skipping",
                    queue_id, title, nzb_state
                )
                return

            download_path = _get_nzb_hunt_completed_path(queue_id, title, year, instance_id)
            if not download_path:
                return

            release_name = (nzb_hunt_history.get('name') or '').strip()
            if release_name and release_name.endswith('.nzb'):
                release_name = release_name[:-4]

        # ── Tor Hunt / qBittorrent ──
        elif client_type in ('torhunt', 'tor_hunt', 'qbittorrent'):
            movie_hunt_logger.info(
                "Import: item left Tor Hunt queue (hash=%s, title='%s'). Checking Tor Hunt.",
                queue_id, title
            )

            download_path = _get_tor_hunt_completed_path(queue_id, title, year, instance_id)
            if not download_path:
                # Check if torrent errored
                try:
                    from src.primary.apps.tor_hunt.tor_hunt_manager import get_manager
                    tor_mgr = get_manager()
                    queue = tor_mgr.get_queue()
                    for t in queue:
                        if t.get('hash', '') == queue_id:
                            state = t.get('raw_state', '')
                            if state == 'error':
                                source_title = (t.get('name') or '').strip()
                                reason_failed = f"Torrent error: {t.get('error_msg', 'unknown')}"
                                _blocklist_add(
                                    movie_title=title, year=year,
                                    source_title=source_title,
                                    reason_failed=reason_failed,
                                    instance_id=instance_id
                                )
                                movie_hunt_logger.warning(
                                    "Import: Tor Hunt download '%s' (%s) FAILED (state: %s). Added to blocklist.",
                                    title, year, state
                                )
                            break
                except Exception:
                    pass
                return

            release_name = ''
            try:
                from src.primary.apps.tor_hunt.tor_hunt_manager import get_manager
                tor_mgr = get_manager()
                queue = tor_mgr.get_queue()
                for t in queue:
                    if t.get('hash', '') == queue_id:
                        release_name = (t.get('name') or '').strip()
                        break
                if not release_name:
                    history = tor_mgr.get_history()
                    for h in history:
                        if h.get('hash', '') == queue_id:
                            release_name = (h.get('name') or '').strip()
                            break
            except Exception:
                pass

        # ── Unsupported client type ──
        else:
            movie_hunt_logger.debug("Import: unsupported client type: %s", client_type)
            return

        movie_hunt_logger.info("Import: attempting import for '%s' (%s) from path: %s", title, year, download_path)

        from src.primary.apps.movie_hunt.importer import import_movie

        def _do_import():
            try:
                success = import_movie(
                    client=client,
                    title=title,
                    year=year,
                    download_path=download_path,
                    instance_id=instance_id,
                    release_name=release_name,
                )
                if success:
                    movie_hunt_logger.info("Import: successfully imported '%s' (%s)", title, year)
                else:
                    movie_hunt_logger.error("Import: failed to import '%s' (%s)", title, year)
            except Exception as e:
                movie_hunt_logger.exception("Import: error for '%s' (%s): %s", title, year, e)

        import_thread = threading.Thread(target=_do_import, daemon=True)
        import_thread.start()

    except Exception as e:
        movie_hunt_logger.exception("Import: error checking completed download: %s", e)


def _prune_requested_queue_ids(client_name, current_queue_ids, instance_id):
    """Remove from our requested list any id no longer in the client's queue. Trigger import for completed items."""
    from src.primary.utils.database import get_database
    db = get_database()
    config = db.get_app_config_for_instance('movie_hunt_requested', instance_id)
    if not config or not isinstance(config.get('by_client'), dict):
        return
    cname = (client_name or 'Download client').strip() or 'Download client'
    if cname not in config['by_client']:
        return
    current = set(str(i) for i in current_queue_ids)
    entries = config['by_client'][cname]
    kept = []
    removed = []

    for e in entries:
        eid = e.get('id') if isinstance(e, dict) else str(e)
        if str(eid) in current:
            kept.append(e)
        else:
            removed.append(e)

    config['by_client'][cname] = kept
    db.save_app_config_for_instance('movie_hunt_requested', instance_id, config)

    if removed:
        movie_hunt_logger.info(
            "Import: %s item(s) left queue for client '%s', checking history and running import.",
            len(removed), client_name
        )
    for item in removed:
        if isinstance(item, dict):
            _check_and_import_completed(client_name, item, instance_id)


# --- Queue fetching from download clients ---

def _get_nzb_hunt_queue(client, client_name, instance_id):
    """Fetch queue from the built-in NZB Hunt download engine."""
    try:
        from src.primary.apps.nzb_hunt.download_manager import get_manager
        mgr = get_manager()
        queue_items = mgr.get_queue()

        raw_cat = (client.get('category') or '').strip()
        raw_cat_lower = raw_cat.lower()
        if raw_cat_lower in ('default', '*', ''):
            client_cat_lower = MOVIE_HUNT_DEFAULT_CATEGORY.lower()
        else:
            client_cat_lower = raw_cat_lower

        requested_ids = _get_requested_queue_ids(instance_id).get(client_name, set())

        items = []
        current_queue_ids = set()

        for q in queue_items:
            q_cat = (q.get('category') or '').strip().lower()
            q_id = q.get('id', '')

            if q_id:
                current_queue_ids.add(str(q_id))

            if q_cat and q_cat != client_cat_lower:
                continue

            if requested_ids and str(q_id) not in requested_ids:
                continue

            nzb_name = q.get('name', '-')
            display = _get_requested_display(client_name, q_id, instance_id)
            display_name = _format_queue_display_name(nzb_name, display.get('title'), display.get('year'))
            scoring_str = _format_queue_scoring(display.get('score'), display.get('score_breakdown'))

            progress_pct = q.get('progress_pct', 0)
            if progress_pct >= 100:
                progress = 'Pending Import'
            elif progress_pct > 0:
                progress = f'{progress_pct:.0f}%'
            else:
                progress = '-'

            time_left = q.get('time_left', '') or '-'

            quality_str = _extract_quality_from_filename(nzb_name)
            formats_str = _extract_formats_from_filename(nzb_name)

            items.append({
                'id': q_id,
                'movie': display_name,
                'title': display_name,
                'year': None,
                'languages': '-',
                'quality': quality_str,
                'formats': formats_str,
                'scoring': scoring_str,
                'time_left': time_left,
                'progress': progress,
                'instance_name': client_name,
                'original_release': nzb_name,
            })

        _prune_requested_queue_ids(client_name, current_queue_ids, instance_id)

        return items
    except Exception as e:
        logger.debug("NZB Hunt queue error: %s", e)
        return []


def _get_tor_hunt_queue(client, client_name, instance_id):
    """Fetch queue from the built-in Tor Hunt torrent engine."""
    try:
        from src.primary.apps.tor_hunt.tor_hunt_manager import get_manager
        mgr = get_manager()
        if not mgr.has_connection():
            return []

        raw_cat = (client.get('category') or '').strip()
        inst_name = _get_movie_hunt_instance_display_name(instance_id)
        if inst_name:
            client_cat = _instance_name_to_category(inst_name, "Movies")
        elif raw_cat.lower() in ('default', '*', ''):
            client_cat = MOVIE_HUNT_DEFAULT_CATEGORY
        else:
            client_cat = raw_cat

        # Built-in engine returns pre-formatted queue items
        all_torrents = mgr.get_queue(category=client_cat)
        requested_ids = _get_requested_queue_ids(instance_id).get(client_name, set())

        items = []
        current_queue_ids = set()

        for t in all_torrents:
            t_hash = t.get('hash', '')
            t_id = t.get('id', t_hash)
            if t_hash:
                current_queue_ids.add(str(t_hash))

            if requested_ids and str(t_hash) not in requested_ids:
                continue

            torrent_name = t.get('name', '-')
            display = _get_requested_display(client_name, t_hash, instance_id)
            display_name = _format_queue_display_name(
                torrent_name, display.get('title'), display.get('year'))
            scoring_str = _format_queue_scoring(display.get('score'), display.get('score_breakdown'))

            progress_pct = t.get('progress', 0)
            if progress_pct >= 100:
                progress = 'Pending Import'
            elif progress_pct > 0:
                progress = f'{progress_pct:.0f}%'
            else:
                progress = '-'

            quality_str = _extract_quality_from_filename(torrent_name)
            formats_str = _extract_formats_from_filename(torrent_name)

            items.append({
                'id': t_hash,
                'movie': display_name,
                'title': display_name,
                'year': None,
                'languages': '-',
                'quality': quality_str,
                'formats': formats_str,
                'scoring': scoring_str,
                'time_left': t.get('time_left', '-'),
                'progress': progress,
                'instance_name': client_name,
                'original_release': torrent_name,
            })

        _prune_requested_queue_ids(client_name, current_queue_ids, instance_id)
        return items
    except Exception as e:
        logger.debug("Tor Hunt queue error: %s", e)
        return []


def _get_tor_hunt_completed_path(torrent_hash, title, year, instance_id):
    """Get the completed download path from the built-in Tor Hunt engine."""
    try:
        from src.primary.apps.tor_hunt.tor_hunt_manager import get_manager
        mgr = get_manager()
        if not mgr.has_connection():
            return None

        # Check queue for completed/seeding torrents
        queue = mgr.get_queue()
        for t in queue:
            if t.get('hash', '') == torrent_hash:
                progress = t.get('progress', 0)
                state = t.get('raw_state', '')
                if state in ('seeding', 'completed') or progress >= 99:
                    content_path = t.get('content_path', '') or t.get('save_path', '')
                    if content_path:
                        movie_hunt_logger.info("Import: Tor Hunt download '%s' completed, path: %s", title, content_path)
                        return content_path
                    movie_hunt_logger.error("Import: no content_path for torrent %s ('%s')", torrent_hash, title)
                    return None
                else:
                    movie_hunt_logger.warning(
                        "Import: Tor Hunt torrent %s for '%s' not completed (progress: %.1f%%, state: %s)",
                        torrent_hash, title, progress, state
                    )
                    return None

        # Check history
        history = mgr.get_history()
        for h in history:
            if h.get('hash', '') == torrent_hash:
                content_path = h.get('content_path', '') or h.get('save_path', '')
                if content_path:
                    movie_hunt_logger.info("Import: Tor Hunt download '%s' found in history, path: %s", title, content_path)
                    return content_path

        movie_hunt_logger.warning("Import: Tor Hunt torrent %s not found for '%s'", torrent_hash, title)
        return None
    except Exception as e:
        movie_hunt_logger.error("Import: error getting Tor Hunt path for '%s': %s", title, e)
        return None


def _get_download_client_queue(client, instance_id):
    """Fetch queue from one download client (NZB Hunt or Tor Hunt/qBittorrent)."""
    client_type = (client.get('type') or 'nzbhunt').strip().lower()
    name = (client.get('name') or 'Download client').strip() or 'Download client'

    if client_type in ('nzbhunt', 'nzb_hunt'):
        return _get_nzb_hunt_queue(client, name, instance_id)

    if client_type in ('torhunt', 'tor_hunt', 'qbittorrent'):
        return _get_tor_hunt_queue(client, name, instance_id)

    movie_hunt_logger.debug("Queue: unsupported client type '%s' for '%s'", client_type, name)
    return []


def _delete_from_download_client(client, item_ids):
    """Delete queue items from one download client by id(s). Returns (removed_count, error_message)."""
    if not item_ids:
        return 0, None
    client_type = (client.get('type') or 'nzbhunt').strip().lower()
    name = (client.get('name') or 'Download client').strip() or 'Download client'

    if client_type in ('nzbhunt', 'nzb_hunt'):
        try:
            from src.primary.apps.nzb_hunt.download_manager import get_manager
            mgr = get_manager()
            removed = 0
            for iid in item_ids:
                if mgr.remove_item(str(iid)):
                    removed += 1
            failed = len(item_ids) - removed
            err = ('Failed to remove %d item(s) from %s' % (failed, name)) if failed else None
            return removed, err
        except Exception as e:
            return 0, str(e) or 'Delete failed'

    if client_type in ('torhunt', 'tor_hunt', 'qbittorrent'):
        try:
            from src.primary.apps.tor_hunt.tor_hunt_manager import get_manager as get_tor_manager
            tor_mgr = get_tor_manager()
            removed = 0
            for iid in item_ids:
                if tor_mgr.delete_torrent(str(iid), delete_files=False):
                    removed += 1
            failed = len(item_ids) - removed
            err = ('Failed to remove %d item(s) from %s' % (failed, name)) if failed else None
            return removed, err
        except Exception as e:
            return 0, str(e) or 'Delete failed'

    return 0, f'Unsupported client type: {client_type}'


# --- Background poller ---

_movie_hunt_poller_thread = None
_movie_hunt_poller_started = False
_movie_hunt_poller_lock = threading.Lock()
_MOVIE_HUNT_POLL_INTERVAL_SEC = 90


def _movie_hunt_poll_completions():
    """Fetch queue from all clients to trigger prune/import check."""
    try:
        from src.primary.utils.database import get_database
        db = get_database()
        instance_id = db.get_current_movie_hunt_instance_id()
        _get_activity_queue(instance_id)
    except Exception as e:
        movie_hunt_logger.debug("Movie Hunt background poll: %s", e)


def _ensure_movie_hunt_poller_started():
    """Start the Movie Hunt completion poller thread once (thread-safe)."""
    global _movie_hunt_poller_thread, _movie_hunt_poller_started
    if _movie_hunt_poller_started:
        return
    with _movie_hunt_poller_lock:
        # Double-check after acquiring lock
        if _movie_hunt_poller_started:
            return
        _movie_hunt_poller_started = True

    def _run():
        import time
        while True:
            time.sleep(_MOVIE_HUNT_POLL_INTERVAL_SEC)
            try:
                _movie_hunt_poll_completions()
            except Exception:
                pass

    _movie_hunt_poller_thread = threading.Thread(target=_run, daemon=True)
    _movie_hunt_poller_thread.start()
    movie_hunt_logger.debug("Import: background poll started (every %s s) to detect completed downloads.", _MOVIE_HUNT_POLL_INTERVAL_SEC)


def _auto_start_poller():
    """Auto-start the completion poller after a brief delay on app boot."""
    def _delayed_start():
        import time
        time.sleep(30)
        _ensure_movie_hunt_poller_started()
    t = threading.Thread(target=_delayed_start, daemon=True)
    t.start()

# Auto-start the poller when this module is imported (i.e., on app boot)
_auto_start_poller()


def _get_activity_queue(instance_id):
    """Fetch queue from Movie Hunt download clients only. 100% independent of Radarr."""
    if not instance_id:
        return [], 0
    _ensure_movie_hunt_poller_started()
    clients = get_movie_clients_config(instance_id)
    enabled = [c for c in clients if c.get('enabled', True)]
    if not enabled:
        return [], 0
    all_items = []
    for client in enabled:
        items = _get_download_client_queue(client, instance_id)
        all_items.extend(items)
    return all_items, len(all_items)


def _remove_activity_queue_items(items, instance_id):
    """Remove selected items from Movie Hunt download client queue."""
    if not items or not isinstance(items, list):
        return False, 'No items selected'
    clients = get_movie_clients_config(instance_id)
    enabled = [c for c in clients if c.get('enabled', True)]
    if not enabled:
        return False, 'No download clients configured or enabled'
    by_name = {}
    for it in items:
        if not isinstance(it, dict):
            continue
        iid = it.get('id')
        name = (it.get('instance_name') or 'Default').strip()
        if iid is None:
            continue
        by_name.setdefault(name, []).append(iid)
    if not by_name:
        return False, 'No valid items selected'
    client_by_name = {(c.get('name') or 'Download client').strip() or 'Download client': c for c in enabled}
    removed = 0
    errors = []
    for name, ids in by_name.items():
        client = client_by_name.get(name)
        if not client:
            errors.append(name)
            continue
        try:
            n, err = _delete_from_download_client(client, ids)
            removed += n
            if err:
                errors.append(name)
        except Exception as e:
            logger.debug("Movie Hunt remove selected for %s: %s", name, e)
            errors.append(name)
    if errors:
        return removed > 0, ('Removed %d item(s). Failed for: %s' % (removed, ', '.join(errors))) if removed else ('Failed for: %s' % ', '.join(errors))
    return True, None


def _clear_activity_queue(instance_id):
    """Remove all items from Movie Hunt download client queue."""
    all_items, _ = _get_activity_queue(instance_id)
    if not all_items:
        return True, None
    to_remove = [{'id': i.get('id'), 'instance_name': i.get('instance_name') or 'Download client'} for i in all_items if i.get('id') is not None]
    if not to_remove:
        return True, None
    return _remove_activity_queue_items(to_remove, instance_id)


# --- Routes ---

def register_movie_activity_routes(bp):
    @bp.route('/api/activity/<view>', methods=['GET'])
    def api_activity_get(view):
        """Get activity items (queue, history, or blocklist)."""
        if view not in ('queue', 'history', 'blocklist'):
            return jsonify({'error': 'Invalid view'}), 400
        page = max(1, request.args.get('page', 1, type=int))
        page_size = max(1, min(100, request.args.get('page_size', 20, type=int)))
        search = (request.args.get('search') or '').strip().lower()
    
        if view == 'queue':
            instance_id = _get_movie_hunt_instance_id_from_request()
            all_items, total = _get_activity_queue(instance_id)
            if search:
                all_items = [i for i in all_items if search in (i.get('movie') or '').lower() or search in str(i.get('year') or '').lower()]
                total = len(all_items)
            else:
                total = len(all_items)
            total_pages = max(1, (total + page_size - 1) // page_size)
            start = (page - 1) * page_size
            page_items = all_items[start:start + page_size]
            return jsonify({
                'items': page_items,
                'total': total,
                'page': page,
                'total_pages': total_pages
            }), 200
    
        if view == 'history':
            try:
                from src.primary.history_manager import get_history
                instance_id = _get_movie_hunt_instance_id_from_request()
                instance_name = str(instance_id) if instance_id is not None else None
                result = get_history('movie_hunt', search_query=search if search else None, page=page, page_size=page_size, instance_name=instance_name)
    
                history_items = []
                for entry in result.get('entries', []):
                    processed_info = entry.get('processed_info', '')
                    title_part = processed_info.split(' → ')[0] if ' → ' in processed_info else processed_info
    
                    history_items.append({
                        'id': entry.get('id'),
                        'movie': title_part,
                        'title': title_part,
                        'year': '',
                        'languages': '-',
                        'quality': '-',
                        'formats': '-',
                        'date': entry.get('date_time_readable', ''),
                        'instance_name': entry.get('instance_name', 'Download client'),
                    })
    
                return jsonify({
                    'items': history_items,
                    'total': result.get('total_entries', 0),
                    'page': page,
                    'total_pages': result.get('total_pages', 1)
                }), 200
    
            except Exception as e:
                logger.error(f"Error getting Movie Hunt history: {e}")
                return jsonify({
                    'items': [],
                    'total': 0,
                    'page': page,
                    'total_pages': 1
                }), 200
    
        if view == 'blocklist':
            instance_id = _get_movie_hunt_instance_id_from_request()
            all_entries = _get_blocklist_raw(instance_id)
            if search:
                q = search
                all_entries = [
                    e for e in all_entries
                    if q in (e.get('movie_title') or '').lower() or q in (e.get('source_title') or '').lower() or q in (e.get('reason_failed') or '').lower()
                ]
            total = len(all_entries)
            total_pages = max(1, (total + page_size - 1) // page_size)
            start = (page - 1) * page_size
            page_entries = all_entries[start:start + page_size]
            items = []
            for e in page_entries:
                ts = e.get('date_added')
                if isinstance(ts, (int, float)):
                    try:
                        dt = datetime.utcfromtimestamp(ts)
                        date_str = dt.strftime('%b %d %Y')
                    except Exception:
                        date_str = str(ts)
                else:
                    date_str = str(ts) if ts else '-'
                items.append({
                    'movie': (e.get('movie_title') or '').strip() or '-',
                    'movie_title': (e.get('movie_title') or '').strip(),
                    'source_title': (e.get('source_title') or '').strip(),
                    'reason_failed': (e.get('reason_failed') or '').strip() or 'Download failed',
                    'date': date_str,
                })
            return jsonify({
                'items': items,
                'total': total,
                'page': page,
                'total_pages': total_pages
            }), 200
    
        return jsonify({
            'items': [],
            'total': 0,
            'page': page,
            'total_pages': 1
        }), 200
    
    
    @bp.route('/api/activity/<view>', methods=['DELETE'])
    def api_activity_delete(view):
        """Remove selected queue items or blocklist entries."""
        if view not in ('queue', 'history', 'blocklist'):
            return jsonify({'error': 'Invalid view'}), 400
        if view == 'queue':
            instance_id = _get_movie_hunt_instance_id_from_request()
            body = request.get_json(silent=True) or {}
            items = body.get('items') if isinstance(body, dict) else None
            if not items or not isinstance(items, list) or len(items) == 0:
                return jsonify({'success': False, 'error': 'No items selected'}), 200
            success, err_msg = _remove_activity_queue_items(items, instance_id)
            if not success and err_msg:
                return jsonify({'success': False, 'error': err_msg}), 200
            return jsonify({'success': True}), 200
        if view == 'blocklist':
            body = request.get_json(silent=True) or {}
            source_titles = []
            if isinstance(body.get('source_title'), str):
                source_titles.append(body['source_title'].strip())
            for it in (body.get('items') or []):
                if isinstance(it, dict) and (it.get('source_title') or '').strip():
                    source_titles.append(it['source_title'].strip())
            if not source_titles:
                return jsonify({'success': False, 'error': 'No blocklist entry specified (source_title)'}), 200
            instance_id = _get_movie_hunt_instance_id_from_request()
            _blocklist_remove(source_titles, instance_id)
            return jsonify({'success': True}), 200
        return jsonify({'success': True}), 200
