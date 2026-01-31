"""
Windows system tray icon for Huntarr.
Provides Open Huntarr and Quit from the notification area.
Only used when running on Windows (GUI mode, not as a service).
"""

import os
import sys
import threading
import webbrowser
import logging

logger = logging.getLogger("Huntarr")

# Default port; matches main.py
DEFAULT_PORT = int(os.environ.get("HUNTARR_PORT", os.environ.get("PORT", 9705)))


def _get_stop_event():
    """Get the shared stop_event from background module (works from src or frozen)."""
    try:
        from src.primary.background import stop_event
        return stop_event
    except Exception:
        try:
            from primary.background import stop_event
            return stop_event
        except Exception:
            return None


def _icon_path():
    """Path to icon for the system tray (ICO or PNG)."""
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        base = sys._MEIPASS
    else:
        base = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    # Prefer ICO on Windows
    ico = os.path.join(base, "frontend", "static", "logo", "huntarr.ico")
    if os.path.isfile(ico):
        return ico
    for name in ("64.png", "48.png", "32.png"):
        path = os.path.join(base, "frontend", "static", "logo", name)
        if os.path.isfile(path):
            return path
    return None


def _create_icon_image(path):
    """Load image for pystray; pystray on Windows can use file path or PIL Image."""
    try:
        from PIL import Image
        if path and os.path.isfile(path):
            return Image.open(path)
        # Fallback placeholder
        return Image.new("RGB", (64, 64), color=(255, 127, 0))
    except Exception as e:
        logger.warning("Could not load tray icon: %s", e)
        try:
            from PIL import Image
            return Image.new("RGB", (64, 64), color=(255, 127, 0))
        except Exception:
            return None


def run_tray(port=DEFAULT_PORT):
    """Run the Windows system tray icon. Blocking; call from a dedicated thread."""
    try:
        import pystray
    except ImportError:
        logger.warning("pystray not installed; system tray will not be shown")
        return

    stop_ev = _get_stop_event()
    icon_path = _icon_path()
    image = _create_icon_image(icon_path)
    if image is None:
        logger.warning("No tray icon image available")
        return

    def open_huntarr_cb(icon=None, item=None):
        webbrowser.open(f"http://127.0.0.1:{port}")

    def quit_cb(icon=None, item=None):
        if stop_ev and not stop_ev.is_set():
            stop_ev.set()
            logger.info("System tray requested quit; stop_event set")
        if icon:
            icon.stop()

    menu = pystray.Menu(
        pystray.MenuItem("Open Huntarr", open_huntarr_cb, default=True),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Quit", quit_cb),
    )
    tray_icon = pystray.Icon(
        "Huntarr",
        image,
        "Huntarr - Media Management",
        menu,
    )
    logger.info("Starting Windows system tray icon")
    tray_icon.run()


def start_windows_tray(port=DEFAULT_PORT):
    """Start the Windows system tray in a background thread. Non-blocking."""
    try:
        import pystray
    except ImportError:
        logger.warning("pystray not installed; system tray will not be shown")
        return False
    t = threading.Thread(
        target=run_tray,
        args=(port,),
        name="WindowsSystemTray",
        daemon=True,
    )
    t.start()
    logger.info("Windows system tray thread started")
    return True
