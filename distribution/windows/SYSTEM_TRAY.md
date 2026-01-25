# Windows System Tray Implementation

## Overview
Huntarr now includes a Windows system tray icon that allows it to run silently in the background without cluttering the taskbar.

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
- **`distribution/windows/resources/system_tray.py`** - Main system tray implementation
- **`pystray`** library - Cross-platform system tray support
- Integrated into `main.py` for Windows builds

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
- Running in debug mode (`DEBUG=true`)
- Running as a Windows Service (already background)
- Running on non-Windows platforms (Linux, macOS)

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
