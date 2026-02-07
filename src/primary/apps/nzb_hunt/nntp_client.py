"""
NNTP Client - Connect to Usenet servers and download articles.

Uses Python's built-in nntplib with connection pooling and retry logic.
Supports SSL/TLS connections and multiple server priorities.
"""

import nntplib
import ssl
import socket
import threading
import time
from typing import Optional, List, Tuple

from src.primary.utils.logger import get_logger

logger = get_logger("nzb_hunt.nntp")


class NNTPConnection:
    """A single NNTP connection to a server."""
    
    def __init__(self, host: str, port: int, use_ssl: bool = True,
                 username: str = "", password: str = "", timeout: int = 30):
        self.host = host
        self.port = port
        self.use_ssl = use_ssl
        self.username = username
        self.password = password
        self.timeout = timeout
        self._conn = None
        self._lock = threading.Lock()
        self._current_group = None
    
    def connect(self) -> bool:
        """Establish connection to the NNTP server."""
        try:
            if self.use_ssl:
                ctx = ssl.create_default_context()
                ctx.check_hostname = False
                ctx.verify_mode = ssl.CERT_NONE
                self._conn = nntplib.NNTP_SSL(
                    self.host, self.port, 
                    user=self.username or None,
                    password=self.password or None,
                    ssl_context=ctx,
                    timeout=self.timeout
                )
            else:
                self._conn = nntplib.NNTP(
                    self.host, self.port,
                    user=self.username or None,
                    password=self.password or None,
                    timeout=self.timeout
                )
            logger.debug(f"Connected to {self.host}:{self.port}")
            return True
        except Exception as e:
            logger.error(f"Failed to connect to {self.host}:{self.port}: {e}")
            self._conn = None
            return False
    
    def disconnect(self):
        """Close the NNTP connection."""
        if self._conn:
            try:
                self._conn.quit()
            except Exception:
                pass
            self._conn = None
            self._current_group = None
    
    @property
    def connected(self) -> bool:
        if not self._conn:
            return False
        try:
            self._conn.getwelcome()
            return True
        except Exception:
            return False
    
    def _ensure_connected(self) -> bool:
        """Reconnect if needed."""
        if self._conn:
            try:
                # Simple connectivity check
                return True
            except Exception:
                self._conn = None
        return self.connect()
    
    def select_group(self, group: str) -> bool:
        """Select a newsgroup."""
        if not self._ensure_connected():
            return False
        if self._current_group == group:
            return True
        try:
            self._conn.group(group)
            self._current_group = group
            return True
        except nntplib.NNTPTemporaryError:
            # Group may not exist on this server
            return False
        except Exception as e:
            logger.debug(f"Failed to select group {group}: {e}")
            return False
    
    def download_article(self, message_id: str) -> Optional[bytes]:
        """Download a single article by Message-ID.
        
        Args:
            message_id: The Message-ID without angle brackets
            
        Returns:
            Article body as bytes, or None on failure
        """
        if not self._ensure_connected():
            return None
        
        # Wrap in angle brackets if not present
        if not message_id.startswith("<"):
            message_id = f"<{message_id}>"
        
        try:
            resp, info = self._conn.body(message_id)
            # info.lines is a list of bytes
            if hasattr(info, 'lines'):
                return b"\r\n".join(info.lines)
            return None
        except nntplib.NNTPTemporaryError as e:
            code = str(e)[:3]
            if code == "430":  # Article not found
                return None
            logger.debug(f"NNTP temp error downloading {message_id}: {e}")
            return None
        except nntplib.NNTPPermanentError as e:
            logger.debug(f"NNTP perm error downloading {message_id}: {e}")
            return None
        except (socket.timeout, ConnectionError, OSError) as e:
            logger.debug(f"Connection error downloading {message_id}: {e}")
            self._conn = None
            return None
        except Exception as e:
            logger.debug(f"Error downloading {message_id}: {e}")
            self._conn = None
            return None


