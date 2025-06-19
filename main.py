#!/usr/bin/env python3
"""
Main entry point for Huntarr
Starts both the web server and the background processing tasks.
"""

import os
import threading
import sys
import signal
import logging # Use standard logging for initial setup
import atexit
import time

# Import path configuration early to set up environment
try:
    from src.primary.utils import config_paths
    print(f"Using config directory: {config_paths.CONFIG_DIR}")
except Exception as e:
    print(f"Warning: Failed to initialize config paths: {str(e)}")
    # Continue anyway - we'll handle this later

# Ensure the 'src' directory is in the Python path
# This allows importing modules from 'src.primary' etc.
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), 'src')))

# --- Early Logging Setup (Before importing app components) ---
# Basic logging to capture early errors during import or setup
log_level = logging.DEBUG if os.environ.get('DEBUG', 'false').lower() == 'true' else logging.INFO

# Create a custom formatter that uses local time
class LocalTimeFormatter(logging.Formatter):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.converter = time.localtime  # Use local time instead of UTC

# Disable basic logging to prevent duplicates - we use custom loggers
# logging.basicConfig(level=log_level, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s', datefmt='%Y-%m-%d %H:%M:%S')

# Apply local time converter to all existing handlers
for handler in logging.root.handlers:
    if hasattr(handler, 'formatter') and handler.formatter:
        handler.formatter.converter = time.localtime

root_logger = logging.getLogger("HuntarrRoot") # Specific logger for this entry point
root_logger.info("--- Huntarr Main Process Starting ---")
root_logger.info(f"Python sys.path: {sys.path}")

# Check for Windows service commands
if sys.platform == 'win32' and len(sys.argv) > 1:
    if sys.argv[1] == '--install-service':
        try:
            from src.primary.windows_service import install_service
            success = install_service()
            sys.exit(0 if success else 1)
        except ImportError:
            root_logger.error("Failed to import Windows service module. Make sure pywin32 is installed.")
            sys.exit(1)
        except Exception as e:
            root_logger.exception(f"Error installing Windows service: {e}")
            sys.exit(1)
    elif sys.argv[1] == '--remove-service':
        try:
            from src.primary.windows_service import remove_service
            success = remove_service()
            sys.exit(0 if success else 1)
        except ImportError:
            root_logger.error("Failed to import Windows service module. Make sure pywin32 is installed.")
            sys.exit(1)
        except Exception as e:
            root_logger.exception(f"Error removing Windows service: {e}")
            sys.exit(1)
    elif sys.argv[1] in ['--start', '--stop', '--restart', '--debug', '--update']:
        try:
            import win32serviceutil
            service_name = "Huntarr"
            if sys.argv[1] == '--start':
                win32serviceutil.StartService(service_name)
                print(f"Started {service_name} service")
            elif sys.argv[1] == '--stop':
                win32serviceutil.StopService(service_name)
                print(f"Stopped {service_name} service")
            elif sys.argv[1] == '--restart':
                win32serviceutil.RestartService(service_name)
                print(f"Restarted {service_name} service")
            elif sys.argv[1] == '--debug':
                # Run the service in debug mode directly
                from src.primary.windows_service import HuntarrService
                win32serviceutil.HandleCommandLine(HuntarrService)
            elif sys.argv[1] == '--update':
                # Update the service
                win32serviceutil.StopService(service_name)
                from src.primary.windows_service import install_service
                install_service()
                win32serviceutil.StartService(service_name)
                print(f"Updated {service_name} service")
            sys.exit(0)
        except ImportError:
            root_logger.error("Failed to import Windows service module. Make sure pywin32 is installed.")
            sys.exit(1)
        except Exception as e:
            root_logger.exception(f"Error managing Windows service: {e}")
            sys.exit(1)

try:
    # Import the Flask app instance
    from primary.web_server import app
    # Import the background task starter function and shutdown helpers from the renamed file
    from primary.background import start_huntarr, stop_event, shutdown_threads
    # Configure logging first
    import logging
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))
    from primary.utils.logger import setup_main_logger, get_logger
    from primary.utils.clean_logger import setup_clean_logging
    
    # Initialize main logger
    huntarr_logger = setup_main_logger()
    
    # Initialize timezone from TZ environment variable
    try:
        from primary.settings_manager import initialize_timezone_from_env
        initialize_timezone_from_env()
        huntarr_logger.info("Timezone initialization completed.")
    except Exception as e:
        huntarr_logger.warning(f"Failed to initialize timezone from environment: {e}")
    
    # Initialize clean logging for frontend consumption
    setup_clean_logging()
    huntarr_logger.info("Clean logging system initialized for frontend consumption.")
    
    huntarr_logger.info("Successfully imported application components.")
    # Main function startup message removed to reduce log spam
