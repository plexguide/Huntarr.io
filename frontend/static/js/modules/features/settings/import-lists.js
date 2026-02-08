/**
 * Import Lists (Movie Hunt) — card grid, add/edit modals, sync.
 * Attaches to window.ImportLists. Load after settings core.
 */
(function() {
    'use strict';

    var listTypes = null; // cached from API
    var currentEditId = null;
    var selectedType = null;

    window.ImportLists = {

        // ---------------------------------------------------------------
        // Refresh / render
        // ---------------------------------------------------------------
        refreshList: function() {
            if (window.MovieHuntInstanceDropdown && document.getElementById('settings-import-lists-instance-select') && !window.ImportLists._instanceDropdownAttached) {
                window.MovieHuntInstanceDropdown.attach('settings-import-lists-instance-select', function() { window.ImportLists.refreshList(); });
                window.ImportLists._instanceDropdownAttached = true;
            }
            var gridEl = document.getElementById('import-lists-grid');
            if (!gridEl) return;

            fetch('./api/movie-hunt/import-lists')
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

                    // Add card always at end
                    html += '<div class="add-instance-card add-import-list-card" id="import-lists-add-card" data-app-type="import-list">' +
                        '<div class="add-icon"><i class="fas fa-plus-circle"></i></div>' +
                        '<div class="add-text">Add Import List</div></div>';

                    gridEl.innerHTML = html;
                    window.ImportLists._bindCardButtons();
                })
                .catch(function(e) {
                    console.error('[ImportLists] Failed to load:', e);
                    gridEl.innerHTML =
                        '<p style="color: #ef4444; margin: 0 0 12px 0;">Failed to load import lists.</p>' +
                        '<div class="add-instance-card add-import-list-card" id="import-lists-add-card" data-app-type="import-list">' +
                        '<div class="add-icon"><i class="fas fa-plus-circle"></i></div>' +
                        '<div class="add-text">Add Import List</div></div>';
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
            fetch('./api/movie-hunt/import-lists/' + listId + '/sync', { method: 'POST' })
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
            fetch('./api/movie-hunt/import-lists/sync-all', { method: 'POST' })
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
            fetch('./api/movie-hunt/import-lists/' + listId + '/toggle', { method: 'POST' })
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

            fetch('./api/movie-hunt/import-lists', {
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
            // Fetch current data
            fetch('./api/movie-hunt/import-lists')
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

            fetch('./api/movie-hunt/import-lists/' + currentEditId, {
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
        }
    };

    // -------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------

    function _doDelete(listId) {
        fetch('./api/movie-hunt/import-lists/' + listId, { method: 'DELETE' })
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
        fetch('./api/movie-hunt/import-lists/types')
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
            html += _fieldInput('client_id', 'Trakt Client ID', s.client_id || '', 'From trakt.tv/oauth/applications');
            html += _fieldInput('client_secret', 'Trakt Client Secret', s.client_secret || '', 'From your Trakt app', 'password');
            if (subtypeId === 'watchlist' || subtypeId === 'custom') {
                html += '<div class="import-list-form-group">' +
                    '<label>Trakt Authorization</label>' +
                    '<button type="button" class="btn-trakt-auth" id="' + containerId + '-trakt-auth-btn">' +
                        '<i class="fas fa-sign-in-alt"></i> Authorize with Trakt' +
                    '</button>' +
                    '<span class="trakt-auth-status" id="' + containerId + '-trakt-status">' +
                        (s.access_token && s.access_token !== '••••••••' ? '<i class="fas fa-check-circle" style="color:#22c55e"></i> Authorized' : '<i class="fas fa-times-circle" style="color:#ef4444"></i> Not authorized') +
                    '</span>' +
                    '<input type="hidden" class="dynamic-field" data-field="access_token" value="' + _esc(s.access_token || '') + '">' +
                    '<input type="hidden" class="dynamic-field" data-field="refresh_token" value="' + _esc(s.refresh_token || '') + '">' +
                    '<input type="hidden" class="dynamic-field" data-field="expires_at" value="' + (s.expires_at || 0) + '">' +
                '</div>';
            }
            if (subtypeId === 'watchlist') {
                html += _fieldInput('username', 'Username', s.username || '', 'Trakt username (or leave blank for "me")');
            }
            if (subtypeId === 'custom') {
                html += _fieldInput('username', 'Username', s.username || '', 'Trakt username');
                html += _fieldInput('list_name', 'List Name', s.list_name || '', 'Name of the custom list');
            }
            html += _fieldInput('limit', 'Max Items', s.limit || '100', '1-500', 'number');
        } else if (typeId === 'rss') {
            html += _fieldInput('url', 'RSS Feed URL', s.url || '', 'https://example.com/feed.rss');
        } else if (typeId === 'stevenlu') {
            html += _fieldInput('url', 'JSON Feed URL', s.url || 'https://popular-movies-data.stevenlu.com/movies.json', 'StevenLu JSON URL');
        } else if (typeId === 'plex') {
            html += '<div class="import-list-form-group">' +
                '<label>Plex Authorization</label>' +
                '<button type="button" class="btn-plex-auth" id="' + containerId + '-plex-auth-btn">' +
                    '<i class="fas fa-sign-in-alt"></i> Sign in with Plex' +
                '</button>' +
                '<span class="plex-auth-status" id="' + containerId + '-plex-status">' +
                    (s.access_token && s.access_token !== '••••••••' ? '<i class="fas fa-check-circle" style="color:#22c55e"></i> Signed in' : '<i class="fas fa-times-circle" style="color:#ef4444"></i> Not signed in') +
                '</span>' +
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

    function _startTraktOAuth(containerId) {
        var clientIdEl = document.querySelector('#' + containerId + ' [data-field="client_id"]');
        var clientSecretEl = document.querySelector('#' + containerId + ' [data-field="client_secret"]');
        var clientId = clientIdEl ? clientIdEl.value.trim() : '';
        var clientSecret = clientSecretEl ? clientSecretEl.value.trim() : '';

        if (!clientId) { _notify('Enter your Trakt Client ID first', 'error'); return; }
        if (!clientSecret) { _notify('Enter your Trakt Client Secret first', 'error'); return; }

        // Get auth URL
        fetch('./api/movie-hunt/import-lists/trakt/auth-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ client_id: clientId, redirect_uri: 'urn:ietf:wg:oauth:2.0:oob' })
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (!data.success) { _notify(data.error || 'Failed to get auth URL', 'error'); return; }

            // Open in new window
            window.open(data.auth_url, '_blank');

            // Prompt for code
            var code = prompt('After authorizing on Trakt, paste the PIN code here:');
            if (!code || !code.trim()) return;

            // Exchange code
            fetch('./api/movie-hunt/import-lists/trakt/exchange-code', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    code: code.trim(),
                    client_id: clientId,
                    client_secret: clientSecret,
                    redirect_uri: 'urn:ietf:wg:oauth:2.0:oob'
                })
            })
            .then(function(r) { return r.json(); })
            .then(function(tokenData) {
                if (tokenData.success) {
                    // Store tokens in hidden fields
                    var atEl = document.querySelector('#' + containerId + ' [data-field="access_token"]');
                    var rtEl = document.querySelector('#' + containerId + ' [data-field="refresh_token"]');
                    var exEl = document.querySelector('#' + containerId + ' [data-field="expires_at"]');
                    if (atEl) atEl.value = tokenData.access_token;
                    if (rtEl) rtEl.value = tokenData.refresh_token;
                    if (exEl) exEl.value = tokenData.expires_at;

                    var status = document.getElementById(containerId + '-trakt-status');
                    if (status) status.innerHTML = '<i class="fas fa-check-circle" style="color:#22c55e"></i> Authorized';
                    _notify('Trakt authorized!', 'success');
                } else {
                    _notify('Trakt auth failed: ' + (tokenData.error || ''), 'error');
                }
            })
            .catch(function(e) { _notify('Trakt auth error: ' + e, 'error'); });
        })
        .catch(function(e) { _notify('Error: ' + e, 'error'); });
    }

    function _startPlexOAuth(containerId) {
        // Use existing Plex auth flow if available
        if (window.PlexAuth && typeof window.PlexAuth.startAuth === 'function') {
            window.PlexAuth.startAuth(function(token) {
                var atEl = document.querySelector('#' + containerId + ' [data-field="access_token"]');
                if (atEl) atEl.value = token;
                var status = document.getElementById(containerId + '-plex-status');
                if (status) status.innerHTML = '<i class="fas fa-check-circle" style="color:#22c55e"></i> Signed in';
                _notify('Plex signed in!', 'success');
            });
            return;
        }

        // Fallback: prompt for token
        var token = prompt('Enter your Plex token (find it at plex.tv/devices.xml):');
        if (!token || !token.trim()) return;
        var atEl = document.querySelector('#' + containerId + ' [data-field="access_token"]');
        if (atEl) atEl.value = token.trim();
        var status = document.getElementById(containerId + '-plex-status');
        if (status) status.innerHTML = '<i class="fas fa-check-circle" style="color:#22c55e"></i> Signed in';
        _notify('Plex token set!', 'success');
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