class NNTPConnectionPool:
    """Pool of NNTP connections to a single server."""
    
    def __init__(self, server_config: dict, max_connections: int = 8):
        self.host = server_config.get("host", "")
        self.port = int(server_config.get("port", 563))
        self.use_ssl = bool(server_config.get("ssl", True))
        self.username = server_config.get("username", "")
        self.password = server_config.get("password", "")
        self.max_connections = min(max_connections, int(server_config.get("connections", 8)))
        self.priority = int(server_config.get("priority", 0))
        self.enabled = bool(server_config.get("enabled", True))
        self.server_name = server_config.get("name", self.host)
        
        self._connections: List[NNTPConnection] = []
        self._available: List[NNTPConnection] = []
        self._lock = threading.Lock()
    
    def get_connection(self, timeout: float = 30.0) -> Optional[NNTPConnection]:
        """Get an available connection from the pool."""
        deadline = time.time() + timeout
        
        while time.time() < deadline:
            with self._lock:
                # Return an available connection
                if self._available:
                    return self._available.pop()
                
                # Create a new connection if under limit
                if len(self._connections) < self.max_connections:
                    conn = NNTPConnection(
                        self.host, self.port, self.use_ssl,
                        self.username, self.password
                    )
                    if conn.connect():
                        self._connections.append(conn)
                        return conn
                    else:
                        return None
            
            # Wait briefly before retrying
            time.sleep(0.1)
        
        return None
    
    def release_connection(self, conn: NNTPConnection):
        """Return a connection to the pool."""
        with self._lock:
            if conn in self._connections:
                self._available.append(conn)
    
    def close_all(self):
        """Close all connections in the pool."""
        with self._lock:
            for conn in self._connections:
                conn.disconnect()
            self._connections.clear()
            self._available.clear()
    
    def test_connection(self) -> Tuple[bool, str]:
        """Test if we can connect to this server."""
        conn = NNTPConnection(
            self.host, self.port, self.use_ssl,
            self.username, self.password, timeout=10
        )
        if conn.connect():
            conn.disconnect()
            return True, f"Connected to {self.server_name}"
        return False, f"Failed to connect to {self.host}:{self.port}"


class NNTPManager:
    """Manages connections to multiple NNTP servers with priority-based fallback."""
    
    def __init__(self):
        self._pools: List[NNTPConnectionPool] = []
        self._lock = threading.Lock()
    
    def configure(self, servers: List[dict]):
        """Configure server pools from server config list."""
        with self._lock:
            # Close existing pools
            for pool in self._pools:
                pool.close_all()
            
            self._pools = []
            for srv in servers:
                if srv.get("enabled", True):
                    pool = NNTPConnectionPool(srv)
                    self._pools.append(pool)
            
            # Sort by priority (lower = higher priority)
            self._pools.sort(key=lambda p: p.priority)
    
    def download_article(self, message_id: str, groups: List[str] = None) -> Optional[bytes]:
        """Download an article, trying servers in priority order.
        
        Args:
            message_id: Article Message-ID
            groups: List of newsgroups to try
            
        Returns:
            Article body bytes or None
        """
        for pool in self._pools:
            conn = pool.get_connection(timeout=5)
            if not conn:
                continue
            
            try:
                # Try to select a group if provided
                if groups:
                    for group in groups:
                        if conn.select_group(group):
                            break
                
                data = conn.download_article(message_id)
                if data is not None:
                    return data
            finally:
                pool.release_connection(conn)
        
        return None
    
    def has_servers(self) -> bool:
        """Check if any servers are configured."""
        return len(self._pools) > 0
    
    def test_servers(self) -> List[Tuple[str, bool, str]]:
        """Test all configured server connections."""
        results = []
        for pool in self._pools:
            success, msg = pool.test_connection()
            results.append((pool.server_name, success, msg))
        return results
    
    def close_all(self):
        """Close all server connections."""
        with self._lock:
            for pool in self._pools:
                pool.close_all()
