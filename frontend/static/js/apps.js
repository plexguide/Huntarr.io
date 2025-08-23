/**
 * Huntarr - Apps Module
 * Handles displaying and managing app settings for media server applications
 */

const appsModule = {
    // State
    currentApp: null,
    isLoading: false,
    settingsChanged: false, // Legacy flag (auto-save enabled)
    originalSettings: {}, // Store original settings to compare
    
    // DOM elements
    elements: {},
    
    // Initialize the apps module for a specific app
    init: function(appType) {
        // Initialize state
        this.currentApp = appType || null;
        this.settingsChanged = false; // Legacy flag (auto-save enabled)
        this.originalSettings = {}; // Store original settings to compare
        
        // Set a global flag to indicate we've loaded
        window._appsModuleLoaded = true;
        
        // Add global variable to track if we're in the middle of saving
        window._appsCurrentlySaving = false;
        
        // Add global variable to disable change detection temporarily
        window._appsSuppressChangeDetection = false;
        
        // Cache DOM elements
        this.cacheElements();
        
        // Set up event listeners
        this.setupEventListeners();
        
        // Initialize state
        this.settingsChanged = false;
        
        // Load the specific app if provided
        if (appType) {
            this.loadAppSettings(appType);
        }
        
        // Auto-save enabled - no unsaved changes detection needed
    },
    
    // Auto-save enabled - unsaved changes handlers removed
    
    // Cache DOM elements
    cacheElements: function() {
        this.elements = {
            // Apps panels - now individual sections
            appAppsPanels: document.querySelectorAll('.app-apps-panel'),
            
            // Individual app sections
            sonarrSection: document.getElementById('sonarrSection'),
            radarrSection: document.getElementById('radarrSection'),
            lidarrSection: document.getElementById('lidarrSection'),
            readarrSection: document.getElementById('readarrSection'),
            whisparrSection: document.getElementById('whisparrSection'),
            erosSection: document.getElementById('erosSection'),
            
            // Controls - auto-save enabled, no save button needed
        };
    },
    
    // Set up event listeners
    setupEventListeners: function() {
        // No dropdown needed anymore - apps have individual sections
        // Auto-save enabled - no save button needed
    },
    
    // Load specific app settings
    loadApp: function(appType) {
        this.currentApp = appType;
        this.loadAppSettings(appType);
    },
    
    // Load app settings
    loadAppSettings: function(app) {
        console.log(`[Apps] Loading settings for ${app}`);
        
        // Get the container to put the settings in - now using individual app sections
        const appPanel = document.getElementById(app + 'Apps');
        if (!appPanel) {
            console.error(`App panel not found for ${app}`);
            return;
        }
        
        // Clear existing content
        appPanel.innerHTML = '<div class="loading-panel"><i class="fas fa-spinner fa-spin"></i> Loading settings...</div>';
        
        // Fetch settings for this app
        HuntarrUtils.fetchWithTimeout(`./api/settings/${app}`)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.json();
            })
            .then(appSettings => {
                console.log(`[Apps] Received settings for ${app}:`, appSettings);
                
                // Clear loading message
                appPanel.innerHTML = '';
                
                // Create a form container with the app-type attribute
                const formElement = document.createElement('form');
                formElement.classList.add('settings-form');
                formElement.setAttribute('data-app-type', app);
                appPanel.appendChild(formElement);
                
                // Generate the form using SettingsForms module
                if (typeof SettingsForms !== 'undefined') {
                    const formFunction = SettingsForms[`generate${app.charAt(0).toUpperCase()}${app.slice(1)}Form`];
                    if (typeof formFunction === 'function') {
                        // Use .call() to set the 'this' context correctly
                        formFunction.call(SettingsForms, formElement, appSettings);
                        
                        // Update duration displays for this app
                        if (typeof SettingsForms.updateDurationDisplay === 'function') {
                            SettingsForms.updateDurationDisplay();
                        }
                        
                        // Explicitly ensure connection status checking is set up for all supported apps
                        const supportedApps = ['radarr', 'sonarr', 'lidarr', 'readarr', 'whisparr', 'eros'];
                        if (supportedApps.includes(app) && typeof SettingsForms.setupInstanceManagement === 'function') {
                            // Find the instances container and set up connection status checking
                            const instancesContainer = formElement.querySelector('.instances-container');
                            if (instancesContainer) {
                                const instanceCount = appSettings.instances ? appSettings.instances.length : 0;
                                console.log(`[Apps] Setting up connection status checking for ${app} with ${instanceCount} instances`);
                                SettingsForms.setupInstanceManagement(instancesContainer.parentElement, app, instanceCount);
                            } else {
                                console.warn(`[Apps] No instances container found for ${app}, connection status checking may not work`);
                            }
                        } else {
                            console.log(`[Apps] Skipping connection status setup for ${app} (supported: ${supportedApps.includes(app)}, function available: ${typeof SettingsForms.setupInstanceManagement})`);
                        }
                        
                        // Store original form values after form is generated
                        // Add a small delay to ensure all form elements are fully populated
                        setTimeout(() => {
                            this.storeOriginalFormValues(appPanel);
                            console.log(`[Apps] Original values stored for ${app} after form generation`);
                            console.log(`[Apps] Stored ${Object.keys(this.originalSettings).length} original values for ${app}`);
                        }, 50);
                        
                        // Add change listener to detect modifications
                        this.addFormChangeListeners(formElement);
                    } else {
                        console.warn(`Form generation function not found for ${app}`);
                        appPanel.innerHTML = `<div class="settings-message">Settings for ${app.charAt(0).toUpperCase() + app.slice(1)} are not available.</div>`;
                    }
                } else {
                    console.error('SettingsForms module not found');
                    appPanel.innerHTML = '<div class="error-panel">Unable to generate settings form. Please reload the page.</div>';
                }
            })
            .catch(error => {
                console.error(`Error loading ${app} settings:`, error);
                appPanel.innerHTML = `<div class="error-panel"><i class="fas fa-exclamation-triangle"></i> Error loading settings: ${error.message}</div>`;
            });
    },
    
    // Add change listeners to form elements (auto-save removed - now using manual save)
    addFormChangeListeners: function(form) {
        if (!form) return;
        
        const appType = form.getAttribute('data-app-type');
        console.log(`[Apps] Skipping auto-save listeners for ${appType} - now using manual save`);
        
        // Auto-save has been removed - apps now use manual save buttons
        // No longer adding change listeners or mutation observers for auto-save functionality
    },
    
    // Auto-save settings silently in background
    autoSaveSettings: function(appType, form) {
        console.log(`[Apps] Auto-saving settings for ${appType}`);
        
        // Get the app panel
        const appPanel = form.closest('.app-apps-panel') || document.getElementById(`${appType}Apps`);
        if (!appPanel) {
            console.error(`[Apps] Could not find app panel for ${appType}`);
            return;
        }
        
        let settings;
        try {
            // Get settings from the form
            settings = SettingsForms.getFormSettings(appPanel, appType);
            console.log(`[Apps] Collected settings for auto-save (${appType}):`, settings);
        } catch (error) {
            console.error(`[Apps] Error collecting settings for auto-save (${appType}):`, error);
            return;
        }
        
        // Send settings to the server silently
        HuntarrUtils.fetchWithTimeout(`./api/settings/${appType}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(settings)
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
            }
            return response.json();
        })
        .then(data => {
            console.log(`[Apps] ${appType} settings auto-saved successfully:`, data);
        })
        .catch(error => {
            console.error(`[Apps] Error auto-saving ${appType} settings:`, error);
            // Only show error notifications for failed saves, not success
            if (typeof huntarrUI !== 'undefined' && typeof huntarrUI.showNotification === 'function') {
                huntarrUI.showNotification(`Error auto-saving ${appType} settings`, 'error');
            }
        });
    },

    
    // Check if the form has actual changes compared to original values
    hasFormChanges: function(form) {
        if (!form) {
            console.log('[Apps] hasFormChanges: No form found');
            return false;
        }
        
        if (!this.originalSettings || Object.keys(this.originalSettings).length === 0) {
            console.log('[Apps] hasFormChanges: No original settings found, checking if form has any values');
            // If we don't have original settings yet, check if the form has any non-default values
            // This handles the case where user makes changes before original values are stored
            const formElements = form.querySelectorAll('input, select, textarea');
            let hasNonDefaultValues = false;
            formElements.forEach(element => {
                if (element.type === 'button' || element.type === 'submit' || !element.id) return;
                const currentValue = element.type === 'checkbox' ? element.checked : element.value;
                // If there's any meaningful value, consider it a change
                if (currentValue && currentValue !== '' && currentValue !== false) {
                    hasNonDefaultValues = true;
                }
            });
            console.log(`[Apps] Form has non-default values: ${hasNonDefaultValues}`);
            return hasNonDefaultValues;
        }
        
        let hasChanges = false;
        const formElements = form.querySelectorAll('input, select, textarea');
        
        console.log(`[Apps] Checking ${formElements.length} form elements for changes`);
        console.log(`[Apps] Original settings keys:`, Object.keys(this.originalSettings));
        
        formElements.forEach(element => {
            // Skip buttons and elements without IDs
            if (element.type === 'button' || element.type === 'submit' || !element.id) return;
            
            const originalValue = this.originalSettings[element.id];
            const currentValue = element.type === 'checkbox' ? element.checked : element.value;
            
            // Only compare if we have an original value stored for this element
            if (originalValue !== undefined) {
                // Direct comparison for checkboxes (both should be boolean)
                // String comparison for everything else
                let valuesMatch;
                if (element.type === 'checkbox') {
                    valuesMatch = originalValue === currentValue;
                } else {
                    valuesMatch = String(originalValue) === String(currentValue);
                }
                
                if (!valuesMatch) {
                    console.log(`[Apps] Element changed: ${element.id}, Original: ${originalValue} (${typeof originalValue}), Current: ${currentValue} (${typeof currentValue})`);
                    hasChanges = true;
                }
            } else {
                // If we don't have an original value for this element, check if it has a meaningful current value
                if (element.type === 'checkbox' && currentValue === true) {
                    console.log(`[Apps] Checkbox ${element.id} is checked but no original value stored - considering as change`);
                    hasChanges = true;
                } else if (element.type !== 'checkbox' && currentValue && currentValue.trim() !== '') {
                    console.log(`[Apps] Element ${element.id} has value '${currentValue}' but no original value stored - considering as change`);
                    hasChanges = true;
                }
            }
        });
        
        console.log(`[Apps] hasFormChanges result: ${hasChanges}`);
        return hasChanges;
    },
    
    // Show specific app panel and hide others
    showAppPanel: function(app) {
        console.log(`Showing app panel for ${app}`);
        // Hide all app panels
        this.elements.appAppsPanels.forEach(panel => {
            panel.style.display = 'none';
            panel.classList.remove('active');
        });
        
        // Show the selected app panel
        const appPanel = document.getElementById(`${app}Apps`);
        if (appPanel) {
            appPanel.style.display = 'block';
            appPanel.classList.add('active');
            
            // Ensure the panel has the correct data-app-type attribute
            appPanel.setAttribute('data-app-type', app);
            
            console.log(`App panel for ${app} is now active`);
        } else {
            console.error(`App panel for ${app} not found`);
        }
    },
    
    // Handle app selection changes
    handleAppsAppChange: function(selectedApp) {
        // If called with an event, extract the value
        if (selectedApp && selectedApp.target && typeof selectedApp.target.value === 'string') {
            selectedApp = selectedApp.target.value;
        }
        if (!selectedApp || selectedApp === this.currentApp) return;
        

        
        // Auto-save enabled - no navigation checks needed
        // Update the select value
        const appsAppSelect = document.getElementById('appsAppSelect');
        if (appsAppSelect) appsAppSelect.value = selectedApp;
        // Show the selected app's panel
        this.showAppPanel(selectedApp);
        this.currentApp = selectedApp;
        // Load the newly selected app's settings
        this.loadAppSettings(selectedApp);
        // Reset changed state (auto-save enabled)
        this.settingsChanged = false;
    },
    
    // Save apps settings - completely rewritten for reliability
    saveApps: function(event) {
        if (event) event.preventDefault();
        
        console.log('[Apps] Save button clicked');
        
        // Set a flag that we're in the middle of saving
        window._appsCurrentlySaving = true;
        
        // Get the current app from module state
        const appType = this.currentApp;
        if (!appType) {
            console.error('No current app selected');
            
            // Emergency fallback - try to find the visible app panel
            const visiblePanel = document.querySelector('.app-apps-panel[style*="display: block"]');
            if (visiblePanel && visiblePanel.id) {
                // Extract app type from panel ID (e.g., "sonarrApps" -> "sonarr")
                const extractedType = visiblePanel.id.replace('Apps', '');
                console.log(`Fallback: Found visible panel with ID ${visiblePanel.id}, extracted app type: ${extractedType}`);
                
                if (extractedType) {
                    // Continue with the extracted app type
                    return this.saveAppSettings(extractedType, visiblePanel);
                }
            }
            
            if (typeof huntarrUI !== 'undefined' && typeof huntarrUI.showNotification === 'function') {
                huntarrUI.showNotification('Error: Could not determine which app settings to save', 'error');
            } else {
                alert('Error: Could not determine which app settings to save');
            }
            return;
        }
        
        // Direct DOM access to find the app panel
        const appPanel = document.getElementById(`${appType}Apps`);
        if (!appPanel) {
            console.error(`App panel not found for ${appType}`);
            if (typeof huntarrUI !== 'undefined' && typeof huntarrUI.showNotification === 'function') {
                huntarrUI.showNotification(`Error: App panel not found for ${appType}`, 'error');
            } else {
                alert(`Error: App panel not found for ${appType}`);
            }
            return;
        }
        
        // Proceed with saving for the found app panel
        this.saveAppSettings(appType, appPanel);
    },
    
    // Helper function to save settings for a specific app
    saveAppSettings: function(appType, appPanel) {
        console.log(`Saving settings for ${appType}`);
        
        // For Whisparr, ensure we indicate we're working with V2
        let apiVersion = "";
        if (appType === "whisparr") {
            console.log("Saving Whisparr V2 settings");
            apiVersion = "V2";
        } else if (appType === "eros") {
            console.log("Saving Eros (Whisparr V3) settings");
        }
        
        let settings;
        try {
            // Make sure the app type is set on the panel for SettingsForms
            appPanel.setAttribute('data-app-type', appType);
            
            // Get settings from the form
            settings = SettingsForms.getFormSettings(appPanel, appType);
            console.log(`Collected settings for ${appType}:`, settings);
        } catch (error) {
            console.error(`Error collecting settings for ${appType}:`, error);
            if (typeof huntarrUI !== 'undefined' && typeof huntarrUI.showNotification === 'function') {
                huntarrUI.showNotification(`Error collecting settings: ${error.message}`, 'error');
            } else {
                alert(`Error collecting settings: ${error.message}`);
            }
            return;
        }
        
        // Add specific logging for settings critical to stateful management
        if (appType === 'general') {
            console.log('Stateful management settings being saved:', {
                statefulExpirationHours: settings.statefulExpirationHours,
                api_timeout: settings.api_timeout,
                command_wait_delay: settings.command_wait_delay,
                command_wait_attempts: settings.command_wait_attempts
            });
        }
        
        // Send settings to the server
        console.log(`Sending ${appType} settings to server...`);
        
        // Debug: Log the settings being sent, especially for general
        if (appType === 'general') {
            console.log('General settings being sent:', settings);
            console.log('Apprise URLs being sent:', settings.apprise_urls);
        }
        
        HuntarrUtils.fetchWithTimeout(`./api/settings/${appType}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(settings)
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
            }
            return response.json();
        })
        .then(data => {
            console.log(`${appType} settings saved successfully:`, data);
            
            // Temporarily suppress change detection
            window._appsSuppressChangeDetection = true;
            
            // Store the current form values as the new "original" values
            this.storeOriginalFormValues(appPanel);
            
            // Auto-save completed - reset state
            this.settingsChanged = false;
            
            // Reset the saving flag
            window._appsCurrentlySaving = false;
            
            // Ensure form elements are properly updated to reflect saved state
            this.markFormAsUnchanged(appPanel);
            
            // After a short delay, re-enable change detection
            setTimeout(() => {
                window._appsSuppressChangeDetection = false;
            }, 1000);
            
            // Settings auto-save notification removed per user request
        })
        .catch(error => {
            console.error(`Error saving ${appType} settings:`, error);
            if (typeof huntarrUI !== 'undefined' && typeof huntarrUI.showNotification === 'function') {
                huntarrUI.showNotification(`Error saving settings: ${error.message}`, 'error');
            } else {
                alert(`Error saving settings: ${error.message}`);
            }
            // Reset the saving flag
            window._appsCurrentlySaving = false;
        });
    },
    
    // Store the current form values as the new "original" values
    storeOriginalFormValues: function(appPanel) {
        const form = appPanel.querySelector('form');
        if (!form) return;
        
        const originalValues = {};
        const formElements = form.querySelectorAll('input, select, textarea');
        formElements.forEach(element => {
            // Store the appropriate value based on element type
            if (element.type === 'checkbox') {
                originalValues[element.id] = element.checked;
            } else {
                originalValues[element.id] = element.value;
            }
        });
        
        this.originalSettings = originalValues;
        console.log('Original form values stored:', this.originalSettings);
    },
    
    // Mark form as unchanged
    markFormAsUnchanged: function(appPanel) {
        const form = appPanel.querySelector('form');
        if (!form) return;
        
        // First, remove the 'changed' class from all form elements
        const formElements = form.querySelectorAll('input, select, textarea');
        formElements.forEach(element => {
            element.classList.remove('changed');
        });
        
        // Get the app type to properly handle app-specific flags
        const appType = appPanel.getAttribute('data-app-type') || '';
        console.log(`Marking form as unchanged for app type: ${appType}`);
        
        // Clear app-specific change flags
        if (window._hasAppChanges && typeof window._hasAppChanges === 'object') {
            window._hasAppChanges[appType] = false;
        }
        
        // Ensure we reset all change tracking for this app
        try {
            // Reset any form change flags
            if (form.dataset) {
                form.dataset.hasChanges = 'false';
            }
            
            // Clear any app-specific data attributes that might be tracking changes
            appPanel.querySelectorAll('[data-changed="true"]').forEach(el => {
                el.setAttribute('data-changed', 'false');
            });
            
            // Auto-save enabled - no change tracking needed
            
            // Explicitly handle Readarr, Lidarr, and Whisparr which seem to have issues
            if (appType === 'readarr' || appType === 'lidarr' || appType === 'whisparr' || appType === 'whisparrv2') {
                console.log(`Special handling for ${appType} to ensure changes are cleared`);
                // Force additional global state updates
                if (window.huntarrUI && window.huntarrUI.formChanged) {
                    window.huntarrUI.formChanged[appType] = false;
                }
                // Auto-save enabled - no global state tracking needed
                // Force immediate re-evaluation of the form state
                setTimeout(() => {
                    this.hasFormChanges(form);
                }, 10);
            }
        } catch (error) {
            console.error(`Error in markFormAsUnchanged for ${appType}:`, error);
        }
    }
};

