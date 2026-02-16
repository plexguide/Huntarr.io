"""
Media Hunt – TV Hunt activity routes (queue, history, blocklist).
Includes completion detection and auto-import for TV episodes,
mirroring the movie hunt activity pipeline.
"""

import os
import threading
import uuid as _uuid
from datetime import datetime

import requests
from flask import request, jsonify

from ...utils.logger import logger


def register_tv_activity_routes(bp, get_instance_id):
    """Register TV Hunt activity routes: queue, history, blocklist, and queue polling with import."""
    from src.primary.utils.database import get_database
    from .helpers import (
        _download_client_base_url,
        _extract_quality_from_filename,
        _extract_formats_from_filename,
        _get_tv_requested_queue_ids,
        TV_HUNT_DEFAULT_CATEGORY,
        tv_hunt_logger,
    )
    from .clients import get_tv_clients_config

    # ── Queue Polling Helpers (same pattern as movie_hunt/activity_movie.py) ──

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
            tv_hunt_logger.error("Import: error getting NZB Hunt history item %s: %s", queue_id, e)
            return None

    def _get_nzb_hunt_completed_path(queue_id, series_title, instance_id):
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
                tv_hunt_logger.warning("Import: NZB Hunt item %s not found in history for '%s'", queue_id, series_title)
                return None
            state = history_item.get('state', '')
            if state != 'completed':
                tv_hunt_logger.warning("Import: NZB Hunt item %s for '%s' not completed (state: %s)", queue_id, series_title, state)
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
            tv_hunt_logger.info("Import: NZB Hunt download '%s' completed, path: %s", series_title, download_path)
            return download_path
        except Exception as e:
            tv_hunt_logger.error("Import: error getting NZB Hunt path for '%s': %s", series_title, e)
            return None

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
                        'nzb_name': (slot.get('nzb_name') or '').strip() or '',
                    }
            return None
        except Exception as e:
            tv_hunt_logger.error("Import: error fetching SABnzbd history for TV queue id %s: %s", queue_id, e)
            return None

    def _tv_blocklist_add(series_title, source_title, reason_failed, instance_id):
        """Add a release to the TV Hunt blocklist."""
        try:
            db = get_database()
            config = db.get_app_config_for_instance('tv_hunt_blocklist', instance_id)
            if not config or not isinstance(config.get('items'), list):
                config = {'items': []}
            config['items'].append({
                'id': str(_uuid.uuid4())[:8],
                'source_title': source_title,
                'series_title': series_title,
                'reason_failed': reason_failed,
                'added_at': datetime.now().isoformat(),
            })
            db.save_app_config_for_instance('tv_hunt_blocklist', instance_id, config)
        except Exception:
            pass

    def _check_and_import_completed_tv(queue_id, meta, instance_id):
        """Check if a removed TV queue item completed successfully and trigger import."""
        try:
            series_title = meta.get('series_title', '').strip()
            year = meta.get('year', '').strip()
            season = meta.get('season')
            episode = meta.get('episode')
            episode_title = meta.get('episode_title', '').strip()
            client_name = meta.get('client_name', '').strip()

            if not series_title:
                tv_hunt_logger.warning("Import: TV queue item %s has no series title, skipping", queue_id)
                return

            clients = get_tv_clients_config(instance_id)
            client = next((c for c in clients if (c.get('name') or '').strip() == client_name), None)

            if not client and clients:
                client = clients[0]
                client_name = (client.get('name') or 'Download client').strip()

            if not client:
                tv_hunt_logger.warning("Import: no download client found for TV import")
                return

            client_type = (client.get('type') or 'nzbget').strip().lower()
            release_name = ''

            # ── NZB Hunt ──
            if client_type in ('nzbhunt', 'nzb_hunt'):
                tv_hunt_logger.info(
                    "Import: TV item left NZB Hunt queue (id=%s, series='%s'). Checking history.",
                    queue_id, series_title,
                )
                nzb_history = _get_nzb_hunt_history_item(queue_id)
                if not nzb_history:
                    tv_hunt_logger.warning("Import: NZB Hunt item %s not found in history", queue_id)
                    return

                nzb_state = nzb_history.get('state', '')
                if nzb_state == 'failed':
                    source_title = (nzb_history.get('name') or '').strip()
                    if source_title and source_title.endswith('.nzb'):
                        source_title = source_title[:-4]
                    reason = (nzb_history.get('error_message') or '').strip() or 'Download failed'
                    _tv_blocklist_add(series_title, source_title, reason, instance_id)
                    tv_hunt_logger.warning("Import: NZB Hunt download '%s' FAILED: %s", series_title, reason[:100])
                    return

                if nzb_state != 'completed':
                    tv_hunt_logger.warning("Import: NZB Hunt item %s not completed (state: %s)", queue_id, nzb_state)
                    return

                download_path = _get_nzb_hunt_completed_path(queue_id, series_title, instance_id)
                if not download_path:
                    return

                release_name = (nzb_history.get('name') or '').strip()
                if release_name and release_name.endswith('.nzb'):
                    release_name = release_name[:-4]

            # ── SABnzbd ──
            elif client_type == 'sabnzbd':
                tv_hunt_logger.info(
                    "Import: TV item left SAB queue (id=%s, series='%s'). Checking SAB history.",
                    queue_id, series_title,
                )
                history_item = _get_sabnzbd_history_item(client, queue_id)
                if not history_item:
                    tv_hunt_logger.warning("Import: TV item %s not found in SAB history", queue_id)
                    return

                status = history_item.get('status', '')
                storage_path = (history_item.get('storage') or '').strip()

                if status.lower() != 'completed':
                    source_title = (history_item.get('name') or history_item.get('nzb_name') or '').strip()
                    if source_title and source_title.endswith('.nzb'):
                        source_title = source_title[:-4]
                    reason = (history_item.get('fail_message') or '').strip() or status or 'Download failed'
                    _tv_blocklist_add(series_title, source_title, reason, instance_id)
                    tv_hunt_logger.warning("Import: TV download '%s' did not complete (status: %s)", series_title, status)
                    return

                download_path = storage_path
                if not download_path:
                    tv_hunt_logger.error("Import: no storage path in SAB history for '%s'", series_title)
                    return

                release_name = (history_item.get('name') or history_item.get('nzb_name') or '').strip()
                if release_name and release_name.endswith('.nzb'):
                    release_name = release_name[:-4]

            else:
                tv_hunt_logger.debug("Import: unsupported client type for TV: %s", client_type)
                return

            tv_hunt_logger.info("Import: attempting TV import for '%s' S%02dE%02d from path: %s",
                                series_title, season or 0, episode or 0, download_path)

            from src.primary.apps.tv_hunt.importer import import_episode

            def _do_import():
                try:
                    success = import_episode(
                        client=client,
                        series_title=series_title,
                        year=year,
                        season=season if season is not None else 1,
                        episode=episode if episode is not None else 1,
                        episode_title=episode_title,
                        download_path=download_path,
                        instance_id=instance_id,
                        release_name=release_name,
                    )
                    if success:
                        tv_hunt_logger.info("Import: successfully imported '%s' S%02dE%02d",
                                            series_title, season or 0, episode or 0)
                    else:
                        tv_hunt_logger.error("Import: failed to import '%s' S%02dE%02d",
                                             series_title, season or 0, episode or 0)
                except Exception as e:
                    tv_hunt_logger.exception("Import: error for '%s' S%02dE%02d: %s",
                                             series_title, season or 0, episode or 0, e)

            import_thread = threading.Thread(target=_do_import, daemon=True)
            import_thread.start()

        except Exception as e:
            tv_hunt_logger.exception("Import: error checking TV completed download: %s", e)

    def _prune_tv_requested_queue_ids(current_queue_ids, instance_id):
        """Remove IDs no longer in any client's queue. Trigger import for completed items."""
        db = get_database()
        config = db.get_app_config_for_instance('tv_hunt_requested_queue_ids', instance_id)
        if not config or not isinstance(config, dict):
            return
        ids = config.get('ids') or []
        items = config.get('items') or {}
        current = set(str(i) for i in current_queue_ids)
        kept = []
        removed = []
        for qid in ids:
            if str(qid) in current:
                kept.append(qid)
            else:
                removed.append(qid)
        config['ids'] = kept
        db.save_app_config_for_instance('tv_hunt_requested_queue_ids', instance_id, config)

        if removed:
            tv_hunt_logger.info("Import: %d TV item(s) left queue, checking history for import.", len(removed))
        for qid in removed:
            meta = items.get(str(qid)) or {}
            _check_and_import_completed_tv(qid, meta, instance_id)

    def _get_nzb_hunt_tv_queue(client, instance_id):
        """Fetch TV items from NZB Hunt queue."""
        try:
            from src.primary.apps.nzb_hunt.download_manager import get_manager
            mgr = get_manager()
            queue_items = mgr.get_queue()

            from .helpers import _get_tv_hunt_instance_display_name, _instance_name_to_category
            inst_name = _get_tv_hunt_instance_display_name(instance_id)
            expected_cat = _instance_name_to_category(inst_name, "TV") if inst_name else (TV_HUNT_DEFAULT_CATEGORY or "tv")
            expected_cat_lower = expected_cat.lower()

            requested_ids, requested_items = _get_tv_requested_queue_ids(instance_id)
            requested_set = set(str(i) for i in requested_ids)

            items = []
            current_queue_ids = set()

            for q in queue_items:
                q_cat = (q.get('category') or '').strip().lower()
                q_id = q.get('id', '')

                if q_id:
                    current_queue_ids.add(str(q_id))

                if q_cat and q_cat != expected_cat_lower:
                    continue

                if requested_set and str(q_id) not in requested_set:
                    continue

                nzb_name = q.get('name', '-')
                meta = requested_items.get(str(q_id)) or {}
                series_title = meta.get('series_title', '')
                season = meta.get('season')
                episode = meta.get('episode')
                display_name = series_title or nzb_name
                if season is not None and episode is not None:
                    display_name += f" - S{season:02d}E{episode:02d}"
                elif season is not None:
                    display_name += f" - S{season:02d}"

                progress_pct = q.get('progress_pct', 0)
                if progress_pct >= 100:
                    progress = 'Pending Import'
                elif progress_pct > 0:
                    progress = f'{progress_pct:.0f}%'
                else:
                    progress = '-'

                items.append({
                    'id': q_id,
                    'title': display_name,
                    'series': series_title,
                    'season': season,
                    'episode': episode,
                    'quality': _extract_quality_from_filename(nzb_name),
                    'formats': _extract_formats_from_filename(nzb_name),
                    'time_left': q.get('time_left', '') or '-',
                    'progress': progress,
                    'instance_name': (client.get('name') or 'Download client').strip(),
                    'original_release': nzb_name,
                })

            _prune_tv_requested_queue_ids(current_queue_ids, instance_id)
            return items
        except Exception as e:
            logger.debug("NZB Hunt TV queue error: %s", e)
            return []

    def _get_sabnzbd_tv_queue(client, instance_id):
        """Fetch TV items from SABnzbd queue."""
        try:
            base_url = _download_client_base_url(client)
            if not base_url:
                return []

            from .helpers import _get_tv_hunt_instance_display_name, _instance_name_to_category
            inst_name = _get_tv_hunt_instance_display_name(instance_id)
            expected_cat = _instance_name_to_category(inst_name, "TV") if inst_name else (TV_HUNT_DEFAULT_CATEGORY or "tv")
            expected_cat_lower = expected_cat.lower()

            requested_ids, requested_items = _get_tv_requested_queue_ids(instance_id)
            requested_set = set(str(i) for i in requested_ids)

            api_key = (client.get('api_key') or '').strip()
            url = f"{base_url}/api"
            params = {'mode': 'queue', 'output': 'json'}
            if api_key:
                params['apikey'] = api_key

            from src.primary.settings_manager import get_ssl_verify_setting
            verify_ssl = get_ssl_verify_setting()

            r = requests.get(url, params=params, timeout=15, verify=verify_ssl)
            r.raise_for_status()
            data = r.json()
            if not isinstance(data, dict):
                return []

            slots_raw = (data.get('queue') or {}).get('slots') or data.get('slots') or []
            if isinstance(slots_raw, dict):
                slots = list(slots_raw.values())
            elif isinstance(slots_raw, list):
                slots = slots_raw
            else:
                slots = []

            items = []
            current_queue_ids = set()

            for slot in slots:
                if not isinstance(slot, dict):
                    continue
                nzo_id = slot.get('nzo_id') or slot.get('id')
                if nzo_id is not None:
                    current_queue_ids.add(str(nzo_id))

                slot_cat = (slot.get('category') or slot.get('cat') or '').strip().lower()
                if slot_cat != expected_cat_lower:
                    continue
                if nzo_id is None:
                    continue
                if requested_set and str(nzo_id) not in requested_set:
                    continue

                filename = (slot.get('filename') or slot.get('name') or '-').strip()
                meta = requested_items.get(str(nzo_id)) or {}
                series_title = meta.get('series_title', '')
                season = meta.get('season')
                episode = meta.get('episode')
                display_name = series_title or filename
                if season is not None and episode is not None:
                    display_name += f" - S{season:02d}E{episode:02d}"

                pct_str = (slot.get('percentage') or '0').replace('%', '')
                try:
                    pct = float(pct_str)
                except ValueError:
                    pct = 0

                items.append({
                    'id': nzo_id,
                    'title': display_name,
                    'series': series_title,
                    'season': season,
                    'episode': episode,
                    'quality': _extract_quality_from_filename(filename),
                    'formats': _extract_formats_from_filename(filename),
                    'time_left': slot.get('timeleft', '') or '-',
                    'progress': f'{pct:.0f}%' if pct > 0 else '-',
                    'instance_name': (client.get('name') or 'Download client').strip(),
                    'original_release': filename,
                })

            _prune_tv_requested_queue_ids(current_queue_ids, instance_id)
            return items
        except Exception as e:
            logger.debug("SABnzbd TV queue error: %s", e)
            return []

    # ── Flask Routes ──

    @bp.route('/api/tv-hunt/queue', methods=['GET'])
    def api_tv_hunt_queue():
        try:
            instance_id = get_instance_id()
            if not instance_id:
                return jsonify({'queue': []}), 200

            clients = get_tv_clients_config(instance_id)
            all_items = []
            for client in clients:
                if not client.get('enabled', True):
                    continue
                client_type = (client.get('type') or 'nzb_hunt').strip().lower()
                if client_type in ('nzbhunt', 'nzb_hunt'):
                    all_items.extend(_get_nzb_hunt_tv_queue(client, instance_id))
                elif client_type == 'sabnzbd':
                    all_items.extend(_get_sabnzbd_tv_queue(client, instance_id))

            return jsonify({'queue': all_items}), 200
        except Exception as e:
            logger.exception('TV Hunt queue error')
            return jsonify({'queue': [], 'error': str(e)}), 200

    @bp.route('/api/tv-hunt/history', methods=['GET'])
    def api_tv_hunt_history():
        try:
            instance_id = get_instance_id()
            if not instance_id:
                return jsonify({'history': []}), 200
            try:
                from src.primary.history_manager import get_history
                result = get_history("tv_hunt", page=1, page_size=100)
                entries = result.get("entries") or []
                instance_key = str(instance_id)
                entries = [e for e in entries if (e.get("instance_name") or "") == instance_key]
                return jsonify({'history': entries}), 200
            except Exception:
                return jsonify({'history': []}), 200
        except Exception as e:
            logger.exception('TV Hunt history error')
            return jsonify({'history': [], 'error': str(e)}), 200

    @bp.route('/api/tv-hunt/blocklist', methods=['GET'])
    def api_tv_hunt_blocklist_list():
        try:
            instance_id = get_instance_id()
            if not instance_id:
                return jsonify({'items': []}), 200
            db = get_database()
            config = db.get_app_config_for_instance('tv_hunt_blocklist', instance_id)
            items = config.get('items', []) if config and isinstance(config.get('items'), list) else []
            return jsonify({'items': items}), 200
        except Exception as e:
            logger.exception('TV Hunt blocklist list error')
            return jsonify({'items': [], 'error': str(e)}), 200

    @bp.route('/api/tv-hunt/blocklist', methods=['POST'])
    def api_tv_hunt_blocklist_add():
        try:
            instance_id = get_instance_id()
            if not instance_id:
                return jsonify({'error': 'No instance selected'}), 400
            data = request.get_json() or {}
            source_title = (data.get('source_title') or '').strip()
            if not source_title:
                return jsonify({'error': 'source_title required'}), 400
            db = get_database()
            config = db.get_app_config_for_instance('tv_hunt_blocklist', instance_id)
            if not config or not isinstance(config.get('items'), list):
                config = {'items': []}
            config['items'].append({
                'id': str(_uuid.uuid4())[:8],
                'source_title': source_title,
                'added_at': datetime.now().isoformat(),
            })
            db.save_app_config_for_instance('tv_hunt_blocklist', instance_id, config)
            return jsonify({'success': True}), 201
        except Exception as e:
            logger.exception('TV Hunt blocklist add error')
            return jsonify({'error': str(e)}), 500

    @bp.route('/api/tv-hunt/blocklist/<item_id>', methods=['DELETE'])
    def api_tv_hunt_blocklist_delete(item_id):
        try:
            instance_id = get_instance_id()
            if not instance_id:
                return jsonify({'error': 'No instance selected'}), 400
            db = get_database()
            config = db.get_app_config_for_instance('tv_hunt_blocklist', instance_id)
            if not config or not isinstance(config.get('items'), list):
                return jsonify({'error': 'Item not found'}), 404
            config['items'] = [i for i in config['items'] if i.get('id') != item_id]
            db.save_app_config_for_instance('tv_hunt_blocklist', instance_id, config)
            return jsonify({'success': True}), 200
        except Exception as e:
            logger.exception('TV Hunt blocklist delete error')
            return jsonify({'error': str(e)}), 500
