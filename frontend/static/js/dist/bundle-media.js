
/* === modules/features/media-utils.js === */
/**
 * MediaUtils — Shared utility functions for media cards across Movie Hunt and Requestarr.
 * Consolidates duplicated logic into a single source of truth.
 *
 * Provides:
 *   - hideMedia()       — Hide media from discovery with confirmation + animation
 *   - getStatusBadge()  — Consistent status badge HTML
 *   - animateCardRemoval() — Shared card removal animation
 *   - resolveMovieInstance() — Resolve instance info from various sources
 */
(function() {
    'use strict';

    /* ── Card removal animation (used by hide, delete, etc.) ── */
    function animateCardRemoval(cardElement, callback) {
        if (!cardElement) {
            if (typeof callback === 'function') callback();
            return;
        }
        cardElement.style.transition = 'opacity 0.3s, transform 0.3s';
        cardElement.style.opacity = '0';
        cardElement.style.transform = 'scale(0.8)';
        setTimeout(function() {
            cardElement.remove();
            if (typeof callback === 'function') callback();
        }, 300);
    }

    /* ── Status badge HTML ── */
    /**
     * Returns status badge HTML for a media card.
     * @param {boolean} inLibrary - Item is fully available (downloaded)
     * @param {boolean} partial   - Item is requested/monitored but not downloaded
     * @param {boolean} hasInstance - An instance is configured
     * @returns {string} HTML string
     */
    function getStatusBadge(inLibrary, partial, hasInstance) {
        if (!hasInstance) return '';
        if (inLibrary) {
            return '<div class="media-card-status-badge complete"><i class="fas fa-check"></i></div>';
        }
        if (partial) {
            return '<div class="media-card-status-badge partial"><i class="fas fa-exclamation"></i></div>';
        }
        return '<div class="media-card-status-badge available"><i class="fas fa-download"></i></div>';
    }

    /* ── Action button HTML (trash or eye-slash) ── */
    /**
     * Returns the action button HTML for a media card.
     * @param {boolean} inLibrary - Item is fully available
     * @param {boolean} partial   - Item is requested
     * @param {boolean} hasInstance - An instance is configured
     * @returns {string} HTML string
     */
    function getActionButton(inLibrary, partial, hasInstance) {
        if (!hasInstance) return '';
        if (inLibrary || partial) {
            return '<button class="media-card-delete-btn" title="Remove / Delete"><i class="fas fa-trash-alt"></i></button>';
        }
        return '<button class="media-card-hide-btn" title="Hide this media permanently"><i class="fas fa-eye-slash"></i></button>';
    }

    /* ── Decode compound instance value ── */
    /**
     * Decode a compound instance value like "movie_hunt:MyInstance" or "radarr:MyRadarr".
     * @param {string} value - Compound value
     * @returns {{appType: string, name: string}}
     */
    function decodeInstanceValue(value) {
        if (!value) return { appType: 'radarr', name: '' };
        var idx = value.indexOf(':');
        if (idx === -1) return { appType: 'radarr', name: value };
        return { appType: value.substring(0, idx), name: value.substring(idx + 1) };
    }

    /* ── Hide media (single source of truth) ── */
    /**
     * Hide media from discovery pages.
     * @param {Object} options
     *   - tmdbId {number|string}     - TMDB ID of the media
     *   - mediaType {string}         - 'movie' or 'tv'
     *   - title {string}             - Display title
     *   - posterPath {string|null}   - Poster URL
     *   - appType {string}           - 'movie_hunt', 'radarr', or 'sonarr'
     *   - instanceName {string}      - Instance display name
     *   - cardElement {HTMLElement}   - Card DOM element (for animation)
     *   - hiddenMediaSet {Set|null}  - Optional Set to add the hidden key to
     *   - onHidden {function|null}   - Optional callback after successful hide
     */
    function hideMedia(options) {
        var tmdbId = options.tmdbId;
        var mediaType = options.mediaType || 'movie';
        var title = options.title || 'this media';
        var posterPath = options.posterPath || null;
        var appType = options.appType || 'movie_hunt';
        var instanceName = options.instanceName || '';
        var cardElement = options.cardElement || null;
        var hiddenMediaSet = options.hiddenMediaSet || null;
        var onHidden = options.onHidden || null;

        if (!instanceName) {
            if (window.huntarrUI && window.huntarrUI.showNotification) {
                window.huntarrUI.showNotification('No instance selected.', 'error');
            }
            return;
        }

        var msg = 'Hide "' + title + '" permanently?\n\nThis will remove it from all discovery pages. You can unhide it later from the Hidden Media page.';

        var doHide = function() {
            fetch('./api/requestarr/hidden-media', {
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
            })
            .then(function(r) {
                if (!r.ok) throw new Error('Failed to hide media');
                return r.json();
            })
            .then(function() {
                // Track in hidden set if provided
                if (hiddenMediaSet) {
                    var key = tmdbId + ':' + mediaType + ':' + appType + ':' + instanceName;
                    hiddenMediaSet.add(key);
                }

                // Animate card removal
                animateCardRemoval(cardElement);

                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('"' + title + '" hidden.', 'success');
                }

                if (typeof onHidden === 'function') onHidden();
            })
            .catch(function(err) {
                console.error('[MediaUtils] Error hiding media:', err);
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('Failed to hide media.', 'error');
                }
            });
        };

        if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
            window.HuntarrConfirm.show({
                title: 'Hide Media',
                message: msg,
                confirmLabel: 'Hide',
                onConfirm: doHide
            });
        } else {
            doHide();
        }
    }

    /* ── Resolve movie instance info from various DOM/data sources ── */
    /**
     * Resolve instance details for a movie, trying multiple sources.
     * @param {Object} options
     *   - selectElementId {string}       - DOM select element ID to read from
     *   - compoundValue {string|null}    - Compound value like "movie_hunt:Name"
     *   - instancePool {Array|null}      - Array of {name, id} objects to search
     *   - movieHuntInstances {Array|null} - Fallback Movie Hunt instances
     *   - radarrInstances {Array|null}    - Fallback Radarr instances
     * @returns {{appType: string, instanceName: string, instanceId: string|number}}
     */
    function resolveMovieInstance(options) {
        options = options || {};

        // Try compound value first (Requestarr pattern)
        if (options.compoundValue) {
            var decoded = decodeInstanceValue(options.compoundValue);
            var result = { appType: decoded.appType, instanceName: decoded.name, instanceId: '' };

            // Try to find numeric ID from pool
            var pool = options.instancePool || [];
            var match = pool.find(function(i) { return i.name === decoded.name; });
            if (match) result.instanceId = match.id || '';
            return result;
        }

        // Try DOM select element (Movie Hunt pattern)
        if (options.selectElementId) {
            var select = document.getElementById(options.selectElementId);
            if (select && select.value) {
                var name = select.options && select.options[select.selectedIndex]
                    ? select.options[select.selectedIndex].textContent
                    : select.value;
                return { appType: 'movie_hunt', instanceName: name, instanceId: select.value };
            }
        }

        // Fallback: first available instance
        var mh = options.movieHuntInstances || [];
        var rr = options.radarrInstances || [];
        if (mh.length > 0) return { appType: 'movie_hunt', instanceName: mh[0].name || '', instanceId: mh[0].id || '' };
        if (rr.length > 0) return { appType: 'radarr', instanceName: rr[0].name || '', instanceId: rr[0].id || '' };

        return { appType: 'movie_hunt', instanceName: '', instanceId: '' };
    }

    /* ── Detail page refresh-after-action event system ── */
    /*
     * Single source of truth for:
     *   - Listening for request-success events (from Requestarr modal)
     *   - Listening for status-changed events (from edit save, delete, etc.)
     *   - Dispatching status-changed events
     *   - Delayed re-fetch pattern (immediate + 3s + 8s for fast downloads)
     *
     * Both Movie Hunt detail and Requestarr detail call setupDetailRefreshListeners()
     * with their own refreshCallback. The logic lives here once.
     */

    /**
     * Set up event listeners that auto-refresh a detail page after user actions.
     * Call this from setupDetailInteractions() in any detail page module.
     *
     * @param {Object} options
     *   - getTmdbId {function}    — returns the current movie's TMDB ID (called on each event)
     *   - refreshCallback {function} — called to refresh the detail page status/toolbar
     *   - label {string}          — log label, e.g. 'MovieHuntDetail' or 'RequestarrDetail'
     * @returns {Object} handle — pass to teardownDetailRefreshListeners() on cleanup
     */
    function setupDetailRefreshListeners(options) {
        var getTmdbId = options.getTmdbId;
        var refreshCb = options.refreshCallback;
        var label = options.label || 'DetailPage';

        function onRequestSuccess(e) {
            var detail = e.detail || {};
            var myId = getTmdbId();
            if (!myId || String(detail.tmdbId) !== String(myId)) return;

            console.log('[' + label + '] Request succeeded, refreshing status...');
            refreshCb();
            setTimeout(function() { refreshCb(); }, 3000);
            setTimeout(function() { refreshCb(); }, 8000);
        }

        function onStatusChanged(e) {
            var detail = e.detail || {};
            var myId = getTmdbId();
            if (!myId || String(detail.tmdbId) !== String(myId)) return;

            console.log('[' + label + '] Status changed (' + (detail.action || '?') + '), refreshing...');
            refreshCb();
        }

        window.addEventListener('requestarr-request-success', onRequestSuccess);
        window.addEventListener('media-status-changed', onStatusChanged);

        return { _reqHandler: onRequestSuccess, _statusHandler: onStatusChanged };
    }

    /**
     * Remove listeners created by setupDetailRefreshListeners().
     * @param {Object} handle — the return value from setupDetailRefreshListeners()
     */
    function teardownDetailRefreshListeners(handle) {
        if (!handle) return;
        if (handle._reqHandler) window.removeEventListener('requestarr-request-success', handle._reqHandler);
        if (handle._statusHandler) window.removeEventListener('media-status-changed', handle._statusHandler);
    }

    /**
     * Dispatch a status-changed event so all listening detail pages refresh.
     * Call this after edit-save, force-search, force-upgrade, delete, etc.
     *
     * @param {number|string} tmdbId
     * @param {string} action — e.g. 'edit', 'force-search', 'force-upgrade', 'delete'
     */
    function dispatchStatusChanged(tmdbId, action) {
        window.dispatchEvent(new CustomEvent('media-status-changed', {
            detail: { tmdbId: tmdbId, action: action || 'unknown' }
        }));
    }

    /**
     * Encode a compound instance value: "appType:instanceName"
     */
    function encodeInstanceValue(appType, name) {
        return appType + ':' + name;
    }

    // Export to window
    window.MediaUtils = {
        hideMedia: hideMedia,
        getStatusBadge: getStatusBadge,
        getActionButton: getActionButton,
        animateCardRemoval: animateCardRemoval,
        encodeInstanceValue: encodeInstanceValue,
        decodeInstanceValue: decodeInstanceValue,
        resolveMovieInstance: resolveMovieInstance,
        setupDetailRefreshListeners: setupDetailRefreshListeners,
        teardownDetailRefreshListeners: teardownDetailRefreshListeners,
        dispatchStatusChanged: dispatchStatusChanged
    };
})();


/* === modules/features/media-hunt-instance-dropdown.js === */
/**
 * Media Hunt instance dropdown – server-stored current instance for movie or TV.
 * Attach to a <select>; on change POSTs current instance then calls onChanged.
 * Uses ./api/movie-hunt/ or ./api/tv-hunt/ (instances, current-instance) based on mode.
 * Exposes MovieHuntInstanceDropdown and TVHuntInstanceDropdown as wrappers for compatibility.
 */
(function() {
    'use strict';

    var baseUrl = (typeof window !== 'undefined' && window.HUNTARR_BASE_URL) ? window.HUNTARR_BASE_URL.replace(/\/$/, '') : '';

    function api(path) {
        return (baseUrl || '') + (path.indexOf('./') === 0 ? path : './' + path);
    }

    var _wiredElements = {}; // selectId -> { element, onChanged, mode }

    function getApiBase(mode) {
        return mode === 'tv' ? './api/tv-hunt' : './api/movie-hunt';
    }

    function getEmptyLabel(mode) {
        return mode === 'tv' ? 'No TV Hunt instances' : 'No Movie Hunt instances';
    }

    function getVisibilityCallback(mode) {
        return mode === 'tv' ? window.updateTVHuntSettingsVisibility : window.updateMovieHuntSettingsVisibility;
    }

    function populateSelect(select, mode) {
        var apiBase = getApiBase(mode);
        var emptyLabel = getEmptyLabel(mode);
        select.innerHTML = '<option value="">Loading...</option>';
        var ts = Date.now();
        Promise.all([
            fetch(api(apiBase + '/instances') + '?t=' + ts, { cache: 'no-store' }).then(function(r) { return r.json(); }),
            fetch(api(apiBase + '/current-instance') + '?t=' + ts, { cache: 'no-store' }).then(function(r) { return r.json(); })
        ]).then(function(results) {
            var list = (results[0].instances || []);
            var current = results[1].instance_id != null ? Number(results[1].instance_id) : 0;
            select.innerHTML = '';
            if (list.length === 0) {
                var emptyOpt = document.createElement('option');
                emptyOpt.value = '';
                emptyOpt.textContent = emptyLabel;
                select.appendChild(emptyOpt);
                select.value = '';
            } else {
                list.forEach(function(inst) {
                    var opt = document.createElement('option');
                    opt.value = String(inst.id);
                    opt.textContent = (inst.name || 'Instance ' + inst.id);
                    select.appendChild(opt);
                });
                select.value = String(current);
                if (select.selectedIndex < 0 && select.options.length) {
                    select.selectedIndex = 0;
                }
            }
        }).catch(function() {
            select.innerHTML = '<option value="">' + emptyLabel + '</option>';
        });
    }

    function attach(selectId, onChanged, mode) {
        var select = document.getElementById(selectId);
        if (!select) return;

        if (_wiredElements[selectId] && _wiredElements[selectId].element === select) {
            populateSelect(select, mode);
            _wiredElements[selectId].onChanged = onChanged;
            _wiredElements[selectId].mode = mode;
            return;
        }

        _wiredElements[selectId] = { element: select, onChanged: onChanged, mode: mode };
        populateSelect(select, mode);

        select.addEventListener('change', function() {
            var val = (select.value || '').trim();
            if (!val) return;
            var entry = _wiredElements[selectId];
            var m = entry && entry.mode ? entry.mode : 'movie';
            var apiBase = getApiBase(m);

            fetch(api(apiBase + '/current-instance'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ instance_id: parseInt(val, 10) })
            })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.error) {
                        console.warn('[MediaHuntInstanceDropdown] Set current failed:', data.error);
                        return;
                    }
                    if (entry && typeof entry.onChanged === 'function') entry.onChanged();
                    var visibilityCb = getVisibilityCallback(m);
                    if (visibilityCb) visibilityCb();
                })
                .catch(function(err) {
                    console.warn('[MediaHuntInstanceDropdown] Set current error:', err);
                });
        });
    }

    function getCurrentInstanceId(mode) {
        var apiBase = getApiBase(mode || 'movie');
        return fetch(api(apiBase + '/current-instance') + '?t=' + Date.now(), { cache: 'no-store' })
            .then(function(r) { return r.json(); })
            .then(function(data) { return data.instance_id != null ? Number(data.instance_id) : 0; })
            .catch(function() { return 0; });
    }

    function refresh(selectId, mode) {
        var select = document.getElementById(selectId);
        if (!select) return;
        var entry = _wiredElements[selectId];
        var m = mode || (entry && entry.mode) || 'movie';
        populateSelect(select, m);
        if (entry) entry.mode = m;
    }

    function refreshAll(mode) {
        Object.keys(_wiredElements).forEach(function(id) {
            var entry = _wiredElements[id];
            if (entry && (!mode || entry.mode === mode)) {
                var select = entry.element;
                if (select) populateSelect(select, entry.mode);
            }
        });
    }

    window.MediaHuntInstanceDropdown = {
        attach: attach,
        getCurrentInstanceId: getCurrentInstanceId,
        refresh: refresh,
        refreshAll: refreshAll
    };

    window.MovieHuntInstanceDropdown = {
        attach: function(selectId, onChanged) { attach(selectId, onChanged, 'movie'); },
        getCurrentInstanceId: function() { return getCurrentInstanceId('movie'); },
        refresh: function(selectId) { refresh(selectId, 'movie'); },
        refreshAll: function() { refreshAll('movie'); }
    };

    window.TVHuntInstanceDropdown = {
        attach: function(selectId, onChanged) { attach(selectId, onChanged, 'tv'); },
        getCurrentInstanceId: function() { return getCurrentInstanceId('tv'); },
        refresh: function(selectId) { refresh(selectId, 'tv'); },
        refreshAll: function() { refreshAll('tv'); }
    };

    document.addEventListener('huntarr:instances-changed', function() {
        refreshAll('movie');
    });
    document.addEventListener('huntarr:tv-hunt-instances-changed', function() {
        refreshAll('tv');
    });
})();


/* === modules/features/media-hunt.js === */
/**
 * Media Hunt – unified discover for Movie Hunt and TV Hunt.
 * Mode from window._mediaHuntSectionMode ('movie' | 'tv'). Uses #media-hunt-* elements.
 */
(function() {
    'use strict';

    const SEARCH_DEBOUNCE_MS = 500;

    function getMode() {
        var m = (window._mediaHuntSectionMode || 'movie').toLowerCase();
        return (m === 'tv') ? 'tv' : 'movie';
    }

    window.MediaHunt = {
        searchTimeout: null,
        page: 1,
        hasMore: true,
        loading: false,
        requestToken: 0,
        observer: null,
        _scrollSetup: false,
        _instanceSelectReady: false,
        _currentSort: 'popularity.desc',

        init() {
            const section = document.getElementById('mediaHuntSection');
            if (!section) return;

            const mode = getMode();
            const betaEl = document.getElementById('media-hunt-beta-text');
            const searchInput = document.getElementById('media-hunt-search-input');
            const loadingText = document.getElementById('media-hunt-grid-loading-text');
            const filterBtn = document.getElementById('media-hunt-filter-btn');
            const sortSelect = document.getElementById('media-hunt-sort');

            if (betaEl) {
                betaEl.innerHTML = mode === 'movie'
                    ? '<strong>Beta feature:</strong> Movie Hunt is in active development. Things may be broken and will change quickly. There is little to no support until it is officially released. Only USENET (SABnzbd, NZBGet) is supported for now. <a href="https://plexguide.github.io/Huntarr.io/apps/movie-hunt.html#docker" target="_blank" rel="noopener">Wiki &amp; Docker setup <i class="fas fa-external-link-alt" style="font-size: 0.85em;"></i></a>'
                    : '<strong>Beta feature:</strong> TV Hunt is in active development. Things may be broken and will change quickly. Only USENET (SABnzbd, NZBGet) is supported for now.';
            }
            if (searchInput) searchInput.placeholder = mode === 'movie' ? 'Search Movies' : 'Search TV Shows';
            if (loadingText) loadingText.textContent = mode === 'movie' ? 'Loading movies...' : 'Loading TV shows...';
            if (filterBtn) filterBtn.style.display = mode === 'movie' ? '' : 'none';

            if (sortSelect) {
                sortSelect.innerHTML = '';
                const opts = mode === 'movie'
                    ? [
                        { v: 'popularity.desc', l: 'Popularity' },
                        { v: 'vote_average.desc', l: 'Rating' },
                        { v: 'release_date.desc', l: 'Release Date Descending' },
                        { v: 'release_date.asc', l: 'Release Date Ascending' },
                        { v: 'title.asc', l: 'Title (A-Z)' },
                        { v: 'title.desc', l: 'Title (Z-A)' }
                    ]
                    : [
                        { v: 'popularity.desc', l: 'Popularity' },
                        { v: 'vote_average.desc', l: 'Rating' },
                        { v: 'first_air_date.desc', l: 'Air Date (Newest)' },
                        { v: 'first_air_date.asc', l: 'Air Date (Oldest)' },
                        { v: 'name.asc', l: 'Title (A-Z)' },
                        { v: 'name.desc', l: 'Title (Z-A)' }
                    ];
                opts.forEach(function(o) {
                    const opt = document.createElement('option');
                    opt.value = o.v;
                    opt.textContent = o.l;
                    sortSelect.appendChild(opt);
                });
                sortSelect.value = mode === 'movie' ? 'popularity.desc' : 'popularity.desc';
                this._currentSort = sortSelect.value;
            }

            this.showMainView();
            this.setupSearch();
            this.setupSort();

            if (mode === 'movie') {
                this.setupFilterButton();
                if (window.MediaHuntFilters && window.MediaHuntFilters.init) {
                    window.MediaHuntFilters.init();
                }
            }

            if (mode === 'movie' && window.MovieHuntInstanceDropdown && document.getElementById('media-hunt-instance-select')) {
                if (!this._instanceSelectReady) {
                    window.MovieHuntInstanceDropdown.attach('media-hunt-instance-select', () => {
                        this.page = 1;
                        this.hasMore = true;
                        this.loading = false;
                        this.requestToken++;
                        const grid = document.getElementById('media-hunt-media-grid');
                        if (grid) grid.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Loading movies...</p></div>';
                        this.loadMovies(1);
                    });
                    this._instanceSelectReady = true;
                }
                this.page = 1;
                this.hasMore = true;
                this.loading = false;
                this.requestToken++;
                this.loadMovies(1);
            } else if (mode === 'tv' && window.TVHuntInstanceDropdown && document.getElementById('media-hunt-instance-select')) {
                if (!this._instanceSelectReady) {
                    window.TVHuntInstanceDropdown.attach('media-hunt-instance-select', () => {
                        this.page = 1;
                        this.hasMore = true;
                        this.loading = false;
                        this.loadDiscover();
                    });
                    this._instanceSelectReady = true;
                }
                this.page = 1;
                this.hasMore = true;
                this.loading = false;
                this.loadDiscover();
            } else {
                this.page = 1;
                this.hasMore = true;
                this.loading = false;
                this.requestToken++;
                if (mode === 'movie') this.loadMovies(1);
                else this.loadDiscover();
            }

            if (!this._scrollSetup) {
                this.setupInfiniteScroll();
                this._scrollSetup = true;
            }
        },

        setupSearch() {
            const self = this;
            const input = document.getElementById('media-hunt-search-input');
            if (!input) return;
            input.addEventListener('input', function() {
                if (self.searchTimeout) clearTimeout(self.searchTimeout);
                const query = (input.value || '').trim();
                if (!query) {
                    self.showMainView();
                    if (getMode() === 'movie') self.loadMovies(1);
                    else self.loadDiscover();
                    return;
                }
                self.searchTimeout = setTimeout(function() { self.performSearch(query); }, SEARCH_DEBOUNCE_MS);
            });
        },

        performSearch(query) {
            const mode = getMode();
            const resultsView = document.getElementById('media-hunt-search-results-view');
            const mainView = document.getElementById('media-hunt-main-view');
            const grid = document.getElementById('media-hunt-search-results-grid');
            if (!resultsView || !mainView || !grid) return;

            resultsView.style.display = 'block';
            mainView.style.display = 'none';
            grid.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Searching...</p></div>';

            if (mode === 'movie') {
                fetch('./api/requestarr/search?q=' + encodeURIComponent(query) + '&app_type=radarr&instance_name=search')
                    .then(function(r) { return r.json(); })
                    .then(function(data) {
                        const results = data.results || [];
                        grid.innerHTML = '';
                        if (results.length > 0) {
                            results.forEach(function(item) { grid.appendChild(window.MediaHunt.createCard(item)); });
                        } else {
                            grid.innerHTML = '<p style="color: #888; text-align: center; padding: 60px; width: 100%;">No movies found</p>';
                        }
                    })
                    .catch(function() {
                        grid.innerHTML = '<p style="color: #ef4444; text-align: center; padding: 60px; width: 100%;">Search failed</p>';
                    });
            } else {
                fetch('./api/tv-hunt/search?q=' + encodeURIComponent(query))
                    .then(function(r) { return r.json(); })
                    .then(function(data) {
                        const results = data.results || [];
                        grid.innerHTML = '';
                        if (results.length > 0) {
                            results.forEach(function(show) { grid.appendChild(window.MediaHunt.createShowCard(show)); });
                        } else {
                            grid.innerHTML = '<p style="color: #888; text-align: center; padding: 60px; width: 100%;">No results found.</p>';
                        }
                    })
                    .catch(function() {
                        grid.innerHTML = '<p style="color: #ef4444; text-align: center; padding: 60px; width: 100%;">Search failed</p>';
                    });
            }
        },

        showMainView() {
            const resultsView = document.getElementById('media-hunt-search-results-view');
            const mainView = document.getElementById('media-hunt-main-view');
            if (resultsView) resultsView.style.display = 'none';
            if (mainView) mainView.style.display = 'block';
        },

        setupSort() {
            const self = this;
            const sortSelect = document.getElementById('media-hunt-sort');
            if (!sortSelect) return;
            sortSelect.addEventListener('change', function() {
                self._currentSort = sortSelect.value;
                self.page = 1;
                self.hasMore = true;
                self.loading = false;
                self.requestToken++;
                if (getMode() === 'movie') {
                    const grid = document.getElementById('media-hunt-media-grid');
                    if (grid) grid.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Loading movies...</p></div>';
                    self.loadMovies(1);
                } else {
                    self.loadDiscover();
                }
            });
        },

        setupFilterButton() {
            const btn = document.getElementById('media-hunt-filter-btn');
            if (btn) {
                btn.addEventListener('click', function() {
                    if (window.MediaHuntFilters && window.MediaHuntFilters.openFiltersModal) {
                        window.MediaHuntFilters.openFiltersModal();
                    }
                });
            }
        },

        getSortParam() {
            const sortSelect = document.getElementById('media-hunt-sort');
            return (sortSelect && sortSelect.value) ? sortSelect.value : 'popularity.desc';
        },

        loadMovies(page) {
            const grid = document.getElementById('media-hunt-media-grid');
            if (!grid) return;
            if (this.loading) return;
            this.loading = true;
            const token = ++this.requestToken;
            if (page === 1) {
                grid.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Loading movies...</p></div>';
            }
            let url = './api/movie-hunt/discover/movies?page=' + page + '&_=' + Date.now();
            const filterParams = (window.MediaHuntFilters && window.MediaHuntFilters.getFilterParams) ? window.MediaHuntFilters.getFilterParams() : '';
            if (filterParams) url += '&' + filterParams;
            else url += '&sort_by=' + encodeURIComponent(this.getSortParam());

            fetch(url)
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (token !== window.MediaHunt.requestToken) return;
                    if (page === 1) grid.innerHTML = '';
                    else {
                        const spinner = grid.querySelector('.loading-spinner');
                        if (spinner) spinner.remove();
                    }
                    const results = data.results || [];
                    if (results.length > 0) {
                        results.forEach(function(item) { grid.appendChild(window.MediaHunt.createCard(item)); });
                    } else if (page === 1) {
                        grid.innerHTML = '<p style="color: #888; text-align: center; width: 100%; padding: 40px;">No movies found</p>';
                    }
                    window.MediaHunt.hasMore = data.has_more !== false && results.length >= 20;
                })
                .catch(function() {
                    if (page === 1) grid.innerHTML = '<p style="color: #ef4444; text-align: center; width: 100%; padding: 40px;">Failed to load movies</p>';
                    window.MediaHunt.hasMore = false;
                })
                .finally(function() {
                    window.MediaHunt.loading = false;
                    window.MediaHunt.page = page;
                    const sentinel = document.getElementById('media-hunt-scroll-sentinel');
                    if (sentinel && window.MediaHunt.hasMore && !window.MediaHunt.loading) {
                        const rect = sentinel.getBoundingClientRect();
                        if (rect.top <= (window.innerHeight || document.documentElement.clientHeight) + 200) {
                            window.MediaHunt.loadMovies(window.MediaHunt.page + 1);
                        }
                    }
                });
        },

        loadDiscover() {
            const grid = document.getElementById('media-hunt-media-grid');
            if (!grid) return;
            if (this.loading) return;
            this.loading = true;
            if (this.page === 1) {
                grid.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Loading TV shows...</p></div>';
            }
            const self = this;
            const sortParam = (document.getElementById('media-hunt-sort') && document.getElementById('media-hunt-sort').value) || 'popularity.desc';
            fetch('./api/tv-hunt/discover/tv?page=' + this.page + '&sort_by=' + encodeURIComponent(sortParam))
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    const results = data.results || [];
                    if (self.page === 1) grid.innerHTML = '';
                    results.forEach(function(show) { grid.appendChild(window.MediaHunt.createShowCard(show)); });
                    self.hasMore = results.length >= 20;
                    self.loading = false;
                })
                .catch(function() {
                    if (self.page === 1) grid.innerHTML = '<p style="color: #ef4444; text-align: center; width: 100%; padding: 40px;">Failed to load TV shows.</p>';
                    self.loading = false;
                });
        },

        setupInfiniteScroll() {
            const sentinel = document.getElementById('media-hunt-scroll-sentinel');
            if (!sentinel || this.observer) return;
            const self = this;
            const scrollRoot = document.querySelector('.main-content') || null;
            this.observer = new IntersectionObserver(
                function(entries) {
                    entries.forEach(function(entry) {
                        if (!entry.isIntersecting) return;
                        if (getMode() === 'movie') {
                            if (self.hasMore && !self.loading) self.loadMovies(self.page + 1);
                        } else {
                            if (self.hasMore && !self.loading) {
                                self.page++;
                                self.loadDiscover();
                            }
                        }
                    });
                },
                { root: scrollRoot, rootMargin: '200px 0px', threshold: 0 }
            );
            this.observer.observe(sentinel);
        },

        getSelectedInstanceName() {
            const select = document.getElementById('media-hunt-instance-select');
            if (!select || !select.value) return '';
            const opt = select.options[select.selectedIndex];
            return opt ? opt.textContent : '';
        },

        getSelectedInstanceId() {
            const select = document.getElementById('media-hunt-instance-select');
            return (select && select.value) ? select.value : '';
        },

        hideMediaFromHome(item, cardElement) {
            const select = document.getElementById('media-hunt-instance-select');
            const instanceName = select ? (select.options[select.selectedIndex] ? select.options[select.selectedIndex].textContent : '') : '';
            window.MediaUtils.hideMedia({
                tmdbId: item.tmdb_id || item.id,
                mediaType: 'movie',
                title: item.title || 'this movie',
                posterPath: item.poster_path || null,
                appType: 'movie_hunt',
                instanceName: instanceName,
                cardElement: cardElement
            });
        },

        openDeleteModalFromHome(item, cardElement) {
            if (!window.MovieCardDeleteModal) return;
            const select = document.getElementById('media-hunt-instance-select');
            const instanceName = select ? (select.options[select.selectedIndex] ? select.options[select.selectedIndex].textContent : '') : '';
            const instanceId = select ? select.value : '';
            const inLibrary = item.in_library || false;
            const partial = item.partial || false;
            window.MovieCardDeleteModal.open(item, {
                instanceName: instanceName,
                instanceId: instanceId,
                status: inLibrary ? 'available' : (partial ? 'requested' : 'requested'),
                hasFile: inLibrary,
                appType: 'movie_hunt',
                onDeleted: function() { window.MediaUtils.animateCardRemoval(cardElement); }
            });
        },

        createCard(item) {
            const card = document.createElement('div');
            card.className = 'media-card';
            const tmdbId = item.tmdb_id || item.id;
            if (tmdbId) card.setAttribute('data-tmdb-id', tmdbId);
            card.setAttribute('data-media-type', 'movie');
            card.itemData = item;

            let posterUrl = item.poster_path || './static/images/blackout.jpg';
            const isTmdbUrl = posterUrl && !posterUrl.includes('./static/images/');
            if (isTmdbUrl && window.tmdbImageCache && window.tmdbImageCache.enabled && window.tmdbImageCache.storage === 'server') {
                posterUrl = './api/tmdb/image?url=' + encodeURIComponent(posterUrl);
            }
            const year = item.year || 'N/A';
            const rating = item.vote_average != null ? Number(item.vote_average).toFixed(1) : 'N/A';
            const overview = item.overview || 'No description available.';
            const inLibrary = item.in_library || false;
            const partial = item.partial || false;
            const instanceSelect = document.getElementById('media-hunt-instance-select');
            const hasInstance = instanceSelect && instanceSelect.value && instanceSelect.value !== '';
            const statusBadge = window.MediaUtils.getStatusBadge(inLibrary, partial, hasInstance);
            const metaClass = hasInstance ? 'media-card-meta' : 'media-card-meta no-hide';
            const showRequestBtn = hasInstance && !inLibrary;
            const overlayAction = showRequestBtn ? '<button class="media-card-request-btn"><i class="fas fa-plus-circle"></i> Add</button>' : '';
            const actionBtn = window.MediaUtils.getActionButton(inLibrary, partial, hasInstance);
            if (inLibrary) card.classList.add('in-library');

            card.innerHTML = '<div class="media-card-poster">' + statusBadge +
                '<img src="' + posterUrl + '" alt="' + (item.title || '').replace(/"/g, '&quot;') + '" onerror="this.src=\'./static/images/blackout.jpg\'">' +
                '<div class="media-card-overlay"><div class="media-card-overlay-title">' + (item.title || '').replace(/</g, '&lt;') + '</div>' +
                '<div class="media-card-overlay-content"><div class="media-card-overlay-year">' + year + '</div>' +
                '<div class="media-card-overlay-description">' + (overview || '').replace(/</g, '&lt;').slice(0, 200) + '</div>' + overlayAction + '</div></div></div>' +
                '<div class="media-card-info"><div class="media-card-title" title="' + (item.title || '').replace(/"/g, '&quot;') + '">' + (item.title || '').replace(/</g, '&lt;') + '</div>' +
                '<div class="' + metaClass + '"><span class="media-card-year">' + year + '</span><span class="media-card-rating"><i class="fas fa-star"></i> ' + rating + '</span>' + actionBtn + '</div></div>';

            const requestBtn = card.querySelector('.media-card-request-btn');
            const hideBtnEl = card.querySelector('.media-card-hide-btn');
            const deleteBtnEl = card.querySelector('.media-card-delete-btn');
            const openRequestModal = function() {
                const id = item.tmdb_id || item.id;
                if (id && window.RequestarrDiscover && window.RequestarrDiscover.modal) {
                    let suggestedInstance = null;
                    const instSelect = document.getElementById('media-hunt-instance-select');
                    if (instSelect && instSelect.value) {
                        const opt = instSelect.options[instSelect.selectedIndex];
                        const name = opt ? (opt.textContent || '').trim() : '';
                        if (name) suggestedInstance = 'movie_hunt:' + name;
                    }
                    window.RequestarrDiscover.modal.openModal(id, 'movie', suggestedInstance);
                }
            };
            const openDetailPage = function() {
                if (window.MovieHuntDetail && window.MovieHuntDetail.openDetail) {
                    window.MovieHuntDetail.openDetail(item);
                } else {
                    openRequestModal();
                }
            };
            if (hideBtnEl) hideBtnEl.addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation(); window.MediaHunt.hideMediaFromHome(item, card); });
            if (deleteBtnEl) deleteBtnEl.addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation(); window.MediaHunt.openDeleteModalFromHome(item, card); });
            card.style.cursor = 'pointer';
            card.addEventListener('click', function(e) {
                if (hideBtnEl && (e.target === hideBtnEl || hideBtnEl.contains(e.target))) return;
                if (deleteBtnEl && (e.target === deleteBtnEl || deleteBtnEl.contains(e.target))) return;
                if (requestBtn && (e.target === requestBtn || requestBtn.contains(e.target))) { e.preventDefault(); e.stopPropagation(); openRequestModal(); return; }
                openDetailPage();
            });
            return card;
        },

        addToCollection(show, instanceIdFromContext) {
            const collectionSelect = document.getElementById('media-hunt-collection-instance-select');
            const discoverSelect = document.getElementById('media-hunt-instance-select');
            const instId = (instanceIdFromContext !== undefined && instanceIdFromContext !== '') ? instanceIdFromContext
                : (collectionSelect ? collectionSelect.value : '')
                || (discoverSelect ? discoverSelect.value : '');
            if (!instId) {
                if (window.huntarrUI) window.huntarrUI.showNotification('Please select an instance first.', 'error');
                return;
            }
            const tmdbId = show.tmdb_id != null ? show.tmdb_id : show.id;
            const title = show.title || show.name || show.original_name;
            const posterPath = (show.poster_path && show.poster_path.indexOf('http') !== 0) ? show.poster_path : (show.poster_path || '');
            fetch('./api/tv-hunt/collection?instance_id=' + instId, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tmdb_id: tmdbId,
                    title: title,
                    poster_path: posterPath,
                    backdrop_path: show.backdrop_path || '',
                    first_air_date: show.first_air_date || '',
                    vote_average: show.vote_average || 0,
                    overview: show.overview || '',
                    instance_id: instId,
                })
            })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.exists && window.huntarrUI) window.huntarrUI.showNotification('Series already in collection.', 'info');
                    else if (data.success && window.huntarrUI) window.huntarrUI.showNotification('Added to collection!', 'success');
                    else if (window.huntarrUI) window.huntarrUI.showNotification(data.error || 'Failed to add.', 'error');
                })
                .catch(function() {
                    if (window.huntarrUI) window.huntarrUI.showNotification('Network error adding to collection.', 'error');
                });
        },

        createShowCard(show) {
            const card = document.createElement('div');
            card.className = 'media-card';
            card.dataset.tmdbId = show.id;
            const posterUrl = show.poster_path ? ('https://image.tmdb.org/t/p/w300' + show.poster_path) : './static/images/no-poster.png';
            const title = show.name || show.original_name || 'Unknown';
            const year = (show.first_air_date || '').substring(0, 4);
            const rating = show.vote_average ? parseFloat(show.vote_average).toFixed(1) : '';
            card.innerHTML = '<div class="media-poster">' +
                '<img src="' + posterUrl + '" alt="' + (typeof HuntarrUtils !== 'undefined' ? HuntarrUtils.escapeHtml(title) : title.replace(/</g, '&lt;').replace(/>/g, '&gt;')) + '" loading="lazy">' +
                '<div class="media-overlay"><button class="add-to-collection-btn" title="Add to Collection"><i class="fas fa-plus"></i></button></div></div>' +
                '<div class="media-info"><div class="media-title">' + (typeof HuntarrUtils !== 'undefined' ? HuntarrUtils.escapeHtml(title) : title.replace(/</g, '&lt;').replace(/>/g, '&gt;')) + '</div>' +
                '<div class="media-year">' + (year || '') + (rating ? ' &middot; <i class="fas fa-star" style="color:#facc15;font-size:0.8em;"></i> ' + rating : '') + '</div></div>';

            const addBtn = card.querySelector('.add-to-collection-btn');
            if (addBtn) {
                addBtn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    if (window.MediaHunt && window.MediaHunt.addToCollection) window.MediaHunt.addToCollection(show);
                });
            }
            card.addEventListener('click', function() {
                if (window.MediaHuntCollection && typeof window.MediaHuntCollection.openSeriesDetail === 'function') {
                    window.MediaHuntCollection.openSeriesDetail(show.id);
                }
            });
            return card;
        }
    };
})();


