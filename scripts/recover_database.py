#!/usr/bin/env python3
"""
Huntarr Database Recovery Utility

This script helps recover from database corruption issues by:
1. Backing up the corrupted database
2. Creating a fresh database
3. Attempting to recover any salvageable data

Usage:
- For Docker: docker exec huntarr python /app/scripts/recover_database.py
- For local: python scripts/recover_database.py
"""

import sys
import os
import sqlite3
import json
import time
from pathlib import Path

# Add src to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

def get_database_path():
    """Get the database path based on environment"""
    # Check if running in Docker
    config_dir = Path("/config")
    if config_dir.exists() and config_dir.is_dir():
        return config_dir / "huntarr.db"
    
    # Check for Windows config directory
    windows_config = os.environ.get("HUNTARR_CONFIG_DIR")
    if windows_config:
        return Path(windows_config) / "huntarr.db"
    
    # Check for Windows AppData
    import platform
    if platform.system() == "Windows":
        appdata = os.environ.get("APPDATA", os.path.expanduser("~"))
        return Path(appdata) / "Huntarr" / "huntarr.db"
    
    # Local development
    project_root = Path(__file__).parent.parent
    return project_root / "data" / "huntarr.db"

def backup_corrupted_database(db_path):
    """Create backup of corrupted database"""
    if not db_path.exists():
        print(f"Database file does not exist: {db_path}")
        return None
    
    timestamp = int(time.time())
    backup_path = db_path.parent / f"huntarr_corrupted_backup_{timestamp}.db"
    
    try:
        # Copy the corrupted file
        import shutil
        shutil.copy2(db_path, backup_path)
        print(f"✓ Corrupted database backed up to: {backup_path}")
        return backup_path
    except Exception as e:
        print(f"✗ Failed to backup corrupted database: {e}")
        return None

def attempt_data_recovery(backup_path):
    """Attempt to recover data from corrupted database"""
    if not backup_path or not backup_path.exists():
        return {}
    
    print("⚡ Attempting to recover data from corrupted database...")
    recovered_data = {}
    
    try:
        # Try to connect and recover whatever we can
        conn = sqlite3.connect(backup_path)
        conn.row_factory = sqlite3.Row
        
        # Try to recover users table
        try:
            cursor = conn.execute("SELECT * FROM users")
            users = [dict(row) for row in cursor.fetchall()]
            if users:
                recovered_data['users'] = users
                print(f"✓ Recovered {len(users)} user(s)")
        except Exception as e:
            print(f"  Could not recover users: {e}")
        
        # Try to recover general settings
        try:
            cursor = conn.execute("SELECT * FROM general_settings")
            settings = [dict(row) for row in cursor.fetchall()]
            if settings:
                recovered_data['general_settings'] = settings
                print(f"✓ Recovered {len(settings)} general setting(s)")
        except Exception as e:
            print(f"  Could not recover general settings: {e}")
        
        # Try to recover app configs
        try:
            cursor = conn.execute("SELECT * FROM app_configs")
            configs = [dict(row) for row in cursor.fetchall()]
            if configs:
                recovered_data['app_configs'] = configs
                print(f"✓ Recovered {len(configs)} app configuration(s)")
        except Exception as e:
            print(f"  Could not recover app configs: {e}")
        
        conn.close()
        
    except Exception as e:
        print(f"✗ Could not open corrupted database for recovery: {e}")
    
    return recovered_data

def create_fresh_database(db_path):
    """Create a fresh database with proper structure"""
    print("🔧 Creating fresh database...")
    
    try:
        # Remove corrupted file
        if db_path.exists():
            db_path.unlink()
        
        # Import and create fresh database
        from primary.utils.database import HuntarrDatabase
        
        # This will create a fresh database with all tables
        db = HuntarrDatabase()
        print(f"✓ Fresh database created at: {db_path}")
        return db
        
    except Exception as e:
        print(f"✗ Failed to create fresh database: {e}")
        return None

