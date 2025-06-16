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
    logs_dir = config_paths.LOGS_DIR
except Exception as e:
    # Fallback if config_paths module can't be imported yet
    config_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'config')
    logs_dir = os.path.join(config_dir, 'logs')
    os.makedirs(logs_dir, exist_ok=True)

# Configure basic logging
logging.basicConfig(
    filename=os.path.join(logs_dir, 'windows_service.log'),
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('HuntarrWindowsService')

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
        # Report service as starting but not started yet
        # This critical step signals Windows that service initialization is underway
        self.ReportServiceStatus(win32service.SERVICE_START_PENDING)
        
        try:
            # Log the start attempt first
            servicemanager.LogMsg(
                servicemanager.EVENTLOG_INFORMATION_TYPE,
                servicemanager.PYS_SERVICE_STARTING,
                (self._svc_name_, 'Service is starting...')
            )
            
            # Update logging to ensure output is properly captured
            logging.basicConfig(
                filename=os.path.join(logs_dir, 'windows_service.log'),
                level=logging.INFO,
                format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
            )
            
            # Mark service as running
            self.is_running = True
            
            # Enter the main service function
            self.main()
            
        except Exception as e:
            # Log any startup errors and mark service as stopped
            servicemanager.LogErrorMsg(f"Failed to start service: {e}")
            self.ReportServiceStatus(win32service.SERVICE_STOPPED)
        
    def main(self):
        """Main service loop"""
        try:
            logger.info('Starting Huntarr service...')
            
            # Create a service-specific log file
            service_log_file = os.path.join(logs_dir, 'huntarr_service_runtime.log')
            try:
                with open(service_log_file, 'a') as f:
                    f.write(f"\n\n--- Service started at {time.ctime()} ---\n")
                    f.write(f"Current directory: {os.getcwd()}\n")
                    f.write(f"Python executable: {sys.executable}\n")
                    if hasattr(sys, 'frozen'):
                        f.write("Running as PyInstaller bundle\n")
                    else:
                        f.write("Running as Python script\n")
            except Exception as e:
                logger.error(f"Could not write to service log file: {e}")
            
            # Signal we're starting
            self.ReportServiceStatus(win32service.SERVICE_START_PENDING)
            
            # Import dependencies - do this early to catch import errors
            import threading
            try:
                from primary.background import start_huntarr, stop_event, shutdown_threads
                from primary.web_server import app
                from waitress import serve
                logger.info("Successfully imported required modules")
            except Exception as e:
                servicemanager.LogErrorMsg(f"Failed to import required modules: {e}")
                logger.error(f"Critical error importing modules: {e}")
                return
            
            # Store the stop event for proper shutdown
            self.stop_flag = stop_event
            
            # Configure service environment
            os.environ['FLASK_HOST'] = '0.0.0.0'
            os.environ['PORT'] = '9705'
            os.environ['DEBUG'] = 'false'
            
            # Report status update to prevent timeout
            self.ReportServiceStatus(win32service.SERVICE_START_PENDING)
            
            # Make sure config directories exist before proceeding
            try:
                # Import config paths directly to avoid circular imports
                from primary.utils.config_paths import ensure_directories
                ensure_directories()
                logger.info("Service verified config directories exist")
            except Exception as e:
                logger.error(f"Error ensuring config directories: {e}")
                servicemanager.LogErrorMsg(f"Error ensuring directories: {e}")
                # Create basic directories as fallback
                try:
                    app_root = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
                    for dir_name in ['config', 'logs']:
                        os.makedirs(os.path.join(app_root, dir_name), exist_ok=True)
                    logger.info("Created basic directories as fallback")
                except Exception as e2:
                    logger.error(f"Critical error creating directories: {e2}")
                    servicemanager.LogErrorMsg(f"Failed to create basic directories: {e2}")
                    return  # Exit if we can't create basic directories
            
            # Start background tasks in a thread with better error handling
            try:
                background_thread = threading.Thread(
                    target=start_huntarr, 
                    name="HuntarrBackground", 
                    daemon=True
                )
                background_thread.start()
                logger.info("Started background thread successfully")
            except Exception as e:
                logger.error(f"Failed to start background thread: {e}")
                servicemanager.LogErrorMsg(f"Failed to start background thread: {e}")
            
            # Start the web server in a thread with better error handling
            try:
                # One more status update - Windows needs to hear from us regularly during startup
                self.ReportServiceStatus(win32service.SERVICE_START_PENDING)
                
                # Create and start the web server thread
                web_thread = threading.Thread(
                    target=lambda: serve(app, host='0.0.0.0', port=9705, threads=4),  # Reduced thread count for better stability
                    name="HuntarrWebServer",
                    daemon=True
                )
                web_thread.start()
                logger.info("Started web server thread successfully")
            except Exception as e:
                logger.error(f"Failed to start web server thread: {e}")
                servicemanager.LogErrorMsg(f"Failed to start web server thread: {e}")
                return  # Exit service if web server can't start
            
            # Now finally report that service is running
            self.ReportServiceStatus(win32service.SERVICE_RUNNING)
            
            logger.info('Huntarr service started successfully')
            servicemanager.LogMsg(
                servicemanager.EVENTLOG_INFORMATION_TYPE,
                servicemanager.PYS_SERVICE_STARTED,
                (self._svc_name_, 'Service is running')
            )
            
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
    except:
        return False

def install_service():
    """Install Huntarr as a Windows service"""
    if sys.platform != 'win32':
        print("Windows service installation is only available on Windows.")
        return False
    
    import subprocess  # For SC.EXE commands
    
    # Check for administrator privileges
    if not is_admin():
        print("ERROR: Administrator privileges required to install the service.")
        print("Please right-click on the installer or command prompt and select 'Run as administrator'.")
        print("Alternatively, you can run Huntarr directly without service installation using '--no-service'.")
        return False
        
    try:
        # Set up logging for service installation
        log_file = os.path.join(logs_dir, 'service_install.log')
        os.makedirs(os.path.dirname(log_file), exist_ok=True)
        with open(log_file, 'a') as f:
            f.write(f"\n\n--- Service installation started at {time.ctime()} ---\n")
            f.write(f"Python executable: {sys.executable}\n")
            f.write(f"Current directory: {os.getcwd()}\n")
            
        # Get the executable path - simplify based on whether we're running from frozen exe
        if getattr(sys, 'frozen', False):
            # We're running from a PyInstaller bundle
            exe_path = os.path.abspath(sys.executable)
            logger.info(f"Using PyInstaller executable for service: {exe_path}")
            
            with open(log_file, 'a') as f:
                f.write(f"Executable path: {exe_path}\n")
                f.write(f"Executable exists: {os.path.exists(exe_path)}\n")
            
            # Verify the executable exists
            if not os.path.exists(exe_path):
                logger.error(f"ERROR: Executable not found at {exe_path}")
                print(f"ERROR: Executable not found at {exe_path}")
                return False
        else:
            # We're running as a Python script
            exe_path = sys.executable
            script_path = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'main.py'))
            logger.info(f"Using Python for service: {exe_path} with script {script_path}")
            
            with open(log_file, 'a') as f:
                f.write(f"Python path: {exe_path}\n")
                f.write(f"Script path: {script_path}\n")
                f.write(f"Python exists: {os.path.exists(exe_path)}\n")
                f.write(f"Script exists: {os.path.exists(script_path)}\n")
            
            if not os.path.exists(script_path):
                logger.error(f"ERROR: Script not found at {script_path}")
                print(f"ERROR: Script not found at {script_path}")
                return False
        python_exe = sys.executable
        script_path = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'main.py'))
        
        # Prepare service command - make it simple and reliable
        if getattr(sys, 'frozen', False):
            # We're running from a PyInstaller bundle - use direct path to executable
            exe_cmd = f'"{exe_path}" --service'
            with open(log_file, 'a') as f:
                f.write(f"Service command (frozen): {exe_cmd}\n")
        else:
            # We're running as a Python script - use pythonw.exe to avoid console window
            # Use pythonw for service to avoid console window
            pythonw_exe = os.path.join(os.path.dirname(sys.executable), 'pythonw.exe')
            if not os.path.exists(pythonw_exe):
                pythonw_exe = sys.executable  # Fall back to regular python if pythonw not found
            
            exe_cmd = f'"{pythonw_exe}" "{script_path}" --service'
            with open(log_file, 'a') as f:
                f.write(f"Service command (script): {exe_cmd}\n")
        
        # No need to manually remove the service as our batch file will handle it
        # Just log that we'll be removing any existing service
        logger.info("Batch file will remove any existing Huntarr service...")
        with open(log_file, 'a') as f:
            f.write("Will automatically remove any existing Huntarr service\n")
        
        with open(log_file, 'a') as f:
            f.write("Attempting service installation...\n")
        
        # === DIRECT SC.EXE INSTALLATION - most reliable method ===
        try:
            # Try a completely different approach - use windows-native batch script to create service
            # This will avoid all the quoting hell with SC.exe commands
            
            # Create a temporary batch file to run the SC commands
            batch_file = os.path.join(os.environ.get('TEMP', '.'), 'huntarr_service_install.bat')
            with open(batch_file, 'w') as f:
                if getattr(sys, 'frozen', False):
                    # For PyInstaller bundle
                    f.write(f'@echo off\r\n')
                    f.write(f'echo Installing Huntarr service...\r\n')
                    f.write(f'sc stop Huntarr\r\n')  
                    f.write(f'sc delete Huntarr\r\n')
                    f.write(f'sc create Huntarr binPath= "{exe_path} --service" start= auto DisplayName= "Huntarr Service"\r\n')
                    f.write(f'sc description Huntarr "Automated media collection management for Arr apps"\r\n')
                    f.write(f'sc start Huntarr\r\n')
                else:
                    # For Python script
                    f.write(f'@echo off\r\n')
                    f.write(f'echo Installing Huntarr service...\r\n')
                    f.write(f'sc stop Huntarr\r\n')  
                    f.write(f'sc delete Huntarr\r\n')
                    f.write(f'sc create Huntarr binPath= "{sys.executable} \"{script_path}\" --service" start= auto DisplayName= "Huntarr Service"\r\n')
                    f.write(f'sc description Huntarr "Automated media collection management for Arr apps"\r\n')
                    f.write(f'sc start Huntarr\r\n')
            
            # Log the batch file contents
            with open(log_file, 'a') as f:
                f.write("Created batch file for service installation:\n")
                with open(batch_file, 'r') as bf:
                    f.write(bf.read() + "\n")
            
            # Run the batch file
            with open(log_file, 'a') as f:
                f.write("Running service installation batch file...\n")
                
            result = subprocess.run(batch_file, shell=True, capture_output=True, text=True)
            
            # Log the results
            with open(log_file, 'a') as f:
                f.write(f"Batch execution result code: {result.returncode}\n")
                if result.stdout:
                    f.write(f"STDOUT: {result.stdout}\n")
                if result.stderr:
                    f.write(f"STDERR: {result.stderr}\n")
            
            # Clean up the batch file
            try:
                os.unlink(batch_file)
            except:
                pass
                
            # Check for errors
            if result.returncode != 0:
                raise Exception(f"Batch service installation failed with code {result.returncode}")
                
            # Log success
            with open(log_file, 'a') as f:
                f.write("Service created successfully through batch script\n")
                
            # Sleep briefly to give the service time to start
            time.sleep(3)
                
            logger.info("Huntarr service installed successfully")
            
            # Quick check if service is now present
            query_result = subprocess.run('sc query Huntarr', shell=True, capture_output=True, text=True)
            with open(log_file, 'a') as f:
                if "STATE" in query_result.stdout:
                    f.write(f"Service was created and is present in system\n")
                    f.write(query_result.stdout)
                else:
                    f.write(f"NOTE: Service may not be present in system\n")
                    
            print("Huntarr service was created successfully.")
            
            # We'll skip the manual starting here since the batch file already tries to start it
            # The batch file approach combines service creation and starting
            
        except Exception as e:
            logger.error(f"Service installation failed: {e}")
            with open(log_file, 'a') as f:
                f.write(f"SERVICE INSTALLATION FAILED: {e}\n")
            print(f"Service installation failed: {e}")
            return False
        
        # The batch file already tries to start the service, but we can check its status
        try:
            # Brief pause to allow service to start up
            time.sleep(1)
            
            logger.info("Checking Huntarr service status...")
            with open(log_file, 'a') as f:
                f.write("Checking service status...\n")
                
            # Check service state
            query_result = subprocess.run('sc query Huntarr', shell=True, capture_output=True, text=True)
            is_running = "RUNNING" in query_result.stdout
            
            with open(log_file, 'a') as f:
                f.write(f"Service query result:\n{query_result.stdout}\n")
                
            if is_running:
                print("Huntarr service installed and started successfully!")
                logger.info("Huntarr service is running")
                with open(log_file, 'a') as f:
                    f.write("Service is running successfully!\n")
            else:
                # Service was created but may not be running yet
                print("Service was created but might not be running yet.")
                print("Options:")
                print("1. Wait a moment and check Services control panel")
                print("2. Try running Huntarr with the 'Run without service' option")
                with open(log_file, 'a') as f:
                    f.write("Service installed but may not be running yet.\n")
        except Exception as e:
            # This is just for checking service status, not critical
            logger.warning(f"Could not check service status: {e}")
            with open(log_file, 'a') as f:
                f.write(f"NOTE: Could not verify service status: {e}\n")
            print("Service was installed but status could not be verified.")
            print("You can check Services control panel or try the 'Run without service' option.")
        
        return True
    except Exception as e:
        logger.error(f"Error installing Huntarr service: {e}")
        print(f"Error installing Huntarr service: {e}")
        print("Fallback: You can run Huntarr directly using the 'Run without service' option.")
        return False


