/**
 * TV Hunt Instance Management - list, add, edit name, delete.
 * Mirrors Movie Hunt instance management but uses TV Hunt API endpoints.
 */
(function() {
    'use strict';

    var baseUrl = (typeof window !== 'undefined' && window.HUNTARR_BASE_URL) ? window.HUNTARR_BASE_URL.replace(/\/$/, '') : '';
    function api(path) { return (baseUrl || '') + (path.indexOf('./') === 0 ? path : './' + path); }
    function escapeHtml(s) { return s == null ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    function escapeAttr(s) { return s == null ? '' : String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

    window.TVHuntInstanceManagement = {
        _initialized: false,

        init: function() {
            var self = this;
            if (!this._initialized) {
                this._initialized = true;
                var addCard = document.getElementById('th-instance-management-add-card');
                if (addCard) addCard.addEventListener('click', function() { self.openAddModal(); });
                this.initAddModal();
                this.initDeleteModal();
                this.initRenameModal();
            }
            this.loadList();
        },

        initAddModal: function() {
            var self = this;
            var modal = document.getElementById('th-instance-add-modal');
            var backdrop = document.getElementById('th-instance-add-modal-backdrop');
            var closeBtn = document.getElementById('th-instance-add-modal-close');
            var cancelBtn = document.getElementById('th-instance-add-modal-cancel');
            var okBtn = document.getElementById('th-instance-add-modal-ok');
            var input = document.getElementById('th-instance-add-name');
            if (!modal) return;
            function closeModal() { modal.style.display = 'none'; document.body.classList.remove('instance-add-modal-open'); }
            if (backdrop) backdrop.onclick = closeModal;
            if (closeBtn) closeBtn.onclick = closeModal;
            if (cancelBtn) cancelBtn.onclick = closeModal;
            if (okBtn) {
                okBtn.onclick = function() {
                    var name = (input && input.value) ? input.value.trim() : '';
                    if (!name) name = 'Unnamed';
                    okBtn.disabled = true;
                    fetch(api('./api/tv-hunt/instances'), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name: name })
                    })
                    .then(function(r) { return r.json(); })
                    .then(function(data) {
                        if (data.error) {
                            if (window.huntarrUI) window.huntarrUI.showNotification(data.error, 'error');
                            return;
                        }
                        if (window.huntarrUI) window.huntarrUI.showNotification('Instance added.', 'success');
                        closeModal();
                        self.loadList();
                        try { document.dispatchEvent(new CustomEvent('huntarr:instances-changed', { detail: { appType: 'tv_hunt' } })); } catch(e) {}
                        if (window.updateTVHuntSettingsVisibility) window.updateTVHuntSettingsVisibility();
                    })
                    .catch(function() { if (window.huntarrUI) window.huntarrUI.showNotification('Request failed.', 'error'); })
                    .finally(function() { okBtn.disabled = false; });
                };
            }
            document.addEventListener('keydown', function(e) { if (e.key === 'Escape' && modal.style.display === 'flex') closeModal(); });
        },

        initDeleteModal: function() {
            var self = this;
            var modal = document.getElementById('th-instance-delete-modal');
            var messageEl = document.getElementById('th-instance-delete-modal-message');
            var backdrop = document.getElementById('th-instance-delete-modal-backdrop');
            var closeBtn = document.getElementById('th-instance-delete-modal-close');
            var cancelBtn = document.getElementById('th-instance-delete-modal-cancel');
            var confirmBtn = document.getElementById('th-instance-delete-modal-confirm');
            if (!modal) return;
            function closeModal() { modal.style.display = 'none'; document.body.classList.remove('instance-delete-modal-open'); modal.removeAttribute('data-pending-id'); }
            if (backdrop) backdrop.onclick = closeModal;
            if (closeBtn) closeBtn.onclick = closeModal;
            if (cancelBtn) cancelBtn.onclick = closeModal;
            if (confirmBtn) {
                confirmBtn.onclick = function() {
                    var id = modal.getAttribute('data-pending-id');
                    if (!id) return;
                    confirmBtn.disabled = true;
                    fetch(api('./api/tv-hunt/instances/' + id), { method: 'DELETE' })
                    .then(function(r) { return r.json(); })
                    .then(function(data) {
                        if (data.error) { if (window.huntarrUI) window.huntarrUI.showNotification(data.error, 'error'); return; }
                        if (window.huntarrUI) window.huntarrUI.showNotification('Instance deleted.', 'success');
                        closeModal();
                        self.loadList();
                        try { document.dispatchEvent(new CustomEvent('huntarr:instances-changed', { detail: { appType: 'tv_hunt' } })); } catch(e) {}
                        if (window.updateTVHuntSettingsVisibility) window.updateTVHuntSettingsVisibility();
                    })
                    .catch(function() { if (window.huntarrUI) window.huntarrUI.showNotification('Request failed.', 'error'); })
                    .finally(function() { confirmBtn.disabled = false; });
                };
            }
            document.addEventListener('keydown', function(e) { if (e.key === 'Escape' && modal.style.display === 'flex') closeModal(); });
        },

        openDeleteModal: function(id, name) {
            var modal = document.getElementById('th-instance-delete-modal');
            var messageEl = document.getElementById('th-instance-delete-modal-message');
            if (!modal || !messageEl) return;
            messageEl.textContent = 'Delete instance "' + (name || id || 'this instance') + '"? This cannot be undone.';
            modal.setAttribute('data-pending-id', String(id));
            if (modal.parentNode !== document.body) document.body.appendChild(modal);
            modal.style.display = 'flex';
            document.body.classList.add('instance-delete-modal-open');
        },

        initRenameModal: function() {
            var self = this;
            var modal = document.getElementById('th-instance-rename-modal');
            var backdrop = document.getElementById('th-instance-rename-modal-backdrop');
            var closeBtn = document.getElementById('th-instance-rename-modal-close');
            var cancelBtn = document.getElementById('th-instance-rename-modal-cancel');
            var saveBtn = document.getElementById('th-instance-rename-modal-save');
            var input = document.getElementById('th-instance-rename-name');
            if (!modal) return;
            function closeModal() { modal.style.display = 'none'; document.body.classList.remove('instance-rename-modal-open'); modal.removeAttribute('data-pending-id'); }
            if (backdrop) backdrop.onclick = closeModal;
            if (closeBtn) closeBtn.onclick = closeModal;
            if (cancelBtn) cancelBtn.onclick = closeModal;
            if (saveBtn) {
                saveBtn.onclick = function() {
                    var id = modal.getAttribute('data-pending-id');
                    var name = (input && input.value) ? input.value.trim() : '';
                    if (!id) return;
                    if (!name) name = 'Unnamed';
                    saveBtn.disabled = true;
                    fetch(api('./api/tv-hunt/instances/' + id), {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name: name })
                    })
                    .then(function(r) { return r.json(); })
                    .then(function(data) {
                        if (data.error) { if (window.huntarrUI) window.huntarrUI.showNotification(data.error, 'error'); return; }
                        if (window.huntarrUI) window.huntarrUI.showNotification('Instance renamed.', 'success');
                        closeModal();
                        self.loadList();
                        try { document.dispatchEvent(new CustomEvent('huntarr:instances-changed', { detail: { appType: 'tv_hunt' } })); } catch(e) {}
                    })
                    .catch(function() { if (window.huntarrUI) window.huntarrUI.showNotification('Request failed.', 'error'); })
                    .finally(function() { saveBtn.disabled = false; });
                };
            }
            document.addEventListener('keydown', function(e) { if (e.key === 'Escape' && modal.style.display === 'flex') closeModal(); });
        },

        openRenameModal: function(id, currentName) {
            var modal = document.getElementById('th-instance-rename-modal');
            var input = document.getElementById('th-instance-rename-name');
            if (!modal || !input) return;
            modal.setAttribute('data-pending-id', String(id));
            input.value = (currentName || '').trim();
            if (modal.parentNode !== document.body) document.body.appendChild(modal);
            modal.style.display = 'flex';
            document.body.classList.add('instance-rename-modal-open');
            setTimeout(function() { input.focus(); }, 100);
        },

        openAddModal: function() {
            var modal = document.getElementById('th-instance-add-modal');
            var input = document.getElementById('th-instance-add-name');
            if (modal && modal.parentNode !== document.body) document.body.appendChild(modal);
            if (modal) modal.style.display = 'flex';
            if (input) { input.value = ''; setTimeout(function() { input.focus(); }, 100); }
            document.body.classList.add('instance-add-modal-open');
        },

        loadList: function() {
            var grid = document.getElementById('tvHuntInstanceManagementGrid');
            if (!grid) return;
            var addCard = document.getElementById('th-instance-management-add-card');
            var addCardClone = addCard ? addCard.cloneNode(true) : null;
            if (addCard) addCard.remove();
            grid.innerHTML = '<div class="instance-management-loading">Loading...</div>';
            fetch(api('./api/tv-hunt/instances'), { cache: 'no-store' })
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
                        '<span class="instance-name"><i class="fas fa-tv" style="margin-right: 8px;"></i>' + escapeHtml(inst.name || 'Instance ' + inst.id) + '</span>' +
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
                    addCardClone.id = 'th-instance-management-add-card';
                    grid.appendChild(addCardClone);
                    addCardClone.addEventListener('click', function() { window.TVHuntInstanceManagement.openAddModal(); });
                }
                grid.querySelectorAll('.btn-card.edit').forEach(function(btn) {
                    btn.addEventListener('click', function(e) {
                        e.stopPropagation();
                        if (window.TVHuntInstanceEditor && typeof window.TVHuntInstanceEditor.openEditor === 'function') {
                            window.TVHuntInstanceEditor.openEditor(btn.getAttribute('data-id'), btn.getAttribute('data-name') || ('Instance ' + btn.getAttribute('data-id')));
                        }
                    });
                });
                grid.querySelectorAll('.btn-card.delete').forEach(function(btn) {
                    btn.addEventListener('click', function(e) {
                        e.stopPropagation();
                        window.TVHuntInstanceManagement.openDeleteModal(btn.getAttribute('data-id'), btn.getAttribute('data-name') || '');
                    });
                });
            })
            .catch(function() {
                grid.innerHTML = '<div class="instance-management-loading" style="color: #f87171;">Failed to load instances.</div>';
                if (addCardClone) { grid.appendChild(addCardClone); addCardClone.addEventListener('click', function() { window.TVHuntInstanceManagement.openAddModal(); }); }
            });
        },

        promptAdd: function() { this.openAddModal(); },
        promptDelete: function(id, name) { this.openDeleteModal(id, name); }
    };
})();
