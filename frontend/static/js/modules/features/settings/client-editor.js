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
        { value: 'nzbget', label: 'NZBGet' },
        { value: 'sabnzbd', label: 'SABnzbd' }
    ];

    var PRIORITY_OPTIONS = [
        { value: 'last', label: 'Last' },
        { value: 'first', label: 'First' },
        { value: 'default', label: 'Default' },
        { value: 'high', label: 'High' },
        { value: 'low', label: 'Low' }
    ];

    Forms.openClientEditor = function(isAdd, index, instance) {
        const inst = instance || {};
        this._currentEditing = { appType: 'client', index: index, isAdd: isAdd, originalInstance: JSON.parse(JSON.stringify(inst)) };

        const typeRaw = (inst.type || 'nzbget').toLowerCase().trim();
        const typeVal = CLIENT_TYPES.some(function(o) { return o.value === typeRaw; }) ? typeRaw : 'nzbget';
        const clientDisplayName = (CLIENT_TYPES.find(function(o) { return o.value === typeVal; }) || { label: typeVal }).label;

        const titleEl = document.getElementById('instance-editor-title');
        if (titleEl) {
            titleEl.innerHTML = '<span class="client-editor-title-app">' + String(clientDisplayName).replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span> Connection Settings';
        }

        const contentEl = document.getElementById('instance-editor-content');
        if (contentEl) contentEl.innerHTML = this.generateClientEditorHtml(inst);

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
        const typeRaw = (instance.type || 'nzbget').toLowerCase().trim();
        const typeVal = CLIENT_TYPES.some(function(o) { return o.value === typeRaw; }) ? typeRaw : 'nzbget';
        const host = (instance.host || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        const port = instance.port !== undefined && instance.port !== '' ? String(instance.port) : '8080';
        const enabled = instance.enabled !== false;
        const isEdit = !!(instance.name && instance.name.trim());
        const pwdPlaceholder = isEdit && (instance.password_last4 || '')
            ? ('Enter new password or leave blank to keep existing (••••' + (instance.password_last4 || '') + ')')
            : 'Password (if required)';
        const category = (instance.category || 'movies').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        const recentPriority = (instance.recent_priority || 'default').toLowerCase();
        const olderPriority = (instance.older_priority || 'default').toLowerCase();
        let clientPriority = parseInt(instance.client_priority, 10);
        if (isNaN(clientPriority) || clientPriority < 1 || clientPriority > 99) clientPriority = 50;

        const recentOptionsHtml = PRIORITY_OPTIONS.map(function(o) {
            return '<option value="' + o.value + '"' + (recentPriority === o.value ? ' selected' : '') + '>' + o.label + '</option>';
        }).join('');
        const olderOptionsHtml = PRIORITY_OPTIONS.map(function(o) {
            return '<option value="' + o.value + '"' + (olderPriority === o.value ? ' selected' : '') + '>' + o.label + '</option>';
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
                        <input type="text" id="editor-client-name" value="${name}" placeholder="e.g. My NZBGet" />
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
                <div class="editor-section">
                    <div class="editor-section-title">Additional Configurations</div>
                    <div class="editor-field-group">
                        <label for="editor-client-category">Category</label>
                        <input type="text" id="editor-client-category" value="${category}" placeholder="movies" />
                        <p class="editor-help-text">Adding a category specific to Radarr avoids conflicts with unrelated non-Radarr downloads. Using a category is optional, but strongly recommended.</p>
                    </div>
                    <div class="editor-field-group">
                        <label for="editor-client-recent-priority">Recent Priority</label>
                        <select id="editor-client-recent-priority">${recentOptionsHtml}</select>
                        <p class="editor-help-text">Priority to use when grabbing movies that aired within the last 21 days.</p>
                    </div>
                    <div class="editor-field-group">
                        <label for="editor-client-older-priority">Older Priority</label>
                        <select id="editor-client-older-priority">${olderOptionsHtml}</select>
                        <p class="editor-help-text">Priority to use when grabbing movies that aired over 21 days ago.</p>
                    </div>
                    <div class="editor-field-group">
                        <label for="editor-client-priority">Client Priority</label>
                        <input type="number" id="editor-client-priority" value="${clientPriority}" min="1" max="99" placeholder="50" />
                        <p class="editor-help-text">Download Client Priority from 1 (Highest) to 99 (Lowest). Default: 50. Round-Robin is used for clients with the same priority.</p>
                    </div>
                </div>
            </div>
        `;
    };

    Forms.saveClientFromEditor = function() {
        if (!this._currentEditing || this._currentEditing.appType !== 'client') return;
        const nameEl = document.getElementById('editor-client-name');
        const hostEl = document.getElementById('editor-client-host');
        const portEl = document.getElementById('editor-client-port');
        const enabledEl = document.getElementById('editor-client-enabled');
        const passwordEl = document.getElementById('editor-client-password');
        const categoryEl = document.getElementById('editor-client-category');
        const recentPriorityEl = document.getElementById('editor-client-recent-priority');
        const olderPriorityEl = document.getElementById('editor-client-older-priority');
        const clientPriorityEl = document.getElementById('editor-client-priority');

        const name = nameEl ? nameEl.value.trim() : '';
        const type = (this._currentEditing && this._currentEditing.originalInstance && this._currentEditing.originalInstance.type)
            ? String(this._currentEditing.originalInstance.type).trim().toLowerCase()
            : 'nzbget';
        const host = hostEl ? hostEl.value.trim() : '';
        let port = 8080;
        if (portEl && portEl.value.trim() !== '') {
            const p = parseInt(portEl.value, 10);
            if (!isNaN(p)) port = p;
        }
        const enabled = enabledEl ? enabledEl.value === 'true' : true;
        const password = passwordEl ? passwordEl.value.trim() : '';
        const category = categoryEl ? categoryEl.value.trim() : 'movies';
        const recentPriority = recentPriorityEl ? (recentPriorityEl.value || 'default').toLowerCase() : 'default';
        const olderPriority = olderPriorityEl ? (olderPriorityEl.value || 'default').toLowerCase() : 'default';
        let clientPriority = 50;
        if (clientPriorityEl && clientPriorityEl.value.trim() !== '') {
            const p = parseInt(clientPriorityEl.value, 10);
            if (!isNaN(p) && p >= 1 && p <= 99) clientPriority = p;
        }

        const body = {
            name: name || 'Unnamed',
            type: type,
            host: host,
            port: port,
            enabled: enabled,
            category: category || 'movies',
            recent_priority: recentPriority,
            older_priority: olderPriority,
            client_priority: clientPriority
        };
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
