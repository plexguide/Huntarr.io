/**
 * Client Management (Movie Hunt) - list and CRUD for download clients.
 * Separate from Client Editor (client-editor.js). Attaches to window.SettingsForms.
 * Load after client-editor.js so openClientEditor is available for grid clicks.
 */
(function() {
    'use strict';
    if (typeof window.SettingsForms === 'undefined') return;

    const Forms = window.SettingsForms;

    Forms.renderClientCard = function(client, index) {
        const name = (client.name || 'Unnamed').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const type = (client.type || 'nzbget').replace(/"/g, '&quot;');
        const isNzbHunt = type === 'nzbhunt';
        const enabled = client.enabled !== false;
        const statusClass = enabled ? 'status-connected' : 'status-error';
        const statusIcon = enabled ? 'fa-check-circle' : 'fa-minus-circle';
        const priority = client.client_priority !== undefined && client.client_priority !== null ? Number(client.client_priority) : 50;
        
        var bodyHtml;
        if (isNzbHunt) {
            bodyHtml = '<div class="instance-detail"><i class="fas fa-bolt" style="color: #10b981;"></i><span style="color: #10b981; font-weight: 500;">Built-in Client</span></div>' +
                '<div class="instance-detail"><i class="fas fa-server"></i><span>Uses NZB Hunt Servers</span></div>';
        } else {
            var last4 = client.api_key_last4 || client.password_last4 || '****';
            bodyHtml = '<div class="instance-detail"><i class="fas fa-key"></i><span>••••••••' + last4 + '</span></div>' +
                '<div class="instance-detail"><i class="fas fa-server"></i><span>' + (client.host || '').replace(/</g, '&lt;') + ':' + (client.port !== undefined ? client.port : '') + '</span></div>';
        }
        
        return '<div class="instance-card" data-instance-index="' + index + '" data-app-type="client" data-type="' + type + '" data-enabled="' + enabled + '">' +
            '<div class="instance-card-header">' +
            '<div class="instance-name instance-name-with-priority"><i class="fas ' + (isNzbHunt ? 'fa-bolt' : 'fa-download') + '"></i><span>' + name + '</span><span class="client-priority-badge">Priority: ' + String(priority) + '</span></div>' +
            '<div class="instance-status-icon ' + statusClass + '"><i class="fas ' + statusIcon + '"></i></div>' +
            '</div>' +
            '<div class="instance-card-body">' + bodyHtml + '</div>' +
            '<div class="instance-card-footer">' +
            '<button type="button" class="btn-card edit" data-app-type="client" data-instance-index="' + index + '"><i class="fas fa-edit"></i> Edit</button>' +
            '<button type="button" class="btn-card delete" data-app-type="client" data-instance-index="' + index + '"><i class="fas fa-trash"></i> Delete</button>' +
            '</div></div>';
    };

    Forms.refreshClientsList = function() {
        const grid = document.getElementById('client-instances-grid');
        const noInstEl = document.getElementById('settings-clients-no-instances');
        const wrapperEl = document.getElementById('settings-clients-content-wrapper');
        if (!grid) return;
        Promise.all([
            fetch('./api/movie-hunt/instances', { cache: 'no-store' }).then(function(r) { return r.json(); }),
            fetch('./api/tv-hunt/instances', { cache: 'no-store' }).then(function(r) { return r.json(); })
        ]).then(function(results) {
            var movieCount = (results[0].instances || []).length;
            var tvCount = (results[1].instances || []).length;
            if (movieCount === 0 && tvCount === 0) {
                if (noInstEl) noInstEl.style.display = '';
                if (wrapperEl) wrapperEl.style.display = 'none';
                return;
            }
            if (noInstEl) noInstEl.style.display = 'none';
            if (wrapperEl) wrapperEl.style.display = '';
            _doRefreshClientsList(grid);
        }).catch(function() {
            if (noInstEl) noInstEl.style.display = 'none';
            if (wrapperEl) wrapperEl.style.display = '';
            _doRefreshClientsList(grid);
        });
    };

    function _doRefreshClientsList(grid) {
        fetch('./api/clients')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                const list = (data && data.clients) ? data.clients : [];
                window.SettingsForms._clientsList = list;
                var withIndex = list.map(function(c, i) { return { client: c, originalIndex: i }; });
                withIndex.sort(function(a, b) {
                    var pa = Number(a.client.client_priority) || 50;
                    var pb = Number(b.client.client_priority) || 50;
                    if (pa !== pb) return pa - pb;
                    var na = (a.client.name || '').toLowerCase();
                    var nb = (b.client.name || '').toLowerCase();
                    return na.localeCompare(nb);
                });
                var html = '';
                for (var i = 0; i < withIndex.length; i++) {
                    html += window.SettingsForms.renderClientCard(withIndex[i].client, withIndex[i].originalIndex);
                }
                html += '<div class="add-instance-card" data-app-type="client"><div class="add-icon"><i class="fas fa-plus-circle"></i></div><div class="add-text">Adding Client</div></div>';
                grid.innerHTML = html;
                
                // Also refresh remote mappings if available
                if (window.RemoteMappings && typeof window.RemoteMappings.refreshList === 'function') {
                    window.RemoteMappings.refreshList();
                }
            })
            .catch(function() {
                grid.innerHTML = '<div class="add-instance-card" data-app-type="client"><div class="add-icon"><i class="fas fa-plus-circle"></i></div><div class="add-text">Adding Client</div></div>';
            });
    }

    document.addEventListener('huntarr:instances-changed', function() {
        if (document.getElementById('settings-clients-content-wrapper') && window.huntarrUI && window.huntarrUI.currentSection === 'settings-clients') {
            Forms.refreshClientsList();
        }
    });
    document.addEventListener('huntarr:tv-hunt-instances-changed', function() {
        if (document.getElementById('settings-clients-content-wrapper') && window.huntarrUI && window.huntarrUI.currentSection === 'settings-clients') {
            Forms.refreshClientsList();
        }
    });
})();
