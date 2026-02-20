
/* === modules/features/apps/apps-main.js === */
(function() {
    /**
     * Huntarr - Apps Module
     * Handles displaying and managing app settings for media server applications
     */

    var appsModule = {
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
                        // Update global settings store for modal access
                        if (window.huntarrUI) {
                            if (!window.huntarrUI.originalSettings) {
                                window.huntarrUI.originalSettings = {};
                            }
                            window.huntarrUI.originalSettings[app] = appSettings;
                        }

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
                                // The container might have class 'instances-container' or ID like 'sonarr-instances-grid'
                                const instancesContainer = formElement.querySelector('.instances-container') || 
                                                         formElement.querySelector('.instance-card-grid') ||
                                                         document.getElementById(`${app}-instances-grid`);
                                
                                if (instancesContainer) {
                                    const instanceCount = appSettings.instances ? appSettings.instances.length : 0;
                                    console.log(`[Apps] Setting up connection status checking for ${app} with ${instanceCount} instances`);
                                    // Add a small delay to ensure all instance cards are rendered before testing connections
                                    setTimeout(() => {
                                        SettingsForms.testAllInstanceConnections(app);
                                    }, 100);
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
                    if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Error: Could not determine which app settings to save', 'error');
                    else alert('Error: Could not determine which app settings to save');
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
                    if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Error: App panel not found for ' + appType, 'error');
                    else alert('Error: App panel not found for ' + appType);
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
                    if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Error collecting settings: ' + error.message, 'error');
                    else alert('Error collecting settings: ' + error.message);
                }
                return;
            }
            
            // Add specific logging for settings critical to stateful management
            if (appType === 'general') {
                console.log('Stateful management settings being saved:', {
                    statefulExpirationHours: settings.statefulExpirationHours,
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
                    if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Error saving settings: ' + error.message, 'error');
                    else alert('Error saving settings: ' + error.message);
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

    // Expose to window
    window.appsModule = appsModule;
    console.log('[Apps] appsModule defined and exposed to window');
})();


/* === modules/features/logs/logs-main.js === */
/**
 * Huntarr Logs Module
 * Handles all logging functionality including streaming, filtering, search, and display
 */

console.log('[LOGS.JS] Script is loading and executing...');
console.log('[LOGS.JS] About to define window.LogsModule');

window.LogsModule = {
    // Current state
    eventSources: {},
    currentLogApp: 'all',
    userTimezone: null, // Cache for user's timezone setting
    initialized: false, // Track initialization to prevent duplicates
    
    // Pagination state
    currentPage: 1,
    totalPages: 1,
    pageSize: 20,
    totalLogs: 0,
    
    // Element references
    elements: {},
    
    // Initialize the logs module
    init: function() {
        if (this.initialized) {
            console.log('[LogsModule] Already initialized, skipping...');
            return;
        }
        
        console.log('[LogsModule] Initializing logs module...');
        this.cacheElements();
        this.loadUserTimezone();
        this.setupEventListeners();
        this.updateDebugLevelVisibility();
        
        // Load initial logs for the default app without resetting pagination
        console.log('[LogsModule] Loading initial logs...');
        this.loadLogsFromAPI(this.currentLogApp);
        this.setupLogPolling(this.currentLogApp);
        
        this.initialized = true;
        console.log('[LogsModule] Initialization complete');
    },

    // Filter log app dropdown by context: 'media-hunt' = only Media Hunt (All), Movie Hunt, TV Hunt; 'system' = all options
    setAppFilterContext: function(context) {
        const logAppSelect = document.getElementById('logAppSelect');
        if (!logAppSelect) return;
        const opts = logAppSelect.querySelectorAll('option');
        opts.forEach(function(opt) {
            const ctx = opt.getAttribute('data-context');
            if (context === 'media-hunt') {
                opt.hidden = (ctx === 'system');
            } else {
                opt.hidden = false;
            }
        });
        // Ensure selection is valid for current context
        if (context === 'media-hunt') {
            const valid = ['media_hunt', 'movie_hunt', 'tv_hunt'];
            if (valid.indexOf(logAppSelect.value) === -1) {
                logAppSelect.value = 'media_hunt';
                this.currentLogApp = 'media_hunt';
            }
        }
    },

    // Show or hide DEBUG option in level dropdown based on enable_debug_logs setting (GitHub #756)
    updateDebugLevelVisibility: function() {
        const option = document.getElementById('logLevelOptionDebug');
        const levelSelect = document.getElementById('logLevelSelect');
        if (!option || !levelSelect) return;
        HuntarrUtils.fetchWithTimeout('./api/settings')
            .then(response => response.json())
            .then(data => {
                const settings = data.general || {};
                const enableDebug = settings.enable_debug_logs !== false;
                option.style.display = enableDebug ? '' : 'none';
                option.disabled = !enableDebug;
                if (!enableDebug && levelSelect.value === 'debug') {
                    levelSelect.value = 'info';
                    this.filterLogsByLevel('info');
                }
            })
            .catch(() => {
                option.style.display = '';
                option.disabled = false;
            });
    },
    
    // Load user's timezone setting from the backend
    loadUserTimezone: function() {
        // Set immediate fallback to prevent warnings during loading
        this.userTimezone = this.userTimezone || 'UTC';
        
        HuntarrUtils.fetchWithTimeout('./api/settings')
            .then(response => response.json())
            .then(settings => {
                this.userTimezone = settings.general?.effective_timezone || settings.general?.timezone || 'UTC';
                console.log('[LogsModule] User timezone loaded:', this.userTimezone);
            })
            .catch(error => {
                console.warn('[LogsModule] Failed to load user timezone, using UTC:', error);
                this.userTimezone = 'UTC';
            });
    },
    
    // Validate timestamp format and values
    isValidTimestamp: function(timestamp) {
        if (!timestamp || typeof timestamp !== 'string') return false;
        
        // Check for pipe-separated format: YYYY-MM-DD HH:MM:SS
        const timestampRegex = /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$/;
        if (!timestampRegex.test(timestamp.trim())) return false;
        
        // Parse the components to validate ranges
        const parts = timestamp.trim().split(' ');
        if (parts.length !== 2) return false;
        
        const datePart = parts[0];
        const timePart = parts[1];
        
        // Validate date part: YYYY-MM-DD
        const dateMatch = datePart.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!dateMatch) return false;
        
        const year = parseInt(dateMatch[1]);
        const month = parseInt(dateMatch[2]);
        const day = parseInt(dateMatch[3]);
        
        // Basic range validation
        if (year < 2020 || year > 2030) return false;
        if (month < 1 || month > 12) return false;
        if (day < 1 || day > 31) return false;
        
        // Validate time part: HH:MM:SS
        const timeMatch = timePart.match(/^(\d{2}):(\d{2}):(\d{2})$/);
        if (!timeMatch) return false;
        
        const hour = parseInt(timeMatch[1]);
        const minute = parseInt(timeMatch[2]);
        const second = parseInt(timeMatch[3]);
        
        // Validate time ranges
        if (hour < 0 || hour > 23) return false;
        if (minute < 0 || minute > 59) return false;
        if (second < 0 || second > 59) return false;
        
        // Try to create a Date object to catch edge cases
        try {
            const testDate = new Date(`${datePart}T${timePart}Z`);
            return !isNaN(testDate.getTime());
        } catch (error) {
            return false;
        }
    },
    
    // Parse timestamp that's already converted to user's timezone by the backend
    convertToUserTimezone: function(timestamp) {
        if (!timestamp) {
            console.debug('[LogsModule] No timestamp provided for parsing');
            return { date: '', time: '' };
        }
        
        try {
            // The backend already converts timestamps to user's timezone
            // So we just need to parse the "YYYY-MM-DD HH:MM:SS" format
            const cleanTimestamp = timestamp.trim();
            const parts = cleanTimestamp.split(' ');
            
            if (parts.length >= 2) {
                return {
                    date: parts[0],
                    time: parts[1]
                };
            } else {
                // Fallback for unexpected format
                console.warn('[LogsModule] Unexpected timestamp format:', timestamp);
                return { date: cleanTimestamp, time: '' };
            }
        } catch (error) {
            console.warn('[LogsModule] Error parsing timestamp:', error);
            // Fallback to original timestamp
            return { date: timestamp?.split(' ')[0] || '', time: timestamp?.split(' ')[1] || '' };
        }
    },
    
    // Cache DOM elements for better performance
    cacheElements: function() {
        // Logs elements
        this.elements.logsContainer = document.getElementById('logsContainer');
        this.elements.clearLogsButton = document.getElementById('clearLogsButton');
        this.elements.logConnectionStatus = document.getElementById('logConnectionStatus');
        
        // Log search elements
        this.elements.logSearchInput = document.getElementById('logSearchInput');
        this.elements.logSearchButton = document.getElementById('logSearchButton');
        this.elements.clearSearchButton = document.getElementById('clearSearchButton');
        this.elements.logSearchResults = document.getElementById('logSearchResults');
        
        // Log level filter element
        this.elements.logLevelSelect = document.getElementById('logLevelSelect');
        
        // Log dropdown elements
        this.elements.logOptions = document.querySelectorAll('.log-option');
        this.elements.currentLogApp = document.getElementById('current-log-app');
        this.elements.logDropdownBtn = document.querySelector('.log-dropdown-btn');
        this.elements.logDropdownContent = document.querySelector('.log-dropdown-content');
        
        // Pagination elements
        this.elements.logsPrevPage = document.getElementById('logsPrevPage');
        this.elements.logsNextPage = document.getElementById('logsNextPage');
        this.elements.logsCurrentPage = document.getElementById('logsCurrentPage');
        this.elements.logsTotalPages = document.getElementById('logsTotalPages');
        this.elements.logsPageSize = document.getElementById('logsPageSize');
    },
    
    // Set up event listeners for logging functionality
    setupEventListeners: function() {
        // Auto-scroll functionality removed
        
        // Clear logs button - only this click may show the clear-logs confirmation
        if (this.elements.clearLogsButton) {
            this.elements.clearLogsButton.addEventListener('click', () => this.clearLogs(true));
        }
        
        // Log search functionality
        if (this.elements.logSearchButton) {
            this.elements.logSearchButton.addEventListener('click', () => this.searchLogs());
        }
        
        if (this.elements.logSearchInput) {
            this.elements.logSearchInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.searchLogs();
                }
            });
            
            // Clear search when input is emptied
            this.elements.logSearchInput.addEventListener('input', (e) => {
                if (e.target.value.trim() === '') {
                    this.clearLogSearch();
                }
            });
        }
        
        // Clear search button
        if (this.elements.clearSearchButton) {
            this.elements.clearSearchButton.addEventListener('click', () => this.clearLogSearch());
        }
        
        // Log options dropdown
        this.elements.logOptions.forEach(option => {
            option.addEventListener('click', (e) => this.handleLogOptionChange(e));
        });
        
        // Log dropdown toggle
        if (this.elements.logDropdownBtn) {
            this.elements.logDropdownBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.elements.logDropdownContent.classList.toggle('show');
            });
            
            // Close dropdown when clicking outside
            document.addEventListener('click', (e) => {
                if (!e.target.closest('.log-dropdown') && this.elements.logDropdownContent.classList.contains('show')) {
                    this.elements.logDropdownContent.classList.remove('show');
                }
            });
        }
        
        // LOG LEVEL FILTER: Listen for change on #logLevelSelect
        const logLevelSelect = document.getElementById('logLevelSelect');
        if (logLevelSelect) {
            logLevelSelect.addEventListener('change', (e) => {
                this.filterLogsByLevel(e.target.value);
            });
        }
        
        // LOGS: Listen for change on #logAppSelect
        const logAppSelect = document.getElementById('logAppSelect');
        if (logAppSelect) {
            logAppSelect.addEventListener('change', (e) => {
                const app = e.target.value;
                this.handleLogOptionChange(app);
            });
        }
        
        // Pagination event listeners
        if (this.elements.logsPrevPage) {
            this.elements.logsPrevPage.addEventListener('click', () => this.handlePagination('prev'));
        }
        
        if (this.elements.logsNextPage) {
            this.elements.logsNextPage.addEventListener('click', () => this.handlePagination('next'));
        }
        
        if (this.elements.logsPageSize) {
            this.elements.logsPageSize.addEventListener('change', () => this.handlePageSizeChange());
        }
    },
    
    // Handle log option dropdown changes
    handleLogOptionChange: function(app) {
        if (app && app.target && typeof app.target.value === 'string') {
            app = app.target.value;
        } else if (app && app.target && typeof app.target.getAttribute === 'function') {
            app = app.target.getAttribute('data-app');
        }
        if (!app || app === this.currentLogApp) {
            console.log(`[LogsModule] handleLogOptionChange - no change needed (${app} === ${this.currentLogApp})`);
            return;
        }
        
        console.log(`[LogsModule] handleLogOptionChange - switching from ${this.currentLogApp} to ${app}`);
        
        // Update the select value
        const logAppSelect = document.getElementById('logAppSelect');
        if (logAppSelect) logAppSelect.value = app;
        
        // Update the current log app text with proper capitalization
        let displayName = app.charAt(0).toUpperCase() + app.slice(1).replace(/_/g, ' ');
        if (app === 'all') displayName = 'Everywhere';
        else if (app === 'whisparr') displayName = 'Whisparr V2';
        else if (app === 'eros') displayName = 'Whisparr V3';
        else if (app === 'media_hunt') displayName = 'Media Hunt (All)';
        else if (app === 'movie_hunt') displayName = 'Movie Hunt';
        else if (app === 'tv_hunt') displayName = 'TV Hunt';

        if (this.elements.currentLogApp) this.elements.currentLogApp.textContent = displayName;
        
        // Switch to the selected app logs
        this.currentLogApp = app;
        this.currentPage = 1; // Reset to first page when switching apps
        this.resetLogsView();
    },
    
    // Handle app changes from external sources (like huntarrUI tab switching)
    handleAppChange: function(app) {
        if (!app || app === this.currentLogApp) {
            console.log(`[LogsModule] handleAppChange - no change needed (${app} === ${this.currentLogApp})`);
            return;
        }
        
        console.log(`[LogsModule] handleAppChange - switching from ${this.currentLogApp} to ${app}`);
        
        // Update the select value
        const logAppSelect = document.getElementById('logAppSelect');
        if (logAppSelect) logAppSelect.value = app;
        
        // Update the current log app text with proper capitalization
        let displayName = app.charAt(0).toUpperCase() + app.slice(1).replace(/_/g, ' ');
        if (app === 'all') displayName = 'Everywhere';
        else if (app === 'whisparr') displayName = 'Whisparr V2';
        else if (app === 'eros') displayName = 'Whisparr V3';
        else if (app === 'media_hunt') displayName = 'Media Hunt (All)';
        else if (app === 'movie_hunt') displayName = 'Movie Hunt';
        else if (app === 'tv_hunt') displayName = 'TV Hunt';

        if (this.elements.currentLogApp) this.elements.currentLogApp.textContent = displayName;
        
        // Switch to the selected app logs
        this.currentLogApp = app;
        this.currentPage = 1; // Reset to first page when switching apps
        this.resetLogsView();
    },
    
    // Reset log view when switching apps (clear display and reconnect; no confirmation, no API delete)
    resetLogsView: function() {
        if (this.elements.logsContainer) {
            this.elements.logsContainer.innerHTML = '';
        }
        this.connectToLogs();
    },
    
    // Connect to logs stream
    connectToLogs: function() {
        console.log(`[LogsModule] connectToLogs() called - currentLogApp: ${this.currentLogApp}, currentPage: ${this.currentPage}`);
        console.trace('[LogsModule] connectToLogs call stack');
        
        // Disconnect any existing event sources
        this.disconnectAllEventSources();
        
        // Connect to logs stream for the currentLogApp
        this.connectEventSource(this.currentLogApp);
        if (this.elements.logConnectionStatus) {
            this.elements.logConnectionStatus.textContent = 'Connecting...';
            this.elements.logConnectionStatus.className = '';
        }
    },
    
    // Connect to database-based logs API (replaces EventSource)
    connectEventSource: function(appType) {
        // Clear any existing polling interval
        if (this.logPollingInterval) {
            clearInterval(this.logPollingInterval);
        }
        
        // Set connection status
        if (this.elements.logConnectionStatus) {
            this.elements.logConnectionStatus.textContent = 'Connecting...';
            this.elements.logConnectionStatus.className = '';
        }
        
        // Load logs for the current page (don't always reset to page 1)
        console.log(`[LogsModule] connectEventSource - loading page ${this.currentPage} for app ${appType}`);
        this.loadLogsFromAPI(appType);
        
        // Set up polling with user's configured interval
        this.setupLogPolling(appType);
        
        // Status will be updated by loadLogsFromAPI on success/failure
    },
    
    // Set up log polling with user's configured interval
    setupLogPolling: function(appType) {
        // Fetch the log refresh interval from general settings
        HuntarrUtils.fetchWithTimeout('./api/settings/general', {
            method: 'GET'
        })
        .then(response => response.json())
        .then(settings => {
            // Use the configured interval, default to 30 seconds if not set
            const intervalSeconds = settings.log_refresh_interval_seconds || 30;
            const intervalMs = intervalSeconds * 1000;
            
            console.log(`[LogsModule] Setting up log polling with ${intervalSeconds} second interval`);
            
            // Set up polling for new logs using the configured interval
            this.logPollingInterval = setInterval(() => {
                // Only poll for new logs when on page 1 (latest logs)
                if (this.currentPage === 1) {
                    this.loadLogsFromAPI(appType, true);
                }
            }, intervalMs);
        })
        .catch(error => {
            console.error('[LogsModule] Error fetching log refresh interval, using default 30 seconds:', error);
            // Fallback to 30 seconds if settings fetch fails
            this.logPollingInterval = setInterval(() => {
                // Only poll for new logs when on page 1 (latest logs)
                if (this.currentPage === 1) {
                    this.loadLogsFromAPI(appType, true);
                }
            }, 30000);
        });
    },
    
    // Load logs from the database API
    loadLogsFromAPI: function(appType, isPolling = false) {
        // Use the correct API endpoint - the backend now supports 'all' as an app_type
        const apiUrl = `./api/logs/${appType}`;
        
        // For polling, always get latest logs (offset=0, small limit)
        // For pagination, use current page and page size
        let limit, offset;
        if (isPolling) {
            limit = 20;
            offset = 0;
        } else {
            limit = this.pageSize;
            offset = (this.currentPage - 1) * this.pageSize;
        }
        
        // Include level filter in API call if a specific level is selected
        const currentLogLevel = this.elements.logLevelSelect ? this.elements.logLevelSelect.value : 'all';
        let apiParams = `limit=${limit}&offset=${offset}`;
        if (currentLogLevel !== 'all') {
            apiParams += `&level=${currentLogLevel.toUpperCase()}`;
        }
        
        HuntarrUtils.fetchWithTimeout(`${apiUrl}?${apiParams}`)
            .then(response => {
                return response.json();
            })
            .then(data => {
                if (data.success && data.logs) {
                    this.processLogsFromAPI(data.logs, appType, isPolling);
                    
                    // Update pagination info (only on non-polling requests)
                    if (!isPolling && data.total !== undefined) {
                        this.totalLogs = data.total;
                        this.totalPages = Math.max(1, Math.ceil(this.totalLogs / this.pageSize));
                        console.log(`[LogsModule] Updated pagination: totalLogs=${this.totalLogs}, totalPages=${this.totalPages}, currentPage=${this.currentPage}`);
                        this.updatePaginationUI();
                    } else if (isPolling) {
                        console.log(`[LogsModule] Polling request - not updating pagination. Current: totalLogs=${this.totalLogs}, totalPages=${this.totalPages}, currentPage=${this.currentPage}`);
                    }
                    
                    // Update connection status on successful API call (only on initial load, not polling)
                    if (this.elements.logConnectionStatus && !isPolling) {
                        this.elements.logConnectionStatus.textContent = 'Connected';
                        this.elements.logConnectionStatus.className = 'status-connected';
                    }
                } else {
                    console.error('[LogsModule] Failed to load logs:', data.error || 'No logs in response');
                    if (this.elements.logConnectionStatus) {
                        this.elements.logConnectionStatus.textContent = data.error || 'Error loading logs';
                        this.elements.logConnectionStatus.className = 'status-error';
                    }
                }
            })
            .catch(error => {
                console.error('[LogsModule] Error loading logs:', error);
                if (this.elements.logConnectionStatus) {
                    this.elements.logConnectionStatus.textContent = 'Connection error';
                    this.elements.logConnectionStatus.className = 'status-error';
                }
            });
    },
    
    // Process logs received from API
    processLogsFromAPI: function(logs, appType, isPolling = false) {
        if (!this.elements.logsContainer) return;
        
        // If not polling, clear existing logs first
        if (!isPolling) {
            this.elements.logsContainer.innerHTML = '';
        }
        
        // Track existing log entries to avoid duplicates when polling
        // Use API timestamp + message for duplicate detection
        const existingLogEntries = new Set();
        if (isPolling) {
            const existingEntries = this.elements.logsContainer.querySelectorAll('tr.log-table-row');
            existingEntries.forEach(entry => {
                const messageElement = entry.querySelector('.col-message');
                const timestampElement = entry.querySelector('.col-time');
                if (messageElement && timestampElement) {
                    // Create a unique key using display timestamp + message
                    const timestampText = timestampElement.textContent.trim().replace(/\s+/g, ' ');
                    const messageText = messageElement.textContent.trim();
                    existingLogEntries.add(`${timestampText}|${messageText}`);
                }
            });
        }
        
        logs.forEach(logString => {
            try {
                // Process clean log format - same as before
                const logRegex = /^(?:\[[\w]+\]\s+)?([^|]+)\|([^|]+)\|([^|]+)\|(.*)$/;
                const match = logString.match(logRegex);

                if (!match) {
                    return; // Skip non-clean log entries entirely
                }
                
                // Extract log components from clean format
                const timestamp = match[1];
                const level = match[2]; 
                const logAppType = match[3].toLowerCase();
                const originalMessage = match[4];
                
                // Convert timestamp for display first
                const userTime = this.convertToUserTimezone(timestamp);
                const displayTimestamp = `${userTime.date} ${userTime.time}`;
                
                // Skip if we already have this log entry (when polling)
                // Use the display timestamp + message for duplicate detection
                if (isPolling && existingLogEntries.has(`${displayTimestamp}|${originalMessage.trim()}`)) {
                    return;
                }
                
                // Validate timestamp
                if (!this.isValidTimestamp(timestamp)) {
                    console.log('[LogsModule] Skipping log entry with invalid timestamp:', timestamp);
                    return;
                }
                
                // No need for client-side app filtering since the API handles this correctly now
                // The API returns the right logs based on the selected app type
                
                // Clean the message
                let cleanMessage = originalMessage;
                cleanMessage = cleanMessage.replace(/^\s*-\s*/, ''); // Remove any leading dashes
                cleanMessage = cleanMessage.trim(); // Remove extra whitespace
                
                const logEntry = document.createElement('tr');
                logEntry.className = 'log-table-row';
                
                // Create level badge
                const levelClass = level.toLowerCase();
                let levelBadge = '';
                
                switch(levelClass) {
                    case 'error':
                        levelBadge = `<span class="log-level-badge log-level-error">Error</span>`;
                        break;
                    case 'warning':
                    case 'warn':
                        levelBadge = `<span class="log-level-badge log-level-warning">Warning</span>`;
                        break;
                    case 'info':
                        levelBadge = `<span class="log-level-badge log-level-info">Info</span>`;
                        break;
                    case 'debug':
                        levelBadge = `<span class="log-level-badge log-level-debug">Debug</span>`;
                        break;
                    case 'fatal':
                    case 'critical':
                        levelBadge = `<span class="log-level-badge log-level-fatal">Fatal</span>`;
                        break;
                    default:
                        levelBadge = `<span class="log-level-badge log-level-info">${level}</span>`;
                }
                
                // Determine app source for display: friendly names for hunt apps; "APP - INSTANCE" for *arr (e.g. sonarr-test -> SONARR - test)
                const appDisplayNames = { movie_hunt: 'Movie Hunt', tv_hunt: 'TV Hunt', swaparr: 'Swaparr', whisparr: 'Whisparr V2', eros: 'Whisparr V3' };
                let appSource = 'SYSTEM';
                if (logAppType && logAppType !== 'system') {
                    if (appDisplayNames[logAppType]) {
                        appSource = appDisplayNames[logAppType];
                    } else if (logAppType.indexOf('-') !== -1) {
                        const parts = logAppType.split('-');
                        const appPart = (parts[0] || '').toUpperCase();
                        const instancePart = (parts.slice(1).join('-') || '').trim();
                        appSource = instancePart ? `${appPart} - ${instancePart}` : appPart;
                    } else {
                        appSource = logAppType.toUpperCase();
                    }
                }

                logEntry.innerHTML = `
                    <td class="col-time">${displayTimestamp}</td>
                    <td class="col-level">${levelBadge}</td>
                    <td class="col-app">${appSource}</td>
                    <td class="col-message">${cleanMessage}</td>
                `;
                logEntry.classList.add(`log-${levelClass}`);
                
                // Add to logs container
                if (isPolling) {
                    // When polling, add to the top
                    this.elements.logsContainer.insertBefore(logEntry, this.elements.logsContainer.firstChild);
                } else {
                    // When loading a page, add to the end
                    this.elements.logsContainer.appendChild(logEntry);
                }
                
                // Special event dispatching for Swaparr logs
                if (logAppType === 'swaparr' && this.currentLogApp === 'swaparr') {
                    // Dispatch a custom event for swaparr.js to process
                    const swaparrEvent = new CustomEvent('swaparrLogReceived', {
                        detail: {
                            logData: cleanMessage
                        }
                    });
                    document.dispatchEvent(swaparrEvent);
                }
                
                // Apply current log level filter
                const currentLogLevel = this.elements.logLevelSelect ? this.elements.logLevelSelect.value : 'all';
                if (currentLogLevel !== 'all') {
                    this.applyFilterToSingleEntry(logEntry, currentLogLevel);
                }
                
                // Auto-scroll functionality removed
            } catch (error) {
                console.error('[LogsModule] Error processing log message:', error, 'Data:', logString);
            }
        });
    },
    
    // Disconnect all event sources (now handles polling intervals)
    disconnectAllEventSources: function() {
        // Clear polling interval if it exists
        if (this.logPollingInterval) {
            clearInterval(this.logPollingInterval);
            this.logPollingInterval = null;
            console.log('[LogsModule] Cleared log polling interval');
        }
        
        // Clear any remaining event sources (legacy)
        Object.keys(this.eventSources).forEach(key => {
            const source = this.eventSources[key];
            if (source) {
                try {
                    if (source.readyState !== EventSource.CLOSED) {
                        source.close();
                        console.log(`[LogsModule] Closed event source for ${key}.`);
                    }
                } catch (e) {
                    console.error(`[LogsModule] Error closing event source for ${key}:`, e);
                }
            }
            delete this.eventSources[key];
        });
        
        if (this.elements.logConnectionStatus) {
            this.elements.logConnectionStatus.textContent = 'Disconnected';
            this.elements.logConnectionStatus.className = 'status-disconnected';
        }
    },
    
    // Clear all logs (only when fromButton is true - i.e. user clicked Clear button; app changes use resetLogsView instead)
    clearLogs: function(fromButton) {
        if (fromButton !== true) {
            return; // Only show confirmation and delete when explicitly invoked from the Clear button
        }
        console.log('[LogsModule] Clear logs button clicked');
        
        // Get current app filter - use logAppSelect when available, fallback to currentLogApp
        const logAppSelect = document.getElementById('logAppSelect');
        const currentApp = logAppSelect ? logAppSelect.value : (this.currentLogApp || 'all');
        const appDisplayNames = { all: 'Everywhere', media_hunt: 'Media Hunt (All)', movie_hunt: 'Movie Hunt', tv_hunt: 'TV Hunt', swaparr: 'Swaparr', sonarr: 'Sonarr', radarr: 'Radarr', lidarr: 'Lidarr', readarr: 'Readarr', whisparr: 'Whisparr V2', eros: 'Whisparr V3', system: 'System' };
        const appLabel = appDisplayNames[currentApp] ? appDisplayNames[currentApp] + ' logs' : currentApp + ' logs';
        const msg = `Are you sure you want to clear ${appLabel}? This action cannot be undone.`;
        const self = this;
        const doClear = function() {
            console.log(`[LogsModule] Clearing logs for app: ${currentApp}`);
            HuntarrUtils.fetchWithTimeout(`./api/logs/${currentApp}/clear`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            console.log('[LogsModule] Logs cleared successfully:', data);
            
            // Clear the frontend display
            if (self.elements.logsContainer) {
                self.elements.logsContainer.innerHTML = '';
            }
            
            // Show success notification
            if (typeof huntarrUI !== 'undefined' && typeof huntarrUI.showNotification === 'function') {
                huntarrUI.showNotification(`Cleared ${data.deleted_count || 0} ${appLabel}`, 'success');
            }
            
            // Reload logs to show any new entries that may have arrived
            setTimeout(() => {
                self.connectToLogs();
            }, 500);
        })
        .catch(error => {
            console.error('[LogsModule] Error clearing logs:', error);
            
            // Show error notification
            if (typeof huntarrUI !== 'undefined' && typeof huntarrUI.showNotification === 'function') {
                huntarrUI.showNotification(`Error clearing logs: ${error.message}`, 'error');
            }
        });
        };
        if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
            window.HuntarrConfirm.show({ title: 'Clear Logs', message: msg, confirmLabel: 'Clear', onConfirm: doClear });
        } else {
            if (!confirm(msg)) {
                console.log('[LogsModule] Clear logs cancelled by user');
                return;
            }
            doClear();
        }
    },
    
    // Insert log entry in reverse chronological order (newest first)
    insertLogEntryInOrder: function(newLogEntry) {
        if (!this.elements.logsContainer || !newLogEntry) return;
        
        const newTimestampText = newLogEntry.querySelector('.col-time')?.textContent.trim();
        // Use a more compatible date parsing format (YYYY/MM/DD HH:MM:SS)
        const newTimestamp = newTimestampText ? new Date(newTimestampText.replace(/-/g, '/')) : null;
        
        // If no timestamp, add at the top (newest entries go to top)
        if (!newTimestamp || isNaN(newTimestamp.getTime())) {
            this.elements.logsContainer.insertBefore(newLogEntry, this.elements.logsContainer.firstChild);
            return;
        }
        
        // If empty container, just add the entry
        if (this.elements.logsContainer.children.length === 0) {
            this.elements.logsContainer.appendChild(newLogEntry);
            return;
        }
        
        const existingEntries = Array.from(this.elements.logsContainer.children);
        let insertPosition = null;
        
        // Find the correct position - newest entries should be at the top
        for (let i = 0; i < existingEntries.length; i++) {
            const existingTimestampText = existingEntries[i].querySelector('.col-time')?.textContent.trim();
            const existingTimestamp = existingTimestampText ? new Date(existingTimestampText.replace(/-/g, '/')) : null;
            
            if (!existingTimestamp || isNaN(existingTimestamp.getTime())) continue;
            
            if (newTimestamp >= existingTimestamp) {
                insertPosition = existingEntries[i];
                break;
            }
        }
        
        if (insertPosition) {
            this.elements.logsContainer.insertBefore(newLogEntry, insertPosition);
        } else {
            this.elements.logsContainer.appendChild(newLogEntry);
        }
    },
    
    // Parse timestamp from log entry DOM element
    parseLogTimestamp: function(logEntry) {
        if (!logEntry) return null;
        
        try {
            const dateSpan = logEntry.querySelector('.log-timestamp .date');
            const timeSpan = logEntry.querySelector('.log-timestamp .time');
            
            if (!dateSpan || !timeSpan) return null;
            
            const dateText = dateSpan.textContent.trim();
            const timeText = timeSpan.textContent.trim();
            
            if (!dateText || !timeText || dateText === '--' || timeText === '--:--:--') {
                return null;
            }
            
            const timestampString = `${dateText} ${timeText}`;
            const timestamp = new Date(timestampString);
            
            return isNaN(timestamp.getTime()) ? null : timestamp;
        } catch (error) {
            console.warn('[LogsModule] Error parsing log timestamp:', error);
            return null;
        }
    },
    
    // Search logs functionality
    searchLogs: function() {
        if (!this.elements.logsContainer || !this.elements.logSearchInput) return;
        
        const searchText = this.elements.logSearchInput.value.trim().toLowerCase();
        
        if (!searchText) {
            this.clearLogSearch();
            return;
        }
        
        if (this.elements.clearSearchButton) {
            this.elements.clearSearchButton.style.display = 'block';
        }
        
        const logEntries = Array.from(this.elements.logsContainer.querySelectorAll('tr.log-table-row'));
        let matchCount = 0;
        
        const MAX_ENTRIES_TO_PROCESS = 300;
        const processedLogEntries = logEntries.slice(0, MAX_ENTRIES_TO_PROCESS);
        const remainingCount = Math.max(0, logEntries.length - MAX_ENTRIES_TO_PROCESS);
        
        processedLogEntries.forEach((entry, index) => {
            const entryText = entry.textContent.toLowerCase();
            
            if (entryText.includes(searchText)) {
                entry.style.display = '';
                matchCount++;
                this.simpleHighlightMatch(entry, searchText);
            } else {
                entry.style.display = 'none';
            }
        });
        
        if (remainingCount > 0) {
            logEntries.slice(MAX_ENTRIES_TO_PROCESS).forEach(entry => {
                const entryText = entry.textContent.toLowerCase();
                if (entryText.includes(searchText)) {
                    entry.style.display = '';
                    matchCount++;
                } else {
                    entry.style.display = 'none';
                }
            });
        }
        
        if (this.elements.logSearchResults) {
            let resultsText = `Found ${matchCount} matching log entries`;
            this.elements.logSearchResults.textContent = resultsText;
            this.elements.logSearchResults.style.display = 'block';
        }
        
        // Auto-scroll functionality removed from search
    },
    
    // Simple highlighting method
    simpleHighlightMatch: function(logEntry, searchText) {
        if (searchText.length < 2) return;
        
        if (!logEntry.hasAttribute('data-original-html')) {
            logEntry.setAttribute('data-original-html', logEntry.innerHTML);
        }
        
        const html = logEntry.getAttribute('data-original-html');
        const escapedSearchText = searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        
        const regex = new RegExp(`(${escapedSearchText})`, 'gi');
        const newHtml = html.replace(regex, '<span class="search-highlight">$1</span>');
        
        logEntry.innerHTML = newHtml;
    },
    
    // Clear log search
    clearLogSearch: function() {
        if (!this.elements.logsContainer) return;
        
        if (this.elements.logSearchInput) {
            this.elements.logSearchInput.value = '';
        }
        
        if (this.elements.clearSearchButton) {
            this.elements.clearSearchButton.style.display = 'none';
        }
        
        if (this.elements.logSearchResults) {
            this.elements.logSearchResults.style.display = 'none';
        }
        
        const allLogEntries = this.elements.logsContainer.querySelectorAll('tr.log-table-row');
        
        Array.from(allLogEntries).forEach(entry => {
            entry.style.display = '';
            
            if (entry.hasAttribute('data-original-html')) {
                entry.innerHTML = entry.getAttribute('data-original-html');
            }
        });
        
        // Auto-scroll functionality removed from clear search
    },
    
    // Filter logs by level
    filterLogsByLevel: function(selectedLevel) {
        console.log(`[LogsModule] Filtering logs by level: ${selectedLevel}`);
        
        // Reset to first page when changing filter
        this.currentPage = 1;
        
        // Reload logs from API with new filter
        this.loadLogsFromAPI(this.currentLogApp, false);
    },
    
    // Apply filter to single entry
    applyFilterToSingleEntry: function(logEntry, selectedLevel) {
        const levelBadge = logEntry.querySelector('.log-level-badge');
        
        logEntry.removeAttribute('data-hidden-by-filter');
        
        if (levelBadge) {
            let entryLevel = '';
            const badgeText = levelBadge.textContent.toLowerCase().trim();
            
            switch(badgeText) {
                case 'info':
                case 'information':
                    entryLevel = 'info';
                    break;
                case 'warning':
                case 'warn':
                    entryLevel = 'warning';
                    break;
                case 'error':
                    entryLevel = 'error';
                    break;
                case 'debug':
                    entryLevel = 'debug';
                    break;
                case 'fatal':
                case 'critical':
                    entryLevel = 'critical';
                    break;
                default:
                    entryLevel = 'info';
            }
            
            // Map levels to numeric values for inclusive filtering
            const levelValues = {
                'debug': 10,
                'info': 20,
                'warning': 30,
                'error': 40,
                'critical': 50
            };
            
            const selectedValue = levelValues[selectedLevel.toLowerCase()] || 0;
            const entryValue = levelValues[entryLevel] || 0;
            
            if (entryLevel && entryValue >= selectedValue) {
                logEntry.style.display = '';
            } else {
                logEntry.style.display = 'none';
                logEntry.setAttribute('data-hidden-by-filter', 'true');
            }
        } else {
            logEntry.style.display = 'none';
            logEntry.setAttribute('data-hidden-by-filter', 'true');
        }
    },
    
    // Helper method to detect JSON fragments
    isJsonFragment: function(logString) {
        if (!logString || typeof logString !== 'string') return false;
        
        const trimmed = logString.trim();
        
        const jsonPatterns = [
            /^"[^"]*":\s*"[^"]*",?$/,
            /^"[^"]*":\s*\d+,?$/,
            /^"[^"]*":\s*true|false,?$/,
            /^"[^"]*":\s*null,?$/,
            /^"[^"]*":\s*\[[^\]]*\],?$/,
            /^"[^"]*":\s*\{[^}]*\},?$/,
            /^\s*\{?\s*$/,
            /^\s*\}?,?\s*$/,
            /^\s*\[?\s*$/,
            /^\s*\]?,?\s*$/,
            /^,?\s*$/,
            /^[^"]*':\s*[^,]*,.*':/,
            /^[a-zA-Z_][a-zA-Z0-9_]*':\s*\d+,/,
            /^[a-zA-Z_][a-zA-Z0-9_]*':\s*True|False,/,
            /^[a-zA-Z_][a-zA-Z0-9_]*':\s*'[^']*',/,
            /.*':\s*\d+,.*':\s*\d+,/,
            /.*':\s*True,.*':\s*False,/,
            /.*':\s*'[^']*',.*':\s*'[^']*',/,
            /^"[^"]*":\s*\[$/,
            /^[a-zA-Z_][a-zA-Z0-9_\s]*:\s*\[$/,
            /^[a-zA-Z_][a-zA-Z0-9_\s]*:\s*\{$/,
            /^[a-zA-Z_][a-zA-Z0-9_\s]*:\s*(True|False)$/i,
            /^[a-zA-Z_]+\s+(Mode|Setting|Config|Option):\s*(True|False|\d+)$/i,
            /^[a-zA-Z_]+\s*Mode:\s*(True|False)$/i,
            /^[a-zA-Z_]+\s*Setting:\s*.*$/i,
            /^[a-zA-Z_]+\s*Config:\s*.*$/i
        ];
        
        return jsonPatterns.some(pattern => pattern.test(trimmed));
    },
    
    // Helper method to detect invalid log lines
    isInvalidLogLine: function(logString) {
        if (!logString || typeof logString !== 'string') return true;
        
        const trimmed = logString.trim();
        
        if (trimmed.length === 0) return true;
        if (trimmed.length < 10) return true;
        if (/^(HTTP\/|Content-|Connection:|Host:|User-Agent:)/i.test(trimmed)) return true;
        if (/^[a-zA-Z]{1,5}\s+(Mode|Setting|Config|Debug|Info|Error|Warning):/i.test(trimmed)) return true;
        if (/^[a-zA-Z]{1,8}$/i.test(trimmed)) return true;
        if (/^[a-z]{1,8}\s*[A-Z]/i.test(trimmed) && trimmed.includes(':')) return true;
        
        return false;
    },
    
    // Handle pagination navigation
    handlePagination: function(direction) {
        console.log(`[LogsModule] =================== PAGINATION CALL START ===================`);
        console.log(`[LogsModule] handlePagination called - direction: ${direction}, currentPage BEFORE: ${this.currentPage}, totalPages: ${this.totalPages}`);
        console.trace('[LogsModule] handlePagination call stack');
        
        if (direction === 'prev' && this.currentPage > 1) {
            const oldPage = this.currentPage;
            this.currentPage--;
            console.log(`[LogsModule] PREV: Changed from page ${oldPage} to page ${this.currentPage}`);
            this.loadLogsFromAPI(this.currentLogApp, false);
        } else if (direction === 'next' && this.currentPage < this.totalPages) {
            const oldPage = this.currentPage;
            this.currentPage++;
            console.log(`[LogsModule] NEXT: Changed from page ${oldPage} to page ${this.currentPage}`);
            this.loadLogsFromAPI(this.currentLogApp, false);
        } else {
            console.log(`[LogsModule] Pagination blocked - direction: ${direction}, currentPage: ${this.currentPage}, totalPages: ${this.totalPages}`);
        }
        console.log(`[LogsModule] =================== PAGINATION CALL END ===================`);
    },
    
    // Handle page size change
    handlePageSizeChange: function() {
        const newPageSize = parseInt(this.elements.logsPageSize.value);
        if (newPageSize !== this.pageSize) {
            this.pageSize = newPageSize;
            this.currentPage = 1; // Reset to first page
            this.loadLogsFromAPI(this.currentLogApp, false);
        }
    },
    
    // Update pagination UI elements
    updatePaginationUI: function() {
        console.log(`[LogsModule] updatePaginationUI called - currentPage: ${this.currentPage}, totalPages: ${this.totalPages}`);
        console.log(`[LogsModule] DOM elements found:`, {
            logsCurrentPage: !!this.elements.logsCurrentPage,
            logsTotalPages: !!this.elements.logsTotalPages,
            logsPrevPage: !!this.elements.logsPrevPage,
            logsNextPage: !!this.elements.logsNextPage
        });
        
        if (this.elements.logsCurrentPage) {
            this.elements.logsCurrentPage.textContent = this.currentPage;
            console.log(`[LogsModule] Updated logsCurrentPage to: ${this.currentPage}`);
        } else {
            console.warn('[LogsModule] logsCurrentPage element not found!');
        }
        
        if (this.elements.logsTotalPages) {
            this.elements.logsTotalPages.textContent = this.totalPages;
            console.log(`[LogsModule] Updated logsTotalPages to: ${this.totalPages}`);
        } else {
            console.warn('[LogsModule] logsTotalPages element not found!');
        }
        
        if (this.elements.logsPrevPage) {
            this.elements.logsPrevPage.disabled = this.currentPage <= 1;
        }
        
        if (this.elements.logsNextPage) {
            this.elements.logsNextPage.disabled = this.currentPage >= this.totalPages;
        }
    },
    
    // Reset logs to default state
    resetToDefaults: function() {
        this.currentLogApp = 'all';
        this.currentPage = 1; // Reset pagination
        
        const logAppSelect = document.getElementById('logAppSelect');
        if (logAppSelect && logAppSelect.value !== 'all') {
            logAppSelect.value = 'all';
        }
        
        const logLevelSelect = document.getElementById('logLevelSelect');
        if (logLevelSelect && logLevelSelect.value !== 'all') {
            logLevelSelect.value = 'all';
            this.filterLogsByLevel('all');
        }
        
        const logSearchInput = document.getElementById('logSearchInput');
        if (logSearchInput && logSearchInput.value) {
            logSearchInput.value = '';
            this.clearLogSearch();
        }
        
        console.log('[LogsModule] Reset logs to defaults: Everywhere, All levels, cleared search');
    }
};

console.log('[LOGS.JS] window.LogsModule defined successfully:', typeof window.LogsModule);
console.log('[LOGS.JS] LogsModule methods available:', Object.keys(window.LogsModule));

// Auto-initialize when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    if (window.LogsModule && typeof window.LogsModule.init === 'function') {
        window.LogsModule.init();
    }
});

