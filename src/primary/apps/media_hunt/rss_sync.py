"""
Media Hunt RSS Sync — fetch latest releases from Newznab indexers (RSS mode).

RSS mode uses Newznab API with no query parameter:
  Movie: GET ?t=movie&cat={categories}&extended=1&apikey={key}&limit=100
  TV:    GET ?t=tvsearch&cat={categories}&extended=1&apikey={key}&limit=100

Falls back to t=search with only cat param if t=movie/t=tvsearch fails.
"""

import logging
import time as _time
import requests
import xml.etree.ElementTree as ET

from src.primary.utils.logger import get_logger


NEWZNAB_NS = 'http://www.newznab.com/DTD/2010/feeds/attributes/'

_ATTR_NAMES_TMDB = ('tmdbid', 'tmdb')
_ATTR_NAMES_IMDB = ('imdbid', 'imdb')
_ATTR_NAMES_TVDB = ('tvdbid', 'tvdb')
_ATTR_NAMES_SEASON = ('season',)
_ATTR_NAMES_EPISODE = ('episode',)
_ATTR_NAMES_SIZE = ('size',)


def _safe_int(val, default=0):
    if val is None:
        return default
    try:
        return int(val)
    except (TypeError, ValueError):
        return default


def _parse_newznab_attrs(item):
    """Extract newznab:attr values from an XML item element."""
    attrs = {}
    for child in item:
        tag = child.tag
        if '}' in str(tag):
            tag = tag.split('}', 1)[1]
        if tag.lower() != 'attr':
            continue
        name = (child.get('name') or '').strip().lower()
        value = (child.get('value') or '').strip()
        if name and value:
            attrs[name] = value
    return attrs


def _get_attr_int(attrs, names, default=0):
    for name in names:
        val = attrs.get(name)
        if val is not None:
            return _safe_int(val, default)
    return default


def _parse_xml_rss_releases(xml_text, indexer_name=''):
    """Parse Newznab XML response into release dicts."""
    releases = []
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return releases

    err = root.find('.//{%s}error' % NEWZNAB_NS)
    if err is None:
        err = root.find('.//error')
    if err is not None:
        return releases

    items = root.findall('.//{%s}item' % NEWZNAB_NS)
    if not items:
        items = root.findall('.//item')

    for item in items:
        title_el = item.find('title')
        title = (title_el.text or '').strip() if title_el is not None else ''
        if not title:
            continue

        link_el = item.find('link')
        nzb_url = (link_el.text or '').strip() if link_el is not None else ''

        enc = item.find('enclosure')
        if not nzb_url and enc is not None:
            nzb_url = (enc.get('url') or '').strip()

        guid_el = item.find('guid')
        guid = (guid_el.text or '').strip() if guid_el is not None else ''

        pub_el = item.find('pubDate')
        pub_date = (pub_el.text or '').strip() if pub_el is not None else ''

        nz_attrs = _parse_newznab_attrs(item)

        size_bytes = _get_attr_int(nz_attrs, _ATTR_NAMES_SIZE)
        if not size_bytes and enc is not None:
            size_bytes = _safe_int(enc.get('length'))

        release = {
            'title': title,
            'nzb_url': nzb_url,
            'guid': guid or nzb_url or title,
            'size_bytes': size_bytes,
            'pub_date': pub_date,
            'tmdb_id': _get_attr_int(nz_attrs, _ATTR_NAMES_TMDB),
            'imdb_id': nz_attrs.get('imdbid', ''),
            'tvdb_id': _get_attr_int(nz_attrs, _ATTR_NAMES_TVDB),
            'season': _get_attr_int(nz_attrs, _ATTR_NAMES_SEASON),
            'episode': _get_attr_int(nz_attrs, _ATTR_NAMES_EPISODE),
            'indexer_name': indexer_name,
        }
        releases.append(release)

    return releases


