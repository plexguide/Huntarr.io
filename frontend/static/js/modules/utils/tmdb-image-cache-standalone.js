/**
 * TMDB Image Cache Utility (Non-Module Version)
 * Caches TMDB images in localStorage to reduce API calls and improve load times
 */

(function() {
    const CACHE_PREFIX = 'tmdb_img_';
    const CACHE_METADATA_KEY = 'tmdb_cache_metadata';

    class TMDBImageCache {
    constructor() {
        this.cacheDays = 7; // Default to 7 days
        this.enabled = true;
        this.storage = 'server'; // Default to server storage
        this.metadata = this.loadMetadata();
    }

    /**
     * Initialize cache with settings from API
     */
    async init() {
        try {
            const response = await fetch('./api/settings');
            const data = await response.json();
            if (data.success && data.settings && data.settings.general) {
                const cacheDays = data.settings.general.tmdb_image_cache_days;
                const cacheStorage = data.settings.general.tmdb_cache_storage || 'server';
                
                this.cacheDays = cacheDays !== undefined ? cacheDays : 7;
                this.enabled = this.cacheDays > 0;
                this.storage = cacheStorage;
                
                console.log(`[TMDBImageCache] Initialized with ${this.cacheDays} day cache ${this.enabled ? 'enabled' : 'disabled'}, storage: ${this.storage}`);
            }
        } catch (error) {
            console.error('[TMDBImageCache] Failed to load settings, using defaults:', error);
        }
        
        // Clean up expired entries (only for browser storage)
        if (this.storage === 'browser') {
            this.cleanup();
        }
    }

        /**
         * Load cache metadata from localStorage
         */
        loadMetadata() {
            try {
                const stored = localStorage.getItem(CACHE_METADATA_KEY);
                return stored ? JSON.parse(stored) : {};
            } catch (error) {
                console.error('[TMDBImageCache] Failed to load metadata:', error);
                return {};
            }
        }

        /**
         * Save cache metadata to localStorage
         */
        saveMetadata() {
            try {
                localStorage.setItem(CACHE_METADATA_KEY, JSON.stringify(this.metadata));
            } catch (error) {
                console.error('[TMDBImageCache] Failed to save metadata:', error);
            }
        }

        /**
         * Get cache key for an image URL
         */
        getCacheKey(url) {
            if (!url) return null;
            // Extract just the image filename/path from TMDB URL
            const match = url.match(/\/(w\d+)\/(.+)$/);
            if (match) {
                return `${CACHE_PREFIX}${match[1]}_${match[2]}`;
            }
            return null;
        }

        /**
         * Check if cached image is still valid
         */
        isCacheValid(key) {
            if (!this.enabled || this.cacheDays === 0) return false;
            
            const meta = this.metadata[key];
            if (!meta || !meta.timestamp) return false;
            
            const now = Date.now();
            const age = now - meta.timestamp;
            const maxAge = this.cacheDays * 24 * 60 * 60 * 1000; // Convert days to ms
            
            return age < maxAge;
        }

        /**
         * Get cached image URL
         */
        get(url) {
            if (!this.enabled || this.cacheDays === 0) return null;
            
            const key = this.getCacheKey(url);
            if (!key) return null;
            
            if (!this.isCacheValid(key)) {
                this.remove(key);
                return null;
            }
            
            try {
                const cached = localStorage.getItem(key);
                if (cached) {
                    console.log(`[TMDBImageCache] Cache HIT: ${url}`);
                    return cached;
                }
            } catch (error) {
                console.error('[TMDBImageCache] Failed to get cached image:', error);
            }
            
            return null;
        }

        /**
         * Cache an image URL
         */
        async set(url, imageData) {
            if (!this.enabled || this.cacheDays === 0) return;
            
            const key = this.getCacheKey(url);
            if (!key) return;
            
            try {
                // Store the image data
                localStorage.setItem(key, imageData);
                
                // Update metadata
                this.metadata[key] = {
                    timestamp: Date.now(),
                    url: url
                };
                this.saveMetadata();
                
                console.log(`[TMDBImageCache] Cached: ${url}`);
            } catch (error) {
                // If we hit storage quota, try to cleanup old entries
                if (error.name === 'QuotaExceededError') {
                    console.warn('[TMDBImageCache] Storage quota exceeded, cleaning up...');
                    this.cleanup(true);
                    
                    // Try again after cleanup
                    try {
                        localStorage.setItem(key, imageData);
                        this.metadata[key] = {
                            timestamp: Date.now(),
                            url: url
                        };
                        this.saveMetadata();
                    } catch (retryError) {
                        console.error('[TMDBImageCache] Failed to cache even after cleanup:', retryError);
                    }
                } else {
                    console.error('[TMDBImageCache] Failed to cache image:', error);
                }
            }
        }

        /**
         * Remove a cached image
         */
        remove(key) {
            try {
                localStorage.removeItem(key);
                delete this.metadata[key];
                this.saveMetadata();
            } catch (error) {
                console.error('[TMDBImageCache] Failed to remove cached image:', error);
            }
        }

        /**
         * Clean up expired cache entries
         */
        cleanup(force = false) {
            try {
                const keys = Object.keys(this.metadata);
                let removed = 0;
                
                for (const key of keys) {
                    if (force || !this.isCacheValid(key)) {
                        this.remove(key);
                        removed++;
                    }
                }
                
                if (removed > 0) {
                    console.log(`[TMDBImageCache] Cleaned up ${removed} expired entries`);
                }
            } catch (error) {
                console.error('[TMDBImageCache] Failed to cleanup cache:', error);
            }
        }

        /**
         * Clear all cached images
         */
        clearAll() {
            try {
                const keys = Object.keys(this.metadata);
                for (const key of keys) {
                    localStorage.removeItem(key);
                }
                this.metadata = {};
                this.saveMetadata();
                console.log('[TMDBImageCache] Cleared all cached images');
            } catch (error) {
                console.error('[TMDBImageCache] Failed to clear cache:', error);
            }
        }

        /**
         * Get cache statistics
         */
        getStats() {
            const entries = Object.keys(this.metadata).length;
            let totalSize = 0;
            
            try {
                for (const key of Object.keys(this.metadata)) {
                    const data = localStorage.getItem(key);
                    if (data) {
                        totalSize += data.length;
                    }
                }
            } catch (error) {
                console.error('[TMDBImageCache] Failed to calculate cache size:', error);
            }
            
            return {
                entries,
                totalSizeKB: Math.round(totalSize / 1024),
                cacheDays: this.cacheDays,
                enabled: this.enabled
            };
        }
    }

    /**
     * Get cached TMDB image or fetch and cache it
     */
    async function getCachedTMDBImage(url, cache) {
        if (!url || !cache) return url;
        
        // If server-side storage, use proxy endpoint
        if (cache.storage === 'server') {
            // Use server proxy endpoint which handles caching
            return `./api/tmdb/image?url=${encodeURIComponent(url)}`;
        }
        
        // Browser-side storage - check cache first
        const cached = cache.get(url);
        if (cached) return cached;
        
        // If not cached or cache disabled, fetch and cache
        try {
            const response = await fetch(url);
            if (response.ok) {
                const blob = await response.blob();
                const reader = new FileReader();
                
                return new Promise((resolve, reject) => {
                    reader.onloadend = () => {
                        const base64 = reader.result;
                        // Cache the base64 data
                        cache.set(url, base64);
                        resolve(base64);
                    };
                    reader.onerror = reject;
                    reader.readAsDataURL(blob);
                });
            }
        } catch (error) {
            console.error('[TMDBImageCache] Failed to fetch image:', error);
        }
        
        // Return original URL if fetch fails
        return url;
    }

    // Create singleton instance and make it globally available
    window.tmdbImageCache = new TMDBImageCache();
    window.getCachedTMDBImage = getCachedTMDBImage;
})();
