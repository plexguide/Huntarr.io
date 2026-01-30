/**
 * Requestarr Settings - Settings and history management
 */

export class RequestarrSettings {
    constructor(core) {
        this.core = core;
        this.hiddenMediaControlsInitialized = false;
        this.hiddenMediaItems = [];
        this.hiddenMediaState = {
            mediaType: null,
            instanceValue: '',
            searchQuery: '',
            page: 1,
            pageSize: 20
        };
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
    // HIDDEN MEDIA
    // ========================================

    async loadHiddenMedia(mediaType = null, page = 1) {
        const container = document.getElementById('hidden-media-grid');
        if (!container) {
            return;
        }

        this.initializeHiddenMediaControls();

        const mediaTypeChanged = this.hiddenMediaState.mediaType !== mediaType;
        if (mediaTypeChanged) {
            this.hiddenMediaState.mediaType = mediaType;
            this.hiddenMediaState.page = 1;
        } else {
            this.hiddenMediaState.page = page;
        }

        // Sync state with dropdown value on initial load
        const instanceSelect = document.getElementById('hidden-media-instance');
        if (instanceSelect && !this.hiddenMediaState.instanceValue) {
            this.hiddenMediaState.instanceValue = instanceSelect.value || '';
        }

        // Show empty state if no instance selected
        if (!this.hiddenMediaState.instanceValue) {
            container.style.display = 'flex';
            container.style.alignItems = 'center';
            container.style.justifyContent = 'center';
            container.innerHTML = `
                <div style="text-align: center; color: #9ca3af; max-width: 600px;">
                    <i class="fas fa-eye-slash" style="font-size: 64px; margin-bottom: 30px; opacity: 0.4; display: block;"></i>
                    <p style="font-size: 20px; margin-bottom: 15px; font-weight: 500; white-space: nowrap;">No Instance Selected</p>
                    <p style="font-size: 15px; line-height: 1.6; opacity: 0.8;">Please select an instance from the dropdown above to view hidden media.</p>
                </div>
            `;
            return;
        }

        // Reset grid display for normal content
        container.style.display = 'grid';
        container.style.alignItems = '';
        container.style.justifyContent = '';

        container.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Loading hidden media...</p></div>';

        try {
            const instanceFilter = this.parseHiddenMediaInstanceValue(this.hiddenMediaState.instanceValue);
            const fetchKey = `${mediaType || 'all'}|${instanceFilter.appType || 'all'}|${instanceFilter.instanceName || 'all'}`;

            if (this.hiddenMediaFetchKey !== fetchKey) {
                this.hiddenMediaFetchKey = fetchKey;
                this.hiddenMediaItems = await this.fetchHiddenMediaItems(mediaType, instanceFilter);
            }

            this.renderHiddenMediaPage();
        } catch (error) {
            console.error('[RequestarrSettings] Error loading hidden media:', error);
            container.innerHTML = '<p style="color: #ef4444; text-align: center; padding: 60px;">Failed to load hidden media</p>';
        }
    }

    initializeHiddenMediaControls() {
        if (this.hiddenMediaControlsInitialized) {
            return;
        }

        const searchInput = document.getElementById('hidden-media-search');
        if (searchInput) {
            searchInput.addEventListener('input', (event) => {
                const value = event.target.value || '';
                clearTimeout(this.hiddenMediaSearchTimeout);
                this.hiddenMediaSearchTimeout = setTimeout(() => {
                    this.hiddenMediaState.searchQuery = value.trim();
                    this.hiddenMediaState.page = 1;
                    this.renderHiddenMediaPage();
                }, 200);
            });
        }

        const instanceSelect = document.getElementById('hidden-media-instance');
        if (instanceSelect) {
            instanceSelect.addEventListener('change', () => {
                this.hiddenMediaState.instanceValue = instanceSelect.value || '';
                this.hiddenMediaState.page = 1;
                this.hiddenMediaFetchKey = null;
                this.loadHiddenMedia(null, 1);
            });
        }

        this.loadHiddenMediaInstances();
        this.hiddenMediaControlsInitialized = true;
    }

    async loadHiddenMediaInstances() {
        const instanceSelect = document.getElementById('hidden-media-instance');
        if (!instanceSelect) {
            return;
        }

        try {
            const [radarrResponse, sonarrResponse] = await Promise.all([
                fetch('./api/requestarr/instances/radarr'),
                fetch('./api/requestarr/instances/sonarr')
            ]);

            const radarrData = await radarrResponse.json();
            const sonarrData = await sonarrResponse.json();

            const instanceOptions = [];

            (radarrData.instances || []).forEach(instance => {
                if (instance && instance.name) {
                    instanceOptions.push({
                        value: `radarr::${instance.name}`,
                        label: `Radarr - ${instance.name}`
                    });
                }
            });

            (sonarrData.instances || []).forEach(instance => {
                if (instance && instance.name) {
                    instanceOptions.push({
                        value: `sonarr::${instance.name}`,
                        label: `Sonarr - ${instance.name}`
                    });
                }
            });

            instanceOptions.sort((a, b) => a.label.localeCompare(b.label));

            instanceSelect.innerHTML = '';
            if (instanceOptions.length === 0) {
                const option = document.createElement('option');
                option.value = '';
                option.textContent = 'No Instances Exist';
                instanceSelect.appendChild(option);
            } else {
                // Add default "Select an Instance" option
                const defaultOption = document.createElement('option');
                defaultOption.value = '';
                defaultOption.textContent = 'Select an Instance';
                instanceSelect.appendChild(defaultOption);
                
                instanceOptions.forEach(optionData => {
                    const option = document.createElement('option');
                    option.value = optionData.value;
                    option.textContent = optionData.label;
                    instanceSelect.appendChild(option);
                });
            }
        } catch (error) {
            console.error('[RequestarrSettings] Error loading hidden media instances:', error);
            instanceSelect.innerHTML = '<option value="">No instances available</option>';
        }
    }

    parseHiddenMediaInstanceValue(value) {
        if (!value) {
            return { appType: null, instanceName: null };
        }
        const [appType, instanceName] = value.split('::');
        if (!appType || !instanceName) {
            return { appType: null, instanceName: null };
        }
        return { appType, instanceName };
    }

    async fetchHiddenMediaItems(mediaType, instanceFilter) {
        const allItems = [];
        const pageSize = 200;
        let currentPage = 1;
        let totalPages = 1;
        const maxPages = 50;

        while (currentPage <= totalPages && currentPage <= maxPages) {
            let url = `./api/requestarr/hidden-media?page=${currentPage}&page_size=${pageSize}`;
            if (mediaType) {
                url += `&media_type=${mediaType}`;
            }
            if (instanceFilter.appType && instanceFilter.instanceName) {
                url += `&app_type=${encodeURIComponent(instanceFilter.appType)}&instance_name=${encodeURIComponent(instanceFilter.instanceName)}`;
            }

            const response = await fetch(url);
            const data = await response.json();

            if (data.hidden_media && data.hidden_media.length > 0) {
                allItems.push(...data.hidden_media);
            }

            totalPages = data.total_pages || 1;
            currentPage += 1;
        }

        return allItems;
    }

    getFilteredHiddenMedia() {
        const query = (this.hiddenMediaState.searchQuery || '').toLowerCase();
        let filtered = this.hiddenMediaItems.slice();

        if (query) {
            filtered = filtered.filter(item => (item.title || '').toLowerCase().includes(query));
        }

        filtered.sort((a, b) => {
            const titleA = (a.title || '').toLowerCase();
            const titleB = (b.title || '').toLowerCase();
            return titleA.localeCompare(titleB);
        });

        return filtered;
    }

    renderHiddenMediaPage() {
        const container = document.getElementById('hidden-media-grid');
        const paginationContainer = document.getElementById('hidden-media-pagination');
        if (!container || !paginationContainer) {
            return;
        }

        const filtered = this.getFilteredHiddenMedia();
        const pageSize = this.hiddenMediaState.pageSize;
        const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));

