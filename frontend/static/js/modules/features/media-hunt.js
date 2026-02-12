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