// Also initialize immediately if DOM is already ready
if (document.readyState === 'loading') {
    // DOM is still loading, wait for DOMContentLoaded
} else {
    // DOM is already ready, initialize now
    if (window.LogsModule && typeof window.LogsModule.init === 'function') {
        window.LogsModule.init();
    }
} 

/* === modules/features/logs/logs-core.js === */
/**
 * Logs Module
 * Handles log streaming, searching, and filtering
 */

window.HuntarrLogs = {
    autoScrollWasEnabled: false,

    connectToLogs: function() {
        if (window.LogsModule && typeof window.LogsModule.connectToLogs === 'function') {
            window.LogsModule.connectToLogs();
        }
    },
    
    clearLogs: function() {
        if (window.LogsModule && typeof window.LogsModule.clearLogs === 'function') {
            window.LogsModule.clearLogs(true); // true = from user action (e.g. button/menu)
        }
    },
    
    insertLogInChronologicalOrder: function(newLogEntry) {
        if (!window.huntarrUI || !window.huntarrUI.elements.logsContainer || !newLogEntry) return;
        
        const logsContainer = window.huntarrUI.elements.logsContainer;
        const newTimestamp = this.parseLogTimestamp(newLogEntry);
        
        if (!newTimestamp) {
            logsContainer.appendChild(newLogEntry);
            return;
        }
        
        const existingEntries = Array.from(logsContainer.children);
        
        if (existingEntries.length === 0) {
            logsContainer.appendChild(newLogEntry);
            return;
        }
        
        let insertPosition = null;
        
        for (let i = 0; i < existingEntries.length; i++) {
            const existingTimestamp = this.parseLogTimestamp(existingEntries[i]);
            if (!existingTimestamp) continue;
            
            if (newTimestamp > existingTimestamp) {
                insertPosition = existingEntries[i];
                break;
            }
        }
        
        if (insertPosition) {
            logsContainer.insertBefore(newLogEntry, insertPosition);
        } else {
            logsContainer.appendChild(newLogEntry);
        }
    },
    
    parseLogTimestamp: function(logEntry) {
        if (!logEntry) return null;
        
        try {
            const dateSpan = logEntry.querySelector('.log-timestamp .date');
            const timeSpan = logEntry.querySelector('.log-timestamp .time');
            
            if (!dateSpan || !timeSpan) return null;
            
            const dateText = dateSpan.textContent.trim();
            const timeText = timeSpan.textContent.trim();
            
            if (!dateText || !timeText || dateText === '--' || timeText === '--:--:--') {
                return null;
            }
            
            const timestampString = `${dateText} ${timeText}`;
            const timestamp = new Date(timestampString);
            
            return isNaN(timestamp.getTime()) ? null : timestamp;
        } catch (error) {
            console.warn('[HuntarrLogs] Error parsing log timestamp:', error);
            return null;
        }
    },
    
    searchLogs: function() {
        if (!window.huntarrUI || !window.huntarrUI.elements.logsContainer || !window.huntarrUI.elements.logSearchInput) return;
        
        const logsContainer = window.huntarrUI.elements.logsContainer;
        const logSearchInput = window.huntarrUI.elements.logSearchInput;
        const searchText = logSearchInput.value.trim().toLowerCase();
        
        if (!searchText) {
            this.clearLogSearch();
            return;
        }
        
        if (window.huntarrUI.elements.clearSearchButton) {
            window.huntarrUI.elements.clearSearchButton.style.display = 'block';
        }
        
        const logEntries = Array.from(logsContainer.querySelectorAll('.log-table-row'));
        let matchCount = 0;
        
        const MAX_ENTRIES_TO_PROCESS = 300;
        const processedLogEntries = logEntries.slice(0, MAX_ENTRIES_TO_PROCESS);
        const remainingCount = Math.max(0, logEntries.length - MAX_ENTRIES_TO_PROCESS);
        
        processedLogEntries.forEach((entry) => {
            const entryText = entry.textContent.toLowerCase();
            
            if (entryText.includes(searchText)) {
                entry.style.display = '';
                matchCount++;
                this.simpleHighlightMatch(entry, searchText);
            } else {
                entry.style.display = 'none';
            }
        });
        
        if (remainingCount > 0) {
            logEntries.slice(MAX_ENTRIES_TO_PROCESS).forEach(entry => {
                const entryText = entry.textContent.toLowerCase();
                if (entryText.includes(searchText)) {
                    entry.style.display = '';
                    matchCount++;
                } else {
                    entry.style.display = 'none';
                }
            });
        }
        
        if (window.huntarrUI.elements.logSearchResults) {
            window.huntarrUI.elements.logSearchResults.textContent = `Found ${matchCount} matching log entries`;
            window.huntarrUI.elements.logSearchResults.style.display = 'block';
        }
        
        if (window.huntarrUI.elements.autoScrollCheckbox && window.huntarrUI.elements.autoScrollCheckbox.checked) {
            this.autoScrollWasEnabled = true;
            window.huntarrUI.elements.autoScrollCheckbox.checked = false;
        }
    },
    
    simpleHighlightMatch: function(logEntry, searchText) {
        if (searchText.length < 2) return;
        
        if (!logEntry.hasAttribute('data-original-html')) {
            logEntry.setAttribute('data-original-html', logEntry.innerHTML);
        }
        
        const html = logEntry.getAttribute('data-original-html');
        const escapedSearchText = searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(${escapedSearchText})`, 'gi');
        const newHtml = html.replace(regex, '<span class="search-highlight">$1</span>');
        
        logEntry.innerHTML = newHtml;
    },
    
    clearLogSearch: function() {
        if (!window.huntarrUI || !window.huntarrUI.elements.logsContainer) return;
        
        const logsContainer = window.huntarrUI.elements.logsContainer;
        
        if (window.huntarrUI.elements.logSearchInput) {
            window.huntarrUI.elements.logSearchInput.value = '';
        }
        
        if (window.huntarrUI.elements.clearSearchButton) {
            window.huntarrUI.elements.clearSearchButton.style.display = 'none';
        }
        
        if (window.huntarrUI.elements.logSearchResults) {
            window.huntarrUI.elements.logSearchResults.style.display = 'none';
        }
        
        const allLogEntries = logsContainer.querySelectorAll('.log-table-row');
        
        Array.from(allLogEntries).forEach(entry => {
            entry.style.display = '';
            if (entry.hasAttribute('data-original-html')) {
                entry.innerHTML = entry.getAttribute('data-original-html');
            }
        });
        
        if (this.autoScrollWasEnabled && window.huntarrUI.elements.autoScrollCheckbox) {
            window.huntarrUI.elements.autoScrollCheckbox.checked = true;
            this.autoScrollWasEnabled = false;
        }
    },

    filterLogsByLevel: function(selectedLevel) {
        if (!window.huntarrUI || !window.huntarrUI.elements.logsContainer) return;
        
        const logsContainer = window.huntarrUI.elements.logsContainer;
        const logEntries = logsContainer.querySelectorAll('.log-table-row');
        let visibleCount = 0;
        let totalCount = logEntries.length;
        
        logEntries.forEach(entry => {
            if (selectedLevel === 'all') {
                entry.style.display = '';
                entry.removeAttribute('data-hidden-by-filter');
                visibleCount++;
            } else {
                const levelBadge = entry.querySelector('.log-level-badge');
                if (levelBadge) {
                    const level = levelBadge.textContent.trim().toLowerCase();
                    if (level === selectedLevel.toLowerCase()) {
                        entry.style.display = '';
                        entry.removeAttribute('data-hidden-by-filter');
                        visibleCount++;
                    } else {
                        entry.style.display = 'none';
                        entry.setAttribute('data-hidden-by-filter', 'true');
                    }
                } else {
                    entry.style.display = 'none';
                    entry.setAttribute('data-hidden-by-filter', 'true');
                }
            }
        });
        
        if (window.huntarrUI.autoScroll && window.huntarrUI.elements.autoScrollCheckbox && window.huntarrUI.elements.autoScrollCheckbox.checked && visibleCount > 0) {
            setTimeout(() => {
                window.scrollTo({
                    top: 0,
                    behavior: 'smooth'
                });
            }, 100);
        }
        
        console.log(`[HuntarrLogs] Filtered logs by level '${selectedLevel}': showing ${visibleCount}/${totalCount} entries`);
    },

    applyFilterToSingleEntry: function(logEntry, selectedLevel) {
        if (!logEntry || selectedLevel === 'all') return;
        
        const levelBadge = logEntry.querySelector('.log-level-badge');
        if (levelBadge) {
            const level = levelBadge.textContent.trim().toLowerCase();
            if (level !== selectedLevel.toLowerCase()) {
                logEntry.style.display = 'none';
                logEntry.setAttribute('data-hidden-by-filter', 'true');
            }
        } else {
            logEntry.style.display = 'none';
            logEntry.setAttribute('data-hidden-by-filter', 'true');
        }
    }
};


/* === modules/features/instances.js === */
/**
 * Instances Module
 * Handles adding, removing, and testing application instances
 */

window.HuntarrInstances = {
    setupInstanceEventHandlers: function() {
        const settingsPanels = document.querySelectorAll('.app-settings-panel');
        settingsPanels.forEach(panel => {
            panel.addEventListener('addInstance', (e) => this.addAppInstance(e.detail.appName));
            panel.addEventListener('removeInstance', (e) => this.removeAppInstance(e.detail.appName, e.detail.instanceId));
            panel.addEventListener('testConnection', (e) => this.testInstanceConnection(e.detail.appName, e.detail.instanceId, e.detail.url, e.detail.apiKey));
        });
    },
    
    addAppInstance: function(appName) {
        const container = document.getElementById(`${appName}Settings`);
        if (!container || !window.huntarrUI) return;
        
        const currentSettings = window.huntarrUI.getFormSettings(appName);
        if (!currentSettings.instances) currentSettings.instances = [];
        
        if (currentSettings.instances.length >= 9) {
            if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification('Maximum of 9 instances allowed', 'error');
            return;
        }
        
        currentSettings.instances.push({
            name: `Instance ${currentSettings.instances.length + 1}`,
            api_url: '',
            api_key: '',
            enabled: true
        });
        
        if (typeof SettingsForms !== 'undefined') {
            const formFunc = SettingsForms[`generate${appName.charAt(0).toUpperCase()}${appName.slice(1)}Form`];
            if (typeof formFunc === 'function') formFunc(container, currentSettings);
            if (typeof SettingsForms.updateDurationDisplay === 'function') SettingsForms.updateDurationDisplay();
        }
        
        if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification('New instance added', 'success');
    },
    
    removeAppInstance: function(appName, instanceId) {
        const container = document.getElementById(`${appName}Settings`);
        if (!container || !window.huntarrUI) return;
        
        const currentSettings = window.huntarrUI.getFormSettings(appName);
        if (currentSettings.instances && instanceId >= 0 && instanceId < currentSettings.instances.length) {
            if (currentSettings.instances.length > 1) {
                const removedName = currentSettings.instances[instanceId].name;
                currentSettings.instances.splice(instanceId, 1);
                
                if (typeof SettingsForms !== 'undefined') {
                    const formFunc = SettingsForms[`generate${appName.charAt(0).toUpperCase()}${appName.slice(1)}Form`];
                    if (typeof formFunc === 'function') formFunc(container, currentSettings);
                    if (typeof SettingsForms.updateDurationDisplay === 'function') SettingsForms.updateDurationDisplay();
                }
                
                if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification(`Instance "${removedName}" removed`, 'info');
            } else {
                if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification('Cannot remove the last instance', 'error');
            }
        }
    },
    
    testInstanceConnection: function(appName, instanceId, url, apiKey) {
        instanceId = parseInt(instanceId, 10);
        const statusSpan = document.getElementById(`${appName}_instance_${instanceId}_status`);
        if (!statusSpan) return;
        
        statusSpan.textContent = 'Testing...';
        statusSpan.className = 'connection-status testing';
        
        if (!url || !apiKey) {
            statusSpan.textContent = 'Missing URL or API key';
            statusSpan.className = 'connection-status error';
            return;
        }
        
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            statusSpan.textContent = 'URL must start with http:// or https://';
            statusSpan.className = 'connection-status error';
            return;
        }
        
        const cleanUrl = window.HuntarrHelpers ? window.HuntarrHelpers.cleanUrlString(url) : url.trim();
        
        HuntarrUtils.fetchWithTimeout(`./api/${appName}/test-connection`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ api_url: cleanUrl, api_key: apiKey })
        })
        .then(response => {
            if (!response.ok) {
                return response.json().then(errorData => {
                    throw new Error(errorData.message || this.getConnectionErrorMessage(response.status));
                }).catch(() => {
                    throw new Error(this.getConnectionErrorMessage(response.status));
                });
            }
            return response.json();
        })
        .then(data => {
            if (data.success) {
                statusSpan.textContent = data.message || 'Connected';
                if (data.version) statusSpan.textContent += ` (v${data.version})`;
                statusSpan.className = 'connection-status success';
            } else {
                statusSpan.textContent = data.message || 'Failed';
                statusSpan.className = 'connection-status error';
            }
        })
        .catch(error => {
            console.error(`[HuntarrInstances] Error testing connection:`, error);
            let msg = error.message || 'Unknown error';
            if (msg.includes('Name or service not known')) msg = 'Unable to resolve hostname';
            else if (msg.includes('Connection refused')) msg = 'Connection refused';
            else if (msg.includes('timeout')) msg = 'Connection timed out';
            else if (msg.includes('401')) msg = 'Invalid API key';
            else if (msg.includes('404')) msg = 'URL endpoint not found';
            
            statusSpan.textContent = msg;
            statusSpan.className = 'connection-status error';
        });
    },
    
    getConnectionErrorMessage: function(status) {
        const errors = {
            400: 'Invalid request',
            401: 'Invalid API key',
            403: 'Access forbidden',
            404: 'Service not found',
            500: 'Server error',
            502: 'Bad gateway',
            503: 'Service unavailable',
            504: 'Gateway timeout'
        };
        return errors[status] || `Connection error (${status})`;
    }
};


/* === modules/features/stateful.js === */
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
        
        const hours = parseInt(hoursInput.value) || 72;
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
        const customHours = parseInt(hoursInput?.value) || 72;
        
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


/* === modules/features/backup-restore.js === */
/**
 * Backup and Restore functionality for Huntarr
 * Handles database backup creation, restoration, and management
 */

const BackupRestore = {
    initialized: false,
    backupSettings: {
        frequency: 3,
        retention: 3
    },

    initialize: function() {
        if (this.initialized) {
            console.log('[BackupRestore] Already initialized');
            return;
        }

        console.log('[BackupRestore] Initializing backup/restore functionality');
        
        this.bindEvents();
        this.loadSettings();
        this.loadBackupList();
        this.updateNextBackupTime();
        
        this.initialized = true;
        console.log('[BackupRestore] Initialization complete');
    },

    bindEvents: function() {
        // Backup frequency change
        const frequencyInput = document.getElementById('backup-frequency');
        if (frequencyInput) {
            frequencyInput.addEventListener('change', () => {
                this.backupSettings.frequency = parseInt(frequencyInput.value) || 3;
                this.saveSettings();
                this.updateNextBackupTime();
            });
        }

        // Backup retention change
        const retentionInput = document.getElementById('backup-retention');
        if (retentionInput) {
            retentionInput.addEventListener('change', () => {
                this.backupSettings.retention = parseInt(retentionInput.value) || 3;
                this.saveSettings();
            });
        }

        // Create manual backup
        const createBackupBtn = document.getElementById('create-backup-btn');
        if (createBackupBtn) {
            createBackupBtn.addEventListener('click', () => {
                this.createManualBackup();
            });
        }

        // Restore backup selection
        const restoreSelect = document.getElementById('restore-backup-select');
        if (restoreSelect) {
            restoreSelect.addEventListener('change', () => {
                this.handleRestoreSelection();
            });
        }

        // Restore confirmation input
        const restoreConfirmation = document.getElementById('restore-confirmation');
        if (restoreConfirmation) {
            restoreConfirmation.addEventListener('input', () => {
                this.validateRestoreConfirmation();
            });
        }

        // Restore button
        const restoreBtn = document.getElementById('restore-backup-btn');
        if (restoreBtn) {
            restoreBtn.addEventListener('click', () => {
                this.restoreBackup();
            });
        }

        // Delete confirmation input
        const deleteConfirmation = document.getElementById('delete-confirmation');
        if (deleteConfirmation) {
            deleteConfirmation.addEventListener('input', () => {
                this.validateDeleteConfirmation();
            });
        }

        // Delete database button
        const deleteBtn = document.getElementById('delete-database-btn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', () => {
                this.deleteDatabase();
            });
        }

        // Download backup selection
        const downloadSelect = document.getElementById('download-backup-select');
        if (downloadSelect) {
            downloadSelect.addEventListener('change', () => {
                this.handleDownloadSelection();
            });
        }

        // Download backup button
        const downloadBtn = document.getElementById('download-backup-btn');
        if (downloadBtn) {
            downloadBtn.addEventListener('click', () => {
                this.downloadBackup();
            });
        }

        // Upload backup file input
        const uploadFileInput = document.getElementById('upload-backup-file');
        if (uploadFileInput) {
            uploadFileInput.addEventListener('change', () => {
                this.handleUploadFileSelection();
            });
        }

        // Upload confirmation input
        const uploadConfirmation = document.getElementById('upload-confirmation');
        if (uploadConfirmation) {
            uploadConfirmation.addEventListener('input', () => {
                this.validateUploadConfirmation();
            });
        }

        // Upload button
        const uploadBtn = document.getElementById('upload-backup-btn');
        if (uploadBtn) {
            uploadBtn.addEventListener('click', () => {
                this.uploadBackup();
            });
        }
    },

    loadSettings: function() {
        console.log('[BackupRestore] Loading backup settings');
        
        fetch('./api/backup/settings')
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    this.backupSettings = {
                        frequency: data.settings.frequency || 3,
                        retention: data.settings.retention || 3
                    };
                    
                    // Update UI
                    const frequencyInput = document.getElementById('backup-frequency');
                    const retentionInput = document.getElementById('backup-retention');
                    
                    if (frequencyInput) frequencyInput.value = this.backupSettings.frequency;
                    if (retentionInput) retentionInput.value = this.backupSettings.retention;
                    
                    this.updateNextBackupTime();
                }
            })
            .catch(error => {
                console.error('[BackupRestore] Error loading settings:', error);
                this.showError('Failed to load backup settings');
            });
    },

    saveSettings: function() {
        console.log('[BackupRestore] Saving backup settings', this.backupSettings);
        
        fetch('./api/backup/settings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(this.backupSettings)
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                console.log('[BackupRestore] Settings saved successfully');
                this.showSuccess('Backup settings saved');
            } else {
                throw new Error(data.error || 'Failed to save settings');
            }
        })
        .catch(error => {
            console.error('[BackupRestore] Error saving settings:', error);
            this.showError('Failed to save backup settings');
        });
    },

    loadBackupList: function() {
        console.log('[BackupRestore] Loading backup list');
        
        const listContainer = document.getElementById('backup-list-container');
        const restoreSelect = document.getElementById('restore-backup-select');
        
        if (listContainer) {
            listContainer.innerHTML = '<div class="backup-list-loading"><i class="fas fa-spinner fa-spin"></i> Loading backup list...</div>';
        }
        
        if (restoreSelect) {
            restoreSelect.innerHTML = '<option value="">Loading available backups...</option>';
        }
        
        fetch('./api/backup/list')
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    this.renderBackupList(data.backups);
                    this.populateRestoreSelect(data.backups);
                } else {
                    throw new Error(data.error || 'Failed to load backups');
                }
            })
            .catch(error => {
                console.error('[BackupRestore] Error loading backup list:', error);
                if (listContainer) {
                    listContainer.innerHTML = '<div class="backup-list-loading">Error loading backup list</div>';
                }
                if (restoreSelect) {
                    restoreSelect.innerHTML = '<option value="">Error loading backups</option>';
                }
            });
    },

    renderBackupList: function(backups) {
        const listContainer = document.getElementById('backup-list-container');
        if (!listContainer) return;

        if (!backups || backups.length === 0) {
            listContainer.innerHTML = '<div class="backup-list-loading">No backups available</div>';
            return;
        }

        let html = '';
        backups.forEach(backup => {
            const date = new Date(backup.timestamp);
            const formattedDate = date.toLocaleString();
            const size = this.formatFileSize(backup.size);
            
            // Ensure backup ID is properly escaped for HTML attributes
            const escapedId = backup.id.replace(/'/g, "\\'");
            
            html += `
                <div class="backup-item" data-backup-id="${escapedId}">
                    <div class="backup-info">
                        <div class="backup-name">${backup.name}</div>
                        <div class="backup-details">
                            Created: ${formattedDate} | Size: ${size} | Type: ${backup.type || 'Manual'}
                        </div>
                    </div>
                    <div class="backup-actions">
                        <button class="delete-backup-btn" onclick="BackupRestore.deleteBackup('${escapedId}')">
                            <i class="fas fa-trash"></i> Delete
                        </button>
                    </div>
                </div>
            `;
        });

        listContainer.innerHTML = html;
    },

    populateRestoreSelect: function(backups) {
        const restoreSelect = document.getElementById('restore-backup-select');
        const downloadSelect = document.getElementById('download-backup-select');
        if (!restoreSelect || !downloadSelect) return;

        if (!backups || backups.length === 0) {
            restoreSelect.innerHTML = '<option value="">No backups available</option>';
            downloadSelect.innerHTML = '<option value="">No backups available</option>';
            return;
        }

        let html = '<option value="">Select a backup to restore...</option>';
        let downloadHtml = '<option value="">Select a backup to download...</option>';
        backups.forEach(backup => {
            const date = new Date(backup.timestamp);
            const formattedDate = date.toLocaleString();
            const size = this.formatFileSize(backup.size);
            
            html += `<option value="${backup.id}">${backup.name} - ${formattedDate} (${size})</option>`;
            downloadHtml += `<option value="${backup.id}">${backup.name} - ${formattedDate} (${size})</option>`;
        });

        restoreSelect.innerHTML = html;
        downloadSelect.innerHTML = downloadHtml;
    },

    updateNextBackupTime: function() {
        const nextBackupElement = document.getElementById('next-backup-time');
        if (!nextBackupElement) return;

        fetch('./api/backup/next-scheduled')
            .then(response => response.json())
            .then(data => {
                if (data.success && data.next_backup) {
                    const nextDate = new Date(data.next_backup);
                    nextBackupElement.innerHTML = `<i class="fas fa-clock"></i> ${nextDate.toLocaleString()}`;
                } else {
                    nextBackupElement.innerHTML = '<i class="fas fa-clock"></i> Not scheduled';
                }
            })
            .catch(error => {
                console.error('[BackupRestore] Error getting next backup time:', error);
                nextBackupElement.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Error loading schedule';
            });
    },

    createManualBackup: function() {
        console.log('[BackupRestore] Creating manual backup');
        
        const createBtn = document.getElementById('create-backup-btn');
        const progressContainer = document.getElementById('backup-progress');
        const progressFill = document.querySelector('.progress-fill');
        const progressText = document.querySelector('.progress-text');
        
        if (createBtn) createBtn.disabled = true;
        if (progressContainer) progressContainer.style.display = 'block';
        if (progressText) progressText.textContent = 'Creating backup...';
        
        // Animate progress bar
        let progress = 0;
        const progressInterval = setInterval(() => {
            progress += Math.random() * 15;
            if (progress > 90) progress = 90;
            if (progressFill) progressFill.style.width = progress + '%';
        }, 200);

        fetch('./api/backup/create', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                type: 'manual'
            })
        })
        .then(response => response.json())
        .then(data => {
            clearInterval(progressInterval);
            
            if (data.success) {
                if (progressFill) progressFill.style.width = '100%';
                if (progressText) progressText.textContent = 'Backup created successfully!';
                
                setTimeout(() => {
                    if (progressContainer) progressContainer.style.display = 'none';
                    if (progressFill) progressFill.style.width = '0%';
                }, 2000);
                
                this.showSuccess(`Backup created successfully: ${data.backup_name}`);
                this.loadBackupList(); // Refresh the list
            } else {
                throw new Error(data.error || 'Failed to create backup');
            }
        })
        .catch(error => {
            clearInterval(progressInterval);
            console.error('[BackupRestore] Error creating backup:', error);
            
            if (progressContainer) progressContainer.style.display = 'none';
            if (progressFill) progressFill.style.width = '0%';
            
            this.showError('Failed to create backup: ' + error.message);
        })
        .finally(() => {
            if (createBtn) createBtn.disabled = false;
        });
    },

    handleRestoreSelection: function() {
        const restoreSelect = document.getElementById('restore-backup-select');
        const confirmationGroup = document.getElementById('restore-confirmation-group');
        const actionGroup = document.getElementById('restore-action-group');
        
        if (!restoreSelect) return;
        
        if (restoreSelect.value) {
            if (confirmationGroup) confirmationGroup.style.display = 'block';
            if (actionGroup) actionGroup.style.display = 'block';
        } else {
            if (confirmationGroup) confirmationGroup.style.display = 'none';
            if (actionGroup) actionGroup.style.display = 'none';
        }
        
        this.validateRestoreConfirmation();
    },

    validateRestoreConfirmation: function() {
        const confirmationInput = document.getElementById('restore-confirmation');
        const restoreBtn = document.getElementById('restore-backup-btn');
        
        if (!confirmationInput || !restoreBtn) return;
        
        const isValid = confirmationInput.value.toUpperCase() === 'RESTORE';
        restoreBtn.disabled = !isValid;
    },

    restoreBackup: function() {
        const restoreSelect = document.getElementById('restore-backup-select');
        const confirmationInput = document.getElementById('restore-confirmation');
        
        if (!restoreSelect || !confirmationInput) return;
        
        const backupId = restoreSelect.value;
        const confirmation = confirmationInput.value.toUpperCase();
        
        if (!backupId || confirmation !== 'RESTORE') {
            this.showError('Please select a backup and type RESTORE to confirm');
            return;
        }

        var self = this;
        var doRestore = function() {
            console.log('[BackupRestore] Restoring backup:', backupId);
            const restoreBtn = document.getElementById('restore-backup-btn');
            if (restoreBtn) {
                restoreBtn.disabled = true;
                restoreBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Restoring...';
            }
            fetch('./api/backup/restore', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    backup_id: backupId
                })
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    self.showSuccess('Database restored successfully! Reloading in 3 seconds...');
                    setTimeout(() => {
                        window.location.reload();
                    }, 3000);
                } else {
                    throw new Error(data.error || 'Failed to restore backup');
                }
            })
            .catch(error => {
                console.error('[BackupRestore] Error restoring backup:', error);
                self.showError('Failed to restore backup: ' + error.message);
            })
            .finally(() => {
                if (restoreBtn) {
                    restoreBtn.disabled = false;
                    restoreBtn.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Restore Database';
                }
            });
        };
        if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
            window.HuntarrConfirm.show({ title: 'Restore Database', message: 'This will permanently overwrite your current database. Are you absolutely sure?', confirmLabel: 'Restore', onConfirm: doRestore });
        } else {
            if (!confirm('This will permanently overwrite your current database. Are you absolutely sure?')) return;
            doRestore();
        }
    },

    validateDeleteConfirmation: function() {
        const confirmationInput = document.getElementById('delete-confirmation');
        const actionGroup = document.getElementById('delete-action-group');
        const deleteBtn = document.getElementById('delete-database-btn');
        
        if (!confirmationInput || !actionGroup || !deleteBtn) return;
        
        const isValid = confirmationInput.value.toLowerCase() === 'huntarr';
        
        if (isValid) {
            actionGroup.style.display = 'block';
            deleteBtn.disabled = false;
        } else {
            actionGroup.style.display = 'none';
            deleteBtn.disabled = true;
        }
    },

    deleteDatabase: function() {
        const confirmationInput = document.getElementById('delete-confirmation');
        
        if (!confirmationInput || confirmationInput.value.toLowerCase() !== 'huntarr') {
            this.showError('Please type "huntarr" to confirm database deletion');
            return;
        }

        var self = this;
        var doDelete = function() {
            console.log('[BackupRestore] Deleting database');
            const deleteBtn = document.getElementById('delete-database-btn');
            if (deleteBtn) {
                deleteBtn.disabled = true;
                deleteBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Deleting...';
            }
            fetch('./api/backup/delete-database', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    self.showSuccess('Database deleted successfully! Redirecting to setup...');
                    setTimeout(() => {
                        window.location.href = './setup';
                    }, 3000);
                } else {
                    throw new Error(data.error || 'Failed to delete database');
                }
            })
            .catch(error => {
                console.error('[BackupRestore] Error deleting database:', error);
                self.showError('Failed to delete database: ' + error.message);
            })
            .finally(() => {
                if (deleteBtn) {
                    deleteBtn.disabled = false;
                    deleteBtn.innerHTML = '<i class="fas fa-trash-alt"></i> Delete Database';
                }
            });
        };
        if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
            window.HuntarrConfirm.show({ title: 'Delete Database', message: 'This will PERMANENTLY DELETE your entire Huntarr database. This action CANNOT be undone. Are you absolutely sure?', confirmLabel: 'Delete', onConfirm: doDelete });
        } else {
            if (!confirm('This will PERMANENTLY DELETE your entire Huntarr database. This action CANNOT be undone. Are you absolutely sure?')) return;
            doDelete();
        }
    },

    deleteBackup: function(backupId) {
        var self = this;
        var doDelete = function() {
        console.log('[BackupRestore] Deleting backup:', backupId);
        console.log('[BackupRestore] Backup ID type:', typeof backupId);
        console.log('[BackupRestore] Backup ID length:', backupId ? backupId.length : 0);

        // Add extra validation for backupId
        if (!backupId || typeof backupId !== 'string') {
            self.showError('Invalid backup ID provided for deletion');
            return;
        }

        // Additional debugging - check if the backupId contains special characters
        console.log('[BackupRestore] Backup ID raw:', backupId);
        console.log('[BackupRestore] Backup ID escaped:', encodeURIComponent(backupId));

        fetch('./api/backup/delete', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                backup_id: backupId
            })
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            if (data.success) {
                self.showSuccess('Backup deleted successfully');
                self.loadBackupList(); // Refresh the list
            } else {
                throw new Error(data.error || 'Failed to delete backup');
            }
        })
        .catch(error => {
            console.error('[BackupRestore] Error deleting backup:', error);
            self.showError('Failed to delete backup: ' + error.message);
        });
        };
        if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
            window.HuntarrConfirm.show({ title: 'Delete Backup', message: 'Are you sure you want to delete this backup? This action cannot be undone.', confirmLabel: 'Delete', onConfirm: doDelete });
        } else {
            if (!confirm('Are you sure you want to delete this backup? This action cannot be undone.')) return;
            doDelete();
        }
    },

    formatFileSize: function(bytes) {
        if (bytes === 0) return '0 Bytes';
        
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    },

    showSuccess: function(message) {
        if (window.huntarrUI && window.huntarrUI.showNotification) {
            window.huntarrUI.showNotification(message, 'success');
        } else {
            alert(message);
        }
    },

    showError: function(message) {
        if (window.huntarrUI && window.huntarrUI.showNotification) {
            window.huntarrUI.showNotification(message, 'error');
        } else {
            alert(message);
        }
    },

    // Download backup functions
    handleDownloadSelection: function() {
        const downloadSelect = document.getElementById('download-backup-select');
        const downloadBtn = document.getElementById('download-backup-btn');
        
        if (!downloadSelect || !downloadBtn) return;
        
        if (downloadSelect.value) {
            downloadBtn.disabled = false;
        } else {
            downloadBtn.disabled = true;
        }
    },

    downloadBackup: function() {
        const downloadSelect = document.getElementById('download-backup-select');
        
        if (!downloadSelect) return;
        
        const backupId = downloadSelect.value;
        
        if (!backupId) {
            this.showError('Please select a backup to download');
            return;
        }

        console.log('[BackupRestore] Downloading backup:', backupId);
        
        // Create a temporary link and trigger download
        const downloadUrl = `./api/backup/download/${backupId}`;
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = `${backupId}.zip`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        this.showSuccess('Download started');
    },

    // Upload backup functions
    handleUploadFileSelection: function() {
        const uploadFileInput = document.getElementById('upload-backup-file');
        const confirmationGroup = document.getElementById('upload-confirmation-group');
        const actionGroup = document.getElementById('upload-action-group');
        
        if (!uploadFileInput) return;
        
        if (uploadFileInput.files.length > 0) {
            if (confirmationGroup) confirmationGroup.style.display = 'block';
            if (actionGroup) actionGroup.style.display = 'block';
        } else {
            if (confirmationGroup) confirmationGroup.style.display = 'none';
            if (actionGroup) actionGroup.style.display = 'none';
        }
        
        this.validateUploadConfirmation();
    },

    validateUploadConfirmation: function() {
        const confirmationInput = document.getElementById('upload-confirmation');
        const uploadBtn = document.getElementById('upload-backup-btn');
        
        if (!confirmationInput || !uploadBtn) return;
        
        const isValid = confirmationInput.value.toUpperCase() === 'UPLOAD';
        uploadBtn.disabled = !isValid;
    },

    uploadBackup: function() {
        const uploadFileInput = document.getElementById('upload-backup-file');
        const confirmationInput = document.getElementById('upload-confirmation');
        
        if (!uploadFileInput || !confirmationInput) return;
        
        const file = uploadFileInput.files[0];
        const confirmation = confirmationInput.value.toUpperCase();
        
        if (!file) {
            this.showError('Please select a backup file to upload');
            return;
        }
        
        if (confirmation !== 'UPLOAD') {
            this.showError('Please type UPLOAD to confirm');
            return;
        }

        var self = this;
        var doUpload = function() {
            console.log('[BackupRestore] Uploading backup:', file.name);
            const uploadBtn = document.getElementById('upload-backup-btn');
            if (uploadBtn) {
                uploadBtn.disabled = true;
                uploadBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading and restoring...';
            }
            const formData = new FormData();
            formData.append('backup_file', file);
            fetch('./api/backup/upload', {
                method: 'POST',
                body: formData
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    self.showSuccess('Backup uploaded and restored successfully! Reloading in 3 seconds...');
                    setTimeout(() => {
                        window.location.reload();
                    }, 3000);
                } else {
                    throw new Error(data.error || 'Failed to upload backup');
                }
            })
            .catch(error => {
                console.error('[BackupRestore] Error uploading backup:', error);
                self.showError('Failed to upload backup: ' + error.message);
            })
            .finally(() => {
                if (uploadBtn) {
                    uploadBtn.disabled = false;
                    uploadBtn.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Upload and Restore Backup';
                }
            });
        };
        if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
            window.HuntarrConfirm.show({ title: 'Upload and Restore', message: 'This will permanently overwrite your current database with the uploaded backup. Are you absolutely sure?', confirmLabel: 'Upload', onConfirm: doUpload });
        } else {
            if (!confirm('This will permanently overwrite your current database with the uploaded backup. Are you absolutely sure?')) return;
            doUpload();
        }
    }
};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    // Don't auto-initialize - let the main UI handle it
    console.log('[BackupRestore] Module loaded');
});

/* === modules/features/hunt_manager.js === */
/**
 * Huntarr - Hunt Manager Module
 * Handles displaying and managing hunt history entries for all media apps
 */

const huntManagerModule = {
    // State
    currentApp: 'all',
    currentPage: 1,
    totalPages: 1,
    pageSize: 20,
    searchQuery: '',
    isLoading: false,
    
    // Cache for instance settings to avoid repeated API calls
    instanceSettingsCache: {},
    
    // DOM elements
    elements: {},
    
    // Initialize the hunt manager module
    init: function() {
        this.cacheElements();
        
        // Ensure UI matches state
        if (this.elements.pageSize) {
            this.elements.pageSize.value = this.pageSize;
        }
        
        this.setupEventListeners();
        
        // Initial load if hunt manager is active section
        if (huntarrUI && huntarrUI.currentSection === 'hunt-manager') {
            this.loadHuntHistory();
        }
    },
    
    // Cache DOM elements
    cacheElements: function() {
        this.elements = {
            section: document.getElementById('huntManagerSection'),
            appSelect: document.getElementById('huntManagerAppSelect'),
            searchInput: document.getElementById('huntManagerSearchInput'),
            searchButton: document.getElementById('huntManagerSearchButton'),
            pageSize: document.getElementById('huntManagerPageSize'),
            clearButton: document.getElementById('clearHuntManagerButton'),
            prevButton: document.getElementById('huntManagerPrevPage'),
            nextButton: document.getElementById('huntManagerNextPage'),
            currentPage: document.getElementById('huntManagerCurrentPage'),
            totalPages: document.getElementById('huntManagerTotalPages'),
            pageInfo: document.getElementById('huntManagerPageInfo'),
            tableBody: document.getElementById('huntManagerTableBody'),
            emptyState: document.getElementById('huntManagerEmptyState'),
            loading: document.getElementById('huntManagerLoading'),
            connectionStatus: document.getElementById('huntManagerConnectionStatus')
        };
    },
    
    // Update connection status indicator
    updateConnectionStatus: function(state, text) {
        if (!this.elements.connectionStatus) return;
        this.elements.connectionStatus.textContent = text || state;
        this.elements.connectionStatus.className = 'hm-status-' + state;
    },
    
    // Setup event listeners
    setupEventListeners: function() {
        if (!this.elements.appSelect) return;
        
        // App filter
        this.elements.appSelect.addEventListener('change', (e) => {
            this.currentApp = e.target.value;
            this.currentPage = 1;
            this.loadHuntHistory();
        });
        
        // Search functionality
        this.elements.searchButton.addEventListener('click', () => this.performSearch());
        this.elements.searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.performSearch();
            }
        });
        
        // Page size change
        this.elements.pageSize.addEventListener('change', (e) => {
            this.pageSize = parseInt(e.target.value);
            this.currentPage = 1;
            this.loadHuntHistory();
        });
        
        // Clear button
        this.elements.clearButton.addEventListener('click', () => this.clearHuntHistory());
        
        // Pagination
        this.elements.prevButton.addEventListener('click', () => this.previousPage());
        this.elements.nextButton.addEventListener('click', () => this.nextPage());
        
        // Hunt item links - delegated event listener
        document.addEventListener('click', (e) => {
            if (e.target.matches('.hunt-item-link') || e.target.closest('.hunt-item-link')) {
                const link = e.target.matches('.hunt-item-link') ? e.target : e.target.closest('.hunt-item-link');
                const appType = link.dataset.app;
                const instanceName = link.dataset.instance;
                const itemId = link.dataset.itemId;
                const title = link.textContent; // Use the text content as the title
                
                console.log('Hunt item clicked:', { appType, instanceName, itemId, title });
 
                // Process clicks for Sonarr, Radarr, Lidarr (open in *arr), or Movie Hunt (navigate to Movie Hunt)
                if ((appType === 'sonarr' || appType === 'radarr' || appType === 'lidarr') && instanceName) {
                    huntManagerModule.openAppInstance(appType, instanceName, itemId, title);
                } else if ((appType === 'sonarr' || appType === 'radarr' || appType === 'lidarr') && window.huntarrUI) {
                    window.huntarrUI.switchSection('apps');
                    window.location.hash = '#apps';
                    console.log(`Navigated to apps section for ${appType}`);
                } else if (appType === 'movie_hunt' && window.huntarrUI) {
                    window.huntarrUI.switchSection('movie-hunt-home');
                    window.location.hash = '#movie-hunt-home';
                    console.log('Navigated to Movie Hunt');
                } else if (appType === 'tv_hunt' && window.huntarrUI) {
                    window.huntarrUI.switchSection('tv-hunt-collection');
                    window.location.hash = '#tv-hunt-collection';
                    console.log('Navigated to TV Hunt');
                } else {
                    console.log(`Clicking disabled for ${appType}`);
                }
            }
        });
    },
    
    // Perform search
    performSearch: function() {
        this.searchQuery = this.elements.searchInput.value.trim();
        this.currentPage = 1;
        this.loadHuntHistory();
    },
    
    // Clear hunt history
    clearHuntHistory: function() {
        const appDisplayNames = { movie_hunt: 'Movie Hunt', tv_hunt: 'TV Hunt', sonarr: 'Sonarr', radarr: 'Radarr', lidarr: 'Lidarr', readarr: 'Readarr', whisparr: 'Whisparr V2', eros: 'Whisparr V3' };
        const appName = this.currentApp === 'all' ? 'all apps' : (appDisplayNames[this.currentApp] || this.currentApp);
        const msg = `Are you sure you want to clear hunt history for ${appName}? This action cannot be undone.`;
        const self = this;
        const doClear = function() {
            HuntarrUtils.fetchWithTimeout(`./api/hunt-manager/${self.currentApp}`, {
            method: 'DELETE'
        })
        .then(response => response.json().then(data => ({ response, data })))
        .then(({ response, data }) => {
            if (response.ok) {
                console.log(`Cleared hunt history for ${self.currentApp}`);
                self.loadHuntHistory();
                if (huntarrUI && huntarrUI.showNotification) {
                    huntarrUI.showNotification(`Hunt history cleared for ${appName}`, 'success');
                }
            } else {
                throw new Error(data.error || 'Failed to clear hunt history');
            }
        })
        .catch(error => {
            console.error(`Error clearing hunt history:`, error);
            if (huntarrUI && huntarrUI.showNotification) {
                huntarrUI.showNotification(`Error clearing hunt history: ${error.message}`, 'error');
            }
        });
        };
        if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
            window.HuntarrConfirm.show({ title: 'Clear Hunt History', message: msg, confirmLabel: 'Clear', onConfirm: doClear });
        } else {
            if (!confirm(msg)) return;
            doClear();
        }
    },
    
    // Load hunt history
    loadHuntHistory: function() {
        if (this.isLoading) return;
        
        this.isLoading = true;
        this.showLoading(true);
        this.updateConnectionStatus('loading', 'Loading...');
        
        const params = new URLSearchParams({
            page: this.currentPage,
            page_size: this.pageSize
        });
        
        if (this.searchQuery) {
            params.append('search', this.searchQuery);
        }
        
        HuntarrUtils.fetchWithTimeout(`./api/hunt-manager/${this.currentApp}?${params.toString()}`)
            .then(response => response.json())
            .then(data => {
                if (data.entries !== undefined) {
                    this.displayHuntHistory(data);
                    this.updateConnectionStatus('connected', 'Connected');
                } else {
                    throw new Error(data.error || 'Invalid response format');
                }
            })
            .catch(error => {
                console.error('Error loading hunt history:', error);
                this.showError(`Error loading hunt history: ${error.message}`);
                this.updateConnectionStatus('error', 'Connection error');
            })
            .finally(() => {
                this.isLoading = false;
                this.showLoading(false);
            });
    },
    
    // Display hunt history
    displayHuntHistory: function(data) {
        this.totalPages = data.total_pages || 1;
        this.currentPage = data.current_page || 1;
        
        // Update pagination info
        this.elements.currentPage.textContent = this.currentPage;
        this.elements.totalPages.textContent = this.totalPages;
        
        // Update pagination buttons
        this.elements.prevButton.disabled = this.currentPage <= 1;
        this.elements.nextButton.disabled = this.currentPage >= this.totalPages;
        
        // Clear table body
        this.elements.tableBody.innerHTML = '';
        
        if (data.entries.length === 0) {
            this.showEmptyState(true);
            return;
        }
        
        this.showEmptyState(false);
        
        // Populate table
        data.entries.forEach(entry => {
            const row = this.createHuntHistoryRow(entry);
            this.elements.tableBody.appendChild(row);
        });
    },
    
    // Create hunt history table row
    createHuntHistoryRow: function(entry) {
        const row = document.createElement('tr');
        
        // Processed info with link (if available)
        const processedInfoCell = document.createElement('td');
        processedInfoCell.className = 'col-info';
        processedInfoCell.innerHTML = this.formatProcessedInfo(entry);
        
        // Operation type
        const operationCell = document.createElement('td');
        operationCell.className = 'col-op';
        operationCell.innerHTML = this.formatOperation(entry.operation_type);
        
        // Media ID
        const idCell = document.createElement('td');
        idCell.className = 'col-id';
        idCell.textContent = entry.media_id;
        
        // App instance (formatted as "App Name (Instance Name)")
        const instanceCell = document.createElement('td');
        instanceCell.className = 'col-instance';
        const appDisplayNames = { whisparr: 'Whisparr V2', eros: 'Whisparr V3', movie_hunt: 'Movie Hunt', tv_hunt: 'TV Hunt' };
        const appName = appDisplayNames[entry.app_type] || (entry.app_type.charAt(0).toUpperCase() + entry.app_type.slice(1).replace(/_/g, ' '));
        instanceCell.textContent = `${appName} (${entry.instance_name || 'Default'})`;
        
        // How long ago
        const timeCell = document.createElement('td');
        timeCell.className = 'col-time';
        timeCell.textContent = entry.how_long_ago;
        
        row.appendChild(processedInfoCell);
        row.appendChild(operationCell);
        row.appendChild(idCell);
        row.appendChild(instanceCell);
        row.appendChild(timeCell);
        
        return row;
    },
    
    // Format processed info
    formatProcessedInfo: function(entry) {
        // Sonarr, Radarr, Lidarr: clickable to open in *arr app; Movie Hunt / TV Hunt: clickable to go to section
        const isArrClickable = (entry.app_type === 'sonarr' || entry.app_type === 'radarr' || entry.app_type === 'lidarr') && entry.instance_name;
        const isMovieHuntClickable = entry.app_type === 'movie_hunt';
        const isTVHuntClickable = entry.app_type === 'tv_hunt';
        const isClickable = isArrClickable || isMovieHuntClickable || isTVHuntClickable;
        const escapeAttr = (s) => { if (s == null) return ''; return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
        const dataAttributes = isClickable ?
            `data-app="${escapeAttr(entry.app_type)}" data-instance="${escapeAttr(entry.instance_name || '')}" data-item-id="${escapeAttr(entry.media_id || '')}"` :
            `data-app="${escapeAttr(entry.app_type)}"`;
        let title = `${entry.app_type} (${entry.instance_name || 'Default'})`;
        if (isArrClickable) title = `Click to open in ${entry.app_type} (${entry.instance_name})`;
        else if (isMovieHuntClickable) title = 'Click to open Movie Hunt';
        else if (isTVHuntClickable) title = 'Click to open TV Hunt';

        const linkClass = isClickable ? 'hunt-item-link' : '';
        const titleAttr = title.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        let html = `<div class="hunt-info-wrapper">
            <span class="${linkClass}" ${dataAttributes} title="${titleAttr}">${this.escapeHtml(entry.processed_info)}</span>`;
        
        if (entry.discovered) {
            html += ' <span class="discovery-badge"><i class="fas fa-search"></i> Discovered</span>';
        }
        
        html += '</div>';
        
        return html;
    },
    
    // Format operation type
    formatOperation: function(operationType) {
        const operationMap = {
            'missing': { text: 'Missing', class: 'operation-missing' },
            'upgrade': { text: 'Upgrade', class: 'operation-upgrade' },
            'import': { text: 'Import', class: 'operation-upgrade' }
        };
        
        const operation = operationMap[(operationType || '').toLowerCase()] || { text: (operationType || 'Unknown'), class: 'operation-unknown' };
        return `<span class="operation-badge ${operation.class}">${operation.text}</span>`;
    },
    
    // Utility to escape HTML
    escapeHtml: function(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },
    
    // Show/hide loading state
    showLoading: function(show) {
        if (this.elements.loading) {
            this.elements.loading.style.display = show ? 'block' : 'none';
        }
    },
    
    // Show/hide empty state
    showEmptyState: function(show) {
        if (this.elements.emptyState) {
            this.elements.emptyState.style.display = show ? 'block' : 'none';
        }
    },
    
    // Show error message
    showError: function(message) {
        console.error('Hunt Manager Error:', message);
        if (huntarrUI && huntarrUI.showNotification) {
            huntarrUI.showNotification(message, 'error');
        }
    },
    
    // Navigation methods
    previousPage: function() {
        if (this.currentPage > 1) {
            this.currentPage--;
            this.loadHuntHistory();
        }
    },
    
    nextPage: function() {
        if (this.currentPage < this.totalPages) {
            this.currentPage++;
            this.loadHuntHistory();
        }
    },
    
    // Refresh hunt history (called when section becomes active)
    refresh: function() {
        this.loadHuntHistory();
    },
    
    // Generate direct link to item in *arr application (7.7.5 logic)
    generateDirectLink: function(appType, instanceUrl, itemId, title) {
        if (!instanceUrl) return null;
        
        // Ensure URL doesn't end with slash and remove any localhost prefix
        let baseUrl = instanceUrl.replace(/\/$/, '');
        
        // Remove localhost:9705 prefix if present (this happens when the instance URL gets prepended)
        baseUrl = baseUrl.replace(/^.*localhost:\d+\//, '');
        
        // Ensure we have http:// or https:// prefix
        if (!baseUrl.match(/^https?:\/\//)) {
            baseUrl = 'http://' + baseUrl;
        }
        
        // Generate appropriate path based on app type
        let path;
        switch (appType.toLowerCase()) {
            case 'sonarr':
                // Sonarr uses title-based slugs in format: /series/show-name-year
                if (title) {
                    // Extract series title with year from hunt manager format
                    // Example: "The Twilight Zone (1985) - Season 1 (contains 2 missing episodes)"
                    // We want: "The Twilight Zone (1985)"
                    let seriesTitle = title;
                    
                    // Remove everything after " - " (season/episode info)
                    if (seriesTitle.includes(' - ')) {
                        seriesTitle = seriesTitle.split(' - ')[0];
                    }
                    
                    // Generate Sonarr-compatible slug
                    const slug = seriesTitle
                        .toLowerCase()
                        .trim()
                        // Replace parentheses with hyphens: "(1985)" becomes "-1985"
                        .replace(/\s*\((\d{4})\)\s*/g, '-$1')
                        // Remove other special characters except hyphens and spaces
                        .replace(/[^\w\s-]/g, '')
                        // Replace multiple spaces with single space
                        .replace(/\s+/g, ' ')
                        // Replace spaces with hyphens
                        .replace(/\s/g, '-')
                        // Remove multiple consecutive hyphens
                        .replace(/-+/g, '-')
                        // Remove leading/trailing hyphens
                        .replace(/^-|-$/g, '');
                    
                    console.log('Sonarr slug generation:', {
                        originalTitle: title,
                        extractedSeriesTitle: seriesTitle,
                        generatedSlug: slug
                    });
                    
                    path = `/series/${slug}`;
                } else {
                    path = `/series/${itemId}`;
                }
                break;
            case 'radarr':
                // Radarr uses numeric IDs
                path = `/movie/${itemId}`;
                break;
            case 'lidarr':
                // Lidarr uses foreignAlbumId (MusicBrainz UUID)
                path = `/album/${itemId}`;
                break;
            case 'readarr':
                path = `/author/${itemId}`;
                break;
            case 'whisparr':
            case 'eros':
                path = `/series/${itemId}`;
                break;
            default:
                console.warn(`Unknown app type for direct link: ${appType}`);
                return null;
        }
        
        return `${baseUrl}${path}`;
    },

    // Get instance settings for an app
    getInstanceSettings: async function(appType, instanceName) {
        try {
            const response = await fetch(`./api/settings/${appType}`, {
                credentials: 'include',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const settingsData = await response.json();
            console.log('Raw settings data:', settingsData);
            
            // Check if this is a settings object with instances array
            if (settingsData && settingsData.instances && Array.isArray(settingsData.instances)) {
                // Match by display name (inst.name) OR instance_id (for entries stored with instance_id)
                const instance = settingsData.instances.find(inst => 
                    inst.name === instanceName || inst.instance_id === instanceName
                );
                
                if (instance) {
                    console.log('Found instance:', instance);
                    return {
                        api_url: instance.api_url || instance.url
                    };
                }
            }
            // Fallback for legacy single-instance settings
            else if (settingsData && settingsData.api_url && instanceName === 'Default') {
                console.log('Using legacy single-instance settings');
                return {
                    api_url: settingsData.api_url
                };
            }
            
            console.warn(`Instance "${instanceName}" not found in settings`);
            return null;
        } catch (error) {
            console.error(`Error fetching ${appType} settings:`, error);
            return null;
        }
    },
    
    // Open external app instance with direct linking (7.7.5 logic)
    openAppInstance: function(appType, instanceName, itemId = null, title = null) {
        console.log(`Opening ${appType} instance: ${instanceName} with itemId: ${itemId}, title: ${title}`);
        
        this.getInstanceSettings(appType, instanceName)
            .then(instanceSettings => {
                console.log('Instance settings retrieved:', instanceSettings);
                
                if (instanceSettings && instanceSettings.api_url) {
                    let targetUrl;
 
                    // If we have item details, try to create a direct link for supported apps
                    if (itemId && ['sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros'].includes(appType.toLowerCase())) {
                        targetUrl = this.generateDirectLink(appType, instanceSettings.api_url, itemId, title);
                        console.log('Generated direct link:', targetUrl);
                    }
                    
                    // Fallback to base URL if direct link creation fails
                    if (!targetUrl) {
                        let baseUrl = instanceSettings.api_url.replace(/\/$/, '');
                        baseUrl = baseUrl.replace(/^.*localhost:\d+\//, '');
                        
                        if (!baseUrl.match(/^https?:\/\//)) {
                            baseUrl = 'http://' + baseUrl;
                        }
                        
                        targetUrl = baseUrl;
                        console.log('Using fallback base URL:', targetUrl);
                    }
                    
                    // Open the external instance in a new tab
                    console.log(`About to open: ${targetUrl}`);
                    window.open(targetUrl, '_blank');
                    console.log(`Opened ${appType} instance ${instanceName} at ${targetUrl}`);
                } else {
                    console.warn(`Could not find URL for ${appType} instance: ${instanceName}`);
                    console.warn('Instance settings:', instanceSettings);
                    // Fallback to Apps section
                    if (window.huntarrUI) {
                        window.huntarrUI.switchSection('apps');
                        window.location.hash = '#apps';
                    }
                }
            })
            .catch(error => {
                console.error(`Error fetching ${appType} settings:`, error);
                // Fallback to Apps section
                if (window.huntarrUI) {
                    window.huntarrUI.switchSection('apps');
                    window.location.hash = '#apps';
                }
            });
    },

    // Open Sonarr instance (legacy wrapper)
    openSonarrInstance: function(instanceName) {
        this.openAppInstance('sonarr', instanceName);
    }
};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    huntManagerModule.init();
});

// Make module available globally
window.huntManagerModule = huntManagerModule; 

/* === modules/features/scheduling.js === */
/**
 * Scheduling functionality for Huntarr
 * Implements time-based enable/disable and API cap scheduling.
 *
 * Instance identification uses stable instance_id values (not array indices).
 * Schedule `app` field format:
 *   "global"          → all apps, all instances
 *   "sonarr::all"     → all sonarr instances
 *   "sonarr::<id>"    → specific sonarr instance by instance_id
 */

window.huntarrSchedules = window.huntarrSchedules || {
    global: [],
    sonarr: [],
    radarr: [],
    lidarr: [],
    readarr: [],
    whisparr: [],
    eros: [],
    movie_hunt: [],
    tv_hunt: []
};

(function() {
    const schedules = window.huntarrSchedules;

    function capitalizeFirst(s) {
        return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
    }

    // ---------------------------------------------------------------
    // Initialization
    // ---------------------------------------------------------------

    document.addEventListener('DOMContentLoaded', function() {
        initScheduler();
    });

    function initScheduler() {
        console.debug('[Scheduler] Initializing');
        loadSchedules();
        loadAppInstances();
        setupEventListeners();
        initializeTimeInputs();
        loadServerTimezone();
    }

    function setupEventListeners() {
        if (window.huntarrSchedulerInitialized) return;

        const addBtn = document.getElementById('addScheduleButton');
        if (addBtn) {
            addBtn.addEventListener('click', addSchedule);
        }

        document.addEventListener('click', function(e) {
            const deleteBtn = e.target.closest('.delete-schedule');
            if (deleteBtn) {
                e.preventDefault();
                e.stopPropagation();
                const scheduleId = deleteBtn.dataset.id;
                const appType = deleteBtn.dataset.appType || 'global';

                if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
                    window.HuntarrConfirm.show({
                        title: 'Delete Schedule',
                        message: 'Are you sure you want to delete this schedule?',
                        confirmLabel: 'Delete',
                        onConfirm: function() { deleteSchedule(scheduleId, appType); }
                    });
                } else {
                    if (confirm('Are you sure you want to delete this schedule?')) {
                        deleteSchedule(scheduleId, appType);
                    }
                }
            }
        });

        window.huntarrSchedulerInitialized = true;
    }

    // ---------------------------------------------------------------
    // Load app instances into BOTH the App Type and Instance dropdowns
    // ---------------------------------------------------------------

    async function loadAppInstances() {
        const appTypeSelect = document.getElementById('scheduleAppType');
        const instanceSelect = document.getElementById('scheduleInstance');
        if (!appTypeSelect || !instanceSelect) return;

        try {
            // Fetch standard app settings, Movie Hunt instances, and TV Hunt instances in parallel (cache-bust for fresh data)
            const _ts = Date.now();
            const [settingsResp, movieHuntResp, tvHuntResp] = await Promise.all([
                HuntarrUtils.fetchWithTimeout(`./api/settings?t=${_ts}`),
                HuntarrUtils.fetchWithTimeout(`./api/movie-hunt/instances?t=${_ts}`).catch(function() { return null; }),
                HuntarrUtils.fetchWithTimeout(`./api/tv-hunt/instances?t=${_ts}`).catch(function() { return null; })
            ]);

            if (settingsResp.ok) {
                const settings = await settingsResp.json();
                if (window.huntarrUI) {
                    window.huntarrUI.originalSettings = window.huntarrUI.originalSettings || {};
                    const appTypes = ['sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros'];
                    appTypes.forEach(function(at) {
                        if (settings[at]) {
                            window.huntarrUI.originalSettings[at] = window.huntarrUI.originalSettings[at] || {};
                            window.huntarrUI.originalSettings[at].instances = settings[at].instances || [];
                        }
                    });
                }
            }

            // Cache Movie Hunt instances separately (they come from a different API)
            if (movieHuntResp && movieHuntResp.ok) {
                const mhData = await movieHuntResp.json();
                window._movieHuntInstances = Array.isArray(mhData.instances) ? mhData.instances : [];
                console.debug('[Scheduler] Movie Hunt instances loaded:', window._movieHuntInstances.length);
            } else {
                window._movieHuntInstances = [];
            }

            // Cache TV Hunt instances separately (they come from a different API)
            if (tvHuntResp && tvHuntResp.ok) {
                const thData = await tvHuntResp.json();
                window._tvHuntInstances = Array.isArray(thData.instances) ? thData.instances : [];
                console.debug('[Scheduler] TV Hunt instances loaded:', window._tvHuntInstances.length);
            } else {
                window._tvHuntInstances = [];
            }

            // Trigger instance dropdown population based on current app selection
            populateInstanceDropdown();
            console.debug('[Scheduler] Instance dropdowns populated from API');
        } catch (err) {
            console.warn('[Scheduler] Could not fetch settings for instances', err);
            window._movieHuntInstances = window._movieHuntInstances || [];
            window._tvHuntInstances = window._tvHuntInstances || [];
            populateInstanceDropdown();
        }
    }

    function populateInstanceDropdown() {
        const appTypeSelect = document.getElementById('scheduleAppType');
        const instanceSelect = document.getElementById('scheduleInstance');
        if (!appTypeSelect || !instanceSelect) return;

        const appType = appTypeSelect.value;
        instanceSelect.innerHTML = '';

        if (appType === 'global') {
            instanceSelect.innerHTML = '<option value="all">All Instances</option>';
            instanceSelect.disabled = true;
            updateHiddenApp();
            return;
        }

        instanceSelect.disabled = false;

        const allOpt = document.createElement('option');
        allOpt.value = 'all';
        allOpt.textContent = 'All Instances';
        instanceSelect.appendChild(allOpt);

        // Movie Hunt uses a dedicated instance list (numeric IDs from DB)
        if (appType === 'movie_hunt') {
            var mhInstances = window._movieHuntInstances || [];
            mhInstances.forEach(function(inst) {
                if (!inst || typeof inst !== 'object') return;
                var opt = document.createElement('option');
                opt.value = String(inst.id);
                opt.textContent = inst.name || ('Instance ' + inst.id);
                instanceSelect.appendChild(opt);
            });
            updateHiddenApp();
            return;
        }

        // TV Hunt uses a dedicated instance list (numeric IDs from DB)
        if (appType === 'tv_hunt') {
            var thInstances = window._tvHuntInstances || [];
            thInstances.forEach(function(inst) {
                if (!inst || typeof inst !== 'object') return;
                var opt = document.createElement('option');
                opt.value = String(inst.id);
                opt.textContent = inst.name || ('Instance ' + inst.id);
                instanceSelect.appendChild(opt);
            });
            updateHiddenApp();
            return;
        }

        // Standard apps: get instances from settings cache
        const settings = (window.huntarrUI && window.huntarrUI.originalSettings) ? window.huntarrUI.originalSettings : {};
        const appSettings = settings[appType] || {};
        const instances = Array.isArray(appSettings.instances) ? appSettings.instances : [];

        instances.forEach(function(inst, idx) {
            if (!inst || typeof inst !== 'object') return;
            const opt = document.createElement('option');
            opt.value = inst.instance_id || String(idx);
            opt.textContent = inst.name || inst.instance_name || ('Instance ' + (idx + 1));
            instanceSelect.appendChild(opt);
        });

        updateHiddenApp();
    }

    function updateHiddenApp() {
        const appTypeSelect = document.getElementById('scheduleAppType');
        const instanceSelect = document.getElementById('scheduleInstance');
        const hiddenApp = document.getElementById('scheduleApp');
        if (!appTypeSelect || !instanceSelect || !hiddenApp) return;

        const appType = appTypeSelect.value;
        const instanceVal = instanceSelect.value;

        if (appType === 'global') {
            hiddenApp.value = 'global';
        } else if (instanceVal === 'all') {
            hiddenApp.value = appType + '::all';
        } else {
            hiddenApp.value = appType + '::' + instanceVal;
        }
    }

    // Wire up cascading dropdowns (backup for if inline script doesn't run)
    document.addEventListener('DOMContentLoaded', function() {
        const appTypeSelect = document.getElementById('scheduleAppType');
        const instanceSelect = document.getElementById('scheduleInstance');
        if (appTypeSelect) {
            appTypeSelect.removeEventListener('change', populateInstanceDropdown);
            appTypeSelect.addEventListener('change', populateInstanceDropdown);
        }
        if (instanceSelect) {
            instanceSelect.removeEventListener('change', updateHiddenApp);
            instanceSelect.addEventListener('change', updateHiddenApp);
        }
    });

    // ---------------------------------------------------------------
    // Load / Save schedules
    // ---------------------------------------------------------------

    function loadSchedules() {
        HuntarrUtils.fetchWithTimeout('./api/scheduler/load')
            .then(function(response) {
                if (!response.ok) throw new Error('Failed to load schedules');
                return response.json();
            })
            .then(function(data) {
                Object.keys(schedules).forEach(function(key) {
                    if (Array.isArray(data[key])) {
                        schedules[key] = data[key].map(function(s) {
                            var timeObj = s.time;
                            if (typeof s.time === 'string') {
                                var parts = s.time.split(':').map(Number);
                                timeObj = { hour: parts[0], minute: parts[1] || 0 };
                            } else if (!s.time) {
                                timeObj = { hour: 0, minute: 0 };
                            }
                            return {
                                id: s.id || String(Date.now() + Math.random() * 1000),
                                time: timeObj,
                                days: Array.isArray(s.days) ? s.days : [],
                                action: s.action || 'enable',
                                app: s.app || 'global',
                                appType: s.appType || key,
                                enabled: s.enabled !== false
                            };
                        });
                    } else {
                        schedules[key] = [];
                    }
                });
                renderSchedules();
            })
            .catch(function(error) {
                console.error('[Scheduler] Error loading schedules:', error);
                Object.keys(schedules).forEach(function(key) { schedules[key] = []; });
                renderSchedules();
            });
    }

    function saveSchedules() {
        var payload = {};
        Object.keys(schedules).forEach(function(key) { payload[key] = []; });

        Object.entries(schedules).forEach(function(entry) {
            var appType = entry[0], list = entry[1];
            if (!Array.isArray(list)) return;
            payload[appType] = list.map(function(s) {
                var daysArr = [];
                if (Array.isArray(s.days)) {
                    daysArr = s.days;
                } else if (s.days && typeof s.days === 'object') {
                    Object.entries(s.days).forEach(function(d) {
                        if (d[1] === true) daysArr.push(d[0]);
                    });
                }
                return {
                    id: s.id,
                    time: s.time,
                    days: daysArr,
                    action: s.action,
                    app: s.app || 'global',
                    enabled: s.enabled !== false,
                    appType: appType
                };
            });
        });

        HuntarrUtils.fetchWithTimeout('./api/scheduler/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.success) {
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('Schedule saved successfully', 'success');
                }
            } else {
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('Failed to save schedule', 'error');
                }
            }
        })
        .catch(function(err) {
            console.error('[Scheduler] Save error:', err);
            if (window.huntarrUI && window.huntarrUI.showNotification) {
                window.huntarrUI.showNotification('Failed to save schedule', 'error');
            }
        });
    }

    // ---------------------------------------------------------------
    // Add / Delete
    // ---------------------------------------------------------------

    function addSchedule() {
        var hour = parseInt(document.getElementById('scheduleHour').value);
        var minute = parseInt(document.getElementById('scheduleMinute').value);
        var action = document.getElementById('scheduleAction').value;

        var dayIds = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
        var daysArr = [];
        dayIds.forEach(function(d) {
            if (document.getElementById('day-' + d).checked) daysArr.push(d);
        });

        if (isNaN(hour) || isNaN(minute)) {
            if (window.huntarrUI && window.huntarrUI.showNotification) {
                window.huntarrUI.showNotification('Please enter a valid time.', 'error');
            } else { alert('Please enter a valid time.'); }
            return;
        }
        if (daysArr.length === 0) return;

        // Read the combined app value from the hidden select
        var app = document.getElementById('scheduleApp').value || 'global';

        // Determine which appType bucket to store in
        var appType = 'global';
        if (app !== 'global') {
            var colonIdx = app.indexOf('::');
            var dashIdx = app.indexOf('-');
            if (colonIdx > 0) {
                appType = app.substring(0, colonIdx);
            } else if (dashIdx > 0) {
                appType = app.substring(0, dashIdx);
            }
        }

        if (!schedules[appType]) schedules[appType] = [];

        schedules[appType].push({
            id: Date.now().toString(),
            time: { hour: hour, minute: minute },
            days: daysArr,
            action: action,
            app: app,
            enabled: true
        });

        saveSchedules();
        renderSchedules();
    }

    function deleteSchedule(scheduleId, appType) {
        if (!schedules[appType]) return;
        var idx = schedules[appType].findIndex(function(s) { return s.id === scheduleId; });
        if (idx === -1) return;
        schedules[appType].splice(idx, 1);
        saveSchedules();
        renderSchedules();
    }

    // ---------------------------------------------------------------
    // Render
    // ---------------------------------------------------------------

    function renderSchedules() {
        var container = document.getElementById('schedulesContainer');
        var emptyMsg = document.getElementById('noSchedulesMessage');
        if (!container || !emptyMsg) return;

        container.innerHTML = '';

        var all = [];
        Object.entries(schedules).forEach(function(entry) {
            var appType = entry[0], list = entry[1];
            if (!Array.isArray(list)) return;
            list.forEach(function(s) {
                all.push(Object.assign({}, s, { appType: s.appType || appType }));
            });
        });

        if (all.length === 0) {
            container.style.display = 'none';
            emptyMsg.style.display = 'block';
            return;
        }

        container.style.display = 'block';
        emptyMsg.style.display = 'none';

        all.sort(function(a, b) {
            var at = (a.time.hour || 0) * 60 + (a.time.minute || 0);
            var bt = (b.time.hour || 0) * 60 + (b.time.minute || 0);
            return at - bt;
        });

        all.forEach(function(s) {
            var el = document.createElement('div');
            el.className = 'schedule-item';

            var timeStr = String(s.time.hour).padStart(2, '0') + ':' + String(s.time.minute).padStart(2, '0');

            // Days
            var daysText = 'Daily';
            if (Array.isArray(s.days)) {
                if (s.days.length === 7) { daysText = 'Daily'; }
                else if (s.days.length === 0) { daysText = 'None'; }
                else { daysText = s.days.map(function(d) { return d.substring(0,1).toUpperCase() + d.substring(1,3); }).join(', '); }
            }

            // Action
            var actionText = s.action || '';
            var actionClass = '';
            if (actionText === 'resume' || actionText === 'enable') { actionText = 'Enable'; actionClass = 'action-enable'; }
            else if (actionText === 'pause' || actionText === 'disable') { actionText = 'Disable'; actionClass = 'action-disable'; }
            else if (actionText.startsWith('api-')) { actionText = 'API Limit: ' + actionText.split('-')[1]; }

            // App / Instance display
            var appText = formatAppDisplay(s.app);

            el.innerHTML =
                '<div class="schedule-item-time">' + timeStr + '</div>' +
                '<div class="schedule-item-days">' + daysText + '</div>' +
                '<div class="schedule-item-action ' + actionClass + '">' + actionText + '</div>' +
                '<div class="schedule-item-app">' + appText + '</div>' +
                '<div class="schedule-item-actions">' +
                    '<button class="delete-schedule" data-id="' + s.id + '" data-app-type="' + s.appType + '"><i class="fas fa-trash"></i></button>' +
                '</div>';

            container.appendChild(el);
        });
    }

    function formatAppDisplay(appValue) {
        if (!appValue || appValue === 'global') return 'All Apps (Global)';

        var base, instanceId;

        // New format: app::id
        if (appValue.indexOf('::') > 0) {
            var parts = appValue.split('::');
            base = parts[0];
            instanceId = parts[1];
        }
        // Legacy format: app-id (but NOT movie_hunt/tv_hunt which use underscores)
        else if (appValue.indexOf('-') > 0 && appValue.indexOf('movie_hunt') !== 0 && appValue.indexOf('tv_hunt') !== 0) {
            var dashParts = appValue.split('-', 2);
            base = dashParts[0];
            instanceId = dashParts[1];
        } else {
            return formatAppLabel(appValue);
        }

        var label = formatAppLabel(base);

        if (instanceId === 'all') return 'All ' + label + ' Instances';

        // Movie Hunt: resolve from dedicated instance cache
        if (base === 'movie_hunt') {
            var mhInstances = window._movieHuntInstances || [];
            for (var m = 0; m < mhInstances.length; m++) {
                if (String(mhInstances[m].id) === instanceId) {
                    return label + ' — ' + (mhInstances[m].name || 'Instance ' + mhInstances[m].id);
                }
            }
            return label + ' — Instance ' + instanceId;
        }

        // TV Hunt: resolve from dedicated instance cache
        if (base === 'tv_hunt') {
            var thInstances = window._tvHuntInstances || [];
            for (var t = 0; t < thInstances.length; t++) {
                if (String(thInstances[t].id) === instanceId) {
                    return label + ' — ' + (thInstances[t].name || 'Instance ' + thInstances[t].id);
                }
            }
            return label + ' — Instance ' + instanceId;
        }

        // Standard apps: try to resolve instance name from settings
        var settings = (window.huntarrUI && window.huntarrUI.originalSettings) ? window.huntarrUI.originalSettings : {};
        var instances = (settings[base] && settings[base].instances) ? settings[base].instances : [];

        // Search by instance_id first
        for (var i = 0; i < instances.length; i++) {
            if (instances[i] && instances[i].instance_id === instanceId) {
                return label + ' — ' + (instances[i].name || instances[i].instance_name || 'Instance ' + (i+1));
            }
        }

        // Fallback: try as numeric index (legacy)
        if (/^\d+$/.test(instanceId)) {
            var idx = parseInt(instanceId, 10);
            if (instances[idx]) {
                return label + ' — ' + (instances[idx].name || instances[idx].instance_name || 'Instance ' + (idx+1));
            }
        }

        return label + ' — Instance ' + instanceId;
    }

    function formatAppLabel(appName) {
        if (appName === 'movie_hunt') return 'Movie Hunt';
        if (appName === 'tv_hunt') return 'TV Hunt';
        return capitalizeFirst(appName);
    }

    // ---------------------------------------------------------------
    // Timezone
    // ---------------------------------------------------------------

    var serverTimeInterval = null;

    function loadServerTimezone() {
        HuntarrUtils.fetchWithTimeout('./api/settings')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var tz = (data.general && (data.general.effective_timezone || data.general.timezone)) || 'UTC';

                if (serverTimeInterval) clearInterval(serverTimeInterval);

                var tzSpan = document.getElementById('serverTimezone');
                if (tzSpan) tzSpan.textContent = tz.replace(/_/g, ' ');

                updateServerTime(tz);
                updateTimeInputsWithServerTime(tz);

                serverTimeInterval = setInterval(function() { updateServerTime(tz); }, 60000);
            })
            .catch(function() {
                updateServerTime('UTC');
            });
    }

    function updateServerTime(tz) {
        var el = document.getElementById('serverCurrentTime');
        if (!el) return;
        try {
            el.textContent = new Date().toLocaleTimeString('en-US', {
                timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit'
            });
        } catch (e) { el.textContent = '--:--'; }
    }

    function updateTimeInputsWithServerTime(tz) {
        var h = document.getElementById('scheduleHour');
        var m = document.getElementById('scheduleMinute');
        if (!h || !m) return;
        try {
            var now = new Date();
            var st = new Date(now.toLocaleString('en-US', { timeZone: tz }));
            h.value = st.getHours();
            m.value = Math.floor(st.getMinutes() / 5) * 5;
        } catch (e) { /* ignore */ }
    }

    function initializeTimeInputs() {
        var now = new Date();
        var h = document.getElementById('scheduleHour');
        var m = document.getElementById('scheduleMinute');
        if (h) h.value = now.getHours();
        if (m) m.value = Math.floor(now.getMinutes() / 5) * 5;
    }

    // ---------------------------------------------------------------
    // Global exports
    // ---------------------------------------------------------------

    window.refreshSchedulingTimezone = loadServerTimezone;
    window.refreshSchedulingInstances = loadAppInstances;

    // Auto-refresh scheduling instances when any instance changes anywhere in the app
    document.addEventListener('huntarr:instances-changed', function() {
        loadAppInstances();
    });

})();


/* === modules/features/history.js === */
/**
 * Huntarr - History Module
 * Handles displaying and managing history entries for all media apps
 */

const historyModule = {
    // State
    currentApp: 'all',
    currentPage: 1,
    totalPages: 1,
    pageSize: 20,
    searchQuery: '',
    isLoading: false,
    
    // Cache for instance settings to avoid repeated API calls
    instanceSettingsCache: {},
    
    // DOM elements
    elements: {},
    
    // Initialize the history module
    init: function() {
        this.cacheElements();
        this.setupEventListeners();
        
        // Initial load if history is active section
        if (huntarrUI && huntarrUI.currentSection === 'history') {
            this.loadHistory();
        }
    },
    
    // Cache DOM elements
    cacheElements: function() {
        this.elements = {
            // History dropdown
            historyOptions: document.querySelectorAll('.history-option'),
            currentHistoryApp: document.getElementById('current-history-app'),
            historyDropdownBtn: document.querySelector('.history-dropdown-btn'),
            historyDropdownContent: document.querySelector('.history-dropdown-content'),
            
            // Table and containers
            historyTable: document.querySelector('.history-table'),
            historyTableBody: document.getElementById('historyTableBody'),
            historyContainer: document.querySelector('.history-container'),
            
            // Controls
            historySearchInput: document.getElementById('historySearchInput'),
            historySearchButton: document.getElementById('historySearchButton'),
            historyPageSize: document.getElementById('historyPageSize'),
            clearHistoryButton: document.getElementById('clearHistoryButton'),
            
            // Pagination
            historyPrevPage: document.getElementById('historyPrevPage'),
            historyNextPage: document.getElementById('historyNextPage'),
            historyCurrentPage: document.getElementById('historyCurrentPage'),
            historyTotalPages: document.getElementById('historyTotalPages'),
            
            // State displays
            historyEmptyState: document.getElementById('historyEmptyState'),
            historyLoading: document.getElementById('historyLoading')
        };
    },
    
    // Set up event listeners
    setupEventListeners: function() {
        // App selection (native select)
        const historyAppSelect = document.getElementById('historyAppSelect');
        if (historyAppSelect) {
            historyAppSelect.addEventListener('change', (e) => {
                this.handleHistoryAppChange(e.target.value);
            });
        }
        // App selection (legacy click)
        this.elements.historyOptions.forEach(option => {
            option.addEventListener('click', e => this.handleHistoryAppChange(e));
        });
        
        // Search
        if (this.elements.historySearchButton) {
            this.elements.historySearchButton.addEventListener('click', () => this.handleSearch());
        }
        if (this.elements.historySearchInput) {
            this.elements.historySearchInput.addEventListener('keypress', e => {
                if (e.key === 'Enter') this.handleSearch();
            });
        }
        
        // Page size
        if (this.elements.historyPageSize) {
            this.elements.historyPageSize.addEventListener('change', () => this.handlePageSizeChange());
        }
        
        // Clear history
        if (this.elements.clearHistoryButton) {
            this.elements.clearHistoryButton.addEventListener('click', () => this.handleClearHistory());
        }
        
        // Pagination
        if (this.elements.historyPrevPage) {
            this.elements.historyPrevPage.addEventListener('click', () => this.handlePagination('prev'));
        }
        if (this.elements.historyNextPage) {
            this.elements.historyNextPage.addEventListener('click', () => this.handlePagination('next'));
        }
    },
    
    // Load history data when section becomes active
    loadHistory: function() {
        if (this.elements.historyContainer) {
            this.fetchHistoryData();
        }
    },
    
    // Handle app selection changes
    handleHistoryAppChange: function(eOrValue) {
        let selectedApp;
        if (typeof eOrValue === 'string') {
            selectedApp = eOrValue;
        } else if (eOrValue && eOrValue.target) {
            selectedApp = eOrValue.target.getAttribute('data-app');
            eOrValue.preventDefault();
        }
        if (!selectedApp || selectedApp === this.currentApp) return;
        // Update UI (for legacy click)
        if (this.elements.historyOptions) {
            this.elements.historyOptions.forEach(option => {
                option.classList.remove('active');
                if (option.getAttribute('data-app') === selectedApp) {
                    option.classList.add('active');
                }
            });
        }
        // Update dropdown text (if present)
        if (this.elements.currentHistoryApp) {
            const displayName = selectedApp.charAt(0).toUpperCase() + selectedApp.slice(1);
            this.elements.currentHistoryApp.textContent = displayName;
        }
        // Reset pagination
        this.currentPage = 1;
        // Update state and fetch data
        this.currentApp = selectedApp;
        this.fetchHistoryData();
    },
    
    // Handle search
    handleSearch: function() {
        const newSearchQuery = this.elements.historySearchInput.value.trim();
        
        // Only fetch if search query changed
        if (newSearchQuery !== this.searchQuery) {
            this.searchQuery = newSearchQuery;
            this.currentPage = 1; // Reset to first page
            this.fetchHistoryData();
        }
    },
    
    // Handle page size change
    handlePageSizeChange: function() {
        const newPageSize = parseInt(this.elements.historyPageSize.value);
        if (newPageSize !== this.pageSize) {
            this.pageSize = newPageSize;
            this.currentPage = 1; // Reset to first page
            this.fetchHistoryData();
        }
    },
    
    // Handle pagination
    handlePagination: function(direction) {
        if (direction === 'prev' && this.currentPage > 1) {
            this.currentPage--;
            this.fetchHistoryData();
        } else if (direction === 'next' && this.currentPage < this.totalPages) {
            this.currentPage++;
            this.fetchHistoryData();
        }
    },
    
    // Handle clear history
    handleClearHistory: function() {
        var msg = 'Are you sure you want to clear ' + (this.currentApp === 'all' ? 'all history' : this.currentApp + ' history') + '?';
        var self = this;
        if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
            window.HuntarrConfirm.show({ title: 'Clear History', message: msg, confirmLabel: 'Clear', onConfirm: function() { self.clearHistory(); } });
        } else {
            if (confirm(msg)) self.clearHistory();
        }
    },
    
    // Fetch history data from API
    fetchHistoryData: function() {
        this.setLoading(true);
        
        // Construct URL with parameters
        let url = `/api/history/${this.currentApp}?page=${this.currentPage}&page_size=${this.pageSize}`;
        if (this.searchQuery) {
            url += `&search=${encodeURIComponent(this.searchQuery)}`;
        }
        
        HuntarrUtils.fetchWithTimeout(url)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! Status: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                this.totalPages = data.total_pages;
                this.renderHistoryData(data);
                this.updatePaginationUI();
                this.setLoading(false);
            })
            .catch(error => {
                console.error('Error fetching history data:', error);
                this.showError('Failed to load history data. Please try again later.');
                this.setLoading(false);
            });
    },
    
    // Clear history
    clearHistory: function() {
        this.setLoading(true);
        
        HuntarrUtils.fetchWithTimeout(`./api/history/${this.currentApp}`, {
            method: 'DELETE',
        })
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! Status: ${response.status}`);
                }
                return response.json();
            })
            .then(() => {
                // Reload data
                this.fetchHistoryData();
            })
            .catch(error => {
                console.error('Error clearing history:', error);
                this.showError('Failed to clear history. Please try again later.');
                this.setLoading(false);
            });
    },
    
    // Render history data to table
    renderHistoryData: function(data) {
        const tableBody = this.elements.historyTableBody;
        tableBody.innerHTML = '';
        
        if (!data.entries || data.entries.length === 0) {
            this.showEmptyState();
            return;
        }
        
        // Hide empty state
        this.elements.historyEmptyState.style.display = 'none';
        this.elements.historyTable.style.display = 'table';
        
        // Process entries and create rows
        this.renderHistoryEntries(data.entries);
    },
    
    // Render individual history entries (async to handle link creation)
    renderHistoryEntries: async function(entries) {
        const tableBody = this.elements.historyTableBody;
        
        // Process entries in batches to avoid overwhelming the UI
        const batchSize = 10;
        for (let i = 0; i < entries.length; i += batchSize) {
            const batch = entries.slice(i, i + batchSize);
            
            // Process this batch
            const batchPromises = batch.map(entry => this.createHistoryRow(entry));
            const batchRows = await Promise.all(batchPromises);
            
            // Add rows to table
            batchRows.forEach(row => {
                if (row) tableBody.appendChild(row);
            });
            
            // Small delay between batches to keep UI responsive
            if (i + batchSize < entries.length) {
                await new Promise(resolve => setTimeout(resolve, 10));
            }
        }
    },
    
    // Create a single history row
    createHistoryRow: async function(entry) {
        const row = document.createElement('tr');
        
        // Format the instance name to include app type (capitalize first letter of app type)
        const appType = entry.app_type ? entry.app_type.charAt(0).toUpperCase() + entry.app_type.slice(1) : '';
        const formattedInstance = appType ? `${appType} - ${entry.instance_name}` : entry.instance_name;
        
        // Build the row content piece by piece to ensure ID has no wrapping elements
        const processedInfoCell = document.createElement('td');
        
        // Create info icon with hover tooltip functionality
        const infoIcon = document.createElement('i');
        infoIcon.className = 'fas fa-info-circle info-hover-icon';
        // Ensure the icon has the right content and is centered
        infoIcon.style.textAlign = 'center';
        
        // Create clickable title (async)
        const titleSpan = await this.createClickableLink(entry);
        
        // Create tooltip element for JSON data
        const tooltip = document.createElement('div');
        tooltip.className = 'json-tooltip';
        tooltip.style.display = 'none';
        
        // Format the JSON data for display
        let jsonData = {};
        try {
            // Extract available fields from the entry for the tooltip
            jsonData = {
                title: entry.processed_info,
                id: entry.id,
                app: entry.app_type || 'Unknown',
                instance: entry.instance_name || 'Default',
                date: entry.date_time_readable,
                operation: entry.operation_type,
                // Add any additional fields that might be useful
                details: entry.details || {}
            };
        } catch (e) {
            jsonData = { error: 'Could not parse JSON data', title: entry.processed_info };
        }
        
        // Create formatted JSON content
        const pre = document.createElement('pre');
        pre.className = 'json-content';
        pre.textContent = JSON.stringify(jsonData, null, 2);
        tooltip.appendChild(pre);
        
        // Add the tooltip to the document body for fixed positioning
        document.body.appendChild(tooltip);
        
        // Add hover events with proper positioning
        infoIcon.addEventListener('mouseenter', (e) => {
            const iconRect = infoIcon.getBoundingClientRect();
            
            // Position tooltip near the icon using fixed positioning
            tooltip.style.left = (iconRect.right + 10) + 'px';
            tooltip.style.top = iconRect.top + 'px';
            
            // Adjust if tooltip would go off screen
            const tooltipWidth = 350;
            if (iconRect.right + tooltipWidth + 10 > window.innerWidth) {
                tooltip.style.left = (iconRect.left - tooltipWidth - 10) + 'px';
            }
            
            // Adjust if tooltip would go off bottom of screen
            const tooltipHeight = 300; // max-height from CSS
            if (iconRect.top + tooltipHeight > window.innerHeight) {
                tooltip.style.top = (window.innerHeight - tooltipHeight - 10) + 'px';
            }
            
            tooltip.style.display = 'block';
        });
        
        // Add mouse leave event to hide tooltip
        infoIcon.addEventListener('mouseleave', () => {
            tooltip.style.display = 'none';
        });
        
        // Also hide tooltip when mouse enters the tooltip itself and then leaves
        tooltip.addEventListener('mouseleave', () => {
            tooltip.style.display = 'none';
        });
        
        // Create a container div to hold both icon and title on the same line
        const lineContainer = document.createElement('div');
        lineContainer.className = 'title-line-container';
        // Additional inline styles to ensure proper alignment
        lineContainer.style.display = 'flex';
        lineContainer.style.alignItems = 'flex-start';
        
        // Append icon and title to the container
        lineContainer.appendChild(infoIcon);
        lineContainer.appendChild(document.createTextNode(' ')); // Add space
        lineContainer.appendChild(titleSpan);
        
        // Add the container to the cell
        processedInfoCell.appendChild(lineContainer);
        
        const operationTypeCell = document.createElement('td');
        operationTypeCell.innerHTML = this.formatOperationType(entry.operation_type);
        
        // Create a plain text ID cell with no styling
        const idCell = document.createElement('td');
        idCell.className = 'plain-id';
        idCell.textContent = entry.id; // Use textContent to ensure no HTML parsing
        
        const instanceCell = document.createElement('td');
        instanceCell.innerHTML = this.escapeHtml(formattedInstance);
        
        const timeAgoCell = document.createElement('td');
        timeAgoCell.innerHTML = this.escapeHtml(entry.how_long_ago);
        
        // Clear any existing content and append the cells
        row.innerHTML = '';
        row.appendChild(processedInfoCell);
        row.appendChild(operationTypeCell);
        row.appendChild(idCell);
        row.appendChild(instanceCell);
        row.appendChild(timeAgoCell);
        
        return row;
    },
    
    // Update pagination UI
    updatePaginationUI: function() {
        this.elements.historyCurrentPage.textContent = this.currentPage;
        this.elements.historyTotalPages.textContent = this.totalPages;
        
        // Enable/disable pagination buttons
        this.elements.historyPrevPage.disabled = this.currentPage <= 1;
        this.elements.historyNextPage.disabled = this.currentPage >= this.totalPages;
    },
    
    // Show empty state
    showEmptyState: function() {
        this.elements.historyTable.style.display = 'none';
        this.elements.historyEmptyState.style.display = 'flex';
    },
    
    // Show error
    showError: function(message) {
        // Use huntarrUI's notification system if available
        if (typeof huntarrUI !== 'undefined' && typeof huntarrUI.showNotification === 'function') {
            huntarrUI.showNotification(message, 'error');
        } else {
            if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification(message, 'error');
            else alert(message);
        }
    },
    
    // Set loading state
    setLoading: function(isLoading) {
        this.isLoading = isLoading;
        
        if (isLoading) {
            this.elements.historyLoading.style.display = 'flex';
            this.elements.historyTable.style.display = 'none';
            this.elements.historyEmptyState.style.display = 'none';
        } else {
            this.elements.historyLoading.style.display = 'none';
        }
    },
    
    // Helper function to escape HTML
    escapeHtml: function(text) {
        if (text === null || text === undefined) return '';
        
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        
        return String(text).replace(/[&<>"']/g, function(m) { return map[m]; });
    },
    
    // Helper function to format operation type with gradient styling
    formatOperationType: function(operationType) {
        switch (operationType) {
            case 'missing':
                return '<span class="operation-status missing">Missing</span>';
            case 'upgrade':
                return '<span class="operation-status upgrade">Upgrade</span>';
            case 'warning':
                return '<span class="operation-status warning">Warning</span>';
            case 'error':
                return '<span class="operation-status error">Error</span>';
            case 'success':
                return '<span class="operation-status success">Success</span>';
            default:
                return operationType ? this.escapeHtml(operationType.charAt(0).toUpperCase() + operationType.slice(1)) : 'Unknown';
        }
    },
    
    // Get instance settings for a specific app and instance name
    getInstanceSettings: async function(appType, instanceName) {
        const cacheKey = `${appType}-${instanceName}`;
        
        // Return cached result if available
        if (this.instanceSettingsCache[cacheKey]) {
            return this.instanceSettingsCache[cacheKey];
        }
        
        try {
            const response = await HuntarrUtils.fetchWithTimeout(`./api/settings/${appType}`);
            if (!response.ok) {
                throw new Error(`Failed to fetch ${appType} settings`);
            }
            
            const settings = await response.json();
            
            // Find the matching instance by name
            if (settings.instances && Array.isArray(settings.instances)) {
                const instance = settings.instances.find(inst => inst.name === instanceName);
                if (instance && instance.api_url) {
                    // Cache the result
                    this.instanceSettingsCache[cacheKey] = instance;
                    return instance;
                }
            }
            
            // Cache null result to avoid repeated failed attempts
            this.instanceSettingsCache[cacheKey] = null;
            return null;
        } catch (error) {
            console.error(`Error fetching instance settings for ${appType}-${instanceName}:`, error);
            // Cache null result
            this.instanceSettingsCache[cacheKey] = null;
            return null;
        }
    },
    
    // Generate direct link to item in *arr application
    generateDirectLink: function(appType, instanceUrl, itemId, title) {
        if (!instanceUrl) return null;
        
        // Ensure URL doesn't end with slash and remove any localhost prefix
        let baseUrl = instanceUrl.replace(/\/$/, '');
        
        // Remove localhost:9705 prefix if present (this happens when the instance URL gets prepended)
        baseUrl = baseUrl.replace(/^.*localhost:\d+\//, '');
        
        // Ensure we have http:// or https:// prefix
        if (!baseUrl.match(/^https?:\/\//)) {
            baseUrl = 'http://' + baseUrl;
        }
        
        // Generate appropriate path based on app type
        let path;
        switch (appType.toLowerCase()) {
            case 'sonarr':
                // Sonarr uses title-based slugs, not IDs
                if (title) {
                    // Extract series title from the full title (remove season info, episode info, etc.)
                    let seriesTitle = title;
                    
                    // Remove season and episode information
                    seriesTitle = seriesTitle.replace(/\s*-\s*S\d+.*$/i, ''); // Remove "- S13 - COMPLETE SEASON PACK"
                    seriesTitle = seriesTitle.replace(/\s*-\s*Season\s+\d+.*$/i, ''); // Remove "- Season 13..."
                    seriesTitle = seriesTitle.replace(/\s*-\s*\w\d+\w\d+.*$/i, ''); // Remove "- S01E01..."
                    
                    // Handle country codes in parentheses - convert (US) to -us, etc.
                    seriesTitle = seriesTitle.replace(/\s*\(([A-Z]{2,3})\)$/i, '-$1'); // Convert (US) to -US
                    
                    // Remove other parenthetical info like years
                    seriesTitle = seriesTitle.replace(/\s*\(\d{4}\).*$/, ''); // Remove (2023) and anything after
                    seriesTitle = seriesTitle.replace(/\s*\([^)]*\)$/, ''); // Remove other parenthetical info
                    
                    // Convert to slug format (lowercase, replace spaces and special chars with dashes)
                    const slug = seriesTitle
                        .toLowerCase()
                        .trim()
                        .replace(/[^\w\s-]/g, '') // Remove special characters except dashes and spaces
                        .replace(/\s+/g, '-') // Replace spaces with dashes
                        .replace(/-+/g, '-') // Replace multiple dashes with single dash
                        .replace(/^-|-$/g, ''); // Remove leading/trailing dashes
                    
                    path = `/series/${slug}`;
                } else {
                    // Fallback to ID if no title available
                    path = `/series/${itemId}`;
                }
                break;
            case 'radarr':
                // Radarr also uses title-based slugs
                if (title) {
                    // Extract movie title (remove year and other info)
                    let movieTitle = title.replace(/\s*\(\d{4}\).*$/, ''); // Remove (2023) and anything after
                    
                    const slug = movieTitle
                        .toLowerCase()
                        .trim()
                        .replace(/[^\w\s-]/g, '')
                        .replace(/\s+/g, '-')
                        .replace(/-+/g, '-')
                        .replace(/^-|-$/g, '');
                    
                    path = `/movie/${slug}`;
                } else {
                    path = `/movie/${itemId}`;
                }
                break;
            case 'lidarr':
                path = `/artist/${itemId}`;
                break;
            case 'readarr':
                path = `/author/${itemId}`;
                break;
            case 'whisparr':
            case 'eros':
                path = `/series/${itemId}`;
                break;
            default:
                console.warn(`Unknown app type for direct link: ${appType}`);
                return null;
        }
        
        return `${baseUrl}${path}`;
    },
    
    // Create clickable link element
    createClickableLink: async function(entry) {
        const titleSpan = document.createElement('span');
        titleSpan.className = 'processed-title';
        titleSpan.style.wordBreak = 'break-word';
        titleSpan.style.whiteSpace = 'normal';
        titleSpan.style.overflow = 'visible';
        
        // Only create links for Sonarr entries
        if (entry.app_type && entry.app_type.toLowerCase() === 'sonarr') {
            // Try to get instance settings and create link
            try {
                const instanceSettings = await this.getInstanceSettings(entry.app_type, entry.instance_name);
                
                if (instanceSettings && instanceSettings.api_url) {
                    const directLink = this.generateDirectLink(entry.app_type, instanceSettings.api_url, entry.id, entry.processed_info);
                    
                    if (directLink) {
                        // Create clickable link
                        const linkElement = document.createElement('a');
                        linkElement.href = directLink;
                        linkElement.target = '_blank';
                        linkElement.rel = 'noopener noreferrer';
                        linkElement.className = 'history-direct-link';
                        linkElement.textContent = entry.processed_info;
                        linkElement.title = `Open in ${entry.app_type.charAt(0).toUpperCase() + entry.app_type.slice(1)}`;
                        
                        titleSpan.appendChild(linkElement);
                        return titleSpan;
                    }
                }
            } catch (error) {
                console.warn(`Could not create direct link for ${entry.app_type}-${entry.instance_name}:`, error);
            }
        }
        
        // Fallback to plain text for all non-Sonarr apps or if link creation fails
        titleSpan.textContent = entry.processed_info;
        return titleSpan;
    }
};

// Initialize when huntarrUI is ready
document.addEventListener('DOMContentLoaded', () => {
    historyModule.init();
    
    // Connect with main app
    if (typeof huntarrUI !== 'undefined') {
        // Add loadHistory to the section switch handler
        const originalSwitchSection = huntarrUI.switchSection;
        
        huntarrUI.switchSection = function(section) {
            // Call original function
            originalSwitchSection.call(huntarrUI, section);
            
            // Load history data when switching to history section
            if (section === 'history') {
                historyModule.loadHistory();
            }
        };
    }
});


/* === modules/features/user.js === */
class UserModule {
    constructor() {
        this.initializeEventListeners();
        this.loadUserData();
    }

    initializeEventListeners() {
        // Username change
        document.getElementById('saveUsername').addEventListener('click', () => this.saveUsername());
        
        // Password change
        document.getElementById('savePassword').addEventListener('click', () => this.savePassword());
        
        // Two-Factor Authentication
        document.getElementById('enableTwoFactor').addEventListener('click', () => this.enableTwoFactor());
        document.getElementById('verifyTwoFactor').addEventListener('click', () => this.verifyTwoFactor());
        document.getElementById('disableTwoFactor').addEventListener('click', () => this.disableTwoFactor());
        
        // Recovery Key
        document.getElementById('generateRecoveryKey').addEventListener('click', () => this.generateRecoveryKey());
        document.getElementById('copyRecoveryKey').addEventListener('click', () => this.copyRecoveryKey());
        
        // Plex Account
        document.getElementById('linkPlexAccount').addEventListener('click', () => this.linkPlexAccount());
        document.getElementById('unlinkPlexAccount').addEventListener('click', () => this.unlinkPlexAccount());
        document.getElementById('cancelPlexLink').addEventListener('click', () => this.cancelPlexLink());
        
        // Copy buttons for secret keys
        document.querySelectorAll('.copy-button').forEach(button => {
            if (button.id !== 'copyRecoveryKey') {
                button.addEventListener('click', (e) => this.copySecretKey(e));
            }
        });
    }

    async loadUserData() {
        try {
            // Clean up any stale localStorage flags that might interfere
            this.cleanupStaleFlags();
            
            // Load user info
            const userResponse = await fetch('./api/user/info', { credentials: 'include' });
            if (!userResponse.ok) throw new Error('Failed to fetch user data');
            
            const userData = await userResponse.json();
            
            // Update username
            document.getElementById('currentUsername').textContent = userData.username || 'Unknown';
            
            // Update 2FA status
            this.update2FAStatus(userData.is_2fa_enabled);
            
            // Load Plex status
            try {
                const plexResponse = await fetch('./api/auth/plex/status', { credentials: 'include' });
                if (plexResponse.ok) {
                    const plexData = await plexResponse.json();
                    if (plexData.success) {
                        this.updatePlexStatus(plexData);
                    } else {
                        this.updatePlexStatus(null);
                    }
                } else {
                    this.updatePlexStatus(null);
                }
            } catch (plexError) {
                console.warn('Error loading Plex status:', plexError);
                this.updatePlexStatus(null);
            }
            
            // Check if we're returning from Plex authentication
            this.checkPlexReturn();
            
        } catch (error) {
            console.error('Error loading user data:', error);
        }
    }

    async saveUsername() {
        const newUsername = document.getElementById('newUsername').value.trim();
        const currentPassword = document.getElementById('currentPasswordForUsernameChange').value;
        const statusElement = document.getElementById('usernameStatus');

        if (!newUsername || !currentPassword) {
            this.showStatus(statusElement, 'Please fill in all fields', 'error');
            return;
        }

        try {
            const response = await fetch('./api/user/change-username', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    username: newUsername,
                    password: currentPassword
                })
            });

            const result = await response.json();

            if (response.ok) {
                this.showStatus(statusElement, 'Username updated successfully!', 'success');
                document.getElementById('currentUsername').textContent = newUsername;
                document.getElementById('newUsername').value = '';
                document.getElementById('currentPasswordForUsernameChange').value = '';
            } else {
                this.showStatus(statusElement, result.error || 'Failed to update username', 'error');
            }
        } catch (error) {
            this.showStatus(statusElement, 'Error updating username', 'error');
        }
    }

    async savePassword() {
        const currentPassword = document.getElementById('currentPassword').value;
        const newPassword = document.getElementById('newPassword').value;
        const confirmPassword = document.getElementById('confirmPassword').value;
        const statusElement = document.getElementById('passwordStatus');

        if (!currentPassword || !newPassword || !confirmPassword) {
            this.showStatus(statusElement, 'Please fill in all fields', 'error');
            return;
        }

        if (newPassword !== confirmPassword) {
            this.showStatus(statusElement, 'New passwords do not match', 'error');
            return;
        }

        if (newPassword.length < 6) {
            this.showStatus(statusElement, 'Password must be at least 6 characters long', 'error');
            return;
        }

        try {
            const response = await fetch('./api/user/change-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    current_password: currentPassword,
                    new_password: newPassword
                })
            });

            const result = await response.json();

            if (response.ok) {
                this.showStatus(statusElement, 'Password updated successfully!', 'success');
                document.getElementById('currentPassword').value = '';
                document.getElementById('newPassword').value = '';
                document.getElementById('confirmPassword').value = '';
            } else {
                this.showStatus(statusElement, result.error || 'Failed to update password', 'error');
            }
        } catch (error) {
            this.showStatus(statusElement, 'Error updating password', 'error');
        }
    }

    async enableTwoFactor() {
        try {
            const response = await fetch('./api/user/2fa/setup', { 
                method: 'POST',
                credentials: 'include'
            });
            const result = await response.json();

            if (response.ok) {
                document.getElementById('qrCode').src = result.qr_code_url;
                document.getElementById('secretKey').textContent = result.secret;
                
                document.getElementById('enableTwoFactorSection').style.display = 'none';
                document.getElementById('setupTwoFactorSection').style.display = 'block';
            } else {
                console.error('Failed to setup 2FA:', result.error);
            }
        } catch (error) {
            console.error('Error setting up 2FA:', error);
        }
    }

    async verifyTwoFactor() {
        const code = document.getElementById('verificationCode').value.trim();
        const statusElement = document.getElementById('verifyStatus');

        if (!code || code.length !== 6) {
            this.showStatus(statusElement, 'Please enter a valid 6-digit code', 'error');
            return;
        }

        try {
            const response = await fetch('./api/user/2fa/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ code })
            });

            const result = await response.json();

            if (response.ok) {
                this.showStatus(statusElement, '2FA enabled successfully!', 'success');
                setTimeout(() => {
                    this.update2FAStatus(true);
                    document.getElementById('verificationCode').value = '';
                }, 1500);
            } else {
                this.showStatus(statusElement, result.error || 'Invalid verification code', 'error');
            }
        } catch (error) {
            this.showStatus(statusElement, 'Error verifying 2FA code', 'error');
        }
    }

    async disableTwoFactor() {
        const password = document.getElementById('currentPasswordFor2FADisable').value;
        const otpCode = document.getElementById('otpCodeFor2FADisable').value.trim();
        const statusElement = document.getElementById('disableStatus');

        if (!password || !otpCode) {
            this.showStatus(statusElement, 'Please fill in all fields', 'error');
            return;
        }

        try {
            const response = await fetch('./api/user/2fa/disable', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    password: password,
                    code: otpCode
                })
            });

            const result = await response.json();

            if (response.ok) {
                this.showStatus(statusElement, '2FA disabled successfully!', 'success');
                setTimeout(() => {
                    this.update2FAStatus(false);
                    document.getElementById('currentPasswordFor2FADisable').value = '';
                    document.getElementById('otpCodeFor2FADisable').value = '';
                }, 1500);
            } else {
                this.showStatus(statusElement, result.error || 'Failed to disable 2FA', 'error');
            }
        } catch (error) {
            this.showStatus(statusElement, 'Error disabling 2FA', 'error');
        }
    }

    async generateRecoveryKey() {
        const password = document.getElementById('currentPasswordForRecovery').value;
        const twoFactorCode = document.getElementById('recoveryTwoFactorCode').value.trim();
        const statusElement = document.getElementById('recoveryStatus');

        if (!password) {
            this.showStatus(statusElement, 'Please enter your current password', 'error');
            return;
        }

        // Check if 2FA is enabled and require code
        const twoFactorElement = document.getElementById('twoFactorEnabled');
        const twoFactorEnabled = twoFactorElement && twoFactorElement.textContent.trim() === 'Enabled';
        if (twoFactorEnabled && !twoFactorCode) {
            this.showStatus(statusElement, 'Please enter your 2FA code', 'error');
            return;
        }

        try {
            const requestBody = { password };
            if (twoFactorEnabled) {
                requestBody.two_factor_code = twoFactorCode;
            }

            const response = await fetch('./auth/recovery-key/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });

            const result = await response.json();

            if (response.ok) {
                document.getElementById('recoveryKeyValue').textContent = result.recovery_key;
                document.getElementById('recoveryKeyDisplay').style.display = 'block';
                this.showStatus(statusElement, 'Recovery key generated successfully!', 'success');
                
                // Clear form
                document.getElementById('currentPasswordForRecovery').value = '';
                document.getElementById('recoveryTwoFactorCode').value = '';
                
                // Auto-hide after 5 minutes
                setTimeout(() => {
                    document.getElementById('recoveryKeyDisplay').style.display = 'none';
                }, 300000);
            } else {
                this.showStatus(statusElement, result.error || 'Failed to generate recovery key', 'error');
            }
        } catch (error) {
            this.showStatus(statusElement, 'Error generating recovery key', 'error');
        }
    }

    _copyToClipboard(text, button) {
        function showCopied() {
            var originalText = button.textContent;
            button.textContent = 'Copied!';
            button.classList.add('copied');
            setTimeout(function() {
                button.textContent = originalText;
                button.classList.remove('copied');
            }, 2000);
        }
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(text).then(showCopied).catch(function() {
                fallbackCopy(text, showCopied);
            });
        } else {
            fallbackCopy(text, showCopied);
        }
        function fallbackCopy(val, onSuccess) {
            var ta = document.createElement('textarea');
            ta.value = val;
            ta.style.position = 'fixed';
            ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); if (onSuccess) onSuccess(); } catch (e) {}
            document.body.removeChild(ta);
        }
    }

    copyRecoveryKey() {
        var recoveryKey = document.getElementById('recoveryKeyValue').textContent;
        var button = document.getElementById('copyRecoveryKey');
        this._copyToClipboard(recoveryKey, button);
    }

    copySecretKey(event) {
        var secretKey = document.getElementById('secretKey').textContent;
        var button = event.target;
        this._copyToClipboard(secretKey, button);
    }

    async linkPlexAccount() {
        const modal = document.getElementById('plexLinkModal');
        const pinCode = document.getElementById('plexLinkPinCode');
        
        modal.style.display = 'block';
        pinCode.textContent = '';
        this.setPlexLinkStatus('waiting', '<i class="fas fa-spinner spinner"></i> Preparing Plex authentication...');
        
        try {
            // Create Plex PIN with user_mode flag
            const response = await fetch('./api/auth/plex/pin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_mode: true })
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.currentPlexPinId = data.pin_id;
                
                // Extract PIN code from auth URL
                const hashPart = data.auth_url.split('#')[1];
                if (hashPart) {
                    const urlParams = new URLSearchParams(hashPart.substring(1));
                    const pinCodeValue = urlParams.get('code');
                    pinCode.textContent = pinCodeValue || 'PIN-' + this.currentPlexPinId;
                } else {
                    pinCode.textContent = 'PIN-' + this.currentPlexPinId;
                }
                
                this.setPlexLinkStatus('waiting', '<i class="fas fa-external-link-alt"></i> You will be redirected to Plex to sign in. After authentication, you will be brought back here automatically.');
                
                // Store PIN ID and flags for when we return from Plex
                localStorage.setItem('huntarr-plex-pin-id', this.currentPlexPinId);
                localStorage.setItem('huntarr-plex-linking', 'true');
                localStorage.setItem('huntarr-plex-user-mode', 'true');
                localStorage.setItem('huntarr-plex-linking-timestamp', Date.now().toString());
                
                // Redirect to Plex authentication
                setTimeout(() => {
                    this.setPlexLinkStatus('waiting', '<i class="fas fa-spinner spinner"></i> Redirecting to Plex...');
                    setTimeout(() => {
                        window.location.href = data.auth_url;
                    }, 1000);
                }, 2000);
            } else {
                this.setPlexLinkStatus('error', '<i class="fas fa-exclamation-triangle"></i> Failed to create Plex PIN: ' + (data.error || 'Unknown error. Please try again.'));
            }
        } catch (error) {
            console.error('Error creating Plex PIN:', error);
            this.setPlexLinkStatus('error', '<i class="fas fa-exclamation-triangle"></i> Network error: Unable to connect to Plex. Please check your internet connection and try again.');
        }
    }

    setPlexLinkStatus(type, message) {
        const plexLinkStatus = document.getElementById('plexLinkStatus');
        
        if (plexLinkStatus) {
            plexLinkStatus.className = `plex-status ${type}`;
            plexLinkStatus.innerHTML = message;
            plexLinkStatus.style.display = 'block';
        }
    }

    startPlexPolling() {
        console.log('startPlexPinChecking called with PIN ID:', this.currentPlexPinId);
        
        // Clear any existing interval
        if (this.plexPollingInterval) {
            console.log('Clearing existing interval');
            clearInterval(this.plexPollingInterval);
            this.plexPollingInterval = null;
        }
        
        if (!this.currentPlexPinId) {
            console.error('No PIN ID available for checking');
            this.setPlexLinkStatus('error', '<i class="fas fa-exclamation-triangle"></i> No PIN ID available. Please try again.');
            return;
        }
        
        this.setPlexLinkStatus('waiting', '<i class="fas fa-hourglass-half"></i> Checking authentication status...');
        
        this.plexPollingInterval = setInterval(() => {
            console.log('Checking PIN status for:', this.currentPlexPinId);
            
            fetch(`./api/auth/plex/check/${this.currentPlexPinId}`)
                .then(response => {
                    console.log('PIN check response status:', response.status);
                    return response.json();
                })
                .then(data => {
                    console.log('PIN check data:', data);
                    if (data.success && data.claimed) {
                        console.log('PIN claimed, linking account');
                        this.setPlexLinkStatus('success', '<i class="fas fa-link"></i> Plex account successfully linked!');
                        this.stopPlexLinking(); // Stop checking immediately
                        this.linkWithPlexToken(data.token); // This will also call stopPlexLinking in finally
                    } else if (data.success && !data.claimed) {
                        console.log('PIN not yet claimed, continuing to check');
                        this.setPlexLinkStatus('waiting', '<i class="fas fa-hourglass-half"></i> Waiting for Plex authentication to complete...');
                    } else {
                        console.error('PIN check failed:', data);
                        this.setPlexLinkStatus('error', '<i class="fas fa-exclamation-triangle"></i> Authentication check failed: ' + (data.error || 'Please try again.'));
                        this.stopPlexLinking();
                    }
                })
                .catch(error => {
                    console.error('Error checking PIN:', error);
                    this.setPlexLinkStatus('error', '<i class="fas fa-exclamation-triangle"></i> Network error: Unable to verify authentication status. Please try again.');
                    this.stopPlexLinking();
                });
        }, 2000);
        
        // Stop checking after 10 minutes
        setTimeout(() => {
            if (this.plexPollingInterval) {
                console.log('PIN check timeout reached');
                this.stopPlexLinking();
                this.setPlexLinkStatus('error', '<i class="fas fa-clock"></i> Authentication timeout: PIN expired after 10 minutes. Please try linking your account again.');
            }
        }, 600000);
    }
    
    async linkWithPlexToken(token) {
        console.log('Linking with Plex token');
        this.setPlexLinkStatus('waiting', '<i class="fas fa-spinner spinner"></i> Finalizing account link...');
        
        try {
            // Use the same approach as setup - let backend get username from database
            const linkResponse = await fetch('./api/auth/plex/link', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                credentials: 'include',
                body: JSON.stringify({
                    token: token,
                    setup_mode: true  // Use setup mode like the working implementation
                })
            });
            
            const linkResult = await linkResponse.json();
            
            if (linkResponse.ok && linkResult.success) {
                this.setPlexLinkStatus('success', '<i class="fas fa-check-circle"></i> Plex account successfully linked!');
                setTimeout(() => {
                    const modal = document.getElementById('plexLinkModal');
                    if (modal) modal.style.display = 'none';
                    
                    // Reload user data to show updated Plex status
                    this.loadUserData();
                }, 2000);
            } else {
                this.setPlexLinkStatus('error', '<i class="fas fa-exclamation-triangle"></i> Account linking failed: ' + (linkResult.error || 'Unknown error occurred. Please try again.'));
            }
        } catch (error) {
            console.error('Error linking Plex account:', error);
            this.setPlexLinkStatus('error', '<i class="fas fa-exclamation-triangle"></i> Network error: Unable to complete account linking. Please check your connection and try again.');
        } finally {
            // Always stop the PIN checking interval when linking completes (success or failure)
            console.log('linkWithPlexToken completed, stopping PIN checking');
            this.stopPlexLinking();
        }
    }
    
    stopPlexLinking() {
        console.log('stopPlexLinking called');
        if (this.plexPollingInterval) {
            clearInterval(this.plexPollingInterval);
            this.plexPollingInterval = null;
            console.log('Cleared PIN check interval');
        }
        this.currentPlexPinId = null;
    }

    // Add method to check for return from Plex authentication 
    checkPlexReturn() {
        const plexLinking = localStorage.getItem('huntarr-plex-linking');
        const plexPinId = localStorage.getItem('huntarr-plex-pin-id');
        const userMode = localStorage.getItem('huntarr-plex-user-mode');
        
        if (plexLinking === 'true' && plexPinId && userMode === 'true') {
            console.log('Detected return from Plex authentication, PIN ID:', plexPinId);
            
            // Clear the flags
            localStorage.removeItem('huntarr-plex-linking');
            localStorage.removeItem('huntarr-plex-pin-id');
            localStorage.removeItem('huntarr-plex-user-mode');
            localStorage.removeItem('huntarr-plex-linking-timestamp');
            
            // Show modal and start checking
            document.getElementById('plexLinkModal').style.display = 'block';
            
            // Extract PIN code for display
            const pinCodeValue = plexPinId.substring(0, 4) + '-' + plexPinId.substring(4);
            document.getElementById('plexLinkPinCode').textContent = pinCodeValue;
            
            // Set global PIN ID and start checking
            this.currentPlexPinId = plexPinId;
            this.setPlexLinkStatus('waiting', '<i class="fas fa-spinner spinner"></i> Completing Plex authentication and linking your account...');
            
            console.log('Starting PIN checking for returned user');
            this.startPlexPolling();
        }
    }

    cancelPlexLink() {
        this.stopPlexLinking();
        document.getElementById('plexLinkModal').style.display = 'none';
        this.setPlexLinkStatus('waiting', '<i class="fas fa-hourglass-half"></i> Initializing Plex authentication...');
    }

    async unlinkPlexAccount() {
        const statusElement = document.getElementById('plexUnlinkStatus');
        const self = this;
        const doUnlink = async function() {
        try {
            const response = await fetch('./api/auth/plex/unlink', { 
                method: 'POST',
                credentials: 'include'
            });
            const result = await response.json();

            if (response.ok) {
                self.showStatus(statusElement, 'Plex account unlinked successfully!', 'success');
                setTimeout(() => {
                    self.updatePlexStatus(null);
                }, 1500);
            } else {
                // Check if session expired - provide actionable guidance
                if (result.session_expired) {
                    self.showStatus(statusElement, result.error || 'Session expired. Please refresh the page and log in again.', 'error');
                    // Auto-prompt user to refresh after showing message
                    setTimeout(() => {
                        if (confirm('Your session has expired. Would you like to log in again now?')) {
                            window.location.href = './logout'; // Redirect to logout which will clear session and redirect to login
                        }
                    }, 2000);
                } else {
                    self.showStatus(statusElement, result.error || 'Failed to unlink Plex account', 'error');
                }
            }
        } catch (error) {
            self.showStatus(statusElement, 'Error unlinking Plex account', 'error');
        }
        };
        if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
            window.HuntarrConfirm.show({ title: 'Unlink Plex Account', message: 'Are you sure you want to unlink your Plex account?', confirmLabel: 'Unlink', onConfirm: function() { doUnlink(); } });
        } else {
            if (!confirm('Are you sure you want to unlink your Plex account?')) return;
            doUnlink();
        }
    }

    update2FAStatus(enabled) {
        const statusBadge = document.getElementById('twoFactorEnabled');
        const enableSection = document.getElementById('enableTwoFactorSection');
        const setupSection = document.getElementById('setupTwoFactorSection');
        const disableSection = document.getElementById('disableTwoFactorSection');
        const recoverySection = document.getElementById('recoveryTwoFactorSection');

        statusBadge.style.display = 'inline-block';

        if (enabled) {
            statusBadge.textContent = 'Enabled';
            statusBadge.className = 'status-badge enabled';
            
            enableSection.style.display = 'none';
            setupSection.style.display = 'none';
            disableSection.style.display = 'block';
            recoverySection.style.display = 'block';
        } else {
            statusBadge.textContent = 'Disabled';
            statusBadge.className = 'status-badge disabled';
            
            enableSection.style.display = 'block';
            setupSection.style.display = 'none';
            disableSection.style.display = 'none';
            recoverySection.style.display = 'none';
        }
    }

    updatePlexStatus(plexData) {
        const statusBadge = document.getElementById('plexAccountStatus');
        const notLinkedSection = document.getElementById('plexNotLinkedSection');
        const linkedSection = document.getElementById('plexLinkedSection');

        statusBadge.style.display = 'inline-block';

        if (plexData && plexData.plex_linked) {
            statusBadge.textContent = 'Linked';
            statusBadge.className = 'status-badge enabled';
            
            document.getElementById('plexUsername').textContent = plexData.plex_username || 'Unknown';
            document.getElementById('plexEmail').textContent = plexData.plex_email || 'N/A';
            
            // Format the timestamp properly
            let linkedAtText = 'Unknown';
            if (plexData.plex_linked_at) {
                try {
                    const timestamp = plexData.plex_linked_at;
                    const date = new Date(timestamp * 1000); // Convert Unix timestamp to milliseconds
                    linkedAtText = date.toLocaleString(); // Format as readable date/time
                } catch (error) {
                    console.error('Error formatting plex_linked_at timestamp:', error);
                    linkedAtText = 'Invalid Date';
                }
            }
            document.getElementById('plexLinkedAt').textContent = linkedAtText;
            
            notLinkedSection.style.display = 'none';
            linkedSection.style.display = 'block';
        } else {
            statusBadge.textContent = 'Not Linked';
            statusBadge.className = 'status-badge disabled';
            
            notLinkedSection.style.display = 'block';
            linkedSection.style.display = 'none';
        }
    }

    cleanupStaleFlags() {
        // Clean up any localStorage flags that might interfere with normal operation
        const flagsToClean = [
            'huntarr-plex-login',
            'huntarr-plex-setup-mode'
        ];
        
        flagsToClean.forEach(flag => {
            if (localStorage.getItem(flag)) {
                console.log(`[UserModule] Cleaning up stale localStorage flag: ${flag}`);
                localStorage.removeItem(flag);
            }
        });
        
        // Only clean up Plex linking flags if they're older than 10 minutes (stale)
        const plexLinkingTimestamp = localStorage.getItem('huntarr-plex-linking-timestamp');
        if (plexLinkingTimestamp) {
            const tenMinutesAgo = Date.now() - (10 * 60 * 1000);
            if (parseInt(plexLinkingTimestamp) < tenMinutesAgo) {
                console.log('[UserModule] Cleaning up stale Plex linking flags (older than 10 minutes)');
                localStorage.removeItem('huntarr-plex-linking');
                localStorage.removeItem('huntarr-plex-pin-id');
                localStorage.removeItem('huntarr-plex-user-mode');
                localStorage.removeItem('huntarr-plex-linking-timestamp');
            }
        }
    }

    showStatus(element, message, type) {
        // Cancel any previous hide timeout for this element
        if (element._statusTimeout) {
            clearTimeout(element._statusTimeout);
        }
        element.textContent = message;
        element.className = `status-message ${type}`;
        element.style.display = 'block';
        
        element._statusTimeout = setTimeout(() => {
            element.style.display = 'none';
            element._statusTimeout = null;
        }, 5000);
    }
}

