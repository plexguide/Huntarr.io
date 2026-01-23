#!/usr/bin/env python3
"""
Database-based log routes for Huntarr web interface
Replaces file-based log reading with database queries
"""

from flask import Blueprint, jsonify, request, current_app
from src.primary.utils.logger import get_logger
from src.primary.utils.database import get_logs_database
from src.primary.utils.timezone_utils import get_user_timezone
from datetime import datetime
import pytz

logger = get_logger(__name__)
log_routes_bp = Blueprint('log_routes', __name__)

def _convert_timestamp_to_user_timezone(timestamp_str: str) -> str:
    """Convert UTC timestamp to user's current timezone setting"""
    try:
        # Get current user timezone setting
        user_timezone = get_user_timezone()
        
        # Parse the UTC timestamp (remove microseconds if present)
        if '.' in timestamp_str:
            # Remove microseconds: "2025-06-26 08:48:40.586072" -> "2025-06-26 08:48:40"
            timestamp_str = timestamp_str.split('.')[0]
        
        # Remove any timezone suffix if present
        timestamp_str = timestamp_str.replace('Z', '').replace('+00:00', '')
        
        # Parse as UTC datetime
        try:
            utc_dt = datetime.strptime(timestamp_str, '%Y-%m-%d %H:%M:%S')
            utc_dt = pytz.UTC.localize(utc_dt)
        except ValueError:
            # Try alternative format
            utc_dt = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
            if utc_dt.tzinfo is None:
                utc_dt = pytz.UTC.localize(utc_dt)
        
        # Convert to user timezone
        local_dt = utc_dt.astimezone(user_timezone)
        
        # Return formatted timestamp
        result = local_dt.strftime('%Y-%m-%d %H:%M:%S')
        return result
        
    except Exception as e:
        logger.error(f"[LOG_CONVERT] Error converting timestamp {timestamp_str}: {e}")
        # Fallback to original timestamp
        return timestamp_str

@log_routes_bp.route('/api/logs/<app_type>')
def get_logs(app_type):
    """Get logs for a specific app type from database"""
    try:
        logs_db = get_logs_database()
        
        # Get query parameters
        level = request.args.get('level')
        limit = int(request.args.get('limit', 100))
        offset = int(request.args.get('offset', 0))
        search = request.args.get('search')
        
        # Handle 'all' app type by getting logs from all apps
        if app_type == 'all':
            # Get logs from all app types
            logs = logs_db.get_logs(
                app_type=None,  # None means all app types
                level=level,
                limit=limit,
                offset=offset,
                search=search
            )
        else:
            # Map 'system' to actual app type in database
            db_app_type = 'system' if app_type == 'system' else app_type
            
            # Get logs from specific app type
            logs = logs_db.get_logs(
                app_type=db_app_type,
                level=level,
                limit=limit,
                offset=offset,
                search=search
            )
        
        # Format logs for frontend (same format as file-based logs)
        formatted_logs = []
        for log in logs:
            # Convert timestamp to user timezone
            display_timestamp = _convert_timestamp_to_user_timezone(log['timestamp'])
            
            # Format as the frontend expects: timestamp|level|app_type|message
            formatted_log = f"{display_timestamp}|{log['level']}|{log['app_type']}|{log['message']}"
            formatted_logs.append(formatted_log)
        
        # Get total count for pagination
        if app_type == 'all':
            total_count = logs_db.get_log_count(
                app_type=None,  # None means all app types
                level=level,
                search=search
            )
        else:
            db_app_type = 'system' if app_type == 'system' else app_type
            total_count = logs_db.get_log_count(
                app_type=db_app_type,
                level=level,
                search=search
            )
        
        return jsonify({
            'success': True,
            'logs': formatted_logs,
            'total': total_count,
            'offset': offset,
            'limit': limit
        })
        
    except Exception as e:
        logger.error(f"Error getting logs for {app_type}: {e}")
        return jsonify({
            'success': False,
            'error': str(e),
            'logs': [],
            'total': 0
        }), 500

