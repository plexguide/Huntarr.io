#!/usr/bin/env python3

from flask import Blueprint, request, jsonify
import requests
import socket
from urllib.parse import urlparse
import time
import threading
from datetime import datetime, timedelta

from src.primary.utils.logger import get_logger
from src.primary.settings_manager import get_ssl_verify_setting, load_settings
import traceback

prowlarr_bp = Blueprint('prowlarr', __name__)
prowlarr_logger = get_logger("prowlarr")

# Cache for statistics
_stats_cache = {
    'data': None,
    'timestamp': 0,
    'cache_duration': 300  # 5 minutes in seconds
}
_cache_lock = threading.Lock()

def test_connection(url, api_key, timeout=30):
    """Test connection to Prowlarr API"""
    try:
        # Auto-correct URL if missing http(s) scheme
        if not (url.startswith('http://') or url.startswith('https://')):
            prowlarr_logger.debug(f"Auto-correcting URL to: {url}")
            url = f"http://{url}"
            prowlarr_logger.debug(f"Auto-correcting URL to: {url}")
        
        # Try to establish a socket connection first to check basic connectivity
        parsed_url = urlparse(url)
        hostname = parsed_url.hostname
        port = parsed_url.port or (443 if parsed_url.scheme == 'https' else 80)
        
        try:
            # Try socket connection for quick feedback on connectivity issues
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(3)  # Short timeout for quick feedback
            result = sock.connect_ex((hostname, port))
            sock.close()
            
            if result != 0:
                error_msg = f"Connection refused - Unable to connect to {hostname}:{port}. Please check if the server is running and the port is correct."
                prowlarr_logger.error(error_msg)
                return {"success": False, "message": error_msg}
        except socket.gaierror:
            error_msg = f"DNS resolution failed - Cannot resolve hostname: {hostname}. Please check your URL."
            prowlarr_logger.error(error_msg)
            return {"success": False, "message": error_msg}
        except Exception as e:
            # Log the socket testing error but continue with the full request
            prowlarr_logger.debug(f"Socket test error, continuing with full request: {str(e)}")
        
        # Create the test URL and set headers - Prowlarr uses v1 API
        test_url = f"{url.rstrip('/')}/api/v1/system/status"
        headers = {'X-Api-Key': api_key}
        
        # Get SSL verification setting
        verify_ssl = get_ssl_verify_setting()
        
        if not verify_ssl:
            prowlarr_logger.debug("SSL verification disabled by user setting for connection test")

        # Make the API request
        response = requests.get(test_url, headers=headers, timeout=(10, timeout), verify=verify_ssl)
        
        # Handle HTTP errors
        if response.status_code == 401:
            error_msg = "Authentication failed: Invalid API key"
            prowlarr_logger.error(error_msg)
            return {"success": False, "message": error_msg}
        elif response.status_code == 403:
            error_msg = "Access forbidden: Check API key permissions"
            prowlarr_logger.error(error_msg)
            return {"success": False, "message": error_msg}
        elif response.status_code == 404:
            error_msg = "API endpoint not found: This doesn't appear to be a valid Prowlarr server. Check your URL."
            prowlarr_logger.error(error_msg)
            return {"success": False, "message": error_msg}
        elif response.status_code >= 500:
            error_msg = f"Prowlarr server error (HTTP {response.status_code}): The Prowlarr server is experiencing issues"
            prowlarr_logger.error(error_msg)
            return {"success": False, "message": error_msg}
        
        # Raise for other HTTP errors
        response.raise_for_status()
        
        # Ensure the response is valid JSON
        try:
            response_data = response.json()
            
            # Return success with some useful information
            return {
                "success": True,
                "message": "Successfully connected to Prowlarr API",
                "version": response_data.get('version', 'unknown')
            }
        except ValueError:
            error_msg = "Invalid JSON response from Prowlarr API - This doesn't appear to be a valid Prowlarr server"
            prowlarr_logger.error(f"{error_msg}. Response content: {response.text[:200]}")
            return {"success": False, "message": error_msg}

    except requests.exceptions.Timeout as e:
        error_msg = f"Connection timed out after {timeout} seconds"
        prowlarr_logger.error(f"{error_msg}: {str(e)}")
        return {"success": False, "message": error_msg}
        
    except requests.exceptions.ConnectionError as e:
        # Handle different types of connection errors
        error_details = str(e)
        if "Connection refused" in error_details:
            error_msg = f"Connection refused - Prowlarr is not running on {url} or the port is incorrect"
        elif "Name or service not known" in error_details or "getaddrinfo failed" in error_details:
            error_msg = f"DNS resolution failed - Cannot find host '{urlparse(url).hostname}'. Check your URL."
        else:
            error_msg = f"Connection error - Check if Prowlarr is running: {error_details}"
            
        prowlarr_logger.error(error_msg)
        return {"success": False, "message": error_msg}
        
    except requests.exceptions.RequestException as e:
        error_msg = f"Connection test failed: {str(e)}"
        prowlarr_logger.error(error_msg)
        return {"success": False, "message": error_msg}
    except Exception as e:
        error_msg = f"Unexpected error: {str(e)}"
        prowlarr_logger.error(f"{error_msg}\n{traceback.format_exc()}")
        return {"success": False, "message": error_msg}

