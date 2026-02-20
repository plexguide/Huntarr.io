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
        disable_chat: 'Disable Chat',
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
        const isOwner = isEdit && user.role === 'owner';
        const perms = (user && typeof user.permissions === 'object') ? user.permissions : {};

        const permsHtml = Object.entries(this.permissionLabels).map(([key, label]) => {
            const checked = perms[key] ? 'checked' : '';
            const disabled = isOwner ? 'disabled' : '';
            // Hide disable_chat for owner — owner can never be chat-disabled
            if (key === 'disable_chat' && isOwner) return '';
            return `<label class="requsers-perm-item">
                <input type="checkbox" name="perm_${key}" ${checked} ${disabled}>
                <span>${label}</span>
            </label>`;
        }).join('');

        // Hide password field for owner
        const passwordFieldHtml = isOwner ? '' : `
                    <div class="requsers-field">
                        <label>${isEdit ? 'New Password (leave blank to keep)' : 'Password'}</label>
                        <input type="password" id="requsers-modal-password" placeholder="${isEdit ? '••••••••' : 'Min 8 characters'}" minlength="8" autocomplete="new-password">
                        <div class="requsers-field-hint"><a href="#" onclick="RequestarrUsers.fillGeneratedPassword();return false;">Generate random password</a></div>
                    </div>`;

        const html = `<div class="requsers-modal-overlay" id="requsers-modal-overlay" onclick="if(event.target===this)RequestarrUsers.closeModal()">
            <div class="requsers-modal">
                <div class="requsers-modal-header">
                    <h3 class="requsers-modal-title">${title}</h3>
                    <button class="requsers-modal-close" onclick="RequestarrUsers.closeModal()"><i class="fas fa-times"></i></button>
                </div>
                <div class="requsers-modal-body">
                    <div class="requsers-field">
                        <label>Username</label>
                        <input type="text" id="requsers-modal-username" value="${isEdit ? this._esc(user.username) : ''}" ${isOwner ? 'disabled' : ''} placeholder="Enter username" minlength="3">
                    </div>
                    <div class="requsers-field">
                        <label>Email (optional)</label>
                        <input type="email" id="requsers-modal-email" value="${isEdit ? this._esc(user.email || '') : ''}" placeholder="user@example.com">
                    </div>${passwordFieldHtml}
                    <div class="requsers-field">
                        <label>Role</label>
                        <select id="requsers-modal-role" ${isOwner ? 'disabled' : ''} onchange="RequestarrUsers.onRoleChange()">
                            <option value="user" ${(!isEdit || user.role === 'user') ? 'selected' : ''}>User</option>
                            ${isOwner ? '<option value="owner" selected>Owner</option>' : ''}
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
        const passwordEl = document.getElementById('requsers-modal-password');
        const password = passwordEl ? passwordEl.value : '';
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
                // No Plex linked — offer to link it right here via popup
                if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
                    window.HuntarrConfirm.show({
                        title: 'Plex Account Not Linked',
                        message: 'No Plex account is linked. Would you like to link your Plex account now? Once linked, you can import your Plex users.',
                        confirmLabel: 'Link Plex',
                        onConfirm: () => { this._startPlexLinkFromUsers(); }
                    });
                }
                return;
            }
            const allUsers = data.friends || [];
            // Split into importable and already-imported
            const importable = allUsers.filter(f => !f.already_imported);
            const alreadyImported = allUsers.filter(f => f.already_imported);

            if (!allUsers.length) {
                if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification('No Plex users found with server access', 'info');
                return;
            }

            const renderUserRow = (f, disabled) => {
                const initial = (f.username || '?').charAt(0).toUpperCase();
                const avatarHtml = f.thumb
                    ? `<img class="requsers-plex-thumb" src="${f.thumb}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><div class="requsers-plex-avatar-fallback" style="display:none;">${initial}</div>`
                    : `<div class="requsers-plex-avatar-fallback">${initial}</div>`;
                const disabledAttr = disabled ? 'disabled' : '';
                const dimClass = disabled ? 'requsers-plex-item-disabled' : '';
                return `<label class="requsers-plex-item ${dimClass}">
                    <input type="checkbox" value="${f.id}" data-username="${this._esc(f.username)}" ${disabledAttr}>
                    <div class="requsers-plex-avatar-wrap">${avatarHtml}</div>
                    <div class="requsers-user-info">
                        <span class="requsers-user-name">${this._esc(f.username)}</span>
                        ${f.email ? `<span class="requsers-user-email">${this._esc(f.email)}</span>` : ''}
                    </div>
                    ${disabled ? '<span class="requsers-plex-imported-badge">Imported</span>' : ''}
                </label>`;
            };

            const importableHtml = importable.map(f => renderUserRow(f, false)).join('');
            const alreadyHtml = alreadyImported.map(f => renderUserRow(f, true)).join('');
            const selectAllDisabled = importable.length === 0 ? 'disabled' : '';

            const html = `<div class="requsers-modal-overlay" id="requsers-plex-modal-overlay" onclick="if(event.target===this)RequestarrUsers.closeModal()">
                <div class="requsers-modal" style="max-width:500px;">
                    <div class="requsers-modal-header">
                        <h3 class="requsers-modal-title"><i class="fas fa-download" style="color:#e5a00d;margin-right:6px;"></i> Import Plex Users</h3>
                        <button class="requsers-modal-close" onclick="RequestarrUsers.closeModal()"><i class="fas fa-times"></i></button>
                    </div>
                    <div class="requsers-modal-body">
                        <p style="color:var(--text-muted);font-size:0.85rem;margin-bottom:12px;">Select Plex users with server access to import with the "User" role.</p>
                        <div class="requsers-plex-select-all">
                            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                                <input type="checkbox" id="requsers-plex-select-all-cb" ${selectAllDisabled} onchange="RequestarrUsers.toggleSelectAll(this.checked)">
                                <span style="font-weight:600;font-size:0.85rem;color:var(--text-secondary);">USER</span>
                            </label>
                            <span style="font-size:0.78rem;color:var(--text-muted);">${importable.length} available${alreadyImported.length ? `, ${alreadyImported.length} already imported` : ''}</span>
                        </div>
                        <div class="requsers-plex-list">${importableHtml}${alreadyHtml}</div>
                    </div>
                    <div class="requsers-modal-footer">
                        <button class="requsers-btn" style="background:var(--bg-tertiary);color:var(--text-secondary);" onclick="RequestarrUsers.closeModal()">Cancel</button>
                        <button class="requsers-btn requsers-btn-plex" id="requsers-plex-import-btn" onclick="RequestarrUsers.doPlexImport()"><i class="fas fa-download"></i> Import</button>
                    </div>
                </div>
            </div>`;

            this.closeModal();
            document.body.insertAdjacentHTML('beforeend', html);
            // Attach change listeners to individual checkboxes for select-all sync
            const plexOverlay = document.getElementById('requsers-plex-modal-overlay');
            if (plexOverlay) {
                plexOverlay.querySelectorAll('.requsers-plex-list input[type="checkbox"]:not(:disabled)').forEach(cb => {
                    cb.addEventListener('change', () => this._updateSelectAllState());
                });
            }
        } catch (e) {
            console.error('[RequestarrUsers] Error opening Plex import:', e);
            if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification('Failed to load Plex users', 'error');
        }
    },

    toggleSelectAll(checked) {
        const overlay = document.getElementById('requsers-plex-modal-overlay');
        if (!overlay) return;
        overlay.querySelectorAll('.requsers-plex-list input[type="checkbox"]:not(:disabled)').forEach(cb => {
            cb.checked = checked;
        });
    },

    _updateSelectAllState() {
        const overlay = document.getElementById('requsers-plex-modal-overlay');
        if (!overlay) return;
        const allCbs = overlay.querySelectorAll('.requsers-plex-list input[type="checkbox"]:not(:disabled)');
        const checkedCbs = overlay.querySelectorAll('.requsers-plex-list input[type="checkbox"]:not(:disabled):checked');
        const selectAllCb = document.getElementById('requsers-plex-select-all-cb');
        if (selectAllCb && allCbs.length > 0) {
            selectAllCb.checked = checkedCbs.length === allCbs.length;
            selectAllCb.indeterminate = checkedCbs.length > 0 && checkedCbs.length < allCbs.length;
        }
    },

    async doPlexImport() {
        const overlay = document.getElementById('requsers-plex-modal-overlay');
        if (!overlay) return;
        const checked = overlay.querySelectorAll('.requsers-plex-list input[type="checkbox"]:checked:not(:disabled)');
        const friendIds = Array.from(checked).map(cb => parseInt(cb.value)).filter(v => !isNaN(v));
        if (!friendIds.length) {
            if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification('Select at least one user to import', 'warning');
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

    /**
     * Start Plex account linking directly from the Users page via popup flow.
     * On success, automatically opens the Plex import modal.
     */
    _startPlexLinkFromUsers() {
        // Create a status overlay
        const overlay = document.createElement('div');
        overlay.id = 'requsers-plex-link-overlay';
        overlay.style.cssText = 'position:fixed;z-index:1000;left:0;top:0;width:100%;height:100%;background:rgba(0,0,0,0.7);backdrop-filter:blur(5px);display:flex;align-items:center;justify-content:center;';
        overlay.innerHTML = `
            <div style="background:linear-gradient(180deg,rgba(22,26,34,0.98),rgba(18,22,30,0.95));border-radius:15px;padding:30px;width:400px;max-width:90%;box-shadow:0 8px 30px rgba(0,0,0,0.5);border:1px solid rgba(90,109,137,0.15);color:#f8f9fa;text-align:center;">
                <div style="font-size:40px;color:#e69500;margin-bottom:10px;"><i class="fas fa-tv"></i></div>
                <h2 style="margin:0 0 15px;">Link Plex Account</h2>
                <div id="requsers-plex-link-status" class="plex-status waiting" style="margin:15px 0;padding:10px;border-radius:8px;background:rgba(255,193,7,0.2);border:1px solid rgba(255,193,7,0.3);color:#ffc107;">
                    <i class="fas fa-spinner fa-spin"></i> Preparing Plex authentication...
                </div>
                <button id="requsers-plex-link-cancel" class="action-button secondary-button" style="margin-top:10px;">Cancel</button>
            </div>`;
        document.body.appendChild(overlay);

        const statusEl = document.getElementById('requsers-plex-link-status');
        const cancelBtn = document.getElementById('requsers-plex-link-cancel');
        let plexPopup = null;
        let pollInterval = null;
        let pinId = null;

        const cleanup = () => {
            if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
            if (plexPopup && !plexPopup.closed) plexPopup.close();
            plexPopup = null;
            const el = document.getElementById('requsers-plex-link-overlay');
            if (el) el.remove();
        };

        cancelBtn.addEventListener('click', cleanup);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(); });

        // Request PIN with popup_mode
        fetch('./api/auth/plex/pin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_mode: true, popup_mode: true })
        })
        .then(r => r.json())
        .then(data => {
            if (!data.success) {
                statusEl.className = 'plex-status error';
                statusEl.innerHTML = '<i class="fas fa-exclamation-triangle"></i> ' + (data.error || 'Failed to create PIN');
                return;
            }
            pinId = data.pin_id;
            statusEl.innerHTML = '<i class="fas fa-external-link-alt"></i> A Plex window has opened. Please sign in there.';

            // Open popup
            const w = 600, h = 700;
            const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - w) / 2));
            const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - h) / 2));
            plexPopup = window.open(data.auth_url, 'PlexAuth', `width=${w},height=${h},left=${left},top=${top},toolbar=no,menubar=no,scrollbars=yes`);

            // Poll for claim
            pollInterval = setInterval(() => {
                fetch(`./api/auth/plex/check/${pinId}`)
                    .then(r => r.json())
                    .then(d => {
                        if (d.success && d.claimed) {
                            clearInterval(pollInterval); pollInterval = null;
                            if (plexPopup && !plexPopup.closed) plexPopup.close();
                            statusEl.className = 'plex-status success';
                            statusEl.innerHTML = '<i class="fas fa-check"></i> Plex authenticated! Linking account...';
                            // Link the account
                            fetch('./api/auth/plex/link', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                credentials: 'include',
                                body: JSON.stringify({ token: d.token, setup_mode: true })
                            })
                            .then(r => r.json())
                            .then(linkResult => {
                                if (linkResult.success) {
                                    statusEl.innerHTML = '<i class="fas fa-check-circle"></i> Plex linked! Loading friends...';
                                    setTimeout(() => {
                                        cleanup();
                                        this.openPlexImportModal();
                                    }, 1000);
                                } else {
                                    statusEl.className = 'plex-status error';
                                    statusEl.innerHTML = '<i class="fas fa-exclamation-triangle"></i> ' + (linkResult.error || 'Linking failed');
                                }
                            })
                            .catch(() => {
                                statusEl.className = 'plex-status error';
                                statusEl.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Network error linking account';
                            });
                        }
                    })
                    .catch(() => {});
            }, 2000);

            // 10 min timeout
            setTimeout(() => {
                if (pollInterval) {
                    cleanup();
                    if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification('Plex authentication timed out', 'error');
                }
            }, 600000);
        })
        .catch(() => {
            statusEl.className = 'plex-status error';
            statusEl.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Network error creating PIN';
        });
    },
};
