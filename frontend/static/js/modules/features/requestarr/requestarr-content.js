/**
 * Requestarr Content - Content loading and media card creation
 */

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
        
        // Instance tracking
        this.selectedMovieInstance = null;
        this.selectedTVInstance = null;
        this.defaultMovieInstance = '';
        this.defaultTVInstance = '';
        
        // Hidden media tracking
        this.hiddenMediaSet = new Set();

        // Shared discovery cache with home page (24h) - same keys so both pages benefit
        this.DISCOVERY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
        this.DISCOVERY_CACHE_KEYS = { trending: 'huntarr-home-discovery-trending', movies: 'huntarr-home-discovery-movies', tv: 'huntarr-home-discovery-tv' };
    }

    getDiscoveryCache(section) {
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
    }

    setDiscoveryCache(section, results) {
        const key = this.DISCOVERY_CACHE_KEYS[section];
        if (!key || !Array.isArray(results)) return;
        try {
            localStorage.setItem(key, JSON.stringify({ results, timestamp: Date.now() }));
        } catch (e) {
            console.warn('[RequestarrContent] Discovery cache write failed:', e);
        }
    }

    // ========================================
    // INSTANCE MANAGEMENT
    // ========================================

    async setupInstanceSelectors() {
        // Load and populate instance selectors
        await this.loadMovieInstances();
        await this.loadTVInstances();
    }

    async loadMovieInstances() {
        const select = document.getElementById('movies-instance-select');
        if (!select) return;

        // Prevent concurrent calls (race condition protection)
        if (this._loadingMovieInstances) {
            console.log('[RequestarrContent] loadMovieInstances already in progress, skipping');
            return;
        }
        this._loadingMovieInstances = true;

        // Clear existing options immediately to prevent duplicates if called multiple times
        select.innerHTML = '<option value="">Loading instances...</option>';

        try {
            const response = await fetch('./api/requestarr/instances/radarr');
            const data = await response.json();
            console.log('[RequestarrContent] Radarr API returned', data.instances?.length || 0, 'instances');
            
            if (data.instances && data.instances.length > 0) {
                // Clear again before adding real instances
                select.innerHTML = '';
                
                // Priority: 1) Saved settings default, 2) localStorage, 3) First instance
                let defaultInstanceName = null;
                
                // Try to get default from settings
                try {
                    const settingsResponse = await fetch('./api/requestarr/settings/default-instances');
                    const settingsData = await settingsResponse.json();
                    if (settingsData.success && settingsData.defaults && settingsData.defaults.movie_instance) {
                        defaultInstanceName = settingsData.defaults.movie_instance;
                    }
                } catch (error) {
                    console.log('[RequestarrContent] No default movie instance in settings');
                }
                
                // Fall back to localStorage if no settings default
                if (!defaultInstanceName) {
                    const savedInstance = localStorage.getItem('requestarr-selected-movie-instance');
                    if (savedInstance) {
                        defaultInstanceName = savedInstance;
                    }
                }
                
                const uniqueInstances = [];
                const seenNames = new Set();
                data.instances.forEach((instance) => {
                    if (!instance || !instance.name) {
                        return;
                    }
                    const normalizedName = String(instance.name).trim();
                    if (!normalizedName) {
                        return;
                    }
                    const seenKey = normalizedName.toLowerCase();
                    if (seenNames.has(seenKey)) {
                        return;
                    }
                    uniqueInstances.push({ ...instance, name: normalizedName });
                    seenNames.add(seenKey);
                });
                console.log('[RequestarrContent] After deduplication:', uniqueInstances.length, 'unique Radarr instances');
                
                if (uniqueInstances.length === 0) {
                    select.innerHTML = '<option value="">No Radarr instances configured</option>';
                    this.selectedMovieInstance = null;
                    return;
                }

                let selectedIndex = 0;
                
                uniqueInstances.forEach((instance, index) => {
                    const option = document.createElement('option');
                    option.value = instance.name;
                    option.textContent = `Radarr - ${instance.name}`;
                    
                    // Select the instance based on priority
                    if (defaultInstanceName && instance.name === defaultInstanceName) {
                        option.selected = true;
                        selectedIndex = index;
                    } else if (!defaultInstanceName && index === 0) {
                        option.selected = true;
                    }
                    
                    select.appendChild(option);
                });
                
                // Set initial selected instance
                this.selectedMovieInstance = uniqueInstances[selectedIndex].name;
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
                    this.selectedMovieInstance = newSelect.value;
                    console.log(`[RequestarrContent] Switched to movie instance: ${this.selectedMovieInstance}`);
                    
                    // Save to localStorage (session preference)
                    localStorage.setItem('requestarr-selected-movie-instance', this.selectedMovieInstance);
                    
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
            } else {
                select.innerHTML = '<option value="">No Radarr instances configured</option>';
                this.selectedMovieInstance = null;
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

        // Prevent concurrent calls (race condition protection)
        if (this._loadingTVInstances) {
            console.log('[RequestarrContent] loadTVInstances already in progress, skipping');
            return;
        }
        this._loadingTVInstances = true;

        // Clear existing options immediately to prevent duplicates if called multiple times
        select.innerHTML = '<option value="">Loading instances...</option>';

        try {
            const response = await fetch('./api/requestarr/instances/sonarr');
            const data = await response.json();
            console.log('[RequestarrContent] Sonarr API returned', data.instances?.length || 0, 'instances');
            
            if (data.instances && data.instances.length > 0) {
                // Clear again before adding real instances
                select.innerHTML = '';
                
                // Priority: 1) Saved settings default, 2) localStorage, 3) First instance
                let defaultInstanceName = null;
                
                // Try to get default from settings
                try {
                    const settingsResponse = await fetch('./api/requestarr/settings/default-instances');
                    const settingsData = await settingsResponse.json();
                    if (settingsData.success && settingsData.defaults && settingsData.defaults.tv_instance) {
                        defaultInstanceName = settingsData.defaults.tv_instance;
                    }
                } catch (error) {
                    console.log('[RequestarrContent] No default TV instance in settings');
                }
                
                // Fall back to localStorage if no settings default
                if (!defaultInstanceName) {
                    const savedInstance = localStorage.getItem('requestarr-selected-tv-instance');
                    if (savedInstance) {
                        defaultInstanceName = savedInstance;
                    }
                }
                
                const uniqueInstances = [];
                const seenNames = new Set();
                data.instances.forEach((instance) => {
                    if (!instance || !instance.name) {
                        return;
                    }
                    const normalizedName = String(instance.name).trim();
                    if (!normalizedName) {
                        return;
                    }
                    const seenKey = normalizedName.toLowerCase();
                    if (seenNames.has(seenKey)) {
                        return;
                    }
                    uniqueInstances.push({ ...instance, name: normalizedName });
                    seenNames.add(seenKey);
                });
                console.log('[RequestarrContent] After deduplication:', uniqueInstances.length, 'unique Sonarr instances');
                
                if (uniqueInstances.length === 0) {
                    select.innerHTML = '<option value="">No Sonarr instances configured</option>';
                    this.selectedTVInstance = null;
                    return;
                }

                let selectedIndex = 0;
                
                uniqueInstances.forEach((instance, index) => {
                    const option = document.createElement('option');
                    option.value = instance.name;
                    option.textContent = `Sonarr - ${instance.name}`;
                    
                    // Select the instance based on priority
                    if (defaultInstanceName && instance.name === defaultInstanceName) {
                        option.selected = true;
                        selectedIndex = index;
                    } else if (!defaultInstanceName && index === 0) {
                        option.selected = true;
                    }
                    
                    select.appendChild(option);
                });
                
                // Set initial selected instance
                this.selectedTVInstance = uniqueInstances[selectedIndex].name;
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
                    this.selectedTVInstance = newSelect.value;
                    console.log(`[RequestarrContent] Switched to TV instance: ${this.selectedTVInstance}`);
                    
                    // Save to localStorage (session preference)
                    localStorage.setItem('requestarr-selected-tv-instance', this.selectedTVInstance);
                    
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
            } else {
                select.innerHTML = '<option value="">No Sonarr instances configured</option>';
                this.selectedTVInstance = null;
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
        // Load default instances first
        try {
            const settingsResponse = await fetch('./api/requestarr/settings/default-instances');
            const settingsData = await settingsResponse.json();
            if (settingsData.success && settingsData.defaults) {
                this.defaultMovieInstance = settingsData.defaults.movie_instance || '';
                this.defaultTVInstance = settingsData.defaults.tv_instance || '';
                console.log('[RequestarrContent] Loaded default instances:', {
                    movie: this.defaultMovieInstance,
                    tv: this.defaultTVInstance
                });
            }
        } catch (error) {
            console.error('[RequestarrContent] Error loading default instances:', error);
            this.defaultMovieInstance = '';
            this.defaultTVInstance = '';
        }
        
        // Load hidden media IDs for filtering
        await this.loadHiddenMediaIds();
        
        await Promise.all([
            this.loadTrending(),
            this.loadPopularMovies(),
            this.loadPopularTV()
        ]);
    }

    async loadHiddenMediaIds() {
        try {
            // Fetch all hidden media (no pagination, we need all IDs)
            const response = await fetch('./api/requestarr/hidden-media?page=1&page_size=10000');
            const data = await response.json();
            const hiddenItems = Array.isArray(data.hidden_media)
                ? data.hidden_media
                : (Array.isArray(data.items) ? data.items : []);
            
            // Store hidden media as a Set of "tmdb_id:media_type:app_type:instance" for fast lookup
            this.hiddenMediaSet = new Set();
            hiddenItems.forEach(item => {
                const key = `${item.tmdb_id}:${item.media_type}:${item.app_type}:${item.instance_name}`;
                this.hiddenMediaSet.add(key);
            });
            console.log('[RequestarrContent] Loaded', this.hiddenMediaSet.size, 'hidden media items');
        } catch (error) {
            console.error('[RequestarrContent] Error loading hidden media IDs:', error);
            this.hiddenMediaSet = new Set();
        }
    }

    isMediaHidden(tmdbId, mediaType, appType, instanceName) {
        if (!this.hiddenMediaSet) return false;
        const key = `${tmdbId}:${mediaType}:${appType}:${instanceName}`;
        return this.hiddenMediaSet.has(key);
    }

    renderTrendingResults(carousel, results) {
        if (!carousel) return;
        if (results && results.length > 0) {
            carousel.innerHTML = '';
            results.forEach(item => {
                const suggestedInstance = item.media_type === 'movie' ? (this.defaultMovieInstance || null) : (this.defaultTVInstance || null);
                const appType = item.media_type === 'movie' ? 'radarr' : 'sonarr';
                const instanceName = item.media_type === 'movie' ? this.defaultMovieInstance : this.defaultTVInstance;
                const tmdbId = item.tmdb_id || item.id;
                if (tmdbId && instanceName && this.isMediaHidden(tmdbId, item.media_type, appType, instanceName)) return;
                carousel.appendChild(this.createMediaCard(item, suggestedInstance));
            });
        } else {
            carousel.innerHTML = '<p style="color: #888; text-align: center; width: 100%; padding: 40px;">No trending content available</p>';
        }
    }

    async loadTrending() {
        const carousel = document.getElementById('trending-carousel');
        if (!carousel) return;
        const cached = this.getDiscoveryCache('trending');
        if (cached !== null) {
            this.renderTrendingResults(carousel, cached);
            this.fetchAndCacheTrending();
            return;
        }
        try {
            const response = await fetch('./api/requestarr/discover/trending');
            const data = await response.json();
            const results = (data.results && data.results.length > 0) ? data.results : [];
            this.setDiscoveryCache('trending', results);
            this.renderTrendingResults(carousel, results);
        } catch (error) {
            console.error('[RequestarrDiscover] Error loading trending:', error);
            carousel.innerHTML = '<p style="color: #ef4444; text-align: center; width: 100%; padding: 40px;">Failed to load trending content</p>';
        }
    }

    async fetchAndCacheTrending() {
        try {
            const response = await fetch('./api/requestarr/discover/trending');
            const data = await response.json();
            const results = (data.results && data.results.length > 0) ? data.results : [];
            this.setDiscoveryCache('trending', results);
            const carousel = document.getElementById('trending-carousel');
            if (carousel) this.renderTrendingResults(carousel, results);
        } catch (e) {
            console.warn('[RequestarrContent] Background refresh trending failed:', e);
        }
    }

    renderPopularMoviesResults(carousel, results) {
        if (!carousel) return;
        const instanceName = this.defaultMovieInstance;
        if (results && results.length > 0) {
            carousel.innerHTML = '';
            results.forEach(item => {
                const tmdbId = item.tmdb_id || item.id;
                if (tmdbId && instanceName && this.isMediaHidden(tmdbId, 'movie', 'radarr', instanceName)) return;
                carousel.appendChild(this.createMediaCard(item, this.defaultMovieInstance || null));
            });
        } else {
            carousel.innerHTML = '<p style="color: #888; text-align: center; width: 100%; padding: 40px;">No movies available</p>';
        }
    }

    async loadPopularMovies() {
        const carousel = document.getElementById('popular-movies-carousel');
        if (!carousel) return;
        const cached = this.getDiscoveryCache('movies');
        if (cached !== null) {
            this.renderPopularMoviesResults(carousel, cached);
            this.fetchAndCachePopularMovies();
            return;
        }
        try {
            const instanceName = this.defaultMovieInstance;
            let url = './api/requestarr/discover/movies?page=1';
            if (instanceName) url += `&app_type=radarr&instance_name=${encodeURIComponent(instanceName)}`;
            const response = await fetch(url);
            const data = await response.json();
            const results = (data.results && data.results.length > 0) ? data.results : [];
            this.setDiscoveryCache('movies', results);
            this.renderPopularMoviesResults(carousel, results);
        } catch (error) {
            console.error('[RequestarrDiscover] Error loading popular movies:', error);
            carousel.innerHTML = '<p style="color: #ef4444; text-align: center; width: 100%; padding: 40px;">Failed to load movies</p>';
        }
    }

    async fetchAndCachePopularMovies() {
        try {
            const instanceName = this.defaultMovieInstance;
            let url = './api/requestarr/discover/movies?page=1';
            if (instanceName) url += `&app_type=radarr&instance_name=${encodeURIComponent(instanceName)}`;
            const response = await fetch(url);
            const data = await response.json();
            const results = (data.results && data.results.length > 0) ? data.results : [];
            this.setDiscoveryCache('movies', results);
            const carousel = document.getElementById('popular-movies-carousel');
            if (carousel) this.renderPopularMoviesResults(carousel, results);
        } catch (e) {
            console.warn('[RequestarrContent] Background refresh popular movies failed:', e);
        }
    }

    renderPopularTVResults(carousel, results) {
        if (!carousel) return;
        const instanceName = this.defaultTVInstance;
        if (results && results.length > 0) {
            carousel.innerHTML = '';
            results.forEach(item => {
                const tmdbId = item.tmdb_id || item.id;
                if (tmdbId && instanceName && this.isMediaHidden(tmdbId, 'tv', 'sonarr', instanceName)) return;
                carousel.appendChild(this.createMediaCard(item, this.defaultTVInstance || null));
            });
        } else {
            carousel.innerHTML = '<p style="color: #888; text-align: center; width: 100%; padding: 40px;">No TV shows available</p>';
        }
    }

    async loadPopularTV() {
        const carousel = document.getElementById('popular-tv-carousel');
        if (!carousel) return;
        const cached = this.getDiscoveryCache('tv');
        if (cached !== null) {
            this.renderPopularTVResults(carousel, cached);
            this.fetchAndCachePopularTV();
            return;
        }
        try {
            const instanceName = this.defaultTVInstance;
            let url = './api/requestarr/discover/tv?page=1';
            if (instanceName) url += `&app_type=sonarr&instance_name=${encodeURIComponent(instanceName)}`;
            const response = await fetch(url);
            const data = await response.json();
            const results = (data.results && data.results.length > 0) ? data.results : [];
            this.setDiscoveryCache('tv', results);
            this.renderPopularTVResults(carousel, results);
        } catch (error) {
            console.error('[RequestarrDiscover] Error loading popular TV:', error);
            carousel.innerHTML = '<p style="color: #ef4444; text-align: center; width: 100%; padding: 40px;">Failed to load TV shows</p>';
        }
    }

    async fetchAndCachePopularTV() {
        try {
            const instanceName = this.defaultTVInstance;
            let url = './api/requestarr/discover/tv?page=1';
            if (instanceName) url += `&app_type=sonarr&instance_name=${encodeURIComponent(instanceName)}`;
            const response = await fetch(url);
            const data = await response.json();
            const results = (data.results && data.results.length > 0) ? data.results : [];
            this.setDiscoveryCache('tv', results);
            const carousel = document.getElementById('popular-tv-carousel');
            if (carousel) this.renderPopularTVResults(carousel, results);
        } catch (e) {
            console.warn('[RequestarrContent] Background refresh popular TV failed:', e);
        }
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
            
            // Add instance info for library status checking
            if (this.selectedMovieInstance) {
                url += `&app_type=radarr&instance_name=${encodeURIComponent(this.selectedMovieInstance)}`;
            }
            
            // Add filter parameters
            if (this.core.filters) {
                const filterParams = this.core.filters.getFilterParams();
                if (filterParams) {
                    url += `&${filterParams}`;
                }
            }
            
            const response = await fetch(url);
            
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
                    // Filter out hidden media
                    const tmdbId = item.tmdb_id || item.id;
                    if (tmdbId && this.selectedMovieInstance && this.isMediaHidden(tmdbId, 'movie', 'radarr', this.selectedMovieInstance)) {
                        return; // Skip hidden items
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
                url += `&app_type=sonarr&instance_name=${encodeURIComponent(this.selectedTVInstance)}`;
            }
            
            // Add filter parameters
            if (this.core.tvFilters) {
                const filterParams = this.core.tvFilters.getFilterParams();
                if (filterParams) {
                    url += `&${filterParams}`;
                }
            }
            
            const response = await fetch(url);
            
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
                data.results.forEach((item) => {
                    // Filter out hidden media
                    const tmdbId = item.tmdb_id || item.id;
                    if (tmdbId && this.selectedTVInstance && this.isMediaHidden(tmdbId, 'tv', 'sonarr', this.selectedTVInstance)) {
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
        const inCooldown = item.in_cooldown || false;
        const hasInstance = item.media_type === 'movie'
            ? (this.core.instances.radarr || []).length > 0
            : (this.core.instances.sonarr || []).length > 0;
        const metaClassName = hasInstance ? 'media-card-meta' : 'media-card-meta no-hide';
        
        // Determine status badge
        let statusBadgeHTML = '';
        if (hasInstance) {
            if (inCooldown) {
                // Red stop sign for cooldown
                statusBadgeHTML = '<div class="media-card-status-badge cooldown"><i class="fas fa-hand"></i></div>';
            } else if (inLibrary) {
                // Green checkmark for complete
                statusBadgeHTML = '<div class="media-card-status-badge complete"><i class="fas fa-check"></i></div>';
            } else if (partial) {
                // Orange exclamation for partial
                statusBadgeHTML = '<div class="media-card-status-badge partial"><i class="fas fa-exclamation"></i></div>';
            } else {
                // Blue download icon for available
                statusBadgeHTML = '<div class="media-card-status-badge available"><i class="fas fa-download"></i></div>';
            }
        }
        
        if (inLibrary) {
            card.classList.add('in-library');
        }
        if (inCooldown) {
            card.classList.add('in-cooldown');
        }
        
        // Only show Request button when not in library AND not in cooldown (badge alone indicates cooldown)
        const showRequestBtn = !inLibrary && !inCooldown;
        const overlayActionHTML = showRequestBtn
            ? '<button class="media-card-request-btn"><i class="fas fa-download"></i> Request</button>'
            : '';
        
        card.innerHTML = `
            <div class="media-card-poster">
                ${statusBadgeHTML}
                <img src="${posterUrl}" alt="${item.title}" onerror="this.src='./static/images/blackout.jpg'">
                <div class="media-card-overlay">
                    <div class="media-card-overlay-title">${item.title}</div>
                    <div class="media-card-overlay-content">
                        <div class="media-card-overlay-year">${year}</div>
                        <div class="media-card-overlay-description">${overview}</div>
                        ${overlayActionHTML}
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
                    ${hasInstance ? `
                        <button class="media-card-hide-btn" title="Hide this media permanently">
                            <i class="fas fa-eye-slash"></i>
                        </button>
                    ` : ''}
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
        
        // Click anywhere on card opens detail page (movies) or modal (TV)
        card.style.cursor = 'pointer';
        card.addEventListener('click', (e) => {
            // Request button opens modal only
            if (requestBtn && (e.target === requestBtn || requestBtn.contains(e.target))) {
                e.preventDefault();
                e.stopPropagation();
                this.core.modal.openModal(item.tmdb_id, item.media_type, card.suggestedInstance);
                return;
            }
            // Hide button only hides
            if (hideBtn && (e.target === hideBtn || hideBtn.contains(e.target))) {
                e.preventDefault();
                e.stopPropagation();
                this.hideMedia(item.tmdb_id, item.media_type, item.title, card);
                return;
            }
            
            // For movies, open Requestarr detail page if available
            if (item.media_type === 'movie' && window.RequestarrDetail && window.RequestarrDetail.openDetail) {
                const movieData = {
                    tmdb_id: item.tmdb_id,
                    id: item.tmdb_id,
                    title: item.title,
                    year: item.year,
                    poster_path: item.poster_path,
                    backdrop_path: item.backdrop_path,
                    overview: item.overview,
                    vote_average: item.vote_average,
                    in_library: inLibrary,
                    in_cooldown: inCooldown
                };
                window.RequestarrDetail.openDetail(movieData, {
                    suggestedInstance: card.suggestedInstance
                });
            } else {
                // For TV shows or if detail page not loaded, use modal
                this.core.modal.openModal(item.tmdb_id, item.media_type, card.suggestedInstance);
            }
        });
        
        return card;
    }

    async hideMedia(tmdbId, mediaType, title, cardElement) {
        try {
            const confirmed = confirm(`Hide "${title}" permanently?\n\nThis will remove it from all discovery pages. You can unhide it later from the Hidden Media page.`);
            if (!confirmed) return;

            // Get item data from card
            const item = cardElement.itemData || {};
            const posterPath = item.poster_path || null;
            
            // Determine app_type and instance from media_type
            const appType = mediaType === 'movie' ? 'radarr' : 'sonarr';
            // Use view's selected instance, or card's suggested instance (search/discover), or default, or first available
            let instanceName = mediaType === 'movie' ? this.selectedMovieInstance : this.selectedTVInstance;
            if (!instanceName && cardElement.suggestedInstance) {
                instanceName = cardElement.suggestedInstance;
            }
            if (!instanceName) {
                instanceName = mediaType === 'movie' ? this.defaultMovieInstance : this.defaultTVInstance;
            }
            if (!instanceName && this.core && this.core.instances) {
                const instances = mediaType === 'movie' ? (this.core.instances.radarr || []) : (this.core.instances.sonarr || []);
                instanceName = instances.length > 0 ? instances[0].name : null;
            }
            
            if (!instanceName) {
                alert('No instance selected. Please select an instance first.');
                return;
            }

            const response = await fetch('./api/requestarr/hidden-media', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tmdb_id: tmdbId,
                    media_type: mediaType,
                    title: title,
                    poster_path: posterPath,
                    app_type: appType,
                    instance_name: instanceName
                })
            });

            if (!response.ok) {
                throw new Error('Failed to hide media');
            }

            // Add to hidden media set for immediate filtering
            const key = `${tmdbId}:${mediaType}:${appType}:${instanceName}`;
            this.hiddenMediaSet.add(key);

            // Remove the card from view with animation
            cardElement.style.opacity = '0';
            cardElement.style.transform = 'scale(0.8)';
            setTimeout(() => {
                cardElement.remove();
            }, 300);

            console.log(`[RequestarrContent] Hidden media: ${title} (${mediaType}) for ${appType}/${instanceName}`);
        } catch (error) {
            console.error('[RequestarrContent] Error hiding media:', error);
            alert('Failed to hide media. Please try again.');
        }
    }
}
