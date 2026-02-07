/**
 * Indexer Management (Movie Hunt) - list and CRUD for indexers.
 * Separate from Indexer Editor (indexer-editor.js). Attaches to window.SettingsForms.
 * Load after indexer-editor.js so openIndexerEditor is available for grid clicks.
 */
(function() {
    'use strict';
    if (typeof window.SettingsForms === 'undefined') return;

    const Forms = window.SettingsForms;

    Forms.renderIndexerCard = function(indexer, index) {
        const isDefault = index === 0;
        const name = (indexer.name || 'Unnamed').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const last4 = indexer.api_key_last4 || '****';
        const preset = (indexer.preset || 'manual').replace(/"/g, '&quot;');
        const enabled = indexer.enabled !== false;
        const statusClass = enabled ? 'status-connected' : 'status-error';
        const statusIcon = enabled ? 'fa-check-circle' : 'fa-minus-circle';
        return '<div class="instance-card ' + (isDefault ? 'default-instance' : '') + '" data-instance-index="' + index + '" data-app-type="indexer" data-preset="' + preset + '" data-enabled="' + enabled + '">' +
            '<div class="instance-card-header">' +
            '<div class="instance-name instance-name-with-priority"><i class="fas fa-server"></i><span>' + name + '</span>' + (isDefault ? '<span class="default-badge">Default</span>' : '') + '</div>' +
            '<div class="instance-status-icon ' + statusClass + '"><i class="fas ' + statusIcon + '"></i></div>' +
            '</div>' +
            '<div class="instance-card-body">' +
            '<div class="instance-detail"><i class="fas fa-key"></i><span>••••••••' + last4 + '</span></div>' +
            '</div>' +
            '<div class="instance-card-footer">' +
            '<button type="button" class="btn-card edit" data-app-type="indexer" data-instance-index="' + index + '"><i class="fas fa-edit"></i> Edit</button>' +
            '<button type="button" class="btn-card delete" data-app-type="indexer" data-instance-index="' + index + '"><i class="fas fa-trash"></i> Delete</button>' +
            '</div></div>';
    };

    Forms.refreshIndexersList = function() {
        if (window.MovieHuntInstanceDropdown && document.getElementById('settings-indexers-instance-select') && !Forms._indexersInstanceDropdownAttached) {
            window.MovieHuntInstanceDropdown.attach('settings-indexers-instance-select', function() { Forms.refreshIndexersList(); });
            Forms._indexersInstanceDropdownAttached = true;
        }
        const grid = document.getElementById('indexer-instances-grid');
        if (!grid) return;
        fetch('./api/indexers')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                const list = (data && data.indexers) ? data.indexers : [];
                window.SettingsForms._indexersList = list;
                let html = '';
                for (let i = 0; i < list.length; i++) {
                    html += window.SettingsForms.renderIndexerCard(list[i], i);
                }
                html += '<div class="add-instance-card" data-app-type="indexer"><div class="add-icon"><i class="fas fa-plus-circle"></i></div><div class="add-text">Adding Indexer</div></div>';
                grid.innerHTML = html;
            })
            .catch(function() {
                grid.innerHTML = '<div class="add-instance-card" data-app-type="indexer"><div class="add-icon"><i class="fas fa-plus-circle"></i></div><div class="add-text">Adding Indexer</div></div>';
            });
    };
})();
