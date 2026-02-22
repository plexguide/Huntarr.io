"""Auto-extracted database mixin — see db_mixins/__init__.py"""
import json
import sqlite3
import time
import logging
from typing import Dict, List, Any, Optional, Set
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

class ConfigMixin:
    """App config, instances, general settings, version methods."""

    def get_app_config(self, app_type: str) -> Optional[Dict[str, Any]]:
        """Get app configuration from database"""
        try:
            with self.get_connection() as conn:
                cursor = conn.execute(
                    'SELECT config_data FROM app_configs WHERE app_type = ?',
                    (app_type,)
                )
                row = cursor.fetchone()
                
                if row:
                    try:
                        return json.loads(row[0])
                    except json.JSONDecodeError as e:
                        logger.error(f"Failed to parse JSON for {app_type}: {e}")
                        return None
                return None
        except sqlite3.DatabaseError as e:
            if self._check_and_recover_corruption(e):
                # Retry once after recovery
                try:
                    with self.get_connection() as conn:
                        cursor = conn.execute(
                            'SELECT config_data FROM app_configs WHERE app_type = ?',
                            (app_type,)
                        )
                        row = cursor.fetchone()
                        if row:
                            try:
                                return json.loads(row[0])
                            except json.JSONDecodeError:
                                return None
                        return None
                except Exception:
                    logger.error(f"get_app_config retry failed for {app_type} after corruption recovery")
                    return None
            raise
    
    def save_app_config(self, app_type: str, config_data: Dict[str, Any]):
        """Save app configuration to database"""
        config_json = json.dumps(config_data, indent=2)
        
        with self.get_connection() as conn:
            conn.execute('''
                INSERT OR REPLACE INTO app_configs (app_type, config_data, updated_at)
                VALUES (?, ?, CURRENT_TIMESTAMP)
            ''', (app_type, config_json))
            conn.commit()
            # Auto-save enabled - no need to log every successful save

    def get_app_config_for_instance(self, app_type: str, instance_id: int) -> Optional[Dict[str, Any]]:
        """Get app config for a Movie Hunt instance. Supports legacy single-instance format."""
        raw = self.get_app_config(app_type)
        if not raw or not isinstance(raw, dict):
            return None
        if 'instances' in raw and isinstance(raw['instances'], dict):
            inst_key = str(instance_id)
            return raw['instances'].get(inst_key)
        # Legacy: no "instances" key -> whole blob is for instance 1
        if instance_id == 1:
            return raw
        return None

    def save_app_config_for_instance(self, app_type: str, instance_id: int, data: Dict[str, Any]):
        """Save app config for a Movie Hunt instance. Writes per-instance structure."""
        raw = self.get_app_config(app_type)
        if not raw or not isinstance(raw, dict):
            raw = {}
        if 'instances' not in raw or not isinstance(raw['instances'], dict):
            # Migrate: existing data becomes instance 1
            raw = {'instances': {'1': raw if raw else {}}}
        inst_key = str(instance_id)
        raw.setdefault('instances', {})[inst_key] = data
        self.save_app_config(app_type, raw)

    def get_movie_hunt_instances(self) -> List[Dict[str, Any]]:
        """List all Movie Hunt instances (id, name, created_at)."""
        with self.get_connection() as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.execute(
                'SELECT id, name, created_at FROM movie_hunt_instances ORDER BY id'
            )
            return [dict(row) for row in cursor.fetchall()]

    def create_movie_hunt_instance(self, name: str) -> int:
        """Create a new Movie Hunt instance. Returns new id (never reused). Name made unique by appending -1, -2 if needed."""
        name = (name or '').strip() or 'Unnamed'
        with self.get_connection() as conn:
            cursor = conn.execute('SELECT name FROM movie_hunt_instances')
            existing_names = {row[0] for row in cursor.fetchall()}
            display_name = name
            suffix = 0
            while display_name in existing_names:
                suffix += 1
                display_name = f'{name}-{suffix}'
            # Let SQLite AUTOINCREMENT assign the id to avoid TOCTOU race conditions
            cursor = conn.execute(
                'INSERT INTO movie_hunt_instances (name, created_at) VALUES (?, CURRENT_TIMESTAMP)',
                (display_name,)
            )
            conn.commit()
            return cursor.lastrowid

    def update_movie_hunt_instance(self, instance_id: int, name: str) -> bool:
        """Rename a Movie Hunt instance. Enforces unique name (auto-append -1, -2 if needed)."""
        name = (name or '').strip() or 'Unnamed'
        with self.get_connection() as conn:
            cursor = conn.execute('SELECT id, name FROM movie_hunt_instances')
            rows = cursor.fetchall()
            existing = {r[0]: r[1] for r in rows}
            if instance_id not in existing:
                return False
            existing_names = {n for i, n in rows if i != instance_id}
            display_name = name
            suffix = 0
            while display_name in existing_names:
                suffix += 1
                display_name = f'{name}-{suffix}'
            conn.execute('UPDATE movie_hunt_instances SET name = ? WHERE id = ?', (display_name, instance_id))
            conn.commit()
            return True

    def delete_movie_hunt_instance(self, instance_id: int) -> bool:
        """Delete a Movie Hunt instance. ID is never reused."""
        with self.get_connection() as conn:
            cursor = conn.execute('DELETE FROM movie_hunt_instances WHERE id = ?', (instance_id,))
            conn.commit()
            return cursor.rowcount > 0

    def get_current_movie_hunt_instance_id(self) -> int:
        """Current Movie Hunt instance (server-stored). Returns 0 when no instances exist or stored id is invalid."""
        ids = [i['id'] for i in self.get_movie_hunt_instances()]
        if not ids:
            return 0
        val = self.get_general_setting('movie_hunt_current_instance_id')
        if val is None:
            return ids[0]
        try:
            iid = int(val)
            # If the stored ID is valid, return it; else return the first available instance
            return iid if iid in ids else ids[0]
        except (TypeError, ValueError):
            return ids[0]

    def set_current_movie_hunt_instance_id(self, instance_id: int):
        """Set current Movie Hunt instance (server-stored)."""
        self.set_general_setting('movie_hunt_current_instance_id', instance_id)

    # ── TV Hunt Instance Methods ──

    def get_tv_hunt_instances(self) -> List[Dict[str, Any]]:
        """List all TV Hunt instances (id, name, created_at)."""
        with self.get_connection() as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.execute(
                'SELECT id, name, created_at FROM tv_hunt_instances ORDER BY id'
            )
            return [dict(row) for row in cursor.fetchall()]

    def create_tv_hunt_instance(self, name: str) -> int:
        """Create a new TV Hunt instance. Returns new id (never reused)."""
        name = (name or '').strip() or 'Unnamed'
        with self.get_connection() as conn:
            cursor = conn.execute('SELECT name FROM tv_hunt_instances')
            existing_names = {row[0] for row in cursor.fetchall()}
            display_name = name
            suffix = 0
            while display_name in existing_names:
                suffix += 1
                display_name = f'{name}-{suffix}'
            cursor = conn.execute(
                'INSERT INTO tv_hunt_instances (name, created_at) VALUES (?, CURRENT_TIMESTAMP)',
                (display_name,)
            )
            conn.commit()
            return cursor.lastrowid

    def update_tv_hunt_instance(self, instance_id: int, name: str) -> bool:
        """Rename a TV Hunt instance."""
        name = (name or '').strip() or 'Unnamed'
        with self.get_connection() as conn:
            cursor = conn.execute('SELECT id, name FROM tv_hunt_instances')
            rows = cursor.fetchall()
            existing = {r[0]: r[1] for r in rows}
            if instance_id not in existing:
                return False
            existing_names = {n for i, n in rows if i != instance_id}
            display_name = name
            suffix = 0
            while display_name in existing_names:
                suffix += 1
                display_name = f'{name}-{suffix}'
            conn.execute('UPDATE tv_hunt_instances SET name = ? WHERE id = ?', (display_name, instance_id))
            conn.commit()
            return True

    def delete_tv_hunt_instance(self, instance_id: int) -> bool:
        """Delete a TV Hunt instance. ID is never reused."""
        with self.get_connection() as conn:
            cursor = conn.execute('DELETE FROM tv_hunt_instances WHERE id = ?', (instance_id,))
            conn.commit()
            return cursor.rowcount > 0

    def get_current_tv_hunt_instance_id(self) -> int:
        """Current TV Hunt instance (server-stored). Returns 0 when no instances exist."""
        ids = [i['id'] for i in self.get_tv_hunt_instances()]
        if not ids:
            return 0
        val = self.get_general_setting('tv_hunt_current_instance_id')
        if val is None:
            return ids[0]
        try:
            iid = int(val)
            return iid if iid in ids else ids[0]
        except (TypeError, ValueError):
            return ids[0]

    def set_current_tv_hunt_instance_id(self, instance_id: int):
        """Set current TV Hunt instance (server-stored)."""
        self.set_general_setting('tv_hunt_current_instance_id', instance_id)

    def get_general_settings(self) -> Dict[str, Any]:
        """Get all general settings as a dictionary"""
        with self.get_connection() as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.execute(
                'SELECT setting_key, setting_value, setting_type FROM general_settings'
            )
            
            settings = {}
            for row in cursor.fetchall():
                key = row['setting_key']
                value = row['setting_value']
                setting_type = row['setting_type']
                
                # Convert value based on type
                if setting_type == 'boolean':
                    settings[key] = value.lower() == 'true'
                elif setting_type == 'integer':
                    settings[key] = int(value)
                elif setting_type == 'float':
                    settings[key] = float(value)
                elif setting_type == 'json':
                    try:
                        settings[key] = json.loads(value)
                    except json.JSONDecodeError:
                        settings[key] = value
                else:  # string
                    settings[key] = value
            
            return settings
    
    def save_general_settings(self, settings: Dict[str, Any]):
        """Save general settings to database with durability for critical settings"""
        # Check if this write includes critical settings that must survive crashes
        critical_keys = {'auth_mode', 'local_access_bypass', 'proxy_auth_bypass', 'base_url'}
        is_critical = bool(critical_keys & set(settings.keys()))
        
        with self.get_connection() as conn:
            if is_critical:
                conn.execute('PRAGMA synchronous = FULL')
            
            for key, value in settings.items():
                # Determine type and convert value
                if isinstance(value, bool):
                    setting_type = 'boolean'
                    setting_value = str(value).lower()
                elif isinstance(value, int):
                    setting_type = 'integer'
                    setting_value = str(value)
                elif isinstance(value, float):
                    setting_type = 'float'
                    setting_value = str(value)
                elif isinstance(value, (list, dict)):
                    setting_type = 'json'
                    setting_value = json.dumps(value)
                else:
                    setting_type = 'string'
                    setting_value = str(value)
                
                conn.execute('''
                    INSERT OR REPLACE INTO general_settings 
                    (setting_key, setting_value, setting_type, updated_at)
                    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                ''', (key, setting_value, setting_type))
            
            conn.commit()
            
            if is_critical:
                # Force WAL checkpoint for critical settings
                conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
                conn.execute('PRAGMA synchronous = NORMAL')
            # Auto-save enabled - no need to log every successful save
    
    def _migrate_general_settings_from_app_configs_if_needed(self):
        """
        Migrate general settings from app_configs to general_settings table if needed.
        Only runs if general_settings table is empty (preserves config on upgrade from v8 to v9).
        Issue #802, #815
        """
        try:
            with self.get_connection() as conn:
                # Check if general_settings is empty
                cursor = conn.execute('SELECT COUNT(*) FROM general_settings')
                count = cursor.fetchone()[0]
                
                if count > 0:
                    # General settings already exist, no migration needed
                    return
                
                # Check if old 'general' or 'advanced' configs exist in app_configs
                cursor = conn.execute(
                    "SELECT config_data FROM app_configs WHERE app_type IN ('general', 'advanced')"
                )
                rows = cursor.fetchall()
                
                if not rows:
                    # No legacy config to migrate
                    return
                
                # Merge all legacy general/advanced configs
                merged_settings = {}
                for row in rows:
                    try:
                        config_data = json.loads(row[0])
                        if isinstance(config_data, dict):
                            merged_settings.update(config_data)
                    except (json.JSONDecodeError, TypeError):
                        continue
                
                if merged_settings:
                    # Save merged settings to general_settings table
                    for key, value in merged_settings.items():
                        if isinstance(value, bool):
                            setting_type = 'boolean'
                            setting_value = str(value).lower()
                        elif isinstance(value, int):
                            setting_type = 'integer'
                            setting_value = str(value)
                        elif isinstance(value, float):
                            setting_type = 'float'
                            setting_value = str(value)
                        elif isinstance(value, (list, dict)):
                            setting_type = 'json'
                            setting_value = json.dumps(value)
                        else:
                            setting_type = 'string'
                            setting_value = str(value)
                        
                        conn.execute('''
                            INSERT OR REPLACE INTO general_settings 
                            (setting_key, setting_value, setting_type, updated_at)
                            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                        ''', (key, setting_value, setting_type))
                    
                    conn.commit()
                    logger.info(f"Migrated {len(merged_settings)} general settings from app_configs to general_settings")
        except Exception as e:
            logger.error(f"Error during general settings migration: {e}")
            # Don't raise - allow app to continue with defaults if migration fails
    
    def get_general_setting(self, key: str, default: Any = None) -> Any:
        """Get a specific general setting"""
        with self.get_connection() as conn:
            cursor = conn.execute(
                'SELECT setting_value, setting_type FROM general_settings WHERE setting_key = ?',
                (key,)
            )
            row = cursor.fetchone()
            
            if row:
                value, setting_type = row
                
                # Convert value based on type
                if setting_type == 'boolean':
                    return value.lower() == 'true'
                elif setting_type == 'integer':
                    return int(value)
                elif setting_type == 'float':
                    return float(value)
                elif setting_type == 'json':
                    try:
                        return json.loads(value)
                    except json.JSONDecodeError:
                        return value
                else:  # string
                    return value
            
            return default
    
    def set_general_setting(self, key: str, value: Any):
        """Set a specific general setting"""
        # Determine type and convert value
        if isinstance(value, bool):
            setting_type = 'boolean'
            setting_value = str(value).lower()
        elif isinstance(value, int):
            setting_type = 'integer'
            setting_value = str(value)
        elif isinstance(value, float):
            setting_type = 'float'
            setting_value = str(value)
        elif isinstance(value, (list, dict)):
            setting_type = 'json'
            setting_value = json.dumps(value)
        else:
            setting_type = 'string'
            setting_value = str(value)
        
        with self.get_connection() as conn:
            conn.execute('''
                INSERT OR REPLACE INTO general_settings 
                (setting_key, setting_value, setting_type, updated_at)
                VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            ''', (key, setting_value, setting_type))
            conn.commit()
            logger.debug(f"Set general setting {key} = {value}")
    
    def get_version(self) -> str:
        """Get the current version from database"""
        return self.get_general_setting('current_version', 'N/A')
    
    def set_version(self, version: str):
        """Set the current version in database"""
        self.set_general_setting('current_version', version.strip())
        logger.debug(f"Version stored in database: {version.strip()}")
    
    def get_all_app_types(self) -> List[str]:
        """Get list of all app types in database"""
        with self.get_connection() as conn:
            cursor = conn.execute('SELECT app_type FROM app_configs ORDER BY app_type')
            return [row[0] for row in cursor.fetchall()]
    
    def initialize_from_defaults(self):
        """Initialize database with default configurations if empty"""
        from src.primary.default_settings import get_all_app_types, get_default_config
        
        for app_type in get_all_app_types():
            # Check if config already exists
            existing_config = self.get_app_config(app_type) if app_type != 'general' else self.get_general_settings()
            
            if not existing_config:
                try:
                    # Get default config from Python module
                    default_config = get_default_config(app_type)
                    
                    if app_type == 'general':
                        self.save_general_settings(default_config)
                    else:
                        self.save_app_config(app_type, default_config)
                    
                    logger.info(f"Initialized {app_type} with default configuration")
                except Exception as e:
                    logger.error(f"Failed to initialize {app_type} from defaults: {e}")
    

