/**
 * Movie Hunt Movie Collection - requested movies and status (requested / available).
 * Users go to Request Movies (#requestarr-movies) to add movies; this view lists the collection.
 */
(function() {
    'use strict';

    window.MovieHuntCollection = {
        page: 1,
        pageSize: 9999, // Load all items (no pagination)
        total: 0,
        searchQuery: '',
        sortBy: 'title.asc',
        viewMode: 'posters', // posters, table, overview
        items: [],

        init: function() {
            this.page = 1;
            this.viewMode = HuntarrUtils.getUIPreference('movie-hunt-collection-view', 'posters');
            this.setupInstanceSelect();
            this.setupSort();
            this.setupViewMode();
            this.setupSearch();
            this.loadCollection();
        },

        setupSearch: function() {
            var self = this;
            var input = document.getElementById('movie-hunt-collection-search-input');
            if (!input) return;

            input.addEventListener('input', function() {
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
            var resultsView = document.getElementById('movie-hunt-collection-search-results-view');
            var mainContent = document.getElementById('movie-hunt-collection-main-content');
            if (resultsView) resultsView.style.display = 'none';
            if (mainContent) mainContent.style.display = 'block';
        },

        showResultsView: function() {
            var resultsView = document.getElementById('movie-hunt-collection-search-results-view');
            var mainContent = document.getElementById('movie-hunt-collection-main-content');
            if (resultsView) resultsView.style.display = 'block';
            if (mainContent) mainContent.style.display = 'none';
        },

        performSearch: function(query) {
            var self = this;
            var grid = document.getElementById('movie-hunt-collection-search-results-grid');
            if (!grid) return;

            self.showResultsView();
            grid.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Searching movies...</p></div>';

            // Use the currently selected Movie Hunt instance for library status check
            var instanceSelect = document.getElementById('movie-hunt-collection-instance-select');
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
            // Use the global createMediaCard if available (via HomeRequestarr/RequestarrContent)
            // or fall back to a simplified version if not
            if (window.HomeRequestarr && typeof window.HomeRequestarr.createMediaCard === 'function') {
                // Determine suggested instance
                var instanceSelect = document.getElementById('movie-hunt-collection-instance-select');
                var suggestedInstance = instanceSelect ? instanceSelect.value : null;
                // If the value doesn't already have the prefix, add it
                if (suggestedInstance && suggestedInstance.indexOf('movie_hunt:') !== 0) {
                    suggestedInstance = 'movie_hunt:' + suggestedInstance;
                }
                return window.HomeRequestarr.createMediaCard(item, suggestedInstance);
            }

            // Fallback simplified card
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
                '<button class="media-card-request-btn"><i class="fas fa-download"></i> Request</button>' +
                '</div></div>' +
                '</div>' +
                '<div class="media-card-info">' +
                '<div class="media-card-title" title="' + title + '">' + title + '</div>' +
                '<div class="media-card-meta">' +
                '<span class="media-card-year">' + year + '</span>' +
                '</div></div>';

            card.onclick = function() {
                var instanceSelect = document.getElementById('movie-hunt-collection-instance-select');
                var suggestedInstance = instanceSelect ? instanceSelect.value : null;
                if (suggestedInstance && suggestedInstance.indexOf('movie_hunt:') !== 0) {
                    suggestedInstance = 'movie_hunt:' + suggestedInstance;
                }
                
                if (window.MovieHuntDetail && window.MovieHuntDetail.openDetail) {
                    window.MovieHuntDetail.openDetail(item, { suggestedInstance: suggestedInstance });
                }
            };

            return card;
        },

        setupInstanceSelect: function() {
            var select = document.getElementById('movie-hunt-collection-instance-select');
            if (!select) return;
            if (window.MovieHuntInstanceDropdown && window.MovieHuntInstanceDropdown.attach) {
                window.MovieHuntInstanceDropdown.attach('movie-hunt-collection-instance-select', function() {
                    window.MovieHuntCollection.page = 1;
                    window.MovieHuntCollection.loadCollection();
                });
            } else {
                select.innerHTML = '<option value="">No Movie Hunt instances</option>';
            }
        },

        setupSort: function() {
            var self = this;
            var select = document.getElementById('movie-hunt-collection-sort');
            if (!select) return;
            var saved = HuntarrUtils.getUIPreference('movie-hunt-collection-sort', 'title.asc');
            if (saved) {
                self.sortBy = saved;
                try { select.value = saved; } catch (e) {}
            }
            select.onchange = function() {
                self.sortBy = (select.value || 'title.asc').trim();
                HuntarrUtils.setUIPreference('movie-hunt-collection-sort', self.sortBy);
                self.page = 1;
                self.loadCollection();
            };
        },

        setupViewMode: function() {
            var self = this;
            var select = document.getElementById('movie-hunt-collection-view-mode');
            if (!select) return;
            select.value = this.viewMode;
            select.onchange = function() {
                self.viewMode = select.value;
                HuntarrUtils.setUIPreference('movie-hunt-collection-view', self.viewMode);
                self.renderPage();
            };
        },

        loadCollection: function() {
            var self = this;
            var grid = document.getElementById('movie-hunt-collection-grid');
            if (!grid) return;
            grid.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Loading media collection...</p></div>';
            grid.style.display = 'flex';
            // No pagination - load all items at once
            var url = './api/movie-hunt/collection?page=' + this.page + '&page_size=' + this.pageSize + '&sort=' + encodeURIComponent(this.sortBy || 'title.asc');
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
            var grid = document.getElementById('movie-hunt-collection-grid');
            var table = document.getElementById('movie-hunt-collection-table');
            var overview = document.getElementById('movie-hunt-collection-overview');
            if (grid) grid.style.display = 'none';
            if (table) table.style.display = 'none';
            if (overview) overview.style.display = 'none';

            var instanceSelect = document.getElementById('movie-hunt-collection-instance-select');
            var opt = instanceSelect && instanceSelect.options[instanceSelect.selectedIndex];
            var noInstances = instanceSelect && (!instanceSelect.value || instanceSelect.value === '') &&
                (!opt || (opt.value === '' && (opt.textContent || '').trim().indexOf('No Movie Hunt') !== -1));

            if (noInstances) {
                if (grid) {
                    grid.style.display = 'flex';
                    grid.style.alignItems = 'center';
                    grid.style.justifyContent = 'center';
                    grid.innerHTML = '<div style="text-align: center; color: #9ca3af; max-width: 600px;">' +
                        '<i class="fas fa-cube" style="font-size: 64px; margin-bottom: 30px; opacity: 0.4; display: block;"></i>' +
                        '<p style="font-size: 20px; margin-bottom: 15px; font-weight: 500;">No Movie Hunt instance</p>' +
                        '<p style="font-size: 15px; line-height: 1.6; opacity: 0.8; margin-bottom: 20px;">Create a Movie Hunt instance to manage your media collection and requested movies.</p>' +
                        '<a href="./#movie-hunt-settings" class="action-button" style="display: inline-flex; align-items: center; gap: 8px; background: rgba(99, 102, 241, 0.2); border: 1px solid rgba(99, 102, 241, 0.4); color: #818cf8; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 500; transition: all 0.2s ease;">' +
                        '<i class="fas fa-cog"></i> Set up Movie Hunt instance</a></div>';
                }
                return;
            }

            if (this.items.length === 0) {
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
                this.renderTable();
            } else if (this.viewMode === 'overview') {
                this.renderOverview();
            } else {
                this.renderPosters();
            }
        },

        renderPosters: function() {
            var grid = document.getElementById('movie-hunt-collection-grid');
            if (!grid) return;
            grid.style.display = 'grid';
            grid.style.alignItems = '';
            grid.style.justifyContent = '';
            grid.innerHTML = '';
            // Render all items (no pagination)
            for (var i = 0; i < this.items.length; i++) {
                grid.appendChild(this.createCard(this.items[i], i));
            }
        },

        renderTable: function() {
            var table = document.getElementById('movie-hunt-collection-table');
            var tbody = document.getElementById('movie-hunt-collection-table-body');
            if (!table || !tbody) return;
            table.style.display = 'block';
            tbody.innerHTML = '';
            for (var i = 0; i < this.items.length; i++) {
                var item = this.items[i];
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

        renderOverview: function() {
            var overview = document.getElementById('movie-hunt-collection-overview');
            var list = document.getElementById('movie-hunt-collection-overview-list');
            if (!overview || !list) return;
            overview.style.display = 'block';
            list.innerHTML = '';
            for (var i = 0; i < this.items.length; i++) {
                var item = this.items[i];
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
                '</div></div>';

            // Click anywhere on card opens detail page
            if (item.tmdb_id && window.MovieHuntDetail && window.MovieHuntDetail.openDetail) {
                card.style.cursor = 'pointer';
                card.onclick = function() {
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
                if (!confirm('Remove this movie from your requested list?')) return;
                doRemove();
            }
        }
    };
})();
