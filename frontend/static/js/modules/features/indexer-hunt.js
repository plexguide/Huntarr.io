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
        _showListView();
        _loadPresets(function() {
            _loadIndexers();
        });
        if (!_initialized) {
            _bindEvents();
            _initialized = true;
        }
    };

    function _bindEvents() {
        _on('ih-add-btn', 'click', function() { _openEditor(null); });
        _on('ih-empty-add-btn', 'click', function() { _openEditor(null); });
        _on('ih-editor-back', 'click', function() { _showListView(); });
        _on('ih-editor-save', 'click', _saveForm);
        _on('ih-form-test-btn', 'click', _testFromForm);
        _on('ih-search-input', 'input', function() { _renderCards(); });
        _on('ih-form-preset', 'change', _onPresetChange);

        var toggleEl = document.getElementById('ih-form-enabled');
        if (toggleEl) toggleEl.addEventListener('click', function() {
            this.classList.toggle('active');
            var label = document.getElementById('ih-form-enabled-label');
            if (label) label.textContent = this.classList.contains('active') ? 'Enabled' : 'Disabled';
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
                       (idx.display_name || '').toLowerCase().indexOf(query) !== -1 ||
                       (idx.url || '').toLowerCase().indexOf(query) !== -1 ||
                       (idx.preset || '').toLowerCase().indexOf(query) !== -1;
            });
        }

        if (filtered.length === 0 && _indexers.length === 0) {
            grid.style.display = 'none';
            if (empty) empty.style.display = '';
            var instanceArea = document.getElementById('ih-instance-area');
            if (instanceArea) instanceArea.style.display = 'none';
            return;
        }

        grid.style.display = '';
        if (empty) empty.style.display = 'none';
        var instanceArea = document.getElementById('ih-instance-area');
        if (instanceArea) instanceArea.style.display = '';

        var html = '';
        filtered.forEach(function(idx) {
            var enabled = idx.enabled !== false;
            var statusClass = enabled ? 'enabled' : 'disabled';
            var statusText = enabled ? 'Enabled' : 'Disabled';
            var statusIcon = enabled ? 'fa-check-circle' : 'fa-minus-circle';
            var presetLabel = _getPresetLabel(idx.preset);
            var url = idx.url || '\u2014';
            var keyDisplay = idx.api_key_last4 ? '\u2022\u2022\u2022\u2022' + _esc(idx.api_key_last4) : 'No key';
            var displayLabel = idx.display_name || idx.name || '';
            var displayName = displayLabel ? '<span class="ih-card-display-name">' + _esc(displayLabel) + '</span>' : '';

            html += '<div class="ih-card' + (enabled ? '' : ' ih-card-disabled') + '" data-id="' + _esc(idx.id) + '">'
                + '<div class="ih-card-header">'
                    + '<div class="ih-card-name"><span>' + _esc(idx.name) + displayName + '</span></div>'
                    + '<span class="ih-card-status ' + statusClass + '"><i class="fas ' + statusIcon + '"></i> ' + statusText + '</span>'
                + '</div>'
                + '<div class="ih-card-body">'
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
        var displayNameEl = document.getElementById('ih-form-display-name');
        var urlEl = document.getElementById('ih-form-url');
        var apiPathEl = document.getElementById('ih-form-api-path');
        var apiKeyEl = document.getElementById('ih-form-api-key');
        var priorityEl = document.getElementById('ih-form-priority');
        var enabledEl = document.getElementById('ih-form-enabled');
        var protocolEl = document.getElementById('ih-form-protocol');
        var testResult = document.getElementById('ih-test-result');

        if (testResult) testResult.innerHTML = '';

        if (existingIdx) {
            if (presetSel) { presetSel.value = existingIdx.preset || 'manual'; presetSel.disabled = true; }
            if (nameEl) nameEl.value = existingIdx.name || '';
            if (displayNameEl) displayNameEl.value = existingIdx.display_name || '';
            if (urlEl) { urlEl.value = existingIdx.url || ''; urlEl.readOnly = existingIdx.preset !== 'manual'; }
            if (apiPathEl) { apiPathEl.value = existingIdx.api_path || '/api'; apiPathEl.readOnly = existingIdx.preset !== 'manual'; }
            if (apiKeyEl) apiKeyEl.value = '';
            if (apiKeyEl) apiKeyEl.placeholder = existingIdx.api_key_last4 ? 'Leave blank to keep (\u2022\u2022\u2022\u2022' + existingIdx.api_key_last4 + ')' : 'Enter API key';
            if (priorityEl) priorityEl.value = existingIdx.priority || 50;
            if (enabledEl) {
                if (existingIdx.enabled !== false) enabledEl.classList.add('active');
                else enabledEl.classList.remove('active');
            }
            if (protocolEl) protocolEl.value = existingIdx.protocol || 'usenet';
        } else {
            if (presetSel) { presetSel.value = 'manual'; presetSel.disabled = false; }
            if (nameEl) nameEl.value = '';
            if (displayNameEl) displayNameEl.value = '';
            if (urlEl) { urlEl.value = ''; urlEl.readOnly = false; }
            if (apiPathEl) { apiPathEl.value = '/api'; apiPathEl.readOnly = false; }
            if (apiKeyEl) { apiKeyEl.value = ''; apiKeyEl.placeholder = 'Enter API key'; }
            if (priorityEl) priorityEl.value = 50;
            if (enabledEl) enabledEl.classList.add('active');
            if (protocolEl) protocolEl.value = 'usenet';
        }

        var enabledLabel = document.getElementById('ih-form-enabled-label');
        if (enabledLabel && enabledEl) enabledLabel.textContent = enabledEl.classList.contains('active') ? 'Enabled' : 'Disabled';

        _showEditorView();
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
        var displayNameEl = document.getElementById('ih-form-display-name');
        var urlEl = document.getElementById('ih-form-url');
        var apiPathEl = document.getElementById('ih-form-api-path');
        var apiKeyEl = document.getElementById('ih-form-api-key');
        var priorityEl = document.getElementById('ih-form-priority');
        var enabledEl = document.getElementById('ih-form-enabled');
        var protocolEl = document.getElementById('ih-form-protocol');

        var body = {
            name: (nameEl ? nameEl.value : '').trim(),
            preset: presetEl ? presetEl.value : 'manual',
            display_name: (displayNameEl ? displayNameEl.value : '').trim(),
            url: (urlEl ? urlEl.value : '').trim(),
            api_path: (apiPathEl ? apiPathEl.value : '/api').trim(),
            api_key: (apiKeyEl ? apiKeyEl.value : '').trim(),
            priority: parseInt(priorityEl ? priorityEl.value : '50', 10) || 50,
            enabled: enabledEl ? enabledEl.classList.contains('active') : true,
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

    function _testFromForm() {
        var presetEl = document.getElementById('ih-form-preset');
        var urlEl = document.getElementById('ih-form-url');
        var apiPathEl = document.getElementById('ih-form-api-path');
        var apiKeyEl = document.getElementById('ih-form-api-key');
        var resultEl = document.getElementById('ih-test-result');

        var body = {
            preset: presetEl ? presetEl.value : 'manual',
            url: (urlEl ? urlEl.value : '').trim(),
            api_path: (apiPathEl ? apiPathEl.value : '/api').trim(),
            api_key: (apiKeyEl ? apiKeyEl.value : '').trim(),
        };

        if (!body.api_key) {
            if (window.huntarrUI) window.huntarrUI.showNotification('API Key is required to test.', 'error');
            return;
        }

        var btn = document.getElementById('ih-form-test-btn');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Testing...'; }
        if (resultEl) resultEl.innerHTML = '';

        fetch('./api/indexer-hunt/validate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.valid) {
                if (resultEl) resultEl.innerHTML = '<div class="ih-test-ok"><i class="fas fa-check-circle"></i> Connection successful</div>';
            } else {
                if (resultEl) resultEl.innerHTML = '<div class="ih-test-fail"><i class="fas fa-times-circle"></i> ' + _esc(data.message || 'Connection failed') + '</div>';
            }
        })
        .catch(function(err) {
            if (resultEl) resultEl.innerHTML = '<div class="ih-test-fail"><i class="fas fa-times-circle"></i> ' + _esc(String(err)) + '</div>';
        })
        .finally(function() {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-plug"></i> Test Connection'; }
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

})();