@prowlarr_bp.route('/status', methods=['GET'])
def get_status():
    """Get the status of configured Prowlarr instance"""
    try:
        settings = load_settings("prowlarr")
        
        api_url = settings.get("api_url", "").strip()
        api_key = settings.get("api_key", "").strip()
        enabled = settings.get("enabled", True)
        
        if not api_url or not api_key:
            prowlarr_logger.debug("Prowlarr not configured")
            return jsonify({"configured": False, "connected": False})
        
        # Test connection if enabled
        connected = False
        if enabled:
            test_result = test_connection(api_url, api_key, 5)  # Short timeout for status checks
            connected = test_result['success']
        
        return jsonify({
            "configured": True,
            "connected": connected,
            "enabled": enabled
        })
        
    except Exception as e:
        prowlarr_logger.error(f"Error getting Prowlarr status: {str(e)}")
        return jsonify({"configured": False, "connected": False, "error": str(e)})

@prowlarr_bp.route('/indexers', methods=['GET'])
def get_prowlarr_indexers():
    """Get Prowlarr indexers list quickly (no heavy statistics)"""
    try:
        settings = load_settings("prowlarr")
        
        api_url = settings.get("api_url", "").strip()
        api_key = settings.get("api_key", "").strip()
        enabled = settings.get("enabled", True)
        
        if not api_url or not api_key or not enabled:
            return jsonify({
                'success': False,
                'error': 'Prowlarr is not configured or enabled'
            }), 400
        
        # Clean URL
        if not api_url.startswith(('http://', 'https://')):
            api_url = f'http://{api_url}'
        
        headers = {'X-Api-Key': api_key}
        
        try:
            # Get indexers information and their status
            indexers_url = f"{api_url.rstrip('/')}/api/v1/indexer"
            indexers_response = requests.get(indexers_url, headers=headers, timeout=5)
            
            # Get indexer status information
            status_url = f"{api_url.rstrip('/')}/api/v1/indexerstatus"
            status_response = requests.get(status_url, headers=headers, timeout=5)
            
            if indexers_response.status_code == 200:
                indexers = indexers_response.json()
                
                # Build status lookup by indexer ID
                status_lookup = {}
                if status_response.status_code == 200:
                    status_data = status_response.json()
                    for status in status_data:
                        indexer_id = status.get('indexerId')
                        if indexer_id:
                            status_lookup[indexer_id] = status
                
                # Process indexers with proper status detection
                active_indexers = []
                throttled_indexers = []
                failed_indexers = []
                
                for indexer in indexers:
                    indexer_info = {
                        'name': indexer.get('name', 'Unknown'),
                        'protocol': indexer.get('protocol', 'unknown'),
                        'id': indexer.get('id')
                    }
                    
                    indexer_id = indexer.get('id')
                    is_enabled = indexer.get('enable', False)
                    
                    # Get status information for this indexer
                    status_info = status_lookup.get(indexer_id, {})
                    disabled_till = status_info.get('disabledTill')
                    recent_failure = status_info.get('mostRecentFailure')
                    
                    if not is_enabled:
                        # Explicitly disabled indexers
                        failed_indexers.append(indexer_info)
                    elif disabled_till:
                        # Temporarily disabled due to failures
                        failed_indexers.append(indexer_info)
                    elif recent_failure:
                        # Has recent failures but still enabled - consider it throttled/problematic
                        throttled_indexers.append(indexer_info)
                    else:
                        # Check for rate limiting
                        capabilities = indexer.get('capabilities', {})
                        if capabilities.get('limitsexceeded', False):
                            throttled_indexers.append(indexer_info)
                        else:
                            # Enabled, no failures, no rate limits = active
                            active_indexers.append(indexer_info)
                
                return jsonify({
                    'success': True,
                    'indexer_details': {
                        'active': active_indexers,
                        'throttled': throttled_indexers,
                        'failed': failed_indexers
                    }
                })
            else:
                return jsonify({
                    'success': False,
                    'error': f'Failed to get indexers (HTTP {indexers_response.status_code})'
                }), 500
                
        except requests.exceptions.Timeout:
            return jsonify({
                'success': False,
                'error': 'Connection timeout'
            }), 504
        except requests.exceptions.ConnectionError:
            return jsonify({
                'success': False,
                'error': 'Connection refused'
            }), 503
        except Exception as e:
            prowlarr_logger.error(f"Error getting indexers: {str(e)}")
            return jsonify({
                'success': False,
                'error': f'Error getting indexers: {str(e)}'
            }), 500
        
    except Exception as e:
        prowlarr_logger.error(f"Failed to get Prowlarr indexers: {str(e)}")
        return jsonify({
            'success': False,
            'error': f'Failed to get Prowlarr indexers: {str(e)}'
        }), 500

