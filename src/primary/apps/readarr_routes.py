#!/usr/bin/env python3

from flask import Blueprint, request, jsonify
import datetime, os, requests
# keys_manager import removed - using settings_manager instead
from src.primary.state import reset_state_file
from src.primary.utils.logger import get_logger
from src.primary.settings_manager import get_ssl_verify_setting
import traceback
import socket
from urllib.parse import urlparse

readarr_bp = Blueprint('readarr', __name__)
readarr_logger = get_logger("readarr")

# State management now handled directly through database calls

@readarr_bp.route('/test-connection', methods=['POST'])
def test_connection():
    """Test connection to a Readarr API instance"""
    data = request.json
    api_url = data.get('api_url')
    api_key = data.get('api_key')
    
    if not api_url or not api_key:
        return jsonify({"success": False, "message": "API URL and API Key are required"}), 400
        

    
    # Auto-correct URL if missing http(s) scheme
    if not (api_url.startswith('http://') or api_url.startswith('https://')):
        readarr_logger.warning(f"API URL missing http(s) scheme: {api_url}")
        api_url = f"http://{api_url}"
        readarr_logger.debug(f"Auto-correcting URL to: {api_url}")
    
    # For Readarr, use api/v1
    url = f"{api_url}/api/v1/system/status"
    headers = {
        "X-Api-Key": api_key,
        "Content-Type": "application/json"
    }
    
    # Get SSL verification setting
    verify_ssl = get_ssl_verify_setting()
    
    if not verify_ssl:
        readarr_logger.debug("SSL verification disabled by user setting for connection test")
    
    try:
        # First check if the host is reachable at all
        parsed_url = urlparse(api_url)
        hostname = parsed_url.hostname
        port = parsed_url.port or (443 if parsed_url.scheme == 'https' else 80)
        
        # Try to establish a socket connection first to provide a better error message for connection issues
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(3)  # Short timeout for quick feedback
            result = sock.connect_ex((hostname, port))
            sock.close()
            
            if result != 0:
                error_msg = f"Connection refused - Unable to connect to {hostname}:{port}. Please check if the server is running and the port is correct."
                readarr_logger.error(error_msg)
                return jsonify({"success": False, "message": error_msg}), 404
        except socket.gaierror:
            error_msg = f"DNS resolution failed - Cannot resolve hostname: {hostname}. Please check your URL."
            readarr_logger.error(error_msg)
            return jsonify({"success": False, "message": error_msg}), 404
        except Exception as e:
            # Log the socket testing error but continue with the full request
            readarr_logger.debug(f"Socket test error, continuing with full request: {str(e)}")
            
        # Now proceed with the actual API request
        response = requests.get(url, headers=headers, timeout=10, verify=verify_ssl)
        
        # For HTTP errors, provide more specific feedback
        if response.status_code == 401:
            error_msg = "Authentication failed: Invalid API key"
            readarr_logger.error(error_msg)
            return jsonify({"success": False, "message": error_msg}), 401
        elif response.status_code == 403:
            error_msg = "Access forbidden: Check API key permissions"
            readarr_logger.error(error_msg)
            return jsonify({"success": False, "message": error_msg}), 403
        elif response.status_code == 404:
            error_msg = "API endpoint not found: This doesn't appear to be a valid Readarr server. Check your URL."
            readarr_logger.error(error_msg)
            return jsonify({"success": False, "message": error_msg}), 404
        elif response.status_code >= 500:
            error_msg = f"Readarr server error (HTTP {response.status_code}): The Readarr server is experiencing issues"
            readarr_logger.error(error_msg)
            return jsonify({"success": False, "message": error_msg}), response.status_code
            
        # Raise for other HTTP errors
        response.raise_for_status()
        
        try:
            response_data = response.json()
            version = response_data.get('version', 'unknown')

            
            return jsonify({
                "success": True,
                "message": "Successfully connected to Readarr API",
                "version": version
            })
        except ValueError:
            error_msg = "Invalid JSON response from Readarr API - This doesn't appear to be a valid Readarr server"
            readarr_logger.error(f"{error_msg}. Response content: {response.text[:200]}")
            return jsonify({"success": False, "message": error_msg}), 500
            
    except requests.exceptions.ConnectionError as e:
        # Handle different types of connection errors
        error_details = str(e)
        if "Connection refused" in error_details:
            error_msg = f"Connection refused - Readarr is not running on {api_url} or the port is incorrect"
        elif "Name or service not known" in error_details or "getaddrinfo failed" in error_details:
            error_msg = f"DNS resolution failed - Cannot find host '{urlparse(api_url).hostname}'. Check your URL."
        else:
            error_msg = f"Connection error - Check if Readarr is running: {error_details}"
            
        readarr_logger.error(error_msg)
        return jsonify({"success": False, "message": error_msg}), 404
    except requests.exceptions.Timeout:
        error_msg = f"Connection timed out - Readarr took too long to respond"
        readarr_logger.error(error_msg)
        return jsonify({"success": False, "message": error_msg}), 504
    except requests.exceptions.RequestException as e:
        error_msg = f"Connection test failed: {str(e)}"
        readarr_logger.error(error_msg)
        return jsonify({"success": False, "message": error_msg}), 500


