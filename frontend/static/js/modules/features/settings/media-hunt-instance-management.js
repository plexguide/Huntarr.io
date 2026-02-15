/**
 * Media Hunt Instance Management – shows Movie and TV instance lists in separate sections.
 * Loads both, wires Add Instance modals, and delegates click handlers.
 */
(function() {
    'use strict';

    var baseUrl = (typeof window !== 'undefined' && window.HUNTARR_BASE_URL) ? window.HUNTARR_BASE_URL.replace(/\/$/, '') : '';
    function api(path) {
        return (baseUrl || '') + (path.indexOf('./') === 0 ? path : './' + path);
    }

    window.MediaHuntInstanceManagement = window.MediaHuntInstanceManagement || {};

    function openAddMovieModal() {
        var modal = document.getElementById('media-hunt-instance-add-movie-modal');
        var input = document.getElementById('media-hunt-instance-add-movie-name');
        if (modal && modal.parentNode !== document.body) document.body.appendChild(modal);
        if (modal) modal.style.display = 'flex';
        if (input) { input.value = ''; setTimeout(function() { input.focus(); }, 100); }
        document.body.classList.add('media-hunt-instance-add-modal-open');
    }

    function closeAddMovieModal() {
        var modal = document.getElementById('media-hunt-instance-add-movie-modal');
        if (modal) modal.style.display = 'none';
        document.body.classList.remove('media-hunt-instance-add-modal-open');
    }

    function openAddTVModal() {
        var modal = document.getElementById('media-hunt-instance-add-tv-modal');
        var input = document.getElementById('media-hunt-instance-add-tv-name');
        if (modal && modal.parentNode !== document.body) document.body.appendChild(modal);
        if (modal) modal.style.display = 'flex';
        if (input) { input.value = ''; setTimeout(function() { input.focus(); }, 100); }
        document.body.classList.add('media-hunt-instance-add-modal-open');
    }

    function closeAddTVModal() {
        var modal = document.getElementById('media-hunt-instance-add-tv-modal');
        if (modal) modal.style.display = 'none';
        document.body.classList.remove('media-hunt-instance-add-modal-open');
    }

    var _modalsInited = false;
    function initModals() {
        if (_modalsInited) return;
        _modalsInited = true;
        var movieBackdrop = document.getElementById('media-hunt-instance-add-movie-modal-backdrop');
        var movieClose = document.getElementById('media-hunt-instance-add-movie-modal-close');
        var movieCancel = document.getElementById('media-hunt-instance-add-movie-modal-cancel');
        var movieSave = document.getElementById('media-hunt-instance-add-movie-modal-save');
        var movieInput = document.getElementById('media-hunt-instance-add-movie-name');
        if (movieBackdrop) movieBackdrop.onclick = closeAddMovieModal;
        if (movieClose) movieClose.onclick = closeAddMovieModal;
        if (movieCancel) movieCancel.onclick = closeAddMovieModal;
        if (movieSave && movieInput) {
            movieSave.onclick = function() {
                var name = (movieInput.value || '').trim() || 'Unnamed';
                movieSave.disabled = true;
                fetch(api('./api/movie-hunt/instances'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: name })
                })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.success) {
                        if (typeof document.dispatchEvent === 'function') {
                            document.dispatchEvent(new CustomEvent('huntarr:instances-changed'));
                        }
                        if (window.MovieHuntInstanceEditor && window.MovieHuntInstanceEditor.loadInstanceList) {
                            window.MovieHuntInstanceEditor.loadInstanceList();
                        }
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification('Movie instance added.', 'success');
                        }
                        closeAddMovieModal();
                    } else {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification(data.error || 'Failed to add instance.', 'error');
                        }
                    }
                })
                .catch(function() {
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification('Failed to add instance.', 'error');
                    }
                })
                .finally(function() { movieSave.disabled = false; });
            };
        }

        var tvBackdrop = document.getElementById('media-hunt-instance-add-tv-modal-backdrop');
        var tvClose = document.getElementById('media-hunt-instance-add-tv-modal-close');
        var tvCancel = document.getElementById('media-hunt-instance-add-tv-modal-cancel');
        var tvSave = document.getElementById('media-hunt-instance-add-tv-modal-save');
        var tvInput = document.getElementById('media-hunt-instance-add-tv-name');
        if (tvBackdrop) tvBackdrop.onclick = closeAddTVModal;
        if (tvClose) tvClose.onclick = closeAddTVModal;
        if (tvCancel) tvCancel.onclick = closeAddTVModal;
        if (tvSave && tvInput) {
            tvSave.onclick = function() {
                var name = (tvInput.value || '').trim() || 'Unnamed';
                tvSave.disabled = true;
                fetch(api('./api/tv-hunt/instances'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: name })
                })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.success) {
                        if (typeof document.dispatchEvent === 'function') {
                            document.dispatchEvent(new CustomEvent('huntarr:tv-hunt-instances-changed'));
                        }
                        if (window.TVHuntInstanceEditor && window.TVHuntInstanceEditor.loadInstanceList) {
                            window.TVHuntInstanceEditor.loadInstanceList();
                        }
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification('TV instance added.', 'success');
                        }
                        closeAddTVModal();
                    } else {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification(data.error || 'Failed to add instance.', 'error');
                        }
                    }
                })
                .catch(function() {
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification('Failed to add instance.', 'error');
                    }
                })
                .finally(function() { tvSave.disabled = false; });
            };
        }

        document.addEventListener('keydown', function modalKeydown(e) {
            if (e.key !== 'Escape') return;
            var movieModal = document.getElementById('media-hunt-instance-add-movie-modal');
            var tvModal = document.getElementById('media-hunt-instance-add-tv-modal');
            if (movieModal && movieModal.style.display === 'flex') { closeAddMovieModal(); return; }
            if (tvModal && tvModal.style.display === 'flex') { closeAddTVModal(); return; }
        });
    }

    function initGridListeners() {
        var movieGrid = document.getElementById('movie-hunt-settings-instances-grid');
        var tvGrid = document.getElementById('tv-hunt-settings-instances-grid');
        if (movieGrid && !movieGrid._instanceMgmtBound) {
            movieGrid._instanceMgmtBound = true;
            movieGrid.addEventListener('click', function(e) {
                var addCard = e.target.closest('.add-instance-card[data-app-type="media-hunt-instance-movie"]');
                if (addCard) {
                    e.preventDefault();
                    e.stopPropagation();
                    openAddMovieModal();
                }
            });
        }
        if (tvGrid && !tvGrid._instanceMgmtBound) {
            tvGrid._instanceMgmtBound = true;
            tvGrid.addEventListener('click', function(e) {
                var addCard = e.target.closest('.add-instance-card[data-app-type="media-hunt-instance-tv"]');
                if (addCard) {
                    e.preventDefault();
                    e.stopPropagation();
                    openAddTVModal();
                }
            });
        }
    }

    function updateSetupWizardBanner() {
        var banner = document.getElementById('setup-wizard-continue-banner');
        if (!banner) return;
        // Only show if user navigated here from the setup wizard
        var fromWizard = false;
        try { fromWizard = sessionStorage.getItem('setup-wizard-active-nav') === '1'; } catch (e) {}
        if (fromWizard) { try { sessionStorage.removeItem('setup-wizard-active-nav'); } catch (e) {} }
        banner.style.display = fromWizard ? 'flex' : 'none';
    }

    window.MediaHuntInstanceManagement.init = function() {
        initModals();
        initGridListeners();
        updateSetupWizardBanner();
        document.addEventListener('huntarr:instances-changed', updateSetupWizardBanner);
        document.addEventListener('huntarr:tv-hunt-instances-changed', updateSetupWizardBanner);
        if (window.MovieHuntInstanceEditor && typeof window.MovieHuntInstanceEditor.loadInstanceList === 'function') {
            window.MovieHuntInstanceEditor.loadInstanceList();
        }
        if (window.TVHuntInstanceEditor && typeof window.TVHuntInstanceEditor.loadInstanceList === 'function') {
            window.TVHuntInstanceEditor.loadInstanceList();
        }
    };
})();
