#!/usr/bin/env python3

from flask import Blueprint, request, jsonify, render_template
import datetime, os, requests
# keys_manager import removed - using settings_manager instead
from src.primary.state import reset_state_file, check_state_reset
from src.primary.utils.logger import get_logger
from src.primary.settings_manager import get_ssl_verify_setting
import traceback
import socket
from urllib.parse import urlparse
from src.primary.apps.sonarr import missing, upgrade
from src.primary.auth import get_app_url_and_key
from src.primary.utils.database import get_database
from src.primary import settings_manager
import logging

logger = logging.getLogger(__name__)

sonarr_bp = Blueprint('sonarr', __name__)
sonarr_logger = get_logger("sonarr")

# State management now handled directly through database calls

@sonarr_bp.route('/sonarr')
def sonarr_page():
    """Render the Sonarr page"""
    return render_template('sonarr.html')

@sonarr_bp.route('/api/sonarr/missing', methods=['POST'])
def sonarr_missing():
    """Handle Sonarr missing episodes search"""
    try:
        # Check if state needs to be reset
        check_state_reset("sonarr")
        
        # Get app configuration from database
        app_url, api_key = get_app_url_and_key("sonarr")
        if not app_url or not api_key:
            return jsonify({"error": "Sonarr not configured"}), 400
        
        # Get settings from database
        missing_search_enabled = settings_manager.get_app_setting("sonarr", "missing_search", True)
        if not missing_search_enabled:
            return jsonify({"message": "Missing search is disabled for Sonarr"}), 200
        
        # Run missing search
        result = missing.run_missing_search(app_url, api_key, "sonarr")
        return jsonify(result)
        
    except Exception as e:
        logger.error(f"Error in Sonarr missing search: {e}")
        return jsonify({"error": str(e)}), 500

@sonarr_bp.route('/api/sonarr/upgrade', methods=['POST'])
def sonarr_upgrade():
    """Handle Sonarr upgrade search"""
    try:
        # Check if state needs to be reset
        check_state_reset("sonarr")
        
        # Get app configuration from database
        app_url, api_key = get_app_url_and_key("sonarr")
        if not app_url or not api_key:
            return jsonify({"error": "Sonarr not configured"}), 400
        
        # Get settings from database
        upgrade_search_enabled = settings_manager.get_app_setting("sonarr", "upgrade_search", True)
        if not upgrade_search_enabled:
            return jsonify({"message": "Upgrade search is disabled for Sonarr"}), 200
        
        # Run upgrade search
        result = upgrade.run_upgrade_search(app_url, api_key, "sonarr")
        return jsonify(result)
        
    except Exception as e:
        logger.error(f"Error in Sonarr upgrade search: {e}")
        return jsonify({"error": str(e)}), 500

@sonarr_bp.route('/api/sonarr/reset', methods=['POST'])
def sonarr_reset():
    """Reset Sonarr state files"""
    try:
        data = request.get_json() or {}
        reset_type = data.get('type', 'all')
        
        success = True
        if reset_type == 'missing' or reset_type == 'all':
            success &= reset_state_file("sonarr", "processed_missing")
        if reset_type == 'upgrade' or reset_type == 'all':
            success &= reset_state_file("sonarr", "processed_upgrades")
        
        if success:
            return jsonify({"message": f"Sonarr {reset_type} state reset successfully"})
        else:
            return jsonify({"error": f"Failed to reset Sonarr {reset_type} state"}), 500
            
    except Exception as e:
        logger.error(f"Error resetting Sonarr state: {e}")
        return jsonify({"error": str(e)}), 500

