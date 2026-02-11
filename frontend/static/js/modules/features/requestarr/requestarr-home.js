/**
 * Requestarr Home - Trending + global search for Home section
 */

const HomeRequestarr = {
    core: null,
    searchTimeout: null,
    elements: {},
    defaultMovieInstance: null,
    defaultTVInstance: null,
    showTrending: true,
    enableRequestarr: true,

    // Delay before showing "Failed to load" so transient failures don't flash (ms)
    FAILED_MESSAGE_DELAY: 800,

    // Discovery result cache: 24 hours so rotation and Requestarr page feel instant
    DISCOVERY_CACHE_TTL_MS: 24 * 60 * 60 * 1000,
    DISCOVERY_CACHE_KEYS: { trending: 'huntarr-home-discovery-trending', movies: 'huntarr-home-discovery-movies', tv: 'huntarr-home-discovery-tv' },

    // Section rotation
    sections: ['trending', 'movies', 'tv'],
    currentSection: null,
    ROTATION_KEY: 'home_section_rotation',

    // Pending error timeouts - cleared when a new load starts so we don't show error after success
    _pendingErrorTimeout: null,

    // Helpers to encode/decode compound instance values (movie_hunt:Name or radarr:Name)
    _encodeInstance(appType, name) { return `${appType}:${name}`; },
    _decodeInstance(compound) {
        if (!compound || !compound.includes(':')) return { appType: 'radarr', name: compound || '' };
        const idx = compound.indexOf(':');
        return { appType: compound.substring(0, idx), name: compound.substring(idx + 1) };
    },

    init() {
        this.cacheElements();

        if (!this.elements.searchInput) {
            return;
        }

        // Make this module globally accessible for auto-save visibility updates
        window.HomeRequestarr = this;

        // Auto-refresh dropdowns when any instance is added/deleted/renamed anywhere in the app
        document.addEventListener('huntarr:instances-changed', () => {
            this._populateInstanceDropdowns();
        });

        // Hide discovery sections until showSection() runs so we never flash initial or stale content
        if (this.elements.trendingSection) this.elements.trendingSection.style.display = 'none';
        if (this.elements.moviesSection) this.elements.moviesSection.style.display = 'none';
        if (this.elements.tvSection) this.elements.tvSection.style.display = 'none';

        // Force hide initially if we can't determine setting yet
        if (this.elements.discoverView) {
            this.elements.discoverView.style.setProperty('display', 'none', 'important');
        }

        // Load settings first to determine if Requestarr/trending should be shown
        this.loadSettings()
            .then(() => {
                this.applyRequestarrEnabledVisibility();

                if (!this.enableRequestarr) {
                    this.setupSearch(); // no-op for API when disabled; just prevent errors
                    return;
                }

                this.applyTrendingVisibility();

                if (!this.showTrending) {
                    this.setupSearch();
                    return;
                }

                this.waitForCore()
                    .then((core) => {
                        this.core = core;
                        this.setupSearch();
                        this.loadDefaultInstances().then(() => {
                            // Determine which section to show
                            const sectionToShow = this.getNextSection();
                            this.showSection(sectionToShow);
                            this.saveSection(sectionToShow);
                        });
                    })
                    .catch(() => {
                        // Don't show error here - keep loading state so we don't flash "Failed" before real load.
                        // showSection will have set loading spinner; if core never loads, user still sees loading.
                        console.warn('[HomeRequestarr] Requestarr modules not ready within timeout');
                    });
            });
    },

    async loadSettings() {
        try {
            const response = await fetch('./api/settings');
            const data = await response.json();
            if (data && data.general) {
                this.enableRequestarr = true; // Always enabled (required for Movie Hunt)
                this.showTrending = data.general.show_trending !== false;
                console.log('[HomeRequestarr] Enable Requestarr:', this.enableRequestarr, 'Show trending:', this.showTrending);
            }
        } catch (error) {
            console.error('[HomeRequestarr] Error loading settings:', error);
            this.enableRequestarr = true; // Always enabled (required for Movie Hunt)
            this.showTrending = true;
        }
    },

    /** Hide/show the whole Requestarr home card (search + trending) based on enable_requestarr */
    applyRequestarrEnabledVisibility() {
        const card = document.querySelector('.requestarr-home-card');
        if (card) {
            card.style.display = this.enableRequestarr ? '' : 'none';
        }
    },

    applyTrendingVisibility() {
        const discoverView = this.elements.discoverView;
        if (discoverView) {
            console.log('[HomeRequestarr] Applying visibility to discoverView:', this.showTrending);
            if (this.showTrending) {
                discoverView.style.setProperty('display', 'block', 'important');
                // Do not load here - wait for waitForCore() then showSection() will load.
                // Loading before core is ready can show "Failed to load" briefly then succeed.
            } else {
                discoverView.style.setProperty('display', 'none', 'important');
            }
        } else {
            console.warn('[HomeRequestarr] discoverView element not found in applyTrendingVisibility');
        }
    },

    cacheElements() {
        this.elements.searchInput = document.getElementById('home-requestarr-search-input');
        this.elements.searchResultsView = document.getElementById('home-search-results-view');
        this.elements.searchResultsGrid = document.getElementById('home-search-results-grid');
        this.elements.discoverView = document.getElementById('home-requestarr-discover-view');
        this.elements.trendingCarousel = document.getElementById('home-trending-carousel');
        this.elements.moviesCarousel = document.getElementById('home-movies-carousel');
        this.elements.tvCarousel = document.getElementById('home-tv-carousel');
        this.elements.trendingSection = document.getElementById('home-trending-section');
        this.elements.moviesSection = document.getElementById('home-movies-section');
        this.elements.tvSection = document.getElementById('home-tv-section');
        this.elements.instanceControls = document.getElementById('home-instance-controls');
        this.elements.movieInstanceSelect = document.getElementById('home-movie-instance-select');
        this.elements.tvInstanceSelect = document.getElementById('home-tv-instance-select');
    },
    
    getLastSection() {
        try {
            const data = localStorage.getItem(this.ROTATION_KEY);
            if (data) {
                const { section } = JSON.parse(data);
                return section;
            }
        } catch (e) {
            console.error('[HomeRequestarr] Error reading last section:', e);
        }
        return null;
    },
    
    getNextSection() {
        const lastSection = this.getLastSection();
        
        if (!lastSection || !this.sections.includes(lastSection)) {
            return 'trending';
        }
        
        const currentIndex = this.sections.indexOf(lastSection);
        const nextIndex = (currentIndex + 1) % this.sections.length;
        return this.sections[nextIndex];
    },
    
    saveSection(section) {
        try {
            const data = {
                section: section,
                timestamp: Date.now()
            };
            localStorage.setItem(this.ROTATION_KEY, JSON.stringify(data));
        } catch (e) {
            console.error('[HomeRequestarr] Error saving section:', e);
        }
    },
    
    showSection(section) {
        console.log('[HomeRequestarr] Showing section:', section);
        this.currentSection = section;
        
        // Hide all sections
        if (this.elements.trendingSection) this.elements.trendingSection.style.display = 'none';
        if (this.elements.moviesSection) this.elements.moviesSection.style.display = 'none';
        if (this.elements.tvSection) this.elements.tvSection.style.display = 'none';
        
        // Show selected section and set loading state first so we never show stale "Failed to load"
        switch (section) {
            case 'trending':
                if (this.elements.trendingSection) {
                    this.elements.trendingSection.style.display = 'block';
                    this.setCarouselLoading('trending');
                    this.loadTrending();
                }
                break;
            case 'movies':
                if (this.elements.moviesSection) {
                    this.elements.moviesSection.style.display = 'block';
                    this.setCarouselLoading('movies');
                    this.loadPopularMovies();
                }
                break;
            case 'tv':
                if (this.elements.tvSection) {
                    this.elements.tvSection.style.display = 'block';
                    this.setCarouselLoading('tv');
                    this.loadPopularTV();
                }
                break;
        }
        // Preload the other two sections in the background (fetch + cache only, no UI)
        this.preloadOtherDiscoverySections(section);
    },

    /** Fetch and cache the two non-visible discovery sections in the background for faster rotation and Requestarr page */
    preloadOtherDiscoverySections(visibleSection) {
        if (!this.enableRequestarr || !this.core) return;
        if (visibleSection !== 'trending') this.fetchAndCacheTrending();
        if (visibleSection !== 'movies') this.fetchAndCachePopularMovies();
        if (visibleSection !== 'tv') this.fetchAndCachePopularTV();
    },

    /** Show loading spinner in the given carousel so we never flash stale "Failed to load" when entering section */
    setCarouselLoading(section) {
        const loadingHtml = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Loading...</p></div>';
        if (section === 'trending' && this.elements.trendingCarousel) {
            this.elements.trendingCarousel.innerHTML = loadingHtml.replace('Loading...</p>', 'Loading trending content...</p>');
        } else if (section === 'movies' && this.elements.moviesCarousel) {
            this.elements.moviesCarousel.innerHTML = loadingHtml.replace('Loading...</p>', 'Loading movies...</p>');
        } else if (section === 'tv' && this.elements.tvCarousel) {
            this.elements.tvCarousel.innerHTML = loadingHtml.replace('Loading...</p>', 'Loading TV shows...</p>');
        }
    },

    waitForCore() {
        return new Promise((resolve, reject) => {
            if (window.RequestarrDiscover) {
                resolve(window.RequestarrDiscover);
                return;
            }

            const startTime = Date.now();
            const checkInterval = setInterval(() => {
                if (window.RequestarrDiscover) {
                    clearInterval(checkInterval);
                    resolve(window.RequestarrDiscover);
                    return;
                }

                if (Date.now() - startTime > 2000) {
                    clearInterval(checkInterval);
                    reject(new Error('RequestarrDiscover not ready'));
                }
            }, 50);
        });
    },

    async loadDefaultInstances() {
        try {
            const settingsResponse = await fetch('./api/requestarr/settings/default-instances');
            const settingsData = await settingsResponse.json();
            if (settingsData.success && settingsData.defaults) {
                this.defaultMovieInstance = settingsData.defaults.movie_instance || null;
                this.defaultTVInstance = settingsData.defaults.tv_instance || null;
                console.log('[HomeRequestarr] Loaded default instances:', {
                    movie: this.defaultMovieInstance,
                    tv: this.defaultTVInstance
                });
            }
        } catch (error) {
            console.error('[HomeRequestarr] Error loading default instances:', error);
            this.defaultMovieInstance = null;
            this.defaultTVInstance = null;
        }
        // Populate the dropdowns after loading defaults
        await this._populateInstanceDropdowns();
    },

    /** Populate both movie and TV instance dropdown selectors on the Home page */
    async _populateInstanceDropdowns() {
        await Promise.all([
            this._populateMovieInstanceDropdown(),
            this._populateTVInstanceDropdown()
        ]);
        // Show the controls row once populated
        if (this.elements.instanceControls) {
            this.elements.instanceControls.style.display = 'flex';
        }
    },

    async _populateMovieInstanceDropdown() {
        const select = this.elements.movieInstanceSelect;
        if (!select) return;
        try {
            const _ts = Date.now();
            const [mhResponse, radarrResponse] = await Promise.all([
                fetch(`./api/requestarr/instances/movie_hunt?t=${_ts}`, { cache: 'no-store' }),
                fetch(`./api/requestarr/instances/radarr?t=${_ts}`, { cache: 'no-store' })
            ]);
            const mhData = await mhResponse.json();
            const radarrData = await radarrResponse.json();

            const allInstances = [
                ...(mhData.instances || []).map(inst => ({
                    name: String(inst.name).trim(), appType: 'movie_hunt',
                    label: `Movie Hunt \u2013 ${String(inst.name).trim()}`
                })),
                ...(radarrData.instances || []).map(inst => ({
                    name: String(inst.name).trim(), appType: 'radarr',
                    label: `Radarr \u2013 ${String(inst.name).trim()}`
                }))
            ];

            // Preserve current selection before clearing (prefer in-memory default, fall back to DOM value)
            const previousValue = this.defaultMovieInstance || select.value || '';

            select.innerHTML = '';
            if (allInstances.length === 0) {
                select.innerHTML = '<option value="">No movie instances</option>';
                return;
            }

            allInstances.forEach(inst => {
                const cv = this._encodeInstance(inst.appType, inst.name);
                const opt = document.createElement('option');
                opt.value = cv;
                opt.textContent = inst.label;
                if (previousValue && (cv === previousValue || inst.name === previousValue)) opt.selected = true;
                select.appendChild(opt);
            });

            // Update in-memory default to match what's actually selected
            if (select.value) {
                this.defaultMovieInstance = select.value;
            }

            // Only attach change listener once (guard against duplicate listeners on refresh)
            if (!select._homeChangeWired) {
                select._homeChangeWired = true;
                select.addEventListener('change', async () => {
                    this.defaultMovieInstance = select.value;
                    // Clear caches so status badges refresh
                    this._clearCache('trending');
                    this._clearCache('movies');
                    await this._saveServerDefaults();
                    // Sync with Requestarr content module
                    this._syncRequestarrContent();
                    // Reload current section
                    this._reloadCurrentSection();
                });
            }
        } catch (error) {
            console.error('[HomeRequestarr] Error populating movie instances:', error);
        }
    },

    async _populateTVInstanceDropdown() {
        const select = this.elements.tvInstanceSelect;
        if (!select) return;
        try {
            const response = await fetch(`./api/requestarr/instances/sonarr?t=${Date.now()}`, { cache: 'no-store' });
            const data = await response.json();
            const instances = (data.instances || []).map(inst => ({ name: String(inst.name).trim() }));

            // Preserve current selection before clearing
            const previousValue = this.defaultTVInstance || select.value || '';

            select.innerHTML = '';
            if (instances.length === 0) {
                select.innerHTML = '<option value="">No TV instances</option>';
                return;
            }

            instances.forEach(inst => {
                const opt = document.createElement('option');
                opt.value = inst.name;
                opt.textContent = `Sonarr \u2013 ${inst.name}`;
                if (previousValue && inst.name === previousValue) opt.selected = true;
                select.appendChild(opt);
            });

            // Update in-memory default to match what's actually selected
            if (select.value) {
                this.defaultTVInstance = select.value;
            }

            // Only attach change listener once (guard against duplicate listeners on refresh)
            if (!select._homeChangeWired) {
                select._homeChangeWired = true;
                select.addEventListener('change', async () => {
                    this.defaultTVInstance = select.value;
                    this._clearCache('trending');
                    this._clearCache('tv');
                    await this._saveServerDefaults();
                    this._syncRequestarrContent();
                    this._reloadCurrentSection();
                });
            }
        } catch (error) {
            console.error('[HomeRequestarr] Error populating TV instances:', error);
        }
    },

    /** Save current defaults to the server (same endpoint as Requestarr) */
    _saveServerDefaults() {
        return fetch('./api/requestarr/settings/default-instances', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                movie_instance: this.defaultMovieInstance || '',
                tv_instance: this.defaultTVInstance || ''
            })
        }).catch(e => console.warn('[HomeRequestarr] Failed to save defaults:', e));
    },

    /** Sync the Requestarr content module's state so Discover page stays in sync */
    _syncRequestarrContent() {
        if (this.core && this.core.content) {
            this.core.content.selectedMovieInstance = this.defaultMovieInstance;
            this.core.content.selectedTVInstance = this.defaultTVInstance;
            // Sync Requestarr dropdown selectors too
            ['movies-instance-select', 'discover-movie-instance-select'].forEach(id => {
                const el = document.getElementById(id);
                if (el && el.value !== this.defaultMovieInstance) el.value = this.defaultMovieInstance;
            });
            ['tv-instance-select', 'discover-tv-instance-select'].forEach(id => {
                const el = document.getElementById(id);
                if (el && el.value !== this.defaultTVInstance) el.value = this.defaultTVInstance;
            });
        }
    },

    /** Clear a discovery cache section */
    _clearCache(section) {
        const key = this.DISCOVERY_CACHE_KEYS[section];
        if (key) { try { localStorage.removeItem(key); } catch (e) { /* ignore */ } }
    },

    /** Reload whichever section is currently visible after an instance change */
    _reloadCurrentSection() {
        if (!this.currentSection) return;
        switch (this.currentSection) {
            case 'trending': this.loadTrending(); break;
            case 'movies': this.loadPopularMovies(); break;
            case 'tv': this.loadPopularTV(); break;
        }
        // Also preload the others
        this.preloadOtherDiscoverySections(this.currentSection);
    },

    setupSearch() {
        this.elements.searchInput.addEventListener('input', (event) => {
            this.handleSearch(event.target.value);
        });
    },

    handleSearch(query) {
        if (!this.enableRequestarr) return;

        if (this.searchTimeout) {
            clearTimeout(this.searchTimeout);
        }

        if (!query.trim()) {
            this.showDiscover();
            return;
        }

        this.searchTimeout = setTimeout(() => {
            this.performSearch(query);
        }, 500);
    },

    showDiscover() {
        if (this.elements.searchResultsView) {
            this.elements.searchResultsView.style.display = 'none';
        }
        if (this.elements.discoverView) {
            if (this.showTrending) {
                this.elements.discoverView.style.setProperty('display', 'block', 'important');
            } else {
                this.elements.discoverView.style.setProperty('display', 'none', 'important');
            }
        }
    },

    showResults() {
        if (this.elements.discoverView) {
            this.elements.discoverView.style.display = 'none';
        }
        if (this.elements.searchResultsView) {
            this.elements.searchResultsView.style.display = 'block';
        }
    },

    async performSearch(query) {
        if (!this.enableRequestarr) return;
        this.showResults();

        if (!this.elements.searchResultsGrid) {
            return;
        }

        this.elements.searchResultsGrid.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Searching...</p></div>';

        try {
            // Determine which instances to check library status against
            const movieDecoded = this._decodeInstance(this.defaultMovieInstance);
            const tvInstanceName = this.defaultTVInstance || '';

            const [moviesResponse, tvResponse] = await Promise.all([
                fetch(`./api/requestarr/search?q=${encodeURIComponent(query)}&app_type=${encodeURIComponent(movieDecoded.appType)}&instance_name=${encodeURIComponent(movieDecoded.name)}`),
                fetch(`./api/requestarr/search?q=${encodeURIComponent(query)}&app_type=sonarr&instance_name=${encodeURIComponent(tvInstanceName)}`)
            ]);

            const moviesData = await moviesResponse.json();
            const tvData = await tvResponse.json();

            const allResults = [
                ...(moviesData.results || []),
                ...(tvData.results || [])
            ];

            allResults.sort((a, b) => {
                const popularityA = a.popularity || 0;
                const popularityB = b.popularity || 0;
                return popularityB - popularityA;
            });

            if (allResults.length > 0) {
                this.elements.searchResultsGrid.innerHTML = '';
                allResults.forEach((item) => {
                    // Use appropriate default instance based on media type
                    const suggestedInstance = item.media_type === 'movie' 
                        ? this.defaultMovieInstance
                        : this.defaultTVInstance;
                    const card = this.createMediaCard(item, suggestedInstance);
                    if (card) {
                        this.elements.searchResultsGrid.appendChild(card);
                    }
                });
            } else {
                this.elements.searchResultsGrid.innerHTML = '<p style="color: #888; text-align: center; padding: 60px; width: 100%;">No results found</p>';
            }
        } catch (error) {
            console.error('[HomeRequestarr] Error searching:', error);
            this.elements.searchResultsGrid.innerHTML = '<p style="color: #ef4444; text-align: center; padding: 60px; width: 100%;">Search failed</p>';
        }
    },

    _clearPendingError() {
        if (this._pendingErrorTimeout) {
            clearTimeout(this._pendingErrorTimeout);
            this._pendingErrorTimeout = null;
        }
    },

    getCachedDiscovery(section) {
        const key = this.DISCOVERY_CACHE_KEYS[section];
        if (!key) return null;
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return null;
            const { results, timestamp } = JSON.parse(raw);
            if (Date.now() - (timestamp || 0) > this.DISCOVERY_CACHE_TTL_MS) return null;
            return Array.isArray(results) ? results : null;
        } catch (e) {
            return null;
        }
    },

    setCachedDiscovery(section, results) {
        const key = this.DISCOVERY_CACHE_KEYS[section];
        if (!key || !Array.isArray(results)) return;
        try {
            localStorage.setItem(key, JSON.stringify({ results, timestamp: Date.now() }));
        } catch (e) {
            console.warn('[HomeRequestarr] Discovery cache write failed:', e);
        }
    },

    renderTrendingResults(results) {
        if (!this.elements.trendingCarousel) return;
        if (results && results.length > 0) {
            this.elements.trendingCarousel.innerHTML = '';
            results.forEach((item) => {
                const suggestedInstance = item.media_type === 'movie' ? this.defaultMovieInstance : this.defaultTVInstance;
                const card = this.createMediaCard(item, suggestedInstance);
                if (card) this.elements.trendingCarousel.appendChild(card);
            });
        } else {
            this.elements.trendingCarousel.innerHTML = '<p style="color: #888; text-align: center; width: 100%; padding: 40px;">No trending content available</p>';
        }
    },

    renderMoviesResults(results) {
        if (!this.elements.moviesCarousel) return;
        if (results && results.length > 0) {
            this.elements.moviesCarousel.innerHTML = '';
            results.slice(0, 20).forEach((item) => {
                const card = this.createMediaCard(item, this.defaultMovieInstance);
                if (card) this.elements.moviesCarousel.appendChild(card);
            });
        } else {
            this.elements.moviesCarousel.innerHTML = '<p style="color: #888; text-align: center; width: 100%; padding: 40px;">No popular movies available</p>';
        }
    },

    renderTVResults(results) {
        if (!this.elements.tvCarousel) return;
        if (results && results.length > 0) {
            this.elements.tvCarousel.innerHTML = '';
            results.slice(0, 20).forEach((item) => {
                const card = this.createMediaCard(item, this.defaultTVInstance);
                if (card) this.elements.tvCarousel.appendChild(card);
            });
        } else {
            this.elements.tvCarousel.innerHTML = '<p style="color: #888; text-align: center; width: 100%; padding: 40px;">No popular TV shows available</p>';
        }
    },

    /** Build trending URL with current movie + TV instance params */
    _buildTrendingUrl() {
        let url = './api/requestarr/discover/trending';
        const params = [];
        if (this.defaultMovieInstance) {
            const d = this._decodeInstance(this.defaultMovieInstance);
            if (d.appType) params.push(`movie_app_type=${encodeURIComponent(d.appType)}`);
            if (d.name) params.push(`movie_instance_name=${encodeURIComponent(d.name)}`);
        }
        if (this.defaultTVInstance) {
            params.push(`tv_instance_name=${encodeURIComponent(this.defaultTVInstance)}`);
        }
        if (params.length > 0) url += '?' + params.join('&');
        return url;
    },

    /** Build popular movies URL with current movie instance params */
    _buildMoviesUrl() {
        let url = './api/requestarr/discover/movies?sort_by=popularity.desc';
        if (this.defaultMovieInstance) {
            const d = this._decodeInstance(this.defaultMovieInstance);
            if (d.appType) url += `&app_type=${encodeURIComponent(d.appType)}`;
            if (d.name) url += `&instance_name=${encodeURIComponent(d.name)}`;
        }
        return url;
    },

    /** Build popular TV URL with current TV instance params */
    _buildTVUrl() {
        let url = './api/requestarr/discover/tv?sort_by=popularity.desc';
        if (this.defaultTVInstance) {
            url += `&app_type=sonarr&instance_name=${encodeURIComponent(this.defaultTVInstance)}`;
        }
        return url;
    },

    async loadTrending() {
        if (!this.enableRequestarr || !this.elements.trendingCarousel) return;
        this._clearPendingError();

        const cached = this.getCachedDiscovery('trending');
        if (cached !== null) {
            this.renderTrendingResults(cached);
            this.fetchAndCacheTrending();
            return;
        }

        try {
            const response = await fetch(this._buildTrendingUrl());
            const data = await response.json();
            const results = data.results && data.results.length > 0 ? data.results : [];
            this.setCachedDiscovery('trending', results);
            this.renderTrendingResults(results);
        } catch (error) {
            console.error('[HomeRequestarr] Error loading trending:', error);
            const section = 'trending';
            this._pendingErrorTimeout = setTimeout(() => {
                this._pendingErrorTimeout = null;
                if (this.currentSection === section && this.elements.trendingCarousel) {
                    this.showTrendingError('Failed to load trending content');
                }
            }, this.FAILED_MESSAGE_DELAY);
        }
    },

    async fetchAndCacheTrending() {
        try {
            const response = await fetch(this._buildTrendingUrl());
            const data = await response.json();
            const results = data.results && data.results.length > 0 ? data.results : [];
            this.setCachedDiscovery('trending', results);
            if (this.currentSection === 'trending') this.renderTrendingResults(results);
        } catch (e) {
            console.warn('[HomeRequestarr] Background refresh trending failed:', e);
        }
    },
    
    async loadPopularMovies() {
        if (!this.enableRequestarr || !this.elements.moviesCarousel) return;
        this._clearPendingError();

        const cached = this.getCachedDiscovery('movies');
        if (cached !== null) {
            this.renderMoviesResults(cached);
            this.fetchAndCachePopularMovies();
            return;
        }

        try {
            const response = await fetch(this._buildMoviesUrl());
            const data = await response.json();
            const results = (data.results && data.results.length > 0) ? data.results : [];
            this.setCachedDiscovery('movies', results);
            this.renderMoviesResults(results);
        } catch (error) {
            console.error('[HomeRequestarr] Error loading popular movies:', error);
            const section = 'movies';
            this._pendingErrorTimeout = setTimeout(() => {
                this._pendingErrorTimeout = null;
                if (this.currentSection === section && this.elements.moviesCarousel) {
                    this.elements.moviesCarousel.innerHTML = '<p style="color: #ef4444; text-align: center; width: 100%; padding: 40px;">Failed to load popular movies</p>';
                }
            }, this.FAILED_MESSAGE_DELAY);
        }
    },

    async fetchAndCachePopularMovies() {
        try {
            const response = await fetch(this._buildMoviesUrl());
            const data = await response.json();
            const results = (data.results && data.results.length > 0) ? data.results : [];
            this.setCachedDiscovery('movies', results);
            if (this.currentSection === 'movies') this.renderMoviesResults(results);
        } catch (e) {
            console.warn('[HomeRequestarr] Background refresh popular movies failed:', e);
        }
    },
    
    async loadPopularTV() {
        if (!this.enableRequestarr || !this.elements.tvCarousel) return;
        this._clearPendingError();

        const cached = this.getCachedDiscovery('tv');
        if (cached !== null) {
            this.renderTVResults(cached);
            this.fetchAndCachePopularTV();
            return;
        }

        try {
            const response = await fetch(this._buildTVUrl());
            const data = await response.json();
            const results = (data.results && data.results.length > 0) ? data.results : [];
            this.setCachedDiscovery('tv', results);
            this.renderTVResults(results);
        } catch (error) {
            console.error('[HomeRequestarr] Error loading popular TV:', error);
            const section = 'tv';
            this._pendingErrorTimeout = setTimeout(() => {
                this._pendingErrorTimeout = null;
                if (this.currentSection === section && this.elements.tvCarousel) {
                    this.elements.tvCarousel.innerHTML = '<p style="color: #ef4444; text-align: center; width: 100%; padding: 40px;">Failed to load popular TV shows</p>';
                }
            }, this.FAILED_MESSAGE_DELAY);
        }
    },

    async fetchAndCachePopularTV() {
        try {
            const response = await fetch(this._buildTVUrl());
            const data = await response.json();
            const results = (data.results && data.results.length > 0) ? data.results : [];
            this.setCachedDiscovery('tv', results);
            if (this.currentSection === 'tv') this.renderTVResults(results);
        } catch (e) {
            console.warn('[HomeRequestarr] Background refresh popular TV failed:', e);
        }
    },

    showTrendingError(message) {
        if (this.currentSection === 'trending' && this.elements.trendingCarousel) {
            this.elements.trendingCarousel.innerHTML = `<p style="color: #ef4444; text-align: center; width: 100%; padding: 40px;">${message}</p>`;
        }
    },

    createMediaCard(item, suggestedInstance = null) {
        if (!this.core || !this.core.content || typeof this.core.content.createMediaCard !== 'function') {
            return null;
        }

        return this.core.content.createMediaCard(item, suggestedInstance);
    }
};

document.addEventListener('DOMContentLoaded', () => {
    HomeRequestarr.init();
});
