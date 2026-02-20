/**
 * Requestarr Requests Management Module
 * Admin view for listing, approving, denying, blacklisting, and deleting media requests.
 * Also handles the Global Blacklist page.
 */

window.RequestarrRequests = {
    requests: [],
    total: 0,
    // Global blacklist state
    _glBlacklistItems: [],
    _glBlacklistSearch: '',
    _glBlacklistTypeFilter: '',
    _glBlacklistPage: 1,
    _glBlacklistPageSize: 20,
    _glBlacklistInitialized: false,

    async init() {
        // For non-owner users, hide the filter controls (read-only view)
        if (window._huntarrUserRole && window._huntarrUserRole !== 'owner') {
            var filters = document.querySelector('.reqrequests-filters');
            if (filters) filters.style.display = 'none';
        }
        await this.loadRequests();
    },

    async loadRequests() {
        const container = document.getElementById('reqrequests-content');
        if (!container) return;

        const statusFilter = document.getElementById('reqrequests-status-filter');
        const typeFilter = document.getElementById('reqrequests-type-filter');
        const status = statusFilter ? statusFilter.value : '';
        const mediaType = typeFilter ? typeFilter.value : '';

        try {
            const params = new URLSearchParams();
            if (status) params.set('status', status);
            if (mediaType) params.set('media_type', mediaType);
            params.set('limit', '100');

            const resp = await fetch(`./api/requestarr/requests?${params}`, { cache: 'no-store' });
            if (!resp.ok) throw new Error('Failed to load requests');
            const data = await resp.json();
            this.requests = data.requests || [];
            this.total = data.total || 0;
            this.render();
        } catch (e) {
            console.error('[RequestarrRequests] Error:', e);
            container.innerHTML = '<p style="color:var(--error-color);padding:20px;">Failed to load requests.</p>';
        }
    },

    render() {
        const container = document.getElementById('reqrequests-content');
        if (!container) return;

        const isOwner = window._huntarrUserRole === 'owner';
        const emptyMsg = isOwner ? 'No requests found' : 'You haven\'t made any requests yet';

        if (!this.requests.length) {
            container.innerHTML = `<div class="reqrequests-empty">
                <i class="fas fa-inbox" style="font-size:2rem;color:var(--text-dim);margin-bottom:12px;"></i>
                <p style="color:var(--text-muted);">${emptyMsg}</p>
            </div>`;
            return;
        }

        const cards = this.requests.map(r => this._renderCard(r)).join('');
        container.innerHTML = `
            <div class="reqrequests-list">${cards}</div>
            <div class="requsers-pagination">
                <span>Showing ${this.requests.length} of ${this.total} request${this.total !== 1 ? 's' : ''}</span>
            </div>`;
    },

    _renderCard(req) {
        const posterUrl = req.poster_path
            ? (req.poster_path.startsWith('http') ? req.poster_path : `https://image.tmdb.org/t/p/w92${req.poster_path}`)
            : './static/images/blackout.jpg';
        const typeIcon = req.media_type === 'tv' ? 'fa-tv' : 'fa-film';
        const typeLabel = req.media_type === 'tv' ? 'TV' : 'Movie';
        const statusClass = `reqrequests-status-${req.status || 'pending'}`;
        const statusLabel = (req.status || 'pending').charAt(0).toUpperCase() + (req.status || 'pending').slice(1);
        const date = req.requested_at ? new Date(req.requested_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
        const respondedBy = req.responded_by ? `by ${this._esc(req.responded_by)}` : '';

        // Build additional requesters line
        let requestersHtml = '';
        if (req.all_requesters && req.all_requesters.length > 1) {
            const others = req.all_requesters
                .filter(r => r.username !== req.username)
                .map(r => this._esc(r.username));
            if (others.length > 0) {
                const demandLabel = req.all_requesters.length >= 3 ? ' <span class="reqrequests-demand">High demand</span>' : '';
                requestersHtml = `<div class="reqrequests-also"><i class="fas fa-users"></i> ${req.all_requesters.length} users requested${demandLabel} &mdash; also: ${others.join(', ')}</div>`;
            }
        }

        let actions = '';
        const isOwner = window._huntarrUserRole === 'owner';
        if (req.status === 'pending' && isOwner) {
            actions = `
                <button class="reqrequests-action-btn reqrequests-action-approve" onclick="RequestarrRequests.approveRequest(${req.id}, this)"><i class="fas fa-check"></i> Approve</button>
                <button class="reqrequests-action-btn reqrequests-action-deny" onclick="RequestarrRequests.denyRequest(${req.id}, this)"><i class="fas fa-times"></i> Deny</button>
                <button class="reqrequests-action-btn reqrequests-action-blacklist" onclick="RequestarrRequests.blacklistRequest(${req.id})" title="Blacklist"><i class="fas fa-ban"></i> Blacklist</button>`;
        }
        if (req.status === 'pending' && !isOwner) {
            actions = `<button class="reqrequests-action-btn reqrequests-action-withdraw" onclick="RequestarrRequests.withdrawRequest(${req.id}, this)"><i class="fas fa-undo"></i> Withdraw</button>`;
        }

        return `<div class="reqrequests-card" data-request-id="${req.id}">
            <img class="reqrequests-poster" src="${posterUrl}" alt="" onerror="this.src='./static/images/blackout.jpg'">
            <div class="reqrequests-info">
                <div class="reqrequests-title">${this._esc(req.title)}${req.year ? ` <span class="reqrequests-year">(${req.year})</span>` : ''}</div>
                <div class="reqrequests-meta">
                    <span class="reqrequests-type"><i class="fas ${typeIcon}"></i> ${typeLabel}</span>
                    <span class="reqrequests-user"><i class="fas fa-user"></i> ${this._esc(req.username || 'Unknown')}</span>
                    <span class="reqrequests-date"><i class="fas fa-clock"></i> ${date}</span>
                </div>
                ${requestersHtml}
                ${req.notes ? `<div class="reqrequests-notes"><i class="fas fa-comment"></i> ${this._esc(req.notes)}</div>` : ''}
            </div>
            <div class="reqrequests-right">
                <span class="reqrequests-status ${statusClass}">${statusLabel}${respondedBy ? ` ${respondedBy}` : ''}</span>
                <div class="reqrequests-actions">${actions}</div>
            </div>
        </div>`;
    },

    async approveRequest(requestId, btn) {
        // Instant feedback
        const card = document.querySelector(`.reqrequests-card[data-request-id="${requestId}"]`);
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Approving...'; }
        if (card) card.classList.add('reqrequests-card-processing');
        // Disable sibling buttons
        if (card) card.querySelectorAll('.reqrequests-action-btn').forEach(b => { if (b !== btn) b.disabled = true; });
        try {
            const resp = await fetch(`./api/requestarr/requests/${requestId}/approve`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });
            const data = await resp.json();
            if (data.success) {
                if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification('Request approved', 'success');
                await this.loadRequests();
                this._refreshBadge();
                // Sync card badges on discover/search pages — item is now in library
                const req = data.request;
                if (req && req.tmdb_id) {
                    const tmdbId = String(req.tmdb_id);
                    document.querySelectorAll(`.media-card[data-tmdb-id="${tmdbId}"]`).forEach(card => {
                        const badge = card.querySelector('.media-card-status-badge');
                        if (badge) {
                            badge.className = 'media-card-status-badge partial';
                            badge.innerHTML = '<i class="fas fa-bookmark"></i>';
                        }
                        card.classList.add('in-library');
                        // Swap hide → delete button
                        const hideBtn = card.querySelector('.media-card-hide-btn');
                        if (hideBtn) {
                            hideBtn.className = 'media-card-delete-btn';
                            hideBtn.title = 'Remove / Delete';
                            hideBtn.innerHTML = '<i class="fas fa-trash-alt"></i>';
                        }
                        const requestBtn = card.querySelector('.media-card-request-btn');
                        if (requestBtn) requestBtn.remove();
                    });
                }
            } else {
                if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification(data.error || 'Failed', 'error');
            }
        } catch (e) {
            console.error('[RequestarrRequests] Approve error:', e);
        }
    },

    async denyRequest(requestId, btn) {
        const notes = prompt('Reason for denial (optional):') || '';
        // Instant feedback
        const card = document.querySelector(`.reqrequests-card[data-request-id="${requestId}"]`);
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Denying...'; }
        if (card) card.classList.add('reqrequests-card-processing');
        if (card) card.querySelectorAll('.reqrequests-action-btn').forEach(b => { if (b !== btn) b.disabled = true; });
        try {
            const resp = await fetch(`./api/requestarr/requests/${requestId}/deny`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ notes })
            });
            const data = await resp.json();
            if (data.success) {
                if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification('Request denied', 'success');
                await this.loadRequests();
                this._refreshBadge();
            } else {
                if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification(data.error || 'Failed', 'error');
            }
        } catch (e) {
            console.error('[RequestarrRequests] Deny error:', e);
        }
    },

    async blacklistRequest(requestId) {
        const doBlacklist = async () => {
            try {
                const resp = await fetch(`./api/requestarr/requests/${requestId}/blacklist`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({})
                });
                const data = await resp.json();
                if (data.success) {
                    if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification('Request blacklisted — added to Global Blacklist', 'success');
                    await this.loadRequests();
                    this._refreshBadge();
                } else {
                    if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification(data.error || 'Failed', 'error');
                }
            } catch (e) {
                console.error('[RequestarrRequests] Blacklist error:', e);
            }
        };

        if (window.HuntarrConfirmModal && typeof window.HuntarrConfirmModal.show === 'function') {
            window.HuntarrConfirmModal.show({
                title: 'Blacklist Request',
                message: 'This will deny the request and add the media to the Global Blacklist. No user will be able to request it again.',
                confirmText: 'Blacklist',
                confirmClass: 'danger',
                onConfirm: () => doBlacklist(),
            });
        } else if (window.HuntarrConfirm && typeof window.HuntarrConfirm.show === 'function') {
            window.HuntarrConfirm.show({
                title: 'Blacklist Request',
                message: 'This will deny the request and add the media to the Global Blacklist.<br>No user will be able to request it again.',
                confirmLabel: 'Blacklist',
                onConfirm: () => doBlacklist(),
            });
        } else {
            if (confirm('Blacklist this request? No user will be able to request it again.')) await doBlacklist();
        }
    },

    async withdrawRequest(requestId, btn) {
        const card = document.querySelector(`.reqrequests-card[data-request-id="${requestId}"]`);
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Withdrawing...'; }
        if (card) card.classList.add('reqrequests-card-processing');
        try {
            const resp = await fetch(`./api/requestarr/requests/${requestId}/withdraw`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });
            const data = await resp.json();
            if (data.success) {
                if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification('Request withdrawn', 'success');
                await this.loadRequests();
                this._refreshBadge();
            } else {
                if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification(data.error || 'Failed', 'error');
            }
        } catch (e) {
            console.error('[RequestarrRequests] Withdraw error:', e);
        }
    },

    async deleteRequest(requestId) {
        if (window.HuntarrConfirmModal && typeof window.HuntarrConfirmModal.show === 'function') {
            window.HuntarrConfirmModal.show({
                title: 'Delete Request',
                message: 'Are you sure you want to delete this request?',
                confirmText: 'Delete',
                confirmClass: 'danger',
                onConfirm: () => this._doDelete(requestId),
            });
        } else {
            if (confirm('Delete this request?')) await this._doDelete(requestId);
        }
    },

    async _doDelete(requestId) {
        try {
            const resp = await fetch(`./api/requestarr/requests/${requestId}`, { method: 'DELETE' });
            const data = await resp.json();
            if (data.success) {
                if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification('Request deleted', 'success');
                await this.loadRequests();
                this._refreshBadge();
            } else {
                if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification(data.error || 'Failed', 'error');
            }
        } catch (e) {
            console.error('[RequestarrRequests] Delete error:', e);
        }
    },

    _refreshBadge() {
        if (window.huntarrUI && typeof window.huntarrUI._updatePendingRequestBadge === 'function') {
            window.huntarrUI._updatePendingRequestBadge();
        }
    },

    _esc(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },

    // ========================================
    // GLOBAL BLACKLIST PAGE
    // ========================================

    async initGlobalBlacklist() {
        if (!this._glBlacklistInitialized) {
            this._setupGlobalBlacklistControls();
            this._glBlacklistInitialized = true;
        }
        await this._loadGlobalBlacklist();
    },

    _setupGlobalBlacklistControls() {
        const searchInput = document.getElementById('global-blacklist-search');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                clearTimeout(this._glSearchTimeout);
                this._glSearchTimeout = setTimeout(() => {
                    this._glBlacklistSearch = (e.target.value || '').trim();
                    this._glBlacklistPage = 1;
                    this._renderGlobalBlacklistPage();
                }, 200);
            });
        }
        const typeFilter = document.getElementById('global-blacklist-type-filter');
        if (typeFilter) {
            typeFilter.addEventListener('change', () => {
                this._glBlacklistTypeFilter = typeFilter.value || '';
                this._glBlacklistPage = 1;
                this._glBlacklistFetchKey = null;
                this._loadGlobalBlacklist();
            });
        }
    },

    async _loadGlobalBlacklist() {
        const container = document.getElementById('global-blacklist-grid');
        if (!container) return;

        container.style.display = 'grid';
        container.style.alignItems = '';
        container.style.justifyContent = '';
        container.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Loading global blacklist...</p></div>';

        try {
            const params = new URLSearchParams();
            if (this._glBlacklistTypeFilter) params.set('media_type', this._glBlacklistTypeFilter);
            params.set('page', '1');
            params.set('page_size', '500');

            const resp = await fetch(`./api/requestarr/requests/global-blacklist?${params}`, { cache: 'no-store' });
            if (!resp.ok) throw new Error('Failed to load global blacklist');
            const data = await resp.json();
            this._glBlacklistItems = data.items || [];
            this._renderGlobalBlacklistPage();
        } catch (e) {
            console.error('[RequestarrRequests] Global blacklist error:', e);
            container.innerHTML = '<p style="color:var(--error-color);padding:20px;">Failed to load global blacklist.</p>';
        }
    },

    _getFilteredBlacklistItems() {
        const query = (this._glBlacklistSearch || '').toLowerCase();
        let items = this._glBlacklistItems.slice();
        if (query) {
            items = items.filter(i => (i.title || '').toLowerCase().includes(query));
        }
        items.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
        return items;
    },

    _renderGlobalBlacklistPage() {
        const container = document.getElementById('global-blacklist-grid');
        const paginationContainer = document.getElementById('global-blacklist-pagination');
        if (!container || !paginationContainer) return;

        const filtered = this._getFilteredBlacklistItems();
        const pageSize = this._glBlacklistPageSize;
        const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));

        if (this._glBlacklistPage > totalPages) this._glBlacklistPage = 1;

        const startIndex = (this._glBlacklistPage - 1) * pageSize;
        const pageItems = filtered.slice(startIndex, startIndex + pageSize);

        if (pageItems.length > 0) {
            container.style.display = 'grid';
            container.style.alignItems = '';
            container.style.justifyContent = '';
            container.innerHTML = '';
            pageItems.forEach(item => {
                container.appendChild(this._createBlacklistCard(item));
            });

            if (totalPages > 1) {
                paginationContainer.style.display = 'flex';
                document.getElementById('global-blacklist-page-info').textContent = `Page ${this._glBlacklistPage} of ${totalPages}`;
                document.getElementById('global-blacklist-prev-page').disabled = this._glBlacklistPage === 1;
                document.getElementById('global-blacklist-next-page').disabled = this._glBlacklistPage === totalPages;
            } else {
                paginationContainer.style.display = 'none';
            }
        } else {
            container.style.display = 'flex';
            container.style.alignItems = 'center';
            container.style.justifyContent = 'center';
            container.innerHTML = `
                <div style="text-align: center; color: #9ca3af; max-width: 600px;">
                    <i class="fas fa-ban" style="font-size: 64px; margin-bottom: 30px; opacity: 0.4; display: block;"></i>
                    <p style="font-size: 20px; margin-bottom: 15px; font-weight: 500; white-space: nowrap;">No Blacklisted Media</p>
                    <p style="font-size: 15px; line-height: 1.6; opacity: 0.8;">The global blacklist is empty. Blacklisted items cannot be requested by any user.</p>
                </div>
            `;
            paginationContainer.style.display = 'none';
        }

        this._setupGlobalBlacklistPagination(totalPages);
    },

    _setupGlobalBlacklistPagination(totalPages) {
        const prevBtn = document.getElementById('global-blacklist-prev-page');
        const nextBtn = document.getElementById('global-blacklist-next-page');
        if (!prevBtn || !nextBtn) return;

        prevBtn.onclick = () => {
            if (this._glBlacklistPage > 1) {
                this._glBlacklistPage -= 1;
                this._renderGlobalBlacklistPage();
            }
        };
        nextBtn.onclick = () => {
            if (this._glBlacklistPage < totalPages) {
                this._glBlacklistPage += 1;
                this._renderGlobalBlacklistPage();
            }
        };
    },

    _createBlacklistCard(item) {
        const card = document.createElement('div');
        card.className = 'media-card';
        card.setAttribute('data-tmdb-id', item.tmdb_id);
        card.setAttribute('data-media-type', item.media_type);

        const posterUrl = item.poster_path
            ? (item.poster_path.startsWith('http') ? item.poster_path : `https://image.tmdb.org/t/p/w185${item.poster_path}`)
            : './static/images/blackout.jpg';
        const typeBadgeLabel = item.media_type === 'tv' ? 'TV' : 'Movie';

        card.innerHTML = `
            <div class="media-card-poster">
                <button class="media-card-unhide-btn" title="Remove from Global Blacklist"><i class="fas fa-undo-alt"></i></button>
                <img src="${posterUrl}" alt="${this._esc(item.title)}" onerror="this.src='./static/images/blackout.jpg'">
                <span class="media-type-badge">${typeBadgeLabel}</span>
            </div>
        `;

        // Cache image in background
        if (posterUrl && !posterUrl.includes('./static/images/') && window.getCachedTMDBImage && window.tmdbImageCache) {
            const imgEl = card.querySelector('.media-card-poster img');
            if (imgEl) {
                window.getCachedTMDBImage(posterUrl, window.tmdbImageCache).then(cachedUrl => {
                    if (cachedUrl && cachedUrl !== posterUrl) imgEl.src = cachedUrl;
                }).catch(() => {});
            }
        }

        const removeBtn = card.querySelector('.media-card-unhide-btn');
        if (removeBtn) {
            removeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this._removeFromGlobalBlacklist(item.tmdb_id, item.media_type, item.title);
            });
        }

        return card;
    },

    async _removeFromGlobalBlacklist(tmdbId, mediaType, title) {
        const self = this;
        const doRemove = async () => {
            try {
                const resp = await fetch(`./api/requestarr/requests/global-blacklist/${tmdbId}/${mediaType}`, { method: 'DELETE' });
                const data = await resp.json();
                if (data.success) {
                    self._glBlacklistItems = self._glBlacklistItems.filter(i => !(i.tmdb_id === tmdbId && i.media_type === mediaType));
                    self._renderGlobalBlacklistPage();
                    if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification('Removed from Global Blacklist', 'success');
                } else {
                    if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification(data.error || 'Failed', 'error');
                }
            } catch (e) {
                console.error('[RequestarrRequests] Remove blacklist error:', e);
            }
        };

        if (window.HuntarrConfirm && typeof window.HuntarrConfirm.show === 'function') {
            window.HuntarrConfirm.show({
                title: 'Remove from Global Blacklist',
                message: `Remove "${this._esc(title)}" from the Global Blacklist?<br><br>Users will be able to request this media again.`,
                confirmLabel: 'Remove',
                onConfirm: () => doRemove(),
            });
        } else {
            if (confirm(`Remove "${title}" from the Global Blacklist?`)) await doRemove();
        }
    },
};
