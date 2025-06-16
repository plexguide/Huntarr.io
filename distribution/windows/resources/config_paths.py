#!/usr/bin/env python3
"""
Windows-specific path configuration for Huntarr
Handles path resolution for Windows installations
"""

import os
import sys
import pathlib
import tempfile
import platform
import time
import ctypes

# Verify we're running on Windows
OS_TYPE = platform.system()
IS_WINDOWS = (OS_TYPE == "Windows")

# Get configuration directory - prioritize environment variable
CONFIG_DIR = os.environ.get("HUNTARR_CONFIG_DIR")

if not CONFIG_DIR:
    # Windows default location in %APPDATA%
    if IS_WINDOWS:
        CONFIG_DIR = os.path.join(os.environ.get("APPDATA", os.path.expanduser("~")), "Huntarr")
    else:
        # Fallback for non-Windows (should never happen in this Windows-specific file)
        CONFIG_DIR = os.path.join(os.path.expanduser("~"), ".config", "huntarr")

# Initialize the directory structure
CONFIG_PATH = pathlib.Path(CONFIG_DIR)

# Create the main directory if it doesn't exist
try:
    CONFIG_PATH.mkdir(parents=True, exist_ok=True)
    print(f"Using configuration directory: {CONFIG_DIR}")
    
    # Check write permissions with a test file
    test_file = CONFIG_PATH / f"write_test_{int(time.time())}.tmp"
    try:
        with open(test_file, "w") as f:
            f.write("test")
        if test_file.exists():
            test_file.unlink()  # Remove the test file
    except Exception as e:
        print(f"Warning: Config directory exists but is not writable: {str(e)}")
        # If running on Windows, check if admin privileges might help
        if IS_WINDOWS:
            try:
                if not ctypes.windll.shell32.IsUserAnAdmin():
                    print("You are not running with administrator privileges, which might affect permissions.")
                    print("Consider running as administrator or using the service installation option.")
            except Exception:
                pass
except Exception as e:
    print(f"Warning: Could not create or write to config directory at {CONFIG_DIR}: {str(e)}")
    # Fall back to temp directory as last resort
    temp_base = tempfile.gettempdir()
    CONFIG_DIR = os.path.join(temp_base, f"huntarr_config_{os.getpid()}")
    CONFIG_PATH = pathlib.Path(CONFIG_DIR)
    CONFIG_PATH.mkdir(parents=True, exist_ok=True)
    print(f"Using temporary config directory: {CONFIG_DIR}")
    
    # Write warning to a log file in a location that should be writable
    try:
        desktop_path = os.path.join(os.path.expanduser("~"), "Desktop")
        if os.path.exists(desktop_path):
            desktop_log = os.path.join(desktop_path, "huntarr_error.log")
            with open(desktop_log, "a") as f:
                f.write(f"\n[{time.strftime('%Y-%m-%d %H:%M:%S')}] Using temporary config directory: {CONFIG_DIR}\n")
                f.write(f"Original error accessing primary config: {str(e)}\n")
    except Exception:
        pass

# Create standard directories - only the ones we actually use
LOG_DIR = CONFIG_PATH / "logs"

# Create all directories with enhanced error reporting
for dir_path in [LOG_DIR]:
    try:
        dir_path.mkdir(parents=True, exist_ok=True)
        
        # Test write access
        test_file = dir_path / f"write_test_{int(time.time())}.tmp"
        try:
            with open(test_file, "w") as f:
                f.write("test")
            if test_file.exists():
                test_file.unlink()  # Remove the test file
        except Exception as write_err:
            print(f"WARNING: Directory {dir_path} exists but write test failed: {write_err}")
    except Exception as e:
        print(f"ERROR: Could not create directory {dir_path}: {str(e)}")

# Set environment variables for backwards compatibility
os.environ["HUNTARR_CONFIG_DIR"] = str(CONFIG_PATH)
os.environ["CONFIG_DIR"] = str(CONFIG_PATH)  # For backward compatibility


# Helper functions to get paths
def get_path(*args):
    """Get a path relative to the config directory"""
    return CONFIG_PATH.joinpath(*args)

# Legacy JSON config path functions removed - all settings now stored in database
# Reset file functions removed - all reset requests now stored in database
