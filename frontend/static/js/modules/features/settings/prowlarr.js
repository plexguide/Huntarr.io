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
