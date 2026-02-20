/**
 * Requestarr Home - Smart Hunt carousel + global search for Home section
 *
 * The three rotating carousels (Trending / Movies / TV) have been replaced
 * with a single Smart Hunt carousel that uses the SmartHunt module.
 */

const HomeRequestarr = {
    core: null,
    searchTimeout: null,
    elements: {},
    defaultMovieInstance: null,
    defaultTVInstance: null,
    showTrending: true,

    /** SmartHunt instance (created after core is ready) */
    _smartHunt: null,

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

        // Force hide initially if we can't determine setting yet
        if (this.elements.discoverView) {
            this.elements.discoverView.style.setProperty('display', 'none', 'important');
        }

        // Load settings first to determine if Smart Hunt should be shown
        this.loadSettings()
            .then(() => {
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
                            this._initSmartHunt();
                        });
                    })
                    .catch(() => {
                        console.warn('[HomeRequestarr] Requestarr modules not ready within timeout');
                    });
            });
    },

    /**
     * Full refresh — called every time the user navigates to the Home page.
     * Re-fetches settings from the server and re-applies all visibility and data.
     */
    refresh() {
        this.loadSettings().then(() => {
            this.applyTrendingVisibility();

            if (this.showTrending) {
                if (this._smartHunt) {
                    // Smart Hunt already exists — reload instances + data
                    this.loadDefaultInstances().then(() => {
                        this._smartHunt.reload();
                    });
                } else {
                    // Smart Hunt was not yet created (e.g. was disabled on first load)
                    this.waitForCore().then((core) => {
                        this.core = core;
                        this.loadDefaultInstances().then(() => {
                            this._initSmartHunt();
                        });
                    }).catch(() => {
                        console.warn('[HomeRequestarr] Could not init SmartHunt on refresh');
                    });
                }
            }
        });
    },

    /** Create and load the SmartHunt carousel */
    _initSmartHunt() {
        const section = document.getElementById('home-smarthunt-section');
        if (section) section.style.display = 'block';

        if (!window.SmartHunt) {
            console.warn('[HomeRequestarr] SmartHunt class not available yet');
            return;
        }

        const self = this;
        this._smartHunt = new window.SmartHunt({
            carouselId: 'home-smarthunt-carousel',
            core: this.core,
            getMovieInstance: () => self.defaultMovieInstance || '',
            getTVInstance: () => self.defaultTVInstance || '',
        });

        this._smartHunt.load();
    },

    async loadSettings() {
        try {
            const response = await fetch('./api/settings');
            const data = await response.json();
            if (data && data.general) {
                const showPref = data.general.show_trending !== false;
                const requestsEnabled = data.general.enable_requestarr !== false;
                this.showTrending = showPref && requestsEnabled;
                console.log('[HomeRequestarr] Show Smart Hunt on Home:', this.showTrending, '(show_trending:', showPref, ', requests enabled:', requestsEnabled, ')');
            }
        } catch (error) {
            console.error('[HomeRequestarr] Error loading settings:', error);
            this.showTrending = true;
        }
    },

    applyTrendingVisibility() {
        const requestsEnabled = !!(window.huntarrUI && window.huntarrUI._enableRequestarr !== false);
        const card = this.elements.requestarrCard;
        if (card) {
            card.style.display = requestsEnabled ? '' : 'none';
        }
        const discoverView = this.elements.discoverView;
        if (discoverView) {
            const show = this.showTrending && requestsEnabled;
            if (show) {
                discoverView.style.setProperty('display', 'block', 'important');
            } else {
                discoverView.style.setProperty('display', 'none', 'important');
            }
        }
    },

    cacheElements() {
        this.elements.requestarrCard = document.querySelector('.requestarr-home-card');
        this.elements.searchInput = document.getElementById('home-requestarr-search-input');
        this.elements.searchResultsView = document.getElementById('home-search-results-view');
        this.elements.searchResultsGrid = document.getElementById('home-search-results-grid');
        this.elements.discoverView = document.getElementById('home-requestarr-discover-view');
        this.elements.smarthuntCarousel = document.getElementById('home-smarthunt-carousel');
        this.elements.instanceControls = document.getElementById('home-instance-controls');
        this.elements.movieInstanceSelect = document.getElementById('home-movie-instance-select');
        this.elements.tvInstanceSelect = document.getElementById('home-tv-instance-select');
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
            }
        } catch (error) {
            console.error('[HomeRequestarr] Error loading default instances:', error);
            this.defaultMovieInstance = null;
            this.defaultTVInstance = null;
        }
        await this._populateInstanceDropdowns();
    },

    async _populateInstanceDropdowns() {
        await Promise.all([
            this._populateMovieInstanceDropdown(),
            this._populateTVInstanceDropdown()
        ]);
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

            if (select.value) {
                this.defaultMovieInstance = select.value;
            }

            if (!select._homeChangeWired) {
                select._homeChangeWired = true;
                select.addEventListener('change', async () => {
                    this.defaultMovieInstance = select.value;
                    await this._saveServerDefaults();
                    this._syncRequestarrContent();
                    if (this._smartHunt) this._smartHunt.reload();
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
            const _ts = Date.now();
            const [thResponse, sonarrResponse] = await Promise.all([
                fetch(`./api/tv-hunt/instances?t=${_ts}`, { cache: 'no-store' }),
                fetch(`./api/requestarr/instances/sonarr?t=${_ts}`, { cache: 'no-store' })
            ]);
            let thData = await thResponse.json();
            if (!thResponse.ok || thData.error) thData = { instances: [] };
            else thData = { instances: (thData.instances || []).filter(i => i.enabled !== false) };
            const sonarrData = await sonarrResponse.json();

            const thInstances = (thData.instances || []).map(inst => ({
                name: String(inst.name).trim(),
                appType: 'tv_hunt',
                label: `TV Hunt \u2013 ${String(inst.name).trim()}`
            }));
            const sonarrInstances = (sonarrData.instances || []).map(inst => ({
                name: String(inst.name).trim(),
                appType: 'sonarr',
                label: `Sonarr \u2013 ${String(inst.name).trim()}`
            }));
            const allInstances = [...thInstances, ...sonarrInstances];

            const previousValue = this.defaultTVInstance || select.value || '';
            select.innerHTML = '';
            if (allInstances.length === 0) {
                select.innerHTML = '<option value="">No TV instances</option>';
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

            if (select.value) {
                this.defaultTVInstance = select.value;
            }

            if (!select._homeChangeWired) {
                select._homeChangeWired = true;
                select.addEventListener('change', async () => {
                    this.defaultTVInstance = select.value;
                    await this._saveServerDefaults();
                    this._syncRequestarrContent();
                    if (this._smartHunt) this._smartHunt.reload();
                });
            }
        } catch (error) {
            console.error('[HomeRequestarr] Error populating TV instances:', error);
        }
    },

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

    _syncRequestarrContent() {
        if (this.core && this.core.content) {
            this.core.content.selectedMovieInstance = this.defaultMovieInstance;
            this.core.content.selectedTVInstance = this.defaultTVInstance;
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

    setupSearch() {
        this.elements.searchInput.addEventListener('input', (event) => {
            this.handleSearch(event.target.value);
        });
    },

    handleSearch(query) {
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
        this.showResults();

        if (!this.elements.searchResultsGrid) {
            return;
        }

        this.elements.searchResultsGrid.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Searching...</p></div>';

        try {
            // Ensure global blacklist is loaded for filtering
            if (this.core && this.core.content && typeof this.core.content.loadHiddenMediaIds === 'function' && !this.core.content.globalBlacklistSet) {
                await this.core.content.loadHiddenMediaIds();
            }

            const movieDecoded = this._decodeInstance(this.defaultMovieInstance);
            const tvDecoded = this._decodeInstance(this.defaultTVInstance);

            const [moviesResponse, tvResponse] = await Promise.all([
                fetch(`./api/requestarr/search?q=${encodeURIComponent(query)}&app_type=${encodeURIComponent(movieDecoded.appType)}&instance_name=${encodeURIComponent(movieDecoded.name)}`),
                fetch(`./api/requestarr/search?q=${encodeURIComponent(query)}&app_type=${encodeURIComponent(tvDecoded.appType)}&instance_name=${encodeURIComponent(tvDecoded.name)}`)
            ]);

            const moviesData = await moviesResponse.json();
            const tvData = await tvResponse.json();

            const allResults = [
                ...(moviesData.results || []),
                ...(tvData.results || [])
            ];

            allResults.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));

            if (allResults.length > 0) {
                this.elements.searchResultsGrid.innerHTML = '';
                allResults.forEach((item) => {
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
