/**
 * Requestarr Modal - Modal system for requesting media
 */

export class RequestarrModal {
    constructor(core) {
        this.core = core;
    }
    
    formatCooldownTime(hours_remaining) {
        // Format time display based on duration
        if (hours_remaining <= 24) {
            // 24 hours or less: show as hours and minutes (12h 23m)
            const hours = Math.floor(hours_remaining);
            const minutes = Math.floor((hours_remaining - hours) * 60);
            return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
        } else {
            // More than 24 hours: show as days, hours, minutes (1d 1h 5m)
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
        const modalBody = modal.querySelector('.modal-body');

        this.ensureModalInBody(modal);
        document.body.classList.add('requestarr-modal-open');
        
        modal.style.display = 'flex';
        modalBody.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Loading details...</p></div>';
        
        // Store suggested instance for use in renderModal
        this.suggestedInstance = suggestedInstance;
        
        try {
            const response = await fetch(`./api/requestarr/details/${mediaType}/${tmdbId}`);
            const data = await response.json();
            
            if (data.tmdb_id) {
                this.core.currentModal = data;
                this.renderModal(data);
            } else {
                throw new Error('Failed to load details');
            }
        } catch (error) {
            console.error('[RequestarrDiscover] Error loading details:', error);
            modalBody.innerHTML = '<p style="color: #ef4444; text-align: center; padding: 60px;">Failed to load details</p>';
        }
    }

    async renderModal(data) {
        const modal = document.getElementById('media-modal');
        const modalBody = modal.querySelector('.modal-body');
        
        const isTVShow = data.media_type === 'tv';
        const instances = isTVShow ? this.core.instances.sonarr : this.core.instances.radarr;
        
        // Deduplicate instances by name (just in case)
        const uniqueInstances = instances.reduce((acc, instance) => {
            if (!acc.find(i => i.name === instance.name)) {
                acc.push(instance);
            }
            return acc;
        }, []);
        
        // Determine default instance:
        // 1. Use suggested instance (from Discovery home)
        // 2. Use currently selected instance (from Movies/TV browsing views)
        // 3. Fall back to first available instance
        const currentlySelectedInstance = isTVShow ? this.core.content.selectedTVInstance : this.core.content.selectedMovieInstance;
        const defaultInstance = this.suggestedInstance || currentlySelectedInstance || uniqueInstances[0]?.name || '';
        
        console.log('[RequestarrModal] Default instance selection:', {
            suggestedInstance: this.suggestedInstance,
            currentlySelectedInstance: currentlySelectedInstance,
            finalDefault: defaultInstance
        });
        
        let modalHTML = `
            <div class="request-modal-header" style="background-image: url(${data.backdrop_path || ''});">
                <button class="modal-close-btn" onclick="window.RequestarrDiscover.modal.closeModal()">
                    <i class="fas fa-times"></i>
                </button>
                <div class="request-modal-header-overlay">
                    <h2 class="request-modal-title">Request ${isTVShow ? 'Series' : 'Movie'}</h2>
                    <h3 class="request-modal-subtitle">${data.title}</h3>
                </div>
            </div>
            <div class="request-modal-content">
        `;
        
        // Status container and instance selector
        modalHTML += `
            <div id="${isTVShow ? 'series' : 'movie'}-status-container"></div>
            <div class="request-advanced-section">
                <div class="advanced-field">
                    <label>Instance</label>
                    <select id="modal-instance-select" class="advanced-select" onchange="window.RequestarrDiscover.modal.instanceChanged(this.value)">
        `;
        
        if (instances.length === 0) {
            modalHTML += `<option value="">No Instance Configured</option>`;
        } else {
            uniqueInstances.forEach((instance, index) => {
                const selected = instance.name === defaultInstance ? 'selected' : '';
                const appLabel = isTVShow ? 'Sonarr' : 'Radarr';
                modalHTML += `<option value="${instance.name}" ${selected}>${appLabel} - ${instance.name}</option>`;
            });
        }
        
        modalHTML += `
                    </select>
                </div>
            </div>
            <div class="request-advanced-section">
                <div class="advanced-field">
                    <label>Root Folder</label>
                    <select id="modal-root-folder" class="advanced-select">
                        <option value="">Loading...</option>
                    </select>
                    <small style="color: #888; display: block; margin-top: 4px;">Where to store this ${isTVShow ? 'series' : 'movie'}</small>
                </div>
            </div>
        `;
        
        // Quality Profile section
        const profileKey = `${isTVShow ? 'sonarr' : 'radarr'}-${defaultInstance}`;
        const profiles = this.core.qualityProfiles[profileKey] || [];
        
        modalHTML += `
            <div class="request-advanced-section">
                <div class="advanced-field">
                    <label>Quality Profile</label>
                    <select id="modal-quality-profile" class="advanced-select">
                        <option value="">Any (Default)</option>
        `;
        
        // Filter out "Any" profile since we already have "Any (Default)"
        profiles.forEach(profile => {
            if (profile.name.toLowerCase() !== 'any') {
                modalHTML += `<option value="${profile.id}">${profile.name}</option>`;
            }
        });
        
        modalHTML += `
                    </select>
                </div>
            </div>
            
            <div class="request-modal-actions">
                <button class="modal-btn cancel-btn" onclick="window.RequestarrDiscover.modal.closeModal()">Cancel</button>
                <button class="modal-btn request-btn" id="modal-request-btn" onclick="window.RequestarrDiscover.modal.submitRequest()">
                    Request
                </button>
            </div>
        </div>
        `;
        
        modalBody.innerHTML = modalHTML;
        
        this.core.currentModalData = data;
        
        // Load root folders for selected instance (above profile, dynamic by instance)
        if (defaultInstance) {
            this.loadModalRootFolders(defaultInstance, isTVShow);
        } else {
            const rootSelect = document.getElementById('modal-root-folder');
            if (rootSelect) rootSelect.innerHTML = '<option value="">Select an instance first</option>';
        }
        
        // Load status if instance is already selected
        if (defaultInstance) {
            if (isTVShow) {
                this.loadSeriesStatus(defaultInstance);
            } else {
                this.loadMovieStatus(defaultInstance);
            }
        }
        
        // Disable request button if no instances configured
        if (uniqueInstances.length === 0) {
            document.getElementById('modal-request-btn').disabled = true;
            document.getElementById('modal-request-btn').classList.add('disabled');
        }
    }

    async loadModalRootFolders(instanceName, isTVShow) {
        const rootSelect = document.getElementById('modal-root-folder');
        if (!rootSelect) return;
        
        // Prevent concurrent calls (race condition protection)
        if (this._loadingModalRootFolders) {
            console.log('[RequestarrModal] loadModalRootFolders already in progress, skipping');
            return;
        }
        this._loadingModalRootFolders = true;
        
        const appType = isTVShow ? 'sonarr' : 'radarr';
        rootSelect.innerHTML = '<option value="">Loading...</option>';
        try {
            const response = await fetch(`./api/requestarr/rootfolders?app_type=${appType}&instance_name=${encodeURIComponent(instanceName)}`);
            const data = await response.json();
            console.log('[RequestarrModal]', appType, 'API returned', data.root_folders?.length || 0, 'root folders');
            
            if (data.success && data.root_folders && data.root_folders.length > 0) {
                // Use Map to dedupe by normalized path, keeping first occurrence
                const seenPaths = new Map();
                data.root_folders.forEach(rf => {
                    if (!rf || !rf.path) return;
                    // Normalize: trim, remove trailing slashes, lowercase
                    const originalPath = rf.path.trim();
                    const normalized = originalPath.replace(/\/+$/, '').toLowerCase();
                    if (!normalized) return;
                    // Only add if not seen before (keeps first occurrence)
                    if (!seenPaths.has(normalized)) {
                        seenPaths.set(normalized, {
                            path: originalPath,
                            freeSpace: rf.freeSpace
                        });
                    }
                });
                console.log('[RequestarrModal] After deduplication:', seenPaths.size, 'unique root folders');
                
                // Only show fallback if NO root folders exist
                if (seenPaths.size === 0) {
                    rootSelect.innerHTML = '<option value="">Use default (first root folder)</option>';
                } else {
                    // Clear and add only actual root folders
                    rootSelect.innerHTML = '';
                    // Add options from deduplicated map
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
            console.error('[RequestarrDiscover] Error checking seasons:', error);
            return [];
        }
    }

    // Season selection removed - we automatically request what's missing

    async loadSeriesStatus(instanceName) {
        if (!instanceName || !this.core.currentModalData) {
            return;
        }
        
        const container = document.getElementById('series-status-container');
        if (!container) {
            return;
        }
        
        console.log('[RequestarrDiscover] Loading series status for instance:', instanceName);
        
        container.innerHTML = `
            <div style="text-align: center; padding: 15px;">
                <i class="fas fa-spinner fa-spin" style="font-size: 20px; color: #667eea;"></i>
            </div>
        `;
        
        try {
            const response = await fetch(`./api/requestarr/series-status?tmdb_id=${this.core.currentModalData.tmdb_id}&instance=${encodeURIComponent(instanceName)}`);
            const status = await response.json();
            
            console.log('[RequestarrDiscover] Series status:', status);
            
            let statusHTML = '';
            const requestBtn = document.getElementById('modal-request-btn');
            
            if (status.exists) {
                // Check cooldown status first
                if (status.cooldown_status && status.cooldown_status.in_cooldown) {
                    const timeMsg = this.formatCooldownTime(status.cooldown_status.hours_remaining);
                    
                    statusHTML = `
                        <div class="series-status-box status-requested">
                            <i class="fas fa-clock"></i>
                            <div>
                                <div class="status-title">Recently requested - Cooldown active</div>
                                <div class="status-text">Can request again in ${timeMsg}</div>
                            </div>
                        </div>
                    `;
                    if (requestBtn) {
                        requestBtn.disabled = true;
                        requestBtn.classList.add('disabled');
                        requestBtn.textContent = `Wait ${timeMsg}`;
                    }
                } else if (status.missing_episodes === 0 && status.total_episodes > 0) {
                    // Complete series - disable request button
                    statusHTML = `
                        <div class="series-status-box status-available">
                            <i class="fas fa-check-circle"></i>
                            <div>
                                <div class="status-title">Complete series in library (${status.available_episodes}/${status.total_episodes})</div>
                            </div>
                        </div>
                    `;
                    if (requestBtn) {
                        requestBtn.disabled = true;
                        requestBtn.classList.add('disabled');
                        requestBtn.textContent = 'Complete';
                    }
                } else if (status.missing_episodes > 0) {
                    // Has missing episodes - enable request button
                    statusHTML = `
                        <div class="series-status-box status-missing-episodes">
                            <i class="fas fa-tv"></i>
                            <div>
                                <div class="status-title">Request missing episodes (${status.available_episodes}/${status.total_episodes} with ${status.missing_episodes} missing)</div>
                            </div>
                        </div>
                    `;
                    if (requestBtn) {
                        requestBtn.disabled = false;
                        requestBtn.classList.remove('disabled');
                        requestBtn.textContent = 'Request';
                    }
                } else {
                    // In library but status unclear - disable request button
                    statusHTML = `
                        <div class="series-status-box status-available">
                            <i class="fas fa-check-circle"></i>
                            <div>
                                <div class="status-title">In Library</div>
                            </div>
                        </div>
                    `;
                    if (requestBtn) {
                        requestBtn.disabled = true;
                        requestBtn.classList.add('disabled');
                        requestBtn.textContent = 'In Library';
                    }
                }
            } else {
                // Not in library - enable request button
                statusHTML = `
                    <div class="series-status-box status-requestable">
                        <i class="fas fa-inbox"></i>
                        <div>
                            <div class="status-title">Available to request</div>
                            <div class="status-text">This series is not yet in your library</div>
                        </div>
                    </div>
                `;
                if (requestBtn) {
                    requestBtn.disabled = false;
                    requestBtn.classList.remove('disabled');
                    requestBtn.textContent = 'Request';
                }
            }
            
            container.innerHTML = statusHTML;
            
        } catch (error) {
            console.error('[RequestarrDiscover] Error loading series status:', error);
            container.innerHTML = `
                <div class="series-status-box status-requestable">
                    <i class="fas fa-inbox"></i>
                    <div>
                        <div class="status-title">Available to request</div>
                        <div class="status-text">Unable to check library status</div>
                    </div>
                </div>
            `;
        }
    }

    async loadMovieStatus(instanceName) {
        if (!instanceName || !this.core.currentModalData) {
            return;
        }
        
        const container = document.getElementById('movie-status-container');
        if (!container) {
            return;
        }
        
        console.log('[RequestarrDiscover] Loading movie status for instance:', instanceName);
        
        container.innerHTML = `
            <div style="text-align: center; padding: 15px;">
                <i class="fas fa-spinner fa-spin" style="font-size: 20px; color: #667eea;"></i>
            </div>
        `;
        
        try {
            const response = await fetch(`./api/requestarr/movie-status?tmdb_id=${this.core.currentModalData.tmdb_id}&instance=${encodeURIComponent(instanceName)}`);
            const status = await response.json();
            
            console.log('[RequestarrDiscover] Movie status:', status);
            
            let statusHTML = '';
            const requestBtn = document.getElementById('modal-request-btn');
            
            if (status.in_library) {
                statusHTML = `
                    <div class="series-status-box status-available">
                        <i class="fas fa-check-circle"></i>
                        <div>
                            <div class="status-title">Already in library</div>
                        </div>
                    </div>
                `;
                if (requestBtn) {
                    requestBtn.disabled = true;
                    requestBtn.classList.add('disabled');
                    requestBtn.textContent = 'In Library';
                }
            } else if (status.cooldown_status && status.cooldown_status.in_cooldown) {
                // In cooldown period
                const timeMsg = this.formatCooldownTime(status.cooldown_status.hours_remaining);
                
                statusHTML = `
                    <div class="series-status-box status-requested">
                        <i class="fas fa-clock"></i>
                        <div>
                            <div class="status-title">Recently requested - Cooldown active</div>
                            <div class="status-text">Can request again in ${timeMsg}</div>
                        </div>
                    </div>
                `;
                if (requestBtn) {
                    requestBtn.disabled = true;
                    requestBtn.classList.add('disabled');
                    requestBtn.textContent = `Wait ${timeMsg}`;
                }
            } else {
                // Available to request (cooldown expired or never requested)
                statusHTML = `
                    <div class="series-status-box status-requestable">
                        <i class="fas fa-inbox"></i>
                        <div>
                            <div class="status-title">Available to request</div>
                            <div class="status-text">This movie is not yet in your library</div>
                        </div>
                    </div>
                `;
                if (requestBtn) {
                    requestBtn.disabled = false;
                    requestBtn.classList.remove('disabled');
                    requestBtn.textContent = 'Request';
                }
            }
            
            container.innerHTML = statusHTML;
            
        } catch (error) {
            console.error('[RequestarrDiscover] Error loading movie status:', error);
            container.innerHTML = `
                <div class="series-status-box status-requestable">
                    <i class="fas fa-inbox"></i>
                    <div>
                        <div class="status-title">Available to request</div>
                        <div class="status-text">Unable to check library status</div>
                    </div>
                </div>
            `;
            const requestBtn = document.getElementById('modal-request-btn');
            if (requestBtn) {
                requestBtn.disabled = false;
                requestBtn.classList.remove('disabled');
                requestBtn.textContent = 'Request';
            }
        }
    }

    instanceChanged(instanceName) {
        const isTVShow = this.core.currentModalData.media_type === 'tv';
        const instanceKey = isTVShow ? 'sonarr' : 'radarr';
        
        localStorage.setItem(`huntarr-requestarr-instance-${instanceKey}`, instanceName);
        console.log('[RequestarrDiscover] Instance changed to:', instanceName);
        
        // Reload root folder dropdown for new instance (above profile)
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
        
        // Reload status for new instance
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
            
            console.log('[RequestarrDiscover] Submitting request:', requestData);
            
            const response = await fetch('./api/requestarr/request', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestData)
            });
            
            const result = await response.json();
            console.log('[RequestarrDiscover] Request result:', result);
            
            if (result.success) {
                // Show success state on button
                requestBtn.textContent = 'Requested ✓';
                requestBtn.classList.add('success');
                
                // Show success notification
                this.core.showNotification(result.message || `${isTVShow ? 'Series' : 'Movie'} requested successfully!`, 'success');
                
                // Update the card icon to show cooldown status
                this.updateCardStatusAfterRequest(this.core.currentModalData.tmdb_id);
                
                // Wait 2 seconds before closing modal
                setTimeout(() => {
                    this.closeModal();
                }, 2000);
                
            } else {
                // Show error notification with detailed message
                const errorMsg = result.message || result.error || 'Request failed';
                console.error('[RequestarrDiscover] Request failed:', errorMsg);
                this.core.showNotification(errorMsg, 'error');
                
                // Re-enable button
                requestBtn.disabled = false;
                requestBtn.classList.remove('success');
                requestBtn.textContent = 'Request';
            }
        } catch (error) {
            console.error('[RequestarrDiscover] Error submitting request:', error);
            
            // Show detailed error
            const errorMsg = error.message || 'Request failed - check console for details';
            this.core.showNotification(errorMsg, 'error');
            
            // Re-enable button
            requestBtn.disabled = false;
            requestBtn.classList.remove('success');
            requestBtn.textContent = 'Request';
        }
    }

