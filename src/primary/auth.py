#!/usr/bin/env python3
"""
Authentication module for Huntarr
Handles user creation, verification, and session management
Including two-factor authentication and Plex OAuth
"""

import os
import json
import hashlib
import secrets
import time
import pathlib
import base64
import io
import qrcode
import pyotp # Ensure pyotp is imported
import re # Import the re module for regex
import requests
import uuid
import sqlite3
from typing import Dict, Any, Optional, Tuple, Union
from flask import request, redirect, url_for, session
from .utils.logger import logger # Ensure logger is imported

# Database setup
from src.primary.utils.database import get_database

# Session settings
SESSION_EXPIRY = 60 * 60 * 24 * 7  # 1 week in seconds
SESSION_COOKIE_NAME = "huntarr_session"

# Plex OAuth settings
PLEX_CLIENT_IDENTIFIER = None  # Will be generated on first use
PLEX_PRODUCT_NAME = "Huntarr"
PLEX_VERSION = "1.0"

# Store active sessions
active_sessions = {}

# Store active Plex PINs
active_plex_pins = {}

# --- Helper functions for user data ---
def get_user_data(username: str = None) -> Dict[str, Any]:
    """Load user data from the database."""
    db = get_database()
    if username:
        return db.get_user_by_username(username) or {}
    else:
        # For backward compatibility, return first user if no username specified
        # This is used in legacy code that expects single user
        try:
            # Get the first user from the database
            with sqlite3.connect(db.db_path) as conn:
                conn.row_factory = sqlite3.Row
                cursor = conn.execute('SELECT * FROM users LIMIT 1')
                row = cursor.fetchone()
                
                if row:
                    user_data = dict(row)
                    # Parse JSON fields
                    if user_data.get('plex_user_data'):
                        try:
                            import json
                            user_data['plex_user_data'] = json.loads(user_data['plex_user_data'])
                        except json.JSONDecodeError:
                            user_data['plex_user_data'] = None
                    return user_data
                return {}
        except Exception as e:
            logger.error(f"Error getting user data: {e}")
            return {}

def save_user_data(user_data: Dict[str, Any]) -> bool:
    """Save user data to the database."""
    try:
        db = get_database()
        username = user_data.get('username')
        if not username:
            logger.error("Cannot save user data without username")
            return False
            
        # Check if user exists
        existing_user = db.get_user_by_username(username)
        if existing_user:
            # Update existing user
            success = True
            if 'password' in user_data:
                success &= db.update_user_password(username, user_data['password'])
            if 'two_fa_enabled' in user_data or 'two_fa_secret' in user_data:
                success &= db.update_user_2fa(
                    username, 
                    user_data.get('two_fa_enabled', existing_user.get('two_fa_enabled', False)),
                    user_data.get('two_fa_secret', existing_user.get('two_fa_secret'))
                )
            if 'temp_2fa_secret' in user_data:
                success &= db.update_user_temp_2fa_secret(username, user_data.get('temp_2fa_secret'))
            if 'plex_token' in user_data or 'plex_user_data' in user_data:
                success &= db.update_user_plex(
                    username,
                    user_data.get('plex_token', existing_user.get('plex_token')),
                    user_data.get('plex_user_data', existing_user.get('plex_user_data'))
                )
            return success
        else:
            # Create new user
            return db.create_user(
                username=username,
                password=user_data.get('password', ''),
                two_fa_enabled=user_data.get('two_fa_enabled', False),
                two_fa_secret=user_data.get('two_fa_secret'),
                plex_token=user_data.get('plex_token'),
                plex_user_data=user_data.get('plex_user_data')
            )
    except Exception as e:
        logger.error(f"Error saving user data: {e}", exc_info=True)
        return False
# --- End Helper functions ---

def hash_password(password: str) -> str:
    """Hash a password for storage"""
    # Use SHA-256 with a salt
    salt = secrets.token_hex(16)
    pw_hash = hashlib.sha256((password + salt).encode()).hexdigest()
    return f"{salt}:{pw_hash}"

def verify_password(stored_password: str, provided_password: str) -> bool:
    """Verify a password against its hash"""
    try:
        salt, pw_hash = stored_password.split(':', 1)
        verify_hash = hashlib.sha256((provided_password + salt).encode()).hexdigest()
        return secrets.compare_digest(verify_hash, pw_hash)
    except Exception as e:
        logger.error(f"Error verifying password hash: {e}", exc_info=True)
        return False

