#!/usr/bin/env python3
"""
Stateful Management API Routes
Handles API endpoints for stateful management
"""

import json
from typing import Any

from flask import Blueprint, request, Response

from src.primary.stateful_manager import (
    get_instance_state_management_summary,
    reset_state_management,
)
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


@stateful_api.route('/reset', methods=['POST'])
def reset_stateful():
    """Reset the stateful management system (global or per-instance)."""
    try:
        data = request.json or {}
        app_type = data.get('app_type')
        instance_name = data.get('instance_name')

        if not app_type and instance_name:
            return base_response(400, {
                "success": False,
                "message": "app_type and instance_name parameters are required"
            })

        success = reset_state_management(app_type, instance_name)
        if success:
            stateful_logger.info("Successfully reset state management for %s/%s", app_type, instance_name)
            response_data = {"success": True, "message": f"State management reset successfully for {app_type}/{instance_name}"}
        else:
            response_data = {"success": False, "message": f"Failed to reset state management for {app_type}/{instance_name}"}

        return base_response(200 if response_data["success"] else 500, response_data)

    except Exception as e:
        stateful_logger.error("Error resetting stateful management: %s", e)
        return base_response(500, {
            "success": False,
            "message": f"Error resetting stateful management: {str(e)}",
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
            "expiration_hours": summary.get("state_management_hours"),
            "has_processed_items": summary.get("has_processed_items", False),
            "state_management_enabled": summary.get("state_management_enabled")
        })

    except Exception as e:
        stateful_logger.error("Error getting stateful summary for %s/%s: %s", app_type, instance_name, e)
        return base_response(500, {
            "success": False,
            "message": f"Error getting summary: {str(e)}",
        })
