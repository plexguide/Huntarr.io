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
        this.tvPage = 1;
        this.tvHasMore = true;
        this.isLoadingTV = false;
        this.tvObserver = null;
        this.moviesRequestToken = 0;
        this.tvRequestToken = 0;
        this.activeMovieInstance = null;
        this.activeTVInstance = null;
        
        // Instance tracking
        this.selectedMovieInstance = null;
        this.selectedTVInstance = null;
    }

    // ========================================
    // INSTANCE MANAGEMENT
    // ========================================

    async setupInstanceSelectors() {
        // Load and populate instance selectors
        await this.loadMovieInstances();
        await this.loadTVInstances();
    }

    async loadMovieInstances() {
        const select = document.getElementById('movies-instance-select');
        if (!select) return;

        try {
            const response = await fetch('./api/requestarr/instances/radarr');
            const data = await response.json();
            
            if (data.instances && data.instances.length > 0) {
                select.innerHTML = '';
                data.instances.forEach((instance, index) => {
                    const option = document.createElement('option');
                    option.value = instance.name;
                    option.textContent = `Radarr - ${instance.name}`;
                    if (index === 0) option.selected = true;
                    select.appendChild(option);
                });
                
                // Set initial selected instance
                this.selectedMovieInstance = data.instances[0].name;
                
                // Setup change handler
                select.addEventListener('change', async () => {
                    this.selectedMovieInstance = select.value;
                    console.log(`[RequestarrContent] Switched to movie instance: ${this.selectedMovieInstance}`);
                    
                    // Clear the grid immediately
                    const grid = document.getElementById('movies-grid');
                    if (grid) {
                        grid.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Loading movies...</p></div>';
                    }
                    
                    // Disconnect infinite scroll observer during instance switch to prevent auto-loading
                    if (this.moviesObserver) {
                        this.moviesObserver.disconnect();
                        this.moviesObserver = null;
                    }
                    
                    // Reset pagination state
                    this.moviesPage = 1;
                    this.moviesHasMore = true;
                    this.isLoadingMovies = false;
                    
                    // Increment request token to cancel any pending requests
                    this.moviesRequestToken++;
                    
                    // Small delay to ensure state is fully reset
                    await new Promise(resolve => setTimeout(resolve, 50));
                    
                    // Await the load to complete before reconnecting scroll
                    await this.loadMovies();
                    
                    // Reconnect infinite scroll after load completes
                    this.setupMoviesInfiniteScroll();
                });
            } else {
                select.innerHTML = '<option value="">No Radarr instances configured</option>';
                this.selectedMovieInstance = null;
            }
        } catch (error) {
            console.error('[RequestarrContent] Error loading movie instances:', error);
            select.innerHTML = '<option value="">Error loading instances</option>';
        }
    }

    async loadTVInstances() {
        const select = document.getElementById('tv-instance-select');
        if (!select) return;

        try {
            const response = await fetch('./api/requestarr/instances/sonarr');
            const data = await response.json();
            
            if (data.instances && data.instances.length > 0) {
                select.innerHTML = '';
                data.instances.forEach((instance, index) => {
                    const option = document.createElement('option');
                    option.value = instance.name;
                    option.textContent = `Sonarr - ${instance.name}`;
                    if (index === 0) option.selected = true;
                    select.appendChild(option);
                });
                
                // Set initial selected instance
                this.selectedTVInstance = data.instances[0].name;
                
                // Setup change handler
                select.addEventListener('change', async () => {
                    this.selectedTVInstance = select.value;
                    console.log(`[RequestarrContent] Switched to TV instance: ${this.selectedTVInstance}`);
                    
                    // Clear the grid immediately
                    const grid = document.getElementById('tv-grid');
                    if (grid) {
                        grid.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Loading TV shows...</p></div>';
                    }
                    
                    // Disconnect infinite scroll observer during instance switch to prevent auto-loading
                    if (this.tvObserver) {
                        this.tvObserver.disconnect();
                        this.tvObserver = null;
                    }
                    
                    // Reset pagination state
                    this.tvPage = 1;
                    this.tvHasMore = true;
                    this.isLoadingTV = false;
                    
                    // Increment request token to cancel any pending requests
                    this.tvRequestToken++;
                    
                    // Small delay to ensure state is fully reset
                    await new Promise(resolve => setTimeout(resolve, 50));
                    
                    // Await the load to complete before reconnecting scroll
                    await this.loadTV();
                    
                    // Reconnect infinite scroll after load completes
                    this.setupTVInfiniteScroll();
                });
            } else {
                select.innerHTML = '<option value="">No Sonarr instances configured</option>';
                this.selectedTVInstance = null;
            }
        } catch (error) {
            console.error('[RequestarrContent] Error loading TV instances:', error);
            select.innerHTML = '<option value="">Error loading instances</option>';
        }
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

        if (this.isLoadingMovies && this.selectedMovieInstance === this.activeMovieInstance) {
            return;
        }

        this.isLoadingMovies = true;
        const requestToken = ++this.moviesRequestToken;
        const requestedInstance = this.selectedMovieInstance;
        this.activeMovieInstance = requestedInstance;

        // Show loading spinner on first page
        if (this.moviesPage === 1) {
            grid.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Loading movies...</p></div>';
        }
        
        try {
            let url = `./api/requestarr/discover/movies?page=${this.moviesPage}&_=${Date.now()}`;
            
            // Add instance info for library status checking
            if (this.selectedMovieInstance) {
                url += `&app_type=radarr&instance_name=${encodeURIComponent(this.selectedMovieInstance)}`;
            }
            
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

            // Always clear the grid first to remove loading spinner (even for stale requests)
            if (this.moviesPage === 1) {
                grid.innerHTML = '';
            }

            // Check if this request is still valid (not cancelled by a newer request)
            if (requestToken !== this.moviesRequestToken || requestedInstance !== this.selectedMovieInstance) {
                console.log('[RequestarrContent] Cancelled stale movies request, but spinner already cleared');
                return;
            }
            
            if (data.results && data.results.length > 0) {
                data.results.forEach((item) => {
                    grid.appendChild(this.createMediaCard(item));
                });

                // Use has_more from API if available, otherwise check result count
                if (data.has_more !== undefined) {
                    this.moviesHasMore = data.has_more;
                } else {
                    // Fallback to old logic if API doesn't provide has_more
                    this.moviesHasMore = data.results.length >= 20;
                }
            } else {
                grid.innerHTML = '<p style="color: #888; text-align: center; width: 100%; padding: 40px;">No movies found</p>';
                // Use has_more from API if available
                if (data.has_more !== undefined) {
                    this.moviesHasMore = data.has_more;
                } else {
                    this.moviesHasMore = false;
                }
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
        const grid = document.getElementById('tv-grid');
        
        if (!grid) {
            return;
        }

        if (this.isLoadingTV && this.selectedTVInstance === this.activeTVInstance) {
            return;
        }

        this.isLoadingTV = true;
        const requestToken = ++this.tvRequestToken;
        const requestedInstance = this.selectedTVInstance;
        this.activeTVInstance = requestedInstance;

        // Show loading spinner on first page
        if (this.tvPage === 1) {
            grid.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Loading TV shows...</p></div>';
        }
        
        try {
            let url = `./api/requestarr/discover/tv?page=${this.tvPage}&_=${Date.now()}`;
            
            // Add instance info for library status checking
            if (this.selectedTVInstance) {
                url += `&app_type=sonarr&instance_name=${encodeURIComponent(this.selectedTVInstance)}`;
            }
            
            // Add filter parameters
            if (this.core.tvFilters) {
                const filterParams = this.core.tvFilters.getFilterParams();
                if (filterParams) {
                    url += `&${filterParams}`;
                }
            }
            
            const response = await fetch(url);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();

            // Always clear the grid first to remove loading spinner (even for stale requests)
            if (this.tvPage === 1) {
                grid.innerHTML = '';
            }

            // Check if this request is still valid (not cancelled by a newer request)
            if (requestToken !== this.tvRequestToken || requestedInstance !== this.selectedTVInstance) {
                console.log('[RequestarrContent] Cancelled stale TV request, but spinner already cleared');
                return;
            }
            
            if (data.results && data.results.length > 0) {
                data.results.forEach((item) => {
                    grid.appendChild(this.createMediaCard(item));
                });

                // Use has_more from API if available, otherwise check result count
                if (data.has_more !== undefined) {
                    this.tvHasMore = data.has_more;
                } else {
                    // Fallback to old logic if API doesn't provide has_more
                    this.tvHasMore = data.results.length >= 20;
                }
            } else {
                grid.innerHTML = '<p style="color: #888; text-align: center; width: 100%; padding: 40px;">No TV shows found</p>';
                // Use has_more from API if available
                if (data.has_more !== undefined) {
                    this.tvHasMore = data.has_more;
                } else {
                    this.tvHasMore = false;
                }
            }
        } catch (error) {
            console.error('[RequestarrContent] Error loading TV shows:', error);
            if (this.tvPage === 1) {
                grid.innerHTML = '<p style="color: #ef4444; text-align: center; width: 100%; padding: 40px;">Failed to load TV shows</p>';
            }
        } finally {
            this.isLoadingTV = false;

            const sentinel = document.getElementById('tv-scroll-sentinel');
            if (sentinel && this.tvHasMore) {
                const rect = sentinel.getBoundingClientRect();
                const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
                if (rect.top <= viewportHeight + 200) {
                    this.loadMoreTV();
                }
            }
        }
    }
    
    setupTVInfiniteScroll() {
        const sentinel = document.getElementById('tv-scroll-sentinel');
        if (!sentinel || this.tvObserver) {
            return;
        }

        this.tvObserver = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) {
                    return;
                }
                if (this.tvHasMore && !this.isLoadingTV) {
                    this.loadMoreTV();
                }
            });
        }, {
            root: null,
            rootMargin: '200px 0px',
            threshold: 0
        });

        this.tvObserver.observe(sentinel);
    }
    
    loadMoreTV() {
        if (this.tvHasMore && !this.isLoadingTV) {
            this.tvPage++;
            this.loadTV(this.tvPage);
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
        // Store full item data for hide functionality
        card.itemData = item;
        
        const posterUrl = item.poster_path || './static/images/blackout.jpg';
        const year = item.year || 'N/A';
        const rating = item.vote_average ? item.vote_average.toFixed(1) : 'N/A';
        const overview = item.overview || 'No description available.';
        
        const inLibrary = item.in_library || false;
        const partial = item.partial || false;
        const inCooldown = item.in_cooldown || false;
        const hasInstance = item.media_type === 'movie'
            ? (this.core.instances.radarr || []).length > 0
            : (this.core.instances.sonarr || []).length > 0;
        const metaClassName = hasInstance ? 'media-card-meta' : 'media-card-meta no-hide';
        
        // Determine status badge
        let statusBadgeHTML = '';
        if (hasInstance) {
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
                <div class="${metaClassName}">
                    <span class="media-card-year">${year}</span>
                    <span class="media-card-rating">
                        <i class="fas fa-star"></i>
                        ${rating}
                    </span>
                    ${hasInstance ? `
                        <button class="media-card-hide-btn" title="Hide this media permanently">
                            <i class="fas fa-eye-slash"></i>
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
        
        const posterDiv = card.querySelector('.media-card-poster');
        const requestBtn = card.querySelector('.media-card-request-btn');
        const hideBtn = card.querySelector('.media-card-hide-btn');
        
        posterDiv.addEventListener('click', (e) => {
            if (requestBtn && (e.target === requestBtn || requestBtn.contains(e.target))) {
                return;
            }
            if (hideBtn && (e.target === hideBtn || hideBtn.contains(e.target))) {
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
        
        if (hideBtn) {
            hideBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                await this.hideMedia(item.tmdb_id, item.media_type, item.title, card);
            });
        }
        
        return card;
    }

    async hideMedia(tmdbId, mediaType, title, cardElement) {
        try {
            const confirmed = confirm(`Hide "${title}" permanently?\n\nThis will remove it from all discovery pages. You can unhide it later from the Hidden Media page.`);
            if (!confirmed) return;

            // Get item data from card
            const item = cardElement.itemData || {};
            const posterPath = item.poster_path || null;
            
            // Determine app_type and instance from media_type
            const appType = mediaType === 'movie' ? 'radarr' : 'sonarr';
            const instanceName = mediaType === 'movie' ? this.selectedMovieInstance : this.selectedTVInstance;
            
            if (!instanceName) {
                alert('No instance selected. Please select an instance first.');
                return;
            }

            const response = await fetch('./api/requestarr/hidden-media', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tmdb_id: tmdbId,
                    media_type: mediaType,
                    title: title,
                    poster_path: posterPath,
                    app_type: appType,
                    instance_name: instanceName
                })
            });

            if (!response.ok) {
                throw new Error('Failed to hide media');
            }

            // Remove the card from view with animation
            cardElement.style.opacity = '0';
            cardElement.style.transform = 'scale(0.8)';
            setTimeout(() => {
                cardElement.remove();
            }, 300);

            console.log(`[RequestarrContent] Hidden media: ${title} (${mediaType}) for ${appType}/${instanceName}`);
        } catch (error) {
            console.error('[RequestarrContent] Error hiding media:', error);
            alert('Failed to hide media. Please try again.');
        }
    }
}