def remove_service():
    """Remove the Huntarr Windows service"""
    if sys.platform != 'win32':
        print("Windows service removal is only available on Windows.")
        return False
    
    # Check for administrator privileges
    if not is_admin():
        print("ERROR: Administrator privileges required to remove the service.")
        print("Please right-click on the command prompt and select 'Run as administrator'.")
        return False
        
    try:
        # Stop the service first if it's running
        try:
            win32serviceutil.StopService("Huntarr")
            print("Huntarr service stopped.")
            time.sleep(2)  # Wait for service to fully stop
        except Exception as e:
            print(f"Note: Could not stop the service (it may already be stopped): {e}")
        
        # Now remove the service
        win32serviceutil.RemoveService("Huntarr")
        print("Huntarr service removed successfully.")
        return True
    except Exception as e:
        print(f"Error removing Huntarr service: {e}")
        return False


def run_as_cli():
    """Run Huntarr as a command-line application (non-service fallback)"""
    try:
        # Import required modules
        import threading
        from primary.background import start_huntarr, stop_event
        from primary.web_server import app
        from waitress import serve
        
        print("Starting Huntarr in command-line mode...")
        
        # Start background tasks in a thread
        background_thread = threading.Thread(
            target=start_huntarr, 
            name="HuntarrBackground", 
            daemon=True
        )
        background_thread.start()
        
        # Run the web server directly (blocking)
        print("Starting web server on http://localhost:9705")
        print("Press Ctrl+C to stop")
        serve(app, host='0.0.0.0', port=9705, threads=8)
    except KeyboardInterrupt:
        print("\nStopping Huntarr...")
        if not stop_event.is_set():
            stop_event.set()
        # Give threads time to clean up
        time.sleep(2)
    except Exception as e:
        print(f"Error running Huntarr in command-line mode: {e}")

if __name__ == '__main__':
    if len(sys.argv) > 1:
        if sys.argv[1] == '--install-service' or sys.argv[1] == 'install':
            install_service()
        elif sys.argv[1] == '--remove-service' or sys.argv[1] == 'remove':
            remove_service()
        elif sys.argv[1] == '--no-service' or sys.argv[1] == 'cli':
            run_as_cli()
        elif sys.argv[1] == '--service':
            # Service mode - let win32serviceutil handle it directly
            servicemanager.Initialize()
            servicemanager.PrepareToHostSingle(HuntarrService)
            servicemanager.StartServiceCtrlDispatcher()
        else:
            win32serviceutil.HandleCommandLine(HuntarrService)
    else:
        win32serviceutil.HandleCommandLine(HuntarrService)
