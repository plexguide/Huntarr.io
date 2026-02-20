/**
 * Huntarr Notifications — Modern multi-provider notification management
 *
 * Features:
 * - Provider grid for adding new connections
 * - Per-connection app/instance scope (cascading dropdowns)
 * - Grouped connection list organized by app type
 * - Test button in modal and in connection list
 * - Trigger checkboxes per connection
 */

(function () {
    'use strict';

    // ------------------------------------------------------------------
    // State
    // ------------------------------------------------------------------
    var providerMeta = {};
    var triggerKeys = [];
    var defaultTriggers = {};
    var connections = [];
    var editingId = null;
    var editingProvider = null;

    // Movie Hunt and TV Hunt instances (loaded from API)
    var movieHuntInstances = [];
    var tvHuntInstances = [];

    // App settings cache (for instance names)
    var appSettingsCache = {};

    var TRIGGER_LABELS = {
        on_grab: 'On Grab',
        on_import: 'On Import',
        on_upgrade: 'On Upgrade',
        on_missing: 'On Missing',
        on_rename: 'On Rename',
        on_delete: 'On Delete',
        on_request: 'On Request',
        on_health_issue: 'On Health Issue',
        on_app_update: 'On App Update',
        on_manual_required: 'On Manual Required'
    };

    // App type display info
    var APP_TYPES = [
        { key: 'all', label: 'All Apps', icon: 'fas fa-layer-group', color: '#818cf8' },
        { key: 'movie_hunt', label: 'Movie Hunt', icon: 'fas fa-film', color: '#f59e0b' },
        { key: 'tv_hunt', label: 'TV Hunt', icon: 'fas fa-tv', color: '#0ea5e9' },
        { key: 'sonarr', label: 'Sonarr', icon: 'fas fa-tv', color: '#60a5fa' },
        { key: 'radarr', label: 'Radarr', icon: 'fas fa-video', color: '#f97316' },
        { key: 'lidarr', label: 'Lidarr', icon: 'fas fa-music', color: '#34d399' },
        { key: 'readarr', label: 'Readarr', icon: 'fas fa-book', color: '#a78bfa' },
        { key: 'whisparr', label: 'Whisparr', icon: 'fas fa-microphone', color: '#f472b6' },
        { key: 'eros', label: 'Eros', icon: 'fas fa-heart', color: '#fb7185' }
    ];

    function getAppInfo(key) {
        for (var i = 0; i < APP_TYPES.length; i++) {
            if (APP_TYPES[i].key === key) return APP_TYPES[i];
        }
        return { key: key, label: key, icon: 'fas fa-bell', color: '#64748b' };
    }

    // ------------------------------------------------------------------
    // Initialization
    // ------------------------------------------------------------------

    window.SettingsForms = window.SettingsForms || {};

    window.SettingsForms.generateNotificationsForm = function (container, settings) {
        initNotifications();
    };

    window.SettingsForms.setupNotificationsManualSave = function () {};

    function initNotifications() {
        if (window._notifInitialized) return;
        window._notifInitialized = true;

        Promise.all([
            loadProviders(),
            loadAppData()
        ])
        .then(function () { return loadConnections(); })
        .then(function () {
            renderProviderGrid();
            renderConnections();
            bindModalEvents();
        })
        .catch(function (err) {
            console.error('[Notifications] Init error:', err);
        });
    }

    // ------------------------------------------------------------------
    // API calls
    // ------------------------------------------------------------------

    function loadProviders() {
        return HuntarrUtils.fetchWithTimeout('./api/notifications/providers')
            .then(function (r) { return r.json(); })
            .then(function (data) {
                providerMeta = data.providers || {};
                triggerKeys = data.trigger_keys || [];
                defaultTriggers = data.default_triggers || {};
            });
    }

    function loadAppData() {
        return Promise.all([
            HuntarrUtils.fetchWithTimeout('./api/settings').then(function (r) { return r.json(); }).catch(function () { return {}; }),
            HuntarrUtils.fetchWithTimeout('./api/movie-hunt/instances').then(function (r) { return r.json(); }).catch(function () { return { instances: [] }; }),
            HuntarrUtils.fetchWithTimeout('./api/tv-hunt/instances').then(function (r) { return r.json(); }).catch(function () { return { instances: [] }; })
        ]).then(function (results) {
            var settings = results[0];
            var mhData = results[1];
            var thData = results[2];

            movieHuntInstances = Array.isArray(mhData.instances) ? mhData.instances : [];
            tvHuntInstances = Array.isArray(thData.instances) ? thData.instances : [];

            var appTypes = ['sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros'];
            appTypes.forEach(function (at) {
                if (settings[at] && Array.isArray(settings[at].instances)) {
                    appSettingsCache[at] = settings[at].instances;
                }
            });
        });
    }

    function loadConnections() {
        return HuntarrUtils.fetchWithTimeout('./api/notifications/connections')
            .then(function (r) { return r.json(); })
            .then(function (data) {
                connections = data.connections || [];
            });
    }

    function apiSaveConnection(payload) {
        var method = payload.id ? 'PUT' : 'POST';
        var url = payload.id
            ? './api/notifications/connections/' + payload.id
            : './api/notifications/connections';

        return HuntarrUtils.fetchWithTimeout(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }).then(function (r) { return r.json(); });
    }

    function apiDeleteConnection(connId) {
        return HuntarrUtils.fetchWithTimeout('./api/notifications/connections/' + connId, {
            method: 'DELETE'
        }).then(function (r) { return r.json(); });
    }

    function apiTestConnection(connId) {
        return HuntarrUtils.fetchWithTimeout('./api/notifications/connections/' + connId + '/test', {
            method: 'POST'
        }).then(function (r) { return r.json(); });
    }

    // ------------------------------------------------------------------
    // Render — Provider Grid
    // ------------------------------------------------------------------

    function renderProviderGrid() {
        var grid = document.getElementById('providerGrid');
        if (!grid) return;
        grid.innerHTML = '';

        var order = ['discord', 'telegram', 'slack', 'pushover', 'pushbullet', 'email', 'gotify', 'ntfy', 'lunasea', 'notifiarr', 'webhook', 'apprise'];

        order.forEach(function (key) {
            var meta = providerMeta[key];
            if (!meta) return;

            var card = document.createElement('div');
            card.className = 'notif-provider-card';
            card.innerHTML =
                '<div class="notif-provider-card-icon" style="background:' + meta.color + '">' +
                    '<i class="' + meta.icon + '"></i>' +
                '</div>' +
                '<div class="notif-provider-card-name">' + meta.name + '</div>';

            card.addEventListener('click', function () {
                openModal(key, null);
            });

            grid.appendChild(card);
        });
    }

    // ------------------------------------------------------------------
    // Render — Grouped Connection List
    // ------------------------------------------------------------------

    function renderConnections() {
        var container = document.getElementById('connectionList');
        var empty = document.getElementById('noConnectionsMessage');
        var countEl = document.getElementById('connectionCount');
        if (!container || !empty) return;

        container.innerHTML = '';

        if (connections.length === 0) {
            container.style.display = 'none';
            empty.style.display = 'block';
            if (countEl) countEl.textContent = '';
            return;
        }

        container.style.display = 'flex';
        empty.style.display = 'none';
        if (countEl) countEl.textContent = connections.length + ' connection' + (connections.length !== 1 ? 's' : '');

        // Group by app_scope
        var groups = {};
        connections.forEach(function (conn) {
            var scope = conn.app_scope || 'all';
            if (!groups[scope]) groups[scope] = [];
            groups[scope].push(conn);
        });

        // Render in APP_TYPES order
        var orderedKeys = APP_TYPES.map(function (a) { return a.key; });
        // Add any unexpected keys
        Object.keys(groups).forEach(function (k) {
            if (orderedKeys.indexOf(k) === -1) orderedKeys.push(k);
        });

        orderedKeys.forEach(function (appKey) {
            var list = groups[appKey];
            if (!list || list.length === 0) return;

            var appInfo = getAppInfo(appKey);

            var groupEl = document.createElement('div');
            groupEl.className = 'notif-group';

            // Group header
            var header = document.createElement('div');
            header.className = 'notif-group-header';
            header.innerHTML =
                '<div class="notif-group-header-icon" style="background:' + appInfo.color + '">' +
                    '<i class="' + appInfo.icon + '"></i>' +
                '</div>' +
                '<span class="notif-group-header-label">' + appInfo.label + '</span>' +
                '<span class="notif-group-header-count">' + list.length + '</span>';

            groupEl.appendChild(header);

            // Group body
            var body = document.createElement('div');
            body.className = 'notif-group-body';

            list.forEach(function (conn) {
                body.appendChild(renderConnectionItem(conn));
            });

            groupEl.appendChild(body);
            container.appendChild(groupEl);
        });
    }

    function renderConnectionItem(conn) {
        var meta = providerMeta[conn.provider] || {};
        var color = meta.color || '#64748b';
        var icon = meta.icon || 'fas fa-bell';
        var providerName = meta.name || conn.provider;

        var triggers = conn.triggers || {};
        var activeCount = 0;
        for (var k in triggers) { if (triggers[k]) activeCount++; }

        var statusDot = conn.enabled ? 'active' : 'disabled';
        var statusText = conn.enabled ? 'Enabled' : 'Disabled';

        // Instance scope label
        var scopeLabel = '';
        if (conn.instance_scope && conn.instance_scope !== 'all') {
            scopeLabel = resolveInstanceName(conn.app_scope, conn.instance_scope);
        } else {
            scopeLabel = 'All Instances';
        }

        var el = document.createElement('div');
        el.className = 'notif-connection-item';
        el.innerHTML =
            '<div class="notif-connection-left">' +
                '<div class="notif-connection-icon" style="background:' + color + '">' +
                    '<i class="' + icon + '"></i>' +
                '</div>' +
                '<div class="notif-connection-info">' +
                    '<div class="notif-connection-name">' + escapeHtml(conn.name || providerName) + '</div>' +
                    '<div class="notif-connection-meta">' +
                        '<span class="notif-connection-provider-badge"><i class="' + icon + '" style="font-size:10px"></i> ' + providerName + '</span>' +
                        '<span class="notif-connection-scope-badge"><i class="fas fa-filter" style="font-size:9px"></i> ' + escapeHtml(scopeLabel) + '</span>' +
                        '<span class="notif-connection-status"><span class="notif-status-dot ' + statusDot + '"></span> ' + statusText + '</span>' +
                        '<span>' + activeCount + ' trigger' + (activeCount !== 1 ? 's' : '') + '</span>' +
                    '</div>' +
                '</div>' +
            '</div>' +
            '<div class="notif-connection-actions">' +
                '<button class="notif-btn-icon test-btn" data-id="' + conn.id + '" title="Send Test"><i class="fas fa-paper-plane"></i></button>' +
                '<button class="notif-btn-icon edit-btn" data-id="' + conn.id + '" title="Edit"><i class="fas fa-pen"></i></button>' +
                '<button class="notif-btn-icon delete-btn" data-id="' + conn.id + '" title="Delete"><i class="fas fa-trash"></i></button>' +
            '</div>';

        el.querySelector('.test-btn').addEventListener('click', function (e) {
            e.stopPropagation();
            handleTest(conn.id, this);
        });

        el.querySelector('.edit-btn').addEventListener('click', function (e) {
            e.stopPropagation();
            openModal(conn.provider, conn);
        });

        el.querySelector('.delete-btn').addEventListener('click', function (e) {
            e.stopPropagation();
            handleDelete(conn.id, conn.name || providerName);
        });

        return el;
    }

    function resolveInstanceName(appScope, instanceId) {
        if (appScope === 'movie_hunt') {
            for (var i = 0; i < movieHuntInstances.length; i++) {
                if (String(movieHuntInstances[i].id) === String(instanceId)) {
                    return movieHuntInstances[i].name || 'Instance ' + instanceId;
                }
            }
            return 'Instance ' + instanceId;
        }
        if (appScope === 'tv_hunt') {
            for (var t = 0; t < tvHuntInstances.length; t++) {
                if (String(tvHuntInstances[t].id) === String(instanceId)) {
                    return tvHuntInstances[t].name || 'Instance ' + instanceId;
                }
            }
            return 'Instance ' + instanceId;
        }
        var instances = appSettingsCache[appScope] || [];
        for (var j = 0; j < instances.length; j++) {
            var inst = instances[j];
            if (inst && (inst.instance_id === instanceId || String(j) === instanceId)) {
                return inst.name || inst.instance_name || 'Instance ' + (j + 1);
            }
        }
        return 'Instance ' + instanceId;
    }

    // ------------------------------------------------------------------
    // Modal — Open / Close
    // ------------------------------------------------------------------

    function openModal(providerKey, existingConn) {
        var overlay = document.getElementById('notifModalOverlay');
        var body = document.getElementById('notifModalBody');
        var titleEl = document.getElementById('notifModalTitle');
        var iconEl = document.getElementById('notifModalIcon');
        var iconI = document.getElementById('notifModalIconI');
        var testBtn = document.getElementById('notifModalTestBtn');

        if (!overlay || !body) return;

        var meta = providerMeta[providerKey] || {};
        editingProvider = providerKey;
        editingId = existingConn ? existingConn.id : null;

        // Header
        titleEl.textContent = existingConn ? 'Edit ' + meta.name : 'Add ' + (meta.name || providerKey);
        iconEl.style.background = meta.color || '#64748b';
        iconI.className = meta.icon || 'fas fa-bell';

        // Test button availability (only for existing connections)
        if (testBtn) {
            testBtn.disabled = !editingId;
            testBtn.style.display = editingId ? '' : 'none';
        }

        var html = '';

        // ---- Connection Name + Enabled ----
        html += '<div class="notif-name-group">';
        html += '<div class="notif-form-group" style="margin-bottom:10px">';
        html += '<label>Connection Name <span class="required">*</span></label>';
        html += '<input type="text" id="notifFieldName" placeholder="My ' + (meta.name || '') + ' Notification" value="' + escapeAttr(existingConn ? existingConn.name : '') + '">';
        html += '</div>';
        html += '<div class="notif-checkbox-row">';
        html += '<input type="checkbox" id="notifFieldEnabled" ' + (existingConn ? (existingConn.enabled ? 'checked' : '') : 'checked') + '>';
        html += '<label for="notifFieldEnabled" style="margin-bottom:0;cursor:pointer">Enabled</label>';
        html += '</div>';
        html += '</div>';

        // ---- App / Instance Scope ----
        html += '<div class="notif-scope-row">';
        html += '<div class="notif-form-group" style="margin-bottom:0">';
        html += '<label>App Type</label>';
        html += '<select id="notifScopeApp">';
        APP_TYPES.forEach(function (app) {
            var sel = (existingConn && existingConn.app_scope === app.key) ? ' selected' : (!existingConn && app.key === 'all' ? ' selected' : '');
            html += '<option value="' + app.key + '"' + sel + '>' + app.label + '</option>';
        });
        html += '</select>';
        html += '</div>';
        html += '<div class="notif-form-group" style="margin-bottom:0">';
        html += '<label>Instance</label>';
        html += '<select id="notifScopeInstance"><option value="all">All Instances</option></select>';
        html += '</div>';
        html += '</div>';

        // ---- Provider-specific fields ----
        var fields = meta.fields || [];
        var existingSettings = (existingConn && existingConn.settings) || {};

        fields.forEach(function (field) {
            html += '<div class="notif-form-group">';
            if (field.type === 'checkbox') {
                html += '<div class="notif-checkbox-row">';
                html += '<input type="checkbox" id="notifField_' + field.key + '" ' + (existingSettings[field.key] ? 'checked' : '') + '>';
                html += '<label for="notifField_' + field.key + '" style="margin-bottom:0;cursor:pointer">' + field.label + '</label>';
                html += '</div>';
            } else {
                html += '<label>' + field.label;
                if (field.required) html += ' <span class="required">*</span>';
                html += '</label>';

                if (field.type === 'select') {
                    html += '<select id="notifField_' + field.key + '">';
                    (field.options || []).forEach(function (opt) {
                        var sel = (String(existingSettings[field.key]) === String(opt.value)) ? ' selected' : '';
                        html += '<option value="' + escapeAttr(opt.value) + '"' + sel + '>' + opt.label + '</option>';
                    });
                    html += '</select>';
                } else if (field.type === 'textarea') {
                    html += '<textarea id="notifField_' + field.key + '" placeholder="' + escapeAttr(field.placeholder || '') + '">' + escapeHtml(existingSettings[field.key] || '') + '</textarea>';
                } else {
                    var inputType = field.type === 'password' ? 'password' : (field.type === 'number' ? 'number' : 'text');
                    html += '<input type="' + inputType + '" id="notifField_' + field.key + '" placeholder="' + escapeAttr(field.placeholder || '') + '" value="' + escapeAttr(existingSettings[field.key] || '') + '">';
                }
            }
            if (field.help) html += '<div class="notif-form-help">' + field.help + '</div>';
            html += '</div>';
        });

        // ---- Notification Triggers ----
        html += '<div class="notif-triggers-section">';
        html += '<div class="notif-triggers-title">Notification Triggers</div>';
        html += '<div class="notif-triggers-grid">';

        var existingTriggers = (existingConn && existingConn.triggers) || defaultTriggers;
        var displayTriggers = triggerKeys.filter(function (k) { return k !== 'on_test'; });

        displayTriggers.forEach(function (key) {
            var label = TRIGGER_LABELS[key] || key.replace('on_', '').replace(/_/g, ' ');
            label = label.replace(/\b\w/g, function (c) { return c.toUpperCase(); });
            var checked = existingTriggers[key] ? 'checked' : (existingTriggers[key] === undefined && defaultTriggers[key] ? 'checked' : '');

            html += '<label class="notif-trigger-item">';
            html += '<input type="checkbox" id="notifTrigger_' + key + '" ' + checked + '>';
            html += '<span class="notif-trigger-label">' + label + '</span>';
            html += '</label>';
        });
        html += '</div></div>';

        // ---- Include options ----
        html += '<div class="notif-options-row">';
        html += '<label><input type="checkbox" id="notifOptAppName" ' + (existingConn ? (existingConn.include_app_name ? 'checked' : '') : 'checked') + '> Include App Name</label>';
        html += '<label><input type="checkbox" id="notifOptInstance" ' + (existingConn ? (existingConn.include_instance_name ? 'checked' : '') : 'checked') + '> Include Instance Name</label>';
        html += '</div>';

        body.innerHTML = html;

        // Wire up cascading dropdowns
        var appSelect = document.getElementById('notifScopeApp');
        var instSelect = document.getElementById('notifScopeInstance');
        if (appSelect && instSelect) {
            appSelect.addEventListener('change', function () {
                populateInstanceDropdown(appSelect.value, instSelect, null);
            });
            // Initial population
            var existingInstScope = existingConn ? existingConn.instance_scope : 'all';
            populateInstanceDropdown(appSelect.value, instSelect, existingInstScope);
        }

        // Show modal
        overlay.classList.add('active');
        document.body.style.overflow = 'hidden';

        setTimeout(function () {
            var first = body.querySelector('input[type="text"], input[type="password"]');
            if (first) first.focus();
        }, 200);
    }

    function populateInstanceDropdown(appKey, selectEl, preselect) {
        selectEl.innerHTML = '<option value="all">All Instances</option>';

        if (appKey === 'all') {
            selectEl.disabled = true;
            return;
        }

        selectEl.disabled = false;

        var instances = [];

        if (appKey === 'movie_hunt') {
            instances = movieHuntInstances.map(function (inst) {
                return { id: String(inst.id), name: inst.name || 'Instance ' + inst.id };
            });
        } else if (appKey === 'tv_hunt') {
            instances = tvHuntInstances.map(function (inst) {
                return { id: String(inst.id), name: inst.name || 'Instance ' + inst.id };
            });
        } else {
            var appInsts = appSettingsCache[appKey] || [];
            instances = appInsts.map(function (inst, idx) {
                return {
                    id: inst.instance_id || String(idx),
                    name: inst.name || inst.instance_name || 'Instance ' + (idx + 1)
                };
            });
        }

        instances.forEach(function (inst) {
            var opt = document.createElement('option');
            opt.value = inst.id;
            opt.textContent = inst.name;
            if (preselect && preselect === inst.id) opt.selected = true;
            selectEl.appendChild(opt);
        });
    }

    function closeModal() {
        var overlay = document.getElementById('notifModalOverlay');
        if (overlay) {
            overlay.classList.remove('active');
            document.body.style.overflow = '';
        }
        editingId = null;
        editingProvider = null;
    }

    function bindModalEvents() {
        var overlay = document.getElementById('notifModalOverlay');
        var closeBtn = document.getElementById('notifModalClose');
        var cancelBtn = document.getElementById('notifModalCancelBtn');
        var saveBtn = document.getElementById('notifModalSaveBtn');
        var testBtn = document.getElementById('notifModalTestBtn');

        if (closeBtn) closeBtn.addEventListener('click', closeModal);
        if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

        if (overlay) {
            overlay.addEventListener('click', function (e) {
                if (e.target === overlay) closeModal();
            });
        }

        if (saveBtn) saveBtn.addEventListener('click', handleSave);
        if (testBtn) testBtn.addEventListener('click', handleModalTest);
    }

    // ------------------------------------------------------------------
    // Modal — Save
    // ------------------------------------------------------------------

    function handleSave() {
        var meta = providerMeta[editingProvider] || {};
        var fields = meta.fields || [];

        var nameEl = document.getElementById('notifFieldName');
        var name = nameEl ? nameEl.value.trim() : '';
        if (!name) name = meta.name || editingProvider;

        var enabled = document.getElementById('notifFieldEnabled');
        var isEnabled = enabled ? enabled.checked : true;

        // Scope
        var appScopeEl = document.getElementById('notifScopeApp');
        var instScopeEl = document.getElementById('notifScopeInstance');
        var appScope = appScopeEl ? appScopeEl.value : 'all';
        var instanceScope = instScopeEl ? instScopeEl.value : 'all';

        // Provider settings
        var settings = {};
        var missingRequired = false;

        fields.forEach(function (field) {
            var el = document.getElementById('notifField_' + field.key);
            if (!el) return;
            if (field.type === 'checkbox') {
                settings[field.key] = el.checked;
            } else {
                settings[field.key] = el.value.trim();
            }
            if (field.required && !settings[field.key]) {
                missingRequired = true;
                el.style.borderColor = '#f87171';
            } else if (el.style) {
                el.style.borderColor = '';
            }
        });

        if (missingRequired) {
            notify('Please fill in all required fields', 'error');
            return;
        }

        // Triggers
        var triggers = {};
        var displayTriggers = triggerKeys.filter(function (k) { return k !== 'on_test'; });
        displayTriggers.forEach(function (key) {
            var el = document.getElementById('notifTrigger_' + key);
            triggers[key] = el ? el.checked : false;
        });

        var inclApp = document.getElementById('notifOptAppName');
        var inclInst = document.getElementById('notifOptInstance');

        var payload = {
            name: name,
            provider: editingProvider,
            enabled: isEnabled,
            settings: settings,
            triggers: triggers,
            include_app_name: inclApp ? inclApp.checked : true,
            include_instance_name: inclInst ? inclInst.checked : true,
            app_scope: appScope,
            instance_scope: instanceScope
        };

        if (editingId) payload.id = editingId;

        var saveBtn = document.getElementById('notifModalSaveBtn');
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
        }

        apiSaveConnection(payload)
            .then(function (data) {
                if (data.error) {
                    notify('Failed to save: ' + data.error, 'error');
                    return;
                }
                notify('Connection saved successfully', 'success');

                // If new, store the id so the Test button works
                if (!editingId && data.id) {
                    editingId = data.id;
                    var testBtn = document.getElementById('notifModalTestBtn');
                    if (testBtn) { testBtn.disabled = false; testBtn.style.display = ''; }
                }

                return loadConnections().then(renderConnections);
            })
            .catch(function (err) {
                notify('Failed to save connection', 'error');
                console.error('[Notifications] Save error:', err);
            })
            .finally(function () {
                if (saveBtn) {
                    saveBtn.disabled = false;
                    saveBtn.innerHTML = '<i class="fas fa-save"></i> Save';
                }
            });
    }

    // ------------------------------------------------------------------
    // Actions — Test / Delete
    // ------------------------------------------------------------------

    function handleModalTest() {
        if (!editingId) {
            notify('Save the connection first before testing', 'info');
            return;
        }
        var testBtn = document.getElementById('notifModalTestBtn');
        if (!testBtn) return;

        testBtn.disabled = true;
        testBtn.classList.add('testing');
        testBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Testing...';

        apiTestConnection(editingId)
            .then(function (data) {
                if (data.success) {
                    notify('Test notification sent!', 'success');
                    testBtn.innerHTML = '<i class="fas fa-check"></i> Sent!';
                    setTimeout(function () {
                        testBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Test';
                    }, 2500);
                } else {
                    notify('Test failed: ' + (data.error || 'Unknown error'), 'error');
                    testBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Test';
                }
            })
            .catch(function () {
                notify('Test failed: Network error', 'error');
                testBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Test';
            })
            .finally(function () {
                testBtn.disabled = false;
                testBtn.classList.remove('testing');
            });
    }

    function handleTest(connId, btnEl) {
        var iconEl = btnEl.querySelector('i');
        var origClass = iconEl.className;
        iconEl.className = 'fas fa-spinner fa-spin';
        btnEl.classList.add('testing');

        apiTestConnection(connId)
            .then(function (data) {
                if (data.success) {
                    notify('Test notification sent!', 'success');
                    iconEl.className = 'fas fa-check';
                    setTimeout(function () { iconEl.className = origClass; }, 2000);
                } else {
                    notify('Test failed: ' + (data.error || 'Unknown error'), 'error');
                    iconEl.className = origClass;
                }
            })
            .catch(function () {
                notify('Test failed: Network error', 'error');
                iconEl.className = origClass;
            })
            .finally(function () {
                btnEl.classList.remove('testing');
            });
    }

    function handleDelete(connId, connName) {
        if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
            window.HuntarrConfirm.show({
                title: 'Delete Connection',
                message: 'Are you sure you want to delete "' + connName + '"?',
                confirmLabel: 'Delete',
                onConfirm: function () { doDelete(connId); }
            });
        } else {
            if (confirm('Delete "' + connName + '"?')) {
                doDelete(connId);
            }
        }
    }

    function doDelete(connId) {
        apiDeleteConnection(connId)
            .then(function (data) {
                if (data.error) {
                    notify('Failed to delete: ' + data.error, 'error');
                    return;
                }
                notify('Connection deleted', 'success');
                return loadConnections().then(renderConnections);
            })
            .catch(function () {
                notify('Failed to delete connection', 'error');
            });
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    function notify(msg, type) {
        if (window.huntarrUI && window.huntarrUI.showNotification) {
            window.huntarrUI.showNotification(msg, type || 'info');
        } else {
            alert(msg);
        }
    }

    function escapeHtml(s) {
        if (!s) return '';
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(s));
        return div.innerHTML;
    }

    function escapeAttr(s) {
        if (!s) return '';
        return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
})();
