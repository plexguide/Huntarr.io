/**
 * Requestarr Discover - Horizontal scrolling media discovery system
 */

class RequestarrDiscover {
    constructor() {
        this.currentView = 'discover';
        this.instances = { sonarr: [], radarr: [] };
        this.qualityProfiles = {}; // Cache quality profiles by instance
        this.searchTimeouts = {};
        this.currentModal = null;
        this.currentModalData = null;
        this.selectedSeasons = [];
        this.init();
    }

    // ========================================
    // INITIALIZATION
    // ========================================

    init() {
        console.log('[RequestarrDiscover] Initializing...');
        this.loadInstances();
        this.setupCarouselArrows();
        this.setupSearchHandlers();
        this.setupGlobalSearch();
        this.loadDiscoverContent();
    }

    async loadInstances() {
        try {
            const response = await fetch('./api/requestarr/instances');
            const data = await response.json();
            
            if (data.sonarr || data.radarr) {
                this.instances = {
                    sonarr: data.sonarr || [],
                    radarr: data.radarr || []
                };
                console.log('[RequestarrDiscover] Loaded instances:', this.instances);
                await this.loadAllQualityProfiles();
            }
        } catch (error) {
            console.error('[RequestarrDiscover] Error loading instances:', error);
        }
    }
    
    async loadAllQualityProfiles() {
        console.log('[RequestarrDiscover] Loading quality profiles...');
        
        // Load Radarr quality profiles
        for (const instance of this.instances.radarr) {
            try {
                const response = await fetch(`./api/requestarr/quality-profiles/radarr/${instance.name}`);
                const data = await response.json();
                if (data.success) {
                    this.qualityProfiles[`radarr-${instance.name}`] = data.profiles;
                    console.log(`[RequestarrDiscover] Loaded quality profiles for Radarr - ${instance.name}:`, data.profiles);
                }
            } catch (error) {
                console.error(`[RequestarrDiscover] Error loading Radarr quality profiles for ${instance.name}:`, error);
            }
        }
        
        // Load Sonarr quality profiles
        for (const instance of this.instances.sonarr) {
            try {
                const response = await fetch(`./api/requestarr/quality-profiles/sonarr/${instance.name}`);
                const data = await response.json();
                if (data.success) {
                    this.qualityProfiles[`sonarr-${instance.name}`] = data.profiles;
                    console.log(`[RequestarrDiscover] Loaded quality profiles for Sonarr - ${instance.name}:`, data.profiles);
                }
            } catch (error) {
                console.error(`[RequestarrDiscover] Error loading Sonarr quality profiles for ${instance.name}:`, error);
            }
        }
    }

    // ========================================
    // VIEW MANAGEMENT
    // ========================================

    switchView(view) {
        console.log('[RequestarrDiscover] Switching to view:', view);
        
        // Clear global search
        const globalSearch = document.getElementById('global-search-input');
        if (globalSearch) {
            globalSearch.value = '';
        }
        
        // Hide/show global search bar based on view
        const globalSearchBar = document.querySelector('.global-search-bar');
        if (globalSearchBar) {
            if (view === 'history' || view === 'settings') {
                globalSearchBar.style.display = 'none';
            } else {
                globalSearchBar.style.display = 'flex';
            }
        }
        
        // Hide search results view
        document.getElementById('search-results-view').style.display = 'none';
        
        // Hide all views
        document.querySelectorAll('.requestarr-view').forEach(container => {
            container.classList.remove('active');
            container.style.display = 'none';
        });
        
        // Show target view
        const targetView = document.getElementById(`requestarr-${view}-view`);
        if (targetView) {
            targetView.classList.add('active');
            targetView.style.display = 'block';
        }

        this.currentView = view;

        // Load content for view if not already loaded
        switch (view) {
            case 'discover':
                if (!document.getElementById('trending-carousel').children.length) {
                    this.loadDiscoverContent();
                }
                break;
            case 'movies':
                if (!document.getElementById('movies-carousel').children.length) {
                    this.loadMovies();
                }
                break;
            case 'tv':
                if (!document.getElementById('tv-carousel').children.length) {
                    this.loadTV();
                }
                break;
            case 'history':
                this.loadHistory();
                break;
            case 'settings':
                this.loadSettings();
                break;
        }
    }

