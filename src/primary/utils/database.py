"""
SQLite Database Manager for Huntarr
Replaces all JSON file operations with SQLite database for better performance and reliability.
Handles both app configurations, general settings, and stateful management data.
"""

import os
import json
import sqlite3
from pathlib import Path
from typing import Dict, List, Any, Optional, Set
from datetime import datetime, timedelta
import logging
import time

logger = logging.getLogger(__name__)

class HuntarrDatabase:
    """Database manager for all Huntarr configurations and settings"""
    
    def __init__(self):
        self.db_path = self._get_database_path()
        self.ensure_database_exists()
    
    def execute_query(self, query: str, params: tuple = None) -> List[tuple]:
        """Execute a raw SQL query and return results"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            if params:
                cursor.execute(query, params)
            else:
                cursor.execute(query)
            return cursor.fetchall()
    
    def _configure_connection(self, conn):
        """Configure SQLite connection with cross-platform compatible settings"""
        try:
            conn.execute('PRAGMA foreign_keys = ON')
            
            # Try WAL mode first, fall back to DELETE mode on Windows if it fails
            try:
                conn.execute('PRAGMA journal_mode = WAL')
            except Exception as wal_error:
                logger.warning(f"WAL mode failed, using DELETE mode: {wal_error}")
                conn.execute('PRAGMA journal_mode = DELETE')
                
            conn.execute('PRAGMA synchronous = NORMAL')
            conn.execute('PRAGMA cache_size = 10000')
            conn.execute('PRAGMA temp_store = MEMORY')
            
            # Skip mmap on Windows if it causes issues
            import platform
            if platform.system() != "Windows":
                conn.execute('PRAGMA mmap_size = 268435456')
            
            # Only set WAL checkpoint if we're using WAL mode
            result = conn.execute('PRAGMA journal_mode').fetchone()
            if result and result[0] == 'wal':
                conn.execute('PRAGMA wal_autocheckpoint = 1000')
                
            conn.execute('PRAGMA busy_timeout = 30000')
        except Exception as e:
            logger.error(f"Error configuring database connection: {e}")
            # Continue with basic connection if configuration fails
            pass
    
    def get_connection(self):
        """Get a configured SQLite connection with Synology NAS compatibility"""
        try:
            conn = sqlite3.connect(self.db_path)
            self._configure_connection(conn)
            # Test the connection by running a simple query
            conn.execute("SELECT name FROM sqlite_master WHERE type='table' LIMIT 1").fetchone()
            return conn
        except (sqlite3.DatabaseError, sqlite3.OperationalError) as e:
            if "file is not a database" in str(e) or "database disk image is malformed" in str(e):
                logger.error(f"Database corruption detected: {e}")
                self._handle_database_corruption()
                # Try connecting again after recovery
                conn = sqlite3.connect(self.db_path)
                self._configure_connection(conn)
                return conn
            else:
                raise
    
    def _get_database_path(self) -> Path:
        """Get database path - use /config for Docker, Windows AppData, or local data directory"""
        # Check if running in Docker (config directory exists)
        config_dir = Path("/config")
        if config_dir.exists() and config_dir.is_dir():
            # Running in Docker - use persistent config directory
            return config_dir / "huntarr.db"
        
        # Check if we have a Windows-specific config directory set
        windows_config = os.environ.get("HUNTARR_CONFIG_DIR")
        if windows_config:
            config_path = Path(windows_config)
            config_path.mkdir(parents=True, exist_ok=True)
            return config_path / "huntarr.db"
        
        # Check if we're on Windows and use AppData
        import platform
        if platform.system() == "Windows":
            appdata = os.environ.get("APPDATA", os.path.expanduser("~"))
            windows_config_dir = Path(appdata) / "Huntarr"
            windows_config_dir.mkdir(parents=True, exist_ok=True)
            return windows_config_dir / "huntarr.db"
        
        # For local development on non-Windows, use data directory in project root
        project_root = Path(__file__).parent.parent.parent.parent
        data_dir = project_root / "data"
        
        # Ensure directory exists
        data_dir.mkdir(parents=True, exist_ok=True)
        return data_dir / "huntarr.db"

    def _handle_database_corruption(self):
        """Handle database corruption by creating backup and starting fresh"""
        import time
        
        logger.error(f"Handling database corruption for: {self.db_path}")
        
        try:
            # Create backup of corrupted database if it exists
            if self.db_path.exists():
                backup_path = self.db_path.parent / f"huntarr_corrupted_backup_{int(time.time())}.db"
                self.db_path.rename(backup_path)
                logger.warning(f"Corrupted database backed up to: {backup_path}")
                logger.warning("Starting with fresh database - all previous data has been backed up but will be lost")
            
            # Ensure the corrupted file is completely removed
            if self.db_path.exists():
                self.db_path.unlink()
                
        except Exception as backup_error:
            logger.error(f"Error during database corruption recovery: {backup_error}")
            # Force remove the corrupted file
            try:
                if self.db_path.exists():
                    self.db_path.unlink()
            except:
                pass

    def _check_database_integrity(self) -> bool:
        """Check if database integrity is intact"""
        try:
            with self.get_connection() as conn:
                # Run SQLite integrity check
                result = conn.execute("PRAGMA integrity_check").fetchone()
                if result and result[0] == "ok":
                    return True
                else:
                    logger.error(f"Database integrity check failed: {result}")
                    return False
        except Exception as e:
            logger.error(f"Database integrity check failed with error: {e}")
            return False
    
    def ensure_database_exists(self):
        """Create database and all tables if they don't exist"""
        try:
            # Ensure the database directory exists and is writable
            db_dir = self.db_path.parent
            db_dir.mkdir(parents=True, exist_ok=True)
            
            # Test write permissions
            test_file = db_dir / f"db_test_{int(time.time())}.tmp"
            try:
                test_file.write_text("test")
                test_file.unlink()
            except Exception as perm_error:
                logger.error(f"Database directory not writable: {db_dir} - {perm_error}")
                # On Windows, try an alternative location
                import platform
                if platform.system() == "Windows":
                    alt_dir = Path(os.path.expanduser("~")) / "Documents" / "Huntarr"
                    alt_dir.mkdir(parents=True, exist_ok=True)
                    self.db_path = alt_dir / "huntarr.db"
                    logger.info(f"Using alternative database location: {self.db_path}")
                else:
                    raise perm_error
            
        except Exception as e:
            logger.error(f"Error setting up database directory: {e}")
            raise
            
        # Create all tables with corruption recovery
        try:
            self._create_all_tables()
        except (sqlite3.DatabaseError, sqlite3.OperationalError) as e:
            if "file is not a database" in str(e) or "database disk image is malformed" in str(e):
                logger.error(f"Database corruption detected during table creation: {e}")
                self._handle_database_corruption()
                # Try creating tables again after recovery
                self._create_all_tables()
            else:
                raise
                
    def _create_all_tables(self):
        """Create all database tables"""
        with self.get_connection() as conn:
            
            # Create app_configs table for all app settings
            conn.execute('''
                CREATE TABLE IF NOT EXISTS app_configs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    app_type TEXT NOT NULL UNIQUE,
                    config_data TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            
            # Create general_settings table for general/global settings
            conn.execute('''
                CREATE TABLE IF NOT EXISTS general_settings (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    setting_key TEXT NOT NULL UNIQUE,
                    setting_value TEXT NOT NULL,
                    setting_type TEXT DEFAULT 'string',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            
            # Create stateful_lock table for stateful management lock info
            conn.execute('''
                CREATE TABLE IF NOT EXISTS stateful_lock (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    created_at INTEGER NOT NULL,
                    expires_at INTEGER NOT NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            
            # Create stateful_processed_ids table for processed media IDs
            conn.execute('''
                CREATE TABLE IF NOT EXISTS stateful_processed_ids (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    app_type TEXT NOT NULL,
                    instance_name TEXT NOT NULL,
                    media_id TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(app_type, instance_name, media_id)
                )
            ''')
            
            # Create media_stats table for tracking hunted/upgraded media statistics
            conn.execute('''
                CREATE TABLE IF NOT EXISTS media_stats (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    app_type TEXT NOT NULL,
                    stat_type TEXT NOT NULL,
                    stat_value INTEGER DEFAULT 0,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(app_type, stat_type)
                )
            ''')
            
            # Create hourly_caps table for API usage tracking
            conn.execute('''
                CREATE TABLE IF NOT EXISTS hourly_caps (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    app_type TEXT NOT NULL UNIQUE,
                    api_hits INTEGER DEFAULT 0,
                    last_reset_hour INTEGER DEFAULT 0,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            
            # Create sleep_data table for cycle tracking
            conn.execute('''
                CREATE TABLE IF NOT EXISTS sleep_data (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    app_type TEXT NOT NULL UNIQUE,
                    next_cycle_time TEXT,
                    cycle_lock BOOLEAN DEFAULT FALSE,
                    last_cycle_start TEXT,
                    last_cycle_end TEXT,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            
            # Create swaparr_stats table for Swaparr-specific statistics
            conn.execute('''
                CREATE TABLE IF NOT EXISTS swaparr_stats (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    stat_key TEXT NOT NULL UNIQUE,
                    stat_value INTEGER DEFAULT 0,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            
            # History table moved to manager.db - remove this table if it exists
            conn.execute('DROP TABLE IF EXISTS history')
            
            # Create schedules table for storing scheduled actions
            conn.execute('''
                CREATE TABLE IF NOT EXISTS schedules (
                    id TEXT PRIMARY KEY,
                    app_type TEXT NOT NULL,
                    action TEXT NOT NULL,
                    time_hour INTEGER NOT NULL,
                    time_minute INTEGER NOT NULL,
                    days TEXT NOT NULL,
                    app_instance TEXT NOT NULL,
                    enabled BOOLEAN DEFAULT TRUE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            
            # Create state_data table for state management (processed IDs and reset times)
            conn.execute('''
                CREATE TABLE IF NOT EXISTS state_data (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    app_type TEXT NOT NULL,
                    state_type TEXT NOT NULL,
                    state_data TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(app_type, state_type)
                )
            ''')
            
            # Create swaparr_state table for Swaparr-specific state management
            conn.execute('''
                CREATE TABLE IF NOT EXISTS swaparr_state (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    app_name TEXT NOT NULL,
                    state_type TEXT NOT NULL,
                    state_data TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(app_name, state_type)
                )
            ''')
            
            # Create users table for authentication and user management
            conn.execute('''
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT NOT NULL UNIQUE,
                    password TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    two_fa_enabled BOOLEAN DEFAULT FALSE,
                    two_fa_secret TEXT,
                    temp_2fa_secret TEXT,
                    plex_token TEXT,
                    plex_user_data TEXT,
                    recovery_key TEXT
                )
            ''')
            
            # Create sponsors table for GitHub sponsors data
            conn.execute('''
                CREATE TABLE IF NOT EXISTS sponsors (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    login TEXT NOT NULL UNIQUE,
                    name TEXT NOT NULL,
                    avatar_url TEXT NOT NULL,
                    url TEXT NOT NULL,
                    tier TEXT DEFAULT 'Supporter',
                    monthly_amount INTEGER DEFAULT 0,
                    category TEXT DEFAULT 'past',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            
            # Create logs table for all application logs
            conn.execute('''
                CREATE TABLE IF NOT EXISTS logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp DATETIME NOT NULL,
                    level TEXT NOT NULL,
                    app_type TEXT NOT NULL,
                    message TEXT NOT NULL,
                    logger_name TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            
            # Create hunt_history table for tracking processed media history
            conn.execute('''
                CREATE TABLE IF NOT EXISTS hunt_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    app_type TEXT NOT NULL,
                    instance_name TEXT NOT NULL,
                    media_id TEXT NOT NULL,
                    processed_info TEXT NOT NULL,
                    operation_type TEXT DEFAULT 'missing',
                    discovered BOOLEAN DEFAULT FALSE,
                    date_time INTEGER NOT NULL,
                    date_time_readable TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            
            # Add temp_2fa_secret column if it doesn't exist (for existing databases)
            try:
                conn.execute('ALTER TABLE users ADD COLUMN temp_2fa_secret TEXT')
                logger.info("Added temp_2fa_secret column to users table")
            except sqlite3.OperationalError:
                # Column already exists
                pass
            
            # Add recovery_key column if it doesn't exist (for existing databases)
            try:
                conn.execute('ALTER TABLE users ADD COLUMN recovery_key TEXT')
                logger.info("Added recovery_key column to users table")
            except sqlite3.OperationalError:
                # Column already exists
                pass
            
            # Add plex_linked_at column if it doesn't exist (for existing databases)
            try:
                conn.execute('ALTER TABLE users ADD COLUMN plex_linked_at INTEGER')
                logger.info("Added plex_linked_at column to users table")
            except sqlite3.OperationalError:
                # Column already exists
                pass
            
            # Create reset_requests table for reset request management
            conn.execute('''
                CREATE TABLE IF NOT EXISTS reset_requests (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    app_type TEXT NOT NULL,
                    timestamp INTEGER NOT NULL,
                    processed INTEGER NOT NULL,
                    processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            
            # Create indexes for better performance
            conn.execute('CREATE INDEX IF NOT EXISTS idx_app_configs_type ON app_configs(app_type)')
            conn.execute('CREATE INDEX IF NOT EXISTS idx_general_settings_key ON general_settings(setting_key)')
            conn.execute('CREATE INDEX IF NOT EXISTS idx_stateful_processed_app_instance ON stateful_processed_ids(app_type, instance_name)')
            conn.execute('CREATE INDEX IF NOT EXISTS idx_stateful_processed_media_id ON stateful_processed_ids(media_id)')
            conn.execute('CREATE INDEX IF NOT EXISTS idx_media_stats_app_type ON media_stats(app_type, stat_type)')
            conn.execute('CREATE INDEX IF NOT EXISTS idx_hourly_caps_app_type ON hourly_caps(app_type)')
            conn.execute('CREATE INDEX IF NOT EXISTS idx_sleep_data_app_type ON sleep_data(app_type)')
            conn.execute('CREATE INDEX IF NOT EXISTS idx_swaparr_stats_key ON swaparr_stats(stat_key)')
            conn.execute('CREATE INDEX IF NOT EXISTS idx_schedules_app_type ON schedules(app_type)')
            conn.execute('CREATE INDEX IF NOT EXISTS idx_schedules_enabled ON schedules(enabled)')
            conn.execute('CREATE INDEX IF NOT EXISTS idx_schedules_time ON schedules(time_hour, time_minute)')
            conn.execute('CREATE INDEX IF NOT EXISTS idx_state_data_app_type ON state_data(app_type, state_type)')
            conn.execute('CREATE INDEX IF NOT EXISTS idx_swaparr_state_app_name ON swaparr_state(app_name, state_type)')
            conn.execute('CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)')
            conn.execute('CREATE INDEX IF NOT EXISTS idx_sponsors_login ON sponsors(login)')
            conn.execute('CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp)')
            conn.execute('CREATE INDEX IF NOT EXISTS idx_logs_app_type ON logs(app_type)')
            conn.execute('CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(level)')
            conn.execute('CREATE INDEX IF NOT EXISTS idx_logs_app_level ON logs(app_type, level)')
            conn.execute('CREATE INDEX IF NOT EXISTS idx_hunt_history_app_instance ON hunt_history(app_type, instance_name)')
            conn.execute('CREATE INDEX IF NOT EXISTS idx_hunt_history_date_time ON hunt_history(date_time)')
            conn.execute('CREATE INDEX IF NOT EXISTS idx_hunt_history_media_id ON hunt_history(media_id)')
            conn.execute('CREATE INDEX IF NOT EXISTS idx_hunt_history_operation_type ON hunt_history(operation_type)')
            
            conn.commit()
            logger.info(f"Database initialized at: {self.db_path}")
    
    def get_app_config(self, app_type: str) -> Optional[Dict[str, Any]]:
        """Get app configuration from database"""
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
        """Save general settings to database"""
        with self.get_connection() as conn:
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
            # Auto-save enabled - no need to log every successful save
    
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
    
    def initialize_from_defaults(self, defaults_dir: Path):
        """Initialize database with default configurations if empty"""
        app_types = ['sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros', 'swaparr', 'general']
        
        for app_type in app_types:
            # Check if config already exists
            existing_config = self.get_app_config(app_type) if app_type != 'general' else self.get_general_settings()
            
            if not existing_config:
                # Load default config
                default_file = defaults_dir / f"{app_type}.json"
                if default_file.exists():
                    try:
                        with open(default_file, 'r') as f:
                            default_config = json.load(f)
                        
                        if app_type == 'general':
                            self.save_general_settings(default_config)
                        else:
                            self.save_app_config(app_type, default_config)
                        
                        logger.info(f"Initialized {app_type} with default configuration")
                    except Exception as e:
                        logger.error(f"Failed to initialize {app_type} from defaults: {e}")
    


    # Stateful Management Methods
    
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
            conn.commit()
            logger.info("Cleared all stateful management data from database")
    
    def get_stateful_summary(self, app_type: str, instance_name: str) -> Dict[str, Any]:
        """Get summary of stateful data for an app instance"""
        processed_ids = self.get_processed_ids(app_type, instance_name)
        return {
            "processed_count": len(processed_ids),
            "has_processed_items": len(processed_ids) > 0
        }

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
        """Reset all hourly API caps"""
        import datetime
        current_hour = datetime.datetime.now().hour
        
        with self.get_connection() as conn:
            conn.execute('''
                UPDATE hourly_caps SET api_hits = 0, last_reset_hour = ?, updated_at = CURRENT_TIMESTAMP
            ''', (current_hour,))
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
            for app in ['global', 'sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros']:
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
    
    def create_reset_request(self, app_type: str) -> bool:
        """Create a reset request for an app (replaces creating .reset files)"""
        try:
            with self.get_connection() as conn:
                conn.execute('''
                    INSERT OR REPLACE INTO reset_requests (app_type, timestamp, processed)
                    VALUES (?, ?, 0)
                ''', (app_type, int(time.time())))
                conn.commit()
                logger.info(f"Created reset request for {app_type}")
                return True
        except Exception as e:
            logger.error(f"Error creating reset request for {app_type}: {e}")
            return False
    
    def get_pending_reset_request(self, app_type: str) -> Optional[int]:
        """Check if there's a pending reset request for an app (replaces checking .reset files)"""
        with self.get_connection() as conn:
            cursor = conn.execute('''
                SELECT timestamp FROM reset_requests 
                WHERE app_type = ? AND processed = 0
                ORDER BY timestamp DESC LIMIT 1
            ''', (app_type,))
            row = cursor.fetchone()
            return row[0] if row else None
    
    def mark_reset_request_processed(self, app_type: str) -> bool:
        """Mark a reset request as processed (replaces deleting .reset files)"""
        try:
            with self.get_connection() as conn:
                conn.execute('''
                    UPDATE reset_requests 
                    SET processed = 1, processed_at = CURRENT_TIMESTAMP
                    WHERE app_type = ? AND processed = 0
                ''', (app_type,))
                conn.commit()
                logger.info(f"Marked reset request as processed for {app_type}")
                return True
        except Exception as e:
            logger.error(f"Error marking reset request as processed for {app_type}: {e}")
            return False

    # User Management Methods
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
    
    def create_user(self, username: str, password: str, two_fa_enabled: bool = False, 
                   two_fa_secret: str = None, plex_token: str = None, 
                   plex_user_data: Dict[str, Any] = None) -> bool:
        """Create a new user"""
        try:
            plex_data_json = json.dumps(plex_user_data) if plex_user_data else None
            
            with self.get_connection() as conn:
                conn.execute('''
                    INSERT INTO users (username, password, two_fa_enabled, two_fa_secret, 
                                     plex_token, plex_user_data, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                ''', (username, password, two_fa_enabled, two_fa_secret, plex_token, plex_data_json))
                conn.commit()
                logger.info(f"Created user: {username}")
                return True
        except Exception as e:
            logger.error(f"Error creating user {username}: {e}")
            return False
    
    def update_user_password(self, username: str, new_password: str) -> bool:
        """Update user password"""
        try:
            with self.get_connection() as conn:
                conn.execute('''
                    UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP 
                    WHERE username = ?
                ''', (new_password, username))
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
    def generate_recovery_key(self, username: str) -> Optional[str]:
        """Generate a new recovery key for a user"""
        import hashlib
        import secrets
        import random
        
        # Word lists for generating human-readable recovery keys
        adjectives = ['ocean', 'storm', 'frost', 'light', 'dark', 'swift', 'calm', 'wild', 'bright', 'deep']
        nouns = ['tower', 'bridge', 'quest', 'dream', 'flame', 'river', 'mountain', 'crystal', 'shadow', 'star']
        
        try:
            # Generate a human-readable recovery key like "ocean-light-tower-51"
            adj = random.choice(adjectives)
            noun1 = random.choice(nouns)
            noun2 = random.choice(nouns)
            number = random.randint(10, 99)
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
    
    def add_sponsor(self, sponsor_data: Dict[str, Any]):
        """Add or update a single sponsor"""
        with self.get_connection() as conn:
            conn.execute('''
                INSERT OR REPLACE INTO sponsors (login, name, avatar_url, url, tier, monthly_amount, category)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            ''', (
                sponsor_data.get('login', ''),
                sponsor_data.get('name', sponsor_data.get('login', 'Unknown')),
                sponsor_data.get('avatarUrl', ''),
                sponsor_data.get('url', '#'),
                sponsor_data.get('tier', 'Supporter'),
                sponsor_data.get('monthlyAmount', 0),
                sponsor_data.get('category', 'past')
            ))

    # Logs Database Methods
    def insert_log(self, timestamp: datetime, level: str, app_type: str, message: str, logger_name: str = None):
        """Insert a new log entry"""
        try:
            with self.get_connection() as conn:
                conn.execute('''
                    INSERT INTO logs (timestamp, level, app_type, message, logger_name)
                    VALUES (?, ?, ?, ?, ?)
                ''', (timestamp.isoformat(), level, app_type, message, logger_name))
                conn.commit()
        except Exception as e:
            logger.error(f"Error inserting log entry: {e}")
    
    def get_logs(self, app_type: str = None, level: str = None, limit: int = 100, offset: int = 0, search: str = None) -> List[Dict[str, Any]]:
        """Get logs with optional filtering"""
        try:
            with self.get_connection() as conn:
                conn.row_factory = sqlite3.Row
                
                # Build query with filters
                query = "SELECT * FROM logs WHERE 1=1"
                params = []
                
                if app_type:
                    query += " AND app_type = ?"
                    params.append(app_type)
                
                if level:
                    query += " AND level = ?"
                    params.append(level)
                
                if search:
                    query += " AND message LIKE ?"
                    params.append(f"%{search}%")
                
                query += " ORDER BY timestamp DESC LIMIT ? OFFSET ?"
                params.extend([limit, offset])
                
                cursor = conn.execute(query, params)
                rows = cursor.fetchall()
                
                return [dict(row) for row in rows]
        except Exception as e:
            logger.error(f"Error getting logs: {e}")
            return []
    
    def get_log_count(self, app_type: str = None, level: str = None, search: str = None) -> int:
        """Get total count of logs matching filters"""
        try:
            with self.get_connection() as conn:
                query = "SELECT COUNT(*) FROM logs WHERE 1=1"
                params = []
                
                if app_type:
                    query += " AND app_type = ?"
                    params.append(app_type)
                
                if level:
                    query += " AND level = ?"
                    params.append(level)
                
                if search:
                    query += " AND message LIKE ?"
                    params.append(f"%{search}%")
                
                cursor = conn.execute(query, params)
                return cursor.fetchone()[0]
        except Exception as e:
            logger.error(f"Error getting log count: {e}")
            return 0
    
    def cleanup_old_logs(self, days_to_keep: int = 30, max_entries_per_app: int = 10000):
        """Clean up old logs based on age and count limits"""
        try:
            with self.get_connection() as conn:
                # Time-based cleanup
                cutoff_date = datetime.now() - timedelta(days=days_to_keep)
                cursor = conn.execute(
                    "DELETE FROM logs WHERE timestamp < ?",
                    (cutoff_date.isoformat(),)
                )
                deleted_by_age = cursor.rowcount
                
                # Count-based cleanup per app type
                app_types = ['system', 'sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros', 'swaparr']
                total_deleted_by_count = 0
                
                for app_type in app_types:
                    cursor = conn.execute('''
                        DELETE FROM logs 
                        WHERE app_type = ? AND id NOT IN (
                            SELECT id FROM logs 
                            WHERE app_type = ? 
                            ORDER BY timestamp DESC 
                            LIMIT ?
                        )
                    ''', (app_type, app_type, max_entries_per_app))
                    total_deleted_by_count += cursor.rowcount
                
                conn.commit()
                
                if deleted_by_age > 0 or total_deleted_by_count > 0:
                    logger.info(f"Cleaned up logs: {deleted_by_age} by age, {total_deleted_by_count} by count")
                
                return deleted_by_age + total_deleted_by_count
        except Exception as e:
            logger.error(f"Error cleaning up logs: {e}")
            return 0
    
    def get_app_types_from_logs(self) -> List[str]:
        """Get list of all app types that have logs"""
        try:
            with self.get_connection() as conn:
                cursor = conn.execute("SELECT DISTINCT app_type FROM logs ORDER BY app_type")
                return [row[0] for row in cursor.fetchall()]
        except Exception as e:
            logger.error(f"Error getting app types from logs: {e}")
            return []
    
    def get_log_levels(self) -> List[str]:
        """Get list of all log levels that exist"""
        try:
            with self.get_connection() as conn:
                cursor = conn.execute("SELECT DISTINCT level FROM logs ORDER BY level")
                return [row[0] for row in cursor.fetchall()]
        except Exception as e:
            logger.error(f"Error getting log levels: {e}")
            return []
    
    def clear_logs(self, app_type: str = None):
        """Clear logs for a specific app type or all logs"""
        try:
            with self.get_connection() as conn:
                if app_type:
                    cursor = conn.execute("DELETE FROM logs WHERE app_type = ?", (app_type,))
                else:
                    cursor = conn.execute("DELETE FROM logs")
                
                deleted_count = cursor.rowcount
                conn.commit()
                
                logger.info(f"Cleared {deleted_count} logs" + (f" for {app_type}" if app_type else ""))
                return deleted_count
        except Exception as e:
            logger.error(f"Error clearing logs: {e}")
            return 0

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
                   page: int = 1, page_size: int = 20) -> Dict[str, Any]:
        """Get hunt history entries with pagination and filtering"""
        with self.get_connection() as conn:
            conn.row_factory = sqlite3.Row
            
            # Build WHERE clause
            where_conditions = []
            params = []
            
            if app_type and app_type != "all":
                where_conditions.append("app_type = ?")
                params.append(app_type)
            
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

# Global database instance
_database_instance = None

def get_database() -> HuntarrDatabase:
    """Get the global database instance"""
    global _database_instance
    if _database_instance is None:
        _database_instance = HuntarrDatabase()
    return _database_instance

# Logs Database Functions (consolidated from logs_database.py)
def get_logs_database() -> HuntarrDatabase:
    """Get the database instance for logs operations"""
    return get_database()

def schedule_log_cleanup():
    """Schedule periodic log cleanup - call this from background tasks"""
    import threading
    import time
    
    def cleanup_worker():
        """Background worker to clean up logs periodically"""
        while True:
            try:
                time.sleep(3600)  # Run every hour
                db = get_database()
                deleted_count = db.cleanup_old_logs(days_to_keep=30, max_entries_per_app=10000)
                if deleted_count > 0:
                    logger.info(f"Scheduled cleanup removed {deleted_count} old log entries")
            except Exception as e:
                logger.error(f"Error in scheduled log cleanup: {e}")
    
    # Start cleanup thread
    cleanup_thread = threading.Thread(target=cleanup_worker, daemon=True)
    cleanup_thread.start()
    logger.info("Scheduled log cleanup thread started")

# Manager Database Functions (consolidated from manager_database.py)
def get_manager_database() -> HuntarrDatabase:
    """Get the database instance for manager operations"""
    return get_database() 