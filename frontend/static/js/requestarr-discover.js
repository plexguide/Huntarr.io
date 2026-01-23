/**
 * Requestarr Discover - Horizontal scrolling media discovery system
 */

class RequestarrDiscover {
    constructor() {
        this.currentView = 'discover';
        this.instances = { sonarr: [], radarr: [] };
        this.searchTimeouts = {};
        this.currentModal = null;
        this.init();
    }

    init() {
        console.log('[RequestarrDiscover] Initializing...');
        this.loadInstances();
        this.setupCarouselArrows();
        this.setupSearchHandlers();
        this.setupGlobalSearch();
        this.loadDiscoverContent();
    }

    // Carousel Arrow Controls
    setupCarouselArrows() {
        const arrows = document.querySelectorAll('.carousel-arrow');
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
        }
    }

    // Load Instances
    async loadInstances() {
        try {
            const response = await fetch('./api/requestarr/instances');
            const data = await response.json();
            
            if (data.success) {
                this.instances = data.instances;
                console.log('[RequestarrDiscover] Loaded instances:', this.instances);
            }
        } catch (error) {
            console.error('[RequestarrDiscover] Error loading instances:', error);
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
                    <div class="media-card-overlay-content">
                        <div class="media-card-overlay-title">${item.title}</div>
                        <div class="media-card-overlay-year">${year}</div>
                        <div class="media-card-overlay-description">${overview}</div>
                    </div>
                    <button class="media-card-request-btn">
                        <i class="fas fa-download"></i> Request
                    </button>
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

    renderModal(data) {
        const modal = document.getElementById('media-modal');
        
        // Set backdrop
        const backdrop = modal.querySelector('.modal-backdrop-image');
        if (data.backdrop_path) {
            backdrop.style.backgroundImage = `url(${data.backdrop_path})`;
        } else {
            backdrop.style.backgroundImage = 'none';
            backdrop.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
        }
        
        // Set poster
        const poster = modal.querySelector('.modal-poster img');
        poster.src = data.poster_path || './static/images/no-poster.png';
        poster.alt = data.title;
        
        // Set title and meta
        modal.querySelector('.modal-title').textContent = data.title;
        
        const metaHTML = [
            data.year ? `<span class="year">${data.year}</span>` : '',
            data.vote_average ? `<span class="rating"><i class="fas fa-star"></i> ${data.vote_average.toFixed(1)}</span>` : '',
            data.runtime ? `<span class="runtime">${data.runtime} min</span>` : '',
            data.number_of_seasons ? `<span>${data.number_of_seasons} Season${data.number_of_seasons > 1 ? 's' : ''}</span>` : ''
        ].filter(Boolean).join('');
        modal.querySelector('.modal-meta').innerHTML = metaHTML;
        
        // Set genres
        if (data.genres && data.genres.length > 0) {
            const genresHTML = data.genres.map(g => `<span class="genre-tag">${g}</span>`).join('');
            modal.querySelector('.modal-genres').innerHTML = genresHTML;
        } else {
            modal.querySelector('.modal-genres').innerHTML = '';
        }
        
        // Set overview
        modal.querySelector('.modal-overview').textContent = data.overview || 'No overview available.';
        
        // Populate instance dropdown
        this.populateInstanceDropdown(data.media_type);
        
        // Set up request button
        this.setupRequestButton(data);
        
        // Set cast
        if (data.cast && data.cast.length > 0) {
            const castHTML = data.cast.map(person => `
                <div class="cast-member">
                    <div class="cast-avatar">
                        <img src="${person.profile_path || './static/images/no-avatar.png'}" alt="${person.name}">
                    </div>
                    <div class="cast-name">${person.name}</div>
                    <div class="cast-character">${person.character || ''}</div>
                </div>
            `).join('');
            modal.querySelector('.cast-list').innerHTML = castHTML;
        } else {
            modal.querySelector('.cast-list').innerHTML = '<p style="color: #888;">No cast information available</p>';
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

    closeModal() {
        const modal = document.getElementById('media-modal');
        modal.style.display = 'none';
        this.currentModal = null;
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
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.RequestarrDiscover = new RequestarrDiscover();
});
