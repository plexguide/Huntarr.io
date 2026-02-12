/**
 * Media Hunt Instance Editor – unified Movie + TV per-instance hunt settings.
 * Part 1: MovieHuntInstanceEditor (movie mode). Uses media-hunt-instance-editor-* container IDs.
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
            '<div class="editor-section-title"><div class="section-title-text"><span class="section-title-icon accent-connection"><i class="fas fa-info-circle"></i></span>INFORMATION</div></div>' +
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
            '<div class="editor-section-title"><div class="section-title-text"><span class="section-title-icon accent-search"><i class="fas fa-search"></i></span>SEARCH SETTINGS</div></div>' +
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

            '<div class="editor-section"><div class="editor-section-title"><div class="section-title-text"><span class="section-title-icon accent-stateful"><i class="fas fa-sync"></i></span>STATEFUL MANAGEMENT</div></div>' +
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

            '<div class="editor-section"><div class="editor-section-title"><div class="section-title-text"><span class="section-title-icon accent-additional"><i class="fas fa-sliders-h"></i></span>ADDITIONAL SETTINGS</div></div>' +
            '<div class="editor-field-group" style="margin-bottom: 12px;"><div style="padding: 10px 12px; background: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.5); border-radius: 6px; color: #fcd34d; font-size: 0.85rem; line-height: 1.4;"><i class="fas fa-exclamation-triangle" style="margin-right: 6px;"></i> Do not overwhelm your indexers. Contact them for advice!</div></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>Sleep Duration (Minutes)</label><input type="number" id="mh-editor-sleep-duration" value="' + sleepMins + '" min="' + _sleepMin + '" max="1440"></div>' +
            '<p class="editor-help-text">Time in minutes between processing cycles</p></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>API Cap - Hourly</label><input type="number" id="mh-editor-hourly-cap" value="' + safe.hourly_cap + '" min="1" max="400"></div>' +
            '<p class="editor-help-text">Maximum API requests per hour for this instance (10-20 recommended, max 400)</p></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item flex-row"><label>Monitored Only</label><label class="toggle-switch"><input type="checkbox" id="mh-editor-monitored-only"' + (safe.monitored_only ? ' checked' : '') + '><span class="toggle-slider"></span></label></div><p class="editor-help-text">Only search for monitored items</p></div></div>' +
            '<div class="editor-section"><div class="editor-section-title"><div class="section-title-text"><span class="section-title-icon accent-tags"><i class="fas fa-tags"></i></span>TAGS</div></div>' +
            '<div class="editor-field-group tag-sub-box"><div class="editor-setting-item flex-row"><label>Tag missing items</label><label class="toggle-switch"><input type="checkbox" id="mh-editor-tag-enable-missing"' + (safe.tag_enable_missing ? ' checked' : '') + '><span class="toggle-slider"></span></label></div>' +
            '<div class="editor-setting-item" style="margin-top: 6px;"><label>Missing Items Tag</label><input type="text" id="mh-editor-tag-missing" value="' + escapeAttr((safe.custom_tags && safe.custom_tags.missing) ? safe.custom_tags.missing : 'huntarr-missing') + '" placeholder="huntarr-missing" maxlength="25"></div>' +
            '<p class="editor-help-text">Tag added to movies when they\'re found by a missing search (max 25 characters)</p></div>' +
            '<div class="editor-field-group tag-sub-box mh-editor-upgrade-items-tag-section" style="display:' + (safe.upgrade_selection_method === 'tags' ? 'none' : 'block') + ';"><div class="editor-setting-item flex-row"><label>Tag upgrade items</label><label class="toggle-switch"><input type="checkbox" id="mh-editor-tag-enable-upgrade"' + (safe.tag_enable_upgrade ? ' checked' : '') + '><span class="toggle-slider"></span></label></div>' +
            '<div class="editor-setting-item" style="margin-top: 6px;"><label>Upgrade Items Tag</label><input type="text" id="mh-editor-tag-upgrade" value="' + escapeAttr((safe.custom_tags && safe.custom_tags.upgrade) ? safe.custom_tags.upgrade : 'huntarr-upgrade') + '" placeholder="huntarr-upgrade" maxlength="25"></div>' +
            '<p class="editor-help-text">Tag added to movies when they\'re upgraded in cutoff mode (max 25 characters). Not used when Upgrade Selection Method is Tags.</p></div>' +
            '<div class="editor-section" style="border: 1px solid rgba(231, 76, 60, 0.3); border-radius: 10px; padding: 14px; background: rgba(231, 76, 60, 0.06); margin-top: 16px;"><div class="editor-section-title"><div class="section-title-text"><span class="section-title-icon accent-exempt"><i class="fas fa-ban"></i></span>EXEMPT TAGS</div></div>' +
            '<p class="editor-help-text" style="margin-bottom: 12px;">Items with any of these tags are skipped for missing and upgrade searches. If the tag is removed in the app, Huntarr will process the item again. <a href="https://github.com/plexguide/Huntarr.io/issues/676" target="_blank" rel="noopener" style="color: #94a3b8;">#676</a></p>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>Add exempt tag</label><div style="display: flex; gap: 8px; align-items: center;"><input type="text" id="mh-editor-exempt-tag-input" placeholder="Type a tag to exempt..." style="flex: 1;" maxlength="50"><button type="button" class="btn-card" id="mh-editor-exempt-tag-add" style="padding: 8px 14px; white-space: nowrap;">Add</button></div></div>' +
            '<p class="editor-help-text" style="color: #94a3b8; font-size: 0.85rem;">Tag &quot;upgradinatorr&quot; cannot be added.</p>' +
            '<div id="mh-editor-exempt-tags-list" style="display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; min-height: 24px;">' + exemptTagsHtml + '</div></div></div></div>' +
            '<div class="editor-section"><div class="editor-section-title"><div class="section-title-text"><span class="section-title-icon accent-advanced"><i class="fas fa-code"></i></span>ADVANCED SETTINGS</div></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>API Timeout (seconds)</label><input type="number" id="mh-editor-api-timeout" value="' + safe.api_timeout + '" min="30" max="600"></div>' +
            '<p class="editor-help-text">Timeout for API requests (default: 120 seconds)</p></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>Command Wait Delay (seconds)</label><input type="number" id="mh-editor-cmd-wait-delay" value="' + safe.command_wait_delay + '" min="1" max="10"></div>' +
            '<p class="editor-help-text">Delay between command status checks (default: 1 second)</p></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>Command Wait Attempts</label><input type="number" id="mh-editor-cmd-wait-attempts" value="' + safe.command_wait_attempts + '" min="0" max="1800"></div>' +
            '<p class="editor-help-text">Maximum attempts to wait for command completion (default: 600)</p></div>' +
            '<div class="editor-field-group"><div class="editor-setting-item"><label>Max Download Queue Size</label><input type="number" id="mh-editor-max-queue-size" value="' + safe.max_download_queue_size + '" min="-1" max="1000"></div><p class="editor-help-text">Skip processing if queue size meets or exceeds this value (-1 = disabled)</p></div>' +
            '</div>' +

            /* ── Debug Manager ────────────────────────────────── */
            '<div class="editor-section mh-debug-manager-section" style="border: 2px solid rgba(239, 68, 68, 0.4); background: rgba(239, 68, 68, 0.06);">' +
            '<div class="editor-section-title"><div class="section-title-text"><span class="section-title-icon accent-exempt"><i class="fas fa-bug"></i></span>DEBUG MANAGER</div></div>' +
            '<p class="editor-help-text" style="margin-bottom: 16px; line-height: 1.5;">Dangerous operations for troubleshooting. These actions are <strong style="color: #f87171;">irreversible</strong>.</p>' +

            '<div class="editor-field-group" style="border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 8px; padding: 16px; background: rgba(239, 68, 68, 0.04);">' +
            '<div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;">' +
            '<div style="flex: 1; min-width: 200px;">' +
            '<strong style="color: #f1f5f9; font-size: 0.95rem;">Reset Movie Collection</strong>' +
            '<p class="editor-help-text" style="margin-top: 4px;">Permanently deletes <strong>all</strong> movies from this instance\'s Movie Collection. Requested movies, status history, and collection data will be wiped. This cannot be undone.</p>' +
            '</div>' +
            '<button type="button" class="btn-card delete" id="mh-editor-reset-collection" style="white-space: nowrap; background: #dc2626; color: white; border: 1px solid #dc2626; padding: 10px 20px; border-radius: 8px; font-weight: 600; cursor: pointer;"><i class="fas fa-trash-alt" style="margin-right: 6px;"></i>Reset Library</button>' +
            '</div></div>' +

            '</div>' +

            /* ── Reset Collection Confirmation Modal (hidden) ── */
            '<div id="mh-reset-collection-modal" style="display:none; position:fixed; inset:0; z-index:100000; align-items:center; justify-content:center;">' +
            '<div id="mh-reset-collection-backdrop" style="position:absolute; inset:0; background:rgba(0,0,0,0.6); backdrop-filter:blur(4px);"></div>' +
            '<div style="position:relative; background:#1e293b; border:1px solid rgba(239,68,68,0.4); border-radius:14px; padding:28px 32px; max-width:460px; width:90%; box-shadow:0 20px 60px rgba(0,0,0,0.5);">' +
            '<h3 style="margin:0 0 8px; color:#f87171; font-size:1.15rem;"><i class="fas fa-exclamation-triangle" style="margin-right:8px;"></i>Confirm Library Reset</h3>' +
            '<p style="color:#94a3b8; font-size:0.9rem; line-height:1.5; margin:0 0 18px;">This will permanently delete <strong style="color:#f1f5f9;">all movies</strong> in the Movie Collection for this instance. To confirm, type the instance name below:</p>' +
            '<p style="color:#f1f5f9; font-size:0.95rem; margin:0 0 10px; text-align:center;"><strong id="mh-reset-modal-instance-name">' + escapeHtml(safe.name) + '</strong></p>' +
            '<input type="text" id="mh-reset-collection-input" placeholder="Type instance name to confirm..." style="width:100%; padding:12px; border-radius:8px; border:1px solid rgba(239,68,68,0.3); background:rgba(15,23,42,0.8); color:white; margin-bottom:16px; box-sizing:border-box;" autocomplete="off">' +
            '<div id="mh-reset-collection-error" style="display:none; color:#f87171; font-size:0.85rem; margin-bottom:12px; text-align:center;"></div>' +
            '<div style="display:flex; gap:10px; justify-content:flex-end;">' +
            '<button type="button" id="mh-reset-collection-cancel" style="padding:10px 20px; border-radius:8px; border:1px solid rgba(148,163,184,0.3); background:rgba(148,163,184,0.1); color:#94a3b8; cursor:pointer; font-weight:500;">Cancel</button>' +
            '<button type="button" id="mh-reset-collection-confirm" style="padding:10px 20px; border-radius:8px; border:1px solid #dc2626; background:#dc2626; color:white; cursor:pointer; font-weight:600; opacity:0.5;" disabled><i class="fas fa-trash-alt" style="margin-right:6px;"></i>Delete All</button>' +
            '</div></div></div>' +

            '</div>';
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
            var saveBtn = document.getElementById('media-hunt-instance-editor-save');
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
                var saveBtn = document.getElementById('media-hunt-instance-editor-save');
                if (saveBtn) { saveBtn.disabled = false; saveBtn.classList.add('enabled'); }
            }
        });
    }

    function setupChangeDetection(container) {
        var saveBtn = document.getElementById('media-hunt-instance-editor-save');
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
                        var enabled = inst.enabled !== false;
                        var statusClass = enabled ? 'status-connected' : 'status-disabled';
                        var statusIcon = enabled ? 'fa-check-circle' : 'fa-minus-circle';
                        var card = document.createElement('div');
                        card.className = 'instance-card';
                        card.innerHTML =
                            '<div class="instance-card-header">' +
                            '<span class="instance-name"><i class="fas fa-film" style="margin-right: 8px;"></i>' + escapeHtml(inst.name || 'Instance ' + inst.id) + '</span>' +
                            '<div class="instance-status-icon ' + statusClass + '" title="' + (enabled ? 'Enabled' : 'Disabled') + '"><i class="fas ' + statusIcon + '"></i></div>' +
                            '</div>' +
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
                    var contentEl = document.getElementById('media-hunt-instance-editor-content');
                    if (contentEl) {
                        contentEl.innerHTML = buildEditorHtml(settings);
                        setupExemptTagsListeners(contentEl);
                        setupChangeDetection(contentEl);
                        loadMovieHuntStateStatus(_currentInstanceName);
                    }
                    // Update breadcrumb
                    var breadcrumbName = document.getElementById('media-hunt-instance-editor-instance-name');
                    if (breadcrumbName && _currentInstanceName) breadcrumbName.textContent = _currentInstanceName;
                    var appNameEl = document.getElementById('media-hunt-instance-editor-app-name');
                    if (appNameEl) appNameEl.textContent = 'Movie Hunt';
                    var appIcon = document.getElementById('media-hunt-instance-editor-app-icon');
                    if (appIcon) appIcon.className = 'fas fa-film';
                    var backBtn = document.getElementById('media-hunt-instance-editor-back');
                    var saveBtn = document.getElementById('media-hunt-instance-editor-save');
                    if (backBtn) backBtn.onclick = function() {
                        if (!_editorDirty) {
                            window.huntarrUI.switchSection('movie-hunt-settings');
                            return;
                        }
                        if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
                            window.HuntarrConfirm.show({
                                title: 'Unsaved Changes',
                                message: 'You have unsaved changes that will be lost if you leave.',
                                confirmLabel: 'Go Back',
                                cancelLabel: 'Leave',
                                onConfirm: function() {
                                    // Stay on the editor — modal just closes, user can save manually
                                },
                                onCancel: function() { window.huntarrUI.switchSection('movie-hunt-settings'); }
                            });
                        } else {
                            if (confirm('You have unsaved changes that will be lost. Leave anyway?')) {
                                window.huntarrUI.switchSection('movie-hunt-settings');
                            }
                        }
                    };
                    if (saveBtn) saveBtn.onclick = function() { self.saveEditor(); };
                    var resetBtn = document.getElementById('mh-editor-reset-state');
                    if (resetBtn) resetBtn.onclick = function() { self.resetState(instanceId); };

                    // Debug Manager: Reset Media Collection
                    self.setupResetCollectionModal(instanceId, _currentInstanceName);

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
            var saveBtn = document.getElementById('media-hunt-instance-editor-save');
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
            if (!instanceId) return;
            function doReset() {
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
            if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
                window.HuntarrConfirm.show({
                    title: 'Reset State',
                    message: 'Reset processed state for this instance? This clears the history of processed items.',
                    confirmLabel: 'Reset',
                    onConfirm: doReset
                });
            } else {
                if (!confirm('Reset processed state for this instance? This clears the history of processed items.')) return;
                doReset();
            }
        },

        setupResetCollectionModal: function(instanceId, instanceName) {
            var resetBtn = document.getElementById('mh-editor-reset-collection');
            var modal = document.getElementById('mh-reset-collection-modal');
            var backdrop = document.getElementById('mh-reset-collection-backdrop');
            var input = document.getElementById('mh-reset-collection-input');
            var confirmBtn = document.getElementById('mh-reset-collection-confirm');
            var cancelBtn = document.getElementById('mh-reset-collection-cancel');
            var errorEl = document.getElementById('mh-reset-collection-error');
            if (!resetBtn || !modal) return;

            var expectedName = (instanceName || '').trim();
            var self = this;

            function openModal() {
                if (input) { input.value = ''; }
                if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.style.opacity = '0.5'; }
                if (errorEl) { errorEl.style.display = 'none'; errorEl.textContent = ''; }
                modal.style.display = 'flex';
            }

            function closeModal() {
                modal.style.display = 'none';
                if (input) input.value = '';
            }

            resetBtn.onclick = openModal;
            if (cancelBtn) cancelBtn.onclick = closeModal;
            if (backdrop) backdrop.onclick = closeModal;

            // Enable/disable confirm button based on input match
            if (input && confirmBtn) {
                input.addEventListener('input', function() {
                    var val = (input.value || '').trim();
                    var match = val === expectedName;
                    confirmBtn.disabled = !match;
                    confirmBtn.style.opacity = match ? '1' : '0.5';
                    if (errorEl) { errorEl.style.display = 'none'; }
                });
                input.addEventListener('keydown', function(e) {
                    if (e.key === 'Enter' && !confirmBtn.disabled) {
                        confirmBtn.click();
                    }
                });
            }

            if (confirmBtn) {
                confirmBtn.onclick = function() {
                    var val = (input ? input.value : '').trim();
                    if (val !== expectedName) {
                        if (errorEl) {
                            errorEl.textContent = 'Instance name does not match. Please try again.';
                            errorEl.style.display = 'block';
                        }
                        return;
                    }
                    confirmBtn.disabled = true;
                    confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin" style="margin-right:6px;"></i>Deleting...';
                    self.resetCollection(instanceId, function(success) {
                        if (success) {
                            closeModal();
                        } else {
                            confirmBtn.disabled = false;
                            confirmBtn.innerHTML = '<i class="fas fa-trash-alt" style="margin-right:6px;"></i>Delete All';
                        }
                    });
                };
            }
        },

        resetCollection: function(instanceId, callback) {
            fetch(api('./api/movie-hunt/instances/' + instanceId + '/reset-collection'), {
                method: 'DELETE'
            })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.success) {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification(data.message || 'Media collection has been reset.', 'success');
                        } else { alert(data.message || 'Media collection has been reset.'); }
                        if (callback) callback(true);
                    } else {
                        var msg = data.message || data.error || 'Failed to reset collection.';
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification(msg, 'error');
                        } else { alert(msg); }
                        if (callback) callback(false);
                    }
                })
                .catch(function(err) {
                    var msg = (err && err.message) ? err.message : 'Request failed.';
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification(msg, 'error');
                    } else { alert(msg); }
                    if (callback) callback(false);
                });
        }
    };
})();