// Apps Dashboard functionality
const appsDashboard = {
    statusCheckInterval: null,
    activityRefreshInterval: null,
    
    // Initialize the dashboard
    init: function() {
        console.log('[Apps Dashboard] Initializing...');
        this.checkAllAppStatus();
        this.loadRecentActivity();
        this.loadConfigurationSummary();
        this.startAutoRefresh();
    },
    
    // Check status of all apps
    checkAllAppStatus: function() {
        const apps = ['sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros', 'prowlarr'];
        
        apps.forEach(app => {
            this.checkAppStatus(app);
        });
    },
    
    // Check status of a specific app
    checkAppStatus: function(app) {
        const statusElement = document.getElementById(`${app}Status`);
        const instancesElement = document.getElementById(`${app}Instances`);
        
        if (!statusElement) return;
        
        // Set checking status
        statusElement.textContent = 'Checking...';
        statusElement.className = 'status-badge checking';
        
        // Fetch app settings to check configuration and instances
        HuntarrUtils.fetchWithTimeout(`./api/settings/${app}`)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                return response.json();
            })
            .then(settings => {
                let instanceCount = 0;
                let onlineCount = 0;
                
                if (settings.instances && Array.isArray(settings.instances)) {
                    instanceCount = settings.instances.length;
                    
                    // Check each instance status
                    const statusPromises = settings.instances.map(instance => {
                        return this.checkInstanceConnection(app, instance)
                            .then(isOnline => {
                                if (isOnline) onlineCount++;
                                return isOnline;
                            })
                            .catch(() => false);
                    });
                    
                    Promise.all(statusPromises).then(() => {
                        this.updateAppStatus(app, instanceCount, onlineCount);
                    });
                } else {
                    this.updateAppStatus(app, 0, 0);
                }
            })
            .catch(error => {
                console.error(`Error checking ${app} status:`, error);
                statusElement.textContent = 'Error';
                statusElement.className = 'status-badge offline';
                if (instancesElement) {
                    instancesElement.textContent = 'Not configured';
                }
            });
    },
    
    // Check if a specific instance is online
    checkInstanceConnection: function(app, instance) {
        if (!instance.url || !instance.api_key) {
            return Promise.resolve(false);
        }
        
        const testUrl = `${instance.url}/api/v3/system/status`;
        
        return fetch(testUrl, {
            method: 'GET',
            headers: {
                'X-Api-Key': instance.api_key,
                'Content-Type': 'application/json'
            },
            timeout: 5000
        })
        .then(response => response.ok)
        .catch(() => false);
    },
    
    // Update app status display
    updateAppStatus: function(app, totalInstances, onlineInstances) {
        const statusElement = document.getElementById(`${app}Status`);
        const instancesElement = document.getElementById(`${app}Instances`);
        
        if (!statusElement) return;
        
        if (totalInstances === 0) {
            statusElement.textContent = 'Not configured';
            statusElement.className = 'status-badge offline';
            if (instancesElement) {
                instancesElement.textContent = 'No instances';
            }
        } else if (onlineInstances === totalInstances) {
            statusElement.textContent = 'Online';
            statusElement.className = 'status-badge online';
            if (instancesElement) {
                instancesElement.textContent = `${totalInstances} instance${totalInstances > 1 ? 's' : ''}`;
            }
        } else if (onlineInstances > 0) {
            statusElement.textContent = 'Partial';
            statusElement.className = 'status-badge checking';
            if (instancesElement) {
                instancesElement.textContent = `${onlineInstances}/${totalInstances} online`;
            }
        } else {
            statusElement.textContent = 'Offline';
            statusElement.className = 'status-badge offline';
            if (instancesElement) {
                instancesElement.textContent = `${totalInstances} instance${totalInstances > 1 ? 's' : ''} offline`;
            }
        }
    },
    
    // Load recent activity
    loadRecentActivity: function() {
        const activityList = document.getElementById('recentActivity');
        if (!activityList) return;
        
        // Simulate loading recent activity (replace with actual API call)
        setTimeout(() => {
            const activities = [
                { icon: 'fas fa-download', text: 'Sonarr: Downloaded "The Office S09E23"', time: '2 minutes ago', type: 'success' },
                { icon: 'fas fa-search', text: 'Radarr: Searching for "Inception (2010)"', time: '5 minutes ago', type: 'info' },
                { icon: 'fas fa-music', text: 'Lidarr: Added "Pink Floyd - Dark Side of the Moon"', time: '12 minutes ago', type: 'success' },
                { icon: 'fas fa-exclamation-triangle', text: 'Prowlarr: Indexer "TorrentLeech" failed health check', time: '18 minutes ago', type: 'warning' },
                { icon: 'fas fa-book', text: 'Readarr: Imported "Dune by Frank Herbert"', time: '25 minutes ago', type: 'success' }
            ];
            
            activityList.innerHTML = activities.map(activity => `
                <div class="activity-item ${activity.type}">
                    <i class="${activity.icon} activity-icon"></i>
                    <div class="activity-content">
                        <span class="activity-text">${activity.text}</span>
                        <span class="activity-time">${activity.time}</span>
                    </div>
                </div>
            `).join('');
        }, 1000);
    },
    
    // Load configuration summary
    loadConfigurationSummary: function() {
        const configuredAppsElement = document.getElementById('configuredAppsCount');
        const totalInstancesElement = document.getElementById('totalInstancesCount');
        const activeConnectionsElement = document.getElementById('activeConnectionsCount');
        
        if (!configuredAppsElement) return;
        
        const apps = ['sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros', 'prowlarr'];
        let configuredApps = 0;
        let totalInstances = 0;
        let activeConnections = 0;
        
        const promises = apps.map(app => {
            return HuntarrUtils.fetchWithTimeout(`./api/settings/${app}`)
                .then(response => response.json())
                .then(settings => {
                    if (settings.instances && settings.instances.length > 0) {
                        configuredApps++;
                        totalInstances += settings.instances.length;
                        
                        // Count active connections (simplified)
                        settings.instances.forEach(instance => {
                            if (instance.url && instance.api_key) {
                                activeConnections++;
                            }
                        });
                    }
                })
                .catch(() => {});
        });
        
        Promise.all(promises).then(() => {
            if (configuredAppsElement) configuredAppsElement.textContent = configuredApps;
            if (totalInstancesElement) totalInstancesElement.textContent = totalInstances;
            if (activeConnectionsElement) activeConnectionsElement.textContent = activeConnections;
        });
    },
    
    // Start auto-refresh intervals
    startAutoRefresh: function() {
        // Refresh status every 30 seconds
        this.statusCheckInterval = setInterval(() => {
            this.checkAllAppStatus();
        }, 30000);
        
        // Refresh activity every 60 seconds
        this.activityRefreshInterval = setInterval(() => {
            this.loadRecentActivity();
        }, 60000);
    },
    
    // Stop auto-refresh intervals
    stopAutoRefresh: function() {
        if (this.statusCheckInterval) {
            clearInterval(this.statusCheckInterval);
            this.statusCheckInterval = null;
        }
        if (this.activityRefreshInterval) {
            clearInterval(this.activityRefreshInterval);
            this.activityRefreshInterval = null;
        }
    }
};

