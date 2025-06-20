"""
Requestor routes for media search and request functionality
"""

from flask import Blueprint, request, jsonify
import logging
from src.primary.apps.requestor import requestor_api

logger = logging.getLogger(__name__)

# Create blueprint
requestor_bp = Blueprint('requestor', __name__, url_prefix='/api/requestor')

@requestor_bp.route('/settings', methods=['GET'])
def get_requestor_settings():
    """Get Requestor settings"""
    try:
        settings = requestor_api.get_settings()
        return jsonify(settings)
    except Exception as e:
        logger.error(f"Error getting requestor settings: {e}")
        return jsonify({'error': 'Failed to get settings'}), 500

@requestor_bp.route('/settings', methods=['POST'])
def save_requestor_settings():
    """Save Requestor settings"""
    try:
        data = request.get_json()
        tmdb_api_key = data.get('tmdb_api_key', '')
        enabled = data.get('enabled', False)
        
        success = requestor_api.save_settings(tmdb_api_key, enabled)
        
        if success:
            return jsonify({'success': True, 'message': 'Settings saved successfully'})
        else:
            return jsonify({'success': False, 'error': 'Failed to save settings'}), 500
            
    except Exception as e:
        logger.error(f"Error saving requestor settings: {e}")
        return jsonify({'success': False, 'error': 'Failed to save settings'}), 500

@requestor_bp.route('/search', methods=['GET'])
def search_media():
    """Search for media using TMDB"""
    try:
        query = request.args.get('q', '').strip()
        media_type = request.args.get('type', 'multi')  # multi, movie, tv
        
        if not query:
            return jsonify({'results': []})
        
        results = requestor_api.search_media(query, media_type)
        return jsonify({'results': results})
        
    except Exception as e:
        logger.error(f"Error searching media: {e}")
        return jsonify({'error': 'Search failed'}), 500

@requestor_bp.route('/instances', methods=['GET'])
def get_enabled_instances():
    """Get enabled Sonarr and Radarr instances"""
    try:
        instances = requestor_api.get_enabled_instances()
        return jsonify(instances)
    except Exception as e:
        logger.error(f"Error getting instances: {e}")
        return jsonify({'error': 'Failed to get instances'}), 500

@requestor_bp.route('/request', methods=['POST'])
def request_media():
    """Request media through app instance"""
    try:
        data = request.get_json()
        
        # Validate required fields
        required_fields = ['tmdb_id', 'media_type', 'title', 'app_type', 'instance_name']
        for field in required_fields:
            if field not in data:
                return jsonify({'success': False, 'error': f'Missing required field: {field}'}), 400
        
        result = requestor_api.request_media(
            tmdb_id=data['tmdb_id'],
            media_type=data['media_type'],
            title=data['title'],
            year=data.get('year'),
            overview=data.get('overview', ''),
            poster_path=data.get('poster_path', ''),
            backdrop_path=data.get('backdrop_path', ''),
            app_type=data['app_type'],
            instance_name=data['instance_name']
        )
        
        if result['success']:
            return jsonify(result)
        else:
            return jsonify(result), 400
            
    except Exception as e:
        logger.error(f"Error requesting media: {e}")
        return jsonify({'success': False, 'error': 'Request failed'}), 500

@requestor_bp.route('/requests', methods=['GET'])
def get_requests():
    """Get paginated list of requests"""
    try:
        page = int(request.args.get('page', 1))
        page_size = int(request.args.get('page_size', 20))
        
        requests_data = requestor_api.db.get_requests(page, page_size)
        return jsonify(requests_data)
        
    except Exception as e:
        logger.error(f"Error getting requests: {e}")
        return jsonify({'error': 'Failed to get requests'}), 500

# Initialize TMDB API key if not set
def initialize_requestor():
    """Initialize Requestor with default API key if not configured"""
    try:
        settings = requestor_api.get_settings()
        if not settings.get('tmdb_api_key'):
            # Set the provided API key as default
            requestor_api.save_settings('9265b0bd0cd1962f7f3225989fcd7192', True)
            logger.info("Initialized Requestor with default TMDB API key")
    except Exception as e:
        logger.error(f"Error initializing Requestor: {e}")

# Call initialization when module is imported
initialize_requestor() 