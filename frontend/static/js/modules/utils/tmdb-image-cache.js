/**
 * TMDB Image Cache Utility
 * Caches TMDB images in localStorage to reduce API calls and improve load times
 */

const CACHE_PREFIX = 'tmdb_img_';
const CACHE_METADATA_KEY = 'tmdb_cache_metadata';

export class TMDBImageCache {
    constructor() {
        this.cacheDays = 7; // Default to 7 days
        this.enabled = true;
    }

    /**
     * Initialize cache settings from API
     */
    async init() {
        try {
            const response = await fetch('./api/settings');
            const data = await response.json();
            if (data.success && data.settings && data.settings.general) {
                const cacheDays = data.settings.general.tmdb_image_cache_days;
                this.cacheDays = cacheDays !== undefined ? cacheDays : 7;
                this.enabled = this.cacheDays > 0;
                console.log(`[TMDBImageCache] Initialized with ${this.cacheDays} day server-side cache ${this.enabled ? 'enabled' : 'disabled'}`);
            }
        } catch (error) {
            console.error('[TMDBImageCache] Failed to load settings:', error);
        }
    }

    loadMetadata() { return {}; }
    saveMetadata() {}
    getCacheKey(url) { return null; }
    isCacheValid(key) { return false; }
    get(url) { return null; }
    async set(url, imageData) {}
    remove(key) {}
    cleanup(force = false) {}
    clearAll() {}
    getStats() {
        return {
            entries: 0,
            totalSizeKB: 0,
            cacheDays: this.cacheDays,
            enabled: this.enabled
        };
    }
}

/**
 * Get cached TMDB image or fetch via server proxy
 */
export async function getCachedTMDBImage(url, cache) {
    if (!url) return url;
    
    // Always use server proxy endpoint which handles caching server-side
    return `./api/tmdb/image?url=${encodeURIComponent(url)}`;
}

// Create singleton instance
export const tmdbImageCache = new TMDBImageCache();

// Make it globally available for non-module scripts
if (typeof window !== 'undefined') {
    window.tmdbImageCache = tmdbImageCache;
    window.getCachedTMDBImage = getCachedTMDBImage;
}
