/**
 * Requestarr Filters - Filter management for movies
 */

export class RequestarrFilters {
    constructor(core) {
        this.core = core;
        
        // Calculate max year (current year + 3)
        const currentYear = new Date().getFullYear();
        this.maxYear = currentYear + 3;
        this.minYear = 1900;
        
        this.activeFilters = {
            genres: [],
            yearMin: this.minYear,
            yearMax: this.maxYear,
            runtimeMin: 0,
            runtimeMax: 400,
            ratingMin: 0,
            ratingMax: 10,
            votesMin: 0,
            votesMax: 10000,
            hideAvailable: false
        };
        this.genres = [];
        this.init();
    }

    init() {
        this.loadGenres();
        this.setupYearRangeSlider();
        this.setupEventListeners();
        this.updateFilterDisplay();
    }
    
    setupYearRangeSlider() {
        // Set dynamic year range in HTML
        const yearMin = document.getElementById('filter-year-min');
        const yearMax = document.getElementById('filter-year-max');
        
        if (yearMin && yearMax) {
            yearMin.max = this.maxYear;
            yearMin.value = this.minYear;
            yearMax.max = this.maxYear;
            yearMax.value = this.maxYear;
            
            this.updateYearDisplay();
            this.updateSliderRange('year', yearMin, yearMax);
        }
    }

