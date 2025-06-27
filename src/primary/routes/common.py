#!/usr/bin/env python3
"""
Common routes blueprint for Huntarr web interface
"""

import os
import json
import base64
import io
import qrcode
import pyotp
import logging
# Add render_template, send_from_directory, session
from flask import Blueprint, request, jsonify, make_response, redirect, url_for, current_app, render_template, send_from_directory, session, send_file
from ..auth import (
    verify_user, create_session, get_username_from_session, SESSION_COOKIE_NAME,
    change_username as auth_change_username, change_password as auth_change_password,
    update_session_username,
    validate_password_strength, logout, verify_session, disable_2fa_with_password_and_otp,
    user_exists, create_user, generate_2fa_secret, verify_2fa_code, is_2fa_enabled, # Add missing auth imports
    hash_password # Add hash_password import for recovery key reset
)
from ..utils.logger import logger # Ensure logger is imported
from .. import settings_manager # Import settings_manager
from datetime import datetime


common_bp = Blueprint('common', __name__)

# --- Static File Serving --- #

@common_bp.route('/static/<path:filename>')
def static_files(filename):
    return send_from_directory(common_bp.static_folder, filename)

@common_bp.route('/favicon.ico')
def favicon():
    return send_from_directory(common_bp.static_folder, 'favicon.ico', mimetype='image/vnd.microsoft.icon')

@common_bp.route('/logo/<path:filename>')
def logo_files(filename):
    logo_dir = os.path.join(common_bp.static_folder, 'logo')
    return send_from_directory(logo_dir, filename)

# --- API Routes --- #

