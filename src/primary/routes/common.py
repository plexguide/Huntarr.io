#!/usr/bin/env python3
"""
Common routes blueprint for Huntarr web interface
"""

import os
import json
import base64
import secrets
import string
import io
import xml.etree.ElementTree as ET
import qrcode
import pyotp
import logging
import requests
# Add render_template, send_from_directory, session
from flask import Blueprint, request, jsonify, make_response, redirect, url_for, current_app, render_template, send_from_directory, session, send_file
from ..auth import (
    verify_user, create_session, get_username_from_session, SESSION_COOKIE_NAME,
    change_username as auth_change_username, change_password as auth_change_password,
    update_session_username,
    validate_password_strength, logout, verify_session, disable_2fa_with_password_and_otp,
    user_exists, create_user, generate_2fa_secret, verify_2fa_code, is_2fa_enabled, # Add missing auth imports
    hash_password # Add hash_password import for recovery key reset
)
from ..utils.logger import logger # Ensure logger is imported
from .. import settings_manager # Import settings_manager
from ..utils.tmdb_cache import tmdb_cache # Import TMDB cache
from datetime import datetime


common_bp = Blueprint('common', __name__)

# --- Static File Serving --- #

@common_bp.route('/static/<path:filename>')
def static_files(filename):
    return send_from_directory(common_bp.static_folder, filename)

@common_bp.route('/favicon.ico')
def favicon():
    return send_from_directory(current_app.static_folder, 'favicon.ico', mimetype='image/vnd.microsoft.icon')

@common_bp.route('/logo/<path:filename>')
def logo_files(filename):
    logo_dir = os.path.join(current_app.static_folder, 'logo')
    return send_from_directory(logo_dir, filename)

@common_bp.route('/api/tmdb/image', methods=['GET'])
def tmdb_image_proxy():
    """
    Proxy/cache TMDB images server-side
    Query params: url (TMDB image URL), cache_days (optional)
    """
    try:
        image_url = request.args.get('url')
        if not image_url:
            return jsonify({'error': 'Missing url parameter'}), 400
        
        # Get cache settings
        general_settings = settings_manager.load_settings('general')
        cache_days = int(general_settings.get('tmdb_image_cache_days', 7))
        cache_storage = general_settings.get('tmdb_cache_storage', 'server')
        
        # If caching is disabled or browser-side, just redirect to TMDB
        if cache_days == 0 or cache_storage == 'browser':
            return redirect(image_url)
        
        # Check if image is cached and valid
        if tmdb_cache.is_cached(image_url, max_age_days=cache_days):
            cached_path = tmdb_cache.get_cached_path(image_url)
            if cached_path and os.path.exists(cached_path):
                logger.debug(f"[TMDBCache] Serving cached image: {image_url}")
                return send_file(cached_path, mimetype='image/jpeg')
        
        # Cache the image
        cached_path = tmdb_cache.cache_image(image_url)
        if cached_path and os.path.exists(cached_path):
            return send_file(cached_path, mimetype='image/jpeg')
        
        # Fallback to redirect if caching fails
        return redirect(image_url)
    
    except Exception as e:
        logger.error(f"Error in TMDB image proxy: {e}")
        # Fallback to direct TMDB URL on error
        return redirect(request.args.get('url', ''))

# --- API Routes --- #