except ImportError as e:
    root_logger.critical(f"Fatal Error: Failed to import application components: {e}", exc_info=True)
    root_logger.critical("Please ensure the application structure is correct, dependencies are installed (`pip install -r requirements.txt`), and the script is run from the project root.")
    sys.exit(1)
except Exception as e:
    root_logger.critical(f"Fatal Error: An unexpected error occurred during initial imports: {e}", exc_info=True)
    sys.exit(1)

# Global variables for server management
waitress_server = None
shutdown_requested = threading.Event()

def refresh_sponsors_on_startup():
    """Refresh sponsors database from manifest.json on startup"""
    import os
    import json
    
    try:
        # Get database instance
        from src.primary.utils.database import get_database
        db = get_database()
        
        # Path to manifest.json
        manifest_path = os.path.join(os.path.dirname(__file__), 'manifest.json')
        
        if os.path.exists(manifest_path):
            with open(manifest_path, 'r') as f:
                manifest_data = json.load(f)
            
            sponsors_list = manifest_data.get('sponsors', [])
            if sponsors_list:
                # Clear existing sponsors and save new ones
                db.save_sponsors(sponsors_list)
                huntarr_logger.debug(f"Refreshed {len(sponsors_list)} sponsors from manifest.json")
            else:
                huntarr_logger.warning("No sponsors found in manifest.json")
        else:
            huntarr_logger.warning(f"manifest.json not found at {manifest_path}")
            
    except Exception as e:
        huntarr_logger.error(f"Error refreshing sponsors on startup: {e}")
        raise

def load_version_to_database():
    """Load current version from version.txt into database on startup"""
    import os
    
    try:
        # Get database instance
        from src.primary.utils.database import get_database
        db = get_database()
        
        # Path to version.txt
        version_path = os.path.join(os.path.dirname(__file__), 'version.txt')
        
        if os.path.exists(version_path):
            with open(version_path, 'r') as f:
                version = f.read().strip()
            
            if version:
                # Store version in database
                db.set_version(version)
                huntarr_logger.info(f"Version {version} loaded into database")
            else:
                huntarr_logger.warning("version.txt is empty")
        else:
            huntarr_logger.warning(f"version.txt not found at {version_path}")
            
    except Exception as e:
        huntarr_logger.error(f"Error loading version to database: {e}")
        # Don't raise - this is not critical enough to stop startup

def run_background_tasks():
    """Runs the Huntarr background processing."""
    bg_logger = get_logger("HuntarrBackground") # Use app's logger
    try:
        bg_logger.info("Starting Huntarr background tasks...")
        start_huntarr() # This function contains the main loop and shutdown logic
    except Exception as e:
        bg_logger.exception(f"Critical error in Huntarr background tasks: {e}")
    finally:
        bg_logger.info("Huntarr background tasks stopped.")

