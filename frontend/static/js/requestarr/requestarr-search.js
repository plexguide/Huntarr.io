/**
 * Requestarr Search - Global and per-view search functionality
 */

export class RequestarrSearch {
    constructor(core) {
        this.core = core;
    }

    // ========================================
    // GLOBAL SEARCH
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
        if (this.core.searchTimeouts['global']) {
            clearTimeout(this.core.searchTimeouts['global']);
        }
        
        if (!query.trim()) {
            this.hideElement('search-results-view');
            this.showElement('requestarr-discover-view');
            this.hideElement('requestarr-movies-view');
            this.hideElement('requestarr-tv-view');
            this.hideElement('requestarr-hidden-view');
            this.hideElement('requestarr-settings-view');
            return;
        }
        
        this.core.searchTimeouts['global'] = setTimeout(() => {
            this.performGlobalSearch(query);
        }, 500);
    }

    async performGlobalSearch(query) {
        const resultsView = document.getElementById('search-results-view');
        const resultsGrid = document.getElementById('search-results-grid');
        
        this.hideElement('requestarr-discover-view');
        this.hideElement('requestarr-movies-view');
        this.hideElement('requestarr-tv-view');
        this.hideElement('requestarr-hidden-view');
        this.hideElement('requestarr-settings-view');
        
        if (resultsView) {
            resultsView.style.display = 'block';
        }
        
        if (resultsGrid) {
            resultsGrid.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Searching...</p></div>';
        } else {
            console.error('[RequestarrSearch] search-results-grid not found');
            return;
        }
        
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
                    resultsGrid.appendChild(this.core.content.createMediaCard(item));
                });
            } else {
                resultsGrid.innerHTML = '<p style="color: #888; text-align: center; padding: 60px; width: 100%;">No results found</p>';
            }
        } catch (error) {
            console.error('[RequestarrDiscover] Error searching:', error);
            resultsGrid.innerHTML = '<p style="color: #ef4444; text-align: center; padding: 60px; width: 100%;">Search failed</p>';
        }
    }

    // Helper to safely hide elements
    hideElement(id) {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    }

    // Helper to safely show elements
    showElement(id) {
        const el = document.getElementById(id);
        if (el) el.style.display = 'block';
    }

    // ========================================
    // PER-VIEW SEARCH
    // ========================================

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
        
        if (this.core.searchTimeouts[timeoutKey]) {
            clearTimeout(this.core.searchTimeouts[timeoutKey]);
        }
        
        if (!query.trim()) {
            if (mediaType === 'movie') {
                this.core.content.loadMovies();
            } else {
                this.core.content.loadTV();
            }
            return;
        }
        
        this.core.searchTimeouts[timeoutKey] = setTimeout(() => {
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
                    carousel.appendChild(this.core.content.createMediaCard(item));
                });
            } else {
                carousel.innerHTML = '<p style="color: #888; text-align: center; width: 100%; padding: 40px;">No results found</p>';
            }
        } catch (error) {
            console.error('[RequestarrDiscover] Error searching:', error);
            carousel.innerHTML = '<p style="color: #ef4444; text-align: center; width: 100%; padding: 40px;">Search failed</p>';
        }
    }
}