@common_bp.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint for Docker and orchestration systems"""
    try:
        # Check if shutdown is in progress using multiple methods
        from src.primary.background import stop_event
        
        # Also check the global shutdown flag from main.py
        try:
            import main
            is_shutting_down = main.is_shutting_down()
        except:
            is_shutting_down = stop_event.is_set()
        
        if is_shutting_down:
            return jsonify({
                "status": "shutting_down",
                "message": "Application is shutting down",
                "ready": False
            }), 503  # Service Unavailable
        
        # Basic database connectivity check
        from src.primary.utils.database import get_database
        db = get_database()
        
        # Quick database health check
        with db.get_connection() as conn:
            conn.execute("SELECT 1")
        
        return jsonify({
            "status": "healthy",
            "message": "Application is running normally",
            "ready": True,
            "timestamp": datetime.utcnow().isoformat()
        }), 200
        
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return jsonify({
            "status": "unhealthy",
            "message": f"Health check failed: {str(e)}",
            "ready": False
        }), 503  # Service Unavailable

@common_bp.route('/ready', methods=['GET'])
def readiness_check():
    """Readiness check endpoint for Kubernetes-style orchestration"""
    try:
        # Check if the application is ready to serve traffic
        from src.primary.background import stop_event
        
        # Also check the global shutdown flag from main.py
        try:
            import main
            is_shutting_down = main.is_shutting_down()
        except:
            is_shutting_down = stop_event.is_set()
        
        if is_shutting_down:
            return jsonify({
                "ready": False,
                "message": "Application is shutting down"
            }), 503
        
        # Check if setup is complete
        from src.primary.utils.database import get_database
        db = get_database()
        
        if db.is_setup_in_progress():
            return jsonify({
                "ready": False,
                "message": "Application setup in progress"
            }), 503
        
        # Check if user exists (setup complete)
        from ..auth import user_exists
        if not user_exists():
            return jsonify({
                "ready": False,
                "message": "Application requires initial setup"
            }), 503
        
        return jsonify({
            "ready": True,
            "message": "Application is ready to serve traffic"
        }), 200
        
    except Exception as e:
        logger.error(f"Readiness check failed: {e}")
        return jsonify({
            "ready": False,
            "message": f"Readiness check failed: {str(e)}"
        }), 503


# Newznab indexer preset base URLs (used for API key validation)
INDEXER_PRESET_URLS = {
    'nzbgeek': 'https://api.nzbgeek.info/api',
    'nzbfinder.ws': 'https://api.nzbfinder.ws/api',
}


def _validate_newznab_api_key(base_url, api_key, timeout=10):
    """
    Validate a Newznab API key by performing a minimal search request.
    Per Newznab API: t=search requires apikey; error codes 100/101/102 = invalid credentials.
    Success = 200 + XML with no error element AND valid RSS structure (channel or item).
    See https://inhies.github.io/Newznab-API/
    """
    if not (base_url and api_key and api_key.strip()):
        return False, 'API key is required'
    api_key = api_key.strip()
    url = f'{base_url.rstrip("/")}?t=search&apikey={requests.utils.quote(api_key)}&q=test&limit=1'
    try:
        r = requests.get(url, timeout=timeout)
        if r.status_code != 200:
            return False, f'Indexer returned HTTP {r.status_code}'
        text = (r.text or '').strip()
        if not text:
            return False, 'Empty response from indexer'
        # Check for common error phrases in body (some indexers don't use Newznab error element)
        text_lower = text.lower()
        for phrase in ('invalid api key', 'invalid key', 'api key is invalid', 'unauthorized', 'authentication failed', 'access denied', 'invalid apikey'):
            if phrase in text_lower:
                return False, 'Invalid API key or not authorized'
        # Try JSON first (some indexers return JSON by default)
        if text.lstrip().startswith('{'):
            try:
                data = json.loads(text)
                if data.get('error') or data.get('@attributes', {}).get('error'):
                    return False, data.get('description') or data.get('error') or 'Invalid API key'
                # JSON success: expect channel/items or similar
                if 'channel' in data or 'item' in data or 'items' in data:
                    return True, None
                return False, 'Invalid API key or unexpected response'
            except (ValueError, TypeError):
                pass
        # XML: check for Newznab error element (any namespace)
        root = ET.fromstring(text)
        err = root.find('.//{http://www.newznab.com/DTD/2010/feeds/attributes/}error')
        if err is None:
            err = root.find('.//error') or root.find('error')
        if err is not None:
            code = err.get('code') or err.get('description') or ''
            code_str = str(code).strip()
            if code_str in ('100', '101', '102'):
                return False, 'Invalid API key or account not authorized'
            desc = err.get('description') or err.text or ''
            return False, (desc.strip() or f'Error {code_str}')
        # No error element: require evidence of successful search - at least one <item> or non-empty channel
        channel = root.find('.//{http://www.newznab.com/DTD/2010/feeds/}channel') or root.find('.//channel') or root.find('channel')
        items = root.findall('.//{http://www.newznab.com/DTD/2010/feeds/}item') or root.findall('.//item') or root.findall('item')
        if items:
            return True, None
        if channel is not None:
            # Channel with any child (title, item, etc.) indicates accepted request; empty channel = no items = treat as invalid key
            if list(channel) or (channel.text and channel.text.strip()):
                return True, None
            return False, 'Invalid API key or account not authorized'
        if root.tag and ('rss' in root.tag.lower() or 'rss' in root.tag):
            return True, None
        logger.debug('Indexer validation: no error element but no channel/item; response sample: %s', text[:400].replace(api_key, '***'))
        return False, 'Invalid API key or unexpected response from indexer'
    except ET.ParseError:
        return False, 'Invalid response from indexer'
    except requests.RequestException as e:
        return False, str(e) if str(e) else 'Could not connect to indexer'


@common_bp.route('/api/indexers/validate', methods=['POST'])
def api_indexers_validate():
    """
    Validate an indexer API key for a given preset (NZBGeek, NZBFinder.ws).
    Manual Configuration is not validated.
    Body: { "preset": "nzbgeek"|"nzbfinder.ws"|"manual", "api_key": "..." }
    """
    try:
        data = request.get_json() or {}
        preset = (data.get('preset') or '').strip().lower().replace(' ', '')
        api_key = (data.get('api_key') or '').strip()
        if preset == 'manual':
            return jsonify({'valid': True, 'message': 'Manual configuration is not validated'}), 200
        base_url = INDEXER_PRESET_URLS.get(preset)
        if not base_url:
            return jsonify({'valid': False, 'message': 'Unknown preset'}), 400
        valid, err_msg = _validate_newznab_api_key(base_url, api_key)
        if valid:
            return jsonify({'valid': True}), 200
        return jsonify({'valid': False, 'message': err_msg or 'Validation failed'}), 200
    except Exception as e:
        logger.exception('Indexer validation error')
        return jsonify({'valid': False, 'message': str(e)}), 200


def _get_indexers_config():
    """Get indexers list from database (app_config app_type=indexers)."""
    from src.primary.utils.database import get_database
    db = get_database()
    config = db.get_app_config('indexers')
    if not config or not isinstance(config.get('indexers'), list):
        return []
    return config['indexers']


def _save_indexers_list(indexers_list):
    """Save indexers list to database."""
    from src.primary.utils.database import get_database
    db = get_database()
    db.save_app_config('indexers', {'indexers': indexers_list})


# Indexer categories (Movies only). By default all selected except Movies/3D (2060).
INDEXER_CATEGORIES = [
    {'id': 2000, 'name': 'Movies'},
    {'id': 2010, 'name': 'Movies/Foreign'},
    {'id': 2020, 'name': 'Movies/Other'},
    {'id': 2030, 'name': 'Movies/SD'},
    {'id': 2040, 'name': 'Movies/HD'},
    {'id': 2045, 'name': 'Movies/UHD'},
    {'id': 2050, 'name': 'Movies/BluRay'},
    {'id': 2060, 'name': 'Movies/3D'},
    {'id': 2070, 'name': 'Movies/DVD'},
]
INDEXER_CATEGORIES_DEFAULT_IDS = [2000, 2010, 2020, 2030, 2040, 2045, 2050, 2070]


@common_bp.route('/api/indexers', methods=['GET'])
def api_indexers_list():
    """List saved indexers (API key masked to last 4 chars). Includes categories for editor."""
    try:
        indexers = _get_indexers_config()
        out = []
        for i, idx in enumerate(indexers):
            key = (idx.get('api_key') or '')
            last4 = key[-4:] if len(key) >= 4 else '****'
            cats = idx.get('categories')
            if not isinstance(cats, list):
                cats = list(INDEXER_CATEGORIES_DEFAULT_IDS)
            out.append({
                'index': i,
                'name': idx.get('name') or 'Unnamed',
                'preset': idx.get('preset') or 'manual',
                'enabled': idx.get('enabled', True),
                'api_key_last4': last4,
                'categories': cats,
            })
        return jsonify({'indexers': out}), 200
    except Exception as e:
        logger.exception('Indexers list error')
        return jsonify({'indexers': [], 'error': str(e)}), 200


@common_bp.route('/api/indexers', methods=['POST'])
def api_indexers_add():
    """Add a new indexer. Body: { name, preset, api_key, enabled, categories }."""
    try:
        data = request.get_json() or {}
        name = (data.get('name') or '').strip() or 'Unnamed'
        preset = (data.get('preset') or 'manual').strip().lower()
        api_key = (data.get('api_key') or '').strip()
        enabled = data.get('enabled', True)
        categories = data.get('categories')
        if not isinstance(categories, list):
            categories = list(INDEXER_CATEGORIES_DEFAULT_IDS)
        indexers = _get_indexers_config()
        indexers.append({
            'name': name,
            'preset': preset,
            'api_key': api_key,
            'enabled': enabled,
            'categories': categories,
        })
        _save_indexers_list(indexers)
        return jsonify({'success': True, 'index': len(indexers) - 1}), 200
    except Exception as e:
        logger.exception('Indexers add error')
        return jsonify({'success': False, 'error': str(e)}), 500


@common_bp.route('/api/indexers/<int:index>', methods=['PUT'])
def api_indexers_update(index):
    """Update indexer at index. Body: { name, preset, api_key?, enabled, categories? }. Omit api_key to keep existing."""
    try:
        indexers = _get_indexers_config()
        if index < 0 or index >= len(indexers):
            return jsonify({'success': False, 'error': 'Index out of range'}), 400
        data = request.get_json() or {}
        name = (data.get('name') or '').strip() or 'Unnamed'
        preset = (data.get('preset') or 'manual').strip().lower()
        api_key_new = (data.get('api_key') or '').strip()
        enabled = data.get('enabled', True)
        categories = data.get('categories')
        if not isinstance(categories, list):
            existing_cats = indexers[index].get('categories')
            categories = list(existing_cats) if isinstance(existing_cats, list) else list(INDEXER_CATEGORIES_DEFAULT_IDS)
        existing = indexers[index]
        api_key = api_key_new if api_key_new else (existing.get('api_key') or '')
        indexers[index] = {
            'name': name,
            'preset': preset,
            'api_key': api_key,
            'enabled': enabled,
            'categories': categories,
        }
        _save_indexers_list(indexers)
        return jsonify({'success': True}), 200
    except Exception as e:
        logger.exception('Indexers update error')
        return jsonify({'success': False, 'error': str(e)}), 500


@common_bp.route('/api/indexers/<int:index>', methods=['DELETE'])
def api_indexers_delete(index):
    """Delete indexer at index."""
    try:
        indexers = _get_indexers_config()
        if index < 0 or index >= len(indexers):
            return jsonify({'success': False, 'error': 'Index out of range'}), 400
        indexers.pop(index)
        _save_indexers_list(indexers)
        return jsonify({'success': True}), 200
    except Exception as e:
        logger.exception('Indexers delete error')
        return jsonify({'success': False, 'error': str(e)}), 500


# --- Movie Hunt Profiles (default "Standard" profile, app instances design) ---
PROFILES_DEFAULT_NAME = 'Standard'

# Default qualities for new profiles (Movie Hunt; id, name, enabled, order)
# Matches Movie Hunt quality list: Raw-HD, BR-DISK, Remux/WEB/Bluray/HDTV by resolution, SDTV, DVD, then scene/screener (DVDSCR, REGIONAL, TELECINE, TELESYNC, CAM, WORKPRINT, Unknown)
PROFILES_DEFAULT_QUALITIES = [
    {'id': 'rawhd', 'name': 'Raw-HD', 'enabled': False, 'order': 0},
    {'id': 'brdisk', 'name': 'BR-DISK', 'enabled': False, 'order': 1},
    {'id': 'remux2160', 'name': 'Remux-2160p', 'enabled': False, 'order': 2},
    {'id': 'web2160', 'name': 'WEB 2160p', 'enabled': True, 'order': 3},
    {'id': 'bluray2160', 'name': 'Bluray-2160p', 'enabled': True, 'order': 4},
    {'id': 'hdtv2160', 'name': 'HDTV-2160p', 'enabled': True, 'order': 5},
    {'id': 'remux1080', 'name': 'Remux-1080p', 'enabled': False, 'order': 6},
    {'id': 'web1080', 'name': 'WEB 1080p', 'enabled': True, 'order': 7},
    {'id': 'bluray1080', 'name': 'Bluray-1080p', 'enabled': True, 'order': 8},
    {'id': 'hdtv1080', 'name': 'HDTV-1080p', 'enabled': True, 'order': 9},
    {'id': 'web720', 'name': 'WEB 720p', 'enabled': True, 'order': 10},
    {'id': 'bluray720', 'name': 'Bluray-720p', 'enabled': True, 'order': 11},
    {'id': 'hdtv720', 'name': 'HDTV-720p', 'enabled': True, 'order': 12},
    {'id': 'web480', 'name': 'WEB 480p', 'enabled': True, 'order': 13},
    {'id': 'sdtv', 'name': 'SDTV', 'enabled': True, 'order': 14},
    {'id': 'dvd', 'name': 'DVD', 'enabled': False, 'order': 15},
    {'id': 'dvdscr', 'name': 'DVDSCR', 'enabled': False, 'order': 16},
    {'id': 'regional', 'name': 'REGIONAL', 'enabled': False, 'order': 17},
    {'id': 'telecine', 'name': 'TELECINE', 'enabled': False, 'order': 18},
    {'id': 'telesync', 'name': 'TELESYNC', 'enabled': False, 'order': 19},
    {'id': 'cam', 'name': 'CAM', 'enabled': False, 'order': 20},
    {'id': 'workprint', 'name': 'WORKPRINT', 'enabled': False, 'order': 21},
    {'id': 'unknown', 'name': 'Unknown', 'enabled': False, 'order': 22},
]


def _profile_defaults():
    """Return a full default profile dict (for new profiles)."""
    return {
        'name': PROFILES_DEFAULT_NAME,
        'is_default': True,
        'upgrades_allowed': True,
        'upgrade_until_quality': 'WEB 2160p',
        'min_custom_format_score': 0,
        'upgrade_until_custom_format_score': 0,
        'upgrade_score_increment': 100,
        'language': 'English',
        'qualities': [dict(q) for q in PROFILES_DEFAULT_QUALITIES],
    }


def _normalize_profile(p):
    """Ensure profile has all keys with defaults; qualities is list of {id, name, enabled, order}."""
    defaults = _profile_defaults()
    out = dict(defaults)
    for k, v in (p or {}).items():
        if k == 'qualities':
            continue
        if v is not None:
            out[k] = v
    if p and isinstance(p.get('qualities'), list) and len(p['qualities']) > 0:
        out['qualities'] = []
        seen_ids = set()
        for q in p['qualities']:
            if isinstance(q, dict) and q.get('id') is not None:
                qid = str(q.get('id', ''))
                seen_ids.add(qid)
                entry = {
                    'id': qid,
                    'name': str(q.get('name', q.get('id', ''))),
                    'enabled': bool(q.get('enabled', True)),
                    'order': int(q.get('order', 0)),
                }
                if q.get('score') is not None:
                    try:
                        entry['score'] = int(q['score'])
                    except (TypeError, ValueError):
                        pass
                out['qualities'].append(entry)
        # Merge in any default qualities missing from this profile (e.g. new Remux-1080p)
        for dq in PROFILES_DEFAULT_QUALITIES:
            if dq.get('id') not in seen_ids:
                out['qualities'].append({
                    'id': str(dq.get('id', '')),
                    'name': str(dq.get('name', '')),
                    'enabled': bool(dq.get('enabled', False)),
                    'order': int(dq.get('order', 0)),
                })
        out['qualities'].sort(key=lambda x: (x.get('order', 0), x.get('id', '')))
    return out


def _get_profiles_config():
    """Get Movie Hunt profiles list from database. Ensures at least default 'Standard' exists."""
    from src.primary.utils.database import get_database
    db = get_database()
    config = db.get_app_config('movie_hunt_profiles')
    if not config or not isinstance(config.get('profiles'), list):
        profiles = []
    else:
        profiles = list(config['profiles'])
    if not profiles:
        first = _profile_defaults()
        first['name'] = PROFILES_DEFAULT_NAME
        first['is_default'] = True
        profiles = [first]
        db.save_app_config('movie_hunt_profiles', {'profiles': profiles})
    return profiles


def _save_profiles_config(profiles_list):
    """Save Movie Hunt profiles to database."""
    from src.primary.utils.database import get_database
    db = get_database()
    db.save_app_config('movie_hunt_profiles', {'profiles': profiles_list})


def _get_profile_by_name_or_default(quality_profile_name):
    """
    Resolve quality_profile (e.g. 'Standard (Default)' or '4K') to the actual profile from config.
    Returns normalized profile dict, or the default profile if not found / empty.
    """
    profiles = _get_profiles_config()
    if not quality_profile_name or not (quality_profile_name or '').strip():
        for p in profiles:
            if p.get('is_default'):
                return _normalize_profile(p)
        return _normalize_profile(profiles[0]) if profiles else _profile_defaults()
    want = (quality_profile_name or '').strip()
    want_base = want.replace(' (Default)', '').replace('(Default)', '').strip()
    for p in profiles:
        name = (p.get('name') or '').strip()
        if name == want or name == want_base:
            return _normalize_profile(p)
        if name.replace(' (Default)', '').strip() == want_base:
            return _normalize_profile(p)
    for p in profiles:
        if p.get('is_default'):
            return _normalize_profile(p)
    return _normalize_profile(profiles[0]) if profiles else _profile_defaults()


def _release_matches_quality(release_title, quality_name):
    """
    Return True if release_title (indexer result) appears to match the quality (e.g. 'WEB 1080p', 'Bluray-2160p').
    Uses simple keyword/resolution matching; release_title is the NZB release name.
    """
    if not release_title or not quality_name:
        return False
    t = (release_title or '').lower()
    q = (quality_name or '').lower().replace('-', ' ')
    # Resolution: 2160p -> 2160, 1080p -> 1080, 720p -> 720, 480p -> 480
    if '2160' in q or '2160p' in q:
        if '2160' not in t:
            return False
    elif '1080' in q or '1080p' in q:
        if '1080' not in t:
            return False
    elif '720' in q or '720p' in q:
        if '720' not in t:
            return False
    elif '480' in q or '480p' in q:
        if '480' not in t:
            return False
    # Source keywords
    if 'web' in q:
        if 'web' not in t and 'web-dl' not in t and 'webdl' not in t and 'webrip' not in t:
            return False
    if 'bluray' in q or 'blu-ray' in q:
        if 'bluray' not in t and 'blu-ray' not in t and 'brrip' not in t and 'bdrip' not in t:
            return False
    if 'hdtv' in q:
        if 'hdtv' not in t:
            return False
    if 'remux' in q:
        if 'remux' not in t:
            return False
    if 'sdtv' in q:
        if 'sdtv' not in t and 'sd' not in t and '480' not in t:
            return False
    if 'dvd' in q and 'dvdscr' not in q:
        if 'dvd' not in t:
            return False
    return True


def _score_release(release_title, profile):
    """
    Score a release using only custom format scores stored by the user (Settings -> Custom Formats).
    Each custom format's regex (from its JSON specifications) is run against the release title;
    if it matches, that format's configured score is added. Total = sum of all matching format scores.
    No hardcoded values. Returns (total_score, breakdown_str) for display in queue. Higher is better.
    """
    import re
    if not release_title or not (release_title or '').strip():
        return 0, '-'
    parts = []
    total = 0
    try:
        custom_formats = _get_custom_formats_config()
        for cf in custom_formats:
            cf_json = cf.get('custom_format_json')
            score_val = cf.get('score')
            if score_val is None:
                score_val = 0
            try:
                score_val = int(score_val)
            except (TypeError, ValueError):
                score_val = 0
            name = (cf.get('title') or cf.get('name') or 'CF').strip() or 'CF'
            if not cf_json:
                continue
            obj = json.loads(cf_json) if isinstance(cf_json, str) else cf_json
            if not isinstance(obj, dict):
                continue
            
            # TRaSH/Radarr custom format: specifications array with required=true items that have regex in fields.value
            specifications = obj.get('specifications') or []
            if not isinstance(specifications, list):
                continue
            
            # TRaSH formats have positive specs (identify the feature) and negative specs (exclude false positives)
            # A format matches if: (1) at least one positive required spec matches, (2) all negative required specs pass
            has_positive_match = False
            all_negative_pass = True
            has_any_spec = False
            
            for spec in specifications:
                if not isinstance(spec, dict):
                    continue
                required = spec.get('required', False)
                if not required:
                    continue
                negate = spec.get('negate', False)
                fields = spec.get('fields') or {}
                
                implementation = spec.get('implementation', '')
                
                # ResolutionSpecification: check if title contains the resolution (e.g. 720p, 1080p, 2160p)
                if 'resolution' in implementation.lower():
                    resolution_value = fields.get('value') if isinstance(fields, dict) else None
                    if resolution_value is not None:
                        has_any_spec = True
                        try:
                            res_int = int(resolution_value)
                            # Look for e.g. "1080p", "1080", "720p", "2160p" in title
                            res_pattern = r'\b' + str(res_int) + r'p?\b'
                            found = bool(re.search(res_pattern, release_title, re.IGNORECASE))
                            if negate:
                                if found:
                                    all_negative_pass = False
                                    break
                            else:
                                if found:
                                    has_positive_match = True
                        except (TypeError, ValueError):
                            pass
                    continue
                
                pattern = fields.get('value') if isinstance(fields, dict) else None
                if not pattern or not isinstance(pattern, str):
                    continue
                
                has_any_spec = True
                try:
                    found = bool(re.search(pattern, release_title, re.IGNORECASE))
                    if negate:
                        # Negative spec: pattern must NOT match
                        if found:
                            all_negative_pass = False
                            break
                    else:
                        # Positive spec: pattern must match
                        if found:
                            has_positive_match = True
                except re.error:
                    continue
            
            # Format matches if we checked specs, found at least one positive match, and all negatives passed
            if has_any_spec and has_positive_match and all_negative_pass:
                total += score_val
                # Format: show +N for positive, -N for negative (no + prefix on negative)
                if score_val >= 0:
                    parts.append('%s +%d' % (name, score_val))
                else:
                    parts.append('%s %d' % (name, score_val))
    except Exception:
        pass
    if not parts:
        return 0, '-'
    return total, ', '.join(parts)


def _best_result_matching_profile(results, profile):
    """
    From Newznab results list [{title, nzb_url}, ...], return the best result that matches
    the profile (enabled qualities). Best = highest _score_release. Returns (result, score, breakdown_str).
    If none match profile, returns (None, 0, '').
    """
    if not results:
        return None, 0, ''
    enabled_names = [q.get('name') or '' for q in (profile.get('qualities') or []) if q.get('enabled')]
    if not enabled_names:
        # No profile filter: score all and pick best
        scored = []
        for r in results:
            title = (r.get('title') or '').strip()
            sc, br = _score_release(title, profile)
            scored.append((sc, br, r))
        scored.sort(key=lambda x: (-x[0], x[2].get('title') or ''))
        best = scored[0]
        return best[2], best[0], best[1]
    # Filter to profile-matching only, then pick best by score
    candidates = []
    for r in results:
        title = (r.get('title') or '').strip()
        for qname in enabled_names:
            if _release_matches_quality(title, qname):
                sc, br = _score_release(title, profile)
                candidates.append((sc, br, r))
                break
    if not candidates:
        return None, 0, ''
    candidates.sort(key=lambda x: (-x[0], x[2].get('title') or ''))
    best = candidates[0]
    return best[2], best[0], best[1]


def _first_result_matching_profile(results, profile):
    """
    From Newznab results list [{title, nzb_url}, ...], return the first result whose title
    matches any enabled quality in the profile. If none match, return None (do not use a
    release that violates the profile).
    """
    if not results:
        return None
    enabled_names = [q.get('name') or '' for q in (profile.get('qualities') or []) if q.get('enabled')]
    if not enabled_names:
        return results[0]
    for r in results:
        title = (r.get('title') or '').strip()
        for qname in enabled_names:
            if _release_matches_quality(title, qname):
                return r
    return None


@common_bp.route('/api/profiles', methods=['GET'])
def api_profiles_list():
    """List Movie Hunt profiles (default Standard ensured). Returns full profile objects."""
    try:
        profiles = _get_profiles_config()
        out = []
        for i, p in enumerate(profiles):
            normalized = _normalize_profile(p)
            normalized['index'] = i
            out.append(normalized)
        return jsonify({'profiles': out}), 200
    except Exception as e:
        logger.exception('Profiles list error')
        return jsonify({'profiles': [], 'error': str(e)}), 200


def _unique_profile_name(base_name, existing_profiles):
    """If base_name is already used, append -<random alphanumeric> until unique."""
    existing_names = {(p.get('name') or '').strip() for p in existing_profiles}
    base = (base_name or 'Unnamed').strip() or 'Unnamed'
    if base not in existing_names:
        return base
    alphabet = string.ascii_lowercase + string.digits
    name = base
    while name in existing_names:
        suffix = ''.join(secrets.choice(alphabet) for _ in range(4))
        name = base + '-' + suffix
    return name


@common_bp.route('/api/profiles', methods=['POST'])
def api_profiles_add():
    """Add a profile. Body: { name }. New profile uses full defaults, is_default=False.
    If name duplicates an existing profile, appends -<random alphanumeric> (e.g. -a3f2)."""
    try:
        data = request.get_json() or {}
        base_name = (data.get('name') or '').strip() or 'Unnamed'
        profiles = _get_profiles_config()
        name = _unique_profile_name(base_name, profiles)
        new_profile = _profile_defaults()
        new_profile['name'] = name
        new_profile['is_default'] = False
        profiles.append(new_profile)
        _save_profiles_config(profiles)
        return jsonify({'success': True, 'index': len(profiles) - 1, 'name': name}), 200
    except Exception as e:
        logger.exception('Profiles add error')
        return jsonify({'success': False, 'error': str(e)}), 500


@common_bp.route('/api/profiles/<int:index>', methods=['PATCH'])
def api_profiles_patch(index):
    """Update profile: body can include name, is_default, upgrades_allowed, upgrade_until_quality,
    min_custom_format_score, upgrade_until_custom_format_score, upgrade_score_increment,
    language, qualities. Only one default allowed."""
    try:
        profiles = _get_profiles_config()
        if index < 0 or index >= len(profiles):
            return jsonify({'success': False, 'error': 'Index out of range'}), 400
        data = request.get_json() or {}
        if data.get('is_default') is True:
            # Move this profile to index 0 (leftmost) and set as default
            profile = profiles.pop(index)
            for i in range(len(profiles)):
                profiles[i]['is_default'] = False
            profile['is_default'] = True
            profiles.insert(0, profile)
            index = 0  # rest of PATCH applies to the moved profile (now at 0)
        name = (data.get('name') or '').strip()
        if name:
            profiles[index]['name'] = name
        if 'upgrades_allowed' in data:
            profiles[index]['upgrades_allowed'] = bool(data['upgrades_allowed'])
        if 'upgrade_until_quality' in data:
            profiles[index]['upgrade_until_quality'] = str(data.get('upgrade_until_quality') or 'WEB 2160p').strip()
        if 'min_custom_format_score' in data:
            try:
                profiles[index]['min_custom_format_score'] = int(data['min_custom_format_score'])
            except (TypeError, ValueError):
                pass
        if 'upgrade_until_custom_format_score' in data:
            try:
                profiles[index]['upgrade_until_custom_format_score'] = int(data['upgrade_until_custom_format_score'])
            except (TypeError, ValueError):
                pass
        if 'upgrade_score_increment' in data:
            try:
                profiles[index]['upgrade_score_increment'] = int(data['upgrade_score_increment'])
            except (TypeError, ValueError):
                pass
        if 'language' in data:
            profiles[index]['language'] = str(data.get('language') or 'English').strip()
        if 'qualities' in data and isinstance(data['qualities'], list):
            qualities = []
            for q in data['qualities']:
                if isinstance(q, dict) and q.get('id') is not None:
                    entry = {
                        'id': str(q.get('id', '')),
                        'name': str(q.get('name', q.get('id', ''))),
                        'enabled': bool(q.get('enabled', True)),
                        'order': int(q.get('order', 0)),
                    }
                    if q.get('score') is not None:
                        try:
                            entry['score'] = int(q['score'])
                        except (TypeError, ValueError):
                            pass
                    qualities.append(entry)
            qualities.sort(key=lambda x: (x.get('order', 0), x.get('id', '')))
            profiles[index]['qualities'] = qualities
        _save_profiles_config(profiles)
        return jsonify({'success': True}), 200
    except Exception as e:
        logger.exception('Profiles patch error')
        return jsonify({'success': False, 'error': str(e)}), 500


@common_bp.route('/api/profiles/<int:index>/clone', methods=['POST'])
def api_profiles_clone(index):
    """Duplicate profile at index. New profile has name + ' (Copy)' and is_default=False."""
    try:
        profiles = _get_profiles_config()
        if index < 0 or index >= len(profiles):
            return jsonify({'success': False, 'error': 'Index out of range'}), 400
        source = profiles[index]
        import copy
        new_profile = copy.deepcopy(source)
        new_profile['name'] = ((source.get('name') or '').strip() or 'Unnamed') + ' (Copy)'
        new_profile['is_default'] = False
        profiles.append(new_profile)
        _save_profiles_config(profiles)
        return jsonify({'success': True, 'index': len(profiles) - 1}), 200
    except Exception as e:
        logger.exception('Profiles clone error')
        return jsonify({'success': False, 'error': str(e)}), 500


@common_bp.route('/api/profiles/<int:index>', methods=['DELETE'])
def api_profiles_delete(index):
    """Delete profile. Any profile can be deleted; empty list triggers auto-creation of default Standard on next read."""
    try:
        profiles = _get_profiles_config()
        if index < 0 or index >= len(profiles):
            return jsonify({'success': False, 'error': 'Index out of range'}), 400
        was_default = profiles[index].get('is_default')
        profiles.pop(index)
        if was_default and profiles:
            profiles[0]['is_default'] = True
            _save_profiles_config(profiles)
        else:
            _save_profiles_config(profiles)
        return jsonify({'success': True}), 200
    except Exception as e:
        logger.exception('Profiles delete error')
        return jsonify({'success': False, 'error': str(e)}), 500


# --- Movie Management Settings (Movie Naming + Importing) ---

def _movie_management_defaults():
    """Default values for movie management settings (Movie Naming first, then Importing; no skip free space check)."""
    return {
        'rename_movies': True,
        'replace_illegal_characters': True,
        'colon_replacement': 'Smart Replace',
        'standard_movie_format': '{Movie Title} ({Release Year}) {Quality Full}',
        'movie_folder_format': '{Movie Title} ({Release Year})',
        'minimum_free_space_gb': 10,
        'use_hardlinks_instead_of_copy': True,
        'import_using_script': False,
        'import_extra_files': False,
    }


def _get_movie_management_config():
    """Get movie management config from database; merge with defaults."""
    from src.primary.utils.database import get_database
    db = get_database()
    config = db.get_app_config('movie_management')
    defaults = _movie_management_defaults()
    if not config or not isinstance(config, dict):
        return dict(defaults)
    out = dict(defaults)
    for k, v in config.items():
        if k in out:
            out[k] = v
    return out


@common_bp.route('/api/settings/movie-management', methods=['GET'])
def api_movie_management_get():
    """Get movie management settings (Movie Naming + Importing)."""
    try:
        data = _get_movie_management_config()
        return jsonify(data), 200
    except Exception as e:
        logger.exception('Movie management get error')
        return jsonify(_movie_management_defaults()), 200


@common_bp.route('/api/settings/movie-management', methods=['PATCH'])
def api_movie_management_patch():
    """Update movie management settings. Body: same keys as GET (partial allowed)."""
    try:
        data = request.get_json() or {}
        current = _get_movie_management_config()
        allowed = set(_movie_management_defaults().keys())
        for k, v in data.items():
            if k in allowed:
                current[k] = v
        from src.primary.utils.database import get_database
        db = get_database()
        db.save_app_config('movie_management', current)
        return jsonify(_get_movie_management_config()), 200
    except Exception as e:
        logger.exception('Movie management patch error')
        return jsonify({'error': str(e)}), 500


# --- Movie Hunt Activity (Queue, History, Blocklist) ---
# 100% independent: uses only Movie Hunt's download clients (SABnzbd/NZBGet). No Radarr.
# Only track items this Huntarr requested: use a dedicated category so multiple Radarrs/Huntarrs don't mix.
MOVIE_HUNT_QUEUE_CATEGORY = 'moviehunt'
# Category we send to SAB/NZBGet when client category is empty or "default" (so queue shows only our requests).
MOVIE_HUNT_DEFAULT_CATEGORY = 'movies'

def _download_client_base_url(client):
    """Build base URL for a download client (host:port)."""
    host = (client.get('host') or '').strip()
    if not host:
        return None
    if not (host.startswith('http://') or host.startswith('https://')):
        host = 'http://' + host
    port = client.get('port', 8080)
    return '%s:%s' % (host.rstrip('/'), port)


def _get_requested_queue_ids():
    """Return dict of client_name -> set of queue ids (nzo_id / NZBID) that we requested."""
    from src.primary.utils.database import get_database
    db = get_database()
    config = db.get_app_config('movie_hunt_requested')
    if not config or not isinstance(config.get('by_client'), dict):
        return {}
    out = {}
    for cname, entries in config['by_client'].items():
        if not isinstance(entries, list):
            out[cname] = set()
            continue
        ids = set()
        for e in entries:
            if isinstance(e, dict):
                ids.add(str(e.get('id', '')))
            else:
                ids.add(str(e))
        out[cname] = ids
    return out


def _get_requested_display(client_name, queue_id):
    """Return {title, year, score, score_breakdown} for a requested queue item for display. Empty/0 if not found."""
    from src.primary.utils.database import get_database
    db = get_database()
    config = db.get_app_config('movie_hunt_requested')
    if not config or not isinstance(config.get('by_client'), dict):
        return {'title': '', 'year': '', 'score': None, 'score_breakdown': ''}
    cname = (client_name or 'Download client').strip() or 'Download client'
    entries = config.get('by_client', {}).get(cname) or []
    sid = str(queue_id)
    for e in entries:
        if isinstance(e, dict) and str(e.get('id', '')) == sid:
            score = e.get('score')
            if score is not None:
                try:
                    score = int(score)
                except (TypeError, ValueError):
                    score = None
            return {
                'title': (e.get('title') or '').strip(),
                'year': (e.get('year') or '').strip(),
                'score': score,
                'score_breakdown': (e.get('score_breakdown') or '').strip(),
            }
    return {'title': '', 'year': '', 'score': None, 'score_breakdown': ''}


def _add_requested_queue_id(client_name, queue_id, title=None, year=None, score=None, score_breakdown=None):
    """Record that we requested this queue item (so we only show it in Activity queue). Store title/year and optional score for display."""
    from src.primary.utils.database import get_database
    db = get_database()
    config = db.get_app_config('movie_hunt_requested') or {}
    by_client = config.get('by_client') or {}
    cname = (client_name or 'Download client').strip() or 'Download client'
    entries = list(by_client.get(cname) or [])
    sid = str(queue_id)
    # Normalize old format (list of strings) to list of dicts
    normalized = []
    for e in entries:
        if isinstance(e, dict):
            normalized.append(e)
        else:
            normalized.append({'id': str(e), 'title': '', 'year': ''})
    existing_ids = {e.get('id') for e in normalized}
    entry = {'id': sid, 'title': (title or '').strip(), 'year': (year or '').strip()}
    if score is not None:
        entry['score'] = int(score)
    if score_breakdown is not None:
        entry['score_breakdown'] = (score_breakdown or '').strip()
    if sid not in existing_ids:
        normalized.append(entry)
    else:
        # Update existing entry with new title/year/score if we're re-adding
        for i, e in enumerate(normalized):
            if e.get('id') == sid:
                normalized[i] = {**e, **entry}
                break
    by_client[cname] = normalized
    config['by_client'] = by_client
    db.save_app_config('movie_hunt_requested', config)


def _prune_requested_queue_ids(client_name, current_queue_ids):
    """Remove from our requested list any id no longer in the client's queue (completed/removed)."""
    if not current_queue_ids:
        return
    from src.primary.utils.database import get_database
    db = get_database()
    config = db.get_app_config('movie_hunt_requested')
    if not config or not isinstance(config.get('by_client'), dict):
        return
    cname = (client_name or 'Download client').strip() or 'Download client'
    if cname not in config['by_client']:
        return
    current = set(str(i) for i in current_queue_ids)
    entries = config['by_client'][cname]
    kept = []
    for e in entries:
        eid = e.get('id') if isinstance(e, dict) else str(e)
        if str(eid) in current:
            kept.append(e)
    config['by_client'][cname] = kept
    db.save_app_config('movie_hunt_requested', config)


