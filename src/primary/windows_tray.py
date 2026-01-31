"""
Windows System Tray Icon for Huntarr.
Provides a system tray icon with menu options when running as a normal app (not as a service).
Tray only appears when Huntarr runs in the user session (e.g. double-click exe or Startup shortcut).
"""

import os
import sys
import threading
import webbrowser
import logging

logger = logging.getLogger("HuntarrSystemTray")


def _load_tray_image():
    """Load tray icon image; works from project root or PyInstaller bundle."""
    if getattr(sys, "frozen", False):
        base_path = sys._MEIPASS
    else:
        base_path = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

    icon_path = os.path.join(base_path, "frontend", "static", "logo", "huntarr.ico")
    if os.path.exists(icon_path):
        try:
            from PIL import Image
            return Image.open(icon_path)
        except Exception as e:
            logger.warning("Could not load tray icon: %s", e)
    for size in ("64", "48", "32"):
        png_path = os.path.join(base_path, "frontend", "static", "logo", f"{size}.png")
        if os.path.exists(png_path):
            try:
                from PIL import Image
                return Image.open(png_path)
            except Exception as e:
                logger.warning("Could not load %s: %s", png_path, e)
    from PIL import Image
    return Image.new("RGB", (64, 64), color=(255, 127, 0))


def _create_tray_icon(port):
    """Create and run the system tray icon. Runs in its own thread with COM initialized."""
    try:
        import pythoncom
        pythoncom.CoInitialize()  # Required for COM/Shell on Windows tray thread
    except Exception as e:
        logger.warning("pythoncom.CoInitialize() failed (optional): %s", e)

    try:
        import pystray
    except ImportError as e:
        logger.error("System tray requires pystray: %s", e)
        return

    image = _load_tray_image()

    def open_web(icon_item=None, item=None):
        try:
            webbrowser.open(f"http://localhost:{port}")
            logger.info("Opened web interface: http://localhost:%s", port)
        except Exception as e:
            logger.error("Error opening web interface: %s", e)

    def exit_app(icon_item=None, item=None):
        logger.info("System tray exit requested")
        try:
            from primary.background import stop_event
            if not stop_event.is_set():
                stop_event.set()
                logger.info("Stop event set for main application")
        except Exception as e:
            logger.error("Error signaling shutdown: %s", e)
        import time
        time.sleep(1)
        os._exit(0)

    menu = pystray.Menu(
        pystray.MenuItem("Open Huntarr", open_web, default=True),
        pystray.MenuItem("About Huntarr", open_web),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Exit", exit_app),
    )
    icon = pystray.Icon("Huntarr", image, "Huntarr - Media Management", menu)
    logger.info("System tray icon running (port %s)", port)
    icon.run()


def start_system_tray(port):
    """
    Start the system tray icon in a dedicated thread.
    Only call when running as a normal Windows process (not as a service).
    Service runs in Session 0 and has no taskbar/tray.
    """
    if sys.platform != "win32":
        return False
    try:
        import pystray  # noqa: F401
    except ImportError:
        logger.debug("pystray not installed; system tray disabled")
        return False
    try:
        t = threading.Thread(
            target=_create_tray_icon,
            args=(port,),
            name="HuntarrSystemTray",
            daemon=False,
        )
        t.start()
        logger.info("System tray thread started")
        return True
    except Exception as e:
        logger.error("Failed to start system tray: %s", e, exc_info=True)
        return False
