/**
 * TV Hunt Collection – series list with expandable seasons and episodes.
 * Mirrors Sonarr's series detail view: header with info, then accordion seasons with episode tables.
 */
(function() {
    'use strict';

    window.TVHuntCollection = {
        items: [],
        sortBy: 'title.asc',
        viewMode: 'posters',
        searchQuery: '',

        init: function() {
            this.viewMode = HuntarrUtils.getUIPreference('tv-hunt-collection-view', 'posters');
            this.setupInstanceSelect();
            this.setupSort();
            this.setupViewMode();
            this.setupSearch();
            this.setupBackButton();
            this.loadCollection();
        },

        setupInstanceSelect: function() {
            var self = this;
            var select = document.getElementById('tv-hunt-collection-instance-select');
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
                    fetch('./api/tv-hunt/current-instance')
                        .then(function(r) { return r.json(); })
                        .then(function(d) {
                            if (d.instance_id) select.value = d.instance_id;
                            self.loadCollection();
                        });
                    select.addEventListener('change', function() {
                        fetch('./api/tv-hunt/current-instance', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ instance_id: parseInt(select.value) })
                        }).then(function() { self.loadCollection(); });
                    });
                });
        },

        setupSort: function() {
            var self = this;
            var sortSelect = document.getElementById('tv-hunt-collection-sort');
            if (!sortSelect) return;
            sortSelect.addEventListener('change', function() {
                self.sortBy = sortSelect.value;
                self.renderCollection();
            });
        },

        setupViewMode: function() {
            var self = this;
            var select = document.getElementById('tv-hunt-collection-view-mode');
            if (!select) return;
            select.value = this.viewMode;
            select.addEventListener('change', function() {
                self.viewMode = select.value;
                HuntarrUtils.setUIPreference('tv-hunt-collection-view', self.viewMode);
                self.renderCollection();
            });
        },

        setupSearch: function() {
            var self = this;
            var input = document.getElementById('tv-hunt-collection-search-input');
            if (!input) return;
            var timeout;
            input.addEventListener('input', function() {
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
            var btn = document.getElementById('tv-hunt-series-back-btn');
            if (btn) {
                btn.addEventListener('click', function() {
                    self.showMainView();
                });
            }
        },

        showMainView: function() {
            var mainView = document.getElementById('tv-hunt-collection-main-view');
            var detailView = document.getElementById('tv-hunt-series-detail-view');
            var searchView = document.getElementById('tv-hunt-collection-search-results-view');
            if (mainView) mainView.style.display = 'block';
            if (detailView) detailView.style.display = 'none';
            if (searchView) searchView.style.display = 'none';
        },

        performCollectionSearch: function(query) {
            // Search within collection or TMDB for adding
            var self = this;
            var mainView = document.getElementById('tv-hunt-collection-main-view');
            var searchView = document.getElementById('tv-hunt-collection-search-results-view');
            var detailView = document.getElementById('tv-hunt-series-detail-view');
            var grid = document.getElementById('tv-hunt-collection-search-results-grid');
            if (mainView) mainView.style.display = 'none';
            if (detailView) detailView.style.display = 'none';
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
                        var card = self._createSearchCard(show);
                        grid.appendChild(card);
                    });
                })
                .catch(function() {
                    if (grid) grid.innerHTML = '<p style="text-align:center;color:#f87171;">Search failed.</p>';
                });
        },

        _createSearchCard: function(show) {
            var self = this;
            var card = document.createElement('div');
            card.className = 'media-card';
            var posterUrl = show.poster_path
                ? 'https://image.tmdb.org/t/p/w300' + show.poster_path
                : './static/images/no-poster.png';
            var title = show.name || show.original_name || 'Unknown';
            var year = (show.first_air_date || '').substring(0, 4);

            // Check if already in collection
            var inCollection = self.items.some(function(s) { return s.tmdb_id === show.id; });

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
                    addBtn.addEventListener('click', function(e) {
                        e.stopPropagation();
                        window.TVHunt.addToCollection(show);
                        addBtn.outerHTML = '<span style="color:#4ade80;font-size:0.9em;"><i class="fas fa-check"></i> Added</span>';
                    });
                }
            }
            return card;
        },

        getCurrentInstanceId: function() {
            var select = document.getElementById('tv-hunt-collection-instance-select');
            return select ? select.value : '';
        },

        loadCollection: function() {
            var self = this;
            var grid = document.getElementById('tv-hunt-collection-grid');
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
            var grid = document.getElementById('tv-hunt-collection-grid');
            var table = document.getElementById('tv-hunt-collection-table');
            var tableBody = document.getElementById('tv-hunt-collection-table-body');
            var overview = document.getElementById('tv-hunt-collection-overview');
            var overviewList = document.getElementById('tv-hunt-collection-overview-list');
            if (grid) grid.style.display = 'none';
            if (table) table.style.display = 'none';
            if (overview) overview.style.display = 'none';

            var instanceSelect = document.getElementById('tv-hunt-collection-instance-select');
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
                        '<a href="./#tv-hunt-settings" class="action-button" style="display: inline-flex; align-items: center; gap: 8px; background: rgba(99, 102, 241, 0.2); border: 1px solid rgba(99, 102, 241, 0.4); color: #818cf8; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 500; transition: all 0.2s ease;">' +
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
                    self.openSeriesDetail(series.tmdb_id, series);
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
                    self.openSeriesDetail(series.tmdb_id, series);
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
                var seasonCount = (series.seasons || []).length;
                (series.seasons || []).forEach(function(s) {
                    episodeCount += (s.episodes || []).length;
                });

                card.innerHTML =
                    '<div class="media-poster">' +
                        '<img src="' + posterUrl + '" alt="' + HuntarrUtils.escapeHtml(title) + '" loading="lazy">' +
                        '<div class="media-overlay">' +
                            '<span style="font-size:0.85em;color:#ddd;">' + seasonCount + ' Season' + (seasonCount !== 1 ? 's' : '') + ' &middot; ' + episodeCount + ' Ep' + (episodeCount !== 1 ? 's' : '') + '</span>' +
                        '</div>' +
                    '</div>' +
                    '<div class="media-info">' +
                        '<div class="media-title">' + HuntarrUtils.escapeHtml(title) + '</div>' +
                        '<div class="media-year">' + (year || '') + (series.status ? ' &middot; ' + HuntarrUtils.escapeHtml(series.status) : '') + '</div>' +
                    '</div>';

                card.addEventListener('click', function() {
                    self.openSeriesDetail(series.tmdb_id, series);
                });
                grid.appendChild(card);
            });
        },

        // ─── Series Detail View (Sonarr-style seasons/episodes) ───
        openSeriesDetail: function(tmdbId, seriesData) {
            var self = this;
            var mainView = document.getElementById('tv-hunt-collection-main-view');
            var detailView = document.getElementById('tv-hunt-series-detail-view');
            var searchView = document.getElementById('tv-hunt-collection-search-results-view');
            var content = document.getElementById('tv-hunt-series-detail-content');
            if (mainView) mainView.style.display = 'none';
            if (searchView) searchView.style.display = 'none';
            if (detailView) detailView.style.display = 'block';
            if (content) content.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Loading series...</p></div>';

            // Use local collection data if available
            if (seriesData) {
                self._renderSeriesDetail(content, seriesData);
                return;
            }

            // Find in collection
            var found = self.items.find(function(s) { return s.tmdb_id === tmdbId; });
            if (found) {
                self._renderSeriesDetail(content, found);
                return;
            }

            // Fetch from TMDB
            fetch('./api/tv-hunt/series/' + tmdbId)
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    self._renderSeriesDetail(content, data);
                })
                .catch(function() {
                    if (content) content.innerHTML = '<p style="color:#f87171;">Failed to load series details.</p>';
                });
        },

        _renderSeriesDetail: function(container, series) {
            var self = this;
            if (!container) return;
            container.innerHTML = '';

            // Series banner
            var banner = document.createElement('div');
            banner.className = 'series-info-banner';
            var posterUrl = series.poster_path
                ? 'https://image.tmdb.org/t/p/w300' + series.poster_path
                : './static/images/no-poster.png';
            var title = series.title || series.name || 'Unknown';
            var year = (series.first_air_date || '').substring(0, 4);
            var genres = (series.genres || []).map(function(g) { return g.name || g; }).join(', ');
            var networks = (series.networks || []).map(function(n) { return n.name || n; }).join(', ');
            var rating = series.vote_average ? parseFloat(series.vote_average).toFixed(1) : '';

            banner.innerHTML =
                '<div class="series-poster"><img src="' + posterUrl + '" alt="' + HuntarrUtils.escapeHtml(title) + '"></div>' +
                '<div class="series-meta">' +
                    '<h2>' + HuntarrUtils.escapeHtml(title) + '</h2>' +
                    '<div class="series-meta-tags">' +
                        (year ? '<span class="series-meta-tag"><i class="fas fa-calendar"></i> ' + year + '</span>' : '') +
                        (rating ? '<span class="series-meta-tag"><i class="fas fa-star" style="color:#facc15;"></i> ' + rating + '%</span>' : '') +
                        (genres ? '<span class="series-meta-tag"><i class="fas fa-tag"></i> ' + HuntarrUtils.escapeHtml(genres) + '</span>' : '') +
                        (series.status ? '<span class="series-meta-tag"><i class="fas fa-circle"></i> ' + HuntarrUtils.escapeHtml(series.status) + '</span>' : '') +
                        (networks ? '<span class="series-meta-tag"><i class="fas fa-tv"></i> ' + HuntarrUtils.escapeHtml(networks) + '</span>' : '') +
                        (series.number_of_seasons ? '<span class="series-meta-tag"><i class="fas fa-layer-group"></i> ' + series.number_of_seasons + ' Seasons</span>' : '') +
                        (series.number_of_episodes ? '<span class="series-meta-tag"><i class="fas fa-film"></i> ' + series.number_of_episodes + ' Episodes</span>' : '') +
                    '</div>' +
                    '<div class="series-overview">' + HuntarrUtils.escapeHtml(series.overview || '') + '</div>' +
                '</div>';
            container.appendChild(banner);

            // Seasons accordion
            var seasons = series.seasons || [];
            // Sort seasons: specials (0) last, then by number descending (newest first)
            seasons.sort(function(a, b) {
                if (a.season_number === 0) return 1;
                if (b.season_number === 0) return -1;
                return b.season_number - a.season_number;
            });

            seasons.forEach(function(season) {
                container.appendChild(self._createSeasonAccordion(series, season));
            });
        },

        _createSeasonAccordion: function(series, season) {
            var self = this;
            var wrapper = document.createElement('div');
            wrapper.className = 'season-accordion';

            var episodes = season.episodes || [];
            var totalEps = episodes.length;
            var monitoredCount = episodes.filter(function(e) { return e.monitored !== false; }).length;
            var now = new Date();

            // Count statuses
            var availCount = 0;
            var unairedCount = 0;
            episodes.forEach(function(ep) {
                if (ep.status === 'available') availCount++;
                var airDate = ep.air_date ? new Date(ep.air_date) : null;
                if (airDate && airDate > now) unairedCount++;
            });

            var countClass = availCount === totalEps && totalEps > 0 ? 'all-available' : (availCount > 0 ? 'partial' : 'none-available');
            var countText = availCount + ' / ' + totalEps;
            var seasonName = season.name || ('Season ' + season.season_number);
            var isSpecials = season.season_number === 0;
            var isMonitored = season.monitored !== false;

            // Header
            var header = document.createElement('div');
            header.className = 'season-accordion-header';
            header.innerHTML =
                '<span class="season-chevron"><i class="fas fa-chevron-right"></i></span>' +
                '<span class="season-icon"><i class="fas fa-bookmark"></i></span>' +
                '<span class="season-name">' + HuntarrUtils.escapeHtml(seasonName) + '</span>' +
                '<span class="season-episode-count ' + countClass + '">' + countText + '</span>' +
                '<span class="season-status-icon">' +
                    (availCount === totalEps && totalEps > 0 ? '<i class="fas fa-check-circle" style="color:#4ade80;"></i>' : '') +
                '</span>' +
                '<div class="season-actions">' +
                    '<button class="season-action-btn season-search-btn" title="Search Season"><i class="fas fa-search"></i></button>' +
                '</div>';

            // Episode body
            var body = document.createElement('div');
            body.className = 'season-episodes-body';

            var table = document.createElement('table');
            table.className = 'episode-table';
            table.innerHTML = '<thead><tr>' +
                '<th class="ep-monitor"></th>' +
                '<th class="ep-number">#</th>' +
                '<th class="ep-title">Title</th>' +
                '<th class="ep-airdate">Air Date</th>' +
                '<th class="ep-status">Status</th>' +
                '<th class="ep-actions"></th>' +
                '</tr></thead>';

            var tbody = document.createElement('tbody');
            episodes.forEach(function(ep) {
                var tr = document.createElement('tr');
                var epMonitored = ep.monitored !== false;
                var airDate = ep.air_date || '';
                var airDateObj = airDate ? new Date(airDate) : null;
                var isUnaired = airDateObj && airDateObj > now;
                var statusClass = isUnaired ? 'unaired' : (ep.status === 'available' ? 'available' : 'missing');
                var statusText = isUnaired ? 'Unaired' : (ep.status === 'available' ? 'On Disk' : 'Missing');
                var formattedDate = airDate ? self._formatDate(airDate) : '';

                tr.innerHTML =
                    '<td class="ep-monitor"><span class="monitor-checkbox ' + (epMonitored ? 'monitored' : '') + '" data-ep="' + ep.episode_number + '" data-season="' + season.season_number + '"><i class="fas fa-bookmark"></i></span></td>' +
                    '<td class="ep-number">' + (ep.episode_number || '') + '</td>' +
                    '<td class="ep-title">' + HuntarrUtils.escapeHtml(ep.title || 'Episode ' + ep.episode_number) + '</td>' +
                    '<td class="ep-airdate">' + formattedDate + '</td>' +
                    '<td class="ep-status"><span class="ep-status-badge ' + statusClass + '">' + statusText + '</span></td>' +
                    '<td class="ep-actions">' +
                        (!isUnaired && statusClass !== 'available' ? '<button class="ep-action-btn ep-search-btn" title="Search Episode" data-season="' + season.season_number + '" data-ep="' + ep.episode_number + '"><i class="fas fa-search"></i></button>' : '') +
                    '</td>';
                tbody.appendChild(tr);
            });
            table.appendChild(tbody);
            body.appendChild(table);

            // Toggle accordion
            header.addEventListener('click', function(e) {
                if (e.target.closest('.season-action-btn') || e.target.closest('.monitor-checkbox')) return;
                header.classList.toggle('expanded');
                body.classList.toggle('expanded');
            });

            // Season search button
            var searchBtn = header.querySelector('.season-search-btn');
            if (searchBtn) {
                searchBtn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    self._searchSeason(series, season);
                });
            }

            // Episode search buttons
            body.querySelectorAll('.ep-search-btn').forEach(function(btn) {
                btn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    var sn = parseInt(btn.dataset.season);
                    var en = parseInt(btn.dataset.ep);
                    self._searchEpisode(series, sn, en);
                });
            });

            // Monitor toggles
            body.querySelectorAll('.monitor-checkbox').forEach(function(cb) {
                cb.addEventListener('click', function(e) {
                    e.stopPropagation();
                    var sn = parseInt(cb.dataset.season);
                    var en = parseInt(cb.dataset.ep);
                    var newState = !cb.classList.contains('monitored');
                    cb.classList.toggle('monitored');
                    self._toggleEpisodeMonitor(series.tmdb_id, sn, en, newState);
                });
            });

            wrapper.appendChild(header);
            wrapper.appendChild(body);
            return wrapper;
        },

        _formatDate: function(dateStr) {
            if (!dateStr) return '';
            try {
                var d = new Date(dateStr);
                var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                return months[d.getMonth()] + ' ' + d.getDate() + ' ' + d.getFullYear();
            } catch (e) {
                return dateStr;
            }
        },

        _searchSeason: function(series, season) {
            var instanceId = this.getCurrentInstanceId();
            if (!instanceId) {
                window.huntarrUI.showNotification('No instance selected.', 'error');
                return;
            }
            window.huntarrUI.showNotification('Searching for ' + (series.title || '') + ' S' + String(season.season_number).padStart(2, '0') + '...', 'info');
            fetch('./api/tv-hunt/request?instance_id=' + instanceId, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    series_title: series.title,
                    season_number: season.season_number,
                    tmdb_id: series.tmdb_id,
                    search_type: 'season',
                    instance_id: instanceId,
                })
            })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.success) {
                        window.huntarrUI.showNotification(data.message || 'Season search sent!', 'success');
                    } else {
                        window.huntarrUI.showNotification(data.message || 'No results found.', 'error');
                    }
                })
                .catch(function() {
                    window.huntarrUI.showNotification('Search request failed.', 'error');
                });
        },

        _searchEpisode: function(series, seasonNumber, episodeNumber) {
            var instanceId = this.getCurrentInstanceId();
            if (!instanceId) {
                window.huntarrUI.showNotification('No instance selected.', 'error');
                return;
            }
            var label = (series.title || '') + ' S' + String(seasonNumber).padStart(2, '0') + 'E' + String(episodeNumber).padStart(2, '0');
            window.huntarrUI.showNotification('Searching for ' + label + '...', 'info');
            fetch('./api/tv-hunt/request?instance_id=' + instanceId, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    series_title: series.title,
                    season_number: seasonNumber,
                    episode_number: episodeNumber,
                    tmdb_id: series.tmdb_id,
                    search_type: 'episode',
                    instance_id: instanceId,
                })
            })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.success) {
                        window.huntarrUI.showNotification(data.message || 'Episode search sent!', 'success');
                    } else {
                        window.huntarrUI.showNotification(data.message || 'No results found.', 'error');
                    }
                })
                .catch(function() {
                    window.huntarrUI.showNotification('Search request failed.', 'error');
                });
        },

        _toggleEpisodeMonitor: function(tmdbId, seasonNumber, episodeNumber, monitored) {
            var instanceId = this.getCurrentInstanceId();
            if (!instanceId) return;
            fetch('./api/tv-hunt/collection/' + tmdbId + '/monitor?instance_id=' + instanceId, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    season_number: seasonNumber,
                    episode_number: episodeNumber,
                    monitored: monitored,
                    instance_id: instanceId,
                })
            }).catch(function() {});
        },

        // ─── Delete series ───
        deleteSeries: function(tmdbId, title) {
            var self = this;
            var instanceId = self.getCurrentInstanceId();
            if (!instanceId) return;
            window.HuntarrConfirm.show({
                title: 'Delete Series',
                message: 'Are you sure you want to remove "' + (title || 'this series') + '" from your collection?',
                confirmLabel: 'Delete',
                onConfirm: function() {
                    fetch('./api/tv-hunt/collection/' + tmdbId + '?instance_id=' + instanceId, { method: 'DELETE' })
                        .then(function(r) { return r.json(); })
                        .then(function(data) {
                            if (data.success) {
                                window.huntarrUI.showNotification('Series removed from collection.', 'success');
                                self.loadCollection();
                                self.showMainView();
                            } else {
                                window.huntarrUI.showNotification(data.error || 'Failed to delete.', 'error');
                            }
                        })
                        .catch(function() {
                            window.huntarrUI.showNotification('Failed to delete series.', 'error');
                        });
                }
            });
        }
    };
})();
