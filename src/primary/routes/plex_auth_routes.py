#!/usr/bin/env python3
"""
Plex authentication routes for Huntarr
Handles Plex OAuth PIN-based authentication flow
"""

from flask import Blueprint, request, jsonify, session, redirect, url_for
from src.primary.auth import (
    create_plex_pin, check_plex_pin, verify_plex_token, create_user_with_plex,
    link_plex_account, verify_plex_user, create_session, user_exists,
    SESSION_COOKIE_NAME, verify_user, unlink_plex_from_user, get_client_identifier,
    verify_session, get_username_from_session, link_plex_account_session_auth
)
from src.primary.utils.logger import logger
import time
import requests

# Create blueprint for Plex authentication routes
plex_auth_bp = Blueprint('plex_auth', __name__)

@plex_auth_bp.route('/api/auth/plex/pin', methods=['POST'])
def create_pin():
    """Create a new Plex PIN for authentication"""
    try:
        # Check if we're in setup mode or user mode
        setup_mode = False
        user_mode = False
        if request.json:
            setup_mode = request.json.get('setup_mode', False)
            user_mode = request.json.get('user_mode', False)
        
        # Add debugging
        logger.info(f"create_pin called with setup_mode: {setup_mode}, user_mode: {user_mode}, request.json: {request.json}")
        
        pin_data = create_plex_pin(setup_mode=setup_mode, user_mode=user_mode)
        if pin_data:
            logger.info(f"PIN created successfully: {pin_data['id']}, auth_url: {pin_data['auth_url']}")
            return jsonify({
                'success': True,
                'pin_id': pin_data['id'],
                'auth_url': pin_data['auth_url']
            })
        else:
            logger.error("Failed to create Plex PIN")
            return jsonify({
                'success': False,
                'error': 'Failed to create PIN'
            }), 500
    except Exception as e:
        logger.error(f"Error creating Plex PIN: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@plex_auth_bp.route('/api/auth/plex/check/<int:pin_id>', methods=['GET'])
def check_pin(pin_id):
    """Check if a Plex PIN has been claimed"""
    try:
        token = check_plex_pin(pin_id)
        if token:
            # Verify the token and get user data
            plex_user_data = verify_plex_token(token)
            if plex_user_data:
                return jsonify({
                    'success': True,
                    'claimed': True,
                    'token': token,
                    'user_data': {
                        'username': plex_user_data.get('username'),
                        'email': plex_user_data.get('email'),
                        'id': plex_user_data.get('id')
                    }
                })
            else:
                return jsonify({
                    'success': False,
                    'error': 'Invalid Plex token'
                }), 400
        else:
            return jsonify({
                'success': True,
                'claimed': False
            })
    except Exception as e:
        logger.error(f"Error checking Plex PIN {pin_id}: {e}")
        return jsonify({
            'success': False,
            'error': 'Internal server error'
        }), 500

@plex_auth_bp.route('/api/auth/plex/oauth', methods=['POST'])
def handle_oauth():
    """Handle Plex OAuth callback with authorization code"""
    try:
        data = request.get_json()
        auth_code = data.get('code')
        state = data.get('state')  # This should contain our PIN ID
        
        if not auth_code or not state:
            return jsonify({
                'success': False,
                'error': 'Missing authorization code or state'
            }), 400
        
        # Exchange OAuth code for access token
        client_id = get_client_identifier()
        
        # Plex OAuth token exchange
        token_data = {
            'code': auth_code,
            'client_id': client_id,
            'grant_type': 'authorization_code'
        }
        
        headers = {
            'Accept': 'application/json',
            'X-Plex-Client-Identifier': client_id
        }
        
        response = requests.post('https://plex.tv/api/v2/oauth/token', 
                               data=token_data, headers=headers)
        
        if response.status_code == 200:
            token_response = response.json()
            access_token = token_response.get('access_token')
            
            if access_token:
                # Verify the token and get user data
                plex_user_data = verify_plex_token(access_token)
                if plex_user_data:
                    return jsonify({
                        'success': True,
                        'token': access_token,
                        'user': plex_user_data
                    })
        
        return jsonify({
            'success': False,
            'error': 'Failed to exchange OAuth code for token'
        }), 400
        
    except Exception as e:
        logger.error(f"Error handling Plex OAuth: {e}")
        return jsonify({
            'success': False,
            'error': 'Internal server error'
        }), 500

@plex_auth_bp.route('/api/auth/plex/oauth/callback', methods=['POST'])
def handle_oauth_callback():
    """Handle Plex OAuth callback for login flow"""
    try:
        data = request.get_json()
        auth_code = data.get('code')
        state = data.get('state')
        
        if not auth_code or not state:
            return jsonify({
                'success': False,
                'error': 'Missing authorization code or state'
            }), 400
        
        # Exchange OAuth code for access token
        client_id = get_client_identifier()
        
        token_data = {
            'code': auth_code,
            'client_id': client_id,
            'grant_type': 'authorization_code'
        }
        
        headers = {
            'Accept': 'application/json',
            'X-Plex-Client-Identifier': client_id
        }
        
        response = requests.post('https://plex.tv/api/v2/oauth/token', 
                               data=token_data, headers=headers)
        
        if response.status_code == 200:
            token_response = response.json()
            access_token = token_response.get('access_token')
            
            if access_token:
                # Verify the token and get user data
                plex_user_data = verify_plex_token(access_token)
                if plex_user_data:
                    # Check if this Plex account exists in our system
                    if user_exists(plex_user_data['username']):
                        # Login existing user
                        session_id = create_session(plex_user_data['username'])
                        session[SESSION_COOKIE_NAME] = session_id
                        
                        return jsonify({
                            'success': True,
                            'message': 'Login successful',
                            'user': plex_user_data,
                            'redirect': './'
                        })
                    else:
                        return jsonify({
                            'success': False,
                            'error': 'Plex account not linked. Please create an account first.'
                        }), 404
        
        return jsonify({
            'success': False,
            'error': 'Failed to authenticate with Plex'
        }), 400
        
    except Exception as e:
        logger.error(f"Error handling Plex OAuth callback: {e}")
        return jsonify({
            'success': False,
            'error': 'Internal server error'
        }), 500

@plex_auth_bp.route('/api/auth/plex/login', methods=['POST'])
def plex_login():
    """Login with Plex token (for first-time setup or Plex-only users)"""
    try:
        data = request.json
        plex_token = data.get('token')
        
        if not plex_token:
            return jsonify({
                'success': False,
                'error': 'Plex token is required'
            }), 400
        
        # Verify Plex token
        success, plex_user_data = verify_plex_user(plex_token)
        if not success:
            return jsonify({
                'success': False,
                'error': 'Invalid Plex token'
            }), 401
        
        # Check if a local user already exists
        if not user_exists():
            # Create new Plex-only user
            if create_user_with_plex(plex_token, plex_user_data):
                # Create session
                session_id = create_session(plex_user_data.get('username'))
                
                response = jsonify({
                    'success': True,
                    'message': 'Plex user created and logged in successfully',
                    'auth_type': 'plex',
                    'redirect': './'
                })
                session[SESSION_COOKIE_NAME] = session_id  # Store in Flask session
                response.set_cookie(SESSION_COOKIE_NAME, session_id, 
                                  max_age=60*60*24*7, httponly=True, secure=False)
                return response
            else:
                return jsonify({
                    'success': False,
                    'error': 'Failed to create Plex user'
                }), 500
        else:
            # User exists - check if they have Plex authentication configured
            from src.primary.utils.database import get_database
            db = get_database()
            user_data = db.get_first_user()  # Get the existing user
            
            if user_data and user_data.get('plex_token'):
                # Check if this is the same Plex user
                stored_plex_data = user_data.get('plex_user_data', {})
                if stored_plex_data.get('id') == plex_user_data.get('id'):
                    # Update token in case it changed
                    db.update_user_plex(user_data['username'], plex_token, plex_user_data)
                    
                    # Create session
                    username = user_data['username']
                    session_id = create_session(username)
                    
                    response = jsonify({
                        'success': True,
                        'message': 'Logged in with Plex successfully',
                        'auth_type': 'plex',
                        'redirect': './'
                    })
                    session[SESSION_COOKIE_NAME] = session_id  # Store in Flask session
                    response.set_cookie(SESSION_COOKIE_NAME, session_id, 
                                      max_age=60*60*24*7, httponly=True, secure=False)
                    return response
                else:
                    return jsonify({
                        'success': False,
                        'error': 'This Plex account is not linked to this Huntarr instance'
                    }), 403
            else:
                return jsonify({
                    'success': False,
                    'error': 'Local user exists. Please link your Plex account in user settings.'
                }), 409
                
    except Exception as e:
        logger.error(f"Error during Plex login: {e}")
        return jsonify({
            'success': False,
            'error': 'Internal server error'
        }), 500

@plex_auth_bp.route('/api/auth/plex/link', methods=['POST'])
def link_account():
    """Link Plex account to existing local user"""
    try:
        data = request.json
        username = data.get('username')
        plex_token = data.get('token')
        oauth_code = data.get('code')
        oauth_state = data.get('state')
        setup_mode = data.get('setup_mode', False)
        
        # Handle setup mode differently - user might not have valid session
        if setup_mode:
            # In setup mode, just get the user data without username validation
            # Since Huntarr is single-user, we don't need to validate specific usernames
            from src.primary.auth import get_user_data
            user_data = get_user_data()
            
            if not user_data:
                return jsonify({'success': False, 'error': 'No user found in system'}), 400
                
            # Use the actual username from the database
            authenticated_username = user_data.get('username')
        else:
            # Normal mode - require session authentication
            session_id = session.get(SESSION_COOKIE_NAME)
            if not session_id or not verify_session(session_id):
                return jsonify({'success': False, 'error': 'User not authenticated'}), 401
            
            # Get username from session
            authenticated_username = get_username_from_session(session_id)
            if not authenticated_username:
                return jsonify({'success': False, 'error': 'Unable to determine username from session'}), 400
        
        # Handle OAuth code if provided
        if oauth_code and oauth_state:
            # Exchange OAuth code for access token
            client_id = get_client_identifier()
            
            token_data = {
                'code': oauth_code,
                'client_id': client_id,
                'grant_type': 'authorization_code'
            }
            
            headers = {
                'Accept': 'application/json',
                'X-Plex-Client-Identifier': client_id
            }
            
            response = requests.post('https://plex.tv/api/v2/oauth/token', 
                                   data=token_data, headers=headers)
            
            if response.status_code == 200:
                token_response = response.json()
                plex_token = token_response.get('access_token')
                
                if not plex_token:
                    return jsonify({
                        'success': False,
                        'error': 'Failed to get access token from OAuth code'
                    }), 400
            else:
                return jsonify({
                    'success': False,
                    'error': 'Failed to exchange OAuth code for token'
                }), 400
        elif not plex_token:
            return jsonify({
                'success': False,
                'error': 'Either Plex token or OAuth code is required'
            }), 400
        
        # Verify Plex token
        success, plex_user_data = verify_plex_user(plex_token)
        if not success:
            return jsonify({
                'success': False,
                'error': 'Invalid Plex token'
            }), 401
        
        # Link accounts using session-based authentication
        if link_plex_account_session_auth(authenticated_username, plex_token, plex_user_data):
            # In setup mode, create a new session for the user so they can continue setup
            if setup_mode:
                session_id = create_session(authenticated_username)
                session[SESSION_COOKIE_NAME] = session_id
                response = jsonify({
                    'success': True,
                    'message': 'Plex account linked successfully'
                })
                response.set_cookie(SESSION_COOKIE_NAME, session_id, httponly=True, samesite='Lax', path='/')
                return response
            else:
                return jsonify({
                    'success': True,
                    'message': 'Plex account linked successfully'
                })
        else:
            return jsonify({
                'success': False,
                'error': 'Failed to link Plex account'
            }), 500
            
    except Exception as e:
        logger.error(f"Error linking Plex account: {e}")
        return jsonify({
            'success': False,
            'error': 'Internal server error'
        }), 500

@plex_auth_bp.route('/api/auth/plex/unlink', methods=['POST'])
def unlink_plex_account():
    """Unlink Plex account from local user"""
    try:
        # Check if user is authenticated via session
        session_id = request.cookies.get(SESSION_COOKIE_NAME)
        if not session_id or not verify_session(session_id):
            return jsonify({'success': False, 'error': 'User not authenticated'}), 401
        
        # Since user is authenticated, we can directly unlink without username validation
        if unlink_plex_from_user():
            return jsonify({'success': True, 'message': 'Plex account unlinked successfully'})
        else:
            return jsonify({'success': False, 'error': 'Failed to unlink Plex account'}), 500
            
    except Exception as e:
        logger.error(f"Error unlinking Plex account: {str(e)}")
        # Check if this is the specific Plex-only user error
        if "Plex-only user must set a local password" in str(e):
            return jsonify({
                'success': False, 
                'error': 'You must set a local password before unlinking your Plex account. Please set a password in the account settings first.'
            }), 400
        else:
            return jsonify({'success': False, 'error': 'Internal server error'}), 500

@plex_auth_bp.route('/api/auth/plex/status', methods=['GET'])
def plex_status():
    """Get Plex authentication status for current user"""
    try:
        from src.primary.utils.database import get_database
        db = get_database()
        user_data = db.get_first_user()  # Get the user from database
        
        if not user_data:
            return jsonify({
                'success': False,
                'error': 'No user found'
            }), 404
        
        # Check if Plex is linked by looking for plex_token
        plex_token = user_data.get('plex_token')
        plex_user_data = user_data.get('plex_user_data', {})
        plex_linked = bool(plex_token)
        
        # Determine auth type - if user has plex_token, they can use plex auth
        auth_type = 'plex' if plex_linked else 'local'
        
        response_data = {
            'success': True,
            'plex_linked': plex_linked,
            'auth_type': auth_type
        }
        
        if plex_linked:
            # Get the linked timestamp from the database
            plex_linked_at = user_data.get('plex_linked_at')
            
            response_data.update({
                'plex_username': plex_user_data.get('username', 'Unknown'),
                'plex_email': plex_user_data.get('email', 'Unknown'),
                'plex_linked_at': plex_linked_at
            })
        
        return jsonify(response_data)
        
    except Exception as e:
        logger.error(f"Error getting Plex status: {e}")
        return jsonify({
            'success': False,
            'error': 'Internal server error'
        }), 500

@plex_auth_bp.route('/auth/plex/callback')
def plex_callback():
    """Handle Plex authentication callback (redirect back to app)"""
    # Redirect to main page with user hash to avoid index.html redirect conflicts
    # This ensures proper navigation without triggering localStorage redirects
    return redirect('/#user')
