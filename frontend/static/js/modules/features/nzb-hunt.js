/**
 * NZB Hunt - Standalone JavaScript module
 * Independent: does not share state with Movie Hunt, Requestarr, or any other module.
 * Manages NZB Home, Activity (coming soon), and Settings (Folders + Servers).
 */
(function () {
    'use strict';

    window.NzbHunt = {
        currentTab: 'queue',
        _servers: [],
        _categories: [],
        _editIndex: null, // null = add, number = edit
        _catEditIndex: null, // null = add, number = edit

        /* ──────────────────────────────────────────────
           Initialization
        ────────────────────────────────────────────── */
        init: function () {
            this.setupTabs();
            this.showTab('queue');
            console.log('[NzbHunt] Home initialized');
        },

        initSettings: function () {
            this._setupSettingsTabs();
            this._setupFolderBrowse();
            this._setupServerGrid();
            this._setupServerModal();
            this._setupBrowseModal();
            this._setupCategoryGrid();
            this._setupCategoryModal();
            this._loadFolders();
            this._loadServers();
            this._loadCategories();
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
        },

        /* ──────────────────────────────────────────────
           Settings sub-tabs (Folders / Servers)
        ────────────────────────────────────────────── */
        _setupSettingsTabs: function () {
            var self = this;
            document.querySelectorAll('#nzb-hunt-settings-section .nzb-settings-tab').forEach(function (tab) {
                tab.addEventListener('click', function () {
                    var t = tab.getAttribute('data-settings-tab');
                    if (t) self._showSettingsTab(t);
                });
            });
        },

        _showSettingsTab: function (tab) {
            document.querySelectorAll('#nzb-hunt-settings-section .nzb-settings-tab').forEach(function (t) {
                t.classList.toggle('active', t.getAttribute('data-settings-tab') === tab);
            });
            document.querySelectorAll('#nzb-hunt-settings-section .nzb-settings-panel').forEach(function (p) {
                p.style.display = p.getAttribute('data-settings-panel') === tab ? 'block' : 'none';
            });
        },

        /* ──────────────────────────────────────────────
           Folders  – load / save / browse
        ────────────────────────────────────────────── */
        _loadFolders: function () {
            fetch('./api/nzb-hunt/settings/folders?t=' + Date.now())
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    var df = document.getElementById('nzb-download-folder');
                    var tf = document.getElementById('nzb-temp-folder');
                    var wf = document.getElementById('nzb-watched-folder');
                    if (df && data.download_folder !== undefined) df.value = data.download_folder;
                    if (tf && data.temp_folder !== undefined) tf.value = data.temp_folder;
                    if (wf && data.watched_folder !== undefined) wf.value = data.watched_folder;
                })
                .catch(function () { /* use defaults */ });
        },

        _saveFolders: function () {
            var payload = {
                download_folder: (document.getElementById('nzb-download-folder') || {}).value || '/downloads',
                temp_folder: (document.getElementById('nzb-temp-folder') || {}).value || '/downloads/incomplete',
                watched_folder: (document.getElementById('nzb-watched-folder') || {}).value || ''
            };
            fetch('./api/nzb-hunt/settings/folders', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    if (data.success && window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification('Folders saved.', 'success');
                    }
                })
                .catch(function () {
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification('Failed to save folders.', 'error');
                    }
                });
        },

        _setupFolderBrowse: function () {
            var self = this;
            var saveBtn = document.getElementById('nzb-save-folders');
            if (saveBtn) saveBtn.addEventListener('click', function () { self._saveFolders(); });

            ['nzb-browse-download-folder', 'nzb-browse-temp-folder', 'nzb-browse-watched-folder'].forEach(function (id) {
                var btn = document.getElementById(id);
                if (btn) {
                    btn.addEventListener('click', function () {
                        var inputId = id.replace('nzb-browse-', 'nzb-').replace('-folder', '-folder');
                        // Map button id → input id
                        var map = {
                            'nzb-browse-download-folder': 'nzb-download-folder',
                            'nzb-browse-temp-folder': 'nzb-temp-folder',
                            'nzb-browse-watched-folder': 'nzb-watched-folder'
                        };
                        self._openBrowseModal(document.getElementById(map[id]));
                    });
                }
            });
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
        },

        _openBrowseModal: function (targetInput) {
            this._browseTarget = targetInput;
            var modal = document.getElementById('nzb-browse-modal');
            if (!modal) return;
            // Move to body if nested in a section
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

        _loadBrowsePath: function (path) {
            var list = document.getElementById('nzb-browse-list');
            var pathInput = document.getElementById('nzb-browse-path-input');
            var upBtn = document.getElementById('nzb-browse-up');
            if (!list) return;

            list.innerHTML = '<div style="padding: 20px; text-align: center; color: #94a3b8;"><i class="fas fa-spinner fa-spin"></i> Loading...</div>';

            fetch('./api/nzb-hunt/browse?path=' + encodeURIComponent(path) + '&t=' + Date.now())
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    if (pathInput) pathInput.value = data.path || path;
                    if (upBtn) upBtn.disabled = (data.path === '/');
                    var dirs = data.directories || [];
                    if (dirs.length === 0) {
                        list.innerHTML = '<div style="padding: 20px; text-align: center; color: #64748b;">No subdirectories</div>';
                        return;
                    }
                    list.innerHTML = '';
                    dirs.forEach(function (d) {
                        var item = document.createElement('div');
                        item.className = 'nzb-browse-item';
                        item.innerHTML = '<i class="fas fa-folder"></i> <span style="font-family: monospace; font-size: 0.9rem; word-break: break-all;">' + _esc(d.name) + '</span>';
                        item.addEventListener('click', function () {
                            if (pathInput) pathInput.value = d.path;
                            window.NzbHunt._loadBrowsePath(d.path);
                        });
                        list.appendChild(item);
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
                    self._openServerModal(null);
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
                        '<div class="nzb-server-status-line" id="' + statusTextId + '">' +
                            '<i class="fas fa-circle-notch fa-spin" style="font-size: 11px; color: #6366f1;"></i> <span style="font-size: 12px; color: #94a3b8;">Checking connection...</span>' +
                        '</div>' +
                        '<div class="nzb-server-bandwidth">' +
                            '<div class="nzb-server-bandwidth-label"><span>Bandwidth</span><span>' + _fmtBytes(srv.bandwidth_used || 0) + '</span></div>' +
                            '<div class="nzb-server-bandwidth-bar"><div class="nzb-server-bandwidth-fill" style="width: ' + Math.min(100, (srv.bandwidth_pct || 0)) + '%;"></div></div>' +
                        '</div>' +
                    '</div>' +
                    '<div class="nzb-server-card-footer">' +
                        '<button class="nzb-btn" data-action="edit" data-idx="' + idx + '"><i class="fas fa-pen"></i> Edit</button>' +
                        '<button class="nzb-btn nzb-btn-danger" data-action="delete" data-idx="' + idx + '"><i class="fas fa-trash"></i> Delete</button>' +
                    '</div>';

                card.addEventListener('click', function (e) {
                    var btn = e.target.closest('[data-action]');
                    if (!btn) return;
                    var action = btn.getAttribute('data-action');
                    var i = parseInt(btn.getAttribute('data-idx'), 10);
                    if (action === 'edit') {
                        self._editIndex = i;
                        self._openServerModal(self._servers[i]);
                    } else if (action === 'delete') {
                        var name = (self._servers[i] || {}).name || 'this server';
                        if (!confirm('Delete "' + name + '"?')) return;
                        fetch('./api/nzb-hunt/servers/' + i, { method: 'DELETE' })
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
                var payload = {
                    host: srv.host || '',
                    port: srv.port || 563,
                    ssl: srv.ssl !== false,
                    username: srv.username || '',
                    password: srv.password || ''
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
           Server Add/Edit Modal
        ────────────────────────────────────────────── */
        _setupServerModal: function () {
            var self = this;
            var backdrop = document.getElementById('nzb-server-modal-backdrop');
            var closeBtn = document.getElementById('nzb-server-modal-close');
            var cancelBtn = document.getElementById('nzb-server-modal-cancel');
            var saveBtn = document.getElementById('nzb-server-modal-save');
            var testBtn = document.getElementById('nzb-server-modal-test');

            if (backdrop) backdrop.addEventListener('click', function () { self._closeServerModal(); });
            if (closeBtn) closeBtn.addEventListener('click', function () { self._closeServerModal(); });
            if (cancelBtn) cancelBtn.addEventListener('click', function () { self._closeServerModal(); });
            if (saveBtn) saveBtn.addEventListener('click', function () { self._saveServer(); });
            if (testBtn) testBtn.addEventListener('click', function () { self._testServerConnection(); });

            // Toggle label updates
            var sslCb = document.getElementById('nzb-server-ssl');
            var enabledCb = document.getElementById('nzb-server-enabled');
            if (sslCb) sslCb.addEventListener('change', function () { self._updateToggleLabel('nzb-ssl-label', this.checked); });
            if (enabledCb) enabledCb.addEventListener('change', function () { self._updateToggleLabel('nzb-enabled-label', this.checked); });

            // ESC key
            document.addEventListener('keydown', function (e) {
                if (e.key === 'Escape') {
                    var bm = document.getElementById('nzb-browse-modal');
                    var cm = document.getElementById('nzb-cat-modal');
                    var sm = document.getElementById('nzb-server-modal');
                    if (bm && bm.style.display === 'flex') { self._closeBrowseModal(); return; }
                    if (cm && cm.style.display === 'flex') { self._closeCategoryModal(); return; }
                    if (sm && sm.style.display === 'flex') self._closeServerModal();
                }
            });
        },

        _openServerModal: function (server) {
            var modal = document.getElementById('nzb-server-modal');
            if (!modal) return;
            if (modal.parentElement !== document.body) document.body.appendChild(modal);

            var title = document.getElementById('nzb-server-modal-title');
            if (title) title.textContent = server ? 'Edit Usenet Server' : 'Add Usenet Server';

            // Fill fields
            var f = function (id, val) { var el = document.getElementById(id); if (el) { if (el.type === 'checkbox') el.checked = val; else el.value = val; } };
            f('nzb-server-name', server ? server.name : '');
            f('nzb-server-host', server ? server.host : '');
            f('nzb-server-port', server ? (server.port || 563) : 563);
            f('nzb-server-ssl', server ? (server.ssl !== false) : true);
            f('nzb-server-username', server ? (server.username || '') : '');
            f('nzb-server-password', ''); // Don't prefill passwords
            f('nzb-server-connections', server ? (server.connections || 8) : 8);
            f('nzb-server-priority', server ? (server.priority !== undefined ? server.priority : 0) : 0);
            f('nzb-server-enabled', server ? (server.enabled !== false) : true);

            // Reset test status area
            this._resetTestStatus();

            // Update toggle labels to match checkbox state
            var sslCb = document.getElementById('nzb-server-ssl');
            var enabledCb = document.getElementById('nzb-server-enabled');
            this._updateToggleLabel('nzb-ssl-label', sslCb ? sslCb.checked : true);
            this._updateToggleLabel('nzb-enabled-label', enabledCb ? enabledCb.checked : true);

            modal.style.display = 'flex';
        },

        _updateToggleLabel: function (labelId, isOn) {
            var lbl = document.getElementById(labelId);
            if (!lbl) return;
            lbl.textContent = isOn ? 'ON' : 'OFF';
            lbl.className = 'nzb-toggle-label ' + (isOn ? 'label-on' : 'label-off');
        },

        _closeServerModal: function () {
            var modal = document.getElementById('nzb-server-modal');
            if (modal) modal.style.display = 'none';
        },

        _saveServer: function () {
            var g = function (id) { var el = document.getElementById(id); if (!el) return ''; return el.type === 'checkbox' ? el.checked : el.value; };
            var payload = {
                name: g('nzb-server-name') || 'Server',
                host: g('nzb-server-host'),
                port: parseInt(g('nzb-server-port'), 10) || 563,
                ssl: !!g('nzb-server-ssl'),
                username: g('nzb-server-username'),
                password: g('nzb-server-password'),
                connections: parseInt(g('nzb-server-connections'), 10) || 8,
                priority: parseInt(g('nzb-server-priority'), 10) || 0,
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
                        // Auto-test the connection after saving
                        self._testServerConnection(function (testSuccess, testMsg) {
                            if (testSuccess) {
                                self._showTestStatus('success', 'Saved & connected successfully!');
                            } else {
                                self._showTestStatus('fail', 'Saved, but connection failed: ' + testMsg);
                            }
                            self._loadServers();
                            // Auto-close modal after a brief delay on success
                            if (testSuccess) {
                                setTimeout(function () {
                                    self._closeServerModal();
                                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                                        window.huntarrUI.showNotification('Server saved & connected!', 'success');
                                    }
                                }, 1500);
                            } else {
                                // Don't auto-close on failure so user can see the message
                                if (window.huntarrUI && window.huntarrUI.showNotification) {
                                    window.huntarrUI.showNotification('Server saved but connection failed.', 'warning');
                                }
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
        },

        _showTestStatus: function (state, message) {
            var el = document.getElementById('nzb-server-test-status');
            var icon = document.getElementById('nzb-server-test-icon');
            var msg = document.getElementById('nzb-server-test-msg');
            if (!el) return;

            el.style.display = 'block';
            el.className = 'nzb-server-test-status test-' + state;

            if (icon) {
                if (state === 'testing') {
                    icon.className = 'fas fa-circle-notch fa-spin';
                } else if (state === 'success') {
                    icon.className = 'fas fa-check-circle';
                } else {
                    icon.className = 'fas fa-times-circle';
                }
            }

            if (msg) msg.textContent = message;
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
                            self._showTestStatus('success', data.message || 'Connection successful!');
                        } else {
                            self._showTestStatus('fail', data.message || 'Connection failed.');
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
        _getBaseFolder: function () {
            var el = document.getElementById('nzb-cat-base-folder');
            return (el && el.value) ? el.value : '/downloads/complete';
        },

        _setupCategoryGrid: function () {
            var self = this;
            var addCard = document.getElementById('nzb-add-cat-card');
            if (addCard) {
                addCard.addEventListener('click', function () {
                    self._catEditIndex = null;
                    self._openCategoryModal(null);
                });
            }

            // Base folder browse
            var browseBase = document.getElementById('nzb-browse-cat-base-folder');
            if (browseBase) {
                browseBase.addEventListener('click', function () {
                    self._openBrowseModal(document.getElementById('nzb-cat-base-folder'));
                });
            }

            // Save base folder
            var saveBase = document.getElementById('nzb-save-cat-base');
            if (saveBase) {
                saveBase.addEventListener('click', function () { self._saveBaseFolder(); });
            }

            // Auto-update the default path display when base folder changes
            var baseInput = document.getElementById('nzb-cat-base-folder');
            if (baseInput) {
                baseInput.addEventListener('input', function () {
                    var display = document.getElementById('nzb-cat-default-path-display');
                    if (display) display.textContent = baseInput.value || '/downloads/complete';
                });
            }

            // Auto-generate folder path when category name changes
            var catName = document.getElementById('nzb-cat-name');
            if (catName) {
                catName.addEventListener('input', function () {
                    if (self._catEditIndex !== null) return; // Don't auto-fill when editing
                    var folder = document.getElementById('nzb-cat-folder');
                    var name = (catName.value || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
                    if (folder && name) {
                        folder.value = self._getBaseFolder().replace(/\/+$/, '') + '/' + name;
                    } else if (folder) {
                        folder.value = '';
                    }
                });
            }
        },

        _saveBaseFolder: function () {
            var base = this._getBaseFolder();
            fetch('./api/nzb-hunt/settings/categories-base', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ base_folder: base })
            })
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    if (data.success && window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification('Base folder saved.', 'success');
                    }
                })
                .catch(function () {
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification('Failed to save base folder.', 'error');
                    }
                });
        },

        _loadCategories: function () {
            var self = this;
            fetch('./api/nzb-hunt/categories?t=' + Date.now())
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    self._categories = data.categories || [];
                    // Update base folder input
                    var baseEl = document.getElementById('nzb-cat-base-folder');
                    if (baseEl && data.base_folder) baseEl.value = data.base_folder;
                    // Update default path display
                    var display = document.getElementById('nzb-cat-default-path-display');
                    if (display) display.textContent = data.base_folder || '/downloads/complete';
                    self._renderCategoryCards();
                })
                .catch(function () { self._categories = []; self._renderCategoryCards(); });
        },

        _renderCategoryCards: function () {
            var grid = document.getElementById('nzb-cat-grid');
            if (!grid) return;

            var addCard = document.getElementById('nzb-add-cat-card');
            grid.innerHTML = '';

            var self = this;
            this._categories.forEach(function (cat, idx) {
                var card = document.createElement('div');
                card.className = 'nzb-cat-card';

                var indexerTags = '';
                if (cat.indexer_groups) {
                    var groups = cat.indexer_groups.split(',').map(function (g) { return g.trim(); }).filter(Boolean);
                    if (groups.length > 0) {
                        indexerTags = '<div class="nzb-cat-card-indexer"><i class="fas fa-search"></i><div class="nzb-cat-card-indexer-tags">' +
                            groups.map(function (g) { return '<span class="nzb-cat-indexer-tag">' + _esc(g) + '</span>'; }).join('') +
                            '</div></div>';
                    }
                }

                card.innerHTML =
                    '<div class="nzb-cat-card-header">' +
                        '<div class="nzb-cat-card-name"><i class="fas fa-tag"></i> <span>' + _esc(cat.name || 'Category') + '</span></div>' +
                        '<div class="nzb-cat-card-badges">' +
                            '<span class="nzb-badge nzb-badge-priority-cat">' + _esc(_capFirst(cat.priority || 'normal')) + '</span>' +
                            '<span class="nzb-badge nzb-badge-processing">' + _esc(cat.processing || 'Default') + '</span>' +
                        '</div>' +
                    '</div>' +
                    '<div class="nzb-cat-card-body">' +
                        '<div class="nzb-cat-card-path"><i class="fas fa-folder"></i> <span>' + _esc(cat.folder || '') + '</span></div>' +
                        indexerTags +
                    '</div>' +
                    '<div class="nzb-cat-card-footer">' +
                        '<button class="nzb-btn" data-action="edit-cat" data-idx="' + idx + '"><i class="fas fa-pen"></i> Edit</button>' +
                        '<button class="nzb-btn nzb-btn-danger" data-action="delete-cat" data-idx="' + idx + '"><i class="fas fa-trash"></i> Delete</button>' +
                    '</div>';

                card.addEventListener('click', function (e) {
                    var btn = e.target.closest('[data-action]');
                    if (!btn) return;
                    var action = btn.getAttribute('data-action');
                    var i = parseInt(btn.getAttribute('data-idx'), 10);
                    if (action === 'edit-cat') {
                        self._catEditIndex = i;
                        self._openCategoryModal(self._categories[i]);
                    } else if (action === 'delete-cat') {
                        var name = (self._categories[i] || {}).name || 'this category';
                        if (!confirm('Delete "' + name + '"?')) return;
                        fetch('./api/nzb-hunt/categories/' + i, { method: 'DELETE' })
                            .then(function (r) { return r.json(); })
                            .then(function (data) {
                                if (data.success) self._loadCategories();
                                if (window.huntarrUI && window.huntarrUI.showNotification) {
                                    window.huntarrUI.showNotification('Category deleted.', 'success');
                                }
                            })
                            .catch(function () {
                                if (window.huntarrUI && window.huntarrUI.showNotification) {
                                    window.huntarrUI.showNotification('Delete failed.', 'error');
                                }
                            });
                    }
                });

                grid.appendChild(card);
            });

            if (addCard) grid.appendChild(addCard);
        },

        /* ──────────────────────────────────────────────
           Category Add/Edit Modal
        ────────────────────────────────────────────── */
        _setupCategoryModal: function () {
            var self = this;
            var backdrop = document.getElementById('nzb-cat-modal-backdrop');
            var closeBtn = document.getElementById('nzb-cat-modal-close');
            var cancelBtn = document.getElementById('nzb-cat-modal-cancel');
            var saveBtn = document.getElementById('nzb-cat-modal-save');
            var browseBtn = document.getElementById('nzb-cat-browse-folder');

            if (backdrop) backdrop.addEventListener('click', function () { self._closeCategoryModal(); });
            if (closeBtn) closeBtn.addEventListener('click', function () { self._closeCategoryModal(); });
            if (cancelBtn) cancelBtn.addEventListener('click', function () { self._closeCategoryModal(); });
            if (saveBtn) saveBtn.addEventListener('click', function () { self._saveCategory(); });
            if (browseBtn) browseBtn.addEventListener('click', function () {
                var folderInput = document.getElementById('nzb-cat-folder');
                if (folderInput) folderInput.removeAttribute('readonly');
                self._openBrowseModal(folderInput);
            });
        },

        _openCategoryModal: function (cat) {
            var modal = document.getElementById('nzb-cat-modal');
            if (!modal) return;
            if (modal.parentElement !== document.body) document.body.appendChild(modal);

            var title = document.getElementById('nzb-cat-modal-title');
            if (title) title.textContent = cat ? 'Edit Category' : 'Add Category';

            var f = function (id, val) { var el = document.getElementById(id); if (el) el.value = val; };
            f('nzb-cat-name', cat ? cat.name : '');
            f('nzb-cat-folder', cat ? cat.folder : '');
            f('nzb-cat-priority', cat ? (cat.priority || 'normal') : 'normal');
            f('nzb-cat-processing', cat ? (cat.processing || 'default') : 'default');
            f('nzb-cat-indexer', cat ? (cat.indexer_groups || '') : '');

            // Set readonly on folder for new categories (auto-generated from name)
            var folderInput = document.getElementById('nzb-cat-folder');
            if (folderInput) {
                if (cat) {
                    folderInput.removeAttribute('readonly');
                } else {
                    folderInput.setAttribute('readonly', 'readonly');
                }
            }

            modal.style.display = 'flex';
        },

        _closeCategoryModal: function () {
            var modal = document.getElementById('nzb-cat-modal');
            if (modal) modal.style.display = 'none';
        },

        _saveCategory: function () {
            var g = function (id) { var el = document.getElementById(id); return el ? el.value : ''; };
            var name = g('nzb-cat-name').trim();
            if (!name) {
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('Category name is required.', 'error');
                }
                return;
            }
            var folder = g('nzb-cat-folder').trim();
            if (!folder) {
                folder = this._getBaseFolder().replace(/\/+$/, '') + '/' + name.toLowerCase().replace(/[^a-z0-9_-]/g, '');
            }
            var payload = {
                name: name,
                folder: folder,
                priority: g('nzb-cat-priority') || 'normal',
                processing: g('nzb-cat-processing') || 'default',
                indexer_groups: g('nzb-cat-indexer') || ''
            };

            var self = this;
            var url, method;
            if (this._catEditIndex !== null) {
                url = './api/nzb-hunt/categories/' + this._catEditIndex;
                method = 'PUT';
            } else {
                url = './api/nzb-hunt/categories';
                method = 'POST';
            }

            fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    if (data.success) {
                        self._closeCategoryModal();
                        self._loadCategories();
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification('Category saved.', 'success');
                        }
                    }
                })
                .catch(function () {
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification('Failed to save category.', 'error');
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
