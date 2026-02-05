"""
Get active seeding count from torrent clients (qBittorrent, Transmission).
Used only for Max Seed Queue gating: skip hunts when seeding count >= limit.
Read-only; no torrent control. See https://github.com/plexguide/Huntarr.io/issues/713
"""

import logging
from typing import Dict, Any, Tuple

logger = logging.getLogger("huntarr.seed_queue")

# qBittorrent states that count as "actively seeding" (uploading or stalled while seeding)
QBITTORRENT_SEEDING_STATES = ("uploading", "stalledUP")
# Transmission status 6 = seeding
TRANSMISSION_STATUS_SEEDING = 6


def get_seeding_count(config: Dict[str, Any], timeout: int = 15) -> Tuple[int, str]:
    """
    Return (count, error_message) for active seeding torrents.
    count >= 0 on success; error_message is non-empty on failure.
    config: {"type": "qbittorrent"|"transmission", "host": str, "port": int, "username": str, "password": str}
    """
    if not config or not isinstance(config, dict):
        return 0, "No torrent client config"
    client_type = (config.get("type") or "").strip().lower()
    host = (config.get("host") or "").strip()
    if not host:
        return 0, "Torrent client host is empty"
    port = config.get("port")
    if port is None or port == "":
        port = 8080 if client_type == "qbittorrent" else 9091
    try:
        port = int(port)
    except (TypeError, ValueError):
        port = 8080 if client_type == "qbittorrent" else 9091
    username = (config.get("username") or "").strip()
    password = config.get("password") or ""

    if client_type == "qbittorrent":
        return _qbittorrent_seeding_count(host, port, username, password, timeout)
    if client_type == "transmission":
        return _transmission_seeding_count(host, port, username, password, timeout)
    return 0, f"Unknown torrent client type: {client_type or 'empty'}"


def _qbittorrent_seeding_count(host: str, port: int, username: str, password: str, timeout: int) -> Tuple[int, str]:
    """qBittorrent Web API v2: login then GET /api/v2/torrents/info?filter=seeding; count state in uploading, stalledUP."""
    try:
        from src.primary.settings_manager import get_ssl_verify_setting
        import requests
    except ImportError as e:
        return 0, str(e)
    base = f"https://{host}:{port}" if port in (443, 8443) else f"http://{host}:{port}"
    base = base.rstrip("/")
    verify_ssl = get_ssl_verify_setting()
    session = requests.Session()
    session.verify = verify_ssl
    login_url = f"{base}/api/v2/auth/login"
    try:
        login = session.post(
            login_url,
            data={"username": username, "password": password},
            timeout=timeout,
        )
    except Exception as e:
        return 0, f"qBittorrent login request failed: {e}"
    if login.status_code != 200 or (login.text or "").strip().lower() != "ok.":
        return 0, "qBittorrent login failed (check username/password)"
    info_url = f"{base}/api/v2/torrents/info?filter=seeding"
    try:
        r = session.get(info_url, timeout=timeout)
    except Exception as e:
        return 0, f"qBittorrent torrents/info failed: {e}"
    if r.status_code != 200:
        return 0, f"qBittorrent returned {r.status_code}"
    try:
        data = r.json()
    except Exception as e:
        return 0, f"qBittorrent invalid JSON: {e}"
    if not isinstance(data, list):
        return 0, "qBittorrent unexpected response format"
    count = sum(1 for t in data if isinstance(t, dict) and (t.get("state") or "").lower() in QBITTORRENT_SEEDING_STATES)
    return count, ""


def _transmission_seeding_count(host: str, port: int, username: str, password: str, timeout: int) -> Tuple[int, str]:
    """Transmission RPC: torrent-get with fields [status]; count status == 6 (seeding)."""
    try:
        from src.primary.settings_manager import get_ssl_verify_setting
        import requests
    except ImportError as e:
        return 0, str(e)
    base = (f"https://{host}:{port}" if port in (443, 8443) else f"http://{host}:{port}").rstrip("/")
    rpc_url = f"{base}/transmission/rpc"
    verify_ssl = get_ssl_verify_setting()
    auth = (username, password) if username or password else None
    payload = {"method": "torrent-get", "arguments": {"fields": ["status"]}}
    headers = {}
    try:
        r = requests.post(rpc_url, json=payload, auth=auth, headers=headers, timeout=timeout, verify=verify_ssl)
        if r.status_code == 409:
            session_id = r.headers.get("X-Transmission-Session-Id")
            if session_id:
                headers["X-Transmission-Session-Id"] = session_id
                r = requests.post(rpc_url, json=payload, auth=auth, headers=headers, timeout=timeout, verify=verify_ssl)
    except Exception as e:
        return 0, f"Transmission RPC request failed: {e}"
    if r.status_code != 200:
        return 0, f"Transmission returned {r.status_code}"
    try:
        data = r.json()
    except Exception as e:
        return 0, f"Transmission invalid JSON: {e}"
    args = data.get("arguments") if isinstance(data, dict) else None
    torrents = args.get("torrents", []) if isinstance(args, dict) else []
    if not isinstance(torrents, list):
        return 0, "Transmission unexpected response format"
    count = sum(1 for t in torrents if isinstance(t, dict) and t.get("status") == TRANSMISSION_STATUS_SEEDING)
    return count, ""