// Export for use in main application
window.UserModule = UserModule; 

/* === modules/features/new-user.js === */
/**
 * Huntarr - User Settings Page
 * Handles user profile management functionality
 */

// Immediately execute this function to avoid global scope pollution
(function() {
    // Wait for the DOM to be fully loaded
    document.addEventListener('DOMContentLoaded', function() {
        console.log('User settings page loaded');
        
        // Initialize user settings functionality
        initUserPage();
        
        // Setup button handlers
        setupEventHandlers();
    });
    
    function initUserPage() {
        // Set active nav item
        const navItems = document.querySelectorAll('.nav-item');
        navItems.forEach(item => item.classList.remove('active'));
        const userNav = document.getElementById('userNav');
        if (userNav) userNav.classList.add('active');
        
        // Only set page title when we're actually on the user section (don't overwrite Home, Requestarr, etc.)
        const isUserSection = (window.location.hash === '#user' || (window.huntarrUI && window.huntarrUI.currentSection === 'user'));
        const pageTitleElement = document.getElementById('currentPageTitle');
        if (pageTitleElement && isUserSection) pageTitleElement.textContent = 'User Settings';
        
        // Apply dark mode
        document.body.classList.add('dark-theme');
        localStorage.setItem('huntarr-dark-mode', 'true');
        
        // Fetch user data
        fetchUserInfo();
    }
    
    // Setup all event handlers for the page
    function setupEventHandlers() {
        // Change username handler
        const saveUsernameBtn = document.getElementById('saveUsername');
        if (saveUsernameBtn) {
            saveUsernameBtn.addEventListener('click', handleUsernameChange);
        }
        
        // Change password handler
        const savePasswordBtn = document.getElementById('savePassword');
        if (savePasswordBtn) {
            savePasswordBtn.addEventListener('click', handlePasswordChange);
        }
        
        // 2FA handlers
        const enableTwoFactorBtn = document.getElementById('enableTwoFactor');
        if (enableTwoFactorBtn) {
            enableTwoFactorBtn.addEventListener('click', handleEnableTwoFactor);
        }
        
        const verifyTwoFactorBtn = document.getElementById('verifyTwoFactor');
        if (verifyTwoFactorBtn) {
            verifyTwoFactorBtn.addEventListener('click', handleVerifyTwoFactor);
        }
        
        const disableTwoFactorBtn = document.getElementById('disableTwoFactor');
        if (disableTwoFactorBtn) {
            disableTwoFactorBtn.addEventListener('click', handleDisableTwoFactor);
        }
        
        // Recovery key handlers
        const generateRecoveryKeyBtn = document.getElementById('generateRecoveryKey');
        if (generateRecoveryKeyBtn) {
            generateRecoveryKeyBtn.addEventListener('click', handleGenerateRecoveryKey);
        }
        
        const copyRecoveryKeyBtn = document.getElementById('copyRecoveryKey');
        if (copyRecoveryKeyBtn) {
            copyRecoveryKeyBtn.addEventListener('click', handleCopyRecoveryKey);
        }
    }
    
    // Username change handler
    function handleUsernameChange() {
        const newUsername = document.getElementById('newUsername').value.trim();
        const currentPassword = document.getElementById('currentPasswordForUsernameChange').value;
        const statusElement = document.getElementById('usernameStatus');
        
        if (!newUsername || !currentPassword) {
            showStatus(statusElement, 'Please fill in all fields', 'error');
            return;
        }
        
        // Min username length check
        if (newUsername.length < 3) {
            showStatus(statusElement, 'Username must be at least 3 characters long', 'error');
            return;
        }
        
        HuntarrUtils.fetchWithTimeout('./api/user/change-username', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: newUsername,
                password: currentPassword
            })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                showStatus(statusElement, 'Username updated successfully', 'success');
                // Update displayed username
                updateUsernameElements(newUsername);
                // Clear form fields
                document.getElementById('newUsername').value = '';
                document.getElementById('currentPasswordForUsernameChange').value = '';
            } else {
                showStatus(statusElement, data.error || 'Failed to update username', 'error');
            }
        })
        .catch(error => {
            console.error('Error updating username:', error);
            showStatus(statusElement, 'Error updating username: ' + error.message, 'error');
        });
    }
    
    // Password change handler
    function handlePasswordChange() {
        const currentPassword = document.getElementById('currentPassword').value;
        const newPassword = document.getElementById('newPassword').value;
        const confirmPassword = document.getElementById('confirmPassword').value;
        const statusElement = document.getElementById('passwordStatus');
        
        if (!currentPassword || !newPassword || !confirmPassword) {
            showStatus(statusElement, 'Please fill in all fields', 'error');
            return;
        }
        
        if (newPassword !== confirmPassword) {
            showStatus(statusElement, 'New passwords do not match', 'error');
            return;
        }
        
        // Validate password (using function from user.html)
        const passwordError = validatePassword(newPassword);
        if (passwordError) {
            showStatus(statusElement, passwordError, 'error');
            return;
        }
        
        HuntarrUtils.fetchWithTimeout('./api/user/change-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                current_password: currentPassword,
                new_password: newPassword
            })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                showStatus(statusElement, 'Password updated successfully', 'success');
                // Clear form fields
                document.getElementById('currentPassword').value = '';
                document.getElementById('newPassword').value = '';
                document.getElementById('confirmPassword').value = '';
            } else {
                showStatus(statusElement, data.error || 'Failed to update password', 'error');
            }
        })
        .catch(error => {
            console.error('Error updating password:', error);
            showStatus(statusElement, 'Error updating password: ' + error.message, 'error');
        });
    }
    
    // 2FA setup handler
    function handleEnableTwoFactor() {
        HuntarrUtils.fetchWithTimeout('./api/user/2fa/setup', { method: 'POST' })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                // Update QR code and secret
                const qrCodeImg = document.getElementById('qrCode');
                if (qrCodeImg) {
                    qrCodeImg.src = data.qr_code_url;
                }
                
                const secretKeyElement = document.getElementById('secretKey');
                if (secretKeyElement) {
                    secretKeyElement.textContent = data.secret;
                }
                
                // Show setup section
                updateVisibility('enableTwoFactorSection', false);
                updateVisibility('setupTwoFactorSection', true);
            } else {
                console.error('Failed to setup 2FA:', data.error);
                if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Failed to setup 2FA: ' + (data.error || 'Unknown error'), 'error');
                else alert('Failed to setup 2FA: ' + (data.error || 'Unknown error'));
            }
        })
        .catch(error => {
            console.error('Error setting up 2FA:', error);
            if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Error setting up 2FA: ' + error.message, 'error');
            else alert('Error setting up 2FA: ' + error.message);
        });
    }
    
    // 2FA verification handler
    function handleVerifyTwoFactor() {
        const code = document.getElementById('verificationCode').value;
        const verifyStatusElement = document.getElementById('verifyStatus');
        
        if (!code || code.length !== 6 || !/^\d{6}$/.test(code)) {
            showStatus(verifyStatusElement, 'Please enter a valid 6-digit verification code', 'error');
            return;
        }
        
        HuntarrUtils.fetchWithTimeout('./api/user/2fa/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: code })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                showStatus(verifyStatusElement, '2FA enabled successfully', 'success');
                // Update UI state
                setTimeout(() => {
                    update2FAStatus(true);
                    document.getElementById('verificationCode').value = '';
                }, 1500); // Short delay to allow user to see success message
            } else {
                showStatus(verifyStatusElement, data.error || 'Invalid verification code', 'error');
            }
        })
        .catch(error => {
            console.error('Error verifying 2FA:', error);
            showStatus(verifyStatusElement, 'Error verifying code: ' + error.message, 'error');
        });
    }
    
    // 2FA disable handler
    function handleDisableTwoFactor() {
        const password = document.getElementById('currentPasswordFor2FADisable').value;
        const otpCode = document.getElementById('otpCodeFor2FADisable').value;
        const disableStatusElement = document.getElementById('disableStatus');
        
        if (!password) {
            showStatus(disableStatusElement, 'Please enter your current password', 'error');
            return;
        }
        
        if (!otpCode || otpCode.length !== 6 || !/^\d{6}$/.test(otpCode)) {
            showStatus(disableStatusElement, 'Please enter a valid 6-digit verification code', 'error');
            return;
        }
        
        HuntarrUtils.fetchWithTimeout('./api/user/2fa/disable', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                password: password,
                code: otpCode
            })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                showStatus(disableStatusElement, '2FA disabled successfully', 'success');
                // Update UI state
                setTimeout(() => {
                    update2FAStatus(false);
                    document.getElementById('currentPasswordFor2FADisable').value = '';
                    document.getElementById('otpCodeFor2FADisable').value = '';
                }, 1500); // Short delay to allow user to see success message
            } else {
                showStatus(disableStatusElement, data.error || 'Failed to disable 2FA', 'error');
            }
        })
        .catch(error => {
            console.error('Error disabling 2FA:', error);
            showStatus(disableStatusElement, 'Error disabling 2FA: ' + error.message, 'error');
        });
    }
    
    // Recovery key generation handler
    function handleGenerateRecoveryKey() {
        const currentPassword = document.getElementById('currentPasswordForRecovery').value;
        const twoFactorCode = document.getElementById('recoveryTwoFactorCode').value;
        const statusElement = document.getElementById('recoveryStatus');
        
        if (!currentPassword) {
            showStatus(statusElement, 'Please enter your current password', 'error');
            return;
        }
        
        const requestData = {
            password: currentPassword
        };
        
        // Add 2FA code if provided (required if 2FA is enabled)
        if (twoFactorCode) {
            requestData.two_factor_code = twoFactorCode;
        }
        
        HuntarrUtils.fetchWithTimeout('./auth/recovery-key/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestData)
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                // Display the recovery key
                const recoveryKeyValue = document.getElementById('recoveryKeyValue');
                const recoveryKeyDisplay = document.getElementById('recoveryKeyDisplay');
                
                if (recoveryKeyValue && recoveryKeyDisplay) {
                    recoveryKeyValue.textContent = data.recovery_key;
                    recoveryKeyDisplay.style.display = 'block';
                }
                
                showStatus(statusElement, data.message, 'success');
                
                // Clear form fields
                document.getElementById('currentPasswordForRecovery').value = '';
                document.getElementById('recoveryTwoFactorCode').value = '';
                
                // Auto-hide the recovery key after 5 minutes
                setTimeout(() => {
                    if (recoveryKeyDisplay) {
                        recoveryKeyDisplay.style.display = 'none';
                    }
                }, 300000); // 5 minutes
                
            } else {
                showStatus(statusElement, data.error || 'Failed to generate recovery key', 'error');
                
                // Show 2FA field if required
                if (data.error && data.error.includes('Two-factor authentication')) {
                    const twoFactorSection = document.getElementById('recoveryTwoFactorSection');
                    if (twoFactorSection) {
                        twoFactorSection.style.display = 'block';
                    }
                }
            }
        })
        .catch(error => {
            console.error('Error generating recovery key:', error);
            showStatus(statusElement, 'Error generating recovery key: ' + error.message, 'error');
        });
    }
    
    // Recovery key copy handler
    function handleCopyRecoveryKey() {
        const recoveryKeyValue = document.getElementById('recoveryKeyValue');
        if (!recoveryKeyValue) return;
        
        const text = recoveryKeyValue.textContent;
        const copyBtn = document.getElementById('copyRecoveryKey');
        
        function showCopied() {
            if (copyBtn) {
                var originalText = copyBtn.textContent;
                copyBtn.textContent = 'Copied!';
                setTimeout(function() { copyBtn.textContent = originalText; }, 2000);
            }
        }
        function fallbackCopy(val, onSuccess) {
            var ta = document.createElement('textarea');
            ta.value = val;
            ta.style.position = 'fixed';
            ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); if (onSuccess) onSuccess(); } catch (e) { selectText(recoveryKeyValue); }
            document.body.removeChild(ta);
        }
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(text).then(showCopied).catch(function() { fallbackCopy(text, showCopied); });
        } else {
            fallbackCopy(text, showCopied);
        }
    }
    
    // Helper function to select text (fallback for copy)
    function selectText(element) {
        if (document.selection) {
            const range = document.body.createTextRange();
            range.moveToElementText(element);
            range.select();
        } else if (window.getSelection) {
            const range = document.createRange();
            range.selectNode(element);
            window.getSelection().removeAllRanges();
            window.getSelection().addRange(range);
        }
    }
    
    // Helper function for validation
    function validatePassword(password) {
        // Only check for minimum length of 8 characters
        if (password.length < 8) {
            return 'Password must be at least 8 characters long.';
        }
        return null; // Password is valid
    }
    
    // Helper function to show status messages
    function showStatus(element, message, type) {
        if (!element) return;
        
        element.textContent = message;
        element.className = type === 'success' ? 'status-success' : 'status-error';
        element.style.display = 'block';
        
        // Auto-hide after 5 seconds
        setTimeout(() => {
            element.style.display = 'none';
        }, 5000);
    }
    
    // Function to fetch user information
    function fetchUserInfo() {
        HuntarrUtils.fetchWithTimeout('./api/user/info')
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! Status: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                // Update username elements
                updateUsernameElements(data.username);
                
                // Update 2FA status
                update2FAStatus(data.is_2fa_enabled);
            })
            .catch(error => {
                console.error('Error loading user info:', error);
                // Show error state in the UI
                showErrorState();
            });
    }
    
    // Helper functions
    function updateUsernameElements(username) {
        if (!username) return;
        
        const usernameElements = [
            document.getElementById('username'),
            document.getElementById('currentUsername')
        ];
        
        usernameElements.forEach(element => {
            if (element) {
                element.textContent = username;
            }
        });
    }
    
    function update2FAStatus(isEnabled) {
        const statusElement = document.getElementById('twoFactorEnabled');
        if (statusElement) {
            statusElement.textContent = isEnabled ? 'Enabled' : 'Disabled';
        }
        
        // Update visibility of relevant sections
        updateVisibility('enableTwoFactorSection', !isEnabled);
        updateVisibility('setupTwoFactorSection', false);
        updateVisibility('disableTwoFactorSection', isEnabled);
    }
    
    function updateVisibility(elementId, isVisible) {
        const element = document.getElementById(elementId);
        if (element) {
            element.style.display = isVisible ? 'block' : 'none';
        }
    }
    
    function showErrorState() {
        const usernameElement = document.getElementById('currentUsername');
        if (usernameElement) {
            usernameElement.textContent = 'Error loading username';
        }
        
        const statusElement = document.getElementById('twoFactorEnabled');
        if (statusElement) {
            statusElement.textContent = 'Error loading status';
        }
    }
})();


