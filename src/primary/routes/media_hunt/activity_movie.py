"""Movie Hunt activity routes: queue management, import/completion, background poller."""

import os
import threading
import requests
from datetime import datetime

from flask import request, jsonify

from .helpers import (
    _get_movie_hunt_instance_id_from_request,
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


# --- SABnzbd history lookup ---

def _get_sabnzbd_history_item(client, queue_id):
    """Get a specific item from SABnzbd history by nzo_id."""
    try:
        base_url = _download_client_base_url(client)
        if not base_url:
            return None

        api_key = (client.get('api_key') or '').strip()
        url = f"{base_url}/api"
        params = {'mode': 'history', 'output': 'json', 'limit': 500}
        if api_key:
            params['apikey'] = api_key

        from src.primary.settings_manager import get_ssl_verify_setting
        verify_ssl = get_ssl_verify_setting()

        r = requests.get(url, params=params, timeout=10, verify=verify_ssl)
        r.raise_for_status()
        data = r.json()

        raw_slots = data.get('history', {}).get('slots', [])
        if isinstance(raw_slots, dict):
            slots = list(raw_slots.values())
        elif isinstance(raw_slots, list):
            slots = raw_slots
        else:
            slots = []

        def _normalize_nzo_id(nzo_id):
            s = str(nzo_id).strip()
            for prefix in ('SABnzbd_nzo_', 'sabnzbd_nzo_'):
                if s.lower().startswith(prefix.lower()):
                    return s[len(prefix):].strip()
            return s

        queue_id_str = str(queue_id).strip()
        queue_id_norm = _normalize_nzo_id(queue_id_str)
        for slot in slots:
            if not isinstance(slot, dict):
                continue
            slot_id = slot.get('nzo_id') or slot.get('id')
            if slot_id is None:
                continue
            slot_id_str = str(slot_id).strip()
            if slot_id_str == queue_id_str or _normalize_nzo_id(slot_id_str) == queue_id_norm:
                return {
                    'status': slot.get('status', ''),
                    'storage': slot.get('storage', ''),
                    'name': slot.get('name', ''),
                    'category': slot.get('category', ''),
                    'fail_message': (slot.get('fail_message') or '').strip() or '',
                    'nzb_name': (slot.get('nzb_name') or '').strip() or ''
                }

        sample_ids = [str(s.get('nzo_id') or s.get('id')) for s in slots[:5] if isinstance(s, dict)]
        movie_hunt_logger.info(
            "Import: nzo_id %s not found in SAB history (history has %s entries). Sample ids: %s",
            queue_id_str, len(slots), sample_ids
        )
        return None

    except Exception as e:
        movie_hunt_logger.error("Import: error fetching SABnzbd history for queue id %s: %s", queue_id, e)
        return None


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

        client_type = (client.get('type') or 'nzbget').strip().lower()
        queue_id = queue_item.get('id')
        title = queue_item.get('title', '').strip()
        year = queue_item.get('year', '').strip()

        if not title:
            movie_hunt_logger.warning("Import: queue item %s has no title, skipping import", queue_id)
            return

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

        # ── SABnzbd ──
        elif client_type == 'sabnzbd':
            movie_hunt_logger.info(
                "Import: item left queue (nzo_id=%s, title='%s'). Checking SAB history for completed download.",
                queue_id, title
            )
            history_item = _get_sabnzbd_history_item(client, queue_id)

            if not history_item:
                movie_hunt_logger.warning(
                    "Import: item left queue but not found in SAB history (nzo_id=%s, title='%s'). "
                    "If the download completed in SAB, refresh the Queue page to trigger another check, or SAB may use a different id in history.",
                    queue_id, title
                )
                return

            status = history_item.get('status', '')
            storage_path = (history_item.get('storage') or '').strip()
            movie_hunt_logger.info(
                "Import: download completed for '%s' (%s). SAB status=%s, SAB storage path=%s",
                title, year or 'no year', status, storage_path or '(empty)'
            )

            if status.lower() != 'completed':
                source_title = (history_item.get('name') or history_item.get('nzb_name') or '').strip()
                if source_title and source_title.endswith('.nzb'):
                    source_title = source_title[:-4]
                reason_failed = (history_item.get('fail_message') or '').strip() or status or 'Download failed'
                _blocklist_add(movie_title=title, year=year, source_title=source_title, reason_failed=reason_failed, instance_id=instance_id)
                movie_hunt_logger.warning(
                    "Import: download '%s' (%s) did not complete (status: %s). Added to blocklist: %s",
                    title, year, status, source_title or '(no name)'
                )
                return

            download_path = storage_path

            if not download_path:
                movie_hunt_logger.error("Import: no storage path in history for '%s' (%s). Cannot import.", title, year)
                return

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
                    instance_id=instance_id
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
            "Import: %s item(s) left queue for client '%s', checking SAB history and running import.",
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


def _get_download_client_queue(client, instance_id):
    """Fetch queue from one download client (NZB Hunt, SABnzbd, or NZBGet)."""
    client_type = (client.get('type') or 'nzbget').strip().lower()
    name = (client.get('name') or 'Download client').strip() or 'Download client'

    if client_type in ('nzbhunt', 'nzb_hunt'):
        return _get_nzb_hunt_queue(client, name, instance_id)

    base_url = _download_client_base_url(client)
    if not base_url:
        return []
    raw_cat = (client.get('category') or '').strip()
    raw_cat_lower = raw_cat.lower()
    if raw_cat_lower in ('default', '*', ''):
        client_cat_lower = MOVIE_HUNT_DEFAULT_CATEGORY.lower()
    else:
        client_cat_lower = raw_cat_lower
    allowed_cats = frozenset((client_cat_lower,))
    requested_ids = _get_requested_queue_ids(instance_id).get(name, set())
    try:
        from src.primary.settings_manager import get_ssl_verify_setting
        verify_ssl = get_ssl_verify_setting()
    except Exception:
        verify_ssl = True
    items = []
    current_queue_ids = set()
    try:
        if client_type == 'sabnzbd':
            api_key = (client.get('api_key') or '').strip()
            url = '%s/api' % base_url
            params = {'mode': 'queue', 'output': 'json'}
            if api_key:
                params['apikey'] = api_key
            movie_hunt_logger.debug("Queue: requesting SABnzbd queue from %s (%s)", name, base_url)
            try:
                r = requests.get(url, params=params, timeout=15, verify=verify_ssl)
                r.raise_for_status()
            except requests.RequestException as e:
                movie_hunt_logger.warning("Queue: SABnzbd request failed for %s: %s", name, e)
                return []
            data = r.json()
            if not isinstance(data, dict):
                movie_hunt_logger.warning("Queue: SABnzbd returned non-dict for %s", name)
                return []
            sab_error = data.get('error') or data.get('error_msg')
            if sab_error:
                movie_hunt_logger.warning("Queue: SABnzbd %s returned error: %s", name, sab_error)
                return []
            slots_raw = (data.get('queue') or {}).get('slots') or data.get('slots') or []
            if isinstance(slots_raw, dict):
                slots = list(slots_raw.values())
            elif isinstance(slots_raw, list):
                slots = slots_raw
            else:
                slots = []
            if not slots and (data.get('queue') or data):
                movie_hunt_logger.debug("Queue: SABnzbd %s returned 0 slots (response keys: %s)", name, list(data.keys()))
            for slot in slots:
                if not isinstance(slot, dict):
                    continue
                nzo_id = slot.get('nzo_id') or slot.get('id')
                if nzo_id is not None:
                    current_queue_ids.add(str(nzo_id))
                slot_cat = (slot.get('category') or slot.get('cat') or '').strip().lower()
                if slot_cat not in allowed_cats:
                    continue
                if nzo_id is None:
                    continue
                if str(nzo_id) not in requested_ids:
                    continue
                filename = (slot.get('filename') or slot.get('name') or '-').strip()
                if not filename:
                    filename = '-'
                display = _get_requested_display(name, nzo_id, instance_id)
                display_name = _format_queue_display_name(filename, display.get('title'), display.get('year'))
                scoring_str = _format_queue_scoring(display.get('score'), display.get('score_breakdown'))
                size_mb = slot.get('mb') or slot.get('size') or 0
                try:
                    size_mb = float(size_mb)
                except (TypeError, ValueError):
                    size_mb = 0
                mbleft = slot.get('mbleft')
                try:
                    mbleft = float(mbleft) if mbleft is not None else None
                except (TypeError, ValueError):
                    mbleft = None
                size_bytes = size_mb * (1024 * 1024) if size_mb else 0
                bytes_left = None
                if mbleft is not None and size_mb and size_mb > 0:
                    bytes_left = mbleft * (1024 * 1024)
                else:
                    raw_left = slot.get('bytes_left') or slot.get('sizeleft') or slot.get('size_left')
                    try:
                        bytes_left = float(raw_left) if raw_left is not None else None
                    except (TypeError, ValueError):
                        bytes_left = None
                if size_bytes and size_bytes > 0 and bytes_left is not None:
                    try:
                        pct = round((float(size_bytes - bytes_left) / float(size_bytes)) * 100)
                        progress = str(min(100, max(0, pct))) + '%'
                    except (TypeError, ZeroDivisionError):
                        progress = '-'
                else:
                    progress = slot.get('percentage') or '-'
                if progress == '100%':
                    progress = 'Pending Import'
                time_left = slot.get('time_left') or slot.get('timeleft') or '-'
                quality_str = _extract_quality_from_filename(filename)
                formats_str = _extract_formats_from_filename(filename)
                items.append({
                    'id': nzo_id,
                    'movie': display_name,
                    'title': display_name,
                    'year': None,
                    'languages': '-',
                    'quality': quality_str,
                    'formats': formats_str,
                    'scoring': scoring_str,
                    'time_left': time_left,
                    'progress': progress,
                    'instance_name': name,
                    'original_release': filename,
                })
            _prune_requested_queue_ids(name, current_queue_ids, instance_id)
        elif client_type == 'nzbget':
            jsonrpc_url = '%s/jsonrpc' % base_url
            username = (client.get('username') or '').strip()
            password = (client.get('password') or '').strip()
            auth = (username, password) if (username or password) else None
            payload = {'method': 'listgroups', 'params': [0], 'id': 1}
            r = requests.post(jsonrpc_url, json=payload, auth=auth, timeout=15, verify=verify_ssl)
            r.raise_for_status()
            data = r.json()
            result = data.get('result') if isinstance(data.get('result'), list) else []
            for grp in result:
                if not isinstance(grp, dict):
                    continue
                nzb_id = grp.get('NZBID') or grp.get('ID')
                if nzb_id is not None:
                    current_queue_ids.add(str(nzb_id))
                grp_cat = (grp.get('Category') or grp.get('category') or '').strip().lower()
                if grp_cat not in allowed_cats:
                    continue
                if nzb_id is None:
                    continue
                if str(nzb_id) not in requested_ids:
                    continue
                nzb_name = (grp.get('NZBName') or grp.get('NZBFilename') or grp.get('Name') or '-').strip()
                if not nzb_name:
                    nzb_name = '-'
                display = _get_requested_display(name, nzb_id, instance_id)
                display_name = _format_queue_display_name(nzb_name, display.get('title'), display.get('year'))
                scoring_str = _format_queue_scoring(display.get('score'), display.get('score_breakdown'))
                size_mb = grp.get('FileSizeMB') or 0
                try:
                    size_mb = float(size_mb)
                except (TypeError, ValueError):
                    size_mb = 0
                remaining_mb = grp.get('RemainingSizeMB') or 0
                try:
                    remaining_mb = float(remaining_mb)
                except (TypeError, ValueError):
                    remaining_mb = 0
                if size_mb and size_mb > 0 and remaining_mb is not None:
                    try:
                        pct = round((float(size_mb - remaining_mb) / float(size_mb)) * 100)
                        progress = str(min(100, max(0, pct))) + '%'
                    except (TypeError, ZeroDivisionError):
                        progress = '-'
                else:
                    progress = '-'
                if progress == '100%':
                    progress = 'Pending Import'
                quality_str = _extract_quality_from_filename(nzb_name)
                formats_str = _extract_formats_from_filename(nzb_name)
                items.append({
                    'id': nzb_id,
                    'movie': display_name,
                    'title': display_name,
                    'year': None,
                    'languages': '-',
                    'quality': quality_str,
                    'formats': formats_str,
                    'scoring': scoring_str,
                    'time_left': '-',
                    'progress': progress,
                    'instance_name': name,
                    'original_release': nzb_name,
                })
            _prune_requested_queue_ids(name, current_queue_ids, instance_id)
    except Exception as e:
        logger.debug("Movie Hunt activity queue from download client %s: %s", name, e)
    return items


def _delete_from_download_client(client, item_ids):
    """Delete queue items from one download client by id(s). Returns (removed_count, error_message)."""
    if not item_ids:
        return 0, None
    client_type = (client.get('type') or 'nzbget').strip().lower()
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

    base_url = _download_client_base_url(client)
    if not base_url:
        return 0, 'Invalid client'
    try:
        from src.primary.settings_manager import get_ssl_verify_setting
        verify_ssl = get_ssl_verify_setting()
    except Exception:
        verify_ssl = True
    removed = 0
    try:
        if client_type == 'sabnzbd':
            api_key = (client.get('api_key') or '').strip()
            url = '%s/api' % base_url
            for iid in item_ids:
                params = {'mode': 'queue', 'name': 'delete', 'value': str(iid), 'output': 'json'}
                if api_key:
                    params['apikey'] = api_key
                r = requests.get(url, params=params, timeout=15, verify=verify_ssl)
                r.raise_for_status()
                data = r.json()
                if data.get('status') is True and not data.get('error'):
                    removed += 1
                else:
                    err = data.get('error') or data.get('error_msg')
                    if err:
                        movie_hunt_logger.warning("Queue: SABnzbd delete failed for %s: %s", name, err)
        elif client_type == 'nzbget':
            jsonrpc_url = '%s/jsonrpc' % base_url
            username = (client.get('username') or '').strip()
            password = (client.get('password') or '').strip()
            auth = (username, password) if (username or password) else None
            ids_int = []
            for iid in item_ids:
                try:
                    ids_int.append(int(iid))
                except (TypeError, ValueError):
                    pass
            if ids_int:
                payload = {'method': 'editqueue', 'params': ['GroupDelete', '', ids_int], 'id': 1}
                r = requests.post(jsonrpc_url, json=payload, auth=auth, timeout=15, verify=verify_ssl)
                r.raise_for_status()
                data = r.json()
                if data.get('result') is True:
                    removed = len(ids_int)
    except Exception as e:
        return removed, str(e) or 'Delete failed'
    failed = len(item_ids) - removed
    err = ('Failed to remove %d item(s) from %s' % (failed, name)) if failed else None
    return removed, err


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
        movie_hunt_logger.debug("Queue: no download clients configured or enabled. Add SABnzbd/NZBGet/NZB Hunt in Settings -> Movie Hunt -> Clients (total in config: %s).", len(clients))
        return [], 0
    movie_hunt_logger.debug("Queue: fetching from %s download client(s)", len(enabled))
    all_items = []
    for client in enabled:
        items = _get_download_client_queue(client, instance_id)
        all_items.extend(items)
    if all_items:
        movie_hunt_logger.debug("Queue: returning %s item(s) from download client(s)", len(all_items))
    else:
        movie_hunt_logger.debug("Queue: no items in download client(s)")
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
