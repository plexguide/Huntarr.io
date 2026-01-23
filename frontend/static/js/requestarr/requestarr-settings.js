/**
 * Requestarr Settings - Settings and history management
 */

export class RequestarrSettings {
    constructor(core) {
        this.core = core;
    }

    // ========================================
    // HISTORY
    // ========================================

    async loadHistory() {
        const container = document.getElementById('history-list');
        container.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Loading history...</p></div>';
        
        try {
            const response = await fetch('./api/requestarr/history');
            const data = await response.json();
            
            if (data.requests && data.requests.length > 0) {
                container.innerHTML = '';
                data.requests.forEach(request => {
                    container.appendChild(this.createHistoryItem(request));
                });
            } else {
                container.innerHTML = '<p style="color: #888; text-align: center; padding: 60px;">No request history</p>';
            }
        } catch (error) {
            console.error('[RequestarrDiscover] Error loading history:', error);
            container.innerHTML = '<p style="color: #ef4444; text-align: center; padding: 60px;">Failed to load history</p>';
        }
    }

    createHistoryItem(request) {
        const item = document.createElement('div');
        item.className = 'history-item';
        
        const posterUrl = request.poster_path || './static/images/no-poster.png';
        const date = new Date(request.requested_at).toLocaleDateString();
        
        item.innerHTML = `
            <div class="history-poster">
                <img src="${posterUrl}" alt="${request.title}">
            </div>
            <div class="history-info">
                <div class="history-title">${request.title} (${request.year || 'N/A'})</div>
                <div class="history-meta">
                    Requested to ${request.app_type === 'radarr' ? 'Radarr' : 'Sonarr'} - ${request.instance_name} on ${date}
                </div>
                <span class="history-status">Requested</span>
            </div>
        `;
        
        return item;
    }

    // ========================================
    // SETTINGS
    // ========================================

    async loadSettings() {
        console.log('[RequestarrDiscover] Loading settings...');
        
        const sonarrSelect = document.getElementById('default-sonarr-instance');
        const radarrSelect = document.getElementById('default-radarr-instance');
        
        if (sonarrSelect && radarrSelect) {
            sonarrSelect.innerHTML = '<option value="">No Instance Configured</option>';
            this.core.instances.sonarr.forEach(instance => {
                const option = document.createElement('option');
                option.value = instance.name;
                option.textContent = `Sonarr - ${instance.name}`;
                sonarrSelect.appendChild(option);
            });
            
            radarrSelect.innerHTML = '<option value="">No Instance Configured</option>';
            this.core.instances.radarr.forEach(instance => {
                const option = document.createElement('option');
                option.value = instance.name;
                option.textContent = `Radarr - ${instance.name}`;
                radarrSelect.appendChild(option);
            });
            
            try {
                const response = await fetch('./api/requestarr/settings/defaults');
                const data = await response.json();
                
                let needsAutoSelect = false;
                
                if (data.success && data.defaults) {
                    if (data.defaults.sonarr_instance) {
                        sonarrSelect.value = data.defaults.sonarr_instance;
                    } else if (this.core.instances.sonarr.length > 0) {
                        sonarrSelect.value = this.core.instances.sonarr[0].name;
                        needsAutoSelect = true;
                    }
                    
                    if (data.defaults.radarr_instance) {
                        radarrSelect.value = data.defaults.radarr_instance;
                    } else if (this.core.instances.radarr.length > 0) {
                        radarrSelect.value = this.core.instances.radarr[0].name;
                        needsAutoSelect = true;
                    }
                } else {
                    if (this.core.instances.sonarr.length > 0) {
                        sonarrSelect.value = this.core.instances.sonarr[0].name;
                        needsAutoSelect = true;
                    }
                    if (this.core.instances.radarr.length > 0) {
                        radarrSelect.value = this.core.instances.radarr[0].name;
                        needsAutoSelect = true;
                    }
                }
                
                if (needsAutoSelect) {
                    console.log('[RequestarrDiscover] Auto-selecting first available instances');
                    await this.saveSettings(true);
                }
                
            } catch (error) {
                console.error('[RequestarrDiscover] Error loading default instances:', error);
                if (this.core.instances.sonarr.length > 0 && sonarrSelect.value === '') {
                    sonarrSelect.value = this.core.instances.sonarr[0].name;
                }
                if (this.core.instances.radarr.length > 0 && radarrSelect.value === '') {
                    radarrSelect.value = this.core.instances.radarr[0].name;
                }
            }
        }
        
        const saveBtn = document.getElementById('save-requestarr-settings');
        if (saveBtn) {
            saveBtn.onclick = () => this.saveSettings();
        }
    }

    async saveSettings(silent = false) {
        const sonarrSelect = document.getElementById('default-sonarr-instance');
        const radarrSelect = document.getElementById('default-radarr-instance');
        const saveBtn = document.getElementById('save-requestarr-settings');
        
        if (!sonarrSelect || !radarrSelect) return;
        
        if (saveBtn && !silent) {
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
        }
        
        try {
            const response = await fetch('./api/requestarr/settings/defaults', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sonarr_instance: sonarrSelect.value,
                    radarr_instance: radarrSelect.value
                })
            });
            
            const data = await response.json();
            
            if (data.success) {
                if (!silent) {
                    this.core.showNotification('Settings saved successfully!', 'success');
                }
            } else {
                if (!silent) {
                    this.core.showNotification('Failed to save settings', 'error');
                }
            }
        } catch (error) {
            console.error('[RequestarrDiscover] Error saving settings:', error);
            if (!silent) {
                this.core.showNotification('Failed to save settings', 'error');
            }
        } finally {
            if (saveBtn && !silent) {
                saveBtn.disabled = false;
                saveBtn.innerHTML = '<i class="fas fa-save"></i> Save Settings';
            }
        }
    }
}
