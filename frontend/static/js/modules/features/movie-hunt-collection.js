/**
 * Movie Hunt Media Collection - requested movies and status (requested / available).
 * Template based on Requestarr hidden media. Attaches to window.MovieHuntCollection.
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
            var self = this;
            this.page = 1;
            // Load saved view mode
            var savedView = (typeof localStorage !== 'undefined' && localStorage.getItem('movie-hunt-collection-view')) || 'posters';
            this.viewMode = savedView;
            this.setupInstanceSelect();
            this.setupSort();
            this.setupSearch();
            this.setupSearchToRequest();
            this.setupViewMode();
            // Pagination removed - all items load at once
            this.loadCollection();
        },

        setupSearchToRequest: function() {
            var self = this;
            var input = document.getElementById('media-collection-search-to-request');
            var clearBtn = document.getElementById('media-collection-clear-search-btn');
            if (!input) return;
            
            var searchTimeout;
            
            var performSearch = function() {
                var query = (input.value || '').trim();
                if (!query) {
                    clearSearch();
                    return;
                }
                if (clearBtn) clearBtn.style.display = 'block';
                self.searchTMDB(query);
            };
            
            var clearSearch = function() {
                input.value = '';
                var resultsContainer = document.getElementById('media-collection-tmdb-results');
                if (resultsContainer) resultsContainer.style.display = 'none';
                if (clearBtn) clearBtn.style.display = 'none';
            };
            
            // Auto-search on input with debounce
            input.addEventListener('input', function() {
                clearTimeout(searchTimeout);
                searchTimeout = setTimeout(performSearch, 400);
            });
            
            if (clearBtn) clearBtn.addEventListener('click', clearSearch);
        },

        searchTMDB: function(query) {
            var self = this;
            var resultsContainer = document.getElementById('media-collection-tmdb-results');
            var resultsGrid = document.getElementById('media-collection-tmdb-grid');
            var clearBtn = document.getElementById('media-collection-clear-search-btn');
            if (!resultsContainer || !resultsGrid) return;
            
            resultsContainer.style.display = 'block';
            if (clearBtn) clearBtn.style.display = 'inline-block';
            resultsGrid.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Searching...</p></div>';
            
            fetch('./api/search/movies?query=' + encodeURIComponent(query))
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (!data.results || data.results.length === 0) {
                        resultsGrid.innerHTML = '<p style="text-align: center; color: rgba(148, 163, 184, 0.6); padding: 40px;">No results found</p>';
                        return;
                    }
                    resultsGrid.innerHTML = '';
                    for (var i = 0; i < Math.min(data.results.length, 20); i++) {
                        var movie = data.results[i];
                        var card = self.createTMDBCard(movie);
                        resultsGrid.appendChild(card);
                    }
                })
                .catch(function(err) {
                    console.error('Search error:', err);
                    resultsGrid.innerHTML = '<p style="text-align: center; color: #ef4444; padding: 40px;">Search failed</p>';
                });
        },

        createTMDBCard: function(movie) {
            var self = this;
            var card = document.createElement('div');
            card.className = 'media-card';
            var title = (movie.title || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
            var year = movie.release_date ? movie.release_date.split('-')[0] : 'N/A';
            var posterUrl = movie.poster_path ? 'https://image.tmdb.org/t/p/w500' + movie.poster_path : './static/images/blackout.jpg';
            
            // Check if already in collection
            var inCollection = false;
            for (var i = 0; i < this.items.length; i++) {
                if (this.items[i].tmdb_id == movie.id) {
                    inCollection = true;
                    break;
                }
            }
            
            var statusBadge = inCollection ? '<div class="media-card-status-badge complete"><i class="fas fa-check"></i></div>' : '';
            
            card.innerHTML = '<div class="media-card-poster">' + statusBadge +
                '<img src="' + posterUrl + '" alt="' + title + '" onerror="this.src=\'./static/images/blackout.jpg\'">' +
                '</div>' +
                '<div class="media-card-info">' +
                '<div class="media-card-title">' + title + '</div>' +
                '<div class="media-card-year">' + year + '</div>' +
                '</div>';
            
            card.onclick = function() {
                if (window.MovieHunt && window.MovieHunt.openMovieHuntRequestModal) {
                    window.MovieHunt.openMovieHuntRequestModal(movie);
                }
            };
            card.style.cursor = 'pointer';
            
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
                select.innerHTML = '<option value="1">Default Instance</option>';
            }
        },

        setupSort: function() {
            var self = this;
            var select = document.getElementById('movie-hunt-collection-sort');
            if (!select) return;
            var saved = (typeof localStorage !== 'undefined' && localStorage.getItem('movie-hunt-collection-sort')) || 'title.asc';
            if (saved) {
                self.sortBy = saved;
                try { select.value = saved; } catch (e) {}
            }
            select.onchange = function() {
                self.sortBy = (select.value || 'title.asc').trim();
                if (typeof localStorage !== 'undefined') localStorage.setItem('movie-hunt-collection-sort', self.sortBy);
                self.page = 1;
                self.loadCollection();
            };
        },

        setupSearch: function() {
            // Old filter search removed - now using TMDB search only
        },

        setupViewMode: function() {
            var self = this;
            var select = document.getElementById('movie-hunt-collection-view-mode');
            if (!select) return;
            select.value = this.viewMode;
            select.onchange = function() {
                self.viewMode = select.value;
                if (typeof localStorage !== 'undefined') localStorage.setItem('movie-hunt-collection-view', self.viewMode);
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
            var year = item.year || 'N/A';
            var status = (item.status || 'requested').toLowerCase();
            var posterUrl = (item.poster_path && item.poster_path.indexOf('http') === 0) ? item.poster_path : (item.poster_path ? 'https://image.tmdb.org/t/p/w500' + (item.poster_path.indexOf('/') === 0 ? item.poster_path : '/' + item.poster_path) : './static/images/blackout.jpg');
            if (!item.poster_path) posterUrl = './static/images/blackout.jpg';
            // Check = have it (available), yellow exclamation = missing (requested)
            var statusClass = status === 'available' ? 'complete' : 'missing';
            var statusIcon = status === 'available' ? 'check' : 'exclamation';
            var statusLabel = status === 'available' ? 'Available' : 'Missing';
            card.innerHTML = '<div class="media-card-poster">' +
                '<div class="media-card-status-badge ' + statusClass + '"><i class="fas fa-' + statusIcon + '"></i></div>' +
                '<img src="' + posterUrl + '" alt="' + title + '" onerror="this.src=\'./static/images/blackout.jpg\'">' +
                '</div>' +
                '<div class="media-card-info">' +
                '<div class="media-card-title" title="' + title + '">' + (item.title || '').replace(/</g, '&lt;') + '</div>' +
                '<div class="media-card-meta">' +
                '<span class="media-card-year">' + year + '</span>' +
                '<span class="media-card-rating" style="font-size: 12px; color: #94a3b8;">' + statusLabel + '</span>' +
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
                        in_library: status === 'available',
                        in_cooldown: false
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
