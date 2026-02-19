/**
 * Requestarr Services Module
 * Manages which instances are available for media requests.
 * Movies = Radarr + Movie Hunt instances
 * TV = Sonarr + TV Hunt instances
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

        container.innerHTML = `
            ${this._renderSection('Movies', 'movies', movieServices, 'fas fa-film')}
            ${this._renderSection('TV', 'tv', tvServices, 'fas fa-tv')}
        `;
    },

    _renderSection(title, type, services, icon) {
        const cardsHtml = services.length ? services.map(s => this._renderCard(s, type)).join('') :
            `<div class="reqservices-empty">
                <i class="${icon}"></i>
                <p>No ${title.toLowerCase()} services configured</p>
                <p style="font-size:0.8rem;">Add an instance to enable ${title.toLowerCase()} requests</p>
            </div>`;

        return `<div class="reqservices-section">
            <div class="reqservices-section-header">
                <h3 class="reqservices-section-title"><i class="${icon}" style="color:${type === 'movies' ? '#eab308' : '#818cf8'};"></i> ${title}</h3>
                <button class="requsers-btn requsers-btn-primary requsers-btn-sm" onclick="RequestarrServices.openAddModal('${type}')"><i class="fas fa-plus"></i> Add ${title} Server</button>
            </div>
            <p class="reqservices-section-desc">Configure your ${title.toLowerCase()} server${services.length !== 1 ? 's' : ''} below. You can connect multiple servers and mark defaults.</p>
            ${cardsHtml}
        </div>`;
    },

    _renderCard(service, type) {
        const appLabel = {
            radarr: 'Radarr', sonarr: 'Sonarr',
            movie_hunt: 'Movie Hunt', tv_hunt: 'TV Hunt'
        }[service.app_type] || service.app_type;

        const badges = [];
        if (service.is_default) badges.push('<span class="reqservices-badge reqservices-badge-default">Default</span>');
        if (service.is_4k) badges.push('<span class="reqservices-badge reqservices-badge-4k">4K</span>');

        return `<div class="reqservices-card" data-service-id="${service.id}">
            <div class="reqservices-card-left">
                <div class="reqservices-card-icon ${type}"><i class="fas ${type === 'movies' ? 'fa-film' : 'fa-tv'}"></i></div>
                <div class="reqservices-card-info">
                    <span class="reqservices-card-name">${this._esc(service.instance_name)}</span>
                    <span class="reqservices-card-type">${appLabel}</span>
                </div>
                <div class="reqservices-card-badges">${badges.join('')}</div>
            </div>
            <div class="reqservices-card-actions">
                <button class="requsers-btn requsers-btn-sm" style="background:var(--bg-tertiary);color:var(--text-secondary);" onclick="RequestarrServices.toggleDefault(${service.id}, ${!service.is_default})" title="${service.is_default ? 'Remove default' : 'Set as default'}">
                    <i class="fas fa-star" style="color:${service.is_default ? '#22c55e' : 'var(--text-dim)'};"></i>
                </button>
                <button class="requsers-btn requsers-btn-sm" style="background:var(--bg-tertiary);color:var(--text-secondary);" onclick="RequestarrServices.toggle4K(${service.id}, ${!service.is_4k})" title="${service.is_4k ? 'Remove 4K flag' : 'Mark as 4K'}">
                    <span style="font-weight:700;font-size:0.75rem;color:${service.is_4k ? '#eab308' : 'var(--text-dim)'};">4K</span>
                </button>
                <button class="requsers-btn requsers-btn-danger requsers-btn-sm" onclick="RequestarrServices.removeService(${service.id})" title="Remove"><i class="fas fa-trash"></i></button>
            </div>
        </div>`;
    },

    openAddModal(serviceType) {
        const available = (serviceType === 'movies') ? (this.available.movies || []) : (this.available.tv || []);
        // Filter out already-added instances
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
