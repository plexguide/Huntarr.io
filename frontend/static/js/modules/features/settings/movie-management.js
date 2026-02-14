/**
 * Management settings – single view for Movie Hunt and TV Hunt. Combined instance dropdown
 * (Movie - X / TV - X). Movie: naming + importing; TV: placeholder until TV management is implemented.
 */
(function() {
    'use strict';

    var _mgmtMode = 'movie';

    function escapeHtml(s) {
        if (s == null) return '';
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    var _movieManagementDirty = false;
    var _movieManagementData = null;

    var COLON_DEMO_SAMPLE = 'Movie Title: The Subtitle';
    var COLON_DEMO_RESULTS = {
        'Smart Replace': 'Movie Title - The Subtitle',
        'Delete': 'Movie Title The Subtitle',
        'Replace with Dash': 'Movie Title- The Subtitle',
        'Replace with Space Dash': 'Movie Title - The Subtitle',
        'Replace with Space Dash Space': 'Movie Title - The Subtitle'
    };

    function defaults() {
        return {
            rename_movies: true,
            replace_illegal_characters: true,
            colon_replacement: 'Smart Replace',
            standard_movie_format: '{Movie Title} ({Release Year}) {Quality Full}',
            movie_folder_format: '{Movie Title} ({Release Year})',
            minimum_free_space_gb: 10,
            import_using_script: false,
            import_extra_files: false
        };
    }

    function generateFormHtml(data) {
        var d = data || defaults();
        var renameMovies = d.rename_movies !== false;
        var replaceIllegal = d.replace_illegal_characters !== false;
        var colonRep = escapeHtml(String(d.colon_replacement || 'Smart Replace').trim());
        var standardFormat = escapeHtml(String(d.standard_movie_format || '').trim() || '{Movie Title} ({Release Year}) {Quality Full}');
        var folderFormat = escapeHtml(String(d.movie_folder_format || '').trim() || '{Movie Title} ({Release Year})');
        var minSpace = typeof d.minimum_free_space_gb === 'number' ? d.minimum_free_space_gb : 10;

        var colonOptionList = ['Smart Replace', 'Delete', 'Replace with Dash', 'Replace with Space Dash', 'Replace with Space Dash Space'];
        var colonOptions = colonOptionList.map(function(opt) {
            var v = escapeHtml(opt);
            var sel = (opt === (d.colon_replacement || 'Smart Replace')) ? ' selected' : '';
            return '<option value="' + v + '"' + sel + '>' + v + '</option>';
        }).join('');

        return '<div class="editor-grid">' +
            '<div class="editor-section">' +
            '<div class="editor-section-title">Movie Naming</div>' +
            '<div class="editor-field-group">' +
            '<div class="editor-setting-item flex-row">' +
            '<label for="movie-mgmt-rename">Rename Movies</label>' +
            '<label class="toggle-switch"><input type="checkbox" id="movie-mgmt-rename"' + (renameMovies ? ' checked' : '') + '><span class="toggle-slider"></span></label>' +
            '</div><p class="editor-help-text">Movie Hunt will use the existing file name if renaming is disabled</p></div>' +
            '<div class="editor-field-group">' +
            '<div class="editor-setting-item flex-row">' +
            '<label for="movie-mgmt-replace-illegal">Replace Illegal Characters</label>' +
            '<label class="toggle-switch"><input type="checkbox" id="movie-mgmt-replace-illegal"' + (replaceIllegal ? ' checked' : '') + '><span class="toggle-slider"></span></label>' +
            '</div><p class="editor-help-text">Replace illegal characters. If unchecked, Movie Hunt will remove them instead</p></div>' +
            '<div class="editor-field-group">' +
            '<label for="movie-mgmt-colon">Colon Replacement</label>' +
            '<select id="movie-mgmt-colon">' + colonOptions + '</select>' +
            '<p class="editor-help-text">Change how Movie Hunt handles colon replacement. Smart Replace uses a dash or space-dash depending on the name.</p>' +
            '<p class="editor-help-text movie-mgmt-colon-demo" id="movie-mgmt-colon-demo"></p></div>' +
            '<div class="editor-field-group">' +
            '<span class="movie-mgmt-label-inline"><label for="movie-mgmt-standard-format">Standard Movie Format</label> <a href="https://trash-guides.info/Radarr/Radarr-recommended-naming-scheme/#standard-movie-format" target="_blank" rel="noopener noreferrer" class="movie-mgmt-doc-link" title="Recommended naming scheme (TRaSH Guides)"><i class="fas fa-question-circle"></i></a></span>' +
            '<input type="text" id="movie-mgmt-standard-format" value="' + standardFormat + '" placeholder="{Movie Title} ({Release Year}) {Quality Full}">' +
            '<p class="editor-help-text">Example: Movie: The Movie - Title (2010) Bluray-1080p Proper</p></div>' +
            '<div class="editor-field-group">' +
            '<span class="movie-mgmt-label-inline"><label for="movie-mgmt-folder-format">Movie Folder Format</label> <a href="https://trash-guides.info/Radarr/Radarr-recommended-naming-scheme/#movie-folder-format" target="_blank" rel="noopener noreferrer" class="movie-mgmt-doc-link" title="Recommended naming scheme – Movie Folder Format (TRaSH Guides)"><i class="fas fa-question-circle"></i></a></span>' +
            '<input type="text" id="movie-mgmt-folder-format" value="' + folderFormat + '" placeholder="{Movie Title} ({Release Year})">' +
            '<p class="editor-help-text">Used when adding a new movie or moving movies via the movie editor. Example: The Movie - Title (2010)</p></div>' +
            '</div>' +
            '<div class="editor-section">' +
            '<div class="editor-section-title">Importing</div>' +
            '<div class="editor-field-group">' +
            '<label for="movie-mgmt-min-space">Minimum Free Space (GB)</label>' +
            '<input type="number" id="movie-mgmt-min-space" value="' + minSpace + '" min="0" max="10000" step="1">' +
            '<p class="editor-help-text">Prevent import if it would leave less than this amount of disk space available (in GB)</p></div>' +
            '</div></div>';
    }

    function markDirty() {
        _movieManagementDirty = true;
        var saveBtn = document.getElementById('movie-management-save');
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.classList.add('enabled');
        }
    }

    function collectFormData() {
        return {
            rename_movies: document.getElementById('movie-mgmt-rename') ? document.getElementById('movie-mgmt-rename').checked : true,
            replace_illegal_characters: document.getElementById('movie-mgmt-replace-illegal') ? document.getElementById('movie-mgmt-replace-illegal').checked : true,
            colon_replacement: document.getElementById('movie-mgmt-colon') ? (document.getElementById('movie-mgmt-colon').value || 'Smart Replace').trim() : 'Smart Replace',
            standard_movie_format: document.getElementById('movie-mgmt-standard-format') ? (document.getElementById('movie-mgmt-standard-format').value || '').trim() : '{Movie Title} ({Release Year}) {Quality Full}',
            movie_folder_format: document.getElementById('movie-mgmt-folder-format') ? (document.getElementById('movie-mgmt-folder-format').value || '').trim() : '{Movie Title} ({Release Year})',
            minimum_free_space_gb: (function() {
                var el = document.getElementById('movie-mgmt-min-space');
                if (!el) return 10;
                var n = parseInt(el.value, 10);
                return isNaN(n) || n < 0 ? 10 : Math.min(10000, n);
            })()
        };
    }

    function updateColonDemo() {
        var selectEl = document.getElementById('movie-mgmt-colon');
        var demoEl = document.getElementById('movie-mgmt-colon-demo');
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
        var ids = ['movie-mgmt-rename', 'movie-mgmt-replace-illegal', 'movie-mgmt-colon', 'movie-mgmt-standard-format', 'movie-mgmt-folder-format', 'movie-mgmt-min-space'];
        ids.forEach(function(id) {
            var el = document.getElementById(id);
            if (el) {
                el.addEventListener('change', function() {
                    markDirty();
                    if (id === 'movie-mgmt-colon') updateColonDemo();
                });
                el.addEventListener('input', markDirty);
            }
        });
        updateColonDemo();
    }

    function confirmLeaveMovieManagement(callback) {
        if (!_movieManagementDirty) {
            if (callback) callback('discard');
            return;
        }
        if (typeof callback !== 'function') return;
        if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
            window.HuntarrConfirm.show({
                title: 'Unsaved Changes',
                message: 'You have unsaved changes that will be lost if you leave.',
                confirmLabel: 'Go Back',
                cancelLabel: 'Leave',
                onConfirm: function() {
                    // Stay on the editor — modal just closes, user can save manually
                    callback('stay');
                },
                onCancel: function() { callback('discard'); }
            });
        } else {
            if (!confirm('You have unsaved changes that will be lost. Leave anyway?')) {
                callback('stay');
                return;
            }
            callback('discard');
        }
    }

    function load() {
        _movieManagementDirty = false;
        _movieManagementData = null;
        var contentEl = document.getElementById('movie-management-content');
        var saveBtn = document.getElementById('movie-management-save');
        var backBtn = document.getElementById('movie-management-back');
        if (!contentEl) return;

        if (_mgmtMode === 'tv') {
            contentEl.innerHTML = tvPlaceholderHtml();
            if (saveBtn) { saveBtn.disabled = true; saveBtn.classList.remove('enabled'); saveBtn.style.display = 'none'; }
            if (backBtn) backBtn.style.display = '';
            if (backBtn) {
                backBtn.onclick = function() {
                    if (window.huntarrUI && window.huntarrUI.switchSection) {
                        window.huntarrUI.switchSection('media-hunt-instances');
                    }
                };
            }
            return;
        }

        if (saveBtn) { saveBtn.disabled = true; saveBtn.classList.remove('enabled'); saveBtn.style.display = ''; }
        if (backBtn) backBtn.style.display = '';

        contentEl.innerHTML = '<p class="editor-help-text">Loading…</p>';

        var url = appendInstanceParam(getApiBase());
        fetch(url)
            .then(function(r) { return r.json(); })
            .then(function(data) {
                _movieManagementData = data;
                contentEl.innerHTML = generateFormHtml(data);
                setupChangeDetection();
                if (saveBtn) {
                    saveBtn.onclick = function() { window.MovieManagement.save(); };
                }
                if (backBtn) {
                    backBtn.onclick = function() {
                        confirmLeaveMovieManagement(function(result) {
                            if (result === 'save') window.MovieManagement.save('media-hunt-instances');
                            else if (result === 'discard') window.MovieManagement.cancel('media-hunt-instances');
                        });
                    };
                }
            })
            .catch(function() {
                _movieManagementData = defaults();
                contentEl.innerHTML = generateFormHtml(_movieManagementData);
                setupChangeDetection();
                if (saveBtn) saveBtn.onclick = function() { window.MovieManagement.save(); };
                if (backBtn) backBtn.onclick = function() {
                    confirmLeaveMovieManagement(function(result) {
                        if (result === 'save') window.MovieManagement.save('media-hunt-instances');
                        else if (result === 'discard') window.MovieManagement.cancel('media-hunt-instances');
                    });
                };
            });
    }

    function save(optionalNextSection) {
        if (_mgmtMode === 'tv') return;
        var nextSection = optionalNextSection || 'media-hunt-instances';
        var body = collectFormData();
        var instId = getInstanceId();
        if (instId) body.instance_id = parseInt(instId, 10);
        var saveBtn = document.getElementById('movie-management-save');
        if (saveBtn) saveBtn.disabled = true;

        var url = appendInstanceParam(getApiBase());
        fetch(url, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                _movieManagementDirty = false;
                if (saveBtn) {
                    saveBtn.disabled = true;
                    saveBtn.classList.remove('enabled');
                }
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('Media Management saved.', 'success');
                }
                if (window.huntarrUI && window.huntarrUI.switchSection) {
                    window.huntarrUI.switchSection(nextSection);
                }
            })
            .catch(function() {
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('Failed to save Media Management.', 'error');
                }
                if (saveBtn) {
                    saveBtn.disabled = false;
                    saveBtn.classList.add('enabled');
                }
            });
    }

    function cancel(optionalNextSection) {
        _movieManagementDirty = false;
        _movieManagementData = null;
        if (window.huntarrUI && window.huntarrUI.switchSection) {
            window.huntarrUI.switchSection(optionalNextSection || 'media-hunt-instances');
        }
    }

    function getApiBase() {
        return _mgmtMode === 'tv' ? './api/tv-hunt/settings/tv-management' : './api/settings/movie-management';
    }

    function getInstanceId() {
        var sel = document.getElementById('movie-management-instance-select');
        var v = sel && sel.value ? sel.value : '';
        if (v && v.indexOf(':') >= 0) return v.split(':')[1] || '';
        return v || '';
    }

    function appendInstanceParam(url) {
        var id = getInstanceId();
        if (!id) return url;
        return url + (url.indexOf('?') >= 0 ? '&' : '?') + 'instance_id=' + encodeURIComponent(id);
    }

    function tvPlaceholderHtml() {
        return '<div class="editor-grid"><div class="editor-section">' +
            '<div class="editor-section-title">TV Management</div>' +
            '<div style="text-align:center;padding:40px 20px;color:#64748b;">' +
            '<i class="fas fa-tv" style="font-size:2rem;margin-bottom:12px;display:block;opacity:0.5;"></i>' +
            '<p style="margin:0;font-size:0.95rem;">TV management settings (naming, folder structure, episode handling) will be available in a future update.</p>' +
            '</div></div></div>';
    }

    function populateCombinedInstanceDropdown(preferMode) {
        var selectEl = document.getElementById('movie-management-instance-select');
        if (!selectEl) return;
        selectEl.innerHTML = '<option value="">Loading...</option>';
        var ts = Date.now();
        Promise.all([
            fetch('./api/movie-hunt/instances?t=' + ts, { cache: 'no-store' }).then(function(r) { return r.json(); }),
            fetch('./api/tv-hunt/instances?t=' + ts, { cache: 'no-store' }).then(function(r) { return r.json(); }),
            fetch('./api/movie-hunt/instances/current?t=' + ts, { cache: 'no-store' }).then(function(r) { return r.json(); }),
            fetch('./api/tv-hunt/instances/current?t=' + ts, { cache: 'no-store' }).then(function(r) { return r.json(); })
        ]).then(function(results) {
            var movieList = (results[0].instances || []).map(function(inst) {
                return { value: 'movie:' + inst.id, label: 'Movie - ' + (inst.name || 'Instance ' + inst.id) };
            });
            var tvList = (results[1].instances || []).map(function(inst) {
                return { value: 'tv:' + inst.id, label: 'TV - ' + (inst.name || 'Instance ' + inst.id) };
            });
            var combined = movieList.concat(tvList);
            combined.sort(function(a, b) { return (a.label || '').localeCompare(b.label || '', undefined, { sensitivity: 'base' }); });
            var currentMovie = results[2].current_instance_id != null ? Number(results[2].current_instance_id) : null;
            var currentTv = results[3].current_instance_id != null ? Number(results[3].current_instance_id) : null;
            selectEl.innerHTML = '';
            if (combined.length === 0) {
                var emptyOpt = document.createElement('option');
                emptyOpt.value = '';
                emptyOpt.textContent = 'No Movie or TV Hunt instances';
                selectEl.appendChild(emptyOpt);
                var noInstEl = document.getElementById('movie-management-no-instances');
                var wrapperEl = document.getElementById('movie-management-content-wrapper');
                if (noInstEl) noInstEl.style.display = '';
                if (wrapperEl) wrapperEl.style.display = 'none';
                return;
            }
            combined.forEach(function(item) {
                var opt = document.createElement('option');
                opt.value = item.value;
                opt.textContent = item.label;
                selectEl.appendChild(opt);
            });
            var saved = (typeof localStorage !== 'undefined' && localStorage.getItem('media-hunt-management-last-instance')) || '';
            var selected = '';
            if (preferMode === 'movie' && currentMovie != null) {
                selected = 'movie:' + currentMovie;
                if (!combined.some(function(i) { return i.value === selected; })) selected = combined[0].value;
            } else if (preferMode === 'tv' && currentTv != null) {
                selected = 'tv:' + currentTv;
                if (!combined.some(function(i) { return i.value === selected; })) selected = combined[0].value;
            } else if (saved && combined.some(function(i) { return i.value === saved; })) {
                selected = saved;
            } else if (currentMovie != null && combined.some(function(i) { return i.value === 'movie:' + currentMovie; })) {
                selected = 'movie:' + currentMovie;
            } else if (currentTv != null && combined.some(function(i) { return i.value === 'tv:' + currentTv; })) {
                selected = 'tv:' + currentTv;
            } else {
                selected = combined[0].value;
            }
            selectEl.value = selected;
            var parts = (selected || '').split(':');
            var noInstEl = document.getElementById('movie-management-no-instances');
            var wrapperEl = document.getElementById('movie-management-content-wrapper');
            if (noInstEl) noInstEl.style.display = 'none';
            if (wrapperEl) wrapperEl.style.display = '';
            if (parts.length === 2) {
                _mgmtMode = parts[0] === 'tv' ? 'tv' : 'movie';
                if (typeof localStorage !== 'undefined') localStorage.setItem('media-hunt-management-last-instance', selected);
                load();
            }
        }).catch(function() {
            selectEl.innerHTML = '<option value="">Failed to load instances</option>';
        });
    }

    function onCombinedInstanceChange() {
        var selectEl = document.getElementById('movie-management-instance-select');
        if (!selectEl) return;
        var val = selectEl.value || '';
        var parts = val.split(':');
        if (parts.length === 2) {
            _mgmtMode = parts[0] === 'tv' ? 'tv' : 'movie';
            if (typeof localStorage !== 'undefined') localStorage.setItem('media-hunt-management-last-instance', val);
            load();
        }
    }

    function initOrRefresh(preferMode) {
        _mgmtMode = (preferMode === 'tv') ? 'tv' : 'movie';
        var selectEl = document.getElementById('movie-management-instance-select');
        if (selectEl && selectEl.options.length <= 1) {
            populateCombinedInstanceDropdown(preferMode);
        } else {
            var val = selectEl.value || '';
            var parts = val.split(':');
            if (parts.length === 2) _mgmtMode = parts[0] === 'tv' ? 'tv' : 'movie';
            load();
        }
        if (selectEl && !selectEl._mgmtChangeBound) {
            selectEl._mgmtChangeBound = true;
            selectEl.addEventListener('change', function() { onCombinedInstanceChange(); });
        }
        if (!window.MovieManagement._eventsBound) {
            window.MovieManagement._eventsBound = true;
            document.addEventListener('huntarr:instances-changed', function() { if (_mgmtMode === 'movie') populateCombinedInstanceDropdown('movie'); });
            document.addEventListener('huntarr:tv-hunt-instances-changed', function() { if (_mgmtMode === 'tv') populateCombinedInstanceDropdown('tv'); });
        }
    }

    window.MovieManagement = {
        _mgmtMode: function() { return _mgmtMode; },
        getApiBase: getApiBase,
        getInstanceId: getInstanceId,
        load: load,
        save: save,
        cancel: cancel,
        isDirty: function() { return _movieManagementDirty; },
        confirmLeave: confirmLeaveMovieManagement,
        populateCombinedInstanceDropdown: populateCombinedInstanceDropdown,
        initOrRefresh: initOrRefresh
    };
})();
