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
        
        if not app_type:
            return jsonify({'error': 'App type is required'}), 400
        
        # Relax instance_name requirement to allow TMDB-only search when no instance is selected
        if instance_name and instance_name.isdigit():
            from src.primary.utils.database import get_database
            db = get_database()
            resolved = None
            if app_type == 'movie_hunt':
                for inst in (db.get_movie_hunt_instances() or []):
                    if str(inst.get('id')) == instance_name:
                        resolved = (inst.get('name') or '').strip()
                        break
            elif app_type == 'tv_hunt':
                for inst in (db.get_tv_hunt_instances() or []):
                    if str(inst.get('id')) == instance_name:
                        resolved = (inst.get('name') or '').strip()
                        break
            if resolved is not None:
                instance_name = resolved
        
        results = requestarr_api.search_media_with_availability(query, app_type, instance_name or None)
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
        
        if not app_type:
            return jsonify({'error': 'App type is required'}), 400
        
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


@requestarr_bp.route('/collection', methods=['GET'])
def get_unified_collection():
    """Unified collection endpoint: merges Movie Hunt + TV Hunt collections into a single response.
    Params: movie_instance_id, tv_instance_id (optional), sort (default title.asc), page, page_size, q (search).
    Returns: { items: [...], total, page, page_size } with media_type on each item.
    """
    try:
        movie_instance_id = request.args.get('movie_instance_id', '').strip()
        tv_instance_id = request.args.get('tv_instance_id', '').strip()
        if not movie_instance_id and not tv_instance_id:
            return jsonify({'items': [], 'total': 0, 'page': 1, 'page_size': 20}), 200

        sort = request.args.get('sort', 'title.asc').strip()
        try:
            page = max(1, int(request.args.get('page', 1)))
        except (TypeError, ValueError):
            page = 1
        try:
            page_size = max(1, min(10000, int(request.args.get('page_size', 20))))
        except (TypeError, ValueError):
            page_size = 20
        q = request.args.get('q', '').strip()

        movie_items = []
        tv_items = []

        # Fetch movie collection directly from database (test_client is unreliable)
        if movie_instance_id:
            try:
                from src.primary.routes.media_hunt.discovery_movie import _get_collection_config as _get_movie_collection
                try:
                    mv_id_int = int(movie_instance_id)
                except (TypeError, ValueError):
                    mv_id_int = 0
                if mv_id_int:
                    collection_items = _get_movie_collection(mv_id_int)
                    for m in collection_items:
                        m['media_type'] = 'movie'
                        m['_sortTitle'] = (m.get('title') or '').lower()
                        m['_year'] = str(m.get('year') or '')
                        movie_items.append(m)
            except Exception as e:
                logger.warning(f"[Requestarr] Movie collection fetch error: {e}")

        # Fetch TV collection directly from database (test_client is unreliable)
        if tv_instance_id:
            try:
                from src.primary.routes.media_hunt.discovery_tv import _get_collection_config
                try:
                    tv_id_int = int(tv_instance_id)
                except (TypeError, ValueError):
                    tv_id_int = 0
                if tv_id_int:
                    series_list = _get_collection_config(tv_id_int)
                    for s in series_list:
                        title = s.get('title') or s.get('name') or ''
                        year = (s.get('first_air_date') or '')[:4]
                        tv_items.append({
                            'media_type': 'tv',
                            'tmdb_id': s.get('tmdb_id'),
                            'title': title,
                            'name': title,
                            'year': year,
                            'first_air_date': s.get('first_air_date'),
                            'poster_path': s.get('poster_path'),
                            'status': s.get('status'),
                            'seasons': s.get('seasons'),
                            'overview': s.get('overview'),
                            'vote_average': s.get('vote_average'),
                            '_sortTitle': title.lower(),
                            '_year': year,
                            '_raw': s,
                        })
            except Exception as e:
                logger.warning(f"[Requestarr] TV collection fetch error: {e}")

        combined = movie_items + tv_items

        # Apply search filter for TV (movie API applies q server-side; TV has no q param)
        if q:
            ql = q.lower()
            combined = [
                x for x in combined
                if ql in ((x.get('title') or '') + ' ' + str(x.get('year') or '')).lower()
            ]

        # Sort (title.asc, title.desc, year.desc, year.asc)
        def sort_key(item):
            st = item.get('_sortTitle') or ''
            yr = item.get('_year') or ''
            return (st, yr)

        combined.sort(key=sort_key)
        if sort == 'title.desc':
            combined.reverse()
        elif sort == 'year.desc':
            combined.sort(key=lambda x: (x.get('_year') or '', x.get('_sortTitle') or ''), reverse=True)
        elif sort == 'year.asc':
            combined.sort(key=lambda x: (x.get('_year') or '', x.get('_sortTitle') or ''))

        total = len(combined)
        start = (page - 1) * page_size
        page_items = combined[start : start + page_size]

        return jsonify({
            'items': page_items,
            'total': total,
            'page': page,
            'page_size': page_size,
        }), 200
    except Exception as e:
        logger.exception("[Requestarr] Unified collection error")
        return jsonify({'items': [], 'total': 0, 'page': 1, 'page_size': 20, 'error': str(e)}), 200


