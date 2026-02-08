/**
 * Requestarr Movie Detail Page – Uses shared mh-* styling from Movie Hunt
 * Handles Radarr instances and movie status checking
 */
(function() {
    'use strict';

    window.RequestarrDetail = {
        currentMovie: null,
        tmdbApiKey: null,
        radarrInstances: [],
        selectedInstanceName: null,

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

            if (this.radarrInstances.length === 0) {
                await this.loadRadarrInstances();
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

        async loadRadarrInstances() {
            try {
                const response = await fetch('./api/requestarr/instances/radarr');
                const data = await response.json();

                if (data.instances && data.instances.length > 0) {
                    this.radarrInstances = data.instances;

                    if (this.options.suggestedInstance) {
                        this.selectedInstanceName = this.options.suggestedInstance;
                    } else if (!this.selectedInstanceName) {
                        this.selectedInstanceName = this.radarrInstances[0].name;
                    }
                } else {
                    this.radarrInstances = [];
                    this.selectedInstanceName = null;
                }
            } catch (error) {
                console.error('[RequestarrDetail] Error loading Radarr instances:', error);
                this.radarrInstances = [];
                this.selectedInstanceName = null;
            }
        },

        async checkMovieStatus(tmdbId, instanceName) {
            if (!instanceName) return { in_library: false, in_cooldown: false };

            try {
                const response = await fetch(`./api/requestarr/movie-status?tmdb_id=${tmdbId}&instance=${encodeURIComponent(instanceName)}`);
                const data = await response.json();

                return {
                    in_library: data.in_library || false,
                    in_cooldown: (data.cooldown_status && data.cooldown_status.in_cooldown) || false
                };
            } catch (error) {
                console.error('[RequestarrDetail] Error checking movie status:', error);
                return { in_library: false, in_cooldown: false };
            }
        },

        async updateMovieStatus() {
            if (!this.currentMovie || !this.selectedInstanceName) return;

            const tmdbId = this.currentMovie.tmdb_id || this.currentMovie.id;
            const status = await this.checkMovieStatus(tmdbId, this.selectedInstanceName);

            const actionsContainer = document.querySelector('.mh-hero-actions');
            if (actionsContainer) {
                let actionButton = '';

                if (status.in_library) {
                    actionButton = '<button class="mh-btn mh-btn-success" disabled><i class="fas fa-check"></i> Already Available</button>';
                } else if (status.in_cooldown) {
                    actionButton = '<button class="mh-btn mh-btn-warning" disabled><i class="fas fa-clock"></i> In Cooldown</button>';
                } else {
                    actionButton = '<button class="mh-btn mh-btn-primary" id="requestarr-detail-request-btn"><i class="fas fa-download"></i> Request Movie</button>';
                }

                actionsContainer.innerHTML = actionButton;

                const requestBtn = document.getElementById('requestarr-detail-request-btn');
                if (requestBtn) {
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
            const inLibrary = originalMovie.in_library || false;
            const inCooldown = originalMovie.in_cooldown || false;
            let actionButton = '';

            if (inLibrary) {
                actionButton = '<button class="mh-btn mh-btn-success" disabled><i class="fas fa-check"></i> Already Available</button>';
            } else if (inCooldown) {
                actionButton = '<button class="mh-btn mh-btn-warning" disabled><i class="fas fa-clock"></i> In Cooldown</button>';
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

            // Instance selector
            let instanceSelectorHTML = '';
            if (this.radarrInstances.length > 0) {
                instanceSelectorHTML = `
                    <div class="mh-hero-instance">
                        <i class="fas fa-server"></i>
                        <select id="requestarr-detail-instance-select">
                            ${this.radarrInstances.map(instance => {
                                const selected = instance.name === this.selectedInstanceName ? 'selected' : '';
                                return `<option value="${this.escapeHtml(instance.name)}" ${selected}>Radarr \u2013 ${this.escapeHtml(instance.name)}</option>`;
                            }).join('')}
                        </select>
                    </div>
                `;
            }

            return `
                <!-- Toolbar -->
                <div class="mh-toolbar">
                    <div class="mh-toolbar-left">
                        <button class="mh-tb" id="requestarr-detail-back"><i class="fas fa-arrow-left"></i> <span>Back</span></button>
                    </div>
                    <div class="mh-toolbar-right"></div>
                </div>

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
            // Back button
            const backBtn = document.getElementById('requestarr-detail-back');
            if (backBtn) {
                backBtn.addEventListener('click', () => this.closeDetail());
            }

            // Instance selector
            const instanceSelect = document.getElementById('requestarr-detail-instance-select');
            if (instanceSelect) {
                instanceSelect.addEventListener('change', async () => {
                    this.selectedInstanceName = instanceSelect.value;
                    console.log('[RequestarrDetail] Instance changed to:', this.selectedInstanceName);
                    await this.updateMovieStatus();
                });
                this.updateMovieStatus();
            }

            // Request button
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
                                    in_library: false,
                                    in_cooldown: false
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
