#!/usr/bin/env python3

from flask import Blueprint, request, jsonify
import requests
import socket
from urllib.parse import urlparse

from src.primary.utils.logger import get_logger
from src.primary.settings_manager import get_ssl_verify_setting, load_settings
import traceback

prowlarr_bp = Blueprint('prowlarr', __name__)
prowlarr_logger = get_logger("prowlarr")

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

@prowlarr_bp.route('/stats', methods=['GET'])
def get_prowlarr_stats():
    """Get Prowlarr statistics for homepage monitoring"""
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
        
        # Initialize stats
        stats = {
            'connected': False,
            'active_indexers': 0,
            'total_indexers': 0,
            'throttled_indexers': 0,
            'failed_indexers': 0,
            'total_api_calls': 0,
            'version': 'Unknown',
            'health_status': 'Disconnected'
        }
        
        try:
            # Get system status
            status_url = f"{api_url.rstrip('/')}/api/v1/system/status"
            status_response = requests.get(status_url, headers=headers, timeout=10)
            
            if status_response.status_code == 200:
                status_data = status_response.json()
                stats['connected'] = True
                stats['version'] = status_data.get('version', 'Unknown')
                stats['health_status'] = 'Connected'
                
                # Get indexers information
                try:
                    indexers_url = f"{api_url.rstrip('/')}/api/v1/indexer"
                    indexers_response = requests.get(indexers_url, headers=headers, timeout=10)
                    
                    if indexers_response.status_code == 200:
                        indexers = indexers_response.json()
                        stats['total_indexers'] = len(indexers)
                        
                        # Process indexers and collect detailed information
                        active_indexers = []
                        throttled_indexers = []
                        failed_indexers = []
                        
                        for indexer in indexers:
                            indexer_info = {
                                'name': indexer.get('name', 'Unknown'),
                                'protocol': indexer.get('protocol', 'unknown'),
                                'id': indexer.get('id')
                            }
                            
                            if indexer.get('enable', False):
                                active_indexers.append(indexer_info)
                                
                            # Check for throttling/rate limiting
                            capabilities = indexer.get('capabilities', {})
                            if capabilities.get('limitsexceeded', False):
                                throttled_indexers.append(indexer_info)
                                
                            # Check for failures - look for disabled indexers or low priority
                            if not indexer.get('enable', False):
                                failed_indexers.append(indexer_info)
                        
                        stats['active_indexers'] = len(active_indexers)
                        stats['throttled_indexers'] = len(throttled_indexers)
                        stats['failed_indexers'] = len(failed_indexers)
                        stats['indexer_details'] = {
                            'active': active_indexers,
                            'throttled': throttled_indexers,
                            'failed': failed_indexers
                        }
                        
                        # Update health status based on indexer health
                        if len(throttled_indexers) > 0:
                            stats['health_status'] = f'{len(throttled_indexers)} indexer(s) throttled'
                        elif len(failed_indexers) > 0:
                            stats['health_status'] = f'{len(failed_indexers)} indexer(s) disabled'
                        else:
                            stats['health_status'] = 'All indexers healthy'
                            
                except Exception:
                    # Indexer endpoint failed but system is connected
                    stats['health_status'] = 'Indexer data unavailable'
                
                # Get API history/usage statistics
                try:
                    history_url = f"{api_url.rstrip('/')}/api/v1/history"
                    history_response = requests.get(history_url, headers=headers, timeout=10, params={'pageSize': 1})
                    
                    if history_response.status_code == 200:
                        history_data = history_response.json()
                        # Total records gives us approximate API call count
                        stats['total_api_calls'] = history_data.get('totalRecords', 0)
                        
                except Exception:
                    # History endpoint failed, keep default value
                    pass
                    
            else:
                stats['health_status'] = f'Connection failed (HTTP {status_response.status_code})'
                
        except requests.exceptions.Timeout:
            stats['health_status'] = 'Connection timeout'
        except requests.exceptions.ConnectionError:
            stats['health_status'] = 'Connection refused'
        except Exception as e:
            stats['health_status'] = f'Error: {str(e)[:50]}'
        
        return jsonify({
            'success': True,
            'stats': stats
        })
        
    except Exception as e:
        prowlarr_logger.error(f"Failed to get Prowlarr stats: {str(e)}")
        return jsonify({
            'success': False,
            'error': f'Failed to get Prowlarr stats: {str(e)}'
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