@requestarr_bp.route('/request', methods=['POST'])
def request_media():
    """Request media through app instance"""
    try:
        data = request.get_json() or {}
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
        
        # Determine app_type from request; fallback for TV when quality_profile is a name (TV Hunt)
        media_type = data['media_type']
        app_type = (data.get('app_type') or '').strip() or None
        if not app_type:
            app_type = 'sonarr' if media_type == 'tv' else 'radarr'
        quality_profile_raw = data.get('quality_profile')
        # If TV + quality_profile looks like a name (not numeric), treat as TV Hunt
        if media_type == 'tv' and quality_profile_raw and str(quality_profile_raw).strip():
            try:
                int(quality_profile_raw)
            except (TypeError, ValueError):
                if app_type == 'sonarr':
                    th_instances = requestarr_api.get_enabled_instances().get('tv_hunt', [])
                    if any(inst.get('name') == instance_name for inst in th_instances):
                        app_type = 'tv_hunt'
                        logger.info(f"[Requestarr] Inferred app_type=tv_hunt (instance '{instance_name}' in TV Hunt, profile name '{quality_profile_raw}')")
        
        logger.info(f"[Requestarr] Processing {media_type} request for '{data['title']}' to {app_type} instance '{instance_name}'")
        
        # Get quality_profile from request, convert empty string to None
        quality_profile = data.get('quality_profile')
        root_folder_path = (data.get('root_folder_path') or '').strip() or None
        start_search = data.get('start_search', True)
        if isinstance(start_search, str):
            start_search = start_search.strip().lower() not in ('false', '0', 'no', '')
        elif start_search is None:
            start_search = True
        # minimum_availability only applies to movies (Radarr / Movie Hunt), not Sonarr TV
        minimum_availability = 'released'
        if media_type != 'tv':
            minimum_availability = (data.get('minimum_availability') or '').strip() or 'released'
        
        # For Movie Hunt and TV Hunt, quality_profile is a name string, not an integer ID
        if app_type in ('movie_hunt', 'tv_hunt'):
            quality_profile_id = None
            quality_profile_name = quality_profile if quality_profile and quality_profile != '' else None
        else:
            quality_profile_id = None
            quality_profile_name = None
            if quality_profile and str(quality_profile).strip() != '':
                try:
                    quality_profile_id = int(quality_profile)
                except (TypeError, ValueError):
                    logger.warning(f"[Requestarr] quality_profile '{quality_profile}' is not a valid ID for {app_type}")
                    return jsonify({'success': False, 'message': f'Invalid quality profile. For TV Hunt, select a TV Hunt instance (not Sonarr).'}), 400
        
        monitor = (data.get('monitor') or '').strip() or None
        movie_monitor = (data.get('movie_monitor') or '').strip() or None
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
            quality_profile_name=quality_profile_name,
            start_search=start_search,
            minimum_availability=minimum_availability,
            monitor=monitor,
            movie_monitor=movie_monitor
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