def hash_username(username: str) -> str:
    """Create a normalized hash of the username"""
    # Convert to lowercase and hash
    return hashlib.sha256(username.lower().encode()).hexdigest()

def validate_password_strength(password: str) -> Optional[str]:
    """Validate password strength based on defined criteria.

    Args:
        password: The password string to validate.

    Returns:
        An error message string if validation fails, None otherwise.
    """
    if len(password) < 8:
        return "Password must be at least 8 characters long."
    
    # If check passes
    return None

def user_exists() -> bool:
    """Check if a user has been created"""
    db = get_database()
    return db.user_exists()

def create_user(username: str, password: str) -> bool:
    """Create a new user"""
    if not username or not password:
        logger.error("Attempted to create user with empty username or password")
        return False
        
    # Store credentials in database (no hashing as requested)
    db = get_database()
    success = db.create_user(
        username=username,
        password=password,
        two_fa_enabled=False,
        two_fa_secret=None
    )
    
    if success:
        logger.info("User creation successful")
    else:
        logger.error("User creation failed")
    
    return success

def verify_user(username: str, password: str, otp_code: str = None) -> Tuple[bool, bool]:
    """
    Verify user credentials
    
    Returns:
        Tuple[bool, bool]: (auth_success, needs_2fa)
    """
    if not user_exists():
        logger.warning("Login attempt failed: User does not exist.")
        return False, False
        
    try:
        db = get_database()
        user_data = db.get_user_by_username(username)
        
        if not user_data:
            logger.warning(f"Login attempt failed: User '{username}' not found.")
            return False, False
        
        # Verify password (no hashing as requested)
        if user_data.get("password") == password:
            # Check if 2FA is enabled
            two_fa_enabled = user_data.get("two_fa_enabled", False)
            logger.debug(f"2FA enabled for user '{username}': {two_fa_enabled}")
            logger.debug(f"2FA secret present: {bool(user_data.get('two_fa_secret'))}")
            logger.debug(f"OTP code provided: {bool(otp_code)}")
            
            if two_fa_enabled:
                # If 2FA code was provided, verify it
                if otp_code:
                    totp = pyotp.TOTP(user_data.get("two_fa_secret"))
                    valid_code = totp.verify(otp_code)
                    logger.debug(f"OTP code validation result: {valid_code}")
                    if valid_code:
                        logger.debug(f"User '{username}' authenticated successfully with 2FA.")
                        return True, False
                    else:
                        logger.warning(f"Login attempt failed for user '{username}': Invalid 2FA code.")
                        return False, True
                else:
                    # No OTP code provided but 2FA is enabled
                    logger.warning(f"Login attempt failed for user '{username}': 2FA code required but not provided.")
                    logger.debug("Returning needs_2fa=True to trigger 2FA input display")
                    return False, True
            else:
                # 2FA not enabled, password is correct
                logger.debug(f"User '{username}' authenticated successfully (no 2FA).")
                return True, False
        else:
            logger.warning(f"Login attempt failed for user '{username}': Invalid password.")
            return False, False
    except Exception as e:
        logger.error(f"Error during user verification for '{username}': {e}", exc_info=True)
    
    logger.warning(f"Login attempt failed for user '{username}': Username not found or other error.")
    return False, False

def create_session(username: str) -> str:
    """Create a new session for an authenticated user"""
    session_id = secrets.token_hex(32)
    # Store the actual username, not the hash
    
    # Store session data
    active_sessions[session_id] = {
        "username": username, # Store actual username
        "created_at": time.time(),
        "expires_at": time.time() + SESSION_EXPIRY
    }
    
    return session_id

def verify_session(session_id: str) -> bool:
    """Verify if a session is valid"""
    if not session_id or session_id not in active_sessions:
        return False
        
    session_data = active_sessions[session_id]
    
    # Check if session has expired
    if session_data.get("expires_at", 0) < time.time():
        # Clean up expired session
        del active_sessions[session_id]
        return False
        
    # Extend session expiry
    active_sessions[session_id]["expires_at"] = time.time() + SESSION_EXPIRY
    return True

def get_username_from_session(session_id: str) -> Optional[str]:
    """Get the username from a session"""
    if not session_id or session_id not in active_sessions:
        return None
    
    # Return the stored username
    return active_sessions[session_id].get("username")

