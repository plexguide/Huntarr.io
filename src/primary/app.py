import logging
import json
import pathlib
from datetime import datetime
import time

class WebAddressFilter(logging.Filter):
    """Filter out web interface availability messages"""
    def filter(self, record):
        if "Web interface available at http://" in record.getMessage():
            return False
        return True

def configure_logging():
    # Disable this logging configuration to prevent duplicates
    # The main logging is handled by src/primary/utils/logger.py
    pass
    
    # Get timezone set in the environment (this will be updated when user changes the timezone in UI)
    # try:
    #     # Create a custom formatter that includes timezone information
    #     class TimezoneFormatter(logging.Formatter):
    #         def __init__(self, *args, **kwargs):
    #             super().__init__(*args, **kwargs)
    #             self.converter = time.localtime  # Use local time instead of UTC
    #             
    #         def formatTime(self, record, datefmt=None):
    #             ct = self.converter(record.created)
    #             if datefmt:
    #                 return time.strftime(datefmt, ct)
    #             else:
    #                 # Use local time without timezone suffix for consistency
    #                 return time.strftime("%Y-%m-%d %H:%M:%S", ct)
    #     
    #     # Configure the formatter for all handlers
    #     formatter = TimezoneFormatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    #     
    #     # Reset the root logger and reconfigure with proper timezone handling
    #     for handler in logging.root.handlers[:]:
    #         logging.root.removeHandler(handler)
    #     
    #     logging.basicConfig(level=logging.INFO)
    #     
    #     # Apply the formatter to all handlers
    #     for handler in logging.root.handlers:
    #         handler.setFormatter(formatter)
    #         
    # except Exception as e:
    #     # Fallback to basic logging if any issues
    #     logging.basicConfig(level=logging.INFO, 
    #                        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    #     logging.error(f"Error setting up timezone-aware logging: {e}")
    # 
    # # Add filter to remove web interface URL logs
    # for handler in logging.root.handlers:
    #     handler.addFilter(WebAddressFilter())
    
    logging.info("Logging is configured.")

# Legacy migration function removed - settings are now stored in database

if __name__ == "__main__":
    configure_logging()
    logging.info("Starting Huntarr application")
    
    # Legacy migration removed - settings are now stored in database
    
    # Using filtered logging
    logging.info("Web interface available at http://localhost:8080")
    logging.info("Application started")