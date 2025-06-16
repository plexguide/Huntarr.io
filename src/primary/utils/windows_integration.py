#!/usr/bin/env python3
"""
Windows Integration for Huntarr
Integrates Windows-specific helper functions with the main application
"""

import os
import sys
import platform
import logging
import importlib.util
from pathlib import Path

# Set up logger
logger = logging.getLogger("windows_integration")

# Check if running on Windows
IS_WINDOWS = platform.system() == "Windows"

def is_pyinstaller_bundle():
    """Check if running from a PyInstaller bundle"""
    return getattr(sys, 'frozen', False)

def integrate_windows_helpers(app=None):
    """
    Integrate Windows-specific helpers if running on Windows
    
    Args:
        app: Optional Flask application to patch
        
    Returns:
        The patched Flask app if provided, otherwise None
    """
    if not IS_WINDOWS:
        logger.debug("Not running on Windows, skipping Windows integration")
        return app
    
    logger.info("Windows platform detected, integrating Windows-specific helpers")
    
    try:
        # Attempt to import the Windows startup helper
        # First check if we're running from a PyInstaller bundle
        if is_pyinstaller_bundle():
            # When running from PyInstaller, the helpers should be in the executable's directory
            exe_dir = Path(sys.executable).parent
            
            # Check several possible locations
            windows_helpers_paths = [
                exe_dir / "resources" / "windows_startup.py",
                exe_dir / "distribution" / "windows" / "resources" / "windows_startup.py",
                exe_dir / "windows_startup.py"
            ]
            
            windows_helpers_module = None
            for path in windows_helpers_paths:
                if path.exists():
                    logger.info(f"Found Windows helpers at: {path}")
                    spec = importlib.util.spec_from_file_location("windows_startup", path)
                    windows_helpers_module = importlib.util.module_from_spec(spec)
                    spec.loader.exec_module(windows_helpers_module)
                    break
                    
            if windows_helpers_module is None:
                # Try creating a dynamic import from the embedded code
                logger.info("Windows helpers not found in standard locations, using embedded code")
                # The code will be embedded when the PyInstaller bundle is created
                
                # Run basic Windows startup check
                from src.primary.utils.config_paths import CONFIG_DIR, CONFIG_PATH
                logger.info(f"Using config directory: {CONFIG_DIR}")
                
                # Ensure paths are properly configured
                if app:
                    # Basic template and static path detection for Windows
                    base_dir = Path(sys.executable).parent
                    template_dir = base_dir / "frontend" / "templates"
                    static_dir = base_dir / "frontend" / "static"
                    
                    if template_dir.exists():
                        logger.info(f"Setting Flask template folder to: {template_dir}")
                        app.template_folder = str(template_dir)
                    
                    if static_dir.exists():
                        logger.info(f"Setting Flask static folder to: {static_dir}")
                        app.static_folder = str(static_dir)
        else:
            # When running from source code, check if the helper is in the distribution directory
            project_root = Path(__file__).parent.parent.parent.parent
            windows_helpers_path = project_root / "distribution" / "windows" / "resources" / "windows_startup.py"
            
            if windows_helpers_path.exists():
                logger.info(f"Found Windows helpers at: {windows_helpers_path}")
                spec = importlib.util.spec_from_file_location("windows_startup", windows_helpers_path)
                windows_helpers_module = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(windows_helpers_module)
                
                # If Flask app was provided, apply Windows patches
                if app and hasattr(windows_helpers_module, 'apply_windows_patches'):
                    app = windows_helpers_module.apply_windows_patches(app)
            else:
                logger.warning(f"Windows helpers not found at: {windows_helpers_path}")
                # Run basic checks regardless
                from src.primary.utils.config_paths import CONFIG_DIR
                logger.info(f"Using config directory: {CONFIG_DIR}")
    
    except Exception as e:
        logger.error(f"Error integrating Windows helpers: {e}", exc_info=True)
        # Continue execution to avoid crashing the application
    
    return app


def prepare_windows_environment():
    """
    Prepare Windows environment before application startup
    This runs without needing the Flask app object
    """
    if not IS_WINDOWS:
        return
    
    logger.info("Preparing Windows environment")
    
    try:
        # Create a special error log on the desktop for visibility
        desktop_path = os.path.join(os.path.expanduser("~"), "Desktop")
        if os.path.exists(desktop_path):
            error_log_path = os.path.join(desktop_path, "huntarr_startup.log")
            
            # Configure a file handler to log startup issues
            file_handler = logging.FileHandler(error_log_path)
            file_handler.setLevel(logging.INFO)
            formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
            file_handler.setFormatter(formatter)
            
            # Add the handler to the root logger
            root_logger = logging.getLogger()
            root_logger.addHandler(file_handler)
            
            logger.info(f"Logging Windows startup info to: {error_log_path}")
        
        # Ensure key directories exist
        from src.primary.utils.config_paths import CONFIG_DIR, LOG_DIR
        
        # Double-check that directories were created correctly
        os.makedirs(CONFIG_DIR, exist_ok=True)
        os.makedirs(LOG_DIR, exist_ok=True)
        
        # Test write permissions
        for directory in [CONFIG_DIR, LOG_DIR]:
            test_file = os.path.join(directory, f"windows_test.tmp")
            try:
                with open(test_file, "w") as f:
                    f.write("Windows environment test")
                os.remove(test_file)
                logger.info(f"Successfully verified write access to: {directory}")
            except Exception as e:
                logger.error(f"Cannot write to {directory}: {e}")
                
                # Try to create a fallback location if this is the config directory
                if directory == CONFIG_DIR:
                    fallback_dir = os.path.join(os.path.expanduser("~"), "Documents", "Huntarr")
                    logger.info(f"Attempting to use fallback location: {fallback_dir}")
                    os.makedirs(fallback_dir, exist_ok=True)
                    os.environ["HUNTARR_CONFIG_DIR"] = fallback_dir
    
    except Exception as e:
        logger.error(f"Error preparing Windows environment: {e}", exc_info=True)
