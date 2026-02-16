"""Indexer Hunt — Background hourly health check for all Index Master indexers."""

import threading
import time
import datetime

from ...utils.logger import logger

_STATUS_LOCK = threading.Lock()
_STATUS_CACHE = {}  # { indexer_id: { status, response_time_ms, error_message, last_checked } }

HEALTH_CHECK_INTERVAL = 3600  # 1 hour in seconds
STARTUP_GRACE_PERIOD = 30     # seconds before first check
INTER_INDEXER_DELAY = 2       # seconds between testing each indexer


def get_cached_statuses():
    """Return a copy of the current status cache."""
    with _STATUS_LOCK:
        return dict(_STATUS_CACHE)


def update_cached_status(indexer_id, status, response_time_ms=0, error_message=''):
    """Update status for a single indexer (used by manual Test button too)."""
    with _STATUS_LOCK:
        _STATUS_CACHE[indexer_id] = {
            'status': status,
            'response_time_ms': response_time_ms,
            'error_message': error_message,
            'last_checked': datetime.datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S'),
        }


def remove_cached_status(indexer_id):
    """Remove a single indexer from the cache (used when deleting from IH)."""
    with _STATUS_LOCK:
        _STATUS_CACHE.pop(indexer_id, None)


def _run_health_check_round():
    """Test all Index Master indexers sequentially and update the cache + DB."""
    try:
        from src.primary.utils.database import get_database
        from src.primary.routes.media_hunt.indexers import (
            _validate_newznab_api_key, _resolve_indexer_api_url,
        )
        db = get_database()
        indexers = db.get_indexer_hunt_indexers()

        if not indexers:
            logger.debug('[HealthCheck] No Index Master indexers to check.')
            return

        logger.info(f'[HealthCheck] Starting hourly check for {len(indexers)} indexer(s)...')

        for i, idx in enumerate(indexers):
            if not idx.get('enabled', True):
                update_cached_status(idx['id'], 'disabled')
                continue

            idx_id = idx['id']
            idx_name = idx.get('name', 'Unnamed')

            try:
                base_url = _resolve_indexer_api_url(idx)
                if not base_url:
                    update_cached_status(idx_id, 'failed', error_message='No URL configured')
                    db.record_indexer_hunt_event(
                        indexer_id=idx_id, indexer_name=idx_name,
                        event_type='health_check', response_time_ms=0,
                        success=False, error_message='No URL configured',
                    )
                    continue

                api_key = idx.get('api_key', '')
                start = time.time()
                valid, err_msg = _validate_newznab_api_key(base_url, api_key)
                elapsed_ms = int((time.time() - start) * 1000)

                status = 'connected' if valid else 'failed'
                update_cached_status(idx_id, status, elapsed_ms, err_msg or '')

                db.record_indexer_hunt_event(
                    indexer_id=idx_id, indexer_name=idx_name,
                    event_type='health_check', response_time_ms=elapsed_ms,
                    success=valid, error_message=err_msg or '',
                )

                logger.debug(f'[HealthCheck] {idx_name}: {status} ({elapsed_ms}ms)')

            except Exception as e:
                update_cached_status(idx_id, 'failed', error_message=str(e))
                logger.warning(f'[HealthCheck] {idx_name} error: {e}')

            # Delay between indexers to avoid overwhelming them
            if i < len(indexers) - 1:
                time.sleep(INTER_INDEXER_DELAY)

        logger.info('[HealthCheck] Hourly check complete.')
    except Exception as e:
        logger.exception(f'[HealthCheck] Round failed: {e}')


def _health_check_loop():
    """Background thread loop: startup grace -> first check -> repeat hourly."""
    logger.info(f'[HealthCheck] Background thread started. First check in {STARTUP_GRACE_PERIOD}s.')
    time.sleep(STARTUP_GRACE_PERIOD)

    while True:
        try:
            _run_health_check_round()
        except Exception:
            logger.exception('[HealthCheck] Unhandled error in health check loop')
        time.sleep(HEALTH_CHECK_INTERVAL)


_health_thread = None


def start_health_check_thread():
    """Start the background health check daemon thread (call once at app startup)."""
    global _health_thread
    if _health_thread is not None and _health_thread.is_alive():
        return
    _health_thread = threading.Thread(target=_health_check_loop, daemon=True, name='IH-HealthCheck')
    _health_thread.start()
    logger.info('[HealthCheck] Daemon thread launched.')