/* === modules/features/community-resources.js === */
/**
 * Huntarr - Community Resources Module
 * Handles showing/hiding the Community Resources section on the home page
 * based on user settings.
 */

document.addEventListener('DOMContentLoaded', function() {
    // Initialize the community resources visibility immediately
    initCommunityResourcesVisibilityImmediate();
    
    // Also listen for settings changes that might affect visibility
    window.addEventListener('settings-saved', function() {
        initCommunityResourcesVisibility();
    });
});

/**
 * Immediately shows sections with cached data to prevent flashing
 */
function initCommunityResourcesVisibilityImmediate() {
    // Check if the community hub card exists
    const communityHubCard = document.querySelector('.community-hub-card');
    const huntarrSupportSection = document.querySelector('#huntarr-support-section');
    
    // Try to get cached settings first
    const cachedSettings = localStorage.getItem('huntarr-general-settings');
    if (cachedSettings) {
        try {
            const settings = JSON.parse(cachedSettings);
            
            // Show/hide based on cached settings immediately
            if (communityHubCard) {
                communityHubCard.style.display = settings.display_community_resources !== false ? '' : 'none';
            }
            // Always hide Huntarr Support section
            if (huntarrSupportSection) {
                huntarrSupportSection.style.display = 'none';
            }
            
            console.log('[Community] Applied cached visibility settings');
            
            // Still fetch fresh settings in background to update if changed
            initCommunityResourcesVisibility();
            return;
        } catch (e) {
            console.log('[Community] Failed to parse cached settings');
        }
    }
    
    // If no cache, show community hub by default but always hide support section
    if (communityHubCard) {
        communityHubCard.style.display = '';
    }
    // Always hide Huntarr Support section
    if (huntarrSupportSection) {
        huntarrSupportSection.style.display = 'none';
    }
    
    // Fetch fresh settings
    initCommunityResourcesVisibility();
}