    setupCarouselArrows() {
        const arrows = document.querySelectorAll('.carousel-arrow');
        const carousels = new Set();
        
        // Collect all unique carousels
        arrows.forEach(arrow => {
            const targetId = arrow.dataset.target;
            const carousel = document.getElementById(targetId);
            if (carousel) {
                carousels.add(carousel);
            }
        });
        
        // Setup scroll listeners for each carousel
        carousels.forEach(carousel => {
            const updateArrowVisibility = () => {
                const carouselId = carousel.id;
                const leftArrow = document.querySelector(`.carousel-arrow.left[data-target="${carouselId}"]`);
                const rightArrow = document.querySelector(`.carousel-arrow.right[data-target="${carouselId}"]`);
                
                if (!leftArrow || !rightArrow) return;
                
                const scrollLeft = carousel.scrollLeft;
                const maxScroll = carousel.scrollWidth - carousel.clientWidth;
                
                // Hide left arrow if at start
                if (scrollLeft <= 5) {
                    leftArrow.style.opacity = '0';
                    leftArrow.style.pointerEvents = 'none';
                } else {
                    leftArrow.style.opacity = '0.8';
                    leftArrow.style.pointerEvents = 'auto';
                }
                
                // Hide right arrow if at end
                if (scrollLeft >= maxScroll - 5) {
                    rightArrow.style.opacity = '0';
                    rightArrow.style.pointerEvents = 'none';
                } else {
                    rightArrow.style.opacity = '0.8';
                    rightArrow.style.pointerEvents = 'auto';
                }
            };
            
            carousel.addEventListener('scroll', updateArrowVisibility);
            setTimeout(() => updateArrowVisibility(), 100);
            window.addEventListener('resize', updateArrowVisibility);
        });
        
        // Click handlers
        arrows.forEach(arrow => {
            arrow.addEventListener('click', (e) => {
                const targetId = arrow.dataset.target;
                const carousel = document.getElementById(targetId);
                
                const carouselWidth = carousel.offsetWidth;
                const cardWidth = 150;
                const gap = 20;
                const itemWidth = cardWidth + gap;
                const visibleItems = Math.floor(carouselWidth / itemWidth);
                const scrollAmount = visibleItems * itemWidth;
                
                if (arrow.classList.contains('left')) {
                    carousel.scrollBy({ left: -scrollAmount, behavior: 'smooth' });
                } else {
                    carousel.scrollBy({ left: scrollAmount, behavior: 'smooth' });
                }
            });
        });
    }

    // ========================================
    // CONTENT LOADING
    // ========================================

    async loadDiscoverContent() {
        await Promise.all([
            this.loadTrending(),
            this.loadPopularMovies(),
            this.loadPopularTV()
        ]);
    }

    async loadTrending() {
        const carousel = document.getElementById('trending-carousel');
        try {
            const response = await fetch('./api/requestarr/discover/trending');
            const data = await response.json();
            
            if (data.results && data.results.length > 0) {
                carousel.innerHTML = '';
                data.results.forEach(item => {
                    carousel.appendChild(this.createMediaCard(item));
                });
            } else {
                carousel.innerHTML = '<p style="color: #888; text-align: center; width: 100%; padding: 40px;">No trending content available</p>';
            }
        } catch (error) {
            console.error('[RequestarrDiscover] Error loading trending:', error);
            carousel.innerHTML = '<p style="color: #ef4444; text-align: center; width: 100%; padding: 40px;">Failed to load trending content</p>';
        }
    }

    async loadPopularMovies() {
        const carousel = document.getElementById('popular-movies-carousel');
        try {
            const response = await fetch('./api/requestarr/discover/movies?page=1');
            const data = await response.json();
            
            if (data.results && data.results.length > 0) {
                carousel.innerHTML = '';
                data.results.forEach(item => {
                    carousel.appendChild(this.createMediaCard(item));
                });
            } else {
                carousel.innerHTML = '<p style="color: #888; text-align: center; width: 100%; padding: 40px;">No movies available</p>';
            }
        } catch (error) {
            console.error('[RequestarrDiscover] Error loading popular movies:', error);
            carousel.innerHTML = '<p style="color: #ef4444; text-align: center; width: 100%; padding: 40px;">Failed to load movies</p>';
        }
    }

