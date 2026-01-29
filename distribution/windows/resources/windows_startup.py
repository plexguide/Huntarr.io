#!/usr/bin/env python3
"""
Windows Startup Helper for Huntarr
Provides Windows-specific initialization and error handling for clean startup
"""

import os
import sys
import json
import logging
import tempfile
import traceback
import pathlib
import time
import threading
import shutil
from functools import wraps

def windows_startup_check():
    """
    Perform Windows-specific startup checks and initialization
    
    This function should be called early in the startup process to ensure
    proper Windows compatibility and prevent 500 errors on startup.
    """
    logger = logging.getLogger("WindowsStartup")
    logger.info("Running Windows-specific startup checks...")
    
    # Verify Python path and sys.executable
    logger.info(f"Python executable: {sys.executable}")
    logger.info(f"Python paths: {sys.path}")
    
    # Check for key directories
    try:
        from src.primary.utils import config_paths
        logger.info(f"Using config directory: {config_paths.CONFIG_DIR}")
        
        # Ensure config directories are properly set up
        if not os.path.exists(config_paths.CONFIG_DIR):
            logger.warning(f"Config directory does not exist: {config_paths.CONFIG_DIR}")
            logger.info("Creating config directory...")
            os.makedirs(config_paths.CONFIG_DIR, exist_ok=True)
        
        # Test write access to config directory
        test_file = os.path.join(config_paths.CONFIG_DIR, f"windows_startup_test_{int(time.time())}.tmp")
        try:
            with open(test_file, "w") as f:
                f.write("Windows startup test")
            if os.path.exists(test_file):
                os.remove(test_file)
                logger.info("Config directory is writable")
            else:
                logger.warning("Config directory write test file could not be created")
        except Exception as e:
            logger.error(f"Config directory is not writable: {e}")
            logger.info("Attempting to create alternate config location...")
            
            # Try to create config in user's Documents folder as fallback
            alt_config = os.path.join(os.path.expanduser("~"), "Documents", "Huntarr")
            os.makedirs(alt_config, exist_ok=True)
            os.environ["HUNTARR_CONFIG_DIR"] = alt_config
            logger.info(f"Set alternate config directory: {alt_config}")
            
            # Create a test file in the alternate location
            test_file = os.path.join(alt_config, f"windows_startup_test_{int(time.time())}.tmp")
            try:
                with open(test_file, "w") as f:
                    f.write("Windows startup test (alternate location)")
                if os.path.exists(test_file):
                    os.remove(test_file)
                    logger.info("Alternate config directory is writable")
                else:
                    logger.warning("Alternate config directory write test file could not be created")
            except Exception as alt_err:
                logger.error(f"Alternate config directory is not writable: {alt_err}")
                # Last resort - use temp directory
                temp_dir = os.path.join(tempfile.gettempdir(), f"huntarr_config_{os.getpid()}")
                os.makedirs(temp_dir, exist_ok=True)
                os.environ["HUNTARR_CONFIG_DIR"] = temp_dir
                logger.info(f"Using temporary directory as last resort: {temp_dir}")
        
        # Windows-specific log copying logic
        try:
            # Get installation directory
            if getattr(sys, 'frozen', False):
                # PyInstaller bundle
                install_dir = os.path.dirname(sys.executable)
            else:
                # Regular Python execution
                install_dir = os.path.abspath(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
            
            install_log_dir = os.path.join(install_dir, "logs")
            appdata_log_dir = config_paths.LOG_DIR
            
            if os.path.exists(appdata_log_dir):
                logger.info(f"Copying logs from AppData ({appdata_log_dir}) to installation folder ({install_log_dir})")
                os.makedirs(install_log_dir, exist_ok=True)
                
                # Copy all log files
                for log_file in os.listdir(appdata_log_dir):
                    if log_file.endswith(".log") or ".log." in log_file:
                        src_path = os.path.join(appdata_log_dir, log_file)
                        dst_path = os.path.join(install_log_dir, log_file)
                        try:
                            # Use copy2 to preserve metadata, ignore errors if file is locked
                            shutil.copy2(src_path, dst_path)
                        except Exception as copy_err:
                            # This is common if the log file is currently being written to
                            logger.debug(f"Could not copy log file {log_file} (likely in use): {copy_err}")
        except Exception as log_copy_err:
            logger.warning(f"Failed to copy logs to installation folder: {log_copy_err}")
            
    except Exception as e:
        logger.error(f"Error during Windows startup check: {e}")
        logger.error(traceback.format_exc())

def patch_flask_paths(app):
    """
    Patch Flask paths to handle Windows-specific path issues
    
    This addresses issues with template and static file loading on Windows
    """
    logger = logging.getLogger("WindowsStartup")
    logger.info("Patching Flask paths for Windows compatibility...")
    
    # Get base directory
    if getattr(sys, 'frozen', False):
        # PyInstaller bundle
        base_dir = os.path.dirname(sys.executable)
    else:
        # Regular Python execution
        base_dir = os.path.abspath(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
    
    # Define template directory candidates
    template_candidates = [
        os.path.join(base_dir, 'frontend', 'templates'),
        os.path.join(base_dir, 'templates'),
        os.path.abspath(os.path.join(base_dir, '..', 'frontend', 'templates')),
    ]
    
    # Find the first existing template directory
    for template_dir in template_candidates:
        if os.path.exists(template_dir) and os.path.isdir(template_dir):
            logger.info(f"Setting Flask template folder to: {template_dir}")
            app.template_folder = template_dir
            break
    
    # Define static file candidates
    static_candidates = [
        os.path.join(base_dir, 'frontend', 'static'),
        os.path.join(base_dir, 'static'),
        os.path.abspath(os.path.join(base_dir, '..', 'frontend', 'static')),
    ]
    
    # Find the first existing static directory
    for static_dir in static_candidates:
        if os.path.exists(static_dir) and os.path.isdir(static_dir):
            logger.info(f"Setting Flask static folder to: {static_dir}")
            app.static_folder = static_dir
            break
    
    return app

def windows_exception_handler(func):
    """
    Decorator to catch and log Windows-specific exceptions
    This helps prevent 500 errors by providing better error handling
    """
    @wraps(func)
    def wrapper(*args, **kwargs):
        try:
            return func(*args, **kwargs)
        except PermissionError as e:
            logger = logging.getLogger("WindowsStartup")
            logger.error(f"Windows permission error in {func.__name__}: {e}")
            logger.error(traceback.format_exc())
            
            # Try to provide helpful error message for common Windows permission issues
            if "access is denied" in str(e).lower():
                logger.error("This appears to be a Windows permission issue. Try running as Administrator or check folder permissions.")
            
            return {"error": f"Windows permission error: {str(e)}"}, 500
        except Exception as e:
            logger = logging.getLogger("WindowsStartup")
            logger.error(f"Error in {func.__name__}: {e}")
            logger.error(traceback.format_exc())
            return {"error": str(e)}, 500
    
    return wrapper

def apply_windows_patches(app):
    """
    Apply all Windows-specific patches to the Flask app
    
    Args:
        app: The Flask application to patch
    
    Returns:
        The patched Flask app
    """
    # Run startup checks
    windows_startup_check()
    
    # Patch Flask paths
    app = patch_flask_paths(app)
    
    # Apply exception handler to key routes that might cause 500 errors
    for endpoint in ['home', 'logs_stream', 'api_settings', 'api_app_settings', 'api_app_status']:
        if hasattr(app.view_functions.get(endpoint, {}), '__call__'):
            app.view_functions[endpoint] = windows_exception_handler(app.view_functions[endpoint])
    
    return app
