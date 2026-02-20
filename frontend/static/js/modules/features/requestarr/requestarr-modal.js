/**
 * Requestarr Modal - Two-column poster + form layout (matches Movie Hunt design)
 */

/* encodeInstanceValue, decodeInstanceValue from requestarr-core-utils.js (loaded first) */
class RequestarrModal {
    constructor(core) {
        this.core = core;
    }
    
    // ========================================
    // MODAL SYSTEM
    // ========================================

    async openModal(tmdbId, mediaType, suggestedInstance = null) {
        const modal = document.getElementById('media-modal');
        if (!modal) return;

        // Load modal preferences from server
        await this.loadModalPreferences();

        // Move modal to body so it sits outside .app-container and is not blurred
        if (modal.parentElement !== document.body) {
            document.body.appendChild(modal);
        }

        document.body.classList.add('requestarr-modal-open');
        modal.style.display = 'flex';

        // Show loading state in the existing elements
        const titleEl = document.getElementById('requestarr-modal-title');
        const labelEl = document.getElementById('requestarr-modal-label');
        const metaEl = document.getElementById('requestarr-modal-meta');
        const statusContainer = document.getElementById('requestarr-modal-status-container');
        const posterImg = document.getElementById('requestarr-modal-poster-img');
        const requestBtn = document.getElementById('modal-request-btn');
        const instanceSelect = document.getElementById('modal-instance-select');
        const rootSelect = document.getElementById('modal-root-folder');
        const qualitySelect = document.getElementById('modal-quality-profile');

        if (titleEl) titleEl.textContent = 'Loading...';
        if (labelEl) labelEl.textContent = mediaType === 'tv' ? 'Add Series' : 'Add Movie';
        if (metaEl) metaEl.textContent = '';
        if (statusContainer) statusContainer.innerHTML = '<span class="mh-req-badge mh-req-badge-loading"><i class="fas fa-spinner fa-spin"></i> Loading...</span>';
        if (posterImg) posterImg.src = './static/images/blackout.jpg';
        if (requestBtn) { requestBtn.disabled = true; requestBtn.textContent = 'Add to Library'; requestBtn.classList.remove('disabled', 'success'); }
        if (instanceSelect) instanceSelect.innerHTML = '<option value="">Loading...</option>';
        const instanceInfoIcon = document.getElementById('modal-instance-info-icon');
        if (instanceInfoIcon) instanceInfoIcon.style.display = 'none';
        if (rootSelect) rootSelect.innerHTML = '<option value="">Loading...</option>';
        if (qualitySelect) qualitySelect.innerHTML = '<option value="">Loading...</option>';

        // Always hide Movie-Hunt-only and TV-Hunt-only fields first; renderModal will show them if needed
        // Uses class toggle because .mh-req-field has display:grid!important which overrides inline styles
        const wrapMinInit = document.getElementById('requestarr-modal-min-availability-wrap');
        const wrapStartInit = document.getElementById('requestarr-modal-start-search-wrap');
        const wrapMonitorInit = document.getElementById('requestarr-modal-monitor-wrap');
        if (wrapMinInit) wrapMinInit.classList.add('mh-hidden');
        if (wrapStartInit) wrapStartInit.classList.add('mh-hidden');
        if (wrapMonitorInit) wrapMonitorInit.classList.add('mh-hidden');

        // Attach close handlers (use .onclick to avoid stacking)
        const self = this;
        const backdrop = document.getElementById('requestarr-modal-backdrop');
        const closeBtn = document.getElementById('requestarr-modal-close');
        const cancelBtn = document.getElementById('requestarr-modal-cancel');
        const startCb = document.getElementById('modal-start-search');
        const minSelect = document.getElementById('modal-minimum-availability');

        if (backdrop) backdrop.onclick = () => self.closeModal();
        if (closeBtn) closeBtn.onclick = () => self.closeModal();
        if (cancelBtn) cancelBtn.onclick = () => self.closeModal();
        if (requestBtn) requestBtn.onclick = () => self.submitRequest();

        // Attach change listeners for preferences
        if (startCb) {
            startCb.onchange = () => {
                this.saveModalPreferences({ start_search: startCb.checked });
            };
        }
        if (minSelect) {
            minSelect.onchange = () => {
                this.saveModalPreferences({ minimum_availability: minSelect.value });
            };
        }
        const rootSelectEl = document.getElementById('modal-root-folder');
        if (rootSelectEl) {
            rootSelectEl.onchange = () => this._updateRequestButtonFromRootFolder();
        }

        this.suggestedInstance = suggestedInstance;

        try {
            const response = await fetch(`./api/requestarr/details/${mediaType}/${tmdbId}`);
            const data = await response.json();

            if (data.tmdb_id) {
                this.core.currentModal = data;
                this.core.currentModalData = data;
                this.renderModal(data);
            } else {
                throw new Error('Failed to load details');
            }
        } catch (error) {
            console.error('[RequestarrModal] Error loading details:', error);
            if (titleEl) titleEl.textContent = 'Error';
            if (statusContainer) statusContainer.innerHTML = '<span class="mh-req-badge mh-req-badge-error"><i class="fas fa-exclamation-triangle"></i> Failed to load details</span>';
        }
    }

    async loadModalPreferences() {
        try {
            const response = await fetch('./api/requestarr/settings/modal-preferences');
            const result = await response.json();
            if (result.success) {
                this.preferences = result.preferences;
            } else {
                this.preferences = {
                    start_search: true,
                    minimum_availability: 'released',
                    movie_instance: '',
                    tv_instance: ''
                };
            }
        } catch (error) {
            console.error('[RequestarrModal] Error loading preferences:', error);
            this.preferences = {
                start_search: true,
                minimum_availability: 'released',
                movie_instance: '',
                tv_instance: ''
            };
        }
    }

