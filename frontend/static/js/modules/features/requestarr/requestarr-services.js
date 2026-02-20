/**
 * Requestarr Services Module
 * Manages which instances are available for media requests.
 * Movies = Radarr + Movie Hunt instances
 * TV = Sonarr + TV Hunt instances
 * Bundles = Groups of same-type services for cascading requests.
 *
 * Layout: Bundles on top, then Movies instances, then TV instances.
 */

window.RequestarrServices = {
    services: [],
    bundles: [],
    available: { movies: [], tv: [] },

    async init() {
        await Promise.all([this.loadServices(), this.loadAvailable(), this.loadBundles()]);
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

    async loadBundles() {
        try {
            const resp = await fetch('./api/requestarr/bundles', { cache: 'no-store' });
            if (!resp.ok) throw new Error('Failed');
            const data = await resp.json();
            this.bundles = data.bundles || [];
        } catch (e) {
            console.error('[RequestarrServices] Error loading bundles:', e);
        }
    },

    render() {
        const container = document.getElementById('reqservices-content');
        if (!container) return;

        const movieServices = this.services.filter(s => s.service_type === 'movies');
        const tvServices = this.services.filter(s => s.service_type === 'tv');

        container.innerHTML =
            this._renderBundlesSection() +
            this._renderSection('Movies', 'movies', movieServices, 'fa-film') +
            this._renderSection('TV', 'tv', tvServices, 'fa-tv');

        this._wireBundles();
        this._wireGrid('reqservices-movies-grid', 'movies');
        this._wireGrid('reqservices-tv-grid', 'tv');
    },

    _renderSection(title, type, services, iconClass) {
        const iconColor = type === 'movies' ? '#eab308' : '#818cf8';
        const gridId = `reqservices-${type}-grid`;
        const addLabel = `Add ${title} Instance`;

        let cardsHtml = '';
        services.forEach(s => { cardsHtml += this._renderCard(s, type); });
        cardsHtml += `<div class="add-instance-card" data-action="add" data-type="${type}">` +
            `<div class="add-icon"><i class="fas fa-plus-circle"></i></div>` +
            `<div class="add-text">${addLabel}</div></div>`;

        return `<div class="settings-group instances-settings-group reqservices-group">
            <div class="profiles-header">
                <div>
                    <h3><i class="fas ${iconClass}" style="color:${iconColor};margin-right:8px;"></i>${title} Instances</h3>
                    <p class="profiles-help">Add or remove ${title.toLowerCase()} instances. Group them into bundles above to use in Requests.</p>
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

        // Check if this service is used in any bundle
        const inBundles = this.bundles.filter(b =>
            b.primary_service_id === service.id ||
            (b.member_service_ids || []).includes(service.id)
        );
        const bundleBadge = inBundles.length > 0
            ? ` <span style="font-size:10px;background:rgba(16,185,129,0.15);color:#10b981;padding:2px 6px;border-radius:4px;margin-left:6px;">${inBundles.map(b => b.name).join(', ')}</span>`
            : '';

        return `<div class="instance-card" data-service-id="${service.id}">
            <div class="instance-card-header">
                <span class="instance-name"><i class="fas ${iconClass}" style="margin-right:8px;"></i>${this._esc(service.instance_name)}${bundleBadge}</span>
                <div class="instance-status-icon status-connected"><i class="fas fa-check-circle"></i></div>
            </div>
            <div class="instance-card-body">
                <div class="instance-detail"><i class="fas fa-server"></i><span>${appLabel}</span></div>
            </div>
            <div class="instance-card-footer">
                <button type="button" class="btn-card delete" data-id="${service.id}"><i class="fas fa-trash"></i> Remove</button>
            </div>
        </div>`;
    },

    // ── Bundles Section ──────────────────────────────────────────────

    _renderBundlesSection() {
        let bundleCardsHtml = '';
        this.bundles.forEach(b => { bundleCardsHtml += this._renderBundleCard(b); });
        bundleCardsHtml += `<div class="add-instance-card" data-action="add-bundle">` +
            `<div class="add-icon"><i class="fas fa-plus-circle"></i></div>` +
            `<div class="add-text">Create Bundle</div></div>`;

        return `<div class="settings-group instances-settings-group reqservices-group">
            <div class="profiles-header">
                <div>
                    <h3><i class="fas fa-layer-group" style="color:#10b981;margin-right:8px;"></i>Bundles</h3>
                    <p class="profiles-help">Bundles appear in all Requests dropdowns. The primary instance is what you browse; bundled instances receive the same requests automatically.</p>
                </div>
            </div>
            <div class="instance-card-grid instances-card-grid" id="reqservices-bundles-grid">${bundleCardsHtml}</div>
        </div>`;
    },

    _renderBundleCard(bundle) {
        const primary = this.services.find(s => s.id === bundle.primary_service_id);
        const primaryLabel = primary ? `${this._appLabel(primary.app_type)} \u2013 ${primary.instance_name}` : 'Unknown';
        const typeIcon = bundle.service_type === 'movies' ? 'fa-film' : 'fa-tv';
        const typeColor = bundle.service_type === 'movies' ? '#eab308' : '#818cf8';

        const memberLabels = (bundle.member_service_ids || []).map(sid => {
            const svc = this.services.find(s => s.id === sid);
            return svc ? `${this._appLabel(svc.app_type)} \u2013 ${svc.instance_name}` : `ID:${sid}`;
        });

        let membersHtml = '';
        if (memberLabels.length > 0) {
            membersHtml = memberLabels.map(l =>
                `<div class="instance-detail" style="font-size:12px;padding:2px 0;"><i class="fas fa-link" style="color:#6b7280;margin-right:6px;"></i><span>${this._esc(l)}</span></div>`
            ).join('');
        } else {
            membersHtml = '<div class="instance-detail" style="font-size:12px;color:#6b7280;">No bundled instances</div>';
        }

        return `<div class="instance-card bundle-card" data-bundle-id="${bundle.id}">
            <div class="instance-card-header">
                <span class="instance-name"><i class="fas fa-layer-group" style="margin-right:8px;color:#10b981;"></i>${this._esc(bundle.name)}</span>
                <span style="font-size:11px;color:${typeColor};"><i class="fas ${typeIcon}" style="margin-right:4px;"></i>${bundle.service_type === 'movies' ? 'Movies' : 'TV'}</span>
            </div>
            <div class="instance-card-body">
                <div class="instance-detail"><i class="fas fa-star" style="color:#eab308;margin-right:6px;"></i><span>Primary: ${this._esc(primaryLabel)}</span></div>
                <div style="margin-top:6px;border-top:1px solid rgba(255,255,255,0.06);padding-top:6px;">
                    <div style="font-size:11px;color:#9ca3af;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.5px;">Bundled Instances</div>
                    ${membersHtml}
                </div>
            </div>
            <div class="instance-card-footer">
                <button type="button" class="btn-card edit-bundle" data-bundle-id="${bundle.id}"><i class="fas fa-edit"></i> Edit</button>
                <button type="button" class="btn-card delete-bundle" data-bundle-id="${bundle.id}"><i class="fas fa-trash"></i> Delete</button>
            </div>
        </div>`;
    },

    _appLabel(appType) {
        return { radarr: 'Radarr', sonarr: 'Sonarr', movie_hunt: 'Movie Hunt', tv_hunt: 'TV Hunt' }[appType] || appType;
    },

    _wireBundles() {
        const grid = document.getElementById('reqservices-bundles-grid');
        if (!grid) return;
        grid.addEventListener('click', (e) => {
            const addCard = e.target.closest('.add-instance-card[data-action="add-bundle"]');
            if (addCard) { e.preventDefault(); this.openBundleModal(); return; }

            const editBtn = e.target.closest('.btn-card.edit-bundle');
            if (editBtn) { e.stopPropagation(); this.openBundleModal(parseInt(editBtn.dataset.bundleId)); return; }

            const deleteBtn = e.target.closest('.btn-card.delete-bundle');
            if (deleteBtn) { e.stopPropagation(); this.deleteBundle(parseInt(deleteBtn.dataset.bundleId)); return; }
        });
    },

    openBundleModal(editBundleId) {
        const existing = editBundleId ? this.bundles.find(b => b.id === editBundleId) : null;
        const isEdit = !!existing;
        const title = isEdit ? 'Edit Bundle' : 'Create Bundle';
        const bundleName = existing ? existing.name : '';
        const bundleType = existing ? existing.service_type : '';
        const primaryId = existing ? existing.primary_service_id : '';
        const memberIds = existing ? (existing.member_service_ids || []) : [];

        const typeSelectHtml = isEdit
            ? `<input type="hidden" id="bundle-type-select" value="${bundleType}"><div class="requsers-field"><label>Type</label><input type="text" value="${bundleType === 'movies' ? 'Movies' : 'TV'}" disabled style="opacity:0.6;"></div>`
            : `<div class="requsers-field"><label>Type</label><select id="bundle-type-select"><option value="movies">Movies</option><option value="tv">TV</option></select></div>`;

        const html = `<div class="requsers-modal-overlay" id="requsers-modal-overlay" onclick="if(event.target===this)RequestarrServices.closeModal()">
            <div class="requsers-modal" style="max-width:480px;">
                <div class="requsers-modal-header">
                    <h3 class="requsers-modal-title">${title}</h3>
                    <button class="requsers-modal-close" onclick="RequestarrServices.closeModal()"><i class="fas fa-times"></i></button>
                </div>
                <div class="requsers-modal-body">
                    ${typeSelectHtml}
                    <div class="requsers-field">
                        <label>Bundle Name</label>
                        <input type="text" id="bundle-name-input" value="${this._esc(bundleName)}" placeholder="e.g. Movies1" maxlength="50">
                    </div>
                    <div class="requsers-field">
                        <label>Primary Instance</label>
                        <select id="bundle-primary-select"><option value="">Loading...</option></select>
                        <div style="font-size:11px;color:#9ca3af;margin-top:4px;">This is the instance you browse. Its library is what you see.</div>
                    </div>
                    <div class="requsers-field">
                        <label>Bundled Instances</label>
                        <div id="bundle-members-list" style="display:flex;flex-direction:column;gap:6px;">Loading...</div>
                        <div style="font-size:11px;color:#9ca3af;margin-top:4px;">These instances will automatically receive the same requests as the primary.</div>
                    </div>
                </div>
                <div class="requsers-modal-footer">
                    <button class="requsers-btn" style="background:var(--bg-tertiary);color:var(--text-secondary);" onclick="RequestarrServices.closeModal()">Cancel</button>
                    <button class="requsers-btn requsers-btn-primary" id="bundle-save-btn"><i class="fas fa-save"></i> ${isEdit ? 'Save' : 'Create'}</button>
                </div>
            </div>
        </div>`;

        this.closeModal();
        document.body.insertAdjacentHTML('beforeend', html);

        const typeSelect = document.getElementById('bundle-type-select');
        if (isEdit) {
            this._populateBundleInstanceSelectors(bundleType, primaryId, memberIds);
        } else {
            this._populateBundleInstanceSelectors(typeSelect.value, primaryId, memberIds);
            typeSelect.addEventListener('change', () => {
                this._populateBundleInstanceSelectors(typeSelect.value, '', []);
            });
        }

        document.getElementById('bundle-save-btn').addEventListener('click', () => {
            this._saveBundleFromModal(editBundleId);
        });
    },

    _populateBundleInstanceSelectors(serviceType, selectedPrimaryId, selectedMemberIds) {
        const services = this.services.filter(s => s.service_type === serviceType);
        const primarySelect = document.getElementById('bundle-primary-select');
        const membersList = document.getElementById('bundle-members-list');
        if (!primarySelect || !membersList) return;

        primarySelect.innerHTML = services.length === 0
            ? '<option value="">No instances available</option>'
            : services.map(s => {
                const label = `${this._appLabel(s.app_type)} \u2013 ${s.instance_name}`;
                const sel = s.id == selectedPrimaryId ? ' selected' : '';
                return `<option value="${s.id}"${sel}>${this._esc(label)}</option>`;
            }).join('');

        if (services.length === 0) {
            membersList.innerHTML = '<div style="color:#6b7280;font-size:13px;">No instances available</div>';
            return;
        }

        membersList.innerHTML = services.map(s => {
            const label = `${this._appLabel(s.app_type)} \u2013 ${s.instance_name}`;
            const checked = selectedMemberIds.includes(s.id) ? ' checked' : '';
            return `<label class="requsers-perm-item" style="padding:4px 0;">
                <input type="checkbox" class="bundle-member-cb" value="${s.id}"${checked}>
                <span>${this._esc(label)}</span>
            </label>`;
        }).join('');
    },

    async _saveBundleFromModal(editBundleId) {
        const name = (document.getElementById('bundle-name-input').value || '').trim();
        const serviceType = document.getElementById('bundle-type-select').value;
        const primaryId = parseInt(document.getElementById('bundle-primary-select').value);
        const memberCbs = document.querySelectorAll('.bundle-member-cb:checked');
        const memberIds = Array.from(memberCbs).map(cb => parseInt(cb.value)).filter(id => id !== primaryId);

        if (!name) {
            if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification('Bundle name is required', 'error');
            return;
        }
        if (!primaryId) {
            if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification('Select a primary instance', 'error');
            return;
        }

        try {
            const isEdit = !!editBundleId;
            const url = isEdit ? `./api/requestarr/bundles/${editBundleId}` : './api/requestarr/bundles';
            const method = isEdit ? 'PUT' : 'POST';
            const body = {
                name: name,
                service_type: serviceType,
                primary_service_id: primaryId,
                member_service_ids: memberIds,
            };
            const resp = await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const data = await resp.json();
            if (data.success) {
                this.closeModal();
                if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification(isEdit ? 'Bundle updated' : 'Bundle created', 'success');
                await this.loadBundles();
                this.render();
            } else {
                if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification(data.error || 'Failed', 'error');
            }
        } catch (e) {
            console.error('[RequestarrServices] Error saving bundle:', e);
        }
    },

    async deleteBundle(bundleId) {
        const bundle = this.bundles.find(b => b.id === bundleId);
        const name = bundle ? bundle.name : 'this bundle';
        if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
            window.HuntarrConfirm.show({
                title: 'Delete Bundle',
                message: `Delete bundle "${name}"? Instances will not be removed.`,
                confirmText: 'Delete',
                confirmClass: 'danger',
                onConfirm: () => this._doDeleteBundle(bundleId),
            });
        } else {
            if (confirm(`Delete bundle "${name}"?`)) {
                await this._doDeleteBundle(bundleId);
            }
        }
    },

    async _doDeleteBundle(bundleId) {
        try {
            const resp = await fetch(`./api/requestarr/bundles/${bundleId}`, { method: 'DELETE' });
            const data = await resp.json();
            if (data.success) {
                if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification('Bundle deleted', 'success');
                await this.loadBundles();
                this.render();
            }
        } catch (e) {
            console.error('[RequestarrServices] Error deleting bundle:', e);
        }
    },

    // ── Existing service CRUD ────────────────────────────────────────

    _wireGrid(gridId, type) {
        const grid = document.getElementById(gridId);
        if (!grid) return;
        grid.addEventListener('click', (e) => {
            const addCard = e.target.closest('.add-instance-card[data-action="add"]');
            if (addCard) { e.preventDefault(); this.openAddModal(type); return; }

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

        const title = serviceType === 'movies' ? 'Add Movies Instance' : 'Add TV Instance';
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
                </div>
                <div class="requsers-modal-footer">
                    <button class="requsers-btn" style="background:var(--bg-tertiary);color:var(--text-secondary);" onclick="RequestarrServices.closeModal()">Cancel</button>
                    <button class="requsers-btn requsers-btn-primary" onclick="RequestarrServices.doAdd('${serviceType}')"><i class="fas fa-plus"></i> Add</button>
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

        try {
            const resp = await fetch('./api/requestarr/services', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    service_type: serviceType,
                    app_type: appType,
                    instance_name: instanceName,
                    instance_id: instanceId,
                }),
            });
            const data = await resp.json();
            if (data.success) {
                this.closeModal();
                if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification('Instance added', 'success');
                await this.loadServices();
                this.render();
            } else {
                if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification(data.error || 'Failed to add', 'error');
            }
        } catch (e) {
            console.error('[RequestarrServices] Error adding service:', e);
        }
    },

    async removeService(serviceId) {
        if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
            window.HuntarrConfirm.show({
                title: 'Remove Instance',
                message: 'Remove this instance from Requests? The instance itself will not be deleted.',
                confirmText: 'Remove',
                confirmClass: 'danger',
                onConfirm: () => this._doRemove(serviceId),
            });
        } else {
            if (confirm('Remove this instance from Requests?')) {
                await this._doRemove(serviceId);
            }
        }
    },

    async _doRemove(serviceId) {
        try {
            const resp = await fetch(`./api/requestarr/services/${serviceId}`, { method: 'DELETE' });
            const data = await resp.json();
            if (data.success) {
                if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification('Instance removed', 'success');
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
