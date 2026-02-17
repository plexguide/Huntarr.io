/**
 * NZB Hunt - Standalone JavaScript module
 * Independent: does not share state with Movie Hunt, Requestarr, or any other module.
 * Manages NZB Home, Activity (coming soon), and Settings (Folders + Servers).
 */
(function () {
    'use strict';

    function _parseJsonOrThrow(r) {
        return r.json().then(function (data) {
            if (!r.ok) throw new Error(data && (data.error || data.message) || 'Request failed');
            return data;
        });
    }

    window.NzbHunt = {
        currentTab: 'queue',
        _servers: [],
        _categories: [],
        _editIndex: null, // null = add, number = edit
        _catEditIndex: null, // null = add, number = edit
        _pollTimer: null,
        _paused: false,
        _selectedIds: {},

        /* ──────────────────────────────────────────────
           Initialization
        ────────────────────────────────────────────── */
        init: function () {
            var self = this;
            this.setupTabs();
            this.showTab('queue');

            // Wire up Refresh buttons
            var queueRefresh = document.querySelector('#nzb-hunt-section [data-panel="queue"] .nzb-queue-actions .nzb-btn');
            if (queueRefresh) queueRefresh.addEventListener('click', function () { self._fetchQueueAndStatus(); });

            var historyRefresh = document.querySelector('#nzb-hunt-section [data-panel="history"] .nzb-queue-actions .nzb-btn[title="Refresh"]');
            if (historyRefresh) historyRefresh.addEventListener('click', function () { self._fetchHistory(); });

            var historyClear = document.querySelector('#nzb-hunt-section [data-panel="history"] .nzb-btn-danger');
            if (historyClear) historyClear.addEventListener('click', function () { self._clearHistory(); });

            // Wire up Warnings dismiss all
            var warnDismiss = document.getElementById('nzb-warnings-dismiss-all');
            if (warnDismiss) warnDismiss.addEventListener('click', function () { self._dismissAllWarnings(); });

            // Wire up Pause / Resume ALL button (actually hits backend)
            var pauseBtn = document.getElementById('nzb-pause-btn');
            if (pauseBtn) {
                pauseBtn.addEventListener('click', function () {
                    self._paused = !self._paused;
                    var icon = pauseBtn.querySelector('i');
                    if (icon) icon.className = self._paused ? 'fas fa-play' : 'fas fa-pause';
                    pauseBtn.title = self._paused ? 'Resume all downloads' : 'Pause all downloads';
                    fetch(self._paused ? './api/nzb-hunt/queue/pause-all' : './api/nzb-hunt/queue/resume-all', { method: 'POST' })
                        .then(function (r) { return _parseJsonOrThrow(r); })
                        .then(function () { self._fetchQueueAndStatus(); })
                        .catch(function (e) {
                            console.error('[NzbHunt] Pause/resume error:', e);
                            if (window.huntarrUI && window.huntarrUI.showNotification) {
                                window.huntarrUI.showNotification(e.message || 'Failed to pause/resume', 'error');
                            }
                            self._fetchQueueAndStatus();
                        });
                });
            }

            // Wire up speed limit popover
            this._setupSpeedLimit();

            // Wire up modal controls
            this._setupPrefsModal();

            // Load display prefs from server, then start polling with correct rates
            this._loadDisplayPrefs(function () {
                self._fetchQueueAndStatus();
                self._fetchHistory();
                self._applyRefreshRates();
                console.log('[NzbHunt] Home initialized – polling started');
            });
        },

        /* ──────────────────────────────────────────────
           Queue & Status Polling
        ────────────────────────────────────────────── */
        _queueFingerprint: '',

        _buildQueueFingerprint: function (queue) {
            if (!queue || !queue.length) return '[]';
            var parts = [];
            for (var i = 0; i < queue.length; i++) {
                var q = queue[i];
                parts.push(q.id + '|' + q.state + '|' + Math.round(q.progress_pct || 0) + '|' +
                    (q.downloaded_bytes || 0) + '|' + (q.speed_bps || 0) + '|' +
                    (q.priority || 'normal') + '|' + (q.time_left || '') + '|' +
                    (q.status_message || '') + '|' + (q.completed_files || 0));
            }
            return parts.join(';');
        },

        _fetchQueueAndStatus: function () {
            var self = this;
            fetch('./api/nzb-hunt/poll?t=' + Date.now())
                .then(function (r) { return r.ok ? r.json() : Promise.resolve({ status: {}, queue: [] }); })
                .then(function (data) {
                    var statusData = data.status || {};
                    var queueList = data.queue || [];
                    self._lastStatus = statusData;
                    self._lastQueue = queueList;

                    // Only rebuild DOM if queue data actually changed
                    var fp = self._buildQueueFingerprint(queueList);
                    if (fp !== self._queueFingerprint) {
                        self._queueFingerprint = fp;
                        self._renderQueue(queueList);
                    }

                    // Status bar is lightweight text updates, always safe
                    self._updateStatusBar(statusData);
                    self._updateQueueBadge(queueList);
                    var hBadge = document.getElementById('nzb-history-count');
                    if (hBadge) hBadge.textContent = statusData.history_count || 0;
                    self._updateWarnings(statusData.warnings || []);
                }).catch(function (err) {
                    console.error('[NzbHunt] Poll error:', err);
                });
        },

        _updateStatusBar: function (status) {
            var speedEl = document.getElementById('nzb-speed');
            var etaEl = document.getElementById('nzb-eta');
            var remainEl = document.getElementById('nzb-remaining');
            var freeEl = document.getElementById('nzb-free-space');

            if (speedEl) speedEl.textContent = status.speed_human || '0 B/s';
            if (etaEl) etaEl.textContent = status.eta_human || this._currentEta || '--';
            if (remainEl) remainEl.textContent = status.remaining_human || this._currentRemaining || '0 B';
            if (freeEl) freeEl.textContent = status.free_space_human || '--';

            // Update speed limit badge
            var limitBadge = document.getElementById('nzb-speed-limit-badge');
            if (limitBadge) {
                if (status.speed_limit_bps && status.speed_limit_bps > 0) {
                    limitBadge.textContent = '⚡ ' + this._formatBytes(status.speed_limit_bps) + '/s';
                    limitBadge.style.display = 'inline';
                } else {
                    limitBadge.style.display = 'none';
                }
            }

            // Sync pause button state with backend
            if (status.paused_global !== undefined) {
                this._paused = status.paused_global;
                var pauseBtn = document.getElementById('nzb-pause-btn');
                if (pauseBtn) {
                    var icon = pauseBtn.querySelector('i');
                    if (icon) icon.className = this._paused ? 'fas fa-play' : 'fas fa-pause';
                    pauseBtn.title = this._paused ? 'Resume all downloads' : 'Pause all downloads';
                }
            }

            // Show warning when NZB Hunt is not configured as a download client (hide when it is)
            var warnEl = document.getElementById('nzb-client-warning');
            if (warnEl) {
                var hasNzbHunt = status.nzb_hunt_configured_as_client === true || status.nzb_hunt_configured_as_client === 'true';
                warnEl.style.display = hasNzbHunt ? 'none' : 'flex';
            }

            // Update Active Connections (number + hover tooltip with per-server breakdown)
            var activeEl = document.getElementById('nzb-active-connections-value');
            var tooltipEl = document.getElementById('nzb-active-connections-tooltip');
            if (activeEl) {
                var connStats = status.connection_stats || [];
                var totalActive = connStats.reduce(function (sum, s) { return sum + (s.active || 0); }, 0);
                var totalMax = connStats.reduce(function (sum, s) { return sum + (s.max || 0); }, 0);
                if (connStats.length === 0) {
                    activeEl.textContent = '0';
                } else {
                    activeEl.textContent = totalMax > 0 ? totalActive + ' / ' + totalMax : String(totalActive);
                }
            }
            if (tooltipEl) {
                var connStats = status.connection_stats || [];
                if (connStats.length === 0) {
                    tooltipEl.textContent = 'Configure servers in Settings';
                } else {
                    var rows = connStats.map(function (s) {
                        return '<span class="nzb-tooltip-server">' + (s.name || s.host || 'Server') + ': ' + (s.active || 0) + ' / ' + (s.max || 0) + '</span>';
                    });
                    tooltipEl.innerHTML = '<strong>Connections per server</strong><div class="nzb-tooltip-servers">' + rows.join('') + '</div>';
                }
            }
        },

        _updateQueueBadge: function (queue) {
            var badge = document.getElementById('nzb-queue-count');
            if (badge) badge.textContent = queue.length;
        },

        /* ──────────────────────────────────────────────
           Queue Rendering
        ────────────────────────────────────────────── */
        _priorityLabel: function (p) {
            var map = { force: 'Force', high: 'High', normal: 'Normal', low: 'Low', stop: 'Stop' };
            return map[(p || 'normal').toLowerCase()] || 'Normal';
        },

        _priorityClass: function (p) {
            return 'nzb-priority-' + (p || 'normal').toLowerCase();
        },

        _getSelectedIds: function () {
            var ids = [];
            for (var k in this._selectedIds) {
                if (this._selectedIds[k]) ids.push(k);
            }
            return ids;
        },

        _updateSelectAllState: function () {
            var cb = document.getElementById('nzb-select-all');
            if (!cb) return;
            var rows = document.querySelectorAll('.nzb-queue-row-cb');
            var total = rows.length;
            var checked = 0;
            rows.forEach(function (r) { if (r.checked) checked++; });
            cb.checked = total > 0 && checked === total;
            cb.indeterminate = checked > 0 && checked < total;
        },

        _updateMassActionBar: function () {
            var bar = document.getElementById('nzb-mass-action-bar');
            if (!bar) return;
            var selected = this._getSelectedIds();
            if (selected.length > 0) {
                bar.style.display = 'flex';
                var countEl = document.getElementById('nzb-mass-count');
                if (countEl) countEl.textContent = selected.length + ' selected';
            } else {
                bar.style.display = 'none';
            }
        },

        _onMassPriorityChange: function (priority) {
            var self = this;
            var ids = this._getSelectedIds();
            if (!ids.length || !priority) return;
            fetch('./api/nzb-hunt/queue/bulk/priority', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: ids, priority: priority })
            })
                .then(function (r) { return _parseJsonOrThrow(r); })
                .then(function () { self._fetchQueueAndStatus(); })
                .catch(function (err) { console.error('[NzbHunt] Bulk priority error:', err); });
        },

        _onMassDelete: function () {
            var self = this;
            var ids = this._getSelectedIds();
            if (!ids.length) return;
            if (!confirm('Remove ' + ids.length + ' item' + (ids.length > 1 ? 's' : '') + ' from the queue?')) return;
            fetch('./api/nzb-hunt/queue/bulk/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: ids })
            })
                .then(function (r) { return _parseJsonOrThrow(r); })
                .then(function () {
                    self._selectedIds = {};
                    self._fetchQueueAndStatus();
                })
                .catch(function (err) { console.error('[NzbHunt] Bulk delete error:', err); });
        },

        _onSinglePriorityChange: function (id, priority) {
            var self = this;
            fetch('./api/nzb-hunt/queue/' + id + '/priority', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ priority: priority })
            })
                .then(function (r) { return _parseJsonOrThrow(r); })
                .then(function () { self._fetchQueueAndStatus(); })
                .catch(function (err) { console.error('[NzbHunt] Set priority error:', err); });
        },

        _renderQueue: function (queue) {
            var body = document.getElementById('nzb-queue-body');
            if (!body) return;

            if (!queue || queue.length === 0) {
                this._selectedIds = {};
                body.innerHTML =
                    '<div class="nzb-queue-empty">' +
                        '<div class="nzb-queue-empty-icon"><i class="fas fa-inbox"></i></div>' +
                        '<h3>Queue is empty</h3>' +
                        '<p>Downloads will appear here once NZB Hunt is connected to your Usenet setup.</p>' +
                    '</div>';
                return;
            }

            var self = this;
            var filter = (this._queueFilter || '').toLowerCase();
            var filtered = filter
                ? queue.filter(function (q) { return (q.name || '').toLowerCase().indexOf(filter) !== -1; })
                : queue;
            var perPage = this._queuePerPage || 20;
            var totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
            if (this._queuePage > totalPages) this._queuePage = totalPages;
            var start = (this._queuePage - 1) * perPage;
            var page = filtered.slice(start, start + perPage);

            var totalRemaining = 0;
            filtered.forEach(function (q) {
                var tb = q.total_bytes || 0;
                var db = Math.min(q.downloaded_bytes || 0, tb);
                totalRemaining += Math.max(0, tb - db);
            });

            // Prune _selectedIds: remove IDs no longer in the full queue
            var queueIdSet = {};
            queue.forEach(function (q) { queueIdSet[q.id] = true; });
            for (var sid in self._selectedIds) {
                if (!queueIdSet[sid]) delete self._selectedIds[sid];
            }

            var html =
                '<table class="nzb-queue-table">' +
                '<thead><tr>' +
                '<th class="nzb-col-check"><input type="checkbox" id="nzb-select-all" title="Select all" /></th>' +
                '<th class="nzb-col-name">Name</th>' +
                '<th class="nzb-col-cat">Category</th>' +
                '<th class="nzb-col-pct">Progress</th>' +
                '<th class="nzb-col-size">Size</th>' +
                '<th class="nzb-col-priority">Priority</th>' +
                '<th class="nzb-col-eta">ETA</th>' +
                '<th class="nzb-col-status">Status</th>' +
                '<th class="nzb-col-actions"></th>' +
                '</tr></thead><tbody>';

            page.forEach(function (item) {
                var progress = item.progress_pct || 0;
                var stateClass = 'nzb-item-' + (item.state || 'queued');
                var stateIcon = self._stateIcon(item.state);
                var stateLabel = self._stateLabel(item.state);
                var isActivelyDownloading = (item.state === 'downloading' && progress < 100);
                var timeLeft = isActivelyDownloading ? (item.time_left || '—') : '—';
                var db = item.downloaded_bytes || 0;
                var tb = item.total_bytes || 0;
                if (tb > 0 && db > tb) db = tb;
                var downloaded = self._formatBytes(db);
                var totalSize = self._formatBytes(tb);
                var name = self._escHtml(item.name || 'Unknown');
                var catLabel = item.category ? self._escHtml(String(item.category)) : '—';
                var isChecked = !!self._selectedIds[item.id];
                var priVal = (item.priority || 'normal').toLowerCase();
                var priLabel = self._priorityLabel(priVal);
                var priClass = self._priorityClass(priVal);

                // Build status display
                var failedSegs = item.failed_segments || 0;
                var tooltipText = '';
                var statusHtml = '<span class="nzb-status-label"><i class="' + stateIcon + '"></i> ';

                if (item.state === 'assembling') {
                    var cf = item.completed_files || 0;
                    var tf = item.total_files || 0;
                    statusHtml += 'Assembling</span><span class="nzb-status-sub nzb-status-msg">' + cf + '/' + tf + ' files</span>';
                    if (failedSegs > 0) tooltipText = 'par2 repair will be needed (' + failedSegs + ' missing segments)';
                } else if (item.state === 'extracting') {
                    statusHtml += stateLabel + '</span>';
                    if (item.status_message) {
                        statusHtml += '<span class="nzb-status-sub nzb-status-msg">' + self._escHtml(item.status_message) + '</span>';
                        tooltipText = item.status_message;
                    }
                } else {
                    statusHtml += stateLabel + '</span>';
                    if (item.status_message && item.state !== 'downloading') {
                        var msgClass = failedSegs > 0 ? ' nzb-status-msg-warn' : ' nzb-status-msg';
                        statusHtml += '<span class="nzb-status-sub' + msgClass + '">' + self._escHtml(item.status_message) + '</span>';
                        tooltipText = item.status_message;
                    }
                    if (item.state === 'downloading' && item.completed_segments === 0 && item.speed_bps === 0) {
                        statusHtml += '<span class="nzb-status-sub nzb-status-msg">Connecting...</span>';
                    }
                }
                if (!tooltipText && item.error_message) {
                    tooltipText = item.error_message;
                }
                if (tooltipText) {
                    statusHtml = '<span class="nzb-status-with-tooltip" title="">' + statusHtml + '<div class="nzb-cell-tooltip">' + self._escHtml(tooltipText) + '</div></span>';
                }

                // Progress
                var missingBytes = item.missing_bytes || 0;
                var missingStr = '';
                if (missingBytes > 0 && item.state === 'downloading') {
                    var mbMissing = missingBytes / (1024 * 1024);
                    missingStr = mbMissing >= 1024 ? (mbMissing / 1024).toFixed(1) + ' GB' :
                                 mbMissing >= 1.0 ? mbMissing.toFixed(1) + ' MB' :
                                 (missingBytes / 1024).toFixed(0) + ' KB';
                }
                var pctHtml = '<span class="nzb-progress-pct">' + progress.toFixed(1) + '%</span>';
                if (missingStr) {
                    pctHtml += ' <i class="fas fa-exclamation-triangle nzb-missing-icon" title="' + _esc(missingStr + ' missing articles') + '"></i>';
                }

                html +=
                    '<tr class="nzb-queue-row ' + stateClass + (isChecked ? ' nzb-row-selected' : '') + '" data-nzb-id="' + item.id + '">' +
                        '<td class="nzb-col-check"><input type="checkbox" class="nzb-queue-row-cb" data-id="' + item.id + '"' + (isChecked ? ' checked' : '') + ' /></td>' +
                        '<td class="nzb-col-name" data-label="Name" title="' + name + '"><span class="nzb-cell-name">' + name + '</span></td>' +
                        '<td class="nzb-col-cat" data-label="Category"><span class="nzb-cell-cat">' + catLabel + '</span></td>' +
                        '<td class="nzb-col-pct" data-label="Progress">' + pctHtml + '</td>' +
                        '<td class="nzb-col-size" data-label="Size">' + downloaded + ' / ' + totalSize + '</td>' +
                        '<td class="nzb-col-priority ' + priClass + '" data-label="Priority">' +
                            '<select class="nzb-priority-select" data-id="' + item.id + '">' +
                                '<option value="force"' + (priVal === 'force' ? ' selected' : '') + '>Force</option>' +
                                '<option value="high"' + (priVal === 'high' ? ' selected' : '') + '>High</option>' +
                                '<option value="normal"' + (priVal === 'normal' ? ' selected' : '') + '>Normal</option>' +
                                '<option value="low"' + (priVal === 'low' ? ' selected' : '') + '>Low</option>' +
                                '<option value="stop"' + (priVal === 'stop' ? ' selected' : '') + '>Stop</option>' +
                            '</select>' +
                        '</td>' +
                        '<td class="nzb-col-eta" data-label="ETA">' + timeLeft + '</td>' +
                        '<td class="nzb-col-status" data-label="Status">' + statusHtml + '</td>' +
                        '<td class="nzb-col-actions" data-label="">' +
                            (item.state === 'downloading' || item.state === 'assembling' || item.state === 'queued' ?
                                '<button class="nzb-item-btn" title="Pause" data-action="pause" data-id="' + item.id + '"><i class="fas fa-pause"></i></button>' : '') +
                            (item.state === 'paused' ?
                                '<button class="nzb-item-btn" title="Resume" data-action="resume" data-id="' + item.id + '"><i class="fas fa-play"></i></button>' : '') +
                            '<button class="nzb-item-btn nzb-item-btn-danger" title="Remove" data-action="remove" data-id="' + item.id + '"><i class="fas fa-trash-alt"></i></button>' +
                        '</td>' +
                    '</tr>';
            });

            html += '</tbody></table>';
            html = '<div class="nzb-table-scroll">' + html + '</div>';

            // Mass action bar (hidden by default, shown when items selected)
            var selCount = self._getSelectedIds().length;
            html += '<div class="nzb-mass-action-bar" id="nzb-mass-action-bar" style="display:' + (selCount > 0 ? 'flex' : 'none') + ';">';
            html += '<span class="nzb-mass-count" id="nzb-mass-count">' + selCount + ' selected</span>';
            html += '<select class="nzb-mass-priority-select" id="nzb-mass-priority-select" title="Set priority for selected">';
            html += '<option value="">Priority</option>';
            html += '<option value="force">Force</option>';
            html += '<option value="high">High</option>';
            html += '<option value="normal">Normal</option>';
            html += '<option value="low">Low</option>';
            html += '<option value="stop">Stop</option>';
            html += '</select>';
            html += '<button class="nzb-mass-delete-btn" id="nzb-mass-delete-btn" title="Remove selected"><i class="fas fa-trash-alt"></i></button>';
            html += '</div>';

            html += '<div class="nzb-queue-footer">';
            html += '<div class="nzb-hist-search"><i class="fas fa-search"></i><input type="text" id="nzb-queue-search-input" placeholder="Search" value="' + self._escHtml(this._queueFilter) + '" /></div>';
            html += '<div class="nzb-hist-pagination">';
            if (totalPages > 1) {
                html += '<button data-queue-page="prev" ' + (this._queuePage <= 1 ? 'disabled' : '') + '>&laquo;</button>';
                var pages = self._paginationRange(this._queuePage, totalPages);
                for (var i = 0; i < pages.length; i++) {
                    if (pages[i] === '…') {
                        html += '<span>…</span>';
                    } else {
                        html += '<button data-queue-page="' + pages[i] + '" ' + (pages[i] === this._queuePage ? 'class="active"' : '') + '>' + pages[i] + '</button>';
                    }
                }
                html += '<button data-queue-page="next" ' + (this._queuePage >= totalPages ? 'disabled' : '') + '>&raquo;</button>';
            }
            html += '</div>';
            html += '<div class="nzb-hist-stats"><span><i class="fas fa-download"></i>' + self._formatBytes(totalRemaining) + ' Remaining</span><span>' + filtered.length + ' items</span></div>';
            html += '</div>';

            body.innerHTML = html;

            // Wire up select-all checkbox
            var selectAllCb = document.getElementById('nzb-select-all');
            if (selectAllCb) {
                selectAllCb.addEventListener('change', function () {
                    var checked = selectAllCb.checked;
                    body.querySelectorAll('.nzb-queue-row-cb').forEach(function (cb) {
                        cb.checked = checked;
                        var rowId = cb.getAttribute('data-id');
                        if (rowId) self._selectedIds[rowId] = checked;
                        var row = cb.closest('.nzb-queue-row');
                        if (row) {
                            if (checked) row.classList.add('nzb-row-selected');
                            else row.classList.remove('nzb-row-selected');
                        }
                    });
                    self._updateMassActionBar();
                });
            }

            // Wire up individual row checkboxes
            body.querySelectorAll('.nzb-queue-row-cb').forEach(function (cb) {
                cb.addEventListener('change', function () {
                    var rowId = cb.getAttribute('data-id');
                    if (rowId) self._selectedIds[rowId] = cb.checked;
                    var row = cb.closest('.nzb-queue-row');
                    if (row) {
                        if (cb.checked) row.classList.add('nzb-row-selected');
                        else row.classList.remove('nzb-row-selected');
                    }
                    self._updateSelectAllState();
                    self._updateMassActionBar();
                });
            });

            // Wire up per-row priority dropdowns
            body.querySelectorAll('.nzb-priority-select').forEach(function (sel) {
                sel.addEventListener('change', function () {
                    var rowId = sel.getAttribute('data-id');
                    if (rowId) self._onSinglePriorityChange(rowId, sel.value);
                });
            });

            // Wire up mass priority dropdown
            var massPriSel = document.getElementById('nzb-mass-priority-select');
            if (massPriSel) {
                massPriSel.addEventListener('change', function () {
                    if (massPriSel.value) {
                        self._onMassPriorityChange(massPriSel.value);
                        massPriSel.value = '';
                    }
                });
            }

            // Wire up mass delete button
            var massDelBtn = document.getElementById('nzb-mass-delete-btn');
            if (massDelBtn) {
                massDelBtn.addEventListener('click', function () { self._onMassDelete(); });
            }

            var searchInput = document.getElementById('nzb-queue-search-input');
            if (searchInput) {
                searchInput.addEventListener('input', function () {
                    self._queueFilter = this.value;
                    self._queuePage = 1;
                    self._renderQueue(self._lastQueue || []);
                });
            }
            body.querySelectorAll('[data-queue-page]').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    var val = btn.getAttribute('data-queue-page');
                    if (val === 'prev') { self._queuePage = Math.max(1, self._queuePage - 1); }
                    else if (val === 'next') { self._queuePage++; }
                    else { self._queuePage = parseInt(val, 10); }
                    self._renderQueue(self._lastQueue || []);
                });
            });

            // Wire up item control buttons
            body.querySelectorAll('.nzb-item-btn').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    var action = btn.getAttribute('data-action');
                    var id = btn.getAttribute('data-id');
                    if (action && id) self._queueItemAction(action, id);
                });
            });

            // Update select-all state (in case of re-render with persisted selections)
            self._updateSelectAllState();
        },

        _queueItemAction: function (action, id) {
            var self = this;
            var url, method;
            if (action === 'pause') {
                url = './api/nzb-hunt/queue/' + id + '/pause';
                method = 'POST';
            } else if (action === 'resume') {
                url = './api/nzb-hunt/queue/' + id + '/resume';
                method = 'POST';
            } else if (action === 'remove') {
                url = './api/nzb-hunt/queue/' + id;
                method = 'DELETE';
            } else {
                return;
            }
            fetch(url, { method: method })
                .then(function (r) { return _parseJsonOrThrow(r); })
                .then(function () { self._fetchQueueAndStatus(); })
                .catch(function (err) {
                    console.error('[NzbHunt] Action error:', err);
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification(err.message || 'Action failed', 'error');
                    }
                    self._fetchQueueAndStatus();
                });
        },

        _stateIcon: function (state) {
            switch (state) {
                case 'downloading': return 'fas fa-arrow-down nzb-icon-downloading';
                case 'assembling': return 'fas fa-file-export nzb-icon-assembling';
                case 'queued': return 'fas fa-clock nzb-icon-queued';
                case 'paused': return 'fas fa-pause-circle nzb-icon-paused';
                case 'extracting': return 'fas fa-file-archive nzb-icon-extracting';
                case 'completed': return 'fas fa-check-circle nzb-icon-completed';
                case 'failed': return 'fas fa-exclamation-circle nzb-icon-failed';
                default: return 'fas fa-circle';
            }
        },

        _stateLabel: function (state) {
            switch (state) {
                case 'downloading': return 'Downloading';
                case 'assembling': return 'Assembling';
                case 'queued': return 'Queued';
                case 'paused': return 'Paused';
                case 'extracting': return 'Extracting';
                case 'completed': return 'Completed';
                case 'failed': return 'Failed';
                default: return state || 'Unknown';
            }
        },

        /* ──────────────────────────────────────────────
           Speed Limit Popover
        ────────────────────────────────────────────── */
        _setupSpeedLimit: function () {
            var self = this;
            var control = document.getElementById('nzb-speed-control');
            var popover = document.getElementById('nzb-speed-popover');
            if (!control || !popover) return;

            // Toggle popover on click
            control.addEventListener('click', function (e) {
                // Don't toggle if clicking inside the popover itself
                if (e.target.closest('.nzb-speed-popover')) return;
                var visible = popover.style.display === 'block';
                popover.style.display = visible ? 'none' : 'block';
                if (!visible) {
                    // Highlight the current limit
                    self._highlightCurrentLimit();
                }
            });

            // Close popover when clicking outside
            document.addEventListener('click', function (e) {
                if (!e.target.closest('#nzb-speed-control')) {
                    popover.style.display = 'none';
                }
            });

            // Preset speed limit buttons
            popover.querySelectorAll('.nzb-speed-opt').forEach(function (btn) {
                btn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    var limit = parseInt(btn.getAttribute('data-limit'), 10);
                    self._setSpeedLimit(limit);
                    popover.style.display = 'none';
                });
            });

            // Custom speed limit
            var customBtn = document.getElementById('nzb-speed-custom-btn');
            var customInput = document.getElementById('nzb-speed-custom-input');
            if (customBtn && customInput) {
                customBtn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    var mbps = parseFloat(customInput.value);
                    if (mbps > 0) {
                        self._setSpeedLimit(Math.round(mbps * 1024 * 1024));
                    } else {
                        self._setSpeedLimit(0);
                    }
                    customInput.value = '';
                    popover.style.display = 'none';
                });
                customInput.addEventListener('keydown', function (e) {
                    e.stopPropagation();
                    if (e.key === 'Enter') customBtn.click();
                });
                customInput.addEventListener('click', function (e) {
                    e.stopPropagation();
                });
            }
        },

        _setSpeedLimit: function (bps) {
            var self = this;
            fetch('./api/nzb-hunt/speed-limit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ speed_limit_bps: bps })
            })
                .then(function (r) { return _parseJsonOrThrow(r); })
                .then(function (data) {
                    if (data.success) {
                        var msg = bps > 0
                            ? 'Speed limited to ' + self._formatBytes(bps) + '/s'
                            : 'Speed limit removed';
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification(msg, 'success');
                        }
                        self._fetchQueueAndStatus();
                    }
                })
                .catch(function (err) { console.error('[NzbHunt] Speed limit error:', err); });
        },

        _highlightCurrentLimit: function () {
            var popover = document.getElementById('nzb-speed-popover');
            if (!popover) return;

            // Fetch current limit
            fetch('./api/nzb-hunt/speed-limit?t=' + Date.now())
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    var current = data.speed_limit_bps || 0;
                    popover.querySelectorAll('.nzb-speed-opt').forEach(function (btn) {
                        var val = parseInt(btn.getAttribute('data-limit'), 10);
                        btn.classList.toggle('active', val === current);
                    });
                });
        },

        /* ──────────────────────────────────────────────
           Display Preferences (server-side) – context-aware
        ────────────────────────────────────────────── */
        _displayPrefs: {
            queue:   { refreshRate: 3, perPage: 20 },
            history: { refreshRate: 30, perPage: 20, dateFormat: 'relative', showCategory: false, showSize: false, showIndexer: false }
        },
        _histPollTimer: null,
        _prefsLoaded: false,

        _loadDisplayPrefs: function (callback) {
            var self = this;
            fetch('./api/nzb-hunt/settings/display-prefs?t=' + Date.now())
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    if (data.queue) {
                        self._displayPrefs.queue.refreshRate = data.queue.refreshRate || 3;
                        self._displayPrefs.queue.perPage = data.queue.perPage || 20;
                    }
                    if (data.history) {
                        self._displayPrefs.history.refreshRate = data.history.refreshRate || 30;
                        self._displayPrefs.history.perPage = data.history.perPage || 20;
                        self._displayPrefs.history.dateFormat = data.history.dateFormat || 'relative';
                        self._displayPrefs.history.showCategory = !!data.history.showCategory;
                        self._displayPrefs.history.showSize = !!data.history.showSize;
                        self._displayPrefs.history.showIndexer = !!data.history.showIndexer;
                    }
                    self._histPerPage = self._displayPrefs.history.perPage;
                    self._queuePerPage = self._displayPrefs.queue.perPage || 20;
                    self._prefsLoaded = true;
                    console.log('[NzbHunt] Display prefs loaded from server');
                    if (callback) callback();
                })
                .catch(function (err) {
                    console.error('[NzbHunt] Failed to load display prefs:', err);
                    self._prefsLoaded = true;
                    if (callback) callback();
                });
        },

        _saveDisplayPrefs: function (callback) {
            var self = this;
            this._histPerPage = this._displayPrefs.history.perPage;
            fetch('./api/nzb-hunt/settings/display-prefs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(this._displayPrefs)
            })
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    console.log('[NzbHunt] Display prefs saved to server');
                    if (callback) callback(data);
                })
                .catch(function (err) {
                    console.error('[NzbHunt] Failed to save display prefs:', err);
                    if (callback) callback({ success: false });
                });
        },

        _applyRefreshRates: function () {
            var self = this;
            // Queue poll timer
            if (this._pollTimer) clearInterval(this._pollTimer);
            var qRate = Math.max(5, this._displayPrefs.queue.refreshRate || 5) * 1000;
            this._pollTimer = setInterval(function () { self._fetchQueueAndStatus(); }, qRate);

            // History poll timer
            if (this._histPollTimer) clearInterval(this._histPollTimer);
            var hRate = (this._displayPrefs.history.refreshRate || 30) * 1000;
            this._histPollTimer = setInterval(function () { self._fetchHistory(); }, hRate);
        },

        _openPrefsModal: function () {
            var ctx = this.currentTab; // 'queue' or 'history'
            var prefs = this._displayPrefs[ctx];
            var titleEl = document.getElementById('nzb-prefs-title');
            if (titleEl) titleEl.textContent = (ctx === 'queue' ? 'Queue' : 'History') + ' Settings';

            // Show/hide history-only section
            var histSec = document.getElementById('nzb-prefs-history-section');
            if (histSec) histSec.style.display = (ctx === 'history') ? '' : 'none';

            // Populate shared fields
            var el;
            el = document.getElementById('nzb-pref-refresh');
            if (el) el.value = String(prefs.refreshRate || (ctx === 'queue' ? 3 : 30));
            el = document.getElementById('nzb-pref-per-page');
            if (el) el.value = String(prefs.perPage || 20);

            // Populate history-only fields
            if (ctx === 'history') {
                el = document.getElementById('nzb-pref-date-format');
                if (el) el.value = prefs.dateFormat || 'relative';
                el = document.getElementById('nzb-pref-show-category');
                if (el) el.checked = !!prefs.showCategory;
                el = document.getElementById('nzb-pref-show-size');
                if (el) el.checked = !!prefs.showSize;
                el = document.getElementById('nzb-pref-show-indexer');
                if (el) el.checked = !!prefs.showIndexer;
            }

            // Store context for save
            this._prefsContext = ctx;

            var overlay = document.getElementById('nzb-prefs-overlay');
            if (overlay) overlay.style.display = 'flex';
        },

        _closePrefsModal: function () {
            var overlay = document.getElementById('nzb-prefs-overlay');
            if (overlay) overlay.style.display = 'none';
        },

        _savePrefsFromModal: function () {
            var self = this;
            var ctx = this._prefsContext || this.currentTab;
            var prefs = this._displayPrefs[ctx];
            var el;

            el = document.getElementById('nzb-pref-refresh');
            if (el) prefs.refreshRate = parseInt(el.value, 10) || (ctx === 'queue' ? 3 : 30);
            el = document.getElementById('nzb-pref-per-page');
            if (el) prefs.perPage = parseInt(el.value, 10) || 20;

            if (ctx === 'history') {
                el = document.getElementById('nzb-pref-date-format');
                if (el) prefs.dateFormat = el.value;
                el = document.getElementById('nzb-pref-show-category');
                if (el) prefs.showCategory = el.checked;
                el = document.getElementById('nzb-pref-show-size');
                if (el) prefs.showSize = el.checked;
                el = document.getElementById('nzb-pref-show-indexer');
                if (el) prefs.showIndexer = el.checked;
            }

            this._saveDisplayPrefs(function () {
                self._applyRefreshRates();
                self._closePrefsModal();

                if (ctx === 'history') {
                    self._histPage = 1;
                    self._renderHistory();
                }

                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification((ctx === 'queue' ? 'Queue' : 'History') + ' settings saved.', 'success');
                }
            });
        },

        _setupPrefsModal: function () {
            var self = this;
            var gearBtn = document.getElementById('nzb-display-prefs-btn');
            if (gearBtn) gearBtn.addEventListener('click', function () { self._openPrefsModal(); });

            var closeBtn = document.getElementById('nzb-prefs-close');
            if (closeBtn) closeBtn.addEventListener('click', function () { self._closePrefsModal(); });

            var saveBtn = document.getElementById('nzb-prefs-save');
            if (saveBtn) saveBtn.addEventListener('click', function () { self._savePrefsFromModal(); });

            var overlay = document.getElementById('nzb-prefs-overlay');
            if (overlay) {
                overlay.addEventListener('click', function (e) {
                    if (e.target === overlay) self._closePrefsModal();
                });
            }
        },

        /* ──────────────────────────────────────────────
           Warnings Tab
        ────────────────────────────────────────────── */
        _updateWarnings: function (warnings) {
            var tab = document.getElementById('nzb-warnings-tab');
            var badge = document.getElementById('nzb-warnings-count');
            var count = (warnings && warnings.length) || 0;
            // Show/hide the tab
            if (tab) tab.style.display = count > 0 ? '' : 'none';
            if (badge) badge.textContent = count;
            // If warnings panel is visible, render
            this._lastWarnings = warnings || [];
            if (this.currentTab === 'warnings') this._renderWarnings();
        },

        _renderWarnings: function () {
            var body = document.getElementById('nzb-warnings-body');
            if (!body) return;
            var warnings = this._lastWarnings || [];
            if (warnings.length === 0) {
                body.innerHTML =
                    '<div class="nzb-queue-empty">' +
                        '<div class="nzb-queue-empty-icon"><i class="fas fa-check-circle" style="color: #4ade80;"></i></div>' +
                        '<h3>No warnings</h3>' +
                        '<p>Everything looks good.</p>' +
                    '</div>';
                return;
            }
            var self = this;
            var html = '<div class="nzb-warnings-list">';
            warnings.forEach(function (w) {
                var icon = w.level === 'error' ? 'fa-times-circle' : w.level === 'warning' ? 'fa-exclamation-triangle' : 'fa-info-circle';
                var cls = 'nzb-warning-item nzb-warning-' + w.level;
                html +=
                    '<div class="' + cls + '">' +
                        '<div class="nzb-warning-icon"><i class="fas ' + icon + '"></i></div>' +
                        '<div class="nzb-warning-body">' +
                            '<div class="nzb-warning-title">' + self._escHtml(w.title) + '</div>' +
                            '<div class="nzb-warning-msg">' + self._escHtml(w.message) + '</div>' +
                            '<div class="nzb-warning-time">' + self._timeAgo(w.time) + '</div>' +
                        '</div>' +
                        '<button class="nzb-warning-dismiss" data-warn-id="' + self._escHtml(w.id) + '" title="Dismiss"><i class="fas fa-times"></i></button>' +
                    '</div>';
            });
            html += '</div>';
            body.innerHTML = html;
            // Bind dismiss buttons
            body.querySelectorAll('.nzb-warning-dismiss').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    self._dismissWarning(btn.getAttribute('data-warn-id'));
                });
            });
        },

        _dismissWarning: function (warnId) {
            var self = this;
            fetch('./api/nzb-hunt/warnings/dismiss', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: warnId })
            })
                .then(function (r) { return _parseJsonOrThrow(r); })
                .then(function () { self._fetchQueueAndStatus(); })
                .catch(function (e) { console.error('[NzbHunt] Dismiss warning:', e); self._fetchQueueAndStatus(); });
        },

        _dismissAllWarnings: function () {
            var self = this;
            fetch('./api/nzb-hunt/warnings/dismiss', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: '__all__' })
            })
                .then(function (r) { return _parseJsonOrThrow(r); })
                .then(function () { self._fetchQueueAndStatus(); })
                .catch(function (e) { console.error('[NzbHunt] Dismiss all warnings:', e); self._fetchQueueAndStatus(); });
        },

        /* ──────────────────────────────────────────────
           History Rendering
        ────────────────────────────────────────────── */
        _histPage: 1,
        _histPerPage: 20,
        _histAll: [],
        _histFilter: '',
        _queuePage: 1,
        _queuePerPage: 20,
        _queueFilter: '',
        _lastQueue: [],

        _fetchHistory: function () {
            var self = this;
            fetch('./api/nzb-hunt/history?limit=5000&t=' + Date.now())
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    var hist = data.history || [];
                    // Sort newest first
                    hist.sort(function (a, b) {
                        var ta = new Date(a.completed_at || a.added_at || 0).getTime();
                        var tb = new Date(b.completed_at || b.added_at || 0).getTime();
                        return tb - ta;
                    });
                    self._histAll = hist;
                    self._histPage = 1;
                    self._renderHistory();
                })
                .catch(function (err) { console.error('[NzbHunt] History fetch error:', err); });
        },

        _timeAgo: function (dateStr) {
            if (!dateStr) return '—';
            var now = Date.now();
            var then = new Date(dateStr).getTime();
            var diff = Math.max(0, now - then);
            var sec = Math.floor(diff / 1000);
            if (sec < 60) return 'just now';
            var min = Math.floor(sec / 60);
            if (min < 60) return min + (min === 1 ? ' minute ago' : ' minutes ago');
            var hr = Math.floor(min / 60);
            if (hr < 24) return hr + (hr === 1 ? ' hour ago' : ' hours ago');
            var days = Math.floor(hr / 24);
            if (days < 30) return days + (days === 1 ? ' day ago' : ' days ago');
            var months = Math.floor(days / 30);
            return months + (months === 1 ? ' month ago' : ' months ago');
        },

        _renderHistory: function () {
            var body = document.getElementById('nzb-history-body');
            if (!body) return;

            var all = this._histAll;
            var badge = document.getElementById('nzb-history-count');
            if (badge) badge.textContent = all.length;

            // Filter
            var filter = this._histFilter.toLowerCase();
            var filtered = filter
                ? all.filter(function (h) { return (h.name || '').toLowerCase().indexOf(filter) !== -1; })
                : all;

            // Empty state
            if (!filtered.length) {
                body.innerHTML =
                    '<div class="nzb-queue-empty">' +
                        '<div class="nzb-queue-empty-icon"><i class="fas fa-history"></i></div>' +
                        '<h3>No history yet</h3>' +
                        '<p>Completed downloads will be logged here.</p>' +
                    '</div>';
                return;
            }

            // Pagination
            var perPage = this._histPerPage;
            var totalPages = Math.ceil(filtered.length / perPage);
            if (this._histPage > totalPages) this._histPage = totalPages;
            var start = (this._histPage - 1) * perPage;
            var page = filtered.slice(start, start + perPage);

            // Bandwidth stats
            var totalBytes = 0;
            all.forEach(function (h) { totalBytes += (h.total_bytes || h.downloaded_bytes || 0); });

            var self = this;
            var prefs = this._displayPrefs.history;
            // Same column structure as Queue: NAME | CATEGORY | SIZE | RESULT | AGE | actions
            var html =
                '<table class="nzb-queue-table nzb-history-table">' +
                '<thead><tr>' +
                '<th class="nzb-col-name">Name</th>' +
                '<th class="nzb-col-cat">Category</th>' +
                '<th class="nzb-col-size">Size</th>' +
                '<th class="nzb-col-status">Result</th>' +
                '<th class="nzb-col-eta">Age</th>' +
                '<th class="nzb-col-actions"></th>' +
                '</tr></thead><tbody>';

            page.forEach(function (item) {
                var isSuccess = item.state === 'completed';
                var name = self._escHtml(item.name || 'Unknown');
                var catLabel = item.category ? self._escHtml(String(item.category)) : '—';
                var size = self._formatBytes(item.total_bytes || item.downloaded_bytes || 0);
                var dateVal = item.completed_at || item.added_at;
                var age = prefs.dateFormat === 'absolute'
                    ? (dateVal ? new Date(dateVal).toLocaleString() : '—')
                    : self._timeAgo(dateVal);

                // Result — label on top, detail below (matches queue layout)
                var resultHtml;
                if (isSuccess) {
                    resultHtml =
                        '<span class="nzb-status-label"><i class="fas fa-check-circle nzb-icon-completed"></i> Completed</span>';
                } else {
                    var errMsg = item.error_message || '';
                    var failLabel = 'Failed';
                    var failDetail = '';

                    if (/missing article/i.test(errMsg) || /DMCA/i.test(errMsg)) {
                        failLabel = 'Aborted';
                        failDetail = 'Missing articles';
                    } else if (/extraction failed/i.test(errMsg)) {
                        failLabel = 'Failed';
                        failDetail = 'Extraction error';
                    } else if (/timed out/i.test(errMsg)) {
                        failLabel = 'Failed';
                        failDetail = 'Timed out';
                    } else if (errMsg) {
                        failDetail = errMsg.length > 30
                            ? self._escHtml(errMsg.substring(0, 28)) + '…'
                            : self._escHtml(errMsg);
                    }

                    resultHtml =
                        '<span class="nzb-status-label"><i class="fas fa-times-circle nzb-icon-failed"></i> ' + failLabel + '</span>';
                    if (failDetail) {
                        resultHtml += '<span class="nzb-status-sub nzb-status-msg">' + failDetail + '</span>';
                    }
                    if (errMsg) {
                        resultHtml = '<span class="nzb-status-with-tooltip" title="">' + resultHtml +
                            '<div class="nzb-cell-tooltip">' + self._escHtml(errMsg) + '</div></span>';
                    }
                }

                var nzbId = item.nzo_id || item.id || '';

                html += '<tr class="nzb-queue-row ' + (isSuccess ? 'nzb-item-completed' : 'nzb-item-failed') + '">' +
                    '<td class="nzb-col-name" data-label="Name" title="' + name + '"><span class="nzb-cell-name">' + name + '</span></td>' +
                    '<td class="nzb-col-cat" data-label="Category"><span class="nzb-cell-cat">' + catLabel + '</span></td>' +
                    '<td class="nzb-col-size" data-label="Size">' + size + '</td>' +
                    '<td class="nzb-col-status" data-label="Result">' + resultHtml + '</td>' +
                    '<td class="nzb-col-eta" data-label="Age">' + age + '</td>' +
                    '<td class="nzb-col-actions" data-label="">' +
                    '<button type="button" class="nzb-item-btn nzb-item-btn-danger nzb-hist-delete-btn" data-nzb-id="' + nzbId + '" title="Delete"><i class="fas fa-trash-alt"></i></button>' +
                    '</td></tr>';
            });

            html += '</tbody></table>';
            html = '<div class="nzb-table-scroll">' + html + '</div>';
            html += '<div class="nzb-history-footer">';
            html += '<div class="nzb-hist-search"><i class="fas fa-search"></i><input type="text" id="nzb-hist-search-input" placeholder="Search" value="' + self._escHtml(this._histFilter) + '" /></div>';
            html += '<div class="nzb-hist-pagination">';
            if (totalPages > 1) {
                html += '<button data-hist-page="prev" ' + (this._histPage <= 1 ? 'disabled' : '') + '>&laquo;</button>';
                // Show page numbers with ellipsis
                var pages = self._paginationRange(this._histPage, totalPages);
                for (var i = 0; i < pages.length; i++) {
                    if (pages[i] === '…') {
                        html += '<span>…</span>';
                    } else {
                        html += '<button data-hist-page="' + pages[i] + '" ' + (pages[i] === this._histPage ? 'class="active"' : '') + '>' + pages[i] + '</button>';
                    }
                }
                html += '<button data-hist-page="next" ' + (this._histPage >= totalPages ? 'disabled' : '') + '>&raquo;</button>';
            }
            html += '</div>';
            html += '<div class="nzb-hist-stats"><span><i class="fas fa-download"></i>' + self._formatBytes(totalBytes) + ' Total</span><span>' + filtered.length + ' items</span></div>';
            html += '</div>';

            body.innerHTML = html;

            // Wire up search
            var searchInput = document.getElementById('nzb-hist-search-input');
            if (searchInput) {
                searchInput.addEventListener('input', function () {
                    self._histFilter = this.value;
                    self._histPage = 1;
                    self._renderHistory();
                });
            }

            // Wire up pagination
            body.querySelectorAll('[data-hist-page]').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    var val = btn.getAttribute('data-hist-page');
                    if (val === 'prev') { self._histPage = Math.max(1, self._histPage - 1); }
                    else if (val === 'next') { self._histPage++; }
                    else { self._histPage = parseInt(val, 10); }
                    self._renderHistory();
                });
            });

            // Wire up per-row delete
            body.querySelectorAll('.nzb-hist-delete-btn').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    var id = btn.getAttribute('data-nzb-id');
                    if (!id) return;
                    self._deleteHistoryItem(id);
                });
            });
        },

        _paginationRange: function (current, total) {
            if (total <= 7) {
                var arr = [];
                for (var i = 1; i <= total; i++) arr.push(i);
                return arr;
            }
            var pages = [1];
            if (current > 3) pages.push('…');
            for (var p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) {
                pages.push(p);
            }
            if (current < total - 2) pages.push('…');
            pages.push(total);
            return pages;
        },

        _deleteHistoryItem: function (nzbId) {
            var self = this;
            fetch('./api/nzb-hunt/history/' + encodeURIComponent(nzbId), { method: 'DELETE' })
                .then(function (r) { return _parseJsonOrThrow(r); })
                .then(function () { self._fetchHistory(); })
                .catch(function (err) {
                    console.error('[NzbHunt] Delete history item error:', err);
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification(err.message || 'Delete failed', 'error');
                    }
                    self._fetchHistory();
                });
        },

        _clearHistory: function () {
            var self = this;
            fetch('./api/nzb-hunt/history', { method: 'DELETE' })
                .then(function (r) { return _parseJsonOrThrow(r); })
                .then(function () { self._fetchHistory(); })
                .catch(function (err) {
                    console.error('[NzbHunt] Clear history error:', err);
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification(err.message || 'Clear history failed', 'error');
                    }
                    self._fetchHistory();
                });
        },

        /* ──────────────────────────────────────────────
           Utility helpers
        ────────────────────────────────────────────── */
        _formatBytes: function (bytes) {
            if (!bytes || bytes === 0) return '0 B';
            var units = ['B', 'KB', 'MB', 'GB', 'TB'];
            var i = 0;
            var b = bytes;
            while (b >= 1024 && i < units.length - 1) { b /= 1024; i++; }
            return b.toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
        },

        _formatEta: function (seconds) {
            if (!seconds || seconds <= 0) return '--:--';
            var h = Math.floor(seconds / 3600);
            var m = Math.floor((seconds % 3600) / 60);
            var s = seconds % 60;
            if (h > 0) return h + 'h ' + (m < 10 ? '0' : '') + m + 'm';
            return m + 'm ' + (s < 10 ? '0' : '') + s + 's';
        },

        _escHtml: function (str) {
            var d = document.createElement('div');
            d.textContent = str;
            return d.innerHTML;
        },

        /* ──────────────────────────────────────────────
           Stop polling (called when leaving NZB home)
        ────────────────────────────────────────────── */
        stopPolling: function () {
            if (this._pollTimer) {
                clearInterval(this._pollTimer);
                this._pollTimer = null;
            }
            if (this._histPollTimer) {
                clearInterval(this._histPollTimer);
                this._histPollTimer = null;
            }
        },

        initSettings: function () {
            this._setupSettingsTabs();
            this._setupFolderBrowse();
            this._setupServerGrid();
            this._setupServerEditor();
            this._setupBrowseModal();
            this._setupCategoryGrid();
            this._setupCategoryModal();
            this._setupAdvanced();
            this._loadFolders();
            this._loadServers();
            this._loadCategories();
            this._loadAdvanced();
            this._loadProcessing();
            this._updateNzbServersSetupBanner();
            console.log('[NzbHunt] Settings initialized');
        },

        /* ──────────────────────────────────────────────
           NZB Home tabs (Queue / History)
        ────────────────────────────────────────────── */
        setupTabs: function () {
            var self = this;
            var tabs = document.querySelectorAll('#nzb-hunt-section .nzb-tab');
            tabs.forEach(function (tab) {
                tab.addEventListener('click', function () {
                    var target = tab.getAttribute('data-tab');
                    if (target) self.showTab(target);
                });
            });
        },

        showTab: function (tab) {
            this.currentTab = tab;
            document.querySelectorAll('#nzb-hunt-section .nzb-tab').forEach(function (t) {
                t.classList.toggle('active', t.getAttribute('data-tab') === tab);
            });
            document.querySelectorAll('#nzb-hunt-section .nzb-tab-panel').forEach(function (p) {
                p.style.display = p.getAttribute('data-panel') === tab ? 'block' : 'none';
            });
            if (tab === 'history') { this._fetchHistory(); }
            if (tab === 'warnings') { this._renderWarnings(); }
        },

        /* ──────────────────────────────────────────────
           Settings sub-tabs (Folders / Servers)
        ────────────────────────────────────────────── */
        _setupSettingsTabs: function () {
            // Tabs are now in the sidebar, handled by app.js
        },

        _showSettingsTab: function (tab) {
            document.querySelectorAll('#nzb-hunt-settings-section .nzb-settings-panel').forEach(function (p) {
                p.style.display = p.getAttribute('data-settings-panel') === tab ? 'block' : 'none';
            });
            var bc = document.getElementById('nzb-hunt-settings-breadcrumb-current');
            if (bc) {
                var labels = { folders: 'Folders', servers: 'Servers', advanced: 'Advanced' };
                bc.textContent = labels[tab] || tab;
            }
            // Toggle header save button vs sponsor based on tab
            var headerSave = document.getElementById('nzb-save-advanced-header');
            var sponsorSlot = document.getElementById('nzb-hunt-settings-sponsor-slot');
            if (tab === 'advanced') {
                if (headerSave) headerSave.style.display = '';
                if (sponsorSlot) sponsorSlot.style.display = 'none';
            } else {
                if (headerSave) headerSave.style.display = 'none';
                if (sponsorSlot) sponsorSlot.style.display = '';
            }
            // Show/hide setup wizard continue banner on servers tab
            if (tab === 'servers') {
                this._updateNzbServersSetupBanner();
            }
        },

        _fromSetupWizard: false,

        _updateNzbServersSetupBanner: function () {
            var banner = document.getElementById('nzb-servers-setup-wizard-continue-banner');
            if (!banner) return;
            // Show if user navigated here from the setup wizard.
            // Don't remove the flag — it needs to persist across re-renders during the wizard flow.
            var fromWizard = false;
            try { fromWizard = sessionStorage.getItem('setup-wizard-active-nav') === '1'; } catch (e) {}
            if (fromWizard) {
                this._fromSetupWizard = true;
            }
            banner.style.display = (fromWizard || this._fromSetupWizard) ? 'flex' : 'none';
        },

        /* ──────────────────────────────────────────────
           Folders  – load / save / browse (combined with categories)
        ────────────────────────────────────────────── */
        _loadFolders: function () {
            fetch('./api/nzb-hunt/settings/folders?t=' + Date.now())
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    var tf = document.getElementById('nzb-temp-folder');
                    if (tf && data.temp_folder !== undefined) tf.value = data.temp_folder;
                })
                .catch(function () { /* use defaults */ });
        },

        _saveFolders: function () {
            var payload = {
                temp_folder: (document.getElementById('nzb-temp-folder') || {}).value || '/downloads/incomplete'
            };
            fetch('./api/nzb-hunt/settings/folders', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })
                .then(function (r) { return _parseJsonOrThrow(r); })
                .then(function (data) {
                    if (data.success) {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification('Temporary folder saved.', 'success');
                        }
                        if (window.NzbHunt) {
                            window.NzbHunt._loadCategories();
                        }
                    }
                })
                .catch(function () {
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification('Failed to save folder.', 'error');
                    }
                });
        },

        _setupFolderBrowse: function () {
            var self = this;
            var browseTemp = document.getElementById('nzb-browse-temp-folder');
            if (browseTemp) {
                browseTemp.addEventListener('click', function () {
                    self._openBrowseModal(document.getElementById('nzb-temp-folder'));
                });
            }
        },

        /* ──────────────────────────────────────────────
           File Browser Modal
        ────────────────────────────────────────────── */
        _browseTarget: null,

        _setupBrowseModal: function () {
            var self = this;
            var backdrop = document.getElementById('nzb-browse-backdrop');
            var closeBtn = document.getElementById('nzb-browse-close');
            var cancelBtn = document.getElementById('nzb-browse-cancel');
            var okBtn = document.getElementById('nzb-browse-ok');
            var upBtn = document.getElementById('nzb-browse-up');

            if (backdrop) backdrop.addEventListener('click', function () { self._closeBrowseModal(); });
            if (closeBtn) closeBtn.addEventListener('click', function () { self._closeBrowseModal(); });
            if (cancelBtn) cancelBtn.addEventListener('click', function () { self._closeBrowseModal(); });
            if (okBtn) okBtn.addEventListener('click', function () { self._confirmBrowse(); });
            if (upBtn) upBtn.addEventListener('click', function () { self._browseParent(); });

            var pathInput = document.getElementById('nzb-browse-path-input');
            if (pathInput) {
                pathInput.addEventListener('keydown', function (e) {
                    if (e.key === 'Enter') { e.preventDefault(); self._loadBrowsePath(pathInput.value); }
                });
            }

            // New folder button + inline create
            var newFolderBtn = document.getElementById('nzb-browse-new-folder');
            if (newFolderBtn) newFolderBtn.addEventListener('click', function () { self._browseShowCreateFolder(); });
            var createConfirm = document.getElementById('nzb-browse-new-folder-confirm');
            var createCancel = document.getElementById('nzb-browse-new-folder-cancel');
            var createInput = document.getElementById('nzb-browse-new-folder-input');
            if (createConfirm) createConfirm.addEventListener('click', function () { self._browseDoCreateFolder(); });
            if (createCancel) createCancel.addEventListener('click', function () { self._browseHideCreateFolder(); });
            if (createInput) createInput.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') { e.preventDefault(); self._browseDoCreateFolder(); }
                if (e.key === 'Escape') { e.preventDefault(); self._browseHideCreateFolder(); }
            });

            // Delete confirm buttons
            var deleteYes = document.getElementById('nzb-browse-delete-yes');
            var deleteNo = document.getElementById('nzb-browse-delete-no');
            if (deleteYes) deleteYes.addEventListener('click', function () { self._browseDoDeleteFolder(); });
            if (deleteNo) deleteNo.addEventListener('click', function () { self._browseHideDeleteFolder(); });

            // Escape key to close
            document.addEventListener('keydown', function (e) {
                if (e.key === 'Escape') {
                    var modal = document.getElementById('nzb-browse-modal');
                    if (modal && modal.style.display === 'flex') self._closeBrowseModal();
                }
            });
        },

        _openBrowseModal: function (targetInput) {
            this._browseTarget = targetInput;
            var modal = document.getElementById('nzb-browse-modal');
            if (!modal) return;
            if (modal.parentElement !== document.body) document.body.appendChild(modal);
            var pathInput = document.getElementById('nzb-browse-path-input');
            var startPath = (targetInput && targetInput.value) ? targetInput.value : '/';
            if (pathInput) pathInput.value = startPath;
            modal.style.display = 'flex';
            this._loadBrowsePath(startPath);
        },

        _closeBrowseModal: function () {
            var modal = document.getElementById('nzb-browse-modal');
            if (modal) modal.style.display = 'none';
        },

        _confirmBrowse: function () {
            var pathInput = document.getElementById('nzb-browse-path-input');
            if (this._browseTarget && pathInput) {
                this._browseTarget.value = pathInput.value;
                if (this._browseTarget.id === 'nzb-temp-folder') {
                    this._saveFolders();
                }
            }
            this._closeBrowseModal();
        },

        _browseParent: function () {
            var pathInput = document.getElementById('nzb-browse-path-input');
            if (!pathInput) return;
            var cur = pathInput.value || '/';
            if (cur === '/') return;
            var parts = cur.replace(/\/+$/, '').split('/');
            parts.pop();
            var parent = parts.join('/') || '/';
            pathInput.value = parent;
            this._loadBrowsePath(parent);
        },

        /* ── Browse: Create folder ── */
        _browseShowCreateFolder: function () {
            var row = document.getElementById('nzb-browse-new-folder-row');
            var input = document.getElementById('nzb-browse-new-folder-input');
            var delRow = document.getElementById('nzb-browse-delete-confirm-row');
            if (delRow) delRow.style.display = 'none';
            if (!row || !input) return;
            row.style.display = 'flex';
            input.value = '';
            setTimeout(function () { input.focus(); }, 50);
        },

        _browseHideCreateFolder: function () {
            var row = document.getElementById('nzb-browse-new-folder-row');
            if (row) row.style.display = 'none';
        },

        _browseDoCreateFolder: function () {
            var input = document.getElementById('nzb-browse-new-folder-input');
            var row = document.getElementById('nzb-browse-new-folder-row');
            var pathInput = document.getElementById('nzb-browse-path-input');
            var name = (input && input.value || '').trim();
            if (!name) { if (input) input.focus(); return; }
            var parent = (pathInput && pathInput.value || '').trim() || '/';
            var self = this;
            fetch('./api/nzb-hunt/browse/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ parent_path: parent, name: name })
            }).then(function (r) { return r.json(); }).then(function (data) {
                if (data.success) {
                    if (row) row.style.display = 'none';
                    self._loadBrowsePath(parent);
                } else {
                    if (input) { input.style.borderColor = '#f87171'; input.focus(); }
                }
            }).catch(function () { if (input) { input.style.borderColor = '#f87171'; input.focus(); } });
        },

        /* ── Browse: Rename folder ── */
        _browseRenameFolder: function (path, currentName, el) {
            var main = el && el.querySelector('.nzb-browse-item-main');
            if (!main) return;
            var origHTML = main.innerHTML;
            main.innerHTML = '<i class="fas fa-folder" style="color:#818cf8;flex-shrink:0;"></i>' +
                '<input type="text" class="nzb-browse-item-rename-input" value="' + (currentName || '').replace(/"/g, '&quot;') + '" />' +
                '<button type="button" class="nzb-browse-inline-ok nzb-rename-confirm"><i class="fas fa-check"></i></button>' +
                '<button type="button" class="nzb-browse-inline-cancel nzb-rename-cancel"><i class="fas fa-times"></i></button>';
            var inp = main.querySelector('input');
            if (inp) { inp.focus(); inp.select(); }
            main.onclick = null;
            var self = this;
            function doRename() {
                var name = (inp && inp.value || '').trim();
                if (!name || name === currentName) { revert(); return; }
                fetch('./api/nzb-hunt/browse/rename', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: path, new_name: name })
                }).then(function (r) { return r.json(); }).then(function (data) {
                    if (data.success) {
                        var pathInput = document.getElementById('nzb-browse-path-input');
                        var parent = path.replace(/\/+$/, '').split('/').slice(0, -1).join('/') || '/';
                        self._loadBrowsePath(parent || (pathInput && pathInput.value) || '/');
                    } else {
                        if (inp) { inp.style.borderColor = '#f87171'; inp.focus(); }
                    }
                }).catch(function () { revert(); });
            }
            function revert() {
                main.innerHTML = origHTML;
                self._rebindBrowseItem(el);
            }
            main.querySelector('.nzb-rename-confirm').onclick = function (e) { e.stopPropagation(); doRename(); };
            main.querySelector('.nzb-rename-cancel').onclick = function (e) { e.stopPropagation(); revert(); };
            if (inp) inp.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') { e.preventDefault(); doRename(); }
                if (e.key === 'Escape') { e.preventDefault(); revert(); }
            });
        },

        /* ── Browse: Delete folder ── */
        _pendingDeletePath: null,

        _browseShowDeleteFolder: function (path, name) {
            var row = document.getElementById('nzb-browse-delete-confirm-row');
            var nameEl = document.getElementById('nzb-browse-delete-name');
            var newRow = document.getElementById('nzb-browse-new-folder-row');
            if (newRow) newRow.style.display = 'none';
            if (!row) return;
            row.style.display = 'flex';
            if (nameEl) nameEl.textContent = 'Delete "' + (name || path) + '"?';
            this._pendingDeletePath = path;
        },

        _browseHideDeleteFolder: function () {
            var row = document.getElementById('nzb-browse-delete-confirm-row');
            if (row) row.style.display = 'none';
            this._pendingDeletePath = null;
        },

        _browseDoDeleteFolder: function () {
            var path = this._pendingDeletePath;
            var row = document.getElementById('nzb-browse-delete-confirm-row');
            if (!path) return;
            var self = this;
            fetch('./api/nzb-hunt/browse/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: path })
            }).then(function (r) { return r.json(); }).then(function (data) {
                if (data.success) {
                    if (row) row.style.display = 'none';
                    var pathInput = document.getElementById('nzb-browse-path-input');
                    var parent = path.replace(/\/+$/, '').split('/').slice(0, -1).join('/') || '/';
                    self._loadBrowsePath(parent);
                }
            }).catch(function () {});
        },

        /* ── Browse: rebind item click handlers after rename revert ── */
        _rebindBrowseItem: function (el) {
            var self = this;
            var main = el.querySelector('.nzb-browse-item-main');
            if (main) {
                main.onclick = function () {
                    var p = el.getAttribute('data-path') || '';
                    if (p) self._loadBrowsePath(p);
                };
            }
            el.querySelectorAll('.nzb-browse-item-btn').forEach(function (btn) {
                var action = btn.getAttribute('data-action');
                if (action === 'rename') {
                    btn.onclick = function (e) {
                        e.stopPropagation();
                        self._browseRenameFolder(el.getAttribute('data-path'), el.getAttribute('data-name'), el);
                    };
                } else if (action === 'delete') {
                    btn.onclick = function (e) {
                        e.stopPropagation();
                        self._browseShowDeleteFolder(el.getAttribute('data-path'), el.getAttribute('data-name'));
                    };
                }
            });
        },

        _loadBrowsePath: function (path) {
            var list = document.getElementById('nzb-browse-list');
            var pathInput = document.getElementById('nzb-browse-path-input');
            var upBtn = document.getElementById('nzb-browse-up');
            if (!list) return;

            // Hide inline rows on navigate
            var newRow = document.getElementById('nzb-browse-new-folder-row');
            var delRow = document.getElementById('nzb-browse-delete-confirm-row');
            if (newRow) newRow.style.display = 'none';
            if (delRow) delRow.style.display = 'none';

            list.innerHTML = '<div style="padding: 20px; text-align: center; color: #94a3b8;"><i class="fas fa-spinner fa-spin"></i> Loading...</div>';

            var self = this;
            fetch('./api/nzb-hunt/browse?path=' + encodeURIComponent(path) + '&t=' + Date.now())
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    if (pathInput) pathInput.value = data.path || path;
                    if (upBtn) {
                        var currentPath = (pathInput && pathInput.value || '').trim() || '/';
                        var parent = currentPath.replace(/\/+$/, '').split('/').slice(0, -1).join('/') || '/';
                        upBtn.disabled = (parent === currentPath || currentPath === '/' || currentPath === '');
                    }
                    var dirs = data.directories || [];
                    if (dirs.length === 0) {
                        list.innerHTML = '<div style="padding: 20px; text-align: center; color: #64748b;">No subdirectories</div>';
                        return;
                    }
                    var html = '';
                    for (var i = 0; i < dirs.length; i++) {
                        var d = dirs[i];
                        var rawName = d.name || '';
                        var name = rawName.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
                        var p = (d.path || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
                        var nameAttr = rawName.replace(/"/g, '&quot;');
                        html += '<div class="nzb-browse-item" data-path="' + p + '" data-name="' + nameAttr + '" title="' + p + '">' +
                            '<span class="nzb-browse-item-main">' +
                            '<i class="fas fa-folder"></i>' +
                            '<span style="font-family: monospace; font-size: 0.9rem; word-break: break-all;">' + name + '</span>' +
                            '</span>' +
                            '<span class="nzb-browse-item-actions">' +
                            '<button type="button" class="nzb-browse-item-btn" data-action="rename" title="Rename"><i class="fas fa-pen"></i></button>' +
                            '<button type="button" class="nzb-browse-item-btn" data-action="delete" title="Delete"><i class="fas fa-trash"></i></button>' +
                            '</span></div>';
                    }
                    list.innerHTML = html;
                    list.querySelectorAll('.nzb-browse-item').forEach(function (el) {
                        self._rebindBrowseItem(el);
                    });
                })
                .catch(function () {
                    list.innerHTML = '<div style="padding: 20px; text-align: center; color: #f87171;">Failed to browse directory</div>';
                });
        },

        /* ──────────────────────────────────────────────
           Servers  – CRUD + card rendering
        ────────────────────────────────────────────── */
        _setupServerGrid: function () {
            var self = this;
            var addCard = document.getElementById('nzb-add-server-card');
            if (addCard) {
                addCard.addEventListener('click', function () {
                    self._editIndex = null;
                    self._navigateToServerEditor(null);
                });
            }
        },

        _loadServers: function () {
            var self = this;
            fetch('./api/nzb-hunt/servers?t=' + Date.now())
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    self._servers = data.servers || [];
                    self._renderServerCards();
                })
                .catch(function () { self._servers = []; self._renderServerCards(); });
        },

        _renderServerCards: function () {
            var grid = document.getElementById('nzb-server-grid');
            if (!grid) return;

            // Remove existing server cards (keep the add card)
            var addCard = document.getElementById('nzb-add-server-card');
            grid.innerHTML = '';

            var self = this;
            this._servers.forEach(function (srv, idx) {
                var card = document.createElement('div');
                card.className = 'nzb-server-card';
                var statusDotId = 'nzb-server-status-' + idx;
                var statusTextId = 'nzb-server-status-text-' + idx;
                card.innerHTML =
                    '<div class="nzb-server-card-header">' +
                        '<div class="nzb-server-card-name">' +
                            '<span class="nzb-server-status-dot status-checking" id="' + statusDotId + '" title="Checking..."></span>' +
                            '<i class="fas fa-server"></i> <span>' + _esc(srv.name || 'Server') + '</span>' +
                        '</div>' +
                        '<div class="nzb-server-card-badges">' +
                            '<span class="nzb-badge nzb-badge-priority">P: ' + (srv.priority !== undefined ? srv.priority : 0) + '</span>' +
                            (srv.ssl ? '<span class="nzb-badge nzb-badge-ssl">SSL</span>' : '') +
                            '<span class="nzb-badge ' + (srv.enabled !== false ? 'nzb-badge-enabled' : 'nzb-badge-disabled') + '">' + (srv.enabled !== false ? 'ON' : 'OFF') + '</span>' +
                        '</div>' +
                    '</div>' +
                    '<div class="nzb-server-card-body">' +
                        '<div class="nzb-server-detail"><i class="fas fa-globe"></i> <span>' + _esc(srv.host || '') + ':' + (srv.port || 563) + '</span></div>' +
                        '<div class="nzb-server-detail"><i class="fas fa-plug"></i> <span>' + (srv.connections || 8) + ' connections</span></div>' +
                        (srv.username ? '<div class="nzb-server-detail"><i class="fas fa-user"></i> <span>' + _esc(srv.username) + '</span></div>' : '') +
                        (srv.password_masked ? '<div class="nzb-server-detail"><i class="fas fa-key"></i> <span style="font-family: monospace; letter-spacing: 1px;">' + _esc(srv.password_masked) + '</span></div>' : '') +
                        '<div class="nzb-server-status-line" id="' + statusTextId + '">' +
                            '<i class="fas fa-circle-notch fa-spin" style="font-size: 11px; color: #6366f1;"></i> <span style="font-size: 12px; color: #94a3b8;">Checking connection...</span>' +
                        '</div>' +
                        '<div class="nzb-server-bandwidth">' +
                            '<div class="nzb-server-bandwidth-grid">' +
                                '<span class="nzb-bw-cell"><span class="nzb-bw-label">1h</span><span class="nzb-bw-value">' + _fmtBytes(srv.bandwidth_1h || 0) + '</span></span>' +
                                '<span class="nzb-bw-cell"><span class="nzb-bw-label">24h</span><span class="nzb-bw-value">' + _fmtBytes(srv.bandwidth_24h || 0) + '</span></span>' +
                                '<span class="nzb-bw-cell"><span class="nzb-bw-label">30d</span><span class="nzb-bw-value">' + _fmtBytes(srv.bandwidth_30d || 0) + '</span></span>' +
                                '<span class="nzb-bw-cell"><span class="nzb-bw-label">Total</span><span class="nzb-bw-value">' + _fmtBytes(srv.bandwidth_total || srv.bandwidth_used || 0) + '</span></span>' +
                            '</div>' +
                            '<div class="nzb-server-bandwidth-bar"><div class="nzb-server-bandwidth-fill" style="width: ' + Math.min(100, (srv.bandwidth_pct || 0)) + '%;"></div></div>' +
                        '</div>' +
                    '</div>' +
                    '<div class="nzb-server-card-footer">' +
                        '<button class="nzb-btn" data-action="edit" data-idx="' + idx + '"><i class="fas fa-pen"></i> Edit</button>' +
                        '<button class="nzb-btn nzb-btn-danger" data-action="delete" data-idx="' + idx + '"><i class="fas fa-trash"></i> Delete</button>' +
                    '</div>' +
                    '<div class="nzb-server-card-footer nzb-server-card-footer-secondary">' +
                        '<button class="nzb-btn nzb-btn-subtle" data-action="reset-stats" data-idx="' + idx + '"><i class="fas fa-undo"></i> Reset Stats</button>' +
                    '</div>';

                card.addEventListener('click', function (e) {
                    var btn = e.target.closest('[data-action]');
                    if (!btn) return;
                    var action = btn.getAttribute('data-action');
                    var i = parseInt(btn.getAttribute('data-idx'), 10);
                    if (action === 'edit') {
                        self._editIndex = i;
                        self._navigateToServerEditor(self._servers[i]);
                    } else if (action === 'reset-stats') {
                        var name = (self._servers[i] || {}).name || 'this server';
                        var idx = i;
                        var doReset = function() {
                            fetch('./api/nzb-hunt/servers/' + idx + '/bandwidth', { method: 'DELETE' })
                                .then(function (r) { return r.json(); })
                                .then(function (data) {
                                    if (data.success) {
                                        self._loadServers();
                                        if (window.HuntarrToast) window.HuntarrToast.success('Bandwidth stats reset for "' + name + '".');
                                    }
                                })
                                .catch(function () {
                                    if (window.HuntarrToast) window.HuntarrToast.error('Failed to reset stats.');
                                });
                        };
                        if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
                            window.HuntarrConfirm.show({ title: 'Reset Bandwidth Stats', message: 'Reset all bandwidth statistics for "' + name + '"? This cannot be undone.', confirmLabel: 'Reset', onConfirm: doReset });
                        } else {
                            if (!confirm('Reset bandwidth stats for "' + name + '"?')) return;
                            doReset();
                        }
                    } else if (action === 'delete') {
                        var name = (self._servers[i] || {}).name || 'this server';
                        var idx = i;
                        var doDelete = function() {
                            fetch('./api/nzb-hunt/servers/' + idx, { method: 'DELETE' })
                                .then(function (r) { return r.json(); })
                                .then(function (data) {
                                    if (data.success) self._loadServers();
                                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                                        window.huntarrUI.showNotification('Server deleted.', 'success');
                                    }
                                })
                                .catch(function () {
                                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                                        window.huntarrUI.showNotification('Delete failed.', 'error');
                                    }
                                });
                        };
                        if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
                            window.HuntarrConfirm.show({ title: 'Delete Server', message: 'Delete "' + name + '"?', confirmLabel: 'Delete', onConfirm: doDelete });
                        } else {
                            if (!confirm('Delete "' + name + '"?')) return;
                            doDelete();
                        }
                    }
                });

                grid.appendChild(card);
            });

            // Re-add the "Add Server" card at the end
            if (addCard) grid.appendChild(addCard);

            // Auto-test each server's connection status
            this._testAllServerStatuses();
        },

        _testAllServerStatuses: function () {
            var self = this;
            this._servers.forEach(function (srv, idx) {
                if (srv.enabled === false) {
                    // Disabled servers — mark as offline / disabled
                    self._updateServerCardStatus(idx, 'offline', 'Disabled');
                    return;
                }
                // Fire off an async test for each enabled server
                // Pass server_index so backend uses the saved password
                var payload = {
                    host: srv.host || '',
                    port: srv.port || 563,
                    ssl: srv.ssl !== false,
                    username: srv.username || '',
                    password: '',
                    server_index: idx
                };
                fetch('./api/nzb-hunt/test-server', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                })
                    .then(function (r) { return r.json(); })
                    .then(function (data) {
                        if (data.success) {
                            self._updateServerCardStatus(idx, 'online', 'Connected');
                        } else {
                            self._updateServerCardStatus(idx, 'offline', data.message || 'Connection failed');
                        }
                    })
                    .catch(function () {
                        self._updateServerCardStatus(idx, 'offline', 'Test error');
                    });
            });
        },

        _updateServerCardStatus: function (idx, state, message) {
            var dot = document.getElementById('nzb-server-status-' + idx);
            var textEl = document.getElementById('nzb-server-status-text-' + idx);

            if (dot) {
                dot.className = 'nzb-server-status-dot status-' + state;
                dot.title = message;
            }

            if (textEl) {
                if (state === 'online') {
                    textEl.innerHTML = '<i class="fas fa-check-circle" style="font-size: 11px; color: #22c55e;"></i> <span style="font-size: 12px; color: #4ade80;">Connected</span>';
                } else if (state === 'offline') {
                    textEl.innerHTML = '<i class="fas fa-times-circle" style="font-size: 11px; color: #ef4444;"></i> <span style="font-size: 12px; color: #f87171;">' + _esc(message) + '</span>';
                }
            }
        },

        /* ──────────────────────────────────────────────
           Server Add/Edit (full page editor)
        ────────────────────────────────────────────── */
        _serverEditorSetupDone: false,

        _setupServerEditor: function () {
            if (this._serverEditorSetupDone) return;
            this._serverEditorSetupDone = true;

            var self = this;
            var backBtn = document.getElementById('nzb-server-editor-back');
            var saveBtn = document.getElementById('nzb-server-editor-save');
            var testBtn = document.getElementById('nzb-server-editor-test');

            if (backBtn) backBtn.addEventListener('click', function () { self._navigateBackFromServerEditor(); });
            if (saveBtn) saveBtn.addEventListener('click', function () { self._saveServer(); });
            if (testBtn) testBtn.addEventListener('click', function () { self._testServerConnection(); });

            // When any field changes, update Save button and dirty state
            self._setupServerEditorChangeDetection();

            // ESC key: navigate back when on server editor page
            document.addEventListener('keydown', function (e) {
                if (e.key === 'Escape') {
                    var bm = document.getElementById('nzb-browse-modal');
                    if (bm && bm.style.display === 'flex') { self._closeBrowseModal(); return; }
                    if (window.huntarrUI && window.huntarrUI.currentSection === 'nzb-hunt-server-editor') {
                        self._navigateBackFromServerEditor();
                    }
                }
            });
        },

        _navigateToServerEditor: function () {
            // Propagate setup wizard context to the server editor
            if (this._fromSetupWizard) {
                try { sessionStorage.setItem('setup-wizard-server-editor', '1'); } catch (e) {}
            }
            window.location.hash = 'nzb-hunt-server-editor';
        },

        _populateServerEditorForm: function () {
            var server = (this._editIndex !== null && this._servers && this._servers[this._editIndex])
                ? this._servers[this._editIndex]
                : null;

            var title = document.getElementById('nzb-server-editor-title');
            if (title) title.textContent = server ? 'Edit Server' : 'Add Server';

            // Fill fields
            var f = function (id, val) { var el = document.getElementById(id); if (el) { if (el.type === 'checkbox') el.checked = val; else el.value = val; } };
            f('nzb-server-name', server ? server.name : '');
            f('nzb-server-host', server ? server.host : '');
            f('nzb-server-port', server ? (server.port || 563) : 563);
            f('nzb-server-ssl', server ? (server.ssl !== false) : true);
            f('nzb-server-username', server ? (server.username || '') : '');
            // Password: clear the field but show masked version as placeholder
            var pwField = document.getElementById('nzb-server-password');
            if (pwField) {
                pwField.value = '';
                if (server && server.password_masked) {
                    pwField.placeholder = server.password_masked;
                } else {
                    pwField.placeholder = '';
                }
            }
            f('nzb-server-connections', server ? (server.connections || 8) : 8);
            f('nzb-server-priority', server ? (Math.min(99, Math.max(0, server.priority !== undefined ? server.priority : 0))) : 0);
            f('nzb-server-enabled', server ? (server.enabled !== false) : true);

            // Store original values for dirty detection
            this._serverEditorOriginalValues = this._getServerEditorFormSnapshot();

            // Reset test status area
            this._resetTestStatus();

            this._updateServerModalSaveButton();

            // Show/hide setup wizard banner on server editor
            var editorFromWizard = false;
            try { editorFromWizard = sessionStorage.getItem('setup-wizard-server-editor') === '1'; } catch (e) {}
            if (editorFromWizard) {
                try { sessionStorage.removeItem('setup-wizard-server-editor'); } catch (e) {}
            }
            var editorBanner = document.getElementById('nzb-server-editor-wizard-banner');
            if (editorBanner) editorBanner.style.display = (editorFromWizard || this._fromSetupWizard) ? 'flex' : 'none';
            // Hide back/breadcrumb during wizard flow (keep save button visible)
            if (editorFromWizard || this._fromSetupWizard) {
                var editorSection = document.getElementById('nzb-hunt-server-editor-section');
                var toolbarLeft = editorSection && editorSection.querySelector('.page-header-bar .reqset-toolbar-left');
                if (toolbarLeft) toolbarLeft.style.display = 'none';
            }

            // Auto-test connection when editing an existing server
            // Only auto-test if we have host AND credentials (username + password)
            if (server && server.host && server.username) {
                var self = this;
                setTimeout(function () {
                    self._showTestStatus('testing', 'Auto-detecting connection...');
                    self._testServerConnection(function (ok, msg) {
                        if (ok) {
                            self._showTestStatus('success', 'Connected to ' + server.host);
                        } else {
                            self._showTestStatus('fail', 'Could not connect: ' + (msg || 'Unknown error'));
                        }
                    });
                }, 500);
            }
        },

        _getServerEditorFormSnapshot: function () {
            var g = function (id) { var el = document.getElementById(id); if (!el) return ''; return el.type === 'checkbox' ? el.checked : el.value; };
            return {
                name: g('nzb-server-name') || '',
                host: (g('nzb-server-host') || '').trim(),
                port: String(parseInt(g('nzb-server-port'), 10) || 563),
                ssl: !!g('nzb-server-ssl'),
                username: g('nzb-server-username') || '',
                password: g('nzb-server-password') || '',
                connections: String(parseInt(g('nzb-server-connections'), 10) || 8),
                priority: String(parseInt(g('nzb-server-priority'), 10) || 0),
                enabled: !!g('nzb-server-enabled')
            };
        },

        _isServerEditorDirty: function () {
            var orig = this._serverEditorOriginalValues;
            if (!orig) return false;
            var cur = this._getServerEditorFormSnapshot();
            return orig.name !== cur.name || orig.host !== cur.host || orig.port !== cur.port ||
                orig.ssl !== cur.ssl || orig.username !== cur.username || orig.password !== cur.password ||
                orig.connections !== cur.connections || orig.priority !== cur.priority || orig.enabled !== cur.enabled;
        },

        _updateServerModalSaveButton: function () {
            var saveBtn = document.getElementById('nzb-server-editor-save');
            if (!saveBtn) return;
            var host = (document.getElementById('nzb-server-host') || {}).value;
            var hasHost = (host || '').trim().length > 0;
            var isDirty = this._isServerEditorDirty();
            var canSave = hasHost && isDirty;
            saveBtn.disabled = !canSave;
            saveBtn.title = canSave ? 'Save server' : (hasHost ? 'Save when you make changes' : 'Enter host first');
        },

        _autoTestTimer: null,

        _setupServerEditorChangeDetection: function () {
            var self = this;
            var allIds = ['nzb-server-name', 'nzb-server-host', 'nzb-server-port', 'nzb-server-ssl', 'nzb-server-username', 'nzb-server-password', 'nzb-server-connections', 'nzb-server-priority', 'nzb-server-enabled'];
            // Connection-relevant fields trigger auto-test
            var connectionIds = ['nzb-server-host', 'nzb-server-port', 'nzb-server-ssl', 'nzb-server-username', 'nzb-server-password'];

            allIds.forEach(function (id) {
                var el = document.getElementById(id);
                if (!el) return;
                var handler = function () {
                    self._updateServerModalSaveButton();
                    // Auto-test when connection-relevant fields change
                    // Requires host AND username to be filled before auto-testing
                    if (connectionIds.indexOf(id) !== -1) {
                        var host = (document.getElementById('nzb-server-host') || {}).value || '';
                        var username = (document.getElementById('nzb-server-username') || {}).value || '';
                        if (host.trim().length > 3 && username.trim().length > 0) {
                            // Debounce: wait 1.5s after last keystroke
                            if (self._autoTestTimer) clearTimeout(self._autoTestTimer);
                            self._autoTestTimer = setTimeout(function () {
                                self._showTestStatus('testing', 'Auto-detecting connection...');
                                self._testServerConnection(function (ok, msg) {
                                    if (ok) {
                                        self._showTestStatus('success', 'Connected to ' + host.trim());
                                    } else {
                                        self._showTestStatus('fail', 'Could not connect: ' + (msg || 'Unknown error'));
                                    }
                                });
                            }, 1500);
                        }
                    }
                };
                el.removeEventListener('input', handler);
                el.removeEventListener('change', handler);
                el.addEventListener('input', handler);
                el.addEventListener('change', handler);
            });
        },

        _confirmLeaveServerEditor: function (targetSection) {
            var self = this;
            window.HuntarrConfirm.show({
                title: 'Unsaved Changes',
                message: 'You have unsaved changes that will be lost if you leave.',
                confirmLabel: 'Go Back',
                cancelLabel: 'Leave',
                onConfirm: function () { /* Stay on editor */ },
                onCancel: function () {
                    self._serverEditorOriginalValues = self._getServerEditorFormSnapshot();
                    self._updateServerModalSaveButton();
                    // Re-set the wizard flag so the servers page banner shows again
                    if (self._fromSetupWizard) {
                        try { sessionStorage.setItem('setup-wizard-active-nav', '1'); } catch (e) {}
                    }
                    if (window.huntarrUI && typeof window.huntarrUI.switchSection === 'function') {
                        window.huntarrUI.switchSection(targetSection);
                        window.location.hash = targetSection;
                    }
                }
            });
        },

        _navigateBackFromServerEditor: function () {
            if (this._isServerEditorDirty()) {
                this._confirmLeaveServerEditor('nzb-hunt-servers');
                return;
            }
            // Re-set the wizard flag so the servers page banner shows again
            if (this._fromSetupWizard) {
                try { sessionStorage.setItem('setup-wizard-active-nav', '1'); } catch (e) {}
            }
            if (window.huntarrUI && typeof window.huntarrUI.switchSection === 'function') {
                window.huntarrUI.switchSection('nzb-hunt-servers');
                window.location.hash = 'nzb-hunt-servers';
            }
        },

        _saveServer: function () {
            var g = function (id) { var el = document.getElementById(id); if (!el) return ''; return el.type === 'checkbox' ? el.checked : el.value; };
            var host = (g('nzb-server-host') || '').trim();
            if (!host) {
                this._showTestStatus('fail', 'Host is required.');
                return;
            }

            var rawPriority = parseInt(g('nzb-server-priority'), 10);
            var priority = (isNaN(rawPriority) ? 0 : Math.min(99, Math.max(0, rawPriority)));
            var payload = {
                name: g('nzb-server-name') || 'Server',
                host: host,
                port: parseInt(g('nzb-server-port'), 10) || 563,
                ssl: !!g('nzb-server-ssl'),
                username: g('nzb-server-username'),
                password: g('nzb-server-password'),
                connections: parseInt(g('nzb-server-connections'), 10) || 8,
                priority: priority,
                enabled: !!g('nzb-server-enabled')
            };

            var self = this;
            var url, method;
            if (this._editIndex !== null) {
                url = './api/nzb-hunt/servers/' + this._editIndex;
                method = 'PUT';
            } else {
                url = './api/nzb-hunt/servers';
                method = 'POST';
            }

            // Show testing status in modal before save
            self._showTestStatus('testing', 'Saving & testing connection...');

            fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    if (data.success) {
                        self._serverEditorOriginalValues = self._getServerEditorFormSnapshot();
                        self._updateServerModalSaveButton();
                        self._loadServers();
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification('Server saved successfully.', 'success');
                        }
                        // Auto-test connection in background
                        var hostName = (document.getElementById('nzb-server-host') || {}).value || 'server';
                        self._testServerConnection(function (testSuccess, testMsg) {
                            if (testSuccess) {
                                self._showTestStatus('success', 'Connected to ' + hostName);
                            } else {
                                self._showTestStatus('fail', 'Connection to ' + hostName + ' failed: ' + testMsg);
                            }
                        });
                    } else {
                        self._showTestStatus('fail', 'Failed to save server.');
                    }
                })
                .catch(function () {
                    self._showTestStatus('fail', 'Failed to save server.');
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification('Failed to save server.', 'error');
                    }
                });
        },

        /* ── Connection Test Helpers ─────────────────────── */

        _resetTestStatus: function () {
            var el = document.getElementById('nzb-server-test-status');
            if (el) {
                el.style.display = 'none';
                el.className = 'nzb-server-test-status';
            }
            // Also reset pill
            var pill = document.getElementById('nzb-server-connection-pill');
            if (pill) pill.style.display = 'none';
        },

        _showTestStatus: function (state, message) {
            // Legacy status bar is permanently hidden — status shown via header pill only

            // Update connection pill in header
            var pill = document.getElementById('nzb-server-connection-pill');
            var pillIcon = document.getElementById('nzb-server-pill-icon');
            var pillText = document.getElementById('nzb-server-pill-text');
            if (pill) {
                pill.style.display = 'inline-flex';
                pill.className = 'nzb-server-connection-pill pill-' + (state === 'testing' ? 'checking' : state);
                if (pillIcon) {
                    if (state === 'testing') pillIcon.className = 'fas fa-circle-notch fa-spin';
                    else if (state === 'success') pillIcon.className = 'fas fa-check-circle';
                    else pillIcon.className = 'fas fa-times-circle';
                }
                if (pillText) {
                    // Show short text in pill
                    if (state === 'testing') pillText.textContent = 'Checking...';
                    else if (state === 'success') {
                        var host = (document.getElementById('nzb-server-host') || {}).value || '';
                        pillText.textContent = 'Connected' + (host ? ' to ' + host.trim() : '');
                    } else {
                        pillText.textContent = 'Connection Failed';
                    }
                }
            }
        },

        _testServerConnection: function (callback) {
            var g = function (id) { var el = document.getElementById(id); if (!el) return ''; return el.type === 'checkbox' ? el.checked : el.value; };
            var host = (g('nzb-server-host') || '').trim();
            if (!host) {
                this._showTestStatus('fail', 'Host is required to test connection.');
                if (callback) callback(false, 'Host is required');
                return;
            }

            var payload = {
                host: host,
                port: parseInt(g('nzb-server-port'), 10) || 563,
                ssl: !!g('nzb-server-ssl'),
                username: (g('nzb-server-username') || '').trim(),
                password: (g('nzb-server-password') || '').trim()
            };

            // If editing an existing server and password field is empty,
            // pass server_index so backend can use the saved password
            if (!payload.password && this._editIndex !== null) {
                payload.server_index = this._editIndex;
            }

            var self = this;
            if (!callback) {
                // Manual test button click – show testing state
                self._showTestStatus('testing', 'Testing connection to ' + host + ':' + payload.port + '...');
            }

            fetch('./api/nzb-hunt/test-server', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    if (callback) {
                        callback(data.success, data.message || '');
                    } else {
                        if (data.success) {
                            self._showTestStatus('success', 'Connected to ' + host + '.');
                        } else {
                            self._showTestStatus('fail', 'Connection to ' + host + ' failed: ' + (data.message || 'Unknown error'));
                        }
                    }
                })
                .catch(function (err) {
                    var errMsg = 'Network error testing connection.';
                    if (callback) {
                        callback(false, errMsg);
                    } else {
                        self._showTestStatus('fail', errMsg);
                    }
                });
        },

        /* ──────────────────────────────────────────────
           Categories  – CRUD + card rendering
        ────────────────────────────────────────────── */
        _categoriesBaseFolder: '/downloads/complete',  // Internal base folder for auto-gen

        _getBaseFolder: function () {
            return this._categoriesBaseFolder || '/downloads/complete';
        },

        _setupCategoryGrid: function () {
            // Categories are auto-generated from instances — no Add/Edit/Delete
        },

        _loadCategories: function () {
            var self = this;
            fetch('./api/nzb-hunt/categories?t=' + Date.now())
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    self._categories = data.categories || [];
                    if (data.base_folder) self._categoriesBaseFolder = data.base_folder;
                    // Ensure folder creation and get status (success/error per category)
                    return fetch('./api/nzb-hunt/categories/ensure-folders', { method: 'POST' })
                        .then(function (r2) { return r2.json(); })
                        .then(function (ensureData) {
                            var statusMap = {};
                            (ensureData.status || []).forEach(function (s) {
                                statusMap[s.name] = { ok: s.ok, error: s.error };
                            });
                            self._categories.forEach(function (c) {
                                var st = statusMap[c.name] || {};
                                c._folderOk = st.ok;
                                c._folderError = st.error;
                            });
                        })
                        .catch(function () { /* keep categories, render without status */ });
                })
                .then(function () { self._renderCategoryCards(); })
                .catch(function () { self._categories = []; self._renderCategoryCards(); });
        },

        _renderCategoryCards: function () {
            var grid = document.getElementById('nzb-cat-grid');
            if (!grid) return;
            grid.innerHTML = '';

            var self = this;
            this._categories.forEach(function (cat) {
                var card = document.createElement('div');
                card.className = 'nzb-cat-card nzb-cat-card-readonly';
                var statusIcon = cat._folderOk ? '<i class="fas fa-check-circle nzb-cat-status-ok" title="Folder created and writeable"></i>' :
                    (cat._folderError ? '<i class="fas fa-exclamation-circle nzb-cat-status-error" title="' + _esc(cat._folderError || 'Error') + '"></i>' : '');
                card.innerHTML =
                    '<div class="nzb-cat-card-header">' +
                        '<div class="nzb-cat-card-name"><i class="fas fa-tag"></i> <span>' + _esc(cat.name || 'Category') + '</span></div>' +
                        '<div class="nzb-cat-card-badges">' +
                            '<span class="nzb-badge nzb-badge-priority-cat">' + _esc(_capFirst(cat.priority || 'normal')) + '</span>' +
                            (statusIcon ? '<span class="nzb-cat-status">' + statusIcon + '</span>' : '') +
                        '</div>' +
                    '</div>' +
                    '<div class="nzb-cat-card-body">' +
                        '<div class="nzb-cat-card-path nzb-cat-path-readonly"><i class="fas fa-folder"></i> <span>' + _esc(cat.folder || '') + '</span></div>' +
                        (cat._folderError ? '<div class="nzb-cat-error-msg">' + _esc(cat._folderError) + '</div>' : '') +
                    '</div>';
                grid.appendChild(card);
            });
        },

        /* ──────────────────────────────────────────────
           Category Add/Edit Modal
        ────────────────────────────────────────────── */
        _setupCategoryModal: function () {
            // Categories are auto-generated — no Add/Edit modal
        },

        /* ──────────────────────────────────────────────
           Processing  – load / save (merged into Advanced)
        ────────────────────────────────────────────── */
        _loadProcessing: function () {
            fetch('./api/nzb-hunt/settings/processing?t=' + Date.now())
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    var el;
                    el = document.getElementById('nzb-proc-max-retries');
                    if (el && data.max_retries !== undefined) el.value = data.max_retries;

                    el = document.getElementById('nzb-proc-abort-hopeless');
                    if (el) el.checked = data.abort_hopeless !== false;

                    el = document.getElementById('nzb-proc-abort-threshold');
                    if (el && data.abort_threshold_pct !== undefined) el.value = data.abort_threshold_pct;

                    el = document.getElementById('nzb-proc-propagation-delay');
                    if (el && data.propagation_delay !== undefined) el.value = data.propagation_delay;

                    el = document.getElementById('nzb-proc-disconnect-empty');
                    if (el) el.checked = data.disconnect_on_empty !== false;

                    el = document.getElementById('nzb-proc-direct-unpack');
                    if (el) el.checked = !!data.direct_unpack;

                    el = document.getElementById('nzb-proc-encrypted-rar');
                    if (el && data.encrypted_rar_action) el.value = data.encrypted_rar_action;

                    el = document.getElementById('nzb-proc-unwanted-action');
                    if (el && data.unwanted_ext_action) el.value = data.unwanted_ext_action;

                    el = document.getElementById('nzb-proc-unwanted-ext');
                    if (el && data.unwanted_extensions !== undefined) el.value = data.unwanted_extensions;

                    el = document.getElementById('nzb-proc-identical-detection');
                    if (el && data.identical_detection) el.value = data.identical_detection;

                    el = document.getElementById('nzb-proc-smart-detection');
                    if (el && data.smart_detection) el.value = data.smart_detection;

                    el = document.getElementById('nzb-proc-allow-proper');
                    if (el) el.checked = data.allow_proper !== false;

                    // Hide threshold row if abort is off
                    var abortEl = document.getElementById('nzb-proc-abort-hopeless');
                    var thresholdRow = document.getElementById('nzb-proc-abort-threshold-row');
                    if (abortEl && thresholdRow) {
                        thresholdRow.style.display = abortEl.checked ? '' : 'none';
                    }
                })
                .catch(function () { /* use defaults */ });
        },

        /* ──────────────────────────────────────────────
           Advanced settings (includes Processing)
        ────────────────────────────────────────────── */
        _setupAdvanced: function () {
            var self = this;
            // Header save button (primary)
            var headerSaveBtn = document.getElementById('nzb-save-advanced-header');
            if (headerSaveBtn) {
                headerSaveBtn.addEventListener('click', function () { self._saveAdvanced(); });
            }
            // Legacy bottom save button (fallback)
            var saveBtn = document.getElementById('nzb-save-advanced');
            if (saveBtn) {
                saveBtn.addEventListener('click', function () { self._saveAdvanced(); });
            }
            // Show/hide abort threshold row based on toggle (processing settings in Advanced)
            var abortToggle = document.getElementById('nzb-proc-abort-hopeless');
            var thresholdRow = document.getElementById('nzb-proc-abort-threshold-row');
            if (abortToggle && thresholdRow) {
                abortToggle.addEventListener('change', function () {
                    thresholdRow.style.display = abortToggle.checked ? '' : 'none';
                });
            }
        },

        _loadAdvanced: function () {
            fetch('./api/nzb-hunt/settings/advanced?t=' + Date.now())
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    var el;
                    el = document.getElementById('nzb-adv-receive-threads');
                    if (el && data.receive_threads !== undefined) el.value = data.receive_threads;

                    el = document.getElementById('nzb-adv-sleep-time');
                    if (el && data.downloader_sleep_time !== undefined) el.value = data.downloader_sleep_time;

                    el = document.getElementById('nzb-adv-unpack-threads');
                    if (el && data.direct_unpack_threads !== undefined) el.value = data.direct_unpack_threads;

                    el = document.getElementById('nzb-adv-size-limit');
                    if (el && data.size_limit !== undefined) el.value = data.size_limit;

                    el = document.getElementById('nzb-adv-completion-rate');
                    if (el && data.req_completion_rate !== undefined) el.value = data.req_completion_rate;

                    el = document.getElementById('nzb-adv-url-retries');
                    if (el && data.max_url_retries !== undefined) el.value = data.max_url_retries;
                })
                .catch(function () { /* use defaults */ });
        },

        _saveAdvanced: function () {
            var advPayload = {
                receive_threads: parseInt((document.getElementById('nzb-adv-receive-threads') || {}).value || '2', 10),
                downloader_sleep_time: parseInt((document.getElementById('nzb-adv-sleep-time') || {}).value || '10', 10),
                direct_unpack_threads: parseInt((document.getElementById('nzb-adv-unpack-threads') || {}).value || '3', 10),
                size_limit: (document.getElementById('nzb-adv-size-limit') || {}).value || '',
                req_completion_rate: parseFloat((document.getElementById('nzb-adv-completion-rate') || {}).value || '100.2'),
                max_url_retries: parseInt((document.getElementById('nzb-adv-url-retries') || {}).value || '10', 10)
            };
            var procPayload = {
                max_retries: parseInt((document.getElementById('nzb-proc-max-retries') || {}).value || '3', 10),
                abort_hopeless: !!(document.getElementById('nzb-proc-abort-hopeless') || {}).checked,
                abort_threshold_pct: parseInt((document.getElementById('nzb-proc-abort-threshold') || {}).value || '5', 10),
                propagation_delay: parseInt((document.getElementById('nzb-proc-propagation-delay') || {}).value || '0', 10),
                disconnect_on_empty: !!(document.getElementById('nzb-proc-disconnect-empty') || {}).checked,
                direct_unpack: !!(document.getElementById('nzb-proc-direct-unpack') || {}).checked,
                encrypted_rar_action: (document.getElementById('nzb-proc-encrypted-rar') || {}).value || 'pause',
                unwanted_ext_action: (document.getElementById('nzb-proc-unwanted-action') || {}).value || 'off',
                unwanted_extensions: (document.getElementById('nzb-proc-unwanted-ext') || {}).value || '',
                identical_detection: (document.getElementById('nzb-proc-identical-detection') || {}).value || 'on',
                smart_detection: (document.getElementById('nzb-proc-smart-detection') || {}).value || 'on',
                allow_proper: !!(document.getElementById('nzb-proc-allow-proper') || {}).checked
            };

            var self = this;
            Promise.all([
                fetch('./api/nzb-hunt/settings/advanced', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(advPayload)
                }).then(function (r) { return r.json(); }),
                fetch('./api/nzb-hunt/settings/processing', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(procPayload)
                }).then(function (r) { return r.json(); })
            ])
                .then(function (results) {
                    var advOk = results[0] && results[0].success;
                    var procOk = results[1] && results[1].success;
                    if ((advOk || procOk) && window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification('Advanced settings saved.', 'success');
                    }
                })
                .catch(function () {
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification('Failed to save advanced settings.', 'error');
                    }
                });
        }
    };

    /* ── Helpers ────────────────────────────────────────────────────── */
    function _esc(s) {
        var d = document.createElement('div');
        d.textContent = s || '';
        return d.innerHTML;
    }

    function _fmtBytes(b) {
        if (!b || b <= 0) return '0 B';
        var units = ['B', 'KB', 'MB', 'GB', 'TB'];
        var i = Math.floor(Math.log(b) / Math.log(1024));
        return (b / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
    }

    function _capFirst(s) {
        if (!s) return '';
        return s.charAt(0).toUpperCase() + s.slice(1);
    }

    // Initialize on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { /* wait for section switch */ });
    }
})();
