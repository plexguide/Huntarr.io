
/* === modules/features/media-utils.js === */
/**
 * MediaUtils — Shared utility functions for media cards across Movie Hunt and Requestarr.
 * Consolidates duplicated logic into a single source of truth.
 *
 * Provides:
 *   - hideMedia()       — Hide media from discovery with confirmation + animation
 *   - getStatusBadge()  — Consistent status badge HTML
 *   - animateCardRemoval() — Shared card removal animation
 *   - resolveMovieInstance() — Resolve instance info from various sources
 */
(function() {
    'use strict';

    /* ── Card removal animation (used by hide, delete, etc.) ── */
    function animateCardRemoval(cardElement, callback) {
        if (!cardElement) {
            if (typeof callback === 'function') callback();
            return;
        }
        cardElement.style.transition = 'opacity 0.3s, transform 0.3s';
        cardElement.style.opacity = '0';
        cardElement.style.transform = 'scale(0.8)';
        setTimeout(function() {
            cardElement.remove();
            if (typeof callback === 'function') callback();
        }, 300);
    }

    /* ── Status badge HTML ── */
    /**
     * Returns status badge HTML for a media card.
     * @param {boolean} inLibrary - Item is fully available (downloaded)
     * @param {boolean} partial   - Item is requested/monitored but not downloaded
     * @param {boolean} hasInstance - An instance is configured
     * @returns {string} HTML string
     */
    function getStatusBadge(inLibrary, partial, hasInstance) {
        if (!hasInstance) return '';
        if (inLibrary) {
            return '<div class="media-card-status-badge complete"><i class="fas fa-check"></i></div>';
        }
        if (partial) {
            return '<div class="media-card-status-badge partial"><i class="fas fa-bookmark"></i></div>';
        }
        return '<div class="media-card-status-badge available"><i class="fas fa-download"></i></div>';
    }

    /* ── Action button HTML (trash or eye-slash) ── */
    /**
     * Returns the action button HTML for a media card.
     * @param {boolean} inLibrary - Item is fully available
     * @param {boolean} partial   - Item is requested
     * @param {boolean} hasInstance - An instance is configured
     * @returns {string} HTML string
     */
    function getActionButton(inLibrary, partial, hasInstance) {
        if (!hasInstance) return '';
        if (inLibrary || partial) {
            return '<button class="media-card-delete-btn" title="Remove / Delete"><i class="fas fa-trash-alt"></i></button>';
        }
        return '<button class="media-card-hide-btn" title="Hide this media permanently"><i class="fas fa-eye-slash"></i></button>';
    }

    /* ── Decode compound instance value ── */
    /**
     * Decode a compound instance value like "movie_hunt:MyInstance" or "radarr:MyRadarr".
     * @param {string} value - Compound value
     * @returns {{appType: string, name: string}}
     */
    function decodeInstanceValue(value) {
        if (!value) return { appType: 'radarr', name: '' };
        var idx = value.indexOf(':');
        if (idx === -1) return { appType: 'radarr', name: value };
        return { appType: value.substring(0, idx), name: value.substring(idx + 1) };
    }

    /* ── Hide media (single source of truth) ── */
    /**
     * Hide media from discovery pages.
     * @param {Object} options
     *   - tmdbId {number|string}     - TMDB ID of the media
     *   - mediaType {string}         - 'movie' or 'tv'
     *   - title {string}             - Display title
     *   - posterPath {string|null}   - Poster URL
     *   - appType {string}           - 'movie_hunt', 'radarr', or 'sonarr'
     *   - instanceName {string}      - Instance display name
     *   - cardElement {HTMLElement}   - Card DOM element (for animation)
     *   - hiddenMediaSet {Set|null}  - Optional Set to add the hidden key to
     *   - onHidden {function|null}   - Optional callback after successful hide
     */
    function hideMedia(options) {
        var tmdbId = options.tmdbId;
        var mediaType = options.mediaType || 'movie';
        var title = options.title || 'this media';
        var posterPath = options.posterPath || null;
        var appType = options.appType || 'movie_hunt';
        var instanceName = options.instanceName || '';
        var cardElement = options.cardElement || null;
        var hiddenMediaSet = options.hiddenMediaSet || null;
        var onHidden = options.onHidden || null;

        if (!instanceName) {
            if (window.huntarrUI && window.huntarrUI.showNotification) {
                window.huntarrUI.showNotification('No instance selected.', 'error');
            }
            return;
        }

        var msg = 'Hide "' + title + '" permanently?\n\nThis will remove it from all discovery pages. You can unhide it later from the Hidden Media page.';

        var doHide = function() {
            fetch('./api/requestarr/hidden-media', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tmdb_id: tmdbId,
                    media_type: mediaType,
                    title: title,
                    poster_path: posterPath,
                    app_type: appType,
                    instance_name: instanceName
                })
            })
            .then(function(r) {
                if (!r.ok) throw new Error('Failed to hide media');
                return r.json();
            })
            .then(function() {
                // Track in hidden set if provided
                if (hiddenMediaSet) {
                    var key = tmdbId + ':' + mediaType + ':' + appType + ':' + instanceName;
                    hiddenMediaSet.add(key);
                }

                // Animate card removal
                animateCardRemoval(cardElement);

                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('"' + title + '" hidden.', 'success');
                }

                if (typeof onHidden === 'function') onHidden();
            })
            .catch(function(err) {
                console.error('[MediaUtils] Error hiding media:', err);
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('Failed to hide media.', 'error');
                }
            });
        };

        if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
            window.HuntarrConfirm.show({
                title: 'Hide Media',
                message: msg,
                confirmLabel: 'Hide',
                onConfirm: doHide
            });
        } else {
            doHide();
        }
    }

    /* ── Resolve movie instance info from various DOM/data sources ── */
    /**
     * Resolve instance details for a movie, trying multiple sources.
     * @param {Object} options
     *   - selectElementId {string}       - DOM select element ID to read from
     *   - compoundValue {string|null}    - Compound value like "movie_hunt:Name"
     *   - instancePool {Array|null}      - Array of {name, id} objects to search
     *   - movieHuntInstances {Array|null} - Fallback Movie Hunt instances
     *   - radarrInstances {Array|null}    - Fallback Radarr instances
     * @returns {{appType: string, instanceName: string, instanceId: string|number}}
     */
    function resolveMovieInstance(options) {
        options = options || {};

        // Try compound value first (Requestarr pattern)
        if (options.compoundValue) {
            var decoded = decodeInstanceValue(options.compoundValue);
            var result = { appType: decoded.appType, instanceName: decoded.name, instanceId: '' };

            // Try to find numeric ID from pool
            var pool = options.instancePool || [];
            var match = pool.find(function(i) { return i.name === decoded.name; });
            if (match) result.instanceId = match.id || '';
            return result;
        }

        // Try DOM select element (Movie Hunt pattern)
        if (options.selectElementId) {
            var select = document.getElementById(options.selectElementId);
            if (select && select.value) {
                var name = select.options && select.options[select.selectedIndex]
                    ? select.options[select.selectedIndex].textContent
                    : select.value;
                return { appType: 'movie_hunt', instanceName: name, instanceId: select.value };
            }
        }

        // Fallback: first available instance
        var mh = options.movieHuntInstances || [];
        var rr = options.radarrInstances || [];
        if (mh.length > 0) return { appType: 'movie_hunt', instanceName: mh[0].name || '', instanceId: mh[0].id || '' };
        if (rr.length > 0) return { appType: 'radarr', instanceName: rr[0].name || '', instanceId: rr[0].id || '' };

        return { appType: 'movie_hunt', instanceName: '', instanceId: '' };
    }

    /* ── Detail page refresh-after-action event system ── */
    /*
     * Single source of truth for:
     *   - Listening for request-success events (from Requestarr modal)
     *   - Listening for status-changed events (from edit save, delete, etc.)
     *   - Dispatching status-changed events
     *   - Delayed re-fetch pattern (immediate + 3s + 8s for fast downloads)
     *
     * Both Movie Hunt detail and Requestarr detail call setupDetailRefreshListeners()
     * with their own refreshCallback. The logic lives here once.
     */

    /**
     * Set up event listeners that auto-refresh a detail page after user actions.
     * Call this from setupDetailInteractions() in any detail page module.
     *
     * @param {Object} options
     *   - getTmdbId {function}    — returns the current movie's TMDB ID (called on each event)
     *   - refreshCallback {function} — called to refresh the detail page status/toolbar
     *   - label {string}          — log label, e.g. 'RequestarrDetail' or 'RequestarrTVDetail'
     * @returns {Object} handle — pass to teardownDetailRefreshListeners() on cleanup
     */
    function setupDetailRefreshListeners(options) {
        var getTmdbId = options.getTmdbId;
        var refreshCb = options.refreshCallback;
        var label = options.label || 'DetailPage';

        function onRequestSuccess(e) {
            var detail = e.detail || {};
            var myId = getTmdbId();
            if (!myId || String(detail.tmdbId) !== String(myId)) return;

            console.log('[' + label + '] Request succeeded, refreshing status...');
            refreshCb();
            setTimeout(function() { refreshCb(); }, 3000);
            setTimeout(function() { refreshCb(); }, 8000);
        }

        function onStatusChanged(e) {
            var detail = e.detail || {};
            var myId = getTmdbId();
            if (!myId || String(detail.tmdbId) !== String(myId)) return;

            console.log('[' + label + '] Status changed (' + (detail.action || '?') + '), refreshing...');
            refreshCb();
        }

        window.addEventListener('requestarr-request-success', onRequestSuccess);
        window.addEventListener('media-status-changed', onStatusChanged);

        return { _reqHandler: onRequestSuccess, _statusHandler: onStatusChanged };
    }

    /**
     * Remove listeners created by setupDetailRefreshListeners().
     * @param {Object} handle — the return value from setupDetailRefreshListeners()
     */
    function teardownDetailRefreshListeners(handle) {
        if (!handle) return;
        if (handle._reqHandler) window.removeEventListener('requestarr-request-success', handle._reqHandler);
        if (handle._statusHandler) window.removeEventListener('media-status-changed', handle._statusHandler);
    }

    /**
     * Dispatch a status-changed event so all listening detail pages refresh.
     * Call this after edit-save, force-search, force-upgrade, delete, etc.
     *
     * @param {number|string} tmdbId
     * @param {string} action — e.g. 'edit', 'force-search', 'force-upgrade', 'delete'
     */
    function dispatchStatusChanged(tmdbId, action) {
        window.dispatchEvent(new CustomEvent('media-status-changed', {
            detail: { tmdbId: tmdbId, action: action || 'unknown' }
        }));
    }

    /**
     * Encode a compound instance value: "appType:instanceName"
     */
    function encodeInstanceValue(appType, name) {
        return appType + ':' + name;
    }

    // Export to window
    window.MediaUtils = {
        hideMedia: hideMedia,
        getStatusBadge: getStatusBadge,
        getActionButton: getActionButton,
        animateCardRemoval: animateCardRemoval,
        encodeInstanceValue: encodeInstanceValue,
        decodeInstanceValue: decodeInstanceValue,
        resolveMovieInstance: resolveMovieInstance,
        setupDetailRefreshListeners: setupDetailRefreshListeners,
        teardownDetailRefreshListeners: teardownDetailRefreshListeners,
        dispatchStatusChanged: dispatchStatusChanged
    };
})();


/* === modules/features/media-hunt-instance-dropdown.js === */
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

            // After population, fire the onChanged callback so data loads automatically
            var wired = _activityCombinedWired[select.id];
            if (wired && typeof wired.onChanged === 'function' && targetVal) {
                wired.onChanged();
            }
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


/* === modules/features/media-hunt.js === */
/**
 * Media Hunt – unified discover for Movie Hunt and TV Hunt.
 * Mode from window._mediaHuntSectionMode ('movie' | 'tv'). Uses #media-hunt-* elements.
 */
(function() {
    'use strict';

    const SEARCH_DEBOUNCE_MS = 500;

    function getMode() {
        var m = (window._mediaHuntSectionMode || 'movie').toLowerCase();
        return (m === 'tv') ? 'tv' : 'movie';
    }

    window.MediaHunt = {
        searchTimeout: null,
        page: 1,
        hasMore: true,
        loading: false,
        requestToken: 0,
        observer: null,
        _scrollSetup: false,
        _instanceSelectReady: false,
        _currentSort: 'popularity.desc',

        init() {
            const section = document.getElementById('mediaHuntSection');
            if (!section) return;

            const mode = getMode();
            const betaEl = document.getElementById('media-hunt-beta-text');
            const searchInput = document.getElementById('media-hunt-search-input');
            const loadingText = document.getElementById('media-hunt-grid-loading-text');
            const filterBtn = document.getElementById('media-hunt-filter-btn');
            const sortSelect = document.getElementById('media-hunt-sort');

            if (betaEl) {
                betaEl.innerHTML = mode === 'movie'
                    ? '<strong>Beta feature:</strong> Movie Hunt is in active development. Things may be broken and will change quickly. There is little to no support until it is officially released. Only USENET (SABnzbd, NZBGet) is supported for now. <a href="https://plexguide.github.io/Huntarr.io/apps/movie-hunt.html#docker" target="_blank" rel="noopener">Wiki &amp; Docker setup <i class="fas fa-external-link-alt" style="font-size: 0.85em;"></i></a>'
                    : '<strong>Beta feature:</strong> TV Hunt is in active development. Things may be broken and will change quickly. Only USENET (SABnzbd, NZBGet) is supported for now.';
            }
            if (searchInput) searchInput.placeholder = mode === 'movie' ? 'Search Movies' : 'Search TV Shows';
            if (loadingText) loadingText.textContent = mode === 'movie' ? 'Loading movies...' : 'Loading TV shows...';
            if (filterBtn) filterBtn.style.display = mode === 'movie' ? '' : 'none';

            if (sortSelect) {
                sortSelect.innerHTML = '';
                const opts = mode === 'movie'
                    ? [
                        { v: 'popularity.desc', l: 'Popularity' },
                        { v: 'vote_average.desc', l: 'Rating' },
                        { v: 'release_date.desc', l: 'Release Date Descending' },
                        { v: 'release_date.asc', l: 'Release Date Ascending' },
                        { v: 'title.asc', l: 'Title (A-Z)' },
                        { v: 'title.desc', l: 'Title (Z-A)' }
                    ]
                    : [
                        { v: 'popularity.desc', l: 'Popularity' },
                        { v: 'vote_average.desc', l: 'Rating' },
                        { v: 'first_air_date.desc', l: 'Air Date (Newest)' },
                        { v: 'first_air_date.asc', l: 'Air Date (Oldest)' },
                        { v: 'name.asc', l: 'Title (A-Z)' },
                        { v: 'name.desc', l: 'Title (Z-A)' }
                    ];
                opts.forEach(function(o) {
                    const opt = document.createElement('option');
                    opt.value = o.v;
                    opt.textContent = o.l;
                    sortSelect.appendChild(opt);
                });
                sortSelect.value = mode === 'movie' ? 'popularity.desc' : 'popularity.desc';
                this._currentSort = sortSelect.value;
            }

            this.showMainView();
            this.setupSearch();
            this.setupSort();

            if (mode === 'movie') {
                this.setupFilterButton();
                if (window.MediaHuntFilters && window.MediaHuntFilters.init) {
                    window.MediaHuntFilters.init();
                }
            }

            if (mode === 'movie' && window.MovieHuntInstanceDropdown && document.getElementById('media-hunt-instance-select')) {
                if (!this._instanceSelectReady) {
                    window.MovieHuntInstanceDropdown.attach('media-hunt-instance-select', () => {
                        this.page = 1;
                        this.hasMore = true;
                        this.loading = false;
                        this.requestToken++;
                        const grid = document.getElementById('media-hunt-media-grid');
                        if (grid) grid.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Loading movies...</p></div>';
                        this.loadMovies(1);
                    });
                    this._instanceSelectReady = true;
                }
                this.page = 1;
                this.hasMore = true;
                this.loading = false;
                this.requestToken++;
                this.loadMovies(1);
            } else if (mode === 'tv' && window.TVHuntInstanceDropdown && document.getElementById('media-hunt-instance-select')) {
                if (!this._instanceSelectReady) {
                    window.TVHuntInstanceDropdown.attach('media-hunt-instance-select', () => {
                        this.page = 1;
                        this.hasMore = true;
                        this.loading = false;
                        this.loadDiscover();
                    });
                    this._instanceSelectReady = true;
                }
                this.page = 1;
                this.hasMore = true;
                this.loading = false;
                this.loadDiscover();
            } else {
                this.page = 1;
                this.hasMore = true;
                this.loading = false;
                this.requestToken++;
                if (mode === 'movie') this.loadMovies(1);
                else this.loadDiscover();
            }

            if (!this._scrollSetup) {
                this.setupInfiniteScroll();
                this._scrollSetup = true;
            }
        },

        setupSearch() {
            const self = this;
            const input = document.getElementById('media-hunt-search-input');
            if (!input) return;
            input.addEventListener('input', function() {
                if (self.searchTimeout) clearTimeout(self.searchTimeout);
                const query = (input.value || '').trim();
                if (!query) {
                    self.showMainView();
                    if (getMode() === 'movie') self.loadMovies(1);
                    else self.loadDiscover();
                    return;
                }
                self.searchTimeout = setTimeout(function() { self.performSearch(query); }, SEARCH_DEBOUNCE_MS);
            });
        },

        performSearch(query) {
            const mode = getMode();
            const resultsView = document.getElementById('media-hunt-search-results-view');
            const mainView = document.getElementById('media-hunt-main-view');
            const grid = document.getElementById('media-hunt-search-results-grid');
            if (!resultsView || !mainView || !grid) return;

            resultsView.style.display = 'block';
            mainView.style.display = 'none';
            grid.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Searching...</p></div>';

            if (mode === 'movie') {
                fetch('./api/requestarr/search?q=' + encodeURIComponent(query) + '&app_type=radarr&instance_name=search')
                    .then(function(r) { return r.json(); })
                    .then(function(data) {
                        const results = data.results || [];
                        grid.innerHTML = '';
                        if (results.length > 0) {
                            results.forEach(function(item) { grid.appendChild(window.MediaHunt.createCard(item)); });
                        } else {
                            grid.innerHTML = '<p style="color: #888; text-align: center; padding: 60px; width: 100%;">No movies found</p>';
                        }
                    })
                    .catch(function() {
                        grid.innerHTML = '<p style="color: #ef4444; text-align: center; padding: 60px; width: 100%;">Search failed</p>';
                    });
            } else {
                fetch('./api/tv-hunt/search?q=' + encodeURIComponent(query))
                    .then(function(r) { return r.json(); })
                    .then(function(data) {
                        const results = data.results || [];
                        grid.innerHTML = '';
                        if (results.length > 0) {
                            results.forEach(function(show) { grid.appendChild(window.MediaHunt.createShowCard(show)); });
                        } else {
                            grid.innerHTML = '<p style="color: #888; text-align: center; padding: 60px; width: 100%;">No results found.</p>';
                        }
                    })
                    .catch(function() {
                        grid.innerHTML = '<p style="color: #ef4444; text-align: center; padding: 60px; width: 100%;">Search failed</p>';
                    });
            }
        },

        showMainView() {
            const resultsView = document.getElementById('media-hunt-search-results-view');
            const mainView = document.getElementById('media-hunt-main-view');
            if (resultsView) resultsView.style.display = 'none';
            if (mainView) mainView.style.display = 'block';
        },

        setupSort() {
            const self = this;
            const sortSelect = document.getElementById('media-hunt-sort');
            if (!sortSelect) return;
            sortSelect.addEventListener('change', function() {
                self._currentSort = sortSelect.value;
                self.page = 1;
                self.hasMore = true;
                self.loading = false;
                self.requestToken++;
                if (getMode() === 'movie') {
                    const grid = document.getElementById('media-hunt-media-grid');
                    if (grid) grid.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Loading movies...</p></div>';
                    self.loadMovies(1);
                } else {
                    self.loadDiscover();
                }
            });
        },

        setupFilterButton() {
            const btn = document.getElementById('media-hunt-filter-btn');
            if (btn) {
                btn.addEventListener('click', function() {
                    if (window.MediaHuntFilters && window.MediaHuntFilters.openFiltersModal) {
                        window.MediaHuntFilters.openFiltersModal();
                    }
                });
            }
        },

        getSortParam() {
            const sortSelect = document.getElementById('media-hunt-sort');
            return (sortSelect && sortSelect.value) ? sortSelect.value : 'popularity.desc';
        },

        loadMovies(page) {
            const grid = document.getElementById('media-hunt-media-grid');
            if (!grid) return;
            if (this.loading) return;
            this.loading = true;
            const token = ++this.requestToken;
            if (page === 1) {
                grid.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Loading movies...</p></div>';
            }
            let url = './api/movie-hunt/discover/movies?page=' + page + '&_=' + Date.now();
            const filterParams = (window.MediaHuntFilters && window.MediaHuntFilters.getFilterParams) ? window.MediaHuntFilters.getFilterParams() : '';
            if (filterParams) url += '&' + filterParams;
            else url += '&sort_by=' + encodeURIComponent(this.getSortParam());

            fetch(url)
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (token !== window.MediaHunt.requestToken) return;
                    if (page === 1) grid.innerHTML = '';
                    else {
                        const spinner = grid.querySelector('.loading-spinner');
                        if (spinner) spinner.remove();
                    }
                    const results = data.results || [];
                    if (results.length > 0) {
                        results.forEach(function(item) { grid.appendChild(window.MediaHunt.createCard(item)); });
                    } else if (page === 1) {
                        grid.innerHTML = '<p style="color: #888; text-align: center; width: 100%; padding: 40px;">No movies found</p>';
                    }
                    window.MediaHunt.hasMore = data.has_more !== false && results.length >= 20;
                })
                .catch(function() {
                    if (page === 1) grid.innerHTML = '<p style="color: #ef4444; text-align: center; width: 100%; padding: 40px;">Failed to load movies</p>';
                    window.MediaHunt.hasMore = false;
                })
                .finally(function() {
                    window.MediaHunt.loading = false;
                    window.MediaHunt.page = page;
                    const sentinel = document.getElementById('media-hunt-scroll-sentinel');
                    if (sentinel && window.MediaHunt.hasMore && !window.MediaHunt.loading) {
                        const rect = sentinel.getBoundingClientRect();
                        if (rect.top <= (window.innerHeight || document.documentElement.clientHeight) + 200) {
                            window.MediaHunt.loadMovies(window.MediaHunt.page + 1);
                        }
                    }
                });
        },

        loadDiscover() {
            const grid = document.getElementById('media-hunt-media-grid');
            if (!grid) return;
            if (this.loading) return;
            this.loading = true;
            if (this.page === 1) {
                grid.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Loading TV shows...</p></div>';
            }
            const self = this;
            const sortParam = (document.getElementById('media-hunt-sort') && document.getElementById('media-hunt-sort').value) || 'popularity.desc';
            fetch('./api/tv-hunt/discover/tv?page=' + this.page + '&sort_by=' + encodeURIComponent(sortParam))
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    const results = data.results || [];
                    if (self.page === 1) grid.innerHTML = '';
                    results.forEach(function(show) { grid.appendChild(window.MediaHunt.createShowCard(show)); });
                    self.hasMore = results.length >= 20;
                    self.loading = false;
                })
                .catch(function() {
                    if (self.page === 1) grid.innerHTML = '<p style="color: #ef4444; text-align: center; width: 100%; padding: 40px;">Failed to load TV shows.</p>';
                    self.loading = false;
                });
        },

        setupInfiniteScroll() {
            const sentinel = document.getElementById('media-hunt-scroll-sentinel');
            if (!sentinel || this.observer) return;
            const self = this;
            const scrollRoot = document.querySelector('.main-content') || null;
            this.observer = new IntersectionObserver(
                function(entries) {
                    entries.forEach(function(entry) {
                        if (!entry.isIntersecting) return;
                        if (getMode() === 'movie') {
                            if (self.hasMore && !self.loading) self.loadMovies(self.page + 1);
                        } else {
                            if (self.hasMore && !self.loading) {
                                self.page++;
                                self.loadDiscover();
                            }
                        }
                    });
                },
                { root: scrollRoot, rootMargin: '200px 0px', threshold: 0 }
            );
            this.observer.observe(sentinel);
        },

        getSelectedInstanceName() {
            const select = document.getElementById('media-hunt-instance-select');
            if (!select || !select.value) return '';
            const opt = select.options[select.selectedIndex];
            return opt ? opt.textContent : '';
        },

        getSelectedInstanceId() {
            const select = document.getElementById('media-hunt-instance-select');
            return (select && select.value) ? select.value : '';
        },

        hideMediaFromHome(item, cardElement) {
            const select = document.getElementById('media-hunt-instance-select');
            const instanceName = select ? (select.options[select.selectedIndex] ? select.options[select.selectedIndex].textContent : '') : '';
            window.MediaUtils.hideMedia({
                tmdbId: item.tmdb_id || item.id,
                mediaType: 'movie',
                title: item.title || 'this movie',
                posterPath: item.poster_path || null,
                appType: 'movie_hunt',
                instanceName: instanceName,
                cardElement: cardElement
            });
        },

        openDeleteModalFromHome(item, cardElement) {
            if (!window.MovieCardDeleteModal) return;
            const select = document.getElementById('media-hunt-instance-select');
            const instanceName = select ? (select.options[select.selectedIndex] ? select.options[select.selectedIndex].textContent : '') : '';
            const instanceId = select ? select.value : '';
            const inLibrary = item.in_library || false;
            const partial = item.partial || false;
            window.MovieCardDeleteModal.open(item, {
                instanceName: instanceName,
                instanceId: instanceId,
                status: inLibrary ? 'available' : (partial ? 'requested' : 'requested'),
                hasFile: inLibrary,
                appType: 'movie_hunt',
                onDeleted: function() { window.MediaUtils.animateCardRemoval(cardElement); }
            });
        },

        createCard(item) {
            const card = document.createElement('div');
            card.className = 'media-card';
            const tmdbId = item.tmdb_id || item.id;
            if (tmdbId) card.setAttribute('data-tmdb-id', tmdbId);
            card.setAttribute('data-media-type', 'movie');
            card.itemData = item;

            let posterUrl = item.poster_path || './static/images/blackout.jpg';
            const isTmdbUrl = posterUrl && !posterUrl.includes('./static/images/');
            if (isTmdbUrl && window.tmdbImageCache && window.tmdbImageCache.enabled && window.tmdbImageCache.storage === 'server') {
                posterUrl = './api/tmdb/image?url=' + encodeURIComponent(posterUrl);
            }
            const year = item.year || 'N/A';
            const rating = item.vote_average != null ? Number(item.vote_average).toFixed(1) : 'N/A';
            const overview = item.overview || 'No description available.';
            const inLibrary = item.in_library || false;
            const partial = item.partial || false;
            const instanceSelect = document.getElementById('media-hunt-instance-select');
            const hasInstance = instanceSelect && instanceSelect.value && instanceSelect.value !== '';
            const statusBadge = window.MediaUtils.getStatusBadge(inLibrary, partial, hasInstance);
            const metaClass = hasInstance ? 'media-card-meta' : 'media-card-meta no-hide';
            const showRequestBtn = hasInstance && !inLibrary;
            const overlayAction = showRequestBtn ? '<button class="media-card-request-btn"><i class="fas fa-plus-circle"></i> Add</button>' : '';
            const actionBtn = window.MediaUtils.getActionButton(inLibrary, partial, hasInstance);
            if (inLibrary) card.classList.add('in-library');

            card.innerHTML = '<div class="media-card-poster">' + statusBadge +
                '<img src="' + posterUrl + '" alt="' + (item.title || '').replace(/"/g, '&quot;') + '" onerror="this.src=\'./static/images/blackout.jpg\'">' +
                '<div class="media-card-overlay"><div class="media-card-overlay-title">' + (item.title || '').replace(/</g, '&lt;') + '</div>' +
                '<div class="media-card-overlay-content"><div class="media-card-overlay-year">' + year + '</div>' +
                '<div class="media-card-overlay-description">' + (overview || '').replace(/</g, '&lt;').slice(0, 200) + '</div>' + overlayAction + '</div></div></div>' +
                '<div class="media-card-info"><div class="media-card-title" title="' + (item.title || '').replace(/"/g, '&quot;') + '">' + (item.title || '').replace(/</g, '&lt;') + '</div>' +
                '<div class="' + metaClass + '"><span class="media-card-year">' + year + '</span><span class="media-card-rating"><i class="fas fa-star"></i> ' + rating + '</span>' + actionBtn + '</div></div>';

            const requestBtn = card.querySelector('.media-card-request-btn');
            const hideBtnEl = card.querySelector('.media-card-hide-btn');
            const deleteBtnEl = card.querySelector('.media-card-delete-btn');
            const openRequestModal = function() {
                const id = item.tmdb_id || item.id;
                if (id && window.RequestarrDiscover && window.RequestarrDiscover.modal) {
                    let suggestedInstance = null;
                    const instSelect = document.getElementById('media-hunt-instance-select');
                    if (instSelect && instSelect.value) {
                        const opt = instSelect.options[instSelect.selectedIndex];
                        const name = opt ? (opt.textContent || '').trim() : '';
                        if (name) suggestedInstance = 'movie_hunt:' + name;
                    }
                    window.RequestarrDiscover.modal.openModal(id, 'movie', suggestedInstance);
                }
            };
            const openDetailPage = function() {
                if (window.RequestarrDetail) {
                    window.RequestarrDetail.openDetail(item);
                } else {
                    openRequestModal();
                }
            };
            // When not in library and not requested: any click opens modal. When requested or in library: click opens detail page.
            const shouldOpenModal = !inLibrary && !partial;
            if (hideBtnEl) hideBtnEl.addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation(); window.MediaHunt.hideMediaFromHome(item, card); });
            if (deleteBtnEl) deleteBtnEl.addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation(); window.MediaHunt.openDeleteModalFromHome(item, card); });
            card.style.cursor = 'pointer';
            card.addEventListener('click', function(e) {
                if (hideBtnEl && (e.target === hideBtnEl || hideBtnEl.contains(e.target))) return;
                if (deleteBtnEl && (e.target === deleteBtnEl || deleteBtnEl.contains(e.target))) return;
                if (requestBtn && (e.target === requestBtn || requestBtn.contains(e.target))) { e.preventDefault(); e.stopPropagation(); openRequestModal(); return; }
                if (shouldOpenModal) {
                    openRequestModal();
                } else {
                    openDetailPage();
                }
            });
            return card;
        },

        addToCollection(show, instanceIdFromContext) {
            const tvCollectionSelect = document.getElementById('media-hunt-collection-tv-instance-select');
            const collectionSelect = document.getElementById('media-hunt-collection-instance-select'); // legacy fallback
            const discoverSelect = document.getElementById('media-hunt-instance-select');
            const instId = (instanceIdFromContext !== undefined && instanceIdFromContext !== '') ? instanceIdFromContext
                : (tvCollectionSelect ? tvCollectionSelect.value : '')
                || (collectionSelect ? collectionSelect.value : '')
                || (discoverSelect ? discoverSelect.value : '');
            if (!instId) {
                if (window.huntarrUI) window.huntarrUI.showNotification('Please select an instance first.', 'error');
                return;
            }
            const tmdbId = show.tmdb_id != null ? show.tmdb_id : show.id;
            const title = show.title || show.name || show.original_name;
            const posterPath = (show.poster_path && show.poster_path.indexOf('http') !== 0) ? show.poster_path : (show.poster_path || '');
            fetch('./api/tv-hunt/collection?instance_id=' + instId, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tmdb_id: tmdbId,
                    title: title,
                    poster_path: posterPath,
                    backdrop_path: show.backdrop_path || '',
                    first_air_date: show.first_air_date || '',
                    vote_average: show.vote_average || 0,
                    overview: show.overview || '',
                    instance_id: instId,
                })
            })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.exists && window.huntarrUI) window.huntarrUI.showNotification('Series already in collection.', 'info');
                    else if (data.success && window.huntarrUI) window.huntarrUI.showNotification('Added to collection!', 'success');
                    else if (window.huntarrUI) window.huntarrUI.showNotification(data.error || 'Failed to add.', 'error');
                })
                .catch(function() {
                    if (window.huntarrUI) window.huntarrUI.showNotification('Network error adding to collection.', 'error');
                });
        },

        createShowCard(show) {
            const card = document.createElement('div');
            card.className = 'media-card';
            card.dataset.tmdbId = show.id;
            const posterUrl = show.poster_path ? ('https://image.tmdb.org/t/p/w300' + show.poster_path) : './static/images/no-poster.png';
            const title = show.name || show.original_name || 'Unknown';
            const year = (show.first_air_date || '').substring(0, 4);
            const rating = show.vote_average ? parseFloat(show.vote_average).toFixed(1) : '';
            card.innerHTML = '<div class="media-poster">' +
                '<img src="' + posterUrl + '" alt="' + (typeof HuntarrUtils !== 'undefined' ? HuntarrUtils.escapeHtml(title) : title.replace(/</g, '&lt;').replace(/>/g, '&gt;')) + '" loading="lazy">' +
                '<div class="media-overlay"><button class="add-to-collection-btn" title="Add to Collection"><i class="fas fa-plus"></i></button></div></div>' +
                '<div class="media-info"><div class="media-title">' + (typeof HuntarrUtils !== 'undefined' ? HuntarrUtils.escapeHtml(title) : title.replace(/</g, '&lt;').replace(/>/g, '&gt;')) + '</div>' +
                '<div class="media-year">' + (year || '') + (rating ? ' &middot; <i class="fas fa-star" style="color:#facc15;font-size:0.8em;"></i> ' + rating : '') + '</div></div>';

            const addBtn = card.querySelector('.add-to-collection-btn');
            if (addBtn) {
                addBtn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    if (window.MediaHunt && window.MediaHunt.addToCollection) window.MediaHunt.addToCollection(show);
                });
            }
            card.addEventListener('click', function() {
                if (window.RequestarrTVDetail) {
                    window.RequestarrTVDetail.openDetail({ tmdb_id: show.id, id: show.id, title: show.name || show.title, poster_path: show.poster_path });
                }
            });
            return card;
        }
    };
})();


