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
from datetime import datetime, timedelta
from pathlib import Path
from flask import Blueprint, request, jsonify
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
        """Get the backup directory path based on environment"""
        # Check if running in Docker (config directory exists)
        config_dir = Path("/config")
        if config_dir.exists() and config_dir.is_dir():
            return config_dir / "backups"
        
        # Check Windows AppData
        import platform
        if platform.system() == "Windows":
            appdata = os.environ.get("APPDATA", os.path.expanduser("~"))
            windows_config_dir = Path(appdata) / "Huntarr"
            return windows_config_dir / "backups"
        
        # For local development, use data directory in project root
        project_root = Path(__file__).parent.parent.parent
        data_dir = project_root / "data"
        return data_dir / "backups"
    
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
            # Generate backup name if not provided
            if not name:
                timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
                name = f"{backup_type}_backup_{timestamp}"
            
            # Create backup folder with timestamp
            backup_folder = self.backup_dir / name
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
                    
                    # Force WAL checkpoint before backup
                    try:
                        conn = sqlite3.connect(db_path)
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
            with open(metadata_path, 'w') as f:
                json.dump(backup_info, f, indent=2)
            
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
            conn = sqlite3.connect(db_path)
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
                return backups
            
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
            
            # Sort by timestamp (newest first)
            backups.sort(key=lambda x: x['timestamp'], reverse=True)
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
            current_backup_name = f"pre_restore_backup_{int(time.time())}"
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
                    
                    # Replace current database with backup
                    if current_db_path.exists():
                        current_db_path.unlink()
                    
                    shutil.copy2(backup_db_path, current_db_path)
                    
                    # Verify restored database
                    if self._verify_database_integrity(current_db_path):
                        restored_databases.append(db_name)
                        logger.info(f"Restored database: {db_name}")
                    else:
                        raise Exception(f"Restored database {db_name} failed integrity check")
            
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
            backup_folder = self.backup_dir / backup_id
            
            if not backup_folder.exists():
                raise Exception(f"Backup not found: {backup_id}")
            
            shutil.rmtree(backup_folder)
            logger.info(f"Backup deleted: {backup_id}")
            return True
            
        except Exception as e:
            logger.error(f"Error deleting backup: {e}")
            raise
    
    def delete_database(self):
        """Delete the current database (destructive operation)"""
        try:
            databases = self._get_all_database_paths()
            deleted_databases = []
            
            for db_name, db_path in databases.items():
                db_file = Path(db_path)
                if db_file.exists():
                    db_file.unlink()
                    deleted_databases.append(db_name)
                    logger.warning(f"Deleted database: {db_name}")
            
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
            frequency = int(data.get('frequency', 3))
            retention = int(data.get('retention', 3))
            
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
        backup_name = data.get('name')
        
        backup_info = backup_manager.create_backup(backup_type, backup_name)
        
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
        
        if not backup_id:
            return jsonify({"success": False, "error": "Backup ID required"}), 400
        
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