def _extract_year_from_filename(filename):
    """Extract a 4-digit year (1900-2099) from a release filename. Returns None if not found."""
    if not filename:
        return None
    import re
    m = re.search(r'\b(19\d{2}|20\d{2})\b', filename)
    return m.group(1) if m else None


def _extract_quality_from_filename(filename):
    """
    Extract a short quality/resolution string from a release filename for the queue QUALITY column.
    e.g. "Movie.2024.1080p.WEB.H.264-GROUP" -> "1080p WEB", "Movie.2160p.BluRay.Remux..." -> "2160p BluRay Remux"
    """
    if not filename or not (filename or '').strip():
        return '-'
    t = (filename or '').lower()
    parts = []
    if '2160' in t:
        parts.append('2160p')
    elif '1080' in t:
        parts.append('1080p')
    elif '720' in t:
        parts.append('720p')
    elif '480' in t:
        parts.append('480p')
    elif 'sdtv' in t or ('sd' in t and '720' not in t and '1080' not in t):
        parts.append('SDTV')
    if 'remux' in t:
        parts.append('Remux')
    if 'bluray' in t or 'blu-ray' in t or 'brrip' in t or 'bdrip' in t:
        parts.append('BluRay')
    elif 'web' in t or 'web-dl' in t or 'webdl' in t or 'webrip' in t:
        parts.append('WEB')
    elif 'hdtv' in t:
        parts.append('HDTV')
    elif 'dvd' in t and 'dvdscr' not in t:
        parts.append('DVD')
    if not parts:
        return '-'
    return ' '.join(parts)


def _extract_formats_from_filename(filename):
    """
    Extract video/audio format (codec) string from a release filename for the queue FORMATS column.
    e.g. "Movie.1080p.WEB.H.264-GROUP" -> "H.264", "Movie.2160p.HEVC.Atmos" -> "H.265 / Atmos"
    """
    if not filename or not (filename or '').strip():
        return '-'
    t = (filename or '').upper()
    # Normalize separators for matching (dots, hyphens, underscores)
    t_flat = t.replace('.', ' ').replace('-', ' ').replace('_', ' ')
    parts = []
    # Video codecs (order matters: prefer HEVC before H.264 to avoid partial match)
    if 'HEVC' in t or 'X265' in t or 'H265' in t or 'H.265' in t:
        parts.append('H.265')
    elif 'AV1' in t:
        parts.append('AV1')
    elif 'VP9' in t:
        parts.append('VP9')
    elif 'X264' in t or 'H264' in t or 'H.264' in t:
        parts.append('H.264')
    elif 'XVID' in t or 'DIVX' in t:
        parts.append('XviD')
    # Audio
    if 'ATMOS' in t:
        parts.append('Atmos')
    if 'DDP' in t or 'DOLBY' in t and 'DIGITAL' in t_flat:
        if 'Atmos' not in parts:
            parts.append('DDP')
    elif 'DTS' in t:
        parts.append('DTS')
    if 'AAC' in t and 'AAC' not in ' '.join(parts):
        parts.append('AAC')
    if 'AC3' in t or 'DD 5' in t_flat or 'DD5' in t:
        if 'DDP' not in parts and 'AAC' not in parts:
            parts.append('AC3')
    if 'FLAC' in t:
        parts.append('FLAC')
    if not parts:
        return '-'
    return ' / '.join(parts)


def _format_queue_scoring(score, score_breakdown=None):
    """Format scoring for queue column: '95 (1080p +30, WEB +20)' or '95' or '-'."""
    if score is None:
        return '-'
    try:
        s = int(score)
    except (TypeError, ValueError):
        return '-'
    br = (score_breakdown or '').strip()
    if br:
        return '%d (%s)' % (s, br)
    return str(s)


def _format_queue_display_name(filename, title=None, year=None):
    """Format display as 'Title (Year)' or 'Title'. Uses stored title/year if present, else parses filename."""
    display_title = (title or '').strip()
    display_year = (year or '').strip()
    if not display_year and filename:
        display_year = _extract_year_from_filename(filename) or ''
    if display_title:
        if display_year:
            return '%s (%s)' % (display_title, display_year)
        return display_title
    # Fallback: clean filename (dots to spaces, remove trailing group like -NTb) and add year if found
    if not filename:
        return '-'
    clean = filename.replace('.', ' ').strip()
    if display_year:
        return '%s (%s)' % (clean, display_year)
    return clean


def _get_download_client_queue(client):
    """
    Fetch queue from one download client (SABnzbd or NZBGet). Returns list of activity-shaped dicts:
    { id, movie, year, languages, quality, formats, time_left, progress, instance_name }.
    """
    base_url = _download_client_base_url(client)
    if not base_url:
        return []
    client_type = (client.get('type') or 'nzbget').strip().lower()
    name = (client.get('name') or 'Download client').strip() or 'Download client'
    # Filter by the category configured for this client (same category we use when sending NZBs).
    # When client category is empty or "default", we use "movies" so we send/filter by "movies".
    # Case-insensitive: SAB may return "Default", we compare in lowercase.
    raw_cat = (client.get('category') or '').strip()
    raw_cat_lower = raw_cat.lower()
    if raw_cat_lower in ('default', '*', ''):
        client_cat_lower = MOVIE_HUNT_DEFAULT_CATEGORY.lower()
    else:
        client_cat_lower = raw_cat_lower
    allowed_cats = frozenset((client_cat_lower,))
    requested_ids = _get_requested_queue_ids().get(name, set())
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
            logger.info("Movie Hunt queue: requesting SABnzbd queue from %s (%s)", name, base_url)
            try:
                r = requests.get(url, params=params, timeout=15, verify=verify_ssl)
                r.raise_for_status()
            except requests.RequestException as e:
                logger.warning("Movie Hunt queue: SABnzbd request failed for %s: %s", name, e)
                return []
            data = r.json()
            if not isinstance(data, dict):
                logger.warning("Movie Hunt queue: SABnzbd returned non-dict for %s", name)
                return []
            # SABnzbd may return {"error": "API Key Required"} or {"error": "API Key Incorrect"}
            sab_error = data.get('error') or data.get('error_msg')
            if sab_error:
                logger.warning("Movie Hunt queue: SABnzbd %s returned error: %s", name, sab_error)
                return []
            # SABnzbd can put slots under queue.slots or at top-level slots; slots can be list or dict
            slots_raw = (data.get('queue') or {}).get('slots') or data.get('slots') or []
            if isinstance(slots_raw, dict):
                slots = list(slots_raw.values())
            elif isinstance(slots_raw, list):
                slots = slots_raw
            else:
                slots = []
            if not slots and (data.get('queue') or data):
                logger.info("Movie Hunt queue: SABnzbd %s returned 0 slots (response keys: %s)", name, list(data.keys()))
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
                display = _get_requested_display(name, nzo_id)
                display_name = _format_queue_display_name(filename, display.get('title'), display.get('year'))
                scoring_str = _format_queue_scoring(display.get('score'), display.get('score_breakdown'))
                # SABnzbd slot: mb (total MB), mbleft (remaining MB), timeleft, percentage, cat
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
                # SABnzbd uses mbleft (MB remaining); some APIs also give sizeleft (bytes or string)
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
            _prune_requested_queue_ids(name, current_queue_ids)
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
                display = _get_requested_display(name, nzb_id)
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
            _prune_requested_queue_ids(name, current_queue_ids)
    except Exception as e:
        logger.debug("Movie Hunt activity queue from download client %s: %s", name, e)
    return items


def _delete_from_download_client(client, item_ids):
    """
    Delete queue items from one download client by id(s). item_ids: list of str/int (nzo_id for SABnzbd, NZBID for NZBGet).
    Returns (removed_count, error_message). error_message is None on full success.
    """
    if not item_ids:
        return 0, None
    base_url = _download_client_base_url(client)
    if not base_url:
        return 0, 'Invalid client'
    client_type = (client.get('type') or 'nzbget').strip().lower()
    name = (client.get('name') or 'Download client').strip() or 'Download client'
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
                # SABnzbd API: mode=queue&name=delete&value=NZO_ID (not mode=queue.delete)
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
                        logger.warning("Movie Hunt queue: SABnzbd delete failed for %s: %s", name, err)
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


def _get_activity_queue():
    """Fetch queue from Movie Hunt download clients only (SABnzbd/NZBGet). 100% independent of Radarr."""
    clients = _get_clients_config()
    enabled = [c for c in clients if c.get('enabled', True)]
    if not enabled:
        logger.info("Movie Hunt queue: no download clients configured or enabled. Add SABnzbd/NZBGet in Settings → Movie Hunt → Clients (total in config: %s).", len(clients))
        return [], 0
    logger.info("Movie Hunt queue: fetching from %s download client(s)", len(enabled))
    all_items = []
    for client in enabled:
        items = _get_download_client_queue(client)
        all_items.extend(items)
    if all_items:
        logger.info("Movie Hunt queue: returning %s item(s) from download client(s)", len(all_items))
    return all_items, len(all_items)


@common_bp.route('/api/activity/<view>', methods=['GET'])
def api_activity_get(view):
    """Get activity items (queue, history, or blocklist). Queue uses Movie Hunt API; history/blocklist stubbed."""
    if view not in ('queue', 'history', 'blocklist'):
        return jsonify({'error': 'Invalid view'}), 400
    page = max(1, request.args.get('page', 1, type=int))
    page_size = max(1, min(100, request.args.get('page_size', 20, type=int)))
    search = (request.args.get('search') or '').strip().lower()

    if view == 'queue':
        all_items, total = _get_activity_queue()
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

    # History and blocklist: stub for now
    return jsonify({
        'items': [],
        'total': 0,
        'page': page,
        'total_pages': 1
    }), 200


