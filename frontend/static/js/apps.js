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
        // Check if we already have the event listener
        if (!this._unsavedChangesHandlerRegistered) {
            this._unsavedChangesHandlerRegistered = true;
            
            document.addEventListener('click', (event) => {
                // Skip handling if currently saving or change detection is suppressed
                if (window._appsCurrentlySaving || window._appsSuppressChangeDetection) {
                    return;
                }
                
                // Only check for navigation away from apps section
                const navItem = event.target.closest('.nav-item, a');
                if (navItem) {
                    const href = navItem.getAttribute('href');
                    
                    // Skip if clicking within the apps section or on external links
                    if (!href || href === '#apps' || href.startsWith('http') || navItem.getAttribute('target') === '_blank') {
                        return;
                    }
                    
                    // Immediately clear the settingsChanged flag if we're not actually on the apps page
                    if (window.location.hash !== '#apps') {
                        this.settingsChanged = false;
                        return;
                    }
                    
                    // Check for unsaved changes
                    if (this.hasUnsavedChanges()) {
                        if (!confirm('You have unsaved changes. Are you sure you want to leave? Changes will be lost.')) {
                            event.preventDefault();
                        } else {
                            // User clicked OK, reset the settings changed flag
                            this.settingsChanged = false;
                        }
                    }
                }
            });
            
            // Also handle browser back/forward navigation
            window.addEventListener('beforeunload', (event) => {
                // Skip if currently saving, suppression active, or not on apps page
                if (window._appsCurrentlySaving || 
                    window._appsSuppressChangeDetection || 
                    window.location.hash !== '#apps') {
                    return;
                }
                
                // Check for unsaved changes
                if (this.hasUnsavedChanges()) {
                    // Show standard browser confirmation
                    event.preventDefault();
                    event.returnValue = 'You have unsaved changes. Are you sure you want to leave? Changes will be lost.';
                    return event.returnValue;
                }
            });
        }
    },
    
    // Check for unsaved changes before navigating away
    hasUnsavedChanges: function() {
        // If test connection suppression is active, return false to prevent dialog
        if (window._suppressUnsavedChangesDialog === true) {
            console.log('Unsaved changes check suppressed due to test connection');
            return false;
        }
        
        // If the app is currently saving, don't consider it as having unsaved changes
        if (window._appsCurrentlySaving) {
            console.log('Skipping unsaved changes check because app is currently saving');
            return false;
        }
        
        // Check if settings have changed
        return this.settingsChanged === true;
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
            
            // Controls
            saveAppsButton: document.getElementById('saveAppsButton')
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

        // Save button
        if (this.elements.saveAppsButton) {
            this.elements.saveAppsButton.addEventListener('click', (event) => this.saveApps(event));
        }
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
                        
                        // Store original form values after form is generated
                        this.storeOriginalFormValues(appPanel);
                        
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
    
    // Add change event listeners to form elements
    addFormChangeListeners: function(form) {
        if (!form) return;
        
        console.log(`Adding form change listeners to form with app type: ${form.getAttribute('data-app-type')}`);
        
        // Function to handle form element changes
        const handleChange = () => {
            // Skip if test connection suppression is active
            if (window._suppressUnsavedChangesDialog === true || window._appsSuppressChangeDetection === true) {
                console.log('Change detection suppressed due to test connection or status updates');
                return;
            }
            
            if (this.hasFormChanges(form)) {
                console.log('Form changed, enabling save button');
                this.markAppsAsChanged();
            } else {
                console.log('No actual changes, save button remains disabled');
            }
        };
        
        // Add listeners to all form inputs, selects, and textareas
        const formElements = form.querySelectorAll('input, select, textarea, button');
        formElements.forEach(element => {
            // Skip buttons and test-related elements
            if (element.type === 'button' || 
                element.type === 'submit' || 
                element.tagName.toLowerCase() === 'button' ||
                element.classList.contains('test-connection-btn') ||
                element.id && element.id.includes('test-')) {
                return;
            }
            
            // Remove any existing change listeners to avoid duplicates
            element.removeEventListener('change', handleChange);
            element.removeEventListener('input', handleChange);
            
            // Add change listeners
            element.addEventListener('change', handleChange);
            
            // For text and number inputs, also listen for input events
            if (element.type === 'text' || element.type === 'number' || element.type === 'textarea') {
                element.addEventListener('input', handleChange);
            }
            
            console.log(`Added change listener to ${element.tagName} with id: ${element.id || 'no-id'}`);
        });
        
        // Also add a MutationObserver to detect when instances are added or removed
        // This is needed because adding/removing instances doesn't trigger input events
        try {
            // Check if we already have an observer for this form
            if (this.observer) {
                this.observer.disconnect();
            }
            
            // Create a new MutationObserver
            this.observer = new MutationObserver((mutations) => {
                let shouldUpdate = false;
                
                mutations.forEach(mutation => {
                    // Check for elements added or removed
                    if (mutation.type === 'childList' && 
                       (mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0)) {
                        
                        // Check if the changes are test-related elements that we should ignore
                        let isTestRelated = false;
                        
                        // Check added nodes
                        mutation.addedNodes.forEach(node => {
                            if (node.nodeType === Node.ELEMENT_NODE) {
                                if (node.classList && (
                                    node.classList.contains('connection-message') ||
                                    node.classList.contains('test-status') ||
                                    node.classList.contains('test-result')
                                )) {
                                    isTestRelated = true;
                                }
                                // Also check for status elements by ID pattern
                                if (node.id && node.id.includes('-status-')) {
                                    isTestRelated = true;
                                }
                            }
                        });
                        
                        // Check removed nodes
                        mutation.removedNodes.forEach(node => {
                            if (node.nodeType === Node.ELEMENT_NODE) {
                                if (node.classList && (
                                    node.classList.contains('connection-message') ||
                                    node.classList.contains('test-status') ||
                                    node.classList.contains('test-result')
                                )) {
                                    isTestRelated = true;
                                }
                                // Also check for status elements by ID pattern
                                if (node.id && node.id.includes('-status-')) {
                                    isTestRelated = true;
                                }
                            }
                        });
                        
                        // Only mark as changed if it's not test-related
                        if (!isTestRelated) {
                            shouldUpdate = true;
                        }
                    }
                });
                
                if (shouldUpdate) {
                    // Skip if test connection suppression is active
                    if (window._suppressUnsavedChangesDialog === true || window._appsSuppressChangeDetection === true) {
                        console.log('MutationObserver suppressed due to test connection or status updates');
                        return;
                    }
                    
                    console.log('Instances container changed - checking for form changes');
                    if (this.hasFormChanges(form)) {
                        console.log('Form changed, enabling save button');
                        this.markAppsAsChanged();
                    } else {
                        console.log('No actual changes, save button remains disabled');
                    }
                }
            });
            
            // Start observing instances container for changes
            const instancesContainers = form.querySelectorAll('.instances-container');
            instancesContainers.forEach(container => {
                this.observer.observe(container, { childList: true, subtree: true });
                console.log(`Added MutationObserver to container: ${container.className}`);
            });
        } catch (error) {
            console.error('Error setting up MutationObserver:', error);
        }
    },
    
    // Mark apps as changed
    markAppsAsChanged: function() {
        this.settingsChanged = true;
        
        // Find the currently visible app panel and track it in our list of changed apps
        const currentApp = document.querySelector('.app-panel:not([style*="display: none"])');
        if (currentApp) {
            const appType = currentApp.getAttribute('data-app-type');
            if (appType) {
                // Initialize the array if it doesn't exist yet
                if (!this.appsWithChanges) {
                    this.appsWithChanges = [];
                }
                
                // Add this app to the list of apps with changes if not already there
                if (!this.appsWithChanges.includes(appType)) {
                    this.appsWithChanges.push(appType);
                    console.log(`Added ${appType} to appsWithChanges:`, this.appsWithChanges);
                }
                
                // Set the global tracking flag for this specific app
                if (!window._hasAppChanges) {
                    window._hasAppChanges = {};
                }
                window._hasAppChanges[appType] = true;
                
                // Also update the huntarrUI tracking if available
                if (window.huntarrUI && window.huntarrUI.formChanged) {
                    window.huntarrUI.formChanged[appType] = true;
                    window.huntarrUI.hasUnsavedChanges = true;
                }
            }
        }
        
        if (this.elements.saveAppsButton) {
            this.elements.saveAppsButton.disabled = false;
            console.log('Save button enabled');
        } else {
            console.error('Save button element not found');
        }
    },
    
    // Check if the form has actual changes compared to original values
    hasFormChanges: function(form) {
        if (!form || !this.originalSettings) return true;
        
        let hasChanges = false;
        const formElements = form.querySelectorAll('input, select, textarea');
        
        formElements.forEach(element => {
            // Skip buttons
            if (element.type === 'button' || element.type === 'submit') return;
            
            const originalValue = this.originalSettings[element.id];
            const currentValue = element.type === 'checkbox' ? element.checked : element.value;
            
            // Compare with original value
            if (originalValue !== undefined && String(originalValue) !== String(currentValue)) {
                console.log(`Element changed: ${element.id}, Original: ${originalValue}, Current: ${currentValue}`);
                hasChanges = true;
            }
        });
        
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
        

        
        // Check for unsaved changes
        if (this.settingsChanged) {
            const confirmSwitch = confirm('You have unsaved changes. Do you want to continue without saving?');
            if (!confirmSwitch) {
                // Reset the select to the current app
                const appsAppSelect = document.getElementById('appsAppSelect');
                if (appsAppSelect) appsAppSelect.value = this.currentApp;
                return;
            }
        }
        // Update the select value
        const appsAppSelect = document.getElementById('appsAppSelect');
        if (appsAppSelect) appsAppSelect.value = selectedApp;
        // Show the selected app's panel
        this.showAppPanel(selectedApp);
        this.currentApp = selectedApp;
        // Load the newly selected app's settings
        this.loadAppSettings(selectedApp);
        // Reset changed state
        this.settingsChanged = false;
        if (this.elements.saveAppsButton) this.elements.saveAppsButton.disabled = true;
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
            
            // Disable save button and reset state
            this.settingsChanged = false;
            if (this.elements.saveAppsButton) {
                this.elements.saveAppsButton.disabled = true;
            }
            
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
            originalValues[element.id] = element.value;
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
    
    // Add a direct event listener to the save button for maximum reliability
    const saveButton = document.getElementById('saveAppsButton');
    if (saveButton) {
        saveButton.addEventListener('click', function(event) {
            console.log('Save button clicked directly');
            appsModule.saveApps(event);
        });
    }
});
