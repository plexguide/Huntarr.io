/**
 * Requestarr Services — Bundles-only page.
 * Instances are discovered automatically from Movie Hunt / TV Hunt / Radarr / Sonarr configs.
 * This page only manages bundles (grouping instances for cascading requests).
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

    render() {
        const container = document.getElementById('requestarr-services-content');
        if (!container) return;

        const movieBundles = this.bundles.filter(b => b.service_type === 'movies');
        const tvBundles = this.bundles.filter(b => b.service_type === 'tv');

        container.innerHTML = `
            <div style="margin-bottom:12px;color:#9ca3af;font-size:13px;">
                Bundles group instances so one request cascades to all members automatically.
            </div>
            ${this._renderBundleGroup('Movie Bundles', movieBundles, 'movies')}
            ${this._renderBundleGroup('TV Bundles', tvBundles, 'tv')}
        `;
        this._wireBundles();
    },

    _renderBundleGroup(title, bundles, type) {
        const cards = bundles.length > 0
            ? bundles.map(b => this._renderBundleCard(b)).join('')
            : '<div style="color:#6b7280;font-size:13px;padding:12px;">No bundles created yet.</div>';
        return `
            <div style="margin-bottom:24px;">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
                    <h4 style="margin:0;color:var(--text-primary);font-size:15px;">${title}</h4>
                    <button class="requsers-btn requsers-btn-primary" style="font-size:12px;padding:5px 12px;"
                        onclick="RequestarrServices.openBundleModal(null,'${type}')">
                        <i class="fas fa-plus"></i> Create Bundle
                    </button>
                </div>
                <div style="display:flex;flex-direction:column;gap:8px;">${cards}</div>
            </div>`;
    },

    _renderBundleCard(bundle) {
        const appLabel = (at) => ({'radarr':'Radarr','sonarr':'Sonarr','movie_hunt':'Movie Hunt','tv_hunt':'TV Hunt'}[at] || at);
        const primaryLabel = `${appLabel(bundle.primary_app_type)} \u2013 ${bundle.primary_instance_name}`;
        const members = bundle.members || [];
        const memberLabels = members.map(m => `${appLabel(m.app_type)} \u2013 ${m.instance_name}`);
        const allLabels = [primaryLabel, ...memberLabels];

        return `
            <div class="requsers-card" style="padding:12px 16px;">
                <div style="display:flex;align-items:center;justify-content:space-between;">
                    <div>
                        <div style="font-weight:600;color:var(--text-primary);font-size:14px;">${this._esc(bundle.name)}</div>
                        <div style="font-size:12px;color:#9ca3af;margin-top:2px;">
                            <i class="fas fa-star" style="color:#f59e0b;font-size:10px;"></i> ${this._esc(primaryLabel)}
                            ${memberLabels.length > 0 ? ` + ${memberLabels.length} more` : ''}
                        </div>
                        <div style="font-size:11px;color:#6b7280;margin-top:4px;">
                            ${allLabels.map(l => `<span style="background:var(--bg-tertiary);padding:2px 6px;border-radius:4px;margin-right:4px;">${this._esc(l)}</span>`).join('')}
                        </div>
                    </div>
                    <div style="display:flex;gap:8px;">
                        <button class="requsers-btn" style="font-size:11px;padding:4px 10px;background:var(--bg-tertiary);color:var(--text-secondary);"
                            onclick="RequestarrServices.openBundleModal(${bundle.id})">
                            <i class="fas fa-edit"></i> Edit
                        </button>
                        <button class="requsers-btn" style="font-size:11px;padding:4px 10px;background:var(--bg-tertiary);color:#ef4444;"
                            onclick="RequestarrServices.deleteBundle(${bundle.id})">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            </div>`;
    },

    _wireBundles() {
        // No extra wiring needed — onclick handlers are inline
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

        const typeSelectHtml = isEdit
            ? `<input type="hidden" id="bundle-type-select" value="${bundleType}"><div class="requsers-field"><label>Type</label><input type="text" value="${bundleType === 'movies' ? 'Movies' : 'TV'}" disabled style="opacity:0.6;"></div>`
            : `<div class="requsers-field"><label>Type</label><select id="bundle-type-select"><option value="movies"${bundleType === 'movies' ? ' selected' : ''}>Movies</option><option value="tv"${bundleType === 'tv' ? ' selected' : ''}>TV</option></select></div>`;

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
                        <input type="text" id="bundle-name-input" value="${this._esc(bundleName)}" placeholder="e.g. All Movies" maxlength="50">
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
        this._populateBundleInstanceSelectors(bundleType, primaryKey, memberKeys);
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
        const appLabel = (at) => ({'radarr':'Radarr','sonarr':'Sonarr','movie_hunt':'Movie Hunt','tv_hunt':'TV Hunt'}[at] || at);

        const primarySelect = document.getElementById('bundle-primary-select');
        const membersList = document.getElementById('bundle-members-list');
        if (!primarySelect || !membersList) return;

        if (instances.length === 0) {
            primarySelect.innerHTML = '<option value="">No instances available</option>';
            membersList.innerHTML = '<div style="color:#6b7280;font-size:13px;">No instances available</div>';
            return;
        }

        primarySelect.innerHTML = instances.map(inst => {
            const key = `${inst.app_type}:${inst.instance_name}`;
            const label = `${appLabel(inst.app_type)} \u2013 ${inst.instance_name}`;
            const sel = key === selectedPrimaryKey ? ' selected' : '';
            return `<option value="${this._esc(key)}"${sel}>${this._esc(label)}</option>`;
        }).join('');

        membersList.innerHTML = instances.map(inst => {
            const key = `${inst.app_type}:${inst.instance_name}`;
            const label = `${appLabel(inst.app_type)} \u2013 ${inst.instance_name}`;
            const checked = selectedMemberKeys.includes(key) ? ' checked' : '';
            return `<label class="requsers-perm-item" style="padding:4px 0;">
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

        // Parse compound keys
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
        const overlay = document.getElementById('requsers-modal-overlay');
        if (overlay) overlay.remove();
    },

    _esc(str) {
        const d = document.createElement('div');
        d.textContent = str || '';
        return d.innerHTML;
    }
};

window.RequestarrServices = RequestarrServices;