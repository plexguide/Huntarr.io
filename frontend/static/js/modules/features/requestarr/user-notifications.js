/**
 * User Notifications — Per-user notification provider management
 * Reuses the notifications.css design system from admin notifications.
 */

(function () {
    'use strict';

    var providers = {};
    var eventTypes = [];
    var eventLabels = {};
    var userSettings = [];
    var editingProvider = null;
    var initialized = false;

    window.UserNotifications = {
        init: init,
        refresh: refresh
    };

    function init() {
        if (initialized) { refresh(); return; }
        initialized = true;
        Promise.all([loadProviders(), loadSettings()])
            .then(function () {
                renderProviderGrid();
                renderSettings();
                bindModalEvents();
            })
            .catch(function (err) {
                console.error('[UserNotifications] Init error:', err);
            });
    }

    function refresh() {
        loadSettings().then(renderSettings);
    }

    // ── API ──────────────────────────────────────────────────

    function loadProviders() {
        return fetch('./api/user-notifications/providers', { credentials: 'include' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                providers = data.providers || {};
                eventTypes = data.event_types || [];
                eventLabels = data.event_labels || {};
            });
    }

    function loadSettings() {
        return fetch('./api/user-notifications/settings', { credentials: 'include' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                userSettings = data.settings || [];
            });
    }

    function apiSave(payload) {
        return fetch('./api/user-notifications/settings', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }).then(function (r) { return r.json(); });
    }

    function apiDelete(provider) {
        return fetch('./api/user-notifications/settings/' + provider, {
            method: 'DELETE',
            credentials: 'include'
        }).then(function (r) { return r.json(); });
    }

    function apiTest(provider) {
        return fetch('./api/user-notifications/test/' + provider, {
            method: 'POST',
            credentials: 'include'
        }).then(function (r) { return r.json(); });
    }

    // ── Render Provider Grid ─────────────────────────────────

    function renderProviderGrid() {
        var grid = document.getElementById('userNotifProviderGrid');
        if (!grid) return;
        grid.innerHTML = '';

        var order = ['discord', 'telegram', 'slack', 'pushover', 'pushbullet', 'email', 'gotify', 'ntfy', 'lunasea', 'notifiarr', 'webhook', 'apprise'];

        order.forEach(function (key) {
            var meta = providers[key];
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

    // ── Render Settings List ─────────────────────────────────

    function renderSettings() {
        var container = document.getElementById('userNotifList');
        var empty = document.getElementById('userNotifEmpty');
        var countEl = document.getElementById('userNotifCount');
        if (!container || !empty) return;

        container.innerHTML = '';

        if (userSettings.length === 0) {
            container.style.display = 'none';
            empty.style.display = 'block';
            if (countEl) countEl.textContent = '';
            return;
        }

        container.style.display = 'flex';
        empty.style.display = 'none';
        if (countEl) countEl.textContent = userSettings.length + ' provider' + (userSettings.length !== 1 ? 's' : '');

        userSettings.forEach(function (setting) {
            container.appendChild(renderSettingItem(setting));
        });
    }

    function renderSettingItem(setting) {
        var meta = providers[setting.provider] || {};
        var color = meta.color || '#64748b';
        var icon = meta.icon || 'fas fa-bell';
        var providerName = meta.name || setting.provider;

        var types = setting.types || {};
        var activeCount = 0;
        for (var k in types) { if (types[k]) activeCount++; }

        var statusDot = setting.enabled ? 'active' : 'disabled';
        var statusText = setting.enabled ? 'Enabled' : 'Disabled';

        var el = document.createElement('div');
        el.className = 'notif-connection-item';
        el.innerHTML =
            '<div class="notif-connection-left">' +
                '<div class="notif-connection-icon" style="background:' + color + '">' +
                    '<i class="' + icon + '"></i>' +
                '</div>' +
                '<div class="notif-connection-info">' +
                    '<div class="notif-connection-name">' + escapeHtml(providerName) + '</div>' +
                    '<div class="notif-connection-meta">' +
                        '<span class="notif-connection-status"><span class="notif-status-dot ' + statusDot + '"></span> ' + statusText + '</span>' +
                        '<span>' + activeCount + ' event' + (activeCount !== 1 ? 's' : '') + '</span>' +
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
            handleTest(setting.provider, this);
        });
        el.querySelector('.edit-btn').addEventListener('click', function (e) {
            e.stopPropagation();
            openModal(setting.provider, setting);
        });
        el.querySelector('.delete-btn').addEventListener('click', function (e) {
            e.stopPropagation();
            handleDelete(setting.provider, providerName);
        });

        return el;
    }

    // ── Modal ────────────────────────────────────────────────

    function openModal(providerKey, existing) {
        var overlay = document.getElementById('userNotifModalOverlay');
        var body = document.getElementById('userNotifModalBody');
        var titleEl = document.getElementById('userNotifModalTitle');
        var iconEl = document.getElementById('userNotifModalIcon');
        var iconI = document.getElementById('userNotifModalIconI');
        var testBtn = document.getElementById('userNotifModalTestBtn');
        if (!overlay || !body) return;

        var meta = providers[providerKey] || {};
        editingProvider = providerKey;

        titleEl.textContent = existing ? 'Edit ' + meta.name : 'Add ' + (meta.name || providerKey);
        iconEl.style.background = meta.color || '#64748b';
        iconI.className = meta.icon || 'fas fa-bell';

        if (testBtn) {
            testBtn.style.display = existing ? '' : 'none';
        }

        var existingSettings = (existing && existing.settings) || {};
        var existingTypes = (existing && existing.types) || {};
        var html = '';

        // Enabled toggle
        html += '<div class="notif-checkbox-row" style="margin-bottom:14px">';
        html += '<input type="checkbox" id="userNotifEnabled" ' + (existing ? (existing.enabled ? 'checked' : '') : 'checked') + '>';
        html += '<label for="userNotifEnabled" style="margin-bottom:0;cursor:pointer">Enabled</label>';
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

        // Event types
        html += '<div class="notif-triggers-section">';
        html += '<div class="notif-triggers-title">Notify Me When</div>';
        html += '<div class="notif-triggers-grid">';
        eventTypes.forEach(function (key) {
            var label = eventLabels[key] || key.replace(/_/g, ' ');
            var checked = existing ? (existingTypes[key] ? 'checked' : '') : 'checked';
            html += '<label class="notif-trigger-item">';
            html += '<input type="checkbox" id="userNotifType_' + key + '" ' + checked + '>';
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
        if (testBtn) testBtn.addEventListener('click', function () { handleTest(editingProvider, testBtn); });
    }

    // ── Save ─────────────────────────────────────────────────

    function handleSave() {
        var meta = providers[editingProvider] || {};
        var fields = meta.fields || [];

        var enabled = document.getElementById('userNotifEnabled');
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

        var types = {};
        eventTypes.forEach(function (key) {
            var el = document.getElementById('userNotifType_' + key);
            types[key] = el ? el.checked : false;
        });

        var saveBtn = document.getElementById('userNotifModalSaveBtn');
        if (saveBtn) { saveBtn.disabled = true; saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...'; }

        apiSave({
            provider: editingProvider,
            enabled: enabled ? enabled.checked : true,
            settings: settings,
            types: types
        })
        .then(function (data) {
            if (data.error) { notify('Failed: ' + data.error, 'error'); return; }
            notify('Notification saved', 'success');
            var testBtn = document.getElementById('userNotifModalTestBtn');
            if (testBtn) testBtn.style.display = '';
            return loadSettings().then(renderSettings);
        })
        .catch(function () { notify('Failed to save', 'error'); })
        .finally(function () {
            if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = '<i class="fas fa-save"></i> Save'; }
        });
    }

    // ── Test / Delete ────────────────────────────────────────

    function handleTest(provider, btnEl) {
        if (!btnEl) return;
        btnEl.disabled = true;
        btnEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

        apiTest(provider)
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
                notify('Test failed: Network error', 'error');
                btnEl.innerHTML = '<i class="fas fa-paper-plane"></i>';
            })
            .finally(function () {
                btnEl.disabled = false;
                setTimeout(function () { btnEl.innerHTML = '<i class="fas fa-paper-plane"></i>'; }, 2500);
            });
    }

    function handleDelete(provider, name) {
        if (!confirm('Remove ' + name + ' notifications?')) return;
        apiDelete(provider)
            .then(function (data) {
                if (data.error) { notify('Failed: ' + data.error, 'error'); return; }
                notify(name + ' removed', 'success');
                return loadSettings().then(renderSettings);
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
