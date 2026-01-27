/**
 * Requestarr Core - Main class, initialization, and view management
 */

import { RequestarrContent } from './requestarr-content.js';
import { RequestarrSearch } from './requestarr-search.js';
import { RequestarrModal } from './requestarr-modal.js';
import { RequestarrSettings } from './requestarr-settings.js';
import { RequestarrFilters } from './requestarr-filters.js';
import { RequestarrTVFilters } from './requestarr-tv-filters.js';

export class RequestarrDiscover {
    constructor() {
        this.currentView = 'discover';
        this.instances = { sonarr: [], radarr: [] };
        this.qualityProfiles = {};
        this.searchTimeouts = {};
        this.currentModal = null;
        this.currentModalData = null;
        
        // Initialize modules
        this.content = new RequestarrContent(this);
        this.search = new RequestarrSearch(this);
        this.modal = new RequestarrModal(this);
        this.settings = new RequestarrSettings(this);
        this.filters = new RequestarrFilters(this);
        this.tvFilters = new RequestarrTVFilters(this);
        
        this.init();
    }

    // ========================================
    // INITIALIZATION
    // ========================================

    init() {
        this.loadInstances();
        this.setupCarouselArrows();
        this.search.setupSearchHandlers();
        this.search.setupGlobalSearch();
        this.content.loadDiscoverContent();
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
                await this.loadAllQualityProfiles();
            }
        } catch (error) {
            console.error('[RequestarrDiscover] Error loading instances:', error);
        }
    }
    
    async loadAllQualityProfiles() {
        // Load Radarr quality profiles
        for (const instance of this.instances.radarr) {
            try {
                const response = await fetch(`./api/requestarr/quality-profiles/radarr/${instance.name}`);
                const data = await response.json();
                if (data.success) {
                    this.qualityProfiles[`radarr-${instance.name}`] = data.profiles;
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
        console.log(`[RequestarrDiscover] switchView called with: ${view}`);
        
        // Clear global search
        const globalSearch = document.getElementById('global-search-input');
        if (globalSearch) {
            globalSearch.value = '';
        }
        
        // Hide/show global search bar based on view
        // Use ID to find input, then get parent to ensure we have the right element
        let globalSearchBar = null;
        if (globalSearch) {
            globalSearchBar = globalSearch.closest('.global-search-bar');
        } else {
            // Fallback
            globalSearchBar = document.querySelector('#requestarr-section .global-search-bar');
        }

        if (globalSearchBar) {
            console.log(`[RequestarrDiscover] Found global search bar, applying visibility for ${view}`);
            if (view === 'hidden' || view === 'settings') {
                globalSearchBar.style.setProperty('display', 'none', 'important');
                console.log('[RequestarrDiscover] Hiding global search bar');
            } else {
                globalSearchBar.style.setProperty('display', 'flex', 'important');
                console.log('[RequestarrDiscover] Showing global search bar');
            }
        } else {
            console.error('[RequestarrDiscover] Global search bar not found!');
        }
        
        // Hide search results view
        const searchResultsView = document.getElementById('search-results-view');
        if (searchResultsView) {
            searchResultsView.style.display = 'none';
        }
        
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
                    this.content.loadDiscoverContent();
                }
                break;
            case 'movies':
                // Setup instance selector if not done yet
                if (!this.content.selectedMovieInstance) {
                    this.content.setupInstanceSelectors().then(() => {
                        // Reset movies page state and load
                        this.content.moviesPage = 1;
                        this.content.moviesHasMore = true;
                        this.content.loadMovies();
                        this.content.setupMoviesInfiniteScroll();
                    });
                } else {
                    // Reset movies page state and load
                    this.content.moviesPage = 1;
                    this.content.moviesHasMore = true;
                    this.content.loadMovies();
                    this.content.setupMoviesInfiniteScroll();
                }
                break;
            case 'tv':
                // Setup instance selector if not done yet
                if (!this.content.selectedTVInstance) {
                    this.content.setupInstanceSelectors().then(() => {
                        // Reset TV page state and load
                        this.content.tvPage = 1;
                        this.content.tvHasMore = true;
                        this.content.loadTV();
                        this.content.setupTVInfiniteScroll();
                    });
                } else {
                    // Reset TV page state and load
                    this.content.tvPage = 1;
                    this.content.tvHasMore = true;
                    this.content.loadTV();
                    this.content.setupTVInfiniteScroll();
                }
                break;
            case 'hidden':
                this.settings.loadHiddenMedia();
                break;
            case 'settings':
                this.settings.loadSettings();
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
    // UTILITIES
    // ========================================

    closeFiltersModal() {
        if (this.filters) {
            this.filters.closeFiltersModal();
        }
    }
    
    closeTVFiltersModal() {
        if (this.tvFilters) {
            this.tvFilters.closeFiltersModal();
        }
    }

    applyFilters() {
        if (this.filters) {
            this.filters.applyFilters();
        }
    }

    clearFilters() {
        if (this.filters) {
            this.filters.clearFilters();
        }
    }

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
