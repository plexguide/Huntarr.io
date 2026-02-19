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
