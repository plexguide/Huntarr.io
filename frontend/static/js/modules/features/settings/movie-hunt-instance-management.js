/**
 * Movie Hunt Instance Management - list, add (prompt name), edit name, delete.
 * IDs never reused; names made unique by auto-appending -1, -2 if needed.
 */
(function() {
    'use strict';

    var baseUrl = (typeof window !== 'undefined' && window.HUNTARR_BASE_URL) ? window.HUNTARR_BASE_URL.replace(/\/$/, '') : '';

    function api(path) {
        return (baseUrl || '') + (path.indexOf('./') === 0 ? path : './' + path);
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

    window.MovieHuntInstanceManagement = {
        init: function() {
            var self = this;
            var addBtn = document.getElementById('instance-management-add');
            if (addBtn) addBtn.addEventListener('click', function() { self.promptAdd(); });
            this.loadList();
        },

        loadList: function() {
            var tbody = document.getElementById('instanceManagementTableBody');
            if (!tbody) return;
            tbody.innerHTML = '<tr><td colspan="3">Loading...</td></tr>';
            fetch(api('./api/movie-hunt/instances'), { cache: 'no-store' })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    var list = data.instances || [];
                    tbody.innerHTML = '';
                    if (list.length === 0) {
                        tbody.innerHTML = '<tr><td colspan="3">No instances. Add one above.</td></tr>';
                        return;
                    }
                    list.forEach(function(inst) {
                        var tr = document.createElement('tr');
                        tr.innerHTML =
                            '<td>' + escapeHtml(inst.id) + '</td>' +
                            '<td><span class="instance-name-cell">' + escapeHtml(inst.name || 'Instance ' + inst.id) + '</span></td>' +
                            '<td class="col-actions">' +
                            '<button type="button" class="btn-edit" data-id="' + escapeHtml(String(inst.id)) + '" data-name="' + escapeAttr(inst.name || '') + '" aria-label="Edit name">Edit</button>' +
                            '<button type="button" class="btn-delete" data-id="' + escapeHtml(String(inst.id)) + '" data-name="' + escapeAttr(inst.name || '') + '" aria-label="Delete">Delete</button>' +
                            '</td>';
                        tbody.appendChild(tr);
                    });
                    tbody.querySelectorAll('.btn-edit').forEach(function(btn) {
                        btn.addEventListener('click', function() {
                            window.MovieHuntInstanceManagement.promptRename(btn.getAttribute('data-id'), btn.getAttribute('data-name') || '');
                        });
                    });
                    tbody.querySelectorAll('.btn-delete').forEach(function(btn) {
                        btn.addEventListener('click', function() {
                            window.MovieHuntInstanceManagement.promptDelete(btn.getAttribute('data-id'), btn.getAttribute('data-name') || '');
                        });
                    });
                })
                .catch(function() {
                    tbody.innerHTML = '<tr><td colspan="3">Failed to load instances.</td></tr>';
                });
        },

        promptAdd: function() {
            var name = window.prompt('Enter a name for the new instance:');
            if (name == null) return;
            name = (name || '').trim() || 'Unnamed';
            fetch(api('./api/movie-hunt/instances'), {
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
                    window.MovieHuntInstanceManagement.loadList();
                    if (window.MovieHuntInstanceDropdown && window.MovieHuntInstanceDropdown.refresh) {
                        ['movie-hunt-instance-select', 'movie-hunt-collection-instance-select', 'activity-instance-select', 'movie-management-instance-select', 'settings-profiles-instance-select', 'settings-custom-formats-instance-select', 'settings-indexers-instance-select', 'settings-clients-instance-select', 'settings-root-folders-instance-select'].forEach(function(id) {
                            if (document.getElementById(id)) window.MovieHuntInstanceDropdown.refresh(id);
                        });
                    }
                })
                .catch(function() {
                    if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Request failed.', 'error');
                });
        },

        promptRename: function(id, currentName) {
            var name = window.prompt('Rename instance:', currentName);
            if (name == null) return;
            name = (name || '').trim() || 'Unnamed';
            fetch(api('./api/movie-hunt/instances/' + id), {
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
                    window.MovieHuntInstanceManagement.loadList();
                    if (window.MovieHuntInstanceDropdown && window.MovieHuntInstanceDropdown.refresh) {
                        ['movie-hunt-instance-select', 'movie-hunt-collection-instance-select', 'activity-instance-select', 'movie-management-instance-select', 'settings-profiles-instance-select', 'settings-custom-formats-instance-select', 'settings-indexers-instance-select', 'settings-clients-instance-select', 'settings-root-folders-instance-select'].forEach(function(sid) {
                            if (document.getElementById(sid)) window.MovieHuntInstanceDropdown.refresh(sid);
                        });
                    }
                })
                .catch(function() {
                    if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Request failed.', 'error');
                });
        },

        promptDelete: function(id, name) {
            if (!window.confirm('Delete instance "' + (name || id) + '"? This cannot be undone. Its data will remain but the instance will no longer appear.')) return;
            fetch(api('./api/movie-hunt/instances/' + id), { method: 'DELETE' })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.error) {
                        if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification(data.error, 'error');
                        return;
                    }
                    if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Instance deleted.', 'success');
                    window.MovieHuntInstanceManagement.loadList();
                    if (window.MovieHuntInstanceDropdown && window.MovieHuntInstanceDropdown.refresh) {
                        ['movie-hunt-instance-select', 'movie-hunt-collection-instance-select', 'activity-instance-select', 'movie-management-instance-select', 'settings-profiles-instance-select', 'settings-custom-formats-instance-select', 'settings-indexers-instance-select', 'settings-clients-instance-select', 'settings-root-folders-instance-select'].forEach(function(sid) {
                            if (document.getElementById(sid)) window.MovieHuntInstanceDropdown.refresh(sid);
                        });
                    }
                })
                .catch(function() {
                    if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Request failed.', 'error');
                });
        }
    };
})();
