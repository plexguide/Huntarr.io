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
                        '<a href="./#media-hunt-instances" class="action-button" style="display: inline-flex; align-items: center; gap: 8px; background: rgba(99, 102, 241, 0.2); border: 1px solid rgba(99, 102, 241, 0.4); color: #818cf8; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 500; transition: all 0.2s ease;">' +
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

            var moviePct = status === 'available' ? 100 : 0;
            var movieBarClass = 'episode-progress-bar' + (moviePct >= 100 ? ' complete' : ' empty');

            card.innerHTML = '<div class="media-card-poster">' +
                '<div class="media-card-status-badge ' + statusClass + '"><i class="fas fa-' + statusIcon + '"></i></div>' +
                '<img src="' + posterUrl + '" alt="' + title + '" onerror="this.src=\'./static/images/blackout.jpg\'">' +
                '<div class="media-card-overlay">' +
                '<div class="media-card-overlay-title">' + titleRaw + '</div>' +
                '<div class="media-card-overlay-content">' +
                '<div class="media-card-overlay-year">' + year + '</div>' +
                '</div></div>' +
                '</div>' +
                '<div class="' + movieBarClass + '">' +
                '<div class="episode-progress-fill" style="width:' + moviePct + '%"></div>' +
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

            // Click anywhere on card opens Requestarr detail page
            if (item.tmdb_id) {
                card.style.cursor = 'pointer';
                card.onclick = function(e) {
                    if (e.target.closest && e.target.closest('.media-card-delete-btn')) return;
                    var movieData = {
                        tmdb_id: item.tmdb_id,
                        id: item.tmdb_id,
                        title: item.title,
                        year: item.year,
                        poster_path: item.poster_path,
                        in_library: status === 'available'
                    };
                    if (window.RequestarrDetail) {
                        window.RequestarrDetail.openDetail(movieData);
                    }
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
                    fetch('./api/tv-hunt/instances/current')
                        .then(function(r) { return r.json(); })
                        .then(function(d) {
                            if (d.current_instance_id) select.value = d.current_instance_id;
                            self.loadCollection();
                        });
                    select.addEventListener('change', function() {
                        fetch('./api/tv-hunt/instances/current', {
                            method: 'PUT',
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
            if (window._mediaHuntCollectionUnified && /\/tv\/\d+$/.test(window.location.hash || '')) {
                window.history.replaceState(null, document.title, (window.location.pathname || '') + (window.location.search || '') + '#media-hunt-collection');
            }
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
                        '<a href="./#media-hunt-instances" class="action-button" style="display: inline-flex; align-items: center; gap: 8px; background: rgba(99, 102, 241, 0.2); border: 1px solid rgba(99, 102, 241, 0.4); color: #818cf8; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 500; transition: all 0.2s ease;">' +
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
                    if (window.RequestarrTVDetail) {
                        window.RequestarrTVDetail.openDetail({ tmdb_id: series.tmdb_id, id: series.tmdb_id, title: series.title, poster_path: series.poster_path });
                    }
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
                    if (window.RequestarrTVDetail) {
                        window.RequestarrTVDetail.openDetail({ tmdb_id: series.tmdb_id, id: series.tmdb_id, title: series.title, poster_path: series.poster_path });
                    }
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
                var availableCount = 0;
                var seasonCount = (series.seasons || []).length;
                (series.seasons || []).forEach(function(s) {
                    (s.episodes || []).forEach(function(ep) {
                        episodeCount++;
                        if (ep.status === 'available' || ep.file_path) {
                            availableCount++;
                        }
                    });
                });
                var pct = episodeCount > 0 ? Math.round((availableCount / episodeCount) * 100) : 0;
                var barClass = 'episode-progress-bar';
                if (pct >= 100) barClass += ' complete';
                else if (pct === 0) barClass += ' empty';

                card.innerHTML =
                    '<div class="media-poster">' +
                        '<span class="media-type-badge">TV</span>' +
                        '<img src="' + posterUrl + '" alt="' + HuntarrUtils.escapeHtml(title) + '" loading="lazy">' +
                        '<div class="media-overlay">' +
                            '<span style="font-size:0.85em;color:#ddd;">' + seasonCount + ' Season' + (seasonCount !== 1 ? 's' : '') + ' &middot; ' + episodeCount + ' Ep' + (episodeCount !== 1 ? 's' : '') + '</span>' +
                        '</div>' +
                    '</div>' +
                    '<div class="' + barClass + '"' +
                        ' title="' + availableCount + ' / ' + episodeCount + ' episodes (' + pct + '%)">' +
                        '<div class="episode-progress-fill" style="width:' + pct + '%"></div>' +
                    '</div>' +
                    '<div class="media-info">' +
                        '<div class="media-title">' + HuntarrUtils.escapeHtml(title) + '</div>' +
                        '<div class="media-year">' + (year || '') + (series.status ? ' &middot; ' + HuntarrUtils.escapeHtml(series.status) : '') + '</div>' +
                    '</div>';

                card.addEventListener('click', function() {
                    if (window.RequestarrTVDetail) {
                        window.RequestarrTVDetail.openDetail({ tmdb_id: series.tmdb_id, id: series.tmdb_id, title: series.title, poster_path: series.poster_path });
                    }
                });
                grid.appendChild(card);
            });
        },

        // ─── Series Detail View (delegates to RequestarrTVDetail) ───
        openSeriesDetail: function(tmdbId, seriesData) {
            if (window.RequestarrTVDetail) {
                window.RequestarrTVDetail.openDetail({
                    tmdb_id: tmdbId,
                    id: tmdbId,
                    title: (seriesData && (seriesData.title || seriesData.name)) || '',
                    poster_path: (seriesData && seriesData.poster_path) || ''
                });
            }
        }
    };
})();

