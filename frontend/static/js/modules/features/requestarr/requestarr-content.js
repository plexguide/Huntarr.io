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
        // Allow _loadServerDefaults to re-fetch (instance selection may have changed)
        this._serverDefaultsLoaded = false;
        this._movieInstancesPopulated = false;
        this._tvInstancesPopulated = false;
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
        const ids = ['movies-instance-select', 'discover-movie-instance-select', 'home-movie-instance-select'];
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
        const ids = ['tv-instance-select', 'discover-tv-instance-select', 'home-tv-instance-select'];
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

    async _populateDiscoverMovieInstances() {
        const select = document.getElementById('discover-movie-instance-select');
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
                    name: String(inst.name).trim(), _appType: 'movie_hunt',
                    _label: `Movie Hunt \u2013 ${String(inst.name).trim()}`
                })),
                ...(radarrData.instances || []).map(inst => ({
                    name: String(inst.name).trim(), _appType: 'radarr',
                    _label: `Radarr \u2013 ${String(inst.name).trim()}`
                }))
            ];

            // Preserve current selection before clearing
            const previousValue = this.selectedMovieInstance || select.value || '';

            select.innerHTML = '';
            if (allInstances.length === 0) {
                select.innerHTML = '<option value="">No movie instances</option>';
                return;
            }

            allInstances.forEach((inst) => {
                const cv = encodeInstanceValue(inst._appType, inst.name);
                const opt = document.createElement('option');
                opt.value = cv;
                opt.textContent = inst._label;
                if (previousValue && (cv === previousValue || inst.name === previousValue)) opt.selected = true;
                select.appendChild(opt);
            });

            // Update in-memory selection to match what's actually selected
            if (select.value) {
                this.selectedMovieInstance = select.value;
            }

            // Only attach change listener once
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
            const _ts = Date.now();
            const [thResponse, sonarrResponse] = await Promise.all([
                fetch(`./api/requestarr/instances/tv_hunt?t=${_ts}`, { cache: 'no-store' }),
                fetch(`./api/requestarr/instances/sonarr?t=${_ts}`, { cache: 'no-store' })
            ]);
            const thData = await thResponse.json();
            const sonarrData = await sonarrResponse.json();

            const allInstances = [
                ...(thData.instances || []).map(inst => ({
                    name: String(inst.name).trim(), _appType: 'tv_hunt',
                    _label: `TV Hunt \u2013 ${String(inst.name).trim()}`
                })),
                ...(sonarrData.instances || []).map(inst => ({
                    name: String(inst.name).trim(), _appType: 'sonarr',
                    _label: `Sonarr \u2013 ${String(inst.name).trim()}`
                }))
            ];

            // Preserve current selection before clearing
            const previousValue = this.selectedTVInstance || select.value || '';

            select.innerHTML = '';
            if (allInstances.length === 0) {
                select.innerHTML = '<option value="">No TV instances</option>';
                return;
            }

            allInstances.forEach((inst) => {
                const cv = encodeInstanceValue(inst._appType, inst.name);
                const opt = document.createElement('option');
                opt.value = cv;
                opt.textContent = inst._label;
                if (previousValue && (cv === previousValue || inst.name === previousValue)) opt.selected = true;
                select.appendChild(opt);
            });

            // Update in-memory selection to match what's actually selected
            if (select.value) {
                this.selectedTVInstance = select.value;
            }

            // Only attach change listener once
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

        // Already populated? Just sync the selection and return.
        if (this._movieInstancesPopulated) {
            this._syncAllMovieSelectors();
            return;
        }

        // Prevent concurrent calls (race condition protection)
        if (this._loadingMovieInstances) {
            console.log('[RequestarrContent] loadMovieInstances already in progress, skipping');
            return;
        }
        this._loadingMovieInstances = true;

        // Clear existing options immediately to prevent duplicates if called multiple times
        select.innerHTML = '<option value="">Loading instances...</option>';

        try {
            // Fetch both Movie Hunt and Radarr instances in parallel (cache-bust for fresh data)
            const _ts = Date.now();
            const [mhResponse, radarrResponse] = await Promise.all([
                fetch(`./api/requestarr/instances/movie_hunt?t=${_ts}`, { cache: 'no-store' }),
                fetch(`./api/requestarr/instances/radarr?t=${_ts}`, { cache: 'no-store' })
            ]);
            const mhData = await mhResponse.json();
            const radarrData = await radarrResponse.json();
            
            const mhInstances = (mhData.instances || []).map(inst => ({
                ...inst,
                name: String(inst.name).trim(),
                _appType: 'movie_hunt',
                _label: `Movie Hunt \u2013 ${String(inst.name).trim()}`
            }));
            const radarrInstances = (radarrData.instances || []).map(inst => ({
                ...inst,
                name: String(inst.name).trim(),
                _appType: 'radarr',
                _label: `Radarr \u2013 ${String(inst.name).trim()}`
            }));
            
            // Combine: Movie Hunt first, then Radarr
            const allInstances = [...mhInstances, ...radarrInstances];
            console.log('[RequestarrContent] Movie Hunt instances:', mhInstances.length, 'Radarr instances:', radarrInstances.length);
            
            if (allInstances.length > 0) {
                // Clear before adding real instances
                select.innerHTML = '';
                
                // Server-side is the single source of truth (loaded in _loadServerDefaults)
                const savedValue = this.selectedMovieInstance;
                
                // Deduplicate by compound key
                const uniqueInstances = [];
                const seenKeys = new Set();
                allInstances.forEach((instance) => {
                    if (!instance.name) return;
                    const compoundVal = encodeInstanceValue(instance._appType, instance.name);
                    const seenKey = compoundVal.toLowerCase();
                    if (seenKeys.has(seenKey)) return;
                    uniqueInstances.push({ ...instance, _compoundValue: compoundVal });
                    seenKeys.add(seenKey);
                });
                console.log('[RequestarrContent] After deduplication:', uniqueInstances.length, 'unique movie instances');
                
                if (uniqueInstances.length === 0) {
                    select.innerHTML = '<option value="">No movie instances configured</option>';
                    this.selectedMovieInstance = null;
                    return;
                }

                let selectedIndex = 0;
                
                uniqueInstances.forEach((instance, index) => {
                    const option = document.createElement('option');
                    option.value = instance._compoundValue;
                    option.textContent = instance._label;
                    
                    // Select based on saved server-side value
                    if (savedValue && (instance._compoundValue === savedValue || instance.name === savedValue)) {
                        option.selected = true;
                        selectedIndex = index;
                    } else if (!savedValue && index === 0) {
                        option.selected = true;
                    }
                    
                    select.appendChild(option);
                });
                
                // Set initial selected instance and persist to server
                this._setMovieInstance(uniqueInstances[selectedIndex]._compoundValue);
                console.log(`[RequestarrContent] Using movie instance: ${this.selectedMovieInstance}`);
                
                // Setup change handler (remove old listener if any)
                const newSelect = select.cloneNode(true);
                if (select.parentNode) {
                    select.parentNode.replaceChild(newSelect, select);
                } else {
                    // If select is detached, find it again in the DOM
                    const currentSelect = document.getElementById('movies-instance-select');
                    if (currentSelect && currentSelect.parentNode) {
                        currentSelect.parentNode.replaceChild(newSelect, currentSelect);
                    }
                }
                
                newSelect.addEventListener('change', async () => {
                    await this._setMovieInstance(newSelect.value);
                    console.log(`[RequestarrContent] Switched to movie instance: ${this.selectedMovieInstance}`);
                    
                    // Clear the grid immediately
                    const grid = document.getElementById('movies-grid');
                    if (grid) {
                        grid.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Loading movies...</p></div>';
                    }
                    
                    // Disconnect infinite scroll observer during instance switch to prevent auto-loading
                    if (this.moviesObserver) {
                        this.moviesObserver.disconnect();
                        this.moviesObserver = null;
                    }
                    
                    // Reset pagination state
                    this.moviesPage = 1;
                    this.moviesHasMore = true;
                    this.isLoadingMovies = false;
                    
                    // Increment request token to cancel any pending requests
                    this.moviesRequestToken++;
                    
                    // Small delay to ensure state is fully reset
                    await new Promise(resolve => setTimeout(resolve, 50));
                    
                    // Await the load to complete before reconnecting scroll
                    await this.loadMovies();
                    
                    // Reconnect infinite scroll after load completes
                    this.setupMoviesInfiniteScroll();
                });
                this._movieInstancesPopulated = true;
            } else {
                select.innerHTML = '<option value="">No movie instances configured</option>';
                this.selectedMovieInstance = null;
                this._movieInstancesPopulated = true;
            }
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

        // Already populated? Just sync the selection and return.
        if (this._tvInstancesPopulated) {
            this._syncAllTVSelectors();
            return;
        }

        // Prevent concurrent calls (race condition protection)
        if (this._loadingTVInstances) {
            console.log('[RequestarrContent] loadTVInstances already in progress, skipping');
            return;
        }
        this._loadingTVInstances = true;

        // Clear existing options immediately to prevent duplicates if called multiple times
        select.innerHTML = '<option value="">Loading instances...</option>';

        try {
            // Fetch TV Hunt and Sonarr from requestarr (filtered by services config)
            const _ts = Date.now();
            const [thResponse, sonarrResponse] = await Promise.all([
                fetch(`./api/requestarr/instances/tv_hunt?t=${_ts}`, { cache: 'no-store' }),
                fetch(`./api/requestarr/instances/sonarr?t=${_ts}`, { cache: 'no-store' })
            ]);
            const thData = await thResponse.json();
            const sonarrData = await sonarrResponse.json();

            const thInstances = (thData.instances || []).map(inst => ({
                ...inst,
                name: String(inst.name).trim(),
                _appType: 'tv_hunt',
                _label: `TV Hunt \u2013 ${String(inst.name).trim()}`
            }));
            const sonarrInstances = (sonarrData.instances || []).map(inst => ({
                ...inst,
                name: String(inst.name).trim(),
                _appType: 'sonarr',
                _label: `Sonarr \u2013 ${String(inst.name).trim()}`
            }));

            // Update core.instances.tv_hunt so request modal has TV Hunt options
            this.core.instances.tv_hunt = thInstances.map(i => ({ name: i.name, id: i.id }));

            // Combine: TV Hunt first, then Sonarr
            const allInstances = [...thInstances, ...sonarrInstances];
            console.log('[RequestarrContent] TV Hunt instances:', thInstances.length, 'Sonarr instances:', sonarrInstances.length);

            if (allInstances.length > 0) {
                // Clear again before adding real instances
                select.innerHTML = '';

                // Server-side is the single source of truth (loaded in _loadServerDefaults)
                const savedValue = this.selectedTVInstance;

                // Deduplicate by compound key
                const uniqueInstances = [];
                const seenKeys = new Set();
                allInstances.forEach((instance) => {
                    if (!instance.name) return;
                    const compoundVal = encodeInstanceValue(instance._appType, instance.name);
                    const seenKey = compoundVal.toLowerCase();
                    if (seenKeys.has(seenKey)) return;
                    uniqueInstances.push({ ...instance, _compoundValue: compoundVal });
                    seenKeys.add(seenKey);
                });
                console.log('[RequestarrContent] After deduplication:', uniqueInstances.length, 'unique TV instances');

                if (uniqueInstances.length === 0) {
                    select.innerHTML = '<option value="">No TV instances configured</option>';
                    this.selectedTVInstance = null;
                    return;
                }

                let selectedIndex = 0;

                uniqueInstances.forEach((instance, index) => {
                    const option = document.createElement('option');
                    option.value = instance._compoundValue;
                    option.textContent = instance._label;

                    // Select based on saved server-side value
                    if (savedValue && (instance._compoundValue === savedValue || instance.name === savedValue)) {
                        option.selected = true;
                        selectedIndex = index;
                    } else if (!savedValue && index === 0) {
                        option.selected = true;
                    }

                    select.appendChild(option);
                });

                // Set initial selected instance and persist to server
                this._setTVInstance(uniqueInstances[selectedIndex]._compoundValue);
                console.log(`[RequestarrContent] Using TV instance: ${this.selectedTVInstance}`);
                
                // Setup change handler (remove old listener if any)
                const newSelect = select.cloneNode(true);
                if (select.parentNode) {
                    select.parentNode.replaceChild(newSelect, select);
                } else {
                    // If select is detached, find it again in the DOM
                    const currentSelect = document.getElementById('tv-instance-select');
                    if (currentSelect && currentSelect.parentNode) {
                        currentSelect.parentNode.replaceChild(newSelect, currentSelect);
                    }
                }
                
                newSelect.addEventListener('change', async () => {
                    await this._setTVInstance(newSelect.value);
                    console.log(`[RequestarrContent] Switched to TV instance: ${this.selectedTVInstance}`);
                    
                    // Clear the grid immediately
                    const grid = document.getElementById('tv-grid');
                    if (grid) {
                        grid.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Loading TV shows...</p></div>';
                    }
                    
                    // Disconnect infinite scroll observer during instance switch to prevent auto-loading
                    if (this.tvObserver) {
                        this.tvObserver.disconnect();
                        this.tvObserver = null;
                    }
                    
                    // Reset pagination state
                    this.tvPage = 1;
                    this.tvHasMore = true;
                    this.isLoadingTV = false;
                    
                    // Increment request token to cancel any pending requests
                    this.tvRequestToken++;
                    
                    // Small delay to ensure state is fully reset
                    await new Promise(resolve => setTimeout(resolve, 50));
                    
                    // Await the load to complete before reconnecting scroll
                    await this.loadTV();
                    
                    // Reconnect infinite scroll after load completes
                    this.setupTVInfiniteScroll();
                });
                this._tvInstancesPopulated = true;
            } else {
                select.innerHTML = '<option value="">No TV instances configured</option>';
                this.selectedTVInstance = null;
                this._tvInstancesPopulated = true;
            }
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