// Global functions for dashboard actions
function navigateToApp(app) {
    console.log(`Navigating to ${app} app`);
    window.location.hash = `#${app}`;
}

function refreshAppStatus() {
    console.log('Refreshing all app status...');
    if (typeof appsDashboard !== 'undefined') {
        appsDashboard.checkAllAppStatus();
        appsDashboard.loadConfigurationSummary();
    }
}

function refreshAllApps() {
    console.log('Refreshing all apps...');
    refreshAppStatus();
    if (typeof appsDashboard !== 'undefined') {
        appsDashboard.loadRecentActivity();
    }
}

function globalSearch() {
    console.log('Opening global search...');
    // Implement global search functionality
    alert('Global search functionality coming soon!');
}

function systemMaintenance() {
    console.log('Opening system maintenance...');
    // Implement system maintenance functionality
    alert('System maintenance functionality coming soon!');
}

// Initialize dashboard when Apps section is shown
document.addEventListener('DOMContentLoaded', function() {
    // Check if we're on the apps section and initialize dashboard
    const observer = new MutationObserver(function(mutations) {
        mutations.forEach(function(mutation) {
            if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                const appsSection = document.getElementById('appsSection');
                if (appsSection && appsSection.classList.contains('active')) {
                    if (typeof appsDashboard !== 'undefined') {
                        appsDashboard.init();
                    }
                } else {
                    if (typeof appsDashboard !== 'undefined') {
                        appsDashboard.stopAutoRefresh();
                    }
                }
            }
        });
    });
    
    const appsSection = document.getElementById('appsSection');
    if (appsSection) {
        observer.observe(appsSection, { attributes: true });
        
        // Initialize immediately if already active
        if (appsSection.classList.contains('active')) {
            if (typeof appsDashboard !== 'undefined') {
                appsDashboard.init();
            }
        }
    }
});

// Apps module is now initialized per-app when navigating to individual app sections
// No automatic initialization needed