def restore_recovered_data(db, recovered_data):
    """Restore recovered data to fresh database"""
    if not recovered_data:
        print("⚠ No data to restore")
        return
    
    print("📋 Restoring recovered data...")
    
    # Restore users
    if 'users' in recovered_data:
        try:
            for user in recovered_data['users']:
                # Remove auto-generated fields
                user_data = {k: v for k, v in user.items() 
                           if k not in ['id', 'created_at', 'updated_at']}
                
                db.create_user(
                    username=user_data.get('username', ''),
                    password=user_data.get('password', ''),
                    two_fa_enabled=user_data.get('two_fa_enabled', False),
                    two_fa_secret=user_data.get('two_fa_secret'),
                    plex_token=user_data.get('plex_token'),
                    plex_user_data=json.loads(user_data.get('plex_user_data', '{}')) if user_data.get('plex_user_data') else None
                )
            print(f"✓ Restored {len(recovered_data['users'])} user(s)")
        except Exception as e:
            print(f"✗ Failed to restore users: {e}")
    
    # Restore general settings
    if 'general_settings' in recovered_data:
        try:
            settings_dict = {}
            for setting in recovered_data['general_settings']:
                key = setting['setting_key']
                value = setting['setting_value']
                setting_type = setting.get('setting_type', 'string')
                
                # Convert value based on type
                if setting_type == 'boolean':
                    settings_dict[key] = value.lower() == 'true'
                elif setting_type == 'integer':
                    settings_dict[key] = int(value)
                elif setting_type == 'float':
                    settings_dict[key] = float(value)
                elif setting_type == 'json':
                    try:
                        settings_dict[key] = json.loads(value)
                    except:
                        settings_dict[key] = value
                else:
                    settings_dict[key] = value
            
            db.save_general_settings(settings_dict)
            print(f"✓ Restored {len(settings_dict)} general setting(s)")
        except Exception as e:
            print(f"✗ Failed to restore general settings: {e}")
    
    # Restore app configs
    if 'app_configs' in recovered_data:
        try:
            for config in recovered_data['app_configs']:
                app_type = config['app_type']
                config_data = json.loads(config['config_data'])
                db.save_app_config(app_type, config_data)
            print(f"✓ Restored {len(recovered_data['app_configs'])} app configuration(s)")
        except Exception as e:
            print(f"✗ Failed to restore app configs: {e}")

def main():
    print("🔥 Huntarr Database Recovery Utility")
    print("=" * 50)
    
    # Get database path
    db_path = get_database_path()
    print(f"Database location: {db_path}")
    
    if not db_path.exists():
        print("✗ Database file does not exist. Nothing to recover.")
        return
    
    # Check if database is actually corrupted
    try:
        conn = sqlite3.connect(db_path)
        conn.execute("SELECT name FROM sqlite_master WHERE type='table' LIMIT 1").fetchone()
        conn.close()
        print("✓ Database appears to be intact. No recovery needed.")
        return
    except sqlite3.DatabaseError as e:
        if "file is not a database" in str(e) or "database disk image is malformed" in str(e):
            print(f"⚠ Database corruption detected: {e}")
        else:
            print(f"✗ Database error: {e}")
            return
    
    # Backup corrupted database
    backup_path = backup_corrupted_database(db_path)
    
    # Attempt data recovery
    recovered_data = attempt_data_recovery(backup_path)
    
    # Create fresh database
    db = create_fresh_database(db_path)
    if not db:
        print("✗ Failed to create fresh database. Recovery aborted.")
        return
    
    # Restore recovered data
    restore_recovered_data(db, recovered_data)
    
    print("\n🎉 Database recovery completed!")
    print("=" * 50)
    print("Summary:")
    print(f"- Corrupted database backed up to: {backup_path}")
    print(f"- Fresh database created at: {db_path}")
    
    if recovered_data:
        print("- Data recovered:")
        for table, data in recovered_data.items():
            print(f"  • {table}: {len(data)} record(s)")
    else:
        print("- No data could be recovered from corrupted database")
    
    print("\nYou can now restart Huntarr.")

if __name__ == "__main__":
    main() 