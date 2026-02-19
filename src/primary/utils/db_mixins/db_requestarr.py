"""Auto-extracted database mixin — see db_mixins/__init__.py"""
import json
import sqlite3
import time
import logging
from typing import Dict, List, Any, Optional, Set
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

class RequestarrMixin:
    """Requestarr services, requests, global blacklist, hidden media."""

    def get_requestarr_services(self, service_type: str = None) -> list:
        """Get requestarr services, optionally filtered by type (movies/tv)."""
        with self.get_connection() as conn:
            conn.row_factory = sqlite3.Row
            if service_type:
                rows = conn.execute(
                    'SELECT * FROM requestarr_services WHERE service_type = ? ORDER BY created_at ASC',
                    (service_type,)
                ).fetchall()
            else:
                rows = conn.execute('SELECT * FROM requestarr_services ORDER BY service_type, created_at ASC').fetchall()
            return [dict(r) for r in rows]

    def add_requestarr_service(self, service_type: str, app_type: str, instance_name: str,
                               instance_id: int = None, is_default: bool = False, is_4k: bool = False) -> bool:
        """Add an instance as a requestarr service. First in a section auto-becomes default. Only one default per service_type."""
        try:
            with self.get_connection() as conn:
                # If no services exist yet for this type, force default
                count = conn.execute(
                    'SELECT COUNT(*) FROM requestarr_services WHERE service_type = ?', (service_type,)
                ).fetchone()[0]
                if count == 0:
                    is_default = True
                # If marking as default, clear other defaults in the same service_type
                if is_default:
                    conn.execute(
                        'UPDATE requestarr_services SET is_default = 0, updated_at = CURRENT_TIMESTAMP WHERE service_type = ?',
                        (service_type,)
                    )
                conn.execute('''
                    INSERT OR REPLACE INTO requestarr_services
                    (service_type, app_type, instance_name, instance_id, is_default, is_4k, enabled, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                ''', (service_type, app_type, instance_name, instance_id, int(is_default), int(is_4k)))
                conn.commit()
                return True
        except Exception as e:
            logger.error(f"Error adding requestarr service: {e}")
            return False

    def remove_requestarr_service(self, service_id: int) -> bool:
        """Remove a requestarr service by ID."""
        try:
            with self.get_connection() as conn:
                conn.execute('DELETE FROM requestarr_services WHERE id = ?', (service_id,))
                conn.commit()
                return True
        except Exception as e:
            logger.error(f"Error removing requestarr service: {e}")
            return False

    def update_requestarr_service(self, service_id: int, updates: Dict[str, Any]) -> bool:
        """Update a requestarr service. Only one default per service_type."""
        try:
            allowed = {'is_default', 'is_4k', 'enabled'}
            filtered = {k: v for k, v in updates.items() if k in allowed}
            if not filtered:
                return True
            with self.get_connection() as conn:
                # If setting as default, clear other defaults in the same service_type first
                if filtered.get('is_default') and int(filtered['is_default']):
                    row = conn.execute('SELECT service_type FROM requestarr_services WHERE id = ?', (service_id,)).fetchone()
                    if row:
                        conn.execute(
                            'UPDATE requestarr_services SET is_default = 0, updated_at = CURRENT_TIMESTAMP WHERE service_type = ? AND id != ?',
                            (row['service_type'], service_id)
                        )
                set_parts = [f'{k} = ?' for k in filtered]
                set_parts.append('updated_at = CURRENT_TIMESTAMP')
                values = list(filtered.values()) + [service_id]
                sql = f"UPDATE requestarr_services SET {', '.join(set_parts)} WHERE id = ?"
                conn.execute(sql, values)
                conn.commit()
                return True
        except Exception as e:
            logger.error(f"Error updating requestarr service: {e}")
            return False

    # ── (end requestarr user/service methods) ────────────────────

    # ── Requestarr Request Tracking Methods ──────────────────────

    def create_requestarr_request(self, user_id: int, username: str, media_type: str,
                                   tmdb_id: int, title: str, year: str = None,
                                   poster_path: str = None, tvdb_id: int = None,
                                   instance_name: str = None, status: str = 'pending') -> Optional[int]:
        """Create a new media request. Returns the request ID or None."""
        try:
            with self.get_connection() as conn:
                cursor = conn.execute('''
                    INSERT INTO requestarr_requests
                    (user_id, username, media_type, tmdb_id, tvdb_id, title, year, poster_path, status, instance_name, requested_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ''', (user_id, username, media_type, tmdb_id, tvdb_id, title, year, poster_path, status, instance_name))
                conn.commit()
                return cursor.lastrowid
        except Exception as e:
            logger.error(f"Error creating requestarr request: {e}")
            return None

    def get_requestarr_requests(self, status: str = None, user_id: int = None,
                                 media_type: str = None, limit: int = 100, offset: int = 0) -> list:
        """Get requests with optional filters. Excludes old media-tracking rows."""
        try:
            with self.get_connection() as conn:
                conn.row_factory = sqlite3.Row
                # username != '' excludes legacy media-tracking rows that share this table
                conditions = ["username != ''"]
                params = []
                if status:
                    conditions.append('status = ?')
                    params.append(status)
                if user_id:
                    conditions.append('user_id = ?')
                    params.append(user_id)
                if media_type:
                    conditions.append('media_type = ?')
                    params.append(media_type)
                where = ' WHERE ' + ' AND '.join(conditions)
                params.extend([limit, offset])
                rows = conn.execute(
                    f'SELECT * FROM requestarr_requests{where} ORDER BY requested_at DESC LIMIT ? OFFSET ?',
                    params
                ).fetchall()
                return [dict(r) for r in rows]
        except Exception as e:
            logger.error(f"Error getting requestarr requests: {e}")
            return []

    def get_requestarr_request_by_id(self, request_id: int) -> Optional[Dict[str, Any]]:
        """Get a single request by ID."""
        try:
            with self.get_connection() as conn:
                conn.row_factory = sqlite3.Row
                row = conn.execute('SELECT * FROM requestarr_requests WHERE id = ?', (request_id,)).fetchone()
                return dict(row) if row else None
        except Exception as e:
            logger.error(f"Error getting requestarr request {request_id}: {e}")
            return None

    def update_requestarr_request_status(self, request_id: int, status: str,
                                          responded_by: str = None, notes: str = None) -> bool:
        """Update a request's status (approve/deny)."""
        try:
            with self.get_connection() as conn:
                conn.execute('''
                    UPDATE requestarr_requests
                    SET status = ?, responded_at = CURRENT_TIMESTAMP, responded_by = ?, notes = ?
                    WHERE id = ?
                ''', (status, responded_by, notes, request_id))
                conn.commit()
                return True
        except Exception as e:
            logger.error(f"Error updating requestarr request {request_id}: {e}")
            return False

    def delete_requestarr_request(self, request_id: int) -> bool:
        """Delete a request."""
        try:
            with self.get_connection() as conn:
                conn.execute('DELETE FROM requestarr_requests WHERE id = ?', (request_id,))
                conn.commit()
                return True
        except Exception as e:
            logger.error(f"Error deleting requestarr request {request_id}: {e}")
            return False

    def get_requestarr_request_count(self, user_id: int = None, status: str = None) -> int:
        """Get count of requests with optional filters. Excludes old media-tracking rows."""
        try:
            with self.get_connection() as conn:
                # username != '' excludes legacy media-tracking rows
                conditions = ["username != ''"]
                params = []
                if user_id:
                    conditions.append('user_id = ?')
                    params.append(user_id)
                if status:
                    conditions.append('status = ?')
                    params.append(status)
                where = ' WHERE ' + ' AND '.join(conditions)
                row = conn.execute(f'SELECT COUNT(*) FROM requestarr_requests{where}', params).fetchone()
                return row[0] if row else 0
        except Exception as e:
            logger.error(f"Error counting requestarr requests: {e}")
            return 0

    def check_existing_request(self, media_type: str, tmdb_id: int) -> Optional[Dict[str, Any]]:
        """Check if a user request already exists for this media item. Excludes old media-tracking rows."""
        try:
            with self.get_connection() as conn:
                conn.row_factory = sqlite3.Row
                row = conn.execute(
                    "SELECT * FROM requestarr_requests WHERE media_type = ? AND tmdb_id = ? AND username != '' ORDER BY requested_at DESC LIMIT 1",
                    (media_type, tmdb_id)
                ).fetchone()
                return dict(row) if row else None
        except Exception as e:
            logger.error(f"Error checking existing request: {e}")
            return None

    def get_requesters_for_media(self, media_type: str, tmdb_id: int) -> list:
        """Get all users who requested a specific media item. Excludes old media-tracking rows."""
        try:
            with self.get_connection() as conn:
                conn.row_factory = sqlite3.Row
                rows = conn.execute(
                    "SELECT DISTINCT username, user_id, status, requested_at FROM requestarr_requests WHERE media_type = ? AND tmdb_id = ? AND username != '' ORDER BY requested_at ASC",
                    (media_type, tmdb_id)
                ).fetchall()
                return [dict(r) for r in rows]
        except Exception as e:
            logger.error(f"Error getting requesters: {e}")
            return []

    # ------------------------------------------------------------------
    # Global Blacklist CRUD
    # ------------------------------------------------------------------

    def add_to_global_blacklist(self, tmdb_id: int, media_type: str, title: str,
                                 year: str = None, poster_path: str = None,
                                 blacklisted_by: str = None, notes: str = None) -> bool:
        """Add media to the global blacklist. No user can request blacklisted media."""
        try:
            with self.get_connection() as conn:
                conn.execute('''
                    INSERT OR REPLACE INTO requestarr_global_blacklist
                    (tmdb_id, media_type, title, year, poster_path, blacklisted_by, blacklisted_at, notes)
                    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
                ''', (tmdb_id, media_type, title, year, poster_path, blacklisted_by, notes))
                conn.commit()
                return True
        except Exception as e:
            logger.error(f"Error adding to global blacklist: {e}")
            return False

    def remove_from_global_blacklist(self, tmdb_id: int, media_type: str) -> bool:
        """Remove media from the global blacklist."""
        try:
            with self.get_connection() as conn:
                conn.execute('DELETE FROM requestarr_global_blacklist WHERE tmdb_id = ? AND media_type = ?',
                             (tmdb_id, media_type))
                conn.commit()
                return True
        except Exception as e:
            logger.error(f"Error removing from global blacklist: {e}")
            return False

    def is_globally_blacklisted(self, tmdb_id: int, media_type: str) -> bool:
        """Check if media is on the global blacklist."""
        try:
            with self.get_connection() as conn:
                row = conn.execute(
                    'SELECT 1 FROM requestarr_global_blacklist WHERE tmdb_id = ? AND media_type = ?',
                    (tmdb_id, media_type)
                ).fetchone()
                return row is not None
        except Exception as e:
            logger.error(f"Error checking global blacklist: {e}")
            return False

    def get_global_blacklist(self, media_type: str = None, page: int = 1, page_size: int = 100) -> Dict[str, Any]:
        """Get paginated global blacklist."""
        try:
            with self.get_connection() as conn:
                conn.row_factory = sqlite3.Row
                conditions = []
                params = []
                if media_type:
                    conditions.append('media_type = ?')
                    params.append(media_type)
                where = (' WHERE ' + ' AND '.join(conditions)) if conditions else ''
                total = conn.execute(f'SELECT COUNT(*) FROM requestarr_global_blacklist{where}', params).fetchone()[0]
                offset = (page - 1) * page_size
                rows = conn.execute(
                    f'SELECT * FROM requestarr_global_blacklist{where} ORDER BY blacklisted_at DESC LIMIT ? OFFSET ?',
                    params + [page_size, offset]
                ).fetchall()
                return {'items': [dict(r) for r in rows], 'total': total, 'page': page, 'page_size': page_size}
        except Exception as e:
            logger.error(f"Error getting global blacklist: {e}")
            return {'items': [], 'total': 0, 'page': page, 'page_size': page_size}

    def generate_recovery_key(self, username: str) -> Optional[str]:
        """Generate a new recovery key for a user"""
        import hashlib
        import secrets
        
        # Expanded word lists for better entropy
        adjectives = [
            'ocean', 'storm', 'frost', 'light', 'dark', 'swift', 'calm', 'wild', 'bright', 'deep',
            'lunar', 'solar', 'amber', 'coral', 'ivory', 'azure', 'cedar', 'maple', 'polar', 'tidal',
            'rapid', 'vivid', 'noble', 'prime', 'stark', 'brave', 'crisp', 'grand', 'keen', 'bold'
        ]
        nouns = [
            'tower', 'bridge', 'quest', 'dream', 'flame', 'river', 'mountain', 'crystal', 'shadow', 'star',
            'falcon', 'canyon', 'harbor', 'meadow', 'summit', 'valley', 'beacon', 'cipher', 'prism', 'anvil',
            'atlas', 'delta', 'forge', 'haven', 'nexus', 'orbit', 'pulse', 'spark', 'vault', 'zenith'
        ]
        
        try:
            # Generate a human-readable recovery key like "ocean-light-tower-51"
            # Uses secrets module for cryptographically secure randomness
            adj = secrets.choice(adjectives)
            noun1 = secrets.choice(nouns)
            noun2 = secrets.choice(nouns)
            number = secrets.randbelow(90) + 10  # 10-99
            recovery_key = f"{adj}-{noun1}-{noun2}-{number}"
            
            # Hash the recovery key for secure storage
            recovery_key_hash = hashlib.sha256(recovery_key.encode()).hexdigest()
            
            with self.get_connection() as conn:
                conn.execute('''
                    UPDATE users SET recovery_key = ?, updated_at = CURRENT_TIMESTAMP 
                    WHERE username = ?
                ''', (recovery_key_hash, username))
                conn.commit()
                logger.info(f"Generated new recovery key for user: {username}")
                
                # Return the plain text recovery key (only time it's shown)
                return recovery_key
        except Exception as e:
            logger.error(f"Error generating recovery key for user {username}: {e}")
            return None
    
    def verify_recovery_key(self, recovery_key: str) -> Optional[str]:
        """Verify a recovery key and return the username if valid"""
        import hashlib
        
        try:
            # Hash the provided recovery key
            recovery_key_hash = hashlib.sha256(recovery_key.encode()).hexdigest()
            
            with self.get_connection() as conn:
                cursor = conn.execute(
                    'SELECT username FROM users WHERE recovery_key = ?',
                    (recovery_key_hash,)
                )
                row = cursor.fetchone()
                
                if row:
                    logger.info(f"Recovery key verified for user: {row[0]}")
                    return row[0]
                else:
                    logger.warning(f"Invalid recovery key attempted")
                    return None
        except Exception as e:
            logger.error(f"Error verifying recovery key: {e}")
            return None
    
    def clear_recovery_key(self, username: str) -> bool:
        """Clear the recovery key for a user (after password reset)"""
        try:
            with self.get_connection() as conn:
                conn.execute('''
                    UPDATE users SET recovery_key = NULL, updated_at = CURRENT_TIMESTAMP 
                    WHERE username = ?
                ''', (username,))
                conn.commit()
                logger.info(f"Cleared recovery key for user: {username}")
                return True
        except Exception as e:
            logger.error(f"Error clearing recovery key for user {username}: {e}")
            return False

    def check_recovery_key_rate_limit(self, ip_address: str) -> Dict[str, Any]:
        """Check if IP address is rate limited for recovery key attempts"""
        try:
            with self.get_connection() as conn:
                conn.row_factory = sqlite3.Row
                cursor = conn.execute('''
                    SELECT failed_attempts, locked_until, last_attempt 
                    FROM recovery_key_rate_limit 
                    WHERE ip_address = ?
                ''', (ip_address,))
                row = cursor.fetchone()
                
                if not row:
                    return {"locked": False, "failed_attempts": 0}
                
                # Convert locked_until to datetime if it exists
                locked_until = None
                if row['locked_until']:
                    try:
                        from datetime import datetime
                        locked_until = datetime.fromisoformat(row['locked_until'])
                        # Check if lockout has expired
                        if datetime.now() >= locked_until:
                            # Clear the lockout
                            conn.execute('''
                                UPDATE recovery_key_rate_limit 
                                SET failed_attempts = 0, locked_until = NULL, updated_at = CURRENT_TIMESTAMP
                                WHERE ip_address = ?
                            ''', (ip_address,))
                            conn.commit()
                            return {"locked": False, "failed_attempts": 0}
                    except ValueError:
                        # Invalid datetime format, treat as expired
                        conn.execute('''
                            UPDATE recovery_key_rate_limit 
                            SET failed_attempts = 0, locked_until = NULL, updated_at = CURRENT_TIMESTAMP
                            WHERE ip_address = ?
                        ''', (ip_address,))
                        conn.commit()
                        return {"locked": False, "failed_attempts": 0}
                
                return {
                    "locked": locked_until is not None and datetime.now() < locked_until,
                    "failed_attempts": row['failed_attempts'],
                    "locked_until": locked_until.isoformat() if locked_until else None
                }
        except Exception as e:
            logger.error(f"Error checking recovery key rate limit for IP {ip_address}: {e}")
            return {"locked": False, "failed_attempts": 0}

    def record_recovery_key_attempt(self, ip_address: str, username: str = None, success: bool = False) -> Dict[str, Any]:
        """Record a recovery key attempt and apply rate limiting if needed"""
        try:
            from datetime import datetime, timedelta
            
            with self.get_connection() as conn:
                if success:
                    # Clear rate limiting on successful attempt
                    conn.execute('''
                        UPDATE recovery_key_rate_limit 
                        SET failed_attempts = 0, locked_until = NULL, updated_at = CURRENT_TIMESTAMP
                        WHERE ip_address = ?
                    ''', (ip_address,))
                    conn.commit()
                    return {"locked": False, "failed_attempts": 0}
                
                # Handle failed attempt
                cursor = conn.execute('''
                    SELECT failed_attempts FROM recovery_key_rate_limit WHERE ip_address = ?
                ''', (ip_address,))
                row = cursor.fetchone()
                
                if row:
                    # Update existing record
                    new_failed_attempts = row[0] + 1
                    locked_until = None
                    
                    # Lock for 15 minutes after 3 failed attempts
                    if new_failed_attempts >= 3:
                        locked_until = datetime.now() + timedelta(minutes=15)
                        locked_until_str = locked_until.isoformat()
                    else:
                        locked_until_str = None
                    
                    conn.execute('''
                        UPDATE recovery_key_rate_limit 
                        SET failed_attempts = ?, locked_until = ?, username = ?, 
                            last_attempt = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                        WHERE ip_address = ?
                    ''', (new_failed_attempts, locked_until_str, username, ip_address))
                else:
                    # Create new record
                    new_failed_attempts = 1
                    conn.execute('''
                        INSERT INTO recovery_key_rate_limit 
                        (ip_address, username, failed_attempts, last_attempt)
                        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                    ''', (ip_address, username, new_failed_attempts))
                
                conn.commit()
                
                locked = new_failed_attempts >= 3
                return {
                    "locked": locked,
                    "failed_attempts": new_failed_attempts,
                    "locked_until": locked_until.isoformat() if locked else None
                }
                
        except Exception as e:
            logger.error(f"Error recording recovery key attempt for IP {ip_address}: {e}")
            return {"locked": False, "failed_attempts": 0}

    def cleanup_expired_rate_limits(self):
        """Clean up expired rate limit entries (older than 24 hours)"""
        try:
            from datetime import datetime, timedelta
            cutoff_time = datetime.now() - timedelta(hours=24)
            
            with self.get_connection() as conn:
                cursor = conn.execute('''
                    DELETE FROM recovery_key_rate_limit 
                    WHERE last_attempt < ? AND (locked_until IS NULL OR locked_until < CURRENT_TIMESTAMP)
                ''', (cutoff_time.isoformat(),))
                deleted_count = cursor.rowcount
                conn.commit()
                
                if deleted_count > 0:
                    logger.debug(f"Cleaned up {deleted_count} expired recovery key rate limit entries")
                    
        except Exception as e:
            logger.error(f"Error cleaning up expired rate limits: {e}")

    def get_sponsors(self) -> List[Dict[str, Any]]:
        """Get all sponsors from database"""
        with self.get_connection() as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.execute('''
                SELECT login, name, avatar_url, url, tier, monthly_amount, category, updated_at
                FROM sponsors 
                ORDER BY monthly_amount DESC, name ASC
            ''')
            return [dict(row) for row in cursor.fetchall()]
    
    def save_sponsors(self, sponsors_data: List[Dict[str, Any]]):
        """Save sponsors data to database, replacing existing data"""
        with self.get_connection() as conn:
            # Clear existing sponsors
            conn.execute('DELETE FROM sponsors')
            
            # Insert new sponsors
            for sponsor in sponsors_data:
                conn.execute('''
                    INSERT INTO sponsors (login, name, avatar_url, url, tier, monthly_amount, category)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                ''', (
                    sponsor.get('login', ''),
                    sponsor.get('name', sponsor.get('login', 'Unknown')),
                    sponsor.get('avatarUrl', ''),
                    sponsor.get('url', '#'),
                    sponsor.get('tier', 'Supporter'),
                    sponsor.get('monthlyAmount', 0),
                    sponsor.get('category', 'past')
                ))
            
            logger.info(f"Saved {len(sponsors_data)} sponsors to database")
    
    # Hunt History/Manager Database Methods
    def add_hunt_history_entry(self, app_type: str, instance_name: str, media_id: str, 
                         processed_info: str, operation_type: str = "missing", 
                         discovered: bool = False, date_time: int = None) -> Dict[str, Any]:
        """Add a new hunt history entry to the database"""
        if date_time is None:
            date_time = int(time.time())
        
        date_time_readable = datetime.fromtimestamp(date_time).strftime('%Y-%m-%d %H:%M:%S')
        
        with self.get_connection() as conn:
            cursor = conn.execute('''
                INSERT INTO hunt_history 
                (app_type, instance_name, media_id, processed_info, operation_type, discovered, date_time, date_time_readable)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ''', (app_type, instance_name, media_id, processed_info, operation_type, discovered, date_time, date_time_readable))
            
            entry_id = cursor.lastrowid
            conn.commit()
            
            # Return the created entry
            entry = {
                "id": entry_id,
                "app_type": app_type,
                "instance_name": instance_name,
                "media_id": media_id,
                "processed_info": processed_info,
                "operation_type": operation_type,
                "discovered": discovered,
                "date_time": date_time,
                "date_time_readable": date_time_readable
            }
            
            logger.info(f"Added hunt history entry for {app_type}-{instance_name}: {processed_info}")
            return entry
    
    def get_hunt_history(self, app_type: str = None, search_query: str = None, 
                   page: int = 1, page_size: int = 20, instance_name: str = None) -> Dict[str, Any]:
        """Get hunt history entries with pagination and filtering"""
        with self.get_connection() as conn:
            conn.row_factory = sqlite3.Row
            
            # Build WHERE clause
            where_conditions = []
            params = []
            
            if app_type and app_type != "all":
                where_conditions.append("app_type = ?")
                params.append(app_type)
            
            if instance_name is not None and instance_name != "":
                where_conditions.append("instance_name = ?")
                params.append(str(instance_name))
            
            if search_query:
                where_conditions.append("(processed_info LIKE ? OR media_id LIKE ?)")
                params.extend([f"%{search_query}%", f"%{search_query}%"])
            
            where_clause = "WHERE " + " AND ".join(where_conditions) if where_conditions else ""
            
            # Get total count
            count_query = f"SELECT COUNT(*) FROM hunt_history {where_clause}"
            cursor = conn.execute(count_query, params)
            total_entries = cursor.fetchone()[0]
            
            # Calculate pagination
            total_pages = max(1, (total_entries + page_size - 1) // page_size)
            offset = (page - 1) * page_size
            
            # Get entries
            entries_query = f"""
                SELECT * FROM hunt_history {where_clause}
                ORDER BY date_time DESC
                LIMIT ? OFFSET ?
            """
            cursor = conn.execute(entries_query, params + [page_size, offset])
            
            entries = []
            current_time = int(time.time())
            
            for row in cursor.fetchall():
                entry = dict(row)
                # Calculate "how long ago"
                seconds_ago = current_time - entry["date_time"]
                entry["how_long_ago"] = self._format_time_ago(seconds_ago)
                entries.append(entry)
            
            return {
                "entries": entries,
                "total_entries": total_entries,
                "total_pages": total_pages,
                "current_page": page
            }

    def handle_instance_rename(self, app_type: str, old_instance_name: str, new_instance_name: str) -> bool:
        """
        No-op for display-name renames: history is keyed by instance_id, so renaming in the UI
        does not require updating hunt_history. Kept for API compatibility with history_manager.
        """
        if old_instance_name == new_instance_name:
            return True
        # Optional: if any rows were still keyed by old display name (pre-migration), could UPDATE here.
        # With instance_id migration, no rows are keyed by display name, so nothing to do.
        return True

    def clear_hunt_history(self, app_type: str = None):
        """Clear hunt history entries"""
        with self.get_connection() as conn:
            if app_type and app_type != "all":
                conn.execute("DELETE FROM hunt_history WHERE app_type = ?", (app_type,))
                logger.info(f"Cleared hunt history for {app_type}")
            else:
                conn.execute("DELETE FROM hunt_history")
                logger.info("Cleared all hunt history")
            conn.commit()

    def _format_time_ago(self, seconds_ago: int) -> str:
        """Format seconds into human-readable time ago string"""
        if seconds_ago < 60:
            return f"{seconds_ago} seconds ago"
        elif seconds_ago < 3600:
            minutes = seconds_ago // 60
            return f"{minutes} minute{'s' if minutes != 1 else ''} ago"
        elif seconds_ago < 86400:
            hours = seconds_ago // 3600
            return f"{hours} hour{'s' if hours != 1 else ''} ago"
        else:
            days = seconds_ago // 86400
            return f"{days} day{'s' if days != 1 else ''} ago"

    def save_setup_progress(self, progress_data: dict) -> bool:
        """Save setup progress data to database"""
        try:
            with self.get_connection() as conn:
                conn.execute("""
                    INSERT OR REPLACE INTO general_settings (setting_key, setting_value, setting_type) 
                    VALUES ('setup_progress', ?, 'json')
                """, (json.dumps(progress_data),))
            return True
        except Exception as e:
            logger.error(f"Failed to save setup progress: {e}")
            return False
    
    def get_setup_progress(self) -> dict:
        """Get setup progress data from database"""
        try:
            with self.get_connection() as conn:
                result = conn.execute(
                    "SELECT setting_value FROM general_settings WHERE setting_key = 'setup_progress'"
                ).fetchone()
                
                if result:
                    return json.loads(result[0])
                else:
                    return {
                        'current_step': 1,
                        'completed_steps': [],
                        'account_created': False,
                        'two_factor_enabled': False,
                        'plex_setup_done': False,
                        'auth_mode_selected': False,
                        'recovery_key_generated': False,
                        'timestamp': datetime.now().isoformat()
                    }
        except Exception as e:
            logger.error(f"Failed to get setup progress: {e}")
            return {
                'current_step': 1,
                'completed_steps': [],
                'account_created': False,
                'two_factor_enabled': False,
                'plex_setup_done': False,
                'auth_mode_selected': False,
                'recovery_key_generated': False,
                'timestamp': datetime.now().isoformat()
            }
    
    def clear_setup_progress(self) -> bool:
        """Clear setup progress data from database (called when setup is complete)"""
        try:
            with self.get_connection() as conn:
                conn.execute(
                    "DELETE FROM general_settings WHERE setting_key = 'setup_progress'"
                )
            return True
        except Exception as e:
            logger.error(f"Failed to clear setup progress: {e}")
            return False
    
    def is_setup_in_progress(self) -> bool:
        """Check if setup is currently in progress"""
        try:
            with self.get_connection() as conn:
                result = conn.execute(
                    "SELECT 1 FROM general_settings WHERE setting_key = 'setup_progress'"
                ).fetchone()
                return result is not None
        except Exception as e:
            logger.error(f"Failed to check setup progress: {e}")
            return False

    # Requestarr methods for managing media requests
    def is_already_requested(self, tmdb_id: int, media_type: str, app_type: str, instance_name: str) -> bool:
        """Check if media has already been requested for the given app instance"""
        try:
            with self.get_connection() as conn:
                result = conn.execute('''
                    SELECT 1 FROM requestarr_requests 
                    WHERE tmdb_id = ? AND media_type = ? AND app_type = ? AND instance_name = ?
                ''', (tmdb_id, media_type, app_type, instance_name)).fetchone()
                return result is not None
        except Exception as e:
            logger.error(f"Error checking if media already requested: {e}")
            return False
    
    def add_request(self, tmdb_id: int, media_type: str, title: str, year: int, overview: str, 
                   poster_path: str, backdrop_path: str, app_type: str, instance_name: str) -> bool:
        """Add a new media request to the database"""
        try:
            with self.get_connection() as conn:
                conn.execute('''
                    INSERT OR REPLACE INTO requestarr_requests 
                    (tmdb_id, media_type, title, year, overview, poster_path, backdrop_path, app_type, instance_name, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ''', (tmdb_id, media_type, title, year, overview, poster_path, backdrop_path, app_type, instance_name))
                conn.commit()
                return True
        except Exception as e:
            logger.error(f"Error adding media request: {e}")
            return False

    def get_requests(self, page: int = 1, page_size: int = 20) -> Dict[str, Any]:
        """Get paginated list of media requests"""
        try:
            with self.get_connection() as conn:
                conn.row_factory = sqlite3.Row
                
                # Get total count
                total_count = conn.execute('SELECT COUNT(*) FROM requestarr_requests').fetchone()[0]
                
                # Calculate pagination
                offset = (page - 1) * page_size
                total_pages = (total_count + page_size - 1) // page_size
                
                # Get paginated results
                results = conn.execute('''
                    SELECT tmdb_id, media_type, title, year, overview, poster_path, backdrop_path, 
                           app_type, instance_name, created_at, updated_at
                    FROM requestarr_requests 
                    ORDER BY created_at DESC 
                    LIMIT ? OFFSET ?
                ''', (page_size, offset)).fetchall()
                
                # Convert to list of dictionaries
                requests_list = []
                for row in results:
                    requests_list.append({
                        'tmdb_id': row['tmdb_id'],
                        'media_type': row['media_type'],
                        'title': row['title'],
                        'year': row['year'],
                        'overview': row['overview'],
                        'poster_path': row['poster_path'],
                        'backdrop_path': row['backdrop_path'],
                        'app_type': row['app_type'],
                        'instance_name': row['instance_name'],
                        'created_at': row['created_at'],
                        'updated_at': row['updated_at']
                    })
                
                return {
                    'requests': requests_list,
                    'total': total_count,
                    'page': page,
                    'page_size': page_size,
                    'total_pages': total_pages
                }
                
        except Exception as e:
            logger.error(f"Error getting media requests: {e}")
            return {
                'requests': [],
                'total': 0,
                'page': page,
                'page_size': page_size,
                'total_pages': 0
            }

    # ========================================
    # HIDDEN MEDIA MANAGEMENT
    # ========================================
    
    def add_hidden_media(self, tmdb_id: int, media_type: str, title: str, app_type: str = None, instance_name: str = None, poster_path: str = None, user_id: int = None, username: str = None) -> bool:
        """Add media to hidden list.
        username=None means global (owner), username=X means personal (that user, cross-instance).
        app_type/instance_name kept for backward compat but no longer used as key.
        """
        try:
            with self.get_connection() as conn:
                now = int(time.time())
                readable_time = datetime.fromtimestamp(now).strftime('%Y-%m-%d %H:%M:%S')
                
                # Check if already exists for this user scope (cross-instance: tmdb_id + media_type + username)
                if username:
                    existing = conn.execute(
                        'SELECT id FROM requestarr_hidden_media WHERE tmdb_id = ? AND media_type = ? AND username = ?',
                        (tmdb_id, media_type, username)
                    ).fetchone()
                else:
                    # Global scope (owner): check user_id IS NULL and username IS NULL
                    existing = conn.execute(
                        'SELECT id FROM requestarr_hidden_media WHERE tmdb_id = ? AND media_type = ? AND user_id IS NULL AND (username IS NULL OR username = "")',
                        (tmdb_id, media_type)
                    ).fetchone()
                
                if existing:
                    return True  # Already hidden
                
                conn.execute('''
                    INSERT INTO requestarr_hidden_media 
                    (tmdb_id, media_type, title, poster_path, app_type, instance_name, hidden_at, hidden_at_readable, user_id, username)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (tmdb_id, media_type, title, poster_path, app_type or '', instance_name or '', now, readable_time, user_id, username))
                conn.commit()
                
                scope = f"user={username}" if username else "global"
                logger.info(f"Added hidden media: {title} (TMDB ID: {tmdb_id}, Type: {media_type}, Scope: {scope})")
                return True
        except Exception as e:
            logger.error(f"Error adding hidden media: {e}")
            return False
    
    def remove_hidden_media(self, tmdb_id: int, media_type: str, app_type: str = None, instance_name: str = None, user_id: int = None, username: str = None) -> bool:
        """Remove media from hidden list. Cross-instance: uses tmdb_id + media_type + username."""
        try:
            logger.debug(f"remove_hidden_media called with: tmdb_id={tmdb_id}, media_type={media_type}, username={username}")
            with self.get_connection() as conn:
                if username:
                    # Personal scope: delete by username
                    cursor = conn.execute('''
                        DELETE FROM requestarr_hidden_media 
                        WHERE tmdb_id = ? AND media_type = ? AND username = ?
                    ''', (tmdb_id, media_type, username))
                else:
                    # Global scope (owner): delete where user_id IS NULL and username IS NULL/empty
                    cursor = conn.execute('''
                        DELETE FROM requestarr_hidden_media 
                        WHERE tmdb_id = ? AND media_type = ? AND user_id IS NULL AND (username IS NULL OR username = "")
                    ''', (tmdb_id, media_type))
                rows_deleted = cursor.rowcount
                conn.commit()
                
                logger.info(f"Removed hidden media: TMDB ID {tmdb_id}, Type: {media_type}, username={username}, Rows deleted: {rows_deleted}")
                return True
        except Exception as e:
            logger.error(f"Error removing hidden media: {e}")
            return False
    
    def is_media_hidden(self, tmdb_id: int, media_type: str, app_type: str = None, instance_name: str = None, user_id: int = None, username: str = None) -> bool:
        """Check if media is hidden (cross-instance).
        Checks both global (username IS NULL) and personal (username = X) entries.
        """
        try:
            with self.get_connection() as conn:
                if username:
                    # Non-owner: check global OR personal by username
                    cursor = conn.execute('''
                        SELECT 1 FROM requestarr_hidden_media 
                        WHERE tmdb_id = ? AND media_type = ?
                        AND ((user_id IS NULL AND (username IS NULL OR username = "")) OR username = ?)
                    ''', (tmdb_id, media_type, username))
                else:
                    # Owner: check global only
                    cursor = conn.execute('''
                        SELECT 1 FROM requestarr_hidden_media 
                        WHERE tmdb_id = ? AND media_type = ?
                        AND user_id IS NULL AND (username IS NULL OR username = "")
                    ''', (tmdb_id, media_type))
                return cursor.fetchone() is not None
        except Exception as e:
            logger.error(f"Error checking if media is hidden: {e}")
            return False
    
    def get_hidden_media(self, page: int = 1, page_size: int = 20, media_type: str = None, app_type: str = None, instance_name: str = None, user_id: int = None, username: str = None) -> Dict[str, Any]:
        """Get paginated list of hidden media, optionally filtered by media_type.
        For non-owner users (username provided): returns global + personal (by username).
        For owner (username=None): returns global items only.
        Cross-instance: app_type/instance_name filters are ignored for personal items.
        """
        try:
            offset = (page - 1) * page_size
            
            with self.get_connection() as conn:
                # Build query based on filters
                where_clauses = []
                params = []
                
                if media_type:
                    where_clauses.append("media_type = ?")
                    params.append(media_type)
                
                # User scope filter (cross-instance)
                if username:
                    # Non-owner: see global + their own personal items
                    where_clauses.append("((user_id IS NULL AND (username IS NULL OR username = '')) OR username = ?)")
                    params.append(username)
                else:
                    # Owner: see only global items
                    where_clauses.append("user_id IS NULL AND (username IS NULL OR username = '')")
                
                where_clause = "WHERE " + " AND ".join(where_clauses) if where_clauses else ""
                
                # Get total count
                count_query = f"SELECT COUNT(*) FROM requestarr_hidden_media {where_clause}"
                total_count = conn.execute(count_query, params).fetchone()[0]
                total_pages = (total_count + page_size - 1) // page_size
                
                # Get paginated results
                query = f'''
                    SELECT id, tmdb_id, media_type, title, poster_path, app_type, instance_name, hidden_at, hidden_at_readable, user_id, username 
                    FROM requestarr_hidden_media 
                    {where_clause}
                    ORDER BY hidden_at DESC 
                    LIMIT ? OFFSET ?
                '''
                params.extend([page_size, offset])
                cursor = conn.execute(query, params)
                
                hidden_list = []
                for row in cursor.fetchall():
                    hidden_list.append({
                        'id': row[0],
                        'tmdb_id': row[1],
                        'media_type': row[2],
                        'title': row[3],
                        'poster_path': row[4],
                        'app_type': row[5],
                        'instance_name': row[6],
                        'hidden_at': row[7],
                        'hidden_at_readable': row[8],
                        'user_id': row[9],
                        'username': row[10],
                        'is_global': row[9] is None and (row[10] is None or row[10] == ''),
                    })
                
                return {
                    'hidden_media': hidden_list,
                    'total': total_count,
                    'page': page,
                    'page_size': page_size,
                    'total_pages': total_pages
                }
                
        except Exception as e:
            logger.error(f"Error getting hidden media: {e}")
            return {
                'hidden_media': [],
                'total': 0,
                'page': page,
                'page_size': page_size,
                'total_pages': 0
            }

    # ------------------------------------------------------------------
    # Notification Connections CRUD
    # ------------------------------------------------------------------
