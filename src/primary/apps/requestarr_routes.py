"""
Requestarr routes for media search and request functionality
"""

from flask import Blueprint, request, jsonify
import logging
from src.primary.apps.requestarr import requestarr_api

logger = logging.getLogger(__name__)

# Create blueprint
requestarr_bp = Blueprint('requestarr', __name__, url_prefix='/api/requestarr')

@requestarr_bp.route('/search', methods=['GET'])
def search_media():
    """Search for media using TMDB with availability checking"""
    try:
        query = request.args.get('q', '').strip()
        app_type = request.args.get('app_type', '').strip()
        instance_name = request.args.get('instance_name', '').strip()
        
        if not query:
            return jsonify({'results': []})
        
        if not app_type or not instance_name:
            return jsonify({'error': 'App type and instance name are required'}), 400
        
        results = requestarr_api.search_media_with_availability(query, app_type, instance_name)
        return jsonify({'results': results})
        
    except Exception as e:
        logger.error(f"Error searching media: {e}")
        return jsonify({'error': 'Search failed'}), 500

@requestarr_bp.route('/search/stream', methods=['GET'])
def search_media_stream():
    """Stream search results as they become available"""
    from flask import Response
    import json
    
    try:
        query = request.args.get('q', '').strip()
        app_type = request.args.get('app_type', '').strip()
        instance_name = request.args.get('instance_name', '').strip()
        
        if not query:
            return jsonify({'error': 'Query parameter is required'}), 400
        
        if not app_type or not instance_name:
            return jsonify({'error': 'App type and instance name are required'}), 400
        
        def generate():
            try:
                for result in requestarr_api.search_media_with_availability_stream(query, app_type, instance_name):
                    yield f"data: {json.dumps(result)}\n\n"
            except Exception as e:
                logger.error(f"Error in streaming search: {e}")
                yield f"data: {json.dumps({'error': str(e)})}\n\n"
        
        return Response(generate(), mimetype='text/plain')
        
    except Exception as e:
        logger.error(f"Error setting up streaming search: {e}")
        return jsonify({'error': 'Search failed'}), 500

@requestarr_bp.route('/instances', methods=['GET'])
def get_enabled_instances():
    """Get enabled Sonarr and Radarr instances"""
    try:
        instances = requestarr_api.get_enabled_instances()
        return jsonify(instances)
    except Exception as e:
        logger.error(f"Error getting instances: {e}")
        return jsonify({'error': 'Failed to get instances'}), 500