/* === modules/features/media-hunt-filters.js === */
/**
 * Media Hunt Filters - Filter management for Media Hunt discover (movie mode).
 * Uses media-hunt-* element IDs; calls window.MediaHunt.loadMovies(1) on apply.
 * Exposed as MediaHuntFilters and MovieHuntFilters for compatibility.
 */
(function() {
    'use strict';

    const currentYear = new Date().getFullYear();
    const maxYear = currentYear + 3;
    const minYear = 1900;

    const activeFilters = {
        genres: [],
        yearMin: minYear,
        yearMax: maxYear,
        runtimeMin: 0,
        runtimeMax: 400,
        ratingMin: 0,
        ratingMax: 10,
        votesMin: 0,
        votesMax: 10000,
        hideAvailable: false
    };
    let genres = [];
    let inited = false;

    function el(id) {
        return document.getElementById(id);
    }

    function loadGenres() {
        return Promise.all([
            fetch('./api/requestarr/genres/movie'),
            fetch('./api/requestarr/settings/blacklisted-genres')
        ]).then(function(responses) {
            return Promise.all([responses[0].json(), responses[1].json()]);
        }).then(function(data) {
            const blacklistedIds = (data[1].blacklisted_movie_genres || []).map(function(id) { return parseInt(id, 10); });
            if (data[0].genres) {
                genres = data[0].genres.filter(function(g) { return blacklistedIds.indexOf(g.id) === -1; });
            } else {
                genres = [
                    { id: 28, name: 'Action' }, { id: 12, name: 'Adventure' }, { id: 16, name: 'Animation' },
                    { id: 35, name: 'Comedy' }, { id: 80, name: 'Crime' }, { id: 99, name: 'Documentary' },
                    { id: 18, name: 'Drama' }, { id: 10751, name: 'Family' }, { id: 14, name: 'Fantasy' },
                    { id: 36, name: 'History' }, { id: 27, name: 'Horror' }, { id: 10402, name: 'Music' },
                    { id: 9648, name: 'Mystery' }, { id: 10749, name: 'Romance' }, { id: 878, name: 'Science Fiction' },
                    { id: 10770, name: 'TV Movie' }, { id: 53, name: 'Thriller' }, { id: 10752, name: 'War' },
                    { id: 37, name: 'Western' }
                ];
            }
            populateGenresSelect();
        }).catch(function(err) {
            console.error('[MediaHuntFilters] Error loading genres:', err);
            genres = [
                { id: 28, name: 'Action' }, { id: 12, name: 'Adventure' }, { id: 35, name: 'Comedy' },
                { id: 18, name: 'Drama' }, { id: 27, name: 'Horror' }, { id: 10749, name: 'Romance' },
                { id: 878, name: 'Science Fiction' }, { id: 53, name: 'Thriller' }
            ];
            populateGenresSelect();
        });
    }

    function populateGenresSelect() {
        const list = el('media-hunt-genre-list');
        if (!list) return;
        list.innerHTML = '';
        genres.forEach(function(genre) {
            const item = document.createElement('div');
            item.className = 'genre-item';
            item.textContent = genre.name;
            item.dataset.genreId = genre.id;
            if (activeFilters.genres.indexOf(genre.id) !== -1) item.classList.add('selected');
            item.addEventListener('click', function() {
                const genreId = parseInt(item.dataset.genreId, 10);
                const idx = activeFilters.genres.indexOf(genreId);
                if (idx > -1) {
                    activeFilters.genres.splice(idx, 1);
                    item.classList.remove('selected');
                } else {
                    activeFilters.genres.push(genreId);
                    item.classList.add('selected');
                }
                renderSelectedGenres();
                updateModalFilterCount();
                autoApplyFilters();
                const dropdown = el('media-hunt-genre-dropdown');
                if (dropdown) dropdown.style.display = 'none';
            });
            list.appendChild(item);
        });
    }

    function renderSelectedGenres() {
        const container = el('media-hunt-selected-genres');
        if (!container) return;
        container.innerHTML = '';
        if (activeFilters.genres.length === 0) {
            container.style.display = 'none';
            return;
        }
        container.style.display = 'flex';
        activeFilters.genres.forEach(function(genreId) {
            const genre = genres.find(function(g) { return g.id === genreId; });
            if (!genre) return;
            const pill = document.createElement('div');
            pill.className = 'selected-genre-pill';
            const text = document.createElement('span');
            text.textContent = genre.name;
            const remove = document.createElement('span');
            remove.className = 'remove-genre';
            remove.innerHTML = '×';
            remove.addEventListener('click', function(e) {
                e.stopPropagation();
                const idx = activeFilters.genres.indexOf(genreId);
                if (idx > -1) activeFilters.genres.splice(idx, 1);
                renderSelectedGenres();
                updateModalFilterCount();
                autoApplyFilters();
                const items = document.querySelectorAll('#media-hunt-genre-list .genre-item');
                items.forEach(function(it) {
                    if (parseInt(it.dataset.genreId, 10) === genreId) it.classList.remove('selected');
                });
            });
            pill.appendChild(text);
            pill.appendChild(remove);
            container.appendChild(pill);
        });
    }

    function updateSliderRange(type, minInput, maxInput) {
        const rangeEl = el('media-hunt-' + type + '-range');
        if (!rangeEl) return;
        const min = parseFloat(minInput.value);
        const max = parseFloat(maxInput.value);
        const minVal = parseFloat(minInput.min);
        const maxVal = parseFloat(minInput.max);
        const percentMin = ((min - minVal) / (maxVal - minVal)) * 100;
        const percentMax = ((max - minVal) / (maxVal - minVal)) * 100;
        rangeEl.style.left = percentMin + '%';
        rangeEl.style.width = (percentMax - percentMin) + '%';
    }

    function updateYearDisplay() {
        const minInput = el('media-hunt-filter-year-min');
        const maxInput = el('media-hunt-filter-year-max');
        if (!minInput || !maxInput) return;
        let min = parseInt(minInput.value, 10);
        let max = parseInt(maxInput.value, 10);
        if (min > max) { var t = min; min = max; max = t; }
        const display = el('media-hunt-year-display');
        if (display) display.textContent = 'Movies from ' + min + ' to ' + max;
    }
    function updateRuntimeDisplay() {
        const minInput = el('media-hunt-filter-runtime-min');
        const maxInput = el('media-hunt-filter-runtime-max');
        if (!minInput || !maxInput) return;
        let min = parseInt(minInput.value, 10);
        let max = parseInt(maxInput.value, 10);
        if (min > max) { var t = min; min = max; max = t; }
        const display = el('media-hunt-runtime-display');
        if (display) display.textContent = min + '-' + max + ' minute runtime';
    }
    function updateRatingDisplay() {
        const minInput = el('media-hunt-filter-rating-min');
        const maxInput = el('media-hunt-filter-rating-max');
        if (!minInput || !maxInput) return;
        let min = parseFloat(minInput.value);
        let max = parseFloat(maxInput.value);
        if (min > max) { var t = min; min = max; max = t; }
        const display = el('media-hunt-rating-display');
        if (display) display.textContent = 'Ratings between ' + min.toFixed(1) + ' and ' + max.toFixed(1);
    }
    function updateVotesDisplay() {
        const minInput = el('media-hunt-filter-votes-min');
        const maxInput = el('media-hunt-filter-votes-max');
        if (!minInput || !maxInput) return;
        let min = parseInt(minInput.value, 10);
        let max = parseInt(maxInput.value, 10);
        if (min > max) { var t = min; min = max; max = t; }
        const display = el('media-hunt-votes-display');
        if (display) display.textContent = 'Number of votes between ' + min + ' and ' + max;
    }

    function updateFilterDisplay() {
        let count = 0;
        if (activeFilters.genres.length > 0) count++;
        if (activeFilters.yearMin > minYear || activeFilters.yearMax < maxYear) count++;
        if (activeFilters.runtimeMin > 0 || activeFilters.runtimeMax < 400) count++;
        if (activeFilters.ratingMin > 0 || activeFilters.ratingMax < 10) count++;
        if (activeFilters.votesMin > 0 || activeFilters.votesMax < 10000) count++;
        if (activeFilters.hideAvailable) count++;
        const countEl = el('media-hunt-filter-count');
        const text = count === 0 ? '0 Active Filters' : count === 1 ? '1 Active Filter' : count + ' Active Filters';
        if (countEl) countEl.textContent = text;
        updateModalFilterCount();
    }

    function updateModalFilterCount() {
        let count = 0;
        if (activeFilters.genres.length > 0) count++;
        if (activeFilters.yearMin > minYear || activeFilters.yearMax < maxYear) count++;
        if (activeFilters.runtimeMin > 0 || activeFilters.runtimeMax < 400) count++;
        if (activeFilters.ratingMin > 0 || activeFilters.ratingMax < 10) count++;
        if (activeFilters.votesMin > 0 || activeFilters.votesMax < 10000) count++;
        if (activeFilters.hideAvailable) count++;
        const countEl = el('media-hunt-filter-active-count');
        const text = count === 0 ? '0 Active Filters' : count === 1 ? '1 Active Filter' : count + ' Active Filters';
        if (countEl) countEl.textContent = text;
    }

    function loadFilterValues() {
        const yearMin = el('media-hunt-filter-year-min');
        const yearMax = el('media-hunt-filter-year-max');
        const runtimeMin = el('media-hunt-filter-runtime-min');
        const runtimeMax = el('media-hunt-filter-runtime-max');
        const ratingMin = el('media-hunt-filter-rating-min');
        const ratingMax = el('media-hunt-filter-rating-max');
        const votesMin = el('media-hunt-filter-votes-min');
        const votesMax = el('media-hunt-filter-votes-max');
        const hideAvailable = el('media-hunt-hide-available-movies');
        if (yearMin) yearMin.value = activeFilters.yearMin;
        if (yearMax) yearMax.value = activeFilters.yearMax;
        if (runtimeMin) runtimeMin.value = activeFilters.runtimeMin;
        if (runtimeMax) runtimeMax.value = activeFilters.runtimeMax;
        if (ratingMin) ratingMin.value = activeFilters.ratingMin;
        if (ratingMax) ratingMax.value = activeFilters.ratingMax;
        if (votesMin) votesMin.value = activeFilters.votesMin;
        if (votesMax) votesMax.value = activeFilters.votesMax;
        if (hideAvailable) hideAvailable.checked = activeFilters.hideAvailable;
        renderSelectedGenres();
        var items = document.querySelectorAll('#media-hunt-genre-list .genre-item');
        items.forEach(function(item) {
            var genreId = parseInt(item.dataset.genreId, 10);
            if (activeFilters.genres.indexOf(genreId) !== -1) item.classList.add('selected');
            else item.classList.remove('selected');
        });
        updateYearDisplay();
        updateRuntimeDisplay();
        updateRatingDisplay();
        updateVotesDisplay();
        updateModalFilterCount();
    }

    function autoApplyFilters() {
        var yearMinEl = el('media-hunt-filter-year-min');
        var yearMaxEl = el('media-hunt-filter-year-max');
        var runtimeMinEl = el('media-hunt-filter-runtime-min');
        var runtimeMaxEl = el('media-hunt-filter-runtime-max');
        var ratingMinEl = el('media-hunt-filter-rating-min');
        var ratingMaxEl = el('media-hunt-filter-rating-max');
        var votesMinEl = el('media-hunt-filter-votes-min');
        var votesMaxEl = el('media-hunt-filter-votes-max');
        var yearMin = yearMinEl ? parseInt(yearMinEl.value, 10) : minYear;
        var yearMax = yearMaxEl ? parseInt(yearMaxEl.value, 10) : maxYear;
        var runtimeMin = runtimeMinEl ? parseInt(runtimeMinEl.value, 10) : 0;
        var runtimeMax = runtimeMaxEl ? parseInt(runtimeMaxEl.value, 10) : 400;
        var ratingMin = ratingMinEl ? parseFloat(ratingMinEl.value) : 0;
        var ratingMax = ratingMaxEl ? parseFloat(ratingMaxEl.value) : 10;
        var votesMin = votesMinEl ? parseInt(votesMinEl.value, 10) : 0;
        var votesMax = votesMaxEl ? parseInt(votesMaxEl.value, 10) : 10000;
        if (yearMin > yearMax) { var t = yearMin; yearMin = yearMax; yearMax = t; }
        if (runtimeMin > runtimeMax) { var t = runtimeMin; runtimeMin = runtimeMax; runtimeMax = t; }
        if (ratingMin > ratingMax) { var t = ratingMin; ratingMin = ratingMax; ratingMax = t; }
        if (votesMin > votesMax) { var t = votesMin; votesMin = votesMax; votesMax = t; }
        activeFilters.yearMin = yearMin;
        activeFilters.yearMax = yearMax;
        activeFilters.runtimeMin = runtimeMin;
        activeFilters.runtimeMax = runtimeMax;
        activeFilters.ratingMin = ratingMin;
        activeFilters.ratingMax = ratingMax;
        activeFilters.votesMin = votesMin;
        activeFilters.votesMax = votesMax;
        updateFilterDisplay();
        if (window.MovieHunt && window.MediaHunt.loadMovies) {
            window.MovieHunt.page = 1;
            window.MovieHunt.hasMore = true;
            window.MediaHunt.loadMovies(1);
        }
    }

    function openFiltersModal() {
        var modal = el('media-hunt-filter-modal');
        if (!modal) return;
        // Move modal to body so it isn't clipped by #mediaHuntSection (same as Requestarr / request modal)
        if (modal.parentNode !== document.body) {
            document.body.appendChild(modal);
        }
        loadFilterValues();
        modal.style.display = 'flex';
        setTimeout(function() { modal.classList.add('show'); }, 10);
        document.body.style.overflow = 'hidden';
    }

    function closeFiltersModal() {
        var modal = el('media-hunt-filter-modal');
        if (modal) {
            modal.classList.remove('show');
            setTimeout(function() {
                modal.style.display = 'none';
                document.body.style.overflow = '';
            }, 150);
        }
    }

    function clearFilters() {
        activeFilters.genres = [];
        activeFilters.yearMin = minYear;
        activeFilters.yearMax = maxYear;
        activeFilters.runtimeMin = 0;
        activeFilters.runtimeMax = 400;
        activeFilters.ratingMin = 0;
        activeFilters.ratingMax = 10;
        activeFilters.votesMin = 0;
        activeFilters.votesMax = 10000;
        activeFilters.hideAvailable = false;
        var sortSelect = el('media-hunt-sort');
        if (sortSelect) sortSelect.value = 'popularity.desc';
        updateFilterDisplay();
        loadFilterValues();
        closeFiltersModal();
        if (window.MovieHunt && window.MediaHunt.loadMovies) {
            window.MovieHunt.page = 1;
            window.MovieHunt.hasMore = true;
            window.MediaHunt.loadMovies(1);
        }
    }

    function getFilterParams() {
        var params = new URLSearchParams();
        var sortSelect = el('media-hunt-sort');
        params.append('sort_by', (sortSelect && sortSelect.value) ? sortSelect.value : 'popularity.desc');
        if (activeFilters.genres.length > 0) params.append('with_genres', activeFilters.genres.join(','));
        if (activeFilters.yearMin > minYear) params.append('release_date.gte', activeFilters.yearMin + '-01-01');
        if (activeFilters.yearMax < maxYear) params.append('release_date.lte', activeFilters.yearMax + '-12-31');
        if (activeFilters.runtimeMin > 0 || activeFilters.runtimeMax < 400) {
            params.append('with_runtime.gte', activeFilters.runtimeMin);
            params.append('with_runtime.lte', activeFilters.runtimeMax);
        }
        if (activeFilters.ratingMin > 0 || activeFilters.ratingMax < 10) {
            params.append('vote_average.gte', activeFilters.ratingMin);
            params.append('vote_average.lte', activeFilters.ratingMax);
        }
        if (activeFilters.votesMin > 0 || activeFilters.votesMax < 10000) {
            params.append('vote_count.gte', activeFilters.votesMin);
            params.append('vote_count.lte', activeFilters.votesMax);
        }
        if (activeFilters.hideAvailable) params.append('hide_available', 'true');
        return params.toString();
    }

    function setupEventListeners() {
        var backdrop = el('media-hunt-filter-backdrop');
        var closeBtn = el('media-hunt-filter-close');
        if (backdrop) backdrop.addEventListener('click', closeFiltersModal);
        if (closeBtn) closeBtn.addEventListener('click', closeFiltersModal);

        var hideAvailable = el('media-hunt-hide-available-movies');
        if (hideAvailable) {
            hideAvailable.addEventListener('change', function(e) {
                activeFilters.hideAvailable = e.target.checked;
                updateModalFilterCount();
                autoApplyFilters();
            });
        }

        var genreInput = el('media-hunt-genre-search-input');
        var genreDropdown = el('media-hunt-genre-dropdown');
        if (genreInput && genreDropdown) {
            genreInput.addEventListener('click', function(e) {
                e.stopPropagation();
                genreDropdown.style.display = genreDropdown.style.display === 'block' ? 'none' : 'block';
            });
            document.addEventListener('click', function(e) {
                if (!genreDropdown.contains(e.target) && e.target !== genreInput) genreDropdown.style.display = 'none';
            });
            genreDropdown.addEventListener('click', function(e) { e.stopPropagation(); });
        }

        function bindRange(type, updateDisplayFn) {
            var minInput = el('media-hunt-filter-' + type + '-min');
            var maxInput = el('media-hunt-filter-' + type + '-max');
            if (!minInput || !maxInput) return;
            minInput.addEventListener('input', function() {
                if (parseFloat(minInput.value) > parseFloat(maxInput.value)) minInput.value = maxInput.value;
                updateDisplayFn();
                updateModalFilterCount();
            });
            minInput.addEventListener('change', autoApplyFilters);
            maxInput.addEventListener('input', function() {
                if (parseFloat(maxInput.value) < parseFloat(minInput.value)) maxInput.value = minInput.value;
                updateDisplayFn();
                updateModalFilterCount();
            });
            maxInput.addEventListener('change', autoApplyFilters);
            updateSliderRange(type, minInput, maxInput);
        }
        bindRange('year', updateYearDisplay);
        bindRange('runtime', updateRuntimeDisplay);
        bindRange('rating', updateRatingDisplay);
        bindRange('votes', updateVotesDisplay);

        var yearMin = el('media-hunt-filter-year-min');
        var yearMax = el('media-hunt-filter-year-max');
        if (yearMin && yearMax) {
            yearMin.max = maxYear;
            yearMin.value = minYear;
            yearMax.max = maxYear;
            yearMax.value = maxYear;
            updateYearDisplay();
            updateSliderRange('year', yearMin, yearMax);
        }
    }

    function init() {
        if (inited) return;
        inited = true;
        loadGenres().then(function() {
            setupEventListeners();
            updateFilterDisplay();
        });
    }

    window.MovieHuntFilters = window.MediaHuntFilters = {
        init: init,
        openFiltersModal: openFiltersModal,
        closeFiltersModal: closeFiltersModal,
        getFilterParams: getFilterParams,
        updateFilterDisplay: updateFilterDisplay,
        clearFilters: clearFilters
    };
})();


/* === modules/features/media-hunt-detail.js === */
/**
 * Media Hunt Detail – Movie detail view with management toolbar (movie mode).
 * Exposed as window.MovieHuntDetail for compatibility. CSS: media-hunt-detail.css.
 */