    async loadPopularTV() {
        const carousel = document.getElementById('popular-tv-carousel');
        try {
            const response = await fetch('./api/requestarr/discover/tv?page=1');
            const data = await response.json();
            
            if (data.results && data.results.length > 0) {
                carousel.innerHTML = '';
                data.results.forEach(item => {
                    carousel.appendChild(this.createMediaCard(item));
                });
            } else {
                carousel.innerHTML = '<p style="color: #888; text-align: center; width: 100%; padding: 40px;">No TV shows available</p>';
            }
        } catch (error) {
            console.error('[RequestarrDiscover] Error loading popular TV:', error);
            carousel.innerHTML = '<p style="color: #ef4444; text-align: center; width: 100%; padding: 40px;">Failed to load TV shows</p>';
        }
    }

    async loadMovies(page = 1) {
        const carousel = document.getElementById('movies-carousel');
        carousel.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Loading movies...</p></div>';
        
        try {
            const response = await fetch(`./api/requestarr/discover/movies?page=${page}`);
            const data = await response.json();
            
            if (data.results && data.results.length > 0) {
                carousel.innerHTML = '';
                data.results.forEach(item => {
                    carousel.appendChild(this.createMediaCard(item));
                });
            } else {
                carousel.innerHTML = '<p style="color: #888; text-align: center; width: 100%; padding: 40px;">No movies found</p>';
            }
        } catch (error) {
            console.error('[RequestarrDiscover] Error loading movies:', error);
            carousel.innerHTML = '<p style="color: #ef4444; text-align: center; width: 100%; padding: 40px;">Failed to load movies</p>';
        }
    }

    async loadTV(page = 1) {
        const carousel = document.getElementById('tv-carousel');
        carousel.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Loading TV shows...</p></div>';
        
        try {
            const response = await fetch(`./api/requestarr/discover/tv?page=${page}`);
            const data = await response.json();
            
            if (data.results && data.results.length > 0) {
                carousel.innerHTML = '';
                data.results.forEach(item => {
                    carousel.appendChild(this.createMediaCard(item));
                });
            } else {
                carousel.innerHTML = '<p style="color: #888; text-align: center; width: 100%; padding: 40px;">No TV shows found</p>';
            }
        } catch (error) {
            console.error('[RequestarrDiscover] Error loading TV shows:', error);
            carousel.innerHTML = '<p style="color: #ef4444; text-align: center; width: 100%; padding: 40px;">Failed to load TV shows</p>';
        }
    }

    // ========================================
    // SEARCH FUNCTIONALITY
    // ========================================

    setupGlobalSearch() {
        const globalSearch = document.getElementById('global-search-input');
        
        if (globalSearch) {
            globalSearch.addEventListener('input', (e) => {
                this.handleGlobalSearch(e.target.value);
            });
        }
    }

    handleGlobalSearch(query) {
        if (this.searchTimeouts['global']) {
            clearTimeout(this.searchTimeouts['global']);
        }
        
        if (!query.trim()) {
            document.getElementById('search-results-view').style.display = 'none';
            document.getElementById('requestarr-discover-view').style.display = 'block';
            document.getElementById('requestarr-movies-view').style.display = 'none';
            document.getElementById('requestarr-tv-view').style.display = 'none';
            document.getElementById('requestarr-history-view').style.display = 'none';
            return;
        }
        
        this.searchTimeouts['global'] = setTimeout(() => {
            this.performGlobalSearch(query);
        }, 500);
    }

    async performGlobalSearch(query) {
        const resultsView = document.getElementById('search-results-view');
        const resultsGrid = document.getElementById('search-results-grid');
        const discoverView = document.getElementById('requestarr-discover-view');
        
        discoverView.style.display = 'none';
        document.getElementById('requestarr-movies-view').style.display = 'none';
        document.getElementById('requestarr-tv-view').style.display = 'none';
        document.getElementById('requestarr-history-view').style.display = 'none';
        resultsView.style.display = 'block';
        
        resultsGrid.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Searching...</p></div>';
        
        try {
            const [moviesResponse, tvResponse] = await Promise.all([
                fetch(`./api/requestarr/search?q=${encodeURIComponent(query)}&app_type=radarr&instance_name=search`),
                fetch(`./api/requestarr/search?q=${encodeURIComponent(query)}&app_type=sonarr&instance_name=search`)
            ]);
            
            const moviesData = await moviesResponse.json();
            const tvData = await tvResponse.json();
            
            const allResults = [
                ...(moviesData.results || []),
                ...(tvData.results || [])
            ];
            
            allResults.sort((a, b) => {
                const popularityA = a.popularity || 0;
                const popularityB = b.popularity || 0;
                return popularityB - popularityA;
            });
            
            if (allResults.length > 0) {
                resultsGrid.innerHTML = '';
                allResults.forEach(item => {
                    resultsGrid.appendChild(this.createMediaCard(item));
                });
            } else {
                resultsGrid.innerHTML = '<p style="color: #888; text-align: center; padding: 60px; width: 100%;">No results found</p>';
            }
        } catch (error) {
            console.error('[RequestarrDiscover] Error searching:', error);
            resultsGrid.innerHTML = '<p style="color: #ef4444; text-align: center; padding: 60px; width: 100%;">Search failed</p>';
        }
    }

