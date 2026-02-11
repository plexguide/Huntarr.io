/**
 * Requestarr Movie Detail Page – Uses shared mh-* styling from Movie Hunt
 * Handles Radarr + Movie Hunt instances and movie status checking
 */
(function() {
    'use strict';

    // Inline encode/decode helpers (mirrors requestarr-core.js exports)
    function _encodeInstanceValue(appType, name) {
        return appType + ':' + name;
    }
    function _decodeInstanceValue(value) {
        if (!value) return { appType: 'radarr', name: '' };
        var idx = value.indexOf(':');
        if (idx === -1) return { appType: 'radarr', name: value };
        return { appType: value.substring(0, idx), name: value.substring(idx + 1) };
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
                } else if (e.state && !e.state.movieDetail) {
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

            if (!fromHistory && detailView && detailView.classList.contains('active')) {
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

        async updateMovieStatus() {
            // Toolbar visibility and action buttons are now driven entirely by
            // updateDetailInfoBar(), which fetches the detailed status with `found`.
            // This method is kept for backward compatibility but delegates.
            // updateDetailInfoBar is always called alongside this.
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
                        var availMap = { 'announced': 'Announced', 'inCinemas': 'In Cinemas', 'released': 'Released' };
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
                        var availMap = { 'announced': 'Announced', 'inCinemas': 'In Cinemas', 'released': 'Released' };
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
            const inLibrary = originalMovie.in_library || false;
            let actionButton = '';

            if (inLibrary) {
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
                                <div class="mh-info-bar" id="requestarr-detail-info-bar">
                                    <div class="mh-ib mh-ib-path">
                                        <div class="mh-ib-label">PATH</div>
                                        <div class="mh-ib-val" id="requestarr-ib-path">${this.movieInstances.length > 0 ? '<i class="fas fa-spinner fa-spin"></i>' : '-'}</div>
                                    </div>
                                    <div class="mh-ib">
                                        <div class="mh-ib-label">STATUS</div>
                                        <div class="mh-ib-val" id="requestarr-ib-status">${this.movieInstances.length > 0 ? '<i class="fas fa-spinner fa-spin"></i>' : '<span class="mh-badge mh-badge-none">No Instance</span>'}</div>
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
                    await this.updateMovieStatus();
                    this.updateDetailInfoBar();
                });
                this.updateMovieStatus();
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

            // ESC key
            const escHandler = (e) => {
                if (e.key === 'Escape') {
                    this.closeDetail();
                    document.removeEventListener('keydown', escHandler);
                }
            };
            document.addEventListener('keydown', escHandler);
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
