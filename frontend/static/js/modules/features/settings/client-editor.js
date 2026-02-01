/**
 * Client Editor (Movie Hunt) - full-page editor for adding/editing a download client.
 * Separate from Client Management (clients.js). Attaches to window.SettingsForms.
 * Load after settings/core.js and instance-editor.js.
 */
(function() {
    'use strict';
    if (typeof window.SettingsForms === 'undefined') return;

    const Forms = window.SettingsForms;

    var CLIENT_TYPES = [
        { value: 'qbittorrent', label: 'qBittorrent' },
        { value: 'transmission', label: 'Transmission' },
        { value: 'deluge', label: 'Deluge' },
        { value: 'utorrent', label: 'uTorrent' },
        { value: 'flood', label: 'Flood' },
        { value: 'rtorrent', label: 'rTorrent' },
        { value: 'nzbget', label: 'NZBGet' },
        { value: 'sabnzbd', label: 'SABnzbd' }
    ];

    Forms.openClientEditor = function(isAdd, index, instance) {
        this._currentEditing = { appType: 'client', index: index, isAdd: isAdd, originalInstance: JSON.parse(JSON.stringify(instance || {})) };

        const titleEl = document.getElementById('instance-editor-title');
        if (titleEl) titleEl.textContent = isAdd ? 'Adding Client' : 'Edit Client';

        const contentEl = document.getElementById('instance-editor-content');
        if (contentEl) contentEl.innerHTML = this.generateClientEditorHtml(instance || {});

        const saveBtn = document.getElementById('instance-editor-save');
        const backBtn = document.getElementById('instance-editor-back');
        if (saveBtn) {
            saveBtn.onclick = () => this.saveClientFromEditor();
            saveBtn.disabled = false;
            saveBtn.classList.add('enabled');
        }
        if (backBtn) backBtn.onclick = () => this.cancelInstanceEditor();

        const enabledSelect = document.getElementById('editor-client-enabled');
        const enableIcon = document.getElementById('client-enable-status-icon');
        if (enabledSelect && enableIcon) {
            enabledSelect.addEventListener('change', function() {
                const isEnabled = enabledSelect.value === 'true';
                enableIcon.className = isEnabled ? 'fas fa-check-circle' : 'fas fa-minus-circle';
                enableIcon.style.color = isEnabled ? '#10b981' : '#ef4444';
            });
        }

        if (window.huntarrUI && window.huntarrUI.switchSection) {
            window.huntarrUI.switchSection('instance-editor');
        }
    };

    Forms.generateClientEditorHtml = function(instance) {
        const name = (instance.name || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        const typeVal = (instance.type || 'qbittorrent').toLowerCase().trim();
        const host = (instance.host || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        const port = instance.port !== undefined && instance.port !== '' ? String(instance.port) : '8080';
        const enabled = instance.enabled !== false;
        const isEdit = !!(instance.name && instance.name.trim());
        const pwdPlaceholder = isEdit && (instance.password_last4 || '')
            ? ('Enter new password or leave blank to keep existing (••••' + (instance.password_last4 || '') + ')')
            : 'Password (if required)';

        const optionsHtml = CLIENT_TYPES.map(function(o) {
            return '<option value="' + o.value + '"' + (typeVal === o.value ? ' selected' : '') + '>' + o.label + '</option>';
        }).join('');

        return `
            <div class="editor-grid">
                <div class="editor-section">
                    <div class="editor-section-title">Connection Settings</div>
                    <div class="editor-field-group">
                        <div class="editor-setting-item">
                            <label style="display: flex; align-items: center;">
                                <span>Enable Status </span>
                                <i id="client-enable-status-icon" class="fas ${enabled ? 'fa-check-circle' : 'fa-minus-circle'}" style="color: ${enabled ? '#10b981' : '#ef4444'}; font-size: 1.1rem;"></i>
                            </label>
                            <select id="editor-client-enabled">
                                <option value="true" ${enabled ? 'selected' : ''}>Enabled</option>
                                <option value="false" ${!enabled ? 'selected' : ''}>Disabled</option>
                            </select>
                        </div>
                    </div>
                    <div class="editor-field-group">
                        <label for="editor-client-name">Name</label>
                        <input type="text" id="editor-client-name" value="${name}" placeholder="e.g. My qBittorrent" />
                    </div>
                    <div class="editor-field-group">
                        <label for="editor-client-type">Client Type</label>
                        <select id="editor-client-type">${optionsHtml}</select>
                    </div>
                    <div class="editor-field-group">
                        <label for="editor-client-host">Host</label>
                        <input type="text" id="editor-client-host" value="${host}" placeholder="localhost or 192.168.1.10" />
                    </div>
                    <div class="editor-field-group">
                        <label for="editor-client-port">Port</label>
                        <input type="number" id="editor-client-port" value="${port}" placeholder="8080" min="1" max="65535" />
                    </div>
                    <div class="editor-field-group">
                        <label for="editor-client-password">Password</label>
                        <input type="password" id="editor-client-password" placeholder="${pwdPlaceholder.replace(/"/g, '&quot;')}" autocomplete="off" />
                    </div>
                </div>
            </div>
        `;
    };

    Forms.saveClientFromEditor = function() {
        if (!this._currentEditing || this._currentEditing.appType !== 'client') return;
        const nameEl = document.getElementById('editor-client-name');
        const typeEl = document.getElementById('editor-client-type');
        const hostEl = document.getElementById('editor-client-host');
        const portEl = document.getElementById('editor-client-port');
        const enabledEl = document.getElementById('editor-client-enabled');
        const passwordEl = document.getElementById('editor-client-password');

        const name = nameEl ? nameEl.value.trim() : '';
        const type = typeEl ? typeEl.value.trim().toLowerCase() : 'qbittorrent';
        const host = hostEl ? hostEl.value.trim() : '';
        let port = 8080;
        if (portEl && portEl.value.trim() !== '') {
            const p = parseInt(portEl.value, 10);
            if (!isNaN(p)) port = p;
        }
        const enabled = enabledEl ? enabledEl.value === 'true' : true;
        const password = passwordEl ? passwordEl.value.trim() : '';

        const body = { name: name || 'Unnamed', type: type, host: host, port: port, enabled: enabled };
        if (password) body.password = password;

        const isAdd = this._currentEditing.isAdd;
        const index = this._currentEditing.index;
        const url = isAdd ? './api/clients' : './api/clients/' + index;
        const method = isAdd ? 'POST' : 'PUT';

        fetch(url, { method: method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (window.SettingsForms && window.SettingsForms.refreshClientsList) {
                    window.SettingsForms.refreshClientsList();
                }
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification(isAdd ? 'Client added.' : 'Client updated.', 'success');
                }
                if (window.SettingsForms && window.SettingsForms._currentEditing) {
                    window.SettingsForms._currentEditing.isAdd = false;
                    if (data && data.index !== undefined) {
                        window.SettingsForms._currentEditing.index = data.index;
                    } else if (!isAdd) {
                        window.SettingsForms._currentEditing.index = index;
                    }
                }
            })
            .catch(function(err) {
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification(err.message || 'Failed to save client', 'error');
                }
            });
    };
})();