/* === modules/features/media-hunt-filters.js === */
/**
 * Media Hunt Filters - Filter management for Media Hunt discover (movie mode).
 * Uses media-hunt-* element IDs; calls window.MediaHunt.loadMovies(1) on apply.
 * Exposed as MediaHuntFilters and MovieHuntFilters for compatibility.
 */
(function() {
    'use strict';

    const currentYear = new Date().getFullYear();
    const maxYear = currentYear + 3;
    const minYear = 1900;

    const activeFilters = {
        genres: [],
        yearMin: minYear,
        yearMax: maxYear,
        runtimeMin: 0,
        runtimeMax: 400,
        ratingMin: 0,
        ratingMax: 10,
        votesMin: 0,
        votesMax: 10000,
        hideAvailable: false
    };
    let genres = [];
    let inited = false;

    function el(id) {
        return document.getElementById(id);
    }

    function loadGenres() {
        return Promise.all([
            fetch('./api/requestarr/genres/movie'),
            fetch('./api/requestarr/settings/blacklisted-genres')
        ]).then(function(responses) {
            return Promise.all([responses[0].json(), responses[1].json()]);
        }).then(function(data) {
            const blacklistedIds = (data[1].blacklisted_movie_genres || []).map(function(id) { return parseInt(id, 10); });
            if (data[0].genres) {
                genres = data[0].genres.filter(function(g) { return blacklistedIds.indexOf(g.id) === -1; });
            } else {
                genres = [
                    { id: 28, name: 'Action' }, { id: 12, name: 'Adventure' }, { id: 16, name: 'Animation' },
                    { id: 35, name: 'Comedy' }, { id: 80, name: 'Crime' }, { id: 99, name: 'Documentary' },
                    { id: 18, name: 'Drama' }, { id: 10751, name: 'Family' }, { id: 14, name: 'Fantasy' },
                    { id: 36, name: 'History' }, { id: 27, name: 'Horror' }, { id: 10402, name: 'Music' },
                    { id: 9648, name: 'Mystery' }, { id: 10749, name: 'Romance' }, { id: 878, name: 'Science Fiction' },
                    { id: 10770, name: 'TV Movie' }, { id: 53, name: 'Thriller' }, { id: 10752, name: 'War' },
                    { id: 37, name: 'Western' }
                ];
            }
            populateGenresSelect();
        }).catch(function(err) {
            console.error('[MediaHuntFilters] Error loading genres:', err);
            genres = [
                { id: 28, name: 'Action' }, { id: 12, name: 'Adventure' }, { id: 35, name: 'Comedy' },
                { id: 18, name: 'Drama' }, { id: 27, name: 'Horror' }, { id: 10749, name: 'Romance' },
                { id: 878, name: 'Science Fiction' }, { id: 53, name: 'Thriller' }
            ];
            populateGenresSelect();
        });
    }

    function populateGenresSelect() {
        const list = el('media-hunt-genre-list');
        if (!list) return;
        list.innerHTML = '';
        genres.forEach(function(genre) {
            const item = document.createElement('div');
            item.className = 'genre-item';
            item.textContent = genre.name;
            item.dataset.genreId = genre.id;
            if (activeFilters.genres.indexOf(genre.id) !== -1) item.classList.add('selected');
            item.addEventListener('click', function() {
                const genreId = parseInt(item.dataset.genreId, 10);
                const idx = activeFilters.genres.indexOf(genreId);
                if (idx > -1) {
                    activeFilters.genres.splice(idx, 1);
                    item.classList.remove('selected');
                } else {
                    activeFilters.genres.push(genreId);
                    item.classList.add('selected');
                }
                renderSelectedGenres();
                updateModalFilterCount();
                autoApplyFilters();
                const dropdown = el('media-hunt-genre-dropdown');
                if (dropdown) dropdown.style.display = 'none';
            });
            list.appendChild(item);
        });
    }

    function renderSelectedGenres() {
        const container = el('media-hunt-selected-genres');
        if (!container) return;
        container.innerHTML = '';
        if (activeFilters.genres.length === 0) {
            container.style.display = 'none';
            return;
        }
        container.style.display = 'flex';
        activeFilters.genres.forEach(function(genreId) {
            const genre = genres.find(function(g) { return g.id === genreId; });
            if (!genre) return;
            const pill = document.createElement('div');
            pill.className = 'selected-genre-pill';
            const text = document.createElement('span');
            text.textContent = genre.name;
            const remove = document.createElement('span');
            remove.className = 'remove-genre';
            remove.innerHTML = '×';
            remove.addEventListener('click', function(e) {
                e.stopPropagation();
                const idx = activeFilters.genres.indexOf(genreId);
                if (idx > -1) activeFilters.genres.splice(idx, 1);
                renderSelectedGenres();
                updateModalFilterCount();
                autoApplyFilters();
                const items = document.querySelectorAll('#media-hunt-genre-list .genre-item');
                items.forEach(function(it) {
                    if (parseInt(it.dataset.genreId, 10) === genreId) it.classList.remove('selected');
                });
            });
            pill.appendChild(text);
            pill.appendChild(remove);
            container.appendChild(pill);
        });
    }

    function updateSliderRange(type, minInput, maxInput) {
        const rangeEl = el('media-hunt-' + type + '-range');
        if (!rangeEl) return;
        const min = parseFloat(minInput.value);
        const max = parseFloat(maxInput.value);
        const minVal = parseFloat(minInput.min);
        const maxVal = parseFloat(minInput.max);
        const percentMin = ((min - minVal) / (maxVal - minVal)) * 100;
        const percentMax = ((max - minVal) / (maxVal - minVal)) * 100;
        rangeEl.style.left = percentMin + '%';
        rangeEl.style.width = (percentMax - percentMin) + '%';
    }

    function updateYearDisplay() {
        const minInput = el('media-hunt-filter-year-min');
        const maxInput = el('media-hunt-filter-year-max');
        if (!minInput || !maxInput) return;
        let min = parseInt(minInput.value, 10);
        let max = parseInt(maxInput.value, 10);
        if (min > max) { var t = min; min = max; max = t; }
        const display = el('media-hunt-year-display');
        if (display) display.textContent = 'Movies from ' + min + ' to ' + max;
    }
    function updateRuntimeDisplay() {
        const minInput = el('media-hunt-filter-runtime-min');
        const maxInput = el('media-hunt-filter-runtime-max');
        if (!minInput || !maxInput) return;
        let min = parseInt(minInput.value, 10);
        let max = parseInt(maxInput.value, 10);
        if (min > max) { var t = min; min = max; max = t; }
        const display = el('media-hunt-runtime-display');
        if (display) display.textContent = min + '-' + max + ' minute runtime';
    }
    function updateRatingDisplay() {
        const minInput = el('media-hunt-filter-rating-min');
        const maxInput = el('media-hunt-filter-rating-max');
        if (!minInput || !maxInput) return;
        let min = parseFloat(minInput.value);
        let max = parseFloat(maxInput.value);
        if (min > max) { var t = min; min = max; max = t; }
        const display = el('media-hunt-rating-display');
        if (display) display.textContent = 'Ratings between ' + min.toFixed(1) + ' and ' + max.toFixed(1);
    }
    function updateVotesDisplay() {
        const minInput = el('media-hunt-filter-votes-min');
        const maxInput = el('media-hunt-filter-votes-max');
        if (!minInput || !maxInput) return;
        let min = parseInt(minInput.value, 10);
        let max = parseInt(maxInput.value, 10);
        if (min > max) { var t = min; min = max; max = t; }
        const display = el('media-hunt-votes-display');
        if (display) display.textContent = 'Number of votes between ' + min + ' and ' + max;
    }

    function updateFilterDisplay() {
        let count = 0;
        if (activeFilters.genres.length > 0) count++;
        if (activeFilters.yearMin > minYear || activeFilters.yearMax < maxYear) count++;
        if (activeFilters.runtimeMin > 0 || activeFilters.runtimeMax < 400) count++;
        if (activeFilters.ratingMin > 0 || activeFilters.ratingMax < 10) count++;
        if (activeFilters.votesMin > 0 || activeFilters.votesMax < 10000) count++;
        if (activeFilters.hideAvailable) count++;
        const countEl = el('media-hunt-filter-count');
        const text = count === 0 ? '0 Active Filters' : count === 1 ? '1 Active Filter' : count + ' Active Filters';
        if (countEl) countEl.textContent = text;
        updateModalFilterCount();
    }

    function updateModalFilterCount() {
        let count = 0;
        if (activeFilters.genres.length > 0) count++;
        if (activeFilters.yearMin > minYear || activeFilters.yearMax < maxYear) count++;
        if (activeFilters.runtimeMin > 0 || activeFilters.runtimeMax < 400) count++;
        if (activeFilters.ratingMin > 0 || activeFilters.ratingMax < 10) count++;
        if (activeFilters.votesMin > 0 || activeFilters.votesMax < 10000) count++;
        if (activeFilters.hideAvailable) count++;
        const countEl = el('media-hunt-filter-active-count');
        const text = count === 0 ? '0 Active Filters' : count === 1 ? '1 Active Filter' : count + ' Active Filters';
        if (countEl) countEl.textContent = text;
    }

    function loadFilterValues() {
        const yearMin = el('media-hunt-filter-year-min');
        const yearMax = el('media-hunt-filter-year-max');
        const runtimeMin = el('media-hunt-filter-runtime-min');
        const runtimeMax = el('media-hunt-filter-runtime-max');
        const ratingMin = el('media-hunt-filter-rating-min');
        const ratingMax = el('media-hunt-filter-rating-max');
        const votesMin = el('media-hunt-filter-votes-min');
        const votesMax = el('media-hunt-filter-votes-max');
        const hideAvailable = el('media-hunt-hide-available-movies');
        if (yearMin) yearMin.value = activeFilters.yearMin;
        if (yearMax) yearMax.value = activeFilters.yearMax;
        if (runtimeMin) runtimeMin.value = activeFilters.runtimeMin;
        if (runtimeMax) runtimeMax.value = activeFilters.runtimeMax;
        if (ratingMin) ratingMin.value = activeFilters.ratingMin;
        if (ratingMax) ratingMax.value = activeFilters.ratingMax;
        if (votesMin) votesMin.value = activeFilters.votesMin;
        if (votesMax) votesMax.value = activeFilters.votesMax;
        if (hideAvailable) hideAvailable.checked = activeFilters.hideAvailable;
        renderSelectedGenres();
        var items = document.querySelectorAll('#media-hunt-genre-list .genre-item');
        items.forEach(function(item) {
            var genreId = parseInt(item.dataset.genreId, 10);
            if (activeFilters.genres.indexOf(genreId) !== -1) item.classList.add('selected');
            else item.classList.remove('selected');
        });
        updateYearDisplay();
        updateRuntimeDisplay();
        updateRatingDisplay();
        updateVotesDisplay();
        updateModalFilterCount();
    }

    function autoApplyFilters() {
        var yearMinEl = el('media-hunt-filter-year-min');
        var yearMaxEl = el('media-hunt-filter-year-max');
        var runtimeMinEl = el('media-hunt-filter-runtime-min');
        var runtimeMaxEl = el('media-hunt-filter-runtime-max');
        var ratingMinEl = el('media-hunt-filter-rating-min');
        var ratingMaxEl = el('media-hunt-filter-rating-max');
        var votesMinEl = el('media-hunt-filter-votes-min');
        var votesMaxEl = el('media-hunt-filter-votes-max');
        var yearMin = yearMinEl ? parseInt(yearMinEl.value, 10) : minYear;
        var yearMax = yearMaxEl ? parseInt(yearMaxEl.value, 10) : maxYear;
        var runtimeMin = runtimeMinEl ? parseInt(runtimeMinEl.value, 10) : 0;
        var runtimeMax = runtimeMaxEl ? parseInt(runtimeMaxEl.value, 10) : 400;
        var ratingMin = ratingMinEl ? parseFloat(ratingMinEl.value) : 0;
        var ratingMax = ratingMaxEl ? parseFloat(ratingMaxEl.value) : 10;
        var votesMin = votesMinEl ? parseInt(votesMinEl.value, 10) : 0;
        var votesMax = votesMaxEl ? parseInt(votesMaxEl.value, 10) : 10000;
        if (yearMin > yearMax) { var t = yearMin; yearMin = yearMax; yearMax = t; }
        if (runtimeMin > runtimeMax) { var t = runtimeMin; runtimeMin = runtimeMax; runtimeMax = t; }
        if (ratingMin > ratingMax) { var t = ratingMin; ratingMin = ratingMax; ratingMax = t; }
        if (votesMin > votesMax) { var t = votesMin; votesMin = votesMax; votesMax = t; }
        activeFilters.yearMin = yearMin;
        activeFilters.yearMax = yearMax;
        activeFilters.runtimeMin = runtimeMin;
        activeFilters.runtimeMax = runtimeMax;
        activeFilters.ratingMin = ratingMin;
        activeFilters.ratingMax = ratingMax;
        activeFilters.votesMin = votesMin;
        activeFilters.votesMax = votesMax;
        updateFilterDisplay();
        if (window.MovieHunt && window.MediaHunt.loadMovies) {
            window.MovieHunt.page = 1;
            window.MovieHunt.hasMore = true;
            window.MediaHunt.loadMovies(1);
        }
    }

    function openFiltersModal() {
        var modal = el('media-hunt-filter-modal');
        if (!modal) return;
        // Move modal to body so it isn't clipped by #mediaHuntSection (same as Requestarr / request modal)
        if (modal.parentNode !== document.body) {
            document.body.appendChild(modal);
        }
        loadFilterValues();
        modal.style.display = 'flex';
        setTimeout(function() { modal.classList.add('show'); }, 10);
        document.body.style.overflow = 'hidden';
    }

    function closeFiltersModal() {
        var modal = el('media-hunt-filter-modal');
        if (modal) {
            modal.classList.remove('show');
            setTimeout(function() {
                modal.style.display = 'none';
                document.body.style.overflow = '';
            }, 150);
        }
    }

    function clearFilters() {
        activeFilters.genres = [];
        activeFilters.yearMin = minYear;
        activeFilters.yearMax = maxYear;
        activeFilters.runtimeMin = 0;
        activeFilters.runtimeMax = 400;
        activeFilters.ratingMin = 0;
        activeFilters.ratingMax = 10;
        activeFilters.votesMin = 0;
        activeFilters.votesMax = 10000;
        activeFilters.hideAvailable = false;
        var sortSelect = el('media-hunt-sort');
        if (sortSelect) sortSelect.value = 'popularity.desc';
        updateFilterDisplay();
        loadFilterValues();
        closeFiltersModal();
        if (window.MovieHunt && window.MediaHunt.loadMovies) {
            window.MovieHunt.page = 1;
            window.MovieHunt.hasMore = true;
            window.MediaHunt.loadMovies(1);
        }
    }

    function getFilterParams() {
        var params = new URLSearchParams();
        var sortSelect = el('media-hunt-sort');
        params.append('sort_by', (sortSelect && sortSelect.value) ? sortSelect.value : 'popularity.desc');
        if (activeFilters.genres.length > 0) params.append('with_genres', activeFilters.genres.join(','));
        if (activeFilters.yearMin > minYear) params.append('release_date.gte', activeFilters.yearMin + '-01-01');
        if (activeFilters.yearMax < maxYear) params.append('release_date.lte', activeFilters.yearMax + '-12-31');
        if (activeFilters.runtimeMin > 0 || activeFilters.runtimeMax < 400) {
            params.append('with_runtime.gte', activeFilters.runtimeMin);
            params.append('with_runtime.lte', activeFilters.runtimeMax);
        }
        if (activeFilters.ratingMin > 0 || activeFilters.ratingMax < 10) {
            params.append('vote_average.gte', activeFilters.ratingMin);
            params.append('vote_average.lte', activeFilters.ratingMax);
        }
        if (activeFilters.votesMin > 0 || activeFilters.votesMax < 10000) {
            params.append('vote_count.gte', activeFilters.votesMin);
            params.append('vote_count.lte', activeFilters.votesMax);
        }
        if (activeFilters.hideAvailable) params.append('hide_available', 'true');
        return params.toString();
    }

    function setupEventListeners() {
        var backdrop = el('media-hunt-filter-backdrop');
        var closeBtn = el('media-hunt-filter-close');
        if (backdrop) backdrop.addEventListener('click', closeFiltersModal);
        if (closeBtn) closeBtn.addEventListener('click', closeFiltersModal);

        var hideAvailable = el('media-hunt-hide-available-movies');
        if (hideAvailable) {
            hideAvailable.addEventListener('change', function(e) {
                activeFilters.hideAvailable = e.target.checked;
                updateModalFilterCount();
                autoApplyFilters();
            });
        }

        var genreInput = el('media-hunt-genre-search-input');
        var genreDropdown = el('media-hunt-genre-dropdown');
        if (genreInput && genreDropdown) {
            genreInput.addEventListener('click', function(e) {
                e.stopPropagation();
                genreDropdown.style.display = genreDropdown.style.display === 'block' ? 'none' : 'block';
            });
            document.addEventListener('click', function(e) {
                if (!genreDropdown.contains(e.target) && e.target !== genreInput) genreDropdown.style.display = 'none';
            });
            genreDropdown.addEventListener('click', function(e) { e.stopPropagation(); });
        }

        function bindRange(type, updateDisplayFn) {
            var minInput = el('media-hunt-filter-' + type + '-min');
            var maxInput = el('media-hunt-filter-' + type + '-max');
            if (!minInput || !maxInput) return;
            minInput.addEventListener('input', function() {
                if (parseFloat(minInput.value) > parseFloat(maxInput.value)) minInput.value = maxInput.value;
                updateDisplayFn();
                updateModalFilterCount();
            });
            minInput.addEventListener('change', autoApplyFilters);
            maxInput.addEventListener('input', function() {
                if (parseFloat(maxInput.value) < parseFloat(minInput.value)) maxInput.value = minInput.value;
                updateDisplayFn();
                updateModalFilterCount();
            });
            maxInput.addEventListener('change', autoApplyFilters);
            updateSliderRange(type, minInput, maxInput);
        }
        bindRange('year', updateYearDisplay);
        bindRange('runtime', updateRuntimeDisplay);
        bindRange('rating', updateRatingDisplay);
        bindRange('votes', updateVotesDisplay);

        var yearMin = el('media-hunt-filter-year-min');
        var yearMax = el('media-hunt-filter-year-max');
        if (yearMin && yearMax) {
            yearMin.max = maxYear;
            yearMin.value = minYear;
            yearMax.max = maxYear;
            yearMax.value = maxYear;
            updateYearDisplay();
            updateSliderRange('year', yearMin, yearMax);
        }
    }

    function init() {
        if (inited) return;
        inited = true;
        loadGenres().then(function() {
            setupEventListeners();
            updateFilterDisplay();
        });
    }

    window.MovieHuntFilters = window.MediaHuntFilters = {
        init: init,
        openFiltersModal: openFiltersModal,
        closeFiltersModal: closeFiltersModal,
        getFilterParams: getFilterParams,
        updateFilterDisplay: updateFilterDisplay,
        clearFilters: clearFilters
    };
})();


/* === modules/features/media-hunt-activity.js === */
/**
 * Media Hunt Activity – Part 1: Movie Hunt (Queue, History, Blocklist, Logs).
 * Exposes window.ActivityModule. Uses activity-* DOM IDs and /api/activity/.
 */