(function() {
    'use strict';

    window.MovieHuntDetail = {
        currentMovie: null,
        currentDetails: null,
        currentMovieStatus: null,
        tmdbApiKey: null,
        movieHuntInstances: [],
        combinedInstances: [],  // Movie Hunt + Radarr for dropdown; value is "mh:<id>" or "radarr:<name>"
        selectedInstanceId: null,

        /* ── Init ─────────────────────────────────────────────── */
        init() {
            console.log('[MovieHuntDetail] Module initialized');
            window.addEventListener('popstate', (e) => {
                if (e.state && e.state.movieDetail) {
                    this.openDetail(e.state.movieDetail, {}, true);
                } else if (!e.state || !e.state.requestarrMovieDetail) {
                    this.closeDetail(true);
                }
            });
            this.checkUrlForMovieDetail();
        },

        checkUrlForMovieDetail() {
            const hash = window.location.hash;
            const movieMatch = hash.match(/#movie\/(\d+)/);
            if (movieMatch) {
                const tmdbId = parseInt(movieMatch[1]);
                this.openDetailFromTmdbId(tmdbId);
            }
        },

        async openDetailFromTmdbId(tmdbId) {
            try {
                const details = await this.fetchMovieDetails(tmdbId);
                if (details) {
                    const movieData = {
                        tmdb_id: details.id, id: details.id,
                        title: details.title,
                        year: details.release_date ? new Date(details.release_date).getFullYear() : null,
                        poster_path: details.poster_path,
                        backdrop_path: details.backdrop_path,
                        overview: details.overview,
                        vote_average: details.vote_average,
                        in_library: false
                    };
                    this.openDetail(movieData, {}, true);
                }
            } catch (error) {
                console.error('[MovieHuntDetail] Error loading movie from URL:', error);
            }
        },

        /* ── Open / Close ─────────────────────────────────────── */
        async openDetail(movie, options = {}, fromHistory = false) {
            if (!movie) return;
            this.currentMovie = movie;
            this.currentMovieStatus = null;

            if (this.movieHuntInstances.length === 0) {
                await this.loadMovieHuntInstances();
            }
            await this.loadCombinedInstances();

            // Pre-select instance when opened from Requestarr/Home with a specific Movie Hunt instance
            const requestedInstanceName = (options && options.instanceName) ? String(options.instanceName).trim() : '';
            if (requestedInstanceName && this.movieHuntInstances.length > 0) {
                const match = this.movieHuntInstances.find(function(inst) {
                    return (inst.name || '').trim().toLowerCase() === requestedInstanceName.toLowerCase();
                });
                if (match) {
                    this.selectedInstanceId = match.id;
                }
            }

            let detailView = document.getElementById('media-hunt-detail-view');
            if (!detailView) {
                detailView = document.createElement('div');
                detailView.id = 'media-hunt-detail-view';
                detailView.className = 'movie-detail-view';
                document.body.appendChild(detailView);
            }
            detailView.innerHTML = this.getLoadingHTML();
            detailView.classList.add('active');

            if (!fromHistory) {
                const tmdbId = movie.tmdb_id || movie.id;
                const url = window.location.pathname + window.location.search + '#movie/' + tmdbId;
                history.pushState({ movieDetail: movie }, movie.title, url);
            }

            try {
                const tmdbId = movie.tmdb_id || movie.id;
                const details = await this.fetchMovieDetails(tmdbId);
                if (details) {
                    this.currentDetails = details;
                    detailView.innerHTML = this.renderMovieDetail(details, movie);
                    this.setupDetailInteractions();
                } else {
                    detailView.innerHTML = this.getErrorHTML('Failed to load movie details');
                }
            } catch (error) {
                console.error('[MovieHuntDetail] Error:', error);
                detailView.innerHTML = this.getErrorHTML('Failed to load movie details');
            }
        },

        closeDetail(fromHistory = false) {
            const detailView = document.getElementById('media-hunt-detail-view');
            if (detailView) detailView.classList.remove('active');
            if (!fromHistory) history.back();
        },

        /* ── TMDB Fetch ───────────────────────────────────────── */
        async fetchMovieDetails(tmdbId) {
            if (!tmdbId) return null;
            try {
                if (!this.tmdbApiKey) {
                    const keyResp = await fetch('./api/movie-hunt/tmdb-key');
                    if (!keyResp.ok) throw new Error('TMDB key failed');
                    this.tmdbApiKey = (await keyResp.json()).api_key;
                }
                if (!this.tmdbApiKey) return null;
                const url = 'https://api.themoviedb.org/3/movie/' + tmdbId +
                    '?api_key=' + this.tmdbApiKey +
                    '&append_to_response=credits,similar,videos,release_dates';
                const resp = await fetch(url);
                if (!resp.ok) throw new Error('TMDB ' + resp.status);
                return await resp.json();
            } catch (err) {
                console.error('[MovieHuntDetail] TMDB error:', err);
                return null;
            }
        },

        /* ── Render ────────────────────────────────────────────── */
        renderMovieDetail(details, originalMovie) {
            const backdropUrl = details.backdrop_path
                ? 'https://image.tmdb.org/t/p/original' + details.backdrop_path
                : (details.poster_path ? 'https://image.tmdb.org/t/p/original' + details.poster_path : '');
            const posterUrl = details.poster_path
                ? 'https://image.tmdb.org/t/p/w500' + details.poster_path
                : './static/images/blackout.jpg';
            const rating = details.vote_average ? Number(details.vote_average).toFixed(1) : 'N/A';
            const year = details.release_date ? new Date(details.release_date).getFullYear() : 'N/A';
            const runtime = details.runtime
                ? Math.floor(details.runtime / 60) + 'h ' + (details.runtime % 60) + 'm' : 'N/A';
            const genres = (details.genres || []).map(g =>
                '<span class="mh-genre-tag">' + this.escapeHtml(g.name) + '</span>'
            ).join('') || '<span class="mh-genre-tag">Unknown</span>';
            const overview = details.overview || 'No overview available.';

            // Certification
            let certification = '';
            if (details.release_dates && details.release_dates.results) {
                const us = details.release_dates.results.find(r => r.iso_3166_1 === 'US');
                if (us && us.release_dates && us.release_dates.length > 0) {
                    certification = us.release_dates[0].certification || '';
                }
            }

            // Director
            let director = 'N/A';
            let mainCast = [];
            if (details.credits) {
                if (details.credits.crew) {
                    const d = details.credits.crew.find(c => c.job === 'Director');
                    if (d) director = d.name;
                }
                if (details.credits.cast) mainCast = details.credits.cast.slice(0, 10);
            }

            // Similar movies
            const similarMovies = (details.similar && details.similar.results)
                ? details.similar.results.slice(0, 6) : [];

            // Status
            const inLibrary = originalMovie.in_library || false;
            let actionBtnHTML = '';
            if (inLibrary) {
                actionBtnHTML = '<span class="mh-btn mh-btn-success mh-btn-static"><i class="fas fa-check-circle"></i> Already in library</span>';
            } else {
                actionBtnHTML = '<button class="mh-btn mh-btn-primary" id="mh-btn-request"><i class="fas fa-plus-circle"></i> Add to Library</button>';
            }

            // Instance selector (Movie Hunt + Radarr); value is "mh:<id>" or "radarr:<name>"
            let instanceOpts = '';
            if (this.combinedInstances.length > 0) {
                const selectedValue = this.selectedInstanceId ? ('mh:' + this.selectedInstanceId) : '';
                instanceOpts = this.combinedInstances.map(opt => {
                    const sel = (opt.value === selectedValue) ? ' selected' : '';
                    return '<option value="' + this.escapeHtml(opt.value) + '"' + sel + '>' + this.escapeHtml(opt.label) + '</option>';
                }).join('');
            } else if (this.movieHuntInstances.length > 0) {
                instanceOpts = this.movieHuntInstances.map(inst => {
                    const sel = inst.id === this.selectedInstanceId ? ' selected' : '';
                    return '<option value="mh:' + inst.id + '"' + sel + '>' + this.escapeHtml(inst.name) + '</option>';
                }).join('');
            } else {
                instanceOpts = '<option>Loading...</option>';
            }

            return '' +
            /* ── Toolbar ── */
            '<div class="mh-toolbar">' +
                '<div class="mh-toolbar-left">' +
                    '<button class="mh-tb" id="mh-tb-back" title="Back"><i class="fas fa-arrow-left"></i></button>' +
                    /* Shown when IN collection: */
                    '<button class="mh-tb" id="mh-tb-refresh" title="Refresh" style="display:none"><i class="fas fa-redo-alt"></i><span>Refresh</span></button>' +
                    '<span id="mh-tb-force-container"></span>' +
                    /* Shown when NOT in collection: */
                    '<button class="mh-tb" id="mh-tb-search-movie" title="Search Movie" style="display:none"><i class="fas fa-search"></i><span>Search Movie</span></button>' +
                '</div>' +
                '<div class="mh-toolbar-right">' +
                    /* Shown when IN collection: */
                    '<button class="mh-tb" id="mh-tb-edit" title="Edit" style="display:none"><i class="fas fa-wrench"></i><span>Edit</span></button>' +
                    '<button class="mh-tb mh-tb-danger" id="mh-tb-delete" title="Delete" style="display:none"><i class="fas fa-trash-alt"></i></button>' +
                    /* Shown when NOT in collection: */
                    '<button class="mh-tb" id="mh-tb-hide" title="Hide from discovery" style="display:none"><i class="fas fa-eye-slash"></i></button>' +
                '</div>' +
            '</div>' +

            /* ── Hero ── */
            '<div class="mh-hero" style="background-image:url(\'' + backdropUrl + '\')">' +
                '<div class="mh-hero-grad">' +
                    '<div class="mh-hero-layout">' +
                        '<div class="mh-hero-poster">' +
                            '<img src="' + posterUrl + '" alt="' + this.escapeHtml(details.title) + '" onerror="this.src=\'./static/images/blackout.jpg\'">' +
                        '</div>' +
                        '<div class="mh-hero-info">' +
                            '<h1 class="mh-hero-title">' + this.escapeHtml(details.title) + '</h1>' +

                            '<div class="mh-hero-meta">' +
                                (certification ? '<span class="mh-cert">' + this.escapeHtml(certification) + '</span>' : '') +
                                '<span><i class="fas fa-calendar-alt"></i> ' + year + '</span>' +
                                '<span><i class="fas fa-clock"></i> ' + runtime + '</span>' +
                                '<span class="mh-star"><i class="fas fa-star"></i> ' + rating + '</span>' +
                            '</div>' +

                            '<div class="mh-hero-genres">' + genres + '</div>' +

                            '<div class="mh-hero-instance">' +
                                '<i class="fas fa-server"></i>' +
                                '<select id="mh-detail-instance-select">' + instanceOpts + '</select>' +
                            '</div>' +

                            /* ── Info Bar Row 1 ── */
                            '<div class="mh-info-bar" id="mh-info-bar">' +
                                '<div class="mh-ib mh-ib-path">' +
                                    '<div class="mh-ib-label">Path</div>' +
                                    '<div class="mh-ib-val" id="mh-ib-path"><i class="fas fa-spinner fa-spin"></i></div>' +
                                '</div>' +
                                '<div class="mh-ib">' +
                                    '<div class="mh-ib-label">Status</div>' +
                                    '<div class="mh-ib-val" id="mh-ib-status"><i class="fas fa-spinner fa-spin"></i></div>' +
                                '</div>' +
                                '<div class="mh-ib">' +
                                    '<div class="mh-ib-label">Quality Profile</div>' +
                                    '<div class="mh-ib-val" id="mh-ib-profile">-</div>' +
                                '</div>' +
                                '<div class="mh-ib">' +
                                    '<div class="mh-ib-label">Size</div>' +
                                    '<div class="mh-ib-val" id="mh-ib-size">-</div>' +
                                '</div>' +
                            '</div>' +
                            /* ── Info Bar Row 2 (file details, shown when downloaded) ── */
                            '<div class="mh-info-bar mh-info-bar-row2" id="mh-info-bar-row2" style="display:none">' +
                                '<div class="mh-ib">' +
                                    '<div class="mh-ib-label">Resolution</div>' +
                                    '<div class="mh-ib-val" id="mh-ib-resolution">-</div>' +
                                '</div>' +
                                '<div class="mh-ib">' +
                                    '<div class="mh-ib-label">Codec / Audio</div>' +
                                    '<div class="mh-ib-val" id="mh-ib-codec">-</div>' +
                                '</div>' +
                                '<div class="mh-ib">' +
                                    '<div class="mh-ib-label">Custom Format Score</div>' +
                                    '<div class="mh-ib-val" id="mh-ib-score">-</div>' +
                                '</div>' +
                                '<div class="mh-ib">' +
                                    '<div class="mh-ib-label">Min. Availability</div>' +
                                    '<div class="mh-ib-val" id="mh-ib-availability">-</div>' +
                                '</div>' +
                            '</div>' +

                            '<p class="mh-hero-overview">' + this.escapeHtml(overview) + '</p>' +

                            '<div class="mh-hero-actions" id="mh-detail-actions">' + actionBtnHTML + '</div>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
            '</div>' +

            /* ── Body ── */
            '<div class="mh-detail-body">' +
                /* Details */
                '<div class="mh-section">' +
                    '<h2 class="mh-section-title"><i class="fas fa-info-circle"></i> Movie Details</h2>' +
                    '<div class="mh-detail-grid">' +
                        '<div class="mh-grid-item"><div class="mh-grid-label">Director</div><div class="mh-grid-value">' + this.escapeHtml(director) + '</div></div>' +
                        '<div class="mh-grid-item"><div class="mh-grid-label">Release Date</div><div class="mh-grid-value">' + (details.release_date || 'N/A') + '</div></div>' +
                        '<div class="mh-grid-item"><div class="mh-grid-label">Rating</div><div class="mh-grid-value">' + (certification || 'Not Rated') + '</div></div>' +
                        '<div class="mh-grid-item"><div class="mh-grid-label">Budget</div><div class="mh-grid-value">' + (details.budget ? '$' + (details.budget / 1e6).toFixed(1) + 'M' : 'N/A') + '</div></div>' +
                        '<div class="mh-grid-item"><div class="mh-grid-label">Revenue</div><div class="mh-grid-value">' + (details.revenue ? '$' + (details.revenue / 1e6).toFixed(1) + 'M' : 'N/A') + '</div></div>' +
                        '<div class="mh-grid-item"><div class="mh-grid-label">Language</div><div class="mh-grid-value">' + (details.original_language ? details.original_language.toUpperCase() : 'N/A') + '</div></div>' +
                    '</div>' +
                '</div>' +

                /* Cast */
                (mainCast.length > 0 ? (
                    '<div class="mh-section">' +
                        '<h2 class="mh-section-title"><i class="fas fa-users"></i> Cast</h2>' +
                        '<div class="mh-cast-row">' + mainCast.map(a => this.renderCastCard(a)).join('') + '</div>' +
                    '</div>'
                ) : '') +

                /* Similar */
                (similarMovies.length > 0 ? (
                    '<div class="mh-section">' +
                        '<h2 class="mh-section-title"><i class="fas fa-film"></i> Similar Movies</h2>' +
                        '<div class="mh-similar-row">' + similarMovies.map(m => this.renderSimilarCard(m)).join('') + '</div>' +
                    '</div>'
                ) : '') +
            '</div>';
        },

        renderCastCard(actor) {
            const photo = actor.profile_path
                ? 'https://image.tmdb.org/t/p/w185' + actor.profile_path
                : './static/images/blackout.jpg';
            return '<div class="mh-cast-card">' +
                '<div class="mh-cast-photo"><img src="' + photo + '" alt="' + this.escapeHtml(actor.name) + '" onerror="this.src=\'./static/images/blackout.jpg\'"></div>' +
                '<div class="mh-cast-name">' + this.escapeHtml(actor.name) + '</div>' +
                '<div class="mh-cast-char">' + this.escapeHtml(actor.character || '') + '</div>' +
            '</div>';
        },

        renderSimilarCard(movie) {
            const poster = movie.poster_path
                ? 'https://image.tmdb.org/t/p/w185' + movie.poster_path
                : './static/images/blackout.jpg';
            return '<div class="mh-similar-card media-card" data-tmdb-id="' + movie.id + '">' +
                '<div class="media-card-poster"><img src="' + poster + '" alt="' + this.escapeHtml(movie.title) + '" onerror="this.src=\'./static/images/blackout.jpg\'"></div>' +
                '<div class="media-card-info">' +
                    '<div class="media-card-title">' + this.escapeHtml(movie.title) + '</div>' +
                    '<div class="media-card-meta">' +
                        '<span class="media-card-year">' + (movie.release_date ? new Date(movie.release_date).getFullYear() : 'N/A') + '</span>' +
                        '<span class="media-card-rating"><i class="fas fa-star"></i> ' + (movie.vote_average ? Number(movie.vote_average).toFixed(1) : 'N/A') + '</span>' +
                    '</div>' +
                '</div>' +
            '</div>';
        },

        /* ── Interactions ──────────────────────────────────────── */
        setupDetailInteractions() {
            const self = this;

            // Toolbar: Back
            const backBtn = document.getElementById('mh-tb-back');
            if (backBtn) backBtn.addEventListener('click', () => this.closeDetail());

            // Toolbar: Refresh
            const refreshBtn = document.getElementById('mh-tb-refresh');
            if (refreshBtn) refreshBtn.addEventListener('click', () => this.handleRefresh());

            // Toolbar: Edit
            const editBtn = document.getElementById('mh-tb-edit');
            if (editBtn) editBtn.addEventListener('click', () => this.openEditModal());

            // Toolbar: Delete
            const deleteBtn = document.getElementById('mh-tb-delete');
            if (deleteBtn) deleteBtn.addEventListener('click', () => this.openDeleteModal());

            // Toolbar: Search Movie (for items NOT in collection — requests via Requestarr modal)
            const searchMovieBtn = document.getElementById('mh-tb-search-movie');
            if (searchMovieBtn) searchMovieBtn.addEventListener('click', () => {
                const id = this.currentMovie ? (this.currentMovie.tmdb_id || this.currentMovie.id) : null;
                if (id && window.RequestarrDiscover && window.RequestarrDiscover.modal) {
                    window.RequestarrDiscover.modal.openModal(id, 'movie');
                }
            });

            // Toolbar: Hide from discovery (for items NOT in collection)
            const hideBtn = document.getElementById('mh-tb-hide');
            if (hideBtn) hideBtn.addEventListener('click', () => {
                if (!this.currentMovie || !window.MediaUtils) return;
                window.MediaUtils.hideMedia({
                    tmdbId: this.currentMovie.tmdb_id || this.currentMovie.id,
                    mediaType: 'movie',
                    title: this.currentMovie.title || 'this movie',
                    posterPath: this.currentMovie.poster_path || null,
                    appType: 'movie_hunt',
                    instanceName: '',
                    cardElement: null,
                    onHidden: () => {
                        this.closeDetail();
                    }
                });
            });

            // Instance selector (Movie Hunt: refresh status; Radarr: switch to Requestarr detail)
            const instanceSelect = document.getElementById('mh-detail-instance-select');
            if (instanceSelect) {
                instanceSelect.addEventListener('change', async () => {
                    const value = (instanceSelect.value || '').trim();
                    if (!value) return;

                    if (value.startsWith('radarr:')) {
                        const movie = this.currentMovie;
                        if (!movie) return;
                        const movieData = {
                            tmdb_id: movie.tmdb_id || movie.id,
                            id: movie.tmdb_id || movie.id,
                            title: movie.title,
                            year: movie.year,
                            poster_path: movie.poster_path,
                            backdrop_path: movie.backdrop_path,
                            overview: movie.overview,
                            vote_average: movie.vote_average,
                            in_library: movie.in_library
                        };
                        this.closeDetail(true);
                        if (window.huntarrUI && typeof window.huntarrUI.switchSection === 'function') {
                            window.huntarrUI.switchSection('requestarr-discover');
                        }
                        const RequestarrDetail = window.RequestarrDetail || (window.Requestarr && window.Requestarr.RequestarrDetail);
                        if (RequestarrDetail && typeof RequestarrDetail.openDetail === 'function') {
                            RequestarrDetail.openDetail(movieData, { suggestedInstance: value }, false);
                        }
                        return;
                    }

                    if (value.startsWith('mh:')) {
                        const instanceId = parseInt(value.slice(3), 10);
                        if (!instanceId) return;
                        this.selectedInstanceId = instanceId;
                        try {
                            await fetch('./api/movie-hunt/current-instance', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ instance_id: instanceId })
                            });
                        } catch (_) {}
                        this.updateMovieStatus();
                    }
                });
                this.updateMovieStatus();
            }

            // Request button → Requestarr modal
            const requestBtn = document.getElementById('mh-btn-request');
            if (requestBtn && this.currentMovie) {
                requestBtn.addEventListener('click', () => {
                    const tmdbId = this.currentMovie.tmdb_id || this.currentMovie.id;
                    if (tmdbId && window.RequestarrDiscover && window.RequestarrDiscover.modal) {
                        window.RequestarrDiscover.modal.openModal(tmdbId, 'movie');
                    }
                });
            }

            // ── Auto-refresh after request/edit/delete via shared event system ──
            if (window.MediaUtils) {
                window.MediaUtils.teardownDetailRefreshListeners(this._refreshHandle);
                this._refreshHandle = window.MediaUtils.setupDetailRefreshListeners({
                    getTmdbId: function() { return self.currentMovie && (self.currentMovie.tmdb_id || self.currentMovie.id); },
                    refreshCallback: function() { self.updateMovieStatus(); },
                    label: 'MovieHuntDetail'
                });
            }

            // Similar movie cards
            document.querySelectorAll('.mh-similar-card').forEach(card => {
                card.addEventListener('click', async () => {
                    const tmdbId = card.getAttribute('data-tmdb-id');
                    if (tmdbId) {
                        try {
                            const details = await this.fetchMovieDetails(tmdbId);
                            if (details) {
                                this.openDetail({
                                    tmdb_id: details.id, id: details.id,
                                    title: details.title,
                                    year: details.release_date ? new Date(details.release_date).getFullYear() : null,
                                    poster_path: details.poster_path,
                                    backdrop_path: details.backdrop_path,
                                    overview: details.overview,
                                    vote_average: details.vote_average,
                                    in_library: false
                                }, {}, false);
                            }
                        } catch (err) {
                            console.error('[MovieHuntDetail] Similar movie error:', err);
                        }
                    }
                });
            });

            // ESC to close
            const escHandler = (e) => {
                if (e.key === 'Escape') {
                    // Don't close if a modal is open
                    if (document.querySelector('.mh-modal-backdrop')) return;
                    this.closeDetail();
                    document.removeEventListener('keydown', escHandler);
                }
            };
            document.addEventListener('keydown', escHandler);
        },

        /* ── Edit Modal ────────────────────────────────────────── */
        async openEditModal() {
            const movie = this.currentMovie;
            const status = this.currentMovieStatus;
            if (!movie) return;

            const title = this.escapeHtml(movie.title || '');
            const instanceId = this.selectedInstanceId;

            // Fetch profiles and root folders in parallel
            let profiles = [], rootFolders = [];
            try {
                const [profResp, rfResp] = await Promise.all([
                    fetch('./api/profiles?instance_id=' + instanceId),
                    fetch('./api/movie-hunt/root-folders?instance_id=' + instanceId)
                ]);
                const profData = await profResp.json();
                profiles = profData.profiles || profData || [];
                const rfData = await rfResp.json();
                rootFolders = rfData.root_folders || rfData || [];
            } catch (err) {
                console.error('[MovieHuntDetail] Edit modal fetch error:', err);
            }

            const currentProfile = (status && status.quality_profile) || '';
            const currentRoot = (status && status.root_folder_path) || '';
            const currentAvail = (status && status.minimum_availability) || 'released';

            const profileOpts = (Array.isArray(profiles) ? profiles : []).map(p => {
                const name = p.name || 'Unknown';
                const sel = name === currentProfile ? ' selected' : '';
                return '<option value="' + this.escapeHtml(name) + '"' + sel + '>' + this.escapeHtml(name) + (p.is_default ? ' (Default)' : '') + '</option>';
            }).join('');

            const rfOpts = (Array.isArray(rootFolders) ? rootFolders : []).map(rf => {
                const path = rf.path || '';
                const sel = path === currentRoot ? ' selected' : '';
                return '<option value="' + this.escapeHtml(path) + '"' + sel + '>' + this.escapeHtml(path) + (rf.is_default ? ' (Default)' : '') + '</option>';
            }).join('');

            const availOpts = [
                { value: 'announced', label: 'Announced' },
                { value: 'inCinemas', label: 'In Cinemas' },
                { value: 'released', label: 'Released' }
            ].map(a => {
                const sel = a.value === currentAvail ? ' selected' : '';
                return '<option value="' + a.value + '"' + sel + '>' + a.label + '</option>';
            }).join('');

            const html =
                '<div class="mh-modal-backdrop" id="mh-edit-modal">' +
                    '<div class="mh-modal">' +
                        '<div class="mh-modal-header">' +
                            '<h3><i class="fas fa-wrench"></i> Edit — ' + title + '</h3>' +
                            '<button class="mh-modal-x" id="mh-edit-close">&times;</button>' +
                        '</div>' +
                        '<div class="mh-modal-body">' +
                            '<div class="mh-form-row">' +
                                '<label>Root Folder</label>' +
                                '<select id="mh-edit-root-folder" class="mh-select">' + rfOpts + '</select>' +
                            '</div>' +
                            '<div class="mh-form-row">' +
                                '<label>Quality Profile</label>' +
                                '<select id="mh-edit-quality-profile" class="mh-select">' + profileOpts + '</select>' +
                            '</div>' +
                            '<div class="mh-form-row">' +
                                '<label>Minimum Availability</label>' +
                                '<select id="mh-edit-min-availability" class="mh-select">' + availOpts + '</select>' +
                            '</div>' +
                        '</div>' +
                        '<div class="mh-modal-footer">' +
                            '<button class="mh-btn mh-btn-secondary" id="mh-edit-cancel">Cancel</button>' +
                            '<button class="mh-btn mh-btn-primary" id="mh-edit-save">Save</button>' +
                        '</div>' +
                    '</div>' +
                '</div>';

            // Remove existing modal
            const existing = document.getElementById('mh-edit-modal');
            if (existing) existing.remove();

            document.body.insertAdjacentHTML('beforeend', html);

            // Wire up
            document.getElementById('mh-edit-close').addEventListener('click', () => document.getElementById('mh-edit-modal').remove());
            document.getElementById('mh-edit-cancel').addEventListener('click', () => document.getElementById('mh-edit-modal').remove());
            document.getElementById('mh-edit-modal').addEventListener('click', (e) => {
                if (e.target.id === 'mh-edit-modal') document.getElementById('mh-edit-modal').remove();
            });
            document.getElementById('mh-edit-save').addEventListener('click', () => this.handleSaveEdit());
        },

        async handleSaveEdit() {
            const movie = this.currentMovie;
            if (!movie) return;
            const tmdbId = movie.tmdb_id || movie.id;
            const rootFolder = document.getElementById('mh-edit-root-folder').value;
            const qualityProfile = document.getElementById('mh-edit-quality-profile').value;
            const minAvailability = document.getElementById('mh-edit-min-availability').value;

            const saveBtn = document.getElementById('mh-edit-save');
            if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving...'; }

            try {
                const resp = await fetch('./api/movie-hunt/collection/update?instance_id=' + this.selectedInstanceId, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ tmdb_id: tmdbId, root_folder: rootFolder, quality_profile: qualityProfile, minimum_availability: minAvailability })
                });
                const data = await resp.json();
                if (data.success) {
                    const modal = document.getElementById('mh-edit-modal');
                    if (modal) modal.remove();
                    this.updateMovieStatus(); // refresh info bar
                    // Notify all listening detail pages via shared event system
                    if (window.MediaUtils) window.MediaUtils.dispatchStatusChanged(tmdbId, 'edit');
                } else {
                    var msg = 'Save failed: ' + (data.error || 'Unknown error');
                    if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification(msg, 'error');
                    else alert(msg);
                    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
                }
            } catch (err) {
                var msg = 'Save failed: ' + err.message;
                if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification(msg, 'error');
                else alert(msg);
                if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
            }
        },

        /* ── Delete Modal (delegates to shared MovieCardDeleteModal) ── */
        openDeleteModal() {
            const movie = this.currentMovie;
            const status = this.currentMovieStatus;
            if (!movie) return;

            if (!window.MovieCardDeleteModal) {
                console.error('[MovieHuntDetail] MovieCardDeleteModal not loaded');
                return;
            }

            const hasFile = !!(status && status.has_file);
            const filePath = (status && status.path) || (status && status.root_folder_path) || '';
            const movieStatus = hasFile ? 'available' : 'requested';

            // Resolve instance name from selectedInstanceId
            let instanceName = '';
            if (this.movieHuntInstances && this.selectedInstanceId) {
                const match = this.movieHuntInstances.find(inst => inst.id === this.selectedInstanceId);
                if (match) instanceName = match.name || '';
            }

            const self = this;
            window.MovieCardDeleteModal.open(movie, {
                instanceName: instanceName,
                instanceId: this.selectedInstanceId || '',
                status: movieStatus,
                hasFile: hasFile,
                filePath: filePath,
                appType: 'movie_hunt',
                onDeleted: function() {
                    self.closeDetail();
                }
            });
        },

        /* ── Refresh ───────────────────────────────────────────── */
        async handleRefresh() {
            const btn = document.getElementById('mh-tb-refresh');
            if (btn) {
                const icon = btn.querySelector('i');
                if (icon) icon.classList.add('fa-spin');
            }
            await this.updateMovieStatus();
            if (btn) {
                const icon = btn.querySelector('i');
                if (icon) setTimeout(() => icon.classList.remove('fa-spin'), 500);
            }
        },

        /* ── Force Search ──────────────────────────────────────── */
        async handleForceSearch() {
            var movie = this.currentMovie;
            if (!movie) return;
            var btn = document.getElementById('mh-tb-force-search');
            if (btn) { btn.disabled = true; var icon = btn.querySelector('i'); if (icon) { icon.className = 'fas fa-spinner fa-spin'; } }

            var notify = function(msg, type) {
                if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification(msg, type);
                else alert(msg);
            };

            try {
                var resp = await fetch('./api/movie-hunt/request?instance_id=' + this.selectedInstanceId, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        title: movie.title || '',
                        year: movie.year || '',
                        tmdb_id: movie.tmdb_id || movie.id,
                        poster_path: movie.poster_path || '',
                        start_search: true,
                        runtime: (this.currentDetails && this.currentDetails.runtime) || 90
                    })
                });
                var data = await resp.json();
                if (data.success) {
                    notify('Search complete — ' + (data.message || 'Sent to download client.'), 'success');
                } else {
                    notify(data.message || 'No matching release found.', 'error');
                }
            } catch (err) {
                notify('Search failed: ' + err.message, 'error');
            }

            if (btn) { btn.disabled = false; var icon = btn.querySelector('i'); if (icon) { icon.className = 'fas fa-search'; } }
            this.updateMovieStatus();
            if (window.MediaUtils) window.MediaUtils.dispatchStatusChanged(movie.tmdb_id || movie.id, 'force-search');
        },

        /* ── Force Upgrade ─────────────────────────────────────── */
        async handleForceUpgrade() {
            var movie = this.currentMovie;
            var status = this.currentMovieStatus;
            if (!movie) return;
            var btn = document.getElementById('mh-tb-force-upgrade');
            if (btn) { btn.disabled = true; var icon = btn.querySelector('i'); if (icon) { icon.className = 'fas fa-spinner fa-spin'; } }

            var notify = function(msg, type) {
                if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification(msg, type);
                else alert(msg);
            };

            try {
                var currentScore = (status && status.file_score != null) ? status.file_score : 0;
                var resp = await fetch('./api/movie-hunt/force-upgrade?instance_id=' + this.selectedInstanceId, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        title: movie.title || '',
                        year: movie.year || '',
                        tmdb_id: movie.tmdb_id || movie.id,
                        current_score: currentScore,
                        quality_profile: (status && status.quality_profile) || '',
                        runtime: (this.currentDetails && this.currentDetails.runtime) || 90
                    })
                });
                var data = await resp.json();
                if (data.success) {
                    notify(data.message || 'Upgrade sent to download client.', 'success');
                } else {
                    notify(data.message || 'No higher-scoring release available.', 'info');
                }
            } catch (err) {
                notify('Upgrade search failed: ' + err.message, 'error');
            }

            if (btn) { btn.disabled = false; var icon = btn.querySelector('i'); if (icon) { icon.className = 'fas fa-arrow-circle-up'; } }
            this.updateMovieStatus();
            if (window.MediaUtils) window.MediaUtils.dispatchStatusChanged(movie.tmdb_id || movie.id, 'force-upgrade');
        },

        /* ── Status ────────────────────────────────────────────── */
        async loadMovieHuntInstances() {
            try {
                const resp = await fetch('./api/movie-hunt/instances');
                const data = await resp.json();
                if (data.instances && data.instances.length > 0) {
                    this.movieHuntInstances = data.instances;
                    if (!this.selectedInstanceId) {
                        const cur = await fetch('./api/movie-hunt/current-instance');
                        const curData = await cur.json();
                        this.selectedInstanceId = curData.instance_id || this.movieHuntInstances[0].id;
                    }
                } else {
                    this.movieHuntInstances = [];
                    this.selectedInstanceId = null;
                }
            } catch (err) {
                console.error('[MovieHuntDetail] Instances error:', err);
                this.movieHuntInstances = [];
                this.selectedInstanceId = null;
            }
        },

        async loadCombinedInstances() {
            const combined = [];
            this.movieHuntInstances.forEach(inst => {
                combined.push({
                    type: 'movie_hunt',
                    value: 'mh:' + inst.id,
                    label: 'Movie Hunt – ' + (inst.name || ''),
                    id: inst.id,
                    name: inst.name
                });
            });
            try {
                const resp = await fetch('./api/requestarr/instances/radarr');
                const data = await resp.json();
                if (data.instances && data.instances.length > 0) {
                    data.instances.forEach(inst => {
                        const name = inst.name || '';
                        combined.push({
                            type: 'radarr',
                            value: 'radarr:' + name,
                            label: 'Radarr – ' + name,
                            name: name
                        });
                    });
                }
            } catch (err) {
                console.warn('[MovieHuntDetail] Could not load Radarr instances for dropdown:', err);
            }
            this.combinedInstances = combined;
        },

        async checkMovieStatus(tmdbId, instanceId) {
            if (!instanceId) return { in_library: false };
            try {
                const resp = await fetch('./api/movie-hunt/collection?instance_id=' + instanceId);
                const data = await resp.json();
                const items = data.items || [];
                const movie = items.find(item => item.tmdb_id === tmdbId);
                if (movie) return { in_library: movie.status === 'available' };
                return { in_library: false };
            } catch (err) {
                return { in_library: false };
            }
        },

        async updateMovieStatus() {
            if (!this.currentMovie || !this.selectedInstanceId) return;
            const tmdbId = this.currentMovie.tmdb_id || this.currentMovie.id;

            // Phase 1: Quick load without probe (instant response)
            const data = await this.fetchMovieHuntStatus(tmdbId, this.selectedInstanceId, true);
            const isDownloaded = data && data.found && (data.status || '').toLowerCase() === 'downloaded';
            
            // A movie is "found" if the API says so, OR if it's already downloaded/in-library
            const isFound = !!(data && (data.found || (data.status && data.status !== '')));

            // Phase 2: If movie has a file and probe is pending, trigger the actual scan
            if (data && data.has_file && data.probe_status === 'pending') {
                this._triggerProbe(tmdbId, this.selectedInstanceId);
            }

            // Update toolbar management buttons visibility
            const editBtn = document.getElementById('mh-tb-edit');
            const deleteBtn = document.getElementById('mh-tb-delete');
            const refreshBtn = document.getElementById('mh-tb-refresh');
            if (editBtn) editBtn.style.display = isFound ? '' : 'none';
            if (deleteBtn) deleteBtn.style.display = isFound ? '' : 'none';
            if (refreshBtn) refreshBtn.style.display = isFound ? '' : 'none';

            // Not-in-collection buttons
            const searchMovieBtn = document.getElementById('mh-tb-search-movie');
            const hideBtn = document.getElementById('mh-tb-hide');
            if (searchMovieBtn) searchMovieBtn.style.display = isFound ? 'none' : '';
            if (hideBtn) hideBtn.style.display = isFound ? 'none' : '';

            // Update action button — hide if already downloaded or already requested
            const actionsContainer = document.getElementById('mh-detail-actions');
            if (actionsContainer) {
                var isRequested = data && data.found && !isDownloaded;
                if (isDownloaded || isRequested) {
                    // Status badge in the info bar already communicates the state
                    actionsContainer.innerHTML = '';
                } else {
                    actionsContainer.innerHTML = '<button class="mh-btn mh-btn-primary" id="mh-btn-request"><i class="fas fa-plus-circle"></i> Add to Library</button>';
                    const requestBtn = document.getElementById('mh-btn-request');
                    if (requestBtn) {
                        requestBtn.addEventListener('click', () => {
                            const id = this.currentMovie.tmdb_id || this.currentMovie.id;
                            if (id && window.RequestarrDiscover && window.RequestarrDiscover.modal) {
                                window.RequestarrDiscover.modal.openModal(id, 'movie');
                            }
                        });
                    }
                }
            }

            // Update toolbar Force Search / Force Upgrade button
            const forceContainer = document.getElementById('mh-tb-force-container');
            if (forceContainer) {
                if (isDownloaded) {
                    forceContainer.innerHTML = '<button class="mh-tb" id="mh-tb-force-upgrade" title="Search for a higher-scoring release"><i class="fas fa-arrow-circle-up"></i><span>Force Upgrade</span></button>';
                    var upgradeBtn = document.getElementById('mh-tb-force-upgrade');
                    if (upgradeBtn) upgradeBtn.addEventListener('click', () => this.handleForceUpgrade());
                } else if (data && data.found) {
                    forceContainer.innerHTML = '<button class="mh-tb" id="mh-tb-force-search" title="Search indexers and download"><i class="fas fa-search"></i><span>Force Search</span></button>';
                    var searchBtn = document.getElementById('mh-tb-force-search');
                    if (searchBtn) searchBtn.addEventListener('click', () => this.handleForceSearch());
                } else {
                    forceContainer.innerHTML = '';
                }
            }
        },

        async fetchMovieHuntStatus(tmdbId, instanceId, skipProbe) {
            try {
                var url = './api/movie-hunt/movie-status?tmdb_id=' + tmdbId + '&instance_id=' + instanceId;
                if (skipProbe) url += '&skip_probe=true';
                const resp = await fetch(url);
                const data = await resp.json();
                this.currentMovieStatus = data;

                const pathEl = document.getElementById('mh-ib-path');
                const statusEl = document.getElementById('mh-ib-status');
                const profileEl = document.getElementById('mh-ib-profile');
                const sizeEl = document.getElementById('mh-ib-size');

                if (!data.success || !data.found) {
                    if (pathEl) pathEl.textContent = '-';
                    if (statusEl) statusEl.innerHTML = '<span class="mh-badge mh-badge-none">Not in Collection</span>';
                    if (profileEl) profileEl.textContent = '-';
                    if (sizeEl) sizeEl.textContent = '-';
                    return data;
                }

                // Path
                if (pathEl) {
                    const pathText = data.path || data.root_folder_path || '-';
                    pathEl.textContent = pathText;
                    pathEl.title = pathText;
                }

                // Status badge (use "Already in library" when downloaded)
                if (statusEl) {
                    let cls = '', icon = '', label = '';
                    if (data.status === 'downloaded') {
                        cls = 'mh-badge-ok'; icon = 'fa-check-circle'; label = 'Already in library';
                    } else if (data.status === 'missing') {
                        cls = 'mh-badge-warn'; icon = 'fa-exclamation-circle'; label = 'Requested';
                    } else {
                        cls = 'mh-badge-warn'; icon = 'fa-clock'; label = 'Requested';
                    }
                    statusEl.innerHTML = '<span class="mh-badge ' + cls + '"><i class="fas ' + icon + '"></i> ' + label + '</span>';
                }

                // Quality Profile
                if (profileEl) profileEl.textContent = data.quality_profile || '-';

                // Size
                if (sizeEl) sizeEl.textContent = this.formatFileSize(data.file_size || 0);

                // File quality badge (append to size)
                if (data.file_quality && sizeEl) {
                    sizeEl.innerHTML = this.formatFileSize(data.file_size || 0) +
                        ' <span class="mh-badge mh-badge-quality">' + this.escapeHtml(data.file_quality) + '</span>';
                }

                // Row 2: resolution, codec, score, availability (only for downloaded files)
                var row2 = document.getElementById('mh-info-bar-row2');
                if (data.has_file && row2) {
                    row2.style.display = '';
                    var resEl = document.getElementById('mh-ib-resolution');
                    var codecEl = document.getElementById('mh-ib-codec');
                    var scoreEl = document.getElementById('mh-ib-score');
                    var availEl = document.getElementById('mh-ib-availability');

                    // Show probe-status-aware content for resolution and codec
                    var probeStatus = data.probe_status || '';
                    if (probeStatus === 'pending') {
                        // Phase 1: haven't probed yet, show "Pending"
                        if (resEl) resEl.innerHTML = '<span class="mh-probe-badge mh-probe-pending"><i class="fas fa-clock"></i> Pending</span>';
                        if (codecEl) codecEl.innerHTML = '<span class="mh-probe-badge mh-probe-pending"><i class="fas fa-clock"></i> Pending</span>';
                    } else if (probeStatus === 'failed') {
                        var resText = data.file_resolution || '';
                        var codecText = (data.file_codec && data.file_codec !== '-') ? data.file_codec : '';
                        if (resEl) resEl.innerHTML = resText
                            ? this._wrapRescannable(this.escapeHtml(resText), 'mh-probe-failed')
                            : this._wrapRescannable('<i class="fas fa-exclamation-triangle"></i> Failed', 'mh-probe-failed');
                        if (codecEl) codecEl.innerHTML = codecText
                            ? this._wrapRescannable(this.escapeHtml(codecText), 'mh-probe-failed')
                            : this._wrapRescannable('<i class="fas fa-exclamation-triangle"></i> Failed', 'mh-probe-failed');
                    } else if (probeStatus === 'disabled') {
                        // Analyze off — show filename-based data, no rescan
                        if (resEl) resEl.textContent = data.file_resolution || '-';
                        if (codecEl) {
                            var codecStr = this._buildCodecString(data);
                            codecEl.textContent = codecStr || '-';
                        }
                    } else {
                        // cached, scanned, or filename — show data with rescan on hover
                        var resText = data.file_resolution || '-';
                        var codecStr = this._buildCodecString(data);
                        if (resEl) resEl.innerHTML = this._wrapRescannable(this.escapeHtml(resText));
                        if (codecEl) codecEl.innerHTML = this._wrapRescannable(this.escapeHtml(codecStr || '-'));
                    }
                    // Bind rescan click handlers on the row
                    this._bindRescanHandlers();

                    // Score with hover tooltip
                    if (scoreEl) {
                        var scoreVal = data.file_score;
                        if (scoreVal != null) {
                            var scoreClass = scoreVal >= 0 ? 'mh-score-pos' : 'mh-score-neg';
                            var breakdown = data.file_score_breakdown || 'No custom format matches';
                            scoreEl.innerHTML = '<span class="mh-score-badge ' + scoreClass + '" title="' + this.escapeHtml(breakdown) + '">' + scoreVal + '</span>';
                        } else {
                            scoreEl.textContent = '-';
                        }
                    }

                    // Minimum availability
                    if (availEl) {
                        var avail = data.minimum_availability || 'released';
                        var availMap = { 'announced': 'Announced', 'inCinemas': 'In Cinemas', 'released': 'Released' };
                        availEl.textContent = availMap[avail] || avail;
                    }
                } else if (row2) {
                    // Show row 2 with just availability for non-downloaded movies
                    if (data.found) {
                        row2.style.display = '';
                        var resEl = document.getElementById('mh-ib-resolution');
                        var codecEl = document.getElementById('mh-ib-codec');
                        var scoreEl = document.getElementById('mh-ib-score');
                        var availEl = document.getElementById('mh-ib-availability');
                        if (resEl) resEl.textContent = '-';
                        if (codecEl) codecEl.textContent = '-';
                        if (scoreEl) scoreEl.textContent = '-';
                        if (availEl) {
                            var avail = data.minimum_availability || 'released';
                            var availMap = { 'announced': 'Announced', 'inCinemas': 'In Cinemas', 'released': 'Released' };
                            availEl.textContent = availMap[avail] || avail;
                        }
                    } else {
                        row2.style.display = 'none';
                    }
                }

                return data;
            } catch (err) {
                console.error('[MovieHuntDetail] Status fetch error:', err);
                return null;
            }
        },

        /* ── Probe helpers ─────────────────────────────────────── */

        _wrapRescannable(innerHtml, badgeClass) {
            // Wrap content in a clickable rescan container with a subtle icon on hover
            var cls = 'mh-probe-badge mh-rescannable';
            if (badgeClass) cls += ' ' + badgeClass;
            return '<span class="' + cls + '" title="Click to rescan">' +
                '<span class="mh-rescan-content">' + innerHtml + '</span>' +
                '<i class="fas fa-redo-alt mh-rescan-icon"></i>' +
                '</span>';
        },

        _bindRescanHandlers() {
            var self = this;
            var btns = document.querySelectorAll('#mh-info-bar-row2 .mh-rescannable');
            btns.forEach(function(btn) {
                if (btn._rescanBound) return;
                btn._rescanBound = true;
                btn.addEventListener('click', function() {
                    if (!self.currentMovie || !self.selectedInstanceId) return;
                    var tmdbId = self.currentMovie.tmdb_id || self.currentMovie.id;
                    self._triggerForceProbe(tmdbId, self.selectedInstanceId);
                });
            });
        },

        async _triggerForceProbe(tmdbId, instanceId) {
            // Show "Scanning" while waiting for the force re-probe
            var resEl = document.getElementById('mh-ib-resolution');
            var codecEl = document.getElementById('mh-ib-codec');
            if (resEl) resEl.innerHTML = '<span class="mh-probe-badge mh-probe-scanning"><i class="fas fa-spinner fa-spin"></i> Scanning</span>';
            if (codecEl) codecEl.innerHTML = '<span class="mh-probe-badge mh-probe-scanning"><i class="fas fa-spinner fa-spin"></i> Scanning</span>';

            // Force re-probe (skip cache)
            try {
                var url = './api/movie-hunt/movie-status?tmdb_id=' + tmdbId + '&instance_id=' + instanceId + '&force_probe=true';
                var resp = await fetch(url);
                var data = await resp.json();
                this.currentMovieStatus = data;

                // Update resolution/codec/score cells with fresh data
                if (data && data.has_file) {
                    var probeStatus = data.probe_status || '';
                    if (probeStatus === 'failed') {
                        var resText = data.file_resolution || '';
                        var codecText = (data.file_codec && data.file_codec !== '-') ? data.file_codec : '';
                        if (resEl) resEl.innerHTML = resText
                            ? this._wrapRescannable(this.escapeHtml(resText), 'mh-probe-failed')
                            : this._wrapRescannable('<i class="fas fa-exclamation-triangle"></i> Failed', 'mh-probe-failed');
                        if (codecEl) codecEl.innerHTML = codecText
                            ? this._wrapRescannable(this.escapeHtml(codecText), 'mh-probe-failed')
                            : this._wrapRescannable('<i class="fas fa-exclamation-triangle"></i> Failed', 'mh-probe-failed');
                    } else {
                        var resText = data.file_resolution || '-';
                        var codecStr = this._buildCodecString(data);
                        if (resEl) resEl.innerHTML = this._wrapRescannable(this.escapeHtml(resText));
                        if (codecEl) codecEl.innerHTML = this._wrapRescannable(this.escapeHtml(codecStr || '-'));
                    }
                    this._bindRescanHandlers();

                    // Update score (may have changed due to probe-enriched scoring)
                    var scoreEl = document.getElementById('mh-ib-score');
                    if (scoreEl) {
                        var scoreVal = data.file_score;
                        if (scoreVal != null) {
                            var scoreClass = scoreVal >= 0 ? 'mh-score-pos' : 'mh-score-neg';
                            var breakdown = data.file_score_breakdown || 'No custom format matches';
                            scoreEl.innerHTML = '<span class="mh-score-badge ' + scoreClass + '" title="' + this.escapeHtml(breakdown) + '">' + scoreVal + '</span>';
                        }
                    }
                }
            } catch (err) {
                console.error('[MovieHuntDetail] Force probe error:', err);
                if (resEl) resEl.innerHTML = this._wrapRescannable('<i class="fas fa-exclamation-triangle"></i> Error', 'mh-probe-failed');
                if (codecEl) codecEl.innerHTML = this._wrapRescannable('<i class="fas fa-exclamation-triangle"></i> Error', 'mh-probe-failed');
                this._bindRescanHandlers();
            }
        },

        _buildCodecString(data) {
            if (data.file_video_codec || data.file_audio_codec) {
                var parts = [];
                if (data.file_video_codec) parts.push(data.file_video_codec);
                if (data.file_audio_codec) {
                    var audioStr = data.file_audio_codec;
                    if (data.file_audio_channels && data.file_audio_channels !== 'Mono' && data.file_audio_channels !== 'Stereo' && data.file_audio_channels !== '0ch') {
                        audioStr += ' ' + data.file_audio_channels;
                    } else if (data.file_audio_channels) {
                        audioStr += ' (' + data.file_audio_channels + ')';
                    }
                    parts.push(audioStr);
                }
                return parts.join(' / ');
            }
            return data.file_codec || '-';
        },

        async _triggerProbe(tmdbId, instanceId) {
            // Show "Scanning" while waiting for the full probe
            var resEl = document.getElementById('mh-ib-resolution');
            var codecEl = document.getElementById('mh-ib-codec');
            if (resEl) resEl.innerHTML = '<span class="mh-probe-badge mh-probe-scanning"><i class="fas fa-spinner fa-spin"></i> Scanning</span>';
            if (codecEl) codecEl.innerHTML = '<span class="mh-probe-badge mh-probe-scanning"><i class="fas fa-spinner fa-spin"></i> Scanning</span>';

            // Phase 2: full probe request (may take a few seconds)
            var data = await this.fetchMovieHuntStatus(tmdbId, instanceId, false);

            // fetchMovieHuntStatus already updates the DOM with results or "Failed"
        },

        /* ── Utilities ─────────────────────────────────────────── */
        formatFileSize(bytes) {
            if (!bytes || bytes === 0) return '0 B';
            if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(1) + ' GB';
            if (bytes >= 1048576) return (bytes / 1048576).toFixed(0) + ' MB';
            return (bytes / 1024).toFixed(0) + ' KB';
        },

        getLoadingHTML() {
            return '<div class="mh-toolbar"><div class="mh-toolbar-left"><button class="mh-tb" id="mh-tb-back" title="Back"><i class="fas fa-arrow-left"></i></button></div><div class="mh-toolbar-right"></div></div>' +
                '<div class="movie-detail-loading"><i class="fas fa-spinner fa-spin"></i><p>Loading movie details...</p></div>';
        },

        getErrorHTML(message) {
            return '<div class="mh-toolbar"><div class="mh-toolbar-left"><button class="mh-tb" id="mh-tb-back" title="Back"><i class="fas fa-arrow-left"></i></button></div><div class="mh-toolbar-right"></div></div>' +
                '<div class="movie-detail-loading"><i class="fas fa-exclamation-triangle" style="color:#ef4444"></i><p style="color:#ef4444">' + this.escapeHtml(message) + '</p></div>';
        },

        escapeHtml(text) {
            if (!text) return '';
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
    };

    // Initialize
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => window.MovieHuntDetail.init());
    } else {
        window.MovieHuntDetail.init();
    }
})();


