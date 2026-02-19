/**
 * Requestarr User Management Module
 * Handles user list, create/edit/delete, Plex import, and permissions.
 */

window.RequestarrUsers = {
    users: [],
    permissionLabels: {
        request_movies: 'Request Movies',
        request_tv: 'Request TV',
        auto_approve: 'Auto Approve All',
        auto_approve_movies: 'Auto Approve Movies',
        auto_approve_tv: 'Auto Approve TV',
        manage_requests: 'Manage Requests',
        manage_users: 'Manage Users',
        view_requests: 'View All Requests',
        hide_media_global: 'Hide Media (Global)',
    },

    async init() {
        await this.loadUsers();
    },

    async loadUsers() {
        const container = document.getElementById('requestarr-users-view');
        if (!container) return;
        try {
            const resp = await fetch('./api/requestarr/users', { cache: 'no-store' });
            if (!resp.ok) throw new Error('Failed to load users');
            const data = await resp.json();
            this.users = data.users || [];
            this.render();
        } catch (e) {
            console.error('[RequestarrUsers] Error loading users:', e);
            this.renderError();
        }
    },

    render() {
        const container = document.getElementById('requsers-content');
        if (!container) return;

        const rows = this.users.map(u => {
            const initials = (u.username || '?').substring(0, 2).toUpperCase();
            const avatarHtml = u.avatar_url
                ? `<img src="${u.avatar_url}" alt="" onerror="this.style.display='none';this.parentElement.textContent='${initials}'">`
                : initials;
            const roleClass = `requsers-role-${u.role || 'user'}`;
            const joined = u.created_at ? new Date(u.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
            const isOwner = u.role === 'owner';

            return `<tr data-user-id="${u.id}">
                <td>
                    <div class="requsers-user-cell">
                        <div class="requsers-avatar">${avatarHtml}</div>
                        <div class="requsers-user-info">
                            <span class="requsers-user-name">${this._esc(u.username)}</span>
                            ${u.email ? `<span class="requsers-user-email">${this._esc(u.email)}</span>` : ''}
                        </div>
                    </div>
                </td>
                <td>${u.request_count || 0}</td>
                <td><span class="requsers-role-badge ${roleClass}">${u.role || 'user'}</span></td>
                <td>${joined}</td>
                <td>
                    <div class="requsers-actions">
                        <button class="requsers-btn requsers-btn-primary requsers-btn-sm" onclick="RequestarrUsers.openEditModal(${u.id})">Edit</button>
                        ${!isOwner ? `<button class="requsers-btn requsers-btn-danger requsers-btn-sm" onclick="RequestarrUsers.confirmDelete(${u.id}, '${this._esc(u.username)}')">Delete</button>` : ''}
                    </div>
                </td>
            </tr>`;
        }).join('');

        container.innerHTML = `
            <div class="requsers-table-wrap">
                <table class="requsers-table">
                    <thead>
                        <tr>
                            <th>User</th>
                            <th>Requests</th>
                            <th>Role</th>
                            <th>Joined</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>${rows || '<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--text-muted);">No users found</td></tr>'}</tbody>
                </table>
                <div class="requsers-pagination">
                    <span>Showing ${this.users.length} user${this.users.length !== 1 ? 's' : ''}</span>
                </div>
            </div>`;
    },

    renderError() {
        const container = document.getElementById('requsers-content');
        if (container) {
            container.innerHTML = '<p style="color:var(--error-color);padding:20px;">Failed to load users. Check your connection.</p>';
        }
    },

    // ── Create User Modal ────────────────────────────────────

    openCreateModal() {
        this._openModal('Create Local User', null);
    },

    openEditModal(userId) {
        const user = this.users.find(u => u.id === userId);
        if (!user) return;
        this._openModal('Edit User', user);
    },

    _openModal(title, user) {
        const isEdit = !!user;
        const perms = (user && typeof user.permissions === 'object') ? user.permissions : {};

        const permsHtml = Object.entries(this.permissionLabels).map(([key, label]) => {
            const checked = perms[key] ? 'checked' : '';
            const disabled = (user && user.role === 'owner') ? 'disabled' : '';
            return `<label class="requsers-perm-item">
                <input type="checkbox" name="perm_${key}" ${checked} ${disabled}>
                <span>${label}</span>
            </label>`;
        }).join('');

        const html = `<div class="requsers-modal-overlay" id="requsers-modal-overlay" onclick="if(event.target===this)RequestarrUsers.closeModal()">
            <div class="requsers-modal">
                <div class="requsers-modal-header">
                    <h3 class="requsers-modal-title">${title}</h3>
                    <button class="requsers-modal-close" onclick="RequestarrUsers.closeModal()"><i class="fas fa-times"></i></button>
                </div>
                <div class="requsers-modal-body">
                    <div class="requsers-field">
                        <label>Username</label>
                        <input type="text" id="requsers-modal-username" value="${isEdit ? this._esc(user.username) : ''}" ${isEdit && user.role === 'owner' ? 'disabled' : ''} placeholder="Enter username" minlength="3">
                    </div>
                    <div class="requsers-field">
                        <label>Email (optional)</label>
                        <input type="email" id="requsers-modal-email" value="${isEdit ? this._esc(user.email || '') : ''}" placeholder="user@example.com">
                    </div>
                    <div class="requsers-field">
                        <label>${isEdit ? 'New Password (leave blank to keep)' : 'Password'}</label>
                        <input type="password" id="requsers-modal-password" placeholder="${isEdit ? '••••••••' : 'Min 8 characters'}" minlength="8" autocomplete="new-password">
                        <div class="requsers-field-hint"><a href="#" onclick="RequestarrUsers.fillGeneratedPassword();return false;">Generate random password</a></div>
                    </div>
                    <div class="requsers-field">
                        <label>Role</label>
                        <select id="requsers-modal-role" ${isEdit && user.role === 'owner' ? 'disabled' : ''} onchange="RequestarrUsers.onRoleChange()">
                            <option value="user" ${(!isEdit || user.role === 'user') ? 'selected' : ''}>User</option>
                            ${isEdit && user.role === 'owner' ? '<option value="owner" selected>Owner</option>' : ''}
                        </select>
                    </div>
                    <div class="requsers-field">
                        <label>Permissions</label>
                        <div class="requsers-perms-grid" id="requsers-perms-grid">${permsHtml}</div>
                    </div>
                </div>
                <div class="requsers-modal-footer">
                    <button class="requsers-btn" style="background:var(--bg-tertiary);color:var(--text-secondary);" onclick="RequestarrUsers.closeModal()">Cancel</button>
                    <button class="requsers-btn requsers-btn-primary" id="requsers-modal-save" onclick="RequestarrUsers.saveUser(${isEdit ? user.id : 'null'})">${isEdit ? 'Save Changes' : 'Create User'}</button>
                </div>
            </div>
        </div>`;

        // Remove existing modal if any
        this.closeModal();
        document.body.insertAdjacentHTML('beforeend', html);
    },

    closeModal() {
        const overlay = document.getElementById('requsers-modal-overlay');
        if (overlay) overlay.remove();
        const plexOverlay = document.getElementById('requsers-plex-modal-overlay');
        if (plexOverlay) plexOverlay.remove();
    },

    async fillGeneratedPassword() {
        try {
            const resp = await fetch('./api/requestarr/users/generate-password');
            const data = await resp.json();
            const input = document.getElementById('requsers-modal-password');
            if (input && data.password) {
                input.type = 'text';
                input.value = data.password;
                // Copy to clipboard
                try { await navigator.clipboard.writeText(data.password); } catch (_) {}
                if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification('Password generated and copied to clipboard', 'success');
            }
        } catch (e) {
            console.error('[RequestarrUsers] Error generating password:', e);
        }
    },

    async onRoleChange() {
        // Load default permissions for the selected role
        try {
            const resp = await fetch('./api/requestarr/users/permissions-template');
            const templates = await resp.json();
            const role = document.getElementById('requsers-modal-role').value;
            const perms = templates[role] || {};
            const grid = document.getElementById('requsers-perms-grid');
            if (!grid) return;
            grid.querySelectorAll('input[type="checkbox"]').forEach(cb => {
                const key = cb.name.replace('perm_', '');
                cb.checked = !!perms[key];
            });
        } catch (_) {}
    },

    async saveUser(userId) {
        const username = (document.getElementById('requsers-modal-username').value || '').trim();
        const email = (document.getElementById('requsers-modal-email').value || '').trim();
        const password = document.getElementById('requsers-modal-password').value;
        const role = document.getElementById('requsers-modal-role').value;

        // Collect permissions
        const permissions = {};
        const grid = document.getElementById('requsers-perms-grid');
        if (grid) {
            grid.querySelectorAll('input[type="checkbox"]').forEach(cb => {
                const key = cb.name.replace('perm_', '');
                permissions[key] = cb.checked;
            });
        }

        if (!username || username.length < 3) {
            if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification('Username must be at least 3 characters', 'error');
            return;
        }

        const body = { username, email, role, permissions };
        if (password) body.password = password;

        const isEdit = userId !== null;
        if (!isEdit && (!password || password.length < 8)) {
            if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification('Password must be at least 8 characters', 'error');
            return;
        }

        const saveBtn = document.getElementById('requsers-modal-save');
        if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving...'; }

        try {
            const url = isEdit ? `./api/requestarr/users/${userId}` : './api/requestarr/users';
            const method = isEdit ? 'PUT' : 'POST';
            const resp = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const data = await resp.json();
            if (data.success) {
                this.closeModal();
                if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification(isEdit ? 'User updated' : 'User created', 'success');
                await this.loadUsers();
            } else {
                if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification(data.error || 'Failed to save user', 'error');
            }
        } catch (e) {
            console.error('[RequestarrUsers] Error saving user:', e);
            if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification('Failed to save user', 'error');
        } finally {
            if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = isEdit ? 'Save Changes' : 'Create User'; }
        }
    },

    confirmDelete(userId, username) {
        if (window.HuntarrConfirmModal && typeof window.HuntarrConfirmModal.show === 'function') {
            window.HuntarrConfirmModal.show({
                title: 'Delete User',
                message: `Are you sure you want to delete <strong>${this._esc(username)}</strong>? This cannot be undone.`,
                confirmText: 'Delete',
                confirmClass: 'danger',
                onConfirm: () => this.deleteUser(userId),
            });
        } else {
            if (confirm(`Delete user "${username}"? This cannot be undone.`)) {
                this.deleteUser(userId);
            }
        }
    },

    async deleteUser(userId) {
        try {
            const resp = await fetch(`./api/requestarr/users/${userId}`, { method: 'DELETE' });
            const data = await resp.json();
            if (data.success) {
                if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification('User deleted', 'success');
                await this.loadUsers();
            } else {
                if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification(data.error || 'Failed to delete user', 'error');
            }
        } catch (e) {
            console.error('[RequestarrUsers] Error deleting user:', e);
        }
    },

    // ── Plex Import ──────────────────────────────────────────

    async openPlexImportModal() {
        try {
            const resp = await fetch('./api/requestarr/users/plex/friends');
            const data = await resp.json();
            if (data.error) {
                if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification(data.error, 'error');
                return;
            }
            const friends = data.friends || [];
            if (!friends.length) {
                if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification('No Plex friends found', 'info');
                return;
            }

            const listHtml = friends.map(f => `
                <label class="requsers-plex-item">
                    <input type="checkbox" value="${f.id}" data-username="${this._esc(f.username)}">
                    ${f.thumb ? `<img class="requsers-plex-thumb" src="${f.thumb}" alt="">` : '<div class="requsers-avatar" style="width:32px;height:32px;font-size:0.7rem;">' + (f.username || '?').substring(0, 2).toUpperCase() + '</div>'}
                    <div class="requsers-user-info">
                        <span class="requsers-user-name">${this._esc(f.username)}</span>
                        ${f.email ? `<span class="requsers-user-email">${this._esc(f.email)}</span>` : ''}
                    </div>
                </label>
            `).join('');

            const html = `<div class="requsers-modal-overlay" id="requsers-plex-modal-overlay" onclick="if(event.target===this)RequestarrUsers.closeModal()">
                <div class="requsers-modal">
                    <div class="requsers-modal-header">
                        <h3 class="requsers-modal-title"><i class="fas fa-download" style="color:#e5a00d;margin-right:6px;"></i> Import Plex Users</h3>
                        <button class="requsers-modal-close" onclick="RequestarrUsers.closeModal()"><i class="fas fa-times"></i></button>
                    </div>
                    <div class="requsers-modal-body">
                        <p style="color:var(--text-muted);font-size:0.85rem;margin-bottom:12px;">Select friends to import as local users with the "User" role.</p>
                        <div class="requsers-plex-list">${listHtml}</div>
                    </div>
                    <div class="requsers-modal-footer">
                        <button class="requsers-btn" style="background:var(--bg-tertiary);color:var(--text-secondary);" onclick="RequestarrUsers.closeModal()">Cancel</button>
                        <button class="requsers-btn requsers-btn-plex" id="requsers-plex-import-btn" onclick="RequestarrUsers.doPlexImport()"><i class="fas fa-download"></i> Import Selected</button>
                    </div>
                </div>
            </div>`;

            this.closeModal();
            document.body.insertAdjacentHTML('beforeend', html);
        } catch (e) {
            console.error('[RequestarrUsers] Error opening Plex import:', e);
            if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification('Failed to load Plex friends', 'error');
        }
    },

    async doPlexImport() {
        const overlay = document.getElementById('requsers-plex-modal-overlay');
        if (!overlay) return;
        const checked = overlay.querySelectorAll('input[type="checkbox"]:checked');
        const friendIds = Array.from(checked).map(cb => parseInt(cb.value)).filter(v => !isNaN(v));
        if (!friendIds.length) {
            if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification('Select at least one friend to import', 'warning');
            return;
        }

        const btn = document.getElementById('requsers-plex-import-btn');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Importing...'; }

        try {
            const resp = await fetch('./api/requestarr/users/plex/import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ friend_ids: friendIds }),
            });
            const data = await resp.json();
            if (data.success) {
                const msg = `Imported ${data.imported.length} user${data.imported.length !== 1 ? 's' : ''}${data.skipped.length ? `, ${data.skipped.length} skipped` : ''}`;
                if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification(msg, 'success');
                this.closeModal();
                await this.loadUsers();
            } else {
                if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification(data.error || 'Import failed', 'error');
            }
        } catch (e) {
            console.error('[RequestarrUsers] Plex import error:', e);
            if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification('Import failed', 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-download"></i> Import Selected'; }
        }
    },

    _esc(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },
};
