#!/usr/bin/env python3
"""
Database and setup admin routes: integrity, backup, maintenance, status, setup progress.
"""

from datetime import datetime
from flask import Blueprint, request, jsonify

from ..utils.logger import logger
from ..auth import user_exists
from .auth_routes import get_user_for_request

database_bp = Blueprint('database', __name__)

@database_bp.route('/api/database/integrity', methods=['GET', 'POST'])
def database_integrity():
    """Check database integrity and optionally repair issues"""
    # Get username handling bypass modes
    username = get_user_for_request()
    if not username:
        return jsonify({"success": False, "error": "Authentication required"}), 401
    
    try:
        from src.primary.utils.database import get_database
        
        repair = request.json.get('repair', False) if request.method == 'POST' else False
        
        db = get_database()
        results = db.perform_integrity_check(repair=repair)
        
        return jsonify({
            'success': True,
            'integrity_check': results,
            'timestamp': datetime.now().isoformat()
        })
        
    except Exception as e:
        logger.error(f"Database integrity check failed: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@database_bp.route('/api/database/backup', methods=['POST'])
def create_database_backup():
    """Create a verified backup of the database"""
    # Get username handling bypass modes
    username = get_user_for_request()
    if not username:
        return jsonify({"success": False, "error": "Authentication required"}), 401
    
    try:
        from src.primary.utils.database import get_database
        
        backup_name = request.json.get('backup_name') if request.json else None
        
        db = get_database()
        backup_path = db.create_backup(backup_name)
        
        # Get backup file size for confirmation
        from pathlib import Path
        backup_size = Path(backup_path).stat().st_size
        
        return jsonify({
            'success': True,
            'backup_path': backup_path,
            'backup_size': backup_size,
            'timestamp': datetime.now().isoformat()
        })
        
    except Exception as e:
        logger.error(f"Database backup creation failed: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@database_bp.route('/api/database/maintenance', methods=['POST'])
def trigger_database_maintenance():
    """Trigger immediate database maintenance operations"""
    # Get username handling bypass modes
    username = get_user_for_request()
    if not username:
        return jsonify({"success": False, "error": "Authentication required"}), 401
    
    try:
        from src.primary.utils.database import get_database
        
        db = get_database()
        
        # Perform maintenance operations
        maintenance_results = {
            'integrity_check': db.perform_integrity_check(repair=True),
            'optimization': {'status': 'completed'},
            'checkpoint': {'status': 'completed'}
        }
        
        # Run optimization and checkpoint
        with db.get_connection() as conn:
            conn.execute("PRAGMA optimize")
            conn.execute("PRAGMA wal_checkpoint(PASSIVE)")
        
        return jsonify({
            'success': True,
            'maintenance_results': maintenance_results,
            'timestamp': datetime.now().isoformat()
        })
        
    except Exception as e:
        logger.error(f"Database maintenance failed: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@database_bp.route('/api/database/status', methods=['GET'])
def database_status():
    """Get comprehensive database status information"""
    # Get username handling bypass modes
    username = get_user_for_request()
    if not username:
        return jsonify({"success": False, "error": "Authentication required"}), 401
    
    try:
        from src.primary.utils.database import get_database
        import os
        
        db = get_database()
        
        # Get database file info
        db_size = os.path.getsize(db.db_path) if db.db_path.exists() else 0
        
        # Get database stats
        with db.get_connection() as conn:
            page_count = conn.execute("PRAGMA page_count").fetchone()[0]
            page_size = conn.execute("PRAGMA page_size").fetchone()[0]
            freelist_count = conn.execute("PRAGMA freelist_count").fetchone()[0]
            journal_mode = conn.execute("PRAGMA journal_mode").fetchone()[0]
            cache_size = conn.execute("PRAGMA cache_size").fetchone()[0]
            
        status_info = {
            'database_path': str(db.db_path),
            'database_size': db_size,
            'database_size_mb': round(db_size / (1024 * 1024), 2),
            'page_count': page_count,
            'page_size': page_size,
            'freelist_count': freelist_count,
            'journal_mode': journal_mode,
            'cache_size': cache_size,
            'utilization': round((page_count - freelist_count) / page_count * 100, 2) if page_count > 0 else 0
        }
        
        return jsonify({
            'success': True,
            'database_status': status_info,
            'timestamp': datetime.now().isoformat()
        })
        
    except Exception as e:
        logger.error(f"Failed to get database status: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@database_bp.route('/api/setup/progress', methods=['GET', 'POST'])
def setup_progress():
    """Get or save setup progress"""
    try:
        from src.primary.utils.database import get_database
        db = get_database()
        
        if request.method == 'GET':
            # Get current setup progress
            progress = db.get_setup_progress()
            return jsonify({
                'success': True,
                'progress': progress
            })
        
        elif request.method == 'POST':
            # Save setup progress
            data = request.json
            progress_data = data.get('progress', {})
            
            # Add timestamp
            progress_data['timestamp'] = datetime.now().isoformat()
            
            # Save to database
            success = db.save_setup_progress(progress_data)
            
            return jsonify({
                'success': success,
                'message': 'Setup progress saved' if success else 'Failed to save setup progress'
            })
    
    except Exception as e:
        logger.error(f"Setup progress API error: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@database_bp.route('/api/setup/clear', methods=['POST'])
def clear_setup_progress():
    """Clear setup progress (called when setup is complete)"""
    try:
        from src.primary.utils.database import get_database
        db = get_database()
        
        success = db.clear_setup_progress()
        
        return jsonify({
            'success': success,
            'message': 'Setup progress cleared' if success else 'Failed to clear setup progress'
        })
    
    except Exception as e:
        logger.error(f"Clear setup progress API error: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@database_bp.route('/api/setup/status', methods=['GET'])
def setup_status():
    try:
        from src.primary.utils.database import get_database
        db = get_database()
        
        # Check if user exists and setup progress
        user_exists_flag = user_exists()
        setup_in_progress = db.is_setup_in_progress() if user_exists_flag else False
        
        return jsonify({
            "success": True,
            "user_exists": user_exists_flag,
            "setup_in_progress": setup_in_progress
        })
    except Exception as e:
        logger.error(f"Error checking setup status: {e}")
        return jsonify({"success": False, "error": "Failed to check setup status"}), 500