def _remove_activity_queue_items(items):
    """Remove selected items from Movie Hunt download client queue. items = [ {id, instance_name}, ... ]. Returns (success, error_message)."""
    if not items or not isinstance(items, list):
        return False, 'No items selected'
    clients = _get_clients_config()
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


def _clear_activity_queue():
    """Remove all items from Movie Hunt download client queue. Returns (success, error_message)."""
    all_items, _ = _get_activity_queue()
    if not all_items:
        return True, None
    to_remove = [{'id': i.get('id'), 'instance_name': i.get('instance_name') or 'Download client'} for i in all_items if i.get('id') is not None]
    if not to_remove:
        return True, None
    return _remove_activity_queue_items(to_remove)


@common_bp.route('/api/activity/<view>', methods=['DELETE'])
def api_activity_delete(view):
    """Remove selected queue items (body: { items: [{ id, instance_name }, ...] }) or clear all. History/blocklist: stub."""
    if view not in ('queue', 'history', 'blocklist'):
        return jsonify({'error': 'Invalid view'}), 400
    if view == 'queue':
        body = request.get_json(silent=True) or {}
        items = body.get('items') if isinstance(body, dict) else None
        if not items or not isinstance(items, list) or len(items) == 0:
            return jsonify({'success': False, 'error': 'No items selected'}), 200
        success, err_msg = _remove_activity_queue_items(items)
        if not success and err_msg:
            return jsonify({'success': False, 'error': err_msg}), 200
        return jsonify({'success': True}), 200
    return jsonify({'success': True}), 200


# --- Movie Hunt Custom Formats (JSON; Pre-Format + Import) ---
# TRaSH Guides categories and format JSONs from src/primary/trash_custom_formats.py
from .. import trash_custom_formats


def _custom_format_name_from_json(obj):
    """Extract display name from Movie Hunt custom format JSON (top-level 'name' field)."""
    if isinstance(obj, dict) and obj.get('name') is not None:
        return str(obj.get('name', '')).strip() or 'Unnamed'
    return 'Unnamed'


def _recommended_score_from_json(custom_format_json):
    """Extract recommended score from Movie Hunt/TRaSH custom format JSON (trash_scores.default). Returns None if not present."""
    if not custom_format_json:
        return None
    try:
        obj = json.loads(custom_format_json) if isinstance(custom_format_json, str) else custom_format_json
    except (TypeError, json.JSONDecodeError):
        return None
    if not isinstance(obj, dict):
        return None
    trash_scores = obj.get('trash_scores')
    if isinstance(trash_scores, dict) and 'default' in trash_scores:
        try:
            return int(trash_scores['default'])
        except (TypeError, ValueError):
            pass
    return None


def _get_custom_formats_config():
    """Get Movie Hunt custom formats list from database. Default: empty list."""
    from src.primary.utils.database import get_database
    db = get_database()
    config = db.get_app_config('movie_hunt_custom_formats')
    if not config or not isinstance(config.get('custom_formats'), list):
        return []
    return list(config['custom_formats'])


def _save_custom_formats_config(formats_list):
    """Save Movie Hunt custom formats list to database."""
    from src.primary.utils.database import get_database
    db = get_database()
    db.save_app_config('movie_hunt_custom_formats', {'custom_formats': formats_list})


@common_bp.route('/api/custom-formats', methods=['GET'])
def api_custom_formats_list():
    """List Movie Hunt custom formats. Returns list of { index, title, name, custom_format_json, score, recommended_score }."""
    try:
        formats = _get_custom_formats_config()
        out = []
        for i, f in enumerate(formats):
            src = (f.get('source') or 'import').strip().lower()
            if src not in ('import', 'preformat'):
                src = 'import'
            cf_json = f.get('custom_format_json') or '{}'
            score = f.get('score')
            if score is None:
                score = 0
            try:
                score = int(score)
            except (TypeError, ValueError):
                score = 0
            recommended = _recommended_score_from_json(cf_json)
            item = {
                'index': i,
                'title': (f.get('title') or f.get('name') or 'Unnamed').strip() or 'Unnamed',
                'name': (f.get('name') or 'Unnamed').strip() or 'Unnamed',
                'custom_format_json': cf_json,
                'source': src,
                'score': score,
                'recommended_score': recommended,
            }
            if src == 'preformat' and f.get('preformat_id'):
                item['preformat_id'] = f.get('preformat_id')
            out.append(item)
        return jsonify({'custom_formats': out}), 200
    except Exception as e:
        logger.exception('Custom formats list error')
        return jsonify({'custom_formats': [], 'error': str(e)}), 200


@common_bp.route('/api/custom-formats/preformats', methods=['GET'])
def api_custom_formats_preformats():
    """List TRaSH categories (with subcategories and formats) and flat preformats for backward compat."""
    try:
        categories = trash_custom_formats.get_trash_categories()
        all_ids = trash_custom_formats.get_all_preformat_ids()
        preformats = [{'id': pid, 'name': trash_custom_formats.get_trash_format_name(pid) or pid} for pid in all_ids]
        return jsonify({'categories': categories, 'preformats': preformats}), 200
    except Exception as e:
        logger.exception('Preformats list error')
        return jsonify({'categories': [], 'preformats': [], 'error': str(e)}), 200


@common_bp.route('/api/custom-formats', methods=['POST'])
def api_custom_formats_add():
    """Add custom format. Body: source='import'|'preformat', custom_format_json? (for import), preformat_id? (for preformat), title? (optional override)."""
    try:
        data = request.get_json() or {}
        source = (data.get('source') or 'import').strip().lower()
        if source not in ('import', 'preformat'):
            return jsonify({'success': False, 'message': 'source must be import or preformat'}), 400

        if source == 'import':
            raw = data.get('custom_format_json')
            if raw is None or (isinstance(raw, str) and not raw.strip()):
                return jsonify({'success': False, 'message': 'custom_format_json is required for import'}), 400
            if isinstance(raw, str):
                try:
                    obj = json.loads(raw)
                except json.JSONDecodeError as e:
                    return jsonify({'success': False, 'message': f'Invalid JSON: {e}'}), 400
            else:
                obj = raw
            name = _custom_format_name_from_json(obj)
            custom_format_json = json.dumps(obj) if isinstance(obj, dict) else json.dumps(raw)
        else:
            preformat_id = (data.get('preformat_id') or '').strip()
            if not preformat_id:
                return jsonify({'success': False, 'message': 'preformat_id is required for preformat'}), 400
            custom_format_json = trash_custom_formats.get_trash_format_json(preformat_id)
            name = trash_custom_formats.get_trash_format_name(preformat_id)
            if not custom_format_json or not name:
                return jsonify({'success': False, 'message': 'Unknown preformat_id'}), 400
            if isinstance(custom_format_json, dict):
                custom_format_json = json.dumps(custom_format_json)

        title = (data.get('title') or '').strip() or name
        formats = _get_custom_formats_config()
        new_item = {
            'title': title,
            'name': name,
            'custom_format_json': custom_format_json,
            'source': source,
            'score': 0,
        }
        if source == 'preformat' and preformat_id:
            new_item['preformat_id'] = preformat_id
        formats.append(new_item)
        _save_custom_formats_config(formats)
        return jsonify({'success': True, 'index': len(formats) - 1}), 200
    except Exception as e:
        logger.exception('Custom formats add error')
        return jsonify({'success': False, 'error': str(e)}), 500


@common_bp.route('/api/custom-formats/scores', methods=['PUT'])
def api_custom_formats_scores_batch():
    """Update all custom format scores in one request. Body: { scores: [ ... ] } (array by index). Avoids race when saving many."""
    try:
        data = request.get_json() or {}
        scores = data.get('scores')
        if not isinstance(scores, list):
            return jsonify({'success': False, 'message': 'scores array required'}), 400
        formats = _get_custom_formats_config()
        if len(scores) != len(formats):
            return jsonify({'success': False, 'message': 'scores length must match custom formats count'}), 400
        for i in range(len(formats)):
            try:
                val = int(scores[i])
            except (TypeError, ValueError, IndexError):
                val = 0
            formats[i]['score'] = val
        _save_custom_formats_config(formats)
        return jsonify({'success': True}), 200
    except Exception as e:
        logger.exception('Custom formats scores batch error')
        return jsonify({'success': False, 'error': str(e)}), 500


@common_bp.route('/api/custom-formats/<int:index>', methods=['PATCH'])
def api_custom_formats_patch(index):
    """Update custom format. Body: title?, custom_format_json?, score?."""
    try:
        formats = _get_custom_formats_config()
        if index < 0 or index >= len(formats):
            return jsonify({'success': False, 'message': 'Index out of range'}), 400
        data = request.get_json() or {}
        if data.get('title') is not None:
            formats[index]['title'] = (data.get('title') or '').strip() or formats[index].get('name') or 'Unnamed'
        if data.get('score') is not None:
            try:
                formats[index]['score'] = int(data['score'])
            except (TypeError, ValueError):
                formats[index]['score'] = 0
        if data.get('custom_format_json') is not None:
            raw = data['custom_format_json']
            if isinstance(raw, str) and raw.strip():
                try:
                    obj = json.loads(raw)
                    formats[index]['custom_format_json'] = json.dumps(obj)
                    formats[index]['name'] = _custom_format_name_from_json(obj)
                except json.JSONDecodeError:
                    pass
            elif isinstance(raw, dict):
                formats[index]['custom_format_json'] = json.dumps(raw)
                formats[index]['name'] = _custom_format_name_from_json(raw)
        _save_custom_formats_config(formats)
        return jsonify({'success': True}), 200
    except Exception as e:
        logger.exception('Custom formats patch error')
        return jsonify({'success': False, 'error': str(e)}), 500


@common_bp.route('/api/custom-formats/<int:index>', methods=['DELETE'])
def api_custom_formats_delete(index):
    """Delete custom format at index."""
    try:
        formats = _get_custom_formats_config()
        if index < 0 or index >= len(formats):
            return jsonify({'success': False, 'message': 'Index out of range'}), 400
        formats.pop(index)
        _save_custom_formats_config(formats)
        return jsonify({'success': True}), 200
    except Exception as e:
        logger.exception('Custom formats delete error')
        return jsonify({'success': False, 'error': str(e)}), 500


@common_bp.route('/api/custom-formats/preformats/<preformat_id>', methods=['GET'])
def api_custom_formats_preformat_json(preformat_id):
    """Get full JSON for a TRaSH pre-made format by id."""
    try:
        custom_format_json = trash_custom_formats.get_trash_format_json(preformat_id)
        name = trash_custom_formats.get_trash_format_name(preformat_id)
        if not custom_format_json:
            return jsonify({'success': False, 'message': 'Not found'}), 404
        if isinstance(custom_format_json, dict):
            custom_format_json = json.dumps(custom_format_json)
        return jsonify({'success': True, 'name': name or preformat_id, 'custom_format_json': custom_format_json}), 200
    except Exception as e:
        logger.exception('Preformat get error')
        return jsonify({'success': False, 'error': str(e)}), 500


def _get_clients_config():
    """Get download clients list from database (app_config app_type=clients)."""
    from src.primary.utils.database import get_database
    db = get_database()
    config = db.get_app_config('clients')
    if not config or not isinstance(config.get('clients'), list):
        return []
    return config['clients']


def _save_clients_list(clients_list):
    """Save download clients list to database."""
    from src.primary.utils.database import get_database
    db = get_database()
    db.save_app_config('clients', {'clients': clients_list})


def _clamp_priority(val, lo=1, hi=99, default=50):
    """Clamp client_priority to [lo, hi]; return default if invalid."""
    try:
        n = int(val, 10)
        return max(lo, min(hi, n))
    except (TypeError, ValueError):
        return default


@common_bp.route('/api/clients', methods=['GET'])
def api_clients_list():
    """List saved download clients (sensitive fields masked to last 4 chars)."""
    try:
        clients = _get_clients_config()
        out = []
        for i, c in enumerate(clients):
            api_key = (c.get('api_key') or '')
            api_key_last4 = api_key[-4:] if len(api_key) >= 4 else '****'
            
            pwd = (c.get('password') or '')
            password_last4 = pwd[-4:] if len(pwd) >= 4 else '****'
            
            out.append({
                'index': i,
                'name': c.get('name') or 'Unnamed',
                'type': c.get('type') or 'nzbget',
                'host': c.get('host') or '',
                'port': c.get('port') or 8080,
                'enabled': c.get('enabled', True),
                'api_key_last4': api_key_last4,
                'username': c.get('username') or '',
                'password_last4': password_last4,
                'category': c.get('category') or 'movies',
                'recent_priority': c.get('recent_priority') or 'default',
                'older_priority': c.get('older_priority') or 'default',
                'client_priority': _clamp_priority(c.get('client_priority'), 1, 99, 50),
            })
        return jsonify({'clients': out}), 200
    except Exception as e:
        logger.exception('Clients list error')
        return jsonify({'clients': [], 'error': str(e)}), 200


@common_bp.route('/api/clients', methods=['POST'])
def api_clients_add():
    """Add a new download client. Body: { name, type, host, port, enabled, api_key, username, password, category, recent_priority, older_priority, client_priority }."""
    try:
        data = request.get_json() or {}
        name = (data.get('name') or '').strip() or 'Unnamed'
        client_type = (data.get('type') or 'nzbget').strip().lower()
        host = (data.get('host') or '').strip()
        raw_port = data.get('port')
        try:
            port = int(raw_port, 10) if raw_port is not None and str(raw_port).strip() != '' else 8080
        except (TypeError, ValueError):
            port = 8080
        enabled = data.get('enabled', True)
        api_key = (data.get('api_key') or '').strip()
        username = (data.get('username') or '').strip()
        password = (data.get('password') or '').strip()
        category = (data.get('category') or 'movies').strip() or 'movies'
        recent_priority = (data.get('recent_priority') or 'default').strip().lower() or 'default'
        older_priority = (data.get('older_priority') or 'default').strip().lower() or 'default'
        client_priority = _clamp_priority(data.get('client_priority'), 1, 99, 50)
        clients = _get_clients_config()
        clients.append({
            'name': name,
            'type': client_type,
            'host': host,
            'port': port,
            'enabled': enabled,
            'api_key': api_key,
            'username': username,
            'password': password,
            'category': category,
            'recent_priority': recent_priority,
            'older_priority': older_priority,
            'client_priority': client_priority,
        })
        _save_clients_list(clients)
        return jsonify({'success': True, 'index': len(clients) - 1}), 200
    except Exception as e:
        logger.exception('Clients add error')
        return jsonify({'success': False, 'error': str(e)}), 500


@common_bp.route('/api/clients/<int:index>', methods=['PUT'])
def api_clients_update(index):
    """Update download client at index. Body: { name, type, host, port, enabled, api_key?, username?, password? }. Omit credentials to keep existing."""
    try:
        clients = _get_clients_config()
        if index < 0 or index >= len(clients):
            return jsonify({'success': False, 'error': 'Index out of range'}), 400
        data = request.get_json() or {}
        name = (data.get('name') or '').strip() or 'Unnamed'
        client_type = (data.get('type') or 'nzbget').strip().lower()
        host = (data.get('host') or '').strip()
        port = int(data.get('port'), 10) if data.get('port') is not None else clients[index].get('port', 8080)
        enabled = data.get('enabled', True)
        
        # Handle API key
        api_key_new = (data.get('api_key') or '').strip()
        existing = clients[index]
        api_key = api_key_new if api_key_new else (existing.get('api_key') or '')
        
        # Handle username
        username_new = (data.get('username') or '').strip()
        username = username_new if username_new else (existing.get('username') or '')
        
        # Handle password
        password_new = (data.get('password') or '').strip()
        password = password_new if password_new else (existing.get('password') or '')
        
        category = (data.get('category') or existing.get('category') or 'movies').strip() or 'movies'
        recent_priority = (data.get('recent_priority') or existing.get('recent_priority') or 'default').strip().lower() or 'default'
        older_priority = (data.get('older_priority') or existing.get('older_priority') or 'default').strip().lower() or 'default'
        client_priority = _clamp_priority(data.get('client_priority') if 'client_priority' in data else existing.get('client_priority'), 1, 99, 50)
        clients[index] = {
            'name': name,
            'type': client_type,
            'host': host,
            'port': port,
            'enabled': enabled,
            'api_key': api_key,
            'username': username,
            'password': password,
            'category': category,
            'recent_priority': recent_priority,
            'older_priority': older_priority,
            'client_priority': client_priority,
        }
        _save_clients_list(clients)
        return jsonify({'success': True}), 200
    except Exception as e:
        logger.exception('Clients update error')
        return jsonify({'success': False, 'error': str(e)}), 500


