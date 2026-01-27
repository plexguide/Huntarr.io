/**
 * Stats & Dashboard Module
 * Handles media stats, app connections, and dashboard display
 */

window.HuntarrStats = {
    isLoadingStats: false,

    loadMediaStats: function() {
        // Prevent multiple simultaneous stats loading
        if (this.isLoadingStats) {
            console.debug('Stats already loading, skipping duplicate request');
            return;
        }
        
        this.isLoadingStats = true;
        
        // Try to load cached stats first for immediate display
        const cachedStats = localStorage.getItem('huntarr-stats-cache');
        if (cachedStats) {
            try {
                const parsedStats = JSON.parse(cachedStats);
                const cacheAge = Date.now() - (parsedStats.timestamp || 0);
                // Use cache if less than 5 minutes old
                if (cacheAge < 300000) {
                    console.log('[HuntarrStats] Using cached stats for immediate display');
                    this.updateStatsDisplay(parsedStats.stats, true); // true = from cache
                }
            } catch (e) {
                console.log('[HuntarrStats] Failed to parse cached stats');
            }
        }
        
        // Add loading class to stats container to hide raw JSON
        const statsContainer = document.querySelector('.media-stats-container');
        if (statsContainer) {
            statsContainer.classList.add('stats-loading');
        }
        
        HuntarrUtils.fetchWithTimeout('./api/stats')
            .then(response => {
                if (!response.ok) {
                    throw new Error('Network response was not ok');
                }
                return response.json();
            })
            .then(data => {
                if (data.success && data.stats) {
                    // Store raw stats data globally for tooltips to access
                    window.mediaStats = data.stats;
                    
                    // Cache the fresh stats with timestamp
                    localStorage.setItem('huntarr-stats-cache', JSON.stringify({
                        stats: data.stats,
                        timestamp: Date.now()
                    }));
                    
                    // Update display
                    this.updateStatsDisplay(data.stats);
                    
                    // Remove loading class after stats are loaded
                    if (statsContainer) {
                        statsContainer.classList.remove('stats-loading');
                    }
                } else {
                    console.error('Failed to load statistics:', data.message || 'Unknown error');
                }
            })
            .catch(error => {
                console.error('Error fetching statistics:', error);
                // Remove loading class on error too
                if (statsContainer) {
                    statsContainer.classList.remove('stats-loading');
                }
            })
            .finally(() => {
                // Always clear the loading flag
                this.isLoadingStats = false;
            });
    },
    
    updateStatsDisplay: function(stats, isFromCache = false) {
        // Update each app's statistics
        const apps = ['sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros', 'swaparr'];
        const statTypes = ['hunted', 'upgraded'];
        
        // Check if low usage mode is enabled
        const isLowUsageMode = window.huntarrUI ? window.huntarrUI.isLowUsageModeEnabled() : false;
        
        console.log(`[HuntarrStats] updateStatsDisplay - Low usage mode: ${isLowUsageMode}, from cache: ${isFromCache}`);
        
        apps.forEach(app => {
            if (stats[app]) {
                statTypes.forEach(type => {
                    const element = document.getElementById(`${app}-${type}`);
                    if (element) {
                        // Get current and target values, ensuring they're valid numbers
                        const currentText = element.textContent || '0';
                        const currentValue = this.parseFormattedNumber(currentText);
                        const targetValue = Math.max(0, parseInt(stats[app][type]) || 0); // Ensure non-negative
                        
                        // If low usage mode is enabled or loading from cache, skip animations and set values directly
                        if (isLowUsageMode || isFromCache) {
                            element.textContent = this.formatLargeNumber(targetValue);
                        } else {
                            // Only animate if values are different and both are valid
                            if (currentValue !== targetValue && !isNaN(currentValue) && !isNaN(targetValue)) {
                                // Cancel any existing animation for this element
                                if (element.animationFrame) {
                                    cancelAnimationFrame(element.animationFrame);
                                }
                                
                                // Animate the number change
                                this.animateNumber(element, currentValue, targetValue);
                            } else if (isNaN(currentValue) || currentValue < 0) {
                                // If current value is invalid, set directly without animation
                                element.textContent = this.formatLargeNumber(targetValue);
                            }
                        }
                    }
                });
            }
        });
    },

    parseFormattedNumber: function(formattedStr) {
        if (!formattedStr || typeof formattedStr !== 'string') return 0;
        
        // Remove any formatting (K, M, commas, etc.)
        const cleanStr = formattedStr.replace(/[^\d.-]/g, '');
        const parsed = parseInt(cleanStr);
        
        // Handle K and M suffixes
        if (formattedStr.includes('K')) {
            return Math.floor(parsed * 1000);
        } else if (formattedStr.includes('M')) {
            return Math.floor(parsed * 1000000);
        }
        
        return isNaN(parsed) ? 0 : Math.max(0, parsed);
    },

    animateNumber: function(element, start, end) {
        // Ensure start and end are valid numbers
        start = Math.max(0, parseInt(start) || 0);
        end = Math.max(0, parseInt(end) || 0);
        
        // If start equals end, just set the value
        if (start === end) {
            element.textContent = this.formatLargeNumber(end);
            return;
        }
        
        const duration = 600; // Animation duration in milliseconds
        const startTime = performance.now();
        
        const updateNumber = (currentTime) => {
            const elapsedTime = currentTime - startTime;
            const progress = Math.min(elapsedTime / duration, 1);
            
            // Easing function for smooth animation
            const easeOutQuad = progress * (2 - progress);
            
            const currentValue = Math.max(0, Math.floor(start + (end - start) * easeOutQuad));
            
            // Format number for display
            element.textContent = this.formatLargeNumber(currentValue);
            
            if (progress < 1) {
                // Store the animation frame ID to allow cancellation
                element.animationFrame = requestAnimationFrame(updateNumber);
            } else {
                // Ensure we end with the exact formatted target number
                element.textContent = this.formatLargeNumber(end);
                // Clear the animation frame reference
                element.animationFrame = null;
            }
        };
        
        // Store the animation frame ID to allow cancellation
        element.animationFrame = requestAnimationFrame(updateNumber);
    },
    
    formatLargeNumber: function(num) {
        if (num < 1000) {
            return num.toString();
        } else if (num < 10000) {
            return (num / 1000).toFixed(1) + 'K';
        } else if (num < 100000) {
            return (num / 1000).toFixed(1) + 'K';
        } else if (num < 1000000) {
            return Math.floor(num / 1000) + 'K';
        } else if (num < 10000000) {
            return (num / 1000000).toFixed(1) + 'M';
        } else if (num < 100000000) {
            return (num / 1000000).toFixed(1) + 'M';
        } else if (num < 1000000000) {
            return Math.floor(num / 1000000) + 'M';
        } else if (num < 10000000000) {
            return (num / 1000000000).toFixed(1) + 'B';
        } else if (num < 100000000000) {
            return (num / 1000000000).toFixed(1) + 'B';
        } else if (num < 1000000000000) {
            return Math.floor(num / 1000000000) + 'B';
        } else {
            return (num / 1000000000000).toFixed(1) + 'T';
        }
    },

    resetMediaStats: function(appType = null) {
        const confirmMessage = appType 
            ? `Are you sure you want to reset all ${appType.charAt(0).toUpperCase() + appType.slice(1)} statistics? This will clear all tracked hunted and upgraded items.`
            : 'Are you sure you want to reset ALL statistics for ALL apps? This cannot be undone.';
        
        if (!confirm(confirmMessage)) {
            return;
        }
        
        const endpoint = appType ? `./api/stats/reset/${appType}` : './api/stats/reset';
        
        HuntarrUtils.fetchWithTimeout(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    const message = appType 
                        ? `${appType.charAt(0).toUpperCase() + appType.slice(1)} statistics reset successfully`
                        : 'All statistics reset successfully';
                    window.huntarrUI.showNotification(message, 'success');
                }
                // Reload stats to reflect the reset
                this.loadMediaStats();
            } else {
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('Failed to reset statistics', 'error');
                }
            }
        })
        .catch(error => {
            console.error('Error resetting statistics:', error);
            if (window.huntarrUI && window.huntarrUI.showNotification) {
                window.huntarrUI.showNotification('Error resetting statistics', 'error');
            }
        });
    },

    checkAppConnections: function() {
        if (!window.huntarrUI) return;
        
        // Create array of promises to wait for all checks to complete
        const apps = ['sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros'];
        const checkPromises = apps.map(app => this.checkAppConnection(app));
        
        // After all checks complete, update visibility once
        Promise.all(checkPromises)
            .then(() => {
                console.log('[HuntarrStats] All app connections checked, updating visibility');
                window.huntarrUI.configuredAppsInitialized = true;
                this.updateEmptyStateVisibility();
            })
            .catch(error => {
                console.error('[HuntarrStats] Error checking app connections:', error);
                window.huntarrUI.configuredAppsInitialized = true;
                this.updateEmptyStateVisibility();
            });
    },
    
    checkAppConnection: function(app) {
        // Return promise so we can wait for all checks to complete
        return HuntarrUtils.fetchWithTimeout(`./api/status/${app}`)
            .then(response => response.json())
            .then(data => {
                this.updateConnectionStatus(app, data);

                // Calculate configured status properly for *arr apps
                let isConfigured = data.configured === true;
                if (['sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros', 'swaparr'].includes(app)) {
                    isConfigured = (data.total_configured || 0) > 0;
                }

                // Update the configuredApps flag
                if (window.huntarrUI) {
                    window.huntarrUI.configuredApps[app] = isConfigured;
                }
            })
            .catch(error => {
                console.error(`Error checking ${app} connection:`, error);
                this.updateConnectionStatus(app, { configured: false, connected: false });
                if (window.huntarrUI) {
                    window.huntarrUI.configuredApps[app] = false;
                }
            });
    },
    
    updateConnectionStatus: function(app, statusData) {
        if (!window.huntarrUI || !window.huntarrUI.elements) return;
        
        const statusElement = window.huntarrUI.elements[`${app}HomeStatus`];
        if (!statusElement) return;

        let isConfigured = false;
        let isConnected = false;

        isConfigured = statusData?.configured === true;
        isConnected = statusData?.connected === true;

        // Special handling for *arr apps' multi-instance connected count
        let connectedCount = statusData?.connected_count ?? 0;
        let totalConfigured = statusData?.total_configured ?? 0;
        
        // For all *arr apps, 'isConfigured' means at least one instance is configured
        if (['sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros', 'swaparr'].includes(app)) {
            isConfigured = totalConfigured > 0;
            isConnected = isConfigured && connectedCount > 0; 
        }

        // Update individual card visibility
        if (isConfigured) {
            const card = statusElement.closest('.app-stats-card');
            if (card) {
                card.style.display = ''; 
            }
        } else {
            const card = statusElement.closest('.app-stats-card');
            if (card) {
                card.style.display = 'none';
            }
            statusElement.className = 'status-badge not-configured';
            statusElement.innerHTML = '<i class="fas fa-times-circle"></i> Not Configured';
            return;
        }

        // Badge update logic
        if (['sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros', 'swaparr'].includes(app)) {
            statusElement.innerHTML = `<i class="fas fa-plug"></i> Connected ${connectedCount}/${totalConfigured}`;
            statusElement.className = 'status-badge ' + (isConnected ? 'connected' : 'error');
        } else {
            if (isConnected) {
                statusElement.className = 'status-badge connected';
                statusElement.innerHTML = '<i class="fas fa-check-circle"></i> Connected';
            } else {
                statusElement.className = 'status-badge not-connected';
                statusElement.innerHTML = '<i class="fas fa-times-circle"></i> Not Connected';
            }
        }
    },
    
    updateEmptyStateVisibility: function() {
        if (!window.huntarrUI) return;
        
        // Don't update visibility until we've loaded app states at least once
        if (!window.huntarrUI.configuredAppsInitialized) {
            console.log('[HuntarrStats] Skipping empty state update - app states not yet initialized');
            return;
        }
        
        // Check if ANY apps are configured
        const anyConfigured = Object.values(window.huntarrUI.configuredApps).some(val => val === true);
        
        const emptyState = document.getElementById('live-hunts-empty-state');
        const statsGrid = document.querySelector('.app-stats-grid');
        
        console.log(`[HuntarrStats] Updating empty state visibility - any configured: ${anyConfigured}`);
        
        if (anyConfigured) {
            if (emptyState) emptyState.style.display = 'none';
            if (statsGrid) statsGrid.style.display = 'grid';
        } else {
            if (emptyState) emptyState.style.display = 'flex';
            if (statsGrid) statsGrid.style.display = 'none';
        }
    }
};