(function() {
    'use strict';

    var currentView = 'queue';
    var currentPage = 1;
    var totalPages = 1;
    var pageSize = 20;
    var searchQuery = '';
    var isLoading = false;
    // Movie Hunt Logs (independent of main Huntarr logs)
    var logPage = 1;
    var logTotalPages = 1;
    var logTotalLogs = 0;
    var logPageSize = 20;
    var logLevel = 'info';
    var logSearch = '';

    function el(id) { return document.getElementById(id); }

    function getInstanceId() {
        var select = el('activity-combined-instance-select');
        if (!select || !select.value) return null;
        var val = (select.value || '').trim();
        if (val.indexOf('movie:') !== 0) return null;
        var n = parseInt(val.split(':')[1], 10);
        return isNaN(n) ? null : n;
    }

    function showLoading(show) {
        var loading = el('activityLoading');
        if (loading) loading.style.display = show ? 'block' : 'none';
    }

    function showEmptyState(show, title, message) {
        var empty = el('activityEmptyState');
        var titleEl = el('activityEmptyTitle');
        var msgEl = el('activityEmptyMessage');
        if (empty) empty.style.display = show ? 'block' : 'none';
        if (titleEl && title) titleEl.textContent = title;
        if (msgEl && message) msgEl.textContent = message;
    }

    function hideAllViews() {
        ['activity-queue-view', 'activity-history-view', 'activity-blocklist-view', 'activity-logs-view'].forEach(function(id) {
            var v = el(id);
            if (v) v.style.display = 'none';
        });
    }

    function switchView(view) {
        currentView = view;
        hideAllViews();
        var viewId = 'activity-' + view + '-view';
        var viewEl = el(viewId);
        if (viewEl) viewEl.style.display = 'block';
        var removeBtn = el('activityRemoveSelectedButton');
        if (removeBtn) removeBtn.style.display = view === 'queue' ? '' : 'none';
        var toolbar = document.getElementById('activityQueueToolbar');
        if (toolbar) toolbar.style.display = view === 'logs' ? 'none' : 'flex';
        var headerLabel = el('activityCurrentViewLabel');
        if (headerLabel) {
            var labels = { queue: 'Queue', history: 'History', blocklist: 'Blocklist', logs: 'Logs' };
            headerLabel.textContent = labels[view] || view;
        }
        currentPage = 1;
        if (view === 'logs') {
            logPage = 1;
            showEmptyState(false);
            loadMovieHuntLogs();
        } else {
            loadData();
        }
    }

    function loadMovieHuntLogs() {
        var container = el('activityLogsContainer');
        if (!container) return;
        var params = new URLSearchParams({
            limit: String(logPageSize),
            offset: String((logPage - 1) * logPageSize)
        });
        if (logLevel && logLevel !== 'all') params.append('level', logLevel.toUpperCase());
        if (logSearch) params.append('search', logSearch);
        var statusEl = el('activityLogConnectionStatus');
        if (statusEl) { statusEl.textContent = 'Loading...'; statusEl.className = 'status-disconnected'; }
        container.innerHTML = '';
        fetch('./api/logs/movie_hunt?' + params.toString(), { cache: 'no-store' })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (statusEl) {
                    statusEl.textContent = data.success ? 'Connected' : (data.error || 'Error');
                    statusEl.className = data.success ? 'status-connected' : 'status-error';
                }
                if (!data.success || !data.logs) {
                    if (statusEl && !data.success) statusEl.className = 'status-error';
                    return;
                }
                logTotalLogs = data.total != null ? data.total : 0;
                logTotalPages = Math.max(1, Math.ceil(logTotalLogs / logPageSize));
                var curEl = el('activityLogCurrentPage');
                var totalEl = el('activityLogTotalPages');
                if (curEl) curEl.textContent = logPage;
                if (totalEl) totalEl.textContent = logTotalPages;
                var prevBtn = el('activityLogPrevPage');
                var nextBtn = el('activityLogNextPage');
                if (prevBtn) prevBtn.disabled = logPage <= 1;
                if (nextBtn) nextBtn.disabled = logPage >= logTotalPages;
                var logRegex = /^([^|]+)\|([^|]+)\|([^|]+)\|(.*)$/;
                data.logs.forEach(function(line) {
                    var m = line.match(logRegex);
                    if (!m) return;
                    var timestamp = m[1].trim();
                    var level = (m[2] || 'INFO').toLowerCase();
                    var appType = (m[3] || 'movie_hunt').toUpperCase();
                    var message = (m[4] || '').trim().replace(/^\s*-\s*/, '');
                    var levelClass = level === 'error' ? 'log-level-error' : level === 'warning' || level === 'warn' ? 'log-level-warning' : level === 'debug' ? 'log-level-debug' : 'log-level-info';
                    var levelLabel = level === 'error' ? 'Error' : level === 'warning' || level === 'warn' ? 'Warning' : level === 'debug' ? 'Debug' : 'Info';
                    var row = document.createElement('tr');
                    row.className = 'log-table-row';
                    row.innerHTML = '<td class="col-time">' + escapeHtml(timestamp) + '</td><td class="col-level"><span class="log-level-badge ' + levelClass + '">' + escapeHtml(levelLabel) + '</span></td><td class="col-app">' + escapeHtml(appType) + '</td><td class="col-message">' + escapeHtml(message) + '</td>';
                    container.appendChild(row);
                });
                showEmptyState(data.logs.length === 0, 'No log entries', 'Log entries will appear here when available.');
            })
            .catch(function() {
                if (statusEl) { statusEl.textContent = 'Connection error'; statusEl.className = 'status-error'; }
            });
    }

    function clearMovieHuntLogs() {
        var doClear = function() {
            fetch('./api/logs/movie_hunt/clear', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (data.success) {
                    logPage = 1;
                    logTotalLogs = 0;
                    logTotalPages = 1;
                    loadMovieHuntLogs();
                    if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Movie Hunt logs cleared.', 'success');
                } else if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification(data.error || 'Failed to clear logs', 'error');
            })
            .catch(function() {
                if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Connection error', 'error');
            });
        };
        if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
            window.HuntarrConfirm.show({ title: 'Clear Movie Hunt Logs', message: 'Clear all Movie Hunt logs? This cannot be undone.', confirmLabel: 'Clear', onConfirm: doClear });
        } else {
            if (!window.confirm('Clear all Movie Hunt logs? This cannot be undone.')) return;
            doClear();
        }
    }

    function loadData() {
        if (isLoading) return;
        var instanceId = getInstanceId();
        if (instanceId == null) {
            showEmptyState(true, 'Select an instance', 'Choose a Movie Hunt or TV Hunt instance to view queue, history, or blocklist.');
            return;
        }
        isLoading = true;
        showLoading(true);
        showEmptyState(false);

        var params = new URLSearchParams({ page: currentPage, page_size: pageSize, instance_id: String(instanceId) });
        if (searchQuery) params.append('search', searchQuery);
        params.append('_t', Date.now()); // cache-bust so refresh always gets fresh stats

        var url = './api/activity/' + currentView + '?' + params.toString();
        fetch(url, { cache: 'no-store' })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var items = data.items || [];
                var total = data.total != null ? data.total : 0;
                totalPages = data.total_pages != null ? data.total_pages : (total ? Math.ceil(total / pageSize) : 1);
                if (totalPages < 1) totalPages = 1;
                currentPage = data.page != null ? data.page : 1;

                var currentPageEl = el('activityCurrentPage');
                var totalPagesEl = el('activityTotalPages');
                if (currentPageEl) currentPageEl.textContent = currentPage;
                if (totalPagesEl) totalPagesEl.textContent = totalPages;

                var prevBtn = el('activityPrevPage');
                var nextBtn = el('activityNextPage');
                if (prevBtn) prevBtn.disabled = currentPage <= 1;
                if (nextBtn) nextBtn.disabled = currentPage >= totalPages;

                var tbodyId = 'activity' + currentView.charAt(0).toUpperCase() + currentView.slice(1) + 'TableBody';
                var tbody = el(tbodyId);
                if (tbody) {
                    tbody.innerHTML = '';
                    if (items.length === 0) {
                        showEmptyState(true, 'No items found', 'Items will appear here when available.');
                    } else {
                        items.forEach(function(item) {
                            var row = createRow(item);
                            if (row) tbody.appendChild(row);
                        });
                    }
                }
                var selectAllCb = el('activityQueueSelectAll');
                if (selectAllCb) selectAllCb.checked = false;
            })
            .catch(function() {
                showEmptyState(true, 'Unable to load', 'Check connection and try again.');
            })
            .finally(function() {
                isLoading = false;
                showLoading(false);
            });
    }

    function escapeAttr(s) {
        if (s == null) return '';
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function formatScoringCell(scoring) {
        if (scoring == null || scoring === '') return escapeHtml('-');
        var s = String(scoring).trim();
        if (s === '') return escapeHtml('-');
        var paren = s.indexOf(' (');
        if (paren > 0) {
            var main = s.substring(0, paren).trim();
            var breakdown = s.substring(paren + 2).replace(/\)\s*$/, '').trim();
            return '<span class="activity-scoring-value" title="' + escapeAttr(breakdown) + '">' + escapeHtml(main) + '</span>';
        }
        return escapeHtml(s);
    }

    function createRow(item) {
        var tr = document.createElement('tr');
        if (currentView === 'queue') {
            var canSelect = item.id != null && item.id !== '';
            var cb = canSelect
                ? '<td class="col-select"><input type="checkbox" class="activity-queue-row-cb" data-id="' + escapeHtml(String(item.id)) + '" data-instance="' + escapeHtml(item.instance_name || 'Default') + '"></td>'
                : '<td class="col-select"></td>';
            var originalRelease = item.original_release || item.movie || '';
            var tooltip = originalRelease ? ('Original release: ' + escapeAttr(originalRelease)) : '';
            var movieText = escapeHtml(item.movie || item.title || '-');
            var movieCell = tooltip
                ? '<td class="col-movie"><span class="activity-queue-movie-title" title="' + tooltip + '">' + movieText + '</span></td>'
                : '<td class="col-movie">' + movieText + '</td>';
            tr.innerHTML = cb +
                movieCell +
                '<td class="col-languages">' + escapeHtml(item.languages || '-') + '</td>' +
                '<td class="col-quality">' + escapeHtml(item.quality || '-') + '</td>' +
                '<td class="col-formats">' + escapeHtml(item.formats || '-') + '</td>' +
                '<td class="col-scoring">' + formatScoringCell(item.scoring) + '</td>' +
                '<td class="col-time-left">' + escapeHtml(item.time_left != null ? item.time_left : '-') + '</td>' +
                '<td class="col-progress">' + escapeHtml((item.progress === '100%' ? 'Pending Import' : (item.progress != null ? item.progress : '-'))) + '</td>';
        } else if (currentView === 'history') {
            tr.innerHTML = '<td class="col-movie">' + escapeHtml(item.movie || item.title || '-') + '</td>' +
                '<td class="col-languages">' + escapeHtml(item.languages || '-') + '</td>' +
                '<td class="col-quality">' + escapeHtml(item.quality || '-') + '</td>' +
                '<td class="col-formats">' + escapeHtml(item.formats || '-') + '</td>' +
                '<td class="col-date">' + escapeHtml(item.date || '-') + '</td>';
        } else if (currentView === 'blocklist') {
            var movieText = escapeHtml(item.movie || item.movie_title || '-');
            var sourceTitle = (item.source_title || '').trim() || '-';
            var reasonFailed = (item.reason_failed || '').trim() || 'Download failed';
            var dateText = escapeHtml(item.date || '-');
            var sourceTitleEsc = escapeAttr(sourceTitle);
            var reasonEsc = escapeAttr(reasonFailed);
            tr.innerHTML =
                '<td class="col-movie">' + movieText + '</td>' +
                '<td class="col-source">' + escapeHtml(sourceTitle) + '</td>' +
                '<td class="col-reason">' + escapeHtml(reasonFailed) + '</td>' +
                '<td class="col-date">' + dateText + '</td>' +
                '<td class="col-actions">' +
                '<button type="button" class="activity-blocklist-btn-info" title="Details" data-source-title="' + sourceTitleEsc + '" data-reason="' + reasonEsc + '" data-date="' + escapeAttr(item.date || '') + '" data-movie="' + escapeAttr(item.movie || '') + '" aria-label="Details"><i class="fas fa-info-circle"></i></button>' +
                '<button type="button" class="activity-blocklist-btn-remove" title="Remove from blocklist" data-source-title="' + sourceTitleEsc + '" aria-label="Remove from blocklist"><i class="fas fa-times" style="color: #ef4444;"></i></button>' +
                '</td>';
            var infoBtn = tr.querySelector('.activity-blocklist-btn-info');
            var removeBtn = tr.querySelector('.activity-blocklist-btn-remove');
            if (infoBtn) infoBtn.addEventListener('click', function() { showBlocklistDetailsModal(this); });
            if (removeBtn) removeBtn.addEventListener('click', function() { removeBlocklistEntry(this.getAttribute('data-source-title')); });
        } else {
            tr.innerHTML = '<td class="col-movie">' + escapeHtml(item.movie || item.title || '-') + '</td>' +
                '<td class="col-source">' + escapeHtml(item.source_title || '-') + '</td>' +
                '<td class="col-languages">' + escapeHtml(item.languages || '-') + '</td>' +
                '<td class="col-quality">' + escapeHtml(item.quality || '-') + '</td>' +
                '<td class="col-formats">' + escapeHtml(item.formats || '-') + '</td>' +
                '<td class="col-date">' + escapeHtml(item.date || '-') + '</td>';
        }
        return tr;
    }

    function escapeHtml(s) {
        if (s == null) return '';
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function showBlocklistDetailsModal(btn) {
        var modal = el('activityBlocklistDetailsModal');
        if (!modal) return;
        var nameEl = el('activityBlocklistModalName');
        var reasonEl = el('activityBlocklistModalReason');
        var dateEl = el('activityBlocklistModalDate');
        if (nameEl) nameEl.textContent = (btn.getAttribute('data-source-title') || '').trim() || '-';
        if (reasonEl) reasonEl.textContent = (btn.getAttribute('data-reason') || '').trim() || 'Download failed';
        if (dateEl) dateEl.textContent = (btn.getAttribute('data-date') || '').trim() || '-';
        modal.style.display = 'flex';
    }

    function closeBlocklistDetailsModal() {
        var modal = el('activityBlocklistDetailsModal');
        if (modal) modal.style.display = 'none';
    }

    function removeBlocklistEntry(sourceTitle) {
        if (!sourceTitle || !sourceTitle.trim()) return;
        var instanceId = getInstanceId();
        if (instanceId == null) {
            if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Select an instance first.', 'warning');
            return;
        }
        var msg = 'Remove this release from the blocklist? It may be selected again when requesting.';
        var doRemove = function() {
            fetch('./api/activity/blocklist', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ source_title: sourceTitle, instance_id: instanceId })
            })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.success !== false) {
                        loadData();
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification('Removed from blocklist.', 'success');
                        }
                    } else if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification(data.error || 'Failed to remove.', 'error');
                    }
                })
                .catch(function() {
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification('Failed to remove from blocklist.', 'error');
                    }
                });
        };
        if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
            window.HuntarrConfirm.show({ title: 'Remove from Blocklist', message: msg, confirmLabel: 'Remove', onConfirm: doRemove });
        } else {
            if (!window.confirm(msg)) return;
            doRemove();
        }
    }

    function performSearch() {
        var input = el('activitySearchInput');
        searchQuery = input ? input.value.trim() : '';
        currentPage = 1;
        loadData();
    }

    function refreshData() {
        currentPage = 1;
        loadData();
        if (window.huntarrUI && window.huntarrUI.showNotification) {
            window.huntarrUI.showNotification('Data refreshed.', 'success');
        }
    }

    function removeSelected() {
        var checkboxes = document.querySelectorAll('#activityQueueTableBody .activity-queue-row-cb:checked');
        if (!checkboxes || checkboxes.length === 0) {
            if (window.huntarrUI && window.huntarrUI.showNotification) {
                window.huntarrUI.showNotification('No items selected.', 'warning');
            }
            return;
        }
        var instanceId = getInstanceId();
        if (instanceId == null) {
            if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Select an instance first.', 'warning');
            return;
        }
        var items = [];
        for (var i = 0; i < checkboxes.length; i++) {
            var cb = checkboxes[i];
            items.push({ id: cb.getAttribute('data-id'), instance_name: cb.getAttribute('data-instance') || 'Default' });
        }
        fetch('./api/activity/queue', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: items, instance_id: instanceId })
        })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (data.success !== false) {
                    loadData();
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification('Selected items removed from queue.', 'success');
                    }
                } else if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification(data.error || 'Failed to remove.', 'error');
                }
            })
            .catch(function() {
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('Failed to remove selected.', 'error');
                }
            });
    }

    function init(view) {
        currentView = view || 'queue';
        currentPage = 1;
        totalPages = 1;
        searchQuery = '';
        var input = el('activitySearchInput');
        if (input) input.value = '';
        var pageSizeEl = el('activityPageSize');
        if (pageSizeEl) pageSize = parseInt(pageSizeEl.value, 10) || 20;

        var queueNav = el('movieHuntActivityQueueNav');
        var historyNav = el('movieHuntActivityHistoryNav');
        var blocklistNav = el('movieHuntActivityBlocklistNav');
        var logsNav = el('movieHuntActivityLogsNav');
        if (queueNav) queueNav.classList.toggle('active', currentView === 'queue');
        if (historyNav) historyNav.classList.toggle('active', currentView === 'history');
        if (blocklistNav) blocklistNav.classList.toggle('active', currentView === 'blocklist');
        if (logsNav) logsNav.classList.toggle('active', currentView === 'logs');

        switchView(currentView);

        if (window.MediaHuntActivityInstanceDropdown && window.MediaHuntActivityInstanceDropdown.attach) {
            var activitySelect = el('activity-combined-instance-select');
            if (activitySelect) {
                window.MediaHuntActivityInstanceDropdown.attach('activity-combined-instance-select', function() {
                    currentPage = 1;
                    loadData();
                }, 'movie');
            }
        }

        var searchBtn = el('activitySearchButton');
        if (searchBtn) searchBtn.onclick = performSearch;
        if (input) input.onkeypress = function(e) { if (e.key === 'Enter') performSearch(); };
        var refreshBtn = el('activityRefreshButton');
        if (refreshBtn) refreshBtn.onclick = refreshData;
        var removeSelectedBtn = el('activityRemoveSelectedButton');
        if (removeSelectedBtn) {
            removeSelectedBtn.onclick = removeSelected;
            removeSelectedBtn.style.display = currentView === 'queue' ? '' : 'none';
        }
        var selectAllCb = el('activityQueueSelectAll');
        if (selectAllCb) {
            selectAllCb.checked = false;
            selectAllCb.onclick = function() {
                var rowCbs = document.querySelectorAll('#activityQueueTableBody .activity-queue-row-cb');
                for (var i = 0; i < rowCbs.length; i++) rowCbs[i].checked = selectAllCb.checked;
            };
        }
        var blocklistModal = el('activityBlocklistDetailsModal');
        if (blocklistModal) {
            var closeBtns = blocklistModal.querySelectorAll('.activity-blocklist-modal-close, .activity-blocklist-modal-close-btn');
            for (var i = 0; i < closeBtns.length; i++) closeBtns[i].addEventListener('click', closeBlocklistDetailsModal);
            blocklistModal.addEventListener('click', function(e) { if (e.target === blocklistModal) closeBlocklistDetailsModal(); });
        }
        var prevBtn = el('activityPrevPage');
        var nextBtn = el('activityNextPage');
        if (prevBtn) prevBtn.onclick = function() { if (currentPage > 1) { currentPage--; loadData(); } };
        if (nextBtn) nextBtn.onclick = function() { if (currentPage < totalPages) { currentPage++; loadData(); } };
        if (pageSizeEl) pageSizeEl.onchange = function() { pageSize = parseInt(pageSizeEl.value, 10); currentPage = 1; loadData(); };

        // Movie Hunt Logs view bindings
        var logLevelSelect = el('activityLogLevelSelect');
        var logSearchInput = el('activityLogSearchInput');
        var logSearchBtn = el('activityLogSearchButton');
        var logClearBtn = el('activityLogClearButton');
        var logPrevBtn = el('activityLogPrevPage');
        var logNextBtn = el('activityLogNextPage');
        var logPageSizeEl = el('activityLogPageSize');
        if (logLevelSelect) {
            logLevel = logLevelSelect.value || 'info';
            logLevelSelect.onchange = function() { logLevel = logLevelSelect.value; logPage = 1; loadMovieHuntLogs(); };
        }
        if (logSearchInput) logSearchInput.value = logSearch;
        if (logSearchBtn) logSearchBtn.onclick = function() { logSearch = (logSearchInput && logSearchInput.value) ? logSearchInput.value.trim() : ''; logPage = 1; loadMovieHuntLogs(); };
        if (logSearchInput) logSearchInput.onkeypress = function(e) { if (e.key === 'Enter') { logSearch = logSearchInput.value.trim(); logPage = 1; loadMovieHuntLogs(); } };
        if (logClearBtn) logClearBtn.onclick = clearMovieHuntLogs;
        if (logPrevBtn) logPrevBtn.onclick = function() { if (logPage > 1) { logPage--; loadMovieHuntLogs(); } };
        if (logNextBtn) logNextBtn.onclick = function() { if (logPage < logTotalPages) { logPage++; loadMovieHuntLogs(); } };
        if (logPageSizeEl) {
            logPageSize = parseInt(logPageSizeEl.value, 10) || 20;
            logPageSizeEl.onchange = function() { logPageSize = parseInt(logPageSizeEl.value, 10) || 20; logPage = 1; loadMovieHuntLogs(); };
        }
    }

    function refresh() {
        if (currentView === 'logs') {
            loadMovieHuntLogs();
        } else {
            loadData();
        }
    }

    window.ActivityModule = {
        init: init,
        switchView: switchView,
        refresh: refresh
    };
})();

/**
 * Media Hunt Activity – Part 2: TV Hunt (Queue, History, Blocklist).
 * Exposes window.TVHuntActivityModule. Uses tvHuntActivity* DOM IDs and /api/tv-hunt/.
 */
(function() {
    'use strict';

    var currentView = 'queue';
    var currentPage = 1;
    var totalPages = 1;
    var pageSize = 20;
    var searchQuery = '';
    var isLoading = false;

    function el(id) { return document.getElementById(id); }

    function getInstanceId() {
        var select = el('tv-activity-combined-instance-select');
        if (!select || !select.value) return null;
        var val = (select.value || '').trim();
        if (val.indexOf('tv:') !== 0) return null;
        var n = parseInt(val.split(':')[1], 10);
        return isNaN(n) ? null : n;
    }

    function showLoading(show) {
        var loading = el('tvHuntActivityLoading');
        if (loading) loading.style.display = show ? 'block' : 'none';
    }

    function showEmptyState(show, title, message) {
        var empty = el('tvHuntActivityEmptyState');
        var titleEl = el('tvHuntActivityEmptyTitle');
        var msgEl = el('tvHuntActivityEmptyMessage');
        if (empty) empty.style.display = show ? 'block' : 'none';
        if (titleEl && title) titleEl.textContent = title;
        if (msgEl && message) msgEl.textContent = message;
    }

    function hideAllViews() {
        ['tvHuntActivityQueueView', 'tvHuntActivityHistoryView', 'tvHuntActivityBlocklistView'].forEach(function(id) {
            var v = el(id);
            if (v) v.style.display = 'none';
        });
    }

    function switchView(view) {
        currentView = view;
        hideAllViews();
        var viewId = 'tvHuntActivity' + view.charAt(0).toUpperCase() + view.slice(1) + 'View';
        var viewEl = el(viewId);
        if (viewEl) viewEl.style.display = 'block';
        var removeBtn = el('tvHuntActivityRemoveSelectedButton');
        if (removeBtn) removeBtn.style.display = view === 'queue' ? '' : 'none';
        var toolbar = el('tvHuntActivityQueueToolbar');
        if (toolbar) toolbar.style.display = 'flex';
        currentPage = 1;
        loadData();
    }

    function escapeAttr(s) {
        if (s == null) return '';
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function escapeHtml(s) {
        if (s == null) return '';
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function loadData() {
        if (isLoading) return;
        var instanceId = getInstanceId();
        if (instanceId == null) {
            showEmptyState(true, 'Select an instance', 'Choose a Movie Hunt or TV Hunt instance to view queue, history, or blocklist.');
            return;
        }
        isLoading = true;
        showLoading(true);
        showEmptyState(false);

        var params = new URLSearchParams({ instance_id: String(instanceId) });
        if (searchQuery) params.append('search', searchQuery);
        params.append('_t', Date.now());

        var endpoint = currentView === 'queue' ? 'queue' : currentView === 'history' ? 'history' : 'blocklist';
        var url = './api/tv-hunt/' + endpoint + '?' + params.toString();

        fetch(url, { cache: 'no-store' })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var items = [];
                var total = 0;
                if (currentView === 'queue') {
                    items = data.queue || [];
                    total = items.length;
                } else if (currentView === 'history') {
                    items = data.history || [];
                    total = items.length;
                } else {
                    items = data.items || [];
                    total = items.length;
                }

                if (searchQuery) {
                    var q = searchQuery.toLowerCase();
                    items = items.filter(function(item) {
                        var title = (item.show || item.series || item.movie || item.title || item.source_title || '').toString().toLowerCase();
                        return title.indexOf(q) >= 0;
                    });
                    total = items.length;
                }

                totalPages = pageSize > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1;
                var start = (currentPage - 1) * pageSize;
                var paged = items.slice(start, start + pageSize);

                var currentPageEl = el('tvHuntActivityCurrentPage');
                var totalPagesEl = el('tvHuntActivityTotalPages');
                if (currentPageEl) currentPageEl.textContent = currentPage;
                if (totalPagesEl) totalPagesEl.textContent = totalPages;

                var prevBtn = el('tvHuntActivityPrevPage');
                var nextBtn = el('tvHuntActivityNextPage');
                if (prevBtn) prevBtn.disabled = currentPage <= 1;
                if (nextBtn) nextBtn.disabled = currentPage >= totalPages;

                var tbodyId = 'tvHuntActivity' + (currentView === 'queue' ? 'Queue' : currentView === 'history' ? 'History' : 'Blocklist') + 'TableBody';
                var tbody = el(tbodyId);
                if (tbody) {
                    tbody.innerHTML = '';
                    if (paged.length === 0) {
                        showEmptyState(true, 'No items found', 'Items will appear here when available.');
                    } else {
                        paged.forEach(function(item) {
                            var row = createRow(item);
                            if (row) tbody.appendChild(row);
                        });
                    }
                }
                var selectAllCb = el('tvHuntActivityQueueSelectAll');
                if (selectAllCb) selectAllCb.checked = false;
            })
            .catch(function() {
                showEmptyState(true, 'Unable to load', 'Check connection and try again.');
            })
            .finally(function() {
                isLoading = false;
                showLoading(false);
            });
    }

    function createRow(item) {
        var tr = document.createElement('tr');
        if (currentView === 'queue') {
            var canSelect = item.id != null && item.id !== '';
            var cb = canSelect
                ? '<td class="col-select"><input type="checkbox" class="tv-hunt-activity-queue-row-cb" data-id="' + escapeHtml(String(item.id)) + '"></td>'
                : '<td class="col-select"></td>';
            var showText = escapeHtml(item.show || item.series || item.title || '-');
            tr.innerHTML = cb +
                '<td class="col-show">' + showText + '</td>' +
                '<td class="col-languages">' + escapeHtml(item.languages || '-') + '</td>' +
                '<td class="col-quality">' + escapeHtml(item.quality || '-') + '</td>' +
                '<td class="col-formats">' + escapeHtml(item.formats || '-') + '</td>' +
                '<td class="col-scoring">' + escapeHtml(item.scoring != null ? item.scoring : '-') + '</td>' +
                '<td class="col-time-left">' + escapeHtml(item.time_left != null ? item.time_left : '-') + '</td>' +
                '<td class="col-progress">' + escapeHtml(item.progress != null ? item.progress : '-') + '</td>';
        } else if (currentView === 'history') {
            tr.innerHTML = '<td class="col-show">' + escapeHtml(item.show || item.series || item.title || '-') + '</td>' +
                '<td class="col-languages">' + escapeHtml(item.languages || '-') + '</td>' +
                '<td class="col-quality">' + escapeHtml(item.quality || '-') + '</td>' +
                '<td class="col-formats">' + escapeHtml(item.formats || '-') + '</td>' +
                '<td class="col-date">' + escapeHtml(item.date || item.added_at || '-') + '</td>';
        } else {
            var id = (item.id || '').toString();
            var sourceTitle = (item.source_title || '').trim() || '-';
            var dateText = escapeHtml(item.added_at || item.date || '-');
            var sourceTitleEsc = escapeAttr(sourceTitle);
            tr.innerHTML =
                '<td class="col-source">' + escapeHtml(sourceTitle) + '</td>' +
                '<td class="col-date">' + dateText + '</td>' +
                '<td class="col-actions">' +
                '<button type="button" class="tv-hunt-activity-blocklist-btn-info" title="Details" data-source-title="' + sourceTitleEsc + '" data-date="' + escapeAttr(item.added_at || '') + '" aria-label="Details"><i class="fas fa-info-circle"></i></button>' +
                '<button type="button" class="tv-hunt-activity-blocklist-btn-remove" title="Remove from blocklist" data-id="' + escapeAttr(id) + '" aria-label="Remove from blocklist"><i class="fas fa-times" style="color: #ef4444;"></i></button>' +
                '</td>';
            var infoBtn = tr.querySelector('.tv-hunt-activity-blocklist-btn-info');
            var removeBtn = tr.querySelector('.tv-hunt-activity-blocklist-btn-remove');
            if (infoBtn) infoBtn.addEventListener('click', function() { showBlocklistDetailsModal(this); });
            if (removeBtn) removeBtn.addEventListener('click', function() { removeBlocklistEntry(this.getAttribute('data-id')); });
        }
        return tr;
    }

    function showBlocklistDetailsModal(btn) {
        var modal = el('tvHuntActivityBlocklistDetailsModal');
        if (!modal) return;
        var titleEl = el('tvHuntActivityBlocklistModalSourceTitle');
        var dateEl = el('tvHuntActivityBlocklistModalDate');
        if (titleEl) titleEl.textContent = (btn.getAttribute('data-source-title') || '').trim() || '-';
        if (dateEl) dateEl.textContent = (btn.getAttribute('data-date') || '').trim() || '-';
        modal.style.display = 'flex';
    }

    function closeBlocklistDetailsModal() {
        var modal = el('tvHuntActivityBlocklistDetailsModal');
        if (modal) modal.style.display = 'none';
    }

    function removeBlocklistEntry(itemId) {
        if (!itemId || !itemId.trim()) return;
        var instanceId = getInstanceId();
        if (instanceId == null) {
            if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Select an instance first.', 'warning');
            return;
        }
        var msg = 'Remove this from the TV Hunt blocklist?';
        var doRemove = function() {
            var params = new URLSearchParams({ instance_id: String(instanceId) });
            fetch('./api/tv-hunt/blocklist/' + encodeURIComponent(itemId) + '?' + params.toString(), { method: 'DELETE' })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.success !== false) {
                        loadData();
                        if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Removed from blocklist.', 'success');
                    } else if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification(data.error || 'Failed to remove.', 'error');
                    }
                })
                .catch(function() {
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification('Failed to remove from blocklist.', 'error');
                    }
                });
        };
        if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
            window.HuntarrConfirm.show({ title: 'Remove from Blocklist', message: msg, confirmLabel: 'Remove', onConfirm: doRemove });
        } else {
            if (!window.confirm(msg)) return;
            doRemove();
        }
    }

    function performSearch() {
        var input = el('tvHuntActivitySearchInput');
        searchQuery = input ? input.value.trim() : '';
        currentPage = 1;
        loadData();
    }

    function refreshData() {
        currentPage = 1;
        loadData();
        if (window.huntarrUI && window.huntarrUI.showNotification) {
            window.huntarrUI.showNotification('Data refreshed.', 'success');
        }
    }

    function removeSelected() {
        var checkboxes = document.querySelectorAll('#tvHuntActivityQueueTableBody .tv-hunt-activity-queue-row-cb:checked');
        if (!checkboxes || checkboxes.length === 0) {
            if (window.huntarrUI && window.huntarrUI.showNotification) {
                window.huntarrUI.showNotification('No items selected.', 'warning');
            }
            return;
        }
        if (window.huntarrUI && window.huntarrUI.showNotification) {
            window.huntarrUI.showNotification('Bulk remove from queue is not yet implemented for TV Hunt.', 'info');
        }
    }

    function init(view) {
        currentView = view || 'queue';
        currentPage = 1;
        totalPages = 1;
        searchQuery = '';
        var input = el('tvHuntActivitySearchInput');
        if (input) input.value = '';
        var pageSizeEl = el('tvHuntActivityPageSize');
        if (pageSizeEl) pageSize = parseInt(pageSizeEl.value, 10) || 20;

        var queueNav = el('tvHuntActivityQueueNav');
        var historyNav = el('tvHuntActivityHistoryNav');
        var blocklistNav = el('tvHuntActivityBlocklistNav');
        if (queueNav) queueNav.classList.toggle('active', currentView === 'queue');
        if (historyNav) historyNav.classList.toggle('active', currentView === 'history');
        if (blocklistNav) blocklistNav.classList.toggle('active', currentView === 'blocklist');

        switchView(currentView);

        if (window.MediaHuntActivityInstanceDropdown && window.MediaHuntActivityInstanceDropdown.attach) {
            var activitySelect = el('tv-activity-combined-instance-select');
            if (activitySelect) {
                window.MediaHuntActivityInstanceDropdown.attach('tv-activity-combined-instance-select', function() {
                    currentPage = 1;
                    loadData();
                }, 'tv');
            }
        }

        var searchBtn = el('tvHuntActivitySearchButton');
        if (searchBtn) searchBtn.onclick = performSearch;
        if (input) input.onkeypress = function(e) { if (e.key === 'Enter') performSearch(); };
        var refreshBtn = el('tvHuntActivityRefreshButton');
        if (refreshBtn) refreshBtn.onclick = refreshData;
        var removeSelectedBtn = el('tvHuntActivityRemoveSelectedButton');
        if (removeSelectedBtn) {
            removeSelectedBtn.onclick = removeSelected;
            removeSelectedBtn.style.display = currentView === 'queue' ? '' : 'none';
        }
        var selectAllCb = el('tvHuntActivityQueueSelectAll');
        if (selectAllCb) {
            selectAllCb.checked = false;
            selectAllCb.onclick = function() {
                var rowCbs = document.querySelectorAll('#tvHuntActivityQueueTableBody .tv-hunt-activity-queue-row-cb');
                for (var i = 0; i < rowCbs.length; i++) rowCbs[i].checked = selectAllCb.checked;
            };
        }
        var blocklistModal = el('tvHuntActivityBlocklistDetailsModal');
        if (blocklistModal) {
            var closeBtns = blocklistModal.querySelectorAll('.tv-hunt-activity-blocklist-modal-close, .activity-blocklist-modal-close-btn');
            for (var i = 0; i < closeBtns.length; i++) closeBtns[i].addEventListener('click', closeBlocklistDetailsModal);
            blocklistModal.addEventListener('click', function(e) { if (e.target === blocklistModal) closeBlocklistDetailsModal(); });
        }
        var prevBtn = el('tvHuntActivityPrevPage');
        var nextBtn = el('tvHuntActivityNextPage');
        if (prevBtn) prevBtn.onclick = function() { if (currentPage > 1) { currentPage--; loadData(); } };
        if (nextBtn) nextBtn.onclick = function() { if (currentPage < totalPages) { currentPage++; loadData(); } };
        if (pageSizeEl) pageSizeEl.onchange = function() { pageSize = parseInt(pageSizeEl.value, 10); currentPage = 1; loadData(); };
    }

    window.TVHuntActivityModule = {
        init: init,
        switchView: switchView,
        refresh: function() { loadData(); }
    };
})();


/* === modules/features/media-hunt-card-delete-modal.js === */
/**
 * Media Hunt Card Delete Modal – shared delete/remove modal for movie cards.
 * Used by: requestarr-content.js, media-hunt.js, media-hunt-collection.js,
 *          requestarr-detail.js
 * Exposed as window.MovieCardDeleteModal for compatibility.
 *
 * Opens a modal with options:
 *   - Remove from Library (always, checked by default)
 *   - Delete Movie Files (only if hasFile, unchecked by default)
 *   - Add to Hidden Media (always last, unchecked by default)
 *
 * Checkbox states are persisted server-side in general_settings.
 */