/**
 * Media Hunt Collection – Movie Hunt + TV Hunt instance dropdowns, combined library view.
 * Only shows Movie Hunt and TV Hunt instances (no Radarr/Sonarr).
 */
(function() {
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
        imgs.forEach(function(img) {
            var posterUrlVal = img.getAttribute('src');
            if (!posterUrlVal) return;
            window.getCachedTMDBImage(posterUrlVal, window.tmdbImageCache).then(function(cachedUrl) {
                if (cachedUrl && cachedUrl !== posterUrlVal) img.src = cachedUrl;
            }).catch(function() {});
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
        sortBy: 'title.asc',
        viewMode: 'posters',
        hiddenMediaSet: new Set(),

        init: function() {
            var hash = window.location.hash || '';
            var tvMatch = hash.match(/media-hunt-collection\/tv\/(\d+)/);
            var pendingTmdbId = tvMatch ? parseInt(tvMatch[1], 10) : null;
            if (!pendingTmdbId && window.TVHuntCollection && typeof window.TVHuntCollection.showMainView === 'function') {
                window.TVHuntCollection.showMainView();
            }
            if (!hasDualDropdowns()) return;
            window._mediaHuntCollectionUnified = true;
            window.TVHuntCollection._prefix = 'media-hunt-collection';
            window.MovieHuntCollection._prefix = 'media-hunt-collection';

            var self = this;
            var movieSelect = document.getElementById(movieSelectId);
            var tvSelect = document.getElementById(tvSelectId);
            if (!movieSelect || !tvSelect) return;

            // Populate dropdowns from Movie Hunt, TV Hunt, and indexers (for step-2 warning) — cache-bust for fresh data on navigate
            var ts = '?_=' + Date.now();
            var moviePromise = fetch('./api/movie-hunt/instances' + ts, { cache: 'no-store' }).then(function(r) { return r.json(); }).then(function(d) { return d.instances || []; }).catch(function() { return []; });
            var tvPromise = fetch('./api/tv-hunt/instances' + ts, { cache: 'no-store' }).then(function(r) { return r.json(); }).then(function(d) { return d.instances || []; }).catch(function() { return []; });
            var indexerPromise = fetch('./api/indexer-hunt/indexers' + ts, { cache: 'no-store' }).then(function(r) { return r.json(); }).then(function(d) { return d.indexers || []; }).catch(function() { return []; });
            var hasClientsPromise = fetch('./api/movie-hunt/has-clients' + ts, { cache: 'no-store' }).then(function(r) { return r.json(); }).then(function(d) { return d.has_clients === true; }).catch(function() { return false; });

            Promise.all([moviePromise, tvPromise, indexerPromise, hasClientsPromise]).then(function(results) {
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
                (movieInstances || []).forEach(function(inst) {
                    var opt = document.createElement('option');
                    opt.value = String(inst.id);
                    opt.textContent = inst.name || 'Instance ' + inst.id;
                    movieSelect.appendChild(opt);
                });

                tvSelect.innerHTML = '';
                tvSelect.appendChild(document.createElement('option')).value = ''; tvSelect.options[0].textContent = 'No TV Hunt instance';
                (tvInstances || []).forEach(function(inst) {
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
                self.loadHiddenMediaIds().then(function() { onInstanceChange(); });
            });

            var onInstanceChange = function() {
                self._movieInstanceId = movieSelect.value ? parseInt(movieSelect.value, 10) : null;
                self._tvInstanceId = tvSelect.value ? parseInt(tvSelect.value, 10) : null;
                // Update backend "current" instance so detail-view API calls (monitor, delete) use correct instance
                if (self._tvInstanceId) {
                    fetch('./api/tv-hunt/instances/current', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ instance_id: self._tvInstanceId })
                    }).catch(function() {});
                }
                if (self._movieInstanceId) {
                    fetch('./api/movie-hunt/instances/current', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ instance_id: self._movieInstanceId })
                    }).catch(function() {});
                }
                self.loadCombinedCollection();
            };
            movieSelect.addEventListener('change', onInstanceChange);
            tvSelect.addEventListener('change', onInstanceChange);

            // Wire TV series detail back button (TVHuntCollection owns the detail view)
            if (window.TVHuntCollection && typeof window.TVHuntCollection.setupBackButton === 'function') {
                window.TVHuntCollection.setupBackButton();
            }
        },

        loadHiddenMediaIds: function() {
            var self = this;
            return fetch('./api/requestarr/hidden-media?page=1&page_size=10000')
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    var items = Array.isArray(data) ? data : (Array.isArray(data.items) ? data.items : []);
                    self.hiddenMediaSet = new Set();
                    items.forEach(function(item) {
                        var key = item.tmdb_id + ':' + item.media_type + ':' + (item.app_type || '') + ':' + (item.instance_name || '');
                        self.hiddenMediaSet.add(key);
                    });
                })
                .catch(function() { self.hiddenMediaSet = new Set(); });
        },

        loadCombinedCollection: function(append) {
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
                    '<i class="fas fa-cog"></i> Set up instances</a></div>';
                return;
            }

            function filterAndSort(items) {
                var out = items.filter(function(item) {
                    if (!item.tmdb_id || !self.hiddenMediaSet || self.hiddenMediaSet.size === 0) return true;
                    var mt = item.media_type || 'movie';
                    for (var key of self.hiddenMediaSet) {
                        if (key.indexOf(item.tmdb_id + ':' + mt) === 0) return false;
                    }
                    return true;
                });
                out.sort(function(a, b) {
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

            function fallbackToLegacyApis() {
                var promises = [];
                if (self._movieInstanceId) {
                    promises.push(fetch('./api/movie-hunt/collection?instance_id=' + self._movieInstanceId + '&page=1&page_size=9999&sort=' + encodeURIComponent(self.sortBy || 'title.asc'))
                        .then(function(r) { return r.json(); })
                        .then(function(d) {
                            return (d.items || []).map(function(m) {
                                m.media_type = 'movie';
                                m._sortTitle = (m.title || '').toLowerCase();
                                m._year = m.year || '';
                                return m;
                            });
                        })
                        .catch(function() { return []; }));
                } else {
                    promises.push(Promise.resolve([]));
                }
                if (self._tvInstanceId) {
                    promises.push(fetch('./api/tv-hunt/collection?instance_id=' + self._tvInstanceId)
                        .then(function(r) { return r.json(); })
                        .then(function(d) {
                            var series = d.series || [];
                            return series.map(function(s) {
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
                        .catch(function() { return []; }));
                } else {
                    promises.push(Promise.resolve([]));
                }
                Promise.all(promises).then(function(results) {
                    var combined = (results[0] || []).concat(results[1] || []);
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
                    slice.forEach(function(item) {
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
                        .then(function(r) { return r.json(); })
                        .then(function(data) {
                            var items = data.items || [];
                            var total = data.total != null ? data.total : 0;
                            var filtered = filterAndSort(items);
                            self._combinedItems = self._combinedItems.concat(filtered);
                            self._combinedPage++;
                            self._collectionHasMore = (self._combinedPage * COLLECTION_PAGE_SIZE < total);
                            filtered.forEach(function(item) {
                                grid.appendChild(self.createCombinedCard(item));
                            });
                            applyCollectionCacheToImages(grid);
                        })
                        .catch(function() {})
                        .then(function() {
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

            fetch('./api/requestarr/collection?' + params.toString())
                .then(function(r) {
                    if (r.ok) return r.json().then(function(data) { processFirstPage(data); return null; });
                    if (r.status === 404) { fallbackToLegacyApis(); return null; }
                    throw new Error('Failed to load');
                })
                .catch(function() {
                    if (!append) grid.innerHTML = '<p style="color: #ef4444; text-align: center; padding: 60px;">Failed to load collection.</p>';
                });
        },

        setupCollectionInfiniteScroll: function() {
            var self = this;
            var sentinel = document.getElementById('media-hunt-collection-scroll-sentinel');
            var scrollRoot = document.querySelector('.main-content');
            if (!sentinel || self._collectionScrollObserver) return;
            self._collectionScrollObserver = new IntersectionObserver(
                function(entries) {
                    entries.forEach(function(entry) {
                        if (!entry.isIntersecting) return;
                        if (self.viewMode !== 'posters') return;
                        if (self._collectionHasMore && !self._collectionLoading) self.loadCombinedCollection(true);
                    });
                },
                { root: scrollRoot, rootMargin: '200px 0px', threshold: 0 }
            );
            self._collectionScrollObserver.observe(sentinel);
        },

        setupSort: function() {
            var self = this;
            var select = document.getElementById('media-hunt-collection-sort');
            if (!select) return;
            var opts = [
                { v: 'title.asc', t: 'Title (A-Z)' },
                { v: 'title.desc', t: 'Title (Z-A)' },
                { v: 'year.desc', t: 'Year (newest)' },
                { v: 'year.asc', t: 'Year (oldest)' }
            ];
            select.innerHTML = opts.map(function(o) { return '<option value="' + o.v + '">' + o.t + '</option>'; }).join('');
            var saved = HuntarrUtils.getUIPreference('media-hunt-collection-sort', 'title.asc');
            if (saved) select.value = saved;
            self.sortBy = select.value || 'title.asc';
            select.onchange = function() {
                self.sortBy = select.value;
                HuntarrUtils.setUIPreference('media-hunt-collection-sort', self.sortBy);
                self.loadCombinedCollection();
            };
        },

        setupViewMode: function() {
            var self = this;
            var select = document.getElementById('media-hunt-collection-view-mode');
            if (!select) return;
            self.viewMode = HuntarrUtils.getUIPreference('media-hunt-collection-view', 'posters') || 'posters';
            select.value = self.viewMode;
            select.onchange = function() {
                self.viewMode = select.value;
                HuntarrUtils.setUIPreference('media-hunt-collection-view', self.viewMode);
                self.renderCombined();
            };
        },

        setupSearch: function() {
            var self = this;
            var input = document.getElementById('media-hunt-collection-search-input');
            if (!input) return;
            input.value = '';
            input.addEventListener('input', function() {
                if (self._searchTm) clearTimeout(self._searchTm);
                var q = (input.value || '').trim();
                self._searchTm = setTimeout(function() {
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

        performSearch: function(query) {
            // Simplified: filter combined items client-side
            var q = (query || '').toLowerCase();
            var filtered = this._combinedItems.filter(function(item) {
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
            filtered.forEach(function(item) {
                grid.appendChild(this.createCombinedCard(item));
            }.bind(this));
            applyCollectionCacheToImages(grid);
        },

        renderCombined: function() {
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
            if (self.sortBy === 'year.desc') items = items.slice().sort(function(a, b) { return (b._year || '').localeCompare(a._year || ''); });
            else if (self.sortBy === 'year.asc') items = items.slice().sort(function(a, b) { return (a._year || '').localeCompare(b._year || ''); });
            else if (self.sortBy === 'title.desc') items = items.slice().sort(function(a, b) { return (b._sortTitle || '').localeCompare(a._sortTitle || ''); });
            else items = items.slice().sort(function(a, b) { return (a._sortTitle || '').localeCompare(b._sortTitle || ''); });

            if (self.viewMode === 'table' || self.viewMode === 'overview') {
                if (!self._collectionFetchedAll && items.length < self._combinedTotal && self._combinedTotal > 0) {
                    var params = new URLSearchParams();
                    if (self._movieInstanceId) params.set('movie_instance_id', self._movieInstanceId);
                    if (self._tvInstanceId) params.set('tv_instance_id', self._tvInstanceId);
                    params.set('page', '1');
                    params.set('page_size', String(Math.min(10000, self._combinedTotal)));
                    params.set('sort', self.sortBy || 'title.asc');
                    fetch('./api/requestarr/collection?' + params.toString())
                        .then(function(r) { return r.json(); })
                        .then(function(data) {
                            var raw = data.items || [];
                            var filtered = raw.filter(function(item) {
                                if (!item.tmdb_id || !self.hiddenMediaSet || self.hiddenMediaSet.size === 0) return true;
                                var mt = item.media_type || 'movie';
                                for (var key of self.hiddenMediaSet) {
                                    if (key.indexOf(item.tmdb_id + ':' + mt) === 0) return false;
                                }
                                return true;
                            });
                            filtered.sort(function(a, b) {
                                var c = (a._sortTitle || '').localeCompare(b._sortTitle || '');
                                if (c !== 0) return self.sortBy === 'title.desc' ? -c : c;
                                return ((a._year || '').localeCompare(b._year || ''));
                            });
                            self._combinedItems = filtered;
                            self._combinedTotal = filtered.length;
                            self._collectionFetchedAll = true;
                            self.renderCombined();
                        })
                        .catch(function() {
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
                return function(item) {
                    return item.poster_path ? getCollectionPosterUrl(item.poster_path, size) : './static/images/blackout.jpg';
                };
            }

            if (self.viewMode === 'table' && table && tableBody) {
                table.style.display = 'block';
                grid.style.display = 'none';
                tableBody.innerHTML = '';
                items.forEach(function(item) {
                    var tr = document.createElement('tr');
                    var title = (item.title || item.name || '').replace(/</g, '&lt;');
                    var year = item.year || item._year || '-';
                    var typeLabel = item.media_type === 'tv' ? 'TV' : 'Movie';
                    tr.innerHTML = '<td><img src="' + posterUrl('w92')(item) + '" class="table-poster" loading="lazy" onerror="this.src=\'./static/images/blackout.jpg\'"></td><td>' + title + '</td><td>' + year + '</td><td>' + typeLabel + '</td>';
                    tr.style.cursor = 'pointer';
                    tr.onclick = function() { self.onCardClick(item); };
                    tableBody.appendChild(tr);
                });
                applyCollectionCacheToImages(table);
            } else if (self.viewMode === 'overview' && overview && overviewList) {
                overview.style.display = 'block';
                grid.style.display = 'none';
                overviewList.innerHTML = '';
                items.forEach(function(item) {
                    var div = document.createElement('div');
                    div.className = 'media-overview-item';
                    var title = (item.title || item.name || '').replace(/</g, '&lt;');
                    var year = item.year || item._year || '-';
                    var typeLabel = item.media_type === 'tv' ? 'TV' : 'Movie';
                    div.innerHTML = '<div class="media-overview-poster"><img src="' + posterUrl('w200')(item) + '" loading="lazy" onerror="this.src=\'./static/images/blackout.jpg\'"></div><div class="media-overview-details"><div class="media-overview-title">' + title + ' <span class="media-overview-year">(' + year + ') · ' + typeLabel + '</span></div></div>';
                    div.style.cursor = 'pointer';
                    div.onclick = function() { self.onCardClick(item); };
                    overviewList.appendChild(div);
                });
                applyCollectionCacheToImages(overview);
            } else {
                items.forEach(function(item) {
                    grid.appendChild(self.createCombinedCard(item));
                });
                applyCollectionCacheToImages(grid);
            }
        },

        createCombinedCard: function(item) {
            var self = this;
            var card = document.createElement('div');
            card.className = 'media-card';
            var title = (item.title || item.name || '').replace(/</g, '&lt;').replace(/"/g, '&quot;');
            var year = item.year || item._year || 'N/A';
            var posterUrl = getCollectionPosterUrl(item.poster_path, 'w500');
            var typeBadgeLabel = item.media_type === 'tv' ? 'TV' : 'Movie';
            var status = item.status || (item.media_type === 'movie' ? (item.in_library ? 'available' : 'requested') : '');
            var statusClass = status === 'available' ? 'complete' : 'partial';
            var statusIcon = status === 'available' ? 'check' : 'bookmark';
            if (status === 'available') card.classList.add('in-library');

            // Progress bar for combined view
            var combPct = 0;
            var combTotal = 0;
            var combAvail = 0;
            if (item.media_type === 'tv' && item.seasons) {
                (item.seasons || []).forEach(function(s) {
                    (s.episodes || []).forEach(function(ep) {
                        combTotal++;
                        if (ep.status === 'available' || ep.file_path) combAvail++;
                    });
                });
                combPct = combTotal > 0 ? Math.round((combAvail / combTotal) * 100) : 0;
            } else {
                combPct = status === 'available' ? 100 : 0;
            }
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
            card.onclick = function(e) {
                if (e.target.closest('.media-card-delete-btn')) return;
                self.onCardClick(item);
            };
            return card;
        },

        onCardClick: function(item) {
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

        showMainView: function() {
            var r = document.getElementById('media-hunt-collection-search-results-view');
            var m = document.getElementById('media-hunt-collection-main-content');
            var d = document.getElementById('media-hunt-collection-series-detail-view');
            if (r) r.style.display = 'none';
            if (d) d.style.display = 'none';
            if (m) m.style.display = 'block';
        },
        openSeriesDetail: function(tmdbId, seriesData) {
            if (window.RequestarrTVDetail) {
                window.RequestarrTVDetail.openDetail({ tmdb_id: tmdbId, id: tmdbId, title: (seriesData && seriesData.title) || '', poster_path: (seriesData && seriesData.poster_path) || '' });
            }
        }
    };
})();
