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
        var enabled = s.enabled !== false;
        var instanceIdStr = (s.instance_id != null && s.instance_id !== '') ? String(s.instance_id) : (_currentInstanceId != null ? String(_currentInstanceId) : '');
        var instanceName = (s.name != null && s.name !== '') ? String(s.name).trim() : (_currentInstanceName != null ? String(_currentInstanceName).trim() : '');
        var safe = {
            enabled: enabled,
            name: instanceName,
            instance_id: instanceIdStr,
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

        var infoStatusClass = safe.enabled ? 'mh-info-status-enabled' : 'mh-info-status-disabled';
        var infoStatusText = safe.enabled ? 'Enabled' : 'Disabled';
        var infoStatusIcon = safe.enabled ? '<i class="fas fa-check-circle" style="margin-right: 6px;"></i>' : '';

        var enableLabelIcon = safe.enabled
            ? '<span id="mh-editor-enabled-icon"><i class="fas fa-check-circle" style="color: #10b981; margin-right: 6px;"></i></span>'
            : '<span id="mh-editor-enabled-icon"><i class="fas fa-times-circle" style="color: #6b7280; margin-right: 6px;"></i></span>';

        return '<div class="editor-grid">' +
            '<div class="editor-section mh-information-section">' +
            '<div class="editor-section-header-inline">' +
            '<div class="editor-section-title">Information</div>' +
            '<span class="mh-info-status-pill ' + infoStatusClass + '">' + infoStatusIcon + infoStatusText + '</span>' +
            '</div>' +
            '<div class="editor-field-group">' +
            '<div class="editor-setting-item"><label>' + enableLabelIcon + 'Enable Status</label>' +
            '<select id="mh-editor-enabled"><option value="true"' + (safe.enabled ? ' selected' : '') + '>Enabled</option><option value="false"' + (!safe.enabled ? ' selected' : '') + '>Disabled</option></select></div>' +
            '<p class="editor-help-text">Enable or disable this instance</p></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>Name</label>' +
            '<input type="text" id="mh-editor-name" value="' + escapeAttr(safe.name) + '" placeholder="e.g. Main" maxlength="64"></div>' +
            '<p class="editor-help-text">A friendly name to identify this instance</p></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>Instance Identifier</label>' +
            '<input type="text" id="mh-editor-instance-id" value="' + escapeAttr(safe.instance_id) + '" readonly disabled style="opacity: 0.8; cursor: not-allowed;"></div>' +
            '<p class="editor-help-text">Stable identifier for this instance (assigned automatically; cannot be changed)</p></div>' +
            '</div>' +
            '<div class="editor-section">' +
            '<div class="editor-section-title">Search Settings</div>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>Missing Search Count</label><input type="number" id="mh-editor-missing-count" value="' + safe.hunt_missing_movies + '"></div>' +
            '<p class="editor-help-text">Number of missing items to search for in each cycle</p></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>Upgrade Search Count</label><input type="number" id="mh-editor-upgrade-count" value="' + safe.hunt_upgrade_movies + '"></div>' +
            '<p class="editor-help-text">Number of items to upgrade in each cycle</p></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>Upgrade Selection Method</label>' +
            '<select id="mh-editor-upgrade-method"><option value="cutoff"' + (safe.upgrade_selection_method === 'cutoff' ? ' selected' : '') + '>Cutoff unmet</option><option value="tags"' + (safe.upgrade_selection_method === 'tags' ? ' selected' : '') + '>Tags</option></select></div>' +
            '<p class="editor-help-text"><strong>Cutoff unmet:</strong> Items below quality cutoff (default). Huntarr does not add any upgrade tag. <strong>Tags (Upgradinatorr):</strong> Huntarr finds items WITHOUT the tag below, runs upgrade searches, then ADDS that tag when done. <a href="https://trash-guides.info/" target="_blank" rel="noopener" style="color: #2ecc71; text-decoration: underline;">TrashGuides</a> | <a href="https://github.com/angrycuban13/Just-A-Bunch-Of-Starr-Scripts/blob/main/Upgradinatorr/README.md#requirements" target="_blank" rel="noopener" style="color: #e74c3c; text-decoration: underline;">Upgradinatorr</a></p></div>' +
            '<div class="editor-field-group editor-upgrade-tag-group" style="display:' + upgradeTagGroupDisplay + ';"><div class="editor-setting-item"><label>Upgrade Tag</label>' +
            '<input type="text" id="mh-editor-upgrade-tag" value="' + escapeAttr(safe.upgrade_tag) + '" placeholder="e.g. upgradinatorr"></div>' +
            '<p class="editor-help-text">Tag name. Huntarr finds movies that don’t have this tag, runs upgrade searches, then adds the tag when done (tracks what\'s been processed). <a href="https://trash-guides.info/" target="_blank" rel="noopener" style="color: #2ecc71; text-decoration: underline;">TrashGuides</a> | <a href="https://github.com/angrycuban13/Just-A-Bunch-Of-Starr-Scripts/blob/main/Upgradinatorr/README.md#requirements" target="_blank" rel="noopener" style="color: #e74c3c; text-decoration: underline;">Upgradinatorr</a></p></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>Release Date Delay (Days)</label><input type="number" id="mh-editor-release-date-delay" value="' + safe.release_date_delay_days + '"></div>' +
            '<p class="editor-help-text">Only search for items released at least this many days ago</p></div></div>' +

            '<div class="editor-section"><div class="editor-section-title">Stateful Management</div>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>State Management</label>' +
            '<select id="mh-editor-state-mode"><option value="custom"' + (safe.state_management_mode === 'custom' ? ' selected' : '') + '>Enabled</option><option value="disabled"' + (safe.state_management_mode === 'disabled' ? ' selected' : '') + '>Disabled</option></select></div>' +
            '<p class="editor-help-text">Track processed items to avoid redundant searches</p></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>Reset Interval (Hours)</label><input type="number" id="mh-editor-state-hours" value="' + safe.state_management_hours + '"></div>' +
            '<p class="editor-help-text">How long to wait before re-searching a previously processed item (default: 72 hours / 3 days)</p></div>' +
            '<div id="mh-editor-stateful-block" class="editor-field-group" style="display:' + statefulBlockDisplay + ';">' +
            '<button type="button" class="btn-card delete btn-reset-state" id="mh-editor-reset-state"><i class="fas fa-undo"></i> Reset Processed State Now</button>' +
            '<p class="editor-help-text" style="text-align: center; margin-top: -10px !important;">Clears the history of processed items for this instance</p>' +
            '<div id="mh-state-status-display" style="margin-top: 15px; padding: 12px; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 8px;">' +
            '<div style="display: flex; align-items: center; justify-content: center; gap: 8px; color: #10b981; font-weight: 500; margin-bottom: 4px;"><i class="fas fa-check-circle"></i><span>Active - Tracked Items: <span id="mh-tracked-items-count">Loading...</span></span></div>' +
            '<div style="text-align: center; color: #94a3b8; font-size: 0.9rem;">Next Reset: <span id="mh-next-reset-time">Loading...</span></div></div></div></div>' +

            '<div class="editor-section"><div class="editor-section-title">Additional Settings</div>' +
            '<div class="editor-field-group" style="margin-bottom: 12px;"><div style="padding: 10px 12px; background: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.5); border-radius: 6px; color: #fcd34d; font-size: 0.85rem; line-height: 1.4;"><i class="fas fa-exclamation-triangle" style="margin-right: 6px;"></i> Do not overwhelm your indexers. Contact them for advice!</div></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>Sleep Duration (Minutes)</label><input type="number" id="mh-editor-sleep-duration" value="' + sleepMins + '" min="' + _sleepMin + '" max="1440"></div>' +
            '<p class="editor-help-text">Time in minutes between processing cycles</p></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>API Cap - Hourly</label><input type="number" id="mh-editor-hourly-cap" value="' + safe.hourly_cap + '" min="1" max="400"></div>' +
            '<p class="editor-help-text">Maximum API requests per hour for this instance (10-20 recommended, max 400)</p></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item flex-row"><label>Monitored Only</label><label class="toggle-switch"><input type="checkbox" id="mh-editor-monitored-only"' + (safe.monitored_only ? ' checked' : '') + '><span class="toggle-slider"></span></label></div><p class="editor-help-text">Only search for monitored items</p></div></div>' +
            '<div class="editor-section"><div class="editor-section-title">Tags</div>' +
            '<div class="editor-field-group"><div class="editor-setting-item flex-row"><label>Tag missing items</label><label class="toggle-switch"><input type="checkbox" id="mh-editor-tag-enable-missing"' + (safe.tag_enable_missing ? ' checked' : '') + '><span class="toggle-slider"></span></label></div>' +
            '<div class="editor-setting-item" style="margin-top: 6px;"><label>Missing Items Tag</label><input type="text" id="mh-editor-tag-missing" value="' + escapeAttr((safe.custom_tags && safe.custom_tags.missing) ? safe.custom_tags.missing : 'huntarr-missing') + '" placeholder="huntarr-missing" maxlength="25"></div>' +
            '<p class="editor-help-text">Tag added to movies when they\'re found by a missing search (max 25 characters)</p></div>' +
            '<div class="editor-field-group mh-editor-upgrade-items-tag-section" style="display:' + (safe.upgrade_selection_method === 'tags' ? 'none' : 'block') + ';"><div class="editor-setting-item flex-row"><label>Tag upgrade items</label><label class="toggle-switch"><input type="checkbox" id="mh-editor-tag-enable-upgrade"' + (safe.tag_enable_upgrade ? ' checked' : '') + '><span class="toggle-slider"></span></label></div>' +
            '<div class="editor-setting-item" style="margin-top: 6px;"><label>Upgrade Items Tag</label><input type="text" id="mh-editor-tag-upgrade" value="' + escapeAttr((safe.custom_tags && safe.custom_tags.upgrade) ? safe.custom_tags.upgrade : 'huntarr-upgrade') + '" placeholder="huntarr-upgrade" maxlength="25"></div>' +
            '<p class="editor-help-text">Tag added to movies when they\'re upgraded in cutoff mode (max 25 characters). Not used when Upgrade Selection Method is Tags.</p></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item flex-row"><label>Tag upgraded items</label><label class="toggle-switch"><input type="checkbox" id="mh-editor-tag-enable-upgraded"' + (safe.tag_enable_upgraded ? ' checked' : '') + '><span class="toggle-slider"></span></label></div>' +
            '<p class="editor-help-text">Tag added to movies after an upgrade completes (tracks what\'s been upgraded)</p></div>' +
            '<div class="editor-section" style="border: 1px solid rgba(231, 76, 60, 0.3); border-radius: 10px; padding: 14px; background: rgba(231, 76, 60, 0.06); margin-top: 16px;"><div class="editor-section-title">Exempt Tags</div>' +
            '<p class="editor-help-text" style="margin-bottom: 12px;">Items with any of these tags are skipped for missing and upgrade searches. If the tag is removed in the app, Huntarr will process the item again. <a href="https://github.com/plexguide/Huntarr.io/issues/676" target="_blank" rel="noopener" style="color: #94a3b8;">#676</a></p>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>Add exempt tag</label><div style="display: flex; gap: 8px; align-items: center;"><input type="text" id="mh-editor-exempt-tag-input" placeholder="Type a tag to exempt..." style="flex: 1;" maxlength="50"><button type="button" class="btn-card" id="mh-editor-exempt-tag-add" style="padding: 8px 14px; white-space: nowrap;">Add</button></div></div>' +
            '<p class="editor-help-text" style="color: #94a3b8; font-size: 0.85rem;">Tag &quot;upgradinatorr&quot; cannot be added.</p>' +
            '<div id="mh-editor-exempt-tags-list" style="display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; min-height: 24px;">' + exemptTagsHtml + '</div></div></div></div>' +
            '<div class="editor-section"><div class="editor-section-title">Advanced Settings</div>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>API Timeout (seconds)</label><input type="number" id="mh-editor-api-timeout" value="' + safe.api_timeout + '" min="30" max="600"></div>' +
            '<p class="editor-help-text">Timeout for API requests (default: 120 seconds)</p></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>Command Wait Delay (seconds)</label><input type="number" id="mh-editor-cmd-wait-delay" value="' + safe.command_wait_delay + '" min="1" max="10"></div>' +
            '<p class="editor-help-text">Delay between command status checks (default: 1 second)</p></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>Command Wait Attempts</label><input type="number" id="mh-editor-cmd-wait-attempts" value="' + safe.command_wait_attempts + '" min="0" max="1800"></div>' +
            '<p class="editor-help-text">Maximum attempts to wait for command completion (default: 600)</p></div>' +
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
        var tagMissing = (get('mh-editor-tag-missing') || '').trim() || 'huntarr-missing';
        var tagUpgrade = (get('mh-editor-tag-upgrade') || '').trim() || 'huntarr-upgrade';
        var enabledVal = get('mh-editor-enabled');
        var enabled = enabledVal === 'true' || enabledVal === true;
        var nameVal = (get('mh-editor-name') || '').trim() || 'Unnamed';
        return {
            enabled: enabled,
            name: nameVal,
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
            tag_enable_missing: getCheck('mh-editor-tag-enable-missing'),
            tag_enable_upgrade: getCheck('mh-editor-tag-enable-upgrade'),
            tag_enable_upgraded: getCheck('mh-editor-tag-enable-upgraded'),
            custom_tags: { missing: tagMissing, upgrade: tagUpgrade },
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
            var upgradeItemsSection = container.querySelector('.mh-editor-upgrade-items-tag-section');
            if (upgradeItemsSection) upgradeItemsSection.style.display = upgradeMethod.value === 'tags' ? 'none' : 'block';
        });
        var enabledSelect = document.getElementById('mh-editor-enabled');
        var statusPill = container ? container.querySelector('.mh-info-status-pill') : null;
        var enabledIconEl = document.getElementById('mh-editor-enabled-icon');
        if (enabledSelect && statusPill) {
            enabledSelect.addEventListener('change', function() {
                var on = enabledSelect.value === 'true';
                statusPill.className = 'mh-info-status-pill ' + (on ? 'mh-info-status-enabled' : 'mh-info-status-disabled');
                statusPill.innerHTML = on ? '<i class="fas fa-check-circle" style="margin-right: 6px;"></i>Enabled' : 'Disabled';
                if (enabledIconEl) {
                    enabledIconEl.innerHTML = on ? '<i class="fas fa-check-circle" style="color: #10b981; margin-right: 6px;"></i>' : '<i class="fas fa-times-circle" style="color: #6b7280; margin-right: 6px;"></i>';
                }
            });
        }
    }

    function loadMovieHuntStateStatus(instanceName) {
        var countEl = document.getElementById('mh-tracked-items-count');
        var nextEl = document.getElementById('mh-next-reset-time');
        if (!countEl || !nextEl || !instanceName) return;
        var url = api('./api/stateful/summary?app_type=movie_hunt&instance_name=' + encodeURIComponent(instanceName));
        fetch(url, { cache: 'no-store' })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                countEl.textContent = (data && data.processed_count !== undefined) ? data.processed_count : 0;
                nextEl.textContent = (data && data.next_reset_time) ? data.next_reset_time : 'N/A';
            })
            .catch(function() {
                countEl.textContent = '0';
                nextEl.textContent = 'N/A';
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
                        grid.innerHTML = '<p class="editor-help-text">No instances yet. Add one using the <strong>Adding Instance</strong> card below.</p>';
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
                        loadMovieHuntStateStatus(_currentInstanceName);
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