(function() {
    'use strict';

    var _prefsLoaded = false;
    var _prefs = { remove_from_library: true, delete_files: false, add_to_hidden: false };

    function escapeHtml(str) {
        return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function loadPrefs() {
        if (_prefsLoaded) return Promise.resolve(_prefs);
        return fetch('./api/settings')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var general = data.general || data;
                var raw = general.movie_hunt_delete_prefs;
                if (raw) {
                    try {
                        var parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
                        if (parsed.remove_from_library !== undefined) _prefs.remove_from_library = !!parsed.remove_from_library;
                        if (parsed.delete_files !== undefined) _prefs.delete_files = !!parsed.delete_files;
                        if (parsed.add_to_hidden !== undefined) _prefs.add_to_hidden = !!parsed.add_to_hidden;
                    } catch (e) { /* use defaults */ }
                }
                _prefsLoaded = true;
                return _prefs;
            })
            .catch(function() {
                _prefsLoaded = true;
                return _prefs;
            });
    }

    function savePrefs(prefs) {
        var payload = { movie_hunt_delete_prefs: JSON.stringify(prefs) };
        fetch('./api/settings/general', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }).catch(function(e) {
            console.warn('[MovieCardDeleteModal] Failed to save prefs:', e);
        });
    }

    /**
     * Open the delete modal.
     * @param {Object} item - Movie data (title, year, tmdb_id, poster_path, status, etc.)
     * @param {Object} options
     *   - instanceName {string} - Movie Hunt instance display name
     *   - instanceId {string|number} - Instance ID for API calls
     *   - status {string} - 'available' or 'requested'
     *   - hasFile {boolean} - Whether movie files exist on disk
     *   - filePath {string} - Display path for the movie file/folder
     *   - onDeleted {function} - Callback after successful deletion
     *   - appType {string} - 'movie_hunt' or 'radarr' (default: 'movie_hunt')
     */
    function open(item, options) {
        options = options || {};
        var title = escapeHtml(item.title || 'Unknown');
        var year = item.year || '';
        var status = (options.status || item.status || 'requested').toLowerCase();
        var hasFile = !!(options.hasFile || (status === 'available'));
        var filePath = options.filePath || '';
        var folderDisplay = filePath ? escapeHtml(filePath) : escapeHtml(item.title + (year ? ' (' + year + ')' : ''));
        var appType = options.appType || 'movie_hunt';

        loadPrefs().then(function(prefs) {
            buildModal(item, options, title, status, hasFile, folderDisplay, prefs, appType);
        });
    }

    function buildModal(item, options, title, status, hasFile, folderDisplay, prefs, appType) {
        // Remove existing modal
        var existing = document.getElementById('mh-card-delete-modal');
        if (existing) existing.remove();

        var removeChecked = prefs.remove_from_library ? ' checked' : '';
        var deleteFilesChecked = prefs.delete_files ? ' checked' : '';
        var hiddenChecked = prefs.add_to_hidden ? ' checked' : '';

        var html =
            '<div class="mh-modal-backdrop" id="mh-card-delete-modal">' +
                '<div class="mh-modal">' +
                    '<div class="mh-modal-header mh-modal-header-danger">' +
                        '<h3><i class="fas fa-trash-alt"></i> Delete \u2014 ' + title + '</h3>' +
                        '<button class="mh-modal-x" id="mh-cdm-close">&times;</button>' +
                    '</div>' +
                    '<div class="mh-modal-body">' +
                        '<div class="mh-delete-path" title="' + folderDisplay + '">' +
                            '<i class="fas fa-folder"></i> <span class="mh-delete-path-text">' + folderDisplay + '</span>' +
                        '</div>' +

                        // Option 1: Remove from Library (always shown)
                        '<label class="mh-check-row">' +
                            '<input type="checkbox" id="mh-cdm-remove"' + removeChecked + '>' +
                            '<div><strong>Remove from Library</strong>' +
                            '<div class="mh-help">Remove this movie from your Movie Hunt collection</div></div>' +
                        '</label>' +

                        // Option 2: Delete Movie Files (only for available items)
                        (hasFile ? (
                            '<label class="mh-check-row">' +
                                '<input type="checkbox" id="mh-cdm-delete-files"' + deleteFilesChecked + '>' +
                                '<div><strong>Delete Movie Files</strong>' +
                                '<div class="mh-help">Delete the movie files and movie folder from disk</div></div>' +
                            '</label>'
                        ) : '') +

                        // Option 3: Add to Hidden Media (always last)
                        '<label class="mh-check-row">' +
                            '<input type="checkbox" id="mh-cdm-hidden"' + hiddenChecked + '>' +
                            '<div><strong>Add to Hidden Media</strong>' +
                            '<div class="mh-help">Hide from discovery pages so it won\'t be re-suggested</div></div>' +
                        '</label>' +

                    '</div>' +
                    '<div class="mh-modal-footer">' +
                        '<button class="mh-btn mh-btn-secondary" id="mh-cdm-cancel">Close</button>' +
                        '<button class="mh-btn mh-btn-danger" id="mh-cdm-confirm">Delete</button>' +
                    '</div>' +
                '</div>' +
            '</div>';

        document.body.insertAdjacentHTML('beforeend', html);

        // Wire close handlers
        var closeModal = function() {
            var el = document.getElementById('mh-card-delete-modal');
            if (el) el.remove();
        };
        document.getElementById('mh-cdm-close').addEventListener('click', closeModal);
        document.getElementById('mh-cdm-cancel').addEventListener('click', closeModal);
        document.getElementById('mh-card-delete-modal').addEventListener('click', function(e) {
            if (e.target.id === 'mh-card-delete-modal') closeModal();
        });

        // Wire confirm
        document.getElementById('mh-cdm-confirm').addEventListener('click', function() {
            handleConfirm(item, options, hasFile, appType, closeModal);
        });
    }

    function handleConfirm(item, options, hasFile, appType, closeModal) {
        var removeFromLib = document.getElementById('mh-cdm-remove')
            ? document.getElementById('mh-cdm-remove').checked : true;
        var deleteFiles = document.getElementById('mh-cdm-delete-files')
            ? document.getElementById('mh-cdm-delete-files').checked : false;
        var addToHidden = document.getElementById('mh-cdm-hidden')
            ? document.getElementById('mh-cdm-hidden').checked : false;

        // Save prefs
        var newPrefs = {
            remove_from_library: removeFromLib,
            delete_files: deleteFiles,
            add_to_hidden: addToHidden
        };
        _prefs = newPrefs;
        savePrefs(newPrefs);

        var delBtn = document.getElementById('mh-cdm-confirm');
        if (delBtn) { delBtn.disabled = true; delBtn.textContent = 'Deleting...'; }

        var tmdbId = item.tmdb_id || item.id;
        var instanceId = options.instanceId || '';
        var instanceName = options.instanceName || '';
        var promises = [];

        // 1. Remove from library
        if (removeFromLib) {
            var removePromise = fetch('./api/movie-hunt/collection/remove?instance_id=' + encodeURIComponent(instanceId), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tmdb_id: tmdbId,
                    title: item.title || '',
                    year: String(item.year || ''),
                    add_to_blocklist: false,
                    delete_files: deleteFiles
                })
            }).then(function(r) { return r.json(); });
            promises.push(removePromise);
        }

        // 2. Add to hidden media
        if (addToHidden && tmdbId && instanceName) {
            var hidePromise = fetch('./api/requestarr/hidden-media', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tmdb_id: tmdbId,
                    media_type: 'movie',
                    title: item.title || '',
                    poster_path: item.poster_path || null,
                    app_type: appType,
                    instance_name: instanceName
                })
            }).then(function(r) { return r.json(); });
            promises.push(hidePromise);
        }

        if (promises.length === 0) {
            // Nothing selected, just close
            closeModal();
            return;
        }

        Promise.all(promises)
            .then(function() {
                closeModal();
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('"' + (item.title || 'Movie') + '" removed.', 'success');
                }
                if (typeof options.onDeleted === 'function') {
                    options.onDeleted();
                }
            })
            .catch(function(err) {
                console.error('[MovieCardDeleteModal] Error:', err);
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('Delete failed: ' + (err.message || 'Unknown error'), 'error');
                }
                if (delBtn) { delBtn.disabled = false; delBtn.textContent = 'Delete'; }
            });
    }

    window.MovieCardDeleteModal = { open: open };
})();


/* === modules/features/media-hunt-collection.js === */
/**
 * Movie Hunt Movie Collection - requested movies and status (requested / available).
 * Users go to Request Movies (#requestarr-movies) to add movies; this view lists the collection.
 */
(function() {
    'use strict';

    window.MovieHuntCollection = {
        _prefix: 'media-hunt-movie-collection',
        page: 1,
        pageSize: 9999, // Load all items (no pagination)
        total: 0,
        searchQuery: '',
        sortBy: 'title.asc',
        viewMode: 'posters', // posters, table, overview
        items: [],
        hiddenMediaSet: new Set(),

        getEl: function(suffix) {
            return document.getElementById((this._prefix || 'media-hunt-collection') + '-' + suffix);
        },

        init: function() {
            this.page = 1;
            this.viewMode = HuntarrUtils.getUIPreference(this._prefix + '-view', 'posters');
            this.setupInstanceSelect();
            this.setupSort();
            this.setupViewMode();
            this.setupSearch();
            if (window._mediaHuntCollectionUnified) return;
            this.loadHiddenMediaIds().then(function() {
                window.MovieHuntCollection.loadCollection();
            });
        },

        // ─── Hidden Media ─────────────────────────────────────────────
        loadHiddenMediaIds: function() {
            var self = this;
            return fetch('./api/requestarr/hidden-media?page=1&page_size=10000')
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    var items = Array.isArray(data) ? data : (Array.isArray(data.items) ? data.items : []);
                    self.hiddenMediaSet = new Set();
                    items.forEach(function(item) {
                        var key = item.tmdb_id + ':' + item.media_type + ':' + item.app_type + ':' + item.instance_name;
                        self.hiddenMediaSet.add(key);
                    });
                    console.log('[MovieHuntCollection] Loaded', self.hiddenMediaSet.size, 'hidden media items');
                })
                .catch(function(err) {
                    console.error('[MovieHuntCollection] Error loading hidden media IDs:', err);
                    self.hiddenMediaSet = new Set();
                });
        },

        isMediaHidden: function(tmdbId) {
            if (!this.hiddenMediaSet || this.hiddenMediaSet.size === 0) return false;
            var instanceName = this.getCurrentInstanceName();
            if (!instanceName) return false;
            var key = tmdbId + ':movie:movie_hunt:' + instanceName;
            return this.hiddenMediaSet.has(key);
        },

        getCurrentInstanceName: function() {
            var select = this.getEl('instance-select');
            if (!select) return '';
            var opt = select.options[select.selectedIndex];
            if (opt && opt.value && opt.value.indexOf('movie:') === 0)
                return opt.getAttribute('data-name') || (opt.textContent || '').replace(/^Movie\s*-\s*/, '').trim();
            return select.value || '';
        },
        getCurrentInstanceId: function() {
            var select = this.getEl('instance-select');
            if (!select) return '';
            var v = select.value || '';
            if (v.indexOf('movie:') === 0) return v.slice(6);
            return v;
        },

        hideMedia: function(tmdbId, title, posterPath, cardElement) {
            var self = this;
            var instanceName = self.getCurrentInstanceName();
            window.MediaUtils.hideMedia({
                tmdbId: tmdbId,
                mediaType: 'movie',
                title: title,
                posterPath: posterPath || null,
                appType: 'movie_hunt',
                instanceName: instanceName,
                cardElement: cardElement,
                hiddenMediaSet: self.hiddenMediaSet
            });
        },

        // ─── Search ───────────────────────────────────────────────────
        setupSearch: function() {
            var self = this;
            var input = this.getEl('search-input');
            if (!input) return;

            input.addEventListener('input', function() {
                if (window._mediaHuntCollectionUnified) {
                    var isel = self.getEl('instance-select');
                    if (isel && isel.value && isel.value.indexOf('movie:') !== 0) return;
                }
                if (self.searchTimeout) clearTimeout(self.searchTimeout);
                var query = (input.value || '').trim();

                if (!query) {
                    self.showMainView();
                    return;
                }

                self.searchTimeout = setTimeout(function() {
                    self.performSearch(query);
                }, 500);
            });
        },

        showMainView: function() {
            var resultsView = this.getEl('search-results-view');
            var mainContent = this.getEl('main-content');
            if (resultsView) resultsView.style.display = 'none';
            if (mainContent) mainContent.style.display = 'block';
        },

        showResultsView: function() {
            var resultsView = this.getEl('search-results-view');
            var mainContent = this.getEl('main-content');
            if (resultsView) resultsView.style.display = 'block';
            if (mainContent) mainContent.style.display = 'none';
        },

        performSearch: function(query) {
            var self = this;
            var grid = this.getEl('search-results-grid');
            if (!grid) return;

            self.showResultsView();
            grid.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Searching movies...</p></div>';

            // Use the currently selected Movie Hunt instance for library status check
            var instanceSelect = this.getEl('instance-select');
            var instanceName = instanceSelect ? instanceSelect.value : '';

            var url = './api/requestarr/search?q=' + encodeURIComponent(query) + '&app_type=movie_hunt&instance_name=' + encodeURIComponent(instanceName);
            
            fetch(url)
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    var results = data.results || [];
                    grid.innerHTML = '';

                    if (results.length === 0) {
                        grid.innerHTML = '<p style="color: #888; text-align: center; padding: 40px; width: 100%;">No movies found matching "' + query + '"</p>';
                        return;
                    }

                    results.forEach(function(item) {
                        var card = self.createSearchCard(item);
                        if (card) grid.appendChild(card);
                    });
                })
                .catch(function(err) {
                    console.error('[MovieHuntCollection] Search failed:', err);
                    grid.innerHTML = '<p style="color: #ef4444; text-align: center; padding: 40px; width: 100%;">Search failed. Please try again.</p>';
                });
        },

        createSearchCard: function(item) {
            var self = this;
            // Use Requestarr modal (Add to Library popup) - use instance NAME (not ID) for compound value
            var suggestedInstance = null;
            var instanceSelect = this.getEl('instance-select');
            if (instanceSelect && instanceSelect.value) {
                var opt = instanceSelect.options[instanceSelect.selectedIndex];
                var instanceName = opt ? (opt.textContent || '').trim() : '';
                if (instanceName) {
                    suggestedInstance = instanceSelect.value.indexOf('movie_hunt:') === 0
                        ? instanceSelect.value
                        : 'movie_hunt:' + instanceName;
                }
            }
            if (window.RequestarrDiscover && window.RequestarrDiscover.modal && window.RequestarrDiscover.content && typeof window.RequestarrDiscover.content.createMediaCard === 'function') {
                return window.RequestarrDiscover.content.createMediaCard(item, suggestedInstance);
            }
            if (window.HomeRequestarr && typeof window.HomeRequestarr.createMediaCard === 'function') {
                var card = window.HomeRequestarr.createMediaCard(item, suggestedInstance);
                if (card) return card;
            }

            // Fallback: open Requestarr modal on click (same popup as Requestarr)
            var card = document.createElement('div');
            card.className = 'media-card';
            var title = (item.title || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
            var year = item.year || 'N/A';
            var posterUrl = item.poster_path || './static/images/blackout.jpg';

            card.innerHTML = '<div class="media-card-poster">' +
                '<img src="' + posterUrl + '" alt="' + title + '" onerror="this.src=\'./static/images/blackout.jpg\'">' +
                '<div class="media-card-overlay">' +
                '<div class="media-card-overlay-title">' + title + '</div>' +
                '<div class="media-card-overlay-content">' +
                '<div class="media-card-overlay-year">' + year + '</div>' +
                '<button class="media-card-request-btn"><i class="fas fa-plus-circle"></i> Add to Library</button>' +
                '</div></div>' +
                '</div>' +
                '<div class="media-card-info">' +
                '<div class="media-card-title" title="' + title + '">' + title + '</div>' +
                '<div class="media-card-meta">' +
                '<span class="media-card-year">' + year + '</span>' +
                '</div></div>';

            card.onclick = function() {
                var tmdbId = item.tmdb_id || item.id;
                if (tmdbId && window.RequestarrDiscover && window.RequestarrDiscover.modal) {
                    window.RequestarrDiscover.modal.openModal(tmdbId, 'movie', suggestedInstance);
                }
            };

            return card;
        },

        // ─── Instance / Sort / View Mode Setup ────────────────────────
        setupInstanceSelect: function() {
            if (window._mediaHuntCollectionUnified) return;
            var select = this.getEl('instance-select');
            if (!select) return;
            var id = (this._prefix || 'media-hunt-collection') + '-instance-select';
            if (window.MovieHuntInstanceDropdown && window.MovieHuntInstanceDropdown.attach) {
                window.MovieHuntInstanceDropdown.attach(id, function() {
                    window.MovieHuntCollection.page = 1;
                    // Reload hidden media for the new instance, then reload collection
                    window.MovieHuntCollection.loadHiddenMediaIds().then(function() {
                        window.MovieHuntCollection.loadCollection();
                    });
                });
            } else {
                select.innerHTML = '<option value="">No Movie Hunt instances</option>';
            }
        },

        setupSort: function() {
            var self = this;
            var select = this.getEl('sort');
            if (!select) return;
            if (window._mediaHuntCollectionUnified) {
                var isel = this.getEl('instance-select');
                if (isel && isel.value && isel.value.indexOf('movie:') !== 0) return;
            }
            var saved = HuntarrUtils.getUIPreference('movie-hunt-collection-sort', 'title.asc');
            if (saved) {
                self.sortBy = saved;
                try { select.value = saved; } catch (e) {}
            }
            select.onchange = function() {
                if (window._mediaHuntCollectionUnified) {
                    var isel = self.getEl('instance-select');
                    if (isel && isel.value && isel.value.indexOf('movie:') !== 0) return;
                }
                self.sortBy = (select.value || 'title.asc').trim();
                HuntarrUtils.setUIPreference('movie-hunt-collection-sort', self.sortBy);
                self.page = 1;
                self.loadCollection();
            };
        },

        setupViewMode: function() {
            var self = this;
            var select = this.getEl('view-mode');
            if (!select) return;
            select.value = this.viewMode;
            select.onchange = function() {
                if (window._mediaHuntCollectionUnified) {
                    var isel = self.getEl('instance-select');
                    if (isel && isel.value && isel.value.indexOf('movie:') !== 0) return;
                }
                self.viewMode = select.value;
                HuntarrUtils.setUIPreference(self._prefix + '-view', self.viewMode);
                self.renderPage();
            };
        },

        // ─── Data Loading & Rendering ─────────────────────────────────
        loadCollection: function() {
            var self = this;
            var grid = this.getEl('grid');
            if (!grid) return;
            grid.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Loading media collection...</p></div>';
            grid.style.display = 'flex';
            var instanceId = window._mediaHuntCollectionUnified ? this.getCurrentInstanceId() : (this.getEl('instance-select') && this.getEl('instance-select').value);
            var url = './api/movie-hunt/collection?page=' + this.page + '&page_size=' + this.pageSize + '&sort=' + encodeURIComponent(this.sortBy || 'title.asc');
            if (instanceId) url += '&instance_id=' + encodeURIComponent(instanceId);
            if (this.searchQuery) url += '&q=' + encodeURIComponent(this.searchQuery);
            fetch(url)
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    self.items = data.items || [];
                    self.total = data.total != null ? data.total : 0;
                    self.renderPage();
                })
                .catch(function() {
                    grid.innerHTML = '<p style="color: #ef4444; text-align: center; padding: 60px;">Failed to load collection.</p>';
                });
        },

        renderPage: function() {
            // Hide all views first
            var grid = this.getEl('grid');
            var table = this.getEl('table');
            var overview = this.getEl('overview');
            if (grid) grid.style.display = 'none';
            if (table) table.style.display = 'none';
            if (overview) overview.style.display = 'none';

            var instanceSelect = this.getEl('instance-select');
            var opt = instanceSelect && instanceSelect.options[instanceSelect.selectedIndex];
            var val = instanceSelect ? instanceSelect.value : '';
            var noInstances = !val || (opt && (opt.value === '' || (opt.textContent || '').trim().indexOf('No Movie Hunt') !== -1));

            if (noInstances) {
                if (grid) {
                    grid.style.display = 'flex';
                    grid.style.alignItems = 'center';
                    grid.style.justifyContent = 'center';
                    grid.innerHTML = '<div style="text-align: center; color: #9ca3af; max-width: 600px;">' +
                        '<i class="fas fa-cube" style="font-size: 64px; margin-bottom: 30px; opacity: 0.4; display: block;"></i>' +
                        '<p style="font-size: 20px; margin-bottom: 15px; font-weight: 500;">No Movie Hunt instance</p>' +
                        '<p style="font-size: 15px; line-height: 1.6; opacity: 0.8; margin-bottom: 20px;">Create a Movie Hunt instance to manage your media collection and requested movies.</p>' +
                        '<a href="./#media-hunt-instances" class="action-button" style="display: inline-flex; align-items: center; gap: 8px; background: rgba(99, 102, 241, 0.2); border: 1px solid rgba(99, 102, 241, 0.4); color: #818cf8; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 500; transition: all 0.2s ease;">' +
                        '<i class="fas fa-cog"></i> Set up Movie Hunt instance</a></div>';
                }
                return;
            }

            // Filter hidden items
            var visibleItems = [];
            for (var i = 0; i < this.items.length; i++) {
                var item = this.items[i];
                if (item.tmdb_id && this.isMediaHidden(item.tmdb_id)) continue;
                visibleItems.push(item);
            }

            if (visibleItems.length === 0) {
                if (grid) {
                    grid.style.display = 'flex';
                    grid.style.alignItems = 'center';
                    grid.style.justifyContent = 'center';
                    grid.innerHTML = '<div style="text-align: center; color: #9ca3af; max-width: 600px;">' +
                        '<i class="fas fa-inbox" style="font-size: 64px; margin-bottom: 30px; opacity: 0.4; display: block;"></i>' +
                        '<p style="font-size: 20px; margin-bottom: 15px; font-weight: 500;">No Requested Media</p>' +
                        '<p style="font-size: 15px; line-height: 1.6; opacity: 0.8;">Movies you request from Movie Home will appear here. Track status as Requested or Available.</p></div>';
                }
                return;
            }

            if (this.viewMode === 'table') {
                this.renderTable(visibleItems);
            } else if (this.viewMode === 'overview') {
                this.renderOverview(visibleItems);
            } else {
                this.renderPosters(visibleItems);
            }
        },

        renderPosters: function(items) {
            var grid = this.getEl('grid');
            if (!grid) return;
            grid.style.display = 'grid';
            grid.style.alignItems = '';
            grid.style.justifyContent = '';
            grid.innerHTML = '';
            var renderItems = items || this.items;
            for (var i = 0; i < renderItems.length; i++) {
                grid.appendChild(this.createCard(renderItems[i], i));
            }
        },

        renderTable: function(items) {
            var table = this.getEl('table');
            var tbody = this.getEl('table-body');
            if (!table || !tbody) return;
            table.style.display = 'block';
            tbody.innerHTML = '';
            var renderItems = items || this.items;
            for (var i = 0; i < renderItems.length; i++) {
                var item = renderItems[i];
                var tr = document.createElement('tr');
                var title = (item.title || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                var year = item.year || 'N/A';
                var status = (item.status || 'requested').toLowerCase();
                var statusLabel = status === 'available' ? 'Available' : 'Requested';
                var posterUrl = item.poster_path ? ('https://image.tmdb.org/t/p/w92' + item.poster_path) : './static/images/blackout.jpg';
                var qualityProfile = item.quality_profile || 'N/A';
                tr.innerHTML = '<td><img src="' + posterUrl + '" class="table-poster" onerror="this.src=\'./static/images/blackout.jpg\'"></td>' +
                    '<td class="table-title">' + title + '</td>' +
                    '<td>' + year + '</td>' +
                    '<td><span class="table-status ' + status + '">' + statusLabel + '</span></td>' +
                    '<td>' + qualityProfile + '</td>' +
                    '<td class="table-actions">' +
                    '<button class="table-action-btn" onclick="window.MovieHuntCollection.refreshItem(' + i + ')"><i class="fas fa-sync-alt"></i> Refresh</button>' +
                    '</td>';
                tbody.appendChild(tr);
            }
        },

        renderOverview: function(items) {
            var overview = this.getEl('overview');
            var list = this.getEl('overview-list');
            if (!overview || !list) return;
            overview.style.display = 'block';
            list.innerHTML = '';
            var renderItems = items || this.items;
            for (var i = 0; i < renderItems.length; i++) {
                var item = renderItems[i];
                var div = document.createElement('div');
                div.className = 'media-overview-item';
                var title = (item.title || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                var year = item.year || 'N/A';
                var status = (item.status || 'requested').toLowerCase();
                var statusLabel = status === 'available' ? 'Available' : 'Requested';
                var posterUrl = item.poster_path ? ('https://image.tmdb.org/t/p/w200' + item.poster_path) : './static/images/blackout.jpg';
                var qualityProfile = item.quality_profile || 'N/A';
                var rootFolder = item.root_folder || 'N/A';
                div.innerHTML = '<div class="media-overview-poster"><img src="' + posterUrl + '" onerror="this.src=\'./static/images/blackout.jpg\'"></div>' +
                    '<div class="media-overview-details">' +
                    '<div class="media-overview-title">' + title + ' <span class="media-overview-year">(' + year + ')</span></div>' +
                    '<div class="media-overview-meta">' +
                    '<div class="media-overview-meta-item"><i class="fas fa-folder"></i> ' + rootFolder + '</div>' +
                    '<div class="media-overview-meta-item"><i class="fas fa-film"></i> ' + qualityProfile + '</div>' +
                    '</div>' +
                    '<div><span class="media-overview-status ' + status + '">' + statusLabel + '</span></div>' +
                    '<div class="media-overview-actions">' +
                    '<button class="media-overview-action-btn" onclick="window.MovieHuntCollection.refreshItem(' + i + ')"><i class="fas fa-sync-alt"></i> Refresh</button>' +
                    '</div>' +
                    '</div>';
                list.appendChild(div);
            }
        },

        refreshItem: function(index) {
            // Placeholder for refresh functionality
            console.log('Refresh item:', index);
        },

        createCard: function(item, index) {
            var self = this;
            var card = document.createElement('div');
            card.className = 'media-card';
            var title = (item.title || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
            var titleRaw = (item.title || '').replace(/</g, '&lt;');
            var year = item.year || 'N/A';
            var status = (item.status || 'requested').toLowerCase();
            var posterUrl = (item.poster_path && item.poster_path.indexOf('http') === 0) ? item.poster_path : (item.poster_path ? 'https://image.tmdb.org/t/p/w500' + (item.poster_path.indexOf('/') === 0 ? item.poster_path : '/' + item.poster_path) : './static/images/blackout.jpg');
            if (!item.poster_path) posterUrl = './static/images/blackout.jpg';

            // Status badge: green check = available, amber bookmark = requested
            var statusClass = status === 'available' ? 'complete' : 'partial';
            var statusIcon = status === 'available' ? 'check' : 'bookmark';

            // Rating display
            var rating = item.vote_average != null ? Number(item.vote_average).toFixed(1) : '';
            var ratingHtml = rating ? '<span class="media-card-rating"><i class="fas fa-star"></i> ' + rating + '</span>' : '';

            // Delete button: show for all collection items (they are all available or requested)
            var hasInstance = !!self.getCurrentInstanceName();
            var canDelete = hasInstance && item.tmdb_id;
            var deleteHtml = canDelete ? '<button class="media-card-delete-btn" title="Remove / Delete"><i class="fas fa-trash-alt"></i></button>' : '';

            if (status === 'available') card.classList.add('in-library');

            var moviePct = status === 'available' ? 100 : 0;
            var movieBarClass = 'episode-progress-bar' + (moviePct >= 100 ? ' complete' : ' empty');

            card.innerHTML = '<div class="media-card-poster">' +
                '<div class="media-card-status-badge ' + statusClass + '"><i class="fas fa-' + statusIcon + '"></i></div>' +
                '<img src="' + posterUrl + '" alt="' + title + '" onerror="this.src=\'./static/images/blackout.jpg\'">' +
                '<div class="media-card-overlay">' +
                '<div class="media-card-overlay-title">' + titleRaw + '</div>' +
                '<div class="media-card-overlay-content">' +
                '<div class="media-card-overlay-year">' + year + '</div>' +
                '</div></div>' +
                '</div>' +
                '<div class="' + movieBarClass + '">' +
                '<div class="episode-progress-fill" style="width:' + moviePct + '%"></div>' +
                '</div>' +
                '<div class="media-card-info">' +
                '<div class="media-card-title" title="' + title + '">' + titleRaw + '</div>' +
                '<div class="media-card-meta">' +
                '<span class="media-card-year">' + year + '</span>' +
                ratingHtml +
                deleteHtml +
                '</div></div>';

            // Handle delete button click
            var deleteBtn = card.querySelector('.media-card-delete-btn');
            if (deleteBtn) {
                deleteBtn.addEventListener('click', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    self.openDeleteModal(item, card);
                });
            }

            // Click anywhere on card opens Requestarr detail page
            if (item.tmdb_id) {
                card.style.cursor = 'pointer';
                card.onclick = function(e) {
                    if (e.target.closest && e.target.closest('.media-card-delete-btn')) return;
                    var movieData = {
                        tmdb_id: item.tmdb_id,
                        id: item.tmdb_id,
                        title: item.title,
                        year: item.year,
                        poster_path: item.poster_path,
                        in_library: status === 'available'
                    };
                    if (window.RequestarrDetail) {
                        window.RequestarrDetail.openDetail(movieData);
                    }
                };
            }

            return card;
        },

        openDeleteModal: function(item, cardElement) {
            var self = this;
            if (!window.MovieCardDeleteModal) {
                console.error('[MovieHuntCollection] MovieCardDeleteModal not loaded');
                return;
            }
            var instanceName = self.getCurrentInstanceName();
            var select = this.getEl('instance-select');
            var instanceId = select ? select.value : '';
            var status = (item.status || 'requested').toLowerCase();

            window.MovieCardDeleteModal.open(item, {
                instanceName: instanceName,
                instanceId: instanceId,
                status: status,
                hasFile: status === 'available',
                appType: 'movie_hunt',
                onDeleted: function() {
                    window.MediaUtils.animateCardRemoval(cardElement, function() {
                        // Reload collection after card is removed
                        setTimeout(function() { self.loadCollection(); }, 200);
                    });
                }
            });
        },

        removeFromCollection: function(title, year) {
            var self = this;
            if (!title) return;
            var doRemove = function() {
                fetch('./api/movie-hunt/collection/0', {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title: title, year: year })
                })
                    .then(function(r) { return r.json(); })
                    .then(function(data) {
                        if (data.success && window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification('Removed from collection.', 'success');
                        }
                        self.loadCollection();
                    })
                    .catch(function() {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification('Failed to remove.', 'error');
                        }
                    });
            };
            if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
                window.HuntarrConfirm.show({ title: 'Remove from Requested List', message: 'Remove this movie from your requested list?', confirmLabel: 'Remove', onConfirm: doRemove });
            } else {
                doRemove();
            }
        }
    };
})();