def _safe_pagination():
    """Parse page/page_size from query with safe defaults."""
    try:
        page = max(1, int(request.args.get('page', 1)))
    except (TypeError, ValueError):
        page = 1
    try:
        page_size = max(1, min(100, int(request.args.get('page_size', 20))))
    except (TypeError, ValueError):
        page_size = 20
    return page, page_size


@requestarr_bp.route('/requests', methods=['GET'])
def get_requests():
    """Get paginated list of requests"""
    try:
        page, page_size = _safe_pagination()
        
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
        page = max(1, request.args.get('page', 1, type=int))
        time_window = request.args.get('time_window', 'week')
        
        # Prefer explicit query params (sent by frontend) to avoid race conditions with DB save
        movie_app_type = request.args.get('movie_app_type', '')
        movie_instance_name = request.args.get('movie_instance_name', '')
        tv_app_type = request.args.get('tv_app_type', '')
        tv_instance_name = request.args.get('tv_instance_name', '')
        
        # Fallback to DB defaults if query params not provided
        default_instances = requestarr_api.get_default_instances()
        raw_movie = default_instances.get('movie_instance', '')
        raw_tv = default_instances.get('tv_instance', '')
        
        if not movie_instance_name or not movie_app_type:
            # Parse compound movie instance value (e.g. "movie_hunt:First" or "radarr:Radarr Test")
            if raw_movie and ':' in raw_movie:
                parts = raw_movie.split(':', 1)
                movie_app_type = movie_app_type or parts[0]
                movie_instance_name = movie_instance_name or parts[1]
            else:
                # Legacy plain instance name — assume radarr
                movie_app_type = movie_app_type or 'radarr'
                movie_instance_name = movie_instance_name or raw_movie
        
        if not tv_instance_name or not tv_app_type:
            # Parse compound TV instance value (e.g. "tv_hunt:Main" or "sonarr:Prime")
            tv_instance_name = tv_instance_name or raw_tv
            if raw_tv and ':' in raw_tv:
                parts = raw_tv.split(':', 1)
                tv_app_type = tv_app_type or parts[0]
                tv_instance_name = tv_instance_name or parts[1]
            else:
                tv_app_type = tv_app_type or 'sonarr'
                tv_instance_name = tv_instance_name or raw_tv
        
        logger.info(f"[get_trending] Using instances - movie: {movie_app_type}:{movie_instance_name}, tv: {tv_app_type}:{tv_instance_name}")
        
        results = requestarr_api.get_trending(
            time_window,
            movie_instance=movie_instance_name,
            tv_instance=tv_instance_name,
            movie_app_type=movie_app_type or 'radarr',
            tv_app_type=tv_app_type or 'sonarr',
            page=page
        )
        return jsonify({'results': results, 'page': page})
    except Exception as e:
        logger.error(f"Error getting trending: {e}")
        return jsonify({'error': 'Failed to get trending'}), 500

@requestarr_bp.route('/discover/movies', methods=['GET'])
def get_popular_movies():
    """Get popular movies with optional filters"""
    try:
        page, _ = _safe_pagination()
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
        
        # Continue loading until no results returned or reasonable upper limit
        has_more = len(results) > 0 and page < 100
        
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
        page, _ = _safe_pagination()
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
        
        # Continue loading until no results returned or reasonable upper limit
        has_more = len(results) > 0 and page < 100
        
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
    """Get series status from Sonarr or TV Hunt - exists, missing episodes, etc."""
    try:
        tmdb_id = request.args.get('tmdb_id', type=int)
        instance_name = request.args.get('instance')
        app_type = (request.args.get('app_type') or 'sonarr').strip().lower()
        
        if not tmdb_id or not instance_name:
            return jsonify({'error': 'Missing parameters'}), 400
        
        if app_type == 'tv_hunt':
            status = requestarr_api.get_series_status_from_tv_hunt(tmdb_id, instance_name)
        else:
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


