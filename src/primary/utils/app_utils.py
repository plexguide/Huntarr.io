import socket
from urllib.parse import urlparse
from src.primary.config import API_URL

def get_ip_address():
    try:
        parsed_url = urlparse(API_URL)
        hostname = parsed_url.netloc
        if ':' in hostname:
            hostname = hostname.split(':')[0]
        return hostname
    except Exception:
        try:
            hostname = socket.gethostname()
            ip = socket.gethostbyname(hostname)
            return ip
        except:
            return "localhost"

def _get_user_timezone():
    """Get the user's selected timezone from general settings"""
    try:
        from src.primary.utils.timezone_utils import get_user_timezone
        return get_user_timezone()
    except Exception:
        import pytz
        return pytz.UTC

def write_log(log_file, message):
    from datetime import datetime
    
    # Use user's selected timezone
    user_tz = _get_user_timezone()
    now = datetime.now(user_tz)
    timestamp = now.strftime("%Y-%m-%d %H:%M:%S")
    
    # Add timezone information
    timezone_name = str(user_tz)
    timestamp_with_tz = f"{timestamp} {timezone_name}"
    
    with open(log_file, 'a') as f:
        f.write(f"{timestamp_with_tz} - {message}\n")
