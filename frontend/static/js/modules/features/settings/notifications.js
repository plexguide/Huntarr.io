/**
 * Huntarr Notifications — Modern multi-provider notification management
 *
 * Manages notification connections (Discord, Slack, Telegram, etc.)
 * with per-connection trigger configuration.
 */

(function () {
    'use strict';

    // ------------------------------------------------------------------
    // State
    // ------------------------------------------------------------------
    let providerMeta = {};       // provider definitions from API
    let triggerKeys = [];
    let defaultTriggers = {};
    let connections = [];        // current connections from DB
    let editingId = null;        // null = new, number = editing
    let editingProvider = null;  // provider key when modal is open

    // Human-readable trigger labels
    var TRIGGER_LABELS = {
        on_grab:            'On Grab',
        on_import:          'On Import',
        on_upgrade:         'On Upgrade',
        on_missing:         'On Missing',
        on_rename:          'On Rename',
        on_delete:          'On Delete',
        on_health_issue:    'On Health Issue',
        on_app_update:      'On App Update',
        on_manual_required: 'On Manual Required',
    };

    // ------------------------------------------------------------------
    // Initialization
    // ------------------------------------------------------------------

    // The old generateNotificationsForm is replaced — we use direct init
    window.SettingsForms = window.SettingsForms || {};

    window.SettingsForms.generateNotificationsForm = function (container, settings) {
        // This is called by the existing settings loader.
        // We no longer generate a form; instead, init our notification UI.
        initNotifications();
    };

    // Also allow standalone initialization
    window.SettingsForms.setupNotificationsManualSave = function () {
        // No-op — the new system auto-saves per connection
    };

    function initNotifications() {
        if (window._notifInitialized) return;
        window._notifInitialized = true;

        loadProviders()
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
            body: JSON.stringify(payload),
        }).then(function (r) { return r.json(); });
    }

    function apiDeleteConnection(connId) {
        return HuntarrUtils.fetchWithTimeout('./api/notifications/connections/' + connId, {
            method: 'DELETE',
        }).then(function (r) { return r.json(); });
    }

    function apiTestConnection(connId) {
        return HuntarrUtils.fetchWithTimeout('./api/notifications/connections/' + connId + '/test', {
            method: 'POST',
        }).then(function (r) { return r.json(); });
    }

    // ------------------------------------------------------------------
    // Render — Provider Grid
    // ------------------------------------------------------------------

    function renderProviderGrid() {
        var grid = document.getElementById('providerGrid');
        if (!grid) return;
        grid.innerHTML = '';

        var order = ['discord', 'telegram', 'slack', 'pushover', 'pushbullet', 'email', 'notifiarr', 'webhook', 'apprise'];

        order.forEach(function (key) {
            var meta = providerMeta[key];
            if (!meta) return;

            var card = document.createElement('div');
            card.className = 'notif-provider-card';
            card.setAttribute('data-provider', key);
            card.innerHTML =
                '<div class="notif-provider-card-icon" style="background:' + meta.color + '">' +
                    '<i class="' + meta.icon + '"></i>' +
                '</div>' +
                '<div class="notif-provider-card-name">' + meta.name + '</div>' +
                '<div class="notif-provider-card-desc">' + meta.description + '</div>';

            card.addEventListener('click', function () {
                openModal(key, null);
            });

            grid.appendChild(card);
        });
    }

    // ------------------------------------------------------------------
    // Render — Connection List
    // ------------------------------------------------------------------

    function renderConnections() {
        var list = document.getElementById('connectionList');
        var empty = document.getElementById('noConnectionsMessage');
        var countEl = document.getElementById('connectionCount');
        if (!list || !empty) return;

        list.innerHTML = '';

        if (connections.length === 0) {
            list.style.display = 'none';
            empty.style.display = 'block';
            if (countEl) countEl.textContent = '';
            return;
        }

        list.style.display = 'flex';
        empty.style.display = 'none';
        if (countEl) countEl.textContent = connections.length + ' connection' + (connections.length !== 1 ? 's' : '');

        connections.forEach(function (conn) {
            var meta = providerMeta[conn.provider] || {};
            var color = meta.color || '#64748b';
            var icon = meta.icon || 'fas fa-bell';
            var providerName = meta.name || conn.provider;

            var triggers = conn.triggers || {};
            var activeCount = 0;
            for (var k in triggers) { if (triggers[k]) activeCount++; }

            var statusDot = conn.enabled ? 'active' : 'disabled';
            var statusText = conn.enabled ? 'Enabled' : 'Disabled';

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
                            '<span class="notif-connection-status"><span class="notif-status-dot ' + statusDot + '"></span> ' + statusText + '</span>' +
                            '<span>' + activeCount + ' trigger' + (activeCount !== 1 ? 's' : '') + '</span>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
                '<div class="notif-connection-actions">' +
                    '<button class="notif-btn-icon test-btn" data-id="' + conn.id + '" title="Test"><i class="fas fa-paper-plane"></i></button>' +
                    '<button class="notif-btn-icon edit-btn" data-id="' + conn.id + '" title="Edit"><i class="fas fa-pen"></i></button>' +
                    '<button class="notif-btn-icon delete-btn" data-id="' + conn.id + '" title="Delete"><i class="fas fa-trash"></i></button>' +
                '</div>';

            // Test button
            el.querySelector('.test-btn').addEventListener('click', function (e) {
                e.stopPropagation();
                handleTest(conn.id, this);
            });

            // Edit button
            el.querySelector('.edit-btn').addEventListener('click', function (e) {
                e.stopPropagation();
                openModal(conn.provider, conn);
            });

            // Delete button
            el.querySelector('.delete-btn').addEventListener('click', function (e) {
                e.stopPropagation();
                handleDelete(conn.id, conn.name || providerName);
            });

            list.appendChild(el);
        });
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
        var saveBtn = document.getElementById('notifModalSaveBtn');

        if (!overlay || !body) return;

        var meta = providerMeta[providerKey] || {};
        editingProvider = providerKey;
        editingId = existingConn ? existingConn.id : null;

        // Header
        titleEl.textContent = existingConn ? 'Edit ' + meta.name : 'Add ' + (meta.name || providerKey);
        iconEl.style.background = meta.color || '#64748b';
        iconI.className = meta.icon || 'fas fa-bell';

        // Build form
        var html = '';

        // Connection name
        html += '<div class="notif-name-group">';
        html += '<div class="notif-form-group">';
        html += '<label>Connection Name <span class="required">*</span></label>';
        html += '<input type="text" id="notifFieldName" placeholder="My ' + (meta.name || '') + ' Notification" value="' + escapeAttr(existingConn ? existingConn.name : '') + '">';
        html += '</div>';

        // Enabled toggle
        html += '<div class="notif-checkbox-row">';
        html += '<input type="checkbox" id="notifFieldEnabled" ' + (existingConn ? (existingConn.enabled ? 'checked' : '') : 'checked') + '>';
        html += '<label for="notifFieldEnabled" style="margin-bottom:0;cursor:pointer">Enabled</label>';
        html += '</div>';
        html += '</div>';

        // Provider-specific fields
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

            if (field.help) {
                html += '<div class="notif-form-help">' + field.help + '</div>';
            }
            html += '</div>';
        });

        // Notification Triggers
        html += '<div class="notif-triggers-section">';
        html += '<div class="notif-triggers-title">Notification Triggers</div>';
        html += '<div class="notif-triggers-grid">';

        var existingTriggers = (existingConn && existingConn.triggers) || defaultTriggers;

        // Filter out on_test from the displayed triggers
        var displayTriggers = triggerKeys.filter(function (k) { return k !== 'on_test'; });
        displayTriggers.forEach(function (key) {
            var label = TRIGGER_LABELS[key] || key.replace('on_', '').replace(/_/g, ' ');
            // capitalize first letter of each word
            label = label.replace(/\b\w/g, function (c) { return c.toUpperCase(); });
            var checked = existingTriggers[key] !== false && existingTriggers[key] !== undefined
                ? (existingTriggers[key] ? 'checked' : '')
                : (defaultTriggers[key] ? 'checked' : '');

            html += '<label class="notif-trigger-item">';
            html += '<input type="checkbox" id="notifTrigger_' + key + '" ' + checked + '>';
            html += '<span class="notif-trigger-label">' + label + '</span>';
            html += '</label>';
        });
        html += '</div></div>';

        // Include options
        html += '<div class="notif-options-row">';
        html += '<label><input type="checkbox" id="notifOptAppName" ' + (existingConn ? (existingConn.include_app_name ? 'checked' : '') : 'checked') + '> Include App Name</label>';
        html += '<label><input type="checkbox" id="notifOptInstance" ' + (existingConn ? (existingConn.include_instance_name ? 'checked' : '') : 'checked') + '> Include Instance Name</label>';
        html += '</div>';

        body.innerHTML = html;

        // Show
        overlay.classList.add('active');
        document.body.style.overflow = 'hidden';

        // Focus first field
        setTimeout(function () {
            var first = body.querySelector('input[type="text"], input[type="password"]');
            if (first) first.focus();
        }, 200);
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

        if (closeBtn) closeBtn.addEventListener('click', closeModal);
        if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

        if (overlay) {
            overlay.addEventListener('click', function (e) {
                if (e.target === overlay) closeModal();
            });
        }

        if (saveBtn) saveBtn.addEventListener('click', handleSave);
    }

    // ------------------------------------------------------------------
    // Modal — Save
    // ------------------------------------------------------------------

    function handleSave() {
        var meta = providerMeta[editingProvider] || {};
        var fields = meta.fields || [];

        // Gather name
        var nameEl = document.getElementById('notifFieldName');
        var name = nameEl ? nameEl.value.trim() : '';
        if (!name) {
            name = meta.name || editingProvider;
        }

        var enabled = document.getElementById('notifFieldEnabled');
        var isEnabled = enabled ? enabled.checked : true;

        // Gather provider settings
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

        // Gather triggers
        var triggers = {};
        var displayTriggers = triggerKeys.filter(function (k) { return k !== 'on_test'; });
        displayTriggers.forEach(function (key) {
            var el = document.getElementById('notifTrigger_' + key);
            triggers[key] = el ? el.checked : false;
        });

        // Include options
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
        };

        if (editingId) {
            payload.id = editingId;
        }

        // Disable save button
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
                closeModal();
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
                onConfirm: function () { doDelete(connId); },
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
