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
        this.init();
    }

    async init() {
        console.log('[RequestarrDiscover] Initializing...');
        await this.loadInstances();
        this.setupCarouselArrows();
        this.setupSearchHandlers();
        this.setupGlobalSearch();
        this.loadDiscoverContent();
    }

    // Carousel Arrow Controls
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
            
            // Update on scroll
            carousel.addEventListener('scroll', updateArrowVisibility);
            
            // Initial update after content loads
            setTimeout(() => updateArrowVisibility(), 100);
            
            // Update when window resizes
            window.addEventListener('resize', updateArrowVisibility);
        });
        
        // Click handlers
        arrows.forEach(arrow => {
            arrow.addEventListener('click', (e) => {
                const targetId = arrow.dataset.target;
                const carousel = document.getElementById(targetId);
                
                // Calculate scroll amount based on visible items
                const carouselWidth = carousel.offsetWidth;
                const cardWidth = 150; // Card width in pixels
                const gap = 20; // Gap between cards
                const itemWidth = cardWidth + gap;
                
                // Calculate how many items are visible
                const visibleItems = Math.floor(carouselWidth / itemWidth);
                
                // Scroll by the number of visible items
                const scrollAmount = visibleItems * itemWidth;
                
                if (arrow.classList.contains('left')) {
                    carousel.scrollBy({
                        left: -scrollAmount,
                        behavior: 'smooth'
                    });
                } else {
                    carousel.scrollBy({
                        left: scrollAmount,
                        behavior: 'smooth'
                    });
                }
            });
        });
    }

    // View Switching (called from external sidebar)
    switchView(view) {
        console.log('[RequestarrDiscover] Switching to view:', view);
        
        // Clear global search
        const globalSearch = document.getElementById('global-search-input');
        if (globalSearch) {
            globalSearch.value = '';
        }
        
        // Hide search results view
        document.getElementById('search-results-view').style.display = 'none';
        
        // Hide global search bar for settings and history views
        const globalSearchBar = document.querySelector('.global-search-bar');
        if (globalSearchBar) {
            if (view === 'settings' || view === 'history') {
                globalSearchBar.style.display = 'none';
            } else {
                globalSearchBar.style.display = 'flex';
            }
        }
        
        // Update views
        document.querySelectorAll('.requestarr-view').forEach(container => {
            container.classList.toggle('active', container.id === `requestarr-${view}-view`);
        });

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

    // Load Instances
    async loadInstances() {
        try {
            const response = await fetch('./api/requestarr/instances');
            const data = await response.json();
            
            // API returns {sonarr: [], radarr: []} directly
            if (data.sonarr || data.radarr) {
                this.instances = {
                    sonarr: data.sonarr || [],
                    radarr: data.radarr || []
                };
                console.log('[RequestarrDiscover] Loaded instances:', this.instances);
                
                // Load quality profiles for all instances
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

    // Discover Content
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

    // Movies View
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

    // TV View
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

    // Global Search
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
            // Show discover view, hide search results
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
        
        // Hide all views except search results
        discoverView.style.display = 'none';
        document.getElementById('requestarr-movies-view').style.display = 'none';
        document.getElementById('requestarr-tv-view').style.display = 'none';
        document.getElementById('requestarr-history-view').style.display = 'none';
        resultsView.style.display = 'block';
        
        resultsGrid.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Searching...</p></div>';
        
        try {
            // Search both movies and TV
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
            
            // Sort by popularity (highest first)
            allResults.sort((a, b) => {
                const popularityA = a.popularity || 0;
                const popularityB = b.popularity || 0;
                return popularityB - popularityA; // Descending order
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

    // Search
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
            // Load default content
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

    // Create Media Card
    createMediaCard(item) {
        const card = document.createElement('div');
        card.className = 'media-card';
        
        const posterUrl = item.poster_path || './static/images/no-poster.png';
        const year = item.year || 'N/A';
        const rating = item.vote_average ? item.vote_average.toFixed(1) : 'N/A';
        const overview = item.overview || 'No description available.';
        
        card.innerHTML = `
            <div class="media-card-poster">
                <img src="${posterUrl}" alt="${item.title}" onerror="this.src='./static/images/no-poster.png'">
                <div class="media-card-overlay">
                    <div class="media-card-overlay-title">${item.title}</div>
                    <div class="media-card-overlay-content">
                        <div class="media-card-overlay-year">${year}</div>
                        <div class="media-card-overlay-description">${overview}</div>
                        <button class="media-card-request-btn">
                            <i class="fas fa-download"></i> Request
                        </button>
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
        
        // Add click handlers
        const posterDiv = card.querySelector('.media-card-poster');
        const overlay = card.querySelector('.media-card-overlay');
        const requestBtn = card.querySelector('.media-card-request-btn');
        
        // Poster/overlay click opens modal (but not when clicking button)
        posterDiv.addEventListener('click', (e) => {
            if (e.target !== requestBtn && !requestBtn.contains(e.target)) {
                this.openModal(item.tmdb_id, item.media_type);
            }
        });
        
        // Request button opens modal directly
        requestBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.openModal(item.tmdb_id, item.media_type);
        });
        
        return card;
    }

    // Modal
    async openModal(tmdbId, mediaType) {
        const modal = document.getElementById('media-modal');
        const modalBody = modal.querySelector('.modal-body');
        
        // Show modal with loading state
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
        
        // Build modal HTML
        const isTVShow = data.media_type === 'tv';
        const instances = isTVShow ? this.instances.sonarr : this.instances.radarr;
        console.log('[RequestarrDiscover] Modal instances:', {
            isTVShow,
            instances,
            allInstances: this.instances
        });
        
        // Get remembered instance or use first
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
        
        // For TV Shows: Show status after instance selection
        if (isTVShow) {
            modalHTML += `
                <div class="request-advanced-section">
                    <div class="advanced-field">
                        <label>Sonarr Instance</label>
                        <select id="modal-instance-select" class="advanced-select" onchange="window.RequestarrDiscover.loadSeriesStatus(this.value)">
                            <option value="">Select an instance...</option>
            `;
            
            instances.forEach((instance, index) => {
                const selected = instance.name === rememberedInstance ? 'selected' : '';
                modalHTML += `<option value="${instance.name}" ${selected}>Sonarr - ${instance.name}</option>`;
            });
            
            modalHTML += `
                        </select>
                    </div>
                </div>
                
                <!-- Status container -->
                <div id="series-status-container" style="margin-bottom: 15px;"></div>
                
                <!-- Tags and Quality Profile -->
                <div class="request-advanced-section">
                    <div class="advanced-field">
                        <label>Tags</label>
                        <input type="text" id="modal-tags" class="advanced-input" placeholder="Enter tags (comma-separated)">
                    </div>
                    <div class="advanced-field">
                        <label>Quality Profile</label>
                        <select id="modal-quality-profile" class="advanced-select">
                            <option value="">Any (Default)</option>
                        </select>
                    </div>
                </div>
            `;
        } else {
            // For Movies: Keep existing layout
            const profileKey = `radarr-${rememberedInstance || (instances[0]?.name || '')}`;
            const profiles = this.qualityProfiles[profileKey] || [];
            
            modalHTML += `
                <div class="request-advanced-section">
                    <div class="advanced-field">
                        <label>Quality Profile</label>
                        <select id="modal-quality-profile" class="advanced-select">
                            <option value="">Any (Default)</option>
            `;
            
            profiles.forEach(profile => {
                modalHTML += `<option value="${profile.id}">${profile.name}</option>`;
            });
            
            modalHTML += `
                        </select>
                    </div>
                    
                    <div class="advanced-field">
                        <label>Tags</label>
                        <input type="text" id="modal-tags" class="advanced-input" placeholder="Enter tags (comma-separated)">
                    </div>
                    
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
        
        modalHTML += `
            <div class="request-modal-actions">
                <button class="modal-btn cancel-btn" onclick="window.RequestarrDiscover.closeModal()">Cancel</button>
                <button class="modal-btn request-btn" id="modal-request-btn" onclick="window.RequestarrDiscover.submitRequest()">
                    Request
                </button>
            </div>
        </div>
        `;
        
        modalBody.innerHTML = modalHTML;
        
        // Store current modal data
        this.currentModalData = data;
        this.selectedSeasons = [];
        
        // Update quality profiles
        if (isTVShow && rememberedInstance) {
            const profileKey = `sonarr-${rememberedInstance}`;
            const profiles = this.qualityProfiles[profileKey] || [];
            const qualitySelect = document.getElementById('modal-quality-profile');
            if (qualitySelect) {
                profiles.forEach(profile => {
                    const option = document.createElement('option');
                    option.value = profile.id;
                    option.textContent = profile.name;
                    qualitySelect.appendChild(option);
                });
            }
            
            // Load series status if instance already selected
            this.loadSeriesStatus(rememberedInstance);
        }
        
        // Enable/disable request button
        if (instances.length === 0) {
            const btn = document.getElementById('modal-request-btn');
            if (btn) {
                btn.disabled = true;
                btn.classList.add('disabled');
            }
        }
    }

    // Load series status when instance is selected
    async loadSeriesStatus(instanceName) {
        if (!instanceName) {
            const container = document.getElementById('series-status-container');
            if (container) {
                container.innerHTML = '';
            }
            return;
        }
        
        console.log('[RequestarrDiscover] Loading series status for instance:', instanceName);
        
        // Show loading state
        const container = document.getElementById('series-status-container');
        if (container) {
            container.innerHTML = `
                <div style="text-align: center; padding: 20px;">
                    <i class="fas fa-spinner fa-spin" style="font-size: 24px; color: #667eea;"></i>
                    <p style="margin-top: 10px; color: rgba(255, 255, 255, 0.7); font-size: 14px;">Checking series status...</p>
                </div>
            `;
        }
        
        try {
            // Get series status from Sonarr
            const response = await fetch(`./api/requestarr/series-status?tmdb_id=${this.currentModalData.tmdb_id}&instance=${instanceName}`);
            const status = await response.json();
            
            console.log('[RequestarrDiscover] Series status:', status);
            
            let statusHTML = '';
            
            if (status.exists) {
                // Series exists in Sonarr - show status
                const percentComplete = status.total_episodes > 0 
                    ? Math.round((status.available_episodes / status.total_episodes) * 100)
                    : 0;
                
                statusHTML = `
                    <div style="background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 8px; padding: 15px; margin-bottom: 15px;">
                        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px;">
                            <i class="fas fa-info-circle" style="color: #f59e0b; font-size: 20px;"></i>
                            <div>
                                <div style="font-weight: 600; color: #fff; font-size: 14px;">Series Status in Sonarr</div>
                                <div style="font-size: 12px; color: rgba(255, 255, 255, 0.7); margin-top: 2px;">
                                    ${status.missing_episodes} of ${status.total_episodes} episodes missing (${percentComplete}% complete)
                                </div>
                            </div>
                        </div>
                        ${status.missing_episodes > 0 
                            ? `<div style="font-size: 12px; color: rgba(255, 255, 255, 0.6);">
                                <i class="fas fa-lightbulb" style="margin-right: 5px;"></i>
                                Request this series again to search for missing episodes
                            </div>`
                            : `<div style="font-size: 12px; color: #22c55e;">
                                <i class="fas fa-check-circle" style="margin-right: 5px;"></i>
                                All episodes available!
                            </div>`
                        }
                    </div>
                `;
            } else {
                // Series not in Sonarr
                statusHTML = `
                    <div style="background: rgba(102, 126, 234, 0.1); border: 1px solid rgba(102, 126, 234, 0.3); border-radius: 8px; padding: 15px; margin-bottom: 15px;">
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <i class="fas fa-plus-circle" style="color: #667eea; font-size: 20px;"></i>
                            <div>
                                <div style="font-weight: 600; color: #fff; font-size: 14px;">Not in Sonarr</div>
                                <div style="font-size: 12px; color: rgba(255, 255, 255, 0.7); margin-top: 2px;">
                                    This series is not yet in your library
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            }
            
            if (container) {
                container.innerHTML = statusHTML;
            }
            
            // Update quality profiles for this instance
            const profileKey = `sonarr-${instanceName}`;
            const profiles = this.qualityProfiles[profileKey] || [];
            const qualitySelect = document.getElementById('modal-quality-profile');
            
            if (qualitySelect) {
                qualitySelect.innerHTML = '<option value="">Any (Default)</option>';
                profiles.forEach(profile => {
                    const option = document.createElement('option');
                    option.value = profile.id;
                    option.textContent = profile.name;
                    qualitySelect.appendChild(option);
                });
            }
            
            // Save instance selection
            localStorage.setItem('huntarr-requestarr-instance-sonarr', instanceName);
            
        } catch (error) {
            console.error('[RequestarrDiscover] Error loading series status:', error);
            if (container) {
                container.innerHTML = `
                    <div style="text-align: center; padding: 20px; color: #ef4444;">
                        <i class="fas fa-exclamation-triangle" style="font-size: 24px; margin-bottom: 10px;"></i>
                        <p style="font-size: 14px;">Failed to load series status</p>
                    </div>
                `;
            }
        }
    }

    // Check which seasons are already requested in Sonarr
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

    // Toggle season selection (no longer used, but kept for compatibility)
    toggleSeason(checkbox) {
        // No-op - season selection removed
    }

    // Remember instance selection
    instanceChanged(instanceName) {
        const isTVShow = this.currentModalData.media_type === 'tv';
        const instanceKey = isTVShow ? 'sonarr' : 'radarr';
        const appType = isTVShow ? 'sonarr' : 'radarr';
        
        localStorage.setItem(`huntarr-requestarr-instance-${instanceKey}`, instanceName);
        console.log('[RequestarrDiscover] Instance changed to:', instanceName);
        
        // Update quality profile dropdown
        const profileKey = `${appType}-${instanceName}`;
        const profiles = this.qualityProfiles[profileKey] || [];
        const qualitySelect = document.getElementById('modal-quality-profile');
        
        if (qualitySelect) {
            qualitySelect.innerHTML = '<option value="">Any (Default)</option>';
            profiles.forEach(profile => {
                const option = document.createElement('option');
                option.value = profile.id;
                option.textContent = profile.name;
                qualitySelect.appendChild(option);
            });
        }
        
        // For TV shows, reload modal to check requested seasons for new instance
        if (isTVShow) {
            this.renderModal(this.currentModalData);
        }
    }

    // Submit request
    async submitRequest() {
        const instanceSelect = document.getElementById('modal-instance-select');
        const qualityProfile = document.getElementById('modal-quality-profile').value;
        const tags = document.getElementById('modal-tags').value;
        const requestBtn = document.getElementById('modal-request-btn');
        
        if (!instanceSelect.value) {
            this.showNotification('Please select an instance', 'error');
            return;
        }
        
        const isTVShow = this.currentModalData.media_type === 'tv';
        
        // For TV shows, ensure at least one season is selected
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
                quality_profile: qualityProfile,
                tags: tags.split(',').map(t => t.trim()).filter(t => t)
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

    populateInstanceDropdown(mediaType) {
        const select = document.getElementById('modal-instance-select');
        const instances = mediaType === 'movie' ? this.instances.radarr : this.instances.sonarr;
        
        select.innerHTML = '<option value="">Select an instance...</option>';
        
        instances.forEach(instance => {
            const option = document.createElement('option');
            option.value = JSON.stringify({
                name: instance.name,
                app_type: mediaType === 'movie' ? 'radarr' : 'sonarr'
            });
            option.textContent = `${mediaType === 'movie' ? 'Radarr' : 'Sonarr'} - ${instance.name}`;
            select.appendChild(option);
        });
    }

    setupRequestButton(data) {
        const select = document.getElementById('modal-instance-select');
        const btn = document.getElementById('modal-request-btn');
        const status = document.getElementById('modal-status');
        
        // Enable button when instance selected
        select.onchange = () => {
            btn.disabled = !select.value;
        };
        
        // Handle request
        btn.onclick = async () => {
            if (!select.value) return;
            
            const instance = JSON.parse(select.value);
            status.className = 'modal-status';
            status.style.display = 'none';
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Requesting...';
            
            try {
                const response = await fetch('./api/requestarr/request', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        tmdb_id: data.tmdb_id,
                        media_type: data.media_type,
                        title: data.title,
                        year: data.year || 0,
                        overview: data.overview || '',
                        poster_path: data.poster_path || '',
                        backdrop_path: data.backdrop_path || '',
                        app_type: instance.app_type,
                        instance_name: instance.name
                    })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    status.className = 'modal-status success show';
                    status.textContent = result.message;
                    btn.innerHTML = '<i class="fas fa-check"></i> Requested';
                } else {
                    throw new Error(result.message);
                }
            } catch (error) {
                console.error('[RequestarrDiscover] Request error:', error);
                status.className = 'modal-status error show';
                status.textContent = error.message || 'Failed to request';
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-plus"></i> Request';
            }
        };
    }

    showNotification(message, type = 'info') {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `requestarr-notification ${type}`;
        notification.innerHTML = `
            <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i>
            <span>${message}</span>
        `;
        
        document.body.appendChild(notification);
        
        // Show notification
        setTimeout(() => notification.classList.add('show'), 10);
        
        // Hide and remove after 4 seconds
        setTimeout(() => {
            notification.classList.remove('show');
            notification.classList.add('slideOut');
            setTimeout(() => notification.remove(), 300);
        }, 4000);
    }

    closeModal() {
        const modal = document.getElementById('media-modal');
        modal.style.display = 'none';
        this.currentModalData = null;
        this.selectedSeasons = [];
    }

    // History
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

    // Settings View
    async loadSettings() {
        console.log('[RequestarrDiscover] Loading settings...');
        
        // Ensure instances are loaded
        if (this.instances.sonarr.length === 0 && this.instances.radarr.length === 0) {
            console.log('[RequestarrDiscover] Instances not loaded yet, fetching...');
            await this.loadInstances();
        }
        
        // Populate instance dropdowns
        const sonarrSelect = document.getElementById('default-sonarr-instance');
        const radarrSelect = document.getElementById('default-radarr-instance');
        
        if (sonarrSelect && radarrSelect) {
            // Populate Sonarr instances
            sonarrSelect.innerHTML = '';
            if (this.instances.sonarr.length === 0) {
                sonarrSelect.innerHTML = '<option value="">No Instance Configured</option>';
                sonarrSelect.disabled = true;
            } else {
                sonarrSelect.disabled = false;
                this.instances.sonarr.forEach(instance => {
                    const option = document.createElement('option');
                    option.value = instance.name;
                    option.textContent = `Sonarr - ${instance.name}`;
                    sonarrSelect.appendChild(option);
                });
            }
            
            // Populate Radarr instances
            radarrSelect.innerHTML = '';
            if (this.instances.radarr.length === 0) {
                radarrSelect.innerHTML = '<option value="">No Instance Configured</option>';
                radarrSelect.disabled = true;
            } else {
                radarrSelect.disabled = false;
                this.instances.radarr.forEach(instance => {
                    const option = document.createElement('option');
                    option.value = instance.name;
                    option.textContent = `Radarr - ${instance.name}`;
                    radarrSelect.appendChild(option);
                });
            }
            
            // Load current defaults
            try {
                const response = await fetch('./api/requestarr/settings/defaults');
                const data = await response.json();
                
                let needsAutoSave = false;
                
                if (data.success && data.defaults) {
                    // Set saved defaults if they exist
                    if (data.defaults.sonarr_instance) {
                        sonarrSelect.value = data.defaults.sonarr_instance;
                    } else if (this.instances.sonarr.length > 0) {
                        // No default saved but instances exist - auto-select first
                        sonarrSelect.value = this.instances.sonarr[0].name;
                        needsAutoSave = true;
                    }
                    
                    if (data.defaults.radarr_instance) {
                        radarrSelect.value = data.defaults.radarr_instance;
                    } else if (this.instances.radarr.length > 0) {
                        // No default saved but instances exist - auto-select first
                        radarrSelect.value = this.instances.radarr[0].name;
                        needsAutoSave = true;
                    }
                } else {
                    // No defaults at all - auto-select first instances if available
                    if (this.instances.sonarr.length > 0) {
                        sonarrSelect.value = this.instances.sonarr[0].name;
                        needsAutoSave = true;
                    }
                    if (this.instances.radarr.length > 0) {
                        radarrSelect.value = this.instances.radarr[0].name;
                        needsAutoSave = true;
                    }
                }
                
                // Auto-save if we selected first instances
                if (needsAutoSave) {
                    console.log('[RequestarrDiscover] Auto-selecting first instances and saving...');
                    await this.saveSettings(true); // true = silent save
                }
            } catch (error) {
                console.error('[RequestarrDiscover] Error loading default instances:', error);
            }
        }
        
        // Setup save button
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
        
        // Disable button while saving (only if not silent)
        if (!silent && saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
        }
        
        try {
            const response = await fetch('./api/requestarr/settings/defaults', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sonarr_instance: sonarrSelect.value || null,
                    radarr_instance: radarrSelect.value || null
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
            // Re-enable button (only if not silent)
            if (!silent && saveBtn) {
                saveBtn.disabled = false;
                saveBtn.innerHTML = '<i class="fas fa-save"></i> Save Settings';
            }
        }
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.RequestarrDiscover = new RequestarrDiscover();
});