/**
 * TV Hunt Collection – series list with expandable seasons and episodes.
 * Mirrors Sonarr's series detail view: header with info, then accordion seasons with episode tables.
 */
(function() {
    'use strict';

    window.TVHuntCollection = {
        _prefix: 'media-hunt-tv-collection',
        items: [],
        sortBy: 'title.asc',
        viewMode: 'posters',
        searchQuery: '',

        getEl: function(suffix) {
            return document.getElementById((this._prefix || 'media-hunt-collection') + '-' + suffix);
        },

        init: function() {
            this.viewMode = HuntarrUtils.getUIPreference(this._prefix + '-view', 'posters');
            this.setupInstanceSelect();
            this.setupSort();
            this.setupViewMode();
            this.setupSearch();
            this.setupBackButton();
            if (!window._mediaHuntCollectionUnified) this.loadCollection();
        },

        setupInstanceSelect: function() {
            if (window._mediaHuntCollectionUnified) return;
            var self = this;
            var select = this.getEl('instance-select');
            if (!select) return;
            fetch('./api/tv-hunt/instances')
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    var instances = data.instances || [];
                    select.innerHTML = '';
                    if (instances.length === 0) {
                        select.innerHTML = '<option value="">No instances</option>';
                        return;
                    }
                    instances.forEach(function(inst) {
                        var opt = document.createElement('option');
                        opt.value = inst.id;
                        opt.textContent = inst.name;
                        select.appendChild(opt);
                    });
                    fetch('./api/tv-hunt/instances/current')
                        .then(function(r) { return r.json(); })
                        .then(function(d) {
                            if (d.current_instance_id) select.value = d.current_instance_id;
                            self.loadCollection();
                        });
                    select.addEventListener('change', function() {
                        fetch('./api/tv-hunt/instances/current', {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ instance_id: parseInt(select.value) })
                        }).then(function() { self.loadCollection(); });
                    });
                });
        },

        setupSort: function() {
            var self = this;
            var sortSelect = this.getEl('sort');
            if (!sortSelect) return;
            sortSelect.addEventListener('change', function() {
                if (window._mediaHuntCollectionUnified) {
                    var isel = self.getEl('instance-select');
                    if (isel && isel.value && isel.value.indexOf('tv:') !== 0) return;
                }
                self.sortBy = sortSelect.value;
                self.renderCollection();
            });
        },

        setupViewMode: function() {
            var self = this;
            var select = this.getEl('view-mode');
            if (!select) return;
            select.value = this.viewMode;
            select.addEventListener('change', function() {
                if (window._mediaHuntCollectionUnified) {
                    var isel = self.getEl('instance-select');
                    if (isel && isel.value && isel.value.indexOf('tv:') !== 0) return;
                }
                self.viewMode = select.value;
                HuntarrUtils.setUIPreference(self._prefix + '-view', self.viewMode);
                self.renderCollection();
            });
        },

        setupSearch: function() {
            var self = this;
            var input = this.getEl('search-input');
            if (!input) return;
            var timeout;
            input.addEventListener('input', function() {
                if (window._mediaHuntCollectionUnified) {
                    var isel = self.getEl('instance-select');
                    if (isel && isel.value && isel.value.indexOf('tv:') !== 0) return;
                }
                if (timeout) clearTimeout(timeout);
                var q = (input.value || '').trim();
                if (!q) {
                    self.searchQuery = '';
                    self.showMainView();
                    self.renderCollection();
                    return;
                }
                timeout = setTimeout(function() {
                    self.searchQuery = '';
                    self.performCollectionSearch(q);
                }, 400);
            });
        },

        setupBackButton: function() {
            var self = this;
            var btn = this.getEl('series-back-btn');
            if (btn) {
                btn.addEventListener('click', function() {
                    self.showMainView();
                });
            }
        },

        showMainView: function() {
            var mainView = this.getEl('main-content');
            var detailView = this.getEl('series-detail-view');
            var searchView = this.getEl('search-results-view');
            if (mainView) mainView.style.display = 'block';
            if (detailView) detailView.style.display = 'none';
            if (searchView) searchView.style.display = 'none';
            if (window._mediaHuntCollectionUnified && /\/tv\/\d+$/.test(window.location.hash || '')) {
                window.history.replaceState(null, document.title, (window.location.pathname || '') + (window.location.search || '') + '#media-hunt-collection');
            }
        },

        performCollectionSearch: function(query) {
            // Use same requestarr search as movie collection (app_type=tv_hunt)
            var self = this;
            var mainView = this.getEl('main-content');
            var searchView = this.getEl('search-results-view');
            var detailView = this.getEl('series-detail-view');
            var grid = this.getEl('search-results-grid');
            if (mainView) mainView.style.display = 'none';
            if (detailView) detailView.style.display = 'none';
            if (searchView) searchView.style.display = 'block';
            if (grid) grid.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Searching...</p></div>';

            var instanceSelect = this.getEl('instance-select');
            var instanceName = instanceSelect ? instanceSelect.value : '';
            var url = './api/requestarr/search?q=' + encodeURIComponent(query) + '&app_type=tv_hunt&instance_name=' + encodeURIComponent(instanceName);

            fetch(url)
                .then(function(r) {
                    if (!r.ok) {
                        return r.json().then(function(data) {
                            throw new Error(data.error || 'Search failed');
                        }).catch(function() { throw new Error('Search failed'); });
                    }
                    return r.json();
                })
                .then(function(data) {
                    var results = data.results || [];
                    if (!grid) return;
                    if (results.length === 0) {
                        grid.innerHTML = '<p style="text-align:center;color:#888;padding:40px;">No results found.</p>';
                        return;
                    }
                    grid.innerHTML = '';
                    results.forEach(function(show) {
                        var card = self._createSearchCard(show);
                        grid.appendChild(card);
                    });
                })
                .catch(function(err) {
                    if (grid) grid.innerHTML = '<p style="text-align:center;color:#f87171;">' + (err && err.message ? HuntarrUtils.escapeHtml(err.message) : 'Search failed.') + '</p>';
                });
        },

        _createSearchCard: function(show) {
            var self = this;
            var card = document.createElement('div');
            card.className = 'media-card';
            // requestarr returns full poster URL; raw TMDB returns relative path
            var posterUrl = show.poster_path
                ? (show.poster_path.indexOf('http') === 0 ? show.poster_path : 'https://image.tmdb.org/t/p/w300' + show.poster_path)
                : './static/images/no-poster.png';
            var title = show.name || show.title || show.original_name || 'Unknown';
            var year = show.year != null ? show.year : (show.first_air_date || '').substring(0, 4);

            // Check if already in collection (supports both requestarr shape and raw TMDB shape)
            var showId = show.tmdb_id != null ? show.tmdb_id : show.id;
            var inCollection = self.items.some(function(s) { return s.tmdb_id === showId; });

            card.innerHTML =
                '<div class="media-poster">' +
                    '<img src="' + posterUrl + '" alt="' + HuntarrUtils.escapeHtml(title) + '" loading="lazy">' +
                    '<div class="media-overlay">' +
                        (inCollection
                            ? '<span style="color:#4ade80;font-size:0.9em;"><i class="fas fa-check"></i> In Collection</span>'
                            : '<button class="add-to-collection-btn" title="Add to Collection"><i class="fas fa-plus"></i></button>') +
                    '</div>' +
                '</div>' +
                '<div class="media-info">' +
                    '<div class="media-title">' + HuntarrUtils.escapeHtml(title) + '</div>' +
                    '<div class="media-year">' + (year || '') + '</div>' +
                '</div>';

            if (!inCollection) {
                var addBtn = card.querySelector('.add-to-collection-btn');
                if (addBtn) {
                    var instSelect = this.getEl('instance-select');
                    var instanceId = instSelect ? instSelect.value : '';
                    addBtn.addEventListener('click', function(e) {
                        e.stopPropagation();
                        var add = (window.MediaHunt && window.MediaHunt.addToCollection) ? window.MediaHunt.addToCollection : (window.TVHunt && window.TVHunt.addToCollection);
                        if (add) add(show, instanceId);
                        addBtn.outerHTML = '<span style="color:#4ade80;font-size:0.9em;"><i class="fas fa-check"></i> Added</span>';
                    });
                }
            }
            return card;
        },

        getCurrentInstanceId: function() {
            var select = this.getEl('instance-select');
            if (!select) return '';
            var v = select.value || '';
            if (v.indexOf('tv:') === 0) return v.slice(3);
            return v;
        },

        loadCollection: function() {
            var self = this;
            var grid = this.getEl('grid');
            if (grid) {
                grid.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Loading TV collection...</p></div>';
                grid.style.display = 'flex';
            }
            var instanceId = self.getCurrentInstanceId();
            if (!instanceId) {
                self.renderCollection();
                return;
            }
            fetch('./api/tv-hunt/collection?instance_id=' + instanceId)
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    self.items = data.series || [];
                    self.renderCollection();
                })
                .catch(function() {
                    self.items = [];
                    self.renderCollection();
                });
        },

        renderCollection: function() {
            var self = this;
            var grid = this.getEl('grid');
            var table = this.getEl('table');
            var tableBody = this.getEl('table-body');
            var overview = this.getEl('overview');
            var overviewList = this.getEl('overview-list');
            if (grid) grid.style.display = 'none';
            if (table) table.style.display = 'none';
            if (overview) overview.style.display = 'none';

            var instanceSelect = this.getEl('instance-select');
            var noInstances = instanceSelect && (!instanceSelect.value || instanceSelect.value === '') &&
                (instanceSelect.options.length === 0 || (instanceSelect.options[0] && (instanceSelect.options[0].textContent || '').indexOf('No instances') !== -1));

            if (noInstances) {
                if (grid) {
                    grid.style.display = 'flex';
                    grid.style.alignItems = 'center';
                    grid.style.justifyContent = 'center';
                    grid.innerHTML = '<div style="text-align: center; color: #9ca3af; max-width: 600px;">' +
                        '<i class="fas fa-cube" style="font-size: 64px; margin-bottom: 30px; opacity: 0.4; display: block;"></i>' +
                        '<p style="font-size: 20px; margin-bottom: 15px; font-weight: 500;">No TV Hunt instance</p>' +
                        '<p style="font-size: 15px; line-height: 1.6; opacity: 0.8; margin-bottom: 20px;">Create a TV Hunt instance to manage your TV collection and requested shows.</p>' +
                        '<a href="./#media-hunt-instances" class="action-button" style="display: inline-flex; align-items: center; gap: 8px; background: rgba(99, 102, 241, 0.2); border: 1px solid rgba(99, 102, 241, 0.4); color: #818cf8; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 500; transition: all 0.2s ease;">' +
                        '<i class="fas fa-cog"></i> Set up TV Hunt instance</a></div>';
                }
                return;
            }

            var items = self.items.slice();
            if (self.sortBy === 'title.asc') items.sort(function(a, b) { return (a.title || '').localeCompare(b.title || ''); });
            else if (self.sortBy === 'title.desc') items.sort(function(a, b) { return (b.title || '').localeCompare(a.title || ''); });
            else if (self.sortBy === 'added.desc') items.sort(function(a, b) { return (b.added_at || '').localeCompare(a.added_at || ''); });
            else if (self.sortBy === 'rating.desc') items.sort(function(a, b) { return (b.vote_average || 0) - (a.vote_average || 0); });

            if (items.length === 0) {
                if (grid) {
                    grid.style.display = 'flex';
                    grid.style.alignItems = 'center';
                    grid.style.justifyContent = 'center';
                    grid.innerHTML = '<div style="text-align: center; color: #9ca3af; max-width: 600px;">' +
                        '<i class="fas fa-inbox" style="font-size: 64px; margin-bottom: 30px; opacity: 0.4; display: block;"></i>' +
                        '<p style="font-size: 20px; margin-bottom: 15px; font-weight: 500;">No Requested Media</p>' +
                        '<p style="font-size: 15px; line-height: 1.6; opacity: 0.8;">TV shows you add from TV Hunt will appear here. Track status as Requested or Available.</p></div>';
                }
                return;
            }

            if (self.viewMode === 'table') {
                self._renderTableToContainer(table, tableBody, items);
                if (table) table.style.display = 'block';
            } else if (self.viewMode === 'overview') {
                self._renderOverviewToContainer(overviewList, items);
                if (overview) overview.style.display = 'block';
            } else {
                grid.style.display = 'grid';
                grid.style.alignItems = '';
                grid.style.justifyContent = '';
                grid.innerHTML = '';
                self._renderPosterView(grid, items);
            }
        },

        _renderTableToContainer: function(tableEl, tbody, items) {
            var self = this;
            if (!tbody) return;
            tbody.innerHTML = '';
            items.forEach(function(series) {
                var tr = document.createElement('tr');
                tr.style.cursor = 'pointer';
                var posterUrl = series.poster_path ? 'https://image.tmdb.org/t/p/w92' + series.poster_path : './static/images/no-poster.png';
                var episodeCount = 0;
                (series.seasons || []).forEach(function(s) { episodeCount += (s.episodes || []).length; });
                tr.innerHTML =
                    '<td><img src="' + posterUrl + '" class="table-poster" style="width:40px;border-radius:4px;" loading="lazy" onerror="this.src=\'./static/images/no-poster.png\'"></td>' +
                    '<td class="table-title">' + HuntarrUtils.escapeHtml(series.title || '') + '</td>' +
                    '<td>' + (series.seasons || []).length + '</td>' +
                    '<td>' + episodeCount + '</td>' +
                    '<td>' + HuntarrUtils.escapeHtml(series.status || '') + '</td>' +
                    '<td>' + (series.first_air_date || '').substring(0, 4) + '</td>';
                tr.addEventListener('click', function() {
                    if (window.RequestarrTVDetail) {
                        window.RequestarrTVDetail.openDetail({ tmdb_id: series.tmdb_id, id: series.tmdb_id, title: series.title, poster_path: series.poster_path });
                    }
                });
                tbody.appendChild(tr);
            });
        },

        _renderOverviewToContainer: function(listEl, items) {
            var self = this;
            if (!listEl) return;
            listEl.innerHTML = '';
            items.forEach(function(series) {
                var posterUrl = series.poster_path ? 'https://image.tmdb.org/t/p/w92' + series.poster_path : './static/images/no-poster.png';
                var year = (series.first_air_date || '').substring(0, 4);
                var div = document.createElement('div');
                div.className = 'media-overview-item';
                div.style.display = 'flex';
                div.style.alignItems = 'center';
                div.style.gap = '12px';
                div.style.padding = '10px 0';
                div.style.borderBottom = '1px solid rgba(255,255,255,0.06)';
                div.style.cursor = 'pointer';
                div.innerHTML = '<img src="' + posterUrl + '" alt="" style="width:50px;height:75px;object-fit:cover;border-radius:6px;" onerror="this.src=\'./static/images/no-poster.png\'">' +
                    '<div><div style="font-weight:600;color:#e2e8f0;">' + HuntarrUtils.escapeHtml(series.title || '') + '</div>' +
                    '<div style="font-size:0.85rem;color:#94a3b8;">' + year + (series.status ? ' · ' + HuntarrUtils.escapeHtml(series.status) : '') + '</div></div>';
                div.addEventListener('click', function() {
                    if (window.RequestarrTVDetail) {
                        window.RequestarrTVDetail.openDetail({ tmdb_id: series.tmdb_id, id: series.tmdb_id, title: series.title, poster_path: series.poster_path });
                    }
                });
                listEl.appendChild(div);
            });
        },

        _renderPosterView: function(grid, items) {
            var self = this;
            items.forEach(function(series) {
                var card = document.createElement('div');
                card.className = 'media-card';
                card.dataset.tmdbId = series.tmdb_id;
                var posterUrl = series.poster_path
                    ? 'https://image.tmdb.org/t/p/w300' + series.poster_path
                    : './static/images/no-poster.png';
                var title = series.title || 'Unknown';
                var year = (series.first_air_date || '').substring(0, 4);
                var episodeCount = 0;
                var availableCount = 0;
                var seasonCount = (series.seasons || []).length;
                (series.seasons || []).forEach(function(s) {
                    (s.episodes || []).forEach(function(ep) {
                        episodeCount++;
                        if (ep.status === 'available' || ep.file_path) {
                            availableCount++;
                        }
                    });
                });
                var pct = episodeCount > 0 ? Math.round((availableCount / episodeCount) * 100) : 0;
                var barClass = 'episode-progress-bar';
                if (pct >= 100) barClass += ' complete';
                else if (pct === 0) barClass += ' empty';

                card.innerHTML =
                    '<div class="media-poster">' +
                        '<span class="media-type-badge">TV</span>' +
                        '<img src="' + posterUrl + '" alt="' + HuntarrUtils.escapeHtml(title) + '" loading="lazy">' +
                        '<div class="media-overlay">' +
                            '<span style="font-size:0.85em;color:#ddd;">' + seasonCount + ' Season' + (seasonCount !== 1 ? 's' : '') + ' &middot; ' + episodeCount + ' Ep' + (episodeCount !== 1 ? 's' : '') + '</span>' +
                        '</div>' +
                    '</div>' +
                    '<div class="' + barClass + '"' +
                        ' title="' + availableCount + ' / ' + episodeCount + ' episodes (' + pct + '%)">' +
                        '<div class="episode-progress-fill" style="width:' + pct + '%"></div>' +
                    '</div>' +
                    '<div class="media-info">' +
                        '<div class="media-title">' + HuntarrUtils.escapeHtml(title) + '</div>' +
                        '<div class="media-year">' + (year || '') + (series.status ? ' &middot; ' + HuntarrUtils.escapeHtml(series.status) : '') + '</div>' +
                    '</div>';

                card.addEventListener('click', function() {
                    if (window.RequestarrTVDetail) {
                        window.RequestarrTVDetail.openDetail({ tmdb_id: series.tmdb_id, id: series.tmdb_id, title: series.title, poster_path: series.poster_path });
                    }
                });
                grid.appendChild(card);
            });
        },

        // ─── Series Detail View (delegates to RequestarrTVDetail) ───
        openSeriesDetail: function(tmdbId, seriesData) {
            if (window.RequestarrTVDetail) {
                window.RequestarrTVDetail.openDetail({
                    tmdb_id: tmdbId,
                    id: tmdbId,
                    title: (seriesData && (seriesData.title || seriesData.name)) || '',
                    poster_path: (seriesData && seriesData.poster_path) || ''
                });
            }
        }
    };
})();

/**
 * Media Hunt Collection – Movie Hunt + TV Hunt instance dropdowns, combined library view.
 * Only shows Movie Hunt and TV Hunt instances (no Radarr/Sonarr).
 */
