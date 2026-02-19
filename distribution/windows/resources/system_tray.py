"""
Windows System Tray Icon for Huntarr

The tray icon runs on a dedicated STA (Single-Threaded Apartment) thread
with its own Win32 message pump. This is required for pystray to work
reliably on Windows, especially when the main process is a windowless
(console=False) PyInstaller app.

This module is loaded by main.py via importlib.util (file path import),
NOT as a Python package import, because PyInstaller bundles it as a data file.
"""

import os
import sys
import threading
import webbrowser
import logging

logger = logging.getLogger('HuntarrSystemTray')


def _safe_port():
    """Parse port from env with fallback."""
    try:
        return int(os.environ.get("HUNTARR_PORT", os.environ.get("PORT", 9705)))
    except (TypeError, ValueError):
        return 9705


def _find_icon_path():
    """Find the Huntarr icon file.

    Search order (PyInstaller 6.x puts data under _MEIPASS/_internal/):
      1. _MEIPASS/frontend/static/logo/huntarr.ico
      2. _MEIPASS/static/logo/huntarr.ico
      3. _MEIPASS/resources/huntarr.ico
      4. exe_dir/frontend/static/logo/huntarr.ico
      5. source tree (dev mode)
    """
    candidates = []

    if getattr(sys, 'frozen', False):
        meipass = getattr(sys, '_MEIPASS', os.path.dirname(sys.executable))
        exe_dir = os.path.dirname(sys.executable)
        candidates += [
            os.path.join(meipass, 'frontend', 'static', 'logo', 'huntarr.ico'),
            os.path.join(meipass, 'static', 'logo', 'huntarr.ico'),
            os.path.join(meipass, 'resources', 'huntarr.ico'),
            os.path.join(exe_dir, 'frontend', 'static', 'logo', 'huntarr.ico'),
        ]
    else:
        project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
        candidates.append(os.path.join(project_root, 'frontend', 'static', 'logo', 'huntarr.ico'))

    for path in candidates:
        if os.path.exists(path):
            return path
    return None


def _load_icon_image():
    """Load the Huntarr icon as a PIL Image.
    Falls back to a generated 64x64 orange square if nothing found.
    """
    from PIL import Image

    icon_path = _find_icon_path()
    if icon_path:
        logger.info(f"Loading tray icon from: {icon_path}")
        try:
            return Image.open(icon_path)
        except Exception as e:
            logger.warning(f"Failed to open icon at {icon_path}: {e}")

    # PNG fallbacks
    if getattr(sys, 'frozen', False):
        meipass = getattr(sys, '_MEIPASS', os.path.dirname(sys.executable))
        logo_dirs = [
            os.path.join(meipass, 'frontend', 'static', 'logo'),
            os.path.join(meipass, 'static', 'logo'),
        ]
    else:
        project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
        logo_dirs = [os.path.join(project_root, 'frontend', 'static', 'logo')]

    for logo_dir in logo_dirs:
        for name in ('64.png', '48.png', '32.png', 'huntarr.png'):
            png = os.path.join(logo_dir, name)
            if os.path.exists(png):
                logger.info(f"Loading tray icon from PNG: {png}")
                try:
                    return Image.open(png)
                except Exception:
                    pass

    logger.warning("No icon found — using orange placeholder")
    return Image.new('RGB', (64, 64), color=(255, 127, 0))


class HuntarrSystemTray:
    """System tray icon for Huntarr on Windows.

    The tray runs on a dedicated thread. pystray's win32 backend creates
    a hidden HWND and pumps messages internally, so it works from a
    non-main thread on Windows. The thread is set to STA via ctypes
    for COM compatibility.
    """

    def __init__(self, port=None, shutdown_callback=None):
        self.port = port if port is not None else _safe_port()
        self._shutdown_callback = shutdown_callback
        self._icon = None
        self._thread = None

    # -- Menu actions --

    def _open_web(self, icon=None, item=None):
        try:
            url = f"http://localhost:{self.port}"
            webbrowser.open(url)
        except Exception as e:
            logger.error(f"Error opening browser: {e}")

    def _exit_app(self, icon=None, item=None):
        logger.info("Exit requested from system tray")
        self.stop()
        if self._shutdown_callback:
            try:
                self._shutdown_callback()
            except Exception as e:
                logger.error(f"Shutdown callback error: {e}")

    # -- Lifecycle --

    def start(self):
        """Start the tray icon in a dedicated thread. Non-blocking."""
        self._thread = threading.Thread(
            target=self._run,
            name="HuntarrTrayThread",
            daemon=True,
        )
        self._thread.start()
        logger.info("System tray thread launched")

    def stop(self):
        """Stop the tray icon gracefully."""
        if self._icon:
            try:
                self._icon.stop()
            except Exception:
                pass
        logger.info("System tray icon stopped")

    def _run(self):
        """Thread entry point — sets STA, loads icon, runs message loop."""
        try:
            # Set this thread to STA (Single-Threaded Apartment) for COM.
            # On CPython/Windows we use ctypes to call CoInitializeEx.
            try:
                import ctypes
                import ctypes.wintypes
                # COINIT_APARTMENTTHREADED = 0x2
                ctypes.windll.ole32.CoInitializeEx(None, 0x2)
                logger.debug("COM initialized as STA on tray thread")
            except Exception as e:
                logger.debug(f"CoInitializeEx skipped: {e}")

            import pystray

            image = _load_icon_image()
            menu = pystray.Menu(
                pystray.MenuItem("Open Huntarr", self._open_web, default=True),
                pystray.Menu.SEPARATOR,
                pystray.MenuItem("Exit Huntarr", self._exit_app),
            )
            self._icon = pystray.Icon("Huntarr", image, "Huntarr", menu)
            logger.info("System tray icon created — entering message loop")
            self._icon.run()  # Blocking — runs Win32 message pump

        except ImportError as e:
            logger.error(f"pystray not available: {e}")
        except Exception as e:
            logger.error(f"System tray error: {e}", exc_info=True)
        finally:
            try:
                import ctypes
                ctypes.windll.ole32.CoUninitialize()
            except Exception:
                pass


def create_system_tray(port=None, shutdown_callback=None):
    """Factory function. Returns a HuntarrSystemTray instance."""
    return HuntarrSystemTray(port=port, shutdown_callback=shutdown_callback)
