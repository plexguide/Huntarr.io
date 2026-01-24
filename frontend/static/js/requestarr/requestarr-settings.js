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
        
        // Load cooldown settings
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
        
        // Load discover filters
        await this.loadDiscoverFilters();
        
        const saveBtn = document.getElementById('save-requestarr-settings');
        if (saveBtn) {
            saveBtn.onclick = () => this.saveSettings();
        }
        
        const saveFiltersBtn = document.getElementById('save-discover-filters');
        if (saveFiltersBtn) {
            saveFiltersBtn.onclick = () => this.saveDiscoverFilters();
        }
        
        const resetBtn = document.getElementById('reset-cooldowns-btn');
        if (resetBtn) {
            resetBtn.onclick = () => this.showResetCooldownsConfirmation();
        }
    }
    
    async loadDiscoverFilters() {
        // Load regions - Full TMDB region list
        const regionSelect = document.getElementById('discover-region');
        if (regionSelect) {
            // TMDB regions list (complete list from TMDB API)
            const regions = [
                { code: 'AR', name: 'Argentina', flag: '🇦🇷' },
                { code: 'AU', name: 'Australia', flag: '🇦🇺' },
                { code: 'AT', name: 'Austria', flag: '🇦🇹' },
                { code: 'BE', name: 'Belgium', flag: '🇧🇪' },
                { code: 'BR', name: 'Brazil', flag: '🇧🇷' },
                { code: 'CA', name: 'Canada', flag: '🇨🇦' },
                { code: 'CL', name: 'Chile', flag: '🇨🇱' },
                { code: 'CN', name: 'China', flag: '🇨🇳' },
                { code: 'CO', name: 'Colombia', flag: '🇨🇴' },
                { code: 'CZ', name: 'Czech Republic', flag: '🇨🇿' },
                { code: 'DK', name: 'Denmark', flag: '🇩🇰' },
                { code: 'FI', name: 'Finland', flag: '🇫🇮' },
                { code: 'FR', name: 'France', flag: '🇫🇷' },
                { code: 'DE', name: 'Germany', flag: '🇩🇪' },
                { code: 'GR', name: 'Greece', flag: '🇬🇷' },
                { code: 'HK', name: 'Hong Kong', flag: '🇭🇰' },
                { code: 'HU', name: 'Hungary', flag: '🇭🇺' },
                { code: 'IS', name: 'Iceland', flag: '🇮🇸' },
                { code: 'IN', name: 'India', flag: '🇮🇳' },
                { code: 'ID', name: 'Indonesia', flag: '🇮🇩' },
                { code: 'IE', name: 'Ireland', flag: '🇮🇪' },
                { code: 'IL', name: 'Israel', flag: '🇮🇱' },
                { code: 'IT', name: 'Italy', flag: '🇮🇹' },
                { code: 'JP', name: 'Japan', flag: '🇯🇵' },
                { code: 'KR', name: 'South Korea', flag: '🇰🇷' },
                { code: 'MY', name: 'Malaysia', flag: '🇲🇾' },
                { code: 'MX', name: 'Mexico', flag: '🇲🇽' },
                { code: 'NL', name: 'Netherlands', flag: '🇳🇱' },
                { code: 'NZ', name: 'New Zealand', flag: '🇳🇿' },
                { code: 'NO', name: 'Norway', flag: '🇳🇴' },
                { code: 'PH', name: 'Philippines', flag: '🇵🇭' },
                { code: 'PL', name: 'Poland', flag: '🇵🇱' },
                { code: 'PT', name: 'Portugal', flag: '🇵🇹' },
                { code: 'RO', name: 'Romania', flag: '🇷🇴' },
                { code: 'RU', name: 'Russia', flag: '🇷🇺' },
                { code: 'SA', name: 'Saudi Arabia', flag: '🇸🇦' },
                { code: 'SG', name: 'Singapore', flag: '🇸🇬' },
                { code: 'ZA', name: 'South Africa', flag: '🇿🇦' },
                { code: 'ES', name: 'Spain', flag: '🇪🇸' },
                { code: 'SE', name: 'Sweden', flag: '🇸🇪' },
                { code: 'CH', name: 'Switzerland', flag: '🇨🇭' },
                { code: 'TW', name: 'Taiwan', flag: '🇹🇼' },
                { code: 'TH', name: 'Thailand', flag: '🇹🇭' },
                { code: 'TR', name: 'Turkey', flag: '🇹🇷' },
                { code: 'UA', name: 'Ukraine', flag: '🇺🇦' },
                { code: 'AE', name: 'United Arab Emirates', flag: '🇦🇪' },
                { code: 'GB', name: 'United Kingdom', flag: '🇬🇧' },
                { code: 'US', name: 'United States', flag: '🇺🇸' }
            ];
            
            // Sort alphabetically by name
            regions.sort((a, b) => a.name.localeCompare(b.name));
            
            // Clear and rebuild select
            regionSelect.innerHTML = '';
            
            regions.forEach(region => {
                const option = document.createElement('option');
                option.value = region.code;
                option.textContent = `${region.flag} ${region.name}`;
                regionSelect.appendChild(option);
            });
        }
        
        // Initialize language multi-select
        this.initializeLanguageSelect();
        
        // Load saved filters
        try {
            const response = await fetch('./api/requestarr/settings/filters');
            const data = await response.json();
            
            if (data.success && data.filters) {
                if (regionSelect) {
                    // Set saved region or default to US
                    regionSelect.value = data.filters.region || 'US';
                }
                if (data.filters.languages && data.filters.languages.length > 0) {
                    this.selectedLanguages = data.filters.languages;
                    this.renderLanguageTags();
                }
            } else {
                // No saved filters - default to US
                if (regionSelect) {
                    regionSelect.value = 'US';
                }
            }
        } catch (error) {
            console.error('[RequestarrDiscover] Error loading discover filters:', error);
            // On error, default to US
            if (regionSelect) {
                regionSelect.value = 'US';
            }
        }
    }
    
    initializeLanguageSelect() {
        const input = document.getElementById('discover-language');
        const dropdown = document.getElementById('language-dropdown');
        const languageList = document.getElementById('language-list');
        const search = document.getElementById('language-search');
        
        if (!input || !dropdown || !languageList || !search) return;
        
        this.selectedLanguages = [];
        
        // Common languages list
        this.languages = [
            { code: 'en', name: 'English' },
            { code: 'es', name: 'Spanish' },
            { code: 'fr', name: 'French' },
            { code: 'de', name: 'German' },
            { code: 'it', name: 'Italian' },
            { code: 'pt', name: 'Portuguese' },
            { code: 'ja', name: 'Japanese' },
            { code: 'ko', name: 'Korean' },
            { code: 'zh', name: 'Chinese' },
            { code: 'ru', name: 'Russian' },
            { code: 'ar', name: 'Arabic' },
            { code: 'hi', name: 'Hindi' },
            { code: 'nl', name: 'Dutch' },
            { code: 'sv', name: 'Swedish' },
            { code: 'no', name: 'Norwegian' },
            { code: 'da', name: 'Danish' },
            { code: 'fi', name: 'Finnish' },
            { code: 'pl', name: 'Polish' },
            { code: 'tr', name: 'Turkish' },
            { code: 'th', name: 'Thai' }
        ];
        
        // Populate language list
        this.renderLanguageList();
        
        // Toggle dropdown
        input.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
        });
        
        // Search languages
        search.addEventListener('input', (e) => {
            this.renderLanguageList(e.target.value.toLowerCase());
        });
        
        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!dropdown.contains(e.target) && e.target !== input) {
                dropdown.style.display = 'none';
            }
        });
    }
    
    renderLanguageList(filter = '') {
        const languageList = document.getElementById('language-list');
        if (!languageList) return;
        
        const filteredLanguages = this.languages.filter(lang => 
            lang.name.toLowerCase().includes(filter)
        );
        
        languageList.innerHTML = '';
        
        filteredLanguages.forEach(lang => {
            const item = document.createElement('div');
            item.className = 'language-item';
            item.textContent = lang.name;
            item.dataset.code = lang.code;
            
            if (this.selectedLanguages.includes(lang.code)) {
                item.classList.add('selected');
            }
            
            item.addEventListener('click', () => {
                const code = item.dataset.code;
                const index = this.selectedLanguages.indexOf(code);
                
                if (index > -1) {
                    this.selectedLanguages.splice(index, 1);
                    item.classList.remove('selected');
                } else {
                    this.selectedLanguages.push(code);
                    item.classList.add('selected');
                }
                
                this.renderLanguageTags();
            });
            
            languageList.appendChild(item);
        });
    }
    
    renderLanguageTags() {
        const tagsContainer = document.getElementById('language-tags');
        if (!tagsContainer) return;
        
        tagsContainer.innerHTML = '';
        
        if (this.selectedLanguages.length === 0) {
            tagsContainer.innerHTML = '<span style="color: #888; font-size: 13px;">All Languages</span>';
            return;
        }
        
        this.selectedLanguages.forEach(code => {
            const lang = this.languages.find(l => l.code === code);
            if (!lang) return;
            
            const tag = document.createElement('div');
            tag.className = 'language-tag';
            tag.innerHTML = `
                ${lang.name}
                <span class="language-tag-remove" data-code="${code}">×</span>
            `;
            
            tag.querySelector('.language-tag-remove').addEventListener('click', (e) => {
                e.stopPropagation();
                const removeCode = e.target.dataset.code;
                this.selectedLanguages = this.selectedLanguages.filter(c => c !== removeCode);
                this.renderLanguageTags();
                this.renderLanguageList();
            });
            
            tagsContainer.appendChild(tag);
        });
    }
    
    async saveDiscoverFilters() {
        const regionSelect = document.getElementById('discover-region');
        const saveBtn = document.getElementById('save-discover-filters');
        
        if (!regionSelect) return;
        
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
        }
        
        try {
            const response = await fetch('./api/requestarr/settings/filters', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    region: regionSelect.value,
                    languages: this.selectedLanguages
                })
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.core.showNotification('Discover filters saved successfully!', 'success');
            } else {
                this.core.showNotification('Failed to save discover filters', 'error');
            }
        } catch (error) {
            console.error('[RequestarrDiscover] Error saving discover filters:', error);
            this.core.showNotification('Failed to save discover filters', 'error');
        } finally {
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.innerHTML = '<i class="fas fa-save"></i> Save Filters';
            }
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
