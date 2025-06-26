#!/usr/bin/env python3
"""
Database-based log routes for Huntarr web interface
Replaces file-based log reading with database queries
"""

from flask import Blueprint, jsonify, request, current_app
from src.primary.utils.logger import get_logger
from src.primary.utils.database import get_logs_database
from datetime import datetime
import pytz

logger = get_logger(__name__)
log_routes_bp = Blueprint('log_routes', __name__)

def _convert_timestamp_to_user_timezone(timestamp_str: str) -> str:
    """Format timestamp - logs are already stored in correct timezone"""
    try:
        # The logs are already stored in the correct timezone by the logging system
        # We just need to parse and format them properly
        
        # Parse the timestamp (remove microseconds if present)
        if '.' in timestamp_str:
            # Remove microseconds: "2025-06-26 08:48:40.586072" -> "2025-06-26 08:48:40"
            timestamp_str = timestamp_str.split('.')[0]
        
        # Remove any timezone suffix if present
        timestamp_str = timestamp_str.replace('Z', '').replace('+00:00', '')
        
        # Return the timestamp as-is since logs are already in correct timezone
        return timestamp_str
        
    except Exception as e:
        logger.error(f"[LOG_API] Error formatting timestamp {timestamp_str}: {e}")
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