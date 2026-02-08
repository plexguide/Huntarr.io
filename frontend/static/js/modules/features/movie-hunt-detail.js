/**
 * Movie Hunt Detail Page - Modern movie detail view with TMDB data
 * Shows full movie info, cast, similar movies, and request functionality
 */
(function() {
    'use strict';

    window.MovieHuntDetail = {
        currentMovie: null,
        tmdbApiKey: null,
        movieHuntInstances: [],
        selectedInstanceId: null,

        init() {
            console.log('[MovieHuntDetail] Module initialized');
            
            // Listen for browser back/forward buttons
            window.addEventListener('popstate', (e) => {
                if (e.state && e.state.movieDetail) {
                    // User navigated to a movie detail via back/forward
                    this.openDetail(e.state.movieDetail, {}, true);
                } else if (!e.state || !e.state.requestarrMovieDetail) {
                    // User navigated away from movie detail (and not to Requestarr detail)
                    this.closeDetail(true);
                }
            });
            
            // Check if URL has movie detail on page load
            this.checkUrlForMovieDetail();
        },
        
        checkUrlForMovieDetail() {
            // Check URL hash for movie detail pattern: #movie/12345
            const hash = window.location.hash;
            const movieMatch = hash.match(/#movie\/(\d+)/);
            
            if (movieMatch) {
                const tmdbId = parseInt(movieMatch[1]);
                console.log('[MovieHuntDetail] Found movie in URL, loading:', tmdbId);
                
                // Fetch basic movie info and open detail
                this.openDetailFromTmdbId(tmdbId);
            }
        },
        
        async openDetailFromTmdbId(tmdbId) {
            try {
                // Fetch basic movie info first
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
                    this.openDetail(movieData, {}, true);
                }
            } catch (error) {
                console.error('[MovieHuntDetail] Error loading movie from URL:', error);
            }
        },

        /**
         * Open detail view for a movie from Movie Hunt
         * @param {Object} movie - Movie data with at least title, year, tmdb_id
         * @param {Object} options - Optional config (unused, kept for compatibility)
         * @param {Boolean} fromHistory - True if opened from browser history (don't push state again)
         */
        async openDetail(movie, options = {}, fromHistory = false) {
            if (!movie) return;

            this.currentMovie = movie;
            console.log('[MovieHuntDetail] Opening detail for:', movie.title);
            
            // Load Movie Hunt instances if not already loaded
            if (this.movieHuntInstances.length === 0) {
                await this.loadMovieHuntInstances();
            }

            // Get or create detail view container
            let detailView = document.getElementById('movie-hunt-detail-view');
            if (!detailView) {
                detailView = document.createElement('div');
                detailView.id = 'movie-hunt-detail-view';
                detailView.className = 'movie-detail-view';
                document.body.appendChild(detailView);
            }

            // Show loading state
            detailView.innerHTML = this.getLoadingHTML();
            detailView.classList.add('active');
            // Don't hide body overflow - we want sidebar/topbar to remain accessible

            // Add to browser history (so back button works)
            if (!fromHistory) {
                const tmdbId = movie.tmdb_id || movie.id;
                const url = `${window.location.pathname}${window.location.search}#movie/${tmdbId}`;
                history.pushState(
                    { movieDetail: movie },
                    movie.title,
                    url
                );
            }

            // Setup close button
            setTimeout(() => {
                const closeBtn = detailView.querySelector('.movie-detail-close');
                if (closeBtn) {
                    closeBtn.addEventListener('click', () => this.closeDetail());
                }
            }, 0);

            try {
                // Fetch full movie details from TMDB
                const tmdbId = movie.tmdb_id || movie.id;
                const details = await this.fetchMovieDetails(tmdbId);
                
                if (details) {
                    console.log('[MovieHuntDetail] Rendering detail with instances:', this.movieHuntInstances.length);
                    detailView.innerHTML = this.renderMovieDetail(details, movie);
                    this.setupDetailInteractions();
                } else {
                    detailView.innerHTML = this.getErrorHTML('Failed to load movie details');
                }
            } catch (error) {
                console.error('[MovieHuntDetail] Error loading details:', error);
                detailView.innerHTML = this.getErrorHTML('Failed to load movie details');
            }
        },

        closeDetail(fromHistory = false) {
            const detailView = document.getElementById('movie-hunt-detail-view');
            if (detailView) {
                detailView.classList.remove('active');
                // Body overflow stays normal - sidebar/topbar always visible
            }
            
            // Remove from browser history if not already navigating
            if (!fromHistory && detailView && detailView.classList.contains('active')) {
                // Clear the hash from URL
                const url = `${window.location.pathname}${window.location.search}`;
                history.back(); // Use back to maintain proper history stack
            }
        },

        async fetchMovieDetails(tmdbId) {
            if (!tmdbId) return null;

            try {
                // Get TMDB API key from Movie Hunt API (not Requestarr)
                if (!this.tmdbApiKey) {
                    const keyResponse = await fetch('./api/movie-hunt/tmdb-key');
                    if (!keyResponse.ok) throw new Error('TMDB key endpoint failed: ' + keyResponse.status);
                    const keyData = await keyResponse.json();
                    this.tmdbApiKey = keyData.api_key;
                }

                if (!this.tmdbApiKey) {
                    console.error('[MovieHuntDetail] No TMDB API key available');
                    return null;
                }

                // Fetch movie details with credits and similar movies
                const url = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${this.tmdbApiKey}&append_to_response=credits,similar,videos,release_dates`;
                const response = await fetch(url);
                
                if (!response.ok) {
                    throw new Error(`TMDB API returned ${response.status}`);
                }

                const data = await response.json();
                return data;
            } catch (error) {
                console.error('[MovieHuntDetail] Error fetching from TMDB:', error);
                return null;
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
                ? details.genres.map(g => `<span class="movie-detail-genre">${this.escapeHtml(g.name)}</span>`).join('')
                : '<span class="movie-detail-genre">Unknown</span>';

            const overview = details.overview || 'No overview available.';

            // Check status from original movie data
            const inLibrary = originalMovie.in_library || false;
            const inCooldown = originalMovie.in_cooldown || false;
            
            let actionButton = '';
            
            if (inLibrary) {
                actionButton = '<button class="movie-detail-btn movie-detail-btn-primary" disabled><i class="fas fa-check"></i> Already Available</button>';
            } else if (inCooldown) {
                actionButton = '<button class="movie-detail-btn movie-detail-btn-primary" disabled><i class="fas fa-clock"></i> In Cooldown</button>';
            } else {
                actionButton = '<button class="movie-detail-btn movie-detail-btn-primary" id="movie-detail-request-btn"><i class="fas fa-download"></i> Request Movie</button>';
            }

            // Director and main cast
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

            // Certification/Rating
            let certification = 'Not Rated';
            if (details.release_dates && details.release_dates.results) {
                const usRelease = details.release_dates.results.find(r => r.iso_3166_1 === 'US');
                if (usRelease && usRelease.release_dates && usRelease.release_dates.length > 0) {
                    const cert = usRelease.release_dates[0].certification;
                    if (cert) certification = cert;
                }
            }

            // Build Movie Hunt instance selector (always show, even if loading)
            let instanceSelectorHTML = '';
            if (this.movieHuntInstances.length > 0) {
                instanceSelectorHTML = `
                    <div class="movie-detail-instance-selector">
                        <label for="movie-detail-instance-select"><i class="fas fa-server"></i> Instance:</label>
                        <select id="movie-detail-instance-select" class="movie-detail-select">
                            ${this.movieHuntInstances.map(instance => {
                                const selected = instance.id === this.selectedInstanceId ? 'selected' : '';
                                return `<option value="${instance.id}" ${selected}>Movie Hunt - ${this.escapeHtml(instance.name)}</option>`;
                            }).join('')}
                        </select>
                    </div>
                `;
            } else {
                // Show loading state if instances haven't loaded yet
                instanceSelectorHTML = `
                    <div class="movie-detail-instance-selector">
                        <label for="movie-detail-instance-select"><i class="fas fa-server"></i> Instance:</label>
                        <select id="movie-detail-instance-select" class="movie-detail-select" disabled>
                            <option>Loading instances...</option>
                        </select>
                    </div>
                `;
            }

            return `
                <button class="movie-detail-close"><i class="fas fa-times"></i></button>
                
                <div class="movie-detail-hero" style="background-image: url('${backdropUrl}');">
                    <div class="movie-detail-hero-content">
                        <div class="movie-detail-poster">
                            <img src="${posterUrl}" alt="${this.escapeHtml(details.title)}" onerror="this.src='./static/images/blackout.jpg'">
                        </div>
                        <div class="movie-detail-info">
                            <h1 class="movie-detail-title">${this.escapeHtml(details.title)}</h1>
                            ${instanceSelectorHTML}
                            <div class="movie-detail-meta">
                                <div class="movie-detail-year"><i class="fas fa-calendar"></i> ${year}</div>
                                <div class="movie-detail-runtime"><i class="fas fa-clock"></i> ${runtime}</div>
                                <div class="movie-detail-rating"><i class="fas fa-star"></i> ${rating}</div>
                            </div>
                            <div class="movie-detail-genres">${genres}</div>
                            <p class="movie-detail-overview">${this.escapeHtml(overview)}</p>
                            <div class="movie-detail-actions">
                                ${actionButton}
                            </div>
                        </div>
                    </div>
                </div>

                <div class="movie-detail-content">
                    <!-- Movie Hunt Status Bar -->
                    <div id="movie-detail-mh-status" class="movie-detail-section movie-detail-mh-section">
                        <div class="mh-status-bar mh-status-loading">
                            <div class="mh-status-item"><span class="mh-status-value"><i class="fas fa-spinner fa-spin"></i> Checking status...</span></div>
                        </div>
                    </div>

                    <!-- Movie Details -->
                    <div class="movie-detail-section">
                        <h2 class="movie-detail-section-title"><i class="fas fa-info-circle"></i> Movie Details</h2>
                        <div class="movie-detail-grid">
                            <div class="movie-detail-item">
                                <div class="movie-detail-item-label">Director</div>
                                <div class="movie-detail-item-value">${this.escapeHtml(director)}</div>
                            </div>
                            <div class="movie-detail-item">
                                <div class="movie-detail-item-label">Release Date</div>
                                <div class="movie-detail-item-value">${details.release_date || 'N/A'}</div>
                            </div>
                            <div class="movie-detail-item">
                                <div class="movie-detail-item-label">Rating</div>
                                <div class="movie-detail-item-value">${certification}</div>
                            </div>
                            <div class="movie-detail-item">
                                <div class="movie-detail-item-label">Budget</div>
                                <div class="movie-detail-item-value">${details.budget ? '$' + (details.budget / 1000000).toFixed(1) + 'M' : 'N/A'}</div>
                            </div>
                            <div class="movie-detail-item">
                                <div class="movie-detail-item-label">Revenue</div>
                                <div class="movie-detail-item-value">${details.revenue ? '$' + (details.revenue / 1000000).toFixed(1) + 'M' : 'N/A'}</div>
                            </div>
                            <div class="movie-detail-item">
                                <div class="movie-detail-item-label">Language</div>
                                <div class="movie-detail-item-value">${details.original_language ? details.original_language.toUpperCase() : 'N/A'}</div>
                            </div>
                        </div>
                    </div>

                    ${mainCast.length > 0 ? `
                    <!-- Cast -->
                    <div class="movie-detail-section">
                        <h2 class="movie-detail-section-title"><i class="fas fa-users"></i> Cast</h2>
                        <div class="movie-detail-cast">
                            ${mainCast.map(actor => this.renderCastCard(actor)).join('')}
                        </div>
                    </div>
                    ` : ''}

                    ${similarMovies.length > 0 ? `
                    <!-- Similar Movies -->
                    <div class="movie-detail-section">
                        <h2 class="movie-detail-section-title"><i class="fas fa-film"></i> Similar Movies</h2>
                        <div class="movie-detail-similar">
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
                <div class="movie-detail-cast-card">
                    <div class="movie-detail-cast-photo">
                        <img src="${photoUrl}" alt="${this.escapeHtml(actor.name)}" onerror="this.src='./static/images/blackout.jpg'">
                    </div>
                    <div class="movie-detail-cast-info">
                        <div class="movie-detail-cast-name">${this.escapeHtml(actor.name)}</div>
                        <div class="movie-detail-cast-character">${this.escapeHtml(actor.character || 'Unknown')}</div>
                    </div>
                </div>
            `;
        },

        renderSimilarCard(movie) {
            const posterUrl = movie.poster_path 
                ? `https://image.tmdb.org/t/p/w185${movie.poster_path}`
                : './static/images/blackout.jpg';

            return `
                <div class="media-card" data-tmdb-id="${movie.id}">
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
            // Close button
            const closeBtn = document.querySelector('.movie-detail-close');
            if (closeBtn) {
                closeBtn.addEventListener('click', () => this.closeDetail());
            }

            // Instance selector change handler
            const instanceSelect = document.getElementById('movie-detail-instance-select');
            if (instanceSelect) {
                instanceSelect.addEventListener('change', async () => {
                    const instanceId = parseInt(instanceSelect.value, 10);
                    if (!instanceId) return;
                    
                    this.selectedInstanceId = instanceId;
                    console.log('[MovieHuntDetail] Instance changed to:', this.selectedInstanceId);
                    
                    // Persist as server default so all Movie Hunt sections use this instance
                    try {
                        const res = await fetch('./api/movie-hunt/current-instance', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ instance_id: instanceId })
                        });
                        const data = await res.json();
                        if (data.error) console.warn('[MovieHuntDetail] Set current instance failed:', data.error);
                    } catch (err) {
                        console.warn('[MovieHuntDetail] Set current instance error:', err);
                    }
                    
                    // Update movie status for new instance
                    await this.updateMovieStatus();
                });
                
                // Initial status check for selected instance
                this.updateMovieStatus();
            }

            // Request button
            const requestBtn = document.getElementById('movie-detail-request-btn');
            if (requestBtn && this.currentMovie) {
                requestBtn.addEventListener('click', () => {
                    if (window.MovieHunt && window.MovieHunt.openMovieHuntRequestModal) {
                        window.MovieHunt.openMovieHuntRequestModal(this.currentMovie);
                    }
                });
            }

            // Similar movie cards - open their details
            const similarCards = document.querySelectorAll('.movie-detail-similar .media-card');
            similarCards.forEach(card => {
                card.addEventListener('click', async () => {
                    const tmdbId = card.getAttribute('data-tmdb-id');
                    if (tmdbId) {
                        // Fetch basic movie data and open detail (this will update URL)
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
                                // Open detail and update URL (fromHistory = false)
                                this.openDetail(movieData, {}, false);
                            }
                        } catch (error) {
                            console.error('[MovieHuntDetail] Error opening similar movie:', error);
                        }
                    }
                });
            });

            // ESC key to close
            const escHandler = (e) => {
                if (e.key === 'Escape') {
                    this.closeDetail();
                    document.removeEventListener('keydown', escHandler);
                }
            };
            document.addEventListener('keydown', escHandler);
        },

        async loadMovieHuntInstances() {
            console.log('[MovieHuntDetail] Starting to load Movie Hunt instances...');
            try {
                const response = await fetch('./api/movie-hunt/instances');
                const data = await response.json();
                console.log('[MovieHuntDetail] Instances API response:', data);
                
                if (data.instances && data.instances.length > 0) {
                    this.movieHuntInstances = data.instances;
                    
                    // Set initial selected instance (Movie Hunt uses integer IDs)
                    if (!this.selectedInstanceId) {
                        // Get current instance from server
                        const currentResponse = await fetch('./api/movie-hunt/current-instance');
                        const currentData = await currentResponse.json();
                        this.selectedInstanceId = currentData.instance_id || this.movieHuntInstances[0].id;
                    }
                    
                    console.log('[MovieHuntDetail] Loaded', this.movieHuntInstances.length, 'Movie Hunt instances, selected:', this.selectedInstanceId);
                } else {
                    console.log('[MovieHuntDetail] No instances found in response');
                    this.movieHuntInstances = [];
                    this.selectedInstanceId = null;
                }
            } catch (error) {
                console.error('[MovieHuntDetail] Error loading Movie Hunt instances:', error);
                this.movieHuntInstances = [];
                this.selectedInstanceId = null;
            }
        },

        async checkMovieStatus(tmdbId, instanceId) {
            if (!instanceId) return { in_library: false };
            
            try {
                // Check Movie Hunt collection for this instance
                const response = await fetch(`./api/movie-hunt/collection?instance_id=${instanceId}`);
                const data = await response.json();
                
                // Find this movie in the collection
                const items = data.items || [];
                const movie = items.find(item => item.tmdb_id === tmdbId);
                
                if (movie) {
                    return {
                        in_library: movie.status === 'available'
                    };
                }
                
                return { in_library: false };
            } catch (error) {
                console.error('[MovieHuntDetail] Error checking movie status:', error);
                return { in_library: false };
            }
        },

        async updateMovieStatus() {
            if (!this.currentMovie || !this.selectedInstanceId) return;
            
            const tmdbId = this.currentMovie.tmdb_id || this.currentMovie.id;
            const status = await this.checkMovieStatus(tmdbId, this.selectedInstanceId);
            
            // Update the action button based on new status
            const actionsContainer = document.querySelector('.movie-detail-actions');
            if (actionsContainer) {
                let actionButton = '';
                
                if (status.in_library) {
                    actionButton = '<button class="movie-detail-btn movie-detail-btn-primary" disabled><i class="fas fa-check"></i> Already Available</button>';
                } else {
                    actionButton = '<button class="movie-detail-btn movie-detail-btn-primary" id="movie-detail-request-btn"><i class="fas fa-download"></i> Request Movie</button>';
                }
                
                actionsContainer.innerHTML = actionButton;
                
                // Re-setup request button if it exists
                const requestBtn = document.getElementById('movie-detail-request-btn');
                if (requestBtn) {
                    requestBtn.addEventListener('click', () => {
                        if (window.MovieHunt && window.MovieHunt.openMovieHuntRequestModal) {
                            window.MovieHunt.openMovieHuntRequestModal(this.currentMovie);
                        }
                    });
                }
            }

            // Fetch and render Movie Hunt status bar
            this.fetchMovieHuntStatus(tmdbId, this.selectedInstanceId);
        },

        async fetchMovieHuntStatus(tmdbId, instanceId) {
            try {
                const resp = await fetch(`./api/movie-hunt/movie-status?tmdb_id=${tmdbId}&instance_id=${instanceId}`);
                const data = await resp.json();

                const container = document.getElementById('movie-detail-mh-status');
                if (!container) return;

                if (!data.success || !data.found) {
                    container.innerHTML = '<div class="mh-status-bar"><div class="mh-status-item"><span class="mh-status-badge mh-status-not-added">Not in Collection</span></div></div>';
                    return;
                }

                // Status badge with color coding
                let statusBadge = '';
                let statusClass = '';
                let statusIcon = '';
                if (data.status === 'downloaded') {
                    statusClass = 'mh-status-downloaded';
                    statusIcon = 'fa-check-circle';
                    statusBadge = 'Downloaded';
                } else if (data.status === 'missing') {
                    statusClass = 'mh-status-missing';
                    statusIcon = 'fa-exclamation-circle';
                    statusBadge = 'Requested';
                } else {
                    statusClass = 'mh-status-requested';
                    statusIcon = 'fa-clock';
                    statusBadge = 'Requested';
                }

                // File size formatting
                let sizeStr = '';
                const bytes = data.file_size || 0;
                if (bytes > 0) {
                    if (bytes >= 1073741824) {
                        sizeStr = (bytes / 1073741824).toFixed(1) + ' GiB';
                    } else {
                        sizeStr = (bytes / 1048576).toFixed(0) + ' MiB';
                    }
                }

                let html = '<div class="mh-status-bar">';

                // Status
                html += '<div class="mh-status-item">';
                html += '<span class="mh-status-label">Status</span>';
                html += '<span class="mh-status-badge ' + statusClass + '"><i class="fas ' + statusIcon + '"></i> ' + statusBadge + '</span>';
                html += '</div>';

                // Quality Profile
                if (data.quality_profile) {
                    html += '<div class="mh-status-item">';
                    html += '<span class="mh-status-label">Quality Profile</span>';
                    html += '<span class="mh-status-value">' + this.escapeHtml(data.quality_profile) + '</span>';
                    html += '</div>';
                }

                // File Quality (if downloaded)
                if (data.file_quality) {
                    html += '<div class="mh-status-item">';
                    html += '<span class="mh-status-label">Quality</span>';
                    html += '<span class="mh-status-badge mh-status-quality"><i class="fas fa-film"></i> ' + this.escapeHtml(data.file_quality) + '</span>';
                    html += '</div>';
                }

                // Size
                if (sizeStr) {
                    html += '<div class="mh-status-item">';
                    html += '<span class="mh-status-label">Size</span>';
                    html += '<span class="mh-status-value">' + sizeStr + '</span>';
                    html += '</div>';
                }

                // Root Folder / Path
                if (data.path) {
                    html += '<div class="mh-status-item mh-status-path">';
                    html += '<span class="mh-status-label">Path</span>';
                    html += '<span class="mh-status-value mh-path-text">' + this.escapeHtml(data.path) + '</span>';
                    html += '</div>';
                } else if (data.root_folder_path) {
                    html += '<div class="mh-status-item mh-status-path">';
                    html += '<span class="mh-status-label">Root Folder</span>';
                    html += '<span class="mh-status-value mh-path-text">' + this.escapeHtml(data.root_folder_path) + '</span>';
                    html += '</div>';
                }

                html += '</div>';
                container.innerHTML = html;
            } catch (err) {
                console.error('[MovieHuntDetail] Movie status fetch failed:', err);
            }
        },

        getLoadingHTML() {
            return `
                <button class="movie-detail-close"><i class="fas fa-times"></i></button>
                <div class="movie-detail-loading">
                    <i class="fas fa-spinner fa-spin"></i>
                    <p>Loading movie details...</p>
                </div>
            `;
        },

        getErrorHTML(message) {
            return `
                <button class="movie-detail-close"><i class="fas fa-times"></i></button>
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

    // Initialize on load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => window.MovieHuntDetail.init());
    } else {
        window.MovieHuntDetail.init();
    }
})();
