
/* === modules/features/settings/core.js === */
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
                tmdb_image_cache_days: parseInt(container.querySelector('#tmdb_image_cache_days')?.value || '30'),
                auth_mode: (container.querySelector('#auth_mode') && container.querySelector('#auth_mode').value) || 'login',
                ssl_verify: getVal('ssl_verify', true),
                base_url: getVal('base_url', ''),
                dev_key: getVal('dev_key', ''),
                web_server_threads: parseInt(container.querySelector('#web_server_threads')?.value || '32'),
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
            settings.enable_media_hunt = getInputValue("#enable_media_hunt", true);
            settings.enable_third_party_apps = getInputValue("#enable_third_party_apps", true);
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


/* === modules/features/settings/instance-editor.js === */
/**
 * Instance editor (Sonarr/Radarr/Lidarr/Readarr/Whisparr/Eros) - extends SettingsForms.
 * Loaded after settings/core.js.
 */
(function() {
    'use strict';
    if (typeof window.SettingsForms === 'undefined') return;

    let _instanceEditorDirty = false;

    Object.assign(window.SettingsForms, {
    getAppIcon: function(appType) {
        const icons = {
            sonarr: 'fa-tv',
            radarr: 'fa-film',
            lidarr: 'fa-music',
            readarr: 'fa-book',
            whisparr: 'fa-venus',
            eros: 'fa-venus-mars',
            prowlarr: 'fa-search'
        };
        return icons[appType] || 'fa-server';
    },

    // Render a single instance card. options: { hideDelete: true } for single-instance apps (e.g. Prowlarr).
    renderInstanceCard: function(appType, instance, index, options) {
        const isDefault = index === 0;
        
        // Determine connection status; disabled instances are never tested
        let statusClass = 'status-unknown';
        let statusIcon = 'fa-question-circle';
        
        if (instance.enabled === false) {
            statusClass = 'status-disabled';
            statusIcon = 'fa-ban';
        } else if (instance.api_url && instance.api_key) {
            // Has URL and API key - check if connection test passed
            if (instance.connection_status === 'connected' || instance.connection_test_passed === true) {
                statusClass = 'status-connected';
                statusIcon = 'fa-check-circle';
            } else if (instance.connection_status === 'error' || instance.connection_test_passed === false) {
                statusClass = 'status-error';
                statusIcon = 'fa-minus-circle';
            } else {
                statusClass = 'status-unknown';
                statusIcon = 'fa-question-circle';
            }
        } else {
            statusClass = 'status-error';
            statusIcon = 'fa-minus-circle';
        }
        
        const hideDelete = (options && options.hideDelete) === true;
        const footerButtons = hideDelete
            ? `<button type="button" class="btn-card edit" data-app-type="${appType}" data-instance-index="${index}"><i class="fas fa-edit"></i> Edit</button>`
            : `<button type="button" class="btn-card edit" data-app-type="${appType}" data-instance-index="${index}"><i class="fas fa-edit"></i> Edit</button>
                    <button type="button" class="btn-card delete" data-app-type="${appType}" data-instance-index="${index}"><i class="fas fa-trash"></i> Delete</button>`;
        return `
            <div class="instance-card ${isDefault ? 'default-instance' : ''}" data-instance-index="${index}" data-app-type="${appType}">
                <div class="instance-card-header">
                    <div class="instance-name instance-name-with-priority">
                        <i class="fas ${this.getAppIcon(appType)}"></i>
                        ${instance.name || 'Unnamed Instance'}
                        ${isDefault ? '<span class="default-badge">Default</span>' : ''}
                    </div>
                    <div class="instance-status-icon ${statusClass}">
                        <i class="fas ${statusIcon}"></i>
                    </div>
                </div>
                <div class="instance-card-body">
                    <div class="instance-detail">
                        <i class="fas fa-link"></i>
                        <span style="text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">${instance.api_url || 'No URL Configured'}</span>
                    </div>
                    <div class="instance-detail">
                        <i class="fas fa-key"></i>
                        <span>${instance.api_key ? '••••••••' + instance.api_key.slice(-4) : 'No API Key'}</span>
                    </div>
                </div>
                <div class="instance-card-footer">
                    ${footerButtons}
                </div>
            </div>
        `;
    },

    // Navigate to the instance editor section
    navigateToInstanceEditor: function(appType, index = null) {
        console.log(`[SettingsForms] navigateToInstanceEditor called for ${appType}, index: ${index}`);
        
        // Reset next section tracking
        this._instanceEditorNextSection = null;

        if (!window.huntarrUI || !window.huntarrUI.originalSettings) {
            console.error('[SettingsForms] window.huntarrUI.originalSettings is missing');
            if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Error: Settings not loaded. Please refresh the page.', 'error');
            else alert('Error: Settings not loaded. Please refresh the page.');
            return;
        }

        const settings = window.huntarrUI.originalSettings[appType];
        if (!settings) {
            console.error(`[SettingsForms] Settings for ${appType} not found in originalSettings`);
            if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Error: Settings for ' + appType + ' not found. Please refresh the page.', 'error');
            else alert('Error: Settings for ' + appType + ' not found. Please refresh the page.');
            return;
        }

        const isEdit = index !== null;
        let instance;
        
        if (isEdit) {
            if (!settings.instances || !settings.instances[index]) {
                console.error(`[SettingsForms] Instance at index ${index} not found for ${appType}`);
                if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Error: Instance not found.', 'error');
                else alert('Error: Instance not found.');
                return;
            }
            instance = settings.instances[index];
        } else {
            instance = {
                name: '',
                api_url: '',
                api_key: '',
                enabled: true,
                hunt_missing_items: 1,
                hunt_upgrade_items: 0,
                hunt_missing_mode: 'seasons_packs',
                upgrade_mode: 'seasons_packs',
                state_management_mode: 'custom',
                state_management_hours: 72,
                swaparr_enabled: false
            };
        }

        // Store current editing state
        this._currentEditing = { appType, index, originalInstance: JSON.parse(JSON.stringify(instance)) };
        _instanceEditorDirty = false;

        // Update breadcrumb in the header
        const bcAppName = document.getElementById('ie-breadcrumb-app-name');
        const bcInstanceName = document.getElementById('ie-breadcrumb-instance-name');
        const bcAppIcon = document.getElementById('ie-breadcrumb-app-icon');
        if (bcAppName) bcAppName.textContent = appType.charAt(0).toUpperCase() + appType.slice(1);
        if (bcInstanceName) bcInstanceName.textContent = instance.name || (isEdit ? 'Edit Instance' : 'New Instance');
        if (bcAppIcon) {
            bcAppIcon.className = 'fas ' + this.getAppIcon(appType);
        }

        const contentEl = document.getElementById('instance-editor-content');
        if (contentEl) {
            try {
                const html = this.generateEditorHtml(appType, instance, index);
                contentEl.innerHTML = html;
                console.log('[SettingsForms] Editor HTML injected, length:', html.length);
                this.setupExemptTagsListeners(contentEl);
            } catch (e) {
                console.error('[SettingsForms] Error generating editor HTML:', e);
                contentEl.innerHTML = `<div class="error-message" style="color: #ef4444; padding: 20px;">Error generating editor: ${e.message}</div>`;
            }
        } else {
            console.error('[SettingsForms] instance-editor-content element not found');
        }

        // Setup button listeners
        const saveBtn = document.getElementById('instance-editor-save');
        const backBtn = document.getElementById('instance-editor-back');

        if (saveBtn) {
            saveBtn.onclick = () => this.saveInstanceFromEditor();
        }
        if (backBtn) {
            backBtn.onclick = () => {
                this.confirmLeaveInstanceEditor((result) => {
                    if (result === 'save') {
                        this.saveInstanceFromEditor(true); // true means navigate back after save
                    } else if (result === 'discard') {
                        this.cancelInstanceEditor();
                    }
                });
            };
        }
        
        // Setup connection validation for URL and API Key inputs
        const urlInput = document.getElementById('editor-url');
        const keyInput = document.getElementById('editor-key');
        
        if (urlInput && keyInput) {
            let validationTimeout;
            const validateConnection = () => {
                clearTimeout(validationTimeout);
                validationTimeout = setTimeout(() => {
                    const url = urlInput.value.trim();
                    const key = keyInput.value.trim();
                    this.checkEditorConnection(appType, url, key);
                }, 500); // Debounce 500ms
            };
            
            urlInput.addEventListener('input', validateConnection);
            keyInput.addEventListener('input', validateConnection);
            
            const enabledSelect = document.getElementById('editor-enabled');
            if (enabledSelect) {
                enabledSelect.addEventListener('change', validateConnection);
            }
            
            // Initial validation - checkEditorConnection shows "Disabled" or runs test
            this.checkEditorConnection(appType, urlInput.value.trim(), keyInput.value.trim());
        }

        // Switch to the editor section
        console.log('[SettingsForms] Switching to instance-editor section');
        if (window.huntarrUI && window.huntarrUI.switchSection) {
            window.huntarrUI.switchSection('instance-editor');
            // Update URL hash for app instance editors (radarr, sonarr, etc.)
            const appInstanceEditors = ['sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros', 'prowlarr'];
            if (appInstanceEditors.includes(appType)) {
                const hashPart = (index !== null && index !== undefined) ? appType + '-settings/' + index : appType + '-settings';
                const newUrl = (window.location.pathname || '') + (window.location.search || '') + '#' + hashPart;
                try { window.history.replaceState(null, '', newUrl); } catch (e) { /* ignore */ }
            }
            // Add change detection after a short delay to let values settle
            setTimeout(() => {
                this.setupEditorChangeDetection();
                // Initialize form field states based on enabled status
                this.toggleFormFields();
                // Sync upgrade tag group and upgrade-items-tag section visibility (tags vs cutoff mode)
                this.toggleUpgradeTagVisibility();
                // Start polling state status if state management is enabled
                if (instance.state_management_mode !== 'disabled') {
                    this.startStateStatusPolling(appType, index);
                }
            }, 100);
        } else {
            console.error('[SettingsForms] window.huntarrUI.switchSection not available');
        }
    },

    // Setup exempt tags add/remove in the instance editor
    setupExemptTagsListeners: function(container) {
        if (!container) return;
        const addBtn = container.querySelector('#editor-exempt-tag-add');
        const input = container.querySelector('#editor-exempt-tag-input');
        const list = container.querySelector('#editor-exempt-tags-list');
        if (!addBtn || !input || !list) return;
        const self = this;
        addBtn.addEventListener('click', function() { self.addExemptTag(input, list); });
        input.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') { e.preventDefault(); self.addExemptTag(input, list); }
        });
        list.addEventListener('click', function(e) {
            const removeEl = e.target.classList.contains('exempt-tag-remove') ? e.target : e.target.closest('.exempt-tag-remove');
            if (removeEl) {
                const chip = removeEl.closest('.exempt-tag-chip');
                if (chip) chip.remove();
                _instanceEditorDirty = true;
                const saveBtn = document.getElementById('instance-editor-save');
                if (saveBtn) { saveBtn.disabled = false; saveBtn.classList.add('enabled'); }
            }
        });
    },
    addExemptTag: function(inputEl, listEl) {
        const tag = (inputEl.value || '').trim();
        if (!tag) return;
        if (tag.toLowerCase() === 'upgradinatorr') {
            if (window.huntarrUI && window.huntarrUI.showNotification) {
                window.huntarrUI.showNotification('The tag "upgradinatorr" cannot be added as an exempt tag.', 'warning');
            } else {
                if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('The tag "upgradinatorr" cannot be added as an exempt tag.', 'error');
                else alert('The tag "upgradinatorr" cannot be added as an exempt tag.');
            }
            return;
        }
        const existing = listEl.querySelectorAll('.exempt-tag-chip');
        for (let i = 0; i < existing.length; i++) {
            if ((existing[i].getAttribute('data-tag') || '') === tag) return;
        }
        const chip = document.createElement('span');
        chip.className = 'exempt-tag-chip';
        chip.setAttribute('data-tag', tag);
        chip.innerHTML = '<span class="exempt-tag-remove" title="Remove" aria-label="Remove">×</span><span>' + String(tag).replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span>';
        listEl.appendChild(chip);
        inputEl.value = '';
        _instanceEditorDirty = true;
        const saveBtn = document.getElementById('instance-editor-save');
        if (saveBtn) { saveBtn.disabled = false; saveBtn.classList.add('enabled'); }
    },

    // Setup change detection for the editor
    setupEditorChangeDetection: function() {
        const contentEl = document.getElementById('instance-editor-content');
        const saveBtn = document.getElementById('instance-editor-save');
        if (!contentEl || !saveBtn) return;

        // Initial state: disabled
        saveBtn.disabled = true;
        saveBtn.classList.remove('enabled');

        const handleInputChange = () => {
            _instanceEditorDirty = true;
            saveBtn.disabled = false;
            saveBtn.classList.add('enabled');
        };

        // Listen for any input or change event within the content area
        contentEl.addEventListener('input', handleInputChange);
        contentEl.addEventListener('change', handleInputChange);

        // Show warning when API cap hourly is above 25 (indexer ban risk)
        const capInput = document.getElementById('editor-hourly-cap');
        const capWarning = document.getElementById('editor-hourly-cap-warning');
        if (capInput && capWarning) {
            const updateHourlyCapWarning = () => {
                const val = parseInt(capInput.value, 10);
                capWarning.style.display = (val > 25) ? 'block' : 'none';
            };
            updateHourlyCapWarning();
            capInput.addEventListener('input', updateHourlyCapWarning);
            capInput.addEventListener('change', updateHourlyCapWarning);
        }
    },

    confirmLeaveInstanceEditor: function(done) {
        if (!_instanceEditorDirty) {
            if (typeof done === 'function') done('discard');
            return true;
        }
        if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
            window.HuntarrConfirm.show({
                title: 'Unsaved Changes',
                message: 'You have unsaved changes that will be lost if you leave.',
                confirmLabel: 'Go Back',
                cancelLabel: 'Leave',
                onConfirm: function() {
                    // Stay on the editor — modal just closes, user can save manually
                },
                onCancel: function() {
                    if (typeof done === 'function') done('discard');
                }
            });
        } else {
            // Fallback to native confirm
            if (!confirm('You have unsaved changes that will be lost. Leave anyway?')) return;
            if (typeof done === 'function') done('discard');
        }
        return false;
    },

    isInstanceEditorDirty: function() {
        return !!_instanceEditorDirty;
    },

    // Public method to clear the dirty flag and disable the save button (used by Prowlarr editor etc.)
    clearInstanceEditorDirty: function() {
        _instanceEditorDirty = false;
        const saveBtn = document.getElementById('instance-editor-save');
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.classList.remove('enabled');
        }
    },
    
    // Check connection status for editor
    checkEditorConnection: function(appType, url, apiKey) {
        const container = document.getElementById('connection-status-container');
        if (!container) return;
        
        // Add flex-end to push to right
        container.style.display = 'flex';
        container.style.justifyContent = 'flex-end';
        container.style.flex = '1';
        
        // If instance is disabled, do not attempt or show connection status
        const enabledEl = document.getElementById('editor-enabled');
        if (enabledEl && enabledEl.value === 'false') {
            container.innerHTML = `
                <div class="connection-status" style="background: rgba(100, 116, 139, 0.15); color: #94a3b8; border: 1px solid rgba(148, 163, 184, 0.25);">
                    <i class="fas fa-ban"></i>
                    <span>Disabled</span>
                </div>
            `;
            return;
        }
        
        // Show appropriate status for incomplete fields (like old version)
        const urlLen = url ? url.trim().length : 0;
        const keyLen = apiKey ? apiKey.trim().length : 0;

        if (urlLen <= 10 && keyLen <= 20) {
            container.innerHTML = `
                <div class="connection-status" style="background: rgba(148, 163, 184, 0.1); color: #94a3b8; border: 1px solid rgba(148, 163, 184, 0.2);">
                    <i class="fas fa-info-circle"></i>
                    <span>Enter URL and API Key</span>
                </div>
            `;
            return;
        } else if (urlLen <= 10) {
            container.innerHTML = `
                <div class="connection-status" style="background: rgba(251, 191, 36, 0.1); color: #fbbf24; border: 1px solid rgba(251, 191, 36, 0.2);">
                    <i class="fas fa-exclamation-triangle"></i>
                    <span>Missing URL</span>
                </div>
            `;
            return;
        } else if (keyLen <= 20) {
            container.innerHTML = `
                <div class="connection-status" style="background: rgba(251, 191, 36, 0.1); color: #fbbf24; border: 1px solid rgba(251, 191, 36, 0.2);">
                    <i class="fas fa-exclamation-triangle"></i>
                    <span>Missing API Key</span>
                </div>
            `;
            return;
        }
        
        container.innerHTML = `
            <div class="connection-status checking">
                <i class="fas fa-spinner fa-spin"></i>
                <span>Checking...</span>
            </div>
        `;
        
        // Test the connection using the correct endpoint
        HuntarrUtils.fetchWithTimeout(`./api/${appType}/test-connection`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ api_url: url, api_key: apiKey })
        }, 10000)
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                let statusText = 'Connected';
                if (data.version) {
                    statusText = `Connected (${data.version})`;
                }
                container.innerHTML = `
                    <div class="connection-status success">
                        <i class="fas fa-check-circle"></i>
                        <span>${statusText}</span>
                    </div>
                `;
            } else {
                // If connection failed, show the error message from the API if available
                const errorMsg = data.error || data.message || 'Connection failed';
                container.innerHTML = `
                    <div class="connection-status error">
                        <i class="fas fa-times-circle"></i>
                        <span>${errorMsg}</span>
                    </div>
                `;
            }
        })
        .catch(error => {
            container.innerHTML = `
                <div class="connection-status error">
                    <i class="fas fa-times-circle"></i>
                    <span>Connection failed: ${error.message || 'Network error'}</span>
                </div>
            `;
        });
    },

    // Generate HTML for the full-page editor
    generateEditorHtml: function(appType, instance, index) {
        console.log(`[SettingsForms] Generating editor HTML for ${appType}, instance index: ${index}`);
        const isEdit = index !== null;
        const swaparrEnabled = this.isSwaparrGloballyEnabled();
        
        // Ensure instance properties have defaults if undefined
        const safeInstance = {
            enabled: instance.enabled !== false,
            name: instance.name || '',
            instance_id: instance.instance_id || '',
            api_url: instance.api_url || '',
            api_key: instance.api_key || '',
            hunt_missing_items: instance.hunt_missing_items !== undefined ? instance.hunt_missing_items : 1,
            hunt_upgrade_items: instance.hunt_upgrade_items !== undefined ? instance.hunt_upgrade_items : 0,
            hunt_missing_mode: instance.hunt_missing_mode || 'seasons_packs',
            upgrade_mode: instance.upgrade_mode || 'seasons_packs',
            air_date_delay_days: instance.air_date_delay_days || 0,
            release_date_delay_days: instance.release_date_delay_days || 0,
            state_management_mode: instance.state_management_mode || 'custom',
            state_management_hours: instance.state_management_hours || 72,
            swaparr_enabled: instance.swaparr_enabled === true,
            // Additional Options (per-instance)
            monitored_only: instance.monitored_only !== false,
            skip_future_episodes: instance.skip_future_episodes !== false,
            tag_processed_items: instance.tag_processed_items !== false,
            tag_enable_missing: instance.tag_enable_missing !== false,
            tag_enable_upgrade: instance.tag_enable_upgrade !== false,
            tag_enable_upgraded: instance.tag_enable_upgraded !== false,
            tag_enable_shows_missing: instance.tag_enable_shows_missing !== false,
            // Custom Tags (per-instance)
            custom_tags: instance.custom_tags || {},
            // Exempt Tags (per-instance) - items with these tags are skipped for missing/upgrade
            exempt_tags: Array.isArray(instance.exempt_tags) ? instance.exempt_tags : [],
            // Advanced Settings (per-instance)
            api_timeout: instance.api_timeout || 120,
            command_wait_delay: instance.command_wait_delay || 1,
            command_wait_attempts: instance.command_wait_attempts || 600,
            max_download_queue_size: instance.max_download_queue_size !== undefined ? instance.max_download_queue_size : -1,
            max_seed_queue_size: instance.max_seed_queue_size !== undefined ? instance.max_seed_queue_size : -1,
            seed_check_torrent_client: instance.seed_check_torrent_client && typeof instance.seed_check_torrent_client === 'object' ? instance.seed_check_torrent_client : null,
            // Cycle settings (per-instance; were global in 9.0.x)
            sleep_duration: instance.sleep_duration !== undefined ? instance.sleep_duration : 900,
            hourly_cap: instance.hourly_cap !== undefined ? instance.hourly_cap : 20
        };

        // Handle specific fields for different apps
        if (appType === 'sonarr') {
            safeInstance.hunt_missing_items = instance.hunt_missing_items !== undefined ? instance.hunt_missing_items : 1;
            safeInstance.hunt_upgrade_items = instance.hunt_upgrade_items !== undefined ? instance.hunt_upgrade_items : 0;
            safeInstance.upgrade_selection_method = instance.upgrade_selection_method !== undefined ? instance.upgrade_selection_method : 'cutoff';
            safeInstance.upgrade_tag = instance.upgrade_tag !== undefined ? instance.upgrade_tag : '';
        } else if (appType === 'radarr') {
            safeInstance.hunt_missing_items = instance.hunt_missing_movies !== undefined ? instance.hunt_missing_movies : 1;
            safeInstance.hunt_upgrade_items = instance.hunt_upgrade_movies !== undefined ? instance.hunt_upgrade_movies : 0;
            safeInstance.upgrade_selection_method = instance.upgrade_selection_method !== undefined ? instance.upgrade_selection_method : 'cutoff';
            safeInstance.upgrade_tag = instance.upgrade_tag !== undefined ? instance.upgrade_tag : '';
        } else if (appType === 'lidarr') {
            safeInstance.hunt_missing_items = instance.hunt_missing_items !== undefined ? instance.hunt_missing_items : 1;
            safeInstance.hunt_upgrade_items = instance.hunt_upgrade_items !== undefined ? instance.hunt_upgrade_items : 0;
            safeInstance.hunt_missing_mode = instance.hunt_missing_mode || 'album';
            safeInstance.upgrade_selection_method = instance.upgrade_selection_method !== undefined ? instance.upgrade_selection_method : 'cutoff';
            safeInstance.upgrade_tag = instance.upgrade_tag !== undefined ? instance.upgrade_tag : '';
        } else if (appType === 'readarr') {
            safeInstance.hunt_missing_items = instance.hunt_missing_books !== undefined ? instance.hunt_missing_books : 1;
            safeInstance.hunt_upgrade_items = instance.hunt_upgrade_books !== undefined ? instance.hunt_upgrade_books : 0;
            safeInstance.upgrade_selection_method = instance.upgrade_selection_method !== undefined ? instance.upgrade_selection_method : 'cutoff';
            safeInstance.upgrade_tag = instance.upgrade_tag !== undefined ? instance.upgrade_tag : '';
        } else if (appType === 'eros') {
            safeInstance.hunt_missing_items = instance.hunt_missing_items !== undefined ? instance.hunt_missing_items : 1;
            safeInstance.hunt_upgrade_items = instance.hunt_upgrade_items !== undefined ? instance.hunt_upgrade_items : 0;
            safeInstance.search_mode = instance.search_mode !== undefined ? instance.search_mode : 'movie';
        }

        const devMode = !!(window.huntarrUI && window.huntarrUI.originalSettings && window.huntarrUI.originalSettings.general && window.huntarrUI.originalSettings.general.dev_mode);
        const sleepMin = devMode ? 1 : 10;

        // Default port and example URL per app (for placeholder and help text)
        const defaultPortByApp = { sonarr: 8989, radarr: 7878, lidarr: 8686, readarr: 8787, whisparr: 6969, eros: 6969 };
        const defaultPort = defaultPortByApp[appType] || 8989;
        const exampleUrl = `http://localhost:${defaultPort}`;
        const placeholderUrl = `http://192.168.1.100:${defaultPort}`;

        let html = `
            <div class="editor-grid">
                <div class="editor-section">
                    <div class="editor-section-title">
                        <span class="section-title-text">
                            <span class="section-title-icon accent-connection"><i class="fas fa-plug"></i></span>
                            Connection Details
                        </span>
                        <div id="connection-status-container"></div>
                    </div>
                    
                    <div class="editor-field-group tag-sub-box">
                        <div class="editor-setting-item">
                            <label style="display: flex; align-items: center;">
                                <span>Enable Status </span>
                                <i id="enable-status-icon" class="fas ${safeInstance.enabled ? 'fa-check-circle' : 'fa-minus-circle'}" style="color: ${safeInstance.enabled ? '#10b981' : '#ef4444'}; font-size: 1.1rem;"></i>
                            </label>
                            <select id="editor-enabled" onchange="window.SettingsForms.updateEnableStatusIcon(); window.SettingsForms.toggleFormFields();">
                                <option value="true" ${safeInstance.enabled ? 'selected' : ''}>Enabled</option>
                                <option value="false" ${!safeInstance.enabled ? 'selected' : ''}>Disabled</option>
                            </select>
                        </div>
                        <p class="editor-help-text">Enable or disable this instance</p>
                    </div>
                    
                    <div class="editor-field-group">
                        <div class="editor-setting-item">
                            <label>Name</label>
                            <input type="text" id="editor-name" value="${safeInstance.name}" placeholder="e.g. Main Sonarr, 4K Radarr">
                        </div>
                        <p class="editor-help-text">A friendly name to identify this instance</p>
                    </div>
                    
                    <div class="editor-field-group">
                        <div class="editor-setting-item">
                            <label>URL</label>
                            <input type="text" id="editor-url" value="${safeInstance.api_url}" placeholder="${placeholderUrl}">
                        </div>
                        <p class="editor-help-text">The full URL including port (e.g. ${exampleUrl})</p>
                    </div>
                    
                    <div class="editor-field-group">
                        <div class="editor-setting-item">
                            <label>API Key</label>
                            <input type="text" id="editor-key" value="${safeInstance.api_key}" placeholder="Your API Key">
                        </div>
                        <p class="editor-help-text">Found in Settings > General in your *arr application</p>
                    </div>
                    
                    <div class="editor-field-group editor-field-readonly">
                        <div class="editor-setting-item">
                            <label>Instance Identifier</label>
                            <input type="text" id="editor-instance-id" value="${(safeInstance.instance_id || '—').replace(/"/g, '&quot;')}" readonly disabled class="editor-input-readonly">
                        </div>
                        <p class="editor-help-text">Stable identifier for this instance (assigned automatically; cannot be changed)</p>
                    </div>
                </div>
        `;

        if (appType === 'sonarr') {
            html += `
                <div class="editor-section">
                    <div class="editor-section-title"><span class="section-title-text"><span class="section-title-icon accent-search"><i class="fas fa-search"></i></span>Search Settings</span></div>
                    
                    <div class="editor-field-group">
                        <div class="editor-setting-item">
                            <label>Missing Search Count</label>
                            <input type="number" id="editor-missing-count" value="${safeInstance.hunt_missing_items}">
                        </div>
                        <p class="editor-help-text">Number of missing items to search for in each cycle</p>
                    </div>
                    
                    <div class="editor-field-group">
                        <div class="editor-setting-item">
                            <label>Upgrade Search Count</label>
                            <input type="number" id="editor-upgrade-count" value="${safeInstance.hunt_upgrade_items}">
                        </div>
                        <p class="editor-help-text">Number of items to upgrade in each cycle</p>
                    </div>
                    
                    <div class="editor-field-group">
                        <div class="editor-setting-item">
                            <label>Missing Search Mode</label>
                            <select id="editor-missing-mode">
                                <option value="seasons_packs" ${safeInstance.hunt_missing_mode === 'seasons_packs' ? 'selected' : ''}>Season Packs</option>
                                <option value="shows" ${safeInstance.hunt_missing_mode === 'shows' ? 'selected' : ''}>Shows</option>
                                <option value="episodes" ${safeInstance.hunt_missing_mode === 'episodes' ? 'selected' : ''}>Episodes</option>
                            </select>
                        </div>
                        <p class="editor-help-text">How to search for missing content</p>
                    </div>
                    
                    <div class="editor-field-group">
                        <div class="editor-setting-item">
                            <label>Upgrade Mode</label>
                            <select id="editor-upgrade-mode">
                                <option value="seasons_packs" ${safeInstance.upgrade_mode === 'seasons_packs' ? 'selected' : ''}>Season Packs</option>
                                <option value="shows" ${safeInstance.upgrade_mode === 'shows' ? 'selected' : ''}>Shows</option>
                                <option value="episodes" ${safeInstance.upgrade_mode === 'episodes' ? 'selected' : ''}>Episodes</option>
                            </select>
                        </div>
                        <p class="editor-help-text">How to search for upgrades</p>
                    </div>
                    
                    <div class="editor-field-group">
                        <div class="editor-setting-item">
                            <label>Upgrade Selection Method</label>
                            <select id="editor-upgrade-method" onchange="window.SettingsForms.toggleUpgradeTagVisibility();">
                                <option value="cutoff" ${(safeInstance.upgrade_selection_method || 'cutoff') === 'cutoff' ? 'selected' : ''}>Cutoff unmet</option>
                                <option value="tags" ${(safeInstance.upgrade_selection_method || 'cutoff') === 'tags' ? 'selected' : ''}>Tags</option>
                            </select>
                        </div>
                        <p class="editor-help-text"><strong>Cutoff unmet:</strong> Items below quality cutoff (default). Huntarr does not add any upgrade tag. <strong>Tags (Upgradinatorr):</strong> Huntarr finds items WITHOUT the tag below, runs upgrade searches, then ADDS that tag when done. 
                            <a href="https://trash-guides.info/" target="_blank" rel="noopener" style="color: #2ecc71; text-decoration: underline;">💡 TrashGuides</a> | 
                            <a href="https://github.com/angrycuban13/Just-A-Bunch-Of-Starr-Scripts/blob/main/Upgradinatorr/README.md#requirements" target="_blank" rel="noopener" style="color: #e74c3c; text-decoration: underline;">🔗 Upgradinatorr</a>
                        </p>
                    </div>
                    <div class="editor-field-group editor-upgrade-tag-group" style="display: ${(safeInstance.upgrade_selection_method || 'cutoff') === 'tags' ? 'flex' : 'none'};">
                        <div class="editor-setting-item">
                            <label>Upgrade Tag</label>
                            <input type="text" id="editor-upgrade-tag" value="${(safeInstance.upgrade_tag || 'upgradinatorr').replace(/"/g, '&quot;')}" placeholder="e.g. upgradinatorr">
                        </div>
                        <p class="editor-help-text">Tag name in Sonarr. Huntarr finds series that don’t have this tag, runs upgrade searches, then adds the tag when done (tracks what’s been processed). 
                            <a href="https://trash-guides.info/" target="_blank" rel="noopener" style="color: #2ecc71; text-decoration: underline;">💡 TrashGuides</a> | 
                            <a href="https://github.com/angrycuban13/Just-A-Bunch-Of-Starr-Scripts/blob/main/Upgradinatorr/README.md#requirements" target="_blank" rel="noopener" style="color: #e74c3c; text-decoration: underline;">🔗 Upgradinatorr</a>
                        </p>
                    </div>
                    
                    <div class="editor-field-group">
                        <div class="editor-setting-item">
                            <label>Air Date Delay (Days)</label>
                            <input type="number" id="editor-air-date-delay" value="${safeInstance.air_date_delay_days}">
                        </div>
                        <p class="editor-help-text">Only search for items that aired at least this many days ago</p>
                    </div>
                </div>
            `;
        } else if (['radarr', 'lidarr', 'readarr', 'whisparr', 'eros'].includes(appType)) {
             html += `
                <div class="editor-section">
                    <div class="editor-section-title"><span class="section-title-text"><span class="section-title-icon accent-search"><i class="fas fa-search"></i></span>Search Settings</span></div>
                    
                    <div class="editor-field-group">
                        <div class="editor-setting-item">
                            <label>Missing Search Count</label>
                            <input type="number" id="editor-missing-count" value="${safeInstance.hunt_missing_items}">
                        </div>
                        <p class="editor-help-text">Number of missing items to search for in each cycle</p>
                    </div>
                    
                    <div class="editor-field-group">
                        <div class="editor-setting-item">
                            <label>Upgrade Search Count</label>
                            <input type="number" id="editor-upgrade-count" value="${safeInstance.hunt_upgrade_items}">
                        </div>
                        <p class="editor-help-text">Number of items to upgrade in each cycle</p>
                    </div>
            `;
            if (appType === 'lidarr') {
                html += `
                    <div class="editor-field-group">
                        <div class="editor-setting-item">
                            <label>Missing Search Mode</label>
                            <select id="editor-lidarr-missing-mode">
                                <option value="album" ${(safeInstance.hunt_missing_mode || 'album') === 'album' ? 'selected' : ''}>Album</option>
                            </select>
                        </div>
                        <p class="editor-help-text">Search for individual albums (Artist mode deprecated in Huntarr 7.5.0+)</p>
                    </div>
                `;
            }
            if (appType === 'eros') {
                html += `
                    <div class="editor-field-group">
                        <div class="editor-setting-item">
                            <label>Search Mode</label>
                            <select id="editor-eros-search-mode">
                                <option value="movie" ${(safeInstance.search_mode || 'movie') === 'movie' ? 'selected' : ''}>Movie</option>
                                <option value="scene" ${(safeInstance.search_mode || 'movie') === 'scene' ? 'selected' : ''}>Scene</option>
                            </select>
                        </div>
                        <p class="editor-help-text">How to search for missing and upgradable Whisparr V3 content (Movie-based or Scene-based)</p>
                    </div>
                `;
            }
            if (appType === 'radarr') {
                 html += `
                    <div class="editor-field-group">
                        <div class="editor-setting-item">
                            <label>Upgrade Selection Method</label>
                            <select id="editor-upgrade-method" onchange="window.SettingsForms.toggleUpgradeTagVisibility();">
                                <option value="cutoff" ${(safeInstance.upgrade_selection_method || 'cutoff') === 'cutoff' ? 'selected' : ''}>Cutoff unmet</option>
                                <option value="tags" ${(safeInstance.upgrade_selection_method || 'cutoff') === 'tags' ? 'selected' : ''}>Tags</option>
                            </select>
                        </div>
                        <p class="editor-help-text"><strong>Cutoff unmet:</strong> Items below quality cutoff (default). Huntarr does not add any upgrade tag. <strong>Tags (Upgradinatorr):</strong> Huntarr finds items WITHOUT the tag below, runs upgrade searches, then ADDS that tag when done. 
                            <a href="https://trash-guides.info/" target="_blank" rel="noopener" style="color: #2ecc71; text-decoration: underline;">💡 TrashGuides</a> | 
                            <a href="https://github.com/angrycuban13/Just-A-Bunch-Of-Starr-Scripts/blob/main/Upgradinatorr/README.md#requirements" target="_blank" rel="noopener" style="color: #e74c3c; text-decoration: underline;">🔗 Upgradinatorr</a>
                        </p>
                    </div>
                    <div class="editor-field-group editor-upgrade-tag-group" style="display: ${(safeInstance.upgrade_selection_method || 'cutoff') === 'tags' ? 'flex' : 'none'};">
                        <div class="editor-setting-item">
                            <label>Upgrade Tag</label>
                            <input type="text" id="editor-upgrade-tag" value="${(safeInstance.upgrade_tag || 'upgradinatorr').replace(/"/g, '&quot;')}" placeholder="e.g. upgradinatorr">
                        </div>
                        <p class="editor-help-text">Tag name in Radarr. Huntarr finds movies that don’t have this tag, runs upgrade searches, then adds the tag when done (tracks what’s been processed). 
                            <a href="https://trash-guides.info/" target="_blank" rel="noopener" style="color: #2ecc71; text-decoration: underline;">💡 TrashGuides</a> | 
                            <a href="https://github.com/angrycuban13/Just-A-Bunch-Of-Starr-Scripts/blob/main/Upgradinatorr/README.md#requirements" target="_blank" rel="noopener" style="color: #e74c3c; text-decoration: underline;">🔗 Upgradinatorr</a>
                        </p>
                    </div>
                    <div class="editor-field-group">
                        <div class="editor-setting-item">
                            <label>Release Date Delay (Days)</label>
                            <input type="number" id="editor-release-date-delay" value="${safeInstance.release_date_delay_days}">
                        </div>
                        <p class="editor-help-text">Only search for items released at least this many days ago</p>
                    </div>
                 `;
            }
            if (appType === 'lidarr' || appType === 'readarr') {
                 const tagHelp = appType === 'lidarr'
                     ? 'Tag name on artists in Lidarr. Huntarr finds artists that don’t have this tag, runs upgrade searches on their albums, then adds the tag when done (tracks what’s been processed). <a href="https://trash-guides.info/" target="_blank" rel="noopener" style="color: #2ecc71; text-decoration: underline;">💡 TrashGuides</a> | <a href="https://github.com/angrycuban13/Just-A-Bunch-Of-Starr-Scripts/blob/main/Upgradinatorr/README.md#requirements" target="_blank" rel="noopener" style="color: #e74c3c; text-decoration: underline;">🔗 Upgradinatorr</a>'
                     : 'Tag name on authors in Readarr. Huntarr finds authors that don’t have this tag, runs upgrade searches on their books, then adds the tag when done (tracks what’s been processed). <a href="https://trash-guides.info/" target="_blank" rel="noopener" style="color: #2ecc71; text-decoration: underline;">💡 TrashGuides</a> | <a href="https://github.com/angrycuban13/Just-A-Bunch-Of-Starr-Scripts/blob/main/Upgradinatorr/README.md#requirements" target="_blank" rel="noopener" style="color: #e74c3c; text-decoration: underline;">🔗 Upgradinatorr</a>';
                 html += `
                    <div class="editor-field-group">
                        <div class="editor-setting-item">
                            <label>Upgrade Selection Method</label>
                            <select id="editor-upgrade-method" onchange="window.SettingsForms.toggleUpgradeTagVisibility();">
                                <option value="cutoff" ${(safeInstance.upgrade_selection_method || 'cutoff') === 'cutoff' ? 'selected' : ''}>Cutoff unmet</option>
                                <option value="tags" ${(safeInstance.upgrade_selection_method || 'cutoff') === 'tags' ? 'selected' : ''}>Tags</option>
                            </select>
                        </div>
                        <p class="editor-help-text"><strong>Cutoff unmet:</strong> Items below quality cutoff (default). Huntarr does not add any upgrade tag. <strong>Tags (Upgradinatorr):</strong> Huntarr finds items WITHOUT the tag below, runs upgrade searches, then ADDS that tag when done. 
                            <a href="https://trash-guides.info/" target="_blank" rel="noopener" style="color: #2ecc71; text-decoration: underline;">💡 TrashGuides</a> | 
                            <a href="https://github.com/angrycuban13/Just-A-Bunch-Of-Starr-Scripts/blob/main/Upgradinatorr/README.md#requirements" target="_blank" rel="noopener" style="color: #e74c3c; text-decoration: underline;">🔗 Upgradinatorr</a>
                        </p>
                    </div>
                    <div class="editor-field-group editor-upgrade-tag-group" style="display: ${(safeInstance.upgrade_selection_method || 'cutoff') === 'tags' ? 'flex' : 'none'};">
                        <div class="editor-setting-item">
                            <label>Upgrade Tag</label>
                            <input type="text" id="editor-upgrade-tag" value="${(safeInstance.upgrade_tag || 'upgradinatorr').replace(/"/g, '&quot;')}" placeholder="e.g. upgradinatorr">
                        </div>
                        <p class="editor-help-text">${tagHelp}</p>
                    </div>
                 `;
            }
            
            html += `</div>`;
        }
  
        // Stateful Management Section (separate from Advanced)
        html += `
                <div class="editor-section">
                    <div class="editor-section-title"><span class="section-title-text"><span class="section-title-icon accent-stateful"><i class="fas fa-database"></i></span>Stateful Management</span></div>
                    
                    <div class="editor-field-group">
                        <div class="editor-setting-item">
                            <label>State Management</label>
                            <select id="editor-state-mode">
                                <option value="custom" ${safeInstance.state_management_mode === 'custom' ? 'selected' : ''}>Enabled</option>
                                <option value="disabled" ${safeInstance.state_management_mode === 'disabled' ? 'selected' : ''}>Disabled</option>
                            </select>
                        </div>
                        <p class="editor-help-text">Track processed items to avoid redundant searches</p>
                    </div>
                    
                    <div class="editor-field-group">
                        <div class="editor-setting-item">
                            <label>Reset Interval (Hours)</label>
                            <input type="number" id="editor-state-hours" value="${safeInstance.state_management_hours}">
                        </div>
                        <p class="editor-help-text">How long to wait before re-searching a previously processed item (default: 72 hours / 3 days)</p>
                    </div>
                    
                    ${isEdit ? `
                    <div id="instance-editor-stateful-block" class="editor-field-group" style="display: ${safeInstance.state_management_mode === 'disabled' ? 'none' : 'block'};">
                        <button type="button" class="btn-card delete btn-reset-state" onclick="window.SettingsForms.resetInstanceState('${appType}', ${index})">
                            <i class="fas fa-undo"></i> Reset Processed State Now
                        </button>
                        <p class="editor-help-text" style="text-align: center; margin-top: -10px !important;">Clears the history of processed items for this instance</p>
                        <div id="state-status-display" style="margin-top: 15px; padding: 12px; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 8px;">
                            <div style="display: flex; align-items: center; justify-content: center; gap: 8px; color: #10b981; font-weight: 500; margin-bottom: 4px;">
                                <i class="fas fa-check-circle"></i>
                                <span>Active - Tracked Items: <span id="tracked-items-count">Loading...</span></span>
                            </div>
                            <div style="text-align: center; color: #94a3b8; font-size: 0.9rem;">
                                Next Reset: <span id="next-reset-time">Loading...</span>
                            </div>
                        </div>
                    </div>
                    ` : ''}
                </div>
                
                <div class="editor-section">
                    <div class="editor-section-title"><span class="section-title-text"><span class="section-title-icon accent-additional"><i class="fas fa-sliders-h"></i></span>Additional Settings</span></div>
                    
                    <div class="editor-field-group" style="margin-bottom: 12px;">
                        <div class="ie-warning-box warn-amber">
                            <i class="fas fa-exclamation-triangle" style="margin-right: 6px;"></i> Do not overwhelm your indexers. Contact them for advice!
                        </div>
                    </div>
                    <div class="editor-field-group">
                        <div class="editor-setting-item">
                            <label>Sleep Duration (Minutes)</label>
                            <input type="number" id="editor-sleep-duration" value="${Math.round((safeInstance.sleep_duration || 900) / 60)}" min="${sleepMin}" max="1440">
                        </div>
                        <p class="editor-help-text">Time in minutes between processing cycles (minimum ${sleepMin} minute${sleepMin === 1 ? '' : 's'}${devMode ? '; dev mode' : ''})</p>
                    </div>
                    
                    <div class="editor-field-group">
                        <div class="editor-setting-item">
                            <label>API Cap - Hourly</label>
                            <input type="number" id="editor-hourly-cap" value="${safeInstance.hourly_cap !== undefined ? safeInstance.hourly_cap : 20}" min="1" max="400">
                        </div>
                        <p class="editor-help-text">Maximum API requests per hour for this instance (10-20 recommended, max 400)</p>
                        <div id="editor-hourly-cap-warning" class="editor-hourly-cap-warning" style="display: none; margin-top: 8px; padding: 12px 14px; background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.5); border-radius: 6px; color: #fca5a5; font-size: 0.85rem; line-height: 1.4;">
                            <i class="fas fa-stop-circle" style="margin-right: 6px;"></i> <strong>Do not overwhelm your indexers.</strong> High request rates can trigger rate limits or bans. Keep at 10–20 unless your provider allows more. When in doubt, contact your indexer providers.
                        </div>
                    </div>
                    
                    <div class="editor-field-group">
                        <div class="editor-setting-item flex-row">
                            <label>Monitored Only</label>
                            <label class="toggle-switch">
                                <input type="checkbox" id="editor-monitored-only" ${safeInstance.monitored_only ? 'checked' : ''}>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                        <p class="editor-help-text">Only search for monitored items</p>
                    </div>
                    
                    ${appType === 'sonarr' ? `
                    <div class="editor-field-group">
                        <div class="editor-setting-item flex-row">
                            <label>Skip Future Episodes</label>
                            <label class="toggle-switch">
                                <input type="checkbox" id="editor-skip-future" ${safeInstance.skip_future_episodes ? 'checked' : ''}>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                        <p class="editor-help-text">Skip searching for episodes with future air dates</p>
                    </div>
                    ` : ''}
                </div>
                
                <div class="editor-section">
                    <div class="editor-section-title"><span class="section-title-text"><span class="section-title-icon accent-tags"><i class="fas fa-tags"></i></span>Tags</span></div>
                    
                    <div class="editor-field-group tag-sub-box">
                        <div class="editor-setting-item flex-row">
                            <label>Tag missing items</label>
                            <label class="toggle-switch">
                                <input type="checkbox" id="editor-tag-enable-missing" ${safeInstance.tag_enable_missing ? 'checked' : ''}>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                        <div class="editor-setting-item" style="margin-top: 6px;">
                            <label>Missing Items Tag</label>
                            <input type="text" id="editor-tag-missing" value="${safeInstance.custom_tags.missing || 'huntarr-missing'}" placeholder="huntarr-missing">
                        </div>
                        <p class="editor-help-text">Tag added to items when they're found by a missing search (max 25 characters)</p>
                    </div>
                    
                    <div class="editor-upgrade-items-tag-section editor-field-group tag-sub-box" style="display: ${(['sonarr','radarr','lidarr','readarr'].includes(appType) && (safeInstance.upgrade_selection_method || 'cutoff') === 'tags') ? 'none' : 'block'};">
                        <div class="editor-setting-item flex-row">
                            <label>Tag upgrade items</label>
                            <label class="toggle-switch">
                                <input type="checkbox" id="editor-tag-enable-upgrade" ${safeInstance.tag_enable_upgrade ? 'checked' : ''}>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                        <div class="editor-setting-item" style="margin-top: 6px;">
                            <label>Upgrade Items Tag</label>
                            <input type="text" id="editor-tag-upgrade" value="${safeInstance.custom_tags.upgrade || 'huntarr-upgrade'}" placeholder="huntarr-upgrade">
                        </div>
                        <p class="editor-help-text">Tag added to items when they're upgraded in cutoff mode (max 25 characters). Not used when Upgrade Selection Method is Tags.</p>
                    </div>
                    
                    ${appType === 'sonarr' ? `
                    <div class="editor-field-group tag-sub-box">
                        <div class="editor-setting-item flex-row">
                            <label>Tag shows missing</label>
                            <label class="toggle-switch">
                                <input type="checkbox" id="editor-tag-enable-shows-missing" ${safeInstance.tag_enable_shows_missing ? 'checked' : ''}>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                        <div class="editor-setting-item" style="margin-top: 6px;">
                            <label>Shows Missing Tag</label>
                            <input type="text" id="editor-tag-shows-missing" value="${safeInstance.custom_tags.shows_missing || 'huntarr-shows-missing'}" placeholder="huntarr-shows-missing">
                        </div>
                        <p class="editor-help-text">Tag added to shows when missing items are found in shows mode (max 25 characters)</p>
                    </div>
                    ` : ''}
                    
                    <div class="editor-section exempt-tags-subsection" style="margin-top: 16px;">
                        <div class="editor-section-title"><span class="section-title-text"><span class="section-title-icon accent-exempt"><i class="fas fa-shield-alt"></i></span>Exempt Tags</span></div>
                        <p class="editor-help-text" style="margin-bottom: 12px;">Items with any of these tags are skipped for missing and upgrade searches. If the tag is removed in the app, Huntarr will process the item again. <a href="https://github.com/plexguide/Huntarr.io/issues/676" target="_blank" rel="noopener" style="color: #94a3b8;">#676</a></p>
                        <div class="editor-field-group">
                            <div class="editor-setting-item">
                                <label>Add exempt tag</label>
                                <div style="display: flex; gap: 8px; align-items: center;">
                                    <input type="text" id="editor-exempt-tag-input" placeholder="Type a tag to exempt..." style="flex: 1;" maxlength="50">
                                    <button type="button" class="btn-card" id="editor-exempt-tag-add" style="padding: 8px 14px; white-space: nowrap;">Add</button>
                                </div>
                            </div>
                            <p class="editor-help-text" style="color: #94a3b8; font-size: 0.85rem;">Tag &quot;upgradinatorr&quot; cannot be added.</p>
                            <div id="editor-exempt-tags-list" style="display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; min-height: 24px;">
                                ${(safeInstance.exempt_tags || []).map(tag => `
                                    <span class="exempt-tag-chip" data-tag="${(tag || '').replace(/"/g, '&quot;')}">
                                        <span class="exempt-tag-remove" title="Remove" aria-label="Remove">×</span>
                                        <span>${(tag || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span>
                                    </span>
                                `).join('')}
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="editor-section">
                    <div class="editor-section-title"><span class="section-title-text"><span class="section-title-icon accent-advanced"><i class="fas fa-wrench"></i></span>Advanced Settings</span></div>
                    
                    <div class="editor-field-group">
                        <div class="editor-setting-item">
                            <label>API Timeout (seconds)</label>
                            <input type="number" id="editor-api-timeout" value="${safeInstance.api_timeout || 120}" min="30" max="600">
                        </div>
                        <p class="editor-help-text">Timeout for API requests to this instance (default: 120 seconds)</p>
                    </div>
                    
                    <div class="editor-field-group">
                        <div class="editor-setting-item">
                            <label>Command Wait Delay (seconds)</label>
                            <input type="number" id="editor-cmd-wait-delay" value="${safeInstance.command_wait_delay || 1}" min="1" max="10">
                        </div>
                        <p class="editor-help-text">Delay between command status checks (default: 1 second)</p>
                    </div>
                    
                    <div class="editor-field-group">
                        <div class="editor-setting-item">
                            <label>Command Wait Attempts</label>
                            <input type="number" id="editor-cmd-wait-attempts" value="${safeInstance.command_wait_attempts !== undefined && safeInstance.command_wait_attempts !== '' ? safeInstance.command_wait_attempts : 600}" min="0" max="1800">
                        </div>
                        <p class="editor-help-text">Maximum attempts to wait for command completion (default: 600). Set to 0 for fire-and-forget: trigger search and don't wait — reduces API usage when Sonarr's command queue is slow.</p>
                    </div>
                    
                    <div class="editor-field-group">
                        <div class="editor-setting-item">
                            <label>Max Download Queue Size</label>
                            <input type="number" id="editor-max-queue-size" value="${safeInstance.max_download_queue_size !== undefined ? safeInstance.max_download_queue_size : -1}" min="-1" max="1000">
                        </div>
                        <p class="editor-help-text">Skip processing if queue size meets or exceeds this value (-1 = disabled, default)</p>
                    </div>
                    
                    ${swaparrEnabled ? `
                    <div class="editor-field-group">
                        <div class="editor-setting-item flex-row">
                            <label>Swaparr Monitoring</label>
                            <label class="toggle-switch">
                                <input type="checkbox" id="editor-swaparr" ${safeInstance.swaparr_enabled ? 'checked' : ''}>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                        <p class="editor-help-text">Enable Swaparr to monitor and remove stalled downloads for this instance</p>
                    </div>
                    ` : `
                    <div class="editor-field-group">
                        <p style="color: #94a3b8; font-size: 0.9rem; margin: 0;">Enable Swaparr in Settings to access additional monitoring features for this instance.</p>
                    </div>
                    `}
                </div>
                
                <div class="editor-section">
                    <div class="editor-section-title"><span class="section-title-text"><span class="section-title-icon accent-seed"><i class="fas fa-seedling"></i></span>Max Seed Queue (torrents only)</span></div>
                    <p class="editor-help-text" style="margin-bottom: 10px;">Skip hunts when this many torrents are actively seeding. Configure the torrent client below so Huntarr can read the seeding count.</p>
                    <div class="editor-field-group">
                        <div class="editor-setting-item">
                            <label>Max Seed Queue Size</label>
                            <input type="number" id="editor-max-seed-queue-size" value="${safeInstance.max_seed_queue_size !== undefined ? safeInstance.max_seed_queue_size : -1}" min="-1" max="1000">
                        </div>
                        <p class="editor-help-text">-1 = disabled. When &ge; 0, hunts are skipped when active seeding count meets or exceeds this value.</p>
                        <div class="editor-setting-item" style="margin-top: 10px;">
                            <label>Torrent client type</label>
                            <select id="editor-seed-client-type">
                                <option value="qbittorrent" ${!(safeInstance.seed_check_torrent_client && safeInstance.seed_check_torrent_client.type === 'transmission') ? 'selected' : ''}>qBittorrent</option>
                                <option value="transmission" ${(safeInstance.seed_check_torrent_client && safeInstance.seed_check_torrent_client.type === 'transmission') ? 'selected' : ''}>Transmission</option>
                            </select>
                        </div>
                        <div class="editor-setting-item">
                            <label>Host</label>
                            <input type="text" id="editor-seed-client-host" value="${(safeInstance.seed_check_torrent_client && safeInstance.seed_check_torrent_client.host) ? String(safeInstance.seed_check_torrent_client.host).replace(/"/g, '&quot;') : ''}" placeholder="localhost or 192.168.1.100">
                        </div>
                        <div class="editor-setting-item">
                            <label>Port</label>
                            <input type="number" id="editor-seed-client-port" value="${(safeInstance.seed_check_torrent_client && (safeInstance.seed_check_torrent_client.port !== undefined && safeInstance.seed_check_torrent_client.port !== '')) ? safeInstance.seed_check_torrent_client.port : ''}" placeholder="8080 or 9091" min="1" max="65535">
                        </div>
                        <div class="editor-setting-item">
                            <label>Username</label>
                            <input type="text" id="editor-seed-client-username" value="${(safeInstance.seed_check_torrent_client && safeInstance.seed_check_torrent_client.username) ? String(safeInstance.seed_check_torrent_client.username).replace(/"/g, '&quot;') : ''}" placeholder="Optional">
                        </div>
                        <div class="editor-setting-item">
                            <label>Password</label>
                            <input type="password" id="editor-seed-client-password" value="${(safeInstance.seed_check_torrent_client && safeInstance.seed_check_torrent_client.password) ? String(safeInstance.seed_check_torrent_client.password).replace(/"/g, '&quot;') : ''}" placeholder="Optional" autocomplete="off">
                        </div>
                    </div>
                </div>
            </div>
        `;

        return html;
    },

    // Save instance from the full-page editor
    saveInstanceFromEditor: function(navigateBack = false) {
        if (!this._currentEditing) return;
        const { appType, index } = this._currentEditing;
        const settings = window.huntarrUI.originalSettings[appType];
        if (!settings) return;
  
        const tagEnableUpgradeEl = document.getElementById('editor-tag-enable-upgrade');
        const upgradeMethodEl = document.getElementById('editor-upgrade-method');
        const upgradeTagEl = document.getElementById('editor-upgrade-tag');
        const isTagsMode = upgradeMethodEl && upgradeMethodEl.value === 'tags';
        const tagEnableMissing = document.getElementById('editor-tag-enable-missing').checked;
        const tagEnableUpgrade = isTagsMode ? false : (tagEnableUpgradeEl ? tagEnableUpgradeEl.checked : false);
        const tagEnableShowsMissingEl = document.getElementById('editor-tag-enable-shows-missing');
        const tagEnableShowsMissing = tagEnableShowsMissingEl ? tagEnableShowsMissingEl.checked : false;
        const newData = {
            enabled: document.getElementById('editor-enabled').value === 'true',
            name: document.getElementById('editor-name').value,
            api_url: document.getElementById('editor-url').value,
            api_key: document.getElementById('editor-key').value,
            state_management_mode: document.getElementById('editor-state-mode').value,
            state_management_hours: parseInt(document.getElementById('editor-state-hours').value) || 72,
            // Additional Options
            monitored_only: document.getElementById('editor-monitored-only').checked,
            tag_processed_items: tagEnableMissing || tagEnableUpgrade || tagEnableShowsMissing,
            tag_enable_missing: tagEnableMissing,
            tag_enable_upgrade: tagEnableUpgrade,
            tag_enable_upgraded: false,
            tag_enable_shows_missing: tagEnableShowsMissing,
            // Custom Tags
            custom_tags: {
                missing: document.getElementById('editor-tag-missing').value,
                upgrade: (document.getElementById('editor-tag-upgrade') ? document.getElementById('editor-tag-upgrade').value : '') || 'huntarr-upgrade'
            },
            // Advanced Settings
            api_timeout: parseInt(document.getElementById('editor-api-timeout').value) || 120,
            command_wait_delay: parseInt(document.getElementById('editor-cmd-wait-delay').value) || 1,
            command_wait_attempts: (function(){ const el = document.getElementById('editor-cmd-wait-attempts'); if (!el) return 600; const v = parseInt(el.value, 10); return (!isNaN(v) && v >= 0) ? v : 600; })(),
            max_download_queue_size: parseInt(document.getElementById('editor-max-queue-size').value) || -1,
            max_seed_queue_size: (function(){ const v = parseInt(document.getElementById('editor-max-seed-queue-size').value, 10); return (!isNaN(v) && v >= -1) ? v : -1; })(),
            seed_check_torrent_client: (function() {
                const typeEl = document.getElementById('editor-seed-client-type');
                const type = (typeEl ? (typeEl.value || '').trim() : '') || 'qbittorrent';
                const hostEl = document.getElementById('editor-seed-client-host');
                const host = hostEl ? (hostEl.value || '').trim() : '';
                if (!host) return null;
                const portEl = document.getElementById('editor-seed-client-port');
                const portVal = portEl && portEl.value !== '' ? parseInt(portEl.value, 10) : (type === 'qbittorrent' ? 8080 : 9091);
                const port = (!isNaN(portVal) && portVal >= 1 && portVal <= 65535) ? portVal : (type === 'qbittorrent' ? 8080 : 9091);
                const userEl = document.getElementById('editor-seed-client-username');
                const passEl = document.getElementById('editor-seed-client-password');
                return { type: type, host: host, port: port, username: userEl ? userEl.value : '', password: passEl ? passEl.value : '' };
            })(),
            // Per-instance cycle settings
            sleep_duration: (parseInt(document.getElementById('editor-sleep-duration').value, 10) || 15) * 60,
            hourly_cap: parseInt(document.getElementById('editor-hourly-cap').value, 10) || 20
        };
        
        // Add skip_future_episodes for Sonarr
        const skipFutureInput = document.getElementById('editor-skip-future');
        if (skipFutureInput) {
            newData.skip_future_episodes = skipFutureInput.checked;
        }
        
        // Add shows_missing tag for Sonarr
        const showsMissingTagInput = document.getElementById('editor-tag-shows-missing');
        if (showsMissingTagInput) {
            newData.custom_tags.shows_missing = showsMissingTagInput.value;
        }
        
        const swaparrInput = document.getElementById('editor-swaparr');
        if (swaparrInput) {
            newData.swaparr_enabled = swaparrInput.checked;
        }
  
        if (appType === 'sonarr') {
            newData.hunt_missing_items = parseInt(document.getElementById('editor-missing-count').value) || 0;
            newData.hunt_upgrade_items = parseInt(document.getElementById('editor-upgrade-count').value) || 0;
            newData.hunt_missing_mode = document.getElementById('editor-missing-mode').value;
            newData.upgrade_mode = document.getElementById('editor-upgrade-mode').value;
            newData.air_date_delay_days = parseInt(document.getElementById('editor-air-date-delay').value) || 0;
            newData.upgrade_selection_method = (upgradeMethodEl && upgradeMethodEl.value) ? upgradeMethodEl.value : 'cutoff';
            // Auto-fill "upgradinatorr" if tags mode is selected but no tag is provided
            let upgradeTagValue = (upgradeTagEl && upgradeTagEl.value) ? String(upgradeTagEl.value).trim() : '';
            if (newData.upgrade_selection_method === 'tags' && !upgradeTagValue) {
                upgradeTagValue = 'upgradinatorr';
            }
            newData.upgrade_tag = upgradeTagValue;
        }
        const exemptTagsListEl = document.getElementById('editor-exempt-tags-list');
        newData.exempt_tags = exemptTagsListEl ? Array.from(exemptTagsListEl.querySelectorAll('.exempt-tag-chip')).map(el => el.getAttribute('data-tag') || '').filter(Boolean) : [];
        if (appType !== 'sonarr') {
             const missingField = appType === 'radarr' ? 'hunt_missing_movies' : (appType === 'readarr' ? 'hunt_missing_books' : 'hunt_missing_items');
             const upgradeField = appType === 'radarr' ? 'hunt_upgrade_movies' : (appType === 'readarr' ? 'hunt_upgrade_books' : 'hunt_upgrade_items');
             
             newData[missingField] = parseInt(document.getElementById('editor-missing-count').value) || 0;
             newData[upgradeField] = parseInt(document.getElementById('editor-upgrade-count').value) || 0;
  
             if (appType === 'radarr') {
                 newData.release_date_delay_days = parseInt(document.getElementById('editor-release-date-delay').value) || 0;
             }
             if (appType === 'radarr' || appType === 'lidarr' || appType === 'readarr') {
                 newData.upgrade_selection_method = (upgradeMethodEl && upgradeMethodEl.value) ? upgradeMethodEl.value : 'cutoff';
                 // Auto-fill "upgradinatorr" if tags mode is selected but no tag is provided
                 let upgradeTagValue = (upgradeTagEl && upgradeTagEl.value) ? String(upgradeTagEl.value).trim() : '';
                 if (newData.upgrade_selection_method === 'tags' && !upgradeTagValue) {
                     upgradeTagValue = 'upgradinatorr';
                 }
                 newData.upgrade_tag = upgradeTagValue;
             }
             if (appType === 'lidarr') {
                 const lidarrModeEl = document.getElementById('editor-lidarr-missing-mode');
                 if (lidarrModeEl) newData.hunt_missing_mode = lidarrModeEl.value || 'album';
             }
             if (appType === 'eros') {
                 const erosModeEl = document.getElementById('editor-eros-search-mode');
                 if (erosModeEl) newData.search_mode = erosModeEl.value || 'movie';
             }
        }
  
        let finalIndex = index;
        if (index !== null) {
            settings.instances[index] = { ...settings.instances[index], ...newData };
        } else {
            settings.instances.push(newData);
            finalIndex = settings.instances.length - 1;
        }
  
        // Update originalSettings to keep editor in sync
        window.huntarrUI.originalSettings[appType] = settings;
        
        const self = this;
        const savePromise = this.saveAppSettings(appType, settings);
        if (savePromise && typeof savePromise.then === 'function') {
            savePromise.then(function(data) {
                // Server may have generated instance_id for new instances; update the displayed field
                if (data && data.settings && data.settings.instances && data.settings.instances[finalIndex]) {
                    const savedInstance = data.settings.instances[finalIndex];
                    const instanceId = (savedInstance.instance_id || '').trim();
                    if (instanceId) {
                        const idInput = document.getElementById('editor-instance-id');
                        if (idInput) idInput.value = instanceId;
                        if (self._currentEditing && self._currentEditing.originalInstance) {
                            self._currentEditing.originalInstance.instance_id = instanceId;
                        }
                    }
                }
            }).catch(function() { /* saveAppSettings already shows error */ });
        }
        
        // Update current editing state with new index (in case it was a new instance)
        this._currentEditing = { appType, index: finalIndex, originalInstance: JSON.parse(JSON.stringify(newData)) };
        _instanceEditorDirty = false;
        
        // Show or hide the stateful block (green box + reset button) and refresh state
        const statefulBlock = document.getElementById('instance-editor-stateful-block');
        if (statefulBlock) {
            statefulBlock.style.display = newData.state_management_mode === 'disabled' ? 'none' : 'block';
        }
        if (newData.state_management_mode !== 'disabled') {
            this.startStateStatusPolling(appType, finalIndex);
        } else {
            this.stopStateStatusPolling();
        }
        
        // Disable save button to show it's saved
        const saveBtn = document.getElementById('instance-editor-save');
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.classList.remove('enabled');
        }
        
        // Show brief success feedback
        const originalText = saveBtn ? saveBtn.innerHTML : '';
        if (saveBtn) {
            saveBtn.innerHTML = '<i class="fas fa-check"></i> Saved!';
            saveBtn.style.opacity = '0.7';
            setTimeout(() => {
                saveBtn.innerHTML = originalText;
                saveBtn.style.opacity = '1';
                if (navigateBack) {
                    this.cancelInstanceEditor(this._instanceEditorNextSection);
                    this._instanceEditorNextSection = null;
                }
            }, 2000);
        } else if (navigateBack) {
            this.cancelInstanceEditor(this._instanceEditorNextSection);
            this._instanceEditorNextSection = null;
        }
        
        // Reset change detection by updating the original instance
        // This allows the save button to be enabled again if user makes more changes
        if (this._currentEditing) {
            this._currentEditing.originalInstance = JSON.parse(JSON.stringify(newData));
        }
        
        // Stay on the editor page - don't navigate away unless navigateBack is true
    },

    // Cancel editing and return to app section (or settings-indexers for indexer)
    cancelInstanceEditor: function(optionalNextSection) {
        // Stop polling when leaving editor
        this.stopStateStatusPolling();
        
        if (optionalNextSection) {
            window.huntarrUI.switchSection(optionalNextSection);
            this._currentEditing = null;
            _instanceEditorDirty = false;
            this._updateHashForSection(optionalNextSection);
            return;
        }

        if (!this._currentEditing) {
            window.huntarrUI.switchSection('sonarr');
            this._currentEditing = null;
            _instanceEditorDirty = false;
            this._updateHashForSection('sonarr');
            return;
        }
        const appType = this._currentEditing.appType;
        this._currentEditing = null;
        _instanceEditorDirty = false;
        if (appType === 'indexer') {
            window.huntarrUI.switchSection('indexer-hunt');
            this._updateHashForSection('indexer-hunt');
        } else if (appType === 'client') {
            window.huntarrUI.switchSection('settings-clients');
            this._updateHashForSection('settings-clients');
        } else {
            window.huntarrUI.switchSection(appType);
            this._updateHashForSection(appType);
        }
    },

    _updateHashForSection: function(section) {
        try {
            const newUrl = (window.location.pathname || '') + (window.location.search || '') + '#' + section;
            window.history.replaceState(null, '', newUrl);
        } catch (e) { /* ignore */ }
    },

    // Open the modal for adding/editing an instance
    openInstanceModal: function(appType, index = null) {
        this.navigateToInstanceEditor(appType, index);
    },

    // Delete instance
    deleteInstance: function(appType, index) {
        const settings = window.huntarrUI.originalSettings[appType];
        if (!settings || !settings.instances || settings.instances[index] === undefined) {
            console.error(`[huntarrUI] Cannot delete instance: index ${index} not found for ${appType}`);
            return;
        }
        
        const instanceName = settings.instances[index].name || 'Unnamed Instance';
        const isDefault = index === 0;
        const hasOtherInstances = settings.instances.length > 1;
        
        // Custom confirmation message for default instance
        let confirmMessage = `Are you sure you want to delete the instance "${instanceName}"?`;
        if (isDefault && hasOtherInstances) {
            const nextInstance = settings.instances[1];
            confirmMessage = `Are you sure you want to delete the default instance "${instanceName}"?\n\nThe next instance "${nextInstance.name || 'Unnamed'}" will become the new default.`;
        }

        const self = this;
        const doDelete = function() {
            console.log(`[huntarrUI] Deleting instance "${instanceName}" (index ${index}) from ${appType}...`);

            // Remove the instance from the local settings object
            settings.instances.splice(index, 1);

            // Update the global state immediately to ensure re-render uses fresh data
            if (window.huntarrUI && window.huntarrUI.originalSettings) {
                window.huntarrUI.originalSettings[appType] = JSON.parse(JSON.stringify(settings));
            }

            // Use a flag to indicate we're doing a structural change that needs full refresh
            window._appsSuppressChangeDetection = true;

            // Save to backend and trigger refresh
            self.saveAppSettings(appType, settings, `Instance "${instanceName}" deleted successfully`);

            // Force a small delay then clear suppression
            setTimeout(() => {
                window._appsSuppressChangeDetection = false;
            }, 800);
        };

        if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
            window.HuntarrConfirm.show({
                title: 'Delete Instance',
                message: confirmMessage,
                confirmLabel: 'Delete',
                onConfirm: doDelete
            });
        } else {
            if (!confirm(confirmMessage)) return;
            doDelete();
        }
    },

    });
})();


/* === modules/features/settings/sonarr.js === */
(function() {
    window.SettingsForms = window.SettingsForms || {};

    window.SettingsForms.generateSonarrForm = function(container, settings = {}) {
        if (!settings || typeof settings !== "object") {
            settings = {};
        }

        const wasSuppressionActive = window._appsSuppressChangeDetection;
        window._appsSuppressChangeDetection = true;

        container.setAttribute("data-app-type", "sonarr");

        if (!settings.instances || !Array.isArray(settings.instances)) {
            settings.instances = [];
        }

        let instancesHtml = `
            <div class="settings-group">
                <h3>Sonarr Instances</h3>
                <div class="instance-card-grid" id="sonarr-instances-grid">
        `;

        if (settings.instances && settings.instances.length > 0) {
            settings.instances.forEach((instance, index) => {
                instancesHtml += window.SettingsForms.renderInstanceCard('sonarr', instance, index);
            });
        }

        instancesHtml += `
            <div class="add-instance-card" data-app-type="sonarr">
                <div class="add-icon"><i class="fas fa-plus-circle"></i></div>
                <div class="add-text">Add Sonarr Instance</div>
            </div>
        `;

        instancesHtml += `
                </div>
            </div>
        `;

        // Sleep Duration and API Cap are now per-instance (configure in each instance's Edit) - no save button needed
        container.innerHTML = instancesHtml;

        const grid = container.querySelector('#sonarr-instances-grid');
        if (grid) {
            grid.addEventListener('click', (e) => {
                const editBtn = e.target.closest('.btn-card.edit');
                const deleteBtn = e.target.closest('.btn-card.delete');
                const addCard = e.target.closest('.add-instance-card');

                if (editBtn) {
                    const appType = editBtn.dataset.appType;
                    const index = parseInt(editBtn.dataset.instanceIndex);
                    window.SettingsForms.openInstanceModal(appType, index);
                } else if (deleteBtn) {
                    const appType = deleteBtn.dataset.appType;
                    const index = parseInt(deleteBtn.dataset.instanceIndex);
                    window.SettingsForms.deleteInstance(appType, index);
                } else if (addCard) {
                    const appType = addCard.dataset.appType;
                    window.SettingsForms.openInstanceModal(appType);
                }
            });
        }

        // Test instance connections after rendering
        setTimeout(() => {
            if (window.SettingsForms.testAllInstanceConnections) {
                window.SettingsForms.testAllInstanceConnections("sonarr");
            }
        }, 100);

        setTimeout(() => {
            // Always enable change detection after form is fully loaded
            window._appsSuppressChangeDetection = false;
        }, 100);
    };
})();


/* === modules/features/settings/radarr.js === */
(function() {
    window.SettingsForms = window.SettingsForms || {};

    window.SettingsForms.generateRadarrForm = function(container, settings = {}) {
        if (!settings || typeof settings !== "object") {
            settings = {};
        }

        const wasSuppressionActive = window._appsSuppressChangeDetection;
        window._appsSuppressChangeDetection = true;

        container.setAttribute("data-app-type", "radarr");

        if (!settings.instances || !Array.isArray(settings.instances)) {
            settings.instances = [];
        }

        let instancesHtml = `
            <div class="settings-group">
                <h3>Radarr Instances</h3>
                <div class="instance-card-grid" id="radarr-instances-grid">
        `;

        if (settings.instances && settings.instances.length > 0) {
            settings.instances.forEach((instance, index) => {
                instancesHtml += window.SettingsForms.renderInstanceCard('radarr', instance, index);
            });
        }

        instancesHtml += `
            <div class="add-instance-card" data-app-type="radarr">
                <div class="add-icon"><i class="fas fa-plus-circle"></i></div>
                <div class="add-text">Add Radarr Instance</div>
            </div>
        `;

        instancesHtml += `
                </div>
            </div>
        `;

        // Sleep Duration and API Cap are now per-instance (configure in each instance's Edit) - no save button needed
        container.innerHTML = instancesHtml;

        const grid = container.querySelector('#radarr-instances-grid');
        if (grid) {
            grid.addEventListener('click', (e) => {
                const editBtn = e.target.closest('.btn-card.edit');
                const deleteBtn = e.target.closest('.btn-card.delete');
                const addCard = e.target.closest('.add-instance-card');

                if (editBtn) {
                    const appType = editBtn.dataset.appType;
                    const index = parseInt(editBtn.dataset.instanceIndex);
                    window.SettingsForms.openInstanceModal(appType, index);
                } else if (deleteBtn) {
                    const appType = deleteBtn.dataset.appType;
                    const index = parseInt(deleteBtn.dataset.instanceIndex);
                    window.SettingsForms.deleteInstance(appType, index);
                } else if (addCard) {
                    const appType = addCard.dataset.appType;
                    window.SettingsForms.openInstanceModal(appType);
                }
            });
        }

        // Test instance connections after rendering
        setTimeout(() => {
            if (window.SettingsForms.testAllInstanceConnections) {
                window.SettingsForms.testAllInstanceConnections("radarr");
            }
        }, 100);

        setTimeout(() => {
            // Always enable change detection after form is fully loaded
            window._appsSuppressChangeDetection = false;
        }, 100);
    };
})();


/* === modules/features/settings/lidarr.js === */
(function() {
    window.SettingsForms = window.SettingsForms || {};

    window.SettingsForms.generateLidarrForm = function(container, settings = {}) {
        if (!settings || typeof settings !== "object") {
            settings = {};
        }

        const wasSuppressionActive = window._appsSuppressChangeDetection;
        window._appsSuppressChangeDetection = true;

        container.setAttribute("data-app-type", "lidarr");

        if (!settings.instances || !Array.isArray(settings.instances)) {
            settings.instances = [];
        }

        let instancesHtml = `
            <div class="settings-group">
                <h3>Lidarr Instances</h3>
                <div class="instance-card-grid" id="lidarr-instances-grid">
        `;

        if (settings.instances && settings.instances.length > 0) {
            settings.instances.forEach((instance, index) => {
                instancesHtml += window.SettingsForms.renderInstanceCard('lidarr', instance, index);
            });
        }

        instancesHtml += `
            <div class="add-instance-card" data-app-type="lidarr">
                <div class="add-icon"><i class="fas fa-plus-circle"></i></div>
                <div class="add-text">Add Lidarr Instance</div>
            </div>
        `;

        instancesHtml += `
                </div>
            </div>
        `;

        container.innerHTML = instancesHtml;

        const grid = container.querySelector('#lidarr-instances-grid');
        if (grid) {
            grid.addEventListener('click', (e) => {
                const editBtn = e.target.closest('.btn-card.edit');
                const deleteBtn = e.target.closest('.btn-card.delete');
                const addCard = e.target.closest('.add-instance-card');

                if (editBtn) {
                    const appType = editBtn.dataset.appType;
                    const index = parseInt(editBtn.dataset.instanceIndex);
                    window.SettingsForms.openInstanceModal(appType, index);
                } else if (deleteBtn) {
                    const appType = deleteBtn.dataset.appType;
                    const index = parseInt(deleteBtn.dataset.instanceIndex);
                    window.SettingsForms.deleteInstance(appType, index);
                } else if (addCard) {
                    const appType = addCard.dataset.appType;
                    window.SettingsForms.openInstanceModal(appType);
                }
            });
        }

        // Test instance connections after rendering
        setTimeout(() => {
            if (window.SettingsForms.testAllInstanceConnections) {
                window.SettingsForms.testAllInstanceConnections("lidarr");
            }
        }, 100);

        setTimeout(() => {
            // Always enable change detection after form is fully loaded
            window._appsSuppressChangeDetection = false;
        }, 100);
    };
})();


/* === modules/features/settings/readarr.js === */
(function() {
    window.SettingsForms = window.SettingsForms || {};

    window.SettingsForms.generateReadarrForm = function(container, settings = {}) {
        if (!settings || typeof settings !== "object") {
            settings = {};
        }

        const wasSuppressionActive = window._appsSuppressChangeDetection;
        window._appsSuppressChangeDetection = true;

        container.setAttribute("data-app-type", "readarr");

        if (!settings.instances || !Array.isArray(settings.instances)) {
            settings.instances = [];
        }

        let instancesHtml = `
            <div class="settings-group">
                <h3>Readarr Instances</h3>
                <div class="instance-card-grid" id="readarr-instances-grid">
        `;

        if (settings.instances && settings.instances.length > 0) {
            settings.instances.forEach((instance, index) => {
                instancesHtml += window.SettingsForms.renderInstanceCard('readarr', instance, index);
            });
        }

        instancesHtml += `
            <div class="add-instance-card" data-app-type="readarr">
                <div class="add-icon"><i class="fas fa-plus-circle"></i></div>
                <div class="add-text">Add Readarr Instance</div>
            </div>
        `;

        instancesHtml += `
                </div>
            </div>
        `;

        // Sleep Duration and API Cap are now per-instance (configure in each instance's Edit) - no save button needed
        container.innerHTML = instancesHtml;

        const grid = container.querySelector('#readarr-instances-grid');
        if (grid) {
            grid.addEventListener('click', (e) => {
                const editBtn = e.target.closest('.btn-card.edit');
                const deleteBtn = e.target.closest('.btn-card.delete');
                const addCard = e.target.closest('.add-instance-card');

                if (editBtn) {
                    const appType = editBtn.dataset.appType;
                    const index = parseInt(editBtn.dataset.instanceIndex);
                    window.SettingsForms.openInstanceModal(appType, index);
                } else if (deleteBtn) {
                    const appType = deleteBtn.dataset.appType;
                    const index = parseInt(deleteBtn.dataset.instanceIndex);
                    window.SettingsForms.deleteInstance(appType, index);
                } else if (addCard) {
                    const appType = addCard.dataset.appType;
                    window.SettingsForms.openInstanceModal(appType);
                }
            });
        }

        // Test instance connections after rendering
        setTimeout(() => {
            if (window.SettingsForms.testAllInstanceConnections) {
                window.SettingsForms.testAllInstanceConnections("readarr");
            }
        }, 100);

        setTimeout(() => {
            // Always enable change detection after form is fully loaded
            window._appsSuppressChangeDetection = false;
        }, 100);
    };
})();


/* === modules/features/settings/whisparr.js === */
(function() {
    window.SettingsForms = window.SettingsForms || {};

    window.SettingsForms.generateWhisparrForm = function(container, settings = {}) {
        if (!settings || typeof settings !== "object") {
            settings = {};
        }

        const wasSuppressionActive = window._appsSuppressChangeDetection;
        window._appsSuppressChangeDetection = true;

        container.setAttribute("data-app-type", "whisparr");

        if (!settings.instances || !Array.isArray(settings.instances)) {
            settings.instances = [];
        }

        let instancesHtml = `
            <div class="settings-group">
                <h3>Whisparr V2 Instances</h3>
                <div class="instance-card-grid" id="whisparr-instances-grid">
        `;

        if (settings.instances && settings.instances.length > 0) {
            settings.instances.forEach((instance, index) => {
                instancesHtml += window.SettingsForms.renderInstanceCard('whisparr', instance, index);
            });
        }

        instancesHtml += `
            <div class="add-instance-card" data-app-type="whisparr">
                <div class="add-icon"><i class="fas fa-plus-circle"></i></div>
                <div class="add-text">Add Whisparr Instance</div>
            </div>
        `;

        instancesHtml += `
                </div>
            </div>
        `;

        // Sleep Duration and API Cap are now per-instance (configure in each instance's Edit) - no save button needed
        container.innerHTML = instancesHtml;

        const grid = container.querySelector('#whisparr-instances-grid');
        if (grid) {
            grid.addEventListener('click', (e) => {
                const editBtn = e.target.closest('.btn-card.edit');
                const deleteBtn = e.target.closest('.btn-card.delete');
                const addCard = e.target.closest('.add-instance-card');

                if (editBtn) {
                    const appType = editBtn.dataset.appType;
                    const index = parseInt(editBtn.dataset.instanceIndex);
                    window.SettingsForms.openInstanceModal(appType, index);
                } else if (deleteBtn) {
                    const appType = deleteBtn.dataset.appType;
                    const index = parseInt(deleteBtn.dataset.instanceIndex);
                    window.SettingsForms.deleteInstance(appType, index);
                } else if (addCard) {
                    const appType = addCard.dataset.appType;
                    window.SettingsForms.openInstanceModal(appType);
                }
            });
        }

        // Test instance connections after rendering
        setTimeout(() => {
            if (window.SettingsForms.testAllInstanceConnections) {
                window.SettingsForms.testAllInstanceConnections("whisparr");
            }
        }, 100);

        setTimeout(() => {
            // Always enable change detection after form is fully loaded
            window._appsSuppressChangeDetection = false;
        }, 100);
    };

    window.SettingsForms.generateErosForm = function(container, settings = {}) {
        if (!settings || typeof settings !== "object") {
            settings = {};
        }

        const wasSuppressionActive = window._appsSuppressChangeDetection;
        window._appsSuppressChangeDetection = true;

        container.setAttribute("data-app-type", "eros");

        if (!settings.instances || !Array.isArray(settings.instances)) {
            settings.instances = [];
        }

        let instancesHtml = `
            <div class="settings-group">
                <h3>Whisparr V3 Instances</h3>
                <div class="instance-card-grid" id="eros-instances-grid">
        `;

        if (settings.instances && settings.instances.length > 0) {
            settings.instances.forEach((instance, index) => {
                instancesHtml += window.SettingsForms.renderInstanceCard('eros', instance, index);
            });
        }

        instancesHtml += `
            <div class="add-instance-card" data-app-type="eros">
                <div class="add-icon"><i class="fas fa-plus-circle"></i></div>
                <div class="add-text">Add Whisparr V3 Instance</div>
            </div>
        `;

        instancesHtml += `
                </div>
            </div>
        `;

        container.innerHTML = instancesHtml;

        const grid = container.querySelector('#eros-instances-grid');
        if (grid) {
            grid.addEventListener('click', (e) => {
                const editBtn = e.target.closest('.btn-card.edit');
                const deleteBtn = e.target.closest('.btn-card.delete');
                const addCard = e.target.closest('.add-instance-card');

                if (editBtn) {
                    const appType = editBtn.dataset.appType;
                    const index = parseInt(editBtn.dataset.instanceIndex);
                    window.SettingsForms.openInstanceModal(appType, index);
                } else if (deleteBtn) {
                    const appType = deleteBtn.dataset.appType;
                    const index = parseInt(deleteBtn.dataset.instanceIndex);
                    window.SettingsForms.deleteInstance(appType, index);
                } else if (addCard) {
                    const appType = addCard.dataset.appType;
                    window.SettingsForms.openInstanceModal(appType);
                }
            });
        }

        // Test instance connections after rendering
        setTimeout(() => {
            if (window.SettingsForms.testAllInstanceConnections) {
                window.SettingsForms.testAllInstanceConnections("eros");
            }
        }, 100);

        setTimeout(() => {
            // Always enable change detection after form is fully loaded
            window._appsSuppressChangeDetection = false;
        }, 100);
    };
})();


/* === modules/features/settings/prowlarr.js === */
(function() {
    window.SettingsForms = window.SettingsForms || {};

    window.SettingsForms.generateProwlarrForm = function(container, settings = {}) {
        if (!settings || typeof settings !== "object") {
            settings = {};
        }

        container.setAttribute("data-app-type", "prowlarr");

        let prowlarrHtml = `
            <div class="settings-group">
                <h3>Prowlarr Configuration</h3>
                <div class="instance-card-grid" id="prowlarr-instances-grid">
        `;

        const prowlarrInstance = {
            name: 'Prowlarr',
            api_url: settings.api_url || '',
            api_key: settings.api_key || '',
            enabled: settings.enabled !== false
        };

        prowlarrHtml += window.SettingsForms.renderInstanceCard('prowlarr', prowlarrInstance, 0, { hideDelete: true });

        prowlarrHtml += `
                </div>
            </div>
        `;

        container.innerHTML = prowlarrHtml;

        const grid = container.querySelector('#prowlarr-instances-grid');
        if (grid) {
            grid.addEventListener('click', (e) => {
                const editBtn = e.target.closest('.btn-card.edit');
                if (editBtn) {
                    window.SettingsForms.openProwlarrModal();
                }
            });
        }

        // Test instance connections after rendering
        setTimeout(() => {
            if (window.SettingsForms.testAllInstanceConnections) {
                window.SettingsForms.testAllInstanceConnections("prowlarr");
            }
        }, 100);
    };

    window.SettingsForms.openProwlarrModal = function() {
        const settings = window.huntarrUI.originalSettings.prowlarr;
        if (!settings) return;

        const prowlarrInstance = {
            name: 'Prowlarr',
            api_url: settings.api_url || '',
            api_key: settings.api_key || '',
            enabled: settings.enabled !== false
        };

        // Use the instance editor section
        const titleEl = document.getElementById('instance-editor-title');
        if (titleEl) {
            titleEl.textContent = `Edit Prowlarr Configuration`;
        }

        const contentEl = document.getElementById('instance-editor-content');
        if (contentEl) {
            contentEl.innerHTML = `
                <div class="editor-grid">
                    <div class="editor-section">
                        <div class="editor-section-title">
                            Connection Details
                            <span id="prowlarr-connection-status" class="connection-status-badge status-unknown">
                                <i class="fas fa-question-circle"></i> Not Tested
                            </span>
                        </div>
                        
                        <div class="editor-field-group">
                            <div class="editor-setting-item">
                                <label style="display: flex; align-items: center; color: #f8fafc; font-weight: 500;">
                                    <span>Enable Status </span>
                                    <i id="enable-status-icon" class="fas ${prowlarrInstance.enabled ? 'fa-check-circle' : 'fa-minus-circle'}" style="color: ${prowlarrInstance.enabled ? '#10b981' : '#ef4444'}; font-size: 1.1rem; margin-left: 6px;"></i>
                                </label>
                                <select id="editor-enabled" onchange="window.SettingsForms.updateEnableStatusIcon && window.SettingsForms.updateEnableStatusIcon();" style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid rgba(148, 163, 184, 0.2); background: rgba(15, 23, 42, 0.5); color: white;">
                                    <option value="true" ${prowlarrInstance.enabled ? 'selected' : ''}>Enabled</option>
                                    <option value="false" ${!prowlarrInstance.enabled ? 'selected' : ''}>Disabled</option>
                                </select>
                            </div>
                            <p class="setting-help" style="margin: 0 0 20px 0; color: #94a3b8; font-size: 0.85rem;">Enable or disable Prowlarr integration</p>
                        </div>
                        
                        <div class="setting-item" style="margin-bottom: 20px; display: none;">
                            <label style="display: block; color: #f8fafc; font-weight: 500; margin-bottom: 8px;">Name</label>
                            <input type="text" id="editor-name" value="Prowlarr" readonly style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid rgba(148, 163, 184, 0.2); background: rgba(15, 23, 42, 0.3); color: #94a3b8; cursor: not-allowed;">
                            <p class="setting-help" style="margin-top: 5px; color: #94a3b8; font-size: 0.85rem;">A friendly name to identify this instance</p>
                        </div>
                        
                        <div class="setting-item" style="margin-bottom: 20px;">
                            <label style="display: block; color: #f8fafc; font-weight: 500; margin-bottom: 8px;">URL</label>
                            <input type="text" id="editor-url" value="${prowlarrInstance.api_url || ''}" placeholder="http://localhost:9696" style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid rgba(148, 163, 184, 0.2); background: rgba(15, 23, 42, 0.5); color: white;">
                            <p class="setting-help" style="margin-top: 5px; color: #94a3b8; font-size: 0.85rem;">The full URL including port (e.g. http://localhost:9696)</p>
                        </div>
                        
                        <div class="setting-item" style="margin-bottom: 0;">
                            <label style="display: block; color: #f8fafc; font-weight: 500; margin-bottom: 8px;">API Key</label>
                            <input type="text" id="editor-key" value="${prowlarrInstance.api_key || ''}" placeholder="Your API Key" style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid rgba(148, 163, 184, 0.2); background: rgba(15, 23, 42, 0.5); color: white;">
                            <p class="setting-help" style="margin-top: 5px; color: #94a3b8; font-size: 0.85rem;">Found in Settings > General in Prowlarr</p>
                        </div>
                    </div>
                </div>
            `;

            // Setup auto-connection testing on input change
            const urlInput = document.getElementById('editor-url');
            const keyInput = document.getElementById('editor-key');
            
            const testConnection = () => {
                const statusBadge = document.getElementById('prowlarr-connection-status');
                if (!statusBadge) return;
                
                const enabledEl = document.getElementById('editor-enabled');
                if (enabledEl && enabledEl.value === 'false') {
                    statusBadge.className = 'connection-status-badge status-disabled';
                    statusBadge.innerHTML = '<i class="fas fa-ban"></i> Disabled';
                    statusBadge.style.color = '#94a3b8';
                    statusBadge.style.opacity = '0.9';
                    return;
                }
                
                const url = urlInput.value.trim();
                const key = keyInput.value.trim();
                statusBadge.removeAttribute('style');
                
                if (!url || !key) {
                    statusBadge.className = 'connection-status-badge status-error';
                    statusBadge.innerHTML = '<i class="fas fa-exclamation-circle"></i> Missing URL or API Key';
                    return;
                }
                
                // Show testing state
                statusBadge.className = 'connection-status-badge status-testing';
                statusBadge.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Testing Connection...';
                
                // Test connection
                fetch('./api/prowlarr/test-connection', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ api_url: url, api_key: key })
                })
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        const version = data.version ? ` (${data.version})` : '';
                        statusBadge.className = 'connection-status-badge status-success';
                        statusBadge.innerHTML = `<i class="fas fa-check-circle"></i> Connected${version}`;
                    } else {
                        statusBadge.className = 'connection-status-badge status-error';
                        statusBadge.innerHTML = `<i class="fas fa-times-circle"></i> Connection Failed${data.error ? ': ' + data.error : ''}`;
                    }
                })
                .catch(error => {
                    statusBadge.className = 'connection-status-badge status-error';
                    statusBadge.innerHTML = '<i class="fas fa-times-circle"></i> Connection Test Failed';
                });
            };
            
            // Test connection on input blur and when enabled changes
            if (urlInput) urlInput.addEventListener('blur', testConnection);
            if (keyInput) keyInput.addEventListener('blur', testConnection);
            const enabledSelect = document.getElementById('editor-enabled');
            if (enabledSelect) enabledSelect.addEventListener('change', testConnection);
            
            // Initial status: testConnection() shows Disabled or runs test
            setTimeout(() => testConnection(), 100);
        }

        // Setup button listeners
        const saveBtn = document.getElementById('instance-editor-save');
        const cancelBtn = document.getElementById('instance-editor-cancel');
        const backBtn = document.getElementById('instance-editor-back');

        if (saveBtn) {
            saveBtn.onclick = () => window.SettingsForms.saveProwlarrFromEditor();
        }
        const navigateBack = () => {
            if (window.SettingsForms.clearInstanceEditorDirty) {
                window.SettingsForms.clearInstanceEditorDirty();
            }
            window.huntarrUI.switchSection('prowlarr');
        };
        if (cancelBtn) {
            cancelBtn.onclick = () => {
                if (window.SettingsForms.isInstanceEditorDirty && window.SettingsForms.isInstanceEditorDirty()) {
                    window.SettingsForms.confirmLeaveInstanceEditor((result) => {
                        if (result === 'discard') navigateBack();
                    });
                } else {
                    navigateBack();
                }
            };
        }
        if (backBtn) {
            backBtn.onclick = () => {
                if (window.SettingsForms.isInstanceEditorDirty && window.SettingsForms.isInstanceEditorDirty()) {
                    window.SettingsForms.confirmLeaveInstanceEditor((result) => {
                        if (result === 'discard') navigateBack();
                    });
                } else {
                    navigateBack();
                }
            };
        }

        // Switch to the editor section
        window.huntarrUI.switchSection('instance-editor');

        // Enable Save button when user makes changes (same as settings main / instance editor)
        setTimeout(() => {
            if (window.SettingsForms.setupEditorChangeDetection) {
                window.SettingsForms.setupEditorChangeDetection();
            }
        }, 100);
    };

    window.SettingsForms.saveProwlarrFromEditor = function() {
        const settings = window.huntarrUI.originalSettings.prowlarr;
        const enabledEl = document.getElementById('editor-enabled');

        settings.enabled = enabledEl ? (enabledEl.tagName === 'SELECT' ? enabledEl.value === 'true' : enabledEl.checked) : settings.enabled;
        settings.api_url = document.getElementById('editor-url').value;
        settings.api_key = document.getElementById('editor-key').value;

        window.SettingsForms.saveAppSettings('prowlarr', settings);

        // Clear dirty flag so navigating away doesn't trigger "Unsaved Changes"
        if (window.SettingsForms.clearInstanceEditorDirty) {
            window.SettingsForms.clearInstanceEditorDirty();
        }

        // Show brief "Saved!" feedback on the save button
        const saveBtn = document.getElementById('instance-editor-save');
        if (saveBtn) {
            const originalText = saveBtn.innerHTML;
            saveBtn.innerHTML = '<i class="fas fa-check"></i> Saved!';
            saveBtn.style.opacity = '0.7';
            setTimeout(() => {
                saveBtn.innerHTML = originalText;
                saveBtn.style.opacity = '';
            }, 1500);
        }
    };

})();


/* === modules/features/settings/swaparr.js === */
(function() {
    window.SettingsForms = window.SettingsForms || {};

    window.SettingsForms.generateSwaparrForm = function(container, settings = {}) {
        if (!settings || typeof settings !== "object") {
            settings = {};
        }

        container.setAttribute("data-app-type", "swaparr");

        let html = `
            <div style="margin-bottom: 25px;">
                <div style="display: flex; gap: 15px; flex-wrap: wrap;">
                    <button type="button" id="swaparr-save-button" disabled style="
                        background: #6b7280;
                        color: #9ca3af;
                        border: 1px solid #4b5563;
                        padding: 8px 16px;
                        border-radius: 6px;
                        font-size: 14px;
                        font-weight: 500;
                        cursor: not-allowed;
                        display: flex;
                        align-items: center;
                        gap: 8px;
                        transition: all 0.2s ease;
                    ">
                        <i class="fas fa-save"></i>
                        Save Changes
                    </button>
                    
                    <div style="margin-left: auto; display: flex; gap: 10px;">
                        <a href="https://github.com/ThijmenGThN/swaparr" target="_blank" rel="noopener" style="
                            background: linear-gradient(135deg, #24292e 0%, #161b22 100%);
                            color: #f0f6fc;
                            border: 1px solid #30363d;
                            padding: 8px 16px;
                            border-radius: 6px;
                            font-size: 14px;
                            font-weight: 500;
                            text-decoration: none;
                            display: flex;
                            align-items: center;
                            gap: 8px;
                            transition: all 0.2s ease;
                            box-shadow: 0 2px 4px rgba(0,0,0,0.2);
                        " onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">
                            <i class="fab fa-github" style="font-size: 16px;"></i>
                            View on GitHub
                        </a>
                        
                        <a href="https://github.com/ThijmenGThN/swaparr/stargazers" target="_blank" rel="noopener" style="
                            background: linear-gradient(135deg, #f1c40f 0%, #f39c12 100%);
                            color: #fff;
                            border: 1px solid #d35400;
                            padding: 8px 16px;
                            border-radius: 6px;
                            font-size: 14px;
                            font-weight: 600;
                            text-decoration: none;
                            display: flex;
                            align-items: center;
                            gap: 8px;
                            transition: all 0.2s ease;
                            box-shadow: 0 2px 4px rgba(0,0,0,0.2);
                            text-shadow: 0 1px 2px rgba(0,0,0,0.3);
                        " onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">
                            <i class="fas fa-star" style="margin-right: 4px;"></i>
                            <span id="swaparr-stars-count">Loading...</span>
                        </a>
                    </div>
                </div>
                
                <!-- Advanced Options Notice -->
                <div style="
                    background: linear-gradient(135deg, #164e63 0%, #0e7490 50%, #0891b2 100%);
                    border: 1px solid #22d3ee;
                    border-radius: 6px;
                    padding: 10px;
                    margin: 10px 0 15px 0;
                    box-shadow: 0 2px 8px rgba(34, 211, 238, 0.1);
                ">
                    <p style="color: #e0f7fa; margin: 0; font-size: 0.8em; line-height: 1.4;">
                        <i class="fas fa-rocket" style="margin-right: 6px; color: #22d3ee;"></i>
                        <strong>Need Advanced Options?</strong> For enhanced control and features, we recommend 
                        <a href="https://github.com/cleanuparr/cleanuparr" target="_blank" rel="noopener" style="color: #fbbf24; text-decoration: none; font-weight: 600;">
                            <strong>Cleanuparr</strong>
                        </a> which offers more comprehensive management capabilities.
                    </p>
                </div>
            </div>
            
            <div class="settings-group">
                <h3>Swaparr Configuration</h3>
                <p class="setting-help" style="margin-bottom: 20px; color: #9ca3af;">
                    Swaparr monitors your *arr applications' download queues and removes stalled downloads automatically.
                </p>
                
                <div class="setting-item">
                    <label for="swaparr_enabled">
                        <a href="https://plexguide.github.io/Huntarr.io/apps/swaparr.html#enable-swaparr" class="info-icon" title="Enable or disable Swaparr" target="_blank" rel="noopener">
                            <i class="fas fa-info-circle"></i>
                        </a>
                        Enable Swaparr:
                    </label>
                    <label class="toggle-switch">
                        <input type="checkbox" id="swaparr_enabled" ${
                          settings.enabled === true ? "checked" : ""
                        }>
                        <span class="toggle-slider"></span>
                    </label>
                    <p class="setting-help">Enable automatic removal of stalled downloads</p>
                </div>
                
                <div class="setting-item">
                    <label for="swaparr_max_strikes">
                        <a href="https://plexguide.github.io/Huntarr.io/apps/swaparr.html#max-strikes" class="info-icon" title="Number of strikes before removal" target="_blank" rel="noopener">
                            <i class="fas fa-info-circle"></i>
                        </a>
                        Max Strikes:
                    </label>
                    <input type="number" id="swaparr_max_strikes" min="1" max="10" value="${
                      settings.max_strikes || 3
                    }">
                    <p class="setting-help">Number of strikes a download gets before being removed (default: 3)</p>
                </div>
                
                <div class="setting-item">
                    <label for="swaparr_max_download_time">
                        <a href="https://plexguide.github.io/Huntarr.io/apps/swaparr.html#max-download-time" class="info-icon" title="Maximum time before considering download stalled" target="_blank" rel="noopener">
                            <i class="fas fa-info-circle"></i>
                        </a>
                        Max Download Time:
                    </label>
                    <input type="text" id="swaparr_max_download_time" value="${
                      settings.max_download_time || "2h"
                    }" placeholder="e.g., 2h, 120m, 7200s">
                    <p class="setting-help">Maximum time before considering a download stalled (examples: 2h, 120m, 7200s)</p>
                </div>
                
                <div class="setting-item">
                    <label for="swaparr_ignore_above_size">
                        <a href="https://plexguide.github.io/Huntarr.io/apps/swaparr.html#ignore-above-size" class="info-icon" title="Ignore downloads larger than this size" target="_blank" rel="noopener">
                            <i class="fas fa-info-circle"></i>
                        </a>
                        Ignore Above Size:
                    </label>
                    <input type="text" id="swaparr_ignore_above_size" value="${
                      settings.ignore_above_size || "25GB"
                    }" placeholder="e.g., 25GB, 10GB, 5000MB">
                    <p class="setting-help">Ignore downloads larger than this size (examples: 25GB, 10GB, 5000MB)</p>
                </div>
                
                <div class="setting-item">
                    <label for="swaparr_remove_from_client">
                        <a href="https://plexguide.github.io/Huntarr.io/apps/swaparr.html#remove-from-client" class="info-icon" title="Remove downloads from download client" target="_blank" rel="noopener">
                            <i class="fas fa-info-circle"></i>
                        </a>
                        Remove from Client:
                    </label>
                    <label class="toggle-switch">
                        <input type="checkbox" id="swaparr_remove_from_client" ${
                          settings.remove_from_client !== false ? "checked" : ""
                        }>
                        <span class="toggle-slider"></span>
                    </label>
                    <p class="setting-help">Also remove downloads from the download client (recommended: enabled)</p>
                </div>
                
                <div class="setting-item">
                    <label for="swaparr_research_removed">
                        <a href="https://plexguide.github.io/Huntarr.io/apps/swaparr.html#research-removed" class="info-icon" title="Automatically blocklist and re-search removed downloads" target="_blank" rel="noopener">
                            <i class="fas fa-info-circle"></i>
                        </a>
                        Re-Search Removed Download:
                    </label>
                    <label class="toggle-switch">
                        <input type="checkbox" id="swaparr_research_removed" ${
                          settings.research_removed === true ? "checked" : ""
                        }>
                        <span class="toggle-slider"></span>
                    </label>
                    <p class="setting-help">When a download is removed, blocklist it in the *arr app and automatically search for alternatives (retry once)</p>
                </div>
                
                <div class="setting-item">
                    <label for="swaparr_failed_import_detection">
                        <a href="https://plexguide.github.io/Huntarr.io/apps/swaparr.html#failed-import-detection" class="info-icon" title="Automatically handle failed imports" target="_blank" rel="noopener">
                            <i class="fas fa-info-circle"></i>
                        </a>
                        Handle Failed Imports:
                    </label>
                    <label class="toggle-switch">
                        <input type="checkbox" id="swaparr_failed_import_detection" ${
                          settings.failed_import_detection === true
                            ? "checked"
                            : ""
                        }>
                        <span class="toggle-slider"></span>
                    </label>
                    <p class="setting-help">Automatically detect failed imports, blocklist them, and search for alternatives</p>
                </div>
                
                <div class="setting-item">
                    <label for="swaparr_dry_run">
                        <a href="https://plexguide.github.io/Huntarr.io/apps/swaparr.html#dry-run-mode" class="info-icon" title="Test mode - no actual removals" target="_blank" rel="noopener">
                            <i class="fas fa-info-circle"></i>
                        </a>
                        Dry Run Mode:
                    </label>
                    <label class="toggle-switch">
                        <input type="checkbox" id="swaparr_dry_run" ${
                          settings.dry_run === true ? "checked" : ""
                        }>
                        <span class="toggle-slider"></span>
                    </label>
                    <p class="setting-help">Test mode - logs what would be removed without actually removing anything</p>
                </div>
                
                <div class="setting-item">
                    <label for="swaparr_ignore_usenet_queued">
                        <a href="https://plexguide.github.io/Huntarr.io/apps/swaparr.html#ignore-usenet-queued" class="info-icon" title="Ignore queued usenet downloads with 0% progress" target="_blank" rel="noopener">
                            <i class="fas fa-info-circle"></i>
                        </a>
                        Ignore Queued Usenet:
                    </label>
                    <label class="toggle-switch">
                        <input type="checkbox" id="swaparr_ignore_usenet_queued" ${
                          settings.ignore_usenet_queued !== false ? "checked" : ""
                        }>
                        <span class="toggle-slider"></span>
                    </label>
                    <p class="setting-help">Ignore usenet downloads with 0% progress to avoid false positives from sequential queue ETAs (recommended: enabled)</p>
                </div>
                
                <div class="setting-item">
                    <label for="swaparr_remove_completed_stalled">
                        <a href="https://plexguide.github.io/Huntarr.io/apps/swaparr.html#remove-completed-stalled" class="info-icon" title="Treat 100% complete downloads as stalled" target="_blank" rel="noopener">
                            <i class="fas fa-info-circle"></i>
                        </a>
                        Remove Completed (100%) Stalled:
                    </label>
                    <label class="toggle-switch">
                        <input type="checkbox" id="swaparr_remove_completed_stalled" ${
                          settings.remove_completed_stalled !== false ? "checked" : ""
                        }>
                        <span class="toggle-slider"></span>
                    </label>
                    <p class="setting-help">When enabled (default), Swaparr can remove 100% complete downloads after max strikes if they are stuck. When disabled, downloads that are 100% complete but waiting for manual import (e.g. name/year mismatch) are left alone.</p>
                </div>
                
                <div class="setting-item">
                    <label for="swaparr_sleep_duration">
                        <a href="https://plexguide.github.io/Huntarr.io/apps/swaparr.html#sleep-duration" class="info-icon" title="Time between Swaparr cycles" target="_blank" rel="noopener">
                            <i class="fas fa-info-circle"></i>
                        </a>
                        Sleep Duration (Minutes):
                    </label>
                    <div class="input-group" style="display: flex; align-items: center; gap: 10px;">
                        <input type="number" id="swaparr_sleep_duration" value="${
                          settings.sleep_duration
                            ? Math.round(settings.sleep_duration / 60)
                            : 15
                        }" min="10" max="1440" style="width: 120px;">
                        <span style="color: #9ca3af; font-size: 14px;">minutes</span>
                    </div>
                    <p class="setting-help">Time to wait between Swaparr processing cycles (minimum 10 minutes, default: 15 minutes)</p>
                </div>
                
            </div>
            
            <div class="settings-group">
                <h3>Security Features</h3>
                <p class="setting-help" style="margin-bottom: 20px; color: #9ca3af;">
                    Advanced security features to protect your system from malicious downloads and suspicious content by analyzing download names and titles. Detection is based on filename patterns, not file contents.
                </p>
                
                <div class="setting-item">
                    <label for="swaparr_malicious_detection">
                        <a href="https://plexguide.github.io/Huntarr.io/apps/swaparr.html#malicious-file-detection" class="info-icon" title="Enable malicious file detection" target="_blank" rel="noopener">
                            <i class="fas fa-info-circle"></i>
                        </a>
                        Malicious File Detection:
                    </label>
                    <label class="toggle-switch">
                        <input type="checkbox" id="swaparr_malicious_detection" ${
                          settings.malicious_file_detection === true
                            ? "checked"
                            : ""
                        }>
                        <span class="toggle-slider"></span>
                    </label>
                    <p class="setting-help">Automatically detect and immediately remove downloads with malicious file types</p>
                </div>
                
                <div class="setting-item">
                    <label for="swaparr_malicious_extensions_input">
                        <a href="https://plexguide.github.io/Huntarr.io/apps/swaparr.html#malicious-extensions" class="info-icon" title="File extensions to consider malicious" target="_blank" rel="noopener">
                            <i class="fas fa-info-circle"></i>
                        </a>
                        Malicious File Extensions:
                    </label>
                    <div class="tag-input-container">
                        <div class="tag-list" id="swaparr_malicious_extensions_tags"></div>
                        <div class="tag-input-wrapper">
                            <input type="text" id="swaparr_malicious_extensions_input" placeholder="Type extension and press Enter (e.g. .lnk)" class="tag-input">
                            <button type="button" class="tag-add-btn" onclick="window.SettingsForms.addExtensionTag()">
                                <i class="fas fa-plus"></i>
                            </button>
                        </div>
                    </div>
                    <p class="setting-help">File extensions to block. Type extension and press Enter or click +. Examples: .lnk, .exe, .bat, .zipx</p>
                </div>
                
                <div class="setting-item">
                    <label for="swaparr_suspicious_patterns_input">
                        <a href="https://plexguide.github.io/Huntarr.io/apps/swaparr.html#suspicious-patterns" class="info-icon" title="Suspicious filename patterns" target="_blank" rel="noopener">
                            <i class="fas fa-info-circle"></i>
                        </a>
                        Suspicious Patterns:
                    </label>
                    <div class="tag-input-container">
                        <div class="tag-list" id="swaparr_suspicious_patterns_tags"></div>
                        <div class="tag-input-wrapper">
                            <input type="text" id="swaparr_suspicious_patterns_input" placeholder="Type pattern and press Enter (e.g. keygen)" class="tag-input">
                            <button type="button" class="tag-add-btn" onclick="window.SettingsForms.addPatternTag()">
                                <i class="fas fa-plus"></i>
                            </button>
                        </div>
                    </div>
                    <p class="setting-help">Filename patterns to block. Type pattern and press Enter or click +. Examples: password.txt, keygen, crack</p>
                </div>
            </div>
            
            <div class="settings-group">
                <h3>Age-Based Cleanup</h3>
                <p class="setting-help" style="margin-bottom: 20px; color: #9ca3af;">
                    Automatically remove downloads that have been stuck for too long, regardless of strike count.
                </p>
                
                <div class="setting-item">
                    <label for="swaparr_age_based_removal">
                        <a href="https://plexguide.github.io/Huntarr.io/apps/swaparr.html#age-based-removal" class="info-icon" title="Enable age-based removal" target="_blank" rel="noopener">
                            <i class="fas fa-info-circle"></i>
                        </a>
                        Enable Age-Based Removal:
                    </label>
                    <label class="toggle-switch">
                        <input type="checkbox" id="swaparr_age_based_removal" ${
                          settings.age_based_removal === true ? "checked" : ""
                        }>
                        <span class="toggle-slider"></span>
                    </label>
                    <p class="setting-help">Remove downloads that have been stuck longer than the specified age limit</p>
                </div>
                
                <div class="setting-item">
                    <label for="swaparr_max_age_days">
                        <a href="https://plexguide.github.io/Huntarr.io/apps/swaparr.html#max-age-days" class="info-icon" title="Maximum age before removal" target="_blank" rel="noopener">
                            <i class="fas fa-info-circle"></i>
                        </a>
                        Maximum Age (Days):
                    </label>
                    <input type="number" id="swaparr_max_age_days" min="1" max="30" value="${
                      settings.max_age_days || 7
                    }">
                    <p class="setting-help">Remove downloads older than this many days (default: 7 days)</p>
                </div>
            </div>
            
            <div class="settings-group">
                <h3>Quality-Based Filtering</h3>
                <p class="setting-help" style="margin-bottom: 20px; color: #9ca3af;">
                    Automatically remove downloads with poor or undesirable quality indicators in their names.
                </p>
                
                <div class="setting-item">
                    <label for="swaparr_quality_based_removal">
                        <a href="https://plexguide.github.io/Huntarr.io/apps/swaparr.html#quality-based-removal" class="info-icon" title="Enable quality-based filtering" target="_blank" rel="noopener">
                            <i class="fas fa-info-circle"></i>
                        </a>
                        Enable Quality-Based Filtering:
                    </label>
                    <label class="toggle-switch">
                        <input type="checkbox" id="swaparr_quality_based_removal" ${
                          settings.quality_based_removal === true
                            ? "checked"
                            : ""
                        }>
                        <span class="toggle-slider"></span>
                    </label>
                    <p class="setting-help">Automatically remove downloads with blocked quality patterns in their names</p>
                </div>
                
                <div class="setting-item">
                    <label for="swaparr_quality_patterns_input">
                        <a href="https://plexguide.github.io/Huntarr.io/apps/swaparr.html#blocked-quality-patterns" class="info-icon" title="Quality patterns to block" target="_blank" rel="noopener">
                            <i class="fas fa-info-circle"></i>
                        </a>
                        Blocked Quality Patterns:
                    </label>
                    <div class="tag-input-container">
                        <div class="tag-list" id="swaparr_quality_patterns_tags"></div>
                        <div class="tag-input-wrapper">
                            <input type="text" id="swaparr_quality_patterns_input" placeholder="Type quality pattern and press Enter (e.g. cam)" class="tag-input">
                            <button type="button" class="tag-add-btn" onclick="window.SettingsForms.addQualityTag()">
                                <i class="fas fa-plus"></i>
                            </button>
                        </div>
                    </div>
                    <p class="setting-help">Quality patterns to block. Type pattern and press Enter or click +. Examples: cam, ts, hdcam, workprint</p>
                </div>
            </div>

        `;

        container.innerHTML = html;

        window.SettingsForms.loadSwaparrStarCount();
        window.SettingsForms.initializeTagSystem(settings);

        const swaparrEnabledToggle = container.querySelector("#swaparr_enabled");
        if (swaparrEnabledToggle) {
            swaparrEnabledToggle.addEventListener("change", () => {
                if (window.huntarrUI && window.huntarrUI.originalSettings && window.huntarrUI.originalSettings.swaparr) {
                    window.huntarrUI.originalSettings.swaparr.enabled = swaparrEnabledToggle.checked;
                }

                try {
                    const cachedSettings = localStorage.getItem("huntarr-settings-cache");
                    if (cachedSettings) {
                        const settings = JSON.parse(cachedSettings);
                        if (!settings.swaparr) settings.swaparr = {};
                        settings.swaparr.enabled = swaparrEnabledToggle.checked;
                        localStorage.setItem("huntarr-settings-cache", JSON.stringify(settings));
                    }
                } catch (e) {
                    console.warn("[SettingsForms] Failed to update cached settings:", e);
                }

                if (window.SettingsForms.updateSwaparrFieldsDisabledState) {
                    window.SettingsForms.updateSwaparrFieldsDisabledState();
                }
            });

            setTimeout(() => {
                if (window.SettingsForms.updateSwaparrFieldsDisabledState) {
                    window.SettingsForms.updateSwaparrFieldsDisabledState();
                }
            }, 100);
        }

        if (window.SettingsForms.setupSwaparrManualSave) {
            window.SettingsForms.setupSwaparrManualSave(container, settings);
        }
    };

    window.SettingsForms.loadSwaparrStarCount = function() {
        const starsElement = document.getElementById("swaparr-stars-count");
        if (!starsElement) return;

        const cachedData = localStorage.getItem("swaparr-github-stars");
        if (cachedData) {
            try {
                const parsed = JSON.parse(cachedData);
                if (parsed.stars !== undefined) {
                    starsElement.textContent = parsed.stars.toLocaleString();
                    const cacheAge = Date.now() - (parsed.timestamp || 0);
                    if (cacheAge < 3600000) {
                        return;
                    }
                }
            } catch (e) {
                console.warn("Invalid cached Swaparr star data, will fetch fresh");
                localStorage.removeItem("swaparr-github-stars");
            }
        }

        starsElement.textContent = "Loading...";

        const apiUrl = "https://api.github.com/repos/ThijmenGThN/swaparr";

        HuntarrUtils.fetchWithTimeout(apiUrl)
            .then((response) => {
                if (!response.ok) {
                    throw new Error(`GitHub API error: ${response.status}`);
                }
                return response.json();
            })
            .then((data) => {
                if (data && data.stargazers_count !== undefined) {
                    const formattedStars = data.stargazers_count.toLocaleString();
                    starsElement.textContent = formattedStars;

                    const cacheData = {
                        stars: data.stargazers_count,
                        timestamp: Date.now(),
                    };
                    localStorage.setItem("swaparr-github-stars", JSON.stringify(cacheData));
                }
            })
            .catch((error) => {
                console.warn("Failed to fetch Swaparr stars:", error);
                if (starsElement.textContent === "Loading...") {
                    starsElement.textContent = "Unknown";
                }
            });
    };

    window.SettingsForms.initializeTagSystem = function(settings) {
        const defaultExtensions = [".lnk", ".exe", ".bat", ".cmd", ".scr", ".pif", ".com", ".zipx", ".jar", ".vbs", ".js", ".jse", ".wsf", ".wsh"];
        const extensions = settings.malicious_extensions || defaultExtensions;
        window.SettingsForms.loadTags("swaparr_malicious_extensions_tags", extensions);

        const defaultPatterns = ["password.txt", "readme.txt", "install.exe", "setup.exe", "keygen", "crack", "patch.exe", "activator"];
        const patterns = settings.suspicious_patterns || defaultPatterns;
        window.SettingsForms.loadTags("swaparr_suspicious_patterns_tags", patterns);

        const defaultQualityPatterns = ["cam", "camrip", "hdcam", "ts", "telesync", "tc", "telecine", "r6", "dvdscr", "dvdscreener", "workprint", "wp"];
        const qualityPatterns = settings.blocked_quality_patterns || defaultQualityPatterns;
        window.SettingsForms.loadTags("swaparr_quality_patterns_tags", qualityPatterns);

        const extensionInput = document.getElementById("swaparr_malicious_extensions_input");
        const patternInput = document.getElementById("swaparr_suspicious_patterns_input");
        const qualityInput = document.getElementById("swaparr_quality_patterns_input");

        if (extensionInput) {
            extensionInput.addEventListener("keypress", (e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    window.SettingsForms.addExtensionTag();
                }
            });
        }

        if (patternInput) {
            patternInput.addEventListener("keypress", (e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    window.SettingsForms.addPatternTag();
                }
            });
        }

        if (qualityInput) {
            qualityInput.addEventListener("keypress", (e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    window.SettingsForms.addQualityTag();
                }
            });
        }

        // Expose helper functions globally if needed by inline onclicks, though we prefer window.SettingsForms
        // The inline onclicks in HTML above use window.SettingsForms.add*Tag()
    };

    window.SettingsForms.loadTags = function(containerId, tags) {
        const container = document.getElementById(containerId);
        if (!container) return;

        container.innerHTML = "";
        tags.forEach((tag) => {
            window.SettingsForms.createTagElement(container, tag);
        });
    };

    window.SettingsForms.createTagElement = function(container, text) {
        const tagDiv = document.createElement("div");
        tagDiv.className = "tag-item";
        tagDiv.innerHTML = `
            <span class="tag-text">${text}</span>
            <button type="button" class="tag-remove" onclick="this.parentElement.remove()">
                <i class="fas fa-times"></i>
            </button>
        `;
        container.appendChild(tagDiv);
    };

    window.SettingsForms.addExtensionTag = function() {
        const input = document.getElementById("swaparr_malicious_extensions_input");
        const container = document.getElementById("swaparr_malicious_extensions_tags");

        if (!input || !container) return;

        let value = input.value.trim();
        if (!value) return;

        if (!value.startsWith(".")) {
            value = "." + value;
        }

        const existing = Array.from(container.querySelectorAll(".tag-text")).map((el) => el.textContent);
        if (existing.includes(value)) {
            input.value = "";
            return;
        }

        window.SettingsForms.createTagElement(container, value);
        input.value = "";
    };

    window.SettingsForms.addPatternTag = function() {
        const input = document.getElementById("swaparr_suspicious_patterns_input");
        const container = document.getElementById("swaparr_suspicious_patterns_tags");

        if (!input || !container) return;

        const value = input.value.trim();
        if (!value) return;

        const existing = Array.from(container.querySelectorAll(".tag-text")).map((el) => el.textContent);
        if (existing.includes(value)) {
            input.value = "";
            return;
        }

        window.SettingsForms.createTagElement(container, value);
        input.value = "";
    };

    window.SettingsForms.addQualityTag = function() {
        const input = document.getElementById("swaparr_quality_patterns_input");
        const container = document.getElementById("swaparr_quality_patterns_tags");

        if (!input || !container) return;

        const value = input.value.trim().toLowerCase();
        if (!value) return;

        const existing = Array.from(container.querySelectorAll(".tag-text")).map((el) => el.textContent.toLowerCase());
        if (existing.includes(value)) {
            input.value = "";
            return;
        }

        window.SettingsForms.createTagElement(container, value);
        input.value = "";
    };

    window.SettingsForms.setupSwaparrManualSave = function(container, originalSettings = {}) {
        const saveButton = container.querySelector("#swaparr-save-button");
        if (!saveButton) return;

        saveButton.disabled = true;
        saveButton.style.background = "#6b7280";
        saveButton.style.color = "#9ca3af";
        saveButton.style.borderColor = "#4b5563";
        saveButton.style.cursor = "not-allowed";

        let hasChanges = false;
        window.swaparrUnsavedChanges = false;
        if (window.SettingsForms.removeUnsavedChangesWarning) {
            window.SettingsForms.removeUnsavedChangesWarning();
        }

        const updateSaveButtonState = (changesDetected) => {
            hasChanges = changesDetected;
            window.swaparrUnsavedChanges = changesDetected;
            const btn = container.querySelector("#swaparr-save-button");
            if (!btn) return;

            if (hasChanges) {
                btn.disabled = false;
                btn.style.background = "#dc2626";
                btn.style.color = "#ffffff";
                btn.style.borderColor = "#dc2626";
                btn.style.cursor = "pointer";
                if (window.SettingsForms.addUnsavedChangesWarning) {
                    window.SettingsForms.addUnsavedChangesWarning();
                }
            } else {
                btn.disabled = true;
                btn.style.background = "#6b7280";
                btn.style.color = "#9ca3af";
                btn.style.borderColor = "#4b5563";
                btn.style.cursor = "not-allowed";
                if (window.SettingsForms.removeUnsavedChangesWarning) {
                    window.SettingsForms.removeUnsavedChangesWarning();
                }
            }
        };

        container.addEventListener('input', () => updateSaveButtonState(true));
        container.addEventListener('change', () => updateSaveButtonState(true));

        const newSaveButton = saveButton.cloneNode(true);
        saveButton.parentNode.replaceChild(newSaveButton, saveButton);

        newSaveButton.addEventListener("click", () => {
            if (!hasChanges) return;

            newSaveButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
            newSaveButton.disabled = true;

            // Collect data
            const settings = { ...originalSettings };
            
            const enabled = document.getElementById("swaparr_enabled");
            if (enabled) settings.enabled = enabled.checked;

            const maxStrikes = document.getElementById("swaparr_max_strikes");
            if (maxStrikes) settings.max_strikes = parseInt(maxStrikes.value);

            const maxDownloadTime = document.getElementById("swaparr_max_download_time");
            if (maxDownloadTime) settings.max_download_time = maxDownloadTime.value;

            const ignoreAboveSize = document.getElementById("swaparr_ignore_above_size");
            if (ignoreAboveSize) settings.ignore_above_size = ignoreAboveSize.value;

            const removeFromClient = document.getElementById("swaparr_remove_from_client");
            if (removeFromClient) settings.remove_from_client = removeFromClient.checked;

            const researchRemoved = document.getElementById("swaparr_research_removed");
            if (researchRemoved) settings.research_removed = researchRemoved.checked;

            const failedImport = document.getElementById("swaparr_failed_import_detection");
            if (failedImport) settings.failed_import_detection = failedImport.checked;

            const dryRun = document.getElementById("swaparr_dry_run");
            if (dryRun) settings.dry_run = dryRun.checked;

            const ignoreUsenetQueued = document.getElementById("swaparr_ignore_usenet_queued");
            if (ignoreUsenetQueued) settings.ignore_usenet_queued = ignoreUsenetQueued.checked;

            const removeCompletedStalled = document.getElementById("swaparr_remove_completed_stalled");
            if (removeCompletedStalled) settings.remove_completed_stalled = removeCompletedStalled.checked;

            const sleepDuration = document.getElementById("swaparr_sleep_duration");
            if (sleepDuration) settings.sleep_duration = parseInt(sleepDuration.value) * 60;

            const malicious = document.getElementById("swaparr_malicious_detection");
            if (malicious) settings.malicious_file_detection = malicious.checked;

            const ageRemoval = document.getElementById("swaparr_age_based_removal");
            if (ageRemoval) settings.age_based_removal = ageRemoval.checked;

            const maxAge = document.getElementById("swaparr_max_age_days");
            if (maxAge) settings.max_age_days = parseInt(maxAge.value);

            const qualityRemoval = document.getElementById("swaparr_quality_based_removal");
            if (qualityRemoval) settings.quality_based_removal = qualityRemoval.checked;

            // Collect tags
            const getTags = (id) => {
                const container = document.getElementById(id);
                if (!container) return [];
                return Array.from(container.querySelectorAll(".tag-text")).map(el => el.textContent);
            };

            settings.malicious_extensions = getTags("swaparr_malicious_extensions_tags");
            settings.suspicious_patterns = getTags("swaparr_suspicious_patterns_tags");
            settings.blocked_quality_patterns = getTags("swaparr_quality_patterns_tags");

            // Save
            window.SettingsForms.saveAppSettings("swaparr", settings);
            
            // Reset UI state
            newSaveButton.innerHTML = '<i class="fas fa-save"></i> Save Changes';
            updateSaveButtonState(false);
        });
    };
})();


/* === modules/features/settings/indexer-editor.js === */
/**
 * Indexer Editor (Movie Hunt) - full-page editor for adding/editing a single indexer.
 * Separate from Indexer Management (list/CRUD). Attaches to window.SettingsForms.
 * Load after settings/core.js and instance-editor.js.
 *
 * Add flow:  Click "Add Indexer" -> editor opens with unlocked preset dropdown
 *            User picks preset -> URL/categories/name auto-populate, dropdown locks
 * Edit flow: Editor opens with preset already locked
 */
(function() {
    'use strict';
    if (typeof window.SettingsForms === 'undefined') return;

    const Forms = window.SettingsForms;

    // ── Preset metadata (Newznab standard) ──────────────────────────────
    // Default movie cats: [2000,2010,2020,2030,2040,2045,2050,2060]
    // Only NZBFinder has custom categories.
    var PRESET_META = {
        dognzb:        { name: 'DOGnzb',         url: 'https://api.dognzb.cr',            api_path: '/api', categories: [2000,2010,2020,2030,2040,2045,2050,2060] },
        drunkenslug:   { name: 'DrunkenSlug',     url: 'https://drunkenslug.com',           api_path: '/api', categories: [2000,2010,2020,2030,2040,2045,2050,2060] },
        'nzb.su':      { name: 'Nzb.su',          url: 'https://api.nzb.su',                api_path: '/api', categories: [2000,2010,2020,2030,2040,2045,2050,2060] },
        nzbcat:        { name: 'NZBCat',          url: 'https://nzb.cat',                   api_path: '/api', categories: [2000,2010,2020,2030,2040,2045,2050,2060] },
        'nzbfinder.ws':{ name: 'NZBFinder.ws',    url: 'https://nzbfinder.ws',              api_path: '/api', categories: [2030,2040,2045,2050,2060,2070] },
        nzbgeek:       { name: 'NZBgeek',         url: 'https://api.nzbgeek.info',          api_path: '/api', categories: [2000,2010,2020,2030,2040,2045,2050,2060] },
        'nzbplanet.net':{ name: 'nzbplanet.net',  url: 'https://api.nzbplanet.net',         api_path: '/api', categories: [2000,2010,2020,2030,2040,2045,2050,2060] },
        simplynzbs:    { name: 'SimplyNZBs',      url: 'https://simplynzbs.com',            api_path: '/api', categories: [2000,2010,2020,2030,2040,2045,2050,2060] },
        tabularasa:    { name: 'Tabula Rasa',     url: 'https://www.tabula-rasa.pw',        api_path: '/api/v1/api', categories: [2000,2010,2020,2030,2040,2045,2050,2060] },
        usenetcrawler: { name: 'Usenet Crawler',  url: 'https://www.usenet-crawler.com',    api_path: '/api', categories: [2000,2010,2020,2030,2040,2045,2050,2060] },
    };
    window.INDEXER_PRESET_META = PRESET_META;

    // ── Standard Newznab movie categories (most indexers) ───────────────
    var ALL_MOVIE_CATEGORIES = [
        { id: 2000, name: 'Movies' }, { id: 2010, name: 'Movies/Foreign' }, { id: 2020, name: 'Movies/Other' },
        { id: 2030, name: 'Movies/SD' }, { id: 2040, name: 'Movies/HD' }, { id: 2045, name: 'Movies/UHD' },
        { id: 2050, name: 'Movies/BluRay' }, { id: 2060, name: 'Movies/3D' }, { id: 2070, name: 'Movies/DVD' }
    ];
    // DOGnzb-specific: exact categories from DOGnzb dropdown
    var DOGNZB_CATEGORIES = [
        { id: 2000, name: 'Movies' }, { id: 2010, name: 'Foreign' }, { id: 2020, name: 'Other' },
        { id: 2030, name: 'SD' }, { id: 2040, name: 'HD' }, { id: 2045, name: '4K' },
        { id: 2050, name: 'BluRay' }, { id: 2060, name: '3D' }, { id: 2070, name: 'Mobile' }
    ];
    // NZBCat-specific: exact categories from NZBCat dropdown
    var NZBCAT_CATEGORIES = [
        { id: 2000, name: 'Movies' }, { id: 2010, name: 'Foreign' }, { id: 2020, name: 'Other' },
        { id: 2030, name: 'SD' }, { id: 2040, name: 'HD' }, { id: 2045, name: 'UHD' },
        { id: 2050, name: 'BluRay' }, { id: 2060, name: '3D' }, { id: 2070, name: 'Movies/DVD' }
    ];
    // NZB.su-specific: exact categories from NZB.su dropdown - only these 6
    var NZBSU_CATEGORIES = [
        { id: 2000, name: 'Movies' }, { id: 2010, name: 'Foreign' }, { id: 2020, name: 'Other' },
        { id: 2030, name: 'SD' }, { id: 2040, name: 'HD' }, { id: 2045, name: 'UHD' }
    ];
    // NZBFinder-specific: 2050=3D, 2060=BluRay, 2070=DVD, 2999=Other
    var NZBFINDER_CATEGORIES = [
        { id: 2000, name: 'Movies' }, { id: 2010, name: 'Foreign' },
        { id: 2030, name: 'SD' }, { id: 2040, name: 'HD' }, { id: 2045, name: 'UHD' },
        { id: 2050, name: '3D' }, { id: 2060, name: 'BluRay' }, { id: 2070, name: 'DVD' }, { id: 2999, name: 'Other' }
    ];
    // Usenet Crawler-specific: exact categories matching the dropdown
    var USENETCRAWLER_CATEGORIES = [
        { id: 2000, name: 'Movies' }, { id: 2010, name: 'Foreign' }, { id: 2020, name: 'Other' },
        { id: 2030, name: 'SD' }, { id: 2040, name: 'HD' }, { id: 2045, name: 'UHD' },
        { id: 2050, name: 'BluRay' }, { id: 2060, name: '3D' }, { id: 2070, name: 'Movies/DVD' }
    ];
    // Tabula Rasa-specific: 2050=3D, 2060=BluRay, 2070=DVD, 2080=WEBDL, 2090=X265, 2999=Other - no 2020
    var TABULARASA_CATEGORIES = [
        { id: 2000, name: 'Movies' }, { id: 2010, name: 'Foreign' },
        { id: 2030, name: 'SD' }, { id: 2040, name: 'HD' }, { id: 2045, name: 'UHD' },
        { id: 2050, name: '3D' }, { id: 2060, name: 'BluRay' }, { id: 2070, name: 'DVD' },
        { id: 2080, name: 'WEBDL' }, { id: 2090, name: 'X265' }, { id: 2999, name: 'Other' }
    ];
    // SimplyNZBs-specific: exact categories from SimplyNZBs dropdown
    var SIMPLYNZBS_CATEGORIES = [
        { id: 2000, name: 'Movies' }, { id: 2010, name: 'Foreign' }, { id: 2020, name: 'Other' },
        { id: 2030, name: 'SD' }, { id: 2040, name: 'HD' }, { id: 2045, name: 'UHD' },
        { id: 2050, name: 'BluRay' }, { id: 2060, name: '3D' }, { id: 2070, name: 'Movies/DVD' }
    ];
    // NZBplanet-specific: 2050=BluRay, 2060=3D, 2070=UHD, 2080=Cam - no 2045
    var NZBPLANET_CATEGORIES = [
        { id: 2000, name: 'Movies' }, { id: 2010, name: 'Foreign' }, { id: 2020, name: 'Other' },
        { id: 2030, name: 'SD' }, { id: 2040, name: 'HD' }, { id: 2050, name: 'BluRay' }, { id: 2060, name: '3D' },
        { id: 2070, name: 'UHD' }, { id: 2080, name: 'Cam' }
    ];
    // DrunkenSlug-specific: exact categories from DrunkenSlug dropdown - no 2020
    var DRUNKENSLUG_CATEGORIES = [
        { id: 2000, name: 'Movies' }, { id: 2010, name: 'Foreign' },
        { id: 2030, name: 'SD' }, { id: 2040, name: 'HD' }, { id: 2045, name: 'UHD' },
        { id: 2050, name: '3D' }, { id: 2060, name: 'BluRay' }, { id: 2070, name: 'DVD' }, { id: 2999, name: 'Other' }
    ];
    var DEFAULT_CATEGORIES = [2000, 2010, 2020, 2030, 2040, 2045, 2050, 2060];

    // ── TV preset metadata (Newznab standard) ──────────────────────────
    // Default TV cats: [5010,5030,5040,5045] (WEB-DL + SD + HD + UHD).
    var TV_PRESET_META = {
        dognzb:        { name: 'DOGnzb',         categories: [5010, 5030, 5040, 5045] },
        drunkenslug:   { name: 'DrunkenSlug',     categories: [5010, 5030, 5040, 5045] },
        'nzb.su':      { name: 'Nzb.su',          categories: [5010, 5030, 5040, 5045] },
        nzbcat:        { name: 'NZBCat',          categories: [5010, 5030, 5040, 5045] },
        'nzbfinder.ws':{ name: 'NZBFinder.ws',    categories: [5010, 5030, 5040, 5045] },
        nzbgeek:       { name: 'NZBgeek',         categories: [5010, 5030, 5040, 5045] },
        'nzbplanet.net':{ name: 'nzbplanet.net',  categories: [5010, 5030, 5040, 5045] },
        simplynzbs:    { name: 'SimplyNZBs',      categories: [5010, 5030, 5040, 5045] },
        tabularasa:    { name: 'Tabula Rasa',     categories: [5010, 5030, 5040, 5045] },
        usenetcrawler: { name: 'Usenet Crawler',  categories: [5010, 5030, 5040, 5045] },
    };

    // ── TV categories (5000 series only; never mix with 2000 movie series) ───
    var ALL_TV_CATEGORIES = [
        { id: 5000, name: 'TV' }, { id: 5010, name: 'TV/WEB-DL' }, { id: 5020, name: 'TV/Foreign' },
        { id: 5030, name: 'TV/SD' }, { id: 5040, name: 'TV/HD' }, { id: 5045, name: 'TV/UHD' },
        { id: 5050, name: 'TV/Other' }, { id: 5060, name: 'TV/Sport' }, { id: 5070, name: 'TV/Anime' }
    ];
    var DEFAULT_TV_CATEGORIES = [5000, 5010, 5020, 5030, 5040, 5045, 5050, 5060, 5070];

    // ── Helpers ────────────────────────────────────────────────────────
    Forms.getIndexerPresetLabel = function(preset) {
        var p = (preset || 'manual').toLowerCase().trim();
        if (PRESET_META[p]) return PRESET_META[p].name;
        if (TV_PRESET_META[p]) return TV_PRESET_META[p].name;
        if (p === 'manual') return 'Custom (Manual)';
        return p;
    };
    Forms.getIndexerCategoriesForPreset = function(preset) {
        var isTV = (Forms._indexersMode === 'tv');
        if (isTV) return ALL_TV_CATEGORIES;  // TV: 5000 series only
        var p = (preset || '').toLowerCase().trim();
        if (p === 'dognzb') return DOGNZB_CATEGORIES;
        if (p === 'drunkenslug') return DRUNKENSLUG_CATEGORIES;
        if (p === 'nzb.su') return NZBSU_CATEGORIES;
        if (p === 'nzbcat') return NZBCAT_CATEGORIES;
        if (p === 'nzbfinder.ws') return NZBFINDER_CATEGORIES;
        if (p === 'nzbplanet.net') return NZBPLANET_CATEGORIES;
        if (p === 'simplynzbs') return SIMPLYNZBS_CATEGORIES;
        if (p === 'tabularasa') return TABULARASA_CATEGORIES;
        if (p === 'usenetcrawler') return USENETCRAWLER_CATEGORIES;
        return ALL_MOVIE_CATEGORIES;  // Movie: 2000 series only
    };
    Forms.getIndexerDefaultIdsForPreset = function(preset) {
        var isTV = (Forms._indexersMode === 'tv');
        var p = (preset || 'manual').toLowerCase().trim();
        if (isTV) {
            if (TV_PRESET_META[p] && Array.isArray(TV_PRESET_META[p].categories)) {
                return TV_PRESET_META[p].categories.slice();
            }
            return DEFAULT_TV_CATEGORIES.slice();
        }
        if (PRESET_META[p] && Array.isArray(PRESET_META[p].categories)) {
            return PRESET_META[p].categories.slice();
        }
        return DEFAULT_CATEGORIES.slice();  // Movie: 2000 series only
    };

    // ── Open editor ────────────────────────────────────────────────────
    // isAdd=true: new indexer (preset dropdown unlocked, no preset chosen yet)
    // isAdd=false: editing existing (preset locked)
    Forms.openIndexerEditor = function(isAdd, index, instance) {
        var inst = instance || {};
        this._currentEditing = {
            appType: 'indexer',
            index: index,
            indexerId: (inst.id != null && inst.id !== '') ? String(inst.id) : null,
            isAdd: isAdd,
            originalInstance: JSON.parse(JSON.stringify(inst)),
            presetLocked: !isAdd  // locked on edit, unlocked on add
        };

        var preset = (instance && instance.preset) ? (instance.preset + '').toLowerCase().trim() : '';
        var pageTitleEl = document.getElementById('currentPageTitle');
        if (pageTitleEl) {
            pageTitleEl.textContent = isAdd ? 'Add Indexer' : (this.getIndexerPresetLabel(preset) + ' Indexer Editor');
        }

        var contentEl = document.getElementById('instance-editor-content');
        if (contentEl) contentEl.innerHTML = this.generateIndexerEditorHtml(instance || {}, isAdd);

        var saveBtn = document.getElementById('instance-editor-save');
        var backBtn = document.getElementById('instance-editor-back');
        if (saveBtn) {
            saveBtn.onclick = () => this.saveIndexerFromEditor();
            // Disable save until preset is chosen (add mode) or always enabled (edit mode)
            if (isAdd && !preset) {
                saveBtn.disabled = true;
                saveBtn.classList.remove('enabled');
            } else {
                saveBtn.disabled = false;
                saveBtn.classList.add('enabled');
            }
        }
        if (backBtn) backBtn.onclick = () => this.cancelInstanceEditor();

        // Wire up the preset selector for Add mode
        if (isAdd) {
            this._wirePresetSelector();
        }

        // Wire up categories, validation, enable toggle (only if preset selected)
        if (!isAdd || preset) {
            this._wireEditorFields();
        }

        if (window.huntarrUI && window.huntarrUI.switchSection) {
            window.huntarrUI.switchSection('instance-editor');
        }
    };

    // ── Wire up the preset selector (Add mode only) ───────────────────
    Forms._wirePresetSelector = function() {
        var self = this;
        var presetSelect = document.getElementById('editor-preset-select');
        if (!presetSelect) return;

        presetSelect.addEventListener('change', function() {
            var val = (presetSelect.value || '').trim();
            if (!val) return;

            // Handle "Import from Index Master"
            if (val === '__import_ih__') {
                var ihPanel = document.getElementById('editor-ih-import-panel');
                if (ihPanel) ihPanel.style.display = '';
                self._loadIndexerHuntAvailable();
                presetSelect.value = '';  // reset to placeholder
                return;
            }

            // Lock the dropdown
            presetSelect.disabled = true;
            presetSelect.classList.add('editor-readonly');
            self._currentEditing.presetLocked = true;

            // Update hidden preset field
            var presetHidden = document.getElementById('editor-preset');
            if (presetHidden) presetHidden.value = val;

            // Get metadata
            var meta = PRESET_META[val] || {};
            var isManual = val === 'manual';

            // Populate fields
            var nameEl = document.getElementById('editor-name');
            var urlEl = document.getElementById('editor-url');
            var apiPathEl = document.getElementById('editor-api-path');
            var urlGroup = document.getElementById('editor-url-group');
            var apiPathGroup = document.getElementById('editor-api-path-group');
            var urlHelp = document.getElementById('editor-url-help');
            var apiPathHelp = document.getElementById('editor-api-path-help');

            if (nameEl && !nameEl.value.trim()) nameEl.value = meta.name || 'Custom';
            if (urlEl) {
                urlEl.value = meta.url || '';
                if (!isManual) {
                    urlEl.setAttribute('readonly', 'readonly');
                    urlEl.classList.add('editor-readonly');
                } else {
                    urlEl.removeAttribute('readonly');
                    urlEl.classList.remove('editor-readonly');
                }
            }
            if (apiPathEl) {
                apiPathEl.value = meta.api_path || '/api';
                if (!isManual) {
                    apiPathEl.setAttribute('readonly', 'readonly');
                    apiPathEl.classList.add('editor-readonly');
                } else {
                    apiPathEl.removeAttribute('readonly');
                    apiPathEl.classList.remove('editor-readonly');
                }
            }
            if (urlHelp) urlHelp.textContent = isManual ? 'The base URL of your indexer.' : 'Pre-configured for this indexer preset.';
            if (apiPathHelp) apiPathHelp.textContent = 'Path to the API, usually /api';

            // Show fields that were hidden
            if (urlGroup) urlGroup.style.display = '';
            if (apiPathGroup) apiPathGroup.style.display = '';
            var keyGroup = document.getElementById('editor-key-group');
            if (keyGroup) keyGroup.style.display = '';
            var catSection = document.getElementById('editor-categories-section');
            if (catSection) catSection.style.display = '';
            var enableGroup = document.getElementById('editor-enable-group');
            if (enableGroup) enableGroup.style.display = '';
            var enableRssGroup = document.getElementById('editor-enable-rss-group');
            if (enableRssGroup) enableRssGroup.style.display = '';

            // Populate categories
            var defaultCats = Forms.getIndexerDefaultIdsForPreset(val);
            var pillsEl = document.getElementById('indexer-categories-pills');
            if (pillsEl) {
                pillsEl.innerHTML = '';
                var allCats = Forms.getIndexerCategoriesForPreset(val);
                defaultCats.forEach(function(id) {
                    var c = allCats.find(function(x) { return x.id === id; });
                    var label = c ? (c.name + ' (' + c.id + ')') : String(id);
                    var span = document.createElement('span');
                    span.className = 'indexer-category-pill';
                    span.setAttribute('data-category-id', id);
                    span.innerHTML = '<span class="indexer-category-remove" aria-label="Remove">\u00d7</span><span>' + label + '</span>';
                    pillsEl.appendChild(span);
                });
            }
            Forms.populateIndexerCategoriesDropdown();

            // Enable save button
            var saveBtn = document.getElementById('instance-editor-save');
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.classList.add('enabled');
            }

            // Update page title
            var pageTitleEl = document.getElementById('currentPageTitle');
            if (pageTitleEl) pageTitleEl.textContent = (meta.name || 'Custom') + ' Indexer Editor';

            // Wire up rest of editor fields now
            self._wireEditorFields();
        });
    };

    // ── Import from Index Master ─────────────────────────────────────────
    Forms._loadIndexerHuntAvailable = function() {
        var self = this;
        // Read instance ID and mode from the instance select dropdown (value format: "movie:1" or "tv:2")
        var instanceId = 1;
        var mode = 'movie';
        var sel = document.getElementById('settings-indexers-instance-select');
        if (sel && sel.value) {
            var parts = sel.value.split(':');
            if (parts.length === 2) {
                mode = parts[0] === 'tv' ? 'tv' : 'movie';
                var parsed = parseInt(parts[1], 10);
                if (!isNaN(parsed)) instanceId = parsed;
            }
        }
        fetch('./api/indexer-hunt/available/' + instanceId + '?mode=' + mode)
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var sel = document.getElementById('editor-ih-select');
                if (!sel) return;
                sel.innerHTML = '<option value="">Select an indexer from Index Master...</option>';
                (data.available || []).forEach(function(idx) {
                    var opt = document.createElement('option');
                    opt.value = idx.id;
                    opt.textContent = idx.name + ' (Priority: ' + idx.priority + ', ' + (idx.api_key_last4 ? '****' + idx.api_key_last4 : 'no key') + ')';
                    opt.setAttribute('data-name', idx.name);
                    opt.setAttribute('data-preset', idx.preset);
                    opt.setAttribute('data-priority', idx.priority);
                    opt.setAttribute('data-url', idx.url || '');
                    sel.appendChild(opt);
                });
                if ((data.available || []).length === 0) {
                    sel.innerHTML = '<option value="">No available indexers in Index Master</option>';
                }
                // Wire change handler
                sel.addEventListener('change', function() {
                    self._onIndexerHuntImportSelect(sel);
                });
            })
            .catch(function(err) {
                console.error('[IndexerEditor] Failed to load Indexer Hunt available:', err);
            });
    };

    Forms._onIndexerHuntImportSelect = function(sel) {
        var ihId = sel.value;
        if (!ihId) return;
        var opt = sel.options[sel.selectedIndex];
        if (!opt) return;

        var name = opt.getAttribute('data-name') || '';
        var preset = opt.getAttribute('data-preset') || 'manual';
        var priority = parseInt(opt.getAttribute('data-priority') || '50', 10);

        // Read instance ID and mode from dropdown (value format: "movie:1" or "tv:1")
        var instanceId = 1;
        var mode = 'movie';
        var instSel = document.getElementById('settings-indexers-instance-select');
        if (instSel && instSel.value) {
            var parts = instSel.value.split(':');
            if (parts.length === 2) {
                mode = parts[0] === 'tv' ? 'tv' : 'movie';
                var parsed = parseInt(parts[1], 10);
                if (!isNaN(parsed)) instanceId = parsed;
            }
        }

        // Sync this indexer to the current instance via the API
        fetch('./api/indexer-hunt/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ instance_id: instanceId, mode: mode, indexer_ids: [ihId] }),
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.success && data.added > 0) {
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('Imported "' + name + '" from Index Master.', 'success');
                }
                if (window.SettingsForms && window.SettingsForms.refreshIndexersList) {
                    window.SettingsForms.refreshIndexersList();
                }
                if (window.IndexerHunt && window.IndexerHunt._refreshIndexerInstanceStatus) {
                    window.IndexerHunt._refreshIndexerInstanceStatus();
                }
                // Go back to indexer list
                if (window.SettingsForms && window.SettingsForms.cancelInstanceEditor) {
                    window.SettingsForms.cancelInstanceEditor();
                }
            } else if (data.success && data.added === 0) {
                if (window.huntarrUI) window.huntarrUI.showNotification('This indexer is already synced to this instance.', 'info');
            } else {
                if (window.huntarrUI) window.huntarrUI.showNotification(data.error || 'Import failed.', 'error');
            }
        })
        .catch(function(err) {
            if (window.huntarrUI) window.huntarrUI.showNotification('Import error: ' + err, 'error');
        });
    };

    // ── Wire up category pills, API key validation, enable toggle ─────
    Forms._wireEditorFields = function() {
        var self = this;

        // Categories
        this.populateIndexerCategoriesDropdown();
        var catSelect = document.getElementById('editor-categories-select');
        var catPills = document.getElementById('indexer-categories-pills');
        var presetElForCat = document.getElementById('editor-preset');
        if (catSelect) {
            catSelect.addEventListener('change', function() {
                var id = parseInt(catSelect.value, 10);
                if (!id) return;
                var pill = catPills ? catPills.querySelector('.indexer-category-pill[data-category-id="' + id + '"]') : null;
                if (pill) return;
                var preset = presetElForCat ? presetElForCat.value : '';
                var cats = Forms.getIndexerCategoriesForPreset(preset);
                var c = cats.find(function(x) { return x.id === id; });
                var label = c ? (c.name + ' (' + c.id + ')') : String(id);
                var span = document.createElement('span');
                span.className = 'indexer-category-pill';
                span.setAttribute('data-category-id', id);
                span.innerHTML = '<span class="indexer-category-remove" aria-label="Remove">\u00d7</span><span>' + String(label).replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span>';
                span.querySelector('.indexer-category-remove').addEventListener('click', function() {
                    span.remove();
                    Forms.populateIndexerCategoriesDropdown();
                });
                if (catPills) catPills.appendChild(span);
                Forms.populateIndexerCategoriesDropdown();
                catSelect.value = '';
            });
        }
        if (catPills) {
            catPills.addEventListener('click', function(e) {
                var remove = e.target.classList.contains('indexer-category-remove') ? e.target : e.target.closest('.indexer-category-remove');
                if (remove) {
                    var pill = remove.closest('.indexer-category-pill');
                    if (pill) pill.remove();
                    Forms.populateIndexerCategoriesDropdown();
                }
            });
        }

        // API key validation
        var keyInput = document.getElementById('editor-key');
        var urlInput = document.getElementById('editor-url');
        var apiPathInput = document.getElementById('editor-api-path');
        if (keyInput) {
            var validationTimeout;
            var runCheck = function() {
                clearTimeout(validationTimeout);
                validationTimeout = setTimeout(function() { self.checkIndexerConnection(); }, 500);
            };
            keyInput.addEventListener('input', runCheck);
            keyInput.addEventListener('change', runCheck);
            if (urlInput) {
                urlInput.addEventListener('input', runCheck);
                urlInput.addEventListener('change', runCheck);
            }
            if (apiPathInput) {
                apiPathInput.addEventListener('input', runCheck);
                apiPathInput.addEventListener('change', runCheck);
            }
            this.checkIndexerConnection();
        }

        // Enable status toggle
        var enabledSelect = document.getElementById('editor-enabled');
        var enableIcon = document.getElementById('indexer-enable-status-icon');
        if (enabledSelect && enableIcon) {
            enabledSelect.addEventListener('change', function() {
                var isEnabled = enabledSelect.value === 'true';
                enableIcon.className = isEnabled ? 'fas fa-check-circle' : 'fas fa-minus-circle';
                enableIcon.style.color = isEnabled ? '#10b981' : '#ef4444';
            });
        }

        // Enable RSS toggle
        var enableRssSelect = document.getElementById('editor-enable-rss');
        var rssIcon = document.getElementById('indexer-rss-status-icon');
        if (enableRssSelect && rssIcon) {
            enableRssSelect.addEventListener('change', function() {
                var isRssEnabled = enableRssSelect.value === 'true';
                rssIcon.className = isRssEnabled ? 'fas fa-rss' : 'fas fa-minus-circle';
                rssIcon.style.color = isRssEnabled ? '#f59e0b' : '#ef4444';
            });
        }
    };

    // ── Generate HTML ──────────────────────────────────────────────────
    Forms.generateIndexerEditorHtml = function(instance, isAdd) {
        var name = (instance.name || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        var rawPreset = (instance.preset || '').toLowerCase().replace(/[^a-z0-9.-]/g, '');
        var hasPreset = !!(rawPreset && (PRESET_META[rawPreset] || TV_PRESET_META[rawPreset] || rawPreset === 'manual'));
        var preset = hasPreset ? rawPreset : '';
        var isManual = preset === 'manual';
        var enabled = instance.enabled !== false;
        var enableRss = instance.enable_rss !== false;
        var isEdit = !isAdd;
        var isSynced = !!(instance.indexer_hunt_id);
        var keyLast4 = instance.api_key_last4 || '';
        var keyPlaceholder = isEdit && keyLast4
            ? ('Enter new key or leave blank to keep existing (\u2022\u2022\u2022\u2022' + keyLast4 + ')')
            : 'Your API Key';
        var keyMasked = keyLast4 ? ('\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' + keyLast4) : '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022****';

        // URL & API Path
        var meta = PRESET_META[preset] || TV_PRESET_META[preset] || {};
        var url = (instance.url || meta.url || '').replace(/"/g, '&quot;');
        var apiPath = (instance.api_path || meta.api_path || '/api').replace(/"/g, '&quot;');
        var urlReadonly = hasPreset && !isManual;

        // Categories: Movie = 2000 series only, TV = 5000 series only (no cross-ref)
        var allCats = Forms.getIndexerCategoriesForPreset(preset);
        var defaultIds = hasPreset ? Forms.getIndexerDefaultIdsForPreset(preset) : [];
        var categoryIds = Array.isArray(instance.categories) ? instance.categories : defaultIds;
        var validIds = allCats.map(function(x) { return x.id; });
        categoryIds = categoryIds.filter(function(id) { return validIds.indexOf(id) !== -1; });
        if (categoryIds.length === 0) categoryIds = defaultIds;
        var categoryChipsHtml = categoryIds.map(function(id) {
            var c = allCats.find(function(x) { return x.id === id; });
            var label = c ? (c.name + ' (' + c.id + ')') : String(id);
            return '<span class="indexer-category-pill" data-category-id="' + id + '"><span class="indexer-category-remove" aria-label="Remove">\u00d7</span><span>' + String(label).replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span></span>';
        }).join('');

        // Build preset selector or locked display
        var presetHtml;
        if (isAdd && !hasPreset) {
            // Add mode, no preset yet: show dropdown
            presetHtml = '<div class="editor-field-group">' +
                '<label for="editor-preset-select">Indexer Type</label>' +
                '<select id="editor-preset-select" class="settings-select" style="width: 100%; padding: 10px 12px; background: #1e293b; border: 1px solid #475569; border-radius: 6px; color: #e2e8f0;">' +
                '<option value="">Select an indexer...</option>' +
                '<option value="__import_ih__">Import from Index Master</option>' +
                '<option disabled>\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500</option>' +
                '<option value="dognzb">DOGnzb</option>' +
                '<option value="drunkenslug">DrunkenSlug</option>' +
                '<option value="nzb.su">Nzb.su</option>' +
                '<option value="nzbcat">NZBCat</option>' +
                '<option value="nzbfinder.ws">NZBFinder.ws</option>' +
                '<option value="nzbgeek">NZBgeek</option>' +
                '<option value="nzbplanet.net">nzbplanet.net</option>' +
                '<option value="simplynzbs">SimplyNZBs</option>' +
                '<option value="tabularasa">Tabula Rasa</option>' +
                '<option value="usenetcrawler">Usenet Crawler</option>' +
                '<option disabled>\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500</option>' +
                '<option value="manual">Custom (Manual Configuration)</option>' +
                '</select>' +
                '<p class="editor-help-text">Choose a preset, import from Index Master, or configure manually.</p>' +
                '</div>' +
                '<div class="editor-field-group" id="editor-ih-import-panel" style="display: none;">' +
                    '<label>Available from Index Master</label>' +
                    '<select id="editor-ih-select" class="settings-select" style="width: 100%; padding: 10px 12px; background: #1e293b; border: 1px solid #475569; border-radius: 6px; color: #e2e8f0;">' +
                        '<option value="">Select an indexer from Index Master...</option>' +
                    '</select>' +
                    '<p class="editor-help-text">Select an indexer configured in Index Master to import it to this instance.</p>' +
                '</div>';
        } else {
            // Edit mode or Add with preset already selected: locked display
            var presetLabel = Forms.getIndexerPresetLabel(preset);
            presetHtml = '<div class="editor-field-group">' +
                '<label>Indexer Type</label>' +
                '<div class="indexer-preset-locked">' +
                '<i class="fas ' + (isManual ? 'fa-cog' : 'fa-server') + '"></i>' +
                '<span>' + presetLabel + '</span>' +
                '<i class="fas fa-lock indexer-preset-lock-icon"></i>' +
                '</div>' +
                '<p class="editor-help-text">Indexer type is set when created and cannot be changed.</p>' +
                '</div>';
        }

        // Priority
        var priority = instance.priority !== undefined ? instance.priority : 50;
        var indexerHuntId = instance.indexer_hunt_id || '';

        // Should we hide fields until preset is picked? (Add mode, no preset)
        var fieldsHidden = isAdd && !hasPreset;
        var hideStyle = fieldsHidden ? ' style="display: none;"' : '';

        return '<input type="hidden" id="editor-preset" value="' + (preset || '') + '">' +
            '<input type="hidden" id="editor-indexer-hunt-id" value="' + indexerHuntId + '">' +
            '<div class="editor-grid">' +
                '<div class="editor-section">' +
                    '<div class="editor-section-title" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">' +
                        '<span>Connection Settings</span>' +
                        '<div id="indexer-connection-status-container" style="display: flex; justify-content: flex-end; flex: 1;"></div>' +
                    '</div>' +
                    presetHtml +
                    '<div class="editor-field-group" id="editor-enable-group"' + hideStyle + '>' +
                        '<div class="editor-setting-item">' +
                            '<label style="display: flex; align-items: center;">' +
                                '<span>Enable Status</span>' +
                                '<i id="indexer-enable-status-icon" class="fas ' + (enabled ? 'fa-check-circle' : 'fa-minus-circle') + '" style="color: ' + (enabled ? '#10b981' : '#ef4444') + '; font-size: 1.1rem; margin-left: 8px;"></i>' +
                            '</label>' +
                            '<select id="editor-enabled">' +
                                '<option value="true"' + (enabled ? ' selected' : '') + '>Enabled</option>' +
                                '<option value="false"' + (!enabled ? ' selected' : '') + '>Disabled</option>' +
                            '</select>' +
                        '</div>' +
                        '<p class="editor-help-text">Enable or disable this indexer</p>' +
                    '</div>' +
                    '<div class="editor-field-group" id="editor-enable-rss-group"' + hideStyle + '>' +
                        '<div class="editor-setting-item">' +
                            '<label style="display: flex; align-items: center;">' +
                                '<span>Enable RSS</span>' +
                                '<i id="indexer-rss-status-icon" class="fas ' + (enableRss ? 'fa-rss' : 'fa-minus-circle') + '" style="color: ' + (enableRss ? '#f59e0b' : '#ef4444') + '; font-size: 1.1rem; margin-left: 8px;"></i>' +
                            '</label>' +
                            '<select id="editor-enable-rss">' +
                                '<option value="true"' + (enableRss ? ' selected' : '') + '>Enabled</option>' +
                                '<option value="false"' + (!enableRss ? ' selected' : '') + '>Disabled</option>' +
                            '</select>' +
                        '</div>' +
                        '<p class="editor-help-text">Will be used when Media Hunt periodically looks for releases via RSS Sync</p>' +
                    '</div>' +
                    '<div class="editor-field-group"' + hideStyle + '>' +
                        '<label for="editor-name">Name</label>' +
                        '<input type="text" id="editor-name" value="' + name + '" placeholder="e.g. My Indexer">' +
                        '<p class="editor-help-text">A friendly name to identify this indexer.</p>' +
                    '</div>' +
                    '<div class="editor-field-group" id="editor-key-group"' + hideStyle + '>' +
                        '<label for="editor-key">API Key</label>' +
                        (isSynced
                            ? '<input type="text" id="editor-key" value="' + keyMasked.replace(/"/g, '&quot;') + '" readonly class="editor-readonly">' +
                              '<p class="editor-help-text">API key is managed by Index Master and cannot be changed here.</p>'
                            : '<input type="text" id="editor-key" placeholder="' + keyPlaceholder.replace(/"/g, '&quot;') + '">' +
                              '<p class="editor-help-text">Only the last 4 characters will be shown on the card after saving.</p>') +
                    '</div>' +
                    '<div class="editor-field-group" id="editor-priority-group"' + hideStyle + '>' +
                        '<label for="editor-priority">Indexer Priority</label>' +
                        '<input type="number" id="editor-priority" value="' + priority + '" min="1" max="99" style="width: 100%; padding: 10px 12px; background: #1e293b; border: 1px solid #475569; border-radius: 6px; color: #e2e8f0;">' +
                        '<p class="editor-help-text">Lower number = higher priority (1-99, default 50). When multiple indexers find a match, results from higher-priority indexers are preferred.</p>' +
                    '</div>' +
                    '<div class="editor-field-group" id="editor-url-group"' + hideStyle + '>' +
                        '<label for="editor-url">URL</label>' +
                        '<input type="text" id="editor-url" value="' + url + '" placeholder="https://my-indexer.com"' + (urlReadonly ? ' readonly class="editor-readonly"' : '') + '>' +
                        '<p class="editor-help-text" id="editor-url-help">' + (urlReadonly ? 'Pre-configured for this indexer preset.' : 'The base URL of your indexer.') + '</p>' +
                    '</div>' +
                    '<div class="editor-field-group" id="editor-api-path-group"' + hideStyle + '>' +
                        '<label for="editor-api-path">API Path</label>' +
                        '<input type="text" id="editor-api-path" value="' + apiPath + '" placeholder="/api"' + (urlReadonly ? ' readonly class="editor-readonly"' : '') + '>' +
                        '<p class="editor-help-text" id="editor-api-path-help">Path to the API, usually /api</p>' +
                    '</div>' +
                '</div>' +
                '<div class="editor-section" id="editor-categories-section"' + hideStyle + '>' +
                    '<div class="editor-section-title">Additional Configurations</div>' +
                    '<div class="editor-field-group">' +
                        '<label for="editor-categories-select">Categories</label>' +
                        '<select id="editor-categories-select" class="settings-select" style="width: 100%; padding: 10px 12px; background: #1e293b; border: 1px solid #475569; border-radius: 6px; color: #e2e8f0;">' +
                            '<option value="">Select additional categories to add...</option>' +
                        '</select>' +
                        '<p class="editor-help-text">Categories to use for this indexer.</p>' +
                        '<div id="indexer-categories-pills" class="indexer-categories-pills" style="display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; min-height: 24px;">' + categoryChipsHtml + '</div>' +
                    '</div>' +
                '</div>' +
            '</div>';
    };

    // ── Populate categories dropdown ───────────────────────────────────
    Forms.populateIndexerCategoriesDropdown = function() {
        var select = document.getElementById('editor-categories-select');
        var pills = document.getElementById('indexer-categories-pills');
        var presetEl = document.getElementById('editor-preset');
        if (!select || !pills) return;
        var preset = presetEl ? presetEl.value : '';
        var categories = Forms.getIndexerCategoriesForPreset(preset);
        var selectedIds = Array.from(pills.querySelectorAll('.indexer-category-pill')).map(function(el) { return parseInt(el.getAttribute('data-category-id'), 10); }).filter(function(id) { return !isNaN(id); });
        select.innerHTML = '<option value="">Select additional categories to add...</option>';
        categories.forEach(function(c) {
            if (selectedIds.indexOf(c.id) === -1) {
                var opt = document.createElement('option');
                opt.value = c.id;
                opt.textContent = c.name + ' (' + c.id + ')';
                select.appendChild(opt);
            }
        });
    };

    // ── Connection validation ──────────────────────────────────────────
    Forms.checkIndexerConnection = function() {
        var container = document.getElementById('indexer-connection-status-container');
        var presetEl = document.getElementById('editor-preset');
        var keyEl = document.getElementById('editor-key');
        var urlEl = document.getElementById('editor-url');
        var apiPathEl = document.getElementById('editor-api-path');
        if (!container || !presetEl || !keyEl) return;
        container.style.display = 'flex';
        container.style.justifyContent = 'flex-end';

        // Synced indexers: API key is managed by Index Master, show synced status
        var ihIdEl = document.getElementById('editor-indexer-hunt-id');
        if (ihIdEl && ihIdEl.value.trim()) {
            container.innerHTML = '<span class="connection-status" style="background: rgba(99,102,241,0.1); color: #818cf8; border: 1px solid rgba(99,102,241,0.2);"><i class="fas fa-check-circle"></i><span>API key synced from Index Master.</span></span>';
            return;
        }

        var preset = (presetEl.value || '').trim().toLowerCase();
        var apiKey = (keyEl.value || '').trim();
        var hasSavedKey = this._currentEditing && this._currentEditing.originalInstance && (this._currentEditing.originalInstance.api_key_last4 || '');

        if (preset === 'manual') {
            var customUrl = urlEl ? urlEl.value.trim() : '';
            if (!customUrl) {
                container.innerHTML = '<span class="connection-status" style="background: rgba(251, 191, 36, 0.1); color: #fbbf24; border: 1px solid rgba(251, 191, 36, 0.2);"><i class="fas fa-exclamation-triangle"></i><span>Enter URL and API key to validate</span></span>';
                return;
            }
            if (!apiKey || apiKey.length < 10) {
                if (hasSavedKey) {
                    container.innerHTML = '<span class="connection-status" style="background: rgba(148, 163, 184, 0.1); color: #94a3b8; border: 1px solid rgba(148, 163, 184, 0.2);"><i class="fas fa-check-circle"></i><span>API key saved. Leave blank to keep existing.</span></span>';
                    return;
                }
                container.innerHTML = '<span class="connection-status" style="background: rgba(251, 191, 36, 0.1); color: #fbbf24; border: 1px solid rgba(251, 191, 36, 0.2);"><i class="fas fa-exclamation-triangle"></i><span>Enter API key</span></span>';
                return;
            }
            container.innerHTML = '<span class="connection-status checking"><i class="fas fa-spinner fa-spin"></i><span>Checking...</span></span>';
            var customApiPath = apiPathEl ? apiPathEl.value.trim() : '/api';
            fetch('./api/indexers/validate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ preset: 'manual', api_key: apiKey, url: customUrl, api_path: customApiPath })
            })
                .then(function(r) { return r.json().then(function(data) { return { ok: r.ok, data: data }; }); })
                .then(function(result) {
                    var data = result.data || {};
                    container.innerHTML = data.valid === true
                        ? '<span class="connection-status success"><i class="fas fa-check-circle"></i><span>Connected</span></span>'
                        : '<span class="connection-status error"><i class="fas fa-times-circle"></i><span>' + (data.message || 'Validation failed') + '</span></span>';
                })
                .catch(function(err) {
                    container.innerHTML = '<span class="connection-status error"><i class="fas fa-times-circle"></i><span>' + (err.message || 'Connection failed') + '</span></span>';
                });
            return;
        }

        // Preset indexers
        if (!apiKey || apiKey.length < 10) {
            if (hasSavedKey) {
                container.innerHTML = '<span class="connection-status" style="background: rgba(148, 163, 184, 0.1); color: #94a3b8; border: 1px solid rgba(148, 163, 184, 0.2);"><i class="fas fa-check-circle"></i><span>API key saved. Leave blank to keep existing.</span></span>';
                return;
            }
            container.innerHTML = '<span class="connection-status" style="background: rgba(251, 191, 36, 0.1); color: #fbbf24; border: 1px solid rgba(251, 191, 36, 0.2);"><i class="fas fa-exclamation-triangle"></i><span>Enter API key</span></span>';
            return;
        }
        container.innerHTML = '<span class="connection-status checking"><i class="fas fa-spinner fa-spin"></i><span>Checking...</span></span>';
        fetch('./api/indexers/validate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ preset: preset, api_key: apiKey })
        })
            .then(function(r) { return r.json().then(function(data) { return { ok: r.ok, data: data }; }); })
            .then(function(result) {
                var data = result.data || {};
                container.innerHTML = data.valid === true
                    ? '<span class="connection-status success"><i class="fas fa-check-circle"></i><span>Connected</span></span>'
                    : '<span class="connection-status error"><i class="fas fa-times-circle"></i><span>' + (data.message || 'Invalid API key') + '</span></span>';
            })
            .catch(function(err) {
                container.innerHTML = '<span class="connection-status error"><i class="fas fa-times-circle"></i><span>' + (err.message || 'Connection failed') + '</span></span>';
            });
    };

    Forms.validateIndexerApiKey = function() {
        this.checkIndexerConnection();
    };

    // ── Save ───────────────────────────────────────────────────────────
    Forms.saveIndexerFromEditor = function() {
        if (!this._currentEditing || this._currentEditing.appType !== 'indexer') return;
        var enabledEl = document.getElementById('editor-enabled');
        var presetEl = document.getElementById('editor-preset');
        var nameEl = document.getElementById('editor-name');
        var keyEl = document.getElementById('editor-key');
        var urlEl = document.getElementById('editor-url');
        var apiPathEl = document.getElementById('editor-api-path');
        var enabled = enabledEl ? enabledEl.value === 'true' : true;
        var preset = presetEl ? presetEl.value : 'manual';
        var name = nameEl ? nameEl.value.trim() : '';
        var apiKey = keyEl ? keyEl.value.trim() : '';
        var indexerUrl = urlEl ? urlEl.value.trim() : '';
        var apiPath = apiPathEl ? apiPathEl.value.trim() : '/api';
        var isAdd = this._currentEditing.isAdd;
        var index = this._currentEditing.index;
        var pillsEl = document.getElementById('indexer-categories-pills');
        var categories = pillsEl ? Array.from(pillsEl.querySelectorAll('.indexer-category-pill')).map(function(el) { return parseInt(el.getAttribute('data-category-id'), 10); }).filter(function(id) { return !isNaN(id); }) : [];
        if (categories.length === 0) categories = Forms.getIndexerDefaultIdsForPreset(preset);

        var priorityEl = document.getElementById('editor-priority');
        var ihIdEl = document.getElementById('editor-indexer-hunt-id');
        var priority = parseInt(priorityEl ? priorityEl.value : '50', 10) || 50;
        if (priority < 1) priority = 1;
        if (priority > 99) priority = 99;
        var indexerHuntId = ihIdEl ? ihIdEl.value.trim() : '';

        var enableRssEl = document.getElementById('editor-enable-rss');
        var enableRss = enableRssEl ? enableRssEl.value === 'true' : true;
        var body = { name: name || 'Unnamed', preset: preset, enabled: enabled, enable_rss: enableRss, categories: categories, url: indexerUrl, api_path: apiPath, priority: priority };
        if (indexerHuntId) {
            body.indexer_hunt_id = indexerHuntId;
        } else {
            body.api_key = apiKey;
        }
        var apiBase = (window.SettingsForms && window.SettingsForms.getIndexersApiBase) ? window.SettingsForms.getIndexersApiBase() : './api/indexers';
        var editId = (window.SettingsForms && window.SettingsForms._currentEditing && window.SettingsForms._currentEditing.indexerId) ? window.SettingsForms._currentEditing.indexerId : index;
        var endpoint = isAdd ? apiBase : apiBase + '/' + editId;
        var method = isAdd ? 'POST' : 'PUT';
        fetch(endpoint, { method: method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (window.SettingsForms && window.SettingsForms.refreshIndexersList) {
                    window.SettingsForms.refreshIndexersList();
                }
                if (window.IndexerHunt && window.IndexerHunt._refreshIndexerInstanceStatus) {
                    window.IndexerHunt._refreshIndexerInstanceStatus();
                }
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification(isAdd ? 'Indexer added.' : 'Indexer updated.', 'success');
                }
                // Stay on editor after save
                if (window.SettingsForms && window.SettingsForms._currentEditing) {
                    window.SettingsForms._currentEditing.isAdd = false;
                    if (data && (data.index !== undefined || data.indexer !== undefined)) {
                        window.SettingsForms._currentEditing.index = data.index !== undefined ? data.index : (data.indexer && data.indexer.index !== undefined ? data.indexer.index : index);
                    }
                }
            })
            .catch(function(err) {
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification(err.message || 'Failed to save indexer', 'error');
                }
            });
    };
})();


/* === modules/features/settings/indexers.js === */
/**
 * Indexer Management – single view for Movie Hunt and TV Hunt. Combined instance dropdown
 * (Movie - X / TV - X, alphabetical). Each instance keeps its own indexers; same page linked from both sidebars.
 */
(function() {
    'use strict';
    if (typeof window.SettingsForms === 'undefined') return;

    const Forms = window.SettingsForms;
    Forms._indexersMode = 'movie';

    Forms.getIndexersApiBase = function() {
        return this._indexersMode === 'tv' ? './api/tv-hunt/indexers' : './api/indexers';
    };
    Forms.getIndexersInstanceApiBase = function(mode) {
        return mode === 'tv' ? './api/tv-hunt' : './api/movie-hunt';
    };

    Forms.renderIndexerCard = function(indexer, index) {
        const isTV = Forms._indexersMode === 'tv';
        const indexerIdAttr = (isTV && indexer.id) ? ' data-indexer-id="' + String(indexer.id).replace(/"/g, '&quot;') + '"' : '';
        const headerName = indexer.name || 'Unnamed';
        const name = headerName.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const last4 = indexer.api_key_last4 || (indexer.api_key && indexer.api_key.slice(-4)) || '****';
        const preset = (indexer.preset || 'manual').replace(/"/g, '&quot;');
        const enabled = indexer.enabled !== false;
        const statusClass = enabled ? 'status-connected' : 'status-error';
        const statusIcon = enabled ? 'fa-check-circle' : 'fa-minus-circle';
        const isIH = !!(indexer.indexer_hunt_id);
        var urlDisplay = '';
        var rawUrl = indexer.url || indexer.api_url || '';
        if (!rawUrl && window.INDEXER_PRESET_META && window.INDEXER_PRESET_META[preset]) {
            rawUrl = window.INDEXER_PRESET_META[preset].url || '';
        }
        if (rawUrl) {
            var shortUrl = rawUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
            if (shortUrl.length > 30) shortUrl = shortUrl.substring(0, 28) + '\u2026';
            urlDisplay = '<div class="instance-detail"><i class="fas fa-link"></i><span>' + shortUrl.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span></div>';
        }
        var ihBadge = isIH ? '<span style="font-size:0.65rem;background:rgba(99,102,241,0.15);color:#818cf8;padding:2px 6px;border-radius:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-left:6px;">Synced</span>' : '';
        var rssEnabled = indexer.enable_rss !== false;
        var rssBadgeColor = rssEnabled ? '#22c55e' : '#6b7280';
        var rssBadgeText = rssEnabled ? 'RSS' : 'No RSS';

        return '<div class="instance-card" data-instance-index="' + index + '"' + indexerIdAttr + ' data-app-type="indexer" data-preset="' + preset + '" data-enabled="' + enabled + '" data-ih="' + (isIH ? '1' : '0') + '">' +
            '<div class="instance-card-header">' +
            '<div class="instance-name instance-name-with-priority"><i class="fas fa-server"></i><span>' + name + '</span>' + ihBadge + '</div>' +
            '<div class="instance-status-icon ' + statusClass + '"><i class="fas ' + statusIcon + '"></i></div>' +
            '</div>' +
            '<div class="instance-card-body">' +
            urlDisplay +
            '<div class="instance-detail"><i class="fas fa-key"></i><span>\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' + last4 + '</span></div>' +
            '<div class="instance-detail"><i class="fas fa-sort-numeric-down"></i><span>Priority: ' + (indexer.priority || 50) + '</span></div>' +
            '<div class="instance-detail"><i class="fas fa-rss" style="color:' + rssBadgeColor + '"></i><span style="color:' + rssBadgeColor + '">' + rssBadgeText + '</span></div>' +
            '</div>' +
            '<div class="instance-card-footer">' +
            '<button type="button" class="btn-card edit" data-app-type="indexer" data-instance-index="' + index + '"><i class="fas fa-edit"></i> Edit</button>' +
            '<button type="button" class="btn-card delete" data-app-type="indexer" data-instance-index="' + index + '"><i class="fas fa-trash"></i> Delete</button>' +
            '</div></div>';
    };

    Forms.setCurrentInstanceAndRefreshIndexers = function(mode, instanceId) {
        Forms._indexersMode = mode;
        var apiBase = Forms.getIndexersInstanceApiBase(mode);
        fetch(apiBase + '/instances/current', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ instance_id: parseInt(instanceId, 10) })
        }).then(function(r) { return r.json(); }).then(function() {
            Forms.refreshIndexersList();
        }).catch(function() {
            Forms.refreshIndexersList();
        });
    };

    Forms.populateCombinedIndexersDropdown = function(preferMode) {
        var selectEl = document.getElementById('settings-indexers-instance-select');
        if (!selectEl) return;
        selectEl.innerHTML = '<option value="">Loading...</option>';
        var ts = Date.now();
        Promise.all([
            fetch('./api/movie-hunt/instances?t=' + ts, { cache: 'no-store' }).then(function(r) { return r.json(); }),
            fetch('./api/tv-hunt/instances?t=' + ts, { cache: 'no-store' }).then(function(r) { return r.json(); }),
            fetch('./api/movie-hunt/instances/current?t=' + ts, { cache: 'no-store' }).then(function(r) { return r.json(); }),
            fetch('./api/tv-hunt/instances/current?t=' + ts, { cache: 'no-store' }).then(function(r) { return r.json(); })
        ]).then(function(results) {
            var movieList = (results[0].instances || []).map(function(inst) {
                return { value: 'movie:' + inst.id, label: 'Movie - ' + (inst.name || 'Instance ' + inst.id) };
            });
            var tvList = (results[1].instances || []).map(function(inst) {
                return { value: 'tv:' + inst.id, label: 'TV - ' + (inst.name || 'Instance ' + inst.id) };
            });
            var combined = movieList.concat(tvList);
            combined.sort(function(a, b) { return (a.label || '').localeCompare(b.label || '', undefined, { sensitivity: 'base' }); });
            var currentMovie = results[2].current_instance_id != null ? Number(results[2].current_instance_id) : null;
            var currentTv = results[3].current_instance_id != null ? Number(results[3].current_instance_id) : null;
            selectEl.innerHTML = '';
            if (combined.length === 0) {
                var emptyOpt = document.createElement('option');
                emptyOpt.value = '';
                emptyOpt.textContent = 'No Movie or TV Hunt instances';
                selectEl.appendChild(emptyOpt);
                return;
            }
            combined.forEach(function(item) {
                var opt = document.createElement('option');
                opt.value = item.value;
                opt.textContent = item.label;
                selectEl.appendChild(opt);
            });
            var saved = (typeof localStorage !== 'undefined' && localStorage.getItem('media-hunt-indexers-last-instance')) || '';
            var selected = '';
            if (preferMode === 'movie' && currentMovie != null) {
                selected = 'movie:' + currentMovie;
                if (!combined.some(function(i) { return i.value === selected; })) selected = combined[0].value;
            } else if (preferMode === 'tv' && currentTv != null) {
                selected = 'tv:' + currentTv;
                if (!combined.some(function(i) { return i.value === selected; })) selected = combined[0].value;
            } else if (saved && combined.some(function(i) { return i.value === saved; })) {
                selected = saved;
            } else if (currentMovie != null && combined.some(function(i) { return i.value === 'movie:' + currentMovie; })) {
                selected = 'movie:' + currentMovie;
            } else if (currentTv != null && combined.some(function(i) { return i.value === 'tv:' + currentTv; })) {
                selected = 'tv:' + currentTv;
            } else {
                selected = combined[0].value;
            }
            selectEl.value = selected;
            var parts = (selected || '').split(':');
            if (parts.length === 2) {
                var m = parts[0] === 'tv' ? 'tv' : 'movie';
                if (typeof localStorage !== 'undefined') localStorage.setItem('media-hunt-indexers-last-instance', selected);
                Forms.setCurrentInstanceAndRefreshIndexers(m, parts[1]);
            }
        }).catch(function() {
            selectEl.innerHTML = '<option value="">Failed to load instances</option>';
        });
    };

    Forms.onCombinedIndexersInstanceChange = function() {
        var selectEl = document.getElementById('settings-indexers-instance-select');
        var val = (selectEl && selectEl.value) ? selectEl.value.trim() : '';
        if (!val) return;
        var parts = val.split(':');
        if (parts.length !== 2) return;
        var mode = parts[0] === 'tv' ? 'tv' : 'movie';
        if (typeof localStorage !== 'undefined') localStorage.setItem('media-hunt-indexers-last-instance', val);
        Forms.setCurrentInstanceAndRefreshIndexers(mode, parts[1]);
    };

    Forms.initOrRefreshIndexers = function(preferMode) {
        var selectEl = document.getElementById('settings-indexers-instance-select');
        if (!selectEl) return;
        if (!selectEl._indexersChangeBound) {
            selectEl.addEventListener('change', function() { Forms.onCombinedIndexersInstanceChange(); });
            selectEl._indexersChangeBound = true;
        }
        Forms.populateCombinedIndexersDropdown(preferMode);
    };

    Forms.refreshIndexersList = function() {
        var unifiedGrid = document.getElementById('indexer-instances-grid-unified');
        var legacyGrid = document.getElementById('indexer-instances-grid');

        var apiBase = Forms.getIndexersApiBase();
        fetch(apiBase)
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var list = (data && data.indexers) ? data.indexers : [];
                window.SettingsForms._indexersList = list;

                // Unified grid: all indexers in one list with same sub-stats (API, key, priority)
                var allHtml = '';
                for (var i = 0; i < list.length; i++) {
                    allHtml += window.SettingsForms.renderIndexerCard(list[i], i);
                }
                allHtml += '<div class="add-instance-card" data-app-type="indexer" data-source="indexer-hunt"><div class="add-icon"><i class="fas fa-download" style="color: #6366f1;"></i></div><div class="add-text">Import from Index Master</div></div>';

                if (unifiedGrid) {
                    unifiedGrid.innerHTML = allHtml;
                }

                if (legacyGrid && !unifiedGrid) {
                    var legHtml = '';
                    for (var j = 0; j < list.length; j++) {
                        legHtml += window.SettingsForms.renderIndexerCard(list[j], j);
                    }
                    legHtml += '<div class="add-instance-card" data-app-type="indexer"><div class="add-icon"><i class="fas fa-plus-circle"></i></div><div class="add-text">Add Indexer</div></div>';
                    legacyGrid.innerHTML = legHtml;
                }
            })
            .catch(function() {
                if (unifiedGrid) unifiedGrid.innerHTML = '<div class="add-instance-card" data-app-type="indexer" data-source="indexer-hunt"><div class="add-icon"><i class="fas fa-download" style="color: #6366f1;"></i></div><div class="add-text">Import from Index Master</div></div>';
            });
    };

    function isIndexersUIVisible() {
        var settingsSection = document.getElementById('settingsIndexersSection');
        var indexMasterSection = document.getElementById('indexer-hunt-section');
        return (settingsSection && settingsSection.classList.contains('active')) ||
               (indexMasterSection && indexMasterSection.classList.contains('active'));
    }

    // Delegated Edit/Delete for instance indexer cards (unified and legacy grids)
    function onIndexerGridClick(e) {
        var grid = e.target.closest('#indexer-instances-grid-unified, #indexer-instances-grid');
        if (!grid) return;
        var editBtn = e.target.closest('.btn-card.edit[data-app-type="indexer"]');
        var deleteBtn = e.target.closest('.btn-card.delete[data-app-type="indexer"]');
        if (editBtn) {
            e.preventDefault();
            e.stopPropagation();
            var card = editBtn.closest('.instance-card');
            if (!card) return;
            var index = parseInt(card.getAttribute('data-instance-index'), 10);
            if (isNaN(index)) return;
            var list = window.SettingsForms._indexersList;
            if (!list || index < 0 || index >= list.length) return;
            if (window.SettingsForms.openIndexerEditor) {
                window.SettingsForms.openIndexerEditor(false, index, list[index]);
            }
            return;
        }
        if (deleteBtn) {
            e.preventDefault();
            e.stopPropagation();
            var card = deleteBtn.closest('.instance-card');
            if (!card) return;
            var index = parseInt(card.getAttribute('data-instance-index'), 10);
            if (isNaN(index)) return;
            var list = window.SettingsForms._indexersList;
            if (!list || index < 0 || index >= list.length) return;
            var indexer = list[index];
            var name = (indexer && indexer.name) ? indexer.name : 'Unnamed';
            var isTV = Forms._indexersMode === 'tv';
            var deleteId = isTV && indexer && indexer.id ? indexer.id : index;
            if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
                window.HuntarrConfirm.show({
                    title: 'Delete Indexer',
                    message: 'Are you sure you want to remove "' + name + '" from this instance? It will no longer be used for searches.',
                    confirmLabel: 'Delete',
                    onConfirm: function() {
                        var apiBase = Forms.getIndexersApiBase();
                        var url = apiBase + '/' + encodeURIComponent(String(deleteId));
                        fetch(url, { method: 'DELETE' })
                            .then(function(r) { return r.json(); })
                            .then(function(data) {
                                if (data.success !== false) {
                                    if (window.SettingsForms && window.SettingsForms.refreshIndexersList) {
                                        window.SettingsForms.refreshIndexersList();
                                    }
                                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                                        window.huntarrUI.showNotification('Indexer removed.', 'success');
                                    }
                                    if (window.IndexerHunt && window.IndexerHunt._refreshIndexerInstanceStatus) {
                                        window.IndexerHunt._refreshIndexerInstanceStatus();
                                    }
                                } else {
                                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                                        window.huntarrUI.showNotification(data.error || 'Failed to remove indexer.', 'error');
                                    }
                                }
                            })
                            .catch(function() {
                                if (window.huntarrUI && window.huntarrUI.showNotification) {
                                    window.huntarrUI.showNotification('Failed to remove indexer.', 'error');
                                }
                            });
                    }
                });
            }
        }
    }

    document.addEventListener('click', onIndexerGridClick, true);

    document.addEventListener('huntarr:instances-changed', function() {
        if (isIndexersUIVisible()) Forms.initOrRefreshIndexers();
    });
    document.addEventListener('huntarr:tv-hunt-instances-changed', function() {
        if (isIndexersUIVisible()) Forms.initOrRefreshIndexers();
    });
})();


/* === modules/features/settings/media-hunt-profiles.js === */
/**
 * Media Hunt Profiles – single page for Movie Hunt and TV Hunt profiles.
 * One combined instance dropdown: "Movie - Instance Name" and "TV - Instance Name", alphabetical.
 * Both Movie Hunt and TV Hunt sidebars link to this same page (#settings-profiles and #tv-hunt-settings-profiles).
 */
(function() {
    'use strict';

    window.MediaHuntProfiles = window.MediaHuntProfiles || {};
    const M = window.MediaHuntProfiles;
    M._profilesList = [];
    M._combinedDropdownPopulated = false;

    function getMode() {
        return window._mediaHuntProfilesMode === 'tv' ? 'tv' : 'movie';
    }

    function getApiBase() {
        return getMode() === 'tv' ? './api/tv-hunt/profiles' : './api/profiles';
    }

    function getInstanceApiBase(mode) {
        return mode === 'tv' ? './api/tv-hunt' : './api/movie-hunt';
    }

    M.renderCard = function(profile, index, mode) {
        var m = mode || getMode();
        var isDefault = Boolean(profile && profile.is_default);
        var name = (profile && profile.name) ? String(profile.name).replace(/</g, '&lt;').replace(/>/g, '&gt;') : 'Unnamed';
        var profileId = (profile && profile.id) ? String(profile.id).replace(/"/g, '&quot;') : '';
        var qualities = Array.isArray(profile && profile.qualities) ? profile.qualities : [];
        var checkedOrder = [];
        qualities.forEach(function(q) {
            if (q && q.enabled !== false) {
                var n = (q.name || q.id || '').trim();
                if (n) checkedOrder.push(n);
            }
        });
        var tagsHtml = '';
        checkedOrder.forEach(function(qName, i) {
            var esc = String(qName).replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
            var goldClass = (i === 0) ? ' profile-quality-tag-highest' : '';
            tagsHtml += '<span class="profile-quality-tag' + goldClass + '">' + esc + '</span>';
        });
        if (tagsHtml === '') {
            tagsHtml = '<span class="profile-quality-tag profile-quality-tag-empty">No qualities</span>';
        }
        var dataAttrs = m === 'tv'
            ? ' data-profile-id="' + profileId + '" data-profile-mode="tv"'
            : ' data-instance-index="' + index + '" data-profile-mode="movie"';
        return '<div class="instance-card ' + (isDefault ? 'default-instance' : '') + '" data-app-type="media-hunt-profile"' + dataAttrs + '>' +
            '<div class="instance-card-header">' +
            '<div class="instance-name instance-name-with-priority"><i class="fas fa-id-card"></i><span>' + name + '</span>' + (isDefault ? '<span class="default-badge">Default</span>' : '') + '</div>' +
            '<div class="instance-card-header-actions">' +
            '<button type="button" class="btn-icon btn-clone-profile" data-app-type="media-hunt-profile"' + (m === 'tv' ? ' data-profile-id="' + profileId + '"' : ' data-instance-index="' + index + '"') + ' data-profile-mode="' + m + '" title="Duplicate profile" aria-label="Duplicate profile"><i class="fas fa-clone"></i></button>' +
            '</div></div>' +
            '<div class="instance-card-body"><div class="profile-card-quality-tags">' + tagsHtml + '</div></div>' +
            '<div class="instance-card-footer">' +
            '<button type="button" class="btn-card edit" data-app-type="media-hunt-profile"' + (m === 'tv' ? ' data-profile-id="' + profileId + '"' : ' data-instance-index="' + index + '"') + ' data-profile-mode="' + m + '"><i class="fas fa-edit"></i> Edit</button>' +
            (isDefault ? '' : '<button type="button" class="btn-card set-default" data-app-type="media-hunt-profile"' + (m === 'tv' ? ' data-profile-id="' + profileId + '"' : ' data-instance-index="' + index + '"') + ' data-profile-mode="' + m + '"><i class="fas fa-star"></i> Default</button>') +
            '<button type="button" class="btn-card delete" data-app-type="media-hunt-profile"' + (m === 'tv' ? ' data-profile-id="' + profileId + '"' : ' data-instance-index="' + index + '"') + ' data-profile-mode="' + m + '"><i class="fas fa-trash"></i> Delete</button>' +
            '</div></div>';
    };

    function setCurrentInstanceAndRefresh(mode, instanceId) {
        var apiBase = getInstanceApiBase(mode);
        window._mediaHuntProfilesMode = mode;
        fetch(apiBase + '/instances/current', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ instance_id: parseInt(instanceId, 10) })
        }).then(function(r) { return r.json(); }).then(function() {
            M.refreshProfilesList(mode);
        }).catch(function() {
            M.refreshProfilesList(mode);
        });
    }

    function safeJsonFetch(url, fallback) {
        return fetch(url, { cache: 'no-store' }).then(function(r) { return r.json(); }).catch(function() { return fallback || {}; });
    }

    function populateCombinedInstanceDropdown(preferMode) {
        var selectEl = document.getElementById('media-hunt-profiles-instance-select');
        if (!selectEl) return;
        selectEl.innerHTML = '<option value="">Loading...</option>';
        var ts = Date.now();
        Promise.all([
            safeJsonFetch('./api/movie-hunt/instances?t=' + ts, { instances: [] }),
            safeJsonFetch('./api/tv-hunt/instances?t=' + ts, { instances: [] }),
            safeJsonFetch('./api/movie-hunt/instances/current?t=' + ts, { current_instance_id: null }),
            safeJsonFetch('./api/tv-hunt/instances/current?t=' + ts, { current_instance_id: null }),
            safeJsonFetch('./api/indexer-hunt/indexers?t=' + ts, { indexers: [] }),
            safeJsonFetch('./api/movie-hunt/has-clients?t=' + ts, { has_clients: false })
        ]).then(function(results) {
            var movieList = (results[0].instances || []).map(function(inst) {
                return { value: 'movie:' + inst.id, label: 'Movie - ' + (inst.name || 'Instance ' + inst.id) };
            });
            var tvList = (results[1].instances || []).map(function(inst) {
                return { value: 'tv:' + inst.id, label: 'TV - ' + (inst.name || 'Instance ' + inst.id) };
            });
            var combined = movieList.concat(tvList);
            combined.sort(function(a, b) { return (a.label || '').localeCompare(b.label || '', undefined, { sensitivity: 'base' }); });
            var currentMovie = results[2].current_instance_id != null ? Number(results[2].current_instance_id) : null;
            var currentTv = results[3].current_instance_id != null ? Number(results[3].current_instance_id) : null;
            selectEl.innerHTML = '';
            if (combined.length === 0) {
                var emptyOpt = document.createElement('option');
                emptyOpt.value = '';
                emptyOpt.textContent = 'No Movie or TV Hunt instances';
                selectEl.appendChild(emptyOpt);
                var wrapperEl = document.getElementById('media-hunt-profiles-content-wrapper');
                if (wrapperEl) wrapperEl.style.display = '';
                M._combinedDropdownPopulated = true;
                return;
            }
            combined.forEach(function(item) {
                var opt = document.createElement('option');
                opt.value = item.value;
                opt.textContent = item.label;
                selectEl.appendChild(opt);
            });
            var saved = (typeof localStorage !== 'undefined' && localStorage.getItem('media-hunt-profiles-last-instance')) || '';
            var selected = '';
            if (preferMode === 'movie' && currentMovie != null) {
                selected = 'movie:' + currentMovie;
                if (!combined.some(function(i) { return i.value === selected; })) selected = combined[0].value;
            } else if (preferMode === 'tv' && currentTv != null) {
                selected = 'tv:' + currentTv;
                if (!combined.some(function(i) { return i.value === selected; })) selected = combined[0].value;
            } else if (saved && combined.some(function(i) { return i.value === saved; })) {
                selected = saved;
            } else if (currentMovie != null && combined.some(function(i) { return i.value === 'movie:' + currentMovie; })) {
                selected = 'movie:' + currentMovie;
            } else if (currentTv != null && combined.some(function(i) { return i.value === 'tv:' + currentTv; })) {
                selected = 'tv:' + currentTv;
            } else {
                selected = combined[0].value;
            }
            selectEl.value = selected;
            M._combinedDropdownPopulated = true;
            var wrapperEl = document.getElementById('media-hunt-profiles-content-wrapper');
            if (wrapperEl) wrapperEl.style.display = '';
            var parts = (selected || '').split(':');
            if (parts.length === 2) {
                var m = parts[0] === 'tv' ? 'tv' : 'movie';
                if (typeof localStorage !== 'undefined') localStorage.setItem('media-hunt-profiles-last-instance', selected);
                setCurrentInstanceAndRefresh(m, parts[1]);
            }
        }).catch(function() {
            selectEl.innerHTML = '<option value="">Failed to load instances</option>';
            var wrapperEl = document.getElementById('media-hunt-profiles-content-wrapper');
            if (wrapperEl) wrapperEl.style.display = '';
            M._combinedDropdownPopulated = true;
        });
    }

    function onCombinedInstanceChange() {
        var selectEl = document.getElementById('media-hunt-profiles-instance-select');
        var val = (selectEl && selectEl.value) ? selectEl.value.trim() : '';
        if (!val) return;
        var parts = val.split(':');
        if (parts.length !== 2) return;
        var mode = parts[0] === 'tv' ? 'tv' : 'movie';
        if (typeof localStorage !== 'undefined') localStorage.setItem('media-hunt-profiles-last-instance', val);
        setCurrentInstanceAndRefresh(mode, parts[1]);
    }

    M.refreshProfilesList = function(mode) {
        var m = (mode === 'tv' || mode === 'movie') ? mode : getMode();
        window._mediaHuntProfilesMode = m;

        var grid = document.getElementById('media-hunt-profiles-grid');
        var subtitle = document.getElementById('media-hunt-profiles-subtitle');
        if (subtitle) {
            subtitle.textContent = 'Quality profiles for the selected instance.';
        }

        if (!grid) return;
        var apiBase = m === 'tv' ? './api/tv-hunt/profiles' : './api/profiles';
        fetch(apiBase, { cache: m === 'tv' ? 'no-store' : 'default' })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var list = (data && data.profiles) ? data.profiles : [];
                M._profilesList = list;
                if (m === 'movie' && window.SettingsForms) window.SettingsForms._profilesList = list;
                var html = '';
                for (var i = 0; i < list.length; i++) {
                    html += M.renderCard(list[i], i, m);
                }
                html += '<div class="add-instance-card" data-app-type="media-hunt-profile"><div class="add-icon"><i class="fas fa-plus-circle"></i></div><div class="add-text">Add Profile</div></div>';
                grid.innerHTML = html;
            })
            .catch(function() {
                grid.innerHTML = '<div class="add-instance-card" data-app-type="media-hunt-profile"><div class="add-icon"><i class="fas fa-plus-circle"></i></div><div class="add-text">Add Profile</div></div>';
            });
    };

    M.initOrRefresh = function(preferMode) {
        var selectEl = document.getElementById('media-hunt-profiles-instance-select');
        if (!selectEl) return;
        if (!selectEl._mediaHuntProfilesChangeBound) {
            selectEl.addEventListener('change', onCombinedInstanceChange);
            selectEl._mediaHuntProfilesChangeBound = true;
        }
        var backBtn = document.getElementById('media-hunt-profiles-back');
        if (backBtn && !backBtn._mediaHuntProfilesBackBound) {
            backBtn.onclick = function() {
                if (window.huntarrUI && window.huntarrUI.switchSection) {
                    window.huntarrUI.switchSection('media-hunt-instances');
                }
            };
            backBtn._mediaHuntProfilesBackBound = true;
        }
        populateCombinedInstanceDropdown(preferMode);
    };

    function openAddModal() {
        var modal = document.getElementById('media-hunt-profile-add-modal');
        var input = document.getElementById('media-hunt-profile-add-name');
        var sub = document.getElementById('media-hunt-profile-add-subtitle');
        if (sub) sub.textContent = getMode() === 'tv' ? 'Enter a name for the new TV Hunt profile.' : 'Enter a name for the new profile.';
        if (modal && modal.parentNode !== document.body) document.body.appendChild(modal);
        if (modal) modal.style.display = 'flex';
        if (input) { input.value = ''; setTimeout(function() { input.focus(); }, 100); }
        document.body.classList.add('profile-add-modal-open');
    }

    function closeAddModal() {
        var modal = document.getElementById('media-hunt-profile-add-modal');
        if (modal) modal.style.display = 'none';
        document.body.classList.remove('profile-add-modal-open');
    }

    function initAddModal() {
        var backdrop = document.getElementById('media-hunt-profile-add-modal-backdrop');
        var closeBtn = document.getElementById('media-hunt-profile-add-modal-close');
        var cancelBtn = document.getElementById('media-hunt-profile-add-modal-cancel');
        var saveBtn = document.getElementById('media-hunt-profile-add-modal-save');
        var input = document.getElementById('media-hunt-profile-add-name');
        if (backdrop) backdrop.onclick = closeAddModal;
        if (closeBtn) closeBtn.onclick = closeAddModal;
        if (cancelBtn) cancelBtn.onclick = closeAddModal;
        if (saveBtn) {
            saveBtn.onclick = function() {
                var name = (input && input.value) ? input.value.trim() : '';
                if (!name) {
                    if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Enter a profile name.', 'error');
                    return;
                }
                saveBtn.disabled = true;
                var apiBase = getApiBase();
                fetch(apiBase, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name }) })
                    .then(function(r) { return r.json(); })
                    .then(function(data) {
                        if (data.success) M.refreshProfilesList(getMode());
                        if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Profile added.', 'success');
                        closeAddModal();
                    })
                    .catch(function() {
                        if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Failed to add profile.', 'error');
                    })
                    .finally(function() { saveBtn.disabled = false; });
            };
        }
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' && document.getElementById('media-hunt-profile-add-modal') && document.getElementById('media-hunt-profile-add-modal').style.display === 'flex')
                closeAddModal();
        });
    }

    function initGrid() {
        var grid = document.getElementById('media-hunt-profiles-grid');
        if (!grid) return;
        grid.addEventListener('click', function(e) {
            var addCard = e.target.closest('.add-instance-card[data-app-type="media-hunt-profile"]');
            var cloneBtn = e.target.closest('.btn-clone-profile[data-app-type="media-hunt-profile"]');
            var editBtn = e.target.closest('.btn-card.edit[data-app-type="media-hunt-profile"]');
            var setDefaultBtn = e.target.closest('.btn-card.set-default[data-app-type="media-hunt-profile"]');
            var deleteBtn = e.target.closest('.btn-card.delete[data-app-type="media-hunt-profile"]');
            var m = getMode();
            var apiBase = getApiBase();

            if (cloneBtn) {
                e.preventDefault();
                e.stopPropagation();
                if (m === 'tv') {
                    var profileId = cloneBtn.getAttribute('data-profile-id');
                    if (!profileId) return;
                    fetch('./api/tv-hunt/profiles/' + encodeURIComponent(profileId) + '/clone', { method: 'POST' })
                        .then(function(r) { return r.json(); })
                        .then(function(data) {
                            if (data.success) M.refreshProfilesList('tv');
                            if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Profile duplicated.', 'success');
                        })
                        .catch(function() {
                            if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Failed to duplicate profile.', 'error');
                        });
                } else {
                    var index = parseInt(cloneBtn.getAttribute('data-instance-index'), 10);
                    fetch('./api/profiles/' + index + '/clone', { method: 'POST' })
                        .then(function(r) { return r.json(); })
                        .then(function(data) {
                            if (data.success) M.refreshProfilesList('movie');
                            if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Profile duplicated.', 'success');
                        })
                        .catch(function() {
                            if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Failed to duplicate profile.', 'error');
                        });
                }
            } else if (editBtn) {
                e.preventDefault();
                if (m === 'tv') {
                    var profileId = editBtn.getAttribute('data-profile-id');
                    if (profileId && window.SettingsForms && window.SettingsForms.openTVHuntProfileEditor)
                        window.SettingsForms.openTVHuntProfileEditor(profileId);
                } else {
                    var index = parseInt(editBtn.getAttribute('data-instance-index'), 10);
                    if (window.SettingsForms && window.SettingsForms.openProfileEditor)
                        window.SettingsForms.openProfileEditor(index);
                }
            } else if (addCard) {
                e.preventDefault();
                openAddModal();
            } else if (setDefaultBtn) {
                e.preventDefault();
                if (m === 'tv') {
                    var profileId = setDefaultBtn.getAttribute('data-profile-id');
                    if (!profileId) return;
                    fetch('./api/tv-hunt/profiles/' + encodeURIComponent(profileId), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_default: true }) })
                        .then(function(r) { return r.json(); })
                        .then(function(data) {
                            if (data.success) M.refreshProfilesList('tv');
                            if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Default profile updated.', 'success');
                        })
                        .catch(function() {
                            if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Failed to update.', 'error');
                        });
                } else {
                    var index = parseInt(setDefaultBtn.getAttribute('data-instance-index'), 10);
                    fetch('./api/profiles/' + index, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_default: true }) })
                        .then(function(r) { return r.json(); })
                        .then(function(data) {
                            if (data.success) M.refreshProfilesList('movie');
                            if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Default profile updated.', 'success');
                        })
                        .catch(function() {
                            if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Failed to update.', 'error');
                        });
                }
            } else if (deleteBtn) {
                e.preventDefault();
                var list = M._profilesList || [];
                var name = 'this profile';
                var doDelete = function() {
                    if (m === 'tv') {
                        var profileId = deleteBtn.getAttribute('data-profile-id');
                        if (!profileId) return;
                        fetch('./api/tv-hunt/profiles/' + encodeURIComponent(profileId), { method: 'DELETE' })
                            .then(function(r) { return r.json(); })
                            .then(function(data) {
                                if (data.success) M.refreshProfilesList('tv');
                                if (window.huntarrUI && window.huntarrUI.showNotification)
                                    window.huntarrUI.showNotification(data.success ? 'Profile deleted.' : (data.error || 'Could not delete.'), data.success ? 'success' : 'error');
                            })
                            .catch(function() {
                                if (window.huntarrUI && window.huntarrUI.showNotification)
                                    window.huntarrUI.showNotification('Failed to delete profile.', 'error');
                            });
                    } else {
                        var index = parseInt(deleteBtn.getAttribute('data-instance-index'), 10);
                        fetch('./api/profiles/' + index, { method: 'DELETE' })
                            .then(function(r) { return r.json(); })
                            .then(function(data) {
                                if (data.success) M.refreshProfilesList('movie');
                                if (window.huntarrUI && window.huntarrUI.showNotification)
                                    window.huntarrUI.showNotification(data.success ? 'Profile deleted.' : (data.error || 'Could not delete.'), data.success ? 'success' : 'error');
                            })
                            .catch(function() {
                                if (window.huntarrUI && window.huntarrUI.showNotification)
                                    window.huntarrUI.showNotification('Failed to delete profile.', 'error');
                            });
                    }
                };
                if (m === 'tv') {
                    var profileId = deleteBtn.getAttribute('data-profile-id');
                    var profile = list.find(function(p) { return p.id === profileId; });
                    if (profile && profile.name) name = profile.name;
                } else {
                    var index = parseInt(deleteBtn.getAttribute('data-instance-index'), 10);
                    var profile = list[index];
                    if (profile && profile.name) name = profile.name;
                }
                if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
                    window.HuntarrConfirm.show({ title: 'Delete Profile', message: 'Delete "' + name + '"?', confirmLabel: 'Delete', onConfirm: doDelete });
                } else {
                    if (!confirm('Delete "' + name + '"?')) return;
                    doDelete();
                }
            }
        });
    }

    document.addEventListener('huntarr:instances-changed', function() {
        if (document.getElementById('mediaHuntProfilesSection') && document.getElementById('mediaHuntProfilesSection').classList.contains('active')) {
            M.initOrRefresh();
        }
    });
    document.addEventListener('huntarr:tv-hunt-instances-changed', function() {
        if (document.getElementById('mediaHuntProfilesSection') && document.getElementById('mediaHuntProfilesSection').classList.contains('active')) {
            M.initOrRefresh();
        }
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() { initAddModal(); initGrid(); });
    } else {
        initAddModal();
        initGrid();
    }
})();


/* === modules/features/settings/profile-editor.js === */
/**
 * Profile editor (Movie Hunt) - full-page editor like instance editor.
 * Open from Profiles list Edit; Back/Save; sections: Profile details, Upgrade & quality, Qualities.
 * Attaches to window.SettingsForms.
 */
(function() {
    'use strict';
    if (typeof window.SettingsForms === 'undefined') return;

    const Forms = window.SettingsForms;

    function escapeHtml(s) {
        if (s == null) return '';
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function generateProfileEditorHtml(profile) {
        const p = profile || {};
        const name = escapeHtml((p.name || '').trim() || 'Unnamed');
        const isDefault = Boolean(p.is_default);
        const upgradesAllowed = p.upgrades_allowed !== false;
        const upgradeUntil = escapeHtml((p.upgrade_until_quality || 'WEB 2160p').trim());
        const minScore = p.min_custom_format_score != null ? Number(p.min_custom_format_score) : -10000;
        const untilScore = p.upgrade_until_custom_format_score != null ? Number(p.upgrade_until_custom_format_score) : 5500;
        const increment = p.upgrade_score_increment != null ? Number(p.upgrade_score_increment) : 100;
        const language = escapeHtml((p.language || 'English').trim());
        const qualities = Array.isArray(p.qualities) ? p.qualities : [];
        var checkedQualityNames = [];
        qualities.forEach(function(q) {
            if (q.enabled !== false) {
                var n = (q.name || q.id || '').trim();
                if (n) checkedQualityNames.push(n);
            }
        });
        if (checkedQualityNames.length === 0) {
            checkedQualityNames = ['WEB 2160p', 'WEB 1080p', 'WEB 720p'];
        }
        let qualitiesHtml = '';
        qualities.forEach(function(q, i) {
            const qName = escapeHtml((q.name || q.id || '').trim() || 'Quality');
            const checked = q.enabled !== false ? ' checked' : '';
            qualitiesHtml += '<div class="profile-quality-item" data-quality-id="' + escapeHtml(String(q.id || i)) + '" data-order="' + (q.order != null ? q.order : i) + '" draggable="true">' +
                '<span class="quality-drag-handle" title="Drag to reorder"><i class="fas fa-grip-vertical"></i></span>' +
                '<input type="checkbox" id="profile-quality-' + i + '" class="profile-quality-checkbox"' + checked + '>' +
                '<label class="quality-name" for="profile-quality-' + i + '">' + qName + '</label>' +
                '</div>';
        });
        var upgradeSelectOptions = '';
        checkedQualityNames.forEach(function(opt) {
            var sel = opt === (p.upgrade_until_quality || 'WEB 2160p').trim() ? ' selected' : '';
            upgradeSelectOptions += '<option value="' + escapeHtml(opt) + '"' + sel + '>' + escapeHtml(opt) + '</option>';
        });
        if (upgradeSelectOptions === '') {
            upgradeSelectOptions = '<option value="WEB 2160p">WEB 2160p</option>';
        }

        return '<div class="editor-grid">' +
            '<div class="editor-section">' +
            '<div class="editor-section-title">Profile details</div>' +
            '<div class="editor-field-group">' +
            '<div class="editor-setting-item"><label for="profile-editor-name">Name</label>' +
            '<input type="text" id="profile-editor-name" value="' + name + '" placeholder="Profile name" maxlength="64">' +
            '</div><p class="editor-help-text">A friendly name for this profile</p></div>' +
            '<div class="editor-field-group">' +
            '<div class="editor-setting-item flex-row">' +
            '<label for="profile-editor-default">Set as default profile</label>' +
            '<label class="toggle-switch"><input type="checkbox" id="profile-editor-default"' + (isDefault ? ' checked' : '') + '><span class="toggle-slider"></span></label>' +
            '</div><p class="editor-help-text">The default profile is used when no other is selected</p></div>' +
            '</div>' +
            '<div class="editor-section">' +
            '<div class="editor-section-title">Upgrade &amp; quality</div>' +
            '<div class="editor-field-group">' +
            '<div class="editor-setting-item flex-row">' +
            '<label for="profile-editor-upgrades">Upgrades allowed</label>' +
            '<label class="toggle-switch"><input type="checkbox" id="profile-editor-upgrades"' + (upgradesAllowed ? ' checked' : '') + '><span class="toggle-slider"></span></label>' +
            '</div><p class="editor-help-text">If disabled, qualities will not be upgraded</p></div>' +
            '<div class="editor-field-group">' +
            '<div class="editor-setting-item"><label for="profile-editor-upgrade-until">Upgrade until</label>' +
            '<select id="profile-editor-upgrade-until">' + upgradeSelectOptions + '</select>' +
            '</div><p class="editor-help-text">Once this quality is reached, no further upgrades will be grabbed</p></div>' +
            '<div class="editor-field-group">' +
            '<div class="editor-setting-item"><label for="profile-editor-min-score">Minimum custom format score</label>' +
            '<input type="number" id="profile-editor-min-score" value="' + minScore + '" min="-100000" max="100000">' +
            '</div><p class="editor-help-text">Minimum custom format score allowed to download</p></div>' +
            '<div class="editor-field-group">' +
            '<div class="editor-setting-item"><label for="profile-editor-until-score">Upgrade until custom format score</label>' +
            '<input type="number" id="profile-editor-until-score" value="' + untilScore + '" min="0" max="100000">' +
            '</div><p class="editor-help-text">Once quality cutoff is met, upgrades stop when this score is reached</p></div>' +
            '<div class="editor-field-group">' +
            '<div class="editor-setting-item"><label for="profile-editor-increment">Minimum custom format score increment</label>' +
            '<input type="number" id="profile-editor-increment" value="' + increment + '" min="0" max="10000">' +
            '</div><p class="editor-help-text">Minimum improvement in score between existing and new release to consider an upgrade</p></div>' +
            '<div class="editor-field-group">' +
            '<div class="editor-setting-item"><label for="profile-editor-language">Language</label>' +
            '<input type="text" id="profile-editor-language" value="' + language + '" placeholder="English" maxlength="64">' +
            '</div><p class="editor-help-text">Language for releases</p></div>' +
            '</div>' +
            '<div class="editor-section">' +
            '<div class="editor-section-title">Qualities</div>' +
            '<p class="editor-help-text" style="margin-bottom: 12px;">Only checked qualities are wanted. Higher in the list is more preferred.</p>' +
            '<div class="profile-quality-list" id="profile-editor-qualities">' + (qualitiesHtml || '<p class="editor-help-text">No qualities defined.</p>') + '</div>' +
            '</div>' +
            '<div class="editor-section profile-editor-scores-section">' +
            '<div class="editor-section-title">Custom format scores</div>' +
            '<p class="editor-help-text" style="margin-bottom: 12px;">Hunt Manager uses these scores to decide which release to grab. Higher total score means a better release. Start at 0; use the Recommend column (from <a href="https://trash-guides.info/Radarr/Radarr-collection-of-custom-formats/" target="_blank" rel="noopener">TRaSH Guides</a>) as a guide if you want. To incorporate customized formats for your movies, <a href="./#settings-custom-formats" class="editor-inline-link">visit Custom Formats</a>.</p>' +
            '<div class="profile-editor-scores-container">' +
            '<table class="profile-editor-scores-table"><thead><tr><th>Custom format</th><th class="th-score">Your score</th><th class="th-recommended">Recommend</th></tr></thead>' +
            '<tbody id="profile-editor-scores-tbody"></tbody></table>' +
            '<p id="profile-editor-scores-empty" class="profile-editor-scores-empty" style="display: none;">No custom formats added yet. Add them under Movie Hunt &rarr; Custom Formats, then set scores here.</p>' +
            '</div></div></div>';
    }

    let _profileEditorScoresList = [];
    let _profileEditorScoresSortTimeout = null;
    let _profileEditorDirty = false;

    function renderProfileEditorScoresTable() {
        const tbody = document.getElementById('profile-editor-scores-tbody');
        const emptyEl = document.getElementById('profile-editor-scores-empty');
        const table = document.querySelector('.profile-editor-scores-table');
        if (!tbody || _profileEditorScoresList.length === 0) {
            if (tbody) tbody.innerHTML = '';
            if (emptyEl) emptyEl.style.display = 'block';
            if (table) table.style.display = 'none';
            return;
        }
        const sorted = _profileEditorScoresList.slice().sort(function(a, b) { return (b.score - a.score); });
        let html = '';
        for (let i = 0; i < sorted.length; i++) {
            const item = sorted[i];
            const title = (item.title || item.name || 'Unnamed').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const rec = item.recommended_score;
            const recText = (rec != null && !isNaN(rec)) ? String(rec) : '—';
            html += '<tr data-index="' + item.index + '"><td><span class="custom-format-score-name">' + title + '</span></td>' +
                '<td><input type="number" class="profile-editor-score-input" data-index="' + item.index + '" value="' + item.score + '" min="-100000" max="100000" step="1"></td>' +
                '<td><span class="recommended-value">' + recText + '</span></td></tr>';
        }
        tbody.innerHTML = html;
        tbody.querySelectorAll('.profile-editor-score-input').forEach(function(input) {
            function scheduleSort(idx) {
                if (_profileEditorScoresSortTimeout) clearTimeout(_profileEditorScoresSortTimeout);
                _profileEditorScoresSortTimeout = setTimeout(function() {
                    _profileEditorScoresSortTimeout = null;
                    renderProfileEditorScoresTable();
                }, 2000);
            }
            input.addEventListener('input', function() {
                const idx = parseInt(input.getAttribute('data-index'), 10);
                if (isNaN(idx)) return;
                let val = parseInt(input.value, 10);
                if (isNaN(val)) val = 0;
                const item = _profileEditorScoresList.find(function(o) { return o.index === idx; });
                if (item) item.score = val;
                markProfileEditorDirty();
                scheduleSort(idx);
            });
            input.addEventListener('change', function() {
                const idx = parseInt(input.getAttribute('data-index'), 10);
                if (isNaN(idx)) return;
                let val = parseInt(input.value, 10);
                if (isNaN(val)) val = 0;
                const item = _profileEditorScoresList.find(function(o) { return o.index === idx; });
                if (item) item.score = val;
                markProfileEditorDirty();
                scheduleSort(idx);
            });
        });
    }

    function loadProfileEditorScoresTable() {
        const tbody = document.getElementById('profile-editor-scores-tbody');
        const emptyEl = document.getElementById('profile-editor-scores-empty');
        const table = document.querySelector('.profile-editor-scores-table');
        if (!tbody) return;
        var state = Forms._currentProfileEditing;
        var apiUrl = (state && state.tvHunt) ? './api/tv-hunt/custom-formats' : './api/custom-formats';
        fetch(apiUrl)
            .then(function(r) { return r.json(); })
            .then(function(data) {
                const list = (data && data.custom_formats) ? data.custom_formats : [];
                if (list.length === 0) {
                    _profileEditorScoresList = [];
                    tbody.innerHTML = '';
                    if (emptyEl) emptyEl.style.display = 'block';
                    if (table) table.style.display = 'none';
                    return;
                }
                if (emptyEl) emptyEl.style.display = 'none';
                if (table) table.style.display = 'table';
                _profileEditorScoresList = list.map(function(item, i) {
                    let score = item.score != null ? Number(item.score) : 0;
                    if (isNaN(score)) score = 0;
                    return {
                        index: i,
                        title: item.title || item.name || 'Unnamed',
                        name: item.name || 'Unnamed',
                        recommended_score: item.recommended_score != null ? item.recommended_score : item.recommended,
                        score: score
                    };
                });
                renderProfileEditorScoresTable();
            })
            .catch(function() {
                _profileEditorScoresList = [];
                tbody.innerHTML = '';
                if (emptyEl) emptyEl.style.display = 'block';
                if (table) table.style.display = 'none';
            });
    }

    function saveProfileEditorScores() {
        if (!_profileEditorScoresList || _profileEditorScoresList.length === 0) return Promise.resolve();
        const tbody = document.getElementById('profile-editor-scores-tbody');
        if (!tbody) return Promise.resolve();
        const rows = tbody.querySelectorAll('tr[data-index]');
        var scores = _profileEditorScoresList.slice().map(function(o) { return o.score; });
        rows.forEach(function(row) {
            const idx = parseInt(row.getAttribute('data-index'), 10);
            const input = row.querySelector('.profile-editor-score-input');
            if (isNaN(idx) || idx < 0 || idx >= scores.length || !input) return;
            let val = parseInt(input.value, 10);
            if (isNaN(val)) val = 0;
            scores[idx] = val;
        });
        var state = Forms._currentProfileEditing;
        var scoresUrl = (state && state.tvHunt) ? './api/tv-hunt/custom-formats/scores' : './api/custom-formats/scores';
        return fetch(scoresUrl, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scores: scores })
        }).then(function(r) { return r.json(); });
    }

    function markProfileEditorDirty() {
        _profileEditorDirty = true;
        const saveBtn = document.getElementById('profile-editor-save');
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.classList.add('enabled');
        }
    }

    function confirmLeaveProfileEditor(done) {
        if (!_profileEditorDirty) {
            if (typeof done === 'function') done('discard');
            return true;
        }
        if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
            window.HuntarrConfirm.show({
                title: 'Unsaved Changes',
                message: 'You have unsaved changes that will be lost if you leave.',
                confirmLabel: 'Go Back',
                cancelLabel: 'Leave',
                onConfirm: function() {
                    // Stay on the editor — modal just closes, user can save manually
                },
                onCancel: function() {
                    if (typeof done === 'function') done('discard');
                }
            });
        } else {
            if (!confirm('You have unsaved changes that will be lost. Leave anyway?')) return;
            if (typeof done === 'function') done('discard');
        }
        return false;
    }

    function getCheckedQualityNamesInOrder() {
        const list = document.getElementById('profile-editor-qualities');
        if (!list) return [];
        const items = list.querySelectorAll('.profile-quality-item');
        var names = [];
        items.forEach(function(item) {
            var cb = item.querySelector('.profile-quality-checkbox');
            var label = item.querySelector('.quality-name');
            if (cb && cb.checked && label) {
                var n = (label.textContent || '').trim();
                if (n) names.push(n);
            }
        });
        return names;
    }

    function refreshProfileEditorUpgradeUntilOptions() {
        const select = document.getElementById('profile-editor-upgrade-until');
        if (!select) return;
        const names = getCheckedQualityNamesInOrder();
        const currentValue = (select.value || '').trim();
        var optionsHtml = '';
        names.forEach(function(n) {
            var sel = n === currentValue ? ' selected' : '';
            optionsHtml += '<option value="' + n.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') + '"' + sel + '>' + n.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</option>';
        });
        if (optionsHtml === '') {
            optionsHtml = '<option value="">No qualities checked</option>';
        }
        select.innerHTML = optionsHtml;
        if (names.length > 0 && (currentValue === '' || names.indexOf(currentValue) === -1)) {
            select.value = names[0];
        }
    }

    function setupProfileEditorChangeDetection() {
        const content = document.getElementById('profile-editor-content');
        const saveBtn = document.getElementById('profile-editor-save');
        if (!content || !saveBtn) return;
        content.querySelectorAll('input:not(.profile-quality-checkbox), select').forEach(function(el) {
            el.addEventListener('input', markProfileEditorDirty);
            el.addEventListener('change', markProfileEditorDirty);
        });
        var qualitiesList = document.getElementById('profile-editor-qualities');
        if (qualitiesList) {
            qualitiesList.addEventListener('change', function(e) {
                if (e.target && e.target.classList.contains('profile-quality-checkbox')) {
                    markProfileEditorDirty();
                    refreshProfileEditorUpgradeUntilOptions();
                }
            });
        }
    }

    function setupProfileQualitiesDragDrop() {
        const list = document.getElementById('profile-editor-qualities');
        if (!list) return;
        const items = list.querySelectorAll('.profile-quality-item');
        if (items.length === 0) return;
        let draggedEl = null;
        items.forEach(function(item) {
            item.setAttribute('draggable', 'true');
            item.addEventListener('dragstart', function(e) {
                draggedEl = item;
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', item.getAttribute('data-quality-id') || '');
                e.dataTransfer.setData('text/html', item.outerHTML);
                item.classList.add('profile-quality-dragging');
                e.dataTransfer.setDragImage(item, 0, 0);
            });
            item.addEventListener('dragend', function() {
                item.classList.remove('profile-quality-dragging');
                list.querySelectorAll('.profile-quality-item').forEach(function(el) {
                    el.classList.remove('profile-quality-drag-over');
                });
                draggedEl = null;
            });
            item.addEventListener('dragover', function(e) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (draggedEl && draggedEl !== item) {
                    item.classList.add('profile-quality-drag-over');
                }
            });
            item.addEventListener('dragleave', function() {
                item.classList.remove('profile-quality-drag-over');
            });
            item.addEventListener('drop', function(e) {
                e.preventDefault();
                item.classList.remove('profile-quality-drag-over');
                if (!draggedEl || draggedEl === item) return;
                var parent = item.parentNode;
                parent.insertBefore(draggedEl, item);
                markProfileEditorDirty();
                refreshProfileEditorUpgradeUntilOptions();
            });
        });
        list.addEventListener('dragover', function(e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
        });
    }

    Forms.openProfileEditor = function(index) {
        const list = Forms._profilesList;
        if (!list || !list[index]) {
            fetch('./api/profiles')
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    const profiles = (data && data.profiles) ? data.profiles : [];
                    Forms._profilesList = profiles;
                    if (profiles[index]) {
                        Forms._openProfileEditorWithProfile(index, profiles[index]);
                    } else {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification('Profile not found.', 'error');
                        }
                    }
                })
                .catch(function() {
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification('Failed to load profile.', 'error');
                    }
                });
            return;
        }
        Forms._openProfileEditorWithProfile(index, list[index]);
    };

    /** Open profile editor for TV Hunt (independent from Movie Hunt). */
    Forms.openTVHuntProfileEditor = function(profileId) {
        window._profileEditorTVHunt = true;
        fetch('./api/tv-hunt/profiles', { cache: 'no-store' })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var list = (data && data.profiles) ? data.profiles : [];
                var profile = list.find(function(p) { return p.id === profileId; });
                if (profile) {
                    Forms._openProfileEditorWithProfile(
                        { tvHunt: true, profileId: profileId, originalProfile: JSON.parse(JSON.stringify(profile)) },
                        profile
                    );
                } else {
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification('Profile not found.', 'error');
                    }
                }
            })
            .catch(function() {
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('Failed to load profile.', 'error');
                }
            });
    };

    Forms._openProfileEditorWithProfile = function(indexOrState, profile) {
        _profileEditorDirty = false;
        var state;
        if (typeof indexOrState === 'object' && indexOrState !== null && indexOrState.tvHunt) {
            state = indexOrState;
            if (!state.originalProfile) state.originalProfile = JSON.parse(JSON.stringify(profile));
        } else {
            state = { index: indexOrState, originalProfile: JSON.parse(JSON.stringify(profile)) };
        }
        Forms._currentProfileEditing = state;
        const contentEl = document.getElementById('profile-editor-content');
        const saveBtn = document.getElementById('profile-editor-save');
        const backBtn = document.getElementById('profile-editor-back');
        if (!contentEl) return;
        contentEl.innerHTML = generateProfileEditorHtml(profile);
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.classList.remove('enabled');
            saveBtn.onclick = function() { Forms.saveProfileFromEditor(); };
        }
        var nextSection = state.tvHunt ? 'tv-hunt-settings-profiles' : 'settings-profiles';
        if (backBtn) {
            backBtn.onclick = function() {
                confirmLeaveProfileEditor(function(result) {
                    if (result === 'save') Forms.saveProfileFromEditor(nextSection);
                    else if (result === 'discard') Forms.cancelProfileEditor(nextSection);
                });
            };
        }
        setTimeout(function() {
            setupProfileEditorChangeDetection();
            setupProfileQualitiesDragDrop();
            refreshProfileEditorUpgradeUntilOptions();
            loadProfileEditorScoresTable();
        }, 100);
        if (window.huntarrUI && window.huntarrUI.switchSection) {
            window.huntarrUI.switchSection('profile-editor');
        }
    };

    Forms.saveProfileFromEditor = function(optionalNextSection) {
        const state = Forms._currentProfileEditing;
        if (!state) return;
        const isTVHunt = state.tvHunt && state.profileId;
        const nextSection = optionalNextSection || (isTVHunt ? 'tv-hunt-settings-profiles' : 'settings-profiles');
        const index = state.index;
        const nameEl = document.getElementById('profile-editor-name');
        const defaultEl = document.getElementById('profile-editor-default');
        const upgradesEl = document.getElementById('profile-editor-upgrades');
        const upgradeUntilEl = document.getElementById('profile-editor-upgrade-until');
        const minScoreEl = document.getElementById('profile-editor-min-score');
        const untilScoreEl = document.getElementById('profile-editor-until-score');
        const incrementEl = document.getElementById('profile-editor-increment');
        const languageEl = document.getElementById('profile-editor-language');
        const qualitiesContainer = document.getElementById('profile-editor-qualities');
        const name = (nameEl && nameEl.value) ? nameEl.value.trim() : 'Unnamed';
        const isDefault = defaultEl ? defaultEl.checked : false;
        const upgradesAllowed = upgradesEl ? upgradesEl.checked : true;
        const upgradeUntil = (upgradeUntilEl && upgradeUntilEl.value) ? upgradeUntilEl.value.trim() : 'WEB 2160p';
        const minScore = minScoreEl ? parseInt(minScoreEl.value, 10) : -10000;
        const untilScore = untilScoreEl ? parseInt(untilScoreEl.value, 10) : 5500;
        const increment = incrementEl ? parseInt(incrementEl.value, 10) : 100;
        const language = (languageEl && languageEl.value) ? languageEl.value.trim() : 'English';
        const qualities = [];
        if (qualitiesContainer) {
            const items = qualitiesContainer.querySelectorAll('.profile-quality-item');
            items.forEach(function(item, i) {
                const cb = item.querySelector('input[type="checkbox"]');
                const label = item.querySelector('.quality-name');
                qualities.push({
                    id: item.getAttribute('data-quality-id') || 'q' + i,
                    name: label ? label.textContent.trim() : ('Quality ' + i),
                    enabled: cb ? cb.checked : true,
                    order: i
                });
            });
        }
        const body = {
            name: name,
            is_default: isDefault,
            upgrades_allowed: upgradesAllowed,
            upgrade_until_quality: upgradeUntil,
            min_custom_format_score: isNaN(minScore) ? -10000 : minScore,
            upgrade_until_custom_format_score: isNaN(untilScore) ? 5500 : untilScore,
            upgrade_score_increment: isNaN(increment) ? 100 : increment,
            language: language,
            qualities: qualities
        };
        const saveBtn = document.getElementById('profile-editor-save');
        if (saveBtn) saveBtn.disabled = true;
        var patchUrl = isTVHunt ? './api/tv-hunt/profiles/' + encodeURIComponent(state.profileId) : './api/profiles/' + index;
        fetch(patchUrl, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (data.success) {
                    _profileEditorDirty = false;
                    saveProfileEditorScores().then(function() {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification('Profile saved.', 'success');
                        }
                        if (optionalNextSection != null && window.huntarrUI && window.huntarrUI.switchSection) {
                            window.huntarrUI.switchSection(nextSection);
                        }
                        if (window.MediaHuntProfiles && typeof window.MediaHuntProfiles.refreshProfilesList === 'function' && window._mediaHuntProfilesMode) {
                            window.MediaHuntProfiles.refreshProfilesList(window._mediaHuntProfilesMode);
                        } else if (isTVHunt && window.TVHuntSettingsForms && window.TVHuntSettingsForms.refreshTVHuntProfilesList) {
                            window.TVHuntSettingsForms.refreshTVHuntProfilesList();
                        } else if (Forms.refreshProfilesList) Forms.refreshProfilesList();
                    }).catch(function() {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification('Profile saved; some scores may not have saved.', 'warning');
                        }
                        if (optionalNextSection != null && window.huntarrUI && window.huntarrUI.switchSection) {
                            window.huntarrUI.switchSection(nextSection);
                        }
                        if (window.MediaHuntProfiles && typeof window.MediaHuntProfiles.refreshProfilesList === 'function' && window._mediaHuntProfilesMode) {
                            window.MediaHuntProfiles.refreshProfilesList(window._mediaHuntProfilesMode);
                        } else if (isTVHunt && window.TVHuntSettingsForms && window.TVHuntSettingsForms.refreshTVHuntProfilesList) {
                            window.TVHuntSettingsForms.refreshTVHuntProfilesList();
                        } else if (Forms.refreshProfilesList) Forms.refreshProfilesList();
                    });
                } else {
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification(data.error || 'Failed to save.', 'error');
                    }
                    if (saveBtn) saveBtn.disabled = false;
                    saveBtn.classList.add('enabled');
                }
            })
            .catch(function() {
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('Failed to save profile.', 'error');
                }
                if (saveBtn) saveBtn.disabled = false;
                saveBtn.classList.add('enabled');
            });
    };

    Forms.cancelProfileEditor = function(optionalNextSection) {
        var state = Forms._currentProfileEditing;
        _profileEditorDirty = false;
        Forms._currentProfileEditing = null;
        var defaultSection = (state && state.tvHunt) ? 'tv-hunt-settings-profiles' : 'settings-profiles';
        if (window.huntarrUI && window.huntarrUI.switchSection) {
            window.huntarrUI.switchSection(optionalNextSection || defaultSection);
        }
    };

    Forms.isProfileEditorDirty = function() {
        return !!_profileEditorDirty;
    };

    Forms.confirmLeaveProfileEditor = function(callback) {
        confirmLeaveProfileEditor(callback);
    };
})();


/* === modules/features/settings/movie-management.js === */
/**
 * Movie Management settings – Movie Hunt instances only.
 * Handles movie naming, folder format, and token builders.
 */
(function() {
    'use strict';

    function escapeHtml(s) {
        if (s == null) return '';
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    var _movieManagementDirty = false;
    var _movieManagementData = null;

    var COLON_DEMO_SAMPLE = 'Movie Title: The Subtitle';
    var COLON_DEMO_RESULTS = {
        'Smart Replace': 'Movie Title - The Subtitle',
        'Delete': 'Movie Title The Subtitle',
        'Replace with Dash': 'Movie Title- The Subtitle',
        'Replace with Space Dash': 'Movie Title - The Subtitle',
        'Replace with Space Dash Space': 'Movie Title - The Subtitle'
    };

    function defaults() {
        return {
            rename_movies: true,
            replace_illegal_characters: true,
            colon_replacement: 'Smart Replace',
            standard_movie_format: '{Movie Title} ({Release Year}) {Quality Full}',
            movie_folder_format: '{Movie Title} ({Release Year})',
            minimum_free_space_gb: 10,
            import_using_script: false,
            import_extra_files: false,
            rss_sync_enabled: true,
            rss_sync_interval_minutes: 15
        };
    }

    function generateFormHtml(data) {
        var d = data || defaults();
        var renameMovies = d.rename_movies !== false;
        var replaceIllegal = d.replace_illegal_characters !== false;
        var colonRep = escapeHtml(String(d.colon_replacement || 'Smart Replace').trim());
        var standardFormat = escapeHtml(String(d.standard_movie_format || '').trim() || '{Movie Title} ({Release Year}) {Quality Full}');
        var folderFormat = escapeHtml(String(d.movie_folder_format || '').trim() || '{Movie Title} ({Release Year})');
        var minSpace = typeof d.minimum_free_space_gb === 'number' ? d.minimum_free_space_gb : 10;
        var rssEnabled = d.rss_sync_enabled !== false;
        var rssInterval = typeof d.rss_sync_interval_minutes === 'number' ? d.rss_sync_interval_minutes : 15;

        var colonOptionList = ['Smart Replace', 'Delete', 'Replace with Dash', 'Replace with Space Dash', 'Replace with Space Dash Space'];
        var colonOptions = colonOptionList.map(function(opt) {
            var v = escapeHtml(opt);
            var sel = (opt === (d.colon_replacement || 'Smart Replace')) ? ' selected' : '';
            return '<option value="' + v + '"' + sel + '>' + v + '</option>';
        }).join('');

        return '<div class="editor-grid">' +
            '<div class="editor-section">' +
            '<div class="editor-section-title">Movie Naming</div>' +
            '<div class="editor-field-group">' +
            '<div class="editor-setting-item flex-row">' +
            '<label for="movie-mgmt-rename">Rename Movies</label>' +
            '<label class="toggle-switch"><input type="checkbox" id="movie-mgmt-rename"' + (renameMovies ? ' checked' : '') + '><span class="toggle-slider"></span></label>' +
            '</div><p class="editor-help-text">Movie Hunt will use the existing file name if renaming is disabled</p></div>' +
            '<div class="editor-field-group">' +
            '<div class="editor-setting-item flex-row">' +
            '<label for="movie-mgmt-replace-illegal">Replace Illegal Characters</label>' +
            '<label class="toggle-switch"><input type="checkbox" id="movie-mgmt-replace-illegal"' + (replaceIllegal ? ' checked' : '') + '><span class="toggle-slider"></span></label>' +
            '</div><p class="editor-help-text">Replace illegal characters. If unchecked, Movie Hunt will remove them instead</p></div>' +
            '<div class="editor-field-group">' +
            '<label for="movie-mgmt-colon">Colon Replacement</label>' +
            '<select id="movie-mgmt-colon">' + colonOptions + '</select>' +
            '<p class="editor-help-text">Change how Movie Hunt handles colon replacement. Smart Replace uses a dash or space-dash depending on the name.</p>' +
            '<p class="editor-help-text movie-mgmt-colon-demo" id="movie-mgmt-colon-demo"></p></div>' +
            '<div class="editor-field-group">' +
            '<span class="movie-mgmt-label-inline"><label for="movie-mgmt-standard-format">Standard Movie Format</label> <a href="https://trash-guides.info/Radarr/Radarr-recommended-naming-scheme/#standard-movie-format" target="_blank" rel="noopener noreferrer" class="movie-mgmt-doc-link" title="Recommended naming scheme (TRaSH Guides)"><i class="fas fa-question-circle"></i></a></span>' +
            '<div class="movie-mgmt-input-wrap"><input type="text" id="movie-mgmt-standard-format" value="' + standardFormat + '" placeholder="{Movie Title} ({Release Year}) {Quality Full}"><button type="button" class="token-builder-btn" data-target="movie-mgmt-standard-format" data-builder="file" title="Open Token Builder"><i class="fas fa-puzzle-piece"></i></button></div>' +
            '<p class="editor-help-text">Example: The Movie - Title (2010) Bluray-1080p Proper</p></div>' +
            '<div class="editor-field-group">' +
            '<span class="movie-mgmt-label-inline"><label for="movie-mgmt-folder-format">Movie Folder Format</label> <a href="https://trash-guides.info/Radarr/Radarr-recommended-naming-scheme/#movie-folder-format" target="_blank" rel="noopener noreferrer" class="movie-mgmt-doc-link" title="Recommended naming scheme – Movie Folder Format (TRaSH Guides)"><i class="fas fa-question-circle"></i></a></span>' +
            '<div class="movie-mgmt-input-wrap"><input type="text" id="movie-mgmt-folder-format" value="' + folderFormat + '" placeholder="{Movie Title} ({Release Year})"><button type="button" class="token-builder-btn" data-target="movie-mgmt-folder-format" data-builder="folder" title="Open Token Builder"><i class="fas fa-puzzle-piece"></i></button></div>' +
            '<p class="editor-help-text">Used when adding a new movie or moving movies via the movie editor. Example: The Movie - Title (2010)</p></div>' +
            '</div>' +
            '<div class="editor-section">' +
            '<div class="editor-section-title">Importing</div>' +
            '<div class="editor-field-group">' +
            '<label for="movie-mgmt-min-space">Minimum Free Space (GB)</label>' +
            '<input type="number" id="movie-mgmt-min-space" value="' + minSpace + '" min="0" max="10000" step="1">' +
            '<p class="editor-help-text">Prevent import if it would leave less than this amount of disk space available (in GB)</p></div>' +
            '</div>' +
            '<div class="editor-section">' +
            '<div class="editor-section-title">Media Hunt Scheduler</div>' +
            '<div class="editor-field-group">' +
            '<div class="editor-setting-item flex-row">' +
            '<label for="movie-mgmt-rss-enabled">Enable RSS Sync</label>' +
            '<label class="toggle-switch"><input type="checkbox" id="movie-mgmt-rss-enabled"' + (rssEnabled ? ' checked' : '') + '><span class="toggle-slider"></span></label>' +
            '</div><p class="editor-help-text">Periodically check indexers for new releases matching your collection</p></div>' +
            '<div class="editor-field-group">' +
            '<label for="movie-mgmt-rss-interval">RSS Sync Interval (minutes)</label>' +
            '<input type="number" id="movie-mgmt-rss-interval" value="' + rssInterval + '" min="15" max="60" step="1">' +
            '<p class="editor-help-text">How often to check for new releases (15\u201360 minutes)</p></div>' +
            '<div class="editor-field-group">' +
            '<label>Last Sync</label>' +
            '<div id="movie-mgmt-rss-last-sync" class="editor-help-text" style="color: #94a3b8; padding: 6px 0;">Loading\u2026</div>' +
            '</div>' +
            '<div class="editor-field-group">' +
            '<label>Next Sync</label>' +
            '<div id="movie-mgmt-rss-next-sync" class="editor-help-text" style="color: #94a3b8; padding: 6px 0;">Loading\u2026</div>' +
            '</div>' +
            '</div></div>';
    }

    function markDirty() {
        _movieManagementDirty = true;
        var saveBtn = document.getElementById('movie-management-save');
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.classList.add('enabled');
        }
    }

    function collectFormData() {
        return {
            rename_movies: document.getElementById('movie-mgmt-rename') ? document.getElementById('movie-mgmt-rename').checked : true,
            replace_illegal_characters: document.getElementById('movie-mgmt-replace-illegal') ? document.getElementById('movie-mgmt-replace-illegal').checked : true,
            colon_replacement: document.getElementById('movie-mgmt-colon') ? (document.getElementById('movie-mgmt-colon').value || 'Smart Replace').trim() : 'Smart Replace',
            standard_movie_format: document.getElementById('movie-mgmt-standard-format') ? (document.getElementById('movie-mgmt-standard-format').value || '').trim() : '{Movie Title} ({Release Year}) {Quality Full}',
            movie_folder_format: document.getElementById('movie-mgmt-folder-format') ? (document.getElementById('movie-mgmt-folder-format').value || '').trim() : '{Movie Title} ({Release Year})',
            minimum_free_space_gb: (function() {
                var el = document.getElementById('movie-mgmt-min-space');
                if (!el) return 10;
                var n = parseInt(el.value, 10);
                return isNaN(n) || n < 0 ? 10 : Math.min(10000, n);
            })(),
            rss_sync_enabled: document.getElementById('movie-mgmt-rss-enabled') ? document.getElementById('movie-mgmt-rss-enabled').checked : true,
            rss_sync_interval_minutes: (function() {
                var el = document.getElementById('movie-mgmt-rss-interval');
                if (!el) return 15;
                var n = parseInt(el.value, 10);
                return isNaN(n) || n < 15 ? 15 : Math.min(60, n);
            })()
        };
    }

    function updateColonDemo() {
        var selectEl = document.getElementById('movie-mgmt-colon');
        var demoEl = document.getElementById('movie-mgmt-colon-demo');
        if (!selectEl || !demoEl) return;
        var value = (selectEl.value || 'Smart Replace').trim();
        var result = COLON_DEMO_RESULTS[value];
        if (result !== undefined) {
            demoEl.textContent = 'Demo: "' + COLON_DEMO_SAMPLE + '" \u2192 "' + result + '"';
            demoEl.style.display = '';
        } else {
            demoEl.style.display = 'none';
        }
    }

    function setupChangeDetection() {
        var ids = ['movie-mgmt-rename', 'movie-mgmt-replace-illegal', 'movie-mgmt-colon', 'movie-mgmt-standard-format', 'movie-mgmt-folder-format', 'movie-mgmt-min-space', 'movie-mgmt-rss-enabled', 'movie-mgmt-rss-interval'];
        ids.forEach(function(id) {
            var el = document.getElementById(id);
            if (el) {
                el.addEventListener('change', function() {
                    markDirty();
                    if (id === 'movie-mgmt-colon') updateColonDemo();
                });
                el.addEventListener('input', markDirty);
            }
        });
        updateColonDemo();
    }

    function confirmLeaveMovieManagement(callback) {
        if (!_movieManagementDirty) {
            if (callback) callback('discard');
            return;
        }
        if (typeof callback !== 'function') return;
        if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
            window.HuntarrConfirm.show({
                title: 'Unsaved Changes',
                message: 'You have unsaved changes that will be lost if you leave.',
                confirmLabel: 'Go Back',
                cancelLabel: 'Leave',
                onConfirm: function() {
                    // Stay on the editor — modal just closes, user can save manually
                    callback('stay');
                },
                onCancel: function() { callback('discard'); }
            });
        } else {
            if (!confirm('You have unsaved changes that will be lost. Leave anyway?')) {
                callback('stay');
                return;
            }
            callback('discard');
        }
    }

    function formatSyncTime(isoStr) {
        if (!isoStr) return 'Never';
        try {
            var d = new Date(isoStr);
            if (isNaN(d.getTime())) return 'Unknown';
            return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
        } catch (e) { return 'Unknown'; }
    }

    function loadRssSyncStatus() {
        var statusUrl = appendInstanceParam('./api/settings/rss-sync-status');
        fetch(statusUrl, { cache: 'no-store' })
            .then(function(r) { return r.json(); })
            .then(function(status) {
                var lastEl = document.getElementById('movie-mgmt-rss-last-sync');
                var nextEl = document.getElementById('movie-mgmt-rss-next-sync');
                if (lastEl) lastEl.textContent = formatSyncTime(status.last_sync_time);
                if (nextEl) nextEl.textContent = formatSyncTime(status.next_sync_time);
            })
            .catch(function() {
                var lastEl = document.getElementById('movie-mgmt-rss-last-sync');
                var nextEl = document.getElementById('movie-mgmt-rss-next-sync');
                if (lastEl) lastEl.textContent = 'Unable to load';
                if (nextEl) nextEl.textContent = 'Unable to load';
            });
    }

    function load() {
        _movieManagementDirty = false;
        _movieManagementData = null;
        var contentEl = document.getElementById('movie-management-content');
        var saveBtn = document.getElementById('movie-management-save');
        var backBtn = document.getElementById('movie-management-back');
        if (!contentEl) return;

        if (saveBtn) { saveBtn.disabled = true; saveBtn.classList.remove('enabled'); saveBtn.style.display = ''; }
        if (backBtn) backBtn.style.display = '';

        contentEl.innerHTML = '<p class="editor-help-text">Loading…</p>';

        var url = appendInstanceParam(getApiBase());
        fetch(url)
            .then(function(r) { return r.json(); })
            .then(function(data) {
                _movieManagementData = data;
                contentEl.innerHTML = generateFormHtml(data);
                setupChangeDetection();
                attachTokenBuilderButtons();
                loadRssSyncStatus();
                if (saveBtn) {
                    saveBtn.onclick = function() { window.MovieManagement.save(); };
                }
                if (backBtn) {
                    backBtn.onclick = function() {
                        confirmLeaveMovieManagement(function(result) {
                            if (result === 'save') window.MovieManagement.save('media-hunt-instances');
                            else if (result === 'discard') window.MovieManagement.cancel('media-hunt-instances');
                        });
                    };
                }
            })
            .catch(function() {
                _movieManagementData = defaults();
                contentEl.innerHTML = generateFormHtml(_movieManagementData);
                setupChangeDetection();
                attachTokenBuilderButtons();
                if (saveBtn) saveBtn.onclick = function() { window.MovieManagement.save(); };
                if (backBtn) backBtn.onclick = function() {
                    confirmLeaveMovieManagement(function(result) {
                        if (result === 'save') window.MovieManagement.save('media-hunt-instances');
                        else if (result === 'discard') window.MovieManagement.cancel('media-hunt-instances');
                    });
                };
            });
    }

    function save(optionalNextSection) {
        var nextSection = optionalNextSection || 'media-hunt-instances';
        var body = collectFormData();
        var instId = getInstanceId();
        if (instId) body.instance_id = parseInt(instId, 10);
        var saveBtn = document.getElementById('movie-management-save');
        if (saveBtn) saveBtn.disabled = true;

        var url = appendInstanceParam(getApiBase());
        fetch(url, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                _movieManagementDirty = false;
                if (saveBtn) {
                    saveBtn.disabled = true;
                    saveBtn.classList.remove('enabled');
                }
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('Media Management saved.', 'success');
                }
                if (window.huntarrUI && window.huntarrUI.switchSection) {
                    window.huntarrUI.switchSection(nextSection);
                }
            })
            .catch(function() {
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('Failed to save Media Management.', 'error');
                }
                if (saveBtn) {
                    saveBtn.disabled = false;
                    saveBtn.classList.add('enabled');
                }
            });
    }

    function cancel(optionalNextSection) {
        _movieManagementDirty = false;
        _movieManagementData = null;
        if (window.huntarrUI && window.huntarrUI.switchSection) {
            window.huntarrUI.switchSection(optionalNextSection || 'media-hunt-instances');
        }
    }

    function getApiBase() {
        return './api/settings/movie-management';
    }

    function getInstanceId() {
        var sel = document.getElementById('movie-management-instance-select');
        var v = sel && sel.value ? sel.value : '';
        if (v && v.indexOf(':') >= 0) return v.split(':')[1] || '';
        return v || '';
    }

    function appendInstanceParam(url) {
        var id = getInstanceId();
        if (!id) return url;
        return url + (url.indexOf('?') >= 0 ? '&' : '?') + 'instance_id=' + encodeURIComponent(id);
    }

    function safeJsonFetch(url, fallback) {
        return fetch(url, { cache: 'no-store' }).then(function(r) { return r.json(); }).catch(function() { return fallback || {}; });
    }

    function populateInstanceDropdown() {
        var selectEl = document.getElementById('movie-management-instance-select');
        if (!selectEl) return;
        selectEl.innerHTML = '<option value="">Loading...</option>';
        var ts = Date.now();
        Promise.all([
            safeJsonFetch('./api/movie-hunt/instances?t=' + ts, { instances: [] }),
            safeJsonFetch('./api/tv-hunt/instances?t=' + ts, { instances: [] }),
            safeJsonFetch('./api/movie-hunt/instances/current?t=' + ts, { current_instance_id: null }),
            safeJsonFetch('./api/indexer-hunt/indexers?t=' + ts, { indexers: [] }),
            safeJsonFetch('./api/movie-hunt/has-clients?t=' + ts, { has_clients: false })
        ]).then(function(results) {
            var movieList = (results[0].instances || []).map(function(inst) {
                return { value: 'movie:' + inst.id, label: 'Movie - ' + (inst.name || 'Instance ' + inst.id) };
            });
            var tvList = (results[1].instances || []).map(function(inst) {
                return { value: 'tv:' + inst.id, label: 'TV - ' + (inst.name || 'Instance ' + inst.id) };
            });
            var combined = movieList.concat(tvList);
            combined.sort(function(a, b) { return (a.label || '').localeCompare(b.label || '', undefined, { sensitivity: 'base' }); });
            var currentMovie = results[2].current_instance_id != null ? Number(results[2].current_instance_id) : null;
            selectEl.innerHTML = '';
            if (combined.length === 0) {
                var emptyOpt = document.createElement('option');
                emptyOpt.value = '';
                emptyOpt.textContent = 'No Movie or TV Hunt instances';
                selectEl.appendChild(emptyOpt);
                var noInstEl = document.getElementById('movie-management-no-instances');
                var noIdxEl = document.getElementById('movie-management-no-indexers');
                var noCliEl = document.getElementById('movie-management-no-clients');
                var wrapperEl = document.getElementById('movie-management-content-wrapper');
                if (noInstEl) noInstEl.style.display = '';
                if (noIdxEl) noIdxEl.style.display = 'none';
                if (noCliEl) noCliEl.style.display = 'none';
                if (wrapperEl) wrapperEl.style.display = 'none';
                return;
            }
            var indexerCount = (results[3].indexers || []).length;
            if (indexerCount === 0) {
                selectEl.innerHTML = '';
                var emptyOpt = document.createElement('option');
                emptyOpt.value = '';
                emptyOpt.textContent = 'No indexers configured';
                selectEl.appendChild(emptyOpt);
                var noInstEl = document.getElementById('movie-management-no-instances');
                var noIdxEl = document.getElementById('movie-management-no-indexers');
                var noCliEl = document.getElementById('movie-management-no-clients');
                var wrapperEl = document.getElementById('movie-management-content-wrapper');
                if (noInstEl) noInstEl.style.display = 'none';
                if (noIdxEl) noIdxEl.style.display = '';
                if (noCliEl) noCliEl.style.display = 'none';
                if (wrapperEl) wrapperEl.style.display = 'none';
                return;
            }
            var hasClients = results[4].has_clients === true;
            if (!hasClients) {
                selectEl.innerHTML = '';
                var emptyOpt = document.createElement('option');
                emptyOpt.value = '';
                emptyOpt.textContent = 'No clients configured';
                selectEl.appendChild(emptyOpt);
                var noInstEl = document.getElementById('movie-management-no-instances');
                var noIdxEl = document.getElementById('movie-management-no-indexers');
                var noCliEl = document.getElementById('movie-management-no-clients');
                var wrapperEl = document.getElementById('movie-management-content-wrapper');
                if (noInstEl) noInstEl.style.display = 'none';
                if (noIdxEl) noIdxEl.style.display = 'none';
                if (noCliEl) noCliEl.style.display = '';
                if (wrapperEl) wrapperEl.style.display = 'none';
                return;
            }
            combined.forEach(function(item) {
                var opt = document.createElement('option');
                opt.value = item.value;
                opt.textContent = item.label;
                selectEl.appendChild(opt);
            });
            var saved = (typeof localStorage !== 'undefined' && localStorage.getItem('media-mgmt-last-instance')) || '';
            var selected = '';
            if (saved && combined.some(function(i) { return i.value === saved; })) {
                selected = saved;
            } else if (currentMovie != null && combined.some(function(i) { return i.value === 'movie:' + currentMovie; })) {
                selected = 'movie:' + currentMovie;
            } else {
                selected = combined[0].value;
            }
            selectEl.value = selected;
            var noInstEl = document.getElementById('movie-management-no-instances');
            var noIdxEl = document.getElementById('movie-management-no-indexers');
            var noCliEl = document.getElementById('movie-management-no-clients');
            var wrapperEl = document.getElementById('movie-management-content-wrapper');
            if (noInstEl) noInstEl.style.display = 'none';
            if (noIdxEl) noIdxEl.style.display = 'none';
            if (noCliEl) noCliEl.style.display = 'none';
            if (wrapperEl) wrapperEl.style.display = '';
            if (typeof localStorage !== 'undefined') localStorage.setItem('media-mgmt-last-instance', selected);
            handleInstanceChange(selected);
        }).catch(function() {
            selectEl.innerHTML = '<option value="">Failed to load instances</option>';
            var noInstEl = document.getElementById('movie-management-no-instances');
            var noIdxEl = document.getElementById('movie-management-no-indexers');
            var noCliEl = document.getElementById('movie-management-no-clients');
            var wrapperEl = document.getElementById('movie-management-content-wrapper');
            if (noInstEl) noInstEl.style.display = 'none';
            if (noIdxEl) noIdxEl.style.display = 'none';
            if (noCliEl) noCliEl.style.display = '';
            if (wrapperEl) wrapperEl.style.display = 'none';
        });
    }

    function handleInstanceChange(val) {
        if (!val || val.indexOf(':') < 0) return;
        var parts = val.split(':');
        var type = parts[0];
        if (type === 'tv') {
            if (typeof localStorage !== 'undefined') localStorage.setItem('media-mgmt-last-instance', val);
            if (window.huntarrUI && window.huntarrUI.switchSection) {
                window.huntarrUI.switchSection('tv-hunt-settings-tv-management');
            }
        } else {
            load();
        }
    }

    function initOrRefresh() {
        var selectEl = document.getElementById('movie-management-instance-select');
        if (selectEl && selectEl.options.length <= 1) {
            populateInstanceDropdown();
        } else {
            load();
        }
        if (selectEl && !selectEl._mgmtChangeBound) {
            selectEl._mgmtChangeBound = true;
            selectEl.addEventListener('change', function() {
                var val = selectEl.value;
                if (typeof localStorage !== 'undefined') localStorage.setItem('media-mgmt-last-instance', val);
                handleInstanceChange(val);
            });
        }
        if (!window.MovieManagement._eventsBound) {
            window.MovieManagement._eventsBound = true;
            document.addEventListener('huntarr:instances-changed', function() { populateInstanceDropdown(); });
        }
    }

    /* ── Token Builder Modal ──────────────────────────────────────── */

    var FILE_NAME_PRESETS = [
        { name: 'Standard', format: '{Movie CleanTitle} ({Release Year}) - {Edition Tags} {[Custom Formats]}{[Quality Full]}{[MediaInfo AudioCodec} {MediaInfo AudioChannels]}{[MediaInfo VideoDynamicRangeType]}{[MediaInfo VideoCodec]}{-Release Group}',
          example: 'The Movie Title (2010) - Ultimate Extended Edition [Surround Sound x264][Bluray-1080p Proper][DTS 5.1][DV HDR10][x264]-RlsGrp' },
        { name: 'Minimal', format: '{Movie Title} ({Release Year}) {Quality Full}',
          example: 'The Movie Title (2010) Bluray-1080p Proper' },
        { name: 'Scene Style', format: '{Movie.CleanTitle}.{Release.Year}.{Edition.Tags}.{Quality.Full}.{MediaInfo.VideoCodec}{-Release Group}',
          example: 'The.Movie.Title.2010.Ultimate.Extended.Edition.Bluray-1080p.x264-RlsGrp' },
    ];

    var FOLDER_PRESETS = [
        { name: 'Standard', format: '{Movie CleanTitle} ({Release Year})',
          example: 'The Movie Title (2010)' },
        { name: 'With IMDb', format: '{Movie CleanTitle} ({Release Year}) {imdb-{ImdbId}}',
          example: 'The Movie Title (2010) {imdb-tt1520211}' },
        { name: 'With TMDb', format: '{Movie CleanTitle} ({Release Year}) {tmdb-{TmdbId}}',
          example: 'The Movie Title (2010) {tmdb-1520211}' },
    ];

    var FILE_TOKEN_CATEGORIES = [
        { name: 'Movie Title', icon: 'fa-film', tokens: [
            { token: '{Movie Title}', example: "The Movie's Title" },
            { token: '{Movie CleanTitle}', example: 'The Movies Title' },
            { token: '{Movie TitleThe}', example: "Movie's Title, The" },
            { token: '{Movie OriginalTitle}', example: 'Original Title' },
            { token: '{Movie TitleFirstCharacter}', example: 'M' },
            { token: '{Movie Collection}', example: 'The Movie Collection' },
            { token: '{Movie Certification}', example: 'R' },
        ]},
        { name: 'Movie ID', icon: 'fa-fingerprint', tokens: [
            { token: '{ImdbId}', example: 'tt12345' },
            { token: '{TmdbId}', example: '123456' },
        ]},
        { name: 'Date', icon: 'fa-calendar', tokens: [
            { token: '{Release Year}', example: '2009' },
        ]},
        { name: 'Quality', icon: 'fa-star', tokens: [
            { token: '{Quality Full}', example: 'HDTV-720p Proper' },
            { token: '{Quality Title}', example: 'HDTV-720p' },
        ]},
        { name: 'Media Info', icon: 'fa-info-circle', tokens: [
            { token: '{MediaInfo Simple}', example: 'x264 DTS' },
            { token: '{MediaInfo Full}', example: 'x264 DTS [EN+DE]' },
            { token: '{MediaInfo AudioCodec}', example: 'DTS' },
            { token: '{MediaInfo AudioChannels}', example: '5.1' },
            { token: '{MediaInfo AudioLanguages}', example: '[EN+DE]' },
            { token: '{MediaInfo VideoCodec}', example: 'x264' },
            { token: '{MediaInfo VideoBitDepth}', example: '10' },
            { token: '{MediaInfo VideoDynamicRange}', example: 'HDR' },
            { token: '{MediaInfo VideoDynamicRangeType}', example: 'DV HDR10' },
            { token: '{MediaInfo 3D}', example: '3D' },
            { token: '{MediaInfo SubtitleLanguages}', example: '[DE]' },
        ]},
        { name: 'Release', icon: 'fa-tag', tokens: [
            { token: '{Release Group}', example: 'Rls Grp' },
            { token: '{Edition Tags}', example: 'IMAX' },
        ]},
        { name: 'Custom', icon: 'fa-sliders-h', tokens: [
            { token: '{Custom Formats}', example: 'Surround Sound x264' },
            { token: '{Custom Format:FormatName}', example: 'AMZN' },
        ]},
        { name: 'Original', icon: 'fa-file', tokens: [
            { token: '{Original Title}', example: 'Movie.Title.HDTV.x264-EVOLVE' },
            { token: '{Original Filename}', example: 'movie title hdtv.x264-Evolve' },
        ]},
    ];

    var FOLDER_TOKEN_CATEGORIES = [
        { name: 'Movie Title', icon: 'fa-film', tokens: [
            { token: '{Movie Title}', example: "The Movie's Title" },
            { token: '{Movie CleanTitle}', example: 'The Movies Title' },
            { token: '{Movie TitleThe}', example: "Movie's Title, The" },
            { token: '{Movie TitleFirstCharacter}', example: 'M' },
            { token: '{Movie Collection}', example: 'The Movie Collection' },
            { token: '{Movie Certification}', example: 'R' },
        ]},
        { name: 'Movie ID', icon: 'fa-fingerprint', tokens: [
            { token: '{ImdbId}', example: 'tt12345' },
            { token: '{TmdbId}', example: '123456' },
        ]},
        { name: 'Date', icon: 'fa-calendar', tokens: [
            { token: '{Release Year}', example: '2009' },
        ]},
    ];

    function openTokenBuilder(targetInputId, builderType) {
        var existing = document.getElementById('token-builder-modal');
        if (existing) existing.remove();

        var isFolder = builderType === 'folder';
        var categories = isFolder ? FOLDER_TOKEN_CATEGORIES : FILE_TOKEN_CATEGORIES;
        var presets = isFolder ? FOLDER_PRESETS : FILE_NAME_PRESETS;
        var modalTitle = isFolder ? 'Folder Name Builder' : 'File Name Builder';
        var modalIcon = isFolder ? 'fa-folder-open' : 'fa-file-video';

        var targetInput = document.getElementById(targetInputId);
        var currentValue = targetInput ? targetInput.value : '';

        var html = '<div class="tkb-overlay" id="token-builder-modal">' +
            '<div class="tkb-modal">' +
            '<div class="tkb-header">' +
            '<div class="tkb-header-left"><i class="fas ' + modalIcon + '"></i><span>' + modalTitle + '</span></div>' +
            '<button class="tkb-close" id="tkb-close-btn"><i class="fas fa-times"></i></button>' +
            '</div>' +
            '<div class="tkb-body">';

        // Presets section
        html += '<div class="tkb-presets-section">' +
            '<div class="tkb-cat-header"><i class="fas fa-magic"></i> Quick Presets</div>' +
            '<div class="tkb-presets">';
        presets.forEach(function(p, idx) {
            html += '<button type="button" class="tkb-preset" data-preset-idx="' + idx + '">' +
                '<div class="tkb-preset-name">' + escapeHtml(p.name) + '</div>' +
                '<div class="tkb-preset-format">' + escapeHtml(p.format) + '</div>' +
                '<div class="tkb-preset-example">' + escapeHtml(p.example) + '</div>' +
                '</button>';
        });
        html += '</div></div>';

        // Token categories
        categories.forEach(function(cat) {
            html += '<div class="tkb-category">' +
                '<div class="tkb-cat-header"><i class="fas ' + cat.icon + '"></i> ' + escapeHtml(cat.name) + '</div>' +
                '<div class="tkb-tokens">';
            cat.tokens.forEach(function(t) {
                html += '<button type="button" class="tkb-token" data-token="' + escapeHtml(t.token) + '">' +
                    '<span class="tkb-token-name">' + escapeHtml(t.token) + '</span>' +
                    '<span class="tkb-token-example">' + escapeHtml(t.example) + '</span>' +
                    '</button>';
            });
            html += '</div></div>';
        });

        html += '</div>' +
            '<div class="tkb-footer">' +
            '<div class="tkb-preview-label">Current Format</div>' +
            '<input type="text" class="tkb-preview-input" id="tkb-preview-input" value="' + escapeHtml(currentValue) + '" readonly>' +
            '<div class="tkb-footer-actions">' +
            '<button type="button" class="tkb-btn tkb-btn-clear" id="tkb-clear-btn"><i class="fas fa-eraser"></i> Clear</button>' +
            '<button type="button" class="tkb-btn tkb-btn-done" id="tkb-done-btn"><i class="fas fa-check"></i> Done</button>' +
            '</div>' +
            '</div>' +
            '</div></div>';

        document.body.insertAdjacentHTML('beforeend', html);
        var modal = document.getElementById('token-builder-modal');

        document.getElementById('tkb-close-btn').addEventListener('click', function() { modal.remove(); });
        modal.addEventListener('click', function(e) { if (e.target === modal) modal.remove(); });

        // Preset click -> replace entire format
        modal.querySelectorAll('.tkb-preset').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var idx = parseInt(btn.getAttribute('data-preset-idx'), 10);
                var preset = presets[idx];
                if (!preset) return;
                var input = document.getElementById(targetInputId);
                var preview = document.getElementById('tkb-preview-input');
                if (input) { input.value = preset.format; markDirty(); }
                if (preview) preview.value = preset.format;
                // Highlight active preset
                modal.querySelectorAll('.tkb-preset').forEach(function(b) { b.classList.remove('tkb-preset-active'); });
                btn.classList.add('tkb-preset-active');
            });
        });

        // Token click -> append to input
        modal.querySelectorAll('.tkb-token').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var token = btn.getAttribute('data-token');
                var input = document.getElementById(targetInputId);
                var preview = document.getElementById('tkb-preview-input');
                if (input) {
                    var val = input.value;
                    var needsSpace = val.length > 0 && val[val.length - 1] !== ' ' && val[val.length - 1] !== '(' && val[val.length - 1] !== '[' && val[val.length - 1] !== '{';
                    input.value = val + (needsSpace ? ' ' : '') + token;
                    markDirty();
                }
                if (preview && input) preview.value = input.value;
                btn.classList.add('tkb-token-added');
                setTimeout(function() { btn.classList.remove('tkb-token-added'); }, 400);
            });
        });

        document.getElementById('tkb-clear-btn').addEventListener('click', function() {
            var input = document.getElementById(targetInputId);
            var preview = document.getElementById('tkb-preview-input');
            if (input) { input.value = ''; markDirty(); }
            if (preview) preview.value = '';
            modal.querySelectorAll('.tkb-preset').forEach(function(b) { b.classList.remove('tkb-preset-active'); });
        });

        document.getElementById('tkb-done-btn').addEventListener('click', function() { modal.remove(); });

        function escHandler(e) { if (e.key === 'Escape') { modal.remove(); document.removeEventListener('keydown', escHandler); } }
        document.addEventListener('keydown', escHandler);
    }

    function attachTokenBuilderButtons() {
        document.querySelectorAll('.token-builder-btn').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.preventDefault();
                var target = btn.getAttribute('data-target');
                var builder = btn.getAttribute('data-builder') || 'file';
                if (target) openTokenBuilder(target, builder);
            });
        });
    }

    window.MovieManagement = {
        getApiBase: getApiBase,
        getInstanceId: getInstanceId,
        load: load,
        save: save,
        cancel: cancel,
        isDirty: function() { return _movieManagementDirty; },
        confirmLeave: confirmLeaveMovieManagement,
        initOrRefresh: initOrRefresh
    };
})();


/* === modules/features/settings/tv-management.js === */
/**
 * TV Management settings – standalone module for TV Hunt instances.
 * Handles episode naming, folder structure, and token builders.
 */
(function() {
    'use strict';

    function escapeHtml(s) {
        if (s == null) return '';
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    var _dirty = false;
    var _data = null;

    var COLON_DEMO_SAMPLE = 'Series Title: The Subtitle';
    var COLON_DEMO_RESULTS = {
        'Smart Replace': 'Series Title - The Subtitle',
        'Delete': 'Series Title The Subtitle',
        'Replace with Dash': 'Series Title- The Subtitle',
        'Replace with Space Dash': 'Series Title - The Subtitle',
        'Replace with Space Dash Space': 'Series Title - The Subtitle'
    };

    function defaults() {
        return {
            rename_episodes: true,
            replace_illegal_characters: true,
            colon_replacement: 'Smart Replace',
            standard_episode_format: "{Series TitleYear} - S{season:00}E{episode:00} - {Episode CleanTitle} {Quality Full}",
            daily_episode_format: "{Series TitleYear} - {Air-Date} - {Episode CleanTitle} {Quality Full}",
            anime_episode_format: "{Series TitleYear} - S{season:00}E{episode:00} - {absolute:000} - {Episode CleanTitle} {Quality Full}",
            series_folder_format: '{Series TitleYear}',
            season_folder_format: 'Season {season:00}',
            specials_folder_format: 'Specials',
            multi_episode_style: 'Prefixed Range',
            minimum_free_space_gb: 10,
            rss_sync_enabled: true,
            rss_sync_interval_minutes: 15
        };
    }

    function generateFormHtml(data) {
        var d = data || defaults();
        var renameEpisodes = d.rename_episodes !== false;
        var replaceIllegal = d.replace_illegal_characters !== false;
        var colonRep = escapeHtml(String(d.colon_replacement || 'Smart Replace').trim());

        var stdEpFmt = escapeHtml(String(d.standard_episode_format || '').trim() || defaults().standard_episode_format);
        var dailyFmt = escapeHtml(String(d.daily_episode_format || '').trim() || defaults().daily_episode_format);
        var animeFmt = escapeHtml(String(d.anime_episode_format || '').trim() || defaults().anime_episode_format);
        var seriesFolderFmt = escapeHtml(String(d.series_folder_format || '').trim() || defaults().series_folder_format);
        var seasonFolderFmt = escapeHtml(String(d.season_folder_format || '').trim() || defaults().season_folder_format);
        var specialsFolderFmt = escapeHtml(String(d.specials_folder_format || '').trim() || defaults().specials_folder_format);
        var multiStyle = escapeHtml(String(d.multi_episode_style || 'Prefixed Range').trim());
        var minSpace = typeof d.minimum_free_space_gb === 'number' ? d.minimum_free_space_gb : 10;
        var rssEnabled = d.rss_sync_enabled !== false;
        var rssInterval = typeof d.rss_sync_interval_minutes === 'number' ? d.rss_sync_interval_minutes : 15;

        var colonOptionList = ['Smart Replace', 'Delete', 'Replace with Dash', 'Replace with Space Dash', 'Replace with Space Dash Space'];
        var colonOptions = colonOptionList.map(function(opt) {
            var v = escapeHtml(opt);
            var sel = (opt === (d.colon_replacement || 'Smart Replace')) ? ' selected' : '';
            return '<option value="' + v + '"' + sel + '>' + v + '</option>';
        }).join('');

        var multiStyleOptions = ['Extend', 'Duplicate', 'Repeat', 'Scene', 'Range', 'Prefixed Range'].map(function(opt) {
            var v = escapeHtml(opt);
            var sel = (opt === (d.multi_episode_style || 'Prefixed Range')) ? ' selected' : '';
            return '<option value="' + v + '"' + sel + '>' + v + '</option>';
        }).join('');

        return '<div class="editor-grid">' +
            '<div class="editor-section">' +
            '<div class="editor-section-title">Episode Naming</div>' +
            '<div class="editor-field-group">' +
            '<div class="editor-setting-item flex-row">' +
            '<label for="tv-mgmt-rename">Rename Episodes</label>' +
            '<label class="toggle-switch"><input type="checkbox" id="tv-mgmt-rename"' + (renameEpisodes ? ' checked' : '') + '><span class="toggle-slider"></span></label>' +
            '</div><p class="editor-help-text">TV Hunt will use the existing file name if renaming is disabled</p></div>' +
            '<div class="editor-field-group">' +
            '<div class="editor-setting-item flex-row">' +
            '<label for="tv-mgmt-replace-illegal">Replace Illegal Characters</label>' +
            '<label class="toggle-switch"><input type="checkbox" id="tv-mgmt-replace-illegal"' + (replaceIllegal ? ' checked' : '') + '><span class="toggle-slider"></span></label>' +
            '</div><p class="editor-help-text">Replace illegal characters. If unchecked, TV Hunt will remove them instead</p></div>' +
            '<div class="editor-field-group">' +
            '<label for="tv-mgmt-colon">Colon Replacement</label>' +
            '<select id="tv-mgmt-colon">' + colonOptions + '</select>' +
            '<p class="editor-help-text">Change how TV Hunt handles colon replacement. Smart Replace uses a dash or space-dash depending on the name.</p>' +
            '<p class="editor-help-text tv-mgmt-colon-demo" id="tv-mgmt-colon-demo"></p></div>' +

            '<div class="editor-field-group">' +
            '<span class="tv-mgmt-label-inline"><label for="tv-mgmt-standard-format">Standard Episode Format</label> <a href="https://trash-guides.info/Sonarr/Sonarr-recommended-naming-scheme/#episode-format" target="_blank" rel="noopener noreferrer" class="tv-mgmt-doc-link" title="Recommended naming scheme (TRaSH Guides)"><i class="fas fa-question-circle"></i></a></span>' +
            '<div class="tv-mgmt-input-wrap"><input type="text" id="tv-mgmt-standard-format" value="' + stdEpFmt + '" placeholder="{Series TitleYear} - S{season:00}E{episode:00} - {Episode CleanTitle} {Quality Full}"><button type="button" class="token-builder-btn" data-target="tv-mgmt-standard-format" data-builder="tv-episode" title="Open Token Builder"><i class="fas fa-puzzle-piece"></i></button></div>' +
            '<p class="editor-help-text">Single: The Series Title! (2010) - S01E01 - Episode Title WEBDL-1080p Proper</p></div>' +

            '<div class="editor-field-group">' +
            '<span class="tv-mgmt-label-inline"><label for="tv-mgmt-daily-format">Daily Episode Format</label> <a href="https://trash-guides.info/Sonarr/Sonarr-recommended-naming-scheme/#episode-format" target="_blank" rel="noopener noreferrer" class="tv-mgmt-doc-link" title="Recommended naming scheme (TRaSH Guides)"><i class="fas fa-question-circle"></i></a></span>' +
            '<div class="tv-mgmt-input-wrap"><input type="text" id="tv-mgmt-daily-format" value="' + dailyFmt + '" placeholder="{Series TitleYear} - {Air-Date} - {Episode CleanTitle} {Quality Full}"><button type="button" class="token-builder-btn" data-target="tv-mgmt-daily-format" data-builder="tv-daily" title="Open Token Builder"><i class="fas fa-puzzle-piece"></i></button></div>' +
            '<p class="editor-help-text">Example: The Series Title! (2010) - 2013-10-30 - Episode Title WEBDL-1080p Proper</p></div>' +

            '<div class="editor-field-group">' +
            '<span class="tv-mgmt-label-inline"><label for="tv-mgmt-anime-format">Anime Episode Format</label> <a href="https://trash-guides.info/Sonarr/Sonarr-recommended-naming-scheme/#episode-format" target="_blank" rel="noopener noreferrer" class="tv-mgmt-doc-link" title="Recommended naming scheme (TRaSH Guides)"><i class="fas fa-question-circle"></i></a></span>' +
            '<div class="tv-mgmt-input-wrap"><input type="text" id="tv-mgmt-anime-format" value="' + animeFmt + '" placeholder="{Series TitleYear} - S{season:00}E{episode:00} - {absolute:000} - {Episode CleanTitle} {Quality Full}"><button type="button" class="token-builder-btn" data-target="tv-mgmt-anime-format" data-builder="tv-anime" title="Open Token Builder"><i class="fas fa-puzzle-piece"></i></button></div>' +
            '<p class="editor-help-text">Single: The Series Title! (2010) - S01E01 - 001 - Episode Title WEBDL-1080p Proper</p></div>' +

            '<div class="editor-field-group">' +
            '<span class="tv-mgmt-label-inline"><label for="tv-mgmt-series-folder">Series Folder Format</label> <a href="https://trash-guides.info/Sonarr/Sonarr-recommended-naming-scheme/#series-folder-format" target="_blank" rel="noopener noreferrer" class="tv-mgmt-doc-link" title="Recommended naming scheme (TRaSH Guides)"><i class="fas fa-question-circle"></i></a></span>' +
            '<div class="tv-mgmt-input-wrap"><input type="text" id="tv-mgmt-series-folder" value="' + seriesFolderFmt + '" placeholder="{Series TitleYear}"><button type="button" class="token-builder-btn" data-target="tv-mgmt-series-folder" data-builder="tv-series-folder" title="Open Token Builder"><i class="fas fa-puzzle-piece"></i></button></div>' +
            '<p class="editor-help-text">Used when adding a new series or moving series. Example: The Series Title! (2010)</p></div>' +

            '<div class="editor-field-group">' +
            '<span class="tv-mgmt-label-inline"><label for="tv-mgmt-season-folder">Season Folder Format</label> <a href="https://trash-guides.info/Sonarr/Sonarr-recommended-naming-scheme/#season-folder-format" target="_blank" rel="noopener noreferrer" class="tv-mgmt-doc-link" title="Recommended naming scheme (TRaSH Guides)"><i class="fas fa-question-circle"></i></a></span>' +
            '<div class="tv-mgmt-input-wrap"><input type="text" id="tv-mgmt-season-folder" value="' + seasonFolderFmt + '" placeholder="Season {season:00}"><button type="button" class="token-builder-btn" data-target="tv-mgmt-season-folder" data-builder="tv-season-folder" title="Open Token Builder"><i class="fas fa-puzzle-piece"></i></button></div>' +
            '<p class="editor-help-text">Example: Season 01</p></div>' +

            '<div class="editor-field-group">' +
            '<span class="tv-mgmt-label-inline"><label for="tv-mgmt-specials-folder">Specials Folder Format</label></span>' +
            '<div class="tv-mgmt-input-wrap"><input type="text" id="tv-mgmt-specials-folder" value="' + specialsFolderFmt + '" placeholder="Specials"><button type="button" class="token-builder-btn" data-target="tv-mgmt-specials-folder" data-builder="tv-specials-folder" title="Open Token Builder"><i class="fas fa-puzzle-piece"></i></button></div>' +
            '<p class="editor-help-text">Example: Specials</p></div>' +

            '<div class="editor-field-group">' +
            '<label for="tv-mgmt-multi-episode">Multi Episode Style</label>' +
            '<select id="tv-mgmt-multi-episode">' + multiStyleOptions + '</select>' +
            '<p class="editor-help-text">How multi-episode files are named (e.g. S01E01-E03)</p></div>' +

            '</div>' +
            '<div class="editor-section">' +
            '<div class="editor-section-title">Importing</div>' +
            '<div class="editor-field-group">' +
            '<label for="tv-mgmt-min-space">Minimum Free Space (GB)</label>' +
            '<input type="number" id="tv-mgmt-min-space" value="' + minSpace + '" min="0" max="10000" step="1">' +
            '<p class="editor-help-text">Prevent import if it would leave less than this amount of disk space available (in GB)</p></div>' +
            '</div>' +
            '<div class="editor-section">' +
            '<div class="editor-section-title">Media Hunt Scheduler</div>' +
            '<div class="editor-field-group">' +
            '<div class="editor-setting-item flex-row">' +
            '<label for="tv-mgmt-rss-enabled">Enable RSS Sync</label>' +
            '<label class="toggle-switch"><input type="checkbox" id="tv-mgmt-rss-enabled"' + (rssEnabled ? ' checked' : '') + '><span class="toggle-slider"></span></label>' +
            '</div><p class="editor-help-text">Periodically check indexers for new releases matching your collection</p></div>' +
            '<div class="editor-field-group">' +
            '<label for="tv-mgmt-rss-interval">RSS Sync Interval (minutes)</label>' +
            '<input type="number" id="tv-mgmt-rss-interval" value="' + rssInterval + '" min="15" max="60" step="1">' +
            '<p class="editor-help-text">How often to check for new releases (15\u201360 minutes)</p></div>' +
            '<div class="editor-field-group">' +
            '<label>Last Sync</label>' +
            '<div id="tv-mgmt-rss-last-sync" class="editor-help-text" style="color: #94a3b8; padding: 6px 0;">Loading\u2026</div>' +
            '</div>' +
            '<div class="editor-field-group">' +
            '<label>Next Sync</label>' +
            '<div id="tv-mgmt-rss-next-sync" class="editor-help-text" style="color: #94a3b8; padding: 6px 0;">Loading\u2026</div>' +
            '</div>' +
            '</div></div>';
    }

    function markDirty() {
        _dirty = true;
        var saveBtn = document.getElementById('tv-management-save');
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.classList.add('enabled');
        }
    }

    function collectFormData() {
        return {
            rename_episodes: document.getElementById('tv-mgmt-rename') ? document.getElementById('tv-mgmt-rename').checked : true,
            replace_illegal_characters: document.getElementById('tv-mgmt-replace-illegal') ? document.getElementById('tv-mgmt-replace-illegal').checked : true,
            colon_replacement: document.getElementById('tv-mgmt-colon') ? (document.getElementById('tv-mgmt-colon').value || 'Smart Replace').trim() : 'Smart Replace',
            standard_episode_format: (document.getElementById('tv-mgmt-standard-format') || {}).value || defaults().standard_episode_format,
            daily_episode_format: (document.getElementById('tv-mgmt-daily-format') || {}).value || defaults().daily_episode_format,
            anime_episode_format: (document.getElementById('tv-mgmt-anime-format') || {}).value || defaults().anime_episode_format,
            series_folder_format: (document.getElementById('tv-mgmt-series-folder') || {}).value || defaults().series_folder_format,
            season_folder_format: (document.getElementById('tv-mgmt-season-folder') || {}).value || defaults().season_folder_format,
            specials_folder_format: (document.getElementById('tv-mgmt-specials-folder') || {}).value || defaults().specials_folder_format,
            multi_episode_style: (document.getElementById('tv-mgmt-multi-episode') || {}).value || 'Prefixed Range',
            minimum_free_space_gb: (function() {
                var el = document.getElementById('tv-mgmt-min-space');
                if (!el) return 10;
                var n = parseInt(el.value, 10);
                return isNaN(n) || n < 0 ? 10 : Math.min(10000, n);
            })(),
            rss_sync_enabled: document.getElementById('tv-mgmt-rss-enabled') ? document.getElementById('tv-mgmt-rss-enabled').checked : true,
            rss_sync_interval_minutes: (function() {
                var el = document.getElementById('tv-mgmt-rss-interval');
                if (!el) return 15;
                var n = parseInt(el.value, 10);
                return isNaN(n) || n < 15 ? 15 : Math.min(60, n);
            })()
        };
    }

    function updateColonDemo() {
        var selectEl = document.getElementById('tv-mgmt-colon');
        var demoEl = document.getElementById('tv-mgmt-colon-demo');
        if (!selectEl || !demoEl) return;
        var value = (selectEl.value || 'Smart Replace').trim();
        var result = COLON_DEMO_RESULTS[value];
        if (result !== undefined) {
            demoEl.textContent = 'Demo: "' + COLON_DEMO_SAMPLE + '" \u2192 "' + result + '"';
            demoEl.style.display = '';
        } else {
            demoEl.style.display = 'none';
        }
    }

    function setupChangeDetection() {
        var ids = [
            'tv-mgmt-rename', 'tv-mgmt-replace-illegal', 'tv-mgmt-colon',
            'tv-mgmt-standard-format', 'tv-mgmt-daily-format', 'tv-mgmt-anime-format',
            'tv-mgmt-series-folder', 'tv-mgmt-season-folder', 'tv-mgmt-specials-folder',
            'tv-mgmt-multi-episode', 'tv-mgmt-min-space', 'tv-mgmt-rss-enabled', 'tv-mgmt-rss-interval'
        ];
        ids.forEach(function(id) {
            var el = document.getElementById(id);
            if (el) {
                el.addEventListener('change', function() {
                    markDirty();
                    if (id === 'tv-mgmt-colon') updateColonDemo();
                });
                el.addEventListener('input', markDirty);
            }
        });
        updateColonDemo();
    }

    function confirmLeave(callback) {
        if (!_dirty) { if (callback) callback('discard'); return; }
        if (typeof callback !== 'function') return;
        if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
            window.HuntarrConfirm.show({
                title: 'Unsaved Changes',
                message: 'You have unsaved changes that will be lost if you leave.',
                confirmLabel: 'Go Back',
                cancelLabel: 'Leave',
                onConfirm: function() { callback('stay'); },
                onCancel: function() { callback('discard'); }
            });
        } else {
            if (!confirm('You have unsaved changes. Leave anyway?')) { callback('stay'); return; }
            callback('discard');
        }
    }

    function getInstanceId() {
        var sel = document.getElementById('tv-management-instance-select');
        var v = sel && sel.value ? sel.value : '';
        if (v && v.indexOf(':') >= 0) return v.split(':')[1] || '';
        return v || '';
    }

    function appendInstanceParam(url) {
        var id = getInstanceId();
        if (!id) return url;
        return url + (url.indexOf('?') >= 0 ? '&' : '?') + 'instance_id=' + encodeURIComponent(id);
    }

    function safeJsonFetch(url, fallback) {
        return fetch(url, { cache: 'no-store' }).then(function(r) { return r.json(); }).catch(function() { return fallback || {}; });
    }

    function formatSyncTime(isoStr) {
        if (!isoStr) return 'Never';
        try {
            var d = new Date(isoStr);
            if (isNaN(d.getTime())) return 'Unknown';
            return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
        } catch (e) { return 'Unknown'; }
    }

    function loadRssSyncStatus() {
        var statusUrl = appendInstanceParam('./api/tv-hunt/settings/rss-sync-status');
        fetch(statusUrl, { cache: 'no-store' })
            .then(function(r) { return r.json(); })
            .then(function(status) {
                var lastEl = document.getElementById('tv-mgmt-rss-last-sync');
                var nextEl = document.getElementById('tv-mgmt-rss-next-sync');
                if (lastEl) lastEl.textContent = formatSyncTime(status.last_sync_time);
                if (nextEl) nextEl.textContent = formatSyncTime(status.next_sync_time);
            })
            .catch(function() {
                var lastEl = document.getElementById('tv-mgmt-rss-last-sync');
                var nextEl = document.getElementById('tv-mgmt-rss-next-sync');
                if (lastEl) lastEl.textContent = 'Unable to load';
                if (nextEl) nextEl.textContent = 'Unable to load';
            });
    }

    function load() {
        _dirty = false;
        _data = null;
        var contentEl = document.getElementById('tv-management-content');
        var saveBtn = document.getElementById('tv-management-save');
        if (!contentEl) return;

        if (saveBtn) { saveBtn.disabled = true; saveBtn.classList.remove('enabled'); saveBtn.style.display = ''; }
        contentEl.innerHTML = '<p class="editor-help-text">Loading\u2026</p>';

        var url = appendInstanceParam('./api/tv-hunt/settings/tv-management');
        fetch(url)
            .then(function(r) { return r.json(); })
            .then(function(data) {
                _data = data;
                contentEl.innerHTML = generateFormHtml(data);
                setupChangeDetection();
                attachTokenBuilderButtons();
                loadRssSyncStatus();
                if (saveBtn) saveBtn.onclick = function() { window.TVManagement.save(); };
            })
            .catch(function() {
                _data = defaults();
                contentEl.innerHTML = generateFormHtml(_data);
                setupChangeDetection();
                attachTokenBuilderButtons();
                if (saveBtn) saveBtn.onclick = function() { window.TVManagement.save(); };
            });
    }

    function save(optionalNextSection) {
        var body = collectFormData();
        var instId = getInstanceId();
        if (instId) body.instance_id = parseInt(instId, 10);
        var saveBtn = document.getElementById('tv-management-save');
        if (saveBtn) saveBtn.disabled = true;

        var url = appendInstanceParam('./api/tv-hunt/settings/tv-management');
        fetch(url, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        })
            .then(function(r) { return r.json(); })
            .then(function() {
                _dirty = false;
                if (saveBtn) { saveBtn.disabled = true; saveBtn.classList.remove('enabled'); }
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('TV Management saved.', 'success');
                }
                if (optionalNextSection && window.huntarrUI && window.huntarrUI.switchSection) {
                    window.huntarrUI.switchSection(optionalNextSection);
                }
            })
            .catch(function() {
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('Failed to save TV Management.', 'error');
                }
                if (saveBtn) { saveBtn.disabled = false; saveBtn.classList.add('enabled'); }
            });
    }

    function cancel(optionalNextSection) {
        _dirty = false;
        _data = null;
        if (window.huntarrUI && window.huntarrUI.switchSection) {
            window.huntarrUI.switchSection(optionalNextSection || 'media-hunt-instances');
        }
    }

    function populateInstanceDropdown() {
        var selectEl = document.getElementById('tv-management-instance-select');
        if (!selectEl) return;
        selectEl.innerHTML = '<option value="">Loading...</option>';
        var ts = Date.now();
        Promise.all([
            safeJsonFetch('./api/movie-hunt/instances?t=' + ts, { instances: [] }),
            safeJsonFetch('./api/tv-hunt/instances?t=' + ts, { instances: [] }),
            safeJsonFetch('./api/tv-hunt/instances/current?t=' + ts, { current_instance_id: null })
        ]).then(function(results) {
            var movieList = (results[0].instances || []).map(function(inst) {
                return { value: 'movie:' + inst.id, label: 'Movie - ' + (inst.name || 'Instance ' + inst.id) };
            });
            var tvList = (results[1].instances || []).map(function(inst) {
                return { value: 'tv:' + inst.id, label: 'TV - ' + (inst.name || 'Instance ' + inst.id) };
            });
            var combined = movieList.concat(tvList);
            combined.sort(function(a, b) { return (a.label || '').localeCompare(b.label || '', undefined, { sensitivity: 'base' }); });
            var currentTv = results[2].current_instance_id != null ? Number(results[2].current_instance_id) : null;

            var wrapperEl = document.getElementById('tv-management-content-wrapper');
            var noInstEl = document.getElementById('tv-management-no-instances');

            if (combined.length === 0) {
                selectEl.innerHTML = '<option value="">No Movie or TV Hunt instances</option>';
                if (noInstEl) noInstEl.style.display = '';
                if (wrapperEl) wrapperEl.style.display = 'none';
                return;
            }

            if (noInstEl) noInstEl.style.display = 'none';
            if (wrapperEl) wrapperEl.style.display = '';

            selectEl.innerHTML = '';
            combined.forEach(function(item) {
                var opt = document.createElement('option');
                opt.value = item.value;
                opt.textContent = item.label;
                selectEl.appendChild(opt);
            });

            var saved = (typeof localStorage !== 'undefined' && localStorage.getItem('media-mgmt-last-instance')) || '';
            var selected = '';
            if (saved && combined.some(function(i) { return i.value === saved; })) {
                selected = saved;
            } else if (currentTv != null && combined.some(function(i) { return i.value === 'tv:' + currentTv; })) {
                selected = 'tv:' + currentTv;
            } else {
                var firstTv = tvList.length > 0 ? tvList[0].value : combined[0].value;
                selected = firstTv;
            }
            selectEl.value = selected;
            if (typeof localStorage !== 'undefined') localStorage.setItem('media-mgmt-last-instance', selected);
            handleInstanceChange(selected);
        }).catch(function() {
            selectEl.innerHTML = '<option value="">Failed to load instances</option>';
        });
    }

    function handleInstanceChange(val) {
        if (!val || val.indexOf(':') < 0) return;
        var parts = val.split(':');
        var type = parts[0];
        if (type === 'movie') {
            if (typeof localStorage !== 'undefined') localStorage.setItem('media-mgmt-last-instance', val);
            if (window.huntarrUI && window.huntarrUI.switchSection) {
                window.huntarrUI.switchSection('settings-media-management');
            }
        } else {
            load();
        }
    }

    function initOrRefresh() {
        var selectEl = document.getElementById('tv-management-instance-select');
        if (selectEl && selectEl.options.length <= 1) {
            populateInstanceDropdown();
        } else {
            load();
        }
        if (selectEl && !selectEl._tvMgmtBound) {
            selectEl._tvMgmtBound = true;
            selectEl.addEventListener('change', function() {
                var val = selectEl.value;
                if (typeof localStorage !== 'undefined') localStorage.setItem('media-mgmt-last-instance', val);
                handleInstanceChange(val);
            });
        }
    }

    /* ── TV Token Builder Data ─────────────────────────────────────── */

    var TV_EPISODE_PRESETS = [
        { name: 'Standard', format: "{Series TitleYear} - S{season:00}E{episode:00} - {Episode CleanTitle} {[Custom Formats]}{[Quality Full]}{[MediaInfo AudioCodec} {MediaInfo AudioChannels]}{[MediaInfo VideoDynamicRangeType]}{[MediaInfo VideoCodec]}{-Release Group}",
          example: "The Series Title! (2010) - S01E01 - Episode Title [AMZN WEBDL-1080p Proper][DTS 5.1][x264]-RlsGrp" },
        { name: 'Minimal', format: "{Series TitleYear} - S{season:00}E{episode:00} - {Episode CleanTitle} {Quality Full}",
          example: "The Series Title! (2010) - S01E01 - Episode Title WEBDL-1080p Proper" },
        { name: 'Scene Style', format: "{Series.CleanTitleYear}.S{season:00}E{episode:00}.{Episode.CleanTitle}.{Quality.Full}.{MediaInfo.VideoCodec}{-Release Group}",
          example: "The.Series.Title!.2010.S01E01.Episode.Title.WEBDL-1080p.x264-RlsGrp" },
    ];

    var TV_DAILY_PRESETS = [
        { name: 'Standard', format: "{Series TitleYear} - {Air-Date} - {Episode CleanTitle} {[Custom Formats]}{[Quality Full]}{[MediaInfo AudioCodec} {MediaInfo AudioChannels]}{[MediaInfo VideoDynamicRangeType]}{[MediaInfo VideoCodec]}{-Release Group}",
          example: "The Series Title! (2010) - 2013-10-30 - Episode Title [AMZN WEBDL-1080p Proper][DTS 5.1][x264]-RlsGrp" },
        { name: 'Minimal', format: "{Series TitleYear} - {Air-Date} - {Episode CleanTitle} {Quality Full}",
          example: "The Series Title! (2010) - 2013-10-30 - Episode Title WEBDL-1080p Proper" },
        { name: 'Scene Style', format: "{Series.CleanTitleYear}.{Air.Date}.{Episode.CleanTitle}.{Quality.Full}",
          example: "The.Series.Title!.2010.2013.10.30.Episode.Title.WEBDL-1080p.Proper" },
    ];

    var TV_ANIME_PRESETS = [
        { name: 'Standard', format: "{Series TitleYear} - S{season:00}E{episode:00} - {absolute:000} - {Episode CleanTitle} {[Custom Formats]}{[Quality Full]}{[MediaInfo AudioCodec} {MediaInfo AudioChannels]}{MediaInfo AudioLanguages}{[MediaInfo VideoDynamicRangeType]}[{MediaInfo VideoCodec }{MediaInfo VideoBitDepth}bit]{-Release Group}",
          example: "The Series Title! (2010) - S01E01 - 001 - Episode Title [HDTV-720p v2][DTS 5.1][JA][10bit][x264]-RlsGrp" },
        { name: 'Minimal', format: "{Series TitleYear} - S{season:00}E{episode:00} - {absolute:000} - {Episode CleanTitle} {Quality Full}",
          example: "The Series Title! (2010) - S01E01 - 001 - Episode Title WEBDL-1080p Proper" },
        { name: 'Absolute Only', format: "{Series TitleYear} - {absolute:000} - {Episode CleanTitle} {Quality Full}",
          example: "The Series Title! (2010) - 001 - Episode Title WEBDL-1080p Proper" },
    ];

    var TV_SERIES_FOLDER_PRESETS = [
        { name: 'Standard', format: '{Series TitleYear}',
          example: "The Series Title! (2010)" },
        { name: 'With IMDb', format: '{Series TitleYear} {imdb-{ImdbId}}',
          example: "The Series Title! (2010) {imdb-tt1520211}" },
        { name: 'With TVDb', format: '{Series TitleYear} {tvdb-{TvdbId}}',
          example: "The Series Title! (2010) {tvdb-1520211}" },
    ];

    var TV_SEASON_FOLDER_PRESETS = [
        { name: 'Standard', format: 'Season {season:00}',
          example: 'Season 01' },
        { name: 'Short', format: 'S{season:00}',
          example: 'S01' },
        { name: 'With Name', format: 'Season {season:0}',
          example: 'Season 1' },
    ];

    var TV_SPECIALS_FOLDER_PRESETS = [
        { name: 'Standard', format: 'Specials',
          example: 'Specials' },
        { name: 'Season 0', format: 'Season {season:00}',
          example: 'Season 00' },
    ];

    /* Token categories per builder type */
    var TV_SERIES_TOKENS = [
        { name: 'Series', icon: 'fa-tv', tokens: [
            { token: '{Series Title}', example: "The Series Title's!" },
            { token: '{Series CleanTitle}', example: "The Series Title's!" },
            { token: '{Series TitleYear}', example: "The Series Title's! (2010)" },
            { token: '{Series CleanTitleYear}', example: "The Series Title's! 2010" },
            { token: '{Series TitleWithoutYear}', example: "The Series Title's!" },
            { token: '{Series CleanTitleWithoutYear}', example: "The Series Title's!" },
            { token: '{Series TitleThe}', example: "Series Title's!, The" },
            { token: '{Series CleanTitleThe}', example: "Series Title's!, The" },
            { token: '{Series TitleTheYear}', example: "Series Title's!, The (2010)" },
            { token: '{Series CleanTitleTheYear}', example: "Series Title's!, The 2010" },
            { token: '{Series TitleFirstCharacter}', example: 'S' },
            { token: '{Series Year}', example: '2010' },
        ]},
        { name: 'Series ID', icon: 'fa-fingerprint', tokens: [
            { token: '{ImdbId}', example: 'tt12345' },
            { token: '{TvdbId}', example: '12345' },
            { token: '{TmdbId}', example: '11223' },
            { token: '{TvMazeId}', example: '54321' },
        ]},
    ];

    var TV_SEASON_TOKENS = [
        { name: 'Season', icon: 'fa-layer-group', tokens: [
            { token: '{season:0}', example: '1' },
            { token: '{season:00}', example: '01' },
        ]},
    ];

    var TV_EPISODE_TOKENS = [
        { name: 'Episode', icon: 'fa-hashtag', tokens: [
            { token: '{episode:0}', example: '1' },
            { token: '{episode:00}', example: '01' },
        ]},
        { name: 'Air Date', icon: 'fa-calendar-day', tokens: [
            { token: '{Air-Date}', example: '2016-03-20' },
            { token: '{Air Date}', example: '2016 03 20' },
        ]},
    ];

    var TV_ABSOLUTE_TOKENS = [
        { name: 'Absolute', icon: 'fa-sort-numeric-up', tokens: [
            { token: '{absolute:0}', example: '1' },
            { token: '{absolute:00}', example: '01' },
            { token: '{absolute:000}', example: '001' },
        ]},
    ];

    var TV_EPISODE_TITLE_TOKENS = [
        { name: 'Episode Title', icon: 'fa-quote-right', tokens: [
            { token: '{Episode Title}', example: "Episode's Title" },
            { token: '{Episode CleanTitle}', example: 'Episodes Title' },
        ]},
    ];

    var TV_QUALITY_TOKENS = [
        { name: 'Quality', icon: 'fa-star', tokens: [
            { token: '{Quality Full}', example: 'WEBDL-1080p Proper' },
            { token: '{Quality Title}', example: 'WEBDL-1080p' },
        ]},
    ];

    var TV_MEDIA_INFO_TOKENS = [
        { name: 'Media Info', icon: 'fa-info-circle', tokens: [
            { token: '{MediaInfo Simple}', example: 'x264 DTS' },
            { token: '{MediaInfo Full}', example: 'x264 DTS [EN+DE]' },
            { token: '{MediaInfo AudioCodec}', example: 'DTS' },
            { token: '{MediaInfo AudioChannels}', example: '5.1' },
            { token: '{MediaInfo AudioLanguages}', example: '[EN+DE]' },
            { token: '{MediaInfo AudioLanguagesAll}', example: '[EN]' },
            { token: '{MediaInfo SubtitleLanguages}', example: '[DE]' },
            { token: '{MediaInfo VideoCodec}', example: 'x264' },
            { token: '{MediaInfo VideoBitDepth}', example: '10' },
            { token: '{MediaInfo VideoDynamicRange}', example: 'HDR' },
            { token: '{MediaInfo VideoDynamicRangeType}', example: 'DV HDR10' },
        ]},
    ];

    var TV_RELEASE_TOKENS = [
        { name: 'Release', icon: 'fa-tag', tokens: [
            { token: '{Release Group}', example: 'Rls Grp' },
            { token: '{Custom Formats}', example: 'iNTERNAL' },
            { token: '{Custom Format:FormatName}', example: 'AMZN' },
        ]},
    ];

    var TV_ORIGINAL_TOKENS = [
        { name: 'Original', icon: 'fa-file', tokens: [
            { token: '{Original Title}', example: "The.Series.Title's!.S01E01.WEBDL.1080p.x264-EVOLVE" },
            { token: '{Original Filename}', example: "the.series.title's!.s01e01.webdl.1080p.x264-EVOLVE" },
        ]},
    ];

    var TV_ANIME_EXTRA_TOKENS = [
        { name: 'Anime Release', icon: 'fa-tag', tokens: [
            { token: '{Release Group}', example: 'Rls Grp' },
            { token: '{Release Hash}', example: 'ABCDEFGH' },
            { token: '{Custom Formats}', example: 'iNTERNAL' },
            { token: '{Custom Format:FormatName}', example: 'AMZN' },
        ]},
    ];

    function getBuilderConfig(builderType) {
        switch (builderType) {
            case 'tv-episode':
                return {
                    title: 'Episode File Name Builder',
                    icon: 'fa-file-video',
                    presets: TV_EPISODE_PRESETS,
                    categories: [].concat(TV_SERIES_TOKENS, TV_SEASON_TOKENS, TV_EPISODE_TOKENS, TV_EPISODE_TITLE_TOKENS, TV_QUALITY_TOKENS, TV_MEDIA_INFO_TOKENS, TV_RELEASE_TOKENS, TV_ORIGINAL_TOKENS)
                };
            case 'tv-daily':
                return {
                    title: 'Daily Episode File Name Builder',
                    icon: 'fa-calendar-alt',
                    presets: TV_DAILY_PRESETS,
                    categories: [].concat(TV_SERIES_TOKENS, TV_EPISODE_TOKENS, TV_EPISODE_TITLE_TOKENS, TV_QUALITY_TOKENS, TV_MEDIA_INFO_TOKENS, TV_RELEASE_TOKENS, TV_ORIGINAL_TOKENS)
                };
            case 'tv-anime':
                return {
                    title: 'Anime Episode File Name Builder',
                    icon: 'fa-dragon',
                    presets: TV_ANIME_PRESETS,
                    categories: [].concat(TV_SERIES_TOKENS, TV_SEASON_TOKENS, TV_EPISODE_TOKENS, TV_ABSOLUTE_TOKENS, TV_EPISODE_TITLE_TOKENS, TV_QUALITY_TOKENS, TV_MEDIA_INFO_TOKENS, TV_ANIME_EXTRA_TOKENS, TV_ORIGINAL_TOKENS)
                };
            case 'tv-series-folder':
                return {
                    title: 'Series Folder Name Builder',
                    icon: 'fa-folder-open',
                    presets: TV_SERIES_FOLDER_PRESETS,
                    categories: TV_SERIES_TOKENS
                };
            case 'tv-season-folder':
                return {
                    title: 'Season Folder Name Builder',
                    icon: 'fa-folder',
                    presets: TV_SEASON_FOLDER_PRESETS,
                    categories: TV_SEASON_TOKENS
                };
            case 'tv-specials-folder':
                return {
                    title: 'Specials Folder Name Builder',
                    icon: 'fa-folder',
                    presets: TV_SPECIALS_FOLDER_PRESETS,
                    categories: TV_SEASON_TOKENS
                };
            default:
                return {
                    title: 'Token Builder',
                    icon: 'fa-puzzle-piece',
                    presets: TV_EPISODE_PRESETS,
                    categories: [].concat(TV_SERIES_TOKENS, TV_SEASON_TOKENS, TV_EPISODE_TOKENS, TV_EPISODE_TITLE_TOKENS, TV_QUALITY_TOKENS, TV_MEDIA_INFO_TOKENS, TV_RELEASE_TOKENS, TV_ORIGINAL_TOKENS)
                };
        }
    }

    function openTokenBuilder(targetInputId, builderType) {
        var existing = document.getElementById('token-builder-modal');
        if (existing) existing.remove();

        var config = getBuilderConfig(builderType);
        var targetInput = document.getElementById(targetInputId);
        var currentValue = targetInput ? targetInput.value : '';

        var html = '<div class="tkb-overlay" id="token-builder-modal">' +
            '<div class="tkb-modal">' +
            '<div class="tkb-header">' +
            '<div class="tkb-header-left"><i class="fas ' + config.icon + '"></i><span>' + config.title + '</span></div>' +
            '<button class="tkb-close" id="tkb-close-btn"><i class="fas fa-times"></i></button>' +
            '</div>' +
            '<div class="tkb-body">';

        html += '<div class="tkb-presets-section">' +
            '<div class="tkb-cat-header"><i class="fas fa-magic"></i> Quick Presets</div>' +
            '<div class="tkb-presets">';
        config.presets.forEach(function(p, idx) {
            html += '<button type="button" class="tkb-preset" data-preset-idx="' + idx + '">' +
                '<div class="tkb-preset-name">' + escapeHtml(p.name) + '</div>' +
                '<div class="tkb-preset-format">' + escapeHtml(p.format) + '</div>' +
                '<div class="tkb-preset-example">' + escapeHtml(p.example) + '</div>' +
                '</button>';
        });
        html += '</div></div>';

        config.categories.forEach(function(cat) {
            html += '<div class="tkb-category">' +
                '<div class="tkb-cat-header"><i class="fas ' + cat.icon + '"></i> ' + escapeHtml(cat.name) + '</div>' +
                '<div class="tkb-tokens">';
            cat.tokens.forEach(function(t) {
                html += '<button type="button" class="tkb-token" data-token="' + escapeHtml(t.token) + '">' +
                    '<span class="tkb-token-name">' + escapeHtml(t.token) + '</span>' +
                    '<span class="tkb-token-example">' + escapeHtml(t.example) + '</span>' +
                    '</button>';
            });
            html += '</div></div>';
        });

        html += '</div>' +
            '<div class="tkb-footer">' +
            '<div class="tkb-preview-label">Current Format</div>' +
            '<input type="text" class="tkb-preview-input" id="tkb-preview-input" value="' + escapeHtml(currentValue) + '" readonly>' +
            '<div class="tkb-footer-actions">' +
            '<button type="button" class="tkb-btn tkb-btn-clear" id="tkb-clear-btn"><i class="fas fa-eraser"></i> Clear</button>' +
            '<button type="button" class="tkb-btn tkb-btn-done" id="tkb-done-btn"><i class="fas fa-check"></i> Done</button>' +
            '</div>' +
            '</div>' +
            '</div></div>';

        document.body.insertAdjacentHTML('beforeend', html);
        var modal = document.getElementById('token-builder-modal');

        document.getElementById('tkb-close-btn').addEventListener('click', function() { modal.remove(); });
        modal.addEventListener('click', function(e) { if (e.target === modal) modal.remove(); });

        modal.querySelectorAll('.tkb-preset').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var idx = parseInt(btn.getAttribute('data-preset-idx'), 10);
                var preset = config.presets[idx];
                if (!preset) return;
                var input = document.getElementById(targetInputId);
                var preview = document.getElementById('tkb-preview-input');
                if (input) { input.value = preset.format; markDirty(); }
                if (preview) preview.value = preset.format;
                modal.querySelectorAll('.tkb-preset').forEach(function(b) { b.classList.remove('tkb-preset-active'); });
                btn.classList.add('tkb-preset-active');
            });
        });

        modal.querySelectorAll('.tkb-token').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var token = btn.getAttribute('data-token');
                var input = document.getElementById(targetInputId);
                var preview = document.getElementById('tkb-preview-input');
                if (input) {
                    var val = input.value;
                    var needsSpace = val.length > 0 && val[val.length - 1] !== ' ' && val[val.length - 1] !== '(' && val[val.length - 1] !== '[' && val[val.length - 1] !== '{';
                    input.value = val + (needsSpace ? ' ' : '') + token;
                    markDirty();
                }
                if (preview && input) preview.value = input.value;
                btn.classList.add('tkb-token-added');
                setTimeout(function() { btn.classList.remove('tkb-token-added'); }, 400);
            });
        });

        document.getElementById('tkb-clear-btn').addEventListener('click', function() {
            var input = document.getElementById(targetInputId);
            var preview = document.getElementById('tkb-preview-input');
            if (input) { input.value = ''; markDirty(); }
            if (preview) preview.value = '';
            modal.querySelectorAll('.tkb-preset').forEach(function(b) { b.classList.remove('tkb-preset-active'); });
        });

        document.getElementById('tkb-done-btn').addEventListener('click', function() { modal.remove(); });

        function escHandler(e) { if (e.key === 'Escape') { modal.remove(); document.removeEventListener('keydown', escHandler); } }
        document.addEventListener('keydown', escHandler);
    }

    function attachTokenBuilderButtons() {
        document.querySelectorAll('#tv-management-content .token-builder-btn').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.preventDefault();
                var target = btn.getAttribute('data-target');
                var builder = btn.getAttribute('data-builder') || 'tv-episode';
                if (target) openTokenBuilder(target, builder);
            });
        });
    }

    window.TVManagement = {
        load: load,
        save: save,
        cancel: cancel,
        isDirty: function() { return _dirty; },
        confirmLeave: confirmLeave,
        initOrRefresh: initOrRefresh
    };
})();


/* === modules/features/settings/client-editor.js === */
/**
 * Client Editor (Movie Hunt) - full-page editor for adding/editing a download client.
 * Separate from Client Management (clients.js). Attaches to window.SettingsForms.
 * Load after settings/core.js and instance-editor.js.
 */
(function() {
    'use strict';
    if (typeof window.SettingsForms === 'undefined') return;

    const Forms = window.SettingsForms;

    var CLIENT_TYPES = [
        { value: 'nzbhunt', label: 'NZB Hunt (Built-in)' },
        { value: 'nzbget', label: 'NZBGet' },
        { value: 'sabnzbd', label: 'SABnzbd' }
    ];

    var PRIORITY_OPTIONS = [
        { value: 'last', label: 'Last' },
        { value: 'first', label: 'First' },
        { value: 'default', label: 'Default' },
        { value: 'high', label: 'High' },
        { value: 'low', label: 'Low' }
    ];

    Forms.openClientEditor = function(isAdd, index, instance) {
        const inst = instance || {};
        this._currentEditing = { appType: 'client', index: index, isAdd: isAdd, originalInstance: JSON.parse(JSON.stringify(inst)) };

        const typeRaw = (inst.type || 'nzbget').toLowerCase().trim();
        const typeVal = CLIENT_TYPES.some(function(o) { return o.value === typeRaw; }) ? typeRaw : 'nzbget';
        const clientDisplayName = (CLIENT_TYPES.find(function(o) { return o.value === typeVal; }) || { label: typeVal }).label;

        const titleEl = document.getElementById('instance-editor-title');
        if (titleEl) {
            titleEl.innerHTML = '<span class="client-editor-title-app">' + String(clientDisplayName).replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span> Connection Settings';
        }

        const contentEl = document.getElementById('instance-editor-content');
        if (contentEl) contentEl.innerHTML = this.generateClientEditorHtml(inst);

        const saveBtn = document.getElementById('instance-editor-save');
        const backBtn = document.getElementById('instance-editor-back');
        if (saveBtn) {
            saveBtn.onclick = () => this.saveClientFromEditor();
            saveBtn.disabled = false;
            saveBtn.classList.add('enabled');
        }
        if (backBtn) backBtn.onclick = () => this.cancelInstanceEditor();

        const enabledSelect = document.getElementById('editor-client-enabled');
        const enableIcon = document.getElementById('client-enable-status-icon');
        if (enabledSelect && enableIcon) {
            enabledSelect.addEventListener('change', function() {
                const isEnabled = enabledSelect.value === 'true';
                enableIcon.className = isEnabled ? 'fas fa-check-circle' : 'fas fa-minus-circle';
                enableIcon.style.color = isEnabled ? '#10b981' : '#ef4444';
            });
        }

        // Add event listeners for real-time connection status checking
        // For NZB Hunt, only check on initial load (no host/port fields)
        if (typeVal !== 'nzbhunt') {
            const hostEl = document.getElementById('editor-client-host');
            const portEl = document.getElementById('editor-client-port');
            const apiKeyEl = document.getElementById('editor-client-apikey');
            const usernameEl = document.getElementById('editor-client-username');
            const passwordEl = document.getElementById('editor-client-password');
            
            if (hostEl) hostEl.addEventListener('input', () => this.checkClientConnection());
            if (portEl) portEl.addEventListener('input', () => this.checkClientConnection());
            if (apiKeyEl) apiKeyEl.addEventListener('input', () => this.checkClientConnection());
            if (usernameEl) usernameEl.addEventListener('input', () => this.checkClientConnection());
            if (passwordEl) passwordEl.addEventListener('input', () => this.checkClientConnection());
        }
        
        // Initial connection check (skip for NZB Hunt - built-in, no status needed)
        if (typeVal !== 'nzbhunt') {
            this.checkClientConnection();
        }

        if (window.huntarrUI && window.huntarrUI.switchSection) {
            window.huntarrUI.switchSection('instance-editor');
        }
    };

    Forms.generateClientEditorHtml = function(instance) {
        const name = (instance.name || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        const typeRaw = (instance.type || 'nzbget').toLowerCase().trim();
        const typeVal = CLIENT_TYPES.some(function(o) { return o.value === typeRaw; }) ? typeRaw : 'nzbget';
        const host = (instance.host || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        const port = instance.port !== undefined && instance.port !== '' ? String(instance.port) : '8080';
        const username = (instance.username || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        const enabled = instance.enabled !== false;
        const isEdit = !!(instance.name && instance.name.trim());
        
        const apiKeyPlaceholder = isEdit && (instance.api_key_last4 || '')
            ? ('Enter new key or leave blank to keep existing (••••' + (instance.api_key_last4 || '') + ')')
            : 'Enter API key';
        const pwdPlaceholder = isEdit && (instance.password_last4 || '')
            ? ('Enter new password or leave blank to keep existing (••••' + (instance.password_last4 || '') + ')')
            : 'Password (if required)';
        const category = (instance.category || 'movies').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        const recentPriority = (instance.recent_priority || 'default').toLowerCase();
        const olderPriority = (instance.older_priority || 'default').toLowerCase();
        let clientPriority = parseInt(instance.client_priority, 10);
        if (isNaN(clientPriority) || clientPriority < 1 || clientPriority > 99) clientPriority = 50;

        const recentOptionsHtml = PRIORITY_OPTIONS.map(function(o) {
            return '<option value="' + o.value + '"' + (recentPriority === o.value ? ' selected' : '') + '>' + o.label + '</option>';
        }).join('');
        const olderOptionsHtml = PRIORITY_OPTIONS.map(function(o) {
            return '<option value="' + o.value + '"' + (olderPriority === o.value ? ' selected' : '') + '>' + o.label + '</option>';
        }).join('');

        const isNzbHunt = typeVal === 'nzbhunt';
        const hideForNzbHunt = isNzbHunt ? ' style="display: none;"' : '';
        const nzbHuntGridClass = isNzbHunt ? ' editor-grid-nzbhunt' : '';

        return `
            <div class="editor-grid${nzbHuntGridClass}">
                <div class="editor-section${isNzbHunt ? ' editor-section-single' : ''}">
                    <div class="editor-section-title" style="display: flex; align-items: center; justify-content: space-between;">
                        <span>${isNzbHunt ? 'NZB Hunt (Built-in)' : 'Connection Settings'}</span>
                        <div id="client-connection-status-container" style="display: ${isNzbHunt ? 'none' : 'flex'}; justify-content: flex-end; flex: 1;"></div>
                    </div>
                    ${isNzbHunt ? `
                    <div class="editor-field-group">
                        <div style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 8px; padding: 16px; margin-bottom: 12px;">
                            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
                                <i class="fas fa-bolt" style="color: #10b981; font-size: 1.2rem;"></i>
                                <strong style="color: #10b981;">Built-in Download Client</strong>
                            </div>
                            <p style="color: #94a3b8; margin: 0; font-size: 0.9rem; line-height: 1.5;">
                                NZB Hunt is Huntarr's integrated usenet download client. No external host, port, or API keys needed &mdash; 
                                it uses the usenet servers configured in <strong>NZB Hunt → Settings → Servers</strong>.
                            </p>
                        </div>
                    </div>
                    ` : ''}
                    <div class="editor-field-group">
                        <div class="editor-setting-item">
                            <label style="display: flex; align-items: center;">
                                <span>Enable Status</span>
                                <i id="client-enable-status-icon" class="fas ${enabled ? 'fa-check-circle' : 'fa-minus-circle'}" style="color: ${enabled ? '#10b981' : '#ef4444'}; font-size: 1.1rem; margin-left: 8px;"></i>
                            </label>
                            <select id="editor-client-enabled">
                                <option value="true" ${enabled ? 'selected' : ''}>Enabled</option>
                                <option value="false" ${!enabled ? 'selected' : ''}>Disabled</option>
                            </select>
                        </div>
                        <p class="editor-help-text">Enable or disable this download client</p>
                    </div>
                    ${!isNzbHunt ? `
                    <div class="editor-field-group">
                        <label for="editor-client-name">Name</label>
                        <input type="text" id="editor-client-name" value="${name}" placeholder="${typeVal === 'sabnzbd' ? 'e.g. My SABnzbd' : 'e.g. My NZBGet'}" />
                        <p class="editor-help-text">A friendly name to identify this client</p>
                    </div>
                    ` : ''}
                    <div class="editor-field-group"${hideForNzbHunt}>
                        <label for="editor-client-host">Host</label>
                        <input type="text" id="editor-client-host" value="${host}" placeholder="localhost or 192.168.1.10" />
                        <p class="editor-help-text">Hostname or IP address of your download client</p>
                    </div>
                    <div class="editor-field-group"${hideForNzbHunt}>
                        <label for="editor-client-port">Port</label>
                        <input type="number" id="editor-client-port" value="${port}" placeholder="8080" min="1" max="65535" />
                        <p class="editor-help-text">Port number for your download client (SABnzbd default: 8080, NZBGet default: 6789)</p>
                    </div>
                    <div class="editor-field-group"${hideForNzbHunt}>
                        <label for="editor-client-apikey">API Key</label>
                        <input type="password" id="editor-client-apikey" placeholder="${apiKeyPlaceholder.replace(/"/g, '&quot;')}" autocomplete="off" />
                        <p class="editor-help-text">API key from your download client settings. ${isEdit ? 'Leave blank to keep existing.' : ''}</p>
                    </div>
                    <div class="editor-field-group"${hideForNzbHunt}>
                        <label for="editor-client-username">Username</label>
                        <input type="text" id="editor-client-username" value="${username}" placeholder="Username (if required)" autocomplete="off" />
                        <p class="editor-help-text">Username for basic authentication (NZBGet typically requires this)</p>
                    </div>
                    <div class="editor-field-group"${hideForNzbHunt}>
                        <label for="editor-client-password">Password</label>
                        <input type="password" id="editor-client-password" placeholder="${pwdPlaceholder.replace(/"/g, '&quot;')}" autocomplete="off" />
                        <p class="editor-help-text">${isEdit ? 'Leave blank to keep existing password' : 'Password for authentication (if required)'}</p>
                    </div>
                    ${!isNzbHunt ? `
                </div>
                <div class="editor-section">
                    <div class="editor-section-title">Additional Configurations</div>
                    <div class="editor-field-group">
                        <label for="editor-client-category">Category</label>
                        <input type="text" id="editor-client-category" value="${category}" placeholder="movies" />
                        <p class="editor-help-text">Adding a category specific to Movie Hunt avoids conflicts with unrelated non–Movie Hunt downloads. Using a category is optional, but strongly recommended.</p>
                    </div>
                    ` : ''}
                    <div class="editor-field-group">
                        <label for="editor-client-recent-priority">Recent Priority</label>
                        <select id="editor-client-recent-priority">${recentOptionsHtml}</select>
                        <p class="editor-help-text">Priority to use when grabbing movies that aired within the last 21 days.</p>
                    </div>
                    <div class="editor-field-group">
                        <label for="editor-client-older-priority">Older Priority</label>
                        <select id="editor-client-older-priority">${olderOptionsHtml}</select>
                        <p class="editor-help-text">Priority to use when grabbing movies that aired over 21 days ago.</p>
                    </div>
                    <div class="editor-field-group">
                        <label for="editor-client-priority">Client Priority</label>
                        <input type="number" id="editor-client-priority" value="${clientPriority}" min="1" max="99" placeholder="50" />
                        <p class="editor-help-text">Download Client Priority from 1 (Highest) to 99 (Lowest). Default: 50. Round-Robin is used for clients with the same priority.</p>
                    </div>
                </div>
            </div>
        `;
    };

    Forms.saveClientFromEditor = function() {
        if (!this._currentEditing || this._currentEditing.appType !== 'client') return;
        const nameEl = document.getElementById('editor-client-name');
        const hostEl = document.getElementById('editor-client-host');
        const portEl = document.getElementById('editor-client-port');
        const enabledEl = document.getElementById('editor-client-enabled');
        const apiKeyEl = document.getElementById('editor-client-apikey');
        const usernameEl = document.getElementById('editor-client-username');
        const passwordEl = document.getElementById('editor-client-password');
        const categoryEl = document.getElementById('editor-client-category');
        const recentPriorityEl = document.getElementById('editor-client-recent-priority');
        const olderPriorityEl = document.getElementById('editor-client-older-priority');
        const clientPriorityEl = document.getElementById('editor-client-priority');

        const type = (this._currentEditing && this._currentEditing.originalInstance && this._currentEditing.originalInstance.type)
            ? String(this._currentEditing.originalInstance.type).trim().toLowerCase()
            : 'nzbget';
        const isNzbHuntType = (type === 'nzbhunt' || type === 'nzb_hunt');
        const name = isNzbHuntType ? 'NZB Hunt' : (nameEl ? nameEl.value.trim() : '');
        const host = hostEl ? hostEl.value.trim() : '';
        let port = 8080;
        if (portEl && portEl.value.trim() !== '') {
            const p = parseInt(portEl.value, 10);
            if (!isNaN(p)) port = p;
        }
        const enabled = enabledEl ? enabledEl.value === 'true' : true;
        const apiKey = apiKeyEl ? apiKeyEl.value.trim() : '';
        const username = usernameEl ? usernameEl.value.trim() : '';
        const password = passwordEl ? passwordEl.value.trim() : '';
        let category = (categoryEl && !isNzbHuntType) ? categoryEl.value.trim() : 'movies';
        if (isNzbHuntType) {
            const orig = this._currentEditing && this._currentEditing.originalInstance;
            category = (orig && orig.category) ? String(orig.category).trim() : '';
        }
        const recentPriority = recentPriorityEl ? (recentPriorityEl.value || 'default').toLowerCase() : 'default';
        const olderPriority = olderPriorityEl ? (olderPriorityEl.value || 'default').toLowerCase() : 'default';
        let clientPriority = 50;
        if (clientPriorityEl && clientPriorityEl.value.trim() !== '') {
            const p = parseInt(clientPriorityEl.value, 10);
            if (!isNaN(p) && p >= 1 && p <= 99) clientPriority = p;
        }

        const body = {
            name: isNzbHuntType ? 'NZB Hunt' : (name || 'Unnamed'),
            type: type,
            host: isNzbHuntType ? 'internal' : host,
            port: isNzbHuntType ? 0 : port,
            enabled: enabled,
            category: category || 'movies',
            recent_priority: recentPriority,
            older_priority: olderPriority,
            client_priority: clientPriority
        };
        if (!isNzbHuntType) {
            if (apiKey) body.api_key = apiKey;
            if (username) body.username = username;
            if (password) body.password = password;
        }

        const isAdd = this._currentEditing.isAdd;
        const index = this._currentEditing.index;
        const url = isAdd ? './api/clients' : './api/clients/' + index;
        const method = isAdd ? 'POST' : 'PUT';

        fetch(url, { method: method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
            .then(function(r) {
                return r.json().then(function(data) { return { ok: r.ok, data: data }; });
            })
            .then(function(result) {
                if (!result.ok) {
                    var msg = (result.data && result.data.error) ? result.data.error : 'Save failed';
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification(msg, 'error');
                    }
                    return;
                }
                var data = result.data;
                if (window.SettingsForms && window.SettingsForms.refreshClientsList) {
                    window.SettingsForms.refreshClientsList();
                }
                // Refresh NZB Hunt sidebar group visibility (may have added/removed NZB Hunt client)
                if (window.huntarrUI && typeof window.huntarrUI._refreshNzbHuntSidebarGroup === 'function') {
                    window.huntarrUI._refreshNzbHuntSidebarGroup();
                }
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification(isAdd ? 'Client added.' : 'Client updated.', 'success');
                }
                // Don't auto-navigate back to collection after saving a client.
                // The user may want to add more clients. The wizard banner on the
                // clients page handles the "continue" flow when the user is ready.
                if (window.SettingsForms && window.SettingsForms._currentEditing) {
                    window.SettingsForms._currentEditing.isAdd = false;
                    if (data && data.index !== undefined) {
                        window.SettingsForms._currentEditing.index = data.index;
                    } else if (!isAdd) {
                        window.SettingsForms._currentEditing.index = index;
                    }
                }
            })
            .catch(function(err) {
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification(err.message || 'Failed to save client', 'error');
                }
            });
    };

    Forms.checkClientConnection = function() {
        const container = document.getElementById('client-connection-status-container');
        const hostEl = document.getElementById('editor-client-host');
        const portEl = document.getElementById('editor-client-port');
        const apiKeyEl = document.getElementById('editor-client-apikey');
        const usernameEl = document.getElementById('editor-client-username');
        const passwordEl = document.getElementById('editor-client-password');
        
        if (!container) return;
        
        container.style.display = 'flex';
        container.style.justifyContent = 'flex-end';
        
        // Get client type
        const type = (this._currentEditing && this._currentEditing.originalInstance && this._currentEditing.originalInstance.type)
            ? String(this._currentEditing.originalInstance.type).trim().toLowerCase()
            : 'nzbget';
        
        // NZB Hunt (built-in) - no connection status; it's built-in and managed in NZB Hunt Settings
        if (type === 'nzbhunt' || type === 'nzb_hunt') {
            if (container) container.style.display = 'none';
            return;
        }
        
        const host = hostEl ? hostEl.value.trim() : '';
        const port = portEl ? portEl.value.trim() : '';
        const apiKey = apiKeyEl ? apiKeyEl.value.trim() : '';
        const username = usernameEl ? usernameEl.value.trim() : '';
        const password = passwordEl ? passwordEl.value.trim() : '';
        
        // Check if minimum requirements are met
        if (!host || !port) {
            container.innerHTML = '<span class="connection-status" style="background: rgba(251, 191, 36, 0.1); color: #fbbf24; border: 1px solid rgba(251, 191, 36, 0.2);"><i class="fas fa-exclamation-triangle"></i><span>Enter host and port</span></span>';
            return;
        }
        
        // Show checking status
        container.innerHTML = '<span class="connection-status checking"><i class="fas fa-spinner fa-spin"></i><span>Checking...</span></span>';
        
        // Test connection
        fetch('./api/clients/test-connection', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                type: type,
                host: host,
                port: parseInt(port, 10) || 8080,
                api_key: apiKey,
                username: username,
                password: password
            })
        })
        .then(function(r) { return r.json().then(function(data) { return { ok: r.ok, data: data }; }); })
        .then(function(result) {
            const data = result.data || {};
            if (data.success === true) {
                container.innerHTML = '<span class="connection-status success"><i class="fas fa-check-circle"></i><span>Connected</span></span>';
            } else {
                container.innerHTML = '<span class="connection-status error"><i class="fas fa-times-circle"></i><span>' + (data.message || data.error || 'Connection failed') + '</span></span>';
            }
        })
        .catch(function(err) {
            container.innerHTML = '<span class="connection-status error"><i class="fas fa-times-circle"></i><span>' + (err.message || 'Connection failed') + '</span></span>';
        });
    };
})();


/* === modules/features/settings/clients.js === */
/**
 * Client Management (Movie Hunt) - list and CRUD for download clients.
 * Separate from Client Editor (client-editor.js). Attaches to window.SettingsForms.
 * Load after client-editor.js so openClientEditor is available for grid clicks.
 */
(function() {
    'use strict';
    if (typeof window.SettingsForms === 'undefined') return;

    const Forms = window.SettingsForms;

    Forms.renderClientCard = function(client, index) {
        const name = (client.name || 'Unnamed').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const type = (client.type || 'nzbget').replace(/"/g, '&quot;');
        const isNzbHunt = type === 'nzbhunt';
        const enabled = client.enabled !== false;
        const statusClass = enabled ? 'status-connected' : 'status-error';
        const statusIcon = enabled ? 'fa-check-circle' : 'fa-minus-circle';
        const priority = client.client_priority !== undefined && client.client_priority !== null ? Number(client.client_priority) : 50;
        
        var bodyHtml;
        if (isNzbHunt) {
            bodyHtml = '<div class="instance-detail"><i class="fas fa-bolt" style="color: #10b981;"></i><span style="color: #10b981; font-weight: 500;">Built-in Client</span></div>' +
                '<div class="instance-detail"><i class="fas fa-server"></i><span>Uses NZB Hunt Servers</span></div>';
        } else {
            var last4 = client.api_key_last4 || client.password_last4 || '****';
            bodyHtml = '<div class="instance-detail"><i class="fas fa-key"></i><span>••••••••' + last4 + '</span></div>' +
                '<div class="instance-detail"><i class="fas fa-server"></i><span>' + (client.host || '').replace(/</g, '&lt;') + ':' + (client.port !== undefined ? client.port : '') + '</span></div>';
        }
        
        return '<div class="instance-card" data-instance-index="' + index + '" data-app-type="client" data-type="' + type + '" data-enabled="' + enabled + '">' +
            '<div class="instance-card-header">' +
            '<div class="instance-name instance-name-with-priority"><i class="fas ' + (isNzbHunt ? 'fa-bolt' : 'fa-download') + '"></i><span>' + name + '</span><span class="client-priority-badge">Priority: ' + String(priority) + '</span></div>' +
            '<div class="instance-status-icon ' + statusClass + '"><i class="fas ' + statusIcon + '"></i></div>' +
            '</div>' +
            '<div class="instance-card-body">' + bodyHtml + '</div>' +
            '<div class="instance-card-footer">' +
            '<button type="button" class="btn-card edit" data-app-type="client" data-instance-index="' + index + '"><i class="fas fa-edit"></i> Edit</button>' +
            '<button type="button" class="btn-card delete" data-app-type="client" data-instance-index="' + index + '"><i class="fas fa-trash"></i> Delete</button>' +
            '</div></div>';
    };

    Forms.refreshClientsList = function() {
        // Refresh NZB Hunt sidebar group visibility whenever client list changes
        if (window.huntarrUI && typeof window.huntarrUI._refreshNzbHuntSidebarGroup === 'function') {
            window.huntarrUI._refreshNzbHuntSidebarGroup();
        }
        const grid = document.getElementById('client-instances-grid');
        if (!grid) return;
        _doRefreshClientsList(grid);
    };

    function _doRefreshClientsList(grid) {
        fetch('./api/clients')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                const list = (data && data.clients) ? data.clients : [];
                window.SettingsForms._clientsList = list;
                var withIndex = list.map(function(c, i) { return { client: c, originalIndex: i }; });
                withIndex.sort(function(a, b) {
                    var pa = Number(a.client.client_priority) || 50;
                    var pb = Number(b.client.client_priority) || 50;
                    if (pa !== pb) return pa - pb;
                    var na = (a.client.name || '').toLowerCase();
                    var nb = (b.client.name || '').toLowerCase();
                    return na.localeCompare(nb);
                });
                var html = '';
                for (var i = 0; i < withIndex.length; i++) {
                    html += window.SettingsForms.renderClientCard(withIndex[i].client, withIndex[i].originalIndex);
                }
                html += '<div class="add-instance-card" data-app-type="client"><div class="add-icon"><i class="fas fa-plus-circle"></i></div><div class="add-text">Add Client</div></div>';
                grid.innerHTML = html;
                
                // Also refresh remote mappings if available
                if (window.RemoteMappings && typeof window.RemoteMappings.refreshList === 'function') {
                    window.RemoteMappings.refreshList();
                }
                // Dispatch event so UI can react to client list changes
                document.dispatchEvent(new CustomEvent('huntarr:clients-list-updated', { detail: { clients: list } }));
            })
            .catch(function() {
                grid.innerHTML = '<div class="add-instance-card" data-app-type="client"><div class="add-icon"><i class="fas fa-plus-circle"></i></div><div class="add-text">Add Client</div></div>';
            });
    }

    document.addEventListener('huntarr:instances-changed', function() {
        if (document.getElementById('settings-clients-content-wrapper') && window.huntarrUI && window.huntarrUI.currentSection === 'settings-clients') {
            Forms.refreshClientsList();
        }
    });
    document.addEventListener('huntarr:tv-hunt-instances-changed', function() {
        if (document.getElementById('settings-clients-content-wrapper') && window.huntarrUI && window.huntarrUI.currentSection === 'settings-clients') {
            Forms.refreshClientsList();
        }
    });
})();


/* === modules/features/settings/import-lists.js === */
/**
 * Import Lists – single view for Movie Hunt and TV Hunt. Combined instance dropdown
 * (Movie - X / TV - X, alphabetical). Each instance keeps its own lists; same page linked from both sidebars.
 * TV Hunt returns empty lists (stub) until TV import lists are implemented.
 */
(function() {
    'use strict';

    var listTypes = null; // cached from API
    var currentEditId = null;
    var selectedType = null;

    window.ImportLists = {
        _ilMode: 'movie',

        getApiBase: function() {
            return this._ilMode === 'tv' ? './api/tv-hunt/import-lists' : './api/movie-hunt/import-lists';
        },

        getInstanceId: function() {
            var sel = document.getElementById('settings-import-lists-instance-select');
            var v = sel && sel.value ? sel.value : '';
            if (v && v.indexOf(':') >= 0) return v.split(':')[1] || '';
            return v || '';
        },

        _appendInstanceParam: function(url) {
            var id = this.getInstanceId();
            if (!id) return url;
            return url + (url.indexOf('?') >= 0 ? '&' : '?') + 'instance_id=' + encodeURIComponent(id);
        },

        _safeJsonFetch: function(url, fallback) {
            return fetch(url, { cache: 'no-store' }).then(function(r) { return r.json(); }).catch(function() { return fallback || {}; });
        },

        populateCombinedInstanceDropdown: function(preferMode) {
            var self = window.ImportLists;
            var selectEl = document.getElementById('settings-import-lists-instance-select');
            if (!selectEl) return;
            selectEl.innerHTML = '<option value="">Loading...</option>';
            var ts = Date.now();
            var sf = self._safeJsonFetch.bind(self);
            Promise.all([
                sf('./api/movie-hunt/instances?t=' + ts, { instances: [] }),
                sf('./api/tv-hunt/instances?t=' + ts, { instances: [] }),
                sf('./api/movie-hunt/instances/current?t=' + ts, { current_instance_id: null }),
                sf('./api/tv-hunt/instances/current?t=' + ts, { current_instance_id: null }),
                sf('./api/indexer-hunt/indexers?t=' + ts, { indexers: [] }),
                sf('./api/movie-hunt/has-clients?t=' + ts, { has_clients: false })
            ]).then(function(results) {
                var movieList = (results[0].instances || []).map(function(inst) {
                    return { value: 'movie:' + inst.id, label: 'Movie - ' + (inst.name || 'Instance ' + inst.id) };
                });
                var tvList = (results[1].instances || []).map(function(inst) {
                    return { value: 'tv:' + inst.id, label: 'TV - ' + (inst.name || 'Instance ' + inst.id) };
                });
                var combined = movieList.concat(tvList);
                combined.sort(function(a, b) { return (a.label || '').localeCompare(b.label || '', undefined, { sensitivity: 'base' }); });
                var currentMovie = results[2].current_instance_id != null ? Number(results[2].current_instance_id) : null;
                var currentTv = results[3].current_instance_id != null ? Number(results[3].current_instance_id) : null;
                selectEl.innerHTML = '';
                if (combined.length === 0) {
                    var emptyOpt = document.createElement('option');
                    emptyOpt.value = '';
                    emptyOpt.textContent = 'No Movie or TV Hunt instances';
                    selectEl.appendChild(emptyOpt);
                    var noInstEl = document.getElementById('settings-import-lists-no-instances');
                    var noIdxEl = document.getElementById('settings-import-lists-no-indexers');
                    var noCliEl = document.getElementById('settings-import-lists-no-clients');
                    var wrapperEl = document.getElementById('settings-import-lists-content-wrapper');
                    if (noInstEl) noInstEl.style.display = '';
                    if (noIdxEl) noIdxEl.style.display = 'none';
                    if (noCliEl) noCliEl.style.display = 'none';
                    if (wrapperEl) wrapperEl.style.display = 'none';
                    return;
                }
                var indexerCount = (results[4].indexers || []).length;
                if (indexerCount === 0) {
                    selectEl.innerHTML = '';
                    var emptyOpt = document.createElement('option');
                    emptyOpt.value = '';
                    emptyOpt.textContent = 'No indexers configured';
                    selectEl.appendChild(emptyOpt);
                    var noInstEl = document.getElementById('settings-import-lists-no-instances');
                    var noIdxEl = document.getElementById('settings-import-lists-no-indexers');
                    var noCliEl = document.getElementById('settings-import-lists-no-clients');
                    var wrapperEl = document.getElementById('settings-import-lists-content-wrapper');
                    if (noInstEl) noInstEl.style.display = 'none';
                    if (noIdxEl) noIdxEl.style.display = '';
                    if (noCliEl) noCliEl.style.display = 'none';
                    if (wrapperEl) wrapperEl.style.display = 'none';
                    return;
                }
                var hasClients = results[5].has_clients === true;
                if (!hasClients) {
                    selectEl.innerHTML = '';
                    var emptyOpt = document.createElement('option');
                    emptyOpt.value = '';
                    emptyOpt.textContent = 'No clients configured';
                    selectEl.appendChild(emptyOpt);
                    var noInstEl = document.getElementById('settings-import-lists-no-instances');
                    var noIdxEl = document.getElementById('settings-import-lists-no-indexers');
                    var noCliEl = document.getElementById('settings-import-lists-no-clients');
                    var wrapperEl = document.getElementById('settings-import-lists-content-wrapper');
                    if (noInstEl) noInstEl.style.display = 'none';
                    if (noIdxEl) noIdxEl.style.display = 'none';
                    if (noCliEl) noCliEl.style.display = '';
                    if (wrapperEl) wrapperEl.style.display = 'none';
                    return;
                }
                combined.forEach(function(item) {
                    var opt = document.createElement('option');
                    opt.value = item.value;
                    opt.textContent = item.label;
                    selectEl.appendChild(opt);
                });
                var saved = (typeof localStorage !== 'undefined' && localStorage.getItem('media-hunt-import-lists-last-instance')) || '';
                var selected = '';
                if (preferMode === 'movie' && currentMovie != null) {
                    selected = 'movie:' + currentMovie;
                    if (!combined.some(function(i) { return i.value === selected; })) selected = combined[0].value;
                } else if (preferMode === 'tv' && currentTv != null) {
                    selected = 'tv:' + currentTv;
                    if (!combined.some(function(i) { return i.value === selected; })) selected = combined[0].value;
                } else if (saved && combined.some(function(i) { return i.value === saved; })) {
                    selected = saved;
                } else if (currentMovie != null && combined.some(function(i) { return i.value === 'movie:' + currentMovie; })) {
                    selected = 'movie:' + currentMovie;
                } else if (currentTv != null && combined.some(function(i) { return i.value === 'tv:' + currentTv; })) {
                    selected = 'tv:' + currentTv;
                } else {
                    selected = combined[0].value;
                }
                selectEl.value = selected;
                var noInstEl = document.getElementById('settings-import-lists-no-instances');
                var noIdxEl = document.getElementById('settings-import-lists-no-indexers');
                var noCliEl = document.getElementById('settings-import-lists-no-clients');
                var wrapperEl = document.getElementById('settings-import-lists-content-wrapper');
                if (noInstEl) noInstEl.style.display = 'none';
                if (noIdxEl) noIdxEl.style.display = 'none';
                if (noCliEl) noCliEl.style.display = 'none';
                if (wrapperEl) wrapperEl.style.display = '';
                var parts = (selected || '').split(':');
                if (parts.length === 2) {
                    self._ilMode = parts[0] === 'tv' ? 'tv' : 'movie';
                    if (typeof localStorage !== 'undefined') localStorage.setItem('media-hunt-import-lists-last-instance', selected);
                    self.refreshList();
                }
            }).catch(function() {
                selectEl.innerHTML = '<option value="">Failed to load instances</option>';
                var noInstEl = document.getElementById('settings-import-lists-no-instances');
                var noIdxEl = document.getElementById('settings-import-lists-no-indexers');
                var noCliEl = document.getElementById('settings-import-lists-no-clients');
                var wrapperEl = document.getElementById('settings-import-lists-content-wrapper');
                if (noInstEl) noInstEl.style.display = 'none';
                if (noIdxEl) noIdxEl.style.display = 'none';
                if (noCliEl) noCliEl.style.display = '';
                if (wrapperEl) wrapperEl.style.display = 'none';
            });
        },

        onCombinedInstanceChange: function() {
            var selectEl = document.getElementById('settings-import-lists-instance-select');
            if (!selectEl) return;
            var val = selectEl.value || '';
            var parts = val.split(':');
            if (parts.length === 2) {
                window.ImportLists._ilMode = parts[0] === 'tv' ? 'tv' : 'movie';
                if (typeof localStorage !== 'undefined') localStorage.setItem('media-hunt-import-lists-last-instance', val);
                window.ImportLists.refreshList();
            }
        },

        initOrRefresh: function(preferMode) {
            var self = window.ImportLists;
            self._ilMode = (preferMode === 'tv') ? 'tv' : 'movie';
            var selectEl = document.getElementById('settings-import-lists-instance-select');
            if (selectEl && selectEl.options.length <= 1) {
                self.populateCombinedInstanceDropdown(preferMode);
            } else {
                var val = selectEl.value || '';
                var parts = val.split(':');
                if (parts.length === 2) self._ilMode = parts[0] === 'tv' ? 'tv' : 'movie';
                self.refreshList();
            }
            if (selectEl && !selectEl._ilChangeBound) {
                selectEl._ilChangeBound = true;
                selectEl.addEventListener('change', function() { window.ImportLists.onCombinedInstanceChange(); });
            }
        },

        // ---------------------------------------------------------------
        // Refresh / render
        // ---------------------------------------------------------------
        refreshList: function() {
            var gridEl = document.getElementById('import-lists-grid');
            if (!gridEl) return;
            var url = window.ImportLists._appendInstanceParam(window.ImportLists.getApiBase());
            fetch(url)
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    var lists = (data && data.lists) ? data.lists : [];
                    var html = '';

                    for (var i = 0; i < lists.length; i++) {
                        var lst = lists[i];
                        var name = _esc(lst.name || lst.type);
                        var typeInfo = _getTypeInfo(lst.type);
                        var icon = typeInfo ? typeInfo.icon : 'fas fa-list';
                        var typeName = typeInfo ? typeInfo.name : lst.type;
                        var enabled = lst.enabled !== false;
                        var interval = lst.sync_interval_hours || 12;
                        var lastSync = lst.last_sync ? _timeAgo(lst.last_sync) : 'Never';
                        var lastCount = lst.last_sync_count || 0;
                        var hasError = !!lst.last_error;
                        var subtypeName = _getSubtypeName(lst.type, (lst.settings || {}).list_type);

                        html += '<div class="import-list-card instance-card' + (enabled ? '' : ' disabled-list') + '" data-list-id="' + lst.id + '">' +
                            '<div class="import-list-card-header">' +
                                '<div class="import-list-card-icon"><i class="' + icon + '"></i></div>' +
                                '<div class="import-list-card-title">' +
                                    '<span class="import-list-card-name">' + name + '</span>' +
                                    '<span class="import-list-card-type">' + _esc(typeName) + (subtypeName ? ' &middot; ' + _esc(subtypeName) : '') + '</span>' +
                                '</div>' +
                            '</div>' +
                            '<div class="import-list-card-body">' +
                                '<div class="import-list-badges">' +
                                    '<span class="import-list-badge ' + (enabled ? 'badge-enabled' : 'badge-disabled') + '">' + (enabled ? 'Enabled' : 'Disabled') + '</span>' +
                                    '<span class="import-list-badge badge-interval"><i class="fas fa-clock"></i> ' + _intervalLabel(interval) + '</span>' +
                                '</div>' +
                                '<div class="import-list-stats">' +
                                    '<span class="import-list-stat"><i class="fas fa-history"></i> ' + lastSync + '</span>' +
                                    (lastCount > 0 ? '<span class="import-list-stat"><i class="fas fa-film"></i> ' + lastCount + ' added</span>' : '') +
                                    (hasError ? '<span class="import-list-stat stat-error"><i class="fas fa-exclamation-triangle"></i> Error</span>' : '') +
                                '</div>' +
                            '</div>' +
                            '<div class="import-list-card-footer">' +
                                '<button type="button" class="btn-card" data-list-id="' + lst.id + '" data-action="sync" title="Sync Now"><i class="fas fa-sync-alt"></i> Sync</button>' +
                                '<button type="button" class="btn-card" data-list-id="' + lst.id + '" data-action="toggle" title="' + (enabled ? 'Disable' : 'Enable') + '">' +
                                    '<i class="fas fa-' + (enabled ? 'toggle-on' : 'toggle-off') + '"></i> ' + (enabled ? 'On' : 'Off') +
                                '</button>' +
                                '<button type="button" class="btn-card" data-list-id="' + lst.id + '" data-action="edit" title="Edit"><i class="fas fa-pen"></i> Edit</button>' +
                            '</div>' +
                        '</div>';
                    }

                    // Add card at end (hide for TV - import lists not implemented for TV yet)
                    if (window.ImportLists._ilMode !== 'tv') {
                        html += '<div class="add-instance-card add-import-list-card" id="import-lists-add-card" data-app-type="import-list">' +
                            '<div class="add-icon"><i class="fas fa-plus-circle"></i></div>' +
                            '<div class="add-text">Add Import List</div></div>';
                    } else if (lists.length === 0) {
                        html += '<p class="import-lists-tv-empty" style="color:#94a3b8;margin:12px 0;">Import lists for TV Hunt are not available yet.</p>';
                    }

                    gridEl.innerHTML = html;
                    window.ImportLists._bindCardButtons();
                    var syncAllBtn = document.getElementById('import-lists-sync-all-btn');
                    if (syncAllBtn) syncAllBtn.style.display = window.ImportLists._ilMode === 'tv' ? 'none' : '';
                })
                .catch(function(e) {
                    console.error('[ImportLists] Failed to load:', e);
                    var errHtml = '<p style="color: #ef4444; margin: 0 0 12px 0;">Failed to load import lists.</p>';
                    if (window.ImportLists._ilMode !== 'tv') {
                        errHtml += '<div class="add-instance-card add-import-list-card" id="import-lists-add-card" data-app-type="import-list">' +
                            '<div class="add-icon"><i class="fas fa-plus-circle"></i></div>' +
                            '<div class="add-text">Add Import List</div></div>';
                    }
                    gridEl.innerHTML = errHtml;
                    window.ImportLists._bindAddCard();
                });
        },

        // ---------------------------------------------------------------
        // Card button bindings
        // ---------------------------------------------------------------
        _bindCardButtons: function() {
            var gridEl = document.getElementById('import-lists-grid');
            if (!gridEl) return;

            gridEl.querySelectorAll('[data-action="sync"]').forEach(function(btn) {
                btn.onclick = function() { window.ImportLists.syncList(btn.getAttribute('data-list-id')); };
            });
            gridEl.querySelectorAll('[data-action="toggle"]').forEach(function(btn) {
                btn.onclick = function() { window.ImportLists.toggleList(btn.getAttribute('data-list-id')); };
            });
            gridEl.querySelectorAll('[data-action="edit"]').forEach(function(btn) {
                btn.onclick = function() { window.ImportLists.openEditModal(btn.getAttribute('data-list-id')); };
            });
            window.ImportLists._bindAddCard();
        },

        _bindAddCard: function() {
            var addCard = document.getElementById('import-lists-add-card');
            if (addCard) {
                addCard.onclick = function() { window.ImportLists.openAddModal(); };
            }
        },

        // ---------------------------------------------------------------
        // Sync
        // ---------------------------------------------------------------
        syncList: function(listId) {
            _notify('Syncing list...', 'info');
            var url = window.ImportLists.getApiBase() + '/' + listId + '/sync';
            url = window.ImportLists._appendInstanceParam(url);
            var body = {};
            var instId = window.ImportLists.getInstanceId();
            if (instId) body.instance_id = parseInt(instId, 10);
            fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.success) {
                        var res = data.result || {};
                        _notify('Sync complete: ' + (res.added || 0) + ' added, ' + (res.skipped || 0) + ' skipped', 'success');
                    } else {
                        _notify('Sync failed: ' + (data.error || 'Unknown error'), 'error');
                    }
                    window.ImportLists.refreshList();
                })
                .catch(function(e) { _notify('Sync error: ' + e, 'error'); });
        },

        syncAll: function() {
            _notify('Syncing all lists...', 'info');
            var url = window.ImportLists.getApiBase() + '/sync-all';
            url = window.ImportLists._appendInstanceParam(url);
            var body = {};
            var instId = window.ImportLists.getInstanceId();
            if (instId) body.instance_id = parseInt(instId, 10);
            fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.success) {
                        var results = data.results || {};
                        var totalAdded = 0;
                        Object.keys(results).forEach(function(k) { totalAdded += (results[k].added || 0); });
                        _notify('All lists synced: ' + totalAdded + ' movies added', 'success');
                    } else {
                        _notify('Sync failed', 'error');
                    }
                    window.ImportLists.refreshList();
                })
                .catch(function(e) { _notify('Sync error: ' + e, 'error'); });
        },

        toggleList: function(listId) {
            var url = window.ImportLists.getApiBase() + '/' + listId + '/toggle';
            url = window.ImportLists._appendInstanceParam(url);
            var body = {};
            var instId = window.ImportLists.getInstanceId();
            if (instId) body.instance_id = parseInt(instId, 10);
            fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
                .then(function(r) { return r.json(); })
                .then(function() { window.ImportLists.refreshList(); })
                .catch(function(e) { _notify('Toggle failed: ' + e, 'error'); });
        },

        // ---------------------------------------------------------------
        // Add modal
        // ---------------------------------------------------------------
        openAddModal: function() {
            var modal = document.getElementById('import-list-add-modal');
            if (!modal) return;
            selectedType = null;
            currentEditId = null;

            // Show type picker, hide config form
            document.getElementById('import-list-type-picker').style.display = '';
            document.getElementById('import-list-config-form').style.display = 'none';

            _loadListTypes(function() {
                _renderTypePicker();
            });

            modal.style.display = 'flex';
            document.body.classList.add('modal-open');
        },

        closeAddModal: function() {
            var modal = document.getElementById('import-list-add-modal');
            if (modal) modal.style.display = 'none';
            document.body.classList.remove('modal-open');
        },

        _selectType: function(typeId) {
            selectedType = typeId;
            var typeInfo = _getTypeInfo(typeId);

            // Switch to config form
            document.getElementById('import-list-type-picker').style.display = 'none';
            document.getElementById('import-list-config-form').style.display = '';

            // Set default name
            document.getElementById('import-list-name').value = typeInfo ? typeInfo.name : typeId;

            // Populate subtypes if any
            var subtypeGroup = document.getElementById('import-list-subtype-group');
            var subtypeSelect = document.getElementById('import-list-subtype');
            if (typeInfo && typeInfo.subtypes && typeInfo.subtypes.length > 0) {
                subtypeGroup.style.display = '';
                subtypeSelect.innerHTML = '';
                typeInfo.subtypes.forEach(function(st) {
                    var opt = document.createElement('option');
                    opt.value = st.id;
                    opt.textContent = st.name;
                    subtypeSelect.appendChild(opt);
                });
                subtypeSelect.onchange = function() {
                    _renderDynamicFields('import-list-dynamic-fields', typeId, subtypeSelect.value, {});
                };
            } else {
                subtypeGroup.style.display = 'none';
            }

            // Render dynamic fields
            _renderDynamicFields('import-list-dynamic-fields', typeId, subtypeSelect ? subtypeSelect.value : '', {});
        },

        saveNewList: function() {
            var name = (document.getElementById('import-list-name').value || '').trim();
            if (!name) { _notify('Name is required', 'error'); return; }
            if (!selectedType) { _notify('Please select a list type', 'error'); return; }

            var subtypeSelect = document.getElementById('import-list-subtype');
            var intervalSelect = document.getElementById('import-list-interval');

            var settings = _collectDynamicFields('import-list-dynamic-fields');
            if (subtypeSelect && subtypeSelect.value) {
                settings.list_type = subtypeSelect.value;
            }

            var payload = {
                type: selectedType,
                name: name,
                settings: settings,
                sync_interval_hours: parseInt(intervalSelect.value, 10) || 12,
            };
            var instId = window.ImportLists.getInstanceId();
            if (instId) payload.instance_id = parseInt(instId, 10);
            var url = window.ImportLists._appendInstanceParam(window.ImportLists.getApiBase());
            fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (data.success) {
                    _notify('Import list added!', 'success');
                    window.ImportLists.closeAddModal();
                    window.ImportLists.refreshList();
                } else {
                    _notify('Failed: ' + (data.error || 'Unknown'), 'error');
                }
            })
            .catch(function(e) { _notify('Error: ' + e, 'error'); });
        },

        // ---------------------------------------------------------------
        // Edit modal
        // ---------------------------------------------------------------
        openEditModal: function(listId) {
            currentEditId = listId;
            var url = window.ImportLists._appendInstanceParam(window.ImportLists.getApiBase());
            fetch(url)
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    var lists = (data && data.lists) || [];
                    var lst = null;
                    for (var i = 0; i < lists.length; i++) {
                        if (lists[i].id === listId) { lst = lists[i]; break; }
                    }
                    if (!lst) { _notify('List not found', 'error'); return; }

                    document.getElementById('import-list-edit-name').value = lst.name || '';

                    // Subtypes
                    var typeInfo = _getTypeInfo(lst.type);
                    var subtypeGroup = document.getElementById('import-list-edit-subtype-group');
                    var subtypeSelect = document.getElementById('import-list-edit-subtype');
                    if (typeInfo && typeInfo.subtypes && typeInfo.subtypes.length > 0) {
                        subtypeGroup.style.display = '';
                        subtypeSelect.innerHTML = '';
                        typeInfo.subtypes.forEach(function(st) {
                            var opt = document.createElement('option');
                            opt.value = st.id;
                            opt.textContent = st.name;
                            if ((lst.settings || {}).list_type === st.id) opt.selected = true;
                            subtypeSelect.appendChild(opt);
                        });
                        subtypeSelect.onchange = function() {
                            _renderDynamicFields('import-list-edit-dynamic-fields', lst.type, subtypeSelect.value, lst.settings || {});
                        };
                    } else {
                        subtypeGroup.style.display = 'none';
                    }

                    // Dynamic fields
                    _renderDynamicFields('import-list-edit-dynamic-fields', lst.type, (lst.settings || {}).list_type || '', lst.settings || {});

                    // Interval
                    var intervalSelect = document.getElementById('import-list-edit-interval');
                    intervalSelect.value = String(lst.sync_interval_hours || 12);

                    var modal = document.getElementById('import-list-edit-modal');
                    modal.style.display = 'flex';
                    document.body.classList.add('modal-open');
                })
                .catch(function(e) { _notify('Error loading list: ' + e, 'error'); });
        },

        closeEditModal: function() {
            var modal = document.getElementById('import-list-edit-modal');
            if (modal) modal.style.display = 'none';
            document.body.classList.remove('modal-open');
            currentEditId = null;
        },

        saveEditList: function() {
            if (!currentEditId) return;
            var name = (document.getElementById('import-list-edit-name').value || '').trim();
            if (!name) { _notify('Name is required', 'error'); return; }

            var subtypeSelect = document.getElementById('import-list-edit-subtype');
            var intervalSelect = document.getElementById('import-list-edit-interval');

            var settings = _collectDynamicFields('import-list-edit-dynamic-fields');
            if (subtypeSelect && subtypeSelect.value) {
                settings.list_type = subtypeSelect.value;
            }

            var payload = {
                name: name,
                settings: settings,
                sync_interval_hours: parseInt(intervalSelect.value, 10) || 12,
            };
            var instId = window.ImportLists.getInstanceId();
            if (instId) payload.instance_id = parseInt(instId, 10);
            var editUrl = window.ImportLists.getApiBase() + '/' + currentEditId;
            editUrl = window.ImportLists._appendInstanceParam(editUrl);
            fetch(editUrl, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (data.success) {
                    _notify('List updated!', 'success');
                    window.ImportLists.closeEditModal();
                    window.ImportLists.refreshList();
                } else {
                    _notify('Failed: ' + (data.error || 'Unknown'), 'error');
                }
            })
            .catch(function(e) { _notify('Error: ' + e, 'error'); });
        },

        deleteList: function() {
            if (!currentEditId) return;
            if (window.HuntarrConfirm) {
                window.HuntarrConfirm.show({
                    title: 'Delete Import List',
                    message: 'Are you sure you want to delete this import list? This cannot be undone.',
                    confirmLabel: 'Delete',
                    onConfirm: function() { _doDelete(currentEditId); }
                });
            } else if (confirm('Delete this import list?')) {
                _doDelete(currentEditId);
            }
        },

        // ---------------------------------------------------------------
        // Init event listeners
        // ---------------------------------------------------------------
        init: function() {
            // Add modal
            _bindClick('import-list-add-modal-close', function() { window.ImportLists.closeAddModal(); });
            _bindClick('import-list-add-modal-backdrop', function() { window.ImportLists.closeAddModal(); });
            _bindClick('import-list-cancel-btn', function() { window.ImportLists.closeAddModal(); });
            _bindClick('import-list-save-btn', function() { window.ImportLists.saveNewList(); });
            _bindClick('import-list-config-back', function() {
                document.getElementById('import-list-type-picker').style.display = '';
                document.getElementById('import-list-config-form').style.display = 'none';
            });

            // Edit modal
            _bindClick('import-list-edit-modal-close', function() { window.ImportLists.closeEditModal(); });
            _bindClick('import-list-edit-modal-backdrop', function() { window.ImportLists.closeEditModal(); });
            _bindClick('import-list-edit-cancel-btn', function() { window.ImportLists.closeEditModal(); });
            _bindClick('import-list-edit-save-btn', function() { window.ImportLists.saveEditList(); });
            _bindClick('import-list-edit-delete-btn', function() { window.ImportLists.deleteList(); });

            // Sync All
            _bindClick('import-lists-sync-all-btn', function() { window.ImportLists.syncAll(); });

            document.addEventListener('huntarr:instances-changed', function() { if (window.ImportLists._ilMode === 'movie') window.ImportLists.populateCombinedInstanceDropdown('movie'); });
            document.addEventListener('huntarr:tv-hunt-instances-changed', function() { if (window.ImportLists._ilMode === 'tv') window.ImportLists.populateCombinedInstanceDropdown('tv'); });
        }
    };

    // -------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------

    function _doDelete(listId) {
        var deleteUrl = window.ImportLists.getApiBase() + '/' + listId;
        deleteUrl = window.ImportLists._appendInstanceParam(deleteUrl);
        fetch(deleteUrl, { method: 'DELETE' })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (data.success) {
                    _notify('List deleted', 'success');
                    window.ImportLists.closeEditModal();
                    window.ImportLists.refreshList();
                } else {
                    _notify('Delete failed: ' + (data.error || ''), 'error');
                }
            })
            .catch(function(e) { _notify('Error: ' + e, 'error'); });
    }

    function _loadListTypes(cb) {
        if (listTypes) { if (cb) cb(); return; }
        fetch(window.ImportLists._appendInstanceParam(window.ImportLists.getApiBase() + '/types'))
            .then(function(r) { return r.json(); })
            .then(function(data) {
                listTypes = (data && data.types) || [];
                if (cb) cb();
            })
            .catch(function() { listTypes = []; if (cb) cb(); });
    }

    function _getTypeInfo(typeId) {
        if (!listTypes) return null;
        for (var i = 0; i < listTypes.length; i++) {
            if (listTypes[i].id === typeId) return listTypes[i];
        }
        return null;
    }

    function _getSubtypeName(typeId, subtypeId) {
        var info = _getTypeInfo(typeId);
        if (!info || !info.subtypes) return '';
        for (var i = 0; i < info.subtypes.length; i++) {
            if (info.subtypes[i].id === subtypeId) return info.subtypes[i].name;
        }
        return '';
    }

    function _renderTypePicker() {
        var grid = document.getElementById('import-list-type-grid');
        if (!grid || !listTypes) return;
        var html = '';
        listTypes.forEach(function(t) {
            html += '<div class="import-list-type-card" data-type-id="' + t.id + '">' +
                '<div class="import-list-type-icon"><i class="' + (t.icon || 'fas fa-list') + '"></i></div>' +
                '<div class="import-list-type-name">' + _esc(t.name) + '</div>' +
                (t.requires_oauth ? '<div class="import-list-type-oauth"><i class="fas fa-key"></i> OAuth</div>' : '') +
                '</div>';
        });
        grid.innerHTML = html;
        grid.querySelectorAll('.import-list-type-card').forEach(function(card) {
            card.onclick = function() {
                window.ImportLists._selectType(card.getAttribute('data-type-id'));
            };
        });
    }

    function _renderDynamicFields(containerId, typeId, subtypeId, existingSettings) {
        var container = document.getElementById(containerId);
        if (!container) return;
        var html = '';
        var s = existingSettings || {};

        if (typeId === 'imdb') {
            if (subtypeId === 'custom') {
                html += _fieldInput('list_id', 'IMDb List ID', s.list_id || '', 'e.g. ls123456789');
            }
        } else if (typeId === 'tmdb') {
            if (subtypeId === 'list') {
                html += _fieldInput('list_id', 'TMDb List ID', s.list_id || '', 'Numeric list ID');
            } else if (subtypeId === 'keyword') {
                html += _fieldInput('keyword_id', 'TMDb Keyword ID', s.keyword_id || '', 'Numeric keyword ID');
            } else if (subtypeId === 'company') {
                html += _fieldInput('company_id', 'TMDb Company ID', s.company_id || '', 'e.g. 420 for Marvel');
            } else if (subtypeId === 'person') {
                html += _fieldInput('person_id', 'TMDb Person ID', s.person_id || '', 'Numeric person ID');
            }
        } else if (typeId === 'trakt') {
            // Auth section — always shown for all Trakt subtypes
            var isAuthed = s.access_token && s.access_token !== '••••••••';
            html += '<div class="import-list-form-group">' +
                '<label>Authenticate with Trakt</label>' +
                '<div class="trakt-auth-row">' +
                    '<button type="button" class="btn-trakt-auth' + (isAuthed ? ' trakt-auth-success' : '') + '" id="' + containerId + '-trakt-auth-btn">' +
                        (isAuthed ? '<i class="fas fa-check"></i> Authenticated' : '<i class="fas fa-sign-in-alt"></i> Start OAuth') +
                    '</button>' +
                    '<span class="trakt-auth-status" id="' + containerId + '-trakt-status">' +
                        (isAuthed ? '<i class="fas fa-check-circle" style="color:#22c55e"></i> Authorized' : '') +
                    '</span>' +
                '</div>' +
                '<input type="hidden" class="dynamic-field" data-field="access_token" value="' + _esc(s.access_token || '') + '">' +
                '<input type="hidden" class="dynamic-field" data-field="refresh_token" value="' + _esc(s.refresh_token || '') + '">' +
                '<input type="hidden" class="dynamic-field" data-field="expires_at" value="' + (s.expires_at || 0) + '">' +
            '</div>';

            if (subtypeId === 'watchlist') {
                html += _fieldInput('username', 'Username', s.username || '', 'Trakt username (or leave blank for "me")');
            }
            if (subtypeId === 'custom') {
                html += _fieldInput('username', 'Username', s.username || '', 'Trakt username');
                html += _fieldInput('list_name', 'List Name', s.list_name || '', 'Name of the custom list');
            }
            html += _fieldInput('years', 'Years', s.years || '', 'Filter movies by year or year range');
            html += _fieldInput('additional_parameters', 'Additional Parameters', s.additional_parameters || '', 'Additional Trakt API parameters');
            html += _fieldInput('limit', 'Limit', s.limit || '5000', 'Limit the number of movies to get', 'number');
        } else if (typeId === 'rss') {
            html += _fieldInput('url', 'RSS Feed URL', s.url || '', 'https://example.com/feed.rss');
        } else if (typeId === 'stevenlu') {
            html += _fieldInput('url', 'JSON Feed URL', s.url || 'https://popular-movies-data.stevenlu.com/movies.json', 'StevenLu JSON URL');
        } else if (typeId === 'plex') {
            var plexAuthed = s.access_token && s.access_token !== '••••••••';
            html += '<div class="import-list-form-group">' +
                '<label>Authenticate with Plex</label>' +
                '<div class="plex-auth-row">' +
                    '<button type="button" class="btn-plex-auth' + (plexAuthed ? ' plex-auth-success' : '') + '" id="' + containerId + '-plex-auth-btn">' +
                        (plexAuthed ? '<i class="fas fa-check"></i> Authenticated' : '<i class="fas fa-sign-in-alt"></i> Sign in with Plex') +
                    '</button>' +
                    '<span class="plex-auth-status" id="' + containerId + '-plex-status">' +
                        (plexAuthed ? '<i class="fas fa-check-circle" style="color:#22c55e"></i> Signed in' : '') +
                    '</span>' +
                '</div>' +
                '<input type="hidden" class="dynamic-field" data-field="access_token" value="' + _esc(s.access_token || '') + '">' +
            '</div>';
        } else if (typeId === 'custom_json') {
            html += _fieldInput('url', 'JSON URL', s.url || '', 'https://example.com/movies.json');
        }

        container.innerHTML = html;

        // Bind Trakt OAuth button
        var traktBtn = document.getElementById(containerId + '-trakt-auth-btn');
        if (traktBtn) {
            traktBtn.onclick = function() { _startTraktOAuth(containerId); };
        }

        // Bind Plex OAuth button
        var plexBtn = document.getElementById(containerId + '-plex-auth-btn');
        if (plexBtn) {
            plexBtn.onclick = function() { _startPlexOAuth(containerId); };
        }
    }

    function _collectDynamicFields(containerId) {
        var container = document.getElementById(containerId);
        if (!container) return {};
        var settings = {};
        container.querySelectorAll('.dynamic-field').forEach(function(el) {
            var field = el.getAttribute('data-field');
            if (field) {
                settings[field] = el.value || '';
            }
        });
        return settings;
    }

    function _fieldInput(fieldName, label, value, placeholder, type) {
        type = type || 'text';
        return '<div class="import-list-form-group">' +
            '<label>' + _esc(label) + '</label>' +
            '<input type="' + type + '" class="control-input dynamic-field" data-field="' + fieldName + '" value="' + _esc(value) + '" placeholder="' + _esc(placeholder || '') + '">' +
        '</div>';
    }

    // -------------------------------------------------------------------
    // OAuth flows
    // -------------------------------------------------------------------

    var _traktPollTimer = null;

    function _startTraktOAuth(containerId) {
        var statusEl = document.getElementById(containerId + '-trakt-status');
        var authBtn = document.getElementById(containerId + '-trakt-auth-btn');
        if (authBtn) { authBtn.disabled = true; authBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Connecting...'; }

        // Step 1: Request device code (backend uses embedded credentials)
        fetch('./api/movie-hunt/import-lists/trakt/device-code', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}'
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (!data.success) {
                _notify(data.error || 'Failed to get device code', 'error');
                if (authBtn) { authBtn.disabled = false; authBtn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Start OAuth'; }
                return;
            }

            var deviceCode = data.device_code;
            var userCode = data.user_code;
            var verifyUrl = data.verification_url || 'https://trakt.tv/activate';
            var interval = (data.interval || 5) * 1000;
            var expiresIn = data.expires_in || 600;

            // Show code first — user copies, then clicks the link
            if (statusEl) {
                statusEl.innerHTML =
                    '<div class="trakt-device-auth">' +
                        '<div class="trakt-device-code-box">' +
                            '<span class="trakt-device-label">1. Click code to copy</span>' +
                            '<div class="trakt-device-code trakt-device-code-copyable" id="' + containerId + '-trakt-code" title="Click to copy">' + _esc(userCode) + '</div>' +
                            '<span class="trakt-device-label" style="margin-top:8px">2. Open Trakt &amp; paste it</span>' +
                            '<a href="' + _esc(verifyUrl) + '" target="_blank" rel="noopener" class="trakt-device-open-link" id="' + containerId + '-trakt-open">' +
                                '<i class="fas fa-external-link-alt"></i> Open trakt.tv/activate' +
                            '</a>' +
                            '<span class="trakt-device-waiting"><i class="fas fa-spinner fa-spin"></i> Waiting for authorization...</span>' +
                        '</div>' +
                    '</div>';

                // Click-to-copy on the code (works on HTTP too)
                var codeEl = document.getElementById(containerId + '-trakt-code');
                if (codeEl) {
                    codeEl.onclick = function() {
                        var copied = false;
                        // Method 1: navigator.clipboard (HTTPS/localhost only)
                        if (navigator.clipboard && navigator.clipboard.writeText) {
                            try { navigator.clipboard.writeText(userCode); copied = true; } catch(e) {}
                        }
                        // Method 2: execCommand fallback (works on HTTP)
                        if (!copied) {
                            var ta = document.createElement('textarea');
                            ta.value = userCode;
                            ta.style.position = 'fixed';
                            ta.style.left = '-9999px';
                            ta.style.opacity = '0';
                            document.body.appendChild(ta);
                            ta.select();
                            try { document.execCommand('copy'); copied = true; } catch(e) {}
                            document.body.removeChild(ta);
                        }
                        // Visual feedback
                        codeEl.classList.add('trakt-code-copied');
                        codeEl.setAttribute('title', 'Copied!');
                        var origHTML = codeEl.innerHTML;
                        codeEl.innerHTML = '<i class="fas fa-check"></i> Copied!';
                        setTimeout(function() {
                            codeEl.innerHTML = origHTML;
                            codeEl.classList.remove('trakt-code-copied');
                            codeEl.setAttribute('title', 'Click to copy');
                        }, 1500);
                    };
                }
            }
            if (authBtn) {
                authBtn.style.display = 'none';
            }

            // Step 2: Poll for token
            if (_traktPollTimer) clearInterval(_traktPollTimer);
            var pollCount = 0;
            var maxPolls = Math.floor(expiresIn / (interval / 1000));

            _traktPollTimer = setInterval(function() {
                pollCount++;
                if (pollCount > maxPolls) {
                    clearInterval(_traktPollTimer);
                    _traktPollTimer = null;
                    if (statusEl) statusEl.innerHTML = '<i class="fas fa-times-circle" style="color:#ef4444"></i> Code expired — try again';
                    if (authBtn) { authBtn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Start OAuth'; authBtn.onclick = function() { _startTraktOAuth(containerId); }; }
                    return;
                }

                fetch('./api/movie-hunt/import-lists/trakt/device-token', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ device_code: deviceCode })
                })
                .then(function(r) { return r.json(); })
                .then(function(tokenData) {
                    if (tokenData.success) {
                        clearInterval(_traktPollTimer);
                        _traktPollTimer = null;

                        var atEl = document.querySelector('#' + containerId + ' [data-field="access_token"]');
                        var rtEl = document.querySelector('#' + containerId + ' [data-field="refresh_token"]');
                        var exEl = document.querySelector('#' + containerId + ' [data-field="expires_at"]');
                        if (atEl) atEl.value = tokenData.access_token;
                        if (rtEl) rtEl.value = tokenData.refresh_token;
                        if (exEl) exEl.value = tokenData.expires_at;

                        if (statusEl) statusEl.innerHTML = '<i class="fas fa-check-circle" style="color:#22c55e"></i> Authorized';
                        if (authBtn) { authBtn.innerHTML = '<i class="fas fa-check"></i> Authenticated'; authBtn.disabled = true; authBtn.classList.add('trakt-auth-success'); authBtn.onclick = null; }
                        _notify('Trakt authorized!', 'success');
                    } else if (tokenData.pending) {
                        // Still waiting — keep polling
                    } else {
                        clearInterval(_traktPollTimer);
                        _traktPollTimer = null;
                        if (statusEl) statusEl.innerHTML = '<i class="fas fa-times-circle" style="color:#ef4444"></i> ' + _esc(tokenData.error || 'Auth failed');
                        if (authBtn) { authBtn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Start OAuth'; authBtn.disabled = false; authBtn.onclick = function() { _startTraktOAuth(containerId); }; }
                        _notify('Trakt auth failed: ' + (tokenData.error || ''), 'error');
                    }
                })
                .catch(function() {
                    // Network error — keep polling, it might recover
                });
            }, interval);
        })
        .catch(function(e) {
            _notify('Error: ' + e, 'error');
            if (authBtn) { authBtn.disabled = false; authBtn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Start OAuth'; }
        });
    }

    var _plexPollTimer = null;

    function _startPlexOAuth(containerId) {
        var statusEl = document.getElementById(containerId + '-plex-status');
        var authBtn = document.getElementById(containerId + '-plex-auth-btn');
        if (authBtn) { authBtn.disabled = true; authBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Connecting...'; }

        // Step 1: Create a Plex PIN
        fetch('./api/movie-hunt/import-lists/plex/pin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}'
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (!data.success) {
                _notify(data.error || 'Failed to create Plex PIN', 'error');
                if (authBtn) { authBtn.disabled = false; authBtn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Sign in with Plex'; }
                return;
            }

            var pinId = data.pin_id;
            var authUrl = data.auth_url;

            // Show status UI with link to Plex
            if (statusEl) {
                statusEl.innerHTML =
                    '<div class="plex-device-auth">' +
                        '<div class="plex-device-code-box">' +
                            '<span class="plex-device-label">Click below to sign in with Plex</span>' +
                            '<a href="' + _esc(authUrl) + '" target="_blank" rel="noopener" class="plex-device-open-link">' +
                                '<i class="fas fa-external-link-alt"></i> Sign in at Plex.tv' +
                            '</a>' +
                            '<span class="plex-device-waiting"><i class="fas fa-spinner fa-spin"></i> Waiting for authorization...</span>' +
                        '</div>' +
                    '</div>';
            }
            if (authBtn) { authBtn.style.display = 'none'; }

            // Auto-open Plex auth page
            window.open(authUrl, '_blank');

            // Step 2: Poll for token
            if (_plexPollTimer) clearInterval(_plexPollTimer);
            var pollCount = 0;
            var maxPolls = 120; // 10 minutes at 5s intervals

            _plexPollTimer = setInterval(function() {
                pollCount++;
                if (pollCount > maxPolls) {
                    clearInterval(_plexPollTimer);
                    _plexPollTimer = null;
                    if (statusEl) statusEl.innerHTML = '<i class="fas fa-times-circle" style="color:#ef4444"></i> Timed out — try again';
                    if (authBtn) { authBtn.style.display = ''; authBtn.disabled = false; authBtn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Sign in with Plex'; }
                    return;
                }

                fetch('./api/movie-hunt/import-lists/plex/check/' + pinId)
                .then(function(r) { return r.json(); })
                .then(function(checkData) {
                    if (checkData.success && checkData.claimed) {
                        // Got the token!
                        clearInterval(_plexPollTimer);
                        _plexPollTimer = null;

                        var atEl = document.querySelector('#' + containerId + ' [data-field="access_token"]');
                        if (atEl) atEl.value = checkData.token;

                        if (statusEl) statusEl.innerHTML = '<i class="fas fa-check-circle" style="color:#22c55e"></i> Signed in';
                        if (authBtn) {
                            authBtn.style.display = '';
                            authBtn.innerHTML = '<i class="fas fa-check"></i> Authenticated';
                            authBtn.disabled = true;
                            authBtn.classList.add('plex-auth-success');
                        }
                        _notify('Plex authorized!', 'success');
                    }
                    // If not claimed yet, keep polling
                })
                .catch(function() {
                    // Network error — keep polling
                });
            }, 5000);
        })
        .catch(function(e) {
            _notify('Error: ' + e, 'error');
            if (authBtn) { authBtn.disabled = false; authBtn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Sign in with Plex'; }
        });
    }

    // -------------------------------------------------------------------
    // Utilities
    // -------------------------------------------------------------------

    function _esc(s) {
        if (!s) return '';
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function _timeAgo(ts) {
        if (!ts) return 'Never';
        var diff = Math.floor((Date.now() / 1000) - ts);
        if (diff < 60) return 'Just now';
        if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
        if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
        return Math.floor(diff / 86400) + 'd ago';
    }

    function _intervalLabel(hours) {
        if (hours < 24) return hours + 'h';
        return Math.floor(hours / 24) + 'd';
    }

    function _notify(msg, type) {
        if (window.huntarrUI && window.huntarrUI.showNotification) {
            window.huntarrUI.showNotification(msg, type || 'info');
        } else {
            console.log('[ImportLists]', msg);
        }
    }

    function _bindClick(id, fn) {
        var el = document.getElementById(id);
        if (el) el.onclick = fn;
    }

    // Auto-init when DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() { window.ImportLists.init(); });
    } else {
        window.ImportLists.init();
    }

})();


/* === modules/features/settings/media-hunt-import-media.js === */
/**
 * Media Hunt Import Media — unified Movies/TV unmapped folder import.
 * Uses api/movie-hunt/import-media or api/tv-hunt/import-media based on mode.
 */
(function() {
    'use strict';

    var PREFIX = 'media-hunt-import-media';

    window.MediaHuntImportMedia = {
        items: [],
        mode: 'movie',
        pollInterval: null,
        currentSearchFolderPath: null,

        getApiBase: function() {
            return this.mode === 'tv' ? './api/tv-hunt' : './api/movie-hunt';
        },

        init: function() {
            var self = this;
            if (!document.getElementById(PREFIX + '-instance-select')) return;

            this.setupCombinedInstanceSelect();
            this.setupScanButton();
            this.setupImportAllButton();
            this.setupSearchModal();
            this.updateModeLabels();
            this.loadItems();
        },

        _safeJsonFetch: function(url, fallback) {
            return fetch(url, { cache: 'no-store' }).then(function(r) { return r.json(); }).catch(function() { return fallback || {}; });
        },

        setupCombinedInstanceSelect: function() {
            var self = this;
            var select = document.getElementById(PREFIX + '-instance-select');
            if (!select) return;

            select.innerHTML = '<option value="">Loading...</option>';

            var ts = Date.now();
            var sf = self._safeJsonFetch.bind(self);
            Promise.all([
                sf('./api/movie-hunt/instances?t=' + ts, { instances: [] }),
                sf('./api/tv-hunt/instances?t=' + ts, { instances: [] }),
                sf('./api/movie-hunt/instances/current?t=' + ts, { current_instance_id: null }),
                sf('./api/tv-hunt/instances/current?t=' + ts, { current_instance_id: null }),
                sf('./api/indexer-hunt/indexers?t=' + ts, { indexers: [] }),
                sf('./api/movie-hunt/has-clients?t=' + ts, { has_clients: false })
            ]).then(function(results) {
                var movieList = results[0].instances || [];
                var tvList = results[1].instances || [];
                var movieCurrent = results[2].current_instance_id != null ? Number(results[2].current_instance_id) : null;
                var tvCurrent = results[3].current_instance_id != null ? Number(results[3].current_instance_id) : null;
                var indexerCount = (results[4].indexers || []).length;
                var hasClients = results[5].has_clients === true;

                var opts = [];
                movieList.forEach(function(inst) {
                    opts.push({ value: 'movie:' + inst.id, label: 'Movie - ' + (inst.name || 'Instance ' + inst.id), mode: 'movie' });
                });
                tvList.forEach(function(inst) {
                    opts.push({ value: 'tv:' + inst.id, label: 'TV - ' + (inst.name || 'Instance ' + inst.id), mode: 'tv' });
                });

                var wrapperEl = document.getElementById(PREFIX + '-content-wrapper');
                if (wrapperEl) wrapperEl.style.display = '';

                if (opts.length === 0) {
                    select.innerHTML = '';
                    select.appendChild(document.createElement('option')).value = ''; select.options[0].textContent = 'No instances';
                    return;
                }
                if (indexerCount === 0) {
                    select.innerHTML = '';
                    select.appendChild(document.createElement('option')).value = ''; select.options[0].textContent = 'No indexers configured';
                    return;
                }
                if (!hasClients) {
                    select.innerHTML = '';
                    select.appendChild(document.createElement('option')).value = ''; select.options[0].textContent = 'No clients configured';
                    return;
                }

                select.innerHTML = '';
                opts.forEach(function(opt) {
                    var o = document.createElement('option');
                    o.value = opt.value;
                    o.textContent = opt.label;
                    select.appendChild(o);
                });

                var pref = (movieCurrent != null && movieList.length) ? 'movie:' + movieCurrent : (tvCurrent != null && tvList.length) ? 'tv:' + tvCurrent : opts[0].value;
                if (select.querySelector('option[value="' + pref + '"]')) {
                    select.value = pref;
                } else if (opts.length) {
                    select.value = opts[0].value;
                }
                self.applySelectedInstance();
            }).catch(function() {
                select.innerHTML = '<option value="">Failed to load</option>';
                var wrapperEl = document.getElementById(PREFIX + '-content-wrapper');
                if (wrapperEl) wrapperEl.style.display = '';
            });

            select.addEventListener('change', function() {
                self.applySelectedInstance();
            });
        },

        applySelectedInstance: function() {
            var select = document.getElementById(PREFIX + '-instance-select');
            if (!select || !select.value) return;
            var parts = (select.value || '').split(':');
            var mode = parts[0] || 'movie';
            var instanceId = parts[1] ? parseInt(parts[1], 10) : null;
            if (!instanceId) return;

            this.mode = mode;
            this.updateModeLabels();

            var apiBase = mode === 'tv' ? './api/tv-hunt' : './api/movie-hunt';
            fetch(apiBase + '/instances/current', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ instance_id: instanceId })
            }).then(function(r) { return r.json(); }).catch(function() {});

            if (typeof window.updateMovieHuntSettingsVisibility === 'function') window.updateMovieHuntSettingsVisibility();
            if (typeof window.updateTVHuntSettingsVisibility === 'function') window.updateTVHuntSettingsVisibility();

            this.loadItems();
        },

        updateModeLabels: function() {
            var help = document.getElementById(PREFIX + '-help');
            var headerInfo = document.getElementById(PREFIX + '-header-info');
            var searchTitle = document.getElementById(PREFIX + '-search-title');
            var empty = document.getElementById(PREFIX + '-empty');
            var searchInput = document.getElementById(PREFIX + '-search-input');

            if (this.mode === 'tv') {
                if (help) help.textContent = 'Import existing TV series from your root folders into your TV Collection. Unmapped series folders are automatically detected and matched to TMDB with smart confidence scoring (first air date, title, seasons).';
                if (headerInfo) headerInfo.textContent = 'SERIES / FOLDER INFORMATION';
                if (searchTitle) searchTitle.textContent = 'Find TV Series Match';
                if (empty) empty.innerHTML = '<i class="fas fa-tv"></i><p>Click <strong>Scan Folders</strong> to detect unmapped TV series in your root folders.</p>';
                if (searchInput) searchInput.placeholder = 'Series title...';
            } else {
                if (help) help.textContent = 'Import existing movies from your root folders into your Movie Collection. Unmapped folders are automatically detected and matched to TMDB.';
                if (headerInfo) headerInfo.textContent = 'FOLDER / FILE INFORMATION';
                if (searchTitle) searchTitle.textContent = 'Find Movie Match';
                if (empty) empty.innerHTML = '<i class="fas fa-folder-open"></i><p>Click <strong>Scan Folders</strong> to detect unmapped movies in your root folders.</p>';
                if (searchInput) searchInput.placeholder = 'Movie title...';
            }
        },


        setupScanButton: function() {
            var btn = document.getElementById(PREFIX + '-scan-btn');
            if (!btn) return;
            btn.onclick = (function(self) { return function() { self.triggerScan(); }; })(this);
        },

        setupImportAllButton: function() {
            var btn = document.getElementById(PREFIX + '-import-all-btn');
            if (!btn) return;
            btn.onclick = (function(self) { return function() { self.importAll(); }; })(this);
        },

        setupSearchModal: function() {
            var self = this;
            var backdrop = document.getElementById(PREFIX + '-search-backdrop');
            var closeBtn = document.getElementById(PREFIX + '-search-close');
            var searchBtn = document.getElementById(PREFIX + '-search-go-btn');
            var input = document.getElementById(PREFIX + '-search-input');

            if (backdrop) backdrop.onclick = function() { self.closeSearchModal(); };
            if (closeBtn) closeBtn.onclick = function() { self.closeSearchModal(); };
            if (searchBtn) searchBtn.onclick = function() { self.performManualSearch(); };
            if (input) {
                input.addEventListener('keydown', function(e) {
                    if (e.key === 'Enter') self.performManualSearch();
                });
            }
        },

        getInstanceParam: function() {
            var select = document.getElementById(PREFIX + '-instance-select');
            if (!select || !select.value) return '';
            var parts = (select.value || '').split(':');
            var instanceId = parts[1];
            return instanceId ? '&instance_id=' + encodeURIComponent(instanceId) : '';
        },

        loadItems: function() {
            var self = this;
            var listEl = document.getElementById(PREFIX + '-list');
            if (!listEl) return;

            var url = this.getApiBase() + '/import-media?' + this.getInstanceParam().replace('&', '');
            fetch(url)
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (!data.success) {
                        listEl.innerHTML = '<div class="import-media-empty"><i class="fas fa-exclamation-triangle"></i><p>Failed to load import media data.</p></div>';
                        return;
                    }

                    self.items = data.items || [];
                    self.updateStats(data);
                    self.renderItems();

                    if (data.scan_in_progress) {
                        self.startPolling();
                    } else {
                        self.stopPolling();
                    }
                })
                .catch(function(err) {
                    console.error('Import Media load error:', err);
                    listEl.innerHTML = '<div class="import-media-empty"><i class="fas fa-exclamation-triangle"></i><p>Error loading data.</p></div>';
                });
        },

        updateStats: function(data) {
            var items = data.items || [];
            var statsEl = document.getElementById(PREFIX + '-stats');
            var statusBar = document.getElementById(PREFIX + '-status-bar');
            var importAllBtn = document.getElementById(PREFIX + '-import-all-btn');

            var total = items.length;
            var matched = items.filter(function(i) { return i.status === 'matched'; }).length;
            var pending = items.filter(function(i) { return i.status === 'pending'; }).length;
            var noMatch = items.filter(function(i) { return i.status === 'no_match'; }).length;

            if (total > 0 && statsEl) {
                statsEl.style.display = 'flex';
                var set = function(id, val) { var el = document.getElementById(PREFIX + '-' + id); if (el) el.textContent = val; };
                set('stat-total', total);
                set('stat-matched', matched);
                set('stat-pending', pending);
                set('stat-nomatch', noMatch);

                var lastScanEl = document.getElementById(PREFIX + '-last-scan');
                if (lastScanEl && data.last_scan) {
                    try {
                        lastScanEl.textContent = 'Last scan: ' + new Date(data.last_scan).toLocaleString();
                    } catch (e) {
                        lastScanEl.textContent = '';
                    }
                }
            } else if (statsEl) {
                statsEl.style.display = 'none';
            }

            if (importAllBtn) importAllBtn.style.display = matched > 0 ? 'flex' : 'none';

            if (statusBar) {
                if (data.scan_in_progress) {
                    statusBar.style.display = 'flex';
                    var statusText = document.getElementById(PREFIX + '-status-text');
                    if (statusText) statusText.textContent = 'Scanning root folders and matching to TMDB... This may take a moment.';
                } else {
                    statusBar.style.display = 'none';
                }
            }
        },

        renderItems: function() {
            var self = this;
            var listEl = document.getElementById(PREFIX + '-list');
            if (!listEl) return;

            var emptyMsg = this.mode === 'tv'
                ? 'No unmapped series found. Click <strong>Scan Folders</strong> to detect TV series in your root folders that aren\'t in your TV Collection yet.'
                : 'No unmapped folders found. Click <strong>Scan Folders</strong> to detect movies in your root folders that aren\'t in your Movie Collection yet.';

            if (this.items.length === 0) {
                listEl.innerHTML = '<div class="import-media-empty"><i class="fas fa-folder-open"></i><p>' + emptyMsg + '</p></div>';
                return;
            }

            listEl.innerHTML = '';
            for (var i = 0; i < this.items.length; i++) {
                listEl.appendChild(self.createItemElement(this.items[i]));
            }
        },

        createItemElement: function(item) {
            var self = this;
            var div = document.createElement('div');
            div.className = 'import-media-item status-' + (item.status || 'pending');

            var posterUrl = './static/images/blackout.jpg';
            var matchHtml = '';
            var actionsHtml = '';

            if (item.status === 'matched' && item.best_match) {
                var m = item.best_match;
                if (m.poster_path) posterUrl = 'https://image.tmdb.org/t/p/w92' + m.poster_path;
                var scoreClass = m.score >= 70 ? 'high' : (m.score >= 40 ? 'medium' : 'low');
                matchHtml = '<div class="import-media-match-info">' +
                    '<div class="import-media-match-title">' + self.escapeHtml(m.title) + '</div>' +
                    '<div class="import-media-match-year">' + (m.year || '') + '</div>' +
                    '</div><div class="import-media-match-confidence">' +
                    '<div class="conf-label">Confidence</div>' +
                    '<div class="conf-value ' + scoreClass + '">' + m.score + '%</div></div>';
                actionsHtml = '<div class="import-media-actions">' +
                    '<button class="import-media-btn-confirm" data-path="' + self.escapeAttr(item.folder_path) + '"><i class="fas fa-check"></i> Import</button>' +
                    (item.matches && item.matches.length > 1 ? '<button class="import-media-btn-matches" data-path="' + self.escapeAttr(item.folder_path) + '"><i class="fas fa-list"></i></button>' : '') +
                    '<button class="import-media-btn-search" data-path="' + self.escapeAttr(item.folder_path) + '" data-title="' + self.escapeAttr(item.parsed_title) + '" data-year="' + self.escapeAttr(item.parsed_year) + '"><i class="fas fa-search"></i></button>' +
                    '<button class="import-media-btn-skip" data-path="' + self.escapeAttr(item.folder_path) + '"><i class="fas fa-times"></i></button></div>';
            } else if (item.status === 'no_match') {
                matchHtml = '<div class="import-media-match-info status-no-match-cell"><div class="import-media-no-match-text"><i class="fas fa-question-circle"></i> No match found</div></div><div class="import-media-match-confidence empty-cell"></div>';
                actionsHtml = '<div class="import-media-actions">' +
                    '<button class="import-media-btn-search" data-path="' + self.escapeAttr(item.folder_path) + '" data-title="' + self.escapeAttr(item.parsed_title) + '" data-year="' + self.escapeAttr(item.parsed_year) + '"><i class="fas fa-search"></i> Find</button>' +
                    '<button class="import-media-btn-skip" data-path="' + self.escapeAttr(item.folder_path) + '"><i class="fas fa-times"></i></button></div>';
            } else {
                matchHtml = '<div class="import-media-match-info status-pending-cell"><div class="import-media-pending-text"><i class="fas fa-hourglass-half"></i> Processing...</div></div><div class="import-media-match-confidence empty-cell"></div>';
                actionsHtml = '<div class="import-media-actions"></div>';
            }

            var sizeStr = item.file_size ? self.formatSize(item.file_size) : '';
            var qualityStr = item.parsed_quality || '';
            div.innerHTML = '<div class="import-media-poster"><img src="' + posterUrl + '" onerror="this.src=\'./static/images/blackout.jpg\'"></div>' +
                '<div class="import-media-info">' +
                '<div class="import-media-folder-name">' + self.escapeHtml(item.folder_name) + '</div>' +
                '<div class="import-media-folder-path">' + self.escapeHtml(item.root_folder) + '</div>' +
                '<div class="import-media-file-info">' +
                (sizeStr ? '<span><i class="fas fa-hdd"></i> ' + sizeStr + '</span>' : '') +
                (item.file_count ? '<span><i class="fas fa-file-video"></i> ' + item.file_count + ' file' + (item.file_count > 1 ? 's' : '') + '</span>' : '') +
                (qualityStr ? '<span><i class="fas fa-film"></i> ' + self.escapeHtml(qualityStr) + '</span>' : '') +
                '</div></div>' + matchHtml + actionsHtml;

            var confirmBtns = div.querySelectorAll('.import-media-btn-confirm');
            for (var j = 0; j < confirmBtns.length; j++) {
                confirmBtns[j].onclick = function() { self.confirmItem(this.getAttribute('data-path')); };
            }
            var searchBtns = div.querySelectorAll('.import-media-btn-search');
            for (var j = 0; j < searchBtns.length; j++) {
                searchBtns[j].onclick = function() {
                    self.openSearchModal(this.getAttribute('data-path'), this.getAttribute('data-title'), this.getAttribute('data-year'));
                };
            }
            var skipBtns = div.querySelectorAll('.import-media-btn-skip');
            for (var j = 0; j < skipBtns.length; j++) {
                skipBtns[j].onclick = function() { self.skipItem(this.getAttribute('data-path')); };
            }
            var matchBtns = div.querySelectorAll('.import-media-btn-matches');
            for (var j = 0; j < matchBtns.length; j++) {
                matchBtns[j].onclick = function(e) {
                    e.stopPropagation();
                    self.showAlternateMatches(this.getAttribute('data-path'), this);
                };
            }
            return div;
        },

        triggerScan: function() {
            var self = this;
            var btn = document.getElementById(PREFIX + '-scan-btn');
            if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Scanning...'; }

            var statusBar = document.getElementById(PREFIX + '-status-bar');
            if (statusBar) {
                statusBar.style.display = 'flex';
                var st = document.getElementById(PREFIX + '-status-text');
                if (st) st.textContent = 'Starting scan...';
            }

            fetch(this.getApiBase() + '/import-media/scan?' + this.getInstanceParam().replace('&', ''), { method: 'POST' })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.success) self.startPolling();
                    else {
                        if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification(data.message || 'Scan failed', 'error');
                        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-search"></i> Scan Folders'; }
                    }
                })
                .catch(function() {
                    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-search"></i> Scan Folders'; }
                });
        },

        startPolling: function() {
            var self = this;
            if (this.pollInterval) return;
            this.pollInterval = setInterval(function() { self.loadItems(); }, 2000);
        },

        stopPolling: function() {
            if (this.pollInterval) { clearInterval(this.pollInterval); this.pollInterval = null; }
            var btn = document.getElementById(PREFIX + '-scan-btn');
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-search"></i> Scan Folders'; }
        },

        confirmItem: function(folderPath) {
            var self = this;
            var item = this.findItemByPath(folderPath);
            if (!item || !item.best_match) return;
            var m = item.best_match;

            fetch(this.getApiBase() + '/import-media/confirm?' + this.getInstanceParam().replace('&', ''), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    folder_path: folderPath,
                    tmdb_id: m.tmdb_id,
                    title: m.title,
                    year: m.year || '',
                    poster_path: m.poster_path || '',
                    root_folder: item.root_folder || ''
                })
            })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.success) {
                        if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification(data.message || 'Imported!', 'success');
                        self.loadItems();
                    } else {
                        if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification(data.message || 'Import failed', data.already_exists ? 'info' : 'error');
                        if (data.already_exists) self.loadItems();
                    }
                });
        },

        importAll: function() {
            var self = this;
            var matched = this.items.filter(function(i) { return i.status === 'matched'; });
            if (matched.length === 0) return;
            var label = this.mode === 'tv' ? 'series' : 'movie';
            var plural = matched.length !== 1;

            if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
                window.HuntarrConfirm.show({
                    title: 'Import All Matched',
                    message: 'Import all ' + matched.length + ' matched ' + label + (plural ? 's' : '') + ' into your ' + (this.mode === 'tv' ? 'TV' : 'Movie') + ' Collection?\n\nItems already in your collection will be skipped.',
                    confirmLabel: 'Import All',
                    onConfirm: function() { self._doImportAll(); }
                });
            } else {
                if (!confirm('Import all ' + matched.length + ' matched ' + label + (plural ? 's' : '') + '?')) return;
                self._doImportAll();
            }
        },

        _doImportAll: function() {
            var self = this;
            fetch(this.getApiBase() + '/import-media/confirm-all?' + this.getInstanceParam().replace('&', ''), { method: 'POST' })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.success && window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification(data.message || 'All imported!', 'success');
                    else if (!data.success && window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification(data.message || 'Import failed', 'error');
                    self.loadItems();
                });
        },

        skipItem: function(folderPath) {
            var self = this;
            fetch(this.getApiBase() + '/import-media/skip?' + this.getInstanceParam().replace('&', ''), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ folder_path: folderPath })
            })
                .then(function(r) { return r.json(); })
                .then(function() { self.loadItems(); });
        },

        openSearchModal: function(folderPath, title, year) {
            this.currentSearchFolderPath = folderPath;
            var modal = document.getElementById(PREFIX + '-search-modal');
            if (!modal) return;
            if (modal.parentElement !== document.body) document.body.appendChild(modal);
            modal.style.display = 'flex';

            var folderLabel = document.getElementById(PREFIX + '-search-folder-name');
            if (folderLabel) {
                var item = this.findItemByPath(folderPath);
                folderLabel.textContent = item ? item.folder_name : folderPath;
            }

            var input = document.getElementById(PREFIX + '-search-input');
            var yearInput = document.getElementById(PREFIX + '-search-year');
            if (input) input.value = title || '';
            if (yearInput) yearInput.value = year || '';

            var results = document.getElementById(PREFIX + '-search-results');
            if (results) results.innerHTML = '<p class="import-media-search-hint">Search for the correct ' + (this.mode === 'tv' ? 'TV series' : 'movie') + ' title above.</p>';
            if (input) input.focus();
        },

        closeSearchModal: function() {
            var modal = document.getElementById(PREFIX + '-search-modal');
            if (modal) modal.style.display = 'none';
            this.currentSearchFolderPath = null;
        },

        performManualSearch: function() {
            var self = this;
            var input = document.getElementById(PREFIX + '-search-input');
            var yearInput = document.getElementById(PREFIX + '-search-year');
            var results = document.getElementById(PREFIX + '-search-results');
            if (!input || !results) return;
            var query = (input.value || '').trim();
            if (!query) return;
            var year = (yearInput && yearInput.value || '').trim();

            results.innerHTML = '<p class="import-media-search-hint"><i class="fas fa-spinner fa-spin"></i> Searching...</p>';

            var url = this.getApiBase() + '/import-media/search?q=' + encodeURIComponent(query);
            if (year) url += '&year=' + encodeURIComponent(year);

            fetch(url)
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (!data.success || !data.results || data.results.length === 0) {
                        results.innerHTML = '<p class="import-media-search-hint">No results found. Try a different title.</p>';
                        return;
                    }
                    results.innerHTML = '';
                    for (var i = 0; i < data.results.length; i++) {
                        var r = data.results[i];
                        var el = document.createElement('div');
                        el.className = 'import-media-search-result';
                        var posterUrl = r.poster_path ? 'https://image.tmdb.org/t/p/w92' + r.poster_path : './static/images/blackout.jpg';
                        var overview = (r.overview || '').substring(0, 120);
                        if (overview.length >= 120) overview += '...';
                        el.innerHTML = '<div class="import-media-search-result-poster"><img src="' + posterUrl + '" onerror="this.src=\'./static/images/blackout.jpg\'"></div>' +
                            '<div class="import-media-search-result-info">' +
                            '<div class="import-media-search-result-title">' + self.escapeHtml(r.title) + '</div>' +
                            '<div class="import-media-search-result-meta">' + (r.year || 'N/A') + ' &middot; ' + (r.vote_average || 0).toFixed(1) + ' <i class="fas fa-star" style="font-size:0.7em;color:#fbbf24;"></i></div>' +
                            (overview ? '<div class="import-media-search-result-overview">' + self.escapeHtml(overview) + '</div>' : '') +
                            '</div><button class="select-btn" data-tmdb-id="' + r.tmdb_id + '" data-title="' + self.escapeAttr(r.title) + '" data-year="' + self.escapeAttr(r.year || '') + '" data-poster="' + self.escapeAttr(r.poster_path || '') + '">Select</button>';
                        results.appendChild(el);
                    }
                    var selectBtns = results.querySelectorAll('.select-btn');
                    for (var j = 0; j < selectBtns.length; j++) {
                        selectBtns[j].onclick = function(e) {
                            e.stopPropagation();
                            self.selectSearchResult(parseInt(this.getAttribute('data-tmdb-id')), this.getAttribute('data-title'), this.getAttribute('data-year'), this.getAttribute('data-poster'));
                        };
                    }
                })
                .catch(function() {
                    results.innerHTML = '<p class="import-media-search-hint">Search failed. Please try again.</p>';
                });
        },

        selectSearchResult: function(tmdbId, title, year, posterPath) {
            var self = this;
            if (!this.currentSearchFolderPath) return;
            var item = this.findItemByPath(this.currentSearchFolderPath);
            if (!item) return;

            fetch(this.getApiBase() + '/import-media/confirm?' + this.getInstanceParam().replace('&', ''), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    folder_path: this.currentSearchFolderPath,
                    tmdb_id: tmdbId,
                    title: title,
                    year: year || '',
                    poster_path: posterPath || '',
                    root_folder: item.root_folder || ''
                })
            })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.success) {
                        if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification(data.message || 'Imported!', 'success');
                        self.closeSearchModal();
                        self.loadItems();
                    } else {
                        if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification(data.message || 'Import failed', data.already_exists ? 'info' : 'error');
                        if (data.already_exists) { self.closeSearchModal(); self.loadItems(); }
                    }
                });
        },

        showAlternateMatches: function(folderPath, btnEl) {
            var self = this;
            var item = this.findItemByPath(folderPath);
            if (!item || !item.matches || item.matches.length < 2) return;

            var existing = document.querySelector('.import-media-matches-dropdown');
            if (existing) existing.remove();

            var dropdown = document.createElement('div');
            dropdown.className = 'import-media-matches-dropdown';
            for (var i = 1; i < item.matches.length; i++) {
                var m = item.matches[i];
                var el = document.createElement('div');
                el.className = 'import-media-matches-dropdown-item';
                var posterUrl = m.poster_path ? 'https://image.tmdb.org/t/p/w92' + m.poster_path : './static/images/blackout.jpg';
                el.innerHTML = '<div class="poster"><img src="' + posterUrl + '" onerror="this.src=\'./static/images/blackout.jpg\'"></div><div class="info"><div class="title">' + self.escapeHtml(m.title) + '</div><div class="year">' + (m.year || '') + ' &middot; ' + m.score + '%</div></div>';
                (function(match) {
                    el.onclick = function() {
                        item.best_match = match;
                        dropdown.remove();
                        self.renderItems();
                    };
                })(m);
                dropdown.appendChild(el);
            }
            var parent = btnEl.closest('.import-media-item');
            if (parent) { parent.style.position = 'relative'; parent.appendChild(dropdown); }
            setTimeout(function() {
                document.addEventListener('click', function closeDropdown(e) {
                    if (!dropdown.contains(e.target)) { dropdown.remove(); document.removeEventListener('click', closeDropdown); }
                });
            }, 10);
        },

        findItemByPath: function(path) {
            for (var i = 0; i < this.items.length; i++) {
                if (this.items[i].folder_path === path) return this.items[i];
            }
            return null;
        },

        formatSize: function(bytes) {
            if (!bytes) return '';
            if (bytes >= 1e12) return (bytes / 1e12).toFixed(1) + ' TB';
            if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + ' GB';
            if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + ' MB';
            return (bytes / 1e3).toFixed(0) + ' KB';
        },

        escapeHtml: function(str) {
            if (!str) return '';
            return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        },

        escapeAttr: function(str) {
            if (!str) return '';
            return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }
    };
})();


/* === modules/features/settings/root-folders.js === */
/**
 * Root Folders – single view for Movie Hunt and TV Hunt. Combined instance dropdown
 * (Movie - X / TV - X, alphabetical). Each instance keeps its own root folders; same page linked from both sidebars.
 */
(function() {
    'use strict';

    function _rebindBrowseItem(el) {
        el.querySelectorAll('.root-folders-browse-item-btn').forEach(function(btn) {
            btn.onclick = function(e) {
                e.stopPropagation();
                var action = btn.getAttribute('data-action');
                var p = el.getAttribute('data-path') || '';
                var name = el.getAttribute('data-name') || '';
                if (action === 'rename') window.RootFolders.browseRenameFolder(p, name, el);
                else if (action === 'delete') window.RootFolders.browseDeleteFolder(p, name);
            };
        });
    }

    function _showBrowseToast(msg, isError) {
        var container = document.querySelector('.root-folders-browse-body');
        if (!container) return;
        var toast = document.createElement('div');
        toast.style.cssText = 'padding:8px 14px;margin-bottom:8px;border-radius:6px;font-size:0.85rem;font-weight:500;' +
            (isError ? 'background:rgba(239,68,68,0.12);color:#f87171;border:1px solid rgba(239,68,68,0.3);'
                     : 'background:rgba(16,185,129,0.12);color:#6ee7b7;border:1px solid rgba(16,185,129,0.3);');
        toast.textContent = msg;
        container.insertBefore(toast, document.getElementById('root-folders-browse-list'));
        setTimeout(function() {
            toast.style.opacity = '0';
            toast.style.transition = 'opacity 0.3s ease';
            setTimeout(function() { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 300);
        }, 3000);
    }

    window.RootFolders = {
        _browseTargetInput: null,
        _rfMode: 'movie',

        getApiBase: function() {
            return this._rfMode === 'tv' ? './api/tv-hunt/root-folders' : './api/movie-hunt/root-folders';
        },

        getInstanceId: function() {
            var sel = document.getElementById('settings-root-folders-instance-select');
            var v = sel && sel.value ? sel.value : '';
            if (v && v.indexOf(':') >= 0) return v.split(':')[1] || '';
            return v || '';
        },

        _appendInstanceParam: function(url) {
            var id = this.getInstanceId();
            if (!id) return url;
            return url + (url.indexOf('?') >= 0 ? '&' : '?') + 'instance_id=' + encodeURIComponent(id);
        },

        _safeJsonFetch: function(url, fallback) {
            return fetch(url, { cache: 'no-store' }).then(function(r) { return r.json(); }).catch(function() { return fallback || {}; });
        },

        populateCombinedInstanceDropdown: function(preferMode) {
            var self = window.RootFolders;
            var selectEl = document.getElementById('settings-root-folders-instance-select');
            if (!selectEl) return;
            selectEl.innerHTML = '<option value="">Loading...</option>';
            var ts = Date.now();
            var sf = self._safeJsonFetch.bind(self);
            Promise.all([
                sf('./api/movie-hunt/instances?t=' + ts, { instances: [] }),
                sf('./api/tv-hunt/instances?t=' + ts, { instances: [] }),
                sf('./api/movie-hunt/instances/current?t=' + ts, { current_instance_id: null }),
                sf('./api/tv-hunt/instances/current?t=' + ts, { current_instance_id: null })
            ]).then(function(results) {
                var movieList = (results[0].instances || []).map(function(inst) {
                    return { value: 'movie:' + inst.id, label: 'Movie - ' + (inst.name || 'Instance ' + inst.id) };
                });
                var tvList = (results[1].instances || []).map(function(inst) {
                    return { value: 'tv:' + inst.id, label: 'TV - ' + (inst.name || 'Instance ' + inst.id) };
                });
                var combined = movieList.concat(tvList);
                combined.sort(function(a, b) { return (a.label || '').localeCompare(b.label || '', undefined, { sensitivity: 'base' }); });
                var currentMovie = results[2].current_instance_id != null ? Number(results[2].current_instance_id) : null;
                var currentTv = results[3].current_instance_id != null ? Number(results[3].current_instance_id) : null;
                selectEl.innerHTML = '';
                if (combined.length === 0) {
                    var emptyOpt = document.createElement('option');
                    emptyOpt.value = '';
                    emptyOpt.textContent = 'No Movie or TV Hunt instances';
                    selectEl.appendChild(emptyOpt);
                    var wrapperEl = document.getElementById('settings-root-folders-content-wrapper');
                    if (wrapperEl) wrapperEl.style.display = '';
                    return;
                }
                combined.forEach(function(item) {
                    var opt = document.createElement('option');
                    opt.value = item.value;
                    opt.textContent = item.label;
                    selectEl.appendChild(opt);
                });
                var saved = (typeof localStorage !== 'undefined' && localStorage.getItem('media-hunt-root-folders-last-instance')) || '';
                var selected = '';
                if (preferMode === 'movie' && currentMovie != null) {
                    selected = 'movie:' + currentMovie;
                    if (!combined.some(function(i) { return i.value === selected; })) selected = combined[0].value;
                } else if (preferMode === 'tv' && currentTv != null) {
                    selected = 'tv:' + currentTv;
                    if (!combined.some(function(i) { return i.value === selected; })) selected = combined[0].value;
                } else if (saved && combined.some(function(i) { return i.value === saved; })) {
                    selected = saved;
                } else if (currentMovie != null && combined.some(function(i) { return i.value === 'movie:' + currentMovie; })) {
                    selected = 'movie:' + currentMovie;
                } else if (currentTv != null && combined.some(function(i) { return i.value === 'tv:' + currentTv; })) {
                    selected = 'tv:' + currentTv;
                } else {
                    selected = combined[0].value;
                }
                selectEl.value = selected;
                self._applyRequestarrGotoInstance(selectEl);
                selected = selectEl.value || selected;
                var wrapperEl = document.getElementById('settings-root-folders-content-wrapper');
                if (wrapperEl) wrapperEl.style.display = '';
                var parts = (selected || '').split(':');
                if (parts.length === 2) {
                    self._rfMode = parts[0] === 'tv' ? 'tv' : 'movie';
                    if (typeof localStorage !== 'undefined') localStorage.setItem('media-hunt-root-folders-last-instance', selected);
                    self.refreshList();
                }
            }).catch(function() {
                selectEl.innerHTML = '<option value="">Failed to load instances</option>';
                var wrapperEl = document.getElementById('settings-root-folders-content-wrapper');
                if (wrapperEl) wrapperEl.style.display = '';
            });
        },

        _applyRequestarrGotoInstance: function(selectEl) {
            if (!selectEl) return;
            try {
                var goto = typeof sessionStorage !== 'undefined' && sessionStorage.getItem('requestarr-goto-root-instance');
                if (!goto) return;
                var payload = JSON.parse(goto);
                var wantApp = (payload.appType || '').indexOf('tv') >= 0 ? 'tv' : 'movie';
                var wantLabel = (wantApp === 'tv' ? 'TV - ' : 'Movie - ') + (payload.instanceName || '');
                for (var i = 0; i < selectEl.options.length; i++) {
                    var opt = selectEl.options[i];
                    if (opt.value && opt.textContent === wantLabel) {
                        selectEl.value = opt.value;
                        window.RootFolders._rfMode = wantApp;
                        if (typeof localStorage !== 'undefined') localStorage.setItem('media-hunt-root-folders-last-instance', opt.value);
                        break;
                    }
                }
                sessionStorage.removeItem('requestarr-goto-root-instance');
            } catch (e) {}
        },

        onCombinedInstanceChange: function() {
            var selectEl = document.getElementById('settings-root-folders-instance-select');
            if (!selectEl) return;
            var val = selectEl.value || '';
            var parts = val.split(':');
            if (parts.length === 2) {
                window.RootFolders._rfMode = parts[0] === 'tv' ? 'tv' : 'movie';
                if (typeof localStorage !== 'undefined') localStorage.setItem('media-hunt-root-folders-last-instance', val);
                window.RootFolders.refreshList();
            }
        },

        initOrRefresh: function(preferMode) {
            var self = window.RootFolders;
            self._rfMode = (preferMode === 'tv') ? 'tv' : 'movie';
            var selectEl = document.getElementById('settings-root-folders-instance-select');
            updateRootFoldersSetupBanner();
            if (selectEl && selectEl.options.length <= 1) {
                self.populateCombinedInstanceDropdown(preferMode);
            } else {
                var val = selectEl.value || '';
                var parts = val.split(':');
                if (parts.length === 2) self._rfMode = parts[0] === 'tv' ? 'tv' : 'movie';
                self._applyRequestarrGotoInstance(selectEl);
                self.refreshList();
            }
            if (selectEl && !selectEl._rfChangeBound) {
                selectEl._rfChangeBound = true;
                selectEl.addEventListener('change', function() { window.RootFolders.onCombinedInstanceChange(); });
            }
        },

        refreshList: function() {
            var gridEl = document.getElementById('root-folders-grid');
            if (!gridEl) return;
            var url = window.RootFolders._appendInstanceParam(window.RootFolders.getApiBase());
            fetch(url)
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    var folders = (data && data.root_folders) ? data.root_folders : [];
                    // Default root folder first (leftmost)
                    folders = folders.slice().sort(function(a, b) {
                        if (a.is_default) return -1;
                        if (b.is_default) return 1;
                        return 0;
                    });
                    var html = '';
                    for (var i = 0; i < folders.length; i++) {
                        var path = (folders[i].path || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
                        var freeSpace = folders[i].freeSpace;
                        var spaceLabel = (freeSpace != null && !isNaN(freeSpace)) ? Math.round(freeSpace / 1e9) + ' GB free' : '';
                        var idx = folders[i].index !== undefined ? folders[i].index : i;
                        var isDefault = !!folders[i].is_default;
                        var showSetDefault = folders.length > 1 && !isDefault;
                        var defaultClass = isDefault ? ' default-root-folder' : '';
                        html += '<div class="root-folder-card instance-card' + defaultClass + '" data-index="' + idx + '" data-app-type="root-folder">' +
                            '<div class="root-folder-card-header">' +
                            '<div class="root-folder-card-path">' +
                            '<i class="fas fa-folder"></i>' +
                            '<span>' + path + '</span>' +
                            (isDefault ? '<span class="root-folder-default-badge">Default</span>' : '') +
                            '</div></div>' +
                            '<div class="root-folder-card-body">' +
                            (spaceLabel ? '<span class="root-folder-free-space">' + spaceLabel + '</span>' : '') +
                            '</div>' +
                            '<div class="root-folder-card-footer">' +
                            '<button type="button" class="btn-card" data-index="' + idx + '" data-path="' + (folders[i].path || '').replace(/"/g, '&quot;') + '" data-action="test"><i class="fas fa-vial"></i> Test</button>' +
                            (showSetDefault ? '<button type="button" class="btn-card set-default" data-index="' + idx + '" data-action="set-default"><i class="fas fa-star"></i> Default</button>' : '') +
                            '<button type="button" class="btn-card delete" data-index="' + idx + '" data-action="delete"><i class="fas fa-trash"></i> Delete</button>' +
                            '</div></div>';
                    }
                    html += '<div class="add-instance-card add-root-folder-card" id="root-folders-add-card" data-app-type="root-folder">' +
                        '<div class="add-icon"><i class="fas fa-plus-circle"></i></div>' +
                        '<div class="add-text">Add Root Folder</div></div>';
                    gridEl.innerHTML = html;
                    window.RootFolders._bindCardButtons();
                    refreshInstanceStatusBanner();
                })
                .catch(function() {
                    var addCard = '<div class="add-instance-card add-root-folder-card" id="root-folders-add-card" data-app-type="root-folder">' +
                        '<div class="add-icon"><i class="fas fa-plus-circle"></i></div>' +
                        '<div class="add-text">Add Root Folder</div></div>';
                    gridEl.innerHTML = '<p style="color: #ef4444; margin: 0 0 12px 0;">Failed to load root folders.</p>' + addCard;
                    window.RootFolders._bindAddCard();
                });
        },

        _bindCardButtons: function() {
            var gridEl = document.getElementById('root-folders-grid');
            if (!gridEl) return;
            gridEl.querySelectorAll('.root-folder-card [data-action="test"]').forEach(function(btn) {
                btn.onclick = function() {
                    var path = btn.getAttribute('data-path') || '';
                    if (path) window.RootFolders.testPath(path);
                };
            });
            gridEl.querySelectorAll('.root-folder-card [data-action="set-default"]').forEach(function(btn) {
                btn.onclick = function() {
                    var idx = parseInt(btn.getAttribute('data-index'), 10);
                    if (!isNaN(idx)) window.RootFolders.setDefault(idx);
                };
            });
            gridEl.querySelectorAll('.root-folder-card [data-action="delete"]').forEach(function(btn) {
                btn.onclick = function() {
                    var idx = parseInt(btn.getAttribute('data-index'), 10);
                    if (!isNaN(idx)) window.RootFolders.deleteFolder(idx);
                };
            });
            window.RootFolders._bindAddCard();
        },

        _bindAddCard: function() {
            var addCard = document.getElementById('root-folders-add-card');
            if (addCard) {
                addCard.onclick = function() { window.RootFolders.openAddModal(); };
            }
        },

        openAddModal: function() {
            var modal = document.getElementById('root-folder-add-modal');
            var input = document.getElementById('root-folder-add-path');
            if (modal && modal.parentNode !== document.body) {
                document.body.appendChild(modal);
            }
            if (modal) modal.style.display = 'flex';
            if (input) {
                input.value = '';
                setTimeout(function() { input.focus(); }, 100);
            }
            document.body.classList.add('root-folder-add-modal-open');
        },

        closeAddModal: function() {
            var modal = document.getElementById('root-folder-add-modal');
            if (modal) modal.style.display = 'none';
            document.body.classList.remove('root-folder-add-modal-open');
        },

        setDefault: function(index) {
            if (typeof index !== 'number' || index < 0) return;
            var url = window.RootFolders.getApiBase() + '/' + index + '/default';
            url = window.RootFolders._appendInstanceParam(url);
            fetch(url, { method: 'PATCH' })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.success) {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification('Default root folder updated.', 'success');
                        }
                        window.RootFolders.refreshList();
                        if (window.updateMovieHuntSettingsVisibility) window.updateMovieHuntSettingsVisibility();
                    } else {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification(data.message || 'Failed to set default.', 'error');
                        }
                    }
                })
                .catch(function(err) {
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification(err.message || 'Failed to set default.', 'error');
                    }
                });
        },

        testPath: function(path) {
            if (!path || (typeof path !== 'string')) {
                var addInput = document.getElementById('root-folder-add-path');
                path = addInput ? (addInput.value || '').trim() : '';
            } else {
                path = String(path).trim();
            }
            if (!path) {
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('Enter a path to test', 'error');
                }
                return;
            }
            var testBtn = document.getElementById('root-folder-add-test-btn');
            if (testBtn) {
                testBtn.disabled = true;
                testBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Testing...';
            }
            var testUrl = window.RootFolders._appendInstanceParam(window.RootFolders.getApiBase() + '/test');
            var body = { path: path };
            var instId = window.RootFolders.getInstanceId();
            if (instId) body.instance_id = parseInt(instId, 10);
            fetch(testUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (testBtn) {
                        testBtn.disabled = false;
                        testBtn.innerHTML = '<i class="fas fa-vial"></i> Test';
                    }
                    if (data.success) {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification(data.message || 'Write and read test passed.', 'success');
                        }
                    } else {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification(data.message || 'Test failed', 'error');
                        }
                    }
                })
                .catch(function(err) {
                    if (testBtn) {
                        testBtn.disabled = false;
                        testBtn.innerHTML = '<i class="fas fa-vial"></i> Test';
                    }
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification(err.message || 'Test failed', 'error');
                    }
                });
        },

        addFolder: function() {
            var input = document.getElementById('root-folder-add-path');
            var path = input ? (input.value || '').trim() : '';
            if (!path) {
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('Enter a path', 'error');
                }
                return;
            }
            var saveBtn = document.getElementById('root-folder-add-modal-save');
            if (saveBtn) {
                saveBtn.disabled = true;
                saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Adding...';
            }
            var body = { path: path };
            var instId = window.RootFolders.getInstanceId();
            if (instId) body.instance_id = parseInt(instId, 10);
            var addUrl = window.RootFolders._appendInstanceParam(window.RootFolders.getApiBase());
            fetch(addUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            })
                .then(function(r) { return r.json().then(function(data) { return { ok: r.ok, data: data }; }); })
                .then(function(result) {
                    if (saveBtn) {
                        saveBtn.disabled = false;
                        saveBtn.innerHTML = '<i class="fas fa-plus"></i> Add';
                    }
                    if (result.ok && result.data && result.data.success) {
                        if (input) input.value = '';
                        window.RootFolders.closeAddModal();
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification('Root folder added.', 'success');
                        }
                        window.RootFolders.refreshList();
                        if (window.updateMovieHuntSettingsVisibility) window.updateMovieHuntSettingsVisibility();
                    } else {
                        var msg = (result.data && result.data.message) ? result.data.message : 'Add failed';
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification(msg, 'error');
                        }
                    }
                })
                .catch(function(err) {
                    if (saveBtn) {
                        saveBtn.disabled = false;
                        saveBtn.innerHTML = '<i class="fas fa-plus"></i> Add';
                    }
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification(err.message || 'Add failed', 'error');
                    }
                });
        },

        deleteFolder: function(index) {
            if (typeof index !== 'number' || index < 0) return;
            var deleteUrl = window.RootFolders.getApiBase() + '/' + index;
            deleteUrl = window.RootFolders._appendInstanceParam(deleteUrl);
            var doDelete = function() {
                fetch(deleteUrl, { method: 'DELETE' })
                    .then(function(r) { return r.json(); })
                    .then(function(data) {
                        if (data.success) {
                            if (window.huntarrUI && window.huntarrUI.showNotification) {
                                window.huntarrUI.showNotification('Root folder removed.', 'success');
                            }
                            window.RootFolders.refreshList();
                        if (window.updateMovieHuntSettingsVisibility) window.updateMovieHuntSettingsVisibility();
                        } else {
                            if (window.huntarrUI && window.huntarrUI.showNotification) {
                                window.huntarrUI.showNotification(data.message || 'Delete failed', 'error');
                            }
                        }
                    })
                    .catch(function(err) {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification(err.message || 'Delete failed', 'error');
                        }
                    });
            };
            if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
                window.HuntarrConfirm.show({
                    title: 'Remove Root Folder',
                    message: 'Remove this root folder?',
                    confirmLabel: 'OK',
                    onConfirm: doDelete
                });
            } else {
                if (!confirm('Remove this root folder?')) return;
                doDelete();
            }
        },

        openBrowseModal: function(sourceInput) {
            var modal = document.getElementById('root-folders-browse-modal');
            var browsePathInput = document.getElementById('root-folders-browse-path-input');
            window.RootFolders._browseTargetInput = sourceInput || document.getElementById('root-folder-add-path');
            if (!modal || !browsePathInput) return;
            // Move modal to body so it is visible when opened from other sections (e.g. Clients > Remote Mappings)
            if (modal.parentNode !== document.body) {
                document.body.appendChild(modal);
            }
            var startPath = (window.RootFolders._browseTargetInput && window.RootFolders._browseTargetInput.value) ? window.RootFolders._browseTargetInput.value.trim() : '/';
            if (!startPath) startPath = '/';
            browsePathInput.value = startPath;
            modal.style.display = 'flex';
            document.body.classList.add('root-folders-browse-modal-open');
            window.RootFolders.loadBrowsePath(startPath);
        },

        closeBrowseModal: function() {
            var modal = document.getElementById('root-folders-browse-modal');
            if (modal) {
                modal.style.display = 'none';
                document.body.classList.remove('root-folders-browse-modal-open');
            }
        },

        confirmBrowseSelection: function() {
            var pathInput = document.getElementById('root-folders-browse-path-input');
            var target = window.RootFolders._browseTargetInput || document.getElementById('root-folder-add-path');
            if (pathInput && target) {
                target.value = (pathInput.value || '').trim();
            }
            window.RootFolders.closeBrowseModal();
        },

        goToParent: function() {
            var pathInput = document.getElementById('root-folders-browse-path-input');
            if (!pathInput) return;
            var path = (pathInput.value || '').trim() || '/';
            var parent = path.replace(/\/+$/, '').split('/').slice(0, -1).join('/') || '/';
            if (parent === path) return;
            window.RootFolders.loadBrowsePath(parent);
        },

        browseCreateFolder: function() {
            var row = document.getElementById('root-folders-browse-new-folder-row');
            var input = document.getElementById('root-folders-browse-new-folder-input');
            var delRow = document.getElementById('root-folders-browse-delete-confirm-row');
            if (delRow) delRow.style.display = 'none';
            if (!row || !input) return;
            row.style.display = 'flex';
            input.value = '';
            setTimeout(function() { input.focus(); }, 50);
        },

        _doBrowseCreateFolder: function() {
            var input = document.getElementById('root-folders-browse-new-folder-input');
            var row = document.getElementById('root-folders-browse-new-folder-row');
            var pathInput = document.getElementById('root-folders-browse-path-input');
            var name = (input && input.value || '').trim();
            if (!name) { if (input) input.focus(); return; }
            var parent = (pathInput && pathInput.value || '').trim() || '/';
            var url = window.RootFolders.getApiBase() + '/browse/create';
            url = window.RootFolders._appendInstanceParam(url);
            fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ parent_path: parent, name: name })
            }).then(function(r) { return r.json(); }).then(function(data) {
                if (data.success) {
                    if (row) row.style.display = 'none';
                    window.RootFolders.loadBrowsePath(parent);
                } else {
                    if (input) { input.style.borderColor = '#f87171'; input.focus(); }
                    _showBrowseToast(data.error || 'Failed to create folder', true);
                }
            }).catch(function() { _showBrowseToast('Failed to create folder', true); });
        },

        _cancelBrowseCreateFolder: function() {
            var row = document.getElementById('root-folders-browse-new-folder-row');
            if (row) row.style.display = 'none';
        },

        browseRenameFolder: function(path, currentName, el) {
            var main = el && el.querySelector('.root-folders-browse-item-main');
            if (!main) return;
            var origHTML = main.innerHTML;
            main.innerHTML = '<i class="fas fa-folder" style="color:#818cf8;flex-shrink:0;"></i>' +
                '<input type="text" class="root-folders-browse-item-rename-input" value="' + (currentName || '').replace(/"/g, '&quot;') + '" />' +
                '<button type="button" class="root-folders-browse-inline-ok root-folders-rename-confirm"><i class="fas fa-check"></i></button>' +
                '<button type="button" class="root-folders-browse-inline-cancel root-folders-rename-cancel"><i class="fas fa-times"></i></button>';
            var inp = main.querySelector('input');
            if (inp) { inp.focus(); inp.select(); }
            main.onclick = null;
            var self = window.RootFolders;
            function doRename() {
                var name = (inp && inp.value || '').trim();
                if (!name || name === currentName) { revert(); return; }
                var url = self.getApiBase() + '/browse/rename';
                url = self._appendInstanceParam(url);
                fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: path, new_name: name })
                }).then(function(r) { return r.json(); }).then(function(data) {
                    if (data.success) {
                        var pathInput = document.getElementById('root-folders-browse-path-input');
                        var parent = path.replace(/\/+$/, '').split('/').slice(0, -1).join('/') || '/';
                        self.loadBrowsePath(parent || (pathInput && pathInput.value) || '/');
                    } else {
                        if (inp) { inp.style.borderColor = '#f87171'; inp.focus(); }
                        _showBrowseToast(data.error || 'Failed to rename', true);
                    }
                }).catch(function() { _showBrowseToast('Failed to rename folder', true); });
            }
            function revert() { main.innerHTML = origHTML; _rebindBrowseItem(el); }
            main.querySelector('.root-folders-rename-confirm').onclick = function(e) { e.stopPropagation(); doRename(); };
            main.querySelector('.root-folders-rename-cancel').onclick = function(e) { e.stopPropagation(); revert(); };
            if (inp) inp.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') { e.preventDefault(); doRename(); }
                if (e.key === 'Escape') { e.preventDefault(); revert(); }
            });
        },

        browseDeleteFolder: function(path, name) {
            var row = document.getElementById('root-folders-browse-delete-confirm-row');
            var nameEl = document.getElementById('root-folders-browse-delete-name');
            var newRow = document.getElementById('root-folders-browse-new-folder-row');
            if (newRow) newRow.style.display = 'none';
            if (!row) return;
            row.style.display = 'flex';
            if (nameEl) nameEl.textContent = 'Delete "' + (name || path) + '"?';
            window.RootFolders._pendingDeletePath = path;
        },

        _doBrowseDeleteFolder: function() {
            var path = window.RootFolders._pendingDeletePath;
            var row = document.getElementById('root-folders-browse-delete-confirm-row');
            if (!path) return;
            var url = window.RootFolders.getApiBase() + '/browse/delete';
            url = window.RootFolders._appendInstanceParam(url);
            fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: path })
            }).then(function(r) { return r.json(); }).then(function(data) {
                if (data.success) {
                    if (row) row.style.display = 'none';
                    var pathInput = document.getElementById('root-folders-browse-path-input');
                    var parent = path.replace(/\/+$/, '').split('/').slice(0, -1).join('/') || '/';
                    window.RootFolders.loadBrowsePath(parent);
                    _showBrowseToast('Folder deleted', false);
                } else {
                    _showBrowseToast(data.error || 'Folder may not be empty', true);
                }
            }).catch(function() { _showBrowseToast('Failed to delete folder', true); });
        },

        _cancelBrowseDeleteFolder: function() {
            var row = document.getElementById('root-folders-browse-delete-confirm-row');
            if (row) row.style.display = 'none';
            window.RootFolders._pendingDeletePath = null;
        },

        loadBrowsePath: function(path) {
            var listEl = document.getElementById('root-folders-browse-list');
            var pathInput = document.getElementById('root-folders-browse-path-input');
            var upBtn = document.getElementById('root-folders-browse-up');
            if (!listEl || !pathInput) return;
            // Hide inline rows on navigate
            var newRow = document.getElementById('root-folders-browse-new-folder-row');
            var delRow = document.getElementById('root-folders-browse-delete-confirm-row');
            if (newRow) newRow.style.display = 'none';
            if (delRow) delRow.style.display = 'none';
            path = (path || pathInput.value || '/').trim() || '/';
            pathInput.value = path;
            if (upBtn) {
                var parent = path.replace(/\/+$/, '').split('/').slice(0, -1).join('/') || '/';
                upBtn.disabled = (parent === path || path === '/' || path === '');
            }
            listEl.innerHTML = '<div style="padding: 16px; color: #94a3b8;"><i class="fas fa-spinner fa-spin"></i> Loading...</div>';
            var browseUrl = window.RootFolders.getApiBase() + '/browse?path=' + encodeURIComponent(path);
            browseUrl = window.RootFolders._appendInstanceParam(browseUrl);
            fetch(browseUrl)
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    var dirs = (data && data.directories) ? data.directories : [];
                    var err = data && data.error;
                    if (err) {
                        listEl.innerHTML = '<div style="padding: 16px; color: #f87171;">' + (String(err).replace(/</g, '&lt;')) + '</div>';
                        return;
                    }
                    if (pathInput) pathInput.value = data.path || path;
                    if (upBtn) {
                        var currentPath = (pathInput.value || '').trim() || '/';
                        var parent = currentPath.replace(/\/+$/, '').split('/').slice(0, -1).join('/') || '/';
                        upBtn.disabled = (parent === currentPath || currentPath === '/' || currentPath === '');
                    }
                    var html = '';
                    for (var i = 0; i < dirs.length; i++) {
                        var d = dirs[i];
                        var rawName = d.name || '';
                        var name = rawName.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
                        var p = (d.path || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
                        var nameAttr = rawName.replace(/"/g, '&quot;');
                        html += '<div class="root-folders-browse-item" data-path="' + p + '" data-name="' + nameAttr + '" title="' + p + '">' +
                            '<span class="root-folders-browse-item-main">' +
                            '<i class="fas fa-folder"></i>' +
                            '<span class="root-folders-browse-item-path">' + name + '</span>' +
                            '</span>' +
                            '<span class="root-folders-browse-item-actions">' +
                            '<button type="button" class="root-folders-browse-item-btn" data-action="rename" title="Rename"><i class="fas fa-pen"></i></button>' +
                            '<button type="button" class="root-folders-browse-item-btn" data-action="delete" title="Delete"><i class="fas fa-trash"></i></button>' +
                            '</span></div>';
                    }
                    listEl.innerHTML = html || '<div style="padding: 16px; color: #64748b;">No subdirectories</div>';
                    listEl.querySelectorAll('.root-folders-browse-item').forEach(function(el) {
                        var main = el.querySelector('.root-folders-browse-item-main');
                        if (main) {
                            main.onclick = function() {
                                var p = el.getAttribute('data-path') || '';
                                if (p) window.RootFolders.loadBrowsePath(p);
                            };
                        }
                        _rebindBrowseItem(el);
                    });
                })
                .catch(function() {
                    listEl.innerHTML = '<div style="padding: 16px; color: #f87171;">Failed to load</div>';
                });
        },

        _pendingDeletePath: null,

        init: function() {
            var self = window.RootFolders;
            // Add modal
            var addBackdrop = document.getElementById('root-folder-add-modal-backdrop');
            var addClose = document.getElementById('root-folder-add-modal-close');
            var addCancel = document.getElementById('root-folder-add-modal-cancel');
            var addSave = document.getElementById('root-folder-add-modal-save');
            var addBrowseBtn = document.getElementById('root-folder-add-browse-btn');
            var addTestBtn = document.getElementById('root-folder-add-test-btn');
            var addPathInput = document.getElementById('root-folder-add-path');
            if (addBackdrop) addBackdrop.onclick = function() { self.closeAddModal(); };
            if (addClose) addClose.onclick = function() { self.closeAddModal(); };
            if (addCancel) addCancel.onclick = function() { self.closeAddModal(); };
            if (addSave) addSave.onclick = function() { self.addFolder(); };
            if (addBrowseBtn && addPathInput) addBrowseBtn.onclick = function() { self.openBrowseModal(addPathInput); };
            if (addTestBtn) addTestBtn.onclick = function() { self.testPath(); };
            if (addPathInput) {
                addPathInput.addEventListener('keydown', function(e) {
                    if (e.key === 'Enter') { e.preventDefault(); self.addFolder(); }
                });
            }
            document.addEventListener('keydown', function(e) {
                if (e.key === 'Escape') {
                    if (document.getElementById('root-folder-add-modal').style.display === 'flex') {
                        self.closeAddModal();
                    }
                    if (document.getElementById('root-folders-browse-modal').style.display === 'flex') {
                        self.closeBrowseModal();
                    }
                }
            });
            // Browse modal
            var browseBackdrop = document.getElementById('root-folders-browse-backdrop');
            var browseClose = document.getElementById('root-folders-browse-close');
            var browseCancel = document.getElementById('root-folders-browse-cancel');
            var browseOk = document.getElementById('root-folders-browse-ok');
            var browsePathInput = document.getElementById('root-folders-browse-path-input');
            if (browseBackdrop) browseBackdrop.onclick = function() { self.closeBrowseModal(); };
            if (browseClose) browseClose.onclick = function() { self.closeBrowseModal(); };
            if (browseCancel) browseCancel.onclick = function() { self.closeBrowseModal(); };
            if (browseOk) browseOk.onclick = function() { self.confirmBrowseSelection(); };
            if (browsePathInput) {
                browsePathInput.addEventListener('keydown', function(e) {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        self.loadBrowsePath(browsePathInput.value);
                    }
                });
            }
            var upBtn = document.getElementById('root-folders-browse-up');
            if (upBtn) upBtn.onclick = function() { self.goToParent(); };
            var newFolderBtn = document.getElementById('root-folders-browse-new-folder');
            if (newFolderBtn) newFolderBtn.onclick = function() { self.browseCreateFolder(); };
            // Inline create folder confirm/cancel
            var createConfirm = document.getElementById('root-folders-browse-new-folder-confirm');
            var createCancel = document.getElementById('root-folders-browse-new-folder-cancel');
            var createInput = document.getElementById('root-folders-browse-new-folder-input');
            if (createConfirm) createConfirm.onclick = function() { self._doBrowseCreateFolder(); };
            if (createCancel) createCancel.onclick = function() { self._cancelBrowseCreateFolder(); };
            if (createInput) createInput.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') { e.preventDefault(); self._doBrowseCreateFolder(); }
                if (e.key === 'Escape') { e.preventDefault(); self._cancelBrowseCreateFolder(); }
            });
            // Inline delete confirm/cancel
            var deleteYes = document.getElementById('root-folders-browse-delete-yes');
            var deleteNo = document.getElementById('root-folders-browse-delete-no');
            if (deleteYes) deleteYes.onclick = function() { self._doBrowseDeleteFolder(); };
            if (deleteNo) deleteNo.onclick = function() { self._cancelBrowseDeleteFolder(); };
            document.addEventListener('huntarr:instances-changed', function() { if (self._rfMode === 'movie') self.populateCombinedInstanceDropdown('movie'); updateRootFoldersSetupBanner(); });
            document.addEventListener('huntarr:tv-hunt-instances-changed', function() { if (self._rfMode === 'tv') self.populateCombinedInstanceDropdown('tv'); updateRootFoldersSetupBanner(); });
            updateRootFoldersSetupBanner();
        }
    };

    function updateRootFoldersSetupBanner() {
        var banner = document.getElementById('root-folders-setup-wizard-continue-banner');
        var callout = document.getElementById('root-folders-instance-setup-callout');
        var statusArea = document.getElementById('root-folders-instance-status-area');
        // Show if user navigated here from the setup wizard.
        // Don't remove the flag — it needs to persist across re-renders during the wizard flow.
        var fromWizard = false;
        try { fromWizard = sessionStorage.getItem('setup-wizard-active-nav') === '1'; } catch (e) {}
        var showSetup = fromWizard;
        if (banner) banner.style.display = showSetup ? 'flex' : 'none';
        if (callout) callout.style.display = showSetup ? 'flex' : 'none';
        /* Status by instance: always visible (helps all users), not just during wizard */
        if (statusArea) {
            statusArea.style.display = 'block';
            refreshInstanceStatusBanner();
        }
    }

    function refreshInstanceStatusBanner() {
        var gridEl = document.getElementById('root-folders-instance-status-grid');
        if (!gridEl) return;
        gridEl.innerHTML = '<div style="padding: 12px; color: #94a3b8;"><i class="fas fa-spinner fa-spin"></i> Loading...</div>';
        var sf = window.RootFolders._safeJsonFetch.bind(window.RootFolders);
        var ts = '?t=' + Date.now();
        Promise.all([
            sf('./api/movie-hunt/instances' + ts, { instances: [] }),
            sf('./api/tv-hunt/instances' + ts, { instances: [] })
        ]).then(function(results) {
            var movieInstances = (results[0].instances || []).map(function(i) { return { value: 'movie:' + i.id, label: 'Movie - ' + (i.name || 'Instance ' + i.id), id: i.id, type: 'movie' }; });
            var tvInstances = (results[1].instances || []).map(function(i) { return { value: 'tv:' + i.id, label: 'TV - ' + (i.name || 'Instance ' + i.id), id: i.id, type: 'tv' }; });
            var all = movieInstances.concat(tvInstances);
            var statusArea = document.getElementById('root-folders-instance-status-area');
            if (all.length === 0) {
                gridEl.innerHTML = '';
                if (statusArea) statusArea.style.display = 'none';
                return;
            }
            if (statusArea) statusArea.style.display = 'block';
            var fetches = all.map(function(inst) {
                var url = inst.type === 'tv' ? './api/tv-hunt/root-folders' : './api/movie-hunt/root-folders';
                url += '?instance_id=' + encodeURIComponent(inst.id) + '&t=' + Date.now();
                return sf(url, { root_folders: [] }).then(function(d) {
                    var folders = d.root_folders || d.rootFolders || [];
                    return { label: inst.label, value: inst.value, hasRoots: folders.length > 0 };
                });
            });
            Promise.all(fetches).then(function(statuses) {
                var html = '';
                for (var i = 0; i < statuses.length; i++) {
                    var s = statuses[i];
                    var cardClass = s.hasRoots ? 'instance-complete' : 'instance-not-setup';
                    var iconClass = s.hasRoots ? 'fa-check-circle' : 'fa-folder-open';
                    var badgeText = s.hasRoots ? 'Root Instance Complete' : 'Not Setup';
                    var nameEsc = (s.label || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
                    html += '<div class="root-folders-instance-status-card ' + cardClass + '" data-value="' + (s.value || '').replace(/"/g, '&quot;') + '">' +
                        '<div class="instance-status-icon"><i class="fas ' + iconClass + '" aria-hidden="true"></i></div>' +
                        '<div class="instance-status-body">' +
                        '<div class="instance-status-name">' + nameEsc + '</div>' +
                        '<span class="instance-status-badge">' + badgeText + '</span>' +
                        '</div></div>';
                }
                gridEl.innerHTML = html;
                gridEl.querySelectorAll('.root-folders-instance-status-card').forEach(function(card) {
                    var val = card.getAttribute('data-value');
                    if (val) {
                        card.style.cursor = 'pointer';
                        card.addEventListener('click', function() {
                            var sel = document.getElementById('settings-root-folders-instance-select');
                            if (sel && val) { sel.value = val; window.RootFolders.onCombinedInstanceChange(); }
                        });
                    }
                });
            });
        }).catch(function() {
            gridEl.innerHTML = '';
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() { window.RootFolders.init(); });
    } else {
        window.RootFolders.init();
    }
})();


/* === modules/features/settings/remote-mappings.js === */
/**
 * Remote Mappings (Movie Hunt) - table-based UI with edit modal
 * Attaches to window.RemoteMappings. Load after settings core.
 */
(function() {
    'use strict';

    window.RemoteMappings = {
        currentMappings: [],
        editingIndex: null,
        downloadClients: [],

        refreshList: function() {
            const tbody = document.getElementById('remote-mappings-table-body');
            if (!tbody) return;

            // Fetch mappings
            fetch('./api/movie-hunt/remote-mappings')
                .then(r => r.json())
                .then(data => {
                    this.currentMappings = (data && data.mappings) ? data.mappings : [];
                    
                    // Clear and rebuild table
                    tbody.innerHTML = '';
                    
                    if (this.currentMappings.length === 0) {
                        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 20px; color: #94a3b8;">No remote path mappings configured</td></tr>';
                        return;
                    }

                    this.currentMappings.forEach((mapping, idx) => {
                        const row = document.createElement('tr');
                        row.innerHTML = `
                            <td>${this.escapeHtml(mapping.host || '')}</td>
                            <td>${this.escapeHtml(mapping.local_path || '')}</td>
                            <td>${this.escapeHtml(mapping.remote_path || '')}</td>
                            <td class="remote-mappings-actions-col">
                                <button class="btn-edit-mapping" data-index="${idx}" title="Edit">
                                    <i class="fas fa-edit"></i>
                                </button>
                            </td>
                        `;
                        tbody.appendChild(row);
                    });
                })
                .catch(err => {
                    console.error('[RemoteMappings] Error loading mappings:', err);
                    tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 20px; color: #fca5a5;">Error loading remote path mappings</td></tr>';
                });
        },

        loadDownloadClients: function() {
            // Load download clients from the clients API
            fetch('./api/clients')
                .then(r => r.json())
                .then(data => {
                    this.downloadClients = (data && data.clients) ? data.clients : [];
                    this.populateHostDropdown();
                })
                .catch(err => {
                    console.error('[RemoteMappings] Error loading download clients:', err);
                    this.downloadClients = [];
                    this.populateHostDropdown();
                });
        },

        populateHostDropdown: function() {
            const hostSelect = document.getElementById('remote-mapping-host');
            if (!hostSelect) return;

            // Clear existing options except the first one
            hostSelect.innerHTML = '<option value="">Select a download client...</option>';

            // Add download clients
            this.downloadClients.forEach(client => {
                const host = `${client.host || ''}:${client.port || ''}`;
                const option = document.createElement('option');
                option.value = host;
                option.textContent = `${client.name || 'Unknown'} (${host})`;
                hostSelect.appendChild(option);
            });
        },

        openAddModal: function() {
            this.editingIndex = null;
            this.loadDownloadClients();
            
            const modal = document.getElementById('remote-mapping-edit-modal');
            const title = document.getElementById('remote-mapping-modal-title');
            const deleteBtn = document.getElementById('remote-mapping-modal-delete');
            const hostSelect = document.getElementById('remote-mapping-host');
            const remotePathInput = document.getElementById('remote-mapping-remote-path');
            const localPathInput = document.getElementById('remote-mapping-local-path');

            if (title) title.textContent = 'Add Remote Path Mapping';
            if (deleteBtn) deleteBtn.style.display = 'none';
            if (hostSelect) hostSelect.value = '';
            if (remotePathInput) remotePathInput.value = '';
            if (localPathInput) localPathInput.value = '';

            if (modal) {
                if (modal.parentNode !== document.body) {
                    document.body.appendChild(modal);
                }
                modal.style.display = 'flex';
                document.body.classList.add('remote-mapping-edit-modal-open');
            }
        },

        openEditModal: function(index) {
            if (index < 0 || index >= this.currentMappings.length) return;
            
            this.editingIndex = index;
            this.loadDownloadClients();
            
            const mapping = this.currentMappings[index];
            const modal = document.getElementById('remote-mapping-edit-modal');
            const title = document.getElementById('remote-mapping-modal-title');
            const deleteBtn = document.getElementById('remote-mapping-modal-delete');
            const hostSelect = document.getElementById('remote-mapping-host');
            const remotePathInput = document.getElementById('remote-mapping-remote-path');
            const localPathInput = document.getElementById('remote-mapping-local-path');

            if (title) title.textContent = 'Edit Remote Path Mapping';
            if (deleteBtn) deleteBtn.style.display = 'flex';
            if (hostSelect) hostSelect.value = mapping.host || '';
            if (remotePathInput) remotePathInput.value = mapping.remote_path || '';
            if (localPathInput) localPathInput.value = mapping.local_path || '';

            if (modal) {
                if (modal.parentNode !== document.body) {
                    document.body.appendChild(modal);
                }
                modal.style.display = 'flex';
                document.body.classList.add('remote-mapping-edit-modal-open');
            }
        },

        closeModal: function() {
            const modal = document.getElementById('remote-mapping-edit-modal');
            if (modal) {
                modal.style.display = 'none';
                document.body.classList.remove('remote-mapping-edit-modal-open');
            }
            this.editingIndex = null;
        },

        saveMapping: function() {
            const hostSelect = document.getElementById('remote-mapping-host');
            const remotePathInput = document.getElementById('remote-mapping-remote-path');
            const localPathInput = document.getElementById('remote-mapping-local-path');

            const host = (hostSelect && hostSelect.value) ? hostSelect.value.trim() : '';
            const remotePath = (remotePathInput && remotePathInput.value) ? remotePathInput.value.trim() : '';
            const localPath = (localPathInput && localPathInput.value) ? localPathInput.value.trim() : '';

            if (!host) {
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('Please select a host', 'error');
                } else {
                    if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Please select a host', 'error');
                    else alert('Please select a host');
                }
                return;
            }

            if (!remotePath) {
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('Remote path is required', 'error');
                } else {
                    if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Remote path is required', 'error');
                    else alert('Remote path is required');
                }
                return;
            }

            if (!localPath) {
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('Local path is required', 'error');
                } else {
                    if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Local path is required', 'error');
                    else alert('Local path is required');
                }
                return;
            }

            const payload = {
                host: host,
                remote_path: remotePath,
                local_path: localPath
            };

            let url, method;
            if (this.editingIndex !== null) {
                // Update existing mapping
                url = `./api/movie-hunt/remote-mappings/${this.editingIndex}`;
                method = 'PUT';
            } else {
                // Add new mapping
                url = './api/movie-hunt/remote-mappings';
                method = 'POST';
            }

            fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })
                .then(r => r.json())
                .then(data => {
                    if (data.success) {
                        this.closeModal();
                        this.refreshList();
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification('Remote path mapping saved', 'success');
                        }
                    } else {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification(data.message || 'Failed to save mapping', 'error');
                        } else {
                            if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification(data.message || 'Failed to save mapping', 'error');
                            else alert(data.message || 'Failed to save mapping');
                        }
                    }
                })
                .catch(err => {
                    console.error('[RemoteMappings] Save error:', err);
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification('Failed to save mapping', 'error');
                    } else {
                        if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Failed to save mapping', 'error');
                        else alert('Failed to save mapping');
                    }
                });
        },

        deleteMapping: function() {
            if (this.editingIndex === null) return;

            const mapping = this.currentMappings[this.editingIndex];
            const confirmMsg = `Delete remote path mapping for ${mapping.host || 'this host'}?`;
            const self = this;
            const idx = this.editingIndex;

            const doDelete = function() {
                fetch(`./api/movie-hunt/remote-mappings/${idx}`, {
                method: 'DELETE'
            })
                .then(r => r.json())
                .then(data => {
                    if (data.success) {
                        self.closeModal();
                        self.refreshList();
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification('Remote path mapping deleted', 'success');
                        }
                    } else {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification(data.message || 'Failed to delete mapping', 'error');
                        } else {
                            if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification(data.message || 'Failed to delete mapping', 'error');
                            else alert(data.message || 'Failed to delete mapping');
                        }
                    }
                })
                .catch(err => {
                    console.error('[RemoteMappings] Delete error:', err);
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification('Failed to delete mapping', 'error');
                    } else {
                        if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Failed to delete mapping', 'error');
                        else alert('Failed to delete mapping');
                    }
                });
            };

            if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
                window.HuntarrConfirm.show({
                    title: 'Delete Remote Path Mapping',
                    message: confirmMsg,
                    confirmLabel: 'Delete',
                    onConfirm: doDelete
                });
            } else {
                if (!confirm(confirmMsg)) return;
                doDelete();
            }
        },

        escapeHtml: function(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        },

        init: function() {
            // Event listeners for table actions (edit buttons)
            const tbody = document.getElementById('remote-mappings-table-body');
            if (tbody) {
                tbody.addEventListener('click', (e) => {
                    const editBtn = e.target.closest('.btn-edit-mapping');
                    if (editBtn) {
                        const index = parseInt(editBtn.dataset.index, 10);
                        this.openEditModal(index);
                    }
                });
            }

            // Add button
            const addBtn = document.getElementById('add-remote-mapping-btn');
            if (addBtn) {
                addBtn.addEventListener('click', () => {
                    this.openAddModal();
                });
            }

            // Modal close buttons
            const closeBtn = document.getElementById('remote-mapping-edit-modal-close');
            const cancelBtn = document.getElementById('remote-mapping-modal-cancel');
            const backdrop = document.getElementById('remote-mapping-edit-modal-backdrop');
            
            if (closeBtn) {
                closeBtn.addEventListener('click', () => {
                    this.closeModal();
                });
            }
            if (cancelBtn) {
                cancelBtn.addEventListener('click', () => {
                    this.closeModal();
                });
            }
            if (backdrop) {
                backdrop.addEventListener('click', () => {
                    this.closeModal();
                });
            }

            // Save button
            const saveBtn = document.getElementById('remote-mapping-modal-save');
            if (saveBtn) {
                saveBtn.addEventListener('click', () => {
                    this.saveMapping();
                });
            }

            // Delete button
            const deleteBtn = document.getElementById('remote-mapping-modal-delete');
            if (deleteBtn) {
                deleteBtn.addEventListener('click', () => {
                    this.deleteMapping();
                });
            }

            // Local path browse: use Root Folders file browser (same design and API)
            const browseLocalBtn = document.getElementById('remote-mapping-browse-local-btn');
            const localPathInput = document.getElementById('remote-mapping-local-path');
            if (browseLocalBtn && localPathInput && window.RootFolders && typeof window.RootFolders.openBrowseModal === 'function') {
                browseLocalBtn.addEventListener('click', () => {
                    window.RootFolders.openBrowseModal(localPathInput);
                });
            }

            // ESC key to close modal
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    const modal = document.getElementById('remote-mapping-edit-modal');
                    if (modal && modal.style.display === 'flex') {
                        this.closeModal();
                    }
                }
            });
        }
    };

    // Initialize on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            window.RemoteMappings.init();
        });
    } else {
        window.RemoteMappings.init();
    }
})();


/* === modules/features/settings/custom-formats.js === */
/**
 * Custom Formats – single view for Movie Hunt and TV Hunt. Combined instance dropdown
 * (Movie - X / TV - X, alphabetical). Each instance keeps its own formats; same page linked from both sidebars.
 */
(function() {
    'use strict';

    window.CustomFormats = {
        _list: [],
        _editingIndex: null,
        _modalMode: null,
        _mode: 'movie',

        getApiBase: function() {
            return this._mode === 'tv' ? './api/tv-hunt/custom-formats' : './api/custom-formats';
        },

        getInstanceApiBase: function(mode) {
            return mode === 'tv' ? './api/tv-hunt' : './api/movie-hunt';
        },

        refreshList: function() {
            var preformattedGrid = document.getElementById('custom-formats-preformatted-grid');
            var importedGrid = document.getElementById('custom-formats-imported-grid');
            if (!preformattedGrid || !importedGrid) return;
            var apiBase = window.CustomFormats.getApiBase();
            fetch(apiBase)
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    var list = (data && data.custom_formats) ? data.custom_formats : [];
                    window.CustomFormats._list = list;
                    
                    var preformattedByGroup = {};
                    var importedItems = [];
                    var preformattedCount = 0;
                    var importedCount = 0;
                    
                    for (var i = 0; i < list.length; i++) {
                        var item = list[i];
                        var isPreformatted = (item.source || 'import').toLowerCase() === 'preformat';
                        
                        if (isPreformatted) {
                            var preformatId = item.preformat_id || '';
                            var groupKey = window.CustomFormats._getGroupFromPreformatId(preformatId);
                            if (!preformattedByGroup[groupKey]) {
                                preformattedByGroup[groupKey] = [];
                            }
                            preformattedByGroup[groupKey].push({item: item, index: i});
                            preformattedCount++;
                        } else {
                            importedItems.push({item: item, index: i});
                            importedCount++;
                        }
                    }
                    
                    var preformattedHtml = '';
                    var sortedGroups = Object.keys(preformattedByGroup).sort();
                    
                    for (var g = 0; g < sortedGroups.length; g++) {
                        var groupKey = sortedGroups[g];
                        var groupItems = preformattedByGroup[groupKey];
                        var groupName = window.CustomFormats._formatGroupName(groupKey);
                        
                        preformattedHtml += '<div class="custom-formats-group-header">' +
                            '<i class="fas fa-folder-open"></i> ' + groupName +
                            '</div>';
                        
                        for (var j = 0; j < groupItems.length; j++) {
                            var entry = groupItems[j];
                            var item = entry.item;
                            var i = entry.index;
                            var title = (item.title || item.name || 'Unnamed').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                            
                            preformattedHtml += '<div class="custom-format-card instance-card" data-index="' + i + '" data-app-type="custom-format">' +
                                '<div class="custom-format-card-header">' +
                                '<div class="custom-format-card-title"><i class="fas fa-code"></i><span>' + title + '</span></div>' +
                                '</div>' +
                                '<div class="custom-format-card-footer">' +
                                '<button type="button" class="btn-card view" data-index="' + i + '"><i class="fas fa-eye"></i> JSON</button>' +
                                '<button type="button" class="btn-card delete" data-index="' + i + '"><i class="fas fa-trash"></i> Delete</button>' +
                                '</div></div>';
                        }
                    }
                    
                    var importedHtml = '';
                    for (var k = 0; k < importedItems.length; k++) {
                        var entry = importedItems[k];
                        var item = entry.item;
                        var i = entry.index;
                        var title = (item.title || item.name || 'Unnamed').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                        
                        importedHtml += '<div class="custom-format-card instance-card" data-index="' + i + '" data-app-type="custom-format">' +
                            '<div class="custom-format-card-header">' +
                            '<div class="custom-format-card-title"><i class="fas fa-code"></i><span>' + title + '</span></div>' +
                            '</div>' +
                            '<div class="custom-format-card-footer">' +
                            '<button type="button" class="btn-card view" data-index="' + i + '"><i class="fas fa-eye"></i> JSON</button>' +
                            '<button type="button" class="btn-card edit" data-index="' + i + '"><i class="fas fa-edit"></i> Edit</button>' +
                            '<button type="button" class="btn-card delete" data-index="' + i + '"><i class="fas fa-trash"></i> Delete</button>' +
                            '</div></div>';
                    }
                    
                    preformattedGrid.innerHTML = preformattedHtml;
                    importedGrid.innerHTML = importedHtml;
                    
                    var deletePreBtn = document.getElementById('delete-all-preformatted');
                    var deleteImpBtn = document.getElementById('delete-all-imported');
                    if (deletePreBtn) deletePreBtn.disabled = preformattedCount === 0;
                    if (deleteImpBtn) deleteImpBtn.disabled = importedCount === 0;
                    
                    window.CustomFormats._bindCards();
                })
                .catch(function() {
                    preformattedGrid.innerHTML = '';
                    importedGrid.innerHTML = '';
                    window.CustomFormats._bindAddButtons();
                });
        },

        setCurrentInstanceAndRefresh: function(mode, instanceId) {
            var self = window.CustomFormats;
            self._mode = mode;
            var apiBase = self.getInstanceApiBase(mode);
            fetch(apiBase + '/instances/current', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ instance_id: parseInt(instanceId, 10) })
            }).then(function(r) { return r.json(); }).then(function() {
                self.refreshList();
            }).catch(function() {
                self.refreshList();
            });
        },

        _safeJsonFetch: function(url, fallback) {
            return fetch(url, { cache: 'no-store' }).then(function(r) { return r.json(); }).catch(function() { return fallback || {}; });
        },

        populateCombinedInstanceDropdown: function(preferMode) {
            var selectEl = document.getElementById('settings-custom-formats-instance-select');
            if (!selectEl) return;
            selectEl.innerHTML = '<option value="">Loading...</option>';
            var ts = Date.now();
            var sf = window.CustomFormats._safeJsonFetch.bind(window.CustomFormats);
            Promise.all([
                sf('./api/movie-hunt/instances?t=' + ts, { instances: [] }),
                sf('./api/tv-hunt/instances?t=' + ts, { instances: [] }),
                sf('./api/movie-hunt/instances/current?t=' + ts, { current_instance_id: null }),
                sf('./api/tv-hunt/instances/current?t=' + ts, { current_instance_id: null }),
                sf('./api/indexer-hunt/indexers?t=' + ts, { indexers: [] }),
                sf('./api/movie-hunt/has-clients?t=' + ts, { has_clients: false })
            ]).then(function(results) {
                var movieList = (results[0].instances || []).map(function(inst) {
                    return { value: 'movie:' + inst.id, label: 'Movie - ' + (inst.name || 'Instance ' + inst.id) };
                });
                var tvList = (results[1].instances || []).map(function(inst) {
                    return { value: 'tv:' + inst.id, label: 'TV - ' + (inst.name || 'Instance ' + inst.id) };
                });
                var combined = movieList.concat(tvList);
                combined.sort(function(a, b) { return (a.label || '').localeCompare(b.label || '', undefined, { sensitivity: 'base' }); });
                var currentMovie = results[2].current_instance_id != null ? Number(results[2].current_instance_id) : null;
                var currentTv = results[3].current_instance_id != null ? Number(results[3].current_instance_id) : null;
                selectEl.innerHTML = '';
                if (combined.length === 0) {
                    var emptyOpt = document.createElement('option');
                    emptyOpt.value = '';
                    emptyOpt.textContent = 'No Movie or TV Hunt instances';
                    selectEl.appendChild(emptyOpt);
                    var noInstEl = document.getElementById('settings-custom-formats-no-instances');
                    var noIdxEl = document.getElementById('settings-custom-formats-no-indexers');
                    var noCliEl = document.getElementById('settings-custom-formats-no-clients');
                    var wrapperEl = document.getElementById('settings-custom-formats-content-wrapper');
                    if (noInstEl) noInstEl.style.display = '';
                    if (noIdxEl) noIdxEl.style.display = 'none';
                    if (noCliEl) noCliEl.style.display = 'none';
                    if (wrapperEl) wrapperEl.style.display = 'none';
                    return;
                }
                var indexerCount = (results[4].indexers || []).length;
                if (indexerCount === 0) {
                    selectEl.innerHTML = '';
                    var emptyOpt = document.createElement('option');
                    emptyOpt.value = '';
                    emptyOpt.textContent = 'No indexers configured';
                    selectEl.appendChild(emptyOpt);
                    var noInstEl = document.getElementById('settings-custom-formats-no-instances');
                    var noIdxEl = document.getElementById('settings-custom-formats-no-indexers');
                    var noCliEl = document.getElementById('settings-custom-formats-no-clients');
                    var wrapperEl = document.getElementById('settings-custom-formats-content-wrapper');
                    if (noInstEl) noInstEl.style.display = 'none';
                    if (noIdxEl) noIdxEl.style.display = '';
                    if (noCliEl) noCliEl.style.display = 'none';
                    if (wrapperEl) wrapperEl.style.display = 'none';
                    return;
                }
                var hasClients = results[5].has_clients === true;
                if (!hasClients) {
                    selectEl.innerHTML = '';
                    var emptyOpt = document.createElement('option');
                    emptyOpt.value = '';
                    emptyOpt.textContent = 'No clients configured';
                    selectEl.appendChild(emptyOpt);
                    var noInstEl = document.getElementById('settings-custom-formats-no-instances');
                    var noIdxEl = document.getElementById('settings-custom-formats-no-indexers');
                    var noCliEl = document.getElementById('settings-custom-formats-no-clients');
                    var wrapperEl = document.getElementById('settings-custom-formats-content-wrapper');
                    if (noInstEl) noInstEl.style.display = 'none';
                    if (noIdxEl) noIdxEl.style.display = 'none';
                    if (noCliEl) noCliEl.style.display = '';
                    if (wrapperEl) wrapperEl.style.display = 'none';
                    return;
                }
                combined.forEach(function(item) {
                    var opt = document.createElement('option');
                    opt.value = item.value;
                    opt.textContent = item.label;
                    selectEl.appendChild(opt);
                });
                var saved = (typeof localStorage !== 'undefined' && localStorage.getItem('media-hunt-custom-formats-last-instance')) || '';
                var selected = '';
                if (preferMode === 'movie' && currentMovie != null) {
                    selected = 'movie:' + currentMovie;
                    if (!combined.some(function(i) { return i.value === selected; })) selected = combined[0].value;
                } else if (preferMode === 'tv' && currentTv != null) {
                    selected = 'tv:' + currentTv;
                    if (!combined.some(function(i) { return i.value === selected; })) selected = combined[0].value;
                } else if (saved && combined.some(function(i) { return i.value === saved; })) {
                    selected = saved;
                } else if (currentMovie != null && combined.some(function(i) { return i.value === 'movie:' + currentMovie; })) {
                    selected = 'movie:' + currentMovie;
                } else if (currentTv != null && combined.some(function(i) { return i.value === 'tv:' + currentTv; })) {
                    selected = 'tv:' + currentTv;
                } else {
                    selected = combined[0].value;
                }
                selectEl.value = selected;
                var noInstEl = document.getElementById('settings-custom-formats-no-instances');
                var noIdxEl = document.getElementById('settings-custom-formats-no-indexers');
                var noCliEl = document.getElementById('settings-custom-formats-no-clients');
                var wrapperEl = document.getElementById('settings-custom-formats-content-wrapper');
                if (noInstEl) noInstEl.style.display = 'none';
                if (noIdxEl) noIdxEl.style.display = 'none';
                if (noCliEl) noCliEl.style.display = 'none';
                if (wrapperEl) wrapperEl.style.display = '';
                var parts = (selected || '').split(':');
                if (parts.length === 2) {
                    var m = parts[0] === 'tv' ? 'tv' : 'movie';
                    if (typeof localStorage !== 'undefined') localStorage.setItem('media-hunt-custom-formats-last-instance', selected);
                    window.CustomFormats.setCurrentInstanceAndRefresh(m, parts[1]);
                }
            }).catch(function() {
                selectEl.innerHTML = '<option value="">Failed to load instances</option>';
                var noInstEl = document.getElementById('settings-custom-formats-no-instances');
                var noIdxEl = document.getElementById('settings-custom-formats-no-indexers');
                var noCliEl = document.getElementById('settings-custom-formats-no-clients');
                var wrapperEl = document.getElementById('settings-custom-formats-content-wrapper');
                if (noInstEl) noInstEl.style.display = 'none';
                if (noIdxEl) noIdxEl.style.display = 'none';
                if (noCliEl) noCliEl.style.display = '';
                if (wrapperEl) wrapperEl.style.display = 'none';
            });
        },

        onCombinedInstanceChange: function() {
            var selectEl = document.getElementById('settings-custom-formats-instance-select');
            var val = (selectEl && selectEl.value) ? selectEl.value.trim() : '';
            if (!val) return;
            var parts = val.split(':');
            if (parts.length !== 2) return;
            var mode = parts[0] === 'tv' ? 'tv' : 'movie';
            if (typeof localStorage !== 'undefined') localStorage.setItem('media-hunt-custom-formats-last-instance', val);
            window.CustomFormats.setCurrentInstanceAndRefresh(mode, parts[1]);
        },

        initOrRefresh: function(preferMode) {
            var selectEl = document.getElementById('settings-custom-formats-instance-select');
            if (!selectEl) return;
            if (!selectEl._customFormatsChangeBound) {
                selectEl.addEventListener('change', function() { window.CustomFormats.onCombinedInstanceChange(); });
                selectEl._customFormatsChangeBound = true;
            }
            window.CustomFormats.populateCombinedInstanceDropdown(preferMode);
        },

        _getGroupFromPreformatId: function(preformatId) {
            if (!preformatId) return 'Other';
            var parts = preformatId.split('.');
            return parts[0] || 'Other';
        },

        _formatGroupName: function(groupKey) {
            if (!groupKey || groupKey === 'Other') return 'Other';
            var categoryNames = {
                'movie-versions': 'Movie Versions',
                'hdr-formats': 'HDR Formats',
                'audio-formats': 'Audio Formats',
                'audio-channels': 'Audio Channels',
                'audio-advanced': 'Audio Advanced',
                'movie-meta': 'Movie Metadata',
                'streaming-services': 'Streaming Services',
                'unwanted': 'Unwanted',
                'misc': 'Miscellaneous',
                'optional': 'Optional'
            };
            return categoryNames[groupKey] || groupKey.split('-').map(function(s) {
                return s.charAt(0).toUpperCase() + s.slice(1);
            }).join(' ');
        },

        _bindCards: function() {
            var allCards = document.querySelectorAll('.custom-format-card');
            allCards.forEach(function(card) {
                var viewBtn = card.querySelector('.btn-card.view');
                var editBtn = card.querySelector('.btn-card.edit');
                var deleteBtn = card.querySelector('.btn-card.delete');
                
                if (viewBtn) {
                    viewBtn.onclick = function(e) {
                        e.stopPropagation();
                        var idx = parseInt(viewBtn.getAttribute('data-index'), 10);
                        if (!isNaN(idx)) window.CustomFormats.openViewModal(idx);
                    };
                }
                if (editBtn) {
                    editBtn.onclick = function(e) {
                        e.stopPropagation();
                        var idx = parseInt(editBtn.getAttribute('data-index'), 10);
                        if (!isNaN(idx)) window.CustomFormats.openEditModal(idx);
                    };
                }
                if (deleteBtn) {
                    deleteBtn.onclick = function(e) {
                        e.stopPropagation();
                        var idx = parseInt(deleteBtn.getAttribute('data-index'), 10);
                        if (!isNaN(idx)) window.CustomFormats.deleteFormat(idx);
                    };
                }
            });
            window.CustomFormats._bindAddButtons();
        },

        _bindAddButtons: function() {
            var addPreformattedBtn = document.getElementById('add-preformatted-btn');
            var addImportedBtn = document.getElementById('add-imported-btn');
            if (addPreformattedBtn) {
                addPreformattedBtn.onclick = function() { 
                    window.CustomFormats.openAddModal('preformat'); 
                };
            }
            if (addImportedBtn) {
                addImportedBtn.onclick = function() { 
                    window.CustomFormats.openAddModal('import'); 
                };
            }
        },

        openViewModal: function(index) {
            var list = window.CustomFormats._list;
            if (index < 0 || index >= list.length) return;
            window.CustomFormats._ensureViewModalInBody();
            var item = list[index];
            var title = (item.title || item.name || 'Unnamed');
            document.getElementById('custom-format-view-modal-title').textContent = 'View JSON: ' + title;
            var jsonStr = item.custom_format_json || '{}';
            try {
                var parsed = JSON.parse(jsonStr);
                jsonStr = JSON.stringify(parsed, null, 2);
            } catch (e) {
                // If parse fails, show as-is
            }
            document.getElementById('custom-format-view-json').textContent = jsonStr;
            document.getElementById('custom-format-view-modal').style.display = 'flex';
            document.body.classList.add('custom-format-modal-open');
        },

        closeViewModal: function() {
            document.getElementById('custom-format-view-modal').style.display = 'none';
            document.body.classList.remove('custom-format-modal-open');
        },

        _generateRandomSuffix: function() {
            var chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
            var suffix = '';
            for (var i = 0; i < 4; i++) {
                suffix += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            return suffix;
        },

        _checkTitleCollision: function(title) {
            var list = window.CustomFormats._list || [];
            var preformattedTitles = {};
            for (var i = 0; i < list.length; i++) {
                if ((list[i].source || 'import').toLowerCase() === 'preformat') {
                    var t = (list[i].title || list[i].name || '').toLowerCase();
                    if (t) preformattedTitles[t] = true;
                }
            }
            var lowerTitle = title.toLowerCase();
            if (preformattedTitles[lowerTitle]) {
                return title + '-' + window.CustomFormats._generateRandomSuffix();
            }
            return title;
        },

        _ensureAddModalInBody: function() {
            var modal = document.getElementById('custom-format-modal');
            if (modal && modal.parentNode !== document.body) {
                document.body.appendChild(modal);
            }
        },
        _ensureViewModalInBody: function() {
            var modal = document.getElementById('custom-format-view-modal');
            if (modal && modal.parentNode !== document.body) {
                document.body.appendChild(modal);
            }
        },

        openAddModal: function(source) {
            window.CustomFormats._editingIndex = null;
            window.CustomFormats._modalMode = source;
            window.CustomFormats._ensureAddModalInBody();

            if (source === 'preformat') {
                document.getElementById('custom-format-modal-title').textContent = 'Add Pre-Formatted';
                document.getElementById('custom-format-preformat-area').style.display = 'block';
                var importArea = document.getElementById('custom-format-import-area');
                if (importArea) importArea.style.display = 'none';
                window.CustomFormats._loadPreformatTree();
            } else {
                document.getElementById('custom-format-modal-title').textContent = 'Add Imported';
                document.getElementById('custom-format-preformat-area').style.display = 'none';
                var importArea = document.getElementById('custom-format-import-area');
                if (importArea) importArea.style.display = 'block';
            }

            document.getElementById('custom-format-modal-save').innerHTML = '<i class="fas fa-plus"></i> Add';
            document.getElementById('custom-format-json-textarea').value = '';
            document.getElementById('custom-format-modal').style.display = 'flex';
            document.body.classList.add('custom-format-modal-open');
        },

        openEditModal: function(index) {
            var list = window.CustomFormats._list;
            if (index < 0 || index >= list.length) return;
            window.CustomFormats._ensureAddModalInBody();
            window.CustomFormats._editingIndex = index;
            var item = list[index];
            document.getElementById('custom-format-modal-title').textContent = 'Edit Custom Format';
            document.getElementById('custom-format-modal-save').innerHTML = '<i class="fas fa-save"></i> Save';
            document.getElementById('custom-format-source-import').checked = true;
            document.getElementById('custom-format-preformat-area').style.display = 'none';
            var importArea = document.getElementById('custom-format-import-area');
            if (importArea) importArea.style.display = 'block';
            document.getElementById('custom-format-json-textarea').value = item.custom_format_json || '{}';
            document.getElementById('custom-format-modal').style.display = 'flex';
            document.body.classList.add('custom-format-modal-open');
        },

        closeModal: function() {
            document.getElementById('custom-format-modal').style.display = 'none';
            document.body.classList.remove('custom-format-modal-open');
        },

        _buildPreformatId: function(catId, subId, fmtId) {
            if (subId) return catId + '.' + subId + '.' + fmtId;
            return catId + '.' + fmtId;
        },

        _loadPreformatTree: function() {
            var treeEl = document.getElementById('custom-format-preformat-tree');
            if (!treeEl) return;
            treeEl.innerHTML = '<span class="custom-format-loading">Loading…</span>';
            var existingIds = {};
            (window.CustomFormats._list || []).forEach(function(item) {
                if (item.preformat_id) existingIds[item.preformat_id] = true;
            });
            fetch(window.CustomFormats.getApiBase() + '/preformats')
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    var categories = (data && data.categories) ? data.categories : [];
                    treeEl.innerHTML = '';
                    if (categories.length === 0) {
                        var msg = document.createElement('div');
                        msg.className = 'custom-format-preformat-empty';
                        msg.innerHTML = 'Pre-formatted list is not available on this server. You can still add formats via <strong>Import</strong> by pasting JSON from <a href="https://trash-guides.info/Radarr/Radarr-collection-of-custom-formats/" target="_blank" rel="noopener">TRaSH Guides</a>.';
                        treeEl.appendChild(msg);
                        return;
                    }
                    categories.forEach(function(cat) {
                        var catId = cat.id || '';
                        var catName = cat.name || catId;
                        var catDiv = document.createElement('div');
                        catDiv.className = 'custom-format-cat';
                        var header = document.createElement('div');
                        header.className = 'custom-format-cat-header';
                        header.innerHTML = '<i class="fas fa-chevron-down"></i><span>' + (catName.replace(/</g, '&lt;').replace(/>/g, '&gt;')) + '</span>';
                        var body = document.createElement('div');
                        body.className = 'custom-format-cat-body';
                        var subcats = cat.subcategories || [];
                        if (subcats.length > 0) {
                            subcats.forEach(function(sub) {
                                var subId = sub.id || '';
                                var subName = sub.name || subId;
                                var subDiv = document.createElement('div');
                                subDiv.className = 'custom-format-subcat';
                                var subLabel = document.createElement('div');
                                subLabel.className = 'custom-format-subcat-name';
                                subLabel.textContent = subName;
                                subDiv.appendChild(subLabel);
                                var fmtList = document.createElement('div');
                                fmtList.className = 'custom-format-format-list';
                                (sub.formats || []).forEach(function(fmt) {
                                    var fid = window.CustomFormats._buildPreformatId(catId, subId, fmt.id || '');
                                    var name = fmt.name || fid;
                                    var already = existingIds[fid];
                                    var label = document.createElement('label');
                                    label.className = 'custom-format-format-item';
                                    var cb = document.createElement('input');
                                    cb.type = 'checkbox';
                                    cb.setAttribute('data-preformat-id', fid);
                                    cb.setAttribute('data-format-name', name);
                                    if (already) { cb.checked = true; cb.disabled = true; }
                                    label.appendChild(cb);
                                    label.appendChild(document.createElement('span')).textContent = name;
                                    fmtList.appendChild(label);
                                });
                                subDiv.appendChild(fmtList);
                                body.appendChild(subDiv);
                            });
                        } else {
                            var fmtList = document.createElement('div');
                            fmtList.className = 'custom-format-format-list';
                            (cat.formats || []).forEach(function(fmt) {
                                var fid = window.CustomFormats._buildPreformatId(catId, null, fmt.id || '');
                                var name = fmt.name || fid;
                                var already = existingIds[fid];
                                var label = document.createElement('label');
                                label.className = 'custom-format-format-item';
                                var cb = document.createElement('input');
                                cb.type = 'checkbox';
                                cb.setAttribute('data-preformat-id', fid);
                                cb.setAttribute('data-format-name', name);
                                if (already) { cb.checked = true; cb.disabled = true; }
                                label.appendChild(cb);
                                label.appendChild(document.createElement('span')).textContent = name;
                                fmtList.appendChild(label);
                            });
                            body.appendChild(fmtList);
                        }
                        header.onclick = function() {
                            header.classList.toggle('collapsed');
                            body.classList.toggle('collapsed');
                        };
                        catDiv.appendChild(header);
                        catDiv.appendChild(body);
                        treeEl.appendChild(catDiv);
                    });
                })
                .catch(function() {
                    treeEl.innerHTML = '<span class="custom-format-loading" style="color:#f87171;">Failed to load formats.</span>';
                });
        },

        _nameFromJson: function(str) {
            if (!str || typeof str !== 'string') return '—';
            try {
                var obj = JSON.parse(str);
                return (obj && obj.name != null) ? String(obj.name).trim() || '—' : '—';
            } catch (e) { return '—'; }
        },

        _onSourceChange: function() {
            var isPre = document.getElementById('custom-format-source-preformat').checked;
            var preformatArea = document.getElementById('custom-format-preformat-area');
            var importArea = document.getElementById('custom-format-import-area');
            var jsonTa = document.getElementById('custom-format-json-textarea');
            if (preformatArea) preformatArea.style.display = isPre ? 'block' : 'none';
            if (importArea) importArea.style.display = isPre ? 'none' : 'block';
            if (isPre) {
                if (jsonTa) jsonTa.value = '';
                window.CustomFormats._loadPreformatTree();
            } else {
                if (window.CustomFormats._editingIndex != null) {
                    var list = window.CustomFormats._list;
                    var idx = window.CustomFormats._editingIndex;
                    if (list && idx >= 0 && idx < list.length && jsonTa) {
                        jsonTa.value = list[idx].custom_format_json || '{}';
                    }
                } else if (jsonTa) {
                    jsonTa.value = '';
                }
            }
        },

        saveModal: function() {
            var editing = window.CustomFormats._editingIndex;

            if (editing != null) {
                var jsonRaw = document.getElementById('custom-format-json-textarea').value.trim();
                if (!jsonRaw) {
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification('Paste valid JSON to edit.', 'error');
                    }
                    return;
                }
                try { JSON.parse(jsonRaw); } catch (e) {
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification('Invalid JSON.', 'error');
                    }
                    return;
                }
                var title = window.CustomFormats._nameFromJson(jsonRaw);
                if (title === '—') title = 'Unnamed';
                fetch(window.CustomFormats.getApiBase() + '/' + editing, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title: title, custom_format_json: jsonRaw })
                })
                    .then(function(r) { return r.json(); })
                    .then(function(data) {
                        if (data.success) {
                            if (window.huntarrUI && window.huntarrUI.showNotification) {
                                window.huntarrUI.showNotification('Custom format updated.', 'success');
                            }
                            window.CustomFormats.closeModal();
                            window.CustomFormats.refreshList();
                        } else {
                            if (window.huntarrUI && window.huntarrUI.showNotification) {
                                window.huntarrUI.showNotification(data.message || data.error || 'Update failed', 'error');
                            }
                        }
                    })
                    .catch(function() {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification('Update failed', 'error');
                        }
                    });
                return;
            }

            var isPre = window.CustomFormats._modalMode === 'preformat';
            if (isPre) {
                var tree = document.getElementById('custom-format-preformat-tree');
                var checkboxes = tree ? tree.querySelectorAll('input[type="checkbox"][data-preformat-id]:checked:not(:disabled)') : [];
                var toAdd = [];
                checkboxes.forEach(function(cb) {
                    toAdd.push({ id: cb.getAttribute('data-preformat-id'), name: cb.getAttribute('data-format-name') || cb.getAttribute('data-preformat-id') });
                });
                if (toAdd.length === 0) {
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification('Check at least one format to add.', 'error');
                    }
                    return;
                }
                var done = 0;
                var failed = 0;
                var currentIndex = 0;
                
                function addNext() {
                    if (currentIndex >= toAdd.length) {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            if (failed === 0) {
                                window.huntarrUI.showNotification('Added ' + done + ' format(s).', 'success');
                            } else {
                                window.huntarrUI.showNotification('Added ' + done + ', failed ' + failed + '.', failed ? 'error' : 'success');
                            }
                        }
                        window.CustomFormats.closeModal();
                        window.CustomFormats.refreshList();
                        return;
                    }
                    
                    var item = toAdd[currentIndex];
                    currentIndex++;
                    
                    fetch(window.CustomFormats.getApiBase(), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ source: 'preformat', preformat_id: item.id, title: item.name })
                    })
                        .then(function(r) { return r.json(); })
                        .then(function(data) {
                            if (data.success) done++; else failed++;
                            addNext();
                        })
                        .catch(function() {
                            failed++;
                            addNext();
                        });
                }
                
                addNext();
                return;
            }
            var jsonRaw = document.getElementById('custom-format-json-textarea').value.trim();
            if (!jsonRaw) {
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('Paste Custom Format JSON.', 'error');
                }
                return;
            }
            try { JSON.parse(jsonRaw); } catch (e) {
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('Invalid JSON.', 'error');
                }
                return;
            }
            var title = window.CustomFormats._nameFromJson(jsonRaw);
            if (title === '—') title = 'Unnamed';
            title = window.CustomFormats._checkTitleCollision(title);
            var body = { source: 'import', custom_format_json: jsonRaw, title: title };

            fetch(window.CustomFormats.getApiBase(), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.success) {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification('Custom format added.', 'success');
                        }
                        window.CustomFormats.closeModal();
                        window.CustomFormats.refreshList();
                    } else {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification(data.message || data.error || 'Add failed', 'error');
                        }
                    }
                })
                .catch(function() {
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification('Add failed', 'error');
                    }
                });
        },

        deleteFormat: function(index) {
            var self = window.CustomFormats;
            var doDelete = function() {
                fetch(self.getApiBase() + '/' + index, { method: 'DELETE' })
                    .then(function(r) { return r.json(); })
                    .then(function(data) {
                        if (data.success) {
                            if (window.huntarrUI && window.huntarrUI.showNotification) {
                                window.huntarrUI.showNotification('Custom format removed.', 'success');
                            }
                            window.CustomFormats.refreshList();
                        } else {
                            if (window.huntarrUI && window.huntarrUI.showNotification) {
                                window.huntarrUI.showNotification(data.message || 'Delete failed', 'error');
                            }
                        }
                    })
                    .catch(function() {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification('Delete failed', 'error');
                        }
                    });
            };
            if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
                window.HuntarrConfirm.show({
                    title: 'Remove Custom Format',
                    message: 'Remove this custom format?',
                    confirmLabel: 'Remove',
                    onConfirm: doDelete
                });
            } else {
                if (!confirm('Remove this custom format?')) return;
                doDelete();
            }
        },

        deleteAllByType: function(type) {
            var list = window.CustomFormats._list || [];
            var toDelete = [];
            
            for (var i = 0; i < list.length; i++) {
                var item = list[i];
                var isPreformatted = (item.source || 'import').toLowerCase() === 'preformat';
                if ((type === 'preformat' && isPreformatted) || (type === 'import' && !isPreformatted)) {
                    toDelete.push(i);
                }
            }
            
            if (toDelete.length === 0) {
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('No formats to delete.', 'info');
                }
                return;
            }
            
            var typeName = type === 'preformat' ? 'pre-formatted' : 'imported';
            var confirmMsg = 'Delete all ' + toDelete.length + ' ' + typeName + ' custom format(s)?\n\nThis action cannot be undone.';
            var deleted = 0;
            var failed = 0;
            var currentIndex = toDelete.length - 1;

            function runDeleteAll() {
                currentIndex = toDelete.length - 1;
                deleted = 0;
                failed = 0;
                deleteNext();
            }
            
            function deleteNext() {
                if (currentIndex < 0) {
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        if (failed === 0) {
                            window.huntarrUI.showNotification('Deleted ' + deleted + ' format(s).', 'success');
                        } else {
                            window.huntarrUI.showNotification('Deleted ' + deleted + ', failed ' + failed + '.', failed > 0 ? 'error' : 'success');
                        }
                    }
                    window.CustomFormats.refreshList();
                    return;
                }
                
                var idx = toDelete[currentIndex];
                currentIndex--;
                
                fetch(window.CustomFormats.getApiBase() + '/' + idx, { method: 'DELETE' })
                    .then(function(r) { return r.json(); })
                    .then(function(data) {
                        if (data.success) deleted++; else failed++;
                        deleteNext();
                    })
                    .catch(function() {
                        failed++;
                        deleteNext();
                    });
            }

            if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
                window.HuntarrConfirm.show({
                    title: 'Delete All ' + typeName.charAt(0).toUpperCase() + typeName.slice(1) + ' Custom Formats',
                    message: confirmMsg,
                    confirmLabel: 'Delete All',
                    onConfirm: runDeleteAll
                });
            } else {
                if (!confirm(confirmMsg)) return;
                runDeleteAll();
            }
        },

        init: function() {
            var self = window.CustomFormats;
            var modal = document.getElementById('custom-format-modal');
            var backdrop = document.getElementById('custom-format-modal-backdrop');
            var closeBtn = document.getElementById('custom-format-modal-close');
            var cancelBtn = document.getElementById('custom-format-modal-cancel');
            var saveBtn = document.getElementById('custom-format-modal-save');
            if (backdrop) backdrop.onclick = function() { self.closeModal(); };
            if (closeBtn) closeBtn.onclick = function() { self.closeModal(); };
            if (cancelBtn) cancelBtn.onclick = function() { self.closeModal(); };
            if (saveBtn) saveBtn.onclick = function() { self.saveModal(); };
            
            var viewModal = document.getElementById('custom-format-view-modal');
            var viewBackdrop = document.getElementById('custom-format-view-modal-backdrop');
            var viewCloseBtn = document.getElementById('custom-format-view-modal-close');
            var viewCloseBtnFooter = document.getElementById('custom-format-view-modal-close-btn');
            if (viewBackdrop) viewBackdrop.onclick = function() { self.closeViewModal(); };
            if (viewCloseBtn) viewCloseBtn.onclick = function() { self.closeViewModal(); };
            if (viewCloseBtnFooter) viewCloseBtnFooter.onclick = function() { self.closeViewModal(); };
            
            var deleteAllPreBtn = document.getElementById('delete-all-preformatted');
            var deleteAllImpBtn = document.getElementById('delete-all-imported');
            if (deleteAllPreBtn) {
                deleteAllPreBtn.onclick = function() { self.deleteAllByType('preformat'); };
            }
            if (deleteAllImpBtn) {
                deleteAllImpBtn.onclick = function() { self.deleteAllByType('import'); };
            }
            
            document.querySelectorAll('input[name="custom-format-source"]').forEach(function(radio) {
                radio.onchange = function() { self._onSourceChange(); };
            });
            var jsonTa = document.getElementById('custom-format-json-textarea');
            if (jsonTa) { /* title is derived from JSON on save */ }
            document.addEventListener('keydown', function(e) {
                if (e.key === 'Escape') {
                    if (viewModal && viewModal.style.display === 'flex') {
                        self.closeViewModal();
                    } else if (modal && modal.style.display === 'flex') {
                        self.closeModal();
                    }
                }
            });
        }
    };

    document.addEventListener('huntarr:instances-changed', function() {
        if (document.getElementById('settingsCustomFormatsSection') && document.getElementById('settingsCustomFormatsSection').classList.contains('active')) {
            window.CustomFormats.initOrRefresh();
        }
    });
    document.addEventListener('huntarr:tv-hunt-instances-changed', function() {
        if (document.getElementById('settingsCustomFormatsSection') && document.getElementById('settingsCustomFormatsSection').classList.contains('active')) {
            window.CustomFormats.initOrRefresh();
        }
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() { window.CustomFormats.init(); });
    } else {
        window.CustomFormats.init();
    }
})();


/* === modules/features/settings/media-hunt-instance-management.js === */
/**
 * Media Hunt Instance Management – shows Movie and TV instance lists in separate sections.
 * Loads both, wires Add Instance modals, and delegates click handlers.
 */
(function() {
    'use strict';

    var baseUrl = (typeof window !== 'undefined' && window.HUNTARR_BASE_URL) ? window.HUNTARR_BASE_URL.replace(/\/$/, '') : '';
    function api(path) {
        return (baseUrl || '') + (path.indexOf('./') === 0 ? path : './' + path);
    }

    window.MediaHuntInstanceManagement = window.MediaHuntInstanceManagement || {};

    function openAddMovieModal() {
        var modal = document.getElementById('media-hunt-instance-add-movie-modal');
        var input = document.getElementById('media-hunt-instance-add-movie-name');
        if (modal && modal.parentNode !== document.body) document.body.appendChild(modal);
        if (modal) modal.style.display = 'flex';
        if (input) { input.value = ''; setTimeout(function() { input.focus(); }, 100); }
        document.body.classList.add('media-hunt-instance-add-modal-open');
    }

    function closeAddMovieModal() {
        var modal = document.getElementById('media-hunt-instance-add-movie-modal');
        if (modal) modal.style.display = 'none';
        document.body.classList.remove('media-hunt-instance-add-modal-open');
    }

    function openAddTVModal() {
        var modal = document.getElementById('media-hunt-instance-add-tv-modal');
        var input = document.getElementById('media-hunt-instance-add-tv-name');
        if (modal && modal.parentNode !== document.body) document.body.appendChild(modal);
        if (modal) modal.style.display = 'flex';
        if (input) { input.value = ''; setTimeout(function() { input.focus(); }, 100); }
        document.body.classList.add('media-hunt-instance-add-modal-open');
    }

    function closeAddTVModal() {
        var modal = document.getElementById('media-hunt-instance-add-tv-modal');
        if (modal) modal.style.display = 'none';
        document.body.classList.remove('media-hunt-instance-add-modal-open');
    }

    var _modalsInited = false;
    function initModals() {
        if (_modalsInited) return;
        _modalsInited = true;
        var movieBackdrop = document.getElementById('media-hunt-instance-add-movie-modal-backdrop');
        var movieClose = document.getElementById('media-hunt-instance-add-movie-modal-close');
        var movieCancel = document.getElementById('media-hunt-instance-add-movie-modal-cancel');
        var movieSave = document.getElementById('media-hunt-instance-add-movie-modal-save');
        var movieInput = document.getElementById('media-hunt-instance-add-movie-name');
        if (movieBackdrop) movieBackdrop.onclick = closeAddMovieModal;
        if (movieClose) movieClose.onclick = closeAddMovieModal;
        if (movieCancel) movieCancel.onclick = closeAddMovieModal;
        if (movieSave && movieInput) {
            movieSave.onclick = function() {
                var name = (movieInput.value || '').trim() || 'Unnamed';
                movieSave.disabled = true;
                fetch(api('./api/movie-hunt/instances'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: name })
                })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.success) {
                        if (typeof document.dispatchEvent === 'function') {
                            document.dispatchEvent(new CustomEvent('huntarr:instances-changed'));
                        }
                        if (window.MovieHuntInstanceEditor && window.MovieHuntInstanceEditor.loadInstanceList) {
                            window.MovieHuntInstanceEditor.loadInstanceList();
                        }
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification('Movie instance added.', 'success');
                        }
                        closeAddMovieModal();
                    } else {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification(data.error || 'Failed to add instance.', 'error');
                        }
                    }
                })
                .catch(function() {
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification('Failed to add instance.', 'error');
                    }
                })
                .finally(function() { movieSave.disabled = false; });
            };
        }

        var tvBackdrop = document.getElementById('media-hunt-instance-add-tv-modal-backdrop');
        var tvClose = document.getElementById('media-hunt-instance-add-tv-modal-close');
        var tvCancel = document.getElementById('media-hunt-instance-add-tv-modal-cancel');
        var tvSave = document.getElementById('media-hunt-instance-add-tv-modal-save');
        var tvInput = document.getElementById('media-hunt-instance-add-tv-name');
        if (tvBackdrop) tvBackdrop.onclick = closeAddTVModal;
        if (tvClose) tvClose.onclick = closeAddTVModal;
        if (tvCancel) tvCancel.onclick = closeAddTVModal;
        if (tvSave && tvInput) {
            tvSave.onclick = function() {
                var name = (tvInput.value || '').trim() || 'Unnamed';
                tvSave.disabled = true;
                fetch(api('./api/tv-hunt/instances'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: name })
                })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.success) {
                        if (typeof document.dispatchEvent === 'function') {
                            document.dispatchEvent(new CustomEvent('huntarr:tv-hunt-instances-changed'));
                        }
                        if (window.TVHuntInstanceEditor && window.TVHuntInstanceEditor.loadInstanceList) {
                            window.TVHuntInstanceEditor.loadInstanceList();
                        }
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification('TV instance added.', 'success');
                        }
                        closeAddTVModal();
                    } else {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification(data.error || 'Failed to add instance.', 'error');
                        }
                    }
                })
                .catch(function() {
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification('Failed to add instance.', 'error');
                    }
                })
                .finally(function() { tvSave.disabled = false; });
            };
        }

        document.addEventListener('keydown', function modalKeydown(e) {
            if (e.key !== 'Escape') return;
            var movieModal = document.getElementById('media-hunt-instance-add-movie-modal');
            var tvModal = document.getElementById('media-hunt-instance-add-tv-modal');
            if (movieModal && movieModal.style.display === 'flex') { closeAddMovieModal(); return; }
            if (tvModal && tvModal.style.display === 'flex') { closeAddTVModal(); return; }
        });
    }

    function initGridListeners() {
        var movieGrid = document.getElementById('movie-hunt-settings-instances-grid');
        var tvGrid = document.getElementById('tv-hunt-settings-instances-grid');
        if (movieGrid && !movieGrid._instanceMgmtBound) {
            movieGrid._instanceMgmtBound = true;
            movieGrid.addEventListener('click', function(e) {
                var addCard = e.target.closest('.add-instance-card[data-app-type="media-hunt-instance-movie"]');
                if (addCard) {
                    e.preventDefault();
                    e.stopPropagation();
                    openAddMovieModal();
                }
            });
        }
        if (tvGrid && !tvGrid._instanceMgmtBound) {
            tvGrid._instanceMgmtBound = true;
            tvGrid.addEventListener('click', function(e) {
                var addCard = e.target.closest('.add-instance-card[data-app-type="media-hunt-instance-tv"]');
                if (addCard) {
                    e.preventDefault();
                    e.stopPropagation();
                    openAddTVModal();
                }
            });
        }
    }

    function updateSetupWizardBanner() {
        var banner = document.getElementById('setup-wizard-continue-banner');
        if (!banner) return;
        // Show if user navigated here from the setup wizard
        // Don't remove the flag — it needs to persist across instance add/edit re-renders.
        // The flag is cleared when the user clicks "Continue to Setup Guide" or leaves the wizard flow.
        var fromWizard = false;
        try { fromWizard = sessionStorage.getItem('setup-wizard-active-nav') === '1'; } catch (e) {}
        banner.style.display = fromWizard ? 'flex' : 'none';
    }

    window.MediaHuntInstanceManagement.init = function() {
        initModals();
        initGridListeners();
        updateSetupWizardBanner();
        document.addEventListener('huntarr:instances-changed', updateSetupWizardBanner);
        document.addEventListener('huntarr:tv-hunt-instances-changed', updateSetupWizardBanner);
        if (window.MovieHuntInstanceEditor && typeof window.MovieHuntInstanceEditor.loadInstanceList === 'function') {
            window.MovieHuntInstanceEditor.loadInstanceList();
        }
        if (window.TVHuntInstanceEditor && typeof window.TVHuntInstanceEditor.loadInstanceList === 'function') {
            window.TVHuntInstanceEditor.loadInstanceList();
        }
    };
})();


/* === modules/features/settings/media-hunt-instance-editor.js === */
/**
 * Media Hunt Instance Editor – unified Movie + TV per-instance hunt settings.
 * Part 1: MovieHuntInstanceEditor (movie mode). Uses media-hunt-instance-editor-* container IDs.
 */
(function() {
    'use strict';

    var baseUrl = (typeof window !== 'undefined' && window.HUNTARR_BASE_URL) ? window.HUNTARR_BASE_URL.replace(/\/$/, '') : '';
    function api(path) {
        return (baseUrl || '') + (path.indexOf('./') === 0 ? path : './' + path);
    }
    function escapeHtml(s) {
        if (s == null) return '';
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function escapeAttr(s) {
        if (s == null) return '';
        return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    var _currentInstanceId = null;
    var _currentInstanceName = null;
    var _editorDirty = false;
    var _sleepMin = 10;

    function buildEditorHtml(s) {
        if (!s || typeof s !== 'object' || s.error) {
            s = {};
        }
        var enabled = s.enabled !== false;
        var instanceIdStr = (s.instance_id != null && s.instance_id !== '') ? String(s.instance_id) : (_currentInstanceId != null ? String(_currentInstanceId) : '');
        var instanceName = (s.name != null && s.name !== '') ? String(s.name).trim() : (_currentInstanceName != null ? String(_currentInstanceName).trim() : '');
        var safe = {
            enabled: enabled,
            name: instanceName,
            instance_id: instanceIdStr,
            hunt_missing_movies: s.hunt_missing_movies !== undefined ? s.hunt_missing_movies : 1,
            hunt_upgrade_movies: s.hunt_upgrade_movies !== undefined ? s.hunt_upgrade_movies : 0,
            upgrade_selection_method: (s.upgrade_selection_method || 'cutoff').toLowerCase(),
            upgrade_tag: (s.upgrade_tag || '').trim() || 'upgradinatorr',
            release_date_delay_days: s.release_date_delay_days !== undefined ? s.release_date_delay_days : 0,
            state_management_mode: s.state_management_mode || 'custom',
            state_management_hours: s.state_management_hours !== undefined ? s.state_management_hours : 72,
            sleep_duration: s.sleep_duration !== undefined ? s.sleep_duration : 900,
            hourly_cap: s.hourly_cap !== undefined ? s.hourly_cap : 20,
            monitored_only: s.monitored_only !== false,
            tag_processed_items: s.tag_processed_items !== false,
            tag_enable_missing: s.tag_enable_missing !== false,
            tag_enable_upgrade: s.tag_enable_upgrade !== false,
            tag_enable_upgraded: s.tag_enable_upgraded !== false,
            custom_tags: s.custom_tags || { missing: 'huntarr-missing', upgrade: 'huntarr-upgrade' },
            exempt_tags: Array.isArray(s.exempt_tags) ? s.exempt_tags : [],
            api_timeout: s.api_timeout !== undefined ? s.api_timeout : 120,
            command_wait_delay: s.command_wait_delay !== undefined ? s.command_wait_delay : 1,
            command_wait_attempts: s.command_wait_attempts !== undefined ? s.command_wait_attempts : 600,
            max_download_queue_size: s.max_download_queue_size !== undefined ? s.max_download_queue_size : -1,
            max_seed_queue_size: s.max_seed_queue_size !== undefined ? s.max_seed_queue_size : -1
        };
        var sleepMins = Math.round((safe.sleep_duration || 900) / 60);
        var upgradeTagGroupDisplay = (safe.upgrade_selection_method || 'cutoff') === 'tags' ? 'flex' : 'none';
        var statefulBlockDisplay = safe.state_management_mode === 'disabled' ? 'none' : 'block';

        var exemptTagsHtml = (safe.exempt_tags || []).map(function(tag) {
            return '<span class="exempt-tag-chip" data-tag="' + escapeAttr(tag) + '" style="display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px; background: #dc2626; color: #fff; border-radius: 6px; font-size: 0.875rem;">' +
                '<span class="exempt-tag-remove" style="cursor: pointer;">×</span><span>' + escapeHtml(tag) + '</span></span>';
        }).join('');

        var infoStatusClass = safe.enabled ? 'mh-info-status-enabled' : 'mh-info-status-disabled';
        var infoStatusText = safe.enabled ? 'Enabled' : 'Disabled';
        var infoStatusIcon = safe.enabled ? '<i class="fas fa-check-circle" style="margin-right: 6px;"></i>' : '';

        var enableLabelIcon = safe.enabled
            ? '<span id="mh-editor-enabled-icon"><i class="fas fa-check-circle" style="color: #10b981; margin-right: 6px;"></i></span>'
            : '<span id="mh-editor-enabled-icon"><i class="fas fa-times-circle" style="color: #6b7280; margin-right: 6px;"></i></span>';

        return '<div class="editor-grid">' +
            '<div class="editor-section mh-information-section">' +
            '<div class="editor-section-header-inline">' +
            '<div class="editor-section-title"><div class="section-title-text"><span class="section-title-icon accent-connection"><i class="fas fa-info-circle"></i></span>INFORMATION</div></div>' +
            '<span class="mh-info-status-pill ' + infoStatusClass + '">' + infoStatusIcon + infoStatusText + '</span>' +
            '</div>' +
            '<div class="editor-field-group">' +
            '<div class="editor-setting-item"><label>' + enableLabelIcon + 'Enable Status</label>' +
            '<select id="mh-editor-enabled"><option value="true"' + (safe.enabled ? ' selected' : '') + '>Enabled</option><option value="false"' + (!safe.enabled ? ' selected' : '') + '>Disabled</option></select></div>' +
            '<p class="editor-help-text">Enable or disable this instance</p></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>Name</label>' +
            '<input type="text" id="mh-editor-name" value="' + escapeAttr(safe.name) + '" placeholder="e.g. Main" maxlength="64"></div>' +
            '<p class="editor-help-text">A friendly name to identify this instance</p></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>Instance Identifier</label>' +
            '<input type="text" id="mh-editor-instance-id" value="' + escapeAttr(safe.instance_id) + '" readonly disabled style="opacity: 0.8; cursor: not-allowed;"></div>' +
            '<p class="editor-help-text">Stable identifier for this instance (assigned automatically; cannot be changed)</p></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>Category Name</label>' +
            '<input type="text" id="mh-editor-category-name" value="' + escapeAttr('Movies-' + ((safe.name || '').trim() || 'Unnamed').replace(/ /g, '_')) + '" readonly disabled style="opacity: 0.8; cursor: not-allowed; background: rgba(148,163,184,0.1);"></div>' +
            '<p class="editor-help-text">For NZB Hunt this is automatic. SABNZBD and NZBGet require this exact category to be configured.</p></div>' +
            '</div>' +
            '<div class="editor-section">' +
            '<div class="editor-section-title"><div class="section-title-text"><span class="section-title-icon accent-search"><i class="fas fa-search"></i></span>SEARCH SETTINGS</div></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>Missing Search Count</label><input type="number" id="mh-editor-missing-count" value="' + safe.hunt_missing_movies + '"></div>' +
            '<p class="editor-help-text">Number of missing items to search for in each cycle</p></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>Upgrade Search Count</label><input type="number" id="mh-editor-upgrade-count" value="' + safe.hunt_upgrade_movies + '"></div>' +
            '<p class="editor-help-text">Number of items to upgrade in each cycle</p></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>Upgrade Selection Method</label>' +
            '<select id="mh-editor-upgrade-method"><option value="cutoff"' + (safe.upgrade_selection_method === 'cutoff' ? ' selected' : '') + '>Cutoff unmet</option><option value="tags"' + (safe.upgrade_selection_method === 'tags' ? ' selected' : '') + '>Tags</option></select></div>' +
            '<p class="editor-help-text"><strong>Cutoff unmet:</strong> Items below quality cutoff (default). Huntarr does not add any upgrade tag. <strong>Tags (Upgradinatorr):</strong> Huntarr finds items WITHOUT the tag below, runs upgrade searches, then ADDS that tag when done. <a href="https://trash-guides.info/" target="_blank" rel="noopener" style="color: #2ecc71; text-decoration: underline;">TrashGuides</a> | <a href="https://github.com/angrycuban13/Just-A-Bunch-Of-Starr-Scripts/blob/main/Upgradinatorr/README.md#requirements" target="_blank" rel="noopener" style="color: #e74c3c; text-decoration: underline;">Upgradinatorr</a></p></div>' +
            '<div class="editor-field-group editor-upgrade-tag-group" style="display:' + upgradeTagGroupDisplay + ';"><div class="editor-setting-item"><label>Upgrade Tag</label>' +
            '<input type="text" id="mh-editor-upgrade-tag" value="' + escapeAttr(safe.upgrade_tag) + '" placeholder="e.g. upgradinatorr"></div>' +
            '<p class="editor-help-text">Tag name. Huntarr finds movies that don’t have this tag, runs upgrade searches, then adds the tag when done (tracks what\'s been processed). <a href="https://trash-guides.info/" target="_blank" rel="noopener" style="color: #2ecc71; text-decoration: underline;">TrashGuides</a> | <a href="https://github.com/angrycuban13/Just-A-Bunch-Of-Starr-Scripts/blob/main/Upgradinatorr/README.md#requirements" target="_blank" rel="noopener" style="color: #e74c3c; text-decoration: underline;">Upgradinatorr</a></p></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>Release Date Delay (Days)</label><input type="number" id="mh-editor-release-date-delay" value="' + safe.release_date_delay_days + '"></div>' +
            '<p class="editor-help-text">Only search for items released at least this many days ago</p></div></div>' +

            '<div class="editor-section"><div class="editor-section-title"><div class="section-title-text"><span class="section-title-icon accent-stateful"><i class="fas fa-sync"></i></span>STATEFUL MANAGEMENT</div></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>State Management</label>' +
            '<select id="mh-editor-state-mode"><option value="custom"' + (safe.state_management_mode === 'custom' ? ' selected' : '') + '>Enabled</option><option value="disabled"' + (safe.state_management_mode === 'disabled' ? ' selected' : '') + '>Disabled</option></select></div>' +
            '<p class="editor-help-text">Track processed items to avoid redundant searches</p></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>Reset Interval (Hours)</label><input type="number" id="mh-editor-state-hours" value="' + safe.state_management_hours + '"></div>' +
            '<p class="editor-help-text">How long to wait before re-searching a previously processed item (default: 72 hours / 3 days)</p></div>' +
            '<div id="mh-editor-stateful-block" class="editor-field-group" style="display:' + statefulBlockDisplay + ';">' +
            '<button type="button" class="btn-card delete btn-reset-state" id="mh-editor-reset-state"><i class="fas fa-undo"></i> Reset Processed State Now</button>' +
            '<p class="editor-help-text" style="text-align: center; margin-top: -10px !important;">Clears the history of processed items for this instance</p>' +
            '<div id="mh-state-status-display" style="margin-top: 15px; padding: 12px; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 8px;">' +
            '<div style="display: flex; align-items: center; justify-content: center; gap: 8px; color: #10b981; font-weight: 500; margin-bottom: 4px;"><i class="fas fa-check-circle"></i><span>Active - Tracked Items: <span id="mh-tracked-items-count">Loading...</span></span></div>' +
            '<div style="text-align: center; color: #94a3b8; font-size: 0.9rem;">Next Reset: <span id="mh-next-reset-time">Loading...</span></div></div></div></div>' +

            '<div class="editor-section"><div class="editor-section-title"><div class="section-title-text"><span class="section-title-icon accent-additional"><i class="fas fa-sliders-h"></i></span>ADDITIONAL SETTINGS</div></div>' +
            '<div class="editor-field-group" style="margin-bottom: 12px;"><div style="padding: 10px 12px; background: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.5); border-radius: 6px; color: #fcd34d; font-size: 0.85rem; line-height: 1.4;"><i class="fas fa-exclamation-triangle" style="margin-right: 6px;"></i> Do not overwhelm your indexers. Contact them for advice!</div></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>Sleep Duration (Minutes)</label><input type="number" id="mh-editor-sleep-duration" value="' + sleepMins + '" min="' + _sleepMin + '" max="1440"></div>' +
            '<p class="editor-help-text">Time in minutes between processing cycles</p></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>API Cap - Hourly</label><input type="number" id="mh-editor-hourly-cap" value="' + safe.hourly_cap + '" min="1" max="400"></div>' +
            '<p class="editor-help-text">Maximum API requests per hour for this instance (10-20 recommended, max 400)</p></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item flex-row"><label>Monitored Only</label><label class="toggle-switch"><input type="checkbox" id="mh-editor-monitored-only"' + (safe.monitored_only ? ' checked' : '') + '><span class="toggle-slider"></span></label></div><p class="editor-help-text">Only search for monitored items</p></div></div>' +
            '<div class="editor-section"><div class="editor-section-title"><div class="section-title-text"><span class="section-title-icon accent-tags"><i class="fas fa-tags"></i></span>TAGS</div></div>' +
            '<div class="editor-field-group tag-sub-box"><div class="editor-setting-item flex-row"><label>Tag missing items</label><label class="toggle-switch"><input type="checkbox" id="mh-editor-tag-enable-missing"' + (safe.tag_enable_missing ? ' checked' : '') + '><span class="toggle-slider"></span></label></div>' +
            '<div class="editor-setting-item" style="margin-top: 6px;"><label>Missing Items Tag</label><input type="text" id="mh-editor-tag-missing" value="' + escapeAttr((safe.custom_tags && safe.custom_tags.missing) ? safe.custom_tags.missing : 'huntarr-missing') + '" placeholder="huntarr-missing" maxlength="25"></div>' +
            '<p class="editor-help-text">Tag added to movies when they\'re found by a missing search (max 25 characters)</p></div>' +
            '<div class="editor-field-group tag-sub-box mh-editor-upgrade-items-tag-section" style="display:' + (safe.upgrade_selection_method === 'tags' ? 'none' : 'block') + ';"><div class="editor-setting-item flex-row"><label>Tag upgrade items</label><label class="toggle-switch"><input type="checkbox" id="mh-editor-tag-enable-upgrade"' + (safe.tag_enable_upgrade ? ' checked' : '') + '><span class="toggle-slider"></span></label></div>' +
            '<div class="editor-setting-item" style="margin-top: 6px;"><label>Upgrade Items Tag</label><input type="text" id="mh-editor-tag-upgrade" value="' + escapeAttr((safe.custom_tags && safe.custom_tags.upgrade) ? safe.custom_tags.upgrade : 'huntarr-upgrade') + '" placeholder="huntarr-upgrade" maxlength="25"></div>' +
            '<p class="editor-help-text">Tag added to movies when they\'re upgraded in cutoff mode (max 25 characters). Not used when Upgrade Selection Method is Tags.</p></div>' +
            '<div class="editor-section" style="border: 1px solid rgba(231, 76, 60, 0.3); border-radius: 10px; padding: 14px; background: rgba(231, 76, 60, 0.06); margin-top: 16px;"><div class="editor-section-title"><div class="section-title-text"><span class="section-title-icon accent-exempt"><i class="fas fa-ban"></i></span>EXEMPT TAGS</div></div>' +
            '<p class="editor-help-text" style="margin-bottom: 12px;">Items with any of these tags are skipped for missing and upgrade searches. If the tag is removed in the app, Huntarr will process the item again. <a href="https://github.com/plexguide/Huntarr.io/issues/676" target="_blank" rel="noopener" style="color: #94a3b8;">#676</a></p>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>Add exempt tag</label><div style="display: flex; gap: 8px; align-items: center;"><input type="text" id="mh-editor-exempt-tag-input" placeholder="Type a tag to exempt..." style="flex: 1;" maxlength="50"><button type="button" class="btn-card" id="mh-editor-exempt-tag-add" style="padding: 8px 14px; white-space: nowrap;">Add</button></div></div>' +
            '<p class="editor-help-text" style="color: #94a3b8; font-size: 0.85rem;">Tag &quot;upgradinatorr&quot; cannot be added.</p>' +
            '<div id="mh-editor-exempt-tags-list" style="display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; min-height: 24px;">' + exemptTagsHtml + '</div></div></div></div>' +
            '<div class="editor-section"><div class="editor-section-title"><div class="section-title-text"><span class="section-title-icon accent-advanced"><i class="fas fa-code"></i></span>ADVANCED SETTINGS</div></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>API Timeout (seconds)</label><input type="number" id="mh-editor-api-timeout" value="' + safe.api_timeout + '" min="30" max="600"></div>' +
            '<p class="editor-help-text">Timeout for API requests (default: 120 seconds)</p></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>Command Wait Delay (seconds)</label><input type="number" id="mh-editor-cmd-wait-delay" value="' + safe.command_wait_delay + '" min="1" max="10"></div>' +
            '<p class="editor-help-text">Delay between command status checks (default: 1 second)</p></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>Command Wait Attempts</label><input type="number" id="mh-editor-cmd-wait-attempts" value="' + safe.command_wait_attempts + '" min="0" max="1800"></div>' +
            '<p class="editor-help-text">Maximum attempts to wait for command completion (default: 600)</p></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>Max Download Queue Size</label><input type="number" id="mh-editor-max-queue-size" value="' + safe.max_download_queue_size + '" min="-1" max="1000"></div><p class="editor-help-text">Skip processing if queue size meets or exceeds this value (-1 = disabled)</p></div>' +
            '</div>' +

            /* ── Debug Manager ────────────────────────────────── */
            '<div class="editor-section mh-debug-manager-section" style="border: 2px solid rgba(239, 68, 68, 0.4); background: rgba(239, 68, 68, 0.06);">' +
            '<div class="editor-section-title"><div class="section-title-text"><span class="section-title-icon accent-exempt"><i class="fas fa-bug"></i></span>DEBUG MANAGER</div></div>' +
            '<p class="editor-help-text" style="margin-bottom: 16px; line-height: 1.5;">Dangerous operations for troubleshooting. These actions are <strong style="color: #f87171;">irreversible</strong>.</p>' +

            '<div class="editor-field-group" style="border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 8px; padding: 16px; background: rgba(239, 68, 68, 0.04);">' +
            '<div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;">' +
            '<div style="flex: 1; min-width: 200px;">' +
            '<strong style="color: #f1f5f9; font-size: 0.95rem;">Reset Movie Collection</strong>' +
            '<p class="editor-help-text" style="margin-top: 4px;">Permanently deletes <strong>all</strong> movies from this instance\'s Movie Collection. Requested movies, status history, and collection data will be wiped. This cannot be undone.</p>' +
            '</div>' +
            '<button type="button" class="btn-card delete" id="mh-editor-reset-collection" style="white-space: nowrap; background: #dc2626; color: white; border: 1px solid #dc2626; padding: 10px 20px; border-radius: 8px; font-weight: 600; cursor: pointer;"><i class="fas fa-trash-alt" style="margin-right: 6px;"></i>Reset Library</button>' +
            '</div></div>' +

            '</div>' +

            /* ── Reset Collection Confirmation Modal (hidden) ── */
            '<div id="mh-reset-collection-modal" style="display:none; position:fixed; inset:0; z-index:100000; align-items:center; justify-content:center;">' +
            '<div id="mh-reset-collection-backdrop" style="position:absolute; inset:0; background:rgba(0,0,0,0.6); backdrop-filter:blur(4px);"></div>' +
            '<div style="position:relative; background:#1e293b; border:1px solid rgba(239,68,68,0.4); border-radius:14px; padding:28px 32px; max-width:460px; width:90%; box-shadow:0 20px 60px rgba(0,0,0,0.5);">' +
            '<h3 style="margin:0 0 8px; color:#f87171; font-size:1.15rem;"><i class="fas fa-exclamation-triangle" style="margin-right:8px;"></i>Confirm Library Reset</h3>' +
            '<p style="color:#94a3b8; font-size:0.9rem; line-height:1.5; margin:0 0 18px;">This will permanently delete <strong style="color:#f1f5f9;">all movies</strong> in the Movie Collection for this instance. To confirm, type the instance name below:</p>' +
            '<p style="color:#f1f5f9; font-size:0.95rem; margin:0 0 10px; text-align:center;"><strong id="mh-reset-modal-instance-name">' + escapeHtml(safe.name) + '</strong></p>' +
            '<input type="text" id="mh-reset-collection-input" placeholder="Type instance name to confirm..." style="width:100%; padding:12px; border-radius:8px; border:1px solid rgba(239,68,68,0.3); background:rgba(15,23,42,0.8); color:white; margin-bottom:16px; box-sizing:border-box;" autocomplete="off">' +
            '<div id="mh-reset-collection-error" style="display:none; color:#f87171; font-size:0.85rem; margin-bottom:12px; text-align:center;"></div>' +
            '<div style="display:flex; gap:10px; justify-content:flex-end;">' +
            '<button type="button" id="mh-reset-collection-cancel" style="padding:10px 20px; border-radius:8px; border:1px solid rgba(148,163,184,0.3); background:rgba(148,163,184,0.1); color:#94a3b8; cursor:pointer; font-weight:500;">Cancel</button>' +
            '<button type="button" id="mh-reset-collection-confirm" style="padding:10px 20px; border-radius:8px; border:1px solid #dc2626; background:#dc2626; color:white; cursor:pointer; font-weight:600; opacity:0.5;" disabled><i class="fas fa-trash-alt" style="margin-right:6px;"></i>Delete All</button>' +
            '</div></div></div>' +

            '</div>';
    }

    function collectFormData() {
        var get = function(id) { var el = document.getElementById(id); return el ? el.value : null; };
        var getNum = function(id, def) { var v = get(id); if (v === null || v === '') return def; var n = parseInt(v, 10); return isNaN(n) ? def : n; };
        var getCheck = function(id) { var el = document.getElementById(id); return el ? !!el.checked : false; };
        var tags = [];
        var list = document.getElementById('mh-editor-exempt-tags-list');
        if (list) {
            list.querySelectorAll('.exempt-tag-chip').forEach(function(chip) {
                var t = chip.getAttribute('data-tag');
                if (t) tags.push(t);
            });
        }
        var tagMissing = (get('mh-editor-tag-missing') || '').trim() || 'huntarr-missing';
        var tagUpgrade = (get('mh-editor-tag-upgrade') || '').trim() || 'huntarr-upgrade';
        var enabledVal = get('mh-editor-enabled');
        var enabled = enabledVal === 'true' || enabledVal === true;
        var nameVal = (get('mh-editor-name') || '').trim() || 'Unnamed';
        return {
            enabled: enabled,
            name: nameVal,
            hunt_missing_movies: getNum('mh-editor-missing-count', 1),
            hunt_upgrade_movies: getNum('mh-editor-upgrade-count', 0),
            upgrade_selection_method: (get('mh-editor-upgrade-method') || 'cutoff').toLowerCase(),
            upgrade_tag: (get('mh-editor-upgrade-tag') || '').trim(),
            release_date_delay_days: getNum('mh-editor-release-date-delay', 0),
            state_management_mode: get('mh-editor-state-mode') || 'custom',
            state_management_hours: getNum('mh-editor-state-hours', 72),
            sleep_duration: getNum('mh-editor-sleep-duration', 15) * 60,
            hourly_cap: getNum('mh-editor-hourly-cap', 20),
            exempt_tags: tags,
            monitored_only: getCheck('mh-editor-monitored-only'),
            tag_processed_items: true,
            tag_enable_missing: getCheck('mh-editor-tag-enable-missing'),
            tag_enable_upgrade: getCheck('mh-editor-tag-enable-upgrade'),
            custom_tags: { missing: tagMissing, upgrade: tagUpgrade },
            api_timeout: getNum('mh-editor-api-timeout', 120),
            command_wait_delay: getNum('mh-editor-cmd-wait-delay', 1),
            command_wait_attempts: getNum('mh-editor-cmd-wait-attempts', 600),
            max_download_queue_size: getNum('mh-editor-max-queue-size', -1),
            max_seed_queue_size: -1,
            seed_check_torrent_client: null
        };
    }

    function setupExemptTagsListeners(container) {
        if (!container) return;
        var addBtn = container.querySelector('#mh-editor-exempt-tag-add');
        var input = container.querySelector('#mh-editor-exempt-tag-input');
        var list = container.querySelector('#mh-editor-exempt-tags-list');
        if (!addBtn || !input || !list) return;
        function addTag() {
            var tag = (input.value || '').trim();
            if (!tag || tag.toLowerCase() === 'upgradinatorr') return;
            var existing = list.querySelectorAll('.exempt-tag-chip');
            for (var i = 0; i < existing.length; i++) {
                if ((existing[i].getAttribute('data-tag') || '') === tag) return;
            }
            var chip = document.createElement('span');
            chip.className = 'exempt-tag-chip';
            chip.setAttribute('data-tag', tag);
            chip.style.cssText = 'display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px; background: #dc2626; color: #fff; border-radius: 6px; font-size: 0.875rem;';
            chip.innerHTML = '<span class="exempt-tag-remove" style="cursor: pointer;">×</span><span>' + escapeHtml(tag) + '</span>';
            list.appendChild(chip);
            input.value = '';
            _editorDirty = true;
            var saveBtn = document.getElementById('media-hunt-instance-editor-save');
            if (saveBtn) { saveBtn.disabled = false; saveBtn.classList.add('enabled'); }
        }
        addBtn.addEventListener('click', addTag);
        input.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); addTag(); } });
        list.addEventListener('click', function(e) {
            var remove = e.target.classList.contains('exempt-tag-remove') ? e.target : e.target.closest('.exempt-tag-remove');
            if (remove) {
                var chip = remove.closest('.exempt-tag-chip');
                if (chip) chip.remove();
                _editorDirty = true;
                var saveBtn = document.getElementById('media-hunt-instance-editor-save');
                if (saveBtn) { saveBtn.disabled = false; saveBtn.classList.add('enabled'); }
            }
        });
    }

    function setupChangeDetection(container) {
        var saveBtn = document.getElementById('media-hunt-instance-editor-save');
        if (!container || !saveBtn) return;
        saveBtn.disabled = true;
        saveBtn.classList.remove('enabled');
        function markDirty() {
            _editorDirty = true;
            saveBtn.disabled = false;
            saveBtn.classList.add('enabled');
        }
        container.addEventListener('input', markDirty);
        container.addEventListener('change', markDirty);
        var stateMode = document.getElementById('mh-editor-state-mode');
        var upgradeMethod = document.getElementById('mh-editor-upgrade-method');
        if (stateMode) stateMode.addEventListener('change', function() {
            var block = document.getElementById('mh-editor-stateful-block');
            if (block) block.style.display = stateMode.value === 'disabled' ? 'none' : 'block';
        });
        if (upgradeMethod) upgradeMethod.addEventListener('change', function() {
            var group = container.querySelector('.editor-upgrade-tag-group');
            if (group) group.style.display = upgradeMethod.value === 'tags' ? 'flex' : 'none';
            var upgradeItemsSection = container.querySelector('.mh-editor-upgrade-items-tag-section');
            if (upgradeItemsSection) upgradeItemsSection.style.display = upgradeMethod.value === 'tags' ? 'none' : 'block';
        });
        var nameInput = document.getElementById('mh-editor-name');
        var categoryNameEl = document.getElementById('mh-editor-category-name');
        if (nameInput && categoryNameEl) {
            function updateMhCategoryName() {
                var n = ((nameInput.value || '').trim() || 'Unnamed').replace(/ /g, '_');
                categoryNameEl.value = 'Movies-' + n;
            }
            nameInput.addEventListener('input', updateMhCategoryName);
            nameInput.addEventListener('change', updateMhCategoryName);
        }
        var enabledSelect = document.getElementById('mh-editor-enabled');
        var statusPill = container ? container.querySelector('.mh-info-status-pill') : null;
        var enabledIconEl = document.getElementById('mh-editor-enabled-icon');
        if (enabledSelect && statusPill) {
            enabledSelect.addEventListener('change', function() {
                var on = enabledSelect.value === 'true';
                statusPill.className = 'mh-info-status-pill ' + (on ? 'mh-info-status-enabled' : 'mh-info-status-disabled');
                statusPill.innerHTML = on ? '<i class="fas fa-check-circle" style="margin-right: 6px;"></i>Enabled' : 'Disabled';
                if (enabledIconEl) {
                    enabledIconEl.innerHTML = on ? '<i class="fas fa-check-circle" style="color: #10b981; margin-right: 6px;"></i>' : '<i class="fas fa-times-circle" style="color: #6b7280; margin-right: 6px;"></i>';
                }
            });
        }
    }

    function loadMovieHuntStateStatus(instanceName) {
        var countEl = document.getElementById('mh-tracked-items-count');
        var nextEl = document.getElementById('mh-next-reset-time');
        if (!countEl || !nextEl || !instanceName) return;
        var url = api('./api/stateful/summary?app_type=movie_hunt&instance_name=' + encodeURIComponent(instanceName));
        fetch(url, { cache: 'no-store' })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                countEl.textContent = (data && data.processed_count !== undefined) ? data.processed_count : 0;
                nextEl.textContent = (data && data.next_reset_time) ? data.next_reset_time : 'N/A';
            })
            .catch(function() {
                countEl.textContent = '0';
                nextEl.textContent = 'N/A';
            });
    }

    var addInstanceCardHtml = function(appType, iconClass, label) {
        return '<div class="add-instance-card" data-app-type="' + appType + '"><div class="add-icon"><i class="fas fa-plus-circle"></i></div><div class="add-text">' + (label || 'Add Instance') + '</div></div>';
    };

    window.MovieHuntInstanceEditor = {
        loadInstanceList: function() {
            var grid = document.getElementById('movie-hunt-settings-instances-grid');
            if (!grid) return;
            grid.innerHTML = '<div style="color: #94a3b8;">Loading...</div>';
            fetch(api('./api/movie-hunt/instances'), { cache: 'no-store' })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    var list = data.instances || [];
                    var currentId = (data.current_instance_id != null) ? parseInt(data.current_instance_id, 10) : (list[0] ? list[0].id : null);
                    grid.innerHTML = '';
                    list.forEach(function(inst) {
                        var enabled = inst.enabled !== false;
                        var statusClass = enabled ? 'status-connected' : 'status-disabled';
                        var statusIcon = enabled ? 'fa-check-circle' : 'fa-minus-circle';
                        var isDefault = currentId != null && inst.id === currentId;
                        var defaultBtn = isDefault ? '' : '<button type="button" class="btn-card set-default" data-id="' + escapeAttr(String(inst.id)) + '"><i class="fas fa-star"></i> Default</button>';
                        var deleteBtn = list.length > 1 ? '<button type="button" class="btn-card delete" data-id="' + escapeAttr(String(inst.id)) + '" data-name="' + escapeAttr(inst.name || '') + '"><i class="fas fa-trash"></i> Delete</button>' : '';
                        var card = document.createElement('div');
                        card.className = 'instance-card' + (isDefault ? ' default-instance' : '');
                        card.innerHTML =
                            '<div class="instance-card-header">' +
                            '<span class="instance-name"><i class="fas fa-film" style="margin-right: 8px;"></i>' + escapeHtml(inst.name || 'Instance ' + inst.id) + (isDefault ? ' <span class="default-badge">Default</span>' : '') + '</span>' +
                            '<div class="instance-status-icon ' + statusClass + '" title="' + (enabled ? 'Enabled' : 'Disabled') + '"><i class="fas ' + statusIcon + '"></i></div>' +
                            '</div>' +
                            '<div class="instance-card-body"><div class="instance-detail"><i class="fas fa-hashtag"></i><span>ID ' + escapeHtml(inst.id) + '</span></div></div>' +
                            '<div class="instance-card-footer"><button type="button" class="btn-card edit" data-id="' + escapeAttr(String(inst.id)) + '" data-name="' + escapeAttr(inst.name || '') + '"><i class="fas fa-edit"></i> Edit</button>' + defaultBtn + deleteBtn + '</div>';
                        grid.appendChild(card);
                    });
                    var addCard = document.createElement('div');
                    addCard.innerHTML = addInstanceCardHtml('media-hunt-instance-movie', 'fa-film', 'Add Movie Instance');
                    grid.appendChild(addCard.firstElementChild);
                    grid.querySelectorAll('.btn-card.edit').forEach(function(btn) {
                        btn.addEventListener('click', function(e) {
                            e.stopPropagation();
                            window.MovieHuntInstanceEditor.openEditor(
                                btn.getAttribute('data-id'),
                                btn.getAttribute('data-name') || ('Instance ' + btn.getAttribute('data-id'))
                            );
                        });
                    });
                    grid.querySelectorAll('.btn-card.set-default').forEach(function(btn) {
                        btn.addEventListener('click', function(e) {
                            e.stopPropagation();
                            window.MovieHuntInstanceEditor.setDefault(btn.getAttribute('data-id'));
                        });
                    });
                    grid.querySelectorAll('.btn-card.delete').forEach(function(btn) {
                        btn.addEventListener('click', function(e) {
                            e.stopPropagation();
                            var name = btn.getAttribute('data-name') || ('Instance ' + btn.getAttribute('data-id'));
                            var doDelete = function() { window.MovieHuntInstanceEditor.deleteInstance(btn.getAttribute('data-id')); };
                            if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
                                window.HuntarrConfirm.show({ title: 'Delete Instance', message: 'Delete Movie Hunt instance "' + (name || '') + '"? All settings and collection data for this instance will be permanently removed.', confirmLabel: 'Delete', onConfirm: doDelete });
                            } else if (confirm('Delete "' + name + '"? This cannot be undone.')) { doDelete(); }
                        });
                    });
                })
                .catch(function() {
                    grid.innerHTML = '<div style="color: #f87171;">Failed to load instances.</div>';
                });
        },

        setDefault: function(instanceId) {
            if (!instanceId) return;
            var self = this;
            fetch(api('./api/movie-hunt/instances/current'), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ instance_id: parseInt(instanceId, 10) })
            })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.success) {
                        if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Default instance updated', 'success');
                        self.loadInstanceList();
                    } else if (data.error && window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification(data.error, 'error');
                    }
                })
                .catch(function() {
                    if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Failed to set default instance', 'error');
                });
        },

        deleteInstance: function(instanceId) {
            if (!instanceId) return;
            var self = this;
            fetch(api('./api/movie-hunt/instances/' + instanceId), { method: 'DELETE' })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.success) {
                        if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Instance deleted', 'success');
                        self.loadInstanceList();
                    } else if (data.error && window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification(data.error || 'Failed to delete', 'error');
                    }
                })
                .catch(function() {
                    if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Failed to delete instance', 'error');
                });
        },

        openEditor: function(instanceId, instanceName) {
            _currentInstanceId = instanceId;
            _currentInstanceName = instanceName || ('Instance ' + instanceId);
            _editorDirty = false;
            var self = this;
            fetch(api('./api/movie-hunt/instances/' + instanceId + '/settings'), { cache: 'no-store' })
                .then(function(r) {
                    return r.json().then(function(data) { return { ok: r.ok, data: data }; });
                })
                .then(function(result) {
                    if (!result.ok || result.data.error) {
                        var msg = (result.data && result.data.error) ? result.data.error : 'Failed to load settings';
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification(msg, 'error');
                        }
                        return;
                    }
                    var settings = result.data;
                    var contentEl = document.getElementById('media-hunt-instance-editor-content');
                    if (contentEl) {
                        contentEl.innerHTML = buildEditorHtml(settings);
                        setupExemptTagsListeners(contentEl);
                        setupChangeDetection(contentEl);
                        loadMovieHuntStateStatus(_currentInstanceName);
                    }
                    // Update breadcrumb
                    var breadcrumbName = document.getElementById('media-hunt-instance-editor-instance-name');
                    if (breadcrumbName && _currentInstanceName) breadcrumbName.textContent = _currentInstanceName;
                    var appNameEl = document.getElementById('media-hunt-instance-editor-app-name');
                    if (appNameEl) appNameEl.textContent = 'Movie Hunt';
                    var appIcon = document.getElementById('media-hunt-instance-editor-app-icon');
                    if (appIcon) appIcon.className = 'fas fa-film';
                    var backBtn = document.getElementById('media-hunt-instance-editor-back');
                    var saveBtn = document.getElementById('media-hunt-instance-editor-save');
                    if (backBtn) backBtn.onclick = function() {
                        if (!_editorDirty) {
                            window.huntarrUI.switchSection('media-hunt-instances');
                            return;
                        }
                        if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
                            window.HuntarrConfirm.show({
                                title: 'Unsaved Changes',
                                message: 'You have unsaved changes that will be lost if you leave.',
                                confirmLabel: 'Go Back',
                                cancelLabel: 'Leave',
                                onConfirm: function() {
                                    // Stay on the editor — modal just closes, user can save manually
                                },
                                onCancel: function() { window.huntarrUI.switchSection('media-hunt-instances'); }
                            });
                        } else {
                            if (confirm('You have unsaved changes that will be lost. Leave anyway?')) {
                                window.huntarrUI.switchSection('media-hunt-instances');
                            }
                        }
                    };
                    if (saveBtn) saveBtn.onclick = function() { self.saveEditor(); };
                    var resetBtn = document.getElementById('mh-editor-reset-state');
                    if (resetBtn) resetBtn.onclick = function() { self.resetState(instanceId); };

                    // Debug Manager: Reset Media Collection
                    self.setupResetCollectionModal(instanceId, _currentInstanceName);

                    if (window.huntarrUI && window.huntarrUI.switchSection) {
                        window.huntarrUI.switchSection('movie-hunt-instance-editor');
                    }
                })
                .catch(function(err) {
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification('Failed to load settings: ' + (err.message || 'Request failed'), 'error');
                    }
                });
        },

        saveEditor: function() {
            if (!_currentInstanceId) return;
            var payload = collectFormData();
            var saveBtn = document.getElementById('media-hunt-instance-editor-save');
            if (saveBtn) { saveBtn.disabled = true; saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...'; }
            var self = this;
            fetch(api('./api/movie-hunt/instances/' + _currentInstanceId + '/settings'), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.error) {
                        if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification(data.error, 'error');
                        if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = '<i class="fas fa-save"></i> Save'; saveBtn.classList.add('enabled'); }
                        return;
                    }
                    _editorDirty = false;
                    if (saveBtn) {
                        saveBtn.innerHTML = '<i class="fas fa-check"></i> Saved!';
                        saveBtn.classList.remove('enabled');
                        setTimeout(function() {
                            saveBtn.innerHTML = '<i class="fas fa-save"></i> Save';
                            saveBtn.disabled = true;
                        }, 2000);
                    }
                })
                .catch(function() {
                    if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Failed to save settings', 'error');
                    if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = '<i class="fas fa-save"></i> Save'; saveBtn.classList.add('enabled'); }
                });
        },

        resetState: function(instanceId) {
            if (!instanceId) return;
            function doReset() {
                fetch(api('./api/movie-hunt/instances/' + instanceId + '/reset-state'), { method: 'POST' })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.error && window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification(data.error, 'error');
                    } else if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification('State reset.', 'success');
                    }
                })
                .catch(function() {
                    if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Reset request failed', 'error');
                });
            }
            if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
                window.HuntarrConfirm.show({
                    title: 'Reset State',
                    message: 'Reset processed state for this instance? This clears the history of processed items.',
                    confirmLabel: 'Reset',
                    onConfirm: doReset
                });
            } else {
                if (!confirm('Reset processed state for this instance? This clears the history of processed items.')) return;
                doReset();
            }
        },

        setupResetCollectionModal: function(instanceId, instanceName) {
            var resetBtn = document.getElementById('mh-editor-reset-collection');
            var modal = document.getElementById('mh-reset-collection-modal');
            var backdrop = document.getElementById('mh-reset-collection-backdrop');
            var input = document.getElementById('mh-reset-collection-input');
            var confirmBtn = document.getElementById('mh-reset-collection-confirm');
            var cancelBtn = document.getElementById('mh-reset-collection-cancel');
            var errorEl = document.getElementById('mh-reset-collection-error');
            if (!resetBtn || !modal) return;

            var expectedName = (instanceName || '').trim();
            var self = this;

            function openModal() {
                if (input) { input.value = ''; }
                if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.style.opacity = '0.5'; }
                if (errorEl) { errorEl.style.display = 'none'; errorEl.textContent = ''; }
                modal.style.display = 'flex';
            }

            function closeModal() {
                modal.style.display = 'none';
                if (input) input.value = '';
            }

            resetBtn.onclick = openModal;
            if (cancelBtn) cancelBtn.onclick = closeModal;
            if (backdrop) backdrop.onclick = closeModal;

            // Enable/disable confirm button based on input match
            if (input && confirmBtn) {
                input.addEventListener('input', function() {
                    var val = (input.value || '').trim();
                    var match = val === expectedName;
                    confirmBtn.disabled = !match;
                    confirmBtn.style.opacity = match ? '1' : '0.5';
                    if (errorEl) { errorEl.style.display = 'none'; }
                });
                input.addEventListener('keydown', function(e) {
                    if (e.key === 'Enter' && !confirmBtn.disabled) {
                        confirmBtn.click();
                    }
                });
            }

            if (confirmBtn) {
                confirmBtn.onclick = function() {
                    var val = (input ? input.value : '').trim();
                    if (val !== expectedName) {
                        if (errorEl) {
                            errorEl.textContent = 'Instance name does not match. Please try again.';
                            errorEl.style.display = 'block';
                        }
                        return;
                    }
                    confirmBtn.disabled = true;
                    confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin" style="margin-right:6px;"></i>Deleting...';
                    self.resetCollection(instanceId, function(success) {
                        if (success) {
                            closeModal();
                        } else {
                            confirmBtn.disabled = false;
                            confirmBtn.innerHTML = '<i class="fas fa-trash-alt" style="margin-right:6px;"></i>Delete All';
                        }
                    });
                };
            }
        },

        resetCollection: function(instanceId, callback) {
            fetch(api('./api/movie-hunt/instances/' + instanceId + '/reset-collection'), {
                method: 'DELETE'
            })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.success) {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification(data.message || 'Media collection has been reset.', 'success');
                        } else { alert(data.message || 'Media collection has been reset.'); }
                        if (callback) callback(true);
                    } else {
                        var msg = data.message || data.error || 'Failed to reset collection.';
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification(msg, 'error');
                        } else { alert(msg); }
                        if (callback) callback(false);
                    }
                })
                .catch(function(err) {
                    var msg = (err && err.message) ? err.message : 'Request failed.';
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification(msg, 'error');
                    } else { alert(msg); }
                    if (callback) callback(false);
                });
        }
    };
})();

/**
 * Media Hunt Instance Editor – Part 2: TVHuntInstanceEditor (TV mode).
 * Uses same media-hunt-instance-editor-* container IDs.
 */
(function() {
    'use strict';

    var baseUrl = (typeof window !== 'undefined' && window.HUNTARR_BASE_URL) ? window.HUNTARR_BASE_URL.replace(/\/$/, '') : '';
    function api(path) { return (baseUrl || '') + (path.indexOf('./') === 0 ? path : './' + path); }
    function escapeHtml(s) { return s == null ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    function escapeAttr(s) { return s == null ? '' : String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

    var _currentInstanceId = null;
    var _currentInstanceName = null;
    var _editorDirty = false;
    var _sleepMin = 10;

    function buildEditorHtml(s) {
        if (!s || typeof s !== 'object' || s.error) s = {};
        var enabled = s.enabled !== false;
        var instanceIdStr = s.instance_id != null ? String(s.instance_id) : (_currentInstanceId != null ? String(_currentInstanceId) : '');
        var instanceName = s.name != null ? String(s.name).trim() : (_currentInstanceName ? _currentInstanceName : '');
        var safe = {
            enabled: enabled,
            name: instanceName,
            instance_id: instanceIdStr,
            hunt_missing_episodes: s.hunt_missing_episodes !== undefined ? s.hunt_missing_episodes : 1,
            hunt_upgrade_episodes: s.hunt_upgrade_episodes !== undefined ? s.hunt_upgrade_episodes : 0,
            hunt_missing_mode: s.hunt_missing_mode || 'seasons_packs',
            upgrade_mode: s.upgrade_mode || 'seasons_packs',
            upgrade_selection_method: (s.upgrade_selection_method || 'cutoff').toLowerCase(),
            upgrade_tag: (s.upgrade_tag || '').trim() || 'upgradinatorr',
            skip_future_episodes: s.skip_future_episodes !== false,
            state_management_mode: s.state_management_mode || 'custom',
            state_management_hours: s.state_management_hours !== undefined ? s.state_management_hours : 72,
            sleep_duration: s.sleep_duration !== undefined ? s.sleep_duration : 900,
            hourly_cap: s.hourly_cap !== undefined ? s.hourly_cap : 20,
            monitored_only: s.monitored_only !== false,
            exempt_tags: Array.isArray(s.exempt_tags) ? s.exempt_tags : [],
            api_timeout: s.api_timeout !== undefined ? s.api_timeout : 120,
            max_download_queue_size: s.max_download_queue_size !== undefined ? s.max_download_queue_size : -1,
        };
        var sleepMins = Math.round((safe.sleep_duration || 900) / 60);
        var upgradeTagDisplay = (safe.upgrade_selection_method || 'cutoff') === 'tags' ? 'flex' : 'none';
        var statefulBlockDisplay = safe.state_management_mode === 'disabled' ? 'none' : 'block';
        var infoStatusClass = safe.enabled ? 'th-info-status-enabled' : 'th-info-status-disabled';
        var infoStatusText = safe.enabled ? 'Enabled' : 'Disabled';

        var exemptTagsHtml = (safe.exempt_tags || []).map(function(tag) {
            return '<span class="exempt-tag-chip" data-tag="' + escapeAttr(tag) + '" style="display:inline-flex;align-items:center;gap:6px;padding:4px 8px;background:#dc2626;color:#fff;border-radius:6px;font-size:0.875rem;">' +
                '<span class="exempt-tag-remove" style="cursor:pointer;">&times;</span><span>' + escapeHtml(tag) + '</span></span>';
        }).join('');

        return '<div class="editor-grid">' +
            // INFORMATION
            '<div class="editor-section">' +
            '<div class="editor-section-header-inline"><div class="editor-section-title"><div class="section-title-text"><span class="section-title-icon accent-connection"><i class="fas fa-info-circle"></i></span>INFORMATION</div></div>' +
            '<span class="th-info-status-pill ' + infoStatusClass + '">' + (safe.enabled ? '<i class="fas fa-check-circle" style="margin-right:6px;"></i>' : '') + infoStatusText + '</span></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>Enable Status</label><select id="th-editor-enabled"><option value="true"' + (safe.enabled ? ' selected' : '') + '>Enabled</option><option value="false"' + (!safe.enabled ? ' selected' : '') + '>Disabled</option></select></div><p class="editor-help-text">Enable or disable this instance</p></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>Name</label><input type="text" id="th-editor-name" value="' + escapeAttr(safe.name) + '" placeholder="e.g. Main TV" maxlength="64"></div><p class="editor-help-text">A friendly name to identify this instance</p></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>Instance ID</label><input type="text" id="th-editor-instance-id" value="' + escapeAttr(safe.instance_id) + '" readonly disabled style="opacity:0.8;cursor:not-allowed;"></div><p class="editor-help-text">Stable identifier (auto-assigned, cannot change)</p></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>Category Name</label><input type="text" id="th-editor-category-name" value="' + escapeAttr('TV-' + ((safe.name || '').trim() || 'Unnamed').replace(/ /g, '_')) + '" readonly disabled style="opacity:0.8;cursor:not-allowed;background:rgba(148,163,184,0.1);"></div><p class="editor-help-text">For NZB Hunt this is automatic. SABNZBD and NZBGet require this exact category to be configured.</p></div>' +
            '</div>' +
            // SEARCH SETTINGS
            '<div class="editor-section"><div class="editor-section-title"><div class="section-title-text"><span class="section-title-icon accent-search"><i class="fas fa-search"></i></span>SEARCH SETTINGS</div></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>Missing Episode Search Count</label><input type="number" id="th-editor-missing-count" value="' + safe.hunt_missing_episodes + '"></div><p class="editor-help-text">Number of missing episodes to search per cycle</p></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>Missing Search Mode</label><select id="th-editor-missing-mode"><option value="seasons_packs"' + (safe.hunt_missing_mode === 'seasons_packs' ? ' selected' : '') + '>Season Packs</option><option value="episodes"' + (safe.hunt_missing_mode === 'episodes' ? ' selected' : '') + '>Individual Episodes</option></select></div><p class="editor-help-text">Season packs search for full seasons; episodes search individually</p></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>Upgrade Episode Search Count</label><input type="number" id="th-editor-upgrade-count" value="' + safe.hunt_upgrade_episodes + '"></div><p class="editor-help-text">Number of episodes to upgrade per cycle</p></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>Upgrade Selection Method</label><select id="th-editor-upgrade-method"><option value="cutoff"' + (safe.upgrade_selection_method === 'cutoff' ? ' selected' : '') + '>Cutoff unmet</option><option value="tags"' + (safe.upgrade_selection_method === 'tags' ? ' selected' : '') + '>Tags</option></select></div><p class="editor-help-text">Cutoff unmet: items below quality cutoff. Tags (Upgradinatorr): finds items without the tag, runs upgrades, adds tag.</p></div>' +
            '<div class="editor-field-group editor-upgrade-tag-group" style="display:' + upgradeTagDisplay + ';"><div class="editor-setting-item"><label>Upgrade Tag</label><input type="text" id="th-editor-upgrade-tag" value="' + escapeAttr(safe.upgrade_tag) + '" placeholder="e.g. upgradinatorr"></div><p class="editor-help-text">Tag name for upgrade tracking</p></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item flex-row"><label>Skip Future Episodes</label><label class="toggle-switch"><input type="checkbox" id="th-editor-skip-future"' + (safe.skip_future_episodes ? ' checked' : '') + '><span class="toggle-slider"></span></label></div><p class="editor-help-text">Skip episodes with air dates in the future</p></div>' +
            '</div>' +
            // STATEFUL MANAGEMENT
            '<div class="editor-section"><div class="editor-section-title"><div class="section-title-text"><span class="section-title-icon accent-stateful"><i class="fas fa-sync"></i></span>STATEFUL MANAGEMENT</div></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>State Management</label><select id="th-editor-state-mode"><option value="custom"' + (safe.state_management_mode === 'custom' ? ' selected' : '') + '>Enabled</option><option value="disabled"' + (safe.state_management_mode === 'disabled' ? ' selected' : '') + '>Disabled</option></select></div><p class="editor-help-text">Track processed items to avoid redundant searches</p></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>Reset Interval (Hours)</label><input type="number" id="th-editor-state-hours" value="' + safe.state_management_hours + '"></div><p class="editor-help-text">How long before re-searching a processed item (default: 72 hours)</p></div>' +
            '<div id="th-editor-stateful-block" class="editor-field-group" style="display:' + statefulBlockDisplay + ';">' +
            '<button type="button" class="btn-card delete btn-reset-state" id="th-editor-reset-state"><i class="fas fa-undo"></i> Reset Processed State Now</button>' +
            '<p class="editor-help-text" style="text-align:center;margin-top:-10px !important;">Clears processed items history for this instance</p></div></div>' +
            // ADDITIONAL SETTINGS
            '<div class="editor-section"><div class="editor-section-title"><div class="section-title-text"><span class="section-title-icon accent-additional"><i class="fas fa-sliders-h"></i></span>ADDITIONAL SETTINGS</div></div>' +
            '<div class="editor-field-group" style="margin-bottom:12px;"><div style="padding:10px 12px;background:rgba(245,158,11,0.15);border:1px solid rgba(245,158,11,0.5);border-radius:6px;color:#fcd34d;font-size:0.85rem;"><i class="fas fa-exclamation-triangle" style="margin-right:6px;"></i> Do not overwhelm your indexers. Contact them for advice!</div></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>Sleep Duration (Minutes)</label><input type="number" id="th-editor-sleep-duration" value="' + sleepMins + '" min="' + _sleepMin + '" max="1440"></div><p class="editor-help-text">Time between processing cycles</p></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>API Cap - Hourly</label><input type="number" id="th-editor-hourly-cap" value="' + safe.hourly_cap + '" min="1" max="400"></div><p class="editor-help-text">Max API requests per hour (10-20 recommended)</p></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item flex-row"><label>Monitored Only</label><label class="toggle-switch"><input type="checkbox" id="th-editor-monitored-only"' + (safe.monitored_only ? ' checked' : '') + '><span class="toggle-slider"></span></label></div><p class="editor-help-text">Only search for monitored episodes</p></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>Max Download Queue Size</label><input type="number" id="th-editor-max-queue-size" value="' + safe.max_download_queue_size + '" min="-1" max="1000"></div><p class="editor-help-text">Skip processing if queue meets or exceeds this value (-1 = disabled)</p></div>' +
            '</div>' +
            // EXEMPT TAGS
            '<div class="editor-section" style="border:1px solid rgba(231,76,60,0.3);border-radius:10px;padding:14px;background:rgba(231,76,60,0.06);margin-top:16px;"><div class="editor-section-title"><div class="section-title-text"><span class="section-title-icon accent-exempt"><i class="fas fa-ban"></i></span>EXEMPT TAGS</div></div>' +
            '<p class="editor-help-text" style="margin-bottom:12px;">Items with any of these tags are skipped for missing and upgrade searches.</p>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>Add exempt tag</label><div style="display:flex;gap:8px;align-items:center;"><input type="text" id="th-editor-exempt-tag-input" placeholder="Type a tag..." style="flex:1;" maxlength="50"><button type="button" class="btn-card" id="th-editor-exempt-tag-add" style="padding:8px 14px;white-space:nowrap;">Add</button></div></div>' +
            '<div id="th-editor-exempt-tags-list" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;min-height:24px;">' + exemptTagsHtml + '</div></div></div>' +
            // DEBUG MANAGER
            '<div class="editor-section" style="border:2px solid rgba(239,68,68,0.4);background:rgba(239,68,68,0.06);">' +
            '<div class="editor-section-title"><div class="section-title-text"><span class="section-title-icon accent-exempt"><i class="fas fa-bug"></i></span>DEBUG MANAGER</div></div>' +
            '<p class="editor-help-text" style="margin-bottom:16px;">Dangerous operations for troubleshooting. These are <strong style="color:#f87171;">irreversible</strong>.</p>' +
            '<div class="editor-field-group" style="border:1px solid rgba(239,68,68,0.2);border-radius:8px;padding:16px;background:rgba(239,68,68,0.04);">' +
            '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;">' +
            '<div style="flex:1;min-width:200px;"><strong style="color:#f1f5f9;font-size:0.95rem;">Reset TV Collection</strong>' +
            '<p class="editor-help-text" style="margin-top:4px;">Permanently deletes all TV series from this instance\'s collection.</p></div>' +
            '<button type="button" class="btn-card delete" id="th-editor-reset-collection" style="white-space:nowrap;background:#dc2626;color:white;border:1px solid #dc2626;padding:10px 20px;border-radius:8px;font-weight:600;cursor:pointer;"><i class="fas fa-trash-alt" style="margin-right:6px;"></i>Reset Library</button>' +
            '</div></div></div>' +
            '</div>';
    }

    function collectFormData() {
        var get = function(id) { var el = document.getElementById(id); return el ? el.value : null; };
        var getNum = function(id, def) { var v = get(id); if (v === null || v === '') return def; var n = parseInt(v, 10); return isNaN(n) ? def : n; };
        var getCheck = function(id) { var el = document.getElementById(id); return el ? !!el.checked : false; };
        var tags = [];
        var list = document.getElementById('th-editor-exempt-tags-list');
        if (list) list.querySelectorAll('.exempt-tag-chip').forEach(function(chip) { var t = chip.getAttribute('data-tag'); if (t) tags.push(t); });
        var enabledVal = get('th-editor-enabled');
        return {
            enabled: enabledVal === 'true',
            name: (get('th-editor-name') || '').trim() || 'Unnamed',
            hunt_missing_episodes: getNum('th-editor-missing-count', 1),
            hunt_upgrade_episodes: getNum('th-editor-upgrade-count', 0),
            hunt_missing_mode: get('th-editor-missing-mode') || 'seasons_packs',
            upgrade_mode: get('th-editor-missing-mode') || 'seasons_packs',
            upgrade_selection_method: (get('th-editor-upgrade-method') || 'cutoff').toLowerCase(),
            upgrade_tag: (get('th-editor-upgrade-tag') || '').trim(),
            skip_future_episodes: getCheck('th-editor-skip-future'),
            state_management_mode: get('th-editor-state-mode') || 'custom',
            state_management_hours: getNum('th-editor-state-hours', 72),
            sleep_duration: getNum('th-editor-sleep-duration', 15) * 60,
            hourly_cap: getNum('th-editor-hourly-cap', 20),
            exempt_tags: tags,
            monitored_only: getCheck('th-editor-monitored-only'),
            max_download_queue_size: getNum('th-editor-max-queue-size', -1),
        };
    }

    function setupExemptTagsListeners(container) {
        if (!container) return;
        var addBtn = container.querySelector('#th-editor-exempt-tag-add');
        var input = container.querySelector('#th-editor-exempt-tag-input');
        var list = container.querySelector('#th-editor-exempt-tags-list');
        if (!addBtn || !input || !list) return;
        function addTag() {
            var tag = (input.value || '').trim();
            if (!tag || tag.toLowerCase() === 'upgradinatorr') return;
            var existing = list.querySelectorAll('.exempt-tag-chip');
            for (var i = 0; i < existing.length; i++) { if (existing[i].getAttribute('data-tag') === tag) return; }
            var chip = document.createElement('span');
            chip.className = 'exempt-tag-chip';
            chip.setAttribute('data-tag', tag);
            chip.style.cssText = 'display:inline-flex;align-items:center;gap:6px;padding:4px 8px;background:#dc2626;color:#fff;border-radius:6px;font-size:0.875rem;';
            chip.innerHTML = '<span class="exempt-tag-remove" style="cursor:pointer;">&times;</span><span>' + escapeHtml(tag) + '</span>';
            list.appendChild(chip);
            input.value = '';
            _editorDirty = true;
            var saveBtn = document.getElementById('media-hunt-instance-editor-save');
            if (saveBtn) { saveBtn.disabled = false; saveBtn.classList.add('enabled'); }
        }
        addBtn.addEventListener('click', addTag);
        input.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); addTag(); } });
        list.addEventListener('click', function(e) {
            var remove = e.target.classList.contains('exempt-tag-remove') ? e.target : e.target.closest('.exempt-tag-remove');
            if (remove) {
                var chip = remove.closest('.exempt-tag-chip');
                if (chip) chip.remove();
                _editorDirty = true;
                var saveBtn = document.getElementById('media-hunt-instance-editor-save');
                if (saveBtn) { saveBtn.disabled = false; saveBtn.classList.add('enabled'); }
            }
        });
    }

    function setupChangeDetection(container) {
        var saveBtn = document.getElementById('media-hunt-instance-editor-save');
        if (!container || !saveBtn) return;
        saveBtn.disabled = true;
        saveBtn.classList.remove('enabled');
        function markDirty() { _editorDirty = true; saveBtn.disabled = false; saveBtn.classList.add('enabled'); }
        container.addEventListener('input', markDirty);
        container.addEventListener('change', markDirty);
        var stateMode = document.getElementById('th-editor-state-mode');
        var upgradeMethod = document.getElementById('th-editor-upgrade-method');
        if (stateMode) stateMode.addEventListener('change', function() {
            var block = document.getElementById('th-editor-stateful-block');
            if (block) block.style.display = stateMode.value === 'disabled' ? 'none' : 'block';
        });
        if (upgradeMethod) upgradeMethod.addEventListener('change', function() {
            var group = container.querySelector('.editor-upgrade-tag-group');
            if (group) group.style.display = upgradeMethod.value === 'tags' ? 'flex' : 'none';
        });
        var nameInput = document.getElementById('th-editor-name');
        var categoryNameEl = document.getElementById('th-editor-category-name');
        if (nameInput && categoryNameEl) {
            function updateThCategoryName() {
                var n = ((nameInput.value || '').trim() || 'Unnamed').replace(/ /g, '_');
                categoryNameEl.value = 'TV-' + n;
            }
            nameInput.addEventListener('input', updateThCategoryName);
            nameInput.addEventListener('change', updateThCategoryName);
        }
        var enabledSelect = document.getElementById('th-editor-enabled');
        var statusPill = container ? container.querySelector('.th-info-status-pill') : null;
        if (enabledSelect && statusPill) {
            enabledSelect.addEventListener('change', function() {
                var on = enabledSelect.value === 'true';
                statusPill.className = 'th-info-status-pill ' + (on ? 'th-info-status-enabled' : 'th-info-status-disabled');
                statusPill.innerHTML = on ? '<i class="fas fa-check-circle" style="margin-right:6px;"></i>Enabled' : 'Disabled';
            });
        }
    }

    function addInstanceCardHtml(appType, iconClass, label) {
        return '<div class="add-instance-card" data-app-type="' + appType + '"><div class="add-icon"><i class="fas fa-plus-circle"></i></div><div class="add-text">' + (label || 'Add Instance') + '</div></div>';
    }

    function renderTVInstanceCards(grid, list, currentId) {
        grid.innerHTML = '';
        currentId = (currentId != null) ? parseInt(currentId, 10) : (list && list[0] ? list[0].id : null);
        (list || []).forEach(function(inst) {
            var enabled = inst.enabled !== false;
            var statusClass = enabled ? 'status-connected' : 'status-disabled';
            var statusIcon = enabled ? 'fa-check-circle' : 'fa-minus-circle';
            var isDefault = currentId != null && inst.id === currentId;
            var defaultBtn = isDefault ? '' : '<button type="button" class="btn-card set-default" data-id="' + escapeAttr(String(inst.id)) + '"><i class="fas fa-star"></i> Default</button>';
            var deleteBtn = list.length > 1 ? '<button type="button" class="btn-card delete" data-id="' + escapeAttr(String(inst.id)) + '" data-name="' + escapeAttr(inst.name || '') + '"><i class="fas fa-trash"></i> Delete</button>' : '';
            var card = document.createElement('div');
            card.className = 'instance-card' + (isDefault ? ' default-instance' : '');
            card.innerHTML =
                '<div class="instance-card-header">' +
                '<span class="instance-name"><i class="fas fa-tv" style="margin-right: 8px;"></i>' + escapeHtml(inst.name || 'Instance ' + inst.id) + (isDefault ? ' <span class="default-badge">Default</span>' : '') + '</span>' +
                '<div class="instance-status-icon ' + statusClass + '" title="' + (enabled ? 'Enabled' : 'Disabled') + '"><i class="fas ' + statusIcon + '"></i></div>' +
                '</div>' +
                '<div class="instance-card-body"><div class="instance-detail"><i class="fas fa-hashtag"></i><span>ID ' + escapeHtml(inst.id) + '</span></div></div>' +
                '<div class="instance-card-footer"><button type="button" class="btn-card edit" data-id="' + escapeAttr(String(inst.id)) + '" data-name="' + escapeAttr(inst.name || '') + '"><i class="fas fa-edit"></i> Edit</button>' + defaultBtn + deleteBtn + '</div>';
            grid.appendChild(card);
        });
        var addCard = document.createElement('div');
        addCard.innerHTML = addInstanceCardHtml('media-hunt-instance-tv', 'fa-tv', 'Add TV Instance');
        grid.appendChild(addCard.firstElementChild);
        grid.querySelectorAll('.btn-card.edit').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                window.TVHuntInstanceEditor.openEditor(
                    btn.getAttribute('data-id'),
                    btn.getAttribute('data-name') || ('Instance ' + btn.getAttribute('data-id'))
                );
            });
        });
        grid.querySelectorAll('.btn-card.set-default').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                window.TVHuntInstanceEditor.setDefault(btn.getAttribute('data-id'));
            });
        });
        grid.querySelectorAll('.btn-card.delete').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                var name = btn.getAttribute('data-name') || ('Instance ' + btn.getAttribute('data-id'));
                var doDelete = function() { window.TVHuntInstanceEditor.deleteInstance(btn.getAttribute('data-id')); };
                if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
                    window.HuntarrConfirm.show({ title: 'Delete Instance', message: 'Delete TV Hunt instance "' + (name || '') + '"? All settings and collection data for this instance will be permanently removed.', confirmLabel: 'Delete', onConfirm: doDelete });
                } else if (confirm('Delete "' + name + '"? This cannot be undone.')) { doDelete(); }
            });
        });
    }

    window.TVHuntInstanceEditor = {
        loadInstanceList: function() {
            var grid = document.getElementById('tv-hunt-settings-instances-grid');
            if (!grid) return;
            grid.innerHTML = '<div style="color: #94a3b8;">Loading...</div>';
            var url = api('./api/tv-hunt/instances') + '?t=' + (Date.now ? Date.now() : new Date().getTime());
            fetch(url, { cache: 'no-store', credentials: 'same-origin' })
                .then(function(r) {
                    if (!r.ok) return r.json().then(function(data) { return { instances: data.instances || [], error: data.error }; });
                    return r.json();
                })
                .then(function(data) {
                    var list = (data && data.instances) ? data.instances : [];
                    var currentId = (data && data.current_instance_id != null) ? data.current_instance_id : null;
                    var err = data && data.error;
                    renderTVInstanceCards(grid, list, currentId);
                    if (err && window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification(err, 'error');
                    }
                })
                .catch(function() {
                    var errDiv = document.createElement('div');
                    errDiv.style.cssText = 'color: #f87171; margin-bottom: 12px;';
                    errDiv.textContent = 'Failed to load instances. You can still add a new TV instance below.';
                    grid.innerHTML = '';
                    grid.appendChild(errDiv);
                    renderTVInstanceCards(grid, [], null);
                });
        },

        setDefault: function(instanceId) {
            if (!instanceId) return;
            var self = this;
            fetch(api('./api/tv-hunt/instances/current'), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ instance_id: parseInt(instanceId, 10) })
            })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.success) {
                        if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Default instance updated', 'success');
                        self.loadInstanceList();
                    } else if (data.error && window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification(data.error, 'error');
                    }
                })
                .catch(function() {
                    if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Failed to set default instance', 'error');
                });
        },

        deleteInstance: function(instanceId) {
            if (!instanceId) return;
            var self = this;
            fetch(api('./api/tv-hunt/instances/' + instanceId), { method: 'DELETE' })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.success) {
                        if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Instance deleted', 'success');
                        self.loadInstanceList();
                    } else if (data.error && window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification(data.error || 'Failed to delete', 'error');
                    }
                })
                .catch(function() {
                    if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Failed to delete instance', 'error');
                });
        },

        openEditor: function(instanceId, instanceName) {
            _currentInstanceId = instanceId;
            _currentInstanceName = instanceName || ('Instance ' + instanceId);
            _editorDirty = false;
            var self = this;
            fetch(api('./api/tv-hunt/instances/' + instanceId + '/settings'), { cache: 'no-store' })
            .then(function(r) { return r.json().then(function(data) { return { ok: r.ok, data: data }; }); })
            .then(function(result) {
                if (!result.ok || result.data.error) {
                    if (window.huntarrUI) window.huntarrUI.showNotification(result.data.error || 'Failed to load settings', 'error');
                    return;
                }
                var contentEl = document.getElementById('media-hunt-instance-editor-content');
                if (contentEl) {
                    contentEl.innerHTML = buildEditorHtml(result.data);
                    setupExemptTagsListeners(contentEl);
                    setupChangeDetection(contentEl);
                }
                var breadcrumb = document.getElementById('media-hunt-instance-editor-instance-name');
                if (breadcrumb) breadcrumb.textContent = _currentInstanceName;
                var appNameEl = document.getElementById('media-hunt-instance-editor-app-name');
                if (appNameEl) appNameEl.textContent = 'TV Hunt';
                var appIcon = document.getElementById('media-hunt-instance-editor-app-icon');
                if (appIcon) appIcon.className = 'fas fa-tv';

                var backBtn = document.getElementById('media-hunt-instance-editor-back');
                var saveBtn = document.getElementById('media-hunt-instance-editor-save');
                if (backBtn) backBtn.onclick = function() {
                    if (!_editorDirty) { window.huntarrUI.switchSection('media-hunt-instances'); return; }
                    window.HuntarrConfirm.show({
                        title: 'Unsaved Changes',
                        message: 'You have unsaved changes that will be lost if you leave.',
                        confirmLabel: 'Go Back',
                        cancelLabel: 'Leave',
                        onConfirm: function() {},
                        onCancel: function() { window.huntarrUI.switchSection('media-hunt-instances'); }
                    });
                };
                if (saveBtn) saveBtn.onclick = function() { self.saveEditor(); };

                var resetBtn = document.getElementById('th-editor-reset-state');
                if (resetBtn) resetBtn.onclick = function() { self.resetState(instanceId); };

                var resetCollBtn = document.getElementById('th-editor-reset-collection');
                if (resetCollBtn) resetCollBtn.onclick = function() { self.resetCollection(instanceId); };

                if (window.huntarrUI && window.huntarrUI.switchSection) {
                    window.huntarrUI.switchSection('tv-hunt-instance-editor');
                }
            })
            .catch(function(err) {
                if (window.huntarrUI) window.huntarrUI.showNotification('Failed to load settings: ' + (err.message || ''), 'error');
            });
        },

        saveEditor: function() {
            if (!_currentInstanceId) return;
            var payload = collectFormData();
            var saveBtn = document.getElementById('media-hunt-instance-editor-save');
            if (saveBtn) { saveBtn.disabled = true; saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...'; }
            fetch(api('./api/tv-hunt/instances/' + _currentInstanceId + '/settings'), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (data.error) {
                    if (window.huntarrUI) window.huntarrUI.showNotification(data.error, 'error');
                    if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = '<i class="fas fa-save"></i> Save'; saveBtn.classList.add('enabled'); }
                    return;
                }
                _editorDirty = false;
                if (saveBtn) {
                    saveBtn.innerHTML = '<i class="fas fa-check"></i> Saved!';
                    saveBtn.classList.remove('enabled');
                    setTimeout(function() { saveBtn.innerHTML = '<i class="fas fa-save"></i> Save'; saveBtn.disabled = true; }, 2000);
                }
            })
            .catch(function() {
                if (window.huntarrUI) window.huntarrUI.showNotification('Failed to save settings', 'error');
                if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = '<i class="fas fa-save"></i> Save'; saveBtn.classList.add('enabled'); }
            });
        },

        resetState: function(instanceId) {
            window.HuntarrConfirm.show({
                title: 'Reset State',
                message: 'Reset processed state for this TV Hunt instance?',
                confirmLabel: 'Reset',
                onConfirm: function() {
                    fetch(api('./api/tv-hunt/instances/' + instanceId + '/reset-state'), { method: 'POST' })
                    .then(function(r) { return r.json(); })
                    .then(function(data) {
                        if (data.error) { window.huntarrUI.showNotification(data.error, 'error'); }
                        else { window.huntarrUI.showNotification('State reset.', 'success'); }
                    })
                    .catch(function() { window.huntarrUI.showNotification('Reset request failed', 'error'); });
                }
            });
        },

        resetCollection: function(instanceId) {
            window.HuntarrConfirm.show({
                title: 'Reset TV Collection',
                message: 'This will permanently delete ALL TV series from this instance\'s collection. This cannot be undone.',
                confirmLabel: 'Delete All',
                onConfirm: function() {
                    fetch(api('./api/tv-hunt/instances/' + instanceId + '/reset-collection'), { method: 'DELETE' })
                    .then(function(r) { return r.json(); })
                    .then(function(data) {
                        if (data.success) { window.huntarrUI.showNotification(data.message || 'TV collection reset.', 'success'); }
                        else { window.huntarrUI.showNotification(data.error || 'Failed to reset.', 'error'); }
                    })
                    .catch(function() { window.huntarrUI.showNotification('Request failed.', 'error'); });
                }
            });
        }
    };
})();


/* === modules/features/settings/logs.js === */
(function() {
    window.SettingsForms = window.SettingsForms || {};

    window.SettingsForms.generateLogsSettingsForm = function(container, settings = {}) {
        if (!settings || typeof settings !== "object") {
            settings = {};
        }

        container.setAttribute("data-app-type", "logs");

        container.innerHTML = `
            <!-- Two-column grid (header is in template) -->
            <div class="mset-grid">

                <!-- Log Rotation card -->
                <div class="mset-card">
                    <div class="mset-card-header">
                        <div class="mset-card-icon mset-icon-blue"><i class="fas fa-sync-alt"></i></div>
                        <h3>Log Rotation</h3>
                    </div>
                    <div class="mset-card-body">
                        <div class="setting-item">
                            <label for="log_rotation_enabled">Enable Log Rotation:</label>
                            <label class="toggle-switch">
                                <input type="checkbox" id="log_rotation_enabled" name="log_rotation_enabled" ${
                                  settings.log_rotation_enabled !== false ? "checked" : ""
                                }>
                                <span class="toggle-slider"></span>
                            </label>
                            <p class="setting-help">Automatically rotate log files when they reach a certain size</p>
                        </div>
                        <div class="setting-item">
                            <label for="log_max_size_mb">Max File Size:</label>
                            <div style="display: flex; align-items: center; gap: 10px;">
                                <input type="number" id="log_max_size_mb" name="log_max_size_mb" min="1" max="500" value="${
                                  settings.log_max_size_mb || 50
                                }" class="mset-input" style="width: 100px; max-width: 100px;">
                                <span style="color: #9ca3af; font-size: 13px;">MB</span>
                            </div>
                            <p class="setting-help">Maximum size before rotating to a new file</p>
                        </div>
                        <div class="setting-item">
                            <label for="log_backup_count">Backup Files to Keep:</label>
                            <input type="number" id="log_backup_count" name="log_backup_count" min="0" max="50" value="${
                              settings.log_backup_count || 5
                            }" class="mset-input" style="width: 100px; max-width: 100px;">
                            <p class="setting-help">Number of rotated log files to retain (0-50)</p>
                        </div>
                    </div>
                </div>

                <!-- Retention & Cleanup card -->
                <div class="mset-card">
                    <div class="mset-card-header">
                        <div class="mset-card-icon mset-icon-amber"><i class="fas fa-broom"></i></div>
                        <h3>Retention & Cleanup</h3>
                    </div>
                    <div class="mset-card-body">
                        <div class="setting-item">
                            <label for="log_retention_days">Retention Days:</label>
                            <input type="number" id="log_retention_days" name="log_retention_days" min="0" max="365" value="${
                              settings.log_retention_days || 30
                            }" class="mset-input" style="width: 100px; max-width: 100px;">
                            <p class="setting-help">Delete logs older than this many days (0 = unlimited)</p>
                        </div>
                        <div class="setting-item">
                            <label for="log_max_entries_per_app">Max DB Entries Per App:</label>
                            <input type="number" id="log_max_entries_per_app" name="log_max_entries_per_app" min="1000" max="100000" step="1000" value="${
                              settings.log_max_entries_per_app || 10000
                            }" class="mset-input" style="width: 120px; max-width: 120px;">
                            <p class="setting-help">Maximum database log entries to keep per app type. Oldest are pruned hourly.</p>
                        </div>
                        <div class="setting-item">
                            <label for="log_auto_cleanup">Auto-Cleanup on Startup:</label>
                            <label class="toggle-switch">
                                <input type="checkbox" id="log_auto_cleanup" name="log_auto_cleanup" ${
                                  settings.log_auto_cleanup !== false ? "checked" : ""
                                }>
                                <span class="toggle-slider"></span>
                            </label>
                            <p class="setting-help">Automatically clean up old logs when Huntarr starts and hourly while running</p>
                        </div>
                    </div>
                </div>

                <!-- Advanced Settings card -->
                <div class="mset-card">
                    <div class="mset-card-header">
                        <div class="mset-card-icon mset-icon-purple"><i class="fas fa-sliders-h"></i></div>
                        <h3>Advanced Settings</h3>
                    </div>
                    <div class="mset-card-body">
                        <div class="setting-item">
                            <label for="enable_debug_logs">Enable Debug Logs:</label>
                            <label class="toggle-switch">
                                <input type="checkbox" id="enable_debug_logs" name="enable_debug_logs" ${
                                  settings.enable_debug_logs !== false ? "checked" : ""
                                }>
                                <span class="toggle-slider"></span>
                            </label>
                            <p class="setting-help">Store and display DEBUG level logs. When disabled, DEBUG logs are not saved to the database and the Debug level filter is hidden in the log viewer.</p>
                        </div>
                        <div class="setting-item">
                            <label for="log_refresh_interval_seconds">Log Refresh Interval:</label>
                            <div style="display: flex; align-items: center; gap: 10px;">
                                <input type="number" id="log_refresh_interval_seconds" name="log_refresh_interval_seconds" min="5" max="300" value="${
                                  settings.log_refresh_interval_seconds || 30
                                }" class="mset-input" style="width: 100px; max-width: 100px;">
                                <span style="color: #9ca3af; font-size: 13px;">seconds</span>
                            </div>
                            <p class="setting-help">How often the log viewer polls for new entries</p>
                        </div>
                    </div>
                </div>

                <!-- Log Storage & Actions card -->
                <div class="mset-card">
                    <div class="mset-card-header">
                        <div class="mset-card-icon mset-icon-teal"><i class="fas fa-database"></i></div>
                        <h3>Log Storage</h3>
                    </div>
                    <div class="mset-card-body">
                        <div class="logset-stats">
                            <div class="logset-stat-row">
                                <span class="logset-stat-label"><i class="fas fa-hdd"></i> Log Files:</span>
                                <span id="logset-file-size" class="logset-stat-value">Loading...</span>
                            </div>
                            <div class="logset-stat-row">
                                <span class="logset-stat-label"><i class="fas fa-database"></i> Database:</span>
                                <span id="logset-db-size" class="logset-stat-value">Loading...</span>
                            </div>
                            <div class="logset-stat-row">
                                <span class="logset-stat-label"><i class="fas fa-list"></i> Total Entries:</span>
                                <span id="logset-total-entries" class="logset-stat-value">Loading...</span>
                            </div>
                        </div>
                        <div class="logset-actions">
                            <button type="button" id="logset-cleanup-btn" class="logset-action-btn logset-btn-amber">
                                <i class="fas fa-broom"></i> Clean Up Now
                            </button>
                            <button type="button" id="logset-clear-btn" class="logset-action-btn logset-btn-red">
                                <i class="fas fa-trash-alt"></i> Clear All Logs
                            </button>
                        </div>
                    </div>
                </div>

            </div>
        `;

        // Load storage stats
        _loadLogStats(container);

        // Wire action buttons
        const cleanupBtn = container.querySelector('#logset-cleanup-btn');
        if (cleanupBtn) {
            cleanupBtn.addEventListener('click', () => _runLogCleanup(container));
        }
        const clearBtn = container.querySelector('#logset-clear-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => _clearAllLogs(container));
        }

        if (window.SettingsForms.setupAppManualSave) {
            window.SettingsForms.setupAppManualSave(container, "general", settings, { section: "logs" });
        }
    };

    function _loadLogStats(container) {
        // Fetch both endpoints in parallel
        Promise.all([
            HuntarrUtils.fetchWithTimeout('./api/logs/usage').then(r => r.json()).catch(() => null),
            HuntarrUtils.fetchWithTimeout('./api/logs/stats').then(r => r.json()).catch(() => null)
        ]).then(([usage, stats]) => {
            const fileEl = container.querySelector('#logset-file-size');
            const dbEl = container.querySelector('#logset-db-size');
            const totalEl = container.querySelector('#logset-total-entries');

            if (usage && usage.success && fileEl) {
                fileEl.textContent = `${usage.total_size_formatted} (${usage.file_count} files)`;
            } else if (fileEl) {
                fileEl.textContent = 'Unavailable';
            }

            if (stats && stats.success) {
                if (dbEl) dbEl.textContent = stats.db_size_formatted || 'Unknown';
                if (totalEl) totalEl.textContent = (stats.total_logs || 0).toLocaleString() + ' entries';
            } else {
                if (dbEl) dbEl.textContent = 'Unavailable';
                if (totalEl) totalEl.textContent = 'Unavailable';
            }
        });
    }

    function _showNotif(msg, type) {
        if (window.huntarrUI && window.huntarrUI.showNotification) {
            window.huntarrUI.showNotification(msg, type);
        } else {
            alert(msg);
        }
    }

    function _runLogCleanup(container) {
        // Read current form values for retention
        const days = parseInt(container.querySelector('#log_retention_days')?.value || '30', 10);
        const maxEntries = parseInt(container.querySelector('#log_max_entries_per_app')?.value || '10000', 10);

        const btn = container.querySelector('#logset-cleanup-btn');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Cleaning...'; }

        HuntarrUtils.fetchWithTimeout('./api/logs/cleanup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ days_to_keep: days, max_entries_per_app: maxEntries })
        })
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                _showNotif(`Cleanup complete: removed ${data.deleted_count} entries`, 'success');
                _loadLogStats(container);
            } else {
                _showNotif('Cleanup failed: ' + (data.error || 'Unknown error'), 'error');
            }
        })
        .catch(err => {
            _showNotif('Cleanup failed: ' + err.message, 'error');
        })
        .finally(() => {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-broom"></i> Clean Up Now'; }
        });
    }

    function _clearAllLogs(container) {
        const doClear = function() {
            const btn = container.querySelector('#logset-clear-btn');
            if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Clearing...'; }

            HuntarrUtils.fetchWithTimeout('./api/logs/all/clear', {
                method: 'POST'
            })
            .then(r => r.json())
            .then(data => {
                if (data.success) {
                    _showNotif('All logs cleared', 'success');
                    _loadLogStats(container);
                } else {
                    _showNotif('Failed to clear logs: ' + (data.error || 'Unknown error'), 'error');
                }
            })
            .catch(err => {
                _showNotif('Failed to clear logs: ' + err.message, 'error');
            })
            .finally(() => {
                if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-trash-alt"></i> Clear All Logs'; }
            });
        };

        if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
            window.HuntarrConfirm.show({
                title: 'Clear All Logs',
                message: 'Are you sure you want to delete all log entries from the database? This cannot be undone.',
                confirmLabel: 'Clear All',
                onConfirm: doClear
            });
        } else {
            if (confirm('Are you sure you want to clear all logs?')) doClear();
        }
    }
})();


/* === modules/features/settings/notifications.js === */
/**
 * Huntarr Notifications — Modern multi-provider notification management
 *
 * Features:
 * - Provider grid for adding new connections
 * - Per-connection app/instance scope (cascading dropdowns)
 * - Grouped connection list organized by app type
 * - Test button in modal and in connection list
 * - Trigger checkboxes per connection
 */

(function () {
    'use strict';

    // ------------------------------------------------------------------
    // State
    // ------------------------------------------------------------------
    var providerMeta = {};
    var triggerKeys = [];
    var defaultTriggers = {};
    var connections = [];
    var editingId = null;
    var editingProvider = null;

    // Movie Hunt and TV Hunt instances (loaded from API)
    var movieHuntInstances = [];
    var tvHuntInstances = [];

    // App settings cache (for instance names)
    var appSettingsCache = {};

    var TRIGGER_LABELS = {
        on_grab: 'On Grab',
        on_import: 'On Import',
        on_upgrade: 'On Upgrade',
        on_missing: 'On Missing',
        on_rename: 'On Rename',
        on_delete: 'On Delete',
        on_health_issue: 'On Health Issue',
        on_app_update: 'On App Update',
        on_manual_required: 'On Manual Required'
    };

    // App type display info
    var APP_TYPES = [
        { key: 'all', label: 'All Apps', icon: 'fas fa-layer-group', color: '#818cf8' },
        { key: 'movie_hunt', label: 'Movie Hunt', icon: 'fas fa-film', color: '#f59e0b' },
        { key: 'tv_hunt', label: 'TV Hunt', icon: 'fas fa-tv', color: '#0ea5e9' },
        { key: 'sonarr', label: 'Sonarr', icon: 'fas fa-tv', color: '#60a5fa' },
        { key: 'radarr', label: 'Radarr', icon: 'fas fa-video', color: '#f97316' },
        { key: 'lidarr', label: 'Lidarr', icon: 'fas fa-music', color: '#34d399' },
        { key: 'readarr', label: 'Readarr', icon: 'fas fa-book', color: '#a78bfa' },
        { key: 'whisparr', label: 'Whisparr', icon: 'fas fa-microphone', color: '#f472b6' },
        { key: 'eros', label: 'Eros', icon: 'fas fa-heart', color: '#fb7185' }
    ];

    function getAppInfo(key) {
        for (var i = 0; i < APP_TYPES.length; i++) {
            if (APP_TYPES[i].key === key) return APP_TYPES[i];
        }
        return { key: key, label: key, icon: 'fas fa-bell', color: '#64748b' };
    }

    // ------------------------------------------------------------------
    // Initialization
    // ------------------------------------------------------------------

    window.SettingsForms = window.SettingsForms || {};

    window.SettingsForms.generateNotificationsForm = function (container, settings) {
        initNotifications();
    };

    window.SettingsForms.setupNotificationsManualSave = function () {};

    function initNotifications() {
        if (window._notifInitialized) return;
        window._notifInitialized = true;

        Promise.all([
            loadProviders(),
            loadAppData()
        ])
        .then(function () { return loadConnections(); })
        .then(function () {
            renderProviderGrid();
            renderConnections();
            bindModalEvents();
        })
        .catch(function (err) {
            console.error('[Notifications] Init error:', err);
        });
    }

    // ------------------------------------------------------------------
    // API calls
    // ------------------------------------------------------------------

    function loadProviders() {
        return HuntarrUtils.fetchWithTimeout('./api/notifications/providers')
            .then(function (r) { return r.json(); })
            .then(function (data) {
                providerMeta = data.providers || {};
                triggerKeys = data.trigger_keys || [];
                defaultTriggers = data.default_triggers || {};
            });
    }

    function loadAppData() {
        return Promise.all([
            HuntarrUtils.fetchWithTimeout('./api/settings').then(function (r) { return r.json(); }).catch(function () { return {}; }),
            HuntarrUtils.fetchWithTimeout('./api/movie-hunt/instances').then(function (r) { return r.json(); }).catch(function () { return { instances: [] }; }),
            HuntarrUtils.fetchWithTimeout('./api/tv-hunt/instances').then(function (r) { return r.json(); }).catch(function () { return { instances: [] }; })
        ]).then(function (results) {
            var settings = results[0];
            var mhData = results[1];
            var thData = results[2];

            movieHuntInstances = Array.isArray(mhData.instances) ? mhData.instances : [];
            tvHuntInstances = Array.isArray(thData.instances) ? thData.instances : [];

            var appTypes = ['sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros'];
            appTypes.forEach(function (at) {
                if (settings[at] && Array.isArray(settings[at].instances)) {
                    appSettingsCache[at] = settings[at].instances;
                }
            });
        });
    }

    function loadConnections() {
        return HuntarrUtils.fetchWithTimeout('./api/notifications/connections')
            .then(function (r) { return r.json(); })
            .then(function (data) {
                connections = data.connections || [];
            });
    }

    function apiSaveConnection(payload) {
        var method = payload.id ? 'PUT' : 'POST';
        var url = payload.id
            ? './api/notifications/connections/' + payload.id
            : './api/notifications/connections';

        return HuntarrUtils.fetchWithTimeout(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }).then(function (r) { return r.json(); });
    }

    function apiDeleteConnection(connId) {
        return HuntarrUtils.fetchWithTimeout('./api/notifications/connections/' + connId, {
            method: 'DELETE'
        }).then(function (r) { return r.json(); });
    }

    function apiTestConnection(connId) {
        return HuntarrUtils.fetchWithTimeout('./api/notifications/connections/' + connId + '/test', {
            method: 'POST'
        }).then(function (r) { return r.json(); });
    }

    // ------------------------------------------------------------------
    // Render — Provider Grid
    // ------------------------------------------------------------------

    function renderProviderGrid() {
        var grid = document.getElementById('providerGrid');
        if (!grid) return;
        grid.innerHTML = '';

        var order = ['discord', 'telegram', 'slack', 'pushover', 'pushbullet', 'email', 'notifiarr', 'webhook', 'apprise'];

        order.forEach(function (key) {
            var meta = providerMeta[key];
            if (!meta) return;

            var card = document.createElement('div');
            card.className = 'notif-provider-card';
            card.innerHTML =
                '<div class="notif-provider-card-icon" style="background:' + meta.color + '">' +
                    '<i class="' + meta.icon + '"></i>' +
                '</div>' +
                '<div class="notif-provider-card-name">' + meta.name + '</div>';

            card.addEventListener('click', function () {
                openModal(key, null);
            });

            grid.appendChild(card);
        });
    }

    // ------------------------------------------------------------------
    // Render — Grouped Connection List
    // ------------------------------------------------------------------

    function renderConnections() {
        var container = document.getElementById('connectionList');
        var empty = document.getElementById('noConnectionsMessage');
        var countEl = document.getElementById('connectionCount');
        if (!container || !empty) return;

        container.innerHTML = '';

        if (connections.length === 0) {
            container.style.display = 'none';
            empty.style.display = 'block';
            if (countEl) countEl.textContent = '';
            return;
        }

        container.style.display = 'flex';
        empty.style.display = 'none';
        if (countEl) countEl.textContent = connections.length + ' connection' + (connections.length !== 1 ? 's' : '');

        // Group by app_scope
        var groups = {};
        connections.forEach(function (conn) {
            var scope = conn.app_scope || 'all';
            if (!groups[scope]) groups[scope] = [];
            groups[scope].push(conn);
        });

        // Render in APP_TYPES order
        var orderedKeys = APP_TYPES.map(function (a) { return a.key; });
        // Add any unexpected keys
        Object.keys(groups).forEach(function (k) {
            if (orderedKeys.indexOf(k) === -1) orderedKeys.push(k);
        });

        orderedKeys.forEach(function (appKey) {
            var list = groups[appKey];
            if (!list || list.length === 0) return;

            var appInfo = getAppInfo(appKey);

            var groupEl = document.createElement('div');
            groupEl.className = 'notif-group';

            // Group header
            var header = document.createElement('div');
            header.className = 'notif-group-header';
            header.innerHTML =
                '<div class="notif-group-header-icon" style="background:' + appInfo.color + '">' +
                    '<i class="' + appInfo.icon + '"></i>' +
                '</div>' +
                '<span class="notif-group-header-label">' + appInfo.label + '</span>' +
                '<span class="notif-group-header-count">' + list.length + '</span>';

            groupEl.appendChild(header);

            // Group body
            var body = document.createElement('div');
            body.className = 'notif-group-body';

            list.forEach(function (conn) {
                body.appendChild(renderConnectionItem(conn));
            });

            groupEl.appendChild(body);
            container.appendChild(groupEl);
        });
    }

    function renderConnectionItem(conn) {
        var meta = providerMeta[conn.provider] || {};
        var color = meta.color || '#64748b';
        var icon = meta.icon || 'fas fa-bell';
        var providerName = meta.name || conn.provider;

        var triggers = conn.triggers || {};
        var activeCount = 0;
        for (var k in triggers) { if (triggers[k]) activeCount++; }

        var statusDot = conn.enabled ? 'active' : 'disabled';
        var statusText = conn.enabled ? 'Enabled' : 'Disabled';

        // Instance scope label
        var scopeLabel = '';
        if (conn.instance_scope && conn.instance_scope !== 'all') {
            scopeLabel = resolveInstanceName(conn.app_scope, conn.instance_scope);
        } else {
            scopeLabel = 'All Instances';
        }

        var el = document.createElement('div');
        el.className = 'notif-connection-item';
        el.innerHTML =
            '<div class="notif-connection-left">' +
                '<div class="notif-connection-icon" style="background:' + color + '">' +
                    '<i class="' + icon + '"></i>' +
                '</div>' +
                '<div class="notif-connection-info">' +
                    '<div class="notif-connection-name">' + escapeHtml(conn.name || providerName) + '</div>' +
                    '<div class="notif-connection-meta">' +
                        '<span class="notif-connection-provider-badge"><i class="' + icon + '" style="font-size:10px"></i> ' + providerName + '</span>' +
                        '<span class="notif-connection-scope-badge"><i class="fas fa-filter" style="font-size:9px"></i> ' + escapeHtml(scopeLabel) + '</span>' +
                        '<span class="notif-connection-status"><span class="notif-status-dot ' + statusDot + '"></span> ' + statusText + '</span>' +
                        '<span>' + activeCount + ' trigger' + (activeCount !== 1 ? 's' : '') + '</span>' +
                    '</div>' +
                '</div>' +
            '</div>' +
            '<div class="notif-connection-actions">' +
                '<button class="notif-btn-icon test-btn" data-id="' + conn.id + '" title="Send Test"><i class="fas fa-paper-plane"></i></button>' +
                '<button class="notif-btn-icon edit-btn" data-id="' + conn.id + '" title="Edit"><i class="fas fa-pen"></i></button>' +
                '<button class="notif-btn-icon delete-btn" data-id="' + conn.id + '" title="Delete"><i class="fas fa-trash"></i></button>' +
            '</div>';

        el.querySelector('.test-btn').addEventListener('click', function (e) {
            e.stopPropagation();
            handleTest(conn.id, this);
        });

        el.querySelector('.edit-btn').addEventListener('click', function (e) {
            e.stopPropagation();
            openModal(conn.provider, conn);
        });

        el.querySelector('.delete-btn').addEventListener('click', function (e) {
            e.stopPropagation();
            handleDelete(conn.id, conn.name || providerName);
        });

        return el;
    }

    function resolveInstanceName(appScope, instanceId) {
        if (appScope === 'movie_hunt') {
            for (var i = 0; i < movieHuntInstances.length; i++) {
                if (String(movieHuntInstances[i].id) === String(instanceId)) {
                    return movieHuntInstances[i].name || 'Instance ' + instanceId;
                }
            }
            return 'Instance ' + instanceId;
        }
        if (appScope === 'tv_hunt') {
            for (var t = 0; t < tvHuntInstances.length; t++) {
                if (String(tvHuntInstances[t].id) === String(instanceId)) {
                    return tvHuntInstances[t].name || 'Instance ' + instanceId;
                }
            }
            return 'Instance ' + instanceId;
        }
        var instances = appSettingsCache[appScope] || [];
        for (var j = 0; j < instances.length; j++) {
            var inst = instances[j];
            if (inst && (inst.instance_id === instanceId || String(j) === instanceId)) {
                return inst.name || inst.instance_name || 'Instance ' + (j + 1);
            }
        }
        return 'Instance ' + instanceId;
    }

    // ------------------------------------------------------------------
    // Modal — Open / Close
    // ------------------------------------------------------------------

    function openModal(providerKey, existingConn) {
        var overlay = document.getElementById('notifModalOverlay');
        var body = document.getElementById('notifModalBody');
        var titleEl = document.getElementById('notifModalTitle');
        var iconEl = document.getElementById('notifModalIcon');
        var iconI = document.getElementById('notifModalIconI');
        var testBtn = document.getElementById('notifModalTestBtn');

        if (!overlay || !body) return;

        var meta = providerMeta[providerKey] || {};
        editingProvider = providerKey;
        editingId = existingConn ? existingConn.id : null;

        // Header
        titleEl.textContent = existingConn ? 'Edit ' + meta.name : 'Add ' + (meta.name || providerKey);
        iconEl.style.background = meta.color || '#64748b';
        iconI.className = meta.icon || 'fas fa-bell';

        // Test button availability (only for existing connections)
        if (testBtn) {
            testBtn.disabled = !editingId;
            testBtn.style.display = editingId ? '' : 'none';
        }

        var html = '';

        // ---- Connection Name + Enabled ----
        html += '<div class="notif-name-group">';
        html += '<div class="notif-form-group" style="margin-bottom:10px">';
        html += '<label>Connection Name <span class="required">*</span></label>';
        html += '<input type="text" id="notifFieldName" placeholder="My ' + (meta.name || '') + ' Notification" value="' + escapeAttr(existingConn ? existingConn.name : '') + '">';
        html += '</div>';
        html += '<div class="notif-checkbox-row">';
        html += '<input type="checkbox" id="notifFieldEnabled" ' + (existingConn ? (existingConn.enabled ? 'checked' : '') : 'checked') + '>';
        html += '<label for="notifFieldEnabled" style="margin-bottom:0;cursor:pointer">Enabled</label>';
        html += '</div>';
        html += '</div>';

        // ---- App / Instance Scope ----
        html += '<div class="notif-scope-row">';
        html += '<div class="notif-form-group" style="margin-bottom:0">';
        html += '<label>App Type</label>';
        html += '<select id="notifScopeApp">';
        APP_TYPES.forEach(function (app) {
            var sel = (existingConn && existingConn.app_scope === app.key) ? ' selected' : (!existingConn && app.key === 'all' ? ' selected' : '');
            html += '<option value="' + app.key + '"' + sel + '>' + app.label + '</option>';
        });
        html += '</select>';
        html += '</div>';
        html += '<div class="notif-form-group" style="margin-bottom:0">';
        html += '<label>Instance</label>';
        html += '<select id="notifScopeInstance"><option value="all">All Instances</option></select>';
        html += '</div>';
        html += '</div>';

        // ---- Provider-specific fields ----
        var fields = meta.fields || [];
        var existingSettings = (existingConn && existingConn.settings) || {};

        fields.forEach(function (field) {
            html += '<div class="notif-form-group">';
            if (field.type === 'checkbox') {
                html += '<div class="notif-checkbox-row">';
                html += '<input type="checkbox" id="notifField_' + field.key + '" ' + (existingSettings[field.key] ? 'checked' : '') + '>';
                html += '<label for="notifField_' + field.key + '" style="margin-bottom:0;cursor:pointer">' + field.label + '</label>';
                html += '</div>';
            } else {
                html += '<label>' + field.label;
                if (field.required) html += ' <span class="required">*</span>';
                html += '</label>';

                if (field.type === 'select') {
                    html += '<select id="notifField_' + field.key + '">';
                    (field.options || []).forEach(function (opt) {
                        var sel = (String(existingSettings[field.key]) === String(opt.value)) ? ' selected' : '';
                        html += '<option value="' + escapeAttr(opt.value) + '"' + sel + '>' + opt.label + '</option>';
                    });
                    html += '</select>';
                } else if (field.type === 'textarea') {
                    html += '<textarea id="notifField_' + field.key + '" placeholder="' + escapeAttr(field.placeholder || '') + '">' + escapeHtml(existingSettings[field.key] || '') + '</textarea>';
                } else {
                    var inputType = field.type === 'password' ? 'password' : (field.type === 'number' ? 'number' : 'text');
                    html += '<input type="' + inputType + '" id="notifField_' + field.key + '" placeholder="' + escapeAttr(field.placeholder || '') + '" value="' + escapeAttr(existingSettings[field.key] || '') + '">';
                }
            }
            if (field.help) html += '<div class="notif-form-help">' + field.help + '</div>';
            html += '</div>';
        });

        // ---- Notification Triggers ----
        html += '<div class="notif-triggers-section">';
        html += '<div class="notif-triggers-title">Notification Triggers</div>';
        html += '<div class="notif-triggers-grid">';

        var existingTriggers = (existingConn && existingConn.triggers) || defaultTriggers;
        var displayTriggers = triggerKeys.filter(function (k) { return k !== 'on_test'; });

        displayTriggers.forEach(function (key) {
            var label = TRIGGER_LABELS[key] || key.replace('on_', '').replace(/_/g, ' ');
            label = label.replace(/\b\w/g, function (c) { return c.toUpperCase(); });
            var checked = existingTriggers[key] ? 'checked' : (existingTriggers[key] === undefined && defaultTriggers[key] ? 'checked' : '');

            html += '<label class="notif-trigger-item">';
            html += '<input type="checkbox" id="notifTrigger_' + key + '" ' + checked + '>';
            html += '<span class="notif-trigger-label">' + label + '</span>';
            html += '</label>';
        });
        html += '</div></div>';

        // ---- Include options ----
        html += '<div class="notif-options-row">';
        html += '<label><input type="checkbox" id="notifOptAppName" ' + (existingConn ? (existingConn.include_app_name ? 'checked' : '') : 'checked') + '> Include App Name</label>';
        html += '<label><input type="checkbox" id="notifOptInstance" ' + (existingConn ? (existingConn.include_instance_name ? 'checked' : '') : 'checked') + '> Include Instance Name</label>';
        html += '</div>';

        body.innerHTML = html;

        // Wire up cascading dropdowns
        var appSelect = document.getElementById('notifScopeApp');
        var instSelect = document.getElementById('notifScopeInstance');
        if (appSelect && instSelect) {
            appSelect.addEventListener('change', function () {
                populateInstanceDropdown(appSelect.value, instSelect, null);
            });
            // Initial population
            var existingInstScope = existingConn ? existingConn.instance_scope : 'all';
            populateInstanceDropdown(appSelect.value, instSelect, existingInstScope);
        }

        // Show modal
        overlay.classList.add('active');
        document.body.style.overflow = 'hidden';

        setTimeout(function () {
            var first = body.querySelector('input[type="text"], input[type="password"]');
            if (first) first.focus();
        }, 200);
    }

    function populateInstanceDropdown(appKey, selectEl, preselect) {
        selectEl.innerHTML = '<option value="all">All Instances</option>';

        if (appKey === 'all') {
            selectEl.disabled = true;
            return;
        }

        selectEl.disabled = false;

        var instances = [];

        if (appKey === 'movie_hunt') {
            instances = movieHuntInstances.map(function (inst) {
                return { id: String(inst.id), name: inst.name || 'Instance ' + inst.id };
            });
        } else if (appKey === 'tv_hunt') {
            instances = tvHuntInstances.map(function (inst) {
                return { id: String(inst.id), name: inst.name || 'Instance ' + inst.id };
            });
        } else {
            var appInsts = appSettingsCache[appKey] || [];
            instances = appInsts.map(function (inst, idx) {
                return {
                    id: inst.instance_id || String(idx),
                    name: inst.name || inst.instance_name || 'Instance ' + (idx + 1)
                };
            });
        }

        instances.forEach(function (inst) {
            var opt = document.createElement('option');
            opt.value = inst.id;
            opt.textContent = inst.name;
            if (preselect && preselect === inst.id) opt.selected = true;
            selectEl.appendChild(opt);
        });
    }

    function closeModal() {
        var overlay = document.getElementById('notifModalOverlay');
        if (overlay) {
            overlay.classList.remove('active');
            document.body.style.overflow = '';
        }
        editingId = null;
        editingProvider = null;
    }

    function bindModalEvents() {
        var overlay = document.getElementById('notifModalOverlay');
        var closeBtn = document.getElementById('notifModalClose');
        var cancelBtn = document.getElementById('notifModalCancelBtn');
        var saveBtn = document.getElementById('notifModalSaveBtn');
        var testBtn = document.getElementById('notifModalTestBtn');

        if (closeBtn) closeBtn.addEventListener('click', closeModal);
        if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

        if (overlay) {
            overlay.addEventListener('click', function (e) {
                if (e.target === overlay) closeModal();
            });
        }

        if (saveBtn) saveBtn.addEventListener('click', handleSave);
        if (testBtn) testBtn.addEventListener('click', handleModalTest);
    }

    // ------------------------------------------------------------------
    // Modal — Save
    // ------------------------------------------------------------------

    function handleSave() {
        var meta = providerMeta[editingProvider] || {};
        var fields = meta.fields || [];

        var nameEl = document.getElementById('notifFieldName');
        var name = nameEl ? nameEl.value.trim() : '';
        if (!name) name = meta.name || editingProvider;

        var enabled = document.getElementById('notifFieldEnabled');
        var isEnabled = enabled ? enabled.checked : true;

        // Scope
        var appScopeEl = document.getElementById('notifScopeApp');
        var instScopeEl = document.getElementById('notifScopeInstance');
        var appScope = appScopeEl ? appScopeEl.value : 'all';
        var instanceScope = instScopeEl ? instScopeEl.value : 'all';

        // Provider settings
        var settings = {};
        var missingRequired = false;

        fields.forEach(function (field) {
            var el = document.getElementById('notifField_' + field.key);
            if (!el) return;
            if (field.type === 'checkbox') {
                settings[field.key] = el.checked;
            } else {
                settings[field.key] = el.value.trim();
            }
            if (field.required && !settings[field.key]) {
                missingRequired = true;
                el.style.borderColor = '#f87171';
            } else if (el.style) {
                el.style.borderColor = '';
            }
        });

        if (missingRequired) {
            notify('Please fill in all required fields', 'error');
            return;
        }

        // Triggers
        var triggers = {};
        var displayTriggers = triggerKeys.filter(function (k) { return k !== 'on_test'; });
        displayTriggers.forEach(function (key) {
            var el = document.getElementById('notifTrigger_' + key);
            triggers[key] = el ? el.checked : false;
        });

        var inclApp = document.getElementById('notifOptAppName');
        var inclInst = document.getElementById('notifOptInstance');

        var payload = {
            name: name,
            provider: editingProvider,
            enabled: isEnabled,
            settings: settings,
            triggers: triggers,
            include_app_name: inclApp ? inclApp.checked : true,
            include_instance_name: inclInst ? inclInst.checked : true,
            app_scope: appScope,
            instance_scope: instanceScope
        };

        if (editingId) payload.id = editingId;

        var saveBtn = document.getElementById('notifModalSaveBtn');
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
        }

        apiSaveConnection(payload)
            .then(function (data) {
                if (data.error) {
                    notify('Failed to save: ' + data.error, 'error');
                    return;
                }
                notify('Connection saved successfully', 'success');

                // If new, store the id so the Test button works
                if (!editingId && data.id) {
                    editingId = data.id;
                    var testBtn = document.getElementById('notifModalTestBtn');
                    if (testBtn) { testBtn.disabled = false; testBtn.style.display = ''; }
                }

                return loadConnections().then(renderConnections);
            })
            .catch(function (err) {
                notify('Failed to save connection', 'error');
                console.error('[Notifications] Save error:', err);
            })
            .finally(function () {
                if (saveBtn) {
                    saveBtn.disabled = false;
                    saveBtn.innerHTML = '<i class="fas fa-save"></i> Save';
                }
            });
    }

    // ------------------------------------------------------------------
    // Actions — Test / Delete
    // ------------------------------------------------------------------

    function handleModalTest() {
        if (!editingId) {
            notify('Save the connection first before testing', 'info');
            return;
        }
        var testBtn = document.getElementById('notifModalTestBtn');
        if (!testBtn) return;

        testBtn.disabled = true;
        testBtn.classList.add('testing');
        testBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Testing...';

        apiTestConnection(editingId)
            .then(function (data) {
                if (data.success) {
                    notify('Test notification sent!', 'success');
                    testBtn.innerHTML = '<i class="fas fa-check"></i> Sent!';
                    setTimeout(function () {
                        testBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Test';
                    }, 2500);
                } else {
                    notify('Test failed: ' + (data.error || 'Unknown error'), 'error');
                    testBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Test';
                }
            })
            .catch(function () {
                notify('Test failed: Network error', 'error');
                testBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Test';
            })
            .finally(function () {
                testBtn.disabled = false;
                testBtn.classList.remove('testing');
            });
    }

    function handleTest(connId, btnEl) {
        var iconEl = btnEl.querySelector('i');
        var origClass = iconEl.className;
        iconEl.className = 'fas fa-spinner fa-spin';
        btnEl.classList.add('testing');

        apiTestConnection(connId)
            .then(function (data) {
                if (data.success) {
                    notify('Test notification sent!', 'success');
                    iconEl.className = 'fas fa-check';
                    setTimeout(function () { iconEl.className = origClass; }, 2000);
                } else {
                    notify('Test failed: ' + (data.error || 'Unknown error'), 'error');
                    iconEl.className = origClass;
                }
            })
            .catch(function () {
                notify('Test failed: Network error', 'error');
                iconEl.className = origClass;
            })
            .finally(function () {
                btnEl.classList.remove('testing');
            });
    }

    function handleDelete(connId, connName) {
        if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
            window.HuntarrConfirm.show({
                title: 'Delete Connection',
                message: 'Are you sure you want to delete "' + connName + '"?',
                confirmLabel: 'Delete',
                onConfirm: function () { doDelete(connId); }
            });
        } else {
            if (confirm('Delete "' + connName + '"?')) {
                doDelete(connId);
            }
        }
    }

    function doDelete(connId) {
        apiDeleteConnection(connId)
            .then(function (data) {
                if (data.error) {
                    notify('Failed to delete: ' + data.error, 'error');
                    return;
                }
                notify('Connection deleted', 'success');
                return loadConnections().then(renderConnections);
            })
            .catch(function () {
                notify('Failed to delete connection', 'error');
            });
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    function notify(msg, type) {
        if (window.huntarrUI && window.huntarrUI.showNotification) {
            window.huntarrUI.showNotification(msg, type || 'info');
        } else {
            alert(msg);
        }
    }

    function escapeHtml(s) {
        if (!s) return '';
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(s));
        return div.innerHTML;
    }

    function escapeAttr(s) {
        if (!s) return '';
        return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
})();


/* === modules/features/settings/general.js === */
(function() {
    window.SettingsForms = window.SettingsForms || {};

    window.SettingsForms.generateGeneralForm = function(container, settings = {}) {
        if (!settings || typeof settings !== "object") {
            settings = {};
        }

        container.setAttribute("data-app-type", "general");

        // Build timezone options
        const timezoneOptions = (() => {
            const predefinedTimezones = [
                "UTC", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Pacific/Honolulu",
                "America/Toronto", "America/Vancouver", "America/Sao_Paulo", "America/Argentina/Buenos_Aires", "America/Mexico_City",
                "America/Phoenix", "America/Anchorage", "America/Halifax", "America/St_Johns", "America/Lima", "America/Bogota",
                "America/Caracas", "America/Santiago", "America/La_Paz",
                "Europe/London", "Europe/Paris", "Europe/Berlin", "Europe/Amsterdam", "Europe/Rome", "Europe/Madrid",
                "Europe/Stockholm", "Europe/Zurich", "Europe/Vienna", "Europe/Prague", "Europe/Warsaw", "Europe/Budapest",
                "Europe/Bucharest", "Europe/Sofia", "Europe/Athens", "Europe/Helsinki", "Europe/Oslo", "Europe/Copenhagen",
                "Europe/Brussels", "Europe/Lisbon", "Europe/Dublin", "Europe/Moscow", "Europe/Kiev", "Europe/Minsk",
                "Europe/Riga", "Europe/Tallinn", "Europe/Vilnius",
                "Africa/Cairo", "Africa/Lagos", "Africa/Nairobi", "Africa/Casablanca", "Africa/Johannesburg",
                "Asia/Dubai", "Asia/Qatar", "Asia/Kuwait", "Asia/Riyadh", "Asia/Tehran", "Asia/Tashkent", "Asia/Almaty",
                "Asia/Tokyo", "Asia/Seoul", "Asia/Shanghai", "Asia/Hong_Kong", "Asia/Singapore", "Asia/Bangkok", "Asia/Kolkata",
                "Asia/Karachi", "Asia/Jakarta", "Asia/Manila", "Asia/Kuala_Lumpur", "Asia/Taipei", "Asia/Yekaterinburg",
                "Australia/Sydney", "Australia/Melbourne", "Australia/Brisbane", "Australia/Adelaide", "Australia/Perth",
                "Pacific/Auckland", "Pacific/Fiji", "Pacific/Guam"
            ];
            let custom = "";
            const ct = settings.timezone;
            if (ct && !predefinedTimezones.includes(ct)) {
                custom = `<option value="${ct}" selected>${ct} (Custom from Environment)</option>`;
            }
            const labels = {
                "UTC": "UTC (Coordinated Universal Time)",
                "America/New_York": "Eastern Time (America/New_York)", "America/Chicago": "Central Time (America/Chicago)",
                "America/Denver": "Mountain Time (America/Denver)", "America/Los_Angeles": "Pacific Time (America/Los_Angeles)",
                "Pacific/Honolulu": "Hawaii Time (Pacific/Honolulu)", "America/Toronto": "Eastern Canada (America/Toronto)",
                "America/Vancouver": "Pacific Canada (America/Vancouver)", "America/Sao_Paulo": "Brazil (America/Sao_Paulo)",
                "America/Argentina/Buenos_Aires": "Argentina (America/Argentina/Buenos_Aires)", "America/Mexico_City": "Mexico (America/Mexico_City)",
                "America/Phoenix": "Arizona (America/Phoenix)", "America/Anchorage": "Alaska (America/Anchorage)",
                "America/Halifax": "Atlantic Canada (America/Halifax)", "America/St_Johns": "Newfoundland (America/St_Johns)",
                "America/Lima": "Peru (America/Lima)", "America/Bogota": "Colombia (America/Bogota)",
                "America/Caracas": "Venezuela (America/Caracas)", "America/Santiago": "Chile (America/Santiago)",
                "America/La_Paz": "Bolivia (America/La_Paz)", "Europe/London": "UK Time (Europe/London)",
                "Europe/Paris": "Central Europe (Europe/Paris)", "Europe/Berlin": "Germany (Europe/Berlin)",
                "Europe/Amsterdam": "Netherlands (Europe/Amsterdam)", "Europe/Rome": "Italy (Europe/Rome)",
                "Europe/Madrid": "Spain (Europe/Madrid)", "Europe/Stockholm": "Sweden (Europe/Stockholm)",
                "Europe/Zurich": "Switzerland (Europe/Zurich)", "Europe/Vienna": "Austria (Europe/Vienna)",
                "Europe/Prague": "Czech Republic (Europe/Prague)", "Europe/Warsaw": "Poland (Europe/Warsaw)",
                "Europe/Budapest": "Hungary (Europe/Budapest)", "Europe/Bucharest": "Romania (Europe/Bucharest)",
                "Europe/Sofia": "Bulgaria (Europe/Sofia)", "Europe/Athens": "Greece (Europe/Athens)",
                "Europe/Helsinki": "Finland (Europe/Helsinki)", "Europe/Oslo": "Norway (Europe/Oslo)",
                "Europe/Copenhagen": "Denmark (Europe/Copenhagen)", "Europe/Brussels": "Belgium (Europe/Brussels)",
                "Europe/Lisbon": "Portugal (Europe/Lisbon)", "Europe/Dublin": "Ireland (Europe/Dublin)",
                "Europe/Moscow": "Russia Moscow (Europe/Moscow)", "Europe/Kiev": "Ukraine (Europe/Kiev)",
                "Europe/Minsk": "Belarus (Europe/Minsk)", "Europe/Riga": "Latvia (Europe/Riga)",
                "Europe/Tallinn": "Estonia (Europe/Tallinn)", "Europe/Vilnius": "Lithuania (Europe/Vilnius)",
                "Africa/Cairo": "Egypt (Africa/Cairo)", "Africa/Lagos": "Nigeria (Africa/Lagos)",
                "Africa/Nairobi": "Kenya (Africa/Nairobi)", "Africa/Casablanca": "Morocco (Africa/Casablanca)",
                "Africa/Johannesburg": "South Africa (Africa/Johannesburg)", "Asia/Dubai": "UAE (Asia/Dubai)",
                "Asia/Qatar": "Qatar (Asia/Qatar)", "Asia/Kuwait": "Kuwait (Asia/Kuwait)",
                "Asia/Riyadh": "Saudi Arabia (Asia/Riyadh)", "Asia/Tehran": "Iran (Asia/Tehran)",
                "Asia/Tashkent": "Uzbekistan (Asia/Tashkent)", "Asia/Almaty": "Kazakhstan (Asia/Almaty)",
                "Asia/Tokyo": "Japan (Asia/Tokyo)", "Asia/Seoul": "South Korea (Asia/Seoul)",
                "Asia/Shanghai": "China (Asia/Shanghai)", "Asia/Hong_Kong": "Hong Kong (Asia/Hong_Kong)",
                "Asia/Singapore": "Singapore (Asia/Singapore)", "Asia/Bangkok": "Thailand (Asia/Bangkok)",
                "Asia/Kolkata": "India (Asia/Kolkata)", "Asia/Karachi": "Pakistan (Asia/Karachi)",
                "Asia/Jakarta": "Indonesia (Asia/Jakarta)", "Asia/Manila": "Philippines (Asia/Manila)",
                "Asia/Kuala_Lumpur": "Malaysia (Asia/Kuala_Lumpur)", "Asia/Taipei": "Taiwan (Asia/Taipei)",
                "Asia/Yekaterinburg": "Russia Yekaterinburg (Asia/Yekaterinburg)",
                "Australia/Sydney": "Australia East (Australia/Sydney)", "Australia/Melbourne": "Australia Melbourne (Australia/Melbourne)",
                "Australia/Brisbane": "Australia Brisbane (Australia/Brisbane)", "Australia/Adelaide": "Australia Adelaide (Australia/Adelaide)",
                "Australia/Perth": "Australia West (Australia/Perth)", "Pacific/Auckland": "New Zealand (Pacific/Auckland)",
                "Pacific/Fiji": "Fiji (Pacific/Fiji)", "Pacific/Guam": "Guam (Pacific/Guam)"
            };
            return custom + predefinedTimezones.map(tz =>
                `<option value="${tz}" ${settings.timezone === tz || (tz === "UTC" && !settings.timezone) ? "selected" : ""}>${labels[tz] || tz}</option>`
            ).join("\n");
        })();

        container.innerHTML = `
            <!-- Two-column grid (header is in template) -->
            <div class="mset-grid">

                <!-- System Settings card -->
                <div class="mset-card">
                    <div class="mset-card-header">
                        <div class="mset-card-icon mset-icon-blue"><i class="fas fa-globe"></i></div>
                        <h3>System Settings</h3>
                    </div>
                    <div class="mset-card-body">
                        <div class="setting-item">
                            <label for="timezone">Timezone:</label>
                            <select id="timezone" name="timezone" class="mset-select">${timezoneOptions}</select>
                            <p class="setting-help">Set your timezone for accurate time display in logs and scheduling. Changes are applied immediately.</p>
                        </div>
                        <div class="setting-item" style="margin-top: 15px;">
                            <label for="tmdb_image_cache_days">TMDB Image Cache:</label>
                            <select id="tmdb_image_cache_days" class="mset-select">
                                <option value="0" ${settings.tmdb_image_cache_days === 0 ? "selected" : ""}>Disabled (Always Load)</option>
                                <option value="1" ${settings.tmdb_image_cache_days === 1 ? "selected" : ""}>1 Day</option>
                                <option value="7" ${settings.tmdb_image_cache_days === 7 ? "selected" : ""}>7 Days</option>
                                <option value="30" ${(settings.tmdb_image_cache_days === 30 || settings.tmdb_image_cache_days === undefined) ? "selected" : ""}>30 Days</option>
                            </select>
                            <p class="setting-help">Cache TMDB images to reduce load times and API usage. Missing images will still attempt to load.</p>
                        </div>
                        <div class="setting-item flex-row" style="margin-top: 15px;" id="show_trending_setting_item">
                            <label for="show_trending">Show Smart Hunt on Home:</label>
                            <label class="toggle-switch">
                                <input type="checkbox" id="show_trending" ${settings.show_trending !== false ? "checked" : ""}>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                        <p class="setting-help">Display the Smart Hunt carousel on the Home page. Configure mix settings in Requestarr &gt; Smart Hunt.</p>
                    </div>
                </div>

                <!-- Security card -->
                <div class="mset-card">
                    <div class="mset-card-header">
                        <div class="mset-card-icon mset-icon-amber"><i class="fas fa-shield-alt"></i></div>
                        <h3>Security</h3>
                    </div>
                    <div class="mset-card-body">
                        <div class="setting-item">
                            <label for="auth_mode">Authentication Mode:</label>
                            <select id="auth_mode" name="auth_mode" class="mset-select">
                                <option value="login" ${settings.auth_mode === "login" || (!settings.auth_mode && !settings.local_access_bypass && !settings.proxy_auth_bypass) ? "selected" : ""}>Login Mode</option>
                                <option value="local_bypass" ${settings.auth_mode === "local_bypass" || (!settings.auth_mode && settings.local_access_bypass === true && !settings.proxy_auth_bypass) ? "selected" : ""}>Local Bypass Mode</option>
                                <option value="no_login" ${settings.auth_mode === "no_login" || (!settings.auth_mode && settings.proxy_auth_bypass === true) ? "selected" : ""}>No Login Mode</option>
                            </select>
                            <p class="setting-help">Login Mode: Standard login. Local Bypass: No login on local network. No Login: Completely open (use behind proxy).</p>
                        </div>
                        <div class="setting-item flex-row">
                            <label for="ssl_verify">Enable SSL Verify:</label>
                            <label class="toggle-switch">
                                <input type="checkbox" id="ssl_verify" ${settings.ssl_verify === true ? "checked" : ""}>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                        <p class="setting-help">Disable SSL certificate verification when using self-signed certificates.</p>
                    </div>
                </div>

                <!-- Advanced Settings card -->
                <div class="mset-card">
                    <div class="mset-card-header">
                        <div class="mset-card-icon mset-icon-purple"><i class="fas fa-terminal"></i></div>
                        <h3>Advanced Settings</h3>
                    </div>
                    <div class="mset-card-body">
                        <div class="setting-item flex-row">
                            <label for="enable_media_hunt">Enable Media Hunt & NZB Hunt:</label>
                            <label class="toggle-switch">
                                <input type="checkbox" id="enable_media_hunt" ${settings.enable_media_hunt !== false ? "checked" : ""}>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                        <p class="setting-help" style="margin-top: -8px;">When disabled, Media Hunt and NZB Hunt are hidden from the sidebar and all Media Hunt cycles stop running.</p>
                        <div class="setting-item flex-row" style="margin-top: 12px;">
                            <label for="enable_third_party_apps">Enable 3rd Party Apps:</label>
                            <label class="toggle-switch">
                                <input type="checkbox" id="enable_third_party_apps" ${settings.enable_third_party_apps !== false ? "checked" : ""}>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                        <p class="setting-help" style="margin-top: -8px;">When disabled, 3rd Party Apps (Sonarr, Radarr, etc.) are hidden from the sidebar and all their hunt cycles stop running.</p>
                        <div class="setting-item" style="margin-top: 15px; border-top: 1px solid rgba(148, 163, 184, 0.08); padding-top: 15px;">
                            <label for="base_url">Base URL:</label>
                            <input type="text" id="base_url" value="${settings.base_url || ""}" placeholder="/huntarr" class="mset-input">
                            <p class="setting-help">Base URL path for reverse proxy. Requires restart.</p>
                        </div>
                        <div class="setting-item">
                            <label for="dev_key">Huntarr Dev Key:${settings.dev_mode === true ? ' <i class="fas fa-check-circle" style="color: #22c55e; margin-left: 5px;" title="Dev Mode Active"></i>' : ''}</label>
                            <input type="password" id="dev_key" value="${settings.dev_key || ""}" placeholder="Enter dev key" class="mset-input">
                            <p class="setting-help">Enter development key to enable dev mode.</p>
                        </div>
                        <div class="setting-item" style="margin-top: 15px;">
                            <label for="web_server_threads">Web Server Threads:</label>
                            <select id="web_server_threads" class="mset-select">
                                <option value="8" ${settings.web_server_threads === 8 ? "selected" : ""}>8 (Light)</option>
                                <option value="16" ${settings.web_server_threads === 16 ? "selected" : ""}>16 (Moderate)</option>
                                <option value="32" ${(settings.web_server_threads === 32 || !settings.web_server_threads) ? "selected" : ""}>32 (Default)</option>
                                <option value="48" ${settings.web_server_threads === 48 ? "selected" : ""}>48 (Heavy)</option>
                                <option value="64" ${settings.web_server_threads === 64 ? "selected" : ""}>64 (High Load)</option>
                                <option value="96" ${settings.web_server_threads === 96 ? "selected" : ""}>96 (Maximum)</option>
                            </select>
                            <p class="setting-help">Number of web server worker threads for handling concurrent requests. Increase if using many apps/instances. Requires restart.</p>
                        </div>
                        <div class="setting-item" style="margin-top: 15px; border-top: 1px solid rgba(148, 163, 184, 0.08); padding-top: 15px;">
                            <label>Reset Media Hunt Wizard:</label>
                            <button type="button" id="reset-media-hunt-wizard-btn" class="mset-btn-secondary" style="margin-top: 6px; padding: 7px 16px; background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.25); border-radius: 6px; color: #f87171; font-size: 0.85rem; cursor: pointer; transition: all 0.15s;">
                                <i class="fas fa-redo"></i> Reset Wizard
                            </button>
                            <p class="setting-help">Re-show the Media Hunt setup wizard on next visit. Useful if you skipped the wizard and want to run it again.</p>
                        </div>
                    </div>
                </div>


            </div>
        `;

        // Reset Media Hunt Wizard button
        var resetWizardBtn = container.querySelector('#reset-media-hunt-wizard-btn');
        if (resetWizardBtn) {
            resetWizardBtn.addEventListener('click', function() {
                if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
                    window.HuntarrConfirm.show({
                        title: 'Reset Media Hunt Wizard',
                        message: 'This will re-show the Media Hunt setup wizard on your next visit to Media Hunt. Continue?',
                        confirmLabel: 'Reset',
                        cancelLabel: 'Cancel',
                        onConfirm: function() {
                            // Update in-memory prefs
                            if (window.huntarrUI && window.huntarrUI.originalSettings && window.huntarrUI.originalSettings.general) {
                                var prefs = window.huntarrUI.originalSettings.general.ui_preferences || {};
                                prefs['media-hunt-wizard-completed'] = false;
                                window.huntarrUI.originalSettings.general.ui_preferences = prefs;
                            }
                            // Save directly to server (don't rely on setUIPreference chaining)
                            HuntarrUtils.fetchWithTimeout('./api/settings/general', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ ui_preferences: { 'media-hunt-wizard-completed': false } })
                            }).then(function() {
                                if (window.HuntarrToast) window.HuntarrToast.success('Media Hunt wizard has been reset. It will show on your next visit to Media Hunt.');
                            }).catch(function(err) {
                                console.error('[ResetWizard] Failed to save:', err);
                                if (window.HuntarrToast) window.HuntarrToast.error('Failed to save wizard reset.');
                            });
                            // Set a force-show flag so the wizard appears even if all steps are done
                            try { sessionStorage.setItem('setup-wizard-force-show', '1'); } catch (e) {}
                        }
                    });
                } else {
                    if (confirm('Reset the Media Hunt wizard? It will show again on your next visit.')) {
                        if (window.huntarrUI && window.huntarrUI.originalSettings && window.huntarrUI.originalSettings.general) {
                            var prefs = window.huntarrUI.originalSettings.general.ui_preferences || {};
                            prefs['media-hunt-wizard-completed'] = false;
                            window.huntarrUI.originalSettings.general.ui_preferences = prefs;
                        }
                        HuntarrUtils.fetchWithTimeout('./api/settings/general', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ ui_preferences: { 'media-hunt-wizard-completed': false } })
                        }).catch(function(err) { console.error('[ResetWizard] Failed to save:', err); });
                        try { sessionStorage.setItem('setup-wizard-force-show', '1'); } catch (e) {}
                    }
                }
            });
        }

        if (window.SettingsForms.setupSettingsManualSave) {
            window.SettingsForms.setupSettingsManualSave(container, settings);
        }
    };

    window.SettingsForms.setupSettingsManualSave = function(container, originalSettings = {}) {
        let saveButton = container.querySelector("#settings-save-button");
        if (!saveButton) saveButton = document.getElementById("settings-save-button");
        if (!saveButton) return;

        saveButton.disabled = true;
        saveButton.classList.remove("mset-save-active");

        let hasChanges = false;
        window.settingsUnsavedChanges = false;
        if (window.SettingsForms.removeUnsavedChangesWarning) {
            window.SettingsForms.removeUnsavedChangesWarning();
        }

        const getLiveSaveButton = () => container.querySelector("#settings-save-button") || document.getElementById("settings-save-button");
        const updateSaveButtonState = (changesDetected) => {
            hasChanges = changesDetected;
            window.settingsUnsavedChanges = changesDetected;
            const btn = getLiveSaveButton();
            if (!btn) return;
            if (hasChanges) {
                btn.disabled = false;
                btn.classList.add("mset-save-active");
                if (window.SettingsForms.addUnsavedChangesWarning) {
                    window.SettingsForms.addUnsavedChangesWarning();
                }
            } else {
                btn.disabled = true;
                btn.classList.remove("mset-save-active");
                if (window.SettingsForms.removeUnsavedChangesWarning) {
                    window.SettingsForms.removeUnsavedChangesWarning();
                }
            }
        };

        container.addEventListener('input', () => updateSaveButtonState(true));
        container.addEventListener('change', () => updateSaveButtonState(true));

        const newSaveButton = saveButton.cloneNode(true);
        saveButton.parentNode.replaceChild(newSaveButton, saveButton);

        newSaveButton.addEventListener("click", () => {
            if (!hasChanges) return;
            const liveBtn = getLiveSaveButton();
            if (liveBtn) {
                liveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
                liveBtn.disabled = true;
            }

            const settings = window.SettingsForms.getFormSettings(container, "general");
            window.SettingsForms.saveAppSettings("general", settings, "Settings saved successfully", { section: "main" })
                .then(function() {
                    // Re-apply feature flags to sidebar after save
                    if (typeof window.applyFeatureFlags === 'function') window.applyFeatureFlags();
                    if (window.huntarrUI) {
                        window.huntarrUI._enableMediaHunt = settings.enable_media_hunt !== false;
                        window.huntarrUI._enableThirdPartyApps = settings.enable_third_party_apps !== false;
                    }
                }).catch(function() {});

            if (liveBtn) liveBtn.innerHTML = '<i class="fas fa-save"></i> Save';
            updateSaveButtonState(false);
        });
    };
})();
