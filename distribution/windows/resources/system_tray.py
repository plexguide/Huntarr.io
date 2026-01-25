"""
Windows System Tray Icon for Huntarr
Provides a system tray icon with menu options to control Huntarr
"""

import os
import sys
import threading
import webbrowser
import pystray
from PIL import Image
import logging

logger = logging.getLogger('HuntarrSystemTray')

class HuntarrSystemTray:
    """System tray icon for Huntarr on Windows"""
    
    def __init__(self, port=9705):
        """Initialize the system tray icon
        
        Args:
            port (int): Port number where Huntarr web interface is running
        """
        self.port = port
        self.icon = None
        self.running = True
        self.icon_thread = None
        
    def create_icon_image(self):
        """Create or load the icon image for the system tray"""
        try:
            # Try to load the Huntarr icon from the static folder
            if getattr(sys, 'frozen', False):
                # Running as PyInstaller bundle
                base_path = sys._MEIPASS
            else:
                # Running as script
                base_path = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
            
            icon_path = os.path.join(base_path, 'frontend', 'static', 'logo', 'huntarr.ico')
            
            if os.path.exists(icon_path):
                logger.info(f"Loading icon from: {icon_path}")
                return Image.open(icon_path)
            else:
                # Fallback: Try PNG versions
                for size in ['64', '48', '32']:
                    png_path = os.path.join(base_path, 'frontend', 'static', 'logo', f'{size}.png')
                    if os.path.exists(png_path):
                        logger.info(f"Loading icon from: {png_path}")
                        return Image.open(png_path)
                
                # Final fallback: Create a simple icon
                logger.warning("Could not find Huntarr icon, creating placeholder")
                return self._create_placeholder_icon()
                
        except Exception as e:
            logger.error(f"Error loading icon: {e}")
            return self._create_placeholder_icon()
    
    def _create_placeholder_icon(self):
        """Create a simple placeholder icon"""
        # Create a 64x64 orange/blue icon
        img = Image.new('RGB', (64, 64), color=(255, 127, 0))
        return img
    
    def open_web_interface(self, icon=None, item=None):
        """Open the Huntarr web interface in the default browser"""
        try:
            url = f"http://localhost:{self.port}"
            webbrowser.open(url)
            logger.info(f"Opened web interface: {url}")
        except Exception as e:
            logger.error(f"Error opening web interface: {e}")
    
    def show_about(self, icon=None, item=None):
        """Show about information (opens web interface)"""
        self.open_web_interface()
    
    def exit_app(self, icon=None, item=None):
        """Exit Huntarr application"""
        logger.info("System tray exit requested")
        self.running = False
        if self.icon:
            self.icon.stop()
        
        # Signal the main application to shut down
        try:
            from primary.background import stop_event
            if not stop_event.is_set():
                stop_event.set()
                logger.info("Stop event set for main application")
        except Exception as e:
            logger.error(f"Error signaling main application shutdown: {e}")
        
        # Give threads time to clean up
        import time
        time.sleep(1)
        
        # Force exit if needed
        os._exit(0)
    
    def create_menu(self):
        """Create the system tray context menu"""
        return pystray.Menu(
            pystray.MenuItem(
                "Open Huntarr",
                self.open_web_interface,
                default=True
            ),
            pystray.MenuItem(
                "About Huntarr",
                self.show_about
            ),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem(
                "Exit",
                self.exit_app
            )
        )
    
    def run(self):
        """Run the system tray icon (blocking)"""
        try:
            logger.info("Starting system tray icon...")
            
            # Create the icon
            image = self.create_icon_image()
            menu = self.create_menu()
            
            self.icon = pystray.Icon(
                "Huntarr",
                image,
                "Huntarr - Media Management",
                menu
            )
            
            # Run the icon (this is blocking)
            logger.info("System tray icon running")
            self.icon.run()
            
        except Exception as e:
            logger.error(f"Error running system tray icon: {e}")
            logger.exception(e)
    
    def start(self):
        """Start the system tray icon in a separate thread"""
        try:
            logger.info("Starting system tray in background thread...")
            self.icon_thread = threading.Thread(
                target=self.run,
                name="SystemTrayThread",
                daemon=True
            )
            self.icon_thread.start()
            logger.info("System tray thread started")
            return True
        except Exception as e:
            logger.error(f"Error starting system tray thread: {e}")
            return False
    
    def stop(self):
        """Stop the system tray icon"""
        try:
            self.running = False
            if self.icon:
                self.icon.stop()
            logger.info("System tray icon stopped")
        except Exception as e:
            logger.error(f"Error stopping system tray: {e}")


def create_system_tray(port=9705):
    """Create and return a system tray instance
    
    Args:
        port (int): Port number where Huntarr is running
    
    Returns:
        HuntarrSystemTray: System tray instance
    """
    return HuntarrSystemTray(port=port)


if __name__ == '__main__':
    # Test the system tray
    logging.basicConfig(level=logging.INFO)
    tray = HuntarrSystemTray()
    tray.run()  # Blocking call for testing
