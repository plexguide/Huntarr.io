"""Auto-extracted database mixin — see db_mixins/__init__.py"""
import json
import sqlite3
import time
import logging
from typing import Dict, List, Any, Optional, Set
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

class StateMixin:
    """Stateful management, processed IDs, locks, stats, hourly caps, sleep data, swaparr, schedules."""

    def get_stateful_lock_info(self) -> Dict[str, Any]:
        """Get stateful management lock information"""
        with self.get_connection() as conn:
            cursor = conn.execute('SELECT created_at, expires_at FROM stateful_lock WHERE id = 1')
            row = cursor.fetchone()
            
            if row:
                return {
                    "created_at": row[0],
                    "expires_at": row[1]
                }
            return {}
    
    def set_stateful_lock_info(self, created_at: int, expires_at: int):
        """Set stateful management lock information"""
        with self.get_connection() as conn:
            conn.execute('''
                INSERT OR REPLACE INTO stateful_lock (id, created_at, expires_at, updated_at)
                VALUES (1, ?, ?, CURRENT_TIMESTAMP)
            ''', (created_at, expires_at))
            conn.commit()
            logger.debug(f"Set stateful lock: created_at={created_at}, expires_at={expires_at}")
    
    def get_processed_ids(self, app_type: str, instance_name: str) -> Set[str]:
        """Get processed media IDs for a specific app instance"""
        with self.get_connection() as conn:
            cursor = conn.execute('''
                SELECT media_id FROM stateful_processed_ids 
                WHERE app_type = ? AND instance_name = ?
            ''', (app_type, instance_name))
            
            return {row[0] for row in cursor.fetchall()}
    
    def add_processed_id(self, app_type: str, instance_name: str, media_id: str) -> bool:
        """Add a processed media ID for a specific app instance"""
        try:
            with self.get_connection() as conn:
                conn.execute('''
                    INSERT OR IGNORE INTO stateful_processed_ids 
                    (app_type, instance_name, media_id)
                    VALUES (?, ?, ?)
                ''', (app_type, instance_name, str(media_id)))
                conn.commit()
                logger.debug(f"Added processed ID {media_id} for {app_type}/{instance_name}")
                return True
        except Exception as e:
            logger.error(f"Error adding processed ID {media_id} for {app_type}/{instance_name}: {e}")
            return False
    
    def is_processed(self, app_type: str, instance_name: str, media_id: str) -> bool:
        """Check if a media ID has been processed for a specific app instance"""
        with self.get_connection() as conn:
            cursor = conn.execute('''
                SELECT 1 FROM stateful_processed_ids 
                WHERE app_type = ? AND instance_name = ? AND media_id = ?
            ''', (app_type, instance_name, str(media_id)))
            
            return cursor.fetchone() is not None
    
    def clear_all_stateful_data(self):
        """Clear all stateful management data (for reset)"""
        with self.get_connection() as conn:
            # Clear processed IDs
            conn.execute('DELETE FROM stateful_processed_ids')
            # Clear lock info
            conn.execute('DELETE FROM stateful_lock')
            # Clear per-instance locks
            conn.execute('DELETE FROM stateful_instance_locks')
            conn.commit()
            logger.info("Cleared all stateful management data from database")
    
    # Per-Instance State Management Methods
    
    def get_instance_lock_info(self, app_type: str, instance_name: str) -> Dict[str, Any]:
        """Get state management lock information for a specific instance"""
        with self.get_connection() as conn:
            cursor = conn.execute('''
                SELECT created_at, expires_at, expiration_hours 
                FROM stateful_instance_locks 
                WHERE app_type = ? AND instance_name = ?
            ''', (app_type, instance_name))
            row = cursor.fetchone()
            
            if row:
                return {
                    "created_at": row[0],
                    "expires_at": row[1],
                    "expiration_hours": row[2]
                }
            return {}
    
    def get_all_instance_lock_info(self) -> Dict[str, Dict[str, Dict[str, Any]]]:
        """Get all instance lock info in one query. Returns {app_type: {instance_name: {created_at, expires_at, expiration_hours}}}"""
        with self.get_connection() as conn:
            cursor = conn.execute('SELECT app_type, instance_name, created_at, expires_at, expiration_hours FROM stateful_instance_locks')
            result = {}
            for row in cursor.fetchall():
                app = row[0]
                inst = row[1]
                if app not in result:
                    result[app] = {}
                result[app][inst] = {
                    "created_at": row[2],
                    "expires_at": row[3],
                    "expiration_hours": row[4]
                }
            return result
    
    def set_instance_lock_info(self, app_type: str, instance_name: str, created_at: int, expires_at: int, expiration_hours: int):
        """Set state management lock information for a specific instance"""
        with self.get_connection() as conn:
            conn.execute('''
                INSERT OR REPLACE INTO stateful_instance_locks 
                (app_type, instance_name, created_at, expires_at, expiration_hours, updated_at)
                VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ''', (app_type, instance_name, created_at, expires_at, expiration_hours))
            conn.commit()
    
    def check_instance_expiration(self, app_type: str, instance_name: str) -> bool:
        """Check if state management has expired for a specific instance"""
        import time
        current_time = int(time.time())
        
        lock_info = self.get_instance_lock_info(app_type, instance_name)
        if not lock_info:
            return False  # No lock info means not expired, just not initialized
        
        expires_at = lock_info.get("expires_at", 0)
        return current_time >= expires_at
    
    def clear_instance_processed_ids(self, app_type: str, instance_name: str):
        """Clear processed IDs for a specific instance"""
        with self.get_connection() as conn:
            conn.execute('''
                DELETE FROM stateful_processed_ids 
                WHERE app_type = ? AND instance_name = ?
            ''', (app_type, instance_name))
            conn.commit()
            logger.info(f"Cleared processed IDs for {app_type}/{instance_name}")
    
    def reset_instance_state_management(self, app_type: str, instance_name: str, expiration_hours: int) -> bool:
        """Reset state management for a specific instance"""
        import time
        try:
            current_time = int(time.time())
            expires_at = current_time + (expiration_hours * 3600)
            
            # Clear processed IDs for this instance
            self.clear_instance_processed_ids(app_type, instance_name)
            
            # Set new lock info for this instance
            self.set_instance_lock_info(app_type, instance_name, current_time, expires_at, expiration_hours)
            
            logger.info(f"Reset state management for {app_type}/{instance_name} with {expiration_hours}h expiration")
            return True
        except Exception as e:
            logger.error(f"Error resetting state management for {app_type}/{instance_name}: {e}")
            return False
    
    def initialize_instance_state_management(self, app_type: str, instance_name: str, expiration_hours: int):
        """Initialize state management for a specific instance if not already initialized"""
        lock_info = self.get_instance_lock_info(app_type, instance_name)
        if not lock_info:
            import time
            current_time = int(time.time())
            expires_at = current_time + (expiration_hours * 3600)
            self.set_instance_lock_info(app_type, instance_name, current_time, expires_at, expiration_hours)
            logger.info(f"Initialized state management for {app_type}/{instance_name} with {expiration_hours}h expiration")

    def migrate_instance_state_management(self, app_type: str, old_instance_name: str, new_instance_name: str) -> bool:
        """Migrate state management data from old instance name to new instance name"""
        try:
            with self.get_connection() as conn:
                # Check if old instance has any state management data
                cursor = conn.execute('''
                    SELECT COUNT(*) FROM stateful_instance_locks 
                    WHERE app_type = ? AND instance_name = ?
                ''', (app_type, old_instance_name))
                has_lock_data = cursor.fetchone()[0] > 0
                
                cursor = conn.execute('''
                    SELECT COUNT(*) FROM stateful_processed_ids 
                    WHERE app_type = ? AND instance_name = ?
                ''', (app_type, old_instance_name))
                has_processed_data = cursor.fetchone()[0] > 0
                
                if not has_lock_data and not has_processed_data:
                    logger.debug(f"No state management data found for {app_type}/{old_instance_name}, skipping migration")
                    return True
                
                # Check if new instance name already has data (avoid overwriting)
                cursor = conn.execute('''
                    SELECT COUNT(*) FROM stateful_instance_locks 
                    WHERE app_type = ? AND instance_name = ?
                ''', (app_type, new_instance_name))
                new_has_lock_data = cursor.fetchone()[0] > 0
                
                cursor = conn.execute('''
                    SELECT COUNT(*) FROM stateful_processed_ids 
                    WHERE app_type = ? AND instance_name = ?
                ''', (app_type, new_instance_name))
                new_has_processed_data = cursor.fetchone()[0] > 0
                
                if new_has_lock_data or new_has_processed_data:
                    logger.warning(f"New instance name {app_type}/{new_instance_name} already has state management data, skipping migration to avoid conflicts")
                    return False
                
                # Migrate lock data
                if has_lock_data:
                    conn.execute('''
                        UPDATE stateful_instance_locks 
                        SET instance_name = ?, updated_at = CURRENT_TIMESTAMP
                        WHERE app_type = ? AND instance_name = ?
                    ''', (new_instance_name, app_type, old_instance_name))
                    logger.info(f"Migrated state management lock data from {app_type}/{old_instance_name} to {app_type}/{new_instance_name}")
                
                # Migrate processed IDs
                if has_processed_data:
                    conn.execute('''
                        UPDATE stateful_processed_ids 
                        SET instance_name = ?
                        WHERE app_type = ? AND instance_name = ?
                    ''', (new_instance_name, app_type, old_instance_name))
                    
                    # Get count of migrated IDs for logging
                    cursor = conn.execute('''
                        SELECT COUNT(*) FROM stateful_processed_ids 
                        WHERE app_type = ? AND instance_name = ?
                    ''', (app_type, new_instance_name))
                    migrated_count = cursor.fetchone()[0]
                    
                    logger.info(f"Migrated {migrated_count} processed IDs from {app_type}/{old_instance_name} to {app_type}/{new_instance_name}")
                
                # Also migrate hunt history data if it exists
                cursor = conn.execute('''
                    SELECT COUNT(*) FROM hunt_history 
                    WHERE app_type = ? AND instance_name = ?
                ''', (app_type, old_instance_name))
                has_history_data = cursor.fetchone()[0] > 0
                
                if has_history_data:
                    conn.execute('''
                        UPDATE hunt_history 
                        SET instance_name = ?
                        WHERE app_type = ? AND instance_name = ?
                    ''', (new_instance_name, app_type, old_instance_name))
                    
                    cursor = conn.execute('''
                        SELECT COUNT(*) FROM hunt_history 
                        WHERE app_type = ? AND instance_name = ?
                    ''', (app_type, new_instance_name))
                    migrated_history_count = cursor.fetchone()[0]
                    
                    logger.info(f"Migrated {migrated_history_count} hunt history entries from {app_type}/{old_instance_name} to {app_type}/{new_instance_name}")
                
                conn.commit()
                logger.info(f"Successfully completed state management migration from {app_type}/{old_instance_name} to {app_type}/{new_instance_name}")
                return True
                
        except Exception as e:
            logger.error(f"Error migrating state management data from {app_type}/{old_instance_name} to {app_type}/{new_instance_name}: {e}")
            return False

    def migrate_instance_identifier(self, app_type: str, old_instance_name: str, new_instance_id: str) -> bool:
        """
        Migrate all per-instance data from old identifier (name) to new stable instance_id.
        Call when assigning instance_id to an instance for the first time (e.g. legacy instance).
        Updates: sleep_data_per_instance, hourly_caps_per_instance, reset_requests_per_instance,
                 media_stats_per_instance, plus stateful/hunt_history via migrate_instance_state_management.
        """
        if not old_instance_name or not new_instance_id or old_instance_name == new_instance_id:
            return True
        try:
            with self.get_connection() as conn:
                tables_keyed = [
                    ("sleep_data_per_instance", "instance_name"),
                    ("hourly_caps_per_instance", "instance_name"),
                    ("reset_requests_per_instance", "instance_name"),
                    ("media_stats_per_instance", "instance_name"),
                ]
                for table, col in tables_keyed:
                    try:
                        cursor = conn.execute(
                            f"UPDATE {table} SET {col} = ? WHERE app_type = ? AND {col} = ?",
                            (new_instance_id, app_type, old_instance_name)
                        )
                        if cursor.rowcount > 0:
                            logger.info(f"Migrated {table} from {app_type}/{old_instance_name} to {new_instance_id} ({cursor.rowcount} rows)")
                    except Exception as e:
                        logger.warning(f"Migration {table} for {app_type}: {e}")
                conn.commit()
            self.migrate_instance_state_management(app_type, old_instance_name, new_instance_id)
            return True
        except Exception as e:
            logger.error(f"Error migrating instance identifier {app_type}/{old_instance_name} to {new_instance_id}: {e}")
            return False

    # Tally Data Management Methods
    
    def get_media_stats(self, app_type: str = None) -> Dict[str, Any]:
        """Get media statistics for an app or all apps"""
        with self.get_connection() as conn:
            if app_type:
                cursor = conn.execute(
                    'SELECT stat_type, stat_value FROM media_stats WHERE app_type = ?',
                    (app_type,)
                )
                return {row[0]: row[1] for row in cursor.fetchall()}
            else:
                cursor = conn.execute('SELECT app_type, stat_type, stat_value FROM media_stats')
                stats = {}
                for app, stat_type, value in cursor.fetchall():
                    if app not in stats:
                        stats[app] = {}
                    stats[app][stat_type] = value
                return stats
    
    def set_media_stat(self, app_type: str, stat_type: str, value: int):
        """Set a media statistic value"""
        with self.get_connection() as conn:
            conn.execute('''
                INSERT OR REPLACE INTO media_stats (app_type, stat_type, stat_value, updated_at)
                VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            ''', (app_type, stat_type, value))
            conn.commit()
    
    def increment_media_stat(self, app_type: str, stat_type: str, increment: int = 1):
        """Increment a media statistic"""
        with self.get_connection() as conn:
            conn.execute('''
                INSERT OR REPLACE INTO media_stats (app_type, stat_type, stat_value, updated_at)
                VALUES (?, ?, COALESCE((SELECT stat_value FROM media_stats WHERE app_type = ? AND stat_type = ?), 0) + ?, CURRENT_TIMESTAMP)
            ''', (app_type, stat_type, app_type, stat_type, increment))
            conn.commit()

    def get_media_stats_per_instance(self, app_type: str = None):
        """Get per-instance stats: for one app returns list of {instance_name, hunted, upgraded}; keys normalized to match settings."""
        with self.get_connection() as conn:
            if app_type:
                cursor = conn.execute(
                    'SELECT instance_name, stat_type, stat_value FROM media_stats_per_instance WHERE app_type = ?',
                    (app_type,)
                )
                by_instance = {}
                for row_name, stat_type, value in cursor.fetchall():
                    key = self._normalize_instance_key(row_name)
                    if key not in by_instance:
                        by_instance[key] = {"hunted": 0, "upgraded": 0}
                    by_instance[key][stat_type] = by_instance[key].get(stat_type, 0) + value
                return [{"instance_name": k, "hunted": v["hunted"], "upgraded": v["upgraded"]} for k, v in by_instance.items()]
            cursor = conn.execute('SELECT app_type, instance_name, stat_type, stat_value FROM media_stats_per_instance')
            stats = {}
            for app, row_name, stat_type, value in cursor.fetchall():
                key = self._normalize_instance_key(row_name)
                if app not in stats:
                    stats[app] = {}
                if key not in stats[app]:
                    stats[app][key] = {"hunted": 0, "upgraded": 0}
                stats[app][key][stat_type] = stats[app][key].get(stat_type, 0) + value
            result = {}
            for app, by_inst in stats.items():
                result[app] = [{"instance_name": k, "hunted": v["hunted"], "upgraded": v["upgraded"]} for k, v in by_inst.items()]
            return result

    def increment_media_stat_per_instance(self, app_type: str, instance_name: str, stat_type: str, increment: int = 1):
        """Increment a per-instance media statistic. Instance name normalized so keys match get_stats/API."""
        if not instance_name:
            return
        key = self._normalize_instance_key(instance_name)
        with self.get_connection() as conn:
            conn.execute('''
                INSERT OR REPLACE INTO media_stats_per_instance (app_type, instance_name, stat_type, stat_value, updated_at)
                VALUES (?, ?, ?, COALESCE((SELECT stat_value FROM media_stats_per_instance WHERE app_type = ? AND instance_name = ? AND stat_type = ?), 0) + ?, CURRENT_TIMESTAMP)
            ''', (app_type, key, stat_type, app_type, key, stat_type, increment))
            conn.commit()

    def reset_media_stats_per_instance(self, app_type: str, instance_name: str = None):
        """Reset per-instance stats for an app (or one instance if instance_name given). Instance name normalized."""
        with self.get_connection() as conn:
            if instance_name:
                key = self._normalize_instance_key(instance_name)
                cursor = conn.execute('SELECT DISTINCT instance_name FROM media_stats_per_instance WHERE app_type = ?', (app_type,))
                for (row_name,) in cursor.fetchall():
                    if self._normalize_instance_key(row_name) == key:
                        conn.execute('DELETE FROM media_stats_per_instance WHERE app_type = ? AND instance_name = ?', (app_type, row_name))
            else:
                conn.execute('DELETE FROM media_stats_per_instance WHERE app_type = ?', (app_type,))
            conn.commit()
    
    def get_hourly_caps(self) -> Dict[str, Dict[str, int]]:
        """Get hourly API caps for all apps"""
        with self.get_connection() as conn:
            cursor = conn.execute('SELECT app_type, api_hits, last_reset_hour FROM hourly_caps')
            return {
                row[0]: {"api_hits": row[1], "last_reset_hour": row[2]}
                for row in cursor.fetchall()
            }
    
    def set_hourly_cap(self, app_type: str, api_hits: int, last_reset_hour: int = None):
        """Set hourly API cap data for an app"""
        if last_reset_hour is None:
            import datetime
            last_reset_hour = datetime.datetime.now().hour
        
        with self.get_connection() as conn:
            conn.execute('''
                INSERT OR REPLACE INTO hourly_caps (app_type, api_hits, last_reset_hour, updated_at)
                VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            ''', (app_type, api_hits, last_reset_hour))
            conn.commit()
    
    def increment_hourly_cap(self, app_type: str, increment: int = 1):
        """Increment hourly API usage for an app"""
        import datetime
        with self.get_connection() as conn:
            conn.execute('''
                INSERT OR REPLACE INTO hourly_caps (app_type, api_hits, last_reset_hour, updated_at)
                VALUES (?, COALESCE((SELECT api_hits FROM hourly_caps WHERE app_type = ?), 0) + ?, 
                        COALESCE((SELECT last_reset_hour FROM hourly_caps WHERE app_type = ?), ?), CURRENT_TIMESTAMP)
            ''', (app_type, app_type, increment, app_type, datetime.datetime.now().hour))
            conn.commit()
    
    def reset_hourly_caps(self):
        """Reset all hourly API caps (app-level and per-instance)"""
        import datetime
        current_hour = datetime.datetime.now().hour
        with self.get_connection() as conn:
            conn.execute('''
                UPDATE hourly_caps SET api_hits = 0, last_reset_hour = ?, updated_at = CURRENT_TIMESTAMP
            ''', (current_hour,))
            conn.execute('''
                UPDATE hourly_caps_per_instance SET api_hits = 0, last_reset_hour = ?, updated_at = CURRENT_TIMESTAMP
            ''', (current_hour,))
            conn.commit()
    
    def _normalize_instance_key(self, name: Any) -> str:
        """Normalize instance name for consistent keys (matches stats_manager and API)."""
        if name is None or not isinstance(name, str):
            return "Default"
        s = (name or "").strip()
        return s if s else "Default"

    def get_hourly_caps_per_instance(self, app_type: str = None) -> Dict[str, Dict[str, Dict[str, int]]]:
        """Get per-instance API usage. Returns { app_type: { instance_name: { api_hits, last_reset_hour } } } or for one app. Keys normalized so read matches write."""
        with self.get_connection() as conn:
            if app_type:
                cursor = conn.execute('''
                    SELECT instance_name, api_hits, last_reset_hour FROM hourly_caps_per_instance WHERE app_type = ?
                ''', (app_type,))
                out = {}
                for row in cursor.fetchall():
                    key = self._normalize_instance_key(row[0])
                    existing = out.get(key, {"api_hits": 0, "last_reset_hour": row[2]})
                    out[key] = {"api_hits": existing["api_hits"] + row[1], "last_reset_hour": row[2]}
                return out
            cursor = conn.execute('SELECT app_type, instance_name, api_hits, last_reset_hour FROM hourly_caps_per_instance')
            result = {}
            for row in cursor.fetchall():
                at, iname = row[0], self._normalize_instance_key(row[1])
                if at not in result:
                    result[at] = {}
                if iname not in result[at]:
                    result[at][iname] = {"api_hits": 0, "last_reset_hour": row[3]}
                result[at][iname]["api_hits"] += row[2]
            return result
    
    def increment_hourly_cap_per_instance(self, app_type: str, instance_name: str, increment: int = 1):
        """Increment hourly API usage for an instance (resets if new hour). Instance name normalized for consistent keys.
        Uses atomic INSERT OR REPLACE to avoid read-then-write race conditions."""
        import datetime
        # Normalize so write key matches read key (from settings) and counts persist across refresh
        key = (instance_name or "Default").strip() if isinstance(instance_name, str) else "Default"
        key = key if key else "Default"
        current_hour = datetime.datetime.now().hour
        with self.get_connection() as conn:
            # Atomic upsert: if row exists and same hour, add increment; if different hour or missing, start fresh
            conn.execute('''
                INSERT INTO hourly_caps_per_instance (app_type, instance_name, api_hits, last_reset_hour, updated_at)
                VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(app_type, instance_name) DO UPDATE SET
                    api_hits = CASE WHEN last_reset_hour = ? THEN api_hits + ? ELSE ? END,
                    last_reset_hour = ?,
                    updated_at = CURRENT_TIMESTAMP
            ''', (app_type, key, increment, current_hour,
                  current_hour, increment, increment, current_hour))
            conn.commit()

    def get_sleep_data(self, app_type: str = None) -> Dict[str, Any]:
        """Get sleep/cycle data for an app or all apps"""
        with self.get_connection() as conn:
            if app_type:
                cursor = conn.execute('''
                    SELECT next_cycle_time, cycle_lock, last_cycle_start, last_cycle_end 
                    FROM sleep_data WHERE app_type = ?
                ''', (app_type,))
                row = cursor.fetchone()
                if row:
                    return {
                        "next_cycle_time": row[0],
                        "cycle_lock": bool(row[1]),
                        "last_cycle_start": row[2],
                        "last_cycle_end": row[3]
                    }
                return {}
            else:
                cursor = conn.execute('''
                    SELECT app_type, next_cycle_time, cycle_lock, last_cycle_start, last_cycle_end 
                    FROM sleep_data
                ''')
                return {
                    row[0]: {
                        "next_cycle_time": row[1],
                        "cycle_lock": bool(row[2]),
                        "last_cycle_start": row[3],
                        "last_cycle_end": row[4]
                    }
                    for row in cursor.fetchall()
                }
    
    def set_sleep_data(self, app_type: str, next_cycle_time: str = None, cycle_lock: bool = None, 
                       last_cycle_start: str = None, last_cycle_end: str = None):
        """Set sleep/cycle data for an app"""
        with self.get_connection() as conn:
            # Get current data
            cursor = conn.execute('''
                SELECT next_cycle_time, cycle_lock, last_cycle_start, last_cycle_end 
                FROM sleep_data WHERE app_type = ?
            ''', (app_type,))
            row = cursor.fetchone()
            
            if row:
                # Update existing record with only provided values
                current_next = row[0] if next_cycle_time is None else next_cycle_time
                current_lock = row[1] if cycle_lock is None else cycle_lock
                current_start = row[2] if last_cycle_start is None else last_cycle_start
                current_end = row[3] if last_cycle_end is None else last_cycle_end
                
                conn.execute('''
                    UPDATE sleep_data 
                    SET next_cycle_time = ?, cycle_lock = ?, last_cycle_start = ?, last_cycle_end = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE app_type = ?
                ''', (current_next, current_lock, current_start, current_end, app_type))
            else:
                # Insert new record
                conn.execute('''
                    INSERT INTO sleep_data (app_type, next_cycle_time, cycle_lock, last_cycle_start, last_cycle_end, updated_at)
                    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ''', (app_type, next_cycle_time, cycle_lock, last_cycle_start, last_cycle_end))
            
            conn.commit()
    
    def get_sleep_data_per_instance(self, app_type: str, instance_name: str = None) -> Dict[str, Any]:
        """Get sleep/cycle data for an instance or all instances of an app"""
        with self.get_connection() as conn:
            if instance_name is not None:
                cursor = conn.execute('''
                    SELECT next_cycle_time, cycle_lock, last_cycle_start, last_cycle_end 
                    FROM sleep_data_per_instance WHERE app_type = ? AND instance_name = ?
                ''', (app_type, instance_name))
                row = cursor.fetchone()
                if row:
                    return {
                        "next_cycle_time": row[0],
                        "cycle_lock": bool(row[1]),
                        "last_cycle_start": row[2],
                        "last_cycle_end": row[3]
                    }
                return {}
            else:
                cursor = conn.execute('''
                    SELECT instance_name, next_cycle_time, cycle_lock, last_cycle_start, last_cycle_end 
                    FROM sleep_data_per_instance WHERE app_type = ?
                ''', (app_type,))
                return {
                    row[0]: {
                        "next_cycle_time": row[1],
                        "cycle_lock": bool(row[2]),
                        "last_cycle_start": row[3],
                        "last_cycle_end": row[4]
                    }
                    for row in cursor.fetchall()
                }
    
    def set_sleep_data_per_instance(self, app_type: str, instance_name: str, next_cycle_time: str = None,
                                    cycle_lock: bool = None, last_cycle_start: str = None, last_cycle_end: str = None):
        """Set sleep/cycle data for an instance"""
        with self.get_connection() as conn:
            cursor = conn.execute('''
                SELECT next_cycle_time, cycle_lock, last_cycle_start, last_cycle_end 
                FROM sleep_data_per_instance WHERE app_type = ? AND instance_name = ?
            ''', (app_type, instance_name))
            row = cursor.fetchone()
            if row:
                current_next = row[0] if next_cycle_time is None else next_cycle_time
                current_lock = row[1] if cycle_lock is None else cycle_lock
                current_start = row[2] if last_cycle_start is None else last_cycle_start
                current_end = row[3] if last_cycle_end is None else last_cycle_end
                conn.execute('''
                    UPDATE sleep_data_per_instance 
                    SET next_cycle_time = ?, cycle_lock = ?, last_cycle_start = ?, last_cycle_end = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE app_type = ? AND instance_name = ?
                ''', (current_next, current_lock, current_start, current_end, app_type, instance_name))
            else:
                conn.execute('''
                    INSERT INTO sleep_data_per_instance (app_type, instance_name, next_cycle_time, cycle_lock, last_cycle_start, last_cycle_end, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ''', (app_type, instance_name, next_cycle_time, cycle_lock, last_cycle_start, last_cycle_end))
            conn.commit()
    
    def get_all_sleep_data_per_instance(self) -> Dict[str, Dict[str, Dict[str, Any]]]:
        """Get sleep/cycle data for all instances (all apps). Returns { app_type: { instance_name: data } }."""
        with self.get_connection() as conn:
            cursor = conn.execute('''
                SELECT app_type, instance_name, next_cycle_time, cycle_lock, last_cycle_start, last_cycle_end
                FROM sleep_data_per_instance
            ''')
            result = {}
            for row in cursor.fetchall():
                app_type, instance_name = row[0], row[1]
                if app_type not in result:
                    result[app_type] = {}
                result[app_type][instance_name] = {
                    "next_cycle_time": row[2],
                    "cycle_lock": bool(row[3]),
                    "last_cycle_start": row[4],
                    "last_cycle_end": row[5]
                }
            return result
    
    def get_swaparr_stats(self) -> Dict[str, int]:
        """Get Swaparr statistics"""
        with self.get_connection() as conn:
            cursor = conn.execute('SELECT stat_key, stat_value FROM swaparr_stats')
            return {row[0]: row[1] for row in cursor.fetchall()}
    
    def set_swaparr_stat(self, stat_key: str, value: int):
        """Set a Swaparr statistic value"""
        with self.get_connection() as conn:
            conn.execute('''
                INSERT OR REPLACE INTO swaparr_stats (stat_key, stat_value, updated_at)
                VALUES (?, ?, CURRENT_TIMESTAMP)
            ''', (stat_key, value))
            conn.commit()
    
    def increment_swaparr_stat(self, stat_key: str, increment: int = 1):
        """Increment a Swaparr statistic"""
        with self.get_connection() as conn:
            conn.execute('''
                INSERT OR REPLACE INTO swaparr_stats (stat_key, stat_value, updated_at)
                VALUES (?, COALESCE((SELECT stat_value FROM swaparr_stats WHERE stat_key = ?), 0) + ?, CURRENT_TIMESTAMP)
            ''', (stat_key, stat_key, increment))
            conn.commit()

    # History methods moved to manager_database.py - Hunt Manager functionality

    # Scheduler methods
    def get_schedules(self, app_type: str = None) -> Dict[str, List[Dict[str, Any]]]:
        """Get all schedules, optionally filtered by app type"""
        with self.get_connection() as conn:
            conn.row_factory = sqlite3.Row
            
            if app_type:
                cursor = conn.execute('''
                    SELECT * FROM schedules 
                    WHERE app_type = ? 
                    ORDER BY time_hour, time_minute
                ''', (app_type,))
            else:
                cursor = conn.execute('''
                    SELECT * FROM schedules 
                    ORDER BY app_type, time_hour, time_minute
                ''')
            
            schedules = {}
            for row in cursor.fetchall():
                schedule_data = {
                    'id': row['id'],
                    'action': row['action'],
                    'time': f"{row['time_hour']:02d}:{row['time_minute']:02d}",
                    'days': json.loads(row['days']) if row['days'] else [],
                    'app': row['app_instance'],
                    'appType': row['app_type'],
                    'enabled': bool(row['enabled'])
                }
                
                if row['app_type'] not in schedules:
                    schedules[row['app_type']] = []
                schedules[row['app_type']].append(schedule_data)
            
            # Ensure all app types are present even if empty
            for app in ['global', 'sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros', 'movie_hunt', 'tv_hunt']:
                if app not in schedules:
                    schedules[app] = []
            
            return schedules
    
    def save_schedules(self, schedules_data: Dict[str, List[Dict[str, Any]]]):
        """Save all schedules to database (replaces existing schedules)"""
        with self.get_connection() as conn:
            # Clear existing schedules
            conn.execute('DELETE FROM schedules')
            
            # Insert new schedules
            for app_type, schedules_list in schedules_data.items():
                for schedule in schedules_list:
                    # Parse time
                    time_str = schedule.get('time', '00:00')
                    if isinstance(time_str, dict):
                        time_hour = time_str.get('hour', 0)
                        time_minute = time_str.get('minute', 0)
                    else:
                        try:
                            time_parts = str(time_str).split(':')
                            time_hour = int(time_parts[0])
                            time_minute = int(time_parts[1]) if len(time_parts) > 1 else 0
                        except (ValueError, IndexError):
                            time_hour = 0
                            time_minute = 0
                    
                    # Convert days to JSON string
                    days_json = json.dumps(schedule.get('days', []))
                    
                    conn.execute('''
                        INSERT INTO schedules 
                        (id, app_type, action, time_hour, time_minute, days, app_instance, enabled, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                    ''', (
                        schedule.get('id', f"{app_type}_{int(datetime.now().timestamp())}"),
                        app_type,
                        schedule.get('action', 'pause'),
                        time_hour,
                        time_minute,
                        days_json,
                        schedule.get('app', 'global'),
                        schedule.get('enabled', True)
                    ))
            
            conn.commit()
            # Schedules saved - no need to log every successful save
    
    def add_schedule(self, schedule_data: Dict[str, Any]) -> str:
        """Add a single schedule to database"""
        schedule_id = schedule_data.get('id', f"{schedule_data.get('appType', 'global')}_{int(datetime.now().timestamp())}")
        
        # Parse time
        time_str = schedule_data.get('time', '00:00')
        if isinstance(time_str, dict):
            time_hour = time_str.get('hour', 0)
            time_minute = time_str.get('minute', 0)
        else:
            try:
                time_parts = str(time_str).split(':')
                time_hour = int(time_parts[0])
                time_minute = int(time_parts[1]) if len(time_parts) > 1 else 0
            except (ValueError, IndexError):
                time_hour = 0
                time_minute = 0
        
        # Convert days to JSON string
        days_json = json.dumps(schedule_data.get('days', []))
        
        with self.get_connection() as conn:
            conn.execute('''
                INSERT OR REPLACE INTO schedules 
                (id, app_type, action, time_hour, time_minute, days, app_instance, enabled, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ''', (
                schedule_id,
                schedule_data.get('appType', 'global'),
                schedule_data.get('action', 'pause'),
                time_hour,
                time_minute,
                days_json,
                schedule_data.get('app', 'global'),
                schedule_data.get('enabled', True)
            ))
            conn.commit()
            
        logger.info(f"Added/updated schedule {schedule_id}")
        return schedule_id
    
    def delete_schedule(self, schedule_id: str):
        """Delete a schedule from database"""
        with self.get_connection() as conn:
            cursor = conn.execute('DELETE FROM schedules WHERE id = ?', (schedule_id,))
            conn.commit()
            
            if cursor.rowcount > 0:
                logger.info(f"Deleted schedule {schedule_id}")
            else:
                logger.warning(f"Schedule {schedule_id} not found for deletion")
    
    def update_schedule_enabled(self, schedule_id: str, enabled: bool):
        """Update the enabled status of a schedule"""
        with self.get_connection() as conn:
            cursor = conn.execute('''
                UPDATE schedules 
                SET enabled = ?, updated_at = CURRENT_TIMESTAMP 
                WHERE id = ?
            ''', (enabled, schedule_id))
            conn.commit()
            
            if cursor.rowcount > 0:
                logger.info(f"Updated schedule {schedule_id} enabled status to {enabled}")
            else:
                logger.warning(f"Schedule {schedule_id} not found for update")

    # State Management Methods
    def get_state_data(self, app_type: str, state_type: str) -> Any:
        """Get state data for a specific app type and state type"""
        with self.get_connection() as conn:
            cursor = conn.execute(
                'SELECT state_data FROM state_data WHERE app_type = ? AND state_type = ?',
                (app_type, state_type)
            )
            row = cursor.fetchone()
            
            if row:
                try:
                    return json.loads(row[0])
                except json.JSONDecodeError as e:
                    logger.error(f"Failed to parse state data for {app_type}/{state_type}: {e}")
                    return None
            return None

    def set_state_data(self, app_type: str, state_type: str, data: Any):
        """Set state data for a specific app type and state type"""
        data_json = json.dumps(data)
        with self.get_connection() as conn:
            conn.execute(
                '''INSERT OR REPLACE INTO state_data 
                   (app_type, state_type, state_data, updated_at) 
                   VALUES (?, ?, ?, CURRENT_TIMESTAMP)''',
                (app_type, state_type, data_json)
            )
            conn.commit()
            logger.debug(f"Set state data for {app_type}/{state_type}")

    def get_processed_ids_state(self, app_type: str, state_type: str) -> List[int]:
        """Get processed IDs for a specific app type and state type (missing/upgrades)"""
        data = self.get_state_data(app_type, state_type)
        if data is None:
            return []
        if isinstance(data, list):
            return data
        logger.error(f"Invalid processed IDs data type for {app_type}/{state_type}: {type(data)}")
        return []

    def set_processed_ids_state(self, app_type: str, state_type: str, ids: List[int]):
        """Set processed IDs for a specific app type and state type (missing/upgrades)"""
        self.set_state_data(app_type, state_type, ids)

    def add_processed_id_state(self, app_type: str, state_type: str, item_id: int):
        """Add a single processed ID to a specific app type and state type"""
        processed_ids = self.get_processed_ids_state(app_type, state_type)
        if item_id not in processed_ids:
            processed_ids.append(item_id)
            self.set_processed_ids_state(app_type, state_type, processed_ids)

    def clear_processed_ids_state(self, app_type: str):
        """Clear all processed IDs for a specific app type"""
        self.set_processed_ids_state(app_type, "processed_missing", [])
        self.set_processed_ids_state(app_type, "processed_upgrades", [])

    def get_last_reset_time_state(self, app_type: str) -> Optional[str]:
        """Get the last reset time for a specific app type"""
        return self.get_state_data(app_type, "last_reset")

    def set_last_reset_time_state(self, app_type: str, reset_time: str):
        """Set the last reset time for a specific app type"""
        self.set_state_data(app_type, "last_reset", reset_time)

    # Swaparr State Management Methods
    def get_swaparr_state_data(self, app_name: str, state_type: str) -> Any:
        """Get Swaparr state data for a specific app name and state type"""
        with self.get_connection() as conn:
            cursor = conn.execute(
                'SELECT state_data FROM swaparr_state WHERE app_name = ? AND state_type = ?',
                (app_name, state_type)
            )
            row = cursor.fetchone()
            
            if row:
                try:
                    return json.loads(row[0])
                except json.JSONDecodeError as e:
                    logger.error(f"Failed to parse Swaparr state data for {app_name}/{state_type}: {e}")
                    return None
            return None

    def set_swaparr_state_data(self, app_name: str, state_type: str, data: Any):
        """Set Swaparr state data for a specific app name and state type"""
        data_json = json.dumps(data)
        with self.get_connection() as conn:
            conn.execute(
                '''INSERT OR REPLACE INTO swaparr_state 
                   (app_name, state_type, state_data, updated_at) 
                   VALUES (?, ?, ?, CURRENT_TIMESTAMP)''',
                (app_name, state_type, data_json)
            )
            conn.commit()
            logger.debug(f"Set Swaparr state data for {app_name}/{state_type}")

    def get_swaparr_strike_data(self, app_name: str) -> Dict[str, Any]:
        """Get strike data for a specific Swaparr app"""
        data = self.get_swaparr_state_data(app_name, "strikes")
        return data if data is not None else {}

    def set_swaparr_strike_data(self, app_name: str, strike_data: Dict[str, Any]):
        """Set strike data for a specific Swaparr app"""
        self.set_swaparr_state_data(app_name, "strikes", strike_data)

    def get_swaparr_removed_items(self, app_name: str) -> Dict[str, Any]:
        """Get removed items data for a specific Swaparr app"""
        data = self.get_swaparr_state_data(app_name, "removed_items")
        return data if data is not None else {}
    
    def set_swaparr_removed_items(self, app_name: str, removed_items: Dict[str, Any]):
        """Set removed items data for a specific Swaparr app"""
        self.set_swaparr_state_data(app_name, "removed_items", removed_items)

    # Reset Request Management Methods (replaces file-based reset system)
    
    def create_reset_request(self, app_type: str, instance_name: Optional[str] = None) -> bool:
        """Create a reset request for an app or (app, instance). instance_name=None for swaparr/single-app."""
        try:
            with self.get_connection() as conn:
                ts = int(time.time())
                if instance_name is not None:
                    conn.execute('''
                        INSERT INTO reset_requests_per_instance (app_type, instance_name, timestamp, processed)
                        VALUES (?, ?, ?, 0)
                    ''', (app_type, instance_name, ts))
                else:
                    conn.execute('''
                        INSERT OR REPLACE INTO reset_requests (app_type, timestamp, processed)
                        VALUES (?, ?, 0)
                    ''', (app_type, ts))
                conn.commit()
                logger.info(f"Created reset request for {app_type}" + (f" instance {instance_name}" if instance_name else ""))
                return True
        except Exception as e:
            logger.error(f"Error creating reset request for {app_type}: {e}")
            return False
    
    def get_pending_reset_request(self, app_type: str, instance_name: Optional[str] = None) -> Optional[int]:
        """Check if there's a pending reset request for an app or (app, instance). instance_name=None for swaparr."""
        with self.get_connection() as conn:
            if instance_name is not None:
                cursor = conn.execute('''
                    SELECT timestamp FROM reset_requests_per_instance 
                    WHERE app_type = ? AND instance_name = ? AND processed = 0
                    ORDER BY timestamp DESC LIMIT 1
                ''', (app_type, instance_name))
            else:
                cursor = conn.execute('''
                    SELECT timestamp FROM reset_requests 
                    WHERE app_type = ? AND processed = 0
                    ORDER BY timestamp DESC LIMIT 1
                ''', (app_type,))
            row = cursor.fetchone()
            return row[0] if row else None
    
    def mark_reset_request_processed(self, app_type: str, instance_name: Optional[str] = None) -> bool:
        """Mark a reset request as processed. instance_name=None for swaparr."""
        try:
            with self.get_connection() as conn:
                if instance_name is not None:
                    conn.execute('''
                        UPDATE reset_requests_per_instance 
                        SET processed = 1, processed_at = CURRENT_TIMESTAMP
                        WHERE app_type = ? AND instance_name = ? AND processed = 0
                    ''', (app_type, instance_name))
                else:
                    conn.execute('''
                        UPDATE reset_requests 
                        SET processed = 1, processed_at = CURRENT_TIMESTAMP
                        WHERE app_type = ? AND processed = 0
                    ''', (app_type,))
                conn.commit()
                logger.info(f"Marked reset request as processed for {app_type}" + (f" instance {instance_name}" if instance_name else ""))
                return True
        except Exception as e:
            logger.error(f"Error marking reset request as processed for {app_type}: {e}")
            return False
