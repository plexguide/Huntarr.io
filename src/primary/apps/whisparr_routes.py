#!/usr/bin/env python3

import os
import socket
import traceback
from urllib.parse import urlparse

import requests
from flask import Blueprint, request, jsonify

from src.primary.apps.whisparr import api as whisparr_api
from src.primary.utils.logger import get_logger, APP_LOG_FILES
from src.primary.settings_manager import get_ssl_verify_setting, load_settings

whisparr_bp = Blueprint('whisparr', __name__)
whisparr_logger = get_logger("whisparr")


@whisparr_bp.route('/status', methods=['GET'])
def get_status():
    """Get the status of configured Whisparr instance"""
    try:
        # Get configured instance
        settings = load_settings("whisparr")

        api_url = settings.get("url", "")
        api_key = settings.get("api_key", "")
        enabled = settings.get("enabled", True)

        connected_count = 0
        total_configured = 1 if api_url and api_key else 0

        if api_url and api_key and enabled:
            # Use a short timeout for status checks
            if whisparr_api.check_connection(api_url, api_key, 5):
                connected_count = 1

        return jsonify({
            "configured": total_configured > 0,
            "connected": connected_count > 0,
            "connected_count": connected_count,
            "total_configured": total_configured
        })
    except Exception as e:
        whisparr_logger.error("Error getting Whisparr status: %s", str(e))
        return jsonify({
            "configured": False,
            "connected": False,
            "error": str(e)
        }), 500


@whisparr_bp.route('/test-connection', methods=['POST'])
def test_connection():
    """Test connection to a Whisparr API instance"""
    data = request.json
    api_url = data.get('api_url')
    api_key = data.get('api_key')
    api_timeout = data.get('api_timeout', 30)  # Use longer timeout for connection test

    if not api_url or not api_key:
        return jsonify({"success": False, "message": "API URL and API Key are required"}), 400


    # Auto-correct URL if missing http(s) scheme
    if not (api_url.startswith('http://') or api_url.startswith('https://')):
        whisparr_logger.warning("API URL missing http(s) scheme: %s", api_url)
        api_url = f"http://{api_url}"
        whisparr_logger.debug("Auto-correcting URL to: %s", api_url)

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
            whisparr_logger.error(error_msg)
            return jsonify({"success": False, "message": error_msg}), 404
    except socket.gaierror:
        error_msg = f"DNS resolution failed - Cannot resolve hostname: {hostname}. Please check your URL."
        whisparr_logger.error(error_msg)
        return jsonify({"success": False, "message": error_msg}), 404
    except Exception as e:
        # Log the socket testing error but continue with the full request
        whisparr_logger.debug("Socket test error, continuing with full request: %s", str(e))

    # First try standard API endpoint (Whisparr v2)
    api_paths = [
        {"url": f"{api_url.rstrip('/')}/api/system/status", "version": "v2"},
        {"url": f"{api_url.rstrip('/')}/api/v3/system/status", "version": "v3"}
    ]

    headers = {
        "X-Api-Key": api_key,
        "Content-Type": "application/json"
    }

    # Get SSL verification setting
    verify_ssl = get_ssl_verify_setting()

    if not verify_ssl:
        whisparr_logger.debug("SSL verification disabled by user setting for connection test")

    response = None

    # Try each API path in order
    for api_path in api_paths:
        try:
            url = api_path["url"]
            whisparr_logger.debug("Trying API path: %s", url)
            response = requests.get(url, headers=headers, timeout=(10, api_timeout), verify=verify_ssl)

            if response.status_code == 200:
                break

        except requests.exceptions.RequestException:
            continue

    # If no successful response was obtained
    if not response or response.status_code != 200:
        if response:
            # For HTTP errors, provide more specific feedback
            if response.status_code == 401:
                error_msg = "Authentication failed: Invalid API key"
                whisparr_logger.error(error_msg)
                return jsonify({"success": False, "message": error_msg}), 401
            elif response.status_code == 403:
                error_msg = "Access forbidden: Check API key permissions"
                whisparr_logger.error(error_msg)
                return jsonify({"success": False, "message": error_msg}), 403
            elif response.status_code == 404:
                error_msg = "API endpoint not found: This doesn't appear to be a valid Whisparr server. Check your URL."
                whisparr_logger.error(error_msg)
                return jsonify({"success": False, "message": error_msg}), 404
            elif response.status_code >= 500:
                error_msg = f"Whisparr server error (HTTP {response.status_code}): The Whisparr server is experiencing issues"
                whisparr_logger.error(error_msg)
                return jsonify({"success": False, "message": error_msg}), response.status_code
            else:
                error_msg = f"HTTP error {response.status_code} connecting to Whisparr"
                whisparr_logger.error(error_msg)
                return jsonify({"success": False, "message": error_msg}), response.status_code
        else:
            error_msg = "Could not connect to any Whisparr API endpoint"
            whisparr_logger.error(error_msg)
            return jsonify({"success": False, "message": error_msg}), 404

    # Successfully connected, now validate version
    try:
        response_data = response.json()
        version = response_data.get('version', 'unknown')

        # Check if this is a v2 version
        if version and version.startswith('2'):
            # Detected v2
            return jsonify({
                "success": True,
                "message": "Successfully connected to Whisparr API",
                "version": version,
                "is_v2": True
            })
        elif version and version.startswith('3'):
            # Detected Eros API (V3)
            error_msg = f"Incompatible Whisparr version {version} detected. Huntarr requires Whisparr V2."
            whisparr_logger.error(error_msg)
            return jsonify({"success": False, "message": error_msg}), 400
        else:
            error_msg = f"Unexpected Whisparr version {version} detected. Huntarr requires Whisparr V2."
            whisparr_logger.error(error_msg)
            return jsonify({"success": False, "message": error_msg}), 400
    except ValueError:
        error_msg = "Invalid JSON response from Whisparr API - This doesn't appear to be a valid Whisparr server"
        whisparr_logger.error("%s. Response content: %s", error_msg, response.text[:200])
        return jsonify({"success": False, "message": error_msg}), 500
    except requests.exceptions.ConnectionError as e:
        # Handle different types of connection errors
        error_details = str(e)
        if "Connection refused" in error_details:
            error_msg = f"Connection refused - Whisparr is not running on {api_url} or the port is incorrect"
        elif "Name or service not known" in error_details or "getaddrinfo failed" in error_details:
            error_msg = f"DNS resolution failed - Cannot find host '{urlparse(api_url).hostname}'. Check your URL."
        else:
            error_msg = f"Connection error - Check if Whisparr is running: {error_details}"

        whisparr_logger.error(error_msg)
        return jsonify({"success": False, "message": error_msg}), 404
    except requests.exceptions.Timeout:
        error_msg = "Connection timed out - Whisparr took too long to respond"
        whisparr_logger.error(error_msg)
        return jsonify({"success": False, "message": error_msg}), 504
    except requests.exceptions.RequestException as e:
        error_msg = f"Connection test failed: {str(e)}"
        whisparr_logger.error(error_msg)
        return jsonify({"success": False, "message": error_msg}), 500


