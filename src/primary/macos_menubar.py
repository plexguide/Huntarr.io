"""
macOS menu bar (status bar) icon for Huntarr.
Provides Open Huntarr, Open at Login, and Quit from the menu bar.
Only used when running as the macOS .app bundle.
"""

import os
import sys
import webbrowser
import logging

logger = logging.getLogger("Huntarr")

# Default port; matches main.py
DEFAULT_PORT = int(os.environ.get("HUNTARR_PORT", os.environ.get("PORT", 9705)))


def _icon_path():
    """Path to a small icon for the menu bar (prefer 22px or 32px PNG)."""
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        base = sys._MEIPASS
    else:
        base = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    for name in ("22.png", "32.png", "16.png", "icon_32x32.png"):
        path = os.path.join(base, "frontend", "static", "logo", name)
        if os.path.isfile(path):
            return path
    return None


def _open_at_login_enabled():
    """Check if Open at Login is enabled (macOS 13+ SMAppService)."""
    try:
        from Foundation import NSBundle
        from ServiceManagement import SMAppService
        bundle = NSBundle.mainBundle()
        if bundle is None:
            return False
        url = bundle.bundleURL()
        if url is None:
            return False
        app_service = SMAppService.mainApp()
        return app_service.isEnabled()
    except Exception:
        return False


def _set_open_at_login(enabled):
    """Enable or disable Open at Login (macOS 13+)."""
    try:
        from Foundation import NSBundle
        from ServiceManagement import SMAppService
        bundle = NSBundle.mainBundle()
        if bundle is None:
            return False
        url = bundle.bundleURL()
        if url is None:
            return False
        app_service = SMAppService.mainApp()
        if enabled:
            app_service.enable()
        else:
            app_service.disable()
        return True
    except Exception as e:
        logger.debug("Open at Login not available: %s", e)
        return False


def run_menubar(port=DEFAULT_PORT):
    """Run the macOS menu bar app. Call this from the main thread after starting main.main() in a background thread."""
    try:
        import rumps
    except ImportError:
        logger.warning("rumps not installed; menu bar will not be shown")
        return

    icon_path = _icon_path()

    def open_huntarr_cb(_):
        webbrowser.open(f"http://127.0.0.1:{port}")

    def toggle_open_at_login_cb(sender):
        try:
            enabled = _open_at_login_enabled()
            if _set_open_at_login(not enabled):
                sender.state = 1 if not enabled else 0
            else:
                rumps.notification(
                    "Huntarr",
                    "Open at Login",
                    "Use System Settings → General → Login Items to manage.",
                )
        except Exception as e:
            logger.debug("Open at Login toggle failed: %s", e)
            rumps.notification(
                "Huntarr",
                "Open at Login",
                "Use System Settings → General → Login Items to manage.",
            )

    def quit_cb(_):
        try:
            from src.primary.background import stop_event
            stop_event.set()
        except Exception:
            try:
                from primary.background import stop_event
                stop_event.set()
            except Exception:
                pass
        rumps.quit_application()

    menu_items = [
        rumps.MenuItem("Open Huntarr", callback=open_huntarr_cb),
        rumps.MenuItem("Open at Login", callback=toggle_open_at_login_cb),
        rumps.MenuItem("Quit", callback=quit_cb),
    ]
    app = rumps.App(
        "Huntarr",
        icon=icon_path,
        template=True,
        menu=menu_items,
        quit_button=None,
    )
    try:
        app.menu["Open at Login"].state = 1 if _open_at_login_enabled() else 0
    except Exception:
        pass

    logger.info("Starting macOS menu bar icon")
    app.run()
