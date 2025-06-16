#!/usr/bin/env python3
"""
Windows Setup Helper for Huntarr
Assists with configuring Huntarr for Windows environments
"""

import os
import sys
import shutil
import subprocess
import ctypes
import winreg
import tempfile
import time
import traceback

def is_admin():
    """Check if the script is running with administrator privileges"""
    try:
        return ctypes.windll.shell32.IsUserAnAdmin() != 0
    except:
        return False

def setup_environment():
    """Set up Huntarr environment variables and paths"""
    # Determine the base config directory
    app_data = os.environ.get("APPDATA", os.path.expanduser("~"))
    config_dir = os.path.join(app_data, "Huntarr")
    
    # Create main directories
    directories = [
        os.path.join(config_dir),
        os.path.join(config_dir, "logs"),
        os.path.join(config_dir, "user"),
        os.path.join(config_dir, "settings"),
        os.path.join(config_dir, "stateful"),
        os.path.join(config_dir, "history"),
        os.path.join(config_dir, "scheduler"),
        os.path.join(config_dir, "reset"),
        os.path.join(config_dir, "tally"),
        os.path.join(config_dir, "eros")
    ]
    
    print(f"Setting up Huntarr configuration in: {config_dir}")
    
    for directory in directories:
        try:
            os.makedirs(directory, exist_ok=True)
            print(f"Created directory: {directory}")
        except Exception as e:
            print(f"Error creating directory {directory}: {e}")
    
    # Set environment variable
    try:
        set_environment_variable("HUNTARR_CONFIG_DIR", config_dir)
        print(f"Set HUNTARR_CONFIG_DIR environment variable to: {config_dir}")
    except Exception as e:
        print(f"Error setting environment variable: {e}")
    
    # Set permissions if admin
    if is_admin():
        set_directory_permissions(config_dir)
    else:
        print("Not running as admin - skipping permission setting.")
        print("Some features may not work correctly without proper permissions.")
    
    return config_dir

def set_environment_variable(name, value):
    """Set a persistent environment variable"""
    try:
        # User environment variable
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment", 0, winreg.KEY_ALL_ACCESS)
        winreg.SetValueEx(key, name, 0, winreg.REG_EXPAND_SZ, value)
        winreg.CloseKey(key)
        
        # Also set for current process
        os.environ[name] = value
        
        # Notify Windows of environment change
        subprocess.run(["rundll32", "user32.dll,UpdatePerUserSystemParameters"])
        return True
    except Exception as e:
        print(f"Error setting registry key: {e}")
        # Set for current process anyway
        os.environ[name] = value
        return False

def set_directory_permissions(directory):
    """Set appropriate permissions on directory and children"""
    if not is_admin():
        print("WARNING: Cannot set permissions without admin rights")
        return False
    
    try:
        # Use icacls to set permissions recursively
        subprocess.run(['icacls', directory, '/grant', 'Everyone:(OI)(CI)F', '/T'], 
                      check=True, capture_output=True)
        print(f"Set permissions on: {directory}")
        return True
    except Exception as e:
        print(f"Error setting permissions: {e}")
        return False

def check_requirements():
    """Check if all requirements for Huntarr are met"""
    print("Checking Windows requirements for Huntarr...")
    requirements_met = True
    
    # Check Python version
    python_version = sys.version_info
    print(f"Python version: {python_version.major}.{python_version.minor}.{python_version.micro}")
    if python_version.major < 3 or (python_version.major == 3 and python_version.minor < 9):
        print("WARNING: Huntarr requires Python 3.9 or higher")
        requirements_met = False
    
    # Check for pywin32
    try:
        import win32service
        print("pywin32 is installed")
    except ImportError:
        print("WARNING: pywin32 is not installed - Windows service features may not work")
        requirements_met = False
    
    # Check for waitress
    try:
        import waitress
        print("waitress is installed")
    except ImportError:
        print("WARNING: waitress is not installed - Web server may not function")
        requirements_met = False
    
    # Check port 9705 availability
    try:
        import socket
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        result = s.connect_ex(('127.0.0.1', 9705))
        s.close()
        if result == 0:
            print("WARNING: Port 9705 is already in use - Huntarr may not start correctly")
            requirements_met = False
        else:
            print("Port 9705 is available")
    except:
        print("Could not check port availability")
    
    return requirements_met

def create_test_file(directory):
    """Create a test file to verify write permissions"""
    test_path = os.path.join(directory, f"test_{int(time.time())}.tmp")
    try:
        with open(test_path, 'w') as f:
            f.write("Test write permissions")
        os.remove(test_path)
        return True
    except Exception as e:
        print(f"WARNING: Write test failed: {e}")
        return False

def main():
    """Main entry point"""
    print("Huntarr Windows Setup Helper")
    print("===========================")
    
    try:
        # Check if running as admin
        if is_admin():
            print("Running with administrator privileges")
        else:
            print("NOTE: Not running with administrator privileges")
            print("Some operations may fail without administrator rights")
        
        # Check requirements
        if check_requirements():
            print("All requirements met")
        else:
            print("Not all requirements are met - Huntarr may not function correctly")
        
        # Setup environment
        config_dir = setup_environment()
        
        # Test write permissions
        if create_test_file(config_dir):
            print("Write permissions verified")
        else:
            print("WARNING: Write permissions test failed")
            print("Huntarr may not function correctly without proper permissions")
        
        print("\nSetup complete!")
        print(f"Huntarr configuration directory: {config_dir}")
        return 0
    except Exception as e:
        print(f"Error during setup: {e}")
        print(traceback.format_exc())
        return 1

if __name__ == "__main__":
    sys.exit(main())
