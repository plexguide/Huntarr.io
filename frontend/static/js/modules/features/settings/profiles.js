/**
 * Profiles (Movie Hunt) - list and CRUD for profiles. Default "Standard" profile is auto-created when empty.
 * App instances design: cards with DEFAULT badge, Set as default, Delete (any profile including Standard can be deleted).
 * Attaches to window.SettingsForms.
 */
(function() {
    'use strict';
    if (typeof window.SettingsForms === 'undefined') return;

    const Forms = window.SettingsForms;

    Forms.renderProfileCard = function(profile, index) {
        const isDefault = Boolean(profile && profile.is_default);
        const name = (profile && profile.name) ? String(profile.name).replace(/</g, '&lt;').replace(/>/g, '&gt;') : 'Unnamed';
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
        return '<div class="instance-card ' + (isDefault ? 'default-instance' : '') + '" data-instance-index="' + index + '" data-app-type="profile">' +
            '<div class="instance-card-header">' +
            '<div class="instance-name instance-name-with-priority"><i class="fas fa-id-card"></i><span>' + name + '</span>' + (isDefault ? '<span class="default-badge">Default</span>' : '') + '</div>' +
            '<div class="instance-card-header-actions">' +
            '<button type="button" class="btn-icon btn-clone-profile" data-app-type="profile" data-instance-index="' + index + '" title="Duplicate profile" aria-label="Duplicate profile"><i class="fas fa-clone"></i></button>' +
            '</div></div>' +
            '<div class="instance-card-body">' +
            '<div class="profile-card-quality-tags">' + tagsHtml + '</div>' +
            '</div>' +
            '<div class="instance-card-footer">' +
            '<button type="button" class="btn-card edit" data-app-type="profile" data-instance-index="' + index + '"><i class="fas fa-edit"></i> Edit</button>' +
            (isDefault ? '' : '<button type="button" class="btn-card set-default" data-app-type="profile" data-instance-index="' + index + '"><i class="fas fa-star"></i> Default</button>') +
            '<button type="button" class="btn-card delete" data-app-type="profile" data-instance-index="' + index + '"><i class="fas fa-trash"></i> Delete</button>' +
            '</div></div>';
    };

    Forms.refreshProfilesList = function() {
        const grid = document.getElementById('profile-instances-grid');
        if (!grid) return;
        fetch('./api/profiles')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                const list = (data && data.profiles) ? data.profiles : [];
                window.SettingsForms._profilesList = list;
                let html = '';
                for (let i = 0; i < list.length; i++) {
                    html += window.SettingsForms.renderProfileCard(list[i], i);
                }
                html += '<div class="add-instance-card" data-app-type="profile"><div class="add-icon"><i class="fas fa-plus-circle"></i></div><div class="add-text">Add Profile</div></div>';
                grid.innerHTML = html;
            })
            .catch(function() {
                grid.innerHTML = '<div class="add-instance-card" data-app-type="profile"><div class="add-icon"><i class="fas fa-plus-circle"></i></div><div class="add-text">Add Profile</div></div>';
            });
    };
})();