def fetch_rss_releases(indexer, hunt_type, logger_inst=None):
    """
    Fetch latest releases from one indexer in RSS mode (no query).

    Args:
        indexer: dict with url, api_path, api_key, categories, name, enable_rss, enabled
        hunt_type: 'movie_hunt' or 'tv_hunt'
        logger_inst: optional logger

    Returns:
        list of release dicts
    """
    log = logger_inst or get_logger(hunt_type)

    if not indexer.get('enabled', True):
        return []
    if not indexer.get('enable_rss', True):
        return []

    api_key = (indexer.get('api_key') or '').strip()
    if not api_key:
        return []

    url = (indexer.get('url') or '').strip().rstrip('/')
    api_path = (indexer.get('api_path') or '/api').strip()
    base_url = url + api_path if url else ''
    if not base_url:
        api_url = (indexer.get('api_url') or '').strip().rstrip('/')
        if api_url:
            base_url = api_url
    if not base_url:
        return []

    cats = indexer.get('categories')
    if isinstance(cats, (list, tuple)):
        cat_str = ','.join(str(c) for c in cats)
    else:
        if hunt_type == 'tv_hunt':
            cat_str = '5000,5010,5020,5030,5040,5045,5050,5060,5070'
        else:
            cat_str = '2000,2010,2020,2030,2040,2045,2050,2060'

    indexer_name = indexer.get('name') or indexer.get('display_name') or 'Unknown'

    try:
        from src.primary.settings_manager import get_ssl_verify_setting
        verify_ssl = get_ssl_verify_setting()
    except Exception:
        verify_ssl = True

    # Primary RSS mode: t=movie for movies, t=tvsearch for TV
    if hunt_type == 'tv_hunt':
        t_param = 'tvsearch'
    else:
        t_param = 'movie'

    rss_url = (
        f'{base_url}?t={t_param}&cat={cat_str}'
        f'&extended=1&apikey={requests.utils.quote(api_key)}&limit=100'
    )

    ih_id = indexer.get('indexer_hunt_id', '')
    releases = []
    _rss_start = _time.time()
    _rss_success = False
    try:
        log.debug("[RSS Sync] Fetching RSS from %s using t=%s", indexer_name, t_param)
        r = requests.get(rss_url, timeout=30, verify=verify_ssl)
        if r.status_code == 200 and r.text.strip():
            releases = _parse_xml_rss_releases(r.text, indexer_name)
            if releases:
                log.info("[RSS Sync] Fetched %d releases from %s (t=%s)", len(releases), indexer_name, t_param)
                _rss_success = True
        else:
            log.warning("[RSS Sync] HTTP %d from %s (t=%s)", r.status_code, indexer_name, t_param)
    except requests.RequestException as e:
        log.warning("[RSS Sync] Request error for %s (t=%s): %s", indexer_name, t_param, e)

    # Fallback: t=search with only categories (generic RSS)
    if not releases:
        fallback_url = (
            f'{base_url}?t=search&cat={cat_str}'
            f'&extended=1&apikey={requests.utils.quote(api_key)}&limit=100'
        )
        try:
            log.debug("[RSS Sync] Trying fallback t=search for %s", indexer_name)
            r = requests.get(fallback_url, timeout=30, verify=verify_ssl)
            if r.status_code == 200 and r.text.strip():
                releases = _parse_xml_rss_releases(r.text, indexer_name)
                if releases:
                    log.info("[RSS Sync] Fetched %d releases from %s (fallback t=search)", len(releases), indexer_name)
                    _rss_success = True
        except requests.RequestException as e:
            log.warning("[RSS Sync] Fallback request error for %s: %s", indexer_name, e)

    # Record RSS fetch as a search event for Indexer Hunt stats
    _rss_ms = int((_time.time() - _rss_start) * 1000)
    if ih_id:
        try:
            from src.primary.utils.database import get_database as _get_db
            _get_db().record_indexer_hunt_event(
                indexer_id=ih_id, indexer_name=indexer_name,
                event_type='search', query='[RSS Sync]',
                response_time_ms=_rss_ms,
                success=_rss_success,
            )
        except Exception:
            pass

    return releases


def fetch_all_rss(instance_id, hunt_type, logger_inst=None):
    """
    Fetch RSS from all RSS-enabled indexers for an instance.
    Deduplicates by guid and returns combined list sorted by indexer priority.

    Args:
        instance_id: int instance ID
        hunt_type: 'movie_hunt' or 'tv_hunt'
        logger_inst: optional logger

    Returns:
        list of release dicts
    """
    log = logger_inst or get_logger(hunt_type)

    if hunt_type == 'tv_hunt':
        from src.primary.routes.media_hunt.indexers import get_tv_indexers_config
        indexers = get_tv_indexers_config(instance_id)
    else:
        from src.primary.routes.media_hunt.indexers import _get_indexers_config
        indexers = _get_indexers_config(instance_id)

    if not indexers:
        return []

    rss_indexers = [
        idx for idx in indexers
        if idx.get('enabled', True) and idx.get('enable_rss', True)
    ]

    if not rss_indexers:
        log.info("[RSS Sync] No RSS-enabled indexers for %s instance %s", hunt_type, instance_id)
        return []

    rss_indexers.sort(key=lambda x: _safe_int(x.get('priority'), 50))

    all_releases = []
    seen_guids = set()

    for idx in rss_indexers:
        idx_name = idx.get('name') or idx.get('display_name') or 'Unknown'
        log.info("[RSS Sync] Fetching RSS from indexer: %s", idx_name)

        releases = fetch_rss_releases(idx, hunt_type, log)
        log.info("[RSS Sync] Found %d releases from %s", len(releases), idx_name)

        for rel in releases:
            guid = rel.get('guid', '')
            if guid and guid not in seen_guids:
                seen_guids.add(guid)
                rel['indexer_priority'] = _safe_int(idx.get('priority'), 50)
                all_releases.append(rel)

    return all_releases
