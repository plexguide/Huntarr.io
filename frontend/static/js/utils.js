/**
 * Huntarr - Utility Functions
 * Shared functions for use across the application
 */

const HuntarrUtils = {
    /**
     * Fetch with timeout using the global settings
     * @param {string} url - The URL to fetch
     * @param {Object} options - Fetch options
     * @returns {Promise} - Fetch promise with timeout handling
     */
    fetchWithTimeout: function(url, options = {}) {
        // Get the API timeout from global settings, default to 120 seconds if not set
        let apiTimeout = 120000; // Default 120 seconds in milliseconds
        
        // Try to get timeout from huntarrUI if available
        if (window.huntarrUI && window.huntarrUI.originalSettings && 
            window.huntarrUI.originalSettings.general && 
            window.huntarrUI.originalSettings.general.api_timeout) {
            apiTimeout = window.huntarrUI.originalSettings.general.api_timeout * 1000;
        }
        
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
                // Ensure path starts with a slash
                const normalizedPath = url.startsWith('/') ? url : '/' + url;
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
     * Get the global API timeout value in seconds
     * @returns {number} - API timeout in seconds
     */
    getApiTimeout: function() {
        // Default value
        let timeout = 120;
        
        // Try to get from global settings
        if (window.huntarrUI && window.huntarrUI.originalSettings && 
            window.huntarrUI.originalSettings.general && 
            window.huntarrUI.originalSettings.general.api_timeout) {
            timeout = window.huntarrUI.originalSettings.general.api_timeout;
        }
        
        return timeout;
    }
};

// If running in Node.js environment
if (typeof module !== 'undefined' && module.exports) {
    module.exports = HuntarrUtils;
}
