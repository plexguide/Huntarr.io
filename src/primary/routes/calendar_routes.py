"""
Unified Calendar API – Radarr, Sonarr (movie/tv from *arr).
Movie Hunt and TV Hunt use existing /api/movie-hunt/calendar and /api/tv-hunt/collection.
GET /api/calendar?app_type=radarr|sonarr&instance=Name&days_past=&days_future=
"""
import requests
from datetime import datetime, timedelta

from flask import request, jsonify

from ..utils.logger import get_logger
from .. import settings_manager
from ..settings_manager import get_ssl_verify_setting

logger = get_logger("calendar")


def _get_radarr_instance(instance_name: str):
    """Get Radarr instance config by name."""
    from ..utils.database import get_database
    db = get_database()
    config = db.get_app_config('radarr')
    if not config or not config.get('instances'):
        return None
    for inst in config['instances']:
        if not inst.get('enabled'):
            continue
        if (inst.get('name') or '').strip() == instance_name:
            return inst
    return None


def _get_sonarr_instance(instance_name: str):
    """Get Sonarr instance config by name."""
    from ..utils.database import get_database
    db = get_database()
    config = db.get_app_config('sonarr')
    if not config or not config.get('instances'):
        return None
    for inst in config['instances']:
        if not inst.get('enabled'):
            continue
        if (inst.get('name') or '').strip() == instance_name:
            return inst
    return None


def _fetch_radarr_calendar(instance_name: str, days_past: int, days_future: int):
    """Fetch calendar from Radarr API and normalize to our event format."""
    inst = _get_radarr_instance(instance_name)
    if not inst:
        return []
    api_url = (inst.get('api_url') or inst.get('url') or '').rstrip('/')
    api_key = inst.get('api_key') or ''
    if not api_url or not api_key:
        return []
    try:
        from ..apps.radarr import api as radarr_api
        from .. import settings_manager
        timeout = int(settings_manager.get_setting('radarr', 'api_timeout', 30))
        now = datetime.utcnow()
        start = (now - timedelta(days=days_past)).strftime('%Y-%m-%d') + 'T00:00:00Z'
        end = (now + timedelta(days=days_future)).strftime('%Y-%m-%d') + 'T23:59:59Z'
        params = {'start': start, 'end': end, 'unmonitored': 'false'}
        movies = radarr_api.arr_request(api_url, api_key, timeout, 'calendar', params=params, count_api=False)
        if not movies or not isinstance(movies, list):
            return []
        events = []
        for m in movies:
            title = (m.get('title') or '').strip()
            if not title:
                continue
            year = str(m.get('year') or '')
            poster = m.get('remotePoster') or ''
            status = 'available' if m.get('hasFile') else 'requested'
            in_cinemas = (m.get('inCinemas') or '')[:10] if m.get('inCinemas') else ''
            digital = (m.get('digitalRelease') or '')[:10] if m.get('digitalRelease') else ''
            physical = (m.get('physicalRelease') or '')[:10] if m.get('physicalRelease') else ''
            today = datetime.utcnow().strftime('%Y-%m-%d')
            range_start = (datetime.utcnow() - timedelta(days=days_past)).strftime('%Y-%m-%d')
            range_end = (datetime.utcnow() + timedelta(days=days_future)).strftime('%Y-%m-%d')
            base = {
                'title': title,
                'year': year,
                'tmdb_id': m.get('tmdbId'),
                'poster_path': poster,
                'status': status,
                'minimum_availability': (m.get('minimumAvailability') or 'released'),
            }
            if in_cinemas and range_start <= in_cinemas <= range_end:
                events.append({**base, 'date': in_cinemas, 'event_type': 'inCinemas', 'event_label': 'In Cinemas'})
            if digital and range_start <= digital <= range_end:
                events.append({**base, 'date': digital, 'event_type': 'digitalRelease', 'event_label': 'Digital Release'})
            if physical and range_start <= physical <= range_end:
                events.append({**base, 'date': physical, 'event_type': 'physicalRelease', 'event_label': 'Physical Release'})
            if not in_cinemas and not digital and not physical:
                events.append({**base, 'date': '', 'event_type': 'unknown', 'event_label': 'Date TBA'})
        events.sort(key=lambda e: (0 if e['date'] else 1, e['date'] or '9999', e['title']))
        return events
    except Exception as e:
        logger.exception('Radarr calendar error: %s', e)
        return []


