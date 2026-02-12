/**
 * Indexer Management (Movie Hunt) - list and CRUD for indexers.
 * Splits indexers into Standard (manual) and Indexer Hunt (synced) groups.
 * Separate from Indexer Editor (indexer-editor.js). Attaches to window.SettingsForms.
 * Load after indexer-editor.js so openIndexerEditor is available for grid clicks.
 */
(function() {
    'use strict';
    if (typeof window.SettingsForms === 'undefined') return;

    const Forms = window.SettingsForms;

    Forms.renderIndexerCard = function(indexer, index) {
        const isDefault = index === 0;
        // For IH-synced indexers, show display_name (custom tracking name) in header; fall back to preset name
        const isIHCard = !!(indexer.indexer_hunt_id);
        const headerName = isIHCard && indexer.display_name ? indexer.display_name : (indexer.name || 'Unnamed');
        const name = headerName.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const last4 = indexer.api_key_last4 || '****';
        const preset = (indexer.preset || 'manual').replace(/"/g, '&quot;');
        const enabled = indexer.enabled !== false;
        const statusClass = enabled ? 'status-connected' : 'status-error';
        const statusIcon = enabled ? 'fa-check-circle' : 'fa-minus-circle';
        const isIH = !!(indexer.indexer_hunt_id);
        var urlDisplay = '';
        var rawUrl = indexer.url || '';
        if (!rawUrl && window.INDEXER_PRESET_META && window.INDEXER_PRESET_META[preset]) {
            rawUrl = window.INDEXER_PRESET_META[preset].url || '';
        }
        if (rawUrl) {
            var shortUrl = rawUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
            if (shortUrl.length > 30) shortUrl = shortUrl.substring(0, 28) + '\u2026';
            urlDisplay = '<div class="instance-detail"><i class="fas fa-link"></i><span>' + shortUrl.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span></div>';
        }
        // IH linked badge
        var ihBadge = isIH ? '<span style="font-size:0.65rem;background:rgba(99,102,241,0.15);color:#818cf8;padding:2px 6px;border-radius:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-left:6px;">Synced</span>' : '';

        return '<div class="instance-card ' + (isDefault ? 'default-instance' : '') + '" data-instance-index="' + index + '" data-app-type="indexer" data-preset="' + preset + '" data-enabled="' + enabled + '" data-ih="' + (isIH ? '1' : '0') + '">' +
            '<div class="instance-card-header">' +
            '<div class="instance-name instance-name-with-priority"><i class="fas fa-server"></i><span>' + name + '</span>' + (isDefault ? '<span class="default-badge">Default</span>' : '') + ihBadge + '</div>' +
            '<div class="instance-status-icon ' + statusClass + '"><i class="fas ' + statusIcon + '"></i></div>' +
            '</div>' +
            '<div class="instance-card-body">' +
            urlDisplay +
            '<div class="instance-detail"><i class="fas fa-key"></i><span>\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' + last4 + '</span></div>' +
            '<div class="instance-detail"><i class="fas fa-sort-numeric-down"></i><span>Priority: ' + (indexer.priority || 50) + '</span></div>' +
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
        var stdGrid = document.getElementById('indexer-instances-grid-standard');
        var ihGrid = document.getElementById('indexer-instances-grid-ih');
        // Fallback: old single grid
        var legacyGrid = document.getElementById('indexer-instances-grid');

        fetch('./api/indexers')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var list = (data && data.indexers) ? data.indexers : [];
                window.SettingsForms._indexersList = list;

                // Split into standard and IH-linked
                var stdHtml = '';
                var ihHtml = '';
                for (var i = 0; i < list.length; i++) {
                    var card = window.SettingsForms.renderIndexerCard(list[i], i);
                    if (list[i].indexer_hunt_id) {
                        ihHtml += card;
                    } else {
                        stdHtml += card;
                    }
                }

                if (stdGrid) {
                    stdHtml += '<div class="add-instance-card" data-app-type="indexer" data-source="standard"><div class="add-icon"><i class="fas fa-plus-circle"></i></div><div class="add-text">Add Indexer</div></div>';
                    stdGrid.innerHTML = stdHtml;
                }
                if (ihGrid) {
                    ihHtml += '<div class="add-instance-card" data-app-type="indexer" data-source="indexer-hunt"><div class="add-icon"><i class="fas fa-plus-circle" style="color: #6366f1;"></i></div><div class="add-text">Import from Indexer Hunt</div></div>';
                    ihGrid.innerHTML = ihHtml;
                }

                // Fallback for legacy single grid
                if (legacyGrid && !stdGrid && !ihGrid) {
                    var allHtml = '';
                    for (var j = 0; j < list.length; j++) {
                        allHtml += window.SettingsForms.renderIndexerCard(list[j], j);
                    }
                    allHtml += '<div class="add-instance-card" data-app-type="indexer"><div class="add-icon"><i class="fas fa-plus-circle"></i></div><div class="add-text">Add Indexer</div></div>';
                    legacyGrid.innerHTML = allHtml;
                }
            })
            .catch(function() {
                if (stdGrid) stdGrid.innerHTML = '<div class="add-instance-card" data-app-type="indexer" data-source="standard"><div class="add-icon"><i class="fas fa-plus-circle"></i></div><div class="add-text">Add Indexer</div></div>';
                if (ihGrid) ihGrid.innerHTML = '<div class="add-instance-card" data-app-type="indexer" data-source="indexer-hunt"><div class="add-icon"><i class="fas fa-plus-circle" style="color: #6366f1;"></i></div><div class="add-text">Import from Indexer Hunt</div></div>';
            });
    };
})();
