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
        logger.info(f"[Requestarr] Received request: {data}")
        
        # Validate required fields
        required_fields = ['tmdb_id', 'media_type', 'title']
        for field in required_fields:
            if field not in data:
                error_msg = f'Missing required field: {field}'
                logger.error(f"[Requestarr] {error_msg}")
                return jsonify({'success': False, 'message': error_msg}), 400
        
        # Extract instance name from 'instance' field (new modal format) or 'instance_name' (old format)
        instance_name = data.get('instance') or data.get('instance_name')
        if not instance_name:
            error_msg = 'Missing required field: instance'
            logger.error(f"[Requestarr] {error_msg}")
            return jsonify({'success': False, 'message': error_msg}), 400
        
        # Determine app_type from media_type if not provided
        media_type = data['media_type']
        app_type = data.get('app_type')
        if not app_type:
            app_type = 'sonarr' if media_type == 'tv' else 'radarr'
        
        logger.info(f"[Requestarr] Processing {media_type} request for '{data['title']}' to {app_type} instance '{instance_name}'")
        
        # Get quality_profile from request, convert empty string to None
        quality_profile = data.get('quality_profile')
        quality_profile_id = int(quality_profile) if quality_profile and quality_profile != '' else None
        
        result = requestarr_api.request_media(
            tmdb_id=data['tmdb_id'],
            media_type=media_type,
            title=data['title'],
            year=data.get('year'),
            overview=data.get('overview', ''),
            poster_path=data.get('poster_path', ''),
            backdrop_path=data.get('backdrop_path', ''),
            app_type=app_type,
            instance_name=instance_name,
            quality_profile_id=quality_profile_id
        )
        
        logger.info(f"[Requestarr] Request result: {result}")
        
        if result['success']:
            return jsonify(result)
        else:
            return jsonify(result), 400
            
    except Exception as e:
        error_msg = f"Error requesting media: {str(e)}"
        logger.error(f"[Requestarr] {error_msg}", exc_info=True)
        return jsonify({'success': False, 'message': error_msg}), 500

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
    """Get popular movies with optional filters"""
    try:
        page = int(request.args.get('page', 1))
        
        # Collect filter parameters
        filter_params = {}
        if request.args.get('sort_by'):
            filter_params['sort_by'] = request.args.get('sort_by')
        if request.args.get('with_genres'):
            filter_params['with_genres'] = request.args.get('with_genres')
        if request.args.get('with_original_language'):
            filter_params['with_original_language'] = request.args.get('with_original_language')
        if request.args.get('release_date.gte'):
            filter_params['release_date.gte'] = request.args.get('release_date.gte')
        if request.args.get('release_date.lte'):
            filter_params['release_date.lte'] = request.args.get('release_date.lte')
        if request.args.get('with_runtime.gte'):
            filter_params['with_runtime.gte'] = request.args.get('with_runtime.gte')
        if request.args.get('with_runtime.lte'):
            filter_params['with_runtime.lte'] = request.args.get('with_runtime.lte')
        if request.args.get('vote_average.gte'):
            filter_params['vote_average.gte'] = request.args.get('vote_average.gte')
        if request.args.get('vote_average.lte'):
            filter_params['vote_average.lte'] = request.args.get('vote_average.lte')
        if request.args.get('vote_count.gte'):
            filter_params['vote_count.gte'] = request.args.get('vote_count.gte')
        if request.args.get('vote_count.lte'):
            filter_params['vote_count.lte'] = request.args.get('vote_count.lte')
        
        results = requestarr_api.get_popular_movies(page, **filter_params)
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

@requestarr_bp.route('/settings/cooldown', methods=['GET'])
def get_cooldown_settings():
    """Get cooldown period setting"""
    try:
        cooldown_hours = requestarr_api.get_cooldown_hours()
        return jsonify({'success': True, 'cooldown_hours': cooldown_hours})
    except Exception as e:
        logger.error(f"Error getting cooldown settings: {e}")
        return jsonify({'success': False, 'error': 'Failed to get cooldown settings'}), 500

@requestarr_bp.route('/settings/cooldown', methods=['POST'])
def set_cooldown_settings():
    """Set cooldown period setting"""
    try:
        data = request.get_json()
        cooldown_hours = data.get('cooldown_hours', 168)
        
        requestarr_api.set_cooldown_hours(cooldown_hours)
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"Error setting cooldown settings: {e}")
        return jsonify({'success': False, 'error': 'Failed to set cooldown settings'}), 500

@requestarr_bp.route('/settings/filters', methods=['GET'])
def get_discover_filters():
    """Get discover filter settings"""
    try:
        filters = requestarr_api.get_discover_filters()
        return jsonify({'success': True, 'filters': filters})
    except Exception as e:
        logger.error(f"Error getting discover filters: {e}")
        return jsonify({'success': False, 'error': 'Failed to get discover filters'}), 500

@requestarr_bp.route('/settings/filters', methods=['POST'])
def set_discover_filters():
    """Set discover filter settings"""
    try:
        data = request.get_json()
        region = data.get('region', '')
        languages = data.get('languages', [])
        
        requestarr_api.set_discover_filters(region, languages)
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"Error setting discover filters: {e}")
        return jsonify({'success': False, 'error': 'Failed to set discover filters'}), 500

@requestarr_bp.route('/reset-cooldowns', methods=['POST'])
def reset_cooldowns():
    """Reset all cooldowns with 25+ hours remaining"""
    try:
        count = requestarr_api.reset_cooldowns()
        return jsonify({'success': True, 'count': count})
    except Exception as e:
        logger.error(f"Error resetting cooldowns: {e}")
        return jsonify({'success': False, 'error': 'Failed to reset cooldowns'}), 500

@requestarr_bp.route('/genres/<media_type>', methods=['GET'])
def get_genres(media_type):
    """Get genres for movie or tv"""
    try:
        if media_type not in ['movie', 'tv']:
            return jsonify({'error': 'Invalid media type'}), 400
        
        genres = requestarr_api.get_genres(media_type)
        return jsonify({'genres': genres})
    except Exception as e:
        logger.error(f"Error getting genres: {e}")
        return jsonify({'error': 'Failed to get genres'}), 500

# Requestarr is always enabled with hardcoded TMDB API key
logger.info("Requestarr initialized with hardcoded TMDB API key") 