    setupSearchHandlers() {
        const moviesSearch = document.getElementById('movies-search');
        const tvSearch = document.getElementById('tv-search');
        
        if (moviesSearch) {
            moviesSearch.addEventListener('input', (e) => {
                this.handleSearch(e.target.value, 'movie');
            });
        }
        
        if (tvSearch) {
            tvSearch.addEventListener('input', (e) => {
                this.handleSearch(e.target.value, 'tv');
            });
        }
    }

    handleSearch(query, mediaType) {
        const timeoutKey = mediaType;
        
        if (this.searchTimeouts[timeoutKey]) {
            clearTimeout(this.searchTimeouts[timeoutKey]);
        }
        
        if (!query.trim()) {
            if (mediaType === 'movie') {
                this.loadMovies();
            } else {
                this.loadTV();
            }
            return;
        }
        
        this.searchTimeouts[timeoutKey] = setTimeout(() => {
            this.performSearch(query, mediaType);
        }, 500);
    }

    async performSearch(query, mediaType) {
        const carousel = document.getElementById(mediaType === 'movie' ? 'movies-carousel' : 'tv-carousel');
        carousel.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Searching...</p></div>';
        
        try {
            const response = await fetch(`./api/requestarr/search?q=${encodeURIComponent(query)}&app_type=${mediaType === 'movie' ? 'radarr' : 'sonarr'}&instance_name=search`);
            const data = await response.json();
            
            if (data.results && data.results.length > 0) {
                carousel.innerHTML = '';
                data.results.forEach(item => {
                    carousel.appendChild(this.createMediaCard(item));
                });
            } else {
                carousel.innerHTML = '<p style="color: #888; text-align: center; width: 100%; padding: 40px;">No results found</p>';
            }
        } catch (error) {
            console.error('[RequestarrDiscover] Error searching:', error);
            carousel.innerHTML = '<p style="color: #ef4444; text-align: center; width: 100%; padding: 40px;">Search failed</p>';
        }
    }

    // ========================================
    // MEDIA CARD CREATION
    // ========================================