def update_session_username(session_id: str, new_username: str) -> bool:
    """Update the username in an existing session"""
    if not session_id or session_id not in active_sessions:
        return False
    
    # Update the username in the session
    active_sessions[session_id]["username"] = new_username
    logger.debug(f"Updated session {session_id} username to '{new_username}'")
    return True

def authenticate_request():
    """Flask route decorator to check if user is authenticated"""

    # Skip authentication for static files and the login/setup pages
    static_path = "/static/"
    login_path = "/login"
    api_login_path = "/api/login"
    api_auth_plex_path = "/api/auth/plex"
    setup_path = "/setup"
    user_path = "/user"
    api_setup_path = "/api/setup"
    favicon_path = "/favicon.ico"
    health_check_path = "/api/health"
    ping_path = "/ping"

    # Check if this is a commonly polled API endpoint to reduce log verbosity
    is_polling_endpoint = any(endpoint in request.path for endpoint in [
        '/api/logs/', '/api/cycle/', '/api/hourly-caps', '/api/swaparr/status'
    ])
    
    if not is_polling_endpoint:
        pass  # Path checking debug removed to reduce log spam

    # FIRST: Always allow setup and user page access - this handles returns from external auth like Plex
    if request.path in ['/setup', '/user']:
        if not is_polling_endpoint:
            logger.debug(f"Allowing setup/user page access for path: {request.path}")
        return None

    # Skip authentication for static files, API setup, health check path, ping, and github sponsors
    if request.path.startswith((static_path, api_setup_path)) or request.path in (favicon_path, health_check_path, ping_path, '/api/github_sponsors', '/api/sponsors/init'):
        return None
    
    # If no user exists, redirect to setup
    if not user_exists():
        if not is_polling_endpoint:
            logger.debug(f"No user exists, redirecting to setup")
        
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
            return redirect(url_for("common.setup"))
    
    # Skip authentication for login pages, Plex auth endpoints, recovery key endpoints, and setup-related user endpoints
    recovery_key_path = "/auth/recovery-key"
    api_user_2fa_path = "/api/user/2fa/"
    if request.path.startswith((login_path, api_login_path, api_auth_plex_path, recovery_key_path, api_user_2fa_path)):
        if not is_polling_endpoint:
            logger.debug(f"Skipping authentication for login/plex/recovery/2fa path '{request.path}'")
        return None
    
    # Load general settings
    local_access_bypass = False
    proxy_auth_bypass = False
    try:
        # Force reload settings from disk to ensure we have the latest
        from src.primary.settings_manager import load_settings
        from src.primary import settings_manager
        
        # Ensure we're getting fresh settings by clearing any cache
        if hasattr(settings_manager, 'settings_cache'):
            settings_manager.settings_cache = {}
            
        settings = load_settings("general")  # Specify 'general' as the app_type
        general_settings = settings
        local_access_bypass = general_settings.get("local_access_bypass", False)
        proxy_auth_bypass = general_settings.get("proxy_auth_bypass", False)
        
        # Log settings only for non-polling endpoints to reduce spam
        if not is_polling_endpoint:
            pass

    except Exception as e:
        logger.error(f"Error loading authentication bypass settings: {e}", exc_info=True)
    
    # Check if proxy auth bypass is enabled - this completely disables authentication
    # Note: This has highest priority and is checked first (matching the "No Login Mode" in the UI)
    if proxy_auth_bypass:
        return None
    
    remote_addr = request.remote_addr
    if not is_polling_endpoint:
        pass  # IP address debug removed to reduce log spam
    
    if local_access_bypass:
        # Common local network IP ranges
        local_networks = [
            '127.0.0.1',      # localhost
            '::1',            # localhost IPv6
            '10.',            # 10.0.0.0/8
            '172.16.',        # 172.16.0.0/12
            '172.17.',
            '172.18.',
            '172.19.',
            '172.20.',
            '172.21.',
            '172.22.',
            '172.23.',
            '172.24.',
            '172.25.',
            '172.26.',
            '172.27.',
            '172.28.',
            '172.29.',
            '172.30.',
            '172.31.',
            '192.168.'        # 192.168.0.0/16
        ]
        is_local = False
        
        # Check if request is coming through a proxy
        forwarded_for = request.headers.get('X-Forwarded-For')
        if forwarded_for:
            logger.debug(f"X-Forwarded-For header detected: {forwarded_for}")
            # Take the first IP in the chain which is typically the client's real IP
            possible_client_ip = forwarded_for.split(',')[0].strip()
            
            # Check if this forwarded IP is a local network IP
            for network in local_networks:
                if possible_client_ip == network or (network.endswith('.') and possible_client_ip.startswith(network)):
                    is_local = True
                    break
        
        # Check if direct remote_addr is a local network IP if not already determined
        if not is_local:
            for network in local_networks:
                if remote_addr == network or (network.endswith('.') and remote_addr.startswith(network)):
                    is_local = True
                    break
                    
        if is_local:
            if not is_polling_endpoint:
                logger.debug(f"Local network access from {remote_addr} - Authentication bypassed! (Local Bypass Mode)")
            return None
        else:
            if not is_polling_endpoint:
                logger.warning(f"Access from {remote_addr} is not recognized as local network - Authentication required")
    
    # Check for valid session
    session_id = session.get(SESSION_COOKIE_NAME)
    if session_id and verify_session(session_id):
        if not is_polling_endpoint:
            pass  # Session valid - debug spam removed
        return None
    
    # Use less verbose logging for polling endpoints
    if is_polling_endpoint:
        # Only log occasionally for polling endpoints to reduce spam
        import random
        if random.random() < 0.1:  # Log only 10% of polling auth failures
            logger.debug(f"No valid session for polling endpoint '{request.path}', session_id: {session_id}")
    else:
        logger.debug(f"No valid session for path '{request.path}', session_id: {session_id}")
    
    # For API calls, return 401 Unauthorized
    if request.path.startswith("/api/"):
        # Return 401 with less verbose logging for polling endpoints
        if is_polling_endpoint:
            # Don't log every 401 for polling endpoints
            pass
        else:
            logger.debug(f"Returning 401 for API path '{request.path}'")
        return {"error": "Unauthorized"}, 401
    
    # No valid session, redirect to login
    if not is_polling_endpoint:
        logger.debug(f"Redirecting to login for path '{request.path}'")
    
    # Get the base URL from settings to ensure proper subpath redirect
    try:
        from src.primary.settings_manager import get_setting
        base_url = get_setting('general', 'base_url', '')
        if base_url and not base_url.startswith('/'):
            base_url = f'/{base_url}'
        if base_url and base_url.endswith('/'):
            base_url = base_url.rstrip('/')
        login_url = f"{base_url}/login" if base_url else "/login"
        logger.debug(f"Redirecting to login with base URL: {login_url}")
        return redirect(login_url)
    except Exception as e:
        logger.warning(f"Error getting base URL for login redirect: {e}")
        return redirect(url_for("common.login_route"))

