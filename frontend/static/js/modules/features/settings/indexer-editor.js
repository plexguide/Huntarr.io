/**
 * Indexer Editor (Movie Hunt) - full-page editor for adding/editing a single indexer.
 * Separate from Indexer Management (list/CRUD). Attaches to window.SettingsForms.
 * Load after settings/core.js and instance-editor.js.
 *
 * Add flow:  Click "Add Indexer" -> editor opens with unlocked preset dropdown
 *            User picks preset -> URL/categories/name auto-populate, dropdown locks
 * Edit flow: Editor opens with preset already locked
 */
(function() {
    'use strict';
    if (typeof window.SettingsForms === 'undefined') return;

    const Forms = window.SettingsForms;

    // ── Preset metadata (must match backend INDEXER_PRESETS) ────────────
    var PRESET_META = {
        dognzb:        { name: 'DOGnzb',         url: 'https://api.dognzb.cr',            api_path: '/api', categories: [2000,2010,2020,2030,2040,2045,2050,2060] },
        drunkenslug:   { name: 'DrunkenSlug',     url: 'https://drunkenslug.com',           api_path: '/api', categories: [2000,2010,2030,2040,2045,2050,2060] },
        'nzb.su':      { name: 'Nzb.su',          url: 'https://api.nzb.su',                api_path: '/api', categories: [2000,2010,2020,2030,2040,2045] },
        nzbcat:        { name: 'NZBCat',          url: 'https://nzb.cat',                   api_path: '/api', categories: [2000,2010,2020,2030,2040,2045,2050,2060] },
        'nzbfinder.ws':{ name: 'NZBFinder.ws',    url: 'https://nzbfinder.ws',              api_path: '/api', categories: [2030,2040,2045,2050,2060,2070] },
        nzbgeek:       { name: 'NZBgeek',         url: 'https://api.nzbgeek.info',          api_path: '/api', categories: [2000,2010,2020,2030,2040,2045,2050,2060] },
        'nzbplanet.net':{ name: 'nzbplanet.net',  url: 'https://api.nzbplanet.net',         api_path: '/api', categories: [2000,2010,2020,2030,2040,2050,2060] },
        simplynzbs:    { name: 'SimplyNZBs',      url: 'https://simplynzbs.com',            api_path: '/api', categories: [2000,2010,2020,2030,2040,2045,2050,2060] },
        tabularasa:    { name: 'Tabula Rasa',     url: 'https://www.tabula-rasa.pw',        api_path: '/api/v1/api', categories: [2000,2010,2030,2040,2045,2050,2060] },
        usenetcrawler: { name: 'Usenet Crawler',  url: 'https://www.usenet-crawler.com',    api_path: '/api', categories: [2000,2010,2020,2030,2040,2045,2050,2060] },
    };
    window.INDEXER_PRESET_META = PRESET_META;

    // ── Standard Newznab movie categories (most indexers) ───────────────
    var ALL_MOVIE_CATEGORIES = [
        { id: 2000, name: 'Movies' }, { id: 2010, name: 'Movies/Foreign' }, { id: 2020, name: 'Movies/Other' },
        { id: 2030, name: 'Movies/SD' }, { id: 2040, name: 'Movies/HD' }, { id: 2045, name: 'Movies/UHD' },
        { id: 2050, name: 'Movies/BluRay' }, { id: 2060, name: 'Movies/3D' }, { id: 2070, name: 'Movies/DVD' }
    ];
    // DOGnzb-specific: exact categories from DOGnzb dropdown
    var DOGNZB_CATEGORIES = [
        { id: 2000, name: 'Movies' }, { id: 2010, name: 'Foreign' }, { id: 2020, name: 'Other' },
        { id: 2030, name: 'SD' }, { id: 2040, name: 'HD' }, { id: 2045, name: '4K' },
        { id: 2050, name: 'BluRay' }, { id: 2060, name: '3D' }, { id: 2070, name: 'Mobile' }
    ];
    // NZBCat-specific: exact categories from NZBCat dropdown
    var NZBCAT_CATEGORIES = [
        { id: 2000, name: 'Movies' }, { id: 2010, name: 'Foreign' }, { id: 2020, name: 'Other' },
        { id: 2030, name: 'SD' }, { id: 2040, name: 'HD' }, { id: 2045, name: 'UHD' },
        { id: 2050, name: 'BluRay' }, { id: 2060, name: '3D' }, { id: 2070, name: 'Movies/DVD' }
    ];
    // NZB.su-specific: exact categories from NZB.su dropdown - only these 6
    var NZBSU_CATEGORIES = [
        { id: 2000, name: 'Movies' }, { id: 2010, name: 'Foreign' }, { id: 2020, name: 'Other' },
        { id: 2030, name: 'SD' }, { id: 2040, name: 'HD' }, { id: 2045, name: 'UHD' }
    ];
    // NZBFinder-specific: 2050=3D, 2060=BluRay, 2070=DVD, 2999=Other
    var NZBFINDER_CATEGORIES = [
        { id: 2000, name: 'Movies' }, { id: 2010, name: 'Foreign' },
        { id: 2030, name: 'SD' }, { id: 2040, name: 'HD' }, { id: 2045, name: 'UHD' },
        { id: 2050, name: '3D' }, { id: 2060, name: 'BluRay' }, { id: 2070, name: 'DVD' }, { id: 2999, name: 'Other' }
    ];
    // Usenet Crawler-specific: exact categories matching the dropdown
    var USENETCRAWLER_CATEGORIES = [
        { id: 2000, name: 'Movies' }, { id: 2010, name: 'Foreign' }, { id: 2020, name: 'Other' },
        { id: 2030, name: 'SD' }, { id: 2040, name: 'HD' }, { id: 2045, name: 'UHD' },
        { id: 2050, name: 'BluRay' }, { id: 2060, name: '3D' }, { id: 2070, name: 'Movies/DVD' }
    ];
    // Tabula Rasa-specific: 2050=3D, 2060=BluRay, 2070=DVD, 2080=WEBDL, 2090=X265, 2999=Other - no 2020
    var TABULARASA_CATEGORIES = [
        { id: 2000, name: 'Movies' }, { id: 2010, name: 'Foreign' },
        { id: 2030, name: 'SD' }, { id: 2040, name: 'HD' }, { id: 2045, name: 'UHD' },
        { id: 2050, name: '3D' }, { id: 2060, name: 'BluRay' }, { id: 2070, name: 'DVD' },
        { id: 2080, name: 'WEBDL' }, { id: 2090, name: 'X265' }, { id: 2999, name: 'Other' }
    ];
    // SimplyNZBs-specific: exact categories from SimplyNZBs dropdown
    var SIMPLYNZBS_CATEGORIES = [
        { id: 2000, name: 'Movies' }, { id: 2010, name: 'Foreign' }, { id: 2020, name: 'Other' },
        { id: 2030, name: 'SD' }, { id: 2040, name: 'HD' }, { id: 2045, name: 'UHD' },
        { id: 2050, name: 'BluRay' }, { id: 2060, name: '3D' }, { id: 2070, name: 'Movies/DVD' }
    ];
    // NZBplanet-specific: 2050=BluRay, 2060=3D, 2070=UHD, 2080=Cam - no 2045
    var NZBPLANET_CATEGORIES = [
        { id: 2000, name: 'Movies' }, { id: 2010, name: 'Foreign' }, { id: 2020, name: 'Other' },
        { id: 2030, name: 'SD' }, { id: 2040, name: 'HD' }, { id: 2050, name: 'BluRay' }, { id: 2060, name: '3D' },
        { id: 2070, name: 'UHD' }, { id: 2080, name: 'Cam' }
    ];
    // DrunkenSlug-specific: exact categories from DrunkenSlug dropdown - no 2020
    var DRUNKENSLUG_CATEGORIES = [
        { id: 2000, name: 'Movies' }, { id: 2010, name: 'Foreign' },
        { id: 2030, name: 'SD' }, { id: 2040, name: 'HD' }, { id: 2045, name: 'UHD' },
        { id: 2050, name: '3D' }, { id: 2060, name: 'BluRay' }, { id: 2070, name: 'DVD' }, { id: 2999, name: 'Other' }
    ];
    var DEFAULT_CATEGORIES = [2000, 2010, 2020, 2030, 2040, 2045, 2050, 2060];

    // ── TV categories (5000 series only; never mix with 2000 movie series) ───
    var ALL_TV_CATEGORIES = [
        { id: 5000, name: 'TV' }, { id: 5010, name: 'TV/Foreign' }, { id: 5020, name: 'TV/Other' },
        { id: 5030, name: 'TV/SD' }, { id: 5040, name: 'TV/HD' }, { id: 5045, name: 'TV/UHD' },
        { id: 5050, name: 'TV/BluRay' }, { id: 5060, name: 'TV/3D' }, { id: 5070, name: 'TV/DVD' }
    ];
    var DEFAULT_TV_CATEGORIES = [5000, 5010, 5020, 5030, 5040, 5045, 5050, 5060, 5070];

    // ── Helpers ────────────────────────────────────────────────────────
    Forms.getIndexerPresetLabel = function(preset) {
        var p = (preset || 'manual').toLowerCase().trim();
        if (PRESET_META[p]) return PRESET_META[p].name;
        if (p === 'manual') return 'Custom (Manual)';
        return p;
    };
    Forms.getIndexerCategoriesForPreset = function(preset) {
        var isTV = (Forms._indexersMode === 'tv');
        if (isTV) return ALL_TV_CATEGORIES;  // TV: 5000 series only
        var p = (preset || '').toLowerCase().trim();
        if (p === 'dognzb') return DOGNZB_CATEGORIES;
        if (p === 'drunkenslug') return DRUNKENSLUG_CATEGORIES;
        if (p === 'nzb.su') return NZBSU_CATEGORIES;
        if (p === 'nzbcat') return NZBCAT_CATEGORIES;
        if (p === 'nzbfinder.ws') return NZBFINDER_CATEGORIES;
        if (p === 'nzbplanet.net') return NZBPLANET_CATEGORIES;
        if (p === 'simplynzbs') return SIMPLYNZBS_CATEGORIES;
        if (p === 'tabularasa') return TABULARASA_CATEGORIES;
        if (p === 'usenetcrawler') return USENETCRAWLER_CATEGORIES;
        return ALL_MOVIE_CATEGORIES;  // Movie: 2000 series only
    };
    Forms.getIndexerDefaultIdsForPreset = function(preset) {
        var isTV = (Forms._indexersMode === 'tv');
        if (isTV) return DEFAULT_TV_CATEGORIES.slice();  // TV: 5000 series only
        var p = (preset || 'manual').toLowerCase().trim();
        if (PRESET_META[p] && Array.isArray(PRESET_META[p].categories)) {
            return PRESET_META[p].categories.slice();
        }
        return DEFAULT_CATEGORIES.slice();  // Movie: 2000 series only
    };

    // ── Open editor ────────────────────────────────────────────────────
    // isAdd=true: new indexer (preset dropdown unlocked, no preset chosen yet)
    // isAdd=false: editing existing (preset locked)
    Forms.openIndexerEditor = function(isAdd, index, instance) {
        var inst = instance || {};
        this._currentEditing = {
            appType: 'indexer',
            index: index,
            indexerId: (inst.id != null && inst.id !== '') ? String(inst.id) : null,
            isAdd: isAdd,
            originalInstance: JSON.parse(JSON.stringify(inst)),
            presetLocked: !isAdd  // locked on edit, unlocked on add
        };

        var preset = (instance && instance.preset) ? (instance.preset + '').toLowerCase().trim() : '';
        var pageTitleEl = document.getElementById('currentPageTitle');
        if (pageTitleEl) {
            pageTitleEl.textContent = isAdd ? 'Add Indexer' : (this.getIndexerPresetLabel(preset) + ' Indexer Editor');
        }

        var contentEl = document.getElementById('instance-editor-content');
        if (contentEl) contentEl.innerHTML = this.generateIndexerEditorHtml(instance || {}, isAdd);

        var saveBtn = document.getElementById('instance-editor-save');
        var backBtn = document.getElementById('instance-editor-back');
        if (saveBtn) {
            saveBtn.onclick = () => this.saveIndexerFromEditor();
            // Disable save until preset is chosen (add mode) or always enabled (edit mode)
            if (isAdd && !preset) {
                saveBtn.disabled = true;
                saveBtn.classList.remove('enabled');
            } else {
                saveBtn.disabled = false;
                saveBtn.classList.add('enabled');
            }
        }
        if (backBtn) backBtn.onclick = () => this.cancelInstanceEditor();

        // Wire up the preset selector for Add mode
        if (isAdd) {
            this._wirePresetSelector();
        }

        // Wire up categories, validation, enable toggle (only if preset selected)
        if (!isAdd || preset) {
            this._wireEditorFields();
        }

        if (window.huntarrUI && window.huntarrUI.switchSection) {
            window.huntarrUI.switchSection('instance-editor');
        }
    };

    // ── Wire up the preset selector (Add mode only) ───────────────────
    Forms._wirePresetSelector = function() {
        var self = this;
        var presetSelect = document.getElementById('editor-preset-select');
        if (!presetSelect) return;

        presetSelect.addEventListener('change', function() {
            var val = (presetSelect.value || '').trim();
            if (!val) return;

            // Handle "Import from Index Master"
            if (val === '__import_ih__') {
                var ihPanel = document.getElementById('editor-ih-import-panel');
                if (ihPanel) ihPanel.style.display = '';
                self._loadIndexerHuntAvailable();
                presetSelect.value = '';  // reset to placeholder
                return;
            }

            // Lock the dropdown
            presetSelect.disabled = true;
            presetSelect.classList.add('editor-readonly');
            self._currentEditing.presetLocked = true;

            // Update hidden preset field
            var presetHidden = document.getElementById('editor-preset');
            if (presetHidden) presetHidden.value = val;

            // Get metadata
            var meta = PRESET_META[val] || {};
            var isManual = val === 'manual';

            // Populate fields
            var nameEl = document.getElementById('editor-name');
            var urlEl = document.getElementById('editor-url');
            var apiPathEl = document.getElementById('editor-api-path');
            var urlGroup = document.getElementById('editor-url-group');
            var apiPathGroup = document.getElementById('editor-api-path-group');
            var urlHelp = document.getElementById('editor-url-help');
            var apiPathHelp = document.getElementById('editor-api-path-help');

            if (nameEl && !nameEl.value.trim()) nameEl.value = meta.name || 'Custom';
            if (urlEl) {
                urlEl.value = meta.url || '';
                if (!isManual) {
                    urlEl.setAttribute('readonly', 'readonly');
                    urlEl.classList.add('editor-readonly');
                } else {
                    urlEl.removeAttribute('readonly');
                    urlEl.classList.remove('editor-readonly');
                }
            }
            if (apiPathEl) {
                apiPathEl.value = meta.api_path || '/api';
                if (!isManual) {
                    apiPathEl.setAttribute('readonly', 'readonly');
                    apiPathEl.classList.add('editor-readonly');
                } else {
                    apiPathEl.removeAttribute('readonly');
                    apiPathEl.classList.remove('editor-readonly');
                }
            }
            if (urlHelp) urlHelp.textContent = isManual ? 'The base URL of your indexer.' : 'Pre-configured for this indexer preset.';
            if (apiPathHelp) apiPathHelp.textContent = 'Path to the API, usually /api';

            // Show fields that were hidden
            if (urlGroup) urlGroup.style.display = '';
            if (apiPathGroup) apiPathGroup.style.display = '';
            var keyGroup = document.getElementById('editor-key-group');
            if (keyGroup) keyGroup.style.display = '';
            var catSection = document.getElementById('editor-categories-section');
            if (catSection) catSection.style.display = '';
            var enableGroup = document.getElementById('editor-enable-group');
            if (enableGroup) enableGroup.style.display = '';

            // Populate categories
            var defaultCats = Forms.getIndexerDefaultIdsForPreset(val);
            var pillsEl = document.getElementById('indexer-categories-pills');
            if (pillsEl) {
                pillsEl.innerHTML = '';
                var allCats = Forms.getIndexerCategoriesForPreset(val);
                defaultCats.forEach(function(id) {
                    var c = allCats.find(function(x) { return x.id === id; });
                    var label = c ? (c.name + ' (' + c.id + ')') : String(id);
                    var span = document.createElement('span');
                    span.className = 'indexer-category-pill';
                    span.setAttribute('data-category-id', id);
                    span.innerHTML = '<span class="indexer-category-remove" aria-label="Remove">\u00d7</span><span>' + label + '</span>';
                    pillsEl.appendChild(span);
                });
            }
            Forms.populateIndexerCategoriesDropdown();

            // Enable save button
            var saveBtn = document.getElementById('instance-editor-save');
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.classList.add('enabled');
            }

            // Update page title
            var pageTitleEl = document.getElementById('currentPageTitle');
            if (pageTitleEl) pageTitleEl.textContent = (meta.name || 'Custom') + ' Indexer Editor';

            // Wire up rest of editor fields now
            self._wireEditorFields();
        });
    };

    // ── Import from Index Master ─────────────────────────────────────────
    Forms._loadIndexerHuntAvailable = function() {
        var self = this;
        // Read instance ID synchronously from the instance select dropdown
        var instanceId = 1;
        var sel = document.getElementById('settings-indexers-instance-select');
        if (sel && sel.value) instanceId = parseInt(sel.value, 10) || 1;
        fetch('./api/indexer-hunt/available/' + instanceId)
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var sel = document.getElementById('editor-ih-select');
                if (!sel) return;
                sel.innerHTML = '<option value="">Select an indexer from Index Master...</option>';
                (data.available || []).forEach(function(idx) {
                    var opt = document.createElement('option');
                    opt.value = idx.id;
                    opt.textContent = idx.name + ' (Priority: ' + idx.priority + ', ' + (idx.api_key_last4 ? '****' + idx.api_key_last4 : 'no key') + ')';
                    opt.setAttribute('data-name', idx.name);
                    opt.setAttribute('data-preset', idx.preset);
                    opt.setAttribute('data-priority', idx.priority);
                    opt.setAttribute('data-url', idx.url || '');
                    sel.appendChild(opt);
                });
                if ((data.available || []).length === 0) {
                    sel.innerHTML = '<option value="">No available indexers in Index Master</option>';
                }
                // Wire change handler
                sel.addEventListener('change', function() {
                    self._onIndexerHuntImportSelect(sel);
                });
            })
            .catch(function(err) {
                console.error('[IndexerEditor] Failed to load Indexer Hunt available:', err);
            });
    };

    Forms._onIndexerHuntImportSelect = function(sel) {
        var ihId = sel.value;
        if (!ihId) return;
        var opt = sel.options[sel.selectedIndex];
        if (!opt) return;

        var name = opt.getAttribute('data-name') || '';
        var preset = opt.getAttribute('data-preset') || 'manual';
        var priority = parseInt(opt.getAttribute('data-priority') || '50', 10);

        // Read instance ID and mode from dropdown (value format: "movie:1" or "tv:1")
        var instanceId = 1;
        var mode = 'movie';
        var instSel = document.getElementById('settings-indexers-instance-select');
        if (instSel && instSel.value) {
            var parts = instSel.value.split(':');
            if (parts.length === 2) {
                mode = parts[0] === 'tv' ? 'tv' : 'movie';
                var parsed = parseInt(parts[1], 10);
                if (!isNaN(parsed)) instanceId = parsed;
            }
        }

        // Sync this indexer to the current instance via the API
        fetch('./api/indexer-hunt/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ instance_id: instanceId, mode: mode, indexer_ids: [ihId] }),
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.success && data.added > 0) {
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('Imported "' + name + '" from Index Master.', 'success');
                }
                if (window.SettingsForms && window.SettingsForms.refreshIndexersList) {
                    window.SettingsForms.refreshIndexersList();
                }
                if (window.IndexerHunt && window.IndexerHunt._refreshIndexerInstanceStatus) {
                    window.IndexerHunt._refreshIndexerInstanceStatus();
                }
                // Go back to indexer list
                if (window.SettingsForms && window.SettingsForms.cancelInstanceEditor) {
                    window.SettingsForms.cancelInstanceEditor();
                }
            } else if (data.success && data.added === 0) {
                if (window.huntarrUI) window.huntarrUI.showNotification('This indexer is already synced to this instance.', 'info');
            } else {
                if (window.huntarrUI) window.huntarrUI.showNotification(data.error || 'Import failed.', 'error');
            }
        })
        .catch(function(err) {
            if (window.huntarrUI) window.huntarrUI.showNotification('Import error: ' + err, 'error');
        });
    };

    // ── Wire up category pills, API key validation, enable toggle ─────
    Forms._wireEditorFields = function() {
        var self = this;

        // Categories
        this.populateIndexerCategoriesDropdown();
        var catSelect = document.getElementById('editor-categories-select');
        var catPills = document.getElementById('indexer-categories-pills');
        var presetElForCat = document.getElementById('editor-preset');
        if (catSelect) {
            catSelect.addEventListener('change', function() {
                var id = parseInt(catSelect.value, 10);
                if (!id) return;
                var pill = catPills ? catPills.querySelector('.indexer-category-pill[data-category-id="' + id + '"]') : null;
                if (pill) return;
                var preset = presetElForCat ? presetElForCat.value : '';
                var cats = Forms.getIndexerCategoriesForPreset(preset);
                var c = cats.find(function(x) { return x.id === id; });
                var label = c ? (c.name + ' (' + c.id + ')') : String(id);
                var span = document.createElement('span');
                span.className = 'indexer-category-pill';
                span.setAttribute('data-category-id', id);
                span.innerHTML = '<span class="indexer-category-remove" aria-label="Remove">\u00d7</span><span>' + String(label).replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span>';
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
                var remove = e.target.classList.contains('indexer-category-remove') ? e.target : e.target.closest('.indexer-category-remove');
                if (remove) {
                    var pill = remove.closest('.indexer-category-pill');
                    if (pill) pill.remove();
                    Forms.populateIndexerCategoriesDropdown();
                }
            });
        }

        // API key validation
        var keyInput = document.getElementById('editor-key');
        var urlInput = document.getElementById('editor-url');
        var apiPathInput = document.getElementById('editor-api-path');
        if (keyInput) {
            var validationTimeout;
            var runCheck = function() {
                clearTimeout(validationTimeout);
                validationTimeout = setTimeout(function() { self.checkIndexerConnection(); }, 500);
            };
            keyInput.addEventListener('input', runCheck);
            keyInput.addEventListener('change', runCheck);
            if (urlInput) {
                urlInput.addEventListener('input', runCheck);
                urlInput.addEventListener('change', runCheck);
            }
            if (apiPathInput) {
                apiPathInput.addEventListener('input', runCheck);
                apiPathInput.addEventListener('change', runCheck);
            }
            this.checkIndexerConnection();
        }

        // Enable status toggle
        var enabledSelect = document.getElementById('editor-enabled');
        var enableIcon = document.getElementById('indexer-enable-status-icon');
        if (enabledSelect && enableIcon) {
            enabledSelect.addEventListener('change', function() {
                var isEnabled = enabledSelect.value === 'true';
                enableIcon.className = isEnabled ? 'fas fa-check-circle' : 'fas fa-minus-circle';
                enableIcon.style.color = isEnabled ? '#10b981' : '#ef4444';
            });
        }
    };

    // ── Generate HTML ──────────────────────────────────────────────────
    Forms.generateIndexerEditorHtml = function(instance, isAdd) {
        var name = (instance.name || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        var rawPreset = (instance.preset || '').toLowerCase().replace(/[^a-z0-9.-]/g, '');
        var hasPreset = !!(rawPreset && (PRESET_META[rawPreset] || rawPreset === 'manual'));
        var preset = hasPreset ? rawPreset : '';
        var isManual = preset === 'manual';
        var enabled = instance.enabled !== false;
        var isEdit = !isAdd;
        var keyPlaceholder = isEdit && (instance.api_key_last4 || '')
            ? ('Enter new key or leave blank to keep existing (\u2022\u2022\u2022\u2022' + (instance.api_key_last4 || '') + ')')
            : 'Your API Key';

        // URL & API Path
        var meta = PRESET_META[preset] || {};
        var url = (instance.url || meta.url || '').replace(/"/g, '&quot;');
        var apiPath = (instance.api_path || meta.api_path || '/api').replace(/"/g, '&quot;');
        var urlReadonly = hasPreset && !isManual;

        // Categories: Movie = 2000 series only, TV = 5000 series only (no cross-ref)
        var allCats = Forms.getIndexerCategoriesForPreset(preset);
        var defaultIds = hasPreset ? Forms.getIndexerDefaultIdsForPreset(preset) : [];
        var categoryIds = Array.isArray(instance.categories) ? instance.categories : defaultIds;
        var validIds = allCats.map(function(x) { return x.id; });
        categoryIds = categoryIds.filter(function(id) { return validIds.indexOf(id) !== -1; });
        if (categoryIds.length === 0) categoryIds = defaultIds;
        var categoryChipsHtml = categoryIds.map(function(id) {
            var c = allCats.find(function(x) { return x.id === id; });
            var label = c ? (c.name + ' (' + c.id + ')') : String(id);
            return '<span class="indexer-category-pill" data-category-id="' + id + '"><span class="indexer-category-remove" aria-label="Remove">\u00d7</span><span>' + String(label).replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span></span>';
        }).join('');

        // Build preset selector or locked display
        var presetHtml;
        if (isAdd && !hasPreset) {
            // Add mode, no preset yet: show dropdown
            presetHtml = '<div class="editor-field-group">' +
                '<label for="editor-preset-select">Indexer Type</label>' +
                '<select id="editor-preset-select" class="settings-select" style="width: 100%; padding: 10px 12px; background: #1e293b; border: 1px solid #475569; border-radius: 6px; color: #e2e8f0;">' +
                '<option value="">Select an indexer...</option>' +
                '<option value="__import_ih__">Import from Index Master</option>' +
                '<option disabled>\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500</option>' +
                '<option value="dognzb">DOGnzb</option>' +
                '<option value="drunkenslug">DrunkenSlug</option>' +
                '<option value="nzb.su">Nzb.su</option>' +
                '<option value="nzbcat">NZBCat</option>' +
                '<option value="nzbfinder.ws">NZBFinder.ws</option>' +
                '<option value="nzbgeek">NZBgeek</option>' +
                '<option value="nzbplanet.net">nzbplanet.net</option>' +
                '<option value="simplynzbs">SimplyNZBs</option>' +
                '<option value="tabularasa">Tabula Rasa</option>' +
                '<option value="usenetcrawler">Usenet Crawler</option>' +
                '<option disabled>\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500</option>' +
                '<option value="manual">Custom (Manual Configuration)</option>' +
                '</select>' +
                '<p class="editor-help-text">Choose a preset, import from Index Master, or configure manually.</p>' +
                '</div>' +
                '<div class="editor-field-group" id="editor-ih-import-panel" style="display: none;">' +
                    '<label>Available from Index Master</label>' +
                    '<select id="editor-ih-select" class="settings-select" style="width: 100%; padding: 10px 12px; background: #1e293b; border: 1px solid #475569; border-radius: 6px; color: #e2e8f0;">' +
                        '<option value="">Select an indexer from Index Master...</option>' +
                    '</select>' +
                    '<p class="editor-help-text">Select an indexer configured in Index Master to import it to this instance.</p>' +
                '</div>';
        } else {
            // Edit mode or Add with preset already selected: locked display
            var presetLabel = Forms.getIndexerPresetLabel(preset);
            presetHtml = '<div class="editor-field-group">' +
                '<label>Indexer Type</label>' +
                '<div class="indexer-preset-locked">' +
                '<i class="fas ' + (isManual ? 'fa-cog' : 'fa-server') + '"></i>' +
                '<span>' + presetLabel + '</span>' +
                '<i class="fas fa-lock indexer-preset-lock-icon"></i>' +
                '</div>' +
                '<p class="editor-help-text">Indexer type is set when created and cannot be changed.</p>' +
                '</div>';
        }

        // Priority
        var priority = instance.priority !== undefined ? instance.priority : 50;
        var indexerHuntId = instance.indexer_hunt_id || '';

        // Should we hide fields until preset is picked? (Add mode, no preset)
        var fieldsHidden = isAdd && !hasPreset;
        var hideStyle = fieldsHidden ? ' style="display: none;"' : '';

        return '<input type="hidden" id="editor-preset" value="' + (preset || '') + '">' +
            '<input type="hidden" id="editor-indexer-hunt-id" value="' + indexerHuntId + '">' +
            '<div class="editor-grid">' +
                '<div class="editor-section">' +
                    '<div class="editor-section-title" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">' +
                        '<span>Connection Settings</span>' +
                        '<div id="indexer-connection-status-container" style="display: flex; justify-content: flex-end; flex: 1;"></div>' +
                    '</div>' +
                    presetHtml +
                    '<div class="editor-field-group" id="editor-enable-group"' + hideStyle + '>' +
                        '<div class="editor-setting-item">' +
                            '<label style="display: flex; align-items: center;">' +
                                '<span>Enable Status</span>' +
                                '<i id="indexer-enable-status-icon" class="fas ' + (enabled ? 'fa-check-circle' : 'fa-minus-circle') + '" style="color: ' + (enabled ? '#10b981' : '#ef4444') + '; font-size: 1.1rem; margin-left: 8px;"></i>' +
                            '</label>' +
                            '<select id="editor-enabled">' +
                                '<option value="true"' + (enabled ? ' selected' : '') + '>Enabled</option>' +
                                '<option value="false"' + (!enabled ? ' selected' : '') + '>Disabled</option>' +
                            '</select>' +
                        '</div>' +
                        '<p class="editor-help-text">Enable or disable this indexer</p>' +
                    '</div>' +
                    '<div class="editor-field-group"' + hideStyle + '>' +
                        '<label for="editor-name">Name</label>' +
                        '<input type="text" id="editor-name" value="' + name + '" placeholder="e.g. My Indexer">' +
                        '<p class="editor-help-text">A friendly name to identify this indexer.</p>' +
                    '</div>' +
                    '<div class="editor-field-group" id="editor-key-group"' + hideStyle + '>' +
                        '<label for="editor-key">API Key</label>' +
                        '<input type="text" id="editor-key" placeholder="' + keyPlaceholder.replace(/"/g, '&quot;') + '">' +
                        '<p class="editor-help-text">Only the last 4 characters will be shown on the card after saving.</p>' +
                    '</div>' +
                    '<div class="editor-field-group" id="editor-priority-group"' + hideStyle + '>' +
                        '<label for="editor-priority">Indexer Priority</label>' +
                        '<input type="number" id="editor-priority" value="' + priority + '" min="1" max="99" style="width: 100%; padding: 10px 12px; background: #1e293b; border: 1px solid #475569; border-radius: 6px; color: #e2e8f0;">' +
                        '<p class="editor-help-text">Lower number = higher priority (1-99, default 50). When multiple indexers find a match, results from higher-priority indexers are preferred.</p>' +
                    '</div>' +
                    '<div class="editor-field-group" id="editor-url-group"' + hideStyle + '>' +
                        '<label for="editor-url">URL</label>' +
                        '<input type="text" id="editor-url" value="' + url + '" placeholder="https://my-indexer.com"' + (urlReadonly ? ' readonly class="editor-readonly"' : '') + '>' +
                        '<p class="editor-help-text" id="editor-url-help">' + (urlReadonly ? 'Pre-configured for this indexer preset.' : 'The base URL of your indexer.') + '</p>' +
                    '</div>' +
                    '<div class="editor-field-group" id="editor-api-path-group"' + hideStyle + '>' +
                        '<label for="editor-api-path">API Path</label>' +
                        '<input type="text" id="editor-api-path" value="' + apiPath + '" placeholder="/api"' + (urlReadonly ? ' readonly class="editor-readonly"' : '') + '>' +
                        '<p class="editor-help-text" id="editor-api-path-help">Path to the API, usually /api</p>' +
                    '</div>' +
                '</div>' +
                '<div class="editor-section" id="editor-categories-section"' + hideStyle + '>' +
                    '<div class="editor-section-title">Additional Configurations</div>' +
                    '<div class="editor-field-group">' +
                        '<label for="editor-categories-select">Categories</label>' +
                        '<select id="editor-categories-select" class="settings-select" style="width: 100%; padding: 10px 12px; background: #1e293b; border: 1px solid #475569; border-radius: 6px; color: #e2e8f0;">' +
                            '<option value="">Select additional categories to add...</option>' +
                        '</select>' +
                        '<p class="editor-help-text">Categories to use for this indexer.</p>' +
                        '<div id="indexer-categories-pills" class="indexer-categories-pills" style="display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; min-height: 24px;">' + categoryChipsHtml + '</div>' +
                    '</div>' +
                '</div>' +
            '</div>';
    };

    // ── Populate categories dropdown ───────────────────────────────────
    Forms.populateIndexerCategoriesDropdown = function() {
        var select = document.getElementById('editor-categories-select');
        var pills = document.getElementById('indexer-categories-pills');
        var presetEl = document.getElementById('editor-preset');
        if (!select || !pills) return;
        var preset = presetEl ? presetEl.value : '';
        var categories = Forms.getIndexerCategoriesForPreset(preset);
        var selectedIds = Array.from(pills.querySelectorAll('.indexer-category-pill')).map(function(el) { return parseInt(el.getAttribute('data-category-id'), 10); }).filter(function(id) { return !isNaN(id); });
        select.innerHTML = '<option value="">Select additional categories to add...</option>';
        categories.forEach(function(c) {
            if (selectedIds.indexOf(c.id) === -1) {
                var opt = document.createElement('option');
                opt.value = c.id;
                opt.textContent = c.name + ' (' + c.id + ')';
                select.appendChild(opt);
            }
        });
    };

    // ── Connection validation ──────────────────────────────────────────
    Forms.checkIndexerConnection = function() {
        var container = document.getElementById('indexer-connection-status-container');
        var presetEl = document.getElementById('editor-preset');
        var keyEl = document.getElementById('editor-key');
        var urlEl = document.getElementById('editor-url');
        var apiPathEl = document.getElementById('editor-api-path');
        if (!container || !presetEl || !keyEl) return;
        container.style.display = 'flex';
        container.style.justifyContent = 'flex-end';
        var preset = (presetEl.value || '').trim().toLowerCase();
        var apiKey = (keyEl.value || '').trim();
        var hasSavedKey = this._currentEditing && this._currentEditing.originalInstance && (this._currentEditing.originalInstance.api_key_last4 || '');

        if (preset === 'manual') {
            var customUrl = urlEl ? urlEl.value.trim() : '';
            if (!customUrl) {
                container.innerHTML = '<span class="connection-status" style="background: rgba(251, 191, 36, 0.1); color: #fbbf24; border: 1px solid rgba(251, 191, 36, 0.2);"><i class="fas fa-exclamation-triangle"></i><span>Enter URL and API key to validate</span></span>';
                return;
            }
            if (!apiKey || apiKey.length < 10) {
                if (hasSavedKey) {
                    container.innerHTML = '<span class="connection-status" style="background: rgba(148, 163, 184, 0.1); color: #94a3b8; border: 1px solid rgba(148, 163, 184, 0.2);"><i class="fas fa-check-circle"></i><span>API key saved. Leave blank to keep existing.</span></span>';
                    return;
                }
                container.innerHTML = '<span class="connection-status" style="background: rgba(251, 191, 36, 0.1); color: #fbbf24; border: 1px solid rgba(251, 191, 36, 0.2);"><i class="fas fa-exclamation-triangle"></i><span>Enter API key</span></span>';
                return;
            }
            container.innerHTML = '<span class="connection-status checking"><i class="fas fa-spinner fa-spin"></i><span>Checking...</span></span>';
            var customApiPath = apiPathEl ? apiPathEl.value.trim() : '/api';
            fetch('./api/indexers/validate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ preset: 'manual', api_key: apiKey, url: customUrl, api_path: customApiPath })
            })
                .then(function(r) { return r.json().then(function(data) { return { ok: r.ok, data: data }; }); })
                .then(function(result) {
                    var data = result.data || {};
                    container.innerHTML = data.valid === true
                        ? '<span class="connection-status success"><i class="fas fa-check-circle"></i><span>Connected</span></span>'
                        : '<span class="connection-status error"><i class="fas fa-times-circle"></i><span>' + (data.message || 'Validation failed') + '</span></span>';
                })
                .catch(function(err) {
                    container.innerHTML = '<span class="connection-status error"><i class="fas fa-times-circle"></i><span>' + (err.message || 'Connection failed') + '</span></span>';
                });
            return;
        }

        // Preset indexers
        if (!apiKey || apiKey.length < 10) {
            if (hasSavedKey) {
                container.innerHTML = '<span class="connection-status" style="background: rgba(148, 163, 184, 0.1); color: #94a3b8; border: 1px solid rgba(148, 163, 184, 0.2);"><i class="fas fa-check-circle"></i><span>API key saved. Leave blank to keep existing.</span></span>';
                return;
            }
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
                var data = result.data || {};
                container.innerHTML = data.valid === true
                    ? '<span class="connection-status success"><i class="fas fa-check-circle"></i><span>Connected</span></span>'
                    : '<span class="connection-status error"><i class="fas fa-times-circle"></i><span>' + (data.message || 'Invalid API key') + '</span></span>';
            })
            .catch(function(err) {
                container.innerHTML = '<span class="connection-status error"><i class="fas fa-times-circle"></i><span>' + (err.message || 'Connection failed') + '</span></span>';
            });
    };

    Forms.validateIndexerApiKey = function() {
        this.checkIndexerConnection();
    };

    // ── Save ───────────────────────────────────────────────────────────
    Forms.saveIndexerFromEditor = function() {
        if (!this._currentEditing || this._currentEditing.appType !== 'indexer') return;
        var enabledEl = document.getElementById('editor-enabled');
        var presetEl = document.getElementById('editor-preset');
        var nameEl = document.getElementById('editor-name');
        var keyEl = document.getElementById('editor-key');
        var urlEl = document.getElementById('editor-url');
        var apiPathEl = document.getElementById('editor-api-path');
        var enabled = enabledEl ? enabledEl.value === 'true' : true;
        var preset = presetEl ? presetEl.value : 'manual';
        var name = nameEl ? nameEl.value.trim() : '';
        var apiKey = keyEl ? keyEl.value.trim() : '';
        var indexerUrl = urlEl ? urlEl.value.trim() : '';
        var apiPath = apiPathEl ? apiPathEl.value.trim() : '/api';
        var isAdd = this._currentEditing.isAdd;
        var index = this._currentEditing.index;
        var pillsEl = document.getElementById('indexer-categories-pills');
        var categories = pillsEl ? Array.from(pillsEl.querySelectorAll('.indexer-category-pill')).map(function(el) { return parseInt(el.getAttribute('data-category-id'), 10); }).filter(function(id) { return !isNaN(id); }) : [];
        if (categories.length === 0) categories = Forms.getIndexerDefaultIdsForPreset(preset);

        var priorityEl = document.getElementById('editor-priority');
        var ihIdEl = document.getElementById('editor-indexer-hunt-id');
        var priority = parseInt(priorityEl ? priorityEl.value : '50', 10) || 50;
        if (priority < 1) priority = 1;
        if (priority > 99) priority = 99;
        var indexerHuntId = ihIdEl ? ihIdEl.value.trim() : '';

        var body = { name: name || 'Unnamed', preset: preset, api_key: apiKey, enabled: enabled, categories: categories, url: indexerUrl, api_path: apiPath, priority: priority };
        if (indexerHuntId) body.indexer_hunt_id = indexerHuntId;
        var apiBase = (window.SettingsForms && window.SettingsForms.getIndexersApiBase) ? window.SettingsForms.getIndexersApiBase() : './api/indexers';
        var editId = (window.SettingsForms && window.SettingsForms._currentEditing && window.SettingsForms._currentEditing.indexerId) ? window.SettingsForms._currentEditing.indexerId : index;
        var endpoint = isAdd ? apiBase : apiBase + '/' + editId;
        var method = isAdd ? 'POST' : 'PUT';
        fetch(endpoint, { method: method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (window.SettingsForms && window.SettingsForms.refreshIndexersList) {
                    window.SettingsForms.refreshIndexersList();
                }
                if (window.IndexerHunt && window.IndexerHunt._refreshIndexerInstanceStatus) {
                    window.IndexerHunt._refreshIndexerInstanceStatus();
                }
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification(isAdd ? 'Indexer added.' : 'Indexer updated.', 'success');
                }
                // Stay on editor after save
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