def run_web_server():
    """Runs the Flask web server using Waitress in production."""
    global waitress_server
    web_logger = get_logger("WebServer") # Use app's logger
    debug_mode = os.environ.get('DEBUG', 'false').lower() == 'true'
    host = os.environ.get('FLASK_HOST', '0.0.0.0')
    port = int(os.environ.get('PORT', 9705)) # Use PORT for consistency

    web_logger.info(f"Starting web server on {host}:{port} (Debug: {debug_mode})...")

    # Log the current authentication mode once at startup
    try:
        import sys
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))
        from primary.settings_manager import load_settings
        
        settings = load_settings("general")
        local_access_bypass = settings.get("local_access_bypass", False)
        proxy_auth_bypass = settings.get("proxy_auth_bypass", False)
        
        if proxy_auth_bypass:
            web_logger.info("🔓 Authentication Mode: NO LOGIN MODE (Proxy authentication bypass enabled)")
        elif local_access_bypass:
            web_logger.info("🏠 Authentication Mode: LOCAL ACCESS BYPASS (Local network authentication bypass enabled)")
        else:
            web_logger.info("🔐 Authentication Mode: STANDARD (Full authentication required)")
    except Exception as e:
        web_logger.warning(f"Could not determine authentication mode at startup: {e}")

    if debug_mode:
        # Use Flask's development server for debugging (less efficient, auto-reloads)
        # Note: use_reloader=True can cause issues with threads starting twice.
        web_logger.warning("Running in DEBUG mode with Flask development server.")
        try:
            app.run(host=host, port=port, debug=True, use_reloader=False)
        except Exception as e:
            web_logger.exception(f"Flask development server failed: {e}")
            # Signal background thread to stop if server fails critically
            if not stop_event.is_set():
                stop_event.set()
    else:
        # Use Waitress for production with proper signal handling
        try:
            from waitress import serve
            from waitress.server import create_server
            import time
            web_logger.info("Running with Waitress production server.")
            
            # Create the server instance so we can shut it down gracefully
            waitress_server = create_server(app, host=host, port=port, threads=8)
            
            web_logger.info("Waitress server starting...")
            
            # Start the server in a separate thread
            server_thread = threading.Thread(target=waitress_server.run, daemon=True)
            server_thread.start()
            
            # Monitor for shutdown signal in the main thread
            while not shutdown_requested.is_set() and not stop_event.is_set():
                try:
                    # Check both shutdown events
                    if shutdown_requested.wait(timeout=0.5) or stop_event.wait(timeout=0.5):
                        break
                except KeyboardInterrupt:
                    break
            
            # Shutdown sequence
            web_logger.info("Shutdown signal received. Stopping Waitress server...")
            try:
                waitress_server.close()
                web_logger.info("Waitress server close() called.")
                
                # Wait for server thread to finish
                server_thread.join(timeout=3.0)
                if server_thread.is_alive():
                    web_logger.warning("Server thread did not stop within timeout.")
                else:
                    web_logger.info("Server thread stopped successfully.")
                    
            except Exception as e:
                web_logger.exception(f"Error during Waitress server shutdown: {e}")
            
            web_logger.info("Waitress server has stopped.")
            
        except ImportError:
            web_logger.error("Waitress not found. Falling back to Flask development server (NOT recommended for production).")
            web_logger.error("Install waitress ('pip install waitress') for production use.")
            try:
                app.run(host=host, port=port, debug=False, use_reloader=False)
            except Exception as e:
                web_logger.exception(f"Flask development server (fallback) failed: {e}")
                # Signal background thread to stop if server fails critically
                if not stop_event.is_set():
                    stop_event.set()
        except Exception as e:
            web_logger.exception(f"Waitress server failed: {e}")
            # Signal background thread to stop if server fails critically
            if not stop_event.is_set():
                stop_event.set()

def main_shutdown_handler(signum, frame):
    """Gracefully shut down the application."""
    huntarr_logger.info(f"Received signal {signum}. Initiating graceful shutdown...")
    
    # Immediate database checkpoint to prevent corruption
    try:
        from primary.utils.database import get_database, get_logs_database
        
        huntarr_logger.info("Performing emergency database checkpoint...")
        
        # Emergency checkpoint for main database
        try:
            main_db = get_database()
            with main_db.get_connection() as conn:
                conn.execute("PRAGMA wal_checkpoint(RESTART)")
                huntarr_logger.info("Main database emergency checkpoint completed")
        except Exception as e:
            huntarr_logger.warning(f"Main database emergency checkpoint failed: {e}")
        
        # Emergency checkpoint for logs database
        try:
            logs_db = get_logs_database()
            with logs_db.get_logs_connection() as conn:
                conn.execute("PRAGMA wal_checkpoint(RESTART)")
                huntarr_logger.info("Logs database emergency checkpoint completed")
        except Exception as e:
            huntarr_logger.warning(f"Logs database emergency checkpoint failed: {e}")
            
    except Exception as e:
        huntarr_logger.warning(f"Emergency database checkpoint failed: {e}")
    
    # Set both shutdown events
    if not stop_event.is_set():
        stop_event.set()
    if not shutdown_requested.is_set():
        shutdown_requested.set()
    
    # Also shutdown the Waitress server directly if it exists
    global waitress_server
    if waitress_server:
        try:
            huntarr_logger.info("Signaling Waitress server to shutdown...")
            waitress_server.close()
        except Exception as e:
            huntarr_logger.warning(f"Error closing Waitress server: {e}")

def cleanup_handler():
    """Cleanup function called at exit"""
    huntarr_logger.info("Exit cleanup handler called")
    
    # Shutdown databases gracefully
    try:
        from primary.utils.database import get_database, get_logs_database
        
        # Close main database connections
        main_db = get_database()
        if hasattr(main_db, '_database_instance') and main_db._database_instance is not None:
            huntarr_logger.info("Closing main database connections...")
            # Force close any open connections
            try:
                with main_db.get_connection() as conn:
                    conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")  # Flush WAL to main database
                    conn.execute("VACUUM")  # Optimize database before shutdown
            except Exception as db_error:
                huntarr_logger.warning(f"Error during main database cleanup: {db_error}")
        
        # Close logs database connections
        logs_db = get_logs_database()
        if hasattr(logs_db, '_logs_database_instance') and logs_db._logs_database_instance is not None:
            huntarr_logger.info("Closing logs database connections...")
            try:
                with logs_db.get_logs_connection() as conn:
                    conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")  # Flush WAL to logs database
                    conn.execute("VACUUM")  # Optimize logs database before shutdown
            except Exception as logs_error:
                huntarr_logger.warning(f"Error during logs database cleanup: {logs_error}")
                
        huntarr_logger.info("Database shutdown completed")
        
    except Exception as e:
        huntarr_logger.warning(f"Error during database shutdown: {e}")
    
    if not stop_event.is_set():
        stop_event.set()
    if not shutdown_requested.is_set():
        shutdown_requested.set()

