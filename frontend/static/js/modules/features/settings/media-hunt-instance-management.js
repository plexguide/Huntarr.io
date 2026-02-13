/**
 * Media Hunt Instance Management – single implementation for Movie Hunt and TV Hunt.
 * Mode is set by the router via window._mediaHuntInstanceManagementMode ('movie' | 'tv').
 * Uses ./api/movie-hunt/instances or ./api/tv-hunt/instances accordingly.
 */
(function() {
    'use strict';

    var baseUrl = (typeof window !== 'undefined' && window.HUNTARR_BASE_URL) ? window.HUNTARR_BASE_URL.replace(/\/$/, '') : '';

    function api(path) {
        return (baseUrl || '') + (path.indexOf('./') === 0 ? path : './' + path);
    }

    function getMode() {
        var m = (window._mediaHuntInstanceManagementMode || 'movie').toLowerCase();
        return (m === 'tv') ? 'tv' : 'movie';
    }

    function getApiBase() {
        return getMode() === 'tv' ? './api/tv-hunt' : './api/movie-hunt';
    }

    function getApiBaseForMode(mode) {
        return (mode === 'tv') ? './api/tv-hunt' : './api/movie-hunt';
    }

    function isCombinedView() {
        return !!(document.getElementById('media-hunt-tv-instances-grid') && document.getElementById('media-hunt-movie-instances-grid'));
    }

    function escapeHtml(s) {
        if (s == null) return '';
        var str = String(s);
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function escapeAttr(s) {
        if (s == null) return '';
        return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    var MOVIE_DROPDOWN_IDS = [
        'movie-hunt-instance-select', 'movie-hunt-collection-instance-select',
        'settings-clients-instance-select',
        'import-media-instance-select'
    ];

    var TV_DROPDOWN_IDS = [
        'tv-hunt-instance-select', 'tv-hunt-collection-instance-select',
        'tv-hunt-settings-clients-instance-select'
    ];

    function refreshDropdowns() {
        var mode = getMode();
        if (mode === 'movie' && window.MovieHuntInstanceDropdown && window.MovieHuntInstanceDropdown.refresh) {
            MOVIE_DROPDOWN_IDS.forEach(function(id) {
                if (document.getElementById(id)) window.MovieHuntInstanceDropdown.refresh(id);
            });
        } else if (mode === 'tv' && window.TVHuntInstanceDropdown && window.TVHuntInstanceDropdown.refreshAll) {
            window.TVHuntInstanceDropdown.refreshAll();
        }
    }

    function afterInstanceChange() {
        var mode = getMode();
        var appType = mode === 'tv' ? 'tv_hunt' : 'movie_hunt';
        try { document.dispatchEvent(new CustomEvent('huntarr:instances-changed', { detail: { appType: appType } })); } catch (e) {}
        if (mode === 'tv') {
            try { document.dispatchEvent(new CustomEvent('huntarr:tv-hunt-instances-changed')); } catch (e) {}
            if (window.updateTVHuntSettingsVisibility) window.updateTVHuntSettingsVisibility();
        } else {
            if (window.updateMovieHuntSettingsVisibility) window.updateMovieHuntSettingsVisibility();
        }
        refreshDropdowns();
    }

    window.MediaHuntInstanceManagement = {
        _initialized: false,
        _universalInitialized: false,

        init: function() {
            var self = this;
            var combined = isCombinedView();

            if (combined) {
                var desc = document.getElementById('media-hunt-instance-management-description');
                if (desc) desc.textContent = 'Configure instances for TV Hunt and Movie Hunt. Each instance has its own queue, history, blocklist, and media.';
                var universalGroup = document.getElementById('media-hunt-universal-settings-group');
                if (universalGroup) universalGroup.style.display = 'block';
                if (!this._initialized) {
                    this._initialized = true;
                    var tvAdd = document.getElementById('media-hunt-tv-instances-add-card');
                    var movieAdd = document.getElementById('media-hunt-movie-instances-add-card');
                    if (tvAdd) tvAdd.addEventListener('click', function() { self.openAddModal('tv'); });
                    if (movieAdd) movieAdd.addEventListener('click', function() { self.openAddModal('movie'); });
                    this.initAddModal();
                    this.initDeleteModal();
                    this.initRenameModal();
                }
                if (!this._universalInitialized) {
                    this._universalInitialized = true;
                    this.initUniversalVideoModal();
                }
                this.loadListForMode('tv');
                this.loadListForMode('movie');
                this.loadUniversalVideoCard();
                return;
            }

            var mode = getMode();
            var title = document.getElementById('media-hunt-instance-management-title');
            if (title) title.textContent = (mode === 'movie' ? 'Movie Hunt' : 'TV Hunt') + ' Instances';
            var universalGroup = document.getElementById('media-hunt-universal-settings-group');
            if (universalGroup) universalGroup.style.display = (mode === 'movie') ? 'block' : 'none';

            if (!this._initialized) {
                this._initialized = true;
                var addCard = document.getElementById('media-hunt-instance-management-add-card');
                if (addCard) addCard.addEventListener('click', function() { self.openAddModal(mode); });
                this.initAddModal();
                this.initDeleteModal();
                this.initRenameModal();
            }
            if (mode === 'movie' && !this._universalInitialized) {
                this._universalInitialized = true;
                this.initUniversalVideoModal();
            }
            this.loadList();
            if (mode === 'movie') this.loadUniversalVideoCard();
        },

        initUniversalVideoModal: function() {
            var self = this;
            var modal = document.getElementById('mh-universal-video-modal');
            var backdrop = document.getElementById('mh-universal-video-modal-backdrop');
            var closeBtn = document.getElementById('mh-universal-video-modal-close');
            var cancelBtn = document.getElementById('mh-universal-video-modal-cancel');
            var saveBtn = document.getElementById('mh-universal-video-save-btn');
            var editBtn = document.getElementById('mh-universal-video-edit-btn');
            var analyzeToggle = document.getElementById('mh-universal-analyze-video-files');
            var strategyGroup = document.getElementById('mh-universal-video-scan-strategy-group');
            var profileGroup = document.getElementById('mh-universal-video-scan-profile-group');
            if (!modal) return;

            function closeModal() {
                modal.style.display = 'none';
                document.body.classList.remove('instance-add-modal-open');
            }
            if (backdrop) backdrop.onclick = closeModal;
            if (closeBtn) closeBtn.onclick = closeModal;
            if (cancelBtn) cancelBtn.onclick = closeModal;
            document.addEventListener('keydown', function(e) {
                if (e.key === 'Escape' && modal.style.display === 'flex') closeModal();
            });
            if (analyzeToggle) {
                analyzeToggle.addEventListener('change', function() {
                    var show = analyzeToggle.checked;
                    if (strategyGroup) strategyGroup.style.display = show ? 'block' : 'none';
                    if (profileGroup) profileGroup.style.display = show ? 'block' : 'none';
                });
            }
            if (editBtn) editBtn.addEventListener('click', function() { self.openUniversalVideoModal(); });
            if (saveBtn) saveBtn.addEventListener('click', function() { self.saveUniversalVideoSettings(closeModal); });
        },

        openUniversalVideoModal: function() {
            var modal = document.getElementById('mh-universal-video-modal');
            var analyzeToggle = document.getElementById('mh-universal-analyze-video-files');
            var strategySelect = document.getElementById('mh-universal-video-scan-strategy');
            var strategyGroup = document.getElementById('mh-universal-video-scan-strategy-group');
            var profileSelect = document.getElementById('mh-universal-video-scan-profile');
            var profileGroup = document.getElementById('mh-universal-video-scan-profile-group');
            if (!modal) return;

            fetch(api('./api/movie-hunt/universal-video-settings'), { cache: 'no-store' })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    var enabled = data.analyze_video_files !== false;
                    if (analyzeToggle) analyzeToggle.checked = enabled;
                    if (strategySelect) strategySelect.value = (data.video_scan_strategy || 'trust_filename').toLowerCase();
                    if (profileSelect) profileSelect.value = (data.video_scan_profile || 'default').toLowerCase();
                    if (strategyGroup) strategyGroup.style.display = enabled ? 'block' : 'none';
                    if (profileGroup) profileGroup.style.display = enabled ? 'block' : 'none';
                })
                .catch(function() {
                    if (analyzeToggle) analyzeToggle.checked = true;
                    if (strategySelect) strategySelect.value = 'trust_filename';
                    if (profileSelect) profileSelect.value = 'default';
                    if (strategyGroup) strategyGroup.style.display = 'block';
                    if (profileGroup) profileGroup.style.display = 'block';
                })
                .finally(function() {
                    if (modal.parentNode !== document.body) document.body.appendChild(modal);
                    modal.style.display = 'flex';
                    document.body.classList.add('instance-add-modal-open');
                });
        },

        saveUniversalVideoSettings: function(closeModalFn) {
            var self = this;
            var analyzeToggle = document.getElementById('mh-universal-analyze-video-files');
            var strategySelect = document.getElementById('mh-universal-video-scan-strategy');
            var profileSelect = document.getElementById('mh-universal-video-scan-profile');
            var saveBtn = document.getElementById('mh-universal-video-save-btn');
            if (!analyzeToggle || !profileSelect) return;

            var payload = {
                analyze_video_files: !!analyzeToggle.checked,
                video_scan_strategy: (strategySelect ? strategySelect.value : 'trust_filename').toLowerCase(),
                video_scan_profile: (profileSelect.value || 'default').toLowerCase()
            };
            if (saveBtn) { saveBtn.disabled = true; saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...'; }

            fetch(api('./api/movie-hunt/universal-video-settings'), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.error) {
                        if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification(data.error, 'error');
                    } else {
                        if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Video settings saved.', 'success');
                        if (closeModalFn) closeModalFn();
                        self.loadUniversalVideoCard();
                    }
                })
                .catch(function() {
                    if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Failed to save video settings.', 'error');
                })
                .finally(function() {
                    if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = '<i class="fas fa-save"></i> Save'; }
                });
        },

        loadUniversalVideoCard: function() {
            var statusIcon = document.getElementById('mh-universal-video-status-icon');
            var profileLabel = document.getElementById('mh-universal-video-profile-label');
            var strategyLabel = document.getElementById('mh-universal-video-strategy-label');
            fetch(api('./api/movie-hunt/universal-video-settings'), { cache: 'no-store' })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    var enabled = data.analyze_video_files !== false;
                    var profile = (data.video_scan_profile || 'default');
                    var strategy = (data.video_scan_strategy || 'trust_filename');
                    var profileMap = { light: 'Light', 'default': 'Default', moderate: 'Moderate', heavy: 'Heavy', maximum: 'Maximum' };
                    var strategyMap = { trust_filename: 'Trust Filename', always_verify: 'Always Verify' };
                    if (statusIcon) {
                        statusIcon.className = 'instance-status-icon ' + (enabled ? 'status-connected' : 'status-disabled');
                        statusIcon.title = enabled ? 'Enabled' : 'Disabled';
                        statusIcon.innerHTML = enabled ? '<i class="fas fa-check-circle"></i>' : '<i class="fas fa-minus-circle"></i>';
                    }
                    if (profileLabel) profileLabel.textContent = profileMap[profile] || 'Default';
                    if (strategyLabel) strategyLabel.textContent = strategyMap[strategy] || 'Trust Filename';
                })
                .catch(function() {});
        },

        initAddModal: function() {
            var self = this;
            var modal = document.getElementById('media-hunt-instance-add-modal');
            var backdrop = document.getElementById('media-hunt-instance-add-modal-backdrop');
            var closeBtn = document.getElementById('media-hunt-instance-add-modal-close');
            var cancelBtn = document.getElementById('media-hunt-instance-add-modal-cancel');
            var okBtn = document.getElementById('media-hunt-instance-add-modal-ok');
            var input = document.getElementById('media-hunt-instance-add-name');
            if (!modal) return;
            function closeModal() {
                modal.style.display = 'none';
                document.body.classList.remove('instance-add-modal-open');
            }
            if (backdrop) backdrop.onclick = closeModal;
            if (closeBtn) closeBtn.onclick = closeModal;
            if (cancelBtn) cancelBtn.onclick = closeModal;
            if (okBtn) {
                okBtn.onclick = function() {
                    var name = (input && input.value) ? input.value.trim() : '';
                    var addMode = self._addModalMode || getMode();
                    if (!name) name = 'Unnamed';
                    okBtn.disabled = true;
                    fetch(api(getApiBaseForMode(addMode) + '/instances'), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name: name })
                    })
                        .then(function(r) { return r.json(); })
                        .then(function(data) {
                            if (data.error) {
                                if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification(data.error, 'error');
                                return;
                            }
                            if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Instance added.', 'success');
                            closeModal();
                            if (isCombinedView()) self.loadListForMode(addMode); else self.loadList();
                            afterInstanceChange();
                        })
                        .catch(function() {
                            if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Request failed.', 'error');
                        })
                        .finally(function() { okBtn.disabled = false; });
                };
            }
            document.addEventListener('keydown', function(e) {
                if (e.key === 'Escape' && modal.style.display === 'flex') closeModal();
            });
        },

        initDeleteModal: function() {
            var self = this;
            var modal = document.getElementById('media-hunt-instance-delete-modal');
            var messageEl = document.getElementById('media-hunt-instance-delete-modal-message');
            var backdrop = document.getElementById('media-hunt-instance-delete-modal-backdrop');
            var closeBtn = document.getElementById('media-hunt-instance-delete-modal-close');
            var cancelBtn = document.getElementById('media-hunt-instance-delete-modal-cancel');
            var confirmBtn = document.getElementById('media-hunt-instance-delete-modal-confirm');
            if (!modal) return;
            function closeModal() {
                modal.style.display = 'none';
                document.body.classList.remove('instance-delete-modal-open');
                modal.removeAttribute('data-pending-id');
                modal.removeAttribute('data-pending-mode');
            }
            if (backdrop) backdrop.onclick = closeModal;
            if (closeBtn) closeBtn.onclick = closeModal;
            if (cancelBtn) cancelBtn.onclick = closeModal;
            if (confirmBtn) {
                confirmBtn.onclick = function() {
                    var id = modal.getAttribute('data-pending-id');
                    var pendingMode = modal.getAttribute('data-pending-mode') || getMode();
                    if (!id) return;
                    confirmBtn.disabled = true;
                    fetch(api(getApiBaseForMode(pendingMode) + '/instances/' + id), { method: 'DELETE' })
                        .then(function(r) { return r.json(); })
                        .then(function(data) {
                            if (data.error) {
                                if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification(data.error, 'error');
                                return;
                            }
                            if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Instance deleted.', 'success');
                            closeModal();
                            if (isCombinedView()) self.loadListForMode(pendingMode); else self.loadList();
                            afterInstanceChange();
                        })
                        .catch(function() {
                            if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Request failed.', 'error');
                        })
                        .finally(function() { confirmBtn.disabled = false; });
                };
            }
            document.addEventListener('keydown', function(e) {
                if (e.key === 'Escape' && modal.style.display === 'flex') closeModal();
            });
        },

        openDeleteModal: function(id, name, mode) {
            var m = (mode === 'tv' || mode === 'movie') ? mode : getMode();
            var modal = document.getElementById('media-hunt-instance-delete-modal');
            var messageEl = document.getElementById('media-hunt-instance-delete-modal-message');
            if (!modal || !messageEl) return;
            var displayName = (name || id || 'this instance').trim() || 'this instance';
            messageEl.textContent = 'Delete instance "' + displayName + '"? This cannot be undone.';
            modal.setAttribute('data-pending-id', String(id));
            modal.setAttribute('data-pending-mode', m);
            if (modal.parentNode !== document.body) document.body.appendChild(modal);
            modal.style.display = 'flex';
            document.body.classList.add('instance-delete-modal-open');
        },

        initRenameModal: function() {
            var self = this;
            var modal = document.getElementById('media-hunt-instance-rename-modal');
            var backdrop = document.getElementById('media-hunt-instance-rename-modal-backdrop');
            var closeBtn = document.getElementById('media-hunt-instance-rename-modal-close');
            var cancelBtn = document.getElementById('media-hunt-instance-rename-modal-cancel');
            var saveBtn = document.getElementById('media-hunt-instance-rename-modal-save');
            var input = document.getElementById('media-hunt-instance-rename-name');
            if (!modal) return;
            function closeModal() {
                modal.style.display = 'none';
                document.body.classList.remove('instance-rename-modal-open');
                modal.removeAttribute('data-pending-id');
                modal.removeAttribute('data-pending-mode');
            }
            if (backdrop) backdrop.onclick = closeModal;
            if (closeBtn) closeBtn.onclick = closeModal;
            if (cancelBtn) cancelBtn.onclick = closeModal;
            if (saveBtn) {
                saveBtn.onclick = function() {
                    var id = modal.getAttribute('data-pending-id');
                    var pendingMode = modal.getAttribute('data-pending-mode') || getMode();
                    var name = (input && input.value) ? input.value.trim() : '';
                    if (!id) return;
                    if (!name) name = 'Unnamed';
                    saveBtn.disabled = true;
                    fetch(api(getApiBaseForMode(pendingMode) + '/instances/' + id), {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name: name })
                    })
                        .then(function(r) { return r.json(); })
                        .then(function(data) {
                            if (data.error) {
                                if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification(data.error, 'error');
                                return;
                            }
                            if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Instance renamed.', 'success');
                            closeModal();
                            if (isCombinedView()) self.loadListForMode(pendingMode); else self.loadList();
                            afterInstanceChange();
                        })
                        .catch(function() {
                            if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Request failed.', 'error');
                        })
                        .finally(function() { saveBtn.disabled = false; });
                };
            }
            document.addEventListener('keydown', function(e) {
                if (e.key === 'Escape' && modal.style.display === 'flex') closeModal();
            });
        },

        openRenameModal: function(id, currentName, mode) {
            var m = (mode === 'tv' || mode === 'movie') ? mode : getMode();
            var modal = document.getElementById('media-hunt-instance-rename-modal');
            var input = document.getElementById('media-hunt-instance-rename-name');
            if (!modal || !input) return;
            modal.setAttribute('data-pending-id', String(id));
            modal.setAttribute('data-pending-mode', m);
            input.value = (currentName || '').trim() || '';
            if (modal.parentNode !== document.body) document.body.appendChild(modal);
            modal.style.display = 'flex';
            document.body.classList.add('instance-rename-modal-open');
            setTimeout(function() { input.focus(); }, 100);
        },

        _addModalMode: 'movie',

        openAddModal: function(mode) {
            var m = (mode === 'tv' || mode === 'movie') ? mode : getMode();
            this._addModalMode = m;
            var modal = document.getElementById('media-hunt-instance-add-modal');
            var input = document.getElementById('media-hunt-instance-add-name');
            var addTitle = document.getElementById('media-hunt-instance-add-modal-title');
            var addSub = document.getElementById('media-hunt-instance-add-modal-subtitle');
            if (addTitle) addTitle.textContent = m === 'tv' ? 'Add TV Hunt Instance' : 'Add Movie Hunt Instance';
            if (addSub) addSub.textContent = 'Enter a name for the new ' + (m === 'tv' ? 'TV Hunt' : 'Movie Hunt') + ' instance.';
            if (modal && modal.parentNode !== document.body) document.body.appendChild(modal);
            if (modal) modal.style.display = 'flex';
            if (input) { input.value = ''; setTimeout(function() { input.focus(); }, 100); }
            document.body.classList.add('instance-add-modal-open');
        },

        loadListForMode: function(mode) {
            var gridId = mode === 'tv' ? 'media-hunt-tv-instances-grid' : 'media-hunt-movie-instances-grid';
            var addCardId = mode === 'tv' ? 'media-hunt-tv-instances-add-card' : 'media-hunt-movie-instances-add-card';
            var grid = document.getElementById(gridId);
            if (!grid) return;
            var addCard = document.getElementById(addCardId);
            var addCardClone = addCard ? addCard.cloneNode(true) : null;
            if (addCard) addCard.remove();
            grid.innerHTML = '<div class="instance-management-loading">Loading...</div>';

            var iconClass = mode === 'movie' ? 'fa-film' : 'fa-tv';
            var self = this;

            fetch(api(getApiBaseForMode(mode) + '/instances'), { cache: 'no-store' })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    var list = data.instances || [];
                    grid.innerHTML = '';
                    list.forEach(function(inst) {
                        var enabled = inst.enabled !== false;
                        var statusClass = enabled ? 'status-connected' : 'status-disabled';
                        var statusIcon = enabled ? 'fa-check-circle' : 'fa-minus-circle';
                        var card = document.createElement('div');
                        card.className = 'instance-card';
                        card.setAttribute('data-mode', mode);
                        card.innerHTML =
                            '<div class="instance-card-header">' +
                            '<span class="instance-name"><i class="fas ' + iconClass + '" style="margin-right: 8px;"></i>' + escapeHtml(inst.name || 'Instance ' + inst.id) + '</span>' +
                            '<div class="instance-status-icon ' + statusClass + '" title="' + (enabled ? 'Enabled' : 'Disabled') + '"><i class="fas ' + statusIcon + '"></i></div>' +
                            '</div>' +
                            '<div class="instance-card-body"><div class="instance-detail"><i class="fas fa-hashtag"></i><span>ID ' + escapeHtml(inst.id) + '</span></div></div>' +
                            '<div class="instance-card-footer">' +
                            '<button type="button" class="btn-card edit" data-id="' + escapeAttr(String(inst.id)) + '" data-name="' + escapeAttr(inst.name || '') + '" data-mode="' + mode + '" aria-label="Edit"><i class="fas fa-cog"></i> Edit</button>' +
                            '<button type="button" class="btn-card delete" data-id="' + escapeAttr(String(inst.id)) + '" data-name="' + escapeAttr(inst.name || '') + '" data-mode="' + mode + '" aria-label="Delete"><i class="fas fa-trash"></i> Delete</button>' +
                            '</div>';
                        grid.appendChild(card);
                    });
                    if (addCardClone) {
                        addCardClone.id = addCardId;
                        addCardClone.setAttribute('data-mode', mode);
                        grid.appendChild(addCardClone);
                        addCardClone.addEventListener('click', function() { self.openAddModal(mode); });
                    }
                    grid.querySelectorAll('.btn-card.edit').forEach(function(btn) {
                        btn.addEventListener('click', function(e) {
                            e.stopPropagation();
                            var id = btn.getAttribute('data-id');
                            var name = btn.getAttribute('data-name') || ('Instance ' + id);
                            var cardMode = btn.getAttribute('data-mode') || mode;
                            if (cardMode === 'movie' && window.MovieHuntInstanceEditor && typeof window.MovieHuntInstanceEditor.openEditor === 'function') {
                                window.MovieHuntInstanceEditor.openEditor(id, name);
                            } else if (cardMode === 'tv' && window.TVHuntInstanceEditor && typeof window.TVHuntInstanceEditor.openEditor === 'function') {
                                window.TVHuntInstanceEditor.openEditor(id, name);
                            }
                        });
                    });
                    grid.querySelectorAll('.btn-card.delete').forEach(function(btn) {
                        btn.addEventListener('click', function(e) {
                            e.stopPropagation();
                            var cardMode = btn.getAttribute('data-mode') || mode;
                            self.openDeleteModal(btn.getAttribute('data-id'), btn.getAttribute('data-name') || '', cardMode);
                        });
                    });
                })
                .catch(function() {
                    grid.innerHTML = '<div class="instance-management-loading" style="color: #f87171;">Failed to load instances.</div>';
                    if (addCardClone) {
                        addCardClone.id = addCardId;
                        grid.appendChild(addCardClone);
                        addCardClone.addEventListener('click', function() { self.openAddModal(mode); });
                    }
                });
        },

        loadList: function() {
            var grid = document.getElementById('media-hunt-instance-management-grid');
            if (!grid) return;
            var addCard = document.getElementById('media-hunt-instance-management-add-card');
            var addCardClone = addCard ? addCard.cloneNode(true) : null;
            if (addCard) addCard.remove();
            grid.innerHTML = '<div class="instance-management-loading">Loading...</div>';

            var mode = getMode();
            var iconClass = mode === 'movie' ? 'fa-film' : 'fa-tv';

            fetch(api(getApiBase() + '/instances'), { cache: 'no-store' })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    var list = data.instances || [];
                    grid.innerHTML = '';
                    list.forEach(function(inst) {
                        var enabled = inst.enabled !== false;
                        var statusClass = enabled ? 'status-connected' : 'status-disabled';
                        var statusIcon = enabled ? 'fa-check-circle' : 'fa-minus-circle';
                        var card = document.createElement('div');
                        card.className = 'instance-card';
                        card.innerHTML =
                            '<div class="instance-card-header">' +
                            '<span class="instance-name"><i class="fas ' + iconClass + '" style="margin-right: 8px;"></i>' + escapeHtml(inst.name || 'Instance ' + inst.id) + '</span>' +
                            '<div class="instance-status-icon ' + statusClass + '" title="' + (enabled ? 'Enabled' : 'Disabled') + '"><i class="fas ' + statusIcon + '"></i></div>' +
                            '</div>' +
                            '<div class="instance-card-body"><div class="instance-detail"><i class="fas fa-hashtag"></i><span>ID ' + escapeHtml(inst.id) + '</span></div></div>' +
                            '<div class="instance-card-footer">' +
                            '<button type="button" class="btn-card edit" data-id="' + escapeAttr(String(inst.id)) + '" data-name="' + escapeAttr(inst.name || '') + '" aria-label="Edit"><i class="fas fa-cog"></i> Edit</button>' +
                            '<button type="button" class="btn-card delete" data-id="' + escapeAttr(String(inst.id)) + '" data-name="' + escapeAttr(inst.name || '') + '" aria-label="Delete"><i class="fas fa-trash"></i> Delete</button>' +
                            '</div>';
                        grid.appendChild(card);
                    });
                    if (addCardClone) {
                        addCardClone.id = 'media-hunt-instance-management-add-card';
                        addCardClone.setAttribute('data-app-type', 'media-hunt-instance');
                        grid.appendChild(addCardClone);
                        addCardClone.addEventListener('click', function() { window.MediaHuntInstanceManagement.openAddModal(mode); });
                    }
                    grid.querySelectorAll('.btn-card.edit').forEach(function(btn) {
                        btn.addEventListener('click', function(e) {
                            e.stopPropagation();
                            var id = btn.getAttribute('data-id');
                            var name = btn.getAttribute('data-name') || ('Instance ' + id);
                            if (mode === 'movie' && window.MovieHuntInstanceEditor && typeof window.MovieHuntInstanceEditor.openEditor === 'function') {
                                window.MovieHuntInstanceEditor.openEditor(id, name);
                            } else if (mode === 'tv' && window.TVHuntInstanceEditor && typeof window.TVHuntInstanceEditor.openEditor === 'function') {
                                window.TVHuntInstanceEditor.openEditor(id, name);
                            }
                        });
                    });
                    grid.querySelectorAll('.btn-card.delete').forEach(function(btn) {
                        btn.addEventListener('click', function(e) {
                            e.stopPropagation();
                            window.MediaHuntInstanceManagement.openDeleteModal(btn.getAttribute('data-id'), btn.getAttribute('data-name') || '', mode);
                        });
                    });
                })
                .catch(function() {
                    grid.innerHTML = '<div class="instance-management-loading" style="color: #f87171;">Failed to load instances.</div>';
                    if (addCardClone) {
                        grid.appendChild(addCardClone);
                        addCardClone.addEventListener('click', function() { window.MediaHuntInstanceManagement.openAddModal(mode); });
                    }
                });
        },

        promptAdd: function() { this.openAddModal(); },
        promptDelete: function(id, name, mode) { this.openDeleteModal(id, name, mode); },
        promptRename: function(id, currentName, mode) { this.openRenameModal(id, currentName, mode); }
    };
})();
