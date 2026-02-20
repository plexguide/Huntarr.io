"""
TMDB Image Cache Manager
Handles server-side caching of TMDB images
"""

import os
import time
import hashlib
import requests
from pathlib import Path
from src.primary.utils.logger import logger
from src.primary.utils.config_paths import CONFIG_DIR


class TMDBImageCache:
    """Server-side TMDB image cache manager"""
    
    def __init__(self):
        self.cache_dir = self._get_cache_dir()
        self._ensure_cache_dir()
        
    def _get_cache_dir(self):
        """Get the cache directory path"""
        cache_path = os.path.join(CONFIG_DIR, 'tmdb_cache')
        return cache_path
    
    def _ensure_cache_dir(self):
        """Ensure cache directory exists"""
        try:
            os.makedirs(self.cache_dir, exist_ok=True)
            logger.debug(f"TMDB cache directory: {self.cache_dir}")
        except Exception as e:
            logger.error(f"Failed to create TMDB cache directory: {e}")
    
    def _get_cache_key(self, url):
        """Generate cache key from URL"""
        return hashlib.md5(url.encode()).hexdigest()
    
    def _get_cache_path(self, cache_key):
        """Get full path for cached file"""
        return os.path.join(self.cache_dir, f"{cache_key}.jpg")
    
    def _get_metadata_path(self, cache_key):
        """Get full path for metadata file"""
        return os.path.join(self.cache_dir, f"{cache_key}.meta")
    
    def is_cached(self, url, max_age_days=7):
        """Check if image is cached and still valid"""
        cache_key = self._get_cache_key(url)
        cache_path = self._get_cache_path(cache_key)
        meta_path = self._get_metadata_path(cache_key)
        
        if not os.path.exists(cache_path) or not os.path.exists(meta_path):
            return False
        
        try:
            # Check age
            with open(meta_path, 'r') as f:
                timestamp = float(f.read().strip())
            
            age_seconds = time.time() - timestamp
            max_age_seconds = max_age_days * 24 * 60 * 60
            
            return age_seconds < max_age_seconds
        except Exception as e:
            logger.error(f"Error checking cache validity: {e}")
            return False
    
    def get_cached_path(self, url):
        """Get path to cached image if it exists and is valid"""
        cache_key = self._get_cache_key(url)
        cache_path = self._get_cache_path(cache_key)
        
        if os.path.exists(cache_path):
            return cache_path
        return None
    
    def cache_image(self, url):
        """Download and cache image from URL"""
        cache_key = self._get_cache_key(url)
        cache_path = self._get_cache_path(cache_key)
        meta_path = self._get_metadata_path(cache_key)
        
        try:
            # Download image
            response = requests.get(url, timeout=10)
            response.raise_for_status()
            
            # Save image
            with open(cache_path, 'wb') as f:
                f.write(response.content)
            
            # Save metadata (timestamp)
            with open(meta_path, 'w') as f:
                f.write(str(time.time()))
            
            return cache_path
        except Exception as e:
            logger.error(f"Failed to cache image from {url}: {e}")
            return None
    
    def cleanup_expired(self, max_age_days=7):
        """Remove expired cache entries"""
        try:
            removed_count = 0
            max_age_seconds = max_age_days * 24 * 60 * 60
            current_time = time.time()
            
            for filename in os.listdir(self.cache_dir):
                if filename.endswith('.meta'):
                    meta_path = os.path.join(self.cache_dir, filename)
                    try:
                        with open(meta_path, 'r') as f:
                            timestamp = float(f.read().strip())
                        
                        age = current_time - timestamp
                        if age > max_age_seconds:
                            # Remove both meta and image file
                            cache_key = filename.replace('.meta', '')
                            image_path = os.path.join(self.cache_dir, f"{cache_key}.jpg")
                            
                            if os.path.exists(meta_path):
                                os.remove(meta_path)
                            if os.path.exists(image_path):
                                os.remove(image_path)
                            
                            removed_count += 1
                    except Exception as e:
                        logger.error(f"Error processing cache file {filename}: {e}")
            
            if removed_count > 0:
                logger.info(f"Cleaned up {removed_count} expired TMDB cache entries")
        except Exception as e:
            logger.error(f"Error during cache cleanup: {e}")
    
    def get_cache_stats(self):
        """Get cache statistics"""
        try:
            files = [f for f in os.listdir(self.cache_dir) if f.endswith('.jpg')]
            total_size = sum(os.path.getsize(os.path.join(self.cache_dir, f)) for f in files)
            
            return {
                'entries': len(files),
                'total_size_mb': round(total_size / (1024 * 1024), 2),
                'cache_dir': self.cache_dir
            }
        except Exception as e:
            logger.error(f"Error getting cache stats: {e}")
            return {'entries': 0, 'total_size_mb': 0, 'cache_dir': self.cache_dir}
    
    def clear_all(self):
        """Clear all cached images"""
        try:
            removed_count = 0
            for filename in os.listdir(self.cache_dir):
                file_path = os.path.join(self.cache_dir, filename)
                if os.path.isfile(file_path):
                    os.remove(file_path)
                    removed_count += 1
            
            logger.info(f"Cleared {removed_count} files from TMDB cache")
            return removed_count
        except Exception as e:
            logger.error(f"Error clearing cache: {e}")
            return 0


# Global instance
tmdb_cache = TMDBImageCache()