def logout(session_id: str):
    """Log out the current user by invalidating their session"""
    if session_id and session_id in active_sessions:
        del active_sessions[session_id]
    
    # Clear the session cookie in Flask context (if available, otherwise handled by route)
    # session.pop(SESSION_COOKIE_NAME, None) # This might be better handled solely in the route

def is_2fa_enabled(username):
    """Check if 2FA is enabled for a user."""
    db = get_database()
    user_data = db.get_user_by_username(username)
    if user_data:
        return user_data.get("two_fa_enabled", False)
    return False

def generate_2fa_secret(username: str) -> Tuple[str, str]:
    """
    Generate a new 2FA secret and QR code
    
    Returns:
        Tuple[str, str]: (secret, qr_code_data_uri)
    """
    # Generate a random secret
    secret = pyotp.random_base32()
    
    # Create a TOTP object
    totp = pyotp.TOTP(secret)
    
    # Get the provisioning URI - Use the actual username here
    uri = totp.provisioning_uri(name=username, issuer_name="Huntarr")
    
    # Generate QR code
    qr = qrcode.QRCode(
        version=1,
        error_correction=qrcode.constants.ERROR_CORRECT_L,
        box_size=10,
        border=4,
    )
    qr.add_data(uri)
    qr.make(fit=True)
    
    try:
        img = qr.make_image(fill_color="black", back_color="white")
    
        # Convert to base64 string
        buffered = io.BytesIO()
        img.save(buffered, format="PNG")
        img_str = base64.b64encode(buffered.getvalue()).decode()
    
        # Store the secret temporarily associated with the user
        user_data = get_user_data(username)
        user_data["temp_2fa_secret"] = secret
        user_data["username"] = username  # Ensure username is set
        if save_user_data(user_data):
            logger.info(f"Generated temporary 2FA secret for user '{username}'.")
            return secret, f"data:image/png;base64,{img_str}"
        else:
            logger.error(f"Failed to save temporary 2FA secret for user '{username}'.")
            raise Exception("Failed to save user data with temporary 2FA secret.")
    
    except Exception as e:
        logger.error(f"Error generating 2FA QR code for user '{username}': {e}", exc_info=True)
        raise

