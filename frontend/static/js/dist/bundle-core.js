
/* === modules/core/utils.js === */
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


/* === modules/core/helpers.js === */
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


/* === modules/core/dom.js === */
/**
 * DOM Module
 * Handles element caching and low-level DOM utilities
 */

window.HuntarrDOM = {
    cacheElements: function(ui) {
        if (!ui || !ui.elements) return;
        
        const elements = ui.elements;
        
        // Navigation
        elements.navItems = document.querySelectorAll('.nav-item');
        elements.homeNav = document.getElementById('homeNav');
        elements.logsNav = document.getElementById('logsNav');
        elements.huntManagerNav = document.getElementById('huntManagerNav');
        elements.settingsNav = document.getElementById('settingsNav');
        elements.userNav = document.getElementById('userNav');
        
        // Sections
        elements.sections = document.querySelectorAll('.content-section');
        elements.homeSection = document.getElementById('homeSection');
        elements.logsSection = document.getElementById('logsSection');
        elements.huntManagerSection = document.getElementById('huntManagerSection');
        elements.settingsSection = document.getElementById('settingsSection');
        elements.settingsLogsSection = document.getElementById('settingsLogsSection');
        elements.schedulingSection = document.getElementById('schedulingSection');
        
        // History dropdown elements
        elements.historyOptions = document.querySelectorAll('.history-option');
        elements.currentHistoryApp = document.getElementById('current-history-app');
        elements.historyDropdownBtn = document.querySelector('.history-dropdown-btn');
        elements.historyDropdownContent = document.querySelector('.history-dropdown-content');
        elements.historyPlaceholderText = document.getElementById('history-placeholder-text');
        
        // Settings dropdown elements
        elements.settingsOptions = document.querySelectorAll('.settings-option');
        elements.currentSettingsApp = document.getElementById('current-settings-app');
        elements.settingsDropdownBtn = document.querySelector('.settings-dropdown-btn');
        elements.settingsDropdownContent = document.querySelector('.settings-dropdown-content');
        
        elements.appSettingsPanels = document.querySelectorAll('.app-settings-panel');
        
        // Status elements
        elements.sonarrHomeStatus = document.getElementById('sonarrHomeStatus');
        elements.radarrHomeStatus = document.getElementById('radarrHomeStatus');
        elements.lidarrHomeStatus = document.getElementById('lidarrHomeStatus');
        elements.readarrHomeStatus = document.getElementById('readarrHomeStatus');
        elements.whisparrHomeStatus = document.getElementById('whisparrHomeStatus');
        elements.erosHomeStatus = document.getElementById('erosHomeStatus');
        elements.movie_huntHomeStatus = document.getElementById('movie_huntHomeStatus');
        
        // Actions
        elements.startHuntButton = document.getElementById('startHuntButton');
        elements.stopHuntButton = document.getElementById('stopHuntButton');
        
        // Logout
        elements.logoutLink = document.getElementById('logoutLink');
    },

    showDashboard: function() {
        // Make the dashboard grid visible after initialization to prevent FOUC
        const dashboardGrid = document.querySelector('.dashboard-grid');
        if (dashboardGrid) {
            dashboardGrid.style.opacity = '1';
            console.log('[HuntarrDOM] Dashboard made visible after initialization');
        } else {
            console.warn('[HuntarrDOM] Dashboard grid not found');
        }
    }
};


/* === modules/core/notifications.js === */
/**
 * Notifications Module
 * Handles UI notifications and alerts
 */

window.HuntarrNotifications = {
    showNotification: function(message, type = 'info') {
        // Create a notification element
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        
        // Add to the document
        document.body.appendChild(notification);
        
        // Ensure any existing notification is removed first to prevent stacking
        const existingNotifications = document.querySelectorAll('.notification');
        existingNotifications.forEach(n => {
            if (n !== notification) {
                n.classList.remove('show');
                setTimeout(() => n.remove(), 300);
            }
        });
        
        // Fade in
        setTimeout(() => {
            notification.classList.add('show');
        }, 10);
        
        // Remove after a delay
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => {
                notification.remove();
            }, 300);
        }, 3000);
    }
};


/* === modules/core/confirm-modal.js === */
/**
 * Global confirm modal - purple/blue style. Replaces native confirm() for deletes & unsaved-changes.
 * Usage:
 *   HuntarrConfirm.show({
 *       title: 'Delete ...',
 *       message: '...',
 *       confirmLabel: 'Delete',
 *       cancelLabel: 'Cancel',      // optional — relabels the cancel button
 *       onConfirm: function() { … },
 *       onCancel:  function() { … } // optional — called when cancel / X / backdrop / Escape
 *   });
 */
