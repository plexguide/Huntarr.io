/**
 * Requestarr Content - Content loading and media card creation
 */

export class RequestarrContent {
    constructor(core) {
        this.core = core;
        this.moviesPage = 1;
        this.moviesHasMore = true;
        this.isLoadingMovies = false;
        this.moviesObserver = null;
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

    setupMoviesInfiniteScroll() {
        const sentinel = document.getElementById('movies-scroll-sentinel');
        if (!sentinel || this.moviesObserver) {
            return;
        }

        this.moviesObserver = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) {
                    return;
                }
                if (this.moviesHasMore && !this.isLoadingMovies) {
                    this.loadMoreMovies();
                }
            });
        }, {
            root: null,
            rootMargin: '200px 0px',
            threshold: 0
        });

        this.moviesObserver.observe(sentinel);
    }

    async loadMovies(page = 1) {
        const grid = document.getElementById('movies-grid');
        
        if (!grid) {
            return;
        }

        if (this.isLoadingMovies) {
            return;
        }

        this.isLoadingMovies = true;

        // Show loading spinner on first page
        if (this.moviesPage === 1) {
            grid.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Loading movies...</p></div>';
        }
        
        try {
            let url = `./api/requestarr/discover/movies?page=${this.moviesPage}`;
            
            // Add filter parameters
            if (this.core.filters) {
                const filterParams = this.core.filters.getFilterParams();
                if (filterParams) {
                    url += `&${filterParams}`;
                }
            }
            
            const response = await fetch(url);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            
            if (data.results && data.results.length > 0) {
                if (this.moviesPage === 1) {
                    grid.innerHTML = '';
                }
                
                data.results.forEach((item) => {
                    grid.appendChild(this.createMediaCard(item));
                });

                // Determine if more results are available
                if (data.results.length >= 20) {
                    this.moviesHasMore = true;
                } else {
                    this.moviesHasMore = false;
                }
            } else {
                if (this.moviesPage === 1) {
                    grid.innerHTML = '<p style="color: #888; text-align: center; width: 100%; padding: 40px;">No movies found</p>';
                }
                this.moviesHasMore = false;
            }
        } catch (error) {
            console.error('[RequestarrContent] Error loading movies:', error);
            if (this.moviesPage === 1) {
                grid.innerHTML = '<p style="color: #ef4444; text-align: center; width: 100%; padding: 40px;">Failed to load movies</p>';
            }
        } finally {
            this.isLoadingMovies = false;

            const sentinel = document.getElementById('movies-scroll-sentinel');
            if (sentinel && this.moviesHasMore) {
                const rect = sentinel.getBoundingClientRect();
                const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
                if (rect.top <= viewportHeight + 200) {
                    this.loadMoreMovies();
                }
            }
        }
    }
    
    loadMoreMovies() {
        if (this.moviesHasMore && !this.isLoadingMovies) {
            this.moviesPage++;
            this.loadMovies(this.moviesPage);
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
    // MEDIA CARD CREATION
    // ========================================

    createMediaCard(item) {
        const card = document.createElement('div');
        card.className = 'media-card';
        
        // Store tmdb_id and media_type as data attributes for easy updates
        card.setAttribute('data-tmdb-id', item.tmdb_id);
        card.setAttribute('data-media-type', item.media_type);
        
        const posterUrl = item.poster_path || './static/images/blackout.jpg';
        const year = item.year || 'N/A';
        const rating = item.vote_average ? item.vote_average.toFixed(1) : 'N/A';
        const overview = item.overview || 'No description available.';
        
        const inLibrary = item.in_library || false;
        const partial = item.partial || false;
        const inCooldown = item.in_cooldown || false;
        
        // Determine status badge
        let statusBadgeHTML = '';
        if (inCooldown) {
            // Red stop sign for cooldown
            statusBadgeHTML = '<div class="media-card-status-badge cooldown"><i class="fas fa-hand"></i></div>';
        } else if (inLibrary) {
            // Green checkmark for complete
            statusBadgeHTML = '<div class="media-card-status-badge complete"><i class="fas fa-check"></i></div>';
        } else if (partial) {
            // Orange exclamation for partial
            statusBadgeHTML = '<div class="media-card-status-badge partial"><i class="fas fa-exclamation"></i></div>';
        } else {
            // Blue download icon for available
            statusBadgeHTML = '<div class="media-card-status-badge available"><i class="fas fa-download"></i></div>';
        }
        
        if (inLibrary) {
            card.classList.add('in-library');
        }
        
        card.innerHTML = `
            <div class="media-card-poster">
                ${statusBadgeHTML}
                <img src="${posterUrl}" alt="${item.title}" onerror="this.src='./static/images/blackout.jpg'">
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
            this.core.modal.openModal(item.tmdb_id, item.media_type);
        });
        
        if (requestBtn) {
            requestBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.core.modal.openModal(item.tmdb_id, item.media_type);
            });
        }
        
        return card;
    }
}