@common_bp.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint for Docker and orchestration systems"""
    try:
        # Check if shutdown is in progress using multiple methods
        from src.primary.background import stop_event
        
        # Also check the global shutdown flag from main.py
        try:
            import main
            is_shutting_down = main.is_shutting_down()
        except:
            is_shutting_down = stop_event.is_set()
        
        if is_shutting_down:
            return jsonify({
                "status": "shutting_down",
                "message": "Application is shutting down",
                "ready": False
            }), 503  # Service Unavailable
        
        # Basic database connectivity check
        from src.primary.utils.database import get_database
        db = get_database()
        
        # Quick database health check
        with db.get_connection() as conn:
            conn.execute("SELECT 1")
        
        return jsonify({
            "status": "healthy",
            "message": "Application is running normally",
            "ready": True,
            "timestamp": datetime.utcnow().isoformat()
        }), 200
        
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return jsonify({
            "status": "unhealthy",
            "message": f"Health check failed: {str(e)}",
            "ready": False
        }), 503  # Service Unavailable

@common_bp.route('/ready', methods=['GET'])
def readiness_check():
    """Readiness check endpoint for Kubernetes-style orchestration"""
    try:
        # Check if the application is ready to serve traffic
        from src.primary.background import stop_event
        
        # Also check the global shutdown flag from main.py
        try:
            import main
            is_shutting_down = main.is_shutting_down()
        except:
            is_shutting_down = stop_event.is_set()
        
        if is_shutting_down:
            return jsonify({
                "ready": False,
                "message": "Application is shutting down"
            }), 503
        
        # Check if setup is complete
        from src.primary.utils.database import get_database
        db = get_database()
        
        if db.is_setup_in_progress():
            return jsonify({
                "ready": False,
                "message": "Application setup in progress"
            }), 503
        
        # Check if user exists (setup complete)
        from ..auth import user_exists
        if not user_exists():
            return jsonify({
                "ready": False,
                "message": "Application requires initial setup"
            }), 503
        
        return jsonify({
            "ready": True,
            "message": "Application is ready to serve traffic"
        }), 200
        
    except Exception as e:
        logger.error(f"Readiness check failed: {e}")
        return jsonify({
            "ready": False,
            "message": f"Readiness check failed: {str(e)}"
        }), 503

@common_bp.route('/api/sleep.json', methods=['GET'])
def api_get_sleep_json():
    """API endpoint to serve sleep/cycle data from the database for frontend access"""
    try:
        from src.primary.utils.database import get_database
        
        db = get_database()
        sleep_data = db.get_sleep_data()
        
        # Convert database format to frontend format
        frontend_data = {}
        for app_type, data in sleep_data.items():
            frontend_data[app_type] = {
                "next_cycle": data.get("next_cycle_time"),
                "updated_at": data.get("last_cycle_end") or data.get("last_cycle_start"),
                "cyclelock": data.get("cycle_lock", True)
            }
        
        # Add CORS headers to allow any origin to access this resource
        response = jsonify(frontend_data)
        response.headers.add('Access-Control-Allow-Origin', '*')
        return response
        
    except Exception as e:
        logger.error(f"Error serving sleep data from database: {e}")
        # Return empty object instead of error to prevent UI breaking
        response = jsonify({})
        response.headers.add('Access-Control-Allow-Origin', '*')
        return response, 200

# --- Authentication Routes --- #

@common_bp.route('/login', methods=['GET', 'POST'])
def login_route():
    if request.method == 'POST':
        try: # Wrap the POST logic in a try block for better error handling
            data = request.json
            username = data.get('username')
            password = data.get('password')
            twoFactorCode = data.get('twoFactorCode') # Changed from 'otp_code' to match frontend form

            if not username or not password:
                 logger.warning("Login attempt with missing username or password.")
                 return jsonify({"success": False, "error": "Username and password are required"}), 400

            # Call verify_user which now returns (auth_success, needs_2fa)
            auth_success, needs_2fa = verify_user(username, password, twoFactorCode)
            
            logger.debug(f"Auth result for '{username}': success={auth_success}, needs_2fa={needs_2fa}")

            if auth_success:
                # User is authenticated (password correct, and 2FA if needed was correct)
                session_token = create_session(username)
                session[SESSION_COOKIE_NAME] = session_token # Store token in Flask session immediately
                response = jsonify({"success": True, "redirect": "./"}) # Add redirect URL
                response.set_cookie(SESSION_COOKIE_NAME, session_token, httponly=True, samesite='Lax', path='/') # Add path
                logger.debug(f"User '{username}' logged in successfully.")
                return response
            elif needs_2fa:
                # Authentication failed *because* 2FA was required (or code was invalid)
                # The specific reason (missing vs invalid code) is logged in verify_user
                logger.warning(f"Login failed for '{username}': 2FA required or invalid.")
                logger.debug(f"Returning 2FA required response: {{\"success\": False, \"requires_2fa\": True, \"requiresTwoFactor\": True, \"error\": \"Invalid or missing 2FA code\"}}")
                
                # Use all common variations of the 2FA flag to ensure compatibility
                return jsonify({
                    "success": False, 
                    "requires_2fa": True, 
                    "requiresTwoFactor": True,
                    "requires2fa": True,
                    "requireTwoFactor": True,
                    "error": "Two-factor authentication code required"
                }), 401
            else:
                # Authentication failed for other reasons (e.g., wrong password, user not found)
                # Specific reason logged in verify_user
                logger.warning(f"Login failed for '{username}': Invalid credentials or other error.")
                return jsonify({"success": False, "error": "Invalid username or password"}), 401 # Use 401

        except Exception as e:
            logger.error(f"Unexpected error during login POST for user '{username if 'username' in locals() else 'unknown'}': {e}", exc_info=True)
            return jsonify({"success": False, "error": "An internal server error occurred during login."}), 500
    else:
        # GET request - show login page
        # If user doesn't exist or setup is in progress, redirect to setup
        if not user_exists():
             logger.info("No user exists, redirecting to setup.")
             
             # Get the base URL from settings to ensure proper subpath redirect
             try:
                 from src.primary.settings_manager import get_setting
                 base_url = get_setting('general', 'base_url', '')
                 if base_url and not base_url.startswith('/'):
                     base_url = f'/{base_url}'
                 if base_url and base_url.endswith('/'):
                     base_url = base_url.rstrip('/')
                 setup_url = f"{base_url}/setup" if base_url else "/setup"
                 logger.debug(f"Redirecting to setup with base URL: {setup_url}")
                 return redirect(setup_url)
             except Exception as e:
                 logger.warning(f"Error getting base URL for setup redirect: {e}")
                 return redirect(url_for('common.setup'))
        
        # Check if setup is in progress even if user exists
        try:
            from src.primary.utils.database import get_database
            db = get_database()
            if db.is_setup_in_progress():
                logger.info("Setup is in progress, redirecting to setup.")
                
                # Get the base URL from settings to ensure proper subpath redirect
                try:
                    from src.primary.settings_manager import get_setting
                    base_url = get_setting('general', 'base_url', '')
                    if base_url and not base_url.startswith('/'):
                        base_url = f'/{base_url}'
                    if base_url and base_url.endswith('/'):
                        base_url = base_url.rstrip('/')
                    setup_url = f"{base_url}/setup" if base_url else "/setup"
                    logger.debug(f"Redirecting to setup (in progress) with base URL: {setup_url}")
                    return redirect(setup_url)
                except Exception as e:
                    logger.warning(f"Error getting base URL for setup redirect: {e}")
                    return redirect(url_for('common.setup'))
        except Exception as e:
            logger.error(f"Error checking setup progress in login route: {e}")
            # Continue to show login page if we can't check setup progress
        
        # Check if any users have Plex authentication configured
        try:
            from src.primary.utils.database import get_database
            db = get_database()
            plex_auth_enabled = db.has_users_with_plex()
        except Exception as e:
            logger.error(f"Error checking for Plex users: {e}")
            plex_auth_enabled = False
        
        logger.debug("Displaying login page.")
        return render_template('login.html', plex_auth_enabled=plex_auth_enabled)

@common_bp.route('/logout', methods=['POST'])
def logout_route():
    try:
        session_token = request.cookies.get(SESSION_COOKIE_NAME)
        if session_token:
            logger.info(f"Logging out session token: {session_token[:8]}...") # Log part of token
            logout(session_token) # Call the logout function from auth.py
        else:
            logger.warning("Logout attempt without session cookie.")

        response = jsonify({"success": True})
        # Ensure cookie deletion happens even if logout function had issues
        response.delete_cookie(SESSION_COOKIE_NAME, path='/', samesite='Lax') # Specify path and samesite
        logger.info("Logout successful, cookie deleted.")
        return response
    except Exception as e:
        logger.error(f"Error during logout: {e}", exc_info=True)
        # Return a JSON error response
        return jsonify({"success": False, "error": "An internal server error occurred during logout."}), 500

@common_bp.route('/setup', methods=['GET', 'POST'])
def setup():
    # Allow setup page access even if user exists - setup might be in progress
    # The authentication middleware will handle proper authentication checks
    # This handles cases like returning from Plex authentication during setup
    
    if request.method == 'GET':
        # For GET requests, check if we should restore setup progress
        try:
            from src.primary.utils.database import get_database
            db = get_database()
            
            # Get setup progress for restoration
            setup_progress = db.get_setup_progress()
            logger.debug(f"Setup page accessed, current progress: {setup_progress}")
            
            # If user exists but setup is in progress, allow continuation
            if user_exists() and not db.is_setup_in_progress():
                logger.info("User exists and setup is complete, redirecting to login")
                return redirect(url_for('common.login_route'))
            
            # Render setup page with progress data
            return render_template('setup.html', setup_progress=setup_progress)
            
        except Exception as e:
            logger.error(f"Error checking setup progress: {e}")
            # Fallback to normal setup flow
            return render_template('setup.html', setup_progress=None)
    
    elif request.method == 'POST':
        # For POST requests, check if user exists to prevent duplicate creation
        if user_exists():
            logger.warning("Attempted to create user during setup but user already exists")
            return jsonify({"success": False, "error": "User already exists"}), 400
            
        username = None # Initialize username for logging in case of early failure
        try: # Add try block to catch potential errors during user creation
            data = request.json
            username = data.get('username')
            password = data.get('password')
            confirm_password = data.get('confirm_password')
            proxy_auth_bypass = data.get('proxy_auth_bypass', False)  # Get proxy auth bypass setting

            # Basic validation
            if not username or not password or not confirm_password:
                return jsonify({"success": False, "error": "Missing required fields"}), 400
            
            # Add username length validation
            if len(username.strip()) < 3:
                return jsonify({"success": False, "error": "Username must be at least 3 characters long"}), 400

            if password != confirm_password:
                return jsonify({"success": False, "error": "Passwords do not match"}), 400

            # Validate password strength using the backend function
            password_error = validate_password_strength(password)
            if password_error:
                return jsonify({"success": False, "error": password_error}), 400

            logger.info(f"Attempting to create user '{username}' during setup.")
            if create_user(username, password): # This function should now be defined via import
                
                # If proxy auth bypass is enabled, update general settings
                if proxy_auth_bypass:
                    try:
                        from src.primary import settings_manager
                        
                        # Load current general settings
                        general_settings = settings_manager.load_settings('general')
                        
                        # Update the proxy_auth_bypass setting
                        general_settings['proxy_auth_bypass'] = True
                        
                        # Save the updated settings
                        settings_manager.save_settings('general', general_settings)
                        logger.debug("Proxy auth bypass setting enabled during setup")
                    except Exception as e:
                        logger.error(f"Error saving proxy auth bypass setting: {e}", exc_info=True)
                
                # Save setup progress after account creation
                try:
                    from src.primary.utils.database import get_database
                    db = get_database()
                    progress_data = {
                        'current_step': 2,  # Move to 2FA step
                        'completed_steps': [1],
                        'account_created': True,
                        'two_factor_enabled': False,
                        'plex_setup_done': False,
                        'auth_mode_selected': False,
                        'recovery_key_generated': False,
                        'username': username,
                        'timestamp': datetime.now().isoformat()
                    }
                    db.save_setup_progress(progress_data)
                    logger.debug("Setup progress saved after account creation")
                except Exception as e:
                    logger.error(f"Error saving setup progress: {e}")
                
                # Automatically log in the user after setup
                logger.debug(f"User '{username}' created successfully during setup. Creating session.")
                session_token = create_session(username)
                # Explicitly set username in Flask session - might not be needed if using token correctly
                # session['username'] = username
                session[SESSION_COOKIE_NAME] = session_token # Store token in session
                response = jsonify({"success": True})
                # Set cookie in the response
                response.set_cookie(SESSION_COOKIE_NAME, session_token, httponly=True, samesite='Lax', path='/') # Add path
                return response
            else:
                # create_user itself failed, but didn't raise an exception
                logger.error(f"create_user function returned False for user '{username}' during setup.")
                return jsonify({"success": False, "error": "Failed to create user (internal reason)"}), 500
        except Exception as e:
            # Catch any unexpected exception during the process
            logger.error(f"Unexpected error during setup POST for user '{username if username else 'unknown'}': {e}", exc_info=True)
            return jsonify({"success": False, "error": f"An unexpected server error occurred: {e}"}), 500
    else:
        # GET request - show setup page
        logger.info("Displaying setup page.")
        return render_template('setup.html') # This function should now be defined via import

# --- User Management API Routes --- #

def get_user_for_request():
    """Get username for the current request, handling bypass modes"""
    # First try to get username from session
    session_token = request.cookies.get(SESSION_COOKIE_NAME)
    username = get_username_from_session(session_token)
    
    if username:
        return username
    
    # If no session username, check if we're in bypass mode
    try:
        from src.primary.settings_manager import load_settings
        settings = load_settings("general")
        local_access_bypass = settings.get("local_access_bypass", False)
        proxy_auth_bypass = settings.get("proxy_auth_bypass", False)
        
        if proxy_auth_bypass or local_access_bypass:
            # In bypass mode, get the first user from database
            from src.primary.utils.database import get_database
            db = get_database()
            first_user = db.get_first_user()
            if first_user:
                return first_user.get('username')
    except Exception as e:
        logger.error(f"Error checking bypass mode for user request: {e}")
    
    return None

@common_bp.route('/api/user/info', methods=['GET'])
def get_user_info_route():
    # Get username handling bypass modes
    username = get_user_for_request()

    if not username:
        logger.debug("Attempt to get user info failed: Not authenticated and not in bypass mode.")
        return jsonify({"error": "Not authenticated"}), 401

    # Pass username to is_2fa_enabled
    two_fa_status = is_2fa_enabled(username) # This function should now be defined via import
    logger.debug(f"Retrieved user info for '{username}'. 2FA enabled: {two_fa_status}")
    return jsonify({"username": username, "is_2fa_enabled": two_fa_status})

@common_bp.route('/api/user/change-username', methods=['POST'])
def change_username_route():
    # Get username handling bypass modes
    current_username = get_user_for_request()

    if not current_username:
        logger.warning("Username change attempt failed: Not authenticated and not in bypass mode.")
        return jsonify({"error": "Not authenticated"}), 401

    data = request.json
    new_username = data.get('username')
    password = data.get('password') # Get password from request

    if not new_username or not password: # Check if password is provided
        return jsonify({"success": False, "error": "New username and current password are required"}), 400

    # Add username length validation
    if len(new_username.strip()) < 3:
        return jsonify({"success": False, "error": "Username must be at least 3 characters long"}), 400

    # Call the change_username function from auth.py
    if auth_change_username(current_username, new_username, password):
        # Update the session to reflect the new username
        session_token = request.cookies.get(SESSION_COOKIE_NAME)
        if session_token:
            if update_session_username(session_token, new_username):
                logger.debug(f"Session updated with new username '{new_username}' for session {session_token}")
            else:
                logger.warning(f"Failed to update session with new username '{new_username}'")
        
        logger.info(f"Username changed successfully for '{current_username}' to '{new_username}'.")
        return jsonify({"success": True, "username": new_username})
    else:
        logger.warning(f"Username change failed for '{current_username}'. Check logs in auth.py for details.")
        return jsonify({"success": False, "error": "Failed to change username. Check password or logs."}), 400

@common_bp.route('/api/user/change-password', methods=['POST'])
def change_password_route():
    # Get username handling bypass modes
    username = get_user_for_request()

    if not username:
         logger.warning("Password change attempt failed: Not authenticated and not in bypass mode.")
         return jsonify({"error": "Not authenticated"}), 401

    data = request.json
    current_password = data.get('current_password')
    new_password = data.get('new_password')

    if not current_password or not new_password:
        logger.warning(f"Password change attempt for user '{username}' failed: Missing current or new password.")
        return jsonify({"success": False, "error": "Current and new passwords are required"}), 400

    logger.info(f"Attempting to change password for user '{username}'.")
    # Pass username? change_password might not need it. Assuming it doesn't for now.
    if auth_change_password(current_password, new_password):
        logger.info(f"Password changed successfully for user '{username}'.")
        return jsonify({"success": True})
    else:
        logger.warning(f"Password change failed for user '{username}'. Check logs in auth.py for details.")
        return jsonify({"success": False, "error": "Failed to change password. Check current password or logs."}), 400

# --- 2FA Management API Routes --- #

@common_bp.route('/api/user/2fa/setup', methods=['POST'])
def setup_2fa():
    # Get username handling bypass modes and setup context
    username = get_user_for_request()

    # If no username from session/bypass, check if we're in setup mode
    if not username:
        try:
            from src.primary.utils.database import get_database
            db = get_database()
            setup_progress = db.get_setup_progress()
            if setup_progress and setup_progress.get('username'):
                username = setup_progress.get('username')
                logger.debug(f"Using username from setup progress: {username}")
            else:
                # If no setup progress, try to get the first user (single user system)
                first_user = db.get_first_user()
                if first_user:
                    username = first_user.get('username')
                    logger.debug(f"Using first user for 2FA setup: {username}")
        except Exception as e:
            logger.error(f"Error getting username for 2FA setup: {e}")

    if not username:
        logger.warning("2FA setup attempt failed: Not authenticated and not in bypass mode.")
        return jsonify({"error": "Not authenticated"}), 401

    try:
        logger.info(f"Generating 2FA setup for user: {username}") # Add logging
        # Pass username to generate_2fa_secret
        secret, qr_code_data_uri = generate_2fa_secret(username) # This function should now be defined via import

        # Return secret and QR code data URI
        return jsonify({"success": True, "secret": secret, "qr_code_url": qr_code_data_uri}) # Match frontend expectation 'qr_code_url'

    except Exception as e:
        logger.error(f"Error during 2FA setup generation for user '{username}': {e}", exc_info=True)
        return jsonify({"success": False, "error": "Failed to generate 2FA setup information."}), 500

@common_bp.route('/api/user/2fa/verify', methods=['POST'])
def verify_2fa():
    # Get username handling bypass modes and setup context
    username = get_user_for_request()

    # If no username from session/bypass, check if we're in setup mode
    if not username:
        try:
            from src.primary.utils.database import get_database
            db = get_database()
            setup_progress = db.get_setup_progress()
            if setup_progress and setup_progress.get('username'):
                username = setup_progress.get('username')
                logger.debug(f"Using username from setup progress: {username}")
            else:
                # If no setup progress, try to get the first user (single user system)
                first_user = db.get_first_user()
                if first_user:
                    username = first_user.get('username')
                    logger.debug(f"Using first user for 2FA verify: {username}")
        except Exception as e:
            logger.error(f"Error getting username for 2FA verify: {e}")

    if not username:
        logger.warning("2FA verify attempt failed: Not authenticated and not in bypass mode.")
        return jsonify({"error": "Not authenticated"}), 401

    data = request.json
    otp_code = data.get('code') # Match frontend key 'code'

    if not otp_code or len(otp_code) != 6 or not otp_code.isdigit(): # Add validation
        logger.warning(f"2FA verification for '{username}' failed: Invalid code format provided.")
        return jsonify({"success": False, "error": "Invalid or missing 6-digit OTP code"}), 400

    logger.info(f"Attempting to verify 2FA code for user '{username}'.")
    # Pass username to verify_2fa_code
    if verify_2fa_code(username, otp_code, enable_on_verify=True): # This function should now be defined via import
        logger.info(f"Successfully verified and enabled 2FA for user: {username}") # Add logging
        return jsonify({"success": True})
    else:
        # Reason logged in verify_2fa_code
        logger.warning(f"2FA verification failed for user: {username}. Check logs in auth.py.")
        return jsonify({"success": False, "error": "Invalid OTP code"}), 400 # Use 400 for bad request

@common_bp.route('/api/user/2fa/disable', methods=['POST'])
def disable_2fa_route():
    # Get username handling bypass modes
    username = get_user_for_request()

    if not username:
        logger.warning("2FA disable attempt failed: Not authenticated and not in bypass mode.")
        return jsonify({"error": "Not authenticated"}), 401

    data = request.json
    password = data.get('password')
    otp_code = data.get('code')

    # Require BOTH password and OTP code
    if not password or not otp_code:
         logger.warning(f"2FA disable attempt for '{username}' failed: Missing password or OTP code.")
         return jsonify({"success": False, "error": "Both password and current OTP code are required to disable 2FA"}), 400

    if not (len(otp_code) == 6 and otp_code.isdigit()):
        logger.warning(f"2FA disable attempt for '{username}' failed: Invalid OTP code format.")
        return jsonify({"success": False, "error": "Invalid 6-digit OTP code format"}), 400

    # Call a function that verifies both password and OTP
    if disable_2fa_with_password_and_otp(username, password, otp_code):
        logger.info(f"2FA disabled successfully for user '{username}' using password and OTP.")
        return jsonify({"success": True})
    else:
        # Reason logged in disable_2fa_with_password_and_otp
        logger.warning(f"Failed to disable 2FA for user '{username}' using password and OTP. Check logs.")
        # The auth function should log the specific reason (bad pass, bad otp)
        return jsonify({"success": False, "error": "Failed to disable 2FA. Invalid password or OTP code."}), 400

# --- Recovery Key Management API Routes --- #

@common_bp.route('/auth/recovery-key/generate', methods=['POST'])
def generate_recovery_key():
    """Generate a new recovery key for the authenticated user"""
    # Get username handling bypass modes and setup mode
    username = get_user_for_request()
    
    # If not authenticated, check if we're in setup mode and get username from setup progress
    if not username:
        try:
            data = request.json or {}
            setup_mode = data.get('setup_mode', False)
            if setup_mode:
                from ..utils.database import get_database
                db = get_database()
                setup_progress = db.get_setup_progress()
                if setup_progress and setup_progress.get('username'):
                    username = setup_progress['username']
                    logger.debug(f"Using username from setup progress: {username}")
                else:
                    logger.warning("Recovery key generation in setup mode failed: No username in setup progress.")
                    return jsonify({"error": "Setup not properly initialized"}), 400
            else:
                logger.warning("Recovery key generation attempt failed: Not authenticated and not in bypass mode.")
                return jsonify({"error": "Not authenticated"}), 401
        except Exception as e:
            logger.error(f"Error checking setup mode for recovery key generation: {e}")
            return jsonify({"error": "Authentication check failed"}), 500

    if not username:
        logger.warning("Recovery key generation attempt failed: Could not determine username.")
        return jsonify({"error": "Not authenticated"}), 401

    try:
        data = request.json or {}
        current_password = data.get('password')
        two_factor_code = data.get('two_factor_code')
        setup_mode = data.get('setup_mode', False)  # Check if this is during setup

        # During setup mode, skip password verification
        if not setup_mode:
            # Require current password for security (normal operation)
            if not current_password:
                logger.warning(f"Recovery key generation for '{username}' failed: No password provided.")
                return jsonify({"success": False, "error": "Current password is required"}), 400

            # Verify current password
            if not verify_user(username, current_password):
                logger.warning(f"Recovery key generation for '{username}' failed: Invalid password.")
                return jsonify({"success": False, "error": "Invalid current password"}), 400

            # Check if 2FA is enabled and verify if needed
            if is_2fa_enabled(username):
                if not two_factor_code:
                    logger.warning(f"Recovery key generation for '{username}' failed: 2FA code required.")
                    return jsonify({"success": False, "error": "Two-factor authentication code is required"}), 400
                
                if not verify_2fa_code(username, two_factor_code):
                    logger.warning(f"Recovery key generation for '{username}' failed: Invalid 2FA code.")
                    return jsonify({"success": False, "error": "Invalid two-factor authentication code"}), 400

        # Generate the recovery key
        from ..utils.database import get_database
        db = get_database()
        recovery_key = db.generate_recovery_key(username)

        if recovery_key:
            logger.info(f"Recovery key generated successfully for user: {username} (setup_mode: {setup_mode})")
            return jsonify({
                "success": True, 
                "recovery_key": recovery_key,
                "message": "Recovery key generated successfully. Please save this key securely - it will not be shown again."
            })
        else:
            logger.error(f"Failed to generate recovery key for user: {username}")
            return jsonify({"success": False, "error": "Failed to generate recovery key"}), 500

    except Exception as e:
        logger.error(f"Error generating recovery key for user '{username}': {e}", exc_info=True)
        return jsonify({"success": False, "error": "An internal error occurred"}), 500

@common_bp.route('/auth/recovery-key/verify', methods=['POST'])
def verify_recovery_key():
    """Verify a recovery key (no authentication required)"""
    try:
        # Get client IP address for rate limiting
        client_ip = request.environ.get('HTTP_X_FORWARDED_FOR', request.environ.get('REMOTE_ADDR', 'unknown'))
        if ',' in client_ip:
            client_ip = client_ip.split(',')[0].strip()
            
        data = request.json or {}
        recovery_key = data.get('recovery_key', '').strip()

        if not recovery_key:
            return jsonify({"success": False, "error": "Recovery key is required"}), 400

        # Check rate limiting before processing
        from ..utils.database import get_database
        db = get_database()
        rate_limit_check = db.check_recovery_key_rate_limit(client_ip)
        
        if rate_limit_check["locked"]:
            from datetime import datetime
            try:
                locked_until = datetime.fromisoformat(rate_limit_check["locked_until"])
                minutes_remaining = int((locked_until - datetime.now()).total_seconds() / 60)
                if minutes_remaining > 0:
                    logger.warning(f"Recovery key verification blocked for IP {client_ip} - locked for {minutes_remaining} more minutes")
                    return jsonify({
                        "success": False, 
                        "error": f"Too many failed attempts. Please try again in {minutes_remaining} minutes."
                    }), 429
            except (ValueError, TypeError):
                # If there's an issue with the timestamp, clear the lock
                db.record_recovery_key_attempt(client_ip, success=True)

        # Verify the recovery key
        username = db.verify_recovery_key(recovery_key)

        if username:
            # Record successful attempt to clear rate limiting
            db.record_recovery_key_attempt(client_ip, username=username, success=True)
            logger.info(f"Recovery key verified successfully for user: {username} from IP {client_ip}")
            return jsonify({"success": True, "username": username})
        else:
            # Record failed attempt
            db.record_recovery_key_attempt(client_ip, success=False)
            failed_attempts = rate_limit_check["failed_attempts"] + 1
            
            if failed_attempts >= 3:
                logger.warning(f"Recovery key rate limit triggered for IP {client_ip} after {failed_attempts} failed verification attempts")
                return jsonify({
                    "success": False, 
                    "error": "Too many failed attempts. Recovery key access has been temporarily disabled for 15 minutes."
                }), 429
            else:
                logger.warning(f"Invalid recovery key verification attempt from IP {client_ip} ({failed_attempts}/3 attempts)")
                return jsonify({
                    "success": False, 
                    "error": f"Invalid recovery key. {3 - failed_attempts} attempts remaining."
                }), 400

    except Exception as e:
        logger.error(f"Error verifying recovery key: {e}", exc_info=True)
        return jsonify({"success": False, "error": "An internal error occurred"}), 500

@common_bp.route('/auth/recovery-key/reset', methods=['POST'])
def reset_password_with_recovery_key():
    """Reset password using recovery key (no authentication required)"""
    try:
        # Get client IP address for rate limiting
        client_ip = request.environ.get('HTTP_X_FORWARDED_FOR', request.environ.get('REMOTE_ADDR', 'unknown'))
        if ',' in client_ip:
            client_ip = client_ip.split(',')[0].strip()
        
        data = request.json or {}
        recovery_key = data.get('recovery_key', '').strip()
        new_password = data.get('new_password', '').strip()

        if not recovery_key or not new_password:
            return jsonify({"success": False, "error": "Recovery key and new password are required"}), 400

        # Validate password strength - only require 8 characters minimum
        if len(new_password) < 8:
            return jsonify({"success": False, "error": "Password must be at least 8 characters long."}), 400

        # Check rate limiting before processing
        from ..utils.database import get_database
        db = get_database()
        rate_limit_check = db.check_recovery_key_rate_limit(client_ip)
        
        if rate_limit_check["locked"]:
            from datetime import datetime
            try:
                locked_until = datetime.fromisoformat(rate_limit_check["locked_until"])
                minutes_remaining = int((locked_until - datetime.now()).total_seconds() / 60)
                if minutes_remaining > 0:
                    logger.warning(f"Recovery key attempt blocked for IP {client_ip} - locked for {minutes_remaining} more minutes")
                    return jsonify({
                        "success": False, 
                        "error": f"Too many failed attempts. Please try again in {minutes_remaining} minutes."
                    }), 429
            except (ValueError, TypeError):
                # If there's an issue with the timestamp, clear the lock
                db.record_recovery_key_attempt(client_ip, success=True)

        # Verify the recovery key
        username = db.verify_recovery_key(recovery_key)

        if not username:
            # Record failed attempt
            db.record_recovery_key_attempt(client_ip, success=False)
            failed_attempts = rate_limit_check["failed_attempts"] + 1
            
            if failed_attempts >= 3:
                logger.warning(f"Recovery key rate limit triggered for IP {client_ip} after {failed_attempts} failed attempts")
                return jsonify({
                    "success": False, 
                    "error": "Too many failed attempts. Recovery key access has been temporarily disabled for 15 minutes."
                }), 429
            else:
                logger.warning(f"Invalid recovery key attempt from IP {client_ip} ({failed_attempts}/3 attempts)")
                return jsonify({
                    "success": False, 
                    "error": f"Invalid recovery key. {3 - failed_attempts} attempts remaining."
                }), 400

        # Reset the password using database method directly
        if db.update_user_password(username, new_password):
            # Record successful attempt to clear rate limiting
            db.record_recovery_key_attempt(client_ip, username=username, success=True)
            
            # Disable 2FA since user needed recovery key (likely lost 2FA device)
            two_fa_disabled = db.update_user_2fa(username, two_fa_enabled=False, two_fa_secret=None)
            if two_fa_disabled:
                logger.info(f"Disabled 2FA for user '{username}' after password reset via recovery key from IP {client_ip}")
            else:
                logger.warning(f"Failed to disable 2FA for user '{username}' after password reset")
            
            # Keep recovery key valid - user may need it again and should manually generate new one
            logger.info(f"Password reset successfully using recovery key for user: {username} from IP {client_ip}")
            
            # Update message to inform user that 2FA has been disabled and recovery key is still valid
            message = "Password reset successfully. Two-factor authentication has been disabled for security - you can re-enable it in your account settings. Your recovery key remains valid until you generate a new one."
            return jsonify({"success": True, "message": message})
        else:
            logger.error(f"Failed to reset password for user: {username}")
            return jsonify({"success": False, "error": "Failed to reset password"}), 500

    except Exception as e:
        logger.error(f"Error resetting password with recovery key: {e}", exc_info=True)
        return jsonify({"success": False, "error": "An internal error occurred"}), 500

# --- Theme Setting Route ---
@common_bp.route('/api/settings/theme', methods=['POST'])
def set_theme():
    # Get username handling bypass modes
    username = get_user_for_request()
    
    if not username:
         logger.warning("Theme setting attempt failed: Not authenticated and not in bypass mode.")
         return jsonify({"error": "Unauthorized"}), 401

    try:
        data = request.json
        dark_mode = data.get('dark_mode')

        if dark_mode is None or not isinstance(dark_mode, bool):
            logger.warning("Invalid theme setting received.")
            return jsonify({"success": False, "error": "Invalid 'dark_mode' value"}), 400

        # Here you would typically save this preference to a user profile or global setting
        # For now, just log it. A real implementation would persist this.


        # Example: Saving to a hypothetical global config (replace with actual persistence)
        # global_settings = settings_manager.load_global_settings() # Assuming such a function exists
        # global_settings['ui']['dark_mode'] = dark_mode
        # settings_manager.save_global_settings(global_settings) # Assuming such a function exists

        return jsonify({"success": True})
    except Exception as e:
        logger.error(f"Error setting theme preference: {e}", exc_info=True)
        return jsonify({"success": False, "error": "Failed to set theme preference"}), 500



# --- Local Access Bypass Status API Route --- #

@common_bp.route('/api/get_local_access_bypass_status', methods=['GET'])
def get_local_access_bypass_status_route():
    """API endpoint to get the status of the local network authentication bypass setting.
    Also checks proxy_auth_bypass to hide user menu in both bypass modes."""
    try:
        # Get both bypass settings from the 'general' section, default to False if not found
        local_access_bypass = settings_manager.get_setting('general', 'local_access_bypass', False)
        proxy_auth_bypass = settings_manager.get_setting('general', 'proxy_auth_bypass', False)
        
        # Enable if either bypass mode is active
        bypass_enabled = local_access_bypass or proxy_auth_bypass
        
        # Bypass status retrieved - debug spam removed
        # Return status in the format expected by the frontend
        return jsonify({"isEnabled": bypass_enabled})
    except Exception as e:
        logger.error(f"Error retrieving local_access_bypass status: {e}", exc_info=True)
        # Return a generic error to the client
        return jsonify({"error": "Failed to retrieve bypass status"}), 500

# --- Stats Management API Routes --- #
@common_bp.route('/api/stats', methods=['GET'])
def get_stats_api():
    """API endpoint to get media statistics"""
    try:
        # Import here to avoid circular imports
        from ..stats_manager import get_stats
        
        # Get stats from stats_manager
        stats = get_stats()
        # Stats retrieved - debug spam removed
        
        # Return success response with stats
        return jsonify({"success": True, "stats": stats})
    except Exception as e:
        logger.error(f"Error retrieving stats: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500

@common_bp.route('/api/stats/reset', methods=['POST'])
def reset_stats_api():
    """API endpoint to reset media statistics"""
    try:
        # Import here to avoid circular imports
        from ..stats_manager import reset_stats
        
        # Check if authenticated
        session_token = request.cookies.get(SESSION_COOKIE_NAME)
        if not verify_session(session_token):
            logger.warning("Stats reset attempt failed: Not authenticated.")
            return jsonify({"error": "Unauthorized"}), 401
            
        # Get app type from request if provided
        data = request.json or {}
        app_type = data.get('app_type')  # None will reset all
        
        if app_type is not None and app_type not in ["sonarr", "radarr", "lidarr", "readarr", "whisparr"]:
            logger.warning(f"Invalid app_type for stats reset: {app_type}")
            return jsonify({"success": False, "error": "Invalid app_type"}), 400
            
        # Reset stats
        if reset_stats(app_type):
            message = f"Reset statistics for {app_type}" if app_type else "Reset all statistics"
            logger.info(message)
            return jsonify({"success": True, "message": message})
        else:
            error_msg = f"Failed to reset statistics for {app_type}" if app_type else "Failed to reset all statistics"
            logger.error(error_msg)
            return jsonify({"success": False, "error": error_msg}), 500
    except Exception as e:
        logger.error(f"Error resetting stats: {e}", exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500

# Ensure all routes previously in this file that interact with settings
# are either moved to web_server.py or updated here using the new settings_manager functions.

@common_bp.route('/api/database/integrity', methods=['GET', 'POST'])
def database_integrity():
    """Check database integrity and optionally repair issues"""
    # Get username handling bypass modes
    username = get_user_for_request()
    if not username:
        return jsonify({"success": False, "error": "Authentication required"}), 401
    
    try:
        from primary.utils.database import get_database
        
        repair = request.json.get('repair', False) if request.method == 'POST' else False
        
        db = get_database()
        results = db.perform_integrity_check(repair=repair)
        
        return jsonify({
            'success': True,
            'integrity_check': results,
            'timestamp': datetime.now().isoformat()
        })
        
    except Exception as e:
        logger.error(f"Database integrity check failed: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@common_bp.route('/api/database/backup', methods=['POST'])
def create_database_backup():
    """Create a verified backup of the database"""
    # Get username handling bypass modes
    username = get_user_for_request()
    if not username:
        return jsonify({"success": False, "error": "Authentication required"}), 401
    
    try:
        from primary.utils.database import get_database
        
        backup_name = request.json.get('backup_name') if request.json else None
        
        db = get_database()
        backup_path = db.create_backup(backup_name)
        
        # Get backup file size for confirmation
        from pathlib import Path
        backup_size = Path(backup_path).stat().st_size
        
        return jsonify({
            'success': True,
            'backup_path': backup_path,
            'backup_size': backup_size,
            'timestamp': datetime.now().isoformat()
        })
        
    except Exception as e:
        logger.error(f"Database backup creation failed: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@common_bp.route('/api/database/maintenance', methods=['POST'])
def trigger_database_maintenance():
    """Trigger immediate database maintenance operations"""
    # Get username handling bypass modes
    username = get_user_for_request()
    if not username:
        return jsonify({"success": False, "error": "Authentication required"}), 401
    
    try:
        from primary.utils.database import get_database
        
        db = get_database()
        
        # Perform maintenance operations
        maintenance_results = {
            'integrity_check': db.perform_integrity_check(repair=True),
            'optimization': {'status': 'completed'},
            'checkpoint': {'status': 'completed'}
        }
        
        # Run optimization and checkpoint
        with db.get_connection() as conn:
            conn.execute("PRAGMA optimize")
            conn.execute("PRAGMA wal_checkpoint(PASSIVE)")
        
        return jsonify({
            'success': True,
            'maintenance_results': maintenance_results,
            'timestamp': datetime.now().isoformat()
        })
        
    except Exception as e:
        logger.error(f"Database maintenance failed: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@common_bp.route('/api/database/status', methods=['GET'])
def database_status():
    """Get comprehensive database status information"""
    # Get username handling bypass modes
    username = get_user_for_request()
    if not username:
        return jsonify({"success": False, "error": "Authentication required"}), 401
    
    try:
        from primary.utils.database import get_database
        import os
        
        db = get_database()
        
        # Get database file info
        db_size = os.path.getsize(db.db_path) if db.db_path.exists() else 0
        
        # Get database stats
        with db.get_connection() as conn:
            page_count = conn.execute("PRAGMA page_count").fetchone()[0]
            page_size = conn.execute("PRAGMA page_size").fetchone()[0]
            freelist_count = conn.execute("PRAGMA freelist_count").fetchone()[0]
            journal_mode = conn.execute("PRAGMA journal_mode").fetchone()[0]
            cache_size = conn.execute("PRAGMA cache_size").fetchone()[0]
            
        status_info = {
            'database_path': str(db.db_path),
            'database_size': db_size,
            'database_size_mb': round(db_size / (1024 * 1024), 2),
            'page_count': page_count,
            'page_size': page_size,
            'freelist_count': freelist_count,
            'journal_mode': journal_mode,
            'cache_size': cache_size,
            'utilization': round((page_count - freelist_count) / page_count * 100, 2) if page_count > 0 else 0
        }
        
        return jsonify({
            'success': True,
            'database_status': status_info,
            'timestamp': datetime.now().isoformat()
        })
        
    except Exception as e:
        logger.error(f"Failed to get database status: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@common_bp.route('/api/setup/progress', methods=['GET', 'POST'])
def setup_progress():
    """Get or save setup progress"""
    try:
        from src.primary.utils.database import get_database
        db = get_database()
        
        if request.method == 'GET':
            # Get current setup progress
            progress = db.get_setup_progress()
            return jsonify({
                'success': True,
                'progress': progress
            })
        
        elif request.method == 'POST':
            # Save setup progress
            data = request.json
            progress_data = data.get('progress', {})
            
            # Add timestamp
            progress_data['timestamp'] = datetime.now().isoformat()
            
            # Save to database
            success = db.save_setup_progress(progress_data)
            
            return jsonify({
                'success': success,
                'message': 'Setup progress saved' if success else 'Failed to save setup progress'
            })
    
    except Exception as e:
        logger.error(f"Setup progress API error: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@common_bp.route('/api/setup/clear', methods=['POST'])
def clear_setup_progress():
    """Clear setup progress (called when setup is complete)"""
    try:
        from src.primary.utils.database import get_database
        db = get_database()
        
        success = db.clear_setup_progress()
        
        return jsonify({
            'success': success,
            'message': 'Setup progress cleared' if success else 'Failed to clear setup progress'
        })
    
    except Exception as e:
        logger.error(f"Clear setup progress API error: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@common_bp.route('/api/setup/status', methods=['GET'])
def setup_status():
    try:
        from src.primary.utils.database import get_database
        db = get_database()
        
        # Check if user exists and setup progress
        user_exists_flag = user_exists()
        setup_in_progress = db.is_setup_in_progress() if user_exists_flag else False
        
        return jsonify({
            "success": True,
            "user_exists": user_exists_flag,
            "setup_in_progress": setup_in_progress
        })
    except Exception as e:
        logger.error(f"Error checking setup status: {e}")
        return jsonify({"success": False, "error": "Failed to check setup status"}), 500