@common_bp.route('/api/clients/<int:index>', methods=['DELETE'])
def api_clients_delete(index):
    """Delete download client at index."""
    try:
        clients = _get_clients_config()
        if index < 0 or index >= len(clients):
            return jsonify({'success': False, 'error': 'Index out of range'}), 400
        clients.pop(index)
        _save_clients_list(clients)
        return jsonify({'success': True}), 200
    except Exception as e:
        logger.exception('Clients delete error')
        return jsonify({'success': False, 'error': str(e)}), 500


@common_bp.route('/api/clients/test-connection', methods=['POST'])
def api_clients_test_connection():
    """Test connection to a download client (SABnzbd or NZBGet)."""
    try:
        data = request.get_json() or {}
        client_type = (data.get('type') or 'nzbget').strip().lower()
        host = (data.get('host') or '').strip()
        port = data.get('port', 8080)
        api_key = (data.get('api_key') or '').strip()
        username = (data.get('username') or '').strip()
        password = (data.get('password') or '').strip()
        
        if not host:
            return jsonify({'success': False, 'message': 'Host is required'}), 400
        
        # Auto-correct URL if missing http(s) scheme
        if not (host.startswith('http://') or host.startswith('https://')):
            host = f"http://{host}"
        
        # Build the base URL
        base_url = f"{host.rstrip('/')}:{port}"
        
        # Get SSL verification setting
        from src.primary.settings_manager import get_ssl_verify_setting
        verify_ssl = get_ssl_verify_setting()
        
        # Test connection based on client type
        if client_type == 'sabnzbd':
            # SABnzbd uses /api?mode=version
            test_url = f"{base_url}/api"
            params = {'mode': 'version', 'output': 'json'}
            if api_key:
                params['apikey'] = api_key
            
            try:
                response = requests.get(test_url, params=params, timeout=10, verify=verify_ssl)
                response.raise_for_status()
                data = response.json()
                
                # SABnzbd returns version in the 'version' key
                if 'version' in data:
                    version = data['version']
                    return jsonify({'success': True, 'message': f'Connected to SABnzbd {version}'}), 200
                else:
                    return jsonify({'success': False, 'message': 'Connected but unexpected response format'}), 200
                    
            except requests.exceptions.HTTPError as e:
                if response.status_code == 401 or response.status_code == 403:
                    return jsonify({'success': False, 'message': 'Authentication failed: Invalid API key'}), 200
                else:
                    return jsonify({'success': False, 'message': f'HTTP Error {response.status_code}'}), 200
            except requests.exceptions.Timeout:
                return jsonify({'success': False, 'message': 'Connection timeout'}), 200
            except requests.exceptions.ConnectionError:
                return jsonify({'success': False, 'message': 'Connection refused - Check host and port'}), 200
            except Exception as e:
                return jsonify({'success': False, 'message': str(e)}), 200
                
        elif client_type == 'nzbget':
            # NZBGet uses JSON-RPC API
            test_url = f"{base_url}/jsonrpc"
            
            # Build JSON-RPC request for version
            payload = {
                'method': 'version',
                'params': [],
                'id': 1
            }
            
            try:
                # NZBGet uses HTTP basic auth
                auth = (username, password) if username and password else None
                
                response = requests.post(test_url, json=payload, auth=auth, timeout=10, verify=verify_ssl)
                response.raise_for_status()
                data = response.json()
                
                # NZBGet returns version in the 'result' key
                if 'result' in data:
                    version = data['result']
                    return jsonify({'success': True, 'message': f'Connected to NZBGet {version}'}), 200
                elif 'error' in data:
                    error_msg = data['error'].get('message', 'Unknown error')
                    return jsonify({'success': False, 'message': f'NZBGet error: {error_msg}'}), 200
                else:
                    return jsonify({'success': False, 'message': 'Connected but unexpected response format'}), 200
                    
            except requests.exceptions.HTTPError as e:
                if response.status_code == 401 or response.status_code == 403:
                    return jsonify({'success': False, 'message': 'Authentication failed: Invalid username or password'}), 200
                else:
                    return jsonify({'success': False, 'message': f'HTTP Error {response.status_code}'}), 200
            except requests.exceptions.Timeout:
                return jsonify({'success': False, 'message': 'Connection timeout'}), 200
            except requests.exceptions.ConnectionError:
                return jsonify({'success': False, 'message': 'Connection refused - Check host and port'}), 200
            except Exception as e:
                return jsonify({'success': False, 'message': str(e)}), 200
        else:
            return jsonify({'success': False, 'message': f'Unknown client type: {client_type}'}), 400
            
    except Exception as e:
        logger.exception('Client connection test error')
        return jsonify({'success': False, 'message': 'Internal server error'}), 500


def _search_newznab_movie(base_url, api_key, query, categories, timeout=15):
    """
    Search a Newznab indexer for movie NZBs. Returns list of {title, nzb_url}.
    categories: list of category ids (e.g. 2000,2010) or comma string.
    """
    if not (base_url and api_key and query and query.strip()):
        return []
    base_url = base_url.rstrip('/')
    api_key = api_key.strip()
    query = query.strip()
    if isinstance(categories, (list, tuple)):
        cat_str = ','.join(str(c) for c in categories)
    else:
        cat_str = str(categories).strip() or '2000,2010,2020,2030,2040,2045,2050,2070'
    url = f'{base_url}?t=search&apikey={requests.utils.quote(api_key)}&q={requests.utils.quote(query)}&cat={cat_str}&limit=10'
    try:
        from src.primary.settings_manager import get_ssl_verify_setting
        verify_ssl = get_ssl_verify_setting()
        r = requests.get(url, timeout=timeout, verify=verify_ssl)
        if r.status_code != 200:
            return []
        text = (r.text or '').strip()
        if not text:
            return []
        results = []
        # Parse JSON (some indexers return JSON)
        if text.lstrip().startswith('{'):
            try:
                data = json.loads(text)
                channel = data.get('channel') or data.get('rss', {}).get('channel') or {}
                items = channel.get('item') or channel.get('items') or []
                if isinstance(items, dict):
                    items = [items]
                for it in items:
                    nzb_url = None
                    enc = it.get('enclosure') or (it.get('enclosures') or [{}])[0] if isinstance(it.get('enclosures'), list) else None
                    if isinstance(enc, dict) and enc.get('@url'):
                        nzb_url = enc.get('@url')
                    elif isinstance(enc, dict) and enc.get('url'):
                        nzb_url = enc.get('url')
                    if not nzb_url and it.get('link'):
                        nzb_url = it.get('link')
                    if not nzb_url:
                        continue
                    title = (it.get('title') or '').strip() or 'Unknown'
                    results.append({'title': title, 'nzb_url': nzb_url})
                return results
            except (ValueError, TypeError, KeyError):
                pass
        # Parse XML (default Newznab response)
        root = ET.fromstring(text)
        ns = {'nzb': 'http://www.newznab.com/DTD/2010/feeds/'}
        items = root.findall('.//nzb:item', ns) or root.findall('.//item')
        for item in items:
            nzb_url = None
            enc = item.find('nzb:enclosure', ns) or item.find('enclosure')
            if enc is not None and enc.get('url'):
                nzb_url = enc.get('url')
            if not nzb_url:
                link = item.find('nzb:link', ns) or item.find('link')
                if link is not None and (link.text or '').strip():
                    nzb_url = (link.text or '').strip()
            if not nzb_url:
                continue
            title_el = item.find('nzb:title', ns) or item.find('title')
            title = (title_el.text or '').strip() if title_el is not None else 'Unknown'
            results.append({'title': title, 'nzb_url': nzb_url})
        return results
    except (ET.ParseError, requests.RequestException) as e:
        logger.debug('Newznab search error: %s', e)
        return []


def _add_nzb_to_download_client(client, nzb_url, nzb_name, category, verify_ssl):
    """
    Send NZB URL to SABnzbd or NZBGet. Returns (success: bool, message: str, queue_id: str|int|None).
    queue_id is the nzo_id (SAB) or NZBGet group id so we can track this as a requested item.
    """
    client_type = (client.get('type') or 'nzbget').strip().lower()
    host = (client.get('host') or '').strip()
    if not host:
        return False, 'Download client has no host', None
    if not (host.startswith('http://') or host.startswith('https://')):
        host = f'http://{host}'
    port = client.get('port', 8080)
    base_url = f'{host.rstrip("/")}:{port}'
    # When category is empty or "default", send "movies" so SAB gets a proper category.
    raw = (category or client.get('category') or '').strip()
    if raw.lower() in ('default', '*', ''):
        cat = MOVIE_HUNT_DEFAULT_CATEGORY
    else:
        cat = raw or MOVIE_HUNT_DEFAULT_CATEGORY
    try:
        if client_type == 'sabnzbd':
            api_key = (client.get('api_key') or '').strip()
            url = f'{base_url}/api'
            params = {'mode': 'addurl', 'name': nzb_url, 'output': 'json'}
            if api_key:
                params['apikey'] = api_key
            if cat:
                params['cat'] = cat
            r = requests.get(url, params=params, timeout=15, verify=verify_ssl)
            r.raise_for_status()
            data = r.json()
            if data.get('status') is True or data.get('nzo_ids'):
                nzo_ids = data.get('nzo_ids') or []
                queue_id = nzo_ids[0] if nzo_ids else None
                return True, 'Added to SABnzbd', queue_id
            return False, data.get('error', 'SABnzbd returned an error'), None
        elif client_type == 'nzbget':
            jsonrpc_url = f'{base_url}/jsonrpc'
            username = (client.get('username') or '').strip()
            password = (client.get('password') or '').strip()
            auth = (username, password) if (username or password) else None
            payload = {
                'method': 'append',
                'params': ['', nzb_url, cat, 0, False, False, '', 0, 'SCORE', False, []],
                'id': 1
            }
            r = requests.post(jsonrpc_url, json=payload, auth=auth, timeout=15, verify=verify_ssl)
            r.raise_for_status()
            data = r.json()
            if data.get('result') and data.get('result') != 0:
                # NZBGet append returns group id in result
                return True, 'Added to NZBGet', data.get('result')
            err = data.get('error', {})
            return False, err.get('message', 'NZBGet returned an error'), None
        return False, f'Unknown client type: {client_type}', None
    except requests.RequestException as e:
        return False, str(e) or 'Connection failed', None


@common_bp.route('/api/movie-hunt/request', methods=['POST'])
def api_movie_hunt_request():
    """
    Request a movie via Movie Hunt: search configured indexers, send first NZB to first enabled download client.
    Body: { title, year?, instance?, root_folder?, quality_profile? }. Instance defaults to "default".
    """
    try:
        data = request.get_json() or {}
        title = (data.get('title') or '').strip()
        if not title:
            return jsonify({'success': False, 'message': 'Title is required'}), 400
        year = data.get('year')
        if year is not None:
            year = str(year).strip()
        else:
            year = ''
        instance = (data.get('instance') or 'default').strip() or 'default'
        root_folder = (data.get('root_folder') or '').strip() or None
        quality_profile = (data.get('quality_profile') or '').strip() or None

        indexers = _get_indexers_config()
        clients = _get_clients_config()
        enabled_indexers = [i for i in indexers if i.get('enabled', True) and (i.get('preset') or '').strip().lower() != 'manual']
        enabled_clients = [c for c in clients if c.get('enabled', True)]

        if not enabled_indexers:
            return jsonify({'success': False, 'message': 'No indexers configured or enabled. Add indexers in Movie Hunt Settings.'}), 400
        if not enabled_clients:
            return jsonify({'success': False, 'message': 'No download clients configured or enabled. Add a client in Movie Hunt Settings.'}), 400

        query = f'{title}'
        if year:
            query = f'{title} {year}'
        # Resolve selected quality profile so we only pick a release that matches its setup
        profile = _get_profile_by_name_or_default(quality_profile)
        from src.primary.settings_manager import get_ssl_verify_setting
        verify_ssl = get_ssl_verify_setting()
        nzb_url = None
        nzb_title = None
        indexer_used = None
        request_score = 0
        request_score_breakdown = ''
        for idx in enabled_indexers:
            preset = (idx.get('preset') or '').strip().lower()
            base_url = INDEXER_PRESET_URLS.get(preset)
            if not base_url:
                continue
            api_key = (idx.get('api_key') or '').strip()
            if not api_key:
                continue
            categories = idx.get('categories') or [2000, 2010, 2020, 2030, 2040, 2045, 2050, 2070]
            results = _search_newznab_movie(base_url, api_key, query, categories, timeout=15)
            if results:
                # Pick best release by score among those matching the profile (not just first)
                chosen, chosen_score, chosen_breakdown = _best_result_matching_profile(results, profile)
                if chosen:
                    nzb_url = chosen.get('nzb_url')
                    nzb_title = chosen.get('title', 'Unknown')
                    indexer_used = idx.get('name') or preset
                    request_score = chosen_score
                    request_score_breakdown = chosen_breakdown or ''
                    break
        if not nzb_url:
            profile_name = (profile.get('name') or 'Standard').strip()
            return jsonify({
                'success': False,
                'message': f'No release found that matches your quality profile "{profile_name}". The indexer had results but none were in the allowed resolutions/sources (e.g. Standard allows 1080p/720p/480p, not 2160p). Try selecting a different profile (e.g. 4K) or search again later.'
            }), 404
        client = enabled_clients[0]
        # Use client's category; empty/default → "movies" so we send and filter by "movies"
        raw_cat = (client.get('category') or '').strip()
        request_category = MOVIE_HUNT_DEFAULT_CATEGORY if raw_cat.lower() in ('default', '*', '') else (raw_cat or MOVIE_HUNT_DEFAULT_CATEGORY)
        ok, msg, queue_id = _add_nzb_to_download_client(client, nzb_url, nzb_title or f'{title}.nzb', request_category, verify_ssl)
        if not ok:
            return jsonify({'success': False, 'message': f'Sent to download client but failed: {msg}'}), 500
        # Track this request so Activity queue only shows items we requested (with title/year and score for display)
        if queue_id:
            client_name = (client.get('name') or 'Download client').strip() or 'Download client'
            _add_requested_queue_id(client_name, queue_id, title=title, year=year or '', score=request_score, score_breakdown=request_score_breakdown)
        # Add to Media Collection for tracking (with root_folder for auto availability detection)
        tmdb_id = data.get('tmdb_id')
        poster_path = (data.get('poster_path') or '').strip() or None
        root_folder = (data.get('root_folder') or '').strip() or None
        _collection_append(title=title, year=year, tmdb_id=tmdb_id, poster_path=poster_path, root_folder=root_folder)
        return jsonify({
            'success': True,
            'message': f'"{nzb_title or title}" sent to {client.get("name") or "download client"}.',
            'indexer': indexer_used,
            'client': client.get('name') or 'download client'
        }), 200
    except Exception as e:
        logger.exception('Movie Hunt request error')
        return jsonify({'success': False, 'message': str(e)}), 500


def _get_collection_config():
    """Get Movie Hunt collection (requested media) from database."""
    from src.primary.utils.database import get_database
    db = get_database()
    config = db.get_app_config('movie_hunt_collection')
    if not config or not isinstance(config.get('items'), list):
        return []
    return config['items']


def _save_collection_config(items_list):
    """Save Movie Hunt collection to database."""
    from src.primary.utils.database import get_database
    db = get_database()
    db.save_app_config('movie_hunt_collection', {'items': items_list})


def _collection_append(title, year, tmdb_id=None, poster_path=None, root_folder=None):
    """Append one entry to Media Collection after successful request."""
    from datetime import datetime
    items = _get_collection_config()
    items.append({
        'title': title,
        'year': year or '',
        'tmdb_id': tmdb_id,
        'poster_path': poster_path or '',
        'root_folder': root_folder or '',
        'requested_at': datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ'),
        'status': 'requested'
    })
    _save_collection_config(items)


# Video extensions for availability detection in root folder
_VIDEO_EXTENSIONS = frozenset(('.mkv', '.mp4', '.avi', '.mov', '.wmv', '.m4v', '.mpg', '.mpeg', '.webm', '.flv', '.m2ts', '.ts'))