/* === modules/features/media-hunt-activity.js === */
/**
 * Media Hunt Activity – Part 1: Movie Hunt (Queue, History, Blocklist, Logs).
 * Exposes window.ActivityModule. Uses activity-* DOM IDs and /api/activity/.
 */
(function() {
    'use strict';

    var currentView = 'queue';
    var currentPage = 1;
    var totalPages = 1;
    var pageSize = 20;
    var searchQuery = '';
    var isLoading = false;
    // Movie Hunt Logs (independent of main Huntarr logs)
    var logPage = 1;
    var logTotalPages = 1;
    var logTotalLogs = 0;
    var logPageSize = 20;
    var logLevel = 'info';
    var logSearch = '';

    function el(id) { return document.getElementById(id); }

    function showLoading(show) {
        var loading = el('activityLoading');
        if (loading) loading.style.display = show ? 'block' : 'none';
    }

    function showEmptyState(show, title, message) {
        var empty = el('activityEmptyState');
        var titleEl = el('activityEmptyTitle');
        var msgEl = el('activityEmptyMessage');
        if (empty) empty.style.display = show ? 'block' : 'none';
        if (titleEl && title) titleEl.textContent = title;
        if (msgEl && message) msgEl.textContent = message;
    }

    function hideAllViews() {
        ['activity-queue-view', 'activity-history-view', 'activity-blocklist-view', 'activity-logs-view'].forEach(function(id) {
            var v = el(id);
            if (v) v.style.display = 'none';
        });
    }

    function switchView(view) {
        currentView = view;
        hideAllViews();
        var viewId = 'activity-' + view + '-view';
        var viewEl = el(viewId);
        if (viewEl) viewEl.style.display = 'block';
        var removeBtn = el('activityRemoveSelectedButton');
        if (removeBtn) removeBtn.style.display = view === 'queue' ? '' : 'none';
        var toolbar = document.getElementById('activityQueueToolbar');
        if (toolbar) toolbar.style.display = view === 'logs' ? 'none' : 'flex';
        currentPage = 1;
        if (view === 'logs') {
            logPage = 1;
            showEmptyState(false);
            loadMovieHuntLogs();
        } else {
            loadData();
        }
    }

    function loadMovieHuntLogs() {
        var container = el('activityLogsContainer');
        if (!container) return;
        var params = new URLSearchParams({
            limit: String(logPageSize),
            offset: String((logPage - 1) * logPageSize)
        });
        if (logLevel && logLevel !== 'all') params.append('level', logLevel.toUpperCase());
        if (logSearch) params.append('search', logSearch);
        var statusEl = el('activityLogConnectionStatus');
        if (statusEl) { statusEl.textContent = 'Loading...'; statusEl.className = 'status-disconnected'; }
        container.innerHTML = '';
        fetch('./api/logs/movie_hunt?' + params.toString(), { cache: 'no-store' })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (statusEl) {
                    statusEl.textContent = data.success ? 'Connected' : (data.error || 'Error');
                    statusEl.className = data.success ? 'status-connected' : 'status-error';
                }
                if (!data.success || !data.logs) {
                    if (statusEl && !data.success) statusEl.className = 'status-error';
                    return;
                }
                logTotalLogs = data.total != null ? data.total : 0;
                logTotalPages = Math.max(1, Math.ceil(logTotalLogs / logPageSize));
                var curEl = el('activityLogCurrentPage');
                var totalEl = el('activityLogTotalPages');
                if (curEl) curEl.textContent = logPage;
                if (totalEl) totalEl.textContent = logTotalPages;
                var prevBtn = el('activityLogPrevPage');
                var nextBtn = el('activityLogNextPage');
                if (prevBtn) prevBtn.disabled = logPage <= 1;
                if (nextBtn) nextBtn.disabled = logPage >= logTotalPages;
                var logRegex = /^([^|]+)\|([^|]+)\|([^|]+)\|(.*)$/;
                data.logs.forEach(function(line) {
                    var m = line.match(logRegex);
                    if (!m) return;
                    var timestamp = m[1].trim();
                    var level = (m[2] || 'INFO').toLowerCase();
                    var appType = (m[3] || 'movie_hunt').toUpperCase();
                    var message = (m[4] || '').trim().replace(/^\s*-\s*/, '');
                    var levelClass = level === 'error' ? 'log-level-error' : level === 'warning' || level === 'warn' ? 'log-level-warning' : level === 'debug' ? 'log-level-debug' : 'log-level-info';
                    var levelLabel = level === 'error' ? 'Error' : level === 'warning' || level === 'warn' ? 'Warning' : level === 'debug' ? 'Debug' : 'Info';
                    var row = document.createElement('tr');
                    row.className = 'log-table-row';
                    row.innerHTML = '<td class="col-time">' + escapeHtml(timestamp) + '</td><td class="col-level"><span class="log-level-badge ' + levelClass + '">' + escapeHtml(levelLabel) + '</span></td><td class="col-app">' + escapeHtml(appType) + '</td><td class="col-message">' + escapeHtml(message) + '</td>';
                    container.appendChild(row);
                });
                showEmptyState(data.logs.length === 0, 'No log entries', 'Log entries will appear here when available.');
            })
            .catch(function() {
                if (statusEl) { statusEl.textContent = 'Connection error'; statusEl.className = 'status-error'; }
            });
    }

    function clearMovieHuntLogs() {
        var doClear = function() {
            fetch('./api/logs/movie_hunt/clear', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (data.success) {
                    logPage = 1;
                    logTotalLogs = 0;
                    logTotalPages = 1;
                    loadMovieHuntLogs();
                    if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Movie Hunt logs cleared.', 'success');
                } else if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification(data.error || 'Failed to clear logs', 'error');
            })
            .catch(function() {
                if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Connection error', 'error');
            });
        };
        if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
            window.HuntarrConfirm.show({ title: 'Clear Movie Hunt Logs', message: 'Clear all Movie Hunt logs? This cannot be undone.', confirmLabel: 'Clear', onConfirm: doClear });
        } else {
            if (!window.confirm('Clear all Movie Hunt logs? This cannot be undone.')) return;
            doClear();
        }
    }

    function loadData() {
        if (isLoading) return;
        isLoading = true;
        showLoading(true);
        showEmptyState(false);

        var params = new URLSearchParams({ page: currentPage, page_size: pageSize });
        if (searchQuery) params.append('search', searchQuery);
        params.append('_t', Date.now()); // cache-bust so refresh always gets fresh stats

        var url = './api/activity/' + currentView + '?' + params.toString();
        fetch(url, { cache: 'no-store' })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var items = data.items || [];
                var total = data.total != null ? data.total : 0;
                totalPages = data.total_pages != null ? data.total_pages : (total ? Math.ceil(total / pageSize) : 1);
                if (totalPages < 1) totalPages = 1;
                currentPage = data.page != null ? data.page : 1;

                var currentPageEl = el('activityCurrentPage');
                var totalPagesEl = el('activityTotalPages');
                if (currentPageEl) currentPageEl.textContent = currentPage;
                if (totalPagesEl) totalPagesEl.textContent = totalPages;

                var prevBtn = el('activityPrevPage');
                var nextBtn = el('activityNextPage');
                if (prevBtn) prevBtn.disabled = currentPage <= 1;
                if (nextBtn) nextBtn.disabled = currentPage >= totalPages;

                var tbodyId = 'activity' + currentView.charAt(0).toUpperCase() + currentView.slice(1) + 'TableBody';
                var tbody = el(tbodyId);
                if (tbody) {
                    tbody.innerHTML = '';
                    if (items.length === 0) {
                        showEmptyState(true, 'No items found', 'Items will appear here when available.');
                    } else {
                        items.forEach(function(item) {
                            var row = createRow(item);
                            if (row) tbody.appendChild(row);
                        });
                    }
                }
                var selectAllCb = el('activityQueueSelectAll');
                if (selectAllCb) selectAllCb.checked = false;
            })
            .catch(function() {
                showEmptyState(true, 'Unable to load', 'Check connection and try again.');
            })
            .finally(function() {
                isLoading = false;
                showLoading(false);
            });
    }

    function escapeAttr(s) {
        if (s == null) return '';
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function formatScoringCell(scoring) {
        if (scoring == null || scoring === '') return escapeHtml('-');
        var s = String(scoring).trim();
        if (s === '') return escapeHtml('-');
        var paren = s.indexOf(' (');
        if (paren > 0) {
            var main = s.substring(0, paren).trim();
            var breakdown = s.substring(paren + 2).replace(/\)\s*$/, '').trim();
            return '<span class="activity-scoring-value" title="' + escapeAttr(breakdown) + '">' + escapeHtml(main) + '</span>';
        }
        return escapeHtml(s);
    }

    function createRow(item) {
        var tr = document.createElement('tr');
        if (currentView === 'queue') {
            var canSelect = item.id != null && item.id !== '';
            var cb = canSelect
                ? '<td class="col-select"><input type="checkbox" class="activity-queue-row-cb" data-id="' + escapeHtml(String(item.id)) + '" data-instance="' + escapeHtml(item.instance_name || 'Default') + '"></td>'
                : '<td class="col-select"></td>';
            var originalRelease = item.original_release || item.movie || '';
            var tooltip = originalRelease ? ('Original release: ' + escapeAttr(originalRelease)) : '';
            var movieText = escapeHtml(item.movie || item.title || '-');
            var movieCell = tooltip
                ? '<td class="col-movie"><span class="activity-queue-movie-title" title="' + tooltip + '">' + movieText + '</span></td>'
                : '<td class="col-movie">' + movieText + '</td>';
            tr.innerHTML = cb +
                movieCell +
                '<td class="col-languages">' + escapeHtml(item.languages || '-') + '</td>' +
                '<td class="col-quality">' + escapeHtml(item.quality || '-') + '</td>' +
                '<td class="col-formats">' + escapeHtml(item.formats || '-') + '</td>' +
                '<td class="col-scoring">' + formatScoringCell(item.scoring) + '</td>' +
                '<td class="col-time-left">' + escapeHtml(item.time_left != null ? item.time_left : '-') + '</td>' +
                '<td class="col-progress">' + escapeHtml((item.progress === '100%' ? 'Pending Import' : (item.progress != null ? item.progress : '-'))) + '</td>';
        } else if (currentView === 'history') {
            tr.innerHTML = '<td class="col-movie">' + escapeHtml(item.movie || item.title || '-') + '</td>' +
                '<td class="col-languages">' + escapeHtml(item.languages || '-') + '</td>' +
                '<td class="col-quality">' + escapeHtml(item.quality || '-') + '</td>' +
                '<td class="col-formats">' + escapeHtml(item.formats || '-') + '</td>' +
                '<td class="col-date">' + escapeHtml(item.date || '-') + '</td>';
        } else if (currentView === 'blocklist') {
            var movieText = escapeHtml(item.movie || item.movie_title || '-');
            var sourceTitle = (item.source_title || '').trim() || '-';
            var reasonFailed = (item.reason_failed || '').trim() || 'Download failed';
            var dateText = escapeHtml(item.date || '-');
            var sourceTitleEsc = escapeAttr(sourceTitle);
            var reasonEsc = escapeAttr(reasonFailed);
            tr.innerHTML =
                '<td class="col-movie">' + movieText + '</td>' +
                '<td class="col-source">' + escapeHtml(sourceTitle) + '</td>' +
                '<td class="col-reason">' + escapeHtml(reasonFailed) + '</td>' +
                '<td class="col-date">' + dateText + '</td>' +
                '<td class="col-actions">' +
                '<button type="button" class="activity-blocklist-btn-info" title="Details" data-source-title="' + sourceTitleEsc + '" data-reason="' + reasonEsc + '" data-date="' + escapeAttr(item.date || '') + '" data-movie="' + escapeAttr(item.movie || '') + '" aria-label="Details"><i class="fas fa-info-circle"></i></button>' +
                '<button type="button" class="activity-blocklist-btn-remove" title="Remove from blocklist" data-source-title="' + sourceTitleEsc + '" aria-label="Remove from blocklist"><i class="fas fa-times" style="color: #ef4444;"></i></button>' +
                '</td>';
            var infoBtn = tr.querySelector('.activity-blocklist-btn-info');
            var removeBtn = tr.querySelector('.activity-blocklist-btn-remove');
            if (infoBtn) infoBtn.addEventListener('click', function() { showBlocklistDetailsModal(this); });
            if (removeBtn) removeBtn.addEventListener('click', function() { removeBlocklistEntry(this.getAttribute('data-source-title')); });
        } else {
            tr.innerHTML = '<td class="col-movie">' + escapeHtml(item.movie || item.title || '-') + '</td>' +
                '<td class="col-source">' + escapeHtml(item.source_title || '-') + '</td>' +
                '<td class="col-languages">' + escapeHtml(item.languages || '-') + '</td>' +
                '<td class="col-quality">' + escapeHtml(item.quality || '-') + '</td>' +
                '<td class="col-formats">' + escapeHtml(item.formats || '-') + '</td>' +
                '<td class="col-date">' + escapeHtml(item.date || '-') + '</td>';
        }
        return tr;
    }

    function escapeHtml(s) {
        if (s == null) return '';
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function showBlocklistDetailsModal(btn) {
        var modal = el('activityBlocklistDetailsModal');
        if (!modal) return;
        var nameEl = el('activityBlocklistModalName');
        var reasonEl = el('activityBlocklistModalReason');
        var dateEl = el('activityBlocklistModalDate');
        if (nameEl) nameEl.textContent = (btn.getAttribute('data-source-title') || '').trim() || '-';
        if (reasonEl) reasonEl.textContent = (btn.getAttribute('data-reason') || '').trim() || 'Download failed';
        if (dateEl) dateEl.textContent = (btn.getAttribute('data-date') || '').trim() || '-';
        modal.style.display = 'flex';
    }

    function closeBlocklistDetailsModal() {
        var modal = el('activityBlocklistDetailsModal');
        if (modal) modal.style.display = 'none';
    }

    function removeBlocklistEntry(sourceTitle) {
        if (!sourceTitle || !sourceTitle.trim()) return;
        var msg = 'Remove this release from the blocklist? It may be selected again when requesting.';
        var doRemove = function() {
            fetch('./api/activity/blocklist', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ source_title: sourceTitle })
            })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.success !== false) {
                        loadData();
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification('Removed from blocklist.', 'success');
                        }
                    } else if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification(data.error || 'Failed to remove.', 'error');
                    }
                })
                .catch(function() {
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification('Failed to remove from blocklist.', 'error');
                    }
                });
        };
        if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
            window.HuntarrConfirm.show({ title: 'Remove from Blocklist', message: msg, confirmLabel: 'Remove', onConfirm: doRemove });
        } else {
            if (!window.confirm(msg)) return;
            doRemove();
        }
    }

    function performSearch() {
        var input = el('activitySearchInput');
        searchQuery = input ? input.value.trim() : '';
        currentPage = 1;
        loadData();
    }

    function refreshData() {
        currentPage = 1;
        loadData();
        if (window.huntarrUI && window.huntarrUI.showNotification) {
            window.huntarrUI.showNotification('Data refreshed.', 'success');
        }
    }

    function removeSelected() {
        var checkboxes = document.querySelectorAll('#activityQueueTableBody .activity-queue-row-cb:checked');
        if (!checkboxes || checkboxes.length === 0) {
            if (window.huntarrUI && window.huntarrUI.showNotification) {
                window.huntarrUI.showNotification('No items selected.', 'warning');
            }
            return;
        }
        var items = [];
        for (var i = 0; i < checkboxes.length; i++) {
            var cb = checkboxes[i];
            items.push({ id: cb.getAttribute('data-id'), instance_name: cb.getAttribute('data-instance') || 'Default' });
        }
        fetch('./api/activity/queue', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: items })
        })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (data.success !== false) {
                    loadData();
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification('Selected items removed from queue.', 'success');
                    }
                } else if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification(data.error || 'Failed to remove.', 'error');
                }
            })
            .catch(function() {
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('Failed to remove selected.', 'error');
                }
            });
    }

    function init(view) {
        currentView = view || 'queue';
        currentPage = 1;
        totalPages = 1;
        searchQuery = '';
        var input = el('activitySearchInput');
        if (input) input.value = '';
        var pageSizeEl = el('activityPageSize');
        if (pageSizeEl) pageSize = parseInt(pageSizeEl.value, 10) || 20;

        var queueNav = el('movieHuntActivityQueueNav');
        var historyNav = el('movieHuntActivityHistoryNav');
        var blocklistNav = el('movieHuntActivityBlocklistNav');
        var logsNav = el('movieHuntActivityLogsNav');
        if (queueNav) queueNav.classList.toggle('active', currentView === 'queue');
        if (historyNav) historyNav.classList.toggle('active', currentView === 'history');
        if (blocklistNav) blocklistNav.classList.toggle('active', currentView === 'blocklist');
        if (logsNav) logsNav.classList.toggle('active', currentView === 'logs');

        switchView(currentView);

        if (window.MovieHuntInstanceDropdown && window.MovieHuntInstanceDropdown.attach) {
            var activitySelect = el('activity-instance-select');
            if (activitySelect) {
                window.MovieHuntInstanceDropdown.attach('activity-instance-select', function() {
                    currentPage = 1;
                    loadData();
                });
            }
        }

        var searchBtn = el('activitySearchButton');
        if (searchBtn) searchBtn.onclick = performSearch;
        if (input) input.onkeypress = function(e) { if (e.key === 'Enter') performSearch(); };
        var refreshBtn = el('activityRefreshButton');
        if (refreshBtn) refreshBtn.onclick = refreshData;
        var removeSelectedBtn = el('activityRemoveSelectedButton');
        if (removeSelectedBtn) {
            removeSelectedBtn.onclick = removeSelected;
            removeSelectedBtn.style.display = currentView === 'queue' ? '' : 'none';
        }
        var selectAllCb = el('activityQueueSelectAll');
        if (selectAllCb) {
            selectAllCb.checked = false;
            selectAllCb.onclick = function() {
                var rowCbs = document.querySelectorAll('#activityQueueTableBody .activity-queue-row-cb');
                for (var i = 0; i < rowCbs.length; i++) rowCbs[i].checked = selectAllCb.checked;
            };
        }
        var blocklistModal = el('activityBlocklistDetailsModal');
        if (blocklistModal) {
            var closeBtns = blocklistModal.querySelectorAll('.activity-blocklist-modal-close, .activity-blocklist-modal-close-btn');
            for (var i = 0; i < closeBtns.length; i++) closeBtns[i].addEventListener('click', closeBlocklistDetailsModal);
            blocklistModal.addEventListener('click', function(e) { if (e.target === blocklistModal) closeBlocklistDetailsModal(); });
        }
        var prevBtn = el('activityPrevPage');
        var nextBtn = el('activityNextPage');
        if (prevBtn) prevBtn.onclick = function() { if (currentPage > 1) { currentPage--; loadData(); } };
        if (nextBtn) nextBtn.onclick = function() { if (currentPage < totalPages) { currentPage++; loadData(); } };
        if (pageSizeEl) pageSizeEl.onchange = function() { pageSize = parseInt(pageSizeEl.value, 10); currentPage = 1; loadData(); };

        // Movie Hunt Logs view bindings
        var logLevelSelect = el('activityLogLevelSelect');
        var logSearchInput = el('activityLogSearchInput');
        var logSearchBtn = el('activityLogSearchButton');
        var logClearBtn = el('activityLogClearButton');
        var logPrevBtn = el('activityLogPrevPage');
        var logNextBtn = el('activityLogNextPage');
        var logPageSizeEl = el('activityLogPageSize');
        if (logLevelSelect) {
            logLevel = logLevelSelect.value || 'info';
            logLevelSelect.onchange = function() { logLevel = logLevelSelect.value; logPage = 1; loadMovieHuntLogs(); };
        }
        if (logSearchInput) logSearchInput.value = logSearch;
        if (logSearchBtn) logSearchBtn.onclick = function() { logSearch = (logSearchInput && logSearchInput.value) ? logSearchInput.value.trim() : ''; logPage = 1; loadMovieHuntLogs(); };
        if (logSearchInput) logSearchInput.onkeypress = function(e) { if (e.key === 'Enter') { logSearch = logSearchInput.value.trim(); logPage = 1; loadMovieHuntLogs(); } };
        if (logClearBtn) logClearBtn.onclick = clearMovieHuntLogs;
        if (logPrevBtn) logPrevBtn.onclick = function() { if (logPage > 1) { logPage--; loadMovieHuntLogs(); } };
        if (logNextBtn) logNextBtn.onclick = function() { if (logPage < logTotalPages) { logPage++; loadMovieHuntLogs(); } };
        if (logPageSizeEl) {
            logPageSize = parseInt(logPageSizeEl.value, 10) || 20;
            logPageSizeEl.onchange = function() { logPageSize = parseInt(logPageSizeEl.value, 10) || 20; logPage = 1; loadMovieHuntLogs(); };
        }
    }

    function refresh() {
        if (currentView === 'logs') {
            loadMovieHuntLogs();
        } else {
            loadData();
        }
    }

    window.ActivityModule = {
        init: init,
        switchView: switchView,
        refresh: refresh
    };
})();

/**
 * Media Hunt Activity – Part 2: TV Hunt (Queue, History, Blocklist).
 * Exposes window.TVHuntActivityModule. Uses tvHuntActivity* DOM IDs and /api/tv-hunt/.
 */
(function() {
    'use strict';

    var currentView = 'queue';
    var currentPage = 1;
    var totalPages = 1;
    var pageSize = 20;
    var searchQuery = '';
    var isLoading = false;

    function el(id) { return document.getElementById(id); }

    function getInstanceId() {
        var select = el('tv-hunt-activity-instance-select');
        if (!select || !select.value) return null;
        var n = parseInt(select.value, 10);
        return isNaN(n) ? null : n;
    }

    function showLoading(show) {
        var loading = el('tvHuntActivityLoading');
        if (loading) loading.style.display = show ? 'block' : 'none';
    }

    function showEmptyState(show, title, message) {
        var empty = el('tvHuntActivityEmptyState');
        var titleEl = el('tvHuntActivityEmptyTitle');
        var msgEl = el('tvHuntActivityEmptyMessage');
        if (empty) empty.style.display = show ? 'block' : 'none';
        if (titleEl && title) titleEl.textContent = title;
        if (msgEl && message) msgEl.textContent = message;
    }

    function hideAllViews() {
        ['tvHuntActivityQueueView', 'tvHuntActivityHistoryView', 'tvHuntActivityBlocklistView'].forEach(function(id) {
            var v = el(id);
            if (v) v.style.display = 'none';
        });
    }

    function switchView(view) {
        currentView = view;
        hideAllViews();
        var viewId = 'tvHuntActivity' + view.charAt(0).toUpperCase() + view.slice(1) + 'View';
        var viewEl = el(viewId);
        if (viewEl) viewEl.style.display = 'block';
        var removeBtn = el('tvHuntActivityRemoveSelectedButton');
        if (removeBtn) removeBtn.style.display = view === 'queue' ? '' : 'none';
        var toolbar = el('tvHuntActivityQueueToolbar');
        if (toolbar) toolbar.style.display = 'flex';
        currentPage = 1;
        loadData();
    }

    function escapeAttr(s) {
        if (s == null) return '';
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function escapeHtml(s) {
        if (s == null) return '';
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function loadData() {
        if (isLoading) return;
        var instanceId = getInstanceId();
        if (instanceId == null) {
            showEmptyState(true, 'Select an instance', 'Choose a TV Hunt instance to view queue, history, or blocklist.');
            return;
        }
        isLoading = true;
        showLoading(true);
        showEmptyState(false);

        var params = new URLSearchParams({ instance_id: String(instanceId) });
        if (searchQuery) params.append('search', searchQuery);
        params.append('_t', Date.now());

        var endpoint = currentView === 'queue' ? 'queue' : currentView === 'history' ? 'history' : 'blocklist';
        var url = './api/tv-hunt/' + endpoint + '?' + params.toString();

        fetch(url, { cache: 'no-store' })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var items = [];
                var total = 0;
                if (currentView === 'queue') {
                    items = data.queue || [];
                    total = items.length;
                } else if (currentView === 'history') {
                    items = data.history || [];
                    total = items.length;
                } else {
                    items = data.items || [];
                    total = items.length;
                }

                if (searchQuery) {
                    var q = searchQuery.toLowerCase();
                    items = items.filter(function(item) {
                        var title = (item.show || item.series || item.movie || item.title || item.source_title || '').toString().toLowerCase();
                        return title.indexOf(q) >= 0;
                    });
                    total = items.length;
                }

                totalPages = pageSize > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1;
                var start = (currentPage - 1) * pageSize;
                var paged = items.slice(start, start + pageSize);

                var currentPageEl = el('tvHuntActivityCurrentPage');
                var totalPagesEl = el('tvHuntActivityTotalPages');
                if (currentPageEl) currentPageEl.textContent = currentPage;
                if (totalPagesEl) totalPagesEl.textContent = totalPages;

                var prevBtn = el('tvHuntActivityPrevPage');
                var nextBtn = el('tvHuntActivityNextPage');
                if (prevBtn) prevBtn.disabled = currentPage <= 1;
                if (nextBtn) nextBtn.disabled = currentPage >= totalPages;

                var tbodyId = 'tvHuntActivity' + (currentView === 'queue' ? 'Queue' : currentView === 'history' ? 'History' : 'Blocklist') + 'TableBody';
                var tbody = el(tbodyId);
                if (tbody) {
                    tbody.innerHTML = '';
                    if (paged.length === 0) {
                        showEmptyState(true, 'No items found', 'Items will appear here when available.');
                    } else {
                        paged.forEach(function(item) {
                            var row = createRow(item);
                            if (row) tbody.appendChild(row);
                        });
                    }
                }
                var selectAllCb = el('tvHuntActivityQueueSelectAll');
                if (selectAllCb) selectAllCb.checked = false;
            })
            .catch(function() {
                showEmptyState(true, 'Unable to load', 'Check connection and try again.');
            })
            .finally(function() {
                isLoading = false;
                showLoading(false);
            });
    }

    function createRow(item) {
        var tr = document.createElement('tr');
        if (currentView === 'queue') {
            var canSelect = item.id != null && item.id !== '';
            var cb = canSelect
                ? '<td class="col-select"><input type="checkbox" class="tv-hunt-activity-queue-row-cb" data-id="' + escapeHtml(String(item.id)) + '"></td>'
                : '<td class="col-select"></td>';
            var showText = escapeHtml(item.show || item.series || item.title || '-');
            tr.innerHTML = cb +
                '<td class="col-show">' + showText + '</td>' +
                '<td class="col-languages">' + escapeHtml(item.languages || '-') + '</td>' +
                '<td class="col-quality">' + escapeHtml(item.quality || '-') + '</td>' +
                '<td class="col-formats">' + escapeHtml(item.formats || '-') + '</td>' +
                '<td class="col-scoring">' + escapeHtml(item.scoring != null ? item.scoring : '-') + '</td>' +
                '<td class="col-time-left">' + escapeHtml(item.time_left != null ? item.time_left : '-') + '</td>' +
                '<td class="col-progress">' + escapeHtml(item.progress != null ? item.progress : '-') + '</td>';
        } else if (currentView === 'history') {
            tr.innerHTML = '<td class="col-show">' + escapeHtml(item.show || item.series || item.title || '-') + '</td>' +
                '<td class="col-languages">' + escapeHtml(item.languages || '-') + '</td>' +
                '<td class="col-quality">' + escapeHtml(item.quality || '-') + '</td>' +
                '<td class="col-formats">' + escapeHtml(item.formats || '-') + '</td>' +
                '<td class="col-date">' + escapeHtml(item.date || item.added_at || '-') + '</td>';
        } else {
            var id = (item.id || '').toString();
            var sourceTitle = (item.source_title || '').trim() || '-';
            var dateText = escapeHtml(item.added_at || item.date || '-');
            var sourceTitleEsc = escapeAttr(sourceTitle);
            tr.innerHTML =
                '<td class="col-source">' + escapeHtml(sourceTitle) + '</td>' +
                '<td class="col-date">' + dateText + '</td>' +
                '<td class="col-actions">' +
                '<button type="button" class="tv-hunt-activity-blocklist-btn-info" title="Details" data-source-title="' + sourceTitleEsc + '" data-date="' + escapeAttr(item.added_at || '') + '" aria-label="Details"><i class="fas fa-info-circle"></i></button>' +
                '<button type="button" class="tv-hunt-activity-blocklist-btn-remove" title="Remove from blocklist" data-id="' + escapeAttr(id) + '" aria-label="Remove from blocklist"><i class="fas fa-times" style="color: #ef4444;"></i></button>' +
                '</td>';
            var infoBtn = tr.querySelector('.tv-hunt-activity-blocklist-btn-info');
            var removeBtn = tr.querySelector('.tv-hunt-activity-blocklist-btn-remove');
            if (infoBtn) infoBtn.addEventListener('click', function() { showBlocklistDetailsModal(this); });
            if (removeBtn) removeBtn.addEventListener('click', function() { removeBlocklistEntry(this.getAttribute('data-id')); });
        }
        return tr;
    }

    function showBlocklistDetailsModal(btn) {
        var modal = el('tvHuntActivityBlocklistDetailsModal');
        if (!modal) return;
        var titleEl = el('tvHuntActivityBlocklistModalSourceTitle');
        var dateEl = el('tvHuntActivityBlocklistModalDate');
        if (titleEl) titleEl.textContent = (btn.getAttribute('data-source-title') || '').trim() || '-';
        if (dateEl) dateEl.textContent = (btn.getAttribute('data-date') || '').trim() || '-';
        modal.style.display = 'flex';
    }

    function closeBlocklistDetailsModal() {
        var modal = el('tvHuntActivityBlocklistDetailsModal');
        if (modal) modal.style.display = 'none';
    }

    function removeBlocklistEntry(itemId) {
        if (!itemId || !itemId.trim()) return;
        var instanceId = getInstanceId();
        if (instanceId == null) {
            if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Select an instance first.', 'warning');
            return;
        }
        var msg = 'Remove this from the TV Hunt blocklist?';
        var doRemove = function() {
            var params = new URLSearchParams({ instance_id: String(instanceId) });
            fetch('./api/tv-hunt/blocklist/' + encodeURIComponent(itemId) + '?' + params.toString(), { method: 'DELETE' })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.success !== false) {
                        loadData();
                        if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Removed from blocklist.', 'success');
                    } else if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification(data.error || 'Failed to remove.', 'error');
                    }
                })
                .catch(function() {
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification('Failed to remove from blocklist.', 'error');
                    }
                });
        };
        if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
            window.HuntarrConfirm.show({ title: 'Remove from Blocklist', message: msg, confirmLabel: 'Remove', onConfirm: doRemove });
        } else {
            if (!window.confirm(msg)) return;
            doRemove();
        }
    }

    function performSearch() {
        var input = el('tvHuntActivitySearchInput');
        searchQuery = input ? input.value.trim() : '';
        currentPage = 1;
        loadData();
    }

    function refreshData() {
        currentPage = 1;
        loadData();
        if (window.huntarrUI && window.huntarrUI.showNotification) {
            window.huntarrUI.showNotification('Data refreshed.', 'success');
        }
    }

    function removeSelected() {
        var checkboxes = document.querySelectorAll('#tvHuntActivityQueueTableBody .tv-hunt-activity-queue-row-cb:checked');
        if (!checkboxes || checkboxes.length === 0) {
            if (window.huntarrUI && window.huntarrUI.showNotification) {
                window.huntarrUI.showNotification('No items selected.', 'warning');
            }
            return;
        }
        if (window.huntarrUI && window.huntarrUI.showNotification) {
            window.huntarrUI.showNotification('Bulk remove from queue is not yet implemented for TV Hunt.', 'info');
        }
    }

    function init(view) {
        currentView = view || 'queue';
        currentPage = 1;
        totalPages = 1;
        searchQuery = '';
        var input = el('tvHuntActivitySearchInput');
        if (input) input.value = '';
        var pageSizeEl = el('tvHuntActivityPageSize');
        if (pageSizeEl) pageSize = parseInt(pageSizeEl.value, 10) || 20;

        var queueNav = el('tvHuntActivityQueueNav');
        var historyNav = el('tvHuntActivityHistoryNav');
        var blocklistNav = el('tvHuntActivityBlocklistNav');
        if (queueNav) queueNav.classList.toggle('active', currentView === 'queue');
        if (historyNav) historyNav.classList.toggle('active', currentView === 'history');
        if (blocklistNav) blocklistNav.classList.toggle('active', currentView === 'blocklist');

        switchView(currentView);

        if (window.TVHuntInstanceDropdown && window.TVHuntInstanceDropdown.attach) {
            var activitySelect = el('tv-hunt-activity-instance-select');
            if (activitySelect) {
                window.TVHuntInstanceDropdown.attach('tv-hunt-activity-instance-select', function() {
                    currentPage = 1;
                    loadData();
                });
            }
        }

        var searchBtn = el('tvHuntActivitySearchButton');
        if (searchBtn) searchBtn.onclick = performSearch;
        if (input) input.onkeypress = function(e) { if (e.key === 'Enter') performSearch(); };
        var refreshBtn = el('tvHuntActivityRefreshButton');
        if (refreshBtn) refreshBtn.onclick = refreshData;
        var removeSelectedBtn = el('tvHuntActivityRemoveSelectedButton');
        if (removeSelectedBtn) {
            removeSelectedBtn.onclick = removeSelected;
            removeSelectedBtn.style.display = currentView === 'queue' ? '' : 'none';
        }
        var selectAllCb = el('tvHuntActivityQueueSelectAll');
        if (selectAllCb) {
            selectAllCb.checked = false;
            selectAllCb.onclick = function() {
                var rowCbs = document.querySelectorAll('#tvHuntActivityQueueTableBody .tv-hunt-activity-queue-row-cb');
                for (var i = 0; i < rowCbs.length; i++) rowCbs[i].checked = selectAllCb.checked;
            };
        }
        var blocklistModal = el('tvHuntActivityBlocklistDetailsModal');
        if (blocklistModal) {
            var closeBtns = blocklistModal.querySelectorAll('.tv-hunt-activity-blocklist-modal-close, .activity-blocklist-modal-close-btn');
            for (var i = 0; i < closeBtns.length; i++) closeBtns[i].addEventListener('click', closeBlocklistDetailsModal);
            blocklistModal.addEventListener('click', function(e) { if (e.target === blocklistModal) closeBlocklistDetailsModal(); });
        }
        var prevBtn = el('tvHuntActivityPrevPage');
        var nextBtn = el('tvHuntActivityNextPage');
        if (prevBtn) prevBtn.onclick = function() { if (currentPage > 1) { currentPage--; loadData(); } };
        if (nextBtn) nextBtn.onclick = function() { if (currentPage < totalPages) { currentPage++; loadData(); } };
        if (pageSizeEl) pageSizeEl.onchange = function() { pageSize = parseInt(pageSizeEl.value, 10); currentPage = 1; loadData(); };
    }

    window.TVHuntActivityModule = {
        init: init,
        switchView: switchView,
        refresh: function() { loadData(); }
    };
})();