def verify_2fa_code(username: str, code: str, enable_on_verify: bool = False) -> bool:
    """Verify a 2FA code against the appropriate secret (temporary for setup, permanent for enabled 2FA)"""
    try:
        db = get_database()
        user_data = db.get_user_by_username(username)
        
        if not user_data:
            logger.warning(f"2FA verification attempt for '{username}' failed: User not found.")
            return False
        
        # Check if 2FA is already enabled - use permanent secret
        if user_data.get("two_fa_enabled"):
            perm_secret = user_data.get("two_fa_secret")
            if not perm_secret:
                logger.warning(f"2FA verification attempt for '{username}' failed: 2FA enabled but no permanent secret found.")
                return False
            
            totp = pyotp.TOTP(perm_secret)
            # Add time window tolerance for better compatibility
            if totp.verify(code, valid_window=1):
                logger.info(f"2FA code verified successfully for user '{username}' using permanent secret.")
                return True
            else:
                logger.warning(f"Invalid 2FA code provided by user '{username}' for permanent secret. Code: {code}")
                return False
        
        # 2FA not enabled yet - use temporary secret for setup
        temp_secret = user_data.get("temp_2fa_secret")
        
        if not temp_secret:
            logger.warning(f"2FA verification attempt for '{username}' failed: No temporary secret found.")
            logger.debug(f"Available user data keys: {list(user_data.keys())}")
            return False
        
        totp = pyotp.TOTP(temp_secret)
        
        # Add time window tolerance for better compatibility
        if totp.verify(code, valid_window=1):
            logger.info(f"2FA code verified successfully for user '{username}' using temporary secret.")
            if enable_on_verify:
                # Enable 2FA permanently
                success = db.update_user_2fa(username, True, temp_secret)
                if success:
                    # Clear temporary secret
                    clear_success = db.update_user_temp_2fa_secret(username, None)
                    if clear_success:
                        logger.info(f"2FA enabled permanently for user '{username}' and temporary secret cleared.")
                    else:
                        logger.warning(f"2FA enabled for user '{username}' but failed to clear temporary secret.")
                else:
                    logger.error(f"Failed to save user data after enabling 2FA for '{username}'.")
                    return False
            return True
        else:
            logger.warning(f"Invalid 2FA code provided by user '{username}' for temporary secret. Code: {code}")
            # Add debugging info
            current_code = totp.now()
            logger.debug(f"Expected current code: {current_code}")
            return False
    except Exception as e:
        logger.error(f"Error during 2FA verification for '{username}': {e}", exc_info=True)
        return False

def disable_2fa(password: str) -> bool:
    """Disable 2FA for the current user (using only password - kept for potential other uses)"""
    user_data = get_user_data()
    
    # Verify password
    if verify_password(user_data.get("password", ""), password):
        user_data["2fa_enabled"] = False
        user_data["2fa_secret"] = None
        if save_user_data(user_data):
            logger.info("2FA disabled successfully (password only).")
            return True
        else:
            logger.error("Failed to save user data after disabling 2FA (password only).")
            return False
    else:
        logger.warning("Failed to disable 2FA (password only): Invalid password provided.")
        return False

def disable_2fa_with_password_and_otp(username: str, password: str, otp_code: str) -> bool:
    """Disable 2FA for the specified user, requiring both password and OTP code."""
    try:
        db = get_database()
        user_data = db.get_user_by_username(username)
        
        if not user_data:
            logger.warning(f"Failed to disable 2FA for '{username}': User not found.")
            return False
        
        # 1. Verify Password (stored in plain text according to memories)
        stored_password = user_data.get("password", "")
        if stored_password != password:
            logger.warning(f"Failed to disable 2FA for '{username}': Invalid password provided.")
            return False
            
        # 2. Verify OTP Code against permanent secret
        perm_secret = user_data.get("two_fa_secret")
        if not user_data.get("two_fa_enabled") or not perm_secret:
            logger.error(f"Failed to disable 2FA for '{username}': 2FA is not enabled or secret missing.")
            # Should ideally not happen if called from the correct UI state, but good to check
            return False 
            
        totp = pyotp.TOTP(perm_secret)
        # Add time window tolerance for better compatibility
        if not totp.verify(otp_code, valid_window=1):
            logger.warning(f"Failed to disable 2FA for '{username}': Invalid OTP code provided.")
            return False
            
        # 3. Both verified, proceed to disable
        success = db.update_user_2fa(username, False, None)
        if success:
            logger.info(f"2FA disabled successfully for '{username}' after verifying password and OTP.")
            return True
        else:
            logger.error(f"Failed to save user data after disabling 2FA for '{username}'.")
            return False
    except Exception as e:
        logger.error(f"Error during 2FA disable for '{username}': {e}", exc_info=True)
        return False

