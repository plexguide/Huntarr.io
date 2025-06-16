# Huntarr.io macOS Installer Guide

## Overview

Huntarr.io now provides native macOS installers alongside the primary Docker deployment method. The macOS installers are automatically built and published through GitHub Actions whenever changes are pushed to the repository.

## Available Installers

Two types of macOS installers are generated:

1. **Intel (x86_64)** - For Intel-based Macs
2. **ARM (arm64)** - For Apple Silicon Macs (M1, M2, etc.)

## Installation

1. Download the appropriate installer package (.pkg) for your Mac from the [GitHub Releases](https://github.com/plexguide/Huntarr.io/releases) page.
2. Double-click the downloaded .pkg file to start the installation process.
3. Follow the on-screen instructions to complete the installation.
4. The application will be installed in your `/Applications` folder.

## Configuration

When first launched, Huntarr.io will create the necessary configuration directories:

```
~/Library/Application Support/Huntarr/config/
├── logs/
├── settings/
├── stateful/
└── user/
```

This structure mirrors the Docker container's `/config` directory structure.

## Differences from Docker Version

The macOS application functions similarly to the Docker version with a few key differences:

1. Data is stored in the user's Application Support folder instead of a Docker volume
2. The app runs as a native macOS application rather than in a container
3. System requirements are tied to macOS version and architecture rather than Docker

## Troubleshooting

If you encounter issues:

1. Check the logs database at `~/Library/Application Support/Huntarr/config/logs.db`
2. Ensure proper permissions for the application folders
3. Verify your macOS version is compatible (macOS 10.15 Catalina or newer recommended)

## Notes

- The Docker version remains the primary supported deployment method
- The macOS version is provided as a convenience for users who prefer native applications
- Both Intel and ARM versions are built with the same codebase but optimized for each architecture

## Build Process

The macOS installers are built automatically using GitHub Actions with the following process:

1. Python 3.9 environment is set up on a macOS runner
2. The Huntarr.io icon is converted to macOS .icns format
3. PyInstaller bundles the application into a native macOS .app
4. A PKG installer is created using macOS pkgbuild
5. The installer is uploaded as an artifact and attached to GitHub releases

The build process handles both Intel (x86_64) and ARM (arm64) architectures separately to ensure optimal performance on each platform.
