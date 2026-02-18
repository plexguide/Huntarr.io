"""
Windows System Tray Icon for Huntarr
Provides a system tray icon with menu options to control Huntarr.
Runs in a daemon thread alongside the Waitress web server.
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


def _load_icon_image():
    """Load the Huntarr icon from bundled data files.

    Search order:
      1. _MEIPASS/frontend/static/logo/huntarr.ico   (PyInstaller 6.x)
      2. _MEIPASS/static/logo/huntarr.ico             (legacy fallback)
      3. exe_dir/frontend/static/logo/huntarr.ico     (manual copy)
      4. source tree relative path                     (dev mode)
    Falls back to a generated 64x64 orange placeholder.
    """
    from PIL import Image

    candidates = []

    if getattr(sys, 'frozen', False):
        meipass = getattr(sys, '_MEIPASS', os.path.dirname(sys.executable))
        exe_dir = os.path.dirname(sys.executable)
        candidates += [
            os.path.join(meipass, 'frontend', 'static', 'logo', 'huntarr.ico'),
            os.path.join(meipass, 'static', 'logo', 'huntarr.ico'),
            os.path.join(exe_dir, 'frontend', 'static', 'logo', 'huntarr.ico'),
        ]
    else:
        # Running from source
        project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
        candidates.append(os.path.join(project_root, 'frontend', 'static', 'logo', 'huntarr.ico'))

    for path in candidates:
        if os.path.exists(path):
            logger.info(f"Loading tray icon from: {path}")
            return Image.open(path)

    # Try PNG fallbacks
    for base in candidates:
        logo_dir = os.path.dirname(base)
        for size in ('64', '48', '32'):
            png = os.path.join(logo_dir, f'{size}.png')
            if os.path.exists(png):
                logger.info(f"Loading tray icon from: {png}")
                return Image.open(png)

    logger.warning("Huntarr icon not found, using placeholder")
    return Image.new('RGB', (64, 64), color=(255, 127, 0))


class HuntarrSystemTray:
    """System tray icon for Huntarr on Windows."""

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
            logger.info(f"Opened browser: {url}")
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
        """Start the tray icon in a daemon thread. Non-blocking."""
        self._thread = threading.Thread(target=self._run, name="SystemTrayThread", daemon=True)
        self._thread.start()
        logger.info("System tray thread started")

    def stop(self):
        """Stop the tray icon."""
        if self._icon:
            try:
                self._icon.stop()
            except Exception:
                pass
        logger.info("System tray icon stopped")

    def _run(self):
        try:
            import pystray
            image = _load_icon_image()
            menu = pystray.Menu(
                pystray.MenuItem("Open Huntarr", self._open_web, default=True),
                pystray.Menu.SEPARATOR,
                pystray.MenuItem("Exit", self._exit_app),
            )
            self._icon = pystray.Icon("Huntarr", image, "Huntarr", menu)
            logger.info("System tray icon running")
            self._icon.run()  # blocking
        except Exception as e:
            logger.error(f"System tray error: {e}", exc_info=True)


def create_system_tray(port=None, shutdown_callback=None):
    """Factory function. Returns a HuntarrSystemTray instance."""
    return HuntarrSystemTray(port=port, shutdown_callback=shutdown_callback)
