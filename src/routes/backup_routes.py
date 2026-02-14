"""
Backup and Restore API routes for Huntarr
Handles database backup creation, restoration, and management
"""

import os
import json
import shutil
import sqlite3
import time
import threading
import zipfile
from datetime import datetime, timedelta
from pathlib import Path
from flask import Blueprint, request, jsonify, send_file
from src.primary.utils.database import get_database
from src.primary.routes.common import get_user_for_request
import logging

logger = logging.getLogger(__name__)

backup_bp = Blueprint('backup', __name__)

class BackupScheduler:
    """Handles automatic backup scheduling"""
    
    def __init__(self, backup_manager):
        self.backup_manager = backup_manager
        self.scheduler_thread = None
        self.stop_event = threading.Event()
        self.running = False
    
    def start(self):
        """Start the backup scheduler"""
        if self.running:
            return
        
        self.stop_event.clear()
        self.scheduler_thread = threading.Thread(target=self._scheduler_loop, daemon=True)
        self.scheduler_thread.start()
        self.running = True
        logger.info("Backup scheduler started")
    
    def stop(self):
        """Stop the backup scheduler"""
        if not self.running:
            return
        
        self.stop_event.set()
        if self.scheduler_thread:
            self.scheduler_thread.join(timeout=5)
        self.running = False
        logger.info("Backup scheduler stopped")
    
    def _scheduler_loop(self):
        """Main scheduler loop"""
        while not self.stop_event.is_set():
            try:
                if self._should_create_backup():
                    logger.info("Creating scheduled backup")
                    backup_info = self.backup_manager.create_backup('scheduled', None)
                    
                    # Update last backup time
                    self.backup_manager.db.set_general_setting('last_backup_time', backup_info['timestamp'])
                    logger.info(f"Scheduled backup created: {backup_info['name']}")
                
                # Check every hour
                self.stop_event.wait(3600)
                
            except Exception as e:
                logger.error(f"Error in backup scheduler: {e}")
                # Wait before retrying
                self.stop_event.wait(300)  # 5 minutes
    
    def _should_create_backup(self):
        """Check if a backup should be created"""
        try:
            settings = self.backup_manager.get_backup_settings()
            frequency_days = settings['frequency']
            
            last_backup_time = self.backup_manager.db.get_general_setting('last_backup_time')
            
            if not last_backup_time:
                # No previous backup, create one
                return True
            
            last_backup = datetime.fromisoformat(last_backup_time)
            next_backup = last_backup + timedelta(days=frequency_days)
            
            return datetime.now() >= next_backup
            
        except Exception as e:
            logger.error(f"Error checking backup schedule: {e}")
            return False

# Global backup scheduler instance
backup_scheduler = None

