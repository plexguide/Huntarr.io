/**
 * Requestarr Filters - Filter management for movies
 */

export class RequestarrFilters {
    constructor(core) {
        this.core = core;
        this.activeFilters = {
            genres: [],
            language: '',
            releaseFrom: '',
            releaseTo: '',
            runtimeMin: 0,
            runtimeMax: 400,
            ratingMin: 0,
            ratingMax: 10,
            votesMin: 0,
            votesMax: 10000
        };
        this.genres = [];
        this.init();
    }

    init() {
        this.loadGenres();
        this.setupEventListeners();
        this.updateFilterDisplay();
    }

    async loadGenres() {
        try {
            const response = await fetch('./api/requestarr/genres/movie');
            const data = await response.json();
            if (data.genres) {
                this.genres = data.genres;
                this.populateGenresSelect();
            }
        } catch (error) {
            console.error('[RequestarrFilters] Error loading genres:', error);
            // Use default genres if API fails
            this.genres = [
                { id: 28, name: 'Action' },
                { id: 12, name: 'Adventure' },
                { id: 16, name: 'Animation' },
                { id: 35, name: 'Comedy' },
                { id: 80, name: 'Crime' },
                { id: 99, name: 'Documentary' },
                { id: 18, name: 'Drama' },
                { id: 10751, name: 'Family' },
                { id: 14, name: 'Fantasy' },
                { id: 36, name: 'History' },
                { id: 27, name: 'Horror' },
                { id: 10402, name: 'Music' },
                { id: 9648, name: 'Mystery' },
                { id: 10749, name: 'Romance' },
                { id: 878, name: 'Science Fiction' },
                { id: 10770, name: 'TV Movie' },
                { id: 53, name: 'Thriller' },
                { id: 10752, name: 'War' },
                { id: 37, name: 'Western' }
            ];
            this.populateGenresSelect();
        }
    }

    populateGenresSelect() {
        const list = document.getElementById('genre-list');
        if (!list) return;

        list.innerHTML = '';
        this.genres.forEach(genre => {
            const item = document.createElement('div');
            item.className = 'genre-item';
            item.textContent = genre.name;
            item.dataset.genreId = genre.id;
            
            if (this.activeFilters.genres.includes(genre.id)) {
                item.classList.add('selected');
            }
            
            item.addEventListener('click', () => {
                const genreId = parseInt(item.dataset.genreId);
                const index = this.activeFilters.genres.indexOf(genreId);
                
                if (index > -1) {
                    this.activeFilters.genres.splice(index, 1);
                    item.classList.remove('selected');
                } else {
                    this.activeFilters.genres.push(genreId);
                    item.classList.add('selected');
                }
                
                this.renderSelectedGenres();
                this.updateModalFilterCount();
                
                // Close dropdown after selection
                const dropdown = document.getElementById('genre-dropdown');
                if (dropdown) {
                    dropdown.style.display = 'none';
                }
            });
            
            list.appendChild(item);
        });
    }

    renderSelectedGenres() {
        const container = document.getElementById('selected-genres');
        if (!container) return;

        container.innerHTML = '';
        
        if (this.activeFilters.genres.length === 0) {
            container.style.display = 'none';
            return;
        }
        
        container.style.display = 'flex';
        
        this.activeFilters.genres.forEach(genreId => {
            const genre = this.genres.find(g => g.id === genreId);
            if (!genre) return;
            
            const pill = document.createElement('div');
            pill.className = 'selected-genre-pill';
            
            const text = document.createElement('span');
            text.textContent = genre.name;
            
            const remove = document.createElement('span');
            remove.className = 'remove-genre';
            remove.innerHTML = '×';
            remove.addEventListener('click', (e) => {
                e.stopPropagation();
                const index = this.activeFilters.genres.indexOf(genreId);
                if (index > -1) {
                    this.activeFilters.genres.splice(index, 1);
                }
                this.renderSelectedGenres();
                this.updateModalFilterCount();
                // Update genre list items
                const genreItems = document.querySelectorAll('.genre-item');
                genreItems.forEach(item => {
                    if (parseInt(item.dataset.genreId) === genreId) {
                        item.classList.remove('selected');
                    }
                });
            });
            
            pill.appendChild(text);
            pill.appendChild(remove);
            container.appendChild(pill);
        });
    }