    updateCardStatusAfterRequest(tmdbId) {
        // Find ALL media cards with this TMDB ID (could be in trending, popular, movies, or tv sections)
        const cards = document.querySelectorAll(`.media-card[data-tmdb-id="${tmdbId}"]`);
        
        console.log(`[RequestarrDiscover] Looking for cards with TMDB ID: ${tmdbId}, found: ${cards.length}`);
        
        if (cards.length === 0) {
            console.warn(`[RequestarrDiscover] No cards found with TMDB ID: ${tmdbId}`);
            return;
        }
        
        // Update all matching cards to match Sonarr: cooldown = not requestable (badge + no Request button)
        cards.forEach((card, index) => {
            const badge = card.querySelector('.media-card-status-badge');
            if (badge) {
                badge.className = 'media-card-status-badge cooldown';
                badge.innerHTML = '<i class="fas fa-hand"></i>';
            }
            // Mark card as in-cooldown (badge only; no "In cooldown" text)
            card.classList.add('in-cooldown');
            const requestBtn = card.querySelector('.media-card-request-btn');
            if (requestBtn) {
                requestBtn.remove();
            }
            console.log(`[RequestarrDiscover] Updated card ${index + 1}/${cards.length} to cooldown (no request) for TMDB ID: ${tmdbId}`);
        });
    }

    ensureModalInBody(modal) {
        if (!modal || modal.parentElement === document.body) {
            return;
        }

        document.body.appendChild(modal);
    }

    closeModal() {
        const modal = document.getElementById('media-modal');
        modal.style.display = 'none';
        this.core.currentModalData = null;
        document.body.classList.remove('requestarr-modal-open');
    }
}