/**
 * Media Hunt Instance Editor – Part 2: TVHuntInstanceEditor (TV mode).
 * Uses same media-hunt-instance-editor-* container IDs.
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
            var saveBtn = document.getElementById('media-hunt-instance-editor-save');
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
                var saveBtn = document.getElementById('media-hunt-instance-editor-save');
                if (saveBtn) { saveBtn.disabled = false; saveBtn.classList.add('enabled'); }
            }
        });
    }

    function setupChangeDetection(container) {
        var saveBtn = document.getElementById('media-hunt-instance-editor-save');
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
                var contentEl = document.getElementById('media-hunt-instance-editor-content');
                if (contentEl) {
                    contentEl.innerHTML = buildEditorHtml(result.data);
                    setupExemptTagsListeners(contentEl);
                    setupChangeDetection(contentEl);
                }
                var breadcrumb = document.getElementById('media-hunt-instance-editor-instance-name');
                if (breadcrumb) breadcrumb.textContent = _currentInstanceName;
                var appNameEl = document.getElementById('media-hunt-instance-editor-app-name');
                if (appNameEl) appNameEl.textContent = 'TV Hunt';
                var appIcon = document.getElementById('media-hunt-instance-editor-app-icon');
                if (appIcon) appIcon.className = 'fas fa-tv';

                var backBtn = document.getElementById('media-hunt-instance-editor-back');
                var saveBtn = document.getElementById('media-hunt-instance-editor-save');
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
            var saveBtn = document.getElementById('media-hunt-instance-editor-save');
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
