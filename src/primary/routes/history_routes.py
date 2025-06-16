from flask import Blueprint, request, jsonify, current_app
import logging

from src.primary.history_manager import get_history, clear_history, add_history_entry

logger = logging.getLogger("huntarr")
history_blueprint = Blueprint('history', __name__)

@history_blueprint.route('/<app_type>', methods=['GET'])
def get_app_history(app_type):
    """Get history entries for a specific app or all apps"""
    try:
        search_query = request.args.get('search', '')
        page = int(request.args.get('page', 1))
        page_size = int(request.args.get('page_size', 20))
        
        # Validate page_size to be one of the allowed values
        allowed_page_sizes = [10, 20, 30, 50, 100, 250, 1000]
        if page_size not in allowed_page_sizes:
            page_size = 20
        
        # Validate app_type
        valid_app_types = ["all", "sonarr", "radarr", "lidarr", "readarr", "whisparr", "eros"]
        if app_type not in valid_app_types:
            return jsonify({"error": f"Invalid app type: {app_type}"}), 400
        
        result = get_history(app_type, search_query, page, page_size)
        return jsonify(result), 200
    
    except Exception as e:
        logger.error(f"Error getting history for {app_type}: {str(e)}")
        return jsonify({"error": str(e)}), 500

@history_blueprint.route('/<app_type>', methods=['DELETE'])
def clear_app_history(app_type):
    """Clear history for a specific app or all apps"""
    try:
        # Validate app_type
        valid_app_types = ["all", "sonarr", "radarr", "lidarr", "readarr", "whisparr", "eros"]
        if app_type not in valid_app_types:
            return jsonify({"error": f"Invalid app type: {app_type}"}), 400
        
        success = clear_history(app_type)
        if success:
            return jsonify({"message": f"History cleared for {app_type}"}), 200
        else:
            return jsonify({"error": f"Failed to clear history for {app_type}"}), 500
    
    except Exception as e:
        logger.error(f"Error clearing history for {app_type}: {str(e)}")
        return jsonify({"error": str(e)}), 500
