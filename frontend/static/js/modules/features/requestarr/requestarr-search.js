/**
 * Requestarr Search - Global and per-view search functionality
 */

class RequestarrSearch {
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
            // Use the selected instances for library status checking
            let movieAppType = 'radarr';
            let movieInstanceName = '';
            const movieCompound = this.core.content ? this.core.content.selectedMovieInstance : null;
            if (movieCompound && movieCompound.includes(':')) {
                const idx = movieCompound.indexOf(':');
                movieAppType = movieCompound.substring(0, idx);
                movieInstanceName = movieCompound.substring(idx + 1);
            } else if (movieCompound) {
                movieInstanceName = movieCompound;
            }
            const tvInstanceName = (this.core.content ? this.core.content.selectedTVInstance : '') || '';

            const [moviesResponse, tvResponse] = await Promise.all([
                fetch(`./api/requestarr/search?q=${encodeURIComponent(query)}&app_type=${encodeURIComponent(movieAppType)}&instance_name=${encodeURIComponent(movieInstanceName)}`),
                fetch(`./api/requestarr/search?q=${encodeURIComponent(query)}&app_type=sonarr&instance_name=${encodeURIComponent(tvInstanceName)}`)
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
                    const suggestedInstance = item.media_type === 'movie' ? movieCompound : tvInstanceName;
                    resultsGrid.appendChild(this.core.content.createMediaCard(item, suggestedInstance));
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

}
