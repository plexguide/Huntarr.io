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
            alert('Error: Settings not loaded. Please refresh the page.');
            return;
        }

        const settings = window.huntarrUI.originalSettings[appType];
        if (!settings) {
            console.error(`[SettingsForms] Settings for ${appType} not found in originalSettings`);
            alert(`Error: Settings for ${appType} not found. Please refresh the page.`);
            return;
        }

        const isEdit = index !== null;
        let instance;
        
        if (isEdit) {
            if (!settings.instances || !settings.instances[index]) {
                console.error(`[SettingsForms] Instance at index ${index} not found for ${appType}`);
                alert('Error: Instance not found.');
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
            
            // Add change detection after a short delay to let values settle
            setTimeout(() => {
                this.setupEditorChangeDetection();
                // Initialize form field states based on enabled status
                this.toggleFormFields();
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
                alert('The tag "upgradinatorr" cannot be added as an exempt tag.');
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
        chip.style.cssText = 'display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px; background: #dc2626; color: #fff; border-radius: 6px; font-size: 0.875rem;';
        chip.innerHTML = '<span class="exempt-tag-remove" style="cursor: pointer; opacity: 0.9;" title="Remove" aria-label="Remove">×</span><span>' + String(tag).replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span>';
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
        var saveFirst = window.confirm('You have unsaved changes. Save before leaving?');
        if (saveFirst) {
            if (typeof done === 'function') done('save');
            return false;
        } else {
            if (typeof done === 'function') done('discard');
            return true;
        }
    },

    isInstanceEditorDirty: function() {
        return !!_instanceEditorDirty;
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
            // Custom Tags (per-instance)
            custom_tags: instance.custom_tags || {},
            // Exempt Tags (per-instance) - items with these tags are skipped for missing/upgrade
            exempt_tags: Array.isArray(instance.exempt_tags) ? instance.exempt_tags : [],
            // Advanced Settings (per-instance)
            api_timeout: instance.api_timeout || 120,
            command_wait_delay: instance.command_wait_delay || 1,
            command_wait_attempts: instance.command_wait_attempts || 600,
            max_download_queue_size: instance.max_download_queue_size !== undefined ? instance.max_download_queue_size : -1,
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
            <style>
                #instance-editor-content * {
                    box-sizing: border-box !important;
                }
                .editor-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
                    gap: 25px;
                    padding: 10px;
                    width: 100%;
                }
                .editor-section {
                    background: rgba(30, 41, 59, 0.4);
                    border: 1px solid rgba(148, 163, 184, 0.1);
                    border-radius: 12px;
                    padding: 24px;
                    display: flex;
                    flex-direction: column;
                    width: 100%;
                    overflow: hidden;
                }
                .editor-section-title {
                    font-size: 1.1rem;
                    font-weight: 600;
                    color: #f8fafc;
                    margin-bottom: 20px;
                    padding-bottom: 12px;
                    border-bottom: 1px solid rgba(148, 163, 184, 0.1);
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                .editor-field-group {
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                    margin-bottom: 26px;
                    width: 100%;
                }
                .editor-field-group:last-child {
                    margin-bottom: 0;
                }
                .editor-setting-item {
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                    width: 100%;
                    align-items: flex-start;
                    padding-right: 21px;
                }
                .editor-setting-item.flex-row {
                    flex-direction: row;
                    justify-content: space-between;
                    align-items: center;
                    padding-right: 29px;
                }
                .editor-setting-item label {
                    color: #f8fafc;
                    font-weight: 500;
                    font-size: 0.95rem;
                    margin: 0 !important;
                    width: auto !important;
                    display: block !important;
                    text-align: left !important;
                }
                .editor-setting-item input[type="text"],
                .editor-setting-item input[type="number"],
                .editor-setting-item select {
                    width: 100%;
                    padding: 12px;
                    border-radius: 8px;
                    border: 1px solid rgba(148, 163, 184, 0.2);
                    background: rgba(15, 23, 42, 0.6);
                    color: white;
                    font-size: 0.95rem;
                    transition: all 0.2s ease;
                    margin: 0 !important;
                }
                .editor-setting-item input:focus,
                .editor-setting-item select:focus {
                    border-color: #6366f1;
                    outline: none;
                    background: rgba(15, 23, 42, 0.8);
                }
                .editor-help-text {
                    color: #94a3b8;
                    font-size: 0.85rem;
                    margin: 0 !important;
                    padding-left: 2px;
                    line-height: 1.4;
                    text-align: left !important;
                    width: 100%;
                }
                .editor-section .toggle-switch {
                    margin: 0 !important;
                    flex-shrink: 0;
                }
                .btn-reset-state {
                    width: 100%; 
                    justify-content: center; 
                    padding: 12px;
                    margin-bottom: 15px;
                }
                .editor-field-disabled input,
                .editor-field-disabled select,
                .editor-field-disabled .toggle-switch {
                    opacity: 0.5;
                    pointer-events: none;
                    cursor: not-allowed;
                }
                .editor-field-disabled label {
                    opacity: 0.5;
                }
            </style>
            <div class="editor-grid">
                <div class="editor-section">
                    <div class="editor-section-title">
                        <span>Connection Details</span>
                        <div id="connection-status-container"></div>
                    </div>
                    
                    <div class="editor-field-group">
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
                </div>
        `;

        if (appType === 'sonarr') {
            html += `
                <div class="editor-section">
                    <div class="editor-section-title">Search Settings</div>
                    
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
                        <p class="editor-help-text">Cutoff unmet: items below quality cutoff (default). Tags: items WITHOUT the specified tag (Upgradinatorr-style: tag is ADDED after processing to mark as complete). 
                            <a href="https://trash-guides.info/" target="_blank" rel="noopener" style="color: #2ecc71; text-decoration: underline;">💡 TrashGuides</a> | 
                            <a href="https://github.com/angrycuban13/Just-A-Bunch-Of-Starr-Scripts/blob/main/Upgradinatorr/README.md#requirements" target="_blank" rel="noopener" style="color: #e74c3c; text-decoration: underline;">🔗 Upgradinatorr</a>
                        </p>
                    </div>
                    <div class="editor-field-group editor-upgrade-tag-group" style="display: ${(safeInstance.upgrade_selection_method || 'cutoff') === 'tags' ? 'flex' : 'none'};">
                        <div class="editor-setting-item">
                            <label>Upgrade Tag</label>
                            <input type="text" id="editor-upgrade-tag" value="${(safeInstance.upgrade_tag || 'upgradinatorr').replace(/"/g, '&quot;')}" placeholder="e.g. upgradinatorr">
                        </div>
                        <p class="editor-help-text">Tag name in Sonarr; Huntarr will search series WITHOUT this tag and ADD it after processing (Upgradinatorr-style tracking). 
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
                    <div class="editor-section-title">Search Settings</div>
                    
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
                        <p class="editor-help-text">Cutoff unmet: items below quality cutoff (default). Tags: items WITHOUT the specified tag (Upgradinatorr-style: tag is ADDED after processing to mark as complete). 
                            <a href="https://trash-guides.info/" target="_blank" rel="noopener" style="color: #2ecc71; text-decoration: underline;">💡 TrashGuides</a> | 
                            <a href="https://github.com/angrycuban13/Just-A-Bunch-Of-Starr-Scripts/blob/main/Upgradinatorr/README.md#requirements" target="_blank" rel="noopener" style="color: #e74c3c; text-decoration: underline;">🔗 Upgradinatorr</a>
                        </p>
                    </div>
                    <div class="editor-field-group editor-upgrade-tag-group" style="display: ${(safeInstance.upgrade_selection_method || 'cutoff') === 'tags' ? 'flex' : 'none'};">
                        <div class="editor-setting-item">
                            <label>Upgrade Tag</label>
                            <input type="text" id="editor-upgrade-tag" value="${(safeInstance.upgrade_tag || 'upgradinatorr').replace(/"/g, '&quot;')}" placeholder="e.g. upgradinatorr">
                        </div>
                        <p class="editor-help-text">Tag name in Radarr; Huntarr will search movies WITHOUT this tag and ADD it after processing (Upgradinatorr-style tracking). 
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
                     ? 'Tag name on artists in Lidarr; Huntarr will search albums by artists WITHOUT this tag and ADD it after processing (Upgradinatorr-style tracking). <a href="https://trash-guides.info/" target="_blank" rel="noopener" style="color: #2ecc71; text-decoration: underline;">💡 TrashGuides</a> | <a href="https://github.com/angrycuban13/Just-A-Bunch-Of-Starr-Scripts/blob/main/Upgradinatorr/README.md#requirements" target="_blank" rel="noopener" style="color: #e74c3c; text-decoration: underline;">🔗 Upgradinatorr</a>'
                     : 'Tag name on authors in Readarr; Huntarr will search books by authors WITHOUT this tag and ADD it after processing (Upgradinatorr-style tracking). <a href="https://trash-guides.info/" target="_blank" rel="noopener" style="color: #2ecc71; text-decoration: underline;">💡 TrashGuides</a> | <a href="https://github.com/angrycuban13/Just-A-Bunch-Of-Starr-Scripts/blob/main/Upgradinatorr/README.md#requirements" target="_blank" rel="noopener" style="color: #e74c3c; text-decoration: underline;">🔗 Upgradinatorr</a>';
                 html += `
                    <div class="editor-field-group">
                        <div class="editor-setting-item">
                            <label>Upgrade Selection Method</label>
                            <select id="editor-upgrade-method" onchange="window.SettingsForms.toggleUpgradeTagVisibility();">
                                <option value="cutoff" ${(safeInstance.upgrade_selection_method || 'cutoff') === 'cutoff' ? 'selected' : ''}>Cutoff unmet</option>
                                <option value="tags" ${(safeInstance.upgrade_selection_method || 'cutoff') === 'tags' ? 'selected' : ''}>Tags</option>
                            </select>
                        </div>
                        <p class="editor-help-text">Cutoff unmet: items below quality cutoff (default). Tags: items WITHOUT the specified tag (Upgradinatorr-style: tag is ADDED after processing to mark as complete). 
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
                    <div class="editor-section-title">Stateful Management</div>
                    
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
                    
                    ${isEdit && safeInstance.state_management_mode !== 'disabled' ? `
                    <div class="editor-field-group">
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
                    <div class="editor-section-title">Additional Settings</div>
                    
                    <div class="editor-field-group" style="margin-bottom: 12px;">
                        <div style="padding: 10px 12px; background: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.5); border-radius: 6px; color: #fcd34d; font-size: 0.85rem; line-height: 1.4;">
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
                    <div class="editor-section-title">Advanced Settings</div>
                    
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
                    <div class="editor-section-title">Custom Tags</div>
                    
                    <div class="editor-field-group">
                        <div class="editor-setting-item flex-row">
                            <label>Tag Processed Items</label>
                            <label class="toggle-switch">
                                <input type="checkbox" id="editor-tag-processed" ${safeInstance.tag_processed_items ? 'checked' : ''}>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                        <p class="editor-help-text">Enable custom tagging for processed items</p>
                    </div>
                    
                    <div class="editor-field-group">
                        <div class="editor-setting-item">
                            <label>Missing Items Tag</label>
                            <input type="text" id="editor-tag-missing" value="${safeInstance.custom_tags.missing || 'huntarr-missing'}" placeholder="huntarr-missing">
                        </div>
                        <p class="editor-help-text">Custom tag for missing items (max 25 characters)</p>
                    </div>
                    
                    <div class="editor-field-group">
                        <div class="editor-setting-item">
                            <label>Upgrade Items Tag</label>
                            <input type="text" id="editor-tag-upgrade" value="${safeInstance.custom_tags.upgrade || 'huntarr-upgrade'}" placeholder="huntarr-upgrade">
                        </div>
                        <p class="editor-help-text">Custom tag for upgraded items (max 25 characters)</p>
                    </div>
                    
                    ${appType === 'sonarr' ? `
                    <div class="editor-field-group">
                        <div class="editor-setting-item">
                            <label>Shows Missing Tag</label>
                            <input type="text" id="editor-tag-shows-missing" value="${safeInstance.custom_tags.shows_missing || 'huntarr-shows-missing'}" placeholder="huntarr-shows-missing">
                        </div>
                        <p class="editor-help-text">Custom tag for missing items in shows mode (max 25 characters)</p>
                    </div>
                    ` : ''}
                </div>
                
                <div class="editor-section" style="border: 1px solid rgba(231, 76, 60, 0.3); border-radius: 10px; padding: 14px; background: rgba(231, 76, 60, 0.06);">
                    <div class="editor-section-title">Exempt Tags</div>
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
                                <span class="exempt-tag-chip" data-tag="${(tag || '').replace(/"/g, '&quot;')}" style="display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px; background: #dc2626; color: #fff; border-radius: 6px; font-size: 0.875rem;">
                                    <span class="exempt-tag-remove" style="cursor: pointer; opacity: 0.9;" title="Remove" aria-label="Remove">×</span>
                                    <span>${(tag || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span>
                                </span>
                            `).join('')}
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
  
        const newData = {
            enabled: document.getElementById('editor-enabled').value === 'true',
            name: document.getElementById('editor-name').value,
            api_url: document.getElementById('editor-url').value,
            api_key: document.getElementById('editor-key').value,
            state_management_mode: document.getElementById('editor-state-mode').value,
            state_management_hours: parseInt(document.getElementById('editor-state-hours').value) || 72,
            // Additional Options
            monitored_only: document.getElementById('editor-monitored-only').checked,
            tag_processed_items: document.getElementById('editor-tag-processed').checked,
            // Custom Tags
            custom_tags: {
                missing: document.getElementById('editor-tag-missing').value,
                upgrade: document.getElementById('editor-tag-upgrade').value
            },
            // Advanced Settings
            api_timeout: parseInt(document.getElementById('editor-api-timeout').value) || 120,
            command_wait_delay: parseInt(document.getElementById('editor-cmd-wait-delay').value) || 1,
            command_wait_attempts: (function(){ const el = document.getElementById('editor-cmd-wait-attempts'); if (!el) return 600; const v = parseInt(el.value, 10); return (!isNaN(v) && v >= 0) ? v : 600; })(),
            max_download_queue_size: parseInt(document.getElementById('editor-max-queue-size').value) || -1,
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
            const upgradeMethodEl = document.getElementById('editor-upgrade-method');
            const upgradeTagEl = document.getElementById('editor-upgrade-tag');
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
                 const upgradeMethodEl = document.getElementById('editor-upgrade-method');
                 const upgradeTagEl = document.getElementById('editor-upgrade-tag');
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
        
        this.saveAppSettings(appType, settings);
        
        // Update current editing state with new index (in case it was a new instance)
        this._currentEditing = { appType, index: finalIndex, originalInstance: JSON.parse(JSON.stringify(newData)) };
        _instanceEditorDirty = false;
        
        // Refresh state status if state management is enabled
        if (newData.state_management_mode !== 'disabled') {
            // Restart polling with updated index
            this.startStateStatusPolling(appType, finalIndex);
        } else {
            // Stop polling if state management is disabled
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
            return;
        }

        if (!this._currentEditing) {
            window.huntarrUI.switchSection('sonarr');
            this._currentEditing = null;
            _instanceEditorDirty = false;
            return;
        }
        const appType = this._currentEditing.appType;
        this._currentEditing = null;
        _instanceEditorDirty = false;
        if (appType === 'indexer') {
            window.huntarrUI.switchSection('settings-indexers');
        } else if (appType === 'client') {
            window.huntarrUI.switchSection('settings-clients');
        } else {
            window.huntarrUI.switchSection(appType);
        }
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
        
        if (!confirm(confirmMessage)) return;
        
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
        this.saveAppSettings(appType, settings, `Instance "${instanceName}" deleted successfully`);
        
        // Force a small delay then clear suppression
        setTimeout(() => {
            window._appsSuppressChangeDetection = false;
        }, 800);
    },

    });
})();
