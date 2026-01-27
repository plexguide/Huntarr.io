/**
 * Utility Helpers Module
 * Common utility functions used across the application
 */

window.HuntarrHelpers = {
    capitalizeFirst: function(string) {
        return string.charAt(0).toUpperCase() + string.slice(1);
    },

    cleanUrlString: function(url) {
        if (!url) return '';
        // Remove trailing slashes
        return url.replace(/\/+$/, '');
    },

    formatDateNicely: function(date) {
        if (!date) return 'N/A';
        
        const options = {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        };
        
        return new Date(date).toLocaleString('en-US', options);
    },

    getUserTimezone: function() {
        try {
            return Intl.DateTimeFormat().resolvedOptions().timeZone;
        } catch (e) {
            console.warn('Could not determine user timezone, using UTC');
            return 'UTC';
        }
    },

    parseLogTimestamp: function(logEntry) {
        if (!logEntry) return null;
        
        // Try to extract timestamp from various log formats
        const timestampPatterns = [
            /^\[([\d\-T:.]+)\]/,  // [2024-01-01T12:00:00.000]
            /^([\d\-T:.]+)\s/,     // 2024-01-01T12:00:00.000
            /^\[(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\]/  // [2024-01-01 12:00:00]
        ];
        
        for (const pattern of timestampPatterns) {
            const match = logEntry.match(pattern);
            if (match) {
                const timestamp = new Date(match[1]);
                if (!isNaN(timestamp.getTime())) {
                    return timestamp;
                }
            }
        }
        
        return null;
    },

    isJsonFragment: function(logString) {
        if (!logString || typeof logString !== 'string') return false;
        
        const trimmed = logString.trim();
        
        // Check for JSON object/array patterns
        if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
            (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
            try {
                JSON.parse(trimmed);
                return true;
            } catch (e) {
                return false;
            }
        }
        
        // Check for partial JSON patterns
        const jsonPatterns = [
            /^\s*[{[]/,           // Starts with { or [
            /[}\]]\s*$/,          // Ends with } or ]
            /:\s*[{[]/,           // Contains ": {" or ": ["
            /":\s*"[^"]*"\s*,/    // Contains key-value pairs
        ];
        
        return jsonPatterns.some(pattern => pattern.test(trimmed));
    },

    isInvalidLogLine: function(logString) {
        if (!logString || typeof logString !== 'string') return true;
        
        const trimmed = logString.trim();
        
        // Check for empty or whitespace-only
        if (trimmed.length === 0) return true;
        
        // Check for JSON fragments
        if (this.isJsonFragment(trimmed)) return true;
        
        // Check for common invalid patterns
        const invalidPatterns = [
            /^[\s\{\}\[\],:"]+$/,  // Only JSON syntax characters
            /^null$/i,              // Just "null"
            /^undefined$/i,         // Just "undefined"
            /^[\d.]+$/             // Just numbers
        ];
        
        return invalidPatterns.some(pattern => pattern.test(trimmed));
    },

    getConnectionErrorMessage: function(status) {
        const errorMessages = {
            0: 'Network error - Unable to reach server',
            400: 'Bad Request - Invalid API request',
            401: 'Unauthorized - Invalid API key',
            403: 'Forbidden - Access denied',
            404: 'Not Found - API endpoint not available',
            500: 'Internal Server Error',
            502: 'Bad Gateway - Server is unavailable',
            503: 'Service Unavailable - Server is temporarily down',
            504: 'Gateway Timeout - Server took too long to respond'
        };
        
        return errorMessages[status] || `HTTP Error ${status}`;
    },

    disconnectAllEventSources: function() {
        if (window.huntarrUI && window.huntarrUI.eventSources) {
            Object.keys(window.huntarrUI.eventSources).forEach(key => {
                const source = window.huntarrUI.eventSources[key];
                if (source && typeof source.close === 'function') {
                    source.close();
                }
            });
            window.huntarrUI.eventSources = {};
        }
    }
};
