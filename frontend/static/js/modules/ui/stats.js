/**
 * Stats & Dashboard Module
 * Handles media stats, app connections, dashboard display,
 * grouped layout, grid/list view, live polling, and drag-and-drop reordering.
 */

window.HuntarrStats = {
    isLoadingStats: false,
    _pollInterval: null,
    _currentViewMode: 'grid', // 'grid' or 'list'

    // App metadata: order, display names, icons, accent colors
    APP_META: {
        movie_hunt: { label: 'Movie Hunt', icon: './static/logo/256.png', accent: '#f59e0b' },
        sonarr:     { label: 'Sonarr',     icon: './static/images/app-icons/sonarr.png', accent: '#3b82f6' },
        radarr:     { label: 'Radarr',     icon: './static/images/app-icons/radarr.png', accent: '#f59e0b' },
        lidarr:     { label: 'Lidarr',     icon: './static/images/app-icons/lidarr.png', accent: '#22c55e' },
        readarr:    { label: 'Readarr',    icon: './static/images/app-icons/readarr.png', accent: '#a855f7' },
        whisparr:   { label: 'Whisparr V2', icon: './static/images/app-icons/whisparr.png', accent: '#ec4899' },
        eros:       { label: 'Whisparr V3', icon: './static/images/app-icons/whisparr.png', accent: '#ec4899' }
    },
    DEFAULT_APP_ORDER: ['movie_hunt', 'sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros'],

    // ─── Polling ──────────────────────────────────────────────────────
    startPolling: function() {
        this.stopPolling();
        // Poll every 15 seconds for live updates
        this._pollInterval = setInterval(() => {
            this.loadMediaStats(true); // skipCache = true
        }, 15000);
    },

    stopPolling: function() {
        if (this._pollInterval) {
            clearInterval(this._pollInterval);
            this._pollInterval = null;
        }
    },

    // ─── Layout Persistence ───────────────────────────────────────────
    _getLayout: function() {
        try {
            var stored = localStorage.getItem('huntarr-dashboard-layout');
            if (stored) return JSON.parse(stored);
        } catch (e) {}
        return null;
    },

    _saveLayout: function(layout) {
        try {
            localStorage.setItem('huntarr-dashboard-layout', JSON.stringify(layout));
        } catch (e) {}
        // Also persist to general settings (fire-and-forget)
        try {
            HuntarrUtils.fetchWithTimeout('./api/settings/general', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dashboard_layout: layout })
            }).catch(function() {});
        } catch (e) {}
    },

    _getGroupOrder: function() {
        var layout = this._getLayout();
        if (layout && Array.isArray(layout.groups) && layout.groups.length > 0) {
            // Merge any new apps that aren't in stored order
            var order = layout.groups.slice();
            this.DEFAULT_APP_ORDER.forEach(function(app) {
                if (order.indexOf(app) === -1) order.push(app);
            });
            return order;
        }
        return this.DEFAULT_APP_ORDER.slice();
    },

    _getInstanceOrder: function(app) {
        var layout = this._getLayout();
        if (layout && layout.instances && Array.isArray(layout.instances[app])) {
            return layout.instances[app];
        }
        return null;
    },

    _collectAndSaveOrder: function() {
        var grid = document.getElementById('app-stats-grid');
        if (!grid) return;
        var groups = grid.querySelectorAll('.app-group');
        var groupOrder = [];
        var instanceOrder = {};
        groups.forEach(function(g) {
            var app = g.getAttribute('data-app');
            if (app) {
                groupOrder.push(app);
                var cards = g.querySelectorAll('.app-stats-card[data-instance-name]');
                if (cards.length > 0) {
                    instanceOrder[app] = [];
                    cards.forEach(function(c) {
                        instanceOrder[app].push(c.getAttribute('data-instance-name'));
                    });
                }
            }
        });
        this._saveLayout({ groups: groupOrder, instances: instanceOrder });
    },

    // ─── View Mode ────────────────────────────────────────────────────
    _getViewMode: function() {
        try {
            var mode = localStorage.getItem('huntarr-dashboard-view-mode');
            if (mode === 'list' || mode === 'grid') return mode;
        } catch (e) {}
        return 'grid';
    },

    _setViewMode: function(mode) {
        this._currentViewMode = mode;
        try { localStorage.setItem('huntarr-dashboard-view-mode', mode); } catch (e) {}
        // Persist to general settings
        try {
            HuntarrUtils.fetchWithTimeout('./api/settings/general', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dashboard_view_mode: mode })
            }).catch(function() {});
        } catch (e) {}
    },

    initViewToggle: function() {
        var self = this;
        this._currentViewMode = this._getViewMode();
        var toggleGroup = document.getElementById('dashboard-view-toggle');
        if (!toggleGroup) return;
        var btns = toggleGroup.querySelectorAll('.view-toggle-btn');
        btns.forEach(function(btn) {
            btn.classList.toggle('active', btn.getAttribute('data-view') === self._currentViewMode);
            btn.addEventListener('click', function() {
                var mode = this.getAttribute('data-view');
                btns.forEach(function(b) { b.classList.remove('active'); });
                this.classList.add('active');
                self._setViewMode(mode);
                // Re-render with current stats
                if (window.mediaStats) {
                    self.updateStatsDisplay(window.mediaStats);
                }
            });
        });
    },

    // ─── Stats Loading ────────────────────────────────────────────────
    loadMediaStats: function(skipCache) {
        if (this.isLoadingStats) return;
        this.isLoadingStats = true;

        var self = this;

        // Use cache for initial display unless explicitly skipping
        if (!skipCache) {
            var cachedStats = localStorage.getItem('huntarr-stats-cache');
            if (cachedStats) {
                try {
                    var parsedStats = JSON.parse(cachedStats);
                    var cacheAge = Date.now() - (parsedStats.timestamp || 0);
                    if (cacheAge < 300000) {
                        this.updateStatsDisplay(parsedStats.stats, true);
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
    },

    // ─── Main Display Update ──────────────────────────────────────────
    updateStatsDisplay: function(stats, isFromCache) {
        if (this._currentViewMode === 'list') {
            this._renderListView(stats, isFromCache);
        } else {
            this._renderGridView(stats, isFromCache);
        }
    },

    // ─── Grid View (Grouped Cards) ───────────────────────────────────
    _renderGridView: function(stats, isFromCache) {
        var grid = document.getElementById('app-stats-grid');
        if (!grid) {
            // Fall back: find the old .app-stats-grid and give it an id
            grid = document.querySelector('.app-stats-grid');
            if (grid) grid.id = 'app-stats-grid';
            else return;
        }

        // Switch CSS class
        grid.classList.remove('app-stats-list');
        grid.classList.add('app-stats-grid');

        var self = this;
        var groupOrder = this._getGroupOrder();
        var visibleApps = [];

        // Determine which apps have data
        groupOrder.forEach(function(app) {
            if (stats[app] && (stats[app].instances && stats[app].instances.length > 0 ||
                stats[app].hunted > 0 || stats[app].upgraded > 0)) {
                visibleApps.push(app);
            } else if (stats[app] && window.huntarrUI && window.huntarrUI.configuredApps && window.huntarrUI.configuredApps[app]) {
                visibleApps.push(app);
            }
        });

        // Build or update groups
        visibleApps.forEach(function(app) {
            var meta = self.APP_META[app] || { label: app, icon: '', accent: '#94a3b8' };
            var group = grid.querySelector('.app-group[data-app="' + app + '"]');

            if (!group) {
                group = document.createElement('div');
                group.className = 'app-group';
                group.setAttribute('data-app', app);
                group.innerHTML =
                    '<div class="app-group-header">' +
                        '<i class="fas fa-grip-vertical drag-handle group-drag-handle"></i>' +
                        '<img src="' + meta.icon + '" class="app-group-logo" alt="">' +
                        '<span class="app-group-label">' + meta.label + '</span>' +
                    '</div>' +
                    '<div class="app-group-cards"></div>';
                grid.appendChild(group);
            }

            group.style.display = '';
            var cardsContainer = group.querySelector('.app-group-cards');
            var instances = (stats[app] && stats[app].instances) || [];

            if (instances.length === 0) {
                // Single card (app-level stats)
                var singleCard = cardsContainer.querySelector('.app-stats-card');
                if (!singleCard) {
                    singleCard = self._createCard(app, meta);
                    cardsContainer.appendChild(singleCard);
                }
                self._updateCard(singleCard, app, meta, {
                    hunted: (stats[app] && stats[app].hunted) || 0,
                    upgraded: (stats[app] && stats[app].upgraded) || 0,
                    api_hits: 0, api_limit: 20,
                    instance_name: meta.label,
                    api_url: ''
                }, isFromCache, meta.label);
            } else {
                // Sort instances by saved order
                var instOrder = self._getInstanceOrder(app);
                if (instOrder) {
                    instances = instances.slice().sort(function(a, b) {
                        var ia = instOrder.indexOf(a.instance_name);
                        var ib = instOrder.indexOf(b.instance_name);
                        if (ia === -1) ia = 9999;
                        if (ib === -1) ib = 9999;
                        return ia - ib;
                    });
                }

                // Remove excess cards
                while (cardsContainer.children.length > instances.length) {
                    cardsContainer.lastChild.remove();
                }

                instances.forEach(function(inst, idx) {
                    var card = cardsContainer.children[idx];
                    if (!card) {
                        card = self._createCard(app, meta);
                        cardsContainer.appendChild(card);
                    }
                    self._updateCard(card, app, meta, inst, isFromCache, meta.label);
                });
            }
        });

        // Hide groups for apps with no data
        grid.querySelectorAll('.app-group').forEach(function(g) {
            var app = g.getAttribute('data-app');
            if (visibleApps.indexOf(app) === -1) {
                g.style.display = 'none';
            }
        });

        // Reorder groups to match saved order
        var currentGroups = Array.from(grid.querySelectorAll('.app-group'));
        var sorted = currentGroups.slice().sort(function(a, b) {
            var ia = groupOrder.indexOf(a.getAttribute('data-app'));
            var ib = groupOrder.indexOf(b.getAttribute('data-app'));
            if (ia === -1) ia = 9999;
            if (ib === -1) ib = 9999;
            return ia - ib;
        });
        sorted.forEach(function(g) { grid.appendChild(g); });

        // Initialize SortableJS if not already
        this._initSortable(grid);

        // Refresh cycle timers
        if (typeof window.CycleCountdown !== 'undefined' && window.CycleCountdown.refreshTimerElements) {
            window.CycleCountdown.refreshTimerElements();
        }
        setTimeout(function() {
            if (typeof window.loadHourlyCapData === 'function') {
                window.loadHourlyCapData();
            }
        }, 200);

        // Hide old static cards that might still exist
        var oldCards = grid.querySelectorAll(':scope > .app-stats-card, :scope > .app-stats-card-wrapper');
        oldCards.forEach(function(c) { c.style.display = 'none'; });
    },

    // ─── Create a Card Element ────────────────────────────────────────
    _createCard: function(app, meta) {
        var card = document.createElement('div');
        card.className = 'app-stats-card ' + app;
        card.innerHTML =
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
                '<div class="stat-box"><span class="stat-number">0</span><span class="stat-label">Searches Triggered</span></div>' +
                '<div class="stat-box"><span class="stat-number">0</span><span class="stat-label">Upgrades Triggered</span></div>' +
            '</div>' +
            '<div class="reset-button-container">' +
                '<button class="cycle-reset-button" data-app="' + app + '"><i class="fas fa-sync-alt"></i> Reset</button>' +
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

        // Stat numbers
        var numbers = card.querySelectorAll('.stat-number');
        if (numbers[0]) {
            if (isFromCache) numbers[0].textContent = this.formatLargeNumber(hunted);
            else this.animateNumber(numbers[0], this.parseFormattedNumber(numbers[0].textContent || '0'), hunted);
        }
        if (numbers[1]) {
            if (isFromCache) numbers[1].textContent = this.formatLargeNumber(upgraded);
            else this.animateNumber(numbers[1], this.parseFormattedNumber(numbers[1].textContent || '0'), upgraded);
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

    // ─── List View (Compact Table) ────────────────────────────────────
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

        groupOrder.forEach(function(app) {
            if (stats[app] && (stats[app].instances && stats[app].instances.length > 0 ||
                stats[app].hunted > 0 || stats[app].upgraded > 0)) {
                visibleApps.push(app);
            } else if (stats[app] && window.huntarrUI && window.huntarrUI.configuredApps && window.huntarrUI.configuredApps[app]) {
                visibleApps.push(app);
            }
        });

        // Build or update list groups
        visibleApps.forEach(function(app) {
            var meta = self.APP_META[app] || { label: app, icon: '', accent: '#94a3b8' };
            var group = grid.querySelector('.app-group[data-app="' + app + '"]');

            if (!group) {
                group = document.createElement('div');
                group.className = 'app-group';
                group.setAttribute('data-app', app);
            }

            var instances = (stats[app] && stats[app].instances) || [];
            var instOrder = self._getInstanceOrder(app);
            if (instOrder && instances.length > 0) {
                instances = instances.slice().sort(function(a, b) {
                    var ia = instOrder.indexOf(a.instance_name);
                    var ib = instOrder.indexOf(b.instance_name);
                    if (ia === -1) ia = 9999;
                    if (ib === -1) ib = 9999;
                    return ia - ib;
                });
            }

            // If no instances, create a single pseudo-instance
            if (instances.length === 0) {
                instances = [{
                    instance_name: meta.label,
                    hunted: (stats[app] && stats[app].hunted) || 0,
                    upgraded: (stats[app] && stats[app].upgraded) || 0,
                    api_hits: 0, api_limit: 20, api_url: ''
                }];
            }

            // Build table HTML
            var html =
                '<div class="app-group-header list-header">' +
                    '<i class="fas fa-grip-vertical drag-handle group-drag-handle"></i>' +
                    '<img src="' + meta.icon + '" class="app-group-logo" alt="">' +
                    '<span class="app-group-label">' + meta.label + '</span>' +
                '</div>' +
                '<table class="app-list-table">' +
                    '<thead><tr>' +
                        '<th>Instance</th>' +
                        '<th>Searches</th>' +
                        '<th>Upgrades</th>' +
                        '<th>API Usage</th>' +
                        '<th></th>' +
                    '</tr></thead><tbody>';

            instances.forEach(function(inst) {
                var hunted = Math.max(0, parseInt(inst.hunted) || 0);
                var upgraded = Math.max(0, parseInt(inst.upgraded) || 0);
                var apiHits = Math.max(0, parseInt(inst.api_hits) || 0);
                var apiLimit = Math.max(1, parseInt(inst.api_limit) || 20);
                var pct = apiLimit > 0 ? Math.min(100, (apiHits / apiLimit) * 100) : 0;
                var name = inst.instance_name || 'Default';
                var pctClass = pct >= 100 ? 'danger' : pct >= 75 ? 'warning' : 'good';
                html +=
                    '<tr data-instance-name="' + name + '">' +
                        '<td class="list-instance-name">' + name + '</td>' +
                        '<td class="list-stat ' + app + '">' + self.formatLargeNumber(hunted) + '</td>' +
                        '<td class="list-stat ' + app + '">' + self.formatLargeNumber(upgraded) + '</td>' +
                        '<td class="list-api">' +
                            '<div class="list-api-bar"><div class="list-api-fill ' + app + '" style="width:' + pct + '%;"></div></div>' +
                            '<span class="list-api-text">' + apiHits + '/' + apiLimit + '</span>' +
                        '</td>' +
                        '<td class="list-actions">' +
                            '<button class="cycle-reset-button" data-app="' + app + '" data-instance-name="' + name + '" title="Reset Cycle"><i class="fas fa-sync-alt"></i></button>' +
                        '</td>' +
                    '</tr>';
            });

            html += '</tbody></table>';
            group.innerHTML = html;
            group.style.display = '';
            if (!group.parentNode) grid.appendChild(group);
        });

        // Hide groups for non-visible apps
        grid.querySelectorAll('.app-group').forEach(function(g) {
            if (visibleApps.indexOf(g.getAttribute('data-app')) === -1) {
                g.style.display = 'none';
            }
        });

        // Reorder
        var currentGroups = Array.from(grid.querySelectorAll('.app-group'));
        var sorted = currentGroups.slice().sort(function(a, b) {
            var ia = groupOrder.indexOf(a.getAttribute('data-app'));
            var ib = groupOrder.indexOf(b.getAttribute('data-app'));
            if (ia === -1) ia = 9999;
            if (ib === -1) ib = 9999;
            return ia - ib;
        });
        sorted.forEach(function(g) { grid.appendChild(g); });

        this._initSortable(grid);

        // Hide old static cards
        var oldCards = grid.querySelectorAll(':scope > .app-stats-card, :scope > .app-stats-card-wrapper');
        oldCards.forEach(function(c) { c.style.display = 'none'; });
    },

    // ─── SortableJS Initialization ────────────────────────────────────
    _sortableGroup: null,
    _sortableCards: [],

    _initSortable: function(grid) {
        if (typeof Sortable === 'undefined') return;
        var self = this;

        // Group-level sortable (drag groups up/down)
        if (!this._sortableGroup) {
            this._sortableGroup = Sortable.create(grid, {
                animation: 200,
                handle: '.group-drag-handle',
                draggable: '.app-group',
                ghostClass: 'sortable-ghost',
                chosenClass: 'sortable-chosen',
                onEnd: function() {
                    self._collectAndSaveOrder();
                }
            });
        }

        // Card-level sortable within each group (for multi-instance apps)
        grid.querySelectorAll('.app-group-cards').forEach(function(container) {
            if (container._sortable) return; // Already initialized
            if (container.children.length <= 1) return; // No point sorting single cards
            container._sortable = Sortable.create(container, {
                animation: 200,
                ghostClass: 'sortable-ghost',
                chosenClass: 'sortable-chosen',
                onEnd: function() {
                    self._collectAndSaveOrder();
                }
            });
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
        localStorage.removeItem('huntarr-dashboard-layout');
        localStorage.removeItem('huntarr-dashboard-view-mode');
        this._currentViewMode = 'grid';
        // Destroy existing sortable instances
        if (this._sortableGroup) {
            this._sortableGroup.destroy();
            this._sortableGroup = null;
        }
        this._sortableCards.forEach(function(s) { try { s.destroy(); } catch (e) {} });
        this._sortableCards = [];
        // Clear and re-render
        var grid = document.getElementById('app-stats-grid');
        if (grid) {
            grid.querySelectorAll('.app-group').forEach(function(g) { g.remove(); });
        }
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

    // ─── App Connection Checks (preserved from original) ──────────────
    checkAppConnections: function() {
        if (!window.huntarrUI) return;
        var self = this;
        var apps = ['movie_hunt', 'sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros'];
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
                if (['movie_hunt', 'sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros', 'swaparr'].indexOf(app) !== -1) {
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
        if (!window.huntarrUI || !window.huntarrUI.elements) return;
        var statusElement = window.huntarrUI.elements[app + 'HomeStatus'];
        if (!statusElement) return;

        var isConfigured = statusData && statusData.configured === true;
        var isConnected = statusData && statusData.connected === true;
        var connectedCount = (statusData && statusData.connected_count) || 0;
        var totalConfigured = (statusData && statusData.total_configured) || 0;

        if (['movie_hunt', 'sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros', 'swaparr'].indexOf(app) !== -1) {
            isConfigured = totalConfigured > 0;
            isConnected = isConfigured && connectedCount > 0;
        }

        var card = statusElement.closest('.app-stats-card');
        var wrapper = card ? card.closest('.app-stats-card-wrapper') : null;
        var container = wrapper || card;
        if (isConfigured) {
            if (container) container.style.display = '';
            if (wrapper) wrapper.querySelectorAll('.app-stats-card').forEach(function(c) { c.style.display = ''; });
        } else {
            if (container) container.style.display = 'none';
            if (card) card.style.display = 'none';
            statusElement.className = 'status-badge not-configured';
            statusElement.innerHTML = '<i class="fas fa-times-circle"></i> Not Configured';
            return;
        }

        if (['sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros', 'swaparr'].indexOf(app) !== -1) {
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

    updateEmptyStateVisibility: function() {
        if (!window.huntarrUI || !window.huntarrUI.configuredAppsInitialized) return;
        var anyConfigured = Object.values(window.huntarrUI.configuredApps).some(function(v) { return v === true; });
        var emptyState = document.getElementById('live-hunts-empty-state');
        var statsGrid = document.getElementById('app-stats-grid') || document.querySelector('.app-stats-grid');
        if (anyConfigured) {
            if (emptyState) emptyState.style.display = 'none';
            if (statsGrid) statsGrid.style.display = '';
        } else {
            if (emptyState) emptyState.style.display = 'flex';
            if (statsGrid) statsGrid.style.display = 'none';
        }
    }
};
