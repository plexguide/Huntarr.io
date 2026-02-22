"""
qBittorrent WebUI API client for Tor Hunt.

Handles authentication (cookie-based SID), torrent management,
transfer info, and category management via qBittorrent's Web API v2.
"""

import time
import requests
from typing import Optional, Dict, List, Any
from src.primary.utils.logger import get_logger

logger = get_logger("tor_hunt")


class QBittorrentClient:
    """Client for qBittorrent Web API v2."""

    def __init__(self, host: str, port: int = 8080, username: str = '',
                 password: str = '', use_ssl: bool = False):
        self._host = host.rstrip('/')
        self._port = port
        self._username = username
        self._password = password
        self._use_ssl = use_ssl
        self._session = requests.Session()
        self._sid: Optional[str] = None
        self._sid_ts: float = 0
        self._base_url = self._build_base_url()

    def _build_base_url(self) -> str:
        scheme = 'https' if self._use_ssl else 'http'
        host = self._host
        if not host.startswith('http'):
            return f"{scheme}://{host}:{self._port}"
        # If user provided full URL, strip trailing slash
        return f"{host}:{self._port}" if ':' not in host.split('://', 1)[-1] else host

    @property
    def api_url(self) -> str:
        return f"{self._base_url}/api/v2"

    def _get_verify_ssl(self) -> bool:
        try:
            from src.primary.settings_manager import get_ssl_verify_setting
            return get_ssl_verify_setting()
        except Exception:
            return True

    # ── Authentication ──

    def login(self) -> bool:
        """Authenticate with qBittorrent. Returns True on success."""
        try:
            url = f"{self.api_url}/auth/login"
            data = {'username': self._username, 'password': self._password}
            r = self._session.post(url, data=data, timeout=10,
                                   verify=self._get_verify_ssl())
            if r.status_code == 200 and r.text.strip().upper() == 'OK.':
                self._sid = self._session.cookies.get('SID')
                self._sid_ts = time.monotonic()
                logger.info("qBittorrent: logged in to %s", self._base_url)
                return True
            logger.warning("qBittorrent: login failed (status=%s, body=%s)",
                           r.status_code, r.text[:100])
            return False
        except Exception as e:
            logger.error("qBittorrent: login error: %s", e)
            return False

    def _ensure_auth(self) -> bool:
        """Re-login if SID is stale (>30 min) or missing."""
        if self._sid and (time.monotonic() - self._sid_ts) < 1800:
            return True
        return self.login()

    def _get(self, endpoint: str, params: dict = None) -> Optional[requests.Response]:
        if not self._ensure_auth():
            return None
        try:
            r = self._session.get(f"{self.api_url}{endpoint}", params=params,
                                  timeout=15, verify=self._get_verify_ssl())
            if r.status_code == 403:
                # SID expired, retry once
                if self.login():
                    r = self._session.get(f"{self.api_url}{endpoint}", params=params,
                                          timeout=15, verify=self._get_verify_ssl())
            return r
        except Exception as e:
            logger.error("qBittorrent GET %s error: %s", endpoint, e)
            return None

    def _post(self, endpoint: str, data: dict = None, files: dict = None) -> Optional[requests.Response]:
        if not self._ensure_auth():
            return None
        try:
            r = self._session.post(f"{self.api_url}{endpoint}", data=data,
                                   files=files, timeout=15,
                                   verify=self._get_verify_ssl())
            if r.status_code == 403:
                if self.login():
                    r = self._session.post(f"{self.api_url}{endpoint}", data=data,
                                           files=files, timeout=15,
                                           verify=self._get_verify_ssl())
            return r
        except Exception as e:
            logger.error("qBittorrent POST %s error: %s", endpoint, e)
            return None

    # ── Connection test ──

    def test_connection(self) -> Dict[str, Any]:
        """Test connection to qBittorrent. Returns dict with success + version info."""
        if not self.login():
            return {'success': False, 'error': 'Login failed. Check host, port, username, and password.'}
        try:
            r = self._get('/app/version')
            if r and r.status_code == 200:
                version = r.text.strip()
                api_r = self._get('/app/webapiVersion')
                api_ver = api_r.text.strip() if api_r and api_r.status_code == 200 else 'unknown'
                return {'success': True, 'version': version, 'api_version': api_ver}
            return {'success': False, 'error': 'Could not get version info'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    # ── Torrent listing ──

    def get_torrents(self, category: str = None, filter_str: str = None,
                     sort: str = None, hashes: str = None) -> List[Dict[str, Any]]:
        """Get list of torrents. Optional filters: category, filter (all/downloading/seeding/completed/paused/active/inactive/stalled/errored), sort field."""
        params = {}
        if category is not None:
            params['category'] = category
        if filter_str:
            params['filter'] = filter_str
        if sort:
            params['sort'] = sort
        if hashes:
            params['hashes'] = hashes
        r = self._get('/torrents/info', params=params)
        if r and r.status_code == 200:
            try:
                return r.json()
            except Exception:
                return []
        return []

    def get_torrent_properties(self, torrent_hash: str) -> Optional[Dict[str, Any]]:
        """Get properties of a specific torrent."""
        r = self._get('/torrents/properties', params={'hash': torrent_hash})
        if r and r.status_code == 200:
            try:
                return r.json()
            except Exception:
                return None
        return None

    def get_torrent_files(self, torrent_hash: str) -> List[Dict[str, Any]]:
        """Get file list for a torrent."""
        r = self._get('/torrents/files', params={'hash': torrent_hash})
        if r and r.status_code == 200:
            try:
                return r.json()
            except Exception:
                return []
        return []

    # ── Torrent management ──

    def add_torrent(self, urls: str = None, torrent_file: bytes = None,
                    category: str = None, savepath: str = None,
                    paused: bool = False, tags: str = None) -> bool:
        """Add torrent(s) via URL/magnet or .torrent file content.
        urls: newline-separated magnet links or HTTP URLs to .torrent files.
        torrent_file: raw bytes of a .torrent file."""
        data = {}
        files = None
        if urls:
            data['urls'] = urls
        if torrent_file:
            files = {'torrents': ('upload.torrent', torrent_file, 'application/x-bittorrent')}
        if category:
            data['category'] = category
        if savepath:
            data['savepath'] = savepath
        if paused:
            data['paused'] = 'true'
        if tags:
            data['tags'] = tags

        r = self._post('/torrents/add', data=data, files=files)
        if r and r.status_code == 200 and r.text.strip().upper() == 'OK.':
            return True
        if r:
            logger.warning("qBittorrent add torrent failed: status=%s body=%s",
                           r.status_code, r.text[:200])
        return False

    def pause_torrent(self, hashes: str) -> bool:
        """Pause torrent(s). hashes: single hash or '|'-separated list, or 'all'."""
        r = self._post('/torrents/pause', data={'hashes': hashes})
        return r is not None and r.status_code == 200

    def resume_torrent(self, hashes: str) -> bool:
        """Resume torrent(s)."""
        r = self._post('/torrents/resume', data={'hashes': hashes})
        return r is not None and r.status_code == 200

    def delete_torrent(self, hashes: str, delete_files: bool = False) -> bool:
        """Delete torrent(s). Optionally delete downloaded files."""
        r = self._post('/torrents/delete', data={
            'hashes': hashes,
            'deleteFiles': 'true' if delete_files else 'false'
        })
        return r is not None and r.status_code == 200

    def recheck_torrent(self, hashes: str) -> bool:
        """Recheck torrent(s)."""
        r = self._post('/torrents/recheck', data={'hashes': hashes})
        return r is not None and r.status_code == 200

    def set_torrent_category(self, hashes: str, category: str) -> bool:
        """Set category for torrent(s)."""
        r = self._post('/torrents/setCategory', data={'hashes': hashes, 'category': category})
        return r is not None and r.status_code == 200

    # ── Transfer info ──

    def get_transfer_info(self) -> Dict[str, Any]:
        """Get global transfer info (speeds, connection status)."""
        r = self._get('/transfer/info')
        if r and r.status_code == 200:
            try:
                return r.json()
            except Exception:
                return {}
        return {}

    def get_speed_limits(self) -> Dict[str, int]:
        """Get current global speed limits."""
        r_dl = self._get('/transfer/downloadLimit')
        r_ul = self._get('/transfer/uploadLimit')
        dl = 0
        ul = 0
        if r_dl and r_dl.status_code == 200:
            try:
                dl = int(r_dl.text.strip())
            except Exception:
                pass
        if r_ul and r_ul.status_code == 200:
            try:
                ul = int(r_ul.text.strip())
            except Exception:
                pass
        return {'download_limit': dl, 'upload_limit': ul}

    def set_download_limit(self, limit_bytes: int) -> bool:
        """Set global download speed limit in bytes/sec. 0 = unlimited."""
        r = self._post('/transfer/setDownloadLimit', data={'limit': str(limit_bytes)})
        return r is not None and r.status_code == 200

    def set_upload_limit(self, limit_bytes: int) -> bool:
        """Set global upload speed limit in bytes/sec. 0 = unlimited."""
        r = self._post('/transfer/setUploadLimit', data={'limit': str(limit_bytes)})
        return r is not None and r.status_code == 200

    # ── Categories ──

    def get_categories(self) -> Dict[str, Any]:
        """Get all categories. Returns dict of {name: {name, savePath}}."""
        r = self._get('/torrents/categories')
        if r and r.status_code == 200:
            try:
                return r.json()
            except Exception:
                return {}
        return {}

    def create_category(self, name: str, save_path: str = '') -> bool:
        """Create a category."""
        r = self._post('/torrents/createCategory', data={
            'category': name, 'savePath': save_path
        })
        return r is not None and r.status_code == 200

    def ensure_category(self, name: str, save_path: str = '') -> bool:
        """Create category if it doesn't exist."""
        cats = self.get_categories()
        if name in cats:
            return True
        return self.create_category(name, save_path)

    # ── Preferences ──

    def get_preferences(self) -> Dict[str, Any]:
        """Get qBittorrent preferences/settings."""
        r = self._get('/app/preferences')
        if r and r.status_code == 200:
            try:
                return r.json()
            except Exception:
                return {}
        return {}
