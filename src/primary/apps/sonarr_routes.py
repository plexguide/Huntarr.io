#!/usr/bin/env python3

import logging
import socket
from urllib.parse import urlparse

import requests
from flask import Blueprint, request, jsonify

from src.primary.settings_manager import get_ssl_verify_setting
from src.primary.utils.logger import get_logger

logger = logging.getLogger(__name__)

sonarr_bp = Blueprint('sonarr', __name__)
sonarr_logger = get_logger("sonarr")


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
        sonarr_logger.debug("Auto-correcting URL to: %s", api_url)
        api_url = f"http://{api_url}"
        sonarr_logger.debug("Auto-correcting URL to: %s", api_url)

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
        sonarr_logger.debug("Socket test error, continuing with full request: %s", str(e))

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
        sonarr_logger.debug("Sonarr API status code: %s", response.status_code)

        # Ensure the response is valid JSON
        try:
            response_data = response.json()

            # Return success with some useful information
            return jsonify({
                "success": True,
                "message": "Successfully connected to Sonarr API",
                "version": response_data.get('version', 'unknown')
            })
        except ValueError:
            error_msg = "Invalid JSON response from Sonarr API - This doesn't appear to be a valid Sonarr server"
            sonarr_logger.error("%s. Response content: %s", error_msg, response.text[:200])
            return jsonify({"success": False, "message": error_msg}), 500

    except requests.exceptions.Timeout as e:
        error_msg = f"Connection timed out after {api_timeout} seconds"
        sonarr_logger.error("%s: %s", error_msg, str(e))
        return jsonify({"success": False, "message": error_msg}), 504

    except requests.exceptions.ConnectionError as e:
        # Handle different types of connection errors
        error_details = str(e)
        if "Connection refused" in error_details:
            error_msg = "Connection refused - Sonarr is not running on %s or the port is incorrect"
            sonarr_logger.error(error_msg, api_url)
        elif "Name or service not known" in error_details or "getaddrinfo failed" in error_details:
            error_msg = "DNS resolution failed - Cannot find host '%s'. Check your URL."
            sonarr_logger.error(error_msg, urlparse(api_url).hostname)
        else:
            error_msg = "Connection error - Check if Sonarr is running: %s"
            sonarr_logger.error(error_msg, error_details)
        return jsonify({"success": False, "message": error_msg}), 404

    except requests.exceptions.RequestException as e:
        error_msg = "Connection test failed: %s"
        sonarr_logger.error(error_msg, str(e))
        return jsonify({"success": False, "message": error_msg % str(e)}), 500
