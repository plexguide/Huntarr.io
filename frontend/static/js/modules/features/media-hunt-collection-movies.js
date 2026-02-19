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