/* === modules/features/media-hunt-card-delete-modal.js === */
/**
 * Media Hunt Card Delete Modal – shared delete/remove modal for movie cards.
 * Used by: requestarr-content.js, media-hunt.js, media-hunt-collection.js,
 *          media-hunt-detail.js, requestarr-detail.js
 * Exposed as window.MovieCardDeleteModal for compatibility.
 *
 * Opens a modal with options:
 *   - Remove from Library (always, checked by default)
 *   - Delete Movie Files (only if hasFile, unchecked by default)
 *   - Add to Hidden Media (always last, unchecked by default)
 *
 * Checkbox states are persisted server-side in general_settings.
 */
(function() {
    'use strict';

    var _prefsLoaded = false;
    var _prefs = { remove_from_library: true, delete_files: false, add_to_hidden: false };

    function escapeHtml(str) {
        return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function loadPrefs() {
        if (_prefsLoaded) return Promise.resolve(_prefs);
        return fetch('./api/settings')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var general = data.general || data;
                var raw = general.movie_hunt_delete_prefs;
                if (raw) {
                    try {
                        var parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
                        if (parsed.remove_from_library !== undefined) _prefs.remove_from_library = !!parsed.remove_from_library;
                        if (parsed.delete_files !== undefined) _prefs.delete_files = !!parsed.delete_files;
                        if (parsed.add_to_hidden !== undefined) _prefs.add_to_hidden = !!parsed.add_to_hidden;
                    } catch (e) { /* use defaults */ }
                }
                _prefsLoaded = true;
                return _prefs;
            })
            .catch(function() {
                _prefsLoaded = true;
                return _prefs;
            });
    }

    function savePrefs(prefs) {
        var payload = { movie_hunt_delete_prefs: JSON.stringify(prefs) };
        fetch('./api/settings/general', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }).catch(function(e) {
            console.warn('[MovieCardDeleteModal] Failed to save prefs:', e);
        });
    }

    /**
     * Open the delete modal.
     * @param {Object} item - Movie data (title, year, tmdb_id, poster_path, status, etc.)
     * @param {Object} options
     *   - instanceName {string} - Movie Hunt instance display name
     *   - instanceId {string|number} - Instance ID for API calls
     *   - status {string} - 'available' or 'requested'
     *   - hasFile {boolean} - Whether movie files exist on disk
     *   - filePath {string} - Display path for the movie file/folder
     *   - onDeleted {function} - Callback after successful deletion
     *   - appType {string} - 'movie_hunt' or 'radarr' (default: 'movie_hunt')
     */
    function open(item, options) {
        options = options || {};
        var title = escapeHtml(item.title || 'Unknown');
        var year = item.year || '';
        var status = (options.status || item.status || 'requested').toLowerCase();
        var hasFile = !!(options.hasFile || (status === 'available'));
        var filePath = options.filePath || '';
        var folderDisplay = filePath ? escapeHtml(filePath) : escapeHtml(item.title + (year ? ' (' + year + ')' : ''));
        var appType = options.appType || 'movie_hunt';

        loadPrefs().then(function(prefs) {
            buildModal(item, options, title, status, hasFile, folderDisplay, prefs, appType);
        });
    }

    function buildModal(item, options, title, status, hasFile, folderDisplay, prefs, appType) {
        // Remove existing modal
        var existing = document.getElementById('mh-card-delete-modal');
        if (existing) existing.remove();

        var removeChecked = prefs.remove_from_library ? ' checked' : '';
        var deleteFilesChecked = prefs.delete_files ? ' checked' : '';
        var hiddenChecked = prefs.add_to_hidden ? ' checked' : '';

        var html =
            '<div class="mh-modal-backdrop" id="mh-card-delete-modal">' +
                '<div class="mh-modal">' +
                    '<div class="mh-modal-header mh-modal-header-danger">' +
                        '<h3><i class="fas fa-trash-alt"></i> Delete \u2014 ' + title + '</h3>' +
                        '<button class="mh-modal-x" id="mh-cdm-close">&times;</button>' +
                    '</div>' +
                    '<div class="mh-modal-body">' +
                        '<div class="mh-delete-path" title="' + folderDisplay + '">' +
                            '<i class="fas fa-folder"></i> <span class="mh-delete-path-text">' + folderDisplay + '</span>' +
                        '</div>' +

                        // Option 1: Remove from Library (always shown)
                        '<label class="mh-check-row">' +
                            '<input type="checkbox" id="mh-cdm-remove"' + removeChecked + '>' +
                            '<div><strong>Remove from Library</strong>' +
                            '<div class="mh-help">Remove this movie from your Movie Hunt collection</div></div>' +
                        '</label>' +

                        // Option 2: Delete Movie Files (only for available items)
                        (hasFile ? (
                            '<label class="mh-check-row">' +
                                '<input type="checkbox" id="mh-cdm-delete-files"' + deleteFilesChecked + '>' +
                                '<div><strong>Delete Movie Files</strong>' +
                                '<div class="mh-help">Delete the movie files and movie folder from disk</div></div>' +
                            '</label>'
                        ) : '') +

                        // Option 3: Add to Hidden Media (always last)
                        '<label class="mh-check-row">' +
                            '<input type="checkbox" id="mh-cdm-hidden"' + hiddenChecked + '>' +
                            '<div><strong>Add to Hidden Media</strong>' +
                            '<div class="mh-help">Hide from discovery pages so it won\'t be re-suggested</div></div>' +
                        '</label>' +

                    '</div>' +
                    '<div class="mh-modal-footer">' +
                        '<button class="mh-btn mh-btn-secondary" id="mh-cdm-cancel">Close</button>' +
                        '<button class="mh-btn mh-btn-danger" id="mh-cdm-confirm">Delete</button>' +
                    '</div>' +
                '</div>' +
            '</div>';

        document.body.insertAdjacentHTML('beforeend', html);

        // Wire close handlers
        var closeModal = function() {
            var el = document.getElementById('mh-card-delete-modal');
            if (el) el.remove();
        };
        document.getElementById('mh-cdm-close').addEventListener('click', closeModal);
        document.getElementById('mh-cdm-cancel').addEventListener('click', closeModal);
        document.getElementById('mh-card-delete-modal').addEventListener('click', function(e) {
            if (e.target.id === 'mh-card-delete-modal') closeModal();
        });

        // Wire confirm
        document.getElementById('mh-cdm-confirm').addEventListener('click', function() {
            handleConfirm(item, options, hasFile, appType, closeModal);
        });
    }

    function handleConfirm(item, options, hasFile, appType, closeModal) {
        var removeFromLib = document.getElementById('mh-cdm-remove')
            ? document.getElementById('mh-cdm-remove').checked : true;
        var deleteFiles = document.getElementById('mh-cdm-delete-files')
            ? document.getElementById('mh-cdm-delete-files').checked : false;
        var addToHidden = document.getElementById('mh-cdm-hidden')
            ? document.getElementById('mh-cdm-hidden').checked : false;

        // Save prefs
        var newPrefs = {
            remove_from_library: removeFromLib,
            delete_files: deleteFiles,
            add_to_hidden: addToHidden
        };
        _prefs = newPrefs;
        savePrefs(newPrefs);

        var delBtn = document.getElementById('mh-cdm-confirm');
        if (delBtn) { delBtn.disabled = true; delBtn.textContent = 'Deleting...'; }

        var tmdbId = item.tmdb_id || item.id;
        var instanceId = options.instanceId || '';
        var instanceName = options.instanceName || '';
        var promises = [];

        // 1. Remove from library
        if (removeFromLib) {
            var removePromise = fetch('./api/movie-hunt/collection/remove?instance_id=' + encodeURIComponent(instanceId), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tmdb_id: tmdbId,
                    title: item.title || '',
                    year: String(item.year || ''),
                    add_to_blocklist: false,
                    delete_files: deleteFiles
                })
            }).then(function(r) { return r.json(); });
            promises.push(removePromise);
        }

        // 2. Add to hidden media
        if (addToHidden && tmdbId && instanceName) {
            var hidePromise = fetch('./api/requestarr/hidden-media', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tmdb_id: tmdbId,
                    media_type: 'movie',
                    title: item.title || '',
                    poster_path: item.poster_path || null,
                    app_type: appType,
                    instance_name: instanceName
                })
            }).then(function(r) { return r.json(); });
            promises.push(hidePromise);
        }

        if (promises.length === 0) {
            // Nothing selected, just close
            closeModal();
            return;
        }

        Promise.all(promises)
            .then(function() {
                closeModal();
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('"' + (item.title || 'Movie') + '" removed.', 'success');
                }
                if (typeof options.onDeleted === 'function') {
                    options.onDeleted();
                }
            })
            .catch(function(err) {
                console.error('[MovieCardDeleteModal] Error:', err);
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('Delete failed: ' + (err.message || 'Unknown error'), 'error');
                }
                if (delBtn) { delBtn.disabled = false; delBtn.textContent = 'Delete'; }
            });
    }

    window.MovieCardDeleteModal = { open: open };
})();


/* === modules/features/media-hunt-collection.js === */
/**
 * Movie Hunt Movie Collection - requested movies and status (requested / available).
 * Users go to Request Movies (#requestarr-movies) to add movies; this view lists the collection.
 */
(function() {
    'use strict';

    window.MovieHuntCollection = {
        _prefix: 'media-hunt-movie-collection',
        page: 1,
        pageSize: 9999, // Load all items (no pagination)
        total: 0,
        searchQuery: '',
        sortBy: 'title.asc',
        viewMode: 'posters', // posters, table, overview
        items: [],
        hiddenMediaSet: new Set(),

        getEl: function(suffix) {
            return document.getElementById((this._prefix || 'media-hunt-collection') + '-' + suffix);
        },

        init: function() {
            this.page = 1;
            this.viewMode = HuntarrUtils.getUIPreference(this._prefix + '-view', 'posters');
            this.setupInstanceSelect();
            this.setupSort();
            this.setupViewMode();
            this.setupSearch();
            if (window._mediaHuntCollectionUnified) return;
            this.loadHiddenMediaIds().then(function() {
                window.MovieHuntCollection.loadCollection();
            });
        },

        // ─── Hidden Media ─────────────────────────────────────────────
        loadHiddenMediaIds: function() {
            var self = this;
            return fetch('./api/requestarr/hidden-media?page=1&page_size=10000')
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    var items = Array.isArray(data) ? data : (Array.isArray(data.items) ? data.items : []);
                    self.hiddenMediaSet = new Set();
                    items.forEach(function(item) {
                        var key = item.tmdb_id + ':' + item.media_type + ':' + item.app_type + ':' + item.instance_name;
                        self.hiddenMediaSet.add(key);
                    });
                    console.log('[MovieHuntCollection] Loaded', self.hiddenMediaSet.size, 'hidden media items');
                })
                .catch(function(err) {
                    console.error('[MovieHuntCollection] Error loading hidden media IDs:', err);
                    self.hiddenMediaSet = new Set();
                });
        },

        isMediaHidden: function(tmdbId) {
            if (!this.hiddenMediaSet || this.hiddenMediaSet.size === 0) return false;
            var instanceName = this.getCurrentInstanceName();
            if (!instanceName) return false;
            var key = tmdbId + ':movie:movie_hunt:' + instanceName;
            return this.hiddenMediaSet.has(key);
        },

        getCurrentInstanceName: function() {
            var select = this.getEl('instance-select');
            if (!select) return '';
            var opt = select.options[select.selectedIndex];
            if (opt && opt.value && opt.value.indexOf('movie:') === 0)
                return opt.getAttribute('data-name') || (opt.textContent || '').replace(/^Movie\s*-\s*/, '').trim();
            return select.value || '';
        },
        getCurrentInstanceId: function() {
            var select = this.getEl('instance-select');
            if (!select) return '';
            var v = select.value || '';
            if (v.indexOf('movie:') === 0) return v.slice(6);
            return v;
        },

        hideMedia: function(tmdbId, title, posterPath, cardElement) {
            var self = this;
            var instanceName = self.getCurrentInstanceName();
            window.MediaUtils.hideMedia({
                tmdbId: tmdbId,
                mediaType: 'movie',
                title: title,
                posterPath: posterPath || null,
                appType: 'movie_hunt',
                instanceName: instanceName,
                cardElement: cardElement,
                hiddenMediaSet: self.hiddenMediaSet
            });
        },

        // ─── Search ───────────────────────────────────────────────────
        setupSearch: function() {
            var self = this;
            var input = this.getEl('search-input');
            if (!input) return;

            input.addEventListener('input', function() {
                if (window._mediaHuntCollectionUnified) {
                    var isel = self.getEl('instance-select');
                    if (isel && isel.value && isel.value.indexOf('movie:') !== 0) return;
                }
                if (self.searchTimeout) clearTimeout(self.searchTimeout);
                var query = (input.value || '').trim();

                if (!query) {
                    self.showMainView();
                    return;
                }

                self.searchTimeout = setTimeout(function() {
                    self.performSearch(query);
                }, 500);
            });
        },

        showMainView: function() {
            var resultsView = this.getEl('search-results-view');
            var mainContent = this.getEl('main-content');
            if (resultsView) resultsView.style.display = 'none';
            if (mainContent) mainContent.style.display = 'block';
        },

        showResultsView: function() {
            var resultsView = this.getEl('search-results-view');
            var mainContent = this.getEl('main-content');
            if (resultsView) resultsView.style.display = 'block';
            if (mainContent) mainContent.style.display = 'none';
        },

        performSearch: function(query) {
            var self = this;
            var grid = this.getEl('search-results-grid');
            if (!grid) return;

            self.showResultsView();
            grid.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Searching movies...</p></div>';

            // Use the currently selected Movie Hunt instance for library status check
            var instanceSelect = this.getEl('instance-select');
            var instanceName = instanceSelect ? instanceSelect.value : '';

            var url = './api/requestarr/search?q=' + encodeURIComponent(query) + '&app_type=movie_hunt&instance_name=' + encodeURIComponent(instanceName);
            
            fetch(url)
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    var results = data.results || [];
                    grid.innerHTML = '';

                    if (results.length === 0) {
                        grid.innerHTML = '<p style="color: #888; text-align: center; padding: 40px; width: 100%;">No movies found matching "' + query + '"</p>';
                        return;
                    }

                    results.forEach(function(item) {
                        var card = self.createSearchCard(item);
                        if (card) grid.appendChild(card);
                    });
                })
                .catch(function(err) {
                    console.error('[MovieHuntCollection] Search failed:', err);
                    grid.innerHTML = '<p style="color: #ef4444; text-align: center; padding: 40px; width: 100%;">Search failed. Please try again.</p>';
                });
        },

        createSearchCard: function(item) {
            var self = this;
            // Use Requestarr modal (Add to Library popup) - use instance NAME (not ID) for compound value
            var suggestedInstance = null;
            var instanceSelect = this.getEl('instance-select');
            if (instanceSelect && instanceSelect.value) {
                var opt = instanceSelect.options[instanceSelect.selectedIndex];
                var instanceName = opt ? (opt.textContent || '').trim() : '';
                if (instanceName) {
                    suggestedInstance = instanceSelect.value.indexOf('movie_hunt:') === 0
                        ? instanceSelect.value
                        : 'movie_hunt:' + instanceName;
                }
            }
            if (window.RequestarrDiscover && window.RequestarrDiscover.modal && window.RequestarrDiscover.content && typeof window.RequestarrDiscover.content.createMediaCard === 'function') {
                return window.RequestarrDiscover.content.createMediaCard(item, suggestedInstance);
            }
            if (window.HomeRequestarr && typeof window.HomeRequestarr.createMediaCard === 'function') {
                var card = window.HomeRequestarr.createMediaCard(item, suggestedInstance);
                if (card) return card;
            }

            // Fallback: open Requestarr modal on click (same popup as Requestarr)
            var card = document.createElement('div');
            card.className = 'media-card';
            var title = (item.title || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
            var year = item.year || 'N/A';
            var posterUrl = item.poster_path || './static/images/blackout.jpg';

            card.innerHTML = '<div class="media-card-poster">' +
                '<img src="' + posterUrl + '" alt="' + title + '" onerror="this.src=\'./static/images/blackout.jpg\'">' +
                '<div class="media-card-overlay">' +
                '<div class="media-card-overlay-title">' + title + '</div>' +
                '<div class="media-card-overlay-content">' +
                '<div class="media-card-overlay-year">' + year + '</div>' +
                '<button class="media-card-request-btn"><i class="fas fa-plus-circle"></i> Add to Library</button>' +
                '</div></div>' +
                '</div>' +
                '<div class="media-card-info">' +
                '<div class="media-card-title" title="' + title + '">' + title + '</div>' +
                '<div class="media-card-meta">' +
                '<span class="media-card-year">' + year + '</span>' +
                '</div></div>';

            card.onclick = function() {
                var tmdbId = item.tmdb_id || item.id;
                if (tmdbId && window.RequestarrDiscover && window.RequestarrDiscover.modal) {
                    window.RequestarrDiscover.modal.openModal(tmdbId, 'movie', suggestedInstance);
                } else if (window.MovieHuntDetail && window.MovieHuntDetail.openDetail) {
                    window.MovieHuntDetail.openDetail(item, { suggestedInstance: suggestedInstance });
                }
            };

            return card;
        },

        // ─── Instance / Sort / View Mode Setup ────────────────────────
        setupInstanceSelect: function() {
            if (window._mediaHuntCollectionUnified) return;
            var select = this.getEl('instance-select');
            if (!select) return;
            var id = (this._prefix || 'media-hunt-collection') + '-instance-select';
            if (window.MovieHuntInstanceDropdown && window.MovieHuntInstanceDropdown.attach) {
                window.MovieHuntInstanceDropdown.attach(id, function() {
                    window.MovieHuntCollection.page = 1;
                    // Reload hidden media for the new instance, then reload collection
                    window.MovieHuntCollection.loadHiddenMediaIds().then(function() {
                        window.MovieHuntCollection.loadCollection();
                    });
                });
            } else {
                select.innerHTML = '<option value="">No Movie Hunt instances</option>';
            }
        },

        setupSort: function() {
            var self = this;
            var select = this.getEl('sort');
            if (!select) return;
            if (window._mediaHuntCollectionUnified) {
                var isel = this.getEl('instance-select');
                if (isel && isel.value && isel.value.indexOf('movie:') !== 0) return;
            }
            var saved = HuntarrUtils.getUIPreference('movie-hunt-collection-sort', 'title.asc');
            if (saved) {
                self.sortBy = saved;
                try { select.value = saved; } catch (e) {}
            }
            select.onchange = function() {
                if (window._mediaHuntCollectionUnified) {
                    var isel = self.getEl('instance-select');
                    if (isel && isel.value && isel.value.indexOf('movie:') !== 0) return;
                }
                self.sortBy = (select.value || 'title.asc').trim();
                HuntarrUtils.setUIPreference('movie-hunt-collection-sort', self.sortBy);
                self.page = 1;
                self.loadCollection();
            };
        },

        setupViewMode: function() {
            var self = this;
            var select = this.getEl('view-mode');
            if (!select) return;
            select.value = this.viewMode;
            select.onchange = function() {
                if (window._mediaHuntCollectionUnified) {
                    var isel = self.getEl('instance-select');
                    if (isel && isel.value && isel.value.indexOf('movie:') !== 0) return;
                }
                self.viewMode = select.value;
                HuntarrUtils.setUIPreference(self._prefix + '-view', self.viewMode);
                self.renderPage();
            };
        },

        // ─── Data Loading & Rendering ─────────────────────────────────
        loadCollection: function() {
            var self = this;
            var grid = this.getEl('grid');
            if (!grid) return;
            grid.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Loading media collection...</p></div>';
            grid.style.display = 'flex';
            var instanceId = window._mediaHuntCollectionUnified ? this.getCurrentInstanceId() : (this.getEl('instance-select') && this.getEl('instance-select').value);
            var url = './api/movie-hunt/collection?page=' + this.page + '&page_size=' + this.pageSize + '&sort=' + encodeURIComponent(this.sortBy || 'title.asc');
            if (instanceId) url += '&instance_id=' + encodeURIComponent(instanceId);
            if (this.searchQuery) url += '&q=' + encodeURIComponent(this.searchQuery);
            fetch(url)
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    self.items = data.items || [];
                    self.total = data.total != null ? data.total : 0;
                    self.renderPage();
                })
                .catch(function() {
                    grid.innerHTML = '<p style="color: #ef4444; text-align: center; padding: 60px;">Failed to load collection.</p>';
                });
        },

        renderPage: function() {
            // Hide all views first
            var grid = this.getEl('grid');
            var table = this.getEl('table');
            var overview = this.getEl('overview');
            if (grid) grid.style.display = 'none';
            if (table) table.style.display = 'none';
            if (overview) overview.style.display = 'none';

            var instanceSelect = this.getEl('instance-select');
            var opt = instanceSelect && instanceSelect.options[instanceSelect.selectedIndex];
            var val = instanceSelect ? instanceSelect.value : '';
            var noInstances = !val || (opt && (opt.value === '' || (opt.textContent || '').trim().indexOf('No Movie Hunt') !== -1));

            if (noInstances) {
                if (grid) {
                    grid.style.display = 'flex';
                    grid.style.alignItems = 'center';
                    grid.style.justifyContent = 'center';
                    grid.innerHTML = '<div style="text-align: center; color: #9ca3af; max-width: 600px;">' +
                        '<i class="fas fa-cube" style="font-size: 64px; margin-bottom: 30px; opacity: 0.4; display: block;"></i>' +
                        '<p style="font-size: 20px; margin-bottom: 15px; font-weight: 500;">No Movie Hunt instance</p>' +
                        '<p style="font-size: 15px; line-height: 1.6; opacity: 0.8; margin-bottom: 20px;">Create a Movie Hunt instance to manage your media collection and requested movies.</p>' +
                        '<a href="./#media-hunt-settings" class="action-button" style="display: inline-flex; align-items: center; gap: 8px; background: rgba(99, 102, 241, 0.2); border: 1px solid rgba(99, 102, 241, 0.4); color: #818cf8; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 500; transition: all 0.2s ease;">' +
                        '<i class="fas fa-cog"></i> Set up Movie Hunt instance</a></div>';
                }
                return;
            }

            // Filter hidden items
            var visibleItems = [];
            for (var i = 0; i < this.items.length; i++) {
                var item = this.items[i];
                if (item.tmdb_id && this.isMediaHidden(item.tmdb_id)) continue;
                visibleItems.push(item);
            }

            if (visibleItems.length === 0) {
                if (grid) {
                    grid.style.display = 'flex';
                    grid.style.alignItems = 'center';
                    grid.style.justifyContent = 'center';
                    grid.innerHTML = '<div style="text-align: center; color: #9ca3af; max-width: 600px;">' +
                        '<i class="fas fa-inbox" style="font-size: 64px; margin-bottom: 30px; opacity: 0.4; display: block;"></i>' +
                        '<p style="font-size: 20px; margin-bottom: 15px; font-weight: 500;">No Requested Media</p>' +
                        '<p style="font-size: 15px; line-height: 1.6; opacity: 0.8;">Movies you request from Movie Home will appear here. Track status as Requested or Available.</p></div>';
                }
                return;
            }

            if (this.viewMode === 'table') {
                this.renderTable(visibleItems);
            } else if (this.viewMode === 'overview') {
                this.renderOverview(visibleItems);
            } else {
                this.renderPosters(visibleItems);
            }
        },

        renderPosters: function(items) {
            var grid = this.getEl('grid');
            if (!grid) return;
            grid.style.display = 'grid';
            grid.style.alignItems = '';
            grid.style.justifyContent = '';
            grid.innerHTML = '';
            var renderItems = items || this.items;
            for (var i = 0; i < renderItems.length; i++) {
                grid.appendChild(this.createCard(renderItems[i], i));
            }
        },

        renderTable: function(items) {
            var table = this.getEl('table');
            var tbody = this.getEl('table-body');
            if (!table || !tbody) return;
            table.style.display = 'block';
            tbody.innerHTML = '';
            var renderItems = items || this.items;
            for (var i = 0; i < renderItems.length; i++) {
                var item = renderItems[i];
                var tr = document.createElement('tr');
                var title = (item.title || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                var year = item.year || 'N/A';
                var status = (item.status || 'requested').toLowerCase();
                var statusLabel = status === 'available' ? 'Available' : 'Requested';
                var posterUrl = item.poster_path ? ('https://image.tmdb.org/t/p/w92' + item.poster_path) : './static/images/blackout.jpg';
                var qualityProfile = item.quality_profile || 'N/A';
                tr.innerHTML = '<td><img src="' + posterUrl + '" class="table-poster" onerror="this.src=\'./static/images/blackout.jpg\'"></td>' +
                    '<td class="table-title">' + title + '</td>' +
                    '<td>' + year + '</td>' +
                    '<td><span class="table-status ' + status + '">' + statusLabel + '</span></td>' +
                    '<td>' + qualityProfile + '</td>' +
                    '<td class="table-actions">' +
                    '<button class="table-action-btn" onclick="window.MovieHuntCollection.refreshItem(' + i + ')"><i class="fas fa-sync-alt"></i> Refresh</button>' +
                    '</td>';
                tbody.appendChild(tr);
            }
        },

        renderOverview: function(items) {
            var overview = this.getEl('overview');
            var list = this.getEl('overview-list');
            if (!overview || !list) return;
            overview.style.display = 'block';
            list.innerHTML = '';
            var renderItems = items || this.items;
            for (var i = 0; i < renderItems.length; i++) {
                var item = renderItems[i];
                var div = document.createElement('div');
                div.className = 'media-overview-item';
                var title = (item.title || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                var year = item.year || 'N/A';
                var status = (item.status || 'requested').toLowerCase();
                var statusLabel = status === 'available' ? 'Available' : 'Requested';
                var posterUrl = item.poster_path ? ('https://image.tmdb.org/t/p/w200' + item.poster_path) : './static/images/blackout.jpg';
                var qualityProfile = item.quality_profile || 'N/A';
                var rootFolder = item.root_folder || 'N/A';
                div.innerHTML = '<div class="media-overview-poster"><img src="' + posterUrl + '" onerror="this.src=\'./static/images/blackout.jpg\'"></div>' +
                    '<div class="media-overview-details">' +
                    '<div class="media-overview-title">' + title + ' <span class="media-overview-year">(' + year + ')</span></div>' +
                    '<div class="media-overview-meta">' +
                    '<div class="media-overview-meta-item"><i class="fas fa-folder"></i> ' + rootFolder + '</div>' +
                    '<div class="media-overview-meta-item"><i class="fas fa-film"></i> ' + qualityProfile + '</div>' +
                    '</div>' +
                    '<div><span class="media-overview-status ' + status + '">' + statusLabel + '</span></div>' +
                    '<div class="media-overview-actions">' +
                    '<button class="media-overview-action-btn" onclick="window.MovieHuntCollection.refreshItem(' + i + ')"><i class="fas fa-sync-alt"></i> Refresh</button>' +
                    '</div>' +
                    '</div>';
                list.appendChild(div);
            }
        },

        refreshItem: function(index) {
            // Placeholder for refresh functionality
            console.log('Refresh item:', index);
        },

        createCard: function(item, index) {
            var self = this;
            var card = document.createElement('div');
            card.className = 'media-card';
            var title = (item.title || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
            var titleRaw = (item.title || '').replace(/</g, '&lt;');
            var year = item.year || 'N/A';
            var status = (item.status || 'requested').toLowerCase();
            var posterUrl = (item.poster_path && item.poster_path.indexOf('http') === 0) ? item.poster_path : (item.poster_path ? 'https://image.tmdb.org/t/p/w500' + (item.poster_path.indexOf('/') === 0 ? item.poster_path : '/' + item.poster_path) : './static/images/blackout.jpg');
            if (!item.poster_path) posterUrl = './static/images/blackout.jpg';

            // Status badge: green check = available, amber bookmark = requested
            var statusClass = status === 'available' ? 'complete' : 'partial';
            var statusIcon = status === 'available' ? 'check' : 'bookmark';

            // Rating display
            var rating = item.vote_average != null ? Number(item.vote_average).toFixed(1) : '';
            var ratingHtml = rating ? '<span class="media-card-rating"><i class="fas fa-star"></i> ' + rating + '</span>' : '';

            // Delete button: show for all collection items (they are all available or requested)
            var hasInstance = !!self.getCurrentInstanceName();
            var canDelete = hasInstance && item.tmdb_id;
            var deleteHtml = canDelete ? '<button class="media-card-delete-btn" title="Remove / Delete"><i class="fas fa-trash-alt"></i></button>' : '';

            if (status === 'available') card.classList.add('in-library');

            card.innerHTML = '<div class="media-card-poster">' +
                '<div class="media-card-status-badge ' + statusClass + '"><i class="fas fa-' + statusIcon + '"></i></div>' +
                '<img src="' + posterUrl + '" alt="' + title + '" onerror="this.src=\'./static/images/blackout.jpg\'">' +
                '<div class="media-card-overlay">' +
                '<div class="media-card-overlay-title">' + titleRaw + '</div>' +
                '<div class="media-card-overlay-content">' +
                '<div class="media-card-overlay-year">' + year + '</div>' +
                '</div></div>' +
                '</div>' +
                '<div class="media-card-info">' +
                '<div class="media-card-title" title="' + title + '">' + titleRaw + '</div>' +
                '<div class="media-card-meta">' +
                '<span class="media-card-year">' + year + '</span>' +
                ratingHtml +
                deleteHtml +
                '</div></div>';

            // Handle delete button click
            var deleteBtn = card.querySelector('.media-card-delete-btn');
            if (deleteBtn) {
                deleteBtn.addEventListener('click', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    self.openDeleteModal(item, card);
                });
            }

            // Click anywhere on card opens detail page
            if (item.tmdb_id && window.MovieHuntDetail && window.MovieHuntDetail.openDetail) {
                card.style.cursor = 'pointer';
                card.onclick = function(e) {
                    // Don't open detail if clicking delete button
                    if (e.target.closest && e.target.closest('.media-card-delete-btn')) return;
                    var movieData = {
                        tmdb_id: item.tmdb_id,
                        id: item.tmdb_id,
                        title: item.title,
                        year: item.year,
                        poster_path: item.poster_path,
                        in_library: status === 'available'
                    };
                    window.MovieHuntDetail.openDetail(movieData);
                };
            }

            return card;
        },

        openDeleteModal: function(item, cardElement) {
            var self = this;
            if (!window.MovieCardDeleteModal) {
                console.error('[MovieHuntCollection] MovieCardDeleteModal not loaded');
                return;
            }
            var instanceName = self.getCurrentInstanceName();
            var select = this.getEl('instance-select');
            var instanceId = select ? select.value : '';
            var status = (item.status || 'requested').toLowerCase();

            window.MovieCardDeleteModal.open(item, {
                instanceName: instanceName,
                instanceId: instanceId,
                status: status,
                hasFile: status === 'available',
                appType: 'movie_hunt',
                onDeleted: function() {
                    window.MediaUtils.animateCardRemoval(cardElement, function() {
                        // Reload collection after card is removed
                        setTimeout(function() { self.loadCollection(); }, 200);
                    });
                }
            });
        },

        removeFromCollection: function(title, year) {
            var self = this;
            if (!title) return;
            var doRemove = function() {
                fetch('./api/movie-hunt/collection/0', {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title: title, year: year })
                })
                    .then(function(r) { return r.json(); })
                    .then(function(data) {
                        if (data.success && window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification('Removed from collection.', 'success');
                        }
                        self.loadCollection();
                    })
                    .catch(function() {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification('Failed to remove.', 'error');
                        }
                    });
            };
            if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
                window.HuntarrConfirm.show({ title: 'Remove from Requested List', message: 'Remove this movie from your requested list?', confirmLabel: 'Remove', onConfirm: doRemove });
            } else {
                doRemove();
            }
        }
    };
})();

