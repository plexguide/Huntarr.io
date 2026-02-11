/*
 * Settings Forms Core Logic
 * Handles shared functionality for settings pages
 */

window.SettingsForms = {
    // Polling interval for state status updates
    _stateStatusPollInterval: null,
    _currentEditorAppType: null,
    _currentEditorInstanceIndex: null,

    // Check if Swaparr is globally enabled
    isSwaparrGloballyEnabled: function () {
        try {
            const swaparrToggle = document.querySelector("#swaparr_enabled");
            if (swaparrToggle) {
                return swaparrToggle.checked;
            }

            const cachedSettings = localStorage.getItem("huntarr-settings-cache");
            if (cachedSettings) {
                const settings = JSON.parse(cachedSettings);
                if (settings.swaparr && settings.swaparr.enabled !== undefined) {
                    return settings.swaparr.enabled === true;
                }
            }

            if (window.huntarrUI && window.huntarrUI.originalSettings && window.huntarrUI.originalSettings.swaparr) {
                return window.huntarrUI.originalSettings.swaparr.enabled === true;
            }

            this.fetchAndCacheSwaparrState().then(() => {
                setTimeout(() => {
                    this.updateSwaparrFieldsDisabledState();
                }, 100);
            });
            return false;
        } catch (e) {
            console.warn("[SettingsForms] Error checking Swaparr global status:", e);
            return false;
        }
    },

    // Fetch and cache current Swaparr state from server
    fetchAndCacheSwaparrState: function () {
        return fetch("./api/settings/swaparr")
            .then((response) => response.json())
            .then((data) => {
                try {
                    let cachedSettings = {};
                    const existing = localStorage.getItem("huntarr-settings-cache");
                    if (existing) {
                        cachedSettings = JSON.parse(existing);
                    }
                    if (!cachedSettings.swaparr) cachedSettings.swaparr = {};
                    cachedSettings.swaparr.enabled = data.enabled === true;
                    localStorage.setItem("huntarr-settings-cache", JSON.stringify(cachedSettings));
                } catch (e) {
                    console.warn("[SettingsForms] Failed to update Swaparr cache:", e);
                }

                if (window.huntarrUI && window.huntarrUI.originalSettings) {
                    if (!window.huntarrUI.originalSettings.swaparr) {
                        window.huntarrUI.originalSettings.swaparr = {};
                    }
                    window.huntarrUI.originalSettings.swaparr.enabled = data.enabled === true;
                }

                return data.enabled === true;
            })
            .catch((error) => {
                console.warn("[SettingsForms] Failed to fetch Swaparr state:", error);
                return false;
            });
    },

    // Update Swaparr fields visibility
    updateSwaparrFieldsDisabledState: function () {
        this.fetchAndCacheSwaparrState().then(() => {
            const isEnabled = this.isSwaparrGloballyEnabled();
            const swaparrFields = document.querySelectorAll('.swaparr-field');
            swaparrFields.forEach(field => {
                field.style.display = isEnabled ? '' : 'none';
            });
        });
    },

    // Update all Swaparr instances visibility
    updateAllSwaparrInstanceVisibility: function () {
        this.updateSwaparrFieldsDisabledState();
    },

    // Helper to save settings and refresh view. options: { section: 'main'|'notifications'|'logs' } for general only.
    saveAppSettings: function(appType, settings, successMessage, options) {
        if (typeof successMessage !== 'string') {
            options = successMessage;
            successMessage = 'Settings saved successfully';
        }
        if (!options || typeof options !== 'object') {
            options = {};
        }
        const section = options.section;
        console.log(`[huntarrUI] saveAppSettings called for ${appType}` + (section ? ` section=${section}` : ''));
        
        // Ensure change detection is suppressed during the entire save and refresh process
        window._appsSuppressChangeDetection = true;
        
        return HuntarrUtils.fetchWithTimeout(`./api/settings/${appType}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        })
        .then(response => response.json())
        .then(data => {
            console.log(`[huntarrUI] Backend save successful for ${appType}`);
            
            if (window.huntarrUI && window.huntarrUI.showNotification) {
                window.huntarrUI.showNotification(successMessage || 'Settings saved successfully', 'success');
            }

            // Notify all instance dropdowns across the SPA that data may have changed
            try { document.dispatchEvent(new CustomEvent('huntarr:instances-changed', { detail: { appType: appType } })); } catch(e) {}
            
            // Re-sync memory. Use server-returned settings when present (e.g. server-generated instance_id).
            if (window.huntarrUI && window.huntarrUI.originalSettings) {
                if (appType === 'general' && data && data.general) {
                    window.huntarrUI.originalSettings.general = JSON.parse(JSON.stringify(data.general));
                    if (typeof window.huntarrUI.updateMovieHuntNavVisibility === 'function') {
                        window.huntarrUI.updateMovieHuntNavVisibility();
                    }
                } else if (data && data.settings) {
                    window.huntarrUI.originalSettings[appType] = JSON.parse(JSON.stringify(data.settings));
                } else {
                    window.huntarrUI.originalSettings[appType] = JSON.parse(JSON.stringify(settings));
                }
            }
            
            let container = null;
            if (appType === 'general' && section) {
                if (section === 'main') container = document.getElementById('generalSettings');
                else if (section === 'notifications') container = document.querySelector('[data-app-type="notifications"]');
                else if (section === 'logs') container = document.querySelector('[data-app-type="logs"]');
            }
            if (!container) {
                if (appType === 'general') container = document.getElementById('generalSettings');
            }
            if (!container) {
                const appPanel = document.getElementById(appType + 'Apps');
                container = appPanel ? appPanel.querySelector('form.settings-form') : null;
            }
            if (!container) {
                container = document.querySelector(`form[data-app-type="${appType}"]`) || document.querySelector(`[data-app-type="${appType}"]`);
            }
            if (container) {
                const latestSettings = (window.huntarrUI && window.huntarrUI.originalSettings && window.huntarrUI.originalSettings[appType])
                    ? JSON.parse(JSON.stringify(window.huntarrUI.originalSettings[appType]))
                    : settings;
                console.log(`[huntarrUI] Found container for ${appType}, re-rendering`);
                
                let methodAppType = appType;
                if (appType === 'general') {
                    methodAppType = section === 'notifications' ? 'Notifications' : section === 'logs' ? 'LogsSettings' : 'General';
                } else if (appType === 'notifications') methodAppType = 'Notifications';
                else if (appType === 'logs') methodAppType = 'LogsSettings';
                else methodAppType = appType.charAt(0).toUpperCase() + appType.slice(1);
                
                const method = `generate${methodAppType}Form`;
                
                if (window.SettingsForms && typeof window.SettingsForms[method] === 'function') {
                    // Clear container first to force a clean DOM update
                    container.innerHTML = '<div style="padding: 20px; text-align: center;"><i class="fas fa-spinner fa-spin"></i> Refreshing...</div>';
                    
                    // Small delay to ensure DOM clear is processed, then re-render with latest data
                    setTimeout(() => {
                        console.log(`[huntarrUI] Executing ${method} with ${latestSettings.instances ? latestSettings.instances.length : 0} instances`);
                        window.SettingsForms[method](container, latestSettings);
                        
                        // Ensure suppression is cleared after re-render completes
                        setTimeout(() => {
                            window._appsSuppressChangeDetection = false;
                            console.log(`[huntarrUI] Change detection re-enabled for ${appType}`);
                        }, 500);
                    }, 50);
                } else {
                    console.error(`[huntarrUI] Re-render failed: Method ${method} not found`);
                    window._appsSuppressChangeDetection = false;
                }
            } else {
                console.warn(`[huntarrUI] Container for ${appType} not found in DOM, skipping re-render`);
                window._appsSuppressChangeDetection = false;
            }
            return data;
        })
        .catch(error => {
            console.error(`[huntarrUI] Error saving settings for ${appType}:`, error);
            window._appsSuppressChangeDetection = false;
            if (window.huntarrUI && window.huntarrUI.showNotification) {
                window.huntarrUI.showNotification('Failed to save settings', 'error');
            }
        });
    },

    // Test all instance connections and update status icons
    testAllInstanceConnections: function(appType) {
        const settings = window.huntarrUI?.originalSettings?.[appType];
        if (!settings) return;
        
        // Prowlarr has a different structure (no instances array)
        if (appType === 'prowlarr') {
            const prowlarrInstance = {
                api_url: settings.api_url || '',
                api_key: settings.api_key || '',
                enabled: settings.enabled !== false
            };
            if (!prowlarrInstance.enabled) {
                this.updateInstanceStatusIcon(appType, 0, 'disabled');
                return;
            }
            if (prowlarrInstance.api_url && prowlarrInstance.api_key) {
                this.testInstanceConnection(appType, 0, prowlarrInstance);
            } else {
                this.updateInstanceStatusIcon(appType, 0, 'error');
            }
            return;
        }
        
        // Other apps use instances array - do not attempt connection for disabled instances
        if (!settings.instances || settings.instances.length === 0) return;
        
        settings.instances.forEach((instance, index) => {
            if (instance.enabled === false) {
                this.updateInstanceStatusIcon(appType, index, 'disabled');
                return;
            }
            if (instance.api_url && instance.api_key) {
                this.testInstanceConnection(appType, index, instance);
            } else {
                this.updateInstanceStatusIcon(appType, index, 'error');
            }
        });
    },

    // Test a single instance connection
    testInstanceConnection: function(appType, index, instance) {
        // Update to loading state
        this.updateInstanceStatusIcon(appType, index, 'loading');
        
        const testData = {
            api_url: instance.api_url,
            api_key: instance.api_key
        };
        
        fetch(`./api/${appType}/test-connection`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(testData)
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                this.updateInstanceStatusIcon(appType, index, 'connected');
            } else {
                this.updateInstanceStatusIcon(appType, index, 'error');
            }
        })
        .catch(error => {
            console.error(`Connection test failed for ${appType} instance ${index}:`, error);
            this.updateInstanceStatusIcon(appType, index, 'error');
        });
    },

    // Update instance status icon
    updateInstanceStatusIcon: function(appType, index, status) {
        const card = document.querySelector(`.instance-card[data-instance-index="${index}"][data-app-type="${appType}"]`);
        if (!card) return;
        
        const statusIcon = card.querySelector('.instance-status-icon');
        if (!statusIcon) return;
        
        // Remove all status classes
        statusIcon.classList.remove('status-connected', 'status-error', 'status-unknown', 'status-loading', 'status-disabled');
        
        // Update icon and class based on status
        let iconClass = 'fa-question-circle';
        let statusClass = 'status-unknown';
        
        if (status === 'connected') {
            iconClass = 'fa-check-circle';
            statusClass = 'status-connected';
        } else if (status === 'error') {
            iconClass = 'fa-minus-circle';
            statusClass = 'status-error';
        } else if (status === 'disabled') {
            iconClass = 'fa-ban';
            statusClass = 'status-disabled';
        } else if (status === 'loading') {
            iconClass = 'fa-spinner fa-spin';
            statusClass = 'status-unknown';
        }
        
        statusIcon.classList.add(statusClass);
        statusIcon.innerHTML = `<i class="fas ${iconClass}"></i>`;
    },

    _resetSuppressionFlags: function () {
        if (window.huntarrUI) {
            window.huntarrUI.suppressUnsavedChangesCheck = false;
        }
        window._suppressUnsavedChangesDialog = false;
        window._appsSuppressChangeDetection = false;
    },

    checkConnectionStatus: function (app, instanceIndex) {
        const supportedApps = ["radarr", "sonarr", "lidarr", "readarr", "whisparr", "eros", "prowlarr"];
        if (!supportedApps.includes(app)) return;

        const urlInput = document.getElementById(`${app}-url-${instanceIndex}`);
        const apiKeyInput = document.getElementById(`${app}-key-${instanceIndex}`); // Corrected ID usage if needed, but modals use modal-key/modal-url. 
        // Wait, checkConnectionStatus in original code was looking for inputs in the DOM. 
        // My new MODAL based UI has inputs like 'modal-url' and 'modal-key'. 
        // If this function is called from auto-detection, it needs to find those.
        // But auto-detection in prowlarr used specific IDs.
        // And my `openInstanceModal` uses `modal-url`, `modal-key`.
        
        // This function as written in original code expects inputs with IDs like `sonarr-url-0`.
        // My NEW card UI does NOT put inputs in the main view, only in the modal.
        // So `checkConnectionStatus` might be legacy or need adaptation for Prowlarr which might still have inputs if I didn't switch it fully (I did switch it).
        
        // However, `prowlarr.js`'s `setupProwlarrAutoDetection` refers to inputs with specific IDs.
        // Wait, in my `prowlarr.js` rewrite, I DID NOT include `setupProwlarrAutoDetection`. 
        // I removed it because the inputs are now in a modal that is created dynamically.
        // So `checkConnectionStatus` is likely not needed in the same way unless I add auto-detection to the modal.
        
        // For now, I'll include it but it might not find elements if they aren't there.
        // The modal inputs have IDs `modal-url` and `modal-key`.
        
        // If I want connection testing in the modal, I should add a "Test" button in the modal.
        // The original code had auto-detection on typing.
        // I should probably add that to the modal logic in `core.js`.
        
        // Let's modify `openInstanceModal` in `core.js` (which I already wrote) to include a test button or auto-check?
        // For now, let's stick to the core logic I wrote.
    },

    // Manual save setup (Needed for global settings panels). options: { section: 'main'|'notifications'|'logs' } for general.
    setupAppManualSave: function (container, appType, originalSettings = {}, options) {
        const section = (options && options.section) ? options.section : null;
        const buttonId = section ? `${section}-save-button` : `${appType}-save-button`;
        console.log(`[huntarrUI] setupAppManualSave for ${appType}` + (section ? ` section=${section}` : ''));
        const saveButton = document.querySelector(`#${buttonId}`);
        if (!saveButton) {
            console.warn(`[huntarrUI] Save button #${buttonId} not found`);
            return;
        }

        // Reset button to initial state
        saveButton.disabled = true;
        saveButton.style.setProperty('background', '#6b7280', 'important');
        saveButton.style.setProperty('color', '#9ca3af', 'important');
        saveButton.style.setProperty('cursor', 'not-allowed', 'important');
        saveButton.style.setProperty('border', '1px solid #4b5563', 'important');
        saveButton.style.setProperty('opacity', '0.6', 'important');

        const updateSaveButtonState = (changed) => {
            const currentSaveButton = document.querySelector(`#${buttonId}`);
            if (!currentSaveButton) return;
            
            if (changed) {
                console.log(`[huntarrUI] UI CHANGE DETECTED: Enabling save button for ${appType}`);
                currentSaveButton.disabled = false;
                currentSaveButton.style.setProperty('background', '#dc2626', 'important');
                currentSaveButton.style.setProperty('color', '#ffffff', 'important');
                currentSaveButton.style.setProperty('cursor', 'pointer', 'important');
                currentSaveButton.style.setProperty('border', '1px solid #b91c1c', 'important');
                currentSaveButton.style.setProperty('opacity', '1', 'important');
                this.addUnsavedChangesWarning();
            } else {
                currentSaveButton.disabled = true;
                currentSaveButton.style.setProperty('background', '#6b7280', 'important');
                currentSaveButton.style.setProperty('color', '#9ca3af', 'important');
                currentSaveButton.style.setProperty('cursor', 'not-allowed', 'important');
                currentSaveButton.style.setProperty('border', '1px solid #4b5563', 'important');
                currentSaveButton.style.setProperty('opacity', '0.6', 'important');
                this.removeUnsavedChangesWarning();
            }
        };

        // Use a more robust change detection
        const handleChange = (e) => {
            // Log every interaction for debugging
            console.log(`[huntarrUI] Event ${e.type} on ${e.target.id || e.target.name || e.target.tagName}`);
            
            if (window._appsSuppressChangeDetection) {
                console.log(`[huntarrUI] Change ignored (suppression active)`);
                return;
            }
            
            // Ignore events from modals
            if (e.target.closest('.modal')) return;
            
            updateSaveButtonState(true);
        };

        // Clear existing listeners by replacing the container's listeners (if possible)
        // Since we can't easily remove anonymous listeners, we'll use a named function
        if (container._huntarrListener) {
            container.removeEventListener('input', container._huntarrListener);
            container.removeEventListener('change', container._huntarrListener);
        }
        container._huntarrListener = handleChange;
        container.addEventListener('input', handleChange);
        container.addEventListener('change', handleChange);
        
        // Setup button click
        const newSaveButton = saveButton.cloneNode(true);
        saveButton.parentNode.replaceChild(newSaveButton, saveButton);
        
        newSaveButton.addEventListener('click', () => {
            console.log(`[huntarrUI] Save button clicked for ${appType}` + (section ? ` section=${section}` : ''));
            const apiType = (appType === 'logs') ? 'general' : appType;
            const collectedSettings = (section && this.getFormSettingsGeneralSection)
                ? this.getFormSettingsGeneralSection(container, section)
                : this.getFormSettings(container, appType);
            this.saveAppSettings(apiType, collectedSettings, 'Settings saved successfully', options || (section ? { section } : {}));

            newSaveButton.innerHTML = '<i class="fas fa-save"></i> Save Changes';
            updateSaveButtonState(false);
        });
    },

    addUnsavedChangesWarning: function() {
        window._hasUnsavedChanges = true;
    },

    removeUnsavedChangesWarning: function() {
        window._hasUnsavedChanges = false;
    },
    
    // Reset state implementation
    resetInstanceState: function (appType, instanceIndex) {
        var self = this;
        var doReset = function() {
            let instanceName = null;
            const settings = window.huntarrUI.originalSettings[appType];
            if (settings && settings.instances && settings.instances[instanceIndex]) {
                instanceName = settings.instances[instanceIndex].name;
            }
            if (!instanceName) instanceName = "Default";
            HuntarrUtils.fetchWithTimeout("./api/stateful/reset", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ app_type: appType, instance_name: instanceName }),
        })
        .then((response) => response.json())
        .then((data) => {
            if (data.success) {
                if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('State reset successfully.', 'success');
                else alert('State reset successfully.');
            } else {
                if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Failed to reset state.', 'error');
                else alert('Failed to reset state.');
            }
        });
        };
        if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
            window.HuntarrConfirm.show({ title: 'Reset State', message: 'Are you sure you want to reset the state?', confirmLabel: 'Reset', onConfirm: doReset });
        } else {
            if (!confirm('Are you sure you want to reset the state?')) return;
            doReset();
        }
    },

    // Update enable status icon when dropdown changes
    updateEnableStatusIcon: function() {
        const dropdown = document.getElementById('editor-enabled');
        const icon = document.getElementById('enable-status-icon');
        
        if (!dropdown || !icon) return;
        
        const isEnabled = dropdown.value === 'true';
        
        // Update icon
        if (isEnabled) {
            icon.className = 'fas fa-check-circle';
            icon.style.color = '#10b981'; // Green
        } else {
            icon.className = 'fas fa-minus-circle';
            icon.style.color = '#ef4444'; // Red
        }
    },

    // Show/hide Upgrade Tag field when upgrade method is Tags; hide "Tag upgrade items" / "Tag upgraded (Upgradinatorr)" when tags mode (Upgradinatorr tag is used by default).
    toggleUpgradeTagVisibility: function() {
        const methodEl = document.getElementById('editor-upgrade-method');
        const tagGroup = document.querySelector('.editor-upgrade-tag-group');
        const upgradeItemsTagSection = document.querySelector('.editor-upgrade-items-tag-section');
        if (methodEl && tagGroup) {
            tagGroup.style.display = (methodEl.value === 'tags') ? 'flex' : 'none';
        }
        if (methodEl && upgradeItemsTagSection) {
            upgradeItemsTagSection.style.display = (methodEl.value === 'tags') ? 'none' : 'block';
        }
    },

    // Toggle form fields based on enabled status
    toggleFormFields: function() {
        const dropdown = document.getElementById('editor-enabled');
        if (!dropdown) return;
        
        const isEnabled = dropdown.value === 'true';
        
        // Get all field groups except the Enable Status field group
        const editorContent = document.getElementById('instance-editor-content');
        if (!editorContent) return;
        
        // Find all field groups
        const fieldGroups = editorContent.querySelectorAll('.editor-field-group');
        
        fieldGroups.forEach((group, index) => {
            // Skip the first field group (Enable Status)
            if (index === 0) return;
            
            if (isEnabled) {
                group.classList.remove('editor-field-disabled');
                // Re-enable all inputs/selects/toggles
                group.querySelectorAll('input, select').forEach(el => {
                    el.disabled = false;
                });
            } else {
                group.classList.add('editor-field-disabled');
                // Disable all inputs/selects/toggles
                group.querySelectorAll('input, select').forEach(el => {
                    el.disabled = true;
                });
            }
        });
        
        // Also handle all sections
        const sections = editorContent.querySelectorAll('.editor-section');
        sections.forEach(section => {
            const sectionFieldGroups = section.querySelectorAll('.editor-field-group');
            sectionFieldGroups.forEach((group, index) => {
                // For sections, disable all fields when disabled
                // But we need to check if this is the Connection Details section
                const isConnectionSection = section.querySelector('.editor-section-title')?.textContent.includes('Connection Details');
                
                // Skip the Enable Status field in Connection Details
                if (isConnectionSection && index === 0) return;
                
                if (isEnabled) {
                    group.classList.remove('editor-field-disabled');
                    group.querySelectorAll('input, select').forEach(el => {
                        el.disabled = false;
                    });
                } else {
                    group.classList.add('editor-field-disabled');
                    group.querySelectorAll('input, select').forEach(el => {
                        el.disabled = true;
                    });
                }
            });
        });
    },

    // Load and display state status
    loadStateStatus: async function(appType, instanceIndex) {
        const trackedCountEl = document.getElementById('tracked-items-count');
        const nextResetEl = document.getElementById('next-reset-time');
        
        if (!trackedCountEl || !nextResetEl) return;
        
        try {
            // Try to get instance name from editor first (most up-to-date)
            let instanceName = null;
            const editorNameInput = document.getElementById('editor-name');
            if (editorNameInput && editorNameInput.value && editorNameInput.value.trim()) {
                instanceName = editorNameInput.value.trim();
            }
            
            // Fallback to settings if editor name not available
            if (!instanceName) {
                const settings = window.huntarrUI.originalSettings[appType];
                if (settings && settings.instances && settings.instances[instanceIndex]) {
                    instanceName = settings.instances[instanceIndex].name;
                }
            }
            
            if (!instanceName) {
                trackedCountEl.textContent = '0';
                nextResetEl.textContent = 'N/A';
                return;
            }
            
            // Fetch state status from the API using the existing /api/stateful/summary endpoint
            const response = await fetch(`./api/stateful/summary?app_type=${encodeURIComponent(appType)}&instance_name=${encodeURIComponent(instanceName)}`);
            
            if (!response.ok) {
                trackedCountEl.textContent = '0';
                nextResetEl.textContent = 'N/A';
                return;
            }
            
            const data = await response.json();
            
            if (!data.success) {
                trackedCountEl.textContent = '0';
                nextResetEl.textContent = 'N/A';
                return;
            }
            
            // Update tracked items count
            trackedCountEl.textContent = data.processed_count || 0;
            
            // Update next reset time
            if (data.next_reset_time) {
                nextResetEl.textContent = data.next_reset_time;
            } else {
                nextResetEl.textContent = 'N/A';
            }
        } catch (error) {
            console.error('[SettingsForms] Error loading state status:', error);
            trackedCountEl.textContent = '0';
            nextResetEl.textContent = 'N/A';
        }
    },

    // Start polling state status every 5 seconds
    startStateStatusPolling: function(appType, instanceIndex) {
        // Stop any existing polling
        this.stopStateStatusPolling();
        
        // Store current editor info
        this._currentEditorAppType = appType;
        this._currentEditorInstanceIndex = instanceIndex;
        
        // Load immediately
        this.loadStateStatus(appType, instanceIndex);
        
        // Then poll every 5 seconds
        this._stateStatusPollInterval = setInterval(() => {
            // Only poll if editor is still visible
            const editorContent = document.getElementById('instance-editor-content');
            if (editorContent && editorContent.offsetParent !== null) {
                this.loadStateStatus(this._currentEditorAppType, this._currentEditorInstanceIndex);
            } else {
                // Editor is hidden, stop polling
                this.stopStateStatusPolling();
            }
        }, 5000); // 5 seconds
        
        console.log('[SettingsForms] Started state status polling for', appType, instanceIndex);
    },

    // Stop polling state status
    stopStateStatusPolling: function() {
        if (this._stateStatusPollInterval) {
            clearInterval(this._stateStatusPollInterval);
            this._stateStatusPollInterval = null;
            this._currentEditorAppType = null;
            this._currentEditorInstanceIndex = null;
            console.log('[SettingsForms] Stopped state status polling');
        }
    },

    // Update duration display - e.g., convert seconds to hours
    updateDurationDisplay: function () {
        const updateSleepDisplay = function (inputId, spanId) {
            const input = document.getElementById(inputId);
            const span = document.getElementById(spanId);
            if (!input || !span) return;

            const seconds = parseInt(input.value);
            if (isNaN(seconds)) return;

            const hours = (seconds / 3600).toFixed(1);
            if (hours < 1) {
                const minutes = Math.round(seconds / 60);
                span.textContent = `${minutes} minutes`;
            } else {
                span.textContent = `${hours} hours`;
            }
        };

        updateSleepDisplay("sonarr_sleep_duration", "sonarr_sleep_duration_hours");
        updateSleepDisplay("radarr_sleep_duration", "radarr_sleep_duration_hours");
        updateSleepDisplay("lidarr_sleep_duration", "lidarr_sleep_duration_hours");
        updateSleepDisplay("readarr_sleep_duration", "readarr_sleep_duration_hours");
        updateSleepDisplay("whisparr_sleep_duration", "whisparr_sleep_duration_hours");
        updateSleepDisplay("eros_sleep_duration", "eros_sleep_duration_hours");
    },

    loadSwaparrStarCount: function () {
        const starsElement = document.getElementById("swaparr-stars-count");
        if (!starsElement) return;

        const cachedData = localStorage.getItem("swaparr-github-stars");
        if (cachedData) {
            try {
                const parsed = JSON.parse(cachedData);
                if (parsed.stars !== undefined) {
                    starsElement.textContent = parsed.stars.toLocaleString();
                    const cacheAge = Date.now() - (parsed.timestamp || 0);
                    if (cacheAge < 3600000) return;
                }
            } catch (e) {
                localStorage.removeItem("swaparr-github-stars");
            }
        }

        fetch("https://api.github.com/repos/ThijmenGThN/swaparr")
            .then((response) => response.json())
            .then((data) => {
                if (data.stargazers_count !== undefined) {
                    const stars = data.stargazers_count;
                    starsElement.textContent = stars.toLocaleString();
                    localStorage.setItem("swaparr-github-stars", JSON.stringify({
                        stars: stars,
                        timestamp: Date.now(),
                    }));
                }
            })
            .catch((error) => {
                console.warn("Failed to fetch Swaparr stars:", error);
            });
    },

    refreshAppsSection: function () {
        if (window.Apps && window.Apps.loadAppSettings) {
            const appSelect = document.getElementById("appsAppSelect");
            if (appSelect && appSelect.value) {
                window.Apps.loadAppSettings(appSelect.value);
            }
        }
    },

    // Re-render only one general sub-section (main, notifications, logs) with current data
    reRenderGeneralSection: function (section, data) {
        if (!section || !data) return;
        let container = null;
        let methodName = 'generateGeneralForm';
        if (section === 'main') {
            container = document.getElementById('generalSettings');
            methodName = 'generateGeneralForm';
        } else if (section === 'notifications') {
            container = document.querySelector('[data-app-type="notifications"]');
            methodName = 'generateNotificationsForm';
        } else if (section === 'logs') {
            container = document.querySelector('[data-app-type="logs"]');
            methodName = 'generateLogsSettingsForm';
        }
        if (container && this[methodName]) {
            this[methodName](container, data);
        }
    },

    // Get settings from a single general sub-section (main, notifications, logs) for merge-and-save
    getFormSettingsGeneralSection: function (container, section) {
        if (!container || !section) return null;
        const getVal = (id, def) => {
            const el = container.querySelector(id ? '#' + id : null);
            if (!el) return def;
            if (el.type === 'checkbox') return el.checked;
            if (el.type === 'number') {
                const v = parseInt(el.value, 10);
                return isNaN(v) ? def : v;
            }
            return (el.value || '').trim() || def;
        };
        if (section === 'main') {
            return {
                timezone: getVal('timezone', 'UTC'),
                display_community_resources: getVal('display_community_resources', true),
                display_huntarr_support: getVal('display_huntarr_support', true),
                enable_requestarr: true, // Always enabled (required for Movie Hunt)

                show_trending: getVal('show_trending', true),
                enable_smarthunt: getVal('enable_smarthunt', true),
                tmdb_image_cache_days: parseInt(container.querySelector('#tmdb_image_cache_days')?.value || '30'),
                auth_mode: (container.querySelector('#auth_mode') && container.querySelector('#auth_mode').value) || 'login',
                ssl_verify: getVal('ssl_verify', true),
                base_url: getVal('base_url', ''),
                dev_key: getVal('dev_key', ''),
                web_server_threads: parseInt(container.querySelector('#web_server_threads')?.value || '8'),
            };
        }
        if (section === 'notifications') {
            const appriseEl = container.querySelector('#apprise_urls');
            const appriseUrls = appriseEl ? (appriseEl.value || '').split('\n').map(u => u.trim()).filter(Boolean) : [];
            return {
                enable_notifications: getVal('enable_notifications', false),
                notification_level: getVal('notification_level', 'info'),
                apprise_urls: appriseUrls,
                notify_on_missing: getVal('notify_on_missing', true),
                notify_on_upgrade: getVal('notify_on_upgrade', true),
                notification_include_instance: getVal('notification_include_instance', true),
                notification_include_app: getVal('notification_include_app', true)
            };
        }
        if (section === 'logs') {
            return {
                log_rotation_enabled: getVal('log_rotation_enabled', true),
                log_max_size_mb: getVal('log_max_size_mb', 50),
                log_backup_count: getVal('log_backup_count', 5),
                log_retention_days: getVal('log_retention_days', 30),
                log_auto_cleanup: getVal('log_auto_cleanup', true),
                log_max_entries_per_app: getVal('log_max_entries_per_app', 10000),
                log_refresh_interval_seconds: getVal('log_refresh_interval_seconds', 30),
                enable_debug_logs: getVal('enable_debug_logs', true)
            };
        }
        return null;
    },

    // Get settings from form
    getFormSettings: function (container, appType) {
        let settings = {};

        function getInputValue(selector, defaultValue) {
            const element = container.querySelector(selector);
            if (!element) return defaultValue;

            if (element.type === "checkbox") {
                return element.checked;
            } else if (element.type === "number") {
                const parsedValue = parseInt(element.value);
                return !isNaN(parsedValue) ? parsedValue : defaultValue;
            } else {
                return element.value || defaultValue;
            }
        }

        if (appType === "general") {
            settings.instances = [];
            settings.timezone = getInputValue("#timezone", "UTC");
            settings.display_community_resources = getInputValue("#display_community_resources", true);
            settings.display_huntarr_support = getInputValue("#display_huntarr_support", true);
            settings.enable_requestarr = true; // Always enabled (required for Movie Hunt)

            settings.show_trending = getInputValue("#show_trending", true);
            settings.enable_smarthunt = getInputValue("#enable_smarthunt", true);

            const authMode = container.querySelector("#auth_mode")?.value || "login";
            settings.auth_mode = authMode;
            settings.ssl_verify = getInputValue("#ssl_verify", true);
            settings.base_url = getInputValue("#base_url", "");
            settings.dev_key = getInputValue("#dev_key", "");

            const notificationsContainer = document.querySelector("#notificationsContainer");
            const getNotificationInputValue = (id, defaultValue) => {
                let element = container.querySelector(id) || (notificationsContainer ? notificationsContainer.querySelector(id) : null);
                if (!element) return defaultValue;
                if (element.type === "checkbox") return element.checked;
                if (element.type === "number") {
                    const value = parseInt(element.value, 10);
                    return isNaN(value) ? defaultValue : value;
                }
                return element.value || defaultValue;
            };

            settings.enable_notifications = getNotificationInputValue("#enable_notifications", false);
            settings.notification_level = getNotificationInputValue("#notification_level", "info");

            let appriseUrlsElement = (notificationsContainer ? notificationsContainer.querySelector("#apprise_urls") : null) || container.querySelector("#apprise_urls");
            settings.apprise_urls = (appriseUrlsElement?.value || "").split("\n").map(url => url.trim()).filter(url => url.length > 0);

            settings.notify_on_missing = getNotificationInputValue("#notify_on_missing", true);
            settings.notify_on_upgrade = getNotificationInputValue("#notify_on_upgrade", true);
            settings.notification_include_instance = getNotificationInputValue("#notification_include_instance", true);
            settings.notification_include_app = getNotificationInputValue("#notification_include_app", true);
        } else {
            // New UI mode: instances are managed via modal, so we get them from originalSettings
            if (window.huntarrUI && window.huntarrUI.originalSettings && window.huntarrUI.originalSettings[appType]) {
                settings.instances = JSON.parse(JSON.stringify(window.huntarrUI.originalSettings[appType].instances || []));
            } else {
                settings.instances = [];
            }

            // Sleep duration and hourly_cap are now per-instance (stored on each instance)
            // Keep app-level fallback from first instance for backward compat
            if (settings.instances && settings.instances.length > 0) {
                const first = settings.instances[0];
                settings.sleep_duration = first.sleep_duration !== undefined ? first.sleep_duration : 900;
                settings.hourly_cap = first.hourly_cap !== undefined ? first.hourly_cap : 20;
            } else {
                settings.sleep_duration = 900;
                settings.hourly_cap = 20;
            }
        }
        return settings;
    },

    setupInstanceManagement: function (container, appType, initialCount) {
        // This is mostly legacy for connection status checking in the main view
        const supportedApps = ["radarr", "sonarr", "lidarr", "readarr", "whisparr", "eros"];
        if (supportedApps.includes(appType)) {
            // In the new UI, we don't have inputs in the main view, 
            // but we might still want to trigger connection tests.
            this.testAllInstanceConnections(appType);
        }
    },

    setupInstanceResetListeners: function () {
        // Legacy: new UI uses onclick directly in generateEditorHtml
    },

    checkConnectionStatus: function (app, instanceIndex) {
        // Legacy: new UI uses checkEditorConnection
    },

    testConnectionAndUpdateStatus: function (app, instanceIndex, url, apiKey, statusElement) {
        this.testInstanceConnection(app, instanceIndex, { api_url: url, api_key: apiKey });
    },

    _resetSuppressionFlags: function () {
        if (window.huntarrUI) {
            window.huntarrUI.suppressUnsavedChangesCheck = false;
        }
        window._suppressUnsavedChangesDialog = false;
        window._appsSuppressChangeDetection = false;
    }
};

// Toggle CSS — removed; single source of truth is now style.css.
// Only non-toggle layout helpers remain.
const styleEl = document.createElement("style");
styleEl.innerHTML = `
    .setting-help {
        margin-left: -3ch !important;
    }
    @media (max-width: 768px) {
        .setting-item select {
            width: 100% !important;
            max-width: none !important;
        }
    }
`;
document.head.appendChild(styleEl);