@log_routes_bp.route('/api/logs/<app_type>/clear', methods=['POST'])
def clear_logs(app_type):
    """Clear logs for a specific app type"""
    try:
        logs_db = get_logs_database()
        
        # Map 'system' to actual app type in database
        db_app_type = 'system' if app_type == 'system' else app_type
        
        deleted_count = logs_db.clear_logs(app_type=db_app_type)
        
        return jsonify({
            'success': True,
            'message': f'Cleared {deleted_count} logs for {app_type}',
            'deleted_count': deleted_count
        })
        
    except Exception as e:
        logger.error(f"Error clearing logs for {app_type}: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@log_routes_bp.route('/api/logs/cleanup', methods=['POST'])
def cleanup_logs():
    """Clean up old logs based on retention policy"""
    try:
        logs_db = get_logs_database()
        
        # Get parameters from request
        data = request.get_json() or {}
        days_to_keep = data.get('days_to_keep', 30)
        max_entries_per_app = data.get('max_entries_per_app', 10000)
        
        deleted_count = logs_db.cleanup_old_logs(
            days_to_keep=days_to_keep,
            max_entries_per_app=max_entries_per_app
        )
        
        return jsonify({
            'success': True,
            'message': f'Cleaned up {deleted_count} old log entries',
            'deleted_count': deleted_count
        })
        
    except Exception as e:
        logger.error(f"Error cleaning up logs: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@log_routes_bp.route('/api/logs/stats')
def get_log_stats():
    """Get log statistics"""
    try:
        logs_db = get_logs_database()
        
        # Get available app types and levels
        app_types = logs_db.get_app_types()
        log_levels = logs_db.get_log_levels()
        
        # Get counts per app type
        app_counts = {}
        for app_type in app_types:
            app_counts[app_type] = logs_db.get_log_count(app_type=app_type)
        
        return jsonify({
            'success': True,
            'app_types': app_types,
            'log_levels': log_levels,
            'app_counts': app_counts,
            'total_logs': sum(app_counts.values())
        })
        
    except Exception as e:
        logger.error(f"Error getting log stats: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@log_routes_bp.route('/api/logs/settings', methods=['GET'])
def get_log_settings():
    """Get log rotation settings"""
    try:
        from src.primary.settings_manager import load_settings
        
        settings = load_settings('logs')
        
        # Add current log file sizes
        import os
        from src.primary.utils.config_paths import get_logs_dir
        
        log_dir = get_logs_dir()
        log_files = {}
        total_size = 0
        
        if os.path.exists(log_dir):
            for filename in os.listdir(log_dir):
                if filename.endswith('.log') or filename.endswith('.gz'):
                    filepath = os.path.join(log_dir, filename)
                    try:
                        size = os.path.getsize(filepath)
                        log_files[filename] = {
                            'size': size,
                            'size_mb': round(size / (1024 * 1024), 2)
                        }
                        total_size += size
                    except:
                        pass
        
        return jsonify({
            'success': True,
            'settings': settings,
            'log_files': log_files,
            'total_size': total_size,
            'total_size_mb': round(total_size / (1024 * 1024), 2)
        })
        
    except Exception as e:
        logger.error(f"Error getting log settings: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@log_routes_bp.route('/api/logs/settings', methods=['POST'])
def save_log_settings():
    """Save log rotation settings"""
    try:
        from src.primary.settings_manager import save_settings
        
        data = request.get_json()
        if not data:
            return jsonify({
                'success': False,
                'error': 'No data provided'
            }), 400
        
        # Validate settings
        if 'max_log_size_mb' in data:
            try:
                data['max_log_size_mb'] = int(data['max_log_size_mb'])
                if data['max_log_size_mb'] < 1 or data['max_log_size_mb'] > 1000:
                    return jsonify({
                        'success': False,
                        'error': 'Max log size must be between 1 and 1000 MB'
                    }), 400
            except ValueError:
                return jsonify({
                    'success': False,
                    'error': 'Invalid max log size value'
                }), 400
        
        if 'backup_count' in data:
            try:
                data['backup_count'] = int(data['backup_count'])
                if data['backup_count'] < 0 or data['backup_count'] > 50:
                    return jsonify({
                        'success': False,
                        'error': 'Backup count must be between 0 and 50'
                    }), 400
            except ValueError:
                return jsonify({
                    'success': False,
                    'error': 'Invalid backup count value'
                }), 400
        
        if 'retention_days' in data:
            try:
                data['retention_days'] = int(data['retention_days'])
                if data['retention_days'] < 0 or data['retention_days'] > 365:
                    return jsonify({
                        'success': False,
                        'error': 'Retention days must be between 0 and 365'
                    }), 400
            except ValueError:
                return jsonify({
                    'success': False,
                    'error': 'Invalid retention days value'
                }), 400
        
        # Save settings
        save_settings('logs', data)
        
        return jsonify({
            'success': True,
            'message': 'Log settings saved successfully. Restart Huntarr for changes to take effect.'
        })
        
    except Exception as e:
        logger.error(f"Error saving log settings: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@log_routes_bp.route('/api/logs/cleanup-now', methods=['POST'])
def cleanup_logs_now():
    """Manually trigger log cleanup"""
    try:
        from src.primary.settings_manager import load_settings
        import os
        import glob
        from datetime import datetime, timedelta
        from src.primary.utils.config_paths import get_logs_dir
        
        settings = load_settings('logs')
        retention_days = settings.get('retention_days', 30)
        
        log_dir = get_logs_dir()
        if not os.path.exists(log_dir):
            return jsonify({
                'success': True,
                'message': 'No log directory found',
                'deleted_count': 0
            })
        
        deleted_count = 0
        deleted_size = 0
        
        if retention_days > 0:
            # Delete logs older than retention days
            cutoff_date = datetime.now() - timedelta(days=retention_days)
            
            for log_file in glob.glob(os.path.join(log_dir, '*.log*')):
                try:
                    file_mtime = datetime.fromtimestamp(os.path.getmtime(log_file))
                    if file_mtime < cutoff_date:
                        file_size = os.path.getsize(log_file)
                        os.remove(log_file)
                        deleted_count += 1
                        deleted_size += file_size
                        logger.info(f"Deleted old log file: {log_file}")
                except Exception as e:
                    logger.error(f"Error deleting log file {log_file}: {e}")
        
        return jsonify({
            'success': True,
            'message': f'Cleaned up {deleted_count} old log files ({round(deleted_size / (1024 * 1024), 2)} MB)',
            'deleted_count': deleted_count,
            'deleted_size_mb': round(deleted_size / (1024 * 1024), 2)
        })
        
    except Exception as e:
        logger.error(f"Error cleaning up logs: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500 