/**
 * TV Hunt Collection – series list with expandable seasons and episodes.
 * Mirrors Sonarr's series detail view: header with info, then accordion seasons with episode tables.
 */
(function() {
    'use strict';

    window.TVHuntCollection = {
        _prefix: 'media-hunt-tv-collection',
        items: [],
        sortBy: 'title.asc',
        viewMode: 'posters',
        searchQuery: '',

        getEl: function(suffix) {
            return document.getElementById((this._prefix || 'media-hunt-collection') + '-' + suffix);
        },

        init: function() {
            this.viewMode = HuntarrUtils.getUIPreference(this._prefix + '-view', 'posters');
            this.setupInstanceSelect();
            this.setupSort();
            this.setupViewMode();
            this.setupSearch();
            this.setupBackButton();
            if (!window._mediaHuntCollectionUnified) this.loadCollection();
        },

        setupInstanceSelect: function() {
            if (window._mediaHuntCollectionUnified) return;
            var self = this;
            var select = this.getEl('instance-select');
            if (!select) return;
            fetch('./api/tv-hunt/instances')
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    var instances = data.instances || [];
                    select.innerHTML = '';
                    if (instances.length === 0) {
                        select.innerHTML = '<option value="">No instances</option>';
                        return;
                    }
                    instances.forEach(function(inst) {
                        var opt = document.createElement('option');
                        opt.value = inst.id;
                        opt.textContent = inst.name;
                        select.appendChild(opt);
                    });
                    fetch('./api/tv-hunt/current-instance')
                        .then(function(r) { return r.json(); })
                        .then(function(d) {
                            if (d.instance_id) select.value = d.instance_id;
                            self.loadCollection();
                        });
                    select.addEventListener('change', function() {
                        fetch('./api/tv-hunt/current-instance', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ instance_id: parseInt(select.value) })
                        }).then(function() { self.loadCollection(); });
                    });
                });
        },

        setupSort: function() {
            var self = this;
            var sortSelect = this.getEl('sort');
            if (!sortSelect) return;
            sortSelect.addEventListener('change', function() {
                if (window._mediaHuntCollectionUnified) {
                    var isel = self.getEl('instance-select');
                    if (isel && isel.value && isel.value.indexOf('tv:') !== 0) return;
                }
                self.sortBy = sortSelect.value;
                self.renderCollection();
            });
        },

        setupViewMode: function() {
            var self = this;
            var select = this.getEl('view-mode');
            if (!select) return;
            select.value = this.viewMode;
            select.addEventListener('change', function() {
                if (window._mediaHuntCollectionUnified) {
                    var isel = self.getEl('instance-select');
                    if (isel && isel.value && isel.value.indexOf('tv:') !== 0) return;
                }
                self.viewMode = select.value;
                HuntarrUtils.setUIPreference(self._prefix + '-view', self.viewMode);
                self.renderCollection();
            });
        },

        setupSearch: function() {
            var self = this;
            var input = this.getEl('search-input');
            if (!input) return;
            var timeout;
            input.addEventListener('input', function() {
                if (window._mediaHuntCollectionUnified) {
                    var isel = self.getEl('instance-select');
                    if (isel && isel.value && isel.value.indexOf('tv:') !== 0) return;
                }
                if (timeout) clearTimeout(timeout);
                var q = (input.value || '').trim();
                if (!q) {
                    self.searchQuery = '';
                    self.showMainView();
                    self.renderCollection();
                    return;
                }
                timeout = setTimeout(function() {
                    self.searchQuery = '';
                    self.performCollectionSearch(q);
                }, 400);
            });
        },

        setupBackButton: function() {
            var self = this;
            var btn = this.getEl('series-back-btn');
            if (btn) {
                btn.addEventListener('click', function() {
                    self.showMainView();
                });
            }
        },

        showMainView: function() {
            var mainView = this.getEl('main-content');
            var detailView = this.getEl('series-detail-view');
            var searchView = this.getEl('search-results-view');
            if (mainView) mainView.style.display = 'block';
            if (detailView) detailView.style.display = 'none';
            if (searchView) searchView.style.display = 'none';
        },

        performCollectionSearch: function(query) {
            // Use same requestarr search as movie collection (app_type=tv_hunt)
            var self = this;
            var mainView = this.getEl('main-content');
            var searchView = this.getEl('search-results-view');
            var detailView = this.getEl('series-detail-view');
            var grid = this.getEl('search-results-grid');
            if (mainView) mainView.style.display = 'none';
            if (detailView) detailView.style.display = 'none';
            if (searchView) searchView.style.display = 'block';
            if (grid) grid.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Searching...</p></div>';

            var instanceSelect = this.getEl('instance-select');
            var instanceName = instanceSelect ? instanceSelect.value : '';
            var url = './api/requestarr/search?q=' + encodeURIComponent(query) + '&app_type=tv_hunt&instance_name=' + encodeURIComponent(instanceName);

            fetch(url)
                .then(function(r) {
                    if (!r.ok) {
                        return r.json().then(function(data) {
                            throw new Error(data.error || 'Search failed');
                        }).catch(function() { throw new Error('Search failed'); });
                    }
                    return r.json();
                })
                .then(function(data) {
                    var results = data.results || [];
                    if (!grid) return;
                    if (results.length === 0) {
                        grid.innerHTML = '<p style="text-align:center;color:#888;padding:40px;">No results found.</p>';
                        return;
                    }
                    grid.innerHTML = '';
                    results.forEach(function(show) {
                        var card = self._createSearchCard(show);
                        grid.appendChild(card);
                    });
                })
                .catch(function(err) {
                    if (grid) grid.innerHTML = '<p style="text-align:center;color:#f87171;">' + (err && err.message ? HuntarrUtils.escapeHtml(err.message) : 'Search failed.') + '</p>';
                });
        },

        _createSearchCard: function(show) {
            var self = this;
            var card = document.createElement('div');
            card.className = 'media-card';
            // requestarr returns full poster URL; raw TMDB returns relative path
            var posterUrl = show.poster_path
                ? (show.poster_path.indexOf('http') === 0 ? show.poster_path : 'https://image.tmdb.org/t/p/w300' + show.poster_path)
                : './static/images/no-poster.png';
            var title = show.name || show.title || show.original_name || 'Unknown';
            var year = show.year != null ? show.year : (show.first_air_date || '').substring(0, 4);

            // Check if already in collection (supports both requestarr shape and raw TMDB shape)
            var showId = show.tmdb_id != null ? show.tmdb_id : show.id;
            var inCollection = self.items.some(function(s) { return s.tmdb_id === showId; });

            card.innerHTML =
                '<div class="media-poster">' +
                    '<img src="' + posterUrl + '" alt="' + HuntarrUtils.escapeHtml(title) + '" loading="lazy">' +
                    '<div class="media-overlay">' +
                        (inCollection
                            ? '<span style="color:#4ade80;font-size:0.9em;"><i class="fas fa-check"></i> In Collection</span>'
                            : '<button class="add-to-collection-btn" title="Add to Collection"><i class="fas fa-plus"></i></button>') +
                    '</div>' +
                '</div>' +
                '<div class="media-info">' +
                    '<div class="media-title">' + HuntarrUtils.escapeHtml(title) + '</div>' +
                    '<div class="media-year">' + (year || '') + '</div>' +
                '</div>';

            if (!inCollection) {
                var addBtn = card.querySelector('.add-to-collection-btn');
                if (addBtn) {
                    var instSelect = this.getEl('instance-select');
                    var instanceId = instSelect ? instSelect.value : '';
                    addBtn.addEventListener('click', function(e) {
                        e.stopPropagation();
                        var add = (window.MediaHunt && window.MediaHunt.addToCollection) ? window.MediaHunt.addToCollection : (window.TVHunt && window.TVHunt.addToCollection);
                        if (add) add(show, instanceId);
                        addBtn.outerHTML = '<span style="color:#4ade80;font-size:0.9em;"><i class="fas fa-check"></i> Added</span>';
                    });
                }
            }
            return card;
        },

        getCurrentInstanceId: function() {
            var select = this.getEl('instance-select');
            if (!select) return '';
            var v = select.value || '';
            if (v.indexOf('tv:') === 0) return v.slice(3);
            return v;
        },

        loadCollection: function() {
            var self = this;
            var grid = this.getEl('grid');
            if (grid) {
                grid.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Loading TV collection...</p></div>';
                grid.style.display = 'flex';
            }
            var instanceId = self.getCurrentInstanceId();
            if (!instanceId) {
                self.renderCollection();
                return;
            }
            fetch('./api/tv-hunt/collection?instance_id=' + instanceId)
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    self.items = data.series || [];
                    self.renderCollection();
                })
                .catch(function() {
                    self.items = [];
                    self.renderCollection();
                });
        },

        renderCollection: function() {
            var self = this;
            var grid = this.getEl('grid');
            var table = this.getEl('table');
            var tableBody = this.getEl('table-body');
            var overview = this.getEl('overview');
            var overviewList = this.getEl('overview-list');
            if (grid) grid.style.display = 'none';
            if (table) table.style.display = 'none';
            if (overview) overview.style.display = 'none';

            var instanceSelect = this.getEl('instance-select');
            var noInstances = instanceSelect && (!instanceSelect.value || instanceSelect.value === '') &&
                (instanceSelect.options.length === 0 || (instanceSelect.options[0] && (instanceSelect.options[0].textContent || '').indexOf('No instances') !== -1));

            if (noInstances) {
                if (grid) {
                    grid.style.display = 'flex';
                    grid.style.alignItems = 'center';
                    grid.style.justifyContent = 'center';
                    grid.innerHTML = '<div style="text-align: center; color: #9ca3af; max-width: 600px;">' +
                        '<i class="fas fa-cube" style="font-size: 64px; margin-bottom: 30px; opacity: 0.4; display: block;"></i>' +
                        '<p style="font-size: 20px; margin-bottom: 15px; font-weight: 500;">No TV Hunt instance</p>' +
                        '<p style="font-size: 15px; line-height: 1.6; opacity: 0.8; margin-bottom: 20px;">Create a TV Hunt instance to manage your TV collection and requested shows.</p>' +
                        '<a href="./#media-hunt-settings" class="action-button" style="display: inline-flex; align-items: center; gap: 8px; background: rgba(99, 102, 241, 0.2); border: 1px solid rgba(99, 102, 241, 0.4); color: #818cf8; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 500; transition: all 0.2s ease;">' +
                        '<i class="fas fa-cog"></i> Set up TV Hunt instance</a></div>';
                }
                return;
            }

            var items = self.items.slice();
            if (self.sortBy === 'title.asc') items.sort(function(a, b) { return (a.title || '').localeCompare(b.title || ''); });
            else if (self.sortBy === 'title.desc') items.sort(function(a, b) { return (b.title || '').localeCompare(a.title || ''); });
            else if (self.sortBy === 'added.desc') items.sort(function(a, b) { return (b.added_at || '').localeCompare(a.added_at || ''); });
            else if (self.sortBy === 'rating.desc') items.sort(function(a, b) { return (b.vote_average || 0) - (a.vote_average || 0); });

            if (items.length === 0) {
                if (grid) {
                    grid.style.display = 'flex';
                    grid.style.alignItems = 'center';
                    grid.style.justifyContent = 'center';
                    grid.innerHTML = '<div style="text-align: center; color: #9ca3af; max-width: 600px;">' +
                        '<i class="fas fa-inbox" style="font-size: 64px; margin-bottom: 30px; opacity: 0.4; display: block;"></i>' +
                        '<p style="font-size: 20px; margin-bottom: 15px; font-weight: 500;">No Requested Media</p>' +
                        '<p style="font-size: 15px; line-height: 1.6; opacity: 0.8;">TV shows you add from TV Hunt will appear here. Track status as Requested or Available.</p></div>';
                }
                return;
            }

            if (self.viewMode === 'table') {
                self._renderTableToContainer(table, tableBody, items);
                if (table) table.style.display = 'block';
            } else if (self.viewMode === 'overview') {
                self._renderOverviewToContainer(overviewList, items);
                if (overview) overview.style.display = 'block';
            } else {
                grid.style.display = 'grid';
                grid.style.alignItems = '';
                grid.style.justifyContent = '';
                grid.innerHTML = '';
                self._renderPosterView(grid, items);
            }
        },

        _renderTableToContainer: function(tableEl, tbody, items) {
            var self = this;
            if (!tbody) return;
            tbody.innerHTML = '';
            items.forEach(function(series) {
                var tr = document.createElement('tr');
                tr.style.cursor = 'pointer';
                var posterUrl = series.poster_path ? 'https://image.tmdb.org/t/p/w92' + series.poster_path : './static/images/no-poster.png';
                var episodeCount = 0;
                (series.seasons || []).forEach(function(s) { episodeCount += (s.episodes || []).length; });
                tr.innerHTML =
                    '<td><img src="' + posterUrl + '" class="table-poster" style="width:40px;border-radius:4px;" loading="lazy" onerror="this.src=\'./static/images/no-poster.png\'"></td>' +
                    '<td class="table-title">' + HuntarrUtils.escapeHtml(series.title || '') + '</td>' +
                    '<td>' + (series.seasons || []).length + '</td>' +
                    '<td>' + episodeCount + '</td>' +
                    '<td>' + HuntarrUtils.escapeHtml(series.status || '') + '</td>' +
                    '<td>' + (series.first_air_date || '').substring(0, 4) + '</td>';
                tr.addEventListener('click', function() {
                    self.openSeriesDetail(series.tmdb_id, series);
                });
                tbody.appendChild(tr);
            });
        },

        _renderOverviewToContainer: function(listEl, items) {
            var self = this;
            if (!listEl) return;
            listEl.innerHTML = '';
            items.forEach(function(series) {
                var posterUrl = series.poster_path ? 'https://image.tmdb.org/t/p/w92' + series.poster_path : './static/images/no-poster.png';
                var year = (series.first_air_date || '').substring(0, 4);
                var div = document.createElement('div');
                div.className = 'media-overview-item';
                div.style.display = 'flex';
                div.style.alignItems = 'center';
                div.style.gap = '12px';
                div.style.padding = '10px 0';
                div.style.borderBottom = '1px solid rgba(255,255,255,0.06)';
                div.style.cursor = 'pointer';
                div.innerHTML = '<img src="' + posterUrl + '" alt="" style="width:50px;height:75px;object-fit:cover;border-radius:6px;" onerror="this.src=\'./static/images/no-poster.png\'">' +
                    '<div><div style="font-weight:600;color:#e2e8f0;">' + HuntarrUtils.escapeHtml(series.title || '') + '</div>' +
                    '<div style="font-size:0.85rem;color:#94a3b8;">' + year + (series.status ? ' · ' + HuntarrUtils.escapeHtml(series.status) : '') + '</div></div>';
                div.addEventListener('click', function() {
                    self.openSeriesDetail(series.tmdb_id, series);
                });
                listEl.appendChild(div);
            });
        },

        _renderPosterView: function(grid, items) {
            var self = this;
            items.forEach(function(series) {
                var card = document.createElement('div');
                card.className = 'media-card';
                card.dataset.tmdbId = series.tmdb_id;
                var posterUrl = series.poster_path
                    ? 'https://image.tmdb.org/t/p/w300' + series.poster_path
                    : './static/images/no-poster.png';
                var title = series.title || 'Unknown';
                var year = (series.first_air_date || '').substring(0, 4);
                var episodeCount = 0;
                var seasonCount = (series.seasons || []).length;
                (series.seasons || []).forEach(function(s) {
                    episodeCount += (s.episodes || []).length;
                });

                card.innerHTML =
                    '<div class="media-poster">' +
                        '<img src="' + posterUrl + '" alt="' + HuntarrUtils.escapeHtml(title) + '" loading="lazy">' +
                        '<div class="media-overlay">' +
                            '<span style="font-size:0.85em;color:#ddd;">' + seasonCount + ' Season' + (seasonCount !== 1 ? 's' : '') + ' &middot; ' + episodeCount + ' Ep' + (episodeCount !== 1 ? 's' : '') + '</span>' +
                        '</div>' +
                    '</div>' +
                    '<div class="media-info">' +
                        '<div class="media-title">' + HuntarrUtils.escapeHtml(title) + '</div>' +
                        '<div class="media-year">' + (year || '') + (series.status ? ' &middot; ' + HuntarrUtils.escapeHtml(series.status) : '') + '</div>' +
                    '</div>';

                card.addEventListener('click', function() {
                    self.openSeriesDetail(series.tmdb_id, series);
                });
                grid.appendChild(card);
            });
        },

        // ─── Series Detail View (Sonarr-style seasons/episodes) ───
        openSeriesDetail: function(tmdbId, seriesData) {
            var self = this;
            var mainView = this.getEl('main-content');
            var detailView = this.getEl('series-detail-view');
            var searchView = this.getEl('search-results-view');
            var content = this.getEl('series-detail-content');
            if (mainView) mainView.style.display = 'none';
            if (searchView) searchView.style.display = 'none';
            if (detailView) detailView.style.display = 'block';
            if (content) content.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Loading series...</p></div>';

            // Use local collection data if available
            if (seriesData) {
                self._renderSeriesDetail(content, seriesData);
                return;
            }

            // Find in collection
            var found = self.items.find(function(s) { return s.tmdb_id === tmdbId; });
            if (found) {
                self._renderSeriesDetail(content, found);
                return;
            }

            // Fetch from TMDB
            fetch('./api/tv-hunt/series/' + tmdbId)
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    self._renderSeriesDetail(content, data);
                })
                .catch(function() {
                    if (content) content.innerHTML = '<p style="color:#f87171;">Failed to load series details.</p>';
                });
        },

        _renderSeriesDetail: function(container, series) {
            var self = this;
            if (!container) return;
            container.innerHTML = '';

            // Series banner
            var banner = document.createElement('div');
            banner.className = 'series-info-banner';
            var posterUrl = series.poster_path
                ? 'https://image.tmdb.org/t/p/w300' + series.poster_path
                : './static/images/no-poster.png';
            var title = series.title || series.name || 'Unknown';
            var year = (series.first_air_date || '').substring(0, 4);
            var genres = (series.genres || []).map(function(g) { return g.name || g; }).join(', ');
            var networks = (series.networks || []).map(function(n) { return n.name || n; }).join(', ');
            var rating = series.vote_average ? parseFloat(series.vote_average).toFixed(1) : '';

            banner.innerHTML =
                '<div class="series-poster"><img src="' + posterUrl + '" alt="' + HuntarrUtils.escapeHtml(title) + '"></div>' +
                '<div class="series-meta">' +
                    '<h2>' + HuntarrUtils.escapeHtml(title) + '</h2>' +
                    '<div class="series-meta-tags">' +
                        (year ? '<span class="series-meta-tag"><i class="fas fa-calendar"></i> ' + year + '</span>' : '') +
                        (rating ? '<span class="series-meta-tag"><i class="fas fa-star" style="color:#facc15;"></i> ' + rating + '%</span>' : '') +
                        (genres ? '<span class="series-meta-tag"><i class="fas fa-tag"></i> ' + HuntarrUtils.escapeHtml(genres) + '</span>' : '') +
                        (series.status ? '<span class="series-meta-tag"><i class="fas fa-circle"></i> ' + HuntarrUtils.escapeHtml(series.status) + '</span>' : '') +
                        (networks ? '<span class="series-meta-tag"><i class="fas fa-tv"></i> ' + HuntarrUtils.escapeHtml(networks) + '</span>' : '') +
                        (series.number_of_seasons ? '<span class="series-meta-tag"><i class="fas fa-layer-group"></i> ' + series.number_of_seasons + ' Seasons</span>' : '') +
                        (series.number_of_episodes ? '<span class="series-meta-tag"><i class="fas fa-film"></i> ' + series.number_of_episodes + ' Episodes</span>' : '') +
                    '</div>' +
                    '<div class="series-overview">' + HuntarrUtils.escapeHtml(series.overview || '') + '</div>' +
                '</div>';
            container.appendChild(banner);

            // Seasons accordion
            var seasons = series.seasons || [];
            // Sort seasons: specials (0) last, then by number descending (newest first)
            seasons.sort(function(a, b) {
                if (a.season_number === 0) return 1;
                if (b.season_number === 0) return -1;
                return b.season_number - a.season_number;
            });

            seasons.forEach(function(season) {
                container.appendChild(self._createSeasonAccordion(series, season));
            });
        },

        _createSeasonAccordion: function(series, season) {
            var self = this;
            var wrapper = document.createElement('div');
            wrapper.className = 'season-accordion';

            var episodes = season.episodes || [];
            var totalEps = episodes.length;
            var monitoredCount = episodes.filter(function(e) { return e.monitored !== false; }).length;
            var now = new Date();

            // Count statuses
            var availCount = 0;
            var unairedCount = 0;
            episodes.forEach(function(ep) {
                if (ep.status === 'available') availCount++;
                var airDate = ep.air_date ? new Date(ep.air_date) : null;
                if (airDate && airDate > now) unairedCount++;
            });

            var countClass = availCount === totalEps && totalEps > 0 ? 'all-available' : (availCount > 0 ? 'partial' : 'none-available');
            var countText = availCount + ' / ' + totalEps;
            var seasonName = season.name || ('Season ' + season.season_number);
            var isSpecials = season.season_number === 0;
            var isMonitored = season.monitored !== false;

            // Header
            var header = document.createElement('div');
            header.className = 'season-accordion-header';
            header.innerHTML =
                '<span class="season-chevron"><i class="fas fa-chevron-right"></i></span>' +
                '<span class="season-icon"><i class="fas fa-bookmark"></i></span>' +
                '<span class="season-name">' + HuntarrUtils.escapeHtml(seasonName) + '</span>' +
                '<span class="season-episode-count ' + countClass + '">' + countText + '</span>' +
                '<span class="season-status-icon">' +
                    (availCount === totalEps && totalEps > 0 ? '<i class="fas fa-check-circle" style="color:#4ade80;"></i>' : '') +
                '</span>' +
                '<div class="season-actions">' +
                    '<button class="season-action-btn season-search-btn" title="Search Season"><i class="fas fa-search"></i></button>' +
                '</div>';

            // Episode body
            var body = document.createElement('div');
            body.className = 'season-episodes-body';

            var table = document.createElement('table');
            table.className = 'episode-table';
            table.innerHTML = '<thead><tr>' +
                '<th class="ep-monitor"></th>' +
                '<th class="ep-number">#</th>' +
                '<th class="ep-title">Title</th>' +
                '<th class="ep-airdate">Air Date</th>' +
                '<th class="ep-status">Status</th>' +
                '<th class="ep-actions"></th>' +
                '</tr></thead>';

            var tbody = document.createElement('tbody');
            episodes.forEach(function(ep) {
                var tr = document.createElement('tr');
                var epMonitored = ep.monitored !== false;
                var airDate = ep.air_date || '';
                var airDateObj = airDate ? new Date(airDate) : null;
                var isUnaired = airDateObj && airDateObj > now;
                var statusClass = isUnaired ? 'unaired' : (ep.status === 'available' ? 'available' : 'missing');
                var statusText = isUnaired ? 'Unaired' : (ep.status === 'available' ? 'On Disk' : 'Missing');
                var formattedDate = airDate ? self._formatDate(airDate) : '';

                tr.innerHTML =
                    '<td class="ep-monitor"><span class="monitor-checkbox ' + (epMonitored ? 'monitored' : '') + '" data-ep="' + ep.episode_number + '" data-season="' + season.season_number + '"><i class="fas fa-bookmark"></i></span></td>' +
                    '<td class="ep-number">' + (ep.episode_number || '') + '</td>' +
                    '<td class="ep-title">' + HuntarrUtils.escapeHtml(ep.title || 'Episode ' + ep.episode_number) + '</td>' +
                    '<td class="ep-airdate">' + formattedDate + '</td>' +
                    '<td class="ep-status"><span class="ep-status-badge ' + statusClass + '">' + statusText + '</span></td>' +
                    '<td class="ep-actions">' +
                        (!isUnaired && statusClass !== 'available' ? '<button class="ep-action-btn ep-search-btn" title="Search Episode" data-season="' + season.season_number + '" data-ep="' + ep.episode_number + '"><i class="fas fa-search"></i></button>' : '') +
                    '</td>';
                tbody.appendChild(tr);
            });
            table.appendChild(tbody);
            body.appendChild(table);

            // Toggle accordion
            header.addEventListener('click', function(e) {
                if (e.target.closest('.season-action-btn') || e.target.closest('.monitor-checkbox')) return;
                header.classList.toggle('expanded');
                body.classList.toggle('expanded');
            });

            // Season search button
            var searchBtn = header.querySelector('.season-search-btn');
            if (searchBtn) {
                searchBtn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    self._searchSeason(series, season);
                });
            }

            // Episode search buttons
            body.querySelectorAll('.ep-search-btn').forEach(function(btn) {
                btn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    var sn = parseInt(btn.dataset.season);
                    var en = parseInt(btn.dataset.ep);
                    self._searchEpisode(series, sn, en);
                });
            });

            // Monitor toggles
            body.querySelectorAll('.monitor-checkbox').forEach(function(cb) {
                cb.addEventListener('click', function(e) {
                    e.stopPropagation();
                    var sn = parseInt(cb.dataset.season);
                    var en = parseInt(cb.dataset.ep);
                    var newState = !cb.classList.contains('monitored');
                    cb.classList.toggle('monitored');
                    self._toggleEpisodeMonitor(series.tmdb_id, sn, en, newState);
                });
            });

            wrapper.appendChild(header);
            wrapper.appendChild(body);
            return wrapper;
        },

        _formatDate: function(dateStr) {
            if (!dateStr) return '';
            try {
                var d = new Date(dateStr);
                var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                return months[d.getMonth()] + ' ' + d.getDate() + ' ' + d.getFullYear();
            } catch (e) {
                return dateStr;
            }
        },

        _searchSeason: function(series, season) {
            var instanceId = this.getCurrentInstanceId();
            if (!instanceId) {
                window.huntarrUI.showNotification('No instance selected.', 'error');
                return;
            }
            window.huntarrUI.showNotification('Searching for ' + (series.title || '') + ' S' + String(season.season_number).padStart(2, '0') + '...', 'info');
            fetch('./api/tv-hunt/request?instance_id=' + instanceId, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    series_title: series.title,
                    season_number: season.season_number,
                    tmdb_id: series.tmdb_id,
                    search_type: 'season',
                    instance_id: instanceId,
                })
            })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.success) {
                        window.huntarrUI.showNotification(data.message || 'Season search sent!', 'success');
                    } else {
                        window.huntarrUI.showNotification(data.message || 'No results found.', 'error');
                    }
                })
                .catch(function() {
                    window.huntarrUI.showNotification('Search request failed.', 'error');
                });
        },

        _searchEpisode: function(series, seasonNumber, episodeNumber) {
            var instanceId = this.getCurrentInstanceId();
            if (!instanceId) {
                window.huntarrUI.showNotification('No instance selected.', 'error');
                return;
            }
            var label = (series.title || '') + ' S' + String(seasonNumber).padStart(2, '0') + 'E' + String(episodeNumber).padStart(2, '0');
            window.huntarrUI.showNotification('Searching for ' + label + '...', 'info');
            fetch('./api/tv-hunt/request?instance_id=' + instanceId, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    series_title: series.title,
                    season_number: seasonNumber,
                    episode_number: episodeNumber,
                    tmdb_id: series.tmdb_id,
                    search_type: 'episode',
                    instance_id: instanceId,
                })
            })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.success) {
                        window.huntarrUI.showNotification(data.message || 'Episode search sent!', 'success');
                    } else {
                        window.huntarrUI.showNotification(data.message || 'No results found.', 'error');
                    }
                })
                .catch(function() {
                    window.huntarrUI.showNotification('Search request failed.', 'error');
                });
        },

        _toggleEpisodeMonitor: function(tmdbId, seasonNumber, episodeNumber, monitored) {
            var instanceId = this.getCurrentInstanceId();
            if (!instanceId) return;
            fetch('./api/tv-hunt/collection/' + tmdbId + '/monitor?instance_id=' + instanceId, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    season_number: seasonNumber,
                    episode_number: episodeNumber,
                    monitored: monitored,
                    instance_id: instanceId,
                })
            }).catch(function() {});
        },

        // ─── Delete series ───
        deleteSeries: function(tmdbId, title) {
            var self = this;
            var instanceId = self.getCurrentInstanceId();
            if (!instanceId) return;
            window.HuntarrConfirm.show({
                title: 'Delete Series',
                message: 'Are you sure you want to remove "' + (title || 'this series') + '" from your collection?',
                confirmLabel: 'Delete',
                onConfirm: function() {
                    fetch('./api/tv-hunt/collection/' + tmdbId + '?instance_id=' + instanceId, { method: 'DELETE' })
                        .then(function(r) { return r.json(); })
                        .then(function(data) {
                            if (data.success) {
                                window.huntarrUI.showNotification('Series removed from collection.', 'success');
                                self.loadCollection();
                                self.showMainView();
                            } else {
                                window.huntarrUI.showNotification(data.error || 'Failed to delete.', 'error');
                            }
                        })
                        .catch(function() {
                            window.huntarrUI.showNotification('Failed to delete series.', 'error');
                        });
                }
            });
        }
    };
})();

/**
 * Media Hunt Collection – one combined instance dropdown (TV - Name / Movie - Name), one content area.
 */
(function() {
    'use strict';

    var selectId = 'media-hunt-collection-instance-select';

    function isUnifiedSingleDropdown() {
        return !!document.getElementById(selectId) && !document.getElementById('media-hunt-tv-collection-grid');
    }

    function populateUnifiedDropdown(select, tvInstances, movieInstances) {
        select.innerHTML = '';
        var hasAny = (tvInstances && tvInstances.length > 0) || (movieInstances && movieInstances.length > 0);
        if (!hasAny) {
            select.innerHTML = '<option value="">No instances</option>';
            return;
        }
        tvInstances.forEach(function(inst) {
            var opt = document.createElement('option');
            opt.value = 'tv:' + inst.id;
            opt.textContent = 'TV - ' + (inst.name || 'Instance ' + inst.id);
            select.appendChild(opt);
        });
        movieInstances.forEach(function(inst) {
            var opt = document.createElement('option');
            opt.value = 'movie:' + inst.id;
            opt.setAttribute('data-name', inst.name || 'Instance ' + inst.id);
            opt.textContent = 'Movie - ' + (inst.name || 'Instance ' + inst.id);
            select.appendChild(opt);
        });
    }

    window.MediaHuntCollection = {
        init: function() {
            if (isUnifiedSingleDropdown()) {
                window._mediaHuntCollectionUnified = true;
                var select = document.getElementById(selectId);
                if (!select) return;
                select.innerHTML = '<option value="">Loading instances...</option>';
                var tvPromise = fetch('./api/tv-hunt/instances').then(function(r) { return r.json(); }).then(function(d) { return d.instances || []; }).catch(function() { return []; });
                var moviePromise = fetch('./api/movie-hunt/instances').then(function(r) { return r.json(); }).then(function(d) { return d.instances || []; }).catch(function() { return []; });
                Promise.all([tvPromise, moviePromise]).then(function(results) {
                    var tvInstances = results[0];
                    var movieInstances = results[1];
                    populateUnifiedDropdown(select, tvInstances, movieInstances);
                    if (select.options.length > 0 && select.options[0].value) {
                        select.dispatchEvent(new Event('change', { bubbles: true }));
                    } else {
                        if (window.TVHuntCollection && window.TVHuntCollection._prefix) window.TVHuntCollection.renderCollection();
                        if (window.MovieHuntCollection && window.MovieHuntCollection._prefix) window.MovieHuntCollection.renderPage();
                    }
                });
                select.addEventListener('change', function() {
                    var val = select.value || '';
                    if (!val) return;
                    if (val.indexOf('tv:') === 0) {
                        window._mediaHuntSectionMode = 'tv';
                        fetch('./api/tv-hunt/current-instance', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ instance_id: parseInt(val.slice(3), 10) })
                        }).then(function() {});
                        if (window.TVHuntCollection && typeof window.TVHuntCollection.loadCollection === 'function') {
                            window.TVHuntCollection.showMainView();
                            window.TVHuntCollection.loadCollection();
                        }
                    } else if (val.indexOf('movie:') === 0) {
                        window._mediaHuntSectionMode = 'movie';
                        var id = val.slice(6);
                        fetch('./api/movie-hunt/current-instance', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ instance_id: parseInt(id, 10) })
                        }).then(function() {});
                        if (window.MovieHuntCollection && typeof window.MovieHuntCollection.loadCollection === 'function') {
                            window.MovieHuntCollection.showMainView();
                            window.MovieHuntCollection.loadHiddenMediaIds().then(function() {
                                window.MovieHuntCollection.loadCollection();
                            });
                        }
                    }
                });
                window.TVHuntCollection._prefix = 'media-hunt-collection';
                window.MovieHuntCollection._prefix = 'media-hunt-collection';
                if (window.TVHuntCollection && typeof window.TVHuntCollection.init === 'function') window.TVHuntCollection.init();
                if (window.MovieHuntCollection && typeof window.MovieHuntCollection.init === 'function') window.MovieHuntCollection.init();
                return;
            }
            window._mediaHuntCollectionUnified = false;
            var mode = (window._mediaHuntSectionMode || 'movie').toLowerCase();
            if (mode === 'tv' && window.TVHuntCollection && typeof window.TVHuntCollection.init === 'function') {
                window.TVHuntCollection._prefix = 'media-hunt-collection';
                window.TVHuntCollection.init();
            } else if (window.MovieHuntCollection && typeof window.MovieHuntCollection.init === 'function') {
                window.MovieHuntCollection._prefix = 'media-hunt-collection';
                window.MovieHuntCollection.init();
            }
        },
        showMainView: function() {
            if (window.TVHuntCollection && typeof window.TVHuntCollection.showMainView === 'function') window.TVHuntCollection.showMainView();
            if (window.MovieHuntCollection && typeof window.MovieHuntCollection.showMainView === 'function') window.MovieHuntCollection.showMainView();
        },
        openSeriesDetail: function(tmdbId, seriesData) {
            if (window.TVHuntCollection && typeof window.TVHuntCollection.openSeriesDetail === 'function') window.TVHuntCollection.openSeriesDetail(tmdbId, seriesData);
        }
    };
})();


