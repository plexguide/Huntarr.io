/**
 * Indexer Management (Movie Hunt) - extends SettingsForms with indexer CRUD and editor.
 * Loaded after settings/core.js. All methods are attached to window.SettingsForms.
 */
(function() {
    'use strict';
    if (typeof window.SettingsForms === 'undefined') return;

    const Forms = window.SettingsForms;
    Forms.openIndexerEditor = function(isAdd, index, instance) {
        this._currentEditing = { appType: 'indexer', index: index, isAdd: isAdd, originalInstance: JSON.parse(JSON.stringify(instance || {})) };

        const titleEl = document.getElementById('instance-editor-title');
        if (titleEl) titleEl.textContent = isAdd ? 'Adding Indexer' : 'Edit Indexer';

        const contentEl = document.getElementById('instance-editor-content');
        if (contentEl) contentEl.innerHTML = this.generateIndexerEditorHtml(instance || {});

        const saveBtn = document.getElementById('instance-editor-save');
        const backBtn = document.getElementById('instance-editor-back');
        if (saveBtn) {
            saveBtn.onclick = () => this.saveIndexerFromEditor();
            saveBtn.disabled = false;
            saveBtn.classList.add('enabled');
        }
        if (backBtn) backBtn.onclick = () => this.cancelInstanceEditor();

        const presetEl = document.getElementById('editor-preset');
        const keyInput = document.getElementById('editor-key');
        if (presetEl && keyInput) {
            let validationTimeout;
            const runCheck = () => {
                clearTimeout(validationTimeout);
                validationTimeout = setTimeout(() => this.checkIndexerConnection(), 500);
            };
            presetEl.addEventListener('change', runCheck);
            keyInput.addEventListener('input', runCheck);
            keyInput.addEventListener('change', runCheck);
            this.checkIndexerConnection();
        }

        const enabledSelect = document.getElementById('editor-enabled');
        const enableIcon = document.getElementById('indexer-enable-status-icon');
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

    Forms.generateIndexerEditorHtml = function(instance) {
        const name = (instance.name || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        const preset = (instance.preset || 'manual').toLowerCase().replace(/[^a-z0-9.-]/g, '');
        const enabled = instance.enabled !== false;
        const isEdit = !!(instance && (instance.api_key_last4 || (instance.name && instance.name.trim())));
        const keyPlaceholder = isEdit && (instance.api_key_last4 || '')
            ? ('Enter new key or leave blank to keep existing (••••' + (instance.api_key_last4 || '') + ')')
            : 'Your API Key';
        const presetOptions = [
            { value: 'nzbgeek', label: 'NZBGeek' },
            { value: 'nzbfinder.ws', label: 'NZBFinder.ws' },
            { value: 'manual', label: 'Manual Configuration' }
        ];
        const selectedPreset = ['nzbgeek', 'nzbfinder.ws', 'manual'].includes(preset) ? preset : 'manual';
        const optionsHtml = presetOptions.map(function(o) {
            return '<option value="' + o.value + '"' + (selectedPreset === o.value ? ' selected' : '') + '>' + o.label + '</option>';
        }).join('');
        return `
            <div class="editor-grid">
                <div class="editor-section">
                    <div class="editor-section-title" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
                        <span>Connection Settings</span>
                        <div id="indexer-connection-status-container" style="display: flex; justify-content: flex-end; flex: 1;"></div>
                    </div>
                    <div class="editor-field-group">
                        <div class="editor-setting-item">
                            <label style="display: flex; align-items: center;">
                                <span>Enable Status </span>
                                <i id="indexer-enable-status-icon" class="fas ${enabled ? 'fa-check-circle' : 'fa-minus-circle'}" style="color: ${enabled ? '#10b981' : '#ef4444'}; font-size: 1.1rem;"></i>
                            </label>
                            <select id="editor-enabled">
                                <option value="true" ${enabled ? 'selected' : ''}>Enabled</option>
                                <option value="false" ${!enabled ? 'selected' : ''}>Disabled</option>
                            </select>
                        </div>
                        <p class="editor-help-text">Enable or disable this instance</p>
                    </div>
                    <div class="editor-field-group">
                        <label for="editor-preset">Presets</label>
                        <select id="editor-preset">${optionsHtml}</select>
                        <p class="editor-help-text">Choose a preset or Manual Configuration to enter details yourself.</p>
                    </div>
                    <div class="editor-field-group">
                        <label for="editor-name">Name</label>
                        <input type="text" id="editor-name" value="${name}" placeholder="e.g. Prowlarr, NZBGeek">
                        <p class="editor-help-text">A friendly name to identify this indexer.</p>
                    </div>
                    <div class="editor-field-group">
                        <label for="editor-key">API Key</label>
                        <input type="text" id="editor-key" placeholder="${keyPlaceholder.replace(/"/g, '&quot;')}">
                        <p class="editor-help-text">Only the last 4 characters will be shown on the card after saving.</p>
                    </div>
                </div>
            </div>
        `;
    };

    Forms.checkIndexerConnection = function() {
        const container = document.getElementById('indexer-connection-status-container');
        const presetEl = document.getElementById('editor-preset');
        const keyEl = document.getElementById('editor-key');
        if (!container || !presetEl || !keyEl) return;
        container.style.display = 'flex';
        container.style.justifyContent = 'flex-end';
        const preset = (presetEl.value || '').trim().toLowerCase();
        const apiKey = (keyEl.value || '').trim();
        if (preset === 'manual') {
            container.innerHTML = '<span class="connection-status" style="background: rgba(148, 163, 184, 0.1); color: #94a3b8; border: 1px solid rgba(148, 163, 184, 0.2);"><i class="fas fa-info-circle"></i><span>Manual configuration is not validated.</span></span>';
            return;
        }
        if (!apiKey || apiKey.length < 10) {
            container.innerHTML = '<span class="connection-status" style="background: rgba(251, 191, 36, 0.1); color: #fbbf24; border: 1px solid rgba(251, 191, 36, 0.2);"><i class="fas fa-exclamation-triangle"></i><span>Enter API key</span></span>';
            return;
        }
        container.innerHTML = '<span class="connection-status checking"><i class="fas fa-spinner fa-spin"></i><span>Checking...</span></span>';
        fetch('./api/indexers/validate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ preset: preset, api_key: apiKey })
        })
            .then(function(r) { return r.json().then(function(data) { return { ok: r.ok, data: data }; }); })
            .then(function(result) {
                const data = result.data || {};
                if (data.valid === true) {
                    container.innerHTML = '<span class="connection-status success"><i class="fas fa-check-circle"></i><span>Connected</span></span>';
                } else {
                    container.innerHTML = '<span class="connection-status error"><i class="fas fa-times-circle"></i><span>' + (data.message || 'Invalid API key') + '</span></span>';
                }
            })
            .catch(function(err) {
                container.innerHTML = '<span class="connection-status error"><i class="fas fa-times-circle"></i><span>' + (err.message || 'Connection failed') + '</span></span>';
            });
    };

    Forms.validateIndexerApiKey = function() {
        this.checkIndexerConnection();
    };

    Forms.saveIndexerFromEditor = function() {
        if (!this._currentEditing || this._currentEditing.appType !== 'indexer') return;
        const enabledEl = document.getElementById('editor-enabled');
        const presetEl = document.getElementById('editor-preset');
        const nameEl = document.getElementById('editor-name');
        const keyEl = document.getElementById('editor-key');
        const enabled = enabledEl ? enabledEl.value === 'true' : true;
        const preset = presetEl ? presetEl.value : 'manual';
        const name = nameEl ? nameEl.value.trim() : '';
        const apiKey = keyEl ? keyEl.value.trim() : '';
        const isAdd = this._currentEditing.isAdd;
        const index = this._currentEditing.index;
        this._currentEditing = null;

        const body = { name: name || 'Unnamed', preset: preset, api_key: apiKey, enabled: enabled };
        const url = isAdd ? './api/indexers' : './api/indexers/' + index;
        const method = isAdd ? 'POST' : 'PUT';
        fetch(url, { method: method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (window.SettingsForms && window.SettingsForms.refreshIndexersList) {
                    window.SettingsForms.refreshIndexersList();
                }
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification(isAdd ? 'Indexer added.' : 'Indexer updated.', 'success');
                }
                if (window.huntarrUI && window.huntarrUI.switchSection) {
                    window.huntarrUI.switchSection('settings-indexers');
                }
            })
            .catch(function(err) {
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification(err.message || 'Failed to save indexer', 'error');
                }
            });
    };

    Forms.renderIndexerCard = function(indexer, index) {
        const isDefault = index === 0;
        const name = (indexer.name || 'Unnamed').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const last4 = indexer.api_key_last4 || '****';
        const preset = (indexer.preset || 'manual').replace(/"/g, '&quot;');
        const enabled = indexer.enabled !== false;
        const statusClass = enabled ? 'status-connected' : 'status-error';
        const statusIcon = enabled ? 'fa-check-circle' : 'fa-minus-circle';
        return '<div class="instance-card ' + (isDefault ? 'default-instance' : '') + '" data-instance-index="' + index + '" data-app-type="indexer" data-preset="' + preset + '" data-enabled="' + enabled + '">' +
            '<div class="instance-card-header">' +
            '<div class="instance-name"><i class="fas fa-server"></i><span>' + name + '</span>' + (isDefault ? '<span class="default-badge">Default</span>' : '') + '</div>' +
            '<div class="instance-status-icon ' + statusClass + '"><i class="fas ' + statusIcon + '"></i></div>' +
            '</div>' +
            '<div class="instance-card-body">' +
            '<div class="instance-detail"><i class="fas fa-key"></i><span>••••••••' + last4 + '</span></div>' +
            '</div>' +
            '<div class="instance-card-footer">' +
            '<button type="button" class="btn-card edit" data-app-type="indexer" data-instance-index="' + index + '"><i class="fas fa-edit"></i> Edit</button>' +
            '<button type="button" class="btn-card delete" data-app-type="indexer" data-instance-index="' + index + '"><i class="fas fa-trash"></i> Delete</button>' +
            '</div></div>';
    };

    Forms.refreshIndexersList = function() {
        const grid = document.getElementById('indexer-instances-grid');
        if (!grid) return;
        fetch('./api/indexers')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                const list = (data && data.indexers) ? data.indexers : [];
                let html = '';
                for (let i = 0; i < list.length; i++) {
                    html += window.SettingsForms.renderIndexerCard(list[i], i);
                }
                html += '<div class="add-instance-card" data-app-type="indexer"><div class="add-icon"><i class="fas fa-plus-circle"></i></div><div class="add-text">Adding Indexer</div></div>';
                grid.innerHTML = html;
            })
            .catch(function() {
                grid.innerHTML = '<div class="add-instance-card" data-app-type="indexer"><div class="add-icon"><i class="fas fa-plus-circle"></i></div><div class="add-text">Adding Indexer</div></div>';
            });
    };
})();