    setupEventListeners() {
        // Filter button click
        const filterBtn = document.getElementById('movies-filter-btn');
        if (filterBtn) {
            filterBtn.addEventListener('click', () => this.openFiltersModal());
        }

        // Sort dropdown change
        const sortSelect = document.getElementById('movies-sort');
        if (sortSelect) {
            sortSelect.addEventListener('change', (e) => {
                this.applySortChange(e.target.value);
            });
        }

        // Genre dropdown toggle
        const genreInput = document.getElementById('genre-search-input');
        const genreDropdown = document.getElementById('genre-dropdown');
        
        if (genreInput && genreDropdown) {
            genreInput.addEventListener('click', (e) => {
                e.stopPropagation();
                const isVisible = genreDropdown.style.display === 'block';
                genreDropdown.style.display = isVisible ? 'none' : 'block';
            });
            
            // Close dropdown when clicking outside
            document.addEventListener('click', (e) => {
                if (!genreDropdown.contains(e.target) && e.target !== genreInput) {
                    genreDropdown.style.display = 'none';
                }
            });
            
            // Prevent dropdown from closing when clicking inside
            genreDropdown.addEventListener('click', (e) => {
                e.stopPropagation();
            });
        }

        // Runtime range inputs
        const runtimeMin = document.getElementById('filter-runtime-min');
        const runtimeMax = document.getElementById('filter-runtime-max');
        if (runtimeMin && runtimeMax) {
            runtimeMin.addEventListener('input', () => {
                this.updateRuntimeDisplay();
                this.updateModalFilterCount();
            });
            runtimeMax.addEventListener('input', () => {
                this.updateRuntimeDisplay();
                this.updateModalFilterCount();
            });
        }

        // Rating range inputs
        const ratingMin = document.getElementById('filter-rating-min');
        const ratingMax = document.getElementById('filter-rating-max');
        if (ratingMin && ratingMax) {
            ratingMin.addEventListener('input', () => {
                this.updateRatingDisplay();
                this.updateModalFilterCount();
            });
            ratingMax.addEventListener('input', () => {
                this.updateRatingDisplay();
                this.updateModalFilterCount();
            });
        }

        // Votes range inputs
        const votesMin = document.getElementById('filter-votes-min');
        const votesMax = document.getElementById('filter-votes-max');
        if (votesMin && votesMax) {
            votesMin.addEventListener('input', () => {
                this.updateVotesDisplay();
                this.updateModalFilterCount();
            });
            votesMax.addEventListener('input', () => {
                this.updateVotesDisplay();
                this.updateModalFilterCount();
            });
        }
    }

    updateRuntimeDisplay() {
        const min = document.getElementById('filter-runtime-min').value;
        const max = document.getElementById('filter-runtime-max').value;
        const display = document.getElementById('runtime-display');
        if (display) {
            display.textContent = `${min}-${max} minute runtime`;
        }
    }

    updateRatingDisplay() {
        const min = document.getElementById('filter-rating-min').value;
        const max = document.getElementById('filter-rating-max').value;
        const display = document.getElementById('rating-display');
        if (display) {
            display.textContent = `Ratings between ${min} and ${max}`;
        }
    }

    updateVotesDisplay() {
        const min = document.getElementById('filter-votes-min').value;
        const max = document.getElementById('filter-votes-max').value;
        const display = document.getElementById('votes-display');
        if (display) {
            display.textContent = `Number of votes between ${min} and ${max}`;
        }
    }