/* === modules/features/media-hunt-calendar.js === */
/**
 * Media Hunt Calendar – Movie Hunt, Radarr, TV Hunt, Sonarr.
 * Unified dropdown; mode (movie/tv) derived from selected instance.
 */
(function() {
    'use strict';

    var TMDB_IMG = 'https://image.tmdb.org/t/p/w92';
    var FALLBACK_POSTER = './static/images/blackout.jpg';
    var DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    var _initialized = false;
    var _currentTab = 'collection';
    var _collectionLoaded = false;
    var _upcomingLoaded = false;

    function parseInstanceValue(val) {
        if (!val) return { appType: '', instance: '' };
        var idx = val.indexOf(':');
        if (idx === -1) return { appType: '', instance: val };
        return { appType: val.substring(0, idx), instance: val.substring(idx + 1) };
    }

    function getMode() {
        var val = getInstanceValue();
        var p = parseInstanceValue(val);
        return (p.appType === 'tv_hunt' || p.appType === 'sonarr') ? 'tv' : 'movie';
    }

    function getInstanceValue() {
        var sel = document.getElementById('media-hunt-calendar-instance-select');
        return (sel && sel.value) ? sel.value : '';
    }

    function getInstanceId() {
        return getInstanceValue();
    }

    function daysPastForCurrentMonth() {
        var now = new Date();
        return now.getDate() - 1;
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function formatDateBadge(dateStr) {
        if (!dateStr) return null;
        var d = new Date(dateStr + 'T00:00:00');
        if (isNaN(d.getTime())) return null;
        var today = new Date();
        today.setHours(0, 0, 0, 0);
        return {
            day: DAY_NAMES[d.getDay()],
            num: d.getDate(),
            month: MONTH_NAMES[d.getMonth()],
            year: d.getFullYear(),
            isToday: d.getTime() === today.getTime(),
            isPast: d < today,
        };
    }

    function posterUrl(path) {
        if (!path) return FALLBACK_POSTER;
        if (path.startsWith('http')) return path;
        return TMDB_IMG + path;
    }

    function formatAvailability(val) {
        if (val === 'inCinemas') return 'In Cinemas';
        if (val === 'released') return 'Released';
        if (val === 'announced') return 'Announced';
        return val;
    }

    /* ── Movie event card ───────────────────────────────────── */

    function renderMovieEventCard(ev) {
        var poster = posterUrl(ev.poster_path);
        var typeClass = ev.event_type || 'unknown';
        var typeLabel = ev.event_label || 'Unknown';
        var statusHtml = '';
        if (ev.status) {
            var sClass = ev.status === 'available' ? 'available' : 'requested';
            statusHtml = '<span class="mh-cal-event-status ' + sClass + '">' + ev.status + '</span>';
        }
        var yearStr = ev.year ? ' (' + ev.year + ')' : '';
        var isTmdbUrl = poster && !poster.includes('./static/images/');
        if (isTmdbUrl && window.tmdbImageCache && window.tmdbImageCache.enabled && window.tmdbImageCache.storage === 'server') {
            poster = './api/tmdb/image?url=' + encodeURIComponent(poster);
        }
        return '<div class="mh-cal-event" data-tmdb-poster="' + (isTmdbUrl ? posterUrl(ev.poster_path) : '') + '">' +
            '<div class="mh-cal-event-poster"><img src="' + poster + '" alt="" onerror="this.src=\'' + FALLBACK_POSTER + '\'"></div>' +
            '<div class="mh-cal-event-info">' +
            '<div class="mh-cal-event-title">' + escapeHtml(ev.title) + yearStr + '</div>' +
            '<div class="mh-cal-event-meta">' +
            '<span class="mh-cal-event-type ' + typeClass + '">' + escapeHtml(typeLabel) + '</span>' +
            statusHtml +
            (ev.minimum_availability ? '<span class="mh-cal-event-avail">Min: ' + formatAvailability(ev.minimum_availability) + '</span>' : '') +
            '</div></div></div>';
    }

    /* ── TV episode card ─────────────────────────────────────── */

    function renderEpisodeCard(ep) {
        var poster = posterUrl(ep.poster_path || ep.series_poster);
        var statusClass = ep.status === 'available' ? 'available' : (ep.status === 'missing' ? 'missing' : '');
        var statusHtml = ep.status ? '<span class="mh-cal-event-status ' + statusClass + '">' + ep.status + '</span>' : '';
        var epLabel = 'S' + String(ep.season_number || 0).padStart(2, '0') + 'E' + String(ep.episode_number || 0).padStart(2, '0');
        return '<div class="mh-cal-event">' +
            '<div class="mh-cal-event-poster"><img src="' + poster + '" alt="" onerror="this.src=\'' + FALLBACK_POSTER + '\'"></div>' +
            '<div class="mh-cal-event-info">' +
            '<div class="mh-cal-event-title">' + escapeHtml(ep.series_title || '') + '</div>' +
            '<div class="mh-cal-event-meta">' +
            '<span class="mh-cal-event-type inCinemas">' + epLabel + '</span>' +
            '<span style="color:#94a3b8;font-size:0.85em;">' + escapeHtml(ep.title || '') + '</span>' +
            statusHtml + '</div></div></div>';
    }

    function renderDateGroup(dateStr, events, isMovie) {
        var badge = formatDateBadge(dateStr);
        if (!badge) return '';
        var todayClass = badge.isToday ? ' today' : '';
        var html = '<div class="mh-cal-date-group">' +
            '<div class="mh-cal-date-header">' +
            '<div class="mh-cal-date-badge' + todayClass + '">' +
            '<span class="mh-cal-date-day">' + badge.day + '</span><span class="mh-cal-date-num">' + badge.num + '</span></div>' +
            '<span class="mh-cal-date-month-year">' + badge.month + ' ' + badge.year + '</span>' +
            '<div class="mh-cal-date-line"></div></div><div class="mh-cal-events">';
        for (var i = 0; i < events.length; i++) {
            html += isMovie ? renderMovieEventCard(events[i]) : renderEpisodeCard(events[i]);
        }
        html += '</div></div>';
        return html;
    }

    function applyCacheToImages(container) {
        if (!window.getCachedTMDBImage || !window.tmdbImageCache || !window.tmdbImageCache.enabled || window.tmdbImageCache.storage !== 'browser') return;
        var events = container.querySelectorAll('.mh-cal-event[data-tmdb-poster]');
        events.forEach(function(el) {
            var posterUrlVal = el.getAttribute('data-tmdb-poster');
            if (!posterUrlVal) return;
            var img = el.querySelector('.mh-cal-event-poster img');
            if (!img) return;
            window.getCachedTMDBImage(posterUrlVal, window.tmdbImageCache).then(function(cachedUrl) {
                if (cachedUrl && cachedUrl !== posterUrlVal) img.src = cachedUrl;
            }).catch(function() {});
        });
    }

    /* ── Movie: collection tab ──────────────────────────────── */

    function loadCollectionCalendar() {
        var container = document.getElementById('media-hunt-calendar-timeline');
        if (!container) return;
        container.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Loading calendar...</p></div>';

        var val = getInstanceValue();
        var p = parseInstanceValue(val);
        var pastDays = daysPastForCurrentMonth();
        var url;

        if (p.appType === 'movie_hunt' && p.instance) {
            url = './api/movie-hunt/calendar?days_past=' + pastDays + '&days_future=120&instance_id=' + encodeURIComponent(p.instance);
        } else if (p.appType === 'radarr' && p.instance) {
            url = './api/calendar?app_type=radarr&instance=' + encodeURIComponent(p.instance) + '&days_past=' + pastDays + '&days_future=120';
        } else {
            container.innerHTML = '<div class="mh-cal-empty"><i class="fas fa-calendar-times"></i><p>Select a Movie Hunt or Radarr instance.</p></div>';
            return;
        }

        fetch(url)
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (!data.success || !data.events || data.events.length === 0) {
                    container.innerHTML = '<div class="mh-cal-empty"><i class="fas fa-calendar-times"></i><p>No upcoming releases in your collection.<br>Add movies to your collection to see their release dates here.</p></div>';
                    return;
                }
                var dated = [], tba = [];
                for (var i = 0; i < data.events.length; i++) {
                    var ev = data.events[i];
                    if (ev.date) dated.push(ev); else tba.push(ev);
                }
                var groups = {}, dateOrder = [];
                for (var j = 0; j < dated.length; j++) {
                    var d = dated[j].date;
                    if (!groups[d]) { groups[d] = []; dateOrder.push(d); }
                    groups[d].push(dated[j]);
                }
                dateOrder.sort();
                var html = '';
                for (var m = 0; m < dateOrder.length; m++) html += renderDateGroup(dateOrder[m], groups[dateOrder[m]], true);
                if (tba.length > 0) {
                    html += '<div class="mh-cal-tba-section"><div class="mh-cal-tba-header"><i class="fas fa-question-circle"></i> Date TBA (' + tba.length + ' movie' + (tba.length > 1 ? 's' : '') + ')</div><div class="mh-cal-tba-events">';
                    for (var n = 0; n < tba.length; n++) html += renderMovieEventCard(tba[n]);
                    html += '</div></div>';
                }
                container.innerHTML = html;
                applyCacheToImages(container);
                _collectionLoaded = true;
            })
            .catch(function() {
                container.innerHTML = '<div class="mh-cal-empty"><i class="fas fa-exclamation-triangle"></i><p>Failed to load calendar data.</p></div>';
            });
    }

    /* ── Movie: upcoming tab ────────────────────────────────── */

    function loadUpcomingCalendar() {
        var container = document.getElementById('media-hunt-calendar-upcoming-timeline');
        if (!container) return;
        container.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Loading upcoming movies...</p></div>';

        fetch('./api/movie-hunt/calendar/upcoming?page=1')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (!data.success || !data.movies || data.movies.length === 0) {
                    container.innerHTML = '<div class="mh-cal-empty"><i class="fas fa-film"></i><p>No upcoming movies found.</p></div>';
                    return;
                }
                var groups = {}, dateOrder = [];
                for (var i = 0; i < data.movies.length; i++) {
                    var m = data.movies[i];
                    var d = m.release_date || '';
                    if (!d) continue;
                    if (!groups[d]) { groups[d] = []; dateOrder.push(d); }
                    groups[d].push({
                        title: m.title,
                        year: m.year,
                        poster_path: m.poster_path,
                        event_type: 'inCinemas',
                        event_label: 'Theatrical Release',
                        status: '',
                        minimum_availability: '',
                    });
                }
                dateOrder.sort();
                var html = '';
                for (var j = 0; j < dateOrder.length; j++) html += renderDateGroup(dateOrder[j], groups[dateOrder[j]], true);
                container.innerHTML = html;
                applyCacheToImages(container);
                _upcomingLoaded = true;
            })
            .catch(function() {
                container.innerHTML = '<div class="mh-cal-empty"><i class="fas fa-exclamation-triangle"></i><p>Failed to load upcoming movies.</p></div>';
            });
    }

    /* ── TV: single calendar from collection ─────────────────── */

    function loadTVCalendar() {
        var container = document.getElementById('media-hunt-calendar-timeline');
        if (!container) return;
        container.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Loading calendar...</p></div>';

        var val = getInstanceValue();
        var p = parseInstanceValue(val);
        if (!p.appType || !p.instance) {
            container.innerHTML = '<div class="mh-cal-empty"><i class="fas fa-calendar-times"></i><p>Select a TV Hunt or Sonarr instance to view the calendar.</p></div>';
            return;
        }

        if (p.appType === 'sonarr') {
            var pastDays = daysPastForCurrentMonth();
            fetch('./api/calendar?app_type=sonarr&instance=' + encodeURIComponent(p.instance) + '&days_past=' + pastDays + '&days_future=120')
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    var rawEvents = (data.events || []);
                    if (rawEvents.length === 0) {
                        container.innerHTML = '<div class="mh-cal-empty"><i class="fas fa-calendar-times"></i><p>No upcoming episodes in your Sonarr library.<br>Add TV shows to see episode air dates here.</p></div>';
                        return;
                    }
                    var groups = {}, dateOrder = [];
                    rawEvents.forEach(function(ev) {
                        var d = ev.date || '';
                        if (!groups[d]) { groups[d] = []; dateOrder.push(d); }
                        groups[d].push(ev);
                    });
                    dateOrder.sort();
                    var html = '';
                    dateOrder.forEach(function(d) { html += renderDateGroup(d, groups[d], false); });
                    container.innerHTML = html;
                })
                .catch(function() {
                    container.innerHTML = '<div class="mh-cal-empty"><i class="fas fa-exclamation-triangle"></i><p>Failed to load calendar data.</p></div>';
                });
            return;
        }

        fetch('./api/tv-hunt/collection?instance_id=' + p.instance)
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var series = data.series || [];
                var events = [];
                var now = new Date();
                var pastLimit = new Date();
                pastLimit.setDate(pastLimit.getDate() - 7);
                var futureLimit = new Date();
                futureLimit.setDate(futureLimit.getDate() + 90);

                series.forEach(function(s) {
                    (s.seasons || []).forEach(function(season) {
                        (season.episodes || []).forEach(function(ep) {
                            if (!ep.air_date) return;
                            var airDate = new Date(ep.air_date);
                            if (airDate < pastLimit || airDate > futureLimit) return;
                            events.push({
                                date: ep.air_date,
                                series_title: s.title,
                                series_poster: s.poster_path,
                                title: ep.title || ('Episode ' + ep.episode_number),
                                season_number: season.season_number,
                                episode_number: ep.episode_number,
                                status: ep.status || (airDate > now ? 'unaired' : 'missing'),
                                poster_path: s.poster_path,
                            });
                        });
                    });
                });

                if (events.length === 0) {
                    container.innerHTML = '<div class="mh-cal-empty"><i class="fas fa-calendar-times"></i><p>No upcoming episodes in your TV collection.<br>Add TV shows to see episode air dates here.</p></div>';
                    return;
                }
                var groups = {}, dateOrder = [];
                events.forEach(function(ev) {
                    if (!groups[ev.date]) { groups[ev.date] = []; dateOrder.push(ev.date); }
                    groups[ev.date].push(ev);
                });
                dateOrder.sort();
                var html = '';
                dateOrder.forEach(function(d) { html += renderDateGroup(d, groups[d], false); });
                container.innerHTML = html;
            })
            .catch(function() {
                container.innerHTML = '<div class="mh-cal-empty"><i class="fas fa-exclamation-triangle"></i><p>Failed to load calendar data.</p></div>';
            });
    }

    /* ── Tab switching (movie only) ──────────────────────────── */

    function switchTab(tab) {
        _currentTab = tab;
        var collView = document.getElementById('media-hunt-calendar-collection-view');
        var upView = document.getElementById('media-hunt-calendar-upcoming-view');
        var tabs = document.querySelectorAll('#mediaHuntCalendarSection .mh-calendar-tab');
        for (var i = 0; i < tabs.length; i++) {
            tabs[i].classList.toggle('active', tabs[i].getAttribute('data-tab') === tab);
        }
        if (tab === 'collection') {
            if (collView) collView.style.display = 'block';
            if (upView) upView.style.display = 'none';
            if (!_collectionLoaded) loadCollectionCalendar();
        } else {
            if (collView) collView.style.display = 'none';
            if (upView) upView.style.display = 'block';
            if (!_upcomingLoaded) loadUpcomingCalendar();
        }
    }

    function updateUIForMode(mode) {
        var titleEl = document.getElementById('media-hunt-calendar-title');
        var tabsWrap = document.getElementById('media-hunt-calendar-tabs-wrap');
        var legendEl = document.getElementById('media-hunt-calendar-legend');
        var upcomingView = document.getElementById('media-hunt-calendar-upcoming-view');
        if (titleEl) titleEl.innerHTML = (mode === 'movie' ? '<i class="fas fa-calendar-alt"></i> Upcoming Releases' : '<i class="fas fa-calendar-alt"></i> TV Calendar');
        if (tabsWrap) tabsWrap.style.display = (mode === 'movie') ? 'flex' : 'none';
        if (legendEl) legendEl.style.display = (mode === 'movie') ? 'flex' : 'none';
        if (upcomingView) upcomingView.style.display = 'none';
    }

    function populateInstanceDropdown() {
        var sel = document.getElementById('media-hunt-calendar-instance-select');
        if (!sel) return;
        sel.innerHTML = '<option value="">Loading instances...</option>';
        var ts = Date.now();
        Promise.all([
            fetch('./api/requestarr/instances/movie_hunt?t=' + ts, { cache: 'no-store' }).then(function(r) { return r.json(); }),
            fetch('./api/requestarr/instances/radarr?t=' + ts, { cache: 'no-store' }).then(function(r) { return r.json(); }),
            fetch('./api/requestarr/instances/tv_hunt?t=' + ts, { cache: 'no-store' }).then(function(r) { return r.json(); }),
            fetch('./api/requestarr/instances/sonarr?t=' + ts, { cache: 'no-store' }).then(function(r) { return r.json(); })
        ]).then(function(results) {
            var mh = results[0].instances || [];
            var radarr = results[1].instances || [];
            var tvh = results[2].instances || [];
            var sonarr = results[3].instances || [];
            sel.innerHTML = '';
            var defaultMode = (window._mediaHuntCalendarMode || 'movie').toLowerCase();
            var preferred = null;
            mh.forEach(function(inst) {
                var v = 'movie_hunt:' + (inst.id != null ? inst.id : inst.name);
                var opt = document.createElement('option');
                opt.value = v;
                opt.textContent = 'Movie Hunt \u2013 ' + (inst.name || inst.id);
                sel.appendChild(opt);
                if (!preferred && defaultMode === 'movie') preferred = v;
            });
            radarr.forEach(function(inst) {
                var v = 'radarr:' + (inst.name || '');
                var opt = document.createElement('option');
                opt.value = v;
                opt.textContent = 'Radarr \u2013 ' + (inst.name || '');
                sel.appendChild(opt);
                if (!preferred && defaultMode === 'movie') preferred = v;
            });
            tvh.forEach(function(inst) {
                var v = 'tv_hunt:' + (inst.id != null ? inst.id : inst.name);
                var opt = document.createElement('option');
                opt.value = v;
                opt.textContent = 'TV Hunt \u2013 ' + (inst.name || inst.id);
                sel.appendChild(opt);
                if (!preferred && defaultMode === 'tv') preferred = v;
            });
            sonarr.forEach(function(inst) {
                var v = 'sonarr:' + (inst.name || '');
                var opt = document.createElement('option');
                opt.value = v;
                opt.textContent = 'Sonarr \u2013 ' + (inst.name || '');
                sel.appendChild(opt);
                if (!preferred && defaultMode === 'tv') preferred = v;
            });
            if (sel.options.length === 0) {
                var empty = document.createElement('option');
                empty.value = '';
                empty.textContent = 'No instances configured';
                sel.appendChild(empty);
            } else if (preferred) {
                sel.value = preferred;
            } else if (sel.options.length) {
                sel.selectedIndex = 0;
            }
            _collectionLoaded = false;
            _upcomingLoaded = false;
            var mode = getMode();
            updateUIForMode(mode);
            if (mode === 'movie') {
                if (_currentTab === 'collection') loadCollectionCalendar();
                else loadUpcomingCalendar();
            } else {
                loadTVCalendar();
            }
        }).catch(function() {
            sel.innerHTML = '<option value="">Failed to load instances</option>';
        });
    }

    /* ── Init ────────────────────────────────────────────────── */

    function init() {
        var sel = document.getElementById('media-hunt-calendar-instance-select');
        if (!sel) return;
        populateInstanceDropdown();
        updateUIForMode(getMode());

        var onSelectChange = function() {
            _collectionLoaded = false;
            _upcomingLoaded = false;
            var mode = getMode();
            updateUIForMode(mode);
            if (mode === 'movie') {
                if (_currentTab === 'collection') loadCollectionCalendar();
                else loadUpcomingCalendar();
            } else {
                loadTVCalendar();
            }
        };

        sel.addEventListener('change', onSelectChange);

        if (!_initialized) {
            _initialized = true;
            var tabs = document.querySelectorAll('#mediaHuntCalendarSection .mh-calendar-tab');
            for (var i = 0; i < tabs.length; i++) {
                tabs[i].addEventListener('click', function() {
                    switchTab(this.getAttribute('data-tab'));
                });
            }
        }

        _collectionLoaded = false;
        _upcomingLoaded = false;
    }

    document.addEventListener('huntarr:instances-changed', function() { populateInstanceDropdown(); });
    document.addEventListener('huntarr:tv-hunt-instances-changed', function() { populateInstanceDropdown(); });

    window.MediaHuntCalendar = {
        init: init,
        refresh: function() {
            var mode = getMode();
            _collectionLoaded = false;
            _upcomingLoaded = false;
            if (mode === 'movie') {
                if (_currentTab === 'collection') loadCollectionCalendar();
                else loadUpcomingCalendar();
            } else {
                loadTVCalendar();
            }
        }
    };
})();


/* === modules/features/settings/media-hunt-custom-formats.js === */
/**
 * Media Hunt – Custom Formats for TV (Sonarr-style JSON). Pre-Format (dropdown) or Import (paste JSON).
 * File: media-hunt-custom-formats.js. Uses /api/tv-hunt/ endpoints; DOM IDs remain tv-hunt-* for compatibility.
 */
