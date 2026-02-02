/**
 * Profiles (Movie Hunt) - list and CRUD for profiles. Default "Standard" profile.
 * App instances design: cards with DEFAULT badge, Set as default, Delete (Standard cannot be deleted).
 * Attaches to window.SettingsForms.
 */
(function() {
    'use strict';
    if (typeof window.SettingsForms === 'undefined') return;

    const Forms = window.SettingsForms;

    Forms.renderProfileCard = function(profile, index) {
        const isDefault = Boolean(profile && profile.is_default);
        const name = (profile && profile.name) ? String(profile.name).replace(/</g, '&lt;').replace(/>/g, '&gt;') : 'Unnamed';
        const isStandard = name === 'Standard';
        return '<div class="instance-card ' + (isDefault ? 'default-instance' : '') + '" data-instance-index="' + index + '" data-app-type="profile">' +
            '<div class="instance-card-header">' +
            '<div class="instance-name instance-name-with-priority"><i class="fas fa-id-card"></i><span>' + name + '</span>' + (isDefault ? '<span class="default-badge">Default</span>' : '') + '</div>' +
            '<div class="instance-status-icon status-connected"><i class="fas fa-check-circle"></i></div>' +
            '</div>' +
            '<div class="instance-card-body">' +
            '<div class="instance-detail"><i class="fas fa-info-circle"></i><span>Profile for Movie Hunt</span></div>' +
            '</div>' +
            '<div class="instance-card-footer">' +
            '<button type="button" class="btn-card edit" data-app-type="profile" data-instance-index="' + index + '"><i class="fas fa-edit"></i> Edit</button>' +
            (isDefault ? '' : '<button type="button" class="btn-card set-default" data-app-type="profile" data-instance-index="' + index + '"><i class="fas fa-star"></i> Set as default</button>') +
            (isStandard ? '' : '<button type="button" class="btn-card delete" data-app-type="profile" data-instance-index="' + index + '"><i class="fas fa-trash"></i> Delete</button>') +
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
