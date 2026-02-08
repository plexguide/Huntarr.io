/**
 * Requestarr Modal - Two-column poster + form layout (matches Movie Hunt design)
 */

export class RequestarrModal {
    constructor(core) {
        this.core = core;
    }
    
    formatCooldownTime(hours_remaining) {
        if (hours_remaining <= 24) {
            const hours = Math.floor(hours_remaining);
            const minutes = Math.floor((hours_remaining - hours) * 60);
            return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
        } else {
            const days = Math.floor(hours_remaining / 24);
            const remaining_hours = hours_remaining - (days * 24);
            const hours = Math.floor(remaining_hours);
            const minutes = Math.floor((remaining_hours - hours) * 60);
            return `${days}d ${hours}h ${minutes}m`;
        }
    }

    // ========================================
    // MODAL SYSTEM
    // ========================================

    async openModal(tmdbId, mediaType, suggestedInstance = null) {
        const modal = document.getElementById('media-modal');
        if (!modal) return;

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
        if (labelEl) labelEl.textContent = mediaType === 'tv' ? 'Request Series' : 'Request Movie';
        if (metaEl) metaEl.textContent = '';
        if (statusContainer) statusContainer.innerHTML = '<span class="mh-req-badge mh-req-badge-loading"><i class="fas fa-spinner fa-spin"></i> Loading...</span>';
        if (posterImg) posterImg.src = './static/images/blackout.jpg';
        if (requestBtn) { requestBtn.disabled = true; requestBtn.textContent = 'Request'; requestBtn.classList.remove('disabled', 'success'); }
        if (instanceSelect) instanceSelect.innerHTML = '<option value="">Loading...</option>';
        if (rootSelect) rootSelect.innerHTML = '<option value="">Loading...</option>';
        if (qualitySelect) qualitySelect.innerHTML = '<option value="">Loading...</option>';

        // Attach close handlers (use .onclick to avoid stacking)
        const self = this;
        const backdrop = document.getElementById('requestarr-modal-backdrop');
        const closeBtn = document.getElementById('requestarr-modal-close');
        const cancelBtn = document.getElementById('requestarr-modal-cancel');

        if (backdrop) backdrop.onclick = () => self.closeModal();
        if (closeBtn) closeBtn.onclick = () => self.closeModal();
        if (cancelBtn) cancelBtn.onclick = () => self.closeModal();
        if (requestBtn) requestBtn.onclick = () => self.submitRequest();

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

    renderModal(data) {
        const isTVShow = data.media_type === 'tv';
        const instances = isTVShow ? this.core.instances.sonarr : this.core.instances.radarr;

        // Deduplicate instances by name
        const uniqueInstances = instances.reduce((acc, instance) => {
            if (!acc.find(i => i.name === instance.name)) acc.push(instance);
            return acc;
        }, []);

        const currentlySelectedInstance = isTVShow ? this.core.content.selectedTVInstance : this.core.content.selectedMovieInstance;
        const defaultInstance = this.suggestedInstance || currentlySelectedInstance || uniqueInstances[0]?.name || '';

        console.log('[RequestarrModal] Default instance:', defaultInstance);

        // Populate poster
        const posterImg = document.getElementById('requestarr-modal-poster-img');
        if (posterImg) {
            posterImg.src = data.poster_path || './static/images/blackout.jpg';
        }

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

        // Populate instance dropdown
        const instanceSelect = document.getElementById('modal-instance-select');
        if (instanceSelect) {
            instanceSelect.innerHTML = '';
            if (uniqueInstances.length === 0) {
                instanceSelect.innerHTML = '<option value="">No Instance Configured</option>';
            } else {
                uniqueInstances.forEach(instance => {
                    const opt = document.createElement('option');
                    opt.value = instance.name;
                    opt.textContent = `${isTVShow ? 'Sonarr' : 'Radarr'} \u2013 ${instance.name}`;
                    if (instance.name === defaultInstance) opt.selected = true;
                    instanceSelect.appendChild(opt);
                });
            }
            // Attach change handler
            instanceSelect.onchange = () => this.instanceChanged(instanceSelect.value);
        }

        // Populate quality profile dropdown
        const qualitySelect = document.getElementById('modal-quality-profile');
        if (qualitySelect) {
            const profileKey = `${isTVShow ? 'sonarr' : 'radarr'}-${defaultInstance}`;
            const profiles = this.core.qualityProfiles[profileKey] || [];
            qualitySelect.innerHTML = '<option value="">Any (Default)</option>';
            profiles.forEach(profile => {
                if (profile.name.toLowerCase() !== 'any') {
                    const opt = document.createElement('option');
                    opt.value = profile.id;
                    opt.textContent = profile.name;
                    qualitySelect.appendChild(opt);
                }
            });
        }

        // Set status to checking
        const statusContainer = document.getElementById('requestarr-modal-status-container');
        if (statusContainer) {
            statusContainer.innerHTML = '<span class="mh-req-badge mh-req-badge-loading"><i class="fas fa-spinner fa-spin"></i> Checking...</span>';
        }

        // Reset request button
        const requestBtn = document.getElementById('modal-request-btn');
        if (requestBtn) {
            requestBtn.disabled = false;
            requestBtn.classList.remove('disabled', 'success');
            requestBtn.textContent = 'Request';
        }

        // Load root folders for selected instance
        if (defaultInstance) {
            this.loadModalRootFolders(defaultInstance, isTVShow);
        } else {
            const rootSelect = document.getElementById('modal-root-folder');
            if (rootSelect) rootSelect.innerHTML = '<option value="">Select an instance first</option>';
        }

        // Load status
        if (defaultInstance) {
            if (isTVShow) {
                this.loadSeriesStatus(defaultInstance);
            } else {
                this.loadMovieStatus(defaultInstance);
            }
        }

        // Disable request button if no instances configured
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

        const appType = isTVShow ? 'sonarr' : 'radarr';
        rootSelect.innerHTML = '<option value="">Loading...</option>';

        try {
            const response = await fetch(`./api/requestarr/rootfolders?app_type=${appType}&instance_name=${encodeURIComponent(instanceName)}`);
            const data = await response.json();

            if (data.success && data.root_folders && data.root_folders.length > 0) {
                const seenPaths = new Map();
                data.root_folders.forEach(rf => {
                    if (!rf || !rf.path) return;
                    const originalPath = rf.path.trim();
                    const normalized = originalPath.replace(/\/+$/, '').toLowerCase();
                    if (!normalized) return;
                    if (!seenPaths.has(normalized)) {
                        seenPaths.set(normalized, { path: originalPath, freeSpace: rf.freeSpace });
                    }
                });

                if (seenPaths.size === 0) {
                    rootSelect.innerHTML = '<option value="">Use default (first root folder)</option>';
                } else {
                    rootSelect.innerHTML = '';
                    seenPaths.forEach(rf => {
                        const opt = document.createElement('option');
                        opt.value = rf.path;
                        opt.textContent = rf.path + (rf.freeSpace != null ? ` (${Math.round(rf.freeSpace / 1e9)} GB free)` : '');
                        rootSelect.appendChild(opt);
                    });
                }
            } else {
                rootSelect.innerHTML = '<option value="">Use default (first root folder)</option>';
            }
        } catch (error) {
            console.error('[RequestarrModal] Error loading root folders:', error);
            rootSelect.innerHTML = '<option value="">Use default (first root folder)</option>';
        } finally {
            this._loadingModalRootFolders = false;
        }
    }

    async checkRequestedSeasons(tmdbId, instanceName) {
        try {
            const response = await fetch(`./api/requestarr/check-seasons?tmdb_id=${tmdbId}&instance=${instanceName}`);
            const data = await response.json();
            return data.requested_seasons || [];
        } catch (error) {
            console.error('[RequestarrModal] Error checking seasons:', error);
            return [];
        }
    }

    async loadSeriesStatus(instanceName) {
        if (!instanceName || !this.core.currentModalData) return;

        const container = document.getElementById('requestarr-modal-status-container');
        if (!container) return;

        container.innerHTML = '<span class="mh-req-badge mh-req-badge-loading"><i class="fas fa-spinner fa-spin"></i> Checking...</span>';

        try {
            const response = await fetch(`./api/requestarr/series-status?tmdb_id=${this.core.currentModalData.tmdb_id}&instance=${encodeURIComponent(instanceName)}`);
            const status = await response.json();
            const requestBtn = document.getElementById('modal-request-btn');

            if (status.exists) {
                if (status.cooldown_status && status.cooldown_status.in_cooldown) {
                    const timeMsg = this.formatCooldownTime(status.cooldown_status.hours_remaining);
                    container.innerHTML = `<span class="mh-req-badge mh-req-badge-cooldown"><i class="fas fa-clock"></i> Cooldown \u2013 wait ${timeMsg}</span>`;
                    if (requestBtn) { requestBtn.disabled = true; requestBtn.classList.add('disabled'); requestBtn.textContent = `Wait ${timeMsg}`; }
                } else if (status.missing_episodes === 0 && status.total_episodes > 0) {
                    container.innerHTML = `<span class="mh-req-badge mh-req-badge-lib"><i class="fas fa-check-circle"></i> Complete (${status.available_episodes}/${status.total_episodes} episodes)</span>`;
                    if (requestBtn) { requestBtn.disabled = true; requestBtn.classList.add('disabled'); requestBtn.textContent = 'Complete'; }
                } else if (status.missing_episodes > 0) {
                    container.innerHTML = `<span class="mh-req-badge mh-req-badge-ok"><i class="fas fa-tv"></i> ${status.missing_episodes} missing episodes (${status.available_episodes}/${status.total_episodes})</span>`;
                    if (requestBtn) { requestBtn.disabled = false; requestBtn.classList.remove('disabled'); requestBtn.textContent = 'Request'; }
                } else {
                    container.innerHTML = '<span class="mh-req-badge mh-req-badge-lib"><i class="fas fa-check-circle"></i> In Library</span>';
                    if (requestBtn) { requestBtn.disabled = true; requestBtn.classList.add('disabled'); requestBtn.textContent = 'In Library'; }
                }
            } else {
                container.innerHTML = '<span class="mh-req-badge mh-req-badge-ok"><i class="fas fa-check-circle"></i> Available to request</span>';
                if (requestBtn) { requestBtn.disabled = false; requestBtn.classList.remove('disabled'); requestBtn.textContent = 'Request'; }
            }
        } catch (error) {
            console.error('[RequestarrModal] Error loading series status:', error);
            container.innerHTML = '<span class="mh-req-badge mh-req-badge-ok"><i class="fas fa-check-circle"></i> Available to request</span>';
        }
    }

    async loadMovieStatus(instanceName) {
        if (!instanceName || !this.core.currentModalData) return;

        const container = document.getElementById('requestarr-modal-status-container');
        if (!container) return;

        container.innerHTML = '<span class="mh-req-badge mh-req-badge-loading"><i class="fas fa-spinner fa-spin"></i> Checking...</span>';

        try {
            const response = await fetch(`./api/requestarr/movie-status?tmdb_id=${this.core.currentModalData.tmdb_id}&instance=${encodeURIComponent(instanceName)}`);
            const status = await response.json();
            const requestBtn = document.getElementById('modal-request-btn');

            if (status.in_library) {
                container.innerHTML = '<span class="mh-req-badge mh-req-badge-lib"><i class="fas fa-check-circle"></i> Already in library</span>';
                if (requestBtn) { requestBtn.disabled = true; requestBtn.classList.add('disabled'); requestBtn.textContent = 'In Library'; }
            } else if (status.cooldown_status && status.cooldown_status.in_cooldown) {
                const timeMsg = this.formatCooldownTime(status.cooldown_status.hours_remaining);
                container.innerHTML = `<span class="mh-req-badge mh-req-badge-cooldown"><i class="fas fa-clock"></i> Cooldown \u2013 wait ${timeMsg}</span>`;
                if (requestBtn) { requestBtn.disabled = true; requestBtn.classList.add('disabled'); requestBtn.textContent = `Wait ${timeMsg}`; }
            } else {
                container.innerHTML = '<span class="mh-req-badge mh-req-badge-ok"><i class="fas fa-check-circle"></i> Available to request</span>';
                if (requestBtn) { requestBtn.disabled = false; requestBtn.classList.remove('disabled'); requestBtn.textContent = 'Request'; }
            }
        } catch (error) {
            console.error('[RequestarrModal] Error loading movie status:', error);
            container.innerHTML = '<span class="mh-req-badge mh-req-badge-ok"><i class="fas fa-check-circle"></i> Available to request</span>';
            const requestBtn = document.getElementById('modal-request-btn');
            if (requestBtn) { requestBtn.disabled = false; requestBtn.classList.remove('disabled'); requestBtn.textContent = 'Request'; }
        }
    }

    instanceChanged(instanceName) {
        const isTVShow = this.core.currentModalData.media_type === 'tv';
        const instanceKey = isTVShow ? 'sonarr' : 'radarr';

        localStorage.setItem(`huntarr-requestarr-instance-${instanceKey}`, instanceName);
        console.log('[RequestarrModal] Instance changed to:', instanceName);

        // Reload root folders
        this.loadModalRootFolders(instanceName, isTVShow);

        // Update quality profile dropdown
        const appType = isTVShow ? 'sonarr' : 'radarr';
        const profileKey = `${appType}-${instanceName}`;
        const profiles = this.core.qualityProfiles[profileKey] || [];
        const qualitySelect = document.getElementById('modal-quality-profile');

        if (qualitySelect) {
            qualitySelect.innerHTML = '<option value="">Any (Default)</option>';
            profiles.forEach(profile => {
                if (profile.name.toLowerCase() !== 'any') {
                    const option = document.createElement('option');
                    option.value = profile.id;
                    option.textContent = profile.name;
                    qualitySelect.appendChild(option);
                }
            });
        }

        // Reload status
        if (isTVShow) {
            this.loadSeriesStatus(instanceName);
        } else {
            this.loadMovieStatus(instanceName);
        }
    }

    async submitRequest() {
        const instanceSelect = document.getElementById('modal-instance-select');
        const qualityProfile = document.getElementById('modal-quality-profile').value;
        const rootFolderSelect = document.getElementById('modal-root-folder');
        const rootFolderPath = rootFolderSelect && rootFolderSelect.value ? rootFolderSelect.value : '';
        const requestBtn = document.getElementById('modal-request-btn');

        if (!instanceSelect.value) {
            this.core.showNotification('Please select an instance', 'error');
            return;
        }

        const isTVShow = this.core.currentModalData.media_type === 'tv';

        requestBtn.disabled = true;
        requestBtn.textContent = 'Requesting...';

        try {
            const requestData = {
                tmdb_id: this.core.currentModalData.tmdb_id,
                media_type: this.core.currentModalData.media_type,
                title: this.core.currentModalData.title,
                year: this.core.currentModalData.year,
                overview: this.core.currentModalData.overview || '',
                poster_path: this.core.currentModalData.poster_path || '',
                backdrop_path: this.core.currentModalData.backdrop_path || '',
                instance: instanceSelect.value,
                root_folder_path: rootFolderPath || undefined,
                quality_profile: qualityProfile
            };

            const response = await fetch('./api/requestarr/request', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestData)
            });

            const result = await response.json();

            if (result.success) {
                requestBtn.textContent = 'Requested \u2713';
                requestBtn.classList.add('success');

                this.core.showNotification(result.message || `${isTVShow ? 'Series' : 'Movie'} requested successfully!`, 'success');
                this.updateCardStatusAfterRequest(this.core.currentModalData.tmdb_id);

                setTimeout(() => this.closeModal(), 2000);
            } else {
                const errorMsg = result.message || result.error || 'Request failed';
                this.core.showNotification(errorMsg, 'error');
                requestBtn.disabled = false;
                requestBtn.classList.remove('success');
                requestBtn.textContent = 'Request';
            }
        } catch (error) {
            console.error('[RequestarrModal] Error submitting request:', error);
            this.core.showNotification(error.message || 'Request failed', 'error');
            requestBtn.disabled = false;
            requestBtn.classList.remove('success');
            requestBtn.textContent = 'Request';
        }
    }

    updateCardStatusAfterRequest(tmdbId) {
        const cards = document.querySelectorAll(`.media-card[data-tmdb-id="${tmdbId}"]`);
        cards.forEach((card, index) => {
            const badge = card.querySelector('.media-card-status-badge');
            if (badge) {
                badge.className = 'media-card-status-badge cooldown';
                badge.innerHTML = '<i class="fas fa-hand"></i>';
            }
            card.classList.add('in-cooldown');
            const requestBtn = card.querySelector('.media-card-request-btn');
            if (requestBtn) requestBtn.remove();
        });
    }

    closeModal() {
        const modal = document.getElementById('media-modal');
        if (modal) modal.style.display = 'none';
        this.core.currentModalData = null;
        document.body.classList.remove('requestarr-modal-open');
    }
}