def _fetch_detailed_stats():
    """Fetch detailed statistics from Prowlarr API (used by background cache update)"""
    try:
        settings = load_settings("prowlarr")
        
        api_url = settings.get("api_url", "").strip()
        api_key = settings.get("api_key", "").strip()
        enabled = settings.get("enabled", True)
        
        if not api_url or not api_key or not enabled:
            return None
        
        # Clean URL
        if not api_url.startswith(('http://', 'https://')):
            api_url = f'http://{api_url}'
        
        headers = {'X-Api-Key': api_key}
        
        # Initialize stats
        stats = {
            'connected': False,
            'searches_today': 0,
            'searches_yesterday': 0,
            'recent_success_rate': 0,
            'recent_failed_searches': 0,
            'avg_response_time': 0,
            'total_api_calls': 0,
            'indexer_performance': []
        }
        
        try:
            # Check connection first
            status_url = f"{api_url.rstrip('/')}/api/v1/system/status"
            status_response = requests.get(status_url, headers=headers, timeout=10)
            
            if status_response.status_code == 200:
                stats['connected'] = True
                
                # Get API history/usage statistics using the optimized /since endpoint
                try:
                    # Calculate date range for today and yesterday
                    from datetime import datetime, timedelta
                    now = datetime.utcnow()
                    today = now.date()
                    yesterday = today - timedelta(days=1)
                    
                    # Use the /history/since endpoint for efficient date-based filtering
                    # This gets ALL records since yesterday without pagination limits
                    yesterday_start = datetime.combine(yesterday, datetime.min.time())
                    since_date = yesterday_start.strftime('%Y-%m-%dT%H:%M:%S.%fZ')
                    
                    history_since_url = f"{api_url.rstrip('/')}/api/v1/history/since"
                    params = {'date': since_date}
                    
                    prowlarr_logger.debug(f"Fetching history since {since_date} using /history/since endpoint")
                    history_response = requests.get(history_since_url, headers=headers, timeout=15, params=params)
                    
                    all_records = []
                    if history_response.status_code == 200:
                        # /history/since returns an array directly, not a paged response
                        all_records = history_response.json()
                        prowlarr_logger.debug(f"Retrieved {len(all_records)} history records from /history/since endpoint")
                    else:
                        # Fallback to regular history endpoint if /since is not available
                        prowlarr_logger.debug(f"/history/since failed with status {history_response.status_code}, falling back to regular history endpoint")
                        
                        history_url = f"{api_url.rstrip('/')}/api/v1/history"
                        params = {
                            'pageSize': 500,  # Larger page size for fallback
                            'sortKey': 'date',
                            'sortDirection': 'descending'
                        }
                        
                        fallback_response = requests.get(history_url, headers=headers, timeout=15, params=params)
                        if fallback_response.status_code == 200:
                            fallback_data = fallback_response.json()
                            all_records = fallback_data.get('records', [])
                            prowlarr_logger.debug(f"Fallback: Retrieved {len(all_records)} history records from regular endpoint")
                    
                    if all_records:
                        # Total records gives us approximate API call count
                        stats['total_api_calls'] = len(all_records)
                        
                        # Analyze recent activity (overall and per indexer)
                        
                        searches_today = 0
                        searches_yesterday = 0
                        successful_searches = 0
                        failed_searches = 0
                        
                        # Track per-indexer statistics
                        indexer_daily_stats = {}
                        
                        prowlarr_logger.debug(f"Processing {len(all_records)} history records for date analysis")
                        
                        for record in all_records:
                            try:
                                # Parse the date from the record
                                record_date = datetime.fromisoformat(record.get('date', '').replace('Z', '+00:00')).date()
                                is_successful = record.get('successful', False)
                                indexer_id = record.get('indexerId')
                                
                                # Initialize indexer stats if not exists
                                if indexer_id and indexer_id not in indexer_daily_stats:
                                    indexer_daily_stats[indexer_id] = {
                                        'searches_today': 0,
                                        'searches_yesterday': 0,
                                        'successful_today': 0,
                                        'failed_today': 0
                                    }
                                
                                if record_date == today:
                                    searches_today += 1
                                    if is_successful:
                                        successful_searches += 1
                                    else:
                                        failed_searches += 1
                                    
                                    # Per-indexer tracking
                                    if indexer_id:
                                        indexer_daily_stats[indexer_id]['searches_today'] += 1
                                        if is_successful:
                                            indexer_daily_stats[indexer_id]['successful_today'] += 1
                                        else:
                                            indexer_daily_stats[indexer_id]['failed_today'] += 1
                                            
                                elif record_date == yesterday:
                                    searches_yesterday += 1
                                    if indexer_id:
                                        indexer_daily_stats[indexer_id]['searches_yesterday'] += 1
                                        
                            except (ValueError, AttributeError):
                                continue
                        
                        stats['searches_today'] = searches_today
                        stats['searches_yesterday'] = searches_yesterday
                        stats['recent_success_rate'] = round((successful_searches / max(searches_today, 1)) * 100, 1)
                        stats['recent_failed_searches'] = failed_searches
                        stats['indexer_daily_stats'] = indexer_daily_stats
                        
                        prowlarr_logger.debug(f"Calculated stats - Today: {searches_today}, Yesterday: {searches_yesterday}, Success rate: {stats['recent_success_rate']}%")
                        
                except Exception as e:
                    prowlarr_logger.debug(f"History endpoint failed: {str(e)}")
                
                # Get indexer performance statistics with date filtering for today's data
                try:
                    # Use indexerstats endpoint with date filtering for accurate daily statistics
                    today_start = datetime.combine(today, datetime.min.time())
                    today_end = datetime.combine(today + timedelta(days=1), datetime.min.time())
                    
                    indexerstats_url = f"{api_url.rstrip('/')}/api/v1/indexerstats"
                    indexerstats_params = {
                        'startDate': today_start.strftime('%Y-%m-%dT%H:%M:%S.%fZ'),
                        'endDate': today_end.strftime('%Y-%m-%dT%H:%M:%S.%fZ')
                    }
                    
                    prowlarr_logger.debug(f"Fetching indexer stats for today: {today_start} to {today_end}")
                    indexerstats_response = requests.get(indexerstats_url, headers=headers, timeout=15, params=indexerstats_params)
                    
                    if indexerstats_response.status_code == 200:
                        indexerstats_data = indexerstats_response.json()
                        indexer_stats = indexerstats_data.get('indexers', [])
                        
                        if indexer_stats:
                            # Update individual indexer stats with indexerstats data for consistency
                            for indexer_stat in indexer_stats:
                                indexer_id = indexer_stat.get('indexerId')
                                queries_today = indexer_stat.get('numberOfQueries', 0)
                                
                                if indexer_id and queries_today > 0:
                                    # Update the indexer_daily_stats with indexerstats data for consistency
                                    if indexer_id not in stats.get('indexer_daily_stats', {}):
                                        stats.setdefault('indexer_daily_stats', {})[indexer_id] = {
                                            'searches_today': 0,
                                            'searches_yesterday': 0,
                                            'successful_today': 0,
                                            'failed_today': 0
                                        }
                                    
                                    # Use indexerstats data as the authoritative source for today's count
                                    stats['indexer_daily_stats'][indexer_id]['searches_today'] = queries_today
                            
                            # Calculate main total from updated indexer stats for consistency
                            total_searches_today = sum(
                                indexer_data.get('searches_today', 0) 
                                for indexer_data in stats.get('indexer_daily_stats', {}).values()
                            )
                            
                            if total_searches_today > 0:
                                stats['searches_today'] = total_searches_today
                                prowlarr_logger.debug(f"Using consistent indexerstats total: {total_searches_today} searches (sum of all indexers)")
                                
                                # Calculate main statistics from indexerstats data for consistency
                                total_grabs = sum(stat.get('numberOfGrabs', 0) for stat in indexer_stats)
                                total_failed = sum(stat.get('numberOfFailedQueries', 0) for stat in indexer_stats)
                                
                                # Update main success rate to match indexer calculations
                                if total_searches_today > 0:
                                    stats['recent_success_rate'] = round((total_grabs / total_searches_today) * 100, 1)
                                else:
                                    stats['recent_success_rate'] = 0
                                
                                # Update total API calls to match indexerstats
                                stats['total_api_calls'] = sum(stat.get('numberOfQueries', 0) for stat in indexer_stats)
                                stats['recent_failed_searches'] = total_failed
                                
                                prowlarr_logger.debug(f"Main stats updated - Success rate: {stats['recent_success_rate']}%, Total API calls: {stats['total_api_calls']}, Failed: {total_failed}")
                                
                                # Debug logging to track individual indexer contributions
                                for idx_id, idx_data in stats.get('indexer_daily_stats', {}).items():
                                    prowlarr_logger.debug(f"Indexer {idx_id}: {idx_data.get('searches_today', 0)} searches today")
                            
                            # Calculate average response time
                            total_response_time = 0
                            total_queries = 0
                            indexer_performance = []
                            individual_indexer_stats = {}
                            
                            for indexer_stat in indexer_stats:
                                response_time = indexer_stat.get('averageResponseTime', 0)
                                queries = indexer_stat.get('numberOfQueries', 0)
                                grabs = indexer_stat.get('numberOfGrabs', 0)
                                indexer_id = indexer_stat.get('indexerId')
                                indexer_name = indexer_stat.get('indexerName', 'Unknown')
                                
                                # Get daily stats for this indexer (now updated with consistent indexerstats data)
                                daily_stats = stats.get('indexer_daily_stats', {}).get(indexer_id, {
                                    'searches_today': 0,
                                    'searches_yesterday': 0,
                                    'successful_today': 0,
                                    'failed_today': 0
                                })
                                
                                # Use indexerstats numberOfQueries as the authoritative source for today's searches
                                indexer_searches_today = queries  # This comes from indexerstats API
                                
                                # Calculate success rate for today using indexerstats data (consistent with main calculation)
                                today_success_rate = 0
                                if indexer_searches_today > 0:
                                    today_success_rate = round((grabs / indexer_searches_today) * 100, 1)
                                
                                indexer_data = {
                                    'id': indexer_id,
                                    'name': indexer_name,
                                    'response_time': response_time,
                                    'queries': queries,
                                    'grabs': grabs,
                                    'success_rate': today_success_rate,  # Use consistent calculation method
                                    'searches_today': indexer_searches_today,  # Use consistent indexerstats data
                                    'searches_yesterday': daily_stats['searches_yesterday'],  # Keep history data for yesterday
                                    'successful_today': grabs,  # Use grabs from indexerstats as successful searches
                                    'failed_today': daily_stats['failed_today'],
                                    'today_success_rate': today_success_rate
                                }
                                
                                if queries > 0:
                                    total_response_time += response_time * queries
                                    total_queries += queries
                                    indexer_performance.append(indexer_data)
                                
                                # Store individual stats by name for easy lookup
                                individual_indexer_stats[indexer_name] = indexer_data
                            
                            # Calculate overall average response time (weighted average across all indexers)
                            avg_response_time = round(total_response_time / max(total_queries, 1), 0)
                            stats['avg_response_time'] = avg_response_time
                            
                            prowlarr_logger.debug(f"Calculated weighted average response time: {avg_response_time}ms from {len(indexer_stats)} indexers")
                            stats['indexer_performance'] = sorted(indexer_performance, key=lambda x: x['queries'], reverse=True)
                            stats['individual_indexer_stats'] = individual_indexer_stats
                        
                except Exception as e:
                    prowlarr_logger.debug(f"Indexer stats endpoint failed: {str(e)}")
                    
        except Exception as e:
            prowlarr_logger.debug(f"Error fetching detailed stats: {str(e)}")
        
        return stats
        
    except Exception as e:
        prowlarr_logger.error(f"Failed to fetch detailed stats: {str(e)}")
        return None

