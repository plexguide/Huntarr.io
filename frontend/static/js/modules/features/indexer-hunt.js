/**
 * Indexer Hunt — Centralized indexer management module.
 * Provides CRUD operations for global indexers that sync to Movie Hunt instances.
 */
(function() {
    'use strict';

    var _indexers = [];
    var _presets = [];
    var _editingId = null; // null = add mode, string = edit mode
    var _initialized = false;

    var IH = window.IndexerHunt = {};

    // ── Initialization ────────────────────────────────────────────────

    IH.init = function() {
        _loadPresets(function() {
            _loadIndexers();
        });
        if (!_initialized) {
            _bindEvents();
            _initialized = true;
        }
    };

    function _bindEvents() {
        var addBtn = document.getElementById('ih-add-btn');
        if (addBtn) addBtn.addEventListener('click', function() { _openForm(null); });

        var cancelBtn = document.getElementById('ih-form-cancel-btn');
        if (cancelBtn) cancelBtn.addEventListener('click', _closeForm);

        var saveBtn = document.getElementById('ih-form-save-btn');
        if (saveBtn) saveBtn.addEventListener('click', _saveForm);

        var testBtn = document.getElementById('ih-form-test-btn');
        if (testBtn) testBtn.addEventListener('click', _testFromForm);

        var searchInput = document.getElementById('ih-search-input');
        if (searchInput) searchInput.addEventListener('input', function() { _renderTable(); });

        var presetSelect = document.getElementById('ih-form-preset');
        if (presetSelect) presetSelect.addEventListener('change', _onPresetChange);

        var toggleEl = document.getElementById('ih-form-enabled');
        if (toggleEl) toggleEl.addEventListener('click', function() {
            this.classList.toggle('active');
            var label = document.getElementById('ih-form-enabled-label');
            if (label) label.textContent = this.classList.contains('active') ? 'Enabled' : 'Disabled';
        });
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
                _renderTable();
            })
            .catch(function(err) {
                console.error('[IndexerHunt] Load error:', err);
            });
    }

    function _populatePresetDropdown() {
        var sel = document.getElementById('ih-form-preset');
        if (!sel) return;
        // Keep "Custom (Manual)" as first option
        sel.innerHTML = '<option value="manual">Custom (Manual)</option>';
        _presets.forEach(function(p) {
            var opt = document.createElement('option');
            opt.value = p.key;
            opt.textContent = p.name;
            sel.appendChild(opt);
        });
    }

    // ── Table rendering ───────────────────────────────────────────────

    function _renderTable() {
        var tbody = document.getElementById('ih-table-body');
        var empty = document.getElementById('ih-empty-state');
        var tableWrap = document.getElementById('ih-table-wrap');
        if (!tbody) return;

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

        if (filtered.length === 0) {
            tbody.innerHTML = '';
            if (tableWrap) tableWrap.style.display = 'none';
            if (empty) empty.style.display = 'block';
            return;
        }

        if (tableWrap) tableWrap.style.display = '';
        if (empty) empty.style.display = 'none';

        var html = '';
        filtered.forEach(function(idx) {
            var nameHtml = '<div class="ih-name-cell"><span class="ih-name-primary">' + _esc(idx.name) + '</span>';
            if (idx.display_name) {
                nameHtml += '<span class="ih-name-display">' + _esc(idx.display_name) + '</span>';
            }
            nameHtml += '</div>';

            var protocol = (idx.protocol || 'usenet').toUpperCase();
            var url = idx.url || '—';
            var enabled = idx.enabled !== false;
            var statusBadge = enabled
                ? '<span class="ih-badge ih-badge-enabled">Enabled</span>'
                : '<span class="ih-badge ih-badge-disabled">Disabled</span>';

            html += '<tr data-id="' + _esc(idx.id) + '">'
                + '<td>' + nameHtml + '</td>'
                + '<td><span class="ih-badge ih-badge-protocol">' + _esc(protocol) + '</span></td>'
                + '<td class="ih-url-cell" title="' + _esc(url) + '">' + _esc(url) + '</td>'
                + '<td><span class="ih-priority">' + (idx.priority || 50) + '</span></td>'
                + '<td>' + statusBadge + '</td>'
                + '<td class="ih-actions">'
                    + '<button class="ih-action-btn ih-btn-test" onclick="IndexerHunt.testIndexer(\'' + _esc(idx.id) + '\')" title="Test"><i class="fas fa-plug"></i></button>'
                    + '<button class="ih-action-btn" onclick="IndexerHunt.editIndexer(\'' + _esc(idx.id) + '\')" title="Edit"><i class="fas fa-edit"></i></button>'
                    + '<button class="ih-action-btn ih-btn-delete" onclick="IndexerHunt.deleteIndexer(\'' + _esc(idx.id) + '\', \'' + _esc(idx.name) + '\')" title="Delete"><i class="fas fa-trash"></i></button>'
                + '</td></tr>';
        });
        tbody.innerHTML = html;
    }

    // ── Form handling ─────────────────────────────────────────────────

    function _openForm(existingIdx) {
        _editingId = existingIdx ? existingIdx.id : null;
        var panel = document.getElementById('ih-form-panel');
        var title = document.getElementById('ih-form-title');
        if (!panel) return;

        panel.style.display = 'block';
        if (title) title.textContent = _editingId ? 'Edit Indexer' : 'Add Indexer';

        var presetSel = document.getElementById('ih-form-preset');
        var nameEl = document.getElementById('ih-form-name');
        var displayNameEl = document.getElementById('ih-form-display-name');
        var urlEl = document.getElementById('ih-form-url');
        var apiPathEl = document.getElementById('ih-form-api-path');
        var apiKeyEl = document.getElementById('ih-form-api-key');
        var priorityEl = document.getElementById('ih-form-priority');
        var enabledEl = document.getElementById('ih-form-enabled');
        var protocolEl = document.getElementById('ih-form-protocol');

        if (existingIdx) {
            if (presetSel) { presetSel.value = existingIdx.preset || 'manual'; presetSel.disabled = true; }
            if (nameEl) nameEl.value = existingIdx.name || '';
            if (displayNameEl) displayNameEl.value = existingIdx.display_name || '';
            if (urlEl) { urlEl.value = existingIdx.url || ''; urlEl.readOnly = existingIdx.preset !== 'manual'; }
            if (apiPathEl) { apiPathEl.value = existingIdx.api_path || '/api'; apiPathEl.readOnly = existingIdx.preset !== 'manual'; }
            if (apiKeyEl) apiKeyEl.value = '';
            if (apiKeyEl) apiKeyEl.placeholder = existingIdx.api_key_last4 ? '****' + existingIdx.api_key_last4 : 'Enter API key';
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

        // Scroll to form
        panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function _closeForm() {
        var panel = document.getElementById('ih-form-panel');
        if (panel) panel.style.display = 'none';
        _editingId = null;
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
                _closeForm();
                _loadIndexers();
                var msg = _editingId ? 'Indexer updated.' : 'Indexer added.';
                if (data.linked_instances_updated > 0) {
                    msg += ' Updated in ' + data.linked_instances_updated + ' Movie Hunt instance(s).';
                }
                if (window.huntarrUI) window.huntarrUI.showNotification(msg, 'success');
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

        fetch('./api/indexer-hunt/validate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.valid) {
                if (window.huntarrUI) window.huntarrUI.showNotification('Connection successful!', 'success');
            } else {
                if (window.huntarrUI) window.huntarrUI.showNotification(data.message || 'Connection failed.', 'error');
            }
        })
        .catch(function(err) {
            if (window.huntarrUI) window.huntarrUI.showNotification('Test error: ' + err, 'error');
        })
        .finally(function() {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-plug"></i> Test'; }
        });
    }

    // ── Public actions ────────────────────────────────────────────────

    IH.editIndexer = function(id) {
        var idx = null;
        _indexers.forEach(function(i) { if (i.id === id) idx = i; });
        if (idx) _openForm(idx);
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
        // Check linked instances first
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

    // ── Helpers ────────────────────────────────────────────────────────

    function _esc(s) {
        if (!s) return '';
        var d = document.createElement('div');
        d.appendChild(document.createTextNode(s));
        return d.innerHTML;
    }

})();