@requestarr_bp.route('/request', methods=['POST'])
def request_media():
    """Request media through app instance"""
    try:
        data = request.get_json()
        
        # Validate required fields
        required_fields = ['tmdb_id', 'media_type', 'title', 'app_type', 'instance_name']
        for field in required_fields:
            if field not in data:
                return jsonify({'success': False, 'error': f'Missing required field: {field}'}), 400
        
        result = requestarr_api.request_media(
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

@requestarr_bp.route('/requests', methods=['GET'])
def get_requests():
    """Get paginated list of requests"""
    try:
        page = int(request.args.get('page', 1))
        page_size = int(request.args.get('page_size', 20))
        
        requests_data = requestarr_api.db.get_requests(page, page_size)
        return jsonify(requests_data)
        
    except Exception as e:
        logger.error(f"Error getting requests: {e}")
        return jsonify({'error': 'Failed to get requests'}), 500

# Discover routes
@requestarr_bp.route('/discover/trending', methods=['GET'])
def get_trending():
    """Get trending movies and TV shows"""
    try:
        time_window = request.args.get('time_window', 'week')
        results = requestarr_api.get_trending(time_window)
        return jsonify({'results': results})
    except Exception as e:
        logger.error(f"Error getting trending: {e}")
        return jsonify({'error': 'Failed to get trending'}), 500

@requestarr_bp.route('/discover/movies', methods=['GET'])
def get_popular_movies():
    """Get popular movies"""
    try:
        page = int(request.args.get('page', 1))
        results = requestarr_api.get_popular_movies(page)
        return jsonify({'results': results, 'page': page})
    except Exception as e:
        logger.error(f"Error getting popular movies: {e}")
        return jsonify({'error': 'Failed to get popular movies'}), 500

@requestarr_bp.route('/discover/tv', methods=['GET'])
def get_popular_tv():
    """Get popular TV shows"""
    try:
        page = int(request.args.get('page', 1))
        results = requestarr_api.get_popular_tv(page)
        return jsonify({'results': results, 'page': page})
    except Exception as e:
        logger.error(f"Error getting popular TV: {e}")
        return jsonify({'error': 'Failed to get popular TV'}), 500

@requestarr_bp.route('/details/<media_type>/<int:tmdb_id>', methods=['GET'])
def get_media_details(media_type, tmdb_id):
    """Get detailed information about a movie or TV show"""
    try:
        if media_type not in ['movie', 'tv']:
            return jsonify({'error': 'Invalid media type'}), 400
        
        details = requestarr_api.get_media_details(tmdb_id, media_type)
        if not details:
            return jsonify({'error': 'Media not found'}), 404
        
        return jsonify(details)
    except Exception as e:
        logger.error(f"Error getting media details: {e}")
        return jsonify({'error': 'Failed to get media details'}), 500

@requestarr_bp.route('/series-status', methods=['GET'])
def get_series_status():
    """Get series status from Sonarr - exists, missing episodes, etc."""
    try:
        tmdb_id = request.args.get('tmdb_id', type=int)
        instance_name = request.args.get('instance')
        
        if not tmdb_id or not instance_name:
            return jsonify({'error': 'Missing parameters'}), 400
        
        # Get series status from Sonarr
        status = requestarr_api.get_series_status_from_sonarr(tmdb_id, instance_name)
        return jsonify(status)
        
    except Exception as e:
        logger.error(f"Error getting series status: {e}")
        return jsonify({'error': 'Failed to get series status'}), 500

@requestarr_bp.route('/movie-status', methods=['GET'])
def get_movie_status():
    """Get movie status from Radarr - in library, previously requested, etc."""
    try:
        tmdb_id = request.args.get('tmdb_id', type=int)
        instance_name = request.args.get('instance')
        
        if not tmdb_id or not instance_name:
            return jsonify({'error': 'Missing parameters'}), 400
        
        # Get movie status from Radarr
        status = requestarr_api.get_movie_status_from_radarr(tmdb_id, instance_name)
        return jsonify(status)
        
    except Exception as e:
        logger.error(f"Error getting movie status: {e}")
        return jsonify({'error': 'Failed to get movie status'}), 500

@requestarr_bp.route('/check-seasons', methods=['GET'])
def check_requested_seasons():
    """Check which seasons of a TV show are already in Sonarr"""
    try:
        tmdb_id = request.args.get('tmdb_id', type=int)
        instance_name = request.args.get('instance')
        
        if not tmdb_id or not instance_name:
            return jsonify({'error': 'Missing parameters'}), 400
        
        # Get requested seasons from Sonarr
        requested_seasons = requestarr_api.check_seasons_in_sonarr(tmdb_id, instance_name)
        return jsonify({'requested_seasons': requested_seasons})
        
    except Exception as e:
        logger.error(f"Error checking seasons: {e}")
        return jsonify({'error': 'Failed to check seasons'}), 500

@requestarr_bp.route('/quality-profiles/<app_type>/<instance_name>', methods=['GET'])
def get_quality_profiles(app_type, instance_name):
    """Get quality profiles from Radarr or Sonarr instance"""
    try:
        profiles = requestarr_api.get_quality_profiles(app_type, instance_name)
        return jsonify({'success': True, 'profiles': profiles})
    except Exception as e:
        logger.error(f"Error getting quality profiles: {e}")
        return jsonify({'success': False, 'error': 'Failed to get quality profiles'}), 500

@requestarr_bp.route('/settings/defaults', methods=['GET'])
def get_default_instances():
    """Get default Sonarr and Radarr instances"""
    try:
        defaults = requestarr_api.get_default_instances()
        return jsonify({'success': True, 'defaults': defaults})
    except Exception as e:
        logger.error(f"Error getting default instances: {e}")
        return jsonify({'success': False, 'error': 'Failed to get default instances'}), 500

@requestarr_bp.route('/settings/defaults', methods=['POST'])
def set_default_instances():
    """Set default Sonarr and Radarr instances"""
    try:
        data = request.get_json()
        sonarr_default = data.get('sonarr_instance')
        radarr_default = data.get('radarr_instance')
        
        requestarr_api.set_default_instances(sonarr_default, radarr_default)
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"Error setting default instances: {e}")
        return jsonify({'success': False, 'error': 'Failed to set default instances'}), 500

# Requestarr is always enabled with hardcoded TMDB API key
logger.info("Requestarr initialized with hardcoded TMDB API key") 