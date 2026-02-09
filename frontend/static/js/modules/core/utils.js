/**
 * Huntarr - Utility Functions
 * Shared functions for use across the application
 */

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
        let processedUrl = url;
        
        // Only process internal API requests (not external URLs)
        if (url && typeof url === 'string' && !url.startsWith('http') && !url.startsWith('//')) {
            // Handle base URL from window.HUNTARR_BASE_URL if available
            const baseUrl = window.HUNTARR_BASE_URL || '';
            if (baseUrl && !url.startsWith(baseUrl)) {
                // Strip leading ./ prefix before normalizing (./api/stats → api/stats)
                let cleanPath = url.replace(/^\.\//, '');
                // Ensure path starts with a slash
                const normalizedPath = cleanPath.startsWith('/') ? cleanPath : '/' + cleanPath;
                processedUrl = baseUrl + normalizedPath;
            }
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
    }
};

// If running in Node.js environment
if (typeof module !== 'undefined' && module.exports) {
    module.exports = HuntarrUtils;
}