@requestarr_bp.route('/movie-detail-status', methods=['GET'])
def get_movie_detail_status():
    """Get movie detail for Requestarr info bar (path, status, quality_profile, size) from Radarr. Same shape as Movie Hunt movie-status."""
    try:
        tmdb_id = request.args.get('tmdb_id', type=int)
        instance_name = request.args.get('instance', '').strip()
        if not tmdb_id or not instance_name:
            return jsonify({'success': False, 'error': 'Missing parameters'}), 400
        detail = requestarr_api.get_radarr_movie_detail_status(tmdb_id, instance_name)
        return jsonify(detail)
    except Exception as e:
        logger.error(f"Error getting movie detail status: {e}")
        return jsonify({'success': False, 'found': False}), 500

@requestarr_bp.route('/sonarr/season-search', methods=['POST'])
def sonarr_season_search():
    """Trigger Sonarr SeasonSearch for a series/season. Series must exist in Sonarr."""
    try:
        data = request.get_json(silent=True) or {}
        tmdb_id = data.get('tmdb_id') or data.get('tmdbId')
        instance_name = (data.get('instance') or data.get('instance_name') or '').strip()
        season_number = data.get('season_number') or data.get('seasonNumber')
        if not tmdb_id or not instance_name or season_number is None:
            return jsonify({'success': False, 'message': 'Missing tmdb_id, instance, or season_number'}), 400
        result = requestarr_api.trigger_sonarr_season_search(int(tmdb_id), instance_name, int(season_number))
        return jsonify(result)
    except Exception as e:
        logger.error(f"Sonarr season search error: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500

@requestarr_bp.route('/sonarr/episode-search', methods=['POST'])
def sonarr_episode_search():
    """Trigger Sonarr EpisodeSearch for a specific episode. Series must exist in Sonarr."""
    try:
        data = request.get_json(silent=True) or {}
        tmdb_id = data.get('tmdb_id') or data.get('tmdbId')
        instance_name = (data.get('instance') or data.get('instance_name') or '').strip()
        season_number = data.get('season_number') or data.get('seasonNumber')
        episode_number = data.get('episode_number') or data.get('episodeNumber')
        if not tmdb_id or not instance_name or season_number is None or episode_number is None:
            return jsonify({'success': False, 'message': 'Missing tmdb_id, instance, season_number, or episode_number'}), 400
        result = requestarr_api.trigger_sonarr_episode_search(
            int(tmdb_id), instance_name, int(season_number), int(episode_number)
        )
        return jsonify(result)
    except Exception as e:
        logger.error(f"Sonarr episode search error: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500

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
        data = request.get_json() or {}
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
        data = request.get_json() or {}
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
        data = request.get_json() or {}
        movie_instance = data.get('movie_instance', '')
        tv_instance = data.get('tv_instance', '')
        
        logger.info(f"POST default instances - Saving movie: '{movie_instance}', tv: '{tv_instance}'")
        requestarr_api.set_default_instances(movie_instance, tv_instance)
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"Error setting default instances: {e}")
        return jsonify({'success': False, 'error': 'Failed to set default instances'}), 500

@requestarr_bp.route('/settings/modal-preferences', methods=['GET'])
def get_modal_preferences():
    """Get modal preferences"""
    try:
        prefs = requestarr_api.get_modal_preferences()
        return jsonify({'success': True, 'preferences': prefs})
    except Exception as e:
        logger.error(f"Error getting modal preferences: {e}")
        return jsonify({'success': False, 'error': 'Failed to get modal preferences'}), 500

@requestarr_bp.route('/settings/modal-preferences', methods=['POST'])
def set_modal_preferences():
    """Set modal preferences"""
    try:
        data = request.get_json() or {}
        requestarr_api.set_modal_preferences(data)
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"Error setting modal preferences: {e}")
        return jsonify({'success': False, 'error': 'Failed to set modal preferences'}), 500

