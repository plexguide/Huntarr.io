/**
 * TV Management settings – standalone module for TV Hunt instances.
 * Handles episode naming, folder structure, and token builders.
 */
(function() {
    'use strict';

    function escapeHtml(s) {
        if (s == null) return '';
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    var _dirty = false;
    var _data = null;

    var COLON_DEMO_SAMPLE = 'Series Title: The Subtitle';
    var COLON_DEMO_RESULTS = {
        'Smart Replace': 'Series Title - The Subtitle',
        'Delete': 'Series Title The Subtitle',
        'Replace with Dash': 'Series Title- The Subtitle',
        'Replace with Space Dash': 'Series Title - The Subtitle',
        'Replace with Space Dash Space': 'Series Title - The Subtitle'
    };

    function defaults() {
        return {
            rename_episodes: true,
            replace_illegal_characters: true,
            colon_replacement: 'Smart Replace',
            standard_episode_format: "{Series TitleYear} - S{season:00}E{episode:00} - {Episode CleanTitle} {Quality Full}",
            daily_episode_format: "{Series TitleYear} - {Air-Date} - {Episode CleanTitle} {Quality Full}",
            anime_episode_format: "{Series TitleYear} - S{season:00}E{episode:00} - {absolute:000} - {Episode CleanTitle} {Quality Full}",
            series_folder_format: '{Series TitleYear}',
            season_folder_format: 'Season {season:00}',
            specials_folder_format: 'Specials',
            multi_episode_style: 'Prefixed Range',
            minimum_free_space_gb: 10,
            rss_sync_enabled: true,
            rss_sync_interval_minutes: 15
        };
    }

    function generateFormHtml(data) {
        var d = data || defaults();
        var renameEpisodes = d.rename_episodes !== false;
        var replaceIllegal = d.replace_illegal_characters !== false;
        var colonRep = escapeHtml(String(d.colon_replacement || 'Smart Replace').trim());

        var stdEpFmt = escapeHtml(String(d.standard_episode_format || '').trim() || defaults().standard_episode_format);
        var dailyFmt = escapeHtml(String(d.daily_episode_format || '').trim() || defaults().daily_episode_format);
        var animeFmt = escapeHtml(String(d.anime_episode_format || '').trim() || defaults().anime_episode_format);
        var seriesFolderFmt = escapeHtml(String(d.series_folder_format || '').trim() || defaults().series_folder_format);
        var seasonFolderFmt = escapeHtml(String(d.season_folder_format || '').trim() || defaults().season_folder_format);
        var specialsFolderFmt = escapeHtml(String(d.specials_folder_format || '').trim() || defaults().specials_folder_format);
        var multiStyle = escapeHtml(String(d.multi_episode_style || 'Prefixed Range').trim());
        var minSpace = typeof d.minimum_free_space_gb === 'number' ? d.minimum_free_space_gb : 10;
        var rssEnabled = d.rss_sync_enabled !== false;
        var rssInterval = typeof d.rss_sync_interval_minutes === 'number' ? d.rss_sync_interval_minutes : 15;

        var colonOptionList = ['Smart Replace', 'Delete', 'Replace with Dash', 'Replace with Space Dash', 'Replace with Space Dash Space'];
        var colonOptions = colonOptionList.map(function(opt) {
            var v = escapeHtml(opt);
            var sel = (opt === (d.colon_replacement || 'Smart Replace')) ? ' selected' : '';
            return '<option value="' + v + '"' + sel + '>' + v + '</option>';
        }).join('');

        var multiStyleOptions = ['Extend', 'Duplicate', 'Repeat', 'Scene', 'Range', 'Prefixed Range'].map(function(opt) {
            var v = escapeHtml(opt);
            var sel = (opt === (d.multi_episode_style || 'Prefixed Range')) ? ' selected' : '';
            return '<option value="' + v + '"' + sel + '>' + v + '</option>';
        }).join('');

        return '<div class="editor-grid">' +
            '<div class="editor-section">' +
            '<div class="editor-section-title">Episode Naming</div>' +
            '<div class="editor-field-group">' +
            '<div class="editor-setting-item flex-row">' +
            '<label for="tv-mgmt-rename">Rename Episodes</label>' +
            '<label class="toggle-switch"><input type="checkbox" id="tv-mgmt-rename"' + (renameEpisodes ? ' checked' : '') + '><span class="toggle-slider"></span></label>' +
            '</div><p class="editor-help-text">TV Hunt will use the existing file name if renaming is disabled</p></div>' +
            '<div class="editor-field-group">' +
            '<div class="editor-setting-item flex-row">' +
            '<label for="tv-mgmt-replace-illegal">Replace Illegal Characters</label>' +
            '<label class="toggle-switch"><input type="checkbox" id="tv-mgmt-replace-illegal"' + (replaceIllegal ? ' checked' : '') + '><span class="toggle-slider"></span></label>' +
            '</div><p class="editor-help-text">Replace illegal characters. If unchecked, TV Hunt will remove them instead</p></div>' +
            '<div class="editor-field-group">' +
            '<label for="tv-mgmt-colon">Colon Replacement</label>' +
            '<select id="tv-mgmt-colon">' + colonOptions + '</select>' +
            '<p class="editor-help-text">Change how TV Hunt handles colon replacement. Smart Replace uses a dash or space-dash depending on the name.</p>' +
            '<p class="editor-help-text tv-mgmt-colon-demo" id="tv-mgmt-colon-demo"></p></div>' +

            '<div class="editor-field-group">' +
            '<span class="tv-mgmt-label-inline"><label for="tv-mgmt-standard-format">Standard Episode Format</label> <a href="https://trash-guides.info/Sonarr/Sonarr-recommended-naming-scheme/#episode-format" target="_blank" rel="noopener noreferrer" class="tv-mgmt-doc-link" title="Recommended naming scheme (TRaSH Guides)"><i class="fas fa-question-circle"></i></a></span>' +
            '<div class="tv-mgmt-input-wrap"><input type="text" id="tv-mgmt-standard-format" value="' + stdEpFmt + '" placeholder="{Series TitleYear} - S{season:00}E{episode:00} - {Episode CleanTitle} {Quality Full}"><button type="button" class="token-builder-btn" data-target="tv-mgmt-standard-format" data-builder="tv-episode" title="Open Token Builder"><i class="fas fa-puzzle-piece"></i></button></div>' +
            '<p class="editor-help-text">Single: The Series Title! (2010) - S01E01 - Episode Title WEBDL-1080p Proper</p></div>' +

            '<div class="editor-field-group">' +
            '<span class="tv-mgmt-label-inline"><label for="tv-mgmt-daily-format">Daily Episode Format</label> <a href="https://trash-guides.info/Sonarr/Sonarr-recommended-naming-scheme/#episode-format" target="_blank" rel="noopener noreferrer" class="tv-mgmt-doc-link" title="Recommended naming scheme (TRaSH Guides)"><i class="fas fa-question-circle"></i></a></span>' +
            '<div class="tv-mgmt-input-wrap"><input type="text" id="tv-mgmt-daily-format" value="' + dailyFmt + '" placeholder="{Series TitleYear} - {Air-Date} - {Episode CleanTitle} {Quality Full}"><button type="button" class="token-builder-btn" data-target="tv-mgmt-daily-format" data-builder="tv-daily" title="Open Token Builder"><i class="fas fa-puzzle-piece"></i></button></div>' +
            '<p class="editor-help-text">Example: The Series Title! (2010) - 2013-10-30 - Episode Title WEBDL-1080p Proper</p></div>' +

            '<div class="editor-field-group">' +
            '<span class="tv-mgmt-label-inline"><label for="tv-mgmt-anime-format">Anime Episode Format</label> <a href="https://trash-guides.info/Sonarr/Sonarr-recommended-naming-scheme/#episode-format" target="_blank" rel="noopener noreferrer" class="tv-mgmt-doc-link" title="Recommended naming scheme (TRaSH Guides)"><i class="fas fa-question-circle"></i></a></span>' +
            '<div class="tv-mgmt-input-wrap"><input type="text" id="tv-mgmt-anime-format" value="' + animeFmt + '" placeholder="{Series TitleYear} - S{season:00}E{episode:00} - {absolute:000} - {Episode CleanTitle} {Quality Full}"><button type="button" class="token-builder-btn" data-target="tv-mgmt-anime-format" data-builder="tv-anime" title="Open Token Builder"><i class="fas fa-puzzle-piece"></i></button></div>' +
            '<p class="editor-help-text">Single: The Series Title! (2010) - S01E01 - 001 - Episode Title WEBDL-1080p Proper</p></div>' +

            '<div class="editor-field-group">' +
            '<span class="tv-mgmt-label-inline"><label for="tv-mgmt-series-folder">Series Folder Format</label> <a href="https://trash-guides.info/Sonarr/Sonarr-recommended-naming-scheme/#series-folder-format" target="_blank" rel="noopener noreferrer" class="tv-mgmt-doc-link" title="Recommended naming scheme (TRaSH Guides)"><i class="fas fa-question-circle"></i></a></span>' +
            '<div class="tv-mgmt-input-wrap"><input type="text" id="tv-mgmt-series-folder" value="' + seriesFolderFmt + '" placeholder="{Series TitleYear}"><button type="button" class="token-builder-btn" data-target="tv-mgmt-series-folder" data-builder="tv-series-folder" title="Open Token Builder"><i class="fas fa-puzzle-piece"></i></button></div>' +
            '<p class="editor-help-text">Used when adding a new series or moving series. Example: The Series Title! (2010)</p></div>' +

            '<div class="editor-field-group">' +
            '<span class="tv-mgmt-label-inline"><label for="tv-mgmt-season-folder">Season Folder Format</label> <a href="https://trash-guides.info/Sonarr/Sonarr-recommended-naming-scheme/#season-folder-format" target="_blank" rel="noopener noreferrer" class="tv-mgmt-doc-link" title="Recommended naming scheme (TRaSH Guides)"><i class="fas fa-question-circle"></i></a></span>' +
            '<div class="tv-mgmt-input-wrap"><input type="text" id="tv-mgmt-season-folder" value="' + seasonFolderFmt + '" placeholder="Season {season:00}"><button type="button" class="token-builder-btn" data-target="tv-mgmt-season-folder" data-builder="tv-season-folder" title="Open Token Builder"><i class="fas fa-puzzle-piece"></i></button></div>' +
            '<p class="editor-help-text">Example: Season 01</p></div>' +

            '<div class="editor-field-group">' +
            '<span class="tv-mgmt-label-inline"><label for="tv-mgmt-specials-folder">Specials Folder Format</label></span>' +
            '<div class="tv-mgmt-input-wrap"><input type="text" id="tv-mgmt-specials-folder" value="' + specialsFolderFmt + '" placeholder="Specials"><button type="button" class="token-builder-btn" data-target="tv-mgmt-specials-folder" data-builder="tv-specials-folder" title="Open Token Builder"><i class="fas fa-puzzle-piece"></i></button></div>' +
            '<p class="editor-help-text">Example: Specials</p></div>' +

            '<div class="editor-field-group">' +
            '<label for="tv-mgmt-multi-episode">Multi Episode Style</label>' +
            '<select id="tv-mgmt-multi-episode">' + multiStyleOptions + '</select>' +
            '<p class="editor-help-text">How multi-episode files are named (e.g. S01E01-E03)</p></div>' +

            '</div>' +
            '<div class="editor-section">' +
            '<div class="editor-section-title">Importing</div>' +
            '<div class="editor-field-group">' +
            '<label for="tv-mgmt-min-space">Minimum Free Space (GB)</label>' +
            '<input type="number" id="tv-mgmt-min-space" value="' + minSpace + '" min="0" max="10000" step="1">' +
            '<p class="editor-help-text">Prevent import if it would leave less than this amount of disk space available (in GB)</p></div>' +
            '</div>' +
            '<div class="editor-section">' +
            '<div class="editor-section-title">Media Hunt Scheduler</div>' +
            '<div class="editor-field-group">' +
            '<div class="editor-setting-item flex-row">' +
            '<label for="tv-mgmt-rss-enabled">Enable RSS Sync</label>' +
            '<label class="toggle-switch"><input type="checkbox" id="tv-mgmt-rss-enabled"' + (rssEnabled ? ' checked' : '') + '><span class="toggle-slider"></span></label>' +
            '</div><p class="editor-help-text">Periodically check indexers for new releases matching your collection</p></div>' +
            '<div class="editor-field-group">' +
            '<label for="tv-mgmt-rss-interval">RSS Sync Interval (minutes)</label>' +
            '<input type="number" id="tv-mgmt-rss-interval" value="' + rssInterval + '" min="15" max="60" step="1">' +
            '<p class="editor-help-text">How often to check for new releases (15\u201360 minutes)</p></div>' +
            '<div class="editor-field-group">' +
            '<label>Last Sync</label>' +
            '<div id="tv-mgmt-rss-last-sync" class="editor-help-text" style="color: #94a3b8; padding: 6px 0;">Loading\u2026</div>' +
            '</div>' +
            '<div class="editor-field-group">' +
            '<label>Next Sync</label>' +
            '<div id="tv-mgmt-rss-next-sync" class="editor-help-text" style="color: #94a3b8; padding: 6px 0;">Loading\u2026</div>' +
            '</div>' +
            '</div></div>';
    }

    function markDirty() {
        _dirty = true;
        var saveBtn = document.getElementById('tv-management-save');
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.classList.add('enabled');
        }
    }

    function collectFormData() {
        return {
            rename_episodes: document.getElementById('tv-mgmt-rename') ? document.getElementById('tv-mgmt-rename').checked : true,
            replace_illegal_characters: document.getElementById('tv-mgmt-replace-illegal') ? document.getElementById('tv-mgmt-replace-illegal').checked : true,
            colon_replacement: document.getElementById('tv-mgmt-colon') ? (document.getElementById('tv-mgmt-colon').value || 'Smart Replace').trim() : 'Smart Replace',
            standard_episode_format: (document.getElementById('tv-mgmt-standard-format') || {}).value || defaults().standard_episode_format,
            daily_episode_format: (document.getElementById('tv-mgmt-daily-format') || {}).value || defaults().daily_episode_format,
            anime_episode_format: (document.getElementById('tv-mgmt-anime-format') || {}).value || defaults().anime_episode_format,
            series_folder_format: (document.getElementById('tv-mgmt-series-folder') || {}).value || defaults().series_folder_format,
            season_folder_format: (document.getElementById('tv-mgmt-season-folder') || {}).value || defaults().season_folder_format,
            specials_folder_format: (document.getElementById('tv-mgmt-specials-folder') || {}).value || defaults().specials_folder_format,
            multi_episode_style: (document.getElementById('tv-mgmt-multi-episode') || {}).value || 'Prefixed Range',
            minimum_free_space_gb: (function() {
                var el = document.getElementById('tv-mgmt-min-space');
                if (!el) return 10;
                var n = parseInt(el.value, 10);
                return isNaN(n) || n < 0 ? 10 : Math.min(10000, n);
            })(),
            rss_sync_enabled: document.getElementById('tv-mgmt-rss-enabled') ? document.getElementById('tv-mgmt-rss-enabled').checked : true,
            rss_sync_interval_minutes: (function() {
                var el = document.getElementById('tv-mgmt-rss-interval');
                if (!el) return 15;
                var n = parseInt(el.value, 10);
                return isNaN(n) || n < 15 ? 15 : Math.min(60, n);
            })()
        };
    }

    function updateColonDemo() {
        var selectEl = document.getElementById('tv-mgmt-colon');
        var demoEl = document.getElementById('tv-mgmt-colon-demo');
        if (!selectEl || !demoEl) return;
        var value = (selectEl.value || 'Smart Replace').trim();
        var result = COLON_DEMO_RESULTS[value];
        if (result !== undefined) {
            demoEl.textContent = 'Demo: "' + COLON_DEMO_SAMPLE + '" \u2192 "' + result + '"';
            demoEl.style.display = '';
        } else {
            demoEl.style.display = 'none';
        }
    }

    function setupChangeDetection() {
        var ids = [
            'tv-mgmt-rename', 'tv-mgmt-replace-illegal', 'tv-mgmt-colon',
            'tv-mgmt-standard-format', 'tv-mgmt-daily-format', 'tv-mgmt-anime-format',
            'tv-mgmt-series-folder', 'tv-mgmt-season-folder', 'tv-mgmt-specials-folder',
            'tv-mgmt-multi-episode', 'tv-mgmt-min-space', 'tv-mgmt-rss-enabled', 'tv-mgmt-rss-interval'
        ];
        ids.forEach(function(id) {
            var el = document.getElementById(id);
            if (el) {
                el.addEventListener('change', function() {
                    markDirty();
                    if (id === 'tv-mgmt-colon') updateColonDemo();
                });
                el.addEventListener('input', markDirty);
            }
        });
        updateColonDemo();
    }

    function confirmLeave(callback) {
        if (!_dirty) { if (callback) callback('discard'); return; }
        if (typeof callback !== 'function') return;
        if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
            window.HuntarrConfirm.show({
                title: 'Unsaved Changes',
                message: 'You have unsaved changes that will be lost if you leave.',
                confirmLabel: 'Go Back',
                cancelLabel: 'Leave',
                onConfirm: function() { callback('stay'); },
                onCancel: function() { callback('discard'); }
            });
        } else {
            if (!confirm('You have unsaved changes. Leave anyway?')) { callback('stay'); return; }
            callback('discard');
        }
    }

    function getInstanceId() {
        var sel = document.getElementById('tv-management-instance-select');
        var v = sel && sel.value ? sel.value : '';
        if (v && v.indexOf(':') >= 0) return v.split(':')[1] || '';
        return v || '';
    }

    function appendInstanceParam(url) {
        var id = getInstanceId();
        if (!id) return url;
        return url + (url.indexOf('?') >= 0 ? '&' : '?') + 'instance_id=' + encodeURIComponent(id);
    }

    function safeJsonFetch(url, fallback) {
        return fetch(url, { cache: 'no-store' }).then(function(r) { return r.json(); }).catch(function() { return fallback || {}; });
    }

    function formatSyncTime(isoStr) {
        if (!isoStr) return 'Never';
        try {
            var d = new Date(isoStr);
            if (isNaN(d.getTime())) return 'Unknown';
            return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
        } catch (e) { return 'Unknown'; }
    }

    function loadRssSyncStatus() {
        var statusUrl = appendInstanceParam('./api/tv-hunt/settings/rss-sync-status');
        fetch(statusUrl, { cache: 'no-store' })
            .then(function(r) { return r.json(); })
            .then(function(status) {
                var lastEl = document.getElementById('tv-mgmt-rss-last-sync');
                var nextEl = document.getElementById('tv-mgmt-rss-next-sync');
                if (lastEl) lastEl.textContent = formatSyncTime(status.last_sync_time);
                if (nextEl) nextEl.textContent = formatSyncTime(status.next_sync_time);
            })
            .catch(function() {
                var lastEl = document.getElementById('tv-mgmt-rss-last-sync');
                var nextEl = document.getElementById('tv-mgmt-rss-next-sync');
                if (lastEl) lastEl.textContent = 'Unable to load';
                if (nextEl) nextEl.textContent = 'Unable to load';
            });
    }

    function load() {
        _dirty = false;
        _data = null;
        var contentEl = document.getElementById('tv-management-content');
        var saveBtn = document.getElementById('tv-management-save');
        if (!contentEl) return;

        if (saveBtn) { saveBtn.disabled = true; saveBtn.classList.remove('enabled'); saveBtn.style.display = ''; }
        contentEl.innerHTML = '<p class="editor-help-text">Loading\u2026</p>';

        var url = appendInstanceParam('./api/tv-hunt/settings/tv-management');
        fetch(url)
            .then(function(r) { return r.json(); })
            .then(function(data) {
                _data = data;
                contentEl.innerHTML = generateFormHtml(data);
                setupChangeDetection();
                attachTokenBuilderButtons();
                loadRssSyncStatus();
                if (saveBtn) saveBtn.onclick = function() { window.TVManagement.save(); };
            })
            .catch(function() {
                _data = defaults();
                contentEl.innerHTML = generateFormHtml(_data);
                setupChangeDetection();
                attachTokenBuilderButtons();
                if (saveBtn) saveBtn.onclick = function() { window.TVManagement.save(); };
            });
    }

    function save(optionalNextSection) {
        var body = collectFormData();
        var instId = getInstanceId();
        if (instId) body.instance_id = parseInt(instId, 10);
        var saveBtn = document.getElementById('tv-management-save');
        if (saveBtn) saveBtn.disabled = true;

        var url = appendInstanceParam('./api/tv-hunt/settings/tv-management');
        fetch(url, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        })
            .then(function(r) { return r.json(); })
            .then(function() {
                _dirty = false;
                if (saveBtn) { saveBtn.disabled = true; saveBtn.classList.remove('enabled'); }
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('TV Management saved.', 'success');
                }
                if (optionalNextSection && window.huntarrUI && window.huntarrUI.switchSection) {
                    window.huntarrUI.switchSection(optionalNextSection);
                }
            })
            .catch(function() {
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('Failed to save TV Management.', 'error');
                }
                if (saveBtn) { saveBtn.disabled = false; saveBtn.classList.add('enabled'); }
            });
    }

    function cancel(optionalNextSection) {
        _dirty = false;
        _data = null;
        if (window.huntarrUI && window.huntarrUI.switchSection) {
            window.huntarrUI.switchSection(optionalNextSection || 'media-hunt-instances');
        }
    }

    function populateInstanceDropdown() {
        var selectEl = document.getElementById('tv-management-instance-select');
        if (!selectEl) return;
        selectEl.innerHTML = '<option value="">Loading...</option>';
        var ts = Date.now();
        Promise.all([
            safeJsonFetch('./api/movie-hunt/instances?t=' + ts, { instances: [] }),
            safeJsonFetch('./api/tv-hunt/instances?t=' + ts, { instances: [] }),
            safeJsonFetch('./api/tv-hunt/instances/current?t=' + ts, { current_instance_id: null })
        ]).then(function(results) {
            var movieList = (results[0].instances || []).map(function(inst) {
                return { value: 'movie:' + inst.id, label: 'Movie - ' + (inst.name || 'Instance ' + inst.id) };
            });
            var tvList = (results[1].instances || []).map(function(inst) {
                return { value: 'tv:' + inst.id, label: 'TV - ' + (inst.name || 'Instance ' + inst.id) };
            });
            var combined = movieList.concat(tvList);
            combined.sort(function(a, b) { return (a.label || '').localeCompare(b.label || '', undefined, { sensitivity: 'base' }); });
            var currentTv = results[2].current_instance_id != null ? Number(results[2].current_instance_id) : null;

            var wrapperEl = document.getElementById('tv-management-content-wrapper');
            var noInstEl = document.getElementById('tv-management-no-instances');

            if (combined.length === 0) {
                selectEl.innerHTML = '<option value="">No Movie or TV Hunt instances</option>';
                if (noInstEl) noInstEl.style.display = '';
                if (wrapperEl) wrapperEl.style.display = 'none';
                return;
            }

            if (noInstEl) noInstEl.style.display = 'none';
            if (wrapperEl) wrapperEl.style.display = '';

            selectEl.innerHTML = '';
            combined.forEach(function(item) {
                var opt = document.createElement('option');
                opt.value = item.value;
                opt.textContent = item.label;
                selectEl.appendChild(opt);
            });

            var saved = (typeof localStorage !== 'undefined' && localStorage.getItem('media-mgmt-last-instance')) || '';
            var selected = '';
            if (saved && combined.some(function(i) { return i.value === saved; })) {
                selected = saved;
            } else if (currentTv != null && combined.some(function(i) { return i.value === 'tv:' + currentTv; })) {
                selected = 'tv:' + currentTv;
            } else {
                var firstTv = tvList.length > 0 ? tvList[0].value : combined[0].value;
                selected = firstTv;
            }
            selectEl.value = selected;
            if (typeof localStorage !== 'undefined') localStorage.setItem('media-mgmt-last-instance', selected);
            handleInstanceChange(selected);
        }).catch(function() {
            selectEl.innerHTML = '<option value="">Failed to load instances</option>';
        });
    }

    function handleInstanceChange(val) {
        if (!val || val.indexOf(':') < 0) return;
        var parts = val.split(':');
        var type = parts[0];
        if (type === 'movie') {
            if (typeof localStorage !== 'undefined') localStorage.setItem('media-mgmt-last-instance', val);
            if (window.huntarrUI && window.huntarrUI.switchSection) {
                window.huntarrUI.switchSection('settings-media-management');
            }
        } else {
            load();
        }
    }

    function initOrRefresh() {
        var selectEl = document.getElementById('tv-management-instance-select');
        if (selectEl && selectEl.options.length <= 1) {
            populateInstanceDropdown();
        } else {
            load();
        }
        if (selectEl && !selectEl._tvMgmtBound) {
            selectEl._tvMgmtBound = true;
            selectEl.addEventListener('change', function() {
                var val = selectEl.value;
                if (typeof localStorage !== 'undefined') localStorage.setItem('media-mgmt-last-instance', val);
                handleInstanceChange(val);
            });
        }
    }

    /* ── TV Token Builder Data ─────────────────────────────────────── */

    var TV_EPISODE_PRESETS = [
        { name: 'Standard', format: "{Series TitleYear} - S{season:00}E{episode:00} - {Episode CleanTitle} {[Custom Formats]}{[Quality Full]}{[MediaInfo AudioCodec} {MediaInfo AudioChannels]}{[MediaInfo VideoDynamicRangeType]}{[MediaInfo VideoCodec]}{-Release Group}",
          example: "The Series Title! (2010) - S01E01 - Episode Title [AMZN WEBDL-1080p Proper][DTS 5.1][x264]-RlsGrp" },
        { name: 'Minimal', format: "{Series TitleYear} - S{season:00}E{episode:00} - {Episode CleanTitle} {Quality Full}",
          example: "The Series Title! (2010) - S01E01 - Episode Title WEBDL-1080p Proper" },
        { name: 'Scene Style', format: "{Series.CleanTitleYear}.S{season:00}E{episode:00}.{Episode.CleanTitle}.{Quality.Full}.{MediaInfo.VideoCodec}{-Release Group}",
          example: "The.Series.Title!.2010.S01E01.Episode.Title.WEBDL-1080p.x264-RlsGrp" },
    ];

    var TV_DAILY_PRESETS = [
        { name: 'Standard', format: "{Series TitleYear} - {Air-Date} - {Episode CleanTitle} {[Custom Formats]}{[Quality Full]}{[MediaInfo AudioCodec} {MediaInfo AudioChannels]}{[MediaInfo VideoDynamicRangeType]}{[MediaInfo VideoCodec]}{-Release Group}",
          example: "The Series Title! (2010) - 2013-10-30 - Episode Title [AMZN WEBDL-1080p Proper][DTS 5.1][x264]-RlsGrp" },
        { name: 'Minimal', format: "{Series TitleYear} - {Air-Date} - {Episode CleanTitle} {Quality Full}",
          example: "The Series Title! (2010) - 2013-10-30 - Episode Title WEBDL-1080p Proper" },
        { name: 'Scene Style', format: "{Series.CleanTitleYear}.{Air.Date}.{Episode.CleanTitle}.{Quality.Full}",
          example: "The.Series.Title!.2010.2013.10.30.Episode.Title.WEBDL-1080p.Proper" },
    ];

    var TV_ANIME_PRESETS = [
        { name: 'Standard', format: "{Series TitleYear} - S{season:00}E{episode:00} - {absolute:000} - {Episode CleanTitle} {[Custom Formats]}{[Quality Full]}{[MediaInfo AudioCodec} {MediaInfo AudioChannels]}{MediaInfo AudioLanguages}{[MediaInfo VideoDynamicRangeType]}[{MediaInfo VideoCodec }{MediaInfo VideoBitDepth}bit]{-Release Group}",
          example: "The Series Title! (2010) - S01E01 - 001 - Episode Title [HDTV-720p v2][DTS 5.1][JA][10bit][x264]-RlsGrp" },
        { name: 'Minimal', format: "{Series TitleYear} - S{season:00}E{episode:00} - {absolute:000} - {Episode CleanTitle} {Quality Full}",
          example: "The Series Title! (2010) - S01E01 - 001 - Episode Title WEBDL-1080p Proper" },
        { name: 'Absolute Only', format: "{Series TitleYear} - {absolute:000} - {Episode CleanTitle} {Quality Full}",
          example: "The Series Title! (2010) - 001 - Episode Title WEBDL-1080p Proper" },
    ];

    var TV_SERIES_FOLDER_PRESETS = [
        { name: 'Standard', format: '{Series TitleYear}',
          example: "The Series Title! (2010)" },
        { name: 'With IMDb', format: '{Series TitleYear} {imdb-{ImdbId}}',
          example: "The Series Title! (2010) {imdb-tt1520211}" },
        { name: 'With TVDb', format: '{Series TitleYear} {tvdb-{TvdbId}}',
          example: "The Series Title! (2010) {tvdb-1520211}" },
    ];

    var TV_SEASON_FOLDER_PRESETS = [
        { name: 'Standard', format: 'Season {season:00}',
          example: 'Season 01' },
        { name: 'Short', format: 'S{season:00}',
          example: 'S01' },
        { name: 'With Name', format: 'Season {season:0}',
          example: 'Season 1' },
    ];

    var TV_SPECIALS_FOLDER_PRESETS = [
        { name: 'Standard', format: 'Specials',
          example: 'Specials' },
        { name: 'Season 0', format: 'Season {season:00}',
          example: 'Season 00' },
    ];

    /* Token categories per builder type */
    var TV_SERIES_TOKENS = [
        { name: 'Series', icon: 'fa-tv', tokens: [
            { token: '{Series Title}', example: "The Series Title's!" },
            { token: '{Series CleanTitle}', example: "The Series Title's!" },
            { token: '{Series TitleYear}', example: "The Series Title's! (2010)" },
            { token: '{Series CleanTitleYear}', example: "The Series Title's! 2010" },
            { token: '{Series TitleWithoutYear}', example: "The Series Title's!" },
            { token: '{Series CleanTitleWithoutYear}', example: "The Series Title's!" },
            { token: '{Series TitleThe}', example: "Series Title's!, The" },
            { token: '{Series CleanTitleThe}', example: "Series Title's!, The" },
            { token: '{Series TitleTheYear}', example: "Series Title's!, The (2010)" },
            { token: '{Series CleanTitleTheYear}', example: "Series Title's!, The 2010" },
            { token: '{Series TitleFirstCharacter}', example: 'S' },
            { token: '{Series Year}', example: '2010' },
        ]},
        { name: 'Series ID', icon: 'fa-fingerprint', tokens: [
            { token: '{ImdbId}', example: 'tt12345' },
            { token: '{TvdbId}', example: '12345' },
            { token: '{TmdbId}', example: '11223' },
            { token: '{TvMazeId}', example: '54321' },
        ]},
    ];

    var TV_SEASON_TOKENS = [
        { name: 'Season', icon: 'fa-layer-group', tokens: [
            { token: '{season:0}', example: '1' },
            { token: '{season:00}', example: '01' },
        ]},
    ];

    var TV_EPISODE_TOKENS = [
        { name: 'Episode', icon: 'fa-hashtag', tokens: [
            { token: '{episode:0}', example: '1' },
            { token: '{episode:00}', example: '01' },
        ]},
        { name: 'Air Date', icon: 'fa-calendar-day', tokens: [
            { token: '{Air-Date}', example: '2016-03-20' },
            { token: '{Air Date}', example: '2016 03 20' },
        ]},
    ];

    var TV_ABSOLUTE_TOKENS = [
        { name: 'Absolute', icon: 'fa-sort-numeric-up', tokens: [
            { token: '{absolute:0}', example: '1' },
            { token: '{absolute:00}', example: '01' },
            { token: '{absolute:000}', example: '001' },
        ]},
    ];

    var TV_EPISODE_TITLE_TOKENS = [
        { name: 'Episode Title', icon: 'fa-quote-right', tokens: [
            { token: '{Episode Title}', example: "Episode's Title" },
            { token: '{Episode CleanTitle}', example: 'Episodes Title' },
        ]},
    ];

    var TV_QUALITY_TOKENS = [
        { name: 'Quality', icon: 'fa-star', tokens: [
            { token: '{Quality Full}', example: 'WEBDL-1080p Proper' },
            { token: '{Quality Title}', example: 'WEBDL-1080p' },
        ]},
    ];

    var TV_MEDIA_INFO_TOKENS = [
        { name: 'Media Info', icon: 'fa-info-circle', tokens: [
            { token: '{MediaInfo Simple}', example: 'x264 DTS' },
            { token: '{MediaInfo Full}', example: 'x264 DTS [EN+DE]' },
            { token: '{MediaInfo AudioCodec}', example: 'DTS' },
            { token: '{MediaInfo AudioChannels}', example: '5.1' },
            { token: '{MediaInfo AudioLanguages}', example: '[EN+DE]' },
            { token: '{MediaInfo AudioLanguagesAll}', example: '[EN]' },
            { token: '{MediaInfo SubtitleLanguages}', example: '[DE]' },
            { token: '{MediaInfo VideoCodec}', example: 'x264' },
            { token: '{MediaInfo VideoBitDepth}', example: '10' },
            { token: '{MediaInfo VideoDynamicRange}', example: 'HDR' },
            { token: '{MediaInfo VideoDynamicRangeType}', example: 'DV HDR10' },
        ]},
    ];

    var TV_RELEASE_TOKENS = [
        { name: 'Release', icon: 'fa-tag', tokens: [
            { token: '{Release Group}', example: 'Rls Grp' },
            { token: '{Custom Formats}', example: 'iNTERNAL' },
            { token: '{Custom Format:FormatName}', example: 'AMZN' },
        ]},
    ];

    var TV_ORIGINAL_TOKENS = [
        { name: 'Original', icon: 'fa-file', tokens: [
            { token: '{Original Title}', example: "The.Series.Title's!.S01E01.WEBDL.1080p.x264-EVOLVE" },
            { token: '{Original Filename}', example: "the.series.title's!.s01e01.webdl.1080p.x264-EVOLVE" },
        ]},
    ];

    var TV_ANIME_EXTRA_TOKENS = [
        { name: 'Anime Release', icon: 'fa-tag', tokens: [
            { token: '{Release Group}', example: 'Rls Grp' },
            { token: '{Release Hash}', example: 'ABCDEFGH' },
            { token: '{Custom Formats}', example: 'iNTERNAL' },
            { token: '{Custom Format:FormatName}', example: 'AMZN' },
        ]},
    ];

    function getBuilderConfig(builderType) {
        switch (builderType) {
            case 'tv-episode':
                return {
                    title: 'Episode File Name Builder',
                    icon: 'fa-file-video',
                    presets: TV_EPISODE_PRESETS,
                    categories: [].concat(TV_SERIES_TOKENS, TV_SEASON_TOKENS, TV_EPISODE_TOKENS, TV_EPISODE_TITLE_TOKENS, TV_QUALITY_TOKENS, TV_MEDIA_INFO_TOKENS, TV_RELEASE_TOKENS, TV_ORIGINAL_TOKENS)
                };
            case 'tv-daily':
                return {
                    title: 'Daily Episode File Name Builder',
                    icon: 'fa-calendar-alt',
                    presets: TV_DAILY_PRESETS,
                    categories: [].concat(TV_SERIES_TOKENS, TV_EPISODE_TOKENS, TV_EPISODE_TITLE_TOKENS, TV_QUALITY_TOKENS, TV_MEDIA_INFO_TOKENS, TV_RELEASE_TOKENS, TV_ORIGINAL_TOKENS)
                };
            case 'tv-anime':
                return {
                    title: 'Anime Episode File Name Builder',
                    icon: 'fa-dragon',
                    presets: TV_ANIME_PRESETS,
                    categories: [].concat(TV_SERIES_TOKENS, TV_SEASON_TOKENS, TV_EPISODE_TOKENS, TV_ABSOLUTE_TOKENS, TV_EPISODE_TITLE_TOKENS, TV_QUALITY_TOKENS, TV_MEDIA_INFO_TOKENS, TV_ANIME_EXTRA_TOKENS, TV_ORIGINAL_TOKENS)
                };
            case 'tv-series-folder':
                return {
                    title: 'Series Folder Name Builder',
                    icon: 'fa-folder-open',
                    presets: TV_SERIES_FOLDER_PRESETS,
                    categories: TV_SERIES_TOKENS
                };
            case 'tv-season-folder':
                return {
                    title: 'Season Folder Name Builder',
                    icon: 'fa-folder',
                    presets: TV_SEASON_FOLDER_PRESETS,
                    categories: TV_SEASON_TOKENS
                };
            case 'tv-specials-folder':
                return {
                    title: 'Specials Folder Name Builder',
                    icon: 'fa-folder',
                    presets: TV_SPECIALS_FOLDER_PRESETS,
                    categories: TV_SEASON_TOKENS
                };
            default:
                return {
                    title: 'Token Builder',
                    icon: 'fa-puzzle-piece',
                    presets: TV_EPISODE_PRESETS,
                    categories: [].concat(TV_SERIES_TOKENS, TV_SEASON_TOKENS, TV_EPISODE_TOKENS, TV_EPISODE_TITLE_TOKENS, TV_QUALITY_TOKENS, TV_MEDIA_INFO_TOKENS, TV_RELEASE_TOKENS, TV_ORIGINAL_TOKENS)
                };
        }
    }

    function openTokenBuilder(targetInputId, builderType) {
        var existing = document.getElementById('token-builder-modal');
        if (existing) existing.remove();

        var config = getBuilderConfig(builderType);
        var targetInput = document.getElementById(targetInputId);
        var currentValue = targetInput ? targetInput.value : '';

        var html = '<div class="tkb-overlay" id="token-builder-modal">' +
            '<div class="tkb-modal">' +
            '<div class="tkb-header">' +
            '<div class="tkb-header-left"><i class="fas ' + config.icon + '"></i><span>' + config.title + '</span></div>' +
            '<button class="tkb-close" id="tkb-close-btn"><i class="fas fa-times"></i></button>' +
            '</div>' +
            '<div class="tkb-body">';

        html += '<div class="tkb-presets-section">' +
            '<div class="tkb-cat-header"><i class="fas fa-magic"></i> Quick Presets</div>' +
            '<div class="tkb-presets">';
        config.presets.forEach(function(p, idx) {
            html += '<button type="button" class="tkb-preset" data-preset-idx="' + idx + '">' +
                '<div class="tkb-preset-name">' + escapeHtml(p.name) + '</div>' +
                '<div class="tkb-preset-format">' + escapeHtml(p.format) + '</div>' +
                '<div class="tkb-preset-example">' + escapeHtml(p.example) + '</div>' +
                '</button>';
        });
        html += '</div></div>';

        config.categories.forEach(function(cat) {
            html += '<div class="tkb-category">' +
                '<div class="tkb-cat-header"><i class="fas ' + cat.icon + '"></i> ' + escapeHtml(cat.name) + '</div>' +
                '<div class="tkb-tokens">';
            cat.tokens.forEach(function(t) {
                html += '<button type="button" class="tkb-token" data-token="' + escapeHtml(t.token) + '">' +
                    '<span class="tkb-token-name">' + escapeHtml(t.token) + '</span>' +
                    '<span class="tkb-token-example">' + escapeHtml(t.example) + '</span>' +
                    '</button>';
            });
            html += '</div></div>';
        });

        html += '</div>' +
            '<div class="tkb-footer">' +
            '<div class="tkb-preview-label">Current Format</div>' +
            '<input type="text" class="tkb-preview-input" id="tkb-preview-input" value="' + escapeHtml(currentValue) + '" readonly>' +
            '<div class="tkb-footer-actions">' +
            '<button type="button" class="tkb-btn tkb-btn-clear" id="tkb-clear-btn"><i class="fas fa-eraser"></i> Clear</button>' +
            '<button type="button" class="tkb-btn tkb-btn-done" id="tkb-done-btn"><i class="fas fa-check"></i> Done</button>' +
            '</div>' +
            '</div>' +
            '</div></div>';

        document.body.insertAdjacentHTML('beforeend', html);
        var modal = document.getElementById('token-builder-modal');

        document.getElementById('tkb-close-btn').addEventListener('click', function() { modal.remove(); });
        modal.addEventListener('click', function(e) { if (e.target === modal) modal.remove(); });

        modal.querySelectorAll('.tkb-preset').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var idx = parseInt(btn.getAttribute('data-preset-idx'), 10);
                var preset = config.presets[idx];
                if (!preset) return;
                var input = document.getElementById(targetInputId);
                var preview = document.getElementById('tkb-preview-input');
                if (input) { input.value = preset.format; markDirty(); }
                if (preview) preview.value = preset.format;
                modal.querySelectorAll('.tkb-preset').forEach(function(b) { b.classList.remove('tkb-preset-active'); });
                btn.classList.add('tkb-preset-active');
            });
        });

        modal.querySelectorAll('.tkb-token').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var token = btn.getAttribute('data-token');
                var input = document.getElementById(targetInputId);
                var preview = document.getElementById('tkb-preview-input');
                if (input) {
                    var val = input.value;
                    var needsSpace = val.length > 0 && val[val.length - 1] !== ' ' && val[val.length - 1] !== '(' && val[val.length - 1] !== '[' && val[val.length - 1] !== '{';
                    input.value = val + (needsSpace ? ' ' : '') + token;
                    markDirty();
                }
                if (preview && input) preview.value = input.value;
                btn.classList.add('tkb-token-added');
                setTimeout(function() { btn.classList.remove('tkb-token-added'); }, 400);
            });
        });

        document.getElementById('tkb-clear-btn').addEventListener('click', function() {
            var input = document.getElementById(targetInputId);
            var preview = document.getElementById('tkb-preview-input');
            if (input) { input.value = ''; markDirty(); }
            if (preview) preview.value = '';
            modal.querySelectorAll('.tkb-preset').forEach(function(b) { b.classList.remove('tkb-preset-active'); });
        });

        document.getElementById('tkb-done-btn').addEventListener('click', function() { modal.remove(); });

        function escHandler(e) { if (e.key === 'Escape') { modal.remove(); document.removeEventListener('keydown', escHandler); } }
        document.addEventListener('keydown', escHandler);
    }

    function attachTokenBuilderButtons() {
        document.querySelectorAll('#tv-management-content .token-builder-btn').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.preventDefault();
                var target = btn.getAttribute('data-target');
                var builder = btn.getAttribute('data-builder') || 'tv-episode';
                if (target) openTokenBuilder(target, builder);
            });
        });
    }

    window.TVManagement = {
        load: load,
        save: save,
        cancel: cancel,
        isDirty: function() { return _dirty; },
        confirmLeave: confirmLeave,
        initOrRefresh: initOrRefresh
    };
})();