def change_username(current_username: str, new_username: str, password: str) -> bool:
    """Change the username for the current user"""
    from .utils.database import get_database
    
    db = get_database()
    
    # Get current user data from database
    user_data = db.get_user_by_username(current_username)
    if not user_data:
        logger.warning(f"Username change failed: User '{current_username}' not found in database.")
        return False
    
    # Verify current password (direct comparison as used in verify_user)
    if user_data.get("password") != password:
        logger.warning(f"Username change failed for '{current_username}': Invalid password provided.")
        return False
    
    # Update username in database
    if db.update_user_username(current_username, new_username):
        logger.info(f"Username changed successfully from '{current_username}' to '{new_username}'.")
        return True
    else:
        logger.error(f"Failed to update username in database for '{current_username}'.")
        return False

def change_password(current_password: str, new_password: str) -> bool:
    """Change the password for the current user"""
    from .utils.database import get_database
    
    # Get current username from session to identify the user
    from .routes.common import get_user_for_request
    username = get_user_for_request()
    if not username:
        logger.warning("Password change failed: No authenticated user found.")
        return False
    
    db = get_database()
    
    # Get current user data from database
    user_data = db.get_user_by_username(username)
    if not user_data:
        logger.warning(f"Password change failed: User '{username}' not found in database.")
        return False
    
    # Verify current password (direct comparison as used in verify_user)
    if user_data.get("password") != current_password:
        logger.warning(f"Password change failed for '{username}': Invalid current password provided.")
        return False
    
    # Update password in database (store new password directly, no hashing)
    if db.update_user_password(username, new_password):
        logger.info(f"Password changed successfully for user '{username}'.")
        return True
    else:
        logger.error(f"Failed to update password in database for '{username}'.")
        return False

def get_app_url_and_key(app_type: str) -> Tuple[str, str]:
    """
    Get the API URL and API key for a specific app type
    
    Args:
        app_type: The app type (sonarr, radarr, lidarr, readarr)
    
    Returns:
        Tuple[str, str]: (api_url, api_key)
    """
    from src.primary.settings_manager import load_settings
    settings = load_settings(app_type)
    if settings:
        api_url = settings.get('url', '')
        api_key = settings.get('api_key', '')
        return api_url, api_key
    return '', ''

def get_client_identifier() -> str:
    """Get or generate Plex Client Identifier"""
    global PLEX_CLIENT_IDENTIFIER
    if not PLEX_CLIENT_IDENTIFIER:
        PLEX_CLIENT_IDENTIFIER = str(uuid.uuid4())
        logger.info(f"Generated new Plex Client Identifier: {PLEX_CLIENT_IDENTIFIER}")
    return PLEX_CLIENT_IDENTIFIER

def create_plex_pin(setup_mode: bool = False, user_mode: bool = False) -> Optional[Dict[str, Union[str, int]]]:
    """
    Create a Plex PIN for authentication
    
    Args:
        setup_mode: If True, redirect to setup page
        user_mode: If True, redirect to user page
    
    Returns:
        Dict with pin details or None if failed
    """
    client_id = get_client_identifier()
    
    headers = {
        'accept': 'application/json',
        'X-Plex-Client-Identifier': client_id
    }
    
    data = {
        'strong': 'true',
        'X-Plex-Product': PLEX_PRODUCT_NAME,
        'X-Plex-Client-Identifier': client_id
    }
    
    try:
        response = requests.post('https://plex.tv/api/v2/pins', headers=headers, data=data)
        response.raise_for_status()
        pin_data = response.json()
        
        pin_id = pin_data['id']
        pin_code = pin_data['code']
        
        # Store PIN data with expiration
        active_plex_pins[pin_id] = {
            'code': pin_code,
            'created_at': time.time(),
            'expires_at': time.time() + 600  # 10 minutes
        }
        
        # Create auth URL with redirect URI for main window flow
        # Determine redirect based on mode
        base_url = request.host_url.rstrip('/') if request else 'http://localhost:9705'
        
        # Determine redirect based on mode
        if setup_mode:
            redirect_uri = f"{base_url}/setup"
        elif user_mode:
            redirect_uri = f"{base_url}/user"
        else:
            redirect_uri = f"{base_url}/"
        
        logger.info(f"Created Plex PIN: {pin_id} (setup_mode: {setup_mode}, user_mode: {user_mode})")
        logger.info(f"Plex redirect_uri set to: {redirect_uri}")
        
        # Use Plex hosted login URL with forward URL for redirect support
        # This is the correct Plex OAuth approach according to official documentation
        hosted_login_url = f"https://app.plex.tv/auth#?clientID={client_id}&code={pin_code}&context%5Bdevice%5D%5Bproduct%5D={PLEX_PRODUCT_NAME}&forwardUrl={redirect_uri}"
        
        return {
            'id': pin_id,
            'code': pin_code,
            'auth_url': hosted_login_url
        }
    except Exception as e:
        logger.error(f"Failed to create Plex PIN: {e}")
        return None