(function() {
    'use strict';

    var movieSelectId = 'media-hunt-collection-movie-instance-select';
    var tvSelectId = 'media-hunt-collection-tv-instance-select';

    function hasDualDropdowns() {
        return !!document.getElementById(movieSelectId) && !!document.getElementById(tvSelectId);
    }

    var COLLECTION_PAGE_SIZE = 48;

    function getCollectionPosterUrl(posterPath, size) {
        size = size || 'w500';
        if (!posterPath) return './static/images/blackout.jpg';
        var fullUrl = (posterPath.indexOf('http') === 0) ? posterPath : ('https://image.tmdb.org/t/p/' + size + (posterPath[0] === '/' ? posterPath : '/' + posterPath));
        if (window.tmdbImageCache && window.tmdbImageCache.enabled && window.tmdbImageCache.storage === 'server') {
            return './api/tmdb/image?url=' + encodeURIComponent(fullUrl);
        }
        return fullUrl;
    }

    function applyCollectionCacheToImages(container) {
        if (!container || !window.getCachedTMDBImage || !window.tmdbImageCache || !window.tmdbImageCache.enabled || window.tmdbImageCache.storage !== 'browser') return;
        var imgs = container.querySelectorAll('img[src^="https://image.tmdb.org"]');
        imgs.forEach(function(img) {
            var posterUrlVal = img.getAttribute('src');
            if (!posterUrlVal) return;
            window.getCachedTMDBImage(posterUrlVal, window.tmdbImageCache).then(function(cachedUrl) {
                if (cachedUrl && cachedUrl !== posterUrlVal) img.src = cachedUrl;
            }).catch(function() {});
        });
    }

    window.MediaHuntCollection = {
        _combinedItems: [],
        _combinedTotal: 0,
        _combinedPage: 0,
        _collectionLoading: false,
        _collectionHasMore: false,
        _collectionFetchedAll: false,
        _collectionScrollObserver: null,
        _movieInstanceId: null,
        _tvInstanceId: null,
        sortBy: 'title.asc',
        viewMode: 'posters',
        hiddenMediaSet: new Set(),

        init: function() {
            var hash = window.location.hash || '';
            var tvMatch = hash.match(/media-hunt-collection\/tv\/(\d+)/);
            var pendingTmdbId = tvMatch ? parseInt(tvMatch[1], 10) : null;
            if (!pendingTmdbId && window.TVHuntCollection && typeof window.TVHuntCollection.showMainView === 'function') {
                window.TVHuntCollection.showMainView();
            }
            if (!hasDualDropdowns()) return;
            window._mediaHuntCollectionUnified = true;
            window.TVHuntCollection._prefix = 'media-hunt-collection';
            window.MovieHuntCollection._prefix = 'media-hunt-collection';

            var self = this;
            var movieSelect = document.getElementById(movieSelectId);
            var tvSelect = document.getElementById(tvSelectId);
            if (!movieSelect || !tvSelect) return;

            // Populate dropdowns from Movie Hunt, TV Hunt, and indexers (for step-2 warning) — cache-bust for fresh data on navigate
            var ts = '?_=' + Date.now();
            var moviePromise = fetch('./api/movie-hunt/instances' + ts, { cache: 'no-store' }).then(function(r) { return r.json(); }).then(function(d) { return d.instances || []; }).catch(function() { return []; });
            var tvPromise = fetch('./api/tv-hunt/instances' + ts, { cache: 'no-store' }).then(function(r) { return r.json(); }).then(function(d) { return d.instances || []; }).catch(function() { return []; });
            var indexerPromise = fetch('./api/indexer-hunt/indexers' + ts, { cache: 'no-store' }).then(function(r) { return r.json(); }).then(function(d) { return d.indexers || []; }).catch(function() { return []; });
            var hasClientsPromise = fetch('./api/movie-hunt/has-clients' + ts, { cache: 'no-store' }).then(function(r) { return r.json(); }).then(function(d) { return d.has_clients === true; }).catch(function() { return false; });

            Promise.all([moviePromise, tvPromise, indexerPromise, hasClientsPromise]).then(function(results) {
                var movieInstances = results[0];
                var tvInstances = results[1];
                var indexers = results[2];
                var hasClients = results[3];
                var hasInstances = (movieInstances || []).length > 0 || (tvInstances || []).length > 0;
                var hasIndexers = (indexers || []).length > 0;

                var contentWrapper = document.getElementById('media-hunt-collection-content-wrapper');
                if (contentWrapper) contentWrapper.style.display = '';

                if (pendingTmdbId && window.RequestarrTVDetail) {
                    window.RequestarrTVDetail.openDetail({ tmdb_id: pendingTmdbId, id: pendingTmdbId });
                }

                movieSelect.innerHTML = '';
                movieSelect.appendChild(document.createElement('option')).value = ''; movieSelect.options[0].textContent = 'No Movie Hunt instance';
                (movieInstances || []).forEach(function(inst) {
                    var opt = document.createElement('option');
                    opt.value = String(inst.id);
                    opt.textContent = inst.name || 'Instance ' + inst.id;
                    movieSelect.appendChild(opt);
                });

                tvSelect.innerHTML = '';
                tvSelect.appendChild(document.createElement('option')).value = ''; tvSelect.options[0].textContent = 'No TV Hunt instance';
                (tvInstances || []).forEach(function(inst) {
                    var opt = document.createElement('option');
                    opt.value = String(inst.id);
                    opt.textContent = inst.name || 'Instance ' + inst.id;
                    tvSelect.appendChild(opt);
                });

                // Auto-select first instance when available (fixes "No instances selected" when instances exist)
                if ((movieInstances || []).length > 0) movieSelect.value = String(movieInstances[0].id);
                if ((tvInstances || []).length > 0) tvSelect.value = String(tvInstances[0].id);

                self.setupSort();
                self.setupViewMode();
                self.setupSearch();
                self.loadHiddenMediaIds().then(function() { onInstanceChange(); });
            });

            var onInstanceChange = function() {
                self._movieInstanceId = movieSelect.value ? parseInt(movieSelect.value, 10) : null;
                self._tvInstanceId = tvSelect.value ? parseInt(tvSelect.value, 10) : null;
                // Update backend "current" instance so detail-view API calls (monitor, delete) use correct instance
                if (self._tvInstanceId) {
                    fetch('./api/tv-hunt/instances/current', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ instance_id: self._tvInstanceId })
                    }).catch(function() {});
                }
                if (self._movieInstanceId) {
                    fetch('./api/movie-hunt/instances/current', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ instance_id: self._movieInstanceId })
                    }).catch(function() {});
                }
                self.loadCombinedCollection();
            };
            movieSelect.addEventListener('change', onInstanceChange);
            tvSelect.addEventListener('change', onInstanceChange);

            // Wire TV series detail back button (TVHuntCollection owns the detail view)
            if (window.TVHuntCollection && typeof window.TVHuntCollection.setupBackButton === 'function') {
                window.TVHuntCollection.setupBackButton();
            }
        },

        loadHiddenMediaIds: function() {
            var self = this;
            return fetch('./api/requestarr/hidden-media?page=1&page_size=10000')
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    var items = Array.isArray(data) ? data : (Array.isArray(data.items) ? data.items : []);
                    self.hiddenMediaSet = new Set();
                    items.forEach(function(item) {
                        var key = item.tmdb_id + ':' + item.media_type + ':' + (item.app_type || '') + ':' + (item.instance_name || '');
                        self.hiddenMediaSet.add(key);
                    });
                })
                .catch(function() { self.hiddenMediaSet = new Set(); });
        },

        loadCombinedCollection: function(append) {
            var self = this;
            var grid = document.getElementById('media-hunt-collection-grid');
            if (!grid) return;

            if (!append) {
                grid.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Loading collection...</p></div>';
                grid.style.display = 'flex';
            }

            if (!self._movieInstanceId && !self._tvInstanceId) {
                grid.innerHTML = '<div class="media-hunt-collection-no-instances">' +
                    '<i class="fas fa-cube" aria-hidden="true"></i>' +
                    '<p class="no-instances-title">No instances selected</p>' +
                    '<p class="no-instances-desc">Select a Movie Hunt and/or TV Hunt instance above to view your combined library.</p>' +
                    '<a href="./#media-hunt-instances" class="no-instances-action-btn">' +
                    '<i class="fas fa-cog"></i> Set up instances</a></div>';
                return;
            }

            function filterAndSort(items) {
                var out = items.filter(function(item) {
                    if (!item.tmdb_id || !self.hiddenMediaSet || self.hiddenMediaSet.size === 0) return true;
                    var mt = item.media_type || 'movie';
                    for (var key of self.hiddenMediaSet) {
                        if (key.indexOf(item.tmdb_id + ':' + mt) === 0) return false;
                    }
                    return true;
                });
                out.sort(function(a, b) {
                    var c = (a._sortTitle || '').localeCompare(b._sortTitle || '');
                    if (c !== 0) return self.sortBy === 'title.desc' ? -c : c;
                    return ((a._year || '').localeCompare(b._year || ''));
                });
                return out;
            }

            function processFirstPage(data) {
                var items = data.items || [];
                var total = data.total != null ? data.total : items.length;
                var filtered = filterAndSort(items);
                self._combinedItems = filtered;
                self._combinedTotal = total;
                self._combinedPage = 1;
                self._collectionHasMore = (items.length === COLLECTION_PAGE_SIZE && 1 * COLLECTION_PAGE_SIZE < total);
                self._collectionFetchedAll = false;
                self.renderCombined();
                self.setupCollectionInfiniteScroll();
            }

            function processFallbackFull(combined) {
                var filtered = filterAndSort(combined);
                self._combinedItems = filtered;
                self._combinedTotal = filtered.length;
                self._combinedPage = 1;
                self._collectionHasMore = filtered.length > COLLECTION_PAGE_SIZE;
                self._collectionFetchedAll = true;
                self.renderCombined();
                self.setupCollectionInfiniteScroll();
            }

            function fallbackToLegacyApis() {
                var promises = [];
                if (self._movieInstanceId) {
                    promises.push(fetch('./api/movie-hunt/collection?instance_id=' + self._movieInstanceId + '&page=1&page_size=9999&sort=' + encodeURIComponent(self.sortBy || 'title.asc'))
                        .then(function(r) { return r.json(); })
                        .then(function(d) {
                            return (d.items || []).map(function(m) {
                                m.media_type = 'movie';
                                m._sortTitle = (m.title || '').toLowerCase();
                                m._year = m.year || '';
                                return m;
                            });
                        })
                        .catch(function() { return []; }));
                } else {
                    promises.push(Promise.resolve([]));
                }
                if (self._tvInstanceId) {
                    promises.push(fetch('./api/tv-hunt/collection?instance_id=' + self._tvInstanceId)
                        .then(function(r) { return r.json(); })
                        .then(function(d) {
                            var series = d.series || [];
                            return series.map(function(s) {
                                var title = s.title || s.name || '';
                                var year = (s.first_air_date || '').substring(0, 4);
                                return {
                                    media_type: 'tv',
                                    tmdb_id: s.tmdb_id,
                                    title: title,
                                    name: title,
                                    year: year,
                                    first_air_date: s.first_air_date,
                                    poster_path: s.poster_path,
                                    status: s.status,
                                    seasons: s.seasons,
                                    overview: s.overview,
                                    vote_average: s.vote_average,
                                    _sortTitle: title.toLowerCase(),
                                    _year: year,
                                    _raw: s
                                };
                            });
                        })
                        .catch(function() { return []; }));
                } else {
                    promises.push(Promise.resolve([]));
                }
                Promise.all(promises).then(function(results) {
                    var combined = (results[0] || []).concat(results[1] || []);
                    processFallbackFull(combined);
                });
            }

            if (append) {
                if (self._collectionLoading || !self._collectionHasMore) return;
                self._collectionLoading = true;
                if (self._collectionFetchedAll) {
                    var start = self._combinedPage * COLLECTION_PAGE_SIZE;
                    var slice = self._combinedItems.slice(start, start + COLLECTION_PAGE_SIZE);
                    self._combinedPage++;
                    self._collectionHasMore = (self._combinedPage * COLLECTION_PAGE_SIZE < self._combinedTotal);
                    slice.forEach(function(item) {
                        grid.appendChild(self.createCombinedCard(item));
                    });
                    applyCollectionCacheToImages(grid);
                    self._collectionLoading = false;
                } else {
                    var params = new URLSearchParams();
                    if (self._movieInstanceId) params.set('movie_instance_id', self._movieInstanceId);
                    if (self._tvInstanceId) params.set('tv_instance_id', self._tvInstanceId);
                    params.set('page', String(self._combinedPage + 1));
                    params.set('page_size', String(COLLECTION_PAGE_SIZE));
                    params.set('sort', self.sortBy || 'title.asc');
                    fetch('./api/requestarr/collection?' + params.toString())
                        .then(function(r) { return r.json(); })
                        .then(function(data) {
                            var items = data.items || [];
                            var total = data.total != null ? data.total : 0;
                            var filtered = filterAndSort(items);
                            self._combinedItems = self._combinedItems.concat(filtered);
                            self._combinedPage++;
                            self._collectionHasMore = (self._combinedPage * COLLECTION_PAGE_SIZE < total);
                            filtered.forEach(function(item) {
                                grid.appendChild(self.createCombinedCard(item));
                            });
                            applyCollectionCacheToImages(grid);
                        })
                        .catch(function() {})
                        .then(function() {
                            self._collectionLoading = false;
                        });
                }
                return;
            }

            var params = new URLSearchParams();
            if (self._movieInstanceId) params.set('movie_instance_id', self._movieInstanceId);
            if (self._tvInstanceId) params.set('tv_instance_id', self._tvInstanceId);
            params.set('page', '1');
            params.set('page_size', String(COLLECTION_PAGE_SIZE));
            params.set('sort', self.sortBy || 'title.asc');

            fetch('./api/requestarr/collection?' + params.toString())
                .then(function(r) {
                    if (r.ok) return r.json().then(function(data) { processFirstPage(data); return null; });
                    if (r.status === 404) { fallbackToLegacyApis(); return null; }
                    throw new Error('Failed to load');
                })
                .catch(function() {
                    if (!append) grid.innerHTML = '<p style="color: #ef4444; text-align: center; padding: 60px;">Failed to load collection.</p>';
                });
        },

        setupCollectionInfiniteScroll: function() {
            var self = this;
            var sentinel = document.getElementById('media-hunt-collection-scroll-sentinel');
            var scrollRoot = document.querySelector('.main-content');
            if (!sentinel || self._collectionScrollObserver) return;
            self._collectionScrollObserver = new IntersectionObserver(
                function(entries) {
                    entries.forEach(function(entry) {
                        if (!entry.isIntersecting) return;
                        if (self.viewMode !== 'posters') return;
                        if (self._collectionHasMore && !self._collectionLoading) self.loadCombinedCollection(true);
                    });
                },
                { root: scrollRoot, rootMargin: '200px 0px', threshold: 0 }
            );
            self._collectionScrollObserver.observe(sentinel);
        },

        setupSort: function() {
            var self = this;
            var select = document.getElementById('media-hunt-collection-sort');
            if (!select) return;
            var opts = [
                { v: 'title.asc', t: 'Title (A-Z)' },
                { v: 'title.desc', t: 'Title (Z-A)' },
                { v: 'year.desc', t: 'Year (newest)' },
                { v: 'year.asc', t: 'Year (oldest)' }
            ];
            select.innerHTML = opts.map(function(o) { return '<option value="' + o.v + '">' + o.t + '</option>'; }).join('');
            var saved = HuntarrUtils.getUIPreference('media-hunt-collection-sort', 'title.asc');
            if (saved) select.value = saved;
            self.sortBy = select.value || 'title.asc';
            select.onchange = function() {
                self.sortBy = select.value;
                HuntarrUtils.setUIPreference('media-hunt-collection-sort', self.sortBy);
                self.loadCombinedCollection();
            };
        },

        setupViewMode: function() {
            var self = this;
            var select = document.getElementById('media-hunt-collection-view-mode');
            if (!select) return;
            self.viewMode = HuntarrUtils.getUIPreference('media-hunt-collection-view', 'posters') || 'posters';
            select.value = self.viewMode;
            select.onchange = function() {
                self.viewMode = select.value;
                HuntarrUtils.setUIPreference('media-hunt-collection-view', self.viewMode);
                self.renderCombined();
            };
        },

        setupSearch: function() {
            var self = this;
            var input = document.getElementById('media-hunt-collection-search-input');
            if (!input) return;
            input.value = '';
            input.addEventListener('input', function() {
                if (self._searchTm) clearTimeout(self._searchTm);
                var q = (input.value || '').trim();
                self._searchTm = setTimeout(function() {
                    if (!q) {
                        document.getElementById('media-hunt-collection-search-results-view').style.display = 'none';
                        document.getElementById('media-hunt-collection-main-content').style.display = 'block';
                        self.renderCombined();
                        return;
                    }
                    self.performSearch(q);
                }, 300);
            });
        },

        performSearch: function(query) {
            // Simplified: filter combined items client-side
            var q = (query || '').toLowerCase();
            var filtered = this._combinedItems.filter(function(item) {
                var t = (item.title || item.name || '').toLowerCase();
                return t.indexOf(q) !== -1;
            });
            var grid = document.getElementById('media-hunt-collection-search-results-grid');
            var resultsView = document.getElementById('media-hunt-collection-search-results-view');
            var mainContent = document.getElementById('media-hunt-collection-main-content');
            if (!grid) return;
            resultsView.style.display = 'block';
            mainContent.style.display = 'none';
            grid.innerHTML = '';
            if (filtered.length === 0) {
                grid.innerHTML = '<p style="color:#888;text-align:center;padding:40px;">No results for "' + (query || '').replace(/</g, '&lt;') + '"</p>';
                return;
            }
            filtered.forEach(function(item) {
                grid.appendChild(this.createCombinedCard(item));
            }.bind(this));
            applyCollectionCacheToImages(grid);
        },

        renderCombined: function() {
            var self = this;
            var grid = document.getElementById('media-hunt-collection-grid');
            var table = document.getElementById('media-hunt-collection-table');
            var tableBody = document.getElementById('media-hunt-collection-table-body');
            var overview = document.getElementById('media-hunt-collection-overview');
            var overviewList = document.getElementById('media-hunt-collection-overview-list');
            if (!grid) return;

            if (table) table.style.display = 'none';
            if (overview) overview.style.display = 'none';
            grid.style.display = 'grid';
            grid.innerHTML = '';

            var items = self._combinedItems || [];
            if (self.sortBy === 'year.desc') items = items.slice().sort(function(a, b) { return (b._year || '').localeCompare(a._year || ''); });
            else if (self.sortBy === 'year.asc') items = items.slice().sort(function(a, b) { return (a._year || '').localeCompare(b._year || ''); });
            else if (self.sortBy === 'title.desc') items = items.slice().sort(function(a, b) { return (b._sortTitle || '').localeCompare(a._sortTitle || ''); });
            else items = items.slice().sort(function(a, b) { return (a._sortTitle || '').localeCompare(b._sortTitle || ''); });

            if (self.viewMode === 'table' || self.viewMode === 'overview') {
                if (!self._collectionFetchedAll && items.length < self._combinedTotal && self._combinedTotal > 0) {
                    var params = new URLSearchParams();
                    if (self._movieInstanceId) params.set('movie_instance_id', self._movieInstanceId);
                    if (self._tvInstanceId) params.set('tv_instance_id', self._tvInstanceId);
                    params.set('page', '1');
                    params.set('page_size', String(Math.min(10000, self._combinedTotal)));
                    params.set('sort', self.sortBy || 'title.asc');
                    fetch('./api/requestarr/collection?' + params.toString())
                        .then(function(r) { return r.json(); })
                        .then(function(data) {
                            var raw = data.items || [];
                            var filtered = raw.filter(function(item) {
                                if (!item.tmdb_id || !self.hiddenMediaSet || self.hiddenMediaSet.size === 0) return true;
                                var mt = item.media_type || 'movie';
                                for (var key of self.hiddenMediaSet) {
                                    if (key.indexOf(item.tmdb_id + ':' + mt) === 0) return false;
                                }
                                return true;
                            });
                            filtered.sort(function(a, b) {
                                var c = (a._sortTitle || '').localeCompare(b._sortTitle || '');
                                if (c !== 0) return self.sortBy === 'title.desc' ? -c : c;
                                return ((a._year || '').localeCompare(b._year || ''));
                            });
                            self._combinedItems = filtered;
                            self._combinedTotal = filtered.length;
                            self._collectionFetchedAll = true;
                            self.renderCombined();
                        })
                        .catch(function() {
                            self.renderCombined();
                        });
                    return;
                }
            }

            if (self.viewMode === 'posters' && self._collectionFetchedAll) {
                items = items.slice(0, self._combinedPage * COLLECTION_PAGE_SIZE);
            }

            if (items.length === 0) {
                grid.style.display = 'flex';
                grid.style.alignItems = 'center';
                grid.style.justifyContent = 'center';
                grid.innerHTML = '<div style="text-align:center;color:#9ca3af;"><i class="fas fa-inbox" style="font-size:48px;opacity:0.4;margin-bottom:16px;display:block;"></i><p>No items in collection</p></div>';
                return;
            }

            function posterUrl(size) {
                return function(item) {
                    return item.poster_path ? getCollectionPosterUrl(item.poster_path, size) : './static/images/blackout.jpg';
                };
            }

            if (self.viewMode === 'table' && table && tableBody) {
                table.style.display = 'block';
                grid.style.display = 'none';
                tableBody.innerHTML = '';
                items.forEach(function(item) {
                    var tr = document.createElement('tr');
                    var title = (item.title || item.name || '').replace(/</g, '&lt;');
                    var year = item.year || item._year || '-';
                    var typeLabel = item.media_type === 'tv' ? 'TV' : 'Movie';
                    tr.innerHTML = '<td><img src="' + posterUrl('w92')(item) + '" class="table-poster" loading="lazy" onerror="this.src=\'./static/images/blackout.jpg\'"></td><td>' + title + '</td><td>' + year + '</td><td>' + typeLabel + '</td>';
                    tr.style.cursor = 'pointer';
                    tr.onclick = function() { self.onCardClick(item); };
                    tableBody.appendChild(tr);
                });
                applyCollectionCacheToImages(table);
            } else if (self.viewMode === 'overview' && overview && overviewList) {
                overview.style.display = 'block';
                grid.style.display = 'none';
                overviewList.innerHTML = '';
                items.forEach(function(item) {
                    var div = document.createElement('div');
                    div.className = 'media-overview-item';
                    var title = (item.title || item.name || '').replace(/</g, '&lt;');
                    var year = item.year || item._year || '-';
                    var typeLabel = item.media_type === 'tv' ? 'TV' : 'Movie';
                    div.innerHTML = '<div class="media-overview-poster"><img src="' + posterUrl('w200')(item) + '" loading="lazy" onerror="this.src=\'./static/images/blackout.jpg\'"></div><div class="media-overview-details"><div class="media-overview-title">' + title + ' <span class="media-overview-year">(' + year + ') · ' + typeLabel + '</span></div></div>';
                    div.style.cursor = 'pointer';
                    div.onclick = function() { self.onCardClick(item); };
                    overviewList.appendChild(div);
                });
                applyCollectionCacheToImages(overview);
            } else {
                items.forEach(function(item) {
                    grid.appendChild(self.createCombinedCard(item));
                });
                applyCollectionCacheToImages(grid);
            }
        },

        createCombinedCard: function(item) {
            var self = this;
            var card = document.createElement('div');
            card.className = 'media-card';
            var title = (item.title || item.name || '').replace(/</g, '&lt;').replace(/"/g, '&quot;');
            var year = item.year || item._year || 'N/A';
            var posterUrl = getCollectionPosterUrl(item.poster_path, 'w500');
            var typeBadgeLabel = item.media_type === 'tv' ? 'TV' : 'Movie';
            var status = item.status || (item.media_type === 'movie' ? (item.in_library ? 'available' : 'requested') : '');
            var statusClass = status === 'available' ? 'complete' : 'partial';
            var statusIcon = status === 'available' ? 'check' : 'bookmark';
            if (status === 'available') card.classList.add('in-library');

            // Progress bar for combined view
            var combPct = 0;
            var combTotal = 0;
            var combAvail = 0;
            if (item.media_type === 'tv' && item.seasons) {
                (item.seasons || []).forEach(function(s) {
                    (s.episodes || []).forEach(function(ep) {
                        combTotal++;
                        if (ep.status === 'available' || ep.file_path) combAvail++;
                    });
                });
                combPct = combTotal > 0 ? Math.round((combAvail / combTotal) * 100) : 0;
            } else {
                combPct = status === 'available' ? 100 : 0;
            }
            var combBarClass = 'episode-progress-bar' + (combPct >= 100 ? ' complete' : (combPct === 0 ? ' empty' : ''));

            card.innerHTML = '<div class="media-card-poster">' +
                '<div class="media-card-status-badge ' + statusClass + '"><i class="fas fa-' + statusIcon + '"></i></div>' +
                '<span class="media-type-badge">' + typeBadgeLabel + '</span>' +
                '<img src="' + posterUrl + '" alt="' + title + '" loading="lazy" onerror="this.src=\'./static/images/blackout.jpg\'">' +
                '<div class="media-card-overlay"><div class="media-card-overlay-title">' + title + '</div><div class="media-card-overlay-content"><div class="media-card-overlay-year">' + year + '</div></div></div>' +
                '</div>' +
                '<div class="' + combBarClass + '"' + (item.media_type === 'tv' ? ' title="' + combAvail + ' / ' + combTotal + ' episodes (' + combPct + '%)"' : '') + '>' +
                '<div class="episode-progress-fill" style="width:' + combPct + '%"></div>' +
                '</div>' +
                '<div class="media-card-info"><div class="media-card-title" title="' + title + '">' + title + '</div><div class="media-card-meta"><span class="media-card-year">' + year + '</span> <span style="font-size:10px;opacity:0.8;">' + typeBadgeLabel + '</span></div></div>';
            card.style.cursor = 'pointer';
            card.onclick = function(e) {
                if (e.target.closest('.media-card-delete-btn')) return;
                self.onCardClick(item);
            };
            return card;
        },

        onCardClick: function(item) {
            if (item.media_type === 'tv' && window.RequestarrTVDetail) {
                window.RequestarrTVDetail.openDetail({ tmdb_id: item.tmdb_id, id: item.tmdb_id, title: item.title, poster_path: item.poster_path });
            } else if (item.media_type === 'movie' && window.RequestarrDetail) {
                window.RequestarrDetail.openDetail({
                    tmdb_id: item.tmdb_id,
                    id: item.tmdb_id,
                    title: item.title,
                    year: item.year,
                    poster_path: item.poster_path,
                    in_library: item.status === 'available'
                });
            }
        },

        showMainView: function() {
            var r = document.getElementById('media-hunt-collection-search-results-view');
            var m = document.getElementById('media-hunt-collection-main-content');
            var d = document.getElementById('media-hunt-collection-series-detail-view');
            if (r) r.style.display = 'none';
            if (d) d.style.display = 'none';
            if (m) m.style.display = 'block';
        },
        openSeriesDetail: function(tmdbId, seriesData) {
            if (window.RequestarrTVDetail) {
                window.RequestarrTVDetail.openDetail({ tmdb_id: tmdbId, id: tmdbId, title: (seriesData && seriesData.title) || '', poster_path: (seriesData && seriesData.poster_path) || '' });
            }
        }
    };
})();


/* === modules/features/media-hunt-calendar.js === */
/**
 * Media Hunt Calendar – Movie Hunt, Radarr, TV Hunt, Sonarr.
 * Unified dropdown; mode (movie/tv) derived from selected instance.
 */
(function() {
    'use strict';

    var TMDB_IMG = 'https://image.tmdb.org/t/p/w92';
    var FALLBACK_POSTER = './static/images/blackout.jpg';
    var DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    var _initialized = false;
    var _currentTab = 'collection';
    var _collectionLoaded = false;
    var _upcomingLoaded = false;

    function parseInstanceValue(val) {
        if (!val) return { appType: '', instance: '' };
        var idx = val.indexOf(':');
        if (idx === -1) return { appType: '', instance: val };
        return { appType: val.substring(0, idx), instance: val.substring(idx + 1) };
    }

    function getMode() {
        var val = getInstanceValue();
        var p = parseInstanceValue(val);
        return (p.appType === 'tv_hunt' || p.appType === 'sonarr') ? 'tv' : 'movie';
    }

    function getInstanceValue() {
        var sel = document.getElementById('media-hunt-calendar-instance-select');
        return (sel && sel.value) ? sel.value : '';
    }

    function getInstanceId() {
        return getInstanceValue();
    }

    function daysPastForCurrentMonth() {
        var now = new Date();
        return now.getDate() - 1;
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function formatDateBadge(dateStr) {
        if (!dateStr) return null;
        var d = new Date(dateStr + 'T00:00:00');
        if (isNaN(d.getTime())) return null;
        var today = new Date();
        today.setHours(0, 0, 0, 0);
        return {
            day: DAY_NAMES[d.getDay()],
            num: d.getDate(),
            month: MONTH_NAMES[d.getMonth()],
            year: d.getFullYear(),
            isToday: d.getTime() === today.getTime(),
            isPast: d < today,
        };
    }

    function posterUrl(path) {
        if (!path) return FALLBACK_POSTER;
        if (path.startsWith('http')) return path;
        return TMDB_IMG + path;
    }

    function formatAvailability(val) {
        if (val === 'inCinemas') return 'In Cinemas';
        if (val === 'released') return 'Released';
        if (val === 'announced') return 'Announced';
        return val;
    }

    /* ── Movie event card ───────────────────────────────────── */

    function renderMovieEventCard(ev) {
        var poster = posterUrl(ev.poster_path);
        var typeClass = ev.event_type || 'unknown';
        var typeLabel = ev.event_label || 'Unknown';
        var statusHtml = '';
        if (ev.status) {
            var sClass = ev.status === 'available' ? 'available' : 'requested';
            statusHtml = '<span class="mh-cal-event-status ' + sClass + '">' + ev.status + '</span>';
        }
        var yearStr = ev.year ? ' (' + ev.year + ')' : '';
        var isTmdbUrl = poster && !poster.includes('./static/images/');
        if (isTmdbUrl && window.tmdbImageCache && window.tmdbImageCache.enabled && window.tmdbImageCache.storage === 'server') {
            poster = './api/tmdb/image?url=' + encodeURIComponent(poster);
        }
        return '<div class="mh-cal-event" data-tmdb-poster="' + (isTmdbUrl ? posterUrl(ev.poster_path) : '') + '">' +
            '<div class="mh-cal-event-poster"><img src="' + poster + '" alt="" onerror="this.src=\'' + FALLBACK_POSTER + '\'"></div>' +
            '<div class="mh-cal-event-info">' +
            '<div class="mh-cal-event-title">' + escapeHtml(ev.title) + yearStr + '</div>' +
            '<div class="mh-cal-event-meta">' +
            '<span class="mh-cal-event-type ' + typeClass + '">' + escapeHtml(typeLabel) + '</span>' +
            statusHtml +
            (ev.minimum_availability ? '<span class="mh-cal-event-avail">Min: ' + formatAvailability(ev.minimum_availability) + '</span>' : '') +
            '</div></div></div>';
    }

    /* ── TV episode card ─────────────────────────────────────── */

    function renderEpisodeCard(ep) {
        var poster = posterUrl(ep.poster_path || ep.series_poster);
        var statusClass = ep.status === 'available' ? 'available' : (ep.status === 'missing' ? 'missing' : '');
        var statusHtml = ep.status ? '<span class="mh-cal-event-status ' + statusClass + '">' + ep.status + '</span>' : '';
        var epLabel = 'S' + String(ep.season_number || 0).padStart(2, '0') + 'E' + String(ep.episode_number || 0).padStart(2, '0');
        return '<div class="mh-cal-event">' +
            '<div class="mh-cal-event-poster"><img src="' + poster + '" alt="" onerror="this.src=\'' + FALLBACK_POSTER + '\'"></div>' +
            '<div class="mh-cal-event-info">' +
            '<div class="mh-cal-event-title">' + escapeHtml(ep.series_title || '') + '</div>' +
            '<div class="mh-cal-event-meta">' +
            '<span class="mh-cal-event-type inCinemas">' + epLabel + '</span>' +
            '<span style="color:#94a3b8;font-size:0.85em;">' + escapeHtml(ep.title || '') + '</span>' +
            statusHtml + '</div></div></div>';
    }

    function renderDateGroup(dateStr, events, isMovie) {
        var badge = formatDateBadge(dateStr);
        if (!badge) return '';
        var todayClass = badge.isToday ? ' today' : '';
        var html = '<div class="mh-cal-date-group">' +
            '<div class="mh-cal-date-header">' +
            '<div class="mh-cal-date-badge' + todayClass + '">' +
            '<span class="mh-cal-date-day">' + badge.day + '</span><span class="mh-cal-date-num">' + badge.num + '</span></div>' +
            '<span class="mh-cal-date-month-year">' + badge.month + ' ' + badge.year + '</span>' +
            '<div class="mh-cal-date-line"></div></div><div class="mh-cal-events">';
        for (var i = 0; i < events.length; i++) {
            html += isMovie ? renderMovieEventCard(events[i]) : renderEpisodeCard(events[i]);
        }
        html += '</div></div>';
        return html;
    }

    function applyCacheToImages(container) {
        if (!window.getCachedTMDBImage || !window.tmdbImageCache || !window.tmdbImageCache.enabled || window.tmdbImageCache.storage !== 'browser') return;
        var events = container.querySelectorAll('.mh-cal-event[data-tmdb-poster]');
        events.forEach(function(el) {
            var posterUrlVal = el.getAttribute('data-tmdb-poster');
            if (!posterUrlVal) return;
            var img = el.querySelector('.mh-cal-event-poster img');
            if (!img) return;
            window.getCachedTMDBImage(posterUrlVal, window.tmdbImageCache).then(function(cachedUrl) {
                if (cachedUrl && cachedUrl !== posterUrlVal) img.src = cachedUrl;
            }).catch(function() {});
        });
    }

    /* ── Movie: collection tab ──────────────────────────────── */

    function loadCollectionCalendar() {
        var container = document.getElementById('media-hunt-calendar-timeline');
        if (!container) return;
        container.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Loading calendar...</p></div>';

        var val = getInstanceValue();
        var p = parseInstanceValue(val);
        var pastDays = daysPastForCurrentMonth();
        var url;

        if (p.appType === 'movie_hunt' && p.instance) {
            url = './api/movie-hunt/calendar?days_past=' + pastDays + '&days_future=120&instance_id=' + encodeURIComponent(p.instance);
        } else if (p.appType === 'radarr' && p.instance) {
            url = './api/calendar?app_type=radarr&instance=' + encodeURIComponent(p.instance) + '&days_past=' + pastDays + '&days_future=120';
        } else {
            container.innerHTML = '<div class="mh-cal-empty"><i class="fas fa-calendar-times"></i><p>Select a Movie Hunt or Radarr instance.</p></div>';
            return;
        }

        fetch(url)
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (!data.success || !data.events || data.events.length === 0) {
                    container.innerHTML = '<div class="mh-cal-empty"><i class="fas fa-calendar-times"></i><p>No upcoming releases in your collection.<br>Add movies to your collection to see their release dates here.</p></div>';
                    return;
                }
                var dated = [], tba = [];
                for (var i = 0; i < data.events.length; i++) {
                    var ev = data.events[i];
                    if (ev.date) dated.push(ev); else tba.push(ev);
                }
                var groups = {}, dateOrder = [];
                for (var j = 0; j < dated.length; j++) {
                    var d = dated[j].date;
                    if (!groups[d]) { groups[d] = []; dateOrder.push(d); }
                    groups[d].push(dated[j]);
                }
                dateOrder.sort();
                var html = '';
                for (var m = 0; m < dateOrder.length; m++) html += renderDateGroup(dateOrder[m], groups[dateOrder[m]], true);
                if (tba.length > 0) {
                    html += '<div class="mh-cal-tba-section"><div class="mh-cal-tba-header"><i class="fas fa-question-circle"></i> Date TBA (' + tba.length + ' movie' + (tba.length > 1 ? 's' : '') + ')</div><div class="mh-cal-tba-events">';
                    for (var n = 0; n < tba.length; n++) html += renderMovieEventCard(tba[n]);
                    html += '</div></div>';
                }
                container.innerHTML = html;
                applyCacheToImages(container);
                _collectionLoaded = true;
            })
            .catch(function() {
                container.innerHTML = '<div class="mh-cal-empty"><i class="fas fa-exclamation-triangle"></i><p>Failed to load calendar data.</p></div>';
            });
    }

    /* ── Movie: upcoming tab ────────────────────────────────── */

    function loadUpcomingCalendar() {
        var container = document.getElementById('media-hunt-calendar-upcoming-timeline');
        if (!container) return;
        container.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Loading upcoming movies...</p></div>';

        fetch('./api/movie-hunt/calendar/upcoming?page=1')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (!data.success || !data.movies || data.movies.length === 0) {
                    container.innerHTML = '<div class="mh-cal-empty"><i class="fas fa-film"></i><p>No upcoming movies found.</p></div>';
                    return;
                }
                var groups = {}, dateOrder = [];
                for (var i = 0; i < data.movies.length; i++) {
                    var m = data.movies[i];
                    var d = m.release_date || '';
                    if (!d) continue;
                    if (!groups[d]) { groups[d] = []; dateOrder.push(d); }
                    groups[d].push({
                        title: m.title,
                        year: m.year,
                        poster_path: m.poster_path,
                        event_type: 'inCinemas',
                        event_label: 'Theatrical Release',
                        status: '',
                        minimum_availability: '',
                    });
                }
                dateOrder.sort();
                var html = '';
                for (var j = 0; j < dateOrder.length; j++) html += renderDateGroup(dateOrder[j], groups[dateOrder[j]], true);
                container.innerHTML = html;
                applyCacheToImages(container);
                _upcomingLoaded = true;
            })
            .catch(function() {
                container.innerHTML = '<div class="mh-cal-empty"><i class="fas fa-exclamation-triangle"></i><p>Failed to load upcoming movies.</p></div>';
            });
    }

    /* ── TV: single calendar from collection ─────────────────── */

    function loadTVCalendar() {
        var container = document.getElementById('media-hunt-calendar-timeline');
        if (!container) return;
        container.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Loading calendar...</p></div>';

        var val = getInstanceValue();
        var p = parseInstanceValue(val);
        if (!p.appType || !p.instance) {
            container.innerHTML = '<div class="mh-cal-empty"><i class="fas fa-calendar-times"></i><p>Select a TV Hunt or Sonarr instance to view the calendar.</p></div>';
            return;
        }

        if (p.appType === 'sonarr') {
            var pastDays = daysPastForCurrentMonth();
            fetch('./api/calendar?app_type=sonarr&instance=' + encodeURIComponent(p.instance) + '&days_past=' + pastDays + '&days_future=120')
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    var rawEvents = (data.events || []);
                    if (rawEvents.length === 0) {
                        container.innerHTML = '<div class="mh-cal-empty"><i class="fas fa-calendar-times"></i><p>No upcoming episodes in your Sonarr library.<br>Add TV shows to see episode air dates here.</p></div>';
                        return;
                    }
                    var groups = {}, dateOrder = [];
                    rawEvents.forEach(function(ev) {
                        var d = ev.date || '';
                        if (!groups[d]) { groups[d] = []; dateOrder.push(d); }
                        groups[d].push(ev);
                    });
                    dateOrder.sort();
                    var html = '';
                    dateOrder.forEach(function(d) { html += renderDateGroup(d, groups[d], false); });
                    container.innerHTML = html;
                })
                .catch(function() {
                    container.innerHTML = '<div class="mh-cal-empty"><i class="fas fa-exclamation-triangle"></i><p>Failed to load calendar data.</p></div>';
                });
            return;
        }

        fetch('./api/tv-hunt/collection?instance_id=' + p.instance)
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var series = data.series || [];
                var events = [];
                var now = new Date();
                var pastLimit = new Date();
                pastLimit.setDate(pastLimit.getDate() - 7);
                var futureLimit = new Date();
                futureLimit.setDate(futureLimit.getDate() + 90);

                series.forEach(function(s) {
                    (s.seasons || []).forEach(function(season) {
                        (season.episodes || []).forEach(function(ep) {
                            if (!ep.air_date) return;
                            var airDate = new Date(ep.air_date);
                            if (airDate < pastLimit || airDate > futureLimit) return;
                            events.push({
                                date: ep.air_date,
                                series_title: s.title,
                                series_poster: s.poster_path,
                                title: ep.title || ('Episode ' + ep.episode_number),
                                season_number: season.season_number,
                                episode_number: ep.episode_number,
                                status: ep.status || (airDate > now ? 'unaired' : 'missing'),
                                poster_path: s.poster_path,
                            });
                        });
                    });
                });

                if (events.length === 0) {
                    container.innerHTML = '<div class="mh-cal-empty"><i class="fas fa-calendar-times"></i><p>No upcoming episodes in your TV collection.<br>Add TV shows to see episode air dates here.</p></div>';
                    return;
                }
                var groups = {}, dateOrder = [];
                events.forEach(function(ev) {
                    if (!groups[ev.date]) { groups[ev.date] = []; dateOrder.push(ev.date); }
                    groups[ev.date].push(ev);
                });
                dateOrder.sort();
                var html = '';
                dateOrder.forEach(function(d) { html += renderDateGroup(d, groups[d], false); });
                container.innerHTML = html;
            })
            .catch(function() {
                container.innerHTML = '<div class="mh-cal-empty"><i class="fas fa-exclamation-triangle"></i><p>Failed to load calendar data.</p></div>';
            });
    }

    /* ── Tab switching (movie only) ──────────────────────────── */

    function switchTab(tab) {
        _currentTab = tab;
        var collView = document.getElementById('media-hunt-calendar-collection-view');
        var upView = document.getElementById('media-hunt-calendar-upcoming-view');
        var tabs = document.querySelectorAll('#mediaHuntCalendarSection .mh-calendar-tab');
        for (var i = 0; i < tabs.length; i++) {
            tabs[i].classList.toggle('active', tabs[i].getAttribute('data-tab') === tab);
        }
        if (tab === 'collection') {
            if (collView) collView.style.display = 'block';
            if (upView) upView.style.display = 'none';
            if (!_collectionLoaded) loadCollectionCalendar();
        } else {
            if (collView) collView.style.display = 'none';
            if (upView) upView.style.display = 'block';
            if (!_upcomingLoaded) loadUpcomingCalendar();
        }
    }

    function updateUIForMode(mode) {
        var titleEl = document.getElementById('media-hunt-calendar-title');
        var tabsWrap = document.getElementById('media-hunt-calendar-tabs-wrap');
        var legendEl = document.getElementById('media-hunt-calendar-legend');
        var upcomingView = document.getElementById('media-hunt-calendar-upcoming-view');
        if (titleEl) titleEl.innerHTML = (mode === 'movie' ? '<i class="fas fa-calendar-alt"></i> Upcoming Releases' : '<i class="fas fa-calendar-alt"></i> TV Calendar');
        if (tabsWrap) tabsWrap.style.display = (mode === 'movie') ? 'flex' : 'none';
        if (legendEl) legendEl.style.display = (mode === 'movie') ? 'flex' : 'none';
        if (upcomingView) upcomingView.style.display = 'none';
    }

    function safeJsonFetch(url, fallback) {
        return fetch(url, { cache: 'no-store' }).then(function(r) { return r.json(); }).catch(function() { return fallback || {}; });
    }

    function populateInstanceDropdown() {
        var sel = document.getElementById('media-hunt-calendar-instance-select');
        if (!sel) return;
        sel.innerHTML = '<option value="">Loading instances...</option>';
        var ts = Date.now();
        Promise.all([
            safeJsonFetch('./api/requestarr/instances/movie_hunt?t=' + ts, { instances: [] }),
            safeJsonFetch('./api/requestarr/instances/radarr?t=' + ts, { instances: [] }),
            safeJsonFetch('./api/requestarr/instances/tv_hunt?t=' + ts, { instances: [] }),
            safeJsonFetch('./api/requestarr/instances/sonarr?t=' + ts, { instances: [] }),
            safeJsonFetch('./api/indexer-hunt/indexers?t=' + ts, { indexers: [] }),
            safeJsonFetch('./api/movie-hunt/has-clients?t=' + ts, { has_clients: false })
        ]).then(function(results) {
            var mh = results[0].instances || [];
            var radarr = results[1].instances || [];
            var tvh = results[2].instances || [];
            var sonarr = results[3].instances || [];
            sel.innerHTML = '';
            var defaultMode = (window._mediaHuntCalendarMode || 'movie').toLowerCase();
            var preferred = null;
            mh.forEach(function(inst) {
                var v = 'movie_hunt:' + (inst.id != null ? inst.id : inst.name);
                var opt = document.createElement('option');
                opt.value = v;
                opt.textContent = 'Movie Hunt \u2013 ' + (inst.name || inst.id);
                sel.appendChild(opt);
                if (!preferred && defaultMode === 'movie') preferred = v;
            });
            radarr.forEach(function(inst) {
                var v = 'radarr:' + (inst.name || '');
                var opt = document.createElement('option');
                opt.value = v;
                opt.textContent = 'Radarr \u2013 ' + (inst.name || '');
                sel.appendChild(opt);
                if (!preferred && defaultMode === 'movie') preferred = v;
            });
            tvh.forEach(function(inst) {
                var v = 'tv_hunt:' + (inst.id != null ? inst.id : inst.name);
                var opt = document.createElement('option');
                opt.value = v;
                opt.textContent = 'TV Hunt \u2013 ' + (inst.name || inst.id);
                sel.appendChild(opt);
                if (!preferred && defaultMode === 'tv') preferred = v;
            });
            sonarr.forEach(function(inst) {
                var v = 'sonarr:' + (inst.name || '');
                var opt = document.createElement('option');
                opt.value = v;
                opt.textContent = 'Sonarr \u2013 ' + (inst.name || '');
                sel.appendChild(opt);
                if (!preferred && defaultMode === 'tv') preferred = v;
            });
            if (sel.options.length === 0) {
                var empty = document.createElement('option');
                empty.value = '';
                empty.textContent = 'No instances configured';
                sel.appendChild(empty);
                _collectionLoaded = false;
                _upcomingLoaded = false;
                return;
            }
            if (preferred) {
                sel.value = preferred;
            } else {
                sel.selectedIndex = 0;
            }
            _collectionLoaded = false;
            _upcomingLoaded = false;
            var mode = getMode();
            updateUIForMode(mode);
            if (mode === 'movie') {
                if (_currentTab === 'collection') loadCollectionCalendar();
                else loadUpcomingCalendar();
            } else {
                loadTVCalendar();
            }
        }).catch(function() {
            sel.innerHTML = '<option value="">Failed to load instances</option>';
        });
    }

    /* ── Init ────────────────────────────────────────────────── */

    function init() {
        var sel = document.getElementById('media-hunt-calendar-instance-select');
        if (!sel) return;
        populateInstanceDropdown();
        updateUIForMode(getMode());

        var onSelectChange = function() {
            _collectionLoaded = false;
            _upcomingLoaded = false;
            var mode = getMode();
            updateUIForMode(mode);
            if (mode === 'movie') {
                if (_currentTab === 'collection') loadCollectionCalendar();
                else loadUpcomingCalendar();
            } else {
                loadTVCalendar();
            }
        };

        sel.addEventListener('change', onSelectChange);

        if (!_initialized) {
            _initialized = true;
            var tabs = document.querySelectorAll('#mediaHuntCalendarSection .mh-calendar-tab');
            for (var i = 0; i < tabs.length; i++) {
                tabs[i].addEventListener('click', function() {
                    switchTab(this.getAttribute('data-tab'));
                });
            }
        }

        _collectionLoaded = false;
        _upcomingLoaded = false;
    }

    document.addEventListener('huntarr:instances-changed', function() { populateInstanceDropdown(); });
    document.addEventListener('huntarr:tv-hunt-instances-changed', function() { populateInstanceDropdown(); });

    window.MediaHuntCalendar = {
        init: init,
        refresh: function() {
            var mode = getMode();
            _collectionLoaded = false;
            _upcomingLoaded = false;
            if (mode === 'movie') {
                if (_currentTab === 'collection') loadCollectionCalendar();
                else loadUpcomingCalendar();
            } else {
                loadTVCalendar();
            }
        }
    };
})();


