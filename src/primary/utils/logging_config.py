import logging
from logging.handlers import RotatingFileHandler
import os
import gzip
import shutil

class SensitiveInfoFilter(logging.Filter):
    """Filter out sensitive information from logs"""
    def filter(self, record):
        message = record.getMessage()
        # Filter out web interface URLs
        if "Web interface available at http://" in message:
            return False
        # Add more filters as needed
        return True

def rotator_with_compression(source, dest):
    """Rotate log file and compress it"""
    try:
        # Compress the rotated log
        with open(source, 'rb') as f_in:
            with gzip.open(f'{dest}.gz', 'wb') as f_out:
                shutil.copyfileobj(f_in, f_out)
        # Remove the uncompressed source file
        os.remove(source)
    except Exception as e:
        print(f"Error compressing log file {source}: {e}")
        # Fallback to just renaming if compression fails
        try:
            if os.path.exists(source):
                shutil.move(source, dest)
        except:
            pass

def setup_rotating_file_handler(log_file_path, settings):
    """Setup a rotating file handler with compression"""
    try:
        # Get settings
        rotation_enabled = settings.get('rotation_enabled', True)
        max_size_mb = settings.get('max_log_size_mb', 50)
        backup_count = settings.get('backup_count', 5)
        compress_rotated = settings.get('compress_rotated', True)
        log_level = settings.get('log_level', 'INFO')
        
        if not rotation_enabled:
            # Use regular file handler if rotation is disabled
            handler = logging.FileHandler(log_file_path, encoding='utf-8')
        else:
            # Use rotating file handler
            max_bytes = max_size_mb * 1024 * 1024  # Convert MB to bytes
            handler = RotatingFileHandler(
                filename=log_file_path,
                maxBytes=max_bytes,
                backupCount=backup_count,
                encoding='utf-8'
            )
            
            # Set custom rotator if compression is enabled
            if compress_rotated:
                handler.rotator = rotator_with_compression
        
        # Set format
        formatter = logging.Formatter(
            '%(asctime)s - %(name)s - %(levelname)s - %(message)s',
            datefmt='%Y-%m-%d %H:%M:%S'
        )
        handler.setFormatter(formatter)
        
        # Set level
        level_map = {
            'DEBUG': logging.DEBUG,
            'INFO': logging.INFO,
            'WARNING': logging.WARNING,
            'ERROR': logging.ERROR,
            'CRITICAL': logging.CRITICAL
        }
        handler.setLevel(level_map.get(log_level.upper(), logging.INFO))
        
        # Add sensitive info filter
        handler.addFilter(SensitiveInfoFilter())
        
        return handler
        
    except Exception as e:
        print(f"Error setting up rotating file handler: {e}")
        # Fallback to basic file handler
        handler = logging.FileHandler(log_file_path, encoding='utf-8')
        handler.setFormatter(logging.Formatter(
            '%(asctime)s - %(name)s - %(levelname)s - %(message)s',
            datefmt='%Y-%m-%d %H:%M:%S'
        ))
        handler.addFilter(SensitiveInfoFilter())
        return handler

def configure_logging(level=logging.INFO):
    """Configure logging with filters for sensitive information"""
    # Basic config
    logging.basicConfig(
        level=level,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    
    # Add the filter to all handlers
    for handler in logging.root.handlers:
        handler.addFilter(SensitiveInfoFilter())
    
    # Individual loggers can also be configured here
    logger = logging.getLogger('huntarr')
    logger.setLevel(level)
    
    for handler in logger.handlers:
        handler.addFilter(SensitiveInfoFilter())
    
    return logger
