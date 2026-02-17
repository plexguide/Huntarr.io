/**
 * Stats & Dashboard Module
 * Handles media stats, app connections, dashboard display,
 * grid/list view, live polling, and drag-and-drop reordering.
 */

window.HuntarrStats = {
    isLoadingStats: false,
    _pollInterval: null,
    _currentViewMode: 'list', // 'grid' or 'list'
    _lastRenderedMode: null,  // Track which mode we last rendered

    // App metadata: order, display names, icons, accent colors
    APP_META: {
        tv_hunt:    { label: 'TV Hunt',    icon: './static/logo/256.png', accent: '#a855f7' },
        movie_hunt: { label: 'Movie Hunt', icon: './static/logo/256.png', accent: '#f59e0b' },
        sonarr:     { label: 'Sonarr',     icon: './static/images/app-icons/sonarr.png', accent: '#6366f1' },
        radarr:     { label: 'Radarr',     icon: './static/images/app-icons/radarr.png', accent: '#f59e0b' },
        lidarr:     { label: 'Lidarr',     icon: './static/images/app-icons/lidarr.png', accent: '#22c55e' },
        readarr:    { label: 'Readarr',    icon: './static/images/app-icons/readarr.png', accent: '#a855f7' },
        whisparr:   { label: 'Whisparr V2', icon: './static/images/app-icons/whisparr.png', accent: '#ec4899' },
        eros:       { label: 'Whisparr V3', icon: './static/images/app-icons/whisparr.png', accent: '#ec4899' }
    },
    DEFAULT_APP_ORDER: ['tv_hunt', 'movie_hunt', 'sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros'],

    // ─── Polling ──────────────────────────────────────────────────────
    startPolling: function() {
        this.stopPolling();
        var self = this;
        this._pollInterval = setInterval(function() {
            self.loadMediaStats(true);
        }, 15000);
    },

    stopPolling: function() {
        if (this._pollInterval) {
            clearInterval(this._pollInterval);
            this._pollInterval = null;
        }
        this._stopNzbHomePoll();
    },

    // ─── Layout Persistence ───────────────────────────────────────────
    _getLayout: function() {
        return HuntarrUtils.getUIPreference('dashboard-layout', null);
    },

    _saveLayout: function(layout) {
        HuntarrUtils.setUIPreference('dashboard-layout', layout);
    },

    _getGroupOrder: function() {
        var layout = this._getLayout();
        if (layout && Array.isArray(layout.groups) && layout.groups.length > 0) {
            var order = layout.groups.slice();
            this.DEFAULT_APP_ORDER.forEach(function(app) {
                if (order.indexOf(app) === -1) order.push(app);
            });
            return order;
        }
        return this.DEFAULT_APP_ORDER.slice();
    },

    _getCardOrder: function() {
        var layout = this._getLayout();
        if (layout && Array.isArray(layout.cards) && layout.cards.length > 0) {
            return layout.cards;
        }
        return null;
    },

    // Collect card order for grid mode (flat list of {app, instance} pairs)
    _collectGridOrder: function() {
        var grid = document.getElementById('app-stats-grid');
        if (!grid) return;
        var cards = grid.querySelectorAll('.app-stats-card[data-app][data-instance-name]');
        var cardOrder = [];
        cards.forEach(function(c) {
            cardOrder.push({
                app: c.getAttribute('data-app'),
                instance: c.getAttribute('data-instance-name')
            });
        });
        // Also build group order from the card order (for list mode)
        var seen = {};
        var groups = [];
        cardOrder.forEach(function(c) {
            if (!seen[c.app]) {
                seen[c.app] = true;
                groups.push(c.app);
            }
        });
        this._saveLayout({ groups: groups, cards: cardOrder });
    },

    // Collect group order for list mode
    _collectListOrder: function() {
        var grid = document.getElementById('app-stats-grid');
        if (!grid) return;
        var groupEls = grid.querySelectorAll('.app-group');
        var groups = [];
        groupEls.forEach(function(g) {
            var app = g.getAttribute('data-app');
            if (app) groups.push(app);
        });
        var layout = this._getLayout() || {};
        layout.groups = groups;
        this._saveLayout(layout);
    },

    // ─── View Mode ────────────────────────────────────────────────────
    _getViewMode: function() {
        var mode = HuntarrUtils.getUIPreference('dashboard-view-mode', 'list');
        if (mode === 'list' || mode === 'grid') return mode;
        return 'list';
    },

    _setViewMode: function(mode) {
        this._currentViewMode = mode;
        HuntarrUtils.setUIPreference('dashboard-view-mode', mode);
    },

    initViewToggle: function() {
        var self = this;
        var savedMode = this._getViewMode();
        var needsRerender = (this._lastRenderedMode && savedMode !== this._lastRenderedMode);
        this._currentViewMode = savedMode;

        var toggleGroup = document.getElementById('dashboard-view-toggle');
        if (!toggleGroup) return;

        // Remove old listeners by cloning
        var newToggle = toggleGroup.cloneNode(true);
        toggleGroup.parentNode.replaceChild(newToggle, toggleGroup);

        var btns = newToggle.querySelectorAll('.view-toggle-btn');
        btns.forEach(function(btn) {
            btn.classList.toggle('active', btn.getAttribute('data-view') === self._currentViewMode);
            btn.addEventListener('click', function() {
                var mode = this.getAttribute('data-view');
                if (mode === self._currentViewMode) return;
                btns.forEach(function(b) { b.classList.remove('active'); });
                this.classList.add('active');
                self._setViewMode(mode);
                self._clearDynamicContent();
                if (window.mediaStats) {
                    self.updateStatsDisplay(window.mediaStats);
                }
            });
        });

        // If the saved view mode differs from what was rendered, re-render now
        if (needsRerender && window.mediaStats) {
            this._clearDynamicContent();
            this.updateStatsDisplay(window.mediaStats);
        }
    },

    // Clear all dynamically generated content + sortable instances
    _clearDynamicContent: function() {
        // Destroy sortable instances
        if (this._sortableGrid) {
            this._sortableGrid.destroy();
            this._sortableGrid = null;
        }
        var grid = document.getElementById('app-stats-grid');
        if (!grid) return;
        // Remove all dynamic elements (app-group containers and direct app-stats-cards we created)
        var dynamicEls = grid.querySelectorAll('.app-group, .app-stats-card.dynamic-card');
        dynamicEls.forEach(function(el) { el.remove(); });
        this._lastRenderedMode = null;
    },

    // ─── Stats Loading ────────────────────────────────────────────────
    loadMediaStats: function(skipCache) {
        if (this.isLoadingStats) return;
        this.isLoadingStats = true;

        var self = this;

        if (!skipCache) {
            var cachedStats = localStorage.getItem('huntarr-stats-cache');
            if (cachedStats) {
                try {
                    var parsedStats = JSON.parse(cachedStats);
                    var cacheAge = Date.now() - (parsedStats.timestamp || 0);
                    // Use cache if less than 1 hour old for immediate UI
                    if (cacheAge < 3600000) {
                        this.updateStatsDisplay(parsedStats.stats, true);
                        // Show grid immediately from cache so it's not blank while checking connections
                        this.updateEmptyStateVisibility(true);
                    }
                } catch (e) {}
            }
        }

        var statsContainer = document.querySelector('.media-stats-container');
        if (statsContainer && !skipCache) {
            statsContainer.classList.add('stats-loading');
        }

        HuntarrUtils.fetchWithTimeout('./api/stats')
            .then(function(response) {
                if (!response.ok) throw new Error('Network response was not ok');
                return response.json();
            })
            .then(function(data) {
                if (data.success && data.stats) {
                    window.mediaStats = data.stats;
                    localStorage.setItem('huntarr-stats-cache', JSON.stringify({
                        stats: data.stats,
                        timestamp: Date.now()
                    }));
                    self.updateStatsDisplay(data.stats);
                    if (statsContainer) statsContainer.classList.remove('stats-loading');
                }
            })
            .catch(function(error) {
                console.error('Error fetching statistics:', error);
                if (statsContainer) statsContainer.classList.remove('stats-loading');
            })
            .finally(function() {
                self.isLoadingStats = false;
            });

        // Also fetch NZB Hunt home stats (separate from main stats pipeline)
        self._fetchNzbHuntHomeStats();
        self._checkNzbHuntWarning();
        self._initNzbHomePauseBtn();
    },

    // ─── Main Display Update ──────────────────────────────────────────
    updateStatsDisplay: function(stats, isFromCache) {
        // If mode changed, clear and rebuild
        if (this._lastRenderedMode && this._lastRenderedMode !== this._currentViewMode) {
            this._clearDynamicContent();
        }
        if (this._currentViewMode === 'list') {
            this._renderListView(stats, isFromCache);
        } else {
            this._renderGridView(stats, isFromCache);
        }
        this._lastRenderedMode = this._currentViewMode;
    },

    // ─── Grid View (Flat Cards with Drag Handles) ─────────────────────
    _renderGridView: function(stats, isFromCache) {
        var grid = document.getElementById('app-stats-grid');
        if (!grid) {
            grid = document.querySelector('.app-stats-grid');
            if (grid) grid.id = 'app-stats-grid';
            else return;
        }

        // Switch CSS class
        grid.classList.remove('app-stats-list');
        grid.classList.add('app-stats-grid');

        var self = this;
        var groupOrder = this._getGroupOrder();
        var savedCardOrder = this._getCardOrder();

        // Build a flat list of all cards to render: [{app, meta, inst}, ...]
        var allCards = [];
        var ui = window.huntarrUI || {};
        var mediaHuntApps = { movie_hunt: true, tv_hunt: true };
        var thirdPartyApps = { sonarr: true, radarr: true, lidarr: true, readarr: true, whisparr: true, eros: true };
        groupOrder.forEach(function(app) {
            if (!stats[app]) return;
            if (mediaHuntApps[app] && ui._enableMediaHunt === false) return;
            if (thirdPartyApps[app] && ui._enableThirdPartyApps === false) return;
            var hasInstances = stats[app].instances && stats[app].instances.length > 0;
            var isConfigured = ui.configuredApps && ui.configuredApps[app];
            if (!hasInstances && !stats[app].hunted && !stats[app].upgraded && !isConfigured) return;

            var meta = self.APP_META[app] || { label: app, icon: '', accent: '#94a3b8' };
            var instances = hasInstances ? stats[app].instances : [];

            if (instances.length === 0) {
                allCards.push({
                    app: app,
                    meta: meta,
                    inst: {
                        hunted: stats[app].hunted || 0,
                        upgraded: stats[app].upgraded || 0,
                        found: stats[app].found || 0,
                        found_upgrade: stats[app].found_upgrade || 0,
                        api_hits: 0, api_limit: 20,
                        instance_name: meta.label,
                        api_url: ''
                    }
                });
            } else {
                instances.forEach(function(inst) {
                    allCards.push({ app: app, meta: meta, inst: inst });
                });
            }
        });

        // Apply saved card order if available
        if (savedCardOrder && savedCardOrder.length > 0) {
            allCards.sort(function(a, b) {
                var keyA = a.app + '|' + (a.inst.instance_name || '');
                var keyB = b.app + '|' + (b.inst.instance_name || '');
                var idxA = -1, idxB = -1;
                for (var i = 0; i < savedCardOrder.length; i++) {
                    var sk = savedCardOrder[i].app + '|' + (savedCardOrder[i].instance || '');
                    if (sk === keyA) idxA = i;
                    if (sk === keyB) idxB = i;
                }
                if (idxA === -1) idxA = 9999;
                if (idxB === -1) idxB = 9999;
                return idxA - idxB;
            });
        }

        // Build/update cards in DOM
        var existingCards = grid.querySelectorAll('.app-stats-card.dynamic-card');
        var existingMap = {};
        existingCards.forEach(function(c) {
            var key = c.getAttribute('data-app') + '|' + c.getAttribute('data-instance-name');
            existingMap[key] = c;
        });

        allCards.forEach(function(entry, idx) {
            var key = entry.app + '|' + (entry.inst.instance_name || '');
            var card = existingMap[key];
            if (!card) {
                card = self._createCard(entry.app, entry.meta);
                card.classList.add('dynamic-card');
                card.setAttribute('data-app', entry.app);
                grid.appendChild(card);
            }
            self._updateCard(card, entry.app, entry.meta, entry.inst, isFromCache, entry.meta.label);
            // Ensure it's in the grid at the right position
            grid.appendChild(card);
            delete existingMap[key];
        });

        // Remove cards no longer in data
        Object.keys(existingMap).forEach(function(key) {
            existingMap[key].remove();
        });

        // Hide old static cards from template
        var oldCards = grid.querySelectorAll(':scope > .app-stats-card:not(.dynamic-card), :scope > .app-stats-card-wrapper, :scope > .app-group');
        oldCards.forEach(function(c) { c.style.display = 'none'; });

        // Initialize SortableJS for flat grid
        this._initGridSortable(grid);

        // Refresh cycle timers — timer elements are already baked into cards,
        // but CycleCountdown needs to know about them and populate data
        this._refreshCycleTimers();

        setTimeout(function() {
            if (typeof window.loadHourlyCapData === 'function') {
                window.loadHourlyCapData();
            }
        }, 200);
    },

    // ─── Create a Card Element (with drag handle + baked-in timer) ────
    _createCard: function(app, meta) {
        var card = document.createElement('div');
        card.className = 'app-stats-card ' + app;
        var cssClass = app.replace(/-/g, '');
        card.innerHTML =
            '<div class="card-drag-handle" title="Drag to reorder"><i class="fas fa-grip-vertical"></i></div>' +
            '<div class="status-container"><span class="status-badge"></span></div>' +
            '<div class="hourly-cap-container">' +
                '<div class="hourly-cap-status">' +
                    '<span class="hourly-cap-icon"></span>' +
                    '<span class="hourly-cap-text">API: <span>0</span> / <span>--</span></span>' +
                '</div>' +
                '<div class="api-progress-container">' +
                    '<div class="api-progress-bar"><div class="api-progress-fill" style="width: 0%;"></div></div>' +
                    '<div class="api-progress-text">API: <span>0</span> / <span>--</span></div>' +
                '</div>' +
            '</div>' +
            '<div class="app-content">' +
                '<div class="app-icon-wrapper"><img src="' + meta.icon + '" alt="" class="app-logo"></div>' +
                '<h4>' + meta.label + '</h4>' +
            '</div>' +
            '<div class="stats-numbers">' +
                '<div class="stat-box">' +
                    (app === 'movie_hunt' || app === 'tv_hunt'
                        ? '<span class="stat-number-found-wrap"><span class="stat-number stat-found">0</span> / <span class="stat-number">0</span></span>'
                        : '<span class="stat-number">0</span>') +
                    '<span class="stat-label">' + (app === 'movie_hunt' || app === 'tv_hunt' ? 'Found / Searched' : 'Searches Triggered') + '</span>' +
                '</div>' +
                '<div class="stat-box">' +
                    (app === 'movie_hunt' || app === 'tv_hunt'
                        ? '<span class="stat-number-found-wrap"><span class="stat-number stat-found">0</span> / <span class="stat-number">0</span></span>'
                        : '<span class="stat-number">0</span>') +
                    '<span class="stat-label">' + (app === 'movie_hunt' || app === 'tv_hunt' ? 'Found / Upgrades' : 'Upgrades Triggered') + '</span>' +
                '</div>' +
            '</div>' +
            '<div class="reset-button-container">' +
                '<div class="reset-and-timer-container">' +
                    '<button class="cycle-reset-button" data-app="' + app + '"><i class="fas fa-sync-alt"></i> Reset</button>' +
                    '<div class="cycle-timer inline-timer ' + cssClass + '" data-app-type="' + app + '">' +
                        '<i class="fas fa-clock ' + cssClass + '-icon"></i> <span class="timer-value">Loading...</span>' +
                    '</div>' +
                '</div>' +
            '</div>';
        return card;
    },

    // ─── Update a Card Element ────────────────────────────────────────
    _updateCard: function(card, app, meta, inst, isFromCache, appLabel) {
        var hunted = Math.max(0, parseInt(inst.hunted) || 0);
        var upgraded = Math.max(0, parseInt(inst.upgraded) || 0);
        var name = inst.instance_name || 'Default';
        var apiHits = Math.max(0, parseInt(inst.api_hits) || 0);
        var apiLimit = Math.max(1, parseInt(inst.api_limit) || 20);
        var apiUrl = (inst.api_url || '').trim();

        card.style.display = '';
        card.setAttribute('data-instance-name', name);
        card.setAttribute('data-app', app);

        // Title
        var h4 = card.querySelector('.app-content h4');
        if (h4) {
            var displayText = name !== appLabel ? appLabel + ' \u2013 ' + name : appLabel;
            if (apiUrl) {
                var link = h4.querySelector('.instance-name-link');
                if (!link) {
                    h4.textContent = '';
                    link = document.createElement('a');
                    link.className = 'instance-name-link';
                    link.target = '_blank';
                    link.rel = 'noopener noreferrer';
                    link.title = 'Open instance in new tab';
                    h4.appendChild(link);
                }
                link.href = apiUrl;
                link.textContent = displayText;
            } else {
                h4.textContent = displayText;
            }
        }

        // Stat numbers — Movie Hunt uses "found / searched" layout
        if (app === 'movie_hunt' || app === 'tv_hunt') {
            var found = Math.max(0, parseInt(inst.found) || 0);
            var foundUpgrade = Math.max(0, parseInt(inst.found_upgrade) || 0);
            var statBoxes = card.querySelectorAll('.stat-box');
            // First box: Found / Searched
            if (statBoxes[0]) {
                var nums0 = statBoxes[0].querySelectorAll('.stat-number');
                if (nums0[0]) { // found
                    if (isFromCache) nums0[0].textContent = this.formatLargeNumber(found);
                    else this.animateNumber(nums0[0], this.parseFormattedNumber(nums0[0].textContent || '0'), found);
                }
                if (nums0[1]) { // hunted
                    if (isFromCache) nums0[1].textContent = this.formatLargeNumber(hunted);
                    else this.animateNumber(nums0[1], this.parseFormattedNumber(nums0[1].textContent || '0'), hunted);
                }
            }
            // Second box: Found / Upgrades
            if (statBoxes[1]) {
                var nums1 = statBoxes[1].querySelectorAll('.stat-number');
                if (nums1[0]) { // found_upgrade
                    if (isFromCache) nums1[0].textContent = this.formatLargeNumber(foundUpgrade);
                    else this.animateNumber(nums1[0], this.parseFormattedNumber(nums1[0].textContent || '0'), foundUpgrade);
                }
                if (nums1[1]) { // upgraded
                    if (isFromCache) nums1[1].textContent = this.formatLargeNumber(upgraded);
                    else this.animateNumber(nums1[1], this.parseFormattedNumber(nums1[1].textContent || '0'), upgraded);
                }
            }
        } else {
            var numbers = card.querySelectorAll('.stat-number');
            if (numbers[0]) {
                if (isFromCache) numbers[0].textContent = this.formatLargeNumber(hunted);
                else this.animateNumber(numbers[0], this.parseFormattedNumber(numbers[0].textContent || '0'), hunted);
            }
            if (numbers[1]) {
                if (isFromCache) numbers[1].textContent = this.formatLargeNumber(upgraded);
                else this.animateNumber(numbers[1], this.parseFormattedNumber(numbers[1].textContent || '0'), upgraded);
            }
        }

        // Reset button instance name
        var resetBtn = card.querySelector('.cycle-reset-button[data-app]');
        if (resetBtn) resetBtn.setAttribute('data-instance-name', name);

        // API progress
        var pct = apiLimit > 0 ? (apiHits / apiLimit) * 100 : 0;
        var capSpans = card.querySelectorAll('.hourly-cap-text span');
        if (capSpans.length >= 2) { capSpans[0].textContent = apiHits; capSpans[1].textContent = apiLimit; }
        var statusEl = card.querySelector('.hourly-cap-status');
        if (statusEl) {
            statusEl.classList.remove('good', 'warning', 'danger');
            if (pct >= 100) statusEl.classList.add('danger');
            else if (pct >= 75) statusEl.classList.add('warning');
            else statusEl.classList.add('good');
        }
        var progressFill = card.querySelector('.api-progress-fill');
        if (progressFill) progressFill.style.width = Math.min(100, pct) + '%';
        var progressSpans = card.querySelectorAll('.api-progress-text span');
        if (progressSpans.length >= 2) { progressSpans[0].textContent = apiHits; progressSpans[1].textContent = apiLimit; }

        // State Management reset countdown
        var hoursUntil = inst.state_reset_hours_until;
        var stateEnabled = inst.state_reset_enabled !== false;
        var resetCountdownEl = card.querySelector('.state-reset-countdown');
        var resetContainer = card.querySelector('.reset-button-container');
        if (resetContainer) {
            if (!resetCountdownEl) {
                resetCountdownEl = document.createElement('div');
                resetCountdownEl.className = 'state-reset-countdown';
                resetContainer.appendChild(resetCountdownEl);
            }
            if (!stateEnabled) {
                resetCountdownEl.innerHTML = '<i class="fas fa-hourglass-half"></i> <span class="custom-tooltip">State Management Reset</span> Disabled';
                resetCountdownEl.style.display = '';
            } else if (hoursUntil != null && typeof hoursUntil === 'number' && hoursUntil > 0) {
                var h = Math.floor(hoursUntil);
                var label = h >= 1 ? '' + h : '<1';
                resetCountdownEl.innerHTML = '<i class="fas fa-hourglass-half"></i> <span class="custom-tooltip">State Management Reset</span> ' + label;
                resetCountdownEl.style.display = '';
            } else {
                resetCountdownEl.style.display = 'none';
            }
        }
    },

    // ─── List View (Compact Table — grouped) ──────────────────────────
    _renderListView: function(stats, isFromCache) {
        var grid = document.getElementById('app-stats-grid');
        if (!grid) {
            grid = document.querySelector('.app-stats-grid');
            if (grid) grid.id = 'app-stats-grid';
            else return;
        }

        grid.classList.remove('app-stats-grid');
        grid.classList.add('app-stats-list');

        var self = this;
        var groupOrder = this._getGroupOrder();
        var visibleApps = [];
        var ui = window.huntarrUI || {};
        var mediaHuntApps = { movie_hunt: true, tv_hunt: true };
        var thirdPartyApps = { sonarr: true, radarr: true, lidarr: true, readarr: true, whisparr: true, eros: true };
        groupOrder.forEach(function(app) {
            if (mediaHuntApps[app] && ui._enableMediaHunt === false) return;
            if (thirdPartyApps[app] && ui._enableThirdPartyApps === false) return;
            if (stats[app] && (stats[app].instances && stats[app].instances.length > 0 ||
                stats[app].hunted > 0 || stats[app].upgraded > 0)) {
                visibleApps.push(app);
            } else if (stats[app] && ui.configuredApps && ui.configuredApps[app]) {
                visibleApps.push(app);
            }
        });

        visibleApps.forEach(function(app) {
            var meta = self.APP_META[app] || { label: app, icon: '', accent: '#94a3b8' };
            var group = grid.querySelector('.app-group[data-app="' + app + '"]');

            if (!group) {
                group = document.createElement('div');
                group.className = 'app-group';
                group.setAttribute('data-app', app);
                grid.appendChild(group);
            }

            var instances = (stats[app] && stats[app].instances) || [];
            if (instances.length === 0) {
                instances = [{
                    instance_name: meta.label,
                    hunted: (stats[app] && stats[app].hunted) || 0,
                    upgraded: (stats[app] && stats[app].upgraded) || 0,
                    found: (stats[app] && stats[app].found) || 0,
                    found_upgrade: (stats[app] && stats[app].found_upgrade) || 0,
                    api_hits: 0, api_limit: 20, api_url: ''
                }];
            }

            var html =
                '<div class="app-group-header list-header">' +
                    '<i class="fas fa-grip-vertical drag-handle group-drag-handle"></i>' +
                    '<img src="' + meta.icon + '" class="app-group-logo" alt="">' +
                    '<span class="app-group-label">' + meta.label + '</span>' +
                '</div>' +
                '<table class="app-list-table">' +
                    '<colgroup>' +
                        '<col class="col-instance">' +
                        '<col class="col-searches">' +
                        '<col class="col-upgrades">' +
                        '<col class="col-api-status">' +
                        '<col class="col-actions">' +
                    '</colgroup>' +
                    '<thead><tr>' +
                        '<th>Instance</th>' +
                        '<th class="col-searches" data-abbr="' + (app === 'movie_hunt' || app === 'tv_hunt' ? 'F/Srch' : 'Searches') + '">' + (app === 'movie_hunt' || app === 'tv_hunt' ? 'Found / Searches' : 'Searches') + '</th>' +
                        '<th class="col-upgrades" data-abbr="' + (app === 'movie_hunt' || app === 'tv_hunt' ? 'F/Upg' : 'Upgrades') + '">' + (app === 'movie_hunt' || app === 'tv_hunt' ? 'Found / Upgrades' : 'Upgrades') + '</th>' +
                        '<th>API / Status</th>' +
                        '<th></th>' +
                    '</tr></thead><tbody>';

            var cssClass = app.replace(/-/g, '');
            instances.forEach(function(inst) {
                var hunted = Math.max(0, parseInt(inst.hunted) || 0);
                var upgraded = Math.max(0, parseInt(inst.upgraded) || 0);
                var found = Math.max(0, parseInt(inst.found) || 0);
                var foundUpgrade = Math.max(0, parseInt(inst.found_upgrade) || 0);
                var apiHits = Math.max(0, parseInt(inst.api_hits) || 0);
                var apiLimit = Math.max(1, parseInt(inst.api_limit) || 20);
                var pct = apiLimit > 0 ? Math.min(100, (apiHits / apiLimit) * 100) : 0;
                var name = inst.instance_name || 'Default';

                // Movie Hunt shows "found / searched" and "found / upgrades"
                var searchesCell = (app === 'movie_hunt' || app === 'tv_hunt')
                    ? '<span class="found-ratio"><span class="found-num">' + self.formatLargeNumber(found) + '</span> / ' + self.formatLargeNumber(hunted) + '</span>'
                    : self.formatLargeNumber(hunted);
                var upgradesCell = (app === 'movie_hunt' || app === 'tv_hunt')
                    ? '<span class="found-ratio"><span class="found-num">' + self.formatLargeNumber(foundUpgrade) + '</span> / ' + self.formatLargeNumber(upgraded) + '</span>'
                    : self.formatLargeNumber(upgraded);

                html +=
                    '<tr data-instance-name="' + name + '">' +
                        '<td class="list-instance-name">' + name + '</td>' +
                        '<td class="list-stat ' + app + '">' + searchesCell + '</td>' +
                        '<td class="list-stat ' + app + '">' + upgradesCell + '</td>' +
                        '<td class="list-api-status">' +
                            '<div class="list-api-row">' +
                                '<div class="list-api-bar"><div class="list-api-fill ' + app + '" style="width:' + pct + '%;"></div></div>' +
                                '<span class="list-api-text">' + apiHits + '/' + apiLimit + '</span>' +
                            '</div>' +
                            '<div class="list-status-row">' +
                                '<div class="cycle-timer inline-timer ' + cssClass + '" data-app-type="' + app + '">' +
                                    '<i class="fas fa-clock ' + cssClass + '-icon"></i> <span class="timer-value">Loading...</span>' +
                                '</div>' +
                            '</div>' +
                        '</td>' +
                        '<td class="list-actions">' +
                            '<button class="cycle-reset-button" data-app="' + app + '" data-instance-name="' + name + '" title="Reset Cycle"><i class="fas fa-sync-alt"></i></button>' +
                        '</td>' +
                    '</tr>';
            });

            html += '</tbody></table>';
            group.innerHTML = html;
            group.style.display = '';
        });

        // Hide groups for non-visible apps
        grid.querySelectorAll('.app-group').forEach(function(g) {
            if (visibleApps.indexOf(g.getAttribute('data-app')) === -1) {
                g.style.display = 'none';
            }
        });

        // Reorder groups
        var currentGroups = Array.from(grid.querySelectorAll('.app-group'));
        var sorted = currentGroups.slice().sort(function(a, b) {
            var ia = groupOrder.indexOf(a.getAttribute('data-app'));
            var ib = groupOrder.indexOf(b.getAttribute('data-app'));
            if (ia === -1) ia = 9999;
            if (ib === -1) ib = 9999;
            return ia - ib;
        });
        sorted.forEach(function(g) { grid.appendChild(g); });

        this._initListSortable(grid);

        // Hide old static cards & dynamic grid cards
        var oldCards = grid.querySelectorAll(':scope > .app-stats-card, :scope > .app-stats-card-wrapper');
        oldCards.forEach(function(c) { c.style.display = 'none'; });

        // Refresh cycle timers — timer elements are baked into each <tr>
        this._refreshCycleTimers();
    },

    // ─── Refresh Cycle Timers after view render ──────────────────────
    _refreshCycleTimers: function() {
        if (typeof window.CycleCountdown === 'undefined') return;
        // Let CycleCountdown discover any new timer elements it doesn't know about
        if (window.CycleCountdown.refreshTimerElements) {
            window.CycleCountdown.refreshTimerElements();
        }
        // Force an immediate data fetch + display update so timers show current state
        if (window.CycleCountdown.refreshAllData) {
            window.CycleCountdown.refreshAllData();
        }
    },

    // ─── SortableJS for Grid (flat cards) ─────────────────────────────
    _sortableGrid: null,

    _initGridSortable: function(grid) {
        if (typeof Sortable === 'undefined') return;
        var self = this;

        if (this._sortableGrid) {
            this._sortableGrid.destroy();
            this._sortableGrid = null;
        }

        this._sortableGrid = Sortable.create(grid, {
            animation: 200,
            handle: '.card-drag-handle',
            draggable: '.app-stats-card.dynamic-card',
            ghostClass: 'sortable-ghost',
            chosenClass: 'sortable-chosen',
            filter: '.app-stats-card:not(.dynamic-card), .app-stats-card-wrapper, .app-group',
            onEnd: function() {
                self._collectGridOrder();
            }
        });
    },

    // ─── SortableJS for List (group-level drag) ───────────────────────
    _initListSortable: function(grid) {
        if (typeof Sortable === 'undefined') return;
        var self = this;

        if (this._sortableGrid) {
            this._sortableGrid.destroy();
            this._sortableGrid = null;
        }

        this._sortableGrid = Sortable.create(grid, {
            animation: 200,
            handle: '.group-drag-handle',
            draggable: '.app-group',
            ghostClass: 'sortable-ghost',
            chosenClass: 'sortable-chosen',
            onEnd: function() {
                self._collectListOrder();
            }
        });
    },

    // ─── Number Formatting / Animation ────────────────────────────────
    parseFormattedNumber: function(formattedStr) {
        if (!formattedStr || typeof formattedStr !== 'string') return 0;
        var cleanStr = formattedStr.replace(/[^\d.-]/g, '');
        var parsed = parseInt(cleanStr);
        if (formattedStr.indexOf('K') !== -1) return Math.floor(parsed * 1000);
        if (formattedStr.indexOf('M') !== -1) return Math.floor(parsed * 1000000);
        return isNaN(parsed) ? 0 : Math.max(0, parsed);
    },

    animateNumber: function(element, start, end) {
        start = Math.max(0, parseInt(start) || 0);
        end = Math.max(0, parseInt(end) || 0);
        if (start === end) { element.textContent = this.formatLargeNumber(end); return; }
        var self = this;
        var duration = 600;
        var startTime = performance.now();
        var updateNumber = function(currentTime) {
            var elapsed = currentTime - startTime;
            var progress = Math.min(elapsed / duration, 1);
            var easeOutQuad = progress * (2 - progress);
            var currentValue = Math.max(0, Math.floor(start + (end - start) * easeOutQuad));
            element.textContent = self.formatLargeNumber(currentValue);
            if (progress < 1) {
                element.animationFrame = requestAnimationFrame(updateNumber);
            } else {
                element.textContent = self.formatLargeNumber(end);
                element.animationFrame = null;
            }
        };
        element.animationFrame = requestAnimationFrame(updateNumber);
    },

    formatLargeNumber: function(num) {
        if (num < 1000) return num.toString();
        else if (num < 10000) return (num / 1000).toFixed(1) + 'K';
        else if (num < 100000) return (num / 1000).toFixed(1) + 'K';
        else if (num < 1000000) return Math.floor(num / 1000) + 'K';
        else if (num < 10000000) return (num / 1000000).toFixed(1) + 'M';
        else if (num < 100000000) return (num / 1000000).toFixed(1) + 'M';
        else if (num < 1000000000) return Math.floor(num / 1000000) + 'M';
        else if (num < 10000000000) return (num / 1000000000).toFixed(1) + 'B';
        else if (num < 100000000000) return (num / 1000000000).toFixed(1) + 'B';
        else if (num < 1000000000000) return Math.floor(num / 1000000000) + 'B';
        else return (num / 1000000000000).toFixed(1) + 'T';
    },

    // ─── Stats Reset ──────────────────────────────────────────────────
    resetMediaStats: function(appType) {
        var confirmMessage = appType
            ? 'Are you sure you want to reset all ' + (appType.charAt(0).toUpperCase() + appType.slice(1)) + ' statistics? This will clear all tracked hunted and upgraded items.'
            : 'Are you sure you want to reset ALL statistics for ALL apps? This cannot be undone.';
        var self = this;
        var doReset = function() {
            var endpoint = './api/stats/reset';
            var body = appType ? JSON.stringify({ app_type: appType }) : '{}';
            HuntarrUtils.fetchWithTimeout(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: body
            })
            .then(function(response) { return response.json().then(function(data) { return { ok: response.ok, data: data }; }); })
            .then(function(result) {
                if (result.ok && result.data && result.data.success) {
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        var msg = appType
                            ? (appType.charAt(0).toUpperCase() + appType.slice(1)) + ' statistics reset successfully'
                            : 'All statistics reset successfully';
                        window.huntarrUI.showNotification(msg, 'success');
                    }
                    self.loadMediaStats(true);
                } else {
                    var errMsg = (result.data && result.data.error) ? result.data.error : 'Failed to reset statistics';
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification(errMsg, 'error');
                    }
                }
            })
            .catch(function(error) {
                console.error('Error resetting statistics:', error);
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('Error resetting statistics', 'error');
                }
            });
        };
        if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
            window.HuntarrConfirm.show({ title: 'Reset Statistics', message: confirmMessage, confirmLabel: 'Reset', onConfirm: doReset });
        } else {
            if (!confirm(confirmMessage)) return;
            doReset();
        }
    },

    // ─── Dashboard Layout Reset ───────────────────────────────────────
    resetDashboardLayout: function() {
        HuntarrUtils.setUIPreference('dashboard-layout', null);
        HuntarrUtils.setUIPreference('dashboard-view-mode', 'list');
        this._currentViewMode = 'list';
        this._clearDynamicContent();
        // Reset toggle
        var toggleGroup = document.getElementById('dashboard-view-toggle');
        if (toggleGroup) {
            toggleGroup.querySelectorAll('.view-toggle-btn').forEach(function(b) {
                b.classList.toggle('active', b.getAttribute('data-view') === 'grid');
            });
        }
        if (window.mediaStats) this.updateStatsDisplay(window.mediaStats);
        if (window.huntarrUI && window.huntarrUI.showNotification) {
            window.huntarrUI.showNotification('Dashboard layout reset to defaults', 'success');
        }
    },

    // ─── App Connection Checks ────────────────────────────────────────
    checkAppConnections: function() {
        if (!window.huntarrUI) return;
        var self = this;
        var apps = ['movie_hunt', 'tv_hunt', 'sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros'];
        var checkPromises = apps.map(function(app) { return self.checkAppConnection(app); });
        Promise.all(checkPromises)
            .then(function() {
                window.huntarrUI.configuredAppsInitialized = true;
                self.updateEmptyStateVisibility();
            })
            .catch(function() {
                window.huntarrUI.configuredAppsInitialized = true;
                self.updateEmptyStateVisibility();
            });
    },

    checkAppConnection: function(app) {
        var self = this;
        return HuntarrUtils.fetchWithTimeout('./api/status/' + app)
            .then(function(response) { return response.json(); })
            .then(function(data) {
                self.updateConnectionStatus(app, data);
                var isConfigured = data.configured === true;
                if (['movie_hunt', 'tv_hunt', 'sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros', 'swaparr'].indexOf(app) !== -1) {
                    isConfigured = (data.total_configured || 0) > 0;
                }
                if (window.huntarrUI) window.huntarrUI.configuredApps[app] = isConfigured;
            })
            .catch(function(error) {
                console.error('Error checking ' + app + ' connection:', error);
                self.updateConnectionStatus(app, { configured: false, connected: false });
                if (window.huntarrUI) window.huntarrUI.configuredApps[app] = false;
            });
    },

    updateConnectionStatus: function(app, statusData) {
        if (!window.huntarrUI) return;
        var statusElement = (window.huntarrUI.elements && window.huntarrUI.elements[app + 'HomeStatus']) || null;
        if (!statusElement) {
            var card = document.querySelector('.app-stats-card[data-app="' + app + '"]');
            statusElement = card ? card.querySelector('.status-container .status-badge') : null;
        }
        if (!statusElement) return;

        var isConfigured = statusData && statusData.configured === true;
        var isConnected = statusData && statusData.connected === true;
        var connectedCount = (statusData && statusData.connected_count) || 0;
        var totalConfigured = (statusData && statusData.total_configured) || 0;

        if (['movie_hunt', 'tv_hunt', 'sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros', 'swaparr'].indexOf(app) !== -1) {
            isConfigured = totalConfigured > 0;
            isConnected = isConfigured && connectedCount > 0;
        }

        var card = statusElement.closest('.app-stats-card');
        var statusContainer = statusElement.closest('.status-container');
        var wrapper = card ? card.closest('.app-stats-card-wrapper') : null;
        var container = wrapper || card;
        if (isConfigured) {
            if (container) container.style.display = '';
            if (wrapper) wrapper.querySelectorAll('.app-stats-card').forEach(function(c) { c.style.display = ''; });
            if (statusContainer) statusContainer.style.display = '';
        } else {
            if (container) container.style.display = 'none';
            if (card) card.style.display = 'none';
            statusElement.className = 'status-badge not-configured';
            statusElement.innerHTML = '<i class="fas fa-times-circle"></i> Not Configured';
            return;
        }

        if (['movie_hunt', 'tv_hunt', 'sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros', 'swaparr'].indexOf(app) !== -1) {
            statusElement.innerHTML = '<i class="fas fa-plug"></i> Connected ' + connectedCount + '/' + totalConfigured;
            statusElement.className = 'status-badge ' + (isConnected ? 'connected' : 'error');
        } else {
            if (isConnected) {
                statusElement.className = 'status-badge connected';
                statusElement.innerHTML = '<i class="fas fa-check-circle"></i> Connected';
            } else {
                statusElement.className = 'status-badge not-connected';
                statusElement.innerHTML = '<i class="fas fa-times-circle"></i> Not Connected';
            }
        }
    },

    // ─── NZB Hunt Home Status Bar ──────────────────────────────────
    _nzbHomePollTimer: null,

    _checkNzbHuntWarning: function() {
        var banner = document.getElementById('nzb-hunt-home-warning');
        if (!banner) return;
        // Banner is visible by default in HTML; only hide when API confirms servers exist
        fetch('./api/nzb-hunt/home-stats?t=' + Date.now())
            .then(function(r) { return r.json(); })
            .then(function(data) {
                banner.style.display = (data.show_nzb_warning === true || data.has_servers !== true) ? 'flex' : 'none';
            })
            .catch(function() {
                /* keep visible on error - user has no servers until we know otherwise */
            });
        // Retry after 1.5s in case API was not ready
        setTimeout(function() {
            if (!banner) return;
            fetch('./api/nzb-hunt/home-stats?t=' + Date.now())
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    banner.style.display = (data.show_nzb_warning === true || data.has_servers !== true) ? 'flex' : 'none';
                })
                .catch(function() {});
        }, 1500);
    },

    _fetchNzbHuntHomeStats: function() {
        var card = document.getElementById('nzb-hunt-home-card');
        if (!card) return;
        var self = this;

        // First check visibility setting
        fetch('./api/nzb-hunt/home-stats?t=' + Date.now())
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (!data.visible) {
                    card.style.display = 'none';
                    self._stopNzbHomePoll();
                    return;
                }
                card.style.display = '';
                // Fetch full status for the status bar
                self._fetchNzbHuntStatus();
                // Start polling if not already
                self._startNzbHomePoll();
            })
            .catch(function() {
                if (card) card.style.display = 'none';
            });
    },

    _fetchNzbHuntStatus: function() {
        var card = document.getElementById('nzb-hunt-home-card');
        if (!card || card.style.display === 'none') return;

        fetch('./api/nzb-hunt/status?t=' + Date.now())
            .then(function(r) { return r.json(); })
            .then(function(status) {
                // Connections
                var connEl = document.getElementById('nzb-home-connections');
                if (connEl) {
                    var connStats = status.connection_stats || [];
                    var totalActive = connStats.reduce(function(s, c) { return s + (c.active || 0); }, 0);
                    var totalMax = connStats.reduce(function(s, c) { return s + (c.max || 0); }, 0);
                    connEl.textContent = totalMax > 0 ? totalActive + ' / ' + totalMax : String(totalActive);
                }
                // Speed
                var speedEl = document.getElementById('nzb-home-speed');
                if (speedEl) speedEl.textContent = status.speed_human || '0 B/s';
                // ETA
                var etaEl = document.getElementById('nzb-home-eta');
                if (etaEl) etaEl.textContent = status.eta_human || '--';
                // Remaining
                var remainEl = document.getElementById('nzb-home-remaining');
                if (remainEl) remainEl.textContent = status.remaining_human || '0 B';
                // Space
                var spaceEl = document.getElementById('nzb-home-space');
                if (spaceEl) spaceEl.textContent = status.free_space_human || '--';
                // Pause button state
                var pauseBtn = document.getElementById('nzb-home-pause-btn');
                if (pauseBtn && status.paused_global !== undefined) {
                    var icon = pauseBtn.querySelector('i');
                    if (icon) icon.className = status.paused_global ? 'fas fa-play' : 'fas fa-pause';
                    pauseBtn.title = status.paused_global ? 'Resume all downloads' : 'Pause all downloads';
                }
            })
            .catch(function(err) {
                console.error('[HuntarrStats] NZB Hunt status fetch error:', err);
            });
    },

    _startNzbHomePoll: function() {
        if (this._nzbHomePollTimer) return; // already polling
        var self = this;
        // Poll every 5 seconds for home page status
        this._nzbHomePollTimer = setInterval(function() {
            self._fetchNzbHuntStatus();
        }, 5000);
    },

    _stopNzbHomePoll: function() {
        if (this._nzbHomePollTimer) {
            clearInterval(this._nzbHomePollTimer);
            this._nzbHomePollTimer = null;
        }
    },

    _initNzbHomePauseBtn: function() {
        var btn = document.getElementById('nzb-home-pause-btn');
        if (!btn || btn._nzbBound) return;
        btn._nzbBound = true;
        btn.addEventListener('click', function() {
            var icon = btn.querySelector('i');
            var isPaused = icon && icon.classList.contains('fa-play');
            var endpoint = isPaused ? './api/nzb-hunt/queue/resume-all' : './api/nzb-hunt/queue/pause-all';
            fetch(endpoint, { method: 'POST' })
                .then(function(r) { return r.json(); })
                .then(function() {
                    // Flip the icon immediately for responsiveness
                    if (icon) {
                        icon.className = isPaused ? 'fas fa-pause' : 'fas fa-play';
                        btn.title = isPaused ? 'Pause all downloads' : 'Resume all downloads';
                    }
                })
                .catch(function() {});
        });
    },

    updateEmptyStateVisibility: function(forceShowGrid) {
        if (!window.huntarrUI) return;
        
        // If we don't have a final answer on configuration yet and aren't forcing the grid, stay quiet
        if (!window.huntarrUI.configuredAppsInitialized && !forceShowGrid) return;
        
        var anyConfigured = Object.values(window.huntarrUI.configuredApps).some(function(v) { return v === true; });
        
        // If we are forcing the grid (from cache), we assume there's something to show
        if (forceShowGrid) anyConfigured = true;
        
        var emptyState = document.getElementById('live-hunts-empty-state');
        var statsGrid = document.getElementById('app-stats-grid') || document.querySelector('.app-stats-grid');
        
        if (anyConfigured) {
            if (emptyState) emptyState.style.display = 'none';
            if (statsGrid) statsGrid.style.display = '';
        } else {
            // Only show empty state if we're CERTAIN nothing is configured
            if (window.huntarrUI.configuredAppsInitialized) {
                if (emptyState) emptyState.style.display = 'flex';
                if (statsGrid) statsGrid.style.display = 'none';
            }
        }
    }
};
