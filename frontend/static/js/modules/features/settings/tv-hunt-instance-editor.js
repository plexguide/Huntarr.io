/**
 * TV Hunt Instance Editor: per-instance hunt settings.
 * Mirrors Movie Hunt editor but adapted for TV (episodes instead of movies).
 */
(function() {
    'use strict';

    var baseUrl = (typeof window !== 'undefined' && window.HUNTARR_BASE_URL) ? window.HUNTARR_BASE_URL.replace(/\/$/, '') : '';
    function api(path) { return (baseUrl || '') + (path.indexOf('./') === 0 ? path : './' + path); }
    function escapeHtml(s) { return s == null ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    function escapeAttr(s) { return s == null ? '' : String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

    var _currentInstanceId = null;
    var _currentInstanceName = null;
    var _editorDirty = false;
    var _sleepMin = 10;

    function buildEditorHtml(s) {
        if (!s || typeof s !== 'object' || s.error) s = {};
        var enabled = s.enabled !== false;
        var instanceIdStr = s.instance_id != null ? String(s.instance_id) : (_currentInstanceId != null ? String(_currentInstanceId) : '');
        var instanceName = s.name != null ? String(s.name).trim() : (_currentInstanceName ? _currentInstanceName : '');
        var safe = {
            enabled: enabled,
            name: instanceName,
            instance_id: instanceIdStr,
            hunt_missing_episodes: s.hunt_missing_episodes !== undefined ? s.hunt_missing_episodes : 1,
            hunt_upgrade_episodes: s.hunt_upgrade_episodes !== undefined ? s.hunt_upgrade_episodes : 0,
            hunt_missing_mode: s.hunt_missing_mode || 'seasons_packs',
            upgrade_mode: s.upgrade_mode || 'seasons_packs',
            upgrade_selection_method: (s.upgrade_selection_method || 'cutoff').toLowerCase(),
            upgrade_tag: (s.upgrade_tag || '').trim() || 'upgradinatorr',
            skip_future_episodes: s.skip_future_episodes !== false,
            state_management_mode: s.state_management_mode || 'custom',
            state_management_hours: s.state_management_hours !== undefined ? s.state_management_hours : 72,
            sleep_duration: s.sleep_duration !== undefined ? s.sleep_duration : 900,
            hourly_cap: s.hourly_cap !== undefined ? s.hourly_cap : 20,
            monitored_only: s.monitored_only !== false,
            exempt_tags: Array.isArray(s.exempt_tags) ? s.exempt_tags : [],
            api_timeout: s.api_timeout !== undefined ? s.api_timeout : 120,
            max_download_queue_size: s.max_download_queue_size !== undefined ? s.max_download_queue_size : -1,
        };
        var sleepMins = Math.round((safe.sleep_duration || 900) / 60);
        var upgradeTagDisplay = (safe.upgrade_selection_method || 'cutoff') === 'tags' ? 'flex' : 'none';
        var statefulBlockDisplay = safe.state_management_mode === 'disabled' ? 'none' : 'block';
        var infoStatusClass = safe.enabled ? 'th-info-status-enabled' : 'th-info-status-disabled';
        var infoStatusText = safe.enabled ? 'Enabled' : 'Disabled';

        var exemptTagsHtml = (safe.exempt_tags || []).map(function(tag) {
            return '<span class="exempt-tag-chip" data-tag="' + escapeAttr(tag) + '" style="display:inline-flex;align-items:center;gap:6px;padding:4px 8px;background:#dc2626;color:#fff;border-radius:6px;font-size:0.875rem;">' +
                '<span class="exempt-tag-remove" style="cursor:pointer;">&times;</span><span>' + escapeHtml(tag) + '</span></span>';
        }).join('');

        return '<div class="editor-grid">' +
            // INFORMATION
            '<div class="editor-section">' +
            '<div class="editor-section-header-inline"><div class="editor-section-title"><div class="section-title-text"><span class="section-title-icon accent-connection"><i class="fas fa-info-circle"></i></span>INFORMATION</div></div>' +
            '<span class="th-info-status-pill ' + infoStatusClass + '">' + (safe.enabled ? '<i class="fas fa-check-circle" style="margin-right:6px;"></i>' : '') + infoStatusText + '</span></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>Enable Status</label><select id="th-editor-enabled"><option value="true"' + (safe.enabled ? ' selected' : '') + '>Enabled</option><option value="false"' + (!safe.enabled ? ' selected' : '') + '>Disabled</option></select></div><p class="editor-help-text">Enable or disable this instance</p></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>Name</label><input type="text" id="th-editor-name" value="' + escapeAttr(safe.name) + '" placeholder="e.g. Main TV" maxlength="64"></div><p class="editor-help-text">A friendly name to identify this instance</p></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>Instance ID</label><input type="text" id="th-editor-instance-id" value="' + escapeAttr(safe.instance_id) + '" readonly disabled style="opacity:0.8;cursor:not-allowed;"></div><p class="editor-help-text">Stable identifier (auto-assigned, cannot change)</p></div>' +
            '</div>' +
            // SEARCH SETTINGS
            '<div class="editor-section"><div class="editor-section-title"><div class="section-title-text"><span class="section-title-icon accent-search"><i class="fas fa-search"></i></span>SEARCH SETTINGS</div></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>Missing Episode Search Count</label><input type="number" id="th-editor-missing-count" value="' + safe.hunt_missing_episodes + '"></div><p class="editor-help-text">Number of missing episodes to search per cycle</p></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>Missing Search Mode</label><select id="th-editor-missing-mode"><option value="seasons_packs"' + (safe.hunt_missing_mode === 'seasons_packs' ? ' selected' : '') + '>Season Packs</option><option value="episodes"' + (safe.hunt_missing_mode === 'episodes' ? ' selected' : '') + '>Individual Episodes</option></select></div><p class="editor-help-text">Season packs search for full seasons; episodes search individually</p></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>Upgrade Episode Search Count</label><input type="number" id="th-editor-upgrade-count" value="' + safe.hunt_upgrade_episodes + '"></div><p class="editor-help-text">Number of episodes to upgrade per cycle</p></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>Upgrade Selection Method</label><select id="th-editor-upgrade-method"><option value="cutoff"' + (safe.upgrade_selection_method === 'cutoff' ? ' selected' : '') + '>Cutoff unmet</option><option value="tags"' + (safe.upgrade_selection_method === 'tags' ? ' selected' : '') + '>Tags</option></select></div><p class="editor-help-text">Cutoff unmet: items below quality cutoff. Tags (Upgradinatorr): finds items without the tag, runs upgrades, adds tag.</p></div>' +
            '<div class="editor-field-group editor-upgrade-tag-group" style="display:' + upgradeTagDisplay + ';"><div class="editor-setting-item"><label>Upgrade Tag</label><input type="text" id="th-editor-upgrade-tag" value="' + escapeAttr(safe.upgrade_tag) + '" placeholder="e.g. upgradinatorr"></div><p class="editor-help-text">Tag name for upgrade tracking</p></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item flex-row"><label>Skip Future Episodes</label><label class="toggle-switch"><input type="checkbox" id="th-editor-skip-future"' + (safe.skip_future_episodes ? ' checked' : '') + '><span class="toggle-slider"></span></label></div><p class="editor-help-text">Skip episodes with air dates in the future</p></div>' +
            '</div>' +
            // STATEFUL MANAGEMENT
            '<div class="editor-section"><div class="editor-section-title"><div class="section-title-text"><span class="section-title-icon accent-stateful"><i class="fas fa-sync"></i></span>STATEFUL MANAGEMENT</div></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>State Management</label><select id="th-editor-state-mode"><option value="custom"' + (safe.state_management_mode === 'custom' ? ' selected' : '') + '>Enabled</option><option value="disabled"' + (safe.state_management_mode === 'disabled' ? ' selected' : '') + '>Disabled</option></select></div><p class="editor-help-text">Track processed items to avoid redundant searches</p></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>Reset Interval (Hours)</label><input type="number" id="th-editor-state-hours" value="' + safe.state_management_hours + '"></div><p class="editor-help-text">How long before re-searching a processed item (default: 72 hours)</p></div>' +
            '<div id="th-editor-stateful-block" class="editor-field-group" style="display:' + statefulBlockDisplay + ';">' +
            '<button type="button" class="btn-card delete btn-reset-state" id="th-editor-reset-state"><i class="fas fa-undo"></i> Reset Processed State Now</button>' +
            '<p class="editor-help-text" style="text-align:center;margin-top:-10px !important;">Clears processed items history for this instance</p></div></div>' +
            // ADDITIONAL SETTINGS
            '<div class="editor-section"><div class="editor-section-title"><div class="section-title-text"><span class="section-title-icon accent-additional"><i class="fas fa-sliders-h"></i></span>ADDITIONAL SETTINGS</div></div>' +
            '<div class="editor-field-group" style="margin-bottom:12px;"><div style="padding:10px 12px;background:rgba(245,158,11,0.15);border:1px solid rgba(245,158,11,0.5);border-radius:6px;color:#fcd34d;font-size:0.85rem;"><i class="fas fa-exclamation-triangle" style="margin-right:6px;"></i> Do not overwhelm your indexers. Contact them for advice!</div></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>Sleep Duration (Minutes)</label><input type="number" id="th-editor-sleep-duration" value="' + sleepMins + '" min="' + _sleepMin + '" max="1440"></div><p class="editor-help-text">Time between processing cycles</p></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>API Cap - Hourly</label><input type="number" id="th-editor-hourly-cap" value="' + safe.hourly_cap + '" min="1" max="400"></div><p class="editor-help-text">Max API requests per hour (10-20 recommended)</p></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item flex-row"><label>Monitored Only</label><label class="toggle-switch"><input type="checkbox" id="th-editor-monitored-only"' + (safe.monitored_only ? ' checked' : '') + '><span class="toggle-slider"></span></label></div><p class="editor-help-text">Only search for monitored episodes</p></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>Max Download Queue Size</label><input type="number" id="th-editor-max-queue-size" value="' + safe.max_download_queue_size + '" min="-1" max="1000"></div><p class="editor-help-text">Skip processing if queue meets or exceeds this value (-1 = disabled)</p></div>' +
            '</div>' +
            // EXEMPT TAGS
            '<div class="editor-section" style="border:1px solid rgba(231,76,60,0.3);border-radius:10px;padding:14px;background:rgba(231,76,60,0.06);margin-top:16px;"><div class="editor-section-title"><div class="section-title-text"><span class="section-title-icon accent-exempt"><i class="fas fa-ban"></i></span>EXEMPT TAGS</div></div>' +
            '<p class="editor-help-text" style="margin-bottom:12px;">Items with any of these tags are skipped for missing and upgrade searches.</p>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>Add exempt tag</label><div style="display:flex;gap:8px;align-items:center;"><input type="text" id="th-editor-exempt-tag-input" placeholder="Type a tag..." style="flex:1;" maxlength="50"><button type="button" class="btn-card" id="th-editor-exempt-tag-add" style="padding:8px 14px;white-space:nowrap;">Add</button></div></div>' +
            '<div id="th-editor-exempt-tags-list" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;min-height:24px;">' + exemptTagsHtml + '</div></div></div>' +
            // DEBUG MANAGER
            '<div class="editor-section" style="border:2px solid rgba(239,68,68,0.4);background:rgba(239,68,68,0.06);">' +
            '<div class="editor-section-title"><div class="section-title-text"><span class="section-title-icon accent-exempt"><i class="fas fa-bug"></i></span>DEBUG MANAGER</div></div>' +
            '<p class="editor-help-text" style="margin-bottom:16px;">Dangerous operations for troubleshooting. These are <strong style="color:#f87171;">irreversible</strong>.</p>' +
            '<div class="editor-field-group" style="border:1px solid rgba(239,68,68,0.2);border-radius:8px;padding:16px;background:rgba(239,68,68,0.04);">' +
            '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;">' +
            '<div style="flex:1;min-width:200px;"><strong style="color:#f1f5f9;font-size:0.95rem;">Reset TV Collection</strong>' +
            '<p class="editor-help-text" style="margin-top:4px;">Permanently deletes all TV series from this instance\'s collection.</p></div>' +
            '<button type="button" class="btn-card delete" id="th-editor-reset-collection" style="white-space:nowrap;background:#dc2626;color:white;border:1px solid #dc2626;padding:10px 20px;border-radius:8px;font-weight:600;cursor:pointer;"><i class="fas fa-trash-alt" style="margin-right:6px;"></i>Reset Library</button>' +
            '</div></div></div>' +
            '</div>';
    }

    function collectFormData() {
        var get = function(id) { var el = document.getElementById(id); return el ? el.value : null; };
        var getNum = function(id, def) { var v = get(id); if (v === null || v === '') return def; var n = parseInt(v, 10); return isNaN(n) ? def : n; };
        var getCheck = function(id) { var el = document.getElementById(id); return el ? !!el.checked : false; };
        var tags = [];
        var list = document.getElementById('th-editor-exempt-tags-list');
        if (list) list.querySelectorAll('.exempt-tag-chip').forEach(function(chip) { var t = chip.getAttribute('data-tag'); if (t) tags.push(t); });
        var enabledVal = get('th-editor-enabled');
        return {
            enabled: enabledVal === 'true',
            name: (get('th-editor-name') || '').trim() || 'Unnamed',
            hunt_missing_episodes: getNum('th-editor-missing-count', 1),
            hunt_upgrade_episodes: getNum('th-editor-upgrade-count', 0),
            hunt_missing_mode: get('th-editor-missing-mode') || 'seasons_packs',
            upgrade_mode: get('th-editor-missing-mode') || 'seasons_packs',
            upgrade_selection_method: (get('th-editor-upgrade-method') || 'cutoff').toLowerCase(),
            upgrade_tag: (get('th-editor-upgrade-tag') || '').trim(),
            skip_future_episodes: getCheck('th-editor-skip-future'),
            state_management_mode: get('th-editor-state-mode') || 'custom',
            state_management_hours: getNum('th-editor-state-hours', 72),
            sleep_duration: getNum('th-editor-sleep-duration', 15) * 60,
            hourly_cap: getNum('th-editor-hourly-cap', 20),
            exempt_tags: tags,
            monitored_only: getCheck('th-editor-monitored-only'),
            max_download_queue_size: getNum('th-editor-max-queue-size', -1),
        };
    }

    function setupExemptTagsListeners(container) {
        if (!container) return;
        var addBtn = container.querySelector('#th-editor-exempt-tag-add');
        var input = container.querySelector('#th-editor-exempt-tag-input');
        var list = container.querySelector('#th-editor-exempt-tags-list');
        if (!addBtn || !input || !list) return;
        function addTag() {
            var tag = (input.value || '').trim();
            if (!tag || tag.toLowerCase() === 'upgradinatorr') return;
            var existing = list.querySelectorAll('.exempt-tag-chip');
            for (var i = 0; i < existing.length; i++) { if (existing[i].getAttribute('data-tag') === tag) return; }
            var chip = document.createElement('span');
            chip.className = 'exempt-tag-chip';
            chip.setAttribute('data-tag', tag);
            chip.style.cssText = 'display:inline-flex;align-items:center;gap:6px;padding:4px 8px;background:#dc2626;color:#fff;border-radius:6px;font-size:0.875rem;';
            chip.innerHTML = '<span class="exempt-tag-remove" style="cursor:pointer;">&times;</span><span>' + escapeHtml(tag) + '</span>';
            list.appendChild(chip);
            input.value = '';
            _editorDirty = true;
            var saveBtn = document.getElementById('tv-hunt-instance-editor-save');
            if (saveBtn) { saveBtn.disabled = false; saveBtn.classList.add('enabled'); }
        }
        addBtn.addEventListener('click', addTag);
        input.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); addTag(); } });
        list.addEventListener('click', function(e) {
            var remove = e.target.classList.contains('exempt-tag-remove') ? e.target : e.target.closest('.exempt-tag-remove');
            if (remove) {
                var chip = remove.closest('.exempt-tag-chip');
                if (chip) chip.remove();
                _editorDirty = true;
                var saveBtn = document.getElementById('tv-hunt-instance-editor-save');
                if (saveBtn) { saveBtn.disabled = false; saveBtn.classList.add('enabled'); }
            }
        });
    }

    function setupChangeDetection(container) {
        var saveBtn = document.getElementById('tv-hunt-instance-editor-save');
        if (!container || !saveBtn) return;
        saveBtn.disabled = true;
        saveBtn.classList.remove('enabled');
        function markDirty() { _editorDirty = true; saveBtn.disabled = false; saveBtn.classList.add('enabled'); }
        container.addEventListener('input', markDirty);
        container.addEventListener('change', markDirty);
        var stateMode = document.getElementById('th-editor-state-mode');
        var upgradeMethod = document.getElementById('th-editor-upgrade-method');
        if (stateMode) stateMode.addEventListener('change', function() {
            var block = document.getElementById('th-editor-stateful-block');
            if (block) block.style.display = stateMode.value === 'disabled' ? 'none' : 'block';
        });
        if (upgradeMethod) upgradeMethod.addEventListener('change', function() {
            var group = container.querySelector('.editor-upgrade-tag-group');
            if (group) group.style.display = upgradeMethod.value === 'tags' ? 'flex' : 'none';
        });
        var enabledSelect = document.getElementById('th-editor-enabled');
        var statusPill = container ? container.querySelector('.th-info-status-pill') : null;
        if (enabledSelect && statusPill) {
            enabledSelect.addEventListener('change', function() {
                var on = enabledSelect.value === 'true';
                statusPill.className = 'th-info-status-pill ' + (on ? 'th-info-status-enabled' : 'th-info-status-disabled');
                statusPill.innerHTML = on ? '<i class="fas fa-check-circle" style="margin-right:6px;"></i>Enabled' : 'Disabled';
            });
        }
    }

    window.TVHuntInstanceEditor = {
        openEditor: function(instanceId, instanceName) {
            _currentInstanceId = instanceId;
            _currentInstanceName = instanceName || ('Instance ' + instanceId);
            _editorDirty = false;
            var self = this;
            fetch(api('./api/tv-hunt/instances/' + instanceId + '/settings'), { cache: 'no-store' })
            .then(function(r) { return r.json().then(function(data) { return { ok: r.ok, data: data }; }); })
            .then(function(result) {
                if (!result.ok || result.data.error) {
                    if (window.huntarrUI) window.huntarrUI.showNotification(result.data.error || 'Failed to load settings', 'error');
                    return;
                }
                var contentEl = document.getElementById('tv-hunt-instance-editor-content');
                if (contentEl) {
                    contentEl.innerHTML = buildEditorHtml(result.data);
                    setupExemptTagsListeners(contentEl);
                    setupChangeDetection(contentEl);
                }
                var breadcrumb = document.getElementById('th-ie-breadcrumb-instance-name');
                if (breadcrumb) breadcrumb.textContent = _currentInstanceName;

                var backBtn = document.getElementById('tv-hunt-instance-editor-back');
                var saveBtn = document.getElementById('tv-hunt-instance-editor-save');
                if (backBtn) backBtn.onclick = function() {
                    if (!_editorDirty) { window.huntarrUI.switchSection('tv-hunt-settings'); return; }
                    window.HuntarrConfirm.show({
                        title: 'Unsaved Changes',
                        message: 'You have unsaved changes that will be lost if you leave.',
                        confirmLabel: 'Go Back',
                        cancelLabel: 'Leave',
                        onConfirm: function() {},
                        onCancel: function() { window.huntarrUI.switchSection('tv-hunt-settings'); }
                    });
                };
                if (saveBtn) saveBtn.onclick = function() { self.saveEditor(); };

                var resetBtn = document.getElementById('th-editor-reset-state');
                if (resetBtn) resetBtn.onclick = function() { self.resetState(instanceId); };

                var resetCollBtn = document.getElementById('th-editor-reset-collection');
                if (resetCollBtn) resetCollBtn.onclick = function() { self.resetCollection(instanceId); };

                if (window.huntarrUI && window.huntarrUI.switchSection) {
                    window.huntarrUI.switchSection('tv-hunt-instance-editor');
                }
            })
            .catch(function(err) {
                if (window.huntarrUI) window.huntarrUI.showNotification('Failed to load settings: ' + (err.message || ''), 'error');
            });
        },

        saveEditor: function() {
            if (!_currentInstanceId) return;
            var payload = collectFormData();
            var saveBtn = document.getElementById('tv-hunt-instance-editor-save');
            if (saveBtn) { saveBtn.disabled = true; saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...'; }
            fetch(api('./api/tv-hunt/instances/' + _currentInstanceId + '/settings'), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (data.error) {
                    if (window.huntarrUI) window.huntarrUI.showNotification(data.error, 'error');
                    if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = '<i class="fas fa-save"></i> Save'; saveBtn.classList.add('enabled'); }
                    return;
                }
                _editorDirty = false;
                if (saveBtn) {
                    saveBtn.innerHTML = '<i class="fas fa-check"></i> Saved!';
                    saveBtn.classList.remove('enabled');
                    setTimeout(function() { saveBtn.innerHTML = '<i class="fas fa-save"></i> Save'; saveBtn.disabled = true; }, 2000);
                }
            })
            .catch(function() {
                if (window.huntarrUI) window.huntarrUI.showNotification('Failed to save settings', 'error');
                if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = '<i class="fas fa-save"></i> Save'; saveBtn.classList.add('enabled'); }
            });
        },

        resetState: function(instanceId) {
            window.HuntarrConfirm.show({
                title: 'Reset State',
                message: 'Reset processed state for this TV Hunt instance?',
                confirmLabel: 'Reset',
                onConfirm: function() {
                    fetch(api('./api/tv-hunt/instances/' + instanceId + '/reset-state'), { method: 'POST' })
                    .then(function(r) { return r.json(); })
                    .then(function(data) {
                        if (data.error) { window.huntarrUI.showNotification(data.error, 'error'); }
                        else { window.huntarrUI.showNotification('State reset.', 'success'); }
                    })
                    .catch(function() { window.huntarrUI.showNotification('Reset request failed', 'error'); });
                }
            });
        },

        resetCollection: function(instanceId) {
            window.HuntarrConfirm.show({
                title: 'Reset TV Collection',
                message: 'This will permanently delete ALL TV series from this instance\'s collection. This cannot be undone.',
                confirmLabel: 'Delete All',
                onConfirm: function() {
                    fetch(api('./api/tv-hunt/instances/' + instanceId + '/reset-collection'), { method: 'DELETE' })
                    .then(function(r) { return r.json(); })
                    .then(function(data) {
                        if (data.success) { window.huntarrUI.showNotification(data.message || 'TV collection reset.', 'success'); }
                        else { window.huntarrUI.showNotification(data.error || 'Failed to reset.', 'error'); }
                    })
                    .catch(function() { window.huntarrUI.showNotification('Request failed.', 'error'); });
                }
            });
        }
    };
})();
