/**
 * Media Hunt Profiles – single module for Movie Hunt and TV Hunt profiles.
 * Mode ('movie' | 'tv') is set by the router from hash (#settings-profiles => movie, #tv-hunt-settings-profiles => tv).
 * Uses /api/profiles (movie, index-based) or /api/tv-hunt/profiles (tv, profile_id-based).
 */
(function() {
    'use strict';

    window.MediaHuntProfiles = window.MediaHuntProfiles || {};
    const M = window.MediaHuntProfiles;
    M._profilesList = [];
    M._dropdownAttached = { movie: false, tv: false };

    function getMode() {
        return window._mediaHuntProfilesMode === 'tv' ? 'tv' : 'movie';
    }

    function getApiBase() {
        return getMode() === 'tv' ? './api/tv-hunt/profiles' : './api/profiles';
    }

    M.renderCard = function(profile, index, mode) {
        var m = mode || getMode();
        var isDefault = Boolean(profile && profile.is_default);
        var name = (profile && profile.name) ? String(profile.name).replace(/</g, '&lt;').replace(/>/g, '&gt;') : 'Unnamed';
        var profileId = (profile && profile.id) ? String(profile.id).replace(/"/g, '&quot;') : '';
        var qualities = Array.isArray(profile && profile.qualities) ? profile.qualities : [];
        var checkedOrder = [];
        qualities.forEach(function(q) {
            if (q && q.enabled !== false) {
                var n = (q.name || q.id || '').trim();
                if (n) checkedOrder.push(n);
            }
        });
        var tagsHtml = '';
        checkedOrder.forEach(function(qName, i) {
            var esc = String(qName).replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
            var goldClass = (i === 0) ? ' profile-quality-tag-highest' : '';
            tagsHtml += '<span class="profile-quality-tag' + goldClass + '">' + esc + '</span>';
        });
        if (tagsHtml === '') {
            tagsHtml = '<span class="profile-quality-tag profile-quality-tag-empty">No qualities</span>';
        }
        var dataAttrs = m === 'tv'
            ? ' data-profile-id="' + profileId + '" data-profile-mode="tv"'
            : ' data-instance-index="' + index + '" data-profile-mode="movie"';
        return '<div class="instance-card ' + (isDefault ? 'default-instance' : '') + '" data-app-type="media-hunt-profile"' + dataAttrs + '>' +
            '<div class="instance-card-header">' +
            '<div class="instance-name instance-name-with-priority"><i class="fas fa-id-card"></i><span>' + name + '</span>' + (isDefault ? '<span class="default-badge">Default</span>' : '') + '</div>' +
            '<div class="instance-card-header-actions">' +
            '<button type="button" class="btn-icon btn-clone-profile" data-app-type="media-hunt-profile"' + (m === 'tv' ? ' data-profile-id="' + profileId + '"' : ' data-instance-index="' + index + '"') + ' data-profile-mode="' + m + '" title="Duplicate profile" aria-label="Duplicate profile"><i class="fas fa-clone"></i></button>' +
            '</div></div>' +
            '<div class="instance-card-body"><div class="profile-card-quality-tags">' + tagsHtml + '</div></div>' +
            '<div class="instance-card-footer">' +
            '<button type="button" class="btn-card edit" data-app-type="media-hunt-profile"' + (m === 'tv' ? ' data-profile-id="' + profileId + '"' : ' data-instance-index="' + index + '"') + ' data-profile-mode="' + m + '"><i class="fas fa-edit"></i> Edit</button>' +
            (isDefault ? '' : '<button type="button" class="btn-card set-default" data-app-type="media-hunt-profile"' + (m === 'tv' ? ' data-profile-id="' + profileId + '"' : ' data-instance-index="' + index + '"') + ' data-profile-mode="' + m + '"><i class="fas fa-star"></i> Default</button>') +
            '<button type="button" class="btn-card delete" data-app-type="media-hunt-profile"' + (m === 'tv' ? ' data-profile-id="' + profileId + '"' : ' data-instance-index="' + index + '"') + ' data-profile-mode="' + m + '"><i class="fas fa-trash"></i> Delete</button>' +
            '</div></div>';
    };

    M.refreshProfilesList = function(mode) {
        var m = (mode === 'tv' || mode === 'movie') ? mode : getMode();
        window._mediaHuntProfilesMode = m;

        var selectEl = document.getElementById('media-hunt-profiles-instance-select');
        var grid = document.getElementById('media-hunt-profiles-grid');
        var subtitle = document.getElementById('media-hunt-profiles-subtitle');
        if (subtitle) {
            subtitle.textContent = m === 'tv' ? 'TV Hunt quality profiles for the selected instance.' : 'Movie Hunt quality profiles for the selected instance.';
        }

        if (selectEl && !M._dropdownAttached[m]) {
            if (m === 'movie' && window.MovieHuntInstanceDropdown && window.MovieHuntInstanceDropdown.attach) {
                window.MovieHuntInstanceDropdown.attach('media-hunt-profiles-instance-select', function() { M.refreshProfilesList('movie'); });
                M._dropdownAttached.movie = true;
            } else if (m === 'tv' && window.TVHuntInstanceDropdown && window.TVHuntInstanceDropdown.attach) {
                window.TVHuntInstanceDropdown.attach('media-hunt-profiles-instance-select', function() { M.refreshProfilesList('tv'); });
                M._dropdownAttached.tv = true;
            }
        }

        if (!grid) return;
        var apiBase = m === 'tv' ? './api/tv-hunt/profiles' : './api/profiles';
        fetch(m === 'tv' ? './api/tv-hunt/profiles' : './api/profiles', { cache: m === 'tv' ? 'no-store' : 'default' })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var list = (data && data.profiles) ? data.profiles : [];
                M._profilesList = list;
                if (m === 'movie' && window.SettingsForms) window.SettingsForms._profilesList = list;
                var html = '';
                for (var i = 0; i < list.length; i++) {
                    html += M.renderCard(list[i], i, m);
                }
                html += '<div class="add-instance-card" data-app-type="media-hunt-profile"><div class="add-icon"><i class="fas fa-plus-circle"></i></div><div class="add-text">Add Profile</div></div>';
                grid.innerHTML = html;
            })
            .catch(function() {
                grid.innerHTML = '<div class="add-instance-card" data-app-type="media-hunt-profile"><div class="add-icon"><i class="fas fa-plus-circle"></i></div><div class="add-text">Add Profile</div></div>';
            });
    };

    function openAddModal() {
        var modal = document.getElementById('media-hunt-profile-add-modal');
        var input = document.getElementById('media-hunt-profile-add-name');
        var sub = document.getElementById('media-hunt-profile-add-subtitle');
        if (sub) sub.textContent = getMode() === 'tv' ? 'Enter a name for the new TV Hunt profile.' : 'Enter a name for the new profile.';
        if (modal && modal.parentNode !== document.body) document.body.appendChild(modal);
        if (modal) modal.style.display = 'flex';
        if (input) { input.value = ''; setTimeout(function() { input.focus(); }, 100); }
        document.body.classList.add('profile-add-modal-open');
    }

    function closeAddModal() {
        var modal = document.getElementById('media-hunt-profile-add-modal');
        if (modal) modal.style.display = 'none';
        document.body.classList.remove('profile-add-modal-open');
    }

    function initAddModal() {
        var backdrop = document.getElementById('media-hunt-profile-add-modal-backdrop');
        var closeBtn = document.getElementById('media-hunt-profile-add-modal-close');
        var cancelBtn = document.getElementById('media-hunt-profile-add-modal-cancel');
        var saveBtn = document.getElementById('media-hunt-profile-add-modal-save');
        var input = document.getElementById('media-hunt-profile-add-name');
        if (backdrop) backdrop.onclick = closeAddModal;
        if (closeBtn) closeBtn.onclick = closeAddModal;
        if (cancelBtn) cancelBtn.onclick = closeAddModal;
        if (saveBtn) {
            saveBtn.onclick = function() {
                var name = (input && input.value) ? input.value.trim() : '';
                if (!name) {
                    if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Enter a profile name.', 'error');
                    return;
                }
                saveBtn.disabled = true;
                var apiBase = getApiBase();
                fetch(apiBase, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name }) })
                    .then(function(r) { return r.json(); })
                    .then(function(data) {
                        if (data.success) M.refreshProfilesList(getMode());
                        if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Profile added.', 'success');
                        closeAddModal();
                    })
                    .catch(function() {
                        if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Failed to add profile.', 'error');
                    })
                    .finally(function() { saveBtn.disabled = false; });
            };
        }
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' && document.getElementById('media-hunt-profile-add-modal') && document.getElementById('media-hunt-profile-add-modal').style.display === 'flex')
                closeAddModal();
        });
    }

    function initGrid() {
        var grid = document.getElementById('media-hunt-profiles-grid');
        if (!grid) return;
        grid.addEventListener('click', function(e) {
            var addCard = e.target.closest('.add-instance-card[data-app-type="media-hunt-profile"]');
            var cloneBtn = e.target.closest('.btn-clone-profile[data-app-type="media-hunt-profile"]');
            var editBtn = e.target.closest('.btn-card.edit[data-app-type="media-hunt-profile"]');
            var setDefaultBtn = e.target.closest('.btn-card.set-default[data-app-type="media-hunt-profile"]');
            var deleteBtn = e.target.closest('.btn-card.delete[data-app-type="media-hunt-profile"]');
            var m = getMode();
            var apiBase = getApiBase();

            if (cloneBtn) {
                e.preventDefault();
                e.stopPropagation();
                if (m === 'tv') {
                    var profileId = cloneBtn.getAttribute('data-profile-id');
                    if (!profileId) return;
                    fetch('./api/tv-hunt/profiles/' + encodeURIComponent(profileId) + '/clone', { method: 'POST' })
                        .then(function(r) { return r.json(); })
                        .then(function(data) {
                            if (data.success) M.refreshProfilesList('tv');
                            if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Profile duplicated.', 'success');
                        })
                        .catch(function() {
                            if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Failed to duplicate profile.', 'error');
                        });
                } else {
                    var index = parseInt(cloneBtn.getAttribute('data-instance-index'), 10);
                    fetch('./api/profiles/' + index + '/clone', { method: 'POST' })
                        .then(function(r) { return r.json(); })
                        .then(function(data) {
                            if (data.success) M.refreshProfilesList('movie');
                            if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Profile duplicated.', 'success');
                        })
                        .catch(function() {
                            if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Failed to duplicate profile.', 'error');
                        });
                }
            } else if (editBtn) {
                e.preventDefault();
                if (m === 'tv') {
                    var profileId = editBtn.getAttribute('data-profile-id');
                    if (profileId && window.SettingsForms && window.SettingsForms.openTVHuntProfileEditor)
                        window.SettingsForms.openTVHuntProfileEditor(profileId);
                } else {
                    var index = parseInt(editBtn.getAttribute('data-instance-index'), 10);
                    if (window.SettingsForms && window.SettingsForms.openProfileEditor)
                        window.SettingsForms.openProfileEditor(index);
                }
            } else if (addCard) {
                e.preventDefault();
                openAddModal();
            } else if (setDefaultBtn) {
                e.preventDefault();
                if (m === 'tv') {
                    var profileId = setDefaultBtn.getAttribute('data-profile-id');
                    if (!profileId) return;
                    fetch('./api/tv-hunt/profiles/' + encodeURIComponent(profileId), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_default: true }) })
                        .then(function(r) { return r.json(); })
                        .then(function(data) {
                            if (data.success) M.refreshProfilesList('tv');
                            if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Default profile updated.', 'success');
                        })
                        .catch(function() {
                            if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Failed to update.', 'error');
                        });
                } else {
                    var index = parseInt(setDefaultBtn.getAttribute('data-instance-index'), 10);
                    fetch('./api/profiles/' + index, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_default: true }) })
                        .then(function(r) { return r.json(); })
                        .then(function(data) {
                            if (data.success) M.refreshProfilesList('movie');
                            if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Default profile updated.', 'success');
                        })
                        .catch(function() {
                            if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Failed to update.', 'error');
                        });
                }
            } else if (deleteBtn) {
                e.preventDefault();
                var list = M._profilesList || [];
                var name = 'this profile';
                var doDelete = function() {
                    if (m === 'tv') {
                        var profileId = deleteBtn.getAttribute('data-profile-id');
                        if (!profileId) return;
                        fetch('./api/tv-hunt/profiles/' + encodeURIComponent(profileId), { method: 'DELETE' })
                            .then(function(r) { return r.json(); })
                            .then(function(data) {
                                if (data.success) M.refreshProfilesList('tv');
                                if (window.huntarrUI && window.huntarrUI.showNotification)
                                    window.huntarrUI.showNotification(data.success ? 'Profile deleted.' : (data.error || 'Could not delete.'), data.success ? 'success' : 'error');
                            })
                            .catch(function() {
                                if (window.huntarrUI && window.huntarrUI.showNotification)
                                    window.huntarrUI.showNotification('Failed to delete profile.', 'error');
                            });
                    } else {
                        var index = parseInt(deleteBtn.getAttribute('data-instance-index'), 10);
                        fetch('./api/profiles/' + index, { method: 'DELETE' })
                            .then(function(r) { return r.json(); })
                            .then(function(data) {
                                if (data.success) M.refreshProfilesList('movie');
                                if (window.huntarrUI && window.huntarrUI.showNotification)
                                    window.huntarrUI.showNotification(data.success ? 'Profile deleted.' : (data.error || 'Could not delete.'), data.success ? 'success' : 'error');
                            })
                            .catch(function() {
                                if (window.huntarrUI && window.huntarrUI.showNotification)
                                    window.huntarrUI.showNotification('Failed to delete profile.', 'error');
                            });
                    }
                };
                if (m === 'tv') {
                    var profileId = deleteBtn.getAttribute('data-profile-id');
                    var profile = list.find(function(p) { return p.id === profileId; });
                    if (profile && profile.name) name = profile.name;
                } else {
                    var index = parseInt(deleteBtn.getAttribute('data-instance-index'), 10);
                    var profile = list[index];
                    if (profile && profile.name) name = profile.name;
                }
                if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
                    window.HuntarrConfirm.show({ title: 'Delete Profile', message: 'Delete "' + name + '"?', confirmLabel: 'Delete', onConfirm: doDelete });
                } else {
                    if (!confirm('Delete "' + name + '"?')) return;
                    doDelete();
                }
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() { initAddModal(); initGrid(); });
    } else {
        initAddModal();
        initGrid();
    }
})();
