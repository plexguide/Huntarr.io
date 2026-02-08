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
        root_folder_path = (data.get('root_folder_path') or '').strip() or None
        
        # For Movie Hunt, quality_profile is a name string, not an integer ID
        if app_type == 'movie_hunt':
            quality_profile_id = None  # Not used for Movie Hunt
            quality_profile_name = quality_profile if quality_profile and quality_profile != '' else None
        else:
            quality_profile_id = int(quality_profile) if quality_profile and quality_profile != '' else None
            quality_profile_name = None
        
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
            quality_profile_id=quality_profile_id,
            root_folder_path=root_folder_path,
            quality_profile_name=quality_profile_name
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
        
        # Get default instances for filtering
        default_instances = requestarr_api.get_default_instances()
        movie_instance = default_instances.get('movie_instance', '')
        tv_instance = default_instances.get('tv_instance', '')
        
        logger.info(f"[get_trending] Using default instances - movie: {movie_instance}, tv: {tv_instance}")
        
        results = requestarr_api.get_trending(
            time_window,
            movie_instance=movie_instance,
            tv_instance=tv_instance
        )
        return jsonify({'results': results})
    except Exception as e:
        logger.error(f"Error getting trending: {e}")
        return jsonify({'error': 'Failed to get trending'}), 500

@requestarr_bp.route('/discover/movies', methods=['GET'])
def get_popular_movies():
    """Get popular movies with optional filters"""
    try:
        page = int(request.args.get('page', 1))
        hide_available = request.args.get('hide_available', 'false').lower() == 'true'
        
        # Log instance parameters
        app_type = request.args.get('app_type')
        instance_name = request.args.get('instance_name')
        logger.info(f"GET /discover/movies - page: {page}, app_type: {app_type}, instance_name: {instance_name}")
        
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
        
        # Add instance info for per-instance library status checking
        if request.args.get('app_type'):
            filter_params['app_type'] = request.args.get('app_type')
        if request.args.get('instance_name'):
            filter_params['instance_name'] = request.args.get('instance_name')
        
        results = requestarr_api.get_popular_movies(page, **filter_params)
        
        # NOTE: We don't filter hidden media in discover view - users should see all content
        # Hidden media filtering is only for library-specific views
        # The status badges will show if items are in library or not
        
        # Get instance info for library status checking (already done in get_popular_movies)
        # app_type = request.args.get('app_type', 'radarr')
        # instance_name = request.args.get('instance_name')
        
        # Filter out available movies if hide_available is true
        original_count = len(results)
        if hide_available:
            results = requestarr_api.filter_available_media(results, 'movie')
        
        # Always allow more pages when filtering (TMDB has 500+ pages)
        # Frontend should continue loading until no results
        has_more = len(results) > 0 or page < 100  # Reasonable upper limit
        
        return jsonify({
            'results': results, 
            'page': page,
            'has_more': has_more,
            'filtered': hide_available,
            'original_count': original_count if hide_available else None
        })
    except Exception as e:
        logger.error(f"Error getting popular movies: {e}")
        return jsonify({'error': 'Failed to get popular movies'}), 500