/**
 * Initializes the visibility of the Community Resources section
 * based on the display_community_resources setting in general.json
 */
function initCommunityResourcesVisibility() {
    // Check if the community hub card exists
    const communityHubCard = document.querySelector('.community-hub-card');
    if (!communityHubCard) {
        console.log('[Community] Community hub card not found in DOM');
        return;
    }
    
    // Check if the Huntarr support section exists
    const huntarrSupportSection = document.querySelector('#huntarr-support-section');
    if (!huntarrSupportSection) {
        console.log('[Community] Huntarr support section not found in DOM');
    }
    
    // Fetch general settings to determine visibility
    HuntarrUtils.fetchWithTimeout('./api/settings/general')
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            console.log('[Community] Loaded general settings:', data);
            
            // Cache the settings for immediate use next time
            localStorage.setItem('huntarr-general-settings', JSON.stringify(data));
            
            // Handle Community Resources visibility
            if (data.display_community_resources === false) {
                // Hide the community hub card
                console.log('[Community] Hiding community resources section');
                communityHubCard.style.display = 'none';
            } else {
                // Show the community hub card (default)
                console.log('[Community] Showing community resources section');
                communityHubCard.style.display = '';
            }
            
            // Always hide Huntarr Support section
            if (huntarrSupportSection) {
                console.log('[Community] Hiding Huntarr support section (always hidden)');
                huntarrSupportSection.style.display = 'none';
            }
        })
        .catch(error => {
            console.error('[Community] Error loading general settings:', error);
            // Default to showing community hub if there's an error
            communityHubCard.style.display = '';
            // Always hide Huntarr Support section
            if (huntarrSupportSection) {
                huntarrSupportSection.style.display = 'none';
            }
        });
} 

