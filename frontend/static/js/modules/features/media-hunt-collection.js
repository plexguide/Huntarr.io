/**
 * Media Hunt Collection – Movie Hunt + TV Hunt instance dropdowns, combined library view.
 * Only shows Movie Hunt and TV Hunt instances (no Radarr/Sonarr).
 */
(function () {
    'use strict';

    var movieSelectId = 'media-hunt-collection-movie-instance-select';
    var tvSelectId = 'media-hunt-collection-tv-instance-select';

    function hasDualDropdowns() {
        return !!document.getElementById(movieSelectId) && !!document.getElementById(tvSelectId);
    }

    var COLLECTION_PAGE_SIZE = 48;

    function getCollectionPosterUrl(posterPath, size) {
        size = size || 'w500';
        if (!posterPath) return './static/images/blackout.jpg';
        var fullUrl = (posterPath.indexOf('http') === 0) ? posterPath : ('https://image.tmdb.org/t/p/' + size + (posterPath[0] === '/' ? posterPath : '/' + posterPath));
        if (window.tmdbImageCache && window.tmdbImageCache.enabled && window.tmdbImageCache.storage === 'server') {
            return './api/tmdb/image?url=' + encodeURIComponent(fullUrl);
        }
        return fullUrl;
    }

    function applyCollectionCacheToImages(container) {
        if (!container || !window.getCachedTMDBImage || !window.tmdbImageCache || !window.tmdbImageCache.enabled || window.tmdbImageCache.storage !== 'browser') return;
        var imgs = container.querySelectorAll('img[src^="https://image.tmdb.org"]');
        imgs.forEach(function (img) {
            var posterUrlVal = img.getAttribute('src');
            if (!posterUrlVal) return;
            window.getCachedTMDBImage(posterUrlVal, window.tmdbImageCache).then(function (cachedUrl) {
                if (cachedUrl && cachedUrl !== posterUrlVal) img.src = cachedUrl;
            }).catch(function () { });
        });
    }

    window.MediaHuntCollection = {
        _combinedItems: [],
        _combinedTotal: 0,
        _combinedPage: 0,
        _collectionLoading: false,
        _collectionHasMore: false,
        _collectionFetchedAll: false,
        _collectionScrollObserver: null,
        _movieInstanceId: null,
        _tvInstanceId: null,
        _initialized: false,
        sortBy: 'title.asc',
        viewMode: 'posters',
        hiddenMediaSet: new Set(),

        init: function (forceRefresh) {
            var hash = window.location.hash || '';
            var tvMatch = hash.match(/media-hunt-collection\/tv\/(\d+)/);
            var pendingTmdbId = tvMatch ? parseInt(tvMatch[1], 10) : null;
            if (!pendingTmdbId && window.TVHuntCollection && typeof window.TVHuntCollection.showMainView === 'function') {
                window.TVHuntCollection.showMainView();
            }
            if (!hasDualDropdowns()) return;

            // Cache guard: if collection is already loaded, just show it without re-fetching
            var grid = document.getElementById('media-hunt-collection-grid');
            if (!forceRefresh && this._initialized && grid && grid.children.length > 0 && !grid.querySelector('.loading-spinner')) {
                // Re-attach visibility listener and refresh interval that cleanup() removed
                this._setupAutoRefresh();
                if (pendingTmdbId && window.RequestarrTVDetail) {
                    window.RequestarrTVDetail.openDetail({ tmdb_id: pendingTmdbId, id: pendingTmdbId });
                }
                return;
            }

            window._mediaHuntCollectionUnified = true;
            window.TVHuntCollection._prefix = 'media-hunt-collection';
            window.MovieHuntCollection._prefix = 'media-hunt-collection';

            var self = this;
            var movieSelect = document.getElementById(movieSelectId);
            var tvSelect = document.getElementById(tvSelectId);
            if (!movieSelect || !tvSelect) return;

            // Populate dropdowns from Movie Hunt, TV Hunt, and indexers (for step-2 warning) — cache-bust for fresh data on navigate
            var ts = '?_=' + Date.now();
            var moviePromise = fetch('./api/movie-hunt/instances' + ts, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) { return d.instances || []; }).catch(function () { return []; });
            var tvPromise = fetch('./api/tv-hunt/instances' + ts, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) { return d.instances || []; }).catch(function () { return []; });
            var indexerPromise = fetch('./api/indexer-hunt/indexers' + ts, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) { return d.indexers || []; }).catch(function () { return []; });
            var hasClientsPromise = fetch('./api/movie-hunt/has-clients' + ts, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) { return d.has_clients === true; }).catch(function () { return false; });

            Promise.all([moviePromise, tvPromise, indexerPromise, hasClientsPromise]).then(function (results) {
                var movieInstances = results[0];
                var tvInstances = results[1];
                var indexers = results[2];
                var hasClients = results[3];
                var hasInstances = (movieInstances || []).length > 0 || (tvInstances || []).length > 0;
                var hasIndexers = (indexers || []).length > 0;

                var contentWrapper = document.getElementById('media-hunt-collection-content-wrapper');
                if (contentWrapper) contentWrapper.style.display = '';

                if (pendingTmdbId && window.RequestarrTVDetail) {
                    window.RequestarrTVDetail.openDetail({ tmdb_id: pendingTmdbId, id: pendingTmdbId });
                }

                movieSelect.innerHTML = '';
                movieSelect.appendChild(document.createElement('option')).value = ''; movieSelect.options[0].textContent = 'No Movie Hunt instance';
                (movieInstances || []).forEach(function (inst) {
                    var opt = document.createElement('option');
                    opt.value = String(inst.id);
                    opt.textContent = inst.name || 'Instance ' + inst.id;
                    movieSelect.appendChild(opt);
                });

                tvSelect.innerHTML = '';
                tvSelect.appendChild(document.createElement('option')).value = ''; tvSelect.options[0].textContent = 'No TV Hunt instance';
                (tvInstances || []).forEach(function (inst) {
                    var opt = document.createElement('option');
                    opt.value = String(inst.id);
                    opt.textContent = inst.name || 'Instance ' + inst.id;
                    tvSelect.appendChild(opt);
                });

                // Auto-select first instance when available (fixes "No instances selected" when instances exist)
                if ((movieInstances || []).length > 0) movieSelect.value = String(movieInstances[0].id);
                if ((tvInstances || []).length > 0) tvSelect.value = String(tvInstances[0].id);

                self.setupSort();
                self.setupViewMode();
                self.setupSearch();
                self.loadHiddenMediaIds().then(function () {
                    onInstanceChange();
                    self._initialized = true;
                });
            });

            var onInstanceChange = function () {
                self._movieInstanceId = movieSelect.value ? parseInt(movieSelect.value, 10) : null;
                self._tvInstanceId = tvSelect.value ? parseInt(tvSelect.value, 10) : null;
                // Update backend "current" instance so detail-view API calls (monitor, delete) use correct instance
                if (self._tvInstanceId) {
                    fetch('./api/tv-hunt/instances/current', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ instance_id: self._tvInstanceId })
                    }).catch(function () { });
                }
                if (self._movieInstanceId) {
                    fetch('./api/movie-hunt/instances/current', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ instance_id: self._movieInstanceId })
                    }).catch(function () { });
                }
                self.loadCombinedCollection();
            };
            movieSelect.addEventListener('change', onInstanceChange);
            tvSelect.addEventListener('change', onInstanceChange);

            // Wire TV series detail back button (TVHuntCollection owns the detail view)
            if (window.TVHuntCollection && typeof window.TVHuntCollection.setupBackButton === 'function') {
                window.TVHuntCollection.setupBackButton();
            }

            // Set up auto-refresh (visibility change + periodic interval)
            self._setupAutoRefresh();
        },

        _setupAutoRefresh: function () {
            var self = this;
            self.cleanup(); // remove any stale listeners first
            self._onVisibilityChange = function () {
                if (document.visibilityState === 'visible' && (self._movieInstanceId || self._tvInstanceId)) {
                    self.loadCombinedCollection();
                }
            };
            document.addEventListener('visibilitychange', self._onVisibilityChange);
            self._collectionRefreshInterval = setInterval(function () {
                if (document.visibilityState === 'visible' && (self._movieInstanceId || self._tvInstanceId)) {
                    self.loadCombinedCollection();
                }
            }, 90000);
        },

        cleanup: function () {
            if (this._onVisibilityChange) {
                document.removeEventListener('visibilitychange', this._onVisibilityChange);
                this._onVisibilityChange = null;
            }
            if (this._collectionRefreshInterval) {
                clearInterval(this._collectionRefreshInterval);
                this._collectionRefreshInterval = null;
            }
        },

        loadHiddenMediaIds: function () {
            var self = this;
            return fetch('./api/requestarr/hidden-media?page=1&page_size=10000')
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    var items = Array.isArray(data) ? data : (Array.isArray(data.items) ? data.items : []);
                    self.hiddenMediaSet = new Set();
                    items.forEach(function (item) {
                        var key = item.tmdb_id + ':' + item.media_type + ':' + (item.app_type || '') + ':' + (item.instance_name || '');
                        self.hiddenMediaSet.add(key);
                    });
                })
                .catch(function () { self.hiddenMediaSet = new Set(); });
        },

        loadCombinedCollection: function (append) {
            var self = this;
            var grid = document.getElementById('media-hunt-collection-grid');
            if (!grid) return;

            if (!append) {
                grid.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Loading collection...</p></div>';
                grid.style.display = 'flex';
            }

            if (!self._movieInstanceId && !self._tvInstanceId) {
                grid.innerHTML = '<div class="media-hunt-collection-no-instances">' +
                    '<i class="fas fa-cube" aria-hidden="true"></i>' +
                    '<p class="no-instances-title">No instances selected</p>' +
                    '<p class="no-instances-desc">Select a Movie Hunt and/or TV Hunt instance above to view your combined library.</p>' +
                    '<a href="./#media-hunt-instances" class="no-instances-action-btn">' +
                    '<i class="fas fa-plus"></i> Add Instance</a></div>';
                return;
            }

            function filterAndSort(items) {
                var out = items.filter(function (item) {
                    if (!item.tmdb_id || !self.hiddenMediaSet || self.hiddenMediaSet.size === 0) return true;
                    var mt = item.media_type || 'movie';
                    for (var key of self.hiddenMediaSet) {
                        if (key.indexOf(item.tmdb_id + ':' + mt) === 0) return false;
                    }
                    return true;
                });
                out.sort(function (a, b) {
                    var c = (a._sortTitle || '').localeCompare(b._sortTitle || '');
                    if (c !== 0) return self.sortBy === 'title.desc' ? -c : c;
                    return ((a._year || '').localeCompare(b._year || ''));
                });
                return out;
            }

            function processFirstPage(data) {
                var items = data.items || [];
                var total = data.total != null ? data.total : items.length;
                var filtered = filterAndSort(items);
                self._combinedItems = filtered;
                self._combinedTotal = total;
                self._combinedPage = 1;
                self._collectionHasMore = (items.length === COLLECTION_PAGE_SIZE && 1 * COLLECTION_PAGE_SIZE < total);
                self._collectionFetchedAll = false;
                self.renderCombined();
                self.setupCollectionInfiniteScroll();
            }

            function processFallbackFull(combined) {
                var filtered = filterAndSort(combined);
                self._combinedItems = filtered;
                self._combinedTotal = filtered.length;
                self._combinedPage = 1;
                self._collectionHasMore = filtered.length > COLLECTION_PAGE_SIZE;
                self._collectionFetchedAll = true;
                self.renderCombined();
                self.setupCollectionInfiniteScroll();
            }

            function ensureTvConfig() {
                if (!self._tvInstanceId) { self._tvIgnoreNonSeason = true; return Promise.resolve(); }
                return fetch('./api/tv-hunt/settings/tv-management?instance_id=' + self._tvInstanceId)
                    .then(function (r) { return r.json(); })
                    .then(function (cfg) { self._tvIgnoreNonSeason = cfg.ignore_non_season_in_collection_status !== false; })
                    .catch(function () { self._tvIgnoreNonSeason = true; });
            }

            function fallbackToLegacyApis() {
                var promises = [];
                promises.push(ensureTvConfig());
                if (self._movieInstanceId) {
                    promises.push(fetch('./api/movie-hunt/collection?instance_id=' + self._movieInstanceId + '&page=1&page_size=9999&sort=' + encodeURIComponent(self.sortBy || 'title.asc'))
                        .then(function (r) { return r.json(); })
                        .then(function (d) {
                            return (d.items || []).map(function (m) {
                                m.media_type = 'movie';
                                m._sortTitle = (m.title || '').toLowerCase();
                                m._year = m.year || '';
                                return m;
                            });
                        })
                        .catch(function () { return []; }));
                } else {
                    promises.push(Promise.resolve([]));
                }
                if (self._tvInstanceId) {
                    promises.push(fetch('./api/tv-hunt/collection?instance_id=' + self._tvInstanceId)
                        .then(function (r) { return r.json(); })
                        .then(function (d) {
                            var series = d.series || [];
                            return series.map(function (s) {
                                var title = s.title || s.name || '';
                                var year = (s.first_air_date || '').substring(0, 4);
                                return {
                                    media_type: 'tv',
                                    tmdb_id: s.tmdb_id,
                                    title: title,
                                    name: title,
                                    year: year,
                                    first_air_date: s.first_air_date,
                                    poster_path: s.poster_path,
                                    status: s.status,
                                    seasons: s.seasons,
                                    overview: s.overview,
                                    vote_average: s.vote_average,
                                    _sortTitle: title.toLowerCase(),
                                    _year: year,
                                    _raw: s
                                };
                            });
                        })
                        .catch(function () { return []; }));
                } else {
                    promises.push(Promise.resolve([]));
                }
                Promise.all(promises).then(function (results) {
                    var combined = (results[1] || []).concat(results[2] || []);
                    processFallbackFull(combined);
                });
            }

            if (append) {
                if (self._collectionLoading || !self._collectionHasMore) return;
                self._collectionLoading = true;
                if (self._collectionFetchedAll) {
                    var start = self._combinedPage * COLLECTION_PAGE_SIZE;
                    var slice = self._combinedItems.slice(start, start + COLLECTION_PAGE_SIZE);
                    self._combinedPage++;
                    self._collectionHasMore = (self._combinedPage * COLLECTION_PAGE_SIZE < self._combinedTotal);
                    slice.forEach(function (item) {
                        grid.appendChild(self.createCombinedCard(item));
                    });
                    applyCollectionCacheToImages(grid);
                    self._collectionLoading = false;
                } else {
                    var params = new URLSearchParams();
                    if (self._movieInstanceId) params.set('movie_instance_id', self._movieInstanceId);
                    if (self._tvInstanceId) params.set('tv_instance_id', self._tvInstanceId);
                    params.set('page', String(self._combinedPage + 1));
                    params.set('page_size', String(COLLECTION_PAGE_SIZE));
                    params.set('sort', self.sortBy || 'title.asc');
                    fetch('./api/requestarr/collection?' + params.toString())
                        .then(function (r) { return r.json(); })
                        .then(function (data) {
                            var items = data.items || [];
                            var total = data.total != null ? data.total : 0;
                            var filtered = filterAndSort(items);
                            self._combinedItems = self._combinedItems.concat(filtered);
                            self._combinedPage++;
                            self._collectionHasMore = (self._combinedPage * COLLECTION_PAGE_SIZE < total);
                            filtered.forEach(function (item) {
                                grid.appendChild(self.createCombinedCard(item));
                            });
                            applyCollectionCacheToImages(grid);
                        })
                        .catch(function () { })
                        .then(function () {
                            self._collectionLoading = false;
                        });
                }
                return;
            }

            var params = new URLSearchParams();
            if (self._movieInstanceId) params.set('movie_instance_id', self._movieInstanceId);
            if (self._tvInstanceId) params.set('tv_instance_id', self._tvInstanceId);
            params.set('page', '1');
            params.set('page_size', String(COLLECTION_PAGE_SIZE));
            params.set('sort', self.sortBy || 'title.asc');

            var tvConfigPromise = ensureTvConfig();
            var collectionPromise = fetch('./api/requestarr/collection?' + params.toString())
                .then(function (r) {
                    if (r.ok) return r.json();
                    if (r.status === 404) return null;
                    throw new Error('Failed to load');
                });
            Promise.all([tvConfigPromise, collectionPromise])
                .then(function (results) {
                    var data = results[1];
                    if (data) processFirstPage(data);
                    else if (data === null) fallbackToLegacyApis();
                })
                .catch(function () {
                    if (!append) grid.innerHTML = '<p style="color: #ef4444; text-align: center; padding: 60px;">Failed to load collection.</p>';
                });
        },

        setupCollectionInfiniteScroll: function () {
            var self = this;
            var sentinel = document.getElementById('media-hunt-collection-scroll-sentinel');
            var scrollRoot = document.querySelector('.main-content');
            if (!sentinel || self._collectionScrollObserver) return;
            self._collectionScrollObserver = new IntersectionObserver(
                function (entries) {
                    entries.forEach(function (entry) {
                        if (!entry.isIntersecting) return;
                        if (self.viewMode !== 'posters') return;
                        if (self._collectionHasMore && !self._collectionLoading) self.loadCombinedCollection(true);
                    });
                },
                { root: scrollRoot, rootMargin: '200px 0px', threshold: 0 }
            );
            self._collectionScrollObserver.observe(sentinel);
        },

        setupSort: function () {
            var self = this;
            var select = document.getElementById('media-hunt-collection-sort');
            if (!select) return;
            var opts = [
                { v: 'title.asc', t: 'Title (A-Z)' },
                { v: 'title.desc', t: 'Title (Z-A)' },
                { v: 'year.desc', t: 'Year (newest)' },
                { v: 'year.asc', t: 'Year (oldest)' }
            ];
            select.innerHTML = opts.map(function (o) { return '<option value="' + o.v + '">' + o.t + '</option>'; }).join('');
            var saved = HuntarrUtils.getUIPreference('media-hunt-collection-sort', 'title.asc');
            if (saved) select.value = saved;
            self.sortBy = select.value || 'title.asc';
            select.onchange = function () {
                self.sortBy = select.value;
                HuntarrUtils.setUIPreference('media-hunt-collection-sort', self.sortBy);
                self.loadCombinedCollection();
            };
        },

        setupViewMode: function () {
            var self = this;
            var select = document.getElementById('media-hunt-collection-view-mode');
            if (!select) return;
            self.viewMode = HuntarrUtils.getUIPreference('media-hunt-collection-view', 'posters') || 'posters';
            select.value = self.viewMode;
            select.onchange = function () {
                self.viewMode = select.value;
                HuntarrUtils.setUIPreference('media-hunt-collection-view', self.viewMode);
                self.renderCombined();
            };
        },

        setupSearch: function () {
            var self = this;
            var input = document.getElementById('media-hunt-collection-search-input');
            if (!input) return;
            input.value = '';
            input.addEventListener('input', function () {
                if (self._searchTm) clearTimeout(self._searchTm);
                var q = (input.value || '').trim();
                self._searchTm = setTimeout(function () {
                    if (!q) {
                        document.getElementById('media-hunt-collection-search-results-view').style.display = 'none';
                        document.getElementById('media-hunt-collection-main-content').style.display = 'block';
                        self.renderCombined();
                        return;
                    }
                    self.performSearch(q);
                }, 300);
            });
        },

        performSearch: function (query) {
            // Simplified: filter combined items client-side
            var q = (query || '').toLowerCase();
            var filtered = this._combinedItems.filter(function (item) {
                var t = (item.title || item.name || '').toLowerCase();
                return t.indexOf(q) !== -1;
            });
            var grid = document.getElementById('media-hunt-collection-search-results-grid');
            var resultsView = document.getElementById('media-hunt-collection-search-results-view');
            var mainContent = document.getElementById('media-hunt-collection-main-content');
            if (!grid) return;
            resultsView.style.display = 'block';
            mainContent.style.display = 'none';
            grid.innerHTML = '';
            if (filtered.length === 0) {
                grid.innerHTML = '<p style="color:#888;text-align:center;padding:40px;">No results for "' + (query || '').replace(/</g, '&lt;') + '"</p>';
                return;
            }
            filtered.forEach(function (item) {
                grid.appendChild(this.createCombinedCard(item));
            }.bind(this));
            applyCollectionCacheToImages(grid);
        },

        renderCombined: function () {
            var self = this;
            var grid = document.getElementById('media-hunt-collection-grid');
            var table = document.getElementById('media-hunt-collection-table');
            var tableBody = document.getElementById('media-hunt-collection-table-body');
            var overview = document.getElementById('media-hunt-collection-overview');
            var overviewList = document.getElementById('media-hunt-collection-overview-list');
            if (!grid) return;

            if (table) table.style.display = 'none';
            if (overview) overview.style.display = 'none';
            grid.style.display = 'grid';
            grid.innerHTML = '';

            var items = self._combinedItems || [];
            if (self.sortBy === 'year.desc') items = items.slice().sort(function (a, b) { return (b._year || '').localeCompare(a._year || ''); });
            else if (self.sortBy === 'year.asc') items = items.slice().sort(function (a, b) { return (a._year || '').localeCompare(b._year || ''); });
            else if (self.sortBy === 'title.desc') items = items.slice().sort(function (a, b) { return (b._sortTitle || '').localeCompare(a._sortTitle || ''); });
            else items = items.slice().sort(function (a, b) { return (a._sortTitle || '').localeCompare(b._sortTitle || ''); });

            if (self.viewMode === 'table' || self.viewMode === 'overview') {
                if (!self._collectionFetchedAll && items.length < self._combinedTotal && self._combinedTotal > 0) {
                    var params = new URLSearchParams();
                    if (self._movieInstanceId) params.set('movie_instance_id', self._movieInstanceId);
                    if (self._tvInstanceId) params.set('tv_instance_id', self._tvInstanceId);
                    params.set('page', '1');
                    params.set('page_size', String(Math.min(10000, self._combinedTotal)));
                    params.set('sort', self.sortBy || 'title.asc');
                    fetch('./api/requestarr/collection?' + params.toString())
                        .then(function (r) { return r.json(); })
                        .then(function (data) {
                            var raw = data.items || [];
                            var filtered = raw.filter(function (item) {
                                if (!item.tmdb_id || !self.hiddenMediaSet || self.hiddenMediaSet.size === 0) return true;
                                var mt = item.media_type || 'movie';
                                for (var key of self.hiddenMediaSet) {
                                    if (key.indexOf(item.tmdb_id + ':' + mt) === 0) return false;
                                }
                                return true;
                            });
                            filtered.sort(function (a, b) {
                                var c = (a._sortTitle || '').localeCompare(b._sortTitle || '');
                                if (c !== 0) return self.sortBy === 'title.desc' ? -c : c;
                                return ((a._year || '').localeCompare(b._year || ''));
                            });
                            self._combinedItems = filtered;
                            self._combinedTotal = filtered.length;
                            self._collectionFetchedAll = true;
                            self.renderCombined();
                        })
                        .catch(function () {
                            self.renderCombined();
                        });
                    return;
                }
            }

            if (self.viewMode === 'posters' && self._collectionFetchedAll) {
                items = items.slice(0, self._combinedPage * COLLECTION_PAGE_SIZE);
            }

            if (items.length === 0) {
                grid.style.display = 'flex';
                grid.style.alignItems = 'center';
                grid.style.justifyContent = 'center';
                grid.innerHTML = '<div style="text-align:center;color:#9ca3af;"><i class="fas fa-inbox" style="font-size:48px;opacity:0.4;margin-bottom:16px;display:block;"></i><p>No items in collection</p></div>';
                return;
            }

            function posterUrl(size) {
                return function (item) {
                    return item.poster_path ? getCollectionPosterUrl(item.poster_path, size) : './static/images/blackout.jpg';
                };
            }

            if (self.viewMode === 'table' && table && tableBody) {
                table.style.display = 'block';
                grid.style.display = 'none';
                tableBody.innerHTML = '';
                items.forEach(function (item) {
                    var tr = document.createElement('tr');
                    var title = (item.title || item.name || '').replace(/</g, '&lt;');
                    var year = item.year || item._year || '-';
                    var typeLabel = item.media_type === 'tv' ? 'TV' : 'Movie';
                    tr.innerHTML = '<td><img src="' + posterUrl('w92')(item) + '" class="table-poster" loading="lazy" onerror="this.src=\'./static/images/blackout.jpg\'"></td><td>' + title + '</td><td>' + year + '</td><td>' + typeLabel + '</td>';
                    tr.style.cursor = 'pointer';
                    tr.onclick = function () { self.onCardClick(item); };
                    tableBody.appendChild(tr);
                });
                applyCollectionCacheToImages(table);
            } else if (self.viewMode === 'overview' && overview && overviewList) {
                overview.style.display = 'block';
                grid.style.display = 'none';
                overviewList.innerHTML = '';
                items.forEach(function (item) {
                    var div = document.createElement('div');
                    div.className = 'media-overview-item';
                    var title = (item.title || item.name || '').replace(/</g, '&lt;');
                    var year = item.year || item._year || '-';
                    var typeLabel = item.media_type === 'tv' ? 'TV' : 'Movie';
                    div.innerHTML = '<div class="media-overview-poster"><img src="' + posterUrl('w200')(item) + '" loading="lazy" onerror="this.src=\'./static/images/blackout.jpg\'"></div><div class="media-overview-details"><div class="media-overview-title">' + title + ' <span class="media-overview-year">(' + year + ') · ' + typeLabel + '</span></div></div>';
                    div.style.cursor = 'pointer';
                    div.onclick = function () { self.onCardClick(item); };
                    overviewList.appendChild(div);
                });
                applyCollectionCacheToImages(overview);
            } else {
                items.forEach(function (item) {
                    grid.appendChild(self.createCombinedCard(item));
                });
                applyCollectionCacheToImages(grid);
            }
        },

        createCombinedCard: function (item) {
            var self = this;
            var card = document.createElement('div');
            card.className = 'media-card';
            var title = (item.title || item.name || '').replace(/</g, '&lt;').replace(/"/g, '&quot;');
            var year = item.year || item._year || 'N/A';
            var posterUrl = getCollectionPosterUrl(item.poster_path, 'w500');
            var typeBadgeLabel = item.media_type === 'tv' ? 'TV' : 'Movie';
            var status = item.status || (item.media_type === 'movie' ? (item.in_library ? 'available' : 'requested') : '');

            // Progress bar for combined view (compute first so we can use for TV icon)
            var combPct = 0;
            var combTotal = 0;
            var combAvail = 0;
            if (item.media_type === 'tv' && item.seasons) {
                var ignoreNonSeason = self._tvIgnoreNonSeason !== false;
                (item.seasons || []).forEach(function (s) {
                    if (ignoreNonSeason && parseInt(s.season_number || s.seasonNumber || 0, 10) === 0) return;
                    (s.episodes || []).forEach(function (ep) {
                        combTotal++;
                        if (ep.status === 'available' || ep.file_path) combAvail++;
                    });
                });
                combPct = combTotal > 0 ? Math.round((combAvail / combTotal) * 100) : 0;
            } else {
                combPct = status === 'available' ? 100 : 0;
            }

            // TV: green check when all episodes downloaded; Movie: green check when available
            var isComplete = item.media_type === 'tv' ? (combPct >= 100) : (status === 'available');
            var statusClass = isComplete ? 'complete' : 'partial';
            var statusIcon = isComplete ? 'check' : 'bookmark';
            if (isComplete) card.classList.add('in-library');
            var combBarClass = 'episode-progress-bar' + (combPct >= 100 ? ' complete' : (combPct === 0 ? ' empty' : ''));

            card.innerHTML = '<div class="media-card-poster">' +
                '<div class="media-card-status-badge ' + statusClass + '"><i class="fas fa-' + statusIcon + '"></i></div>' +
                '<span class="media-type-badge">' + typeBadgeLabel + '</span>' +
                '<img src="' + posterUrl + '" alt="' + title + '" loading="lazy" onerror="this.src=\'./static/images/blackout.jpg\'">' +
                '<div class="media-card-overlay"><div class="media-card-overlay-title">' + title + '</div><div class="media-card-overlay-content"><div class="media-card-overlay-year">' + year + '</div></div></div>' +
                '</div>' +
                '<div class="' + combBarClass + '"' + (item.media_type === 'tv' ? ' title="' + combAvail + ' / ' + combTotal + ' episodes (' + combPct + '%)"' : '') + '>' +
                '<div class="episode-progress-fill" style="width:' + combPct + '%"></div>' +
                '</div>' +
                '<div class="media-card-info"><div class="media-card-title" title="' + title + '">' + title + '</div><div class="media-card-meta"><span class="media-card-year">' + year + '</span> <span style="font-size:10px;opacity:0.8;">' + typeBadgeLabel + '</span></div></div>';
            card.style.cursor = 'pointer';
            card.onclick = function (e) {
                if (e.target.closest('.media-card-delete-btn')) return;
                self.onCardClick(item);
            };
            return card;
        },

        onCardClick: function (item) {
            if (item.media_type === 'tv' && window.RequestarrTVDetail) {
                window.RequestarrTVDetail.openDetail({ tmdb_id: item.tmdb_id, id: item.tmdb_id, title: item.title, poster_path: item.poster_path });
            } else if (item.media_type === 'movie' && window.RequestarrDetail) {
                window.RequestarrDetail.openDetail({
                    tmdb_id: item.tmdb_id,
                    id: item.tmdb_id,
                    title: item.title,
                    year: item.year,
                    poster_path: item.poster_path,
                    in_library: item.status === 'available'
                });
            }
        },

        showMainView: function () {
            var r = document.getElementById('media-hunt-collection-search-results-view');
            var m = document.getElementById('media-hunt-collection-main-content');
            var d = document.getElementById('media-hunt-collection-series-detail-view');
            if (r) r.style.display = 'none';
            if (d) d.style.display = 'none';
            if (m) m.style.display = 'block';
        },
        openSeriesDetail: function (tmdbId, seriesData) {
            if (window.RequestarrTVDetail) {
                window.RequestarrTVDetail.openDetail({ tmdb_id: tmdbId, id: tmdbId, title: (seriesData && seriesData.title) || '', poster_path: (seriesData && seriesData.poster_path) || '' });
            }
        }
    };
})();