def _detect_available_in_root_folder(root_path, title, year):
    """
    Check if a movie appears to be present in root_path (direct files or one level of subdirs).
    Matches by video extension and title (or title+year) in filename or parent dir name.
    """
    if not root_path or not title:
        return False
    import re
    title_lower = (title or '').lower().strip()
    year_str = (year or '').strip()
    # Normalize for matching: strip punctuation, collapse spaces
    title_norm = re.sub(r'[^\w\s]', ' ', title_lower)
    title_norm = ' '.join(title_norm.split())
    if not title_norm:
        return False
    if not os.path.isdir(root_path):
        return False
    try:
        for name in os.listdir(root_path):
            full = os.path.join(root_path, name)
            if os.path.isfile(full):
                base, ext = os.path.splitext(name)
                if ext.lower() in _VIDEO_EXTENSIONS and title_norm in base.lower().replace('.', ' ').replace('_', ' '):
                    return True
            elif os.path.isdir(full):
                for subname in os.listdir(full):
                    subfull = os.path.join(full, subname)
                    if os.path.isfile(subfull):
                        base, ext = os.path.splitext(subname)
                        if ext.lower() in _VIDEO_EXTENSIONS:
                            # Match by dir name or filename
                            if title_norm in name.lower().replace('.', ' ').replace('_', ' ') or title_norm in base.lower().replace('.', ' ').replace('_', ' '):
                                return True
                            if year_str and year_str in name and title_norm in name.lower().replace('.', ' ').replace('_', ' '):
                                return True
    except OSError:
        pass
    return False


def _normalize_root_folders(folders):
    """Ensure list of { path, is_default }; exactly one default. Accepts legacy list of strings."""
    if not folders:
        return []
    out = []
    for i, f in enumerate(folders):
        if isinstance(f, str):
            path = (f or '').strip()
        else:
            path = (f.get('path') or '').strip()
        out.append({'path': path, 'is_default': bool(f.get('is_default') if isinstance(f, dict) else False)})
    # Ensure exactly one default: if none or multiple, set first as default
    defaults = [j for j, o in enumerate(out) if o.get('is_default')]
    if len(defaults) != 1:
        for j in range(len(out)):
            out[j]['is_default'] = (j == 0)
    return out


def _get_root_folders_config():
    """Get Movie Hunt root folders list from database. Returns list of { path, is_default }."""
    from src.primary.utils.database import get_database
    db = get_database()
    config = db.get_app_config('movie_hunt_root_folders')
    if not config or not isinstance(config.get('root_folders'), list):
        return []
    raw = config['root_folders']
    normalized = _normalize_root_folders(raw)
    # Migrate legacy format (list of strings) to list of { path, is_default }
    if raw and isinstance(raw[0], str):
        db.save_app_config('movie_hunt_root_folders', {'root_folders': normalized})
    return normalized


def _save_root_folders_config(root_folders_list):
    """Save Movie Hunt root folders list to database."""
    from src.primary.utils.database import get_database
    db = get_database()
    normalized = _normalize_root_folders(root_folders_list)
    db.save_app_config('movie_hunt_root_folders', {'root_folders': normalized})


TEST_FILENAME = 'movie-hunt.test'


@common_bp.route('/api/movie-hunt/root-folders', methods=['GET'])
def api_movie_hunt_root_folders_list():
    """List Movie Hunt root folders with free space and is_default (like Requestarr)."""
    import shutil
    try:
        folders = _get_root_folders_config()
        out = []
        for i, f in enumerate(folders):
            path = (f.get('path') or '').strip()
            free_space = None
            if path:
                try:
                    usage = shutil.disk_usage(path)
                    free_space = usage.free
                except (OSError, FileNotFoundError):
                    pass
            out.append({
                'index': i,
                'path': path,
                'freeSpace': free_space,
                'is_default': bool(f.get('is_default', False)),
            })
        return jsonify({'root_folders': out}), 200
    except Exception as e:
        logger.exception('Root folders list error')
        return jsonify({'root_folders': [], 'error': str(e)}), 200


@common_bp.route('/api/movie-hunt/root-folders', methods=['POST'])
def api_movie_hunt_root_folders_add():
    """Add a root folder. Body: { path }. First folder is default; additional ones are not."""
    try:
        data = request.get_json() or {}
        path = (data.get('path') or '').strip()
        if not path:
            return jsonify({'success': False, 'message': 'Path is required'}), 400
        if '..' in path:
            return jsonify({'success': False, 'message': 'Path cannot contain ..'}), 400
        folders = _get_root_folders_config()
        normalized = os.path.normpath(path)
        if any((f.get('path') or '').strip() == normalized for f in folders):
            return jsonify({'success': False, 'message': 'That path is already added'}), 400
        # First folder is default; additional ones are not
        is_first = len(folders) == 0
        folders.append({'path': normalized, 'is_default': is_first})
        _save_root_folders_config(folders)
        return jsonify({'success': True, 'index': len(folders) - 1}), 200
    except Exception as e:
        logger.exception('Root folders add error')
        return jsonify({'success': False, 'message': str(e)}), 500


@common_bp.route('/api/movie-hunt/root-folders/<int:index>', methods=['DELETE'])
def api_movie_hunt_root_folders_delete(index):
    """Delete root folder at index. If default was removed, first remaining becomes default."""
    try:
        folders = _get_root_folders_config()
        if index < 0 or index >= len(folders):
            return jsonify({'success': False, 'message': 'Index out of range'}), 400
        was_default = folders[index].get('is_default')
        folders.pop(index)
        if was_default and folders:
            folders[0]['is_default'] = True
        _save_root_folders_config(folders)
        return jsonify({'success': True}), 200
    except Exception as e:
        logger.exception('Root folders delete error')
        return jsonify({'success': False, 'message': str(e)}), 500


@common_bp.route('/api/movie-hunt/root-folders/<int:index>/default', methods=['PATCH'])
def api_movie_hunt_root_folders_set_default(index):
    """Set root folder at index as default; others become non-default."""
    try:
        folders = _get_root_folders_config()
        if index < 0 or index >= len(folders):
            return jsonify({'success': False, 'message': 'Index out of range'}), 400
        for i in range(len(folders)):
            folders[i]['is_default'] = (i == index)
        _save_root_folders_config(folders)
        return jsonify({'success': True}), 200
    except Exception as e:
        logger.exception('Root folders set-default error')
        return jsonify({'success': False, 'message': str(e)}), 500


# Default browse root for Docker; /media is a common mount point for media
BROWSE_DEFAULT_PATH = '/'
BROWSE_ALWAYS_INCLUDE_PATHS = ('/media',)


@common_bp.route('/api/movie-hunt/root-folders/browse', methods=['GET'])
def api_movie_hunt_root_folders_browse():
    """
    List directories under a path for the file browser. ?path= (default /).
    Returns { path, directories: [ { name, path } ] }. Ensures /media is included at root for Docker.
    """
    try:
        path = (request.args.get('path') or '').strip() or BROWSE_DEFAULT_PATH
        if '..' in path:
            return jsonify({'path': path, 'directories': [], 'error': 'Invalid path'}), 400
        dir_path = os.path.abspath(os.path.normpath(path))
        if not os.path.isdir(dir_path):
            return jsonify({'path': dir_path, 'directories': [], 'error': 'Not a directory'}), 200
        entries = []
        try:
            for name in sorted(os.listdir(dir_path)):
                full = os.path.join(dir_path, name)
                if os.path.isdir(full):
                    entries.append({'name': name, 'path': full})
        except OSError as e:
            return jsonify({'path': dir_path, 'directories': [], 'error': str(e)}), 200
        if dir_path == os.path.abspath(BROWSE_DEFAULT_PATH) or dir_path == os.path.abspath('/'):
            for extra in BROWSE_ALWAYS_INCLUDE_PATHS:
                if not any(e['path'] == extra for e in entries):
                    name = os.path.basename(extra.rstrip(os.sep)) or 'media'
                    entries.append({'name': name, 'path': extra})
            entries.sort(key=lambda e: (e['name'].lower(), e['path']))
        return jsonify({'path': dir_path, 'directories': entries}), 200
    except Exception as e:
        logger.exception('Root folders browse error')
        return jsonify({'path': '', 'directories': [], 'error': str(e)}), 500


@common_bp.route('/api/movie-hunt/root-folders/test', methods=['POST'])
def api_movie_hunt_root_folders_test():
    """
    Test write/read on a path: write movie-hunt.test, read it back, delete it.
    Body: { path }. Ensures no permission errors for Movie Hunt media detection.
    """
    try:
        data = request.get_json() or {}
        path = (data.get('path') or '').strip()
        if not path:
            return jsonify({'success': False, 'message': 'Path is required'}), 400
        if '..' in path:
            return jsonify({'success': False, 'message': 'Path cannot contain ..'}), 400
        dir_path = os.path.abspath(os.path.normpath(path))
        if not os.path.isdir(dir_path):
            return jsonify({'success': False, 'message': f'Path is not a directory: {path}'}), 400
        test_path = os.path.join(dir_path, TEST_FILENAME)
        content = 'movie-hunt test ' + datetime.utcnow().isoformat() + 'Z'
        try:
            with open(test_path, 'w') as f:
                f.write(content)
        except OSError as e:
            return jsonify({'success': False, 'message': f'Could not write: {e}'}), 200
        try:
            with open(test_path, 'r') as f:
                read_back = f.read()
            if read_back != content:
                return jsonify({'success': False, 'message': 'Read back content did not match'}), 200
        except OSError as e:
            try:
                os.remove(test_path)
            except OSError:
                pass
            return jsonify({'success': False, 'message': f'Could not read: {e}'}), 200
        try:
            os.remove(test_path)
        except OSError:
            pass
        return jsonify({'success': True, 'message': 'Write and read test passed.'}), 200
    except Exception as e:
        logger.exception('Root folders test error')
        return jsonify({'success': False, 'message': str(e)}), 500


@common_bp.route('/api/movie-hunt/collection', methods=['GET'])
def api_movie_hunt_collection_list():
    """List Media Collection (requested movies). ?q= search, ?page=1&page_size=20."""
    try:
        items = _get_collection_config()
        q = (request.args.get('q') or '').strip().lower()
        if q:
            items = [x for x in items if q in ((x.get('title') or '') + ' ' + str(x.get('year') or '')).lower()]
        total = len(items)
        page = max(1, int(request.args.get('page', 1)))
        page_size = max(1, min(100, int(request.args.get('page_size', 20))))
        start = (page - 1) * page_size
        page_items = items[start:start + page_size]
        # Enrich with auto-detected availability from root folder storage (response only, not persisted)
        out_items = []
        for it in page_items:
            entry = dict(it)
            root_path = (entry.get('root_folder') or '').strip()
            if root_path and (entry.get('status') or '').lower() != 'available':
                if _detect_available_in_root_folder(root_path, entry.get('title') or '', entry.get('year')):
                    entry['status'] = 'available'
            out_items.append(entry)
        return jsonify({
            'items': out_items,
            'total': total,
            'page': page,
            'page_size': page_size
        }), 200
    except Exception as e:
        logger.exception('Movie Hunt collection list error')
        return jsonify({'items': [], 'total': 0, 'page': 1, 'page_size': 20, 'error': str(e)}), 200


@common_bp.route('/api/movie-hunt/collection/<int:index>', methods=['PATCH'])
def api_movie_hunt_collection_patch(index):
    """Update collection item status. Body: { status } e.g. 'requested' or 'available'."""
    try:
        data = request.get_json() or {}
        status = (data.get('status') or '').strip() or None
        if not status:
            return jsonify({'success': False, 'message': 'status is required'}), 400
        items = _get_collection_config()
        if index < 0 or index >= len(items):
            return jsonify({'success': False, 'message': 'Not found'}), 404
        items[index]['status'] = status
        _save_collection_config(items)
        return jsonify({'success': True, 'item': items[index]}), 200
    except Exception as e:
        logger.exception('Movie Hunt collection patch error')
        return jsonify({'success': False, 'message': str(e)}), 500


@common_bp.route('/api/movie-hunt/collection/<int:index>', methods=['DELETE'])
def api_movie_hunt_collection_delete(index):
    """Remove item from Media Collection."""
    try:
        items = _get_collection_config()
        if index < 0 or index >= len(items):
            return jsonify({'success': False, 'message': 'Not found'}), 404
        items.pop(index)
        _save_collection_config(items)
        return jsonify({'success': True}), 200
    except Exception as e:
        logger.exception('Movie Hunt collection delete error')
        return jsonify({'success': False, 'message': str(e)}), 500


@common_bp.route('/api/sleep.json', methods=['GET'])
def api_get_sleep_json():
    """API endpoint to serve sleep/cycle data from the database for frontend access"""
    try:
        from src.primary.utils.database import get_database
        
        db = get_database()
        sleep_data = db.get_sleep_data()
        
        # Convert database format to frontend format
        frontend_data = {}
        for app_type, data in sleep_data.items():
            frontend_data[app_type] = {
                "next_cycle": data.get("next_cycle_time"),
                "updated_at": data.get("last_cycle_end") or data.get("last_cycle_start"),
                "cyclelock": data.get("cycle_lock", True)
            }
        
        # Add CORS headers to allow any origin to access this resource
        response = jsonify(frontend_data)
        response.headers.add('Access-Control-Allow-Origin', '*')
        return response
        
    except Exception as e:
        logger.error(f"Error serving sleep data from database: {e}")
        # Return empty object instead of error to prevent UI breaking
        response = jsonify({})
        response.headers.add('Access-Control-Allow-Origin', '*')
        return response, 200

# --- Authentication Routes --- #

@common_bp.route('/login', methods=['GET', 'POST'])
def login_route():
    if request.method == 'POST':
        try: # Wrap the POST logic in a try block for better error handling
            data = request.json
            username = data.get('username')
            password = data.get('password')
            twoFactorCode = data.get('twoFactorCode') # Changed from 'otp_code' to match frontend form

            if not username or not password:
                 logger.warning("Login attempt with missing username or password.")
                 return jsonify({"success": False, "error": "Username and password are required"}), 400

            # Call verify_user which now returns (auth_success, needs_2fa)
            auth_success, needs_2fa = verify_user(username, password, twoFactorCode)
            
            logger.debug(f"Auth result for '{username}': success={auth_success}, needs_2fa={needs_2fa}")

            if auth_success:
                # User is authenticated (password correct, and 2FA if needed was correct)
                session_token = create_session(username)
                session[SESSION_COOKIE_NAME] = session_token # Store token in Flask session immediately
                response = jsonify({"success": True, "redirect": "./"}) # Add redirect URL
                response.set_cookie(SESSION_COOKIE_NAME, session_token, httponly=True, samesite='Lax', path='/') # Add path
                logger.debug(f"User '{username}' logged in successfully.")
                return response
            elif needs_2fa:
                # Authentication failed *because* 2FA was required (or code was invalid)
                # The specific reason (missing vs invalid code) is logged in verify_user
                logger.warning(f"Login failed for '{username}': 2FA required or invalid.")
                logger.debug(f"Returning 2FA required response: {{\"success\": False, \"requires_2fa\": True, \"requiresTwoFactor\": True, \"error\": \"Invalid or missing 2FA code\"}}")
                
                # Use all common variations of the 2FA flag to ensure compatibility
                return jsonify({
                    "success": False, 
                    "requires_2fa": True, 
                    "requiresTwoFactor": True,
                    "requires2fa": True,
                    "requireTwoFactor": True,
                    "error": "Two-factor authentication code required"
                }), 401
            else:
                # Authentication failed for other reasons (e.g., wrong password, user not found)
                # Specific reason logged in verify_user
                logger.warning(f"Login failed for '{username}': Invalid credentials or other error.")
                return jsonify({"success": False, "error": "Invalid username or password"}), 401 # Use 401

        except Exception as e:
            logger.error(f"Unexpected error during login POST for user '{username if 'username' in locals() else 'unknown'}': {e}", exc_info=True)
            return jsonify({"success": False, "error": "An internal server error occurred during login."}), 500
    else:
        # GET request - show login page
        if not user_exists():
             logger.info("No user exists, redirecting to setup.")
             from src.primary import settings_manager
             base_url = settings_manager.get_setting('general', 'base_url', '').strip()
             if base_url and base_url != '/':
                 base_url = '/' + base_url.strip('/')
             else:
                 base_url = ''
             return redirect(base_url + url_for('common.setup'))
        
        try:
            from src.primary.utils.database import get_database
            db = get_database()
            if db.is_setup_in_progress():
                logger.info("Setup is in progress, redirecting to setup.")
                from src.primary import settings_manager
                base_url = settings_manager.get_setting('general', 'base_url', '').strip()
                if base_url and base_url != '/':
                    base_url = '/' + base_url.strip('/')
                else:
                    base_url = ''
                return redirect(base_url + url_for('common.setup'))
        except Exception as e:
            logger.error(f"Error checking setup progress in login route: {e}")
        
        # Check if any users have Plex authentication configured
        try:
            from src.primary.utils.database import get_database
            db = get_database()
            plex_auth_enabled = db.has_users_with_plex()
        except Exception as e:
            logger.error(f"Error checking for Plex users: {e}")
            plex_auth_enabled = False
        
        logger.debug("Displaying login page.")
        return render_template('login.html', plex_auth_enabled=plex_auth_enabled)