    async loadGenres() {
        try {
            const [genresRes, blacklistedRes] = await Promise.all([
                fetch('./api/requestarr/genres/movie'),
                fetch('./api/requestarr/settings/blacklisted-genres')
            ]);
            const data = await genresRes.json();
            const blacklistedData = await blacklistedRes.json();
            const blacklistedIds = (blacklistedData.blacklisted_movie_genres || []).map(id => parseInt(id, 10));
            if (data.genres) {
                this.genres = data.genres.filter(g => !blacklistedIds.includes(g.id));
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
                this.autoApplyFilters(); // Auto-apply when genre selection changes
                
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
                this.autoApplyFilters(); // Auto-apply when genre is removed
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

        // Hide Available Movies checkbox
        const hideAvailableCheckbox = document.getElementById('hide-available-movies');
        if (hideAvailableCheckbox) {
            hideAvailableCheckbox.addEventListener('change', (e) => {
                this.activeFilters.hideAvailable = e.target.checked;
                this.updateModalFilterCount();
                this.autoApplyFilters();
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

        // Year range inputs - auto-apply on change
        const yearMin = document.getElementById('filter-year-min');
        const yearMax = document.getElementById('filter-year-max');
        if (yearMin && yearMax) {
            yearMin.addEventListener('input', () => {
                if (parseInt(yearMin.value) > parseInt(yearMax.value)) {
                    yearMin.value = yearMax.value;
                }
                this.updateYearDisplay();
                this.updateSliderRange('year', yearMin, yearMax);
                this.updateModalFilterCount();
            });
            yearMin.addEventListener('change', () => {
                this.autoApplyFilters();
            });
            yearMax.addEventListener('input', () => {
                if (parseInt(yearMax.value) < parseInt(yearMin.value)) {
                    yearMax.value = yearMin.value;
                }
                this.updateYearDisplay();
                this.updateSliderRange('year', yearMin, yearMax);
                this.updateModalFilterCount();
            });
            yearMax.addEventListener('change', () => {
                this.autoApplyFilters();
            });
            // Initial range fill
            this.updateSliderRange('year', yearMin, yearMax);
        }

        // Runtime range inputs
        const runtimeMin = document.getElementById('filter-runtime-min');
        const runtimeMax = document.getElementById('filter-runtime-max');
        if (runtimeMin && runtimeMax) {
            runtimeMin.addEventListener('input', () => {
                if (parseInt(runtimeMin.value) > parseInt(runtimeMax.value)) {
                    runtimeMin.value = runtimeMax.value;
                }
                this.updateRuntimeDisplay();
                this.updateSliderRange('runtime', runtimeMin, runtimeMax);
                this.updateModalFilterCount();
            });
            runtimeMin.addEventListener('change', () => {
                this.autoApplyFilters();
            });
            runtimeMax.addEventListener('input', () => {
                if (parseInt(runtimeMax.value) < parseInt(runtimeMin.value)) {
                    runtimeMax.value = runtimeMin.value;
                }
                this.updateRuntimeDisplay();
                this.updateSliderRange('runtime', runtimeMin, runtimeMax);
                this.updateModalFilterCount();
            });
            runtimeMax.addEventListener('change', () => {
                this.autoApplyFilters();
            });
            // Initial range fill
            this.updateSliderRange('runtime', runtimeMin, runtimeMax);
        }

        // Rating range inputs
        const ratingMin = document.getElementById('filter-rating-min');
        const ratingMax = document.getElementById('filter-rating-max');
        if (ratingMin && ratingMax) {
            ratingMin.addEventListener('input', () => {
                if (parseFloat(ratingMin.value) > parseFloat(ratingMax.value)) {
                    ratingMin.value = ratingMax.value;
                }
                this.updateRatingDisplay();
                this.updateSliderRange('rating', ratingMin, ratingMax);
                this.updateModalFilterCount();
            });
            ratingMin.addEventListener('change', () => {
                this.autoApplyFilters();
            });
            ratingMax.addEventListener('input', () => {
                if (parseFloat(ratingMax.value) < parseFloat(ratingMin.value)) {
                    ratingMax.value = ratingMin.value;
                }
                this.updateRatingDisplay();
                this.updateSliderRange('rating', ratingMin, ratingMax);
                this.updateModalFilterCount();
            });
            ratingMax.addEventListener('change', () => {
                this.autoApplyFilters();
            });
            // Initial range fill
            this.updateSliderRange('rating', ratingMin, ratingMax);
        }

        // Votes range inputs
        const votesMin = document.getElementById('filter-votes-min');
        const votesMax = document.getElementById('filter-votes-max');
        if (votesMin && votesMax) {
            votesMin.addEventListener('input', () => {
                if (parseInt(votesMin.value) > parseInt(votesMax.value)) {
                    votesMin.value = votesMax.value;
                }
                this.updateVotesDisplay();
                this.updateSliderRange('votes', votesMin, votesMax);
                this.updateModalFilterCount();
            });
            votesMin.addEventListener('change', () => {
                this.autoApplyFilters();
            });
            votesMax.addEventListener('input', () => {
                if (parseInt(votesMax.value) < parseInt(votesMin.value)) {
                    votesMax.value = votesMin.value;
                }
                this.updateVotesDisplay();
                this.updateSliderRange('votes', votesMin, votesMax);
                this.updateModalFilterCount();
            });
            votesMax.addEventListener('change', () => {
                this.autoApplyFilters();
            });
            // Initial range fill
            this.updateSliderRange('votes', votesMin, votesMax);
        }
    }

    updateSliderRange(type, minInput, maxInput) {
        const rangeElement = document.getElementById(`${type}-range`);
        if (!rangeElement) return;

        const min = parseFloat(minInput.value);
        const max = parseFloat(maxInput.value);
        const minValue = parseFloat(minInput.min);
        const maxValue = parseFloat(minInput.max);

        const percentMin = ((min - minValue) / (maxValue - minValue)) * 100;
        const percentMax = ((max - minValue) / (maxValue - minValue)) * 100;

        rangeElement.style.left = percentMin + '%';
        rangeElement.style.width = (percentMax - percentMin) + '%';
    }

    updateYearDisplay() {
        const minInput = document.getElementById('filter-year-min');
        const maxInput = document.getElementById('filter-year-max');
        let min = parseInt(minInput.value);
        let max = parseInt(maxInput.value);

        if (min > max) {
            const temp = min;
            min = max;
            max = temp;
        }

        const display = document.getElementById('year-display');
        if (display) {
            display.textContent = `Movies from ${min} to ${max}`;
        }
    }

    updateRuntimeDisplay() {
        const minInput = document.getElementById('filter-runtime-min');
        const maxInput = document.getElementById('filter-runtime-max');
        let min = parseInt(minInput.value);
        let max = parseInt(maxInput.value);

        if (min > max) {
            const temp = min;
            min = max;
            max = temp;
        }

        const display = document.getElementById('runtime-display');
        if (display) {
            display.textContent = `${min}-${max} minute runtime`;
        }
    }

    updateRatingDisplay() {
        const minInput = document.getElementById('filter-rating-min');
        const maxInput = document.getElementById('filter-rating-max');
        let min = parseFloat(minInput.value);
        let max = parseFloat(maxInput.value);

        if (min > max) {
            const temp = min;
            min = max;
            max = temp;
        }

        const display = document.getElementById('rating-display');
        if (display) {
            display.textContent = `Ratings between ${min.toFixed(1)} and ${max.toFixed(1)}`;
        }
    }

    updateVotesDisplay() {
        const minInput = document.getElementById('filter-votes-min');
        const maxInput = document.getElementById('filter-votes-max');
        let min = parseInt(minInput.value);
        let max = parseInt(maxInput.value);

        if (min > max) {
            const temp = min;
            min = max;
            max = temp;
        }

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
            }, 150); // Reduced from 300ms to 150ms for faster close
        }
    }

    loadFilterValues() {
        // Load current active filters into the modal
        document.getElementById('filter-year-min').value = this.activeFilters.yearMin;
        document.getElementById('filter-year-max').value = this.activeFilters.yearMax;
        document.getElementById('filter-runtime-min').value = this.activeFilters.runtimeMin;
        document.getElementById('filter-runtime-max').value = this.activeFilters.runtimeMax;
        document.getElementById('filter-rating-min').value = this.activeFilters.ratingMin;
        document.getElementById('filter-rating-max').value = this.activeFilters.ratingMax;
        document.getElementById('filter-votes-min').value = this.activeFilters.votesMin;
        document.getElementById('filter-votes-max').value = this.activeFilters.votesMax;
        document.getElementById('hide-available-movies').checked = this.activeFilters.hideAvailable;

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

        this.updateYearDisplay();
        this.updateRuntimeDisplay();
        this.updateRatingDisplay();
        this.updateVotesDisplay();
        this.updateModalFilterCount();
    }

    autoApplyFilters() {
        // Auto-apply filters without closing the modal (Overseerr-style)
        // Genres are already tracked in activeFilters.genres
        
        let yearMin = parseInt(document.getElementById('filter-year-min')?.value || this.minYear);
        let yearMax = parseInt(document.getElementById('filter-year-max')?.value || this.maxYear);
        let runtimeMin = parseInt(document.getElementById('filter-runtime-min')?.value || 0);
        let runtimeMax = parseInt(document.getElementById('filter-runtime-max')?.value || 400);
        let ratingMin = parseFloat(document.getElementById('filter-rating-min')?.value || 0);
        let ratingMax = parseFloat(document.getElementById('filter-rating-max')?.value || 10);
        let votesMin = parseInt(document.getElementById('filter-votes-min')?.value || 0);
        let votesMax = parseInt(document.getElementById('filter-votes-max')?.value || 10000);

        // Ensure min is not greater than max
        if (yearMin > yearMax) [yearMin, yearMax] = [yearMax, yearMin];
        if (runtimeMin > runtimeMax) [runtimeMin, runtimeMax] = [runtimeMax, runtimeMin];
        if (ratingMin > ratingMax) [ratingMin, ratingMax] = [ratingMax, ratingMin];
        if (votesMin > votesMax) [votesMin, votesMax] = [votesMax, votesMin];

        this.activeFilters.yearMin = yearMin;
        this.activeFilters.yearMax = yearMax;
        this.activeFilters.runtimeMin = runtimeMin;
        this.activeFilters.runtimeMax = runtimeMax;
        this.activeFilters.ratingMin = ratingMin;
        this.activeFilters.ratingMax = ratingMax;
        this.activeFilters.votesMin = votesMin;
        this.activeFilters.votesMax = votesMax;

        // Update filter count display
        this.updateFilterDisplay();

        // Reload movies with new filters (without closing modal)
        this.core.content.moviesPage = 1;
        this.core.content.moviesHasMore = true;
        this.core.content.loadMovies();
    }

    applyFilters() {
        // Genres are already tracked in activeFilters.genres via renderSelectedGenres
        
        let yearMin = parseInt(document.getElementById('filter-year-min').value);
        let yearMax = parseInt(document.getElementById('filter-year-max').value);
        let runtimeMin = parseInt(document.getElementById('filter-runtime-min').value);
        let runtimeMax = parseInt(document.getElementById('filter-runtime-max').value);
        let ratingMin = parseFloat(document.getElementById('filter-rating-min').value);
        let ratingMax = parseFloat(document.getElementById('filter-rating-max').value);
        let votesMin = parseInt(document.getElementById('filter-votes-min').value);
        let votesMax = parseInt(document.getElementById('filter-votes-max').value);

        // Ensure min is not greater than max
        if (yearMin > yearMax) [yearMin, yearMax] = [yearMax, yearMin];
        if (runtimeMin > runtimeMax) [runtimeMin, runtimeMax] = [runtimeMax, runtimeMin];
        if (ratingMin > ratingMax) [ratingMin, ratingMax] = [ratingMax, ratingMin];
        if (votesMin > votesMax) [votesMin, votesMax] = [votesMax, votesMin];

        this.activeFilters.yearMin = yearMin;
        this.activeFilters.yearMax = yearMax;
        this.activeFilters.runtimeMin = runtimeMin;
        this.activeFilters.runtimeMax = runtimeMax;
        this.activeFilters.ratingMin = ratingMin;
        this.activeFilters.ratingMax = ratingMax;
        this.activeFilters.votesMin = votesMin;
        this.activeFilters.votesMax = votesMax;

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
            yearMin: this.minYear,
            yearMax: this.maxYear,
            runtimeMin: 0,
            runtimeMax: 400,
            ratingMin: 0,
            ratingMax: 10,
            votesMin: 0,
            votesMax: 10000,
            hideAvailable: false
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
        if (this.activeFilters.yearMin > this.minYear || this.activeFilters.yearMax < this.maxYear) count++;
        if (this.activeFilters.runtimeMin > 0 || this.activeFilters.runtimeMax < 400) count++;
        if (this.activeFilters.ratingMin > 0 || this.activeFilters.ratingMax < 10) count++;
        if (this.activeFilters.votesMin > 0 || this.activeFilters.votesMax < 10000) count++;
        if (this.activeFilters.hideAvailable) count++;

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
        
        const yearMin = parseInt(document.getElementById('filter-year-min')?.value || this.minYear);
        const yearMax = parseInt(document.getElementById('filter-year-max')?.value || this.maxYear);
        if (yearMin > this.minYear || yearMax < this.maxYear) count++;
        
        const runtimeMin = parseInt(document.getElementById('filter-runtime-min')?.value || 0);
        const runtimeMax = parseInt(document.getElementById('filter-runtime-max')?.value || 400);
        if (runtimeMin > 0 || runtimeMax < 400) count++;
        
        const ratingMin = parseFloat(document.getElementById('filter-rating-min')?.value || 0);
        const ratingMax = parseFloat(document.getElementById('filter-rating-max')?.value || 10);
        if (ratingMin > 0 || ratingMax < 10) count++;
        
        const votesMin = parseInt(document.getElementById('filter-votes-min')?.value || 0);
        const votesMax = parseInt(document.getElementById('filter-votes-max')?.value || 10000);
        if (votesMin > 0 || votesMax < 10000) count++;
        
        const hideAvailable = document.getElementById('hide-available-movies')?.checked || false;
        if (hideAvailable) count++;

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
        
        // Get sort - always include it, default to popularity.desc
        const sortSelect = document.getElementById('movies-sort');
        if (sortSelect && sortSelect.value) {
            params.append('sort_by', sortSelect.value);
        } else {
            // Fallback to default sort if element not found
            params.append('sort_by', 'popularity.desc');
        }

        // Add filter params
        if (this.activeFilters.genres.length > 0) {
            params.append('with_genres', this.activeFilters.genres.join(','));
        }
        // Convert years to dates (Jan 1 for min year, Dec 31 for max year)
        if (this.activeFilters.yearMin > this.minYear) {
            params.append('release_date.gte', `${this.activeFilters.yearMin}-01-01`);
        }
        if (this.activeFilters.yearMax < this.maxYear) {
            params.append('release_date.lte', `${this.activeFilters.yearMax}-12-31`);
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
        if (this.activeFilters.hideAvailable) {
            params.append('hide_available', 'true');
        }

        return params.toString();
    }
}
