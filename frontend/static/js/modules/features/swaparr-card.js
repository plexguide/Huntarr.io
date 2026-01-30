/**
 * Swaparr Module
 * Handles Swaparr-specific functionality
 */

window.HuntarrSwaparr = {
    swaparrResetInProgress: false,

    loadSwaparrStatus: function() {
        HuntarrUtils.fetchWithTimeout('./api/swaparr/status')
            .then(response => response.json())
            .then(data => {
                const swaparrCard = document.getElementById('swaparrStatusCard');
                if (!swaparrCard) return;

                // Show/hide card based on whether Swaparr is enabled
                if (data.enabled && data.configured) {
                    swaparrCard.style.display = 'block';
                    
                    // Update persistent statistics with large number formatting
                    const persistentStats = data.persistent_statistics || {};
                    const formatNumber = window.HuntarrStats ? 
                        window.HuntarrStats.formatLargeNumber.bind(window.HuntarrStats) : 
                        (n => n.toString());
                    
                    document.getElementById('swaparr-processed').textContent = formatNumber(persistentStats.processed || 0);
                    document.getElementById('swaparr-strikes').textContent = formatNumber(persistentStats.strikes || 0);
                    document.getElementById('swaparr-removals').textContent = formatNumber(persistentStats.removals || 0);
                    document.getElementById('swaparr-ignored').textContent = formatNumber(persistentStats.ignored || 0);
                    
                    // Setup button event handlers after content is loaded
                    setTimeout(() => {
                        this.setupSwaparrResetCycle();
                    }, 100);
                    
                } else {
                    swaparrCard.style.display = 'none';
                }
            })
            .catch(error => {
                console.error('Error loading Swaparr status:', error);
                const swaparrCard = document.getElementById('swaparrStatusCard');
                if (swaparrCard) {
                    swaparrCard.style.display = 'none';
                }
            });
    },

    setupSwaparrResetCycle: function() {
        // Handle header reset data button (only attach once to avoid multiple confirm dialogs)
        const resetDataButton = document.getElementById('reset-swaparr-data');
        if (resetDataButton && !resetDataButton.dataset.swaparrResetBound) {
            resetDataButton.dataset.swaparrResetBound = 'true';
            resetDataButton.addEventListener('click', () => {
                this.resetSwaparrData();
            });
        }
    },

    resetSwaparrData: function() {
        // Prevent multiple executions
        if (this.swaparrResetInProgress) {
            return;
        }
        
        // Show confirmation
        if (!confirm('Are you sure you want to reset all Swaparr data? This will clear all strike counts and removed items data.')) {
            return;
        }
        
        this.swaparrResetInProgress = true;
        
        // Immediately update the UI first to provide immediate feedback
        this.updateSwaparrStatsDisplay({
            processed: 0,
            strikes: 0, 
            removals: 0,
            ignored: 0
        });
        
        // Show success notification immediately
        if (window.HuntarrNotifications) {
            window.HuntarrNotifications.showNotification('Swaparr statistics reset successfully', 'success');
        }

        // Try to send the reset to the server
        try {
            HuntarrUtils.fetchWithTimeout('./api/swaparr/reset-stats', { method: 'POST' })
                .then(response => {
                    if (!response.ok) {
                        console.warn('Server responded with non-OK status for Swaparr stats reset');
                    }
                    return response.json().catch(() => ({}));
                })
                .then(data => {
                    console.log('Swaparr stats reset response:', data);
                })
                .catch(error => {
                    console.warn('Error communicating with server for Swaparr stats reset:', error);
                })
                .finally(() => {
                    // Reset the flag after a delay
                    setTimeout(() => {
                        this.swaparrResetInProgress = false;
                    }, 1000);
                });
        } catch (error) {
            console.warn('Error in Swaparr stats reset:', error);
            this.swaparrResetInProgress = false;
        }
    },

    updateSwaparrStatsDisplay: function(stats) {
        const elements = {
            'processed': document.getElementById('swaparr-processed'),
            'strikes': document.getElementById('swaparr-strikes'),
            'removals': document.getElementById('swaparr-removals'),
            'ignored': document.getElementById('swaparr-ignored')
        };

        const parseNumber = window.HuntarrStats ? 
            window.HuntarrStats.parseFormattedNumber.bind(window.HuntarrStats) : 
            (str => parseInt(str) || 0);
        
        const animateNumber = window.HuntarrStats ? 
            window.HuntarrStats.animateNumber.bind(window.HuntarrStats) : 
            null;

        for (const [key, element] of Object.entries(elements)) {
            if (element && stats.hasOwnProperty(key)) {
                const currentValue = parseNumber(element.textContent);
                const targetValue = stats[key];
                
                if (currentValue !== targetValue && animateNumber) {
                    animateNumber(element, currentValue, targetValue);
                } else if (currentValue !== targetValue) {
                    element.textContent = targetValue;
                }
            }
        }
    },

    setupSwaparrStatusPolling: function() {
        // Load initial status
        this.loadSwaparrStatus();
        
        // Set up polling to refresh Swaparr status every 30 seconds
        setInterval(() => {
            if (window.huntarrUI && window.huntarrUI.currentSection === 'home') {
                this.loadSwaparrStatus();
            }
        }, 30000);
    },

    loadSwaparrApps: function() {
        console.log('[HuntarrSwaparr] loadSwaparrApps called');
        
        // Get the Swaparr apps panel
        const swaparrAppsPanel = document.getElementById('swaparrApps');
        if (!swaparrAppsPanel) {
            console.error('[HuntarrSwaparr] swaparrApps panel not found');
            return;
        }

        // Check if there's a dedicated Swaparr apps module
        if (typeof window.swaparrModule !== 'undefined' && window.swaparrModule.loadApps) {
            console.log('[HuntarrSwaparr] Using dedicated Swaparr module to load apps');
            window.swaparrModule.loadApps();
        } else if (typeof SwaparrApps !== 'undefined') {
            console.log('[HuntarrSwaparr] Using SwaparrApps module to load apps');
            SwaparrApps.loadApps();
        } else {
            console.log('[HuntarrSwaparr] No dedicated Swaparr apps module found');
            this.loadSwaparrStatus();
        }
    },

    initializeSwaparr: function() {
        console.log('[HuntarrSwaparr] Initializing Swaparr section');
        
        // Load Swaparr apps when section is shown
        this.loadSwaparrApps();
        
        // Any other Swaparr-specific initialization
        // This could include setting up event listeners, loading config, etc.
    }
};
