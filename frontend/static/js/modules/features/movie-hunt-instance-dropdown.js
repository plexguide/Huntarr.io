/**
 * Movie Hunt instance dropdown - server-stored current instance.
 * Attach to a <select>; on change POSTs current instance then calls onChanged so the page can reload data.
 * Uses ./api/movie-hunt/instances and ./api/movie-hunt/current-instance (never localStorage).
 */
(function() {
    'use strict';

    var baseUrl = (typeof window !== 'undefined' && window.HUNTARR_BASE_URL) ? window.HUNTARR_BASE_URL.replace(/\/$/, '') : '';

    function api(path) {
        return (baseUrl || '') + (path.indexOf('./') === 0 ? path : './' + path);
    }

    window.MovieHuntInstanceDropdown = {
        /**
         * Attach to an existing select element. Populates from API; on change sets server current and calls onChanged().
         * @param {string} selectId - id of the <select> element
         * @param {function} onChanged - callback after setting current (e.g. reload page data)
         */
        attach: function(selectId, onChanged) {
            var select = document.getElementById(selectId);
            if (!select) return;

            function setCurrentAndReload(instanceId) {
                fetch(api('./api/movie-hunt/current-instance'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ instance_id: parseInt(instanceId, 10) })
                })
                    .then(function(r) { return r.json(); })
                    .then(function(data) {
                        if (data.error) {
                            console.warn('[MovieHuntInstanceDropdown] Set current failed:', data.error);
                            return;
                        }
                        if (typeof onChanged === 'function') onChanged();
                    })
                    .catch(function(err) {
                        console.warn('[MovieHuntInstanceDropdown] Set current error:', err);
                    });
            }

            function populate() {
                select.innerHTML = '<option value="">Loading...</option>';
                Promise.all([
                    fetch(api('./api/movie-hunt/instances'), { cache: 'no-store' }).then(function(r) { return r.json(); }),
                    fetch(api('./api/movie-hunt/current-instance'), { cache: 'no-store' }).then(function(r) { return r.json(); })
                ]).then(function(results) {
                    var list = (results[0].instances || []);
                    var current = (results[1].instance_id != null ? results[1].instance_id : 1);
                    select.innerHTML = '';
                    list.forEach(function(inst) {
                        var opt = document.createElement('option');
                        opt.value = String(inst.id);
                        opt.textContent = (inst.name || 'Instance ' + inst.id);
                        if (inst.id === current) opt.selected = true;
                        select.appendChild(opt);
                    });
                    if (!select.querySelector('option[selected]') && select.options.length) select.options[0].selected = true;
                }).catch(function() {
                    select.innerHTML = '<option value="1">Default Instance</option>';
                });
            }

            populate();
            select.addEventListener('change', function() {
                var val = (select.value || '').trim();
                if (!val) return;
                setCurrentAndReload(val);
            });
        },

        /** Return current instance id from server (for use when building API URLs with ?instance_id=). */
        getCurrentInstanceId: function() {
            return fetch(api('./api/movie-hunt/current-instance'), { cache: 'no-store' })
                .then(function(r) { return r.json(); })
                .then(function(data) { return data.instance_id != null ? data.instance_id : 1; })
                .catch(function() { return 1; });
        },

        /** Refresh dropdown list and selection (e.g. after Instance Management add/delete). */
        refresh: function(selectId) {
            var select = document.getElementById(selectId);
            if (!select) return;
            select.innerHTML = '<option value="">Loading...</option>';
            Promise.all([
                fetch(api('./api/movie-hunt/instances'), { cache: 'no-store' }).then(function(r) { return r.json(); }),
                fetch(api('./api/movie-hunt/current-instance'), { cache: 'no-store' }).then(function(r) { return r.json(); })
            ]).then(function(results) {
                var list = (results[0].instances || []);
                var current = (results[1].instance_id != null ? results[1].instance_id : 1);
                select.innerHTML = '';
                list.forEach(function(inst) {
                    var opt = document.createElement('option');
                    opt.value = String(inst.id);
                    opt.textContent = (inst.name || 'Instance ' + inst.id);
                    if (inst.id === current) opt.selected = true;
                    select.appendChild(opt);
                });
                if (!select.querySelector('option[selected]') && select.options.length) select.options[0].selected = true;
            }).catch(function() {
                select.innerHTML = '<option value="1">Default Instance</option>';
            });
        }
    };
})();
