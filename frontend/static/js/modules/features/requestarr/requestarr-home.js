/**
 * Requestarr Home - Trending + global search for Home section
 */

const HomeRequestarr = {
    core: null,
    searchTimeout: null,
    elements: {},
    defaultMovieInstance: null,
    defaultTVInstance: null,
    showTrending: true,
    enableRequestarr: true,
    
    // Section rotation
    sections: ['trending', 'movies', 'tv'],
    currentSection: null,
    ROTATION_KEY: 'home_section_rotation',

    init() {
        this.cacheElements();

        if (!this.elements.searchInput) {
            return;
        }

        // Make this module globally accessible for auto-save visibility updates
        window.HomeRequestarr = this;

        // Force hide initially if we can't determine setting yet
        if (this.elements.discoverView) {
            this.elements.discoverView.style.setProperty('display', 'none', 'important');
        }

        // Load settings first to determine if Requestarr/trending should be shown
        this.loadSettings()
            .then(() => {
                this.applyRequestarrEnabledVisibility();

                if (!this.enableRequestarr) {
                    this.setupSearch(); // no-op for API when disabled; just prevent errors
                    return;
                }

                this.applyTrendingVisibility();

                if (!this.showTrending) {
                    this.setupSearch();
                    return;
                }

                this.waitForCore()
                    .then((core) => {
                        this.core = core;
                        this.setupSearch();
                        this.loadDefaultInstances().then(() => {
                            // Determine which section to show
                            const sectionToShow = this.getNextSection();
                            this.showSection(sectionToShow);
                            this.saveSection(sectionToShow);
                        });
                    })
                    .catch(() => {
                        this.showTrendingError('Requestarr modules not ready');
                    });
            });
    },

    async loadSettings() {
        try {
            const response = await fetch('./api/settings');
            const data = await response.json();
            if (data && data.general) {
                this.enableRequestarr = data.general.enable_requestarr !== false;
                this.showTrending = data.general.show_trending !== false;
                console.log('[HomeRequestarr] Enable Requestarr:', this.enableRequestarr, 'Show trending:', this.showTrending);
            }
        } catch (error) {
            console.error('[HomeRequestarr] Error loading settings:', error);
            this.enableRequestarr = true;
            this.showTrending = true;
        }
    },

    /** Hide/show the whole Requestarr home card (search + trending) based on enable_requestarr */
    applyRequestarrEnabledVisibility() {
        const card = document.querySelector('.requestarr-home-card');
        if (card) {
            card.style.display = this.enableRequestarr ? '' : 'none';
        }
    },

    applyTrendingVisibility() {
        const discoverView = this.elements.discoverView;
        if (discoverView) {
            console.log('[HomeRequestarr] Applying visibility to discoverView:', this.showTrending);
            if (this.showTrending) {
                discoverView.style.setProperty('display', 'block', 'important');
                // Load trending if not already loaded
                if (!this.elements.trendingCarousel.children.length || 
                    this.elements.trendingCarousel.querySelector('.loading-spinner')) {
                    this.loadTrending();
                }
            } else {
                discoverView.style.setProperty('display', 'none', 'important');
            }
        } else {
            console.warn('[HomeRequestarr] discoverView element not found in applyTrendingVisibility');
        }
    },

    cacheElements() {
        this.elements.searchInput = document.getElementById('home-requestarr-search-input');
        this.elements.searchResultsView = document.getElementById('home-search-results-view');
        this.elements.searchResultsGrid = document.getElementById('home-search-results-grid');
        this.elements.discoverView = document.getElementById('home-requestarr-discover-view');
        this.elements.trendingCarousel = document.getElementById('home-trending-carousel');
        this.elements.moviesCarousel = document.getElementById('home-movies-carousel');
        this.elements.tvCarousel = document.getElementById('home-tv-carousel');
        this.elements.trendingSection = document.getElementById('home-trending-section');
        this.elements.moviesSection = document.getElementById('home-movies-section');
        this.elements.tvSection = document.getElementById('home-tv-section');
    },
    
    getLastSection() {
        try {
            const data = localStorage.getItem(this.ROTATION_KEY);
            if (data) {
                const { section } = JSON.parse(data);
                return section;
            }
        } catch (e) {
            console.error('[HomeRequestarr] Error reading last section:', e);
        }
        return null;
    },
    
    getNextSection() {
        const lastSection = this.getLastSection();
        
        if (!lastSection || !this.sections.includes(lastSection)) {
            return 'trending';
        }
        
        const currentIndex = this.sections.indexOf(lastSection);
        const nextIndex = (currentIndex + 1) % this.sections.length;
        return this.sections[nextIndex];
    },
    
    saveSection(section) {
        try {
            const data = {
                section: section,
                timestamp: Date.now()
            };
            localStorage.setItem(this.ROTATION_KEY, JSON.stringify(data));
        } catch (e) {
            console.error('[HomeRequestarr] Error saving section:', e);
        }
    },
    
    showSection(section) {
        console.log('[HomeRequestarr] Showing section:', section);
        this.currentSection = section;
        
        // Hide all sections
        if (this.elements.trendingSection) this.elements.trendingSection.style.display = 'none';
        if (this.elements.moviesSection) this.elements.moviesSection.style.display = 'none';
        if (this.elements.tvSection) this.elements.tvSection.style.display = 'none';
        
        // Show and load the selected section
        switch (section) {
            case 'trending':
                if (this.elements.trendingSection) {
                    this.elements.trendingSection.style.display = 'block';
                    this.loadTrending();
                }
                break;
            case 'movies':
                if (this.elements.moviesSection) {
                    this.elements.moviesSection.style.display = 'block';
                    this.loadPopularMovies();
                }
                break;
            case 'tv':
                if (this.elements.tvSection) {
                    this.elements.tvSection.style.display = 'block';
                    this.loadPopularTV();
                }
                break;
        }
    },

    waitForCore() {
        return new Promise((resolve, reject) => {
            if (window.RequestarrDiscover) {
                resolve(window.RequestarrDiscover);
                return;
            }

            const startTime = Date.now();
            const checkInterval = setInterval(() => {
                if (window.RequestarrDiscover) {
                    clearInterval(checkInterval);
                    resolve(window.RequestarrDiscover);
                    return;
                }

                if (Date.now() - startTime > 2000) {
                    clearInterval(checkInterval);
                    reject(new Error('RequestarrDiscover not ready'));
                }
            }, 50);
        });
    },

    async loadDefaultInstances() {
        try {
            const settingsResponse = await fetch('./api/requestarr/settings/default-instances');
            const settingsData = await settingsResponse.json();
            if (settingsData.success && settingsData.defaults) {
                this.defaultMovieInstance = settingsData.defaults.movie_instance || null;
                this.defaultTVInstance = settingsData.defaults.tv_instance || null;
                console.log('[HomeRequestarr] Loaded default instances:', {
                    movie: this.defaultMovieInstance,
                    tv: this.defaultTVInstance
                });
            }
        } catch (error) {
            console.error('[HomeRequestarr] Error loading default instances:', error);
            this.defaultMovieInstance = null;
            this.defaultTVInstance = null;
        }
    },

    setupSearch() {
        this.elements.searchInput.addEventListener('input', (event) => {
            this.handleSearch(event.target.value);
        });
    },

    handleSearch(query) {
        if (!this.enableRequestarr) return;

        if (this.searchTimeout) {
            clearTimeout(this.searchTimeout);
        }

        if (!query.trim()) {
            this.showDiscover();
            return;
        }

        this.searchTimeout = setTimeout(() => {
            this.performSearch(query);
        }, 500);
    },

    showDiscover() {
        if (this.elements.searchResultsView) {
            this.elements.searchResultsView.style.display = 'none';
        }
        if (this.elements.discoverView) {
            if (this.showTrending) {
                this.elements.discoverView.style.setProperty('display', 'block', 'important');
            } else {
                this.elements.discoverView.style.setProperty('display', 'none', 'important');
            }
        }
    },

    showResults() {
        if (this.elements.discoverView) {
            this.elements.discoverView.style.display = 'none';
        }
        if (this.elements.searchResultsView) {
            this.elements.searchResultsView.style.display = 'block';
        }
    },

    async performSearch(query) {
        if (!this.enableRequestarr) return;
        this.showResults();

        if (!this.elements.searchResultsGrid) {
            return;
        }

        this.elements.searchResultsGrid.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Searching...</p></div>';

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
                this.elements.searchResultsGrid.innerHTML = '';
                allResults.forEach((item) => {
                    // Use appropriate default instance based on media type
                    const suggestedInstance = item.media_type === 'movie' 
                        ? this.defaultMovieInstance
                        : this.defaultTVInstance;
                    const card = this.createMediaCard(item, suggestedInstance);
                    if (card) {
                        this.elements.searchResultsGrid.appendChild(card);
                    }
                });
            } else {
                this.elements.searchResultsGrid.innerHTML = '<p style="color: #888; text-align: center; padding: 60px; width: 100%;">No results found</p>';
            }
        } catch (error) {
            console.error('[HomeRequestarr] Error searching:', error);
            this.elements.searchResultsGrid.innerHTML = '<p style="color: #ef4444; text-align: center; padding: 60px; width: 100%;">Search failed</p>';
        }
    },

    async loadTrending() {
        if (!this.enableRequestarr || !this.elements.trendingCarousel) {
            return;
        }

        try {
            const response = await fetch('./api/requestarr/discover/trending');
            const data = await response.json();

            if (data.results && data.results.length > 0) {
                this.elements.trendingCarousel.innerHTML = '';
                data.results.forEach((item) => {
                    // Use appropriate default instance based on media type
                    const suggestedInstance = item.media_type === 'movie' 
                        ? this.defaultMovieInstance
                        : this.defaultTVInstance;
                    const card = this.createMediaCard(item, suggestedInstance);
                    if (card) {
                        this.elements.trendingCarousel.appendChild(card);
                    }
                });
            } else {
                this.elements.trendingCarousel.innerHTML = '<p style="color: #888; text-align: center; width: 100%; padding: 40px;">No trending content available</p>';
            }
        } catch (error) {
            console.error('[HomeRequestarr] Error loading trending:', error);
            this.showTrendingError('Failed to load trending content');
        }
    },
    
    async loadPopularMovies() {
        if (!this.enableRequestarr || !this.elements.moviesCarousel) {
            return;
        }

        try {
            const response = await fetch('./api/requestarr/discover/movies?sort_by=popularity.desc');
            const data = await response.json();

            if (data.results && data.results.length > 0) {
                this.elements.moviesCarousel.innerHTML = '';
                data.results.slice(0, 20).forEach((item) => {
                    const card = this.createMediaCard(item, this.defaultMovieInstance);
                    if (card) {
                        this.elements.moviesCarousel.appendChild(card);
                    }
                });
            } else {
                this.elements.moviesCarousel.innerHTML = '<p style="color: #888; text-align: center; width: 100%; padding: 40px;">No popular movies available</p>';
            }
        } catch (error) {
            console.error('[HomeRequestarr] Error loading popular movies:', error);
            this.elements.moviesCarousel.innerHTML = '<p style="color: #ef4444; text-align: center; width: 100%; padding: 40px;">Failed to load popular movies</p>';
        }
    },
    
    async loadPopularTV() {
        if (!this.enableRequestarr || !this.elements.tvCarousel) {
            return;
        }

        try {
            const response = await fetch('./api/requestarr/discover/tv?sort_by=popularity.desc');
            const data = await response.json();

            if (data.results && data.results.length > 0) {
                this.elements.tvCarousel.innerHTML = '';
                data.results.slice(0, 20).forEach((item) => {
                    const card = this.createMediaCard(item, this.defaultTVInstance);
                    if (card) {
                        this.elements.tvCarousel.appendChild(card);
                    }
                });
            } else {
                this.elements.tvCarousel.innerHTML = '<p style="color: #888; text-align: center; width: 100%; padding: 40px;">No popular TV shows available</p>';
            }
        } catch (error) {
            console.error('[HomeRequestarr] Error loading popular TV:', error);
            this.elements.tvCarousel.innerHTML = '<p style="color: #ef4444; text-align: center; width: 100%; padding: 40px;">Failed to load popular TV shows</p>';
        }
    },

    showTrendingError(message) {
        if (this.elements.trendingCarousel) {
            this.elements.trendingCarousel.innerHTML = `<p style="color: #ef4444; text-align: center; width: 100%; padding: 40px;">${message}</p>`;
        }
    },

    createMediaCard(item, suggestedInstance = null) {
        if (!this.core || !this.core.content || typeof this.core.content.createMediaCard !== 'function') {
            return null;
        }

        return this.core.content.createMediaCard(item, suggestedInstance);
    }
};

document.addEventListener('DOMContentLoaded', () => {
    HomeRequestarr.init();
});
