#!/usr/bin/env python3
"""
Huntarr Windows Build Script
This script builds the Windows executable and installer for Huntarr.
"""

import os
import sys
import subprocess
import shutil
import argparse
from pathlib import Path

# Constants
SCRIPT_DIR = Path(os.path.dirname(os.path.abspath(__file__)))
ROOT_DIR = SCRIPT_DIR.parent.parent  # Navigate up two directories to project root

def run_command(cmd, cwd=None):
    """Run a command and return the result
    
    Args:
        cmd: Command list to run
        cwd: Current working directory for the command
    
    Returns:
        True if command succeeded, False otherwise
    """
    print(f"Running: {' '.join(cmd)}")
    result = subprocess.run(cmd, check=False, cwd=cwd)
    return result.returncode == 0

def build_exe():
    """Build the Windows executable using PyInstaller"""
    print("Building Huntarr Windows executable...")
    
    # Make sure PyInstaller is installed
    try:
        import PyInstaller
    except ImportError:
        print("PyInstaller not found. Installing...")
        run_command([sys.executable, "-m", "pip", "install", "pyinstaller"])
    
    # Make sure all requirements are installed
    run_command([sys.executable, "-m", "pip", "install", "-r", str(ROOT_DIR / "requirements.txt")])
    run_command([sys.executable, "-m", "pip", "install", "pywin32"])
    
    # Explicitly install apprise and its dependencies to ensure they're available
    run_command([sys.executable, "-m", "pip", "install", "apprise==1.6.0"])
    run_command([sys.executable, "-m", "pip", "install", "markdown==3.4.3"])
    run_command([sys.executable, "-m", "pip", "install", "pyyaml==6.0"])
    
    # Build using the spec file
    spec_file = SCRIPT_DIR / "huntarr.spec"
    
    # Verify the main.py file exists in the expected location
    main_file = ROOT_DIR / "main.py"
    if not main_file.exists():
        print(f"ERROR: Main file not found at {main_file}")
        print("Listing files in root directory:")
        for file in ROOT_DIR.glob("*"):
            print(f"  {file}")
        return False
    
    # Make sure we're in the project root directory when running PyInstaller
    # This helps with finding relative paths
    # Add the -y option to force overwrite of the output directory
    # Add --collect-all apprise to bundle all apprise data files and dependencies
    result = run_command([sys.executable, "-m", "PyInstaller", "-y", "--collect-all", "apprise", str(spec_file)], cwd=str(ROOT_DIR))
    
    if not result:
        print("ERROR: PyInstaller failed to build the executable")
        return False
        
    # Check if Huntarr.exe was created
    exe_path = ROOT_DIR / "dist" / "Huntarr" / "Huntarr.exe"
    if not exe_path.exists():
        print(f"ERROR: Executable not created at {exe_path}")
        return False
    
    print("Executable build complete.")
    return True

def build_installer():
    """Build the Windows installer using Inno Setup"""
    print("Building Huntarr Windows installer...")
    
    # Check if Inno Setup is installed
    inno_compiler = "C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe"
    if not os.path.exists(inno_compiler):
        print(f"ERROR: Inno Setup compiler not found at {inno_compiler}")
        print("Please install Inno Setup 6 from https://jrsoftware.org/isdl.php")
        return False
        
    # Check if the exe file was created by PyInstaller
    exe_path = ROOT_DIR / "dist" / "Huntarr" / "Huntarr.exe"
    if not exe_path.exists():
        print(f"ERROR: Executable not found at {exe_path}")
        print("PyInstaller did not create the executable. Please run build_exe() first.")
        return False
    
    # Create installer directory if it doesn't exist
    installer_dir = ROOT_DIR / "installer"
    os.makedirs(str(installer_dir), exist_ok=True)
    
    # Make sure the dist directory exists and has the expected structure
    dist_dir = ROOT_DIR / "dist" / "Huntarr"
    resources_dir = dist_dir / "resources"
    scripts_dir = dist_dir / "scripts"
    
    os.makedirs(str(resources_dir), exist_ok=True)
    os.makedirs(str(scripts_dir), exist_ok=True)
    
    # Copy resources and scripts if they don't exist in the dist directory
    src_resources = SCRIPT_DIR / "resources"
    src_scripts = SCRIPT_DIR / "scripts"
    
    if src_resources.exists():
        # Copy all files from resources directory
        for src_file in src_resources.glob("*"):
            dst_file = resources_dir / src_file.name
            if src_file.is_file():
                shutil.copy2(str(src_file), str(dst_file))
    
    if src_scripts.exists():
        # Copy all files from scripts directory
        for src_file in src_scripts.glob("*"):
            dst_file = scripts_dir / src_file.name
            if src_file.is_file():
                shutil.copy2(str(src_file), str(dst_file))
    
    # Copy the installer script to the root
    installer_script = SCRIPT_DIR / "installer" / "huntarr_installer.iss"
    target_script = ROOT_DIR / "huntarr_installer.iss"
    shutil.copy2(str(installer_script), str(target_script))
    
    # Ensure LICENSE file exists at the root
    license_path = ROOT_DIR / "LICENSE"
    if not license_path.exists():
        print(f"ERROR: LICENSE file not found at {license_path}")
        print("Checking for LICENSE file in other locations...")
        for possible_license in ROOT_DIR.glob("*LICENSE*"):
            print(f"  Found license-like file: {possible_license}")
        return False
    
    # Run the Inno Setup compiler
    result = run_command([inno_compiler, str(target_script)])
    
    # Check if the installer was created
    installer_path = ROOT_DIR / "installer" / "Huntarr_Setup.exe"
    if not installer_path.exists():
        print(f"ERROR: Installer not created at {installer_path}")
        print("The Inno Setup compiler failed to create the installer.")
        return False
    
    # Clean up
    if target_script.exists():
        target_script.unlink()
    
    print("Installer build complete.")
    return True

def clean():
    """Clean up build artifacts"""
    print("Cleaning up build artifacts...")
    
    # Remove PyInstaller build directories
    build_dir = ROOT_DIR / "build"
    dist_dir = ROOT_DIR / "dist"
    
    if build_dir.exists():
        shutil.rmtree(build_dir)
    
    if dist_dir.exists():
        shutil.rmtree(dist_dir)
    
    # Remove any .spec files in the root directory
    for spec_file in ROOT_DIR.glob("*.spec"):
        spec_file.unlink()
    
    print("Cleanup complete.")
    return True

def main():
    """Main entry point"""
    parser = argparse.ArgumentParser(description="Build Huntarr for Windows")
    parser.add_argument("--clean", action="store_true", help="Clean up build artifacts")
    parser.add_argument("--exe-only", action="store_true", help="Build only the executable, not the installer")
    parser.add_argument("--installer-only", action="store_true", help="Build only the installer, assuming executable is already built")
    
    args = parser.parse_args()
    
    if args.clean:
        clean()
        if not (args.exe_only or args.installer_only):
            return 0
    
    if args.installer_only:
        build_installer()
    elif args.exe_only:
        build_exe()
    else:
        # Build both
        if build_exe():
            build_installer()
    
    return 0

if __name__ == "__main__":
    sys.exit(main())