    openFiltersModal() {
        const modal = document.getElementById('movies-filter-modal');
        if (modal) {
            // Load current filter values
            this.loadFilterValues();
            modal.style.display = 'flex';
            // Add show class for animation
            setTimeout(() => modal.classList.add('show'), 10);
            document.body.style.overflow = 'hidden';
        }
    }

    closeFiltersModal() {
        const modal = document.getElementById('movies-filter-modal');
        if (modal) {
            modal.classList.remove('show');
            setTimeout(() => {
                modal.style.display = 'none';
                document.body.style.overflow = '';
            }, 300);
        }
    }

    loadFilterValues() {
        // Load current active filters into the modal
        document.getElementById('filter-release-from').value = this.activeFilters.releaseFrom || '';
        document.getElementById('filter-release-to').value = this.activeFilters.releaseTo || '';
        document.getElementById('filter-language').value = this.activeFilters.language || '';
        document.getElementById('filter-runtime-min').value = this.activeFilters.runtimeMin;
        document.getElementById('filter-runtime-max').value = this.activeFilters.runtimeMax;
        document.getElementById('filter-rating-min').value = this.activeFilters.ratingMin;
        document.getElementById('filter-rating-max').value = this.activeFilters.ratingMax;
        document.getElementById('filter-votes-min').value = this.activeFilters.votesMin;
        document.getElementById('filter-votes-max').value = this.activeFilters.votesMax;

        // Render selected genres and update genre list
        this.renderSelectedGenres();
        
        // Update genre dropdown items
        const genreItems = document.querySelectorAll('.genre-item');
        genreItems.forEach(item => {
            const genreId = parseInt(item.dataset.genreId);
            if (this.activeFilters.genres.includes(genreId)) {
                item.classList.add('selected');
            } else {
                item.classList.remove('selected');
            }
        });

        this.updateRuntimeDisplay();
        this.updateRatingDisplay();
        this.updateVotesDisplay();
        this.updateModalFilterCount();
    }

    applyFilters() {
        // Genres are already tracked in activeFilters.genres via renderSelectedGenres
        
        this.activeFilters.language = document.getElementById('filter-language').value;
        this.activeFilters.releaseFrom = document.getElementById('filter-release-from').value;
        this.activeFilters.releaseTo = document.getElementById('filter-release-to').value;
        this.activeFilters.runtimeMin = parseInt(document.getElementById('filter-runtime-min').value);
        this.activeFilters.runtimeMax = parseInt(document.getElementById('filter-runtime-max').value);
        this.activeFilters.ratingMin = parseFloat(document.getElementById('filter-rating-min').value);
        this.activeFilters.ratingMax = parseFloat(document.getElementById('filter-rating-max').value);
        this.activeFilters.votesMin = parseInt(document.getElementById('filter-votes-min').value);
        this.activeFilters.votesMax = parseInt(document.getElementById('filter-votes-max').value);

        // Update filter count display
        this.updateFilterDisplay();

        // Close modal
        this.closeFiltersModal();

        // Reload movies with new filters
        this.core.content.moviesPage = 1;
        this.core.content.moviesHasMore = true;
        this.core.content.loadMovies();
    }

    clearFilters() {
        this.activeFilters = {
            genres: [],
            language: '',
            releaseFrom: '',
            releaseTo: '',
            runtimeMin: 0,
            runtimeMax: 400,
            ratingMin: 0,
            ratingMax: 10,
            votesMin: 0,
            votesMax: 10000
        };

        // Reset sort to default
        const sortSelect = document.getElementById('movies-sort');
        if (sortSelect) {
            sortSelect.value = 'popularity.desc';
        }

        this.updateFilterDisplay();
        this.loadFilterValues();
        this.closeFiltersModal();

        // Reload movies
        this.core.content.moviesPage = 1;
        this.core.content.moviesHasMore = true;
        this.core.content.loadMovies();
    }

