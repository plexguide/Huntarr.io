/**
 * Tor Hunt - Built-in torrent download engine UI
 * Manages queue, history, speed controls, and add-torrent modal.
 */
(function () {
    'use strict';

    function _fmt(bytes) {
        if (!bytes || bytes <= 0) return '0 B';
        var u = ['B', 'KB', 'MB', 'GB', 'TB'];
        var i = Math.floor(Math.log(bytes) / Math.log(1024));
        if (i >= u.length) i = u.length - 1;
        return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + u[i];
    }

    function _fmtSpeed(bps) { return _fmt(bps) + '/s'; }

    window.TorHunt = {
        currentTab: 'queue',
        _currentView: 'downloads',
        _pollTimer: null,
        _paused: false,
        _queueFingerprint: '',
        _settingsLoaded: false,

        init: function () {
            var self = this;
            this._setupTabs();
            this.showTab('queue');
            this._setupPauseBtn();
            this._setupAddModal();
            this._setupSpeedLimit();

            // Refresh buttons
            var qRef = document.querySelector('#tor-hunt-section [data-panel="queue"] .tor-queue-actions .tor-btn');
            if (qRef) qRef.addEventListener('click', function () { self._poll(); });
            var hRef = document.querySelector('#tor-hunt-section [data-panel="history"] .tor-queue-actions .tor-btn[title="Refresh"]');
            if (hRef) hRef.addEventListener('click', function () { self._fetchHistory(); });
            var hClr = document.querySelector('#tor-hunt-section [data-panel="history"] .tor-btn-danger');
            if (hClr) hClr.addEventListener('click', function () { self._clearHistory(); });

            this._poll();
            this._fetchHistory();
            this._startPolling();
            console.log('[TorHunt] Initialized');
        },

        showView: function (view) {
            var dlView = document.getElementById('tor-hunt-downloads-view');
            var stView = document.getElementById('tor-hunt-settings-view');
            if (view === 'settings') {
                if (dlView) dlView.style.display = 'none';
                if (stView) stView.style.display = '';
                this._currentView = 'settings';
                this._loadSettings();
            } else {
                if (dlView) dlView.style.display = '';
                if (stView) stView.style.display = 'none';
                this._currentView = 'downloads';
            }
        },

        stopPolling: function () {
            if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
        },

        _startPolling: function () {
            var self = this;
            this.stopPolling();
            this._pollTimer = setInterval(function () { self._poll(); }, 2000);
        },

        _setupTabs: function () {
            var self = this;
            var tabs = document.querySelectorAll('#tor-hunt-section .tor-tab');
            tabs.forEach(function (t) {
                t.addEventListener('click', function () { self.showTab(t.getAttribute('data-tab')); });
            });
        },

        showTab: function (tab) {
            this.currentTab = tab;
            document.querySelectorAll('#tor-hunt-section .tor-tab').forEach(function (t) {
                t.classList.toggle('active', t.getAttribute('data-tab') === tab);
            });
            document.querySelectorAll('#tor-hunt-section .tor-panel').forEach(function (p) {
                p.style.display = p.getAttribute('data-panel') === tab ? '' : 'none';
            });
        },

        /* ── Pause / Resume ── */
        _setupPauseBtn: function () {
            var self = this;
            var btn = document.getElementById('tor-pause-btn');
            if (!btn) return;
            btn.addEventListener('click', function () {
                self._paused = !self._paused;
                var icon = btn.querySelector('i');
                if (icon) icon.className = self._paused ? 'fas fa-play' : 'fas fa-pause';
                btn.title = self._paused ? 'Resume all torrents' : 'Pause all torrents';
                fetch(self._paused ? './api/tor-hunt/queue/pause-all' : './api/tor-hunt/queue/resume-all', { method: 'POST' })
                    .then(function () { self._poll(); })
                    .catch(function (e) { console.error('[TorHunt] Pause/resume error:', e); });
            });
        },

        /* ── Add Torrent Modal ── */
        _setupAddModal: function () {
            var self = this;
            var modal = document.getElementById('tor-add-modal');
            var addBtn = document.getElementById('tor-add-btn');
            var closeBtn = document.getElementById('tor-add-modal-close');
            var cancelBtn = document.getElementById('tor-add-cancel');
            var submitBtn = document.getElementById('tor-add-submit');
            if (addBtn) addBtn.addEventListener('click', function () { modal.style.display = 'flex'; });
            if (closeBtn) closeBtn.addEventListener('click', function () { modal.style.display = 'none'; });
            if (cancelBtn) cancelBtn.addEventListener('click', function () { modal.style.display = 'none'; });
            if (modal) modal.addEventListener('click', function (e) { if (e.target === modal) modal.style.display = 'none'; });
            if (submitBtn) submitBtn.addEventListener('click', function () { self._addTorrent(); });
        },

        _addTorrent: function () {
            var url = (document.getElementById('tor-add-url').value || '').trim();
            var cat = (document.getElementById('tor-add-category').value || '').trim();
            if (!url) return;
            var self = this;
            fetch('./api/tor-hunt/queue/add', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ urls: url, category: cat })
            })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.success) {
                    document.getElementById('tor-add-modal').style.display = 'none';
                    document.getElementById('tor-add-url').value = '';
                    document.getElementById('tor-add-category').value = '';
                    self._poll();
                    if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Torrent added', 'success');
                } else {
                    if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification(data.error || 'Failed to add', 'error');
                }
            })
            .catch(function (e) { console.error('[TorHunt] Add error:', e); });
        },

        /* ── Speed Limit ── */
        _setupSpeedLimit: function () {
            var self = this;
            var ctrl = document.getElementById('tor-speed-control');
            var popover = document.getElementById('tor-speed-popover');
            if (!ctrl || !popover) return;
            ctrl.addEventListener('click', function (e) {
                e.stopPropagation();
                popover.style.display = popover.style.display === 'none' ? '' : 'none';
            });
            document.addEventListener('click', function () { popover.style.display = 'none'; });
            popover.addEventListener('click', function (e) { e.stopPropagation(); });
            popover.querySelectorAll('.tor-speed-opt').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    self._setSpeedLimit(parseInt(btn.getAttribute('data-limit'), 10));
                    popover.style.display = 'none';
                });
            });
            var customBtn = document.getElementById('tor-speed-custom-btn');
            var customInput = document.getElementById('tor-speed-custom-input');
            if (customBtn && customInput) {
                customBtn.addEventListener('click', function () {
                    var mb = parseFloat(customInput.value);
                    if (!isNaN(mb) && mb >= 0) {
                        self._setSpeedLimit(Math.round(mb * 1024 * 1024));
                        popover.style.display = 'none';
                        customInput.value = '';
                    }
                });
            }
        },

        _setSpeedLimit: function (limit) {
            fetch('./api/tor-hunt/speed-limit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ limit: limit })
            }).catch(function (e) { console.error('[TorHunt] Speed limit error:', e); });
            var badge = document.getElementById('tor-speed-limit-badge');
            if (badge) {
                if (limit > 0) { badge.textContent = _fmt(limit) + '/s'; badge.style.display = ''; }
                else { badge.style.display = 'none'; }
            }
        },

        /* ── Poll (queue + status) ── */
        _poll: function () {
            var self = this;
            fetch('./api/tor-hunt/poll')
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    self._renderStatus(data.status || {});
                    self._renderQueue(data.queue || []);
                })
                .catch(function (e) { console.error('[TorHunt] Poll error:', e); });
        },

        _renderStatus: function (s) {
            var dlEl = document.getElementById('tor-dl-speed');
            var upEl = document.getElementById('tor-up-speed');
            var dlCount = document.getElementById('tor-downloading-count');
            var seedCount = document.getElementById('tor-seeding-count');
            if (dlEl) dlEl.textContent = _fmtSpeed(s.dl_speed || 0);
            if (upEl) upEl.textContent = _fmtSpeed(s.up_speed || 0);
            if (dlCount) dlCount.textContent = s.downloading || 0;
            if (seedCount) seedCount.textContent = s.seeding || 0;
            // Update pause button state
            var pauseBtn = document.getElementById('tor-pause-btn');
            if (pauseBtn && s.paused_global !== undefined) {
                this._paused = s.paused_global;
                var icon = pauseBtn.querySelector('i');
                if (icon) icon.className = s.paused_global ? 'fas fa-play' : 'fas fa-pause';
                pauseBtn.title = s.paused_global ? 'Resume all torrents' : 'Pause all torrents';
            }
        },

        _buildFingerprint: function (queue) {
            if (!queue || !queue.length) return '[]';
            var parts = [];
            for (var i = 0; i < queue.length; i++) {
                var q = queue[i];
                parts.push(q.id + '|' + q.state + '|' + Math.round(q.progress || 0) + '|' + (q.dl_speed || 0));
            }
            return parts.join(';');
        },

        _renderQueue: function (queue) {
            var fp = this._buildFingerprint(queue);
            if (fp === this._queueFingerprint) return;
            this._queueFingerprint = fp;

            var list = document.getElementById('tor-queue-list');
            if (!list) return;
            if (!queue.length) {
                list.innerHTML = '<div class="tor-empty-state"><i class="fas fa-magnet"></i><p>No active torrents</p></div>';
                return;
            }
            var self = this;
            var html = '';
            for (var i = 0; i < queue.length; i++) {
                var t = queue[i];
                var pct = Math.round(t.progress || 0);
                var state = (t.state || 'unknown').toLowerCase();
                var stateClass = 'tor-state-' + (state === 'downloading' ? 'downloading' : state === 'seeding' ? 'seeding' : state === 'paused' ? 'paused' : state === 'checking' ? 'checking' : state === 'error' ? 'error' : 'queued');
                var fillClass = state === 'seeding' ? 'tor-progress-fill seeding' : 'tor-progress-fill';
                var isPaused = state === 'paused';
                html += '<div class="tor-queue-item" data-id="' + t.id + '">';
                html += '<div class="tor-queue-item-info">';
                html += '<div class="tor-queue-item-name" title="' + (t.name || '').replace(/"/g, '&quot;') + '">' + (t.name || 'Unknown') + '</div>';
                html += '<div class="tor-queue-item-meta">';
                html += '<span class="tor-state-badge ' + stateClass + '">' + state + '</span>';
                html += '<span>' + _fmt(t.size || 0) + '</span>';
                if (t.dl_speed > 0) html += '<span>' + _fmtSpeed(t.dl_speed) + ' ↓</span>';
                if (t.up_speed > 0) html += '<span>' + _fmtSpeed(t.up_speed) + ' ↑</span>';
                if (t.time_left && t.time_left !== '-') html += '<span>ETA: ' + t.time_left + '</span>';
                if (t.num_seeds !== undefined) html += '<span>Seeds: ' + t.num_seeds + '</span>';
                if (t.num_peers !== undefined) html += '<span>Peers: ' + t.num_peers + '</span>';
                html += '</div></div>';
                html += '<div class="tor-queue-item-progress">';
                html += '<div class="tor-progress-bar"><div class="' + fillClass + '" style="width:' + pct + '%"></div></div>';
                html += '<div class="tor-progress-text">' + pct + '%</div>';
                html += '</div>';
                html += '<div class="tor-queue-item-actions">';
                if (isPaused) {
                    html += '<button class="tor-btn" data-action="resume" data-id="' + t.id + '" title="Resume"><i class="fas fa-play"></i></button>';
                } else {
                    html += '<button class="tor-btn" data-action="pause" data-id="' + t.id + '" title="Pause"><i class="fas fa-pause"></i></button>';
                }
                html += '<button class="tor-btn tor-btn-danger" data-action="remove" data-id="' + t.id + '" title="Remove"><i class="fas fa-trash"></i></button>';
                html += '</div></div>';
            }
            list.innerHTML = html;

            // Wire action buttons
            list.querySelectorAll('[data-action]').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    var action = btn.getAttribute('data-action');
                    var id = btn.getAttribute('data-id');
                    if (action === 'pause') self._pauseItem(id);
                    else if (action === 'resume') self._resumeItem(id);
                    else if (action === 'remove') self._removeItem(id);
                });
            });
        },

        _pauseItem: function (id) {
            var self = this;
            fetch('./api/tor-hunt/queue/' + encodeURIComponent(id) + '/pause', { method: 'POST' })
                .then(function () { self._poll(); });
        },
        _resumeItem: function (id) {
            var self = this;
            fetch('./api/tor-hunt/queue/' + encodeURIComponent(id) + '/resume', { method: 'POST' })
                .then(function () { self._poll(); });
        },
        _removeItem: function (id) {
            var self = this;
            if (window.showConfirm) {
                window.showConfirm('Remove Torrent', 'Remove this torrent and delete downloaded files?', function () {
                    fetch('./api/tor-hunt/queue/' + encodeURIComponent(id) + '?delete_files=true', { method: 'DELETE' })
                        .then(function () { self._poll(); });
                }, 'Remove', 'btn-danger');
            } else {
                fetch('./api/tor-hunt/queue/' + encodeURIComponent(id) + '?delete_files=true', { method: 'DELETE' })
                    .then(function () { self._poll(); });
            }
        },

        /* ── History ── */
        _historyFingerprint: '',

        _fetchHistory: function () {
            var self = this;
            fetch('./api/tor-hunt/history')
                .then(function (r) { return r.json(); })
                .then(function (data) { self._renderHistory(data || []); })
                .catch(function (e) { console.error('[TorHunt] History error:', e); });
        },

        _renderHistory: function (history) {
            var fp = history.length + ':' + (history[0] ? history[0].id : '');
            if (fp === this._historyFingerprint) return;
            this._historyFingerprint = fp;

            var list = document.getElementById('tor-history-list');
            if (!list) return;
            if (!history.length) {
                list.innerHTML = '<div class="tor-empty-state"><i class="fas fa-history"></i><p>No download history</p></div>';
                return;
            }
            var self = this;
            var html = '';
            for (var i = 0; i < history.length; i++) {
                var h = history[i];
                html += '<div class="tor-history-item" data-id="' + (h.id || '') + '">';
                html += '<div class="tor-history-item-info">';
                html += '<div class="tor-history-item-name" title="' + (h.name || '').replace(/"/g, '&quot;') + '">' + (h.name || 'Unknown') + '</div>';
                html += '<div class="tor-history-item-meta">';
                html += '<span>' + _fmt(h.size || 0) + '</span>';
                if (h.completed_at) html += '<span>' + new Date(h.completed_at * 1000).toLocaleDateString() + '</span>';
                if (h.category) html += '<span>' + h.category + '</span>';
                html += '</div></div>';
                html += '<div class="tor-history-item-actions">';
                html += '<button class="tor-btn tor-btn-danger" data-action="delete-history" data-id="' + (h.id || '') + '" title="Delete"><i class="fas fa-trash"></i></button>';
                html += '</div></div>';
            }
            list.innerHTML = html;
            list.querySelectorAll('[data-action="delete-history"]').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    var id = btn.getAttribute('data-id');
                    fetch('./api/tor-hunt/history/' + encodeURIComponent(id), { method: 'DELETE' })
                        .then(function () { self._fetchHistory(); });
                });
            });
        },

        _clearHistory: function () {
            var self = this;
            if (window.showConfirm) {
                window.showConfirm('Clear History', 'Clear all download history?', function () {
                    fetch('./api/tor-hunt/history', { method: 'DELETE' })
                        .then(function () { self._fetchHistory(); });
                }, 'Clear', 'btn-danger');
            } else {
                fetch('./api/tor-hunt/history', { method: 'DELETE' })
                    .then(function () { self._fetchHistory(); });
            }
        },

        /* ── Settings ── */
        _loadSettings: function () {
            var self = this;
            fetch('./api/tor-hunt/settings')
                .then(function (r) { return r.json(); })
                .then(function (cfg) {
                    self._populateSettings(cfg);
                    if (!self._settingsLoaded) {
                        self._setupSettingsSave();
                        self._settingsLoaded = true;
                    }
                })
                .catch(function (e) { console.error('[TorHunt] Settings load error:', e); });
        },

        _populateSettings: function (cfg) {
            var el = function (id) { return document.getElementById(id); };
            if (el('tor-cfg-download-dir')) el('tor-cfg-download-dir').value = cfg.download_dir || '/downloads/tor-hunt';
            if (el('tor-cfg-temp-dir')) el('tor-cfg-temp-dir').value = cfg.temp_dir || '/downloads/tor-hunt/incomplete';
            if (el('tor-cfg-listen-port')) el('tor-cfg-listen-port').value = cfg.listen_port || 6881;
            if (el('tor-cfg-max-connections')) el('tor-cfg-max-connections').value = cfg.max_connections || 200;
            if (el('tor-cfg-encryption')) el('tor-cfg-encryption').value = cfg.encryption_mode || 0;
            if (el('tor-cfg-dl-limit')) el('tor-cfg-dl-limit').value = Math.round((cfg.download_rate_limit || 0) / 1024);
            if (el('tor-cfg-ul-limit')) el('tor-cfg-ul-limit').value = Math.round((cfg.upload_rate_limit || 0) / 1024);
            if (el('tor-cfg-active-downloads')) el('tor-cfg-active-downloads').value = cfg.active_downloads || 8;
            if (el('tor-cfg-active-seeds')) el('tor-cfg-active-seeds').value = cfg.active_seeds || 10;
            if (el('tor-cfg-active-limit')) el('tor-cfg-active-limit').value = cfg.active_limit || 20;
            if (el('tor-cfg-seed-ratio')) el('tor-cfg-seed-ratio').value = cfg.seed_ratio_limit || 0;
            if (el('tor-cfg-seed-time')) el('tor-cfg-seed-time').value = cfg.seed_time_limit || 0;
            if (el('tor-cfg-dht')) el('tor-cfg-dht').checked = cfg.enable_dht !== false;
            if (el('tor-cfg-lsd')) el('tor-cfg-lsd').checked = cfg.enable_lsd !== false;
            if (el('tor-cfg-upnp')) el('tor-cfg-upnp').checked = cfg.enable_upnp !== false;
            if (el('tor-cfg-natpmp')) el('tor-cfg-natpmp').checked = cfg.enable_natpmp !== false;
        },

        _setupSettingsSave: function () {
            var self = this;
            var btn = document.getElementById('tor-settings-save-btn');
            if (!btn) return;
            btn.addEventListener('click', function () { self._saveSettings(); });
        },

        _saveSettings: function () {
            var el = function (id) { return document.getElementById(id); };
            var dlKb = parseInt(el('tor-cfg-dl-limit') ? el('tor-cfg-dl-limit').value : '0', 10) || 0;
            var ulKb = parseInt(el('tor-cfg-ul-limit') ? el('tor-cfg-ul-limit').value : '0', 10) || 0;
            var payload = {
                download_dir: el('tor-cfg-download-dir') ? el('tor-cfg-download-dir').value.trim() : '/downloads/tor-hunt',
                temp_dir: el('tor-cfg-temp-dir') ? el('tor-cfg-temp-dir').value.trim() : '/downloads/tor-hunt/incomplete',
                listen_port: parseInt(el('tor-cfg-listen-port') ? el('tor-cfg-listen-port').value : '6881', 10) || 6881,
                max_connections: parseInt(el('tor-cfg-max-connections') ? el('tor-cfg-max-connections').value : '200', 10) || 200,
                encryption_mode: parseInt(el('tor-cfg-encryption') ? el('tor-cfg-encryption').value : '0', 10),
                download_rate_limit: dlKb * 1024,
                upload_rate_limit: ulKb * 1024,
                active_downloads: parseInt(el('tor-cfg-active-downloads') ? el('tor-cfg-active-downloads').value : '8', 10) || 8,
                active_seeds: parseInt(el('tor-cfg-active-seeds') ? el('tor-cfg-active-seeds').value : '10', 10) || 10,
                active_limit: parseInt(el('tor-cfg-active-limit') ? el('tor-cfg-active-limit').value : '20', 10) || 20,
                seed_ratio_limit: parseFloat(el('tor-cfg-seed-ratio') ? el('tor-cfg-seed-ratio').value : '0') || 0,
                seed_time_limit: parseInt(el('tor-cfg-seed-time') ? el('tor-cfg-seed-time').value : '0', 10) || 0,
                enable_dht: el('tor-cfg-dht') ? el('tor-cfg-dht').checked : true,
                enable_lsd: el('tor-cfg-lsd') ? el('tor-cfg-lsd').checked : true,
                enable_upnp: el('tor-cfg-upnp') ? el('tor-cfg-upnp').checked : true,
                enable_natpmp: el('tor-cfg-natpmp') ? el('tor-cfg-natpmp').checked : true
            };
            fetch('./api/tor-hunt/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.success) {
                    if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Settings saved', 'success');
                } else {
                    if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification(data.error || 'Save failed', 'error');
                }
            })
            .catch(function (e) {
                console.error('[TorHunt] Settings save error:', e);
                if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Save failed', 'error');
            });
        }
    };
})();
