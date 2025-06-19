/**
 * Huntarr - Apps Module
 * Handles displaying and managing app settings for media server applications
 */

const appsModule = {
    // State
    currentApp: null,
    isLoading: false,
    settingsChanged: false, // Flag to track unsaved settings changes
    originalSettings: {}, // Store original settings to compare
    appsWithChanges: [], // Track which apps have unsaved changes
    
    // DOM elements
    elements: {},
    
    // Initialize the apps module
    init: function() {
        // Initialize state
        this.currentApp = null;
        this.settingsChanged = false; // Flag to track unsaved settings changes
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
        
        // Load apps for initial display
        this.loadApps();
        
        // Register with the main unsaved changes system if available
        this.registerUnsavedChangesHandler();
    },
    
    // Register with the main unsaved changes system
    registerUnsavedChangesHandler: function() {
        // Temporarily disabled - will be re-implemented in the future
        console.log('[Apps] Unsaved changes detection disabled');
    },
    
    // Check for unsaved changes before navigating away
    hasUnsavedChanges: function() {
        // Temporarily disabled - will be re-implemented in the future
        return false;
    },
    
    // Cache DOM elements
    cacheElements: function() {
        this.elements = {
            // Apps dropdown
            appsOptions: document.querySelectorAll('#appsSection .log-option'),
            currentAppsApp: document.getElementById('current-apps-app'),
            appsDropdownBtn: document.querySelector('#appsSection .log-dropdown-btn'),
            appsDropdownContent: document.querySelector('#appsSection .log-dropdown-content'),
            
            // Apps panels
            appAppsPanels: document.querySelectorAll('.app-apps-panel'),
            
            // Controls - auto-save enabled, no save button needed
        };
    },
    
    // Set up event listeners
    setupEventListeners: function() {
        // App selection via <select>
        const appsAppSelect = document.getElementById('appsAppSelect');
        if (appsAppSelect) {
            appsAppSelect.addEventListener('change', (e) => {
                const app = e.target.value;
                this.handleAppsAppChange(app);
            });
        }
        
        // Dropdown toggle
        if (this.elements.appsDropdownBtn) {
            this.elements.appsDropdownBtn.addEventListener('click', () => {
                this.elements.appsDropdownContent.classList.toggle('show');
                
                // Close all other dropdowns
                document.querySelectorAll('.log-dropdown-content.show').forEach(dropdown => {
                    if (dropdown !== this.elements.appsDropdownContent) {
                        dropdown.classList.remove('show');
                    }
                });
            });
        }
        
        // Close dropdown when clicking outside
        document.addEventListener('click', e => {
            if (!e.target.matches('#appsSection .log-dropdown-btn') && 
                !e.target.closest('#appsSection .log-dropdown-btn')) {
                if (this.elements.appsDropdownContent && this.elements.appsDropdownContent.classList.contains('show')) {
                    this.elements.appsDropdownContent.classList.remove('show');
                }
            }
        });

        // Auto-save enabled - no save button needed
    },
    
    // Load apps for initial display
    loadApps: function() {
        // Set default app if none is selected
        if (!this.currentApp) {
            this.currentApp = 'sonarr'; // Default to Sonarr
            
            // Update the dropdown text to show current app
            if (this.elements.currentAppsApp) {
                this.elements.currentAppsApp.textContent = 'Sonarr';
            }
            
            // Mark the sonarr option as active in the dropdown
            if (this.elements.appsOptions) {
                this.elements.appsOptions.forEach(option => {
                    option.classList.remove('active');
                    if (option.getAttribute('data-app') === 'sonarr') {
                        option.classList.add('active');
                    }
                });
            }
        }
        
        // Load the currently selected app
        this.loadAppSettings(this.currentApp);
    },
    
    // Load app settings
    loadAppSettings: function(app) {
        console.log(`[Apps] Loading settings for ${app}`);
        
        // Get the container to put the settings in
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
    
    // Add auto-save listeners to form elements
    addFormChangeListeners: function(form) {
        if (!form) return;
        
        const appType = form.getAttribute('data-app-type');
        console.log(`[Apps] Adding auto-save listeners for ${appType}`);
        
        // Debounced auto-save function
        let autoSaveTimeout;
        const autoSave = () => {
            clearTimeout(autoSaveTimeout);
            autoSaveTimeout = setTimeout(() => {
                this.autoSaveSettings(appType, form);
            }, 1500); // 1.5 second debounce
        };
        
        // Add listeners to all form inputs, selects, and textareas
        const formElements = form.querySelectorAll('input, select, textarea');
        formElements.forEach(element => {
            // Skip buttons and test-related elements
            if (element.type === 'button' || 
                element.type === 'submit' || 
                element.tagName.toLowerCase() === 'button' ||
                element.classList.contains('test-connection-btn') ||
                element.id && element.id.includes('test-')) {
                return;
            }
            
            // Remove any existing listeners to avoid duplicates
            element.removeEventListener('change', autoSave);
            element.removeEventListener('input', autoSave);
            
            // Add auto-save listeners
            element.addEventListener('change', autoSave);
            
            // For text and number inputs, also listen for input events
            if (element.type === 'text' || element.type === 'number' || element.tagName.toLowerCase() === 'textarea') {
                element.addEventListener('input', autoSave);
            }
            
            console.log(`[Apps] Added auto-save listener to ${element.tagName} with id: ${element.id || 'no-id'}`);
        });
        
        // Also observe for added/removed instances
        try {
            if (this.observer) {
                this.observer.disconnect();
            }
            
            this.observer = new MutationObserver((mutations) => {
                let shouldAutoSave = false;
                
                mutations.forEach(mutation => {
                    if (mutation.type === 'childList' && 
                       (mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0)) {
                        
                        // Check if the changes are test-related elements that we should ignore
                        let isTestRelated = false;
                        
                        [...mutation.addedNodes, ...mutation.removedNodes].forEach(node => {
                            if (node.nodeType === Node.ELEMENT_NODE) {
                                if (node.classList && (
                                    node.classList.contains('connection-message') ||
                                    node.classList.contains('test-status') ||
                                    node.classList.contains('test-result') ||
                                    node.classList.contains('auto-save-indicator')
                                )) {
                                    isTestRelated = true;
                                }
                                if (node.id && (node.id.includes('-status-') || node.id.includes('save-indicator'))) {
                                    isTestRelated = true;
                                }
                            }
                        });
                        
                        if (!isTestRelated) {
                            shouldAutoSave = true;
                        }
                    }
                });
                
                if (shouldAutoSave) {
                    console.log('[Apps] Instance structure changed - triggering auto-save');
                    autoSave();
                }
            });
            
            // Start observing instances container for changes
            const instancesContainers = form.querySelectorAll('.instances-container');
            instancesContainers.forEach(container => {
                this.observer.observe(container, { childList: true, subtree: true });
            });
        } catch (error) {
            console.error('[Apps] Error setting up MutationObserver:', error);
        }
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
        

        
        // Unsaved changes check temporarily disabled - will be re-implemented in the future
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
            
            // Show success notification
            if (typeof huntarrUI !== 'undefined' && typeof huntarrUI.showNotification === 'function') {
                huntarrUI.showNotification(`${appType} settings saved successfully`, 'success');
            } else {
                alert(`${appType} settings saved successfully`);
            }
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
            
            // Reset the internal change tracking for this specific app
            if (appType && this.appsWithChanges && this.appsWithChanges.includes(appType)) {
                this.appsWithChanges = this.appsWithChanges.filter(app => app !== appType);
                console.log(`Removed ${appType} from appsWithChanges:`, this.appsWithChanges);
            }
            
            // Force update overall app state
            this.settingsChanged = this.appsWithChanges && this.appsWithChanges.length > 0;
            
            // Explicitly handle Readarr, Lidarr, and Whisparr which seem to have issues
            if (appType === 'readarr' || appType === 'lidarr' || appType === 'whisparr' || appType === 'whisparrv2') {
                console.log(`Special handling for ${appType} to ensure changes are cleared`);
                // Force additional global state updates
                if (window.huntarrUI && window.huntarrUI.formChanged) {
                    window.huntarrUI.formChanged[appType] = false;
                }
                // Reset the global changed state tracker if this was the only app with changes
                if (!this.settingsChanged && window.huntarrUI) {
                    window.huntarrUI.hasUnsavedChanges = false;
                }
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

// Initialize when document is ready
document.addEventListener('DOMContentLoaded', () => {
    appsModule.init();
    
    // Auto-save enabled - no save button needed
});
