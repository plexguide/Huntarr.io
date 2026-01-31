"""
Windows system tray icon for Huntarr.
Provides Open Huntarr and Quit from the notification area.
Uses pystray run_detached() so the icon runs in its own thread without blocking the main thread.
"""

import os
import sys
import webbrowser
import logging

logger = logging.getLogger("Huntarr")

# Default port; matches main.py
DEFAULT_PORT = int(os.environ.get("HUNTARR_PORT", os.environ.get("PORT", 9705)))

# Module-level reference so quit callback can call icon.stop()
_tray_icon = None


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


def _project_base():
    """Project root: works when running as script or from frozen bundle."""
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        return sys._MEIPASS
    # __file__ is src/primary/windows_tray.py -> project root is ../..
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def _load_icon_image():
    """Load and prepare icon for Windows tray (32x32 RGBA recommended)."""
    try:
        from PIL import Image
    except ImportError:
        logger.warning("PIL not available for system tray icon")
        return None
    base = _project_base()
    # Prefer ICO on Windows
    ico = os.path.join(base, "frontend", "static", "logo", "huntarr.ico")
    if os.path.isfile(ico):
        try:
            img = Image.open(ico)
            img = img.convert("RGBA")
            # Windows tray typically uses 16x16 or 32x32
            if img.size != (32, 32):
                resample = getattr(getattr(Image, "Resampling", None), "LANCZOS", Image.LANCZOS if hasattr(Image, "LANCZOS") else 1)
                img = img.resize((32, 32), resample)
            return img
        except Exception as e:
            logger.debug("Could not load ICO: %s", e)
    for name in ("32.png", "48.png", "64.png"):
        path = os.path.join(base, "frontend", "static", "logo", name)
        if os.path.isfile(path):
            try:
                img = Image.open(path).convert("RGBA")
                if img.size != (32, 32):
                    resample = getattr(getattr(Image, "Resampling", None), "LANCZOS", Image.LANCZOS if hasattr(Image, "LANCZOS") else 1)
                    img = img.resize((32, 32), resample)
                return img
            except Exception as e:
                logger.debug("Could not load %s: %s", name, e)
    # Fallback
    return Image.new("RGBA", (32, 32), (255, 127, 0, 255))


def start_windows_tray(port=DEFAULT_PORT):
    """
    Start the Windows system tray icon (non-blocking).
    Uses run_detached() so the main thread can continue running the web server.
    Returns True if the tray was started, False otherwise.
    """
    global _tray_icon
    try:
        import pystray
    except ImportError:
        logger.warning("pystray not installed; system tray will not be shown")
        return False

    stop_ev = _get_stop_event()
    image = _load_icon_image()
    if image is None:
        logger.warning("No tray icon image available")
        return False

    def open_cb(icon=None, item=None):
        webbrowser.open(f"http://127.0.0.1:{port}")

    def quit_cb(icon=None, item=None):
        if stop_ev and not stop_ev.is_set():
            stop_ev.set()
            logger.info("System tray Quit: stop_event set")
        if icon:
            try:
                icon.stop()
            except Exception as e:
                logger.debug("icon.stop(): %s", e)

    menu = pystray.Menu(
        pystray.MenuItem("Open Huntarr", open_cb, default=True),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Quit", quit_cb),
    )
    _tray_icon = pystray.Icon(
        "Huntarr",
        image,
        "Huntarr - Media Management",
        menu,
    )
    try:
        # run_detached() runs the icon in a separate thread and returns immediately.
        # Pass setup=lambda: None to avoid NameError on older pystray (issue #102).
        _tray_icon.run_detached(setup=lambda: None)
        logger.info("Windows system tray started (run_detached)")
        return True
    except TypeError:
        # Older pystray: run_detached() may not accept setup
        try:
            _tray_icon.run_detached()
            logger.info("Windows system tray started (run_detached)")
            return True
        except Exception as e:
            logger.warning("run_detached failed, trying thread: %s", e)
            import threading
            t = threading.Thread(target=_tray_icon.run, name="WindowsSystemTray", daemon=True)
            t.start()
            logger.info("Windows system tray started (thread)")
            return True
    except Exception as e:
        logger.warning("Failed to start system tray: %s", e)
        return False
