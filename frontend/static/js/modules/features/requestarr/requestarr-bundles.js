/**
 * Requestarr Services — Bundles page.
 * Instances are discovered automatically from Movie Hunt / TV Hunt / Radarr / Sonarr configs.
 * This page manages bundles (grouping instances for cascading requests).
 * Uses the same card-based design as the Sonarr/Radarr instance pages.
 */
const RequestarrServices = {
    bundles: [],
    available: { movies: [], tv: [] },

    async init() {
        await Promise.all([this.loadBundles(), this.loadAvailable()]);
        this.render();
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

    async loadAvailable() {
        try {
            const resp = await fetch('./api/requestarr/bundles/available', { cache: 'no-store' });
            if (!resp.ok) throw new Error('Failed');
            this.available = await resp.json();
        } catch (e) {
            console.error('[RequestarrServices] Error loading available instances:', e);
        }
    },

    _appLabel(at) {
        return {'radarr':'Radarr','sonarr':'Sonarr','movie_hunt':'Movie Hunt','tv_hunt':'TV Hunt'}[at] || at;
    },

    _appIcon(at) {
        return {'radarr':'fa-film','sonarr':'fa-tv','movie_hunt':'fa-film','tv_hunt':'fa-tv'}[at] || 'fa-layer-group';
    },

    render() {
        const container = document.getElementById('requestarr-bundles-content');
        if (!container) return;

        const movieBundles = this.bundles.filter(b => b.service_type === 'movies');
        const tvBundles = this.bundles.filter(b => b.service_type === 'tv');

        container.innerHTML =
            this._renderBundleGroup('Movie Bundles', movieBundles, 'movies') +
            this._renderBundleGroup('TV Bundles', tvBundles, 'tv');
        this._wireBundles();
    },

    _renderBundleGroup(title, bundles, type) {
        const cards = bundles.map(b => this._renderBundleCard(b)).join('');
        const addCard = `
            <div class="add-instance-card" onclick="RequestarrServices.openBundleModal(null,'${type}')">
                <div class="add-icon"><i class="fas fa-plus-circle"></i></div>
                <div class="add-text">Add Bundle</div>
            </div>`;

        return `
            <div class="settings-group">
                <h3>${title}</h3>
                <div class="instance-card-grid">
                    ${cards}
                    ${addCard}
                </div>
            </div>`;
    },

    _renderBundleCard(bundle) {
        const primaryLabel = `${this._appLabel(bundle.primary_app_type)} \u2013 ${bundle.primary_instance_name}`;
        const members = bundle.members || [];
        const memberCount = members.length;
        const allInstances = [
            { app_type: bundle.primary_app_type, instance_name: bundle.primary_instance_name },
            ...members
        ];

        const instanceTags = allInstances.map(inst =>
            `<span class="profile-quality-tag">${this._esc(this._appLabel(inst.app_type))} \u2013 ${this._esc(inst.instance_name)}</span>`
        ).join('');

        return `
            <div class="instance-card" data-bundle-id="${bundle.id}">
                <div class="instance-card-header">
                    <div class="instance-name instance-name-with-priority">
                        <i class="fas fa-layer-group"></i>
                        ${this._esc(bundle.name)}
                    </div>
                </div>
                <div class="instance-card-body">
                    <div class="instance-detail">
                        <i class="fas fa-star" style="color:#f59e0b;"></i>
                        <span>${this._esc(primaryLabel)}${memberCount > 0 ? ` + ${memberCount} more` : ''}</span>
                    </div>
                    <div class="profile-card-quality-tags" style="margin-top:8px;">
                        ${instanceTags}
                    </div>
                </div>
                <div class="instance-card-footer">
                    <button type="button" class="btn-card edit" onclick="RequestarrServices.openBundleModal(${bundle.id})">
                        <i class="fas fa-edit"></i> Edit
                    </button>
                    <button type="button" class="btn-card delete" onclick="RequestarrServices.deleteBundle(${bundle.id})">
                        <i class="fas fa-trash"></i> Delete
                    </button>
                </div>
            </div>`;
    },

    _wireBundles() {
        // onclick handlers are inline
    },

    openBundleModal(editBundleId, defaultType) {
        const existing = editBundleId ? this.bundles.find(b => b.id === editBundleId) : null;
        const isEdit = !!existing;
        const title = isEdit ? 'Edit Bundle' : 'Create Bundle';
        const bundleName = existing ? existing.name : '';
        const bundleType = existing ? existing.service_type : (defaultType || 'movies');
        const primaryKey = existing ? `${existing.primary_app_type}:${existing.primary_instance_name}` : '';
        const memberKeys = existing
            ? (existing.members || []).map(m => `${m.app_type}:${m.instance_name}`)
            : [];

        const typeOptions = isEdit
            ? `<input type="hidden" id="bundle-type-select" value="${bundleType}">
               <div class="modal-form-section">
                   <div class="modal-section-title">Type</div>
                   <input type="text" value="${bundleType === 'movies' ? 'Movies' : 'TV'}" disabled style="opacity:0.6;width:100%;padding:8px 12px;border-radius:6px;border:1px solid rgba(148,163,184,0.2);background:rgba(30,41,59,0.5);color:#cbd5e1;">
               </div>`
            : `<div class="modal-form-section">
                   <div class="modal-section-title">Type</div>
                   <select id="bundle-type-select" style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid rgba(148,163,184,0.2);background:rgba(30,41,59,0.5);color:#cbd5e1;">
                       <option value="movies"${bundleType === 'movies' ? ' selected' : ''}>Movies</option>
                       <option value="tv"${bundleType === 'tv' ? ' selected' : ''}>TV</option>
                   </select>
               </div>`;

        const html = `<div class="huntarr-modal-overlay active" id="bundle-modal-overlay" onclick="if(event.target===this)RequestarrServices.closeModal()">
            <div class="huntarr-modal" style="max-width:520px;">
                <div class="huntarr-modal-header">
                    <h3 class="huntarr-modal-title">${title}</h3>
                    <button class="huntarr-modal-close" onclick="RequestarrServices.closeModal()"><i class="fas fa-times"></i></button>
                </div>
                <div class="huntarr-modal-body">
                    ${typeOptions}
                    <div class="modal-form-section">
                        <div class="modal-section-title">Bundle Name</div>
                        <input type="text" id="bundle-name-input" value="${this._esc(bundleName)}" placeholder="e.g. All Movies" maxlength="50"
                            style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid rgba(148,163,184,0.2);background:rgba(30,41,59,0.5);color:#f8fafc;">
                    </div>
                    <div class="modal-form-section">
                        <div class="modal-section-title">Primary Instance</div>
                        <select id="bundle-primary-select" style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid rgba(148,163,184,0.2);background:rgba(30,41,59,0.5);color:#cbd5e1;">
                            <option value="">Loading...</option>
                        </select>
                        <div style="font-size:11px;color:#64748b;margin-top:6px;">This is the instance you browse. Its library is what you see.</div>
                    </div>
                    <div class="modal-form-section">
                        <div class="modal-section-title">Bundled Instances</div>
                        <div id="bundle-members-list" style="display:flex;flex-direction:column;gap:8px;">Loading...</div>
                        <div style="font-size:11px;color:#64748b;margin-top:6px;">These instances will automatically receive the same requests as the primary.</div>
                    </div>
                </div>
                <div class="huntarr-modal-footer">
                    <button class="btn-modal btn-modal-secondary" onclick="RequestarrServices.closeModal()">Cancel</button>
                    <button class="btn-modal btn-modal-primary" id="bundle-save-btn"><i class="fas fa-save"></i> ${isEdit ? 'Save' : 'Create'}</button>
                </div>
            </div>
        </div>`;

        this.closeModal();
        document.body.insertAdjacentHTML('beforeend', html);

        const typeSelect = document.getElementById('bundle-type-select');
        this._populateBundleInstanceSelectors(bundleType, primaryKey, memberKeys);

        const primarySelect = document.getElementById('bundle-primary-select');
        primarySelect.addEventListener('change', () => {
            const currentMembers = Array.from(document.querySelectorAll('.bundle-member-cb:checked')).map(cb => cb.value);
            this._populateBundleMembers(
                document.getElementById('bundle-type-select')?.value || 'movies',
                primarySelect.value,
                currentMembers.filter(k => k !== primarySelect.value)
            );
        });

        if (!isEdit) {
            typeSelect.addEventListener('change', () => {
                this._populateBundleInstanceSelectors(typeSelect.value, '', []);
            });
        }

        document.getElementById('bundle-save-btn').addEventListener('click', () => {
            this._saveBundleFromModal(editBundleId);
        });
    },

    _populateBundleInstanceSelectors(serviceType, selectedPrimaryKey, selectedMemberKeys) {
        const instances = serviceType === 'movies'
            ? (this.available.movies || [])
            : (this.available.tv || []);

        const primarySelect = document.getElementById('bundle-primary-select');
        if (!primarySelect) return;

        if (instances.length === 0) {
            primarySelect.innerHTML = '<option value="">No instances available</option>';
            this._populateBundleMembers(serviceType, '', []);
            return;
        }

        primarySelect.innerHTML = instances.map(inst => {
            const key = `${inst.app_type}:${inst.instance_name}`;
            const label = `${this._appLabel(inst.app_type)} \u2013 ${inst.instance_name}`;
            const sel = key === selectedPrimaryKey ? ' selected' : '';
            return `<option value="${this._esc(key)}"${sel}>${this._esc(label)}</option>`;
        }).join('');

        const activePrimary = primarySelect.value || selectedPrimaryKey;
        this._populateBundleMembers(serviceType, activePrimary, selectedMemberKeys);
    },

    _populateBundleMembers(serviceType, primaryKey, selectedMemberKeys) {
        const instances = serviceType === 'movies'
            ? (this.available.movies || [])
            : (this.available.tv || []);

        const membersList = document.getElementById('bundle-members-list');
        if (!membersList) return;

        const filtered = instances.filter(inst => `${inst.app_type}:${inst.instance_name}` !== primaryKey);

        if (filtered.length === 0) {
            membersList.innerHTML = '<div style="color:#64748b;font-size:13px;">No other instances available</div>';
            return;
        }

        membersList.innerHTML = filtered.map(inst => {
            const key = `${inst.app_type}:${inst.instance_name}`;
            const label = `${this._appLabel(inst.app_type)} \u2013 ${inst.instance_name}`;
            const checked = selectedMemberKeys.includes(key) ? ' checked' : '';
            return `<label style="display:flex;align-items:center;gap:8px;padding:6px 0;color:#cbd5e1;font-size:13px;cursor:pointer;">
                <input type="checkbox" class="bundle-member-cb" value="${this._esc(key)}"${checked}>
                <span>${this._esc(label)}</span>
            </label>`;
        }).join('');
    },

    async _saveBundleFromModal(editBundleId) {
        const name = (document.getElementById('bundle-name-input')?.value || '').trim();
        const serviceType = document.getElementById('bundle-type-select')?.value || 'movies';
        const primaryKey = document.getElementById('bundle-primary-select')?.value || '';
        const memberCbs = document.querySelectorAll('.bundle-member-cb:checked');
        const memberKeys = Array.from(memberCbs).map(cb => cb.value);

        if (!name) { alert('Bundle name is required'); return; }
        if (!primaryKey) { alert('Primary instance is required'); return; }

        const parseCK = (ck) => {
            const idx = ck.indexOf(':');
            return { app_type: ck.substring(0, idx), instance_name: ck.substring(idx + 1) };
        };
        const primary = parseCK(primaryKey);
        const members = memberKeys.map(parseCK);

        const body = {
            name,
            service_type: serviceType,
            primary_app_type: primary.app_type,
            primary_instance_name: primary.instance_name,
            members,
        };

        try {
            const url = editBundleId
                ? `./api/requestarr/bundles/${editBundleId}`
                : './api/requestarr/bundles';
            const method = editBundleId ? 'PUT' : 'POST';
            const resp = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const data = await resp.json();
            if (data.success) {
                this.closeModal();
                await this.loadBundles();
                this.render();
                document.dispatchEvent(new CustomEvent('huntarr:instances-changed'));
            } else {
                alert(data.error || 'Failed to save bundle');
            }
        } catch (e) {
            console.error('[RequestarrServices] Error saving bundle:', e);
            alert('Failed to save bundle');
        }
    },

    async deleteBundle(bundleId) {
        const bundle = this.bundles.find(b => b.id === bundleId);
        const name = bundle ? bundle.name : `Bundle #${bundleId}`;
        if (window.HuntarrConfirm) {
            window.HuntarrConfirm.show({
                title: 'Delete Bundle',
                message: `Delete "${name}"? Instances will not be affected.`,
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
                await this.loadBundles();
                this.render();
                document.dispatchEvent(new CustomEvent('huntarr:instances-changed'));
            }
        } catch (e) {
            console.error('[RequestarrServices] Error deleting bundle:', e);
        }
    },

    closeModal() {
        const overlay = document.getElementById('bundle-modal-overlay');
        if (overlay) overlay.remove();
    },

    _esc(str) {
        const d = document.createElement('div');
        d.textContent = str || '';
        return d.innerHTML;
    }
};

window.RequestarrServices = RequestarrServices;
