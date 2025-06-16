#!/usr/bin/env python3
"""
Windows path configuration helper for Huntarr
Sets up proper config directories and permissions for Windows installations
"""

import os
import sys
import pathlib
import tempfile
import ctypes
import time
import subprocess

def is_admin():
    """Check if script is running with administrator privileges"""
    try:
        return ctypes.windll.shell32.IsUserAnAdmin() != 0
    except:
        return False

def setup_config_directories(base_dir=None):
    """
    Set up and verify all required Huntarr configuration directories
    
    Args:
        base_dir: Optional base directory, if None will use %APPDATA%\Huntarr
        
    Returns:
        tuple: (config_dir, success_flag)
    """
    # Determine config directory location
    if base_dir:
        config_dir = base_dir
    elif os.environ.get("HUNTARR_CONFIG_DIR"):
        config_dir = os.environ.get("HUNTARR_CONFIG_DIR")
    else:
        # Use Windows standard location
        config_dir = os.path.join(os.environ.get("APPDATA", os.path.expanduser("~")), "Huntarr")
    
    config_path = pathlib.Path(config_dir)
    success = True
    
    # Create required directories
    directories = [
        config_path,
        config_path / "logs",
        config_path / "user",
        config_path / "settings",
        config_path / "stateful",
        config_path / "history",
        config_path / "scheduler",
        config_path / "reset",
        config_path / "tally",
        config_path / "eros"
    ]
    
    print(f"Setting up Huntarr configuration in: {config_dir}")
    
    for directory in directories:
        try:
            directory.mkdir(exist_ok=True, parents=True)
            
            # Verify directory exists
            if not directory.exists():
                print(f"ERROR: Failed to create directory: {directory}")
                success = False
            else:
                # Test writability
                test_file = directory / f"config_test_{int(time.time())}.tmp"
                try:
                    with open(test_file, "w") as f:
                        f.write("Configuration test")
                    if test_file.exists():
                        test_file.unlink()  # Remove test file
                    else:
                        print(f"WARNING: Write test file was not created in {directory}")
                        success = False
                except Exception as e:
                    print(f"ERROR: Directory {directory} is not writable: {e}")
                    success = False
        except Exception as e:
            print(f"ERROR: Could not create or verify directory {directory}: {e}")
            success = False
    
    # Set permissions if we're running as admin
    if is_admin():
        try:
            # Use icacls to grant permissions
            subprocess.run(['icacls', str(config_path), '/grant', 'Everyone:(OI)(CI)F', '/T'], 
                          check=True, capture_output=True)
            print("Set permissions on config directory for all users")
        except Exception as e:
            print(f"WARNING: Could not set permissions on config directory: {e}")
    else:
        print("NOTE: Running without administrator privileges. Some permission settings skipped.")
    
    # Set environment variable
    os.environ["HUNTARR_CONFIG_DIR"] = str(config_path)
    os.environ["CONFIG_DIR"] = str(config_path)  # For backward compatibility
    
    return config_dir, success

def verify_service_config():
    """
    Verify service configuration and permissions
    
    Returns:
        bool: True if verification passed
    """
    # Only applicable on Windows
    if sys.platform != 'win32':
        return False
        
    config_dir, success = setup_config_directories()
    
    if not success:
        print("WARNING: Configuration directory setup had issues.")
        print("Some features of Huntarr may not work correctly.")
        
        # Try to fall back to a temporary directory if needed
        if not success:
            temp_dir = os.path.join(tempfile.gettempdir(), f"huntarr_config_{os.getpid()}")
            print(f"Attempting to use temporary directory: {temp_dir}")
            temp_config_dir, temp_success = setup_config_directories(temp_dir)
            
            if temp_success:
                print(f"Successfully using temporary directory: {temp_config_dir}")
                return True
    
    return success

if __name__ == "__main__":
    # When run directly, set up the config directories
    config_dir, success = setup_config_directories()
    
    if success:
        print("\nConfiguration directory setup completed successfully!")
        print(f"Huntarr config directory: {config_dir}")
    else:
        print("\nConfiguration directory setup had issues!")
        print("Please run this script as Administrator for best results.")
        sys.exit(1)