@requestarr_bp.route('/discover/tv', methods=['GET'])
def get_popular_tv():
    """Get popular TV shows with optional filters"""
    try:
        page = int(request.args.get('page', 1))
        hide_available = request.args.get('hide_available', 'false').lower() == 'true'
        
        # Log instance parameters
        app_type = request.args.get('app_type')
        instance_name = request.args.get('instance_name')
        logger.info(f"GET /discover/tv - page: {page}, app_type: {app_type}, instance_name: {instance_name}")
        
        # Collect filter parameters
        filter_params = {}
        if request.args.get('sort_by'):
            filter_params['sort_by'] = request.args.get('sort_by')
        if request.args.get('with_genres'):
            filter_params['with_genres'] = request.args.get('with_genres')
        if request.args.get('with_original_language'):
            filter_params['with_original_language'] = request.args.get('with_original_language')
        if request.args.get('first_air_date.gte'):
            filter_params['first_air_date.gte'] = request.args.get('first_air_date.gte')
        if request.args.get('first_air_date.lte'):
            filter_params['first_air_date.lte'] = request.args.get('first_air_date.lte')
        if request.args.get('vote_average.gte'):
            filter_params['vote_average.gte'] = request.args.get('vote_average.gte')
        if request.args.get('vote_average.lte'):
            filter_params['vote_average.lte'] = request.args.get('vote_average.lte')
        if request.args.get('vote_count.gte'):
            filter_params['vote_count.gte'] = request.args.get('vote_count.gte')
        if request.args.get('vote_count.lte'):
            filter_params['vote_count.lte'] = request.args.get('vote_count.lte')
        
        # Add instance info for per-instance library status checking
        if request.args.get('app_type'):
            filter_params['app_type'] = request.args.get('app_type')
        if request.args.get('instance_name'):
            filter_params['instance_name'] = request.args.get('instance_name')
        
        results = requestarr_api.get_popular_tv(page, **filter_params)
        
        # NOTE: We don't filter hidden media in discover view - users should see all content
        # Hidden media filtering is only for library-specific views
        # The status badges will show if items are in library or not
        
        # Get instance info for library status checking (already done in get_popular_tv)
        # app_type = request.args.get('app_type', 'sonarr')
        # instance_name = request.args.get('instance_name')
        
        # Filter out available TV shows if hide_available is true
        original_count = len(results)
        if hide_available:
            results = requestarr_api.filter_available_media(results, 'tv')
        
        # Always allow more pages when filtering (TMDB has 500+ pages)
        # Frontend should continue loading until no results
        has_more = len(results) > 0 or page < 100  # Reasonable upper limit
        
        return jsonify({
            'results': results, 
            'page': page,
            'has_more': has_more,
            'filtered': hide_available,
            'original_count': original_count if hide_available else None
        })
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
    """Get movie status from Radarr or Movie Hunt - in library, previously requested, etc."""
    try:
        tmdb_id = request.args.get('tmdb_id', type=int)
        instance_name = request.args.get('instance')
        app_type = request.args.get('app_type', '').strip().lower()
        
        if not tmdb_id or not instance_name:
            return jsonify({'error': 'Missing parameters'}), 400
        
        # Route to Movie Hunt status check if app_type is movie_hunt
        if app_type == 'movie_hunt':
            status = requestarr_api.get_movie_status_from_movie_hunt(tmdb_id, instance_name)
        else:
            # Default: Get movie status from Radarr
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
    """Get quality profiles from Radarr, Sonarr, or Movie Hunt instance"""
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
        cooldown_hours = data.get('cooldown_hours', 24)
        
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
        providers = data.get('providers', [])
        
        requestarr_api.set_discover_filters(region, languages, providers)
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"Error setting discover filters: {e}")
        return jsonify({'success': False, 'error': 'Failed to set discover filters'}), 500

@requestarr_bp.route('/settings/default-instances', methods=['GET'])
def get_default_instances():
    """Get default instance settings for discovery"""
    try:
        defaults = requestarr_api.get_default_instances()
        logger.info(f"GET default instances - Returning: {defaults}")
        return jsonify({'success': True, 'defaults': defaults})
    except Exception as e:
        logger.error(f"Error getting default instances: {e}")
        return jsonify({'success': False, 'error': 'Failed to get default instances'}), 500

@requestarr_bp.route('/settings/default-instances', methods=['POST'])
def set_default_instances():
    """Set default instance settings for discovery"""
    try:
        data = request.get_json()
        movie_instance = data.get('movie_instance', '')
        tv_instance = data.get('tv_instance', '')
        
        logger.info(f"POST default instances - Saving movie: '{movie_instance}', tv: '{tv_instance}'")
        requestarr_api.set_default_instances(movie_instance, tv_instance)
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"Error setting default instances: {e}")
        return jsonify({'success': False, 'error': 'Failed to set default instances'}), 500

