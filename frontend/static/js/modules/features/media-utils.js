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