(function() {
    'use strict';

    window.TVHuntCustomFormats = {
        _list: [],
        _editingIndex: null,
        _modalMode: null,
        _instanceDropdownAttached: false,

        refreshList: function() {
            if (window.TVHuntInstanceDropdown && document.getElementById('tv-hunt-settings-custom-formats-instance-select') && !window.TVHuntCustomFormats._instanceDropdownAttached) {
                window.TVHuntInstanceDropdown.attach('tv-hunt-settings-custom-formats-instance-select', function() { window.TVHuntCustomFormats.refreshList(); });
                window.TVHuntCustomFormats._instanceDropdownAttached = true;
            }
            var preformattedGrid = document.getElementById('tv-hunt-custom-formats-preformatted-grid');
            var importedGrid = document.getElementById('tv-hunt-custom-formats-imported-grid');
            if (!preformattedGrid || !importedGrid) return;
            
            fetch('./api/tv-hunt/custom-formats')
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    var list = (data && data.custom_formats) ? data.custom_formats : [];
                    window.TVHuntCustomFormats._list = list;
                    
                    var preformattedByGroup = {};
                    var importedItems = [];
                    var preformattedCount = 0;
                    var importedCount = 0;
                    
                    for (var i = 0; i < list.length; i++) {
                        var item = list[i];
                        var isPreformatted = (item.source || 'import').toLowerCase() === 'preformat';
                        
                        if (isPreformatted) {
                            var preformatId = item.preformat_id || '';
                            var groupKey = window.TVHuntCustomFormats._getGroupFromPreformatId(preformatId);
                            if (!preformattedByGroup[groupKey]) {
                                preformattedByGroup[groupKey] = [];
                            }
                            preformattedByGroup[groupKey].push({item: item, index: i});
                            preformattedCount++;
                        } else {
                            importedItems.push({item: item, index: i});
                            importedCount++;
                        }
                    }
                    
                    var preformattedHtml = '';
                    var sortedGroups = Object.keys(preformattedByGroup).sort();
                    
                    for (var g = 0; g < sortedGroups.length; g++) {
                        var groupKey = sortedGroups[g];
                        var groupItems = preformattedByGroup[groupKey];
                        var groupName = window.TVHuntCustomFormats._formatGroupName(groupKey);
                        
                        preformattedHtml += '<div class="custom-formats-group-header">' +
                            '<i class="fas fa-folder-open"></i> ' + groupName +
                            '</div>';
                        
                        for (var j = 0; j < groupItems.length; j++) {
                            var entry = groupItems[j];
                            var item = entry.item;
                            var idx = entry.index;
                            var title = (item.title || item.name || 'Unnamed').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                            
                            preformattedHtml += '<div class="custom-format-card instance-card" data-index="' + idx + '" data-app-type="tv-hunt-custom-format">' +
                                '<div class="custom-format-card-header">' +
                                '<div class="custom-format-card-title"><i class="fas fa-code"></i><span>' + title + '</span></div>' +
                                '</div>' +
                                '<div class="custom-format-card-footer">' +
                                '<button type="button" class="btn-card view" data-index="' + idx + '"><i class="fas fa-eye"></i> JSON</button>' +
                                '<button type="button" class="btn-card delete" data-index="' + idx + '"><i class="fas fa-trash"></i> Delete</button>' +
                                '</div></div>';
                        }
                    }
                    
                    var importedHtml = '';
                    for (var k = 0; k < importedItems.length; k++) {
                        var entry = importedItems[k];
                        var item = entry.item;
                        var idx = entry.index;
                        var title = (item.title || item.name || 'Unnamed').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                        
                        importedHtml += '<div class="custom-format-card instance-card" data-index="' + idx + '" data-app-type="tv-hunt-custom-format">' +
                            '<div class="custom-format-card-header">' +
                            '<div class="custom-format-card-title"><i class="fas fa-code"></i><span>' + title + '</span></div>' +
                            '</div>' +
                            '<div class="custom-format-card-footer">' +
                            '<button type="button" class="btn-card view" data-index="' + idx + '"><i class="fas fa-eye"></i> JSON</button>' +
                            '<button type="button" class="btn-card edit" data-index="' + idx + '"><i class="fas fa-edit"></i> Edit</button>' +
                            '<button type="button" class="btn-card delete" data-index="' + idx + '"><i class="fas fa-trash"></i> Delete</button>' +
                            '</div></div>';
                    }
                    
                    preformattedGrid.innerHTML = preformattedHtml;
                    importedGrid.innerHTML = importedHtml;
                    
                    var deletePreBtn = document.getElementById('tv-hunt-delete-all-preformatted');
                    var deleteImpBtn = document.getElementById('tv-hunt-delete-all-imported');
                    if (deletePreBtn) deletePreBtn.disabled = preformattedCount === 0;
                    if (deleteImpBtn) deleteImpBtn.disabled = importedCount === 0;
                    
                    window.TVHuntCustomFormats._bindCards();
                })
                .catch(function() {
                    preformattedGrid.innerHTML = '';
                    importedGrid.innerHTML = '';
                    window.TVHuntCustomFormats._bindAddButtons();
                });
        },

        _getGroupFromPreformatId: function(preformatId) {
            if (!preformatId) return 'Other';
            var parts = preformatId.split('.');
            return parts[0] || 'Other';
        },

        _formatGroupName: function(groupKey) {
            if (!groupKey || groupKey === 'Other') return 'Other';
            var categoryNames = {
                'audio-formats': 'Audio Formats',
                'audio-channels': 'Audio Channels',
                'hdr-formats': 'HDR Formats',
                'hdr-optional': 'HDR Optional',
                'series-versions': 'Series Versions',
                'unwanted': 'Unwanted',
                'hq-source-groups': 'HQ Source Groups',
                'streaming-services-general': 'General Streaming Services',
                'streaming-services-french': 'French Streaming Services',
                'streaming-services-asian': 'Asian Streaming Services',
                'streaming-services-dutch': 'Dutch Streaming Services',
                'streaming-services-uk': 'UK Streaming Services',
                'streaming-services-misc': 'Misc Streaming Services',
                'streaming-services-anime': 'Anime Streaming Services',
                'streaming-services-optional': 'Optional Streaming Services',
                'miscellaneous': 'Miscellaneous',
                'language-profiles': 'Language Profiles',
                'anime-source-groups-bd': 'Anime Source Groups (BD)',
                'anime-source-groups-web': 'Anime Source Groups (Web)',
                'anime-misc': 'Anime Misc',
                'anime-optional': 'Anime Optional',
                'german-source-groups': 'German Source Groups',
                'german-miscellaneous': 'German Miscellaneous',
                'french-source-groups': 'French Source Groups',
                'french-audio-version': 'French Audio Version'
            };
            return categoryNames[groupKey] || groupKey.split('-').map(function(s) {
                return s.charAt(0).toUpperCase() + s.slice(1);
            }).join(' ');
        },

        _bindCards: function() {
            var container = document.getElementById('tvHuntSettingsCustomFormatsSection');
            if (!container) return;
            var allCards = container.querySelectorAll('.custom-format-card');
            allCards.forEach(function(card) {
                var viewBtn = card.querySelector('.btn-card.view');
                var editBtn = card.querySelector('.btn-card.edit');
                var deleteBtn = card.querySelector('.btn-card.delete');
                
                if (viewBtn) {
                    viewBtn.onclick = function(e) {
                        e.stopPropagation();
                        var idx = parseInt(viewBtn.getAttribute('data-index'), 10);
                        if (!isNaN(idx)) window.TVHuntCustomFormats.openViewModal(idx);
                    };
                }
                if (editBtn) {
                    editBtn.onclick = function(e) {
                        e.stopPropagation();
                        var idx = parseInt(editBtn.getAttribute('data-index'), 10);
                        if (!isNaN(idx)) window.TVHuntCustomFormats.openEditModal(idx);
                    };
                }
                if (deleteBtn) {
                    deleteBtn.onclick = function(e) {
                        e.stopPropagation();
                        var idx = parseInt(deleteBtn.getAttribute('data-index'), 10);
                        if (!isNaN(idx)) window.TVHuntCustomFormats.deleteFormat(idx);
                    };
                }
            });
            window.TVHuntCustomFormats._bindAddButtons();
        },

        _bindAddButtons: function() {
            var addPreformattedBtn = document.getElementById('tv-hunt-add-preformatted-btn');
            var addImportedBtn = document.getElementById('tv-hunt-add-imported-btn');
            if (addPreformattedBtn) {
                addPreformattedBtn.onclick = function() { 
                    window.TVHuntCustomFormats.openAddModal('preformat'); 
                };
            }
            if (addImportedBtn) {
                addImportedBtn.onclick = function() { 
                    window.TVHuntCustomFormats.openAddModal('import'); 
                };
            }
        },

        openViewModal: function(index) {
            var list = window.TVHuntCustomFormats._list;
            if (index < 0 || index >= list.length) return;
            window.TVHuntCustomFormats._ensureViewModalInBody();
            var item = list[index];
            var title = (item.title || item.name || 'Unnamed');
            document.getElementById('tv-hunt-custom-format-view-modal-title').textContent = 'View JSON: ' + title;
            var jsonStr = item.custom_format_json || '{}';
            try {
                var parsed = JSON.parse(jsonStr);
                jsonStr = JSON.stringify(parsed, null, 2);
            } catch (e) { /* show as-is */ }
            document.getElementById('tv-hunt-custom-format-view-json').textContent = jsonStr;
            document.getElementById('tv-hunt-custom-format-view-modal').style.display = 'flex';
            document.body.classList.add('custom-format-modal-open');
        },

        closeViewModal: function() {
            var modal = document.getElementById('tv-hunt-custom-format-view-modal');
            if (modal) modal.style.display = 'none';
            document.body.classList.remove('custom-format-modal-open');
        },

        _generateRandomSuffix: function() {
            var chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
            var suffix = '';
            for (var i = 0; i < 4; i++) {
                suffix += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            return suffix;
        },

        _checkTitleCollision: function(title) {
            var list = window.TVHuntCustomFormats._list || [];
            var preformattedTitles = {};
            for (var i = 0; i < list.length; i++) {
                if ((list[i].source || 'import').toLowerCase() === 'preformat') {
                    var t = (list[i].title || list[i].name || '').toLowerCase();
                    if (t) preformattedTitles[t] = true;
                }
            }
            var lowerTitle = title.toLowerCase();
            if (preformattedTitles[lowerTitle]) {
                return title + '-' + window.TVHuntCustomFormats._generateRandomSuffix();
            }
            return title;
        },

        _ensureAddModalInBody: function() {
            var modal = document.getElementById('tv-hunt-custom-format-modal');
            if (modal && modal.parentNode !== document.body) {
                document.body.appendChild(modal);
            }
        },
        _ensureViewModalInBody: function() {
            var modal = document.getElementById('tv-hunt-custom-format-view-modal');
            if (modal && modal.parentNode !== document.body) {
                document.body.appendChild(modal);
            }
        },

        openAddModal: function(source) {
            window.TVHuntCustomFormats._editingIndex = null;
            window.TVHuntCustomFormats._modalMode = source;
            window.TVHuntCustomFormats._ensureAddModalInBody();

            if (source === 'preformat') {
                document.getElementById('tv-hunt-custom-format-modal-title').textContent = 'Add Pre-Formatted';
                document.getElementById('tv-hunt-custom-format-preformat-area').style.display = 'block';
                var importArea = document.getElementById('tv-hunt-custom-format-import-area');
                if (importArea) importArea.style.display = 'none';
                window.TVHuntCustomFormats._loadPreformatTree();
            } else {
                document.getElementById('tv-hunt-custom-format-modal-title').textContent = 'Add Imported';
                document.getElementById('tv-hunt-custom-format-preformat-area').style.display = 'none';
                var importArea = document.getElementById('tv-hunt-custom-format-import-area');
                if (importArea) importArea.style.display = 'block';
            }

            document.getElementById('tv-hunt-custom-format-modal-save').innerHTML = '<i class="fas fa-plus"></i> Add';
            document.getElementById('tv-hunt-custom-format-json-textarea').value = '';
            document.getElementById('tv-hunt-custom-format-modal').style.display = 'flex';
            document.body.classList.add('custom-format-modal-open');
        },

        openEditModal: function(index) {
            var list = window.TVHuntCustomFormats._list;
            if (index < 0 || index >= list.length) return;
            window.TVHuntCustomFormats._ensureAddModalInBody();
            window.TVHuntCustomFormats._editingIndex = index;
            var item = list[index];
            document.getElementById('tv-hunt-custom-format-modal-title').textContent = 'Edit Custom Format';
            document.getElementById('tv-hunt-custom-format-modal-save').innerHTML = '<i class="fas fa-save"></i> Save';
            document.getElementById('tv-hunt-custom-format-source-import').checked = true;
            document.getElementById('tv-hunt-custom-format-preformat-area').style.display = 'none';
            var importArea = document.getElementById('tv-hunt-custom-format-import-area');
            if (importArea) importArea.style.display = 'block';
            document.getElementById('tv-hunt-custom-format-json-textarea').value = item.custom_format_json || '{}';
            document.getElementById('tv-hunt-custom-format-modal').style.display = 'flex';
            document.body.classList.add('custom-format-modal-open');
        },

        closeModal: function() {
            var modal = document.getElementById('tv-hunt-custom-format-modal');
            if (modal) modal.style.display = 'none';
            document.body.classList.remove('custom-format-modal-open');
        },

        _buildPreformatId: function(catId, subId, fmtId) {
            if (subId) return catId + '.' + subId + '.' + fmtId;
            return catId + '.' + fmtId;
        },

        _loadPreformatTree: function() {
            var treeEl = document.getElementById('tv-hunt-custom-format-preformat-tree');
            if (!treeEl) return;
            treeEl.innerHTML = '<span class="custom-format-loading">Loading\u2026</span>';
            var existingIds = {};
            (window.TVHuntCustomFormats._list || []).forEach(function(item) {
                if (item.preformat_id) existingIds[item.preformat_id] = true;
            });
            fetch('./api/tv-hunt/custom-formats/preformats')
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    var categories = (data && data.categories) ? data.categories : [];
                    treeEl.innerHTML = '';
                    if (categories.length === 0) {
                        var msg = document.createElement('div');
                        msg.className = 'custom-format-preformat-empty';
                        msg.innerHTML = 'Pre-formatted list is not available on this server. You can still add formats via <strong>Import</strong> by pasting JSON from <a href="https://trash-guides.info/Sonarr/sonarr-collection-of-custom-formats/" target="_blank" rel="noopener">TRaSH Guides (Sonarr)</a>.';
                        treeEl.appendChild(msg);
                        return;
                    }
                    categories.forEach(function(cat) {
                        var catId = cat.id || '';
                        var catName = cat.name || catId;
                        var catDiv = document.createElement('div');
                        catDiv.className = 'custom-format-cat';
                        var header = document.createElement('div');
                        header.className = 'custom-format-cat-header';
                        header.innerHTML = '<i class="fas fa-chevron-down"></i><span>' + (catName.replace(/</g, '&lt;').replace(/>/g, '&gt;')) + '</span>';
                        var body = document.createElement('div');
                        body.className = 'custom-format-cat-body';
                        var subcats = cat.subcategories || [];
                        if (subcats.length > 0) {
                            subcats.forEach(function(sub) {
                                var subId = sub.id || '';
                                var subName = sub.name || subId;
                                var subDiv = document.createElement('div');
                                subDiv.className = 'custom-format-subcat';
                                var subLabel = document.createElement('div');
                                subLabel.className = 'custom-format-subcat-name';
                                subLabel.textContent = subName;
                                subDiv.appendChild(subLabel);
                                var fmtList = document.createElement('div');
                                fmtList.className = 'custom-format-format-list';
                                (sub.formats || []).forEach(function(fmt) {
                                    var fid = window.TVHuntCustomFormats._buildPreformatId(catId, subId, fmt.id || '');
                                    var name = fmt.name || fid;
                                    var already = existingIds[fid];
                                    var label = document.createElement('label');
                                    label.className = 'custom-format-format-item';
                                    var cb = document.createElement('input');
                                    cb.type = 'checkbox';
                                    cb.setAttribute('data-preformat-id', fid);
                                    cb.setAttribute('data-format-name', name);
                                    if (already) { cb.checked = true; cb.disabled = true; }
                                    label.appendChild(cb);
                                    label.appendChild(document.createElement('span')).textContent = name;
                                    fmtList.appendChild(label);
                                });
                                subDiv.appendChild(fmtList);
                                body.appendChild(subDiv);
                            });
                        } else {
                            var fmtList = document.createElement('div');
                            fmtList.className = 'custom-format-format-list';
                            (cat.formats || []).forEach(function(fmt) {
                                var fid = window.TVHuntCustomFormats._buildPreformatId(catId, null, fmt.id || '');
                                var name = fmt.name || fid;
                                var already = existingIds[fid];
                                var label = document.createElement('label');
                                label.className = 'custom-format-format-item';
                                var cb = document.createElement('input');
                                cb.type = 'checkbox';
                                cb.setAttribute('data-preformat-id', fid);
                                cb.setAttribute('data-format-name', name);
                                if (already) { cb.checked = true; cb.disabled = true; }
                                label.appendChild(cb);
                                label.appendChild(document.createElement('span')).textContent = name;
                                fmtList.appendChild(label);
                            });
                            body.appendChild(fmtList);
                        }
                        header.onclick = function() {
                            header.classList.toggle('collapsed');
                            body.classList.toggle('collapsed');
                        };
                        catDiv.appendChild(header);
                        catDiv.appendChild(body);
                        treeEl.appendChild(catDiv);
                    });
                })
                .catch(function() {
                    treeEl.innerHTML = '<span class="custom-format-loading" style="color:#f87171;">Failed to load formats.</span>';
                });
        },

        _nameFromJson: function(str) {
            if (!str || typeof str !== 'string') return '\u2014';
            try {
                var obj = JSON.parse(str);
                return (obj && obj.name != null) ? String(obj.name).trim() || '\u2014' : '\u2014';
            } catch (e) { return '\u2014'; }
        },

        _onSourceChange: function() {
            var isPre = document.getElementById('tv-hunt-custom-format-source-preformat').checked;
            var preformatArea = document.getElementById('tv-hunt-custom-format-preformat-area');
            var importArea = document.getElementById('tv-hunt-custom-format-import-area');
            var jsonTa = document.getElementById('tv-hunt-custom-format-json-textarea');
            if (preformatArea) preformatArea.style.display = isPre ? 'block' : 'none';
            if (importArea) importArea.style.display = isPre ? 'none' : 'block';
            if (isPre) {
                if (jsonTa) jsonTa.value = '';
                window.TVHuntCustomFormats._loadPreformatTree();
            } else {
                if (window.TVHuntCustomFormats._editingIndex != null) {
                    var list = window.TVHuntCustomFormats._list;
                    var idx = window.TVHuntCustomFormats._editingIndex;
                    if (list && idx >= 0 && idx < list.length && jsonTa) {
                        jsonTa.value = list[idx].custom_format_json || '{}';
                    }
                } else if (jsonTa) {
                    jsonTa.value = '';
                }
            }
        },

        saveModal: function() {
            var editing = window.TVHuntCustomFormats._editingIndex;

            if (editing != null) {
                var jsonRaw = document.getElementById('tv-hunt-custom-format-json-textarea').value.trim();
                if (!jsonRaw) {
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification('Paste valid JSON to edit.', 'error');
                    }
                    return;
                }
                try { JSON.parse(jsonRaw); } catch (e) {
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification('Invalid JSON.', 'error');
                    }
                    return;
                }
                var title = window.TVHuntCustomFormats._nameFromJson(jsonRaw);
                if (title === '\u2014') title = 'Unnamed';
                fetch('./api/tv-hunt/custom-formats/' + editing, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title: title, custom_format_json: jsonRaw })
                })
                    .then(function(r) { return r.json(); })
                    .then(function(data) {
                        if (data.success) {
                            if (window.huntarrUI && window.huntarrUI.showNotification) {
                                window.huntarrUI.showNotification('Custom format updated.', 'success');
                            }
                            window.TVHuntCustomFormats.closeModal();
                            window.TVHuntCustomFormats.refreshList();
                        } else {
                            if (window.huntarrUI && window.huntarrUI.showNotification) {
                                window.huntarrUI.showNotification(data.message || data.error || 'Update failed', 'error');
                            }
                        }
                    })
                    .catch(function() {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification('Update failed', 'error');
                        }
                    });
                return;
            }

            var isPre = window.TVHuntCustomFormats._modalMode === 'preformat';
            if (isPre) {
                var tree = document.getElementById('tv-hunt-custom-format-preformat-tree');
                var checkboxes = tree ? tree.querySelectorAll('input[type="checkbox"][data-preformat-id]:checked:not(:disabled)') : [];
                var toAdd = [];
                checkboxes.forEach(function(cb) {
                    toAdd.push({ id: cb.getAttribute('data-preformat-id'), name: cb.getAttribute('data-format-name') || cb.getAttribute('data-preformat-id') });
                });
                if (toAdd.length === 0) {
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification('Check at least one format to add.', 'error');
                    }
                    return;
                }
                var done = 0;
                var failed = 0;
                var currentIndex = 0;
                
                function addNext() {
                    if (currentIndex >= toAdd.length) {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            if (failed === 0) {
                                window.huntarrUI.showNotification('Added ' + done + ' format(s).', 'success');
                            } else {
                                window.huntarrUI.showNotification('Added ' + done + ', failed ' + failed + '.', failed ? 'error' : 'success');
                            }
                        }
                        window.TVHuntCustomFormats.closeModal();
                        window.TVHuntCustomFormats.refreshList();
                        return;
                    }
                    
                    var item = toAdd[currentIndex];
                    currentIndex++;
                    
                    fetch('./api/tv-hunt/custom-formats', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ source: 'preformat', preformat_id: item.id, title: item.name })
                    })
                        .then(function(r) { return r.json(); })
                        .then(function(data) {
                            if (data.success) done++; else failed++;
                            addNext();
                        })
                        .catch(function() {
                            failed++;
                            addNext();
                        });
                }
                
                addNext();
                return;
            }
            var jsonRaw = document.getElementById('tv-hunt-custom-format-json-textarea').value.trim();
            if (!jsonRaw) {
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('Paste Custom Format JSON.', 'error');
                }
                return;
            }
            try { JSON.parse(jsonRaw); } catch (e) {
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('Invalid JSON.', 'error');
                }
                return;
            }
            var title = window.TVHuntCustomFormats._nameFromJson(jsonRaw);
            if (title === '\u2014') title = 'Unnamed';
            title = window.TVHuntCustomFormats._checkTitleCollision(title);
            var body = { source: 'import', custom_format_json: jsonRaw, title: title };

            fetch('./api/tv-hunt/custom-formats', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.success) {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification('Custom format added.', 'success');
                        }
                        window.TVHuntCustomFormats.closeModal();
                        window.TVHuntCustomFormats.refreshList();
                    } else {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification(data.message || data.error || 'Add failed', 'error');
                        }
                    }
                })
                .catch(function() {
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification('Add failed', 'error');
                    }
                });
        },

        deleteFormat: function(index) {
            var doDelete = function() {
                fetch('./api/tv-hunt/custom-formats/' + index, { method: 'DELETE' })
                    .then(function(r) { return r.json(); })
                    .then(function(data) {
                        if (data.success) {
                            if (window.huntarrUI && window.huntarrUI.showNotification) {
                                window.huntarrUI.showNotification('Custom format removed.', 'success');
                            }
                            window.TVHuntCustomFormats.refreshList();
                        } else {
                            if (window.huntarrUI && window.huntarrUI.showNotification) {
                                window.huntarrUI.showNotification(data.message || 'Delete failed', 'error');
                            }
                        }
                    })
                    .catch(function() {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification('Delete failed', 'error');
                        }
                    });
            };
            if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
                window.HuntarrConfirm.show({
                    title: 'Remove Custom Format',
                    message: 'Remove this custom format?',
                    confirmLabel: 'Remove',
                    onConfirm: doDelete
                });
            } else {
                doDelete();
            }
        },

        deleteAllByType: function(type) {
            var list = window.TVHuntCustomFormats._list || [];
            var toDelete = [];
            
            for (var i = 0; i < list.length; i++) {
                var item = list[i];
                var isPreformatted = (item.source || 'import').toLowerCase() === 'preformat';
                if ((type === 'preformat' && isPreformatted) || (type === 'import' && !isPreformatted)) {
                    toDelete.push(i);
                }
            }
            
            if (toDelete.length === 0) {
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('No formats to delete.', 'info');
                }
                return;
            }
            
            var typeName = type === 'preformat' ? 'pre-formatted' : 'imported';
            var confirmMsg = 'Delete all ' + toDelete.length + ' ' + typeName + ' custom format(s)?\n\nThis action cannot be undone.';
            var deleted = 0;
            var failed = 0;

            function runDeleteAll() {
                var currentIndex = toDelete.length - 1;
                deleted = 0;
                failed = 0;
                
                function deleteNext() {
                    if (currentIndex < 0) {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            if (failed === 0) {
                                window.huntarrUI.showNotification('Deleted ' + deleted + ' format(s).', 'success');
                            } else {
                                window.huntarrUI.showNotification('Deleted ' + deleted + ', failed ' + failed + '.', failed > 0 ? 'error' : 'success');
                            }
                        }
                        window.TVHuntCustomFormats.refreshList();
                        return;
                    }
                    
                    var idx = toDelete[currentIndex];
                    currentIndex--;
                    
                    fetch('./api/tv-hunt/custom-formats/' + idx, { method: 'DELETE' })
                        .then(function(r) { return r.json(); })
                        .then(function(data) {
                            if (data.success) deleted++; else failed++;
                            deleteNext();
                        })
                        .catch(function() {
                            failed++;
                            deleteNext();
                        });
                }
                
                deleteNext();
            }

            if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
                window.HuntarrConfirm.show({
                    title: 'Delete All ' + typeName.charAt(0).toUpperCase() + typeName.slice(1) + ' Custom Formats',
                    message: confirmMsg,
                    confirmLabel: 'Delete All',
                    onConfirm: runDeleteAll
                });
            } else {
                runDeleteAll();
            }
        },

        init: function() {
            var self = window.TVHuntCustomFormats;
            var modal = document.getElementById('tv-hunt-custom-format-modal');
            var backdrop = document.getElementById('tv-hunt-custom-format-modal-backdrop');
            var closeBtn = document.getElementById('tv-hunt-custom-format-modal-close');
            var cancelBtn = document.getElementById('tv-hunt-custom-format-modal-cancel');
            var saveBtn = document.getElementById('tv-hunt-custom-format-modal-save');
            if (backdrop) backdrop.onclick = function() { self.closeModal(); };
            if (closeBtn) closeBtn.onclick = function() { self.closeModal(); };
            if (cancelBtn) cancelBtn.onclick = function() { self.closeModal(); };
            if (saveBtn) saveBtn.onclick = function() { self.saveModal(); };
            
            var viewModal = document.getElementById('tv-hunt-custom-format-view-modal');
            var viewBackdrop = document.getElementById('tv-hunt-custom-format-view-modal-backdrop');
            var viewCloseBtn = document.getElementById('tv-hunt-custom-format-view-modal-close');
            var viewCloseBtnFooter = document.getElementById('tv-hunt-custom-format-view-modal-close-btn');
            if (viewBackdrop) viewBackdrop.onclick = function() { self.closeViewModal(); };
            if (viewCloseBtn) viewCloseBtn.onclick = function() { self.closeViewModal(); };
            if (viewCloseBtnFooter) viewCloseBtnFooter.onclick = function() { self.closeViewModal(); };
            
            var deleteAllPreBtn = document.getElementById('tv-hunt-delete-all-preformatted');
            var deleteAllImpBtn = document.getElementById('tv-hunt-delete-all-imported');
            if (deleteAllPreBtn) {
                deleteAllPreBtn.onclick = function() { self.deleteAllByType('preformat'); };
            }
            if (deleteAllImpBtn) {
                deleteAllImpBtn.onclick = function() { self.deleteAllByType('import'); };
            }
            
            document.querySelectorAll('input[name="tv-hunt-custom-format-source"]').forEach(function(radio) {
                radio.onchange = function() { self._onSourceChange(); };
            });
            
            document.addEventListener('keydown', function(e) {
                if (e.key === 'Escape') {
                    if (viewModal && viewModal.style.display === 'flex') {
                        self.closeViewModal();
                    } else if (modal && modal.style.display === 'flex') {
                        self.closeModal();
                    }
                }
            });
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() { window.TVHuntCustomFormats.init(); });
    } else {
        window.TVHuntCustomFormats.init();
    }
})();


/* === modules/features/settings/media-hunt-root-folders.js === */
/**
 * Media Hunt – Root Folders for TV. File: media-hunt-root-folders.js.
 * Card grid, add via modal, browse, test, set default, delete. Uses /api/tv-hunt/root-folders; DOM IDs remain tv-hunt-*.
 */
(function() {
    'use strict';

    window.TVHuntRootFolders = {
        _browseTargetInput: null,

        refreshList: function() {
            if (window.TVHuntInstanceDropdown && document.getElementById('tv-hunt-settings-root-folders-instance-select') && !window.TVHuntRootFolders._instanceDropdownAttached) {
                window.TVHuntInstanceDropdown.attach('tv-hunt-settings-root-folders-instance-select', function() {
                    if (window.TVHuntRootFolders.refreshList) window.TVHuntRootFolders.refreshList();
                });
                window.TVHuntRootFolders._instanceDropdownAttached = true;
            }
            var gridEl = document.getElementById('tv-hunt-root-folders-grid');
            if (!gridEl) return;
            fetch('./api/tv-hunt/root-folders', { cache: 'no-store' })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    var folders = (data && data.root_folders) ? data.root_folders : [];
                    folders = folders.slice().sort(function(a, b) {
                        if (a.is_default) return -1;
                        if (b.is_default) return 1;
                        return 0;
                    });
                    var html = '';
                    for (var i = 0; i < folders.length; i++) {
                        var path = (folders[i].path || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
                        var freeSpace = folders[i].freeSpace;
                        var spaceLabel = (freeSpace != null && !isNaN(freeSpace)) ? Math.round(freeSpace / 1e9) + ' GB free' : '';
                        var idx = folders[i].index !== undefined ? folders[i].index : i;
                        var isDefault = !!folders[i].is_default;
                        var showSetDefault = folders.length > 1 && !isDefault;
                        var defaultClass = isDefault ? ' default-root-folder' : '';
                        html += '<div class="root-folder-card instance-card' + defaultClass + '" data-index="' + idx + '" data-app-type="tv-hunt-root-folder">' +
                            '<div class="root-folder-card-header">' +
                            '<div class="root-folder-card-path">' +
                            '<i class="fas fa-folder"></i>' +
                            '<span>' + path + '</span>' +
                            (isDefault ? '<span class="root-folder-default-badge">Default</span>' : '') +
                            '</div></div>' +
                            '<div class="root-folder-card-body">' +
                            (spaceLabel ? '<span class="root-folder-free-space">' + spaceLabel + '</span>' : '') +
                            '</div>' +
                            '<div class="root-folder-card-footer">' +
                            '<button type="button" class="btn-card" data-index="' + idx + '" data-path="' + (folders[i].path || '').replace(/"/g, '&quot;') + '" data-action="test"><i class="fas fa-vial"></i> Test</button>' +
                            (showSetDefault ? '<button type="button" class="btn-card set-default" data-index="' + idx + '" data-action="set-default"><i class="fas fa-star"></i> Default</button>' : '') +
                            '<button type="button" class="btn-card delete" data-index="' + idx + '" data-action="delete"><i class="fas fa-trash"></i> Delete</button>' +
                            '</div></div>';
                    }
                    html += '<div class="add-instance-card add-root-folder-card" id="tv-hunt-root-folders-add-card" data-app-type="tv-hunt-root-folder">' +
                        '<div class="add-icon"><i class="fas fa-plus-circle"></i></div>' +
                        '<div class="add-text">Add Root Folder</div></div>';
                    gridEl.innerHTML = html;
                    window.TVHuntRootFolders._bindCardButtons();
                })
                .catch(function() {
                    var addCard = '<div class="add-instance-card add-root-folder-card" id="tv-hunt-root-folders-add-card" data-app-type="tv-hunt-root-folder">' +
                        '<div class="add-icon"><i class="fas fa-plus-circle"></i></div>' +
                        '<div class="add-text">Add Root Folder</div></div>';
                    gridEl.innerHTML = '<p style="color: #ef4444; margin: 0 0 12px 0;">Failed to load TV Hunt root folders.</p>' + addCard;
                    window.TVHuntRootFolders._bindAddCard();
                });
        },

        _bindCardButtons: function() {
            var gridEl = document.getElementById('tv-hunt-root-folders-grid');
            if (!gridEl) return;
            gridEl.querySelectorAll('.root-folder-card [data-action="test"]').forEach(function(btn) {
                btn.onclick = function() {
                    var path = btn.getAttribute('data-path') || '';
                    if (path) window.TVHuntRootFolders.testPath(path);
                };
            });
            gridEl.querySelectorAll('.root-folder-card [data-action="set-default"]').forEach(function(btn) {
                btn.onclick = function() {
                    var idx = parseInt(btn.getAttribute('data-index'), 10);
                    if (!isNaN(idx)) window.TVHuntRootFolders.setDefault(idx);
                };
            });
            gridEl.querySelectorAll('.root-folder-card [data-action="delete"]').forEach(function(btn) {
                btn.onclick = function() {
                    var idx = parseInt(btn.getAttribute('data-index'), 10);
                    if (!isNaN(idx)) window.TVHuntRootFolders.deleteFolder(idx);
                };
            });
            window.TVHuntRootFolders._bindAddCard();
        },

        _bindAddCard: function() {
            var addCard = document.getElementById('tv-hunt-root-folders-add-card');
            if (addCard) {
                addCard.onclick = function() { window.TVHuntRootFolders.openAddModal(); };
            }
        },

        openAddModal: function() {
            var modal = document.getElementById('tv-hunt-root-folder-add-modal');
            var input = document.getElementById('tv-hunt-root-folder-add-path');
            if (modal && modal.parentNode !== document.body) {
                document.body.appendChild(modal);
            }
            if (modal) modal.style.display = 'flex';
            if (input) {
                input.value = '';
                setTimeout(function() { input.focus(); }, 100);
            }
            document.body.classList.add('tv-hunt-root-folder-add-modal-open');
        },

        closeAddModal: function() {
            var modal = document.getElementById('tv-hunt-root-folder-add-modal');
            if (modal) modal.style.display = 'none';
            document.body.classList.remove('tv-hunt-root-folder-add-modal-open');
        },

        setDefault: function(index) {
            if (typeof index !== 'number' || index < 0) return;
            fetch('./api/tv-hunt/root-folders/' + index + '/default', { method: 'PATCH' })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.success) {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification('Default TV Hunt root folder updated.', 'success');
                        }
                        window.TVHuntRootFolders.refreshList();
                    } else {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification(data.message || 'Failed to set default.', 'error');
                        }
                    }
                })
                .catch(function(err) {
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification(err.message || 'Failed to set default.', 'error');
                    }
                });
        },

        testPath: function(path) {
            if (!path || (typeof path !== 'string')) {
                var addInput = document.getElementById('tv-hunt-root-folder-add-path');
                path = addInput ? (addInput.value || '').trim() : '';
            } else {
                path = String(path).trim();
            }
            if (!path) {
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('Enter a path to test', 'error');
                }
                return;
            }
            var testBtn = document.getElementById('tv-hunt-root-folder-add-test-btn');
            if (testBtn) {
                testBtn.disabled = true;
                testBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Testing...';
            }
            fetch('./api/tv-hunt/root-folders/test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: path })
            })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (testBtn) {
                        testBtn.disabled = false;
                        testBtn.innerHTML = '<i class="fas fa-vial"></i> Test';
                    }
                    if (data.success) {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification(data.message || 'Write and read test passed.', 'success');
                        }
                    } else {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification(data.message || 'Test failed', 'error');
                        }
                    }
                })
                .catch(function(err) {
                    if (testBtn) {
                        testBtn.disabled = false;
                        testBtn.innerHTML = '<i class="fas fa-vial"></i> Test';
                    }
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification(err.message || 'Test failed', 'error');
                    }
                });
        },

        addFolder: function() {
            var input = document.getElementById('tv-hunt-root-folder-add-path');
            var path = input ? (input.value || '').trim() : '';
            if (!path) {
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('Enter a path', 'error');
                }
                return;
            }
            var saveBtn = document.getElementById('tv-hunt-root-folder-add-modal-save');
            if (saveBtn) {
                saveBtn.disabled = true;
                saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Adding...';
            }
            fetch('./api/tv-hunt/root-folders', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: path })
            })
                .then(function(r) { return r.json().then(function(data) { return { ok: r.ok, data: data }; }); })
                .then(function(result) {
                    if (saveBtn) {
                        saveBtn.disabled = false;
                        saveBtn.innerHTML = '<i class="fas fa-plus"></i> Add';
                    }
                    if (result.ok && result.data && result.data.success) {
                        if (input) input.value = '';
                        window.TVHuntRootFolders.closeAddModal();
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification('TV Hunt root folder added.', 'success');
                        }
                        window.TVHuntRootFolders.refreshList();
                    } else {
                        var msg = (result.data && result.data.message) ? result.data.message : 'Add failed';
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification(msg, 'error');
                        }
                    }
                })
                .catch(function(err) {
                    if (saveBtn) {
                        saveBtn.disabled = false;
                        saveBtn.innerHTML = '<i class="fas fa-plus"></i> Add';
                    }
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification(err.message || 'Add failed', 'error');
                    }
                });
        },

        deleteFolder: function(index) {
            if (typeof index !== 'number' || index < 0) return;
            var deleteUrl = './api/tv-hunt/root-folders/' + index;
            var doDelete = function() {
                fetch(deleteUrl, { method: 'DELETE' })
                    .then(function(r) { return r.json(); })
                    .then(function(data) {
                        if (data.success) {
                            if (window.huntarrUI && window.huntarrUI.showNotification) {
                                window.huntarrUI.showNotification('TV Hunt root folder removed.', 'success');
                            }
                            window.TVHuntRootFolders.refreshList();
                        } else {
                            if (window.huntarrUI && window.huntarrUI.showNotification) {
                                window.huntarrUI.showNotification(data.message || 'Delete failed', 'error');
                            }
                        }
                    })
                    .catch(function(err) {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification(err.message || 'Delete failed', 'error');
                        }
                    });
            };
            if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
                window.HuntarrConfirm.show({
                    title: 'Remove Root Folder',
                    message: 'Remove this TV Hunt root folder?',
                    confirmLabel: 'OK',
                    onConfirm: doDelete
                });
            } else {
                if (!confirm('Remove this TV Hunt root folder?')) return;
                doDelete();
            }
        },

        openBrowseModal: function(sourceInput) {
            var modal = document.getElementById('tv-hunt-root-folders-browse-modal');
            var browsePathInput = document.getElementById('tv-hunt-root-folders-browse-path-input');
            window.TVHuntRootFolders._browseTargetInput = sourceInput || document.getElementById('tv-hunt-root-folder-add-path');
            if (!modal || !browsePathInput) return;
            if (modal.parentNode !== document.body) {
                document.body.appendChild(modal);
            }
            var startPath = (window.TVHuntRootFolders._browseTargetInput && window.TVHuntRootFolders._browseTargetInput.value) ? window.TVHuntRootFolders._browseTargetInput.value.trim() : '/';
            if (!startPath) startPath = '/';
            browsePathInput.value = startPath;
            modal.style.display = 'flex';
            document.body.classList.add('tv-hunt-root-folders-browse-modal-open');
            window.TVHuntRootFolders.loadBrowsePath(startPath);
        },

        closeBrowseModal: function() {
            var modal = document.getElementById('tv-hunt-root-folders-browse-modal');
            if (modal) {
                modal.style.display = 'none';
                document.body.classList.remove('tv-hunt-root-folders-browse-modal-open');
            }
        },

        confirmBrowseSelection: function() {
            var pathInput = document.getElementById('tv-hunt-root-folders-browse-path-input');
            var target = window.TVHuntRootFolders._browseTargetInput || document.getElementById('tv-hunt-root-folder-add-path');
            if (pathInput && target) {
                target.value = (pathInput.value || '').trim();
            }
            window.TVHuntRootFolders.closeBrowseModal();
        },

        goToParent: function() {
            var pathInput = document.getElementById('tv-hunt-root-folders-browse-path-input');
            if (!pathInput) return;
            var path = (pathInput.value || '').trim() || '/';
            var parent = path.replace(/\/+$/, '').split('/').slice(0, -1).join('/') || '/';
            if (parent === path) return;
            window.TVHuntRootFolders.loadBrowsePath(parent);
        },

        loadBrowsePath: function(path) {
            var listEl = document.getElementById('tv-hunt-root-folders-browse-list');
            var pathInput = document.getElementById('tv-hunt-root-folders-browse-path-input');
            var upBtn = document.getElementById('tv-hunt-root-folders-browse-up');
            if (!listEl || !pathInput) return;
            path = (path || pathInput.value || '/').trim() || '/';
            pathInput.value = path;
            if (upBtn) {
                var parent = path.replace(/\/+$/, '').split('/').slice(0, -1).join('/') || '/';
                upBtn.disabled = (parent === path || path === '/' || path === '');
            }
            listEl.innerHTML = '<div style="padding: 16px; color: #94a3b8;"><i class="fas fa-spinner fa-spin"></i> Loading...</div>';
            fetch('./api/tv-hunt/root-folders/browse?path=' + encodeURIComponent(path))
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    var dirs = (data && data.directories) ? data.directories : [];
                    var err = data && data.error;
                    if (err) {
                        listEl.innerHTML = '<div style="padding: 16px; color: #f87171;">' + (String(err).replace(/</g, '&lt;')) + '</div>';
                        return;
                    }
                    if (pathInput) pathInput.value = data.path || path;
                    if (upBtn) {
                        var currentPath = (pathInput.value || '').trim() || '/';
                        var parent = currentPath.replace(/\/+$/, '').split('/').slice(0, -1).join('/') || '/';
                        upBtn.disabled = (parent === currentPath || currentPath === '/' || currentPath === '');
                    }
                    var html = '';
                    for (var i = 0; i < dirs.length; i++) {
                        var d = dirs[i];
                        var name = (d.name || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
                        var p = (d.path || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
                        html += '<div class="root-folders-browse-item" data-path="' + p + '" title="' + p + '">' +
                            '<i class="fas fa-folder"></i>' +
                            '<span class="root-folders-browse-item-path">' + name + '</span>' +
                            '</div>';
                    }
                    listEl.innerHTML = html || '<div style="padding: 16px; color: #64748b;">No subdirectories</div>';
                    listEl.querySelectorAll('.root-folders-browse-item').forEach(function(el) {
                        el.onclick = function() {
                            var p = el.getAttribute('data-path') || '';
                            if (p) window.TVHuntRootFolders.loadBrowsePath(p);
                        };
                    });
                })
                .catch(function() {
                    listEl.innerHTML = '<div style="padding: 16px; color: #f87171;">Failed to load</div>';
                });
        },

        init: function() {
            var self = window.TVHuntRootFolders;
            var addBackdrop = document.getElementById('tv-hunt-root-folder-add-modal-backdrop');
            var addClose = document.getElementById('tv-hunt-root-folder-add-modal-close');
            var addCancel = document.getElementById('tv-hunt-root-folder-add-modal-cancel');
            var addSave = document.getElementById('tv-hunt-root-folder-add-modal-save');
            var addBrowseBtn = document.getElementById('tv-hunt-root-folder-add-browse-btn');
            var addTestBtn = document.getElementById('tv-hunt-root-folder-add-test-btn');
            var addPathInput = document.getElementById('tv-hunt-root-folder-add-path');
            if (addBackdrop) addBackdrop.onclick = function() { self.closeAddModal(); };
            if (addClose) addClose.onclick = function() { self.closeAddModal(); };
            if (addCancel) addCancel.onclick = function() { self.closeAddModal(); };
            if (addSave) addSave.onclick = function() { self.addFolder(); };
            if (addBrowseBtn && addPathInput) addBrowseBtn.onclick = function() { self.openBrowseModal(addPathInput); };
            if (addTestBtn) addTestBtn.onclick = function() { self.testPath(); };
            if (addPathInput) {
                addPathInput.addEventListener('keydown', function(e) {
                    if (e.key === 'Enter') { e.preventDefault(); self.addFolder(); }
                });
            }
            document.addEventListener('keydown', function(e) {
                if (e.key === 'Escape') {
                    if (document.getElementById('tv-hunt-root-folder-add-modal') && document.getElementById('tv-hunt-root-folder-add-modal').style.display === 'flex') {
                        self.closeAddModal();
                    }
                    if (document.getElementById('tv-hunt-root-folders-browse-modal') && document.getElementById('tv-hunt-root-folders-browse-modal').style.display === 'flex') {
                        self.closeBrowseModal();
                    }
                }
            });
            var browseBackdrop = document.getElementById('tv-hunt-root-folders-browse-backdrop');
            var browseClose = document.getElementById('tv-hunt-root-folders-browse-close');
            var browseCancel = document.getElementById('tv-hunt-root-folders-browse-cancel');
            var browseOk = document.getElementById('tv-hunt-root-folders-browse-ok');
            var browsePathInput = document.getElementById('tv-hunt-root-folders-browse-path-input');
            if (browseBackdrop) browseBackdrop.onclick = function() { self.closeBrowseModal(); };
            if (browseClose) browseClose.onclick = function() { self.closeBrowseModal(); };
            if (browseCancel) browseCancel.onclick = function() { self.closeBrowseModal(); };
            if (browseOk) browseOk.onclick = function() { self.confirmBrowseSelection(); };
            if (browsePathInput) {
                browsePathInput.addEventListener('keydown', function(e) {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        self.loadBrowsePath(browsePathInput.value);
                    }
                });
            }
            var upBtn = document.getElementById('tv-hunt-root-folders-browse-up');
            if (upBtn) upBtn.onclick = function() { self.goToParent(); };
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() { window.TVHuntRootFolders.init(); });
    } else {
        window.TVHuntRootFolders.init();
    }
})();


/* === modules/utils/tmdb-image-cache-standalone.js === */
/**
 * TMDB Image Cache Utility (Non-Module Version)
 * Caches TMDB images in localStorage to reduce API calls and improve load times
 */

(function() {
    const CACHE_PREFIX = 'tmdb_img_';
    const CACHE_METADATA_KEY = 'tmdb_cache_metadata';

    class TMDBImageCache {
    constructor() {
        this.cacheDays = 7; // Default to 7 days
        this.enabled = true;
        this.storage = 'server'; // Default to server storage
    }

    /**
     * Initialize cache settings from API
     */
    async init() {
        try {
            const response = await fetch('./api/settings');
            const data = await response.json();
            if (data.success && data.settings && data.settings.general) {
                const cacheDays = data.settings.general.tmdb_image_cache_days;
                this.cacheDays = cacheDays !== undefined ? cacheDays : 7;
                this.enabled = this.cacheDays > 0;
                console.log(`[TMDBImageCache] Initialized with ${this.cacheDays} day server-side cache ${this.enabled ? 'enabled' : 'disabled'}`);
            }
        } catch (error) {
            console.error('[TMDBImageCache] Failed to load settings:', error);
        }
    }

        loadMetadata() { return {}; }
        saveMetadata() {}
        getCacheKey(url) { return null; }
        isCacheValid(key) { return false; }
        get(url) { return null; }
        async set(url, imageData) {}
        remove(key) {}
        cleanup(force = false) {}
        clearAll() {}
        getStats() {
            return {
                entries: 0,
                totalSizeKB: 0,
                cacheDays: this.cacheDays,
                enabled: this.enabled
            };
        }
    }

    /**
     * Get cached TMDB image or fetch via server proxy
     */
    async function getCachedTMDBImage(url, cache) {
        if (!url) return url;
        
        // Always use server proxy endpoint which handles caching server-side
        return `./api/tmdb/image?url=${encodeURIComponent(url)}`;
    }

    // Create singleton instance and make it globally available
    window.tmdbImageCache = new TMDBImageCache();
    window.getCachedTMDBImage = getCachedTMDBImage;
})();