def _update_stats_cache():
    """Update the statistics cache in background"""
    global _stats_cache
    
    try:
        new_stats = _fetch_detailed_stats()
        
        with _cache_lock:
            if new_stats:
                _stats_cache['data'] = new_stats
                _stats_cache['timestamp'] = time.time()
                prowlarr_logger.debug("Statistics cache updated successfully")
            else:
                prowlarr_logger.debug("Failed to update statistics cache")
                
    except Exception as e:
        prowlarr_logger.error(f"Error updating stats cache: {str(e)}")

@prowlarr_bp.route('/stats', methods=['GET'])
def get_prowlarr_stats():
    """Get cached Prowlarr statistics"""
    global _stats_cache
    
    try:
        with _cache_lock:
            current_time = time.time()
            
            # Check if cache is expired or empty
            if (_stats_cache['data'] is None or 
                current_time - _stats_cache['timestamp'] > _stats_cache['cache_duration']):
                
                # Start background update if cache is expired
                if _stats_cache['data'] is None:
                    # First time - fetch synchronously but with shorter timeout
                    prowlarr_logger.debug("First time stats fetch - getting initial data")
                    initial_stats = _fetch_detailed_stats()
                    if initial_stats:
                        _stats_cache['data'] = initial_stats
                        _stats_cache['timestamp'] = current_time
                else:
                    # Cache expired - start background update
                    threading.Thread(target=_update_stats_cache, daemon=True).start()
            
            # Return cached data (or None if no cache available)
            cached_data = _stats_cache['data']
        
        if cached_data:
            return jsonify({
                'success': True,
                'stats': cached_data,
                'cached': True,
                'cache_age': int(current_time - _stats_cache['timestamp'])
            })
        else:
            return jsonify({
                'success': False,
                'error': 'Statistics not available',
                'cached': False
            }), 503
        
    except Exception as e:
        prowlarr_logger.error(f"Failed to get cached stats: {str(e)}")
        return jsonify({
            'success': False,
            'error': f'Failed to get statistics: {str(e)}'
        }), 500

