/**
 * TV Hunt Profiles - same setup as Movie Hunt, independent.
 * List, add, edit, set default, clone, delete. Uses /api/tv-hunt/profiles.
 */
(function() {
    'use strict';

    if (typeof window.TVHuntSettingsForms === 'undefined') {
        window.TVHuntSettingsForms = {};
    }
    const Forms = window.TVHuntSettingsForms;

    Forms.renderTVHuntProfileCard = function(profile, index) {
        const isDefault = Boolean(profile && profile.is_default);
        const name = (profile && profile.name) ? String(profile.name).replace(/</g, '&lt;').replace(/>/g, '&gt;') : 'Unnamed';
        const profileId = (profile && profile.id) ? String(profile.id).replace(/"/g, '&quot;') : '';
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
        return '<div class="instance-card ' + (isDefault ? 'default-instance' : '') + '" data-profile-id="' + profileId + '" data-instance-index="' + index + '" data-app-type="tv-hunt-profile">' +
            '<div class="instance-card-header">' +
            '<div class="instance-name instance-name-with-priority"><i class="fas fa-id-card"></i><span>' + name + '</span>' + (isDefault ? '<span class="default-badge">Default</span>' : '') + '</div>' +
            '<div class="instance-card-header-actions">' +
            '<button type="button" class="btn-icon btn-clone-profile" data-app-type="tv-hunt-profile" data-profile-id="' + profileId + '" title="Duplicate profile" aria-label="Duplicate profile"><i class="fas fa-clone"></i></button>' +
            '</div></div>' +
            '<div class="instance-card-body">' +
            '<div class="profile-card-quality-tags">' + tagsHtml + '</div>' +
            '</div>' +
            '<div class="instance-card-footer">' +
            '<button type="button" class="btn-card edit" data-app-type="tv-hunt-profile" data-profile-id="' + profileId + '"><i class="fas fa-edit"></i> Edit</button>' +
            (isDefault ? '' : '<button type="button" class="btn-card set-default" data-app-type="tv-hunt-profile" data-profile-id="' + profileId + '"><i class="fas fa-star"></i> Default</button>') +
            '<button type="button" class="btn-card delete" data-app-type="tv-hunt-profile" data-profile-id="' + profileId + '"><i class="fas fa-trash"></i> Delete</button>' +
            '</div></div>';
    };

    Forms.refreshTVHuntProfilesList = function() {
        var grid = document.getElementById('tv-hunt-profile-instances-grid');
        if (!grid) return;
        if (window.TVHuntInstanceDropdown && document.getElementById('tv-hunt-settings-profiles-instance-select') && !Forms._tvHuntProfilesDropdownAttached) {
            window.TVHuntInstanceDropdown.attach('tv-hunt-settings-profiles-instance-select', function() {
                if (Forms.refreshTVHuntProfilesList) Forms.refreshTVHuntProfilesList();
            });
            Forms._tvHuntProfilesDropdownAttached = true;
        }
        fetch('./api/tv-hunt/profiles', { cache: 'no-store' })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var list = (data && data.profiles) ? data.profiles : [];
                Forms._tvHuntProfilesList = list;
                var html = '';
                for (var i = 0; i < list.length; i++) {
                    html += Forms.renderTVHuntProfileCard(list[i], i);
                }
                html += '<div class="add-instance-card" data-app-type="tv-hunt-profile"><div class="add-icon"><i class="fas fa-plus-circle"></i></div><div class="add-text">Add Profile</div></div>';
                grid.innerHTML = html;
            })
            .catch(function() {
                grid.innerHTML = '<div class="add-instance-card" data-app-type="tv-hunt-profile"><div class="add-icon"><i class="fas fa-plus-circle"></i></div><div class="add-text">Add Profile</div></div>';
            });
    };

    if (window.SettingsForms && window.SettingsForms.openTVHuntProfileEditor) {
        Forms.openTVHuntProfileEditor = window.SettingsForms.openTVHuntProfileEditor;
    }
})();
