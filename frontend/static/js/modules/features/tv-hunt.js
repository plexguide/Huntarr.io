/**
 * TV Hunt – main module for TV show discovery and search.
 * Handles TMDB discover, search, and add-to-collection flows.
 */
(function() {
    'use strict';

    var _page = 1;
    var _loading = false;
    var _observer = null;
    var _currentSort = 'popularity.desc';
    var _currentInstanceId = null;

    window.TVHunt = {
        init: function() {
            _page = 1;
            _loading = false;
            this.setupInstanceSelect();
            this.setupSort();
            this.setupSearch();
            this.setupInfiniteScroll();
            this.loadDiscover();
        },

        setupInstanceSelect: function() {
            var self = this;
            var select = document.getElementById('tv-hunt-instance-select');
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
                    // Load current instance
                    fetch('./api/tv-hunt/current-instance')
                        .then(function(r) { return r.json(); })
                        .then(function(d) {
                            if (d.instance_id) {
                                select.value = d.instance_id;
                                _currentInstanceId = d.instance_id;
                            }
                        });
                    select.addEventListener('change', function() {
                        _currentInstanceId = select.value;
                        fetch('./api/tv-hunt/current-instance', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ instance_id: parseInt(select.value) })
                        });
                    });
                });
        },

        setupSort: function() {
            var self = this;
            var sortSelect = document.getElementById('tv-hunt-sort');
            if (!sortSelect) return;
            sortSelect.addEventListener('change', function() {
                _currentSort = sortSelect.value;
                _page = 1;
                self.loadDiscover();
            });
        },

        setupSearch: function() {
            var self = this;
            var input = document.getElementById('tv-hunt-search-input');
            if (!input) return;
            var timeout;
            input.addEventListener('input', function() {
                if (timeout) clearTimeout(timeout);
                var q = (input.value || '').trim();
                if (!q) {
                    self.showMainView();
                    return;
                }
                timeout = setTimeout(function() {
                    self.performSearch(q);
                }, 500);
            });
        },

        showMainView: function() {
            var mainView = document.getElementById('tv-hunt-main-view');
            var searchView = document.getElementById('tv-hunt-search-results-view');
            if (mainView) mainView.style.display = 'block';
            if (searchView) searchView.style.display = 'none';
        },

        performSearch: function(query) {
            var self = this;
            var mainView = document.getElementById('tv-hunt-main-view');
            var searchView = document.getElementById('tv-hunt-search-results-view');
            var grid = document.getElementById('tv-hunt-search-results-grid');
            if (mainView) mainView.style.display = 'none';
            if (searchView) searchView.style.display = 'block';
            if (grid) grid.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Searching...</p></div>';

            fetch('./api/tv-hunt/search?q=' + encodeURIComponent(query))
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    var results = data.results || [];
                    if (!grid) return;
                    if (results.length === 0) {
                        grid.innerHTML = '<p style="text-align:center;color:#888;padding:40px;">No results found.</p>';
                        return;
                    }
                    grid.innerHTML = '';
                    results.forEach(function(show) {
                        grid.appendChild(self._createShowCard(show));
                    });
                })
                .catch(function(err) {
                    if (grid) grid.innerHTML = '<p style="text-align:center;color:#f87171;">Search failed.</p>';
                });
        },

        loadDiscover: function() {
            var self = this;
            var grid = document.getElementById('tv-hunt-shows-grid');
            if (!grid) return;
            if (_page === 1) {
                grid.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Loading TV shows...</p></div>';
            }
            _loading = true;
            fetch('./api/tv-hunt/discover/tv?page=' + _page + '&sort_by=' + encodeURIComponent(_currentSort))
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    var results = data.results || [];
                    if (_page === 1) grid.innerHTML = '';
                    results.forEach(function(show) {
                        grid.appendChild(self._createShowCard(show));
                    });
                    _loading = false;
                })
                .catch(function(err) {
                    _loading = false;
                    if (_page === 1 && grid) {
                        grid.innerHTML = '<p style="text-align:center;color:#f87171;">Failed to load TV shows.</p>';
                    }
                });
        },

        setupInfiniteScroll: function() {
            var self = this;
            var sentinel = document.getElementById('tv-hunt-scroll-sentinel');
            if (!sentinel) return;
            if (_observer) _observer.disconnect();
            _observer = new IntersectionObserver(function(entries) {
                if (entries[0].isIntersecting && !_loading) {
                    _page++;
                    self.loadDiscover();
                }
            }, { rootMargin: '200px' });
            _observer.observe(sentinel);
        },

        _createShowCard: function(show) {
            var card = document.createElement('div');
            card.className = 'media-card';
            card.dataset.tmdbId = show.id;
            var posterUrl = show.poster_path
                ? 'https://image.tmdb.org/t/p/w300' + show.poster_path
                : './static/images/no-poster.png';
            var title = show.name || show.original_name || 'Unknown';
            var year = (show.first_air_date || '').substring(0, 4);
            var rating = show.vote_average ? parseFloat(show.vote_average).toFixed(1) : '';

            card.innerHTML =
                '<div class="media-poster">' +
                    '<img src="' + posterUrl + '" alt="' + HuntarrUtils.escapeHtml(title) + '" loading="lazy">' +
                    '<div class="media-overlay">' +
                        '<button class="add-to-collection-btn" title="Add to Collection"><i class="fas fa-plus"></i></button>' +
                    '</div>' +
                '</div>' +
                '<div class="media-info">' +
                    '<div class="media-title">' + HuntarrUtils.escapeHtml(title) + '</div>' +
                    '<div class="media-year">' + (year || '') + (rating ? ' &middot; <i class="fas fa-star" style="color:#facc15;font-size:0.8em;"></i> ' + rating : '') + '</div>' +
                '</div>';

            var addBtn = card.querySelector('.add-to-collection-btn');
            if (addBtn) {
                addBtn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    window.TVHunt.addToCollection(show);
                });
            }

            card.addEventListener('click', function() {
                window.TVHunt.showSeriesDetail(show.id);
            });

            return card;
        },

        addToCollection: function(show) {
            if (!_currentInstanceId) {
                window.huntarrUI.showNotification('Please select an instance first.', 'error');
                return;
            }
            fetch('./api/tv-hunt/collection?instance_id=' + _currentInstanceId, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tmdb_id: show.id,
                    title: show.name || show.original_name,
                    poster_path: show.poster_path || '',
                    backdrop_path: show.backdrop_path || '',
                    first_air_date: show.first_air_date || '',
                    vote_average: show.vote_average || 0,
                    overview: show.overview || '',
                    instance_id: _currentInstanceId,
                })
            })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.exists) {
                        window.huntarrUI.showNotification('Series already in collection.', 'info');
                    } else if (data.success) {
                        window.huntarrUI.showNotification('Added to collection!', 'success');
                    } else {
                        window.huntarrUI.showNotification(data.error || 'Failed to add.', 'error');
                    }
                })
                .catch(function() {
                    window.huntarrUI.showNotification('Network error adding to collection.', 'error');
                });
        },

        showSeriesDetail: function(tmdbId) {
            // Open series detail in the collection view
            if (window.TVHuntCollection && typeof window.TVHuntCollection.openSeriesDetail === 'function') {
                window.TVHuntCollection.openSeriesDetail(tmdbId);
            }
        }
    };
})();
