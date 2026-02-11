/**
 * Requestarr Settings - Settings and history management
 */

export class RequestarrSettings {
    constructor(core) {
        this.core = core;
        this.hiddenMediaControlsInitialized = false;
        this.hiddenMediaItems = [];
        this.blacklistedTvGenres = [];
        this.blacklistedMovieGenres = [];
        this.tvGenresForBlacklist = [];
        this.movieGenresForBlacklist = [];
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
                // Use Promise.all to wait for all async createHistoryItem calls
                const items = await Promise.all(
                    data.requests.map(request => this.createHistoryItem(request))
                );
                items.forEach(item => container.appendChild(item));
            } else {
                container.innerHTML = '<p style="color: #888; text-align: center; padding: 60px;">No request history</p>';
            }
        } catch (error) {
            console.error('[RequestarrDiscover] Error loading history:', error);
            container.innerHTML = '<p style="color: #ef4444; text-align: center; padding: 60px;">Failed to load history</p>';
        }
    }

    async createHistoryItem(request) {
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
        
        // Load and cache image asynchronously
        if (posterUrl && !posterUrl.includes('./static/images/') && window.getCachedTMDBImage && window.tmdbImageCache) {
            try {
                const cachedUrl = await window.getCachedTMDBImage(posterUrl, window.tmdbImageCache);
                if (cachedUrl && cachedUrl !== posterUrl) {
                    const imgElement = item.querySelector('.history-poster img');
                    if (imgElement) imgElement.src = cachedUrl;
                }
            } catch (err) {
                console.error('[RequestarrSettings] Failed to cache history image:', err);
            }
        }
        
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

        // Ensure instance list is loaded before reading selection (fixes post-refresh race)
        const instanceSelect = document.getElementById('hidden-media-instance');
        if (instanceSelect && (!instanceSelect.options || instanceSelect.options.length <= 1)) {
            await this.loadHiddenMediaInstances();
        }

        // Sync state with dropdown value on initial load
        if (instanceSelect && !this.hiddenMediaState.instanceValue) {
            this.hiddenMediaState.instanceValue = instanceSelect.value || '';
        }

        // If still no instance selected but we have options, auto-select first instance so content can load
        if (!this.hiddenMediaState.instanceValue && instanceSelect && instanceSelect.options && instanceSelect.options.length > 1) {
            const firstRealOption = Array.from(instanceSelect.options).find(opt => opt.value && opt.value.includes('::'));
            if (firstRealOption) {
                firstRealOption.selected = true;
                this.hiddenMediaState.instanceValue = firstRealOption.value;
            }
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
            container.innerHTML = '<p style="color: #ef4444; text-align: center; padding: 60px;">Failed to load hidden media.</p>';
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
            const [movieHuntResponse, radarrResponse, sonarrResponse] = await Promise.all([
                fetch('./api/requestarr/instances/movie_hunt'),
                fetch('./api/requestarr/instances/radarr'),
                fetch('./api/requestarr/instances/sonarr')
            ]);

            const movieHuntData = await movieHuntResponse.json();
            const radarrData = await radarrResponse.json();
            const sonarrData = await sonarrResponse.json();

            const instanceOptions = [];

            // Movie Hunt instances first
            (movieHuntData.instances || []).forEach(instance => {
                if (instance && instance.name) {
                    instanceOptions.push({
                        value: `movie_hunt::${instance.name}`,
                        label: `Movie Hunt \u2013 ${instance.name}`
                    });
                }
            });

            (radarrData.instances || []).forEach(instance => {
                if (instance && instance.name) {
                    instanceOptions.push({
                        value: `radarr::${instance.name}`,
                        label: `Radarr \u2013 ${instance.name}`
                    });
                }
            });

            (sonarrData.instances || []).forEach(instance => {
                if (instance && instance.name) {
                    instanceOptions.push({
                        value: `sonarr::${instance.name}`,
                        label: `Sonarr \u2013 ${instance.name}`
                    });
                }
            });

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
            if (!response.ok) {
                throw new Error(`Hidden media API error: ${response.status}`);
            }
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
        
        // Update image from cache in background (non-blocking)
        if (posterUrl && !posterUrl.includes('./static/images/') && window.getCachedTMDBImage && window.tmdbImageCache) {
            const imgEl = card.querySelector('.media-card-poster img');
            if (imgEl) {
                window.getCachedTMDBImage(posterUrl, window.tmdbImageCache).then(cachedUrl => {
                    if (cachedUrl && cachedUrl !== posterUrl) imgEl.src = cachedUrl;
                }).catch(() => {});
            }
        }
        
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
        const self = this;
        const msg = `Unhide "${title}"?\n\nThis will make it visible in ${appType}/${instanceName} again.`;
        const doUnhide = async function() {
        try {
            const response = await fetch(`./api/requestarr/hidden-media/${tmdbId}/${mediaType}/${appType}/${instanceName}`, {
                method: 'DELETE'
            });

            if (!response.ok) {
                throw new Error('Failed to unhide media');
            }

            // Remove from local cache and re-render
            self.hiddenMediaItems = self.hiddenMediaItems.filter(item => {
                return !(item.tmdb_id === tmdbId &&
                    item.media_type === mediaType &&
                    item.app_type === appType &&
                    item.instance_name === instanceName);
            });
            self.renderHiddenMediaPage();

            console.log(`[RequestarrSettings] Unhidden media: ${title} (${mediaType})`);
        } catch (error) {
            console.error('[RequestarrSettings] Error unhiding media:', error);
            if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Failed to unhide media. Please try again.', 'error');
            else alert('Failed to unhide media. Please try again.');
        }
        };
        if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
            window.HuntarrConfirm.show({ title: 'Unhide Media', message: msg, confirmLabel: 'Unhide', onConfirm: function() { doUnhide(); } });
        } else {
            if (!confirm(msg)) return;
            doUnhide();
        }
    }

    // ========================================
    // SETTINGS
    // ========================================

    async loadSettings() {
        // Load discover filters
        await this.loadDiscoverFilters();
        
        // Load blacklisted genres and wire UI
        await this.loadBlacklistedGenres();
        
        // Legacy per-section save buttons (kept for backward compat if present)
        const saveFiltersBtn = document.getElementById('save-discover-filters');
        if (saveFiltersBtn) {
            saveFiltersBtn.onclick = () => this.saveDiscoverFilters();
        }
        
        const saveBlacklistedBtn = document.getElementById('save-blacklisted-genres-btn');
        if (saveBlacklistedBtn) {
            saveBlacklistedBtn.onclick = () => this.saveBlacklistedGenres();
        }

        // Unified toolbar save button
        const self = this;
        window._reqsetSaveAll = async function () {
            const btn = document.getElementById('reqset-save-all-btn');
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
            }
            try {
                await self.saveDiscoverFilters();
                await self.saveBlacklistedGenres();
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('All settings saved', 'success');
                }
            } catch (e) {
                console.error('[Requestarr Settings] Save all error:', e);
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('Error saving settings', 'error');
                }
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = '<i class="fas fa-save"></i> Save';
                }
            }
        };
    }
    
    async loadBlacklistedGenres() {
        const tvSelect = document.getElementById('blacklist-tv-genre-select');
        const movieSelect = document.getElementById('blacklist-movie-genre-select');
        if (!tvSelect || !movieSelect) return;
        try {
            const [tvRes, movieRes, blacklistedRes] = await Promise.all([
                fetch('./api/requestarr/genres/tv'),
                fetch('./api/requestarr/genres/movie'),
                fetch('./api/requestarr/settings/blacklisted-genres')
            ]);
            const tvData = await tvRes.json();
            const movieData = await movieRes.json();
            const blacklistedData = await blacklistedRes.json();
            this.tvGenresForBlacklist = tvData.genres || [];
            this.movieGenresForBlacklist = movieData.genres || [];
            const tvIds = (blacklistedData.blacklisted_tv_genres || []).map(id => parseInt(id, 10));
            const movieIds = (blacklistedData.blacklisted_movie_genres || []).map(id => parseInt(id, 10));
            this.blacklistedTvGenres = tvIds.map(id => {
                const g = this.tvGenresForBlacklist.find(x => x.id === id);
                return { id, name: (g && g.name) ? g.name : `Genre ${id}` };
            });
            this.blacklistedMovieGenres = movieIds.map(id => {
                const g = this.movieGenresForBlacklist.find(x => x.id === id);
                return { id, name: (g && g.name) ? g.name : `Genre ${id}` };
            });
            this.populateBlacklistedDropdowns();
            this.renderBlacklistedPills();
            tvSelect.onchange = () => {
                const val = tvSelect.value;
                if (!val) return;
                const id = parseInt(val, 10);
                const g = this.tvGenresForBlacklist.find(x => x.id === id);
                if (g && !this.blacklistedTvGenres.some(x => x.id === id)) {
                    this.blacklistedTvGenres.push({ id: g.id, name: g.name });
                    this.renderBlacklistedPills();
                    this.populateBlacklistedDropdowns();
                }
                tvSelect.value = '';
            };
            movieSelect.onchange = () => {
                const val = movieSelect.value;
                if (!val) return;
                const id = parseInt(val, 10);
                const g = this.movieGenresForBlacklist.find(x => x.id === id);
                if (g && !this.blacklistedMovieGenres.some(x => x.id === id)) {
                    this.blacklistedMovieGenres.push({ id: g.id, name: g.name });
                    this.renderBlacklistedPills();
                    this.populateBlacklistedDropdowns();
                }
                movieSelect.value = '';
            };
        } catch (error) {
            console.error('[RequestarrDiscover] Error loading blacklisted genres:', error);
        }
    }
    
    populateBlacklistedDropdowns() {
        const tvSelect = document.getElementById('blacklist-tv-genre-select');
        const movieSelect = document.getElementById('blacklist-movie-genre-select');
        if (!tvSelect || !movieSelect) return;
        const tvIds = this.blacklistedTvGenres.map(g => g.id);
        const movieIds = this.blacklistedMovieGenres.map(g => g.id);
        tvSelect.innerHTML = '<option value="">Select a genre to blacklist...</option>';
        this.tvGenresForBlacklist.filter(g => !tvIds.includes(g.id)).forEach(g => {
            const opt = document.createElement('option');
            opt.value = g.id;
            opt.textContent = g.name;
            tvSelect.appendChild(opt);
        });
        movieSelect.innerHTML = '<option value="">Select a genre to blacklist...</option>';
        this.movieGenresForBlacklist.filter(g => !movieIds.includes(g.id)).forEach(g => {
            const opt = document.createElement('option');
            opt.value = g.id;
            opt.textContent = g.name;
            movieSelect.appendChild(opt);
        });
    }
    
    renderBlacklistedPills() {
        const tvList = document.getElementById('blacklisted-tv-genres-list');
        const movieList = document.getElementById('blacklisted-movie-genres-list');
        if (!tvList || !movieList) return;
        tvList.innerHTML = '';
        this.blacklistedTvGenres.forEach(g => {
            const pill = document.createElement('span');
            pill.className = 'blacklisted-genre-pill';
            pill.innerHTML = `<span class="remove-pill" data-type="tv" data-id="${g.id}" aria-label="Remove">×</span><span>${g.name}</span>`;
            pill.querySelector('.remove-pill').onclick = () => {
                this.blacklistedTvGenres = this.blacklistedTvGenres.filter(x => x.id !== g.id);
                this.renderBlacklistedPills();
                this.populateBlacklistedDropdowns();
            };
            tvList.appendChild(pill);
        });
        movieList.innerHTML = '';
        this.blacklistedMovieGenres.forEach(g => {
            const pill = document.createElement('span');
            pill.className = 'blacklisted-genre-pill';
            pill.innerHTML = `<span class="remove-pill" data-type="movie" data-id="${g.id}" aria-label="Remove">×</span><span>${g.name}</span>`;
            pill.querySelector('.remove-pill').onclick = () => {
                this.blacklistedMovieGenres = this.blacklistedMovieGenres.filter(x => x.id !== g.id);
                this.renderBlacklistedPills();
                this.populateBlacklistedDropdowns();
            };
            movieList.appendChild(pill);
        });
    }
    
    async saveBlacklistedGenres() {
        const btn = document.getElementById('save-blacklisted-genres-btn');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
        }
        try {
            const response = await fetch('./api/requestarr/settings/blacklisted-genres', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    blacklisted_tv_genres: this.blacklistedTvGenres.map(g => g.id),
                    blacklisted_movie_genres: this.blacklistedMovieGenres.map(g => g.id)
                })
            });
            const data = await response.json();
            if (data.success) {
                this.core.showNotification('Blacklisted genres saved.', 'success');
            } else {
                this.core.showNotification('Failed to save blacklisted genres', 'error');
            }
        } catch (error) {
            console.error('[RequestarrDiscover] Error saving blacklisted genres:', error);
            this.core.showNotification('Failed to save blacklisted genres', 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-save"></i> Save Blacklisted Genres';
            }
        }
    }
    
    async loadDefaultInstances() {
        const { encodeInstanceValue, decodeInstanceValue } = await import('./requestarr-core.js');
        const movieSelect = document.getElementById('default-movie-instance');
        const tvSelect = document.getElementById('default-tv-instance');
        
        if (!movieSelect || !tvSelect) return;
        
        try {
            // Load Movie Hunt instances
            const movieHuntResponse = await fetch('./api/requestarr/instances/movie_hunt');
            const movieHuntData = await movieHuntResponse.json();
            
            // Load Radarr instances
            const radarrResponse = await fetch('./api/requestarr/instances/radarr');
            const radarrData = await radarrResponse.json();
            
            // Load Sonarr instances
            const sonarrResponse = await fetch('./api/requestarr/instances/sonarr');
            const sonarrData = await sonarrResponse.json();
            
            // Load saved defaults
            const defaultsResponse = await fetch('./api/requestarr/settings/default-instances');
            const defaultsData = await defaultsResponse.json();
            
            let needsAutoSave = false;
            
            // Build combined movie instances list: Movie Hunt first, then Radarr
            const movieHuntInstances = (movieHuntData.instances || []);
            const radarrInstances = (radarrData.instances || []);
            const allMovieInstances = [];
            
            // Add Movie Hunt instances at the top
            movieHuntInstances.forEach(inst => {
                allMovieInstances.push({
                    value: encodeInstanceValue('movie_hunt', inst.name),
                    label: `Movie Hunt - ${inst.name}`,
                    appType: 'movie_hunt',
                    name: inst.name
                });
            });
            
            // Add Radarr instances below
            radarrInstances.forEach(inst => {
                allMovieInstances.push({
                    value: encodeInstanceValue('radarr', inst.name),
                    label: `Radarr - ${inst.name}`,
                    appType: 'radarr',
                    name: inst.name
                });
            });
            
            // Populate movie instances dropdown
            if (allMovieInstances.length > 0) {
                movieSelect.innerHTML = '';
                allMovieInstances.forEach(inst => {
                    const option = document.createElement('option');
                    option.value = inst.value;
                    option.textContent = inst.label;
                    movieSelect.appendChild(option);
                });
                
                // Set selection: saved default or first instance (never leave blank)
                const savedMovie = defaultsData.success && defaultsData.defaults && defaultsData.defaults.movie_instance;
                if (savedMovie) {
                    // Check if the saved value exists in our dropdown options
                    // Support both new compound format and legacy plain name format
                    let foundMatch = false;
                    if (allMovieInstances.some(i => i.value === savedMovie)) {
                        movieSelect.value = savedMovie;
                        foundMatch = true;
                    } else {
                        // Backward compat: try matching legacy value (plain Radarr name without prefix)
                        const legacyMatch = allMovieInstances.find(i => i.appType === 'radarr' && i.name === savedMovie);
                        if (legacyMatch) {
                            movieSelect.value = legacyMatch.value;
                            foundMatch = true;
                            needsAutoSave = true; // Re-save in new format
                        }
                    }
                    if (!foundMatch) {
                        movieSelect.value = allMovieInstances[0].value;
                        needsAutoSave = true;
                    }
                } else {
                    movieSelect.value = allMovieInstances[0].value;
                    needsAutoSave = true;
                }
            } else {
                movieSelect.innerHTML = '<option value="">No movie instances configured</option>';
            }
            
            // Populate TV instances (Sonarr only - unchanged)
            if (sonarrData.instances && sonarrData.instances.length > 0) {
                tvSelect.innerHTML = '';
                sonarrData.instances.forEach(instance => {
                    const option = document.createElement('option');
                    option.value = instance.name;
                    option.textContent = `Sonarr - ${instance.name}`;
                    tvSelect.appendChild(option);
                });
                
                // Set selection: saved default or first instance (never leave blank)
                const savedTV = defaultsData.success && defaultsData.defaults && defaultsData.defaults.tv_instance;
                const tvExists = savedTV && sonarrData.instances.some(i => i.name === defaultsData.defaults.tv_instance);
                if (savedTV && tvExists) {
                    tvSelect.value = defaultsData.defaults.tv_instance;
                } else {
                    tvSelect.value = sonarrData.instances[0].name;
                    needsAutoSave = true;
                }
            } else {
                tvSelect.innerHTML = '<option value="">No Sonarr instances configured</option>';
            }
            
            // Ensure neither dropdown is ever blank when instances exist
            if (allMovieInstances.length > 0 && !movieSelect.value) {
                movieSelect.value = allMovieInstances[0].value;
                needsAutoSave = true;
            }
            if (sonarrData.instances && sonarrData.instances.length > 0 && !tvSelect.value) {
                tvSelect.value = sonarrData.instances[0].name;
                needsAutoSave = true;
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
                    await this.loadDefaultRootFolders();
                    await new Promise(resolve => setTimeout(resolve, 1000));
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

    /** Default root folders per app (issue #806) */
    async loadDefaultRootFolders() {
        const { decodeInstanceValue } = await import('./requestarr-core.js');
        const radarrSelect = document.getElementById('default-root-folder-radarr');
        const sonarrSelect = document.getElementById('default-root-folder-sonarr');
        const movieInstanceSelect = document.getElementById('default-movie-instance');
        const tvInstanceSelect = document.getElementById('default-tv-instance');
        if (!radarrSelect || !sonarrSelect) return;
        
        // Prevent concurrent calls (race condition protection)
        if (this._loadingRootFolders) {
            console.log('[RequestarrSettings] loadDefaultRootFolders already in progress, skipping');
            return;
        }
        this._loadingRootFolders = true;
        
        try {
            const defaultsRes = await fetch('./api/requestarr/settings/default-instances');
            const rootFoldersRes = await fetch('./api/requestarr/settings/default-root-folders');
            const defaultsData = await defaultsRes.json();
            const savedRootData = rootFoldersRes.ok ? await rootFoldersRes.json() : {};
            
            // Decode the movie instance compound value to get app type and name
            // Prioritize the current dropdown value (user may have just changed it) over saved default
            const movieInstanceRaw = (movieInstanceSelect && movieInstanceSelect.value) || (defaultsData.defaults && defaultsData.defaults.movie_instance) || '';
            const tvInstance = (tvInstanceSelect && tvInstanceSelect.value) || (defaultsData.defaults && defaultsData.defaults.tv_instance) || '';
            
            const movieDecoded = decodeInstanceValue(movieInstanceRaw);
            const movieAppType = movieDecoded.appType; // 'movie_hunt' or 'radarr'
            const movieInstanceName = movieDecoded.name;
            
            // Update the root folder label dynamically based on instance type
            const radarrLabel = document.querySelector('label[for="default-root-folder-radarr"]');
            if (radarrLabel) {
                radarrLabel.textContent = movieAppType === 'movie_hunt' ? 'Default Root Folder (Movie Hunt)' : 'Default Root Folder (Radarr)';
            }
            
            // Determine which saved path to use
            const savedMoviePath = movieAppType === 'movie_hunt' 
                ? (savedRootData.default_root_folder_movie_hunt || '').trim()
                : (savedRootData.default_root_folder_radarr || '').trim();
            const savedSonarrPath = (savedRootData.default_root_folder_sonarr || '').trim();
            
            const fallbackLabel = movieAppType === 'movie_hunt' ? 'Movie Hunt' : 'Radarr';

            // Movie root folders (from Radarr or Movie Hunt, depending on instance type)
            if (movieInstanceName) {
                const rfRes = await fetch(`./api/requestarr/rootfolders?app_type=${movieAppType}&instance_name=${encodeURIComponent(movieInstanceName)}`);
                const rfData = await rfRes.json();
                console.log(`[RequestarrSettings] ${fallbackLabel} API returned`, rfData.root_folders?.length || 0, 'root folders');
                if (rfData.success && rfData.root_folders && rfData.root_folders.length > 0) {
                    // Use Map to dedupe by normalized path, keeping first occurrence
                    const seenPaths = new Map();
                    rfData.root_folders.forEach(rf => {
                        if (!rf || !rf.path) return;
                        const originalPath = rf.path.trim();
                        const normalized = originalPath.replace(/\/+$/, '').toLowerCase();
                        if (!normalized) return;
                        if (!seenPaths.has(normalized)) {
                            seenPaths.set(normalized, {
                                path: originalPath,
                                freeSpace: rf.freeSpace
                            });
                        }
                    });
                    console.log(`[RequestarrSettings] After deduplication: ${seenPaths.size} unique ${fallbackLabel} root folders`);
                    
                    if (seenPaths.size === 0) {
                        radarrSelect.innerHTML = `<option value="">Use first root folder in ${fallbackLabel}</option>`;
                    } else {
                        radarrSelect.innerHTML = '';
                        seenPaths.forEach(rf => {
                            const opt = document.createElement('option');
                            opt.value = rf.path;
                            opt.textContent = rf.path + (rf.freeSpace != null ? ` (${Math.round(rf.freeSpace / 1e9)} GB free)` : '');
                            radarrSelect.appendChild(opt);
                        });
                        if (savedMoviePath) radarrSelect.value = savedMoviePath;
                    }
                } else {
                    radarrSelect.innerHTML = `<option value="">Use first root folder in ${fallbackLabel}</option>`;
                }
            } else {
                radarrSelect.innerHTML = `<option value="">Use first root folder in ${fallbackLabel}</option>`;
            }

            // Sonarr root folders with bulletproof deduplication (unchanged)
            if (tvInstance) {
                const sfRes = await fetch(`./api/requestarr/rootfolders?app_type=sonarr&instance_name=${encodeURIComponent(tvInstance)}`);
                const sfData = await sfRes.json();
                console.log('[RequestarrSettings] Sonarr API returned', sfData.root_folders?.length || 0, 'root folders');
                if (sfData.success && sfData.root_folders && sfData.root_folders.length > 0) {
                    const seenPaths = new Map();
                    sfData.root_folders.forEach(rf => {
                        if (!rf || !rf.path) return;
                        const originalPath = rf.path.trim();
                        const normalized = originalPath.replace(/\/+$/, '').toLowerCase();
                        if (!normalized) return;
                        if (!seenPaths.has(normalized)) {
                            seenPaths.set(normalized, {
                                path: originalPath,
                                freeSpace: rf.freeSpace
                            });
                        }
                    });
                    console.log('[RequestarrSettings] After deduplication:', seenPaths.size, 'unique Sonarr root folders');
                    
                    if (seenPaths.size === 0) {
                        sonarrSelect.innerHTML = '<option value="">Use first root folder in Sonarr</option>';
                    } else {
                        sonarrSelect.innerHTML = '';
                        seenPaths.forEach(rf => {
                            const opt = document.createElement('option');
                            opt.value = rf.path;
                            opt.textContent = rf.path + (rf.freeSpace != null ? ` (${Math.round(rf.freeSpace / 1e9)} GB free)` : '');
                            sonarrSelect.appendChild(opt);
                        });
                        if (savedSonarrPath) sonarrSelect.value = savedSonarrPath;
                    }
                } else {
                    sonarrSelect.innerHTML = '<option value="">Use first root folder in Sonarr</option>';
                }
            } else {
                sonarrSelect.innerHTML = '<option value="">Use first root folder in Sonarr</option>';
            }
        } catch (error) {
            console.error('[RequestarrSettings] Error loading default root folders:', error);
            radarrSelect.innerHTML = '<option value="">Use first root folder</option>';
            sonarrSelect.innerHTML = '<option value="">Use first root folder in Sonarr</option>';
        } finally {
            this._loadingRootFolders = false;
        }
    }

    async saveDefaultRootFolders() {
        const { decodeInstanceValue } = await import('./requestarr-core.js');
        const radarrSelect = document.getElementById('default-root-folder-radarr');
        const sonarrSelect = document.getElementById('default-root-folder-sonarr');
        const movieInstanceSelect = document.getElementById('default-movie-instance');
        const saveBtn = document.getElementById('save-default-root-folders');
        if (!radarrSelect || !sonarrSelect) return;
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
        }
        try {
            // Determine if the movie instance is Movie Hunt or Radarr
            const movieInstanceVal = movieInstanceSelect ? movieInstanceSelect.value : '';
            const movieDecoded = decodeInstanceValue(movieInstanceVal);
            
            const body = {
                default_root_folder_sonarr: sonarrSelect.value || ''
            };
            
            // Save the root folder path under the correct key based on instance type
            if (movieDecoded.appType === 'movie_hunt') {
                body.default_root_folder_movie_hunt = radarrSelect.value || '';
            } else {
                body.default_root_folder_radarr = radarrSelect.value || '';
            }
            
            const response = await fetch('./api/requestarr/settings/default-root-folders', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await response.json();
            if (data.success) {
                this.core.showNotification('Default root folders saved.', 'success');
            } else {
                this.core.showNotification('Failed to save default root folders', 'error');
            }
        } catch (error) {
            console.error('[RequestarrSettings] Error saving default root folders:', error);
            this.core.showNotification('Failed to save default root folders', 'error');
        } finally {
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.innerHTML = '<i class="fas fa-save"></i> Save Default Root Folders';
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

    // ========================================
    // SMART HUNT SETTINGS
    // ========================================

    async loadSmartHuntSettings() {
        try {
            const resp = await fetch('./api/requestarr/settings/smarthunt');
            const data = await resp.json();
            if (!data.success || !data.settings) return;
            const s = data.settings;

            // Populate toggles
            const hideLibEl = document.getElementById('smarthunt-hide-library');
            if (hideLibEl) hideLibEl.checked = s.hide_library_items !== false;

            // Populate cache TTL dropdown
            const cacheTtlEl = document.getElementById('smarthunt-cache-ttl');
            if (cacheTtlEl) cacheTtlEl.value = String(s.cache_ttl_minutes ?? 60);

            // Populate number fields
            const minRating = document.getElementById('smarthunt-min-rating');
            if (minRating) minRating.value = s.min_tmdb_rating ?? 6.0;
            const minVotes = document.getElementById('smarthunt-min-votes');
            if (minVotes) minVotes.value = s.min_vote_count ?? 50;
            const ys = document.getElementById('smarthunt-year-start');
            if (ys) ys.value = s.year_start ?? 2000;
            const ye = document.getElementById('smarthunt-year-end');
            if (ye) ye.value = s.year_end ?? (new Date().getFullYear() + 1);

            // Populate percentages
            const pcts = s.percentages || {};
            const cats = ['similar_library', 'trending', 'hidden_gems', 'new_releases', 'top_rated', 'genre_mix', 'upcoming', 'random'];
            cats.forEach(cat => {
                const el = document.getElementById(`smarthunt-pct-${cat}`);
                if (el) el.value = pcts[cat] ?? 0;
            });

            this._updateSmartHuntTotal();
            this._wireSmartHuntEvents();
        } catch (e) {
            console.error('[SmartHuntSettings] Error loading:', e);
        }
    }

    _wireSmartHuntEvents() {
        // Wire percentage inputs to update total
        if (this._smarthuntEventsWired) return;
        this._smarthuntEventsWired = true;

        document.querySelectorAll('.smarthunt-pct').forEach(input => {
            input.addEventListener('input', () => this._updateSmartHuntTotal());
        });

        // Save button
        const saveBtn = document.getElementById('smarthunt-save-btn');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => this.saveSmartHuntSettings());
        }
    }

    _updateSmartHuntTotal() {
        const cats = ['similar_library', 'trending', 'hidden_gems', 'new_releases', 'top_rated', 'genre_mix', 'upcoming', 'random'];
        let total = 0;
        cats.forEach(cat => {
            const el = document.getElementById(`smarthunt-pct-${cat}`);
            if (el) total += parseInt(el.value) || 0;
        });

        const totalEl = document.getElementById('smarthunt-total-value');
        const barEl = document.getElementById('smarthunt-total-bar');
        if (totalEl) totalEl.textContent = total;
        if (barEl) {
            barEl.classList.toggle('is-valid', total === 100);
            barEl.classList.toggle('is-invalid', total !== 100);
        }
    }

    async saveSmartHuntSettings() {
        const saveBtn = document.getElementById('smarthunt-save-btn');
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
        }

        try {
            const cats = ['similar_library', 'trending', 'hidden_gems', 'new_releases', 'top_rated', 'genre_mix', 'upcoming', 'random'];
            const percentages = {};
            let total = 0;
            cats.forEach(cat => {
                const el = document.getElementById(`smarthunt-pct-${cat}`);
                const val = parseInt(el?.value) || 0;
                percentages[cat] = val;
                total += val;
            });

            // Auto-adjust Random if total != 100
            if (total !== 100) {
                const diff = 100 - total + (percentages.random || 0);
                if (diff >= 0 && diff <= 100) {
                    percentages.random = diff;
                    const randomEl = document.getElementById('smarthunt-pct-random');
                    if (randomEl) randomEl.value = diff;
                } else {
                    // Proportionally scale all categories
                    const factor = 100 / (total || 1);
                    let runningTotal = 0;
                    cats.forEach((cat, i) => {
                        if (i < cats.length - 1) {
                            percentages[cat] = Math.round(percentages[cat] * factor);
                            runningTotal += percentages[cat];
                        } else {
                            percentages[cat] = 100 - runningTotal;
                        }
                    });
                    // Update UI
                    cats.forEach(cat => {
                        const el = document.getElementById(`smarthunt-pct-${cat}`);
                        if (el) el.value = percentages[cat];
                    });
                }
                this._updateSmartHuntTotal();
            }

            const settings = {
                enabled: true,  // Smart Hunt is always enabled
                cache_ttl_minutes: parseInt(document.getElementById('smarthunt-cache-ttl')?.value) || 60,
                hide_library_items: document.getElementById('smarthunt-hide-library')?.checked ?? true,
                min_tmdb_rating: parseFloat(document.getElementById('smarthunt-min-rating')?.value) || 6.0,
                min_vote_count: parseInt(document.getElementById('smarthunt-min-votes')?.value) || 0,
                year_start: parseInt(document.getElementById('smarthunt-year-start')?.value) || 2000,
                year_end: parseInt(document.getElementById('smarthunt-year-end')?.value) || (new Date().getFullYear() + 1),
                percentages: percentages,
            };

            const resp = await fetch('./api/requestarr/settings/smarthunt', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(settings),
            });
            const data = await resp.json();

            if (data.success) {
                this.core.showNotification('Smart Hunt settings saved successfully', 'success');
                // Invalidate frontend cache
                if (window.invalidateSmartHuntCache) window.invalidateSmartHuntCache();
            } else {
                this.core.showNotification('Failed to save Smart Hunt settings', 'error');
            }
        } catch (e) {
            console.error('[SmartHuntSettings] Error saving:', e);
            this.core.showNotification('Failed to save Smart Hunt settings', 'error');
        } finally {
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.innerHTML = '<i class="fas fa-save"></i> Save';
            }
        }
    }

}
