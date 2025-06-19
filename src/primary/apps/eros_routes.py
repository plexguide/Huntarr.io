#!/usr/bin/env python3

from flask import Blueprint, request, jsonify
import datetime, os, requests

from src.primary.state import reset_state_file
from src.primary.utils.logger import get_logger, APP_LOG_FILES
from src.primary.settings_manager import load_settings, get_ssl_verify_setting
import traceback
import socket
from urllib.parse import urlparse
from src.primary.apps.eros import api as eros_api
from src.primary.apps.eros import get_configured_instances
# Import centralized path configuration
from src.primary.utils.config_paths import CONFIG_PATH

eros_bp = Blueprint('eros', __name__)
eros_logger = get_logger("eros")

# State management now handled directly through database calls

def test_connection(url, api_key):
    # Validate URL format
    if not (url.startswith('http://') or url.startswith('https://')):
        eros_logger.warning(f"API URL missing http(s) scheme: {url}")
        url = f"http://{url}"
        eros_logger.debug(f"Auto-correcting URL to: {url}")
    
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
            eros_logger.error(error_msg)
            return {"success": False, "message": error_msg}
    except socket.gaierror:
        error_msg = f"DNS resolution failed - Cannot resolve hostname: {hostname}. Please check your URL."
        eros_logger.error(error_msg)
        return {"success": False, "message": error_msg}
    except Exception as e:
        # Log the socket testing error but continue with the full request
        eros_logger.debug(f"Socket test error, continuing with full request: {str(e)}")
    
    # For Eros, we only use v3 API path
    api_url = f"{url.rstrip('/')}/api/v3/system/status"
    headers = {'X-Api-Key': api_key}
    
    # Get SSL verification setting
    verify_ssl = get_ssl_verify_setting()
    
    if not verify_ssl:
        eros_logger.debug("SSL verification disabled by user setting for connection test")
    
    try:
        # Make the request with appropriate timeouts
        eros_logger.debug(f"Trying API path: {api_url}")
        response = requests.get(api_url, headers=headers, timeout=(5, 30), verify=verify_ssl)
        
        try:
            response.raise_for_status()
            
            # Check if we got a valid JSON response
            try:
                response_data = response.json()
                
                # Verify this is actually an Eros server by checking for version
                version = response_data.get('version')
                if not version:
                    error_msg = "API response doesn't contain version information. This doesn't appear to be a valid Eros server."
                    eros_logger.error(error_msg)
                    return {"success": False, "message": error_msg}
                
                # Version check - should be v3.x for Eros
                if version.startswith('3'):
                    detected_version = "v3"
            
                    
                    # Success!
                    return {"success": True, "message": "Successfully connected to Eros API", "version": version, "api_version": detected_version}
                elif version.startswith('2'):
                    error_msg = f"Incompatible version detected: {version}. This appears to be Whisparr V2, not Eros."
                    eros_logger.error(error_msg)
                    return {"success": False, "message": error_msg}
                else:
                    error_msg = f"Unexpected version {version} detected. Eros requires API v3."
                    eros_logger.error(error_msg)
                    return {"success": False, "message": error_msg}
            except ValueError:
                error_msg = "Invalid JSON response from Eros API - This doesn't appear to be a valid Eros server"
                eros_logger.error(f"{error_msg}. Response content: {response.text[:200]}")
                return {"success": False, "message": error_msg}
                
        except requests.exceptions.HTTPError:
            # Handle specific HTTP errors
            if response.status_code == 401:
                error_msg = "Invalid API key - Authentication failed"
                eros_logger.error(error_msg)
                return {"success": False, "message": error_msg}
            elif response.status_code == 404:
                error_msg = "API endpoint not found: This doesn't appear to be a valid Eros server. Check your URL."
                eros_logger.error(error_msg)
                return {"success": False, "message": error_msg}
            else:
                error_msg = f"Eros server error (HTTP {response.status_code}): The Eros server is experiencing issues"
                eros_logger.error(error_msg)
                return {"success": False, "message": error_msg}
                
    except requests.exceptions.ConnectionError as e:
        # Connection error - server might be down or unreachable
        error_details = str(e)
        
        if "Connection refused" in error_details:
            error_msg = f"Connection refused - Eros is not running on {url} or the port is incorrect"
        else:
            error_msg = f"Connection error - Check if Eros is running: {error_details}"
            
        eros_logger.error(error_msg)
        return {"success": False, "message": error_msg}
        
    except requests.exceptions.Timeout:
        error_msg = f"Connection timed out - Eros took too long to respond"
        eros_logger.error(error_msg)
        return {"success": False, "message": error_msg}
        
    except Exception as e:
        error_msg = f"Unexpected error: {str(e)}"
        eros_logger.error(f"{error_msg}\n{traceback.format_exc()}")
        return {"success": False, "message": error_msg}

@eros_bp.route('/status', methods=['GET'])
def get_status():
    """Get the status of all configured Eros instances"""
    try:
        instances = get_configured_instances()
        eros_logger.debug(f"Eros configured instances: {instances}")
        if instances:
            connected_count = 0
            for instance in instances:
                if test_connection(instance['url'], instance['api_key'])['success']:
                    connected_count += 1
            return jsonify({
                "configured": True,
                "connected": connected_count > 0,
                "connected_count": connected_count,
                "total_configured": len(instances)
            })
        else:
            eros_logger.debug("No Eros instances configured")
            return jsonify({"configured": False, "connected": False})
    except Exception as e:
        eros_logger.error(f"Error getting Eros status: {str(e)}")
        return jsonify({"configured": False, "connected": False, "error": str(e)})

@eros_bp.route('/test-connection', methods=['POST'])
def test_connection_endpoint():
    """Test connection to an Eros API instance"""
    data = request.json
    api_url = data.get('api_url')
    api_key = data.get('api_key')
    api_timeout = data.get('api_timeout', 30)  # Use longer timeout for connection test
    
    if not api_url or not api_key:
        return jsonify({"success": False, "message": "API URL and API Key are required"}), 400
        

    
    # Auto-correct URL if missing http(s) scheme
    if not (api_url.startswith('http://') or api_url.startswith('https://')):
        eros_logger.warning(f"API URL missing http(s) scheme: {api_url}")
        api_url = f"http://{api_url}"
        eros_logger.debug(f"Auto-correcting URL to: {api_url}")
    
    return test_connection(api_url, api_key)

@eros_bp.route('/test-settings', methods=['GET'])
def test_eros_settings():
    """Debug endpoint to test Eros settings loading from database"""
    try:
        results = {}
        
        # Load settings from database via settings_manager
        try:
            from src.primary.settings_manager import load_settings
            settings = load_settings("eros")
            results["database_settings"] = settings
            results["configured"] = bool(settings.get("url") and settings.get("api_key"))
        except Exception as e:
            results["database_error"] = str(e)
            
        results["note"] = "Settings are now stored in database. Legacy JSON files are no longer used."
            
        return jsonify(results)
    except Exception as e:
        return jsonify({"error": str(e)})

@eros_bp.route('/reset-processed', methods=['POST'])
def reset_processed_state():
    """Reset the processed state files for Eros"""
    try:
        # Reset the state files for missing and upgrades
        reset_state_file("eros", "processed_missing")
        reset_state_file("eros", "processed_upgrades")
        
        eros_logger.info("Successfully reset Eros processed state files")
        return jsonify({"success": True, "message": "Successfully reset processed state"})
    except Exception as e:
        error_msg = f"Error resetting Eros state: {str(e)}"
        eros_logger.error(error_msg)
        return jsonify({"success": False, "message": error_msg}), 500