@requestarr_bp.route('/rootfolders', methods=['GET'])
def get_root_folders():
    """Get root folders for a *arr or Movie Hunt instance"""
    try:
        app_type = request.args.get('app_type', '').strip().lower()
        instance_name = request.args.get('instance_name', '').strip()
        if app_type not in ('radarr', 'sonarr', 'movie_hunt') or not instance_name:
            return jsonify({'success': False, 'error': 'app_type (radarr/sonarr/movie_hunt) and instance_name required'}), 400
        folders = requestarr_api.get_root_folders(app_type, instance_name)
        return jsonify({'success': True, 'root_folders': folders})
    except Exception as e:
        logger.error(f"Error getting root folders: {e}")
        return jsonify({'success': False, 'error': 'Failed to get root folders'}), 500

@requestarr_bp.route('/settings/default-root-folders', methods=['GET'])
def get_default_root_folders():
    """Get default root folder paths per app (issue #806)"""
    try:
        data = requestarr_api.get_default_root_folders()
        return jsonify({'success': True, **data})
    except Exception as e:
        logger.error(f"Error getting default root folders: {e}")
        return jsonify({'success': False, 'error': 'Failed to get default root folders'}), 500

@requestarr_bp.route('/settings/default-root-folders', methods=['POST'])
def set_default_root_folders():
    """Set default root folder paths per app (issue #806)"""
    try:
        data = request.get_json() or {}
        radarr_path = data.get('default_root_folder_radarr', '')
        sonarr_path = data.get('default_root_folder_sonarr', '')
        movie_hunt_path = data.get('default_root_folder_movie_hunt', '')
        requestarr_api.set_default_root_folders(
            default_root_folder_radarr=radarr_path,
            default_root_folder_sonarr=sonarr_path,
            default_root_folder_movie_hunt=movie_hunt_path
        )
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"Error setting default root folders: {e}")
        return jsonify({'success': False, 'error': 'Failed to set default root folders'}), 500

@requestarr_bp.route('/watch-providers/<media_type>', methods=['GET'])
def get_watch_providers(media_type):
    """Get watch providers for a media type and region"""
    try:
        if media_type not in ['movie', 'tv']:
            return jsonify({'error': 'Invalid media type'}), 400
        
        region = request.args.get('region', '').strip().upper()
        providers = requestarr_api.get_watch_providers(media_type, region)
        return jsonify({'providers': providers})
    except Exception as e:
        logger.error(f"Error getting watch providers: {e}")
        return jsonify({'error': 'Failed to get watch providers'}), 500

@requestarr_bp.route('/settings/blacklisted-genres', methods=['GET'])
def get_blacklisted_genres():
    """Get blacklisted TV and movie genre IDs"""
    try:
        data = requestarr_api.get_blacklisted_genres()
        return jsonify({'success': True, **data})
    except Exception as e:
        logger.error(f"Error getting blacklisted genres: {e}")
        return jsonify({'success': False, 'error': 'Failed to get blacklisted genres'}), 500

@requestarr_bp.route('/settings/blacklisted-genres', methods=['POST'])
def set_blacklisted_genres():
    """Set blacklisted TV and movie genre IDs"""
    try:
        data = request.get_json()
        blacklisted_tv = data.get('blacklisted_tv_genres', [])
        blacklisted_movie = data.get('blacklisted_movie_genres', [])
        requestarr_api.set_blacklisted_genres(blacklisted_tv, blacklisted_movie)
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"Error setting blacklisted genres: {e}")
        return jsonify({'success': False, 'error': 'Failed to set blacklisted genres'}), 500

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

# Hidden Media Management
@requestarr_bp.route('/hidden-media', methods=['POST'])
def add_hidden_media():
    """Add media to hidden list"""
    try:
        data = request.get_json()
        tmdb_id = data.get('tmdb_id')
        media_type = data.get('media_type')
        title = data.get('title')
        poster_path = data.get('poster_path')
        app_type = data.get('app_type')
        instance_name = data.get('instance_name')
        
        if not all([tmdb_id, media_type, title, app_type, instance_name]):
            return jsonify({'error': 'Missing required fields: tmdb_id, media_type, title, app_type, instance_name'}), 400
        
        success = requestarr_api.db.add_hidden_media(tmdb_id, media_type, title, app_type, instance_name, poster_path)
        
        if success:
            return jsonify({'success': True, 'message': 'Media hidden successfully'})
        else:
            return jsonify({'error': 'Failed to hide media'}), 500
            
    except Exception as e:
        logger.error(f"Error hiding media: {e}")
        return jsonify({'error': 'Failed to hide media'}), 500

