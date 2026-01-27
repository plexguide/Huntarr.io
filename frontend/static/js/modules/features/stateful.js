/**
 * Stateful Management Module
 * Handles stateful tracking, expiration, and reset functionality
 */

window.HuntarrStateful = {
    loadStatefulInfo: function(attempts = 0, skipCache = false) {
        const initialStateEl = document.getElementById('stateful_initial_state');
        const expiresDateEl = document.getElementById('stateful_expires_date');
        const intervalInput = document.getElementById('stateful_management_hours');
        const intervalDaysSpan = document.getElementById('stateful_management_days');
        
        const maxAttempts = 5;
        
        console.log(`[HuntarrStateful] Loading stateful info (attempt ${attempts + 1}, skipCache: ${skipCache})`);
        
        if (attempts === 0) {
            if (initialStateEl && initialStateEl.textContent !== 'Loading...') initialStateEl.textContent = 'Loading...';
            if (expiresDateEl && expiresDateEl.textContent !== 'Updating...') expiresDateEl.textContent = 'Loading...';
        }
        
        const cachedStatefulData = localStorage.getItem('huntarr-stateful-data');
        if (!skipCache && cachedStatefulData && attempts === 0) {
            try {
                const parsedData = JSON.parse(cachedStatefulData);
                const cacheAge = Date.now() - parsedData.timestamp;
                
                if (cacheAge < 300000) {
                    console.log('[HuntarrStateful] Using cached data while fetching fresh data');
                    
                    if (initialStateEl && parsedData.created_at_ts) {
                        const createdDate = new Date(parsedData.created_at_ts * 1000);
                        initialStateEl.textContent = this.formatDateNicely(createdDate);
                    }
                    
                    if (expiresDateEl && parsedData.expires_at_ts) {
                        const expiresDate = new Date(parsedData.expires_at_ts * 1000);
                        expiresDateEl.textContent = this.formatDateNicely(expiresDate);
                    }
                    
                    if (intervalInput && parsedData.interval_hours) {
                        intervalInput.value = parsedData.interval_hours;
                        if (intervalDaysSpan) {
                            const days = (parsedData.interval_hours / 24).toFixed(1);
                            intervalDaysSpan.textContent = `${days} days`;
                        }
                    }
                }
            } catch (e) {
                console.warn('[HuntarrStateful] Failed to parse cached stateful data:', e);
            }
        }

        HuntarrUtils.fetchWithTimeout('./api/stateful/info')
            .then(response => {
                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                return response.json();
            })
            .then(data => {
                console.log('[HuntarrStateful] Received stateful info:', data);
                
                if (data.created_at_ts) {
                    const createdDate = new Date(data.created_at_ts * 1000);
                    if (initialStateEl) initialStateEl.textContent = this.formatDateNicely(createdDate);
                }
                
                if (data.expires_at_ts) {
                    const expiresDate = new Date(data.expires_at_ts * 1000);
                    if (expiresDateEl) expiresDateEl.textContent = this.formatDateNicely(expiresDate);
                }
                
                if (intervalInput && data.interval_hours) {
                    intervalInput.value = data.interval_hours;
                    if (intervalDaysSpan) {
                        const days = (data.interval_hours / 24).toFixed(1);
                        intervalDaysSpan.textContent = `${days} days`;
                    }
                }
                
                localStorage.setItem('huntarr-stateful-data', JSON.stringify({
                    ...data,
                    timestamp: Date.now()
                }));
            })
            .catch(error => {
                console.error('[HuntarrStateful] Error loading stateful info:', error);
                if (attempts < maxAttempts) {
                    const delay = Math.pow(2, attempts) * 1000;
                    setTimeout(() => this.loadStatefulInfo(attempts + 1, skipCache), delay);
                } else {
                    if (initialStateEl) initialStateEl.textContent = 'Not available';
                    if (expiresDateEl) expiresDateEl.textContent = 'Not available';
                }
            });
    },

    formatDateNicely: function(date) {
        if (!(date instanceof Date) || isNaN(date)) return 'Invalid date';
        
        const userTimezone = window.HuntarrHelpers ? window.HuntarrHelpers.getUserTimezone() : 'UTC';
        
        const options = { 
            weekday: 'short',
            year: 'numeric', 
            month: 'short', 
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
            timeZone: userTimezone
        };
        
        let formattedDate;
        try {
            formattedDate = date.toLocaleDateString(undefined, options);
        } catch (error) {
            const fallbackOptions = { ...options, timeZone: 'UTC' };
            formattedDate = date.toLocaleDateString(undefined, fallbackOptions) + ' (UTC)';
        }
        
        const now = new Date();
        const diffTime = date.getTime() - now.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        let relativeTime = '';
        if (diffDays > 0) relativeTime = ` (in ${diffDays} day${diffDays !== 1 ? 's' : ''})`;
        else if (diffDays < 0) relativeTime = ` (${Math.abs(diffDays)} day${Math.abs(diffDays) !== 1 ? 's' : ''} ago)`;
        else relativeTime = ' (today)';
        
        return `${formattedDate}${relativeTime}`;
    },

    resetStatefulManagement: function() {
        const resetBtn = document.getElementById('reset_stateful_btn');
        if (resetBtn) {
            resetBtn.disabled = true;
            resetBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Resetting...';
        }
        
        HuntarrUtils.fetchWithTimeout('./api/stateful/reset', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            cache: 'no-cache'
        })
        .then(response => {
            if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
            return response.json();
        })
        .then(data => {
            if (data.success) {
                if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification('Stateful management reset successfully', 'success');
                setTimeout(() => {
                    this.loadStatefulInfo(0, true);
                    if (resetBtn) {
                        resetBtn.disabled = false;
                        resetBtn.innerHTML = '<i class="fas fa-trash"></i> Reset';
                    }
                }, 1000);
            } else {
                throw new Error(data.message || 'Unknown error resetting stateful management');
            }
        })
        .catch(error => {
             console.error("Error resetting stateful management:", error);
             if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification(`Error: ${error.message}`, 'error');
             if (resetBtn) {
                 resetBtn.disabled = false;
                 resetBtn.innerHTML = '<i class="fas fa-trash"></i> Reset';
             }
        });
    },

    updateStatefulExpirationOnUI: function() {
        const hoursInput = document.getElementById('stateful_management_hours');
        if (!hoursInput) return;
        
        const hours = parseInt(hoursInput.value) || 168;
        const expiresDateEl = document.getElementById('stateful_expires_date');
        
        if (expiresDateEl) expiresDateEl.textContent = 'Updating...';
        
        HuntarrUtils.fetchWithTimeout('./api/stateful/update-expiration', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hours: hours }),
            cache: 'no-cache'
        })
        .then(response => {
            if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
            return response.json();
        })
        .then(data => {
            if (data.success) {
                this.loadStatefulInfo(0, true);
                if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification(`Updated expiration to ${hours} hours`, 'success');
            } else {
                throw new Error(data.message || 'Unknown error updating expiration');
            }
        })
        .catch(error => {
             console.error('Error updating stateful expiration:', error);
             if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification(`Error: ${error.message}`, 'error');
             if (expiresDateEl) expiresDateEl.textContent = 'Error updating';
             setTimeout(() => this.loadStatefulInfo(), 1000);
        });
    },

    updateStatefulExpiration: function(hours) {
        if (!hours || typeof hours !== 'number' || hours <= 0) return;
        
        HuntarrUtils.fetchWithTimeout('./api/stateful/update-expiration', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hours: hours })
        })
        .then(response => {
            if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
            return response.json();
        })
        .then(data => {
            const expiresDateEl = document.getElementById('stateful_expires_date');
            if (expiresDateEl && data.expires_date) {
                expiresDateEl.textContent = data.expires_date;
            }
        })
        .catch(error => {
            console.error('[HuntarrStateful] Error updating stateful expiration:', error);
        });
    },

    loadInstanceStateInfo: function(appType, instanceIndex) {
        const supportedApps = ['sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros'];
        if (!supportedApps.includes(appType)) return;
        
        let instanceName = null;
        const instanceNameElement = document.getElementById(`${appType}-name-${instanceIndex}`);
        if (instanceNameElement && instanceNameElement.value && instanceNameElement.value.trim()) {
            instanceName = instanceNameElement.value.trim();
        }
        
        if (!instanceName) {
            const instanceHeader = document.querySelector(`#${appType}-instance-${instanceIndex} h3, #${appType}-instance-${instanceIndex} .instance-title`);
            if (instanceHeader && instanceHeader.textContent) {
                const match = instanceHeader.textContent.trim().match(/Instance \d+:\s*(.+)$/);
                if (match && match[1]) instanceName = match[1].trim();
            }
        }
        
        if (!instanceName) instanceName = instanceIndex === 0 ? 'Default' : `Instance ${instanceIndex + 1}`;
        
        const hoursInput = document.getElementById(`${appType}-state-management-hours-${instanceIndex}`);
        const customHours = parseInt(hoursInput?.value) || 168;
        
        HuntarrUtils.fetchWithTimeout(`./api/stateful/summary?app_type=${appType}&instance_name=${encodeURIComponent(instanceName)}`, {
            method: 'GET'
        })
        .then(response => response.json())
        .then(summaryData => {
            this.updateInstanceStateDisplay(appType, instanceIndex, summaryData, instanceName, customHours);
        })
        .catch(error => {
            console.error(`[HuntarrStateful] Error loading state info for ${appType}/${instanceName}:`, error);
            this.updateInstanceStateDisplay(appType, instanceIndex, null, instanceName, customHours);
        });
    },

    updateInstanceStateDisplay: function(appType, instanceIndex, summaryData, instanceName, customHours) {
        const resetTimeElement = document.getElementById(`${appType}-state-reset-time-${instanceIndex}`);
        const itemsCountElement = document.getElementById(`${appType}-state-items-count-${instanceIndex}`);
        
        if (resetTimeElement) {
            resetTimeElement.textContent = summaryData?.next_reset_time || 'Error loading time';
        }
        
        if (itemsCountElement) {
            itemsCountElement.textContent = (summaryData?.processed_count || 0).toString();
        }
    },

    refreshStateManagementTimezone: function() {
        this.reloadStateManagementDisplays();
    },

    reloadStateManagementDisplays: function() {
        const supportedApps = ['sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros'];
        supportedApps.forEach(appType => {
            const appPanel = document.getElementById(`${appType}-panel`);
            if (appPanel && appPanel.style.display !== 'none') {
                const stateElements = appPanel.querySelectorAll(`[id*="${appType}-state-reset-time-"]`);
                stateElements.forEach(element => {
                    const match = element.id.match(/(\w+)-state-reset-time-(\d+)/);
                    if (match) {
                        const instanceIndex = parseInt(match[2]);
                        const instanceNameElement = document.querySelector(`#${appType}-instance-name-${instanceIndex}`);
                        if (instanceNameElement) {
                            this.loadStateManagementForInstance(appType, instanceIndex, instanceNameElement.value || 'Default');
                        }
                    }
                });
            }
        });
    },

    loadStateManagementForInstance: function(appType, instanceIndex, instanceName) {
        const url = `./api/stateful/summary?app_type=${encodeURIComponent(appType)}&instance_name=${encodeURIComponent(instanceName)}`;
        HuntarrUtils.fetchWithTimeout(url, { method: 'GET' })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                this.updateInstanceStateDisplay(appType, instanceIndex, data, instanceName, data.expiration_hours);
            }
        })
        .catch(error => {
            console.error(`[HuntarrStateful] Error loading state management data:`, error);
        });
    },

    refreshTimeDisplays: function() {
        console.log('[HuntarrStateful] Refreshing all time displays');
        
        if (window.LogsModule) {
            window.LogsModule.userTimezone = null;
            window.LogsModule.loadUserTimezone();
            if (window.LogsModule.currentLogApp) {
                window.LogsModule.loadLogsFromAPI(window.LogsModule.currentLogApp);
            }
        }
        
        if (window.CycleCountdown) {
            window.CycleCountdown.refreshAllData();
        }
        
        if (window.huntarrUI && (window.huntarrUI.currentSection === 'scheduling' || window.huntarrUI.currentSection === 'schedules')) {
            if (typeof loadServerTimezone === 'function') loadServerTimezone();
        }
        
        if (window.huntarrUI && window.huntarrUI.currentSection === 'hunt-manager' && window.huntManagerModule) {
            if (typeof window.huntManagerModule.refresh === 'function') window.huntManagerModule.refresh();
        }
        
        this.reloadStateManagementDisplays();
    }
};