(function() {
    'use strict';

    function ensureModalInBody() {
        var modal = document.getElementById('huntarr-confirm-modal');
        if (modal && modal.parentNode !== document.body) {
            document.body.appendChild(modal);
        }
        return modal;
    }

    function closeModal() {
        var modal = document.getElementById('huntarr-confirm-modal');
        if (modal) modal.style.display = 'none';
        document.body.classList.remove('huntarr-confirm-modal-open');
    }

    window.HuntarrConfirm = {
        show: function(options) {
            var opts = options || {};
            var title        = opts.title != null ? String(opts.title) : 'Confirm';
            var message      = opts.message != null ? String(opts.message) : '';
            var confirmLabel = opts.confirmLabel != null ? String(opts.confirmLabel) : 'OK';
            var cancelLabel  = opts.cancelLabel != null ? String(opts.cancelLabel) : 'Cancel';
            var onConfirm    = typeof opts.onConfirm === 'function' ? opts.onConfirm : function() {};
            var onCancel     = typeof opts.onCancel  === 'function' ? opts.onCancel  : function() {};

            var modal = ensureModalInBody();
            if (!modal) return;

            // --- populate text ------------------------------------------------
            var titleEl    = document.getElementById('huntarr-confirm-modal-title');
            var messageEl  = document.getElementById('huntarr-confirm-modal-message');
            var confirmBtn = document.getElementById('huntarr-confirm-modal-confirm');
            var cancelBtn  = document.getElementById('huntarr-confirm-modal-cancel');

            if (titleEl)    titleEl.textContent = title;
            if (messageEl)  messageEl.textContent = message;
            if (confirmBtn) confirmBtn.textContent = confirmLabel;
            if (cancelBtn)  cancelBtn.textContent  = cancelLabel;

            // --- bind handlers fresh every time -------------------------------
            // This avoids any stale-closure issues from a one-time initOnce().
            var handled = false;               // guard against double-fire

            function doCancel() {
                if (handled) return;
                handled = true;
                closeModal();
                onCancel();
            }

            function doConfirm() {
                if (handled) return;
                handled = true;
                closeModal();
                onConfirm();
            }

            var backdrop = document.getElementById('huntarr-confirm-modal-backdrop');
            var closeBtn = document.getElementById('huntarr-confirm-modal-close');

            if (backdrop)   backdrop.onclick = doCancel;
            if (closeBtn)   closeBtn.onclick = doCancel;
            if (cancelBtn)  cancelBtn.onclick = doCancel;
            if (confirmBtn) confirmBtn.onclick = doConfirm;

            // Escape key
            function onKeyDown(e) {
                if (e.key === 'Escape' && modal.style.display === 'flex') {
                    document.removeEventListener('keydown', onKeyDown);
                    doCancel();
                }
            }
            document.addEventListener('keydown', onKeyDown);

            // --- show ---------------------------------------------------------
            modal.style.display = 'flex';
            document.body.classList.add('huntarr-confirm-modal-open');
        }
    };
})();


/* === modules/core/navigation.js === */
/**
 * Navigation Module
 * Handles section switching, hash navigation, and sidebar management
 */

