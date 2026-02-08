/**
 * Movie Hunt - Standalone movie-only discovery (no TV).
 * Uses only #movie-hunt-* elements; 100% independent of Requestarr.
 * Request flow: indexers -> download client via POST ./api/movie-hunt/request.
 */
(function() {
    'use strict';

    const SEARCH_DEBOUNCE_MS = 500;

    window.MovieHunt = {
        searchTimeout: null,
        page: 1,
        hasMore: true,
        loading: false,
        requestToken: 0,
        observer: null,

        _scrollSetup: false,
        _requestModalSetup: false,
        _instanceSelectReady: false,

        init() {
            const section = document.getElementById('movie-hunt-section');
            if (!section) return;

            this.showMainView();
            this.setupSearch();
            this.setupSort();
            this.setupFilterButton();
            if (window.MovieHuntFilters && window.MovieHuntFilters.init) {
                window.MovieHuntFilters.init();
            }
            if (!this._requestModalSetup) {
                this.setupRequestModal();
                this._requestModalSetup = true;
            }
            if (window.MovieHuntInstanceDropdown && document.getElementById('movie-hunt-instance-select')) {
                if (!this._instanceSelectReady) {
                    window.MovieHuntInstanceDropdown.attach('movie-hunt-instance-select', () => {
                        this.page = 1;
                        this.hasMore = true;
                        this.loading = false;
                        this.requestToken++;
                        const grid = document.getElementById('movie-hunt-movies-grid');
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
                document.body.classList.remove('movie-hunt-request-modal-open');
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
            var submitBtn = document.getElementById('movie-hunt-request-modal-submit');
            var statusContainer = document.getElementById('movie-hunt-request-status-container');
            var rootFolderSelect = document.getElementById('movie-hunt-request-root-folder');
            var instanceSelect = document.getElementById('movie-hunt-request-instance');
            var cancelBtn = document.getElementById('movie-hunt-request-modal-cancel');
            var closeBtn = document.getElementById('movie-hunt-request-modal-close');
            var backdrop = document.getElementById('movie-hunt-request-modal-backdrop');
            var posterImg = document.getElementById('movie-hunt-request-poster-img');
            var metaEl = document.getElementById('movie-hunt-request-modal-meta');

            if (!modal || !titleEl || !submitBtn) return;

            /* Move modal to body so it sits outside .app-container and is not blurred */
            if (modal.parentNode !== document.body) {
                document.body.appendChild(modal);
            }
            /* Ensure modal is on top: body class triggers blur on .app-container only */
            document.body.classList.add('movie-hunt-request-modal-open');

            this._pendingRequestItem = item;
            titleEl.textContent = item && item.title ? item.title : '';

            // Poster image
            if (posterImg) {
                var posterPath = (item && item.poster_path) ? item.poster_path : '';
                if (posterPath && posterPath.indexOf('http') !== 0) {
                    posterPath = 'https://image.tmdb.org/t/p/w342' + (posterPath.indexOf('/') === 0 ? posterPath : '/' + posterPath);
                }
                posterImg.src = posterPath || './static/images/blackout.jpg';
            }

            // Meta line: year, genres
            if (metaEl) {
                var parts = [];
                if (item && item.year) parts.push(String(item.year));
                if (item && item.genres && item.genres.length) {
                    var genreNames = item.genres.map(function(g) { return typeof g === 'string' ? g : (g.name || ''); }).filter(Boolean);
                    if (genreNames.length) parts.push(genreNames.slice(0, 3).join(', '));
                } else if (item && item.genre_ids) {
                    // genre_ids are numeric; we don't have a map here, so just show the year
                }
                metaEl.textContent = parts.join('  \u00B7  ');
            }

            // Compact status badge
            if (statusContainer) {
                statusContainer.innerHTML = '<span class="mh-req-badge mh-req-badge-ok"><i class="fas fa-check-circle"></i> Available to request</span>';
            }
            if (rootFolderSelect) {
                rootFolderSelect.innerHTML = '<option value="">Loading...</option>';
            }
            var qualitySelect = document.getElementById('movie-hunt-request-quality-profile');
            if (qualitySelect) {
                qualitySelect.innerHTML = '<option value="">Loading...</option>';
            }
            submitBtn.disabled = false;
            submitBtn.textContent = 'Request';

            // Populate instance dropdown
            if (instanceSelect && window.MovieHuntInstanceDropdown) {
                var self = this;
                instanceSelect.innerHTML = '<option value="">Loading...</option>';
                Promise.all([
                    fetch('./api/movie-hunt/instances', { cache: 'no-store' }).then(function(r) { return r.json(); }),
                    fetch('./api/movie-hunt/current-instance', { cache: 'no-store' }).then(function(r) { return r.json(); })
                ]).then(function(results) {
                    var list = (results[0].instances || []);
                    var current = (results[1].instance_id != null ? results[1].instance_id : 1);
                    instanceSelect.innerHTML = '';
                    list.forEach(function(inst) {
                        var opt = document.createElement('option');
                        opt.value = String(inst.id);
                        opt.textContent = (inst.name || 'Instance ' + inst.id);
                        if (inst.id === current) opt.selected = true;
                        instanceSelect.appendChild(opt);
                    });
                    // Check status for the currently selected instance
                    self.checkMovieStatusForInstance(item, instanceSelect.value);
                }).catch(function() {
                    instanceSelect.innerHTML = '<option value="1">Default Instance</option>';
                });

                // Add change handler to check status when instance changes
                var newInstanceSelect = instanceSelect.cloneNode(true);
                instanceSelect.parentNode.replaceChild(newInstanceSelect, instanceSelect);
                instanceSelect = newInstanceSelect;
                instanceSelect.addEventListener('change', function() {
                    self.checkMovieStatusForInstance(item, instanceSelect.value);
                    self.loadMovieHuntRequestRootFolders(instanceSelect.value);
                    self.loadMovieHuntQualityProfiles(instanceSelect.value);
                });
            }

            // Show modal (class already added above so blur applies to background only)
            modal.style.display = 'flex';

            // Re-attach close handlers every time modal opens (to ensure they work)
            var self = this;
            function closeModal() {
                modal.style.display = 'none';
                document.body.classList.remove('movie-hunt-request-modal-open');
            }

            // Remove old listeners and add new ones for Cancel, Close, and Backdrop
            if (cancelBtn) {
                var newCancelBtn = cancelBtn.cloneNode(true);
                cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
                newCancelBtn.addEventListener('click', closeModal);
            }

            if (closeBtn) {
                var newCloseBtn = closeBtn.cloneNode(true);
                closeBtn.parentNode.replaceChild(newCloseBtn, closeBtn);
                newCloseBtn.addEventListener('click', closeModal);
            }

            if (backdrop) {
                var newBackdrop = backdrop.cloneNode(true);
                backdrop.parentNode.replaceChild(newBackdrop, backdrop);
                newBackdrop.addEventListener('click', closeModal);
            }

            // Re-attach submit button listener
            if (submitBtn) {
                var newSubmitBtn = submitBtn.cloneNode(true);
                submitBtn.parentNode.replaceChild(newSubmitBtn, submitBtn);
                newSubmitBtn.addEventListener('click', function() {
                    self.submitMovieHuntRequest();
                });
            }

            this.loadMovieHuntRequestRootFolders(instanceSelect ? instanceSelect.value : null);
            this.loadMovieHuntQualityProfiles(instanceSelect ? instanceSelect.value : null);
        },

        checkMovieStatusForInstance(item, instanceId) {
            var statusContainer = document.getElementById('movie-hunt-request-status-container');
            if (!statusContainer || !item || !item.tmdb_id) return;

            statusContainer.innerHTML = '<span class="mh-req-badge mh-req-badge-loading"><i class="fas fa-spinner fa-spin"></i> Checking...</span>';

            fetch('./api/movie-hunt/collection?instance_id=' + instanceId, { cache: 'no-store' })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    var movies = (data && data.movies) ? data.movies : [];
                    var found = movies.find(function(m) { return m.tmdb_id === item.tmdb_id; });

                    if (found) {
                        statusContainer.innerHTML = '<span class="mh-req-badge mh-req-badge-lib"><i class="fas fa-bookmark"></i> Already in Collection</span>';
                    } else {
                        statusContainer.innerHTML = '<span class="mh-req-badge mh-req-badge-ok"><i class="fas fa-check-circle"></i> Available to request</span>';
                    }
                })
                .catch(function() {
                    statusContainer.innerHTML = '<span class="mh-req-badge mh-req-badge-ok"><i class="fas fa-check-circle"></i> Available to request</span>';
                });
        },

        loadMovieHuntQualityProfiles(instanceId) {
            var qualitySelect = document.getElementById('movie-hunt-request-quality-profile');
            if (!qualitySelect) return;
            var url = './api/profiles' + (instanceId ? '?instance_id=' + instanceId : '');
            fetch(url)
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    var list = (data && data.profiles) ? data.profiles : [];
                    qualitySelect.innerHTML = '';
                    list.forEach(function(p) {
                        var name = (p && p.name) ? String(p.name).trim() : '';
                        if (!name) return;
                        var opt = document.createElement('option');
                        opt.value = name;
                        opt.textContent = p.is_default ? name + ' (Default)' : name;
                        qualitySelect.appendChild(opt);
                    });
                    if (list.length === 0) {
                        var emptyOpt = document.createElement('option');
                        emptyOpt.value = '';
                        emptyOpt.textContent = 'No profiles';
                        qualitySelect.appendChild(emptyOpt);
                    }
                })
                .catch(function() {
                    qualitySelect.innerHTML = '<option value="">No profiles</option>';
                });
        },

        loadMovieHuntRequestRootFolders(instanceId) {
            var rootFolderSelect = document.getElementById('movie-hunt-request-root-folder');
            if (!rootFolderSelect) return;
            var url = './api/movie-hunt/root-folders' + (instanceId ? '?instance_id=' + instanceId : '');
            fetch(url)
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    var folders = (data && data.root_folders) ? data.root_folders : [];
                    var valid = folders.filter(function(f) { return (f.path || '').trim(); });
                    rootFolderSelect.innerHTML = '';
                    if (valid.length > 0) {
                        var defaultPath = null;
                        valid.forEach(function(rf) {
                            if (rf.is_default) defaultPath = (rf.path || '').trim();
                        });
                        if (!defaultPath && valid[0]) defaultPath = (valid[0].path || '').trim();
                        valid.forEach(function(rf) {
                            var path = (rf.path || '').trim();
                            var freeSpace = rf.freeSpace;
                            var label = path + (freeSpace != null ? ' (' + Math.round(freeSpace / 1e9) + ' GB free)' : '');
                            if (rf.is_default) label += ' (Default)';
                            var opt = document.createElement('option');
                            opt.value = path;
                            opt.textContent = label;
                            if (path === defaultPath) opt.selected = true;
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
                document.body.classList.remove('movie-hunt-request-modal-open');
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
            if (btn) {
                btn.addEventListener('click', () => {
                    if (window.MovieHuntFilters && window.MovieHuntFilters.openFiltersModal) {
                        window.MovieHuntFilters.openFiltersModal();
                    }
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

            if (page === 1) {
                grid.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Loading movies...</p></div>';
            }

            try {
                // Movie Hunt–only discover: no Radarr/Requestarr. Status from Movie Hunt collection.
                let url = `./api/movie-hunt/discover/movies?page=${page}&_=${Date.now()}`;
                const filterParams = (window.MovieHuntFilters && window.MovieHuntFilters.getFilterParams) ? window.MovieHuntFilters.getFilterParams() : '';
                if (filterParams) {
                    url += '&' + filterParams;
                } else {
                    url += '&sort_by=' + encodeURIComponent(this.getSortParam());
                }

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

            const requestBtn = card.querySelector('.media-card-request-btn');

            const openRequestModal = () => {
                window.MovieHunt.openMovieHuntRequestModal(item);
            };

            const openDetailPage = () => {
                if (window.MovieHuntDetail && window.MovieHuntDetail.openDetail) {
                    window.MovieHuntDetail.openDetail(item);
                } else {
                    openRequestModal();
                }
            };

            // Click anywhere on card opens detail page (whole card is clickable)
            card.style.cursor = 'pointer';
            card.addEventListener('click', (e) => {
                // Only exception: Request button opens request modal, not detail
                if (requestBtn && (e.target === requestBtn || requestBtn.contains(e.target))) {
                    e.preventDefault();
                    e.stopPropagation();
                    openRequestModal();
                    return;
                }
                openDetailPage();
            });

            return card;
        }
    };
})();
