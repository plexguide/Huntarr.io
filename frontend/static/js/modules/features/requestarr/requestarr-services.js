/**
 * Requestarr Services Module
 * Manages which instances are available for media requests.
 * Movies = Radarr + Movie Hunt instances
 * TV = Sonarr + TV Hunt instances
 *
 * Uses the same instance-card design system as Media Hunt Instances.
 */

window.RequestarrServices = {
    services: [],
    available: { movies: [], tv: [] },

    async init() {
        await Promise.all([this.loadServices(), this.loadAvailable()]);
        this.render();
    },

    async loadServices() {
        try {
            const resp = await fetch('./api/requestarr/services', { cache: 'no-store' });
            if (!resp.ok) throw new Error('Failed');
            const data = await resp.json();
            this.services = data.services || [];
        } catch (e) {
            console.error('[RequestarrServices] Error loading services:', e);
        }
    },

    async loadAvailable() {
        try {
            const resp = await fetch('./api/requestarr/services/available', { cache: 'no-store' });
            if (!resp.ok) throw new Error('Failed');
            this.available = await resp.json();
        } catch (e) {
            console.error('[RequestarrServices] Error loading available:', e);
        }
    },

    render() {
        const container = document.getElementById('reqservices-content');
        if (!container) return;

        const movieServices = this.services.filter(s => s.service_type === 'movies');
        const tvServices = this.services.filter(s => s.service_type === 'tv');

        container.innerHTML =
            this._renderSection('Movies', 'movies', movieServices, 'fa-film') +
            this._renderSection('TV', 'tv', tvServices, 'fa-tv');

        // Wire up click handlers on the grids
        this._wireGrid('reqservices-movies-grid', 'movies');
        this._wireGrid('reqservices-tv-grid', 'tv');
    },

    _renderSection(title, type, services, iconClass) {
        const iconColor = type === 'movies' ? '#eab308' : '#818cf8';
        const gridId = `reqservices-${type}-grid`;
        const addLabel = `Add ${title} Server`;

        // Sort: default first (moves to the left)
        services.sort((a, b) => (b.is_default ? 1 : 0) - (a.is_default ? 1 : 0));

        let cardsHtml = '';
        services.forEach(s => { cardsHtml += this._renderCard(s, type); });
        // Add-instance card (dashed)
        cardsHtml += `<div class="add-instance-card" data-action="add" data-type="${type}">` +
            `<div class="add-icon"><i class="fas fa-plus-circle"></i></div>` +
            `<div class="add-text">${addLabel}</div></div>`;

        return `<div class="settings-group instances-settings-group reqservices-group">
            <div class="profiles-header">
                <div>
                    <h3><i class="fas ${iconClass}" style="color:${iconColor};margin-right:8px;"></i>${title}</h3>
                    <p class="profiles-help">Configure your ${title.toLowerCase()} servers below. You can connect multiple servers and mark defaults.</p>
                </div>
            </div>
            <div class="instance-card-grid instances-card-grid" id="${gridId}">${cardsHtml}</div>
        </div>`;
    },

    _renderCard(service, type) {
        const appLabel = {
            radarr: 'Radarr', sonarr: 'Sonarr',
            movie_hunt: 'Movie Hunt', tv_hunt: 'TV Hunt'
        }[service.app_type] || service.app_type;

        const iconClass = type === 'movies' ? 'fa-film' : 'fa-tv';
        const isDefault = !!service.is_default;
        const is4k = !!service.is_4k;
        const statusClass = 'status-connected';
        const statusIcon = 'fa-check-circle';

        const defaultBadge = isDefault ? ' <span class="default-badge">Default</span>' : '';
        const fourKBadge = is4k ? ' <span class="reqservices-badge-4k-inline">4K</span>' : '';

        // Default button only shown on non-default cards (like Media Hunt Instances)
        const defaultBtn = isDefault ? '' : `<button type="button" class="btn-card set-default" data-id="${service.id}"><i class="fas fa-star"></i> Default</button>`;
        const fourKBtn = is4k
            ? `<button type="button" class="btn-card reqsvc-un4k" data-id="${service.id}" title="Remove 4K flag"><span style="font-weight:700;color:#eab308;">4K</span></button>`
            : `<button type="button" class="btn-card reqsvc-set4k" data-id="${service.id}" title="Mark as 4K"><span style="font-weight:700;color:var(--text-dim);">4K</span></button>`;
        const deleteBtn = `<button type="button" class="btn-card delete" data-id="${service.id}"><i class="fas fa-trash"></i> Delete</button>`;

        return `<div class="instance-card${isDefault ? ' default-instance' : ''}" data-service-id="${service.id}">
            <div class="instance-card-header">
                <span class="instance-name"><i class="fas ${iconClass}" style="margin-right:8px;"></i>${this._esc(service.instance_name)}${defaultBadge}${fourKBadge}</span>
                <div class="instance-status-icon ${statusClass}"><i class="fas ${statusIcon}"></i></div>
            </div>
            <div class="instance-card-body">
                <div class="instance-detail"><i class="fas fa-server"></i><span>${appLabel}</span></div>
            </div>
            <div class="instance-card-footer">${defaultBtn}${fourKBtn}${deleteBtn}</div>
        </div>`;
    },

    _wireGrid(gridId, type) {
        const grid = document.getElementById(gridId);
        if (!grid) return;
        grid.addEventListener('click', (e) => {
            const addCard = e.target.closest('.add-instance-card[data-action="add"]');
            if (addCard) { e.preventDefault(); this.openAddModal(type); return; }

            const defaultBtn = e.target.closest('.btn-card.set-default');
            if (defaultBtn) { e.stopPropagation(); this.toggleDefault(parseInt(defaultBtn.dataset.id), true); return; }

            const set4kBtn = e.target.closest('.btn-card.reqsvc-set4k');
            if (set4kBtn) { e.stopPropagation(); this.toggle4K(parseInt(set4kBtn.dataset.id), true); return; }

            const un4kBtn = e.target.closest('.btn-card.reqsvc-un4k');
            if (un4kBtn) { e.stopPropagation(); this.toggle4K(parseInt(un4kBtn.dataset.id), false); return; }

            const deleteBtn = e.target.closest('.btn-card.delete');
            if (deleteBtn) { e.stopPropagation(); this.removeService(parseInt(deleteBtn.dataset.id)); return; }
        });
    },

    openAddModal(serviceType) {
        const available = (serviceType === 'movies') ? (this.available.movies || []) : (this.available.tv || []);
        const existing = new Set(this.services.filter(s => s.service_type === serviceType).map(s => `${s.app_type}:${s.instance_name}`));
        const filtered = available.filter(a => !existing.has(`${a.app_type}:${a.instance_name}`));

        if (!filtered.length) {
            if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification(
                available.length ? 'All available instances are already added' : 'No instances configured. Set up instances in Media Hunt or 3rd Party Apps first.',
                'info'
            );
            return;
        }

        const optionsHtml = filtered.map(a =>
            `<option value="${a.app_type}:${this._esc(a.instance_name)}:${a.instance_id || ''}">${this._esc(a.label)}</option>`
        ).join('');

        const title = serviceType === 'movies' ? 'Add Movies Server' : 'Add TV Server';
        const html = `<div class="requsers-modal-overlay" id="requsers-modal-overlay" onclick="if(event.target===this)RequestarrServices.closeModal()">
            <div class="requsers-modal" style="max-width:420px;">
                <div class="requsers-modal-header">
                    <h3 class="requsers-modal-title">${title}</h3>
                    <button class="requsers-modal-close" onclick="RequestarrServices.closeModal()"><i class="fas fa-times"></i></button>
                </div>
                <div class="requsers-modal-body">
                    <div class="requsers-field">
                        <label>Instance</label>
                        <select id="reqservices-add-select">${optionsHtml}</select>
                    </div>
                    <div class="requsers-field" style="display:flex;gap:16px;">
                        <label class="requsers-perm-item" style="flex:1;">
                            <input type="checkbox" id="reqservices-add-default">
                            <span>Default</span>
                        </label>
                        <label class="requsers-perm-item" style="flex:1;">
                            <input type="checkbox" id="reqservices-add-4k">
                            <span>4K Server</span>
                        </label>
                    </div>
                </div>
                <div class="requsers-modal-footer">
                    <button class="requsers-btn" style="background:var(--bg-tertiary);color:var(--text-secondary);" onclick="RequestarrServices.closeModal()">Cancel</button>
                    <button class="requsers-btn requsers-btn-primary" onclick="RequestarrServices.doAdd('${serviceType}')"><i class="fas fa-plus"></i> Add Server</button>
                </div>
            </div>
        </div>`;

        this.closeModal();
        document.body.insertAdjacentHTML('beforeend', html);
    },

    closeModal() {
        const overlay = document.getElementById('requsers-modal-overlay');
        if (overlay) overlay.remove();
    },

    async doAdd(serviceType) {
        const select = document.getElementById('reqservices-add-select');
        if (!select) return;
        const val = select.value;
        const parts = val.split(':');
        const appType = parts[0];
        const instanceName = parts.slice(1, -1).join(':');
        const instanceId = parts[parts.length - 1] ? parseInt(parts[parts.length - 1]) : null;
        const isDefault = document.getElementById('reqservices-add-default').checked;
        const is4k = document.getElementById('reqservices-add-4k').checked;

        try {
            const resp = await fetch('./api/requestarr/services', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    service_type: serviceType,
                    app_type: appType,
                    instance_name: instanceName,
                    instance_id: instanceId,
                    is_default: isDefault,
                    is_4k: is4k,
                }),
            });
            const data = await resp.json();
            if (data.success) {
                this.closeModal();
                if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification('Server added', 'success');
                await this.loadServices();
                this.render();
            } else {
                if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification(data.error || 'Failed to add server', 'error');
            }
        } catch (e) {
            console.error('[RequestarrServices] Error adding service:', e);
        }
    },

    async toggleDefault(serviceId, value) {
        await this._updateService(serviceId, { is_default: value ? 1 : 0 });
    },

    async toggle4K(serviceId, value) {
        await this._updateService(serviceId, { is_4k: value ? 1 : 0 });
    },

    async _updateService(serviceId, updates) {
        try {
            const resp = await fetch(`./api/requestarr/services/${serviceId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates),
            });
            const data = await resp.json();
            if (data.success) {
                await this.loadServices();
                this.render();
            }
        } catch (e) {
            console.error('[RequestarrServices] Error updating service:', e);
        }
    },

    async removeService(serviceId) {
        if (window.HuntarrConfirmModal && typeof window.HuntarrConfirmModal.show === 'function') {
            window.HuntarrConfirmModal.show({
                title: 'Remove Server',
                message: 'Remove this server from Requests? The instance itself will not be deleted.',
                confirmText: 'Remove',
                confirmClass: 'danger',
                onConfirm: () => this._doRemove(serviceId),
            });
        } else {
            if (confirm('Remove this server from Requests?')) {
                await this._doRemove(serviceId);
            }
        }
    },

    async _doRemove(serviceId) {
        try {
            const resp = await fetch(`./api/requestarr/services/${serviceId}`, { method: 'DELETE' });
            const data = await resp.json();
            if (data.success) {
                if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification('Server removed', 'success');
                await this.loadServices();
                this.render();
            }
        } catch (e) {
            console.error('[RequestarrServices] Error removing service:', e);
        }
    },

    _esc(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },
};
