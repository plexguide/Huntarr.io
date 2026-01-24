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
        
        const cooldownSelect = document.getElementById('cooldown-period');
        
        if (cooldownSelect) {
            try {
                const response = await fetch('./api/requestarr/settings/cooldown');
                const data = await response.json();
                
                if (data.success && data.cooldown_hours) {
                    cooldownSelect.value = data.cooldown_hours.toString();
                } else {
                    // Default to 7 days (168 hours)
                    cooldownSelect.value = '168';
                }
            } catch (error) {
                console.error('[RequestarrDiscover] Error loading cooldown settings:', error);
                cooldownSelect.value = '168'; // Default to 7 days
            }
        }
        
        const saveBtn = document.getElementById('save-requestarr-settings');
        if (saveBtn) {
            saveBtn.onclick = () => this.saveSettings();
        }
        
        const resetBtn = document.getElementById('reset-cooldowns-btn');
        if (resetBtn) {
            resetBtn.onclick = () => this.showResetCooldownsConfirmation();
        }
    }

    async saveSettings(silent = false) {
        const cooldownSelect = document.getElementById('cooldown-period');
        const saveBtn = document.getElementById('save-requestarr-settings');
        
        if (!cooldownSelect) return;
        
        if (saveBtn && !silent) {
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
        }
        
        try {
            const response = await fetch('./api/requestarr/settings/cooldown', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    cooldown_hours: parseInt(cooldownSelect.value)
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
    
    showResetCooldownsConfirmation() {
        // Create confirmation modal
        const modal = document.createElement('div');
        modal.className = 'confirmation-modal';
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.7);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
        `;
        
        modal.innerHTML = `
            <div style="
                background: #1e293b;
                padding: 30px;
                border-radius: 12px;
                max-width: 500px;
                box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
            ">
                <h3 style="margin: 0 0 15px 0; color: #fff; font-size: 20px;">
                    <i class="fas fa-exclamation-triangle" style="color: #f59e0b; margin-right: 10px;"></i>
                    Reset Cooldowns?
                </h3>
                <p style="color: #94a3b8; margin-bottom: 25px; line-height: 1.6;">
                    This will reset all cooldowns with <strong style="color: #fff;">25 hours or more</strong> remaining. 
                    Users will be able to immediately re-request these items.
                </p>
                <div style="display: flex; gap: 10px; justify-content: flex-end;">
                    <button id="cancel-reset-btn" style="
                        padding: 10px 20px;
                        background: #475569;
                        border: none;
                        border-radius: 6px;
                        color: #fff;
                        cursor: pointer;
                        font-size: 14px;
                    ">
                        Cancel
                    </button>
                    <button id="confirm-reset-btn" style="
                        padding: 10px 20px;
                        background: #ef4444;
                        border: none;
                        border-radius: 6px;
                        color: #fff;
                        cursor: pointer;
                        font-size: 14px;
                    ">
                        <i class="fas fa-undo"></i> Reset Cooldowns
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        document.getElementById('cancel-reset-btn').onclick = () => {
            document.body.removeChild(modal);
        };
        
        document.getElementById('confirm-reset-btn').onclick = async () => {
            await this.resetCooldowns();
            document.body.removeChild(modal);
        };
    }
    
    async resetCooldowns() {
        const resetBtn = document.getElementById('reset-cooldowns-btn');
        
        if (resetBtn) {
            resetBtn.disabled = true;
            resetBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Resetting...';
        }
        
        try {
            const response = await fetch('./api/requestarr/reset-cooldowns', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.core.showNotification(`Reset ${data.count} cooldown(s) successfully!`, 'success');
            } else {
                this.core.showNotification('Failed to reset cooldowns', 'error');
            }
        } catch (error) {
            console.error('[RequestarrDiscover] Error resetting cooldowns:', error);
            this.core.showNotification('Failed to reset cooldowns', 'error');
        } finally {
            if (resetBtn) {
                resetBtn.disabled = false;
                resetBtn.innerHTML = '<i class="fas fa-undo"></i> Reset All Cooldowns (25h+)';
            }
        }
    }
}
