"""Auto-extracted database mixin — see db_mixins/__init__.py"""
import json
import sqlite3
import time
import logging
from typing import Dict, List, Any, Optional, Set
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

class ExtrasMixin:
    """Notifications, indexer hunt, hunt history, setup progress."""

    def _parse_notification_row(self, d: dict) -> dict:
        """Parse a notification connection row from the database."""
        for key in ('settings', 'triggers'):
            if isinstance(d.get(key), str):
                try:
                    d[key] = json.loads(d[key])
                except (json.JSONDecodeError, TypeError):
                    d[key] = {}
        d['enabled'] = bool(d.get('enabled', 1))
        d['include_app_name'] = bool(d.get('include_app_name', 1))
        d['include_instance_name'] = bool(d.get('include_instance_name', 1))
        d.setdefault('app_scope', 'all')
        d.setdefault('instance_scope', 'all')
        d.setdefault('category', 'instance')
        return d

    def get_notification_connections(self) -> List[Dict[str, Any]]:
        """Return all notification connections."""
        with self.get_connection() as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                'SELECT * FROM notification_connections ORDER BY app_scope, id'
            ).fetchall()
            return [self._parse_notification_row(dict(row)) for row in rows]

    def get_notification_connection(self, conn_id: int) -> Optional[Dict[str, Any]]:
        """Return a single notification connection by ID."""
        with self.get_connection() as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                'SELECT * FROM notification_connections WHERE id = ?', (conn_id,)
            ).fetchone()
            if not row:
                return None
            return self._parse_notification_row(dict(row))

    def save_notification_connection(self, data: Dict[str, Any]) -> int:
        """Create or update a notification connection. Returns the connection ID."""
        conn_id = data.get('id')
        name = data.get('name', 'Unnamed')
        provider = data.get('provider', '')
        enabled = 1 if data.get('enabled', True) else 0
        settings_json = json.dumps(data.get('settings', {}))
        triggers_json = json.dumps(data.get('triggers', {}))
        include_app = 1 if data.get('include_app_name', True) else 0
        include_inst = 1 if data.get('include_instance_name', True) else 0
        app_scope = data.get('app_scope', 'all')
        instance_scope = data.get('instance_scope', 'all')
        category = data.get('category', 'instance')

        with self.get_connection() as conn:
            if conn_id:
                conn.execute('''
                    UPDATE notification_connections
                    SET name = ?, provider = ?, enabled = ?, settings = ?,
                        triggers = ?, include_app_name = ?, include_instance_name = ?,
                        app_scope = ?, instance_scope = ?, category = ?,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                ''', (name, provider, enabled, settings_json, triggers_json,
                      include_app, include_inst, app_scope, instance_scope, category, conn_id))
                conn.commit()
                return conn_id
            else:
                cursor = conn.execute('''
                    INSERT INTO notification_connections
                    (name, provider, enabled, settings, triggers, include_app_name,
                     include_instance_name, app_scope, instance_scope, category)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (name, provider, enabled, settings_json, triggers_json,
                      include_app, include_inst, app_scope, instance_scope, category))
                conn.commit()
                return cursor.lastrowid

    def delete_notification_connection(self, conn_id: int) -> bool:
        """Delete a notification connection by ID."""
        with self.get_connection() as conn:
            cursor = conn.execute(
                'DELETE FROM notification_connections WHERE id = ?', (conn_id,)
            )
            conn.commit()
            return cursor.rowcount > 0

    # ── User Notification Connections ──────────────────────────────────────

    def _parse_user_notification_row(self, d: dict) -> dict:
        """Parse a user notification connection row."""
        for key in ('settings', 'triggers'):
            if isinstance(d.get(key), str):
                try:
                    d[key] = json.loads(d[key])
                except (json.JSONDecodeError, TypeError):
                    d[key] = {}
        d['enabled'] = bool(d.get('enabled', 1))
        return d

    def get_user_notification_connections(self, username: str) -> List[Dict[str, Any]]:
        """Return all notification connections for a user."""
        with self.get_connection() as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                'SELECT * FROM user_notification_connections WHERE username = ? ORDER BY id',
                (username,)
            ).fetchall()
            return [self._parse_user_notification_row(dict(row)) for row in rows]

    def get_user_notification_connection(self, conn_id: int) -> Optional[Dict[str, Any]]:
        """Return a single user notification connection by ID."""
        with self.get_connection() as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                'SELECT * FROM user_notification_connections WHERE id = ?', (conn_id,)
            ).fetchone()
            if not row:
                return None
            return self._parse_user_notification_row(dict(row))

    def save_user_notification_connection(self, username: str, data: Dict[str, Any]) -> int:
        """Create or update a user notification connection. Returns the connection ID."""
        conn_id = data.get('id')
        name = data.get('name', 'Unnamed')
        provider = data.get('provider', '')
        enabled = 1 if data.get('enabled', True) else 0
        settings_json = json.dumps(data.get('settings', {}))
        triggers_json = json.dumps(data.get('triggers', {}))

        with self.get_connection() as conn:
            if conn_id:
                conn.execute('''
                    UPDATE user_notification_connections
                    SET name = ?, provider = ?, enabled = ?, settings = ?,
                        triggers = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ? AND username = ?
                ''', (name, provider, enabled, settings_json, triggers_json, conn_id, username))
                conn.commit()
                return conn_id
            else:
                cursor = conn.execute('''
                    INSERT INTO user_notification_connections
                    (username, name, provider, enabled, settings, triggers)
                    VALUES (?, ?, ?, ?, ?, ?)
                ''', (username, name, provider, enabled, settings_json, triggers_json))
                conn.commit()
                return cursor.lastrowid

    def delete_user_notification_connection(self, username: str, conn_id: int) -> bool:
        """Delete a user notification connection by ID (scoped to username)."""
        with self.get_connection() as conn:
            cursor = conn.execute(
                'DELETE FROM user_notification_connections WHERE id = ? AND username = ?',
                (conn_id, username)
            )
            conn.commit()
            return cursor.rowcount > 0

    def get_all_user_notification_connections(self) -> List[Dict[str, Any]]:
        """Return all user notification connections (for dispatch across all users)."""
        with self.get_connection() as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                'SELECT * FROM user_notification_connections WHERE enabled = 1 ORDER BY username, id'
            ).fetchall()
            return [self._parse_user_notification_row(dict(row)) for row in rows]

    # ── Indexer Hunt accessors ───────────────────────────────────────────

    def add_indexer_hunt_indexer(self, indexer_data: Dict[str, Any]) -> str:
        """Add a new Indexer Hunt indexer. Returns the id."""
        import uuid
        idx_id = indexer_data.get('id') or str(uuid.uuid4())
        cats = indexer_data.get('categories', [])
        if isinstance(cats, list):
            cats = json.dumps(cats)
        with self.get_connection() as conn:
            conn.execute('''
                INSERT INTO indexer_hunt_indexers
                    (id, name, display_name, preset, protocol, url, api_path, api_key, enabled, priority, categories)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                idx_id,
                indexer_data.get('name', 'Unnamed'),
                indexer_data.get('display_name', ''),
                indexer_data.get('preset', 'manual'),
                indexer_data.get('protocol', 'usenet'),
                indexer_data.get('url', ''),
                indexer_data.get('api_path', '/api'),
                indexer_data.get('api_key', ''),
                1 if indexer_data.get('enabled', True) else 0,
                indexer_data.get('priority', 50),
                cats,
            ))
            conn.commit()
        return idx_id

    def get_indexer_hunt_indexers(self) -> List[Dict[str, Any]]:
        """Return all Indexer Hunt indexers."""
        with self.get_connection() as conn:
            with self._use_row_factory(conn) as c:
                rows = c.execute('SELECT * FROM indexer_hunt_indexers ORDER BY priority ASC, name ASC').fetchall()
            out = []
            for r in rows:
                d = dict(r)
                try:
                    d['categories'] = json.loads(d.get('categories') or '[]')
                except (json.JSONDecodeError, TypeError):
                    d['categories'] = []
                d['enabled'] = bool(d.get('enabled', 1))
                out.append(d)
            return out

    def get_indexer_hunt_indexer(self, idx_id: str) -> Optional[Dict[str, Any]]:
        """Return a single Indexer Hunt indexer by id."""
        with self.get_connection() as conn:
            with self._use_row_factory(conn) as c:
                row = c.execute('SELECT * FROM indexer_hunt_indexers WHERE id = ?', (idx_id,)).fetchone()
            if not row:
                return None
            d = dict(row)
            try:
                d['categories'] = json.loads(d.get('categories') or '[]')
            except (json.JSONDecodeError, TypeError):
                d['categories'] = []
            d['enabled'] = bool(d.get('enabled', 1))
            return d

    def update_indexer_hunt_indexer(self, idx_id: str, updates: Dict[str, Any]) -> bool:
        """Update fields on an Indexer Hunt indexer. Returns True if a row was updated."""
        allowed = ['name', 'display_name', 'preset', 'protocol', 'url', 'api_path',
                    'api_key', 'enabled', 'priority', 'categories']
        sets = []
        vals = []
        for k in allowed:
            if k in updates:
                v = updates[k]
                if k == 'categories' and isinstance(v, list):
                    v = json.dumps(v)
                if k == 'enabled':
                    v = 1 if v else 0
                sets.append(f'{k} = ?')
                vals.append(v)
        if not sets:
            return False
        sets.append('updated_at = CURRENT_TIMESTAMP')
        vals.append(idx_id)
        with self.get_connection() as conn:
            cur = conn.execute(f'UPDATE indexer_hunt_indexers SET {", ".join(sets)} WHERE id = ?', vals)
            conn.commit()
            return cur.rowcount > 0

    def delete_indexer_hunt_indexer(self, idx_id: str) -> bool:
        """Delete an Indexer Hunt indexer and its stats/history."""
        with self.get_connection() as conn:
            conn.execute('DELETE FROM indexer_hunt_stats WHERE indexer_id = ?', (idx_id,))
            conn.execute('DELETE FROM indexer_hunt_history WHERE indexer_id = ?', (idx_id,))
            cur = conn.execute('DELETE FROM indexer_hunt_indexers WHERE id = ?', (idx_id,))
            conn.commit()
            return cur.rowcount > 0

    def record_indexer_hunt_event(self, indexer_id: str, indexer_name: str, event_type: str,
                                  query: str = '', result_title: str = '', response_time_ms: int = 0,
                                  success: bool = True, error_message: str = '',
                                  instance_id: int = None, instance_name: str = ''):
        """Log an event to indexer_hunt_history and update aggregate stats."""
        with self.get_connection() as conn:
            conn.execute('''
                INSERT INTO indexer_hunt_history
                    (indexer_id, indexer_name, event_type, query, result_title,
                     response_time_ms, success, error_message, instance_id, instance_name)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (indexer_id, indexer_name, event_type, query, result_title,
                  response_time_ms, 1 if success else 0, error_message,
                  instance_id, instance_name))
            # Update aggregate stats
            stat_key = event_type  # e.g. 'search', 'grab', 'failure'
            conn.execute('''
                INSERT INTO indexer_hunt_stats (indexer_id, stat_type, stat_value)
                VALUES (?, ?, 1)
                ON CONFLICT(indexer_id, stat_type) DO UPDATE SET
                    stat_value = stat_value + 1,
                    recorded_at = CURRENT_TIMESTAMP
            ''', (indexer_id, stat_key))
            # Update response time average
            if response_time_ms > 0:
                conn.execute('''
                    INSERT INTO indexer_hunt_stats (indexer_id, stat_type, stat_value)
                    VALUES (?, 'avg_response_ms', ?)
                    ON CONFLICT(indexer_id, stat_type) DO UPDATE SET
                        stat_value = (stat_value + ?) / 2.0,
                        recorded_at = CURRENT_TIMESTAMP
                ''', (indexer_id, response_time_ms, response_time_ms))
            conn.commit()

    def get_indexer_hunt_stats(self, indexer_id: str = None) -> List[Dict[str, Any]]:
        """Get Indexer Hunt stats, optionally filtered by indexer_id."""
        with self.get_connection() as conn:
            with self._use_row_factory(conn) as c:
                if indexer_id:
                    rows = c.execute('SELECT * FROM indexer_hunt_stats WHERE indexer_id = ?', (indexer_id,)).fetchall()
                else:
                    rows = c.execute('SELECT * FROM indexer_hunt_stats ORDER BY indexer_id').fetchall()
            return [dict(r) for r in rows]

    def get_indexer_hunt_stats_24h(self, indexer_id: str = None) -> Dict[str, Any]:
        """Get rolling 24-hour Indexer Hunt stats from history table.
        
        Returns aggregated counts for the last 24 hours:
        searches, grabs, failures, avg_response_ms, per-indexer breakdown.
        """
        with self.get_connection() as conn:
            params = []
            indexer_filter = ''
            if indexer_id:
                indexer_filter = 'AND indexer_id = ?'
                params.append(indexer_id)

            # Aggregate counts by event type in last 24 hours
            rows = conn.execute(f'''
                SELECT event_type, COUNT(*) as cnt
                FROM indexer_hunt_history
                WHERE created_at >= datetime('now', '-24 hours')
                {indexer_filter}
                GROUP BY event_type
            ''', params).fetchall()

            counts = {}
            for r in rows:
                counts[r[0]] = r[1]

            # Average response time for searches in last 24 hours
            avg_row = conn.execute(f'''
                SELECT AVG(response_time_ms) as avg_ms
                FROM indexer_hunt_history
                WHERE created_at >= datetime('now', '-24 hours')
                AND event_type = 'search'
                AND response_time_ms > 0
                {indexer_filter}
            ''', params).fetchone()
            avg_ms = round(avg_row[0], 1) if avg_row and avg_row[0] else 0

            # Failure count (searches with success=0)
            fail_row = conn.execute(f'''
                SELECT COUNT(*) as cnt
                FROM indexer_hunt_history
                WHERE created_at >= datetime('now', '-24 hours')
                AND event_type = 'search'
                AND success = 0
                {indexer_filter}
            ''', params).fetchone()
            failures = fail_row[0] if fail_row else 0

            return {
                'searches': counts.get('search', 0),
                'grabs': counts.get('grab', 0),
                'failures': failures,
                'avg_response_ms': avg_ms,
                'health_checks': counts.get('health_check', 0),
                'tests': counts.get('test', 0),
            }

    def get_indexer_hunt_stats_24h_per_indexer(self) -> List[Dict[str, Any]]:
        """Get rolling 24-hour stats broken down by indexer."""
        with self.get_connection() as conn:
            rows = conn.execute('''
                SELECT indexer_id, indexer_name, event_type,
                       COUNT(*) as cnt,
                       AVG(CASE WHEN response_time_ms > 0 THEN response_time_ms ELSE NULL END) as avg_ms,
                       SUM(CASE WHEN success = 0 AND event_type = 'search' THEN 1 ELSE 0 END) as fail_cnt
                FROM indexer_hunt_history
                WHERE created_at >= datetime('now', '-24 hours')
                GROUP BY indexer_id, event_type
            ''').fetchall()

            by_indexer = {}
            for r in rows:
                iid = r[0]
                if iid not in by_indexer:
                    by_indexer[iid] = {
                        'id': iid,
                        'name': r[1] or 'Unknown',
                        'searches': 0,
                        'grabs': 0,
                        'failures': 0,
                        'avg_response_ms': 0,
                    }
                etype = r[2]
                if etype == 'search':
                    by_indexer[iid]['searches'] = r[3]
                    by_indexer[iid]['avg_response_ms'] = round(r[4], 1) if r[4] else 0
                    by_indexer[iid]['failures'] = r[5]
                elif etype == 'grab':
                    by_indexer[iid]['grabs'] = r[3]

            # Calculate failure rates
            for idx_data in by_indexer.values():
                s = idx_data['searches']
                idx_data['failure_rate'] = round((idx_data['failures'] / s) * 100, 1) if s > 0 else 0

            return list(by_indexer.values())

    def get_indexer_hunt_history(self, indexer_id: str = None, event_type: str = None,
                                 page: int = 1, page_size: int = 50) -> Dict[str, Any]:
        """Get paginated Indexer Hunt history with optional filters."""
        conditions = []
        params = []
        if indexer_id:
            conditions.append('indexer_id = ?')
            params.append(indexer_id)
        if event_type:
            conditions.append('event_type = ?')
            params.append(event_type)
        where = ('WHERE ' + ' AND '.join(conditions)) if conditions else ''
        offset = (max(1, page) - 1) * page_size
        with self.get_connection() as conn:
            with self._use_row_factory(conn) as c:
                count_row = c.execute(f'SELECT COUNT(*) as cnt FROM indexer_hunt_history {where}', params).fetchone()
                total = count_row['cnt'] if count_row else 0
                rows = c.execute(
                    f'SELECT * FROM indexer_hunt_history {where} ORDER BY created_at DESC LIMIT ? OFFSET ?',
                    params + [page_size, offset]
                ).fetchall()
            return {
                'items': [dict(r) for r in rows],
                'total': total,
                'page': page,
                'page_size': page_size,
                'total_pages': max(1, (total + page_size - 1) // page_size),
            }