@common_bp.route('/logout', methods=['POST'])
def logout_route():
    try:
        session_token = request.cookies.get(SESSION_COOKIE_NAME)
        if session_token:
            logger.info(f"Logging out session token: {session_token[:8]}...") # Log part of token
            logout(session_token) # Call the logout function from auth.py
        else:
            logger.warning("Logout attempt without session cookie.")

        response = jsonify({"success": True})
        # Ensure cookie deletion happens even if logout function had issues
        response.delete_cookie(SESSION_COOKIE_NAME, path='/', samesite='Lax') # Specify path and samesite
        logger.info("Logout successful, cookie deleted.")
        return response
    except Exception as e:
        logger.error(f"Error during logout: {e}", exc_info=True)
        # Return a JSON error response
        return jsonify({"success": False, "error": "An internal server error occurred during logout."}), 500

@common_bp.route('/setup', methods=['GET', 'POST'])
def setup():
    # Allow setup page access even if user exists - setup might be in progress
    # The authentication middleware will handle proper authentication checks
    # This handles cases like returning from Plex authentication during setup
    
    if request.method == 'GET':
        # For GET requests, check if we should restore setup progress
        try:
            from src.primary.utils.database import get_database
            db = get_database()
            
            # Get setup progress for restoration
            setup_progress = db.get_setup_progress()
            logger.debug(f"Setup page accessed, current progress: {setup_progress}")
            
            # If user exists but setup is in progress, allow continuation
            if user_exists() and not db.is_setup_in_progress():
                logger.info("User exists and setup is complete, redirecting to login")
                from src.primary import settings_manager
                base_url = settings_manager.get_setting('general', 'base_url', '').strip()
                if base_url and base_url != '/':
                    base_url = '/' + base_url.strip('/')
                else:
                    base_url = ''
                return redirect(base_url + url_for('common.login_route'))
            
            # Render setup page with progress data
            return render_template('setup.html', setup_progress=setup_progress)
            
        except Exception as e:
            logger.error(f"Error checking setup progress: {e}")
            # Fallback to normal setup flow
            return render_template('setup.html', setup_progress=None)
    
    elif request.method == 'POST':
        # For POST requests, check if user exists to prevent duplicate creation
        if user_exists():
            logger.warning("Attempted to create user during setup but user already exists")
            return jsonify({"success": False, "error": "User already exists"}), 400
            
        username = None # Initialize username for logging in case of early failure
        try: # Add try block to catch potential errors during user creation
            data = request.json
            username = data.get('username')
            password = data.get('password')
            confirm_password = data.get('confirm_password')
            proxy_auth_bypass = data.get('proxy_auth_bypass', False)  # Get proxy auth bypass setting

            # Basic validation
            if not username or not password or not confirm_password:
                return jsonify({"success": False, "error": "Missing required fields"}), 400
            
            # Add username length validation
            if len(username.strip()) < 3:
                return jsonify({"success": False, "error": "Username must be at least 3 characters long"}), 400

            if password != confirm_password:
                return jsonify({"success": False, "error": "Passwords do not match"}), 400

            # Validate password strength using the backend function
            password_error = validate_password_strength(password)
            if password_error:
                return jsonify({"success": False, "error": password_error}), 400

            logger.info(f"Attempting to create user '{username}' during setup.")
            if create_user(username, password): # This function should now be defined via import
                
                # If proxy auth bypass is enabled, update general settings
                if proxy_auth_bypass:
                    try:
                        from src.primary import settings_manager
                        
                        # Load current general settings
                        general_settings = settings_manager.load_settings('general')
                        
                        # Update the proxy_auth_bypass setting
                        general_settings['proxy_auth_bypass'] = True
                        
                        # Save the updated settings
                        settings_manager.save_settings('general', general_settings)
                        logger.debug("Proxy auth bypass setting enabled during setup")
                    except Exception as e:
                        logger.error(f"Error saving proxy auth bypass setting: {e}", exc_info=True)
                
                # Save setup progress after account creation
                try:
                    from src.primary.utils.database import get_database
                    db = get_database()
                    progress_data = {
                        'current_step': 2,  # Move to 2FA step
                        'completed_steps': [1],
                        'account_created': True,
                        'two_factor_enabled': False,
                        'plex_setup_done': False,
                        'auth_mode_selected': False,
                        'recovery_key_generated': False,
                        'username': username,
                        'timestamp': datetime.now().isoformat()
                    }
                    db.save_setup_progress(progress_data)
                    logger.debug("Setup progress saved after account creation")
                except Exception as e:
                    logger.error(f"Error saving setup progress: {e}")
                
                # Automatically log in the user after setup
                logger.debug(f"User '{username}' created successfully during setup. Creating session.")
                session_token = create_session(username)
                # Explicitly set username in Flask session - might not be needed if using token correctly
                # session['username'] = username
                session[SESSION_COOKIE_NAME] = session_token # Store token in session
                response = jsonify({"success": True})
                # Set cookie in the response
                response.set_cookie(SESSION_COOKIE_NAME, session_token, httponly=True, samesite='Lax', path='/') # Add path
                return response
            else:
                # create_user itself failed, but didn't raise an exception
                logger.error(f"create_user function returned False for user '{username}' during setup.")
                return jsonify({"success": False, "error": "Failed to create user (internal reason)"}), 500
        except Exception as e:
            # Catch any unexpected exception during the process
            logger.error(f"Unexpected error during setup POST for user '{username if username else 'unknown'}': {e}", exc_info=True)
            return jsonify({"success": False, "error": f"An unexpected server error occurred: {e}"}), 500
    else:
        # GET request - show setup page
        logger.info("Displaying setup page.")
        return render_template('setup.html') # This function should now be defined via import

# --- User Management API Routes --- #

def get_user_for_request():
    """Get username for the current request, handling bypass modes"""
    # First try to get username from session
    session_token = request.cookies.get(SESSION_COOKIE_NAME)
    username = get_username_from_session(session_token)
    
    if username:
        return username
    
    # If no session username, check if we're in bypass mode
    try:
        from src.primary.settings_manager import load_settings
        settings = load_settings("general")
        local_access_bypass = settings.get("local_access_bypass", False)
        proxy_auth_bypass = settings.get("proxy_auth_bypass", False)
        
        if proxy_auth_bypass or local_access_bypass:
            # In bypass mode, get the first user from database
            from src.primary.utils.database import get_database
            db = get_database()
            first_user = db.get_first_user()
            if first_user:
                return first_user.get('username')
    except Exception as e:
        logger.error(f"Error checking bypass mode for user request: {e}")
    
    return None

@common_bp.route('/api/user/info', methods=['GET'])
def get_user_info_route():
    # Get username handling bypass modes
    username = get_user_for_request()

    if not username:
        logger.debug("Attempt to get user info failed: Not authenticated and not in bypass mode.")
        return jsonify({"error": "Not authenticated"}), 401

    # Pass username to is_2fa_enabled
    two_fa_status = is_2fa_enabled(username) # This function should now be defined via import
    return jsonify({"username": username, "is_2fa_enabled": two_fa_status})

@common_bp.route('/api/user/change-username', methods=['POST'])
def change_username_route():
    # Get username handling bypass modes
    current_username = get_user_for_request()

    if not current_username:
        logger.warning("Username change attempt failed: Not authenticated and not in bypass mode.")
        return jsonify({"error": "Not authenticated"}), 401

    data = request.json
    new_username = data.get('username')
    password = data.get('password') # Get password from request

    if not new_username or not password: # Check if password is provided
        return jsonify({"success": False, "error": "New username and current password are required"}), 400

    # Add username length validation
    if len(new_username.strip()) < 3:
        return jsonify({"success": False, "error": "Username must be at least 3 characters long"}), 400

    # Call the change_username function from auth.py
    if auth_change_username(current_username, new_username, password):
        # Update the session to reflect the new username
        session_token = request.cookies.get(SESSION_COOKIE_NAME)
        if session_token:
            if update_session_username(session_token, new_username):
                logger.debug(f"Session updated with new username '{new_username}' for session {session_token}")
            else:
                logger.warning(f"Failed to update session with new username '{new_username}'")
        
        logger.info(f"Username changed successfully for '{current_username}' to '{new_username}'.")
        return jsonify({"success": True, "username": new_username})
    else:
        logger.warning(f"Username change failed for '{current_username}'. Check logs in auth.py for details.")
        return jsonify({"success": False, "error": "Failed to change username. Check password or logs."}), 400

@common_bp.route('/api/user/change-password', methods=['POST'])
def change_password_route():
    # Get username handling bypass modes
    username = get_user_for_request()

    if not username:
         logger.warning("Password change attempt failed: Not authenticated and not in bypass mode.")
         return jsonify({"error": "Not authenticated"}), 401

    data = request.json
    current_password = data.get('current_password')
    new_password = data.get('new_password')

    if not current_password or not new_password:
        logger.warning(f"Password change attempt for user '{username}' failed: Missing current or new password.")
        return jsonify({"success": False, "error": "Current and new passwords are required"}), 400

    logger.info(f"Attempting to change password for user '{username}'.")
    # Pass username? change_password might not need it. Assuming it doesn't for now.
    if auth_change_password(current_password, new_password):
        logger.info(f"Password changed successfully for user '{username}'.")
        return jsonify({"success": True})
    else:
        logger.warning(f"Password change failed for user '{username}'. Check logs in auth.py for details.")
        return jsonify({"success": False, "error": "Failed to change password. Check current password or logs."}), 400

# --- 2FA Management API Routes --- #

@common_bp.route('/api/user/2fa/setup', methods=['POST'])
def setup_2fa():
    # Get username handling bypass modes and setup context
    username = get_user_for_request()

    # If no username from session/bypass, check if we're in setup mode
    if not username:
        try:
            from src.primary.utils.database import get_database
            db = get_database()
            setup_progress = db.get_setup_progress()
            if setup_progress and setup_progress.get('username'):
                username = setup_progress.get('username')
                logger.debug(f"Using username from setup progress: {username}")
            else:
                # If no setup progress, try to get the first user (single user system)
                first_user = db.get_first_user()
                if first_user:
                    username = first_user.get('username')
                    logger.debug(f"Using first user for 2FA setup: {username}")
        except Exception as e:
            logger.error(f"Error getting username for 2FA setup: {e}")

    if not username:
        logger.warning("2FA setup attempt failed: Not authenticated and not in bypass mode.")
        return jsonify({"error": "Not authenticated"}), 401

    try:
        logger.info(f"Generating 2FA setup for user: {username}") # Add logging
        # Pass username to generate_2fa_secret
        secret, qr_code_data_uri = generate_2fa_secret(username) # This function should now be defined via import

        # Return secret and QR code data URI
        return jsonify({"success": True, "secret": secret, "qr_code_url": qr_code_data_uri}) # Match frontend expectation 'qr_code_url'

    except Exception as e:
        logger.error(f"Error during 2FA setup generation for user '{username}': {e}", exc_info=True)
        return jsonify({"success": False, "error": "Failed to generate 2FA setup information."}), 500

@common_bp.route('/api/user/2fa/verify', methods=['POST'])
def verify_2fa():
    # Get username handling bypass modes and setup context
    username = get_user_for_request()

    # If no username from session/bypass, check if we're in setup mode
    if not username:
        try:
            from src.primary.utils.database import get_database
            db = get_database()
            setup_progress = db.get_setup_progress()
            if setup_progress and setup_progress.get('username'):
                username = setup_progress.get('username')
                logger.debug(f"Using username from setup progress: {username}")
            else:
                # If no setup progress, try to get the first user (single user system)
                first_user = db.get_first_user()
                if first_user:
                    username = first_user.get('username')
                    logger.debug(f"Using first user for 2FA verify: {username}")
        except Exception as e:
            logger.error(f"Error getting username for 2FA verify: {e}")

    if not username:
        logger.warning("2FA verify attempt failed: Not authenticated and not in bypass mode.")
        return jsonify({"error": "Not authenticated"}), 401

    data = request.json
    otp_code = data.get('code') # Match frontend key 'code'

    if not otp_code or len(otp_code) != 6 or not otp_code.isdigit(): # Add validation
        logger.warning(f"2FA verification for '{username}' failed: Invalid code format provided.")
        return jsonify({"success": False, "error": "Invalid or missing 6-digit OTP code"}), 400

    logger.info(f"Attempting to verify 2FA code for user '{username}'.")
    # Pass username to verify_2fa_code
    if verify_2fa_code(username, otp_code, enable_on_verify=True): # This function should now be defined via import
        logger.info(f"Successfully verified and enabled 2FA for user: {username}") # Add logging
        return jsonify({"success": True})
    else:
        # Reason logged in verify_2fa_code
        logger.warning(f"2FA verification failed for user: {username}. Check logs in auth.py.")
        return jsonify({"success": False, "error": "Invalid OTP code"}), 400 # Use 400 for bad request

@common_bp.route('/api/user/2fa/disable', methods=['POST'])
def disable_2fa_route():
    # Get username handling bypass modes
    username = get_user_for_request()

    if not username:
        logger.warning("2FA disable attempt failed: Not authenticated and not in bypass mode.")
        return jsonify({"error": "Not authenticated"}), 401

    data = request.json
    password = data.get('password')
    otp_code = data.get('code')

    # Require BOTH password and OTP code
    if not password or not otp_code:
         logger.warning(f"2FA disable attempt for '{username}' failed: Missing password or OTP code.")
         return jsonify({"success": False, "error": "Both password and current OTP code are required to disable 2FA"}), 400

    if not (len(otp_code) == 6 and otp_code.isdigit()):
        logger.warning(f"2FA disable attempt for '{username}' failed: Invalid OTP code format.")
        return jsonify({"success": False, "error": "Invalid 6-digit OTP code format"}), 400

    # Call a function that verifies both password and OTP
    if disable_2fa_with_password_and_otp(username, password, otp_code):
        logger.info(f"2FA disabled successfully for user '{username}' using password and OTP.")
        return jsonify({"success": True})
    else:
        # Reason logged in disable_2fa_with_password_and_otp
        logger.warning(f"Failed to disable 2FA for user '{username}' using password and OTP. Check logs.")
        # The auth function should log the specific reason (bad pass, bad otp)
        return jsonify({"success": False, "error": "Failed to disable 2FA. Invalid password or OTP code."}), 400

# --- Recovery Key Management API Routes --- #

@common_bp.route('/auth/recovery-key/generate', methods=['POST'])
def generate_recovery_key():
    """Generate a new recovery key for the authenticated user"""
    # Get username handling bypass modes and setup mode
    username = get_user_for_request()
    
    # If not authenticated, check if we're in setup mode and get username from setup progress
    if not username:
        try:
            data = request.json or {}
            setup_mode = data.get('setup_mode', False)
            if setup_mode:
                from ..utils.database import get_database
                db = get_database()
                setup_progress = db.get_setup_progress()
                if setup_progress and setup_progress.get('username'):
                    username = setup_progress['username']
                    logger.debug(f"Using username from setup progress: {username}")
                else:
                    logger.warning("Recovery key generation in setup mode failed: No username in setup progress.")
                    return jsonify({"error": "Setup not properly initialized"}), 400
            else:
                logger.warning("Recovery key generation attempt failed: Not authenticated and not in bypass mode.")
                return jsonify({"error": "Not authenticated"}), 401
        except Exception as e:
            logger.error(f"Error checking setup mode for recovery key generation: {e}")
            return jsonify({"error": "Authentication check failed"}), 500

    if not username:
        logger.warning("Recovery key generation attempt failed: Could not determine username.")
        return jsonify({"error": "Not authenticated"}), 401

    try:
        data = request.json or {}
        current_password = data.get('password')
        two_factor_code = data.get('two_factor_code')
        setup_mode = data.get('setup_mode', False)  # Check if this is during setup

        # During setup mode, skip password verification
        if not setup_mode:
            # Require current password for security (normal operation)
            if not current_password:
                logger.warning(f"Recovery key generation for '{username}' failed: No password provided.")
                return jsonify({"success": False, "error": "Current password is required"}), 400

            # Verify current password
            if not verify_user(username, current_password):
                logger.warning(f"Recovery key generation for '{username}' failed: Invalid password.")
                return jsonify({"success": False, "error": "Invalid current password"}), 400

            # Check if 2FA is enabled and verify if needed
            if is_2fa_enabled(username):
                if not two_factor_code:
                    logger.warning(f"Recovery key generation for '{username}' failed: 2FA code required.")
                    return jsonify({"success": False, "error": "Two-factor authentication code is required"}), 400
                
                if not verify_2fa_code(username, two_factor_code):
                    logger.warning(f"Recovery key generation for '{username}' failed: Invalid 2FA code.")
                    return jsonify({"success": False, "error": "Invalid two-factor authentication code"}), 400

        # Generate the recovery key
        from ..utils.database import get_database
        db = get_database()
        recovery_key = db.generate_recovery_key(username)

        if recovery_key:
            logger.info(f"Recovery key generated successfully for user: {username} (setup_mode: {setup_mode})")
            return jsonify({
                "success": True, 
                "recovery_key": recovery_key,
                "message": "Recovery key generated successfully. Please save this key securely - it will not be shown again."
            })
        else:
            logger.error(f"Failed to generate recovery key for user: {username}")
            return jsonify({"success": False, "error": "Failed to generate recovery key"}), 500

    except Exception as e:
        logger.error(f"Error generating recovery key for user '{username}': {e}", exc_info=True)
        return jsonify({"success": False, "error": "An internal error occurred"}), 500