/* === modules/features/settings/media-hunt-custom-formats.js === */
/**
 * Media Hunt – Custom Formats for TV (Sonarr-style JSON). Pre-Format (dropdown) or Import (paste JSON).
 * File: media-hunt-custom-formats.js. Uses /api/tv-hunt/ endpoints; DOM IDs remain tv-hunt-* for compatibility.
 */
(function() {
    'use strict';

    window.TVHuntCustomFormats = {
        _list: [],
        _editingIndex: null,
        _modalMode: null,
        _instanceDropdownAttached: false,

        refreshList: function() {
            if (window.TVHuntInstanceDropdown && document.getElementById('tv-hunt-settings-custom-formats-instance-select') && !window.TVHuntCustomFormats._instanceDropdownAttached) {
                window.TVHuntInstanceDropdown.attach('tv-hunt-settings-custom-formats-instance-select', function() { window.TVHuntCustomFormats.refreshList(); });
                window.TVHuntCustomFormats._instanceDropdownAttached = true;
            }
            var preformattedGrid = document.getElementById('tv-hunt-custom-formats-preformatted-grid');
            var importedGrid = document.getElementById('tv-hunt-custom-formats-imported-grid');
            if (!preformattedGrid || !importedGrid) return;
            
            fetch('./api/tv-hunt/custom-formats')
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    var list = (data && data.custom_formats) ? data.custom_formats : [];
                    window.TVHuntCustomFormats._list = list;
                    
                    var preformattedByGroup = {};
                    var importedItems = [];
                    var preformattedCount = 0;
                    var importedCount = 0;
                    
                    for (var i = 0; i < list.length; i++) {
                        var item = list[i];
                        var isPreformatted = (item.source || 'import').toLowerCase() === 'preformat';
                        
                        if (isPreformatted) {
                            var preformatId = item.preformat_id || '';
                            var groupKey = window.TVHuntCustomFormats._getGroupFromPreformatId(preformatId);
                            if (!preformattedByGroup[groupKey]) {
                                preformattedByGroup[groupKey] = [];
                            }
                            preformattedByGroup[groupKey].push({item: item, index: i});
                            preformattedCount++;
                        } else {
                            importedItems.push({item: item, index: i});
                            importedCount++;
                        }
                    }
                    
                    var preformattedHtml = '';
                    var sortedGroups = Object.keys(preformattedByGroup).sort();
                    
                    for (var g = 0; g < sortedGroups.length; g++) {
                        var groupKey = sortedGroups[g];
                        var groupItems = preformattedByGroup[groupKey];
                        var groupName = window.TVHuntCustomFormats._formatGroupName(groupKey);
                        
                        preformattedHtml += '<div class="custom-formats-group-header">' +
                            '<i class="fas fa-folder-open"></i> ' + groupName +
                            '</div>';
                        
                        for (var j = 0; j < groupItems.length; j++) {
                            var entry = groupItems[j];
                            var item = entry.item;
                            var idx = entry.index;
                            var title = (item.title || item.name || 'Unnamed').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                            
                            preformattedHtml += '<div class="custom-format-card instance-card" data-index="' + idx + '" data-app-type="tv-hunt-custom-format">' +
                                '<div class="custom-format-card-header">' +
                                '<div class="custom-format-card-title"><i class="fas fa-code"></i><span>' + title + '</span></div>' +
                                '</div>' +
                                '<div class="custom-format-card-footer">' +
                                '<button type="button" class="btn-card view" data-index="' + idx + '"><i class="fas fa-eye"></i> JSON</button>' +
                                '<button type="button" class="btn-card delete" data-index="' + idx + '"><i class="fas fa-trash"></i> Delete</button>' +
                                '</div></div>';
                        }
                    }
                    
                    var importedHtml = '';
                    for (var k = 0; k < importedItems.length; k++) {
                        var entry = importedItems[k];
                        var item = entry.item;
                        var idx = entry.index;
                        var title = (item.title || item.name || 'Unnamed').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                        
                        importedHtml += '<div class="custom-format-card instance-card" data-index="' + idx + '" data-app-type="tv-hunt-custom-format">' +
                            '<div class="custom-format-card-header">' +
                            '<div class="custom-format-card-title"><i class="fas fa-code"></i><span>' + title + '</span></div>' +
                            '</div>' +
                            '<div class="custom-format-card-footer">' +
                            '<button type="button" class="btn-card view" data-index="' + idx + '"><i class="fas fa-eye"></i> JSON</button>' +
                            '<button type="button" class="btn-card edit" data-index="' + idx + '"><i class="fas fa-edit"></i> Edit</button>' +
                            '<button type="button" class="btn-card delete" data-index="' + idx + '"><i class="fas fa-trash"></i> Delete</button>' +
                            '</div></div>';
                    }
                    
                    preformattedGrid.innerHTML = preformattedHtml;
                    importedGrid.innerHTML = importedHtml;
                    
                    var deletePreBtn = document.getElementById('tv-hunt-delete-all-preformatted');
                    var deleteImpBtn = document.getElementById('tv-hunt-delete-all-imported');
                    if (deletePreBtn) deletePreBtn.disabled = preformattedCount === 0;
                    if (deleteImpBtn) deleteImpBtn.disabled = importedCount === 0;
                    
                    window.TVHuntCustomFormats._bindCards();
                })
                .catch(function() {
                    preformattedGrid.innerHTML = '';
                    importedGrid.innerHTML = '';
                    window.TVHuntCustomFormats._bindAddButtons();
                });
        },

        _getGroupFromPreformatId: function(preformatId) {
            if (!preformatId) return 'Other';
            var parts = preformatId.split('.');
            return parts[0] || 'Other';
        },

        _formatGroupName: function(groupKey) {
            if (!groupKey || groupKey === 'Other') return 'Other';
            var categoryNames = {
                'audio-formats': 'Audio Formats',
                'audio-channels': 'Audio Channels',
                'hdr-formats': 'HDR Formats',
                'hdr-optional': 'HDR Optional',
                'series-versions': 'Series Versions',
                'unwanted': 'Unwanted',
                'hq-source-groups': 'HQ Source Groups',
                'streaming-services-general': 'General Streaming Services',
                'streaming-services-french': 'French Streaming Services',
                'streaming-services-asian': 'Asian Streaming Services',
                'streaming-services-dutch': 'Dutch Streaming Services',
                'streaming-services-uk': 'UK Streaming Services',
                'streaming-services-misc': 'Misc Streaming Services',
                'streaming-services-anime': 'Anime Streaming Services',
                'streaming-services-optional': 'Optional Streaming Services',
                'miscellaneous': 'Miscellaneous',
                'language-profiles': 'Language Profiles',
                'anime-source-groups-bd': 'Anime Source Groups (BD)',
                'anime-source-groups-web': 'Anime Source Groups (Web)',
                'anime-misc': 'Anime Misc',
                'anime-optional': 'Anime Optional',
                'german-source-groups': 'German Source Groups',
                'german-miscellaneous': 'German Miscellaneous',
                'french-source-groups': 'French Source Groups',
                'french-audio-version': 'French Audio Version'
            };
            return categoryNames[groupKey] || groupKey.split('-').map(function(s) {
                return s.charAt(0).toUpperCase() + s.slice(1);
            }).join(' ');
        },

        _bindCards: function() {
            var container = document.getElementById('tvHuntSettingsCustomFormatsSection');
            if (!container) return;
            var allCards = container.querySelectorAll('.custom-format-card');
            allCards.forEach(function(card) {
                var viewBtn = card.querySelector('.btn-card.view');
                var editBtn = card.querySelector('.btn-card.edit');
                var deleteBtn = card.querySelector('.btn-card.delete');
                
                if (viewBtn) {
                    viewBtn.onclick = function(e) {
                        e.stopPropagation();
                        var idx = parseInt(viewBtn.getAttribute('data-index'), 10);
                        if (!isNaN(idx)) window.TVHuntCustomFormats.openViewModal(idx);
                    };
                }
                if (editBtn) {
                    editBtn.onclick = function(e) {
                        e.stopPropagation();
                        var idx = parseInt(editBtn.getAttribute('data-index'), 10);
                        if (!isNaN(idx)) window.TVHuntCustomFormats.openEditModal(idx);
                    };
                }
                if (deleteBtn) {
                    deleteBtn.onclick = function(e) {
                        e.stopPropagation();
                        var idx = parseInt(deleteBtn.getAttribute('data-index'), 10);
                        if (!isNaN(idx)) window.TVHuntCustomFormats.deleteFormat(idx);
                    };
                }
            });
            window.TVHuntCustomFormats._bindAddButtons();
        },

        _bindAddButtons: function() {
            var addPreformattedBtn = document.getElementById('tv-hunt-add-preformatted-btn');
            var addImportedBtn = document.getElementById('tv-hunt-add-imported-btn');
            if (addPreformattedBtn) {
                addPreformattedBtn.onclick = function() { 
                    window.TVHuntCustomFormats.openAddModal('preformat'); 
                };
            }
            if (addImportedBtn) {
                addImportedBtn.onclick = function() { 
                    window.TVHuntCustomFormats.openAddModal('import'); 
                };
            }
        },

        openViewModal: function(index) {
            var list = window.TVHuntCustomFormats._list;
            if (index < 0 || index >= list.length) return;
            window.TVHuntCustomFormats._ensureViewModalInBody();
            var item = list[index];
            var title = (item.title || item.name || 'Unnamed');
            document.getElementById('tv-hunt-custom-format-view-modal-title').textContent = 'View JSON: ' + title;
            var jsonStr = item.custom_format_json || '{}';
            try {
                var parsed = JSON.parse(jsonStr);
                jsonStr = JSON.stringify(parsed, null, 2);
            } catch (e) { /* show as-is */ }
            document.getElementById('tv-hunt-custom-format-view-json').textContent = jsonStr;
            document.getElementById('tv-hunt-custom-format-view-modal').style.display = 'flex';
            document.body.classList.add('custom-format-modal-open');
        },

        closeViewModal: function() {
            var modal = document.getElementById('tv-hunt-custom-format-view-modal');
            if (modal) modal.style.display = 'none';
            document.body.classList.remove('custom-format-modal-open');
        },

        _generateRandomSuffix: function() {
            var chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
            var suffix = '';
            for (var i = 0; i < 4; i++) {
                suffix += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            return suffix;
        },

        _checkTitleCollision: function(title) {
            var list = window.TVHuntCustomFormats._list || [];
            var preformattedTitles = {};
            for (var i = 0; i < list.length; i++) {
                if ((list[i].source || 'import').toLowerCase() === 'preformat') {
                    var t = (list[i].title || list[i].name || '').toLowerCase();
                    if (t) preformattedTitles[t] = true;
                }
            }
            var lowerTitle = title.toLowerCase();
            if (preformattedTitles[lowerTitle]) {
                return title + '-' + window.TVHuntCustomFormats._generateRandomSuffix();
            }
            return title;
        },

        _ensureAddModalInBody: function() {
            var modal = document.getElementById('tv-hunt-custom-format-modal');
            if (modal && modal.parentNode !== document.body) {
                document.body.appendChild(modal);
            }
        },
        _ensureViewModalInBody: function() {
            var modal = document.getElementById('tv-hunt-custom-format-view-modal');
            if (modal && modal.parentNode !== document.body) {
                document.body.appendChild(modal);
            }
        },

        openAddModal: function(source) {
            window.TVHuntCustomFormats._editingIndex = null;
            window.TVHuntCustomFormats._modalMode = source;
            window.TVHuntCustomFormats._ensureAddModalInBody();

            if (source === 'preformat') {
                document.getElementById('tv-hunt-custom-format-modal-title').textContent = 'Add Pre-Formatted';
                document.getElementById('tv-hunt-custom-format-preformat-area').style.display = 'block';
                var importArea = document.getElementById('tv-hunt-custom-format-import-area');
                if (importArea) importArea.style.display = 'none';
                window.TVHuntCustomFormats._loadPreformatTree();
            } else {
                document.getElementById('tv-hunt-custom-format-modal-title').textContent = 'Add Imported';
                document.getElementById('tv-hunt-custom-format-preformat-area').style.display = 'none';
                var importArea = document.getElementById('tv-hunt-custom-format-import-area');
                if (importArea) importArea.style.display = 'block';
            }

            document.getElementById('tv-hunt-custom-format-modal-save').innerHTML = '<i class="fas fa-plus"></i> Add';
            document.getElementById('tv-hunt-custom-format-json-textarea').value = '';
            document.getElementById('tv-hunt-custom-format-modal').style.display = 'flex';
            document.body.classList.add('custom-format-modal-open');
        },

        openEditModal: function(index) {
            var list = window.TVHuntCustomFormats._list;
            if (index < 0 || index >= list.length) return;
            window.TVHuntCustomFormats._ensureAddModalInBody();
            window.TVHuntCustomFormats._editingIndex = index;
            var item = list[index];
            document.getElementById('tv-hunt-custom-format-modal-title').textContent = 'Edit Custom Format';
            document.getElementById('tv-hunt-custom-format-modal-save').innerHTML = '<i class="fas fa-save"></i> Save';
            document.getElementById('tv-hunt-custom-format-source-import').checked = true;
            document.getElementById('tv-hunt-custom-format-preformat-area').style.display = 'none';
            var importArea = document.getElementById('tv-hunt-custom-format-import-area');
            if (importArea) importArea.style.display = 'block';
            document.getElementById('tv-hunt-custom-format-json-textarea').value = item.custom_format_json || '{}';
            document.getElementById('tv-hunt-custom-format-modal').style.display = 'flex';
            document.body.classList.add('custom-format-modal-open');
        },

        closeModal: function() {
            var modal = document.getElementById('tv-hunt-custom-format-modal');
            if (modal) modal.style.display = 'none';
            document.body.classList.remove('custom-format-modal-open');
        },

        _buildPreformatId: function(catId, subId, fmtId) {
            if (subId) return catId + '.' + subId + '.' + fmtId;
            return catId + '.' + fmtId;
        },

        _loadPreformatTree: function() {
            var treeEl = document.getElementById('tv-hunt-custom-format-preformat-tree');
            if (!treeEl) return;
            treeEl.innerHTML = '<span class="custom-format-loading">Loading\u2026</span>';
            var existingIds = {};
            (window.TVHuntCustomFormats._list || []).forEach(function(item) {
                if (item.preformat_id) existingIds[item.preformat_id] = true;
            });
            fetch('./api/tv-hunt/custom-formats/preformats')
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    var categories = (data && data.categories) ? data.categories : [];
                    treeEl.innerHTML = '';
                    if (categories.length === 0) {
                        var msg = document.createElement('div');
                        msg.className = 'custom-format-preformat-empty';
                        msg.innerHTML = 'Pre-formatted list is not available on this server. You can still add formats via <strong>Import</strong> by pasting JSON from <a href="https://trash-guides.info/Sonarr/sonarr-collection-of-custom-formats/" target="_blank" rel="noopener">TRaSH Guides (Sonarr)</a>.';
                        treeEl.appendChild(msg);
                        return;
                    }
                    categories.forEach(function(cat) {
                        var catId = cat.id || '';
                        var catName = cat.name || catId;
                        var catDiv = document.createElement('div');
                        catDiv.className = 'custom-format-cat';
                        var header = document.createElement('div');
                        header.className = 'custom-format-cat-header';
                        header.innerHTML = '<i class="fas fa-chevron-down"></i><span>' + (catName.replace(/</g, '&lt;').replace(/>/g, '&gt;')) + '</span>';
                        var body = document.createElement('div');
                        body.className = 'custom-format-cat-body';
                        var subcats = cat.subcategories || [];
                        if (subcats.length > 0) {
                            subcats.forEach(function(sub) {
                                var subId = sub.id || '';
                                var subName = sub.name || subId;
                                var subDiv = document.createElement('div');
                                subDiv.className = 'custom-format-subcat';
                                var subLabel = document.createElement('div');
                                subLabel.className = 'custom-format-subcat-name';
                                subLabel.textContent = subName;
                                subDiv.appendChild(subLabel);
                                var fmtList = document.createElement('div');
                                fmtList.className = 'custom-format-format-list';
                                (sub.formats || []).forEach(function(fmt) {
                                    var fid = window.TVHuntCustomFormats._buildPreformatId(catId, subId, fmt.id || '');
                                    var name = fmt.name || fid;
                                    var already = existingIds[fid];
                                    var label = document.createElement('label');
                                    label.className = 'custom-format-format-item';
                                    var cb = document.createElement('input');
                                    cb.type = 'checkbox';
                                    cb.setAttribute('data-preformat-id', fid);
                                    cb.setAttribute('data-format-name', name);
                                    if (already) { cb.checked = true; cb.disabled = true; }
                                    label.appendChild(cb);
                                    label.appendChild(document.createElement('span')).textContent = name;
                                    fmtList.appendChild(label);
                                });
                                subDiv.appendChild(fmtList);
                                body.appendChild(subDiv);
                            });
                        } else {
                            var fmtList = document.createElement('div');
                            fmtList.className = 'custom-format-format-list';
                            (cat.formats || []).forEach(function(fmt) {
                                var fid = window.TVHuntCustomFormats._buildPreformatId(catId, null, fmt.id || '');
                                var name = fmt.name || fid;
                                var already = existingIds[fid];
                                var label = document.createElement('label');
                                label.className = 'custom-format-format-item';
                                var cb = document.createElement('input');
                                cb.type = 'checkbox';
                                cb.setAttribute('data-preformat-id', fid);
                                cb.setAttribute('data-format-name', name);
                                if (already) { cb.checked = true; cb.disabled = true; }
                                label.appendChild(cb);
                                label.appendChild(document.createElement('span')).textContent = name;
                                fmtList.appendChild(label);
                            });
                            body.appendChild(fmtList);
                        }
                        header.onclick = function() {
                            header.classList.toggle('collapsed');
                            body.classList.toggle('collapsed');
                        };
                        catDiv.appendChild(header);
                        catDiv.appendChild(body);
                        treeEl.appendChild(catDiv);
                    });
                })
                .catch(function() {
                    treeEl.innerHTML = '<span class="custom-format-loading" style="color:#f87171;">Failed to load formats.</span>';
                });
        },

        _nameFromJson: function(str) {
            if (!str || typeof str !== 'string') return '\u2014';
            try {
                var obj = JSON.parse(str);
                return (obj && obj.name != null) ? String(obj.name).trim() || '\u2014' : '\u2014';
            } catch (e) { return '\u2014'; }
        },

        _onSourceChange: function() {
            var isPre = document.getElementById('tv-hunt-custom-format-source-preformat').checked;
            var preformatArea = document.getElementById('tv-hunt-custom-format-preformat-area');
            var importArea = document.getElementById('tv-hunt-custom-format-import-area');
            var jsonTa = document.getElementById('tv-hunt-custom-format-json-textarea');
            if (preformatArea) preformatArea.style.display = isPre ? 'block' : 'none';
            if (importArea) importArea.style.display = isPre ? 'none' : 'block';
            if (isPre) {
                if (jsonTa) jsonTa.value = '';
                window.TVHuntCustomFormats._loadPreformatTree();
            } else {
                if (window.TVHuntCustomFormats._editingIndex != null) {
                    var list = window.TVHuntCustomFormats._list;
                    var idx = window.TVHuntCustomFormats._editingIndex;
                    if (list && idx >= 0 && idx < list.length && jsonTa) {
                        jsonTa.value = list[idx].custom_format_json || '{}';
                    }
                } else if (jsonTa) {
                    jsonTa.value = '';
                }
            }
        },

        saveModal: function() {
            var editing = window.TVHuntCustomFormats._editingIndex;

            if (editing != null) {
                var jsonRaw = document.getElementById('tv-hunt-custom-format-json-textarea').value.trim();
                if (!jsonRaw) {
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification('Paste valid JSON to edit.', 'error');
                    }
                    return;
                }
                try { JSON.parse(jsonRaw); } catch (e) {
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification('Invalid JSON.', 'error');
                    }
                    return;
                }
                var title = window.TVHuntCustomFormats._nameFromJson(jsonRaw);
                if (title === '\u2014') title = 'Unnamed';
                fetch('./api/tv-hunt/custom-formats/' + editing, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title: title, custom_format_json: jsonRaw })
                })
                    .then(function(r) { return r.json(); })
                    .then(function(data) {
                        if (data.success) {
                            if (window.huntarrUI && window.huntarrUI.showNotification) {
                                window.huntarrUI.showNotification('Custom format updated.', 'success');
                            }
                            window.TVHuntCustomFormats.closeModal();
                            window.TVHuntCustomFormats.refreshList();
                        } else {
                            if (window.huntarrUI && window.huntarrUI.showNotification) {
                                window.huntarrUI.showNotification(data.message || data.error || 'Update failed', 'error');
                            }
                        }
                    })
                    .catch(function() {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification('Update failed', 'error');
                        }
                    });
                return;
            }

            var isPre = window.TVHuntCustomFormats._modalMode === 'preformat';
            if (isPre) {
                var tree = document.getElementById('tv-hunt-custom-format-preformat-tree');
                var checkboxes = tree ? tree.querySelectorAll('input[type="checkbox"][data-preformat-id]:checked:not(:disabled)') : [];
                var toAdd = [];
                checkboxes.forEach(function(cb) {
                    toAdd.push({ id: cb.getAttribute('data-preformat-id'), name: cb.getAttribute('data-format-name') || cb.getAttribute('data-preformat-id') });
                });
                if (toAdd.length === 0) {
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification('Check at least one format to add.', 'error');
                    }
                    return;
                }
                var done = 0;
                var failed = 0;
                var currentIndex = 0;
                
                function addNext() {
                    if (currentIndex >= toAdd.length) {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            if (failed === 0) {
                                window.huntarrUI.showNotification('Added ' + done + ' format(s).', 'success');
                            } else {
                                window.huntarrUI.showNotification('Added ' + done + ', failed ' + failed + '.', failed ? 'error' : 'success');
                            }
                        }
                        window.TVHuntCustomFormats.closeModal();
                        window.TVHuntCustomFormats.refreshList();
                        return;
                    }
                    
                    var item = toAdd[currentIndex];
                    currentIndex++;
                    
                    fetch('./api/tv-hunt/custom-formats', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ source: 'preformat', preformat_id: item.id, title: item.name })
                    })
                        .then(function(r) { return r.json(); })
                        .then(function(data) {
                            if (data.success) done++; else failed++;
                            addNext();
                        })
                        .catch(function() {
                            failed++;
                            addNext();
                        });
                }
                
                addNext();
                return;
            }
            var jsonRaw = document.getElementById('tv-hunt-custom-format-json-textarea').value.trim();
            if (!jsonRaw) {
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('Paste Custom Format JSON.', 'error');
                }
                return;
            }
            try { JSON.parse(jsonRaw); } catch (e) {
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('Invalid JSON.', 'error');
                }
                return;
            }
            var title = window.TVHuntCustomFormats._nameFromJson(jsonRaw);
            if (title === '\u2014') title = 'Unnamed';
            title = window.TVHuntCustomFormats._checkTitleCollision(title);
            var body = { source: 'import', custom_format_json: jsonRaw, title: title };

            fetch('./api/tv-hunt/custom-formats', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.success) {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification('Custom format added.', 'success');
                        }
                        window.TVHuntCustomFormats.closeModal();
                        window.TVHuntCustomFormats.refreshList();
                    } else {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification(data.message || data.error || 'Add failed', 'error');
                        }
                    }
                })
                .catch(function() {
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification('Add failed', 'error');
                    }
                });
        },

        deleteFormat: function(index) {
            var doDelete = function() {
                fetch('./api/tv-hunt/custom-formats/' + index, { method: 'DELETE' })
                    .then(function(r) { return r.json(); })
                    .then(function(data) {
                        if (data.success) {
                            if (window.huntarrUI && window.huntarrUI.showNotification) {
                                window.huntarrUI.showNotification('Custom format removed.', 'success');
                            }
                            window.TVHuntCustomFormats.refreshList();
                        } else {
                            if (window.huntarrUI && window.huntarrUI.showNotification) {
                                window.huntarrUI.showNotification(data.message || 'Delete failed', 'error');
                            }
                        }
                    })
                    .catch(function() {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification('Delete failed', 'error');
                        }
                    });
            };
            if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
                window.HuntarrConfirm.show({
                    title: 'Remove Custom Format',
                    message: 'Remove this custom format?',
                    confirmLabel: 'Remove',
                    onConfirm: doDelete
                });
            } else {
                doDelete();
            }
        },

        deleteAllByType: function(type) {
            var list = window.TVHuntCustomFormats._list || [];
            var toDelete = [];
            
            for (var i = 0; i < list.length; i++) {
                var item = list[i];
                var isPreformatted = (item.source || 'import').toLowerCase() === 'preformat';
                if ((type === 'preformat' && isPreformatted) || (type === 'import' && !isPreformatted)) {
                    toDelete.push(i);
                }
            }
            
            if (toDelete.length === 0) {
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('No formats to delete.', 'info');
                }
                return;
            }
            
            var typeName = type === 'preformat' ? 'pre-formatted' : 'imported';
            var confirmMsg = 'Delete all ' + toDelete.length + ' ' + typeName + ' custom format(s)?\n\nThis action cannot be undone.';
            var deleted = 0;
            var failed = 0;

            function runDeleteAll() {
                var currentIndex = toDelete.length - 1;
                deleted = 0;
                failed = 0;
                
                function deleteNext() {
                    if (currentIndex < 0) {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            if (failed === 0) {
                                window.huntarrUI.showNotification('Deleted ' + deleted + ' format(s).', 'success');
                            } else {
                                window.huntarrUI.showNotification('Deleted ' + deleted + ', failed ' + failed + '.', failed > 0 ? 'error' : 'success');
                            }
                        }
                        window.TVHuntCustomFormats.refreshList();
                        return;
                    }
                    
                    var idx = toDelete[currentIndex];
                    currentIndex--;
                    
                    fetch('./api/tv-hunt/custom-formats/' + idx, { method: 'DELETE' })
                        .then(function(r) { return r.json(); })
                        .then(function(data) {
                            if (data.success) deleted++; else failed++;
                            deleteNext();
                        })
                        .catch(function() {
                            failed++;
                            deleteNext();
                        });
                }
                
                deleteNext();
            }

            if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
                window.HuntarrConfirm.show({
                    title: 'Delete All ' + typeName.charAt(0).toUpperCase() + typeName.slice(1) + ' Custom Formats',
                    message: confirmMsg,
                    confirmLabel: 'Delete All',
                    onConfirm: runDeleteAll
                });
            } else {
                runDeleteAll();
            }
        },

        init: function() {
            var self = window.TVHuntCustomFormats;
            var modal = document.getElementById('tv-hunt-custom-format-modal');
            var backdrop = document.getElementById('tv-hunt-custom-format-modal-backdrop');
            var closeBtn = document.getElementById('tv-hunt-custom-format-modal-close');
            var cancelBtn = document.getElementById('tv-hunt-custom-format-modal-cancel');
            var saveBtn = document.getElementById('tv-hunt-custom-format-modal-save');
            if (backdrop) backdrop.onclick = function() { self.closeModal(); };
            if (closeBtn) closeBtn.onclick = function() { self.closeModal(); };
            if (cancelBtn) cancelBtn.onclick = function() { self.closeModal(); };
            if (saveBtn) saveBtn.onclick = function() { self.saveModal(); };
            
            var viewModal = document.getElementById('tv-hunt-custom-format-view-modal');
            var viewBackdrop = document.getElementById('tv-hunt-custom-format-view-modal-backdrop');
            var viewCloseBtn = document.getElementById('tv-hunt-custom-format-view-modal-close');
            var viewCloseBtnFooter = document.getElementById('tv-hunt-custom-format-view-modal-close-btn');
            if (viewBackdrop) viewBackdrop.onclick = function() { self.closeViewModal(); };
            if (viewCloseBtn) viewCloseBtn.onclick = function() { self.closeViewModal(); };
            if (viewCloseBtnFooter) viewCloseBtnFooter.onclick = function() { self.closeViewModal(); };
            
            var deleteAllPreBtn = document.getElementById('tv-hunt-delete-all-preformatted');
            var deleteAllImpBtn = document.getElementById('tv-hunt-delete-all-imported');
            if (deleteAllPreBtn) {
                deleteAllPreBtn.onclick = function() { self.deleteAllByType('preformat'); };
            }
            if (deleteAllImpBtn) {
                deleteAllImpBtn.onclick = function() { self.deleteAllByType('import'); };
            }
            
            document.querySelectorAll('input[name="tv-hunt-custom-format-source"]').forEach(function(radio) {
                radio.onchange = function() { self._onSourceChange(); };
            });
            
            document.addEventListener('keydown', function(e) {
                if (e.key === 'Escape') {
                    if (viewModal && viewModal.style.display === 'flex') {
                        self.closeViewModal();
                    } else if (modal && modal.style.display === 'flex') {
                        self.closeModal();
                    }
                }
            });
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() { window.TVHuntCustomFormats.init(); });
    } else {
        window.TVHuntCustomFormats.init();
    }
})();


