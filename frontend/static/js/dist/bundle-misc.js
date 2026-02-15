
/* === modules/features/requestarr/requestarr-detail.js === */
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
                if (!/^#requestarr-movie\//.test(window.location.hash || '')) {
                    this.closeDetail(true);
                }
            });
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
                if (!this.tmdbApiKey) {
                    const keyResponse = await fetch('./api/movie-hunt/tmdb-key');
                    if (!keyResponse.ok) throw new Error('TMDB key endpoint failed: ' + keyResponse.status);
                    const keyData = await keyResponse.json();
                    this.tmdbApiKey = keyData.api_key;
                }

                if (!this.tmdbApiKey) {
                    console.error('[RequestarrDetail] No TMDB API key available');
                    return null;
                }

                const url = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${this.tmdbApiKey}&append_to_response=credits,similar,videos,release_dates`;
                const response = await fetch(url);

                if (!response.ok) throw new Error(`TMDB API returned ${response.status}`);
                return await response.json();
            } catch (error) {
                console.error('[RequestarrDetail] Error fetching from TMDB:', error);
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
                        '<button class="mh-tb" id="requestarr-detail-back"><i class="fas fa-arrow-left"></i> <span>Back</span></button>' +
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
                '<button class="mh-tb" id="requestarr-detail-back"><i class="fas fa-arrow-left"></i> <span>Back</span></button>' +
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
            if (refreshBtn) refreshBtn.addEventListener('click', () => { this.updateDetailInfoBar(); });
            var editBtn = document.getElementById('requestarr-detail-edit');
            if (editBtn) editBtn.addEventListener('click', () => this.openEditModalForMovieHunt());
            var deleteBtn = document.getElementById('requestarr-detail-delete');
            if (deleteBtn) deleteBtn.addEventListener('click', () => this.openDeleteModalForMovieHunt());

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

        openEditModalForMovieHunt() {
            var decoded = _decodeInstanceValue(this.selectedInstanceName || '');
            if (decoded.appType !== 'movie_hunt' || !decoded.name) return;
            var inst = this.movieInstances.find(function(i) { return i.compoundValue === this.selectedInstanceName; }.bind(this));
            var instanceId = inst && inst.id != null ? inst.id : null;
            if (instanceId == null) return;
            if (!window.MovieHuntDetail || typeof window.MovieHuntDetail.openEditModal !== 'function') return;
            window.MovieHuntDetail.currentMovie = this.currentMovie;
            window.MovieHuntDetail.selectedInstanceId = instanceId;
            window.MovieHuntDetail.currentMovieStatus = this.currentMovieStatusForMH || null;
            window.MovieHuntDetail.openEditModal();
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
        async updateDetailInfoBar() {
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
                    var resp = await fetch('./api/movie-hunt/movie-status?tmdb_id=' + tmdbId + '&instance_id=' + instanceId);
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
                    var resp = await fetch('./api/requestarr/movie-detail-status?tmdb_id=' + tmdbId + '&instance=' + encodeURIComponent(decoded.name));
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
            this._updateToolbarForStatus(true, isDownloaded, isMovieHunt);
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
        _updateToolbarForStatus(isFound, isDownloaded, isMovieHunt) {
            var self = this;

            // ── Toolbar management buttons ──
            var editBtn = document.getElementById('requestarr-detail-edit');
            var deleteBtn = document.getElementById('requestarr-detail-delete');
            var refreshBtn = document.getElementById('requestarr-detail-refresh');

            // Edit, Delete, Refresh only for items in collection (Movie Hunt only)
            if (editBtn) editBtn.style.display = (isFound && isMovieHunt) ? '' : 'none';
            if (deleteBtn) deleteBtn.style.display = (isFound && isMovieHunt) ? '' : 'none';
            if (refreshBtn) refreshBtn.style.display = (isFound && isMovieHunt) ? '' : 'none';

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

        /** Delegate Force Search to Movie Hunt Detail */
        async _handleForceSearch() {
            var decoded = _decodeInstanceValue(this.selectedInstanceName || '');
            if (decoded.appType !== 'movie_hunt' || !decoded.name) return;
            var inst = this.movieInstances.find(function(i) { return i.compoundValue === this.selectedInstanceName; }.bind(this));
            var instanceId = inst && inst.id != null ? inst.id : null;
            if (instanceId == null || !window.MovieHuntDetail) return;

            window.MovieHuntDetail.currentMovie = this.currentMovie;
            window.MovieHuntDetail.selectedInstanceId = instanceId;
            window.MovieHuntDetail.currentDetails = null;
            await window.MovieHuntDetail.handleForceSearch();
            this.updateDetailInfoBar();
        },

        /** Delegate Force Upgrade to Movie Hunt Detail */
        async _handleForceUpgrade() {
            var decoded = _decodeInstanceValue(this.selectedInstanceName || '');
            if (decoded.appType !== 'movie_hunt' || !decoded.name) return;
            var inst = this.movieInstances.find(function(i) { return i.compoundValue === this.selectedInstanceName; }.bind(this));
            var instanceId = inst && inst.id != null ? inst.id : null;
            if (instanceId == null || !window.MovieHuntDetail) return;

            window.MovieHuntDetail.currentMovie = this.currentMovie;
            window.MovieHuntDetail.selectedInstanceId = instanceId;
            window.MovieHuntDetail.currentMovieStatus = this.currentMovieStatusForMH || null;
            await window.MovieHuntDetail.handleForceUpgrade();
            this.updateDetailInfoBar();
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
                        <button class="mh-tb" id="requestarr-detail-back"><i class="fas fa-arrow-left"></i> <span>Back</span></button>
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
                    <div class="mh-toolbar-left">
                        <button class="mh-tb" id="requestarr-detail-back"><i class="fas fa-arrow-left"></i> <span>Back</span></button>
                    </div>
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
                                <h1 class="mh-hero-title">${this.escapeHtml(details.title)}</h1>
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
                    <div class="mh-toolbar-left">
                        <button class="mh-tb" id="requestarr-detail-back-loading"><i class="fas fa-arrow-left"></i> <span>Back</span></button>
                    </div>
                    <div class="mh-toolbar-right"></div>
                </div>
                <div class="movie-detail-loading">
                    <i class="fas fa-spinner fa-spin"></i>
                    <p>Loading movie details...</p>
                </div>
            `;
        },

        getErrorHTML(message) {
            return `
                <div class="mh-toolbar">
                    <div class="mh-toolbar-left">
                        <button class="mh-tb" id="requestarr-detail-back-error"><i class="fas fa-arrow-left"></i> <span>Back</span></button>
                    </div>
                    <div class="mh-toolbar-right"></div>
                </div>
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


/* === modules/features/requestarr/requestarr-tv-detail.js === */
/**
 * Requestarr TV Detail Page – TV Hunt (full page) + Sonarr (limited top bar)
 * Mirrors requestarr-detail.js behavior for movies
 */
(function() {
    'use strict';

    function _encodeInstanceValue(appType, name) {
        return window.MediaUtils ? window.MediaUtils.encodeInstanceValue(appType, name) : (appType + ':' + name);
    }
    function _decodeInstanceValue(value) {
        return window.MediaUtils ? window.MediaUtils.decodeInstanceValue(value, 'sonarr') : { appType: 'sonarr', name: (value || '').split(':')[1] || '' };
    }

    window.RequestarrTVDetail = {
        currentSeries: null,
        tvInstances: [],  // TV Hunt + Sonarr
        selectedInstanceName: null,
        seriesStatus: null,  // { exists, seasons: [{ season_number, episodes: [{ episode_number, status }] }] }

        init() {
            window.addEventListener('popstate', (e) => {
                if (e.state && e.state.requestarrTVDetail) {
                    this.openDetail(e.state.requestarrTVDetail, e.state.options || {}, true);
                } else {
                    this.closeDetail(true);
                }
            });

            window.addEventListener('hashchange', () => {
                const hash = window.location.hash || '';
                const m = hash.match(/^#requestarr-tv\/(\d+)$/);
                if (m) {
                    const tmdbId = parseInt(m[1], 10);
                    this.openDetail({ id: tmdbId, tmdb_id: tmdbId }, {}, true);
                } else {
                    this.closeDetail(true);
                }
            });

            // Restore detail on refresh when URL has #requestarr-tv/ID
            const hash = window.location.hash || '';
            const m = hash.match(/^#requestarr-tv\/(\d+)$/);
            if (m) {
                const tmdbId = parseInt(m[1], 10);
                this.openDetail({ id: tmdbId, tmdb_id: tmdbId }, {}, true);
            }
        },

        async openDetail(series, options = {}, fromHistory = false) {
            if (!series) return;

            this.currentSeries = series;
            this.options = options || {};
            const tmdbId = series.tmdb_id || series.id;

            if (this.tvInstances.length === 0) {
                await this.loadTVInstances();
            }

            let detailView = document.getElementById('requestarr-tv-detail-view');
            if (!detailView) {
                detailView = document.createElement('div');
                detailView.id = 'requestarr-tv-detail-view';
                detailView.className = 'movie-detail-view';
                document.body.appendChild(detailView);
            }

            detailView.innerHTML = this.getLoadingHTML();
            detailView.classList.add('active');

            if (!fromHistory) {
                const url = `${window.location.pathname}${window.location.search}#requestarr-tv/${tmdbId}`;
                history.pushState({ requestarrTVDetail: series, options: this.options }, series.title || series.name, url);
            }

            setTimeout(() => {
                const backBtn = document.getElementById('requestarr-tv-detail-back-loading');
                if (backBtn) backBtn.addEventListener('click', () => this.closeDetail());
            }, 0);

            try {
                const details = await this.fetchSeriesDetails(tmdbId);
                if (details) {
                    this.currentSeries = details; // Update to full TMDB details
                    detailView.innerHTML = this.renderTVDetail(details, series);
                    await this.setupDetailInteractions();
                } else {
                    detailView.innerHTML = this.getErrorHTML('Failed to load series details');
                    this.setupErrorBackButton();
                }
            } catch (error) {
                console.error('[RequestarrTVDetail] Error:', error);
                detailView.innerHTML = this.getErrorHTML('Failed to load series details');
                this.setupErrorBackButton();
            }
        },

        closeDetail(fromHistory = false) {
            const detailView = document.getElementById('requestarr-tv-detail-view');
            if (detailView) detailView.classList.remove('active');

            if (this._escHandler) {
                document.removeEventListener('keydown', this._escHandler);
                this._escHandler = null;
            }

            if (!fromHistory && /^#requestarr-tv\//.test(window.location.hash || '')) {
                history.back();
            }
        },

        async fetchSeriesDetails(tmdbId) {
            try {
                const response = await fetch(`./api/tv-hunt/series/${tmdbId}`);
                if (!response.ok) return null;
                return await response.json();
            } catch (e) {
                console.error('[RequestarrTVDetail] Fetch error:', e);
                return null;
            }
        },

        async loadTVInstances() {
            try {
                const [tvHuntRes, sonarrRes] = await Promise.all([
                    fetch('./api/requestarr/instances/tv_hunt'),
                    fetch('./api/requestarr/instances/sonarr')
                ]);
                const tvHuntData = await tvHuntRes.json();
                const sonarrData = await sonarrRes.json();

                const combined = [];
                if (tvHuntData.instances) {
                    tvHuntData.instances.forEach(inst => {
                        combined.push({
                            name: inst.name,
                            id: inst.id,
                            appType: 'tv_hunt',
                            compoundValue: _encodeInstanceValue('tv_hunt', inst.name),
                            label: 'TV Hunt – ' + inst.name
                        });
                    });
                }
                if (sonarrData.instances) {
                    sonarrData.instances.forEach(inst => {
                        combined.push({
                            name: inst.name,
                            appType: 'sonarr',
                            compoundValue: _encodeInstanceValue('sonarr', inst.name),
                            label: 'Sonarr – ' + inst.name
                        });
                    });
                }

                this.tvInstances = combined;

                if (combined.length > 0) {
                    this.selectedInstanceName = this.options.suggestedInstance || combined[0].compoundValue;
                } else {
                    this.selectedInstanceName = null;
                }
            } catch (e) {
                console.error('[RequestarrTVDetail] Load instances error:', e);
                this.tvInstances = [];
                this.selectedInstanceName = null;
            }
        },

        async checkSeriesStatus(tmdbId, instanceValue) {
            if (!instanceValue) return { exists: false, previously_requested: false };
            try {
                const decoded = _decodeInstanceValue(instanceValue);
                const appType = decoded.appType || 'sonarr';
                const response = await fetch(`./api/requestarr/series-status?tmdb_id=${tmdbId}&instance=${encodeURIComponent(decoded.name)}&app_type=${encodeURIComponent(appType)}&_=${Date.now()}`);
                return await response.json();
            } catch (e) {
                return { exists: false, previously_requested: false };
            }
        },

        escapeHtml(text) {
            if (!text) return '';
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        },

        renderTVDetail(details, originalSeries) {
            const decoded = _decodeInstanceValue(this.selectedInstanceName || '');
            const isTVHunt = decoded.appType === 'tv_hunt';
            const hasTVHuntInstances = this.tvInstances.some(inst => {
                const d = _decodeInstanceValue(inst.compoundValue);
                return d.appType === 'tv_hunt';
            });

            const backdropUrl = details.backdrop_path
                ? `https://image.tmdb.org/t/p/original${details.backdrop_path}`
                : (details.poster_path ? `https://image.tmdb.org/t/p/original${details.poster_path}` : '');

            const posterUrl = details.poster_path
                ? `https://image.tmdb.org/t/p/w500${details.poster_path}`
                : './static/images/blackout.jpg';

            const title = details.name || details.title || 'Unknown';
            const year = details.first_air_date ? new Date(details.first_air_date).getFullYear() : 'N/A';
            const rating = details.vote_average ? Number(details.vote_average).toFixed(1) : 'N/A';
            const genres = details.genres && details.genres.length > 0
                ? details.genres.map(g => `<span class="mh-genre-tag">${this.escapeHtml(g.name)}</span>`).join('')
                : '<span class="mh-genre-tag">Unknown</span>';
            const overview = details.overview || 'No overview available.';

            const hasInstances = this.tvInstances.length > 0;
            const inLibrary = originalSeries.in_library || false;
            let actionButton = '';
            if (!hasInstances) {
                actionButton = '<button class="mh-btn" disabled style="background: rgba(55, 65, 81, 0.8); color: #9ca3af; cursor: not-allowed;"><i class="fas fa-server" style="margin-right: 8px;"></i> No Instance Configured</button>';
            } else if (inLibrary) {
                actionButton = '<button class="mh-btn mh-btn-success" disabled><i class="fas fa-check"></i> Already Available</button>';
            } else {
                actionButton = '<button class="mh-btn mh-btn-primary" id="requestarr-tv-detail-request-btn"><i class="fas fa-download"></i> Request Series</button>';
            }

            let instanceSelectorHTML = '';
            if (this.tvInstances.length > 0) {
                instanceSelectorHTML = `
                    <div class="mh-hero-instance">
                        <i class="fas fa-server"></i>
                        <select id="requestarr-tv-detail-instance-select">
                            ${this.tvInstances.map(inst => {
                                const selected = inst.compoundValue === this.selectedInstanceName ? 'selected' : '';
                                return `<option value="${this.escapeHtml(inst.compoundValue)}" ${selected}>${this.escapeHtml(inst.label)}</option>`;
                            }).join('')}
                        </select>
                    </div>
                `;
            }

            const toolbarHTML = `
                <div class="mh-toolbar" id="requestarr-tv-detail-toolbar">
                    <div class="mh-toolbar-left">
                        <button class="mh-tb" id="requestarr-tv-detail-back"><i class="fas fa-arrow-left"></i> <span>Back</span></button>
                    </div>
                    <div class="mh-toolbar-right">
                        ${isTVHunt ? '<button class="mh-tb" id="requestarr-tv-search-monitored"><i class="fas fa-search"></i> <span>Search Monitored</span></button>' : ''}
                    </div>
                </div>`;

            const seasonsHTML = this.renderSeasonsSection(details);

            return `
                ${toolbarHTML}
                <div class="mh-hero" style="background-image: url('${backdropUrl}');">
                    <div class="mh-hero-grad">
                        <div class="mh-hero-layout">
                            <div class="mh-hero-poster">
                                <img src="${posterUrl}" alt="${this.escapeHtml(title)}" onerror="this.src='./static/images/blackout.jpg'">
                            </div>
                            <div class="mh-hero-info">
                                <div class="mh-hero-title-row">
                                    <h1 class="mh-hero-title">${this.escapeHtml(title)}</h1>
                                    ${hasTVHuntInstances ? '<div class="mh-hero-series-monitor" id="requestarr-tv-series-monitor-wrap" style="display:none;"><button type="button" class="mh-monitor-btn" id="requestarr-tv-series-monitor-btn" title="Toggle monitor series"><i class="fas fa-bookmark"></i></button></div>' : ''}
                                </div>
                                <div class="mh-hero-meta">
                                    <span><i class="fas fa-calendar-alt"></i> ${year}</span>
                                    <span class="mh-star"><i class="fas fa-star"></i> ${rating}</span>
                                </div>
                                <div class="mh-hero-genres">${genres}</div>
                                ${instanceSelectorHTML}
                                <div class="mh-info-bar" id="requestarr-tv-detail-info-bar"${hasInstances ? '' : ' style="display:none"'}>
                                    <div class="mh-ib mh-ib-path">
                                        <div class="mh-ib-label">PATH</div>
                                        <div class="mh-ib-val" id="requestarr-tv-ib-path"><i class="fas fa-spinner fa-spin"></i></div>
                                    </div>
                                    <div class="mh-ib">
                                        <div class="mh-ib-label">STATUS</div>
                                        <div class="mh-ib-val" id="requestarr-tv-ib-status"><i class="fas fa-spinner fa-spin"></i></div>
                                    </div>
                                    <div class="mh-ib">
                                        <div class="mh-ib-label">EPISODES</div>
                                        <div class="mh-ib-val" id="requestarr-tv-ib-episodes"><i class="fas fa-spinner fa-spin"></i></div>
                                    </div>
                                </div>
                                <p class="mh-hero-overview">${this.escapeHtml(overview)}</p>
                                <div class="mh-hero-actions" id="requestarr-tv-detail-actions" style="${isTVHunt ? 'display:none' : ''}">${actionButton}</div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="mh-detail-body">
                    ${seasonsHTML}
                </div>
            `;
        },

        renderSeasonsSection(details) {
            const decoded = _decodeInstanceValue(this.selectedInstanceName || '');
            const isTVHunt = decoded.appType === 'tv_hunt';
            const seasonIcon = 'fa-download';
            const seasons = details.seasons || [];
            // Sort newest first (by season number; specials last)
            const sorted = [...seasons].sort((a, b) => {
                if (a.season_number === 0) return 1;
                if (b.season_number === 0) return -1;
                return b.season_number - a.season_number;
            });

            if (sorted.length === 0) return '';

            let html = '<div class="mh-section"><h2 class="mh-section-title"><i class="fas fa-layer-group"></i> Seasons</h2><div class="requestarr-tv-seasons-list">';
            sorted.forEach(season => {
                const name = season.name || ('Season ' + season.season_number);
                const total = season.episode_count != null ? season.episode_count : 0;
                const monitorBtn = isTVHunt ? '<button type="button" class="mh-monitor-btn mh-monitor-season mh-tv-hunt-only" data-season="' + season.season_number + '" title="Toggle monitor season"><i class="fas fa-bookmark"></i></button>' : '';
                const requestSeasonBtn = '<div class="season-actions"><button class="season-action-btn request-season-btn request-season-btn-unknown" title="Request entire season" data-season="' + season.season_number + '" data-total="' + total + '"><i class="fas ' + seasonIcon + '"></i></button></div>';
                const badgeSpan = '<span class="season-count-badge season-count-badge-unknown" data-season="' + season.season_number + '" data-total="' + total + '">– / ' + total + '</span>';
                html += `
                    <div class="requestarr-tv-season-item" data-season="${season.season_number}" data-tmdb-id="${details.id}">
                        <span class="season-chevron"><i class="fas fa-chevron-right"></i></span>
                        ${monitorBtn}
                        <span class="season-name">${this.escapeHtml(name)}</span>
                        ${badgeSpan}
                        ${requestSeasonBtn}
                    </div>
                `;
            });
            html += '</div></div>';
            return html;
        },

        updateSeasonCountBadges() {
            const decoded = _decodeInstanceValue(this.selectedInstanceName || '');
            const isTVHunt = decoded.appType === 'tv_hunt';
            const seasonIcon = 'fa-download';
            document.querySelectorAll('.season-count-badge').forEach(el => {
                const seasonItem = el.closest('.requestarr-tv-season-item');
                const seasonNum = parseInt(el.dataset.season, 10);
                const total = parseInt(el.dataset.total, 10) || 0;
                const epMap = this.buildEpisodeStatusMap(seasonNum);
                const available = Object.keys(epMap).length;
                el.textContent = `${available} / ${total}`;
                el.classList.remove('season-count-badge-unknown', 'season-count-badge-empty', 'season-count-badge-partial', 'season-count-badge-complete');
                if (total === 0) {
                    el.classList.add('season-count-badge-unknown');
                } else if (available === 0) {
                    el.classList.add('season-count-badge-empty');
                } else if (available < total) {
                    el.classList.add('season-count-badge-partial');
                } else {
                    el.classList.add('season-count-badge-complete');
                }
                // Update season monitor bookmark (TV Hunt only)
                if (isTVHunt && seasonItem) {
                    const monBtn = seasonItem.querySelector('.mh-monitor-season');
                    if (monBtn) {
                        const seasonData = this.seriesStatus && this.seriesStatus.seasons
                            ? this.seriesStatus.seasons.find(s => (s.season_number ?? s.seasonNumber) === seasonNum)
                            : null;
                        const mon = seasonData ? !!seasonData.monitored : false;
                        monBtn.querySelector('i').className = mon ? 'fas fa-bookmark' : 'far fa-bookmark';
                    }
                }
                // Update Request Season button: icon, color state, disabled when full
                const btn = seasonItem && seasonItem.querySelector('.request-season-btn');
                if (btn) {
                    btn.querySelector('i').className = 'fas ' + seasonIcon;
                    btn.classList.remove('request-season-btn-unknown', 'request-season-btn-empty', 'request-season-btn-partial', 'request-season-btn-complete');
                    if (total === 0) {
                        btn.classList.add('request-season-btn-unknown');
                        btn.disabled = true;
                    } else if (available >= total) {
                        btn.classList.add('request-season-btn-complete');
                        btn.disabled = true;
                    } else if (available > 0) {
                        btn.classList.add('request-season-btn-partial');
                        btn.disabled = false;
                    } else {
                        btn.classList.add('request-season-btn-empty');
                        btn.disabled = false;
                    }
                }
            });
        },

        updateEpisodeMonitorIcons() {
            const decoded = _decodeInstanceValue(this.selectedInstanceName || '');
            if (decoded.appType !== 'tv_hunt') return;
            document.querySelectorAll('.requestarr-tv-season-episodes.expanded').forEach(episodesEl => {
                const seasonItem = episodesEl.previousElementSibling;
                if (!seasonItem || !seasonItem.classList.contains('requestarr-tv-season-item')) return;
                const seasonNum = parseInt(seasonItem.dataset.season, 10);
                const monMap = this.buildEpisodeMonitoredMap(seasonNum);
                episodesEl.querySelectorAll('.mh-monitor-episode').forEach(btn => {
                    const epNum = parseInt(btn.dataset.episode, 10);
                    const monitored = !!monMap[epNum];
                    const icon = btn.querySelector('i');
                    if (icon) icon.className = monitored ? 'fas fa-bookmark' : 'far fa-bookmark';
                });
            });
        },

        async setupDetailInteractions() {
            const self = this;
            const backBtn = document.getElementById('requestarr-tv-detail-back');
            if (backBtn) backBtn.addEventListener('click', () => this.closeDetail());

            const instanceSelect = document.getElementById('requestarr-tv-detail-instance-select');
            if (instanceSelect) {
                instanceSelect.addEventListener('change', async () => {
                    this.selectedInstanceName = instanceSelect.value;
                    this.collapseExpandedSeasons();
                    await this.updateDetailInfoBar();
                });
            }

            const requestBtn = document.getElementById('requestarr-tv-detail-request-btn');
            if (requestBtn && this.currentSeries) {
                requestBtn.addEventListener('click', () => {
                    if (window.RequestarrDiscover && window.RequestarrDiscover.modal) {
                        window.RequestarrDiscover.modal.openModal(
                            this.currentSeries.tmdb_id || this.currentSeries.id,
                            'tv',
                            this.selectedInstanceName
                        );
                    }
                });
            }

            const seriesMonitorBtn = document.getElementById('requestarr-tv-series-monitor-btn');
            if (seriesMonitorBtn) {
                const tmdbId = this.currentSeries.tmdb_id || this.currentSeries.id;
                seriesMonitorBtn.onclick = async () => {
                    await this.toggleMonitor(tmdbId, null, null);
                };
            }

            const searchMonitoredBtn = document.getElementById('requestarr-tv-search-monitored');
            if (searchMonitoredBtn) {
                searchMonitoredBtn.onclick = async () => {
                    await this.searchMonitoredEpisodes();
                };
            }

            // Must load series status first so buildEpisodeStatusMap has Sonarr/TV Hunt data for episode status and resolution
            await this.updateDetailInfoBar();

            const seasonItems = document.querySelectorAll('.requestarr-tv-season-item');
            seasonItems.forEach(item => {
                const requestSeasonBtn = item.querySelector('.request-season-btn');
                if (requestSeasonBtn) {
                    requestSeasonBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.requestSeason(item.dataset.tmdbId, parseInt(item.dataset.season, 10));
                    });
                }
                const monitorSeasonBtn = item.querySelector('.mh-monitor-season');
                if (monitorSeasonBtn) {
                    monitorSeasonBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.toggleMonitor(item.dataset.tmdbId, parseInt(item.dataset.season, 10), null);
                    });
                }

                item.addEventListener('click', (e) => {
                    if (e.target.closest('.season-actions')) return;
                    const seasonNum = parseInt(item.dataset.season, 10);
                    const tmdbId = item.dataset.tmdbId;
                    const body = item.nextElementSibling;
                    if (body && body.classList.contains('requestarr-tv-season-episodes')) {
                        item.classList.toggle('expanded');
                        body.classList.toggle('expanded');
                        return;
                    }
                    const episodesEl = document.createElement('div');
                    episodesEl.className = 'requestarr-tv-season-episodes';
                    episodesEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading episodes...';
                    item.after(episodesEl);
                    item.classList.add('expanded');

                    const decoded = _decodeInstanceValue(this.selectedInstanceName || '');
                    const isTVHunt = decoded.appType === 'tv_hunt';

                    const runExpand = async () => {
                    const renderEpisodes = (eps) => {
                        const epStatusMap = this.buildEpisodeStatusMap(seasonNum);
                        const epMonitoredMap = isTVHunt ? this.buildEpisodeMonitoredMap(seasonNum) : {};
                        const sorted = [...eps].sort((a, b) => (b.episode_number ?? b.episodeNumber ?? 0) - (a.episode_number ?? a.episodeNumber ?? 0));
                        const monitorCol = isTVHunt ? '<th></th>' : '';
                        let tbl = '<table class="episode-table"><thead><tr>' + monitorCol + '<th>#</th><th>Title</th><th>Air Date</th><th>Availability</th><th></th></tr></thead><tbody>';
                        sorted.forEach(ep => {
                            const epNum = ep.episode_number ?? ep.episodeNumber;
                            const title = ep.title || ep.name || '';
                            const ad = ep.air_date || ep.airDate || '';
                            const epInfo = epStatusMap[epNum];
                            const available = !!epInfo;
                            const airDateObj = ad ? new Date(ad) : null;
                            const isFutureAirDate = airDateObj && !isNaN(airDateObj.getTime()) && airDateObj > new Date();
                            const quality = (epInfo && typeof epInfo === 'object' && epInfo.quality) ? epInfo.quality : null;
                            let statusBadge;
                            if (available) {
                                statusBadge = '<span class="mh-ep-status mh-ep-status-ok">' + (quality ? this.escapeHtml(quality) : '<i class="fas fa-check-circle"></i> In Library') + '</span>';
                            } else if (isFutureAirDate) {
                                statusBadge = '<span class="mh-ep-status mh-ep-status-notreleased">Not Released</span>';
                            } else {
                                statusBadge = '<span class="mh-ep-status mh-ep-status-warn">Missing</span>';
                            }
                            const epReqClass = isFutureAirDate ? 'ep-request-btn ep-request-notreleased' : 'ep-request-btn ep-request-missing';
                            const requestBtn = !available ? `<button class="${epReqClass}" data-season="${seasonNum}" data-episode="${epNum}" title="Request episode"><i class="fas fa-download"></i></button>` : '<span class="ep-request-inlibrary"><i class="fas fa-download"></i></span>';
                            const monCell = isTVHunt ? '<td><button type="button" class="mh-monitor-btn mh-monitor-episode" data-season="' + seasonNum + '" data-episode="' + epNum + '" title="Toggle monitor"><i class="' + (epMonitoredMap[epNum] ? 'fas' : 'far') + ' fa-bookmark"></i></button></td>' : '';
                            tbl += `<tr>${monCell}<td>${epNum || ''}</td><td>${this.escapeHtml(title)}</td><td>${ad}</td><td>${statusBadge}</td><td>${requestBtn}</td></tr>`;
                        });
                        tbl += '</tbody></table>';
                        episodesEl.innerHTML = tbl;
                        episodesEl.classList.add('expanded');
                        episodesEl.querySelectorAll('.ep-request-btn').forEach(btn => {
                            btn.addEventListener('click', (ev) => {
                                ev.stopPropagation();
                                this.requestEpisode(item.dataset.tmdbId, parseInt(btn.dataset.season, 10), parseInt(btn.dataset.episode, 10));
                            });
                        });
                        if (isTVHunt) {
                            episodesEl.querySelectorAll('.mh-monitor-episode').forEach(btn => {
                                btn.addEventListener('click', (ev) => {
                                    ev.stopPropagation();
                                    this.toggleMonitor(item.dataset.tmdbId, parseInt(btn.dataset.season, 10), parseInt(btn.dataset.episode, 10));
                                });
                            });
                        }
                    };

                    // Ensure Sonarr status is loaded before rendering (needed for episode status/resolution)
                    if (!isTVHunt && (!this.seriesStatus || !this.seriesStatus.seasons)) {
                        await this.updateDetailInfoBar();
                    }

                    // Always use TMDB (tv-hunt API) for episode list; status comes from Sonarr or TV Hunt via buildEpisodeStatusMap
                    try {
                        const seasonRes = await fetch(`./api/tv-hunt/series/${tmdbId}/season/${seasonNum}`);
                        const seasonData = await seasonRes.json();
                        const eps = seasonData.episodes || [];
                        renderEpisodes(eps);
                    } catch {
                        episodesEl.innerHTML = '<span style="color:#f87171;">Failed to load episodes</span>';
                    }
                    };
                    runExpand();
                });
            });

            if (this._escHandler) {
                document.removeEventListener('keydown', this._escHandler);
            }
            this._escHandler = (e) => {
                if (e.key === 'Escape') this.closeDetail();
            };
            document.addEventListener('keydown', this._escHandler);
        },

        async searchMonitoredEpisodes() {
            if (!this.currentSeries) {
                console.error('[RequestarrTVDetail] No currentSeries for searchMonitored');
                return;
            }
            const tmdbId = this.currentSeries.id || this.currentSeries.tmdb_id;
            const title = this.currentSeries.name || this.currentSeries.title;
            const instanceId = this.getTVHuntInstanceId();
            
            console.log('[RequestarrTVDetail] searchMonitored:', { title, tmdbId, instanceId });

            if (!instanceId) {
                if (window.huntarrUI?.showNotification) window.huntarrUI.showNotification('Select a TV Hunt instance.', 'error');
                return;
            }

            if (!title) {
                if (window.huntarrUI?.showNotification) window.huntarrUI.showNotification('Series title not found.', 'error');
                return;
            }

            const btn = document.getElementById('requestarr-tv-search-monitored');
            if (btn) {
                btn.disabled = true;
                btn.dataset.oldHtml = btn.innerHTML;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> <span>Searching...</span>';
            }

            try {
                const r = await fetch(`./api/tv-hunt/request?instance_id=${instanceId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        series_title: title,
                        tmdb_id: parseInt(tmdbId, 10),
                        search_type: 'monitored',
                        instance_id: instanceId,
                    }),
                });
                const data = await r.json();
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification(data.message || (data.success ? 'Search completed' : 'Search failed'), data.success ? 'success' : 'error');
                }
            } catch (e) {
                console.error('[RequestarrTVDetail] searchMonitored error:', e);
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('Search failed.', 'error');
                }
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = btn.dataset.oldHtml || '<i class="fas fa-search"></i> <span>Search Monitored</span>';
                }
            }
        },

        async updateDetailInfoBar() {
            const pathEl = document.getElementById('requestarr-tv-ib-path');
            const statusEl = document.getElementById('requestarr-tv-ib-status');
            const episodesEl = document.getElementById('requestarr-tv-ib-episodes');
            if (!pathEl || !statusEl) return;

            const tmdbId = this.currentSeries && (this.currentSeries.tmdb_id || this.currentSeries.id);
            if (!tmdbId) return;

            const decoded = _decodeInstanceValue(this.selectedInstanceName || '');
            const isTVHuntInstance = decoded.appType === 'tv_hunt';
            document.querySelectorAll('.mh-tv-hunt-only').forEach(el => { el.style.display = isTVHuntInstance ? '' : 'none'; });
            const seriesMonitorWrap = document.getElementById('requestarr-tv-series-monitor-wrap');
            if (seriesMonitorWrap) seriesMonitorWrap.style.display = 'none';
            if (!decoded.name) {
                this.seriesStatus = null;
                pathEl.textContent = '-';
                statusEl.innerHTML = '<span class="mh-badge mh-badge-warn">Not in Collection</span>';
                if (episodesEl) episodesEl.textContent = '-';
                this.updateSeasonCountBadges();
                this.updateEpisodeMonitorIcons();
                return;
            }

            try {
                const data = await this.checkSeriesStatus(tmdbId, this.selectedInstanceName);
                this.seriesStatus = data;

                const actionsEl = document.getElementById('requestarr-tv-detail-actions');

                if (data.exists) {
                    if (actionsEl && decoded.appType !== 'tv_hunt') {
                        actionsEl.style.display = 'none';
                    }
                    const seriesMonitorWrap = document.getElementById('requestarr-tv-series-monitor-wrap');
                    const seriesMonitorBtn = document.getElementById('requestarr-tv-series-monitor-btn');
                    if (decoded.appType === 'tv_hunt' && seriesMonitorWrap && seriesMonitorBtn) {
                        seriesMonitorWrap.style.display = '';
                        const monitored = !!data.monitored;
                        seriesMonitorBtn.classList.toggle('mh-monitor-on', monitored);
                        seriesMonitorBtn.classList.toggle('mh-monitor-off', !monitored);
                        seriesMonitorBtn.querySelector('i').className = monitored ? 'fas fa-bookmark' : 'far fa-bookmark';
                    }
                    pathEl.textContent = data.path || data.root_folder_path || '-';
                    const avail = data.available_episodes ?? 0;
                    const total = data.total_episodes ?? 0;
                    const missing = data.missing_episodes ?? 0;

                    let statusClass = 'mh-badge-warn';
                    let statusLabel = 'Requested';
                    let statusIcon = 'fa-clock';
                    if (total > 0 && avail === total) {
                        statusClass = 'mh-badge-ok';
                        statusLabel = 'Complete';
                        statusIcon = 'fa-check-circle';
                    } else if (missing > 0) {
                        statusLabel = `${missing} missing`;
                    }
                    statusEl.innerHTML = `<span class="mh-badge ${statusClass}"><i class="fas ${statusIcon}"></i> ${statusLabel}</span>`;
                    if (episodesEl) episodesEl.textContent = `${avail} / ${total}`;
                    this.updateSeasonCountBadges();
                    this.updateEpisodeMonitorIcons();
                } else {
                    if (actionsEl && decoded.appType !== 'tv_hunt') actionsEl.style.display = '';
                    if (seriesMonitorWrap) seriesMonitorWrap.style.display = 'none';
                    pathEl.textContent = '-';
                    statusEl.innerHTML = '<span class="mh-badge mh-badge-warn">Not in Collection</span>';
                    if (episodesEl) episodesEl.textContent = '-';
                    this.updateSeasonCountBadges();
                    this.updateEpisodeMonitorIcons();
                }
            } catch (e) {
                const actionsEl = document.getElementById('requestarr-tv-detail-actions');
                if (actionsEl && decoded.appType !== 'tv_hunt') actionsEl.style.display = '';
                pathEl.textContent = '-';
                statusEl.innerHTML = '<span class="mh-badge mh-badge-warn">Error</span>';
                if (episodesEl) episodesEl.textContent = '-';
                this.updateSeasonCountBadges();
                this.updateEpisodeMonitorIcons();
            }
        },

        collapseExpandedSeasons() {
            const items = document.querySelectorAll('.requestarr-tv-season-item.expanded');
            items.forEach(item => {
                item.classList.remove('expanded');
                const body = item.nextElementSibling;
                if (body && body.classList.contains('requestarr-tv-season-episodes')) {
                    body.remove();
                }
            });
        },

        getTVHuntInstanceId() {
            const decoded = _decodeInstanceValue(this.selectedInstanceName || '');
            if (decoded.appType !== 'tv_hunt') return null;
            const inst = this.tvInstances.find(i => i.compoundValue === this.selectedInstanceName);
            return inst && inst.id ? String(inst.id) : null;
        },

        buildEpisodeStatusMap(seasonNum) {
            const map = {};
            if (!this.seriesStatus || !this.seriesStatus.exists || !this.seriesStatus.seasons) return map;
            const season = this.seriesStatus.seasons.find(s =>
                (s.season_number ?? s.seasonNumber) === seasonNum
            );
            if (!season) return map;
            const eps = season.episodes || [];
            eps.forEach(ep => {
                const epNum = ep.episode_number ?? ep.episodeNumber;
                const avail = (ep.status || '').toLowerCase() === 'available' || !!ep.file_path || !!ep.episodeFile;
                const quality = ep.quality || ep.file_quality || (ep.episodeFile && ep.episodeFile.quality && ep.episodeFile.quality.quality && ep.episodeFile.quality.quality.name);
                if (epNum != null && avail) map[epNum] = quality ? { quality } : true;
            });
            return map;
        },

        buildEpisodeMonitoredMap(seasonNum) {
            const map = {};
            if (!this.seriesStatus || !this.seriesStatus.exists || !this.seriesStatus.seasons) return map;
            const season = this.seriesStatus.seasons.find(s =>
                (s.season_number ?? s.seasonNumber) === seasonNum
            );
            if (!season) return map;
            (season.episodes || []).forEach(ep => {
                const epNum = ep.episode_number ?? ep.episodeNumber;
                if (epNum != null) map[epNum] = !!ep.monitored;
            });
            return map;
        },

        async requestSeason(tmdbId, seasonNum) {
            const decoded = _decodeInstanceValue(this.selectedInstanceName || '');
            if (!decoded.name) {
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('No instance selected.', 'error');
                }
                return;
            }
            if (decoded.appType === 'sonarr') {
                try {
                    const r = await fetch('./api/requestarr/sonarr/season-search', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ tmdb_id: tmdbId, instance: decoded.name, season_number: seasonNum }),
                    });
                    const data = await r.json();
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification(data.success ? (data.message || 'Season search started') : (data.message || 'Request failed'), data.success ? 'success' : 'error');
                    }
                    if (data.success) this.updateDetailInfoBar();
                } catch (e) {
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification('Request failed.', 'error');
                    }
                }
                return;
            }
            const instanceId = this.getTVHuntInstanceId();
            if (!instanceId) {
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('No TV Hunt instance selected.', 'error');
                }
                return;
            }
            const title = (this.currentSeries && (this.currentSeries.title || this.currentSeries.name)) || '';
            if (!title) return;
            try {
                const r = await fetch(`./api/tv-hunt/request?instance_id=${instanceId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        series_title: title,
                        season_number: seasonNum,
                        tmdb_id: tmdbId,
                        search_type: 'season',
                        instance_id: instanceId,
                    }),
                });
                const data = await r.json();
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification(data.success ? (data.message || 'Season search sent!') : (data.message || 'Request failed'), data.success ? 'success' : 'error');
                }
                if (data.success) this.updateDetailInfoBar();
            } catch (e) {
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('Request failed.', 'error');
                }
            }
        },

        async toggleMonitor(tmdbId, seasonNum, episodeNum) {
            console.log('toggleMonitor called:', { tmdbId, seasonNum, episodeNum });
            const instanceId = this.getTVHuntInstanceId();
            if (!instanceId) {
                if (window.huntarrUI?.showNotification) {
                    window.huntarrUI.showNotification('Select a TV Hunt instance to toggle monitor.', 'error');
                }
                return;
            }

            // Ensure we have current status
            if (!this.seriesStatus) {
                console.log('No seriesStatus, fetching...');
                await this.updateDetailInfoBar();
            }
            if (!this.seriesStatus) {
                console.error('Failed to get seriesStatus for toggleMonitor');
                return;
            }

            const currentMonitored = (() => {
                if (seasonNum != null && episodeNum != null) {
                    const map = this.buildEpisodeMonitoredMap(seasonNum);
                    return !!map[episodeNum];
                }
                if (seasonNum != null) {
                    const season = this.seriesStatus.seasons
                        ? this.seriesStatus.seasons.find(s => (s.season_number ?? s.seasonNumber) === seasonNum)
                        : null;
                    return season ? !!season.monitored : false;
                }
                // Series level
                console.log('Series-level toggle, current monitored:', this.seriesStatus.monitored);
                return !!this.seriesStatus.monitored;
            })();

            const newMonitored = !currentMonitored;
            console.log('New monitored state will be:', newMonitored);
            
            // Optimistic UI update for the series button if it's a series-level toggle
            if (seasonNum == null && episodeNum == null) {
                const btn = document.getElementById('requestarr-tv-series-monitor-btn');
                if (btn) {
                    const icon = btn.querySelector('i');
                    if (icon) icon.className = newMonitored ? 'fas fa-bookmark' : 'far fa-bookmark';
                }
            }

            const body = { monitored: newMonitored, instance_id: instanceId };
            if (seasonNum !== undefined && seasonNum !== null) body.season_number = seasonNum;
            if (episodeNum !== undefined && episodeNum !== null) body.episode_number = episodeNum;

            try {
                const r = await fetch(`./api/tv-hunt/collection/${tmdbId}/monitor?instance_id=${instanceId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
                
                if (!r.ok) {
                    const errData = await r.json().catch(() => ({}));
                    throw new Error(errData.error || 'Update failed');
                }
                
                console.log('Monitor toggle success, refreshing info bar...');
                // Full refresh from server
                await this.updateDetailInfoBar();
                
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification(newMonitored ? 'Monitor on' : 'Monitor off', 'success');
                }
            } catch (e) {
                console.error('toggleMonitor error:', e);
                // Revert optimistic update on failure
                if (seasonNum == null && episodeNum == null) {
                    const btn = document.getElementById('requestarr-tv-series-monitor-btn');
                    if (btn) {
                        const icon = btn.querySelector('i');
                        if (icon) icon.className = currentMonitored ? 'fas fa-bookmark' : 'far fa-bookmark';
                    }
                }
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('Failed to update monitor: ' + e.message, 'error');
                }
            }
        },

        async requestEpisode(tmdbId, seasonNum, episodeNum) {
            const decoded = _decodeInstanceValue(this.selectedInstanceName || '');
            if (!decoded.name) {
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('No instance selected.', 'error');
                }
                return;
            }
            if (decoded.appType === 'sonarr') {
                try {
                    const r = await fetch('./api/requestarr/sonarr/episode-search', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ tmdb_id: tmdbId, instance: decoded.name, season_number: seasonNum, episode_number: episodeNum }),
                    });
                    const data = await r.json();
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification(data.success ? (data.message || 'Episode search started') : (data.message || 'Request failed'), data.success ? 'success' : 'error');
                    }
                    if (data.success) this.updateDetailInfoBar();
                } catch (e) {
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification('Request failed.', 'error');
                    }
                }
                return;
            }
            const instanceId = this.getTVHuntInstanceId();
            if (!instanceId) {
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('No TV Hunt instance selected.', 'error');
                }
                return;
            }
            const title = (this.currentSeries && (this.currentSeries.title || this.currentSeries.name)) || '';
            if (!title) return;
            try {
                const r = await fetch(`./api/tv-hunt/request?instance_id=${instanceId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        series_title: title,
                        season_number: seasonNum,
                        episode_number: episodeNum,
                        tmdb_id: tmdbId,
                        search_type: 'episode',
                        instance_id: instanceId,
                    }),
                });
                const data = await r.json();
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification(data.success ? (data.message || 'Episode search sent!') : (data.message || 'Request failed'), data.success ? 'success' : 'error');
                }
                if (data.success) this.updateDetailInfoBar();
            } catch (e) {
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('Request failed.', 'error');
                }
            }
        },

        setupErrorBackButton() {
            const btn = document.getElementById('requestarr-tv-detail-back-error');
            if (btn) btn.addEventListener('click', () => this.closeDetail());
        },

        getLoadingHTML() {
            return `
                <div class="mh-toolbar">
                    <div class="mh-toolbar-left">
                        <button class="mh-tb" id="requestarr-tv-detail-back-loading"><i class="fas fa-arrow-left"></i> <span>Back</span></button>
                    </div>
                    <div class="mh-toolbar-right"></div>
                </div>
                <div class="movie-detail-loading">
                    <i class="fas fa-spinner fa-spin"></i>
                    <p>Loading series details...</p>
                </div>
            `;
        },

        getErrorHTML(message) {
            return `
                <div class="mh-toolbar">
                    <div class="mh-toolbar-left">
                        <button class="mh-tb" id="requestarr-tv-detail-back-error"><i class="fas fa-arrow-left"></i> <span>Back</span></button>
                    </div>
                    <div class="mh-toolbar-right"></div>
                </div>
                <div class="movie-detail-loading">
                    <i class="fas fa-exclamation-triangle" style="color: #ef4444;"></i>
                    <p style="color: #ef4444;">${this.escapeHtml(message)}</p>
                </div>
            `;
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => window.RequestarrTVDetail.init());
    } else {
        window.RequestarrTVDetail.init();
    }
})();


/* === modules/features/nzb-hunt.js === */
/**
 * NZB Hunt - Standalone JavaScript module
 * Independent: does not share state with Movie Hunt, Requestarr, or any other module.
 * Manages NZB Home, Activity (coming soon), and Settings (Folders + Servers).
 */
(function () {
    'use strict';

    function _parseJsonOrThrow(r) {
        return r.json().then(function (data) {
            if (!r.ok) throw new Error(data && (data.error || data.message) || 'Request failed');
            return data;
        });
    }

    window.NzbHunt = {
        currentTab: 'queue',
        _servers: [],
        _categories: [],
        _editIndex: null, // null = add, number = edit
        _catEditIndex: null, // null = add, number = edit
        _pollTimer: null,
        _paused: false,

        /* ──────────────────────────────────────────────
           Initialization
        ────────────────────────────────────────────── */
        init: function () {
            var self = this;
            this.setupTabs();
            this.showTab('queue');

            // Wire up Refresh buttons
            var queueRefresh = document.querySelector('#nzb-hunt-section [data-panel="queue"] .nzb-queue-actions .nzb-btn');
            if (queueRefresh) queueRefresh.addEventListener('click', function () { self._fetchQueueAndStatus(); });

            var historyRefresh = document.querySelector('#nzb-hunt-section [data-panel="history"] .nzb-queue-actions .nzb-btn[title="Refresh"]');
            if (historyRefresh) historyRefresh.addEventListener('click', function () { self._fetchHistory(); });

            var historyClear = document.querySelector('#nzb-hunt-section [data-panel="history"] .nzb-btn-danger');
            if (historyClear) historyClear.addEventListener('click', function () { self._clearHistory(); });

            // Wire up Warnings dismiss all
            var warnDismiss = document.getElementById('nzb-warnings-dismiss-all');
            if (warnDismiss) warnDismiss.addEventListener('click', function () { self._dismissAllWarnings(); });

            // Wire up Pause / Resume ALL button (actually hits backend)
            var pauseBtn = document.getElementById('nzb-pause-btn');
            if (pauseBtn) {
                pauseBtn.addEventListener('click', function () {
                    self._paused = !self._paused;
                    var icon = pauseBtn.querySelector('i');
                    if (icon) icon.className = self._paused ? 'fas fa-play' : 'fas fa-pause';
                    pauseBtn.title = self._paused ? 'Resume all downloads' : 'Pause all downloads';
                    fetch(self._paused ? './api/nzb-hunt/queue/pause-all' : './api/nzb-hunt/queue/resume-all', { method: 'POST' })
                        .then(function (r) { return _parseJsonOrThrow(r); })
                        .then(function () { self._fetchQueueAndStatus(); })
                        .catch(function (e) {
                            console.error('[NzbHunt] Pause/resume error:', e);
                            if (window.huntarrUI && window.huntarrUI.showNotification) {
                                window.huntarrUI.showNotification(e.message || 'Failed to pause/resume', 'error');
                            }
                            self._fetchQueueAndStatus();
                        });
                });
            }

            // Wire up speed limit popover
            this._setupSpeedLimit();

            // Wire up modal controls
            this._setupPrefsModal();

            // Load display prefs from server, then start polling with correct rates
            this._loadDisplayPrefs(function () {
                self._fetchQueueAndStatus();
                self._fetchHistory();
                self._applyRefreshRates();
                console.log('[NzbHunt] Home initialized – polling started');
            });
        },

        /* ──────────────────────────────────────────────
           Queue & Status Polling
        ────────────────────────────────────────────── */
        _fetchQueueAndStatus: function () {
            var self = this;
            var ts = '?t=' + Date.now();
            // Fetch queue, status, and is-client-configured (fallback if status omits it)
            Promise.all([
                fetch('./api/nzb-hunt/queue' + ts).then(function (r) { return r.ok ? r.json() : Promise.resolve({ queue: [] }); }),
                fetch('./api/nzb-hunt/status' + ts).then(function (r) { return r.ok ? r.json() : Promise.resolve({}); }),
                fetch('./api/nzb-hunt/is-client-configured' + ts).then(function (r) { return r.ok ? r.json() : Promise.resolve({}); })
            ]).then(function (results) {
                var queueData = results[0];
                var statusData = results[1];
                var configuredData = results[2];
                if (statusData.nzb_hunt_configured_as_client === undefined && configuredData && typeof configuredData.configured === 'boolean') {
                    statusData.nzb_hunt_configured_as_client = configuredData.configured;
                }
                self._lastStatus = statusData;
                self._lastQueue = queueData.queue || [];
                self._renderQueue(self._lastQueue);
                self._updateStatusBar(statusData);
                self._updateQueueBadge(queueData.queue || []);
                // Update history count from status
                var hBadge = document.getElementById('nzb-history-count');
                if (hBadge) hBadge.textContent = statusData.history_count || 0;
                // Update warnings tab
                self._updateWarnings(statusData.warnings || []);
            }).catch(function (err) {
                console.error('[NzbHunt] Poll error:', err);
            });
        },

        _updateStatusBar: function (status) {
            var speedEl = document.getElementById('nzb-speed');
            var etaEl = document.getElementById('nzb-eta');
            var remainEl = document.getElementById('nzb-remaining');
            var freeEl = document.getElementById('nzb-free-space');

            if (speedEl) speedEl.textContent = status.speed_human || '0 B/s';
            if (etaEl) etaEl.textContent = status.eta_human || this._currentEta || '--';
            if (remainEl) remainEl.textContent = status.remaining_human || this._currentRemaining || '0 B';
            if (freeEl) freeEl.textContent = status.free_space_human || '--';

            // Update speed limit badge
            var limitBadge = document.getElementById('nzb-speed-limit-badge');
            if (limitBadge) {
                if (status.speed_limit_bps && status.speed_limit_bps > 0) {
                    limitBadge.textContent = '⚡ ' + this._formatBytes(status.speed_limit_bps) + '/s';
                    limitBadge.style.display = 'inline';
                } else {
                    limitBadge.style.display = 'none';
                }
            }

            // Sync pause button state with backend
            if (status.paused_global !== undefined) {
                this._paused = status.paused_global;
                var pauseBtn = document.getElementById('nzb-pause-btn');
                if (pauseBtn) {
                    var icon = pauseBtn.querySelector('i');
                    if (icon) icon.className = this._paused ? 'fas fa-play' : 'fas fa-pause';
                    pauseBtn.title = this._paused ? 'Resume all downloads' : 'Pause all downloads';
                }
            }

            // Show warning when NZB Hunt is not configured as a download client (hide when it is)
            var warnEl = document.getElementById('nzb-client-warning');
            if (warnEl) {
                var hasNzbHunt = status.nzb_hunt_configured_as_client === true || status.nzb_hunt_configured_as_client === 'true';
                warnEl.style.display = hasNzbHunt ? 'none' : 'flex';
            }

            // Update Active Connections (number + hover tooltip with per-server breakdown)
            var activeEl = document.getElementById('nzb-active-connections-value');
            var tooltipEl = document.getElementById('nzb-active-connections-tooltip');
            if (activeEl) {
                var connStats = status.connection_stats || [];
                var totalActive = connStats.reduce(function (sum, s) { return sum + (s.active || 0); }, 0);
                var totalMax = connStats.reduce(function (sum, s) { return sum + (s.max || 0); }, 0);
                if (connStats.length === 0) {
                    activeEl.textContent = '0';
                } else {
                    activeEl.textContent = totalMax > 0 ? totalActive + ' / ' + totalMax : String(totalActive);
                }
            }
            if (tooltipEl) {
                var connStats = status.connection_stats || [];
                if (connStats.length === 0) {
                    tooltipEl.textContent = 'Configure servers in Settings';
                } else {
                    var rows = connStats.map(function (s) {
                        return '<span class="nzb-tooltip-server">' + (s.name || s.host || 'Server') + ': ' + (s.active || 0) + ' / ' + (s.max || 0) + '</span>';
                    });
                    tooltipEl.innerHTML = '<strong>Connections per server</strong><div class="nzb-tooltip-servers">' + rows.join('') + '</div>';
                }
            }
        },

        _updateQueueBadge: function (queue) {
            var badge = document.getElementById('nzb-queue-count');
            if (badge) badge.textContent = queue.length;
        },

        /* ──────────────────────────────────────────────
           Queue Rendering
        ────────────────────────────────────────────── */
        _renderQueue: function (queue) {
            var body = document.getElementById('nzb-queue-body');
            if (!body) return;

            if (!queue || queue.length === 0) {
                body.innerHTML =
                    '<div class="nzb-queue-empty">' +
                        '<div class="nzb-queue-empty-icon"><i class="fas fa-inbox"></i></div>' +
                        '<h3>Queue is empty</h3>' +
                        '<p>Downloads will appear here once NZB Hunt is connected to your Usenet setup.</p>' +
                    '</div>';
                return;
            }

            var self = this;
            var filter = (this._queueFilter || '').toLowerCase();
            var filtered = filter
                ? queue.filter(function (q) { return (q.name || '').toLowerCase().indexOf(filter) !== -1; })
                : queue;
            var perPage = this._queuePerPage || 20;
            var totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
            if (this._queuePage > totalPages) this._queuePage = totalPages;
            var start = (this._queuePage - 1) * perPage;
            var page = filtered.slice(start, start + perPage);

            var totalRemaining = 0;
            filtered.forEach(function (q) {
                var tb = q.total_bytes || 0;
                var db = Math.min(q.downloaded_bytes || 0, tb);
                totalRemaining += Math.max(0, tb - db);
            });

            var html =
                '<table class="nzb-queue-table">' +
                '<thead><tr>' +
                '<th class="nzb-col-name">Name</th>' +
                '<th class="nzb-col-cat">Category</th>' +
                '<th class="nzb-col-pct">Progress</th>' +
                '<th class="nzb-col-size">Size</th>' +
                '<th class="nzb-col-speed">Speed</th>' +
                '<th class="nzb-col-eta">ETA</th>' +
                '<th class="nzb-col-status">Status</th>' +
                '<th class="nzb-col-actions"></th>' +
                '</tr></thead><tbody>';

            page.forEach(function (item) {
                var progress = item.progress_pct || 0;
                var stateClass = 'nzb-item-' + (item.state || 'queued');
                var stateIcon = self._stateIcon(item.state);
                var stateLabel = self._stateLabel(item.state);
                var isActivelyDownloading = (item.state === 'downloading' && progress < 100);
                var speed = isActivelyDownloading ? self._formatBytes(item.speed_bps || 0) + '/s' : '—';
                var timeLeft = isActivelyDownloading ? (item.time_left || '—') : '—';
                var db = item.downloaded_bytes || 0;
                var tb = item.total_bytes || 0;
                if (tb > 0 && db > tb) db = tb;
                var downloaded = self._formatBytes(db);
                var totalSize = self._formatBytes(tb);
                var name = self._escHtml(item.name || 'Unknown');
                var catLabel = item.category ? self._escHtml(String(item.category)) : '—';

                // Build status display
                var failedSegs = item.failed_segments || 0;
                var tooltipText = '';
                var statusHtml = '<i class="' + stateIcon + '"></i> ';

                if (item.state === 'assembling') {
                    // Compact: "Assembling 3/49"
                    var cf = item.completed_files || 0;
                    var tf = item.total_files || 0;
                    statusHtml += 'Assembling <span class="nzb-status-sub nzb-status-msg">' + cf + '/' + tf + ' files</span>';
                    if (failedSegs > 0) tooltipText = 'par2 repair will be needed (' + failedSegs + ' missing segments)';
                } else if (item.state === 'extracting') {
                    statusHtml += stateLabel;
                    if (item.status_message) {
                        statusHtml += '<span class="nzb-status-sub nzb-status-msg">' + self._escHtml(item.status_message) + '</span>';
                        tooltipText = item.status_message;
                    }
                } else {
                    statusHtml += stateLabel;
                    if (item.status_message && item.state !== 'downloading') {
                        var msgClass = failedSegs > 0 ? ' nzb-status-msg-warn' : ' nzb-status-msg';
                        statusHtml += '<span class="nzb-status-sub' + msgClass + '">' + self._escHtml(item.status_message) + '</span>';
                        tooltipText = item.status_message;
                    }
                    if (item.state === 'downloading' && item.completed_segments === 0 && item.speed_bps === 0) {
                        statusHtml += '<span class="nzb-status-sub nzb-status-msg">Connecting...</span>';
                    }
                }
                if (!tooltipText && item.error_message) {
                    tooltipText = item.error_message;
                }
                if (tooltipText) {
                    statusHtml = '<span class="nzb-status-with-tooltip" title="">' + statusHtml + '<div class="nzb-cell-tooltip">' + self._escHtml(tooltipText) + '</div></span>';
                }

                // Progress: clean percentage; missing articles in tooltip only
                var missingBytes = item.missing_bytes || 0;
                var missingStr = '';
                if (missingBytes > 0 && item.state === 'downloading') {
                    var mbMissing = missingBytes / (1024 * 1024);
                    missingStr = mbMissing >= 1024 ? (mbMissing / 1024).toFixed(1) + ' GB' :
                                 mbMissing >= 1.0 ? mbMissing.toFixed(1) + ' MB' :
                                 (missingBytes / 1024).toFixed(0) + ' KB';
                }
                var pctHtml = '<span class="nzb-progress-pct">' + progress.toFixed(1) + '%</span>';
                if (missingStr) {
                    pctHtml += ' <i class="fas fa-exclamation-triangle nzb-missing-icon" title="' + _esc(missingStr + ' missing articles') + '"></i>';
                }

                html +=
                    '<tr class="nzb-queue-row ' + stateClass + '" data-nzb-id="' + item.id + '">' +
                        '<td class="nzb-col-name" data-label="Name" title="' + name + '"><span class="nzb-cell-name">' + name + '</span></td>' +
                        '<td class="nzb-col-cat" data-label="Category"><span class="nzb-cell-cat">' + catLabel + '</span></td>' +
                        '<td class="nzb-col-pct" data-label="Progress">' + pctHtml + '</td>' +
                        '<td class="nzb-col-size" data-label="Size">' + downloaded + ' / ' + totalSize + '</td>' +
                        '<td class="nzb-col-speed" data-label="Speed">' + speed + '</td>' +
                        '<td class="nzb-col-eta" data-label="ETA">' + timeLeft + '</td>' +
                        '<td class="nzb-col-status" data-label="Status">' + statusHtml + '</td>' +
                        '<td class="nzb-col-actions" data-label="">' +
                            (item.state === 'downloading' || item.state === 'assembling' || item.state === 'queued' ?
                                '<button class="nzb-item-btn" title="Pause" data-action="pause" data-id="' + item.id + '"><i class="fas fa-pause"></i></button>' : '') +
                            (item.state === 'paused' ?
                                '<button class="nzb-item-btn" title="Resume" data-action="resume" data-id="' + item.id + '"><i class="fas fa-play"></i></button>' : '') +
                            '<button class="nzb-item-btn nzb-item-btn-danger" title="Remove" data-action="remove" data-id="' + item.id + '"><i class="fas fa-trash-alt"></i></button>' +
                        '</td>' +
                    '</tr>';
            });

            html += '</tbody></table>';
            html = '<div class="nzb-table-scroll">' + html + '</div>';
            html += '<div class="nzb-queue-footer">';
            html += '<div class="nzb-hist-search"><i class="fas fa-search"></i><input type="text" id="nzb-queue-search-input" placeholder="Search" value="' + self._escHtml(this._queueFilter) + '" /></div>';
            html += '<div class="nzb-hist-pagination">';
            if (totalPages > 1) {
                html += '<button data-queue-page="prev" ' + (this._queuePage <= 1 ? 'disabled' : '') + '>&laquo;</button>';
                var pages = self._paginationRange(this._queuePage, totalPages);
                for (var i = 0; i < pages.length; i++) {
                    if (pages[i] === '…') {
                        html += '<span>…</span>';
                    } else {
                        html += '<button data-queue-page="' + pages[i] + '" ' + (pages[i] === this._queuePage ? 'class="active"' : '') + '>' + pages[i] + '</button>';
                    }
                }
                html += '<button data-queue-page="next" ' + (this._queuePage >= totalPages ? 'disabled' : '') + '>&raquo;</button>';
            }
            html += '</div>';
            html += '<div class="nzb-hist-stats"><span><i class="fas fa-download"></i>' + self._formatBytes(totalRemaining) + ' Remaining</span><span>' + filtered.length + ' items</span></div>';
            html += '</div>';

            body.innerHTML = html;

            var searchInput = document.getElementById('nzb-queue-search-input');
            if (searchInput) {
                searchInput.addEventListener('input', function () {
                    self._queueFilter = this.value;
                    self._queuePage = 1;
                    self._renderQueue(self._lastQueue || []);
                });
            }
            body.querySelectorAll('[data-queue-page]').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    var val = btn.getAttribute('data-queue-page');
                    if (val === 'prev') { self._queuePage = Math.max(1, self._queuePage - 1); }
                    else if (val === 'next') { self._queuePage++; }
                    else { self._queuePage = parseInt(val, 10); }
                    self._renderQueue(self._lastQueue || []);
                });
            });

            // Wire up item control buttons
            body.querySelectorAll('.nzb-item-btn').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    var action = btn.getAttribute('data-action');
                    var id = btn.getAttribute('data-id');
                    if (action && id) self._queueItemAction(action, id);
                });
            });
        },

        _queueItemAction: function (action, id) {
            var self = this;
            var url, method;
            if (action === 'pause') {
                url = './api/nzb-hunt/queue/' + id + '/pause';
                method = 'POST';
            } else if (action === 'resume') {
                url = './api/nzb-hunt/queue/' + id + '/resume';
                method = 'POST';
            } else if (action === 'remove') {
                url = './api/nzb-hunt/queue/' + id;
                method = 'DELETE';
            } else {
                return;
            }
            fetch(url, { method: method })
                .then(function (r) { return _parseJsonOrThrow(r); })
                .then(function () { self._fetchQueueAndStatus(); })
                .catch(function (err) {
                    console.error('[NzbHunt] Action error:', err);
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification(err.message || 'Action failed', 'error');
                    }
                    self._fetchQueueAndStatus();
                });
        },

        _stateIcon: function (state) {
            switch (state) {
                case 'downloading': return 'fas fa-arrow-down nzb-icon-downloading';
                case 'assembling': return 'fas fa-file-export nzb-icon-assembling';
                case 'queued': return 'fas fa-clock nzb-icon-queued';
                case 'paused': return 'fas fa-pause-circle nzb-icon-paused';
                case 'extracting': return 'fas fa-file-archive nzb-icon-extracting';
                case 'completed': return 'fas fa-check-circle nzb-icon-completed';
                case 'failed': return 'fas fa-exclamation-circle nzb-icon-failed';
                default: return 'fas fa-circle';
            }
        },

        _stateLabel: function (state) {
            switch (state) {
                case 'downloading': return 'Downloading';
                case 'assembling': return 'Assembling';
                case 'queued': return 'Queued';
                case 'paused': return 'Paused';
                case 'extracting': return 'Extracting';
                case 'completed': return 'Completed';
                case 'failed': return 'Failed';
                default: return state || 'Unknown';
            }
        },

        /* ──────────────────────────────────────────────
           Speed Limit Popover
        ────────────────────────────────────────────── */
        _setupSpeedLimit: function () {
            var self = this;
            var control = document.getElementById('nzb-speed-control');
            var popover = document.getElementById('nzb-speed-popover');
            if (!control || !popover) return;

            // Toggle popover on click
            control.addEventListener('click', function (e) {
                // Don't toggle if clicking inside the popover itself
                if (e.target.closest('.nzb-speed-popover')) return;
                var visible = popover.style.display === 'block';
                popover.style.display = visible ? 'none' : 'block';
                if (!visible) {
                    // Highlight the current limit
                    self._highlightCurrentLimit();
                }
            });

            // Close popover when clicking outside
            document.addEventListener('click', function (e) {
                if (!e.target.closest('#nzb-speed-control')) {
                    popover.style.display = 'none';
                }
            });

            // Preset speed limit buttons
            popover.querySelectorAll('.nzb-speed-opt').forEach(function (btn) {
                btn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    var limit = parseInt(btn.getAttribute('data-limit'), 10);
                    self._setSpeedLimit(limit);
                    popover.style.display = 'none';
                });
            });

            // Custom speed limit
            var customBtn = document.getElementById('nzb-speed-custom-btn');
            var customInput = document.getElementById('nzb-speed-custom-input');
            if (customBtn && customInput) {
                customBtn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    var mbps = parseFloat(customInput.value);
                    if (mbps > 0) {
                        self._setSpeedLimit(Math.round(mbps * 1024 * 1024));
                    } else {
                        self._setSpeedLimit(0);
                    }
                    customInput.value = '';
                    popover.style.display = 'none';
                });
                customInput.addEventListener('keydown', function (e) {
                    e.stopPropagation();
                    if (e.key === 'Enter') customBtn.click();
                });
                customInput.addEventListener('click', function (e) {
                    e.stopPropagation();
                });
            }
        },

        _setSpeedLimit: function (bps) {
            var self = this;
            fetch('./api/nzb-hunt/speed-limit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ speed_limit_bps: bps })
            })
                .then(function (r) { return _parseJsonOrThrow(r); })
                .then(function (data) {
                    if (data.success) {
                        var msg = bps > 0
                            ? 'Speed limited to ' + self._formatBytes(bps) + '/s'
                            : 'Speed limit removed';
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification(msg, 'success');
                        }
                        self._fetchQueueAndStatus();
                    }
                })
                .catch(function (err) { console.error('[NzbHunt] Speed limit error:', err); });
        },

        _highlightCurrentLimit: function () {
            var popover = document.getElementById('nzb-speed-popover');
            if (!popover) return;

            // Fetch current limit
            fetch('./api/nzb-hunt/speed-limit?t=' + Date.now())
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    var current = data.speed_limit_bps || 0;
                    popover.querySelectorAll('.nzb-speed-opt').forEach(function (btn) {
                        var val = parseInt(btn.getAttribute('data-limit'), 10);
                        btn.classList.toggle('active', val === current);
                    });
                });
        },

        /* ──────────────────────────────────────────────
           Display Preferences (server-side) – context-aware
        ────────────────────────────────────────────── */
        _displayPrefs: {
            queue:   { refreshRate: 3, perPage: 20 },
            history: { refreshRate: 30, perPage: 20, dateFormat: 'relative', showCategory: false, showSize: false, showIndexer: false }
        },
        _histPollTimer: null,
        _prefsLoaded: false,

        _loadDisplayPrefs: function (callback) {
            var self = this;
            fetch('./api/nzb-hunt/settings/display-prefs?t=' + Date.now())
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    if (data.queue) {
                        self._displayPrefs.queue.refreshRate = data.queue.refreshRate || 3;
                        self._displayPrefs.queue.perPage = data.queue.perPage || 20;
                    }
                    if (data.history) {
                        self._displayPrefs.history.refreshRate = data.history.refreshRate || 30;
                        self._displayPrefs.history.perPage = data.history.perPage || 20;
                        self._displayPrefs.history.dateFormat = data.history.dateFormat || 'relative';
                        self._displayPrefs.history.showCategory = !!data.history.showCategory;
                        self._displayPrefs.history.showSize = !!data.history.showSize;
                        self._displayPrefs.history.showIndexer = !!data.history.showIndexer;
                    }
                    self._histPerPage = self._displayPrefs.history.perPage;
                    self._queuePerPage = self._displayPrefs.queue.perPage || 20;
                    self._prefsLoaded = true;
                    console.log('[NzbHunt] Display prefs loaded from server');
                    if (callback) callback();
                })
                .catch(function (err) {
                    console.error('[NzbHunt] Failed to load display prefs:', err);
                    self._prefsLoaded = true;
                    if (callback) callback();
                });
        },

        _saveDisplayPrefs: function (callback) {
            var self = this;
            this._histPerPage = this._displayPrefs.history.perPage;
            fetch('./api/nzb-hunt/settings/display-prefs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(this._displayPrefs)
            })
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    console.log('[NzbHunt] Display prefs saved to server');
                    if (callback) callback(data);
                })
                .catch(function (err) {
                    console.error('[NzbHunt] Failed to save display prefs:', err);
                    if (callback) callback({ success: false });
                });
        },

        _applyRefreshRates: function () {
            var self = this;
            // Queue poll timer
            if (this._pollTimer) clearInterval(this._pollTimer);
            var qRate = (this._displayPrefs.queue.refreshRate || 3) * 1000;
            this._pollTimer = setInterval(function () { self._fetchQueueAndStatus(); }, qRate);

            // History poll timer
            if (this._histPollTimer) clearInterval(this._histPollTimer);
            var hRate = (this._displayPrefs.history.refreshRate || 30) * 1000;
            this._histPollTimer = setInterval(function () { self._fetchHistory(); }, hRate);
        },

        _openPrefsModal: function () {
            var ctx = this.currentTab; // 'queue' or 'history'
            var prefs = this._displayPrefs[ctx];
            var titleEl = document.getElementById('nzb-prefs-title');
            if (titleEl) titleEl.textContent = (ctx === 'queue' ? 'Queue' : 'History') + ' Settings';

            // Show/hide history-only section
            var histSec = document.getElementById('nzb-prefs-history-section');
            if (histSec) histSec.style.display = (ctx === 'history') ? '' : 'none';

            // Populate shared fields
            var el;
            el = document.getElementById('nzb-pref-refresh');
            if (el) el.value = String(prefs.refreshRate || (ctx === 'queue' ? 3 : 30));
            el = document.getElementById('nzb-pref-per-page');
            if (el) el.value = String(prefs.perPage || 20);

            // Populate history-only fields
            if (ctx === 'history') {
                el = document.getElementById('nzb-pref-date-format');
                if (el) el.value = prefs.dateFormat || 'relative';
                el = document.getElementById('nzb-pref-show-category');
                if (el) el.checked = !!prefs.showCategory;
                el = document.getElementById('nzb-pref-show-size');
                if (el) el.checked = !!prefs.showSize;
                el = document.getElementById('nzb-pref-show-indexer');
                if (el) el.checked = !!prefs.showIndexer;
            }

            // Store context for save
            this._prefsContext = ctx;

            var overlay = document.getElementById('nzb-prefs-overlay');
            if (overlay) overlay.style.display = 'flex';
        },

        _closePrefsModal: function () {
            var overlay = document.getElementById('nzb-prefs-overlay');
            if (overlay) overlay.style.display = 'none';
        },

        _savePrefsFromModal: function () {
            var self = this;
            var ctx = this._prefsContext || this.currentTab;
            var prefs = this._displayPrefs[ctx];
            var el;

            el = document.getElementById('nzb-pref-refresh');
            if (el) prefs.refreshRate = parseInt(el.value, 10) || (ctx === 'queue' ? 3 : 30);
            el = document.getElementById('nzb-pref-per-page');
            if (el) prefs.perPage = parseInt(el.value, 10) || 20;

            if (ctx === 'history') {
                el = document.getElementById('nzb-pref-date-format');
                if (el) prefs.dateFormat = el.value;
                el = document.getElementById('nzb-pref-show-category');
                if (el) prefs.showCategory = el.checked;
                el = document.getElementById('nzb-pref-show-size');
                if (el) prefs.showSize = el.checked;
                el = document.getElementById('nzb-pref-show-indexer');
                if (el) prefs.showIndexer = el.checked;
            }

            this._saveDisplayPrefs(function () {
                self._applyRefreshRates();
                self._closePrefsModal();

                if (ctx === 'history') {
                    self._histPage = 1;
                    self._renderHistory();
                }

                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification((ctx === 'queue' ? 'Queue' : 'History') + ' settings saved.', 'success');
                }
            });
        },

        _setupPrefsModal: function () {
            var self = this;
            var gearBtn = document.getElementById('nzb-display-prefs-btn');
            if (gearBtn) gearBtn.addEventListener('click', function () { self._openPrefsModal(); });

            var closeBtn = document.getElementById('nzb-prefs-close');
            if (closeBtn) closeBtn.addEventListener('click', function () { self._closePrefsModal(); });

            var saveBtn = document.getElementById('nzb-prefs-save');
            if (saveBtn) saveBtn.addEventListener('click', function () { self._savePrefsFromModal(); });

            var overlay = document.getElementById('nzb-prefs-overlay');
            if (overlay) {
                overlay.addEventListener('click', function (e) {
                    if (e.target === overlay) self._closePrefsModal();
                });
            }
        },

        /* ──────────────────────────────────────────────
           Warnings Tab
        ────────────────────────────────────────────── */
        _updateWarnings: function (warnings) {
            var tab = document.getElementById('nzb-warnings-tab');
            var badge = document.getElementById('nzb-warnings-count');
            var count = (warnings && warnings.length) || 0;
            // Show/hide the tab
            if (tab) tab.style.display = count > 0 ? '' : 'none';
            if (badge) badge.textContent = count;
            // If warnings panel is visible, render
            this._lastWarnings = warnings || [];
            if (this.currentTab === 'warnings') this._renderWarnings();
        },

        _renderWarnings: function () {
            var body = document.getElementById('nzb-warnings-body');
            if (!body) return;
            var warnings = this._lastWarnings || [];
            if (warnings.length === 0) {
                body.innerHTML =
                    '<div class="nzb-queue-empty">' +
                        '<div class="nzb-queue-empty-icon"><i class="fas fa-check-circle" style="color: #4ade80;"></i></div>' +
                        '<h3>No warnings</h3>' +
                        '<p>Everything looks good.</p>' +
                    '</div>';
                return;
            }
            var self = this;
            var html = '<div class="nzb-warnings-list">';
            warnings.forEach(function (w) {
                var icon = w.level === 'error' ? 'fa-times-circle' : w.level === 'warning' ? 'fa-exclamation-triangle' : 'fa-info-circle';
                var cls = 'nzb-warning-item nzb-warning-' + w.level;
                html +=
                    '<div class="' + cls + '">' +
                        '<div class="nzb-warning-icon"><i class="fas ' + icon + '"></i></div>' +
                        '<div class="nzb-warning-body">' +
                            '<div class="nzb-warning-title">' + self._escHtml(w.title) + '</div>' +
                            '<div class="nzb-warning-msg">' + self._escHtml(w.message) + '</div>' +
                            '<div class="nzb-warning-time">' + self._timeAgo(w.time) + '</div>' +
                        '</div>' +
                        '<button class="nzb-warning-dismiss" data-warn-id="' + self._escHtml(w.id) + '" title="Dismiss"><i class="fas fa-times"></i></button>' +
                    '</div>';
            });
            html += '</div>';
            body.innerHTML = html;
            // Bind dismiss buttons
            body.querySelectorAll('.nzb-warning-dismiss').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    self._dismissWarning(btn.getAttribute('data-warn-id'));
                });
            });
        },

        _dismissWarning: function (warnId) {
            var self = this;
            fetch('./api/nzb-hunt/warnings/dismiss', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: warnId })
            })
                .then(function (r) { return _parseJsonOrThrow(r); })
                .then(function () { self._fetchQueueAndStatus(); })
                .catch(function (e) { console.error('[NzbHunt] Dismiss warning:', e); self._fetchQueueAndStatus(); });
        },

        _dismissAllWarnings: function () {
            var self = this;
            fetch('./api/nzb-hunt/warnings/dismiss', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: '__all__' })
            })
                .then(function (r) { return _parseJsonOrThrow(r); })
                .then(function () { self._fetchQueueAndStatus(); })
                .catch(function (e) { console.error('[NzbHunt] Dismiss all warnings:', e); self._fetchQueueAndStatus(); });
        },

        /* ──────────────────────────────────────────────
           History Rendering  (SABnzbd-inspired)
        ────────────────────────────────────────────── */
        _histPage: 1,
        _histPerPage: 20,
        _histAll: [],
        _histFilter: '',
        _queuePage: 1,
        _queuePerPage: 20,
        _queueFilter: '',
        _lastQueue: [],

        _fetchHistory: function () {
            var self = this;
            fetch('./api/nzb-hunt/history?limit=5000&t=' + Date.now())
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    var hist = data.history || [];
                    // Sort newest first
                    hist.sort(function (a, b) {
                        var ta = new Date(a.completed_at || a.added_at || 0).getTime();
                        var tb = new Date(b.completed_at || b.added_at || 0).getTime();
                        return tb - ta;
                    });
                    self._histAll = hist;
                    self._histPage = 1;
                    self._renderHistory();
                })
                .catch(function (err) { console.error('[NzbHunt] History fetch error:', err); });
        },

        _timeAgo: function (dateStr) {
            if (!dateStr) return '—';
            var now = Date.now();
            var then = new Date(dateStr).getTime();
            var diff = Math.max(0, now - then);
            var sec = Math.floor(diff / 1000);
            if (sec < 60) return 'just now';
            var min = Math.floor(sec / 60);
            if (min < 60) return min + (min === 1 ? ' minute ago' : ' minutes ago');
            var hr = Math.floor(min / 60);
            if (hr < 24) return hr + (hr === 1 ? ' hour ago' : ' hours ago');
            var days = Math.floor(hr / 24);
            if (days < 30) return days + (days === 1 ? ' day ago' : ' days ago');
            var months = Math.floor(days / 30);
            return months + (months === 1 ? ' month ago' : ' months ago');
        },

        _renderHistory: function () {
            var body = document.getElementById('nzb-history-body');
            if (!body) return;

            var all = this._histAll;
            var badge = document.getElementById('nzb-history-count');
            if (badge) badge.textContent = all.length;

            // Filter
            var filter = this._histFilter.toLowerCase();
            var filtered = filter
                ? all.filter(function (h) { return (h.name || '').toLowerCase().indexOf(filter) !== -1; })
                : all;

            // Empty state
            if (!filtered.length) {
                body.innerHTML =
                    '<div class="nzb-queue-empty">' +
                        '<div class="nzb-queue-empty-icon"><i class="fas fa-history"></i></div>' +
                        '<h3>No history yet</h3>' +
                        '<p>Completed downloads will be logged here.</p>' +
                    '</div>';
                return;
            }

            // Pagination
            var perPage = this._histPerPage;
            var totalPages = Math.ceil(filtered.length / perPage);
            if (this._histPage > totalPages) this._histPage = totalPages;
            var start = (this._histPage - 1) * perPage;
            var page = filtered.slice(start, start + perPage);

            // Bandwidth stats
            var totalBytes = 0;
            all.forEach(function (h) { totalBytes += (h.total_bytes || h.downloaded_bytes || 0); });

            var self = this;
            var prefs = this._displayPrefs.history;
            // Same column structure as Queue: NAME | CATEGORY | SIZE | RESULT | AGE | actions
            var html =
                '<table class="nzb-queue-table nzb-history-table">' +
                '<thead><tr>' +
                '<th class="nzb-col-name">Name</th>' +
                '<th class="nzb-col-cat">Category</th>' +
                '<th class="nzb-col-size">Size</th>' +
                '<th class="nzb-col-status">Result</th>' +
                '<th class="nzb-col-eta">Age</th>' +
                '<th class="nzb-col-actions"></th>' +
                '</tr></thead><tbody>';

            page.forEach(function (item) {
                var isSuccess = item.state === 'completed';
                var name = self._escHtml(item.name || 'Unknown');
                var catLabel = item.category ? self._escHtml(String(item.category)) : '—';
                var size = self._formatBytes(item.total_bytes || item.downloaded_bytes || 0);
                var dateVal = item.completed_at || item.added_at;
                var age = prefs.dateFormat === 'absolute'
                    ? (dateVal ? new Date(dateVal).toLocaleString() : '—')
                    : self._timeAgo(dateVal);

                // Result — same styling as Queue STATUS column
                var resultHtml;
                if (isSuccess) {
                    resultHtml = '<i class="fas fa-check-circle nzb-icon-completed"></i> <span class="nzb-hist-result-ok">Completed</span>';
                } else {
                    var shortErr = 'Aborted';
                    if (item.error_message && !/missing article/i.test(item.error_message)) {
                        shortErr = item.error_message.length > 26
                            ? self._escHtml(item.error_message.substring(0, 24)) + '…'
                            : self._escHtml(item.error_message);
                    }
                    resultHtml = '<i class="fas fa-times-circle nzb-icon-failed"></i> <span class="nzb-hist-result-fail">' + shortErr + '</span>';
                    if (item.error_message) {
                        resultHtml = '<span class="nzb-status-with-tooltip" title="">' + resultHtml +
                            '<div class="nzb-cell-tooltip">' + self._escHtml(item.error_message) + '</div></span>';
                    }
                }

                var nzbId = item.nzo_id || item.id || '';

                html += '<tr class="nzb-queue-row ' + (isSuccess ? 'nzb-item-completed' : 'nzb-item-failed') + '">' +
                    '<td class="nzb-col-name" data-label="Name" title="' + name + '"><span class="nzb-cell-name">' + name + '</span></td>' +
                    '<td class="nzb-col-cat" data-label="Category"><span class="nzb-cell-cat">' + catLabel + '</span></td>' +
                    '<td class="nzb-col-size" data-label="Size">' + size + '</td>' +
                    '<td class="nzb-col-status" data-label="Result">' + resultHtml + '</td>' +
                    '<td class="nzb-col-eta" data-label="Age">' + age + '</td>' +
                    '<td class="nzb-col-actions" data-label="">' +
                    '<button type="button" class="nzb-item-btn nzb-item-btn-danger nzb-hist-delete-btn" data-nzb-id="' + nzbId + '" title="Delete"><i class="fas fa-trash-alt"></i></button>' +
                    '</td></tr>';
            });

            html += '</tbody></table>';
            html = '<div class="nzb-table-scroll">' + html + '</div>';
            html += '<div class="nzb-history-footer">';
            html += '<div class="nzb-hist-search"><i class="fas fa-search"></i><input type="text" id="nzb-hist-search-input" placeholder="Search" value="' + self._escHtml(this._histFilter) + '" /></div>';
            html += '<div class="nzb-hist-pagination">';
            if (totalPages > 1) {
                html += '<button data-hist-page="prev" ' + (this._histPage <= 1 ? 'disabled' : '') + '>&laquo;</button>';
                // Show page numbers with ellipsis
                var pages = self._paginationRange(this._histPage, totalPages);
                for (var i = 0; i < pages.length; i++) {
                    if (pages[i] === '…') {
                        html += '<span>…</span>';
                    } else {
                        html += '<button data-hist-page="' + pages[i] + '" ' + (pages[i] === this._histPage ? 'class="active"' : '') + '>' + pages[i] + '</button>';
                    }
                }
                html += '<button data-hist-page="next" ' + (this._histPage >= totalPages ? 'disabled' : '') + '>&raquo;</button>';
            }
            html += '</div>';
            html += '<div class="nzb-hist-stats"><span><i class="fas fa-download"></i>' + self._formatBytes(totalBytes) + ' Total</span><span>' + filtered.length + ' items</span></div>';
            html += '</div>';

            body.innerHTML = html;

            // Wire up search
            var searchInput = document.getElementById('nzb-hist-search-input');
            if (searchInput) {
                searchInput.addEventListener('input', function () {
                    self._histFilter = this.value;
                    self._histPage = 1;
                    self._renderHistory();
                });
            }

            // Wire up pagination
            body.querySelectorAll('[data-hist-page]').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    var val = btn.getAttribute('data-hist-page');
                    if (val === 'prev') { self._histPage = Math.max(1, self._histPage - 1); }
                    else if (val === 'next') { self._histPage++; }
                    else { self._histPage = parseInt(val, 10); }
                    self._renderHistory();
                });
            });

            // Wire up per-row delete
            body.querySelectorAll('.nzb-hist-delete-btn').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    var id = btn.getAttribute('data-nzb-id');
                    if (!id) return;
                    self._deleteHistoryItem(id);
                });
            });
        },

        _paginationRange: function (current, total) {
            if (total <= 7) {
                var arr = [];
                for (var i = 1; i <= total; i++) arr.push(i);
                return arr;
            }
            var pages = [1];
            if (current > 3) pages.push('…');
            for (var p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) {
                pages.push(p);
            }
            if (current < total - 2) pages.push('…');
            pages.push(total);
            return pages;
        },

        _deleteHistoryItem: function (nzbId) {
            var self = this;
            fetch('./api/nzb-hunt/history/' + encodeURIComponent(nzbId), { method: 'DELETE' })
                .then(function (r) { return _parseJsonOrThrow(r); })
                .then(function () { self._fetchHistory(); })
                .catch(function (err) {
                    console.error('[NzbHunt] Delete history item error:', err);
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification(err.message || 'Delete failed', 'error');
                    }
                    self._fetchHistory();
                });
        },

        _clearHistory: function () {
            var self = this;
            fetch('./api/nzb-hunt/history', { method: 'DELETE' })
                .then(function (r) { return _parseJsonOrThrow(r); })
                .then(function () { self._fetchHistory(); })
                .catch(function (err) {
                    console.error('[NzbHunt] Clear history error:', err);
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification(err.message || 'Clear history failed', 'error');
                    }
                    self._fetchHistory();
                });
        },

        /* ──────────────────────────────────────────────
           Utility helpers
        ────────────────────────────────────────────── */
        _formatBytes: function (bytes) {
            if (!bytes || bytes === 0) return '0 B';
            var units = ['B', 'KB', 'MB', 'GB', 'TB'];
            var i = 0;
            var b = bytes;
            while (b >= 1024 && i < units.length - 1) { b /= 1024; i++; }
            return b.toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
        },

        _formatEta: function (seconds) {
            if (!seconds || seconds <= 0) return '--:--';
            var h = Math.floor(seconds / 3600);
            var m = Math.floor((seconds % 3600) / 60);
            var s = seconds % 60;
            if (h > 0) return h + 'h ' + (m < 10 ? '0' : '') + m + 'm';
            return m + 'm ' + (s < 10 ? '0' : '') + s + 's';
        },

        _escHtml: function (str) {
            var d = document.createElement('div');
            d.textContent = str;
            return d.innerHTML;
        },

        /* ──────────────────────────────────────────────
           Stop polling (called when leaving NZB home)
        ────────────────────────────────────────────── */
        stopPolling: function () {
            if (this._pollTimer) {
                clearInterval(this._pollTimer);
                this._pollTimer = null;
            }
            if (this._histPollTimer) {
                clearInterval(this._histPollTimer);
                this._histPollTimer = null;
            }
        },

        initSettings: function () {
            this._setupSettingsTabs();
            this._setupFolderBrowse();
            this._setupServerGrid();
            this._setupServerEditor();
            this._setupBrowseModal();
            this._setupCategoryGrid();
            this._setupCategoryModal();
            this._setupAdvanced();
            this._setupUniversalSettings();
            this._loadUniversalCard();
            this._loadFolders();
            this._loadServers();
            this._loadCategories();
            this._loadAdvanced();
            this._loadProcessing();
            this._updateNzbServersSetupBanner();
            console.log('[NzbHunt] Settings initialized');
        },

        /* ──────────────────────────────────────────────
           NZB Home tabs (Queue / History)
        ────────────────────────────────────────────── */
        setupTabs: function () {
            var self = this;
            var tabs = document.querySelectorAll('#nzb-hunt-section .nzb-tab');
            tabs.forEach(function (tab) {
                tab.addEventListener('click', function () {
                    var target = tab.getAttribute('data-tab');
                    if (target) self.showTab(target);
                });
            });
        },

        showTab: function (tab) {
            this.currentTab = tab;
            document.querySelectorAll('#nzb-hunt-section .nzb-tab').forEach(function (t) {
                t.classList.toggle('active', t.getAttribute('data-tab') === tab);
            });
            document.querySelectorAll('#nzb-hunt-section .nzb-tab-panel').forEach(function (p) {
                p.style.display = p.getAttribute('data-panel') === tab ? 'block' : 'none';
            });
            if (tab === 'history') { this._fetchHistory(); }
            if (tab === 'warnings') { this._renderWarnings(); }
        },

        /* ──────────────────────────────────────────────
           Universal Settings (show on home toggle)
        ────────────────────────────────────────────── */
        _setupUniversalSettings: function () {
            var self = this;
            var editBtn = document.getElementById('nzb-universal-edit-btn');
            var modal = document.getElementById('nzb-universal-modal');
            var backdrop = document.getElementById('nzb-universal-modal-backdrop');
            var closeBtn = document.getElementById('nzb-universal-modal-close');
            var cancelBtn = document.getElementById('nzb-universal-modal-cancel');
            var saveBtn = document.getElementById('nzb-universal-save-btn');
            if (!editBtn || !modal) return;

            function openModal() {
                modal.style.display = 'flex';
            }
            function closeModal() {
                modal.style.display = 'none';
            }
            editBtn.addEventListener('click', function () {
                self._loadUniversalCard();
                openModal();
            });
            if (backdrop) backdrop.addEventListener('click', closeModal);
            if (closeBtn) closeBtn.addEventListener('click', closeModal);
            if (cancelBtn) cancelBtn.addEventListener('click', closeModal);
            if (saveBtn) saveBtn.addEventListener('click', function () {
                self._saveUniversalSettings(closeModal);
            });
            // Escape key
            document.addEventListener('keydown', function (e) {
                if (e.key === 'Escape' && modal.style.display === 'flex') closeModal();
            });
        },

        _loadUniversalCard: function () {
            fetch('./api/nzb-hunt/universal-settings?t=' + Date.now())
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    var showHome = data.show_on_home !== false;
                    var tempFolder = data.temp_folder || '/downloads/incomplete';
                    var catCount = data.category_count || 0;

                    // Update card labels
                    var showLabel = document.getElementById('nzb-universal-show-home-label');
                    if (showLabel) showLabel.textContent = showHome ? 'Enabled' : 'Disabled';

                    var folderLabel = document.getElementById('nzb-universal-temp-folder-label');
                    if (folderLabel) folderLabel.textContent = tempFolder;

                    var catLabel = document.getElementById('nzb-universal-cat-count-label');
                    if (catLabel) catLabel.textContent = catCount + ' auto-generated';

                    // Update status icon
                    var statusIcon = document.getElementById('nzb-universal-status-icon');
                    if (statusIcon) {
                        statusIcon.className = 'instance-status-icon ' + (showHome ? 'status-connected' : 'status-error');
                        statusIcon.title = showHome ? 'Shown on Home' : 'Hidden from Home';
                        statusIcon.innerHTML = '<i class="fas ' + (showHome ? 'fa-check-circle' : 'fa-minus-circle') + '"></i>';
                    }

                    // Update modal toggle
                    var toggle = document.getElementById('nzb-universal-show-home-toggle');
                    if (toggle) toggle.checked = showHome;
                })
                .catch(function (err) {
                    console.error('[NzbHunt] Failed to load universal settings:', err);
                });
        },

        _saveUniversalSettings: function (closeCallback) {
            var toggle = document.getElementById('nzb-universal-show-home-toggle');
            var showHome = toggle ? toggle.checked : true;

            fetch('./api/nzb-hunt/universal-settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ show_on_home: showHome })
            })
                .then(function (r) { return _parseJsonOrThrow(r); })
                .then(function (data) {
                    if (data.success) {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification('Universal settings saved.', 'success');
                        }
                        if (closeCallback) closeCallback();
                        // Refresh card
                        if (window.NzbHunt) window.NzbHunt._loadUniversalCard();
                    } else {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification('Failed to save: ' + (data.error || 'Unknown error'), 'error');
                        }
                    }
                })
                .catch(function (err) {
                    console.error('[NzbHunt] Save universal settings error:', err);
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification('Failed to save settings.', 'error');
                    }
                });
        },

        /* ──────────────────────────────────────────────
           Settings sub-tabs (Folders / Servers)
        ────────────────────────────────────────────── */
        _setupSettingsTabs: function () {
            // Tabs are now in the sidebar, handled by app.js
        },

        _showSettingsTab: function (tab) {
            document.querySelectorAll('#nzb-hunt-settings-section .nzb-settings-panel').forEach(function (p) {
                p.style.display = p.getAttribute('data-settings-panel') === tab ? 'block' : 'none';
            });
            var bc = document.getElementById('nzb-hunt-settings-breadcrumb-current');
            if (bc) {
                var labels = { folders: 'Folders', servers: 'Servers', advanced: 'Advanced' };
                bc.textContent = labels[tab] || tab;
            }
            // Toggle header save button vs sponsor based on tab
            var headerSave = document.getElementById('nzb-save-advanced-header');
            var sponsorSlot = document.getElementById('nzb-hunt-settings-sponsor-slot');
            if (tab === 'advanced') {
                if (headerSave) headerSave.style.display = '';
                if (sponsorSlot) sponsorSlot.style.display = 'none';
            } else {
                if (headerSave) headerSave.style.display = 'none';
                if (sponsorSlot) sponsorSlot.style.display = '';
            }
            // Show/hide setup wizard continue banner on servers tab
            if (tab === 'servers') {
                this._updateNzbServersSetupBanner();
            }
        },

        _updateNzbServersSetupBanner: function () {
            var banner = document.getElementById('nzb-servers-setup-wizard-continue-banner');
            if (!banner) return;
            // Only show if user navigated here from the setup wizard (not on direct page load)
            var fromWizard = false;
            try { fromWizard = sessionStorage.getItem('setup-wizard-active-nav') === '1'; } catch (e) {}
            if (fromWizard) {
                try { sessionStorage.removeItem('setup-wizard-active-nav'); } catch (e) {}
            }
            banner.style.display = fromWizard ? 'flex' : 'none';
        },

        /* ──────────────────────────────────────────────
           Folders  – load / save / browse (combined with categories)
        ────────────────────────────────────────────── */
        _loadFolders: function () {
            fetch('./api/nzb-hunt/settings/folders?t=' + Date.now())
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    var tf = document.getElementById('nzb-temp-folder');
                    if (tf && data.temp_folder !== undefined) tf.value = data.temp_folder;
                })
                .catch(function () { /* use defaults */ });
        },

        _saveFolders: function () {
            var payload = {
                temp_folder: (document.getElementById('nzb-temp-folder') || {}).value || '/downloads/incomplete'
            };
            fetch('./api/nzb-hunt/settings/folders', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })
                .then(function (r) { return _parseJsonOrThrow(r); })
                .then(function (data) {
                    if (data.success) {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification('Temporary folder saved.', 'success');
                        }
                        if (window.NzbHunt) {
                            window.NzbHunt._loadCategories();
                            window.NzbHunt._loadUniversalCard();
                        }
                    }
                })
                .catch(function () {
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification('Failed to save folder.', 'error');
                    }
                });
        },

        _setupFolderBrowse: function () {
            var self = this;
            var browseTemp = document.getElementById('nzb-browse-temp-folder');
            if (browseTemp) {
                browseTemp.addEventListener('click', function () {
                    self._openBrowseModal(document.getElementById('nzb-temp-folder'));
                });
            }
        },

        /* ──────────────────────────────────────────────
           File Browser Modal
        ────────────────────────────────────────────── */
        _browseTarget: null,

        _setupBrowseModal: function () {
            var self = this;
            var backdrop = document.getElementById('nzb-browse-backdrop');
            var closeBtn = document.getElementById('nzb-browse-close');
            var cancelBtn = document.getElementById('nzb-browse-cancel');
            var okBtn = document.getElementById('nzb-browse-ok');
            var upBtn = document.getElementById('nzb-browse-up');

            if (backdrop) backdrop.addEventListener('click', function () { self._closeBrowseModal(); });
            if (closeBtn) closeBtn.addEventListener('click', function () { self._closeBrowseModal(); });
            if (cancelBtn) cancelBtn.addEventListener('click', function () { self._closeBrowseModal(); });
            if (okBtn) okBtn.addEventListener('click', function () { self._confirmBrowse(); });
            if (upBtn) upBtn.addEventListener('click', function () { self._browseParent(); });
        },

        _openBrowseModal: function (targetInput) {
            this._browseTarget = targetInput;
            var modal = document.getElementById('nzb-browse-modal');
            if (!modal) return;
            // Move to body if nested in a section
            if (modal.parentElement !== document.body) document.body.appendChild(modal);
            var pathInput = document.getElementById('nzb-browse-path-input');
            var startPath = (targetInput && targetInput.value) ? targetInput.value : '/';
            if (pathInput) pathInput.value = startPath;
            modal.style.display = 'flex';
            this._loadBrowsePath(startPath);
        },

        _closeBrowseModal: function () {
            var modal = document.getElementById('nzb-browse-modal');
            if (modal) modal.style.display = 'none';
        },

        _confirmBrowse: function () {
            var pathInput = document.getElementById('nzb-browse-path-input');
            if (this._browseTarget && pathInput) {
                this._browseTarget.value = pathInput.value;
                // Auto-save if the target is the temporary folder
                if (this._browseTarget.id === 'nzb-temp-folder') {
                    this._saveFolders();
                }
            }
            this._closeBrowseModal();
        },

        _browseParent: function () {
            var pathInput = document.getElementById('nzb-browse-path-input');
            if (!pathInput) return;
            var cur = pathInput.value || '/';
            if (cur === '/') return;
            var parts = cur.replace(/\/+$/, '').split('/');
            parts.pop();
            var parent = parts.join('/') || '/';
            pathInput.value = parent;
            this._loadBrowsePath(parent);
        },

        _loadBrowsePath: function (path) {
            var list = document.getElementById('nzb-browse-list');
            var pathInput = document.getElementById('nzb-browse-path-input');
            var upBtn = document.getElementById('nzb-browse-up');
            if (!list) return;

            list.innerHTML = '<div style="padding: 20px; text-align: center; color: #94a3b8;"><i class="fas fa-spinner fa-spin"></i> Loading...</div>';

            fetch('./api/nzb-hunt/browse?path=' + encodeURIComponent(path) + '&t=' + Date.now())
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    if (pathInput) pathInput.value = data.path || path;
                    if (upBtn) upBtn.disabled = (data.path === '/');
                    var dirs = data.directories || [];
                    if (dirs.length === 0) {
                        list.innerHTML = '<div style="padding: 20px; text-align: center; color: #64748b;">No subdirectories</div>';
                        return;
                    }
                    list.innerHTML = '';
                    dirs.forEach(function (d) {
                        var item = document.createElement('div');
                        item.className = 'nzb-browse-item';
                        item.innerHTML = '<i class="fas fa-folder"></i> <span style="font-family: monospace; font-size: 0.9rem; word-break: break-all;">' + _esc(d.name) + '</span>';
                        item.addEventListener('click', function () {
                            if (pathInput) pathInput.value = d.path;
                            window.NzbHunt._loadBrowsePath(d.path);
                        });
                        list.appendChild(item);
                    });
                })
                .catch(function () {
                    list.innerHTML = '<div style="padding: 20px; text-align: center; color: #f87171;">Failed to browse directory</div>';
                });
        },

        /* ──────────────────────────────────────────────
           Servers  – CRUD + card rendering
        ────────────────────────────────────────────── */
        _setupServerGrid: function () {
            var self = this;
            var addCard = document.getElementById('nzb-add-server-card');
            if (addCard) {
                addCard.addEventListener('click', function () {
                    self._editIndex = null;
                    self._navigateToServerEditor(null);
                });
            }
        },

        _loadServers: function () {
            var self = this;
            fetch('./api/nzb-hunt/servers?t=' + Date.now())
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    self._servers = data.servers || [];
                    self._renderServerCards();
                })
                .catch(function () { self._servers = []; self._renderServerCards(); });
        },

        _renderServerCards: function () {
            var grid = document.getElementById('nzb-server-grid');
            if (!grid) return;

            // Remove existing server cards (keep the add card)
            var addCard = document.getElementById('nzb-add-server-card');
            grid.innerHTML = '';

            var self = this;
            this._servers.forEach(function (srv, idx) {
                var card = document.createElement('div');
                card.className = 'nzb-server-card';
                var statusDotId = 'nzb-server-status-' + idx;
                var statusTextId = 'nzb-server-status-text-' + idx;
                card.innerHTML =
                    '<div class="nzb-server-card-header">' +
                        '<div class="nzb-server-card-name">' +
                            '<span class="nzb-server-status-dot status-checking" id="' + statusDotId + '" title="Checking..."></span>' +
                            '<i class="fas fa-server"></i> <span>' + _esc(srv.name || 'Server') + '</span>' +
                        '</div>' +
                        '<div class="nzb-server-card-badges">' +
                            '<span class="nzb-badge nzb-badge-priority">P: ' + (srv.priority !== undefined ? srv.priority : 0) + '</span>' +
                            (srv.ssl ? '<span class="nzb-badge nzb-badge-ssl">SSL</span>' : '') +
                            '<span class="nzb-badge ' + (srv.enabled !== false ? 'nzb-badge-enabled' : 'nzb-badge-disabled') + '">' + (srv.enabled !== false ? 'ON' : 'OFF') + '</span>' +
                        '</div>' +
                    '</div>' +
                    '<div class="nzb-server-card-body">' +
                        '<div class="nzb-server-detail"><i class="fas fa-globe"></i> <span>' + _esc(srv.host || '') + ':' + (srv.port || 563) + '</span></div>' +
                        '<div class="nzb-server-detail"><i class="fas fa-plug"></i> <span>' + (srv.connections || 8) + ' connections</span></div>' +
                        (srv.username ? '<div class="nzb-server-detail"><i class="fas fa-user"></i> <span>' + _esc(srv.username) + '</span></div>' : '') +
                        (srv.password_masked ? '<div class="nzb-server-detail"><i class="fas fa-key"></i> <span style="font-family: monospace; letter-spacing: 1px;">' + _esc(srv.password_masked) + '</span></div>' : '') +
                        '<div class="nzb-server-status-line" id="' + statusTextId + '">' +
                            '<i class="fas fa-circle-notch fa-spin" style="font-size: 11px; color: #6366f1;"></i> <span style="font-size: 12px; color: #94a3b8;">Checking connection...</span>' +
                        '</div>' +
                        '<div class="nzb-server-bandwidth">' +
                            '<div class="nzb-server-bandwidth-grid">' +
                                '<span class="nzb-bw-cell"><span class="nzb-bw-label">1h</span><span class="nzb-bw-value">' + _fmtBytes(srv.bandwidth_1h || 0) + '</span></span>' +
                                '<span class="nzb-bw-cell"><span class="nzb-bw-label">24h</span><span class="nzb-bw-value">' + _fmtBytes(srv.bandwidth_24h || 0) + '</span></span>' +
                                '<span class="nzb-bw-cell"><span class="nzb-bw-label">30d</span><span class="nzb-bw-value">' + _fmtBytes(srv.bandwidth_30d || 0) + '</span></span>' +
                                '<span class="nzb-bw-cell"><span class="nzb-bw-label">Total</span><span class="nzb-bw-value">' + _fmtBytes(srv.bandwidth_total || srv.bandwidth_used || 0) + '</span></span>' +
                            '</div>' +
                            '<div class="nzb-server-bandwidth-bar"><div class="nzb-server-bandwidth-fill" style="width: ' + Math.min(100, (srv.bandwidth_pct || 0)) + '%;"></div></div>' +
                        '</div>' +
                    '</div>' +
                    '<div class="nzb-server-card-footer">' +
                        '<button class="nzb-btn" data-action="edit" data-idx="' + idx + '"><i class="fas fa-pen"></i> Edit</button>' +
                        '<button class="nzb-btn nzb-btn-danger" data-action="delete" data-idx="' + idx + '"><i class="fas fa-trash"></i> Delete</button>' +
                    '</div>';

                card.addEventListener('click', function (e) {
                    var btn = e.target.closest('[data-action]');
                    if (!btn) return;
                    var action = btn.getAttribute('data-action');
                    var i = parseInt(btn.getAttribute('data-idx'), 10);
                    if (action === 'edit') {
                        self._editIndex = i;
                        self._navigateToServerEditor(self._servers[i]);
                    } else if (action === 'delete') {
                        var name = (self._servers[i] || {}).name || 'this server';
                        var idx = i;
                        var doDelete = function() {
                            fetch('./api/nzb-hunt/servers/' + idx, { method: 'DELETE' })
                                .then(function (r) { return r.json(); })
                                .then(function (data) {
                                    if (data.success) self._loadServers();
                                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                                        window.huntarrUI.showNotification('Server deleted.', 'success');
                                    }
                                })
                                .catch(function () {
                                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                                        window.huntarrUI.showNotification('Delete failed.', 'error');
                                    }
                                });
                        };
                        if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
                            window.HuntarrConfirm.show({ title: 'Delete Server', message: 'Delete "' + name + '"?', confirmLabel: 'Delete', onConfirm: doDelete });
                        } else {
                            if (!confirm('Delete "' + name + '"?')) return;
                            doDelete();
                        }
                    }
                });

                grid.appendChild(card);
            });

            // Re-add the "Add Server" card at the end
            if (addCard) grid.appendChild(addCard);

            // Auto-test each server's connection status
            this._testAllServerStatuses();
        },

        _testAllServerStatuses: function () {
            var self = this;
            this._servers.forEach(function (srv, idx) {
                if (srv.enabled === false) {
                    // Disabled servers — mark as offline / disabled
                    self._updateServerCardStatus(idx, 'offline', 'Disabled');
                    return;
                }
                // Fire off an async test for each enabled server
                // Pass server_index so backend uses the saved password
                var payload = {
                    host: srv.host || '',
                    port: srv.port || 563,
                    ssl: srv.ssl !== false,
                    username: srv.username || '',
                    password: '',
                    server_index: idx
                };
                fetch('./api/nzb-hunt/test-server', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                })
                    .then(function (r) { return r.json(); })
                    .then(function (data) {
                        if (data.success) {
                            self._updateServerCardStatus(idx, 'online', 'Connected');
                        } else {
                            self._updateServerCardStatus(idx, 'offline', data.message || 'Connection failed');
                        }
                    })
                    .catch(function () {
                        self._updateServerCardStatus(idx, 'offline', 'Test error');
                    });
            });
        },

        _updateServerCardStatus: function (idx, state, message) {
            var dot = document.getElementById('nzb-server-status-' + idx);
            var textEl = document.getElementById('nzb-server-status-text-' + idx);

            if (dot) {
                dot.className = 'nzb-server-status-dot status-' + state;
                dot.title = message;
            }

            if (textEl) {
                if (state === 'online') {
                    textEl.innerHTML = '<i class="fas fa-check-circle" style="font-size: 11px; color: #22c55e;"></i> <span style="font-size: 12px; color: #4ade80;">Connected</span>';
                } else if (state === 'offline') {
                    textEl.innerHTML = '<i class="fas fa-times-circle" style="font-size: 11px; color: #ef4444;"></i> <span style="font-size: 12px; color: #f87171;">' + _esc(message) + '</span>';
                }
            }
        },

        /* ──────────────────────────────────────────────
           Server Add/Edit (full page editor)
        ────────────────────────────────────────────── */
        _serverEditorSetupDone: false,

        _setupServerEditor: function () {
            if (this._serverEditorSetupDone) return;
            this._serverEditorSetupDone = true;

            var self = this;
            var backBtn = document.getElementById('nzb-server-editor-back');
            var saveBtn = document.getElementById('nzb-server-editor-save');
            var testBtn = document.getElementById('nzb-server-editor-test');

            if (backBtn) backBtn.addEventListener('click', function () { self._navigateBackFromServerEditor(); });
            if (saveBtn) saveBtn.addEventListener('click', function () { self._saveServer(); });
            if (testBtn) testBtn.addEventListener('click', function () { self._testServerConnection(); });

            // When any field changes, update Save button and dirty state
            self._setupServerEditorChangeDetection();

            // ESC key: navigate back when on server editor page
            document.addEventListener('keydown', function (e) {
                if (e.key === 'Escape') {
                    var bm = document.getElementById('nzb-browse-modal');
                    if (bm && bm.style.display === 'flex') { self._closeBrowseModal(); return; }
                    if (window.huntarrUI && window.huntarrUI.currentSection === 'nzb-hunt-server-editor') {
                        self._navigateBackFromServerEditor();
                    }
                }
            });
        },

        _navigateToServerEditor: function () {
            window.location.hash = 'nzb-hunt-server-editor';
        },

        _populateServerEditorForm: function () {
            var server = (this._editIndex !== null && this._servers && this._servers[this._editIndex])
                ? this._servers[this._editIndex]
                : null;

            var title = document.getElementById('nzb-server-editor-title');
            if (title) title.textContent = server ? 'Edit Server' : 'Add Server';

            // Fill fields
            var f = function (id, val) { var el = document.getElementById(id); if (el) { if (el.type === 'checkbox') el.checked = val; else el.value = val; } };
            f('nzb-server-name', server ? server.name : '');
            f('nzb-server-host', server ? server.host : '');
            f('nzb-server-port', server ? (server.port || 563) : 563);
            f('nzb-server-ssl', server ? (server.ssl !== false) : true);
            f('nzb-server-username', server ? (server.username || '') : '');
            // Password: clear the field but show masked version as placeholder
            var pwField = document.getElementById('nzb-server-password');
            if (pwField) {
                pwField.value = '';
                if (server && server.password_masked) {
                    pwField.placeholder = server.password_masked;
                } else {
                    pwField.placeholder = '';
                }
            }
            f('nzb-server-connections', server ? (server.connections || 8) : 8);
            f('nzb-server-priority', server ? (Math.min(99, Math.max(0, server.priority !== undefined ? server.priority : 0))) : 0);
            f('nzb-server-enabled', server ? (server.enabled !== false) : true);

            // Store original values for dirty detection
            this._serverEditorOriginalValues = this._getServerEditorFormSnapshot();

            // Reset test status area
            this._resetTestStatus();

            this._updateServerModalSaveButton();

            // Auto-test connection when editing an existing server
            if (server && server.host) {
                var self = this;
                setTimeout(function () {
                    self._showTestStatus('testing', 'Auto-detecting connection...');
                    self._testServerConnection(function (ok, msg) {
                        if (ok) {
                            self._showTestStatus('success', 'Connected to ' + server.host);
                        } else {
                            self._showTestStatus('fail', 'Could not connect: ' + (msg || 'Unknown error'));
                        }
                    });
                }, 500);
            }
        },

        _getServerEditorFormSnapshot: function () {
            var g = function (id) { var el = document.getElementById(id); if (!el) return ''; return el.type === 'checkbox' ? el.checked : el.value; };
            return {
                name: g('nzb-server-name') || '',
                host: (g('nzb-server-host') || '').trim(),
                port: String(parseInt(g('nzb-server-port'), 10) || 563),
                ssl: !!g('nzb-server-ssl'),
                username: g('nzb-server-username') || '',
                password: g('nzb-server-password') || '',
                connections: String(parseInt(g('nzb-server-connections'), 10) || 8),
                priority: String(parseInt(g('nzb-server-priority'), 10) || 0),
                enabled: !!g('nzb-server-enabled')
            };
        },

        _isServerEditorDirty: function () {
            var orig = this._serverEditorOriginalValues;
            if (!orig) return false;
            var cur = this._getServerEditorFormSnapshot();
            return orig.name !== cur.name || orig.host !== cur.host || orig.port !== cur.port ||
                orig.ssl !== cur.ssl || orig.username !== cur.username || orig.password !== cur.password ||
                orig.connections !== cur.connections || orig.priority !== cur.priority || orig.enabled !== cur.enabled;
        },

        _updateServerModalSaveButton: function () {
            var saveBtn = document.getElementById('nzb-server-editor-save');
            if (!saveBtn) return;
            var host = (document.getElementById('nzb-server-host') || {}).value;
            var hasHost = (host || '').trim().length > 0;
            var isDirty = this._isServerEditorDirty();
            var canSave = hasHost && isDirty;
            saveBtn.disabled = !canSave;
            saveBtn.title = canSave ? 'Save server' : (hasHost ? 'Save when you make changes' : 'Enter host first');
        },

        _autoTestTimer: null,

        _setupServerEditorChangeDetection: function () {
            var self = this;
            var allIds = ['nzb-server-name', 'nzb-server-host', 'nzb-server-port', 'nzb-server-ssl', 'nzb-server-username', 'nzb-server-password', 'nzb-server-connections', 'nzb-server-priority', 'nzb-server-enabled'];
            // Connection-relevant fields trigger auto-test
            var connectionIds = ['nzb-server-host', 'nzb-server-port', 'nzb-server-ssl', 'nzb-server-username', 'nzb-server-password'];

            allIds.forEach(function (id) {
                var el = document.getElementById(id);
                if (!el) return;
                var handler = function () {
                    self._updateServerModalSaveButton();
                    // Auto-test when connection-relevant fields change
                    if (connectionIds.indexOf(id) !== -1) {
                        var host = (document.getElementById('nzb-server-host') || {}).value || '';
                        if (host.trim().length > 3) {
                            // Debounce: wait 1.5s after last keystroke
                            if (self._autoTestTimer) clearTimeout(self._autoTestTimer);
                            self._autoTestTimer = setTimeout(function () {
                                self._showTestStatus('testing', 'Auto-detecting connection...');
                                self._testServerConnection(function (ok, msg) {
                                    if (ok) {
                                        self._showTestStatus('success', 'Connected to ' + host.trim());
                                    } else {
                                        self._showTestStatus('fail', 'Could not connect: ' + (msg || 'Unknown error'));
                                    }
                                });
                            }, 1500);
                        }
                    }
                };
                el.removeEventListener('input', handler);
                el.removeEventListener('change', handler);
                el.addEventListener('input', handler);
                el.addEventListener('change', handler);
            });
        },

        _confirmLeaveServerEditor: function (targetSection) {
            var self = this;
            window.HuntarrConfirm.show({
                title: 'Unsaved Changes',
                message: 'You have unsaved changes that will be lost if you leave.',
                confirmLabel: 'Go Back',
                cancelLabel: 'Leave',
                onConfirm: function () { /* Stay on editor */ },
                onCancel: function () {
                    self._serverEditorOriginalValues = self._getServerEditorFormSnapshot();
                    self._updateServerModalSaveButton();
                    if (window.huntarrUI && typeof window.huntarrUI.switchSection === 'function') {
                        window.huntarrUI.switchSection(targetSection);
                        window.location.hash = targetSection;
                    }
                }
            });
        },

        _navigateBackFromServerEditor: function () {
            if (this._isServerEditorDirty()) {
                this._confirmLeaveServerEditor('nzb-hunt-servers');
                return;
            }
            if (window.huntarrUI && typeof window.huntarrUI.switchSection === 'function') {
                window.huntarrUI.switchSection('nzb-hunt-servers');
                window.location.hash = 'nzb-hunt-servers';
            }
        },

        _saveServer: function () {
            var g = function (id) { var el = document.getElementById(id); if (!el) return ''; return el.type === 'checkbox' ? el.checked : el.value; };
            var host = (g('nzb-server-host') || '').trim();
            if (!host) {
                this._showTestStatus('fail', 'Host is required.');
                return;
            }

            var rawPriority = parseInt(g('nzb-server-priority'), 10);
            var priority = (isNaN(rawPriority) ? 0 : Math.min(99, Math.max(0, rawPriority)));
            var payload = {
                name: g('nzb-server-name') || 'Server',
                host: host,
                port: parseInt(g('nzb-server-port'), 10) || 563,
                ssl: !!g('nzb-server-ssl'),
                username: g('nzb-server-username'),
                password: g('nzb-server-password'),
                connections: parseInt(g('nzb-server-connections'), 10) || 8,
                priority: priority,
                enabled: !!g('nzb-server-enabled')
            };

            var self = this;
            var url, method;
            if (this._editIndex !== null) {
                url = './api/nzb-hunt/servers/' + this._editIndex;
                method = 'PUT';
            } else {
                url = './api/nzb-hunt/servers';
                method = 'POST';
            }

            // Show testing status in modal before save
            self._showTestStatus('testing', 'Saving & testing connection...');

            fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    if (data.success) {
                        self._serverEditorOriginalValues = self._getServerEditorFormSnapshot();
                        self._updateServerModalSaveButton();
                        self._loadServers();
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification('Server saved successfully.', 'success');
                        }
                        // Auto-test connection in background
                        var hostName = (document.getElementById('nzb-server-host') || {}).value || 'server';
                        self._testServerConnection(function (testSuccess, testMsg) {
                            if (testSuccess) {
                                self._showTestStatus('success', 'Connected to ' + hostName);
                            } else {
                                self._showTestStatus('fail', 'Connection to ' + hostName + ' failed: ' + testMsg);
                            }
                        });
                    } else {
                        self._showTestStatus('fail', 'Failed to save server.');
                    }
                })
                .catch(function () {
                    self._showTestStatus('fail', 'Failed to save server.');
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification('Failed to save server.', 'error');
                    }
                });
        },

        /* ── Connection Test Helpers ─────────────────────── */

        _resetTestStatus: function () {
            var el = document.getElementById('nzb-server-test-status');
            if (el) {
                el.style.display = 'none';
                el.className = 'nzb-server-test-status';
            }
            // Also reset pill
            var pill = document.getElementById('nzb-server-connection-pill');
            if (pill) pill.style.display = 'none';
        },

        _showTestStatus: function (state, message) {
            // Update legacy status bar (hidden but kept for compatibility)
            var el = document.getElementById('nzb-server-test-status');
            var icon = document.getElementById('nzb-server-test-icon');
            var msg = document.getElementById('nzb-server-test-msg');
            if (el) {
                el.style.display = 'block';
                el.className = 'nzb-server-test-status test-' + state;
                if (icon) {
                    if (state === 'testing') icon.className = 'fas fa-circle-notch fa-spin';
                    else if (state === 'success') icon.className = 'fas fa-check-circle';
                    else icon.className = 'fas fa-times-circle';
                }
                if (msg) msg.textContent = message;
            }

            // Update connection pill in header
            var pill = document.getElementById('nzb-server-connection-pill');
            var pillIcon = document.getElementById('nzb-server-pill-icon');
            var pillText = document.getElementById('nzb-server-pill-text');
            if (pill) {
                pill.style.display = 'inline-flex';
                pill.className = 'nzb-server-connection-pill pill-' + (state === 'testing' ? 'checking' : state);
                if (pillIcon) {
                    if (state === 'testing') pillIcon.className = 'fas fa-circle-notch fa-spin';
                    else if (state === 'success') pillIcon.className = 'fas fa-check-circle';
                    else pillIcon.className = 'fas fa-times-circle';
                }
                if (pillText) {
                    // Show short text in pill
                    if (state === 'testing') pillText.textContent = 'Checking...';
                    else if (state === 'success') {
                        var host = (document.getElementById('nzb-server-host') || {}).value || '';
                        pillText.textContent = 'Connected' + (host ? ' to ' + host.trim() : '');
                    } else {
                        pillText.textContent = 'Connection Failed';
                    }
                }
            }
        },

        _testServerConnection: function (callback) {
            var g = function (id) { var el = document.getElementById(id); if (!el) return ''; return el.type === 'checkbox' ? el.checked : el.value; };
            var host = (g('nzb-server-host') || '').trim();
            if (!host) {
                this._showTestStatus('fail', 'Host is required to test connection.');
                if (callback) callback(false, 'Host is required');
                return;
            }

            var payload = {
                host: host,
                port: parseInt(g('nzb-server-port'), 10) || 563,
                ssl: !!g('nzb-server-ssl'),
                username: (g('nzb-server-username') || '').trim(),
                password: (g('nzb-server-password') || '').trim()
            };

            // If editing an existing server and password field is empty,
            // pass server_index so backend can use the saved password
            if (!payload.password && this._editIndex !== null) {
                payload.server_index = this._editIndex;
            }

            var self = this;
            if (!callback) {
                // Manual test button click – show testing state
                self._showTestStatus('testing', 'Testing connection to ' + host + ':' + payload.port + '...');
            }

            fetch('./api/nzb-hunt/test-server', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    if (callback) {
                        callback(data.success, data.message || '');
                    } else {
                        if (data.success) {
                            self._showTestStatus('success', 'Connected to ' + host + '.');
                        } else {
                            self._showTestStatus('fail', 'Connection to ' + host + ' failed: ' + (data.message || 'Unknown error'));
                        }
                    }
                })
                .catch(function (err) {
                    var errMsg = 'Network error testing connection.';
                    if (callback) {
                        callback(false, errMsg);
                    } else {
                        self._showTestStatus('fail', errMsg);
                    }
                });
        },

        /* ──────────────────────────────────────────────
           Categories  – CRUD + card rendering
        ────────────────────────────────────────────── */
        _categoriesBaseFolder: '/downloads/complete',  // Internal base folder for auto-gen

        _getBaseFolder: function () {
            return this._categoriesBaseFolder || '/downloads/complete';
        },

        _setupCategoryGrid: function () {
            // Categories are auto-generated from instances — no Add/Edit/Delete
        },

        _loadCategories: function () {
            var self = this;
            fetch('./api/nzb-hunt/categories?t=' + Date.now())
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    self._categories = data.categories || [];
                    if (data.base_folder) self._categoriesBaseFolder = data.base_folder;
                    // Ensure folder creation and get status (success/error per category)
                    return fetch('./api/nzb-hunt/categories/ensure-folders', { method: 'POST' })
                        .then(function (r2) { return r2.json(); })
                        .then(function (ensureData) {
                            var statusMap = {};
                            (ensureData.status || []).forEach(function (s) {
                                statusMap[s.name] = { ok: s.ok, error: s.error };
                            });
                            self._categories.forEach(function (c) {
                                var st = statusMap[c.name] || {};
                                c._folderOk = st.ok;
                                c._folderError = st.error;
                            });
                        })
                        .catch(function () { /* keep categories, render without status */ });
                })
                .then(function () { self._renderCategoryCards(); })
                .catch(function () { self._categories = []; self._renderCategoryCards(); });
        },

        _renderCategoryCards: function () {
            var grid = document.getElementById('nzb-cat-grid');
            if (!grid) return;
            grid.innerHTML = '';

            var self = this;
            this._categories.forEach(function (cat) {
                var card = document.createElement('div');
                card.className = 'nzb-cat-card nzb-cat-card-readonly';
                var statusIcon = cat._folderOk ? '<i class="fas fa-check-circle nzb-cat-status-ok" title="Folder created and writeable"></i>' :
                    (cat._folderError ? '<i class="fas fa-exclamation-circle nzb-cat-status-error" title="' + _esc(cat._folderError || 'Error') + '"></i>' : '');
                card.innerHTML =
                    '<div class="nzb-cat-card-header">' +
                        '<div class="nzb-cat-card-name"><i class="fas fa-tag"></i> <span>' + _esc(cat.name || 'Category') + '</span></div>' +
                        '<div class="nzb-cat-card-badges">' +
                            '<span class="nzb-badge nzb-badge-priority-cat">' + _esc(_capFirst(cat.priority || 'normal')) + '</span>' +
                            (statusIcon ? '<span class="nzb-cat-status">' + statusIcon + '</span>' : '') +
                        '</div>' +
                    '</div>' +
                    '<div class="nzb-cat-card-body">' +
                        '<div class="nzb-cat-card-path nzb-cat-path-readonly"><i class="fas fa-folder"></i> <span>' + _esc(cat.folder || '') + '</span></div>' +
                        (cat._folderError ? '<div class="nzb-cat-error-msg">' + _esc(cat._folderError) + '</div>' : '') +
                    '</div>';
                grid.appendChild(card);
            });
        },

        /* ──────────────────────────────────────────────
           Category Add/Edit Modal
        ────────────────────────────────────────────── */
        _setupCategoryModal: function () {
            // Categories are auto-generated — no Add/Edit modal
        },

        /* ──────────────────────────────────────────────
           Processing  – load / save (merged into Advanced)
        ────────────────────────────────────────────── */
        _loadProcessing: function () {
            fetch('./api/nzb-hunt/settings/processing?t=' + Date.now())
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    var el;
                    el = document.getElementById('nzb-proc-max-retries');
                    if (el && data.max_retries !== undefined) el.value = data.max_retries;

                    el = document.getElementById('nzb-proc-abort-hopeless');
                    if (el) el.checked = data.abort_hopeless !== false;

                    el = document.getElementById('nzb-proc-abort-threshold');
                    if (el && data.abort_threshold_pct !== undefined) el.value = data.abort_threshold_pct;

                    el = document.getElementById('nzb-proc-propagation-delay');
                    if (el && data.propagation_delay !== undefined) el.value = data.propagation_delay;

                    el = document.getElementById('nzb-proc-disconnect-empty');
                    if (el) el.checked = data.disconnect_on_empty !== false;

                    el = document.getElementById('nzb-proc-direct-unpack');
                    if (el) el.checked = !!data.direct_unpack;

                    el = document.getElementById('nzb-proc-encrypted-rar');
                    if (el && data.encrypted_rar_action) el.value = data.encrypted_rar_action;

                    el = document.getElementById('nzb-proc-unwanted-action');
                    if (el && data.unwanted_ext_action) el.value = data.unwanted_ext_action;

                    el = document.getElementById('nzb-proc-unwanted-ext');
                    if (el && data.unwanted_extensions !== undefined) el.value = data.unwanted_extensions;

                    el = document.getElementById('nzb-proc-identical-detection');
                    if (el && data.identical_detection) el.value = data.identical_detection;

                    el = document.getElementById('nzb-proc-smart-detection');
                    if (el && data.smart_detection) el.value = data.smart_detection;

                    el = document.getElementById('nzb-proc-allow-proper');
                    if (el) el.checked = data.allow_proper !== false;

                    // Hide threshold row if abort is off
                    var abortEl = document.getElementById('nzb-proc-abort-hopeless');
                    var thresholdRow = document.getElementById('nzb-proc-abort-threshold-row');
                    if (abortEl && thresholdRow) {
                        thresholdRow.style.display = abortEl.checked ? '' : 'none';
                    }
                })
                .catch(function () { /* use defaults */ });
        },

        /* ──────────────────────────────────────────────
           Advanced settings (includes Processing)
        ────────────────────────────────────────────── */
        _setupAdvanced: function () {
            var self = this;
            // Header save button (primary)
            var headerSaveBtn = document.getElementById('nzb-save-advanced-header');
            if (headerSaveBtn) {
                headerSaveBtn.addEventListener('click', function () { self._saveAdvanced(); });
            }
            // Legacy bottom save button (fallback)
            var saveBtn = document.getElementById('nzb-save-advanced');
            if (saveBtn) {
                saveBtn.addEventListener('click', function () { self._saveAdvanced(); });
            }
            // Show/hide abort threshold row based on toggle (processing settings in Advanced)
            var abortToggle = document.getElementById('nzb-proc-abort-hopeless');
            var thresholdRow = document.getElementById('nzb-proc-abort-threshold-row');
            if (abortToggle && thresholdRow) {
                abortToggle.addEventListener('change', function () {
                    thresholdRow.style.display = abortToggle.checked ? '' : 'none';
                });
            }
        },

        _loadAdvanced: function () {
            fetch('./api/nzb-hunt/settings/advanced?t=' + Date.now())
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    var el;
                    el = document.getElementById('nzb-adv-receive-threads');
                    if (el && data.receive_threads !== undefined) el.value = data.receive_threads;

                    el = document.getElementById('nzb-adv-sleep-time');
                    if (el && data.downloader_sleep_time !== undefined) el.value = data.downloader_sleep_time;

                    el = document.getElementById('nzb-adv-unpack-threads');
                    if (el && data.direct_unpack_threads !== undefined) el.value = data.direct_unpack_threads;

                    el = document.getElementById('nzb-adv-size-limit');
                    if (el && data.size_limit !== undefined) el.value = data.size_limit;

                    el = document.getElementById('nzb-adv-completion-rate');
                    if (el && data.req_completion_rate !== undefined) el.value = data.req_completion_rate;

                    el = document.getElementById('nzb-adv-url-retries');
                    if (el && data.max_url_retries !== undefined) el.value = data.max_url_retries;
                })
                .catch(function () { /* use defaults */ });
        },

        _saveAdvanced: function () {
            var advPayload = {
                receive_threads: parseInt((document.getElementById('nzb-adv-receive-threads') || {}).value || '2', 10),
                downloader_sleep_time: parseInt((document.getElementById('nzb-adv-sleep-time') || {}).value || '10', 10),
                direct_unpack_threads: parseInt((document.getElementById('nzb-adv-unpack-threads') || {}).value || '3', 10),
                size_limit: (document.getElementById('nzb-adv-size-limit') || {}).value || '',
                req_completion_rate: parseFloat((document.getElementById('nzb-adv-completion-rate') || {}).value || '100.2'),
                max_url_retries: parseInt((document.getElementById('nzb-adv-url-retries') || {}).value || '10', 10)
            };
            var procPayload = {
                max_retries: parseInt((document.getElementById('nzb-proc-max-retries') || {}).value || '3', 10),
                abort_hopeless: !!(document.getElementById('nzb-proc-abort-hopeless') || {}).checked,
                abort_threshold_pct: parseInt((document.getElementById('nzb-proc-abort-threshold') || {}).value || '5', 10),
                propagation_delay: parseInt((document.getElementById('nzb-proc-propagation-delay') || {}).value || '0', 10),
                disconnect_on_empty: !!(document.getElementById('nzb-proc-disconnect-empty') || {}).checked,
                direct_unpack: !!(document.getElementById('nzb-proc-direct-unpack') || {}).checked,
                encrypted_rar_action: (document.getElementById('nzb-proc-encrypted-rar') || {}).value || 'pause',
                unwanted_ext_action: (document.getElementById('nzb-proc-unwanted-action') || {}).value || 'off',
                unwanted_extensions: (document.getElementById('nzb-proc-unwanted-ext') || {}).value || '',
                identical_detection: (document.getElementById('nzb-proc-identical-detection') || {}).value || 'on',
                smart_detection: (document.getElementById('nzb-proc-smart-detection') || {}).value || 'on',
                allow_proper: !!(document.getElementById('nzb-proc-allow-proper') || {}).checked
            };

            var self = this;
            Promise.all([
                fetch('./api/nzb-hunt/settings/advanced', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(advPayload)
                }).then(function (r) { return r.json(); }),
                fetch('./api/nzb-hunt/settings/processing', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(procPayload)
                }).then(function (r) { return r.json(); })
            ])
                .then(function (results) {
                    var advOk = results[0] && results[0].success;
                    var procOk = results[1] && results[1].success;
                    if ((advOk || procOk) && window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification('Advanced settings saved.', 'success');
                    }
                })
                .catch(function () {
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification('Failed to save advanced settings.', 'error');
                    }
                });
        }
    };

    /* ── Helpers ────────────────────────────────────────────────────── */
    function _esc(s) {
        var d = document.createElement('div');
        d.textContent = s || '';
        return d.innerHTML;
    }

    function _fmtBytes(b) {
        if (!b || b <= 0) return '0 B';
        var units = ['B', 'KB', 'MB', 'GB', 'TB'];
        var i = Math.floor(Math.log(b) / Math.log(1024));
        return (b / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
    }

    function _capFirst(s) {
        if (!s) return '';
        return s.charAt(0).toUpperCase() + s.slice(1);
    }

    // Initialize on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { /* wait for section switch */ });
    }
})();


/* === modules/features/indexer-hunt.js === */
/**
 * Indexer Hunt — Centralized indexer management module.
 * Full-page editor (no modal), card grid list.
 */
(function() {
    'use strict';

    var _indexers = [];
    var _presets = [];
    var _editingId = null;
    var _initialized = false;

    var IH = window.IndexerHunt = {};

    // ── Initialization ────────────────────────────────────────────────

    function _updateSetupWizardBanner() {
        var banner = document.getElementById('indexer-setup-wizard-continue-banner');
        var callout = document.getElementById('indexer-instance-setup-callout');
        // Only show if user navigated here from the setup wizard
        var fromWizard = false;
        try { fromWizard = sessionStorage.getItem('setup-wizard-active-nav') === '1'; } catch (e) {}
        if (fromWizard) { try { sessionStorage.removeItem('setup-wizard-active-nav'); } catch (e) {} }
        if (banner) banner.style.display = fromWizard ? 'flex' : 'none';
        if (callout) callout.style.display = fromWizard ? 'flex' : 'none';
    }

    IH.init = function() {
        var searchInput = document.getElementById('ih-search-input');
        if (searchInput) searchInput.value = '';
        if (!_initialized) {
            _bindEvents();
            _initialized = true;
        }
        _updateSetupWizardBanner();
        var noInstEl = document.getElementById('indexer-hunt-no-instances');
        var wrapperEl = document.getElementById('indexer-hunt-content-wrapper');
        Promise.all([
            fetch('./api/movie-hunt/instances', { cache: 'no-store' }).then(function(r) { return r.json(); }),
            fetch('./api/tv-hunt/instances', { cache: 'no-store' }).then(function(r) { return r.json(); })
        ]).then(function(results) {
            var movieCount = (results[0].instances || []).length;
            var tvCount = (results[1].instances || []).length;
            if (movieCount === 0 && tvCount === 0) {
                if (noInstEl) noInstEl.style.display = '';
                if (wrapperEl) wrapperEl.style.display = 'none';
                return;
            }
            if (noInstEl) noInstEl.style.display = 'none';
            if (wrapperEl) wrapperEl.style.display = '';
            _showListView();
            _loadPresets(function() {
                _loadIndexers();
            });
        }).catch(function() {
            if (noInstEl) noInstEl.style.display = 'none';
            if (wrapperEl) wrapperEl.style.display = '';
            _showListView();
            _loadPresets(function() {
                _loadIndexers();
            });
        });
    };

    function _bindEvents() {
        _on('ih-add-btn', 'click', function() { _openEditor(null); });
        _on('ih-empty-add-btn', 'click', function() { _openEditor(null); });
        _on('ih-editor-back', 'click', function() { _showListView(); });
        _on('ih-editor-save', 'click', _saveForm);
        _on('ih-search-input', 'input', function() { _renderCards(); });
        _on('ih-form-preset', 'change', _onPresetChange);

        // "Import from Index Master" card: show select list (ih-import-panel)
        var wrapper = document.getElementById('indexer-hunt-content-wrapper');
        if (wrapper) {
            wrapper.addEventListener('click', function(e) {
                var card = e.target.closest('.add-instance-card[data-source="indexer-hunt"]');
                if (card) {
                    e.preventDefault();
                    e.stopPropagation();
                    _openIHImportPanel();
                }
            });
            // Edit/Delete on instance indexer cards (capture so we handle before other listeners)
            wrapper.addEventListener('click', _onInstanceIndexerCardClick, true);
        }
        var cancelBtn = document.getElementById('ih-import-cancel');
        if (cancelBtn) cancelBtn.addEventListener('click', _closeIHImportPanel);
        var confirmBtn = document.getElementById('ih-import-confirm');
        if (confirmBtn) confirmBtn.addEventListener('click', _confirmIHImport);
    }

    function _getInstanceIdAndMode() {
        var sel = document.getElementById('settings-indexers-instance-select');
        var val = (sel && sel.value) ? sel.value.trim() : '';
        if (!val) return { instanceId: 1, mode: 'movie' };
        var parts = val.split(':');
        if (parts.length === 2) {
            var mode = parts[0] === 'tv' ? 'tv' : 'movie';
            var id = parseInt(parts[1], 10);
            return { instanceId: isNaN(id) ? 1 : id, mode: mode };
        }
        return { instanceId: 1, mode: 'movie' };
    }

    function _openIHImportPanel() {
        var panel = document.getElementById('ih-import-panel');
        var list = document.getElementById('ih-import-list');
        var actions = document.getElementById('ih-import-actions');
        if (panel) panel.style.display = 'block';
        if (list) list.innerHTML = '<div style="color: #94a3b8; padding: 20px; text-align: center;"><i class="fas fa-spinner fa-spin"></i> Loading available indexers...</div>';
        if (actions) actions.style.display = 'none';

        var par = _getInstanceIdAndMode();
        var url = './api/indexer-hunt/available/' + par.instanceId + '?mode=' + encodeURIComponent(par.mode);

        fetch(url)
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var available = data.available || [];
                if (available.length === 0) {
                    if (list) list.innerHTML = '<div class="ih-import-empty"><i class="fas fa-check-circle" style="color: #10b981; margin-right: 6px;"></i>All Index Master indexers are already imported to this instance.</div>';
                    return;
                }
                var html = '';
                available.forEach(function(idx) {
                    var keyDisplay = idx.api_key_last4 ? '\u2022\u2022\u2022\u2022' + _esc(idx.api_key_last4) : 'No key';
                    html += '<div class="ih-import-item" data-ih-id="' + idx.id + '">'
                        + '<div class="ih-import-checkbox"><i class="fas fa-check"></i></div>'
                        + '<div class="ih-import-info">'
                            + '<div class="ih-import-name">' + _esc(idx.name) + '</div>'
                            + '<div class="ih-import-meta">'
                                + '<span><i class="fas fa-globe"></i> ' + _esc(idx.url || 'N/A') + '</span>'
                                + '<span><i class="fas fa-sort-amount-up"></i> Priority: ' + (idx.priority || 50) + '</span>'
                                + '<span><i class="fas fa-key"></i> ' + keyDisplay + '</span>'
                            + '</div>'
                        + '</div>'
                    + '</div>';
                });
                if (list) list.innerHTML = html;
                if (actions) actions.style.display = 'flex';

                var items = list.querySelectorAll('.ih-import-item');
                items.forEach(function(item) {
                    item.addEventListener('click', function() {
                        item.classList.toggle('selected');
                        _updateIHImportButton();
                    });
                });
            })
            .catch(function(err) {
                if (list) list.innerHTML = '<div class="ih-import-empty">Failed to load available indexers.</div>';
            });
    }

    function _closeIHImportPanel() {
        var panel = document.getElementById('ih-import-panel');
        if (panel) panel.style.display = 'none';
    }

    function _onInstanceIndexerCardClick(e) {
        var grid = e.target.closest('#indexer-instances-grid-unified');
        if (!grid || !grid.closest('#indexer-hunt-section')) return;
        var editBtn = e.target.closest('.btn-card.edit[data-app-type="indexer"]');
        var deleteBtn = e.target.closest('.btn-card.delete[data-app-type="indexer"]');
        if (editBtn) {
            e.preventDefault();
            e.stopPropagation();
            var card = editBtn.closest('.instance-card');
            if (!card) return;
            var index = parseInt(card.getAttribute('data-instance-index'), 10);
            if (isNaN(index)) return;
            var list = window.SettingsForms && window.SettingsForms._indexersList;
            if (!list || index < 0 || index >= list.length) return;
            if (window.SettingsForms && window.SettingsForms.openIndexerEditor) {
                window.SettingsForms.openIndexerEditor(false, index, list[index]);
            }
            return;
        }
        if (deleteBtn) {
            e.preventDefault();
            e.stopPropagation();
            var card = deleteBtn.closest('.instance-card');
            if (!card) return;
            var index = parseInt(card.getAttribute('data-instance-index'), 10);
            if (isNaN(index)) return;
            var list = window.SettingsForms && window.SettingsForms._indexersList;
            if (!list || index < 0 || index >= list.length) return;
            var indexer = list[index];
            var name = (indexer && indexer.name) ? indexer.name : 'Unnamed';
            var Forms = window.SettingsForms;
            var isTV = Forms._indexersMode === 'tv';
            var deleteId = isTV && indexer && indexer.id ? indexer.id : index;
            if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
                window.HuntarrConfirm.show({
                    title: 'Delete Indexer',
                    message: 'Are you sure you want to remove "' + name + '" from this instance? It will no longer be used for searches and will be removed from Index Master tracking for this instance.',
                    confirmLabel: 'Delete',
                    onConfirm: function() {
                        var apiBase = Forms.getIndexersApiBase();
                        var url = apiBase + '/' + encodeURIComponent(String(deleteId));
                        fetch(url, { method: 'DELETE' })
                            .then(function(r) { return r.json(); })
                            .then(function(data) {
                                if (data.success !== false) {
                                    if (window.SettingsForms && window.SettingsForms.refreshIndexersList) {
                                        window.SettingsForms.refreshIndexersList();
                                    }
                                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                                        window.huntarrUI.showNotification('Indexer removed.', 'success');
                                    }
                                } else {
                                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                                        window.huntarrUI.showNotification(data.error || 'Failed to remove indexer.', 'error');
                                    }
                                }
                            })
                            .catch(function() {
                                if (window.huntarrUI && window.huntarrUI.showNotification) {
                                    window.huntarrUI.showNotification('Failed to remove indexer.', 'error');
                                }
                            });
                    }
                });
            }
        }
    }

    function _updateIHImportButton() {
        var selected = document.querySelectorAll('#ih-import-list .ih-import-item.selected');
        var btn = document.getElementById('ih-import-confirm');
        if (btn) {
            btn.disabled = selected.length === 0;
            btn.innerHTML = '<i class="fas fa-download"></i> Import Selected (' + selected.length + ')';
        }
    }

    function _confirmIHImport() {
        var selected = document.querySelectorAll('#ih-import-list .ih-import-item.selected');
        if (selected.length === 0) return;

        var ids = [];
        selected.forEach(function(item) {
            ids.push(item.getAttribute('data-ih-id'));
        });
        var par = _getInstanceIdAndMode();

        var btn = document.getElementById('ih-import-confirm');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Importing...'; }

        fetch('./api/indexer-hunt/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ instance_id: par.instanceId, mode: par.mode, indexer_ids: ids }),
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.success) {
                var msg = 'Imported ' + (data.added || 0) + ' indexer(s) from Index Master.';
                if (window.huntarrUI) window.huntarrUI.showNotification(msg, 'success');
                _closeIHImportPanel();
                if (window.SettingsForms && window.SettingsForms.refreshIndexersList) {
                    window.SettingsForms.refreshIndexersList();
                }
            } else {
                if (window.huntarrUI) window.huntarrUI.showNotification(data.error || 'Import failed.', 'error');
            }
        })
        .catch(function(err) {
            if (window.huntarrUI) window.huntarrUI.showNotification('Import error.', 'error');
        })
        .finally(function() {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-download"></i> Import Selected'; }
        });
    }

    function _on(id, event, fn) {
        var el = document.getElementById(id);
        if (el) el.addEventListener(event, fn);
    }

    // ── View switching ─────────────────────────────────────────────────

    function _showListView() {
        var list = document.getElementById('ih-list-view');
        var editor = document.getElementById('ih-editor-view');
        if (list) list.style.display = '';
        if (editor) editor.style.display = 'none';
        _editingId = null;
    }

    function _showEditorView() {
        var list = document.getElementById('ih-list-view');
        var editor = document.getElementById('ih-editor-view');
        if (list) list.style.display = 'none';
        if (editor) editor.style.display = '';
        // Anchor editor into view so user doesn't have to scroll down
        if (editor) {
            editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }

    // ── Data loading ──────────────────────────────────────────────────

    function _loadPresets(cb) {
        fetch('./api/indexer-hunt/presets')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                _presets = data.presets || [];
                _populatePresetDropdown();
                if (cb) cb();
            })
            .catch(function() { if (cb) cb(); });
    }

    function _loadIndexers() {
        fetch('./api/indexer-hunt/indexers')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                _indexers = data.indexers || [];
                _renderCards();
            })
            .catch(function(err) {
                console.error('[IndexerHunt] Load error:', err);
            });
    }

    function _populatePresetDropdown() {
        var sel = document.getElementById('ih-form-preset');
        if (!sel) return;
        sel.innerHTML = '<option value="manual">Custom (Manual)</option>';
        _presets.forEach(function(p) {
            var opt = document.createElement('option');
            opt.value = p.key;
            opt.textContent = p.name;
            sel.appendChild(opt);
        });
    }

    // ── Card rendering ─────────────────────────────────────────────────

    function _renderCards() {
        var grid = document.getElementById('ih-card-grid');
        var empty = document.getElementById('ih-empty-state');
        if (!grid) return;

        var query = (document.getElementById('ih-search-input') || {}).value || '';
        query = query.toLowerCase().trim();

        var filtered = _indexers;
        if (query) {
            filtered = _indexers.filter(function(idx) {
                return (idx.name || '').toLowerCase().indexOf(query) !== -1 ||
                       (idx.url || '').toLowerCase().indexOf(query) !== -1 ||
                       (idx.preset || '').toLowerCase().indexOf(query) !== -1;
            });
        }

        if (filtered.length === 0 && _indexers.length === 0) {
            grid.style.display = 'none';
            if (empty) empty.style.display = '';
            var poolNotice = document.getElementById('ih-pool-notice');
            if (poolNotice) poolNotice.style.display = 'none';
            var instanceArea = document.getElementById('ih-instance-area');
            if (instanceArea) instanceArea.style.display = 'none';
            var groupBox = document.getElementById('ih-group-box');
            if (groupBox) groupBox.style.display = 'none';
            return;
        }

        grid.style.display = '';
        if (empty) empty.style.display = 'none';
        var poolNotice = document.getElementById('ih-pool-notice');
        if (poolNotice) poolNotice.style.display = '';
        var instanceArea = document.getElementById('ih-instance-area');
        if (instanceArea) instanceArea.style.display = '';
        var groupBox = document.getElementById('ih-group-box');
        if (groupBox) groupBox.style.display = '';

        var html = '';
        filtered.forEach(function(idx) {
            var enabled = idx.enabled !== false;
            var statusClass = enabled ? 'enabled' : 'disabled';
            var statusText = enabled ? 'Enabled' : 'Disabled';
            var statusIcon = enabled ? 'fa-check-circle' : 'fa-minus-circle';
            var presetLabel = _getPresetLabel(idx.preset);
            var url = idx.url || '\u2014';
            var keyDisplay = idx.api_key_last4 ? '\u2022\u2022\u2022\u2022' + _esc(idx.api_key_last4) : 'No key';
            html += '<div class="ih-card' + (enabled ? '' : ' ih-card-disabled') + '" data-id="' + _esc(idx.id) + '">'
                + '<div class="ih-card-header">'
                    + '<div class="ih-card-name"><span>' + _esc(idx.name || '') + '</span></div>'
                    + '<span class="ih-card-status ' + statusClass + '"><i class="fas ' + statusIcon + '"></i> ' + statusText + '</span>'
                + '</div>'
                + '<div class="ih-card-body">'
                    + '<div class="ih-card-detail ih-card-connection-row"><span class="ih-card-connection-status" data-connection="pending"><i class="fas fa-spinner fa-spin"></i> Checking...</span></div>'
                    + '<div class="ih-card-detail"><i class="fas fa-globe"></i><span class="ih-detail-value">' + _esc(url) + '</span></div>'
                    + '<div class="ih-card-detail"><i class="fas fa-key"></i><span class="ih-detail-value">' + keyDisplay + '</span></div>'
                    + '<div class="ih-card-detail" style="gap: 8px;">'
                        + '<span class="ih-card-priority-badge"><i class="fas fa-sort-amount-up" style="font-size:0.7rem;"></i> ' + (idx.priority || 50) + '</span>'
                        + '<span class="ih-card-preset-badge">' + _esc(presetLabel) + '</span>'
                    + '</div>'
                + '</div>'
                + '<div class="ih-card-footer">'
                    + '<button class="ih-card-btn test" onclick="IndexerHunt.testIndexer(\'' + _esc(idx.id) + '\')" title="Test"><i class="fas fa-plug"></i> Test</button>'
                    + '<button class="ih-card-btn edit" onclick="IndexerHunt.editIndexer(\'' + _esc(idx.id) + '\')" title="Edit"><i class="fas fa-edit"></i> Edit</button>'
                    + '<button class="ih-card-btn delete" onclick="IndexerHunt.deleteIndexer(\'' + _esc(idx.id) + '\', \'' + _esc(idx.name) + '\')" title="Delete"><i class="fas fa-trash"></i></button>'
                + '</div>'
            + '</div>';
        });

        // Add card at the end
        html += '<div class="ih-add-card" id="ih-add-card-inline">'
            + '<div class="ih-add-icon"><i class="fas fa-plus-circle"></i></div>'
            + '<div class="ih-add-text">Add Indexer</div>'
        + '</div>';

        grid.innerHTML = html;

        var addCard = document.getElementById('ih-add-card-inline');
        if (addCard) addCard.addEventListener('click', function() { _openEditor(null); });

        // Test each indexer connection and update card status (like app settings)
        _testIndexerCardsConnectionStatus(filtered);
    }

    function _testIndexerCardsConnectionStatus(indexerList) {
        if (!indexerList || indexerList.length === 0) return;
        indexerList.forEach(function(idx) {
            var card = document.querySelector('.ih-card[data-id="' + idx.id + '"]');
            var statusEl = card ? card.querySelector('.ih-card-connection-status') : null;
            if (!statusEl) return;
            fetch('./api/indexer-hunt/indexers/' + idx.id + '/test', { method: 'POST' })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (!statusEl.parentNode) return;
                    if (data.valid) {
                        statusEl.setAttribute('data-connection', 'connected');
                        statusEl.innerHTML = '<i class="fas fa-check-circle"></i> Connected';
                        statusEl.classList.add('ih-card-connection-ok');
                        statusEl.classList.remove('ih-card-connection-fail', 'ih-card-connection-pending');
                    } else {
                        statusEl.setAttribute('data-connection', 'error');
                        statusEl.innerHTML = '<i class="fas fa-times-circle"></i> Failed';
                        statusEl.classList.add('ih-card-connection-fail');
                        statusEl.classList.remove('ih-card-connection-ok', 'ih-card-connection-pending');
                    }
                })
                .catch(function() {
                    if (statusEl.parentNode) {
                        statusEl.setAttribute('data-connection', 'error');
                        statusEl.innerHTML = '<i class="fas fa-times-circle"></i> Failed';
                        statusEl.classList.add('ih-card-connection-fail');
                        statusEl.classList.remove('ih-card-connection-ok', 'ih-card-connection-pending');
                    }
                });
        });
    }

    function _getPresetLabel(preset) {
        if (!preset || preset === 'manual') return 'Custom';
        for (var i = 0; i < _presets.length; i++) {
            if (_presets[i].key === preset) return _presets[i].name;
        }
        return preset;
    }

    // ── Editor (full page) ─────────────────────────────────────────────

    function _openEditor(existingIdx) {
        _editingId = existingIdx ? existingIdx.id : null;

        var breadcrumb = document.getElementById('ih-editor-breadcrumb-name');
        if (breadcrumb) breadcrumb.textContent = _editingId ? 'Edit Indexer' : 'Add Indexer';

        var presetSel = document.getElementById('ih-form-preset');
        var nameEl = document.getElementById('ih-form-name');
        var urlEl = document.getElementById('ih-form-url');
        var apiPathEl = document.getElementById('ih-form-api-path');
        var apiKeyEl = document.getElementById('ih-form-api-key');
        var priorityEl = document.getElementById('ih-form-priority');
        var protocolEl = document.getElementById('ih-form-protocol');

        if (existingIdx) {
            if (presetSel) { presetSel.value = existingIdx.preset || 'manual'; presetSel.disabled = true; }
            if (nameEl) nameEl.value = existingIdx.name || '';
            if (urlEl) { urlEl.value = existingIdx.url || ''; urlEl.readOnly = existingIdx.preset !== 'manual'; }
            if (apiPathEl) { apiPathEl.value = existingIdx.api_path || '/api'; apiPathEl.readOnly = existingIdx.preset !== 'manual'; }
            if (apiKeyEl) apiKeyEl.value = '';
            if (apiKeyEl) apiKeyEl.placeholder = existingIdx.api_key_last4 ? 'Leave blank to keep (\u2022\u2022\u2022\u2022' + existingIdx.api_key_last4 + ')' : 'Enter API key';
            if (priorityEl) priorityEl.value = existingIdx.priority || 50;
            if (protocolEl) protocolEl.value = existingIdx.protocol || 'usenet';
        } else {
            if (presetSel) { presetSel.value = 'manual'; presetSel.disabled = false; }
            if (nameEl) nameEl.value = '';
            if (urlEl) { urlEl.value = ''; urlEl.readOnly = false; }
            if (apiPathEl) { apiPathEl.value = '/api'; apiPathEl.readOnly = false; }
            if (apiKeyEl) { apiKeyEl.value = ''; apiKeyEl.placeholder = 'Enter API key'; }
            if (priorityEl) priorityEl.value = 50;
            if (protocolEl) protocolEl.value = 'usenet';
        }

        _showEditorView();

        // Auto-test connection when URL or API key changes (like Sonarr/app settings)
        var statusContainer = document.getElementById('ih-connection-status-container');
        if (statusContainer) statusContainer.style.display = 'flex';
        if (!window._ihConnectionListenersBound) {
            window._ihConnectionListenersBound = true;
            var urlEl2 = document.getElementById('ih-form-url');
            var apiPathEl2 = document.getElementById('ih-form-api-path');
            var apiKeyEl2 = document.getElementById('ih-form-api-key');
            var debounceTimer;
            var runStatus = function() {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(function() { _updateConnectionStatusFromForm(); }, 500);
            };
            if (urlEl2) { urlEl2.addEventListener('input', runStatus); urlEl2.addEventListener('blur', runStatus); }
            if (apiPathEl2) { apiPathEl2.addEventListener('input', runStatus); apiPathEl2.addEventListener('blur', runStatus); }
            if (apiKeyEl2) { apiKeyEl2.addEventListener('input', runStatus); apiKeyEl2.addEventListener('blur', runStatus); }
        }
        setTimeout(function() { _updateConnectionStatusFromForm(); }, 100);
    }

    function _updateConnectionStatusFromForm() {
        var container = document.getElementById('ih-connection-status-container');
        if (!container) return;
        var urlEl = document.getElementById('ih-form-url');
        var apiPathEl = document.getElementById('ih-form-api-path');
        var apiKeyEl = document.getElementById('ih-form-api-key');
        var url = urlEl ? urlEl.value.trim() : '';
        var apiPath = apiPathEl ? (apiPathEl.value.trim() || '/api') : '/api';
        var apiKey = apiKeyEl ? apiKeyEl.value.trim() : '';
        var hasSavedKey = _editingId && _indexers.length;
        if (hasSavedKey) {
            var existing = null;
            _indexers.forEach(function(i) { if (i.id === _editingId) existing = i; });
            hasSavedKey = !!(existing && existing.api_key_last4);
        }
        if (url.length <= 10 && apiKey.length < 10) {
            container.innerHTML = '<div class="connection-status" style="background: rgba(148,163,184,0.1); color: #94a3b8; border: 1px solid rgba(148,163,184,0.2);"><i class="fas fa-info-circle"></i><span>Enter URL and API Key</span></div>';
            return;
        }
        if (url.length <= 10) {
            container.innerHTML = '<div class="connection-status" style="background: rgba(251,191,36,0.1); color: #fbbf24; border: 1px solid rgba(251,191,36,0.2);"><i class="fas fa-exclamation-triangle"></i><span>Missing URL</span></div>';
            return;
        }
        if (apiKey.length < 10 && !hasSavedKey) {
            container.innerHTML = '<div class="connection-status" style="background: rgba(251,191,36,0.1); color: #fbbf24; border: 1px solid rgba(251,191,36,0.2);"><i class="fas fa-exclamation-triangle"></i><span>Missing API Key</span></div>';
            return;
        }
        if (apiKey.length < 10 && hasSavedKey) {
            container.innerHTML = '<div class="connection-status" style="background: rgba(148,163,184,0.1); color: #94a3b8; border: 1px solid rgba(148,163,184,0.2);"><i class="fas fa-check-circle"></i><span>API key saved. Leave blank to keep.</span></div>';
            return;
        }
        container.innerHTML = '<div class="connection-status checking"><i class="fas fa-spinner fa-spin"></i><span>Checking...</span></div>';
        var presetEl = document.getElementById('ih-form-preset');
        var preset = presetEl ? presetEl.value : 'manual';
        var body = { preset: preset, url: url, api_path: apiPath, api_key: apiKey };
        fetch('./api/indexer-hunt/validate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.valid) {
                var msg = 'Connected';
                if (data.response_time_ms != null) msg += ' (' + data.response_time_ms + 'ms)';
                container.innerHTML = '<div class="connection-status success"><i class="fas fa-check-circle"></i><span>' + _esc(msg) + '</span></div>';
            } else {
                container.innerHTML = '<div class="connection-status error"><i class="fas fa-times-circle"></i><span>' + _esc(data.message || 'Connection failed') + '</span></div>';
            }
        })
        .catch(function(err) {
            container.innerHTML = '<div class="connection-status error"><i class="fas fa-times-circle"></i><span>' + _esc(String(err && err.message ? err.message : 'Connection failed')) + '</span></div>';
        });
    }

    function _onPresetChange() {
        var sel = document.getElementById('ih-form-preset');
        var preset = sel ? sel.value : 'manual';
        var isManual = preset === 'manual';

        var nameEl = document.getElementById('ih-form-name');
        var urlEl = document.getElementById('ih-form-url');
        var apiPathEl = document.getElementById('ih-form-api-path');

        if (!isManual) {
            var p = null;
            _presets.forEach(function(pr) { if (pr.key === preset) p = pr; });
            if (p) {
                if (nameEl) nameEl.value = p.name;
                if (urlEl) urlEl.value = p.url;
                if (apiPathEl) apiPathEl.value = p.api_path || '/api';
            }
        }
        if (urlEl) urlEl.readOnly = !isManual;
        if (apiPathEl) apiPathEl.readOnly = !isManual;
    }

    function _saveForm() {
        var nameEl = document.getElementById('ih-form-name');
        var presetEl = document.getElementById('ih-form-preset');
        var urlEl = document.getElementById('ih-form-url');
        var apiPathEl = document.getElementById('ih-form-api-path');
        var apiKeyEl = document.getElementById('ih-form-api-key');
        var priorityEl = document.getElementById('ih-form-priority');
        var protocolEl = document.getElementById('ih-form-protocol');

        var body = {
            name: (nameEl ? nameEl.value : '').trim(),
            preset: presetEl ? presetEl.value : 'manual',
            url: (urlEl ? urlEl.value : '').trim(),
            api_path: (apiPathEl ? apiPathEl.value : '/api').trim(),
            api_key: (apiKeyEl ? apiKeyEl.value : '').trim(),
            priority: parseInt(priorityEl ? priorityEl.value : '50', 10) || 50,
            enabled: true,
            protocol: protocolEl ? protocolEl.value : 'usenet',
        };

        if (!body.name) {
            if (window.huntarrUI) window.huntarrUI.showNotification('Name is required.', 'error');
            return;
        }

        var method = _editingId ? 'PUT' : 'POST';
        var url = _editingId ? './api/indexer-hunt/indexers/' + _editingId : './api/indexer-hunt/indexers';

        fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.success) {
                var msg = _editingId ? 'Indexer updated.' : 'Indexer added.';
                if (data.linked_instances_updated > 0) {
                    msg += ' Updated in ' + data.linked_instances_updated + ' Movie Hunt instance(s).';
                }
                if (window.huntarrUI) window.huntarrUI.showNotification(msg, 'success');
                var searchInput = document.getElementById('ih-search-input');
                if (searchInput) searchInput.value = '';
                _loadIndexers();
                _showListView();
            } else {
                if (window.huntarrUI) window.huntarrUI.showNotification(data.error || 'Failed to save.', 'error');
            }
        })
        .catch(function(err) {
            if (window.huntarrUI) window.huntarrUI.showNotification('Error: ' + err, 'error');
        });
    }

    // ── Public actions ────────────────────────────────────────────────

    IH.editIndexer = function(id) {
        var idx = null;
        _indexers.forEach(function(i) { if (i.id === id) idx = i; });
        if (idx) _openEditor(idx);
    };

    IH.testIndexer = function(id) {
        fetch('./api/indexer-hunt/indexers/' + id + '/test', { method: 'POST' })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (data.valid) {
                    if (window.huntarrUI) window.huntarrUI.showNotification('Connection OK (' + (data.response_time_ms || 0) + 'ms)', 'success');
                } else {
                    if (window.huntarrUI) window.huntarrUI.showNotification(data.message || 'Test failed.', 'error');
                }
            })
            .catch(function(err) {
                if (window.huntarrUI) window.huntarrUI.showNotification('Error: ' + err, 'error');
            });
    };

    IH.deleteIndexer = function(id, name) {
        fetch('./api/indexer-hunt/linked-instances/' + id)
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var linked = data.linked || [];
                var msg = 'Are you sure you want to delete "' + name + '"?';
                if (linked.length > 0) {
                    msg += '\n\nThis will also remove it from ' + linked.length + ' Movie Hunt instance(s).';
                }
                window.HuntarrConfirm.show({
                    title: 'Delete Indexer',
                    message: msg,
                    confirmLabel: 'Delete',
                    onConfirm: function() {
                        fetch('./api/indexer-hunt/indexers/' + id, { method: 'DELETE' })
                            .then(function(r) { return r.json(); })
                            .then(function(res) {
                                if (res.success) {
                                    _loadIndexers();
                                    var notice = '"' + name + '" deleted.';
                                    if (res.instances_cleaned > 0) {
                                        notice += ' Removed from ' + res.instances_cleaned + ' instance(s).';
                                    }
                                    if (window.huntarrUI) window.huntarrUI.showNotification(notice, 'success');
                                } else {
                                    if (window.huntarrUI) window.huntarrUI.showNotification(res.error || 'Delete failed.', 'error');
                                }
                            });
                    }
                });
            });
    };

    function _esc(s) {
        if (!s) return '';
        var d = document.createElement('div');
        d.appendChild(document.createTextNode(s));
        return d.innerHTML;
    }

    document.addEventListener('huntarr:instances-changed', function() {
        if (document.getElementById('indexer-hunt-content-wrapper') && window.huntarrUI && window.huntarrUI.currentSection === 'indexer-hunt') {
            IH.init();
        }
    });
    document.addEventListener('huntarr:tv-hunt-instances-changed', function() {
        if (document.getElementById('indexer-hunt-content-wrapper') && window.huntarrUI && window.huntarrUI.currentSection === 'indexer-hunt') {
            IH.init();
        }
    });

})();


/* === modules/features/indexer-hunt-home.js === */
/**
 * Indexer Hunt — Home Page Card
 * Shows indexer list + aggregate statistics on the Home dashboard.
 * Only visible when at least one Indexer Hunt indexer is configured.
 * Mirrors the Prowlarr home card design exactly.
 */
window.HuntarrIndexerHuntHome = {
    _pollInterval: null,

    /* ── Bootstrap ─────────────────────────────────────────────── */
    setup: function() {
        this.load();

        // Refresh every 5 minutes (same cadence as Prowlarr stats)
        if (!this._pollInterval) {
            var self = this;
            this._pollInterval = setInterval(function() {
                if (window.huntarrUI && window.huntarrUI.currentSection === 'home') {
                    self.load();
                }
            }, 5 * 60 * 1000);
        }
    },

    /* ── Main loader ───────────────────────────────────────────── */
    load: function() {
        var card = document.getElementById('indexerHuntStatusCard');
        if (!card) return;

        var self = this;

        // 1. Fetch indexers list — also tells us whether the card should show
        HuntarrUtils.fetchWithTimeout('./api/indexer-hunt/indexers')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var indexers = data.indexers || [];
                if (indexers.length === 0) {
                    card.style.display = 'none';
                    return;
                }

                card.style.display = 'block';

                // Connection badge
                var badge = document.getElementById('ihHomeConnectionStatus');
                if (badge) {
                    var enabledCount = indexers.filter(function(i) { return i.enabled !== false; }).length;
                    badge.textContent = '🟢 ' + enabledCount + ' Indexer' + (enabledCount !== 1 ? 's' : '') + ' Active';
                    badge.className = 'status-badge connected';
                }

                // Render indexer list (left sub-card)
                self._renderIndexerList(indexers);

                // 2. Fetch aggregate stats (right sub-card)
                self._loadStats();
            })
            .catch(function() {
                card.style.display = 'none';
            });
    },

    /* ── Left sub-card: indexer list ───────────────────────────── */
    _renderIndexerList: function(indexers) {
        var list = document.getElementById('ih-home-indexers-list');
        if (!list) return;

        if (!indexers || indexers.length === 0) {
            list.innerHTML = '<div class="loading-text">No indexers configured</div>';
            return;
        }

        // Sort alphabetically
        indexers.sort(function(a, b) {
            var na = (a.name || '').toLowerCase();
            var nb = (b.name || '').toLowerCase();
            return na < nb ? -1 : na > nb ? 1 : 0;
        });

        var html = indexers.map(function(idx) {
            var enabled = idx.enabled !== false;
            var statusClass = enabled ? 'active' : 'failed';
            var statusText  = enabled ? 'Active' : 'Disabled';
            var displayName = (idx.name || 'Unnamed').replace(/</g, '&lt;').replace(/>/g, '&gt;');

            return '<div class="indexer-item">' +
                '<span class="indexer-name">' + displayName + '</span>' +
                '<span class="indexer-status ' + statusClass + '">' + statusText + '</span>' +
                '</div>';
        }).join('');

        list.innerHTML = html;
    },

    /* ── Right sub-card: aggregate stats ──────────────────────── */
    _loadStats: function() {
        var content = document.getElementById('ih-home-statistics-content');
        if (!content) return;

        var fmt = function(n) {
            var v = Number(n || 0);
            return Number.isFinite(v) ? String(Math.round(v)) : '0';
        };

        HuntarrUtils.fetchWithTimeout('./api/indexer-hunt/stats')
            .then(function(r) { return r.json(); })
            .then(function(stats) {
                var queries    = fmt(stats.total_queries);
                var grabs      = fmt(stats.total_grabs);
                var failures   = fmt(stats.total_failures);
                var avgMs      = Number(stats.avg_response_ms || 0);
                var failRate   = Number(stats.failure_rate || 0);

                content.innerHTML =
                    '<div class="stat-card">' +
                        '<div class="stat-label">TOTAL QUERIES</div>' +
                        '<div class="stat-value success">' + queries + '</div>' +
                    '</div>' +
                    '<div class="stat-card">' +
                        '<div class="stat-label">TOTAL GRABS</div>' +
                        '<div class="stat-value success">' + grabs + '</div>' +
                    '</div>' +
                    '<div class="stat-card">' +
                        '<div class="stat-label">AVG RESPONSE</div>' +
                        '<div class="stat-value success">' + (avgMs > 0 ? avgMs.toFixed(0) + 'ms' : 'N/A') + '</div>' +
                    '</div>' +
                    '<div class="stat-card">' +
                        '<div class="stat-label">FAILURE RATE</div>' +
                        '<div class="stat-value' + (failRate > 10 ? ' error' : ' success') + '">' + failRate.toFixed(1) + '%</div>' +
                    '</div>' +
                    '<div class="stat-card">' +
                        '<div class="stat-label">FAILURES</div>' +
                        '<div class="stat-value error">' + failures + '</div>' +
                    '</div>';
            })
            .catch(function() {
                content.innerHTML = '<div class="loading-text" style="color: #ef4444;">Failed to load stats</div>';
            });
    }
};


/* === modules/features/indexer-hunt-stats.js === */
/**
 * Indexer Hunt — Stats page module.
 * Displays aggregate and per-indexer statistics.
 */
(function() {
    'use strict';

    var Stats = window.IndexerHuntStats = {};

    Stats.init = function() {
        var noInstEl = document.getElementById('indexer-hunt-stats-no-instances');
        var wrapperEl = document.getElementById('indexer-hunt-stats-content-wrapper');
        var noIdxEl = document.getElementById('indexer-hunt-stats-no-indexers');
        var noCliEl = document.getElementById('indexer-hunt-stats-no-clients');
        Promise.all([
            fetch('./api/movie-hunt/instances', { cache: 'no-store' }).then(function(r) { return r.json(); }),
            fetch('./api/tv-hunt/instances', { cache: 'no-store' }).then(function(r) { return r.json(); }),
            fetch('./api/indexer-hunt/indexers', { cache: 'no-store' }).then(function(r) { return r.json(); }),
            fetch('./api/movie-hunt/has-clients', { cache: 'no-store' }).then(function(r) { return r.json(); })
        ]).then(function(results) {
            var movieCount = (results[0].instances || []).length;
            var tvCount = (results[1].instances || []).length;
            var indexerCount = (results[2].indexers || []).length;
            var hasClients = results[3].has_clients === true;
            if (movieCount === 0 && tvCount === 0) {
                if (noInstEl) noInstEl.style.display = '';
                if (noIdxEl) noIdxEl.style.display = 'none';
                if (noCliEl) noCliEl.style.display = 'none';
                if (wrapperEl) wrapperEl.style.display = 'none';
                return;
            }
            if (indexerCount === 0) {
                if (noInstEl) noInstEl.style.display = 'none';
                if (noIdxEl) noIdxEl.style.display = '';
                if (noCliEl) noCliEl.style.display = 'none';
                if (wrapperEl) wrapperEl.style.display = 'none';
                return;
            }
            if (!hasClients) {
                if (noInstEl) noInstEl.style.display = 'none';
                if (noIdxEl) noIdxEl.style.display = 'none';
                if (noCliEl) noCliEl.style.display = '';
                if (wrapperEl) wrapperEl.style.display = 'none';
                return;
            }
            if (noInstEl) noInstEl.style.display = 'none';
            if (noIdxEl) noIdxEl.style.display = 'none';
            if (noCliEl) noCliEl.style.display = 'none';
            if (wrapperEl) wrapperEl.style.display = '';
            _loadAggregateStats();
            _loadPerIndexerStats();
        }).catch(function() {
            if (noInstEl) noInstEl.style.display = 'none';
            if (noIdxEl) noIdxEl.style.display = 'none';
            if (noCliEl) noCliEl.style.display = 'none';
            if (wrapperEl) wrapperEl.style.display = '';
            _loadAggregateStats();
            _loadPerIndexerStats();
        });
    };

    function _loadAggregateStats() {
        fetch('./api/indexer-hunt/stats')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                _setVal('ih-stat-queries', data.total_queries || 0);
                _setVal('ih-stat-grabs', data.total_grabs || 0);
                _setVal('ih-stat-failures', data.total_failures || 0);
                var respEl = document.getElementById('ih-stat-response');
                if (respEl) respEl.innerHTML = (data.avg_response_ms || 0) + '<span class="ih-stat-unit">ms</span>';
                var rateEl = document.getElementById('ih-stat-failure-rate');
                if (rateEl) rateEl.innerHTML = (data.failure_rate || 0) + '<span class="ih-stat-unit">%</span>';
            })
            .catch(function(err) {
                console.error('[IndexerHuntStats] Aggregate load error:', err);
            });
    }

    function _loadPerIndexerStats() {
        fetch('./api/indexer-hunt/stats/per-indexer')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var indexers = data.indexers || [];
                var tbody = document.getElementById('ih-stats-table-body');
                var tableWrap = document.getElementById('ih-stats-table-wrap');
                var empty = document.getElementById('ih-stats-empty');
                if (!tbody) return;

                if (indexers.length === 0) {
                    if (tableWrap) tableWrap.style.display = 'none';
                    if (empty) empty.style.display = 'block';
                    return;
                }

                if (tableWrap) tableWrap.style.display = '';
                if (empty) empty.style.display = 'none';

                var html = '';
                indexers.forEach(function(idx) {
                    var statusHtml = idx.enabled
                        ? '<span class="ih-card-status enabled" style="font-size:0.7rem;"><i class="fas fa-check-circle"></i> Enabled</span>'
                        : '<span class="ih-card-status disabled" style="font-size:0.7rem;"><i class="fas fa-minus-circle"></i> Disabled</span>';
                    html += '<tr>'
                        + '<td><strong>' + _esc(idx.name) + '</strong></td>'
                        + '<td><span class="ih-card-priority-badge">' + (idx.priority || 50) + '</span></td>'
                        + '<td>' + (idx.searches || 0) + '</td>'
                        + '<td>' + (idx.grabs || 0) + '</td>'
                        + '<td>' + (idx.failures || 0) + '</td>'
                        + '<td>' + (idx.avg_response_ms || 0) + 'ms</td>'
                        + '<td>' + (idx.failure_rate || 0) + '%</td>'
                        + '<td>' + statusHtml + '</td>'
                        + '</tr>';
                });
                tbody.innerHTML = html;
            })
            .catch(function(err) {
                console.error('[IndexerHuntStats] Per-indexer load error:', err);
            });
    }

    function _setVal(id, val) {
        var el = document.getElementById(id);
        if (el) el.textContent = val;
    }

    function _esc(s) {
        if (!s) return '';
        var d = document.createElement('div');
        d.appendChild(document.createTextNode(s));
        return d.innerHTML;
    }

    document.addEventListener('huntarr:instances-changed', function() {
        if (document.getElementById('indexer-hunt-stats-content-wrapper') && window.huntarrUI && window.huntarrUI.currentSection === 'indexer-hunt-stats') {
            Stats.init();
        }
    });
    document.addEventListener('huntarr:tv-hunt-instances-changed', function() {
        if (document.getElementById('indexer-hunt-stats-content-wrapper') && window.huntarrUI && window.huntarrUI.currentSection === 'indexer-hunt-stats') {
            Stats.init();
        }
    });

})();


/* === modules/features/indexer-hunt-history.js === */
/**
 * Indexer Hunt — History page module.
 * Displays paginated event history with filters.
 */
(function() {
    'use strict';

    var History = window.IndexerHuntHistory = {};
    var _currentPage = 1;
    var _totalPages = 1;
    var _initialized = false;

    History.init = function() {
        if (!_initialized) {
            _bindEvents();
            _loadIndexerFilter();
            _initialized = true;
        }
        var noInstEl = document.getElementById('indexer-hunt-history-no-instances');
        var wrapperEl = document.getElementById('indexer-hunt-history-content-wrapper');
        var noIdxEl = document.getElementById('indexer-hunt-history-no-indexers');
        var noCliEl = document.getElementById('indexer-hunt-history-no-clients');
        Promise.all([
            fetch('./api/movie-hunt/instances', { cache: 'no-store' }).then(function(r) { return r.json(); }),
            fetch('./api/tv-hunt/instances', { cache: 'no-store' }).then(function(r) { return r.json(); }),
            fetch('./api/indexer-hunt/indexers', { cache: 'no-store' }).then(function(r) { return r.json(); }),
            fetch('./api/movie-hunt/has-clients', { cache: 'no-store' }).then(function(r) { return r.json(); })
        ]).then(function(results) {
            var movieCount = (results[0].instances || []).length;
            var tvCount = (results[1].instances || []).length;
            var indexerCount = (results[2].indexers || []).length;
            var hasClients = results[3].has_clients === true;
            if (movieCount === 0 && tvCount === 0) {
                if (noInstEl) noInstEl.style.display = '';
                if (noIdxEl) noIdxEl.style.display = 'none';
                if (noCliEl) noCliEl.style.display = 'none';
                if (wrapperEl) wrapperEl.style.display = 'none';
                return;
            }
            if (indexerCount === 0) {
                if (noInstEl) noInstEl.style.display = 'none';
                if (noIdxEl) noIdxEl.style.display = '';
                if (noCliEl) noCliEl.style.display = 'none';
                if (wrapperEl) wrapperEl.style.display = 'none';
                return;
            }
            if (!hasClients) {
                if (noInstEl) noInstEl.style.display = 'none';
                if (noIdxEl) noIdxEl.style.display = 'none';
                if (noCliEl) noCliEl.style.display = '';
                if (wrapperEl) wrapperEl.style.display = 'none';
                return;
            }
            if (noInstEl) noInstEl.style.display = 'none';
            if (noIdxEl) noIdxEl.style.display = 'none';
            if (noCliEl) noCliEl.style.display = 'none';
            if (wrapperEl) wrapperEl.style.display = '';
            _currentPage = 1;
            _loadHistory();
        }).catch(function() {
            if (noInstEl) noInstEl.style.display = 'none';
            if (noIdxEl) noIdxEl.style.display = 'none';
            if (noCliEl) noCliEl.style.display = 'none';
            if (wrapperEl) wrapperEl.style.display = '';
            _currentPage = 1;
            _loadHistory();
        });
    };

    function _bindEvents() {
        var typeFilter = document.getElementById('ih-history-type-filter');
        if (typeFilter) typeFilter.addEventListener('change', function() { _currentPage = 1; _loadHistory(); });

        var indexerFilter = document.getElementById('ih-history-indexer-filter');
        if (indexerFilter) indexerFilter.addEventListener('change', function() { _currentPage = 1; _loadHistory(); });

        var prevBtn = document.getElementById('ih-history-prev-btn');
        if (prevBtn) prevBtn.addEventListener('click', function() {
            if (_currentPage > 1) { _currentPage--; _loadHistory(); }
        });

        var nextBtn = document.getElementById('ih-history-next-btn');
        if (nextBtn) nextBtn.addEventListener('click', function() {
            if (_currentPage < _totalPages) { _currentPage++; _loadHistory(); }
        });

        var clearBtn = document.getElementById('ih-history-clear-btn');
        if (clearBtn) clearBtn.addEventListener('click', function() {
            window.HuntarrConfirm.show({
                title: 'Clear History',
                message: 'Are you sure you want to clear all Index Master history and stats? This cannot be undone.',
                confirmLabel: 'Clear',
                onConfirm: function() {
                    fetch('./api/indexer-hunt/history', { method: 'DELETE' })
                        .then(function(r) { return r.json(); })
                        .then(function(data) {
                            if (data.success) {
                                _currentPage = 1;
                                _loadHistory();
                                if (window.huntarrUI) window.huntarrUI.showNotification('History cleared.', 'success');
                            }
                        });
                }
            });
        });
    }

    function _loadIndexerFilter() {
        fetch('./api/indexer-hunt/indexers')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var sel = document.getElementById('ih-history-indexer-filter');
                if (!sel) return;
                var firstOpt = sel.querySelector('option[value=""]');
                sel.innerHTML = '';
                if (firstOpt) sel.appendChild(firstOpt);
                else {
                    var opt = document.createElement('option');
                    opt.value = '';
                    opt.textContent = 'All Indexers';
                    sel.appendChild(opt);
                }
                (data.indexers || []).forEach(function(idx) {
                    var opt = document.createElement('option');
                    opt.value = idx.id;
                    opt.textContent = idx.name;
                    sel.appendChild(opt);
                });
            });
    }

    function _loadHistory() {
        var typeFilter = document.getElementById('ih-history-type-filter');
        var indexerFilter = document.getElementById('ih-history-indexer-filter');
        var eventType = typeFilter ? typeFilter.value : '';
        var indexerId = indexerFilter ? indexerFilter.value : '';

        var params = 'page=' + _currentPage + '&page_size=50';
        if (eventType) params += '&event_type=' + encodeURIComponent(eventType);
        if (indexerId) params += '&indexer_id=' + encodeURIComponent(indexerId);

        fetch('./api/indexer-hunt/history?' + params)
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var items = data.items || [];
                _totalPages = data.total_pages || 1;
                _currentPage = data.page || 1;
                _renderTable(items);
                _updatePagination(data.total || 0);
            })
            .catch(function(err) {
                console.error('[IndexerHuntHistory] Load error:', err);
            });
    }

    function _renderTable(items) {
        var tbody = document.getElementById('ih-history-table-body');
        var tableWrap = document.getElementById('ih-history-table-wrap');
        var empty = document.getElementById('ih-history-empty');
        if (!tbody) return;

        if (items.length === 0) {
            tbody.innerHTML = '';
            if (tableWrap) tableWrap.style.display = 'none';
            if (empty) empty.style.display = 'block';
            return;
        }

        if (tableWrap) tableWrap.style.display = '';
        if (empty) empty.style.display = 'none';

        var html = '';
        items.forEach(function(ev) {
            var date = ev.created_at || '';
            try {
                var d = new Date(date);
                if (!isNaN(d.getTime())) {
                    date = d.toLocaleString();
                }
            } catch(e) {}

            var typeClass = 'ih-event-' + (ev.event_type || 'search');
            var typeBadge = '<span class="ih-event-badge ' + typeClass + '">' + _esc(ev.event_type || 'unknown') + '</span>';
            var statusIcon = ev.success
                ? '<i class="fas fa-check-circle" style="color: #10b981;"></i>'
                : '<i class="fas fa-times-circle" style="color: #ef4444;"></i>';

            html += '<tr>'
                + '<td style="white-space: nowrap; font-size: 0.85rem; color: #94a3b8;">' + _esc(date) + '</td>'
                + '<td>' + typeBadge + '</td>'
                + '<td>' + _esc(ev.indexer_name || '\u2014') + '</td>'
                + '<td>' + _esc(ev.query || '\u2014') + '</td>'
                + '<td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">' + _esc(ev.result_title || '\u2014') + '</td>'
                + '<td>' + (ev.response_time_ms || 0) + 'ms</td>'
                + '<td>' + statusIcon + '</td>'
                + '</tr>';
        });
        tbody.innerHTML = html;
    }

    function _updatePagination(total) {
        var pagination = document.getElementById('ih-history-pagination');
        var pageInfo = document.getElementById('ih-history-page-info');
        var prevBtn = document.getElementById('ih-history-prev-btn');
        var nextBtn = document.getElementById('ih-history-next-btn');

        if (total <= 50) {
            if (pagination) pagination.style.display = 'none';
            return;
        }

        if (pagination) pagination.style.display = 'flex';
        if (pageInfo) pageInfo.textContent = 'Page ' + _currentPage + ' of ' + _totalPages;
        if (prevBtn) prevBtn.disabled = _currentPage <= 1;
        if (nextBtn) nextBtn.disabled = _currentPage >= _totalPages;
    }

    function _esc(s) {
        if (!s) return '';
        var d = document.createElement('div');
        d.appendChild(document.createTextNode(s));
        return d.innerHTML;
    }

    document.addEventListener('huntarr:instances-changed', function() {
        if (document.getElementById('indexer-hunt-history-content-wrapper') && window.huntarrUI && window.huntarrUI.currentSection === 'indexer-hunt-history') {
            History.init();
        }
    });
    document.addEventListener('huntarr:tv-hunt-instances-changed', function() {
        if (document.getElementById('indexer-hunt-history-content-wrapper') && window.huntarrUI && window.huntarrUI.currentSection === 'indexer-hunt-history') {
            History.init();
        }
    });

})();


/* === modules/features/apps/sonarr.js === */
// Sonarr-specific functionality

(function(app) {
    if (!app) {
        console.error("Huntarr App core is not loaded!");
        return;
    }

    const sonarrModule = {
        elements: {},

        init: function() {
            // Cache elements specific to Sonarr settings
            this.cacheElements();
            // Setup event listeners specific to Sonarr settings
            this.setupEventListeners();
            // Initial population of the form is handled by app.js
        },

        cacheElements: function() {
            // Cache elements used by Sonarr settings form
            this.elements.apiUrlInput = document.getElementById('sonarr_api_url');
            this.elements.apiKeyInput = document.getElementById('sonarr_api_key');
            this.elements.huntMissingItemsInput = document.getElementById('sonarr-hunt-missing-items');
            this.elements.huntUpgradeItemsInput = document.getElementById('sonarr-hunt-upgrade-items');
            this.elements.sleepDurationInput = document.getElementById('sonarr_sleep_duration');
            this.elements.sleepDurationHoursSpan = document.getElementById('sonarr_sleep_duration_hours');
            this.elements.monitoredOnlyInput = document.getElementById('sonarr_monitored_only');
            this.elements.skipFutureEpisodesInput = document.getElementById('sonarr_skip_future_episodes');
            this.elements.skipSeriesRefreshInput = document.getElementById('sonarr_skip_series_refresh');
            this.elements.randomMissingInput = document.getElementById('sonarr_random_missing'); 
            this.elements.randomUpgradesInput = document.getElementById('sonarr_random_upgrades'); 
            this.elements.debugModeInput = document.getElementById('sonarr_debug_mode'); 
            this.elements.apiTimeoutInput = document.getElementById('sonarr_api_timeout'); 
            this.elements.commandWaitDelayInput = document.getElementById('sonarr_command_wait_delay'); 
            this.elements.commandWaitAttemptsInput = document.getElementById('sonarr_command_wait_attempts'); 
            this.elements.minimumDownloadQueueSizeInput = document.getElementById('sonarr_minimum_download_queue_size'); 
            // Add other Sonarr-specific elements if any
        },

        setupEventListeners: function() {
            // Add event listeners for Sonarr-specific controls if needed
            // Example: If there were unique interactions for Sonarr settings
            // Most change detection is now handled centrally by app.js

            // Update sleep duration display on input change
            if (this.elements.sleepDurationInput) {
                this.elements.sleepDurationInput.addEventListener('input', () => {
                    this.updateSleepDurationDisplay();
                    // Central change detection handles the rest
                });
            }
        },

        updateSleepDurationDisplay: function() {
            // Use the central utility function for updating duration display
            if (this.elements.sleepDurationInput && this.elements.sleepDurationHoursSpan) {
                const seconds = parseInt(this.elements.sleepDurationInput.value) || 900;
                app.updateDurationDisplay(seconds, this.elements.sleepDurationHoursSpan);
            }
        },

        // REMOVED: loadSettings function (handled by app.js)

        // REMOVED: checkForChanges function (handled by app.js)

        // REMOVED: updateSaveButtonState function (handled by app.js)

        // REMOVED: getSettingsPayload function (handled by app.js)

        // REMOVED: saveSettings function (handled by app.js)

        // REMOVED: Overriding of app.saveSettings
    };

    // Initialize Sonarr module
    sonarrModule.init();

    // Add the Sonarr module to the app for reference if needed elsewhere
    app.sonarrModule = sonarrModule;

})(window.huntarrUI); // Use the new global object name


/* === modules/features/apps/radarr.js === */
// Radarr-specific functionality

(function(app) {
    if (!app) {
        console.error("Huntarr App core is not loaded!");
        return;
    }

    const radarrModule = {
        elements: {},

        init: function() {
            console.log('[Radarr Module] Initializing...');
            this.cacheElements();
            this.setupEventListeners();
        },

        cacheElements: function() {
            // Cache elements specific to the Radarr settings form
            this.elements.apiUrlInput = document.getElementById('radarr_api_url');
            this.elements.apiKeyInput = document.getElementById('radarr_api_key');
            this.elements.huntMissingMoviesInput = document.getElementById('hunt_missing_movies');
            this.elements.huntUpgradeMoviesInput = document.getElementById('hunt_upgrade_movies');
            this.elements.sleepDurationInput = document.getElementById('radarr_sleep_duration');
            this.elements.sleepDurationHoursSpan = document.getElementById('radarr_sleep_duration_hours');
            this.elements.stateResetIntervalInput = document.getElementById('radarr_state_reset_interval_hours');
            this.elements.monitoredOnlyInput = document.getElementById('radarr_monitored_only');
            this.elements.skipFutureReleasesInput = document.getElementById('skip_future_releases'); // Note: ID might be shared
            this.elements.skipMovieRefreshInput = document.getElementById('skip_movie_refresh');
            this.elements.randomMissingInput = document.getElementById('radarr_random_missing');
            this.elements.randomUpgradesInput = document.getElementById('radarr_random_upgrades');
            this.elements.debugModeInput = document.getElementById('radarr_debug_mode');
            this.elements.apiTimeoutInput = document.getElementById('radarr_api_timeout');
            this.elements.commandWaitDelayInput = document.getElementById('radarr_command_wait_delay');
            this.elements.commandWaitAttemptsInput = document.getElementById('radarr_command_wait_attempts');
            this.elements.minimumDownloadQueueSizeInput = document.getElementById('radarr_minimum_download_queue_size');
            // Add any other Radarr-specific elements
        },

        setupEventListeners: function() {
            // Keep listeners ONLY for elements with specific UI updates beyond simple value changes
            if (this.elements.sleepDurationInput) {
                this.elements.sleepDurationInput.addEventListener('input', () => {
                    this.updateSleepDurationDisplay();
                    // No need to call checkForChanges here, handled by delegation
                });
            }
            // Remove other input listeners previously used for checkForChanges
        },

        updateSleepDurationDisplay: function() {
            // This function remains as it updates a specific UI element
            if (this.elements.sleepDurationInput && this.elements.sleepDurationHoursSpan) {
                const seconds = parseInt(this.elements.sleepDurationInput.value) || 900;
                // Assuming app.updateDurationDisplay exists and is accessible
                if (app && typeof app.updateDurationDisplay === 'function') {
                     app.updateDurationDisplay(seconds, this.elements.sleepDurationHoursSpan);
                } else {
                    console.warn("app.updateDurationDisplay not found, sleep duration text might not update.");
                }
            }
        }
    };

    // Initialize Radarr module
    document.addEventListener('DOMContentLoaded', () => {
        if (document.getElementById('radarrSettings')) {
            radarrModule.init();
            if (app) {
                app.radarrModule = radarrModule;
            }
        }
    });

})(window.huntarrUI); // Pass the global UI object


/* === modules/features/apps/lidarr.js === */
// Lidarr-specific functionality

(function(app) {
    if (!app) {
        console.error("Huntarr App core is not loaded!");
        return;
    }

    const lidarrModule = {
        elements: {
            apiUrlInput: document.getElementById('lidarr_api_url'),
            apiKeyInput: document.getElementById('lidarr_api_key'),
            connectionTestButton: document.getElementById('test-lidarr-connection'),
            huntMissingModeSelect: document.getElementById('hunt_missing_mode'),
            huntMissingItemsInput: document.getElementById('hunt_missing_items'),
            huntUpgradeItemsInput: document.getElementById('hunt_upgrade_items'),
            sleepDurationInput: document.getElementById('lidarr_sleep_duration'),
            sleepDurationHoursSpan: document.getElementById('lidarr_sleep_duration_hours'),
            stateResetIntervalInput: document.getElementById('lidarr_state_reset_interval_hours'),
            monitoredOnlyInput: document.getElementById('lidarr_monitored_only'),
            skipFutureReleasesInput: document.getElementById('lidarr_skip_future_releases'),
            skipArtistRefreshInput: document.getElementById('skip_artist_refresh'),
            randomMissingInput: document.getElementById('lidarr_random_missing'),
            randomUpgradesInput: document.getElementById('lidarr_random_upgrades'),
            debugModeInput: document.getElementById('lidarr_debug_mode'),
            apiTimeoutInput: document.getElementById('lidarr_api_timeout'),
            commandWaitDelayInput: document.getElementById('lidarr_command_wait_delay'),
            commandWaitAttemptsInput: document.getElementById('lidarr_command_wait_attempts'),
            minimumDownloadQueueSizeInput: document.getElementById('lidarr_minimum_download_queue_size')
        },

        init: function() {
            console.log('[Lidarr Module] Initializing...');
            // Cache elements specific to the Lidarr settings form
            this.elements = {
                apiUrlInput: document.getElementById('lidarr_api_url'),
                apiKeyInput: document.getElementById('lidarr_api_key'),
                connectionTestButton: document.getElementById('test-lidarr-connection'),
                huntMissingModeSelect: document.getElementById('hunt_missing_mode'),
                huntMissingItemsInput: document.getElementById('hunt_missing_items'),
                huntUpgradeItemsInput: document.getElementById('hunt_upgrade_items'),
                // ...other element references
            };

            // Add event listeners
            this.addEventListeners();
        },

        addEventListeners() {
            // Add connection test button click handler
            if (this.elements.connectionTestButton) {
                this.elements.connectionTestButton.addEventListener('click', this.testConnection.bind(this));
            }
            
            // Add event listener to update help text when missing mode changes
            if (this.elements.huntMissingModeSelect) {
                this.elements.huntMissingModeSelect.addEventListener('change', this.updateHuntMissingModeHelp.bind(this));
                // Initial update
                this.updateHuntMissingModeHelp();
            }
        },
        
        // Update help text based on selected missing mode
        updateHuntMissingModeHelp() {
            const mode = this.elements.huntMissingModeSelect.value;
            const helpText = document.querySelector('#hunt_missing_items + .setting-help');
            
            if (helpText) {
                if (mode === 'artist') {
                    helpText.textContent = "Number of artists with missing albums to search per cycle (0 to disable)";
                } else if (mode === 'album') {
                    helpText.textContent = "Number of specific albums to search per cycle (0 to disable)";
                }
            }
        },

        updateSleepDurationDisplay: function() {
            // This function remains as it updates a specific UI element
            if (this.elements.sleepDurationInput && this.elements.sleepDurationHoursSpan) {
                const seconds = parseInt(this.elements.sleepDurationInput.value) || 900;
                // Assuming app.updateDurationDisplay exists and is accessible
                if (app && typeof app.updateDurationDisplay === 'function') {
                     app.updateDurationDisplay(seconds, this.elements.sleepDurationHoursSpan);
                } else {
                    console.warn("app.updateDurationDisplay not found, sleep duration text might not update.");
                }
            }
        }
    };

    // Initialize Lidarr module when DOM content is loaded and if lidarrSettings exists
    document.addEventListener('DOMContentLoaded', () => {
        if (document.getElementById('lidarrSettings')) {
            lidarrModule.init();
            if (app) {
                app.lidarrModule = lidarrModule;
            }
        }
    });

})(window.huntarrUI); // Pass the global UI object


/* === modules/features/apps/readarr.js === */
// Readarr-specific functionality

(function(app) {
    if (!app) {
        console.error("Huntarr App core is not loaded!");
        return;
    }

    const readarrModule = {
        elements: {},

        init: function() {
            console.log('[Readarr Module] Initializing...');
            this.cacheElements();
            this.setupEventListeners();
        },

        cacheElements: function() {
            // Cache elements specific to the Readarr settings form
            this.elements.apiUrlInput = document.getElementById('readarr_api_url');
            this.elements.apiKeyInput = document.getElementById('readarr_api_key');
            this.elements.huntMissingBooksInput = document.getElementById('hunt_missing_books');
            this.elements.huntUpgradeBooksInput = document.getElementById('hunt_upgrade_books');
            this.elements.sleepDurationInput = document.getElementById('readarr_sleep_duration');
            this.elements.sleepDurationHoursSpan = document.getElementById('readarr_sleep_duration_hours');
            this.elements.stateResetIntervalInput = document.getElementById('readarr_state_reset_interval_hours');
            this.elements.monitoredOnlyInput = document.getElementById('readarr_monitored_only');
            this.elements.skipFutureReleasesInput = document.getElementById('readarr_skip_future_releases');
            this.elements.skipAuthorRefreshInput = document.getElementById('skip_author_refresh');
            this.elements.randomMissingInput = document.getElementById('readarr_random_missing');
            this.elements.randomUpgradesInput = document.getElementById('readarr_random_upgrades');
            this.elements.debugModeInput = document.getElementById('readarr_debug_mode');
            this.elements.apiTimeoutInput = document.getElementById('readarr_api_timeout');
            this.elements.commandWaitDelayInput = document.getElementById('readarr_command_wait_delay');
            this.elements.commandWaitAttemptsInput = document.getElementById('readarr_command_wait_attempts');
            this.elements.minimumDownloadQueueSizeInput = document.getElementById('readarr_minimum_download_queue_size');
            // Add any other Readarr-specific elements
        },

        setupEventListeners: function() {
            // Keep listeners ONLY for elements with specific UI updates beyond simple value changes
            if (this.elements.sleepDurationInput) {
                this.elements.sleepDurationInput.addEventListener('input', () => {
                    this.updateSleepDurationDisplay();
                    // No need to call checkForChanges here, handled by delegation
                });
            }
            // Remove other input listeners previously used for checkForChanges
        },

        updateSleepDurationDisplay: function() {
            // This function remains as it updates a specific UI element
            if (this.elements.sleepDurationInput && this.elements.sleepDurationHoursSpan) {
                const seconds = parseInt(this.elements.sleepDurationInput.value) || 900;
                // Assuming app.updateDurationDisplay exists and is accessible
                if (app && typeof app.updateDurationDisplay === 'function') {
                     app.updateDurationDisplay(seconds, this.elements.sleepDurationHoursSpan);
                } else {
                    console.warn("app.updateDurationDisplay not found, sleep duration text might not update.");
                }
            }
        }
    };

    // Initialize Readarr module
    document.addEventListener('DOMContentLoaded', () => {
        if (document.getElementById('readarrSettings')) {
            readarrModule.init();
            if (app) {
                app.readarrModule = readarrModule;
            }
        }
    });

})(window.huntarrUI); // Pass the global UI object


/* === modules/features/apps/whisparr.js === */
/**
 * Whisparr.js - Handles Whisparr settings and interactions in the Huntarr UI
 */

document.addEventListener("DOMContentLoaded", function() {
    // Don't call setupWhisparrForm here, app.js will call it when the tab is active
    // setupWhisparrForm(); 
    // setupWhisparrLogs(); // Assuming logs are handled by the main logs section
    // setupClearProcessedButtons('whisparr'); // Assuming this is handled elsewhere or not needed immediately
});

/**
 * Setup Whisparr settings form and connection test
 * This function is now called by app.js when the Whisparr settings tab is shown.
 */
function setupWhisparrForm() {
    // Use querySelector within the active panel to be safe, though IDs should be unique
    const panel = document.getElementById('whisparrSettings'); 
    if (!panel) {
        console.warn("[whisparr.js] Whisparr settings panel not found.");
        return;
    }

    const testWhisparrButton = panel.querySelector('#test-whisparr-button');
    const whisparrStatusIndicator = panel.querySelector('#whisparr-connection-status');
    const whisparrVersionDisplay = panel.querySelector('#whisparr-version');
    const apiUrlInput = panel.querySelector('#whisparr_api_url');
    const apiKeyInput = panel.querySelector('#whisparr_api_key');

    // Check if elements exist and if listener already attached to prevent duplicates
    if (!testWhisparrButton || testWhisparrButton.dataset.listenerAttached === 'true') {
         console.log("[whisparr.js] Test button not found or listener already attached.");
        return;
    }
     console.log("[whisparr.js] Setting up Whisparr form listeners.");
     testWhisparrButton.dataset.listenerAttached = 'true'; // Mark as attached

    // Test connection button
    testWhisparrButton.addEventListener('click', function() {
        // Temporarily suppress change detection to prevent the unsaved changes dialog
        window._suppressUnsavedChangesDialog = true;
        
        const apiUrl = apiUrlInput ? apiUrlInput.value.trim() : '';
        const apiKey = apiKeyInput ? apiKeyInput.value.trim() : '';
        
        if (!apiUrl || !apiKey) {
            // Reset suppression flag
            window._suppressUnsavedChangesDialog = false;
            
            // Use the main UI notification system if available
            if (typeof huntarrUI !== 'undefined' && huntarrUI.showNotification) {
                huntarrUI.showNotification('Please enter both API URL and API Key for Whisparr', 'error');
            } else {
                if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Please enter both API URL and API Key for Whisparr', 'error');
                else alert('Please enter both API URL and API Key for Whisparr');
            }
            return;
        }
        
        testWhisparrButton.disabled = true;
        if (whisparrStatusIndicator) {
            whisparrStatusIndicator.className = 'connection-status pending';
            whisparrStatusIndicator.textContent = 'Testing...';
        }
        
        // Direct connection test - let the backend handle version checking
        HuntarrUtils.fetchWithTimeout('./api/whisparr/test-connection', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                api_url: apiUrl,
                api_key: apiKey
            })
        })
        .then(response => response.json())
        .then(data => {
            if (whisparrStatusIndicator) {
                if (data.success) {
                    whisparrStatusIndicator.className = 'connection-status success';
                    whisparrStatusIndicator.textContent = 'Connected';
                    if (typeof huntarrUI !== 'undefined' && huntarrUI.showNotification) {
                         huntarrUI.showNotification('Successfully connected to Whisparr V2', 'success');
                    }
                    getWhisparrVersion(); // Fetch version after successful connection
                } else {
                    whisparrStatusIndicator.className = 'connection-status failure';
                    whisparrStatusIndicator.textContent = 'Failed';
                     if (typeof huntarrUI !== 'undefined' && huntarrUI.showNotification) {
                        huntarrUI.showNotification('Connection to Whisparr failed: ' + data.message, 'error');
                    }
                }
            }
        })
        .catch(error => {
            if (whisparrStatusIndicator) {
                whisparrStatusIndicator.className = 'connection-status failure';
                whisparrStatusIndicator.textContent = 'Error';
            }
            if (typeof huntarrUI !== 'undefined' && huntarrUI.showNotification) {
                huntarrUI.showNotification('Error testing Whisparr connection: ' + error, 'error');
            }
        })
        .finally(() => {
            if (testWhisparrButton.disabled) {
                testWhisparrButton.disabled = false;
            }
            
            // Reset suppression flag after a short delay
            setTimeout(() => {
                window._suppressUnsavedChangesDialog = false;
            }, 500);
        });
    });

    // Get Whisparr version if connection details are present and version display exists
    // Only perform auto-check if we haven't already fetched the version
    if (apiUrlInput && apiKeyInput && whisparrVersionDisplay && 
        apiUrlInput.value && apiKeyInput.value && 
        (!whisparrVersionDisplay.textContent || whisparrVersionDisplay.textContent === 'Unknown')) {
        
        // Set a flag to prevent automatic version checks from triggering unsaved changes
        const wasSettingsChanged = typeof huntarrUI !== 'undefined' ? huntarrUI.settingsChanged : false;
        
        getWhisparrVersion();
        
        // Restore the original settingsChanged state after the version check
        if (typeof huntarrUI !== 'undefined' && huntarrUI.settingsChanged !== wasSettingsChanged) {
            setTimeout(() => {
                huntarrUI.settingsChanged = wasSettingsChanged;
                console.log("[whisparr.js] Restored settingsChanged state after version check");
                
                // If there are no actual changes, update the save button state
                if (!wasSettingsChanged && typeof huntarrUI.updateSaveResetButtonState === 'function') {
                    huntarrUI.updateSaveResetButtonState(false);
                }
            }, 100);
        }
    }

    // Function to get Whisparr version
    function getWhisparrVersion() {
        if (!whisparrVersionDisplay) return; // Check if element exists

        const wasSettingsChanged = typeof huntarrUI !== 'undefined' ? huntarrUI.settingsChanged : false;
        
        HuntarrUtils.fetchWithTimeout('./api/whisparr/get-versions')
            .then(response => {
                if (!response.ok) {
                    throw new Error('Failed to fetch Whisparr version');
                }
                return response.json();
            })
            .then(data => {
                if (data.success && data.version) {
                    // Temporarily store the textContent so we can detect if it actually changes
                    const oldContent = whisparrVersionDisplay.textContent;
                    const newContent = `v${data.version}`;
                    
                    if (oldContent !== newContent) {
                        whisparrVersionDisplay.textContent = newContent; // Prepend 'v'
                        
                        // Restore settings changed state to prevent triggering the dialog
                        if (typeof huntarrUI !== 'undefined') {
                            setTimeout(() => {
                                huntarrUI.settingsChanged = wasSettingsChanged;
                                
                                // If there are no actual changes, update the save button state
                                if (!wasSettingsChanged && typeof huntarrUI.updateSaveResetButtonState === 'function') {
                                    huntarrUI.updateSaveResetButtonState(false);
                                }
                            }, 50);
                        }
                    }
                } else {
                    whisparrVersionDisplay.textContent = 'Unknown';
                }
            })
            .catch(error => {
                whisparrVersionDisplay.textContent = 'Error';
                console.error('Error fetching Whisparr version:', error);
            })
            .finally(() => {
                // Final safety check to restore settings state
                if (typeof huntarrUI !== 'undefined' && huntarrUI.settingsChanged !== wasSettingsChanged) {
                    setTimeout(() => {
                        huntarrUI.settingsChanged = wasSettingsChanged;
                        // If there are no actual changes, update the save button state
                        if (!wasSettingsChanged && typeof huntarrUI.updateSaveResetButtonState === 'function') {
                            huntarrUI.updateSaveResetButtonState(false);
                        }
                    }, 100);
                }
            });
    }
}



/* === modules/features/apps/eros.js === */
/**
 * Eros.js - Handles Eros settings and interactions in the Huntarr UI
 */

document.addEventListener('DOMContentLoaded', function() {
    // Don't call setupErosForm here, app.js will call it when the tab is active
    // setupErosForm(); 
    // setupErosLogs(); // Assuming logs are handled by the main logs section
    // setupClearProcessedButtons('eros'); // Assuming this is handled elsewhere or not needed immediately
});

/**
 * Setup Eros settings form and connection test
 * This function is now called by app.js when the Eros settings tab is shown.
 */
function setupErosForm() {
    console.log("[eros.js] Setting up Eros form...");
    const panel = document.getElementById('erosSettings'); 
    if (!panel) {
        console.warn("[eros.js] Eros settings panel not found.");
        return;
    }
  
    const testErosButton = panel.querySelector('#test-eros-button');
    const erosStatusIndicator = panel.querySelector('#eros-connection-status');
    const erosVersionDisplay = panel.querySelector('#eros-version');
    const apiUrlInput = panel.querySelector('#eros_api_url');
    const apiKeyInput = panel.querySelector('#eros_api_key');
    
    // Check if event listener is already attached (prevents duplicate handlers)
    if (!testErosButton || testErosButton.dataset.listenerAttached === 'true') {
         console.log("[eros.js] Test button not found or listener already attached.");
         return;
    }
     console.log("[eros.js] Setting up Eros form listeners.");
     testErosButton.dataset.listenerAttached = 'true'; // Mark as attached
    
    // Add event listener for connection test
    testErosButton.addEventListener('click', function() {
        console.log("[eros.js] Testing Eros connection...");
        
        // Temporarily suppress change detection to prevent the unsaved changes dialog
        window._suppressUnsavedChangesDialog = true;
        
        // Basic validation
        if (!apiUrlInput.value || !apiKeyInput.value) {
            // Reset suppression flag
            window._suppressUnsavedChangesDialog = false;
            
            if (typeof huntarrUI !== 'undefined') {
                huntarrUI.showNotification('Please enter both API URL and API Key for Eros', 'error');
            } else {
                if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Please enter both API URL and API Key for Eros', 'error');
                else alert('Please enter both API URL and API Key for Eros');
            }
            return;
        }
        
        // Disable button during test and show pending status
        testErosButton.disabled = true;
        if (erosStatusIndicator) {
            erosStatusIndicator.className = 'connection-status pending';
            erosStatusIndicator.textContent = 'Testing...';
        }
        
        // Call API to test connection
        HuntarrUtils.fetchWithTimeout('./api/eros/test-connection', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                api_url: apiUrlInput.value,
                api_key: apiKeyInput.value,
                api_timeout: 30
            })
        }, 30000) // 30 second timeout
        .then(response => response.json())
        .then(data => {
            // Enable the button again
            testErosButton.disabled = false;
            
            // Reset suppression flag after a short delay
            setTimeout(() => {
                window._suppressUnsavedChangesDialog = false;
            }, 500);
            
            if (erosStatusIndicator) {
                if (data.success) {
                    erosStatusIndicator.className = 'connection-status success';
                    erosStatusIndicator.textContent = 'Connected';
                    if (typeof huntarrUI !== 'undefined') {
                         huntarrUI.showNotification('Successfully connected to Eros', 'success');
                    }
                    getErosVersion(); // Fetch version after successful connection
                } else {
                    erosStatusIndicator.className = 'connection-status failure';
                    erosStatusIndicator.textContent = 'Failed';
                    if (typeof huntarrUI !== 'undefined') {
                        huntarrUI.showNotification(data.message || 'Failed to connect to Eros', 'error');
                    } else {
                        if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification(data.message || 'Failed to connect to Eros', 'error');
                        else alert(data.message || 'Failed to connect to Eros');
                    }
                }
            }
        })
        .catch(error => {
            console.error('[eros.js] Error testing connection:', error);
            testErosButton.disabled = false;
            
            // Reset suppression flag
            window._suppressUnsavedChangesDialog = false;
            
            if (erosStatusIndicator) {
                erosStatusIndicator.className = 'connection-status failure';
                erosStatusIndicator.textContent = 'Error';
            }
            
            if (typeof huntarrUI !== 'undefined') {
                huntarrUI.showNotification('Error testing connection: ' + error.message, 'error');
            } else {
                if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Error testing connection: ' + error.message, 'error');
                else alert('Error testing connection: ' + error.message);
            }
        });
    });
    
    // Initialize form state and fetch data
    refreshErosStatusAndVersion();
}

/**
 * Get the Eros software version from the instance.
 * This is separate from the API test.
 */
function getErosVersion() {
    const panel = document.getElementById('erosSettings');
    if (!panel) return;
    
    const versionDisplay = panel.querySelector('#eros-version');
    if (!versionDisplay) return;
    
    // Try to get the API settings from the form
    const apiUrlInput = panel.querySelector('#eros_api_url');
    const apiKeyInput = panel.querySelector('#eros_api_key');
    
    if (!apiUrlInput || !apiUrlInput.value || !apiKeyInput || !apiKeyInput.value) {
        versionDisplay.textContent = 'N/A';
        return;
    }
    
    // Endpoint to get version info - using the test endpoint since it returns version
    HuntarrUtils.fetchWithTimeout('./api/eros/test-connection', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            api_url: apiUrlInput.value,
            api_key: apiKeyInput.value,
            api_timeout: 10
        })
    }, 10000)
    .then(response => response.json())
    .then(data => {
        if (data.success && data.version) {
            versionDisplay.textContent = 'v' + data.version;
        } else {
            versionDisplay.textContent = 'Unknown';
        }
    })
    .catch(error => {
        console.error('[eros.js] Error fetching version:', error);
        versionDisplay.textContent = 'Error';
    });
}

/**
 * Refresh the connection status and version display for Eros.
 */
function refreshErosStatusAndVersion() {
    // Try to get current connection status from the server
    HuntarrUtils.fetchWithTimeout('./api/eros/status')
        .then(response => response.json())
        .then(data => {
            const panel = document.getElementById('erosSettings');
            if (!panel) return;
            
            const statusIndicator = panel.querySelector('#eros-connection-status');
            if (statusIndicator) {
                if (data.connected) {
                    statusIndicator.className = 'connection-status success';
                    statusIndicator.textContent = 'Connected';
                    getErosVersion(); // Try to get version if connected
                } else if (data.configured) {
                    statusIndicator.className = 'connection-status failure';
                    statusIndicator.textContent = 'Not Connected';
                } else {
                    statusIndicator.className = 'connection-status pending';
                    statusIndicator.textContent = 'Not Configured';
                }
            }
        })
        .catch(error => {
            console.error('[eros.js] Error checking status:', error);
        });
}

// Mark functions as global if needed by other parts of the application
window.setupErosForm = setupErosForm;
window.getErosVersion = getErosVersion;
window.refreshErosStatusAndVersion = refreshErosStatusAndVersion;


/* === modules/features/apps/swaparr-view.js === */
// Enhanced Swaparr-specific functionality

(function(app) {
    if (!app) {
        console.error("Huntarr App core is not loaded!");
        return;
    }

    const swaparrModule = {
        elements: {},
        isTableView: true, // Default to table view for Swaparr logs
        hasRenderedAnyContent: false, // Track if we've rendered any content
        
        // Store data for display with enhanced structure
        logData: {
            config: {
                platform: '',
                maxStrikes: 3,
                scanInterval: '10m',
                maxDownloadTime: '2h',
                ignoreAboveSize: '25 GB',
                dryRun: false,
                removeFromClient: true
            },
            downloads: [],  // Will store download status records
            statistics: {   // Enhanced statistics tracking
                session: {
                    total_processed: 0,
                    strikes_added: 0,
                    downloads_removed: 0,
                    items_ignored: 0,
                    api_calls_made: 0,
                    errors_encountered: 0,
                    apps_processed: [],
                    last_update: null
                },
                apps: {} // Per-app statistics
            },
            rawLogs: []     // Store raw logs for backup display
        },

        init: function() {
            console.log('[Swaparr Module] Initializing enhanced Swaparr module...');
            this.setupLogProcessor();
            this.setupEventListeners();
            
            // Try to load initial statistics
            this.loadStatistics();
        },

        setupEventListeners: function() {
            // Add a listener for when the log tab changes to Swaparr
            const swaparrTab = document.querySelector('.log-tab[data-app="swaparr"]');
            if (swaparrTab) {
                swaparrTab.addEventListener('click', () => {
                    console.log('[Swaparr Module] Swaparr tab clicked');
                    // Small delay to ensure everything is ready
                    setTimeout(() => {
                        this.ensureContentRendered();
                    }, 200);
                });
            }
        },

        setupLogProcessor: function() {
            // Setup a listener for custom event from huntarrUI's log processing
            document.addEventListener('swaparrLogReceived', (event) => {
                console.log('[Swaparr Module] Received log event:', event.detail.logData.substring(0, 100) + '...');
                this.processLogLine(event.detail.logData);
            });
        },

        loadStatistics: function() {
            // Load statistics from the API
            HuntarrUtils.fetchWithTimeout('./api/swaparr/status')
                .then(response => response.json())
                .then(data => {
                    if (data.session_statistics) {
                        this.logData.statistics.session = data.session_statistics;
                    }
                    if (data.app_statistics) {
                        this.logData.statistics.apps = data.app_statistics;
                    }
                    if (data.settings) {
                        this.updateConfigFromSettings(data.settings);
                    }
                    
                    console.log('[Swaparr Module] Loaded statistics from API');
                    
                    // Re-render if we're viewing Swaparr
                    if (app.currentLogApp === 'swaparr') {
                        this.ensureContentRendered();
                    }
                })
                .catch(error => {
                    console.warn('[Swaparr Module] Could not load statistics:', error);
                });
        },

        updateConfigFromSettings: function(settings) {
            this.logData.config.maxStrikes = settings.max_strikes || 3;
            this.logData.config.maxDownloadTime = settings.max_download_time || '2h';
            this.logData.config.ignoreAboveSize = settings.ignore_above_size || '25GB';
            this.logData.config.dryRun = settings.dry_run || false;
            this.logData.config.removeFromClient = settings.remove_from_client !== false;
        },

        processLogLine: function(logLine) {
            // Always store raw logs for backup display
            this.logData.rawLogs.push(logLine);
            
            // Limit raw logs storage to prevent memory issues
            if (this.logData.rawLogs.length > 500) {
                this.logData.rawLogs.shift();
            }
            
            // Process log lines specific to Swaparr
            if (!logLine) return;

            // Check if this looks like a Swaparr config line and extract information
            if (logLine.includes('Platform:') && logLine.includes('Max strikes:')) {
                this.extractConfigInfo(logLine);
                this.renderConfigPanel();
                return;
            }
            
            // Look for enhanced strike-related logs from system
            if (logLine.includes('Added strike') || 
                logLine.includes('Max strikes reached') || 
                logLine.includes('removing download') ||
                logLine.includes('Would have removed') ||
                logLine.includes('Successfully removed') ||
                logLine.includes('Re-removed previously removed') ||
                logLine.includes('Session stats')) {
                
                this.processStrikeLog(logLine);
                return;
            }

            // Check for session statistics updates
            if (logLine.includes('Session stats - Strikes:')) {
                this.extractSessionStats(logLine);
                this.renderStatisticsPanel();
                return;
            }

            // Check if this is a table header/separator line
            if (logLine.includes('strikes') && logLine.includes('status') && logLine.includes('name') && logLine.includes('size') && logLine.includes('eta')) {
                // This is the header line, we can ignore it or use it to confirm table format
                return;
            }

            // Try to match enhanced download info line
            const downloadLinePattern = /(\d+\/\d+)\s+(\w+)\s+(.+?)\s+(\d+(?:\.\d+)?)\s*(\w+)\s+([\ddhms\s]+|Infinite)/;
            const match = logLine.match(downloadLinePattern);
            
            if (match) {
                // Extract download information
                const downloadInfo = {
                    strikes: match[1],
                    status: match[2],
                    name: match[3],
                    size: match[4] + ' ' + match[5],
                    eta: match[6],
                    timestamp: new Date().toISOString()
                };
                
                // Update or add to our list of downloads
                this.updateDownloadsList(downloadInfo);
                this.renderTableView();
            }
            
            // If we're viewing the Swaparr tab, always ensure content is rendered
            if (app.currentLogApp === 'swaparr') {
                this.ensureContentRendered();
            }
        },

        extractSessionStats: function(logLine) {
            // Extract session statistics from log line
            // Format: "Session stats - Strikes: X, Removed: Y, Ignored: Z, API calls: W"
            const strikes = logLine.match(/Strikes: (\d+)/);
            const removed = logLine.match(/Removed: (\d+)/);
            const ignored = logLine.match(/Ignored: (\d+)/);
            const apiCalls = logLine.match(/API calls: (\d+)/);
            
            if (strikes) this.logData.statistics.session.strikes_added = parseInt(strikes[1]);
            if (removed) this.logData.statistics.session.downloads_removed = parseInt(removed[1]);
            if (ignored) this.logData.statistics.session.items_ignored = parseInt(ignored[1]);
            if (apiCalls) this.logData.statistics.session.api_calls_made = parseInt(apiCalls[1]);
            
            this.logData.statistics.session.last_update = new Date().toISOString();
        },
        
        // Process enhanced strike-related logs from system logs
        processStrikeLog: function(logLine) {
            // Try to extract download name and strike info
            let downloadName = '';
            let strikes = '1/3'; // Default value
            let status = 'Striked';
            
            // Extract download name and update statistics
            if (logLine.includes('Added strike')) {
                const match = logLine.match(/Added strike \((\d+)\/(\d+)\) to (.+?) - Reason:/);
                if (match) {
                    strikes = `${match[1]}/${match[2]}`;
                    downloadName = match[3];
                    status = 'Striked';
                    this.logData.statistics.session.strikes_added++;
                }
            } else if (logLine.includes('Max strikes reached')) {
                const match = logLine.match(/Max strikes reached for (.+?), removing download/);
                if (match) {
                    downloadName = match[1];
                    status = 'Removing';
                }
            } else if (logLine.includes('Successfully removed')) {
                const match = logLine.match(/Successfully removed (.+?) after (\d+) strikes/);
                if (match) {
                    downloadName = match[1];
                    status = 'Removed';
                    strikes = `${match[2]}/3`;
                    this.logData.statistics.session.downloads_removed++;
                }
            } else if (logLine.includes('Would have removed')) {
                const match = logLine.match(/Would have removed (.+?) after (\d+) strikes/);
                if (match) {
                    downloadName = match[1];
                    status = 'Pending Removal (Dry Run)';
                    strikes = `${match[2]}/3`;
                }
            } else if (logLine.includes('Re-removed previously removed')) {
                const match = logLine.match(/Re-removed previously removed download: (.+)/);
                if (match) {
                    downloadName = match[1];
                    status = 'Re-removed';
                    this.logData.statistics.session.downloads_removed++;
                }
            }
            
            if (downloadName) {
                // Create a download info object with partial information
                const downloadInfo = {
                    strikes: strikes,
                    status: status,
                    name: downloadName,
                    size: 'Unknown',
                    eta: 'Unknown',
                    timestamp: new Date().toISOString()
                };
                
                // Update downloads list
                this.updateDownloadsList(downloadInfo);
                this.renderTableView();
                this.renderStatisticsPanel(); // Update statistics display
            }
        },

        extractConfigInfo: function(logLine) {
            // Extract the config data from the log line
            const platformMatch = logLine.match(/Platform:\s+(\w+)/);
            const maxStrikesMatch = logLine.match(/Max strikes:\s+(\d+)/);
            const scanIntervalMatch = logLine.match(/Scan interval:\s+(\d+\w+)/);
            const maxDownloadTimeMatch = logLine.match(/Max download time:\s+(\d+\w+)/);
            const ignoreSizeMatch = logLine.match(/Ignore above size:\s+(\d+\s*\w+)/);
            
            if (platformMatch) this.logData.config.platform = platformMatch[1];
            if (maxStrikesMatch) this.logData.config.maxStrikes = maxStrikesMatch[1];
            if (scanIntervalMatch) this.logData.config.scanInterval = scanIntervalMatch[1];
            if (maxDownloadTimeMatch) this.logData.config.maxDownloadTime = maxDownloadTimeMatch[1];
            if (ignoreSizeMatch) this.logData.config.ignoreAboveSize = ignoreSizeMatch[1];
        },

        updateDownloadsList: function(downloadInfo) {
            // Find if this download already exists in our list
            const existingIndex = this.logData.downloads.findIndex(item => 
                item.name.trim() === downloadInfo.name.trim()
            );
            
            if (existingIndex >= 0) {
                // Update existing entry but preserve timestamp if newer
                const existing = this.logData.downloads[existingIndex];
                this.logData.downloads[existingIndex] = {
                    ...downloadInfo,
                    first_seen: existing.first_seen || existing.timestamp || downloadInfo.timestamp
                };
            } else {
                // Add new entry
                downloadInfo.first_seen = downloadInfo.timestamp;
                this.logData.downloads.push(downloadInfo);
            }
            
            // Keep only the last 100 downloads to prevent memory issues
            if (this.logData.downloads.length > 100) {
                this.logData.downloads = this.logData.downloads.slice(-100);
            }
        },

        renderConfigPanel: function() {
            // Find the logs container
            const logsContainer = document.getElementById('logsContainer');
            if (!logsContainer) return;
            
            // If the user has selected swaparr logs, show the config panel at the top
            if (app.currentLogApp === 'swaparr') {
                // Check if config panel already exists
                let configPanel = document.getElementById('swaparr-config-panel');
                if (!configPanel) {
                    // Create the panel
                    configPanel = document.createElement('div');
                    configPanel.id = 'swaparr-config-panel';
                    configPanel.classList.add('swaparr-panel');
                    logsContainer.appendChild(configPanel);
                }
                
                const dryRunBadge = this.logData.config.dryRun ? 
                    '<span class="swaparr-badge swaparr-badge-warning">DRY RUN</span>' : '';
                
                // Update the panel content with enhanced information
                configPanel.innerHTML = `
                    <div class="swaparr-config">
                        <h3>
                            <i class="fas fa-exchange-alt"></i>
                            Swaparr${this.logData.config.platform ? ' — ' + this.logData.config.platform : ''}
                            ${dryRunBadge}
                        </h3>
                        <div class="swaparr-config-content">
                            <div class="config-item">
                                <i class="fas fa-exclamation-triangle"></i>
                                <span>Max strikes: <strong>${this.logData.config.maxStrikes}</strong></span>
                            </div>
                            <div class="config-item">
                                <i class="fas fa-clock"></i>
                                <span>Max download time: <strong>${this.logData.config.maxDownloadTime}</strong></span>
                            </div>
                            <div class="config-item">
                                <i class="fas fa-weight-hanging"></i>
                                <span>Ignore above: <strong>${this.logData.config.ignoreAboveSize}</strong></span>
                            </div>
                            <div class="config-item">
                                <i class="fas fa-trash-alt"></i>
                                <span>Remove from client: <strong>${this.logData.config.removeFromClient ? 'Yes' : 'No'}</strong></span>
                            </div>
                        </div>
                    </div>
                `;
                
                this.hasRenderedAnyContent = true;
            }
        },

        renderStatisticsPanel: function() {
            // Find the logs container
            const logsContainer = document.getElementById('logsContainer');
            if (!logsContainer || app.currentLogApp !== 'swaparr') return;
            
            // Check if statistics panel already exists
            let statsPanel = document.getElementById('swaparr-stats-panel');
            if (!statsPanel) {
                // Create the panel
                statsPanel = document.createElement('div');
                statsPanel.id = 'swaparr-stats-panel';
                statsPanel.classList.add('swaparr-panel');
                logsContainer.appendChild(statsPanel);
            }
            
            const stats = this.logData.statistics.session;
            const lastUpdate = stats.last_update ? 
                new Date(stats.last_update).toLocaleTimeString() : 'Never';
            
            // Generate app-specific statistics
            let appStatsHtml = '';
            for (const [appName, appStats] of Object.entries(this.logData.statistics.apps)) {
                if (appStats.error) continue;
                
                appStatsHtml += `
                    <div class="app-stat">
                        <strong>${appName.toUpperCase()}</strong>: 
                        ${appStats.currently_striked || 0} striked, 
                        ${appStats.total_removed || 0} removed
                    </div>
                `;
            }
            
            // Update the panel content
            statsPanel.innerHTML = `
                <div class="swaparr-statistics">
                    <h4><i class="fas fa-chart-line"></i> Session Statistics</h4>
                    <div class="stats-grid">
                        <div class="stat-item">
                            <i class="fas fa-tasks"></i>
                            <span class="stat-value">${stats.total_processed || 0}</span>
                            <span class="stat-label">Processed</span>
                        </div>
                        <div class="stat-item">
                            <i class="fas fa-exclamation-triangle"></i>
                            <span class="stat-value">${stats.strikes_added || 0}</span>
                            <span class="stat-label">Strikes Added</span>
                        </div>
                        <div class="stat-item">
                            <i class="fas fa-trash-alt"></i>
                            <span class="stat-value">${stats.downloads_removed || 0}</span>
                            <span class="stat-label">Removed</span>
                        </div>
                        <div class="stat-item">
                            <i class="fas fa-eye-slash"></i>
                            <span class="stat-value">${stats.items_ignored || 0}</span>
                            <span class="stat-label">Ignored</span>
                        </div>
                        <div class="stat-item">
                            <i class="fas fa-network-wired"></i>
                            <span class="stat-value">${stats.api_calls_made || 0}</span>
                            <span class="stat-label">API Calls</span>
                        </div>
                        <div class="stat-item">
                            <i class="fas fa-exclamation-circle"></i>
                            <span class="stat-value">${stats.errors_encountered || 0}</span>
                            <span class="stat-label">Errors</span>
                        </div>
                    </div>
                    <div class="stats-apps">
                        ${appStatsHtml}
                    </div>
                    <div class="stats-footer">
                        <small>Last update: ${lastUpdate}</small>
                    </div>
                </div>
            `;
            
            this.hasRenderedAnyContent = true;
        },

        renderTableView: function() {
            // Find the logs container
            const logsContainer = document.getElementById('logsContainer');
            if (!logsContainer || app.currentLogApp !== 'swaparr') return;
            
            // Check if table already exists
            let tableView = document.getElementById('swaparr-table-view');
            if (!tableView) {
                // Create the table
                tableView = document.createElement('div');
                tableView.id = 'swaparr-table-view';
                tableView.classList.add('swaparr-table');
                logsContainer.appendChild(tableView);
            }
            
            // Only render table if we have downloads to show
            if (this.logData.downloads.length > 0) {
                // Generate table HTML with enhanced styling
                let tableHTML = `
                    <div class="swaparr-table-header">
                        <h4><i class="fas fa-download"></i> Download Queue Status (${this.logData.downloads.length} items)</h4>
                    </div>
                    <table class="swaparr-downloads-table">
                        <thead>
                            <tr>
                                <th><i class="fas fa-exclamation-triangle"></i> Strikes</th>
                                <th><i class="fas fa-info-circle"></i> Status</th>
                                <th><i class="fas fa-file"></i> Name</th>
                                <th><i class="fas fa-weight-hanging"></i> Size</th>
                                <th><i class="fas fa-clock"></i> ETA</th>
                                <th><i class="fas fa-calendar-alt"></i> First Seen</th>
                            </tr>
                        </thead>
                        <tbody>
                `;
                
                // Sort downloads by timestamp (newest first)
                const sortedDownloads = [...this.logData.downloads].sort((a, b) => 
                    new Date(b.timestamp || 0) - new Date(a.timestamp || 0)
                );
                
                // Add each download as a row
                sortedDownloads.forEach(download => {
                    // Apply status-specific CSS class
                    let statusClass = download.status.toLowerCase().replace(/\s+/g, '-');
                    
                    // Normalize some status values
                    if (statusClass.includes('pending')) statusClass = 'pending';
                    if (statusClass.includes('removed')) statusClass = 'removed';
                    if (statusClass.includes('striked')) statusClass = 'striked';
                    if (statusClass.includes('normal')) statusClass = 'normal';
                    if (statusClass.includes('ignored')) statusClass = 'ignored';
                    if (statusClass.includes('dry-run')) statusClass = 'dry-run';
                    
                    const firstSeen = download.first_seen ? 
                        new Date(download.first_seen).toLocaleString() : 'Unknown';
                    
                    tableHTML += `
                        <tr class="swaparr-status-${statusClass}">
                            <td><span class="strikes-badge">${download.strikes}</span></td>
                            <td><span class="status-badge status-${statusClass}">${download.status}</span></td>
                            <td title="${download.name}">${download.name}</td>
                            <td>${download.size}</td>
                            <td>${download.eta}</td>
                            <td><small>${firstSeen}</small></td>
                        </tr>
                    `;
                });
                
                tableHTML += `
                        </tbody>
                    </table>
                `;
                
                tableView.innerHTML = tableHTML;
                this.hasRenderedAnyContent = true;
            } else {
                // Show empty state
                tableView.innerHTML = `
                    <div class="swaparr-empty-state">
                        <i class="fas fa-download"></i>
                        <h4>No Downloads Tracked</h4>
                        <p>Swaparr is monitoring download queues but hasn't found any stalled downloads yet.</p>
                    </div>
                `;
                this.hasRenderedAnyContent = true;
            }
        },
        
        // Render raw logs if we don't have structured content
        renderRawLogs: function() {
            // Only show raw logs if we have no other content
            if (this.hasRenderedAnyContent) return;
            
            const logsContainer = document.getElementById('logsContainer');
            if (!logsContainer || app.currentLogApp !== 'swaparr') return;
            
            // Start with a message
            const noDataMessage = document.createElement('div');
            noDataMessage.classList.add('swaparr-panel');
            noDataMessage.innerHTML = `
                <div class="swaparr-config">
                    <h3><i class="fas fa-exchange-alt"></i> Swaparr Logs</h3>
                    <p>Waiting for structured Swaparr data. Showing raw logs below:</p>
                </div>
            `;
            logsContainer.appendChild(noDataMessage);
            
            // Add raw logs
            for (const logLine of this.logData.rawLogs.slice(-50)) { // Show only last 50 lines
                const logEntry = document.createElement('div');
                logEntry.className = 'log-entry';
                logEntry.innerHTML = `<span class="log-message">${logLine}</span>`;
                
                // Basic level detection
                if (logLine.includes('ERROR')) logEntry.classList.add('log-error');
                else if (logLine.includes('WARN') || logLine.includes('WARNING')) logEntry.classList.add('log-warning');
                else if (logLine.includes('DEBUG')) logEntry.classList.add('log-debug');
                else logEntry.classList.add('log-info');
                
                logsContainer.appendChild(logEntry);
            }
            
            this.hasRenderedAnyContent = true;
        },
        
        // Make sure we display something in the Swaparr tab
        ensureContentRendered: function() {
            console.log('[Swaparr Module] Ensuring content is rendered, has content:', this.hasRenderedAnyContent);
            
            // Reset rendered flag
            this.hasRenderedAnyContent = false;
            
            // Check if we're viewing Swaparr tab
            if (app.currentLogApp !== 'swaparr') return;
            
            // Clear existing content
            const logsContainer = document.getElementById('logsContainer');
            if (logsContainer) {
                // Remove only Swaparr-specific content
                const swaparrElements = logsContainer.querySelectorAll('[id^="swaparr-"], .swaparr-panel, .swaparr-table, .swaparr-empty-state');
                swaparrElements.forEach(el => el.remove());
            }
            
            // First try to render structured content
            this.renderConfigPanel();
            this.renderStatisticsPanel();
            this.renderTableView();
            
            // If no structured content, show raw logs
            if (!this.hasRenderedAnyContent) {
                this.renderRawLogs();
            }
        },

        // Clear the data when switching log views
        clearData: function() {
            this.logData.downloads = [];
            // Keep raw logs and statistics for persistence
            this.hasRenderedAnyContent = false;
        }
    };

    // Initialize the module
    document.addEventListener('DOMContentLoaded', () => {
        swaparrModule.init();
        
        if (app) {
            app.swaparrModule = swaparrModule;
            
            // Setup a handler for when log tabs are changed
            document.querySelectorAll('.log-tab').forEach(tab => {
                tab.addEventListener('click', (e) => {
                    // If switching to swaparr tab, make sure we render the view
                    if (e.target.getAttribute('data-app') === 'swaparr') {
                        console.log('[Swaparr Module] Swaparr tab clicked via delegation');
                        // Small delay to allow logs to load
                        setTimeout(() => {
                            swaparrModule.ensureContentRendered();
                        }, 200);
                    }
                    // If switching away from swaparr tab, clear the visual data
                    else if (app.currentLogApp === 'swaparr') {
                        swaparrModule.clearData();
                    }
                });
            });
        }
    });

})(window.huntarrUI); // Pass the global UI object 

/* === modules/ui/stats.js === */
/**
 * Stats & Dashboard Module
 * Handles media stats, app connections, dashboard display,
 * grid/list view, live polling, and drag-and-drop reordering.
 */

window.HuntarrStats = {
    isLoadingStats: false,
    _pollInterval: null,
    _currentViewMode: 'list', // 'grid' or 'list'
    _lastRenderedMode: null,  // Track which mode we last rendered

    // App metadata: order, display names, icons, accent colors
    APP_META: {
        tv_hunt:    { label: 'TV Hunt',    icon: './static/logo/256.png', accent: '#a855f7' },
        movie_hunt: { label: 'Movie Hunt', icon: './static/logo/256.png', accent: '#f59e0b' },
        sonarr:     { label: 'Sonarr',     icon: './static/images/app-icons/sonarr.png', accent: '#6366f1' },
        radarr:     { label: 'Radarr',     icon: './static/images/app-icons/radarr.png', accent: '#f59e0b' },
        lidarr:     { label: 'Lidarr',     icon: './static/images/app-icons/lidarr.png', accent: '#22c55e' },
        readarr:    { label: 'Readarr',    icon: './static/images/app-icons/readarr.png', accent: '#a855f7' },
        whisparr:   { label: 'Whisparr V2', icon: './static/images/app-icons/whisparr.png', accent: '#ec4899' },
        eros:       { label: 'Whisparr V3', icon: './static/images/app-icons/whisparr.png', accent: '#ec4899' }
    },
    DEFAULT_APP_ORDER: ['tv_hunt', 'movie_hunt', 'sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros'],

    // ─── Polling ──────────────────────────────────────────────────────
    startPolling: function() {
        this.stopPolling();
        var self = this;
        this._pollInterval = setInterval(function() {
            self.loadMediaStats(true);
        }, 15000);
    },

    stopPolling: function() {
        if (this._pollInterval) {
            clearInterval(this._pollInterval);
            this._pollInterval = null;
        }
        this._stopNzbHomePoll();
    },

    // ─── Layout Persistence ───────────────────────────────────────────
    _getLayout: function() {
        return HuntarrUtils.getUIPreference('dashboard-layout', null);
    },

    _saveLayout: function(layout) {
        HuntarrUtils.setUIPreference('dashboard-layout', layout);
    },

    _getGroupOrder: function() {
        var layout = this._getLayout();
        if (layout && Array.isArray(layout.groups) && layout.groups.length > 0) {
            var order = layout.groups.slice();
            this.DEFAULT_APP_ORDER.forEach(function(app) {
                if (order.indexOf(app) === -1) order.push(app);
            });
            return order;
        }
        return this.DEFAULT_APP_ORDER.slice();
    },

    _getCardOrder: function() {
        var layout = this._getLayout();
        if (layout && Array.isArray(layout.cards) && layout.cards.length > 0) {
            return layout.cards;
        }
        return null;
    },

    // Collect card order for grid mode (flat list of {app, instance} pairs)
    _collectGridOrder: function() {
        var grid = document.getElementById('app-stats-grid');
        if (!grid) return;
        var cards = grid.querySelectorAll('.app-stats-card[data-app][data-instance-name]');
        var cardOrder = [];
        cards.forEach(function(c) {
            cardOrder.push({
                app: c.getAttribute('data-app'),
                instance: c.getAttribute('data-instance-name')
            });
        });
        // Also build group order from the card order (for list mode)
        var seen = {};
        var groups = [];
        cardOrder.forEach(function(c) {
            if (!seen[c.app]) {
                seen[c.app] = true;
                groups.push(c.app);
            }
        });
        this._saveLayout({ groups: groups, cards: cardOrder });
    },

    // Collect group order for list mode
    _collectListOrder: function() {
        var grid = document.getElementById('app-stats-grid');
        if (!grid) return;
        var groupEls = grid.querySelectorAll('.app-group');
        var groups = [];
        groupEls.forEach(function(g) {
            var app = g.getAttribute('data-app');
            if (app) groups.push(app);
        });
        var layout = this._getLayout() || {};
        layout.groups = groups;
        this._saveLayout(layout);
    },

    // ─── View Mode ────────────────────────────────────────────────────
    _getViewMode: function() {
        var mode = HuntarrUtils.getUIPreference('dashboard-view-mode', 'list');
        if (mode === 'list' || mode === 'grid') return mode;
        return 'list';
    },

    _setViewMode: function(mode) {
        this._currentViewMode = mode;
        HuntarrUtils.setUIPreference('dashboard-view-mode', mode);
    },

    initViewToggle: function() {
        var self = this;
        var savedMode = this._getViewMode();
        var needsRerender = (this._lastRenderedMode && savedMode !== this._lastRenderedMode);
        this._currentViewMode = savedMode;

        var toggleGroup = document.getElementById('dashboard-view-toggle');
        if (!toggleGroup) return;

        // Remove old listeners by cloning
        var newToggle = toggleGroup.cloneNode(true);
        toggleGroup.parentNode.replaceChild(newToggle, toggleGroup);

        var btns = newToggle.querySelectorAll('.view-toggle-btn');
        btns.forEach(function(btn) {
            btn.classList.toggle('active', btn.getAttribute('data-view') === self._currentViewMode);
            btn.addEventListener('click', function() {
                var mode = this.getAttribute('data-view');
                if (mode === self._currentViewMode) return;
                btns.forEach(function(b) { b.classList.remove('active'); });
                this.classList.add('active');
                self._setViewMode(mode);
                self._clearDynamicContent();
                if (window.mediaStats) {
                    self.updateStatsDisplay(window.mediaStats);
                }
            });
        });

        // If the saved view mode differs from what was rendered, re-render now
        if (needsRerender && window.mediaStats) {
            this._clearDynamicContent();
            this.updateStatsDisplay(window.mediaStats);
        }
    },

    // Clear all dynamically generated content + sortable instances
    _clearDynamicContent: function() {
        // Destroy sortable instances
        if (this._sortableGrid) {
            this._sortableGrid.destroy();
            this._sortableGrid = null;
        }
        var grid = document.getElementById('app-stats-grid');
        if (!grid) return;
        // Remove all dynamic elements (app-group containers and direct app-stats-cards we created)
        var dynamicEls = grid.querySelectorAll('.app-group, .app-stats-card.dynamic-card');
        dynamicEls.forEach(function(el) { el.remove(); });
        this._lastRenderedMode = null;
    },

    // ─── Stats Loading ────────────────────────────────────────────────
    loadMediaStats: function(skipCache) {
        if (this.isLoadingStats) return;
        this.isLoadingStats = true;

        var self = this;

        if (!skipCache) {
            var cachedStats = localStorage.getItem('huntarr-stats-cache');
            if (cachedStats) {
                try {
                    var parsedStats = JSON.parse(cachedStats);
                    var cacheAge = Date.now() - (parsedStats.timestamp || 0);
                    // Use cache if less than 1 hour old for immediate UI
                    if (cacheAge < 3600000) {
                        this.updateStatsDisplay(parsedStats.stats, true);
                        // Show grid immediately from cache so it's not blank while checking connections
                        this.updateEmptyStateVisibility(true);
                    }
                } catch (e) {}
            }
        }

        var statsContainer = document.querySelector('.media-stats-container');
        if (statsContainer && !skipCache) {
            statsContainer.classList.add('stats-loading');
        }

        HuntarrUtils.fetchWithTimeout('./api/stats')
            .then(function(response) {
                if (!response.ok) throw new Error('Network response was not ok');
                return response.json();
            })
            .then(function(data) {
                if (data.success && data.stats) {
                    window.mediaStats = data.stats;
                    localStorage.setItem('huntarr-stats-cache', JSON.stringify({
                        stats: data.stats,
                        timestamp: Date.now()
                    }));
                    self.updateStatsDisplay(data.stats);
                    if (statsContainer) statsContainer.classList.remove('stats-loading');
                }
            })
            .catch(function(error) {
                console.error('Error fetching statistics:', error);
                if (statsContainer) statsContainer.classList.remove('stats-loading');
            })
            .finally(function() {
                self.isLoadingStats = false;
            });

        // Also fetch NZB Hunt home stats (separate from main stats pipeline)
        self._fetchNzbHuntHomeStats();
        self._checkNzbHuntWarning();
        self._initNzbHomePauseBtn();
    },

    // ─── Main Display Update ──────────────────────────────────────────
    updateStatsDisplay: function(stats, isFromCache) {
        // If mode changed, clear and rebuild
        if (this._lastRenderedMode && this._lastRenderedMode !== this._currentViewMode) {
            this._clearDynamicContent();
        }
        if (this._currentViewMode === 'list') {
            this._renderListView(stats, isFromCache);
        } else {
            this._renderGridView(stats, isFromCache);
        }
        this._lastRenderedMode = this._currentViewMode;
    },

    // ─── Grid View (Flat Cards with Drag Handles) ─────────────────────
    _renderGridView: function(stats, isFromCache) {
        var grid = document.getElementById('app-stats-grid');
        if (!grid) {
            grid = document.querySelector('.app-stats-grid');
            if (grid) grid.id = 'app-stats-grid';
            else return;
        }

        // Switch CSS class
        grid.classList.remove('app-stats-list');
        grid.classList.add('app-stats-grid');

        var self = this;
        var groupOrder = this._getGroupOrder();
        var savedCardOrder = this._getCardOrder();

        // Build a flat list of all cards to render: [{app, meta, inst}, ...]
        var allCards = [];
        groupOrder.forEach(function(app) {
            if (!stats[app]) return;
            var hasInstances = stats[app].instances && stats[app].instances.length > 0;
            var isConfigured = window.huntarrUI && window.huntarrUI.configuredApps && window.huntarrUI.configuredApps[app];
            if (!hasInstances && !stats[app].hunted && !stats[app].upgraded && !isConfigured) return;

            var meta = self.APP_META[app] || { label: app, icon: '', accent: '#94a3b8' };
            var instances = hasInstances ? stats[app].instances : [];

            if (instances.length === 0) {
                allCards.push({
                    app: app,
                    meta: meta,
                    inst: {
                        hunted: stats[app].hunted || 0,
                        upgraded: stats[app].upgraded || 0,
                        found: stats[app].found || 0,
                        found_upgrade: stats[app].found_upgrade || 0,
                        api_hits: 0, api_limit: 20,
                        instance_name: meta.label,
                        api_url: ''
                    }
                });
            } else {
                instances.forEach(function(inst) {
                    allCards.push({ app: app, meta: meta, inst: inst });
                });
            }
        });

        // Apply saved card order if available
        if (savedCardOrder && savedCardOrder.length > 0) {
            allCards.sort(function(a, b) {
                var keyA = a.app + '|' + (a.inst.instance_name || '');
                var keyB = b.app + '|' + (b.inst.instance_name || '');
                var idxA = -1, idxB = -1;
                for (var i = 0; i < savedCardOrder.length; i++) {
                    var sk = savedCardOrder[i].app + '|' + (savedCardOrder[i].instance || '');
                    if (sk === keyA) idxA = i;
                    if (sk === keyB) idxB = i;
                }
                if (idxA === -1) idxA = 9999;
                if (idxB === -1) idxB = 9999;
                return idxA - idxB;
            });
        }

        // Build/update cards in DOM
        var existingCards = grid.querySelectorAll('.app-stats-card.dynamic-card');
        var existingMap = {};
        existingCards.forEach(function(c) {
            var key = c.getAttribute('data-app') + '|' + c.getAttribute('data-instance-name');
            existingMap[key] = c;
        });

        allCards.forEach(function(entry, idx) {
            var key = entry.app + '|' + (entry.inst.instance_name || '');
            var card = existingMap[key];
            if (!card) {
                card = self._createCard(entry.app, entry.meta);
                card.classList.add('dynamic-card');
                card.setAttribute('data-app', entry.app);
                grid.appendChild(card);
            }
            self._updateCard(card, entry.app, entry.meta, entry.inst, isFromCache, entry.meta.label);
            // Ensure it's in the grid at the right position
            grid.appendChild(card);
            delete existingMap[key];
        });

        // Remove cards no longer in data
        Object.keys(existingMap).forEach(function(key) {
            existingMap[key].remove();
        });

        // Hide old static cards from template
        var oldCards = grid.querySelectorAll(':scope > .app-stats-card:not(.dynamic-card), :scope > .app-stats-card-wrapper, :scope > .app-group');
        oldCards.forEach(function(c) { c.style.display = 'none'; });

        // Initialize SortableJS for flat grid
        this._initGridSortable(grid);

        // Refresh cycle timers — timer elements are already baked into cards,
        // but CycleCountdown needs to know about them and populate data
        this._refreshCycleTimers();

        setTimeout(function() {
            if (typeof window.loadHourlyCapData === 'function') {
                window.loadHourlyCapData();
            }
        }, 200);
    },

    // ─── Create a Card Element (with drag handle + baked-in timer) ────
    _createCard: function(app, meta) {
        var card = document.createElement('div');
        card.className = 'app-stats-card ' + app;
        var cssClass = app.replace(/-/g, '');
        card.innerHTML =
            '<div class="card-drag-handle" title="Drag to reorder"><i class="fas fa-grip-vertical"></i></div>' +
            '<div class="status-container"><span class="status-badge"></span></div>' +
            '<div class="hourly-cap-container">' +
                '<div class="hourly-cap-status">' +
                    '<span class="hourly-cap-icon"></span>' +
                    '<span class="hourly-cap-text">API: <span>0</span> / <span>--</span></span>' +
                '</div>' +
                '<div class="api-progress-container">' +
                    '<div class="api-progress-bar"><div class="api-progress-fill" style="width: 0%;"></div></div>' +
                    '<div class="api-progress-text">API: <span>0</span> / <span>--</span></div>' +
                '</div>' +
            '</div>' +
            '<div class="app-content">' +
                '<div class="app-icon-wrapper"><img src="' + meta.icon + '" alt="" class="app-logo"></div>' +
                '<h4>' + meta.label + '</h4>' +
            '</div>' +
            '<div class="stats-numbers">' +
                '<div class="stat-box">' +
                    (app === 'movie_hunt' || app === 'tv_hunt'
                        ? '<span class="stat-number-found-wrap"><span class="stat-number stat-found">0</span> / <span class="stat-number">0</span></span>'
                        : '<span class="stat-number">0</span>') +
                    '<span class="stat-label">' + (app === 'movie_hunt' || app === 'tv_hunt' ? 'Found / Searched' : 'Searches Triggered') + '</span>' +
                '</div>' +
                '<div class="stat-box">' +
                    (app === 'movie_hunt' || app === 'tv_hunt'
                        ? '<span class="stat-number-found-wrap"><span class="stat-number stat-found">0</span> / <span class="stat-number">0</span></span>'
                        : '<span class="stat-number">0</span>') +
                    '<span class="stat-label">' + (app === 'movie_hunt' || app === 'tv_hunt' ? 'Found / Upgrades' : 'Upgrades Triggered') + '</span>' +
                '</div>' +
            '</div>' +
            '<div class="reset-button-container">' +
                '<div class="reset-and-timer-container">' +
                    '<button class="cycle-reset-button" data-app="' + app + '"><i class="fas fa-sync-alt"></i> Reset</button>' +
                    '<div class="cycle-timer inline-timer ' + cssClass + '" data-app-type="' + app + '">' +
                        '<i class="fas fa-clock ' + cssClass + '-icon"></i> <span class="timer-value">Loading...</span>' +
                    '</div>' +
                '</div>' +
            '</div>';
        return card;
    },

    // ─── Update a Card Element ────────────────────────────────────────
    _updateCard: function(card, app, meta, inst, isFromCache, appLabel) {
        var hunted = Math.max(0, parseInt(inst.hunted) || 0);
        var upgraded = Math.max(0, parseInt(inst.upgraded) || 0);
        var name = inst.instance_name || 'Default';
        var apiHits = Math.max(0, parseInt(inst.api_hits) || 0);
        var apiLimit = Math.max(1, parseInt(inst.api_limit) || 20);
        var apiUrl = (inst.api_url || '').trim();

        card.style.display = '';
        card.setAttribute('data-instance-name', name);
        card.setAttribute('data-app', app);

        // Title
        var h4 = card.querySelector('.app-content h4');
        if (h4) {
            var displayText = name !== appLabel ? appLabel + ' \u2013 ' + name : appLabel;
            if (apiUrl) {
                var link = h4.querySelector('.instance-name-link');
                if (!link) {
                    h4.textContent = '';
                    link = document.createElement('a');
                    link.className = 'instance-name-link';
                    link.target = '_blank';
                    link.rel = 'noopener noreferrer';
                    link.title = 'Open instance in new tab';
                    h4.appendChild(link);
                }
                link.href = apiUrl;
                link.textContent = displayText;
            } else {
                h4.textContent = displayText;
            }
        }

        // Stat numbers — Movie Hunt uses "found / searched" layout
        if (app === 'movie_hunt' || app === 'tv_hunt') {
            var found = Math.max(0, parseInt(inst.found) || 0);
            var foundUpgrade = Math.max(0, parseInt(inst.found_upgrade) || 0);
            var statBoxes = card.querySelectorAll('.stat-box');
            // First box: Found / Searched
            if (statBoxes[0]) {
                var nums0 = statBoxes[0].querySelectorAll('.stat-number');
                if (nums0[0]) { // found
                    if (isFromCache) nums0[0].textContent = this.formatLargeNumber(found);
                    else this.animateNumber(nums0[0], this.parseFormattedNumber(nums0[0].textContent || '0'), found);
                }
                if (nums0[1]) { // hunted
                    if (isFromCache) nums0[1].textContent = this.formatLargeNumber(hunted);
                    else this.animateNumber(nums0[1], this.parseFormattedNumber(nums0[1].textContent || '0'), hunted);
                }
            }
            // Second box: Found / Upgrades
            if (statBoxes[1]) {
                var nums1 = statBoxes[1].querySelectorAll('.stat-number');
                if (nums1[0]) { // found_upgrade
                    if (isFromCache) nums1[0].textContent = this.formatLargeNumber(foundUpgrade);
                    else this.animateNumber(nums1[0], this.parseFormattedNumber(nums1[0].textContent || '0'), foundUpgrade);
                }
                if (nums1[1]) { // upgraded
                    if (isFromCache) nums1[1].textContent = this.formatLargeNumber(upgraded);
                    else this.animateNumber(nums1[1], this.parseFormattedNumber(nums1[1].textContent || '0'), upgraded);
                }
            }
        } else {
            var numbers = card.querySelectorAll('.stat-number');
            if (numbers[0]) {
                if (isFromCache) numbers[0].textContent = this.formatLargeNumber(hunted);
                else this.animateNumber(numbers[0], this.parseFormattedNumber(numbers[0].textContent || '0'), hunted);
            }
            if (numbers[1]) {
                if (isFromCache) numbers[1].textContent = this.formatLargeNumber(upgraded);
                else this.animateNumber(numbers[1], this.parseFormattedNumber(numbers[1].textContent || '0'), upgraded);
            }
        }

        // Reset button instance name
        var resetBtn = card.querySelector('.cycle-reset-button[data-app]');
        if (resetBtn) resetBtn.setAttribute('data-instance-name', name);

        // API progress
        var pct = apiLimit > 0 ? (apiHits / apiLimit) * 100 : 0;
        var capSpans = card.querySelectorAll('.hourly-cap-text span');
        if (capSpans.length >= 2) { capSpans[0].textContent = apiHits; capSpans[1].textContent = apiLimit; }
        var statusEl = card.querySelector('.hourly-cap-status');
        if (statusEl) {
            statusEl.classList.remove('good', 'warning', 'danger');
            if (pct >= 100) statusEl.classList.add('danger');
            else if (pct >= 75) statusEl.classList.add('warning');
            else statusEl.classList.add('good');
        }
        var progressFill = card.querySelector('.api-progress-fill');
        if (progressFill) progressFill.style.width = Math.min(100, pct) + '%';
        var progressSpans = card.querySelectorAll('.api-progress-text span');
        if (progressSpans.length >= 2) { progressSpans[0].textContent = apiHits; progressSpans[1].textContent = apiLimit; }

        // State Management reset countdown
        var hoursUntil = inst.state_reset_hours_until;
        var stateEnabled = inst.state_reset_enabled !== false;
        var resetCountdownEl = card.querySelector('.state-reset-countdown');
        var resetContainer = card.querySelector('.reset-button-container');
        if (resetContainer) {
            if (!resetCountdownEl) {
                resetCountdownEl = document.createElement('div');
                resetCountdownEl.className = 'state-reset-countdown';
                resetContainer.appendChild(resetCountdownEl);
            }
            if (!stateEnabled) {
                resetCountdownEl.innerHTML = '<i class="fas fa-hourglass-half"></i> <span class="custom-tooltip">State Management Reset</span> Disabled';
                resetCountdownEl.style.display = '';
            } else if (hoursUntil != null && typeof hoursUntil === 'number' && hoursUntil > 0) {
                var h = Math.floor(hoursUntil);
                var label = h >= 1 ? '' + h : '<1';
                resetCountdownEl.innerHTML = '<i class="fas fa-hourglass-half"></i> <span class="custom-tooltip">State Management Reset</span> ' + label;
                resetCountdownEl.style.display = '';
            } else {
                resetCountdownEl.style.display = 'none';
            }
        }
    },

    // ─── List View (Compact Table — grouped) ──────────────────────────
    _renderListView: function(stats, isFromCache) {
        var grid = document.getElementById('app-stats-grid');
        if (!grid) {
            grid = document.querySelector('.app-stats-grid');
            if (grid) grid.id = 'app-stats-grid';
            else return;
        }

        grid.classList.remove('app-stats-grid');
        grid.classList.add('app-stats-list');

        var self = this;
        var groupOrder = this._getGroupOrder();
        var visibleApps = [];

        groupOrder.forEach(function(app) {
            if (stats[app] && (stats[app].instances && stats[app].instances.length > 0 ||
                stats[app].hunted > 0 || stats[app].upgraded > 0)) {
                visibleApps.push(app);
            } else if (stats[app] && window.huntarrUI && window.huntarrUI.configuredApps && window.huntarrUI.configuredApps[app]) {
                visibleApps.push(app);
            }
        });

        visibleApps.forEach(function(app) {
            var meta = self.APP_META[app] || { label: app, icon: '', accent: '#94a3b8' };
            var group = grid.querySelector('.app-group[data-app="' + app + '"]');

            if (!group) {
                group = document.createElement('div');
                group.className = 'app-group';
                group.setAttribute('data-app', app);
                grid.appendChild(group);
            }

            var instances = (stats[app] && stats[app].instances) || [];
            if (instances.length === 0) {
                instances = [{
                    instance_name: meta.label,
                    hunted: (stats[app] && stats[app].hunted) || 0,
                    upgraded: (stats[app] && stats[app].upgraded) || 0,
                    found: (stats[app] && stats[app].found) || 0,
                    found_upgrade: (stats[app] && stats[app].found_upgrade) || 0,
                    api_hits: 0, api_limit: 20, api_url: ''
                }];
            }

            var html =
                '<div class="app-group-header list-header">' +
                    '<i class="fas fa-grip-vertical drag-handle group-drag-handle"></i>' +
                    '<img src="' + meta.icon + '" class="app-group-logo" alt="">' +
                    '<span class="app-group-label">' + meta.label + '</span>' +
                '</div>' +
                '<table class="app-list-table">' +
                    '<colgroup>' +
                        '<col class="col-instance">' +
                        '<col class="col-searches">' +
                        '<col class="col-upgrades">' +
                        '<col class="col-api-status">' +
                        '<col class="col-actions">' +
                    '</colgroup>' +
                    '<thead><tr>' +
                        '<th>Instance</th>' +
                        '<th class="col-searches" data-abbr="' + (app === 'movie_hunt' || app === 'tv_hunt' ? 'F/Srch' : 'Searches') + '">' + (app === 'movie_hunt' || app === 'tv_hunt' ? 'Found / Searches' : 'Searches') + '</th>' +
                        '<th class="col-upgrades" data-abbr="' + (app === 'movie_hunt' || app === 'tv_hunt' ? 'F/Upg' : 'Upgrades') + '">' + (app === 'movie_hunt' || app === 'tv_hunt' ? 'Found / Upgrades' : 'Upgrades') + '</th>' +
                        '<th>API / Status</th>' +
                        '<th></th>' +
                    '</tr></thead><tbody>';

            var cssClass = app.replace(/-/g, '');
            instances.forEach(function(inst) {
                var hunted = Math.max(0, parseInt(inst.hunted) || 0);
                var upgraded = Math.max(0, parseInt(inst.upgraded) || 0);
                var found = Math.max(0, parseInt(inst.found) || 0);
                var foundUpgrade = Math.max(0, parseInt(inst.found_upgrade) || 0);
                var apiHits = Math.max(0, parseInt(inst.api_hits) || 0);
                var apiLimit = Math.max(1, parseInt(inst.api_limit) || 20);
                var pct = apiLimit > 0 ? Math.min(100, (apiHits / apiLimit) * 100) : 0;
                var name = inst.instance_name || 'Default';

                // Movie Hunt shows "found / searched" and "found / upgrades"
                var searchesCell = (app === 'movie_hunt' || app === 'tv_hunt')
                    ? '<span class="found-ratio"><span class="found-num">' + self.formatLargeNumber(found) + '</span> / ' + self.formatLargeNumber(hunted) + '</span>'
                    : self.formatLargeNumber(hunted);
                var upgradesCell = (app === 'movie_hunt' || app === 'tv_hunt')
                    ? '<span class="found-ratio"><span class="found-num">' + self.formatLargeNumber(foundUpgrade) + '</span> / ' + self.formatLargeNumber(upgraded) + '</span>'
                    : self.formatLargeNumber(upgraded);

                html +=
                    '<tr data-instance-name="' + name + '">' +
                        '<td class="list-instance-name">' + name + '</td>' +
                        '<td class="list-stat ' + app + '">' + searchesCell + '</td>' +
                        '<td class="list-stat ' + app + '">' + upgradesCell + '</td>' +
                        '<td class="list-api-status">' +
                            '<div class="list-api-row">' +
                                '<div class="list-api-bar"><div class="list-api-fill ' + app + '" style="width:' + pct + '%;"></div></div>' +
                                '<span class="list-api-text">' + apiHits + '/' + apiLimit + '</span>' +
                            '</div>' +
                            '<div class="list-status-row">' +
                                '<div class="cycle-timer inline-timer ' + cssClass + '" data-app-type="' + app + '">' +
                                    '<i class="fas fa-clock ' + cssClass + '-icon"></i> <span class="timer-value">Loading...</span>' +
                                '</div>' +
                            '</div>' +
                        '</td>' +
                        '<td class="list-actions">' +
                            '<button class="cycle-reset-button" data-app="' + app + '" data-instance-name="' + name + '" title="Reset Cycle"><i class="fas fa-sync-alt"></i></button>' +
                        '</td>' +
                    '</tr>';
            });

            html += '</tbody></table>';
            group.innerHTML = html;
            group.style.display = '';
        });

        // Hide groups for non-visible apps
        grid.querySelectorAll('.app-group').forEach(function(g) {
            if (visibleApps.indexOf(g.getAttribute('data-app')) === -1) {
                g.style.display = 'none';
            }
        });

        // Reorder groups
        var currentGroups = Array.from(grid.querySelectorAll('.app-group'));
        var sorted = currentGroups.slice().sort(function(a, b) {
            var ia = groupOrder.indexOf(a.getAttribute('data-app'));
            var ib = groupOrder.indexOf(b.getAttribute('data-app'));
            if (ia === -1) ia = 9999;
            if (ib === -1) ib = 9999;
            return ia - ib;
        });
        sorted.forEach(function(g) { grid.appendChild(g); });

        this._initListSortable(grid);

        // Hide old static cards & dynamic grid cards
        var oldCards = grid.querySelectorAll(':scope > .app-stats-card, :scope > .app-stats-card-wrapper');
        oldCards.forEach(function(c) { c.style.display = 'none'; });

        // Refresh cycle timers — timer elements are baked into each <tr>
        this._refreshCycleTimers();
    },

    // ─── Refresh Cycle Timers after view render ──────────────────────
    _refreshCycleTimers: function() {
        if (typeof window.CycleCountdown === 'undefined') return;
        // Let CycleCountdown discover any new timer elements it doesn't know about
        if (window.CycleCountdown.refreshTimerElements) {
            window.CycleCountdown.refreshTimerElements();
        }
        // Force an immediate data fetch + display update so timers show current state
        if (window.CycleCountdown.refreshAllData) {
            window.CycleCountdown.refreshAllData();
        }
    },

    // ─── SortableJS for Grid (flat cards) ─────────────────────────────
    _sortableGrid: null,

    _initGridSortable: function(grid) {
        if (typeof Sortable === 'undefined') return;
        var self = this;

        if (this._sortableGrid) {
            this._sortableGrid.destroy();
            this._sortableGrid = null;
        }

        this._sortableGrid = Sortable.create(grid, {
            animation: 200,
            handle: '.card-drag-handle',
            draggable: '.app-stats-card.dynamic-card',
            ghostClass: 'sortable-ghost',
            chosenClass: 'sortable-chosen',
            filter: '.app-stats-card:not(.dynamic-card), .app-stats-card-wrapper, .app-group',
            onEnd: function() {
                self._collectGridOrder();
            }
        });
    },

    // ─── SortableJS for List (group-level drag) ───────────────────────
    _initListSortable: function(grid) {
        if (typeof Sortable === 'undefined') return;
        var self = this;

        if (this._sortableGrid) {
            this._sortableGrid.destroy();
            this._sortableGrid = null;
        }

        this._sortableGrid = Sortable.create(grid, {
            animation: 200,
            handle: '.group-drag-handle',
            draggable: '.app-group',
            ghostClass: 'sortable-ghost',
            chosenClass: 'sortable-chosen',
            onEnd: function() {
                self._collectListOrder();
            }
        });
    },

    // ─── Number Formatting / Animation ────────────────────────────────
    parseFormattedNumber: function(formattedStr) {
        if (!formattedStr || typeof formattedStr !== 'string') return 0;
        var cleanStr = formattedStr.replace(/[^\d.-]/g, '');
        var parsed = parseInt(cleanStr);
        if (formattedStr.indexOf('K') !== -1) return Math.floor(parsed * 1000);
        if (formattedStr.indexOf('M') !== -1) return Math.floor(parsed * 1000000);
        return isNaN(parsed) ? 0 : Math.max(0, parsed);
    },

    animateNumber: function(element, start, end) {
        start = Math.max(0, parseInt(start) || 0);
        end = Math.max(0, parseInt(end) || 0);
        if (start === end) { element.textContent = this.formatLargeNumber(end); return; }
        var self = this;
        var duration = 600;
        var startTime = performance.now();
        var updateNumber = function(currentTime) {
            var elapsed = currentTime - startTime;
            var progress = Math.min(elapsed / duration, 1);
            var easeOutQuad = progress * (2 - progress);
            var currentValue = Math.max(0, Math.floor(start + (end - start) * easeOutQuad));
            element.textContent = self.formatLargeNumber(currentValue);
            if (progress < 1) {
                element.animationFrame = requestAnimationFrame(updateNumber);
            } else {
                element.textContent = self.formatLargeNumber(end);
                element.animationFrame = null;
            }
        };
        element.animationFrame = requestAnimationFrame(updateNumber);
    },

    formatLargeNumber: function(num) {
        if (num < 1000) return num.toString();
        else if (num < 10000) return (num / 1000).toFixed(1) + 'K';
        else if (num < 100000) return (num / 1000).toFixed(1) + 'K';
        else if (num < 1000000) return Math.floor(num / 1000) + 'K';
        else if (num < 10000000) return (num / 1000000).toFixed(1) + 'M';
        else if (num < 100000000) return (num / 1000000).toFixed(1) + 'M';
        else if (num < 1000000000) return Math.floor(num / 1000000) + 'M';
        else if (num < 10000000000) return (num / 1000000000).toFixed(1) + 'B';
        else if (num < 100000000000) return (num / 1000000000).toFixed(1) + 'B';
        else if (num < 1000000000000) return Math.floor(num / 1000000000) + 'B';
        else return (num / 1000000000000).toFixed(1) + 'T';
    },

    // ─── Stats Reset ──────────────────────────────────────────────────
    resetMediaStats: function(appType) {
        var confirmMessage = appType
            ? 'Are you sure you want to reset all ' + (appType.charAt(0).toUpperCase() + appType.slice(1)) + ' statistics? This will clear all tracked hunted and upgraded items.'
            : 'Are you sure you want to reset ALL statistics for ALL apps? This cannot be undone.';
        var self = this;
        var doReset = function() {
            var endpoint = './api/stats/reset';
            var body = appType ? JSON.stringify({ app_type: appType }) : '{}';
            HuntarrUtils.fetchWithTimeout(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: body
            })
            .then(function(response) { return response.json().then(function(data) { return { ok: response.ok, data: data }; }); })
            .then(function(result) {
                if (result.ok && result.data && result.data.success) {
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        var msg = appType
                            ? (appType.charAt(0).toUpperCase() + appType.slice(1)) + ' statistics reset successfully'
                            : 'All statistics reset successfully';
                        window.huntarrUI.showNotification(msg, 'success');
                    }
                    self.loadMediaStats(true);
                } else {
                    var errMsg = (result.data && result.data.error) ? result.data.error : 'Failed to reset statistics';
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification(errMsg, 'error');
                    }
                }
            })
            .catch(function(error) {
                console.error('Error resetting statistics:', error);
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('Error resetting statistics', 'error');
                }
            });
        };
        if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
            window.HuntarrConfirm.show({ title: 'Reset Statistics', message: confirmMessage, confirmLabel: 'Reset', onConfirm: doReset });
        } else {
            if (!confirm(confirmMessage)) return;
            doReset();
        }
    },

    // ─── Dashboard Layout Reset ───────────────────────────────────────
    resetDashboardLayout: function() {
        HuntarrUtils.setUIPreference('dashboard-layout', null);
        HuntarrUtils.setUIPreference('dashboard-view-mode', 'list');
        this._currentViewMode = 'list';
        this._clearDynamicContent();
        // Reset toggle
        var toggleGroup = document.getElementById('dashboard-view-toggle');
        if (toggleGroup) {
            toggleGroup.querySelectorAll('.view-toggle-btn').forEach(function(b) {
                b.classList.toggle('active', b.getAttribute('data-view') === 'grid');
            });
        }
        if (window.mediaStats) this.updateStatsDisplay(window.mediaStats);
        if (window.huntarrUI && window.huntarrUI.showNotification) {
            window.huntarrUI.showNotification('Dashboard layout reset to defaults', 'success');
        }
    },

    // ─── App Connection Checks ────────────────────────────────────────
    checkAppConnections: function() {
        if (!window.huntarrUI) return;
        var self = this;
        var apps = ['movie_hunt', 'tv_hunt', 'sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros'];
        var checkPromises = apps.map(function(app) { return self.checkAppConnection(app); });
        Promise.all(checkPromises)
            .then(function() {
                window.huntarrUI.configuredAppsInitialized = true;
                self.updateEmptyStateVisibility();
            })
            .catch(function() {
                window.huntarrUI.configuredAppsInitialized = true;
                self.updateEmptyStateVisibility();
            });
    },

    checkAppConnection: function(app) {
        var self = this;
        return HuntarrUtils.fetchWithTimeout('./api/status/' + app)
            .then(function(response) { return response.json(); })
            .then(function(data) {
                self.updateConnectionStatus(app, data);
                var isConfigured = data.configured === true;
                if (['movie_hunt', 'tv_hunt', 'sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros', 'swaparr'].indexOf(app) !== -1) {
                    isConfigured = (data.total_configured || 0) > 0;
                }
                if (window.huntarrUI) window.huntarrUI.configuredApps[app] = isConfigured;
            })
            .catch(function(error) {
                console.error('Error checking ' + app + ' connection:', error);
                self.updateConnectionStatus(app, { configured: false, connected: false });
                if (window.huntarrUI) window.huntarrUI.configuredApps[app] = false;
            });
    },

    updateConnectionStatus: function(app, statusData) {
        if (!window.huntarrUI) return;
        var statusElement = (window.huntarrUI.elements && window.huntarrUI.elements[app + 'HomeStatus']) || null;
        if (!statusElement) {
            var card = document.querySelector('.app-stats-card[data-app="' + app + '"]');
            statusElement = card ? card.querySelector('.status-container .status-badge') : null;
        }
        if (!statusElement) return;

        var isConfigured = statusData && statusData.configured === true;
        var isConnected = statusData && statusData.connected === true;
        var connectedCount = (statusData && statusData.connected_count) || 0;
        var totalConfigured = (statusData && statusData.total_configured) || 0;

        if (['movie_hunt', 'tv_hunt', 'sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros', 'swaparr'].indexOf(app) !== -1) {
            isConfigured = totalConfigured > 0;
            isConnected = isConfigured && connectedCount > 0;
        }

        var card = statusElement.closest('.app-stats-card');
        var statusContainer = statusElement.closest('.status-container');
        var wrapper = card ? card.closest('.app-stats-card-wrapper') : null;
        var container = wrapper || card;
        if (isConfigured) {
            if (container) container.style.display = '';
            if (wrapper) wrapper.querySelectorAll('.app-stats-card').forEach(function(c) { c.style.display = ''; });
            if (statusContainer) statusContainer.style.display = '';
        } else {
            if (container) container.style.display = 'none';
            if (card) card.style.display = 'none';
            statusElement.className = 'status-badge not-configured';
            statusElement.innerHTML = '<i class="fas fa-times-circle"></i> Not Configured';
            return;
        }

        if (['movie_hunt', 'tv_hunt', 'sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros', 'swaparr'].indexOf(app) !== -1) {
            statusElement.innerHTML = '<i class="fas fa-plug"></i> Connected ' + connectedCount + '/' + totalConfigured;
            statusElement.className = 'status-badge ' + (isConnected ? 'connected' : 'error');
        } else {
            if (isConnected) {
                statusElement.className = 'status-badge connected';
                statusElement.innerHTML = '<i class="fas fa-check-circle"></i> Connected';
            } else {
                statusElement.className = 'status-badge not-connected';
                statusElement.innerHTML = '<i class="fas fa-times-circle"></i> Not Connected';
            }
        }
    },

    // ─── NZB Hunt Home Status Bar ──────────────────────────────────
    _nzbHomePollTimer: null,

    _checkNzbHuntWarning: function() {
        var banner = document.getElementById('nzb-hunt-home-warning');
        if (!banner) return;
        // Banner is visible by default in HTML; only hide when API confirms servers exist
        fetch('./api/nzb-hunt/home-stats?t=' + Date.now())
            .then(function(r) { return r.json(); })
            .then(function(data) {
                banner.style.display = (data.show_nzb_warning === true || data.has_servers !== true) ? 'flex' : 'none';
            })
            .catch(function() {
                /* keep visible on error - user has no servers until we know otherwise */
            });
        // Retry after 1.5s in case API was not ready
        setTimeout(function() {
            if (!banner) return;
            fetch('./api/nzb-hunt/home-stats?t=' + Date.now())
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    banner.style.display = (data.show_nzb_warning === true || data.has_servers !== true) ? 'flex' : 'none';
                })
                .catch(function() {});
        }, 1500);
    },

    _fetchNzbHuntHomeStats: function() {
        var card = document.getElementById('nzb-hunt-home-card');
        if (!card) return;
        var self = this;

        // First check visibility setting
        fetch('./api/nzb-hunt/home-stats?t=' + Date.now())
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (!data.visible) {
                    card.style.display = 'none';
                    self._stopNzbHomePoll();
                    return;
                }
                card.style.display = '';
                // Fetch full status for the status bar
                self._fetchNzbHuntStatus();
                // Start polling if not already
                self._startNzbHomePoll();
            })
            .catch(function() {
                if (card) card.style.display = 'none';
            });
    },

    _fetchNzbHuntStatus: function() {
        var card = document.getElementById('nzb-hunt-home-card');
        if (!card || card.style.display === 'none') return;

        fetch('./api/nzb-hunt/status?t=' + Date.now())
            .then(function(r) { return r.json(); })
            .then(function(status) {
                // Connections
                var connEl = document.getElementById('nzb-home-connections');
                if (connEl) {
                    var connStats = status.connection_stats || [];
                    var totalActive = connStats.reduce(function(s, c) { return s + (c.active || 0); }, 0);
                    var totalMax = connStats.reduce(function(s, c) { return s + (c.max || 0); }, 0);
                    connEl.textContent = totalMax > 0 ? totalActive + ' / ' + totalMax : String(totalActive);
                }
                // Speed
                var speedEl = document.getElementById('nzb-home-speed');
                if (speedEl) speedEl.textContent = status.speed_human || '0 B/s';
                // ETA
                var etaEl = document.getElementById('nzb-home-eta');
                if (etaEl) etaEl.textContent = status.eta_human || '--';
                // Remaining
                var remainEl = document.getElementById('nzb-home-remaining');
                if (remainEl) remainEl.textContent = status.remaining_human || '0 B';
                // Space
                var spaceEl = document.getElementById('nzb-home-space');
                if (spaceEl) spaceEl.textContent = status.free_space_human || '--';
                // Pause button state
                var pauseBtn = document.getElementById('nzb-home-pause-btn');
                if (pauseBtn && status.paused_global !== undefined) {
                    var icon = pauseBtn.querySelector('i');
                    if (icon) icon.className = status.paused_global ? 'fas fa-play' : 'fas fa-pause';
                    pauseBtn.title = status.paused_global ? 'Resume all downloads' : 'Pause all downloads';
                }
            })
            .catch(function(err) {
                console.error('[HuntarrStats] NZB Hunt status fetch error:', err);
            });
    },

    _startNzbHomePoll: function() {
        if (this._nzbHomePollTimer) return; // already polling
        var self = this;
        // Poll every 3 seconds (same as NZB Home default)
        this._nzbHomePollTimer = setInterval(function() {
            self._fetchNzbHuntStatus();
        }, 3000);
    },

    _stopNzbHomePoll: function() {
        if (this._nzbHomePollTimer) {
            clearInterval(this._nzbHomePollTimer);
            this._nzbHomePollTimer = null;
        }
    },

    _initNzbHomePauseBtn: function() {
        var btn = document.getElementById('nzb-home-pause-btn');
        if (!btn || btn._nzbBound) return;
        btn._nzbBound = true;
        btn.addEventListener('click', function() {
            var icon = btn.querySelector('i');
            var isPaused = icon && icon.classList.contains('fa-play');
            var endpoint = isPaused ? './api/nzb-hunt/resume' : './api/nzb-hunt/pause';
            fetch(endpoint, { method: 'POST' })
                .then(function(r) { return r.json(); })
                .then(function() {
                    // Flip the icon immediately for responsiveness
                    if (icon) {
                        icon.className = isPaused ? 'fas fa-pause' : 'fas fa-play';
                        btn.title = isPaused ? 'Pause all downloads' : 'Resume all downloads';
                    }
                })
                .catch(function() {});
        });
    },

    updateEmptyStateVisibility: function(forceShowGrid) {
        if (!window.huntarrUI) return;
        
        // If we don't have a final answer on configuration yet and aren't forcing the grid, stay quiet
        if (!window.huntarrUI.configuredAppsInitialized && !forceShowGrid) return;
        
        var anyConfigured = Object.values(window.huntarrUI.configuredApps).some(function(v) { return v === true; });
        
        // If we are forcing the grid (from cache), we assume there's something to show
        if (forceShowGrid) anyConfigured = true;
        
        var emptyState = document.getElementById('live-hunts-empty-state');
        var statsGrid = document.getElementById('app-stats-grid') || document.querySelector('.app-stats-grid');
        
        if (anyConfigured) {
            if (emptyState) emptyState.style.display = 'none';
            if (statsGrid) statsGrid.style.display = '';
        } else {
            // Only show empty state if we're CERTAIN nothing is configured
            if (window.huntarrUI.configuredAppsInitialized) {
                if (emptyState) emptyState.style.display = 'flex';
                if (statsGrid) statsGrid.style.display = 'none';
            }
        }
    }
};


/* === modules/ui/api-progress.js === */
/**
 * API Progress Bar Enhancement
 * Connects to the existing hourly-cap system to show real API usage data
 */

function updateApiProgressForCard(card, used, total) {
    const safeTotal = total > 0 ? total : 20;
    const percentage = (used / safeTotal) * 100;
    let gradient;
    if (percentage <= 35) gradient = '#22c55e';
    else if (percentage <= 50) gradient = `linear-gradient(90deg, #22c55e 0%, #22c55e ${35 * 100 / percentage}%, #f59e0b 100%)`;
    else if (percentage <= 70) gradient = `linear-gradient(90deg, #22c55e 0%, #22c55e ${35 * 100 / percentage}%, #f59e0b ${50 * 100 / percentage}%, #ea580c 100%)`;
    else gradient = `linear-gradient(90deg, #22c55e 0%, #22c55e ${35 * 100 / percentage}%, #f59e0b ${50 * 100 / percentage}%, #ea580c ${70 * 100 / percentage}%, #ef4444 100%)`;
    const progressFill = card.querySelector('.api-progress-fill');
    const spans = card.querySelectorAll('.api-progress-text span');
    const usedSpan = spans[0];
    const totalSpan = spans[1];
    if (progressFill && usedSpan && totalSpan) {
        progressFill.style.width = `${percentage}%`;
        progressFill.style.background = gradient;
        usedSpan.textContent = used;
        totalSpan.textContent = safeTotal;
    }
}

function updateApiProgress(appName, used, total) {
    const cards = document.querySelectorAll('.app-stats-card.' + appName);
    cards.forEach(card => updateApiProgressForCard(card, used, total));
}

function syncProgressBarsWithApiCounts() {
    const apps = ['sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros'];
    apps.forEach(app => {
        const cards = document.querySelectorAll('.app-stats-card.' + app);
        cards.forEach(card => {
            const countEl = card.querySelector('.hourly-cap-text span');
            const limitEl = card.querySelectorAll('.hourly-cap-text span')[1];
            if (countEl && limitEl) {
                const used = parseInt(countEl.textContent, 10) || 0;
                const total = parseInt(limitEl.textContent, 10) || 20;
                updateApiProgressForCard(card, used, total);
            }
        });
    });
}

// Initialize when page loads
document.addEventListener('DOMContentLoaded', function() {
    // Initial sync with existing API count data
    syncProgressBarsWithApiCounts();
    
    // Watch each card's count/limit (hourly-cap.js updates them); sync that card's bar when changed
    const apps = ['sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros'];
    apps.forEach(app => {
        document.querySelectorAll('.app-stats-card.' + app).forEach(card => {
            const countEl = card.querySelector('.hourly-cap-text span');
            const limitEl = card.querySelectorAll('.hourly-cap-text span')[1];
            if (!countEl || !limitEl) return;
            const sync = () => {
                const used = parseInt(countEl.textContent, 10) || 0;
                const total = parseInt(limitEl.textContent, 10) || 20;
                updateApiProgressForCard(card, used, total);
            };
            const obs = new MutationObserver(sync);
            obs.observe(countEl, { childList: true, characterData: true, subtree: true });
            obs.observe(limitEl, { childList: true, characterData: true, subtree: true });
        });
    });
    
    // Also sync every 2 minutes (same as hourly-cap.js polling)
    setInterval(syncProgressBarsWithApiCounts, 120000);
});

// Export function for external use
window.updateApiProgress = updateApiProgress;
window.syncProgressBarsWithApiCounts = syncProgressBarsWithApiCounts;

/* === modules/ui/cycle-countdown.js === */
/**
 * Cycle Countdown Timer
 * Shows countdown timers for each app's next cycle
 */

window.CycleCountdown = (function() {
    // Cache for next cycle timestamps
    const nextCycleTimes = {};
    // Active timer intervals
    const timerIntervals = {};
    // Track apps that are currently running cycles
    const runningCycles = {};
    // Track instances that have a pending reset (show "Pending Reset" until cycle ends and sleep starts)
    const pendingResets = {};
    // Per-instance cycle activity (e.g. "Season Search (360/600)" or "Processing missing") when running
    const cycleActivities = {};
    // List of apps to track (movie_hunt, tv_hunt first so they appear first when configured)
    const trackedApps = ['movie_hunt', 'tv_hunt', 'sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'whisparr-v3', 'eros', 'swaparr'];
    
    function getBaseUrl() {
        return (window.HUNTARR_BASE_URL || '');
    }

    function buildUrl(path) {
        const base = getBaseUrl();
        path = path.replace(/^\.\//, '');
        if (!path.startsWith('/')) {
            path = '/' + path;
        }
        return base + path;
    }
    
    // Set up timer elements in the DOM
    function setupTimerElements() {
        // Create timer elements in each app status card
        trackedApps.forEach(app => {
            createTimerElement(app);
        });
    }
    
    // Initialize countdown timers for all apps
    function initialize() {
        // Clear any existing running cycle and pending reset states
        Object.keys(runningCycles).forEach(app => {
            runningCycles[app] = false;
        });
        Object.keys(pendingResets).forEach(k => { delete pendingResets[k]; });
        
        // Get references to all HTML elements
        setupTimerElements();
        
        // Set up event listeners for reset buttons
        setupResetButtonListeners();
        
        // First try to fetch from API
        fetchAllCycleData()
            .then((data) => {
                // Success - data is processed in fetchAllCycleData
            })
            .catch((error) => {
                console.warn('[CycleCountdown] Initial data fetch failed:', error.message);
                // Show waiting message in the UI if initial load fails
                displayWaitingForCycle();
            });
        
        function startRefreshInterval() {
            // Clear any existing interval
            if (dataRefreshIntervalId) {
                clearInterval(dataRefreshIntervalId);
                dataRefreshIntervalId = null;
            }
            
            // Set up API sync every 15 seconds so countdown appears soon after cycle ends (when backend sets next_cycle)
            dataRefreshIntervalId = setInterval(() => {
                // Only refresh if not already fetching
                if (!isFetchingData) {
                    fetchAllCycleData()
                        .then(() => {})
                        .catch(() => {});
                }
            }, 15000); // API sync every 15 seconds so "Starting Cycle" updates to countdown soon after sleep starts
            
        }
        
        // Start the refresh cycle
        startRefreshInterval();
    }
    
    // Simple lock to prevent concurrent fetches
    let isFetchingData = false;
    // 15-second API refresh interval (stored so cleanup can clear it)
    let dataRefreshIntervalId = null;
    // Poll when "Starting Cycle" is shown so countdown appears soon after sleep starts
    let startingCyclePollTimeout = null;
    let startingCyclePollAttempts = 0;
    const STARTING_CYCLE_POLL_INTERVAL_MS = 2000;
    const STARTING_CYCLE_POLL_MAX_ATTEMPTS = 15; // 2s * 15 = 30s max

    function startStartingCyclePolling() {
        if (startingCyclePollTimeout) return; // already polling
        startingCyclePollAttempts = 0;
        function poll() {
            startingCyclePollAttempts++;
            if (startingCyclePollAttempts > STARTING_CYCLE_POLL_MAX_ATTEMPTS) {
                startingCyclePollTimeout = null;
                return;
            }
            if (isFetchingData) {
                startingCyclePollTimeout = safeSetTimeout(poll, STARTING_CYCLE_POLL_INTERVAL_MS);
                return;
            }
            fetchAllCycleData()
                .then((data) => {
                    const stillStarting = data && Object.keys(data).some(app => {
                        const appData = data[app];
                        if (!appData) return false;
                        if (appData.instances) {
                            return Object.keys(appData.instances).some(instName => {
                                const inst = appData.instances[instName];
                                return inst && !inst.next_cycle && !inst.cyclelock;
                            });
                        }
                        return (appData.next_cycle == null && !appData.cyclelock);
                    });
                    if (stillStarting && startingCyclePollAttempts < STARTING_CYCLE_POLL_MAX_ATTEMPTS) {
                        startingCyclePollTimeout = safeSetTimeout(poll, STARTING_CYCLE_POLL_INTERVAL_MS);
                    } else {
                        startingCyclePollTimeout = null;
                    }
                })
                .catch(() => {
                    startingCyclePollTimeout = safeSetTimeout(poll, STARTING_CYCLE_POLL_INTERVAL_MS);
                });
        }
        startingCyclePollTimeout = safeSetTimeout(poll, STARTING_CYCLE_POLL_INTERVAL_MS);
    }

    // Track active reset polling intervals so we don't stack them
    const activeResetPolls = {};

    // Set up reset button click listeners (event delegation for dynamically cloned cards)
    function setupResetButtonListeners() {
        // Use event delegation on document so cloned per-instance cards also get handled
        document.addEventListener('click', function(e) {
            const button = e.target.matches('.cycle-reset-button') ? e.target : e.target.closest('.cycle-reset-button');
            if (!button) return;
            
            const app = button.getAttribute('data-app');
            const instanceName = button.getAttribute('data-instance-name') || null;
            if (app) {
                const key = stateKey(app, instanceName);
                // Set pending reset locally for instant UI feedback
                pendingResets[key] = true;
                
                // Update timer display immediately — shows "Pending Reset" (orange)
                updateTimerDisplay(app);
                
                // Fetch latest data after a short delay so API has recorded the reset
                setTimeout(function() {
                    fetchAllCycleData().catch(function() {});
                }, 500);
                
                // Start faster polling until reset is complete
                startResetPolling(app, instanceName);
            }
        });
    }
    
    // Poll more frequently after a reset until new data is available
    function startResetPolling(app, instanceName) {
        const key = stateKey(app, instanceName);
        
        // Clear any existing polling for this key
        if (activeResetPolls[key]) {
            clearInterval(activeResetPolls[key]);
            delete activeResetPolls[key];
        }
        
        let pollAttempts = 0;
        const maxPollAttempts = 90; // Poll for up to 3 minutes (90 * 2 seconds)
        
        const pollInterval = setInterval(() => {
            pollAttempts++;
            
            fetchAllCycleData()
                .then(() => {
                    // Reset is complete when backend says pending_reset is false
                    // and we have a new countdown time (cycle restarted and is sleeping)
                    const resetDone = !pendingResets[key];
                    const hasCountdown = !!nextCycleTimes[key];
                    const isRunning = !!runningCycles[key];
                    
                    if (resetDone && (hasCountdown || isRunning)) {
                        clearInterval(pollInterval);
                        delete activeResetPolls[key];
                        updateTimerDisplay(app);
                    }
                })
                .catch(() => {});
            
            if (pollAttempts >= maxPollAttempts) {
                clearInterval(pollInterval);
                delete activeResetPolls[key];
                // Clear the local pending state so normal display resumes
                pendingResets[key] = false;
                updateTimerDisplay(app);
            }
        }, 2000); // Poll every 2 seconds for fast feedback
        
        activeResetPolls[key] = pollInterval;
    }
    
    // Display initial loading message in the UI when sleep data isn't available yet
    function displayWaitingForCycle() {
        trackedApps.forEach(app => {
            if (!nextCycleTimes[app]) {
                getTimerElements(app).forEach(timerElement => {
                    const timerValue = timerElement.querySelector('.timer-value');
                    if (timerValue && (timerValue.textContent === '--:--:--' || timerValue.textContent === 'Starting Cycle')) {
                        timerValue.textContent = 'Waiting for Cycle';
                        timerValue.classList.add('refreshing-state');
                        timerValue.style.color = '#00c2ce';
                    }
                });
            }
        });
    }
    
    // Replace any "Loading..." timers with "Starting Cycle" so we never leave them stuck
    function clearStaleLoadingTimers() {
        trackedApps.forEach(app => {
            getTimerElements(app).forEach(timerElement => {
                const timerValue = timerElement.querySelector('.timer-value');
                if (timerValue && timerValue.textContent === 'Loading...') {
                    timerValue.textContent = 'Starting Cycle';
                    timerValue.classList.remove('refreshing-state');
                }
            });
        });
    }

    // Return all timer elements for an app (grid cards AND list-mode rows)
    // Excludes timers inside hidden (old static) cards.
    function getTimerElements(app) {
        var results = [];
        // Grid mode: timers inside VISIBLE .app-stats-card (dynamic-card only)
        document.querySelectorAll('.app-stats-card.dynamic-card.' + app + ' .cycle-timer').forEach(function(t) {
            results.push(t);
        });
        // Also check swaparr/eros cards that may not be dynamic
        document.querySelectorAll('.swaparr-stats-grid .app-stats-card.' + app + ' .cycle-timer').forEach(function(t) {
            if (results.indexOf(t) === -1) results.push(t);
        });
        // List mode: timers inside <tr> within a list table belonging to this app group
        document.querySelectorAll('.app-group[data-app="' + app + '"] .cycle-timer').forEach(function(t) {
            if (results.indexOf(t) === -1) results.push(t);
        });
        return results;
    }
    
    // Get instance name for a timer (from reset button or card/row in same container)
    function getInstanceNameForTimer(timerElement) {
        // Grid mode — timer is inside .app-stats-card
        const card = timerElement.closest('.app-stats-card');
        if (card) {
            const resetBtn = card.querySelector('.cycle-reset-button[data-instance-name]');
            const fromBtn = resetBtn ? resetBtn.getAttribute('data-instance-name') : null;
            const fromCard = card.getAttribute('data-instance-name');
            return fromBtn || fromCard || null;
        }
        // List mode — timer is inside a <tr> with data-instance-name
        const row = timerElement.closest('tr[data-instance-name]');
        if (row) return row.getAttribute('data-instance-name') || null;
        return null;
    }
    
    // Key for per-instance state: "app" for single-app, "app-instanceName" for *arr instances
    function stateKey(app, instanceName) {
        return instanceName ? app + '-' + instanceName : app;
    }
    
    // Create timer display element in each app stats card (supports multiple instance cards)
    function createTimerElement(app) {
        const dataApp = app;
        const cssClass = app.replace(/-/g, '');
        
        const resetButtons = document.querySelectorAll(`button.cycle-reset-button[data-app="${dataApp}"]`);
        if (!resetButtons.length) return;
        
        resetButtons.forEach(resetButton => {
            // Skip if already wrapped with a timer (grid cards with baked-in timer)
            const container = resetButton.closest('.reset-and-timer-container');
            if (container && container.querySelector('.cycle-timer')) return;
            // Skip if button is in a table cell (list mode — timer is in adjacent <td>)
            if (resetButton.closest('td')) return;
            
            const parent = resetButton.parentNode;
            const wrapper = document.createElement('div');
            wrapper.className = 'reset-and-timer-container';
            wrapper.style.display = 'flex';
            wrapper.style.justifyContent = 'space-between';
            wrapper.style.alignItems = 'center';
            wrapper.style.width = '100%';
            wrapper.style.marginTop = '8px';
            parent.insertBefore(wrapper, resetButton);
            wrapper.appendChild(resetButton);
            
            const timerElement = document.createElement('div');
            timerElement.className = 'cycle-timer inline-timer';
            timerElement.innerHTML = '<i class="fas fa-clock"></i> <span class="timer-value">Starting Cycle</span>';
            if (app === 'eros') timerElement.style.cssText = 'border-left: 2px solid #ff45b7 !important;';
            timerElement.classList.add(cssClass);
            timerElement.setAttribute('data-app-type', app);
            const timerIcon = timerElement.querySelector('i');
            if (timerIcon) timerIcon.classList.add(cssClass + '-icon');
            wrapper.appendChild(timerElement);
        });
    }
    
    // Fetch cycle times for all tracked apps
    function fetchAllCycleTimes() {
        // First try to get data for all apps at once
        fetchAllCycleData().catch(() => {
            // If that fails, fetch individually
            trackedApps.forEach(app => {
                fetchCycleTime(app);
            });
        });
    }
    
    // Fetch cycle data for all apps at once
    function fetchAllCycleData() {
        // If already fetching, don't start another fetch
        if (isFetchingData) {
            return Promise.resolve(nextCycleTimes); // Return existing data
        }
        
        // Set the lock
        isFetchingData = true;
        
        return new Promise((resolve, reject) => {
            // Use a completely relative URL approach to avoid any subpath issues
            const url = buildUrl('./api/cycle/status');
            
            fetch(url, {
                method: 'GET',
                headers: {
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache'
                }
            })
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! Status: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                // Release the lock
                isFetchingData = false;
                
                // Check if we got valid data
                if (Object.keys(data).length === 0) {
                    resolve({}); // No apps configured yet
                    return;
                }
                
                let dataProcessed = false;
                
                // Process the data for each app (per-instance for *arr, single for swaparr)
                for (const app in data) {
                    if (!trackedApps.includes(app)) continue;
                    const appData = data[app];
                    if (!appData) continue;
                    // Per-instance format: { instances: { InstanceName: { next_cycle, cyclelock, pending_reset } } }
                    if (appData.instances && typeof appData.instances === 'object') {
                        Object.keys(pendingResets).filter(function(k) { return k === app || k.startsWith(app + '-'); }).forEach(function(k) { delete pendingResets[k]; });
                        for (const instanceName in appData.instances) {
                            const inst = appData.instances[instanceName];
                            if (!inst) continue;
                            
                            const key = stateKey(app, instanceName);
                            const nextCycleTime = inst.next_cycle ? new Date(inst.next_cycle) : null;
                            
                            if (nextCycleTime && !isNaN(nextCycleTime.getTime())) {
                                nextCycleTimes[key] = nextCycleTime;
                            }
                            
                            runningCycles[key] = inst.cyclelock !== undefined ? inst.cyclelock : true;
                            pendingResets[key] = inst.pending_reset === true;
                            cycleActivities[key] = inst.cycle_activity || null;
                            dataProcessed = true;
                        }
                        runningCycles[app] = false;
                        updateTimerDisplay(app);
                        setupCountdown(app);
                        continue;
                    }
                    // Single-app format: { next_cycle, cyclelock, pending_reset }
                    if (appData.next_cycle || appData.cyclelock !== undefined) {
                        const nextCycleTime = appData.next_cycle ? new Date(appData.next_cycle) : null;
                        
                        if (nextCycleTime && !isNaN(nextCycleTime.getTime())) {
                            nextCycleTimes[app] = nextCycleTime;
                        }
                        
                        pendingResets[app] = appData.pending_reset === true;
                        const cyclelock = appData.cyclelock !== undefined ? appData.cyclelock : true;
                        runningCycles[app] = cyclelock;
                        if (cyclelock && !pendingResets[app]) {
                            getTimerElements(app).forEach(timerElement => {
                                const timerValue = timerElement.querySelector('.timer-value');
                                if (timerValue) {
                                    timerValue.textContent = 'Running Cycle';
                                    timerValue.classList.remove('refreshing-state');
                                    timerValue.classList.add('running-state');
                                    timerValue.style.color = '#00ff88';
                                }
                            });
                        } else if (pendingResets[app]) {
                            getTimerElements(app).forEach(timerElement => {
                                const timerValue = timerElement.querySelector('.timer-value');
                                if (timerValue) {
                                    timerValue.textContent = 'Pending Reset';
                                    timerValue.classList.remove('refreshing-state', 'running-state');
                                    timerValue.classList.add('pending-reset-state');
                                    timerValue.style.color = '#ffaa00';
                                }
                            });
                        } else {
                            updateTimerDisplay(app);
                        }
                        setupCountdown(app);
                        dataProcessed = true;
                    }
                }
                
                if (dataProcessed) {
                    clearStaleLoadingTimers();
                    // When any instance still has no next_cycle (shows "Starting Cycle"), poll every 2s until we get
                    // a countdown (sleep just started; backend sets next_cycle shortly)
                    const hasStartingCycleWithInstances = Object.keys(data).some(app => {
                        const appData = data[app];
                        if (!appData || !appData.instances) return false;
                        return Object.keys(appData.instances).some(instanceName => {
                            const inst = appData.instances[instanceName];
                            return inst && !inst.next_cycle && !inst.cyclelock;
                        });
                    });
                    const hasStartingCycleSingle = Object.keys(data).some(app => {
                        const appData = data[app];
                        if (!appData || appData.instances) return false;
                        return (appData.next_cycle == null && !appData.cyclelock);
                    });
                    if (hasStartingCycleWithInstances || hasStartingCycleSingle) {
                        startStartingCyclePolling();
                    }
                    resolve(data);
                } else {
                    clearStaleLoadingTimers();
                    resolve({}); // No configured apps found
                }
            })
            .catch(error => {
                // Release the lock
                isFetchingData = false;
                
                // Only log errors occasionally to reduce console spam
                if (Math.random() < 0.1) { // Only log 10% of errors
                    console.warn('[CycleCountdown] Error fetching from API:', error.message); 
                }
                
                // Display waiting message in UI only if we have no existing data
                if (Object.keys(nextCycleTimes).length === 0) {
                    displayWaitingForCycle(); // Shows "Waiting for cycle..." during startup
                    reject(error);
                } else {
                    // If we have existing data, just use that
                    resolve(nextCycleTimes);
                }
            });
        });
    }
    
    // Fetch the next cycle time for a specific app
    function fetchCycleTime(app) {
        try {
            // Use a completely relative URL approach to avoid any subpath issues
            const url = buildUrl(`./api/cycle/status/${app}`);
            
            // Use safe timeout to avoid context issues
            safeSetTimeout(() => {
                fetch(url, {
                    method: 'GET',
                    headers: {
                        'Cache-Control': 'no-cache',
                        'Pragma': 'no-cache'
                    }
                })
                .then(response => {
                    if (!response.ok) {
                        throw new Error(`HTTP error! Status: ${response.status}`);
                    }
                    return response.json();
                })
                .then(data => {
                    if (data && data.next_cycle) {
                        // Store next cycle time
                        nextCycleTimes[app] = new Date(data.next_cycle);
                        
                        // Update timer display immediately
                        updateTimerDisplay(app);
                        
                        // Set up interval to update countdown
                        setupCountdown(app);
                    }
                })
                .catch(error => {
                    console.error(`[CycleCountdown] Error fetching cycle time for ${app}:`, error);
                    updateTimerError(app);
                });
            }, 50);
        } catch (error) {
            console.error(`[CycleCountdown] Error in fetchCycleTime for ${app}:`, error);
            updateTimerError(app);
        }
    }
    
    // Set up countdown interval for an app
    function setupCountdown(app) {
        // Clear any existing interval
        if (timerIntervals[app]) {
            clearInterval(timerIntervals[app]);
        }
        
        // Set up new interval to update every second for smooth countdown
        timerIntervals[app] = setInterval(() => {
            updateTimerDisplay(app);
        }, 1000); // 1-second interval for smooth countdown
        
    }
    
    // Update the timer display for an app (per-instance when cards have data-instance-name)
    function updateTimerDisplay(app) {
        const timerElements = getTimerElements(app);
        if (!timerElements.length) return;
        
        const now = new Date();
        
        timerElements.forEach(timerElement => {
            const timerValue = timerElement.querySelector('.timer-value');
            if (!timerValue) return;
            
            const instanceName = getInstanceNameForTimer(timerElement);
            const key = stateKey(app, instanceName);
            const nextCycleTime = nextCycleTimes[key];
            const isRunning = runningCycles[key];
            const isPendingReset = pendingResets[key] === true;
            const timeRemaining = nextCycleTime ? (nextCycleTime - now) : 0;
            const isExpired = nextCycleTime && timeRemaining <= 0;
            
            let formattedTime = 'Starting Cycle';
            if (nextCycleTime && !isExpired && !isRunning && !isPendingReset) {
                const hours = Math.floor(timeRemaining / (1000 * 60 * 60));
                const minutes = Math.floor((timeRemaining % (1000 * 60 * 60)) / (1000 * 60));
                const seconds = Math.floor((timeRemaining % (1000 * 60)) / 1000);
                formattedTime = String(hours).padStart(2, '0') + ':' + String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
            }
            if (isExpired) delete nextCycleTimes[key];
            
            if (isPendingReset) {
                timerValue.textContent = 'Pending Reset';
                timerValue.classList.remove('refreshing-state', 'running-state');
                timerValue.classList.add('pending-reset-state');
                timerValue.style.color = '#ffaa00';
                return;
            }
            if (isRunning) {
                const activity = cycleActivities[key];
                timerValue.textContent = (activity && String(activity).trim()) ? activity : 'Running Cycle';
                timerValue.classList.remove('refreshing-state', 'pending-reset-state');
                timerValue.classList.add('running-state');
                timerValue.style.color = '#00ff88';
                return;
            }
            if (!nextCycleTime || isExpired) {
                timerValue.textContent = 'Starting Cycle';
                timerValue.classList.remove('refreshing-state', 'running-state', 'pending-reset-state');
                timerValue.style.removeProperty('color');
                return;
            }
            timerValue.textContent = formattedTime;
            timerValue.classList.remove('refreshing-state', 'running-state', 'pending-reset-state');
            updateTimerStyle(timerElement, timeRemaining);
        });
    }
    
    // Update timer styling based on remaining time
    function updateTimerStyle(timerElement, timeRemaining) {
        // Get the timer value element
        const timerValue = timerElement.querySelector('.timer-value');
        if (!timerValue) return;
        
        // Remove any existing time-based classes from both elements
        timerElement.classList.remove('timer-soon', 'timer-imminent', 'timer-normal');
        timerValue.classList.remove('timer-value-soon', 'timer-value-imminent', 'timer-value-normal');
        
        // Add class based on time remaining
        if (timeRemaining < 60000) { // Less than 1 minute
            timerElement.classList.add('timer-imminent');
            timerValue.classList.add('timer-value-imminent');
            timerValue.style.color = '#ff3333'; // Red - direct styling for immediate effect
        } else if (timeRemaining < 300000) { // Less than 5 minutes
            timerElement.classList.add('timer-soon');
            timerValue.classList.add('timer-value-soon');
            timerValue.style.color = '#ff8c00'; // Orange - direct styling for immediate effect
        } else {
            timerElement.classList.add('timer-normal');
            timerValue.classList.add('timer-value-normal');
            timerValue.style.color = 'white'; // White - direct styling for immediate effect
        }
    }
    
    // Show error state in timer for actual errors (not startup waiting)
    function updateTimerError(app) {
        getTimerElements(app).forEach(timerElement => {
            const timerValue = timerElement.querySelector('.timer-value');
            if (timerValue) {
                timerValue.textContent = 'Unavailable';
                timerValue.style.color = '#ff6b6b';
                timerElement.classList.add('timer-error');
            }
        });
    }
    
    // Clean up timers when leaving home (stops all intervals and polling)
    function cleanup() {
        Object.keys(timerIntervals).forEach(app => {
            clearInterval(timerIntervals[app]);
            delete timerIntervals[app];
        });
        if (dataRefreshIntervalId) {
            clearInterval(dataRefreshIntervalId);
            dataRefreshIntervalId = null;
        }
        if (startingCyclePollTimeout) {
            clearTimeout(startingCyclePollTimeout);
            startingCyclePollTimeout = null;
        }
    }
    
    // Initialize on page load - with proper binding for setTimeout
    function safeSetTimeout(callback, delay) {
        // Make sure we're using the global window object for setTimeout
        return window.setTimeout.bind(window)(callback, delay);
    }
    
    function safeSetInterval(callback, delay) {
        // Make sure we're using the global window object for setInterval
        return window.setInterval.bind(window)(callback, delay);
    }
    
    document.addEventListener('DOMContentLoaded', function() {
        // Skip initialization on login page or if not authenticated
        const isLoginPage = document.querySelector('.login-container, #loginForm, .login-form');
        if (isLoginPage) return;
        
        // Only initialize if we're on a page that has app status cards
        const homeSection = document.getElementById('homeSection');
        const hasAppCards = document.querySelector('.app-status-card, .status-card, [id$="StatusCard"]');
        
        if (!homeSection && !hasAppCards) return;
        
        // Simple initialization with minimal delay
        setTimeout(function() {
            // Always initialize immediately on page load
            initialize();
            
            // Also set up observer for home section visibility changes
            const observer = new MutationObserver((mutations) => {
                for (const mutation of mutations) {
                    if (mutation.target.id === 'homeSection' && 
                        mutation.attributeName === 'class' && 
                        !mutation.target.classList.contains('hidden')) {
                        initialize();
                    } else if (mutation.target.id === 'homeSection' && 
                               mutation.attributeName === 'class' && 
                               mutation.target.classList.contains('hidden')) {
                        cleanup();
                    }
                }
            });
            
            if (homeSection) {
                observer.observe(homeSection, { attributes: true });
            }
        }, 100); // 100ms delay is enough
    });
    
    // Refresh all cycle data immediately (for timezone changes)
    // When called right after list-mode render, a second delayed refresh ensures
    // timers (which may not exist yet) get updated — fixes TV Hunt etc. stuck on "Loading..."
    function refreshAllData() {
        fetchAllCycleData()
            .then(() => {
                // Delayed refresh to catch timers that appeared after first fetch (list-mode race)
                safeSetTimeout(() => {
                    fetchAllCycleData().then(clearStaleLoadingTimers).catch(() => {});
                }, 500);
            })
            .catch(() => {});
    }

    // Public API
    return {
        initialize: initialize,
        fetchAllCycleTimes: fetchAllCycleTimes,
        cleanup: cleanup,
        refreshAllData: refreshAllData,
        refreshTimerElements: setupTimerElements
    };
})();


/* === modules/ui/apps-scroll-fix.js === */
/**
 * Apps Section Scroll Fix
 * This script prevents double scrollbars and limits excessive scrolling
 * by ensuring only the main content area is scrollable
 */
document.addEventListener('DOMContentLoaded', function() {
    // Function to fix the apps section scrolling
    function fixAppsScrolling() {
        // Get the main content element (this should be the only scrollable container)
        const mainContent = document.querySelector('.main-content');
        
        // Get the apps section elements
        const appsSection = document.getElementById('appsSection');
        const singleScrollContainer = appsSection ? appsSection.querySelector('.single-scroll-container') : null;
        const appPanelsContainer = appsSection ? appsSection.querySelector('.app-panels-container') : null;
        
        // Make sure main content is the only scrollable container
        if (mainContent) {
            mainContent.style.overflowY = 'auto';
            mainContent.style.height = '100vh';
        }
        
        // If the apps section exists, make it visible but not scrollable
        if (appsSection) {
            // Remove scrolling from apps section
            appsSection.style.overflow = 'visible';
            appsSection.style.height = 'auto';
            appsSection.style.maxHeight = 'none';
            
            // Remove scrolling from single scroll container
            if (singleScrollContainer) {
                singleScrollContainer.style.overflow = 'visible';
                singleScrollContainer.style.height = 'auto';
                singleScrollContainer.style.maxHeight = 'none';
            }
            
            // Remove excessive padding from app panels container
            if (appPanelsContainer) {
                appPanelsContainer.style.height = 'auto';
                appPanelsContainer.style.overflow = 'visible';
                appPanelsContainer.style.marginBottom = '50px';
                appPanelsContainer.style.paddingBottom = '0';
            }
            
            // Remove excessive padding from all app panels
            const appPanels = document.querySelectorAll('.app-apps-panel');
            appPanels.forEach(panel => {
                panel.style.overflow = 'visible';
                panel.style.height = 'auto';
                panel.style.maxHeight = 'none';
                panel.style.paddingBottom = '50px';
                panel.style.marginBottom = '20px';
            });
            
            // Remove excessive bottom padding from additional options sections
            const additionalOptions = document.querySelectorAll('.additional-options, .skip-series-refresh');
            additionalOptions.forEach(section => {
                section.style.overflow = 'visible';
                section.style.marginBottom = '50px';
                section.style.paddingBottom = '20px';
            });
            
            // Make sure content sections are not scrollable
            const contentSections = document.querySelectorAll('.content-section');
            contentSections.forEach(section => {
                section.style.overflow = 'visible';
                section.style.height = 'auto';
            });
            
            // Make sure app container is not scrollable
            const appsContainer = document.getElementById('appsContainer');
            if (appsContainer) {
                appsContainer.style.overflow = 'visible';
                appsContainer.style.height = 'auto';
            }
        }
    }
    
    // Apply the fix immediately
    fixAppsScrolling();
    
    // Apply after a short delay to account for dynamic content
    setTimeout(fixAppsScrolling, 500);
    setTimeout(fixAppsScrolling, 1000); // Additional delayed application
    
    // Apply when app selection changes
    const appsAppSelect = document.getElementById('appsAppSelect');
    if (appsAppSelect) {
        appsAppSelect.addEventListener('change', function() {
            // Wait for panel to update
            setTimeout(fixAppsScrolling, 300);
        });
    }
    
    // Apply when window is resized
    window.addEventListener('resize', fixAppsScrolling);
    
    // Apply when hash changes (navigation)
    window.addEventListener('hashchange', function() {
        // Check if we navigated to the apps section
        setTimeout(fixAppsScrolling, 300);
    });
}); 

/* === modules/ui/card-hover-effects.js === */
/**
 * Huntarr - Card Hover Effects
 * Adds subtle hover animations to app cards
 */

document.addEventListener('DOMContentLoaded', function() {
    // Add hover effects to app cards
    const appCards = document.querySelectorAll('.app-stats-card');
    
    appCards.forEach(card => {
        // Add transition properties
        card.style.transition = 'transform 0.3s ease, box-shadow 0.3s ease, filter 0.3s ease';
        
        // Mouse enter event - elevate and highlight card
        card.addEventListener('mouseenter', function() {
            card.style.transform = 'translateY(-5px) scale(1.02)';
            card.style.boxShadow = '0 8px 24px rgba(0, 0, 0, 0.2)';
            card.style.filter = 'brightness(1.1)';
            
            // Get app type from classes
            const appType = getAppType(card);
            if (appType) {
                // Add app-specific glow effect
                const glowColors = {
                    'sonarr': '0 0 15px rgba(52, 152, 219, 0.4)',
                    'radarr': '0 0 15px rgba(243, 156, 18, 0.4)',
                    'lidarr': '0 0 15px rgba(46, 204, 113, 0.4)',
                    'readarr': '0 0 15px rgba(231, 76, 60, 0.4)',
                    'whisparr': '0 0 15px rgba(155, 89, 182, 0.4)',
                    'eros': '0 0 15px rgba(26, 188, 156, 0.4)'
                };
                
                if (glowColors[appType]) {
                    card.style.boxShadow += ', ' + glowColors[appType];
                }
            }
        });
        
        // Mouse leave event - return to normal
        card.addEventListener('mouseleave', function() {
            card.style.transform = 'translateY(0) scale(1)';
            card.style.boxShadow = '';
            card.style.filter = 'brightness(1)';
        });
    });
    
    // Helper function to get app type from card classes
    function getAppType(card) {
        const classList = card.classList;
        const appTypes = ['sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros', 'swaparr'];
        
        for (const type of appTypes) {
            if (classList.contains(type)) {
                return type;
            }
        }
        
        return null;
    }
});


/* === modules/ui/circular-progress.js === */
/**
 * Huntarr - Circular Progress Indicators
 * Creates animated circular progress indicators for API usage counters
 */

document.addEventListener('DOMContentLoaded', function() {
    // Create and inject SVG progress indicators for API counts
    const apps = ['sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros', 'swaparr'];
    
    // App-specific colors matching your existing design
    const appColors = {
        'sonarr': '#6366f1',  // Indigo
        'radarr': '#f39c12',  // Yellow/orange
        'lidarr': '#2ecc71',  // Green
        'readarr': '#e74c3c', // Red
        'whisparr': '#9b59b6', // Purple
        'eros': '#1abc9c'     // Teal
    };
    
    // Add circular progress indicators to each API count indicator
    apps.forEach(app => {
        const capContainer = document.querySelector(`#${app}-hourly-cap`);
        if (!capContainer) return;
        
        // Get current API count and limit
        const countElement = document.querySelector(`#${app}-api-count`);
        const limitElement = document.querySelector(`#${app}-api-limit`);
        
        if (!countElement || !limitElement) return;
        
        const count = parseInt(countElement.textContent);
        const limit = parseInt(limitElement.textContent);
        
        // Create SVG container for progress circle
        const svgSize = 28;
        const circleRadius = 10;
        const circleStrokeWidth = 2.5;
        const circumference = 2 * Math.PI * circleRadius;
        
        // Calculate progress percentage
        const percentage = Math.min(count / limit, 1);
        const dashOffset = circumference * (1 - percentage);
        
        // Create SVG element
        const svgNamespace = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(svgNamespace, "svg");
        svg.setAttribute("width", svgSize);
        svg.setAttribute("height", svgSize);
        svg.setAttribute("viewBox", `0 0 ${svgSize} ${svgSize}`);
        svg.classList.add("api-progress-circle");
        
        // Background circle
        const bgCircle = document.createElementNS(svgNamespace, "circle");
        bgCircle.setAttribute("cx", svgSize / 2);
        bgCircle.setAttribute("cy", svgSize / 2);
        bgCircle.setAttribute("r", circleRadius);
        bgCircle.setAttribute("fill", "none");
        bgCircle.setAttribute("stroke", "rgba(255, 255, 255, 0.1)");
        bgCircle.setAttribute("stroke-width", circleStrokeWidth);
        
        // Progress circle
        const progressCircle = document.createElementNS(svgNamespace, "circle");
        progressCircle.setAttribute("cx", svgSize / 2);
        progressCircle.setAttribute("cy", svgSize / 2);
        progressCircle.setAttribute("r", circleRadius);
        progressCircle.setAttribute("fill", "none");
        progressCircle.setAttribute("stroke", appColors[app]);
        progressCircle.setAttribute("stroke-width", circleStrokeWidth);
        progressCircle.setAttribute("stroke-dasharray", circumference);
        progressCircle.setAttribute("stroke-dashoffset", dashOffset);
        progressCircle.setAttribute("transform", `rotate(-90 ${svgSize/2} ${svgSize/2})`);
        
        // Add circles to SVG
        svg.appendChild(bgCircle);
        svg.appendChild(progressCircle);
        
        // Add SVG before text content
        capContainer.insertBefore(svg, capContainer.firstChild);
        
        // Style for the indicator
        const style = document.createElement('style');
        style.textContent = `
            .api-progress-circle {
                margin-right: 5px;
                filter: drop-shadow(0 0 3px ${appColors[app]}40);
            }
            
            .hourly-cap-status {
                display: flex;
                align-items: center;
            }
            
            .api-progress-circle circle:nth-child(2) {
                filter: drop-shadow(0 0 4px ${appColors[app]}60);
                transition: stroke-dashoffset 0.5s ease;
            }
        `;
        document.head.appendChild(style);
        
        // Update progress when API counts change
        const updateProgressCircle = () => {
            const newCount = parseInt(countElement.textContent);
            const newLimit = parseInt(limitElement.textContent);
            const newPercentage = Math.min(newCount / newLimit, 1);
            const newDashOffset = circumference * (1 - newPercentage);
            
            progressCircle.setAttribute("stroke-dashoffset", newDashOffset);
            
            // Change color based on usage percentage
            if (newPercentage > 0.9) {
                progressCircle.setAttribute("stroke", "#e74c3c"); // Red when near limit
            } else if (newPercentage > 0.75) {
                progressCircle.setAttribute("stroke", "#f39c12"); // Orange/yellow for moderate usage
            } else {
                progressCircle.setAttribute("stroke", appColors[app]); // Default color
            }
        };
        
        // Set up a mutation observer to watch for changes in the count value
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'characterData' || mutation.type === 'childList') {
                    updateProgressCircle();
                }
            });
        });
        
        // Observe both count and limit elements
        observer.observe(countElement, { characterData: true, childList: true, subtree: true });
        observer.observe(limitElement, { characterData: true, childList: true, subtree: true });
    });
});


/* === modules/ui/background-pattern.js === */
/**
 * Huntarr - Subtle Background Pattern
 * Adds a modern dot grid pattern to the dashboard background
 */

document.addEventListener('DOMContentLoaded', function() {
    // Add subtle background pattern styles
    const style = document.createElement('style');
    style.id = 'background-pattern-styles';
    
    // Pattern style based on the user's preference for dark themes with blue accents
    style.textContent = `
        /* Subtle dot grid pattern for dark background */
        .dashboard-grid::before {
            content: "";
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background-image: 
                radial-gradient(circle at 1px 1px, rgba(85, 97, 215, 0.07) 1px, transparent 0);
            background-size: 25px 25px;
            background-position: -5px -5px;
            pointer-events: none;
            z-index: 0;
            opacity: 0.5;
        }
        
        /* Make sure all dashboard content stays above the pattern */
        .dashboard-grid > * {
            position: relative;
            z-index: 1;
        }
        
        /* For mobile - smaller pattern */
        @media (max-width: 768px) {
            .dashboard-grid::before {
                background-size: 20px 20px;
            }
        }
    `;
    
    document.head.appendChild(style);
    
    // Make sure the container has position relative for the pattern to work
    const dashboardGrid = document.querySelector('.dashboard-grid');
    if (dashboardGrid) {
        dashboardGrid.style.position = 'relative';
        dashboardGrid.style.overflow = 'hidden';
    }
});


/* === modules/ui/hourly-cap.js === */
/**
 * Hourly API Cap Handling for Huntarr
 * Fetches and updates the hourly API usage indicators on the dashboard
 */

document.addEventListener('DOMContentLoaded', function() {
    // Set up polling to refresh the hourly cap data every 2 minutes
    setInterval(loadHourlyCapData, 120000);
});

/**
 * Load hourly API cap data from the server
 */
window.loadHourlyCapData = function loadHourlyCapData() {
    HuntarrUtils.fetchWithTimeout('./api/hourly-caps')
        .then(response => {
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            return response.json();
        })
        .then(data => {
            if (data.success && data.caps && data.limits) {
                updateHourlyCapDisplay(data.caps, data.limits);
            } else {
                console.error('Failed to load hourly API cap data:', data.message || 'Unknown error');
            }
        })
        .catch(error => {
            console.error('Error fetching hourly API cap data:', error);
        });
};

/**
 * Get instance name for a card (from card attribute or reset button).
 * @param {Element} card - .app-stats-card element
 * @returns {string|null} Instance name or null for single-app
 */
function getInstanceNameForCard(card) {
    // Check card attribute first (most reliable)
    if (card.hasAttribute('data-instance-name')) {
        return card.getAttribute('data-instance-name');
    }
    // Fallback to reset button
    const resetBtn = card.querySelector('.cycle-reset-button[data-instance-name]');
    return resetBtn ? resetBtn.getAttribute('data-instance-name') : null;
}

/**
 * Update the hourly API cap indicators for each app (per-instance when app has instances).
 * Data is keyed by instance name; fallback to index so 2nd+ instance cards always update.
 * @param {Object} caps - Hourly API usage: per-app or per-instance (caps[app].instances[instanceName])
 * @param {Object} limits - Limits: per-app number or per-instance (limits[app].instances[instanceName])
 */
function updateHourlyCapDisplay(caps, limits) {
    const apps = ['movie_hunt', 'sonarr', 'radarr', 'lidarr', 'readarr', 'whisparr', 'eros', 'swaparr'];

    apps.forEach(app => {
        if (!caps[app]) return;
        const cards = document.querySelectorAll('.app-stats-card.' + app);
        const hasInstances = caps[app].instances && typeof caps[app].instances === 'object';
        const appLimit = typeof limits[app] === 'number' ? limits[app] : 20;
        const usage = !hasInstances && caps[app].api_hits != null ? caps[app].api_hits : 0;

        let instanceNames = [];
        if (hasInstances && limits[app] && limits[app].instances) {
            instanceNames = Object.keys(caps[app].instances);
        }

        cards.forEach((card, cardIndex) => {
            let usageVal = usage;
            let limitVal = appLimit;
            if (hasInstances && instanceNames.length > 0) {
                const instanceName = getInstanceNameForCard(card);
                const nameToUse = instanceName != null && caps[app].instances[instanceName] != null
                    ? instanceName
                    : instanceNames[cardIndex] || null;
                const instCaps = nameToUse != null ? caps[app].instances[nameToUse] : null;
                const instLimits = limits[app].instances && nameToUse != null ? limits[app].instances[nameToUse] : appLimit;
                usageVal = instCaps && instCaps.api_hits != null ? instCaps.api_hits : 0;
                limitVal = instLimits != null ? instLimits : 20;
            }
            const pct = (limitVal > 0) ? (usageVal / limitVal) * 100 : 0;
            const countEl = card.querySelector('.hourly-cap-text span');
            const limitEl = card.querySelectorAll('.hourly-cap-text span')[1];
            if (countEl) countEl.textContent = usageVal;
            if (limitEl) limitEl.textContent = limitVal;
            const statusEl = card.querySelector('.hourly-cap-status');
            if (statusEl) {
                statusEl.classList.remove('good', 'warning', 'danger');
                if (pct >= 100) statusEl.classList.add('danger');
                else if (pct >= 75) statusEl.classList.add('warning');
                else statusEl.classList.add('good');
            }
            const progressFill = card.querySelector('.api-progress-fill');
            if (progressFill) progressFill.style.width = Math.min(100, pct) + '%';
            const progressSpans = card.querySelectorAll('.api-progress-text span');
            if (progressSpans.length >= 2) {
                progressSpans[0].textContent = usageVal;
                progressSpans[1].textContent = limitVal;
            }
        });
    });
}
