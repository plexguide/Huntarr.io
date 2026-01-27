// Readarr-specific functionality

(function(app) {
    if (!app) {
        console.error("Huntarr App core is not loaded!");
        return;
    }

    const readarrModule = {
        elements: {},

        init: function() {
            console.log('[Readarr Module] Initializing...');
            this.cacheElements();
            this.setupEventListeners();
        },

        cacheElements: function() {
            // Cache elements specific to the Readarr settings form
            this.elements.apiUrlInput = document.getElementById('readarr_api_url');
            this.elements.apiKeyInput = document.getElementById('readarr_api_key');
            this.elements.huntMissingBooksInput = document.getElementById('hunt_missing_books');
            this.elements.huntUpgradeBooksInput = document.getElementById('hunt_upgrade_books');
            this.elements.sleepDurationInput = document.getElementById('readarr_sleep_duration');
            this.elements.sleepDurationHoursSpan = document.getElementById('readarr_sleep_duration_hours');
            this.elements.stateResetIntervalInput = document.getElementById('readarr_state_reset_interval_hours');
            this.elements.monitoredOnlyInput = document.getElementById('readarr_monitored_only');
            this.elements.skipFutureReleasesInput = document.getElementById('readarr_skip_future_releases');
            this.elements.skipAuthorRefreshInput = document.getElementById('skip_author_refresh');
            this.elements.randomMissingInput = document.getElementById('readarr_random_missing');
            this.elements.randomUpgradesInput = document.getElementById('readarr_random_upgrades');
            this.elements.debugModeInput = document.getElementById('readarr_debug_mode');
            this.elements.apiTimeoutInput = document.getElementById('readarr_api_timeout');
            this.elements.commandWaitDelayInput = document.getElementById('readarr_command_wait_delay');
            this.elements.commandWaitAttemptsInput = document.getElementById('readarr_command_wait_attempts');
            this.elements.minimumDownloadQueueSizeInput = document.getElementById('readarr_minimum_download_queue_size');
            // Add any other Readarr-specific elements
        },

        setupEventListeners: function() {
            // Keep listeners ONLY for elements with specific UI updates beyond simple value changes
            if (this.elements.sleepDurationInput) {
                this.elements.sleepDurationInput.addEventListener('input', () => {
                    this.updateSleepDurationDisplay();
                    // No need to call checkForChanges here, handled by delegation
                });
            }
            // Remove other input listeners previously used for checkForChanges
        },

        updateSleepDurationDisplay: function() {
            // This function remains as it updates a specific UI element
            if (this.elements.sleepDurationInput && this.elements.sleepDurationHoursSpan) {
                const seconds = parseInt(this.elements.sleepDurationInput.value) || 900;
                // Assuming app.updateDurationDisplay exists and is accessible
                if (app && typeof app.updateDurationDisplay === 'function') {
                     app.updateDurationDisplay(seconds, this.elements.sleepDurationHoursSpan);
                } else {
                    console.warn("app.updateDurationDisplay not found, sleep duration text might not update.");
                }
            }
        }
    };

    // Initialize Readarr module
    document.addEventListener('DOMContentLoaded', () => {
        if (document.getElementById('readarrSettings')) {
            readarrModule.init();
            if (app) {
                app.readarrModule = readarrModule;
            }
        }
    });

})(window.huntarrUI); // Pass the global UI object
