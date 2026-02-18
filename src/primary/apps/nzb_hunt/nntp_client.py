"""
NNTP Client - Connect to Usenet servers and download articles.

Uses Python's built-in nntplib with connection pooling and retry logic.
Supports SSL/TLS connections, multiple server priorities, parallel
downloading via thread-safe connection pools, and per-server bandwidth tracking.

nntplib was removed from the stdlib in Python 3.13; we use a vendored copy
when the built-in module is unavailable.
"""

try:
    import nntplib  # type: ignore[import-untyped]
except ImportError:
    from src.primary.vendor import nntplib
import ssl
import socket
import threading
import time
from typing import Optional, List, Tuple, Dict, Any

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
        """Establish connection to the NNTP server with optimized buffers and SSL."""
        try:
            if self.use_ssl:
                ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
                ctx.check_hostname = False
                ctx.verify_mode = ssl.CERT_NONE
                # Disable SSL compression (saves CPU, SABnzbd pattern)
                ctx.options |= ssl.OP_NO_SSLv2 | ssl.OP_NO_SSLv3
                try:
                    ctx.options |= ssl.OP_NO_COMPRESSION
                except AttributeError:
                    pass
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
            
            # Socket-level optimizations for high-throughput downloading.
            try:
                sock = self._conn.sock
                if sock:
                    # 8MB receive buffer — reduces syscalls significantly
                    # for large articles and helps saturate 2.5 Gbps+ connections.
                    # The kernel may cap this at net.core.rmem_max (16MB on
                    # this host) but will use the highest allowed value.
                    sock.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 8388608)
                    sock.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, 262144)
                    # Disable Nagle's algorithm — send BODY commands immediately
                    # instead of waiting to coalesce small writes
                    sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
                    # Disable delayed ACKs on Linux — ACK each segment
                    # immediately so the server sends the next one faster.
                    # This reduces round-trip latency on high-throughput
                    # connections.  TCP_QUICKACK is Linux-only (value 12).
                    try:
                        sock.setsockopt(socket.IPPROTO_TCP, 12, 1)  # TCP_QUICKACK
                    except (OSError, AttributeError):
                        pass
            except Exception:
                pass
            
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
        """Check if the connection object exists (no server round-trip).
        
        Avoids calling getwelcome() which sends a command to the server on
        every check — wasteful when called from the connection pool's hot path.
        Actual liveness is verified when an NNTP command fails and triggers
        reconnection.
        """
        return self._conn is not None
    
    def _ensure_connected(self) -> bool:
        """Reconnect if the connection object is gone."""
        if self._conn is not None:
            return True
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
        """Download a single article by Message-ID using fast chunk reads.
        
        Bypasses nntplib's line-by-line body() method (~1000 readline calls
        per 750KB article) and reads in large chunks instead.  Uses a
        list-of-chunks pattern to avoid repeated bytearray.extend() memory
        copies.
        
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
            conn = self._conn
            # Send BODY command
            conn._putcmd(f"BODY {message_id}")
            
            # Read the response status line
            resp = conn._getresp()
            if not resp.startswith("222"):
                return None
            
            # Read body in large chunks.  NNTP multi-line response ends with
            # "\r\n.\r\n".  We collect chunks in a list (O(1) append) and
            # join once at the end — avoids repeated bytearray.extend() copies.
            file = conn.file
            chunks = []
            total = 0
            # Resolve read method once (avoid hasattr per iteration)
            _read = getattr(file, 'read1', None) or file.read
            _READ_SIZE = 4194304  # 4MB — matches 8MB SO_RCVBUF
            # Track last 5 bytes across chunk boundaries without allocation.
            # _tail is a small bytes object updated each iteration — avoids
            # the old approach of slicing two chunks and concatenating.
            _tail = b""
            _TERM = b"\r\n.\r\n"
            
            while True:
                chunk = _read(_READ_SIZE)
                if not chunk:
                    break
                chunks.append(chunk)
                total += len(chunk)
                # Fast path: chunk is large (>= 5 bytes, ~always true for 1MB reads).
                # endswith is O(5) on the 5-byte suffix — effectively free.
                if len(chunk) >= 5:
                    if chunk[-1:] == b"\n" and chunk.endswith(_TERM):
                        break
                    _tail = chunk[-5:]
                else:
                    # Rare: tiny chunk at stream end.  Merge with previous
                    # tail to check for cross-boundary terminator.
                    _tail = (_tail + chunk)[-5:]
                    if len(_tail) >= 5 and _tail == _TERM:
                        break
            
            # Single join (one allocation), then free chunk list.
            # We know the terminator is at the very end (we broke on it),
            # so just trim the last 5 bytes instead of scanning with rfind.
            # Fast path: single chunk avoids the join allocation entirely.
            if len(chunks) == 1:
                raw = chunks[0]
            else:
                raw = b"".join(chunks)
            del chunks
            
            if total >= 5 and raw[-5:] == _TERM:
                body = raw[:-5]
            else:
                body = raw
            del raw
            
            # Handle dot-stuffing (lines starting with ".." → ".")
            # This is rare in yEnc data, so the 'in' check is almost always False.
            if b"\r\n.." in body:
                body = body.replace(b"\r\n..", b"\r\n.")
            
            return body if body else None
            
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
    
    def __init__(self, server_config: dict, max_connections: int = 0):
        self.host = server_config.get("host", "")
        self.port = int(server_config.get("port", 563))
        self.use_ssl = bool(server_config.get("ssl", True))
        self.username = server_config.get("username", "")
        self.password = server_config.get("password", "")
        # Use the server's configured connections, or the override if provided
        server_conns = int(server_config.get("connections", 8))
        self.max_connections = min(max_connections, server_conns) if max_connections > 0 else server_conns
        self.priority = int(server_config.get("priority", 0))
        self.enabled = bool(server_config.get("enabled", True))
        self.server_name = server_config.get("name", self.host)
        
        self._connections: List[NNTPConnection] = []
        self._available: List[NNTPConnection] = []
        self._lock = threading.Lock()
        
        # Bandwidth tracking — lock-free accumulator.  With 80 threads,
        # a per-segment lock acquisition is significant contention.
        # CPython's GIL makes simple int += atomic enough for counters.
        self._bandwidth_bytes = 0
    
    def get_connection(self, timeout: float = 30.0) -> Optional[NNTPConnection]:
        """Get an available connection from the pool.

        Blocks up to `timeout` seconds waiting for a connection to become
        available.  If under the limit, opens a new one immediately.  On
        connect failure it retries (with backoff) until the deadline rather
        than giving up instantly.

        SSL handshake is done OUTSIDE the lock so other threads can
        acquire idle connections concurrently.
        """
        deadline = time.time() + timeout
        backoff = 0.05  # initial retry sleep

        while time.time() < deadline:
            with self._lock:
                # Return an available (idle) connection
                if self._available:
                    conn = self._available.pop()
                    # Quick liveness check — replace dead connections
                    if conn._conn is not None:
                        return conn
                    # Dead connection – remove from pool and try to open a new one
                    if conn in self._connections:
                        self._connections.remove(conn)

                # Reserve a slot if under limit (but don't connect yet)
                if len(self._connections) < self.max_connections:
                    conn = NNTPConnection(
                        self.host, self.port, self.use_ssl,
                        self.username, self.password
                    )
                    # Add placeholder to reserve the slot
                    self._connections.append(conn)
                else:
                    conn = None

            if conn is not None:
                # Connect OUTSIDE the lock — SSL handshake can take 50-200ms
                # and we don't want to block other threads from getting idle
                # connections during that time.
                if conn.connect():
                    return conn
                else:
                    # Connect failed — remove the placeholder
                    with self._lock:
                        if conn in self._connections:
                            self._connections.remove(conn)
                    # Fall through to retry

            # Wait briefly before retrying (bounded backoff)
            time.sleep(min(backoff, max(0, deadline - time.time())))
            backoff = min(backoff * 1.5, 1.0)

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
    
    def add_bandwidth(self, nbytes: int):
        """Record downloaded bytes (lock-free, GIL-atomic)."""
        self._bandwidth_bytes += nbytes
    
    def get_bandwidth(self) -> int:
        """Get total bytes downloaded through this server."""
        return self._bandwidth_bytes
    
    def reset_bandwidth(self):
        """Reset bandwidth counter."""
        self._bandwidth_bytes = 0
    
    def get_connection_stats(self) -> Tuple[int, int]:
        """Get (active_connections, max_connections) for this pool."""
        with self._lock:
            total = len(self._connections)
            available = len(self._available)
            active = total - available
        return active, self.max_connections


class NNTPManager:
    """Manages connections to multiple NNTP servers with priority-based fallback.
    
    Same-priority servers work together: connection requests are distributed
    round-robin across same-priority pools so all connections are used in parallel,
    rather than saturating one server before using the next.
    
    Per-server active counts are tracked at manager level so they survive
    pool reconfiguration. This ensures the UI always reflects reality.
    """
    
    def __init__(self):
        self._pools: List[NNTPConnectionPool] = []
        self._lock = threading.Lock()
        self._round_robin_index = 0  # For distributing across same-priority pools
        # Active connection tracking: {server_host: count}
        # Lives at manager level so pool reconfiguration doesn't reset it.
        self._active_counts: Dict[str, int] = {}
        self._active_lock = threading.Lock()
    
    def _inc_active(self, host: str):
        """Increment active connection count for a server."""
        with self._active_lock:
            self._active_counts[host] = self._active_counts.get(host, 0) + 1
    
    def _dec_active(self, host: str):
        """Decrement active connection count for a server."""
        with self._active_lock:
            self._active_counts[host] = max(0, self._active_counts.get(host, 0) - 1)
    
    def _get_active(self, host: str) -> int:
        """Get active connection count for a server."""
        with self._active_lock:
            return self._active_counts.get(host, 0)
    
    def _reset_active(self):
        """Reset all active counts (only when no downloads are running)."""
        with self._active_lock:
            self._active_counts.clear()
    
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
    
    def acquire_connection(self, timeout: float = 30.0) -> Tuple[Optional['NNTPConnection'], Optional['NNTPConnectionPool']]:
        """Acquire a dedicated connection for persistent use by a worker thread.
        
        Returns (connection, pool).  The connection is checked out from the
        pool and will show as "active" in stats until explicitly released
        via pool.release_connection().  Each downloader thread holds its own
        connection for the entire download session, keeping all connections
        saturated.
        
        Uses priority/round-robin logic with a short per-pool timeout so
        threads quickly fall through to the next server if one pool is full
        (e.g., easynews full at 30/30 → immediately try NewsHosting).
        """
        with self._lock:
            pools = list(self._pools)
        
        # Group by priority
        by_priority: Dict[int, List[NNTPConnectionPool]] = {}
        for pool in pools:
            p = pool.priority
            if p not in by_priority:
                by_priority[p] = []
            by_priority[p].append(pool)
        
        # Short per-pool timeout: enough for SSL handshake (~3s) but don't
        # block long if the pool is full — try the next server instead.
        per_pool_timeout = min(8.0, timeout)
        
        deadline = time.time() + timeout
        
        for priority in sorted(by_priority.keys()):
            pools_at_priority = by_priority[priority]
            # Round-robin across same-priority pools
            with self._lock:
                start = self._round_robin_index % len(pools_at_priority)
                self._round_robin_index = (self._round_robin_index + 1) % len(pools_at_priority)
            
            for i in range(len(pools_at_priority)):
                if time.time() >= deadline:
                    return None, None
                pool = pools_at_priority[(start + i) % len(pools_at_priority)]
                
                # Quick check: if pool is already full (all connections checked
                # out), skip immediately instead of blocking
                with pool._lock:
                    has_room = (len(pool._connections) < pool.max_connections or
                                len(pool._available) > 0)
                if not has_room:
                    continue
                
                conn = pool.get_connection(timeout=per_pool_timeout)
                if conn:
                    self._inc_active(pool.host)
                    return conn, pool
        
        return None, None
    
    def download_article(self, message_id: str, groups: List[str] = None,
                         conn_timeout: float = 5.0) -> Optional[bytes]:
        """Download an article, trying servers in priority order.
        
        Args:
            message_id: Article Message-ID
            groups: List of newsgroups to try
            conn_timeout: Timeout for getting a connection from pool
            
        Returns:
            Article body bytes or None
        """
        result = self.download_article_tracked(message_id, groups, conn_timeout)
        return result[0]
    
    def download_article_tracked(self, message_id: str, groups: List[str] = None,
                                  conn_timeout: float = 10.0) -> Tuple[Optional[bytes], str]:
        """Download an article, returning (data, server_name).
        
        Uses a short connection timeout for parallel downloading so threads
        quickly fall through to the next available server when a pool is full.
        Same-priority servers are tried in round-robin order so connections
        are distributed across all servers (maxing out total throughput).
        Also tracks bandwidth per server.
        
        Args:
            message_id: Article Message-ID
            groups: List of newsgroups to try
            conn_timeout: Timeout for getting a connection from pool
            
        Returns:
            Tuple of (article body bytes or None, server name that provided it)
        """
        with self._lock:
            pools = list(self._pools)
        
        # Group pools by priority (lower = higher priority)
        by_priority: Dict[int, List[NNTPConnectionPool]] = {}
        for pool in pools:
            p = pool.priority
            if p not in by_priority:
                by_priority[p] = []
            by_priority[p].append(pool)
        
        for priority in sorted(by_priority.keys()):
            pools_at_priority = by_priority[priority]
            # Round-robin across same-priority pools for parallel distribution
            with self._lock:
                start = self._round_robin_index % len(pools_at_priority)
                self._round_robin_index = (self._round_robin_index + 1) % len(pools_at_priority)
            
            for i in range(len(pools_at_priority)):
                pool = pools_at_priority[(start + i) % len(pools_at_priority)]
                conn = pool.get_connection(timeout=conn_timeout)
                if not conn:
                    continue
                
                released = False
                try:
                    if groups:
                        for group in groups:
                            if conn.select_group(group):
                                break
                    
                    data = conn.download_article(message_id)
                    if data is not None:
                        pool.add_bandwidth(len(data))
                        # Release connection back BEFORE returning so it's
                        # immediately available for the next thread
                        pool.release_connection(conn)
                        released = True
                        return data, pool.server_name
                except Exception:
                    # Connection is broken — remove from pool entirely
                    try:
                        with pool._lock:
                            if conn in pool._connections:
                                pool._connections.remove(conn)
                    except Exception:
                        pass
                    conn.disconnect()
                    released = True  # Don't release a dead connection
                    continue
                finally:
                    if not released:
                        try:
                            pool.release_connection(conn)
                        except Exception:
                            pass
        
        return None, ""
    
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
    
    def get_bandwidth_stats(self) -> Dict[str, int]:
        """Get bytes downloaded per server (keyed by name:host)."""
        stats = {}
        for pool in self._pools:
            key = f"{pool.server_name} ({pool.host})"
            stats[key] = pool.get_bandwidth()
        return stats
    
    def reset_bandwidth(self):
        """Reset all server bandwidth counters."""
        for pool in self._pools:
            pool.reset_bandwidth()
    
    def get_total_max_connections(self) -> int:
        """Get total max connections across all server pools."""
        return sum(pool.max_connections for pool in self._pools)
    
    def get_connection_stats(self) -> List[Dict[str, Any]]:
        """Get per-server connection stats: name, active, max, host.
        
        Uses the manager-level active counts so the count survives pool
        reconfiguration and always reflects reality.
        """
        result = []
        for pool in self._pools:
            active = self._get_active(pool.host)
            result.append({
                "name": pool.server_name,
                "host": pool.host,
                "active": active,
                "max": pool.max_connections,
            })
        return result
    
    def close_all(self):
        """Close all server connections."""
        with self._lock:
            for pool in self._pools:
                pool.close_all()
    def prewarm_connections(self, max_workers: int = 20):
        """Open all server connections in parallel before download starts.

        SSL handshakes take 50-200ms each.  Opening 90 connections serially
        takes 5-18 seconds.  By pre-warming in parallel (20 threads), all
        connections are ready in ~1 second, so the download hits full speed
        immediately instead of ramping up over 30-60 seconds.
        """
        with self._lock:
            pools = list(self._pools)

        if not pools:
            return

        def _open_one(pool):
            conn = pool.get_connection(timeout=15.0)
            if conn:
                pool.release_connection(conn)

        tasks = []
        for pool in pools:
            remaining = pool.max_connections - len(pool._connections)
            for _ in range(remaining):
                tasks.append(pool)

        if not tasks:
            return

        logger.info(f"Pre-warming {len(tasks)} NNTP connections across {len(pools)} servers...")
        from concurrent.futures import ThreadPoolExecutor as _TPE
        with _TPE(max_workers=min(max_workers, len(tasks))) as executor:
            list(executor.map(_open_one, tasks))

        total = sum(len(p._connections) for p in pools)
        logger.info(f"Pre-warm complete: {total} connections ready")
