/**
 * Media Hunt instance dropdown – server-stored current instance for movie or TV.
 * Attach to a <select>; on change POSTs current instance then calls onChanged.
 * Uses ./api/movie-hunt/ or ./api/tv-hunt/ (instances, current-instance) based on mode.
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
            fetch(api(apiBase + '/current-instance') + '?t=' + ts, { cache: 'no-store' }).then(function(r) { return r.json(); })
        ]).then(function(results) {
            var list = (results[0].instances || []);
            var current = results[1].instance_id != null ? Number(results[1].instance_id) : 0;
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

            fetch(api(apiBase + '/current-instance'), {
                method: 'POST',
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
        return fetch(api(apiBase + '/current-instance') + '?t=' + Date.now(), { cache: 'no-store' })
            .then(function(r) { return r.json(); })
            .then(function(data) { return data.instance_id != null ? Number(data.instance_id) : 0; })
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
    });
    document.addEventListener('huntarr:tv-hunt-instances-changed', function() {
        refreshAll('tv');
    });
})();