@requestarr_bp.route('/rootfolders', methods=['GET'])
def get_root_folders():
    """Get root folders for a *arr or Movie Hunt instance"""
    try:
        app_type = request.args.get('app_type', '').strip().lower()
        instance_name = request.args.get('instance_name', '').strip()
        instance_id = request.args.get('instance_id', type=int)
        if app_type not in ('radarr', 'sonarr', 'movie_hunt', 'tv_hunt'):
            return jsonify({'success': False, 'error': 'app_type (radarr/sonarr/movie_hunt/tv_hunt) required'}), 400
        if app_type == 'movie_hunt' and instance_id is not None:
            folders = requestarr_api.get_root_folders_by_id(instance_id)
        elif instance_name:
            folders = requestarr_api.get_root_folders(app_type, instance_name)
        else:
            return jsonify({'success': False, 'error': 'instance_name or instance_id required'}), 400
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
        data = request.get_json() or {}
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
        data = request.get_json() or {}
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
        page, page_size = _safe_pagination()
        media_type = request.args.get('media_type')  # Optional filter
        app_type = request.args.get('app_type')  # Optional filter
        instance_name = request.args.get('instance_name')  # Optional filter
        
        result = requestarr_api.db.get_hidden_media(page, page_size, media_type, app_type, instance_name)
        return jsonify(result)
        
    except Exception as e:
        logger.error(f"Error getting hidden media: {e}")
        return jsonify({'error': 'Failed to get hidden media'}), 500

@requestarr_bp.route('/has-clients', methods=['GET'])
def has_any_clients():
    """Return whether any Movie Hunt or TV Hunt instance has at least one download client configured."""
    try:
        from src.primary.utils.database import get_database
        from src.primary.routes.media_hunt.clients import get_movie_clients_config, get_tv_clients_config

        db = get_database()
        mh_instances = db.get_movie_hunt_instances() or []
        th_instances = db.get_tv_hunt_instances() or []

        for inst in mh_instances:
            clients = get_movie_clients_config(inst.get('id'))
            if clients and len(clients) > 0:
                return jsonify({'has_clients': True}), 200

        for inst in th_instances:
            clients = get_tv_clients_config(inst.get('id'))
            if clients and len(clients) > 0:
                return jsonify({'has_clients': True}), 200

        return jsonify({'has_clients': False}), 200
    except Exception as e:
        logger.error(f"Error checking has-clients: {e}")
        return jsonify({'has_clients': False}), 200


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
        
        # TV Hunt instances come from the dedicated database table
        if app_type == 'tv_hunt':
            from src.primary.utils.database import get_database
            db = get_database()
            th_instances = db.get_tv_hunt_instances()
            instances = []
            seen_names = set()
            for inst in th_instances:
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
                    'url': 'internal'  # TV Hunt is internal, no external URL
                })
            return jsonify({'instances': instances, 'app_type': 'tv_hunt'})
        
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

# ---------------------------------------------------------------------------
# Smart Hunt routes
# ---------------------------------------------------------------------------

