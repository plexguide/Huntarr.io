// Lidarr-specific functionality

(function(app) {
    if (!app) {
        console.error("Huntarr App core is not loaded!");
        return;
    }

    const lidarrModule = {
        elements: {
            apiUrlInput: document.getElementById('lidarr_api_url'),
            apiKeyInput: document.getElementById('lidarr_api_key'),
            connectionTestButton: document.getElementById('test-lidarr-connection'),
            huntMissingModeSelect: document.getElementById('hunt_missing_mode'),
            huntMissingItemsInput: document.getElementById('hunt_missing_items'),
            huntUpgradeItemsInput: document.getElementById('hunt_upgrade_items'),
            sleepDurationInput: document.getElementById('lidarr_sleep_duration'),
            sleepDurationHoursSpan: document.getElementById('lidarr_sleep_duration_hours'),
            stateResetIntervalInput: document.getElementById('lidarr_state_reset_interval_hours'),
            monitoredOnlyInput: document.getElementById('lidarr_monitored_only'),
            skipFutureReleasesInput: document.getElementById('lidarr_skip_future_releases'),
            skipArtistRefreshInput: document.getElementById('skip_artist_refresh'),
            randomMissingInput: document.getElementById('lidarr_random_missing'),
            randomUpgradesInput: document.getElementById('lidarr_random_upgrades'),
            debugModeInput: document.getElementById('lidarr_debug_mode'),
            apiTimeoutInput: document.getElementById('lidarr_api_timeout'),
            commandWaitDelayInput: document.getElementById('lidarr_command_wait_delay'),
            commandWaitAttemptsInput: document.getElementById('lidarr_command_wait_attempts'),
            minimumDownloadQueueSizeInput: document.getElementById('lidarr_minimum_download_queue_size')
        },

        init: function() {
            console.log('[Lidarr Module] Initializing...');
            // Cache elements specific to the Lidarr settings form
            this.elements = {
                apiUrlInput: document.getElementById('lidarr_api_url'),
                apiKeyInput: document.getElementById('lidarr_api_key'),
                connectionTestButton: document.getElementById('test-lidarr-connection'),
                huntMissingModeSelect: document.getElementById('hunt_missing_mode'),
                huntMissingItemsInput: document.getElementById('hunt_missing_items'),
                huntUpgradeItemsInput: document.getElementById('hunt_upgrade_items'),
                // ...other element references
            };

            // Add event listeners
            this.addEventListeners();
        },

        addEventListeners() {
            // Add connection test button click handler
            if (this.elements.connectionTestButton) {
                this.elements.connectionTestButton.addEventListener('click', this.testConnection.bind(this));
            }
            
            // Add event listener to update help text when missing mode changes
            if (this.elements.huntMissingModeSelect) {
                this.elements.huntMissingModeSelect.addEventListener('change', this.updateHuntMissingModeHelp.bind(this));
                // Initial update
                this.updateHuntMissingModeHelp();
            }
        },
        
        // Update help text based on selected missing mode
        updateHuntMissingModeHelp() {
            const mode = this.elements.huntMissingModeSelect.value;
            const helpText = document.querySelector('#hunt_missing_items + .setting-help');
            
            if (helpText) {
                if (mode === 'artist') {
                    helpText.textContent = "Number of artists with missing albums to search per cycle (0 to disable)";
                } else if (mode === 'album') {
                    helpText.textContent = "Number of specific albums to search per cycle (0 to disable)";
                }
            }
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

    // Initialize Lidarr module when DOM content is loaded and if lidarrSettings exists
    document.addEventListener('DOMContentLoaded', () => {
        if (document.getElementById('lidarrSettings')) {
            lidarrModule.init();
            if (app) {
                app.lidarrModule = lidarrModule;
            }
        }
    });

})(window.huntarrUI); // Pass the global UI object
