"""
Windows Service module for Huntarr.
Allows Huntarr to run as a Windows service.
Includes privilege checks and fallback mechanisms for non-admin users.
"""

import os
import sys
import time
import logging
import servicemanager
import socket
import ctypes
import win32event
import win32service
import win32security
import win32serviceutil
import win32api
import win32con

# Add the parent directory to sys.path for imports
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))

# Import our config paths module early to ensure proper path setup
try:
    from primary.utils import config_paths
    config_dir = config_paths.CONFIG_DIR
    logs_dir = config_paths.LOG_DIR
except Exception as e:
    # Fallback if config_paths module can't be imported yet
    config_dir = os.path.join(os.environ.get("APPDATA", os.path.expanduser("~")), "Huntarr")
    logs_dir = os.path.join(config_dir, 'logs')
    os.makedirs(logs_dir, exist_ok=True)

# Configure basic logging
log_file = os.path.join(logs_dir, 'windows_service.log')
logging.basicConfig(
    filename=log_file,
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('HuntarrWindowsService')

# Also log to console when run directly
console_handler = logging.StreamHandler()
console_handler.setLevel(logging.INFO)
console_formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s')
console_handler.setFormatter(console_formatter)
logger.addHandler(console_handler)

class HuntarrService(win32serviceutil.ServiceFramework):
    """Windows Service implementation for Huntarr"""
    
    _svc_name_ = "Huntarr"
    _svc_display_name_ = "Huntarr Service"
    _svc_description_ = "Automated media collection management for Arr apps"
    
    def __init__(self, args):
        win32serviceutil.ServiceFramework.__init__(self, args)
        self.stop_event = win32event.CreateEvent(None, 0, 0, None)
        self.is_running = False
        socket.setdefaulttimeout(60)
        self.main_thread = None
        self.huntarr_app = None
        self.stop_flag = None
        
    def SvcStop(self):
        """Stop the service"""
        logger.info('Stopping Huntarr service...')
        self.ReportServiceStatus(win32service.SERVICE_STOP_PENDING)
        win32event.SetEvent(self.stop_event)
        self.is_running = False
        
        # Signal Huntarr to stop properly
        if hasattr(self, 'stop_flag') and self.stop_flag:
            logger.info('Setting stop flag for Huntarr...')
            self.stop_flag.set()
        
    def SvcDoRun(self):
        """Run the service"""
        servicemanager.LogMsg(
            servicemanager.EVENTLOG_INFORMATION_TYPE,
            servicemanager.PYS_SERVICE_STARTED,
            (self._svc_name_, '')
        )
        self.is_running = True
        self.main()
        
    def main(self):
        """Main service loop"""
        try:
            logger.info('Starting Huntarr service...')
            
            # Import here to avoid import errors when installing the service
            import threading
            from primary.background import start_huntarr, stop_event, shutdown_threads
            from primary.web_server import app
            from waitress import serve
            
            # Store the stop event for proper shutdown
            self.stop_flag = stop_event
            
            # Configure service environment
            os.environ['FLASK_HOST'] = '0.0.0.0'
            os.environ['PORT'] = '9705'
            os.environ['DEBUG'] = 'false'
            
            # Start background tasks in a thread
            background_thread = threading.Thread(
                target=start_huntarr, 
                name="HuntarrBackground", 
                daemon=True
            )
            background_thread.start()
            
            # Start the web server in a thread
            web_thread = threading.Thread(
                target=lambda: serve(app, host='0.0.0.0', port=9705, threads=8),
                name="HuntarrWebServer",
                daemon=True
            )
            web_thread.start()
            
            logger.info('Huntarr service started successfully')
            
            # Main service loop - keep running until stop event
            while self.is_running:
                # Wait for the stop event (or timeout for checking if threads are alive)
                event_result = win32event.WaitForSingleObject(self.stop_event, 5000)
                
                # Check if we should exit
                if event_result == win32event.WAIT_OBJECT_0:
                    break
                
                # Check if threads are still alive
                if not background_thread.is_alive() or not web_thread.is_alive():
                    logger.error("Critical: One of the Huntarr threads has died unexpectedly")
                    # Try to restart the threads if they died
                    if not background_thread.is_alive():
                        logger.info("Attempting to restart background thread...")
                        background_thread = threading.Thread(
                            target=start_huntarr, 
                            name="HuntarrBackground", 
                            daemon=True
                        )
                        background_thread.start()
                    
                    if not web_thread.is_alive():
                        logger.info("Attempting to restart web server thread...")
                        web_thread = threading.Thread(
                            target=lambda: serve(app, host='0.0.0.0', port=9705, threads=8),
                            name="HuntarrWebServer",
                            daemon=True
                        )
                        web_thread.start()
            
            # Service is stopping, clean up
            logger.info('Huntarr service is shutting down...')
            
            # Set the stop event for Huntarr's background tasks
            if not stop_event.is_set():
                stop_event.set()
            
            # Wait for threads to finish
            logger.info('Waiting for Huntarr threads to finish...')
            background_thread.join(timeout=30)
            web_thread.join(timeout=10)
            
            logger.info('Huntarr service shutdown complete')
            
        except Exception as e:
            logger.exception(f"Critical error in Huntarr service: {e}")
            servicemanager.LogErrorMsg(f"Huntarr service error: {str(e)}")


def is_admin():
    """Check if the script is running with administrator privileges"""
    try:
        return ctypes.windll.shell32.IsUserAnAdmin() != 0
    except Exception:
        return False

def install_service():
    """Install Huntarr as a Windows service"""
    if sys.platform != 'win32':
        print("Windows service installation is only available on Windows.")
        return False
    
    # Check for administrator privileges
    if not is_admin():
        print("ERROR: Administrator privileges required to install the service.")
        print("Please right-click on the installer or command prompt and select 'Run as administrator'.")
        print("Alternatively, you can run Huntarr directly without service installation:")
        print("  python main.py --no-service")
        return False
        
    try:
        # Ensure config directories exist and are writable
        try:
            from primary.utils import config_paths
            print(f"Using config directory: {config_paths.CONFIG_DIR}")
            
            # Ensure we can write to config directory
            try:
                test_file = os.path.join(config_paths.CONFIG_DIR, "service_test.tmp")
                with open(test_file, "w") as f:
                    f.write("Service installation test")
                if os.path.exists(test_file):
                    os.remove(test_file)
                    print("Config directory is writable.")
                else:
                    print("WARNING: Could not verify config directory is writable!")
                    return False
            except Exception as e:
                print(f"ERROR: Config directory is not writable: {e}")
                print("Service installation cannot continue without writable config directory.")
                return False
        except Exception as e:
            print(f"ERROR: Could not initialize config paths: {e}")
            print("Service installation cannot continue.")
            return False
            
        try:
            # First, try to remove any existing service with the same name
            remove_service(silent=True)
            
            # If we're running from a PyInstaller binary, use that directly
            if getattr(sys, 'frozen', False):
                # Running from a PyInstaller bundle
                service_cmd = f"\"{os.path.abspath(sys.executable)}\""  # Quoted path to the exe
                win32serviceutil.InstallService(
                    pythonClassString = None,
                    serviceName = "Huntarr",
                    displayName = "Huntarr Service",
                    description = "Automated media collection management for Arr apps",
                    startType = win32service.SERVICE_AUTO_START,
                    exeName = service_cmd,
                    exeArgs = ""
                )
                print("Successfully installed Huntarr as a Windows service using the executable.")
            else:
                # Running from Python source - use pythonClassString for the service
                # Get the module path in dot notation
                module_path = "src.primary.windows_service.HuntarrService"
                win32serviceutil.InstallService(
                    pythonClassString = module_path,
                    serviceName = "Huntarr",
                    displayName = "Huntarr Service",
                    description = "Automated media collection management for Arr apps",
                    startType = win32service.SERVICE_AUTO_START,
                )
                print("Successfully installed Huntarr as a Windows service using the Python class.")
            
            # Setup service security
            service_acl = win32security.SECURITY_ATTRIBUTES()
            service_dacl = win32security.ACL()
            service_sid = win32security.GetTokenInformation(
                win32security.OpenProcessToken(win32api.GetCurrentProcess(), win32con.TOKEN_QUERY),
                win32security.TokenUser
            )[0]
            service_dacl.AddAccessAllowedAce(win32security.ACL_REVISION, win32con.GENERIC_ALL, service_sid)
            service_acl.SetSecurityDescriptorDacl(1, service_dacl, 0)
            
            schSCManager = win32service.OpenSCManager(None, None, win32service.SC_MANAGER_ALL_ACCESS)
            try:
                schService = win32service.OpenService(schSCManager, "Huntarr", win32service.SERVICE_ALL_ACCESS)
                try:
                    # Set basic service security
                    win32service.SetServiceObjectSecurity(schService, 
                                                        win32security.DACL_SECURITY_INFORMATION, 
                                                        service_acl.SECURITY_DESCRIPTOR)
                    print("Successfully set service security.")
                except Exception as security_error:
                    print(f"Warning: Could not set service security: {security_error}")
                win32service.CloseServiceHandle(schService)
            except Exception as service_error:
                print(f"Warning: Could not open service for security setup: {service_error}")
            win32service.CloseServiceHandle(schSCManager)
            
            # Set permissions for config and log directories
            try:
                from primary.utils import config_paths
                config_dir = config_paths.CONFIG_DIR
                
                # Use icacls to set broad permissions for service access
                # This is similar to what the installer does but as a fallback
                os.system(f'icacls "{config_dir}" /grant Everyone:(OI)(CI)F /T')
                print(f"Set permissions on config directory: {config_dir}")
                
                # Also ensure the parent directory of the executable has permissions if using PyInstaller
                if getattr(sys, 'frozen', False):
                    exe_dir = os.path.dirname(os.path.abspath(sys.executable))
                    os.system(f'icacls "{exe_dir}" /grant Everyone:(OI)(CI)F /T')
                    print(f"Set permissions on executable directory: {exe_dir}")
            except Exception as perm_error:
                print(f"Warning: Could not set directory permissions: {perm_error}")
            
            print("\nHuntarr service installation complete.")
            print("You can now start the service with: net start Huntarr")
            print("Or access Huntarr at: http://localhost:9705")
            
            # Try to start the service automatically
            try:
                win32serviceutil.StartService("Huntarr")
                print("\nHuntarr service started successfully.")
                
                # If service starts successfully, open the browser after a short delay
                import webbrowser
                import threading
                threading.Timer(3.0, lambda: webbrowser.open('http://localhost:9705')).start()
                print("Opening web browser to Huntarr interface...")
            except Exception as start_error:
                print(f"\nNote: Could not automatically start the service: {start_error}")
                print("Please start it manually using: net start Huntarr")
            
            return True
            
        except Exception as install_error:
            print(f"Error installing service: {install_error}")
            print("\nYou can still run Huntarr without the service using:")
            print("  python main.py --no-service")
            if 'Access is denied' in str(install_error):
                print("\nAccess denied error detected. Try running as Administrator.")
            return False
        
    except Exception as outer_error:
        print(f"Unexpected error during service installation: {outer_error}")
        return False


def remove_service(silent=False):
    """Remove the Huntarr Windows service
    
    Args:
        silent (bool): If True, don't print status messages
    
    Returns:
        bool: True if removal succeeded or service doesn't exist, False otherwise
    """
    if sys.platform != 'win32':
        if not silent:
            print("Windows service removal is only available on Windows.")
        return False
        
    # Check for administrator privileges
    if not is_admin():
        if not silent:
            print("ERROR: Administrator privileges required to remove the Huntarr service.")
            print("Please right-click on the command prompt and select 'Run as administrator'.\n")
        return False
        
    try:
        # Stop the service if it's running
        try:
            win32serviceutil.StopService("Huntarr")
            # Give it a moment to stop
            time.sleep(2)
            if not silent:
                print("Stopped Huntarr service.")
        except Exception as e:
            logger.info(f"Could not stop service (it may not be running): {e}")
        
        # Remove the service
        win32serviceutil.RemoveService("Huntarr")
        if not silent:
            print("Huntarr service removed successfully.")
        return True
    except Exception as e:
        if not silent:
            print(f"Error removing Huntarr service: {e}")
            if 'service does not exist' in str(e).lower():
                print("(Service was not installed or was already removed)")
        # Consider it a success if the service doesn't exist
        if 'service does not exist' in str(e).lower():
            return True
        return False


def run_as_cli():
    """Run Huntarr as a command-line application (non-service fallback)"""
    try:
        print("Starting Huntarr in CLI mode (non-service)...")
        
        # Import the necessary modules
        from primary.background import start_huntarr, stop_event, shutdown_threads
        from primary.web_server import app
        from waitress import serve
        import threading
        
        # Configure CLI environment
        os.environ['FLASK_HOST'] = '0.0.0.0'
        os.environ['PORT'] = '9705'
        os.environ['DEBUG'] = 'false'
        
        # Ensure config directories exist
        from primary.utils import config_paths
        print(f"Using config directory: {config_paths.CONFIG_DIR}")
        
        # Verify config directories are writable with a test file
        try:
            test_file = os.path.join(config_paths.CONFIG_DIR, "cli_test.tmp")
            with open(test_file, "w") as f:
                f.write("CLI mode test")
            if os.path.exists(test_file):
                os.remove(test_file)
                print("Config directory is writable.")
            else:
                print("WARNING: Could not verify config directory is writable!")
        except Exception as e:
            print(f"WARNING: Config directory may not be writable: {e}")
            print(f"Some features may not work correctly.")
        
        # Start background tasks in a thread
        background_thread = threading.Thread(
            target=start_huntarr, 
            name="HuntarrBackground", 
            daemon=True
        )
        background_thread.start()
        
        # Print a welcome message
        print("="*80)
        print(" Huntarr Started Successfully in CLI Mode")
        print(" Web interface available at: http://localhost:9705")
        print(" Press Ctrl+C to exit")
        print("="*80)
        
        # Start the web server (blocking)
        serve(app, host='0.0.0.0', port=9705, threads=8)
        
    except KeyboardInterrupt:
        print("\nKeyboard interrupt received. Shutting down...")
        if not stop_event.is_set():
            stop_event.set()
    except Exception as e:
        print(f"\nError in CLI mode: {e}")
        if 'stop_event' in locals() and not stop_event.is_set():
            stop_event.set()
    finally:
        print("Huntarr shutdown complete.")
        return 0


if __name__ == '__main__':
    if len(sys.argv) > 1:
        if sys.argv[1] == 'install':
            install_service()
        elif sys.argv[1] == 'remove':
            remove_service()
        elif sys.argv[1] == 'cli':
            run_as_cli()
        else:
            win32serviceutil.HandleCommandLine(HuntarrService)
    else:
        win32serviceutil.HandleCommandLine(HuntarrService)