        if (this.hiddenMediaState.page > totalPages) {
            this.hiddenMediaState.page = 1;
        }

        const startIndex = (this.hiddenMediaState.page - 1) * pageSize;
        const pageItems = filtered.slice(startIndex, startIndex + pageSize);

        if (pageItems.length > 0) {
            container.style.display = 'grid';
            container.style.alignItems = '';
            container.style.justifyContent = '';
            
            container.innerHTML = '';
            pageItems.forEach(item => {
                container.appendChild(this.createHiddenMediaCard(item));
            });

            if (totalPages > 1) {
                paginationContainer.style.display = 'flex';
                document.getElementById('hidden-page-info').textContent = `Page ${this.hiddenMediaState.page} of ${totalPages}`;
                document.getElementById('hidden-prev-page').disabled = this.hiddenMediaState.page === 1;
                document.getElementById('hidden-next-page').disabled = this.hiddenMediaState.page === totalPages;
            } else {
                paginationContainer.style.display = 'none';
            }
        } else {
            container.style.display = 'flex';
            container.style.alignItems = 'center';
            container.style.justifyContent = 'center';
            container.innerHTML = `
                <div style="text-align: center; color: #9ca3af; max-width: 600px;">
                    <i class="fas fa-inbox" style="font-size: 64px; margin-bottom: 30px; opacity: 0.4; display: block;"></i>
                    <p style="font-size: 20px; margin-bottom: 15px; font-weight: 500; white-space: nowrap;">No Hidden Media</p>
                    <p style="font-size: 15px; line-height: 1.6; opacity: 0.8;">There are no hidden items for this instance.</p>
                </div>
            `;
            paginationContainer.style.display = 'none';
        }