    createMediaCard(item) {
        const card = document.createElement('div');
        card.className = 'media-card';
        
        const posterUrl = item.poster_path || './static/images/no-poster.png';
        const year = item.year || 'N/A';
        const rating = item.vote_average ? item.vote_average.toFixed(1) : 'N/A';
        const overview = item.overview || 'No description available.';
        
        const inLibrary = item.in_library || false;
        const statusBadgeHTML = inLibrary ? '<div class="media-card-status-badge"><i class="fas fa-check"></i></div>' : '';
        
        if (inLibrary) {
            card.classList.add('in-library');
        }
        
        card.innerHTML = `
            <div class="media-card-poster">
                ${statusBadgeHTML}
                <img src="${posterUrl}" alt="${item.title}" onerror="this.src='./static/images/no-poster.png'">
                <div class="media-card-overlay">
                    <div class="media-card-overlay-title">${item.title}</div>
                    <div class="media-card-overlay-content">
                        <div class="media-card-overlay-year">${year}</div>
                        <div class="media-card-overlay-description">${overview}</div>
                        ${!inLibrary ? '<button class="media-card-request-btn"><i class="fas fa-download"></i> Request</button>' : ''}
                    </div>
                </div>
            </div>
            <div class="media-card-info">
                <div class="media-card-title" title="${item.title}">${item.title}</div>
                <div class="media-card-meta">
                    <span class="media-card-year">${year}</span>
                    <span class="media-card-rating">
                        <i class="fas fa-star"></i>
                        ${rating}
                    </span>
                </div>
            </div>
        `;
        
        const posterDiv = card.querySelector('.media-card-poster');
        const requestBtn = card.querySelector('.media-card-request-btn');
        
        posterDiv.addEventListener('click', (e) => {
            if (requestBtn && (e.target === requestBtn || requestBtn.contains(e.target))) {
                return;
            }
            this.openModal(item.tmdb_id, item.media_type);
        });
        
        if (requestBtn) {
            requestBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.openModal(item.tmdb_id, item.media_type);
            });
        }
        
        return card;
    }

    // ========================================
    // MODAL SYSTEM
    // ========================================

    async openModal(tmdbId, mediaType) {
        const modal = document.getElementById('media-modal');
        const modalBody = modal.querySelector('.modal-body');
        
        modal.style.display = 'flex';
        modalBody.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Loading details...</p></div>';
        
        try {
            const response = await fetch(`./api/requestarr/details/${mediaType}/${tmdbId}`);
            const data = await response.json();
            
            if (data.tmdb_id) {
                this.currentModal = data;
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
        const instances = isTVShow ? this.instances.sonarr : this.instances.radarr;
        
        const instanceKey = isTVShow ? 'sonarr' : 'radarr';
        const rememberedInstance = localStorage.getItem(`huntarr-requestarr-instance-${instanceKey}`) || (instances[0]?.name || '');
        
        let modalHTML = `
            <div class="request-modal-header" style="background-image: url(${data.backdrop_path || ''});">
                <button class="modal-close-btn" onclick="window.RequestarrDiscover.closeModal()">
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
        if (isTVShow) {
            modalHTML += `
                <div id="series-status-container"></div>
                <div class="request-advanced-section">
                    <div class="advanced-field">
                        <label>Instance</label>
                        <select id="modal-instance-select" class="advanced-select" onchange="window.RequestarrDiscover.instanceChanged(this.value)">
            `;
            
            if (instances.length === 0) {
                modalHTML += `<option value="">No Instance Configured</option>`;
            } else {
                instances.forEach((instance, index) => {
                    const selected = instance.name === rememberedInstance ? 'selected' : '';
                    modalHTML += `<option value="${instance.name}" ${selected}>Sonarr - ${instance.name}</option>`;
                });
            }
            
            modalHTML += `
                        </select>
                    </div>
                </div>
            `;
        } else {
            modalHTML += `
                <div id="movie-status-container"></div>
                <div class="request-advanced-section">
                    <div class="advanced-field">
                        <label>Instance</label>
                        <select id="modal-instance-select" class="advanced-select" onchange="window.RequestarrDiscover.instanceChanged(this.value)">
            `;
            
            if (instances.length === 0) {
                modalHTML += `<option value="">No Instance Configured</option>`;
            } else {
                instances.forEach((instance, index) => {
                    const selected = instance.name === rememberedInstance ? 'selected' : '';
                    modalHTML += `<option value="${instance.name}" ${selected}>Radarr - ${instance.name}</option>`;
                });
            }
            
            modalHTML += `
                        </select>
                    </div>
                </div>
            `;
        }
        
        // Season selection for TV shows
        if (isTVShow && data.seasons) {
            const requestedSeasons = await this.checkRequestedSeasons(data.tmdb_id, rememberedInstance);
            
            modalHTML += `
                <div class="season-selection-container">
                    <div class="season-selection-header">
                        <div class="header-col">SEASON</div>
                        <div class="header-col"># OF EPISODES</div>
                        <div class="header-col">STATUS</div>
                    </div>
                    <div class="season-selection-list">
            `;
            
            data.seasons.forEach((season, index) => {
                const isRequested = requestedSeasons.includes(season.season_number);
                const faded = isRequested ? 'requested' : '';
                
                modalHTML += `
                    <div class="season-row ${faded}">
                        <label class="season-toggle">
                            <input type="checkbox" 
                                   class="season-checkbox" 
                                   data-season="${season.season_number}"
                                   ${isRequested ? 'checked disabled' : ''}
                                   onchange="window.RequestarrDiscover.toggleSeason(this)">
                            <span class="toggle-slider"></span>
                        </label>
                        <div class="season-name">Season ${season.season_number}</div>
                        <div class="season-episodes">${season.episode_count || 'TBA'}</div>
                        <div class="season-status">
                            ${isRequested ? '<span class="status-badge requested">Already Requested</span>' : '<span class="status-badge not-requested">Not Requested</span>'}
                        </div>
                    </div>
                `;
            });
            
            modalHTML += `
                    </div>
                </div>
            `;
        }
        
        // Quality Profile section
        const profileKey = `${isTVShow ? 'sonarr' : 'radarr'}-${rememberedInstance || (instances[0]?.name || '')}`;
        const profiles = this.qualityProfiles[profileKey] || [];
        
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
                <button class="modal-btn cancel-btn" onclick="window.RequestarrDiscover.closeModal()">Cancel</button>
                <button class="modal-btn request-btn" id="modal-request-btn" onclick="window.RequestarrDiscover.submitRequest()">
                    ${isTVShow ? 'Select Season(s)' : 'Request'}
                </button>
            </div>
        </div>
        `;
        
        modalBody.innerHTML = modalHTML;
        
        this.currentModalData = data;
        this.selectedSeasons = [];
        
        // Load status if instance is already selected
        if (rememberedInstance) {
            if (isTVShow) {
                this.loadSeriesStatus(rememberedInstance);
            } else {
                this.loadMovieStatus(rememberedInstance);
            }
        }
        
        // Disable request button initially for TV shows or if no instances
        if (isTVShow || instances.length === 0) {
            document.getElementById('modal-request-btn').disabled = true;
            document.getElementById('modal-request-btn').classList.add('disabled');
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

    toggleSeason(checkbox) {
        const seasonNumber = parseInt(checkbox.dataset.season);
        
        if (checkbox.checked && !checkbox.disabled) {
            if (!this.selectedSeasons.includes(seasonNumber)) {
                this.selectedSeasons.push(seasonNumber);
            }
        } else {
            this.selectedSeasons = this.selectedSeasons.filter(s => s !== seasonNumber);
        }
        
        const requestBtn = document.getElementById('modal-request-btn');
        if (this.selectedSeasons.length > 0) {
            requestBtn.disabled = false;
            requestBtn.classList.remove('disabled');
        } else {
            requestBtn.disabled = true;
            requestBtn.classList.add('disabled');
        }
        
        console.log('[RequestarrDiscover] Selected seasons:', this.selectedSeasons);
    }

    async loadSeriesStatus(instanceName) {
        if (!instanceName || !this.currentModalData) {
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
            const response = await fetch(`./api/requestarr/series-status?tmdb_id=${this.currentModalData.tmdb_id}&instance=${encodeURIComponent(instanceName)}`);
            const status = await response.json();
            
            console.log('[RequestarrDiscover] Series status:', status);
            
            let statusHTML = '';
            
            if (status.exists) {
                if (status.missing_episodes === 0 && status.total_episodes > 0) {
                    statusHTML = `
                        <div class="series-status-box status-available">
                            <i class="fas fa-check-circle"></i>
                            <div>
                                <div class="status-title">Complete series in library (${status.available_episodes}/${status.total_episodes})</div>
                            </div>
                        </div>
                    `;
                } else if (status.missing_episodes > 0) {
                    statusHTML = `
                        <div class="series-status-box status-missing-episodes">
                            <i class="fas fa-tv"></i>
                            <div>
                                <div class="status-title">Request missing episodes (${status.available_episodes}/${status.total_episodes}, ${status.missing_episodes} missing)</div>
                            </div>
                        </div>
                    `;
                } else {
                    statusHTML = `
                        <div class="series-status-box status-available">
                            <i class="fas fa-check-circle"></i>
                            <div>
                                <div class="status-title">In Library</div>
                            </div>
                        </div>
                    `;
                }
            } else {
                statusHTML = `
                    <div class="series-status-box status-requestable">
                        <i class="fas fa-inbox"></i>
                        <div>
                            <div class="status-title">Available to request</div>
                            <div class="status-text">This series is not yet in your library</div>
                        </div>
                    </div>
                `;
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
        if (!instanceName || !this.currentModalData) {
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
            const response = await fetch(`./api/requestarr/movie-status?tmdb_id=${this.currentModalData.tmdb_id}&instance=${encodeURIComponent(instanceName)}`);
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
            } else if (status.previously_requested) {
                statusHTML = `
                    <div class="series-status-box status-missing-episodes">
                        <i class="fas fa-clock"></i>
                        <div>
                            <div class="status-title">Previously requested</div>
                        </div>
                    </div>
                `;
                if (requestBtn) {
                    requestBtn.disabled = true;
                    requestBtn.classList.add('disabled');
                    requestBtn.textContent = 'Already Requested';
                }
            } else {
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
        const isTVShow = this.currentModalData.media_type === 'tv';
        const instanceKey = isTVShow ? 'sonarr' : 'radarr';
        
        localStorage.setItem(`huntarr-requestarr-instance-${instanceKey}`, instanceName);
        console.log('[RequestarrDiscover] Instance changed to:', instanceName);
        
        // Update quality profile dropdown
        const appType = isTVShow ? 'sonarr' : 'radarr';
        const profileKey = `${appType}-${instanceName}`;
        const profiles = this.qualityProfiles[profileKey] || [];
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
        const requestBtn = document.getElementById('modal-request-btn');
        
        if (!instanceSelect.value) {
            this.showNotification('Please select an instance', 'error');
            return;
        }
        
        const isTVShow = this.currentModalData.media_type === 'tv';
        
        if (isTVShow && this.selectedSeasons.length === 0) {
            this.showNotification('Please select at least one season', 'error');
            return;
        }
        
        requestBtn.disabled = true;
        requestBtn.textContent = 'Requesting...';
        
        try {
            const requestData = {
                tmdb_id: this.currentModalData.tmdb_id,
                media_type: this.currentModalData.media_type,
                title: this.currentModalData.title,
                instance: instanceSelect.value,
                quality_profile: qualityProfile
            };
            
            if (isTVShow) {
                requestData.seasons = this.selectedSeasons;
            }
            
            const response = await fetch('./api/requestarr/request', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestData)
            });
            
            const result = await response.json();
            
            if (result.success) {
                this.showNotification(`${isTVShow ? 'Seasons' : 'Movie'} requested successfully!`, 'success');
                this.closeModal();
            } else {
                this.showNotification(result.error || 'Request failed', 'error');
                requestBtn.disabled = false;
                requestBtn.textContent = isTVShow ? 'Select Season(s)' : 'Request';
            }
        } catch (error) {
            console.error('[RequestarrDiscover] Error submitting request:', error);
            this.showNotification('Request failed', 'error');
            requestBtn.disabled = false;
            requestBtn.textContent = isTVShow ? 'Select Season(s)' : 'Request';
        }
    }

    closeModal() {
        const modal = document.getElementById('media-modal');
        modal.style.display = 'none';
        this.currentModalData = null;
        this.selectedSeasons = [];
    }

    // ========================================
    // HISTORY
    // ========================================

    async loadHistory() {
        const container = document.getElementById('history-list');
        container.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Loading history...</p></div>';
        
        try {
            const response = await fetch('./api/requestarr/history');
            const data = await response.json();
            
            if (data.requests && data.requests.length > 0) {
                container.innerHTML = '';
                data.requests.forEach(request => {
                    container.appendChild(this.createHistoryItem(request));
                });
            } else {
                container.innerHTML = '<p style="color: #888; text-align: center; padding: 60px;">No request history</p>';
            }
        } catch (error) {
            console.error('[RequestarrDiscover] Error loading history:', error);
            container.innerHTML = '<p style="color: #ef4444; text-align: center; padding: 60px;">Failed to load history</p>';
        }
    }

    createHistoryItem(request) {
        const item = document.createElement('div');
        item.className = 'history-item';
        
        const posterUrl = request.poster_path || './static/images/no-poster.png';
        const date = new Date(request.requested_at).toLocaleDateString();
        
        item.innerHTML = `
            <div class="history-poster">
                <img src="${posterUrl}" alt="${request.title}">
            </div>
            <div class="history-info">
                <div class="history-title">${request.title} (${request.year || 'N/A'})</div>
                <div class="history-meta">
                    Requested to ${request.app_type === 'radarr' ? 'Radarr' : 'Sonarr'} - ${request.instance_name} on ${date}
                </div>
                <span class="history-status">Requested</span>
            </div>
        `;
        
        return item;
    }

    // ========================================
    // SETTINGS
    // ========================================

    async loadSettings() {
        console.log('[RequestarrDiscover] Loading settings...');
        
        const sonarrSelect = document.getElementById('default-sonarr-instance');
        const radarrSelect = document.getElementById('default-radarr-instance');
        
        if (sonarrSelect && radarrSelect) {
            sonarrSelect.innerHTML = '<option value="">No Instance Configured</option>';
            this.instances.sonarr.forEach(instance => {
                const option = document.createElement('option');
                option.value = instance.name;
                option.textContent = `Sonarr - ${instance.name}`;
                sonarrSelect.appendChild(option);
            });
            
            radarrSelect.innerHTML = '<option value="">No Instance Configured</option>';
            this.instances.radarr.forEach(instance => {
                const option = document.createElement('option');
                option.value = instance.name;
                option.textContent = `Radarr - ${instance.name}`;
                radarrSelect.appendChild(option);
            });
            
            try {
                const response = await fetch('./api/requestarr/settings/defaults');
                const data = await response.json();
                
                let needsAutoSelect = false;
                
                if (data.success && data.defaults) {
                    if (data.defaults.sonarr_instance) {
                        sonarrSelect.value = data.defaults.sonarr_instance;
                    } else if (this.instances.sonarr.length > 0) {
                        sonarrSelect.value = this.instances.sonarr[0].name;
                        needsAutoSelect = true;
                    }
                    
                    if (data.defaults.radarr_instance) {
                        radarrSelect.value = data.defaults.radarr_instance;
                    } else if (this.instances.radarr.length > 0) {
                        radarrSelect.value = this.instances.radarr[0].name;
                        needsAutoSelect = true;
                    }
                } else {
                    if (this.instances.sonarr.length > 0) {
                        sonarrSelect.value = this.instances.sonarr[0].name;
                        needsAutoSelect = true;
                    }
                    if (this.instances.radarr.length > 0) {
                        radarrSelect.value = this.instances.radarr[0].name;
                        needsAutoSelect = true;
                    }
                }
                
                if (needsAutoSelect) {
                    console.log('[RequestarrDiscover] Auto-selecting first available instances');
                    await this.saveSettings(true);
                }
                
            } catch (error) {
                console.error('[RequestarrDiscover] Error loading default instances:', error);
                if (this.instances.sonarr.length > 0 && sonarrSelect.value === '') {
                    sonarrSelect.value = this.instances.sonarr[0].name;
                }
                if (this.instances.radarr.length > 0 && radarrSelect.value === '') {
                    radarrSelect.value = this.instances.radarr[0].name;
                }
            }
        }
        
        const saveBtn = document.getElementById('save-requestarr-settings');
        if (saveBtn) {
            saveBtn.onclick = () => this.saveSettings();
        }
    }

    async saveSettings(silent = false) {
        const sonarrSelect = document.getElementById('default-sonarr-instance');
        const radarrSelect = document.getElementById('default-radarr-instance');
        const saveBtn = document.getElementById('save-requestarr-settings');
        
        if (!sonarrSelect || !radarrSelect) return;
        
        if (saveBtn && !silent) {
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
        }
        
        try {
            const response = await fetch('./api/requestarr/settings/defaults', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sonarr_instance: sonarrSelect.value,
                    radarr_instance: radarrSelect.value
                })
            });
            
            const data = await response.json();
            
            if (data.success) {
                if (!silent) {
                    this.showNotification('Settings saved successfully!', 'success');
                }
            } else {
                if (!silent) {
                    this.showNotification('Failed to save settings', 'error');
                }
            }
        } catch (error) {
            console.error('[RequestarrDiscover] Error saving settings:', error);
            if (!silent) {
                this.showNotification('Failed to save settings', 'error');
            }
        } finally {
            if (saveBtn && !silent) {
                saveBtn.disabled = false;
                saveBtn.innerHTML = '<i class="fas fa-save"></i> Save Settings';
            }
        }
    }

    // ========================================
    // UTILITIES
    // ========================================

    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `requestarr-notification ${type}`;
        notification.innerHTML = `
            <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i>
            <span>${message}</span>
        `;
        
        document.body.appendChild(notification);
        
        setTimeout(() => notification.classList.add('show'), 10);
        
        setTimeout(() => {
            notification.classList.remove('show');
            notification.classList.add('slideOut');
            setTimeout(() => notification.remove(), 300);
        }, 4000);
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.RequestarrDiscover = new RequestarrDiscover();
});