@whisparr_bp.route('/versions', methods=['GET'])
def get_versions():
    """Get the version information from the Whisparr API"""
    try:
        # Get configured instance
        settings = load_settings("whisparr")

        api_url = settings.get("url", "")
        api_key = settings.get("api_key", "")
        enabled = settings.get("enabled", True)
        instance_name = settings.get("name", "Default")

        if not api_url or not api_key:
            return jsonify({"success": False, "message": "No Whisparr instance configured"}), 404

        if not enabled:
            return jsonify({"success": False, "message": "Whisparr instance is disabled"}), 404

        # First try standard API endpoint
        version_url = f"{api_url.rstrip('/')}/api/system/status"
        headers = {"X-Api-Key": api_key}

        try:
            response = requests.get(version_url, headers=headers, timeout=10)

            # If we get a 404, try with the v3 path
            if response.status_code == 404:
                whisparr_logger.debug("Standard API path failed for %s, trying v3 path", instance_name)
                v3_url = f"{api_url.rstrip('/')}/api/v3/system/status"
                response = requests.get(v3_url, headers=headers, timeout=10)

            if response.status_code == 200:
                version_data = response.json()
                version = version_data.get("version", "Unknown")

                # Validate that it's a V2 version
                if version and version.startswith('2'):
                    result = {
                        "name": instance_name,
                        "success": True,
                        "version": version,
                        "is_v2": True
                    }
                elif version and version.startswith('3'):
                    # Reject Eros API version
                    result = {
                        "name": instance_name,
                        "success": False,
                        "message": f"Incompatible Whisparr version {version} detected. Huntarr requires Whisparr V2.",
                        "version": version
                    }
                else:
                    # Unexpected version
                    result = {
                        "name": instance_name,
                        "success": False,
                        "message": f"Unexpected Whisparr version {version} detected. Huntarr requires Whisparr V2.",
                        "version": version
                    }
            else:
                # API call failed
                result = {
                    "name": instance_name,
                    "success": False,
                    "message": f"Failed to get version information: HTTP {response.status_code}"
                }
        except requests.exceptions.RequestException as e:
            result = {
                "name": instance_name,
                "success": False,
                "message": f"Connection error: {str(e)}"
            }

        return jsonify({"success": True, "results": [result]})
    except Exception as e:
        whisparr_logger.error("Error getting Whisparr versions: %s", str(e))
        return jsonify({"success": False, "message": str(e)}), 500


@whisparr_bp.route('/logs', methods=['GET'])
def get_logs():
    """Get the log file for Whisparr"""
    try:
        # Get the log file path
        log_file = APP_LOG_FILES.get("whisparr")

        if not log_file or not os.path.exists(log_file):
            return jsonify({"success": False, "message": "Log file not found"}), 404

        # Read the log file (last 200 lines)
        with open(log_file, 'r') as f:
            lines = f.readlines()
            log_content = ''.join(lines[-200:])

        return jsonify({"success": True, "logs": log_content})
    except Exception as e:
        error_message = f"Error fetching Whisparr logs: {str(e)}"
        whisparr_logger.error(error_message)
        traceback.print_exc()
        return jsonify({"success": False, "message": error_message}), 500
