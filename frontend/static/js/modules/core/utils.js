/**
 * Huntarr - Utility Functions
 * Shared functions for use across the application
 */

// ── Global 401 interceptor ──────────────────────────────────────────
// Wraps the native fetch so that ANY 401 from an internal API call
// triggers a single redirect to the login page, silencing the flood
// of "JSON.parse" / "HTTP 401" console errors on logout.
(function() {
    if (window._huntarrFetchPatched) return;
    window._huntarrFetchPatched = true;
    var _origFetch = window.fetch;
    window.fetch = function(url, opts) {
        // If we're already redirecting, swallow all subsequent requests
        if (window._huntarrRedirectingToLogin) {
            return new Promise(function() {}); // never resolves
        }
        return _origFetch.apply(this, arguments).then(function(response) {
            if (response.status === 401) {
                var urlStr = (typeof url === 'string') ? url : (url && url.url) || '';
                var isApi = urlStr.indexOf('/api/') !== -1;
                var onLogin = window.location.pathname.indexOf('/login') !== -1;
                var onSetup = window.location.pathname.indexOf('/setup') !== -1;
                if (isApi && !onLogin && !onSetup && !window._huntarrRedirectingToLogin) {
                    window._huntarrRedirectingToLogin = true;
                    window.location.href = (window.HUNTARR_BASE_URL || '') + '/login';
                    return new Promise(function() {}); // never resolves
                }
            }
            return response;
        });
    };
})();

const HuntarrUtils = {
    /**
     * Fetch with timeout (120s). Per-instance API timeouts are in app instances.
     * @param {string} url - The URL to fetch
     * @param {Object} options - Fetch options
     * @returns {Promise} - Fetch promise with timeout handling
     */
    fetchWithTimeout: function(url, options = {}) {
        // API timeout for fetch. Per-instance timeouts are in app instances.
        const apiTimeout = 120000; // 120 seconds in milliseconds
        
        // Create abort controller for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), apiTimeout);
        
        // Merge options with signal from AbortController
        // Only include credentials for internal API calls (not external URLs)
        const fetchOptions = {
            ...options,
            signal: controller.signal
        };
        
        // Add credentials only for internal API calls
        if (url && typeof url === 'string' && !url.startsWith('http') && !url.startsWith('//')) {
            fetchOptions.credentials = 'include';
        }
        
        // Process URL to handle base URL for reverse proxy subpaths
        // Always use absolute same-origin URL to avoid "Failed to fetch" on localhost/venv
        let processedUrl = url;
        
        // Only process internal API requests (not external URLs)
        if (url && typeof url === 'string' && !url.startsWith('http') && !url.startsWith('//')) {
            const baseUrl = window.HUNTARR_BASE_URL || '';
            let pathPart;
            if (baseUrl && !url.startsWith(baseUrl)) {
                let cleanPath = url.replace(/^\.\//, '');
                pathPart = cleanPath.startsWith('/') ? cleanPath : '/' + cleanPath;
                pathPart = baseUrl + pathPart;
            } else {
                pathPart = url;
            }
            // Build absolute URL using current origin (fixes localhost fetch failures)
            processedUrl = (typeof window !== 'undefined' && window.location && window.location.origin)
                ? (window.location.origin + (pathPart.startsWith('/') ? pathPart : '/' + pathPart))
                : pathPart;
        }
        
        return fetch(processedUrl, fetchOptions)
            .then(response => {
                clearTimeout(timeoutId);
                return response;
            })
            .catch(error => {
                clearTimeout(timeoutId);
                // Customize the error if it was a timeout
                if (error.name === 'AbortError') {
                    throw new Error(`Request timeout after ${apiTimeout / 1000} seconds`);
                }
                throw error;
            });
    },
    
    /**
     * API timeout in seconds for internal fetches. Per-instance timeouts are in app instances.
     * @returns {number} - API timeout in seconds
     */
    getApiTimeout: function() {
        return 120;
    },

    /**
     * Format date nicely for display
     * @param {Date|string} date - The date to format
     * @returns {string} - Formatted date string
     */
    formatDate: function (date) {
        if (!date) return "Never";
        
        const dateObj = typeof date === 'string' ? new Date(date) : date;
        if (isNaN(dateObj.getTime())) return "Invalid Date";

        const options = {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hour12: true,
        };

        return dateObj.toLocaleString("en-US", options);
    },

    /**
     * Convert seconds to readable format (e.g., "1 hour, 30 minutes")
     * @param {number} seconds - Total seconds
     * @returns {string} - Readable duration string
     */
    convertSecondsToReadable: function (seconds) {
        if (!seconds || seconds <= 0) return "0 seconds";

        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const remainingSeconds = seconds % 60;

        const parts = [];
        if (hours > 0) parts.push(`${hours} hour${hours > 1 ? "s" : ""}`);
        if (minutes > 0) parts.push(`${minutes} minute${minutes > 1 ? "s" : ""}`);
        if (remainingSeconds > 0 && hours === 0)
            parts.push(
                `${remainingSeconds} second${remainingSeconds > 1 ? "s" : ""}`
            );

        return parts.join(", ") || "0 seconds";
    },

    /**
     * Get a UI preference from the server-side general settings.
     * Uses huntarrUI.originalSettings.general as the source.
     */
    getUIPreference: function(key, defaultValue) {
        if (!window.huntarrUI || !window.huntarrUI.originalSettings || !window.huntarrUI.originalSettings.general) {
            return defaultValue;
        }
        const prefs = window.huntarrUI.originalSettings.general.ui_preferences || {};
        const value = prefs[key];
        return (value !== undefined) ? value : defaultValue;
    },

    /**
     * Set a UI preference in the server-side general settings.
     * Merges with existing preferences and auto-saves.
     */
    setUIPreference: function(key, value) {
        if (!window.huntarrUI || !window.huntarrUI.originalSettings || !window.huntarrUI.originalSettings.general) {
            console.warn('[HuntarrUtils] Cannot set UI preference: huntarrUI.originalSettings not ready');
            return;
        }
        
        const prefs = window.huntarrUI.originalSettings.general.ui_preferences || {};
        prefs[key] = value;
        window.huntarrUI.originalSettings.general.ui_preferences = prefs;
        
        // Use FetchWithTimeout to save just the preferences (server merges them)
        this.fetchWithTimeout('./api/settings/general', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ui_preferences: prefs })
        }).catch(err => console.error('[HuntarrUtils] Failed to save UI preference:', err));
    }
};

// If running in Node.js environment
if (typeof module !== 'undefined' && module.exports) {
    module.exports = HuntarrUtils;
}