        this.setupHiddenMediaPagination(totalPages);
    }

    setupHiddenMediaPagination(totalPages) {
        const prevBtn = document.getElementById('hidden-prev-page');
        const nextBtn = document.getElementById('hidden-next-page');

        if (!prevBtn || !nextBtn) {
            return;
        }

        prevBtn.onclick = () => {
            if (this.hiddenMediaState.page > 1) {
                this.hiddenMediaState.page -= 1;
                this.renderHiddenMediaPage();
            }
        };

        nextBtn.onclick = () => {
            if (this.hiddenMediaState.page < totalPages) {
                this.hiddenMediaState.page += 1;
                this.renderHiddenMediaPage();
            }
        };
    }

    createHiddenMediaCard(item) {
        const card = document.createElement('div');
        card.className = 'media-card';
        card.setAttribute('data-tmdb-id', item.tmdb_id);
        card.setAttribute('data-media-type', item.media_type);
        
        const posterUrl = item.poster_path || './static/images/blackout.jpg';
        
        card.innerHTML = `
            <div class="media-card-poster">
                <button class="media-card-unhide-btn" title="Unhide this media">
                    <i class="fas fa-eye"></i>
                </button>
                <img src="${posterUrl}" alt="${item.title}" onerror="this.src='./static/images/blackout.jpg'">
            </div>
        `;
        
        const unhideBtn = card.querySelector('.media-card-unhide-btn');
        if (unhideBtn) {
            unhideBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                await this.unhideMedia(item.tmdb_id, item.media_type, item.app_type, item.instance_name, item.title, card);
            });
        }
        
        return card;
    }

    async unhideMedia(tmdbId, mediaType, appType, instanceName, title, cardElement) {
        try {
            const confirmed = confirm(`Unhide "${title}"?\n\nThis will make it visible in ${appType}/${instanceName} again.`);
            if (!confirmed) return;

            const response = await fetch(`./api/requestarr/hidden-media/${tmdbId}/${mediaType}/${appType}/${instanceName}`, {
                method: 'DELETE'
            });

            if (!response.ok) {
                throw new Error('Failed to unhide media');
            }

            // Remove from local cache and re-render
            this.hiddenMediaItems = this.hiddenMediaItems.filter(item => {
                return !(item.tmdb_id === tmdbId &&
                    item.media_type === mediaType &&
                    item.app_type === appType &&
                    item.instance_name === instanceName);
            });
            this.renderHiddenMediaPage();

            console.log(`[RequestarrSettings] Unhidden media: ${title} (${mediaType})`);
        } catch (error) {
            console.error('[RequestarrSettings] Error unhiding media:', error);
            alert('Failed to unhide media. Please try again.');
        }
    }

    // ========================================
    // SETTINGS
    // ========================================

    async loadSettings() {
        // Load cooldown settings
        const cooldownSelect = document.getElementById('cooldown-period');
        
        if (cooldownSelect) {
            try {
                const response = await fetch('./api/requestarr/settings/cooldown');
                const data = await response.json();
                
                if (data.success && data.cooldown_hours) {
                    cooldownSelect.value = data.cooldown_hours.toString();
                } else {
                    // Default to 1 day (24 hours)
                    cooldownSelect.value = '24';
                }
            } catch (error) {
                console.error('[RequestarrDiscover] Error loading cooldown settings:', error);
                cooldownSelect.value = '24'; // Default to 1 day
            }
        }
        
        // Load default instances
        await this.loadDefaultInstances();
        
        // Load discover filters
        await this.loadDiscoverFilters();
        
        const saveBtn = document.getElementById('save-requestarr-settings');
        if (saveBtn) {
            saveBtn.onclick = () => this.saveSettings();
        }
        
        const saveDefaultInstancesBtn = document.getElementById('save-default-instances');
        if (saveDefaultInstancesBtn) {
            saveDefaultInstancesBtn.onclick = () => this.saveDefaultInstances();
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
    
    async loadDefaultInstances() {
        const movieSelect = document.getElementById('default-movie-instance');
        const tvSelect = document.getElementById('default-tv-instance');
        
        if (!movieSelect || !tvSelect) return;
        
        try {
            // Load Radarr instances
            const radarrResponse = await fetch('./api/requestarr/instances/radarr');
            const radarrData = await radarrResponse.json();
            
            // Load Sonarr instances
            const sonarrResponse = await fetch('./api/requestarr/instances/sonarr');
            const sonarrData = await sonarrResponse.json();
            
            // Load saved defaults
            const defaultsResponse = await fetch('./api/requestarr/settings/default-instances');
            const defaultsData = await defaultsResponse.json();
            
            let movieInstanceToSave = null;
            let tvInstanceToSave = null;
            let needsAutoSave = false;
            
            // Populate movie instances
            if (radarrData.instances && radarrData.instances.length > 0) {
                movieSelect.innerHTML = '';
                radarrData.instances.forEach(instance => {
                    const option = document.createElement('option');
                    option.value = instance.name;
                    option.textContent = `Radarr - ${instance.name}`;
                    movieSelect.appendChild(option);
                });
                
                // Set selection: saved default or first instance
                if (defaultsData.success && defaultsData.defaults && defaultsData.defaults.movie_instance) {
                    movieSelect.value = defaultsData.defaults.movie_instance;
                } else {
                    // No default saved, auto-select first instance
                    movieSelect.value = radarrData.instances[0].name;
                    movieInstanceToSave = radarrData.instances[0].name;
                    needsAutoSave = true;
                }
            } else {
                // No instances available
                movieSelect.innerHTML = '<option value="">No Radarr instances configured</option>';
            }
            
            // Populate TV instances
            if (sonarrData.instances && sonarrData.instances.length > 0) {
                tvSelect.innerHTML = '';
                sonarrData.instances.forEach(instance => {
                    const option = document.createElement('option');
                    option.value = instance.name;
                    option.textContent = `Sonarr - ${instance.name}`;
                    tvSelect.appendChild(option);
                });
                
                // Set selection: saved default or first instance
                if (defaultsData.success && defaultsData.defaults && defaultsData.defaults.tv_instance) {
                    tvSelect.value = defaultsData.defaults.tv_instance;
                } else {
                    // No default saved, auto-select first instance
                    tvSelect.value = sonarrData.instances[0].name;
                    tvInstanceToSave = sonarrData.instances[0].name;
                    needsAutoSave = true;
                }
            } else {
                // No instances available
                tvSelect.innerHTML = '<option value="">No Sonarr instances configured</option>';
            }
            
            // Auto-save if we selected first instances
            if (needsAutoSave) {
                console.log('[RequestarrSettings] Auto-saving first available instances as defaults');
                await this.saveDefaultInstances(true); // Pass silent flag
            }
        } catch (error) {
            console.error('[RequestarrDiscover] Error loading default instances:', error);
        }
    }
    
    async saveDefaultInstances(silent = false) {
        const movieSelect = document.getElementById('default-movie-instance');
        const tvSelect = document.getElementById('default-tv-instance');
        const saveBtn = document.getElementById('save-default-instances');
        
        if (!movieSelect || !tvSelect) return;
        
        if (saveBtn && !silent) {
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
        }
        
        try {
            const response = await fetch('./api/requestarr/settings/default-instances', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    movie_instance: movieSelect.value || '',
                    tv_instance: tvSelect.value || ''
                })
            });
            
            const data = await response.json();
            
            if (data.success) {
                if (!silent) {
                    this.core.showNotification('Default instances saved! Reloading discovery content...', 'success');
                    
                    // Wait a bit longer to ensure database is fully updated
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    
                    // Reload discovery carousels with new instances
                    this.core.content.loadDiscoverContent();
                }
            } else {
                if (!silent) {
                    this.core.showNotification('Failed to save default instances', 'error');
                }
            }
        } catch (error) {
            console.error('[RequestarrDiscover] Error saving default instances:', error);
            if (!silent) {
                this.core.showNotification('Failed to save default instances', 'error');
            }
        } finally {
            if (saveBtn && !silent) {
                saveBtn.disabled = false;
                saveBtn.innerHTML = '<i class="fas fa-save"></i> Save Default Instances';
            }
        }
    }
    
    async loadDiscoverFilters() {
        // Load regions - Full TMDB region list
        const regions = [
            { code: '', name: 'All Regions', flag: '🌐' },
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
        
        // Keep All Regions at top, sort the rest alphabetically
        const allRegions = regions[0];
        const otherRegions = regions.slice(1).sort((a, b) => a.name.localeCompare(b.name));
        this.regions = [allRegions, ...otherRegions];
        
        this.selectedRegion = 'US'; // Default
        
        // Initialize custom region select
        this.initializeRegionSelect();
        
        // Initialize language multi-select
        this.initializeLanguageSelect();

        // Initialize provider multi-select
        this.initializeProviderSelect();
        
        // Load saved filters
        try {
            const response = await fetch('./api/requestarr/settings/filters');
            const data = await response.json();
            
            if (data.success && data.filters) {
                if (data.filters.region !== undefined) {
                    this.selectedRegion = data.filters.region;
                    this.updateRegionDisplay();
                }
                if (data.filters.languages && data.filters.languages.length > 0) {
                    this.selectedLanguages = data.filters.languages;
                } else {
                    this.selectedLanguages = [];
                }
                this.renderLanguageTags();
                if (data.filters.providers && data.filters.providers.length > 0) {
                    this.selectedProviders = data.filters.providers;
                } else {
                    this.selectedProviders = [];
                }
            } else {
                // No saved filters - default to US and All Languages
                this.selectedRegion = 'US';
                this.updateRegionDisplay();
                this.selectedLanguages = [];
                this.renderLanguageTags();
                this.selectedProviders = [];
            }
        } catch (error) {
            console.error('[RequestarrDiscover] Error loading discover filters:', error);
            // On error, default to US and All Languages
            this.selectedRegion = 'US';
            this.updateRegionDisplay();
            this.selectedLanguages = [];
            this.renderLanguageTags();
            this.selectedProviders = [];
        }

        await this.loadProviders(this.selectedRegion);
    }
    
    initializeRegionSelect() {
        const display = document.getElementById('region-select-display');
        const dropdown = document.getElementById('region-dropdown');
        const list = document.getElementById('region-list');
        
        if (!display || !dropdown || !list) {
            return;
        }
        
        // Check if already initialized
        if (this.regionSelectInitialized) {
            return;
        }
        
        // Populate region list first
        this.renderRegionList();
        
        // Toggle dropdown - Direct approach
        display.onclick = (e) => {
            e.stopPropagation();
            e.preventDefault();
            
            if (dropdown.style.display === 'none' || !dropdown.style.display) {
                dropdown.style.display = 'block';
                display.classList.add('open');
            } else {
                dropdown.style.display = 'none';
                display.classList.remove('open');
            }
        };
        
        // Prevent dropdown from closing when clicking inside it
        dropdown.onclick = (e) => {
            e.stopPropagation();
        };
        
        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!display.contains(e.target) && !dropdown.contains(e.target)) {
                dropdown.style.display = 'none';
                display.classList.remove('open');
            }
        });
        
        this.regionSelectInitialized = true;
    }
    
    renderRegionList(filter = '') {
        const list = document.getElementById('region-list');
        if (!list) return;
        
        const filteredRegions = this.regions.filter(region => 
            region.name.toLowerCase().includes(filter)
        );
        
        list.innerHTML = '';
        
        filteredRegions.forEach(region => {
            const option = document.createElement('div');
            option.className = 'custom-select-option';
            option.textContent = `${region.flag} ${region.name}`;
            option.dataset.code = region.code;
            
            if (this.selectedRegion === region.code) {
                option.classList.add('selected');
            }
            
            option.onclick = (e) => {
                e.stopPropagation();
                this.selectedRegion = region.code;
                this.updateRegionDisplay();
                this.renderRegionList(); // Re-render to update selected state
                document.getElementById('region-dropdown').style.display = 'none';
                document.getElementById('region-select-display').classList.remove('open');
                this.handleRegionChange();
            };
            
            list.appendChild(option);
        });
    }
    
    updateRegionDisplay() {
        const selectedText = document.getElementById('region-selected-text');
        if (!selectedText) return;
        
        const region = this.regions.find(r => r.code === this.selectedRegion);
        if (region) {
            selectedText.textContent = `${region.flag} ${region.name}`;
        }
    }
    
    initializeLanguageSelect() {
        const input = document.getElementById('discover-language');
        const dropdown = document.getElementById('language-dropdown');
        const languageList = document.getElementById('language-list');
        
        if (!input || !dropdown || !languageList) {
            return;
        }
        
        // Check if already initialized
        if (this.languageSelectInitialized) {
            return;
        }
        
        this.selectedLanguages = this.selectedLanguages || [];
        
        // Common languages list
        this.languages = [
            { code: 'ar', name: 'Arabic' },
            { code: 'zh', name: 'Chinese' },
            { code: 'da', name: 'Danish' },
            { code: 'nl', name: 'Dutch' },
            { code: 'en', name: 'English' },
            { code: 'fi', name: 'Finnish' },
            { code: 'fr', name: 'French' },
            { code: 'de', name: 'German' },
            { code: 'hi', name: 'Hindi' },
            { code: 'it', name: 'Italian' },
            { code: 'ja', name: 'Japanese' },
            { code: 'ko', name: 'Korean' },
            { code: 'no', name: 'Norwegian' },
            { code: 'pl', name: 'Polish' },
            { code: 'pt', name: 'Portuguese' },
            { code: 'ru', name: 'Russian' },
            { code: 'es', name: 'Spanish' },
            { code: 'sv', name: 'Swedish' },
            { code: 'th', name: 'Thai' },
            { code: 'tr', name: 'Turkish' }
        ];
        
        // Populate language list
        this.renderLanguageList();
        
        // Toggle dropdown
        input.onclick = (e) => {
            e.stopPropagation();
            const isVisible = dropdown.style.display === 'block';
            dropdown.style.display = isVisible ? 'none' : 'block';
        };
        
        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!dropdown.contains(e.target) && e.target !== input) {
                dropdown.style.display = 'none';
            }
        });
        
        this.languageSelectInitialized = true;
    }

    initializeProviderSelect() {
        const input = document.getElementById('discover-providers');
        const dropdown = document.getElementById('provider-dropdown');
        const providerList = document.getElementById('provider-list');

        if (!input || !dropdown || !providerList) {
            return;
        }

        if (this.providerSelectInitialized) {
            return;
        }

        this.selectedProviders = this.selectedProviders || [];
        this.providers = this.providers || [];

        this.renderProviderList();
        this.renderProviderTags();

        input.onclick = (e) => {
            e.stopPropagation();
            const isVisible = dropdown.style.display === 'block';
            dropdown.style.display = isVisible ? 'none' : 'block';
        };

        document.addEventListener('click', (e) => {
            if (!dropdown.contains(e.target) && e.target !== input) {
                dropdown.style.display = 'none';
            }
        });

        this.providerSelectInitialized = true;
    }
    
    renderLanguageList(filter = '') {
        const languageList = document.getElementById('language-list');
        if (!languageList) return;
        
        languageList.innerHTML = '';

        const normalizedFilter = filter.trim().toLowerCase();
        const showAllLanguages = !normalizedFilter || 'all languages'.includes(normalizedFilter);
        if (showAllLanguages) {
            const allItem = document.createElement('div');
            allItem.className = 'language-item';
            allItem.textContent = 'All Languages';
            allItem.dataset.code = '';

            if (this.selectedLanguages.length === 0) {
                allItem.classList.add('selected');
            }

            allItem.addEventListener('click', () => {
                this.selectedLanguages = [];
                this.renderLanguageTags();
                this.renderLanguageList(filter);

                const dropdown = document.getElementById('language-dropdown');
                if (dropdown) {
                    dropdown.style.display = 'none';
                }
            });

            languageList.appendChild(allItem);
        }

        this.languages.forEach(lang => {
            if (normalizedFilter && !lang.name.toLowerCase().includes(normalizedFilter)) {
                return;
            }
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
                
                // Close dropdown after selection
                const dropdown = document.getElementById('language-dropdown');
                if (dropdown) {
                    dropdown.style.display = 'none';
                }
            });
            
            languageList.appendChild(item);
        });
    }
    
    renderLanguageTags() {
        const tagsContainer = document.getElementById('language-tags');
        if (!tagsContainer) return;
        
        tagsContainer.innerHTML = '';
        
        if (this.selectedLanguages.length === 0) {
            // Show "All Languages" as a tag/bubble instead of plain text
            const tag = document.createElement('div');
            tag.className = 'language-tag';
            tag.innerHTML = 'All Languages';
            tag.style.cursor = 'default'; // No remove action for "All Languages"
            tagsContainer.appendChild(tag);
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

    async loadProviders(region) {
        try {
            const response = await fetch(`./api/requestarr/watch-providers/movie?region=${encodeURIComponent(region || '')}`);
            const data = await response.json();
            this.providers = data.providers || [];
            const available = new Set(this.providers.map(provider => String(provider.provider_id)));
            this.selectedProviders = (this.selectedProviders || []).filter(code => available.has(code));
        } catch (error) {
            console.error('[RequestarrDiscover] Error loading watch providers:', error);
            this.providers = [];
        }

        this.renderProviderList();
        this.renderProviderTags();
    }

    renderProviderList() {
        const providerList = document.getElementById('provider-list');
        if (!providerList) return;

        providerList.innerHTML = '';

        if (!this.providers || this.providers.length === 0) {
            providerList.innerHTML = '<div class="language-item" style="color: #888;">No providers found</div>';
            return;
        }

        this.providers.forEach(provider => {
            const providerId = String(provider.provider_id);
            const item = document.createElement('div');
            item.className = 'language-item';
            item.textContent = provider.provider_name;
            item.dataset.code = providerId;

            if (this.selectedProviders.includes(providerId)) {
                item.classList.add('selected');
            }

            item.addEventListener('click', () => {
                const code = item.dataset.code;
                const index = this.selectedProviders.indexOf(code);

                if (index > -1) {
                    this.selectedProviders.splice(index, 1);
                    item.classList.remove('selected');
                } else {
                    this.selectedProviders.push(code);
                    item.classList.add('selected');
                }

                this.renderProviderTags();

                const dropdown = document.getElementById('provider-dropdown');
                if (dropdown) {
                    dropdown.style.display = 'none';
                }
            });

            providerList.appendChild(item);
        });
    }

    renderProviderTags() {
        const tagsContainer = document.getElementById('provider-tags');
        if (!tagsContainer) return;

        tagsContainer.innerHTML = '';

        if (!this.selectedProviders || this.selectedProviders.length === 0) {
            // Show "All Providers" as a tag/bubble instead of plain text
            const tag = document.createElement('div');
            tag.className = 'language-tag';
            tag.innerHTML = 'All Providers';
            tag.style.cursor = 'default'; // No remove action for "All Providers"
            tagsContainer.appendChild(tag);
            return;
        }

        this.selectedProviders.forEach(code => {
            const provider = (this.providers || []).find(p => String(p.provider_id) === code);
            if (!provider) return;

            const tag = document.createElement('div');
            tag.className = 'language-tag';
            tag.innerHTML = `
                ${provider.provider_name}
                <span class="language-tag-remove" data-code="${code}">×</span>
            `;

            tag.querySelector('.language-tag-remove').addEventListener('click', (e) => {
                e.stopPropagation();
                const removeCode = e.target.dataset.code;
                this.selectedProviders = this.selectedProviders.filter(c => c !== removeCode);
                this.renderProviderTags();
                this.renderProviderList();
            });

            tagsContainer.appendChild(tag);
        });
    }

    handleRegionChange() {
        this.selectedProviders = [];
        this.renderProviderTags();
        this.renderProviderList();
        this.loadProviders(this.selectedRegion);
    }
    
    async saveDiscoverFilters() {
        const saveBtn = document.getElementById('save-discover-filters');
        
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
        }
        
        try {
            const response = await fetch('./api/requestarr/settings/filters', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    region: this.selectedRegion || '',
                    languages: this.selectedLanguages || [],
                    providers: this.selectedProviders || []
                })
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.core.showNotification('Filters saved! Reloading discover content...', 'success');
                
                // Reload all discover content with new filters
                setTimeout(() => {
                    this.core.content.loadDiscoverContent();
                }, 500);
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
