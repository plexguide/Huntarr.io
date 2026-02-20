/**
 * User Notifications — Connection-based notification management
 * Mirrors the admin notifications pattern (named connections, triggers, full CRUD).
 */

(function () {
    'use strict';

    var providerMeta = {};
    var triggerKeys = [];
    var triggerLabels = {};
    var defaultTriggers = {};
    var connections = [];
    var editingId = null;
    var editingProvider = null;
    var initialized = false;

    window.UserNotifications = {
        init: init,
        refresh: refresh
    };

    function init() {
        if (initialized) { refresh(); return; }
        initialized = true;
        Promise.all([loadProviders(), loadConnections()])
            .then(function () {
                renderProviderGrid();
                renderConnections();
                bindModalEvents();
            })
            .catch(function (err) {
                console.error('[UserNotifications] Init error:', err);
            });
    }

    function refresh() {
        loadConnections().then(renderConnections);
    }

    // ── API ──────────────────────────────────────────────────

    function loadProviders() {
        return fetch('./api/user-notifications/providers', { credentials: 'include' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                providerMeta = data.providers || {};
                triggerKeys = data.trigger_keys || [];
                triggerLabels = data.trigger_labels || {};
                defaultTriggers = data.default_triggers || {};
            });
    }

    function loadConnections() {
        return fetch('./api/user-notifications/connections', { credentials: 'include' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                connections = data.connections || [];
            });
    }

    function apiSave(payload) {
        var method = payload.id ? 'PUT' : 'POST';
        var url = payload.id
            ? './api/user-notifications/connections/' + payload.id
            : './api/user-notifications/connections';
        return fetch(url, {
            method: method,
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }).then(function (r) { return r.json(); });
    }

    function apiDelete(connId) {
        return fetch('./api/user-notifications/connections/' + connId, {
            method: 'DELETE',
            credentials: 'include'
        }).then(function (r) { return r.json(); });
    }

    function apiTest(connId) {
        return fetch('./api/user-notifications/connections/' + connId + '/test', {
            method: 'POST',
            credentials: 'include'
        }).then(function (r) { return r.json(); });
    }

    // ── Render Provider Grid ─────────────────────────────────

    function renderProviderGrid() {
        var grid = document.getElementById('userNotifProviderGrid');
        if (!grid) return;
        grid.innerHTML = '';

        var order = ['discord', 'telegram', 'slack', 'pushover', 'pushbullet', 'email',
                     'gotify', 'ntfy', 'lunasea', 'notifiarr', 'webhook', 'apprise'];

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

            card.addEventListener('click', function () { openModal(key, null); });
            grid.appendChild(card);
        });
    }

    // ── Render Connection List ───────────────────────────────

    function renderConnections() {
        var container = document.getElementById('userNotifList');
        var empty = document.getElementById('userNotifEmpty');
        var countEl = document.getElementById('userNotifCount');
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

        connections.forEach(function (conn) {
            container.appendChild(renderConnectionItem(conn));
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
                '<button class="notif-btn-icon test-btn" title="Send Test"><i class="fas fa-paper-plane"></i></button>' +
                '<button class="notif-btn-icon edit-btn" title="Edit"><i class="fas fa-pen"></i></button>' +
                '<button class="notif-btn-icon delete-btn" title="Delete"><i class="fas fa-trash"></i></button>' +
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

    // ── Modal ────────────────────────────────────────────────

    function openModal(providerKey, existingConn) {
        var overlay = document.getElementById('userNotifModalOverlay');
        var body = document.getElementById('userNotifModalBody');
        var titleEl = document.getElementById('userNotifModalTitle');
        var iconEl = document.getElementById('userNotifModalIcon');
        var iconI = document.getElementById('userNotifModalIconI');
        var testBtn = document.getElementById('userNotifModalTestBtn');
        if (!overlay || !body) return;

        var meta = providerMeta[providerKey] || {};
        editingProvider = providerKey;
        editingId = existingConn ? existingConn.id : null;

        titleEl.textContent = existingConn ? 'Edit ' + meta.name : 'Add ' + (meta.name || providerKey);
        iconEl.style.background = meta.color || '#64748b';
        iconI.className = meta.icon || 'fas fa-bell';

        if (testBtn) {
            testBtn.disabled = !editingId;
            testBtn.style.display = editingId ? '' : 'none';
        }

        var existingSettings = (existingConn && existingConn.settings) || {};
        var existingTriggers = (existingConn && existingConn.triggers) || defaultTriggers;
        var html = '';

        // Connection name + enabled
        html += '<div class="notif-name-group">';
        html += '<div class="notif-form-group" style="margin-bottom:10px">';
        html += '<label>Connection Name <span class="required">*</span></label>';
        html += '<input type="text" id="userNotifFieldName" placeholder="My ' + (meta.name || '') + ' Notification" value="' + escapeAttr(existingConn ? existingConn.name : '') + '">';
        html += '</div>';
        html += '<div class="notif-checkbox-row">';
        html += '<input type="checkbox" id="userNotifFieldEnabled" ' + (existingConn ? (existingConn.enabled ? 'checked' : '') : 'checked') + '>';
        html += '<label for="userNotifFieldEnabled" style="margin-bottom:0;cursor:pointer">Enabled</label>';
        html += '</div>';
        html += '</div>';

        // Provider fields
        var fields = meta.fields || [];
        fields.forEach(function (field) {
            html += '<div class="notif-form-group">';
            if (field.type === 'checkbox') {
                html += '<div class="notif-checkbox-row">';
                html += '<input type="checkbox" id="userNotifField_' + field.key + '" ' + (existingSettings[field.key] ? 'checked' : '') + '>';
                html += '<label for="userNotifField_' + field.key + '" style="margin-bottom:0;cursor:pointer">' + field.label + '</label>';
                html += '</div>';
            } else if (field.type === 'textarea') {
                html += '<label>' + field.label;
                if (field.required) html += ' <span class="required">*</span>';
                html += '</label>';
                html += '<textarea id="userNotifField_' + field.key + '" placeholder="' + escapeAttr(field.placeholder || '') + '">' + escapeHtml(existingSettings[field.key] || '') + '</textarea>';
            } else {
                html += '<label>' + field.label;
                if (field.required) html += ' <span class="required">*</span>';
                html += '</label>';
                var inputType = field.type === 'password' ? 'password' : 'text';
                html += '<input type="' + inputType + '" id="userNotifField_' + field.key + '" placeholder="' + escapeAttr(field.placeholder || '') + '" value="' + escapeAttr(existingSettings[field.key] || '') + '">';
            }
            if (field.help) html += '<div class="notif-form-help">' + field.help + '</div>';
            html += '</div>';
        });

        // Notification triggers
        html += '<div class="notif-triggers-section">';
        html += '<div class="notif-triggers-title">Notification Triggers</div>';
        html += '<div class="notif-triggers-grid">';
        triggerKeys.forEach(function (key) {
            var label = triggerLabels[key] || key.replace(/_/g, ' ');
            var checked = existingTriggers[key] ? 'checked' : '';
            html += '<label class="notif-trigger-item">';
            html += '<input type="checkbox" id="userNotifTrigger_' + key + '" ' + checked + '>';
            html += '<span class="notif-trigger-label">' + label + '</span>';
            html += '</label>';
        });
        html += '</div></div>';

        body.innerHTML = html;
        overlay.classList.add('active');
        document.body.style.overflow = 'hidden';

        setTimeout(function () {
            var first = body.querySelector('input[type="text"], input[type="password"]');
            if (first) first.focus();
        }, 200);
    }

    function closeModal() {
        var overlay = document.getElementById('userNotifModalOverlay');
        if (overlay) {
            overlay.classList.remove('active');
            document.body.style.overflow = '';
        }
        editingId = null;
        editingProvider = null;
    }

    function bindModalEvents() {
        var closeBtn = document.getElementById('userNotifModalClose');
        var cancelBtn = document.getElementById('userNotifModalCancelBtn');
        var saveBtn = document.getElementById('userNotifModalSaveBtn');
        var testBtn = document.getElementById('userNotifModalTestBtn');
        var overlay = document.getElementById('userNotifModalOverlay');

        if (closeBtn) closeBtn.addEventListener('click', closeModal);
        if (cancelBtn) cancelBtn.addEventListener('click', closeModal);
        if (overlay) overlay.addEventListener('click', function (e) { if (e.target === overlay) closeModal(); });
        if (saveBtn) saveBtn.addEventListener('click', handleSave);
        if (testBtn) testBtn.addEventListener('click', handleModalTest);
    }

    // ── Save ─────────────────────────────────────────────────

    function handleSave() {
        var meta = providerMeta[editingProvider] || {};
        var fields = meta.fields || [];

        var nameEl = document.getElementById('userNotifFieldName');
        var name = nameEl ? nameEl.value.trim() : '';
        if (!name) name = meta.name || editingProvider;

        var enabledEl = document.getElementById('userNotifFieldEnabled');
        var isEnabled = enabledEl ? enabledEl.checked : true;

        var settings = {};
        var missingRequired = false;

        fields.forEach(function (field) {
            var el = document.getElementById('userNotifField_' + field.key);
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

        var triggers = {};
        triggerKeys.forEach(function (key) {
            var el = document.getElementById('userNotifTrigger_' + key);
            triggers[key] = el ? el.checked : false;
        });

        var payload = {
            name: name,
            provider: editingProvider,
            enabled: isEnabled,
            settings: settings,
            triggers: triggers
        };
        if (editingId) payload.id = editingId;

        var saveBtn = document.getElementById('userNotifModalSaveBtn');
        if (saveBtn) { saveBtn.disabled = true; saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...'; }

        apiSave(payload)
            .then(function (data) {
                if (data.error) { notify('Failed: ' + data.error, 'error'); return; }
                notify('Connection saved', 'success');

                if (!editingId && data.id) {
                    editingId = data.id;
                    var testBtn = document.getElementById('userNotifModalTestBtn');
                    if (testBtn) { testBtn.disabled = false; testBtn.style.display = ''; }
                }

                return loadConnections().then(renderConnections);
            })
            .catch(function () { notify('Failed to save', 'error'); })
            .finally(function () {
                if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = '<i class="fas fa-save"></i> Save'; }
            });
    }

    // ── Test / Delete ────────────────────────────────────────

    function handleModalTest() {
        if (!editingId) {
            notify('Save the connection first before testing', 'info');
            return;
        }
        var testBtn = document.getElementById('userNotifModalTestBtn');
        if (!testBtn) return;

        testBtn.disabled = true;
        testBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Testing...';

        apiTest(editingId)
            .then(function (data) {
                if (data.success) {
                    notify('Test notification sent!', 'success');
                    testBtn.innerHTML = '<i class="fas fa-check"></i> Sent!';
                    setTimeout(function () { testBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Test'; }, 2500);
                } else {
                    notify('Test failed: ' + (data.error || 'Unknown'), 'error');
                    testBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Test';
                }
            })
            .catch(function () {
                notify('Test failed: Network error', 'error');
                testBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Test';
            })
            .finally(function () { testBtn.disabled = false; });
    }

    function handleTest(connId, btnEl) {
        if (!btnEl) return;
        btnEl.disabled = true;
        btnEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

        apiTest(connId)
            .then(function (data) {
                if (data.success) {
                    notify('Test notification sent!', 'success');
                    btnEl.innerHTML = '<i class="fas fa-check"></i>';
                } else {
                    notify('Test failed: ' + (data.error || 'Unknown'), 'error');
                    btnEl.innerHTML = '<i class="fas fa-paper-plane"></i>';
                }
            })
            .catch(function () {
                notify('Test failed', 'error');
                btnEl.innerHTML = '<i class="fas fa-paper-plane"></i>';
            })
            .finally(function () {
                btnEl.disabled = false;
                setTimeout(function () { btnEl.innerHTML = '<i class="fas fa-paper-plane"></i>'; }, 2500);
            });
    }

    function handleDelete(connId, name) {
        if (!confirm('Remove "' + name + '" notification?')) return;
        apiDelete(connId)
            .then(function (data) {
                if (data.error) { notify('Failed: ' + data.error, 'error'); return; }
                notify(name + ' removed', 'success');
                return loadConnections().then(renderConnections);
            })
            .catch(function () { notify('Failed to delete', 'error'); });
    }

    // ── Helpers ──────────────────────────────────────────────

    function escapeHtml(s) {
        var d = document.createElement('div');
        d.textContent = s || '';
        return d.innerHTML;
    }

    function escapeAttr(s) {
        return (s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function notify(msg, type) {
        if (window.HuntarrUtils && typeof window.HuntarrUtils.showToast === 'function') {
            window.HuntarrUtils.showToast(msg, type);
        } else {
            console.log('[UserNotifications]', type, msg);
        }
    }

})();
