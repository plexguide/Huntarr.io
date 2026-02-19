/**
 * Requestarr Requests Management Module
 * Admin view for listing, approving, denying, and deleting media requests.
 */

window.RequestarrRequests = {
    requests: [],
    total: 0,

    async init() {
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

        if (!this.requests.length) {
            container.innerHTML = `<div class="reqrequests-empty">
                <i class="fas fa-inbox" style="font-size:2rem;color:var(--text-dim);margin-bottom:12px;"></i>
                <p style="color:var(--text-muted);">No requests found</p>
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
        const date = req.created_at ? new Date(req.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
        const respondedBy = req.responded_by ? `by ${this._esc(req.responded_by)}` : '';

        let actions = '';
        if (req.status === 'pending') {
            actions = `
                <button class="requsers-btn requsers-btn-primary requsers-btn-sm" onclick="RequestarrRequests.approveRequest(${req.id})"><i class="fas fa-check"></i> Approve</button>
                <button class="requsers-btn requsers-btn-danger requsers-btn-sm" onclick="RequestarrRequests.denyRequest(${req.id})"><i class="fas fa-times"></i> Deny</button>`;
        }
        actions += `<button class="requsers-btn requsers-btn-sm" style="background:var(--bg-tertiary);color:var(--text-secondary);" onclick="RequestarrRequests.deleteRequest(${req.id})" title="Delete"><i class="fas fa-trash"></i></button>`;

        return `<div class="reqrequests-card" data-request-id="${req.id}">
            <img class="reqrequests-poster" src="${posterUrl}" alt="" onerror="this.src='./static/images/blackout.jpg'">
            <div class="reqrequests-info">
                <div class="reqrequests-title">${this._esc(req.title)}${req.year ? ` <span class="reqrequests-year">(${req.year})</span>` : ''}</div>
                <div class="reqrequests-meta">
                    <span class="reqrequests-type"><i class="fas ${typeIcon}"></i> ${typeLabel}</span>
                    <span class="reqrequests-user"><i class="fas fa-user"></i> ${this._esc(req.username || 'Unknown')}</span>
                    <span class="reqrequests-date"><i class="fas fa-clock"></i> ${date}</span>
                </div>
                ${req.notes ? `<div class="reqrequests-notes"><i class="fas fa-comment"></i> ${this._esc(req.notes)}</div>` : ''}
            </div>
            <div class="reqrequests-right">
                <span class="reqrequests-status ${statusClass}">${statusLabel}${respondedBy ? ` ${respondedBy}` : ''}</span>
                <div class="reqrequests-actions">${actions}</div>
            </div>
        </div>`;
    },

    async approveRequest(requestId) {
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
            } else {
                if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification(data.error || 'Failed', 'error');
            }
        } catch (e) {
            console.error('[RequestarrRequests] Approve error:', e);
        }
    },

    async denyRequest(requestId) {
        const notes = prompt('Reason for denial (optional):') || '';
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
};