@requestarr_bp.route('/smarthunt', methods=['GET'])
def get_smarthunt():
    """Get Smart Hunt discovery results.
    
    Query params:
        page (int): 1-5, default 1 (20 items per page)
        movie_app_type (str): radarr or movie_hunt
        movie_instance_name (str): movie instance name
        tv_app_type (str): sonarr or tv_hunt
        tv_instance_name (str): TV instance name
    """
    try:
        from src.primary.apps.requestarr.smarthunt import SmartHuntEngine, get_smarthunt_settings

        page, _ = _safe_pagination()
        movie_app_type = request.args.get('movie_app_type', '')
        movie_instance_name = request.args.get('movie_instance_name', '')
        tv_app_type = request.args.get('tv_app_type', '')
        tv_instance_name = request.args.get('tv_instance_name', '')

        # Fall back to saved default instances if not provided
        default_instances = requestarr_api.get_default_instances()
        raw_movie = default_instances.get('movie_instance', '')
        raw_tv = default_instances.get('tv_instance', '')

        if not movie_instance_name or not movie_app_type:
            if raw_movie and ':' in raw_movie:
                parts = raw_movie.split(':', 1)
                movie_app_type = movie_app_type or parts[0]
                movie_instance_name = movie_instance_name or parts[1]
            else:
                movie_app_type = movie_app_type or 'radarr'
                movie_instance_name = movie_instance_name or raw_movie

        if not tv_instance_name or not tv_app_type:
            if raw_tv and ':' in raw_tv:
                parts = raw_tv.split(':', 1)
                tv_app_type = tv_app_type or parts[0]
                tv_instance_name = tv_instance_name or parts[1]
            else:
                tv_app_type = tv_app_type or 'sonarr'
                tv_instance_name = tv_instance_name or raw_tv

        settings = get_smarthunt_settings()

        discover_filters = requestarr_api.get_discover_filters()
        blacklisted_genres = requestarr_api.get_blacklisted_genres()

        engine = SmartHuntEngine()
        results = engine.get_results(
            page=page,
            settings=settings,
            movie_instance=movie_instance_name,
            tv_instance=tv_instance_name,
            movie_app_type=movie_app_type or 'radarr',
            tv_app_type=tv_app_type or 'sonarr',
            discover_filters=discover_filters,
            blacklisted_genres=blacklisted_genres,
        )

        # Re-check library status with live data (cached results may be stale)
        movie_items = [r for r in results if r.get('media_type') == 'movie']
        tv_items = [r for r in results if r.get('media_type') == 'tv']
        if movie_items:
            requestarr_api.check_library_status_batch(
                movie_items, app_type=movie_app_type or 'radarr', instance_name=movie_instance_name
            )
        if tv_items:
            requestarr_api.check_library_status_batch(
                tv_items, app_type=tv_app_type or 'sonarr', instance_name=tv_instance_name
            )
        # Strip internal scoring field only
        for r in results:
            r.pop('_score', None)

        has_more = page < 5 and len(results) > 0
        return jsonify({
            'results': results,
            'page': page,
            'has_more': has_more,
            'cache_ttl_minutes': settings.get('cache_ttl_minutes', 60),
        })
    except Exception as e:
        logger.error(f"Error getting Smart Hunt results: {e}")
        return jsonify({'error': 'Failed to get Smart Hunt results'}), 500


@requestarr_bp.route('/settings/smarthunt', methods=['GET'])
def get_smarthunt_settings_route():
    """Get Smart Hunt settings."""
    try:
        from src.primary.apps.requestarr.smarthunt import get_smarthunt_settings
        settings = get_smarthunt_settings()
        return jsonify({'success': True, 'settings': settings})
    except Exception as e:
        logger.error(f"Error getting Smart Hunt settings: {e}")
        return jsonify({'error': 'Failed to get Smart Hunt settings'}), 500


@requestarr_bp.route('/settings/smarthunt', methods=['POST'])
def save_smarthunt_settings_route():
    """Save Smart Hunt settings."""
    try:
        from src.primary.apps.requestarr.smarthunt import save_smarthunt_settings
        data = request.get_json(silent=True) or {}
        if not data:
            return jsonify({'error': 'No data provided'}), 400

        save_smarthunt_settings(data)
        return jsonify({'success': True, 'message': 'Smart Hunt settings saved'})
    except Exception as e:
        logger.error(f"Error saving Smart Hunt settings: {e}")
        return jsonify({'error': 'Failed to save Smart Hunt settings'}), 500


# Requestarr is always enabled with hardcoded TMDB API key
logger.info("Requestarr initialized with hardcoded TMDB API key")