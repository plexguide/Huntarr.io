/**
 * Indexer Hunt — Centralized indexer management module.
 * Full-page editor (no modal), card grid list.
 */
(function() {
    'use strict';

    var _indexers = [];
    var _presets = [];
    var _editingId = null;
    var _initialized = false;

    var IH = window.IndexerHunt = {};

    // ── Initialization ────────────────────────────────────────────────

    IH.init = function() {
        var searchInput = document.getElementById('ih-search-input');
        if (searchInput) searchInput.value = '';
        if (!_initialized) {
            _bindEvents();
            _initialized = true;
        }
        var noInstEl = document.getElementById('indexer-hunt-no-instances');
        var wrapperEl = document.getElementById('indexer-hunt-content-wrapper');
        Promise.all([
            fetch('./api/movie-hunt/instances', { cache: 'no-store' }).then(function(r) { return r.json(); }),
            fetch('./api/tv-hunt/instances', { cache: 'no-store' }).then(function(r) { return r.json(); })
        ]).then(function(results) {
            var movieCount = (results[0].instances || []).length;
            var tvCount = (results[1].instances || []).length;
            if (movieCount === 0 && tvCount === 0) {
                if (noInstEl) noInstEl.style.display = '';
                if (wrapperEl) wrapperEl.style.display = 'none';
                return;
            }
            if (noInstEl) noInstEl.style.display = 'none';
            if (wrapperEl) wrapperEl.style.display = '';
            _showListView();
            _loadPresets(function() {
                _loadIndexers();
            });
        }).catch(function() {
            if (noInstEl) noInstEl.style.display = 'none';
            if (wrapperEl) wrapperEl.style.display = '';
            _showListView();
            _loadPresets(function() {
                _loadIndexers();
            });
        });
    };

    function _bindEvents() {
        _on('ih-add-btn', 'click', function() { _openEditor(null); });
        _on('ih-empty-add-btn', 'click', function() { _openEditor(null); });
        _on('ih-editor-back', 'click', function() { _showListView(); });
        _on('ih-editor-save', 'click', _saveForm);
        _on('ih-search-input', 'input', function() { _renderCards(); });
        _on('ih-form-preset', 'change', _onPresetChange);

        // "Import from Index Master" card: show select list (ih-import-panel)
        var wrapper = document.getElementById('indexer-hunt-content-wrapper');
        if (wrapper) {
            wrapper.addEventListener('click', function(e) {
                var card = e.target.closest('.add-instance-card[data-source="indexer-hunt"]');
                if (card) {
                    e.preventDefault();
                    e.stopPropagation();
                    _openIHImportPanel();
                }
            });
            // Edit/Delete on instance indexer cards (capture so we handle before other listeners)
            wrapper.addEventListener('click', _onInstanceIndexerCardClick, true);
        }
        var cancelBtn = document.getElementById('ih-import-cancel');
        if (cancelBtn) cancelBtn.addEventListener('click', _closeIHImportPanel);
        var confirmBtn = document.getElementById('ih-import-confirm');
        if (confirmBtn) confirmBtn.addEventListener('click', _confirmIHImport);
    }

    function _getInstanceIdAndMode() {
        var sel = document.getElementById('settings-indexers-instance-select');
        var val = (sel && sel.value) ? sel.value.trim() : '';
        if (!val) return { instanceId: 1, mode: 'movie' };
        var parts = val.split(':');
        if (parts.length === 2) {
            var mode = parts[0] === 'tv' ? 'tv' : 'movie';
            var id = parseInt(parts[1], 10);
            return { instanceId: isNaN(id) ? 1 : id, mode: mode };
        }
        return { instanceId: 1, mode: 'movie' };
    }

    function _openIHImportPanel() {
        var panel = document.getElementById('ih-import-panel');
        var list = document.getElementById('ih-import-list');
        var actions = document.getElementById('ih-import-actions');
        if (panel) panel.style.display = 'block';
        if (list) list.innerHTML = '<div style="color: #94a3b8; padding: 20px; text-align: center;"><i class="fas fa-spinner fa-spin"></i> Loading available indexers...</div>';
        if (actions) actions.style.display = 'none';

        var par = _getInstanceIdAndMode();
        var url = './api/indexer-hunt/available/' + par.instanceId + '?mode=' + encodeURIComponent(par.mode);

        fetch(url)
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var available = data.available || [];
                if (available.length === 0) {
                    if (list) list.innerHTML = '<div class="ih-import-empty"><i class="fas fa-check-circle" style="color: #10b981; margin-right: 6px;"></i>All Index Master indexers are already imported to this instance.</div>';
                    return;
                }
                var html = '';
                available.forEach(function(idx) {
                    var keyDisplay = idx.api_key_last4 ? '\u2022\u2022\u2022\u2022' + _esc(idx.api_key_last4) : 'No key';
                    html += '<div class="ih-import-item" data-ih-id="' + idx.id + '">'
                        + '<div class="ih-import-checkbox"><i class="fas fa-check"></i></div>'
                        + '<div class="ih-import-info">'
                            + '<div class="ih-import-name">' + _esc(idx.name) + '</div>'
                            + '<div class="ih-import-meta">'
                                + '<span><i class="fas fa-globe"></i> ' + _esc(idx.url || 'N/A') + '</span>'
                                + '<span><i class="fas fa-sort-amount-up"></i> Priority: ' + (idx.priority || 50) + '</span>'
                                + '<span><i class="fas fa-key"></i> ' + keyDisplay + '</span>'
                            + '</div>'
                        + '</div>'
                    + '</div>';
                });
                if (list) list.innerHTML = html;
                if (actions) actions.style.display = 'flex';

                var items = list.querySelectorAll('.ih-import-item');
                items.forEach(function(item) {
                    item.addEventListener('click', function() {
                        item.classList.toggle('selected');
                        _updateIHImportButton();
                    });
                });
            })
            .catch(function(err) {
                if (list) list.innerHTML = '<div class="ih-import-empty">Failed to load available indexers.</div>';
            });
    }

    function _closeIHImportPanel() {
        var panel = document.getElementById('ih-import-panel');
        if (panel) panel.style.display = 'none';
    }

    function _onInstanceIndexerCardClick(e) {
        var grid = e.target.closest('#indexer-instances-grid-unified');
        if (!grid || !grid.closest('#indexer-hunt-section')) return;
        var editBtn = e.target.closest('.btn-card.edit[data-app-type="indexer"]');
        var deleteBtn = e.target.closest('.btn-card.delete[data-app-type="indexer"]');
        if (editBtn) {
            e.preventDefault();
            e.stopPropagation();
            var card = editBtn.closest('.instance-card');
            if (!card) return;
            var index = parseInt(card.getAttribute('data-instance-index'), 10);
            if (isNaN(index)) return;
            var list = window.SettingsForms && window.SettingsForms._indexersList;
            if (!list || index < 0 || index >= list.length) return;
            if (window.SettingsForms && window.SettingsForms.openIndexerEditor) {
                window.SettingsForms.openIndexerEditor(false, index, list[index]);
            }
            return;
        }
        if (deleteBtn) {
            e.preventDefault();
            e.stopPropagation();
            var card = deleteBtn.closest('.instance-card');
            if (!card) return;
            var index = parseInt(card.getAttribute('data-instance-index'), 10);
            if (isNaN(index)) return;
            var list = window.SettingsForms && window.SettingsForms._indexersList;
            if (!list || index < 0 || index >= list.length) return;
            var indexer = list[index];
            var name = (indexer && indexer.name) ? indexer.name : 'Unnamed';
            var Forms = window.SettingsForms;
            var isTV = Forms._indexersMode === 'tv';
            var deleteId = isTV && indexer && indexer.id ? indexer.id : index;
            if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
                window.HuntarrConfirm.show({
                    title: 'Delete Indexer',
                    message: 'Are you sure you want to remove "' + name + '" from this instance? It will no longer be used for searches and will be removed from Index Master tracking for this instance.',
                    confirmLabel: 'Delete',
                    onConfirm: function() {
                        var apiBase = Forms.getIndexersApiBase();
                        var url = apiBase + '/' + encodeURIComponent(String(deleteId));
                        fetch(url, { method: 'DELETE' })
                            .then(function(r) { return r.json(); })
                            .then(function(data) {
                                if (data.success !== false) {
                                    if (window.SettingsForms && window.SettingsForms.refreshIndexersList) {
                                        window.SettingsForms.refreshIndexersList();
                                    }
                                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                                        window.huntarrUI.showNotification('Indexer removed.', 'success');
                                    }
                                } else {
                                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                                        window.huntarrUI.showNotification(data.error || 'Failed to remove indexer.', 'error');
                                    }
                                }
                            })
                            .catch(function() {
                                if (window.huntarrUI && window.huntarrUI.showNotification) {
                                    window.huntarrUI.showNotification('Failed to remove indexer.', 'error');
                                }
                            });
                    }
                });
            }
        }
    }

    function _updateIHImportButton() {
        var selected = document.querySelectorAll('#ih-import-list .ih-import-item.selected');
        var btn = document.getElementById('ih-import-confirm');
        if (btn) {
            btn.disabled = selected.length === 0;
            btn.innerHTML = '<i class="fas fa-download"></i> Import Selected (' + selected.length + ')';
        }
    }

    function _confirmIHImport() {
        var selected = document.querySelectorAll('#ih-import-list .ih-import-item.selected');
        if (selected.length === 0) return;

        var ids = [];
        selected.forEach(function(item) {
            ids.push(item.getAttribute('data-ih-id'));
        });
        var par = _getInstanceIdAndMode();

        var btn = document.getElementById('ih-import-confirm');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Importing...'; }

        fetch('./api/indexer-hunt/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ instance_id: par.instanceId, mode: par.mode, indexer_ids: ids }),
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.success) {
                var msg = 'Imported ' + (data.added || 0) + ' indexer(s) from Index Master.';
                if (window.huntarrUI) window.huntarrUI.showNotification(msg, 'success');
                _closeIHImportPanel();
                if (window.SettingsForms && window.SettingsForms.refreshIndexersList) {
                    window.SettingsForms.refreshIndexersList();
                }
            } else {
                if (window.huntarrUI) window.huntarrUI.showNotification(data.error || 'Import failed.', 'error');
            }
        })
        .catch(function(err) {
            if (window.huntarrUI) window.huntarrUI.showNotification('Import error.', 'error');
        })
        .finally(function() {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-download"></i> Import Selected'; }
        });
    }

    function _on(id, event, fn) {
        var el = document.getElementById(id);
        if (el) el.addEventListener(event, fn);
    }

    // ── View switching ─────────────────────────────────────────────────

    function _showListView() {
        var list = document.getElementById('ih-list-view');
        var editor = document.getElementById('ih-editor-view');
        if (list) list.style.display = '';
        if (editor) editor.style.display = 'none';
        _editingId = null;
    }

    function _showEditorView() {
        var list = document.getElementById('ih-list-view');
        var editor = document.getElementById('ih-editor-view');
        if (list) list.style.display = 'none';
        if (editor) editor.style.display = '';
        // Anchor editor into view so user doesn't have to scroll down
        if (editor) {
            editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }

    // ── Data loading ──────────────────────────────────────────────────

    function _loadPresets(cb) {
        fetch('./api/indexer-hunt/presets')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                _presets = data.presets || [];
                _populatePresetDropdown();
                if (cb) cb();
            })
            .catch(function() { if (cb) cb(); });
    }

    function _loadIndexers() {
        fetch('./api/indexer-hunt/indexers')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                _indexers = data.indexers || [];
                _renderCards();
            })
            .catch(function(err) {
                console.error('[IndexerHunt] Load error:', err);
            });
    }

    function _populatePresetDropdown() {
        var sel = document.getElementById('ih-form-preset');
        if (!sel) return;
        sel.innerHTML = '<option value="manual">Custom (Manual)</option>';
        _presets.forEach(function(p) {
            var opt = document.createElement('option');
            opt.value = p.key;
            opt.textContent = p.name;
            sel.appendChild(opt);
        });
    }

    // ── Card rendering ─────────────────────────────────────────────────

    function _renderCards() {
        var grid = document.getElementById('ih-card-grid');
        var empty = document.getElementById('ih-empty-state');
        if (!grid) return;

        var query = (document.getElementById('ih-search-input') || {}).value || '';
        query = query.toLowerCase().trim();

        var filtered = _indexers;
        if (query) {
            filtered = _indexers.filter(function(idx) {
                return (idx.name || '').toLowerCase().indexOf(query) !== -1 ||
                       (idx.url || '').toLowerCase().indexOf(query) !== -1 ||
                       (idx.preset || '').toLowerCase().indexOf(query) !== -1;
            });
        }

        if (filtered.length === 0 && _indexers.length === 0) {
            grid.style.display = 'none';
            if (empty) empty.style.display = '';
            var instanceArea = document.getElementById('ih-instance-area');
            if (instanceArea) instanceArea.style.display = 'none';
            var groupBox = document.getElementById('ih-group-box');
            if (groupBox) groupBox.style.display = 'none';
            return;
        }

        grid.style.display = '';
        if (empty) empty.style.display = 'none';
        var instanceArea = document.getElementById('ih-instance-area');
        if (instanceArea) instanceArea.style.display = '';
        var groupBox = document.getElementById('ih-group-box');
        if (groupBox) groupBox.style.display = '';

        var html = '';
        filtered.forEach(function(idx) {
            var enabled = idx.enabled !== false;
            var statusClass = enabled ? 'enabled' : 'disabled';
            var statusText = enabled ? 'Enabled' : 'Disabled';
            var statusIcon = enabled ? 'fa-check-circle' : 'fa-minus-circle';
            var presetLabel = _getPresetLabel(idx.preset);
            var url = idx.url || '\u2014';
            var keyDisplay = idx.api_key_last4 ? '\u2022\u2022\u2022\u2022' + _esc(idx.api_key_last4) : 'No key';
            html += '<div class="ih-card' + (enabled ? '' : ' ih-card-disabled') + '" data-id="' + _esc(idx.id) + '">'
                + '<div class="ih-card-header">'
                    + '<div class="ih-card-name"><span>' + _esc(idx.name || '') + '</span></div>'
                    + '<span class="ih-card-status ' + statusClass + '"><i class="fas ' + statusIcon + '"></i> ' + statusText + '</span>'
                + '</div>'
                + '<div class="ih-card-body">'
                    + '<div class="ih-card-detail ih-card-connection-row"><span class="ih-card-connection-status" data-connection="pending"><i class="fas fa-spinner fa-spin"></i> Checking...</span></div>'
                    + '<div class="ih-card-detail"><i class="fas fa-globe"></i><span class="ih-detail-value">' + _esc(url) + '</span></div>'
                    + '<div class="ih-card-detail"><i class="fas fa-key"></i><span class="ih-detail-value">' + keyDisplay + '</span></div>'
                    + '<div class="ih-card-detail" style="gap: 8px;">'
                        + '<span class="ih-card-priority-badge"><i class="fas fa-sort-amount-up" style="font-size:0.7rem;"></i> ' + (idx.priority || 50) + '</span>'
                        + '<span class="ih-card-preset-badge">' + _esc(presetLabel) + '</span>'
                    + '</div>'
                + '</div>'
                + '<div class="ih-card-footer">'
                    + '<button class="ih-card-btn test" onclick="IndexerHunt.testIndexer(\'' + _esc(idx.id) + '\')" title="Test"><i class="fas fa-plug"></i> Test</button>'
                    + '<button class="ih-card-btn edit" onclick="IndexerHunt.editIndexer(\'' + _esc(idx.id) + '\')" title="Edit"><i class="fas fa-edit"></i> Edit</button>'
                    + '<button class="ih-card-btn delete" onclick="IndexerHunt.deleteIndexer(\'' + _esc(idx.id) + '\', \'' + _esc(idx.name) + '\')" title="Delete"><i class="fas fa-trash"></i></button>'
                + '</div>'
            + '</div>';
        });

        // Add card at the end
        html += '<div class="ih-add-card" id="ih-add-card-inline">'
            + '<div class="ih-add-icon"><i class="fas fa-plus-circle"></i></div>'
            + '<div class="ih-add-text">Add Indexer</div>'
        + '</div>';

        grid.innerHTML = html;

        var addCard = document.getElementById('ih-add-card-inline');
        if (addCard) addCard.addEventListener('click', function() { _openEditor(null); });

        // Test each indexer connection and update card status (like app settings)
        _testIndexerCardsConnectionStatus(filtered);
    }

    function _testIndexerCardsConnectionStatus(indexerList) {
        if (!indexerList || indexerList.length === 0) return;
        indexerList.forEach(function(idx) {
            var card = document.querySelector('.ih-card[data-id="' + idx.id + '"]');
            var statusEl = card ? card.querySelector('.ih-card-connection-status') : null;
            if (!statusEl) return;
            fetch('./api/indexer-hunt/indexers/' + idx.id + '/test', { method: 'POST' })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (!statusEl.parentNode) return;
                    if (data.valid) {
                        statusEl.setAttribute('data-connection', 'connected');
                        statusEl.innerHTML = '<i class="fas fa-check-circle"></i> Connected';
                        statusEl.classList.add('ih-card-connection-ok');
                        statusEl.classList.remove('ih-card-connection-fail', 'ih-card-connection-pending');
                    } else {
                        statusEl.setAttribute('data-connection', 'error');
                        statusEl.innerHTML = '<i class="fas fa-times-circle"></i> Failed';
                        statusEl.classList.add('ih-card-connection-fail');
                        statusEl.classList.remove('ih-card-connection-ok', 'ih-card-connection-pending');
                    }
                })
                .catch(function() {
                    if (statusEl.parentNode) {
                        statusEl.setAttribute('data-connection', 'error');
                        statusEl.innerHTML = '<i class="fas fa-times-circle"></i> Failed';
                        statusEl.classList.add('ih-card-connection-fail');
                        statusEl.classList.remove('ih-card-connection-ok', 'ih-card-connection-pending');
                    }
                });
        });
    }

    function _getPresetLabel(preset) {
        if (!preset || preset === 'manual') return 'Custom';
        for (var i = 0; i < _presets.length; i++) {
            if (_presets[i].key === preset) return _presets[i].name;
        }
        return preset;
    }

    // ── Editor (full page) ─────────────────────────────────────────────

    function _openEditor(existingIdx) {
        _editingId = existingIdx ? existingIdx.id : null;

        var breadcrumb = document.getElementById('ih-editor-breadcrumb-name');
        if (breadcrumb) breadcrumb.textContent = _editingId ? 'Edit Indexer' : 'Add Indexer';

        var presetSel = document.getElementById('ih-form-preset');
        var nameEl = document.getElementById('ih-form-name');
        var urlEl = document.getElementById('ih-form-url');
        var apiPathEl = document.getElementById('ih-form-api-path');
        var apiKeyEl = document.getElementById('ih-form-api-key');
        var priorityEl = document.getElementById('ih-form-priority');
        var protocolEl = document.getElementById('ih-form-protocol');

        if (existingIdx) {
            if (presetSel) { presetSel.value = existingIdx.preset || 'manual'; presetSel.disabled = true; }
            if (nameEl) nameEl.value = existingIdx.name || '';
            if (urlEl) { urlEl.value = existingIdx.url || ''; urlEl.readOnly = existingIdx.preset !== 'manual'; }
            if (apiPathEl) { apiPathEl.value = existingIdx.api_path || '/api'; apiPathEl.readOnly = existingIdx.preset !== 'manual'; }
            if (apiKeyEl) apiKeyEl.value = '';
            if (apiKeyEl) apiKeyEl.placeholder = existingIdx.api_key_last4 ? 'Leave blank to keep (\u2022\u2022\u2022\u2022' + existingIdx.api_key_last4 + ')' : 'Enter API key';
            if (priorityEl) priorityEl.value = existingIdx.priority || 50;
            if (protocolEl) protocolEl.value = existingIdx.protocol || 'usenet';
        } else {
            if (presetSel) { presetSel.value = 'manual'; presetSel.disabled = false; }
            if (nameEl) nameEl.value = '';
            if (urlEl) { urlEl.value = ''; urlEl.readOnly = false; }
            if (apiPathEl) { apiPathEl.value = '/api'; apiPathEl.readOnly = false; }
            if (apiKeyEl) { apiKeyEl.value = ''; apiKeyEl.placeholder = 'Enter API key'; }
            if (priorityEl) priorityEl.value = 50;
            if (protocolEl) protocolEl.value = 'usenet';
        }

        _showEditorView();

        // Auto-test connection when URL or API key changes (like Sonarr/app settings)
        var statusContainer = document.getElementById('ih-connection-status-container');
        if (statusContainer) statusContainer.style.display = 'flex';
        if (!window._ihConnectionListenersBound) {
            window._ihConnectionListenersBound = true;
            var urlEl2 = document.getElementById('ih-form-url');
            var apiPathEl2 = document.getElementById('ih-form-api-path');
            var apiKeyEl2 = document.getElementById('ih-form-api-key');
            var debounceTimer;
            var runStatus = function() {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(function() { _updateConnectionStatusFromForm(); }, 500);
            };
            if (urlEl2) { urlEl2.addEventListener('input', runStatus); urlEl2.addEventListener('blur', runStatus); }
            if (apiPathEl2) { apiPathEl2.addEventListener('input', runStatus); apiPathEl2.addEventListener('blur', runStatus); }
            if (apiKeyEl2) { apiKeyEl2.addEventListener('input', runStatus); apiKeyEl2.addEventListener('blur', runStatus); }
        }
        setTimeout(function() { _updateConnectionStatusFromForm(); }, 100);
    }

    function _updateConnectionStatusFromForm() {
        var container = document.getElementById('ih-connection-status-container');
        if (!container) return;
        var urlEl = document.getElementById('ih-form-url');
        var apiPathEl = document.getElementById('ih-form-api-path');
        var apiKeyEl = document.getElementById('ih-form-api-key');
        var url = urlEl ? urlEl.value.trim() : '';
        var apiPath = apiPathEl ? (apiPathEl.value.trim() || '/api') : '/api';
        var apiKey = apiKeyEl ? apiKeyEl.value.trim() : '';
        var hasSavedKey = _editingId && _indexers.length;
        if (hasSavedKey) {
            var existing = null;
            _indexers.forEach(function(i) { if (i.id === _editingId) existing = i; });
            hasSavedKey = !!(existing && existing.api_key_last4);
        }
        if (url.length <= 10 && apiKey.length < 10) {
            container.innerHTML = '<div class="connection-status" style="background: rgba(148,163,184,0.1); color: #94a3b8; border: 1px solid rgba(148,163,184,0.2);"><i class="fas fa-info-circle"></i><span>Enter URL and API Key</span></div>';
            return;
        }
        if (url.length <= 10) {
            container.innerHTML = '<div class="connection-status" style="background: rgba(251,191,36,0.1); color: #fbbf24; border: 1px solid rgba(251,191,36,0.2);"><i class="fas fa-exclamation-triangle"></i><span>Missing URL</span></div>';
            return;
        }
        if (apiKey.length < 10 && !hasSavedKey) {
            container.innerHTML = '<div class="connection-status" style="background: rgba(251,191,36,0.1); color: #fbbf24; border: 1px solid rgba(251,191,36,0.2);"><i class="fas fa-exclamation-triangle"></i><span>Missing API Key</span></div>';
            return;
        }
        if (apiKey.length < 10 && hasSavedKey) {
            container.innerHTML = '<div class="connection-status" style="background: rgba(148,163,184,0.1); color: #94a3b8; border: 1px solid rgba(148,163,184,0.2);"><i class="fas fa-check-circle"></i><span>API key saved. Leave blank to keep.</span></div>';
            return;
        }
        container.innerHTML = '<div class="connection-status checking"><i class="fas fa-spinner fa-spin"></i><span>Checking...</span></div>';
        var presetEl = document.getElementById('ih-form-preset');
        var preset = presetEl ? presetEl.value : 'manual';
        var body = { preset: preset, url: url, api_path: apiPath, api_key: apiKey };
        fetch('./api/indexer-hunt/validate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.valid) {
                var msg = 'Connected';
                if (data.response_time_ms != null) msg += ' (' + data.response_time_ms + 'ms)';
                container.innerHTML = '<div class="connection-status success"><i class="fas fa-check-circle"></i><span>' + _esc(msg) + '</span></div>';
            } else {
                container.innerHTML = '<div class="connection-status error"><i class="fas fa-times-circle"></i><span>' + _esc(data.message || 'Connection failed') + '</span></div>';
            }
        })
        .catch(function(err) {
            container.innerHTML = '<div class="connection-status error"><i class="fas fa-times-circle"></i><span>' + _esc(String(err && err.message ? err.message : 'Connection failed')) + '</span></div>';
        });
    }

    function _onPresetChange() {
        var sel = document.getElementById('ih-form-preset');
        var preset = sel ? sel.value : 'manual';
        var isManual = preset === 'manual';

        var nameEl = document.getElementById('ih-form-name');
        var urlEl = document.getElementById('ih-form-url');
        var apiPathEl = document.getElementById('ih-form-api-path');

        if (!isManual) {
            var p = null;
            _presets.forEach(function(pr) { if (pr.key === preset) p = pr; });
            if (p) {
                if (nameEl) nameEl.value = p.name;
                if (urlEl) urlEl.value = p.url;
                if (apiPathEl) apiPathEl.value = p.api_path || '/api';
            }
        }
        if (urlEl) urlEl.readOnly = !isManual;
        if (apiPathEl) apiPathEl.readOnly = !isManual;
    }

    function _saveForm() {
        var nameEl = document.getElementById('ih-form-name');
        var presetEl = document.getElementById('ih-form-preset');
        var urlEl = document.getElementById('ih-form-url');
        var apiPathEl = document.getElementById('ih-form-api-path');
        var apiKeyEl = document.getElementById('ih-form-api-key');
        var priorityEl = document.getElementById('ih-form-priority');
        var protocolEl = document.getElementById('ih-form-protocol');

        var body = {
            name: (nameEl ? nameEl.value : '').trim(),
            preset: presetEl ? presetEl.value : 'manual',
            url: (urlEl ? urlEl.value : '').trim(),
            api_path: (apiPathEl ? apiPathEl.value : '/api').trim(),
            api_key: (apiKeyEl ? apiKeyEl.value : '').trim(),
            priority: parseInt(priorityEl ? priorityEl.value : '50', 10) || 50,
            enabled: true,
            protocol: protocolEl ? protocolEl.value : 'usenet',
        };

        if (!body.name) {
            if (window.huntarrUI) window.huntarrUI.showNotification('Name is required.', 'error');
            return;
        }

        var method = _editingId ? 'PUT' : 'POST';
        var url = _editingId ? './api/indexer-hunt/indexers/' + _editingId : './api/indexer-hunt/indexers';

        fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.success) {
                var msg = _editingId ? 'Indexer updated.' : 'Indexer added.';
                if (data.linked_instances_updated > 0) {
                    msg += ' Updated in ' + data.linked_instances_updated + ' Movie Hunt instance(s).';
                }
                if (window.huntarrUI) window.huntarrUI.showNotification(msg, 'success');
                if (window.SetupWizard && typeof window.SetupWizard.maybeReturnToCollection === 'function') {
                    window.SetupWizard.maybeReturnToCollection();
                }
                var searchInput = document.getElementById('ih-search-input');
                if (searchInput) searchInput.value = '';
                _loadIndexers();
                _showListView();
            } else {
                if (window.huntarrUI) window.huntarrUI.showNotification(data.error || 'Failed to save.', 'error');
            }
        })
        .catch(function(err) {
            if (window.huntarrUI) window.huntarrUI.showNotification('Error: ' + err, 'error');
        });
    }

    // ── Public actions ────────────────────────────────────────────────

    IH.editIndexer = function(id) {
        var idx = null;
        _indexers.forEach(function(i) { if (i.id === id) idx = i; });
        if (idx) _openEditor(idx);
    };

    IH.testIndexer = function(id) {
        fetch('./api/indexer-hunt/indexers/' + id + '/test', { method: 'POST' })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (data.valid) {
                    if (window.huntarrUI) window.huntarrUI.showNotification('Connection OK (' + (data.response_time_ms || 0) + 'ms)', 'success');
                } else {
                    if (window.huntarrUI) window.huntarrUI.showNotification(data.message || 'Test failed.', 'error');
                }
            })
            .catch(function(err) {
                if (window.huntarrUI) window.huntarrUI.showNotification('Error: ' + err, 'error');
            });
    };

    IH.deleteIndexer = function(id, name) {
        fetch('./api/indexer-hunt/linked-instances/' + id)
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var linked = data.linked || [];
                var msg = 'Are you sure you want to delete "' + name + '"?';
                if (linked.length > 0) {
                    msg += '\n\nThis will also remove it from ' + linked.length + ' Movie Hunt instance(s).';
                }
                window.HuntarrConfirm.show({
                    title: 'Delete Indexer',
                    message: msg,
                    confirmLabel: 'Delete',
                    onConfirm: function() {
                        fetch('./api/indexer-hunt/indexers/' + id, { method: 'DELETE' })
                            .then(function(r) { return r.json(); })
                            .then(function(res) {
                                if (res.success) {
                                    _loadIndexers();
                                    var notice = '"' + name + '" deleted.';
                                    if (res.instances_cleaned > 0) {
                                        notice += ' Removed from ' + res.instances_cleaned + ' instance(s).';
                                    }
                                    if (window.huntarrUI) window.huntarrUI.showNotification(notice, 'success');
                                } else {
                                    if (window.huntarrUI) window.huntarrUI.showNotification(res.error || 'Delete failed.', 'error');
                                }
                            });
                    }
                });
            });
    };

    function _esc(s) {
        if (!s) return '';
        var d = document.createElement('div');
        d.appendChild(document.createTextNode(s));
        return d.innerHTML;
    }

    document.addEventListener('huntarr:instances-changed', function() {
        if (document.getElementById('indexer-hunt-content-wrapper') && window.huntarrUI && window.huntarrUI.currentSection === 'indexer-hunt') {
            IH.init();
        }
    });
    document.addEventListener('huntarr:tv-hunt-instances-changed', function() {
        if (document.getElementById('indexer-hunt-content-wrapper') && window.huntarrUI && window.huntarrUI.currentSection === 'indexer-hunt') {
            IH.init();
        }
    });

})();