def check_plex_pin(pin_id: int) -> Optional[str]:
    """
    Check if a Plex PIN has been claimed and get the access token
    
    Args:
        pin_id: The PIN ID to check
        
    Returns:
        Optional[str]: Access token if PIN is claimed, None otherwise
    """
    if pin_id not in active_plex_pins:
        logger.warning(f"PIN {pin_id} not found in active pins")
        return None
        
    pin_data = active_plex_pins[pin_id]
    
    # Check if PIN has expired
    if time.time() > pin_data['expires_at']:
        logger.info(f"PIN {pin_id} has expired")
        del active_plex_pins[pin_id]
        return None
    
    client_id = get_client_identifier()
    pin_code = pin_data['code']
    
    headers = {
        'accept': 'application/json',
        'X-Plex-Client-Identifier': client_id
    }
    
    data = {
        'code': pin_code
    }
    
    try:
        response = requests.get(f'https://plex.tv/api/v2/pins/{pin_id}', headers=headers, params=data)
        response.raise_for_status()
        
        result = response.json()
        auth_token = result.get('authToken')
        
        if auth_token:
            logger.info(f"PIN {pin_id} successfully claimed")
            # Clean up the PIN
            del active_plex_pins[pin_id]
            return auth_token
        else:
            logger.debug(f"PIN {pin_id} not yet claimed")
            return None
            
    except Exception as e:
        logger.error(f"Failed to check Plex PIN {pin_id}: {e}")
        return None

def verify_plex_token(token: str) -> Optional[Dict[str, Any]]:
    """
    Verify a Plex access token and get user info
    
    Args:
        token: Plex access token
        
    Returns:
        Optional[Dict]: User info if token is valid, None otherwise
    """
    client_id = get_client_identifier()
    
    headers = {
        'accept': 'application/json',
        'X-Plex-Product': PLEX_PRODUCT_NAME,
        'X-Plex-Client-Identifier': client_id,
        'X-Plex-Token': token
    }
    
    try:
        response = requests.get('https://plex.tv/api/v2/user', headers=headers)
        
        if response.status_code == 200:
            user_data = response.json()
            logger.debug(f"Plex token verified for user: {user_data.get('username', 'unknown')}")
            return user_data
        elif response.status_code == 401:
            logger.warning("Invalid Plex token")
            return None
        else:
            logger.error(f"Error verifying Plex token: {response.status_code}")
            return None
            
    except Exception as e:
        logger.error(f"Failed to verify Plex token: {e}")
        return None

def create_user_with_plex(plex_token: str, plex_user_data: Dict[str, Any]) -> bool:
    """
    Create a new user with Plex authentication
    
    Args:
        plex_token: Plex access token
        plex_user_data: User data from Plex API
        
    Returns:
        bool: True if user created successfully
    """
    if user_exists():
        logger.warning("Attempted to create Plex user but local user already exists")
        return False
    
    user_data = {
        "auth_type": "plex",
        "plex_token": plex_token,
        "plex_user_id": plex_user_data.get('id'),
        "plex_username": plex_user_data.get('username'),
        "plex_email": plex_user_data.get('email'),
        "created_at": time.time(),
        "two_factor_enabled": False
    }
    
    try:
        if save_user_data(user_data):
            logger.info(f"Plex user created: {plex_user_data.get('username')}")
            return True
        else:
            logger.error("Failed to save Plex user data")
            return False
    except Exception as e:
        logger.error(f"Error creating Plex user: {e}")
        return False