/* === modules/features/github-sponsors.js === */
/**
 * GitHub Sponsors Integration
 * Fetches and displays sponsors from GitHub for PlexGuide
 */

const GithubSponsors = {
    // Constants
    sponsorsUsername: 'plexguide',
    sponsorsApiUrl: 'https://api.github.com/sponsors/',
    cacheDuration: 3600000, // 1 hour in milliseconds
    
    // Initialize the sponsors display
    init: function() {
        console.log('Initializing GitHub Sponsors display');
        
        // Immediately call loadSponsors with mock data for a better user experience
        // This prevents the loading spinner from staying visible
        const mockSponsors = this.getImmediateMockSponsors();
        this.displaySponsors(mockSponsors);
        
        // Then load the actual data (which would be fetched from the API in a real implementation)
        setTimeout(() => {
            this.loadSponsors();
        }, 100);
        
        // Add event listener for manual refresh
        document.addEventListener('click', function(e) {
            if (e.target.closest('.action-button.refresh-sponsors')) {
                GithubSponsors.loadSponsors(true);
            }
        });
    },
    
    // Get immediate mock sponsors without any delay
    getImmediateMockSponsors: function() {
        return [
            {
                name: 'MediaServer Pro',
                url: 'https://github.com/mediaserverpro',
                avatarUrl: 'https://ui-avatars.com/api/?name=MS&background=4A90E2&color=fff&size=200',
                tier: 'Gold Sponsor'
            },
            {
                name: 'StreamVault',
                url: 'https://github.com/streamvault',
                avatarUrl: 'https://ui-avatars.com/api/?name=SV&background=6C5CE7&color=fff&size=200',
                tier: 'Gold Sponsor'
            },
            {
                name: 'MediaStack',
                url: 'https://github.com/mediastack',
                avatarUrl: 'https://ui-avatars.com/api/?name=MS&background=00B894&color=fff&size=200',
                tier: 'Silver Sponsor'
            },
            {
                name: 'NASGuru',
                url: 'https://github.com/nasguru',
                avatarUrl: 'https://ui-avatars.com/api/?name=NG&background=FD79A8&color=fff&size=200',
                tier: 'Silver Sponsor'
            }
        ];
    },
    
    // Load sponsors data
    loadSponsors: function(skipCache = false) {
        // Elements
        const loadingEl = document.getElementById('sponsors-loading');
        const sponsorsListEl = document.getElementById('sponsors-list');
        const errorEl = document.getElementById('sponsors-error');
        
        if (!loadingEl || !sponsorsListEl || !errorEl) {
            // Silently fail if elements are not found - might be on a different page
            return;
        }
        
        // First check for cached data
        const cachedData = this.getCachedSponsors();
        
        if (!skipCache && cachedData && cachedData.sponsors) {
            console.log('Using cached sponsors data');
            this.displaySponsors(cachedData.sponsors);
            return;
        }
        
        // Show loading state
        loadingEl.style.display = 'block';
        sponsorsListEl.style.display = 'none';
        errorEl.style.display = 'none';
        
        // Since GitHub's API requires authentication for the sponsors endpoint,
        // we'll use a mock implementation for demonstration purposes.
        // In a production environment, this would be replaced with a proper server-side
        // implementation that securely accesses the GitHub API with appropriate tokens.
        this.getMockSponsors()
            .then(sponsors => {
                // Cache the sponsors data
                this.cacheSponsors(sponsors);
                
                // Display the sponsors
                this.displaySponsors(sponsors);
            })
            .catch(error => {
                console.error('Error fetching sponsors:', error);
                
                // Show error state
                loadingEl.style.display = 'none';
                errorEl.style.display = 'block';
                errorEl.querySelector('span').textContent = 'Could not load sponsors: ' + error.message;
            });
    },
    
    // Get cached sponsors data
    getCachedSponsors: function() {
        const cachedData = localStorage.getItem('huntarr-github-sponsors');
        
        if (!cachedData) {
            return null;
        }
        
        try {
            const data = JSON.parse(cachedData);
            
            // Check if cache is expired
            if (Date.now() - data.timestamp > this.cacheDuration) {
                console.log('Sponsors cache expired');
                return null;
            }
            
            return data;
        } catch (e) {
            console.error('Error parsing cached sponsors data:', e);
            return null;
        }
    },
    
    // Cache sponsors data
    cacheSponsors: function(sponsors) {
        const data = {
            sponsors: sponsors,
            timestamp: Date.now()
        };
        
        localStorage.setItem('huntarr-github-sponsors', JSON.stringify(data));
        console.log('Cached sponsors data');
    },
    
    // Display sponsors in the UI
    displaySponsors: function(sponsors) {
        const sponsorsListEl = document.getElementById('sponsors-list');
        const loadingEl = document.getElementById('sponsors-loading');
        
        if (!sponsorsListEl) {
            // Silently fail if element is not found - might be on a different page
            return;
        }
        
        // Clear existing content
        sponsorsListEl.innerHTML = '';
        
        // Hide loading spinner
        if (loadingEl) {
            loadingEl.style.display = 'none';
        }
        
        // Show sponsors list
        sponsorsListEl.style.display = 'flex';
        
        if (!sponsors || sponsors.length === 0) {
            sponsorsListEl.innerHTML = '<div class="no-sponsors">No sponsors found</div>';
            return;
        }
        
        // Shuffle and limit to 10 random sponsors
        const shuffledSponsors = this.shuffleArray([...sponsors]);
        const limitedSponsors = shuffledSponsors.slice(0, 10);
        
        // Create sponsor elements
        limitedSponsors.forEach(sponsor => {
            const sponsorEl = document.createElement('a');
            sponsorEl.href = sponsor.url;
            sponsorEl.target = '_blank';
            sponsorEl.className = 'sponsor-item';
            sponsorEl.title = `${sponsor.name} - ${sponsor.tier}`;
            
            sponsorEl.innerHTML = `
                <img src="${sponsor.avatarUrl}" alt="${sponsor.name}" class="sponsor-avatar">
                <div class="sponsor-name">${sponsor.name}</div>
                <div class="sponsor-tier">${sponsor.tier}</div>
            `;
            
            sponsorsListEl.appendChild(sponsorEl);
        });
    },
    
    // Utility function to shuffle an array (Fisher-Yates algorithm)
    shuffleArray: function(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    },
    
    // Mock implementation to get sponsors
    getMockSponsors: function() {
        return new Promise((resolve) => {
            // Simulate API delay
            setTimeout(() => {
                const mockSponsors = [
                    {
                        name: 'MediaServer Pro',
                        url: 'https://github.com/mediaserverpro',
                        avatarUrl: 'https://ui-avatars.com/api/?name=MS&background=4A90E2&color=fff&size=200',
                        tier: 'Gold Sponsor'
                    },
                    {
                        name: 'StreamVault',
                        url: 'https://github.com/streamvault',
                        avatarUrl: 'https://ui-avatars.com/api/?name=SV&background=6C5CE7&color=fff&size=200',
                        tier: 'Gold Sponsor'
                    },
                    {
                        name: 'MediaStack',
                        url: 'https://github.com/mediastack',
                        avatarUrl: 'https://ui-avatars.com/api/?name=MS&background=00B894&color=fff&size=200',
                        tier: 'Silver Sponsor'
                    },
                    {
                        name: 'NASGuru',
                        url: 'https://github.com/nasguru',
                        avatarUrl: 'https://ui-avatars.com/api/?name=NG&background=FD79A8&color=fff&size=200',
                        tier: 'Silver Sponsor'
                    },
                    {
                        name: 'ServerSquad',
                        url: 'https://github.com/serversquad',
                        avatarUrl: 'https://ui-avatars.com/api/?name=SS&background=F1C40F&color=fff&size=200',
                        tier: 'Bronze Sponsor'
                    },
                    {
                        name: 'CloudCache',
                        url: 'https://github.com/cloudcache',
                        avatarUrl: 'https://ui-avatars.com/api/?name=CC&background=E74C3C&color=fff&size=200',
                        tier: 'Bronze Sponsor'
                    },
                    {
                        name: 'MediaMinder',
                        url: 'https://github.com/mediaminder',
                        avatarUrl: 'https://ui-avatars.com/api/?name=MM&background=9B59B6&color=fff&size=200',
                        tier: 'Bronze Sponsor'
                    },
                    {
                        name: 'StreamSage',
                        url: 'https://github.com/streamsage',
                        avatarUrl: 'https://ui-avatars.com/api/?name=SS&background=2ECC71&color=fff&size=200',
                        tier: 'Bronze Sponsor'
                    }
                ];
                
                resolve(mockSponsors);
            }, 800);
        });
    }
};

