/**
 * Movie Hunt - Standalone movie-only discovery (no TV).
 * Uses only #movie-hunt-* elements; 100% independent of Requestarr.
 * Request flow: indexers -> download client via POST ./api/movie-hunt/request.
 */
(function() {
    'use strict';

    const STORAGE_KEY = 'movie-hunt-selected-instance';
    const SEARCH_DEBOUNCE_MS = 500;

    window.MovieHunt = {
        searchTimeout: null,
        page: 1,
        hasMore: true,
        loading: false,
        requestToken: 0,
        selectedInstance: null,
        activeInstance: null,
        observer: null,
        instances: [],

        _scrollSetup: false,
        _requestModalSetup: false,

        init() {
            const section = document.getElementById('movie-hunt-section');
            if (!section) return;

            this.showMainView();
            this.setupSearch();
            this.setupSort();
            this.setupFilterButton();
            if (!this._requestModalSetup) {
                this.setupRequestModal();
                this._requestModalSetup = true;
            }
            if (!this._instanceSelectReady) {
                this.loadInstancesThenContent();
            } else {
                this.page = 1;
                this.hasMore = true;
                this.loading = false;
                this.requestToken++;
                this.loadMovies(1);
            }
            if (!this._scrollSetup) {
                this.setupInfiniteScroll();
                this._scrollSetup = true;
            }
            console.log('[MovieHunt] Initialized (movies only)');
        },

        setupRequestModal() {
            var self = this;
            var modal = document.getElementById('movie-hunt-request-modal');
            var backdrop = document.getElementById('movie-hunt-request-modal-backdrop');
            var closeBtn = document.getElementById('movie-hunt-request-modal-close');
            var cancelBtn = document.getElementById('movie-hunt-request-modal-cancel');
            var submitBtn = document.getElementById('movie-hunt-request-modal-submit');
            if (!modal || !submitBtn) return;
            function close() {
                modal.style.display = 'none';
                document.body.classList.remove('requestarr-modal-open');
            }
            if (backdrop) backdrop.addEventListener('click', close);
            if (closeBtn) closeBtn.addEventListener('click', close);
            if (cancelBtn) cancelBtn.addEventListener('click', close);
            submitBtn.addEventListener('click', function() {
                self.submitMovieHuntRequest();
            });
        },

        openMovieHuntRequestModal(item) {
            var modal = document.getElementById('movie-hunt-request-modal');
            var titleEl = document.getElementById('movie-hunt-request-modal-title');
            var headerEl = document.getElementById('movie-hunt-request-modal-header');
            var submitBtn = document.getElementById('movie-hunt-request-modal-submit');
            var statusContainer = document.getElementById('movie-hunt-request-status-container');
            var rootFolderSelect = document.getElementById('movie-hunt-request-root-folder');
            if (!modal || !titleEl || !submitBtn) return;
            /* Move modal to body so it sits outside .app-container and is not blurred */
            if (modal.parentNode !== document.body) {
                document.body.appendChild(modal);
            }
            this._pendingRequestItem = item;
            var title = (item && item.title) ? String(item.title).replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';
            titleEl.textContent = item && item.title ? item.title : '';
            var backdropUrl = (item && (item.backdrop_path || item.poster_path)) ? (item.backdrop_path || item.poster_path) : '';
            if (backdropUrl && backdropUrl.indexOf('http') !== 0) {
                backdropUrl = 'https://image.tmdb.org/t/p/w500' + (backdropUrl.indexOf('/') === 0 ? backdropUrl : '/' + backdropUrl);
            }
            if (headerEl) {
                headerEl.style.backgroundImage = backdropUrl ? 'url(' + backdropUrl + ')' : 'none';
            }
            if (statusContainer) {
                statusContainer.innerHTML = '<div class="series-status-box status-requestable"><i class="fas fa-inbox"></i><div><div class="status-title">Available to request</div><div class="status-text">This movie will be sent to your download client.</div></div></div>';
            }
            if (rootFolderSelect) {
                rootFolderSelect.innerHTML = '<option value="">Loading...</option>';
            }
            submitBtn.disabled = false;
            submitBtn.textContent = 'Request';
            modal.style.display = 'flex';
            document.body.classList.add('requestarr-modal-open');
            this.loadMovieHuntRequestRootFolders();
        },

        loadMovieHuntRequestRootFolders() {
            var rootFolderSelect = document.getElementById('movie-hunt-request-root-folder');
            if (!rootFolderSelect) return;
            fetch('./api/movie-hunt/root-folders')
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    var folders = (data && data.root_folders) ? data.root_folders : [];
                    var valid = folders.filter(function(f) { return (f.path || '').trim(); });
                    rootFolderSelect.innerHTML = '';
                    if (valid.length > 0) {
                        valid.forEach(function(rf, idx) {
                            var path = (rf.path || '').trim();
                            var freeSpace = rf.freeSpace;
                            var label = path + (freeSpace != null ? ' (' + Math.round(freeSpace / 1e9) + ' GB free)' : '');
                            var opt = document.createElement('option');
                            opt.value = path;
                            opt.textContent = label;
                            if (idx === 0) opt.selected = true;
                            rootFolderSelect.appendChild(opt);
                        });
                    } else {
                        var defaultOpt = document.createElement('option');
                        defaultOpt.value = '';
                        defaultOpt.textContent = 'Use default (first root folder)';
                        rootFolderSelect.appendChild(defaultOpt);
                    }
                })
                .catch(function() {
                    rootFolderSelect.innerHTML = '<option value="">Use default (first root folder)</option>';
                });
        },

        closeMovieHuntRequestModal() {
            var modal = document.getElementById('movie-hunt-request-modal');
            if (modal) {
                modal.style.display = 'none';
                document.body.classList.remove('requestarr-modal-open');
            }
            this._pendingRequestItem = null;
        },

        submitMovieHuntRequest() {
            var item = this._pendingRequestItem;
            var submitBtn = document.getElementById('movie-hunt-request-modal-submit');
            var instanceSelect = document.getElementById('movie-hunt-request-instance');
            var rootFolderSelect = document.getElementById('movie-hunt-request-root-folder');
            var qualitySelect = document.getElementById('movie-hunt-request-quality-profile');
            if (!item || !submitBtn) return;
            var title = (item.title || '').trim();
            if (!title) return;
            var year = item.year != null ? item.year : '';
            var instance = (instanceSelect && instanceSelect.value) ? String(instanceSelect.value).trim() : (this.selectedInstance || 'default').trim() || 'default';
            var rootFolder = (rootFolderSelect && rootFolderSelect.value) ? String(rootFolderSelect.value).trim() : '';
            var qualityProfile = (qualitySelect && qualitySelect.value) ? String(qualitySelect.value).trim() : '';
            submitBtn.disabled = true;
            submitBtn.textContent = 'Requesting...';
            var self = this;
            var payload = { title: title, year: year, instance: instance };
            if (rootFolder) payload.root_folder = rootFolder;
            if (qualityProfile) payload.quality_profile = qualityProfile;
            if (item.tmdb_id != null) payload.tmdb_id = item.tmdb_id;
            if (item.poster_path) payload.poster_path = item.poster_path;
            fetch('./api/movie-hunt/request', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })
                .then(function(r) { return r.json().then(function(data) { return { ok: r.ok, data: data }; }); })
                .then(function(result) {
                    if (result.ok && result.data && result.data.success) {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification(result.data.message || 'Movie sent to download client.', 'success');
                        }
                        self.closeMovieHuntRequestModal();
                    } else {
                        var msg = (result.data && result.data.message) ? result.data.message : 'Request failed';
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification(msg, 'error');
                        }
                        submitBtn.disabled = false;
                        submitBtn.textContent = 'Request';
                    }
                })
                .catch(function(err) {
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification(err.message || 'Request failed', 'error');
                    }
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Request';
                });
        },

        setupSearch() {
            const input = document.getElementById('movie-hunt-search-input');
            if (!input) return;

            input.addEventListener('input', () => {
                if (this.searchTimeout) clearTimeout(this.searchTimeout);
                const query = (input.value || '').trim();

                if (!query) {
                    this.showMainView();
                    this.loadMovies(1);
                    return;
                }

                this.searchTimeout = setTimeout(() => this.performSearch(query), SEARCH_DEBOUNCE_MS);
            });
        },

        async performSearch(query) {
            const resultsView = document.getElementById('movie-hunt-search-results-view');
            const mainView = document.getElementById('movie-hunt-main-view');
            const grid = document.getElementById('movie-hunt-search-results-grid');

            if (!resultsView || !mainView || !grid) return;

            resultsView.style.display = 'block';
            mainView.style.display = 'none';
            grid.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Searching movies...</p></div>';

            try {
                const url = `./api/requestarr/search?q=${encodeURIComponent(query)}&app_type=radarr&instance_name=search`;
                const response = await fetch(url);
                const data = await response.json();
                const results = data.results || [];

                grid.innerHTML = '';
                if (results.length > 0) {
                    results.forEach((item) => {
                        grid.appendChild(this.createCard(item));
                    });
                } else {
                    grid.innerHTML = '<p style="color: #888; text-align: center; padding: 60px; width: 100%;">No movies found</p>';
                }
            } catch (err) {
                console.error('[MovieHunt] Search error:', err);
                grid.innerHTML = '<p style="color: #ef4444; text-align: center; padding: 60px; width: 100%;">Search failed</p>';
            }
        },

        showMainView() {
            const resultsView = document.getElementById('movie-hunt-search-results-view');
            const mainView = document.getElementById('movie-hunt-main-view');
            if (resultsView) resultsView.style.display = 'none';
            if (mainView) mainView.style.display = 'block';
        },

        async loadInstancesThenContent() {
            const select = document.getElementById('movie-hunt-instance-select');
            if (!select) return;

            // Movie Hunt tracks its own media (future: scan hard drives). Not tied to Radarr.
            // Instance dropdown kept for future multi-instance support; for now only "Default Instance".
            this.instances = [{ name: 'default' }];
            this.selectedInstance = 'default';
            localStorage.setItem(STORAGE_KEY, this.selectedInstance);

            select.innerHTML = '';
            const opt = document.createElement('option');
            opt.value = 'default';
            opt.textContent = 'Default Instance';
            opt.selected = true;
            select.appendChild(opt);

            this._instanceSelectReady = true;

            select.addEventListener('change', () => {
                this.selectedInstance = select.value;
                localStorage.setItem(STORAGE_KEY, this.selectedInstance || '');
                this.page = 1;
                this.hasMore = true;
                this.loading = false;
                this.requestToken++;
                const grid = document.getElementById('movie-hunt-movies-grid');
                if (grid) grid.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Loading movies...</p></div>';
                this.loadMovies(1);
            });

            this.page = 1;
            this.hasMore = true;
            this.loadMovies(1);
        },

        setupSort() {
            const sortSelect = document.getElementById('movie-hunt-sort');
            if (!sortSelect) return;

            sortSelect.addEventListener('change', () => {
                this.page = 1;
                this.hasMore = true;
                this.loading = false;
                this.requestToken++;
                this.loadMovies(1);
            });
        },

        setupFilterButton() {
            const btn = document.getElementById('movie-hunt-filter-btn');
            const countEl = document.getElementById('movie-hunt-filter-count');
            if (btn && countEl) {
                btn.addEventListener('click', () => {
                    if (countEl) countEl.textContent = '0 Active Filters';
                });
            }
        },

        getSortParam() {
            const sortSelect = document.getElementById('movie-hunt-sort');
            return (sortSelect && sortSelect.value) ? sortSelect.value : 'popularity.desc';
        },

        async loadMovies(page) {
            const grid = document.getElementById('movie-hunt-movies-grid');
            if (!grid) return;

            if (this.loading) return;
            this.loading = true;
            const token = ++this.requestToken;
            const instance = this.selectedInstance;

            if (page === 1) {
                grid.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Loading movies...</p></div>';
            }

            try {
                let url = `./api/requestarr/discover/movies?page=${page}&sort_by=${encodeURIComponent(this.getSortParam())}&_=${Date.now()}`;
                if (instance) url += `&app_type=radarr&instance_name=${encodeURIComponent(instance)}`;

                const response = await fetch(url);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const data = await response.json();

                if (token !== this.requestToken) return;

                if (page === 1) {
                    grid.innerHTML = '';
                } else {
                    const spinner = grid.querySelector('.loading-spinner');
                    if (spinner) spinner.remove();
                }

                const results = data.results || [];
                if (results.length > 0) {
                    results.forEach((item) => grid.appendChild(this.createCard(item)));
                } else if (page === 1) {
                    grid.innerHTML = '<p style="color: #888; text-align: center; width: 100%; padding: 40px;">No movies found</p>';
                }

                this.hasMore = data.has_more !== false && results.length >= 20;
            } catch (err) {
                console.error('[MovieHunt] Load movies error:', err);
                if (page === 1) {
                    grid.innerHTML = '<p style="color: #ef4444; text-align: center; width: 100%; padding: 40px;">Failed to load movies</p>';
                }
                this.hasMore = false;
            } finally {
                this.loading = false;
                this.page = page;
                // If sentinel is already in view (e.g. first page didn't fill the screen), load more
                const sentinel = document.getElementById('movie-hunt-scroll-sentinel');
                if (sentinel && this.hasMore && !this.loading) {
                    const rect = sentinel.getBoundingClientRect();
                    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
                    if (rect.top <= viewportHeight + 200) {
                        this.loadMovies(this.page + 1);
                    }
                }
            }
        },

        setupInfiniteScroll() {
            const sentinel = document.getElementById('movie-hunt-scroll-sentinel');
            if (!sentinel || this.observer) return;

            // Use main-content as root when present so scrolling the content area triggers load
            const scrollRoot = document.querySelector('.main-content') || null;
            const self = this;
            this.observer = new IntersectionObserver(
                (entries) => {
                    entries.forEach((entry) => {
                        if (!entry.isIntersecting) return;
                        if (self.hasMore && !self.loading) {
                            self.loadMovies(self.page + 1);
                        }
                    });
                },
                { root: scrollRoot, rootMargin: '200px 0px', threshold: 0 }
            );
            this.observer.observe(sentinel);
        },

        createCard(item) {
            const card = document.createElement('div');
            card.className = 'media-card';
            const tmdbId = item.tmdb_id || item.id;
            if (tmdbId) card.setAttribute('data-tmdb-id', tmdbId);
            card.setAttribute('data-media-type', 'movie');
            card.itemData = item;

            let posterUrl = item.poster_path || './static/images/blackout.jpg';
            // Use TMDB cache: server-side = proxy URL, browser = set below after render
            const isTmdbUrl = posterUrl && !posterUrl.includes('./static/images/');
            if (isTmdbUrl && window.tmdbImageCache && window.tmdbImageCache.enabled && window.tmdbImageCache.storage === 'server') {
                posterUrl = `./api/tmdb/image?url=${encodeURIComponent(posterUrl)}`;
            }
            const year = item.year || 'N/A';
            const rating = item.vote_average != null ? Number(item.vote_average).toFixed(1) : 'N/A';
            const overview = item.overview || 'No description available.';
            const inLibrary = item.in_library || false;
            const partial = item.partial || false;
            const inCooldown = item.in_cooldown || false;
            const hasInstance = this.instances && this.instances.length > 0;

            let statusBadge = '';
            if (hasInstance) {
                if (inCooldown) {
                    statusBadge = '<div class="media-card-status-badge cooldown"><i class="fas fa-hand"></i></div>';
                } else if (inLibrary) {
                    statusBadge = '<div class="media-card-status-badge complete"><i class="fas fa-check"></i></div>';
                } else if (partial) {
                    statusBadge = '<div class="media-card-status-badge partial"><i class="fas fa-exclamation"></i></div>';
                } else {
                    statusBadge = '<div class="media-card-status-badge available"><i class="fas fa-download"></i></div>';
                }
            }

            const metaClass = hasInstance ? 'media-card-meta' : 'media-card-meta no-hide';
            const showRequestBtn = hasInstance && !inLibrary && !inCooldown;
            const overlayAction = showRequestBtn
                ? '<button class="media-card-request-btn"><i class="fas fa-download"></i> Request</button>'
                : '';

            if (inLibrary) card.classList.add('in-library');
            if (inCooldown) card.classList.add('in-cooldown');

            card.innerHTML = `
                <div class="media-card-poster">
                    ${statusBadge}
                    <img src="${posterUrl}" alt="${(item.title || '').replace(/"/g, '&quot;')}" onerror="this.src='./static/images/blackout.jpg'">
                    <div class="media-card-overlay">
                        <div class="media-card-overlay-title">${(item.title || '').replace(/</g, '&lt;')}</div>
                        <div class="media-card-overlay-content">
                            <div class="media-card-overlay-year">${year}</div>
                            <div class="media-card-overlay-description">${(overview || '').replace(/</g, '&lt;').slice(0, 200)}</div>
                            ${overlayAction}
                        </div>
                    </div>
                </div>
                <div class="media-card-info">
                    <div class="media-card-title" title="${(item.title || '').replace(/"/g, '&quot;')}">${(item.title || '').replace(/</g, '&lt;')}</div>
                    <div class="${metaClass}">
                        <span class="media-card-year">${year}</span>
                        <span class="media-card-rating"><i class="fas fa-star"></i> ${rating}</span>
                    </div>
                </div>
            `;

            // Browser-side cache: load and update img asynchronously
            const originalPosterUrl = item.poster_path || './static/images/blackout.jpg';
            if (originalPosterUrl && !originalPosterUrl.includes('./static/images/') && window.getCachedTMDBImage && window.tmdbImageCache && window.tmdbImageCache.enabled && window.tmdbImageCache.storage === 'browser') {
                const imgEl = card.querySelector('.media-card-poster img');
                if (imgEl) {
                    window.getCachedTMDBImage(originalPosterUrl, window.tmdbImageCache).then(function(cachedUrl) {
                        if (cachedUrl && cachedUrl !== originalPosterUrl) imgEl.src = cachedUrl;
                    }).catch(function(err) {
                        console.error('[MovieHunt] Failed to cache image:', err);
                    });
                }
            }

            const posterDiv = card.querySelector('.media-card-poster');
            const requestBtn = card.querySelector('.media-card-request-btn');

            const openRequestModal = () => {
                window.MovieHunt.openMovieHuntRequestModal(item);
            };

            if (posterDiv) {
                posterDiv.addEventListener('click', (e) => {
                    if (requestBtn && (e.target === requestBtn || requestBtn.contains(e.target))) return;
                    openRequestModal();
                });
            }
            if (requestBtn) {
                requestBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    openRequestModal();
                });
            }

            return card;
        }
    };
})();