window.HuntarrNavigation = {
    // Handle navigation clicks
    handleNavigation: function(e) {
        e.preventDefault();
        
        const target = e.currentTarget;
        const href = target.getAttribute('href');
        const isInternalLink = href && href.startsWith('#');
        
        // Check for unsaved changes before navigating
        if (window.huntarrUI && typeof window.huntarrUI.suppressUnsavedChangesCheck === 'boolean') {
            if (window.huntarrUI.suppressUnsavedChangesCheck) {
                console.log('[Navigation] Suppression flag active, allowing navigation without check');
                window.huntarrUI.suppressUnsavedChangesCheck = false;
            }
        }
        
        // Add special handling for apps section - clear global app module flags
        if (window.huntarrUI && window.huntarrUI.currentSection === 'apps' && href && !href.includes('apps')) {
            // Reset the app module flags when navigating away
            if (window._appsModuleLoaded) {
                window._appsSuppressChangeDetection = true;
                if (window.appsModule && typeof window.appsModule.settingsChanged !== 'undefined') {
                    window.appsModule.settingsChanged = false;
                }
                // Schedule ending suppression to avoid any edge case issues
                setTimeout(() => {
                    window._appsSuppressChangeDetection = false;
                }, 1000);
            }
        }

        // Proceed with navigation
        if (isInternalLink) {
            window.location.hash = href; // Change hash to trigger handleHashNavigation
        } else {
            // If it's an external link (like /user), just navigate normally
            window.location.href = href;
        }
    },
    
    handleHashNavigation: function(hash) {
        let section = (hash || '').replace(/^#+/, '').trim();
        if (section.indexOf('%23') >= 0) section = section.split('%23').pop() || section;
        if (section.indexOf('./') === 0) section = section.replace(/^\.?\/*/, '');
        if (!section) section = 'home';
        // Requestarr detail pages (e.g. requestarr-movie/12345) can't be restored on refresh.
        // Redirect to the parent Requestarr view so the user stays in Requestarr.
        if (/^requestarr-movie\//.test(section)) {
            section = 'requestarr-discover';
            if (window.location.hash !== '#requestarr-discover') {
                window.history.replaceState(null, document.title, window.location.pathname + (window.location.search || '') + '#requestarr-discover');
            }
        }
        // Requestarr TV detail (#requestarr-tv/ID) - keep hash so RequestarrTVDetail can restore on refresh
        if (/^requestarr-tv\/(\d+)$/.test(section)) {
            section = 'requestarr-tv';
        }
        // Legacy Movie Hunt home → Media Hunt Collection
        if (section === 'movie-hunt-home') {
            section = 'media-hunt-collection';
            if (window.location.hash !== '#media-hunt-collection') {
                window.history.replaceState(null, document.title, window.location.pathname + (window.location.search || '') + '#media-hunt-collection');
            }
        }
        // Media Hunt Collection TV detail: #media-hunt-collection/tv/12345 — redirect to Requestarr TV detail (which has full UI)
        if (/^media-hunt-collection\/tv\/(\d+)$/.test(section)) {
            var tmdbMatch = section.match(/media-hunt-collection\/tv\/(\d+)/);
            if (tmdbMatch) {
                section = 'requestarr-tv/' + tmdbMatch[1];
                if (window.location.hash !== '#requestarr-tv/' + tmdbMatch[1]) {
                    window.history.replaceState(null, document.title, window.location.pathname + (window.location.search || '') + '#requestarr-tv/' + tmdbMatch[1]);
                }
            }
        }
        // TV/Movie Collection → unified Media Hunt Collection
        if (section === 'tv-hunt-collection' || section === 'movie-hunt-collection') {
            if (window.huntarrUI) window.huntarrUI._pendingMediaHuntSidebar = 'movie';
            section = 'media-hunt-collection';
            if (window.location.hash !== '#media-hunt-collection') {
                window.history.replaceState(null, document.title, window.location.pathname + (window.location.search || '') + '#media-hunt-collection');
            }
        }
        // Legacy TV Hunt home → Media Hunt Collection
        if (section === 'tv-hunt-home') {
            section = 'media-hunt-collection';
            if (window.location.hash !== '#media-hunt-collection') {
                window.history.replaceState(null, document.title, window.location.pathname + (window.location.search || '') + '#media-hunt-collection');
            }
        }
        // Media Hunt movie detail direct link: #movie/<tmdb_id> — redirect to Requestarr detail
        var movieMatch = /^movie\/(\d+)$/.exec(section);
        if (movieMatch) {
            var tmdbId = movieMatch[1];
            window.location.hash = 'requestarr-movie/' + tmdbId;
            return;
        }
        // Media Hunt TV detail direct link: #tv/<tmdb_id> — redirect to Requestarr TV detail
        var tvMatch = /^tv\/(\d+)$/.exec(section);
        if (tvMatch) {
            window.location.hash = 'requestarr-tv/' + tvMatch[1];
            return;
        }
        if (section === 'activity') {
            section = 'activity-queue';
            if (window.location.hash !== '#activity-queue') window.location.hash = 'activity-queue';
        }
        // Legacy: logs-movie-hunt → logs-media-hunt
        if (section === 'logs-movie-hunt') {
            section = 'logs-media-hunt';
            if (window.location.hash !== '#logs-media-hunt') {
                window.history.replaceState(null, document.title, window.location.pathname + (window.location.search || '') + '#logs-media-hunt');
            }
        }
        // NZB Hunt: canonical hashes are nzb-hunt-folders, nzb-hunt-servers, nzb-hunt-advanced
        // Legacy nzb-hunt-settings* → redirect to new hashes
        if (section === 'nzb-hunt-settings' || section === 'nzb-hunt-settings-folders') {
            section = 'nzb-hunt-folders';
            if (window.location.hash !== '#nzb-hunt-folders') {
                window.history.replaceState(null, document.title, window.location.pathname + (window.location.search || '') + '#nzb-hunt-folders');
            }
        }
        if (section === 'nzb-hunt-settings-servers') {
            section = 'nzb-hunt-servers';
            if (window.location.hash !== '#nzb-hunt-servers') {
                window.history.replaceState(null, document.title, window.location.pathname + (window.location.search || '') + '#nzb-hunt-servers');
            }
        }
        if (section === 'nzb-hunt-settings-processing' || section === 'nzb-hunt-settings-advanced') {
            section = 'nzb-hunt-advanced';
            if (window.location.hash !== '#nzb-hunt-advanced') {
                window.history.replaceState(null, document.title, window.location.pathname + (window.location.search || '') + '#nzb-hunt-advanced');
            }
        }
        // Instances moved to Collection: settings-instance-management redirects to media-hunt-instances
        if (section === 'settings-instance-management') {
            section = 'media-hunt-instances';
            if (window.location.hash !== '#media-hunt-instances') {
                window.history.replaceState(null, document.title, window.location.pathname + (window.location.search || '') + '#media-hunt-instances');
            }
        }
        // Legacy media-hunt-settings: go to Media Management so Settings sub-menu expands and shows sub-items
        if (section === 'media-hunt-settings') {
            section = 'settings-media-management';
            if (window.location.hash !== '#settings-media-management') {
                window.history.replaceState(null, document.title, window.location.pathname + (window.location.search || '') + '#settings-media-management');
            }
        }
        // Legacy: Movie Management → Media Management
        if (section === 'settings-movie-management') {
            section = 'settings-media-management';
            if (window.location.hash !== '#settings-media-management') {
                window.history.replaceState(null, document.title, window.location.pathname + (window.location.search || '') + '#settings-media-management');
            }
        }
        // Legacy: TV Hunt settings → unified Media Hunt settings (sidebar was removed)
        // NOTE: tv-hunt-activity-* are NOT redirected - they show TV Hunt Activity (Queue/History/Blocklist)
        var tvHuntToSettings = {
            'tv-hunt-settings-custom-formats': 'settings-custom-formats',
            'tv-hunt-settings-profiles': 'settings-profiles',
            'tv-hunt-settings-indexers': 'indexer-hunt',
            'tv-hunt-settings-clients': 'settings-clients',
            'tv-hunt-settings-root-folders': 'settings-root-folders',
            'settings-import-media-tv': 'settings-import-media',
            'tv-hunt-settings-sizes': 'settings-sizes',
            'tv-hunt-settings-tv-management': 'settings-media-management',
            'tv-hunt-settings-import-lists': 'settings-import-lists',
        };
        if (tvHuntToSettings[section]) {
            var target = tvHuntToSettings[section];
            section = target;
            if (window.location.hash !== '#' + target) {
                window.history.replaceState(null, document.title, window.location.pathname + (window.location.search || '') + '#' + target);
            }
        }
        // App instance editor URLs: #radarr-settings, #radarr-settings/0, #sonarr-settings, etc.
        var appSettingsMatch = section.match(/^(sonarr|radarr|lidarr|readarr|whisparr|eros|prowlarr)-settings(?:\/(\d+))?$/);
        if (appSettingsMatch) {
            var appType = appSettingsMatch[1];
            var idx = appSettingsMatch[2] != null ? parseInt(appSettingsMatch[2], 10) : null;
            if (window.SettingsForms && typeof window.SettingsForms.navigateToInstanceEditor === 'function') {
                var hasSettings = window.huntarrUI && window.huntarrUI.originalSettings && window.huntarrUI.originalSettings[appType];
                if (hasSettings) {
                    window.SettingsForms.navigateToInstanceEditor(appType, idx);
                    return;
                }
            }
            section = appType;
            window.history.replaceState(null, document.title, window.location.pathname + (window.location.search || '') + '#' + appType);
        }
        if (window.huntarrUI) {
            window.huntarrUI.switchSection(section);
        }
    },

    // switchSection is handled by huntarrUI.switchSection() in app.js.
    // This module only provides handleHashNavigation() which delegates to it.
    
    // System tab management
    switchSystemTab: function(tab) {
        // Update tab buttons
        document.querySelectorAll('#systemSection .system-tab').forEach(function(t) {
            t.classList.toggle('active', t.getAttribute('data-system-tab') === tab);
        });
        // Update tab panels
        document.querySelectorAll('#systemSection .system-tab-panel').forEach(function(p) {
            var isActive = p.getAttribute('data-system-panel') === tab;
            p.style.display = isActive ? 'block' : 'none';
            p.classList.toggle('active', isActive);
        });
    },

    setupSystemTabs: function() {
        var self = this;
        document.querySelectorAll('#systemSection .system-tab').forEach(function(tab) {
            tab.addEventListener('click', function() {
                var t = tab.getAttribute('data-system-tab');
                if (t) {
                    // Update the hash to reflect the tab
                    window.location.hash = t === 'hunt-manager' ? 'hunt-manager' : t;
                }
            });
        });
    },

    // ─── Sidebar management ───────────────────────────────────
    // With the unified sidebar there is only one #sidebar element.
    // The show*Sidebar() API is preserved so app.js callers don't change.
    // Each function now expands the relevant accordion group instead
    // of toggling display on separate sidebar divs.

    showMainSidebar: function() {
        // Home page — collapse all groups
        if (typeof expandSidebarGroup === 'function') {
            // Let setActiveNavItem handle it via hashchange
        }
        if (typeof setActiveNavItem === 'function') setActiveNavItem();
    },

    showAppsSidebar: function() {
        if (typeof expandSidebarGroup === 'function') expandSidebarGroup('sidebar-group-apps');
        if (typeof setActiveNavItem === 'function') setActiveNavItem();
    },

    showSettingsSidebar: function() {
        if (typeof expandSidebarGroup === 'function') expandSidebarGroup('sidebar-group-settings');
        if (typeof setActiveNavItem === 'function') setActiveNavItem();
    },

    showRequestarrSidebar: function() {
        if (typeof expandSidebarGroup === 'function') expandSidebarGroup('sidebar-group-requests');
        if (typeof setActiveNavItem === 'function') setActiveNavItem();
    },

    showMovieHuntSidebar: function() {
        if (typeof expandSidebarGroup === 'function') expandSidebarGroup('sidebar-group-media-hunt');
        this.updateMovieHuntSidebarActive();
    },

    showTVHuntSidebar: function() {
        this.showMovieHuntSidebar();
    },

    updateMovieHuntSidebarActive: function() {
        if (!window.huntarrUI) return;
        const currentSection = window.huntarrUI.currentSection;
        let sectionForNav = currentSection;
        if (currentSection === 'instance-editor' && window.SettingsForms && window.SettingsForms._currentEditing) {
            const appType = window.SettingsForms._currentEditing.appType;
            if (appType === 'indexer') sectionForNav = 'indexer-hunt';
            else if (appType === 'client') sectionForNav = 'settings-clients';
        }
        const collectionSections = ['movie-hunt-home', 'movie-hunt-collection', 'media-hunt-collection', 'settings-import-media', 'movie-hunt-calendar'];
        const activitySections = ['activity-queue', 'activity-history', 'activity-blocklist', 'activity-logs', 'logs-media-hunt', 'logs-tv-hunt', 'tv-hunt-activity-queue', 'tv-hunt-activity-history', 'tv-hunt-activity-blocklist'];
        const configSections = ['media-hunt-settings', 'movie-hunt-settings', 'settings-instance-management', 'indexer-hunt', 'indexer-hunt-stats', 'indexer-hunt-history', 'settings-clients', 'settings-media-management', 'settings-profiles', 'settings-sizes', 'profile-editor', 'settings-custom-formats', 'settings-import-lists', 'settings-root-folders', 'instance-editor'];
        const indexMasterSections = ['indexer-hunt', 'indexer-hunt-stats', 'indexer-hunt-history'];
        const onCollection = collectionSections.indexOf(currentSection) !== -1;
        const onActivity = activitySections.indexOf(sectionForNav) !== -1;
        const onConfig = configSections.indexOf(sectionForNav) !== -1;
        const onIndexMaster = indexMasterSections.indexOf(sectionForNav) !== -1;

        const colSub = document.getElementById('movie-hunt-collection-sub');
        const actSub = document.getElementById('movie-hunt-activity-sub');
        const cfgSub = document.getElementById('media-hunt-config-sub');
        const idxMasterSub = document.getElementById('index-master-sub');
        if (colSub) colSub.classList.toggle('expanded', onCollection);
        if (actSub) actSub.classList.toggle('expanded', onActivity);
        if (cfgSub) cfgSub.classList.toggle('expanded', onConfig);
        if (idxMasterSub) idxMasterSub.classList.toggle('expanded', onIndexMaster);

        // Highlight the active item within Media Hunt sidebar
        const items = document.querySelectorAll('#sidebar-group-media-hunt .nav-item');
        const isActivitySub = activitySections.indexOf(sectionForNav) !== -1;
        var tvToMovieNav = { 'tv-hunt-activity-queue': 'activity-queue', 'tv-hunt-activity-history': 'activity-history', 'tv-hunt-activity-blocklist': 'activity-blocklist', 'logs-tv-hunt': 'logs-media-hunt' };
        var navTarget = tvToMovieNav[sectionForNav] || sectionForNav;
        items.forEach(item => {
            item.classList.remove('active');
            if (isActivitySub && item.id === 'movieHuntActivityNav') return;
            const href = item.getAttribute && item.getAttribute('href') || (item.querySelector('a') && item.querySelector('a').getAttribute('href'));
            var targetHash = (href || '').replace(/^[^#]*#/, '');
            if (targetHash && (targetHash === navTarget || targetHash === sectionForNav)) {
                item.classList.add('active');
            }
        });
    },

    updateTVHuntSidebarActive: function() {
        // TV Hunt sidebar removed; no-op
    },

    updateAppsSidebarActive: function() {
        // Active state is handled by setActiveNavItem() in the inline script
        if (typeof setActiveNavItem === 'function') setActiveNavItem();
    },

    updateSettingsSidebarActive: function() {
        if (typeof setActiveNavItem === 'function') setActiveNavItem();
    },

    updateRequestarrSidebarActive: function() {
        if (typeof setActiveNavItem === 'function') setActiveNavItem();
    },

    setupAppsNavigation: function() {
        // Navigation is handled by hash links — no extra click listeners needed with unified sidebar
    },

    setupSettingsNavigation: function() {
        // Navigation is handled by hash links
    },

    // setupRequestarrNavigation: handled by HuntarrRequestarr.setupRequestarrNavigation() in requestarr-controller.js

    setupMovieHuntNavigation: function() {
        // Navigation is handled by hash links
    },

    setupTVHuntNavigation: function() {
        // TV Hunt sidebar removed; no-op
    },

    setupNzbHuntNavigation: function() {
        // Navigation is handled by hash links
    },

    updateRequestarrNavigation: function(view) {
        if (!window.RequestarrDiscover || !window.RequestarrDiscover.switchView) {
            console.warn('[Navigation] RequestarrDiscover not available');
            return;
        }
        window.RequestarrDiscover.switchView(view);
    }
};


/* === modules/core/theme.js === */
/**
 * Theme Module
 * Handles logo persistence. Huntarr is always dark — no light mode.
 */

window.HuntarrTheme = {
    logoSrc: null,

    setupLogoHandling: function() {
        const logoImg = document.querySelector('.sidebar .logo');
        if (logoImg) {
            this.logoSrc = logoImg.src;
            if (!logoImg.complete) {
                logoImg.onload = () => {
                    this.logoSrc = logoImg.src;
                };
            }
        }
        
        window.addEventListener('beforeunload', () => {
            if (this.logoSrc) {
                sessionStorage.setItem('huntarr-logo-src', this.logoSrc);
            }
        });
    },

    initDarkMode: function() {
        // Huntarr is always dark — ensure the class is applied
        document.body.classList.add('dark-theme');
    }
};


/* === modules/core/version.js === */
/**
 * Version & Info Module
 * Handles version checking, GitHub stars, and user info display
 */

window.HuntarrVersion = {
    loadCurrentVersion: function() {
        HuntarrUtils.fetchWithTimeout('./version.txt')
            .then(response => {
                if (!response.ok) {
                    throw new Error('Failed to load version.txt');
                }
                return response.text();
            })
            .then(version => {
                // Store in localStorage for sidebar footer display
                try {
                    const versionInfo = localStorage.getItem('huntarr-version-info') || '{}';
                    const parsedInfo = JSON.parse(versionInfo);
                    parsedInfo.currentVersion = version.trim();
                    localStorage.setItem('huntarr-version-info', JSON.stringify(parsedInfo));
                } catch (e) {
                    console.error('Error saving current version to localStorage:', e);
                }
            })
            .catch(error => {
                console.error('Error loading current version:', error);
            });
    },

    loadLatestVersion: function() {
        HuntarrUtils.fetchWithTimeout('https://api.github.com/repos/plexguide/Huntarr.io/releases/latest')
            .then(response => {
                if (!response.ok) {
                    if (response.status === 403) {
                        console.warn('GitHub API rate limit likely exceeded.');
                        throw new Error('Rate limited');
                    }
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                if (data && data.tag_name) {
                    // Store in localStorage for sidebar footer display
                    try {
                        const versionInfo = localStorage.getItem('huntarr-version-info') || '{}';
                        const parsedInfo = JSON.parse(versionInfo);
                        parsedInfo.latestVersion = data.tag_name;
                        localStorage.setItem('huntarr-version-info', JSON.stringify(parsedInfo));
                    } catch (e) {
                        console.error('Error saving latest version to localStorage:', e);
                    }
                }
            })
            .catch(error => {
                console.error('Error loading latest version from GitHub:', error);
            });
    },
    
    loadBetaVersion: function() {
        HuntarrUtils.fetchWithTimeout('https://api.github.com/repos/plexguide/Huntarr.io/tags?per_page=100')
            .then(response => {
                if (!response.ok) {
                    if (response.status === 403) {
                        console.warn('GitHub API rate limit likely exceeded.');
                        throw new Error('Rate limited');
                    }
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                const betaVersionElement = document.getElementById('beta-version-value');
                
                if (betaVersionElement && data && Array.isArray(data) && data.length > 0) {
                    // Find the first tag that starts with B (case insensitive)
                    const betaTag = data.find(tag => tag.name.toUpperCase().startsWith('B'));
                    
                    if (betaTag) {
                        betaVersionElement.textContent = betaTag.name;
                        try {
                            const versionInfo = localStorage.getItem('huntarr-version-info') || '{}';
                            const parsedInfo = JSON.parse(versionInfo);
                            parsedInfo.betaVersion = betaTag.name;
                            localStorage.setItem('huntarr-version-info', JSON.stringify(parsedInfo));
                        } catch (e) {
                            console.error('Error saving beta version to localStorage:', e);
                        }
                    } else {
                        betaVersionElement.textContent = 'None';
                    }
                } else if (betaVersionElement) {
                    betaVersionElement.textContent = 'N/A';
                }
            })
            .catch(error => {
                console.error('Error loading beta version from GitHub:', error);
                const betaVersionElement = document.getElementById('beta-version-value');
                if (betaVersionElement) {
                    betaVersionElement.textContent = error.message === 'Rate limited' ? 'Rate Limited' : 'Error';
                }
            });
    },

    loadGitHubStarCount: function() {
        const starsElement = document.getElementById('github-stars-value');
        if (!starsElement) return;
        
        // Try to load from cache first
        const cachedData = localStorage.getItem('huntarr-github-stars');
        if (cachedData) {
            try {
                const parsed = JSON.parse(cachedData);
                if (parsed.stars !== undefined) {
                    starsElement.textContent = parsed.stars.toLocaleString();
                    // If cache is recent (less than 1 hour), skip API call
                    const cacheAge = Date.now() - (parsed.timestamp || 0);
                    if (cacheAge < 3600000) {
                        return;
                    }
                }
            } catch (e) {
                console.warn('Invalid cached star data, will fetch fresh');
                localStorage.removeItem('huntarr-github-stars');
            }
        }
        
        // Set loading state
        starsElement.textContent = 'Loading...';
        
        HuntarrUtils.fetchWithTimeout('https://api.github.com/repos/plexguide/Huntarr.io')
            .then(response => {
                if (!response.ok) {
                    if (response.status === 403) {
                        throw new Error('Rate limited');
                    }
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                if (data.stargazers_count !== undefined) {
                    const stars = data.stargazers_count;
                    starsElement.textContent = stars.toLocaleString();
                    
                    // Cache the result
                    localStorage.setItem('huntarr-github-stars', JSON.stringify({
                        stars: stars,
                        timestamp: Date.now()
                    }));
                } else {
                    starsElement.textContent = 'N/A';
                }
            })
            .catch(error => {
                console.error('Error loading GitHub stars:', error);
                starsElement.textContent = error.message === 'Rate limited' ? 'Rate Limited' : 'Error';
            });
    },

    loadUsername: function() {
        HuntarrUtils.fetchWithTimeout('./api/user/info')
            .then(response => {
                if (!response.ok) {
                    throw new Error('Failed to fetch user info');
                }
                return response.json();
            })
            .then(data => {
                const usernameElement = document.getElementById('username');
                if (usernameElement && data.username) {
                    usernameElement.textContent = data.username;
                    // Store username in localStorage for reference
                    localStorage.setItem('huntarr-username', data.username);
                }
                
                // Check local access bypass status after loading username
                if (window.HuntarrAuth) {
                    window.HuntarrAuth.checkLocalAccessBypassStatus();
                }
            })
            .catch(error => {
                console.error('Error loading username:', error);
                
                // Still check local access bypass status even if username loading failed
                if (window.HuntarrAuth) {
                    window.HuntarrAuth.checkLocalAccessBypassStatus();
                }
            });
    }
};


/* === modules/core/auth.js === */
/**
 * Authentication Module
 * Handles user login, logout, and local access bypass status
 */

window.HuntarrAuth = {
    checkLocalAccessBypassStatus: function() {
        console.log("[HuntarrAuth] Checking local access bypass status...");
        HuntarrUtils.fetchWithTimeout('./api/get_local_access_bypass_status')
            .then(response => {
                if (!response.ok) throw new Error(`HTTP error ${response.status}`);
                return response.json();
            })
            .then(data => {
                if (data && typeof data.isEnabled === 'boolean') {
                    this.updateUIForLocalAccessBypass(data.isEnabled);
                } else {
                    this.updateUIForLocalAccessBypass(false);
                }
            })
            .catch(error => {
                console.error('[HuntarrAuth] Error checking local access bypass status:', error);
                this.updateUIForLocalAccessBypass(false);
            });
    },
    
    updateUIForLocalAccessBypass: function(isEnabled) {
        const userInfoContainer = document.getElementById('userInfoContainer');
        const userNav = document.getElementById('userNav');
        
        if (isEnabled === true) {
            if (userInfoContainer) userInfoContainer.style.display = 'none';
            if (userNav) {
                userNav.style.display = 'none';
            }
        } else {
            if (userInfoContainer) userInfoContainer.style.display = 'flex';
            if (userNav) userNav.style.display = '';
        }
    },
    
    logout: function(e) {
        if (e) e.preventDefault();
        console.log('[HuntarrAuth] Logging out...');
        HuntarrUtils.fetchWithTimeout('./logout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                window.location.href = './login';
            } else {
                if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification('Logout failed', 'error');
            }
        })
        .catch(error => {
            console.error('[HuntarrAuth] Error during logout:', error);
            if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification('An error occurred during logout', 'error');
        });
    }
};


/* === modules/core/ui-handlers.js === */
/**
 * UI Handlers Module
 * Handles dropdowns, tab changes, and other UI interaction events
 */

window.HuntarrUIHandlers = {
    handleHistoryOptionChange: function(app) {
        if (app && app.target && typeof app.target.value === 'string') {
            app = app.target.value;
        } else if (app && app.target && typeof app.target.getAttribute === 'function') {
            app = app.target.getAttribute('data-app');
        }
        
        if (!app || (window.huntarrUI && app === window.huntarrUI.currentHistoryApp)) return;
        
        const historyAppSelect = document.getElementById('historyAppSelect');
        if (historyAppSelect) historyAppSelect.value = app;
        
        let displayName = app.charAt(0).toUpperCase() + app.slice(1);
        if (app === 'whisparr') displayName = 'Whisparr V2';
        else if (app === 'eros') displayName = 'Whisparr V3';
        
        if (window.huntarrUI && window.huntarrUI.elements.currentHistoryApp) {
            window.huntarrUI.elements.currentHistoryApp.textContent = displayName;
        }
        
        this.updateHistoryPlaceholder(app);
        if (window.huntarrUI) window.huntarrUI.currentHistoryApp = app;
    },
    
    updateHistoryPlaceholder: function(app) {
        const placeholder = document.getElementById('history-placeholder-text');
        if (!placeholder) return;
        
        let message = "";
        if (app === 'all') {
            message = "The History feature will be available in a future update. Stay tuned for enhancements that will allow you to view your media processing history.";
        } else {
            const displayName = window.HuntarrHelpers ? window.HuntarrHelpers.capitalizeFirst(app) : app;
            message = `The ${displayName} History feature is under development and will be available in a future update. You'll be able to track your ${displayName} media processing history here.`;
        }
        
        placeholder.textContent = message;
    },
    
    handleSettingsOptionChange: function(e) {
        e.preventDefault();
        
        const app = e.target.getAttribute('data-app');
        if (!app || (window.huntarrUI && app === window.huntarrUI.currentSettingsApp)) return;
        
        if (window.huntarrUI && window.huntarrUI.elements.settingsOptions) {
            window.huntarrUI.elements.settingsOptions.forEach(option => {
                option.classList.remove('active');
            });
        }
        e.target.classList.add('active');
        
        let displayName = app.charAt(0).toUpperCase() + app.slice(1);
        if (window.huntarrUI && window.huntarrUI.elements.currentSettingsApp) {
            window.huntarrUI.elements.currentSettingsApp.textContent = displayName;
        }
        
        if (window.huntarrUI && window.huntarrUI.elements.settingsDropdownContent) {
            window.huntarrUI.elements.settingsDropdownContent.classList.remove('show');
        }
        
        if (window.huntarrUI && window.huntarrUI.elements.appSettingsPanels) {
            window.huntarrUI.elements.appSettingsPanels.forEach(panel => {
                panel.classList.remove('active');
                panel.style.display = 'none';
            });
        }
        
        const selectedPanel = document.getElementById(app + 'Settings');
        if (selectedPanel) {
            selectedPanel.classList.add('active');
            selectedPanel.style.display = 'block';
        }
        
        if (window.huntarrUI) window.huntarrUI.currentSettingsTab = app;
        console.log(`[HuntarrUIHandlers] Switched settings tab to: ${app}`);
    }
};


/* === modules/core/initialization.js === */
/**
 * Initialization Module
 * Handles dynamic loading and initialization of UI sections
 */

window.HuntarrInit = {
    initializeLogsSettings: function() {
        console.log('[HuntarrInit] initializeLogsSettings called');
        const container = document.getElementById('logsSettingsContainer');
        if (!container) return;
        
        const currentContent = container.innerHTML.trim();
        if (currentContent !== '' && !currentContent.includes('<!-- Content will be loaded here -->')) return;
        
        container.innerHTML = '<div class="loading-spinner" style="text-align: center; padding: 20px;"><i class="fas fa-circle-notch fa-spin"></i> Loading settings...</div>';
        
        HuntarrUtils.fetchWithTimeout('./api/settings')
            .then(response => response.json())
            .then(settings => {
                if (window.huntarrUI) window.huntarrUI.originalSettings.general = settings.general;
                const generalSettings = settings.general || {};
                
                if (window.SettingsForms && typeof window.SettingsForms.generateLogsSettingsForm === 'function') {
                    container.innerHTML = '';
                    window.SettingsForms.generateLogsSettingsForm(container, generalSettings);
                } else {
                    container.innerHTML = '<p class="error-message">Error loading form generator.</p>';
                }
            })
            .catch(error => {
                console.error('[HuntarrInit] Error loading settings for logs:', error);
                container.innerHTML = `<p class="error-message">Error: ${error.message}</p>`;
            });
    },

    initializeSettings: function() {
        console.log('[HuntarrInit] initializeSettings called');
        const generalSettings = document.getElementById('generalSettings');
        if (!generalSettings) return;

        const currentContent = generalSettings.innerHTML.trim();
        if (currentContent !== '' && !currentContent.includes('<!-- Content will be loaded here -->')) return;

        fetch('./api/settings')
            .then(response => response.json())
            .then(settings => {
                if (window.huntarrUI) window.huntarrUI.originalSettings.general = settings.general;
                if (typeof SettingsForms !== 'undefined' && SettingsForms.generateGeneralForm) {
                    SettingsForms.generateGeneralForm(generalSettings, settings.general || {});
                } else {
                    generalSettings.innerHTML = '<p>Error: Settings forms not loaded</p>';
                }
            })
            .catch(error => {
                console.error('[HuntarrInit] Error loading settings:', error);
                generalSettings.innerHTML = '<p>Error loading settings</p>';
            });
    },

    initializeNotifications: function() {
        console.log('[HuntarrInit] initializeNotifications called');
        // New notification system initializes itself via generateNotificationsForm
        // which is called by the settings loader, or we can trigger it directly.
        if (typeof SettingsForms !== 'undefined' && SettingsForms.generateNotificationsForm) {
            var container = document.getElementById('notificationsSection');
            if (container) {
                SettingsForms.generateNotificationsForm(container, {});
            }
        }
    },

    initializeBackupRestore: function() {
        console.log('[HuntarrInit] initializeBackupRestore called');
        if (typeof BackupRestore !== 'undefined') {
            BackupRestore.initialize();
        }
    },

    initializeProwlarr: function() {
        console.log('[HuntarrInit] initializeProwlarr called');
        const prowlarrContainer = document.getElementById('prowlarrContainer');
        if (!prowlarrContainer) return;
        
        const currentContent = prowlarrContainer.innerHTML.trim();
        if (currentContent !== '' && !currentContent.includes('<!-- Prowlarr content will be loaded here -->')) return;

        fetch('./api/settings')
            .then(response => response.json())
            .then(settings => {
                if (window.huntarrUI) window.huntarrUI.originalSettings.prowlarr = settings.prowlarr;
                if (typeof SettingsForms !== 'undefined' && SettingsForms.generateProwlarrForm) {
                    SettingsForms.generateProwlarrForm(prowlarrContainer, settings.prowlarr || {});
                } else {
                    prowlarrContainer.innerHTML = '<p>Error: Prowlarr forms not loaded</p>';
                }
            })
            .catch(error => {
                console.error('[HuntarrInit] Error loading prowlarr settings:', error);
                prowlarrContainer.innerHTML = '<p>Error loading prowlarr settings</p>';
            });
    },

    initializeUser: function() {
        console.log('[HuntarrInit] initializeUser called');
        if (typeof UserModule !== 'undefined') {
            if (!window.userModule) {
                window.userModule = new UserModule();
            }
        }
    },

    initializeSwaparr: function() {
        console.log('[HuntarrInit] initializeSwaparr called');
        const swaparrContainer = document.getElementById('swaparrContainer');
        if (!swaparrContainer) return;
        
        const currentContent = swaparrContainer.innerHTML.trim();
        if (currentContent !== '' && !currentContent.includes('<!-- Swaparr settings content will be shown here -->')) return;

        fetch('./api/swaparr/settings')
            .then(response => response.json())
            .then(settings => {
                if (window.huntarrUI) window.huntarrUI.originalSettings.swaparr = settings;
                if (typeof SettingsForms !== 'undefined' && SettingsForms.generateSwaparrForm) {
                    SettingsForms.generateSwaparrForm(swaparrContainer, settings || {});
                    if (window.huntarrUI && window.huntarrUI.loadSwaparrApps) window.huntarrUI.loadSwaparrApps();
                } else {
                    swaparrContainer.innerHTML = '<p>Error: Swaparr forms not loaded</p>';
                }
            })
            .catch(error => {
                console.error('[HuntarrInit] Error loading Swaparr settings:', error);
                swaparrContainer.innerHTML = '<p>Error loading Swaparr settings</p>';
            });
    }
};
