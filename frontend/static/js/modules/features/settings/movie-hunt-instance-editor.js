/**
 * Movie Hunt instance editor: per-instance hunt settings (Search, Stateful, Additional).
 * Same blueprint as Radarr instance editor, minus Connection. Uses Movie Hunt instance ID.
 */
(function() {
    'use strict';

    var baseUrl = (typeof window !== 'undefined' && window.HUNTARR_BASE_URL) ? window.HUNTARR_BASE_URL.replace(/\/$/, '') : '';
    function api(path) {
        return (baseUrl || '') + (path.indexOf('./') === 0 ? path : './' + path);
    }
    function escapeHtml(s) {
        if (s == null) return '';
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function escapeAttr(s) {
        if (s == null) return '';
        return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    var _currentInstanceId = null;
    var _currentInstanceName = null;
    var _editorDirty = false;
    var _sleepMin = 10;

    function buildEditorHtml(s) {
        if (!s || typeof s !== 'object' || s.error) {
            s = {};
        }
        var safe = {
            hunt_missing_movies: s.hunt_missing_movies !== undefined ? s.hunt_missing_movies : 1,
            hunt_upgrade_movies: s.hunt_upgrade_movies !== undefined ? s.hunt_upgrade_movies : 0,
            upgrade_selection_method: (s.upgrade_selection_method || 'cutoff').toLowerCase(),
            upgrade_tag: (s.upgrade_tag || '').trim() || 'upgradinatorr',
            release_date_delay_days: s.release_date_delay_days !== undefined ? s.release_date_delay_days : 0,
            state_management_mode: s.state_management_mode || 'custom',
            state_management_hours: s.state_management_hours !== undefined ? s.state_management_hours : 72,
            sleep_duration: s.sleep_duration !== undefined ? s.sleep_duration : 900,
            hourly_cap: s.hourly_cap !== undefined ? s.hourly_cap : 20,
            monitored_only: s.monitored_only !== false,
            tag_processed_items: s.tag_processed_items !== false,
            tag_enable_missing: s.tag_enable_missing !== false,
            tag_enable_upgrade: s.tag_enable_upgrade !== false,
            tag_enable_upgraded: s.tag_enable_upgraded !== false,
            custom_tags: s.custom_tags || { missing: 'huntarr-missing', upgrade: 'huntarr-upgrade' },
            exempt_tags: Array.isArray(s.exempt_tags) ? s.exempt_tags : [],
            api_timeout: s.api_timeout !== undefined ? s.api_timeout : 120,
            command_wait_delay: s.command_wait_delay !== undefined ? s.command_wait_delay : 1,
            command_wait_attempts: s.command_wait_attempts !== undefined ? s.command_wait_attempts : 600,
            max_download_queue_size: s.max_download_queue_size !== undefined ? s.max_download_queue_size : -1,
            max_seed_queue_size: s.max_seed_queue_size !== undefined ? s.max_seed_queue_size : -1
        };
        var sleepMins = Math.round((safe.sleep_duration || 900) / 60);
        var upgradeTagGroupDisplay = (safe.upgrade_selection_method || 'cutoff') === 'tags' ? 'flex' : 'none';
        var statefulBlockDisplay = safe.state_management_mode === 'disabled' ? 'none' : 'block';

        var exemptTagsHtml = (safe.exempt_tags || []).map(function(tag) {
            return '<span class="exempt-tag-chip" data-tag="' + escapeAttr(tag) + '" style="display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px; background: #dc2626; color: #fff; border-radius: 6px; font-size: 0.875rem;">' +
                '<span class="exempt-tag-remove" style="cursor: pointer;">×</span><span>' + escapeHtml(tag) + '</span></span>';
        }).join('');

        return '<div class="editor-grid">' +
            '<div class="editor-section">' +
            '<div class="editor-section-title">Search Settings</div>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>Missing Search Count</label><input type="number" id="mh-editor-missing-count" value="' + safe.hunt_missing_movies + '"></div>' +
            '<p class="editor-help-text">Number of missing items to search for in each cycle</p></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>Upgrade Search Count</label><input type="number" id="mh-editor-upgrade-count" value="' + safe.hunt_upgrade_movies + '"></div>' +
            '<p class="editor-help-text">Number of items to upgrade in each cycle</p></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>Upgrade Selection Method</label>' +
            '<select id="mh-editor-upgrade-method"><option value="cutoff"' + (safe.upgrade_selection_method === 'cutoff' ? ' selected' : '') + '>Cutoff unmet</option><option value="tags"' + (safe.upgrade_selection_method === 'tags' ? ' selected' : '') + '>Tags</option></select></div>' +
            '<p class="editor-help-text"><strong>Cutoff unmet:</strong> Items below quality cutoff. <strong>Tags (Upgradinatorr):</strong> Huntarr finds items WITHOUT the tag, runs upgrade searches, then ADDS that tag when done.</p></div>' +
            '<div class="editor-field-group editor-upgrade-tag-group" style="display:' + upgradeTagGroupDisplay + ';"><div class="editor-setting-item"><label>Upgrade Tag</label>' +
            '<input type="text" id="mh-editor-upgrade-tag" value="' + escapeAttr(safe.upgrade_tag) + '" placeholder="e.g. upgradinatorr"></div>' +
            '<p class="editor-help-text">Tag name. Huntarr finds items that don’t have this tag, runs upgrade searches, then adds the tag when done.</p></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>Release Date Delay (Days)</label><input type="number" id="mh-editor-release-date-delay" value="' + safe.release_date_delay_days + '"></div>' +
            '<p class="editor-help-text">Only search for items released at least this many days ago</p></div></div>' +

            '<div class="editor-section"><div class="editor-section-title">Stateful Management</div>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>State Management</label>' +
            '<select id="mh-editor-state-mode"><option value="custom"' + (safe.state_management_mode === 'custom' ? ' selected' : '') + '>Enabled</option><option value="disabled"' + (safe.state_management_mode === 'disabled' ? ' selected' : '') + '>Disabled</option></select></div>' +
            '<p class="editor-help-text">Track processed items to avoid redundant searches</p></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>Reset Interval (Hours)</label><input type="number" id="mh-editor-state-hours" value="' + safe.state_management_hours + '"></div>' +
            '<p class="editor-help-text">How long to wait before re-searching a previously processed item (default: 72 hours)</p></div>' +
            '<div id="mh-editor-stateful-block" class="editor-field-group" style="display:' + statefulBlockDisplay + ';">' +
            '<button type="button" class="btn-card delete btn-reset-state" id="mh-editor-reset-state"><i class="fas fa-undo"></i> Reset Processed State Now</button>' +
            '<p class="editor-help-text" style="text-align: center;">Clears the history of processed items for this instance</p></div></div>' +

            '<div class="editor-section"><div class="editor-section-title">Additional Settings</div>' +
            '<div class="editor-field-group" style="margin-bottom: 12px;"><div style="padding: 10px 12px; background: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.5); border-radius: 6px; color: #fcd34d; font-size: 0.85rem;"><i class="fas fa-exclamation-triangle" style="margin-right: 6px;"></i> Do not overwhelm your indexers.</div></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>Sleep Duration (Minutes)</label><input type="number" id="mh-editor-sleep-duration" value="' + sleepMins + '" min="' + _sleepMin + '" max="1440"></div>' +
            '<p class="editor-help-text">Time in minutes between processing cycles</p></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>API Cap - Hourly</label><input type="number" id="mh-editor-hourly-cap" value="' + safe.hourly_cap + '" min="1" max="400"></div>' +
            '<p class="editor-help-text">Maximum API requests per hour (10-20 recommended)</p></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item flex-row"><label>Monitored Only</label><label class="toggle-switch"><input type="checkbox" id="mh-editor-monitored-only"' + (safe.monitored_only ? ' checked' : '') + '><span class="toggle-slider"></span></label></div><p class="editor-help-text">Only search for monitored items</p></div>' +
            '<div class="editor-section" style="border: 1px solid rgba(148, 163, 184, 0.2); border-radius: 10px; padding: 14px; margin-top: 16px;"><div class="editor-section-title">Exempt Tags</div>' +
            '<p class="editor-help-text" style="margin-bottom: 12px;">Items with any of these tags are skipped for missing and upgrade searches.</p>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>Add exempt tag</label><div style="display: flex; gap: 8px;"><input type="text" id="mh-editor-exempt-tag-input" placeholder="Type a tag..." style="flex: 1;" maxlength="50"><button type="button" class="btn-card" id="mh-editor-exempt-tag-add">Add</button></div></div>' +
            '<div id="mh-editor-exempt-tags-list" style="display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px;">' + exemptTagsHtml + '</div></div></div>' +
            '<div class="editor-section"><div class="editor-section-title">Advanced Settings</div>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>API Timeout (seconds)</label><input type="number" id="mh-editor-api-timeout" value="' + safe.api_timeout + '" min="30" max="600"></div></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>Command Wait Delay (seconds)</label><input type="number" id="mh-editor-cmd-wait-delay" value="' + safe.command_wait_delay + '" min="1" max="10"></div></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>Command Wait Attempts</label><input type="number" id="mh-editor-cmd-wait-attempts" value="' + safe.command_wait_attempts + '" min="0" max="1800"></div></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>Max Download Queue Size</label><input type="number" id="mh-editor-max-queue-size" value="' + safe.max_download_queue_size + '" min="-1" max="1000"></div><p class="editor-help-text">Skip processing if queue size meets or exceeds this value (-1 = disabled)</p></div>' +
            '</div></div>';
    }

    function collectFormData() {
        var get = function(id) { var el = document.getElementById(id); return el ? el.value : null; };
        var getNum = function(id, def) { var v = get(id); if (v === null || v === '') return def; var n = parseInt(v, 10); return isNaN(n) ? def : n; };
        var getCheck = function(id) { var el = document.getElementById(id); return el ? !!el.checked : false; };
        var tags = [];
        var list = document.getElementById('mh-editor-exempt-tags-list');
        if (list) {
            list.querySelectorAll('.exempt-tag-chip').forEach(function(chip) {
                var t = chip.getAttribute('data-tag');
                if (t) tags.push(t);
            });
        }
        return {
            hunt_missing_movies: getNum('mh-editor-missing-count', 1),
            hunt_upgrade_movies: getNum('mh-editor-upgrade-count', 0),
            upgrade_selection_method: (get('mh-editor-upgrade-method') || 'cutoff').toLowerCase(),
            upgrade_tag: (get('mh-editor-upgrade-tag') || '').trim(),
            release_date_delay_days: getNum('mh-editor-release-date-delay', 0),
            state_management_mode: get('mh-editor-state-mode') || 'custom',
            state_management_hours: getNum('mh-editor-state-hours', 72),
            sleep_duration: getNum('mh-editor-sleep-duration', 15) * 60,
            hourly_cap: getNum('mh-editor-hourly-cap', 20),
            exempt_tags: tags,
            monitored_only: getCheck('mh-editor-monitored-only'),
            tag_processed_items: true,
            tag_enable_missing: true,
            tag_enable_upgrade: true,
            tag_enable_upgraded: true,
            custom_tags: { missing: 'huntarr-missing', upgrade: 'huntarr-upgrade' },
            api_timeout: getNum('mh-editor-api-timeout', 120),
            command_wait_delay: getNum('mh-editor-cmd-wait-delay', 1),
            command_wait_attempts: getNum('mh-editor-cmd-wait-attempts', 600),
            max_download_queue_size: getNum('mh-editor-max-queue-size', -1),
            max_seed_queue_size: -1,
            seed_check_torrent_client: null
        };
    }

    function setupExemptTagsListeners(container) {
        if (!container) return;
        var addBtn = container.querySelector('#mh-editor-exempt-tag-add');
        var input = container.querySelector('#mh-editor-exempt-tag-input');
        var list = container.querySelector('#mh-editor-exempt-tags-list');
        if (!addBtn || !input || !list) return;
        function addTag() {
            var tag = (input.value || '').trim();
            if (!tag || tag.toLowerCase() === 'upgradinatorr') return;
            var existing = list.querySelectorAll('.exempt-tag-chip');
            for (var i = 0; i < existing.length; i++) {
                if ((existing[i].getAttribute('data-tag') || '') === tag) return;
            }
            var chip = document.createElement('span');
            chip.className = 'exempt-tag-chip';
            chip.setAttribute('data-tag', tag);
            chip.style.cssText = 'display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px; background: #dc2626; color: #fff; border-radius: 6px; font-size: 0.875rem;';
            chip.innerHTML = '<span class="exempt-tag-remove" style="cursor: pointer;">×</span><span>' + escapeHtml(tag) + '</span>';
            list.appendChild(chip);
            input.value = '';
            _editorDirty = true;
            var saveBtn = document.getElementById('movie-hunt-instance-editor-save');
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
                var saveBtn = document.getElementById('movie-hunt-instance-editor-save');
                if (saveBtn) { saveBtn.disabled = false; saveBtn.classList.add('enabled'); }
            }
        });
    }

    function setupChangeDetection(container) {
        var saveBtn = document.getElementById('movie-hunt-instance-editor-save');
        if (!container || !saveBtn) return;
        saveBtn.disabled = true;
        saveBtn.classList.remove('enabled');
        function markDirty() {
            _editorDirty = true;
            saveBtn.disabled = false;
            saveBtn.classList.add('enabled');
        }
        container.addEventListener('input', markDirty);
        container.addEventListener('change', markDirty);
        var stateMode = document.getElementById('mh-editor-state-mode');
        var upgradeMethod = document.getElementById('mh-editor-upgrade-method');
        if (stateMode) stateMode.addEventListener('change', function() {
            var block = document.getElementById('mh-editor-stateful-block');
            if (block) block.style.display = stateMode.value === 'disabled' ? 'none' : 'block';
        });
        if (upgradeMethod) upgradeMethod.addEventListener('change', function() {
            var group = container.querySelector('.editor-upgrade-tag-group');
            if (group) group.style.display = upgradeMethod.value === 'tags' ? 'flex' : 'none';
        });
    }

    window.MovieHuntInstanceEditor = {
        loadInstanceList: function() {
            var grid = document.getElementById('movie-hunt-settings-instances-grid');
            if (!grid) return;
            grid.innerHTML = '<div style="color: #94a3b8;">Loading...</div>';
            fetch(api('./api/movie-hunt/instances'), { cache: 'no-store' })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    var list = data.instances || [];
                    grid.innerHTML = '';
                    if (list.length === 0) {
                        grid.innerHTML = '<p class="editor-help-text">No instances yet. Add one from <strong>Instance Management</strong> in the sidebar.</p>';
                        return;
                    }
                    list.forEach(function(inst) {
                        var card = document.createElement('div');
                        card.className = 'instance-card';
                        card.innerHTML =
                            '<div class="instance-card-header"><span class="instance-name"><i class="fas fa-film" style="margin-right: 8px;"></i>' + escapeHtml(inst.name || 'Instance ' + inst.id) + '</span></div>' +
                            '<div class="instance-card-body"><div class="instance-detail"><i class="fas fa-hashtag"></i><span>ID ' + escapeHtml(inst.id) + '</span></div></div>' +
                            '<div class="instance-card-footer"><button type="button" class="btn-card edit" data-id="' + escapeAttr(String(inst.id)) + '" data-name="' + escapeAttr(inst.name || '') + '"><i class="fas fa-edit"></i> Edit</button></div>';
                        grid.appendChild(card);
                    });
                    grid.querySelectorAll('.btn-card.edit').forEach(function(btn) {
                        btn.addEventListener('click', function(e) {
                            e.stopPropagation();
                            window.MovieHuntInstanceEditor.openEditor(
                                btn.getAttribute('data-id'),
                                btn.getAttribute('data-name') || ('Instance ' + btn.getAttribute('data-id'))
                            );
                        });
                    });
                })
                .catch(function() {
                    grid.innerHTML = '<div style="color: #f87171;">Failed to load instances.</div>';
                });
        },

        openEditor: function(instanceId, instanceName) {
            _currentInstanceId = instanceId;
            _currentInstanceName = instanceName || ('Instance ' + instanceId);
            _editorDirty = false;
            var self = this;
            fetch(api('./api/movie-hunt/instances/' + instanceId + '/settings'), { cache: 'no-store' })
                .then(function(r) {
                    return r.json().then(function(data) { return { ok: r.ok, data: data }; });
                })
                .then(function(result) {
                    if (!result.ok || result.data.error) {
                        var msg = (result.data && result.data.error) ? result.data.error : 'Failed to load settings';
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification(msg, 'error');
                        }
                        return;
                    }
                    var settings = result.data;
                    var titleEl = document.getElementById('movie-hunt-instance-editor-title');
                    if (titleEl) titleEl.textContent = 'Movie Hunt – ' + _currentInstanceName;
                    var contentEl = document.getElementById('movie-hunt-instance-editor-content');
                    if (contentEl) {
                        contentEl.innerHTML = buildEditorHtml(settings);
                        setupExemptTagsListeners(contentEl);
                        setupChangeDetection(contentEl);
                    }
                    var backBtn = document.getElementById('movie-hunt-instance-editor-back');
                    var saveBtn = document.getElementById('movie-hunt-instance-editor-save');
                    if (backBtn) backBtn.onclick = function() {
                        if (_editorDirty && !confirm('You have unsaved changes. Leave anyway?')) return;
                        window.huntarrUI.switchSection('movie-hunt-settings');
                    };
                    if (saveBtn) saveBtn.onclick = function() { self.saveEditor(); };
                    var resetBtn = document.getElementById('mh-editor-reset-state');
                    if (resetBtn) resetBtn.onclick = function() { self.resetState(instanceId); };
                    if (window.huntarrUI && window.huntarrUI.switchSection) {
                        window.huntarrUI.switchSection('movie-hunt-instance-editor');
                    }
                })
                .catch(function(err) {
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification('Failed to load settings: ' + (err.message || 'Request failed'), 'error');
                    }
                });
        },

        saveEditor: function() {
            if (!_currentInstanceId) return;
            var payload = collectFormData();
            var saveBtn = document.getElementById('movie-hunt-instance-editor-save');
            if (saveBtn) { saveBtn.disabled = true; saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...'; }
            var self = this;
            fetch(api('./api/movie-hunt/instances/' + _currentInstanceId + '/settings'), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.error) {
                        if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification(data.error, 'error');
                        if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = '<i class="fas fa-save"></i> Save'; saveBtn.classList.add('enabled'); }
                        return;
                    }
                    _editorDirty = false;
                    if (saveBtn) {
                        saveBtn.innerHTML = '<i class="fas fa-check"></i> Saved!';
                        saveBtn.classList.remove('enabled');
                        setTimeout(function() {
                            saveBtn.innerHTML = '<i class="fas fa-save"></i> Save';
                            saveBtn.disabled = true;
                        }, 2000);
                    }
                })
                .catch(function() {
                    if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Failed to save settings', 'error');
                    if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = '<i class="fas fa-save"></i> Save'; saveBtn.classList.add('enabled'); }
                });
        },

        resetState: function(instanceId) {
            if (!instanceId || !confirm('Reset processed state for this instance? This clears the history of processed items.')) return;
            fetch(api('./api/movie-hunt/instances/' + instanceId + '/reset-state'), { method: 'POST' })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.error && window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification(data.error, 'error');
                    } else if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification('State reset.', 'success');
                    }
                })
                .catch(function() {
                    if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Reset request failed', 'error');
                });
        }
    };
})();