@common_bp.route('/auth/recovery-key/verify', methods=['POST'])
def verify_recovery_key():
    """Verify a recovery key (no authentication required)"""
    try:
        # Get client IP address for rate limiting
        client_ip = request.environ.get('HTTP_X_FORWARDED_FOR', request.environ.get('REMOTE_ADDR', 'unknown'))
        if ',' in client_ip:
            client_ip = client_ip.split(',')[0].strip()
            
        data = request.json or {}
        recovery_key = data.get('recovery_key', '').strip()

        if not recovery_key:
            return jsonify({"success": False, "error": "Recovery key is required"}), 400

        # Check rate limiting before processing
        from ..utils.database import get_database
        db = get_database()
        rate_limit_check = db.check_recovery_key_rate_limit(client_ip)
        
        if rate_limit_check["locked"]:
            from datetime import datetime
            try:
                locked_until = datetime.fromisoformat(rate_limit_check["locked_until"])
                minutes_remaining = int((locked_until - datetime.now()).total_seconds() / 60)
                if minutes_remaining > 0:
                    logger.warning(f"Recovery key verification blocked for IP {client_ip} - locked for {minutes_remaining} more minutes")
                    return jsonify({
                        "success": False, 
                        "error": f"Too many failed attempts. Please try again in {minutes_remaining} minutes."
                    }), 429
            except (ValueError, TypeError):
                # If there's an issue with the timestamp, clear the lock
                db.record_recovery_key_attempt(client_ip, success=True)

        # Verify the recovery key
        username = db.verify_recovery_key(recovery_key)

        if username:
            # Record successful attempt to clear rate limiting
            db.record_recovery_key_attempt(client_ip, username=username, success=True)
            logger.info(f"Recovery key verified successfully for user: {username} from IP {client_ip}")
            return jsonify({"success": True, "username": username})
        else:
            # Record failed attempt
            db.record_recovery_key_attempt(client_ip, success=False)
            failed_attempts = rate_limit_check["failed_attempts"] + 1
            
            if failed_attempts >= 3:
                logger.warning(f"Recovery key rate limit triggered for IP {client_ip} after {failed_attempts} failed verification attempts")
                return jsonify({
                    "success": False, 
                    "error": "Too many failed attempts. Recovery key access has been temporarily disabled for 15 minutes."
                }), 429
            else:
                logger.warning(f"Invalid recovery key verification attempt from IP {client_ip} ({failed_attempts}/3 attempts)")
                return jsonify({
                    "success": False, 
                    "error": f"Invalid recovery key. {3 - failed_attempts} attempts remaining."
                }), 400

    except Exception as e:
        logger.error(f"Error verifying recovery key: {e}", exc_info=True)
        return jsonify({"success": False, "error": "An internal error occurred"}), 500

@common_bp.route('/auth/recovery-key/reset', methods=['POST'])
def reset_password_with_recovery_key():
    """Reset password using recovery key (no authentication required)"""
    try:
        # Get client IP address for rate limiting
        client_ip = request.environ.get('HTTP_X_FORWARDED_FOR', request.environ.get('REMOTE_ADDR', 'unknown'))
        if ',' in client_ip:
            client_ip = client_ip.split(',')[0].strip()
        
        data = request.json or {}
        recovery_key = data.get('recovery_key', '').strip()
        new_password = data.get('new_password', '').strip()

        if not recovery_key or not new_password:
            return jsonify({"success": False, "error": "Recovery key and new password are required"}), 400

        # Validate password strength - only require 8 characters minimum
        if len(new_password) < 8:
            return jsonify({"success": False, "error": "Password must be at least 8 characters long."}), 400

        # Check rate limiting before processing
        from ..utils.database import get_database
        db = get_database()
        rate_limit_check = db.check_recovery_key_rate_limit(client_ip)
        
        if rate_limit_check["locked"]:
            from datetime import datetime
            try:
                locked_until = datetime.fromisoformat(rate_limit_check["locked_until"])
                minutes_remaining = int((locked_until - datetime.now()).total_seconds() / 60)
                if minutes_remaining > 0:
                    logger.warning(f"Recovery key attempt blocked for IP {client_ip} - locked for {minutes_remaining} more minutes")
                    return jsonify({
                        "success": False, 
                        "error": f"Too many failed attempts. Please try again in {minutes_remaining} minutes."
                    }), 429
            except (ValueError, TypeError):
                # If there's an issue with the timestamp, clear the lock
                db.record_recovery_key_attempt(client_ip, success=True)

        # Verify the recovery key
        username = db.verify_recovery_key(recovery_key)

        if not username:
            # Record failed attempt
            db.record_recovery_key_attempt(client_ip, success=False)
            failed_attempts = rate_limit_check["failed_attempts"] + 1
            
            if failed_attempts >= 3:
                logger.warning(f"Recovery key rate limit triggered for IP {client_ip} after {failed_attempts} failed attempts")
                return jsonify({
                    "success": False, 
                    "error": "Too many failed attempts. Recovery key access has been temporarily disabled for 15 minutes."
                }), 429
            else:
                logger.warning(f"Invalid recovery key attempt from IP {client_ip} ({failed_attempts}/3 attempts)")
                return jsonify({
                    "success": False, 
                    "error": f"Invalid recovery key. {3 - failed_attempts} attempts remaining."
                }), 400

        # Reset the password using database method directly
        if db.update_user_password(username, new_password):
            # Record successful attempt to clear rate limiting
            db.record_recovery_key_attempt(client_ip, username=username, success=True)
            
            # Disable 2FA since user needed recovery key (likely lost 2FA device)
            two_fa_disabled = db.update_user_2fa(username, two_fa_enabled=False, two_fa_secret=None)
            if two_fa_disabled:
                logger.info(f"Disabled 2FA for user '{username}' after password reset via recovery key from IP {client_ip}")
            else:
                logger.warning(f"Failed to disable 2FA for user '{username}' after password reset")
            
            # Keep recovery key valid - user may need it again and should manually generate new one
            logger.info(f"Password reset successfully using recovery key for user: {username} from IP {client_ip}")
            
            # Update message to inform user that 2FA has been disabled and recovery key is still valid
            message = "Password reset successfully. Two-factor authentication has been disabled for security - you can re-enable it in your account settings. Your recovery key remains valid until you generate a new one."
            return jsonify({"success": True, "message": message})
        else:
            logger.error(f"Failed to reset password for user: {username}")
            return jsonify({"success": False, "error": "Failed to reset password"}), 500

    except Exception as e:
        logger.error(f"Error resetting password with recovery key: {e}", exc_info=True)
        return jsonify({"success": False, "error": "An internal error occurred"}), 500

# --- Theme Setting Route ---
@common_bp.route('/api/settings/theme', methods=['POST'])
def set_theme():
    # Get username handling bypass modes
    username = get_user_for_request()
    
    if not username:
         logger.warning("Theme setting attempt failed: Not authenticated and not in bypass mode.")
         return jsonify({"error": "Unauthorized"}), 401

    try:
        data = request.json
        dark_mode = data.get('dark_mode')

        if dark_mode is None or not isinstance(dark_mode, bool):
            logger.warning("Invalid theme setting received.")
            return jsonify({"success": False, "error": "Invalid 'dark_mode' value"}), 400

        # Here you would typically save this preference to a user profile or global setting
        # For now, just log it. A real implementation would persist this.


        # Example: Saving to a hypothetical global config (replace with actual persistence)
        # global_settings = settings_manager.load_global_settings() # Assuming such a function exists
        # global_settings['ui']['dark_mode'] = dark_mode
        # settings_manager.save_global_settings(global_settings) # Assuming such a function exists

        return jsonify({"success": True})
    except Exception as e:
        logger.error(f"Error setting theme preference: {e}", exc_info=True)
        return jsonify({"success": False, "error": "Failed to set theme preference"}), 500



# --- Local Access Bypass Status API Route --- #

@common_bp.route('/api/get_local_access_bypass_status', methods=['GET'])
def get_local_access_bypass_status_route():
    """API endpoint to get the status of the local network authentication bypass setting.
    Also checks proxy_auth_bypass to hide user menu in both bypass modes."""
    try:
        # Get both bypass settings from the 'general' section, default to False if not found
        local_access_bypass = settings_manager.get_setting('general', 'local_access_bypass', False)
        proxy_auth_bypass = settings_manager.get_setting('general', 'proxy_auth_bypass', False)
        
        # Enable if either bypass mode is active
        bypass_enabled = local_access_bypass or proxy_auth_bypass
        
        # Bypass status retrieved - debug spam removed
        # Return status in the format expected by the frontend
        return jsonify({"isEnabled": bypass_enabled})
    except Exception as e:
        logger.error(f"Error retrieving local_access_bypass status: {e}", exc_info=True)
        # Return a generic error to the client
        return jsonify({"error": "Failed to retrieve bypass status"}), 500

# --- Stats Management API Routes --- #
@common_bp.route('/api/stats', methods=['GET'])
def get_stats_api():
    """API endpoint to get media statistics"""
    try:
        # Import here to avoid circular imports
        from ..stats_manager import get_stats
        
        # Get stats from stats_manager
        stats = get_stats()
        # Stats retrieved - debug spam removed
        
        # Return success response with stats
        return jsonify({"success": True, "stats": stats})
    except Exception as e:
        logger.error(f"Error retrieving stats: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500

@common_bp.route('/api/stats/reset', methods=['POST'])
def reset_stats_api():
    """API endpoint to reset media statistics"""
    try:
        # Import here to avoid circular imports
        from ..stats_manager import reset_stats
        
        # Check if authenticated
        session_token = request.cookies.get(SESSION_COOKIE_NAME)
        if not verify_session(session_token):
            logger.warning("Stats reset attempt failed: Not authenticated.")
            return jsonify({"error": "Unauthorized"}), 401
            
        # Get app type from request if provided
        data = request.json or {}
        app_type = data.get('app_type')  # None will reset all
        
        if app_type is not None and app_type not in ["sonarr", "radarr", "lidarr", "readarr", "whisparr"]:
            logger.warning(f"Invalid app_type for stats reset: {app_type}")
            return jsonify({"success": False, "error": "Invalid app_type"}), 400
            
        # Reset stats
        if reset_stats(app_type):
            message = f"Reset statistics for {app_type}" if app_type else "Reset all statistics"
            logger.info(message)
            return jsonify({"success": True, "message": message})
        else:
            error_msg = f"Failed to reset statistics for {app_type}" if app_type else "Failed to reset all statistics"
            logger.error(error_msg)
            return jsonify({"success": False, "error": error_msg}), 500
    except Exception as e:
        logger.error(f"Error resetting stats: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500

# Ensure all routes previously in this file that interact with settings
# are either moved to web_server.py or updated here using the new settings_manager functions.

@common_bp.route('/api/database/integrity', methods=['GET', 'POST'])
def database_integrity():
    """Check database integrity and optionally repair issues"""
    # Get username handling bypass modes
    username = get_user_for_request()
    if not username:
        return jsonify({"success": False, "error": "Authentication required"}), 401
    
    try:
        from primary.utils.database import get_database
        
        repair = request.json.get('repair', False) if request.method == 'POST' else False
        
        db = get_database()
        results = db.perform_integrity_check(repair=repair)
        
        return jsonify({
            'success': True,
            'integrity_check': results,
            'timestamp': datetime.now().isoformat()
        })
        
    except Exception as e:
        logger.error(f"Database integrity check failed: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@common_bp.route('/api/database/backup', methods=['POST'])
def create_database_backup():
    """Create a verified backup of the database"""
    # Get username handling bypass modes
    username = get_user_for_request()
    if not username:
        return jsonify({"success": False, "error": "Authentication required"}), 401
    
    try:
        from primary.utils.database import get_database
        
        backup_name = request.json.get('backup_name') if request.json else None
        
        db = get_database()
        backup_path = db.create_backup(backup_name)
        
        # Get backup file size for confirmation
        from pathlib import Path
        backup_size = Path(backup_path).stat().st_size
        
        return jsonify({
            'success': True,
            'backup_path': backup_path,
            'backup_size': backup_size,
            'timestamp': datetime.now().isoformat()
        })
        
    except Exception as e:
        logger.error(f"Database backup creation failed: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@common_bp.route('/api/database/maintenance', methods=['POST'])
def trigger_database_maintenance():
    """Trigger immediate database maintenance operations"""
    # Get username handling bypass modes
    username = get_user_for_request()
    if not username:
        return jsonify({"success": False, "error": "Authentication required"}), 401
    
    try:
        from primary.utils.database import get_database
        
        db = get_database()
        
        # Perform maintenance operations
        maintenance_results = {
            'integrity_check': db.perform_integrity_check(repair=True),
            'optimization': {'status': 'completed'},
            'checkpoint': {'status': 'completed'}
        }
        
        # Run optimization and checkpoint
        with db.get_connection() as conn:
            conn.execute("PRAGMA optimize")
            conn.execute("PRAGMA wal_checkpoint(PASSIVE)")
        
        return jsonify({
            'success': True,
            'maintenance_results': maintenance_results,
            'timestamp': datetime.now().isoformat()
        })
        
    except Exception as e:
        logger.error(f"Database maintenance failed: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@common_bp.route('/api/database/status', methods=['GET'])
def database_status():
    """Get comprehensive database status information"""
    # Get username handling bypass modes
    username = get_user_for_request()
    if not username:
        return jsonify({"success": False, "error": "Authentication required"}), 401
    
    try:
        from primary.utils.database import get_database
        import os
        
        db = get_database()
        
        # Get database file info
        db_size = os.path.getsize(db.db_path) if db.db_path.exists() else 0
        
        # Get database stats
        with db.get_connection() as conn:
            page_count = conn.execute("PRAGMA page_count").fetchone()[0]
            page_size = conn.execute("PRAGMA page_size").fetchone()[0]
            freelist_count = conn.execute("PRAGMA freelist_count").fetchone()[0]
            journal_mode = conn.execute("PRAGMA journal_mode").fetchone()[0]
            cache_size = conn.execute("PRAGMA cache_size").fetchone()[0]
            
        status_info = {
            'database_path': str(db.db_path),
            'database_size': db_size,
            'database_size_mb': round(db_size / (1024 * 1024), 2),
            'page_count': page_count,
            'page_size': page_size,
            'freelist_count': freelist_count,
            'journal_mode': journal_mode,
            'cache_size': cache_size,
            'utilization': round((page_count - freelist_count) / page_count * 100, 2) if page_count > 0 else 0
        }
        
        return jsonify({
            'success': True,
            'database_status': status_info,
            'timestamp': datetime.now().isoformat()
        })
        
    except Exception as e:
        logger.error(f"Failed to get database status: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@common_bp.route('/api/setup/progress', methods=['GET', 'POST'])
def setup_progress():
    """Get or save setup progress"""
    try:
        from src.primary.utils.database import get_database
        db = get_database()
        
        if request.method == 'GET':
            # Get current setup progress
            progress = db.get_setup_progress()
            return jsonify({
                'success': True,
                'progress': progress
            })
        
        elif request.method == 'POST':
            # Save setup progress
            data = request.json
            progress_data = data.get('progress', {})
            
            # Add timestamp
            progress_data['timestamp'] = datetime.now().isoformat()
            
            # Save to database
            success = db.save_setup_progress(progress_data)
            
            return jsonify({
                'success': success,
                'message': 'Setup progress saved' if success else 'Failed to save setup progress'
            })
    
    except Exception as e:
        logger.error(f"Setup progress API error: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@common_bp.route('/api/setup/clear', methods=['POST'])
def clear_setup_progress():
    """Clear setup progress (called when setup is complete)"""
    try:
        from src.primary.utils.database import get_database
        db = get_database()
        
        success = db.clear_setup_progress()
        
        return jsonify({
            'success': success,
            'message': 'Setup progress cleared' if success else 'Failed to clear setup progress'
        })
    
    except Exception as e:
        logger.error(f"Clear setup progress API error: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@common_bp.route('/api/setup/status', methods=['GET'])
def setup_status():
    try:
        from src.primary.utils.database import get_database
        db = get_database()
        
        # Check if user exists and setup progress
        user_exists_flag = user_exists()
        setup_in_progress = db.is_setup_in_progress() if user_exists_flag else False
        
        return jsonify({
            "success": True,
            "user_exists": user_exists_flag,
            "setup_in_progress": setup_in_progress
        })
    except Exception as e:
        logger.error(f"Error checking setup status: {e}")
        return jsonify({"success": False, "error": "Failed to check setup status"}), 500