// Initialize when the document is ready
document.addEventListener('DOMContentLoaded', function() {
    GithubSponsors.init();
});


/* === modules/features/app-sponsor-rotation.js === */
/**
 * App Sponsor Banner Rotation
 * Shows rotating Daughter's Sponsor on all app pages (Sonarr, Radarr, etc.)
 * Same functionality as home page sponsor banner.
 */

(function() {
    const APP_SPONSOR_CACHE_KEY = 'app_sponsor_cache';
    const CACHE_DURATION = 60 * 1000; // 1 minute - sponsor stays the same across pages
    const ROTATION_INTERVAL = 60 * 1000; // 1 minute rotation

    const PARTNER_PROJECTS_CACHE_KEY = 'home_partner_projects_cache';
    const PARTNER_PROJECTS = [
        { name: 'Cleanuparr', url: 'https://github.com/Cleanuparr/Cleanuparr' },
        { name: 'SeekandWatch', url: 'https://github.com/softerfish/seekandwatch' }
    ];
    const APP_TYPES = ['sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros', 'prowlarr', 'requestarr'];
    // Home + all app pages use the same sponsor rotation (same cache, same 1-min interval)
    const SPONSOR_SECTIONS = ['home', ...APP_TYPES];
    // Smart Hunt has its own banner row in toolbar
    const SMARTHUNT_APP_TYPE = 'requestarr-smarthunt';
    // Additional pages that show sponsor/partner banners (same rotation)
    const EXTRA_BANNER_SECTIONS = ['media-hunt', 'media-hunt-collection', 'apps', 'settings', 'system', 'movie-hunt', 'movie-hunt-settings', 'media-hunt-settings', 'media-hunt-instances', 'media-hunt-calendar', 'movie-hunt-instance-management', 'movie-hunt-instance-editor', 'swaparr', 'activity', 'nzb-hunt', 'nzb-hunt-activity', 'nzb-hunt-settings', 'nzb-hunt-folders', 'nzb-hunt-servers', 'nzb-hunt-advanced', 'nzb-hunt-server-editor', 'notifications', 'backup-restore', 'scheduling', 'user', 'instance-editor', 'profile-editor', 'movie-management', 'settings-media-management', 'media-management', 'settings-profiles', 'settings-sizes', 'settings-custom-formats', 'settings-indexers', 'settings-clients', 'settings-import-lists', 'settings-import-media', 'media-hunt-import-media', 'settings-root-folders', 'settings-logs', 'indexer-hunt', 'indexer-hunt-stats', 'indexer-hunt-history', 'tv-hunt', 'tv-hunt-instance-management', 'tv-hunt-instance-editor', 'tv-hunt-settings-tv-management', 'tv-hunt-settings-profiles', 'tv-hunt-settings-sizes', 'tv-hunt-settings-custom-formats', 'tv-hunt-settings-indexers', 'tv-hunt-settings-clients', 'tv-hunt-settings-import-lists', 'tv-hunt-settings-root-folders'];

    let rotationInterval = null;
    let sponsors = [];
    let currentIndex = 0;
    
    function updateSponsorBanner(sponsor, appType) {
        const sponsorName = document.getElementById(`${appType}-sponsor-name`);
        const sponsorBanner = document.getElementById(`${appType}-sponsor-banner`);
        
        if (sponsorName) sponsorName.textContent = sponsor.name;
        
        // Update href to sponsor's GitHub URL
        if (sponsorBanner && sponsor.url) {
            sponsorBanner.href = sponsor.url;
            sponsorBanner.setAttribute('data-sponsor-url', sponsor.url);
        }
    }
    
    function getRandomSponsor(sponsors) {
        if (!sponsors || sponsors.length === 0) return null;
        const randomIndex = Math.floor(Math.random() * sponsors.length);
        return sponsors[randomIndex];
    }
    
    function getNextSponsor() {
        if (!sponsors || sponsors.length === 0) return null;
        const sponsor = sponsors[currentIndex];
        currentIndex = (currentIndex + 1) % sponsors.length;
        return sponsor;
    }
    
    function getCachedSponsor() {
        try {
            const cached = localStorage.getItem(APP_SPONSOR_CACHE_KEY);
            if (!cached) return null;
            
            const { sponsor, timestamp } = JSON.parse(cached);
            const now = Date.now();
            
            // Check if cache is still valid (within 1 minute)
            if (now - timestamp < CACHE_DURATION) {
                return { sponsor, timestamp };
            }
            
            // Cache expired, remove it
            localStorage.removeItem(APP_SPONSOR_CACHE_KEY);
            return null;
        } catch (e) {
            console.error('Error reading app sponsor cache:', e);
            return null;
        }
    }
    
    function cacheSponsor(sponsor) {
        try {
            const cacheData = {
                sponsor: sponsor,
                timestamp: Date.now()
            };
            localStorage.setItem(APP_SPONSOR_CACHE_KEY, JSON.stringify(cacheData));
        } catch (e) {
            console.error('Error caching app sponsor:', e);
        }
    }
    
    function updateAllAppBanners(sponsor) {
        SPONSOR_SECTIONS.forEach(section => {
            updateSponsorBanner(sponsor, section);
        });
        updateSponsorBanner(sponsor, SMARTHUNT_APP_TYPE);
        EXTRA_BANNER_SECTIONS.forEach(section => {
            updateSponsorBanner(sponsor, section);
        });
        // Update sidebar "Daughter's Sponsors" slot (reuses partner-projects IDs)
        const sidebarNameEl = document.getElementById('sidebar-partner-projects-name');
        const sidebarNavEl = document.getElementById('sidebar-partner-projects-nav');
        if (sidebarNameEl) sidebarNameEl.textContent = sponsor.name;
        if (sidebarNavEl && sponsor.url) sidebarNavEl.href = sponsor.url;
        // Update topbar sponsor chip
        const topbarName = document.getElementById('topbar-sponsor-name');
        const topbarBanner = document.getElementById('topbar-sponsor-banner');
        if (topbarName) topbarName.textContent = sponsor.name;
        if (topbarBanner && sponsor.url) {
            topbarBanner.href = sponsor.url;
        }
    }

    // Sidebar "Daughter's Sponsors" now uses the same sponsor rotation — no separate partner logic needed
    function loadPartnerProjects() {
        // No-op: sidebar sponsor slot is updated via updateAllAppBanners()
    }

    function doOneRotation() {
        const sponsor = getNextSponsor();
        if (sponsor) {
            updateAllAppBanners(sponsor);
            cacheSponsor(sponsor);
        }
    }

    function startRotation() {
        if (rotationInterval) {
            clearInterval(rotationInterval);
        }
        rotationInterval = setInterval(doOneRotation, ROTATION_INTERVAL);
    }
    
    const FALLBACK_SPONSORS = [
        { name: 'ElfHosted', url: 'https://github.com/elfhosted' },
        { name: 'simplytoast1', url: 'https://github.com/simplytoast1' },
        { name: 'TheOnlyLite', url: 'https://github.com/TheOnlyLite' },
        { name: 'tcconnally', url: 'https://github.com/tcconnally' },
        { name: 'StreamVault', url: 'https://github.com/streamvault' },
        { name: 'MediaServer Pro', url: 'https://github.com/mediaserverpro' },
        { name: 'NASGuru', url: 'https://github.com/nasguru' },
        { name: 'CloudCache', url: 'https://github.com/cloudcache' },
        { name: 'ServerSquad', url: 'https://github.com/serversquad' },
        { name: 'MediaMinder', url: 'https://github.com/mediaminder' },
        { name: 'StreamSage', url: 'https://github.com/streamsage' },
        { name: 'MediaStack', url: 'https://github.com/mediastack' }
    ];

    async function loadSponsors() {
        const cached = getCachedSponsor();
        
        if (cached) {
            // Keep showing cached sponsor for the full 1-minute window (no change on refresh/navigation)
            updateAllAppBanners(cached.sponsor);
            try {
                const response = await fetch('./api/github_sponsors');
                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                const data = await response.json();
                sponsors = (data && data.length > 0) ? data : FALLBACK_SPONSORS;
                
                if (sponsors.length > 0) {
                    sponsors = sponsors.sort(() => Math.random() - 0.5);
                    const idx = sponsors.findIndex(s => s.name === cached.sponsor.name && s.url === cached.sponsor.url);
                    currentIndex = idx >= 0 ? (idx + 1) % sponsors.length : 0;
                    const delay = cached.timestamp + CACHE_DURATION - Date.now();
                    if (delay > 0) {
                        setTimeout(() => {
                            doOneRotation();
                            startRotation();
                        }, delay);
                    } else {
                        doOneRotation();
                        startRotation();
                    }
                } else {
                    startRotation();
                }
            } catch (e) {
                console.error('Error fetching app sponsors:', e);
                sponsors = FALLBACK_SPONSORS;
                startRotation();
            }
            return;
        }
        
        // No valid cache: fetch, show one, cache it, rotate every 1 minute
        try {
            const response = await fetch('./api/github_sponsors');
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const data = await response.json();
            sponsors = (data && data.length > 0) ? data : FALLBACK_SPONSORS;
            
            if (sponsors.length > 0) {
                sponsors = sponsors.sort(() => Math.random() - 0.5);
                currentIndex = 0;
                doOneRotation();
                startRotation();
            } else {
                updateAllAppBanners({ name: 'Be the first!', url: 'https://plexguide.github.io/Huntarr.io/donate.html' });
            }
        } catch (error) {
            console.error('Error fetching app sponsors:', error);
            sponsors = FALLBACK_SPONSORS;
            sponsors = sponsors.sort(() => Math.random() - 0.5);
            currentIndex = 0;
            doOneRotation();
            startRotation();
        }
    }
    
    function init() {
        loadSponsors();
        loadPartnerProjects();
    }

    // Initialize when document is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Export for manual refresh if needed
    window.AppSponsorRotation = {
        refresh: function() {
            loadSponsors();
            loadPartnerProjects();
        },
        stop: function() {
            if (rotationInterval) {
                clearInterval(rotationInterval);
                rotationInterval = null;
            }
        }
    };
})();


