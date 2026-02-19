"""Auto-extracted database mixin — see db_mixins/__init__.py"""
import json
import sqlite3
import time
import logging
from typing import Dict, List, Any, Optional, Set
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

class UsersMixin:
    """Auth users, requestarr users, recovery keys, rate limits, sponsors."""

    def user_exists(self) -> bool:
        """Check if any user exists in the database"""
        with self.get_connection() as conn:
            cursor = conn.execute('SELECT COUNT(*) FROM users')
            count = cursor.fetchone()[0]
            return count > 0
    
    def get_user_by_username(self, username: str) -> Optional[Dict[str, Any]]:
        """Get user data by username"""
        with self.get_connection() as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.execute(
                'SELECT * FROM users WHERE username = ?',
                (username,)
            )
            row = cursor.fetchone()
            
            if row:
                user_data = dict(row)
                # Parse JSON fields
                if user_data.get('plex_user_data'):
                    try:
                        user_data['plex_user_data'] = json.loads(user_data['plex_user_data'])
                    except json.JSONDecodeError:
                        user_data['plex_user_data'] = None
                return user_data
            return None
    
    def get_first_user(self) -> Optional[Dict[str, Any]]:
        """Get the first user from the database (for bypass modes)"""
        with self.get_connection() as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.execute(
                'SELECT * FROM users ORDER BY created_at ASC LIMIT 1'
            )
            row = cursor.fetchone()
            
            if row:
                user_data = dict(row)
                # Parse JSON fields
                if user_data.get('plex_user_data'):
                    try:
                        user_data['plex_user_data'] = json.loads(user_data['plex_user_data'])
                    except json.JSONDecodeError:
                        user_data['plex_user_data'] = None
                return user_data
            return None
    
    def _password_looks_hashed(self, value: str) -> bool:
        """True if value looks like a hash (bcrypt or salt:hash). Do not store plaintext."""
        if not value or len(value) < 10:
            return False
        if value.startswith("$2") and value.count("$") >= 3:
            return True
        if ":" in value and len(value) > 40:
            return True
        return False

    def create_user(self, username: str, password: str, two_fa_enabled: bool = False,
                   two_fa_secret: str = None, plex_token: str = None,
                   plex_user_data: Dict[str, Any] = None) -> bool:
        """Create a new user. Passwords are stored hashed; plaintext is hashed before storage.
        
        Uses FULL synchronous mode to guarantee durability — user creation must survive crashes.
        """
        try:
            from src.primary.auth import hash_password
            store_password = password
            if not self._password_looks_hashed(store_password):
                store_password = hash_password(store_password)
                logger.debug("Hashed password before create_user storage")

            plex_data_json = json.dumps(plex_user_data) if plex_user_data else None

            with self.get_connection() as conn:
                # Use FULL sync for critical user data — ensures write is on disk before returning
                conn.execute('PRAGMA synchronous = FULL')
                conn.execute('''
                    INSERT INTO users (username, password, two_fa_enabled, two_fa_secret,
                                     plex_token, plex_user_data, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                ''', (username, store_password, two_fa_enabled, two_fa_secret, plex_token, plex_data_json))
                conn.commit()
                # Force WAL checkpoint to merge user data into main DB immediately
                conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
                # Restore normal sync mode
                conn.execute('PRAGMA synchronous = NORMAL')
                logger.info(f"Created user: {username} (durability checkpoint completed)")
                return True
        except Exception as e:
            logger.error(f"Error creating user {username}: {e}")
            return False
    
    def update_user_password(self, username: str, new_password: str) -> bool:
        """Update user password. Plaintext is hashed before storage."""
        try:
            from src.primary.auth import hash_password
            store_password = new_password
            if not self._password_looks_hashed(store_password):
                store_password = hash_password(store_password)
                logger.debug("Hashed password before update_user_password storage")

            with self.get_connection() as conn:
                conn.execute('''
                    UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE username = ?
                ''', (store_password, username))
                conn.commit()
                logger.info(f"Updated password for user: {username}")
                return True
        except Exception as e:
            logger.error(f"Error updating password for user {username}: {e}")
            return False
    
    def update_user_username(self, old_username: str, new_username: str) -> bool:
        """Update username"""
        try:
            with self.get_connection() as conn:
                conn.execute('''
                    UPDATE users SET username = ?, updated_at = CURRENT_TIMESTAMP 
                    WHERE username = ?
                ''', (new_username, old_username))
                conn.commit()
                logger.info(f"Updated username from {old_username} to {new_username}")
                return True
        except Exception as e:
            logger.error(f"Error updating username from {old_username} to {new_username}: {e}")
            return False
    
    def update_user_2fa(self, username: str, two_fa_enabled: bool, two_fa_secret: str = None) -> bool:
        """Update user 2FA settings"""
        try:
            with self.get_connection() as conn:
                conn.execute('''
                    UPDATE users SET two_fa_enabled = ?, two_fa_secret = ?, 
                                   updated_at = CURRENT_TIMESTAMP 
                    WHERE username = ?
                ''', (two_fa_enabled, two_fa_secret, username))
                conn.commit()
                logger.info(f"Updated 2FA settings for user: {username}")
                return True
        except Exception as e:
            logger.error(f"Error updating 2FA for user {username}: {e}")
            return False
    
    def update_user_temp_2fa_secret(self, username: str, temp_2fa_secret: str = None) -> bool:
        """Update user temporary 2FA secret"""
        try:
            with self.get_connection() as conn:
                conn.execute('''
                    UPDATE users SET temp_2fa_secret = ?, updated_at = CURRENT_TIMESTAMP 
                    WHERE username = ?
                ''', (temp_2fa_secret, username))
                conn.commit()
                logger.info(f"Updated temporary 2FA secret for user: {username}")
                return True
        except Exception as e:
            logger.error(f"Error updating temporary 2FA secret for user {username}: {e}")
            return False
    
    def update_user_plex(self, username: str, plex_token: str = None, 
                        plex_user_data: Dict[str, Any] = None) -> bool:
        """Update user Plex settings"""
        try:
            import time
            plex_data_json = json.dumps(plex_user_data) if plex_user_data else None
            
            # Set the linked timestamp when plex_token is provided (linking account)
            plex_linked_at = int(time.time()) if plex_token else None
            
            with self.get_connection() as conn:
                conn.execute('''
                    UPDATE users SET plex_token = ?, plex_user_data = ?, 
                                   plex_linked_at = ?, updated_at = CURRENT_TIMESTAMP 
                    WHERE username = ?
                ''', (plex_token, plex_data_json, plex_linked_at, username))
                conn.commit()
                logger.info(f"Updated Plex settings for user: {username}")
                return True
        except Exception as e:
            logger.error(f"Error updating Plex settings for user {username}: {e}")
            return False
    
    def has_users_with_plex(self) -> bool:
        """Check if any users have Plex authentication configured"""
        try:
            with self.get_connection() as conn:
                cursor = conn.execute('''
                    SELECT COUNT(*) FROM users WHERE plex_token IS NOT NULL AND plex_token != ''
                ''')
                count = cursor.fetchone()[0]
                return count > 0
        except Exception as e:
            logger.error(f"Error checking for Plex users: {e}")
            return False

    # Recovery Key Methods

    # ── Requestarr User Management Methods ───────────────────────

    def get_all_requestarr_users(self) -> list:
        """Get all requestarr users."""
        with self.get_connection() as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute('SELECT * FROM requestarr_users ORDER BY created_at ASC').fetchall()
            users = []
            for row in rows:
                u = dict(row)
                if u.get('plex_user_data'):
                    try:
                        u['plex_user_data'] = json.loads(u['plex_user_data'])
                    except (json.JSONDecodeError, TypeError):
                        u['plex_user_data'] = None
                users.append(u)
            return users

    def get_requestarr_user_by_id(self, user_id: int) -> Optional[Dict[str, Any]]:
        """Get a requestarr user by ID."""
        with self.get_connection() as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute('SELECT * FROM requestarr_users WHERE id = ?', (user_id,)).fetchone()
            if row:
                u = dict(row)
                if u.get('plex_user_data'):
                    try:
                        u['plex_user_data'] = json.loads(u['plex_user_data'])
                    except (json.JSONDecodeError, TypeError):
                        u['plex_user_data'] = None
                return u
            return None

    def get_requestarr_user_by_username(self, username: str) -> Optional[Dict[str, Any]]:
        """Get a requestarr user by username."""
        with self.get_connection() as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute('SELECT * FROM requestarr_users WHERE username = ?', (username,)).fetchone()
            if row:
                u = dict(row)
                if u.get('plex_user_data'):
                    try:
                        u['plex_user_data'] = json.loads(u['plex_user_data'])
                    except (json.JSONDecodeError, TypeError):
                        u['plex_user_data'] = None
                return u
            return None

    def create_requestarr_user(self, username: str, password: str, email: str = '',
                               role: str = 'user', permissions: str = '{}',
                               plex_user_data: str = None) -> bool:
        """Create a new requestarr user."""
        try:
            from src.primary.auth import hash_password
            hashed = hash_password(password)
            with self.get_connection() as conn:
                conn.execute('''
                    INSERT INTO requestarr_users (username, password, email, role, permissions, plex_user_data, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                ''', (username, hashed, email, role, permissions, plex_user_data))
                conn.commit()
                logger.info(f"Created requestarr user: {username} (role={role})")
                return True
        except Exception as e:
            logger.error(f"Error creating requestarr user {username}: {e}")
            return False

    def update_requestarr_user(self, user_id: int, updates: Dict[str, Any]) -> bool:
        """Update a requestarr user by ID. Pass a dict of column->value."""
        try:
            allowed = {'username', 'password', 'email', 'role', 'permissions', 'plex_user_data', 'avatar_url', 'request_count'}
            filtered = {k: v for k, v in updates.items() if k in allowed}
            if not filtered:
                return True
            filtered['updated_at'] = 'CURRENT_TIMESTAMP'
            set_parts = []
            values = []
            for k, v in filtered.items():
                if v == 'CURRENT_TIMESTAMP':
                    set_parts.append(f'{k} = CURRENT_TIMESTAMP')
                else:
                    set_parts.append(f'{k} = ?')
                    values.append(v)
            values.append(user_id)
            sql = f"UPDATE requestarr_users SET {', '.join(set_parts)} WHERE id = ?"
            with self.get_connection() as conn:
                conn.execute(sql, values)
                conn.commit()
                return True
        except Exception as e:
            logger.error(f"Error updating requestarr user {user_id}: {e}")
            return False

    def delete_requestarr_user(self, user_id: int) -> bool:
        """Delete a requestarr user by ID."""
        try:
            with self.get_connection() as conn:
                conn.execute('DELETE FROM requestarr_users WHERE id = ?', (user_id,))
                conn.commit()
                return True
        except Exception as e:
            logger.error(f"Error deleting requestarr user {user_id}: {e}")
            return False

    def ensure_owner_in_requestarr_users(self):
        """Ensure the main owner account exists in requestarr_users table."""
        try:
            owner = self.get_first_user()
            if not owner:
                return
            existing = self.get_requestarr_user_by_username(owner['username'])
            if existing:
                return
            owner_perms = json.dumps({
                'request_movies': True, 'request_tv': True,
                'auto_approve': True, 'auto_approve_movies': True, 'auto_approve_tv': True,
                'manage_requests': True, 'manage_users': True,
                'view_requests': True, 'hide_media_global': True,
            })
            with self.get_connection() as conn:
                conn.execute('''
                    INSERT OR IGNORE INTO requestarr_users (username, password, email, role, permissions, created_at, updated_at)
                    VALUES (?, ?, '', 'owner', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                ''', (owner['username'], owner['password'], owner_perms))
                conn.commit()
                logger.info(f"Synced owner '{owner['username']}' into requestarr_users")
        except Exception as e:
            logger.error(f"Error ensuring owner in requestarr_users: {e}")

    # ── Requestarr Services Methods ──────────────────────────────
