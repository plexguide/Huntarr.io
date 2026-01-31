# Windows System Tray Implementation

## Overview
Huntarr includes a Windows system tray icon when run as a **normal application** in your user session. The tray icon does **not** appear when Huntarr runs as a Windows Service (Session 0 has no taskbar). To get the tray, run Huntarr at logon via a Startup shortcut (see "Run Huntarr so the tray appears" below).

## Features

### System Tray Icon Location
- Appears in the **notification area** (system tray) next to the clock, Bluetooth, network, and volume icons
- Does **NOT** appear as a window in the taskbar
- Uses the Huntarr logo as the icon

### Context Menu Options
Right-click the system tray icon to access:
1. **Open Huntarr** - Opens the web interface in your default browser (default action)
2. **About Huntarr** - Shows information about Huntarr
3. **Exit** - Cleanly shuts down Huntarr

### Double-Click Action
Double-click the system tray icon to quickly open the Huntarr web interface.

## Technical Implementation

### Components
- **`src/primary/windows_tray.py`** - System tray implementation (used by main app)
- **`distribution/windows/resources/system_tray.py`** - Legacy/standalone reference
- **`pystray`** library - Cross-platform system tray support
- Integrated into `main.py` when running as a normal Windows process (not as a service)

### How It Works
1. When Huntarr starts on Windows (non-debug mode), it automatically creates a system tray icon
2. The icon runs in a separate background thread
3. The web server and background tasks run normally
4. Users interact with Huntarr through the tray icon menu

### Icon Loading Priority
1. First tries: `frontend/static/logo/huntarr.ico`
2. Fallback: `frontend/static/logo/64.png`, `48.png`, or `32.png`
3. Final fallback: Generates a simple colored placeholder

## Building with System Tray Support

### Requirements
The system tray feature requires:
```
pystray==0.19.5 (Windows only)
Pillow (already included via qrcode[pil])
```

These are automatically included in `requirements.txt` for Windows builds.

### PyInstaller Configuration
The `huntarr.spec` file includes:
- `console=False` - Hides the console window
- System tray hidden imports: `pystray`, `pystray._win32`, `PIL`
- Distribution resources included in the bundle

### Building the Installer
```cmd
cd distribution\windows
python build.py
```

## User Experience

### Before (Old Behavior)
- Console window appears when Huntarr starts
- Takes up space in the taskbar
- Users complained about visible terminal

### After (New Behavior)
- No console window visible
- Small icon in system tray notification area
- Clean, professional appearance
- Easy access via right-click menu

## Compatibility

### Supported
- Windows 10 and later
- PyInstaller packaged executable
- Windows Service mode (tray icon not needed)

### Not Active When
- **Running as a Windows Service** – Services run in Session 0 and have no access to the taskbar or system tray. Use the Startup shortcut (see below) to run Huntarr in your user session so the tray appears.
- Running in debug mode (`DEBUG=true`)
- Running on non-Windows platforms (Linux, macOS)

## Run Huntarr so the tray appears

The tray icon only shows when Huntarr runs in your **user session** (e.g. double‑click exe or a shortcut that runs at logon). If you installed Huntarr as a Windows Service, it runs in Session 0 and the tray will never appear.

**Option 1 – PowerShell: add Startup shortcut (recommended)**  
From an elevated or user PowerShell, run:

```powershell
# If you built/installed Huntarr.exe (adjust path if needed):
cd "C:\Users\micro\OneDrive\Documents\GitHub\Huntarr.io\distribution\windows\scripts"
.\Install-TrayStartup.ps1 -HuntarrExePath "C:\Path\To\Huntarr.exe"

# If you run from source (Python):
.\Install-TrayStartup.ps1 -ProjectRoot "C:\Users\micro\OneDrive\Documents\GitHub\Huntarr.io"
```

This creates a shortcut in your **Startup** folder. At next logon, Huntarr starts as a normal app and the system tray icon appears.

**Option 2 – Installer (recommended for new installs)**  
The Windows installer (Inno Setup) offers the same pattern as [Sonarr’s Windows installer](https://github.com/Sonarr/Sonarr/blob/v5-develop/distribution/windows/setup/sonarr.iss): you choose **one** of:

- **Install Windows Service** – Starts with the computer; no system tray (runs in Session 0).
- **Create shortcut in Startup folder** – Starts when you log in; system tray icon will appear.
- **Do not start automatically** – You start Huntarr manually (tray appears when you run it).

Choosing “Create shortcut in Startup folder” creates a shortcut in your Startup folder and makes the tray the default way to run Huntarr.

**Option 3 – Manual**  
1. Do **not** start Huntarr as a service (or stop the service).  
2. Double‑click `Huntarr.exe` or run `python main.py` from the repo.  
3. The tray icon appears next to the clock.

## Testing

### Manual Testing
1. Build the Windows installer
2. Install and run Huntarr
3. Check system tray (notification area)
4. Right-click icon to test menu
5. Double-click to open web interface
6. Select "Exit" to cleanly shut down

### Logging
System tray events are logged to the main Huntarr log:
- `%APPDATA%\Huntarr\logs\huntarr.log`

Look for messages like:
```
[WebServer] Windows system tray icon initialized
[HuntarrSystemTray] Starting system tray icon...
[HuntarrSystemTray] System tray icon running
```

## Troubleshooting

### Icon Not Appearing
1. Check if pystray is installed: `pip list | findstr pystray`
2. Check logs for system tray errors
3. Verify icon files exist in the bundle

### Can't Exit Huntarr
1. Right-click system tray icon
2. Select "Exit"
3. If stuck, use Task Manager to end process

### Icon Shows Placeholder
- Huntarr logo files may be missing from the bundle
- Check PyInstaller data files configuration
- Placeholder icon will still function correctly

## Future Enhancements

Possible future additions:
- Quick status display in tooltip (e.g., "Running - 5 items processing")
- Pause/Resume functionality from tray menu
- Recent activity submenu
- Direct links to specific Arr apps
- Notification badges for errors or completion

## Related Files

- `distribution/windows/resources/system_tray.py` - Implementation
- `main.py` - Integration point (run_web_server function)
- `requirements.txt` - Dependency declaration
- `distribution/windows/huntarr.spec` - PyInstaller configuration