/* === modules/features/swaparr-card.js === */
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
        
        var self = this;
        var doReset = function() {
            self.swaparrResetInProgress = true;
        
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
                        self.swaparrResetInProgress = false;
                    }, 1000);
                });
        } catch (error) {
            console.warn('Error in Swaparr stats reset:', error);
            self.swaparrResetInProgress = false;
        }
        };
        if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
            window.HuntarrConfirm.show({ title: 'Reset Swaparr Data', message: 'Are you sure you want to reset all Swaparr data? This will clear all strike counts and removed items data.', confirmLabel: 'Reset', onConfirm: doReset });
        } else {
            if (!confirm('Are you sure you want to reset all Swaparr data? This will clear all strike counts and removed items data.')) return;
            doReset();
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


/* === modules/features/prowlarr.js === */
/**
 * Prowlarr Module
 * Handles Prowlarr-specific functionality
 */

window.HuntarrProwlarr = {
    prowlarrStatsInterval: null,
    currentIndexerStats: null,

    loadProwlarrStatus: function() {
        const prowlarrCard = document.getElementById('prowlarrStatusCard');
        if (!prowlarrCard) return;

        // First check if Prowlarr is configured and enabled
        HuntarrUtils.fetchWithTimeout('./api/prowlarr/status')
            .then(response => response.json())
            .then(statusData => {
                // Only show card if Prowlarr is configured and enabled
                if (statusData.configured && statusData.enabled) {
                    prowlarrCard.style.display = 'block';
                    
                    // Update connection status
                    const statusElement = document.getElementById('prowlarrConnectionStatus');
                    if (statusElement) {
                        if (statusData.connected) {
                            statusElement.textContent = '🟢 Connected';
                            statusElement.className = 'status-badge connected';
                        } else {
                            statusElement.textContent = '🔴 Disconnected';
                            statusElement.className = 'status-badge error';
                        }
                    }
                    
                    // Load data if connected
                    if (statusData.connected) {
                        // Load indexers quickly first
                        this.loadProwlarrIndexers();
                        // Load statistics separately (cached)
                        this.loadProwlarrStats();
                        
                        // Set up periodic refresh for statistics (every 5 minutes)
                        if (!this.prowlarrStatsInterval) {
                            this.prowlarrStatsInterval = setInterval(() => {
                                this.loadProwlarrStats();
                            }, 5 * 60 * 1000); // 5 minutes
                        }
                    } else {
                        // Show disconnected state
                        this.updateIndexersList(null, 'Prowlarr is disconnected');
                        this.updateProwlarrStatistics(null, 'Prowlarr is disconnected');
                        
                        // Clear interval if disconnected
                        if (this.prowlarrStatsInterval) {
                            clearInterval(this.prowlarrStatsInterval);
                            this.prowlarrStatsInterval = null;
                        }
                    }
                    
                } else {
                    // Hide card if not configured or disabled
                    prowlarrCard.style.display = 'none';
                    console.log('[HuntarrProwlarr] Prowlarr card hidden - configured:', statusData.configured, 'enabled:', statusData.enabled);
                }
            })
            .catch(error => {
                console.error('Error loading Prowlarr status:', error);
                // Hide card on error
                prowlarrCard.style.display = 'none';
            });
    },

    loadProwlarrIndexers: function() {
        HuntarrUtils.fetchWithTimeout('./api/prowlarr/indexers')
            .then(response => response.json())
            .then(data => {
                if (data.success && data.indexer_details) {
                    this.updateIndexersList(data.indexer_details);
                } else {
                    console.error('Failed to load Prowlarr indexers:', data.error);
                    this.updateIndexersList(null, data.error || 'Failed to load indexers');
                }
            })
            .catch(error => {
                console.error('Error loading Prowlarr indexers:', error);
                this.updateIndexersList(null, 'Connection error');
            });
    },

    loadProwlarrStats: function() {
        HuntarrUtils.fetchWithTimeout('./api/prowlarr/stats')
            .then(response => response.json())
            .then(data => {
                if (data.success && data.stats) {
                    const normalizedStats = this.normalizeStatsPayload(data.stats);
                    this.currentIndexerStats = normalizedStats;
                    this.updateProwlarrStatistics(normalizedStats);
                } else {
                    console.error('Failed to load Prowlarr stats:', data.error);
                    this.updateProwlarrStatistics(null, data.error || 'Failed to load stats');
                }
            })
            .catch(error => {
                console.error('Error loading Prowlarr stats:', error);
                this.updateProwlarrStatistics(null, 'Connection error');
            });
    },

    normalizeStatsPayload: function(rawStats) {
        if (!rawStats || typeof rawStats !== 'object') {
            return null;
        }

        // Already in the legacy UI format expected by this module.
        if (rawStats.overall && rawStats.indexers) {
            return rawStats;
        }

        // Newer backend payload shape: flat keys + individual_indexer_stats/indexer_performance.
        const indexersByName = {};
        const individual = rawStats.individual_indexer_stats || {};
        Object.keys(individual).forEach((name) => {
            const idx = individual[name] || {};
            indexersByName[name] = {
                total_queries: Number(idx.queries ?? idx.searches_today ?? 0) || 0,
                total_grabs: Number(idx.grabs ?? idx.successful_today ?? 0) || 0,
                avg_response_time: Number(idx.response_time ?? 0) || 0
            };
        });

        // Fallback when individual stats aren't present but indexer_performance is.
        if (Object.keys(indexersByName).length === 0 && Array.isArray(rawStats.indexer_performance)) {
            rawStats.indexer_performance.forEach((idx) => {
                const name = idx && idx.name ? idx.name : 'Unknown';
                indexersByName[name] = {
                    total_queries: Number(idx.queries ?? idx.searches_today ?? 0) || 0,
                    total_grabs: Number(idx.grabs ?? idx.successful_today ?? 0) || 0,
                    avg_response_time: Number(idx.response_time ?? 0) || 0
                };
            });
        }

        const totalIndexers = Object.keys(indexersByName).length || Number(rawStats.total_indexers || 0) || 0;
        const totalQueries = Number(rawStats.searches_today ?? rawStats.total_queries ?? 0) || 0;
        const totalGrabs = Number(rawStats.grabs_today ?? rawStats.total_grabs ?? 0) || 0;
        const successRate = Number(rawStats.recent_success_rate ?? 0) || 0;
        const failedSearches = Number(rawStats.recent_failed_searches ?? 0) || 0;
        const avgResponseTime = Number(rawStats.avg_response_time ?? 0) || 0;

        return {
            overall: {
                total_queries: totalQueries,
                total_grabs: totalGrabs,
                total_indexers: totalIndexers,
                success_rate: successRate,
                failed_searches: failedSearches,
                avg_response_time: avgResponseTime
            },
            indexers: indexersByName
        };
    },

    updateIndexersList: function(indexerDetails, errorMessage = null) {
        const indexersList = document.getElementById('prowlarr-indexers-list');
        if (!indexersList) return;
        
        if (errorMessage) {
            indexersList.innerHTML = `<div class="loading-text" style="color: #ef4444;">${errorMessage}</div>`;
            return;
        }
        
        if (!indexerDetails || (!indexerDetails.active && !indexerDetails.throttled && !indexerDetails.failed)) {
            indexersList.innerHTML = '<div class="loading-text">No indexers configured</div>';
            return;
        }
        
        // Combine all indexers and sort alphabetically
        let allIndexers = [];
        
        if (indexerDetails.active) {
            allIndexers = allIndexers.concat(
                indexerDetails.active.map(idx => ({ ...idx, status: 'active' }))
            );
        }
        
        if (indexerDetails.throttled) {
            allIndexers = allIndexers.concat(
                indexerDetails.throttled.map(idx => ({ ...idx, status: 'throttled' }))
            );
        }
        
        if (indexerDetails.failed) {
            allIndexers = allIndexers.concat(
                indexerDetails.failed.map(idx => ({ ...idx, status: 'failed' }))
            );
        }
        
        // Sort alphabetically by name
        allIndexers.sort((a, b) => a.name.localeCompare(b.name));
        
        if (allIndexers.length === 0) {
            indexersList.innerHTML = '<div class="loading-text">No indexers found</div>';
            return;
        }
        
        // Build the HTML for indexers list with hover interactions
        const indexersHtml = allIndexers.map(indexer => {
            const statusText = indexer.status === 'active' ? 'Active' :
                             indexer.status === 'throttled' ? 'Throttled' :
                             'Failed';
            
            return `
                <div class="indexer-item" data-indexer-name="${indexer.name}">
                    <span class="indexer-name hoverable">${indexer.name}</span>
                    <span class="indexer-status ${indexer.status}">${statusText}</span>
                </div>
            `;
        }).join('');
        
        indexersList.innerHTML = indexersHtml;
        
        // Add hover event listeners to indexer names
        const indexerItems = indexersList.querySelectorAll('.indexer-item');
        indexerItems.forEach(item => {
            const indexerName = item.dataset.indexerName;
            const nameElement = item.querySelector('.indexer-name');
            
            nameElement.addEventListener('mouseenter', () => {
                this.showIndexerStats(indexerName);
                nameElement.classList.add('hovered');
            });
            
            nameElement.addEventListener('mouseleave', () => {
                this.showOverallStats();
                nameElement.classList.remove('hovered');
            });
        });
    },

    updateProwlarrStatistics: function(stats, errorMessage = null) {
        const statisticsContent = document.getElementById('prowlarr-statistics-content');
        if (!statisticsContent) return;
        
        if (errorMessage) {
            statisticsContent.innerHTML = `<div class="loading-text" style="color: #ef4444;">${errorMessage}</div>`;
            return;
        }
        
        if (!stats) {
            statisticsContent.innerHTML = '<div class="loading-text">No statistics available</div>';
            return;
        }
        
        // Store stats for hover functionality
        this.currentIndexerStats = stats;
        
        // Show overall stats by default
        this.showOverallStats();
    },

    showIndexerStats: function(indexerName) {
        if (!this.currentIndexerStats || !this.currentIndexerStats.indexers) return;
        
        const indexerStats = this.currentIndexerStats.indexers[indexerName];
        if (!indexerStats) return;
        
        const statisticsContent = document.getElementById('prowlarr-statistics-content');
        if (!statisticsContent) return;
        
        const formatNumber = window.HuntarrStats ? 
            window.HuntarrStats.formatLargeNumber.bind(window.HuntarrStats) : 
            (n => n.toLocaleString());
        const formatExactNumber = (n) => {
            const v = Number(n || 0);
            return Number.isFinite(v) ? String(Math.round(v)) : '0';
        };
        
        statisticsContent.innerHTML = `
            <div class="stat-card">
                <div class="stat-label">SEARCHES (24H)</div>
                <div class="stat-value success">${formatExactNumber(indexerStats.total_queries || 0)}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">GRABS (24H)</div>
                <div class="stat-value success">${formatExactNumber(indexerStats.total_grabs || 0)}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">SUCCESS RATE</div>
                <div class="stat-value success">${indexerStats.avg_response_time ? ((indexerStats.total_grabs || 0) / Math.max(indexerStats.total_queries || 1, 1) * 100).toFixed(1) + '%' : 'N/A'}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">AVG RESPONSE</div>
                <div class="stat-value success">${indexerStats.avg_response_time ? Number(indexerStats.avg_response_time).toFixed(0) + 'ms' : 'N/A'}</div>
            </div>
            <div class="indexer-name-display">${indexerName}</div>
        `;
    },

    showOverallStats: function() {
        if (!this.currentIndexerStats || !this.currentIndexerStats.overall) return;
        
        const statisticsContent = document.getElementById('prowlarr-statistics-content');
        if (!statisticsContent) return;
        
        const overall = this.currentIndexerStats.overall;
        const formatNumber = window.HuntarrStats ? 
            window.HuntarrStats.formatLargeNumber.bind(window.HuntarrStats) : 
            (n => n.toLocaleString());
        const formatExactNumber = (n) => {
            const v = Number(n || 0);
            return Number.isFinite(v) ? String(Math.round(v)) : '0';
        };
        
        statisticsContent.innerHTML = `
            <div class="stat-card">
                <div class="stat-label">SEARCHES (24H)</div>
                <div class="stat-value success">${formatExactNumber(overall.total_queries || 0)}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">GRABS (24H)</div>
                <div class="stat-value success">${formatExactNumber(overall.total_grabs || 0)}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">SUCCESS RATE</div>
                <div class="stat-value success">${(Number(overall.success_rate || 0)).toFixed(1)}%</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">AVG RESPONSE</div>
                <div class="stat-value success">${overall.avg_response_time ? Number(overall.avg_response_time).toFixed(0) + 'ms' : 'N/A'}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">FAILED TODAY</div>
                <div class="stat-value error">${formatExactNumber(overall.failed_searches || 0)}</div>
            </div>
        `;
    },

    setupProwlarrStatusPolling: function() {
        // Load initial status
        this.loadProwlarrStatus();
        
        // Set up polling to refresh Prowlarr status every 30 seconds
        setInterval(() => {
            if (window.huntarrUI && window.huntarrUI.currentSection === 'home') {
                this.loadProwlarrStatus();
            }
        }, 30000);
    },

    initializeProwlarr: function() {
        console.log('[HuntarrProwlarr] Initializing Prowlarr section');
        
        // Load Prowlarr status when section is shown
        this.loadProwlarrStatus();
        
        // Any other Prowlarr-specific initialization
    }
};


/* === modules/features/setup-wizard.js === */
/**
 * Media Hunt Setup Wizard — guided configuration flow inside Media Hunt.
 *
 * Shows a full-takeover wizard when the user first navigates to any Media
 * Hunt section and essential configuration is missing.  Steps:
 *   1. Instance   2. Indexers   3. Root Folders   4. Download Client
 *   5. (conditional) Usenet Servers — shown only when NZB Hunt is configured
 *      as the download client.
 *
 * Once all steps are complete **or** the user clicks "Skip", the wizard
 * never appears again (flag stored in localStorage).
 *
 * Attaches to window.SetupWizard.
 */
(function() {
    'use strict';

    var PREF_KEY = 'media-hunt-wizard-completed';
    var TOTAL_BASE_STEPS = 4;          // steps 1-4 (always present)
    var stepStatus = { 1: false, 2: false, 3: false, 4: false, 5: false };
    var nzbHuntIsClient = false;       // whether step 5 is relevant
    var _refreshing = false;

    // ── Public API ───────────────────────────────────────────────────
    window.SetupWizard = {
        /**
         * Should the wizard be shown?  Checks localStorage first (fast path)
         * then verifies against APIs.  Calls `cb(needsWizard)`.
         */
        check: function(cb) {
            if (_isDismissed()) { cb(false); return; }

            // If a force-reset was requested, always show the wizard once
            var forceShow = false;
            try { forceShow = sessionStorage.getItem('setup-wizard-force-show') === '1'; } catch (e) {}

            _checkAllSteps(function() {
                var allDone = _allStepsComplete();
                if (allDone && !forceShow) {
                    // All steps done — mark complete so wizard and banners never show again
                    _markComplete();
                    cb(false);
                } else {
                    // Clear the force flag so it only applies once
                    try { sessionStorage.removeItem('setup-wizard-force-show'); } catch (e) {}
                    cb(true);
                }
            });
        },

        /**
         * Show the wizard view and update its step indicators.
         * Called by app.js after `check()` returns true.
         */
        show: function() {
            var view = document.getElementById('media-hunt-setup-wizard-view');
            if (view) view.style.display = '';
            _setSidebarVisible(false);
            _setSponsorsVisible(false);
            // Restore any page-header-bars that were hidden during wizard navigation
            var hiddenHeaders = document.querySelectorAll('.page-header-bar');
            for (var i = 0; i < hiddenHeaders.length; i++) {
                hiddenHeaders[i].style.display = '';
            }
            _updateStepUI();
            _expandFirstIncomplete();
            _maybeShowReturnBanner();
        },

        /**
         * Hide the wizard view and restore sidebar.
         */
        hide: function() {
            var view = document.getElementById('media-hunt-setup-wizard-view');
            if (view) view.style.display = 'none';
            _setSidebarVisible(true);
            _setSponsorsVisible(true);
        },

        /**
         * Re-check all steps and update UI.  Used when user returns from
         * a configuration page back to any Media Hunt section.
         */
        refresh: function(cb) {
            if (_refreshing) { if (cb) cb(); return; }
            _refreshing = true;
            _checkAllSteps(function() {
                _refreshing = false;
                var allDone = _allStepsComplete();
                if (allDone) {
                    // All steps done — mark complete so wizard and banners never show again
                    _markComplete();
                    if (cb) cb();
                    return;
                }
                _updateStepUI();
                _expandFirstIncomplete();
                if (cb) cb();
            });
        },

        /** Cached status from last check. */
        isComplete: function() {
            return _isDismissed() || _allStepsComplete();
        },

        /**
         * Call after successful save on a wizard-related config page (instances,
         * indexers, root folders, clients). If the wizard is still incomplete,
         * redirects to Collections so the wizard refreshes and shows the next step.
         */
        maybeReturnToCollection: function() {
            if (this.isComplete()) return;
            try { sessionStorage.setItem('setup-wizard-return-from-config', '1'); } catch (e) {}
            if (window.huntarrUI && typeof window.huntarrUI.switchSection === 'function') {
                window.huntarrUI.switchSection('media-hunt-collection');
            } else {
                window.location.hash = '#media-hunt-collection';
            }
        }
    };

    // ── Helpers ───────────────────────────────────────────────────────
    function _isDismissed() {
        return HuntarrUtils.getUIPreference(PREF_KEY, false) === true;
    }

    function _markComplete() {
        HuntarrUtils.setUIPreference(PREF_KEY, true);
        // Clear the wizard navigation flag so banners stop showing
        try { sessionStorage.removeItem('setup-wizard-active-nav'); } catch (e) {}
    }

    function _totalSteps() {
        return nzbHuntIsClient ? TOTAL_BASE_STEPS + 1 : TOTAL_BASE_STEPS;
    }

    function _allStepsComplete() {
        for (var s = 1; s <= _totalSteps(); s++) {
            if (!stepStatus[s]) return false;
        }
        return true;
    }

    function _setSidebarVisible(visible) {
        var wrapper = document.getElementById('sidebar-wrapper');
        if (wrapper) wrapper.style.display = visible ? '' : 'none';
    }

    function _setSponsorsVisible(visible) {
        if (visible) {
            document.body.classList.remove('setup-wizard-active');
        } else {
            document.body.classList.add('setup-wizard-active');
        }
    }

    function _maybeShowReturnBanner() {
        try {
            if (sessionStorage.getItem('setup-wizard-return-from-config') !== '1') return;
            sessionStorage.removeItem('setup-wizard-return-from-config');
        } catch (e) { return; }
        var wizard = document.getElementById('media-hunt-setup-wizard');
        if (!wizard) return;
        var banner = document.createElement('div');
        banner.className = 'setup-wizard-return-banner';
        banner.setAttribute('role', 'status');
        banner.innerHTML = '<i class="fas fa-check-circle"></i> Configuration saved! Continue with the next step below.';
        wizard.insertBefore(banner, wizard.firstChild);
        setTimeout(function() {
            banner.style.opacity = '0';
            banner.style.transition = 'opacity 0.3s ease';
            setTimeout(function() { if (banner.parentNode) banner.parentNode.removeChild(banner); }, 300);
        }, 4500);
    }

    // ── Step Checks ─────────────────────────────────────────────────
    function _checkAllSteps(cb) {
        var ts = '?_=' + Date.now();
        Promise.all([
            fetch('./api/movie-hunt/instances' + ts, { cache: 'no-store' }).then(function(r) { return r.json(); }),
            fetch('./api/tv-hunt/instances' + ts, { cache: 'no-store' }).then(function(r) { return r.json(); }),
            fetch('./api/indexer-hunt/indexers' + ts, { cache: 'no-store' }).then(function(r) { return r.json(); }),
            fetch('./api/movie-hunt/has-clients' + ts, { cache: 'no-store' }).then(function(r) { return r.json(); }),
            fetch('./api/nzb-hunt/is-client-configured' + ts, { cache: 'no-store' }).then(function(r) { return r.json(); }).catch(function() { return { configured: false }; })
        ]).then(function(results) {
            var movieInstances = results[0].instances || [];
            var tvInstances    = results[1].instances || [];
            var indexers       = results[2].indexers || [];
            var hasClients     = results[3].has_clients === true;
            nzbHuntIsClient    = results[4].configured === true;

            stepStatus[1] = movieInstances.length > 0 || tvInstances.length > 0;
            stepStatus[2] = indexers.length > 0;
            stepStatus[4] = hasClients;

            // Toggle step 5 visibility
            var step5el = document.getElementById('setup-step-5');
            if (step5el) step5el.style.display = nzbHuntIsClient ? '' : 'none';

            // Root folders — need at least one instance first
            if (stepStatus[1]) {
                _checkRootFolders(movieInstances, tvInstances, function(hasRoots) {
                    stepStatus[3] = hasRoots;
                    // NZB servers
                    if (nzbHuntIsClient) {
                        _checkNzbServers(function(hasServers) {
                            stepStatus[5] = hasServers;
                            if (cb) cb();
                        });
                    } else {
                        stepStatus[5] = true; // not applicable — treat as done
                        if (cb) cb();
                    }
                });
            } else {
                stepStatus[3] = false;
                if (nzbHuntIsClient) {
                    _checkNzbServers(function(hasServers) {
                        stepStatus[5] = hasServers;
                        if (cb) cb();
                    });
                } else {
                    stepStatus[5] = true;
                    if (cb) cb();
                }
            }
        }).catch(function() {
            stepStatus[1] = stepStatus[2] = stepStatus[3] = stepStatus[4] = stepStatus[5] = false;
            nzbHuntIsClient = false;
            if (cb) cb();
        });
    }

    function _checkRootFolders(movieInstances, tvInstances, cb) {
        var fetches = [];
        if (movieInstances.length > 0) {
            fetches.push(
                fetch('./api/movie-hunt/root-folders', { cache: 'no-store' })
                    .then(function(r) { return r.json(); })
                    .then(function(d) { return (d.root_folders || d.rootFolders || []).length > 0; })
                    .catch(function() { return false; })
            );
        }
        if (tvInstances.length > 0) {
            fetches.push(
                fetch('./api/tv-hunt/root-folders', { cache: 'no-store' })
                    .then(function(r) { return r.json(); })
                    .then(function(d) { return (d.root_folders || d.rootFolders || []).length > 0; })
                    .catch(function() { return false; })
            );
        }
        if (fetches.length === 0) { cb(false); return; }
        Promise.all(fetches).then(function(results) {
            cb(results.some(function(v) { return v; }));
        }).catch(function() { cb(false); });
    }

    function _checkNzbServers(cb) {
        fetch('./api/nzb-hunt/home-stats', { cache: 'no-store' })
            .then(function(r) { return r.json(); })
            .then(function(d) {
                // API returns has_servers (boolean) or servers (array)
                var hasServers = d.has_servers === true || (d.servers && d.servers.length > 0);
                cb(hasServers);
            })
            .catch(function() { cb(false); });
    }

    // ── UI Updates ──────────────────────────────────────────────────
    function _updateStepUI() {
        var total = _totalSteps();
        var completedCount = 0;

        for (var s = 1; s <= 5; s++) {
            var stepEl    = document.getElementById('setup-step-' + s);
            var indicator = document.getElementById('setup-step-indicator-' + s);
            if (!stepEl || !indicator) continue;
            if (s > total) { stepEl.style.display = 'none'; continue; }

            stepEl.classList.remove('completed', 'current');

            if (stepStatus[s]) {
                stepEl.classList.add('completed');
                completedCount++;
                if (!indicator.querySelector('.step-check')) {
                    var check = document.createElement('i');
                    check.className = 'fas fa-check step-check';
                    indicator.appendChild(check);
                }
            } else {
                // Remove leftover check icon if step became incomplete
                var existing = indicator.querySelector('.step-check');
                if (existing) existing.remove();
            }
        }

        // Mark first incomplete step as "current"
        for (var s = 1; s <= total; s++) {
            if (!stepStatus[s]) {
                var el = document.getElementById('setup-step-' + s);
                if (el) el.classList.add('current');
                break;
            }
        }

        // Progress bar
        var fill = document.getElementById('setup-wizard-progress-fill');
        if (fill) {
            fill.style.width = (completedCount / total * 100) + '%';
        }
    }

    function _expandFirstIncomplete() {
        var total = _totalSteps();
        for (var s = 1; s <= 5; s++) {
            var el = document.getElementById('setup-step-' + s);
            if (el) el.classList.remove('expanded');
        }
        for (var s = 1; s <= total; s++) {
            if (!stepStatus[s]) {
                _expandStep(s);
                break;
            }
        }
    }

    function _expandStep(num) {
        var stepEl = document.getElementById('setup-step-' + num);
        if (!stepEl) return;
        for (var s = 1; s <= 5; s++) {
            var el = document.getElementById('setup-step-' + s);
            if (el && s !== num) el.classList.remove('expanded');
        }
        stepEl.classList.toggle('expanded');
    }

    // ── Event Bindings ──────────────────────────────────────────────
    function _bindEvents() {
        document.addEventListener('click', function(e) {
            // Wizard nav buttons (use switchSection for reliable navigation)
            var navBtn = e.target.closest('[data-wizard-nav]');
            if (navBtn) {
                var section = navBtn.getAttribute('data-wizard-nav');
                // Mark that user is navigating from the setup wizard
                try {
                    sessionStorage.setItem('setup-wizard-active-nav', '1');
                } catch (e2) {}
                if (section && window.huntarrUI && typeof window.huntarrUI.switchSection === 'function') {
                    window.huntarrUI.switchSection(section);
                } else if (section) {
                    window.location.hash = '#' + section;
                }
                // Hide the back/breadcrumb in the target section's header bar
                // (redundant during setup — the "Continue to Setup Guide" banner
                // provides all the navigation the user needs)
                // NOTE: Only hide .reqset-toolbar-left, NOT the entire .page-header-bar,
                // because the save button lives in .reqset-toolbar-right and must stay visible.
                setTimeout(function() {
                    var allSections = document.querySelectorAll('.content-section');
                    for (var i = 0; i < allSections.length; i++) {
                        if (allSections[i].style.display !== 'none' && allSections[i].offsetParent !== null) {
                            var toolbarLeft = allSections[i].querySelector('.page-header-bar .reqset-toolbar-left');
                            if (toolbarLeft) toolbarLeft.style.display = 'none';
                        }
                    }
                }, 150);
                return;
            }

            // Step header toggle
            var header = e.target.closest('[data-step-toggle]');
            if (header) {
                var step = parseInt(header.getAttribute('data-step-toggle'), 10);
                if (!isNaN(step)) _expandStep(step);
            }

            // Skip button — permanently dismiss
            if (e.target.closest('#setup-wizard-skip')) {
                _markComplete();
                window.SetupWizard.hide();
                var collView = document.getElementById('media-hunt-collection-view');
                if (collView) collView.style.display = 'block';
                if (window.MediaHuntCollection && typeof window.MediaHuntCollection.init === 'function') {
                    window.MediaHuntCollection.init();
                }
            }
        });
    }

    // ── Init ────────────────────────────────────────────────────────
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _bindEvents);
    } else {
        _bindEvents();
    }
})();


/* === modules/features/huntarr-chat.js === */
/**
 * Huntarr Chat — lightweight floating chat widget
 * Polls for new messages every 8s when open, 30s when closed.
 * Owner gets moderator controls (delete any message, clear all).
 */
window.HuntarrChat = (function() {
    'use strict';

    let _panel = null;
    let _fab = null;
    let _messagesEl = null;
    let _inputEl = null;
    let _isOpen = false;
    let _user = null;       // { username, role }
    let _messages = [];
    let _pollTimer = null;
    let _lastMsgId = 0;
    let _unreadCount = 0;
    let _badgeEl = null;
    let _initialized = false;

    const POLL_OPEN = 8000;
    const POLL_CLOSED = 30000;

    // ── Init ──────────────────────────────────────────────────
    function init() {
        if (_initialized) return;
        _initialized = true;
        // Don't build DOM yet — wait until we confirm auth
        _checkAuthAndInit();
    }

    function _checkAuthAndInit() {
        fetch('./api/chat')
            .then(function(r) { return r.ok ? r.json() : Promise.reject(r.status); })
            .then(function(data) {
                _user = data.user;
                _messages = data.messages || [];
                if (_messages.length) _lastMsgId = _messages[_messages.length - 1].id;
                // User is authenticated — now build the UI
                _buildDOM();
                // Show clear button for owner
                var clearBtn = document.getElementById('hchat-clear-btn');
                if (clearBtn) clearBtn.style.display = _user.role === 'owner' ? '' : 'none';
                _renderMessages();
                _startPolling();
            })
            .catch(function() {
                // Not authenticated (login page) — do nothing, no FAB
            });
    }

    // ── Build DOM ─────────────────────────────────────────────
    function _buildDOM() {
        // FAB
        _fab = document.createElement('button');
        _fab.className = 'hchat-fab';
        _fab.setAttribute('aria-label', 'Open chat');
        _fab.innerHTML = '<i class="fas fa-comments"></i><span class="hchat-badge" style="display:none;"></span>';
        _fab.addEventListener('click', _toggle);
        document.body.appendChild(_fab);
        _badgeEl = _fab.querySelector('.hchat-badge');

        // Panel
        _panel = document.createElement('div');
        _panel.className = 'hchat-panel';
        _panel.innerHTML =
            '<div class="hchat-header">' +
                '<div class="hchat-header-left">' +
                    '<i class="fas fa-comments"></i>' +
                    '<span>Chat</span>' +
                '</div>' +
                '<div class="hchat-header-actions">' +
                    '<button class="hchat-header-btn danger" id="hchat-clear-btn" title="Clear all messages" style="display:none;">' +
                        '<i class="fas fa-trash-alt"></i>' +
                    '</button>' +
                    '<button class="hchat-header-btn" id="hchat-close-btn" title="Close">' +
                        '<i class="fas fa-times"></i>' +
                    '</button>' +
                '</div>' +
            '</div>' +
            '<div class="hchat-messages" id="hchat-messages"></div>' +
            '<div class="hchat-input-area">' +
                '<textarea class="hchat-input" id="hchat-input" placeholder="Type a message..." rows="1" maxlength="500"></textarea>' +
                '<button class="hchat-send" id="hchat-send-btn" disabled aria-label="Send">' +
                    '<i class="fas fa-paper-plane"></i>' +
                '</button>' +
            '</div>';
        document.body.appendChild(_panel);

        _messagesEl = document.getElementById('hchat-messages');
        _inputEl = document.getElementById('hchat-input');

        document.getElementById('hchat-close-btn').addEventListener('click', _toggle);
        document.getElementById('hchat-send-btn').addEventListener('click', _sendMessage);
        document.getElementById('hchat-clear-btn').addEventListener('click', _clearAll);

        _inputEl.addEventListener('input', function() {
            document.getElementById('hchat-send-btn').disabled = !_inputEl.value.trim();
            // Auto-resize
            _inputEl.style.height = 'auto';
            _inputEl.style.height = Math.min(_inputEl.scrollHeight, 80) + 'px';
        });
        _inputEl.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (_inputEl.value.trim()) _sendMessage();
            }
        });
    }

    // ── Toggle ────────────────────────────────────────────────
    function _toggle() {
        _isOpen = !_isOpen;
        _panel.classList.toggle('open', _isOpen);
        _fab.setAttribute('aria-label', _isOpen ? 'Close chat' : 'Open chat');
        if (_isOpen) {
            _unreadCount = 0;
            _updateBadge();
            _scrollToBottom();
            _inputEl.focus();
            _restartPolling();
        } else {
            _restartPolling();
        }
    }

    // ── Load Messages (replaced by _checkAuthAndInit on first load) ──

    // ── Poll for new messages ─────────────────────────────────
    function _startPolling() {
        _pollTimer = setInterval(_pollNew, _isOpen ? POLL_OPEN : POLL_CLOSED);
    }
    function _restartPolling() {
        clearInterval(_pollTimer);
        _startPolling();
    }
    function _pollNew() {
        fetch('./api/chat')
            .then(function(r) { return r.ok ? r.json() : Promise.reject(r.status); })
            .then(function(data) {
                _user = data.user;
                var msgs = data.messages || [];
                if (!msgs.length) {
                    if (_messages.length) { _messages = []; _lastMsgId = 0; _renderMessages(); }
                    return;
                }
                var newLastId = msgs[msgs.length - 1].id;
                if (newLastId !== _lastMsgId || msgs.length !== _messages.length) {
                    var hadMessages = _messages.length;
                    // Count how many new messages since last check
                    var newCount = 0;
                    if (hadMessages && newLastId > _lastMsgId) {
                        for (var i = msgs.length - 1; i >= 0; i--) {
                            if (msgs[i].id > _lastMsgId) newCount++;
                            else break;
                        }
                    }
                    _messages = msgs;
                    _lastMsgId = newLastId;
                    _renderMessages();
                    if (!_isOpen && newCount > 0) {
                        _unreadCount += newCount;
                        _updateBadge();
                    }
                    if (_isOpen) _scrollToBottom();
                }
            })
            .catch(function() {});
    }

    // ── Render ────────────────────────────────────────────────
    function _renderMessages() {
        if (!_messagesEl) return;
        if (!_messages.length) {
            _messagesEl.innerHTML =
                '<div class="hchat-empty">' +
                    '<i class="fas fa-comments"></i>' +
                    '<span>No messages yet. Say hi!</span>' +
                '</div>';
            return;
        }
        var html = '';
        var lastDate = '';
        for (var i = 0; i < _messages.length; i++) {
            var m = _messages[i];
            var isSelf = _user && m.username === _user.username;
            var msgDate = _formatDate(m.created_at);
            if (msgDate !== lastDate) {
                html += '<div class="hchat-date-sep"><span>' + msgDate + '</span></div>';
                lastDate = msgDate;
            }
            var canDelete = _user && (_user.role === 'owner' || isSelf);
            html += '<div class="hchat-msg ' + (isSelf ? 'self' : 'other') + '" data-id="' + m.id + '">';
            html += '<div class="hchat-msg-meta">';
            html += '<span class="hchat-msg-author">' + _escHtml(m.username) + '</span>';
            html += '<span class="hchat-msg-role ' + m.role + '">' + m.role + '</span>';
            html += '<span class="hchat-msg-time">' + _formatTime(m.created_at) + '</span>';
            html += '</div>';
            html += '<div class="hchat-msg-row">';
            if (canDelete && isSelf) {
                html += '<button class="hchat-msg-delete" data-id="' + m.id + '" title="Delete" aria-label="Delete message"><i class="fas fa-trash-alt"></i></button>';
            }
            html += '<div class="hchat-msg-bubble">' + _escHtml(m.message) + '</div>';
            if (canDelete && !isSelf) {
                html += '<button class="hchat-msg-delete" data-id="' + m.id + '" title="Delete" aria-label="Delete message"><i class="fas fa-trash-alt"></i></button>';
            }
            html += '</div></div>';
        }
        _messagesEl.innerHTML = html;
        // Attach delete handlers
        _messagesEl.querySelectorAll('.hchat-msg-delete').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                _deleteMessage(parseInt(btn.getAttribute('data-id')));
            });
        });
        _scrollToBottom();
    }

    // ── Send ──────────────────────────────────────────────────
    function _sendMessage() {
        var text = _inputEl.value.trim();
        if (!text) return;
        var sendBtn = document.getElementById('hchat-send-btn');
        sendBtn.disabled = true;
        _inputEl.value = '';
        _inputEl.style.height = 'auto';

        fetch('./api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: text })
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.success && data.message) {
                _messages.push(data.message);
                _lastMsgId = data.message.id;
                _renderMessages();
            }
        })
        .catch(function() {})
        .finally(function() { sendBtn.disabled = !_inputEl.value.trim(); });
    }

    // ── Delete ────────────────────────────────────────────────
    function _deleteMessage(id) {
        fetch('./api/chat/' + id, { method: 'DELETE' })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (data.success) {
                    _messages = _messages.filter(function(m) { return m.id !== id; });
                    _renderMessages();
                }
            })
            .catch(function() {});
    }

    // ── Clear All ─────────────────────────────────────────────
    function _clearAll() {
        if (!window.HuntarrConfirm) {
            if (!confirm('Clear all chat messages?')) return;
            _doClear();
        } else {
            window.HuntarrConfirm.show({
                title: 'Clear Chat',
                message: 'Delete all chat messages? This cannot be undone.',
                confirmText: 'Clear All',
                confirmClass: 'danger',
                onConfirm: _doClear
            });
        }
    }
    function _doClear() {
        fetch('./api/chat/clear', { method: 'POST' })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (data.success) {
                    _messages = [];
                    _lastMsgId = 0;
                    _renderMessages();
                }
            })
            .catch(function() {});
    }

    // ── Helpers ───────────────────────────────────────────────
    function _updateBadge() {
        if (!_badgeEl) return;
        if (_unreadCount > 0) {
            _badgeEl.textContent = _unreadCount > 99 ? '99+' : _unreadCount;
            _badgeEl.style.display = '';
        } else {
            _badgeEl.style.display = 'none';
        }
    }

    function _scrollToBottom() {
        if (_messagesEl) {
            requestAnimationFrame(function() {
                _messagesEl.scrollTop = _messagesEl.scrollHeight;
            });
        }
    }
    function _formatTime(ts) {
        if (!ts) return '';
        try {
            var d = new Date(ts.replace(' ', 'T') + 'Z');
            return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } catch(e) { return ''; }
    }
    function _formatDate(ts) {
        if (!ts) return '';
        try {
            var d = new Date(ts.replace(' ', 'T') + 'Z');
            var now = new Date();
            if (d.toDateString() === now.toDateString()) return 'Today';
            var yesterday = new Date(now);
            yesterday.setDate(yesterday.getDate() - 1);
            if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
            return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
        } catch(e) { return ''; }
    }
    function _escHtml(s) {
        var div = document.createElement('div');
        div.textContent = s;
        return div.innerHTML;
    }

    return { init: init };
})();

// Auto-init when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    // Small delay to let auth settle
    setTimeout(function() { window.HuntarrChat.init(); }, 1500);
});