    updateFilterDisplay() {
        let count = 0;
        
        if (this.activeFilters.genres.length > 0) count++;
        if (this.activeFilters.language) count++;
        if (this.activeFilters.releaseFrom || this.activeFilters.releaseTo) count++;
        if (this.activeFilters.runtimeMin > 0 || this.activeFilters.runtimeMax < 400) count++;
        if (this.activeFilters.ratingMin > 0 || this.activeFilters.ratingMax < 10) count++;
        if (this.activeFilters.votesMin > 0 || this.activeFilters.votesMax < 10000) count++;

        const filterCountElement = document.getElementById('movies-filter-count');
        
        const text = count === 0 ? '0 Active Filters' : count === 1 ? '1 Active Filter' : `${count} Active Filters`;
        
        if (filterCountElement) filterCountElement.textContent = text;
        
        // Also update modal count if open
        this.updateModalFilterCount();
    }

    updateModalFilterCount() {
        let count = 0;
        
        // Count from UI elements
        const selectedGenres = document.querySelectorAll('.filter-genre-item.selected').length;
        if (selectedGenres > 0) count++;
        
        const language = document.getElementById('filter-language')?.value;
        if (language) count++;
        
        const releaseFrom = document.getElementById('filter-release-from')?.value;
        const releaseTo = document.getElementById('filter-release-to')?.value;
        if (releaseFrom || releaseTo) count++;
        
        const runtimeMin = parseInt(document.getElementById('filter-runtime-min')?.value || 0);
        const runtimeMax = parseInt(document.getElementById('filter-runtime-max')?.value || 400);
        if (runtimeMin > 0 || runtimeMax < 400) count++;
        
        const ratingMin = parseFloat(document.getElementById('filter-rating-min')?.value || 0);
        const ratingMax = parseFloat(document.getElementById('filter-rating-max')?.value || 10);
        if (ratingMin > 0 || ratingMax < 10) count++;
        
        const votesMin = parseInt(document.getElementById('filter-votes-min')?.value || 0);
        const votesMax = parseInt(document.getElementById('filter-votes-max')?.value || 10000);
        if (votesMin > 0 || votesMax < 10000) count++;

        const modalCountElement = document.getElementById('filter-active-count');
        const text = count === 0 ? '0 Active Filters' : count === 1 ? '1 Active Filter' : `${count} Active Filters`;
        
        if (modalCountElement) modalCountElement.textContent = text;
    }

    applySortChange(sortBy) {
        // Reload movies with new sort
        this.core.content.moviesPage = 1;
        this.core.content.moviesHasMore = true;
        this.core.content.loadMovies();
    }

    getFilterParams() {
        const params = new URLSearchParams();
        
        // Get sort
        const sortSelect = document.getElementById('movies-sort');
        if (sortSelect) {
            params.append('sort_by', sortSelect.value);
        }

        // Add filter params
        if (this.activeFilters.genres.length > 0) {
            params.append('with_genres', this.activeFilters.genres.join(','));
        }
        if (this.activeFilters.language) {
            params.append('with_original_language', this.activeFilters.language);
        }
        if (this.activeFilters.releaseFrom) {
            params.append('release_date.gte', this.activeFilters.releaseFrom);
        }
        if (this.activeFilters.releaseTo) {
            params.append('release_date.lte', this.activeFilters.releaseTo);
        }
        if (this.activeFilters.runtimeMin > 0 || this.activeFilters.runtimeMax < 400) {
            params.append('with_runtime.gte', this.activeFilters.runtimeMin);
            params.append('with_runtime.lte', this.activeFilters.runtimeMax);
        }
        if (this.activeFilters.ratingMin > 0 || this.activeFilters.ratingMax < 10) {
            params.append('vote_average.gte', this.activeFilters.ratingMin);
            params.append('vote_average.lte', this.activeFilters.ratingMax);
        }
        if (this.activeFilters.votesMin > 0 || this.activeFilters.votesMax < 10000) {
            params.append('vote_count.gte', this.activeFilters.votesMin);
            params.append('vote_count.lte', this.activeFilters.votesMax);
        }

        return params.toString();
    }
}