@sonarr_bp.route('/test-connection', methods=['POST'])
def test_connection():
    """Test connection to a Sonarr API instance with comprehensive diagnostics"""
    data = request.json
    api_url = data.get('api_url')
    api_key = data.get('api_key')
    api_timeout = data.get('api_timeout', 30)  # Use longer timeout for connection test

    if not api_url or not api_key:
        return jsonify({"success": False, "message": "API URL and API Key are required"}), 400
    
    # Auto-correct URL if missing http(s) scheme
    if not (api_url.startswith('http://') or api_url.startswith('https://')):
        sonarr_logger.debug(f"Auto-correcting URL to: {api_url}")
        api_url = f"http://{api_url}"
        sonarr_logger.debug(f"Auto-correcting URL to: {api_url}")
    
    # Try to establish a socket connection first to check basic connectivity
    parsed_url = urlparse(api_url)
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
            sonarr_logger.error(error_msg)
            return jsonify({"success": False, "message": error_msg}), 404
    except socket.gaierror:
        error_msg = f"DNS resolution failed - Cannot resolve hostname: {hostname}. Please check your URL."
        sonarr_logger.error(error_msg)
        return jsonify({"success": False, "message": error_msg}), 404
    except Exception as e:
        # Log the socket testing error but continue with the full request
        sonarr_logger.debug(f"Socket test error, continuing with full request: {str(e)}")
        
    # Create the test URL and set headers
    test_url = f"{api_url.rstrip('/')}/api/v3/system/status"
    headers = {'X-Api-Key': api_key}
    
    # Get SSL verification setting
    verify_ssl = get_ssl_verify_setting()
    
    if not verify_ssl:
        sonarr_logger.debug("SSL verification disabled by user setting for connection test")

    try:
        # Now proceed with the actual API request
        response = requests.get(test_url, headers=headers, timeout=(10, api_timeout), verify=verify_ssl)
        
        # For HTTP errors, provide more specific feedback
        if response.status_code == 401:
            error_msg = "Authentication failed: Invalid API key"
            sonarr_logger.error(error_msg)
            return jsonify({"success": False, "message": error_msg}), 401
        elif response.status_code == 403:
            error_msg = "Access forbidden: Check API key permissions"
            sonarr_logger.error(error_msg)
            return jsonify({"success": False, "message": error_msg}), 403
        elif response.status_code == 404:
            error_msg = "API endpoint not found: This doesn't appear to be a valid Sonarr server. Check your URL."
            sonarr_logger.error(error_msg)
            return jsonify({"success": False, "message": error_msg}), 404
        elif response.status_code >= 500:
            error_msg = f"Sonarr server error (HTTP {response.status_code}): The Sonarr server is experiencing issues"
            sonarr_logger.error(error_msg)
            return jsonify({"success": False, "message": error_msg}), response.status_code
        
        # Raise for other HTTP errors
        response.raise_for_status()
        
        # Log HTTP status code for diagnostic purposes
        sonarr_logger.debug(f"Sonarr API status code: {response.status_code}")

        # Ensure the response is valid JSON
        try:
            response_data = response.json()
            
            # We no longer save keys here since we use instances
            # Legacy keys_manager call removed - settings now stored in database
            
            # Return success with some useful information
            return jsonify({
                "success": True,
                "message": "Successfully connected to Sonarr API",
                "version": response_data.get('version', 'unknown')
            })
        except ValueError:
            error_msg = "Invalid JSON response from Sonarr API - This doesn't appear to be a valid Sonarr server"
            sonarr_logger.error(f"{error_msg}. Response content: {response.text[:200]}")
            return jsonify({"success": False, "message": error_msg}), 500

    except requests.exceptions.Timeout as e:
        error_msg = f"Connection timed out after {api_timeout} seconds"
        sonarr_logger.error(f"{error_msg}: {str(e)}")
        return jsonify({"success": False, "message": error_msg}), 504
        
    except requests.exceptions.ConnectionError as e:
        # Handle different types of connection errors
        error_details = str(e)
        if "Connection refused" in error_details:
            error_msg = f"Connection refused - Sonarr is not running on {api_url} or the port is incorrect"
        elif "Name or service not known" in error_details or "getaddrinfo failed" in error_details:
            error_msg = f"DNS resolution failed - Cannot find host '{urlparse(api_url).hostname}'. Check your URL."
        else:
            error_msg = f"Connection error - Check if Sonarr is running: {error_details}"
            
        sonarr_logger.error(error_msg)
        return jsonify({"success": False, "message": error_msg}), 404
        
    except requests.exceptions.RequestException as e:
        error_msg = f"Connection test failed: {str(e)}"
        sonarr_logger.error(error_msg)
        return jsonify({"success": False, "message": error_msg}), 500


