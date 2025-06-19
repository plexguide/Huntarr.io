#!/usr/bin/env python3
"""
Stateful Management API Routes
Handles API endpoints for stateful management
"""

from flask import Blueprint, jsonify, request, Response
import json
from src.primary.stateful_manager import (
    get_stateful_management_info,
    reset_stateful_management,
    update_lock_expiration,
    get_state_management_summary
)
from src.primary.utils.logger import get_logger

# Create logger
stateful_logger = get_logger("stateful")

# Create blueprint
stateful_api = Blueprint('stateful_api', __name__)

@stateful_api.route('/info', methods=['GET'])
def get_info():
    """Get stateful management information."""
    try:
        info = get_stateful_management_info()
        # Add CORS headers to allow access from frontend
        response_data = {
            "success": True,
            "created_at_ts": info.get("created_at_ts"),
            "expires_at_ts": info.get("expires_at_ts"),
            "interval_hours": info.get("interval_hours")
        }
        response = Response(json.dumps(response_data))
        response.headers['Content-Type'] = 'application/json'
        response.headers['Access-Control-Allow-Origin'] = '*'
        return response
    except Exception as e:
        stateful_logger.error(f"Error getting stateful info: {e}")
        # Return error response with proper headers
        error_data = {"success": False, "message": f"Error getting stateful info: {str(e)}"}
        response = Response(json.dumps(error_data), status=500)
        response.headers['Content-Type'] = 'application/json'
        response.headers['Access-Control-Allow-Origin'] = '*'
        return response

@stateful_api.route('/reset', methods=['POST'])
def reset_stateful():
    """Reset the stateful management system."""
    try:
        success = reset_stateful_management()
        if success:
            # Add CORS headers to allow access from frontend
            response = Response(json.dumps({"success": True, "message": "Stateful management reset successfully"}))
            response.headers['Content-Type'] = 'application/json'
            response.headers['Access-Control-Allow-Origin'] = '*'
            return response
        else:
            # Add CORS headers to allow access from frontend
            response = Response(json.dumps({"success": False, "message": "Failed to reset stateful management"}), status=500)
            response.headers['Content-Type'] = 'application/json'
            response.headers['Access-Control-Allow-Origin'] = '*'
            return response
    except Exception as e:
        stateful_logger.error(f"Error resetting stateful management: {e}")
        # Return error response with proper headers
        error_data = {"error": str(e)}
        response = Response(json.dumps(error_data), status=500)
        response.headers['Content-Type'] = 'application/json'
        response.headers['Access-Control-Allow-Origin'] = '*'
        return response

@stateful_api.route('/update-expiration', methods=['POST'])
def update_expiration():
    """Update the stateful management expiration time."""
    try:
        hours = request.json.get('hours')
        if hours is None or not isinstance(hours, int) or hours <= 0:
            stateful_logger.error(f"Invalid hours value for update-expiration: {hours}")
            # Return error response with proper headers
            error_data = {"success": False, "message": f"Invalid hours value: {hours}. Must be a positive integer."}
            response = Response(json.dumps(error_data), status=400)
            response.headers['Content-Type'] = 'application/json'
            response.headers['Access-Control-Allow-Origin'] = '*'
            return response
        
        updated = update_lock_expiration(hours)
        if updated:
            # Get updated info
            info = get_stateful_management_info()
            # Add CORS headers to allow access from frontend
            response_data = {
                "success": True, 
                "message": f"Expiration updated to {hours} hours",
                "expires_at": info.get("expires_at"),
                "expires_date": info.get("expires_date")
            }
            response = Response(json.dumps(response_data))
            response.headers['Content-Type'] = 'application/json'
            response.headers['Access-Control-Allow-Origin'] = '*'
            return response
        else:
            # Add CORS headers to allow access from frontend
            response = Response(json.dumps({"success": False, "message": "Failed to update expiration"}), status=500)
            response.headers['Content-Type'] = 'application/json'
            response.headers['Access-Control-Allow-Origin'] = '*'
            return response
    except Exception as e:
        stateful_logger.error(f"Error updating expiration: {e}", exc_info=True)
        # Return error response with proper headers
        error_data = {"success": False, "message": f"Error updating expiration: {str(e)}"}
        response = Response(json.dumps(error_data), status=500)
        response.headers['Content-Type'] = 'application/json'
        response.headers['Access-Control-Allow-Origin'] = '*'
        return response

@stateful_api.route('/summary', methods=['GET'])
def get_summary():
    """Get stateful management summary for a specific app instance."""
    try:
        app_type = request.args.get('app_type')
        instance_name = request.args.get('instance_name')
        
        if not app_type or not instance_name:
            error_data = {"success": False, "message": "app_type and instance_name parameters are required"}
            response = Response(json.dumps(error_data), status=400)
            response.headers['Content-Type'] = 'application/json'
            response.headers['Access-Control-Allow-Origin'] = '*'
            return response
        
        # Get per-instance settings to retrieve custom hours
        instance_hours = None
        try:
            from src.primary.settings_manager import load_settings
            settings = load_settings(app_type)
            
            if settings and 'instances' in settings:
                # Find the matching instance
                for instance in settings['instances']:
                    if instance.get('name') == instance_name:
                        # Get per-instance state management hours
                        instance_hours = instance.get('state_management_hours', 168)
                        instance_mode = instance.get('state_management_mode', 'custom')
                        
                        # If state management is disabled for this instance, return disabled status
                        if instance_mode == 'disabled':
                            response_data = {
                                "success": True,
                                "processed_count": 0,
                                "next_reset_time": None,
                                "expiration_hours": instance_hours,
                                "has_processed_items": False,
                                "state_management_enabled": False
                            }
                            response = Response(json.dumps(response_data))
                            response.headers['Content-Type'] = 'application/json'
                            response.headers['Access-Control-Allow-Origin'] = '*'
                            return response
                        
                        break
        except Exception as e:
            stateful_logger.warning(f"Could not load instance settings for {app_type}/{instance_name}: {e}")
            # Fall back to default hours if settings can't be loaded
            instance_hours = 168
        
        # Get summary for the specific instance with custom hours
        summary = get_state_management_summary(app_type, instance_name, instance_hours)
        
        response_data = {
            "success": True,
            "processed_count": summary.get("processed_count", 0),
            "next_reset_time": summary.get("next_reset_time"),
            "expiration_hours": summary.get("expiration_hours", instance_hours or 168),
            "has_processed_items": summary.get("has_processed_items", False),
            "state_management_enabled": True
        }
        
        response = Response(json.dumps(response_data))
        response.headers['Content-Type'] = 'application/json'
        response.headers['Access-Control-Allow-Origin'] = '*'
        return response
        
    except Exception as e:
        stateful_logger.error(f"Error getting stateful summary for {app_type}/{instance_name}: {e}")
        error_data = {"success": False, "message": f"Error getting summary: {str(e)}"}
        response = Response(json.dumps(error_data), status=500)
        response.headers['Content-Type'] = 'application/json'
        response.headers['Access-Control-Allow-Origin'] = '*'
        return response
