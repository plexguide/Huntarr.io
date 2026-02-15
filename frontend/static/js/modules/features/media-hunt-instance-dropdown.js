/**
 * Media Hunt instance dropdown – server-stored current instance for movie or TV.
 * Attach to a <select>; on change POSTs current instance then calls onChanged.
 * Uses ./api/movie-hunt/ or ./api/tv-hunt/ (instances, instances/current) based on mode.
 * Exposes MovieHuntInstanceDropdown and TVHuntInstanceDropdown as wrappers for compatibility.
 */
(function() {
    'use strict';

    var baseUrl = (typeof window !== 'undefined' && window.HUNTARR_BASE_URL) ? window.HUNTARR_BASE_URL.replace(/\/$/, '') : '';

    function api(path) {
        return (baseUrl || '') + (path.indexOf('./') === 0 ? path : './' + path);
    }

    var _wiredElements = {}; // selectId -> { element, onChanged, mode }

    function getApiBase(mode) {
        return mode === 'tv' ? './api/tv-hunt' : './api/movie-hunt';
    }

    function getEmptyLabel(mode) {
        return mode === 'tv' ? 'No TV Hunt instances' : 'No Movie Hunt instances';
    }

    function getVisibilityCallback(mode) {
        return mode === 'tv' ? window.updateTVHuntSettingsVisibility : window.updateMovieHuntSettingsVisibility;
    }

    function populateSelect(select, mode) {
        var apiBase = getApiBase(mode);
        var emptyLabel = getEmptyLabel(mode);
        select.innerHTML = '<option value="">Loading...</option>';
        var ts = Date.now();
        Promise.all([
            fetch(api(apiBase + '/instances') + '?t=' + ts, { cache: 'no-store' }).then(function(r) { return r.json(); }),
            fetch(api(apiBase + '/instances/current') + '?t=' + ts, { cache: 'no-store' }).then(function(r) { return r.json(); })
        ]).then(function(results) {
            var list = (results[0].instances || []);
            var current = results[1].current_instance_id != null ? Number(results[1].current_instance_id) : 0;
            select.innerHTML = '';
            if (list.length === 0) {
                var emptyOpt = document.createElement('option');
                emptyOpt.value = '';
                emptyOpt.textContent = emptyLabel;
                select.appendChild(emptyOpt);
                select.value = '';
            } else {
                list.forEach(function(inst) {
                    var opt = document.createElement('option');
                    opt.value = String(inst.id);
                    opt.textContent = (inst.name || 'Instance ' + inst.id);
                    select.appendChild(opt);
                });
                select.value = String(current);
                if (select.selectedIndex < 0 && select.options.length) {
                    select.selectedIndex = 0;
                }
            }
        }).catch(function() {
            select.innerHTML = '<option value="">' + emptyLabel + '</option>';
        });
    }

    function attach(selectId, onChanged, mode) {
        var select = document.getElementById(selectId);
        if (!select) return;

        if (_wiredElements[selectId] && _wiredElements[selectId].element === select) {
            populateSelect(select, mode);
            _wiredElements[selectId].onChanged = onChanged;
            _wiredElements[selectId].mode = mode;
            return;
        }

        _wiredElements[selectId] = { element: select, onChanged: onChanged, mode: mode };
        populateSelect(select, mode);

        select.addEventListener('change', function() {
            var val = (select.value || '').trim();
            if (!val) return;
            var entry = _wiredElements[selectId];
            var m = entry && entry.mode ? entry.mode : 'movie';
            var apiBase = getApiBase(m);

            fetch(api(apiBase + '/instances/current'), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ instance_id: parseInt(val, 10) })
            })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.error) {
                        console.warn('[MediaHuntInstanceDropdown] Set current failed:', data.error);
                        return;
                    }
                    if (entry && typeof entry.onChanged === 'function') entry.onChanged();
                    var visibilityCb = getVisibilityCallback(m);
                    if (visibilityCb) visibilityCb();
                })
                .catch(function(err) {
                    console.warn('[MediaHuntInstanceDropdown] Set current error:', err);
                });
        });
    }

    function getCurrentInstanceId(mode) {
        var apiBase = getApiBase(mode || 'movie');
        return fetch(api(apiBase + '/instances/current') + '?t=' + Date.now(), { cache: 'no-store' })
            .then(function(r) { return r.json(); })
            .then(function(data) { return data.current_instance_id != null ? Number(data.current_instance_id) : 0; })
            .catch(function() { return 0; });
    }

    function refresh(selectId, mode) {
        var select = document.getElementById(selectId);
        if (!select) return;
        var entry = _wiredElements[selectId];
        var m = mode || (entry && entry.mode) || 'movie';
        populateSelect(select, m);
        if (entry) entry.mode = m;
    }

    function refreshAll(mode) {
        Object.keys(_wiredElements).forEach(function(id) {
            var entry = _wiredElements[id];
            if (entry && (!mode || entry.mode === mode)) {
                var select = entry.element;
                if (select) populateSelect(select, entry.mode);
            }
        });
    }

    window.MediaHuntInstanceDropdown = {
        attach: attach,
        getCurrentInstanceId: getCurrentInstanceId,
        refresh: refresh,
        refreshAll: refreshAll
    };

    window.MovieHuntInstanceDropdown = {
        attach: function(selectId, onChanged) { attach(selectId, onChanged, 'movie'); },
        getCurrentInstanceId: function() { return getCurrentInstanceId('movie'); },
        refresh: function(selectId) { refresh(selectId, 'movie'); },
        refreshAll: function() { refreshAll('movie'); }
    };

    window.TVHuntInstanceDropdown = {
        attach: function(selectId, onChanged) { attach(selectId, onChanged, 'tv'); },
        getCurrentInstanceId: function() { return getCurrentInstanceId('tv'); },
        refresh: function(selectId) { refresh(selectId, 'tv'); },
        refreshAll: function() { refreshAll('tv'); }
    };

    document.addEventListener('huntarr:instances-changed', function() {
        refreshAll('movie');
        if (window.MediaHuntActivityInstanceDropdown && window.MediaHuntActivityInstanceDropdown.refresh) {
            window.MediaHuntActivityInstanceDropdown.refresh('activity-combined-instance-select');
            window.MediaHuntActivityInstanceDropdown.refresh('tv-activity-combined-instance-select');
        }
    });
    document.addEventListener('huntarr:tv-hunt-instances-changed', function() {
        refreshAll('tv');
        if (window.MediaHuntActivityInstanceDropdown && window.MediaHuntActivityInstanceDropdown.refresh) {
            window.MediaHuntActivityInstanceDropdown.refresh('activity-combined-instance-select');
            window.MediaHuntActivityInstanceDropdown.refresh('tv-activity-combined-instance-select');
        }
    });

    // --- Combined Activity dropdown (Movie Hunt + TV Hunt instances in one select) ---
    var _activityCombinedWired = {};  // selectId -> { element, onChanged, preferMode }

    function safeJsonFetch(url, fallback) {
        return fetch(url, { cache: 'no-store' }).then(function(r) { return r.json(); }).catch(function() { return fallback || {}; });
    }

    function populateActivityCombined(select, preferMode) {
        select.innerHTML = '<option value="">Loading...</option>';
        var ts = Date.now();
        var base = api('./api/') || './api/';
        Promise.all([
            safeJsonFetch(base + 'movie-hunt/instances?t=' + ts, { instances: [] }),
            safeJsonFetch(base + 'movie-hunt/instances/current?t=' + ts, { current_instance_id: null }),
            safeJsonFetch(base + 'tv-hunt/instances?t=' + ts, { instances: [] }),
            safeJsonFetch(base + 'tv-hunt/instances/current?t=' + ts, { current_instance_id: null }),
            safeJsonFetch(base + 'indexer-hunt/indexers?t=' + ts, { indexers: [] }),
            safeJsonFetch(base + 'movie-hunt/has-clients?t=' + ts, { has_clients: false })
        ]).then(function(results) {
            var movieList = results[0].instances || [];
            var movieCurrent = results[1].current_instance_id != null ? Number(results[1].current_instance_id) : null;
            var tvList = results[2].instances || [];
            var tvCurrent = results[3].current_instance_id != null ? Number(results[3].current_instance_id) : null;

            select.innerHTML = '';

            if (movieList.length === 0 && tvList.length === 0) {
                var emptyOpt = document.createElement('option');
                emptyOpt.value = '';
                emptyOpt.textContent = 'No Movie Hunt or TV Hunt instances';
                select.appendChild(emptyOpt);
                select.value = '';
                _updateActivityVisibility(select.id, 'no-instances');
                return;
            }
            var indexerCount = (results[4].indexers || []).length;
            if (indexerCount === 0) {
                select.innerHTML = '';
                var emptyOpt = document.createElement('option');
                emptyOpt.value = '';
                emptyOpt.textContent = 'No indexers configured';
                select.appendChild(emptyOpt);
                select.value = '';
                _updateActivityVisibility(select.id, 'no-indexers');
                return;
            }
            var hasClients = results[5].has_clients === true;
            if (!hasClients) {
                select.innerHTML = '';
                var emptyOpt = document.createElement('option');
                emptyOpt.value = '';
                emptyOpt.textContent = 'No clients configured';
                select.appendChild(emptyOpt);
                select.value = '';
                _updateActivityVisibility(select.id, 'no-clients');
                return;
            }
            _updateActivityVisibility(select.id, 'ok');

            if (movieList.length > 0) {
                var movieGroup = document.createElement('optgroup');
                movieGroup.label = 'Movie Hunt';
                movieList.forEach(function(inst) {
                    var opt = document.createElement('option');
                    opt.value = 'movie:' + inst.id;
                    opt.textContent = inst.name || 'Instance ' + inst.id;
                    movieGroup.appendChild(opt);
                });
                select.appendChild(movieGroup);
            }
            if (tvList.length > 0) {
                var tvGroup = document.createElement('optgroup');
                tvGroup.label = 'TV Hunt';
                tvList.forEach(function(inst) {
                    var opt = document.createElement('option');
                    opt.value = 'tv:' + inst.id;
                    opt.textContent = inst.name || 'Instance ' + inst.id;
                    tvGroup.appendChild(opt);
                });
                select.appendChild(tvGroup);
            }

            var targetVal = '';
            if (preferMode === 'movie' && movieCurrent != null && movieList.some(function(i) { return i.id === movieCurrent; })) {
                targetVal = 'movie:' + movieCurrent;
            } else if (preferMode === 'tv' && tvCurrent != null && tvList.some(function(i) { return i.id === tvCurrent; })) {
                targetVal = 'tv:' + tvCurrent;
            } else if (movieCurrent != null && movieList.some(function(i) { return i.id === movieCurrent; })) {
                targetVal = 'movie:' + movieCurrent;
            } else if (tvCurrent != null && tvList.some(function(i) { return i.id === tvCurrent; })) {
                targetVal = 'tv:' + tvCurrent;
            } else if (movieList.length > 0) {
                targetVal = 'movie:' + movieList[0].id;
            } else if (tvList.length > 0) {
                targetVal = 'tv:' + tvList[0].id;
            }
            select.value = targetVal;
        }).catch(function() {
            select.innerHTML = '<option value="">Unable to load instances</option>';
            _updateActivityVisibility(select.id, 'unable-to-load');
        });
    }

    function _updateActivityVisibility(selectId, state) {
        var unableEl, wrapperEl;
        if (selectId === 'activity-combined-instance-select') {
            unableEl = document.getElementById('activity-unable-to-load');
            wrapperEl = document.getElementById('activity-content-wrapper');
        } else if (selectId === 'tv-activity-combined-instance-select') {
            unableEl = document.getElementById('tv-activity-unable-to-load');
            wrapperEl = document.getElementById('tv-activity-content-wrapper');
        } else {
            return;
        }
        if (unableEl) unableEl.style.display = (state === 'unable-to-load') ? '' : 'none';
        if (wrapperEl) wrapperEl.style.display = (state === 'ok' || state === 'no-instances' || state === 'no-indexers' || state === 'no-clients') ? '' : 'none';
    }

    function attachActivityCombined(selectId, onChanged, preferMode) {
        var select = document.getElementById(selectId);
        if (!select) return;

        _activityCombinedWired[selectId] = { element: select, onChanged: onChanged, preferMode: preferMode };
        populateActivityCombined(select, preferMode);

        select.addEventListener('change', function() {
            var val = (select.value || '').trim();
            if (!val) return;
            var parts = val.split(':');
            var mode = parts[0];
            var instanceId = parts[1] ? parseInt(parts[1], 10) : null;
            if (mode !== 'movie' && mode !== 'tv') return;
            var wired = _activityCombinedWired[selectId];

            var apiBase = getApiBase(mode);
            fetch(api(apiBase + '/instances/current'), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ instance_id: instanceId })
            })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.error) {
                        console.warn('[MediaHuntActivityDropdown] Set current failed:', data.error);
                        return;
                    }
                    var cb = getVisibilityCallback(mode);
                    if (cb) cb();

                    var hash = (window.location.hash || '').replace(/^#/, '');
                    var isMovieActivity = /^(activity-queue|activity-history|activity-blocklist|activity-logs)$/.test(hash);
                    var isTvActivity = /^tv-hunt-activity-(queue|history|blocklist)$/.test(hash);

                    if (mode === 'tv' && isMovieActivity) {
                        var tab = (hash === 'activity-logs') ? 'queue' : hash.replace('activity-', '');
                        window.location.hash = 'tv-hunt-activity-' + tab;
                    } else if (mode === 'movie' && isTvActivity) {
                        var match = hash.match(/^tv-hunt-activity-(queue|history|blocklist)$/);
                        var tab = match ? match[1] : 'queue';
                        window.location.hash = 'activity-' + tab;
                    } else {
                        if (wired && typeof wired.onChanged === 'function') wired.onChanged();
                    }
                })
                .catch(function(err) {
                    console.warn('[MediaHuntActivityDropdown] Set current error:', err);
                });
        });
    }

    function refreshActivityCombined(selectId) {
        var select = document.getElementById(selectId);
        if (!select) return;
        var entry = _activityCombinedWired[selectId];
        populateActivityCombined(select, entry ? entry.preferMode : null);
    }

    window.MediaHuntActivityInstanceDropdown = {
        attach: attachActivityCombined,
        refresh: refreshActivityCombined
    };
})();
