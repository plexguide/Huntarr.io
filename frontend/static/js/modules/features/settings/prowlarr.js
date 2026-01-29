(function() {
    window.SettingsForms = window.SettingsForms || {};

    window.SettingsForms.generateProwlarrForm = function(container, settings = {}) {
        if (!settings || typeof settings !== "object") {
            settings = {};
        }

        container.setAttribute("data-app-type", "prowlarr");

        let prowlarrHtml = `
            <div class="settings-group" style="
                background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%);
                border: 2px solid rgba(90, 109, 137, 0.3);
                border-radius: 12px;
                padding: 20px;
                margin: 15px 0 25px 0;
                box-shadow: 0 4px 12px rgba(90, 109, 137, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.1);
            ">
                <h3>Prowlarr Configuration</h3>
                <div class="instance-card-grid" id="prowlarr-instances-grid">
        `;

        const prowlarrInstance = {
            name: 'Prowlarr',
            api_url: settings.api_url || '',
            api_key: settings.api_key || '',
            enabled: settings.enabled !== false
        };

        prowlarrHtml += window.SettingsForms.renderInstanceCard('prowlarr', prowlarrInstance, 0);

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
                        
                        <div class="setting-item" style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 5px;">
                            <label style="color: #f8fafc; font-weight: 500; margin: 0;">Enabled</label>
                            <label class="toggle-switch" style="margin: 0;">
                                <input type="checkbox" id="editor-enabled" ${prowlarrInstance.enabled ? 'checked' : ''}>
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                        <p class="setting-help" style="margin: 0 0 20px 0; color: #94a3b8; font-size: 0.85rem;">Enable or disable Prowlarr integration</p>
                        
                        <div class="setting-item" style="margin-bottom: 20px;">
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
                const url = urlInput.value.trim();
                const key = keyInput.value.trim();
                
                const statusBadge = document.getElementById('prowlarr-connection-status');
                if (!statusBadge) return;
                
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
            
            // Test connection on input blur
            if (urlInput) urlInput.addEventListener('blur', testConnection);
            if (keyInput) keyInput.addEventListener('blur', testConnection);
            
            // Auto-test if both fields have values
            setTimeout(() => {
                if (urlInput.value.trim() && keyInput.value.trim()) {
                    testConnection();
                }
            }, 100);
        }

        // Setup button listeners
        const saveBtn = document.getElementById('instance-editor-save');
        const cancelBtn = document.getElementById('instance-editor-cancel');
        const backBtn = document.getElementById('instance-editor-back');

        if (saveBtn) {
            saveBtn.onclick = () => window.SettingsForms.saveProwlarrFromEditor();
        }
        if (cancelBtn) {
            cancelBtn.onclick = () => window.huntarrUI.switchSection('prowlarr');
        }
        if (backBtn) {
            backBtn.onclick = () => window.huntarrUI.switchSection('prowlarr');
        }

        // Switch to the editor section
        window.huntarrUI.switchSection('instance-editor');
    };

    window.SettingsForms.saveProwlarrFromEditor = function() {
        const settings = window.huntarrUI.originalSettings.prowlarr;
        
        settings.enabled = document.getElementById('editor-enabled').checked;
        settings.api_url = document.getElementById('editor-url').value;
        settings.api_key = document.getElementById('editor-key').value;

        window.SettingsForms.saveAppSettings('prowlarr', settings);
        window.huntarrUI.switchSection('prowlarr');
    };

})();
