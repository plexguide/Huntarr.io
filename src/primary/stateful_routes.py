#!/usr/bin/env python3
"""
Stateful Management API Routes
Handles API endpoints for stateful management
"""

import json
from typing import Any

from flask import Blueprint, request, Response

from src.primary.stateful_manager import (
    get_stateful_management_info,
    reset_stateful_management,
    update_lock_expiration,
    get_instance_state_management_summary
)
from src.primary.utils.database import get_database
from src.primary.utils.logger import get_logger

stateful_logger = get_logger("stateful")

stateful_api = Blueprint('stateful_api', __name__)


def base_response(status: int, data: dict[str, Any]):
    """
    Helper to create a Flask Response with CORS headers.

    Args:
        status (int): HTTP status code
        data (dict): Data to include in the response body

    Returns:
        Response: Flask Response object with CORS headers
    """
    response = Response(json.dumps(data), status=status)
    response.headers['Content-Type'] = 'application/json'
    response.headers['Access-Control-Allow-Origin'] = '*'
    return response


@stateful_api.route('/info', methods=['GET'])
def get_info():
    """Get stateful management information."""
    try:
        info = get_stateful_management_info()
        return base_response(200, {
            "success": True,
            "created_at_ts": info.get("created_at_ts"),
            "expires_at_ts": info.get("expires_at_ts"),
            "interval_hours": info.get("interval_hours")
        })
    except Exception as e:
        stateful_logger.error("Error getting stateful info: %s", e)
        return base_response(500, {
            "success": False,
            "message": f"Error getting stateful info: {str(e)}",
        })


@stateful_api.route('/reset', methods=['POST'])
def reset_stateful():
    """Reset the stateful management system (global or per-instance)."""
    try:
        data = request.json or {}
        app_type = data.get('app_type')
        instance_name = data.get('instance_name')

        if app_type and instance_name:
            # Per-instance reset
            try:
                summary = get_instance_state_management_summary(app_type, instance_name)
                instance_hours = summary.get("expiration_hours")
            except Exception as e:
                stateful_logger.warning("Could not load instance settings for %s/%s: %s", app_type, instance_name, e)

            # Reset per-instance state management
            db = get_database()
            success = db.reset_instance_state_management(app_type, instance_name, instance_hours)

            if success:
                stateful_logger.info("Successfully reset state management for %s/%s", app_type, instance_name)
                response_data = {"success": True, "message": f"State management reset successfully for {app_type}/{instance_name}"}
            else:
                response_data = {"success": False, "message": f"Failed to reset state management for {app_type}/{instance_name}"}

        else:
            # Global reset (legacy)
            success = reset_stateful_management()
            if success:
                response_data = {"success": True, "message": "Stateful management reset successfully"}
            else:
                response_data = {"success": False, "message": "Failed to reset stateful management"}

        return base_response(200 if response_data["success"] else 500, response_data)

    except Exception as e:
        stateful_logger.error("Error resetting stateful management: %s", e)
        return base_response(500, {
            "success": False,
            "message": f"Error resetting stateful management: {str(e)}",
        })


@stateful_api.route('/update-expiration', methods=['POST'])
def update_expiration():
    """Update the stateful management expiration time."""
    try:
        hours = request.json.get('hours')
        if hours is None or not isinstance(hours, int) or hours <= 0:
            stateful_logger.error("Invalid hours value for update-expiration: %s", hours)
            return base_response(400, {
                "success": False,
                "message": f"Invalid hours value: {hours}. Must be a positive integer.",
            })

        updated = update_lock_expiration(hours)

        if updated:
            info = get_stateful_management_info()
            # Add CORS headers to allow access from frontend
            return base_response(200, {
                "success": True,
                "message": f"Expiration updated to {hours} hours",
                "expires_at": info.get("expires_at"),
                "expires_date": info.get("expires_date"),
            })

        return base_response(500, {
            "success": False,
            "message": "Failed to update expiration",
        })

    except Exception as e:
        stateful_logger.error("Error updating expiration: %s", e, exc_info=True)
        return base_response(500, {
            "success": False,
            "message": f"Error updating expiration: {str(e)}",
        })


@stateful_api.route('/summary', methods=['GET'])
def get_summary():
    """Get stateful management summary for a specific app instance."""
    try:
        app_type = request.args.get('app_type')
        instance_name = request.args.get('instance_name')

        if not app_type or not instance_name:
            return base_response(400, {
                "success": False,
                "message": "app_type and instance_name parameters are required"
            })

        summary = get_instance_state_management_summary(app_type, instance_name)

        return base_response(200, {
            "success": True,
            "processed_count": summary.get("processed_count", 0),
            "next_reset_time": summary.get("next_reset_time"),
            "expiration_hours": summary.get("expiration_hours"),
            "has_processed_items": summary.get("has_processed_items", False),
            "state_management_enabled": summary.get("state_management_enabled")
        })

    except Exception as e:
        stateful_logger.error("Error getting stateful summary for %s/%s: %s", app_type, instance_name, e)
        return base_response(500, {
            "success": False,
            "message": f"Error getting summary: {str(e)}",
        })
