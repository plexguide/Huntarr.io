/**
 * Movie Hunt Detail Page – Modern movie detail view with management toolbar
 * Inspired by Radarr's movie detail but modernized for Movie Hunt
 */
(function() {
    'use strict';

    window.MovieHuntDetail = {
        currentMovie: null,
        currentDetails: null,
        currentMovieStatus: null,
        tmdbApiKey: null,
        movieHuntInstances: [],
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
                        in_library: false, in_cooldown: false
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

            let detailView = document.getElementById('movie-hunt-detail-view');
            if (!detailView) {
                detailView = document.createElement('div');
                detailView.id = 'movie-hunt-detail-view';
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
            const detailView = document.getElementById('movie-hunt-detail-view');
            if (detailView) detailView.classList.remove('active');
            if (!fromHistory) history.back();
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
            const inCooldown = originalMovie.in_cooldown || false;
            let actionBtnHTML = '';
            if (inLibrary) {
                actionBtnHTML = '<button class="mh-btn mh-btn-success" disabled><i class="fas fa-check"></i> Available</button>';
            } else if (inCooldown) {
                actionBtnHTML = '<button class="mh-btn mh-btn-warning" disabled><i class="fas fa-clock"></i> Cooldown</button>';
            } else {
                actionBtnHTML = '<button class="mh-btn mh-btn-primary" id="mh-btn-request"><i class="fas fa-download"></i> Request Movie</button>';
            }

            // Instance selector
            let instanceOpts = '';
            if (this.movieHuntInstances.length > 0) {
                instanceOpts = this.movieHuntInstances.map(inst => {
                    const sel = inst.id === this.selectedInstanceId ? ' selected' : '';
                    return '<option value="' + inst.id + '"' + sel + '>' + this.escapeHtml(inst.name) + '</option>';
                }).join('');
            } else {
                instanceOpts = '<option>Loading...</option>';
            }

            return '' +
            /* ── Toolbar ── */
            '<div class="mh-toolbar">' +
                '<div class="mh-toolbar-left">' +
                    '<button class="mh-tb" id="mh-tb-back" title="Back"><i class="fas fa-arrow-left"></i></button>' +
                    '<button class="mh-tb" id="mh-tb-refresh" title="Refresh &amp; Scan"><i class="fas fa-redo-alt"></i><span>Refresh</span></button>' +
                    '<button class="mh-tb" id="mh-tb-search" title="Search &amp; Download"><i class="fas fa-search"></i><span>Search Movie</span></button>' +
                    '<button class="mh-tb" id="mh-tb-interactive" title="Interactive Search"><i class="fas fa-user-astronaut"></i><span>Interactive Search</span></button>' +
                '</div>' +
                '<div class="mh-toolbar-right">' +
                    '<button class="mh-tb" id="mh-tb-edit" title="Edit"><i class="fas fa-wrench"></i><span>Edit</span></button>' +
                    '<button class="mh-tb mh-tb-danger" id="mh-tb-delete" title="Delete"><i class="fas fa-trash-alt"></i></button>' +
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
                            '<h1 class="mh-hero-title">' + this.escapeHtml(details.title) + '</h1>' +

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

                            /* ── Info Bar (integrated into hero) ── */
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

            // Toolbar: Search Movie
            const searchBtn = document.getElementById('mh-tb-search');
            if (searchBtn) searchBtn.addEventListener('click', () => {
                if (window.MovieHunt && window.MovieHunt.openMovieHuntRequestModal && this.currentMovie) {
                    window.MovieHunt.openMovieHuntRequestModal(this.currentMovie);
                }
            });

            // Toolbar: Interactive Search (opens search with results visible — same as Search for now)
            const interactiveBtn = document.getElementById('mh-tb-interactive');
            if (interactiveBtn) interactiveBtn.addEventListener('click', () => {
                if (window.MovieHunt && window.MovieHunt.openMovieHuntRequestModal && this.currentMovie) {
                    window.MovieHunt.openMovieHuntRequestModal(this.currentMovie);
                }
            });

            // Toolbar: Edit
            const editBtn = document.getElementById('mh-tb-edit');
            if (editBtn) editBtn.addEventListener('click', () => this.openEditModal());

            // Toolbar: Delete
            const deleteBtn = document.getElementById('mh-tb-delete');
            if (deleteBtn) deleteBtn.addEventListener('click', () => this.openDeleteModal());

            // Instance selector
            const instanceSelect = document.getElementById('mh-detail-instance-select');
            if (instanceSelect) {
                instanceSelect.addEventListener('change', async () => {
                    const instanceId = parseInt(instanceSelect.value, 10);
                    if (!instanceId) return;
                    this.selectedInstanceId = instanceId;
                    try {
                        await fetch('./api/movie-hunt/current-instance', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ instance_id: instanceId })
                        });
                    } catch (_) {}
                    this.updateMovieStatus();
                });
                this.updateMovieStatus();
            }

            // Request button
            const requestBtn = document.getElementById('mh-btn-request');
            if (requestBtn && this.currentMovie) {
                requestBtn.addEventListener('click', () => {
                    if (window.MovieHunt && window.MovieHunt.openMovieHuntRequestModal) {
                        window.MovieHunt.openMovieHuntRequestModal(this.currentMovie);
                    }
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
                    // Don't close if a modal is open
                    if (document.querySelector('.mh-modal-backdrop')) return;
                    this.closeDetail();
                    document.removeEventListener('keydown', escHandler);
                }
            };
            document.addEventListener('keydown', escHandler);
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

            const saveBtn = document.getElementById('mh-edit-save');
            if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving...'; }

            try {
                const resp = await fetch('./api/movie-hunt/collection/update?instance_id=' + this.selectedInstanceId, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ tmdb_id: tmdbId, root_folder: rootFolder, quality_profile: qualityProfile })
                });
                const data = await resp.json();
                if (data.success) {
                    const modal = document.getElementById('mh-edit-modal');
                    if (modal) modal.remove();
                    this.updateMovieStatus(); // refresh info bar
                } else {
                    alert('Save failed: ' + (data.error || 'Unknown error'));
                    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
                }
            } catch (err) {
                alert('Save failed: ' + err.message);
                if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
            }
        },

        /* ── Delete Modal ──────────────────────────────────────── */
        openDeleteModal() {
            const movie = this.currentMovie;
            const status = this.currentMovieStatus;
            if (!movie) return;

            const title = this.escapeHtml(movie.title || '');
            const year = movie.year || '';
            const path = (status && status.root_folder_path) || (status && status.path) || '';
            const hasFile = status && status.has_file;
            const folderDisplay = path
                ? this.escapeHtml(path)
                : (movie.title ? this.escapeHtml(movie.title + (year ? ' (' + year + ')' : '')) : 'Unknown');

            const html =
                '<div class="mh-modal-backdrop" id="mh-delete-modal">' +
                    '<div class="mh-modal">' +
                        '<div class="mh-modal-header mh-modal-header-danger">' +
                            '<h3><i class="fas fa-trash-alt"></i> Delete — ' + title + '</h3>' +
                            '<button class="mh-modal-x" id="mh-delete-close">&times;</button>' +
                        '</div>' +
                        '<div class="mh-modal-body">' +
                            '<div class="mh-delete-path"><i class="fas fa-folder"></i> ' + folderDisplay + '</div>' +
                            '<label class="mh-check-row">' +
                                '<input type="checkbox" id="mh-delete-blocklist" checked>' +
                                '<div><strong>Add to Blocklist</strong><div class="mh-help">Prevent movie from being re-added by import lists</div></div>' +
                            '</label>' +
                            (hasFile ? (
                                '<label class="mh-check-row">' +
                                    '<input type="checkbox" id="mh-delete-files">' +
                                    '<div><strong>Delete Movie Files</strong><div class="mh-help">Delete the movie files and movie folder</div></div>' +
                                '</label>'
                            ) : '') +
                        '</div>' +
                        '<div class="mh-modal-footer">' +
                            '<button class="mh-btn mh-btn-secondary" id="mh-delete-cancel">Close</button>' +
                            '<button class="mh-btn mh-btn-danger" id="mh-delete-confirm">Delete</button>' +
                        '</div>' +
                    '</div>' +
                '</div>';

            const existing = document.getElementById('mh-delete-modal');
            if (existing) existing.remove();

            document.body.insertAdjacentHTML('beforeend', html);

            document.getElementById('mh-delete-close').addEventListener('click', () => document.getElementById('mh-delete-modal').remove());
            document.getElementById('mh-delete-cancel').addEventListener('click', () => document.getElementById('mh-delete-modal').remove());
            document.getElementById('mh-delete-modal').addEventListener('click', (e) => {
                if (e.target.id === 'mh-delete-modal') document.getElementById('mh-delete-modal').remove();
            });
            document.getElementById('mh-delete-confirm').addEventListener('click', () => this.handleDelete());
        },

        async handleDelete() {
            const movie = this.currentMovie;
            if (!movie) return;
            const tmdbId = movie.tmdb_id || movie.id;
            const title = movie.title || '';
            const year = movie.year || '';
            const addToBlocklist = document.getElementById('mh-delete-blocklist')
                ? document.getElementById('mh-delete-blocklist').checked : false;
            const deleteFiles = document.getElementById('mh-delete-files')
                ? document.getElementById('mh-delete-files').checked : false;

            const delBtn = document.getElementById('mh-delete-confirm');
            if (delBtn) { delBtn.disabled = true; delBtn.textContent = 'Deleting...'; }

            try {
                const resp = await fetch('./api/movie-hunt/collection/remove?instance_id=' + this.selectedInstanceId, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        tmdb_id: tmdbId, title: title, year: String(year),
                        add_to_blocklist: addToBlocklist, delete_files: deleteFiles
                    })
                });
                const data = await resp.json();
                if (data.success) {
                    const modal = document.getElementById('mh-delete-modal');
                    if (modal) modal.remove();
                    this.closeDetail();
                } else {
                    alert('Delete failed: ' + (data.error || 'Unknown error'));
                    if (delBtn) { delBtn.disabled = false; delBtn.textContent = 'Delete'; }
                }
            } catch (err) {
                alert('Delete failed: ' + err.message);
                if (delBtn) { delBtn.disabled = false; delBtn.textContent = 'Delete'; }
            }
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

        /* ── Status ────────────────────────────────────────────── */
        async loadMovieHuntInstances() {
            try {
                const resp = await fetch('./api/movie-hunt/instances');
                const data = await resp.json();
                if (data.instances && data.instances.length > 0) {
                    this.movieHuntInstances = data.instances;
                    if (!this.selectedInstanceId) {
                        const cur = await fetch('./api/movie-hunt/current-instance');
                        const curData = await cur.json();
                        this.selectedInstanceId = curData.instance_id || this.movieHuntInstances[0].id;
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

            // Update action button
            const status = await this.checkMovieStatus(tmdbId, this.selectedInstanceId);
            const actionsContainer = document.getElementById('mh-detail-actions');
            if (actionsContainer) {
                let btn = '';
                if (status.in_library) {
                    btn = '<button class="mh-btn mh-btn-success" disabled><i class="fas fa-check"></i> Available</button>';
                } else {
                    btn = '<button class="mh-btn mh-btn-primary" id="mh-btn-request"><i class="fas fa-download"></i> Request Movie</button>';
                }
                actionsContainer.innerHTML = btn;
                const requestBtn = document.getElementById('mh-btn-request');
                if (requestBtn) {
                    requestBtn.addEventListener('click', () => {
                        if (window.MovieHunt && window.MovieHunt.openMovieHuntRequestModal) {
                            window.MovieHunt.openMovieHuntRequestModal(this.currentMovie);
                        }
                    });
                }
            }

            // Fetch and update inline info bar
            this.fetchMovieHuntStatus(tmdbId, this.selectedInstanceId);
        },

        async fetchMovieHuntStatus(tmdbId, instanceId) {
            try {
                const resp = await fetch('./api/movie-hunt/movie-status?tmdb_id=' + tmdbId + '&instance_id=' + instanceId);
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
                    return;
                }

                // Path
                if (pathEl) {
                    const pathText = data.path || data.root_folder_path || '-';
                    pathEl.textContent = pathText;
                    pathEl.title = pathText;
                }

                // Status badge
                if (statusEl) {
                    let cls = '', icon = '', label = '';
                    if (data.status === 'downloaded') {
                        cls = 'mh-badge-ok'; icon = 'fa-check-circle'; label = 'Downloaded';
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
            } catch (err) {
                console.error('[MovieHuntDetail] Status fetch error:', err);
            }
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
