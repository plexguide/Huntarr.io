#!/usr/bin/env python3
"""Hourly API Cap Scheduler for Huntarr
Handles checking time and resetting hourly API caps at the top of each hour (00 minute mark)
"""

import threading
import time
import datetime
import traceback
import logging

# Try both import patterns to handle different module contexts
try:
    # When imported from the main app
    from src.primary.utils.logger import get_logger
    from src.primary.stats_manager import reset_hourly_caps
    logger = get_logger("hourly_caps")
except ImportError:
    try:
        # When imported within the package
        from primary.utils.logger import get_logger
        from primary.stats_manager import reset_hourly_caps
        logger = get_logger("hourly_caps")
    except ImportError:
        # Fallback to standard logging in case neither works
        logging.basicConfig(level=logging.INFO)
        logger = logging.getLogger("hourly_caps")
        logger.error("Failed to import Huntarr modules, using fallback logging")

# Print startup message to help with debugging
print("Hourly API Cap Scheduler module loaded")
logger.info("Hourly API Cap Scheduler module initialized")

# Global variables
stop_event = threading.Event()
scheduler_thread = None

def check_and_reset_caps():
    """
    Check if it's the top of the hour (00 minute mark) and reset hourly API caps if needed
    """
    try:
        current_time = datetime.datetime.now()
        
        # Only reset at the top of the hour (minute 0)
        if current_time.minute == 0:
            logger.debug(f"Hourly reset triggered at {current_time.hour}:00")
            try:
                success = reset_hourly_caps()
                if success:
                    logger.debug(f"Successfully reset hourly API caps at {current_time.hour}:00")
                else:
                    logger.error(f"Failed to reset hourly API caps at {current_time.hour}:00")
            except Exception as e:
                logger.error(f"Exception when resetting hourly caps: {e}")
                logger.error(traceback.format_exc())
        else:
            logger.debug(f"Not time to reset hourly caps yet. Current time: {current_time.hour}:{current_time.minute}")
    except Exception as e:
        logger.error(f"Unexpected error in check_and_reset_caps: {e}")
        logger.error(traceback.format_exc())

def scheduler_loop():
    """
    Main loop for the scheduler thread
    Checks time every 30 seconds and resets caps if needed
    """
    try:
        logger.info("Starting hourly API cap scheduler")
        print("Hourly API cap scheduler thread starting")
        
        # Initial check on startup
        check_and_reset_caps()
        
        while not stop_event.is_set():
            try:
                # Sleep for 30 seconds between checks
                # This ensures we won't miss the top of the hour
                stop_event.wait(30)
                
                if stop_event.is_set():
                    logger.info("Stop event detected, exiting scheduler loop")
                    break
                    
                # Check if it's time to reset the caps
                check_and_reset_caps()
                    
            except Exception as e:
                logger.error(f"Error in hourly cap scheduler loop: {e}")
                logger.error(traceback.format_exc())
                # Sleep briefly to avoid spinning in case of repeated errors
                time.sleep(5)
        
        logger.info("Hourly API cap scheduler stopped")
    except Exception as e:
        logger.error(f"Fatal error in scheduler_loop: {e}")
        logger.error(traceback.format_exc())
        print(f"FATAL ERROR in hourly cap scheduler: {e}")

def start_scheduler():
    """
    Start the hourly API cap scheduler thread
    """
    global scheduler_thread
    
    try:
        logger.info("Attempting to start hourly API cap scheduler")
        print("Attempting to start hourly API cap scheduler")
        
        if scheduler_thread and scheduler_thread.is_alive():
            logger.info("Hourly API cap scheduler already running")
            return
        
        # Reset the stop event
        stop_event.clear()
        
        # Create and start the scheduler thread
        scheduler_thread = threading.Thread(target=scheduler_loop, name="HourlyCapScheduler", daemon=True)
        scheduler_thread.start()
        
        logger.info(f"Hourly API cap scheduler started. Thread is alive: {scheduler_thread.is_alive()}")
        print(f"Hourly API cap scheduler started. Thread is alive: {scheduler_thread.is_alive()}")
        return True
    except Exception as e:
        logger.error(f"Failed to start hourly API cap scheduler: {e}")
        logger.error(traceback.format_exc())
        print(f"Failed to start hourly API cap scheduler: {e}")
        return False

def stop_scheduler():
    """
    Stop the hourly API cap scheduler thread
    """
    global scheduler_thread
    
    if not scheduler_thread or not scheduler_thread.is_alive():
        logger.info("Hourly API cap scheduler not running")
        return
    
    # Signal the thread to stop
    stop_event.set()
    
    # Wait for the thread to terminate (with timeout)
    scheduler_thread.join(timeout=5.0)
    
    if scheduler_thread.is_alive():
        logger.warning("Hourly API cap scheduler did not terminate gracefully")
    else:
        logger.info("Hourly API cap scheduler stopped gracefully")
