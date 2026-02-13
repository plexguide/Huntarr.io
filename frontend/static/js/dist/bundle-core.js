
/* === modules/core/utils.js === */
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
        // Legacy Movie Hunt home → Media Hunt Collection
        if (section === 'movie-hunt-home') {
            section = 'media-hunt-collection';
            if (window.location.hash !== '#media-hunt-collection') {
                window.history.replaceState(null, document.title, window.location.pathname + (window.location.search || '') + '#media-hunt-collection');
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
        if (section === 'activity') {
            section = 'activity-queue';
            if (window.location.hash !== '#activity-queue') window.location.hash = 'activity-queue';
        }
        // NZB Hunt Settings → go directly to Folders
        if (section === 'nzb-hunt-settings') {
            section = 'nzb-hunt-settings-folders';
            if (window.location.hash !== '#nzb-hunt-settings-folders') {
                window.history.replaceState(null, document.title, window.location.pathname + (window.location.search || '') + '#nzb-hunt-settings-folders');
            }
        }
        // NZB Hunt Processing → merged into Advanced
        if (section === 'nzb-hunt-settings-processing') {
            section = 'nzb-hunt-settings-advanced';
            if (window.location.hash !== '#nzb-hunt-settings-advanced') {
                window.history.replaceState(null, document.title, window.location.pathname + (window.location.search || '') + '#nzb-hunt-settings-advanced');
            }
        }
        // Instances merged into Settings: old bookmark redirects to Media Hunt Settings
        if (section === 'settings-instance-management') {
            section = 'media-hunt-settings';
            if (window.location.hash !== '#media-hunt-settings') {
                window.history.replaceState(null, document.title, window.location.pathname + (window.location.search || '') + '#media-hunt-settings');
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
        var tvHuntToSettings = {
            'tv-hunt-settings-custom-formats': 'settings-custom-formats',
            'tv-hunt-settings-profiles': 'settings-profiles',
            'tv-hunt-settings-indexers': 'settings-indexers',
            'tv-hunt-settings-clients': 'settings-clients',
            'tv-hunt-settings-root-folders': 'settings-root-folders',
            'settings-import-media-tv': 'settings-import-media',
            'tv-hunt-settings-sizes': 'settings-sizes',
            'tv-hunt-settings-tv-management': 'settings-media-management',
            'tv-hunt-settings-import-lists': 'settings-import-lists',
            'tv-hunt-activity-queue': 'activity-queue',
            'tv-hunt-activity-history': 'activity-history',
            'tv-hunt-activity-blocklist': 'activity-blocklist',
            'logs-tv-hunt': 'activity-logs'
        };
        if (tvHuntToSettings[section]) {
            var target = tvHuntToSettings[section];
            section = target;
            if (window.location.hash !== '#' + target) {
                window.history.replaceState(null, document.title, window.location.pathname + (window.location.search || '') + '#' + target);
            }
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

    // Sidebar management functions
    showMainSidebar: function() {
        const mainSidebar = document.getElementById('sidebar');
        const appsSidebar = document.getElementById('apps-sidebar');
        const settingsSidebar = document.getElementById('settings-sidebar');
        const requestarrSidebar = document.getElementById('requestarr-sidebar');
        const movieHuntSidebar = document.getElementById('movie-hunt-sidebar');
        
        if (movieHuntSidebar) movieHuntSidebar.style.display = 'none';
        if (mainSidebar) mainSidebar.style.display = 'block';
        if (appsSidebar) appsSidebar.style.display = 'none';
        if (settingsSidebar) settingsSidebar.style.display = 'none';
        if (requestarrSidebar) requestarrSidebar.style.display = 'none';

        // When on System (Hunt Manager, Logs, About), hide Apps, Requestarr, Settings in main sidebar on mobile only; desktop keeps all visible
        // When on Settings (Main, Scheduling, etc.), hide Apps, Requestarr, System in main sidebar
        var section = window.huntarrUI && window.huntarrUI.currentSection;
        var onSystem = section === 'system' || section === 'hunt-manager' || section === 'logs' || section === 'about';
        var onSettings = ['settings', 'scheduling', 'notifications', 'backup-restore', 'settings-logs', 'user'].indexOf(section) !== -1;
        var isDesktop = window.innerWidth > 768;
        var settingsNav = document.getElementById('settingsNav');
        var requestarrNav = document.getElementById('requestarrNav');
        var appsNav = document.getElementById('appsNav');
        var systemNav = document.getElementById('systemNav');
        var settingsSubGroup = document.getElementById('settings-sub');
        var systemSubGroup = document.getElementById('system-sub');
        if (onSystem && isDesktop) {
            if (settingsNav) settingsNav.style.display = '';
            if (settingsSubGroup) { settingsSubGroup.style.display = 'none'; settingsSubGroup.classList.remove('expanded'); }
            if (requestarrNav) requestarrNav.style.display = '';
            if (appsNav) appsNav.style.display = '';
            if (systemNav) systemNav.style.display = '';
            if (systemSubGroup) { systemSubGroup.style.display = 'block'; systemSubGroup.classList.add('expanded'); }
        } else if (onSettings && isDesktop) {
            if (settingsNav) settingsNav.style.display = '';
            if (settingsSubGroup) { settingsSubGroup.style.display = 'block'; settingsSubGroup.classList.add('expanded'); }
            if (requestarrNav) requestarrNav.style.display = '';
            if (appsNav) appsNav.style.display = '';
            if (systemNav) systemNav.style.display = '';
            if (systemSubGroup) { systemSubGroup.style.display = 'none'; systemSubGroup.classList.remove('expanded'); }
        } else {
            if (settingsNav) settingsNav.style.display = onSystem ? 'none' : '';
            if (settingsSubGroup) { settingsSubGroup.style.display = onSystem ? 'none' : (onSettings ? 'block' : 'none'); settingsSubGroup.classList.toggle('expanded', onSettings); }
            if (requestarrNav) requestarrNav.style.display = (onSystem || onSettings) ? 'none' : '';
            if (appsNav) appsNav.style.display = (onSystem || onSettings) ? 'none' : '';
            if (systemNav) systemNav.style.display = onSettings ? 'none' : '';
            if (systemSubGroup) { systemSubGroup.style.display = onSettings ? 'none' : (onSystem ? 'block' : 'none'); systemSubGroup.classList.toggle('expanded', onSystem); }
        }
        if (window.huntarrUI && typeof window.huntarrUI._updateMainSidebarBetaVisibility === 'function') {
            window.huntarrUI._updateMainSidebarBetaVisibility();
        }
    },

    showAppsSidebar: function() {
        const mainSidebar = document.getElementById('sidebar');
        const appsSidebar = document.getElementById('apps-sidebar');
        const settingsSidebar = document.getElementById('settings-sidebar');
        const requestarrSidebar = document.getElementById('requestarr-sidebar');
        const movieHuntSidebar = document.getElementById('movie-hunt-sidebar');
        
        if (movieHuntSidebar) movieHuntSidebar.style.display = 'none';
        if (mainSidebar) mainSidebar.style.display = 'none';
        if (appsSidebar) appsSidebar.style.display = 'block';
        if (settingsSidebar) settingsSidebar.style.display = 'none';
        if (requestarrSidebar) requestarrSidebar.style.display = 'none';
        
        // Update active state
        this.updateAppsSidebarActive();
    },

    showSettingsSidebar: function() {
        const mainSidebar = document.getElementById('sidebar');
        const appsSidebar = document.getElementById('apps-sidebar');
        const settingsSidebar = document.getElementById('settings-sidebar');
        const requestarrSidebar = document.getElementById('requestarr-sidebar');
        const movieHuntSidebar = document.getElementById('movie-hunt-sidebar');
        
        if (movieHuntSidebar) movieHuntSidebar.style.display = 'none';
        if (mainSidebar) mainSidebar.style.display = 'none';
        if (appsSidebar) appsSidebar.style.display = 'none';
        if (settingsSidebar) settingsSidebar.style.display = 'block';
        if (requestarrSidebar) requestarrSidebar.style.display = 'none';
        
        // Update active state
        this.updateSettingsSidebarActive();
    },

    showRequestarrSidebar: function() {
        const mainSidebar = document.getElementById('sidebar');
        const appsSidebar = document.getElementById('apps-sidebar');
        const settingsSidebar = document.getElementById('settings-sidebar');
        const requestarrSidebar = document.getElementById('requestarr-sidebar');
        const movieHuntSidebar = document.getElementById('movie-hunt-sidebar');
        
        if (mainSidebar) mainSidebar.style.display = 'none';
        if (appsSidebar) appsSidebar.style.display = 'none';
        if (settingsSidebar) settingsSidebar.style.display = 'none';
        if (movieHuntSidebar) movieHuntSidebar.style.display = 'none';
        if (requestarrSidebar) requestarrSidebar.style.display = 'block';
        
        this.updateRequestarrSidebarActive();
    },

    showMovieHuntSidebar: function() {
        const mainSidebar = document.getElementById('sidebar');
        const appsSidebar = document.getElementById('apps-sidebar');
        const settingsSidebar = document.getElementById('settings-sidebar');
        const requestarrSidebar = document.getElementById('requestarr-sidebar');
        const movieHuntSidebar = document.getElementById('movie-hunt-sidebar');
        
        if (mainSidebar) mainSidebar.style.display = 'none';
        if (appsSidebar) appsSidebar.style.display = 'none';
        if (settingsSidebar) settingsSidebar.style.display = 'none';
        if (requestarrSidebar) requestarrSidebar.style.display = 'none';
        if (movieHuntSidebar) movieHuntSidebar.style.display = 'flex';
        
        this.updateMovieHuntSidebarActive();
    },

    showTVHuntSidebar: function() {
        // TV Hunt menu removed; use Media Hunt (movie-hunt) sidebar for all media-hunt sections
        this.showMovieHuntSidebar();
    },

    updateMovieHuntSidebarActive: function() {
        if (!window.huntarrUI) return;
        const currentSection = window.huntarrUI.currentSection;
        let sectionForNav = currentSection;
        if (currentSection === 'instance-editor' && window.SettingsForms && window.SettingsForms._currentEditing) {
            const appType = window.SettingsForms._currentEditing.appType;
            if (appType === 'indexer') sectionForNav = 'settings-indexers';
            else if (appType === 'client') sectionForNav = 'settings-clients';
        }
        const collectionSections = ['movie-hunt-home', 'movie-hunt-collection', 'media-hunt-collection', 'settings-import-media', 'movie-hunt-calendar'];
        const activitySections = ['activity-queue', 'activity-history', 'activity-blocklist', 'activity-logs', 'logs-movie-hunt'];
        const settingsSections = ['movie-hunt-settings', 'media-hunt-settings', 'settings-instance-management', 'settings-media-management', 'settings-profiles', 'settings-sizes', 'profile-editor', 'settings-custom-formats', 'settings-indexers', 'settings-clients', 'settings-import-lists', 'settings-root-folders', 'instance-editor'];
        const onCollection = collectionSections.indexOf(currentSection) !== -1;
        const onActivity = activitySections.indexOf(sectionForNav) !== -1;
        const onSettings = settingsSections.indexOf(currentSection) !== -1;

        const colSub = document.getElementById('movie-hunt-collection-sub');
        const actSub = document.getElementById('movie-hunt-activity-sub');
        const setSub = document.getElementById('movie-hunt-settings-sub');
        if (colSub) colSub.classList.toggle('expanded', onCollection);
        if (actSub) actSub.classList.toggle('expanded', onActivity);
        if (setSub) setSub.classList.toggle('expanded', onSettings);

        const items = document.querySelectorAll('#movie-hunt-sidebar .nav-item');
        const isActivitySub = activitySections.indexOf(sectionForNav) !== -1;
        items.forEach(item => {
            item.classList.remove('active');
            if (isActivitySub && item.id === 'movieHuntActivityNav') return;
            const href = item.getAttribute && item.getAttribute('href') || (item.querySelector('a') && item.querySelector('a').getAttribute('href'));
            if (href && (href === '#' + sectionForNav || href.endsWith('#' + sectionForNav))) {
                item.classList.add('active');
            }
        });
    },

    updateTVHuntSidebarActive: function() {
        // TV Hunt sidebar removed; no-op
    },

    updateAppsSidebarActive: function() {
        if (!window.huntarrUI) return;
        
        const currentSection = window.huntarrUI.currentSection;
        const appsSidebarItems = document.querySelectorAll('#apps-sidebar .nav-item');
        
        appsSidebarItems.forEach(item => {
            item.classList.remove('active');
            const href = (item.getAttribute && item.getAttribute('href')) || '';
            if (href === `#${currentSection}` || (href && href.endsWith('#' + currentSection))) {
                item.classList.add('active');
            }
        });
    },

    updateSettingsSidebarActive: function() {
        if (!window.huntarrUI) return;
        
        const currentSection = window.huntarrUI.currentSection;
        const settingsSidebarItems = document.querySelectorAll('#settings-sidebar .nav-item');
        
        settingsSidebarItems.forEach(item => {
            item.classList.remove('active');
            const href = item.getAttribute && item.getAttribute('href') || (item.querySelector('a') && item.querySelector('a').getAttribute('href'));
            if (href && (href === '#' + currentSection || href.endsWith('#' + currentSection))) {
                item.classList.add('active');
            }
        });
    },

    updateRequestarrSidebarActive: function() {
        if (!window.huntarrUI) return;
        
        const currentSection = window.huntarrUI.currentSection;
        const requestarrSidebarItems = document.querySelectorAll('#requestarr-sidebar .nav-item');
        
        requestarrSidebarItems.forEach(item => {
            item.classList.remove('active');
            const link = item.querySelector('a');
            if (link) {
                const href = link.getAttribute('href');
                if (href === `#${currentSection}`) {
                    item.classList.add('active');
                }
            }
        });
    },

    setupAppsNavigation: function() {
        console.log('[Navigation] Setting up apps navigation');
        
        const appsNavItems = document.querySelectorAll('#apps-sidebar .nav-item a');
        appsNavItems.forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const href = item.getAttribute('href');
                if (href) {
                    window.location.hash = href;
                }
            });
        });
    },

    setupSettingsNavigation: function() {
        console.log('[Navigation] Setting up settings navigation');
        
        const settingsNavItems = document.querySelectorAll('#settings-sidebar .nav-item a');
        settingsNavItems.forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const href = item.getAttribute('href');
                if (href) {
                    window.location.hash = href;
                }
            });
        });
    },

    // setupRequestarrNavigation: handled by HuntarrRequestarr.setupRequestarrNavigation() in requestarr-controller.js

    setupMovieHuntNavigation: function() {
        const movieHuntNavItems = document.querySelectorAll('#movie-hunt-sidebar .nav-item a');
        movieHuntNavItems.forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const href = item.getAttribute('href') || '';
                const hashIdx = href.indexOf('#');
                const fragment = hashIdx >= 0 ? href.substring(hashIdx + 1) : href.replace(/^\.?\/*/, '');
                if (fragment) window.location.hash = fragment;
            });
        });
    },

    setupTVHuntNavigation: function() {
        // TV Hunt sidebar removed; no-op
    },

    setupNzbHuntNavigation: function() {
        const nzbHuntNavItems = document.querySelectorAll('#nzb-hunt-sidebar .nav-item');
        nzbHuntNavItems.forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const link = item.tagName === 'A' ? item : item.querySelector('a');
                if (!link) return;
                const href = link.getAttribute('href') || '';
                const hashIdx = href.indexOf('#');
                const fragment = hashIdx >= 0 ? href.substring(hashIdx + 1) : href.replace(/^\.?\/*/, '');
                if (fragment) window.location.hash = fragment;
            });
        });
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
 * Handles dark mode and logo persistence
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
        const darkModeToggle = document.getElementById('darkModeToggle');
        if (darkModeToggle) {
            const prefersDarkMode = HuntarrUtils.getUIPreference('dark-mode', true);
            darkModeToggle.checked = prefersDarkMode;
            if (prefersDarkMode) document.body.classList.add('dark-theme');
            
            darkModeToggle.addEventListener('change', function() {
                const isDarkMode = this.checked;
                document.body.classList.toggle('dark-theme', isDarkMode);
                HuntarrUtils.setUIPreference('dark-mode', isDarkMode);
            });
        }
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
                const versionElement = document.getElementById('version-value');
                if (versionElement) {
                    versionElement.textContent = version.trim();
                    versionElement.style.display = 'inline';
                }
                
                // Store in localStorage for topbar access
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
                const versionElement = document.getElementById('version-value');
                if (versionElement) {
                    versionElement.textContent = 'Error';
                    versionElement.style.display = 'inline';
                }
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
                const latestVersionElement = document.getElementById('latest-version-value');
                if (latestVersionElement && data && data.tag_name) {
                    latestVersionElement.textContent = data.tag_name;
                    latestVersionElement.style.display = 'inline';
                    
                    // Store in localStorage for topbar access
                    try {
                        const versionInfo = localStorage.getItem('huntarr-version-info') || '{}';
                        const parsedInfo = JSON.parse(versionInfo);
                        parsedInfo.latestVersion = data.tag_name;
                        localStorage.setItem('huntarr-version-info', JSON.stringify(parsedInfo));
                    } catch (e) {
                        console.error('Error saving latest version to localStorage:', e);
                    }
                } else if (latestVersionElement) {
                     latestVersionElement.textContent = 'N/A';
                     latestVersionElement.style.display = 'inline';
                }
            })
            .catch(error => {
                console.error('Error loading latest version from GitHub:', error);
                const latestVersionElement = document.getElementById('latest-version-value');
                if (latestVersionElement) {
                    latestVersionElement.textContent = error.message === 'Rate limited' ? 'Rate Limited' : 'Error';
                    latestVersionElement.style.display = 'inline';
                }
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
