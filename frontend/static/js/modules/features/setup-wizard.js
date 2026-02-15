/**
 * Media Hunt Setup Wizard — guided configuration flow inside Media Hunt.
 *
 * Shows a full-takeover wizard when the user first navigates to any Media
 * Hunt section and essential configuration is missing.  Steps:
 *   1. Instance   2. Indexers   3. Root Folders   4. Download Client
 *   5. (conditional) Usenet Servers — shown only when NZB Hunt is configured
 *      as the download client.
 *
 * Once all steps are complete **or** the user clicks "Skip", the wizard
 * never appears again (flag stored in localStorage).
 *
 * Attaches to window.SetupWizard.
 */
(function() {
    'use strict';

    var PREF_KEY = 'media-hunt-wizard-completed';
    var TOTAL_BASE_STEPS = 4;          // steps 1-4 (always present)
    var stepStatus = { 1: false, 2: false, 3: false, 4: false, 5: false };
    var nzbHuntIsClient = false;       // whether step 5 is relevant
    var _refreshing = false;

    // ── Public API ───────────────────────────────────────────────────
    window.SetupWizard = {
        /**
         * Should the wizard be shown?  Checks localStorage first (fast path)
         * then verifies against APIs.  Calls `cb(needsWizard)`.
         */
        check: function(cb) {
            if (_isDismissed()) { cb(false); return; }

            _checkAllSteps(function() {
                var allDone = _allStepsComplete();
                if (allDone) {
                    // Auto-mark complete so it never shows again
                    _markComplete();
                    cb(false);
                } else {
                    cb(true);
                }
            });
        },

        /**
         * Show the wizard view and update its step indicators.
         * Called by app.js after `check()` returns true.
         */
        show: function() {
            var view = document.getElementById('media-hunt-setup-wizard-view');
            if (view) view.style.display = '';
            _setSidebarVisible(false);
            _updateStepUI();
            _expandFirstIncomplete();
            _maybeShowReturnBanner();
        },

        /**
         * Hide the wizard view and restore sidebar.
         */
        hide: function() {
            var view = document.getElementById('media-hunt-setup-wizard-view');
            if (view) view.style.display = 'none';
            _setSidebarVisible(true);
        },

        /**
         * Re-check all steps and update UI.  Used when user returns from
         * a configuration page back to any Media Hunt section.
         */
        refresh: function(cb) {
            if (_refreshing) { if (cb) cb(); return; }
            _refreshing = true;
            _checkAllSteps(function() {
                _refreshing = false;
                var allDone = _allStepsComplete();
                if (allDone) {
                    _markComplete();
                    if (cb) cb();
                    return;
                }
                _updateStepUI();
                _expandFirstIncomplete();
                if (cb) cb();
            });
        },

        /** Cached status from last check. */
        isComplete: function() {
            return _isDismissed() || _allStepsComplete();
        },

        /**
         * Call after successful save on a wizard-related config page (instances,
         * indexers, root folders, clients). If the wizard is still incomplete,
         * redirects to Collections so the wizard refreshes and shows the next step.
         */
        maybeReturnToCollection: function() {
            if (this.isComplete()) return;
            try { sessionStorage.setItem('setup-wizard-return-from-config', '1'); } catch (e) {}
            if (window.huntarrUI && typeof window.huntarrUI.switchSection === 'function') {
                window.huntarrUI.switchSection('media-hunt-collection');
            } else {
                window.location.hash = '#media-hunt-collection';
            }
        }
    };

    // ── Helpers ───────────────────────────────────────────────────────
    function _isDismissed() {
        return HuntarrUtils.getUIPreference(PREF_KEY, false) === true;
    }

    function _markComplete() {
        HuntarrUtils.setUIPreference(PREF_KEY, true);
    }

    function _totalSteps() {
        return nzbHuntIsClient ? TOTAL_BASE_STEPS + 1 : TOTAL_BASE_STEPS;
    }

    function _allStepsComplete() {
        for (var s = 1; s <= _totalSteps(); s++) {
            if (!stepStatus[s]) return false;
        }
        return true;
    }

    function _setSidebarVisible(visible) {
        var wrapper = document.getElementById('sidebar-wrapper');
        if (wrapper) wrapper.style.display = visible ? '' : 'none';
    }

    function _maybeShowReturnBanner() {
        try {
            if (sessionStorage.getItem('setup-wizard-return-from-config') !== '1') return;
            sessionStorage.removeItem('setup-wizard-return-from-config');
        } catch (e) { return; }
        var wizard = document.getElementById('media-hunt-setup-wizard');
        if (!wizard) return;
        var banner = document.createElement('div');
        banner.className = 'setup-wizard-return-banner';
        banner.setAttribute('role', 'status');
        banner.innerHTML = '<i class="fas fa-check-circle"></i> Configuration saved! Continue with the next step below.';
        wizard.insertBefore(banner, wizard.firstChild);
        setTimeout(function() {
            banner.style.opacity = '0';
            banner.style.transition = 'opacity 0.3s ease';
            setTimeout(function() { if (banner.parentNode) banner.parentNode.removeChild(banner); }, 300);
        }, 4500);
    }

    // ── Step Checks ─────────────────────────────────────────────────
    function _checkAllSteps(cb) {
        var ts = '?_=' + Date.now();
        Promise.all([
            fetch('./api/movie-hunt/instances' + ts, { cache: 'no-store' }).then(function(r) { return r.json(); }),
            fetch('./api/tv-hunt/instances' + ts, { cache: 'no-store' }).then(function(r) { return r.json(); }),
            fetch('./api/indexer-hunt/indexers' + ts, { cache: 'no-store' }).then(function(r) { return r.json(); }),
            fetch('./api/movie-hunt/has-clients' + ts, { cache: 'no-store' }).then(function(r) { return r.json(); }),
            fetch('./api/nzb-hunt/is-client-configured' + ts, { cache: 'no-store' }).then(function(r) { return r.json(); }).catch(function() { return { configured: false }; })
        ]).then(function(results) {
            var movieInstances = results[0].instances || [];
            var tvInstances    = results[1].instances || [];
            var indexers       = results[2].indexers || [];
            var hasClients     = results[3].has_clients === true;
            nzbHuntIsClient    = results[4].configured === true;

            stepStatus[1] = movieInstances.length > 0 || tvInstances.length > 0;
            stepStatus[2] = indexers.length > 0;
            stepStatus[4] = hasClients;

            // Toggle step 5 visibility
            var step5el = document.getElementById('setup-step-5');
            if (step5el) step5el.style.display = nzbHuntIsClient ? '' : 'none';

            // Root folders — need at least one instance first
            if (stepStatus[1]) {
                _checkRootFolders(movieInstances, tvInstances, function(hasRoots) {
                    stepStatus[3] = hasRoots;
                    // NZB servers
                    if (nzbHuntIsClient) {
                        _checkNzbServers(function(hasServers) {
                            stepStatus[5] = hasServers;
                            if (cb) cb();
                        });
                    } else {
                        stepStatus[5] = true; // not applicable — treat as done
                        if (cb) cb();
                    }
                });
            } else {
                stepStatus[3] = false;
                if (nzbHuntIsClient) {
                    _checkNzbServers(function(hasServers) {
                        stepStatus[5] = hasServers;
                        if (cb) cb();
                    });
                } else {
                    stepStatus[5] = true;
                    if (cb) cb();
                }
            }
        }).catch(function() {
            stepStatus[1] = stepStatus[2] = stepStatus[3] = stepStatus[4] = stepStatus[5] = false;
            nzbHuntIsClient = false;
            if (cb) cb();
        });
    }

    function _checkRootFolders(movieInstances, tvInstances, cb) {
        var fetches = [];
        if (movieInstances.length > 0) {
            fetches.push(
                fetch('./api/movie-hunt/root-folders', { cache: 'no-store' })
                    .then(function(r) { return r.json(); })
                    .then(function(d) { return (d.root_folders || d.rootFolders || []).length > 0; })
                    .catch(function() { return false; })
            );
        }
        if (tvInstances.length > 0) {
            fetches.push(
                fetch('./api/tv-hunt/root-folders', { cache: 'no-store' })
                    .then(function(r) { return r.json(); })
                    .then(function(d) { return (d.root_folders || d.rootFolders || []).length > 0; })
                    .catch(function() { return false; })
            );
        }
        if (fetches.length === 0) { cb(false); return; }
        Promise.all(fetches).then(function(results) {
            cb(results.some(function(v) { return v; }));
        }).catch(function() { cb(false); });
    }

    function _checkNzbServers(cb) {
        fetch('./api/nzb-hunt/home-stats', { cache: 'no-store' })
            .then(function(r) { return r.json(); })
            .then(function(d) {
                cb(d.servers && d.servers.length > 0);
            })
            .catch(function() { cb(false); });
    }

    // ── UI Updates ──────────────────────────────────────────────────
    function _updateStepUI() {
        var total = _totalSteps();
        var completedCount = 0;

        for (var s = 1; s <= 5; s++) {
            var stepEl    = document.getElementById('setup-step-' + s);
            var indicator = document.getElementById('setup-step-indicator-' + s);
            if (!stepEl || !indicator) continue;
            if (s > total) { stepEl.style.display = 'none'; continue; }

            stepEl.classList.remove('completed', 'current');

            if (stepStatus[s]) {
                stepEl.classList.add('completed');
                completedCount++;
                if (!indicator.querySelector('.step-check')) {
                    var check = document.createElement('i');
                    check.className = 'fas fa-check step-check';
                    indicator.appendChild(check);
                }
            } else {
                // Remove leftover check icon if step became incomplete
                var existing = indicator.querySelector('.step-check');
                if (existing) existing.remove();
            }
        }

        // Mark first incomplete step as "current"
        for (var s = 1; s <= total; s++) {
            if (!stepStatus[s]) {
                var el = document.getElementById('setup-step-' + s);
                if (el) el.classList.add('current');
                break;
            }
        }

        // Progress bar
        var fill = document.getElementById('setup-wizard-progress-fill');
        if (fill) {
            fill.style.width = (completedCount / total * 100) + '%';
        }
    }

    function _expandFirstIncomplete() {
        var total = _totalSteps();
        for (var s = 1; s <= 5; s++) {
            var el = document.getElementById('setup-step-' + s);
            if (el) el.classList.remove('expanded');
        }
        for (var s = 1; s <= total; s++) {
            if (!stepStatus[s]) {
                _expandStep(s);
                break;
            }
        }
    }

    function _expandStep(num) {
        var stepEl = document.getElementById('setup-step-' + num);
        if (!stepEl) return;
        for (var s = 1; s <= 5; s++) {
            var el = document.getElementById('setup-step-' + s);
            if (el && s !== num) el.classList.remove('expanded');
        }
        stepEl.classList.toggle('expanded');
    }

    // ── Event Bindings ──────────────────────────────────────────────
    function _bindEvents() {
        document.addEventListener('click', function(e) {
            // Wizard nav buttons (use switchSection for reliable navigation)
            var navBtn = e.target.closest('[data-wizard-nav]');
            if (navBtn) {
                var section = navBtn.getAttribute('data-wizard-nav');
                if (section && window.huntarrUI && typeof window.huntarrUI.switchSection === 'function') {
                    window.huntarrUI.switchSection(section);
                } else if (section) {
                    window.location.hash = '#' + section;
                }
                return;
            }

            // Step header toggle
            var header = e.target.closest('[data-step-toggle]');
            if (header) {
                var step = parseInt(header.getAttribute('data-step-toggle'), 10);
                if (!isNaN(step)) _expandStep(step);
            }

            // Skip button — permanently dismiss
            if (e.target.closest('#setup-wizard-skip')) {
                _markComplete();
                window.SetupWizard.hide();
                var collView = document.getElementById('media-hunt-collection-view');
                if (collView) collView.style.display = 'block';
                if (window.MediaHuntCollection && typeof window.MediaHuntCollection.init === 'function') {
                    window.MediaHuntCollection.init();
                }
            }
        });
    }

    // ── Init ────────────────────────────────────────────────────────
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _bindEvents);
    } else {
        _bindEvents();
    }
})();