class BackupManager:
    """Manages database backups and restoration"""
    
    def __init__(self):
        self.db = get_database()
        self.backup_dir = self._get_backup_directory()
        self.ensure_backup_directory()
    
    def _get_backup_directory(self):
        """Get the backup directory path based on environment.
        Use the same config directory as the database so it works when frozen (macOS .app)
        and avoids writing inside the read-only app bundle.
        """
        # Database is already initialized and uses HUNTARR_CONFIG_DIR / Docker / Windows / project data
        return Path(self.db.db_path).parent / "backups"
    
    def ensure_backup_directory(self):
        """Ensure backup directory exists"""
        try:
            self.backup_dir.mkdir(parents=True, exist_ok=True)
            logger.info(f"Backup directory ensured: {self.backup_dir}")
        except Exception as e:
            logger.error(f"Failed to create backup directory: {e}")
            raise
    
    def get_backup_settings(self):
        """Get backup settings from database"""
        try:
            frequency = self.db.get_general_setting('backup_frequency', 3)
            retention = self.db.get_general_setting('backup_retention', 3)
            
            return {
                'frequency': int(frequency),
                'retention': int(retention)
            }
        except Exception as e:
            logger.error(f"Error getting backup settings: {e}")
            return {'frequency': 3, 'retention': 3}
    
    def save_backup_settings(self, settings):
        """Save backup settings to database"""
        try:
            self.db.set_general_setting('backup_frequency', settings.get('frequency', 3))
            self.db.set_general_setting('backup_retention', settings.get('retention', 3))
            logger.info(f"Backup settings saved: {settings}")
            return True
        except Exception as e:
            logger.error(f"Error saving backup settings: {e}")
            return False
    
    def create_backup(self, backup_type='manual', name=None):
        """Create a backup of all databases"""
        try:
            # Get current version
            version_file = Path(__file__).parent.parent.parent / "version.txt"
            version = "0.0.0"  # Default in case version file is not found
            if version_file.exists():
                version = version_file.read_text().strip()
            
            # Generate backup name if not provided
            if not name:
                timestamp = datetime.now().strftime("%Y.%m.%d_%H.%M.%S")
                name = f"huntarr_backup_v{version}_{timestamp}"
            
            # Create backup folder with timestamp
            backup_folder = self.backup_dir / name
            logger.info(f"Creating backup folder: {backup_folder}")
            backup_folder.mkdir(parents=True, exist_ok=True)
            
            # Get all database paths
            databases = self._get_all_database_paths()
            
            backup_info = {
                'id': name,
                'name': name,
                'type': backup_type,
                'timestamp': datetime.now().isoformat(),
                'databases': [],
                'size': 0
            }
            
            # Backup each database
            for db_name, db_path in databases.items():
                if Path(db_path).exists():
                    backup_db_path = backup_folder / f"{db_name}.db"
                    logger.info(f"Backing up {db_name} from {db_path} to {backup_db_path}")
                    
                    # Force WAL checkpoint before backup (with WAL mode enabled)
                    try:
                        conn = sqlite3.connect(db_path, timeout=30)
                        conn.execute("PRAGMA journal_mode = WAL")
                        conn.execute("PRAGMA busy_timeout = 30000")
                        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
                        conn.close()
                    except Exception as e:
                        logger.warning(f"Could not checkpoint {db_name}: {e}")
                    
                    # Copy database file
                    shutil.copy2(db_path, backup_db_path)
                    
                    # Verify backup integrity
                    if self._verify_database_integrity(backup_db_path):
                        db_size = backup_db_path.stat().st_size
                        backup_info['databases'].append({
                            'name': db_name,
                            'size': db_size,
                            'path': str(backup_db_path)
                        })
                        backup_info['size'] += db_size
                        logger.info(f"Backed up {db_name} ({db_size} bytes)")
                    else:
                        logger.error(f"Backup verification failed for {db_name}")
                        backup_db_path.unlink(missing_ok=True)
                        raise Exception(f"Backup verification failed for {db_name}")
            
            # Save backup metadata
            metadata_path = backup_folder / "backup_info.json"
            logger.info(f"Saving backup metadata to: {metadata_path}")
            with open(metadata_path, 'w') as f:
                json.dump(backup_info, f, indent=2)
            
            # Verify that the backup folder and metadata exist
            logger.info(f"Verifying backup folder contents:")
            for item in backup_folder.iterdir():
                logger.info(f"  {item.name}")
            
            # Clean up old backups based on retention policy
            self._cleanup_old_backups()
            
            logger.info(f"Backup created successfully: {name} ({backup_info['size']} bytes)")
            return backup_info
            
        except Exception as e:
            logger.error(f"Error creating backup: {e}")
            # Clean up failed backup
            if 'backup_folder' in locals() and backup_folder.exists():
                shutil.rmtree(backup_folder, ignore_errors=True)
            raise
    
    def _get_all_database_paths(self):
        """Get paths to all Huntarr databases"""
        databases = {}
        
        # Main database
        main_db_path = self.db.db_path
        databases['huntarr'] = str(main_db_path)
        
        # Logs database (if exists)
        logs_db_path = main_db_path.parent / "logs.db"
        if logs_db_path.exists():
            databases['logs'] = str(logs_db_path)
        
        # Manager database (if exists)
        manager_db_path = main_db_path.parent / "manager.db"
        if manager_db_path.exists():
            databases['manager'] = str(manager_db_path)
        
        return databases
    
    def _verify_database_integrity(self, db_path):
        """Verify database integrity"""
        try:
            conn = sqlite3.connect(db_path, timeout=30)
            conn.execute("PRAGMA journal_mode = WAL")
            conn.execute("PRAGMA busy_timeout = 30000")
            result = conn.execute("PRAGMA integrity_check").fetchone()
            conn.close()
            return result and result[0] == "ok"
        except Exception as e:
            logger.error(f"Database integrity check failed: {e}")
            return False
    
    def list_backups(self):
        """List all available backups"""
        try:
            backups = []
            
            if not self.backup_dir.exists():
                logger.info(f"Backup directory does not exist: {self.backup_dir}")
                return backups
            
            logger.info(f"Looking for backups in: {self.backup_dir}")
            
            for backup_folder in self.backup_dir.iterdir():
                if backup_folder.is_dir():
                    metadata_path = backup_folder / "backup_info.json"
                    
                    if metadata_path.exists():
                        try:
                            with open(metadata_path, 'r') as f:
                                backup_info = json.load(f)
                            backups.append(backup_info)
                        except Exception as e:
                            logger.warning(f"Could not read backup metadata for {backup_folder.name}: {e}")
                            # Create basic info from folder
                            backups.append({
                                'id': backup_folder.name,
                                'name': backup_folder.name,
                                'type': 'unknown',
                                'timestamp': datetime.fromtimestamp(backup_folder.stat().st_mtime).isoformat(),
                                'size': sum(f.stat().st_size for f in backup_folder.rglob('*.db') if f.is_file())
                            })
                    else:
                        logger.warning(f"Backup folder {backup_folder.name} does not contain backup_info.json")
            
            # Sort by timestamp (newest first)
            backups.sort(key=lambda x: x['timestamp'], reverse=True)
            logger.info(f"Found {len(backups)} backups")
            return backups
            
        except Exception as e:
            logger.error(f"Error listing backups: {e}")
            return []
    
    def restore_backup(self, backup_id):
        """Restore a backup"""
        try:
            backup_folder = self.backup_dir / backup_id
            
            if not backup_folder.exists():
                raise Exception(f"Backup not found: {backup_id}")
            
            # Load backup metadata
            metadata_path = backup_folder / "backup_info.json"
            if metadata_path.exists():
                with open(metadata_path, 'r') as f:
                    backup_info = json.load(f)
            else:
                raise Exception("Backup metadata not found")
            
            # Get current database paths
            databases = self._get_all_database_paths()
            
            # Create backup of current databases before restore
            # Get current version
            version_file = Path(__file__).parent.parent.parent / "version.txt"
            version = "0.0.0"  # Default in case version file is not found
            if version_file.exists():
                version = version_file.read_text().strip()
            
            # Generate timestamp in the required format
            timestamp = datetime.now().strftime("%Y.%m.%d_%H.%M.%S")
            current_backup_name = f"huntarr_pre_restore_backup_v{version}_{timestamp}"
            logger.info(f"Creating backup of current databases: {current_backup_name}")
            self.create_backup('pre-restore', current_backup_name)
            
            # Restore each database
            restored_databases = []
            for db_info in backup_info.get('databases', []):
                db_name = db_info['name']
                backup_db_path = Path(db_info['path'])
                
                if db_name in databases and backup_db_path.exists():
                    current_db_path = Path(databases[db_name])
                    
                    # Verify backup database integrity
                    if not self._verify_database_integrity(backup_db_path):
                        raise Exception(f"Backup database {db_name} is corrupted")
                    
                    # Stop any connections to the database
                    if hasattr(self.db, 'close_connections'):
                        self.db.close_connections()
                    
                    # Replace current database with backup (also clean WAL/SHM)
                    if current_db_path.exists():
                        current_db_path.unlink()
                    for suffix in ["-wal", "-shm"]:
                        wal_file = Path(str(current_db_path) + suffix)
                        if wal_file.exists():
                            wal_file.unlink()
                    
                    shutil.copy2(backup_db_path, current_db_path)
                    
                    # Verify restored database
                    if self._verify_database_integrity(current_db_path):
                        restored_databases.append(db_name)
                        logger.info(f"Restored database: {db_name}")
                    else:
                        raise Exception(f"Restored database {db_name} failed integrity check")
            
            # Reset database singletons so they pick up the restored data
            try:
                from src.primary.utils.database import _reset_database_instances
                _reset_database_instances()
                logger.info("Database singletons reset after restore")
            except Exception as reset_error:
                logger.warning(f"Could not reset database singletons after restore: {reset_error}")
            
            logger.info(f"Backup restored successfully: {backup_id}")
            return {
                'backup_id': backup_id,
                'restored_databases': restored_databases,
                'timestamp': datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Error restoring backup: {e}")
            raise
    
    def delete_backup(self, backup_id):
        """Delete a backup"""
        try:
            # Ensure we're using the exact backup ID that was stored
            backup_folder = self.backup_dir / backup_id
            
            # Debug: Log what we're looking for
            logger.info(f"Looking for backup folder: {backup_folder}")
            logger.info(f"Backup folder exists: {backup_folder.exists()}")
            
            # If the exact path doesn't exist, let's see what files are actually there
            if not backup_folder.exists():
                logger.info(f"Backup directory contents:")
                if self.backup_dir.exists():
                    for item in self.backup_dir.iterdir():
                        logger.info(f"  {item.name}")
                        if item.is_dir():
                            logger.info(f"    Directory contents:")
                            for sub_item in item.iterdir():
                                logger.info(f"      {sub_item.name}")
                else:
                    logger.info("Backup directory does not exist!")
                
                # Try to find a folder with a similar name (in case of encoding issues)
                logger.info("Attempting to find backup folder with similar name...")
                found_backup = None
                for item in self.backup_dir.iterdir():
                    if item.is_dir() and backup_id in item.name:
                        logger.info(f"Found similar backup: {item.name}")
                        found_backup = item
                        break
                
                # If we didn't find an exact match but we have backups with numeric IDs
                # that might match the name pattern, let's also check for the numeric prefix
                if not found_backup:
                    # Check if backup_id is a human-readable name and try to find a matching numeric backup
                    for item in self.backup_dir.iterdir():
                        if item.is_dir() and item.name.startswith("uploaded_backup_"):
                            # Check if the backup_info.json exists and has matching name
                            metadata_path = item / "backup_info.json"
                            if metadata_path.exists():
                                try:
                                    with open(metadata_path, 'r') as f:
                                        backup_info = json.load(f)
                                    # Check if the backup name matches (case insensitive)
                                    if backup_info.get('name', '').lower() == backup_id.lower():
                                        logger.info(f"Found backup by name match: {item.name}")
                                        found_backup = item
                                        break
                                except Exception as e:
                                    logger.warning(f"Could not read metadata for {item.name}: {e}")
                
                if found_backup:
                    backup_folder = found_backup
                else:
                    # Try a more flexible approach - check if backup_id might be a timestamp or pattern
                    # by looking for backups that have backup_info.json with matching name
                    for item in self.backup_dir.iterdir():
                        if item.is_dir():
                            metadata_path = item / "backup_info.json"
                            if metadata_path.exists():
                                try:
                                    with open(metadata_path, 'r') as f:
                                        backup_info = json.load(f)
                                    # Check if backup_id matches the name or ID in the metadata
                                    if (backup_info.get('id') == backup_id or 
                                        backup_info.get('name') == backup_id or
                                        backup_id in backup_info.get('name', '')):
                                        logger.info(f"Found backup by metadata match: {item.name}")
                                        backup_folder = item
                                        break
                                except Exception as e:
                                    logger.warning(f"Could not read metadata for {item.name}: {e}")
                
                if not backup_folder.exists():
                    raise Exception(f"Backup not found: {backup_id}")
            
            shutil.rmtree(backup_folder)
            logger.info(f"Backup deleted: {backup_id}")
            return True
            
        except Exception as e:
            logger.error(f"Error deleting backup: {e}")
            raise
    
    def delete_database(self):
        """Delete the current database (destructive operation).
        
        Also cleans up WAL/SHM files and resets the global database singleton
        so the app properly detects 'no user' state and redirects to setup.
        """
        try:
            databases = self._get_all_database_paths()
            deleted_databases = []
            
            for db_name, db_path in databases.items():
                db_file = Path(db_path)
                if db_file.exists():
                    db_file.unlink()
                    deleted_databases.append(db_name)
                    logger.warning(f"Deleted database: {db_name}")
                
                # Also delete WAL and SHM files to prevent stale data on next startup
                for suffix in ["-wal", "-shm"]:
                    wal_file = Path(str(db_path) + suffix)
                    if wal_file.exists():
                        wal_file.unlink()
                        logger.warning(f"Deleted {db_name}{suffix}")
            
            # Reset global database singletons so the app reinitializes cleanly
            try:
                from src.primary.utils.database import _reset_database_instances
                _reset_database_instances()
                logger.info("Database singletons reset after deletion")
            except Exception as reset_error:
                logger.warning(f"Could not reset database singletons: {reset_error}")
            
            logger.warning(f"Database deletion completed: {deleted_databases}")
            return deleted_databases
            
        except Exception as e:
            logger.error(f"Error deleting database: {e}")
            raise
    
    def _cleanup_old_backups(self):
        """Clean up old backups based on retention policy"""
        try:
            settings = self.get_backup_settings()
            retention_count = settings['retention']
            
            backups = self.list_backups()
            
            # Keep only the most recent backups
            if len(backups) > retention_count:
                backups_to_delete = backups[retention_count:]
                
                for backup in backups_to_delete:
                    try:
                        self.delete_backup(backup['id'])
                        logger.info(f"Cleaned up old backup: {backup['id']}")
                    except Exception as e:
                        logger.warning(f"Failed to clean up backup {backup['id']}: {e}")
            
        except Exception as e:
            logger.error(f"Error during backup cleanup: {e}")
    
    def get_next_scheduled_backup(self):
        """Get the next scheduled backup time"""
        try:
            settings = self.get_backup_settings()
            frequency_days = settings['frequency']
            
            # Get the last backup time
            last_backup_time = self.db.get_general_setting('last_backup_time')
            
            if last_backup_time:
                last_backup = datetime.fromisoformat(last_backup_time)
                next_backup = last_backup + timedelta(days=frequency_days)
            else:
                # If no previous backup, schedule for tomorrow
                next_backup = datetime.now() + timedelta(days=1)
            
            return next_backup.isoformat()
            
        except Exception as e:
            logger.error(f"Error calculating next backup time: {e}")
            return None

# Initialize backup manager and scheduler
backup_manager = BackupManager()
backup_scheduler = BackupScheduler(backup_manager)

# Start the backup scheduler
backup_scheduler.start()

@backup_bp.route('/api/backup/settings', methods=['GET', 'POST'])
def backup_settings():
    """Get or set backup settings"""
    username = get_user_for_request()
    if not username:
        return jsonify({"success": False, "error": "Authentication required"}), 401
    
    try:
        if request.method == 'GET':
            settings = backup_manager.get_backup_settings()
            return jsonify({
                'success': True,
                'settings': settings
            })
        
        elif request.method == 'POST':
            data = request.get_json() or {}
            
            # Validate settings
            try:
                frequency = int(data.get('frequency', 3))
                retention = int(data.get('retention', 3))
            except (TypeError, ValueError):
                return jsonify({"success": False, "error": "Frequency and retention must be valid integers"}), 400
            
            if frequency < 1 or frequency > 30:
                return jsonify({"success": False, "error": "Frequency must be between 1 and 30 days"}), 400
            
            if retention < 1 or retention > 10:
                return jsonify({"success": False, "error": "Retention must be between 1 and 10 backups"}), 400
            
            settings = {
                'frequency': frequency,
                'retention': retention
            }
            
            if backup_manager.save_backup_settings(settings):
                return jsonify({
                    'success': True,
                    'settings': settings
                })
            else:
                return jsonify({"success": False, "error": "Failed to save settings"}), 500
    
    except Exception as e:
        logger.error(f"Error in backup settings: {e}")
        return jsonify({"success": False, "error": str(e)}), 500

@backup_bp.route('/api/backup/create', methods=['POST'])
def create_backup():
    """Create a manual backup"""
    username = get_user_for_request()
    if not username:
        return jsonify({"success": False, "error": "Authentication required"}), 401
    
    try:
        data = request.get_json() or {}
        backup_type = data.get('type', 'manual')
        
        backup_info = backup_manager.create_backup(backup_type)
        
        # Update last backup time
        backup_manager.db.set_general_setting('last_backup_time', backup_info['timestamp'])
        
        return jsonify({
            'success': True,
            'backup_name': backup_info['name'],
            'backup_size': backup_info['size'],
            'timestamp': backup_info['timestamp']
        })
    
    except Exception as e:
        logger.error(f"Error creating backup: {e}")
        return jsonify({"success": False, "error": str(e)}), 500

@backup_bp.route('/api/backup/list', methods=['GET'])
def list_backups():
    """List all available backups"""
    username = get_user_for_request()
    if not username:
        return jsonify({"success": False, "error": "Authentication required"}), 401
    
    try:
        backups = backup_manager.list_backups()
        return jsonify({
            'success': True,
            'backups': backups
        })
    
    except Exception as e:
        logger.error(f"Error listing backups: {e}")
        return jsonify({"success": False, "error": str(e)}), 500

@backup_bp.route('/api/backup/restore', methods=['POST'])
def restore_backup():
    """Restore a backup"""
    username = get_user_for_request()
    if not username:
        return jsonify({"success": False, "error": "Authentication required"}), 401
    
    try:
        data = request.get_json() or {}
        backup_id = data.get('backup_id')
        
        if not backup_id:
            return jsonify({"success": False, "error": "Backup ID required"}), 400
        
        restore_info = backup_manager.restore_backup(backup_id)
        
        return jsonify({
            'success': True,
            'restore_info': restore_info
        })
    
    except Exception as e:
        logger.error(f"Error restoring backup: {e}")
        return jsonify({"success": False, "error": str(e)}), 500

@backup_bp.route('/api/backup/delete', methods=['POST'])
def delete_backup():
    """Delete a backup"""
    username = get_user_for_request()
    if not username:
        return jsonify({"success": False, "error": "Authentication required"}), 401
    
    try:
        data = request.get_json() or {}
        backup_id = data.get('backup_id')
        
        logger.info(f"Deleting backup: {backup_id}")
        logger.info(f"Backup ID type: {type(backup_id)}")
        logger.info(f"Backup ID length: {len(backup_id) if backup_id else 0}")
        
        # Add extra validation for backup_id
        if not backup_id or not isinstance(backup_id, str):
            return jsonify({"success": False, "error": "Invalid backup ID provided for deletion"}), 400
        
        # Additional debugging - check if the backup_id contains special characters
        logger.info(f"Backup ID raw: {backup_id}")
        logger.info(f"Backup ID repr: {repr(backup_id)}")
        
        backup_manager.delete_backup(backup_id)
        
        return jsonify({
            'success': True,
            'message': f'Backup {backup_id} deleted successfully'
        })
    
    except Exception as e:
        logger.error(f"Error deleting backup: {e}")
        return jsonify({"success": False, "error": str(e)}), 500

@backup_bp.route('/api/backup/delete-database', methods=['POST'])
def delete_database():
    """Delete the current database (destructive operation)"""
    username = get_user_for_request()
    if not username:
        return jsonify({"success": False, "error": "Authentication required"}), 401
    
    try:
        deleted_databases = backup_manager.delete_database()
        
        return jsonify({
            'success': True,
            'deleted_databases': deleted_databases,
            'message': 'Database deleted successfully'
        })
    
    except Exception as e:
        logger.error(f"Error deleting database: {e}")
        return jsonify({"success": False, "error": str(e)}), 500

@backup_bp.route('/api/backup/next-scheduled', methods=['GET'])
def next_scheduled_backup():
    """Get the next scheduled backup time"""
    username = get_user_for_request()
    if not username:
        return jsonify({"success": False, "error": "Authentication required"}), 401
    
    try:
        next_backup = backup_manager.get_next_scheduled_backup()
        
        return jsonify({
            'success': True,
            'next_backup': next_backup
        })
    
    except Exception as e:
        logger.error(f"Error getting next backup time: {e}")
        return jsonify({"success": False, "error": str(e)}), 500

@backup_bp.route('/api/backup/download/<backup_id>', methods=['GET'])
def download_backup(backup_id):
    """Download a backup as a ZIP file"""
    username = get_user_for_request()
    if not username:
        return jsonify({"success": False, "error": "Authentication required"}), 401
    
    try:
        # Validate backup exists
        backup_folder = backup_manager.backup_dir / backup_id
        if not backup_folder.exists():
            return jsonify({"success": False, "error": "Backup not found"}), 404
        
        # Create a temporary ZIP file
        import tempfile
        import uuid
        
        # Create a unique temporary file name
        temp_zip_path = Path(tempfile.gettempdir()) / f"backup_{uuid.uuid4()}.zip"
        
        # Create ZIP file
        with zipfile.ZipFile(temp_zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            # Add all files in backup folder to ZIP
            for file_path in backup_folder.rglob('*'):
                if file_path.is_file():
                    # Add file to ZIP with relative path
                    zipf.write(file_path, file_path.relative_to(backup_manager.backup_dir.parent))
        
        # Return ZIP file as download
        return send_file(
            str(temp_zip_path),
            as_attachment=True,
            download_name=f"{backup_id}.zip"
        )
        
    except Exception as e:
        logger.error(f"Error downloading backup: {e}")
        return jsonify({"success": False, "error": str(e)}), 500

@backup_bp.route('/api/backup/upload', methods=['POST'])
def upload_backup():
    """Upload and restore a backup from a ZIP file"""
    username = get_user_for_request()
    if not username:
        return jsonify({"success": False, "error": "Authentication required"}), 401
    
    try:
        if 'backup_file' not in request.files:
            return jsonify({"success": False, "error": "No backup file provided"}), 400
        
        file = request.files['backup_file']
        if file.filename == '':
            return jsonify({"success": False, "error": "No file selected"}), 400
        
        if not file or not file.filename.endswith('.zip'):
            return jsonify({"success": False, "error": "Invalid file type. Please upload a .zip file"}), 400
        
        # Create a temporary directory to extract the backup
        import tempfile
        import uuid
        
        temp_dir = Path(tempfile.gettempdir()) / f"upload_backup_{uuid.uuid4()}"
        temp_dir.mkdir(parents=True, exist_ok=True)
        
        # Save uploaded file temporarily
        temp_zip_path = temp_dir / "backup.zip"
        file.save(str(temp_zip_path))
        
        # Extract ZIP file
        with zipfile.ZipFile(temp_zip_path, 'r') as zipf:
            zipf.extractall(str(temp_dir))
        
        # Find the backup metadata file - more robust approach
        metadata_path = None
        
        # Log the structure of the extracted directory for debugging
        logger.info(f"Extracted directory structure: {list(temp_dir.rglob('*'))}")
        
        # Method 1: Look for backup_info.json directly in the temp directory
        for file_path in temp_dir.rglob('backup_info.json'):
            metadata_path = file_path
            break
        
        # Method 2: Look for directories that contain backup_info.json
        if not metadata_path:
            for item in temp_dir.iterdir():
                if item.is_dir():
                    backup_info_file = item / "backup_info.json"
                    if backup_info_file.exists():
                        metadata_path = backup_info_file
                        break
        
        # Method 3: Look for any directory that contains both DB files and backup_info.json
        if not metadata_path:
            # Look for directories that contain database files
            for item in temp_dir.iterdir():
                if item.is_dir():
                    # Check if this directory contains database files
                    db_files = list(item.rglob('*.db'))
                    if db_files:
                        # Check if it also has backup_info.json
                        backup_info_file = item / "backup_info.json"
                        if backup_info_file.exists():
                            metadata_path = backup_info_file
                            break
        
        # Method 4: Look for a specific pattern - if we have a directory with a backup_info.json file
        # that's in a structure like: backup_name/backup_info.json or backup_name/some_other_dir/backup_info.json
        if not metadata_path:
            # Check if there's a structure like: backup_name/backup_info.json
            # This is the most likely structure when we download and upload
            for item in temp_dir.iterdir():
                if item.is_dir():
                    # Look for backup_info.json in subdirectories
                    for sub_item in item.rglob('backup_info.json'):
                        metadata_path = sub_item
                        break
                if metadata_path:
                    break
        
        # Method 5: If we still haven't found it, try to be more flexible and look for any directory 
        # that contains backup_info.json in any subdirectory
        if not metadata_path:
            # Try to find backup_info.json anywhere in the structure
            for item in temp_dir.rglob('backup_info.json'):
                metadata_path = item
                break
        
        # Method 6: If we still haven't found it, let's try a more robust approach
        # We'll examine the structure and try to identify the backup directory based on
        # the presence of both database files and backup_info.json
        if not metadata_path:
            # Look for directories that contain both database files and backup_info.json
            potential_backup_dirs = []
            for item in temp_dir.iterdir():
                if item.is_dir():
                    db_files = list(item.rglob('*.db'))
                    backup_info_file = item / "backup_info.json"
                    if db_files and backup_info_file.exists():
                        potential_backup_dirs.append((item, len(db_files)))
            
            # Sort by number of DB files (more files = more likely to be the backup dir)
            if potential_backup_dirs:
                potential_backup_dirs.sort(key=lambda x: x[1], reverse=True)
                backup_dir_in_extracted = potential_backup_dirs[0][0]
                metadata_path = backup_dir_in_extracted / "backup_info.json"
        
        # If we still don't have metadata_path, try to find it in a different way
        if not metadata_path:
            # Try to find any directory that has backup_info.json in it or any subdirectory
            for item in temp_dir.rglob('backup_info.json'):
                # Get the directory that contains this file
                parent_dir = item.parent
                # Make sure it's a direct child of temp_dir or a subdirectory
                if parent_dir.parent == temp_dir or parent_dir.parent.parent == temp_dir:
                    metadata_path = item
                    break
        
        # If we still don't have metadata_path, let's try to be more flexible
        if not metadata_path:
            # Look for any directory with backup_info.json in it
            for item in temp_dir.iterdir():
                if item.is_dir():
                    backup_info_file = item / "backup_info.json"
                    if backup_info_file.exists():
                        metadata_path = backup_info_file
                        break
        
        # Log what we found for debugging
        logger.info(f"Found metadata_path: {metadata_path}")
        if metadata_path:
            logger.info(f"Metadata path exists: {metadata_path.exists()}")
        
        # Final check if we still don't have a valid metadata path
        if not metadata_path or not metadata_path.exists():
            # Let's list all directories and their contents for debugging
            logger.info("Directories in temp_dir:")
            for item in temp_dir.iterdir():
                if item.is_dir():
                    logger.info(f"  Directory: {item.name}")
                    logger.info(f"    Contents: {list(item.iterdir())}")
                    backup_info_file = item / "backup_info.json"
                    logger.info(f"    Has backup_info.json: {backup_info_file.exists()}")
                    db_files = list(item.rglob('*.db'))
                    logger.info(f"    Has DB files: {len(db_files)}")
                    # Check subdirectories too
                    for sub_item in item.rglob('*'):
                        if sub_item.is_dir():
                            sub_backup_info = sub_item / "backup_info.json"
                            logger.info(f"      Subdirectory {sub_item.name}: backup_info.json exists = {sub_backup_info.exists()}")
            
            # Let's also check the zip contents to understand the structure
            logger.info("ZIP contents:")
            with zipfile.ZipFile(temp_zip_path, 'r') as zipf:
                for info in zipf.infolist():
                    logger.info(f"  ZIP entry: {info.filename}")
            
            # Try one more approach - look for any directory with backup_info.json in it
            # This handles cases where the backup structure might be different than expected
            logger.info("Trying alternative approach to find backup directory...")
            for item in temp_dir.rglob('backup_info.json'):
                logger.info(f"Found backup_info.json in: {item}")
                logger.info(f"Parent directory: {item.parent}")
                logger.info(f"Parent directory contents: {list(item.parent.iterdir())}")
                # Check if parent directory contains database files
                db_files = list(item.parent.rglob('*.db'))
                logger.info(f"Database files found: {len(db_files)}")
                if db_files:
                    logger.info("Using this as backup directory")
                    metadata_path = item
                    break
            
            # If we still haven't found it, raise the error with more details
            if not metadata_path or not metadata_path.exists():
                raise Exception("Invalid backup file: backup_info.json not found in expected location. " +
                               "The backup file structure may be corrupted or incompatible.")
        
        # Load backup info
        with open(metadata_path, 'r') as f:
            backup_info = json.load(f)
        
        # Create a new backup folder with the extracted content
        backup_name = f"uploaded_backup_{int(time.time())}"
        new_backup_dir = backup_manager.backup_dir / backup_name
        new_backup_dir.mkdir(parents=True, exist_ok=True)
        
        # Move extracted files to the new backup directory
        # The structure in the ZIP is: backup_name/backup_info.json (etc)
        # We want to copy the contents of the backup_name directory to the new backup directory
        
        # Find the actual backup directory in the extracted structure
        backup_dir_in_extracted = None
        
        # Look for the directory that contains backup_info.json (this should be the backup directory)
        for item in temp_dir.iterdir():
            if item.is_dir() and (item / "backup_info.json").exists():
                backup_dir_in_extracted = item
                break
        
        # If not found, try to find it in subdirectories
        if not backup_dir_in_extracted:
            for item in temp_dir.rglob('backup_info.json'):
                parent_dir = item.parent
                # Make sure it's a direct child of temp_dir or a subdirectory of it
                if parent_dir.parent == temp_dir or parent_dir.parent.parent == temp_dir:
                    backup_dir_in_extracted = parent_dir
                    break
        
        # If we still don't have the backup directory, try a more robust approach
        if not backup_dir_in_extracted:
            # Look for any directory that contains database files and backup_info.json
            for item in temp_dir.iterdir():
                if item.is_dir():
                    db_files = list(item.rglob('*.db'))
                    backup_info_file = item / "backup_info.json"
                    if db_files and backup_info_file.exists():
                        backup_dir_in_extracted = item
                        break
        
        # If we still don't have it, copy everything directly
        if not backup_dir_in_extracted:
            logger.info("Using fallback approach - copying all files directly")
            # Just copy all files directly from temp_dir
            for file_path in temp_dir.rglob('*'):
                if file_path.is_file() and file_path != temp_zip_path:
                    relative_path = file_path.relative_to(temp_dir)
                    target_path = new_backup_dir / relative_path
                    target_path.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(file_path, target_path)
        else:
            # Copy the contents of the backup directory to the new backup directory
            logger.info(f"Copying from backup directory: {backup_dir_in_extracted}")
            for file_path in backup_dir_in_extracted.rglob('*'):
                if file_path.is_file():
                    # Calculate relative path from the backup directory root
                    relative_path = file_path.relative_to(backup_dir_in_extracted)
                    target_path = new_backup_dir / relative_path
                    target_path.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(file_path, target_path)
        
        # Verify that the backup_info.json exists in the new location
        new_metadata_path = new_backup_dir / "backup_info.json"
        if not new_metadata_path.exists():
            logger.error(f"Metadata file not found in new backup directory: {new_metadata_path}")
            raise Exception("Backup metadata not found in restored backup")
        
        # Restore the backup
        restore_info = backup_manager.restore_backup(backup_name)
        
        # Clean up temporary files
        shutil.rmtree(temp_dir, ignore_errors=True)
        
        return jsonify({
            'success': True,
            'message': 'Backup uploaded and restored successfully',
            'restore_info': restore_info
        })
        
    except Exception as e:
        logger.error(f"Error uploading backup: {e}")
        # Clean up temporary files if any
        try:
            import tempfile
            temp_dirs = [f for f in Path(tempfile.gettempdir()).iterdir() if 'upload_backup_' in str(f)]
            for temp_dir in temp_dirs:
                if temp_dir.is_dir():
                    shutil.rmtree(temp_dir, ignore_errors=True)
        except Exception as cleanup_err:
            logger.debug(f"Cleanup after upload error: {cleanup_err}")
        return jsonify({"success": False, "error": str(e)}), 500