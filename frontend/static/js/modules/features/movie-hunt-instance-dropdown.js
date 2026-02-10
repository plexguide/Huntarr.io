/**
 * Movie Hunt instance dropdown - server-stored current instance.
 * Attach to a <select>; on change POSTs current instance then calls onChanged so the page can reload data.
 * Uses ./api/movie-hunt/instances and ./api/movie-hunt/current-instance (never localStorage).
 *
 * attach() is safe to call repeatedly: it detects when the DOM element has been replaced
 * and re-wires the listener only when needed.
 */
(function() {
    'use strict';

    var baseUrl = (typeof window !== 'undefined' && window.HUNTARR_BASE_URL) ? window.HUNTARR_BASE_URL.replace(/\/$/, '') : '';

    function api(path) {
        return (baseUrl || '') + (path.indexOf('./') === 0 ? path : './' + path);
    }

    // Track the actual DOM element we wired up (not just the id string)
    // so we can detect when the HTML was re-rendered and the element is new.
    var _wiredElements = {};

    // Shared function to populate a select from the server
    function populateSelect(select) {
        select.innerHTML = '<option value="">Loading...</option>';
        var ts = Date.now();
        Promise.all([
            fetch(api('./api/movie-hunt/instances') + '?t=' + ts, { cache: 'no-store' }).then(function(r) { return r.json(); }),
            fetch(api('./api/movie-hunt/current-instance') + '?t=' + ts, { cache: 'no-store' }).then(function(r) { return r.json(); })
        ]).then(function(results) {
            var list = (results[0].instances || []);
            var current = results[1].instance_id != null ? Number(results[1].instance_id) : 0;
            select.innerHTML = '';
            if (list.length === 0) {
                var emptyOpt = document.createElement('option');
                emptyOpt.value = '';
                emptyOpt.textContent = 'No Movie Hunt instances';
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
            select.innerHTML = '<option value="">No Movie Hunt instances</option>';
        });
    }

    window.MovieHuntInstanceDropdown = {
        /**
         * Attach to an existing select element. Populates from API; on change sets server current and calls onChanged().
         * Safe to call repeatedly - detects DOM re-renders and re-wires the listener when the element is new.
         */
        attach: function(selectId, onChanged) {
            var select = document.getElementById(selectId);
            if (!select) return;

            // If this is the exact same DOM element we already wired, just refresh its options
            if (_wiredElements[selectId] && _wiredElements[selectId].element === select) {
                populateSelect(select);
                // Update callback in case it changed
                _wiredElements[selectId].onChanged = onChanged;
                return;
            }

            // Either first time, or the DOM was re-rendered (new element with same id).
            // Wire up the change listener on this new element.
            _wiredElements[selectId] = { element: select, onChanged: onChanged };

            // Populate dropdown from server
            populateSelect(select);

            // Add change listener on THIS element
            select.addEventListener('change', function() {
                var val = (select.value || '').trim();
                if (!val) return;

                // POST to save as current instance
                fetch(api('./api/movie-hunt/current-instance'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ instance_id: parseInt(val, 10) })
                })
                    .then(function(r) { return r.json(); })
                    .then(function(data) {
                        if (data.error) {
                            console.warn('[MovieHuntInstanceDropdown] Set current failed:', data.error);
                            return;
                        }
                        // Call the stored callback
                        var entry = _wiredElements[selectId];
                        if (entry && typeof entry.onChanged === 'function') entry.onChanged();
                    })
                    .catch(function(err) {
                        console.warn('[MovieHuntInstanceDropdown] Set current error:', err);
                    });
            });
        },

        /** Return current instance id from server (for use when building API URLs with ?instance_id=). */
        getCurrentInstanceId: function() {
            return fetch(api('./api/movie-hunt/current-instance') + '?t=' + Date.now(), { cache: 'no-store' })
                .then(function(r) { return r.json(); })
                .then(function(data) { return data.instance_id != null ? Number(data.instance_id) : 0; })
                .catch(function() { return 0; });
        },

        /** Refresh dropdown list and selection (e.g. after Instance Management add/delete). */
        refresh: function(selectId) {
            var select = document.getElementById(selectId);
            if (!select) return;
            populateSelect(select);
        }
    };
})();