def main():
    """Main entry point function for Huntarr application.
    This function is called by app_launcher.py in the packaged ARM application.
    """
    # Register signal handlers for graceful shutdown in the main process
    signal.signal(signal.SIGINT, main_shutdown_handler)
    signal.signal(signal.SIGTERM, main_shutdown_handler)
    
    # Register cleanup handler
    atexit.register(cleanup_handler)
    
    # Initialize databases with default configurations
    try:
        from primary.settings_manager import initialize_database
        initialize_database()
        huntarr_logger.info("Main database initialization completed successfully")
        
        # Initialize database logging system (now uses main huntarr.db)
        try:
            from primary.utils.database import get_logs_database, schedule_log_cleanup
            logs_db = get_logs_database()
            schedule_log_cleanup()
            huntarr_logger.info("Database logging system initialized with scheduled cleanup.")
        except Exception as e:
            huntarr_logger.warning(f"Failed to initialize database logging: {e}")
        
        # Load version from version.txt into database on startup
        try:
            load_version_to_database()
        except Exception as version_error:
            huntarr_logger.warning(f"Failed to load version to database: {version_error}")
        
        # Refresh sponsors from manifest.json on startup
        try:
            refresh_sponsors_on_startup()
            huntarr_logger.info("Sponsors database refreshed from manifest.json")
        except Exception as sponsor_error:
            huntarr_logger.warning(f"Failed to refresh sponsors on startup: {sponsor_error}")
        
    except Exception as e:
        huntarr_logger.error(f"Failed to initialize databases: {e}")
        huntarr_logger.error("Application may not function correctly without database")
        # Continue anyway - the app might still work with defaults

    background_thread = None
    try:
        # Start background tasks in a daemon thread
        # Daemon threads exit automatically if the main thread exits unexpectedly,
        # but we'll try to join() them for a graceful shutdown.
        background_thread = threading.Thread(target=run_background_tasks, name="HuntarrBackground", daemon=True)
        background_thread.start()

        # Start the web server in the main thread (blocking)
        # This will run until the server is stopped (e.g., by Ctrl+C)
        run_web_server()

    except KeyboardInterrupt:
        huntarr_logger.info("KeyboardInterrupt received in main thread. Shutting down...")
        if not stop_event.is_set():
            stop_event.set()
        if not shutdown_requested.is_set():
            shutdown_requested.set()
    except Exception as e:
        huntarr_logger.exception(f"An unexpected error occurred in the main execution block: {e}")
        if not stop_event.is_set():
            stop_event.set() # Ensure shutdown is triggered on unexpected errors
        if not shutdown_requested.is_set():
            shutdown_requested.set()
    finally:
        # --- Cleanup ---
        huntarr_logger.info("Web server has stopped. Initiating final shutdown sequence...")

        # Ensure the stop event is set (might already be set by signal handler or error)
        if not stop_event.is_set():
             huntarr_logger.warning("Stop event was not set before final cleanup. Setting now.")
             stop_event.set()

        # Wait for the background thread to finish cleanly
        if background_thread and background_thread.is_alive():
            huntarr_logger.info("Waiting for background tasks to complete...")
            background_thread.join(timeout=5) # Reduced timeout for faster shutdown

            if background_thread.is_alive():
                huntarr_logger.warning("Background thread did not stop gracefully within the timeout.")
        elif background_thread:
             huntarr_logger.info("Background thread already stopped.")
        else:
             huntarr_logger.info("Background thread was not started.")

        # Call the shutdown_threads function from primary.main (if it does more than just join)
        # This might be redundant if start_huntarr handles its own cleanup via stop_event
        # huntarr_logger.info("Calling shutdown_threads()...")
        # shutdown_threads() # Uncomment if primary.main.shutdown_threads() does more cleanup

        huntarr_logger.info("--- Huntarr Main Process Exiting ---")
        return 0  # Success exit code


if __name__ == '__main__':
    # Call the main function and exit with its return code
    # This will use the return value from main() (0 for success) as the exit code
    sys.exit(main())