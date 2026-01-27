// Radarr-specific functionality

(function(app) {
    if (!app) {
        console.error("Huntarr App core is not loaded!");
        return;
    }

    const radarrModule = {
        elements: {},

        init: function() {
            console.log('[Radarr Module] Initializing...');
            this.cacheElements();
            this.setupEventListeners();
        },

        cacheElements: function() {
            // Cache elements specific to the Radarr settings form
            this.elements.apiUrlInput = document.getElementById('radarr_api_url');
            this.elements.apiKeyInput = document.getElementById('radarr_api_key');
            this.elements.huntMissingMoviesInput = document.getElementById('hunt_missing_movies');
            this.elements.huntUpgradeMoviesInput = document.getElementById('hunt_upgrade_movies');
            this.elements.sleepDurationInput = document.getElementById('radarr_sleep_duration');
            this.elements.sleepDurationHoursSpan = document.getElementById('radarr_sleep_duration_hours');
            this.elements.stateResetIntervalInput = document.getElementById('radarr_state_reset_interval_hours');
            this.elements.monitoredOnlyInput = document.getElementById('radarr_monitored_only');
            this.elements.skipFutureReleasesInput = document.getElementById('skip_future_releases'); // Note: ID might be shared
            this.elements.skipMovieRefreshInput = document.getElementById('skip_movie_refresh');
            this.elements.randomMissingInput = document.getElementById('radarr_random_missing');
            this.elements.randomUpgradesInput = document.getElementById('radarr_random_upgrades');
            this.elements.debugModeInput = document.getElementById('radarr_debug_mode');
            this.elements.apiTimeoutInput = document.getElementById('radarr_api_timeout');
            this.elements.commandWaitDelayInput = document.getElementById('radarr_command_wait_delay');
            this.elements.commandWaitAttemptsInput = document.getElementById('radarr_command_wait_attempts');
            this.elements.minimumDownloadQueueSizeInput = document.getElementById('radarr_minimum_download_queue_size');
            // Add any other Radarr-specific elements
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

    // Initialize Radarr module
    document.addEventListener('DOMContentLoaded', () => {
        if (document.getElementById('radarrSettings')) {
            radarrModule.init();
            if (app) {
                app.radarrModule = radarrModule;
            }
        }
    });

})(window.huntarrUI); // Pass the global UI object