@requestarr_bp.route('/hidden-media/<int:tmdb_id>/<media_type>/<app_type>/<instance_name>', methods=['DELETE'])
def remove_hidden_media(tmdb_id, media_type, app_type, instance_name):
    """Remove media from hidden list (unhide) for specific instance"""
    try:
        logger.info(f"DELETE /hidden-media called: tmdb_id={tmdb_id}, media_type={media_type}, app_type={app_type}, instance_name={instance_name}")
        success = requestarr_api.db.remove_hidden_media(tmdb_id, media_type, app_type, instance_name)
        
        if success:
            logger.info(f"Successfully unhidden media: {tmdb_id}")
            return jsonify({'success': True, 'message': 'Media unhidden successfully'})
        else:
            logger.error(f"Failed to unhide media: {tmdb_id}")
            return jsonify({'error': 'Failed to unhide media'}), 500
            
    except Exception as e:
        logger.error(f"Error unhiding media: {e}")
        return jsonify({'error': 'Failed to unhide media'}), 500

@requestarr_bp.route('/hidden-media', methods=['GET'])
def get_hidden_media():
    """Get list of hidden media with pagination and optional filters"""
    try:
        page = int(request.args.get('page', 1))
        page_size = int(request.args.get('page_size', 20))
        media_type = request.args.get('media_type')  # Optional filter
        app_type = request.args.get('app_type')  # Optional filter
        instance_name = request.args.get('instance_name')  # Optional filter
        
        result = requestarr_api.db.get_hidden_media(page, page_size, media_type, app_type, instance_name)
        return jsonify(result)
        
    except Exception as e:
        logger.error(f"Error getting hidden media: {e}")
        return jsonify({'error': 'Failed to get hidden media'}), 500

@requestarr_bp.route('/instances/<app_type>', methods=['GET'])
def get_instances(app_type):
    """Get list of configured instances for an app type (radarr/sonarr/movie_hunt)"""
    try:
        # Movie Hunt instances come from the dedicated database table
        if app_type == 'movie_hunt':
            from src.primary.utils.database import get_database
            db = get_database()
            mh_instances = db.get_movie_hunt_instances()
            instances = []
            seen_names = set()
            for inst in mh_instances:
                name = (inst.get('name') or '').strip()
                if not name:
                    continue
                normalized_name = name.lower()
                if normalized_name in seen_names:
                    continue
                seen_names.add(normalized_name)
                instances.append({
                    'name': name,
                    'id': inst.get('id'),
                    'url': 'internal'  # Movie Hunt is internal, no external URL
                })
            return jsonify({'instances': instances, 'app_type': 'movie_hunt'})
        
        from src.primary.settings_manager import get_setting
        
        # Get instances from settings
        instances_data = get_setting(app_type, 'instances', [])
        
        # Format response, keep only enabled + dedupe by name (case-insensitive)
        instances = []
        seen_names = set()
        for instance in instances_data:
            if not isinstance(instance, dict) or 'name' not in instance:
                continue
            if not instance.get('enabled', False):
                continue
            
            # Normalize name for deduplication
            name = str(instance['name']).strip()
            if not name:
                continue
            
            normalized_name = name.lower()
            if normalized_name in seen_names:
                continue
            
            seen_names.add(normalized_name)
            instances.append({
                'name': name,
                'url': instance.get('api_url', '') or instance.get('url', '')
            })
        
        return jsonify({'instances': instances, 'app_type': app_type})
        
    except Exception as e:
        logger.error(f"Error getting {app_type} instances: {e}")
        return jsonify({'error': f'Failed to get {app_type} instances'}), 500

# Requestarr is always enabled with hardcoded TMDB API key
logger.info("Requestarr initialized with hardcoded TMDB API key") 