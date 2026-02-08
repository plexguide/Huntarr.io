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
            var addCard = document.getElementById('instance-management-add-card');
            if (addCard) addCard.addEventListener('click', function() { self.openAddModal(); });
            this.initAddModal();
            this.loadList();
        },

        initAddModal: function() {
            var self = this;
            var modal = document.getElementById('instance-add-modal');
            var backdrop = document.getElementById('instance-add-modal-backdrop');
            var closeBtn = document.getElementById('instance-add-modal-close');
            var cancelBtn = document.getElementById('instance-add-modal-cancel');
            var okBtn = document.getElementById('instance-add-modal-ok');
            var input = document.getElementById('instance-add-name');
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
                    if (!name) name = 'Unnamed';
                    okBtn.disabled = true;
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
                            closeModal();
                            self.loadList();
                            if (window.MovieHuntInstanceDropdown && window.MovieHuntInstanceDropdown.refresh) {
                                ['movie-hunt-instance-select', 'movie-hunt-collection-instance-select', 'activity-instance-select', 'movie-management-instance-select', 'settings-profiles-instance-select', 'settings-custom-formats-instance-select', 'settings-indexers-instance-select', 'settings-clients-instance-select', 'settings-root-folders-instance-select'].forEach(function(id) {
                                    if (document.getElementById(id)) window.MovieHuntInstanceDropdown.refresh(id);
                                });
                            }
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

        openAddModal: function() {
            var modal = document.getElementById('instance-add-modal');
            var input = document.getElementById('instance-add-name');
            if (modal && modal.parentNode !== document.body) document.body.appendChild(modal);
            if (modal) modal.style.display = 'flex';
            if (input) {
                input.value = '';
                setTimeout(function() { input.focus(); }, 100);
            }
            document.body.classList.add('instance-add-modal-open');
        },

        loadList: function() {
            var grid = document.getElementById('instanceManagementGrid');
            if (!grid) return;
            var addCard = document.getElementById('instance-management-add-card');
            var addCardClone = addCard ? addCard.cloneNode(true) : null;
            if (addCard) addCard.remove();
            grid.innerHTML = '<div class="instance-management-loading">Loading...</div>';
            fetch(api('./api/movie-hunt/instances'), { cache: 'no-store' })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    var list = data.instances || [];
                    grid.innerHTML = '';
                    list.forEach(function(inst) {
                        var card = document.createElement('div');
                        card.className = 'instance-card';
                        card.innerHTML =
                            '<div class="instance-card-header">' +
                            '<span class="instance-name">' + escapeHtml(inst.name || 'Instance ' + inst.id) + '</span>' +
                            '</div>' +
                            '<div class="instance-card-body">' +
                            '<div class="instance-detail"><i class="fas fa-hashtag"></i><span>ID ' + escapeHtml(inst.id) + '</span></div>' +
                            '</div>' +
                            '<div class="instance-card-footer">' +
                            '<button type="button" class="btn-card edit" data-id="' + escapeHtml(String(inst.id)) + '" data-name="' + escapeAttr(inst.name || '') + '" aria-label="Edit name"><i class="fas fa-pencil-alt"></i> Edit</button>' +
                            '<button type="button" class="btn-card delete" data-id="' + escapeHtml(String(inst.id)) + '" data-name="' + escapeAttr(inst.name || '') + '" aria-label="Delete"><i class="fas fa-trash"></i> Delete</button>' +
                            '</div>';
                        grid.appendChild(card);
                    });
                    if (addCardClone) {
                        addCardClone.id = 'instance-management-add-card';
                        addCardClone.setAttribute('data-app-type', 'instance');
                        grid.appendChild(addCardClone);
                        addCardClone.addEventListener('click', function() { window.MovieHuntInstanceManagement.openAddModal(); });
                    }
                    grid.querySelectorAll('.btn-card.edit').forEach(function(btn) {
                        btn.addEventListener('click', function(e) {
                            e.stopPropagation();
                            window.MovieHuntInstanceManagement.promptRename(btn.getAttribute('data-id'), btn.getAttribute('data-name') || '');
                        });
                    });
                    grid.querySelectorAll('.btn-card.delete').forEach(function(btn) {
                        btn.addEventListener('click', function(e) {
                            e.stopPropagation();
                            window.MovieHuntInstanceManagement.promptDelete(btn.getAttribute('data-id'), btn.getAttribute('data-name') || '');
                        });
                    });
                })
                .catch(function() {
                    grid.innerHTML = '<div class="instance-management-loading" style="color: #f87171;">Failed to load instances.</div>';
                    if (addCardClone) {
                        grid.appendChild(addCardClone);
                        addCardClone.addEventListener('click', function() { window.MovieHuntInstanceManagement.openAddModal(); });
                    }
                });
        },

        promptAdd: function() {
            this.openAddModal();
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
