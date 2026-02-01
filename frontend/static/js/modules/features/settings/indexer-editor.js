/**
 * Indexer Editor (Movie Hunt) - full-page editor for adding/editing a single indexer.
 * Separate from Indexer Management (list/CRUD). Attaches to window.SettingsForms.
 * Load after settings/core.js and instance-editor.js.
 */
(function() {
    'use strict';
    if (typeof window.SettingsForms === 'undefined') return;

    const Forms = window.SettingsForms;

    Forms.getIndexerPresetLabel = function(preset) {
        var p = (preset || 'manual').toLowerCase().trim();
        if (p === 'nzbgeek') return 'NZBGeek';
        if (p === 'nzbfinder.ws') return 'NZBFinder.ws';
        return 'Manual Configuration';
    };

    Forms.openIndexerEditor = function(isAdd, index, instance) {
        this._currentEditing = { appType: 'indexer', index: index, isAdd: isAdd, originalInstance: JSON.parse(JSON.stringify(instance || {})) };

        var preset = (instance && instance.preset) ? (instance.preset + '').toLowerCase().trim() : 'manual';
        var presetLabel = this.getIndexerPresetLabel(preset);
        var titleHtml = '<span class="client-editor-title-app">' + String(presetLabel).replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span> Indexer Editor';
        var pageTitleEl = document.getElementById('currentPageTitle');
        if (pageTitleEl) pageTitleEl.innerHTML = titleHtml;

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

        this.populateIndexerCategoriesDropdown();
        const catSelect = document.getElementById('editor-categories-select');
        const catPills = document.getElementById('indexer-categories-pills');
        const presetElForCat = document.getElementById('editor-preset');
        if (catSelect) {
            catSelect.addEventListener('change', function() {
                const id = parseInt(catSelect.value, 10);
                if (!id) return;
                const pill = catPills ? catPills.querySelector('.indexer-category-pill[data-category-id="' + id + '"]') : null;
                if (pill) return;
                const preset = (presetElForCat && presetElForCat.value) ? presetElForCat.value.toLowerCase().trim() : 'manual';
                const cats = Forms.getIndexerCategoriesForPreset(preset);
                const c = cats.find(function(x) { return x.id === id; });
                const label = c ? (c.name + ' (' + c.id + ')') : String(id);
                const span = document.createElement('span');
                span.className = 'indexer-category-pill';
                span.setAttribute('data-category-id', id);
                span.innerHTML = '<span class="indexer-category-remove" aria-label="Remove">×</span><span>' + String(label).replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span>';
                span.querySelector('.indexer-category-remove').addEventListener('click', function() {
                    span.remove();
                    Forms.populateIndexerCategoriesDropdown();
                });
                if (catPills) catPills.appendChild(span);
                Forms.populateIndexerCategoriesDropdown();
                catSelect.value = '';
            });
        }
        if (catPills) {
            catPills.addEventListener('click', function(e) {
                const remove = e.target.classList.contains('indexer-category-remove') ? e.target : e.target.closest('.indexer-category-remove');
                if (remove) {
                    const pill = remove.closest('.indexer-category-pill');
                    if (pill) pill.remove();
                    Forms.populateIndexerCategoriesDropdown();
                }
            });
        }

        const presetEl = document.getElementById('editor-preset');
        const keyInput = document.getElementById('editor-key');
        if (keyInput) {
            let validationTimeout;
            const runCheck = () => {
                clearTimeout(validationTimeout);
                validationTimeout = setTimeout(() => this.checkIndexerConnection(), 500);
            };
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

    // Preset-specific indexer categories (Movies only). NZBGeek has 8 (no DVD); NZBFinder has 9 (includes DVD). Movies/3D (2060) unchecked by default.
    var NZBGEEK_CATS = [
        { id: 2000, name: 'Movies' }, { id: 2010, name: 'Movies/Foreign' }, { id: 2020, name: 'Movies/Other' },
        { id: 2030, name: 'Movies/SD' }, { id: 2040, name: 'Movies/HD' }, { id: 2045, name: 'Movies/UHD' },
        { id: 2050, name: 'Movies/BluRay' }, { id: 2060, name: 'Movies/3D' }
    ];
    var NZBFINDER_CATS = [
        { id: 2000, name: 'Movies' }, { id: 2010, name: 'Movies/Foreign' }, { id: 2020, name: 'Movies/Other' },
        { id: 2030, name: 'Movies/SD' }, { id: 2040, name: 'Movies/HD' }, { id: 2045, name: 'Movies/UHD' },
        { id: 2050, name: 'Movies/BluRay' }, { id: 2060, name: 'Movies/3D' }, { id: 2070, name: 'Movies/DVD' }
    ];
    Forms.INDEXER_CATEGORIES_BY_PRESET = {
        nzbgeek: NZBGEEK_CATS,
        'nzbfinder.ws': NZBFINDER_CATS,
        manual: NZBFINDER_CATS
    };
    Forms.INDEXER_DEFAULT_IDS_BY_PRESET = {
        nzbgeek: [2000, 2010, 2020, 2030, 2040, 2045, 2050],
        'nzbfinder.ws': [2000, 2010, 2020, 2030, 2040, 2045, 2050, 2070],
        manual: [2000, 2010, 2020, 2030, 2040, 2045, 2050, 2070]
    };
    Forms.getIndexerCategoriesForPreset = function(preset) {
        var p = (preset || 'manual').toLowerCase().trim();
        return Forms.INDEXER_CATEGORIES_BY_PRESET[p] || Forms.INDEXER_CATEGORIES_BY_PRESET.manual;
    };
    Forms.getIndexerDefaultIdsForPreset = function(preset) {
        var p = (preset || 'manual').toLowerCase().trim();
        return (Forms.INDEXER_DEFAULT_IDS_BY_PRESET[p] || Forms.INDEXER_DEFAULT_IDS_BY_PRESET.manual).slice();
    };

    Forms.generateIndexerEditorHtml = function(instance) {
        const name = (instance.name || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        const preset = (instance.preset || 'manual').toLowerCase().replace(/[^a-z0-9.-]/g, '');
        const selectedPreset = ['nzbgeek', 'nzbfinder.ws', 'manual'].includes(preset) ? preset : 'manual';
        const presetLabel = Forms.getIndexerPresetLabel(selectedPreset);
        const enabled = instance.enabled !== false;
        const isEdit = !!(instance && (instance.api_key_last4 || (instance.name && instance.name.trim())));
        const keyPlaceholder = isEdit && (instance.api_key_last4 || '')
            ? ('Enter new key or leave blank to keep existing (••••' + (instance.api_key_last4 || '') + ')')
            : 'Your API Key';
        var presetKey = (preset || 'manual').toLowerCase().trim();
        var presetCats = Forms.getIndexerCategoriesForPreset(presetKey);
        var defaultIds = Forms.getIndexerDefaultIdsForPreset(presetKey);
        var categoryIds = Array.isArray(instance.categories) ? instance.categories.filter(function(id) { return presetCats.some(function(c) { return c.id === id; }); }) : defaultIds;
        if (categoryIds.length === 0) categoryIds = defaultIds;
        var categoryChipsHtml = categoryIds.map(function(id) {
            var c = presetCats.find(function(x) { return x.id === id; });
            var label = c ? (c.name + ' (' + c.id + ')') : String(id);
            return '<span class="indexer-category-pill" data-category-id="' + id + '"><span class="indexer-category-remove" aria-label="Remove">×</span><span>' + String(label).replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span></span>';
        }).join('');
        return `
            <input type="hidden" id="editor-preset" value="${String(selectedPreset).replace(/"/g, '&quot;')}">
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
                        <label>Preset</label>
                        <div class="editor-readonly-preset" style="color: #f59e0b; font-weight: 600;">${String(presetLabel).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
                        <p class="editor-help-text">Indexer type was set when adding. Change by editing from the list.</p>
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
                <div class="editor-section">
                    <div class="editor-section-title">Additional Configurations</div>
                    <div class="editor-field-group">
                        <label for="editor-categories-select">Categories</label>
                        <select id="editor-categories-select" class="settings-select" style="width: 100%; padding: 10px 12px; background: #1e293b; border: 1px solid #475569; border-radius: 6px; color: #e2e8f0;">
                            <option value="">Select a category to add...</option>
                        </select>
                        <p class="editor-help-text">Categories to use for this indexer.</p>
                        <div id="indexer-categories-pills" class="indexer-categories-pills" style="display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; min-height: 24px;">${categoryChipsHtml}</div>
                    </div>
                </div>
            </div>
        `;
    };

    Forms.populateIndexerCategoriesDropdown = function() {
        const select = document.getElementById('editor-categories-select');
        const pills = document.getElementById('indexer-categories-pills');
        const presetEl = document.getElementById('editor-preset');
        if (!select || !pills) return;
        const preset = (presetEl && presetEl.value) ? presetEl.value.toLowerCase().trim() : 'manual';
        const categories = Forms.getIndexerCategoriesForPreset(preset);
        const selectedIds = Array.from(pills.querySelectorAll('.indexer-category-pill')).map(function(el) { return parseInt(el.getAttribute('data-category-id'), 10); }).filter(function(id) { return !isNaN(id); });
        select.innerHTML = '<option value="">Select a category to add...</option>';
        categories.forEach(function(c) {
            if (selectedIds.indexOf(c.id) === -1) {
                const opt = document.createElement('option');
                opt.value = c.id;
                opt.textContent = c.name + ' (' + c.id + ')';
                select.appendChild(opt);
            }
        });
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
        const pillsEl = document.getElementById('indexer-categories-pills');
        var categories = pillsEl ? Array.from(pillsEl.querySelectorAll('.indexer-category-pill')).map(function(el) { return parseInt(el.getAttribute('data-category-id'), 10); }).filter(function(id) { return !isNaN(id); }) : [];
        if (categories.length === 0) categories = Forms.getIndexerDefaultIdsForPreset(preset);

        const body = { name: name || 'Unnamed', preset: preset, api_key: apiKey, enabled: enabled, categories: categories };
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
                // Stay on Indexer Editor after save (do not navigate back to indexer list)
                if (window.SettingsForms && window.SettingsForms._currentEditing) {
                    window.SettingsForms._currentEditing.isAdd = false;
                    if (data && (data.index !== undefined || data.indexer !== undefined)) {
                        window.SettingsForms._currentEditing.index = data.index !== undefined ? data.index : (data.indexer && data.indexer.index !== undefined ? data.indexer.index : index);
                    }
                }
            })
            .catch(function(err) {
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification(err.message || 'Failed to save indexer', 'error');
                }
            });
    };
})();