def link_plex_account(username: str, password: str, plex_token: str, plex_user_data: Dict[str, Any]) -> bool:
    """
    Link a Plex account to an existing local user
    
    Args:
        username: Local username
        password: Local password for verification
        plex_token: Plex access token
        plex_user_data: User data from Plex API
        
    Returns:
        bool: True if account linked successfully
    """
    # Verify local credentials first
    auth_success, _ = verify_user(username, password)
    if not auth_success:
        logger.warning(f"Failed to link Plex account: Invalid local credentials for {username}")
        return False
    
    try:
        user_data = get_user_data()
        
        # Add Plex information to existing user
        user_data["plex_linked"] = True
        user_data["plex_token"] = plex_token
        user_data["plex_user_id"] = plex_user_data.get('id')
        user_data["plex_username"] = plex_user_data.get('username')
        user_data["plex_email"] = plex_user_data.get('email')
        user_data["plex_linked_at"] = time.time()
        
        if save_user_data(user_data):
            logger.info(f"Plex account linked to local user: {username}")
            return True
        else:
            logger.error("Failed to save linked Plex data")
            return False
            
    except Exception as e:
        logger.error(f"Error linking Plex account: {e}")
        return False

def verify_plex_user(plex_token: str) -> Tuple[bool, Optional[Dict[str, Any]]]:
    """
    Verify Plex user credentials and return user data
    
    Args:
        plex_token: Plex access token
        
    Returns:
        Tuple[bool, Optional[Dict]]: (success, plex_user_data)
    """
    plex_user_data = verify_plex_token(plex_token)
    if plex_user_data:
        return True, plex_user_data
    else:
        return False, None

def unlink_plex_from_user(username: str = None) -> bool:
    """
    Unlink Plex account from the current authenticated user by removing Plex-related data
    
    Args:
        username: Not used anymore - kept for compatibility
        
    Returns:
        bool: True if successful, False otherwise
    """
    try:
        if not user_exists():
            logger.error("No user exists")
            return False
            
        user_data = get_user_data()
        if not user_data:
            logger.error("Failed to get user data")
            return False
            
        # Check if Plex data exists to unlink
        if not user_data.get('plex_token'):
            logger.warning("No Plex account linked to unlink")
            return True  # Not an error, just nothing to do
            
        # If auth_type is plex, we need to handle this carefully
        if user_data.get('auth_type') == 'plex':
            # Check if user has a local password set
            if not user_data.get('password'):
                logger.error("Cannot unlink Plex from Plex-only user without local password. User must set a local password first.")
                raise Exception("Plex-only user must set a local password before unlinking Plex account")
        
        # Use database to update user and remove Plex data
        from src.primary.utils.database import HuntarrDatabase
        db = HuntarrDatabase()
        
        # Update user to remove Plex data
        success = db.update_user_plex(user_data['username'], None, None)
        
        if success:
            logger.info(f"Successfully unlinked Plex account from authenticated user")
            return True
        else:
            logger.error("Failed to unlink Plex account in database")
            return False
        
    except Exception as e:
        logger.error(f"Error unlinking Plex account: {str(e)}")
        raise  # Re-raise the exception so the route handler can catch it

def link_plex_account_session_auth(username: str, plex_token: str, plex_user_data: Dict[str, Any]) -> bool:
    """
    Link a Plex account to an existing local user using session authentication
    
    Args:
        username: Not used for validation - kept for compatibility
        plex_token: Plex access token
        plex_user_data: User data from Plex API
        
    Returns:
        bool: True if account linked successfully
    """
    try:
        user_data = get_user_data()
        
        # No need to validate username since user is already authenticated via session
        # Just proceed to add Plex information
        
        # Prepare Plex user data for storage - add linked timestamp
        plex_data_to_store = plex_user_data.copy()
        plex_data_to_store['linked_at'] = time.time()
        
        # Store Plex information using database schema fields
        user_data["plex_token"] = plex_token
        user_data["plex_user_data"] = plex_data_to_store
        
        if save_user_data(user_data):
            logger.info(f"Plex account linked to authenticated user - Plex username: {plex_user_data.get('username')}")
            return True
        else:
            logger.error("Failed to save linked Plex data")
            return False
            
    except Exception as e:
        logger.error(f"Error linking Plex account: {e}")
        return False