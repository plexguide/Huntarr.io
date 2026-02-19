/**
 * Requestarr Movie Detail Page – Uses shared mh-* styling from Movie Hunt
 * Handles Radarr + Movie Hunt instances and movie status checking
 */
(function() {
    'use strict';

    // Delegate to shared MediaUtils (loaded before this file)
    function _encodeInstanceValue(appType, name) {
        return window.MediaUtils.encodeInstanceValue(appType, name);
    }
    function _decodeInstanceValue(value) {
        return window.MediaUtils.decodeInstanceValue(value);
    }

    window.RequestarrDetail = {
        currentMovie: null,
        tmdbApiKey: null,
        movieInstances: [],  // Combined Movie Hunt + Radarr instances
        selectedInstanceName: null,  // Compound value: "movie_hunt:Name" or "radarr:Name"

        init() {
            console.log('[RequestarrDetail] Module initialized');

            window.addEventListener('popstate', (e) => {
                if (e.state && e.state.requestarrMovieDetail) {
                    this.openDetail(e.state.requestarrMovieDetail, e.state.options || {}, true);
                } else {
                    this.closeDetail(true);
                }
            });

            window.addEventListener('hashchange', () => {
                const hash = window.location.hash || '';
                const m = hash.match(/^#requestarr-movie\/(\d+)$/);
                if (m) {
                    const tmdbId = parseInt(m[1], 10);
                    this.openDetail({ id: tmdbId, tmdb_id: tmdbId }, {}, true);
                } else {
                    this.closeDetail(true);
                }
            });

            // Restore detail on refresh when URL has #requestarr-movie/ID
            const hash = window.location.hash || '';
            const m = hash.match(/^#requestarr-movie\/(\d+)$/);
            if (m) {
                const tmdbId = parseInt(m[1], 10);
                this.openDetail({ id: tmdbId, tmdb_id: tmdbId }, {}, true);
            }
        },

        async openDetail(movie, options = {}, fromHistory = false) {
            if (!movie) return;

            this.currentMovie = movie;
            this.options = options || {};
            console.log('[RequestarrDetail] Opening detail for:', movie.title);

            if (this.movieInstances.length === 0) {
                await this.loadMovieInstances();
            }

            let detailView = document.getElementById('requestarr-detail-view');
            if (!detailView) {
                detailView = document.createElement('div');
                detailView.id = 'requestarr-detail-view';
                detailView.className = 'movie-detail-view';
                document.body.appendChild(detailView);
            }

            detailView.innerHTML = this.getLoadingHTML();
            detailView.classList.add('active');

            if (!fromHistory) {
                const tmdbId = movie.tmdb_id || movie.id;
                const url = `${window.location.pathname}${window.location.search}#requestarr-movie/${tmdbId}`;
                history.pushState(
                    { requestarrMovieDetail: movie, options: this.options },
                    movie.title,
                    url
                );
            }

            setTimeout(() => {
                const backBtn = document.getElementById('requestarr-detail-back-loading');
                if (backBtn) {
                    backBtn.addEventListener('click', () => this.closeDetail());
                }
            }, 0);

            try {
                const tmdbId = movie.tmdb_id || movie.id;
                const details = await this.fetchMovieDetails(tmdbId);

                if (details) {
                    detailView.innerHTML = this.renderMovieDetail(details, movie);
                    this.setupDetailInteractions();
                } else {
                    detailView.innerHTML = this.getErrorHTML('Failed to load movie details');
                    this.setupErrorBackButton();
                }
            } catch (error) {
                console.error('[RequestarrDetail] Error loading details:', error);
                detailView.innerHTML = this.getErrorHTML('Failed to load movie details');
                this.setupErrorBackButton();
            }
        },

        closeDetail(fromHistory = false) {
            const detailView = document.getElementById('requestarr-detail-view');
            if (detailView) {
                detailView.classList.remove('active');
            }

            // Remove ESC listener to prevent stacking
            if (this._escHandler) {
                document.removeEventListener('keydown', this._escHandler);
                this._escHandler = null;
            }

            if (!fromHistory && /^#requestarr-movie\//.test(window.location.hash || '')) {
                history.back();
            }
        },

        async fetchMovieDetails(tmdbId) {
            if (!tmdbId) return null;

            try {
                const response = await fetch(`./api/movie-hunt/tmdb-movie/${tmdbId}`);
                if (!response.ok) throw new Error(`TMDB API returned ${response.status}`);
                return await response.json();
            } catch (error) {
                console.error('[RequestarrDetail] Error fetching movie details:', error);
                return null;
            }
        },

        async loadMovieInstances() {
            try {
                // Fetch both Movie Hunt and Radarr instances in parallel
                const [mhResponse, radarrResponse] = await Promise.all([
                    fetch('./api/requestarr/instances/movie_hunt'),
                    fetch('./api/requestarr/instances/radarr')
                ]);
                const mhData = await mhResponse.json();
                const radarrData = await radarrResponse.json();

                const combined = [];

                // Movie Hunt instances first (include id for edit/delete)
                if (mhData.instances) {
                    mhData.instances.forEach(function(inst) {
                        combined.push({
                            name: inst.name,
                            id: inst.id,
                            appType: 'movie_hunt',
                            compoundValue: _encodeInstanceValue('movie_hunt', inst.name),
                            label: 'Movie Hunt \u2013 ' + inst.name
                        });
                    });
                }

                // Then Radarr instances
                if (radarrData.instances) {
                    radarrData.instances.forEach(function(inst) {
                        combined.push({
                            name: inst.name,
                            appType: 'radarr',
                            compoundValue: _encodeInstanceValue('radarr', inst.name),
                            label: 'Radarr \u2013 ' + inst.name
                        });
                    });
                }

                this.movieInstances = combined;

                if (combined.length > 0) {
                    if (this.options.suggestedInstance) {
                        this.selectedInstanceName = this.options.suggestedInstance;
                    } else if (!this.selectedInstanceName) {
                        this.selectedInstanceName = combined[0].compoundValue;
                    }
                } else {
                    this.movieInstances = [];
                    this.selectedInstanceName = null;
                }
            } catch (error) {
                console.error('[RequestarrDetail] Error loading movie instances:', error);
                this.movieInstances = [];
                this.selectedInstanceName = null;
            }
        },

        async checkMovieStatus(tmdbId, instanceValue) {
            if (!instanceValue) return { in_library: false, found: false, previously_requested: false };

            try {
                // Decode compound value to get app type and actual name
                var decoded = _decodeInstanceValue(instanceValue);
                var appTypeParam = decoded.appType === 'movie_hunt' ? '&app_type=movie_hunt' : '';
                var response = await fetch('./api/requestarr/movie-status?tmdb_id=' + tmdbId + '&instance=' + encodeURIComponent(decoded.name) + appTypeParam);
                var data = await response.json();

                return {
                    in_library: data.in_library || false,
                    found: data.found || false,
                    previously_requested: data.previously_requested || false
                };
            } catch (error) {
                console.error('[RequestarrDetail] Error checking movie status:', error);
                return { in_library: false, found: false, previously_requested: false };
            }
        },

        // updateMovieStatus — removed (no-op). Status is driven by updateDetailInfoBar().

        /**
         * Check if there's an existing request for this movie and update the action button.
         */
        async _checkRequestStatus() {
            if (!this.currentMovie) return;
            const tmdbId = this.currentMovie.tmdb_id || this.currentMovie.id;
            if (!tmdbId) return;
            try {
                const resp = await fetch(`./api/requestarr/requests/check/movie/${tmdbId}`, { cache: 'no-store' });
                if (!resp.ok) return;
                const data = await resp.json();
                if (data.exists && data.request) {
                    const btn = document.getElementById('requestarr-detail-request-btn');
                    if (!btn) return;
                    const status = data.request.status;
                    if (status === 'pending') {
                        btn.innerHTML = '<i class="fas fa-clock"></i> Request Pending';
                        btn.classList.remove('mh-btn-primary');
                        btn.classList.add('mh-btn-warning');
                        btn.disabled = true;
                    } else if (status === 'approved') {
                        btn.innerHTML = '<i class="fas fa-check-circle"></i> Request Approved';
                        btn.classList.remove('mh-btn-primary');
                        btn.classList.add('mh-btn-success');
                        btn.disabled = true;
                    } else if (status === 'denied') {
                        // Denied — allow re-request
                        btn.innerHTML = '<i class="fas fa-times-circle"></i> Denied — Re-request';
                        btn.classList.remove('mh-btn-primary');
                        btn.classList.add('mh-btn-denied');
                    }
                }
            } catch (e) {
                console.debug('[RequestarrDetail] Request status check skipped:', e);
            }
        },

        formatFileSize(bytes) {
            if (!bytes || bytes === 0) return '0 B';
            if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(1) + ' GB';
            if (bytes >= 1048576) return (bytes / 1048576).toFixed(0) + ' MB';
            return (bytes / 1024).toFixed(0) + ' KB';
        },

        getToolbarHTML(isMovieHunt) {
            if (isMovieHunt) {
                return '<div class="mh-toolbar" id="requestarr-detail-toolbar">' +
                    '<div class="mh-toolbar-left">' +
                        // Shown when IN collection:
                        '<button class="mh-tb" id="requestarr-detail-refresh" title="Refresh" style="display:none"><i class="fas fa-redo-alt"></i><span>Refresh</span></button>' +
                        '<span id="requestarr-detail-force-container"></span>' +
                        // Shown when NOT in collection:
                        '<button class="mh-tb" id="requestarr-detail-search-movie" title="Search Movie" style="display:none"><i class="fas fa-search"></i><span>Search Movie</span></button>' +
                    '</div>' +
                    '<div class="mh-toolbar-right">' +
                        // Shown when IN collection:
                        '<button class="mh-tb" id="requestarr-detail-edit" title="Edit" style="display:none"><i class="fas fa-wrench"></i><span>Edit</span></button>' +
                        '<button class="mh-tb mh-tb-danger" id="requestarr-detail-delete" title="Delete" style="display:none"><i class="fas fa-trash-alt"></i></button>' +
                        // Shown when NOT in collection:
                        '<button class="mh-tb" id="requestarr-detail-hide" title="Hide from discovery" style="display:none"><i class="fas fa-eye-slash"></i></button>' +
                    '</div></div>';
            }
            return '<div class="mh-toolbar" id="requestarr-detail-toolbar">' +
                '<div class="mh-toolbar-left">' +
                '</div><div class="mh-toolbar-right"></div></div>';
        },

        replaceAndAttachToolbar(isMovieHunt) {
            var toolbarEl = document.getElementById('requestarr-detail-toolbar');
            if (!toolbarEl) return;
            toolbarEl.outerHTML = this.getToolbarHTML(isMovieHunt);
            this.attachToolbarHandlers();
        },

        attachToolbarHandlers() {
            var self = this;
            var backBtn = document.getElementById('requestarr-detail-back');
            if (backBtn) backBtn.addEventListener('click', () => this.closeDetail());
            var refreshBtn = document.getElementById('requestarr-detail-refresh');
            if (refreshBtn) refreshBtn.addEventListener('click', async () => {
                if (refreshBtn.disabled) return;
                refreshBtn.disabled = true;
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('Refresh scan initiated.', 'success');
                }
                try {
                    await this.updateDetailInfoBar(true);
                } catch (e) {
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification('Refresh failed.', 'error');
                    }
                } finally {
                    refreshBtn.disabled = false;
                }
            });
            var editBtn = document.getElementById('requestarr-detail-edit');
            if (editBtn) editBtn.addEventListener('click', () => this.openEditModalForMovieHunt());
            var deleteBtn = document.getElementById('requestarr-detail-delete');
            if (deleteBtn) deleteBtn.addEventListener('click', () => this.openDeleteModalForMovieHunt());

            // Monitor toggle
            var monitorBtn = document.getElementById('requestarr-movie-monitor-btn');
            if (monitorBtn) monitorBtn.addEventListener('click', function() { self.toggleMovieMonitor(); });

            // Search Movie (request) — for items NOT in collection
            var searchMovieBtn = document.getElementById('requestarr-detail-search-movie');
            if (searchMovieBtn) searchMovieBtn.addEventListener('click', function() {
                if (self.currentMovie && window.RequestarrDiscover && window.RequestarrDiscover.modal) {
                    window.RequestarrDiscover.modal.openModal(self.currentMovie.tmdb_id || self.currentMovie.id, 'movie', self.selectedInstanceName);
                }
            });

            // Hide from discovery — for items NOT in collection
            var hideBtn = document.getElementById('requestarr-detail-hide');
            if (hideBtn) hideBtn.addEventListener('click', function() {
                if (!self.currentMovie || !window.MediaUtils) return;
                var decoded = _decodeInstanceValue(self.selectedInstanceName || '');
                window.MediaUtils.hideMedia({
                    tmdbId: self.currentMovie.tmdb_id || self.currentMovie.id,
                    mediaType: 'movie',
                    title: self.currentMovie.title || 'this movie',
                    posterPath: self.currentMovie.poster_path || null,
                    appType: decoded.appType || 'movie_hunt',
                    instanceName: decoded.name || '',
                    cardElement: null,
                    onHidden: function() {
                        self.closeDetail();
                    }
                });
            });
        },

        async openEditModalForMovieHunt() {
            var decoded = _decodeInstanceValue(this.selectedInstanceName || '');
            if (decoded.appType !== 'movie_hunt' || !decoded.name) return;
            var inst = this.movieInstances.find(function(i) { return i.compoundValue === this.selectedInstanceName; }.bind(this));
            var instanceId = inst && inst.id != null ? inst.id : null;
            if (instanceId == null) return;

            var movie = this.currentMovie;
            var status = this.currentMovieStatusForMH || null;
            if (!movie) return;

            var title = this.escapeHtml(movie.title || '');

            var profiles = [], rootFolders = [];
            try {
                var [profResp, rfResp] = await Promise.all([
                    fetch('./api/profiles?instance_id=' + instanceId),
                    fetch('./api/movie-hunt/root-folders?instance_id=' + instanceId)
                ]);
                var profData = await profResp.json();
                profiles = profData.profiles || profData || [];
                var rfData = await rfResp.json();
                rootFolders = rfData.root_folders || rfData || [];
            } catch (err) {
                console.error('[RequestarrDetail] Edit modal fetch error:', err);
            }

            var currentProfile = (status && status.quality_profile) || '';
            var currentRoot = (status && status.root_folder_path) || '';
            var currentAvail = (status && status.minimum_availability) || 'released';
            var self = this;

            var profileOpts = (Array.isArray(profiles) ? profiles : []).map(function(p) {
                var name = p.name || 'Unknown';
                var sel = name === currentProfile ? ' selected' : '';
                return '<option value="' + self.escapeHtml(name) + '"' + sel + '>' + self.escapeHtml(name) + (p.is_default ? ' (Default)' : '') + '</option>';
            }).join('');

            var rfOpts = (Array.isArray(rootFolders) ? rootFolders : []).map(function(rf) {
                var path = rf.path || '';
                var sel = path === currentRoot ? ' selected' : '';
                return '<option value="' + self.escapeHtml(path) + '"' + sel + '>' + self.escapeHtml(path) + (rf.is_default ? ' (Default)' : '') + '</option>';
            }).join('');

            var availOpts = [
                { value: 'announced', label: 'Announced' },
                { value: 'inCinemas', label: 'In Cinemas' },
                { value: 'released', label: 'Released' }
            ].map(function(a) {
                var sel = a.value === currentAvail ? ' selected' : '';
                return '<option value="' + a.value + '"' + sel + '>' + a.label + '</option>';
            }).join('');

            var html =
                '<div class="mh-modal-backdrop" id="mh-edit-modal">' +
                    '<div class="mh-modal">' +
                        '<div class="mh-modal-header">' +
                            '<h3><i class="fas fa-wrench"></i> Edit \u2014 ' + title + '</h3>' +
                            '<button class="mh-modal-x" id="mh-edit-close">&times;</button>' +
                        '</div>' +
                        '<div class="mh-modal-body">' +
                            '<div class="mh-form-row"><label>Root Folder</label><select id="mh-edit-root-folder" class="mh-select">' + rfOpts + '</select></div>' +
                            '<div class="mh-form-row"><label>Quality Profile</label><select id="mh-edit-quality-profile" class="mh-select">' + profileOpts + '</select></div>' +
                            '<div class="mh-form-row"><label>Minimum Availability</label><select id="mh-edit-min-availability" class="mh-select">' + availOpts + '</select></div>' +
                        '</div>' +
                        '<div class="mh-modal-footer">' +
                            '<button class="mh-btn mh-btn-secondary" id="mh-edit-cancel">Cancel</button>' +
                            '<button class="mh-btn mh-btn-primary" id="mh-edit-save">Save</button>' +
                        '</div>' +
                    '</div>' +
                '</div>';

            var existing = document.getElementById('mh-edit-modal');
            if (existing) existing.remove();

            document.body.insertAdjacentHTML('beforeend', html);

            document.getElementById('mh-edit-close').addEventListener('click', function() { document.getElementById('mh-edit-modal').remove(); });
            document.getElementById('mh-edit-cancel').addEventListener('click', function() { document.getElementById('mh-edit-modal').remove(); });
            document.getElementById('mh-edit-modal').addEventListener('click', function(e) {
                if (e.target.id === 'mh-edit-modal') document.getElementById('mh-edit-modal').remove();
            });
            document.getElementById('mh-edit-save').addEventListener('click', function() { self._handleSaveEdit(instanceId); });
        },

        async _handleSaveEdit(instanceId) {
            var movie = this.currentMovie;
            if (!movie) return;
            var tmdbId = movie.tmdb_id || movie.id;
            var rootFolder = document.getElementById('mh-edit-root-folder').value;
            var qualityProfile = document.getElementById('mh-edit-quality-profile').value;
            var minAvailability = document.getElementById('mh-edit-min-availability').value;
            var saveBtn = document.getElementById('mh-edit-save');
            if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving...'; }
            var self = this;

            try {
                var resp = await fetch('./api/movie-hunt/collection/update?instance_id=' + instanceId, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ tmdb_id: tmdbId, root_folder: rootFolder, quality_profile: qualityProfile, minimum_availability: minAvailability })
                });
                var data = await resp.json();
                if (data.success) {
                    var modal = document.getElementById('mh-edit-modal');
                    if (modal) modal.remove();
                    self.updateDetailInfoBar();
                    if (window.MediaUtils) window.MediaUtils.dispatchStatusChanged(tmdbId, 'edit');
                } else {
                    var msg = 'Save failed: ' + (data.error || 'Unknown error');
                    if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification(msg, 'error');
                    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
                }
            } catch (err) {
                if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Save failed: ' + err.message, 'error');
                if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
            }
        },

        openDeleteModalForMovieHunt() {
            var decoded = _decodeInstanceValue(this.selectedInstanceName || '');
            if (decoded.appType !== 'movie_hunt' || !decoded.name) return;
            var inst = this.movieInstances.find(function(i) { return i.compoundValue === this.selectedInstanceName; }.bind(this));
            var instanceId = inst && inst.id != null ? inst.id : null;
            if (instanceId == null) return;

            // Use shared MovieCardDeleteModal directly
            if (window.MovieCardDeleteModal) {
                var movie = this.currentMovie;
                var status = this.currentMovieStatusForMH || null;
                var hasFile = !!(status && status.has_file);
                var movieStatus = hasFile ? 'available' : 'requested';
                var filePath = (status && status.path) || (status && status.root_folder_path) || '';
                var self = this;
                window.MovieCardDeleteModal.open(movie, {
                    instanceName: decoded.name,
                    instanceId: instanceId,
                    status: movieStatus,
                    hasFile: hasFile,
                    filePath: filePath,
                    appType: 'movie_hunt',
                    onDeleted: function() {
                        self.closeDetail();
                    }
                });
            }
        },

        /**
         * Fetches detailed movie status and updates: info bar, toolbar visibility,
         * force search/upgrade button, and action button area.
         * This is the single source of truth for the detail page state.
         */
        async updateDetailInfoBar(forceProbe) {
            var self = this;
            var pathEl = document.getElementById('requestarr-ib-path');
            var statusEl = document.getElementById('requestarr-ib-status');
            var profileEl = document.getElementById('requestarr-ib-profile');
            var sizeEl = document.getElementById('requestarr-ib-size');
            if (!pathEl || !statusEl) return;

            var decoded = _decodeInstanceValue(this.selectedInstanceName || '');
            var tmdbId = this.currentMovie && (this.currentMovie.tmdb_id || this.currentMovie.id);
            if (!tmdbId) return;

            var data = null;
            var isMovieHunt = decoded.appType === 'movie_hunt';

            // ── Fetch status from correct API ──
            if (isMovieHunt && decoded.name) {
                var inst = this.movieInstances.find(function(i) { return i.compoundValue === self.selectedInstanceName; });
                var instanceId = inst && inst.id != null ? inst.id : null;
                if (instanceId == null) {
                    this._setInfoBarNotFound(pathEl, statusEl, profileEl, sizeEl);
                    this._updateToolbarForStatus(false, false, isMovieHunt);
                    return;
                }
                try {
                    var qs = 'tmdb_id=' + tmdbId + '&instance_id=' + instanceId + '&t=' + Date.now();
                    if (forceProbe) qs += '&force_probe=true';
                    var resp = await fetch('./api/movie-hunt/movie-status?' + qs);
                    data = await resp.json();
                    this.currentMovieStatusForMH = data;
                } catch (err) {
                    console.error('[RequestarrDetail] Movie Hunt detail bar error:', err);
                    this.currentMovieStatusForMH = null;
                    this._setInfoBarNotFound(pathEl, statusEl, profileEl, sizeEl);
                    this._updateToolbarForStatus(false, false, isMovieHunt);
                    return;
                }
            } else if (decoded.appType === 'radarr' && decoded.name) {
                try {
                    var resp = await fetch('./api/requestarr/movie-detail-status?tmdb_id=' + tmdbId + '&instance=' + encodeURIComponent(decoded.name) + '&t=' + Date.now());
                    data = await resp.json();
                } catch (err) {
                    console.error('[RequestarrDetail] Radarr detail bar error:', err);
                    this._setInfoBarNotFound(pathEl, statusEl, profileEl, sizeEl);
                    this._updateToolbarForStatus(false, false, false);
                    return;
                }
            } else {
                this._setInfoBarNotFound(pathEl, statusEl, profileEl, sizeEl);
                this._updateToolbarForStatus(false, false, false);
                return;
            }

            // ── Not found in collection ──
            if (!data || !data.success || !data.found) {
                this._setInfoBarNotFound(pathEl, statusEl, profileEl, sizeEl);
                this._updateToolbarForStatus(false, false, isMovieHunt);
                return;
            }

            // ── Found — update info bar ──
            var displayPath = data.path || data.root_folder_path || '-';
            pathEl.textContent = displayPath;
            pathEl.title = displayPath;

            var isDownloaded = (data.status || '').toLowerCase() === 'downloaded';
            var cls = '', icon = '', label = '';
            if (isDownloaded) { cls = 'mh-badge-ok'; icon = 'fa-check-circle'; label = 'Downloaded'; }
            else if (data.status === 'missing') { cls = 'mh-badge-warn'; icon = 'fa-exclamation-circle'; label = 'Requested'; }
            else { cls = 'mh-badge-warn'; icon = 'fa-clock'; label = 'Requested'; }
            statusEl.innerHTML = '<span class="mh-badge ' + cls + '"><i class="fas ' + icon + '"></i> ' + label + '</span>';

            if (profileEl) profileEl.textContent = data.quality_profile || '-';

            // Size + optional file quality badge
            if (sizeEl) {
                if (data.file_quality) {
                    sizeEl.innerHTML = this.formatFileSize(data.file_size || 0) +
                        ' <span class="mh-badge mh-badge-quality">' + this.escapeHtml(data.file_quality) + '</span>';
                } else {
                    sizeEl.textContent = this.formatFileSize(data.file_size || 0);
                }
            }

            // ── Row 2: Resolution, Codec, Score, Availability ──
            var row2 = document.getElementById('requestarr-info-bar-row2');
            if (row2) {
                var resEl = document.getElementById('requestarr-ib-resolution');
                var codecEl = document.getElementById('requestarr-ib-codec');
                var scoreEl = document.getElementById('requestarr-ib-score');
                var availEl = document.getElementById('requestarr-ib-availability');
                var availMap = { 'announced': 'Announced', 'inCinemas': 'In Cinemas', 'released': 'Released' };

                if (data.has_file) {
                    row2.style.display = '';
                    if (resEl) resEl.textContent = data.file_resolution || '-';
                    // Build codec/audio string from granular or combined data
                    if (codecEl) {
                        var codecStr = '';
                        if (data.file_video_codec || data.file_audio_codec) {
                            var parts = [];
                            if (data.file_video_codec) parts.push(data.file_video_codec);
                            if (data.file_audio_codec) {
                                var audioStr = data.file_audio_codec;
                                if (data.file_audio_channels && data.file_audio_channels !== 'Mono' && data.file_audio_channels !== 'Stereo' && data.file_audio_channels !== '0ch') {
                                    audioStr += ' ' + data.file_audio_channels;
                                } else if (data.file_audio_channels) {
                                    audioStr += ' (' + data.file_audio_channels + ')';
                                }
                                parts.push(audioStr);
                            }
                            codecStr = parts.join(' / ');
                        } else {
                            codecStr = data.file_codec || '-';
                        }
                        codecEl.textContent = codecStr || '-';
                    }

                    // Score with hover tooltip for breakdown
                    if (scoreEl) {
                        var scoreVal = data.file_score;
                        if (scoreVal != null) {
                            var scoreClass = scoreVal >= 0 ? 'mh-score-pos' : 'mh-score-neg';
                            var breakdown = data.file_score_breakdown || 'No custom format matches';
                            scoreEl.innerHTML = '<span class="mh-score-badge ' + scoreClass + '" title="' + this.escapeHtml(breakdown) + '">' + scoreVal + '</span>';
                        } else {
                            scoreEl.textContent = '-';
                        }
                    }

                    if (availEl) {
                        var avail = data.minimum_availability || 'released';
                        availEl.textContent = availMap[avail] || avail;
                    }
                } else if (data.found) {
                    // Show row with just availability for non-downloaded but tracked movies
                    row2.style.display = '';
                    if (resEl) resEl.textContent = '-';
                    if (codecEl) codecEl.textContent = '-';
                    if (scoreEl) scoreEl.textContent = '-';
                    if (availEl) {
                        var avail = data.minimum_availability || 'released';
                        availEl.textContent = availMap[avail] || avail;
                    }
                } else {
                    row2.style.display = 'none';
                }
            }

            // ── Update toolbar and action buttons ──
            this._updateToolbarForStatus(true, isDownloaded, isMovieHunt, data);
        },

        /** Helper: set info bar to "Not in Collection" */
        _setInfoBarNotFound(pathEl, statusEl, profileEl, sizeEl) {
            if (pathEl) pathEl.textContent = '-';
            if (statusEl) statusEl.innerHTML = '<span class="mh-badge mh-badge-none">Not in Collection</span>';
            if (profileEl) profileEl.textContent = '-';
            if (sizeEl) sizeEl.textContent = '-';
            // Hide Row 2
            var row2 = document.getElementById('requestarr-info-bar-row2');
            if (row2) row2.style.display = 'none';
        },

        /**
         * Update toolbar buttons and action area based on movie status.
         *
         * NOT in collection:
         *   Toolbar-left:  Back, Search Movie (to request)
         *   Toolbar-right: Hide icon (eye-slash → add to hidden media)
         *   Action area:   "Request Movie" button
         *
         * IN collection (requested):
         *   Toolbar-left:  Back, Refresh, Force Search
         *   Toolbar-right: Edit, Delete (trash)
         *   Action area:   empty (status bar shows state)
         *
         * IN collection (downloaded):
         *   Toolbar-left:  Back, Refresh, Force Upgrade
         *   Toolbar-right: Edit, Delete (trash)
         *   Action area:   empty (status bar shows state)
         */
        _updateToolbarForStatus(isFound, isDownloaded, isMovieHunt, statusData) {
            var self = this;

            // ── Toolbar management buttons ──
            var editBtn = document.getElementById('requestarr-detail-edit');
            var deleteBtn = document.getElementById('requestarr-detail-delete');
            var refreshBtn = document.getElementById('requestarr-detail-refresh');

            // Edit, Delete, Refresh only for items in collection (Movie Hunt only)
            if (editBtn) editBtn.style.display = (isFound && isMovieHunt) ? '' : 'none';
            if (deleteBtn) deleteBtn.style.display = (isFound && isMovieHunt) ? '' : 'none';
            if (refreshBtn) refreshBtn.style.display = (isFound && isMovieHunt) ? '' : 'none';

            // ── Monitor toggle — show only when movie is in collection (Movie Hunt) ──
            var monitorWrap = document.getElementById('requestarr-movie-monitor-wrap');
            var monitorBtn = document.getElementById('requestarr-movie-monitor-btn');
            if (monitorWrap && monitorBtn) {
                if (isFound && isMovieHunt) {
                    monitorWrap.style.display = '';
                    var monitored = statusData ? statusData.monitored !== false : true;
                    var icon = monitorBtn.querySelector('i');
                    if (icon) icon.className = monitored ? 'fas fa-bookmark' : 'far fa-bookmark';
                } else {
                    monitorWrap.style.display = 'none';
                }
            }

            // ── Hide button (eye-slash) — only when NOT in collection ──
            var hideBtn = document.getElementById('requestarr-detail-hide');
            if (hideBtn) hideBtn.style.display = (!isFound && isMovieHunt) ? '' : 'none';

            // ── Search Movie button — only when NOT in collection ──
            var searchMovieBtn = document.getElementById('requestarr-detail-search-movie');
            if (searchMovieBtn) searchMovieBtn.style.display = (!isFound && isMovieHunt) ? '' : 'none';

            // ── Force Search / Force Upgrade — only for Movie Hunt in collection ──
            var forceContainer = document.getElementById('requestarr-detail-force-container');
            if (forceContainer) {
                if (!isFound || !isMovieHunt) {
                    forceContainer.innerHTML = '';
                } else if (isDownloaded) {
                    forceContainer.innerHTML = '<button class="mh-tb" id="requestarr-detail-force-upgrade" title="Search for a higher-scoring release"><i class="fas fa-arrow-circle-up"></i><span>Force Upgrade</span></button>';
                    var upgradeBtn = document.getElementById('requestarr-detail-force-upgrade');
                    if (upgradeBtn) upgradeBtn.addEventListener('click', function() { self._handleForceUpgrade(); });
                } else {
                    forceContainer.innerHTML = '<button class="mh-tb" id="requestarr-detail-force-search" title="Search indexers and download"><i class="fas fa-search"></i><span>Force Search</span></button>';
                    var searchBtn = document.getElementById('requestarr-detail-force-search');
                    if (searchBtn) searchBtn.addEventListener('click', function() { self._handleForceSearch(); });
                }
            }

            // ── Action button area ──
            var actionsContainer = document.querySelector('.mh-hero-actions');
            if (actionsContainer) {
                if (isFound) {
                    // Status bar already communicates the state
                    actionsContainer.innerHTML = '';
                } else {
                    actionsContainer.innerHTML = '<button class="mh-btn mh-btn-primary" id="requestarr-detail-request-btn"><i class="fas fa-download"></i> Request Movie</button>';
                    var requestBtn = document.getElementById('requestarr-detail-request-btn');
                    if (requestBtn) {
                        requestBtn.addEventListener('click', function() {
                            if (window.RequestarrDiscover && window.RequestarrDiscover.modal) {
                                window.RequestarrDiscover.modal.openModal(
                                    self.currentMovie.tmdb_id, 'movie', self.selectedInstanceName
                                );
                            }
                        });
                    }
                }
            }
        },

        async _handleForceSearch() {
            var decoded = _decodeInstanceValue(this.selectedInstanceName || '');
            if (decoded.appType !== 'movie_hunt' || !decoded.name) return;
            var inst = this.movieInstances.find(function(i) { return i.compoundValue === this.selectedInstanceName; }.bind(this));
            var instanceId = inst && inst.id != null ? inst.id : null;
            if (instanceId == null) return;

            var movie = this.currentMovie;
            if (!movie) return;
            var btn = document.getElementById('requestarr-detail-force-search');
            if (btn) { btn.disabled = true; var icon = btn.querySelector('i'); if (icon) icon.className = 'fas fa-spinner fa-spin'; }

            var notify = function(msg, type) {
                if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification(msg, type);
            };

            try {
                var resp = await fetch('./api/movie-hunt/request?instance_id=' + instanceId, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        title: movie.title || '',
                        year: movie.year || '',
                        tmdb_id: movie.tmdb_id || movie.id,
                        poster_path: movie.poster_path || '',
                        start_search: true,
                        runtime: 90
                    })
                });
                var data = await resp.json();
                if (data.success) {
                    notify('Search complete \u2014 ' + (data.message || 'Sent to download client.'), 'success');
                } else {
                    notify(data.message || 'No matching release found.', 'error');
                }
            } catch (err) {
                notify('Search failed: ' + err.message, 'error');
            }

            if (btn) { btn.disabled = false; var icon = btn.querySelector('i'); if (icon) icon.className = 'fas fa-search'; }
            this.updateDetailInfoBar();
            if (window.MediaUtils) window.MediaUtils.dispatchStatusChanged(movie.tmdb_id || movie.id, 'force-search');
        },

        async _handleForceUpgrade() {
            var decoded = _decodeInstanceValue(this.selectedInstanceName || '');
            if (decoded.appType !== 'movie_hunt' || !decoded.name) return;
            var inst = this.movieInstances.find(function(i) { return i.compoundValue === this.selectedInstanceName; }.bind(this));
            var instanceId = inst && inst.id != null ? inst.id : null;
            if (instanceId == null) return;

            var movie = this.currentMovie;
            var status = this.currentMovieStatusForMH || null;
            if (!movie) return;
            var btn = document.getElementById('requestarr-detail-force-upgrade');
            if (btn) { btn.disabled = true; var icon = btn.querySelector('i'); if (icon) icon.className = 'fas fa-spinner fa-spin'; }

            var notify = function(msg, type) {
                if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification(msg, type);
            };

            try {
                var currentScore = (status && status.file_score != null) ? status.file_score : 0;
                var resp = await fetch('./api/movie-hunt/force-upgrade?instance_id=' + instanceId, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        title: movie.title || '',
                        year: movie.year || '',
                        tmdb_id: movie.tmdb_id || movie.id,
                        current_score: currentScore,
                        quality_profile: (status && status.quality_profile) || '',
                        runtime: 90
                    })
                });
                var data = await resp.json();
                if (data.success) {
                    notify(data.message || 'Upgrade sent to download client.', 'success');
                } else {
                    notify(data.message || 'No higher-scoring release available.', 'info');
                }
            } catch (err) {
                notify('Upgrade search failed: ' + err.message, 'error');
            }

            if (btn) { btn.disabled = false; var icon = btn.querySelector('i'); if (icon) icon.className = 'fas fa-arrow-circle-up'; }
            this.updateDetailInfoBar();
            if (window.MediaUtils) window.MediaUtils.dispatchStatusChanged(movie.tmdb_id || movie.id, 'force-upgrade');
        },

        async toggleMovieMonitor() {
            var decoded = _decodeInstanceValue(this.selectedInstanceName || '');
            if (decoded.appType !== 'movie_hunt') return;
            var inst = this.movieInstances.find(i => i.compoundValue === this.selectedInstanceName);
            var instanceId = inst && inst.id != null ? inst.id : null;
            if (instanceId == null) return;
            var tmdbId = this.currentMovie && (this.currentMovie.tmdb_id || this.currentMovie.id);
            if (!tmdbId) return;

            var btn = document.getElementById('requestarr-movie-monitor-btn');
            if (!btn) return;
            var icon = btn.querySelector('i');
            var currentMonitored = icon && icon.classList.contains('fas');
            var newMonitored = !currentMonitored;

            // Optimistic UI
            if (icon) icon.className = newMonitored ? 'fas fa-bookmark' : 'far fa-bookmark';

            try {
                var resp = await fetch('./api/movie-hunt/collection/' + tmdbId + '/monitor?instance_id=' + instanceId, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ monitored: newMonitored })
                });
                var data = await resp.json();
                if (!resp.ok || data.error) throw new Error(data.error || 'Failed');
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification(newMonitored ? 'Monitor on' : 'Monitor off', 'success');
                }
            } catch (e) {
                if (icon) icon.className = currentMonitored ? 'fas fa-bookmark' : 'far fa-bookmark';
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('Failed to update monitor: ' + e.message, 'error');
                }
            }
        },

        renderMovieDetail(details, originalMovie) {
            const backdropUrl = details.backdrop_path
                ? `https://image.tmdb.org/t/p/original${details.backdrop_path}`
                : (details.poster_path ? `https://image.tmdb.org/t/p/original${details.poster_path}` : '');

            const posterUrl = details.poster_path
                ? `https://image.tmdb.org/t/p/w500${details.poster_path}`
                : './static/images/blackout.jpg';

            const rating = details.vote_average ? Number(details.vote_average).toFixed(1) : 'N/A';
            const year = details.release_date ? new Date(details.release_date).getFullYear() : 'N/A';
            const runtime = details.runtime ? `${Math.floor(details.runtime / 60)}h ${details.runtime % 60}m` : 'N/A';

            const genres = details.genres && details.genres.length > 0
                ? details.genres.map(g => `<span class="mh-genre-tag">${this.escapeHtml(g.name)}</span>`).join('')
                : '<span class="mh-genre-tag">Unknown</span>';

            const overview = details.overview || 'No overview available.';

            // Certification
            let certification = 'Not Rated';
            if (details.release_dates && details.release_dates.results) {
                const usRelease = details.release_dates.results.find(r => r.iso_3166_1 === 'US');
                if (usRelease && usRelease.release_dates && usRelease.release_dates.length > 0) {
                    const cert = usRelease.release_dates[0].certification;
                    if (cert) certification = cert;
                }
            }

            // Status button
            const hasInstances = this.movieInstances.length > 0;
            const inLibrary = originalMovie.in_library || false;
            let actionButton = '';

            if (!hasInstances) {
                actionButton = '<button class="mh-btn" disabled style="background: rgba(55, 65, 81, 0.8); color: #9ca3af; cursor: not-allowed; border: 1px solid rgba(107, 114, 128, 0.5); font-size: 0.95rem; padding: 10px 20px;"><i class="fas fa-server" style="margin-right: 8px; color: #9ca3af;"></i> No Instance Configured \u2014 Add to Get Started</button>';
            } else if (inLibrary) {
                actionButton = '<button class="mh-btn mh-btn-success" disabled><i class="fas fa-check"></i> Already Available</button>';
            } else {
                actionButton = '<button class="mh-btn mh-btn-primary" id="requestarr-detail-request-btn"><i class="fas fa-download"></i> Request Movie</button>';
            }

            // Director and cast
            let director = 'N/A';
            let mainCast = [];

            if (details.credits) {
                if (details.credits.crew) {
                    const directorObj = details.credits.crew.find(c => c.job === 'Director');
                    if (directorObj) director = directorObj.name;
                }
                if (details.credits.cast) {
                    mainCast = details.credits.cast.slice(0, 10);
                }
            }

            // Similar movies
            let similarMovies = [];
            if (details.similar && details.similar.results) {
                similarMovies = details.similar.results.slice(0, 6);
            }

            // Instance selector - combined Movie Hunt + Radarr
            let instanceSelectorHTML = '';
            if (this.movieInstances.length > 0) {
                instanceSelectorHTML = `
                    <div class="mh-hero-instance">
                        <i class="fas fa-server"></i>
                        <select id="requestarr-detail-instance-select">
                            ${this.movieInstances.map(instance => {
                                const selected = instance.compoundValue === this.selectedInstanceName ? 'selected' : '';
                                return `<option value="${this.escapeHtml(instance.compoundValue)}" ${selected}>${this.escapeHtml(instance.label)}</option>`;
                            }).join('')}
                        </select>
                    </div>
                `;
            }

            // Toolbar: full (Movie Hunt) vs minimal (Radarr)
            var decoded = _decodeInstanceValue(this.selectedInstanceName || '');
            var isMovieHunt = decoded.appType === 'movie_hunt';
            var toolbarHTML = '';
            if (isMovieHunt) {
                toolbarHTML = `
                <div class="mh-toolbar" id="requestarr-detail-toolbar">
                    <div class="mh-toolbar-left">
                        <button class="mh-tb" id="requestarr-detail-refresh" title="Refresh" style="display:none"><i class="fas fa-redo-alt"></i><span>Refresh</span></button>
                        <span id="requestarr-detail-force-container"></span>
                        <button class="mh-tb" id="requestarr-detail-search-movie" title="Search Movie" style="display:none"><i class="fas fa-search"></i><span>Search Movie</span></button>
                    </div>
                    <div class="mh-toolbar-right">
                        <button class="mh-tb" id="requestarr-detail-edit" title="Edit" style="display:none"><i class="fas fa-wrench"></i><span>Edit</span></button>
                        <button class="mh-tb mh-tb-danger" id="requestarr-detail-delete" title="Delete" style="display:none"><i class="fas fa-trash-alt"></i></button>
                        <button class="mh-tb" id="requestarr-detail-hide" title="Hide from discovery" style="display:none"><i class="fas fa-eye-slash"></i></button>
                    </div>
                </div>`;
            } else {
                toolbarHTML = `
                <div class="mh-toolbar" id="requestarr-detail-toolbar">
                    <div class="mh-toolbar-left"></div>
                    <div class="mh-toolbar-right"></div>
                </div>`;
            }

            return `
                <!-- Toolbar -->
                ${toolbarHTML}

                <!-- Hero -->
                <div class="mh-hero" style="background-image: url('${backdropUrl}');">
                    <div class="mh-hero-grad">
                        <div class="mh-hero-layout">
                            <div class="mh-hero-poster">
                                <img src="${posterUrl}" alt="${this.escapeHtml(details.title)}" onerror="this.src='./static/images/blackout.jpg'">
                            </div>
                            <div class="mh-hero-info">
                                <div class="mh-hero-title-row">
                                    <h1 class="mh-hero-title">${this.escapeHtml(details.title)}</h1>
                                    <div class="mh-hero-movie-monitor" id="requestarr-movie-monitor-wrap" style="display:none;">
                                        <button type="button" class="mh-monitor-btn" id="requestarr-movie-monitor-btn" title="Toggle monitor movie">
                                            <i class="fas fa-bookmark"></i>
                                        </button>
                                    </div>
                                </div>
                                <div class="mh-hero-meta">
                                    ${certification !== 'Not Rated' ? `<span class="mh-cert">${this.escapeHtml(certification)}</span>` : ''}
                                    <span><i class="fas fa-calendar-alt"></i> ${year}</span>
                                    <span><i class="fas fa-clock"></i> ${runtime}</span>
                                    <span class="mh-star"><i class="fas fa-star"></i> ${rating}</span>
                                </div>
                                <div class="mh-hero-genres">${genres}</div>
                                ${instanceSelectorHTML}
                                <div class="mh-info-bar" id="requestarr-detail-info-bar"${hasInstances ? '' : ' style="display:none"'}>
                                    <div class="mh-ib mh-ib-path">
                                        <div class="mh-ib-label">PATH</div>
                                        <div class="mh-ib-val" id="requestarr-ib-path"><i class="fas fa-spinner fa-spin"></i></div>
                                    </div>
                                    <div class="mh-ib">
                                        <div class="mh-ib-label">STATUS</div>
                                        <div class="mh-ib-val" id="requestarr-ib-status"><i class="fas fa-spinner fa-spin"></i></div>
                                    </div>
                                    <div class="mh-ib">
                                        <div class="mh-ib-label">QUALITY PROFILE</div>
                                        <div class="mh-ib-val" id="requestarr-ib-profile">-</div>
                                    </div>
                                    <div class="mh-ib">
                                        <div class="mh-ib-label">SIZE</div>
                                        <div class="mh-ib-val" id="requestarr-ib-size">-</div>
                                    </div>
                                </div>
                                <div class="mh-info-bar mh-info-bar-row2" id="requestarr-info-bar-row2" style="display:none">
                                    <div class="mh-ib">
                                        <div class="mh-ib-label">Resolution</div>
                                        <div class="mh-ib-val" id="requestarr-ib-resolution">-</div>
                                    </div>
                                    <div class="mh-ib">
                                        <div class="mh-ib-label">Codec / Audio</div>
                                        <div class="mh-ib-val" id="requestarr-ib-codec">-</div>
                                    </div>
                                    <div class="mh-ib">
                                        <div class="mh-ib-label">Custom Format Score</div>
                                        <div class="mh-ib-val" id="requestarr-ib-score">-</div>
                                    </div>
                                    <div class="mh-ib">
                                        <div class="mh-ib-label">Min. Availability</div>
                                        <div class="mh-ib-val" id="requestarr-ib-availability">-</div>
                                    </div>
                                </div>
                                <p class="mh-hero-overview">${this.escapeHtml(overview)}</p>
                                <div class="mh-hero-actions">
                                    ${actionButton}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Body Sections -->
                <div class="mh-detail-body">
                    <!-- Movie Details -->
                    <div class="mh-section">
                        <h2 class="mh-section-title"><i class="fas fa-info-circle"></i> Movie Details</h2>
                        <div class="mh-detail-grid">
                            <div class="mh-grid-item">
                                <div class="mh-grid-label">Director</div>
                                <div class="mh-grid-value">${this.escapeHtml(director)}</div>
                            </div>
                            <div class="mh-grid-item">
                                <div class="mh-grid-label">Release Date</div>
                                <div class="mh-grid-value">${details.release_date || 'N/A'}</div>
                            </div>
                            <div class="mh-grid-item">
                                <div class="mh-grid-label">Rating</div>
                                <div class="mh-grid-value">${certification}</div>
                            </div>
                            <div class="mh-grid-item">
                                <div class="mh-grid-label">Budget</div>
                                <div class="mh-grid-value">${details.budget ? '$' + (details.budget / 1000000).toFixed(1) + 'M' : 'N/A'}</div>
                            </div>
                            <div class="mh-grid-item">
                                <div class="mh-grid-label">Revenue</div>
                                <div class="mh-grid-value">${details.revenue ? '$' + (details.revenue / 1000000).toFixed(1) + 'M' : 'N/A'}</div>
                            </div>
                            <div class="mh-grid-item">
                                <div class="mh-grid-label">Language</div>
                                <div class="mh-grid-value">${details.original_language ? details.original_language.toUpperCase() : 'N/A'}</div>
                            </div>
                        </div>
                    </div>

                    ${mainCast.length > 0 ? `
                    <!-- Cast -->
                    <div class="mh-section">
                        <h2 class="mh-section-title"><i class="fas fa-users"></i> Cast</h2>
                        <div class="mh-cast-row">
                            ${mainCast.map(actor => this.renderCastCard(actor)).join('')}
                        </div>
                    </div>
                    ` : ''}

                    ${similarMovies.length > 0 ? `
                    <!-- Similar Movies -->
                    <div class="mh-section">
                        <h2 class="mh-section-title"><i class="fas fa-film"></i> Similar Movies</h2>
                        <div class="mh-similar-row">
                            ${similarMovies.map(movie => this.renderSimilarCard(movie)).join('')}
                        </div>
                    </div>
                    ` : ''}
                </div>
            `;
        },

        renderCastCard(actor) {
            const photoUrl = actor.profile_path
                ? `https://image.tmdb.org/t/p/w185${actor.profile_path}`
                : './static/images/blackout.jpg';

            return `
                <div class="mh-cast-card">
                    <div class="mh-cast-photo">
                        <img src="${photoUrl}" alt="${this.escapeHtml(actor.name)}" onerror="this.src='./static/images/blackout.jpg'">
                    </div>
                    <div class="mh-cast-name">${this.escapeHtml(actor.name)}</div>
                    <div class="mh-cast-char">${this.escapeHtml(actor.character || 'Unknown')}</div>
                </div>
            `;
        },

        renderSimilarCard(movie) {
            const posterUrl = movie.poster_path
                ? `https://image.tmdb.org/t/p/w185${movie.poster_path}`
                : './static/images/blackout.jpg';

            return `
                <div class="mh-similar-card media-card" data-tmdb-id="${movie.id}">
                    <div class="media-card-poster">
                        <img src="${posterUrl}" alt="${this.escapeHtml(movie.title)}" onerror="this.src='./static/images/blackout.jpg'">
                        <span class="media-type-badge">Movie</span>
                        <div class="media-card-overlay">
                            <div class="media-card-overlay-title">${this.escapeHtml(movie.title)}</div>
                        </div>
                    </div>
                    <div class="media-card-info">
                        <div class="media-card-title">${this.escapeHtml(movie.title)}</div>
                        <div class="media-card-meta">
                            <span class="media-card-year">${movie.release_date ? new Date(movie.release_date).getFullYear() : 'N/A'}</span>
                            <span class="media-card-rating"><i class="fas fa-star"></i> ${movie.vote_average ? Number(movie.vote_average).toFixed(1) : 'N/A'}</span>
                        </div>
                    </div>
                </div>
            `;
        },

        setupDetailInteractions() {
            var self = this;
            this.attachToolbarHandlers();

            // Instance selector: stay on Requestarr; toolbar and data update by instance type (Movie Hunt vs Radarr)
            const instanceSelect = document.getElementById('requestarr-detail-instance-select');
            if (instanceSelect) {
                instanceSelect.addEventListener('change', async () => {
                    const newValue = instanceSelect.value;
                    this.selectedInstanceName = newValue;
                    console.log('[RequestarrDetail] Instance changed to:', this.selectedInstanceName);
                    var isMovieHunt = _decodeInstanceValue(newValue).appType === 'movie_hunt';
                    this.replaceAndAttachToolbar(isMovieHunt);
                    this.updateDetailInfoBar();
                });
                this.updateDetailInfoBar();
            }

            // Request button → Requestarr modal (unified for all instance types)
            const requestBtn = document.getElementById('requestarr-detail-request-btn');
            if (requestBtn && this.currentMovie) {
                requestBtn.addEventListener('click', () => {
                    if (window.RequestarrDiscover && window.RequestarrDiscover.modal) {
                        window.RequestarrDiscover.modal.openModal(
                            this.currentMovie.tmdb_id,
                            'movie',
                            this.selectedInstanceName
                        );
                    }
                });
            }

            // Check for existing request status and update button accordingly
            this._checkRequestStatus();

            // ── Auto-refresh after request/edit/delete via shared event system ──
            if (window.MediaUtils) {
                window.MediaUtils.teardownDetailRefreshListeners(this._refreshHandle);
                this._refreshHandle = window.MediaUtils.setupDetailRefreshListeners({
                    getTmdbId: function() { return self.currentMovie && (self.currentMovie.tmdb_id || self.currentMovie.id); },
                    refreshCallback: function() { self.updateDetailInfoBar(); },
                    label: 'RequestarrDetail'
                });
            }

            // Similar movie cards
            const similarCards = document.querySelectorAll('.mh-similar-card.media-card');
            similarCards.forEach(card => {
                card.addEventListener('click', async () => {
                    const tmdbId = card.getAttribute('data-tmdb-id');
                    if (tmdbId) {
                        try {
                            const details = await this.fetchMovieDetails(tmdbId);
                            if (details) {
                                const movieData = {
                                    tmdb_id: details.id,
                                    id: details.id,
                                    title: details.title,
                                    year: details.release_date ? new Date(details.release_date).getFullYear() : null,
                                    poster_path: details.poster_path,
                                    backdrop_path: details.backdrop_path,
                                    overview: details.overview,
                                    vote_average: details.vote_average,
                                    in_library: false
                                };
                                this.openDetail(movieData, this.options || {}, false);
                            }
                        } catch (error) {
                            console.error('[RequestarrDetail] Error opening similar movie:', error);
                        }
                    }
                });
            });

            // ESC key — store handler so closeDetail() can remove it (prevents stacking)
            if (this._escHandler) {
                document.removeEventListener('keydown', this._escHandler);
            }
            this._escHandler = (e) => {
                if (e.key === 'Escape') {
                    this.closeDetail();
                }
            };
            document.addEventListener('keydown', this._escHandler);
        },

        setupErrorBackButton() {
            const errorBackBtn = document.getElementById('requestarr-detail-back-error');
            if (errorBackBtn) {
                errorBackBtn.addEventListener('click', () => this.closeDetail());
            }
        },

        getLoadingHTML() {
            return `
                <div class="mh-toolbar">
                <div class="movie-detail-loading">
                    <i class="fas fa-spinner fa-spin"></i>
                    <p>Loading movie details...</p>
                </div>
            `;
        },

        getErrorHTML(message) {
            return `
                <div class="movie-detail-loading">
                    <i class="fas fa-exclamation-triangle" style="color: #ef4444;"></i>
                    <p style="color: #ef4444;">${this.escapeHtml(message)}</p>
                </div>
            `;
        },

        escapeHtml(text) {
            if (!text) return '';
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => window.RequestarrDetail.init());
    } else {
        window.RequestarrDetail.init();
    }
})();