/* === modules/features/settings/media-hunt-root-folders.js === */
/**
 * Media Hunt – Root Folders for TV. File: media-hunt-root-folders.js.
 * Card grid, add via modal, browse, test, set default, delete. Uses /api/tv-hunt/root-folders; DOM IDs remain tv-hunt-*.
 */
(function() {
    'use strict';

    window.TVHuntRootFolders = {
        _browseTargetInput: null,

        refreshList: function() {
            if (window.TVHuntInstanceDropdown && document.getElementById('tv-hunt-settings-root-folders-instance-select') && !window.TVHuntRootFolders._instanceDropdownAttached) {
                window.TVHuntInstanceDropdown.attach('tv-hunt-settings-root-folders-instance-select', function() {
                    if (window.TVHuntRootFolders.refreshList) window.TVHuntRootFolders.refreshList();
                });
                window.TVHuntRootFolders._instanceDropdownAttached = true;
            }
            var gridEl = document.getElementById('tv-hunt-root-folders-grid');
            if (!gridEl) return;
            fetch('./api/tv-hunt/root-folders', { cache: 'no-store' })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    var folders = (data && data.root_folders) ? data.root_folders : [];
                    folders = folders.slice().sort(function(a, b) {
                        if (a.is_default) return -1;
                        if (b.is_default) return 1;
                        return 0;
                    });
                    var html = '';
                    for (var i = 0; i < folders.length; i++) {
                        var path = (folders[i].path || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
                        var freeSpace = folders[i].freeSpace;
                        var spaceLabel = (freeSpace != null && !isNaN(freeSpace)) ? Math.round(freeSpace / 1e9) + ' GB free' : '';
                        var idx = folders[i].index !== undefined ? folders[i].index : i;
                        var isDefault = !!folders[i].is_default;
                        var showSetDefault = folders.length > 1 && !isDefault;
                        var defaultClass = isDefault ? ' default-root-folder' : '';
                        html += '<div class="root-folder-card instance-card' + defaultClass + '" data-index="' + idx + '" data-app-type="tv-hunt-root-folder">' +
                            '<div class="root-folder-card-header">' +
                            '<div class="root-folder-card-path">' +
                            '<i class="fas fa-folder"></i>' +
                            '<span>' + path + '</span>' +
                            (isDefault ? '<span class="root-folder-default-badge">Default</span>' : '') +
                            '</div></div>' +
                            '<div class="root-folder-card-body">' +
                            (spaceLabel ? '<span class="root-folder-free-space">' + spaceLabel + '</span>' : '') +
                            '</div>' +
                            '<div class="root-folder-card-footer">' +
                            '<button type="button" class="btn-card" data-index="' + idx + '" data-path="' + (folders[i].path || '').replace(/"/g, '&quot;') + '" data-action="test"><i class="fas fa-vial"></i> Test</button>' +
                            (showSetDefault ? '<button type="button" class="btn-card set-default" data-index="' + idx + '" data-action="set-default"><i class="fas fa-star"></i> Default</button>' : '') +
                            '<button type="button" class="btn-card delete" data-index="' + idx + '" data-action="delete"><i class="fas fa-trash"></i> Delete</button>' +
                            '</div></div>';
                    }
                    html += '<div class="add-instance-card add-root-folder-card" id="tv-hunt-root-folders-add-card" data-app-type="tv-hunt-root-folder">' +
                        '<div class="add-icon"><i class="fas fa-plus-circle"></i></div>' +
                        '<div class="add-text">Add Root Folder</div></div>';
                    gridEl.innerHTML = html;
                    window.TVHuntRootFolders._bindCardButtons();
                })
                .catch(function() {
                    var addCard = '<div class="add-instance-card add-root-folder-card" id="tv-hunt-root-folders-add-card" data-app-type="tv-hunt-root-folder">' +
                        '<div class="add-icon"><i class="fas fa-plus-circle"></i></div>' +
                        '<div class="add-text">Add Root Folder</div></div>';
                    gridEl.innerHTML = '<p style="color: #ef4444; margin: 0 0 12px 0;">Failed to load TV Hunt root folders.</p>' + addCard;
                    window.TVHuntRootFolders._bindAddCard();
                });
        },

        _bindCardButtons: function() {
            var gridEl = document.getElementById('tv-hunt-root-folders-grid');
            if (!gridEl) return;
            gridEl.querySelectorAll('.root-folder-card [data-action="test"]').forEach(function(btn) {
                btn.onclick = function() {
                    var path = btn.getAttribute('data-path') || '';
                    if (path) window.TVHuntRootFolders.testPath(path);
                };
            });
            gridEl.querySelectorAll('.root-folder-card [data-action="set-default"]').forEach(function(btn) {
                btn.onclick = function() {
                    var idx = parseInt(btn.getAttribute('data-index'), 10);
                    if (!isNaN(idx)) window.TVHuntRootFolders.setDefault(idx);
                };
            });
            gridEl.querySelectorAll('.root-folder-card [data-action="delete"]').forEach(function(btn) {
                btn.onclick = function() {
                    var idx = parseInt(btn.getAttribute('data-index'), 10);
                    if (!isNaN(idx)) window.TVHuntRootFolders.deleteFolder(idx);
                };
            });
            window.TVHuntRootFolders._bindAddCard();
        },

        _bindAddCard: function() {
            var addCard = document.getElementById('tv-hunt-root-folders-add-card');
            if (addCard) {
                addCard.onclick = function() { window.TVHuntRootFolders.openAddModal(); };
            }
        },

        openAddModal: function() {
            var modal = document.getElementById('tv-hunt-root-folder-add-modal');
            var input = document.getElementById('tv-hunt-root-folder-add-path');
            if (modal && modal.parentNode !== document.body) {
                document.body.appendChild(modal);
            }
            if (modal) modal.style.display = 'flex';
            if (input) {
                input.value = '';
                setTimeout(function() { input.focus(); }, 100);
            }
            document.body.classList.add('tv-hunt-root-folder-add-modal-open');
        },

        closeAddModal: function() {
            var modal = document.getElementById('tv-hunt-root-folder-add-modal');
            if (modal) modal.style.display = 'none';
            document.body.classList.remove('tv-hunt-root-folder-add-modal-open');
        },

        setDefault: function(index) {
            if (typeof index !== 'number' || index < 0) return;
            fetch('./api/tv-hunt/root-folders/' + index + '/default', { method: 'PATCH' })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.success) {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification('Default TV Hunt root folder updated.', 'success');
                        }
                        window.TVHuntRootFolders.refreshList();
                    } else {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification(data.message || 'Failed to set default.', 'error');
                        }
                    }
                })
                .catch(function(err) {
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification(err.message || 'Failed to set default.', 'error');
                    }
                });
        },

        testPath: function(path) {
            if (!path || (typeof path !== 'string')) {
                var addInput = document.getElementById('tv-hunt-root-folder-add-path');
                path = addInput ? (addInput.value || '').trim() : '';
            } else {
                path = String(path).trim();
            }
            if (!path) {
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('Enter a path to test', 'error');
                }
                return;
            }
            var testBtn = document.getElementById('tv-hunt-root-folder-add-test-btn');
            if (testBtn) {
                testBtn.disabled = true;
                testBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Testing...';
            }
            fetch('./api/tv-hunt/root-folders/test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: path })
            })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (testBtn) {
                        testBtn.disabled = false;
                        testBtn.innerHTML = '<i class="fas fa-vial"></i> Test';
                    }
                    if (data.success) {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification(data.message || 'Write and read test passed.', 'success');
                        }
                    } else {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification(data.message || 'Test failed', 'error');
                        }
                    }
                })
                .catch(function(err) {
                    if (testBtn) {
                        testBtn.disabled = false;
                        testBtn.innerHTML = '<i class="fas fa-vial"></i> Test';
                    }
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification(err.message || 'Test failed', 'error');
                    }
                });
        },

        addFolder: function() {
            var input = document.getElementById('tv-hunt-root-folder-add-path');
            var path = input ? (input.value || '').trim() : '';
            if (!path) {
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('Enter a path', 'error');
                }
                return;
            }
            var saveBtn = document.getElementById('tv-hunt-root-folder-add-modal-save');
            if (saveBtn) {
                saveBtn.disabled = true;
                saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Adding...';
            }
            fetch('./api/tv-hunt/root-folders', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: path })
            })
                .then(function(r) { return r.json().then(function(data) { return { ok: r.ok, data: data }; }); })
                .then(function(result) {
                    if (saveBtn) {
                        saveBtn.disabled = false;
                        saveBtn.innerHTML = '<i class="fas fa-plus"></i> Add';
                    }
                    if (result.ok && result.data && result.data.success) {
                        if (input) input.value = '';
                        window.TVHuntRootFolders.closeAddModal();
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification('TV Hunt root folder added.', 'success');
                        }
                        window.TVHuntRootFolders.refreshList();
                    } else {
                        var msg = (result.data && result.data.message) ? result.data.message : 'Add failed';
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification(msg, 'error');
                        }
                    }
                })
                .catch(function(err) {
                    if (saveBtn) {
                        saveBtn.disabled = false;
                        saveBtn.innerHTML = '<i class="fas fa-plus"></i> Add';
                    }
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification(err.message || 'Add failed', 'error');
                    }
                });
        },

        deleteFolder: function(index) {
            if (typeof index !== 'number' || index < 0) return;
            var deleteUrl = './api/tv-hunt/root-folders/' + index;
            var doDelete = function() {
                fetch(deleteUrl, { method: 'DELETE' })
                    .then(function(r) { return r.json(); })
                    .then(function(data) {
                        if (data.success) {
                            if (window.huntarrUI && window.huntarrUI.showNotification) {
                                window.huntarrUI.showNotification('TV Hunt root folder removed.', 'success');
                            }
                            window.TVHuntRootFolders.refreshList();
                        } else {
                            if (window.huntarrUI && window.huntarrUI.showNotification) {
                                window.huntarrUI.showNotification(data.message || 'Delete failed', 'error');
                            }
                        }
                    })
                    .catch(function(err) {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification(err.message || 'Delete failed', 'error');
                        }
                    });
            };
            if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
                window.HuntarrConfirm.show({
                    title: 'Remove Root Folder',
                    message: 'Remove this TV Hunt root folder?',
                    confirmLabel: 'OK',
                    onConfirm: doDelete
                });
            } else {
                if (!confirm('Remove this TV Hunt root folder?')) return;
                doDelete();
            }
        },

        openBrowseModal: function(sourceInput) {
            var modal = document.getElementById('tv-hunt-root-folders-browse-modal');
            var browsePathInput = document.getElementById('tv-hunt-root-folders-browse-path-input');
            window.TVHuntRootFolders._browseTargetInput = sourceInput || document.getElementById('tv-hunt-root-folder-add-path');
            if (!modal || !browsePathInput) return;
            if (modal.parentNode !== document.body) {
                document.body.appendChild(modal);
            }
            var startPath = (window.TVHuntRootFolders._browseTargetInput && window.TVHuntRootFolders._browseTargetInput.value) ? window.TVHuntRootFolders._browseTargetInput.value.trim() : '/';
            if (!startPath) startPath = '/';
            browsePathInput.value = startPath;
            modal.style.display = 'flex';
            document.body.classList.add('tv-hunt-root-folders-browse-modal-open');
            window.TVHuntRootFolders.loadBrowsePath(startPath);
        },

        closeBrowseModal: function() {
            var modal = document.getElementById('tv-hunt-root-folders-browse-modal');
            if (modal) {
                modal.style.display = 'none';
                document.body.classList.remove('tv-hunt-root-folders-browse-modal-open');
            }
        },

        confirmBrowseSelection: function() {
            var pathInput = document.getElementById('tv-hunt-root-folders-browse-path-input');
            var target = window.TVHuntRootFolders._browseTargetInput || document.getElementById('tv-hunt-root-folder-add-path');
            if (pathInput && target) {
                target.value = (pathInput.value || '').trim();
            }
            window.TVHuntRootFolders.closeBrowseModal();
        },

        goToParent: function() {
            var pathInput = document.getElementById('tv-hunt-root-folders-browse-path-input');
            if (!pathInput) return;
            var path = (pathInput.value || '').trim() || '/';
            var parent = path.replace(/\/+$/, '').split('/').slice(0, -1).join('/') || '/';
            if (parent === path) return;
            window.TVHuntRootFolders.loadBrowsePath(parent);
        },

        browseCreateFolder: function() {
            var pathInput = document.getElementById('tv-hunt-root-folders-browse-path-input');
            if (!pathInput) return;
            var parent = (pathInput.value || '').trim() || '/';
            var name = (typeof prompt === 'function' && prompt('New folder name:')) || '';
            name = (name || '').trim();
            if (!name) return;
            fetch('./api/tv-hunt/root-folders/browse/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ parent_path: parent, name: name })
            }).then(function(r) { return r.json(); }).then(function(data) {
                if (data.success) window.TVHuntRootFolders.loadBrowsePath(parent);
                else alert(data.error || 'Failed to create folder');
            }).catch(function() { alert('Failed to create folder'); });
        },

        browseRenameFolder: function(path, currentName) {
            var name = (typeof prompt === 'function' && prompt('Rename folder to:', currentName)) || '';
            name = (name || '').trim();
            if (!name || name === currentName) return;
            fetch('./api/tv-hunt/root-folders/browse/rename', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: path, new_name: name })
            }).then(function(r) { return r.json(); }).then(function(data) {
                if (data.success) {
                    var parent = path.replace(/\/+$/, '').split('/').slice(0, -1).join('/') || '/';
                    window.TVHuntRootFolders.loadBrowsePath(parent);
                } else alert(data.error || 'Failed to rename');
            }).catch(function() { alert('Failed to rename folder'); });
        },

        browseDeleteFolder: function(path) {
            if (!confirm('Delete this folder? It must be empty.')) return;
            fetch('./api/tv-hunt/root-folders/browse/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: path })
            }).then(function(r) { return r.json(); }).then(function(data) {
                if (data.success) {
                    var parent = path.replace(/\/+$/, '').split('/').slice(0, -1).join('/') || '/';
                    window.TVHuntRootFolders.loadBrowsePath(parent);
                } else alert(data.error || 'Failed to delete (folder may not be empty)');
            }).catch(function() { alert('Failed to delete folder'); });
        },

        loadBrowsePath: function(path) {
            var listEl = document.getElementById('tv-hunt-root-folders-browse-list');
            var pathInput = document.getElementById('tv-hunt-root-folders-browse-path-input');
            var upBtn = document.getElementById('tv-hunt-root-folders-browse-up');
            if (!listEl || !pathInput) return;
            path = (path || pathInput.value || '/').trim() || '/';
            pathInput.value = path;
            if (upBtn) {
                var parent = path.replace(/\/+$/, '').split('/').slice(0, -1).join('/') || '/';
                upBtn.disabled = (parent === path || path === '/' || path === '');
            }
            listEl.innerHTML = '<div style="padding: 16px; color: #94a3b8;"><i class="fas fa-spinner fa-spin"></i> Loading...</div>';
            fetch('./api/tv-hunt/root-folders/browse?path=' + encodeURIComponent(path))
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    var dirs = (data && data.directories) ? data.directories : [];
                    var err = data && data.error;
                    if (err) {
                        listEl.innerHTML = '<div style="padding: 16px; color: #f87171;">' + (String(err).replace(/</g, '&lt;')) + '</div>';
                        return;
                    }
                    if (pathInput) pathInput.value = data.path || path;
                    if (upBtn) {
                        var currentPath = (pathInput.value || '').trim() || '/';
                        var parent = currentPath.replace(/\/+$/, '').split('/').slice(0, -1).join('/') || '/';
                        upBtn.disabled = (parent === currentPath || currentPath === '/' || currentPath === '');
                    }
                    var html = '';
                    for (var i = 0; i < dirs.length; i++) {
                        var d = dirs[i];
                        var rawName = d.name || '';
                        var name = rawName.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
                        var p = (d.path || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
                        var nameAttr = rawName.replace(/"/g, '&quot;');
                        html += '<div class="root-folders-browse-item" data-path="' + p + '" data-name="' + nameAttr + '" title="' + p + '">' +
                            '<span class="root-folders-browse-item-main">' +
                            '<i class="fas fa-folder"></i>' +
                            '<span class="root-folders-browse-item-path">' + name + '</span>' +
                            '</span>' +
                            '<span class="root-folders-browse-item-actions">' +
                            '<button type="button" class="root-folders-browse-item-btn" data-action="rename" title="Rename"><i class="fas fa-pen"></i></button>' +
                            '<button type="button" class="root-folders-browse-item-btn" data-action="delete" title="Delete"><i class="fas fa-trash"></i></button>' +
                            '</span></div>';
                    }
                    listEl.innerHTML = html || '<div style="padding: 16px; color: #64748b;">No subdirectories</div>';
                    listEl.querySelectorAll('.root-folders-browse-item').forEach(function(el) {
                        var main = el.querySelector('.root-folders-browse-item-main');
                        if (main) {
                            main.onclick = function() {
                                var p = el.getAttribute('data-path') || '';
                                if (p) window.TVHuntRootFolders.loadBrowsePath(p);
                            };
                        }
                        el.querySelectorAll('.root-folders-browse-item-btn').forEach(function(btn) {
                            btn.onclick = function(e) {
                                e.stopPropagation();
                                var action = btn.getAttribute('data-action');
                                var p = el.getAttribute('data-path') || '';
                                var name = el.getAttribute('data-name') || '';
                                if (action === 'rename') window.TVHuntRootFolders.browseRenameFolder(p, name);
                                else if (action === 'delete') window.TVHuntRootFolders.browseDeleteFolder(p);
                            };
                        });
                    });
                })
                .catch(function() {
                    listEl.innerHTML = '<div style="padding: 16px; color: #f87171;">Failed to load</div>';
                });
        },

        init: function() {
            var self = window.TVHuntRootFolders;
            var addBackdrop = document.getElementById('tv-hunt-root-folder-add-modal-backdrop');
            var addClose = document.getElementById('tv-hunt-root-folder-add-modal-close');
            var addCancel = document.getElementById('tv-hunt-root-folder-add-modal-cancel');
            var addSave = document.getElementById('tv-hunt-root-folder-add-modal-save');
            var addBrowseBtn = document.getElementById('tv-hunt-root-folder-add-browse-btn');
            var addTestBtn = document.getElementById('tv-hunt-root-folder-add-test-btn');
            var addPathInput = document.getElementById('tv-hunt-root-folder-add-path');
            if (addBackdrop) addBackdrop.onclick = function() { self.closeAddModal(); };
            if (addClose) addClose.onclick = function() { self.closeAddModal(); };
            if (addCancel) addCancel.onclick = function() { self.closeAddModal(); };
            if (addSave) addSave.onclick = function() { self.addFolder(); };
            if (addBrowseBtn && addPathInput) addBrowseBtn.onclick = function() { self.openBrowseModal(addPathInput); };
            if (addTestBtn) addTestBtn.onclick = function() { self.testPath(); };
            if (addPathInput) {
                addPathInput.addEventListener('keydown', function(e) {
                    if (e.key === 'Enter') { e.preventDefault(); self.addFolder(); }
                });
            }
            document.addEventListener('keydown', function(e) {
                if (e.key === 'Escape') {
                    if (document.getElementById('tv-hunt-root-folder-add-modal') && document.getElementById('tv-hunt-root-folder-add-modal').style.display === 'flex') {
                        self.closeAddModal();
                    }
                    if (document.getElementById('tv-hunt-root-folders-browse-modal') && document.getElementById('tv-hunt-root-folders-browse-modal').style.display === 'flex') {
                        self.closeBrowseModal();
                    }
                }
            });
            var browseBackdrop = document.getElementById('tv-hunt-root-folders-browse-backdrop');
            var browseClose = document.getElementById('tv-hunt-root-folders-browse-close');
            var browseCancel = document.getElementById('tv-hunt-root-folders-browse-cancel');
            var browseOk = document.getElementById('tv-hunt-root-folders-browse-ok');
            var browsePathInput = document.getElementById('tv-hunt-root-folders-browse-path-input');
            if (browseBackdrop) browseBackdrop.onclick = function() { self.closeBrowseModal(); };
            if (browseClose) browseClose.onclick = function() { self.closeBrowseModal(); };
            if (browseCancel) browseCancel.onclick = function() { self.closeBrowseModal(); };
            if (browseOk) browseOk.onclick = function() { self.confirmBrowseSelection(); };
            if (browsePathInput) {
                browsePathInput.addEventListener('keydown', function(e) {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        self.loadBrowsePath(browsePathInput.value);
                    }
                });
            }
            var upBtn = document.getElementById('tv-hunt-root-folders-browse-up');
            if (upBtn) upBtn.onclick = function() { self.goToParent(); };
            var newFolderBtn = document.getElementById('tv-hunt-root-folders-browse-new-folder');
            if (newFolderBtn) newFolderBtn.onclick = function() { self.browseCreateFolder(); };
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() { window.TVHuntRootFolders.init(); });
    } else {
        window.TVHuntRootFolders.init();
    }
})();


/* === modules/utils/tmdb-image-cache-standalone.js === */
/**
 * TMDB Image Cache Utility (Non-Module Version)
 * Caches TMDB images in localStorage to reduce API calls and improve load times
 */

(function() {
    const CACHE_PREFIX = 'tmdb_img_';
    const CACHE_METADATA_KEY = 'tmdb_cache_metadata';

    class TMDBImageCache {
    constructor() {
        this.cacheDays = 7; // Default to 7 days
        this.enabled = true;
        this.storage = 'server'; // Default to server storage
    }

    /**
     * Initialize cache settings from API
     */
    async init() {
        try {
            const response = await fetch('./api/settings');
            const data = await response.json();
            if (data.success && data.settings && data.settings.general) {
                const cacheDays = data.settings.general.tmdb_image_cache_days;
                this.cacheDays = cacheDays !== undefined ? cacheDays : 7;
                this.enabled = this.cacheDays > 0;
                console.log(`[TMDBImageCache] Initialized with ${this.cacheDays} day server-side cache ${this.enabled ? 'enabled' : 'disabled'}`);
            }
        } catch (error) {
            console.error('[TMDBImageCache] Failed to load settings:', error);
        }
    }

        loadMetadata() { return {}; }
        saveMetadata() {}
        getCacheKey(url) { return null; }
        isCacheValid(key) { return false; }
        get(url) { return null; }
        async set(url, imageData) {}
        remove(key) {}
        cleanup(force = false) {}
        clearAll() {}
        getStats() {
            return {
                entries: 0,
                totalSizeKB: 0,
                cacheDays: this.cacheDays,
                enabled: this.enabled
            };
        }
    }

    /**
     * Get cached TMDB image or fetch via server proxy
     */
    async function getCachedTMDBImage(url, cache) {
        if (!url) return url;
        
        // Always use server proxy endpoint which handles caching server-side
        return `./api/tmdb/image?url=${encodeURIComponent(url)}`;
    }

    // Create singleton instance and make it globally available
    window.tmdbImageCache = new TMDBImageCache();
    window.getCachedTMDBImage = getCachedTMDBImage;
})();
