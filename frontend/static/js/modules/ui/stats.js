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
        const apps = ['sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros', 'swaparr'];
        const statTypes = ['hunted', 'upgraded'];
        const isLowUsageMode = window.huntarrUI ? window.huntarrUI.isLowUsageModeEnabled() : false;
        
        apps.forEach(app => {
            if (!stats[app]) return;
            const instances = stats[app].instances;
            const card = document.querySelector(`.app-stats-card.${app}`);
            if (!card) return;
            
            const appLabel = app.charAt(0).toUpperCase() + app.slice(1);
            
            if (instances && instances.length > 0) {
                // Per-instance: show one card per instance with instance name
                let wrapper = card.closest('.app-stats-card-wrapper');
                if (!wrapper) {
                    wrapper = document.createElement('div');
                    wrapper.className = 'app-stats-card-wrapper';
                    card.parentNode.insertBefore(wrapper, card);
                    wrapper.appendChild(card);
                }
                // No special grid-column; wrapper uses display: contents from CSS
                wrapper.style.gridColumn = '';
                // Remove extra instance cards (keep first as template)
                while (wrapper.children.length > instances.length) {
                    wrapper.lastChild.remove();
                }
                instances.forEach((inst, idx) => {
                    const hunted = Math.max(0, parseInt(inst.hunted) || 0);
                    const upgraded = Math.max(0, parseInt(inst.upgraded) || 0);
                    const name = inst.instance_name || 'Default';
                    // API usage from stats (pulled from DB per-instance so all instances display correctly)
                    const apiHits = Math.max(0, parseInt(inst.api_hits) || 0);
                    const apiLimit = Math.max(1, parseInt(inst.api_limit) || 20);
                    let targetCard = wrapper.children[idx];
                    if (!targetCard) {
                        targetCard = card.cloneNode(true);
                        targetCard.removeAttribute('id');
                        targetCard.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
                        wrapper.appendChild(targetCard);
                    }
                    targetCard.style.display = '';
                    // Set instance name on the card itself for easier identification
                    targetCard.setAttribute('data-instance-name', name);

                    const apiUrl = (inst.api_url || '').trim();
                    const h4 = targetCard.querySelector('.app-content h4');
                    if (h4) {
                        if (apiUrl) {
                            const link = document.createElement('a');
                            link.href = apiUrl;
                            link.target = '_blank';
                            link.rel = 'noopener noreferrer';
                            link.textContent = `${appLabel} – ${name}`;
                            link.className = 'instance-name-link';
                            link.title = 'Open instance in new tab';
                            h4.textContent = '';
                            h4.appendChild(link);
                        } else {
                            h4.textContent = `${appLabel} – ${name}`;
                        }
                    }
                    // Make app icon clickable to open instance in new tab (only wrap once)
                    const iconWrapper = targetCard.querySelector('.app-content .app-icon-wrapper');
                    if (iconWrapper && apiUrl && !iconWrapper.querySelector('.instance-icon-link')) {
                        const iconLink = document.createElement('a');
                        iconLink.href = apiUrl;
                        iconLink.target = '_blank';
                        iconLink.rel = 'noopener noreferrer';
                        iconLink.className = 'instance-icon-link';
                        iconLink.title = 'Open instance in new tab';
                        while (iconWrapper.firstChild) {
                            iconLink.appendChild(iconWrapper.firstChild);
                        }
                        iconWrapper.appendChild(iconLink);
                    } else if (iconWrapper && iconWrapper.querySelector('.instance-icon-link')) {
                        const iconLink = iconWrapper.querySelector('.instance-icon-link');
                        if (apiUrl) iconLink.href = apiUrl;
                    }
                    const numbers = targetCard.querySelectorAll('.stat-number');
                    if (numbers[0]) {
                        if (isLowUsageMode || isFromCache) numbers[0].textContent = this.formatLargeNumber(hunted);
                        else this.animateNumber(numbers[0], this.parseFormattedNumber(numbers[0].textContent || '0'), hunted);
                    }
                    if (numbers[1]) {
                        if (isLowUsageMode || isFromCache) numbers[1].textContent = this.formatLargeNumber(upgraded);
                        else this.animateNumber(numbers[1], this.parseFormattedNumber(numbers[1].textContent || '0'), upgraded);
                    }
                    const resetBtn = targetCard.querySelector('.cycle-reset-button[data-app]');
                    if (resetBtn) resetBtn.setAttribute('data-instance-name', name);

                    // Set API count/limit from DB (single source of truth for all instance cards)
                    const capSpans = targetCard.querySelectorAll('.hourly-cap-text span');
                    if (capSpans.length >= 2) {
                        capSpans[0].textContent = apiHits;
                        capSpans[1].textContent = apiLimit;
                    }
                    const pct = apiLimit > 0 ? (apiHits / apiLimit) * 100 : 0;
                    const statusEl = targetCard.querySelector('.hourly-cap-status');
                    if (statusEl) {
                        statusEl.classList.remove('good', 'warning', 'danger');
                        if (pct >= 100) statusEl.classList.add('danger');
                        else if (pct >= 75) statusEl.classList.add('warning');
                        else statusEl.classList.add('good');
                    }
                    // Sync progress bar if present
                    const progressFill = targetCard.querySelector('.api-progress-fill');
                    if (progressFill) progressFill.style.width = Math.min(100, pct) + '%';
                    const progressSpans = targetCard.querySelectorAll('.api-progress-text span');
                    if (progressSpans.length >= 2) {
                        progressSpans[0].textContent = apiHits;
                        progressSpans[1].textContent = apiLimit;
                    }
                    // State Management reset: minimal at the bottom, centered (like 1st image)
                    const hoursUntil = inst.state_reset_hours_until;
                    const stateEnabled = inst.state_reset_enabled !== false; // Default to true
                    let resetCountdownEl = targetCard.querySelector('.state-reset-countdown');
                    const resetRow = targetCard.querySelector('.reset-and-timer-container') || targetCard.querySelector('.reset-button-container');
                    const resetContainer = resetRow && resetRow.parentNode ? resetRow.parentNode : resetRow;
                    
                    if (resetContainer) {
                        if (!resetCountdownEl) {
                            resetCountdownEl = document.createElement('div');
                            resetCountdownEl.className = 'state-reset-countdown';
                            resetContainer.appendChild(resetCountdownEl);
                        }
                        
                        if (!stateEnabled) {
                            resetCountdownEl.innerHTML = '<i class="fas fa-hourglass-half"></i> <span class="custom-tooltip">State Management Reset</span> Disabled';
                            resetCountdownEl.style.display = '';
                        } else if (hoursUntil != null && typeof hoursUntil === 'number' && hoursUntil > 0) {
                            const h = Math.floor(hoursUntil);
                            const label = h >= 1 ? `${h}` : '<1';
                            resetCountdownEl.innerHTML = `<i class="fas fa-hourglass-half"></i> <span class="custom-tooltip">State Management Reset</span> ${label}`;
                            resetCountdownEl.style.display = '';
                        } else {
                            // Enabled but no active lock/time yet (e.g. just initialized or nothing hunted)
                            resetCountdownEl.style.display = 'none';
                        }
                    }
                });
                if (typeof window.CycleCountdown !== 'undefined' && window.CycleCountdown.refreshTimerElements) {
                    window.CycleCountdown.refreshTimerElements();
                }
                // Call hourly cap update after a short delay to ensure DOM elements are fully rendered
                setTimeout(() => {
                    if (typeof window.loadHourlyCapData === 'function') {
                        window.loadHourlyCapData();
                    }
                }, 200);
            } else {
                // Single card: app-level stats and app name
                const h4 = card.querySelector('.app-content h4');
                if (h4) h4.textContent = appLabel;
                statTypes.forEach(type => {
                    const element = document.getElementById(`${app}-${type}`);
                    if (element) {
                        const currentText = element.textContent || '0';
                        const currentValue = this.parseFormattedNumber(currentText);
                        const targetValue = Math.max(0, parseInt(stats[app][type]) || 0);
                        if (isLowUsageMode || isFromCache) {
                            element.textContent = this.formatLargeNumber(targetValue);
                        } else {
                            if (currentValue !== targetValue && !isNaN(currentValue) && !isNaN(targetValue)) {
                                if (element.animationFrame) cancelAnimationFrame(element.animationFrame);
                                this.animateNumber(element, currentValue, targetValue);
                            } else if (isNaN(currentValue) || currentValue < 0) {
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

        // Update individual card (and wrapper) visibility
        const card = statusElement.closest('.app-stats-card');
        const wrapper = card ? card.closest('.app-stats-card-wrapper') : null;
        const container = wrapper || card;
        if (isConfigured) {
            if (container) container.style.display = '';
            if (wrapper) {
                wrapper.querySelectorAll('.app-stats-card').forEach(c => { c.style.display = ''; });
            }
        } else {
            if (container) container.style.display = 'none';
            if (card) card.style.display = 'none';
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