@prowlarr_bp.route('/indexer-stats/<indexer_name>', methods=['GET'])
def get_indexer_stats(indexer_name):
    """Get cached statistics for a specific indexer"""
    global _stats_cache
    
    try:
        with _cache_lock:
            cached_data = _stats_cache['data']
        
        if not cached_data or 'individual_indexer_stats' not in cached_data:
            return jsonify({
                'success': False,
                'error': 'Indexer statistics not available'
            }), 503
        
        individual_stats = cached_data['individual_indexer_stats']
        
        if indexer_name not in individual_stats:
            return jsonify({
                'success': False,
                'error': f'Statistics for indexer "{indexer_name}" not found'
            }), 404
        
        indexer_data = individual_stats[indexer_name]
        
        return jsonify({
            'success': True,
            'indexer_name': indexer_name,
            'stats': {
                'searches_today': indexer_data['searches_today'],
                'recent_success_rate': indexer_data['today_success_rate'],
                'avg_response_time': indexer_data['response_time'],
                'total_api_calls': indexer_data['queries'],
                'recent_failed_searches': indexer_data['failed_today']
            },
            'cached': True
        })
        
    except Exception as e:
        prowlarr_logger.error(f"Failed to get indexer stats for {indexer_name}: {str(e)}")
        return jsonify({
            'success': False,
            'error': f'Failed to get indexer statistics: {str(e)}'
        }), 500

@prowlarr_bp.route('/test-connection', methods=['POST'])
def test_connection_endpoint():
    """Test connection to Prowlarr API instance"""
    data = request.json
    api_url = data.get('api_url')
    api_key = data.get('api_key')
    api_timeout = data.get('api_timeout', 30)

    if not api_url or not api_key:
        return jsonify({"success": False, "message": "API URL and API Key are required"}), 400
    
    result = test_connection(api_url, api_key, api_timeout)
    
    if result["success"]:
        return jsonify(result)
    else:
        # Return appropriate HTTP status code based on the error
        if "Invalid API key" in result["message"]:
            return jsonify(result), 401
        elif "Access forbidden" in result["message"]:
            return jsonify(result), 403
        elif "not found" in result["message"] or "DNS resolution failed" in result["message"]:
            return jsonify(result), 404
        elif "timed out" in result["message"]:
            return jsonify(result), 504
        else:
            return jsonify(result), 500 