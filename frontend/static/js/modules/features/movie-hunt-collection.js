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
        items: [],

        init: function() {
            var self = this;
            this.page = 1;
            this.setupInstanceSelect();
            this.setupSort();
            this.setupSearch();
            this.setupSearchToRequest();
            // Pagination removed - all items load at once
            this.loadCollection();
        },

        setupSearchToRequest: function() {
            var input = document.getElementById('media-collection-search-to-request');
            var btn = document.getElementById('media-collection-search-to-request-btn');
            if (!input) return;
            var run = function() {
                var query = (input.value || '').trim();
                if (!query) return;
                if (window.huntarrUI && typeof window.huntarrUI.switchSection === 'function') {
                    window.huntarrUI.switchSection('requestarr-discover');
                }
                setTimeout(function() {
                    var globalSearch = document.getElementById('global-search-input');
                    if (globalSearch) {
                        globalSearch.value = query;
                        globalSearch.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                }, 100);
            };
            if (btn) btn.addEventListener('click', run);
            input.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); run(); } });
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
            var self = this;
            var input = document.getElementById('movie-hunt-collection-search');
            if (!input) return;
            input.value = this.searchQuery;
            input.oninput = function() {
                var q = (input.value || '').trim();
                if (self.searchQuery === q) return;
                self.searchQuery = q;
                self.page = 1;
                self.loadCollection();
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
            var grid = document.getElementById('movie-hunt-collection-grid');
            if (!grid) return;
            if (this.items.length === 0) {
                grid.style.display = 'flex';
                grid.style.alignItems = 'center';
                grid.style.justifyContent = 'center';
                grid.innerHTML = '<div style="text-align: center; color: #9ca3af; max-width: 600px;">' +
                    '<i class="fas fa-inbox" style="font-size: 64px; margin-bottom: 30px; opacity: 0.4; display: block;"></i>' +
                    '<p style="font-size: 20px; margin-bottom: 15px; font-weight: 500;">No Requested Media</p>' +
                    '<p style="font-size: 15px; line-height: 1.6; opacity: 0.8;">Movies you request from Movie Home will appear here. Track status as Requested or Available.</p></div>';
                return;
            }
            grid.style.display = 'grid';
            grid.style.alignItems = '';
            grid.style.justifyContent = '';
            grid.innerHTML = '';
            // Render all items (no pagination)
            for (var i = 0; i < this.items.length; i++) {
                grid.appendChild(this.createCard(this.items[i], i));
            }
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
