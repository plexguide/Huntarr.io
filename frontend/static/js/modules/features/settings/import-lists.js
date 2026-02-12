/**
 * Import Lists – single view for Movie Hunt and TV Hunt. Combined instance dropdown
 * (Movie - X / TV - X, alphabetical). Each instance keeps its own lists; same page linked from both sidebars.
 * TV Hunt returns empty lists (stub) until TV import lists are implemented.
 */
(function() {
    'use strict';

    var listTypes = null; // cached from API
    var currentEditId = null;
    var selectedType = null;

    window.ImportLists = {
        _ilMode: 'movie',

        getApiBase: function() {
            return this._ilMode === 'tv' ? './api/tv-hunt/import-lists' : './api/movie-hunt/import-lists';
        },

        getInstanceId: function() {
            var sel = document.getElementById('settings-import-lists-instance-select');
            var v = sel && sel.value ? sel.value : '';
            if (v && v.indexOf(':') >= 0) return v.split(':')[1] || '';
            return v || '';
        },

        _appendInstanceParam: function(url) {
            var id = this.getInstanceId();
            if (!id) return url;
            return url + (url.indexOf('?') >= 0 ? '&' : '?') + 'instance_id=' + encodeURIComponent(id);
        },

        populateCombinedInstanceDropdown: function(preferMode) {
            var self = window.ImportLists;
            var selectEl = document.getElementById('settings-import-lists-instance-select');
            if (!selectEl) return;
            selectEl.innerHTML = '<option value="">Loading...</option>';
            var ts = Date.now();
            Promise.all([
                fetch('./api/movie-hunt/instances?t=' + ts, { cache: 'no-store' }).then(function(r) { return r.json(); }),
                fetch('./api/tv-hunt/instances?t=' + ts, { cache: 'no-store' }).then(function(r) { return r.json(); }),
                fetch('./api/movie-hunt/current-instance?t=' + ts, { cache: 'no-store' }).then(function(r) { return r.json(); }),
                fetch('./api/tv-hunt/current-instance?t=' + ts, { cache: 'no-store' }).then(function(r) { return r.json(); })
            ]).then(function(results) {
                var movieList = (results[0].instances || []).map(function(inst) {
                    return { value: 'movie:' + inst.id, label: 'Movie - ' + (inst.name || 'Instance ' + inst.id) };
                });
                var tvList = (results[1].instances || []).map(function(inst) {
                    return { value: 'tv:' + inst.id, label: 'TV - ' + (inst.name || 'Instance ' + inst.id) };
                });
                var combined = movieList.concat(tvList);
                combined.sort(function(a, b) { return (a.label || '').localeCompare(b.label || '', undefined, { sensitivity: 'base' }); });
                var currentMovie = results[2].instance_id != null ? Number(results[2].instance_id) : null;
                var currentTv = results[3].instance_id != null ? Number(results[3].instance_id) : null;
                selectEl.innerHTML = '';
                if (combined.length === 0) {
                    var emptyOpt = document.createElement('option');
                    emptyOpt.value = '';
                    emptyOpt.textContent = 'No Movie or TV Hunt instances';
                    selectEl.appendChild(emptyOpt);
                    return;
                }
                combined.forEach(function(item) {
                    var opt = document.createElement('option');
                    opt.value = item.value;
                    opt.textContent = item.label;
                    selectEl.appendChild(opt);
                });
                var saved = (typeof localStorage !== 'undefined' && localStorage.getItem('media-hunt-import-lists-last-instance')) || '';
                var selected = '';
                if (preferMode === 'movie' && currentMovie != null) {
                    selected = 'movie:' + currentMovie;
                    if (!combined.some(function(i) { return i.value === selected; })) selected = combined[0].value;
                } else if (preferMode === 'tv' && currentTv != null) {
                    selected = 'tv:' + currentTv;
                    if (!combined.some(function(i) { return i.value === selected; })) selected = combined[0].value;
                } else if (saved && combined.some(function(i) { return i.value === saved; })) {
                    selected = saved;
                } else if (currentMovie != null && combined.some(function(i) { return i.value === 'movie:' + currentMovie; })) {
                    selected = 'movie:' + currentMovie;
                } else if (currentTv != null && combined.some(function(i) { return i.value === 'tv:' + currentTv; })) {
                    selected = 'tv:' + currentTv;
                } else {
                    selected = combined[0].value;
                }
                selectEl.value = selected;
                var parts = (selected || '').split(':');
                if (parts.length === 2) {
                    self._ilMode = parts[0] === 'tv' ? 'tv' : 'movie';
                    if (typeof localStorage !== 'undefined') localStorage.setItem('media-hunt-import-lists-last-instance', selected);
                    self.refreshList();
                }
            }).catch(function() {
                selectEl.innerHTML = '<option value="">Failed to load instances</option>';
            });
        },

        onCombinedInstanceChange: function() {
            var selectEl = document.getElementById('settings-import-lists-instance-select');
            if (!selectEl) return;
            var val = selectEl.value || '';
            var parts = val.split(':');
            if (parts.length === 2) {
                window.ImportLists._ilMode = parts[0] === 'tv' ? 'tv' : 'movie';
                if (typeof localStorage !== 'undefined') localStorage.setItem('media-hunt-import-lists-last-instance', val);
                window.ImportLists.refreshList();
            }
        },

        initOrRefresh: function(preferMode) {
            var self = window.ImportLists;
            self._ilMode = (preferMode === 'tv') ? 'tv' : 'movie';
            var selectEl = document.getElementById('settings-import-lists-instance-select');
            if (selectEl && selectEl.options.length <= 1) {
                self.populateCombinedInstanceDropdown(preferMode);
            } else {
                var val = selectEl.value || '';
                var parts = val.split(':');
                if (parts.length === 2) self._ilMode = parts[0] === 'tv' ? 'tv' : 'movie';
                self.refreshList();
            }
            if (selectEl && !selectEl._ilChangeBound) {
                selectEl._ilChangeBound = true;
                selectEl.addEventListener('change', function() { window.ImportLists.onCombinedInstanceChange(); });
            }
        },

        // ---------------------------------------------------------------
        // Refresh / render
        // ---------------------------------------------------------------
        refreshList: function() {
            var gridEl = document.getElementById('import-lists-grid');
            if (!gridEl) return;
            var url = window.ImportLists._appendInstanceParam(window.ImportLists.getApiBase());
            fetch(url)
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    var lists = (data && data.lists) ? data.lists : [];
                    var html = '';

                    for (var i = 0; i < lists.length; i++) {
                        var lst = lists[i];
                        var name = _esc(lst.name || lst.type);
                        var typeInfo = _getTypeInfo(lst.type);
                        var icon = typeInfo ? typeInfo.icon : 'fas fa-list';
                        var typeName = typeInfo ? typeInfo.name : lst.type;
                        var enabled = lst.enabled !== false;
                        var interval = lst.sync_interval_hours || 12;
                        var lastSync = lst.last_sync ? _timeAgo(lst.last_sync) : 'Never';
                        var lastCount = lst.last_sync_count || 0;
                        var hasError = !!lst.last_error;
                        var subtypeName = _getSubtypeName(lst.type, (lst.settings || {}).list_type);

                        html += '<div class="import-list-card instance-card' + (enabled ? '' : ' disabled-list') + '" data-list-id="' + lst.id + '">' +
                            '<div class="import-list-card-header">' +
                                '<div class="import-list-card-icon"><i class="' + icon + '"></i></div>' +
                                '<div class="import-list-card-title">' +
                                    '<span class="import-list-card-name">' + name + '</span>' +
                                    '<span class="import-list-card-type">' + _esc(typeName) + (subtypeName ? ' &middot; ' + _esc(subtypeName) : '') + '</span>' +
                                '</div>' +
                            '</div>' +
                            '<div class="import-list-card-body">' +
                                '<div class="import-list-badges">' +
                                    '<span class="import-list-badge ' + (enabled ? 'badge-enabled' : 'badge-disabled') + '">' + (enabled ? 'Enabled' : 'Disabled') + '</span>' +
                                    '<span class="import-list-badge badge-interval"><i class="fas fa-clock"></i> ' + _intervalLabel(interval) + '</span>' +
                                '</div>' +
                                '<div class="import-list-stats">' +
                                    '<span class="import-list-stat"><i class="fas fa-history"></i> ' + lastSync + '</span>' +
                                    (lastCount > 0 ? '<span class="import-list-stat"><i class="fas fa-film"></i> ' + lastCount + ' added</span>' : '') +
                                    (hasError ? '<span class="import-list-stat stat-error"><i class="fas fa-exclamation-triangle"></i> Error</span>' : '') +
                                '</div>' +
                            '</div>' +
                            '<div class="import-list-card-footer">' +
                                '<button type="button" class="btn-card" data-list-id="' + lst.id + '" data-action="sync" title="Sync Now"><i class="fas fa-sync-alt"></i> Sync</button>' +
                                '<button type="button" class="btn-card" data-list-id="' + lst.id + '" data-action="toggle" title="' + (enabled ? 'Disable' : 'Enable') + '">' +
                                    '<i class="fas fa-' + (enabled ? 'toggle-on' : 'toggle-off') + '"></i> ' + (enabled ? 'On' : 'Off') +
                                '</button>' +
                                '<button type="button" class="btn-card" data-list-id="' + lst.id + '" data-action="edit" title="Edit"><i class="fas fa-pen"></i> Edit</button>' +
                            '</div>' +
                        '</div>';
                    }

                    // Add card at end (hide for TV - import lists not implemented for TV yet)
                    if (window.ImportLists._ilMode !== 'tv') {
                        html += '<div class="add-instance-card add-import-list-card" id="import-lists-add-card" data-app-type="import-list">' +
                            '<div class="add-icon"><i class="fas fa-plus-circle"></i></div>' +
                            '<div class="add-text">Add Import List</div></div>';
                    } else if (lists.length === 0) {
                        html += '<p class="import-lists-tv-empty" style="color:#94a3b8;margin:12px 0;">Import lists for TV Hunt are not available yet.</p>';
                    }

                    gridEl.innerHTML = html;
                    window.ImportLists._bindCardButtons();
                    var syncAllBtn = document.getElementById('import-lists-sync-all-btn');
                    if (syncAllBtn) syncAllBtn.style.display = window.ImportLists._ilMode === 'tv' ? 'none' : '';
                })
                .catch(function(e) {
                    console.error('[ImportLists] Failed to load:', e);
                    var errHtml = '<p style="color: #ef4444; margin: 0 0 12px 0;">Failed to load import lists.</p>';
                    if (window.ImportLists._ilMode !== 'tv') {
                        errHtml += '<div class="add-instance-card add-import-list-card" id="import-lists-add-card" data-app-type="import-list">' +
                            '<div class="add-icon"><i class="fas fa-plus-circle"></i></div>' +
                            '<div class="add-text">Add Import List</div></div>';
                    }
                    gridEl.innerHTML = errHtml;
                    window.ImportLists._bindAddCard();
                });
        },

        // ---------------------------------------------------------------
        // Card button bindings
        // ---------------------------------------------------------------
        _bindCardButtons: function() {
            var gridEl = document.getElementById('import-lists-grid');
            if (!gridEl) return;

            gridEl.querySelectorAll('[data-action="sync"]').forEach(function(btn) {
                btn.onclick = function() { window.ImportLists.syncList(btn.getAttribute('data-list-id')); };
            });
            gridEl.querySelectorAll('[data-action="toggle"]').forEach(function(btn) {
                btn.onclick = function() { window.ImportLists.toggleList(btn.getAttribute('data-list-id')); };
            });
            gridEl.querySelectorAll('[data-action="edit"]').forEach(function(btn) {
                btn.onclick = function() { window.ImportLists.openEditModal(btn.getAttribute('data-list-id')); };
            });
            window.ImportLists._bindAddCard();
        },

        _bindAddCard: function() {
            var addCard = document.getElementById('import-lists-add-card');
            if (addCard) {
                addCard.onclick = function() { window.ImportLists.openAddModal(); };
            }
        },

        // ---------------------------------------------------------------
        // Sync
        // ---------------------------------------------------------------
        syncList: function(listId) {
            _notify('Syncing list...', 'info');
            var url = window.ImportLists.getApiBase() + '/' + listId + '/sync';
            url = window.ImportLists._appendInstanceParam(url);
            var body = {};
            var instId = window.ImportLists.getInstanceId();
            if (instId) body.instance_id = parseInt(instId, 10);
            fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.success) {
                        var res = data.result || {};
                        _notify('Sync complete: ' + (res.added || 0) + ' added, ' + (res.skipped || 0) + ' skipped', 'success');
                    } else {
                        _notify('Sync failed: ' + (data.error || 'Unknown error'), 'error');
                    }
                    window.ImportLists.refreshList();
                })
                .catch(function(e) { _notify('Sync error: ' + e, 'error'); });
        },

        syncAll: function() {
            _notify('Syncing all lists...', 'info');
            var url = window.ImportLists.getApiBase() + '/sync-all';
            url = window.ImportLists._appendInstanceParam(url);
            var body = {};
            var instId = window.ImportLists.getInstanceId();
            if (instId) body.instance_id = parseInt(instId, 10);
            fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.success) {
                        var results = data.results || {};
                        var totalAdded = 0;
                        Object.keys(results).forEach(function(k) { totalAdded += (results[k].added || 0); });
                        _notify('All lists synced: ' + totalAdded + ' movies added', 'success');
                    } else {
                        _notify('Sync failed', 'error');
                    }
                    window.ImportLists.refreshList();
                })
                .catch(function(e) { _notify('Sync error: ' + e, 'error'); });
        },

        toggleList: function(listId) {
            var url = window.ImportLists.getApiBase() + '/' + listId + '/toggle';
            url = window.ImportLists._appendInstanceParam(url);
            var body = {};
            var instId = window.ImportLists.getInstanceId();
            if (instId) body.instance_id = parseInt(instId, 10);
            fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
                .then(function(r) { return r.json(); })
                .then(function() { window.ImportLists.refreshList(); })
                .catch(function(e) { _notify('Toggle failed: ' + e, 'error'); });
        },

        // ---------------------------------------------------------------
        // Add modal
        // ---------------------------------------------------------------
        openAddModal: function() {
            var modal = document.getElementById('import-list-add-modal');
            if (!modal) return;
            selectedType = null;
            currentEditId = null;

            // Show type picker, hide config form
            document.getElementById('import-list-type-picker').style.display = '';
            document.getElementById('import-list-config-form').style.display = 'none';

            _loadListTypes(function() {
                _renderTypePicker();
            });

            modal.style.display = 'flex';
            document.body.classList.add('modal-open');
        },

        closeAddModal: function() {
            var modal = document.getElementById('import-list-add-modal');
            if (modal) modal.style.display = 'none';
            document.body.classList.remove('modal-open');
        },

        _selectType: function(typeId) {
            selectedType = typeId;
            var typeInfo = _getTypeInfo(typeId);

            // Switch to config form
            document.getElementById('import-list-type-picker').style.display = 'none';
            document.getElementById('import-list-config-form').style.display = '';

            // Set default name
            document.getElementById('import-list-name').value = typeInfo ? typeInfo.name : typeId;

            // Populate subtypes if any
            var subtypeGroup = document.getElementById('import-list-subtype-group');
            var subtypeSelect = document.getElementById('import-list-subtype');
            if (typeInfo && typeInfo.subtypes && typeInfo.subtypes.length > 0) {
                subtypeGroup.style.display = '';
                subtypeSelect.innerHTML = '';
                typeInfo.subtypes.forEach(function(st) {
                    var opt = document.createElement('option');
                    opt.value = st.id;
                    opt.textContent = st.name;
                    subtypeSelect.appendChild(opt);
                });
                subtypeSelect.onchange = function() {
                    _renderDynamicFields('import-list-dynamic-fields', typeId, subtypeSelect.value, {});
                };
            } else {
                subtypeGroup.style.display = 'none';
            }

            // Render dynamic fields
            _renderDynamicFields('import-list-dynamic-fields', typeId, subtypeSelect ? subtypeSelect.value : '', {});
        },

        saveNewList: function() {
            var name = (document.getElementById('import-list-name').value || '').trim();
            if (!name) { _notify('Name is required', 'error'); return; }
            if (!selectedType) { _notify('Please select a list type', 'error'); return; }

            var subtypeSelect = document.getElementById('import-list-subtype');
            var intervalSelect = document.getElementById('import-list-interval');

            var settings = _collectDynamicFields('import-list-dynamic-fields');
            if (subtypeSelect && subtypeSelect.value) {
                settings.list_type = subtypeSelect.value;
            }

            var payload = {
                type: selectedType,
                name: name,
                settings: settings,
                sync_interval_hours: parseInt(intervalSelect.value, 10) || 12,
            };
            var instId = window.ImportLists.getInstanceId();
            if (instId) payload.instance_id = parseInt(instId, 10);
            var url = window.ImportLists._appendInstanceParam(window.ImportLists.getApiBase());
            fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (data.success) {
                    _notify('Import list added!', 'success');
                    window.ImportLists.closeAddModal();
                    window.ImportLists.refreshList();
                } else {
                    _notify('Failed: ' + (data.error || 'Unknown'), 'error');
                }
            })
            .catch(function(e) { _notify('Error: ' + e, 'error'); });
        },

        // ---------------------------------------------------------------
        // Edit modal
        // ---------------------------------------------------------------
        openEditModal: function(listId) {
            currentEditId = listId;
            var url = window.ImportLists._appendInstanceParam(window.ImportLists.getApiBase());
            fetch(url)
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    var lists = (data && data.lists) || [];
                    var lst = null;
                    for (var i = 0; i < lists.length; i++) {
                        if (lists[i].id === listId) { lst = lists[i]; break; }
                    }
                    if (!lst) { _notify('List not found', 'error'); return; }

                    document.getElementById('import-list-edit-name').value = lst.name || '';

                    // Subtypes
                    var typeInfo = _getTypeInfo(lst.type);
                    var subtypeGroup = document.getElementById('import-list-edit-subtype-group');
                    var subtypeSelect = document.getElementById('import-list-edit-subtype');
                    if (typeInfo && typeInfo.subtypes && typeInfo.subtypes.length > 0) {
                        subtypeGroup.style.display = '';
                        subtypeSelect.innerHTML = '';
                        typeInfo.subtypes.forEach(function(st) {
                            var opt = document.createElement('option');
                            opt.value = st.id;
                            opt.textContent = st.name;
                            if ((lst.settings || {}).list_type === st.id) opt.selected = true;
                            subtypeSelect.appendChild(opt);
                        });
                        subtypeSelect.onchange = function() {
                            _renderDynamicFields('import-list-edit-dynamic-fields', lst.type, subtypeSelect.value, lst.settings || {});
                        };
                    } else {
                        subtypeGroup.style.display = 'none';
                    }

                    // Dynamic fields
                    _renderDynamicFields('import-list-edit-dynamic-fields', lst.type, (lst.settings || {}).list_type || '', lst.settings || {});

                    // Interval
                    var intervalSelect = document.getElementById('import-list-edit-interval');
                    intervalSelect.value = String(lst.sync_interval_hours || 12);

                    var modal = document.getElementById('import-list-edit-modal');
                    modal.style.display = 'flex';
                    document.body.classList.add('modal-open');
                })
                .catch(function(e) { _notify('Error loading list: ' + e, 'error'); });
        },

        closeEditModal: function() {
            var modal = document.getElementById('import-list-edit-modal');
            if (modal) modal.style.display = 'none';
            document.body.classList.remove('modal-open');
            currentEditId = null;
        },

        saveEditList: function() {
            if (!currentEditId) return;
            var name = (document.getElementById('import-list-edit-name').value || '').trim();
            if (!name) { _notify('Name is required', 'error'); return; }

            var subtypeSelect = document.getElementById('import-list-edit-subtype');
            var intervalSelect = document.getElementById('import-list-edit-interval');

            var settings = _collectDynamicFields('import-list-edit-dynamic-fields');
            if (subtypeSelect && subtypeSelect.value) {
                settings.list_type = subtypeSelect.value;
            }

            var payload = {
                name: name,
                settings: settings,
                sync_interval_hours: parseInt(intervalSelect.value, 10) || 12,
            };
            var instId = window.ImportLists.getInstanceId();
            if (instId) payload.instance_id = parseInt(instId, 10);
            var editUrl = window.ImportLists.getApiBase() + '/' + currentEditId;
            editUrl = window.ImportLists._appendInstanceParam(editUrl);
            fetch(editUrl, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (data.success) {
                    _notify('List updated!', 'success');
                    window.ImportLists.closeEditModal();
                    window.ImportLists.refreshList();
                } else {
                    _notify('Failed: ' + (data.error || 'Unknown'), 'error');
                }
            })
            .catch(function(e) { _notify('Error: ' + e, 'error'); });
        },

        deleteList: function() {
            if (!currentEditId) return;
            if (window.HuntarrConfirm) {
                window.HuntarrConfirm.show({
                    title: 'Delete Import List',
                    message: 'Are you sure you want to delete this import list? This cannot be undone.',
                    confirmLabel: 'Delete',
                    onConfirm: function() { _doDelete(currentEditId); }
                });
            } else if (confirm('Delete this import list?')) {
                _doDelete(currentEditId);
            }
        },

        // ---------------------------------------------------------------
        // Init event listeners
        // ---------------------------------------------------------------
        init: function() {
            // Add modal
            _bindClick('import-list-add-modal-close', function() { window.ImportLists.closeAddModal(); });
            _bindClick('import-list-add-modal-backdrop', function() { window.ImportLists.closeAddModal(); });
            _bindClick('import-list-cancel-btn', function() { window.ImportLists.closeAddModal(); });
            _bindClick('import-list-save-btn', function() { window.ImportLists.saveNewList(); });
            _bindClick('import-list-config-back', function() {
                document.getElementById('import-list-type-picker').style.display = '';
                document.getElementById('import-list-config-form').style.display = 'none';
            });

            // Edit modal
            _bindClick('import-list-edit-modal-close', function() { window.ImportLists.closeEditModal(); });
            _bindClick('import-list-edit-modal-backdrop', function() { window.ImportLists.closeEditModal(); });
            _bindClick('import-list-edit-cancel-btn', function() { window.ImportLists.closeEditModal(); });
            _bindClick('import-list-edit-save-btn', function() { window.ImportLists.saveEditList(); });
            _bindClick('import-list-edit-delete-btn', function() { window.ImportLists.deleteList(); });

            // Sync All
            _bindClick('import-lists-sync-all-btn', function() { window.ImportLists.syncAll(); });

            document.addEventListener('huntarr:instances-changed', function() { if (window.ImportLists._ilMode === 'movie') window.ImportLists.populateCombinedInstanceDropdown('movie'); });
            document.addEventListener('huntarr:tv-hunt-instances-changed', function() { if (window.ImportLists._ilMode === 'tv') window.ImportLists.populateCombinedInstanceDropdown('tv'); });
        }
    };

    // -------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------

    function _doDelete(listId) {
        var deleteUrl = window.ImportLists.getApiBase() + '/' + listId;
        deleteUrl = window.ImportLists._appendInstanceParam(deleteUrl);
        fetch(deleteUrl, { method: 'DELETE' })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (data.success) {
                    _notify('List deleted', 'success');
                    window.ImportLists.closeEditModal();
                    window.ImportLists.refreshList();
                } else {
                    _notify('Delete failed: ' + (data.error || ''), 'error');
                }
            })
            .catch(function(e) { _notify('Error: ' + e, 'error'); });
    }

    function _loadListTypes(cb) {
        if (listTypes) { if (cb) cb(); return; }
        fetch(window.ImportLists._appendInstanceParam(window.ImportLists.getApiBase() + '/types'))
            .then(function(r) { return r.json(); })
            .then(function(data) {
                listTypes = (data && data.types) || [];
                if (cb) cb();
            })
            .catch(function() { listTypes = []; if (cb) cb(); });
    }

    function _getTypeInfo(typeId) {
        if (!listTypes) return null;
        for (var i = 0; i < listTypes.length; i++) {
            if (listTypes[i].id === typeId) return listTypes[i];
        }
        return null;
    }

    function _getSubtypeName(typeId, subtypeId) {
        var info = _getTypeInfo(typeId);
        if (!info || !info.subtypes) return '';
        for (var i = 0; i < info.subtypes.length; i++) {
            if (info.subtypes[i].id === subtypeId) return info.subtypes[i].name;
        }
        return '';
    }

    function _renderTypePicker() {
        var grid = document.getElementById('import-list-type-grid');
        if (!grid || !listTypes) return;
        var html = '';
        listTypes.forEach(function(t) {
            html += '<div class="import-list-type-card" data-type-id="' + t.id + '">' +
                '<div class="import-list-type-icon"><i class="' + (t.icon || 'fas fa-list') + '"></i></div>' +
                '<div class="import-list-type-name">' + _esc(t.name) + '</div>' +
                (t.requires_oauth ? '<div class="import-list-type-oauth"><i class="fas fa-key"></i> OAuth</div>' : '') +
                '</div>';
        });
        grid.innerHTML = html;
        grid.querySelectorAll('.import-list-type-card').forEach(function(card) {
            card.onclick = function() {
                window.ImportLists._selectType(card.getAttribute('data-type-id'));
            };
        });
    }

    function _renderDynamicFields(containerId, typeId, subtypeId, existingSettings) {
        var container = document.getElementById(containerId);
        if (!container) return;
        var html = '';
        var s = existingSettings || {};

        if (typeId === 'imdb') {
            if (subtypeId === 'custom') {
                html += _fieldInput('list_id', 'IMDb List ID', s.list_id || '', 'e.g. ls123456789');
            }
        } else if (typeId === 'tmdb') {
            if (subtypeId === 'list') {
                html += _fieldInput('list_id', 'TMDb List ID', s.list_id || '', 'Numeric list ID');
            } else if (subtypeId === 'keyword') {
                html += _fieldInput('keyword_id', 'TMDb Keyword ID', s.keyword_id || '', 'Numeric keyword ID');
            } else if (subtypeId === 'company') {
                html += _fieldInput('company_id', 'TMDb Company ID', s.company_id || '', 'e.g. 420 for Marvel');
            } else if (subtypeId === 'person') {
                html += _fieldInput('person_id', 'TMDb Person ID', s.person_id || '', 'Numeric person ID');
            }
        } else if (typeId === 'trakt') {
            // Auth section — always shown for all Trakt subtypes
            var isAuthed = s.access_token && s.access_token !== '••••••••';
            html += '<div class="import-list-form-group">' +
                '<label>Authenticate with Trakt</label>' +
                '<div class="trakt-auth-row">' +
                    '<button type="button" class="btn-trakt-auth' + (isAuthed ? ' trakt-auth-success' : '') + '" id="' + containerId + '-trakt-auth-btn">' +
                        (isAuthed ? '<i class="fas fa-check"></i> Authenticated' : '<i class="fas fa-sign-in-alt"></i> Start OAuth') +
                    '</button>' +
                    '<span class="trakt-auth-status" id="' + containerId + '-trakt-status">' +
                        (isAuthed ? '<i class="fas fa-check-circle" style="color:#22c55e"></i> Authorized' : '') +
                    '</span>' +
                '</div>' +
                '<input type="hidden" class="dynamic-field" data-field="access_token" value="' + _esc(s.access_token || '') + '">' +
                '<input type="hidden" class="dynamic-field" data-field="refresh_token" value="' + _esc(s.refresh_token || '') + '">' +
                '<input type="hidden" class="dynamic-field" data-field="expires_at" value="' + (s.expires_at || 0) + '">' +
            '</div>';

            if (subtypeId === 'watchlist') {
                html += _fieldInput('username', 'Username', s.username || '', 'Trakt username (or leave blank for "me")');
            }
            if (subtypeId === 'custom') {
                html += _fieldInput('username', 'Username', s.username || '', 'Trakt username');
                html += _fieldInput('list_name', 'List Name', s.list_name || '', 'Name of the custom list');
            }
            html += _fieldInput('years', 'Years', s.years || '', 'Filter movies by year or year range');
            html += _fieldInput('additional_parameters', 'Additional Parameters', s.additional_parameters || '', 'Additional Trakt API parameters');
            html += _fieldInput('limit', 'Limit', s.limit || '5000', 'Limit the number of movies to get', 'number');
        } else if (typeId === 'rss') {
            html += _fieldInput('url', 'RSS Feed URL', s.url || '', 'https://example.com/feed.rss');
        } else if (typeId === 'stevenlu') {
            html += _fieldInput('url', 'JSON Feed URL', s.url || 'https://popular-movies-data.stevenlu.com/movies.json', 'StevenLu JSON URL');
        } else if (typeId === 'plex') {
            var plexAuthed = s.access_token && s.access_token !== '••••••••';
            html += '<div class="import-list-form-group">' +
                '<label>Authenticate with Plex</label>' +
                '<div class="plex-auth-row">' +
                    '<button type="button" class="btn-plex-auth' + (plexAuthed ? ' plex-auth-success' : '') + '" id="' + containerId + '-plex-auth-btn">' +
                        (plexAuthed ? '<i class="fas fa-check"></i> Authenticated' : '<i class="fas fa-sign-in-alt"></i> Sign in with Plex') +
                    '</button>' +
                    '<span class="plex-auth-status" id="' + containerId + '-plex-status">' +
                        (plexAuthed ? '<i class="fas fa-check-circle" style="color:#22c55e"></i> Signed in' : '') +
                    '</span>' +
                '</div>' +
                '<input type="hidden" class="dynamic-field" data-field="access_token" value="' + _esc(s.access_token || '') + '">' +
            '</div>';
        } else if (typeId === 'custom_json') {
            html += _fieldInput('url', 'JSON URL', s.url || '', 'https://example.com/movies.json');
        }

        container.innerHTML = html;

        // Bind Trakt OAuth button
        var traktBtn = document.getElementById(containerId + '-trakt-auth-btn');
        if (traktBtn) {
            traktBtn.onclick = function() { _startTraktOAuth(containerId); };
        }

        // Bind Plex OAuth button
        var plexBtn = document.getElementById(containerId + '-plex-auth-btn');
        if (plexBtn) {
            plexBtn.onclick = function() { _startPlexOAuth(containerId); };
        }
    }

    function _collectDynamicFields(containerId) {
        var container = document.getElementById(containerId);
        if (!container) return {};
        var settings = {};
        container.querySelectorAll('.dynamic-field').forEach(function(el) {
            var field = el.getAttribute('data-field');
            if (field) {
                settings[field] = el.value || '';
            }
        });
        return settings;
    }

    function _fieldInput(fieldName, label, value, placeholder, type) {
        type = type || 'text';
        return '<div class="import-list-form-group">' +
            '<label>' + _esc(label) + '</label>' +
            '<input type="' + type + '" class="control-input dynamic-field" data-field="' + fieldName + '" value="' + _esc(value) + '" placeholder="' + _esc(placeholder || '') + '">' +
        '</div>';
    }

    // -------------------------------------------------------------------
    // OAuth flows
    // -------------------------------------------------------------------

    var _traktPollTimer = null;

    function _startTraktOAuth(containerId) {
        var statusEl = document.getElementById(containerId + '-trakt-status');
        var authBtn = document.getElementById(containerId + '-trakt-auth-btn');
        if (authBtn) { authBtn.disabled = true; authBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Connecting...'; }

        // Step 1: Request device code (backend uses embedded credentials)
        fetch('./api/movie-hunt/import-lists/trakt/device-code', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}'
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (!data.success) {
                _notify(data.error || 'Failed to get device code', 'error');
                if (authBtn) { authBtn.disabled = false; authBtn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Start OAuth'; }
                return;
            }

            var deviceCode = data.device_code;
            var userCode = data.user_code;
            var verifyUrl = data.verification_url || 'https://trakt.tv/activate';
            var interval = (data.interval || 5) * 1000;
            var expiresIn = data.expires_in || 600;

            // Show code first — user copies, then clicks the link
            if (statusEl) {
                statusEl.innerHTML =
                    '<div class="trakt-device-auth">' +
                        '<div class="trakt-device-code-box">' +
                            '<span class="trakt-device-label">1. Click code to copy</span>' +
                            '<div class="trakt-device-code trakt-device-code-copyable" id="' + containerId + '-trakt-code" title="Click to copy">' + _esc(userCode) + '</div>' +
                            '<span class="trakt-device-label" style="margin-top:8px">2. Open Trakt &amp; paste it</span>' +
                            '<a href="' + _esc(verifyUrl) + '" target="_blank" rel="noopener" class="trakt-device-open-link" id="' + containerId + '-trakt-open">' +
                                '<i class="fas fa-external-link-alt"></i> Open trakt.tv/activate' +
                            '</a>' +
                            '<span class="trakt-device-waiting"><i class="fas fa-spinner fa-spin"></i> Waiting for authorization...</span>' +
                        '</div>' +
                    '</div>';

                // Click-to-copy on the code (works on HTTP too)
                var codeEl = document.getElementById(containerId + '-trakt-code');
                if (codeEl) {
                    codeEl.onclick = function() {
                        var copied = false;
                        // Method 1: navigator.clipboard (HTTPS/localhost only)
                        if (navigator.clipboard && navigator.clipboard.writeText) {
                            try { navigator.clipboard.writeText(userCode); copied = true; } catch(e) {}
                        }
                        // Method 2: execCommand fallback (works on HTTP)
                        if (!copied) {
                            var ta = document.createElement('textarea');
                            ta.value = userCode;
                            ta.style.position = 'fixed';
                            ta.style.left = '-9999px';
                            ta.style.opacity = '0';
                            document.body.appendChild(ta);
                            ta.select();
                            try { document.execCommand('copy'); copied = true; } catch(e) {}
                            document.body.removeChild(ta);
                        }
                        // Visual feedback
                        codeEl.classList.add('trakt-code-copied');
                        codeEl.setAttribute('title', 'Copied!');
                        var origHTML = codeEl.innerHTML;
                        codeEl.innerHTML = '<i class="fas fa-check"></i> Copied!';
                        setTimeout(function() {
                            codeEl.innerHTML = origHTML;
                            codeEl.classList.remove('trakt-code-copied');
                            codeEl.setAttribute('title', 'Click to copy');
                        }, 1500);
                    };
                }
            }
            if (authBtn) {
                authBtn.style.display = 'none';
            }

            // Step 2: Poll for token
            if (_traktPollTimer) clearInterval(_traktPollTimer);
            var pollCount = 0;
            var maxPolls = Math.floor(expiresIn / (interval / 1000));

            _traktPollTimer = setInterval(function() {
                pollCount++;
                if (pollCount > maxPolls) {
                    clearInterval(_traktPollTimer);
                    _traktPollTimer = null;
                    if (statusEl) statusEl.innerHTML = '<i class="fas fa-times-circle" style="color:#ef4444"></i> Code expired — try again';
                    if (authBtn) { authBtn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Start OAuth'; authBtn.onclick = function() { _startTraktOAuth(containerId); }; }
                    return;
                }

                fetch('./api/movie-hunt/import-lists/trakt/device-token', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ device_code: deviceCode })
                })
                .then(function(r) { return r.json(); })
                .then(function(tokenData) {
                    if (tokenData.success) {
                        clearInterval(_traktPollTimer);
                        _traktPollTimer = null;

                        var atEl = document.querySelector('#' + containerId + ' [data-field="access_token"]');
                        var rtEl = document.querySelector('#' + containerId + ' [data-field="refresh_token"]');
                        var exEl = document.querySelector('#' + containerId + ' [data-field="expires_at"]');
                        if (atEl) atEl.value = tokenData.access_token;
                        if (rtEl) rtEl.value = tokenData.refresh_token;
                        if (exEl) exEl.value = tokenData.expires_at;

                        if (statusEl) statusEl.innerHTML = '<i class="fas fa-check-circle" style="color:#22c55e"></i> Authorized';
                        if (authBtn) { authBtn.innerHTML = '<i class="fas fa-check"></i> Authenticated'; authBtn.disabled = true; authBtn.classList.add('trakt-auth-success'); authBtn.onclick = null; }
                        _notify('Trakt authorized!', 'success');
                    } else if (tokenData.pending) {
                        // Still waiting — keep polling
                    } else {
                        clearInterval(_traktPollTimer);
                        _traktPollTimer = null;
                        if (statusEl) statusEl.innerHTML = '<i class="fas fa-times-circle" style="color:#ef4444"></i> ' + _esc(tokenData.error || 'Auth failed');
                        if (authBtn) { authBtn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Start OAuth'; authBtn.disabled = false; authBtn.onclick = function() { _startTraktOAuth(containerId); }; }
                        _notify('Trakt auth failed: ' + (tokenData.error || ''), 'error');
                    }
                })
                .catch(function() {
                    // Network error — keep polling, it might recover
                });
            }, interval);
        })
        .catch(function(e) {
            _notify('Error: ' + e, 'error');
            if (authBtn) { authBtn.disabled = false; authBtn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Start OAuth'; }
        });
    }

    var _plexPollTimer = null;

    function _startPlexOAuth(containerId) {
        var statusEl = document.getElementById(containerId + '-plex-status');
        var authBtn = document.getElementById(containerId + '-plex-auth-btn');
        if (authBtn) { authBtn.disabled = true; authBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Connecting...'; }

        // Step 1: Create a Plex PIN
        fetch('./api/movie-hunt/import-lists/plex/pin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}'
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (!data.success) {
                _notify(data.error || 'Failed to create Plex PIN', 'error');
                if (authBtn) { authBtn.disabled = false; authBtn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Sign in with Plex'; }
                return;
            }

            var pinId = data.pin_id;
            var authUrl = data.auth_url;

            // Show status UI with link to Plex
            if (statusEl) {
                statusEl.innerHTML =
                    '<div class="plex-device-auth">' +
                        '<div class="plex-device-code-box">' +
                            '<span class="plex-device-label">Click below to sign in with Plex</span>' +
                            '<a href="' + _esc(authUrl) + '" target="_blank" rel="noopener" class="plex-device-open-link">' +
                                '<i class="fas fa-external-link-alt"></i> Sign in at Plex.tv' +
                            '</a>' +
                            '<span class="plex-device-waiting"><i class="fas fa-spinner fa-spin"></i> Waiting for authorization...</span>' +
                        '</div>' +
                    '</div>';
            }
            if (authBtn) { authBtn.style.display = 'none'; }

            // Auto-open Plex auth page
            window.open(authUrl, '_blank');

            // Step 2: Poll for token
            if (_plexPollTimer) clearInterval(_plexPollTimer);
            var pollCount = 0;
            var maxPolls = 120; // 10 minutes at 5s intervals

            _plexPollTimer = setInterval(function() {
                pollCount++;
                if (pollCount > maxPolls) {
                    clearInterval(_plexPollTimer);
                    _plexPollTimer = null;
                    if (statusEl) statusEl.innerHTML = '<i class="fas fa-times-circle" style="color:#ef4444"></i> Timed out — try again';
                    if (authBtn) { authBtn.style.display = ''; authBtn.disabled = false; authBtn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Sign in with Plex'; }
                    return;
                }

                fetch('./api/movie-hunt/import-lists/plex/check/' + pinId)
                .then(function(r) { return r.json(); })
                .then(function(checkData) {
                    if (checkData.success && checkData.claimed) {
                        // Got the token!
                        clearInterval(_plexPollTimer);
                        _plexPollTimer = null;

                        var atEl = document.querySelector('#' + containerId + ' [data-field="access_token"]');
                        if (atEl) atEl.value = checkData.token;

                        if (statusEl) statusEl.innerHTML = '<i class="fas fa-check-circle" style="color:#22c55e"></i> Signed in';
                        if (authBtn) {
                            authBtn.style.display = '';
                            authBtn.innerHTML = '<i class="fas fa-check"></i> Authenticated';
                            authBtn.disabled = true;
                            authBtn.classList.add('plex-auth-success');
                        }
                        _notify('Plex authorized!', 'success');
                    }
                    // If not claimed yet, keep polling
                })
                .catch(function() {
                    // Network error — keep polling
                });
            }, 5000);
        })
        .catch(function(e) {
            _notify('Error: ' + e, 'error');
            if (authBtn) { authBtn.disabled = false; authBtn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Sign in with Plex'; }
        });
    }

    // -------------------------------------------------------------------
    // Utilities
    // -------------------------------------------------------------------

    function _esc(s) {
        if (!s) return '';
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function _timeAgo(ts) {
        if (!ts) return 'Never';
        var diff = Math.floor((Date.now() / 1000) - ts);
        if (diff < 60) return 'Just now';
        if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
        if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
        return Math.floor(diff / 86400) + 'd ago';
    }

    function _intervalLabel(hours) {
        if (hours < 24) return hours + 'h';
        return Math.floor(hours / 24) + 'd';
    }

    function _notify(msg, type) {
        if (window.huntarrUI && window.huntarrUI.showNotification) {
            window.huntarrUI.showNotification(msg, type || 'info');
        } else {
            console.log('[ImportLists]', msg);
        }
    }

    function _bindClick(id, fn) {
        var el = document.getElementById(id);
        if (el) el.onclick = fn;
    }

    // Auto-init when DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() { window.ImportLists.init(); });
    } else {
        window.ImportLists.init();
    }

})();
