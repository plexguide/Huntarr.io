// Sonarr-specific functionality

(function(app) {
    if (!app) {
        console.error("Huntarr App core is not loaded!");
        return;
    }

    const sonarrModule = {
        elements: {},

        init: function() {
            // Cache elements specific to Sonarr settings
            this.cacheElements();
            // Setup event listeners specific to Sonarr settings
            this.setupEventListeners();
            // Initial population of the form is handled by app.js
        },

        cacheElements: function() {
            // Cache elements used by Sonarr settings form
            this.elements.apiUrlInput = document.getElementById('sonarr_api_url');
            this.elements.apiKeyInput = document.getElementById('sonarr_api_key');
            this.elements.huntMissingItemsInput = document.getElementById('sonarr-hunt-missing-items');
            this.elements.huntUpgradeItemsInput = document.getElementById('sonarr-hunt-upgrade-items');
            this.elements.sleepDurationInput = document.getElementById('sonarr_sleep_duration');
            this.elements.sleepDurationHoursSpan = document.getElementById('sonarr_sleep_duration_hours');
            this.elements.monitoredOnlyInput = document.getElementById('sonarr_monitored_only');
            this.elements.skipFutureEpisodesInput = document.getElementById('sonarr_skip_future_episodes');
            this.elements.skipSeriesRefreshInput = document.getElementById('sonarr_skip_series_refresh');
            this.elements.randomMissingInput = document.getElementById('sonarr_random_missing'); 
            this.elements.randomUpgradesInput = document.getElementById('sonarr_random_upgrades'); 
            this.elements.debugModeInput = document.getElementById('sonarr_debug_mode'); 
            this.elements.apiTimeoutInput = document.getElementById('sonarr_api_timeout'); 
            this.elements.commandWaitDelayInput = document.getElementById('sonarr_command_wait_delay'); 
            this.elements.commandWaitAttemptsInput = document.getElementById('sonarr_command_wait_attempts'); 
            this.elements.minimumDownloadQueueSizeInput = document.getElementById('sonarr_minimum_download_queue_size'); 
            // Add other Sonarr-specific elements if any
        },

        setupEventListeners: function() {
            // Add event listeners for Sonarr-specific controls if needed
            // Example: If there were unique interactions for Sonarr settings
            // Most change detection is now handled centrally by app.js

            // Update sleep duration display on input change
            if (this.elements.sleepDurationInput) {
                this.elements.sleepDurationInput.addEventListener('input', () => {
                    this.updateSleepDurationDisplay();
                    // Central change detection handles the rest
                });
            }
        },

        updateSleepDurationDisplay: function() {
            // Use the central utility function for updating duration display
            if (this.elements.sleepDurationInput && this.elements.sleepDurationHoursSpan) {
                const seconds = parseInt(this.elements.sleepDurationInput.value) || 900;
                app.updateDurationDisplay(seconds, this.elements.sleepDurationHoursSpan);
            }
        },

        // REMOVED: loadSettings function (handled by app.js)

        // REMOVED: checkForChanges function (handled by app.js)

        // REMOVED: updateSaveButtonState function (handled by app.js)

        // REMOVED: getSettingsPayload function (handled by app.js)

        // REMOVED: saveSettings function (handled by app.js)

        // REMOVED: Overriding of app.saveSettings
    };

    // Initialize Sonarr module
    sonarrModule.init();

    // Add the Sonarr module to the app for reference if needed elsewhere
    app.sonarrModule = sonarrModule;

})(window.huntarrUI); // Use the new global object name