    async saveModalPreferences(prefs) {
        try {
            await fetch('./api/requestarr/settings/modal-preferences', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(prefs)
            });
            // Update local object
            Object.assign(this.preferences, prefs);
        } catch (error) {
            console.error('[RequestarrModal] Error saving preferences:', error);
        }
    }

    renderModal(data) {
            const isTVShow = data.media_type === 'tv';
            const isOwner = window._huntarrUserRole === 'owner';
            const perms = window._huntarrUserPermissions || {};

            // For movies, combine Movie Hunt + Radarr; for TV, combine TV Hunt + Sonarr
            let uniqueInstances = [];
            if (isTVShow) {
                const thInstances = (this.core.instances.tv_hunt || []).map(inst => ({
                    ...inst, appType: 'tv_hunt', compoundValue: encodeInstanceValue('tv_hunt', inst.name),
                    label: `TV Hunt \u2013 ${inst.name}`
                }));
                const sonarrInstances = (this.core.instances.sonarr || []).map(inst => ({
                    ...inst, appType: 'sonarr', compoundValue: encodeInstanceValue('sonarr', inst.name),
                    label: `Sonarr \u2013 ${inst.name}`
                }));
                const seen = new Set();
                thInstances.forEach(inst => {
                    if (!seen.has(inst.compoundValue)) {
                        seen.add(inst.compoundValue);
                        uniqueInstances.push(inst);
                    }
                });
                sonarrInstances.forEach(inst => {
                    if (!seen.has(inst.compoundValue)) {
                        seen.add(inst.compoundValue);
                        uniqueInstances.push(inst);
                    }
                });
            } else {
                const mhInstances = this.core.instances.movie_hunt || [];
                const radarrInstances = this.core.instances.radarr || [];
                const seen = new Set();
                mhInstances.forEach(inst => {
                    if (!seen.has(inst.name)) {
                        seen.add(inst.name);
                        uniqueInstances.push({
                            ...inst,
                            appType: 'movie_hunt',
                            compoundValue: encodeInstanceValue('movie_hunt', inst.name),
                            label: `Movie Hunt \u2013 ${inst.name}`
                        });
                    }
                });
                radarrInstances.forEach(inst => {
                    if (!seen.has(`radarr-${inst.name}`)) {
                        seen.add(`radarr-${inst.name}`);
                        uniqueInstances.push({
                            ...inst,
                            appType: 'radarr',
                            compoundValue: encodeInstanceValue('radarr', inst.name),
                            label: `Radarr \u2013 ${inst.name}`
                        });
                    }
                });
            }

            // Populate poster
            const posterImg = document.getElementById('requestarr-modal-poster-img');
            if (posterImg) posterImg.src = data.poster_path || './static/images/blackout.jpg';

            // Populate title
            const titleEl = document.getElementById('requestarr-modal-title');
            if (titleEl) titleEl.textContent = data.title || '';

            // Populate label
            const labelEl = document.getElementById('requestarr-modal-label');
            if (labelEl) labelEl.textContent = isTVShow ? 'Request Series' : 'Request Movie';

            // Populate meta (year, genres)
            const metaEl = document.getElementById('requestarr-modal-meta');
            if (metaEl) {
                const parts = [];
                if (data.year) parts.push(String(data.year));
                if (data.genres && data.genres.length) {
                    const genreNames = data.genres
                        .slice(0, 3)
                        .map(g => typeof g === 'string' ? g : (g.name || ''))
                        .filter(Boolean);
                    if (genreNames.length) parts.push(genreNames.join(', '));
                }
                metaEl.textContent = parts.join('  \u00B7  ');
            }

            const fieldsContainer = document.querySelector('.mh-req-fields');
            const startSearchWrap = document.getElementById('requestarr-modal-start-search-wrap');
            const statusContainer = document.getElementById('requestarr-modal-status-container');
            const requestBtn = document.getElementById('modal-request-btn');
            const instanceSelect = document.getElementById('modal-instance-select');

            // ── Non-owner simplified modal ──
            if (!isOwner) {
                // Show fields container (for the instance row) but hide everything except instance
                if (fieldsContainer) fieldsContainer.style.display = '';
                if (startSearchWrap) startSearchWrap.classList.add('mh-hidden');
                this._clearImportBanner();

                // Hide root folder, quality profile, monitor, movie monitor, min availability rows
                const rootField = document.getElementById('modal-root-folder');
                const qualityField = document.getElementById('modal-quality-profile');
                if (rootField && rootField.closest('.mh-req-field')) rootField.closest('.mh-req-field').classList.add('mh-hidden');
                if (qualityField && qualityField.closest('.mh-req-field')) qualityField.closest('.mh-req-field').classList.add('mh-hidden');
                const monitorWrap = document.getElementById('requestarr-modal-monitor-wrap');
                const movieMonitorWrap = document.getElementById('requestarr-modal-movie-monitor-wrap');
                const minAvailWrap = document.getElementById('requestarr-modal-min-availability-wrap');
                if (monitorWrap) monitorWrap.classList.add('mh-hidden');
                if (movieMonitorWrap) movieMonitorWrap.classList.add('mh-hidden');
                if (minAvailWrap) minAvailWrap.classList.add('mh-hidden');

                // Resolve the page's current instance
                const pageInstance = this.suggestedInstance
                    || (isTVShow ? this.core.content.selectedTVInstance : this.core.content.selectedMovieInstance)
                    || uniqueInstances[0]?.compoundValue || '';

                // Populate instance dropdown with single option, greyed out
                if (instanceSelect) {
                    instanceSelect.innerHTML = '';
                    const matched = uniqueInstances.find(inst => inst.compoundValue === pageInstance || inst.name === pageInstance);
                    const opt = document.createElement('option');
                    opt.value = pageInstance;
                    opt.textContent = matched ? matched.label : pageInstance;
                    instanceSelect.appendChild(opt);
                    instanceSelect.disabled = true;
                    instanceSelect.style.opacity = '0.6';
                    instanceSelect.onchange = null;
                }
                const instanceInfoIcon = document.getElementById('modal-instance-info-icon');
                if (instanceInfoIcon) instanceInfoIcon.style.display = 'none';

                // Show permissions status row below instance (same field styling)
                const hasAutoApprove = isTVShow
                    ? (perms.auto_approve || perms.auto_approve_tv)
                    : (perms.auto_approve || perms.auto_approve_movies);

                // Remove any previous permissions row, then insert a new one
                const existingPermRow = document.getElementById('requestarr-modal-permissions-row');
                if (existingPermRow) existingPermRow.remove();
                const permRow = document.createElement('div');
                permRow.className = 'mh-req-field';
                permRow.id = 'requestarr-modal-permissions-row';
                const permLabel = document.createElement('label');
                permLabel.textContent = 'Status';
                const permValue = document.createElement('span');
                permValue.className = 'mh-req-perm-status';
                if (hasAutoApprove) {
                    permValue.innerHTML = '<i class="fas fa-check-circle"></i> Auto-Approved';
                    permValue.classList.add('mh-req-perm-approved');
                } else {
                    permValue.innerHTML = '<i class="fas fa-clock"></i> Requires Approval';
                    permValue.classList.add('mh-req-perm-pending');
                }
                permRow.appendChild(permLabel);
                permRow.appendChild(permValue);
                // Insert after the instance field
                const instanceField = instanceSelect ? instanceSelect.closest('.mh-req-field') : null;
                if (instanceField && instanceField.parentNode) {
                    instanceField.parentNode.insertBefore(permRow, instanceField.nextSibling);
                }

                // Clear status container (permissions info is now in the field row)
                if (statusContainer) statusContainer.innerHTML = '';

                // Configure request button
                if (requestBtn) {
                    requestBtn.disabled = !pageInstance;
                    requestBtn.classList.remove('disabled', 'success');
                    requestBtn.textContent = isTVShow ? 'Request Series' : 'Request Movie';
                    if (!pageInstance) requestBtn.classList.add('disabled');
                }
                // Push buttons to bottom-right of the form column
                const actionsArea = document.querySelector('.mh-req-actions');
                if (actionsArea) actionsArea.style.marginTop = 'auto';
                return;
            }

            // ── Owner full modal (existing logic) ──
            if (fieldsContainer) fieldsContainer.style.display = '';
            const actionsArea = document.querySelector('.mh-req-actions');
            if (actionsArea) actionsArea.style.marginTop = '';
            // Remove permissions row if present from previous non-owner render
            const existingPermRowOwner = document.getElementById('requestarr-modal-permissions-row');
            if (existingPermRowOwner) existingPermRowOwner.remove();
            // Re-show root/quality fields (may have been hidden by previous non-owner render)
            const rootField = document.getElementById('modal-root-folder');
            const qualityField = document.getElementById('modal-quality-profile');
            if (rootField && rootField.closest('.mh-req-field')) rootField.closest('.mh-req-field').classList.remove('mh-hidden');
            if (qualityField && qualityField.closest('.mh-req-field')) qualityField.closest('.mh-req-field').classList.remove('mh-hidden');
            if (instanceSelect) {
                instanceSelect.disabled = false;
                instanceSelect.style.opacity = '';
            }

            const currentlySelectedInstance = isTVShow ? (this.preferences?.tv_instance || this.core.content.selectedTVInstance) : (this.preferences?.movie_instance || this.core.content.selectedMovieInstance);
            const rawDefault = this.suggestedInstance || currentlySelectedInstance || uniqueInstances[0]?.compoundValue || uniqueInstances[0]?.name || '';

            let defaultInstance = rawDefault;
            let isMovieHunt = false;
            if (!isTVShow && rawDefault) {
                const matched = uniqueInstances.find(inst => inst.compoundValue === rawDefault || inst.name === rawDefault);
                if (matched) {
                    defaultInstance = matched.compoundValue || matched.name;
                    isMovieHunt = matched.appType === 'movie_hunt';
                }
            } else if (isTVShow && rawDefault) {
                const matched = uniqueInstances.find(inst => (inst.compoundValue || inst.name) === rawDefault || inst.name === rawDefault);
                if (matched) {
                    defaultInstance = matched.compoundValue || matched.name;
                    isMovieHunt = matched.appType === 'movie_hunt';
                }
            }
            const defaultDecoded = defaultInstance ? decodeInstanceValue(defaultInstance, isTVShow ? 'sonarr' : 'radarr') : {};
            const isTVHunt = isTVShow && defaultDecoded.appType === 'tv_hunt';

            console.log('[RequestarrModal] Resolved instance:', defaultInstance, 'isMovieHunt:', isMovieHunt, 'isTVHunt:', isTVHunt);

            if (instanceSelect) {
                instanceSelect.innerHTML = '';
                const instanceInfoIcon = document.getElementById('modal-instance-info-icon');
                if (instanceInfoIcon) instanceInfoIcon.style.display = 'none';
                if (uniqueInstances.length === 0) {
                    instanceSelect.innerHTML = '<option value="">No Instance Configured</option>';
                    instanceSelect.classList.add('field-warning');
                    this._showInstanceInfoIcon();
                } else {
                    instanceSelect.classList.remove('field-warning');
                    uniqueInstances.forEach(instance => {
                        const opt = document.createElement('option');
                        opt.value = instance.compoundValue || instance.name;
                        opt.textContent = instance.label || `${isTVShow ? (instance.appType === 'tv_hunt' ? 'TV Hunt' : 'Sonarr') : (instance.appType === 'movie_hunt' ? 'Movie Hunt' : 'Radarr')} \u2013 ${instance.name}`;
                        const isSelected = (instance.compoundValue || instance.name) === defaultInstance;
                        if (isSelected) opt.selected = true;
                        instanceSelect.appendChild(opt);
                    });
                    if (!defaultInstance && uniqueInstances.length > 0) {
                        instanceSelect.selectedIndex = 0;
                    }
                }
                instanceSelect.onchange = () => this.instanceChanged(instanceSelect.value);
            }

            const qualitySelect = document.getElementById('modal-quality-profile');
            const effectiveInstance = (instanceSelect && instanceSelect.value) ? instanceSelect.value : defaultInstance;
            if (qualitySelect) {
                const profDecoded = effectiveInstance ? decodeInstanceValue(effectiveInstance, isTVShow ? 'sonarr' : 'radarr') : {};
                const profileKey = `${profDecoded.appType || ''}-${profDecoded.name || ''}`;
                const profiles = this.core.qualityProfiles[profileKey] || [];
                const useHuntProfiles = isMovieHunt || isTVHunt;

                if (profiles.length === 0 && effectiveInstance) {
                    qualitySelect.innerHTML = '<option value="">Loading profiles...</option>';
                    this.core.loadQualityProfilesForInstance(profDecoded.appType, profDecoded.name).then(newProfiles => {
                        if (newProfiles && newProfiles.length > 0) {
                            this._populateQualityProfiles(qualitySelect, newProfiles, useHuntProfiles);
                        } else {
                            this._populateQualityProfiles(qualitySelect, [], useHuntProfiles);
                        }
                    });
                } else {
                    this._populateQualityProfiles(qualitySelect, profiles, useHuntProfiles);
                }
            }

            if (requestBtn) {
                requestBtn.disabled = false;
                requestBtn.classList.remove('disabled', 'success');
                requestBtn.textContent = 'Request';
            }
            this._applyMovieHuntModalMode(effectiveInstance, isTVShow, labelEl, requestBtn);

            if (defaultInstance) {
                if (statusContainer) {
                    statusContainer.innerHTML = '<span class="mh-req-badge mh-req-badge-loading"><i class="fas fa-spinner fa-spin"></i> Checking...</span>';
                }
                this.loadModalRootFolders(defaultInstance, isTVShow);
                if (isTVShow) {
                    this.loadSeriesStatus(defaultInstance);
                } else {
                    this.loadMovieStatus(defaultInstance);
                }
            } else {
                if (statusContainer) {
                    statusContainer.innerHTML = '';
                }
                const rootSelect = document.getElementById('modal-root-folder');
                if (rootSelect) {
                    rootSelect.innerHTML = '<option value="">Select an instance first</option>';
                    rootSelect.classList.remove('field-warning');
                }
            }

            if (uniqueInstances.length === 0 && requestBtn) {
                requestBtn.disabled = true;
                requestBtn.classList.add('disabled');
            }
        }

    async loadModalRootFolders(instanceName, isTVShow) {
        const rootSelect = document.getElementById('modal-root-folder');
        if (!rootSelect) return;

        if (this._loadingModalRootFolders) return;
        this._loadingModalRootFolders = true;

        // Decode compound value to get app type and actual name (both movies and TV support compound)
        const decoded = decodeInstanceValue(instanceName, isTVShow ? 'sonarr' : 'radarr');
        const appType = decoded.appType;
        const actualInstanceName = decoded.name;
        rootSelect.innerHTML = '<option value="">Loading...</option>';
        rootSelect.classList.remove('field-warning');
        const infoIcon = document.getElementById('modal-root-folder-info-icon');
        if (infoIcon) infoIcon.style.display = 'none';

        try {
            const response = await fetch(`./api/requestarr/rootfolders?app_type=${appType}&instance_name=${encodeURIComponent(actualInstanceName)}`);
            const data = await response.json();

            if (data.success && data.root_folders && data.root_folders.length > 0) {
                const seenPaths = new Map();
                data.root_folders.forEach(rf => {
                    if (!rf || !rf.path) return;
                    const originalPath = rf.path.trim();
                    const normalized = originalPath.replace(/\/+$/, '').toLowerCase();
                    if (!normalized) return;
                    if (!seenPaths.has(normalized)) {
                        seenPaths.set(normalized, { 
                            path: originalPath, 
                            freeSpace: rf.freeSpace,
                            isDefault: !!rf.is_default
                        });
                    }
                });

                if (seenPaths.size === 0) {
                    rootSelect.innerHTML = '<option value="">No Root Configured</option>';
                    rootSelect.classList.add('field-warning');
                    this._showRootFolderInfoIcon(instanceName, isTVShow);
                } else {
                    rootSelect.classList.remove('field-warning');
                    rootSelect.innerHTML = '';
                    let defaultFound = false;
                    let firstPath = null;
                    seenPaths.forEach(rf => {
                        const opt = document.createElement('option');
                        opt.value = rf.path;
                        opt.textContent = rf.path + (rf.freeSpace != null ? ` (${Math.round(rf.freeSpace / 1e9)} GB free)` : '');
                        if (rf.isDefault) {
                            opt.selected = true;
                            defaultFound = true;
                        }
                        if (!firstPath) firstPath = rf.path;
                        rootSelect.appendChild(opt);
                    });
                    if (!defaultFound && firstPath) {
                        rootSelect.value = firstPath;
                    }
                }
            } else {
                rootSelect.innerHTML = '<option value="">No Root Configured</option>';
                rootSelect.classList.add('field-warning');
                this._showRootFolderInfoIcon(instanceName, isTVShow);
            }
        } catch (error) {
            console.error('[RequestarrModal] Error loading root folders:', error);
            rootSelect.innerHTML = '<option value="">No Root Configured</option>';
            rootSelect.classList.add('field-warning');
            this._showRootFolderInfoIcon(instanceName, isTVShow);
        } finally {
            this._loadingModalRootFolders = false;
            this._updateRequestButtonFromRootFolder();
        }
    }

    /**
     * Show info icon when no instance configured; click navigates to Instances page.
     */
    _showInstanceInfoIcon() {
        const infoIcon = document.getElementById('modal-instance-info-icon');
        if (!infoIcon) return;
        infoIcon.style.display = '';
        const self = this;
        infoIcon.onclick = function(e) {
            e.preventDefault();
            self.closeModal();
            if (window.location.hash !== '#media-hunt-instances') {
                window.location.hash = '#media-hunt-instances';
            } else {
                window.dispatchEvent(new HashChangeEvent('hashchange'));
            }
        };
    }

    /**
     * Show info icon when no root configured; click navigates to Root Folders page with instance selected.
     */
    _showRootFolderInfoIcon(instanceName, isTVShow) {
        const decoded = decodeInstanceValue(instanceName, isTVShow ? 'sonarr' : 'radarr');
        const appType = decoded.appType || '';
        // Root Folders settings page only configures Movie Hunt and TV Hunt; hide icon for Sonarr/Radarr
        if (appType !== 'movie_hunt' && appType !== 'tv_hunt') return;
        const infoIcon = document.getElementById('modal-root-folder-info-icon');
        if (!infoIcon) return;
        infoIcon.style.display = '';
        const self = this;
        infoIcon.onclick = function(e) {
            e.preventDefault();
            const instanceSelect = document.getElementById('modal-instance-select');
            const compoundValue = (instanceSelect && instanceSelect.value) || instanceName || '';
            if (!compoundValue) return;
            const decoded = decodeInstanceValue(compoundValue, isTVShow ? 'sonarr' : 'radarr');
            try {
                sessionStorage.setItem('requestarr-goto-root-instance', JSON.stringify({
                    appType: decoded.appType || (isTVShow ? 'tv_hunt' : 'movie_hunt'),
                    instanceName: decoded.name || ''
                }));
            } catch (err) {}
            self.closeModal();
            if (window.location.hash !== '#settings-root-folders') {
                window.location.hash = '#settings-root-folders';
            } else {
                window.dispatchEvent(new HashChangeEvent('hashchange'));
            }
        };
    }

    /**
     * Disable Request button when no root folder is selected (user must pick a folder to request).
     */
    _updateRequestButtonFromRootFolder() {
        const requestBtn = document.getElementById('modal-request-btn');
        const rootSelect = document.getElementById('modal-root-folder');
        if (!requestBtn || !rootSelect) return;
        const noRootFolder = !rootSelect.value || rootSelect.value.trim() === '';
        const isCompleteOrInLibrary = requestBtn.textContent === 'Complete' || requestBtn.textContent === 'In Library' || requestBtn.textContent === 'Already in library';
        if (noRootFolder && !isCompleteOrInLibrary) {
            requestBtn.disabled = true;
            requestBtn.classList.add('disabled');
        } else if (!noRootFolder && (requestBtn.textContent === 'Request' || requestBtn.textContent === 'Add to Library')) {
            requestBtn.disabled = false;
            requestBtn.classList.remove('disabled');
        }
    }

    async loadSeriesStatus(instanceName) {
        if (!instanceName || !this.core.currentModalData) return;

        const container = document.getElementById('requestarr-modal-status-container');
        if (!container) return;

        container.innerHTML = '<span class="mh-req-badge mh-req-badge-loading"><i class="fas fa-spinner fa-spin"></i> Checking...</span>';

        const decoded = decodeInstanceValue(instanceName, 'sonarr');
        const isTVHunt = decoded.appType === 'tv_hunt';
        const addLabel = isTVHunt ? 'Add to Library' : 'Request';

        try {
            const response = await fetch(`./api/requestarr/series-status?tmdb_id=${this.core.currentModalData.tmdb_id}&instance=${encodeURIComponent(decoded.name)}&app_type=${encodeURIComponent(decoded.appType || 'sonarr')}`);
            const status = await response.json();
            const requestBtn = document.getElementById('modal-request-btn');

            if (status.exists) {
                const isComplete = status.missing_episodes === 0 && status.total_episodes > 0;
                // Sync discover card badge — show may have been added after the card rendered
                this._syncCardBadge(this.core.currentModalData.tmdb_id, isComplete, true);

                if (isComplete) {
                    container.innerHTML = `<span class="mh-req-badge mh-req-badge-lib"><i class="fas fa-check-circle"></i> Complete (${status.available_episodes}/${status.total_episodes} episodes)</span>`;
                    if (requestBtn) { requestBtn.disabled = true; requestBtn.classList.add('disabled'); requestBtn.textContent = 'Complete'; }
                    this._clearImportBanner();
                } else if (status.missing_episodes > 0) {
                    container.innerHTML = `<span class="mh-req-badge mh-req-badge-ok"><i class="fas fa-tv"></i> ${status.missing_episodes} missing episodes (${status.available_episodes}/${status.total_episodes})</span>`;
                    if (requestBtn) { requestBtn.disabled = false; requestBtn.classList.remove('disabled'); requestBtn.textContent = addLabel; }
                    this._updateRequestButtonFromRootFolder();
                    if (isTVHunt) this._checkForImport(instanceName);
                } else {
                    container.innerHTML = '<span class="mh-req-badge mh-req-badge-lib"><i class="fas fa-check-circle"></i> In Library</span>';
                    if (requestBtn) { requestBtn.disabled = true; requestBtn.classList.add('disabled'); requestBtn.textContent = 'In Library'; }
                    this._clearImportBanner();
                }
            } else {
                container.innerHTML = isTVHunt
                    ? '<span class="mh-req-badge mh-req-badge-ok"><i class="fas fa-check-circle"></i> Available to add</span>'
                    : '<span class="mh-req-badge mh-req-badge-ok"><i class="fas fa-check-circle"></i> Available to request</span>';
                if (requestBtn) { requestBtn.disabled = false; requestBtn.classList.remove('disabled'); requestBtn.textContent = addLabel; }
                this._updateRequestButtonFromRootFolder();
                // Check for importable files on disk for TV Hunt
                if (isTVHunt) this._checkForImport(instanceName);
            }
        } catch (error) {
            console.error('[RequestarrModal] Error loading series status:', error);
            container.innerHTML = isTVHunt
                ? '<span class="mh-req-badge mh-req-badge-ok"><i class="fas fa-check-circle"></i> Available to add</span>'
                : '<span class="mh-req-badge mh-req-badge-ok"><i class="fas fa-check-circle"></i> Available to request</span>';
        }
    }

    async loadMovieStatus(instanceName) {
        if (!instanceName || !this.core.currentModalData) return;

        const container = document.getElementById('requestarr-modal-status-container');
        if (!container) return;

        container.innerHTML = '<span class="mh-req-badge mh-req-badge-loading"><i class="fas fa-spinner fa-spin"></i> Checking...</span>';

        try {
            const decoded = decodeInstanceValue(instanceName);
            const isMovieHunt = decoded.appType === 'movie_hunt';
            const appTypeParam = isMovieHunt ? '&app_type=movie_hunt' : '';
            const response = await fetch(`./api/requestarr/movie-status?tmdb_id=${this.core.currentModalData.tmdb_id}&instance=${encodeURIComponent(decoded.name)}${appTypeParam}`);
            const status = await response.json();
            const requestBtn = document.getElementById('modal-request-btn');

            if (status.in_library) {
                container.innerHTML = '<span class="mh-req-badge mh-req-badge-lib"><i class="fas fa-check-circle"></i> Already in library</span>';
                if (requestBtn) { requestBtn.disabled = true; requestBtn.classList.add('disabled'); requestBtn.textContent = 'Already in library'; }
                this._syncCardBadge(this.core.currentModalData.tmdb_id, true);
                this._clearImportBanner();
            } else if (status.previously_requested) {
                container.innerHTML = isMovieHunt
                    ? '<span class="mh-req-badge mh-req-badge-warn"><i class="fas fa-clock"></i> Requested — waiting for download</span>'
                    : '<span class="mh-req-badge mh-req-badge-warn"><i class="fas fa-clock"></i> Previously requested</span>';
                if (requestBtn) {
                    requestBtn.disabled = false;
                    requestBtn.classList.remove('disabled');
                    requestBtn.textContent = isMovieHunt ? 'Add to Library' : 'Request';
                }
                this._updateRequestButtonFromRootFolder();
                this._syncCardBadge(this.core.currentModalData.tmdb_id, false, true);
                // Still check for importable files even if previously requested
                if (isMovieHunt) this._checkForImport(instanceName);
            } else {
                container.innerHTML = isMovieHunt
                    ? '<span class="mh-req-badge mh-req-badge-ok"><i class="fas fa-check-circle"></i> Available to add</span>'
                    : '<span class="mh-req-badge mh-req-badge-ok"><i class="fas fa-check-circle"></i> Available to request</span>';
                if (requestBtn) {
                    requestBtn.disabled = false;
                    requestBtn.classList.remove('disabled');
                    requestBtn.textContent = isMovieHunt ? 'Add to Library' : 'Request';
                }
                this._updateRequestButtonFromRootFolder();
                // Check for importable files on disk
                if (isMovieHunt) this._checkForImport(instanceName);
            }
        } catch (error) {
            console.error('[RequestarrModal] Error loading movie status:', error);
            const isMovieHunt = instanceName && decodeInstanceValue(instanceName).appType === 'movie_hunt';
            container.innerHTML = isMovieHunt
                ? '<span class="mh-req-badge mh-req-badge-ok"><i class="fas fa-check-circle"></i> Available to add</span>'
                : '<span class="mh-req-badge mh-req-badge-ok"><i class="fas fa-check-circle"></i> Available to request</span>';
            const requestBtn = document.getElementById('modal-request-btn');
            if (requestBtn) {
                requestBtn.disabled = false;
                requestBtn.classList.remove('disabled');
                requestBtn.textContent = isMovieHunt ? 'Add to Library' : 'Request';
            }
        }
    }

    // ========================================
    // IMPORT DETECTION
    // ========================================

    _clearImportBanner() {
        const existing = document.getElementById('modal-import-banner');
        if (existing) existing.remove();
        const actionsArea = document.querySelector('.mh-req-actions');
        if (actionsArea) actionsArea.classList.remove('import-available');
    }

    async _checkForImport(instanceName) {
        this._clearImportBanner();
        if (!this.core.currentModalData) return;

        const isTVShow = this.core.currentModalData.media_type === 'tv';
        const decoded = decodeInstanceValue(instanceName, isTVShow ? 'sonarr' : 'radarr');
        const isMovieHunt = decoded.appType === 'movie_hunt';
        const isTVHunt = decoded.appType === 'tv_hunt';
        if (!isMovieHunt && !isTVHunt) return;

        const tmdbId = this.core.currentModalData.tmdb_id;
        if (!tmdbId) return;

        // Resolve numeric instance ID from core.instances (backend expects integer)
        const instKey = isTVHunt ? 'tv_hunt' : 'movie_hunt';
        const instList = (this.core.instances && this.core.instances[instKey]) || [];
        const instObj = instList.find(i => i.name === decoded.name);
        const numericId = instObj ? instObj.id : '';

        const apiBase = isMovieHunt ? './api/movie-hunt/import-check' : './api/tv-hunt/import-check';

        try {
            const resp = await fetch(`${apiBase}?tmdb_id=${tmdbId}&instance_id=${encodeURIComponent(numericId)}`);
            const data = await resp.json();
            if (!data.found || !data.matches || data.matches.length === 0) return;

            const best = data.matches[0];
            this._showImportBanner(best, instanceName);
        } catch (err) {
            console.warn('[RequestarrModal] Import check failed:', err);
        }
    }

    _showImportBanner(match, instanceName) {
        this._clearImportBanner();

        const score = match.score;
        const sizeGB = match.media_info ? (match.media_info.total_size / 1e9).toFixed(1) : '?';
        const fileCount = match.media_info ? match.media_info.file_count : 0;
        const mainFile = match.media_info ? match.media_info.main_file : '';

        // Confidence label
        let confidenceClass, confidenceLabel;
        if (score >= 85) { confidenceClass = 'high'; confidenceLabel = 'High'; }
        else if (score >= 65) { confidenceClass = 'medium'; confidenceLabel = 'Medium'; }
        else { confidenceClass = 'low'; confidenceLabel = 'Low'; }

        // Swap status badge to amber warning
        const container = document.getElementById('requestarr-modal-status-container');
        if (container) {
            container.innerHTML = '<span class="mh-req-badge mh-req-badge-import"><i class="fas fa-exclamation-triangle"></i> Found on Disk</span>';
        }

        // Read current form selections for the settings summary
        const instanceSelect = document.getElementById('modal-instance-select');
        const rootSelect = document.getElementById('modal-root-folder');
        const qualitySelect = document.getElementById('modal-quality-profile');
        const instLabel = instanceSelect ? instanceSelect.options[instanceSelect.selectedIndex]?.text : '';
        const rootLabel = rootSelect ? rootSelect.value : '';
        const qualLabel = qualitySelect ? qualitySelect.options[qualitySelect.selectedIndex]?.text : '';

        const banner = document.createElement('div');
        banner.id = 'modal-import-banner';
        banner.className = 'modal-import-banner';
        banner.innerHTML =
            '<div class="import-banner-header">' +
                '<i class="fas fa-folder-open"></i>' +
                '<span>Existing files detected on disk</span>' +
                '<span class="import-confidence import-confidence-' + confidenceClass + '">' + score + '% ' + confidenceLabel + '</span>' +
            '</div>' +
            '<div class="import-banner-details">' +
                '<div class="import-banner-folder" title="' + this._escBannerAttr(match.folder_path) + '">' +
                    '<i class="fas fa-folder"></i> ' + this._escBannerHtml(match.folder_name) +
                '</div>' +
                '<div class="import-banner-meta">' +
                    (mainFile ? '<span title="' + this._escBannerAttr(mainFile) + '"><i class="fas fa-film"></i> ' + this._escBannerHtml(mainFile) + '</span>' : '') +
                    '<span><i class="fas fa-hdd"></i> ' + sizeGB + ' GB</span>' +
                    (fileCount > 1 ? '<span><i class="fas fa-copy"></i> ' + fileCount + ' files</span>' : '') +
                '</div>' +
            '</div>' +
            '<div class="import-banner-settings">' +
                (instLabel ? '<span><i class="fas fa-server"></i>' + this._escBannerHtml(instLabel) + '</span>' : '') +
                (rootLabel ? '<span><i class="fas fa-folder-open"></i>' + this._escBannerHtml(rootLabel) + '</span>' : '') +
                (qualLabel ? '<span><i class="fas fa-sliders-h"></i>' + this._escBannerHtml(qualLabel) + '</span>' : '') +
            '</div>' +
            '<button class="import-banner-btn" id="modal-import-instead-btn">' +
                '<i class="fas fa-download"></i> Import to Library' +
            '</button>';

        // Insert before the action buttons area
        const actionsArea = document.querySelector('.mh-req-actions');
        if (actionsArea) {
            actionsArea.parentNode.insertBefore(banner, actionsArea);
            actionsArea.classList.add('import-available');
        } else {
            // Fallback: insert at end of form column
            const formCol = document.querySelector('.mh-req-form');
            if (formCol) formCol.appendChild(banner);
        }

        // Wire up import button
        const importBtn = document.getElementById('modal-import-instead-btn');
        if (importBtn) {
            importBtn.onclick = () => this._doImportInstead(match, instanceName);
        }

        // Demote the Add to Library button to secondary
        const requestBtn = document.getElementById('modal-request-btn');
        if (requestBtn && !requestBtn.disabled) {
            requestBtn.textContent = 'Add as New';
        }

        // Update modal label to reflect import context
        const labelEl = document.getElementById('requestarr-modal-label');
        if (labelEl) labelEl.textContent = 'Import to Library';
    }

    async _doImportInstead(match, instanceName) {
        const importBtn = document.getElementById('modal-import-instead-btn');
        if (importBtn) {
            importBtn.disabled = true;
            importBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Importing...';
        }

        try {
            const data = this.core.currentModalData;
            const isTVShow = data.media_type === 'tv';
            const decoded = decodeInstanceValue(instanceName, isTVShow ? 'sonarr' : 'radarr');
            const isTVHunt = decoded.appType === 'tv_hunt';
            const confirmUrl = isTVHunt ? './api/tv-hunt/import-media/confirm' : './api/movie-hunt/import-media/confirm';

            // Read current form selections so import uses the same settings
            const rootSelect = document.getElementById('modal-root-folder');
            const qualitySelect = document.getElementById('modal-quality-profile');
            const monitorSelect = document.getElementById('modal-monitor');
            const rootFolder = (rootSelect && rootSelect.value) ? rootSelect.value : (match.root_folder || '');
            const qualityProfile = qualitySelect ? qualitySelect.value : '';
            const monitor = monitorSelect ? monitorSelect.value : '';

            const body = {
                folder_path: match.folder_path,
                tmdb_id: data.tmdb_id,
                title: data.title || data.name || '',
                year: String(data.year || ''),
                poster_path: data.poster_path || '',
                root_folder: rootFolder,
                instance_id: decoded.name,
                quality_profile: qualityProfile,
                monitor: monitor,
            };
            // TV confirm expects 'name' field
            if (isTVHunt) {
                body.name = data.title || data.name || '';
                body.first_air_date = data.first_air_date || '';
            }

            const resp = await fetch(confirmUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const result = await resp.json();

            if (result.success) {
                if (importBtn) {
                    importBtn.innerHTML = '<i class="fas fa-check"></i> Imported';
                    importBtn.classList.add('success');
                }
                this.core.showNotification(result.message || 'Imported successfully', 'success');

                // Update status badge and card
                const container = document.getElementById('requestarr-modal-status-container');
                if (container) {
                    container.innerHTML = '<span class="mh-req-badge mh-req-badge-lib"><i class="fas fa-check-circle"></i> Already in library</span>';
                }
                const requestBtn = document.getElementById('modal-request-btn');
                if (requestBtn) {
                    requestBtn.disabled = true;
                    requestBtn.classList.add('disabled');
                    requestBtn.textContent = 'Already in library';
                }
                this._syncCardBadge(data.tmdb_id, true);

                // Notify detail page
                window.dispatchEvent(new CustomEvent('requestarr-request-success', {
                    detail: { tmdbId: data.tmdb_id, mediaType: isTVHunt ? 'tv' : 'movie', appType: decoded.appType, instanceName: decoded.name }
                }));

                setTimeout(() => this.closeModal(), 2000);
            } else {
                if (importBtn) {
                    importBtn.disabled = false;
                    importBtn.innerHTML = '<i class="fas fa-download"></i> Import Instead';
                }
                this.core.showNotification(result.message || 'Import failed', 'error');
            }
        } catch (err) {
            console.error('[RequestarrModal] Import error:', err);
            if (importBtn) {
                importBtn.disabled = false;
                importBtn.innerHTML = '<i class="fas fa-download"></i> Import Instead';
            }
            this.core.showNotification('Import failed: ' + (err.message || 'Unknown error'), 'error');
        }
    }

    _escBannerHtml(s) {
        if (!s) return '';
        const d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    }

    _escBannerAttr(s) {
        if (!s) return '';
        return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    /**
     * When selected instance is Movie Hunt or TV Hunt, show "Add to Library" and
     * the Start search checkbox + relevant fields. Otherwise "Request Movie" / "Request".
     */
    _applyMovieHuntModalMode(instanceValue, isTVShow, labelEl, requestBtn) {
        const wrapMin = document.getElementById('requestarr-modal-min-availability-wrap');
        const wrapStart = document.getElementById('requestarr-modal-start-search-wrap');
        const wrapMonitor = document.getElementById('requestarr-modal-monitor-wrap');
        const wrapMovieMonitor = document.getElementById('requestarr-modal-movie-monitor-wrap');
        const minSelect = document.getElementById('modal-minimum-availability');
        const startCb = document.getElementById('modal-start-search');
        const startLabel = wrapStart ? wrapStart.querySelector('span') : null;
        const decoded = instanceValue ? decodeInstanceValue(instanceValue, isTVShow ? 'sonarr' : 'radarr') : {};
        const isMovieHunt = !isTVShow && decoded.appType === 'movie_hunt';
        const isTVHunt = isTVShow && decoded.appType === 'tv_hunt';
        const isHuntInstance = isMovieHunt || isTVHunt;
        // Use class toggle — .mh-req-field has display:grid!important which overrides inline styles
        if (wrapMin) wrapMin.classList.toggle('mh-hidden', !isMovieHunt);
        if (wrapStart) wrapStart.classList.toggle('mh-hidden', !isHuntInstance);
        if (wrapMonitor) wrapMonitor.classList.toggle('mh-hidden', !isTVHunt);
        if (wrapMovieMonitor) wrapMovieMonitor.classList.toggle('mh-hidden', !isMovieHunt);
        
        // Update search label text for context
        if (startLabel) startLabel.textContent = isTVHunt ? 'Start search for missing episodes' : 'Start search for missing movie';
        
        // Use loaded preferences or defaults
        if (minSelect) minSelect.value = this.preferences?.minimum_availability || 'released';
        if (startCb) startCb.checked = this.preferences?.hasOwnProperty('start_search') ? this.preferences.start_search : true;
        
        if (labelEl) labelEl.textContent = isHuntInstance ? 'Add to Library' : (isTVShow ? 'Request Series' : 'Request Movie');
        if (requestBtn && !requestBtn.disabled) requestBtn.textContent = isHuntInstance ? 'Add to Library' : 'Request';
    }

    instanceChanged(instanceName) {
        this._clearImportBanner();
        const isTVShow = this.core.currentModalData.media_type === 'tv';

        // Save to server modal preferences
        if (isTVShow) {
            this.saveModalPreferences({ tv_instance: instanceName });
        } else {
            this.saveModalPreferences({ movie_instance: instanceName });
        }
        console.log('[RequestarrModal] Instance changed to:', instanceName);

        const labelEl = document.getElementById('requestarr-modal-label');
        const requestBtn = document.getElementById('modal-request-btn');
        this._applyMovieHuntModalMode(instanceName, isTVShow, labelEl, requestBtn);

        // Reload root folders
        this.loadModalRootFolders(instanceName, isTVShow);

        // Update quality profile dropdown
        const qualitySelect = document.getElementById('modal-quality-profile');
        if (qualitySelect) {
            const decoded = decodeInstanceValue(instanceName, isTVShow ? 'sonarr' : 'radarr');
            const profileKey = `${decoded.appType}-${decoded.name}`;
            const useHuntProfiles = decoded.appType === 'movie_hunt' || decoded.appType === 'tv_hunt';
            const profiles = this.core.qualityProfiles[profileKey] || [];

            if (profiles.length === 0 && instanceName) {
                qualitySelect.innerHTML = '<option value="">Loading profiles...</option>';
                this.core.loadQualityProfilesForInstance(decoded.appType, decoded.name).then(newProfiles => {
                    if (newProfiles && newProfiles.length > 0) {
                        this._populateQualityProfiles(qualitySelect, newProfiles, useHuntProfiles);
                    } else {
                        this._populateQualityProfiles(qualitySelect, [], useHuntProfiles);
                    }
                });
            } else {
                this._populateQualityProfiles(qualitySelect, profiles, useHuntProfiles);
            }
        }

        // Reload status
        if (isTVShow) {
            this.loadSeriesStatus(instanceName);
        } else {
            this.loadMovieStatus(instanceName);
        }
    }

    /**
     * Populate a quality profile dropdown, handling Movie Hunt vs Radarr/Sonarr differences.
     * Movie Hunt: no "Any" placeholder, pre-select the default profile.
     * Radarr/Sonarr: show "Any (Default)" as first option, no pre-selection.
     */
    _populateQualityProfiles(selectEl, profiles, isMovieHunt) {
        selectEl.innerHTML = '';
        
        if (isMovieHunt) {
            // Movie Hunt: list only real profiles, pre-select the default
            if (profiles.length === 0) {
                selectEl.innerHTML = '<option value="">No profiles configured</option>';
                return;
            }
            let defaultIdx = profiles.findIndex(p => p.is_default);
            if (defaultIdx === -1) defaultIdx = 0; // fallback to first
            
            profiles.forEach((profile, idx) => {
                const opt = document.createElement('option');
                opt.value = profile.id;
                opt.textContent = profile.name;
                if (idx === defaultIdx) opt.selected = true;
                selectEl.appendChild(opt);
            });
        } else {
            // Radarr / Sonarr: "Any (Default)" placeholder, then real profiles
            selectEl.innerHTML = '<option value="">Any (Default)</option>';
            profiles.forEach(profile => {
                if (profile.name.toLowerCase() !== 'any') {
                    const opt = document.createElement('option');
                    opt.value = profile.id;
                    opt.textContent = profile.name;
                    selectEl.appendChild(opt);
                }
            });
        }
    }

    async submitRequest() {
            const isOwner = window._huntarrUserRole === 'owner';
            const perms = window._huntarrUserPermissions || {};
            const requestBtn = document.getElementById('modal-request-btn');
            const instanceSelect = document.getElementById('modal-instance-select');

            if (!this.core.currentModalData) {
                this.core.showNotification('No media data available', 'error');
                return;
            }

            const isTVShow = this.core.currentModalData.media_type === 'tv';

            // Both owner and non-owner read instance from the dropdown (non-owner has it greyed out)
            if (!instanceSelect || !instanceSelect.value) {
                this.core.showNotification('No instance available for this request', 'error');
                return;
            }

            try {
                const decoded = decodeInstanceValue(instanceSelect.value, isTVShow ? 'sonarr' : 'radarr');
                const instanceName = decoded.name;
                const appType = decoded.appType;
                const isHuntApp = appType === 'movie_hunt' || appType === 'tv_hunt';

                // Determine if this user has auto-approve (owners always do)
                const hasAutoApprove = isOwner || (isTVShow
                    ? (perms.auto_approve || perms.auto_approve_tv)
                    : (perms.auto_approve || perms.auto_approve_movies));

                if (requestBtn) {
                    requestBtn.disabled = true;
                    requestBtn.classList.add('pressed');
                    requestBtn.textContent = hasAutoApprove
                        ? (isHuntApp ? 'Adding...' : 'Requesting...')
                        : 'Submitting...';
                }

                // ── Non-auto-approve path: only create a pending request record ──
                if (!hasAutoApprove) {
                    const trackResp = await fetch('./api/requestarr/requests', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            media_type: isTVShow ? 'tv' : 'movie',
                            tmdb_id: this.core.currentModalData.tmdb_id,
                            title: this.core.currentModalData.title || '',
                            year: String(this.core.currentModalData.year || ''),
                            poster_path: this.core.currentModalData.poster_path || '',
                            instance_name: instanceName,
                            app_type: appType,
                        })
                    });
                    const trackResult = await trackResp.json();

                    if (trackResp.ok && (trackResult.success || trackResult.request)) {
                        if (requestBtn) {
                            requestBtn.textContent = 'Submitted \u2713';
                            requestBtn.classList.add('success');
                        }
                        this.core.showNotification('Request submitted — awaiting owner approval.', 'success');

                        const tmdbId = this.core.currentModalData.tmdb_id;
                        const mediaType = this.core.currentModalData.media_type;
                        this._syncCardBadge(tmdbId, false, false, true);
                        window.dispatchEvent(new CustomEvent('requestarr-request-success', {
                            detail: { tmdbId, mediaType, appType, instanceName }
                        }));
                        if (window.huntarrUI && typeof window.huntarrUI._updatePendingRequestBadge === 'function') {
                            window.huntarrUI._updatePendingRequestBadge();
                        }
                        setTimeout(() => this.closeModal(), 2000);
                    } else {
                        const errorMsg = trackResult.error || trackResult.message || 'Failed to submit request';
                        this.core.showNotification(errorMsg, 'error');
                        if (requestBtn) {
                            requestBtn.disabled = false;
                            requestBtn.classList.remove('success', 'pressed');
                            requestBtn.textContent = 'Request';
                        }
                    }
                    return;
                }

                // ── Auto-approve / owner path: trigger the search pipeline ──
                const requestData = {
                    tmdb_id: this.core.currentModalData.tmdb_id,
                    media_type: this.core.currentModalData.media_type,
                    title: this.core.currentModalData.title,
                    year: this.core.currentModalData.year,
                    overview: this.core.currentModalData.overview || '',
                    poster_path: this.core.currentModalData.poster_path || '',
                    backdrop_path: this.core.currentModalData.backdrop_path || '',
                    instance: instanceName,
                    app_type: appType,
                };

                if (isOwner) {
                    // Owner sends full form data
                    const qualityProfileEl = document.getElementById('modal-quality-profile');
                    const rootFolderSelect = document.getElementById('modal-root-folder');
                    requestData.root_folder_path = (rootFolderSelect && rootFolderSelect.value) ? rootFolderSelect.value : undefined;
                    requestData.quality_profile = qualityProfileEl ? qualityProfileEl.value : '';
                    if (appType === 'movie_hunt') {
                        const startCb = document.getElementById('modal-start-search');
                        const minSelect = document.getElementById('modal-minimum-availability');
                        const movieMonitorSelect = document.getElementById('modal-movie-monitor');
                        requestData.start_search = startCb ? startCb.checked : true;
                        requestData.minimum_availability = (minSelect && minSelect.value) ? minSelect.value : 'released';
                        requestData.movie_monitor = (movieMonitorSelect && movieMonitorSelect.value) ? movieMonitorSelect.value : 'movie_only';
                    }
                    if (appType === 'tv_hunt') {
                        const monitorSelect = document.getElementById('modal-monitor');
                        const startCbTV = document.getElementById('modal-start-search');
                        requestData.monitor = (monitorSelect && monitorSelect.value) ? monitorSelect.value : 'all_episodes';
                        requestData.start_search = startCbTV ? startCbTV.checked : true;
                    }
                } else {
                    // Non-owner with auto-approve: sensible defaults
                    if (appType === 'movie_hunt') {
                        requestData.start_search = true;
                        requestData.minimum_availability = 'released';
                        requestData.movie_monitor = 'movie_only';
                    } else if (appType === 'tv_hunt') {
                        requestData.start_search = true;
                        requestData.monitor = 'all_episodes';
                    }
                }

                const response = await fetch('./api/requestarr/request', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(requestData)
                });

                const result = await response.json();

                if (result.success) {
                    if (requestBtn) {
                        requestBtn.textContent = isHuntApp ? 'Added \u2713' : 'Requested \u2713';
                        requestBtn.classList.add('success');
                    }

                    const successMsg = result.message || (isHuntApp ? 'Successfully added to library.' : `${isTVShow ? 'Series' : 'Movie'} requested successfully!`);
                    this.core.showNotification(successMsg, 'success');

                    // Create a request tracking record
                    try {
                        await fetch('./api/requestarr/requests', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                media_type: isTVShow ? 'tv' : 'movie',
                                tmdb_id: this.core.currentModalData.tmdb_id,
                                title: this.core.currentModalData.title || '',
                                year: String(this.core.currentModalData.year || ''),
                                poster_path: this.core.currentModalData.poster_path || '',
                                instance_name: instanceName,
                                app_type: appType,
                            })
                        });
                    } catch (trackErr) {
                        console.debug('[RequestarrModal] Request tracking record skipped:', trackErr);
                    }

                    const tmdbId = this.core.currentModalData.tmdb_id;
                    const mediaType = this.core.currentModalData.media_type;
                    this._syncCardBadge(tmdbId, false, true);

                    window.dispatchEvent(new CustomEvent('requestarr-request-success', {
                        detail: { tmdbId, mediaType, appType, instanceName }
                    }));

                    if (window.huntarrUI && typeof window.huntarrUI._updatePendingRequestBadge === 'function') {
                        window.huntarrUI._updatePendingRequestBadge();
                    }

                    setTimeout(() => { this._refreshCardStatusFromAPI(tmdbId); }, 3000);
                    setTimeout(() => { this._refreshCardStatusFromAPI(tmdbId); }, 8000);
                    setTimeout(() => this.closeModal(), 2000);
                } else {
                    const errorMsg = result.message || result.error || 'Request failed';
                    this.core.showNotification(errorMsg, 'error');
                    if (requestBtn) {
                        requestBtn.disabled = false;
                        requestBtn.classList.remove('success');
                        requestBtn.textContent = isHuntApp ? 'Add to Library' : 'Request';
                    }
                }
            } catch (error) {
                console.error('[RequestarrModal] Error submitting request:', error);
                this.core.showNotification(error.message || 'Request failed', 'error');
                if (requestBtn) {
                    requestBtn.disabled = false;
                    requestBtn.classList.remove('success');
                    requestBtn.textContent = 'Request';
                }
            }
        }

    /**
     * Sync Discover card badges to match the real status.
     * Called when the modal detects "Already in library", "Previously requested",
     * or after a successful request.
     *
     * @param {number|string} tmdbId
     * @param {boolean} inLibrary  - Movie is downloaded / fully available
     * @param {boolean} requested  - Movie is requested but not yet downloaded
     * @param {boolean} pending    - Request is pending approval (non-auto-approve user)
     */
    _syncCardBadge(tmdbId, inLibrary, requested, pending) {
        const cards = document.querySelectorAll(`.media-card[data-tmdb-id="${tmdbId}"]`);
        cards.forEach((card) => {
            const badge = card.querySelector('.media-card-status-badge');
            if (badge) {
                if (inLibrary) {
                    badge.className = 'media-card-status-badge complete';
                    badge.innerHTML = '<i class="fas fa-check"></i>';
                    card.classList.add('in-library');
                } else if (pending) {
                    badge.className = 'media-card-status-badge pending';
                    badge.innerHTML = '<i class="fas fa-clock"></i>';
                    // Do NOT add in-library class — pending is not in collection
                } else if (requested) {
                    badge.className = 'media-card-status-badge partial';
                    badge.innerHTML = '<i class="fas fa-bookmark"></i>';
                    card.classList.add('in-library');
                }
            }
            // If now in collection (either state), swap eye-slash → trash
            if (inLibrary || requested) {
                const hideBtn = card.querySelector('.media-card-hide-btn');
                if (hideBtn) {
                    hideBtn.className = 'media-card-delete-btn';
                    hideBtn.title = 'Remove / Delete';
                    hideBtn.innerHTML = '<i class="fas fa-trash-alt"></i>';
                }
                const requestBtn = card.querySelector('.media-card-request-btn');
                if (requestBtn) requestBtn.remove();
            }
        });
    }

    /**
     * After a delay, re-check the actual library status from the API and sync card badges.
     * Uses the currently selected instance so the backend knows which collection to check.
     */
    async _refreshCardStatusFromAPI(tmdbId) {
        try {
            const instanceSelect = document.getElementById('modal-instance-select');
            const instanceValue = instanceSelect ? instanceSelect.value : '';
            if (!instanceValue) return;

            const decoded = decodeInstanceValue(instanceValue);
            const appTypeParam = decoded.appType === 'movie_hunt' ? '&app_type=movie_hunt' : '';
            const resp = await fetch(`./api/requestarr/movie-status?tmdb_id=${tmdbId}&instance=${encodeURIComponent(decoded.name)}${appTypeParam}`);
            const data = await resp.json();

            this._syncCardBadge(tmdbId, data.in_library || false, data.previously_requested || false);
        } catch (err) {
            console.warn('[RequestarrModal] Failed to refresh card status from API:', err);
        }
    }

    closeModal() {
            const modal = document.getElementById('media-modal');
            if (modal) modal.style.display = 'none';
            this.core.currentModalData = null;
            this._clearImportBanner();
            // Reset fields visibility and instance select state for next open
            const fieldsContainer = document.querySelector('.mh-req-fields');
            if (fieldsContainer) fieldsContainer.style.display = '';
            const rootField = document.getElementById('modal-root-folder');
            const qualityField = document.getElementById('modal-quality-profile');
            if (rootField && rootField.closest('.mh-req-field')) rootField.closest('.mh-req-field').classList.remove('mh-hidden');
            if (qualityField && qualityField.closest('.mh-req-field')) qualityField.closest('.mh-req-field').classList.remove('mh-hidden');
            const instanceSelect = document.getElementById('modal-instance-select');
            if (instanceSelect) {
                instanceSelect.disabled = false;
                instanceSelect.style.opacity = '';
            }
            // Remove permissions row added by non-owner modal
            const permRow = document.getElementById('requestarr-modal-permissions-row');
            if (permRow) permRow.remove();
            // Reset actions margin
            const actionsArea = document.querySelector('.mh-req-actions');
            if (actionsArea) actionsArea.style.marginTop = '';
            document.body.classList.remove('requestarr-modal-open');
        }
}