def _fetch_sonarr_calendar(instance_name: str, days_past: int, days_future: int):
    """Fetch calendar from Sonarr API and normalize to our episode format."""
    inst = _get_sonarr_instance(instance_name)
    if not inst:
        return []
    api_url = (inst.get('api_url') or inst.get('url') or '').rstrip('/')
    api_key = inst.get('api_key') or ''
    if not api_url or not api_key:
        return []
    try:
        timeout = int(settings_manager.get_setting('sonarr', 'api_timeout', 30))
        now = datetime.utcnow()
        start = (now - timedelta(days=days_past)).isoformat() + 'Z'
        end = (now + timedelta(days=days_future)).isoformat() + 'Z'
        url = f"{api_url}/api/v3/calendar"
        headers = {'X-Api-Key': api_key, 'Content-Type': 'application/json'}
        resp = requests.get(url, headers=headers, params={'start': start, 'end': end}, timeout=timeout, verify=get_ssl_verify_setting())
        resp.raise_for_status()
        episodes = resp.json() if resp.content else []
        if not episodes or not isinstance(episodes, list):
            return []
        events = []
        for ep in episodes:
            series = ep.get('series') or {}
            air_date = (ep.get('airDate') or '')[:10]
            if not air_date:
                continue
            events.append({
                'date': air_date,
                'series_title': series.get('title') or '',
                'poster_path': series.get('remotePoster') or '',
                'title': ep.get('title') or ('Episode ' + str(ep.get('episodeNumber', ''))),
                'season_number': ep.get('seasonNumber'),
                'episode_number': ep.get('episodeNumber'),
                'status': 'available' if ep.get('hasFile') else ('unaired' if air_date > datetime.utcnow().strftime('%Y-%m-%d') else 'missing'),
            })
        events.sort(key=lambda e: e['date'])
        return events
    except Exception as e:
        logger.exception('Sonarr calendar error: %s', e)
        return []


def register_calendar_routes(bp):
    """Register unified calendar route on blueprint."""

    @bp.route('/api/calendar', methods=['GET'])
    def api_calendar():
        """Unified calendar for Radarr and Sonarr. Movie Hunt/TV Hunt use their existing APIs."""
        app_type = (request.args.get('app_type') or '').strip().lower()
        instance_name = (request.args.get('instance') or '').strip()
        days_past = request.args.get('days_past', 14, type=int)
        days_future = request.args.get('days_future', 120, type=int)

        if not app_type:
            return jsonify({'success': False, 'error': 'app_type required'}), 400

        # Radarr: fetch from Radarr API
        if app_type == 'radarr':
            if not instance_name:
                return jsonify({'success': False, 'error': 'instance required for radarr'}), 400
            events = _fetch_radarr_calendar(instance_name, days_past, days_future)
            today = datetime.utcnow().strftime('%Y-%m-%d')
            return jsonify({
                'success': True,
                'events': events,
                'range_start': (datetime.utcnow() - timedelta(days=days_past)).strftime('%Y-%m-%d'),
                'range_end': (datetime.utcnow() + timedelta(days=days_future)).strftime('%Y-%m-%d'),
                'today': today,
            })

        # Sonarr: fetch from Sonarr API
        if app_type == 'sonarr':
            if not instance_name:
                return jsonify({'success': False, 'error': 'instance required for sonarr'}), 400
            events = _fetch_sonarr_calendar(instance_name, days_past, days_future)
            today = datetime.utcnow().strftime('%Y-%m-%d')
            return jsonify({
                'success': True,
                'events': events,
                'range_start': (datetime.utcnow() - timedelta(days=days_past)).strftime('%Y-%m-%d'),
                'range_end': (datetime.utcnow() + timedelta(days=days_future)).strftime('%Y-%m-%d'),
                'today': today,
            })

        return jsonify({'success': False, 'error': 'Invalid app_type'}), 400
