"""
Windows system tray icon for Huntarr. Optional; failures are caught and never break the app.
Sonarr does not ship a tray icon; this is Huntarr-only.
"""

import os
import sys
import threading
import logging

logger = logging.getLogger("HuntarrSystemTray")


def _run_tray_thread(port):
    """Run tray icon in this thread. All work inside try/except so main app never breaks."""
    try:
        if sys.platform != "win32":
            return
        try:
            import pythoncom
            pythoncom.CoInitialize()
        except Exception:
            pass
        import pystray
        from PIL import Image

        # Icon path: project root or PyInstaller _MEIPASS
        if getattr(sys, "frozen", False):
            base = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
        else:
            base = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

        icon_path = os.path.join(base, "frontend", "static", "logo", "huntarr.ico")
        image = None
        if os.path.exists(icon_path):
            try:
                image = Image.open(icon_path)
            except Exception:
                pass
        if image is None:
            for size in ("64", "48", "32"):
                png = os.path.join(base, "frontend", "static", "logo", f"{size}.png")
                if os.path.exists(png):
                    try:
                        image = Image.open(png)
                        break
                    except Exception:
                        pass
        if image is None:
            image = Image.new("RGB", (64, 64), color=(255, 127, 0))

        import webbrowser

        def open_web(icon=None, item=None):
            try:
                webbrowser.open(f"http://localhost:{port}")
            except Exception:
                pass

        def exit_app(icon=None, item=None):
            try:
                from primary.background import stop_event
                stop_event.set()
            except Exception:
                pass
            import time
            time.sleep(0.5)
            os._exit(0)

        menu = pystray.Menu(
            pystray.MenuItem("Open Huntarr", open_web, default=True),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Exit", exit_app),
        )
        icon = pystray.Icon("Huntarr", image, "Huntarr", menu)
        icon.run()
    except Exception as e:
        logger.debug("System tray failed (optional): %s", e)


def start_system_tray(port):
    """
    Start the system tray icon on Windows. Optional; never raises.
    Returns True if the tray thread was started, False otherwise.
    """
    if sys.platform != "win32":
        return False
    try:
        import pystray  # noqa: F401
    except ImportError:
        logger.debug("pystray not installed; tray disabled")
        return False
    try:
        t = threading.Thread(target=_run_tray_thread, args=(port,), name="HuntarrTray", daemon=True)
        t.start()
        logger.info("System tray started")
        return True
    except Exception as e:
        logger.debug("Could not start tray: %s", e)
        return False
