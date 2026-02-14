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

def _convert_timestamp_to_user_timezone(timestamp_val) -> str:
    """Convert UTC timestamp to user's current timezone setting.
    Uses fresh timezone from settings (no cache) so log display always matches User Settings.
    """
    try:
        # Coerce to string (SQLite may return str or datetime)
        timestamp_str = str(timestamp_val) if timestamp_val is not None else ""
        if not timestamp_str or not timestamp_str.strip():
            return timestamp_str

        # Prefer database timezone so in-app "Eastern" wins over container TZ=UTC (Docker)
        user_timezone = get_user_timezone(use_cache=False, prefer_database_for_display=True)

        # Remove microseconds: "2025-06-26 08:48:40.586072" -> "2025-06-26 08:48:40"
        if '.' in timestamp_str:
            timestamp_str = timestamp_str.split('.')[0]

        # Normalize: remove timezone suffix and ensure space between date and time for strptime
        timestamp_str = timestamp_str.replace('Z', '').replace('+00:00', '').strip()
        if 'T' in timestamp_str:
            timestamp_str = timestamp_str.replace('T', ' ', 1)

        # Parse as UTC datetime
        try:
            utc_dt = datetime.strptime(timestamp_str, '%Y-%m-%d %H:%M:%S')
            utc_dt = pytz.UTC.localize(utc_dt)
        except ValueError:
            try:
                utc_dt = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
            except ValueError:
                return timestamp_str
            if utc_dt.tzinfo is None:
                utc_dt = pytz.UTC.localize(utc_dt)

        # Convert to user timezone
        local_dt = utc_dt.astimezone(user_timezone)
        return local_dt.strftime('%Y-%m-%d %H:%M:%S')

    except Exception as e:
        logger.error(f"[LOG_CONVERT] Error converting timestamp {timestamp_val!r}: {e}")
        return str(timestamp_val) if timestamp_val is not None else ""

@log_routes_bp.route('/api/logs/<app_type>')
def get_logs(app_type):
    """Get logs for a specific app type from database.
    - Main Huntarr Logs page uses app_type=all (includes movie_hunt; user can filter by Movie Hunt in dropdown).
    - Movie Hunt sidebar Logs link opens main Logs with dropdown defaulting to Movie Hunt.
    """
    try:
        logs_db = get_logs_database()

        # Get query parameters
        level = request.args.get('level')
        try:
            limit = max(1, min(1000, int(request.args.get('limit', 100))))
        except (TypeError, ValueError):
            limit = 100
        try:
            offset = max(0, int(request.args.get('offset', 0)))
        except (TypeError, ValueError):
            offset = 0
        search = request.args.get('search')

        # When app_type is 'all': include all app types (including movie_hunt)
        if app_type == 'all':
            logs = logs_db.get_logs(
                app_type=None,
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
                app_type=None,
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

@log_routes_bp.route('/api/logs/usage')
def get_log_usage():
    """Get log file usage statistics (size and count)"""
    try:
        from src.primary.utils.config_paths import LOG_DIR
        import os
        import glob
        
        log_files = glob.glob(os.path.join(LOG_DIR, "*.log*"))
        total_size = sum(os.path.getsize(f) for f in log_files if os.path.isfile(f))
        file_count = len(log_files)
        
        # Format size for display
        size_str = f"{total_size / (1024 * 1024):.2f} MB" if total_size > 1024 * 1024 else f"{total_size / 1024:.2f} KB"
        
        return jsonify({
            'success': True,
            'total_size': total_size,
            'total_size_formatted': size_str,
            'file_count': file_count
        })
    except Exception as e:
        logger.error(f"Error getting log usage: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@log_routes_bp.route('/api/logs/<app_type>/clear', methods=['POST'])
def clear_logs(app_type):
    """Clear logs for a specific app type. movie_hunt clear is used by Movie Hunt → Logs; 'all' clears only main apps."""
    try:
        logs_db = get_logs_database()

        # When clearing 'all' (main Logs page): clear only main app logs, never movie_hunt or tv_hunt
        if app_type == 'all':
            deleted_count = logs_db.clear_logs(app_type=None, exclude_app_types=['movie_hunt', 'tv_hunt'])
        else:
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
        try:
            days_to_keep = int(data.get('days_to_keep', 30))
            max_entries_per_app = int(data.get('max_entries_per_app', 10000))
        except (TypeError, ValueError):
            return jsonify({'success': False, 'error': 'days_to_keep and max_entries_per_app must be valid integers'}), 400
        days_to_keep = max(1, min(365, days_to_keep))
        max_entries_per_app = max(100, min(100000, max_entries_per_app))

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
    """Get log statistics including database size"""
    try:
        logs_db = get_logs_database()
        
        # Get available app types and levels
        app_types = logs_db.get_app_types()
        log_levels = logs_db.get_log_levels()
        
        # Get counts per app type
        app_counts = {}
        for app_type in app_types:
            app_counts[app_type] = logs_db.get_log_count(app_type=app_type)
        
        # Get database file size
        db_size = 0
        db_size_formatted = "0 KB"
        try:
            import os
            db_path = str(logs_db.db_path)
            if os.path.exists(db_path):
                db_size = os.path.getsize(db_path)
                # Also include WAL file if present
                wal_path = db_path + "-wal"
                if os.path.exists(wal_path):
                    db_size += os.path.getsize(wal_path)
                if db_size > 1024 * 1024:
                    db_size_formatted = f"{db_size / (1024 * 1024):.2f} MB"
                else:
                    db_size_formatted = f"{db_size / 1024:.1f} KB"
        except Exception:
            pass
        
        return jsonify({
            'success': True,
            'app_types': app_types,
            'log_levels': log_levels,
            'app_counts': app_counts,
            'total_logs': sum(app_counts.values()),
            'db_size': db_size,
            'db_size_formatted': db_size_formatted
        })
        
    except Exception as e:
        logger.error(f"Error getting log stats: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500 