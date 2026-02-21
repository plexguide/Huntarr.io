/**
 * Requestarr Content - Content loading and media card creation
 */
import { encodeInstanceValue, decodeInstanceValue } from './requestarr-core.js';

export class RequestarrContent {
    constructor(core) {
        this.core = core;
        this.moviesPage = 1;
        this.moviesHasMore = true;
        this.isLoadingMovies = false;
        this.moviesObserver = null;
        this.tvPage = 1;
        this.tvHasMore = true;
        this.isLoadingTV = false;
        this.tvObserver = null;
        this.moviesRequestToken = 0;
        this.tvRequestToken = 0;
        this.activeMovieInstance = null;
        this.activeTVInstance = null;
        
        // Instance tracking - unified across all Requestarr pages via server-side DB.
        // Loaded once via _loadServerDefaults(), saved via _saveServerDefaults().
        this.selectedMovieInstance = null;
        this.selectedTVInstance = null;
        this._serverDefaultsLoaded = false;
        
        // Smart Hunt grid state
        this.smarthuntPage = 0;
        this.smarthuntHasMore = true;
        this.isLoadingSmartHunt = false;
        this.smarthuntObserver = null;
        this.smarthuntRequestToken = 0;
        this._smarthuntAllResults = [];
        this._shFilters = null;
        this._smarthuntInstancesPopulated = false;

        // Hidden media tracking
        this.hiddenMediaSet = new Set();

        // Track whether movie/TV dropdowns have been populated (prevents race with _loadServerDefaults)
        this._movieInstancesPopulated = false;
        this._tvInstancesPopulated = false;

        // Auto-refresh dropdowns when any instance is added/deleted/renamed anywhere in the app
        document.addEventListener('huntarr:instances-changed', () => {
            this.refreshInstanceSelectors();
        });

    }

    // ========================================
    // INSTANCE MANAGEMENT
    // ========================================

    async setupInstanceSelectors() {
        // Load server defaults first, then populate selectors
        await this._loadServerDefaults();
        await this.loadMovieInstances();
        await this.loadTVInstances();
    }

    /**
     * Public refresh: re-fetch instance lists from the API and repopulate all
     * Requestarr dropdowns (Discover + Movies/TV list pages).
     * Called by navigation.js when switching to Requestarr sections so newly
     * added/removed instances appear without a full page reload.
     */
    async refreshInstanceSelectors() {
            this._serverDefaultsLoaded = false;
            this._movieInstancesPopulated = false;
            this._tvInstancesPopulated = false;
            this._bundleDropdownCache = null;
            await this._loadServerDefaults();
            await Promise.all([
                this._populateDiscoverMovieInstances(),
                this._populateDiscoverTVInstances()
            ]);
            await this.loadMovieInstances();
            await this.loadTVInstances();
        }

    // ----------------------------------------
    // SERVER-SIDE INSTANCE PERSISTENCE
    // ----------------------------------------

    /**
     * Load the saved default instances from the server (DB).
     * Called once on init; populates this.selectedMovieInstance / this.selectedTVInstance.
     */
    async _loadServerDefaults() {
        if (this._serverDefaultsLoaded) return;
        try {
            const res = await fetch('./api/requestarr/settings/default-instances');
            const data = await res.json();
            if (data.success && data.defaults) {
                this.selectedMovieInstance = data.defaults.movie_instance || null;
                this.selectedTVInstance = data.defaults.tv_instance || null;
                console.log('[RequestarrContent] Loaded server defaults:', data.defaults);
            }
        } catch (e) {
            console.warn('[RequestarrContent] Could not load server defaults:', e);
        }
        this._serverDefaultsLoaded = true;
    }

