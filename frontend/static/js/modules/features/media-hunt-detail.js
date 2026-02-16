/**
 * Media Hunt Detail – Movie detail view with management toolbar (movie mode).
 * Exposed as window.MovieHuntDetail for compatibility. CSS: media-hunt-detail.css.
 */
(function() {
    'use strict';

    window.MovieHuntDetail = {
        currentMovie: null,
        currentDetails: null,
        currentMovieStatus: null,
        tmdbApiKey: null,
        movieHuntInstances: [],
        combinedInstances: [],  // Movie Hunt + Radarr for dropdown; value is "mh:<id>" or "radarr:<name>"
        selectedInstanceId: null,

        /* ── Init ─────────────────────────────────────────────── */
        init() {
            console.log('[MovieHuntDetail] Module initialized');
            window.addEventListener('popstate', (e) => {
                if (e.state && e.state.movieDetail) {
                    this.openDetail(e.state.movieDetail, {}, true);
                } else if (!e.state || !e.state.requestarrMovieDetail) {
                    this.closeDetail(true);
                }
            });
            this.checkUrlForMovieDetail();
        },

        checkUrlForMovieDetail() {
            const hash = window.location.hash;
            const movieMatch = hash.match(/#movie\/(\d+)/);
            if (movieMatch) {
                const tmdbId = parseInt(movieMatch[1]);
                this.openDetailFromTmdbId(tmdbId);
            }
        },

        async openDetailFromTmdbId(tmdbId) {
            try {
                const details = await this.fetchMovieDetails(tmdbId);
                if (details) {
                    const movieData = {
                        tmdb_id: details.id, id: details.id,
                        title: details.title,
                        year: details.release_date ? new Date(details.release_date).getFullYear() : null,
                        poster_path: details.poster_path,
                        backdrop_path: details.backdrop_path,
                        overview: details.overview,
                        vote_average: details.vote_average,
                        in_library: false
                    };
                    this.openDetail(movieData, {}, true);
                }
            } catch (error) {
                console.error('[MovieHuntDetail] Error loading movie from URL:', error);
            }
        },

        /* ── Open / Close ─────────────────────────────────────── */
        async openDetail(movie, options = {}, fromHistory = false) {
            if (!movie) return;
            this.currentMovie = movie;
            this.currentMovieStatus = null;

            if (this.movieHuntInstances.length === 0) {
                await this.loadMovieHuntInstances();
            }
            await this.loadCombinedInstances();

            // Pre-select instance when opened from Requestarr/Home with a specific Movie Hunt instance
            const requestedInstanceName = (options && options.instanceName) ? String(options.instanceName).trim() : '';
            if (requestedInstanceName && this.movieHuntInstances.length > 0) {
                const match = this.movieHuntInstances.find(function(inst) {
                    return (inst.name || '').trim().toLowerCase() === requestedInstanceName.toLowerCase();
                });
                if (match) {
                    this.selectedInstanceId = match.id;
                }
            }

            let detailView = document.getElementById('media-hunt-detail-view');
            if (!detailView) {
                detailView = document.createElement('div');
                detailView.id = 'media-hunt-detail-view';
                detailView.className = 'movie-detail-view';
                document.body.appendChild(detailView);
            }
            detailView.innerHTML = this.getLoadingHTML();
            detailView.classList.add('active');

            if (!fromHistory) {
                const tmdbId = movie.tmdb_id || movie.id;
                const url = window.location.pathname + window.location.search + '#movie/' + tmdbId;
                history.pushState({ movieDetail: movie }, movie.title, url);
            }

            try {
                const tmdbId = movie.tmdb_id || movie.id;
                const details = await this.fetchMovieDetails(tmdbId);
                if (details) {
                    this.currentDetails = details;
                    detailView.innerHTML = this.renderMovieDetail(details, movie);
                    this.setupDetailInteractions();
                } else {
                    detailView.innerHTML = this.getErrorHTML('Failed to load movie details');
                }
            } catch (error) {
                console.error('[MovieHuntDetail] Error:', error);
                detailView.innerHTML = this.getErrorHTML('Failed to load movie details');
            }
        },

        closeDetail(fromHistory = false) {
            const detailView = document.getElementById('media-hunt-detail-view');
            if (detailView) detailView.classList.remove('active');
            if (!fromHistory) history.back();
        },

        openWatchPlayer() {
            const tmdbId = this.currentMovie && (this.currentMovie.tmdb_id || this.currentMovie.id);
            const instanceId = this.selectedInstanceId;
            const title = (this.currentMovie && this.currentMovie.title) || 'Movie';
            if (!tmdbId || !instanceId) return;

            const streamUrl = './api/movie-hunt/stream/' + tmdbId + '?instance_id=' + encodeURIComponent(instanceId);

            let modal = document.getElementById('mh-watch-player-modal');
            if (!modal) {
                modal = document.createElement('div');
                modal.id = 'mh-watch-player-modal';
                modal.className = 'mh-watch-modal';
                modal.innerHTML =
                    '<div class="mh-watch-modal-backdrop"></div>' +
                    '<div class="mh-watch-modal-content">' +
                    '<div class="mh-watch-modal-header">' +
                    '<h3 class="mh-watch-modal-title"></h3>' +
                    '<button class="mh-watch-modal-close" id="mh-watch-modal-close" aria-label="Close"><i class="fas fa-times"></i></button>' +
                    '</div>' +
                    '<div class="mh-watch-modal-video">' +
                    '<video id="mh-watch-video" controls playsinline controlsList="nodownload"></video>' +
                    '</div>' +
                    '</div>';
                document.body.appendChild(modal);

                modal.querySelector('.mh-watch-modal-backdrop').onclick = () => this.closeWatchPlayer();
                modal.querySelector('#mh-watch-modal-close').onclick = () => this.closeWatchPlayer();
                modal.addEventListener('keydown', (e) => {
                    if (e.key === 'Escape') this.closeWatchPlayer();
                });
            }

            modal.querySelector('.mh-watch-modal-title').textContent = title;
            const video = modal.querySelector('#mh-watch-video');
            video.src = streamUrl;
            video.load();
            modal.classList.add('active');
            video.focus();
        },

        closeWatchPlayer() {
            const modal = document.getElementById('mh-watch-player-modal');
            if (modal) {
                modal.classList.remove('active');
                const video = modal.querySelector('#mh-watch-video');
                if (video) {
                    video.pause();
                    video.removeAttribute('src');
                }
            }
        },

        /* ── TMDB Fetch ───────────────────────────────────────── */
        async fetchMovieDetails(tmdbId) {
            if (!tmdbId) return null;
            try {
                if (!this.tmdbApiKey) {
                    const keyResp = await fetch('./api/movie-hunt/tmdb-key');
                    if (!keyResp.ok) throw new Error('TMDB key failed');
                    this.tmdbApiKey = (await keyResp.json()).api_key;
                }
                if (!this.tmdbApiKey) return null;
                const url = 'https://api.themoviedb.org/3/movie/' + tmdbId +
                    '?api_key=' + this.tmdbApiKey +
                    '&append_to_response=credits,similar,videos,release_dates';
                const resp = await fetch(url);
                if (!resp.ok) throw new Error('TMDB ' + resp.status);
                return await resp.json();
            } catch (err) {
                console.error('[MovieHuntDetail] TMDB error:', err);
                return null;
            }
        },

        /* ── Render ────────────────────────────────────────────── */
        renderMovieDetail(details, originalMovie) {
            const backdropUrl = details.backdrop_path
                ? 'https://image.tmdb.org/t/p/original' + details.backdrop_path
                : (details.poster_path ? 'https://image.tmdb.org/t/p/original' + details.poster_path : '');
            const posterUrl = details.poster_path
                ? 'https://image.tmdb.org/t/p/w500' + details.poster_path
                : './static/images/blackout.jpg';
            const rating = details.vote_average ? Number(details.vote_average).toFixed(1) : 'N/A';
            const year = details.release_date ? new Date(details.release_date).getFullYear() : 'N/A';
            const runtime = details.runtime
                ? Math.floor(details.runtime / 60) + 'h ' + (details.runtime % 60) + 'm' : 'N/A';
            const genres = (details.genres || []).map(g =>
                '<span class="mh-genre-tag">' + this.escapeHtml(g.name) + '</span>'
            ).join('') || '<span class="mh-genre-tag">Unknown</span>';
            const overview = details.overview || 'No overview available.';

            // Certification
            let certification = '';
            if (details.release_dates && details.release_dates.results) {
                const us = details.release_dates.results.find(r => r.iso_3166_1 === 'US');
                if (us && us.release_dates && us.release_dates.length > 0) {
                    certification = us.release_dates[0].certification || '';
                }
            }

            // Director
            let director = 'N/A';
            let mainCast = [];
            if (details.credits) {
                if (details.credits.crew) {
                    const d = details.credits.crew.find(c => c.job === 'Director');
                    if (d) director = d.name;
                }
                if (details.credits.cast) mainCast = details.credits.cast.slice(0, 10);
            }

            // Similar movies
            const similarMovies = (details.similar && details.similar.results)
                ? details.similar.results.slice(0, 6) : [];

            // Status
            const inLibrary = originalMovie.in_library || false;
            let actionBtnHTML = '';
            if (inLibrary) {
                actionBtnHTML = '<span class="mh-btn mh-btn-success mh-btn-static"><i class="fas fa-check-circle"></i> Already in library</span>';
            } else {
                actionBtnHTML = '<button class="mh-btn mh-btn-primary" id="mh-btn-request"><i class="fas fa-plus-circle"></i> Add to Library</button>';
            }

            // Instance selector (Movie Hunt + Radarr); value is "mh:<id>" or "radarr:<name>"
            let instanceOpts = '';
            if (this.combinedInstances.length > 0) {
                const selectedValue = this.selectedInstanceId ? ('mh:' + this.selectedInstanceId) : '';
                instanceOpts = this.combinedInstances.map(opt => {
                    const sel = (opt.value === selectedValue) ? ' selected' : '';
                    return '<option value="' + this.escapeHtml(opt.value) + '"' + sel + '>' + this.escapeHtml(opt.label) + '</option>';
                }).join('');
            } else if (this.movieHuntInstances.length > 0) {
                instanceOpts = this.movieHuntInstances.map(inst => {
                    const sel = inst.id === this.selectedInstanceId ? ' selected' : '';
                    return '<option value="mh:' + inst.id + '"' + sel + '>' + this.escapeHtml(inst.name) + '</option>';
                }).join('');
            } else {
                instanceOpts = '<option>Loading...</option>';
            }

            return '' +
            /* ── Toolbar ── */
            '<div class="mh-toolbar">' +
                '<div class="mh-toolbar-left">' +
                    '<button class="mh-tb" id="mh-tb-back" title="Back"><i class="fas fa-arrow-left"></i></button>' +
                    /* Shown when IN collection: */
                    '<button class="mh-tb" id="mh-tb-refresh" title="Refresh" style="display:none"><i class="fas fa-redo-alt"></i><span>Refresh</span></button>' +
                    '<span id="mh-tb-force-container"></span>' +
                    /* Shown when NOT in collection: */
                    '<button class="mh-tb" id="mh-tb-search-movie" title="Search Movie" style="display:none"><i class="fas fa-search"></i><span>Search Movie</span></button>' +
                '</div>' +
                '<div class="mh-toolbar-right">' +
                    /* Shown when IN collection: */
                    '<button class="mh-tb" id="mh-tb-edit" title="Edit" style="display:none"><i class="fas fa-wrench"></i><span>Edit</span></button>' +
                    '<button class="mh-tb mh-tb-danger" id="mh-tb-delete" title="Delete" style="display:none"><i class="fas fa-trash-alt"></i></button>' +
                    /* Shown when NOT in collection: */
                    '<button class="mh-tb" id="mh-tb-hide" title="Hide from discovery" style="display:none"><i class="fas fa-eye-slash"></i></button>' +
                '</div>' +
            '</div>' +

            /* ── Hero ── */
            '<div class="mh-hero" style="background-image:url(\'' + backdropUrl + '\')">' +
                '<div class="mh-hero-grad">' +
                    '<div class="mh-hero-layout">' +
                        '<div class="mh-hero-poster">' +
                            '<img src="' + posterUrl + '" alt="' + this.escapeHtml(details.title) + '" onerror="this.src=\'./static/images/blackout.jpg\'">' +
                        '</div>' +
                        '<div class="mh-hero-info">' +
                            '<div class="mh-hero-title-row">' +
                                '<h1 class="mh-hero-title">' + this.escapeHtml(details.title) + '</h1>' +
                                '<div class="mh-hero-movie-monitor" id="mh-movie-monitor-wrap" style="display:none;">' +
                                    '<button type="button" class="mh-monitor-btn" id="mh-movie-monitor-btn" title="Toggle monitor movie">' +
                                        '<i class="fas fa-bookmark"></i>' +
                                    '</button>' +
                                '</div>' +
                            '</div>' +

                            '<div class="mh-hero-meta">' +
                                (certification ? '<span class="mh-cert">' + this.escapeHtml(certification) + '</span>' : '') +
                                '<span><i class="fas fa-calendar-alt"></i> ' + year + '</span>' +
                                '<span><i class="fas fa-clock"></i> ' + runtime + '</span>' +
                                '<span class="mh-star"><i class="fas fa-star"></i> ' + rating + '</span>' +
                            '</div>' +

                            '<div class="mh-hero-genres">' + genres + '</div>' +

                            '<div class="mh-hero-instance">' +
                                '<i class="fas fa-server"></i>' +
                                '<select id="mh-detail-instance-select">' + instanceOpts + '</select>' +
                            '</div>' +

                            /* ── Info Bar Row 1 ── */
                            '<div class="mh-info-bar" id="mh-info-bar">' +
                                '<div class="mh-ib mh-ib-path">' +
                                    '<div class="mh-ib-label">Path</div>' +
                                    '<div class="mh-ib-val" id="mh-ib-path"><i class="fas fa-spinner fa-spin"></i></div>' +
                                '</div>' +
                                '<div class="mh-ib">' +
                                    '<div class="mh-ib-label">Status</div>' +
                                    '<div class="mh-ib-val" id="mh-ib-status"><i class="fas fa-spinner fa-spin"></i></div>' +
                                '</div>' +
                                '<div class="mh-ib">' +
                                    '<div class="mh-ib-label">Quality Profile</div>' +
                                    '<div class="mh-ib-val" id="mh-ib-profile">-</div>' +
                                '</div>' +
                                '<div class="mh-ib">' +
                                    '<div class="mh-ib-label">Size</div>' +
                                    '<div class="mh-ib-val" id="mh-ib-size">-</div>' +
                                '</div>' +
                            '</div>' +
                            /* ── Info Bar Row 2 (file details, shown when downloaded) ── */
                            '<div class="mh-info-bar mh-info-bar-row2" id="mh-info-bar-row2" style="display:none">' +
                                '<div class="mh-ib">' +
                                    '<div class="mh-ib-label">Resolution</div>' +
                                    '<div class="mh-ib-val" id="mh-ib-resolution">-</div>' +
                                '</div>' +
                                '<div class="mh-ib">' +
                                    '<div class="mh-ib-label">Codec / Audio</div>' +
                                    '<div class="mh-ib-val" id="mh-ib-codec">-</div>' +
                                '</div>' +
                                '<div class="mh-ib">' +
                                    '<div class="mh-ib-label">Custom Format Score</div>' +
                                    '<div class="mh-ib-val" id="mh-ib-score">-</div>' +
                                '</div>' +
                                '<div class="mh-ib">' +
                                    '<div class="mh-ib-label">Min. Availability</div>' +
                                    '<div class="mh-ib-val" id="mh-ib-availability">-</div>' +
                                '</div>' +
                            '</div>' +

                            '<p class="mh-hero-overview">' + this.escapeHtml(overview) + '</p>' +

                            '<div class="mh-hero-actions" id="mh-detail-actions">' + actionBtnHTML + '</div>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
            '</div>' +

            /* ── Body ── */
            '<div class="mh-detail-body">' +
                /* Details */
                '<div class="mh-section">' +
                    '<h2 class="mh-section-title"><i class="fas fa-info-circle"></i> Movie Details</h2>' +
                    '<div class="mh-detail-grid">' +
                        '<div class="mh-grid-item"><div class="mh-grid-label">Director</div><div class="mh-grid-value">' + this.escapeHtml(director) + '</div></div>' +
                        '<div class="mh-grid-item"><div class="mh-grid-label">Release Date</div><div class="mh-grid-value">' + (details.release_date || 'N/A') + '</div></div>' +
                        '<div class="mh-grid-item"><div class="mh-grid-label">Rating</div><div class="mh-grid-value">' + (certification || 'Not Rated') + '</div></div>' +
                        '<div class="mh-grid-item"><div class="mh-grid-label">Budget</div><div class="mh-grid-value">' + (details.budget ? '$' + (details.budget / 1e6).toFixed(1) + 'M' : 'N/A') + '</div></div>' +
                        '<div class="mh-grid-item"><div class="mh-grid-label">Revenue</div><div class="mh-grid-value">' + (details.revenue ? '$' + (details.revenue / 1e6).toFixed(1) + 'M' : 'N/A') + '</div></div>' +
                        '<div class="mh-grid-item"><div class="mh-grid-label">Language</div><div class="mh-grid-value">' + (details.original_language ? details.original_language.toUpperCase() : 'N/A') + '</div></div>' +
                    '</div>' +
                '</div>' +

                /* Cast */
                (mainCast.length > 0 ? (
                    '<div class="mh-section">' +
                        '<h2 class="mh-section-title"><i class="fas fa-users"></i> Cast</h2>' +
                        '<div class="mh-cast-row">' + mainCast.map(a => this.renderCastCard(a)).join('') + '</div>' +
                    '</div>'
                ) : '') +

                /* Similar */
                (similarMovies.length > 0 ? (
                    '<div class="mh-section">' +
                        '<h2 class="mh-section-title"><i class="fas fa-film"></i> Similar Movies</h2>' +
                        '<div class="mh-similar-row">' + similarMovies.map(m => this.renderSimilarCard(m)).join('') + '</div>' +
                    '</div>'
                ) : '') +
            '</div>';
        },

        renderCastCard(actor) {
            const photo = actor.profile_path
                ? 'https://image.tmdb.org/t/p/w185' + actor.profile_path
                : './static/images/blackout.jpg';
            return '<div class="mh-cast-card">' +
                '<div class="mh-cast-photo"><img src="' + photo + '" alt="' + this.escapeHtml(actor.name) + '" onerror="this.src=\'./static/images/blackout.jpg\'"></div>' +
                '<div class="mh-cast-name">' + this.escapeHtml(actor.name) + '</div>' +
                '<div class="mh-cast-char">' + this.escapeHtml(actor.character || '') + '</div>' +
            '</div>';
        },

        renderSimilarCard(movie) {
            const poster = movie.poster_path
                ? 'https://image.tmdb.org/t/p/w185' + movie.poster_path
                : './static/images/blackout.jpg';
            return '<div class="mh-similar-card media-card" data-tmdb-id="' + movie.id + '">' +
                '<div class="media-card-poster"><img src="' + poster + '" alt="' + this.escapeHtml(movie.title) + '" onerror="this.src=\'./static/images/blackout.jpg\'"></div>' +
                '<div class="media-card-info">' +
                    '<div class="media-card-title">' + this.escapeHtml(movie.title) + '</div>' +
                    '<div class="media-card-meta">' +
                        '<span class="media-card-year">' + (movie.release_date ? new Date(movie.release_date).getFullYear() : 'N/A') + '</span>' +
                        '<span class="media-card-rating"><i class="fas fa-star"></i> ' + (movie.vote_average ? Number(movie.vote_average).toFixed(1) : 'N/A') + '</span>' +
                    '</div>' +
                '</div>' +
            '</div>';
        },

        /* ── Interactions ──────────────────────────────────────── */
        setupDetailInteractions() {
            const self = this;

            // Toolbar: Back
            const backBtn = document.getElementById('mh-tb-back');
            if (backBtn) backBtn.addEventListener('click', () => this.closeDetail());

            // Toolbar: Refresh
            const refreshBtn = document.getElementById('mh-tb-refresh');
            if (refreshBtn) refreshBtn.addEventListener('click', () => this.handleRefresh());

            // Toolbar: Edit
            const editBtn = document.getElementById('mh-tb-edit');
            if (editBtn) editBtn.addEventListener('click', () => this.openEditModal());

            // Toolbar: Delete
            const deleteBtn = document.getElementById('mh-tb-delete');
            if (deleteBtn) deleteBtn.addEventListener('click', () => this.openDeleteModal());

            // Toolbar: Search Movie (for items NOT in collection — requests via Requestarr modal)
            const searchMovieBtn = document.getElementById('mh-tb-search-movie');
            if (searchMovieBtn) searchMovieBtn.addEventListener('click', () => {
                const id = this.currentMovie ? (this.currentMovie.tmdb_id || this.currentMovie.id) : null;
                if (id && window.RequestarrDiscover && window.RequestarrDiscover.modal) {
                    window.RequestarrDiscover.modal.openModal(id, 'movie');
                }
            });

            // Toolbar: Hide from discovery (for items NOT in collection)
            const hideBtn = document.getElementById('mh-tb-hide');
            if (hideBtn) hideBtn.addEventListener('click', () => {
                if (!this.currentMovie || !window.MediaUtils) return;
                window.MediaUtils.hideMedia({
                    tmdbId: this.currentMovie.tmdb_id || this.currentMovie.id,
                    mediaType: 'movie',
                    title: this.currentMovie.title || 'this movie',
                    posterPath: this.currentMovie.poster_path || null,
                    appType: 'movie_hunt',
                    instanceName: '',
                    cardElement: null,
                    onHidden: () => {
                        this.closeDetail();
                    }
                });
            });

            // Monitor toggle button
            const monitorBtn = document.getElementById('mh-movie-monitor-btn');
            if (monitorBtn) {
                monitorBtn.addEventListener('click', () => this.toggleMovieMonitor());
            }

            // Instance selector (Movie Hunt: refresh status; Radarr: switch to Requestarr detail)
            const instanceSelect = document.getElementById('mh-detail-instance-select');
            if (instanceSelect) {
                instanceSelect.addEventListener('change', async () => {
                    const value = (instanceSelect.value || '').trim();
                    if (!value) return;

                    if (value.startsWith('radarr:')) {
                        const movie = this.currentMovie;
                        if (!movie) return;
                        const movieData = {
                            tmdb_id: movie.tmdb_id || movie.id,
                            id: movie.tmdb_id || movie.id,
                            title: movie.title,
                            year: movie.year,
                            poster_path: movie.poster_path,
                            backdrop_path: movie.backdrop_path,
                            overview: movie.overview,
                            vote_average: movie.vote_average,
                            in_library: movie.in_library
                        };
                        this.closeDetail(true);
                        if (window.huntarrUI && typeof window.huntarrUI.switchSection === 'function') {
                            window.huntarrUI.switchSection('requestarr-discover');
                        }
                        const RequestarrDetail = window.RequestarrDetail || (window.Requestarr && window.Requestarr.RequestarrDetail);
                        if (RequestarrDetail && typeof RequestarrDetail.openDetail === 'function') {
                            RequestarrDetail.openDetail(movieData, { suggestedInstance: value }, false);
                        }
                        return;
                    }

                    if (value.startsWith('mh:')) {
                        const instanceId = parseInt(value.slice(3), 10);
                        if (!instanceId) return;
                        this.selectedInstanceId = instanceId;
                        try {
                            await fetch('./api/movie-hunt/instances/current', {
                                method: 'PUT',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ instance_id: instanceId })
                            });
                        } catch (_) {}
                        this.updateMovieStatus();
                    }
                });
                this.updateMovieStatus();
            }

            // Request button → Requestarr modal
            const requestBtn = document.getElementById('mh-btn-request');
            if (requestBtn && this.currentMovie) {
                requestBtn.addEventListener('click', () => {
                    const tmdbId = this.currentMovie.tmdb_id || this.currentMovie.id;
                    if (tmdbId && window.RequestarrDiscover && window.RequestarrDiscover.modal) {
                        window.RequestarrDiscover.modal.openModal(tmdbId, 'movie');
                    }
                });
            }

            // ── Auto-refresh after request/edit/delete via shared event system ──
            if (window.MediaUtils) {
                window.MediaUtils.teardownDetailRefreshListeners(this._refreshHandle);
                this._refreshHandle = window.MediaUtils.setupDetailRefreshListeners({
                    getTmdbId: function() { return self.currentMovie && (self.currentMovie.tmdb_id || self.currentMovie.id); },
                    refreshCallback: function() { self.updateMovieStatus(); },
                    label: 'MovieHuntDetail'
                });
            }

            // Similar movie cards
            document.querySelectorAll('.mh-similar-card').forEach(card => {
                card.addEventListener('click', async () => {
                    const tmdbId = card.getAttribute('data-tmdb-id');
                    if (tmdbId) {
                        try {
                            const details = await this.fetchMovieDetails(tmdbId);
                            if (details) {
                                this.openDetail({
                                    tmdb_id: details.id, id: details.id,
                                    title: details.title,
                                    year: details.release_date ? new Date(details.release_date).getFullYear() : null,
                                    poster_path: details.poster_path,
                                    backdrop_path: details.backdrop_path,
                                    overview: details.overview,
                                    vote_average: details.vote_average,
                                    in_library: false
                                }, {}, false);
                            }
                        } catch (err) {
                            console.error('[MovieHuntDetail] Similar movie error:', err);
                        }
                    }
                });
            });

            // ESC to close
            const escHandler = (e) => {
                if (e.key === 'Escape') {
                    var watchModal = document.getElementById('mh-watch-player-modal');
                    if (watchModal && watchModal.classList.contains('active')) {
                        this.closeWatchPlayer();
                        return;
                    }
                    if (document.querySelector('.mh-modal-backdrop')) return;
                    this.closeDetail();
                    document.removeEventListener('keydown', escHandler);
                }
            };
            document.addEventListener('keydown', escHandler);
        },

        /* ── Monitor Toggle ─────────────────────────────────────── */
        async toggleMovieMonitor() {
            if (!this.currentMovie || !this.selectedInstanceId) return;
            const tmdbId = this.currentMovie.tmdb_id || this.currentMovie.id;
            const btn = document.getElementById('mh-movie-monitor-btn');
            if (!btn) return;

            const icon = btn.querySelector('i');
            const currentMonitored = icon && icon.classList.contains('fas');
            const newMonitored = !currentMonitored;

            // Optimistic UI update
            if (icon) icon.className = newMonitored ? 'fas fa-bookmark' : 'far fa-bookmark';

            try {
                const resp = await fetch('./api/movie-hunt/collection/' + tmdbId + '/monitor?instance_id=' + this.selectedInstanceId, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ monitored: newMonitored })
                });
                const data = await resp.json();
                if (!resp.ok || data.error) {
                    throw new Error(data.error || 'Failed to toggle monitor');
                }
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification(newMonitored ? 'Monitor on' : 'Monitor off', 'success');
                }
            } catch (e) {
                // Revert on failure
                if (icon) icon.className = currentMonitored ? 'fas fa-bookmark' : 'far fa-bookmark';
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('Failed to update monitor: ' + e.message, 'error');
                }
            }
        },

        /* ── Edit Modal ────────────────────────────────────────── */
        async openEditModal() {
            const movie = this.currentMovie;
            const status = this.currentMovieStatus;
            if (!movie) return;

            const title = this.escapeHtml(movie.title || '');
            const instanceId = this.selectedInstanceId;

            // Fetch profiles and root folders in parallel
            let profiles = [], rootFolders = [];
            try {
                const [profResp, rfResp] = await Promise.all([
                    fetch('./api/profiles?instance_id=' + instanceId),
                    fetch('./api/movie-hunt/root-folders?instance_id=' + instanceId)
                ]);
                const profData = await profResp.json();
                profiles = profData.profiles || profData || [];
                const rfData = await rfResp.json();
                rootFolders = rfData.root_folders || rfData || [];
            } catch (err) {
                console.error('[MovieHuntDetail] Edit modal fetch error:', err);
            }

            const currentProfile = (status && status.quality_profile) || '';
            const currentRoot = (status && status.root_folder_path) || '';
            const currentAvail = (status && status.minimum_availability) || 'released';

            const profileOpts = (Array.isArray(profiles) ? profiles : []).map(p => {
                const name = p.name || 'Unknown';
                const sel = name === currentProfile ? ' selected' : '';
                return '<option value="' + this.escapeHtml(name) + '"' + sel + '>' + this.escapeHtml(name) + (p.is_default ? ' (Default)' : '') + '</option>';
            }).join('');

            const rfOpts = (Array.isArray(rootFolders) ? rootFolders : []).map(rf => {
                const path = rf.path || '';
                const sel = path === currentRoot ? ' selected' : '';
                return '<option value="' + this.escapeHtml(path) + '"' + sel + '>' + this.escapeHtml(path) + (rf.is_default ? ' (Default)' : '') + '</option>';
            }).join('');

            const availOpts = [
                { value: 'announced', label: 'Announced' },
                { value: 'inCinemas', label: 'In Cinemas' },
                { value: 'released', label: 'Released' }
            ].map(a => {
                const sel = a.value === currentAvail ? ' selected' : '';
                return '<option value="' + a.value + '"' + sel + '>' + a.label + '</option>';
            }).join('');

            const html =
                '<div class="mh-modal-backdrop" id="mh-edit-modal">' +
                    '<div class="mh-modal">' +
                        '<div class="mh-modal-header">' +
                            '<h3><i class="fas fa-wrench"></i> Edit — ' + title + '</h3>' +
                            '<button class="mh-modal-x" id="mh-edit-close">&times;</button>' +
                        '</div>' +
                        '<div class="mh-modal-body">' +
                            '<div class="mh-form-row">' +
                                '<label>Root Folder</label>' +
                                '<select id="mh-edit-root-folder" class="mh-select">' + rfOpts + '</select>' +
                            '</div>' +
                            '<div class="mh-form-row">' +
                                '<label>Quality Profile</label>' +
                                '<select id="mh-edit-quality-profile" class="mh-select">' + profileOpts + '</select>' +
                            '</div>' +
                            '<div class="mh-form-row">' +
                                '<label>Minimum Availability</label>' +
                                '<select id="mh-edit-min-availability" class="mh-select">' + availOpts + '</select>' +
                            '</div>' +
                        '</div>' +
                        '<div class="mh-modal-footer">' +
                            '<button class="mh-btn mh-btn-secondary" id="mh-edit-cancel">Cancel</button>' +
                            '<button class="mh-btn mh-btn-primary" id="mh-edit-save">Save</button>' +
                        '</div>' +
                    '</div>' +
                '</div>';

            // Remove existing modal
            const existing = document.getElementById('mh-edit-modal');
            if (existing) existing.remove();

            document.body.insertAdjacentHTML('beforeend', html);

            // Wire up
            document.getElementById('mh-edit-close').addEventListener('click', () => document.getElementById('mh-edit-modal').remove());
            document.getElementById('mh-edit-cancel').addEventListener('click', () => document.getElementById('mh-edit-modal').remove());
            document.getElementById('mh-edit-modal').addEventListener('click', (e) => {
                if (e.target.id === 'mh-edit-modal') document.getElementById('mh-edit-modal').remove();
            });
            document.getElementById('mh-edit-save').addEventListener('click', () => this.handleSaveEdit());
        },

        async handleSaveEdit() {
            const movie = this.currentMovie;
            if (!movie) return;
            const tmdbId = movie.tmdb_id || movie.id;
            const rootFolder = document.getElementById('mh-edit-root-folder').value;
            const qualityProfile = document.getElementById('mh-edit-quality-profile').value;
            const minAvailability = document.getElementById('mh-edit-min-availability').value;

            const saveBtn = document.getElementById('mh-edit-save');
            if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving...'; }

            try {
                const resp = await fetch('./api/movie-hunt/collection/update?instance_id=' + this.selectedInstanceId, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ tmdb_id: tmdbId, root_folder: rootFolder, quality_profile: qualityProfile, minimum_availability: minAvailability })
                });
                const data = await resp.json();
                if (data.success) {
                    const modal = document.getElementById('mh-edit-modal');
                    if (modal) modal.remove();
                    this.updateMovieStatus(); // refresh info bar
                    // Notify all listening detail pages via shared event system
                    if (window.MediaUtils) window.MediaUtils.dispatchStatusChanged(tmdbId, 'edit');
                } else {
                    var msg = 'Save failed: ' + (data.error || 'Unknown error');
                    if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification(msg, 'error');
                    else alert(msg);
                    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
                }
            } catch (err) {
                var msg = 'Save failed: ' + err.message;
                if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification(msg, 'error');
                else alert(msg);
                if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
            }
        },

        /* ── Delete Modal (delegates to shared MovieCardDeleteModal) ── */
        openDeleteModal() {
            const movie = this.currentMovie;
            const status = this.currentMovieStatus;
            if (!movie) return;

            if (!window.MovieCardDeleteModal) {
                console.error('[MovieHuntDetail] MovieCardDeleteModal not loaded');
                return;
            }

            const hasFile = !!(status && status.has_file);
            const filePath = (status && status.path) || (status && status.root_folder_path) || '';
            const movieStatus = hasFile ? 'available' : 'requested';

            // Resolve instance name from selectedInstanceId
            let instanceName = '';
            if (this.movieHuntInstances && this.selectedInstanceId) {
                const match = this.movieHuntInstances.find(inst => inst.id === this.selectedInstanceId);
                if (match) instanceName = match.name || '';
            }

            const self = this;
            window.MovieCardDeleteModal.open(movie, {
                instanceName: instanceName,
                instanceId: this.selectedInstanceId || '',
                status: movieStatus,
                hasFile: hasFile,
                filePath: filePath,
                appType: 'movie_hunt',
                onDeleted: function() {
                    self.closeDetail();
                }
            });
        },

        /* ── Refresh ───────────────────────────────────────────── */
        async handleRefresh() {
            const btn = document.getElementById('mh-tb-refresh');
            if (btn) {
                const icon = btn.querySelector('i');
                if (icon) icon.classList.add('fa-spin');
            }
            await this.updateMovieStatus();
            if (btn) {
                const icon = btn.querySelector('i');
                if (icon) setTimeout(() => icon.classList.remove('fa-spin'), 500);
            }
        },

        /* ── Force Search ──────────────────────────────────────── */
        async handleForceSearch() {
            var movie = this.currentMovie;
            if (!movie) return;
            var btn = document.getElementById('mh-tb-force-search');
            if (btn) { btn.disabled = true; var icon = btn.querySelector('i'); if (icon) { icon.className = 'fas fa-spinner fa-spin'; } }

            var notify = function(msg, type) {
                if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification(msg, type);
                else alert(msg);
            };

            try {
                var resp = await fetch('./api/movie-hunt/request?instance_id=' + this.selectedInstanceId, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        title: movie.title || '',
                        year: movie.year || '',
                        tmdb_id: movie.tmdb_id || movie.id,
                        poster_path: movie.poster_path || '',
                        start_search: true,
                        runtime: (this.currentDetails && this.currentDetails.runtime) || 90
                    })
                });
                var data = await resp.json();
                if (data.success) {
                    notify('Search complete — ' + (data.message || 'Sent to download client.'), 'success');
                } else {
                    notify(data.message || 'No matching release found.', 'error');
                }
            } catch (err) {
                notify('Search failed: ' + err.message, 'error');
            }

            if (btn) { btn.disabled = false; var icon = btn.querySelector('i'); if (icon) { icon.className = 'fas fa-search'; } }
            this.updateMovieStatus();
            if (window.MediaUtils) window.MediaUtils.dispatchStatusChanged(movie.tmdb_id || movie.id, 'force-search');
        },

        /* ── Force Upgrade ─────────────────────────────────────── */
        async handleForceUpgrade() {
            var movie = this.currentMovie;
            var status = this.currentMovieStatus;
            if (!movie) return;
            var btn = document.getElementById('mh-tb-force-upgrade');
            if (btn) { btn.disabled = true; var icon = btn.querySelector('i'); if (icon) { icon.className = 'fas fa-spinner fa-spin'; } }

            var notify = function(msg, type) {
                if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification(msg, type);
                else alert(msg);
            };

            try {
                var currentScore = (status && status.file_score != null) ? status.file_score : 0;
                var resp = await fetch('./api/movie-hunt/force-upgrade?instance_id=' + this.selectedInstanceId, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        title: movie.title || '',
                        year: movie.year || '',
                        tmdb_id: movie.tmdb_id || movie.id,
                        current_score: currentScore,
                        quality_profile: (status && status.quality_profile) || '',
                        runtime: (this.currentDetails && this.currentDetails.runtime) || 90
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

            if (btn) { btn.disabled = false; var icon = btn.querySelector('i'); if (icon) { icon.className = 'fas fa-arrow-circle-up'; } }
            this.updateMovieStatus();
            if (window.MediaUtils) window.MediaUtils.dispatchStatusChanged(movie.tmdb_id || movie.id, 'force-upgrade');
        },

        /* ── Status ────────────────────────────────────────────── */
        async loadMovieHuntInstances() {
            try {
                const resp = await fetch('./api/movie-hunt/instances');
                const data = await resp.json();
                if (data.instances && data.instances.length > 0) {
                    this.movieHuntInstances = data.instances;
                    if (!this.selectedInstanceId) {
                        const cur = await fetch('./api/movie-hunt/instances/current');
                        const curData = await cur.json();
                        this.selectedInstanceId = curData.current_instance_id || this.movieHuntInstances[0].id;
                    }
                } else {
                    this.movieHuntInstances = [];
                    this.selectedInstanceId = null;
                }
            } catch (err) {
                console.error('[MovieHuntDetail] Instances error:', err);
                this.movieHuntInstances = [];
                this.selectedInstanceId = null;
            }
        },

        async loadCombinedInstances() {
            const combined = [];
            this.movieHuntInstances.forEach(inst => {
                combined.push({
                    type: 'movie_hunt',
                    value: 'mh:' + inst.id,
                    label: 'Movie Hunt – ' + (inst.name || ''),
                    id: inst.id,
                    name: inst.name
                });
            });
            try {
                const resp = await fetch('./api/requestarr/instances/radarr');
                const data = await resp.json();
                if (data.instances && data.instances.length > 0) {
                    data.instances.forEach(inst => {
                        const name = inst.name || '';
                        combined.push({
                            type: 'radarr',
                            value: 'radarr:' + name,
                            label: 'Radarr – ' + name,
                            name: name
                        });
                    });
                }
            } catch (err) {
                console.warn('[MovieHuntDetail] Could not load Radarr instances for dropdown:', err);
            }
            this.combinedInstances = combined;
        },

        async checkMovieStatus(tmdbId, instanceId) {
            if (!instanceId) return { in_library: false };
            try {
                const resp = await fetch('./api/movie-hunt/collection?instance_id=' + instanceId);
                const data = await resp.json();
                const items = data.items || [];
                const movie = items.find(item => item.tmdb_id === tmdbId);
                if (movie) return { in_library: movie.status === 'available' };
                return { in_library: false };
            } catch (err) {
                return { in_library: false };
            }
        },

        async updateMovieStatus() {
            if (!this.currentMovie || !this.selectedInstanceId) return;
            const tmdbId = this.currentMovie.tmdb_id || this.currentMovie.id;

            // Phase 1: Quick load without probe (instant response)
            const data = await this.fetchMovieHuntStatus(tmdbId, this.selectedInstanceId, true);
            const isDownloaded = data && data.found && (data.status || '').toLowerCase() === 'downloaded';
            
            // A movie is "found" if the API says so, OR if it's already downloaded/in-library
            const isFound = !!(data && (data.found || (data.status && data.status !== '')));

            // Phase 2: If movie has a file and probe is pending, trigger the actual scan
            if (data && data.has_file && data.probe_status === 'pending') {
                this._triggerProbe(tmdbId, this.selectedInstanceId);
            }

            // Update toolbar management buttons visibility
            const editBtn = document.getElementById('mh-tb-edit');
            const deleteBtn = document.getElementById('mh-tb-delete');
            const refreshBtn = document.getElementById('mh-tb-refresh');
            if (editBtn) editBtn.style.display = isFound ? '' : 'none';
            if (deleteBtn) deleteBtn.style.display = isFound ? '' : 'none';
            if (refreshBtn) refreshBtn.style.display = isFound ? '' : 'none';

            // Monitor toggle — show only when movie is in the collection
            const monitorWrap = document.getElementById('mh-movie-monitor-wrap');
            const monitorBtn = document.getElementById('mh-movie-monitor-btn');
            if (monitorWrap && monitorBtn) {
                if (isFound) {
                    monitorWrap.style.display = '';
                    const monitored = data ? data.monitored !== false : true;
                    const icon = monitorBtn.querySelector('i');
                    if (icon) icon.className = monitored ? 'fas fa-bookmark' : 'far fa-bookmark';
                } else {
                    monitorWrap.style.display = 'none';
                }
            }

            // Not-in-collection buttons
            const searchMovieBtn = document.getElementById('mh-tb-search-movie');
            const hideBtn = document.getElementById('mh-tb-hide');
            if (searchMovieBtn) searchMovieBtn.style.display = isFound ? 'none' : '';
            if (hideBtn) hideBtn.style.display = isFound ? 'none' : '';

            // Update action button — Watch when downloaded, Add to Library when not
            const actionsContainer = document.getElementById('mh-detail-actions');
            if (actionsContainer) {
                var isRequested = data && data.found && !isDownloaded;
                var hasFile = !!(data && data.has_file);
                if (isDownloaded && hasFile) {
                    actionsContainer.innerHTML = '<button class="mh-btn mh-btn-watch" id="mh-btn-watch"><i class="fas fa-play"></i> Watch</button>';
                    const watchBtn = document.getElementById('mh-btn-watch');
                    if (watchBtn) watchBtn.addEventListener('click', () => this.openWatchPlayer());
                } else if (isDownloaded || isRequested) {
                    actionsContainer.innerHTML = '';
                } else {
                    actionsContainer.innerHTML = '<button class="mh-btn mh-btn-primary" id="mh-btn-request"><i class="fas fa-plus-circle"></i> Add to Library</button>';
                    const requestBtn = document.getElementById('mh-btn-request');
                    if (requestBtn) {
                        requestBtn.addEventListener('click', () => {
                            const id = this.currentMovie.tmdb_id || this.currentMovie.id;
                            if (id && window.RequestarrDiscover && window.RequestarrDiscover.modal) {
                                window.RequestarrDiscover.modal.openModal(id, 'movie');
                            }
                        });
                    }
                }
            }

            // Update toolbar Force Search / Force Upgrade button
            const forceContainer = document.getElementById('mh-tb-force-container');
            if (forceContainer) {
                if (isDownloaded) {
                    forceContainer.innerHTML = '<button class="mh-tb" id="mh-tb-force-upgrade" title="Search for a higher-scoring release"><i class="fas fa-arrow-circle-up"></i><span>Force Upgrade</span></button>';
                    var upgradeBtn = document.getElementById('mh-tb-force-upgrade');
                    if (upgradeBtn) upgradeBtn.addEventListener('click', () => this.handleForceUpgrade());
                } else if (data && data.found) {
                    forceContainer.innerHTML = '<button class="mh-tb" id="mh-tb-force-search" title="Search indexers and download"><i class="fas fa-search"></i><span>Force Search</span></button>';
                    var searchBtn = document.getElementById('mh-tb-force-search');
                    if (searchBtn) searchBtn.addEventListener('click', () => this.handleForceSearch());
                } else {
                    forceContainer.innerHTML = '';
                }
            }
        },

        async fetchMovieHuntStatus(tmdbId, instanceId, skipProbe) {
            try {
                var url = './api/movie-hunt/movie-status?tmdb_id=' + tmdbId + '&instance_id=' + instanceId;
                if (skipProbe) url += '&skip_probe=true';
                const resp = await fetch(url);
                const data = await resp.json();
                this.currentMovieStatus = data;

                const pathEl = document.getElementById('mh-ib-path');
                const statusEl = document.getElementById('mh-ib-status');
                const profileEl = document.getElementById('mh-ib-profile');
                const sizeEl = document.getElementById('mh-ib-size');

                if (!data.success || !data.found) {
                    if (pathEl) pathEl.textContent = '-';
                    if (statusEl) statusEl.innerHTML = '<span class="mh-badge mh-badge-none">Not in Collection</span>';
                    if (profileEl) profileEl.textContent = '-';
                    if (sizeEl) sizeEl.textContent = '-';
                    return data;
                }

                // Path
                if (pathEl) {
                    const pathText = data.path || data.root_folder_path || '-';
                    pathEl.textContent = pathText;
                    pathEl.title = pathText;
                }

                // Status badge (use "Already in library" when downloaded)
                if (statusEl) {
                    let cls = '', icon = '', label = '';
                    if (data.status === 'downloaded') {
                        cls = 'mh-badge-ok'; icon = 'fa-check-circle'; label = 'Already in library';
                    } else if (data.status === 'missing') {
                        cls = 'mh-badge-warn'; icon = 'fa-exclamation-circle'; label = 'Requested';
                    } else {
                        cls = 'mh-badge-warn'; icon = 'fa-clock'; label = 'Requested';
                    }
                    statusEl.innerHTML = '<span class="mh-badge ' + cls + '"><i class="fas ' + icon + '"></i> ' + label + '</span>';
                }

                // Quality Profile
                if (profileEl) profileEl.textContent = data.quality_profile || '-';

                // Size
                if (sizeEl) sizeEl.textContent = this.formatFileSize(data.file_size || 0);

                // File quality badge (append to size)
                if (data.file_quality && sizeEl) {
                    sizeEl.innerHTML = this.formatFileSize(data.file_size || 0) +
                        ' <span class="mh-badge mh-badge-quality">' + this.escapeHtml(data.file_quality) + '</span>';
                }

                // Row 2: resolution, codec, score, availability (only for downloaded files)
                var row2 = document.getElementById('mh-info-bar-row2');
                if (data.has_file && row2) {
                    row2.style.display = '';
                    var resEl = document.getElementById('mh-ib-resolution');
                    var codecEl = document.getElementById('mh-ib-codec');
                    var scoreEl = document.getElementById('mh-ib-score');
                    var availEl = document.getElementById('mh-ib-availability');

                    // Show probe-status-aware content for resolution and codec
                    var probeStatus = data.probe_status || '';
                    if (probeStatus === 'pending') {
                        // Phase 1: haven't probed yet, show "Pending"
                        if (resEl) resEl.innerHTML = '<span class="mh-probe-badge mh-probe-pending"><i class="fas fa-clock"></i> Pending</span>';
                        if (codecEl) codecEl.innerHTML = '<span class="mh-probe-badge mh-probe-pending"><i class="fas fa-clock"></i> Pending</span>';
                    } else if (probeStatus === 'failed') {
                        var resText = data.file_resolution || '';
                        var codecText = (data.file_codec && data.file_codec !== '-') ? data.file_codec : '';
                        if (resEl) resEl.innerHTML = resText
                            ? this._wrapRescannable(this.escapeHtml(resText), 'mh-probe-failed')
                            : this._wrapRescannable('<i class="fas fa-exclamation-triangle"></i> Failed', 'mh-probe-failed');
                        if (codecEl) codecEl.innerHTML = codecText
                            ? this._wrapRescannable(this.escapeHtml(codecText), 'mh-probe-failed')
                            : this._wrapRescannable('<i class="fas fa-exclamation-triangle"></i> Failed', 'mh-probe-failed');
                    } else if (probeStatus === 'disabled') {
                        // Analyze off — show filename-based data, no rescan
                        if (resEl) resEl.textContent = data.file_resolution || '-';
                        if (codecEl) {
                            var codecStr = this._buildCodecString(data);
                            codecEl.textContent = codecStr || '-';
                        }
                    } else {
                        // cached, scanned, or filename — show data with rescan on hover
                        var resText = data.file_resolution || '-';
                        var codecStr = this._buildCodecString(data);
                        if (resEl) resEl.innerHTML = this._wrapRescannable(this.escapeHtml(resText));
                        if (codecEl) codecEl.innerHTML = this._wrapRescannable(this.escapeHtml(codecStr || '-'));
                    }
                    // Bind rescan click handlers on the row
                    this._bindRescanHandlers();

                    // Score with hover tooltip
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

                    // Minimum availability
                    if (availEl) {
                        var avail = data.minimum_availability || 'released';
                        var availMap = { 'announced': 'Announced', 'inCinemas': 'In Cinemas', 'released': 'Released' };
                        availEl.textContent = availMap[avail] || avail;
                    }
                } else if (row2) {
                    // Show row 2 with just availability for non-downloaded movies
                    if (data.found) {
                        row2.style.display = '';
                        var resEl = document.getElementById('mh-ib-resolution');
                        var codecEl = document.getElementById('mh-ib-codec');
                        var scoreEl = document.getElementById('mh-ib-score');
                        var availEl = document.getElementById('mh-ib-availability');
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

                return data;
            } catch (err) {
                console.error('[MovieHuntDetail] Status fetch error:', err);
                return null;
            }
        },

        /* ── Probe helpers ─────────────────────────────────────── */

        _wrapRescannable(innerHtml, badgeClass) {
            // Wrap content in a clickable rescan container with a subtle icon on hover
            var cls = 'mh-probe-badge mh-rescannable';
            if (badgeClass) cls += ' ' + badgeClass;
            return '<span class="' + cls + '" title="Click to rescan">' +
                '<span class="mh-rescan-content">' + innerHtml + '</span>' +
                '<i class="fas fa-redo-alt mh-rescan-icon"></i>' +
                '</span>';
        },

        _bindRescanHandlers() {
            var self = this;
            var btns = document.querySelectorAll('#mh-info-bar-row2 .mh-rescannable');
            btns.forEach(function(btn) {
                if (btn._rescanBound) return;
                btn._rescanBound = true;
                btn.addEventListener('click', function() {
                    if (!self.currentMovie || !self.selectedInstanceId) return;
                    var tmdbId = self.currentMovie.tmdb_id || self.currentMovie.id;
                    self._triggerForceProbe(tmdbId, self.selectedInstanceId);
                });
            });
        },

        async _triggerForceProbe(tmdbId, instanceId) {
            // Show "Scanning" while waiting for the force re-probe
            var resEl = document.getElementById('mh-ib-resolution');
            var codecEl = document.getElementById('mh-ib-codec');
            if (resEl) resEl.innerHTML = '<span class="mh-probe-badge mh-probe-scanning"><i class="fas fa-spinner fa-spin"></i> Scanning</span>';
            if (codecEl) codecEl.innerHTML = '<span class="mh-probe-badge mh-probe-scanning"><i class="fas fa-spinner fa-spin"></i> Scanning</span>';

            // Force re-probe (skip cache)
            try {
                var url = './api/movie-hunt/movie-status?tmdb_id=' + tmdbId + '&instance_id=' + instanceId + '&force_probe=true';
                var resp = await fetch(url);
                var data = await resp.json();
                this.currentMovieStatus = data;

                // Update resolution/codec/score cells with fresh data
                if (data && data.has_file) {
                    var probeStatus = data.probe_status || '';
                    if (probeStatus === 'failed') {
                        var resText = data.file_resolution || '';
                        var codecText = (data.file_codec && data.file_codec !== '-') ? data.file_codec : '';
                        if (resEl) resEl.innerHTML = resText
                            ? this._wrapRescannable(this.escapeHtml(resText), 'mh-probe-failed')
                            : this._wrapRescannable('<i class="fas fa-exclamation-triangle"></i> Failed', 'mh-probe-failed');
                        if (codecEl) codecEl.innerHTML = codecText
                            ? this._wrapRescannable(this.escapeHtml(codecText), 'mh-probe-failed')
                            : this._wrapRescannable('<i class="fas fa-exclamation-triangle"></i> Failed', 'mh-probe-failed');
                    } else {
                        var resText = data.file_resolution || '-';
                        var codecStr = this._buildCodecString(data);
                        if (resEl) resEl.innerHTML = this._wrapRescannable(this.escapeHtml(resText));
                        if (codecEl) codecEl.innerHTML = this._wrapRescannable(this.escapeHtml(codecStr || '-'));
                    }
                    this._bindRescanHandlers();

                    // Update score (may have changed due to probe-enriched scoring)
                    var scoreEl = document.getElementById('mh-ib-score');
                    if (scoreEl) {
                        var scoreVal = data.file_score;
                        if (scoreVal != null) {
                            var scoreClass = scoreVal >= 0 ? 'mh-score-pos' : 'mh-score-neg';
                            var breakdown = data.file_score_breakdown || 'No custom format matches';
                            scoreEl.innerHTML = '<span class="mh-score-badge ' + scoreClass + '" title="' + this.escapeHtml(breakdown) + '">' + scoreVal + '</span>';
                        }
                    }
                }
            } catch (err) {
                console.error('[MovieHuntDetail] Force probe error:', err);
                if (resEl) resEl.innerHTML = this._wrapRescannable('<i class="fas fa-exclamation-triangle"></i> Error', 'mh-probe-failed');
                if (codecEl) codecEl.innerHTML = this._wrapRescannable('<i class="fas fa-exclamation-triangle"></i> Error', 'mh-probe-failed');
                this._bindRescanHandlers();
            }
        },

        _buildCodecString(data) {
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
                return parts.join(' / ');
            }
            return data.file_codec || '-';
        },

        async _triggerProbe(tmdbId, instanceId) {
            // Show "Scanning" while waiting for the full probe
            var resEl = document.getElementById('mh-ib-resolution');
            var codecEl = document.getElementById('mh-ib-codec');
            if (resEl) resEl.innerHTML = '<span class="mh-probe-badge mh-probe-scanning"><i class="fas fa-spinner fa-spin"></i> Scanning</span>';
            if (codecEl) codecEl.innerHTML = '<span class="mh-probe-badge mh-probe-scanning"><i class="fas fa-spinner fa-spin"></i> Scanning</span>';

            // Phase 2: full probe request (may take a few seconds)
            var data = await this.fetchMovieHuntStatus(tmdbId, instanceId, false);

            // fetchMovieHuntStatus already updates the DOM with results or "Failed"
        },

        /* ── Utilities ─────────────────────────────────────────── */
        formatFileSize(bytes) {
            if (!bytes || bytes === 0) return '0 B';
            if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(1) + ' GB';
            if (bytes >= 1048576) return (bytes / 1048576).toFixed(0) + ' MB';
            return (bytes / 1024).toFixed(0) + ' KB';
        },

        getLoadingHTML() {
            return '<div class="mh-toolbar"><div class="mh-toolbar-left"><button class="mh-tb" id="mh-tb-back" title="Back"><i class="fas fa-arrow-left"></i></button></div><div class="mh-toolbar-right"></div></div>' +
                '<div class="movie-detail-loading"><i class="fas fa-spinner fa-spin"></i><p>Loading movie details...</p></div>';
        },

        getErrorHTML(message) {
            return '<div class="mh-toolbar"><div class="mh-toolbar-left"><button class="mh-tb" id="mh-tb-back" title="Back"><i class="fas fa-arrow-left"></i></button></div><div class="mh-toolbar-right"></div></div>' +
                '<div class="movie-detail-loading"><i class="fas fa-exclamation-triangle" style="color:#ef4444"></i><p style="color:#ef4444">' + this.escapeHtml(message) + '</p></div>';
        },

        escapeHtml(text) {
            if (!text) return '';
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
    };

    // Initialize
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => window.MovieHuntDetail.init());
    } else {
        window.MovieHuntDetail.init();
    }
})();