    /**
     * Save the current movie + TV instance to the server (fire-and-forget).
     */
    _saveServerDefaults() {
        return fetch('./api/requestarr/settings/default-instances', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                movie_instance: this.selectedMovieInstance || '',
                tv_instance: this.selectedTVInstance || ''
            })
        }).catch(e => console.warn('[RequestarrContent] Failed to save server defaults:', e));
    }

    /**
     * Update the movie instance in memory + server, then sync all page dropdowns.
     * Returns a promise that resolves once the server save completes.
     */
    async _setMovieInstance(compoundValue) {
        this.selectedMovieInstance = compoundValue;
        this._syncAllMovieSelectors();
        await this._saveServerDefaults();
        // Reload Smart Hunt carousel if active
        if (this._discoverSmartHunt) this._discoverSmartHunt.reload();
    }

    /**
     * Update the TV instance in memory + server, then sync all page dropdowns.
     * Returns a promise that resolves once the server save completes.
     */
    async _setTVInstance(value) {
        this.selectedTVInstance = value;
        this._syncAllTVSelectors();
        await this._saveServerDefaults();
        // Reload Smart Hunt carousel if active
        if (this._discoverSmartHunt) this._discoverSmartHunt.reload();
    }


    /**
     * Sync every movie-instance dropdown on the page to the current value.
     */
    _syncAllMovieSelectors() {
        const ids = ['movies-instance-select', 'discover-movie-instance-select', 'home-movie-instance-select', 'smarthunt-movie-instance-select'];
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (el && el.value !== this.selectedMovieInstance) {
                el.value = this.selectedMovieInstance;
            }
        });
        // Also sync HomeRequestarr's in-memory default
        if (window.HomeRequestarr) {
            window.HomeRequestarr.defaultMovieInstance = this.selectedMovieInstance;
        }
    }

    /**
     * Sync every TV-instance dropdown on the page to the current value.
     */
    _syncAllTVSelectors() {
        const ids = ['tv-instance-select', 'discover-tv-instance-select', 'home-tv-instance-select', 'smarthunt-tv-instance-select'];
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (el && el.value !== this.selectedTVInstance) {
                el.value = this.selectedTVInstance;
            }
        });
        // Also sync HomeRequestarr's in-memory default
        if (window.HomeRequestarr) {
            window.HomeRequestarr.defaultTVInstance = this.selectedTVInstance;
        }
    }

    // ----------------------------------------
    // DISCOVER PAGE INSTANCE SELECTORS
    // ----------------------------------------

    /**
     * Populate the Discover page's movie + TV instance selectors and wire change events.
     */
    async setupDiscoverInstances() {
        await this._loadServerDefaults();
        await Promise.all([
            this._populateDiscoverMovieInstances(),
            this._populateDiscoverTVInstances()
        ]);
    }

    /**
     * Fetch bundle dropdown options from the server (cached per refresh cycle).
     * Returns { movie_options, tv_options } where each option has value + label.
     * The value uses appType:instanceName format so existing code works unchanged.
     */
    async _fetchBundleDropdownOptions() {
        if (this._bundleDropdownCache) return this._bundleDropdownCache;
        try {
            const resp = await fetch(`./api/requestarr/bundles/dropdown?t=${Date.now()}`, { cache: 'no-store' });
            if (!resp.ok) throw new Error('Failed');
            const data = await resp.json();
            // Normalize: value for bundles uses primary's appType:instanceName
            const normalize = (opts) => (opts || []).map(o => ({
                value: o.is_bundle ? encodeInstanceValue(o.primary_app_type, o.primary_instance_name) : o.value,
                label: o.label,
                isBundle: o.is_bundle,
            }));
            this._bundleDropdownCache = {
                movie_options: normalize(data.movie_options),
                tv_options: normalize(data.tv_options),
            };
            return this._bundleDropdownCache;
        } catch (e) {
            console.warn('[RequestarrContent] Error fetching bundle dropdown:', e);
            return { movie_options: [], tv_options: [] };
        }
    }

    /**
     * Populate a select element from bundle dropdown options.
     */
    _populateSelectFromOptions(select, options, savedValue) {
        select.innerHTML = '';
        if (options.length === 0) {
            select.innerHTML = '<option value="">No instances configured</option>';
            return null;
        }
        let matchedValue = null;
        options.forEach(opt => {
            const el = document.createElement('option');
            el.value = opt.value;
            el.textContent = opt.label;
            if (savedValue && opt.value === savedValue) {
                el.selected = true;
                matchedValue = opt.value;
            }
            select.appendChild(el);
        });
        // If no match, select first
        if (!matchedValue && options.length > 0) {
            select.options[0].selected = true;
            matchedValue = options[0].value;
        }
        return matchedValue;
    }

    async _populateDiscoverMovieInstances() {
        const select = document.getElementById('discover-movie-instance-select');
        if (!select) return;

        try {
            const dd = await this._fetchBundleDropdownOptions();
            const previousValue = this.selectedMovieInstance || select.value || '';
            const matched = this._populateSelectFromOptions(select, dd.movie_options, previousValue);
            if (matched) this.selectedMovieInstance = matched;

            if (!select._discoverChangeWired) {
                select._discoverChangeWired = true;
                select.addEventListener('change', async () => {
                    await this._setMovieInstance(select.value);
                    this.reloadDiscoverMovies();
                });
            }
        } catch (error) {
            console.error('[RequestarrContent] Error loading discover movie instances:', error);
        }
    }

    async _populateDiscoverTVInstances() {
        const select = document.getElementById('discover-tv-instance-select');
        if (!select) return;

        try {
            const dd = await this._fetchBundleDropdownOptions();
            const previousValue = this.selectedTVInstance || select.value || '';
            const matched = this._populateSelectFromOptions(select, dd.tv_options, previousValue);
            if (matched) this.selectedTVInstance = matched;

            if (!select._discoverChangeWired) {
                select._discoverChangeWired = true;
                select.addEventListener('change', async () => {
                    await this._setTVInstance(select.value);
                    this.reloadDiscoverTV();
                });
            }
        } catch (error) {
            console.error('[RequestarrContent] Error loading discover TV instances:', error);
        }
    }

    /**
     * Re-fetch and render Popular Movies carousel with the current movie instance.
     * Also refreshes trending since movie statuses depend on the selected instance.
     */
    async reloadDiscoverMovies() {
        const carousel = document.getElementById('popular-movies-carousel');
        if (!carousel) return;
        carousel.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Loading movies...</p></div>';
        try {
            const decoded = decodeInstanceValue(this.selectedMovieInstance);
            let url = './api/requestarr/discover/movies?page=1';
            if (decoded.name) url += `&app_type=${decoded.appType}&instance_name=${encodeURIComponent(decoded.name)}`;
            const response = await fetch(url);
            const data = await response.json();
            const results = (data.results && data.results.length > 0) ? data.results : [];
            this.renderPopularMoviesResults(carousel, results);
        } catch (error) {
            console.error('[RequestarrContent] Error reloading discover movies:', error);
        }
        // Refresh trending with updated instance params (status badges depend on selected instance)
        await this.loadTrending();
    }

    /**
     * Re-fetch and render Popular TV carousel with the current TV instance.
     * Also refreshes trending since TV statuses depend on the selected instance.
     */
    async reloadDiscoverTV() {
        const carousel = document.getElementById('popular-tv-carousel');
        if (!carousel) return;
        carousel.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Loading TV shows...</p></div>';
        try {
            let url = './api/requestarr/discover/tv?page=1';
            if (this.selectedTVInstance) {
                const decoded = decodeInstanceValue(this.selectedTVInstance, 'sonarr');
                url += `&app_type=${encodeURIComponent(decoded.appType || 'sonarr')}&instance_name=${encodeURIComponent(decoded.name || '')}`;
            }
            const response = await fetch(url);
            const data = await response.json();
            const results = (data.results && data.results.length > 0) ? data.results : [];
            this.renderPopularTVResults(carousel, results);
        } catch (error) {
            console.error('[RequestarrContent] Error reloading discover TV:', error);
        }
        // Refresh trending with updated instance params (status badges depend on selected instance)
        await this.loadTrending();
    }

    async loadMovieInstances() {
        const select = document.getElementById('movies-instance-select');
        if (!select) return;

        if (this._movieInstancesPopulated) {
            this._syncAllMovieSelectors();
            return;
        }

        if (this._loadingMovieInstances) return;
        this._loadingMovieInstances = true;

        select.innerHTML = '<option value="">Loading instances...</option>';

        try {
            const dd = await this._fetchBundleDropdownOptions();
            const savedValue = this.selectedMovieInstance;
            const matched = this._populateSelectFromOptions(select, dd.movie_options, savedValue);

            if (matched) {
                this._setMovieInstance(matched);
            } else {
                this.selectedMovieInstance = null;
            }

            // Setup change handler (remove old listener via clone)
            const newSelect = select.cloneNode(true);
            if (select.parentNode) {
                select.parentNode.replaceChild(newSelect, select);
            } else {
                const currentSelect = document.getElementById('movies-instance-select');
                if (currentSelect && currentSelect.parentNode) {
                    currentSelect.parentNode.replaceChild(newSelect, currentSelect);
                }
            }

            newSelect.addEventListener('change', async () => {
                await this._setMovieInstance(newSelect.value);

                const grid = document.getElementById('movies-grid');
                if (grid) {
                    grid.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Loading movies...</p></div>';
                }

                if (this.moviesObserver) {
                    this.moviesObserver.disconnect();
                    this.moviesObserver = null;
                }

                this.moviesPage = 1;
                this.moviesHasMore = true;
                this.isLoadingMovies = false;
                this.moviesRequestToken++;

                await new Promise(resolve => setTimeout(resolve, 50));
                await this.loadMovies();
                this.setupMoviesInfiniteScroll();
            });
            this._movieInstancesPopulated = true;
        } catch (error) {
            console.error('[RequestarrContent] Error loading movie instances:', error);
            select.innerHTML = '<option value="">Error loading instances</option>';
        } finally {
            this._loadingMovieInstances = false;
        }
    }

    async loadTVInstances() {
            const select = document.getElementById('tv-instance-select');
            if (!select) return;

            if (this._tvInstancesPopulated) {
                this._syncAllTVSelectors();
                return;
            }

            if (this._loadingTVInstances) return;
            this._loadingTVInstances = true;

            select.innerHTML = '<option value="">Loading instances...</option>';

            try {
                const dd = await this._fetchBundleDropdownOptions();
                const savedValue = this.selectedTVInstance;
                const matched = this._populateSelectFromOptions(select, dd.tv_options, savedValue);

                if (matched) {
                    this._setTVInstance(matched);
                } else {
                    this.selectedTVInstance = null;
                }

                // Setup change handler (remove old listener via clone)
                const newSelect = select.cloneNode(true);
                if (select.parentNode) {
                    select.parentNode.replaceChild(newSelect, select);
                } else {
                    const currentSelect = document.getElementById('tv-instance-select');
                    if (currentSelect && currentSelect.parentNode) {
                        currentSelect.parentNode.replaceChild(newSelect, currentSelect);
                    }
                }

                newSelect.addEventListener('change', async () => {
                    await this._setTVInstance(newSelect.value);

                    const grid = document.getElementById('tv-grid');
                    if (grid) {
                        grid.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Loading TV shows...</p></div>';
                    }

                    if (this.tvObserver) {
                        this.tvObserver.disconnect();
                        this.tvObserver = null;
                    }

                    this.tvPage = 1;
                    this.tvHasMore = true;
                    this.isLoadingTV = false;
                    this.tvRequestToken++;

                    await new Promise(resolve => setTimeout(resolve, 50));
                    await this.loadTV();
                    this.setupTVInfiniteScroll();
                });
                this._tvInstancesPopulated = true;
            } catch (error) {
                console.error('[RequestarrContent] Error loading TV instances:', error);
                select.innerHTML = '<option value="">Error loading instances</option>';
            } finally {
                this._loadingTVInstances = false;
            }
        }

    // ========================================
    // CONTENT LOADING
    // ========================================

    async loadDiscoverContent() {
        // Load server defaults + discover instance selectors
        await this._loadServerDefaults();
        await this.setupDiscoverInstances();
        
        // Load hidden media IDs for filtering
        await this.loadHiddenMediaIds();

        // Initialize Smart Hunt carousel on the Discover page (check main settings toggle)
        this._initDiscoverSmartHunt();
        
        await Promise.all([
            this.loadTrending(),
            this.loadPopularMovies(),
            this.loadPopularTV()
        ]);
    }

    /** Initialize Smart Hunt carousel on the Discover page */
    async _initDiscoverSmartHunt() {
        const section = document.getElementById('discover-smarthunt-section');
        if (section) section.style.display = '';

        if (!window.SmartHunt) return;
        const self = this;
        if (this._discoverSmartHunt) {
            this._discoverSmartHunt.destroy();
        }
        this._discoverSmartHunt = new window.SmartHunt({
            carouselId: 'discover-smarthunt-carousel',
            core: { content: this },
            getMovieInstance: () => self.selectedMovieInstance || '',
            getTVInstance: () => self.selectedTVInstance || '',
        });
        this._discoverSmartHunt.load();
    }

    async loadHiddenMediaIds() {
        try {
            // Fetch all hidden media (no pagination, we need all IDs)
            const [hiddenResp, blacklistResp] = await Promise.all([
                fetch('./api/requestarr/hidden-media?page=1&page_size=10000'),
                fetch('./api/requestarr/requests/global-blacklist/ids')
            ]);
            const data = await hiddenResp.json();
            const hiddenItems = Array.isArray(data.hidden_media)
                ? data.hidden_media
                : (Array.isArray(data.items) ? data.items : []);
            
            // Store hidden media as a Set of "tmdb_id:media_type" for fast cross-instance lookup
            this.hiddenMediaSet = new Set();
            hiddenItems.forEach(item => {
                const key = `${item.tmdb_id}:${item.media_type}`;
                this.hiddenMediaSet.add(key);
            });

            // Store global blacklist as a Set of "tmdb_id:media_type" for fast lookup
            this.globalBlacklistSet = new Set();
            const blData = await blacklistResp.json();
            (blData.items || []).forEach(item => {
                this.globalBlacklistSet.add(`${item.tmdb_id}:${item.media_type}`);
            });

            console.log('[RequestarrContent] Loaded', this.hiddenMediaSet.size, 'hidden media items,', this.globalBlacklistSet.size, 'global blacklist items');
        } catch (error) {
            console.error('[RequestarrContent] Error loading hidden media IDs:', error);
            this.hiddenMediaSet = new Set();
            this.globalBlacklistSet = new Set();
        }
    }

    isMediaHidden(tmdbId, mediaType, appType, instanceName) {
        if (!this.hiddenMediaSet) return false;
        // Cross-instance: check by tmdb_id:media_type only
        const key = `${tmdbId}:${mediaType}`;
        return this.hiddenMediaSet.has(key);
    }

    isGloballyBlacklisted(tmdbId, mediaType) {
        if (!this.globalBlacklistSet) return false;
        return this.globalBlacklistSet.has(`${tmdbId}:${mediaType}`);
    }

    renderTrendingResults(carousel, results, append) {
        if (!carousel) return;
        if (results && results.length > 0) {
            if (!append) carousel.innerHTML = '';
            results.forEach(item => {
                const suggestedInstance = item.media_type === 'movie' ? (this.selectedMovieInstance || null) : (this.selectedTVInstance || null);
                let appType, instanceName;
                if (item.media_type === 'movie') {
                    const decoded = decodeInstanceValue(this.selectedMovieInstance);
                    appType = decoded.appType;
                    instanceName = decoded.name;
                } else {
                    const decoded = decodeInstanceValue(this.selectedTVInstance, 'sonarr');
                    appType = decoded.appType;
                    instanceName = decoded.name;
                }
                const tmdbId = item.tmdb_id || item.id;
                if (tmdbId && this.isGloballyBlacklisted(tmdbId, item.media_type)) return;
                if (tmdbId && instanceName && this.isMediaHidden(tmdbId, item.media_type, appType, instanceName)) return;
                carousel.appendChild(this.createMediaCard(item, suggestedInstance));
            });
        } else if (!append) {
            carousel.innerHTML = '<p style="color: #888; text-align: center; width: 100%; padding: 40px;">No trending content available</p>';
        }
    }

    /**
     * Build the trending API URL with current movie + TV instance params.
     * This sends instances directly to the backend so it doesn't need to read from DB.
     */
    _buildTrendingUrl() {
        let url = './api/requestarr/discover/trending';
        const params = [];
        if (this.selectedMovieInstance) {
            const decoded = decodeInstanceValue(this.selectedMovieInstance);
            if (decoded.appType) params.push(`movie_app_type=${encodeURIComponent(decoded.appType)}`);
            if (decoded.name) params.push(`movie_instance_name=${encodeURIComponent(decoded.name)}`);
        }
        if (this.selectedTVInstance) {
            const decoded = decodeInstanceValue(this.selectedTVInstance, 'sonarr');
            if (decoded.appType) params.push(`tv_app_type=${encodeURIComponent(decoded.appType)}`);
            if (decoded.name) params.push(`tv_instance_name=${encodeURIComponent(decoded.name)}`);
        }
        if (params.length > 0) url += '?' + params.join('&');
        return url;
    }

    async loadTrending() {
        this._trendingPage = 1;
        this._trendingHasMore = true;
        this._trendingLoading = false;
        const carousel = document.getElementById('trending-carousel');
        if (!carousel) return;
        try {
            const baseUrl = this._buildTrendingUrl();
            const sep = baseUrl.includes('?') ? '&' : '?';
            const url = baseUrl + sep + `page=1&_=${Date.now()}`;
            const response = await fetch(url, { cache: 'no-store' });
            const data = await response.json();
            const results = (data.results && data.results.length > 0) ? data.results : [];
            this.renderTrendingResults(carousel, results, false);
            this._trendingHasMore = results.length >= 10;
            this._attachCarouselInfiniteScroll(carousel, '_trending');
        } catch (error) {
            console.error('[RequestarrDiscover] Error loading trending:', error);
            carousel.innerHTML = '<p style="color: #ef4444; text-align: center; width: 100%; padding: 40px;">Failed to load trending content</p>';
        }
    }

    async _loadNextTrendingPage() {
        if (this._trendingLoading || !this._trendingHasMore) return;
        if (this._trendingPage >= 5) { this._trendingHasMore = false; return; }
        this._trendingLoading = true;
        const carousel = document.getElementById('trending-carousel');
        if (!carousel) { this._trendingLoading = false; return; }
        try {
            const page = this._trendingPage + 1;
            const baseUrl = this._buildTrendingUrl();
            const sep = baseUrl.includes('?') ? '&' : '?';
            const url = baseUrl + sep + `page=${page}&_=${Date.now()}`;
            const response = await fetch(url, { cache: 'no-store' });
            const data = await response.json();
            const results = (data.results && data.results.length > 0) ? data.results : [];
            this.renderTrendingResults(carousel, results, true);
            this._trendingPage = page;
            this._trendingHasMore = results.length >= 10 && page < 5;
        } catch (error) {
            console.error('[RequestarrDiscover] Error loading trending page:', error);
        } finally {
            this._trendingLoading = false;
        }
    }

    renderPopularMoviesResults(carousel, results, append) {
        if (!carousel) return;
        const decoded = decodeInstanceValue(this.selectedMovieInstance);
        if (results && results.length > 0) {
            if (!append) carousel.innerHTML = '';
            results.forEach(item => {
                const tmdbId = item.tmdb_id || item.id;
                if (tmdbId && this.isGloballyBlacklisted(tmdbId, 'movie')) return;
                if (tmdbId && decoded.name && this.isMediaHidden(tmdbId, 'movie', decoded.appType, decoded.name)) return;
                carousel.appendChild(this.createMediaCard(item, this.selectedMovieInstance || null));
            });
        } else if (!append) {
            carousel.innerHTML = '<p style="color: #888; text-align: center; width: 100%; padding: 40px;">No movies available</p>';
        }
    }

    async loadPopularMovies() {
        this._popMoviesPage = 1;
        this._popMoviesHasMore = true;
        this._popMoviesLoading = false;
        const carousel = document.getElementById('popular-movies-carousel');
        if (!carousel) return;
        try {
            const decoded = decodeInstanceValue(this.selectedMovieInstance);
            let url = './api/requestarr/discover/movies?page=1';
            if (decoded.name) url += `&app_type=${decoded.appType}&instance_name=${encodeURIComponent(decoded.name)}`;
            url += `&_=${Date.now()}`;
            const response = await fetch(url, { cache: 'no-store' });
            const data = await response.json();
            const results = (data.results && data.results.length > 0) ? data.results : [];
            this.renderPopularMoviesResults(carousel, results, false);
            this._popMoviesHasMore = results.length >= 10;
            this._attachCarouselInfiniteScroll(carousel, '_popMovies');
        } catch (error) {
            console.error('[RequestarrDiscover] Error loading popular movies:', error);
            carousel.innerHTML = '<p style="color: #ef4444; text-align: center; width: 100%; padding: 40px;">Failed to load movies</p>';
        }
    }

    async _loadNextPopularMoviesPage() {
        if (this._popMoviesLoading || !this._popMoviesHasMore) return;
        if (this._popMoviesPage >= 5) { this._popMoviesHasMore = false; return; }
        this._popMoviesLoading = true;
        const carousel = document.getElementById('popular-movies-carousel');
        if (!carousel) { this._popMoviesLoading = false; return; }
        try {
            const page = this._popMoviesPage + 1;
            const decoded = decodeInstanceValue(this.selectedMovieInstance);
            let url = `./api/requestarr/discover/movies?page=${page}`;
            if (decoded.name) url += `&app_type=${decoded.appType}&instance_name=${encodeURIComponent(decoded.name)}`;
            url += `&_=${Date.now()}`;
            const response = await fetch(url, { cache: 'no-store' });
            const data = await response.json();
            const results = (data.results && data.results.length > 0) ? data.results : [];
            this.renderPopularMoviesResults(carousel, results, true);
            this._popMoviesPage = page;
            this._popMoviesHasMore = results.length >= 10 && page < 5;
        } catch (error) {
            console.error('[RequestarrDiscover] Error loading popular movies page:', error);
        } finally {
            this._popMoviesLoading = false;
        }
    }

    renderPopularTVResults(carousel, results, append) {
        if (!carousel) return;
        const decoded = decodeInstanceValue(this.selectedTVInstance, 'sonarr');
        if (results && results.length > 0) {
            if (!append) carousel.innerHTML = '';
            results.forEach(item => {
                const tmdbId = item.tmdb_id || item.id;
                if (tmdbId && this.isGloballyBlacklisted(tmdbId, 'tv')) return;
                if (tmdbId && decoded.name && this.isMediaHidden(tmdbId, 'tv', decoded.appType, decoded.name)) return;
                carousel.appendChild(this.createMediaCard(item, this.selectedTVInstance || null));
            });
        } else if (!append) {
            carousel.innerHTML = '<p style="color: #888; text-align: center; width: 100%; padding: 40px;">No TV shows available</p>';
        }
    }

    async loadPopularTV() {
        this._popTVPage = 1;
        this._popTVHasMore = true;
        this._popTVLoading = false;
        const carousel = document.getElementById('popular-tv-carousel');
        if (!carousel) return;
        try {
            const decoded = decodeInstanceValue(this.selectedTVInstance, 'sonarr');
            let url = './api/requestarr/discover/tv?page=1';
            if (decoded.name) url += `&app_type=${encodeURIComponent(decoded.appType || 'sonarr')}&instance_name=${encodeURIComponent(decoded.name)}`;
            url += `&_=${Date.now()}`;
            const response = await fetch(url, { cache: 'no-store' });
            const data = await response.json();
            const results = (data.results && data.results.length > 0) ? data.results : [];
            this.renderPopularTVResults(carousel, results, false);
            this._popTVHasMore = results.length >= 10;
            this._attachCarouselInfiniteScroll(carousel, '_popTV');
        } catch (error) {
            console.error('[RequestarrDiscover] Error loading popular TV:', error);
            carousel.innerHTML = '<p style="color: #ef4444; text-align: center; width: 100%; padding: 40px;">Failed to load TV shows</p>';
        }
    }

    async _loadNextPopularTVPage() {
        if (this._popTVLoading || !this._popTVHasMore) return;
        if (this._popTVPage >= 5) { this._popTVHasMore = false; return; }
        this._popTVLoading = true;
        const carousel = document.getElementById('popular-tv-carousel');
        if (!carousel) { this._popTVLoading = false; return; }
        try {
            const page = this._popTVPage + 1;
            const decoded = decodeInstanceValue(this.selectedTVInstance, 'sonarr');
            let url = `./api/requestarr/discover/tv?page=${page}`;
            if (decoded.name) url += `&app_type=${encodeURIComponent(decoded.appType || 'sonarr')}&instance_name=${encodeURIComponent(decoded.name)}`;
            url += `&_=${Date.now()}`;
            const response = await fetch(url, { cache: 'no-store' });
            const data = await response.json();
            const results = (data.results && data.results.length > 0) ? data.results : [];
            this.renderPopularTVResults(carousel, results, true);
            this._popTVPage = page;
            this._popTVHasMore = results.length >= 10 && page < 5;
        } catch (error) {
            console.error('[RequestarrDiscover] Error loading popular TV page:', error);
        } finally {
            this._popTVLoading = false;
        }
    }

    /**
     * Attach an infinite scroll listener to a horizontal carousel.
     * When the user scrolls within 300px of the right edge, load the next page.
     * @param {HTMLElement} carousel - the .media-carousel element
     * @param {string} prefix - property prefix, e.g. '_trending', '_popMovies', '_popTV'
     */
    _attachCarouselInfiniteScroll(carousel, prefix) {
        if (!carousel) return;
        // Remove any previous handler for this carousel
        const handlerKey = prefix + 'ScrollHandler';
        if (this[handlerKey]) {
            carousel.removeEventListener('scroll', this[handlerKey]);
        }
        const self = this;
        this[handlerKey] = () => {
            const loading = self[prefix + 'Loading'];
            const hasMore = self[prefix + 'HasMore'];
            if (loading || !hasMore) return;
            const remaining = carousel.scrollWidth - carousel.scrollLeft - carousel.clientWidth;
            if (remaining < 300) {
                if (prefix === '_trending') self._loadNextTrendingPage();
                else if (prefix === '_popMovies') self._loadNextPopularMoviesPage();
                else if (prefix === '_popTV') self._loadNextPopularTVPage();
            }
        };
        carousel.addEventListener('scroll', this[handlerKey], { passive: true });
    }

    setupMoviesInfiniteScroll() {
        const sentinel = document.getElementById('movies-scroll-sentinel');
        if (!sentinel || this.moviesObserver) {
            return;
        }

        this.moviesObserver = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) {
                    return;
                }
                if (this.moviesHasMore && !this.isLoadingMovies) {
                    this.loadMoreMovies();
                }
            });
        }, {
            root: null,
            rootMargin: '200px 0px',
            threshold: 0
        });

        this.moviesObserver.observe(sentinel);
    }

    async loadMovies(page = 1) {
        const grid = document.getElementById('movies-grid');
        
        if (!grid) {
            return;
        }

        if (this.isLoadingMovies && this.selectedMovieInstance === this.activeMovieInstance) {
            return;
        }

        this.isLoadingMovies = true;
        const requestToken = ++this.moviesRequestToken;
        const requestedInstance = this.selectedMovieInstance;
        this.activeMovieInstance = requestedInstance;

        // Show loading spinner on first page
        if (this.moviesPage === 1) {
            grid.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Loading movies...</p></div>';
        }
        
        try {
            let url = `./api/requestarr/discover/movies?page=${this.moviesPage}&_=${Date.now()}`;
            
            // Add instance info for library status checking (decode compound value)
            if (this.selectedMovieInstance) {
                const decoded = decodeInstanceValue(this.selectedMovieInstance);
                url += `&app_type=${decoded.appType}&instance_name=${encodeURIComponent(decoded.name)}`;
            }
            
            // Add filter parameters
            if (this.core.filters) {
                const filterParams = this.core.filters.getFilterParams();
                if (filterParams) {
                    url += `&${filterParams}`;
                }
            }
            
            const response = await fetch(url, { cache: 'no-store' });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();

            // Always clear the grid first to remove loading spinner (even for stale requests)
            if (this.moviesPage === 1) {
                grid.innerHTML = '';
            }

            // Check if this request is still valid (not cancelled by a newer request)
            if (requestToken !== this.moviesRequestToken || requestedInstance !== this.selectedMovieInstance) {
                console.log('[RequestarrContent] Cancelled stale movies request, but spinner already cleared');
                return;
            }
            
            if (data.results && data.results.length > 0) {
                data.results.forEach((item) => {
                    // Filter out hidden media (decode compound value for correct app_type)
                    const tmdbId = item.tmdb_id || item.id;
                    // Filter globally blacklisted items
                    if (tmdbId && this.isGloballyBlacklisted(tmdbId, 'movie')) return;
                    if (tmdbId && this.selectedMovieInstance) {
                        const dHidden = decodeInstanceValue(this.selectedMovieInstance);
                        if (this.isMediaHidden(tmdbId, 'movie', dHidden.appType, dHidden.name)) {
                            return; // Skip hidden items
                        }
                    }
                    grid.appendChild(this.createMediaCard(item));
                });

                // Use has_more from API if available, otherwise check result count
                if (data.has_more !== undefined) {
                    this.moviesHasMore = data.has_more;
                } else {
                    // Fallback to old logic if API doesn't provide has_more
                    this.moviesHasMore = data.results.length >= 20;
                }
            } else {
                grid.innerHTML = '<p style="color: #888; text-align: center; width: 100%; padding: 40px;">No movies found</p>';
                // Use has_more from API if available
                if (data.has_more !== undefined) {
                    this.moviesHasMore = data.has_more;
                } else {
                    this.moviesHasMore = false;
                }
            }
        } catch (error) {
            console.error('[RequestarrContent] Error loading movies:', error);
            if (this.moviesPage === 1) {
                grid.innerHTML = '<p style="color: #ef4444; text-align: center; width: 100%; padding: 40px;">Failed to load movies</p>';
            }
        } finally {
            this.isLoadingMovies = false;

            const sentinel = document.getElementById('movies-scroll-sentinel');
            if (sentinel && this.moviesHasMore) {
                const rect = sentinel.getBoundingClientRect();
                const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
                if (rect.top <= viewportHeight + 200) {
                    this.loadMoreMovies();
                }
            }
        }
    }
    
    loadMoreMovies() {
        if (this.moviesHasMore && !this.isLoadingMovies) {
            this.moviesPage++;
            this.loadMovies(this.moviesPage);
        }
    }

    async loadTV(page = 1) {
        const grid = document.getElementById('tv-grid');
        
        if (!grid) {
            return;
        }

        if (this.isLoadingTV && this.selectedTVInstance === this.activeTVInstance) {
            return;
        }

        this.isLoadingTV = true;
        const requestToken = ++this.tvRequestToken;
        const requestedInstance = this.selectedTVInstance;
        this.activeTVInstance = requestedInstance;

        // Show loading spinner on first page
        if (this.tvPage === 1) {
            grid.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Loading TV shows...</p></div>';
        }
        
        try {
            let url = `./api/requestarr/discover/tv?page=${this.tvPage}&_=${Date.now()}`;
            
            // Add instance info for library status checking
            if (this.selectedTVInstance) {
                const decoded = decodeInstanceValue(this.selectedTVInstance, 'sonarr');
                url += `&app_type=${encodeURIComponent(decoded.appType || 'sonarr')}&instance_name=${encodeURIComponent(decoded.name || '')}`;
            }
            
            // Add filter parameters
            if (this.core.tvFilters) {
                const filterParams = this.core.tvFilters.getFilterParams();
                if (filterParams) {
                    url += `&${filterParams}`;
                }
            }
            
            const response = await fetch(url, { cache: 'no-store' });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();

            // Always clear the grid first to remove loading spinner (even for stale requests)
            if (this.tvPage === 1) {
                grid.innerHTML = '';
            }

            // Check if this request is still valid (not cancelled by a newer request)
            if (requestToken !== this.tvRequestToken || requestedInstance !== this.selectedTVInstance) {
                console.log('[RequestarrContent] Cancelled stale TV request, but spinner already cleared');
                return;
            }
            
            if (data.results && data.results.length > 0) {
                const tvDecoded = this.selectedTVInstance ? decodeInstanceValue(this.selectedTVInstance, 'sonarr') : null;
                data.results.forEach((item) => {
                    // Filter out hidden media
                    const tmdbId = item.tmdb_id || item.id;
                    // Filter globally blacklisted items
                    if (tmdbId && this.isGloballyBlacklisted(tmdbId, 'tv')) return;
                    if (tmdbId && tvDecoded && tvDecoded.name && this.isMediaHidden(tmdbId, 'tv', tvDecoded.appType, tvDecoded.name)) {
                        return; // Skip hidden items
                    }
                    grid.appendChild(this.createMediaCard(item));
                });

                // Use has_more from API if available, otherwise check result count
                if (data.has_more !== undefined) {
                    this.tvHasMore = data.has_more;
                } else {
                    // Fallback to old logic if API doesn't provide has_more
                    this.tvHasMore = data.results.length >= 20;
                }
            } else {
                grid.innerHTML = '<p style="color: #888; text-align: center; width: 100%; padding: 40px;">No TV shows found</p>';
                // Use has_more from API if available
                if (data.has_more !== undefined) {
                    this.tvHasMore = data.has_more;
                } else {
                    this.tvHasMore = false;
                }
            }
        } catch (error) {
            console.error('[RequestarrContent] Error loading TV shows:', error);
            if (this.tvPage === 1) {
                grid.innerHTML = '<p style="color: #ef4444; text-align: center; width: 100%; padding: 40px;">Failed to load TV shows</p>';
            }
        } finally {
            this.isLoadingTV = false;

            const sentinel = document.getElementById('tv-scroll-sentinel');
            if (sentinel && this.tvHasMore) {
                const rect = sentinel.getBoundingClientRect();
                const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
                if (rect.top <= viewportHeight + 200) {
                    this.loadMoreTV();
                }
            }
        }
    }
    
    setupTVInfiniteScroll() {
        const sentinel = document.getElementById('tv-scroll-sentinel');
        if (!sentinel || this.tvObserver) {
            return;
        }

        this.tvObserver = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) {
                    return;
                }
                if (this.tvHasMore && !this.isLoadingTV) {
                    this.loadMoreTV();
                }
            });
        }, {
            root: null,
            rootMargin: '200px 0px',
            threshold: 0
        });

        this.tvObserver.observe(sentinel);
    }
    
    loadMoreTV() {
        if (this.tvHasMore && !this.isLoadingTV) {
            this.tvPage++;
            this.loadTV(this.tvPage);
        }
    }

    // ========================================
    // SMART HUNT GRID
    // ========================================

    async loadSmartHuntGrid() {
        const grid = document.getElementById('smarthunt-grid');
        if (!grid) return;

        // Populate instance selectors on first load
        if (!this._smarthuntInstancesPopulated) {
            await this._populateSmartHuntInstances();
            this._smarthuntInstancesPopulated = true;
        }

        // Wire filter button once
        this._wireSmartHuntFilters();

        if (this.isLoadingSmartHunt) return;
        this.isLoadingSmartHunt = true;

        // Reset on first page
        if (this.smarthuntPage === 0) {
            this._smarthuntAllResults = [];
            grid.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Loading Smart Hunt...</p></div>';
        }

        const requestToken = ++this.smarthuntRequestToken;
        const nextPage = this.smarthuntPage + 1;

        try {
            const results = await this._fetchSmartHuntPage(nextPage);

            // Stale check
            if (requestToken !== this.smarthuntRequestToken) return;

            // Store raw results
            this._smarthuntAllResults = (this._smarthuntAllResults || []).concat(results);

            this.smarthuntPage = nextPage;
            this.smarthuntHasMore = nextPage < 5 && results.length > 0;

            // Re-render with filters
            this._renderSmartHuntGrid();
        } catch (error) {
            console.error('[RequestarrContent] Error loading Smart Hunt:', error);
            if (this.smarthuntPage === 0) {
                grid.innerHTML = '<p style="color: #ef4444; text-align: center; width: 100%; padding: 40px;">Failed to load Smart Hunt results</p>';
            }
        } finally {
            this.isLoadingSmartHunt = false;

            // Check if sentinel is already visible and load more
            const sentinel = document.getElementById('smarthunt-scroll-sentinel');
            if (sentinel && this.smarthuntHasMore) {
                const rect = sentinel.getBoundingClientRect();
                const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
                if (rect.top <= viewportHeight + 200) {
                    this.loadMoreSmartHunt();
                }
            }
        }
    }

    _renderSmartHuntGrid() {
        const grid = document.getElementById('smarthunt-grid');
        if (!grid) return;

        grid.innerHTML = '';
        const all = this._smarthuntAllResults || [];
        const filtered = this._applySmartHuntFilters(all);

        if (filtered.length === 0) {
            grid.innerHTML = '<p style="color: #888; text-align: center; width: 100%; padding: 40px;">No results match your filters</p>';
            return;
        }

        filtered.forEach(item => {
            const tmdbId = item.tmdb_id || item.id;
            if (tmdbId && this.isGloballyBlacklisted(tmdbId, item.media_type || 'movie')) return;
            const suggestedInstance = item.media_type === 'tv'
                ? this.selectedTVInstance
                : this.selectedMovieInstance;
            grid.appendChild(this.createMediaCard(item, suggestedInstance));
        });
    }

    _applySmartHuntFilters(results) {
        const f = this._shFilters || {};
        return results.filter(item => {
            // Hide library items
            if (f.hideAvailable && (item.in_library || item.partial)) return false;
            // Media type
            if (f.mediaType && f.mediaType !== 'all' && item.media_type !== f.mediaType) return false;
            // Year range
            const year = item.year || 0;
            if (f.yearMin && year < f.yearMin) return false;
            if (f.yearMax && year > f.yearMax) return false;
            // Rating range
            const rating = item.vote_average || 0;
            if (f.ratingMin !== undefined && f.ratingMin > 0 && rating < f.ratingMin) return false;
            if (f.ratingMax !== undefined && f.ratingMax < 10 && rating > f.ratingMax) return false;
            // Vote count range
            const votes = item.vote_count || 0;
            if (f.votesMin !== undefined && f.votesMin > 0 && votes < f.votesMin) return false;
            if (f.votesMax !== undefined && f.votesMax < 10000 && votes > f.votesMax) return false;
            return true;
        });
    }

    _wireSmartHuntFilters() {
        const filterBtn = document.getElementById('smarthunt-filter-btn');
        if (!filterBtn || filterBtn._shWired) return;
        filterBtn._shWired = true;

        // Initialize filter state
        const currentYear = new Date().getFullYear();
        const maxYear = currentYear + 3;
        this._shFilters = {
            hideAvailable: false,
            mediaType: 'all',
            yearMin: 1900,
            yearMax: maxYear,
            ratingMin: 0,
            ratingMax: 10,
            votesMin: 0,
            votesMax: 10000
        };
        this._shMaxYear = maxYear;

        // Set dynamic max year on sliders
        const yearMinEl = document.getElementById('sh-filter-year-min');
        const yearMaxEl = document.getElementById('sh-filter-year-max');
        if (yearMinEl) { yearMinEl.max = maxYear; }
        if (yearMaxEl) { yearMaxEl.max = maxYear; yearMaxEl.value = maxYear; }

        // Open modal on button click
        filterBtn.addEventListener('click', () => this._openSmartHuntFilterModal());

        // Global close function for onclick handlers in HTML
        window._closeSmartHuntFilters = () => this._closeSmartHuntFilterModal();

        // Wire all filter inputs for auto-apply
        const hideAvail = document.getElementById('sh-hide-available');
        if (hideAvail) {
            hideAvail.addEventListener('change', () => {
                this._shFilters.hideAvailable = hideAvail.checked;
                this._shAutoApply();
            });
        }

        const mediaType = document.getElementById('sh-media-type');
        if (mediaType) {
            mediaType.addEventListener('change', () => {
                this._shFilters.mediaType = mediaType.value;
                this._shAutoApply();
            });
        }

        // Year sliders
        if (yearMinEl && yearMaxEl) {
            const updateYear = () => {
                let min = parseInt(yearMinEl.value), max = parseInt(yearMaxEl.value);
                if (min > max) yearMinEl.value = max;
                this._updateShSliderRange('sh-year', yearMinEl, yearMaxEl);
                const display = document.getElementById('sh-year-display');
                if (display) display.textContent = `From ${yearMinEl.value} to ${yearMaxEl.value}`;
            };
            yearMinEl.addEventListener('input', updateYear);
            yearMaxEl.addEventListener('input', updateYear);
            yearMinEl.addEventListener('change', () => { this._shFilters.yearMin = parseInt(yearMinEl.value); this._shAutoApply(); });
            yearMaxEl.addEventListener('change', () => { this._shFilters.yearMax = parseInt(yearMaxEl.value); this._shAutoApply(); });
            this._updateShSliderRange('sh-year', yearMinEl, yearMaxEl);
        }

        // Rating sliders
        const ratingMinEl = document.getElementById('sh-filter-rating-min');
        const ratingMaxEl = document.getElementById('sh-filter-rating-max');
        if (ratingMinEl && ratingMaxEl) {
            const updateRating = () => {
                let min = parseFloat(ratingMinEl.value), max = parseFloat(ratingMaxEl.value);
                if (min > max) ratingMinEl.value = max;
                this._updateShSliderRange('sh-rating', ratingMinEl, ratingMaxEl);
                const display = document.getElementById('sh-rating-display');
                if (display) display.textContent = `Ratings between ${parseFloat(ratingMinEl.value).toFixed(1)} and ${parseFloat(ratingMaxEl.value).toFixed(1)}`;
            };
            ratingMinEl.addEventListener('input', updateRating);
            ratingMaxEl.addEventListener('input', updateRating);
            ratingMinEl.addEventListener('change', () => { this._shFilters.ratingMin = parseFloat(ratingMinEl.value); this._shAutoApply(); });
            ratingMaxEl.addEventListener('change', () => { this._shFilters.ratingMax = parseFloat(ratingMaxEl.value); this._shAutoApply(); });
            this._updateShSliderRange('sh-rating', ratingMinEl, ratingMaxEl);
        }

        // Votes sliders
        const votesMinEl = document.getElementById('sh-filter-votes-min');
        const votesMaxEl = document.getElementById('sh-filter-votes-max');
        if (votesMinEl && votesMaxEl) {
            const updateVotes = () => {
                let min = parseInt(votesMinEl.value), max = parseInt(votesMaxEl.value);
                if (min > max) votesMinEl.value = max;
                this._updateShSliderRange('sh-votes', votesMinEl, votesMaxEl);
                const display = document.getElementById('sh-votes-display');
                if (display) display.textContent = `Number of votes between ${votesMinEl.value} and ${votesMaxEl.value}`;
            };
            votesMinEl.addEventListener('input', updateVotes);
            votesMaxEl.addEventListener('input', updateVotes);
            votesMinEl.addEventListener('change', () => { this._shFilters.votesMin = parseInt(votesMinEl.value); this._shAutoApply(); });
            votesMaxEl.addEventListener('change', () => { this._shFilters.votesMax = parseInt(votesMaxEl.value); this._shAutoApply(); });
            this._updateShSliderRange('sh-votes', votesMinEl, votesMaxEl);
        }
    }

    _updateShSliderRange(prefix, minInput, maxInput) {
        const rangeEl = document.getElementById(`${prefix}-range`);
        if (!rangeEl) return;
        const min = parseFloat(minInput.value);
        const max = parseFloat(maxInput.value);
        const lo = parseFloat(minInput.min);
        const hi = parseFloat(minInput.max);
        const pctMin = ((min - lo) / (hi - lo)) * 100;
        const pctMax = ((max - lo) / (hi - lo)) * 100;
        rangeEl.style.left = pctMin + '%';
        rangeEl.style.width = (pctMax - pctMin) + '%';
    }

    _shAutoApply() {
        this._updateShFilterDisplay();
        this._renderSmartHuntGrid();
    }

    _updateShFilterDisplay() {
        let count = 0;
        const f = this._shFilters || {};
        if (f.hideAvailable) count++;
        if (f.mediaType && f.mediaType !== 'all') count++;
        if (f.yearMin > 1900 || (f.yearMax < this._shMaxYear)) count++;
        if (f.ratingMin > 0 || f.ratingMax < 10) count++;
        if (f.votesMin > 0 || f.votesMax < 10000) count++;

        const text = count === 0 ? '0 Active Filters' : count === 1 ? '1 Active Filter' : `${count} Active Filters`;
        const btnCount = document.getElementById('smarthunt-filter-count');
        if (btnCount) btnCount.textContent = text;
        const modalCount = document.getElementById('sh-filter-active-count');
        if (modalCount) modalCount.textContent = text;
    }

    _openSmartHuntFilterModal() {
        const modal = document.getElementById('smarthunt-filter-modal');
        if (modal) {
            modal.style.display = 'flex';
            setTimeout(() => modal.classList.add('show'), 10);
            document.body.style.overflow = 'hidden';
        }
    }

    _closeSmartHuntFilterModal() {
        const modal = document.getElementById('smarthunt-filter-modal');
        if (modal) {
            modal.classList.remove('show');
            setTimeout(() => {
                modal.style.display = 'none';
                document.body.style.overflow = '';
            }, 150);
        }
    }

    async _fetchSmartHuntPage(page) {
        const movieInst = this.selectedMovieInstance || '';
        const tvInst = this.selectedTVInstance || '';

        let movieAppType = 'radarr', movieName = '';
        if (movieInst && movieInst.includes(':')) {
            const idx = movieInst.indexOf(':');
            movieAppType = movieInst.substring(0, idx);
            movieName = movieInst.substring(idx + 1);
        } else {
            movieName = movieInst;
        }

        let tvAppType = 'sonarr', tvName = '';
        if (tvInst && tvInst.includes(':')) {
            const idx = tvInst.indexOf(':');
            tvAppType = tvInst.substring(0, idx);
            tvName = tvInst.substring(idx + 1);
        } else {
            tvName = tvInst;
        }

        const params = new URLSearchParams({
            page: String(page),
            movie_app_type: movieAppType,
            movie_instance_name: movieName,
            tv_app_type: tvAppType,
            tv_instance_name: tvName,
        });

        const resp = await fetch(`./api/requestarr/smarthunt?${params.toString()}&_=${Date.now()}`, { cache: 'no-store' });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        if (data.error) throw new Error(data.error);
        return data.results || [];
    }

    async _populateSmartHuntInstances() {
        const movieSelect = document.getElementById('smarthunt-movie-instance-select');
        const tvSelect = document.getElementById('smarthunt-tv-instance-select');
        if (!movieSelect && !tvSelect) return;

        try {
            const dd = await this._fetchBundleDropdownOptions();

            if (movieSelect) {
                this._populateSelectFromOptions(movieSelect, dd.movie_options, this.selectedMovieInstance);
                if (!movieSelect._shChangeWired) {
                    movieSelect._shChangeWired = true;
                    movieSelect.addEventListener('change', async () => {
                        await this._setMovieInstance(movieSelect.value);
                        this._reloadSmartHuntGrid();
                    });
                }
            }

            if (tvSelect) {
                this._populateSelectFromOptions(tvSelect, dd.tv_options, this.selectedTVInstance);
                if (!tvSelect._shChangeWired) {
                    tvSelect._shChangeWired = true;
                    tvSelect.addEventListener('change', async () => {
                        await this._setTVInstance(tvSelect.value);
                        this._reloadSmartHuntGrid();
                    });
                }
            }
        } catch (error) {
            console.error('[RequestarrContent] Error populating Smart Hunt instances:', error);
        }
    }

    _reloadSmartHuntGrid() {
        this.smarthuntPage = 0;
        this.smarthuntHasMore = true;
        this.isLoadingSmartHunt = false;
        this.smarthuntRequestToken++;
        this._smarthuntAllResults = [];
        if (this.smarthuntObserver) {
            this.smarthuntObserver.disconnect();
            this.smarthuntObserver = null;
        }
        this.loadSmartHuntGrid();
        this.setupSmartHuntInfiniteScroll();
    }

    setupSmartHuntInfiniteScroll() {
        const sentinel = document.getElementById('smarthunt-scroll-sentinel');
        if (!sentinel || this.smarthuntObserver) return;

        this.smarthuntObserver = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                if (this.smarthuntHasMore && !this.isLoadingSmartHunt) {
                    this.loadMoreSmartHunt();
                }
            });
        }, {
            root: null,
            rootMargin: '200px 0px',
            threshold: 0
        });

        this.smarthuntObserver.observe(sentinel);
    }

    loadMoreSmartHunt() {
        if (this.smarthuntHasMore && !this.isLoadingSmartHunt) {
            this.loadSmartHuntGrid();
        }
    }

    // ========================================
    // MEDIA CARD CREATION
    // ========================================

    createMediaCard(item, suggestedInstance = null) {
        const card = document.createElement('div');
        card.className = 'media-card';
        
        // Store tmdb_id and media_type as data attributes for easy updates
        card.setAttribute('data-tmdb-id', item.tmdb_id);
        card.setAttribute('data-media-type', item.media_type);
        // Store full item data for hide functionality
        card.itemData = item;
        
        // Store suggested instance for modal
        card.suggestedInstance = suggestedInstance;
        
        const posterUrl = item.poster_path || './static/images/blackout.jpg';
        const year = item.year || 'N/A';
        const rating = item.vote_average ? item.vote_average.toFixed(1) : 'N/A';
        const overview = item.overview || 'No description available.';
        
        const inLibrary = item.in_library || false;
        const partial = item.partial || false;
        const importable = item.importable || false;
        const pending = item.pending || false;
        const hasInstance = item.media_type === 'movie'
            ? ((this.core.instances.radarr || []).length > 0 || (this.core.instances.movie_hunt || []).length > 0)
            : ((this.core.instances.sonarr || []).length > 0 || (this.core.instances.tv_hunt || []).length > 0);
        const metaClassName = hasInstance ? 'media-card-meta' : 'media-card-meta no-hide';
        
        // Determine status badge (shared utility)
        const statusBadgeHTML = window.MediaUtils ? window.MediaUtils.getStatusBadge(inLibrary, partial, hasInstance, importable, pending) : '';
        
        if (inLibrary || partial) {
            card.classList.add('in-library');
        }
        
        // Only show Request button when not in library or collection
        const showRequestBtn = !inLibrary && !partial;
        const overlayActionHTML = showRequestBtn
            ? '<button class="media-card-request-btn"><i class="fas fa-download"></i> Request</button>'
            : '';
        
        const typeBadgeLabel = item.media_type === 'tv' ? 'TV' : 'Movie';
        const typeBadgeHTML = `<span class="media-type-badge">${typeBadgeLabel}</span>`;

        // Check if globally blacklisted
        const isBlacklisted = this.isGloballyBlacklisted(item.tmdb_id, item.media_type);
        const blacklistBadgeHTML = isBlacklisted ? '<span class="media-blacklist-badge"><i class="fas fa-ban"></i> Blacklisted</span>' : '';
        const blacklistOverlayHTML = isBlacklisted ? '<div class="media-card-blacklist-overlay"><i class="fas fa-ban"></i> Globally Blacklisted</div>' : '';

        card.innerHTML = `
            <div class="media-card-poster">
                ${statusBadgeHTML}
                <img src="${posterUrl}" alt="${item.title}" onerror="this.src='./static/images/blackout.jpg'">
                ${typeBadgeHTML}
                ${blacklistBadgeHTML}
                <div class="media-card-overlay">
                    <div class="media-card-overlay-title">${item.title}</div>
                    <div class="media-card-overlay-content">
                        <div class="media-card-overlay-year">${year}</div>
                        <div class="media-card-overlay-description">${overview}</div>
                        ${isBlacklisted ? blacklistOverlayHTML : overlayActionHTML}
                    </div>
                </div>
            </div>
            <div class="media-card-info">
                <div class="media-card-title" title="${item.title}">${item.title}</div>
                <div class="${metaClassName}">
                    <span class="media-card-year">${year}</span>
                    <span class="media-card-rating">
                        <i class="fas fa-star"></i>
                        ${rating}
                    </span>
                    ${window.MediaUtils ? window.MediaUtils.getActionButton(inLibrary, partial, hasInstance) : ''}
                </div>
            </div>
        `;
        
        // Load and cache image asynchronously after card is created
        if (posterUrl && !posterUrl.includes('./static/images/') && window.getCachedTMDBImage && window.tmdbImageCache) {
            const imgElement = card.querySelector('.media-card-poster img');
            if (imgElement) {
                window.getCachedTMDBImage(posterUrl, window.tmdbImageCache).then(cachedUrl => {
                    if (cachedUrl && cachedUrl !== posterUrl) {
                        imgElement.src = cachedUrl;
                    }
                }).catch(err => {
                    console.error('[RequestarrContent] Failed to cache image:', err);
                });
            }
        }
        
        const requestBtn = card.querySelector('.media-card-request-btn');
        const hideBtn = card.querySelector('.media-card-hide-btn');
        const deleteBtn = card.querySelector('.media-card-delete-btn');
        
        // Click anywhere on card opens detail page (poster/body); Request button opens modal
        card.style.cursor = 'pointer';
        card.addEventListener('click', (e) => {
            // Request button opens modal only
            if (requestBtn && (e.target === requestBtn || requestBtn.contains(e.target))) {
                e.preventDefault();
                e.stopPropagation();
                this.core.modal.openModal(item.tmdb_id, item.media_type, card.suggestedInstance);
                return;
            }
            // Delete button opens delete modal
            if (deleteBtn && (e.target === deleteBtn || deleteBtn.contains(e.target))) {
                e.preventDefault();
                e.stopPropagation();
                this._openDeleteModal(item, card);
                return;
            }
            // Hide button only hides
            if (hideBtn && (e.target === hideBtn || hideBtn.contains(e.target))) {
                e.preventDefault();
                e.stopPropagation();
                this.hideMedia(item.tmdb_id, item.media_type, item.title, card);
                return;
            }
            
            // Check live card state — badge may have been updated by _syncCardBadge
            // after initial render (e.g. modal detected show exists in collection)
            const liveInLibrary = card.classList.contains('in-library');
            const liveBadge = card.querySelector('.media-card-status-badge');
            const livePartial = liveBadge ? liveBadge.classList.contains('partial') : false;
            const livePending = liveBadge ? liveBadge.classList.contains('pending') : false;
            const shouldOpenModal = !liveInLibrary && !livePartial || livePending;

            if (item.media_type === 'movie') {
                if (!shouldOpenModal && window.RequestarrDetail && window.RequestarrDetail.openDetail) {
                    window.RequestarrDetail.openDetail({
                        tmdb_id: item.tmdb_id, id: item.tmdb_id,
                        title: item.title, year: item.year,
                        poster_path: item.poster_path, backdrop_path: item.backdrop_path,
                        overview: item.overview, vote_average: item.vote_average,
                        in_library: liveInLibrary
                    }, { suggestedInstance: card.suggestedInstance });
                } else {
                    this.core.modal.openModal(item.tmdb_id, item.media_type, card.suggestedInstance);
                }
            } else {
                if (!shouldOpenModal && window.RequestarrTVDetail && window.RequestarrTVDetail.openDetail) {
                    window.RequestarrTVDetail.openDetail({
                        tmdb_id: item.tmdb_id, id: item.tmdb_id,
                        title: item.title, name: item.title, year: item.year,
                        poster_path: item.poster_path, backdrop_path: item.backdrop_path,
                        overview: item.overview, vote_average: item.vote_average,
                        in_library: liveInLibrary
                    }, { suggestedInstance: card.suggestedInstance });
                } else {
                    this.core.modal.openModal(item.tmdb_id, item.media_type, card.suggestedInstance);
                }
            }
        });
        
        return card;
    }

    /**
     * Open the shared delete modal from a Requestarr card.
     */
    _openDeleteModal(item, cardElement) {
        if (!window.MovieCardDeleteModal) {
            console.error('[RequestarrContent] MovieCardDeleteModal not loaded');
            return;
        }
        const inLibrary = item.in_library || false;
        const partial = item.partial || false;
        const status = inLibrary ? 'available' : (partial ? 'requested' : 'requested');

        // Resolve instance info from compound value
        let appType = 'movie_hunt';
        let instanceName = '';
        let instanceId = '';
        const compoundValue = this.selectedMovieInstance || (cardElement.suggestedInstance || '');
        if (compoundValue) {
            const decoded = decodeInstanceValue(compoundValue);
            appType = decoded.appType || 'movie_hunt';
            instanceName = decoded.name || '';
        }
        // Try to resolve numeric instance ID
        if (this.core && this.core.instances) {
            const pool = this.core.instances[appType] || [];
            const match = pool.find(i => i.name === instanceName);
            if (match) instanceId = match.id || '';
        }

        window.MovieCardDeleteModal.open(item, {
            instanceName: instanceName,
            instanceId: instanceId,
            status: status,
            hasFile: inLibrary,
            appType: appType,
            onDeleted: function() {
                window.MediaUtils.animateCardRemoval(cardElement);
            }
        });
    }

    hideMedia(tmdbId, mediaType, title, cardElement) {
        const self = this;
        const item = cardElement.itemData || {};
        const posterPath = item.poster_path || null;

        // Resolve app_type and instance name
        let appType, instanceName;
        if (mediaType === 'movie') {
            const compoundValue = self.selectedMovieInstance || (cardElement.suggestedInstance || '');
            if (compoundValue) {
                const decoded = decodeInstanceValue(compoundValue);
                appType = decoded.appType;
                instanceName = decoded.name;
            } else if (self.core && self.core.instances) {
                const mhInst = self.core.instances.movie_hunt || [];
                const rInst = self.core.instances.radarr || [];
                if (mhInst.length > 0) { appType = 'movie_hunt'; instanceName = mhInst[0].name; }
                else if (rInst.length > 0) { appType = 'radarr'; instanceName = rInst[0].name; }
                else { appType = 'radarr'; instanceName = null; }
            } else {
                appType = 'radarr'; instanceName = null;
            }
        } else {
            appType = 'sonarr';
            instanceName = self.selectedTVInstance;
            if (!instanceName && cardElement.suggestedInstance) instanceName = cardElement.suggestedInstance;
            if (!instanceName && self.core && self.core.instances) {
                const instances = self.core.instances.sonarr || [];
                instanceName = instances.length > 0 ? instances[0].name : null;
            }
        }

        window.MediaUtils.hideMedia({
            tmdbId: tmdbId,
            mediaType: mediaType,
            title: title,
            posterPath: posterPath,
            appType: appType || 'radarr',
            instanceName: instanceName || '',
            cardElement: cardElement,
            hiddenMediaSet: self.hiddenMediaSet
        });
    }
}
