
/* === modules/features/requestarr/requestarr-core-utils.js === */
/**
 * Shared Requestarr utilities - must load first in concatenated bundle.
 */
function encodeInstanceValue(appType, name) {
    return `${appType}:${name}`;
}
function decodeInstanceValue(value, defaultAppType) {
    if (defaultAppType === undefined) defaultAppType = 'radarr';
    if (!value) return { appType: defaultAppType, name: '' };
    var idx = value.indexOf(':');
    if (idx === -1) return { appType: defaultAppType, name: value };
    return { appType: value.substring(0, idx), name: value.substring(idx + 1) };
}


/* === modules/features/requestarr/requestarr-filters.js === */
/**
 * Requestarr Filters - Filter management for movies
 */

class RequestarrFilters {
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


/* === modules/features/requestarr/requestarr-tv-filters.js === */
/**
 * Requestarr TV Filters - Filter management for TV shows
 */

class RequestarrTVFilters {
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
        const yearMin = document.getElementById('tv-filter-year-min');
        const yearMax = document.getElementById('tv-filter-year-max');
        
        if (yearMin && yearMax) {
            yearMin.max = this.maxYear;
            yearMin.value = this.minYear;
            yearMax.max = this.maxYear;
            yearMax.value = this.maxYear;
            
            this.updateYearDisplay();
            this.updateSliderRange('tv-year', yearMin, yearMax);
        }
    }

    async loadGenres() {
        try {
            const [genresRes, blacklistedRes] = await Promise.all([
                fetch('./api/requestarr/genres/tv'),
                fetch('./api/requestarr/settings/blacklisted-genres')
            ]);
            const data = await genresRes.json();
            const blacklistedData = await blacklistedRes.json();
            const blacklistedIds = (blacklistedData.blacklisted_tv_genres || []).map(id => parseInt(id, 10));
            if (data.genres) {
                this.genres = data.genres.filter(g => !blacklistedIds.includes(parseInt(g.id, 10)));
                this.populateGenresSelect();
            }
        } catch (error) {
            console.error('[RequestarrTVFilters] Error loading genres:', error);
            // Use default TV genres if API fails
            this.genres = [
                { id: 10759, name: 'Action & Adventure' },
                { id: 16, name: 'Animation' },
                { id: 35, name: 'Comedy' },
                { id: 80, name: 'Crime' },
                { id: 99, name: 'Documentary' },
                { id: 18, name: 'Drama' },
                { id: 10751, name: 'Family' },
                { id: 10762, name: 'Kids' },
                { id: 9648, name: 'Mystery' },
                { id: 10763, name: 'News' },
                { id: 10764, name: 'Reality' },
                { id: 10765, name: 'Sci-Fi & Fantasy' },
                { id: 10766, name: 'Soap' },
                { id: 10767, name: 'Talk' },
                { id: 10768, name: 'War & Politics' },
                { id: 37, name: 'Western' }
            ];
            this.populateGenresSelect();
        }
    }

    populateGenresSelect() {
        const list = document.getElementById('tv-genre-list');
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
                const dropdown = document.getElementById('tv-genre-dropdown');
                if (dropdown) {
                    dropdown.style.display = 'none';
                }
            });
            
            list.appendChild(item);
        });
    }

    renderSelectedGenres() {
        const container = document.getElementById('tv-selected-genres');
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
                const genreItems = document.querySelectorAll('#tv-genre-list .genre-item');
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
        const filterBtn = document.getElementById('tv-filter-btn');
        if (filterBtn) {
            filterBtn.addEventListener('click', () => this.openFiltersModal());
        }

        // Sort dropdown change
        const sortSelect = document.getElementById('tv-sort');
        if (sortSelect) {
            sortSelect.addEventListener('change', (e) => {
                this.applySortChange(e.target.value);
            });
        }

        // Hide Available TV Shows checkbox
        const hideAvailableCheckbox = document.getElementById('hide-available-tv');
        if (hideAvailableCheckbox) {
            hideAvailableCheckbox.addEventListener('change', (e) => {
                this.activeFilters.hideAvailable = e.target.checked;
                this.updateModalFilterCount();
                this.autoApplyFilters();
            });
        }

        // Genre dropdown toggle
        const genreInput = document.getElementById('tv-genre-search-input');
        const genreDropdown = document.getElementById('tv-genre-dropdown');
        
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
        const yearMin = document.getElementById('tv-filter-year-min');
        const yearMax = document.getElementById('tv-filter-year-max');
        if (yearMin && yearMax) {
            yearMin.addEventListener('input', () => {
                if (parseInt(yearMin.value) > parseInt(yearMax.value)) {
                    yearMin.value = yearMax.value;
                }
                this.updateYearDisplay();
                this.updateSliderRange('tv-year', yearMin, yearMax);
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
                this.updateSliderRange('tv-year', yearMin, yearMax);
                this.updateModalFilterCount();
            });
            yearMax.addEventListener('change', () => {
                this.autoApplyFilters();
            });
            // Initial range fill
            this.updateSliderRange('tv-year', yearMin, yearMax);
        }

        // Rating range inputs
        const ratingMin = document.getElementById('tv-filter-rating-min');
        const ratingMax = document.getElementById('tv-filter-rating-max');
        if (ratingMin && ratingMax) {
            ratingMin.addEventListener('input', () => {
                if (parseFloat(ratingMin.value) > parseFloat(ratingMax.value)) {
                    ratingMin.value = ratingMax.value;
                }
                this.updateRatingDisplay();
                this.updateSliderRange('tv-rating', ratingMin, ratingMax);
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
                this.updateSliderRange('tv-rating', ratingMin, ratingMax);
                this.updateModalFilterCount();
            });
            ratingMax.addEventListener('change', () => {
                this.autoApplyFilters();
            });
            // Initial range fill
            this.updateSliderRange('tv-rating', ratingMin, ratingMax);
        }

        // Votes range inputs
        const votesMin = document.getElementById('tv-filter-votes-min');
        const votesMax = document.getElementById('tv-filter-votes-max');
        if (votesMin && votesMax) {
            votesMin.addEventListener('input', () => {
                if (parseInt(votesMin.value) > parseInt(votesMax.value)) {
                    votesMin.value = votesMax.value;
                }
                this.updateVotesDisplay();
                this.updateSliderRange('tv-votes', votesMin, votesMax);
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
                this.updateSliderRange('tv-votes', votesMin, votesMax);
                this.updateModalFilterCount();
            });
            votesMax.addEventListener('change', () => {
                this.autoApplyFilters();
            });
            // Initial range fill
            this.updateSliderRange('tv-votes', votesMin, votesMax);
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
        const minInput = document.getElementById('tv-filter-year-min');
        const maxInput = document.getElementById('tv-filter-year-max');
        let min = parseInt(minInput.value);
        let max = parseInt(maxInput.value);

        if (min > max) {
            const temp = min;
            min = max;
            max = temp;
        }

        const display = document.getElementById('tv-year-display');
        if (display) {
            display.textContent = `TV shows from ${min} to ${max}`;
        }
    }

    updateRatingDisplay() {
        const minInput = document.getElementById('tv-filter-rating-min');
        const maxInput = document.getElementById('tv-filter-rating-max');
        let min = parseFloat(minInput.value);
        let max = parseFloat(maxInput.value);

        if (min > max) {
            const temp = min;
            min = max;
            max = temp;
        }

        const display = document.getElementById('tv-rating-display');
        if (display) {
            display.textContent = `Ratings between ${min.toFixed(1)} and ${max.toFixed(1)}`;
        }
    }

    updateVotesDisplay() {
        const minInput = document.getElementById('tv-filter-votes-min');
        const maxInput = document.getElementById('tv-filter-votes-max');
        let min = parseInt(minInput.value);
        let max = parseInt(maxInput.value);

        if (min > max) {
            const temp = min;
            min = max;
            max = temp;
        }

        const display = document.getElementById('tv-votes-display');
        if (display) {
            display.textContent = `Number of votes between ${min} and ${max}`;
        }
    }

    openFiltersModal() {
        const modal = document.getElementById('tv-filter-modal');
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
        const modal = document.getElementById('tv-filter-modal');
        if (modal) {
            modal.classList.remove('show');
            setTimeout(() => {
                modal.style.display = 'none';
                document.body.style.overflow = '';
            }, 150);
        }
    }

    loadFilterValues() {
        // Load current active filters into the modal
        document.getElementById('tv-filter-year-min').value = this.activeFilters.yearMin;
        document.getElementById('tv-filter-year-max').value = this.activeFilters.yearMax;
        document.getElementById('tv-filter-rating-min').value = this.activeFilters.ratingMin;
        document.getElementById('tv-filter-rating-max').value = this.activeFilters.ratingMax;
        document.getElementById('tv-filter-votes-min').value = this.activeFilters.votesMin;
        document.getElementById('tv-filter-votes-max').value = this.activeFilters.votesMax;
        document.getElementById('hide-available-tv').checked = this.activeFilters.hideAvailable;

        // Render selected genres and update genre list
        this.renderSelectedGenres();
        
        // Update genre dropdown items
        const genreItems = document.querySelectorAll('#tv-genre-list .genre-item');
        genreItems.forEach(item => {
            const genreId = parseInt(item.dataset.genreId);
            if (this.activeFilters.genres.includes(genreId)) {
                item.classList.add('selected');
            } else {
                item.classList.remove('selected');
            }
        });

        this.updateYearDisplay();
        this.updateRatingDisplay();
        this.updateVotesDisplay();
        this.updateModalFilterCount();
    }

    autoApplyFilters() {
        // Auto-apply filters without closing the modal
        let yearMin = parseInt(document.getElementById('tv-filter-year-min')?.value || this.minYear);
        let yearMax = parseInt(document.getElementById('tv-filter-year-max')?.value || this.maxYear);
        let ratingMin = parseFloat(document.getElementById('tv-filter-rating-min')?.value || 0);
        let ratingMax = parseFloat(document.getElementById('tv-filter-rating-max')?.value || 10);
        let votesMin = parseInt(document.getElementById('tv-filter-votes-min')?.value || 0);
        let votesMax = parseInt(document.getElementById('tv-filter-votes-max')?.value || 10000);

        // Ensure min is not greater than max
        if (yearMin > yearMax) [yearMin, yearMax] = [yearMax, yearMin];
        if (ratingMin > ratingMax) [ratingMin, ratingMax] = [ratingMax, ratingMin];
        if (votesMin > votesMax) [votesMin, votesMax] = [votesMax, votesMin];

        this.activeFilters.yearMin = yearMin;
        this.activeFilters.yearMax = yearMax;
        this.activeFilters.ratingMin = ratingMin;
        this.activeFilters.ratingMax = ratingMax;
        this.activeFilters.votesMin = votesMin;
        this.activeFilters.votesMax = votesMax;

        // Update filter count display
        this.updateFilterDisplay();

        // Reload TV shows with new filters (without closing modal)
        this.core.content.tvPage = 1;
        this.core.content.tvHasMore = true;
        this.core.content.loadTV();
    }

    applyFilters() {
        let yearMin = parseInt(document.getElementById('tv-filter-year-min').value);
        let yearMax = parseInt(document.getElementById('tv-filter-year-max').value);
        let ratingMin = parseFloat(document.getElementById('tv-filter-rating-min').value);
        let ratingMax = parseFloat(document.getElementById('tv-filter-rating-max').value);
        let votesMin = parseInt(document.getElementById('tv-filter-votes-min').value);
        let votesMax = parseInt(document.getElementById('tv-filter-votes-max').value);

        // Ensure min is not greater than max
        if (yearMin > yearMax) [yearMin, yearMax] = [yearMax, yearMin];
        if (ratingMin > ratingMax) [ratingMin, ratingMax] = [ratingMax, ratingMin];
        if (votesMin > votesMax) [votesMin, votesMax] = [votesMax, votesMin];

        this.activeFilters.yearMin = yearMin;
        this.activeFilters.yearMax = yearMax;
        this.activeFilters.ratingMin = ratingMin;
        this.activeFilters.ratingMax = ratingMax;
        this.activeFilters.votesMin = votesMin;
        this.activeFilters.votesMax = votesMax;

        // Update filter count display
        this.updateFilterDisplay();

        // Close modal
        this.closeFiltersModal();

        // Reload TV shows with new filters
        this.core.content.tvPage = 1;
        this.core.content.tvHasMore = true;
        this.core.content.loadTV();
    }

    clearFilters() {
        this.activeFilters = {
            genres: [],
            yearMin: this.minYear,
            yearMax: this.maxYear,
            ratingMin: 0,
            ratingMax: 10,
            votesMin: 0,
            votesMax: 10000,
            hideAvailable: false
        };

        // Reset sort to default
        const sortSelect = document.getElementById('tv-sort');
        if (sortSelect) {
            sortSelect.value = 'popularity.desc';
        }

        this.updateFilterDisplay();
        this.loadFilterValues();
        this.closeFiltersModal();

        // Reload TV shows
        this.core.content.tvPage = 1;
        this.core.content.tvHasMore = true;
        this.core.content.loadTV();
    }

    updateFilterDisplay() {
        let count = 0;
        
        if (this.activeFilters.genres.length > 0) count++;
        if (this.activeFilters.yearMin > this.minYear || this.activeFilters.yearMax < this.maxYear) count++;
        if (this.activeFilters.ratingMin > 0 || this.activeFilters.ratingMax < 10) count++;
        if (this.activeFilters.votesMin > 0 || this.activeFilters.votesMax < 10000) count++;
        if (this.activeFilters.hideAvailable) count++;

        const filterCountElement = document.getElementById('tv-filter-count');
        
        const text = count === 0 ? '0 Active Filters' : count === 1 ? '1 Active Filter' : `${count} Active Filters`;
        
        if (filterCountElement) filterCountElement.textContent = text;
        
        // Also update modal count if open
        this.updateModalFilterCount();
    }

    updateModalFilterCount() {
        let count = 0;
        
        // Count from UI elements
        const selectedGenres = document.querySelectorAll('#tv-genre-list .genre-item.selected').length;
        if (selectedGenres > 0) count++;
        
        const yearMin = parseInt(document.getElementById('tv-filter-year-min')?.value || this.minYear);
        const yearMax = parseInt(document.getElementById('tv-filter-year-max')?.value || this.maxYear);
        if (yearMin > this.minYear || yearMax < this.maxYear) count++;
        
        const ratingMin = parseFloat(document.getElementById('tv-filter-rating-min')?.value || 0);
        const ratingMax = parseFloat(document.getElementById('tv-filter-rating-max')?.value || 10);
        if (ratingMin > 0 || ratingMax < 10) count++;
        
        const votesMin = parseInt(document.getElementById('tv-filter-votes-min')?.value || 0);
        const votesMax = parseInt(document.getElementById('tv-filter-votes-max')?.value || 10000);
        if (votesMin > 0 || votesMax < 10000) count++;
        
        const hideAvailable = document.getElementById('hide-available-tv')?.checked || false;
        if (hideAvailable) count++;

        const modalCountElement = document.getElementById('tv-filter-active-count');
        const text = count === 0 ? '0 Active Filters' : count === 1 ? '1 Active Filter' : `${count} Active Filters`;
        
        if (modalCountElement) modalCountElement.textContent = text;
    }

    applySortChange(sortBy) {
        // Reload TV shows with new sort
        this.core.content.tvPage = 1;
        this.core.content.tvHasMore = true;
        this.core.content.loadTV();
    }

    getFilterParams() {
        const params = new URLSearchParams();
        
        // Get sort - always include it, default to popularity.desc
        const sortSelect = document.getElementById('tv-sort');
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
            params.append('first_air_date.gte', `${this.activeFilters.yearMin}-01-01`);
        }
        if (this.activeFilters.yearMax < this.maxYear) {
            params.append('first_air_date.lte', `${this.activeFilters.yearMax}-12-31`);
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


/* === modules/features/requestarr/requestarr-search.js === */
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


/* === modules/features/requestarr/requestarr-settings.js === */
/**
 * Requestarr Settings - Settings and history management
 */

class RequestarrSettings {
    constructor(core) {
        this.core = core;
        this.hiddenMediaControlsInitialized = false;
        this.hiddenMediaItems = [];
        this.blacklistedTvGenres = [];
        this.blacklistedMovieGenres = [];
        this.tvGenresForBlacklist = [];
        this.movieGenresForBlacklist = [];
        this.hiddenMediaState = {
            mediaType: null,
            instanceValue: '',
            searchQuery: '',
            page: 1,
            pageSize: 20
        };
    }

    // ========================================
    // HISTORY
    // ========================================

    async loadHistory() {
        const container = document.getElementById('history-list');
        if (!container) return;
        container.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Loading history...</p></div>';
        
        try {
            const response = await fetch('./api/requestarr/history');
            const data = await response.json();
            
            if (data.requests && data.requests.length > 0) {
                container.innerHTML = '';
                // Use Promise.all to wait for all async createHistoryItem calls
                const items = await Promise.all(
                    data.requests.map(request => this.createHistoryItem(request))
                );
                items.forEach(item => container.appendChild(item));
            } else {
                container.innerHTML = '<p style="color: #888; text-align: center; padding: 60px;">No request history</p>';
            }
        } catch (error) {
            console.error('[RequestarrDiscover] Error loading history:', error);
            container.innerHTML = '<p style="color: #ef4444; text-align: center; padding: 60px;">Failed to load history</p>';
        }
    }

    async createHistoryItem(request) {
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
        
        // Load and cache image asynchronously
        if (posterUrl && !posterUrl.includes('./static/images/') && window.getCachedTMDBImage && window.tmdbImageCache) {
            try {
                const cachedUrl = await window.getCachedTMDBImage(posterUrl, window.tmdbImageCache);
                if (cachedUrl && cachedUrl !== posterUrl) {
                    const imgElement = item.querySelector('.history-poster img');
                    if (imgElement) imgElement.src = cachedUrl;
                }
            } catch (err) {
                console.error('[RequestarrSettings] Failed to cache history image:', err);
            }
        }
        
        return item;
    }

    // ========================================
    // HIDDEN MEDIA
    // ========================================

    async loadHiddenMedia(mediaType = null, page = 1) {
        const container = document.getElementById('hidden-media-grid');
        if (!container) {
            return;
        }

        this.initializeHiddenMediaControls();

        const mediaTypeChanged = this.hiddenMediaState.mediaType !== mediaType;
        if (mediaTypeChanged) {
            this.hiddenMediaState.mediaType = mediaType;
            this.hiddenMediaState.page = 1;
        } else {
            this.hiddenMediaState.page = page;
        }

        // Reset grid display for normal content
        container.style.display = 'grid';
        container.style.alignItems = '';
        container.style.justifyContent = '';

        container.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Loading hidden media...</p></div>';

        try {
            const fetchKey = `${mediaType || 'all'}`;

            if (this.hiddenMediaFetchKey !== fetchKey) {
                this.hiddenMediaFetchKey = fetchKey;

                // Fetch personal hidden media and global blacklist in parallel
                const [personalItems, globalItems] = await Promise.all([
                    this.fetchHiddenMediaItems(mediaType),
                    this.fetchGlobalBlacklistItems(mediaType)
                ]);

                // Merge: mark personal items, then add global items that aren't already in personal list
                personalItems.forEach(item => { item._source = 'personal'; });

                const personalKeys = new Set(personalItems.map(i => `${i.tmdb_id}:${i.media_type}`));
                const mergedGlobal = globalItems
                    .filter(gi => !personalKeys.has(`${gi.tmdb_id}:${gi.media_type}`))
                    .map(gi => ({
                        ...gi,
                        _source: 'global_blacklist'
                    }));

                // Mark personal items that are also globally blacklisted
                const globalKeys = new Set(globalItems.map(gi => `${gi.tmdb_id}:${gi.media_type}`));
                personalItems.forEach(item => {
                    if (globalKeys.has(`${item.tmdb_id}:${item.media_type}`)) {
                        item._source = 'global_blacklist';
                    }
                });

                this.hiddenMediaItems = [...personalItems, ...mergedGlobal];
            }

            this.renderHiddenMediaPage();
        } catch (error) {
            console.error('[RequestarrSettings] Error loading hidden media:', error);
            container.innerHTML = '<p style="color: #ef4444; text-align: center; padding: 60px;">Failed to load hidden media.</p>';
        }
    }

    initializeHiddenMediaControls() {
        if (this.hiddenMediaControlsInitialized) {
            return;
        }

        const searchInput = document.getElementById('hidden-media-search');
        if (searchInput) {
            searchInput.addEventListener('input', (event) => {
                const value = event.target.value || '';
                clearTimeout(this.hiddenMediaSearchTimeout);
                this.hiddenMediaSearchTimeout = setTimeout(() => {
                    this.hiddenMediaState.searchQuery = value.trim();
                    this.hiddenMediaState.page = 1;
                    this.renderHiddenMediaPage();
                }, 200);
            });
        }

        this.hiddenMediaControlsInitialized = true;
    }

    async fetchHiddenMediaItems(mediaType) {
        const allItems = [];
        const pageSize = 200;
        let currentPage = 1;
        let totalPages = 1;
        const maxPages = 50;

        while (currentPage <= totalPages && currentPage <= maxPages) {
            let url = `./api/requestarr/hidden-media?page=${currentPage}&page_size=${pageSize}`;
            if (mediaType) {
                url += `&media_type=${mediaType}`;
            }

            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Hidden media API error: ${response.status}`);
            }
            const data = await response.json();

            if (data.hidden_media && data.hidden_media.length > 0) {
                allItems.push(...data.hidden_media);
            }

            totalPages = data.total_pages || 1;
            currentPage += 1;
        }

        return allItems;
    }

    async fetchGlobalBlacklistItems(mediaType) {
        try {
            const resp = await fetch('./api/requestarr/requests/global-blacklist/ids');
            if (!resp.ok) return [];
            const data = await resp.json();
            let items = data.items || [];
            if (mediaType) {
                items = items.filter(i => i.media_type === mediaType);
            }
            return items.map(i => ({
                tmdb_id: i.tmdb_id,
                media_type: i.media_type,
                title: i.title || '',
                poster_path: i.poster_path || ''
            }));
        } catch (err) {
            console.error('[RequestarrSettings] Error fetching global blacklist:', err);
            return [];
        }
    }

    getFilteredHiddenMedia() {
        const query = (this.hiddenMediaState.searchQuery || '').toLowerCase();
        let filtered = this.hiddenMediaItems.slice();

        if (query) {
            filtered = filtered.filter(item => (item.title || '').toLowerCase().includes(query));
        }

        filtered.sort((a, b) => {
            const titleA = (a.title || '').toLowerCase();
            const titleB = (b.title || '').toLowerCase();
            return titleA.localeCompare(titleB);
        });

        return filtered;
    }

    renderHiddenMediaPage() {
        const container = document.getElementById('hidden-media-grid');
        const paginationContainer = document.getElementById('hidden-media-pagination');
        if (!container || !paginationContainer) {
            return;
        }

        const filtered = this.getFilteredHiddenMedia();
        const pageSize = this.hiddenMediaState.pageSize;
        const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));

        if (this.hiddenMediaState.page > totalPages) {
            this.hiddenMediaState.page = 1;
        }

        const startIndex = (this.hiddenMediaState.page - 1) * pageSize;
        const pageItems = filtered.slice(startIndex, startIndex + pageSize);

        if (pageItems.length > 0) {
            container.style.display = 'grid';
            container.style.alignItems = '';
            container.style.justifyContent = '';
            
            container.innerHTML = '';
            pageItems.forEach(item => {
                container.appendChild(this.createHiddenMediaCard(item));
            });

            if (totalPages > 1) {
                paginationContainer.style.display = 'flex';
                document.getElementById('hidden-page-info').textContent = `Page ${this.hiddenMediaState.page} of ${totalPages}`;
                document.getElementById('hidden-prev-page').disabled = this.hiddenMediaState.page === 1;
                document.getElementById('hidden-next-page').disabled = this.hiddenMediaState.page === totalPages;
            } else {
                paginationContainer.style.display = 'none';
            }
        } else {
            container.style.display = 'flex';
            container.style.alignItems = 'center';
            container.style.justifyContent = 'center';
            container.innerHTML = `
                <div style="text-align: center; color: #9ca3af; max-width: 600px;">
                    <i class="fas fa-inbox" style="font-size: 64px; margin-bottom: 30px; opacity: 0.4; display: block;"></i>
                    <p style="font-size: 20px; margin-bottom: 15px; font-weight: 500; white-space: nowrap;">No Blacklisted Media</p>
                    <p style="font-size: 15px; line-height: 1.6; opacity: 0.8;">Items you blacklist will appear here. Blacklisted media is hidden across all instances.</p>
                </div>
            `;
            paginationContainer.style.display = 'none';
        }

        this.setupHiddenMediaPagination(totalPages);
    }

    setupHiddenMediaPagination(totalPages) {
        const prevBtn = document.getElementById('hidden-prev-page');
        const nextBtn = document.getElementById('hidden-next-page');

        if (!prevBtn || !nextBtn) {
            return;
        }

        prevBtn.onclick = () => {
            if (this.hiddenMediaState.page > 1) {
                this.hiddenMediaState.page -= 1;
                this.renderHiddenMediaPage();
            }
        };

        nextBtn.onclick = () => {
            if (this.hiddenMediaState.page < totalPages) {
                this.hiddenMediaState.page += 1;
                this.renderHiddenMediaPage();
            }
        };
    }

    createHiddenMediaCard(item) {
        const card = document.createElement('div');
        card.className = 'media-card';
        card.setAttribute('data-tmdb-id', item.tmdb_id);
        card.setAttribute('data-media-type', item.media_type);
        
        const posterUrl = item.poster_path || './static/images/blackout.jpg';
        
        const typeBadgeLabel = item.media_type === 'tv' ? 'TV' : 'Movie';
        
        const isGlobalBlacklist = item._source === 'global_blacklist';
        const isOwner = window._huntarrUserRole === 'owner';

        // Scope badge: globally blacklisted items get red badge, personal get purple
        let scopeBadge = '';
        if (isGlobalBlacklist) {
            scopeBadge = '<span class="hidden-scope-badge hidden-scope-blacklisted" title="Globally Blacklisted — cannot be removed by users">Globally Blacklisted</span>';
        } else {
            scopeBadge = '<span class="hidden-scope-badge hidden-scope-personal" title="Hidden by you (personal)">Personal Blacklist</span>';
        }

        // Only show unhide button if NOT globally blacklisted (or if owner and it's a personal hide)
        const showUnhide = !isGlobalBlacklist || (isOwner && item._source !== 'global_blacklist');

        const year = item.year || item.release_year || 'N/A';
        const rating = item.vote_average ? parseFloat(item.vote_average).toFixed(1) : 'N/A';

        card.innerHTML = `
            <div class="media-card-poster">
                ${showUnhide ? '<button class="media-card-unhide-btn" title="Unblacklist"><i class="fas fa-eye"></i></button>' : ''}
                <img src="${posterUrl}" alt="${item.title}" onerror="this.src='./static/images/blackout.jpg'">
                <span class="media-type-badge">${typeBadgeLabel}</span>
                ${scopeBadge}
            </div>
        `;
        
        // Update image from cache in background (non-blocking)
        if (posterUrl && !posterUrl.includes('./static/images/') && window.getCachedTMDBImage && window.tmdbImageCache) {
            const imgEl = card.querySelector('.media-card-poster img');
            if (imgEl) {
                window.getCachedTMDBImage(posterUrl, window.tmdbImageCache).then(cachedUrl => {
                    if (cachedUrl && cachedUrl !== posterUrl) imgEl.src = cachedUrl;
                }).catch(() => {});
            }
        }
        
        const unhideBtn = card.querySelector('.media-card-unhide-btn');
        if (unhideBtn) {
            unhideBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                await this.unhideMedia(item.tmdb_id, item.media_type, item.title, card);
            });
        }
        
        return card;
    }

    async unhideMedia(tmdbId, mediaType, title, cardElement) {
        const self = this;
        const doUnhide = async function() {
        try {
            const response = await fetch(`./api/requestarr/hidden-media/${tmdbId}/${mediaType}`, {
                method: 'DELETE'
            });

            if (!response.ok) {
                throw new Error('Failed to unhide media');
            }

            // Remove from local cache and re-render
            self.hiddenMediaItems = self.hiddenMediaItems.filter(item => {
                return !(item.tmdb_id === tmdbId && item.media_type === mediaType);
            });
            self.renderHiddenMediaPage();

            console.log(`[RequestarrSettings] Unhidden media: ${title} (${mediaType})`);
        } catch (error) {
            console.error('[RequestarrSettings] Error unhiding media:', error);
            if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Failed to unhide media. Please try again.', 'error');
        }
        };
        window.HuntarrConfirm.show({ title: 'Unblacklist Media', message: `Remove "${title}" from your personal blacklist? It will appear in discovery again.`, confirmLabel: 'Unblacklist', onConfirm: function() { doUnhide(); } });
    }

    // ========================================
    // SETTINGS
    // ========================================

    async loadSettings() {
        // Load discover filters
        await this.loadDiscoverFilters();
        
        // Load blacklisted genres and wire UI
        await this.loadBlacklistedGenres();
        
        // Legacy per-section save buttons (kept for backward compat if present)
        const saveFiltersBtn = document.getElementById('save-discover-filters');
        if (saveFiltersBtn) {
            saveFiltersBtn.onclick = () => this.saveDiscoverFilters();
        }
        
        const saveBlacklistedBtn = document.getElementById('save-blacklisted-genres-btn');
        if (saveBlacklistedBtn) {
            saveBlacklistedBtn.onclick = () => this.saveBlacklistedGenres();
        }

        // Unified toolbar save button
        const self = this;
        window._reqsetSaveAll = async function () {
            const btn = document.getElementById('reqset-save-all-btn');
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
            }
            try {
                await self.saveDiscoverFilters(true);
                await self.saveBlacklistedGenres(true);
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('All settings saved', 'success');
                }
            } catch (e) {
                console.error('[Requestarr Settings] Save all error:', e);
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('Error saving settings', 'error');
                }
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = '<i class="fas fa-save"></i> Save';
                }
            }
        };
    }
    
    async loadBlacklistedGenres() {
        const tvSelect = document.getElementById('blacklist-tv-genre-select');
        const movieSelect = document.getElementById('blacklist-movie-genre-select');
        if (!tvSelect || !movieSelect) return;
        try {
            const [tvRes, movieRes, blacklistedRes] = await Promise.all([
                fetch('./api/requestarr/genres/tv'),
                fetch('./api/requestarr/genres/movie'),
                fetch('./api/requestarr/settings/blacklisted-genres')
            ]);
            const tvData = await tvRes.json();
            const movieData = await movieRes.json();
            const blacklistedData = await blacklistedRes.json();
            this.tvGenresForBlacklist = tvData.genres || [];
            this.movieGenresForBlacklist = movieData.genres || [];
            const tvIds = (blacklistedData.blacklisted_tv_genres || []).map(id => parseInt(id, 10));
            const movieIds = (blacklistedData.blacklisted_movie_genres || []).map(id => parseInt(id, 10));
            this.blacklistedTvGenres = tvIds.map(id => {
                const g = this.tvGenresForBlacklist.find(x => x.id === id);
                return { id, name: (g && g.name) ? g.name : `Genre ${id}` };
            });
            this.blacklistedMovieGenres = movieIds.map(id => {
                const g = this.movieGenresForBlacklist.find(x => x.id === id);
                return { id, name: (g && g.name) ? g.name : `Genre ${id}` };
            });
            this.populateBlacklistedDropdowns();
            this.renderBlacklistedPills();
            tvSelect.onchange = () => {
                const val = tvSelect.value;
                if (!val) return;
                const id = parseInt(val, 10);
                const g = this.tvGenresForBlacklist.find(x => x.id === id);
                if (g && !this.blacklistedTvGenres.some(x => x.id === id)) {
                    this.blacklistedTvGenres.push({ id: g.id, name: g.name });
                    this.renderBlacklistedPills();
                    this.populateBlacklistedDropdowns();
                }
                tvSelect.value = '';
            };
            movieSelect.onchange = () => {
                const val = movieSelect.value;
                if (!val) return;
                const id = parseInt(val, 10);
                const g = this.movieGenresForBlacklist.find(x => x.id === id);
                if (g && !this.blacklistedMovieGenres.some(x => x.id === id)) {
                    this.blacklistedMovieGenres.push({ id: g.id, name: g.name });
                    this.renderBlacklistedPills();
                    this.populateBlacklistedDropdowns();
                }
                movieSelect.value = '';
            };
        } catch (error) {
            console.error('[RequestarrDiscover] Error loading blacklisted genres:', error);
        }
    }
    
    populateBlacklistedDropdowns() {
        const tvSelect = document.getElementById('blacklist-tv-genre-select');
        const movieSelect = document.getElementById('blacklist-movie-genre-select');
        if (!tvSelect || !movieSelect) return;
        const tvIds = this.blacklistedTvGenres.map(g => g.id);
        const movieIds = this.blacklistedMovieGenres.map(g => g.id);
        tvSelect.innerHTML = '<option value="">Select a genre to blacklist...</option>';
        this.tvGenresForBlacklist.filter(g => !tvIds.includes(g.id)).forEach(g => {
            const opt = document.createElement('option');
            opt.value = g.id;
            opt.textContent = g.name;
            tvSelect.appendChild(opt);
        });
        movieSelect.innerHTML = '<option value="">Select a genre to blacklist...</option>';
        this.movieGenresForBlacklist.filter(g => !movieIds.includes(g.id)).forEach(g => {
            const opt = document.createElement('option');
            opt.value = g.id;
            opt.textContent = g.name;
            movieSelect.appendChild(opt);
        });
    }
    
    renderBlacklistedPills() {
        const tvList = document.getElementById('blacklisted-tv-genres-list');
        const movieList = document.getElementById('blacklisted-movie-genres-list');
        if (!tvList || !movieList) return;
        tvList.innerHTML = '';
        this.blacklistedTvGenres.forEach(g => {
            const pill = document.createElement('span');
            pill.className = 'blacklisted-genre-pill';
            pill.innerHTML = `<span class="remove-pill" data-type="tv" data-id="${g.id}" aria-label="Remove">×</span><span>${g.name}</span>`;
            pill.querySelector('.remove-pill').onclick = () => {
                this.blacklistedTvGenres = this.blacklistedTvGenres.filter(x => x.id !== g.id);
                this.renderBlacklistedPills();
                this.populateBlacklistedDropdowns();
            };
            tvList.appendChild(pill);
        });
        movieList.innerHTML = '';
        this.blacklistedMovieGenres.forEach(g => {
            const pill = document.createElement('span');
            pill.className = 'blacklisted-genre-pill';
            pill.innerHTML = `<span class="remove-pill" data-type="movie" data-id="${g.id}" aria-label="Remove">×</span><span>${g.name}</span>`;
            pill.querySelector('.remove-pill').onclick = () => {
                this.blacklistedMovieGenres = this.blacklistedMovieGenres.filter(x => x.id !== g.id);
                this.renderBlacklistedPills();
                this.populateBlacklistedDropdowns();
            };
            movieList.appendChild(pill);
        });
    }
    
    async saveBlacklistedGenres(silent = false) {
        const btn = document.getElementById('save-blacklisted-genres-btn');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
        }
        try {
            const response = await fetch('./api/requestarr/settings/blacklisted-genres', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    blacklisted_tv_genres: this.blacklistedTvGenres.map(g => g.id),
                    blacklisted_movie_genres: this.blacklistedMovieGenres.map(g => g.id)
                })
            });
            const data = await response.json();
            if (data.success) {
                if (!silent) {
                    this.core.showNotification('Blacklisted genres saved.', 'success');
                }
            } else {
                this.core.showNotification('Failed to save blacklisted genres', 'error');
            }
        } catch (error) {
            console.error('[RequestarrDiscover] Error saving blacklisted genres:', error);
            this.core.showNotification('Failed to save blacklisted genres', 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-save"></i> Save Blacklisted Genres';
            }
        }
    }
    
    async loadDefaultInstances() {
        const { encodeInstanceValue, decodeInstanceValue } = await import('./requestarr-core.js');
        const movieSelect = document.getElementById('default-movie-instance');
        const tvSelect = document.getElementById('default-tv-instance');
        
        if (!movieSelect || !tvSelect) return;
        
        try {
            // Load Movie Hunt instances
            const _ts = Date.now();
            const movieHuntResponse = await fetch(`./api/requestarr/instances/movie_hunt?t=${_ts}`, { cache: 'no-store' });
            const movieHuntData = await movieHuntResponse.json();
            
            // Load Radarr instances
            const radarrResponse = await fetch(`./api/requestarr/instances/radarr?t=${_ts}`, { cache: 'no-store' });
            const radarrData = await radarrResponse.json();
            
            // Load Sonarr instances
            const sonarrResponse = await fetch(`./api/requestarr/instances/sonarr?t=${_ts}`, { cache: 'no-store' });
            const sonarrData = await sonarrResponse.json();
            
            // Load saved defaults
            const defaultsResponse = await fetch('./api/requestarr/settings/default-instances');
            const defaultsData = await defaultsResponse.json();
            
            let needsAutoSave = false;
            
            // Build combined movie instances list: Movie Hunt first, then Radarr
            const movieHuntInstances = (movieHuntData.instances || []);
            const radarrInstances = (radarrData.instances || []);
            const allMovieInstances = [];
            
            // Add Movie Hunt instances at the top
            movieHuntInstances.forEach(inst => {
                allMovieInstances.push({
                    value: encodeInstanceValue('movie_hunt', inst.name),
                    label: `Movie Hunt - ${inst.name}`,
                    appType: 'movie_hunt',
                    name: inst.name
                });
            });
            
            // Add Radarr instances below
            radarrInstances.forEach(inst => {
                allMovieInstances.push({
                    value: encodeInstanceValue('radarr', inst.name),
                    label: `Radarr - ${inst.name}`,
                    appType: 'radarr',
                    name: inst.name
                });
            });
            
            // Populate movie instances dropdown
            if (allMovieInstances.length > 0) {
                movieSelect.innerHTML = '';
                allMovieInstances.forEach(inst => {
                    const option = document.createElement('option');
                    option.value = inst.value;
                    option.textContent = inst.label;
                    movieSelect.appendChild(option);
                });
                
                // Set selection: saved default or first instance (never leave blank)
                const savedMovie = defaultsData.success && defaultsData.defaults && defaultsData.defaults.movie_instance;
                if (savedMovie) {
                    // Check if the saved value exists in our dropdown options
                    // Support both new compound format and legacy plain name format
                    let foundMatch = false;
                    if (allMovieInstances.some(i => i.value === savedMovie)) {
                        movieSelect.value = savedMovie;
                        foundMatch = true;
                    } else {
                        // Backward compat: try matching legacy value (plain Radarr name without prefix)
                        const legacyMatch = allMovieInstances.find(i => i.appType === 'radarr' && i.name === savedMovie);
                        if (legacyMatch) {
                            movieSelect.value = legacyMatch.value;
                            foundMatch = true;
                            needsAutoSave = true; // Re-save in new format
                        }
                    }
                    if (!foundMatch) {
                        movieSelect.value = allMovieInstances[0].value;
                        needsAutoSave = true;
                    }
                } else {
                    movieSelect.value = allMovieInstances[0].value;
                    needsAutoSave = true;
                }
            } else {
                movieSelect.innerHTML = '<option value="">No movie instances configured</option>';
            }
            
            // Populate TV instances (Sonarr only - unchanged)
            if (sonarrData.instances && sonarrData.instances.length > 0) {
                tvSelect.innerHTML = '';
                sonarrData.instances.forEach(instance => {
                    const option = document.createElement('option');
                    option.value = instance.name;
                    option.textContent = `Sonarr - ${instance.name}`;
                    tvSelect.appendChild(option);
                });
                
                // Set selection: saved default or first instance (never leave blank)
                const savedTV = defaultsData.success && defaultsData.defaults && defaultsData.defaults.tv_instance;
                const tvExists = savedTV && sonarrData.instances.some(i => i.name === defaultsData.defaults.tv_instance);
                if (savedTV && tvExists) {
                    tvSelect.value = defaultsData.defaults.tv_instance;
                } else {
                    tvSelect.value = sonarrData.instances[0].name;
                    needsAutoSave = true;
                }
            } else {
                tvSelect.innerHTML = '<option value="">No Sonarr instances configured</option>';
            }
            
            // Ensure neither dropdown is ever blank when instances exist
            if (allMovieInstances.length > 0 && !movieSelect.value) {
                movieSelect.value = allMovieInstances[0].value;
                needsAutoSave = true;
            }
            if (sonarrData.instances && sonarrData.instances.length > 0 && !tvSelect.value) {
                tvSelect.value = sonarrData.instances[0].name;
                needsAutoSave = true;
            }
            
            // Auto-save if we selected first instances
            if (needsAutoSave) {
                console.log('[RequestarrSettings] Auto-saving first available instances as defaults');
                await this.saveDefaultInstances(true); // Pass silent flag
            }
        } catch (error) {
            console.error('[RequestarrDiscover] Error loading default instances:', error);
        }
    }
    
    async saveDefaultInstances(silent = false) {
        const movieSelect = document.getElementById('default-movie-instance');
        const tvSelect = document.getElementById('default-tv-instance');
        const saveBtn = document.getElementById('save-default-instances');
        
        if (!movieSelect || !tvSelect) return;
        
        if (saveBtn && !silent) {
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
        }
        
        try {
            const response = await fetch('./api/requestarr/settings/default-instances', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    movie_instance: movieSelect.value || '',
                    tv_instance: tvSelect.value || ''
                })
            });
            
            const data = await response.json();
            
            if (data.success) {
                if (!silent) {
                    this.core.showNotification('Default instances saved! Reloading discovery content...', 'success');
                    await this.loadDefaultRootFolders();
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    this.core.content.loadDiscoverContent();
                }
            } else {
                if (!silent) {
                    this.core.showNotification('Failed to save default instances', 'error');
                }
            }
        } catch (error) {
            console.error('[RequestarrDiscover] Error saving default instances:', error);
            if (!silent) {
                this.core.showNotification('Failed to save default instances', 'error');
            }
        } finally {
            if (saveBtn && !silent) {
                saveBtn.disabled = false;
                saveBtn.innerHTML = '<i class="fas fa-save"></i> Save Default Instances';
            }
        }
    }

    /** Default root folders per app (issue #806) */
    async loadDefaultRootFolders() {
        const { decodeInstanceValue } = await import('./requestarr-core.js');
        const radarrSelect = document.getElementById('default-root-folder-radarr');
        const sonarrSelect = document.getElementById('default-root-folder-sonarr');
        const movieInstanceSelect = document.getElementById('default-movie-instance');
        const tvInstanceSelect = document.getElementById('default-tv-instance');
        if (!radarrSelect || !sonarrSelect) return;
        
        // Prevent concurrent calls (race condition protection)
        if (this._loadingRootFolders) {
            console.log('[RequestarrSettings] loadDefaultRootFolders already in progress, skipping');
            return;
        }
        this._loadingRootFolders = true;
        
        try {
            const defaultsRes = await fetch('./api/requestarr/settings/default-instances');
            const rootFoldersRes = await fetch('./api/requestarr/settings/default-root-folders');
            const defaultsData = await defaultsRes.json();
            const savedRootData = rootFoldersRes.ok ? await rootFoldersRes.json() : {};
            
            // Decode the movie instance compound value to get app type and name
            // Prioritize the current dropdown value (user may have just changed it) over saved default
            const movieInstanceRaw = (movieInstanceSelect && movieInstanceSelect.value) || (defaultsData.defaults && defaultsData.defaults.movie_instance) || '';
            const tvInstance = (tvInstanceSelect && tvInstanceSelect.value) || (defaultsData.defaults && defaultsData.defaults.tv_instance) || '';
            
            const movieDecoded = decodeInstanceValue(movieInstanceRaw);
            const movieAppType = movieDecoded.appType; // 'movie_hunt' or 'radarr'
            const movieInstanceName = movieDecoded.name;
            
            // Update the root folder label dynamically based on instance type
            const radarrLabel = document.querySelector('label[for="default-root-folder-radarr"]');
            if (radarrLabel) {
                radarrLabel.textContent = movieAppType === 'movie_hunt' ? 'Default Root Folder (Movie Hunt)' : 'Default Root Folder (Radarr)';
            }
            
            // Determine which saved path to use
            const savedMoviePath = movieAppType === 'movie_hunt' 
                ? (savedRootData.default_root_folder_movie_hunt || '').trim()
                : (savedRootData.default_root_folder_radarr || '').trim();
            const savedSonarrPath = (savedRootData.default_root_folder_sonarr || '').trim();
            
            const fallbackLabel = movieAppType === 'movie_hunt' ? 'Movie Hunt' : 'Radarr';

            // Movie root folders (from Radarr or Movie Hunt, depending on instance type)
            if (movieInstanceName) {
                const rfRes = await fetch(`./api/requestarr/rootfolders?app_type=${movieAppType}&instance_name=${encodeURIComponent(movieInstanceName)}`);
                const rfData = await rfRes.json();
                console.log(`[RequestarrSettings] ${fallbackLabel} API returned`, rfData.root_folders?.length || 0, 'root folders');
                if (rfData.success && rfData.root_folders && rfData.root_folders.length > 0) {
                    // Use Map to dedupe by normalized path, keeping first occurrence
                    const seenPaths = new Map();
                    rfData.root_folders.forEach(rf => {
                        if (!rf || !rf.path) return;
                        const originalPath = rf.path.trim();
                        const normalized = originalPath.replace(/\/+$/, '').toLowerCase();
                        if (!normalized) return;
                        if (!seenPaths.has(normalized)) {
                            seenPaths.set(normalized, {
                                path: originalPath,
                                freeSpace: rf.freeSpace
                            });
                        }
                    });
                    console.log(`[RequestarrSettings] After deduplication: ${seenPaths.size} unique ${fallbackLabel} root folders`);
                    
                    if (seenPaths.size === 0) {
                        radarrSelect.innerHTML = `<option value="">Use first root folder in ${fallbackLabel}</option>`;
                    } else {
                        radarrSelect.innerHTML = '';
                        seenPaths.forEach(rf => {
                            const opt = document.createElement('option');
                            opt.value = rf.path;
                            opt.textContent = rf.path + (rf.freeSpace != null ? ` (${Math.round(rf.freeSpace / 1e9)} GB free)` : '');
                            radarrSelect.appendChild(opt);
                        });
                        if (savedMoviePath) radarrSelect.value = savedMoviePath;
                    }
                } else {
                    radarrSelect.innerHTML = `<option value="">Use first root folder in ${fallbackLabel}</option>`;
                }
            } else {
                radarrSelect.innerHTML = `<option value="">Use first root folder in ${fallbackLabel}</option>`;
            }

            // Sonarr root folders with bulletproof deduplication (unchanged)
            if (tvInstance) {
                const sfRes = await fetch(`./api/requestarr/rootfolders?app_type=sonarr&instance_name=${encodeURIComponent(tvInstance)}`);
                const sfData = await sfRes.json();
                console.log('[RequestarrSettings] Sonarr API returned', sfData.root_folders?.length || 0, 'root folders');
                if (sfData.success && sfData.root_folders && sfData.root_folders.length > 0) {
                    const seenPaths = new Map();
                    sfData.root_folders.forEach(rf => {
                        if (!rf || !rf.path) return;
                        const originalPath = rf.path.trim();
                        const normalized = originalPath.replace(/\/+$/, '').toLowerCase();
                        if (!normalized) return;
                        if (!seenPaths.has(normalized)) {
                            seenPaths.set(normalized, {
                                path: originalPath,
                                freeSpace: rf.freeSpace
                            });
                        }
                    });
                    console.log('[RequestarrSettings] After deduplication:', seenPaths.size, 'unique Sonarr root folders');
                    
                    if (seenPaths.size === 0) {
                        sonarrSelect.innerHTML = '<option value="">Use first root folder in Sonarr</option>';
                    } else {
                        sonarrSelect.innerHTML = '';
                        seenPaths.forEach(rf => {
                            const opt = document.createElement('option');
                            opt.value = rf.path;
                            opt.textContent = rf.path + (rf.freeSpace != null ? ` (${Math.round(rf.freeSpace / 1e9)} GB free)` : '');
                            sonarrSelect.appendChild(opt);
                        });
                        if (savedSonarrPath) sonarrSelect.value = savedSonarrPath;
                    }
                } else {
                    sonarrSelect.innerHTML = '<option value="">Use first root folder in Sonarr</option>';
                }
            } else {
                sonarrSelect.innerHTML = '<option value="">Use first root folder in Sonarr</option>';
            }
        } catch (error) {
            console.error('[RequestarrSettings] Error loading default root folders:', error);
            radarrSelect.innerHTML = '<option value="">Use first root folder</option>';
            sonarrSelect.innerHTML = '<option value="">Use first root folder in Sonarr</option>';
        } finally {
            this._loadingRootFolders = false;
        }
    }

    async saveDefaultRootFolders() {
        const { decodeInstanceValue } = await import('./requestarr-core.js');
        const radarrSelect = document.getElementById('default-root-folder-radarr');
        const sonarrSelect = document.getElementById('default-root-folder-sonarr');
        const movieInstanceSelect = document.getElementById('default-movie-instance');
        const saveBtn = document.getElementById('save-default-root-folders');
        if (!radarrSelect || !sonarrSelect) return;
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
        }
        try {
            // Determine if the movie instance is Movie Hunt or Radarr
            const movieInstanceVal = movieInstanceSelect ? movieInstanceSelect.value : '';
            const movieDecoded = decodeInstanceValue(movieInstanceVal);
            
            const body = {
                default_root_folder_sonarr: sonarrSelect.value || ''
            };
            
            // Save the root folder path under the correct key based on instance type
            if (movieDecoded.appType === 'movie_hunt') {
                body.default_root_folder_movie_hunt = radarrSelect.value || '';
            } else {
                body.default_root_folder_radarr = radarrSelect.value || '';
            }
            
            const response = await fetch('./api/requestarr/settings/default-root-folders', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await response.json();
            if (data.success) {
                this.core.showNotification('Default root folders saved.', 'success');
            } else {
                this.core.showNotification('Failed to save default root folders', 'error');
            }
        } catch (error) {
            console.error('[RequestarrSettings] Error saving default root folders:', error);
            this.core.showNotification('Failed to save default root folders', 'error');
        } finally {
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.innerHTML = '<i class="fas fa-save"></i> Save Default Root Folders';
            }
        }
    }
    
    async loadDiscoverFilters() {
        // Load regions - Full TMDB region list
        const regions = [
            { code: '', name: 'All Regions', flag: '🌐' },
            { code: 'AR', name: 'Argentina', flag: '🇦🇷' },
            { code: 'AU', name: 'Australia', flag: '🇦🇺' },
            { code: 'AT', name: 'Austria', flag: '🇦🇹' },
            { code: 'BE', name: 'Belgium', flag: '🇧🇪' },
            { code: 'BR', name: 'Brazil', flag: '🇧🇷' },
            { code: 'CA', name: 'Canada', flag: '🇨🇦' },
            { code: 'CL', name: 'Chile', flag: '🇨🇱' },
            { code: 'CN', name: 'China', flag: '🇨🇳' },
            { code: 'CO', name: 'Colombia', flag: '🇨🇴' },
            { code: 'CZ', name: 'Czech Republic', flag: '🇨🇿' },
            { code: 'DK', name: 'Denmark', flag: '🇩🇰' },
            { code: 'FI', name: 'Finland', flag: '🇫🇮' },
            { code: 'FR', name: 'France', flag: '🇫🇷' },
            { code: 'DE', name: 'Germany', flag: '🇩🇪' },
            { code: 'GR', name: 'Greece', flag: '🇬🇷' },
            { code: 'HK', name: 'Hong Kong', flag: '🇭🇰' },
            { code: 'HU', name: 'Hungary', flag: '🇭🇺' },
            { code: 'IS', name: 'Iceland', flag: '🇮🇸' },
            { code: 'IN', name: 'India', flag: '🇮🇳' },
            { code: 'ID', name: 'Indonesia', flag: '🇮🇩' },
            { code: 'IE', name: 'Ireland', flag: '🇮🇪' },
            { code: 'IL', name: 'Israel', flag: '🇮🇱' },
            { code: 'IT', name: 'Italy', flag: '🇮🇹' },
            { code: 'JP', name: 'Japan', flag: '🇯🇵' },
            { code: 'KR', name: 'South Korea', flag: '🇰🇷' },
            { code: 'MY', name: 'Malaysia', flag: '🇲🇾' },
            { code: 'MX', name: 'Mexico', flag: '🇲🇽' },
            { code: 'NL', name: 'Netherlands', flag: '🇳🇱' },
            { code: 'NZ', name: 'New Zealand', flag: '🇳🇿' },
            { code: 'NO', name: 'Norway', flag: '🇳🇴' },
            { code: 'PH', name: 'Philippines', flag: '🇵🇭' },
            { code: 'PL', name: 'Poland', flag: '🇵🇱' },
            { code: 'PT', name: 'Portugal', flag: '🇵🇹' },
            { code: 'RO', name: 'Romania', flag: '🇷🇴' },
            { code: 'RU', name: 'Russia', flag: '🇷🇺' },
            { code: 'SA', name: 'Saudi Arabia', flag: '🇸🇦' },
            { code: 'SG', name: 'Singapore', flag: '🇸🇬' },
            { code: 'ZA', name: 'South Africa', flag: '🇿🇦' },
            { code: 'ES', name: 'Spain', flag: '🇪🇸' },
            { code: 'SE', name: 'Sweden', flag: '🇸🇪' },
            { code: 'CH', name: 'Switzerland', flag: '🇨🇭' },
            { code: 'TW', name: 'Taiwan', flag: '🇹🇼' },
            { code: 'TH', name: 'Thailand', flag: '🇹🇭' },
            { code: 'TR', name: 'Turkey', flag: '🇹🇷' },
            { code: 'UA', name: 'Ukraine', flag: '🇺🇦' },
            { code: 'AE', name: 'United Arab Emirates', flag: '🇦🇪' },
            { code: 'GB', name: 'United Kingdom', flag: '🇬🇧' },
            { code: 'US', name: 'United States', flag: '🇺🇸' }
        ];
        
        // Keep All Regions at top, sort the rest alphabetically
        const allRegions = regions[0];
        const otherRegions = regions.slice(1).sort((a, b) => a.name.localeCompare(b.name));
        this.regions = [allRegions, ...otherRegions];
        
        this.selectedRegion = 'US'; // Default
        
        // Initialize custom region select
        this.initializeRegionSelect();
        
        // Initialize language multi-select
        this.initializeLanguageSelect();

        // Initialize provider multi-select
        this.initializeProviderSelect();
        
        // Load saved filters
        try {
            const response = await fetch('./api/requestarr/settings/filters');
            const data = await response.json();
            
            if (data.success && data.filters) {
                if (data.filters.region !== undefined) {
                    this.selectedRegion = data.filters.region;
                    this.updateRegionDisplay();
                }
                if (data.filters.languages && data.filters.languages.length > 0) {
                    this.selectedLanguages = data.filters.languages;
                } else {
                    this.selectedLanguages = [];
                }
                this.renderLanguageTags();
                if (data.filters.providers && data.filters.providers.length > 0) {
                    this.selectedProviders = data.filters.providers;
                } else {
                    this.selectedProviders = [];
                }
            } else {
                // No saved filters - default to US and All Languages
                this.selectedRegion = 'US';
                this.updateRegionDisplay();
                this.selectedLanguages = [];
                this.renderLanguageTags();
                this.selectedProviders = [];
            }
        } catch (error) {
            console.error('[RequestarrDiscover] Error loading discover filters:', error);
            // On error, default to US and All Languages
            this.selectedRegion = 'US';
            this.updateRegionDisplay();
            this.selectedLanguages = [];
            this.renderLanguageTags();
            this.selectedProviders = [];
        }

        await this.loadProviders(this.selectedRegion);
    }
    
    initializeRegionSelect() {
        const display = document.getElementById('region-select-display');
        const dropdown = document.getElementById('region-dropdown');
        const list = document.getElementById('region-list');
        
        if (!display || !dropdown || !list) {
            return;
        }
        
        // Check if already initialized
        if (this.regionSelectInitialized) {
            return;
        }
        
        // Populate region list first
        this.renderRegionList();
        
        // Toggle dropdown - Direct approach
        display.onclick = (e) => {
            e.stopPropagation();
            e.preventDefault();
            
            if (dropdown.style.display === 'none' || !dropdown.style.display) {
                dropdown.style.display = 'block';
                display.classList.add('open');
            } else {
                dropdown.style.display = 'none';
                display.classList.remove('open');
            }
        };
        
        // Prevent dropdown from closing when clicking inside it
        dropdown.onclick = (e) => {
            e.stopPropagation();
        };
        
        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!display.contains(e.target) && !dropdown.contains(e.target)) {
                dropdown.style.display = 'none';
                display.classList.remove('open');
            }
        });
        
        this.regionSelectInitialized = true;
    }
    
    renderRegionList(filter = '') {
        const list = document.getElementById('region-list');
        if (!list) return;
        
        const filteredRegions = this.regions.filter(region => 
            region.name.toLowerCase().includes(filter)
        );
        
        list.innerHTML = '';
        
        filteredRegions.forEach(region => {
            const option = document.createElement('div');
            option.className = 'custom-select-option';
            option.textContent = `${region.flag} ${region.name}`;
            option.dataset.code = region.code;
            
            if (this.selectedRegion === region.code) {
                option.classList.add('selected');
            }
            
            option.onclick = (e) => {
                e.stopPropagation();
                this.selectedRegion = region.code;
                this.updateRegionDisplay();
                this.renderRegionList(); // Re-render to update selected state
                document.getElementById('region-dropdown').style.display = 'none';
                document.getElementById('region-select-display').classList.remove('open');
                this.handleRegionChange();
            };
            
            list.appendChild(option);
        });
    }
    
    updateRegionDisplay() {
        const selectedText = document.getElementById('region-selected-text');
        if (!selectedText) return;
        
        const region = this.regions.find(r => r.code === this.selectedRegion);
        if (region) {
            selectedText.textContent = `${region.flag} ${region.name}`;
        }
    }
    
    initializeLanguageSelect() {
        const input = document.getElementById('discover-language');
        const dropdown = document.getElementById('language-dropdown');
        const languageList = document.getElementById('language-list');
        
        if (!input || !dropdown || !languageList) {
            return;
        }
        
        // Check if already initialized
        if (this.languageSelectInitialized) {
            return;
        }
        
        this.selectedLanguages = this.selectedLanguages || [];
        
        // Common languages list
        this.languages = [
            { code: 'ar', name: 'Arabic' },
            { code: 'zh', name: 'Chinese' },
            { code: 'da', name: 'Danish' },
            { code: 'nl', name: 'Dutch' },
            { code: 'en', name: 'English' },
            { code: 'fi', name: 'Finnish' },
            { code: 'fr', name: 'French' },
            { code: 'de', name: 'German' },
            { code: 'hi', name: 'Hindi' },
            { code: 'it', name: 'Italian' },
            { code: 'ja', name: 'Japanese' },
            { code: 'ko', name: 'Korean' },
            { code: 'no', name: 'Norwegian' },
            { code: 'pl', name: 'Polish' },
            { code: 'pt', name: 'Portuguese' },
            { code: 'ru', name: 'Russian' },
            { code: 'es', name: 'Spanish' },
            { code: 'sv', name: 'Swedish' },
            { code: 'th', name: 'Thai' },
            { code: 'tr', name: 'Turkish' }
        ];
        
        // Populate language list
        this.renderLanguageList();
        
        // Toggle dropdown
        input.onclick = (e) => {
            e.stopPropagation();
            const isVisible = dropdown.style.display === 'block';
            dropdown.style.display = isVisible ? 'none' : 'block';
        };
        
        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!dropdown.contains(e.target) && e.target !== input) {
                dropdown.style.display = 'none';
            }
        });
        
        this.languageSelectInitialized = true;
    }

    initializeProviderSelect() {
        const input = document.getElementById('discover-providers');
        const dropdown = document.getElementById('provider-dropdown');
        const providerList = document.getElementById('provider-list');

        if (!input || !dropdown || !providerList) {
            return;
        }

        if (this.providerSelectInitialized) {
            return;
        }

        this.selectedProviders = this.selectedProviders || [];
        this.providers = this.providers || [];

        this.renderProviderList();
        this.renderProviderTags();

        input.onclick = (e) => {
            e.stopPropagation();
            const isVisible = dropdown.style.display === 'block';
            dropdown.style.display = isVisible ? 'none' : 'block';
        };

        document.addEventListener('click', (e) => {
            if (!dropdown.contains(e.target) && e.target !== input) {
                dropdown.style.display = 'none';
            }
        });

        this.providerSelectInitialized = true;
    }
    
    renderLanguageList(filter = '') {
        const languageList = document.getElementById('language-list');
        if (!languageList) return;
        
        languageList.innerHTML = '';

        const normalizedFilter = filter.trim().toLowerCase();
        const showAllLanguages = !normalizedFilter || 'all languages'.includes(normalizedFilter);
        if (showAllLanguages) {
            const allItem = document.createElement('div');
            allItem.className = 'language-item';
            allItem.textContent = 'All Languages';
            allItem.dataset.code = '';

            if (this.selectedLanguages.length === 0) {
                allItem.classList.add('selected');
            }

            allItem.addEventListener('click', () => {
                this.selectedLanguages = [];
                this.renderLanguageTags();
                this.renderLanguageList(filter);

                const dropdown = document.getElementById('language-dropdown');
                if (dropdown) {
                    dropdown.style.display = 'none';
                }
            });

            languageList.appendChild(allItem);
        }

        this.languages.forEach(lang => {
            if (normalizedFilter && !lang.name.toLowerCase().includes(normalizedFilter)) {
                return;
            }
            const item = document.createElement('div');
            item.className = 'language-item';
            item.textContent = lang.name;
            item.dataset.code = lang.code;
            
            if (this.selectedLanguages.includes(lang.code)) {
                item.classList.add('selected');
            }
            
            item.addEventListener('click', () => {
                const code = item.dataset.code;
                const index = this.selectedLanguages.indexOf(code);
                
                if (index > -1) {
                    this.selectedLanguages.splice(index, 1);
                    item.classList.remove('selected');
                } else {
                    this.selectedLanguages.push(code);
                    item.classList.add('selected');
                }
                
                this.renderLanguageTags();
                
                // Close dropdown after selection
                const dropdown = document.getElementById('language-dropdown');
                if (dropdown) {
                    dropdown.style.display = 'none';
                }
            });
            
            languageList.appendChild(item);
        });
    }
    
    renderLanguageTags() {
        const tagsContainer = document.getElementById('language-tags');
        if (!tagsContainer) return;
        
        tagsContainer.innerHTML = '';
        
        if (this.selectedLanguages.length === 0) {
            // Show "All Languages" as a tag/bubble instead of plain text
            const tag = document.createElement('div');
            tag.className = 'language-tag';
            tag.innerHTML = 'All Languages';
            tag.style.cursor = 'default'; // No remove action for "All Languages"
            tagsContainer.appendChild(tag);
            return;
        }
        
        this.selectedLanguages.forEach(code => {
            const lang = this.languages.find(l => l.code === code);
            if (!lang) return;
            
            const tag = document.createElement('div');
            tag.className = 'language-tag';
            tag.innerHTML = `
                ${lang.name}
                <span class="language-tag-remove" data-code="${code}">×</span>
            `;
            
            tag.querySelector('.language-tag-remove').addEventListener('click', (e) => {
                e.stopPropagation();
                const removeCode = e.target.dataset.code;
                this.selectedLanguages = this.selectedLanguages.filter(c => c !== removeCode);
                this.renderLanguageTags();
                this.renderLanguageList();
            });
            
            tagsContainer.appendChild(tag);
        });
    }

    async loadProviders(region) {
        try {
            const response = await fetch(`./api/requestarr/watch-providers/movie?region=${encodeURIComponent(region || '')}`);
            const data = await response.json();
            this.providers = data.providers || [];
            const available = new Set(this.providers.map(provider => String(provider.provider_id)));
            this.selectedProviders = (this.selectedProviders || []).filter(code => available.has(code));
        } catch (error) {
            console.error('[RequestarrDiscover] Error loading watch providers:', error);
            this.providers = [];
        }

        this.renderProviderList();
        this.renderProviderTags();
    }

    renderProviderList() {
        const providerList = document.getElementById('provider-list');
        if (!providerList) return;

        providerList.innerHTML = '';

        if (!this.providers || this.providers.length === 0) {
            providerList.innerHTML = '<div class="language-item" style="color: #888;">No providers found</div>';
            return;
        }

        this.providers.forEach(provider => {
            const providerId = String(provider.provider_id);
            const item = document.createElement('div');
            item.className = 'language-item';
            item.textContent = provider.provider_name;
            item.dataset.code = providerId;

            if (this.selectedProviders.includes(providerId)) {
                item.classList.add('selected');
            }

            item.addEventListener('click', () => {
                const code = item.dataset.code;
                const index = this.selectedProviders.indexOf(code);

                if (index > -1) {
                    this.selectedProviders.splice(index, 1);
                    item.classList.remove('selected');
                } else {
                    this.selectedProviders.push(code);
                    item.classList.add('selected');
                }

                this.renderProviderTags();

                const dropdown = document.getElementById('provider-dropdown');
                if (dropdown) {
                    dropdown.style.display = 'none';
                }
            });

            providerList.appendChild(item);
        });
    }

    renderProviderTags() {
        const tagsContainer = document.getElementById('provider-tags');
        if (!tagsContainer) return;

        tagsContainer.innerHTML = '';

        if (!this.selectedProviders || this.selectedProviders.length === 0) {
            // Show "All Providers" as a tag/bubble instead of plain text
            const tag = document.createElement('div');
            tag.className = 'language-tag';
            tag.innerHTML = 'All Providers';
            tag.style.cursor = 'default'; // No remove action for "All Providers"
            tagsContainer.appendChild(tag);
            return;
        }

        this.selectedProviders.forEach(code => {
            const provider = (this.providers || []).find(p => String(p.provider_id) === code);
            if (!provider) return;

            const tag = document.createElement('div');
            tag.className = 'language-tag';
            tag.innerHTML = `
                ${provider.provider_name}
                <span class="language-tag-remove" data-code="${code}">×</span>
            `;

            tag.querySelector('.language-tag-remove').addEventListener('click', (e) => {
                e.stopPropagation();
                const removeCode = e.target.dataset.code;
                this.selectedProviders = this.selectedProviders.filter(c => c !== removeCode);
                this.renderProviderTags();
                this.renderProviderList();
            });

            tagsContainer.appendChild(tag);
        });
    }

    handleRegionChange() {
        this.selectedProviders = [];
        this.renderProviderTags();
        this.renderProviderList();
        this.loadProviders(this.selectedRegion);
    }
    
    async saveDiscoverFilters(silent = false) {
        const saveBtn = document.getElementById('save-discover-filters');
        
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
        }
        
        try {
            const response = await fetch('./api/requestarr/settings/filters', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    region: this.selectedRegion || '',
                    languages: this.selectedLanguages || [],
                    providers: this.selectedProviders || []
                })
            });
            
            const data = await response.json();
            
            if (data.success) {
                if (!silent) {
                    this.core.showNotification('Filters saved! Reloading discover content...', 'success');
                }
                
                // Reload all discover content with new filters
                setTimeout(() => {
                    this.core.content.loadDiscoverContent();
                }, 500);
            } else {
                this.core.showNotification('Failed to save discover filters', 'error');
            }
        } catch (error) {
            console.error('[RequestarrDiscover] Error saving discover filters:', error);
            this.core.showNotification('Failed to save discover filters', 'error');
        } finally {
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.innerHTML = '<i class="fas fa-save"></i> Save Filters';
            }
        }
    }

    // ========================================
    // SMART HUNT SETTINGS
    // ========================================

    async loadSmartHuntSettings() {
        try {
            const resp = await fetch('./api/requestarr/settings/smarthunt');
            const data = await resp.json();
            if (!data.success || !data.settings) return;
            const s = data.settings;

            // Populate toggles
            const hideLibEl = document.getElementById('smarthunt-hide-library');
            if (hideLibEl) hideLibEl.checked = s.hide_library_items !== false;

            // Populate cache TTL dropdown
            const cacheTtlEl = document.getElementById('smarthunt-cache-ttl');
            if (cacheTtlEl) cacheTtlEl.value = String(s.cache_ttl_minutes ?? 60);

            // Populate number fields
            const minRating = document.getElementById('smarthunt-min-rating');
            if (minRating) minRating.value = s.min_tmdb_rating ?? 6.0;
            const minVotes = document.getElementById('smarthunt-min-votes');
            if (minVotes) minVotes.value = s.min_vote_count ?? 50;
            const ys = document.getElementById('smarthunt-year-start');
            if (ys) ys.value = s.year_start ?? 2000;
            const ye = document.getElementById('smarthunt-year-end');
            if (ye) ye.value = s.year_end ?? (new Date().getFullYear() + 1);

            // Populate percentages
            const pcts = s.percentages || {};
            const cats = ['similar_library', 'trending', 'hidden_gems', 'new_releases', 'top_rated', 'genre_mix', 'upcoming', 'random'];
            cats.forEach(cat => {
                const el = document.getElementById(`smarthunt-pct-${cat}`);
                if (el) el.value = pcts[cat] ?? 0;
            });

            this._updateSmartHuntTotal();
            this._wireSmartHuntEvents();
        } catch (e) {
            console.error('[SmartHuntSettings] Error loading:', e);
        }
    }

    _wireSmartHuntEvents() {
        // Wire percentage inputs to update total
        if (this._smarthuntEventsWired) return;
        this._smarthuntEventsWired = true;

        document.querySelectorAll('.smarthunt-pct').forEach(input => {
            input.addEventListener('input', () => this._updateSmartHuntTotal());
        });

        // Save button
        const saveBtn = document.getElementById('smarthunt-save-btn');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => this.saveSmartHuntSettings());
        }
    }

    _updateSmartHuntTotal() {
        const cats = ['similar_library', 'trending', 'hidden_gems', 'new_releases', 'top_rated', 'genre_mix', 'upcoming', 'random'];
        let total = 0;
        cats.forEach(cat => {
            const el = document.getElementById(`smarthunt-pct-${cat}`);
            if (el) total += parseInt(el.value) || 0;
        });

        const totalEl = document.getElementById('smarthunt-total-value');
        const barEl = document.getElementById('smarthunt-total-bar');
        if (totalEl) totalEl.textContent = total;
        if (barEl) {
            barEl.classList.toggle('is-valid', total === 100);
            barEl.classList.toggle('is-invalid', total !== 100);
        }
    }

    async saveSmartHuntSettings() {
        const saveBtn = document.getElementById('smarthunt-save-btn');
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
        }

        try {
            const cats = ['similar_library', 'trending', 'hidden_gems', 'new_releases', 'top_rated', 'genre_mix', 'upcoming', 'random'];
            const percentages = {};
            let total = 0;
            cats.forEach(cat => {
                const el = document.getElementById(`smarthunt-pct-${cat}`);
                const val = parseInt(el?.value) || 0;
                percentages[cat] = val;
                total += val;
            });

            // Auto-adjust Random if total != 100
            if (total !== 100) {
                const diff = 100 - total + (percentages.random || 0);
                if (diff >= 0 && diff <= 100) {
                    percentages.random = diff;
                    const randomEl = document.getElementById('smarthunt-pct-random');
                    if (randomEl) randomEl.value = diff;
                } else {
                    // Proportionally scale all categories
                    const factor = 100 / (total || 1);
                    let runningTotal = 0;
                    cats.forEach((cat, i) => {
                        if (i < cats.length - 1) {
                            percentages[cat] = Math.round(percentages[cat] * factor);
                            runningTotal += percentages[cat];
                        } else {
                            percentages[cat] = 100 - runningTotal;
                        }
                    });
                    // Update UI
                    cats.forEach(cat => {
                        const el = document.getElementById(`smarthunt-pct-${cat}`);
                        if (el) el.value = percentages[cat];
                    });
                }
                this._updateSmartHuntTotal();
            }

            const settings = {
                enabled: true,  // Smart Hunt is always enabled
                cache_ttl_minutes: parseInt(document.getElementById('smarthunt-cache-ttl')?.value) || 60,
                hide_library_items: document.getElementById('smarthunt-hide-library')?.checked ?? true,
                min_tmdb_rating: parseFloat(document.getElementById('smarthunt-min-rating')?.value) || 6.0,
                min_vote_count: parseInt(document.getElementById('smarthunt-min-votes')?.value) || 0,
                year_start: parseInt(document.getElementById('smarthunt-year-start')?.value) || 2000,
                year_end: parseInt(document.getElementById('smarthunt-year-end')?.value) || (new Date().getFullYear() + 1),
                percentages: percentages,
            };

            const resp = await fetch('./api/requestarr/settings/smarthunt', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(settings),
            });
            const data = await resp.json();

            if (data.success) {
                this.core.showNotification('Smart Hunt settings saved successfully', 'success');
                // Invalidate frontend cache
                if (window.invalidateSmartHuntCache) window.invalidateSmartHuntCache();
            } else {
                this.core.showNotification('Failed to save Smart Hunt settings', 'error');
            }
        } catch (e) {
            console.error('[SmartHuntSettings] Error saving:', e);
            this.core.showNotification('Failed to save Smart Hunt settings', 'error');
        } finally {
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.innerHTML = '<i class="fas fa-save"></i> Save';
            }
        }
    }

}


/* === modules/features/requestarr/requestarr-content.js === */
/**
 * Requestarr Content - Content loading and media card creation
 */

class RequestarrContent {
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
        
        // Instance tracking - unified across all Requestarr pages via server-side DB.
        // Loaded once via _loadServerDefaults(), saved via _saveServerDefaults().
        this.selectedMovieInstance = null;
        this.selectedTVInstance = null;
        this._serverDefaultsLoaded = false;
        
        // Hidden media tracking
        this.hiddenMediaSet = new Set();

        // Track whether movie/TV dropdowns have been populated (prevents race with _loadServerDefaults)
        this._movieInstancesPopulated = false;
        this._tvInstancesPopulated = false;

        // Auto-refresh dropdowns when any instance is added/deleted/renamed anywhere in the app
        document.addEventListener('huntarr:instances-changed', () => {
            this.refreshInstanceSelectors();
        });

    }

    // ========================================
    // INSTANCE MANAGEMENT
    // ========================================

    async setupInstanceSelectors() {
        // Load server defaults first, then populate selectors
        await this._loadServerDefaults();
        await this.loadMovieInstances();
        await this.loadTVInstances();
    }

    /**
     * Public refresh: re-fetch instance lists from the API and repopulate all
     * Requestarr dropdowns (Discover + Movies/TV list pages).
     * Called by navigation.js when switching to Requestarr sections so newly
     * added/removed instances appear without a full page reload.
     */
    async refreshInstanceSelectors() {
            this._serverDefaultsLoaded = false;
            this._movieInstancesPopulated = false;
            this._tvInstancesPopulated = false;
            this._bundleDropdownCache = null;
            await this._loadServerDefaults();
            await Promise.all([
                this._populateDiscoverMovieInstances(),
                this._populateDiscoverTVInstances()
            ]);
            await this.loadMovieInstances();
            await this.loadTVInstances();
        }

    // ----------------------------------------
    // SERVER-SIDE INSTANCE PERSISTENCE
    // ----------------------------------------

    /**
     * Load the saved default instances from the server (DB).
     * Called once on init; populates this.selectedMovieInstance / this.selectedTVInstance.
     */
    async _loadServerDefaults() {
        if (this._serverDefaultsLoaded) return;
        try {
            const res = await fetch('./api/requestarr/settings/default-instances');
            const data = await res.json();
            if (data.success && data.defaults) {
                this.selectedMovieInstance = data.defaults.movie_instance || null;
                this.selectedTVInstance = data.defaults.tv_instance || null;
                console.log('[RequestarrContent] Loaded server defaults:', data.defaults);
            }
        } catch (e) {
            console.warn('[RequestarrContent] Could not load server defaults:', e);
        }
        this._serverDefaultsLoaded = true;
    }

    /**
     * Save the current movie + TV instance to the server (fire-and-forget).
     */
    _saveServerDefaults() {
        return fetch('./api/requestarr/settings/default-instances', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                movie_instance: this.selectedMovieInstance || '',
                tv_instance: this.selectedTVInstance || ''
            })
        }).catch(e => console.warn('[RequestarrContent] Failed to save server defaults:', e));
    }

    /**
     * Update the movie instance in memory + server, then sync all page dropdowns.
     * Returns a promise that resolves once the server save completes.
     */
    async _setMovieInstance(compoundValue) {
        this.selectedMovieInstance = compoundValue;
        this._syncAllMovieSelectors();
        await this._saveServerDefaults();
        // Reload Smart Hunt carousel if active
        if (this._discoverSmartHunt) this._discoverSmartHunt.reload();
    }

    /**
     * Update the TV instance in memory + server, then sync all page dropdowns.
     * Returns a promise that resolves once the server save completes.
     */
    async _setTVInstance(value) {
        this.selectedTVInstance = value;
        this._syncAllTVSelectors();
        await this._saveServerDefaults();
        // Reload Smart Hunt carousel if active
        if (this._discoverSmartHunt) this._discoverSmartHunt.reload();
    }


    /**
     * Sync every movie-instance dropdown on the page to the current value.
     */
    _syncAllMovieSelectors() {
        const ids = ['movies-instance-select', 'discover-movie-instance-select', 'home-movie-instance-select'];
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (el && el.value !== this.selectedMovieInstance) {
                el.value = this.selectedMovieInstance;
            }
        });
        // Also sync HomeRequestarr's in-memory default
        if (window.HomeRequestarr) {
            window.HomeRequestarr.defaultMovieInstance = this.selectedMovieInstance;
        }
    }

    /**
     * Sync every TV-instance dropdown on the page to the current value.
     */
    _syncAllTVSelectors() {
        const ids = ['tv-instance-select', 'discover-tv-instance-select', 'home-tv-instance-select'];
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (el && el.value !== this.selectedTVInstance) {
                el.value = this.selectedTVInstance;
            }
        });
        // Also sync HomeRequestarr's in-memory default
        if (window.HomeRequestarr) {
            window.HomeRequestarr.defaultTVInstance = this.selectedTVInstance;
        }
    }

    // ----------------------------------------
    // DISCOVER PAGE INSTANCE SELECTORS
    // ----------------------------------------

    /**
     * Populate the Discover page's movie + TV instance selectors and wire change events.
     */
    async setupDiscoverInstances() {
        await this._loadServerDefaults();
        await Promise.all([
            this._populateDiscoverMovieInstances(),
            this._populateDiscoverTVInstances()
        ]);
    }

    /**
     * Fetch bundle dropdown options from the server (cached per refresh cycle).
     * Returns { movie_options, tv_options } where each option has value + label.
     * The value uses appType:instanceName format so existing code works unchanged.
     */
    async _fetchBundleDropdownOptions() {
        if (this._bundleDropdownCache) return this._bundleDropdownCache;
        try {
            const resp = await fetch(`./api/requestarr/bundles/dropdown?t=${Date.now()}`, { cache: 'no-store' });
            if (!resp.ok) throw new Error('Failed');
            const data = await resp.json();
            // Normalize: value for bundles uses primary's appType:instanceName
            const normalize = (opts) => (opts || []).map(o => ({
                value: o.is_bundle ? encodeInstanceValue(o.primary_app_type, o.primary_instance_name) : o.value,
                label: o.label,
                isBundle: o.is_bundle,
            }));
            this._bundleDropdownCache = {
                movie_options: normalize(data.movie_options),
                tv_options: normalize(data.tv_options),
            };
            return this._bundleDropdownCache;
        } catch (e) {
            console.warn('[RequestarrContent] Error fetching bundle dropdown:', e);
            return { movie_options: [], tv_options: [] };
        }
    }

    /**
     * Populate a select element from bundle dropdown options.
     */
    _populateSelectFromOptions(select, options, savedValue) {
        select.innerHTML = '';
        if (options.length === 0) {
            select.innerHTML = '<option value="">No instances configured</option>';
            return null;
        }
        let matchedValue = null;
        options.forEach(opt => {
            const el = document.createElement('option');
            el.value = opt.value;
            el.textContent = opt.label;
            if (savedValue && opt.value === savedValue) {
                el.selected = true;
                matchedValue = opt.value;
            }
            select.appendChild(el);
        });
        // If no match, select first
        if (!matchedValue && options.length > 0) {
            select.options[0].selected = true;
            matchedValue = options[0].value;
        }
        return matchedValue;
    }

    async _populateDiscoverMovieInstances() {
        const select = document.getElementById('discover-movie-instance-select');
        if (!select) return;

        try {
            const dd = await this._fetchBundleDropdownOptions();
            const previousValue = this.selectedMovieInstance || select.value || '';
            const matched = this._populateSelectFromOptions(select, dd.movie_options, previousValue);
            if (matched) this.selectedMovieInstance = matched;

            if (!select._discoverChangeWired) {
                select._discoverChangeWired = true;
                select.addEventListener('change', async () => {
                    await this._setMovieInstance(select.value);
                    this.reloadDiscoverMovies();
                });
            }
        } catch (error) {
            console.error('[RequestarrContent] Error loading discover movie instances:', error);
        }
    }

    async _populateDiscoverTVInstances() {
        const select = document.getElementById('discover-tv-instance-select');
        if (!select) return;

        try {
            const dd = await this._fetchBundleDropdownOptions();
            const previousValue = this.selectedTVInstance || select.value || '';
            const matched = this._populateSelectFromOptions(select, dd.tv_options, previousValue);
            if (matched) this.selectedTVInstance = matched;

            if (!select._discoverChangeWired) {
                select._discoverChangeWired = true;
                select.addEventListener('change', async () => {
                    await this._setTVInstance(select.value);
                    this.reloadDiscoverTV();
                });
            }
        } catch (error) {
            console.error('[RequestarrContent] Error loading discover TV instances:', error);
        }
    }

    /**
     * Re-fetch and render Popular Movies carousel with the current movie instance.
     * Also refreshes trending since movie statuses depend on the selected instance.
     */
    async reloadDiscoverMovies() {
        const carousel = document.getElementById('popular-movies-carousel');
        if (!carousel) return;
        carousel.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Loading movies...</p></div>';
        try {
            const decoded = decodeInstanceValue(this.selectedMovieInstance);
            let url = './api/requestarr/discover/movies?page=1';
            if (decoded.name) url += `&app_type=${decoded.appType}&instance_name=${encodeURIComponent(decoded.name)}`;
            const response = await fetch(url);
            const data = await response.json();
            const results = (data.results && data.results.length > 0) ? data.results : [];
            this.renderPopularMoviesResults(carousel, results);
        } catch (error) {
            console.error('[RequestarrContent] Error reloading discover movies:', error);
        }
        // Refresh trending with updated instance params (status badges depend on selected instance)
        await this.loadTrending();
    }

    /**
     * Re-fetch and render Popular TV carousel with the current TV instance.
     * Also refreshes trending since TV statuses depend on the selected instance.
     */
    async reloadDiscoverTV() {
        const carousel = document.getElementById('popular-tv-carousel');
        if (!carousel) return;
        carousel.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Loading TV shows...</p></div>';
        try {
            let url = './api/requestarr/discover/tv?page=1';
            if (this.selectedTVInstance) {
                const decoded = decodeInstanceValue(this.selectedTVInstance, 'sonarr');
                url += `&app_type=${encodeURIComponent(decoded.appType || 'sonarr')}&instance_name=${encodeURIComponent(decoded.name || '')}`;
            }
            const response = await fetch(url);
            const data = await response.json();
            const results = (data.results && data.results.length > 0) ? data.results : [];
            this.renderPopularTVResults(carousel, results);
        } catch (error) {
            console.error('[RequestarrContent] Error reloading discover TV:', error);
        }
        // Refresh trending with updated instance params (status badges depend on selected instance)
        await this.loadTrending();
    }

    async loadMovieInstances() {
        const select = document.getElementById('movies-instance-select');
        if (!select) return;

        if (this._movieInstancesPopulated) {
            this._syncAllMovieSelectors();
            return;
        }

        if (this._loadingMovieInstances) return;
        this._loadingMovieInstances = true;

        select.innerHTML = '<option value="">Loading instances...</option>';

        try {
            const dd = await this._fetchBundleDropdownOptions();
            const savedValue = this.selectedMovieInstance;
            const matched = this._populateSelectFromOptions(select, dd.movie_options, savedValue);

            if (matched) {
                this._setMovieInstance(matched);
            } else {
                this.selectedMovieInstance = null;
            }

            // Setup change handler (remove old listener via clone)
            const newSelect = select.cloneNode(true);
            if (select.parentNode) {
                select.parentNode.replaceChild(newSelect, select);
            } else {
                const currentSelect = document.getElementById('movies-instance-select');
                if (currentSelect && currentSelect.parentNode) {
                    currentSelect.parentNode.replaceChild(newSelect, currentSelect);
                }
            }

            newSelect.addEventListener('change', async () => {
                await this._setMovieInstance(newSelect.value);

                const grid = document.getElementById('movies-grid');
                if (grid) {
                    grid.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Loading movies...</p></div>';
                }

                if (this.moviesObserver) {
                    this.moviesObserver.disconnect();
                    this.moviesObserver = null;
                }

                this.moviesPage = 1;
                this.moviesHasMore = true;
                this.isLoadingMovies = false;
                this.moviesRequestToken++;

                await new Promise(resolve => setTimeout(resolve, 50));
                await this.loadMovies();
                this.setupMoviesInfiniteScroll();
            });
            this._movieInstancesPopulated = true;
        } catch (error) {
            console.error('[RequestarrContent] Error loading movie instances:', error);
            select.innerHTML = '<option value="">Error loading instances</option>';
        } finally {
            this._loadingMovieInstances = false;
        }
    }

    async loadTVInstances() {
            const select = document.getElementById('tv-instance-select');
            if (!select) return;

            if (this._tvInstancesPopulated) {
                this._syncAllTVSelectors();
                return;
            }

            if (this._loadingTVInstances) return;
            this._loadingTVInstances = true;

            select.innerHTML = '<option value="">Loading instances...</option>';

            try {
                const dd = await this._fetchBundleDropdownOptions();
                const savedValue = this.selectedTVInstance;
                const matched = this._populateSelectFromOptions(select, dd.tv_options, savedValue);

                if (matched) {
                    this._setTVInstance(matched);
                } else {
                    this.selectedTVInstance = null;
                }

                // Setup change handler (remove old listener via clone)
                const newSelect = select.cloneNode(true);
                if (select.parentNode) {
                    select.parentNode.replaceChild(newSelect, select);
                } else {
                    const currentSelect = document.getElementById('tv-instance-select');
                    if (currentSelect && currentSelect.parentNode) {
                        currentSelect.parentNode.replaceChild(newSelect, currentSelect);
                    }
                }

                newSelect.addEventListener('change', async () => {
                    await this._setTVInstance(newSelect.value);

                    const grid = document.getElementById('tv-grid');
                    if (grid) {
                        grid.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Loading TV shows...</p></div>';
                    }

                    if (this.tvObserver) {
                        this.tvObserver.disconnect();
                        this.tvObserver = null;
                    }

                    this.tvPage = 1;
                    this.tvHasMore = true;
                    this.isLoadingTV = false;
                    this.tvRequestToken++;

                    await new Promise(resolve => setTimeout(resolve, 50));
                    await this.loadTV();
                    this.setupTVInfiniteScroll();
                });
                this._tvInstancesPopulated = true;
            } catch (error) {
                console.error('[RequestarrContent] Error loading TV instances:', error);
                select.innerHTML = '<option value="">Error loading instances</option>';
            } finally {
                this._loadingTVInstances = false;
            }
        }

    // ========================================
    // CONTENT LOADING
    // ========================================

    async loadDiscoverContent() {
        // Load server defaults + discover instance selectors
        await this._loadServerDefaults();
        await this.setupDiscoverInstances();
        
        // Load hidden media IDs for filtering
        await this.loadHiddenMediaIds();

        // Initialize Smart Hunt carousel on the Discover page (check main settings toggle)
        this._initDiscoverSmartHunt();
        
        await Promise.all([
            this.loadTrending(),
            this.loadPopularMovies(),
            this.loadPopularTV()
        ]);
    }

    /** Initialize Smart Hunt carousel on the Discover page */
    async _initDiscoverSmartHunt() {
        const section = document.getElementById('discover-smarthunt-section');
        if (section) section.style.display = '';

        if (!window.SmartHunt) return;
        const self = this;
        if (this._discoverSmartHunt) {
            this._discoverSmartHunt.destroy();
        }
        this._discoverSmartHunt = new window.SmartHunt({
            carouselId: 'discover-smarthunt-carousel',
            core: { content: this },
            getMovieInstance: () => self.selectedMovieInstance || '',
            getTVInstance: () => self.selectedTVInstance || '',
        });
        this._discoverSmartHunt.load();
    }

    async loadHiddenMediaIds() {
        try {
            // Fetch all hidden media (no pagination, we need all IDs)
            const [hiddenResp, blacklistResp] = await Promise.all([
                fetch('./api/requestarr/hidden-media?page=1&page_size=10000'),
                fetch('./api/requestarr/requests/global-blacklist/ids')
            ]);
            const data = await hiddenResp.json();
            const hiddenItems = Array.isArray(data.hidden_media)
                ? data.hidden_media
                : (Array.isArray(data.items) ? data.items : []);
            
            // Store hidden media as a Set of "tmdb_id:media_type" for fast cross-instance lookup
            this.hiddenMediaSet = new Set();
            hiddenItems.forEach(item => {
                const key = `${item.tmdb_id}:${item.media_type}`;
                this.hiddenMediaSet.add(key);
            });

            // Store global blacklist as a Set of "tmdb_id:media_type" for fast lookup
            this.globalBlacklistSet = new Set();
            const blData = await blacklistResp.json();
            (blData.items || []).forEach(item => {
                this.globalBlacklistSet.add(`${item.tmdb_id}:${item.media_type}`);
            });

            console.log('[RequestarrContent] Loaded', this.hiddenMediaSet.size, 'hidden media items,', this.globalBlacklistSet.size, 'global blacklist items');
        } catch (error) {
            console.error('[RequestarrContent] Error loading hidden media IDs:', error);
            this.hiddenMediaSet = new Set();
            this.globalBlacklistSet = new Set();
        }
    }

    isMediaHidden(tmdbId, mediaType, appType, instanceName) {
        if (!this.hiddenMediaSet) return false;
        // Cross-instance: check by tmdb_id:media_type only
        const key = `${tmdbId}:${mediaType}`;
        return this.hiddenMediaSet.has(key);
    }

    isGloballyBlacklisted(tmdbId, mediaType) {
        if (!this.globalBlacklistSet) return false;
        return this.globalBlacklistSet.has(`${tmdbId}:${mediaType}`);
    }

    renderTrendingResults(carousel, results, append) {
        if (!carousel) return;
        if (results && results.length > 0) {
            if (!append) carousel.innerHTML = '';
            results.forEach(item => {
                const suggestedInstance = item.media_type === 'movie' ? (this.selectedMovieInstance || null) : (this.selectedTVInstance || null);
                let appType, instanceName;
                if (item.media_type === 'movie') {
                    const decoded = decodeInstanceValue(this.selectedMovieInstance);
                    appType = decoded.appType;
                    instanceName = decoded.name;
                } else {
                    const decoded = decodeInstanceValue(this.selectedTVInstance, 'sonarr');
                    appType = decoded.appType;
                    instanceName = decoded.name;
                }
                const tmdbId = item.tmdb_id || item.id;
                if (tmdbId && this.isGloballyBlacklisted(tmdbId, item.media_type)) return;
                if (tmdbId && instanceName && this.isMediaHidden(tmdbId, item.media_type, appType, instanceName)) return;
                carousel.appendChild(this.createMediaCard(item, suggestedInstance));
            });
        } else if (!append) {
            carousel.innerHTML = '<p style="color: #888; text-align: center; width: 100%; padding: 40px;">No trending content available</p>';
        }
    }

    /**
     * Build the trending API URL with current movie + TV instance params.
     * This sends instances directly to the backend so it doesn't need to read from DB.
     */
    _buildTrendingUrl() {
        let url = './api/requestarr/discover/trending';
        const params = [];
        if (this.selectedMovieInstance) {
            const decoded = decodeInstanceValue(this.selectedMovieInstance);
            if (decoded.appType) params.push(`movie_app_type=${encodeURIComponent(decoded.appType)}`);
            if (decoded.name) params.push(`movie_instance_name=${encodeURIComponent(decoded.name)}`);
        }
        if (this.selectedTVInstance) {
            const decoded = decodeInstanceValue(this.selectedTVInstance, 'sonarr');
            if (decoded.appType) params.push(`tv_app_type=${encodeURIComponent(decoded.appType)}`);
            if (decoded.name) params.push(`tv_instance_name=${encodeURIComponent(decoded.name)}`);
        }
        if (params.length > 0) url += '?' + params.join('&');
        return url;
    }

    async loadTrending() {
        this._trendingPage = 1;
        this._trendingHasMore = true;
        this._trendingLoading = false;
        const carousel = document.getElementById('trending-carousel');
        if (!carousel) return;
        try {
            const baseUrl = this._buildTrendingUrl();
            const sep = baseUrl.includes('?') ? '&' : '?';
            const url = baseUrl + sep + `page=1&_=${Date.now()}`;
            const response = await fetch(url, { cache: 'no-store' });
            const data = await response.json();
            const results = (data.results && data.results.length > 0) ? data.results : [];
            this.renderTrendingResults(carousel, results, false);
            this._trendingHasMore = results.length >= 10;
            this._attachCarouselInfiniteScroll(carousel, '_trending');
        } catch (error) {
            console.error('[RequestarrDiscover] Error loading trending:', error);
            carousel.innerHTML = '<p style="color: #ef4444; text-align: center; width: 100%; padding: 40px;">Failed to load trending content</p>';
        }
    }

    async _loadNextTrendingPage() {
        if (this._trendingLoading || !this._trendingHasMore) return;
        if (this._trendingPage >= 5) { this._trendingHasMore = false; return; }
        this._trendingLoading = true;
        const carousel = document.getElementById('trending-carousel');
        if (!carousel) { this._trendingLoading = false; return; }
        try {
            const page = this._trendingPage + 1;
            const baseUrl = this._buildTrendingUrl();
            const sep = baseUrl.includes('?') ? '&' : '?';
            const url = baseUrl + sep + `page=${page}&_=${Date.now()}`;
            const response = await fetch(url, { cache: 'no-store' });
            const data = await response.json();
            const results = (data.results && data.results.length > 0) ? data.results : [];
            this.renderTrendingResults(carousel, results, true);
            this._trendingPage = page;
            this._trendingHasMore = results.length >= 10 && page < 5;
        } catch (error) {
            console.error('[RequestarrDiscover] Error loading trending page:', error);
        } finally {
            this._trendingLoading = false;
        }
    }

    renderPopularMoviesResults(carousel, results, append) {
        if (!carousel) return;
        const decoded = decodeInstanceValue(this.selectedMovieInstance);
        if (results && results.length > 0) {
            if (!append) carousel.innerHTML = '';
            results.forEach(item => {
                const tmdbId = item.tmdb_id || item.id;
                if (tmdbId && this.isGloballyBlacklisted(tmdbId, 'movie')) return;
                if (tmdbId && decoded.name && this.isMediaHidden(tmdbId, 'movie', decoded.appType, decoded.name)) return;
                carousel.appendChild(this.createMediaCard(item, this.selectedMovieInstance || null));
            });
        } else if (!append) {
            carousel.innerHTML = '<p style="color: #888; text-align: center; width: 100%; padding: 40px;">No movies available</p>';
        }
    }

    async loadPopularMovies() {
        this._popMoviesPage = 1;
        this._popMoviesHasMore = true;
        this._popMoviesLoading = false;
        const carousel = document.getElementById('popular-movies-carousel');
        if (!carousel) return;
        try {
            const decoded = decodeInstanceValue(this.selectedMovieInstance);
            let url = './api/requestarr/discover/movies?page=1';
            if (decoded.name) url += `&app_type=${decoded.appType}&instance_name=${encodeURIComponent(decoded.name)}`;
            url += `&_=${Date.now()}`;
            const response = await fetch(url, { cache: 'no-store' });
            const data = await response.json();
            const results = (data.results && data.results.length > 0) ? data.results : [];
            this.renderPopularMoviesResults(carousel, results, false);
            this._popMoviesHasMore = results.length >= 10;
            this._attachCarouselInfiniteScroll(carousel, '_popMovies');
        } catch (error) {
            console.error('[RequestarrDiscover] Error loading popular movies:', error);
            carousel.innerHTML = '<p style="color: #ef4444; text-align: center; width: 100%; padding: 40px;">Failed to load movies</p>';
        }
    }

    async _loadNextPopularMoviesPage() {
        if (this._popMoviesLoading || !this._popMoviesHasMore) return;
        if (this._popMoviesPage >= 5) { this._popMoviesHasMore = false; return; }
        this._popMoviesLoading = true;
        const carousel = document.getElementById('popular-movies-carousel');
        if (!carousel) { this._popMoviesLoading = false; return; }
        try {
            const page = this._popMoviesPage + 1;
            const decoded = decodeInstanceValue(this.selectedMovieInstance);
            let url = `./api/requestarr/discover/movies?page=${page}`;
            if (decoded.name) url += `&app_type=${decoded.appType}&instance_name=${encodeURIComponent(decoded.name)}`;
            url += `&_=${Date.now()}`;
            const response = await fetch(url, { cache: 'no-store' });
            const data = await response.json();
            const results = (data.results && data.results.length > 0) ? data.results : [];
            this.renderPopularMoviesResults(carousel, results, true);
            this._popMoviesPage = page;
            this._popMoviesHasMore = results.length >= 10 && page < 5;
        } catch (error) {
            console.error('[RequestarrDiscover] Error loading popular movies page:', error);
        } finally {
            this._popMoviesLoading = false;
        }
    }

    renderPopularTVResults(carousel, results, append) {
        if (!carousel) return;
        const decoded = decodeInstanceValue(this.selectedTVInstance, 'sonarr');
        if (results && results.length > 0) {
            if (!append) carousel.innerHTML = '';
            results.forEach(item => {
                const tmdbId = item.tmdb_id || item.id;
                if (tmdbId && this.isGloballyBlacklisted(tmdbId, 'tv')) return;
                if (tmdbId && decoded.name && this.isMediaHidden(tmdbId, 'tv', decoded.appType, decoded.name)) return;
                carousel.appendChild(this.createMediaCard(item, this.selectedTVInstance || null));
            });
        } else if (!append) {
            carousel.innerHTML = '<p style="color: #888; text-align: center; width: 100%; padding: 40px;">No TV shows available</p>';
        }
    }

    async loadPopularTV() {
        this._popTVPage = 1;
        this._popTVHasMore = true;
        this._popTVLoading = false;
        const carousel = document.getElementById('popular-tv-carousel');
        if (!carousel) return;
        try {
            const decoded = decodeInstanceValue(this.selectedTVInstance, 'sonarr');
            let url = './api/requestarr/discover/tv?page=1';
            if (decoded.name) url += `&app_type=${encodeURIComponent(decoded.appType || 'sonarr')}&instance_name=${encodeURIComponent(decoded.name)}`;
            url += `&_=${Date.now()}`;
            const response = await fetch(url, { cache: 'no-store' });
            const data = await response.json();
            const results = (data.results && data.results.length > 0) ? data.results : [];
            this.renderPopularTVResults(carousel, results, false);
            this._popTVHasMore = results.length >= 10;
            this._attachCarouselInfiniteScroll(carousel, '_popTV');
        } catch (error) {
            console.error('[RequestarrDiscover] Error loading popular TV:', error);
            carousel.innerHTML = '<p style="color: #ef4444; text-align: center; width: 100%; padding: 40px;">Failed to load TV shows</p>';
        }
    }

    async _loadNextPopularTVPage() {
        if (this._popTVLoading || !this._popTVHasMore) return;
        if (this._popTVPage >= 5) { this._popTVHasMore = false; return; }
        this._popTVLoading = true;
        const carousel = document.getElementById('popular-tv-carousel');
        if (!carousel) { this._popTVLoading = false; return; }
        try {
            const page = this._popTVPage + 1;
            const decoded = decodeInstanceValue(this.selectedTVInstance, 'sonarr');
            let url = `./api/requestarr/discover/tv?page=${page}`;
            if (decoded.name) url += `&app_type=${encodeURIComponent(decoded.appType || 'sonarr')}&instance_name=${encodeURIComponent(decoded.name)}`;
            url += `&_=${Date.now()}`;
            const response = await fetch(url, { cache: 'no-store' });
            const data = await response.json();
            const results = (data.results && data.results.length > 0) ? data.results : [];
            this.renderPopularTVResults(carousel, results, true);
            this._popTVPage = page;
            this._popTVHasMore = results.length >= 10 && page < 5;
        } catch (error) {
            console.error('[RequestarrDiscover] Error loading popular TV page:', error);
        } finally {
            this._popTVLoading = false;
        }
    }

    /**
     * Attach an infinite scroll listener to a horizontal carousel.
     * When the user scrolls within 300px of the right edge, load the next page.
     * @param {HTMLElement} carousel - the .media-carousel element
     * @param {string} prefix - property prefix, e.g. '_trending', '_popMovies', '_popTV'
     */
    _attachCarouselInfiniteScroll(carousel, prefix) {
        if (!carousel) return;
        // Remove any previous handler for this carousel
        const handlerKey = prefix + 'ScrollHandler';
        if (this[handlerKey]) {
            carousel.removeEventListener('scroll', this[handlerKey]);
        }
        const self = this;
        this[handlerKey] = () => {
            const loading = self[prefix + 'Loading'];
            const hasMore = self[prefix + 'HasMore'];
            if (loading || !hasMore) return;
            const remaining = carousel.scrollWidth - carousel.scrollLeft - carousel.clientWidth;
            if (remaining < 300) {
                if (prefix === '_trending') self._loadNextTrendingPage();
                else if (prefix === '_popMovies') self._loadNextPopularMoviesPage();
                else if (prefix === '_popTV') self._loadNextPopularTVPage();
            }
        };
        carousel.addEventListener('scroll', this[handlerKey], { passive: true });
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
            
            // Add instance info for library status checking (decode compound value)
            if (this.selectedMovieInstance) {
                const decoded = decodeInstanceValue(this.selectedMovieInstance);
                url += `&app_type=${decoded.appType}&instance_name=${encodeURIComponent(decoded.name)}`;
            }
            
            // Add filter parameters
            if (this.core.filters) {
                const filterParams = this.core.filters.getFilterParams();
                if (filterParams) {
                    url += `&${filterParams}`;
                }
            }
            
            const response = await fetch(url, { cache: 'no-store' });

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
                    // Filter out hidden media (decode compound value for correct app_type)
                    const tmdbId = item.tmdb_id || item.id;
                    // Filter globally blacklisted items
                    if (tmdbId && this.isGloballyBlacklisted(tmdbId, 'movie')) return;
                    if (tmdbId && this.selectedMovieInstance) {
                        const dHidden = decodeInstanceValue(this.selectedMovieInstance);
                        if (this.isMediaHidden(tmdbId, 'movie', dHidden.appType, dHidden.name)) {
                            return; // Skip hidden items
                        }
                    }
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
                const decoded = decodeInstanceValue(this.selectedTVInstance, 'sonarr');
                url += `&app_type=${encodeURIComponent(decoded.appType || 'sonarr')}&instance_name=${encodeURIComponent(decoded.name || '')}`;
            }
            
            // Add filter parameters
            if (this.core.tvFilters) {
                const filterParams = this.core.tvFilters.getFilterParams();
                if (filterParams) {
                    url += `&${filterParams}`;
                }
            }
            
            const response = await fetch(url, { cache: 'no-store' });
            
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
                const tvDecoded = this.selectedTVInstance ? decodeInstanceValue(this.selectedTVInstance, 'sonarr') : null;
                data.results.forEach((item) => {
                    // Filter out hidden media
                    const tmdbId = item.tmdb_id || item.id;
                    // Filter globally blacklisted items
                    if (tmdbId && this.isGloballyBlacklisted(tmdbId, 'tv')) return;
                    if (tmdbId && tvDecoded && tvDecoded.name && this.isMediaHidden(tmdbId, 'tv', tvDecoded.appType, tvDecoded.name)) {
                        return; // Skip hidden items
                    }
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

    createMediaCard(item, suggestedInstance = null) {
        const card = document.createElement('div');
        card.className = 'media-card';
        
        // Store tmdb_id and media_type as data attributes for easy updates
        card.setAttribute('data-tmdb-id', item.tmdb_id);
        card.setAttribute('data-media-type', item.media_type);
        // Store full item data for hide functionality
        card.itemData = item;
        
        // Store suggested instance for modal
        card.suggestedInstance = suggestedInstance;
        
        const posterUrl = item.poster_path || './static/images/blackout.jpg';
        const year = item.year || 'N/A';
        const rating = item.vote_average ? item.vote_average.toFixed(1) : 'N/A';
        const overview = item.overview || 'No description available.';
        
        const inLibrary = item.in_library || false;
        const partial = item.partial || false;
        const importable = item.importable || false;
        const pending = item.pending || false;
        const hasInstance = item.media_type === 'movie'
            ? ((this.core.instances.radarr || []).length > 0 || (this.core.instances.movie_hunt || []).length > 0)
            : ((this.core.instances.sonarr || []).length > 0 || (this.core.instances.tv_hunt || []).length > 0);
        const metaClassName = hasInstance ? 'media-card-meta' : 'media-card-meta no-hide';
        
        // Determine status badge (shared utility)
        const statusBadgeHTML = window.MediaUtils ? window.MediaUtils.getStatusBadge(inLibrary, partial, hasInstance, importable, pending) : '';
        
        if (inLibrary || partial) {
            card.classList.add('in-library');
        }
        
        // Only show Request button when not in library or collection
        const showRequestBtn = !inLibrary && !partial;
        const overlayActionHTML = showRequestBtn
            ? '<button class="media-card-request-btn"><i class="fas fa-download"></i> Request</button>'
            : '';
        
        const typeBadgeLabel = item.media_type === 'tv' ? 'TV' : 'Movie';
        const typeBadgeHTML = `<span class="media-type-badge">${typeBadgeLabel}</span>`;

        // Check if globally blacklisted
        const isBlacklisted = this.isGloballyBlacklisted(item.tmdb_id, item.media_type);
        const blacklistBadgeHTML = isBlacklisted ? '<span class="media-blacklist-badge"><i class="fas fa-ban"></i> Blacklisted</span>' : '';
        const blacklistOverlayHTML = isBlacklisted ? '<div class="media-card-blacklist-overlay"><i class="fas fa-ban"></i> Globally Blacklisted</div>' : '';

        card.innerHTML = `
            <div class="media-card-poster">
                ${statusBadgeHTML}
                <img src="${posterUrl}" alt="${item.title}" onerror="this.src='./static/images/blackout.jpg'">
                ${typeBadgeHTML}
                ${blacklistBadgeHTML}
                <div class="media-card-overlay">
                    <div class="media-card-overlay-title">${item.title}</div>
                    <div class="media-card-overlay-content">
                        <div class="media-card-overlay-year">${year}</div>
                        <div class="media-card-overlay-description">${overview}</div>
                        ${isBlacklisted ? blacklistOverlayHTML : overlayActionHTML}
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
                    ${window.MediaUtils ? window.MediaUtils.getActionButton(inLibrary, partial, hasInstance) : ''}
                </div>
            </div>
        `;
        
        // Load and cache image asynchronously after card is created
        if (posterUrl && !posterUrl.includes('./static/images/') && window.getCachedTMDBImage && window.tmdbImageCache) {
            const imgElement = card.querySelector('.media-card-poster img');
            if (imgElement) {
                window.getCachedTMDBImage(posterUrl, window.tmdbImageCache).then(cachedUrl => {
                    if (cachedUrl && cachedUrl !== posterUrl) {
                        imgElement.src = cachedUrl;
                    }
                }).catch(err => {
                    console.error('[RequestarrContent] Failed to cache image:', err);
                });
            }
        }
        
        const requestBtn = card.querySelector('.media-card-request-btn');
        const hideBtn = card.querySelector('.media-card-hide-btn');
        const deleteBtn = card.querySelector('.media-card-delete-btn');
        
        // Click anywhere on card opens detail page (poster/body); Request button opens modal
        card.style.cursor = 'pointer';
        card.addEventListener('click', (e) => {
            // Request button opens modal only
            if (requestBtn && (e.target === requestBtn || requestBtn.contains(e.target))) {
                e.preventDefault();
                e.stopPropagation();
                this.core.modal.openModal(item.tmdb_id, item.media_type, card.suggestedInstance);
                return;
            }
            // Delete button opens delete modal
            if (deleteBtn && (e.target === deleteBtn || deleteBtn.contains(e.target))) {
                e.preventDefault();
                e.stopPropagation();
                this._openDeleteModal(item, card);
                return;
            }
            // Hide button only hides
            if (hideBtn && (e.target === hideBtn || hideBtn.contains(e.target))) {
                e.preventDefault();
                e.stopPropagation();
                this.hideMedia(item.tmdb_id, item.media_type, item.title, card);
                return;
            }
            
            // Check live card state — badge may have been updated by _syncCardBadge
            // after initial render (e.g. modal detected show exists in collection)
            const liveInLibrary = card.classList.contains('in-library');
            const liveBadge = card.querySelector('.media-card-status-badge');
            const livePartial = liveBadge ? liveBadge.classList.contains('partial') : false;
            const livePending = liveBadge ? liveBadge.classList.contains('pending') : false;
            const shouldOpenModal = !liveInLibrary && !livePartial || livePending;

            if (item.media_type === 'movie') {
                if (!shouldOpenModal && window.RequestarrDetail && window.RequestarrDetail.openDetail) {
                    window.RequestarrDetail.openDetail({
                        tmdb_id: item.tmdb_id, id: item.tmdb_id,
                        title: item.title, year: item.year,
                        poster_path: item.poster_path, backdrop_path: item.backdrop_path,
                        overview: item.overview, vote_average: item.vote_average,
                        in_library: liveInLibrary
                    }, { suggestedInstance: card.suggestedInstance });
                } else {
                    this.core.modal.openModal(item.tmdb_id, item.media_type, card.suggestedInstance);
                }
            } else {
                if (!shouldOpenModal && window.RequestarrTVDetail && window.RequestarrTVDetail.openDetail) {
                    window.RequestarrTVDetail.openDetail({
                        tmdb_id: item.tmdb_id, id: item.tmdb_id,
                        title: item.title, name: item.title, year: item.year,
                        poster_path: item.poster_path, backdrop_path: item.backdrop_path,
                        overview: item.overview, vote_average: item.vote_average,
                        in_library: liveInLibrary
                    }, { suggestedInstance: card.suggestedInstance });
                } else {
                    this.core.modal.openModal(item.tmdb_id, item.media_type, card.suggestedInstance);
                }
            }
        });
        
        return card;
    }

    /**
     * Open the shared delete modal from a Requestarr card.
     */
    _openDeleteModal(item, cardElement) {
        if (!window.MovieCardDeleteModal) {
            console.error('[RequestarrContent] MovieCardDeleteModal not loaded');
            return;
        }
        const inLibrary = item.in_library || false;
        const partial = item.partial || false;
        const status = inLibrary ? 'available' : (partial ? 'requested' : 'requested');

        // Resolve instance info from compound value
        let appType = 'movie_hunt';
        let instanceName = '';
        let instanceId = '';
        const compoundValue = this.selectedMovieInstance || (cardElement.suggestedInstance || '');
        if (compoundValue) {
            const decoded = decodeInstanceValue(compoundValue);
            appType = decoded.appType || 'movie_hunt';
            instanceName = decoded.name || '';
        }
        // Try to resolve numeric instance ID
        if (this.core && this.core.instances) {
            const pool = this.core.instances[appType] || [];
            const match = pool.find(i => i.name === instanceName);
            if (match) instanceId = match.id || '';
        }

        window.MovieCardDeleteModal.open(item, {
            instanceName: instanceName,
            instanceId: instanceId,
            status: status,
            hasFile: inLibrary,
            appType: appType,
            onDeleted: function() {
                window.MediaUtils.animateCardRemoval(cardElement);
            }
        });
    }

    hideMedia(tmdbId, mediaType, title, cardElement) {
        const self = this;
        const item = cardElement.itemData || {};
        const posterPath = item.poster_path || null;

        // Resolve app_type and instance name
        let appType, instanceName;
        if (mediaType === 'movie') {
            const compoundValue = self.selectedMovieInstance || (cardElement.suggestedInstance || '');
            if (compoundValue) {
                const decoded = decodeInstanceValue(compoundValue);
                appType = decoded.appType;
                instanceName = decoded.name;
            } else if (self.core && self.core.instances) {
                const mhInst = self.core.instances.movie_hunt || [];
                const rInst = self.core.instances.radarr || [];
                if (mhInst.length > 0) { appType = 'movie_hunt'; instanceName = mhInst[0].name; }
                else if (rInst.length > 0) { appType = 'radarr'; instanceName = rInst[0].name; }
                else { appType = 'radarr'; instanceName = null; }
            } else {
                appType = 'radarr'; instanceName = null;
            }
        } else {
            appType = 'sonarr';
            instanceName = self.selectedTVInstance;
            if (!instanceName && cardElement.suggestedInstance) instanceName = cardElement.suggestedInstance;
            if (!instanceName && self.core && self.core.instances) {
                const instances = self.core.instances.sonarr || [];
                instanceName = instances.length > 0 ? instances[0].name : null;
            }
        }

        window.MediaUtils.hideMedia({
            tmdbId: tmdbId,
            mediaType: mediaType,
            title: title,
            posterPath: posterPath,
            appType: appType || 'radarr',
            instanceName: instanceName || '',
            cardElement: cardElement,
            hiddenMediaSet: self.hiddenMediaSet
        });
    }
}


/* === modules/features/requestarr/requestarr-modal.js === */
/**
 * Requestarr Modal - Two-column poster + form layout (matches Movie Hunt design)
 */

/* encodeInstanceValue, decodeInstanceValue from requestarr-core-utils.js (loaded first) */
class RequestarrModal {
    constructor(core) {
        this.core = core;
    }
    
    // ========================================
    // MODAL SYSTEM
    // ========================================

    async openModal(tmdbId, mediaType, suggestedInstance = null) {
        const modal = document.getElementById('media-modal');
        if (!modal) return;

        // Load modal preferences from server
        await this.loadModalPreferences();

        // Move modal to body so it sits outside .app-container and is not blurred
        if (modal.parentElement !== document.body) {
            document.body.appendChild(modal);
        }

        document.body.classList.add('requestarr-modal-open');
        modal.style.display = 'flex';

        // Show loading state in the existing elements
        const titleEl = document.getElementById('requestarr-modal-title');
        const labelEl = document.getElementById('requestarr-modal-label');
        const metaEl = document.getElementById('requestarr-modal-meta');
        const statusContainer = document.getElementById('requestarr-modal-status-container');
        const posterImg = document.getElementById('requestarr-modal-poster-img');
        const requestBtn = document.getElementById('modal-request-btn');
        const instanceSelect = document.getElementById('modal-instance-select');
        const rootSelect = document.getElementById('modal-root-folder');
        const qualitySelect = document.getElementById('modal-quality-profile');

        if (titleEl) titleEl.textContent = 'Loading...';
        if (labelEl) labelEl.textContent = mediaType === 'tv' ? 'Add Series' : 'Add Movie';
        if (metaEl) metaEl.textContent = '';
        if (statusContainer) statusContainer.innerHTML = '<span class="mh-req-badge mh-req-badge-loading"><i class="fas fa-spinner fa-spin"></i> Loading...</span>';
        if (posterImg) posterImg.src = './static/images/blackout.jpg';
        if (requestBtn) { requestBtn.disabled = true; requestBtn.textContent = 'Add to Library'; requestBtn.classList.remove('disabled', 'success'); }
        if (instanceSelect) instanceSelect.innerHTML = '<option value="">Loading...</option>';
        const instanceInfoIcon = document.getElementById('modal-instance-info-icon');
        if (instanceInfoIcon) instanceInfoIcon.style.display = 'none';
        if (rootSelect) rootSelect.innerHTML = '<option value="">Loading...</option>';
        if (qualitySelect) qualitySelect.innerHTML = '<option value="">Loading...</option>';

        // Always hide Movie-Hunt-only and TV-Hunt-only fields first; renderModal will show them if needed
        // Uses class toggle because .mh-req-field has display:grid!important which overrides inline styles
        const wrapMinInit = document.getElementById('requestarr-modal-min-availability-wrap');
        const wrapStartInit = document.getElementById('requestarr-modal-start-search-wrap');
        const wrapMonitorInit = document.getElementById('requestarr-modal-monitor-wrap');
        if (wrapMinInit) wrapMinInit.classList.add('mh-hidden');
        if (wrapStartInit) wrapStartInit.classList.add('mh-hidden');
        if (wrapMonitorInit) wrapMonitorInit.classList.add('mh-hidden');

        // Attach close handlers (use .onclick to avoid stacking)
        const self = this;
        const backdrop = document.getElementById('requestarr-modal-backdrop');
        const closeBtn = document.getElementById('requestarr-modal-close');
        const cancelBtn = document.getElementById('requestarr-modal-cancel');
        const startCb = document.getElementById('modal-start-search');
        const minSelect = document.getElementById('modal-minimum-availability');

        if (backdrop) backdrop.onclick = () => self.closeModal();
        if (closeBtn) closeBtn.onclick = () => self.closeModal();
        if (cancelBtn) cancelBtn.onclick = () => self.closeModal();
        if (requestBtn) requestBtn.onclick = () => self.submitRequest();

        // Attach change listeners for preferences
        if (startCb) {
            startCb.onchange = () => {
                this.saveModalPreferences({ start_search: startCb.checked });
            };
        }
        if (minSelect) {
            minSelect.onchange = () => {
                this.saveModalPreferences({ minimum_availability: minSelect.value });
            };
        }
        const rootSelectEl = document.getElementById('modal-root-folder');
        if (rootSelectEl) {
            rootSelectEl.onchange = () => this._updateRequestButtonFromRootFolder();
        }

        this.suggestedInstance = suggestedInstance;

        try {
            const response = await fetch(`./api/requestarr/details/${mediaType}/${tmdbId}`);
            const data = await response.json();

            if (data.tmdb_id) {
                this.core.currentModal = data;
                this.core.currentModalData = data;
                this.renderModal(data);
            } else {
                throw new Error('Failed to load details');
            }
        } catch (error) {
            console.error('[RequestarrModal] Error loading details:', error);
            if (titleEl) titleEl.textContent = 'Error';
            if (statusContainer) statusContainer.innerHTML = '<span class="mh-req-badge mh-req-badge-error"><i class="fas fa-exclamation-triangle"></i> Failed to load details</span>';
        }
    }

    async loadModalPreferences() {
        try {
            const response = await fetch('./api/requestarr/settings/modal-preferences');
            const result = await response.json();
            if (result.success) {
                this.preferences = result.preferences;
            } else {
                this.preferences = {
                    start_search: true,
                    minimum_availability: 'released',
                    movie_instance: '',
                    tv_instance: ''
                };
            }
        } catch (error) {
            console.error('[RequestarrModal] Error loading preferences:', error);
            this.preferences = {
                start_search: true,
                minimum_availability: 'released',
                movie_instance: '',
                tv_instance: ''
            };
        }
    }

    async saveModalPreferences(prefs) {
        try {
            await fetch('./api/requestarr/settings/modal-preferences', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(prefs)
            });
            // Update local object
            Object.assign(this.preferences, prefs);
        } catch (error) {
            console.error('[RequestarrModal] Error saving preferences:', error);
        }
    }

    renderModal(data) {
            const isTVShow = data.media_type === 'tv';
            const isOwner = window._huntarrUserRole === 'owner';
            const perms = window._huntarrUserPermissions || {};

            // For movies, combine Movie Hunt + Radarr; for TV, combine TV Hunt + Sonarr
            let uniqueInstances = [];
            if (isTVShow) {
                const thInstances = (this.core.instances.tv_hunt || []).map(inst => ({
                    ...inst, appType: 'tv_hunt', compoundValue: encodeInstanceValue('tv_hunt', inst.name),
                    label: `TV Hunt \u2013 ${inst.name}`
                }));
                const sonarrInstances = (this.core.instances.sonarr || []).map(inst => ({
                    ...inst, appType: 'sonarr', compoundValue: encodeInstanceValue('sonarr', inst.name),
                    label: `Sonarr \u2013 ${inst.name}`
                }));
                const seen = new Set();
                thInstances.forEach(inst => {
                    if (!seen.has(inst.compoundValue)) {
                        seen.add(inst.compoundValue);
                        uniqueInstances.push(inst);
                    }
                });
                sonarrInstances.forEach(inst => {
                    if (!seen.has(inst.compoundValue)) {
                        seen.add(inst.compoundValue);
                        uniqueInstances.push(inst);
                    }
                });
            } else {
                const mhInstances = this.core.instances.movie_hunt || [];
                const radarrInstances = this.core.instances.radarr || [];
                const seen = new Set();
                mhInstances.forEach(inst => {
                    if (!seen.has(inst.name)) {
                        seen.add(inst.name);
                        uniqueInstances.push({
                            ...inst,
                            appType: 'movie_hunt',
                            compoundValue: encodeInstanceValue('movie_hunt', inst.name),
                            label: `Movie Hunt \u2013 ${inst.name}`
                        });
                    }
                });
                radarrInstances.forEach(inst => {
                    if (!seen.has(`radarr-${inst.name}`)) {
                        seen.add(`radarr-${inst.name}`);
                        uniqueInstances.push({
                            ...inst,
                            appType: 'radarr',
                            compoundValue: encodeInstanceValue('radarr', inst.name),
                            label: `Radarr \u2013 ${inst.name}`
                        });
                    }
                });
            }

            // Populate poster
            const posterImg = document.getElementById('requestarr-modal-poster-img');
            if (posterImg) posterImg.src = data.poster_path || './static/images/blackout.jpg';

            // Populate title
            const titleEl = document.getElementById('requestarr-modal-title');
            if (titleEl) titleEl.textContent = data.title || '';

            // Populate label
            const labelEl = document.getElementById('requestarr-modal-label');
            if (labelEl) labelEl.textContent = isTVShow ? 'Request Series' : 'Request Movie';

            // Populate meta (year, genres)
            const metaEl = document.getElementById('requestarr-modal-meta');
            if (metaEl) {
                const parts = [];
                if (data.year) parts.push(String(data.year));
                if (data.genres && data.genres.length) {
                    const genreNames = data.genres
                        .slice(0, 3)
                        .map(g => typeof g === 'string' ? g : (g.name || ''))
                        .filter(Boolean);
                    if (genreNames.length) parts.push(genreNames.join(', '));
                }
                metaEl.textContent = parts.join('  \u00B7  ');
            }

            const fieldsContainer = document.querySelector('.mh-req-fields');
            const startSearchWrap = document.getElementById('requestarr-modal-start-search-wrap');
            const statusContainer = document.getElementById('requestarr-modal-status-container');
            const requestBtn = document.getElementById('modal-request-btn');
            const instanceSelect = document.getElementById('modal-instance-select');

            // ── Non-owner simplified modal ──
            if (!isOwner) {
                // Show fields container (for the instance row) but hide everything except instance
                if (fieldsContainer) fieldsContainer.style.display = '';
                if (startSearchWrap) startSearchWrap.classList.add('mh-hidden');
                this._clearImportBanner();

                // Hide root folder, quality profile, monitor, movie monitor, min availability rows
                const rootField = document.getElementById('modal-root-folder');
                const qualityField = document.getElementById('modal-quality-profile');
                if (rootField && rootField.closest('.mh-req-field')) rootField.closest('.mh-req-field').classList.add('mh-hidden');
                if (qualityField && qualityField.closest('.mh-req-field')) qualityField.closest('.mh-req-field').classList.add('mh-hidden');
                const monitorWrap = document.getElementById('requestarr-modal-monitor-wrap');
                const movieMonitorWrap = document.getElementById('requestarr-modal-movie-monitor-wrap');
                const minAvailWrap = document.getElementById('requestarr-modal-min-availability-wrap');
                if (monitorWrap) monitorWrap.classList.add('mh-hidden');
                if (movieMonitorWrap) movieMonitorWrap.classList.add('mh-hidden');
                if (minAvailWrap) minAvailWrap.classList.add('mh-hidden');

                // Resolve the page's current instance
                const pageInstance = this.suggestedInstance
                    || (isTVShow ? this.core.content.selectedTVInstance : this.core.content.selectedMovieInstance)
                    || uniqueInstances[0]?.compoundValue || '';

                // Populate instance dropdown with single option, greyed out
                if (instanceSelect) {
                    instanceSelect.innerHTML = '';
                    const matched = uniqueInstances.find(inst => inst.compoundValue === pageInstance || inst.name === pageInstance);
                    const opt = document.createElement('option');
                    opt.value = pageInstance;
                    opt.textContent = matched ? matched.label : pageInstance;
                    instanceSelect.appendChild(opt);
                    instanceSelect.disabled = true;
                    instanceSelect.style.opacity = '0.6';
                    instanceSelect.onchange = null;
                }
                const instanceInfoIcon = document.getElementById('modal-instance-info-icon');
                if (instanceInfoIcon) instanceInfoIcon.style.display = 'none';

                // Show permissions status row below instance (same field styling)
                const hasAutoApprove = isTVShow
                    ? (perms.auto_approve || perms.auto_approve_tv)
                    : (perms.auto_approve || perms.auto_approve_movies);

                // Remove any previous permissions row, then insert a new one
                const existingPermRow = document.getElementById('requestarr-modal-permissions-row');
                if (existingPermRow) existingPermRow.remove();
                const permRow = document.createElement('div');
                permRow.className = 'mh-req-field';
                permRow.id = 'requestarr-modal-permissions-row';
                const permLabel = document.createElement('label');
                permLabel.textContent = 'Status';
                const permValue = document.createElement('span');
                permValue.className = 'mh-req-perm-status';
                if (hasAutoApprove) {
                    permValue.innerHTML = '<i class="fas fa-check-circle"></i> Auto-Approved';
                    permValue.classList.add('mh-req-perm-approved');
                } else {
                    permValue.innerHTML = '<i class="fas fa-clock"></i> Requires Approval';
                    permValue.classList.add('mh-req-perm-pending');
                }
                permRow.appendChild(permLabel);
                permRow.appendChild(permValue);
                // Insert after the instance field
                const instanceField = instanceSelect ? instanceSelect.closest('.mh-req-field') : null;
                if (instanceField && instanceField.parentNode) {
                    instanceField.parentNode.insertBefore(permRow, instanceField.nextSibling);
                }

                // Clear status container (permissions info is now in the field row)
                if (statusContainer) statusContainer.innerHTML = '';

                // Configure request button
                if (requestBtn) {
                    requestBtn.disabled = !pageInstance;
                    requestBtn.classList.remove('disabled', 'success');
                    requestBtn.textContent = isTVShow ? 'Request Series' : 'Request Movie';
                    if (!pageInstance) requestBtn.classList.add('disabled');
                }
                // Push buttons to bottom-right of the form column
                const actionsArea = document.querySelector('.mh-req-actions');
                if (actionsArea) actionsArea.style.marginTop = 'auto';
                return;
            }

            // ── Owner full modal (existing logic) ──
            if (fieldsContainer) fieldsContainer.style.display = '';
            const actionsArea = document.querySelector('.mh-req-actions');
            if (actionsArea) actionsArea.style.marginTop = '';
            // Remove permissions row if present from previous non-owner render
            const existingPermRowOwner = document.getElementById('requestarr-modal-permissions-row');
            if (existingPermRowOwner) existingPermRowOwner.remove();
            // Re-show root/quality fields (may have been hidden by previous non-owner render)
            const rootField = document.getElementById('modal-root-folder');
            const qualityField = document.getElementById('modal-quality-profile');
            if (rootField && rootField.closest('.mh-req-field')) rootField.closest('.mh-req-field').classList.remove('mh-hidden');
            if (qualityField && qualityField.closest('.mh-req-field')) qualityField.closest('.mh-req-field').classList.remove('mh-hidden');
            if (instanceSelect) {
                instanceSelect.disabled = false;
                instanceSelect.style.opacity = '';
            }

            const currentlySelectedInstance = isTVShow ? (this.preferences?.tv_instance || this.core.content.selectedTVInstance) : (this.preferences?.movie_instance || this.core.content.selectedMovieInstance);
            const rawDefault = this.suggestedInstance || currentlySelectedInstance || uniqueInstances[0]?.compoundValue || uniqueInstances[0]?.name || '';

            let defaultInstance = rawDefault;
            let isMovieHunt = false;
            if (!isTVShow && rawDefault) {
                const matched = uniqueInstances.find(inst => inst.compoundValue === rawDefault || inst.name === rawDefault);
                if (matched) {
                    defaultInstance = matched.compoundValue || matched.name;
                    isMovieHunt = matched.appType === 'movie_hunt';
                }
            } else if (isTVShow && rawDefault) {
                const matched = uniqueInstances.find(inst => (inst.compoundValue || inst.name) === rawDefault || inst.name === rawDefault);
                if (matched) {
                    defaultInstance = matched.compoundValue || matched.name;
                    isMovieHunt = matched.appType === 'movie_hunt';
                }
            }
            const defaultDecoded = defaultInstance ? decodeInstanceValue(defaultInstance, isTVShow ? 'sonarr' : 'radarr') : {};
            const isTVHunt = isTVShow && defaultDecoded.appType === 'tv_hunt';

            console.log('[RequestarrModal] Resolved instance:', defaultInstance, 'isMovieHunt:', isMovieHunt, 'isTVHunt:', isTVHunt);

            if (instanceSelect) {
                instanceSelect.innerHTML = '';
                const instanceInfoIcon = document.getElementById('modal-instance-info-icon');
                if (instanceInfoIcon) instanceInfoIcon.style.display = 'none';
                if (uniqueInstances.length === 0) {
                    instanceSelect.innerHTML = '<option value="">No Instance Configured</option>';
                    instanceSelect.classList.add('field-warning');
                    this._showInstanceInfoIcon();
                } else {
                    instanceSelect.classList.remove('field-warning');
                    uniqueInstances.forEach(instance => {
                        const opt = document.createElement('option');
                        opt.value = instance.compoundValue || instance.name;
                        opt.textContent = instance.label || `${isTVShow ? (instance.appType === 'tv_hunt' ? 'TV Hunt' : 'Sonarr') : (instance.appType === 'movie_hunt' ? 'Movie Hunt' : 'Radarr')} \u2013 ${instance.name}`;
                        const isSelected = (instance.compoundValue || instance.name) === defaultInstance;
                        if (isSelected) opt.selected = true;
                        instanceSelect.appendChild(opt);
                    });
                    if (!defaultInstance && uniqueInstances.length > 0) {
                        instanceSelect.selectedIndex = 0;
                    }
                }
                instanceSelect.onchange = () => this.instanceChanged(instanceSelect.value);
            }

            const qualitySelect = document.getElementById('modal-quality-profile');
            const effectiveInstance = (instanceSelect && instanceSelect.value) ? instanceSelect.value : defaultInstance;
            if (qualitySelect) {
                const profDecoded = effectiveInstance ? decodeInstanceValue(effectiveInstance, isTVShow ? 'sonarr' : 'radarr') : {};
                const profileKey = `${profDecoded.appType || ''}-${profDecoded.name || ''}`;
                const profiles = this.core.qualityProfiles[profileKey] || [];
                const useHuntProfiles = isMovieHunt || isTVHunt;

                if (profiles.length === 0 && effectiveInstance) {
                    qualitySelect.innerHTML = '<option value="">Loading profiles...</option>';
                    this.core.loadQualityProfilesForInstance(profDecoded.appType, profDecoded.name).then(newProfiles => {
                        if (newProfiles && newProfiles.length > 0) {
                            this._populateQualityProfiles(qualitySelect, newProfiles, useHuntProfiles);
                        } else {
                            this._populateQualityProfiles(qualitySelect, [], useHuntProfiles);
                        }
                    });
                } else {
                    this._populateQualityProfiles(qualitySelect, profiles, useHuntProfiles);
                }
            }

            if (requestBtn) {
                requestBtn.disabled = false;
                requestBtn.classList.remove('disabled', 'success');
                requestBtn.textContent = 'Request';
            }
            this._applyMovieHuntModalMode(effectiveInstance, isTVShow, labelEl, requestBtn);

            if (defaultInstance) {
                if (statusContainer) {
                    statusContainer.innerHTML = '<span class="mh-req-badge mh-req-badge-loading"><i class="fas fa-spinner fa-spin"></i> Checking...</span>';
                }
                this.loadModalRootFolders(defaultInstance, isTVShow);
                if (isTVShow) {
                    this.loadSeriesStatus(defaultInstance);
                } else {
                    this.loadMovieStatus(defaultInstance);
                }
            } else {
                if (statusContainer) {
                    statusContainer.innerHTML = '';
                }
                const rootSelect = document.getElementById('modal-root-folder');
                if (rootSelect) {
                    rootSelect.innerHTML = '<option value="">Select an instance first</option>';
                    rootSelect.classList.remove('field-warning');
                }
            }

            if (uniqueInstances.length === 0 && requestBtn) {
                requestBtn.disabled = true;
                requestBtn.classList.add('disabled');
            }
        }

    async loadModalRootFolders(instanceName, isTVShow) {
        const rootSelect = document.getElementById('modal-root-folder');
        if (!rootSelect) return;

        if (this._loadingModalRootFolders) return;
        this._loadingModalRootFolders = true;

        // Decode compound value to get app type and actual name (both movies and TV support compound)
        const decoded = decodeInstanceValue(instanceName, isTVShow ? 'sonarr' : 'radarr');
        const appType = decoded.appType;
        const actualInstanceName = decoded.name;
        rootSelect.innerHTML = '<option value="">Loading...</option>';
        rootSelect.classList.remove('field-warning');
        const infoIcon = document.getElementById('modal-root-folder-info-icon');
        if (infoIcon) infoIcon.style.display = 'none';

        try {
            const response = await fetch(`./api/requestarr/rootfolders?app_type=${appType}&instance_name=${encodeURIComponent(actualInstanceName)}`);
            const data = await response.json();

            if (data.success && data.root_folders && data.root_folders.length > 0) {
                const seenPaths = new Map();
                data.root_folders.forEach(rf => {
                    if (!rf || !rf.path) return;
                    const originalPath = rf.path.trim();
                    const normalized = originalPath.replace(/\/+$/, '').toLowerCase();
                    if (!normalized) return;
                    if (!seenPaths.has(normalized)) {
                        seenPaths.set(normalized, { 
                            path: originalPath, 
                            freeSpace: rf.freeSpace,
                            isDefault: !!rf.is_default
                        });
                    }
                });

                if (seenPaths.size === 0) {
                    rootSelect.innerHTML = '<option value="">No Root Configured</option>';
                    rootSelect.classList.add('field-warning');
                    this._showRootFolderInfoIcon(instanceName, isTVShow);
                } else {
                    rootSelect.classList.remove('field-warning');
                    rootSelect.innerHTML = '';
                    let defaultFound = false;
                    let firstPath = null;
                    seenPaths.forEach(rf => {
                        const opt = document.createElement('option');
                        opt.value = rf.path;
                        opt.textContent = rf.path + (rf.freeSpace != null ? ` (${Math.round(rf.freeSpace / 1e9)} GB free)` : '');
                        if (rf.isDefault) {
                            opt.selected = true;
                            defaultFound = true;
                        }
                        if (!firstPath) firstPath = rf.path;
                        rootSelect.appendChild(opt);
                    });
                    if (!defaultFound && firstPath) {
                        rootSelect.value = firstPath;
                    }
                }
            } else {
                rootSelect.innerHTML = '<option value="">No Root Configured</option>';
                rootSelect.classList.add('field-warning');
                this._showRootFolderInfoIcon(instanceName, isTVShow);
            }
        } catch (error) {
            console.error('[RequestarrModal] Error loading root folders:', error);
            rootSelect.innerHTML = '<option value="">No Root Configured</option>';
            rootSelect.classList.add('field-warning');
            this._showRootFolderInfoIcon(instanceName, isTVShow);
        } finally {
            this._loadingModalRootFolders = false;
            this._updateRequestButtonFromRootFolder();
        }
    }

    /**
     * Show info icon when no instance configured; click navigates to Instances page.
     */
    _showInstanceInfoIcon() {
        const infoIcon = document.getElementById('modal-instance-info-icon');
        if (!infoIcon) return;
        infoIcon.style.display = '';
        const self = this;
        infoIcon.onclick = function(e) {
            e.preventDefault();
            self.closeModal();
            if (window.location.hash !== '#media-hunt-instances') {
                window.location.hash = '#media-hunt-instances';
            } else {
                window.dispatchEvent(new HashChangeEvent('hashchange'));
            }
        };
    }

    /**
     * Show info icon when no root configured; click navigates to Root Folders page with instance selected.
     */
    _showRootFolderInfoIcon(instanceName, isTVShow) {
        const decoded = decodeInstanceValue(instanceName, isTVShow ? 'sonarr' : 'radarr');
        const appType = decoded.appType || '';
        // Root Folders settings page only configures Movie Hunt and TV Hunt; hide icon for Sonarr/Radarr
        if (appType !== 'movie_hunt' && appType !== 'tv_hunt') return;
        const infoIcon = document.getElementById('modal-root-folder-info-icon');
        if (!infoIcon) return;
        infoIcon.style.display = '';
        const self = this;
        infoIcon.onclick = function(e) {
            e.preventDefault();
            const instanceSelect = document.getElementById('modal-instance-select');
            const compoundValue = (instanceSelect && instanceSelect.value) || instanceName || '';
            if (!compoundValue) return;
            const decoded = decodeInstanceValue(compoundValue, isTVShow ? 'sonarr' : 'radarr');
            try {
                sessionStorage.setItem('requestarr-goto-root-instance', JSON.stringify({
                    appType: decoded.appType || (isTVShow ? 'tv_hunt' : 'movie_hunt'),
                    instanceName: decoded.name || ''
                }));
            } catch (err) {}
            self.closeModal();
            if (window.location.hash !== '#settings-root-folders') {
                window.location.hash = '#settings-root-folders';
            } else {
                window.dispatchEvent(new HashChangeEvent('hashchange'));
            }
        };
    }

    /**
     * Disable Request button when no root folder is selected (user must pick a folder to request).
     */
    _updateRequestButtonFromRootFolder() {
        const requestBtn = document.getElementById('modal-request-btn');
        const rootSelect = document.getElementById('modal-root-folder');
        if (!requestBtn || !rootSelect) return;
        const noRootFolder = !rootSelect.value || rootSelect.value.trim() === '';
        const isCompleteOrInLibrary = requestBtn.textContent === 'Complete' || requestBtn.textContent === 'In Library' || requestBtn.textContent === 'Already in library';
        if (noRootFolder && !isCompleteOrInLibrary) {
            requestBtn.disabled = true;
            requestBtn.classList.add('disabled');
        } else if (!noRootFolder && (requestBtn.textContent === 'Request' || requestBtn.textContent === 'Add to Library')) {
            requestBtn.disabled = false;
            requestBtn.classList.remove('disabled');
        }
    }

    async loadSeriesStatus(instanceName) {
        if (!instanceName || !this.core.currentModalData) return;

        const container = document.getElementById('requestarr-modal-status-container');
        if (!container) return;

        container.innerHTML = '<span class="mh-req-badge mh-req-badge-loading"><i class="fas fa-spinner fa-spin"></i> Checking...</span>';

        const decoded = decodeInstanceValue(instanceName, 'sonarr');
        const isTVHunt = decoded.appType === 'tv_hunt';
        const addLabel = isTVHunt ? 'Add to Library' : 'Request';

        try {
            const response = await fetch(`./api/requestarr/series-status?tmdb_id=${this.core.currentModalData.tmdb_id}&instance=${encodeURIComponent(decoded.name)}&app_type=${encodeURIComponent(decoded.appType || 'sonarr')}`);
            const status = await response.json();
            const requestBtn = document.getElementById('modal-request-btn');

            if (status.exists) {
                const isComplete = status.missing_episodes === 0 && status.total_episodes > 0;
                // Sync discover card badge — show may have been added after the card rendered
                this._syncCardBadge(this.core.currentModalData.tmdb_id, isComplete, true);

                if (isComplete) {
                    container.innerHTML = `<span class="mh-req-badge mh-req-badge-lib"><i class="fas fa-check-circle"></i> Complete (${status.available_episodes}/${status.total_episodes} episodes)</span>`;
                    if (requestBtn) { requestBtn.disabled = true; requestBtn.classList.add('disabled'); requestBtn.textContent = 'Complete'; }
                    this._clearImportBanner();
                } else if (status.missing_episodes > 0) {
                    container.innerHTML = `<span class="mh-req-badge mh-req-badge-ok"><i class="fas fa-tv"></i> ${status.missing_episodes} missing episodes (${status.available_episodes}/${status.total_episodes})</span>`;
                    if (requestBtn) { requestBtn.disabled = false; requestBtn.classList.remove('disabled'); requestBtn.textContent = addLabel; }
                    this._updateRequestButtonFromRootFolder();
                    if (isTVHunt) this._checkForImport(instanceName);
                } else {
                    container.innerHTML = '<span class="mh-req-badge mh-req-badge-lib"><i class="fas fa-check-circle"></i> In Library</span>';
                    if (requestBtn) { requestBtn.disabled = true; requestBtn.classList.add('disabled'); requestBtn.textContent = 'In Library'; }
                    this._clearImportBanner();
                }
            } else {
                container.innerHTML = isTVHunt
                    ? '<span class="mh-req-badge mh-req-badge-ok"><i class="fas fa-check-circle"></i> Available to add</span>'
                    : '<span class="mh-req-badge mh-req-badge-ok"><i class="fas fa-check-circle"></i> Available to request</span>';
                if (requestBtn) { requestBtn.disabled = false; requestBtn.classList.remove('disabled'); requestBtn.textContent = addLabel; }
                this._updateRequestButtonFromRootFolder();
                // Check for importable files on disk for TV Hunt
                if (isTVHunt) this._checkForImport(instanceName);
            }
        } catch (error) {
            console.error('[RequestarrModal] Error loading series status:', error);
            container.innerHTML = isTVHunt
                ? '<span class="mh-req-badge mh-req-badge-ok"><i class="fas fa-check-circle"></i> Available to add</span>'
                : '<span class="mh-req-badge mh-req-badge-ok"><i class="fas fa-check-circle"></i> Available to request</span>';
        }
    }

    async loadMovieStatus(instanceName) {
        if (!instanceName || !this.core.currentModalData) return;

        const container = document.getElementById('requestarr-modal-status-container');
        if (!container) return;

        container.innerHTML = '<span class="mh-req-badge mh-req-badge-loading"><i class="fas fa-spinner fa-spin"></i> Checking...</span>';

        try {
            const decoded = decodeInstanceValue(instanceName);
            const isMovieHunt = decoded.appType === 'movie_hunt';
            const appTypeParam = isMovieHunt ? '&app_type=movie_hunt' : '';
            const response = await fetch(`./api/requestarr/movie-status?tmdb_id=${this.core.currentModalData.tmdb_id}&instance=${encodeURIComponent(decoded.name)}${appTypeParam}`);
            const status = await response.json();
            const requestBtn = document.getElementById('modal-request-btn');

            if (status.in_library) {
                container.innerHTML = '<span class="mh-req-badge mh-req-badge-lib"><i class="fas fa-check-circle"></i> Already in library</span>';
                if (requestBtn) { requestBtn.disabled = true; requestBtn.classList.add('disabled'); requestBtn.textContent = 'Already in library'; }
                this._syncCardBadge(this.core.currentModalData.tmdb_id, true);
                this._clearImportBanner();
            } else if (status.monitored) {
                // Movie is in the collection (monitored) but file not downloaded yet
                container.innerHTML = '<span class="mh-req-badge mh-req-badge-lib"><i class="fas fa-bookmark"></i> In library — downloading</span>';
                if (requestBtn) { requestBtn.disabled = true; requestBtn.classList.add('disabled'); requestBtn.textContent = 'In Library'; }
                this._syncCardBadge(this.core.currentModalData.tmdb_id, false, true);
                this._clearImportBanner();
            } else if (status.user_has_pending) {
                // THIS user already has a pending request
                container.innerHTML = '<span class="mh-req-badge mh-req-badge-warn"><i class="fas fa-clock"></i> Pending approval</span>';
                if (requestBtn) { requestBtn.disabled = true; requestBtn.classList.add('disabled'); requestBtn.textContent = 'Pending Approval'; }
                this._syncCardBadge(this.core.currentModalData.tmdb_id, false, false, true);
                if (isMovieHunt) this._checkForImport(instanceName);
            } else if (status.previously_requested) {
                container.innerHTML = '<span class="mh-req-badge mh-req-badge-warn"><i class="fas fa-bookmark"></i> Already requested</span>';
                if (requestBtn) { requestBtn.disabled = true; requestBtn.classList.add('disabled'); requestBtn.textContent = 'Already Requested'; }
                this._syncCardBadge(this.core.currentModalData.tmdb_id, false, true);
                // Still check for importable files even if previously requested
                if (isMovieHunt) this._checkForImport(instanceName);
            } else {
                container.innerHTML = isMovieHunt
                    ? '<span class="mh-req-badge mh-req-badge-ok"><i class="fas fa-check-circle"></i> Available to add</span>'
                    : '<span class="mh-req-badge mh-req-badge-ok"><i class="fas fa-check-circle"></i> Available to request</span>';
                if (requestBtn) {
                    requestBtn.disabled = false;
                    requestBtn.classList.remove('disabled');
                    requestBtn.textContent = isMovieHunt ? 'Add to Library' : 'Request';
                }
                this._updateRequestButtonFromRootFolder();
                // Check for importable files on disk
                if (isMovieHunt) this._checkForImport(instanceName);
            }
        } catch (error) {
            console.error('[RequestarrModal] Error loading movie status:', error);
            const isMovieHunt = instanceName && decodeInstanceValue(instanceName).appType === 'movie_hunt';
            container.innerHTML = isMovieHunt
                ? '<span class="mh-req-badge mh-req-badge-ok"><i class="fas fa-check-circle"></i> Available to add</span>'
                : '<span class="mh-req-badge mh-req-badge-ok"><i class="fas fa-check-circle"></i> Available to request</span>';
            const requestBtn = document.getElementById('modal-request-btn');
            if (requestBtn) {
                requestBtn.disabled = false;
                requestBtn.classList.remove('disabled');
                requestBtn.textContent = isMovieHunt ? 'Add to Library' : 'Request';
            }
        }
    }

    // ========================================
    // IMPORT DETECTION
    // ========================================

    _clearImportBanner() {
        const existing = document.getElementById('modal-import-banner');
        if (existing) existing.remove();
        const actionsArea = document.querySelector('.mh-req-actions');
        if (actionsArea) actionsArea.classList.remove('import-available');
    }

    async _checkForImport(instanceName) {
        this._clearImportBanner();
        if (!this.core.currentModalData) return;

        const isTVShow = this.core.currentModalData.media_type === 'tv';
        const decoded = decodeInstanceValue(instanceName, isTVShow ? 'sonarr' : 'radarr');
        const isMovieHunt = decoded.appType === 'movie_hunt';
        const isTVHunt = decoded.appType === 'tv_hunt';
        if (!isMovieHunt && !isTVHunt) return;

        const tmdbId = this.core.currentModalData.tmdb_id;
        if (!tmdbId) return;

        // Resolve numeric instance ID from core.instances (backend expects integer)
        const instKey = isTVHunt ? 'tv_hunt' : 'movie_hunt';
        const instList = (this.core.instances && this.core.instances[instKey]) || [];
        const instObj = instList.find(i => i.name === decoded.name);
        const numericId = instObj ? instObj.id : '';

        const apiBase = isMovieHunt ? './api/movie-hunt/import-check' : './api/tv-hunt/import-check';

        try {
            const resp = await fetch(`${apiBase}?tmdb_id=${tmdbId}&instance_id=${encodeURIComponent(numericId)}`);
            const data = await resp.json();
            if (!data.found || !data.matches || data.matches.length === 0) return;

            const best = data.matches[0];
            this._showImportBanner(best, instanceName);
        } catch (err) {
            console.warn('[RequestarrModal] Import check failed:', err);
        }
    }

    _showImportBanner(match, instanceName) {
        this._clearImportBanner();

        const score = match.score;
        const sizeGB = match.media_info ? (match.media_info.total_size / 1e9).toFixed(1) : '?';
        const fileCount = match.media_info ? match.media_info.file_count : 0;
        const mainFile = match.media_info ? match.media_info.main_file : '';

        // Confidence label
        let confidenceClass, confidenceLabel;
        if (score >= 85) { confidenceClass = 'high'; confidenceLabel = 'High'; }
        else if (score >= 65) { confidenceClass = 'medium'; confidenceLabel = 'Medium'; }
        else { confidenceClass = 'low'; confidenceLabel = 'Low'; }

        // Swap status badge to amber warning
        const container = document.getElementById('requestarr-modal-status-container');
        if (container) {
            container.innerHTML = '<span class="mh-req-badge mh-req-badge-import"><i class="fas fa-exclamation-triangle"></i> Found on Disk</span>';
        }

        // Read current form selections for the settings summary
        const instanceSelect = document.getElementById('modal-instance-select');
        const rootSelect = document.getElementById('modal-root-folder');
        const qualitySelect = document.getElementById('modal-quality-profile');
        const instLabel = instanceSelect ? instanceSelect.options[instanceSelect.selectedIndex]?.text : '';
        const rootLabel = rootSelect ? rootSelect.value : '';
        const qualLabel = qualitySelect ? qualitySelect.options[qualitySelect.selectedIndex]?.text : '';

        const banner = document.createElement('div');
        banner.id = 'modal-import-banner';
        banner.className = 'modal-import-banner';
        banner.innerHTML =
            '<div class="import-banner-header">' +
                '<i class="fas fa-folder-open"></i>' +
                '<span>Existing files detected on disk</span>' +
                '<span class="import-confidence import-confidence-' + confidenceClass + '">' + score + '% ' + confidenceLabel + '</span>' +
            '</div>' +
            '<div class="import-banner-details">' +
                '<div class="import-banner-folder" title="' + this._escBannerAttr(match.folder_path) + '">' +
                    '<i class="fas fa-folder"></i> ' + this._escBannerHtml(match.folder_name) +
                '</div>' +
                '<div class="import-banner-meta">' +
                    (mainFile ? '<span title="' + this._escBannerAttr(mainFile) + '"><i class="fas fa-film"></i> ' + this._escBannerHtml(mainFile) + '</span>' : '') +
                    '<span><i class="fas fa-hdd"></i> ' + sizeGB + ' GB</span>' +
                    (fileCount > 1 ? '<span><i class="fas fa-copy"></i> ' + fileCount + ' files</span>' : '') +
                '</div>' +
            '</div>' +
            '<div class="import-banner-settings">' +
                (instLabel ? '<span><i class="fas fa-server"></i>' + this._escBannerHtml(instLabel) + '</span>' : '') +
                (rootLabel ? '<span><i class="fas fa-folder-open"></i>' + this._escBannerHtml(rootLabel) + '</span>' : '') +
                (qualLabel ? '<span><i class="fas fa-sliders-h"></i>' + this._escBannerHtml(qualLabel) + '</span>' : '') +
            '</div>' +
            '<button class="import-banner-btn" id="modal-import-instead-btn">' +
                '<i class="fas fa-download"></i> Import to Library' +
            '</button>';

        // Insert before the action buttons area
        const actionsArea = document.querySelector('.mh-req-actions');
        if (actionsArea) {
            actionsArea.parentNode.insertBefore(banner, actionsArea);
            actionsArea.classList.add('import-available');
        } else {
            // Fallback: insert at end of form column
            const formCol = document.querySelector('.mh-req-form');
            if (formCol) formCol.appendChild(banner);
        }

        // Wire up import button
        const importBtn = document.getElementById('modal-import-instead-btn');
        if (importBtn) {
            importBtn.onclick = () => this._doImportInstead(match, instanceName);
        }

        // Demote the Add to Library button to secondary
        const requestBtn = document.getElementById('modal-request-btn');
        if (requestBtn && !requestBtn.disabled) {
            requestBtn.textContent = 'Add as New';
        }

        // Update modal label to reflect import context
        const labelEl = document.getElementById('requestarr-modal-label');
        if (labelEl) labelEl.textContent = 'Import to Library';
    }

    async _doImportInstead(match, instanceName) {
        const importBtn = document.getElementById('modal-import-instead-btn');
        if (importBtn) {
            importBtn.disabled = true;
            importBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Importing...';
        }

        try {
            const data = this.core.currentModalData;
            const isTVShow = data.media_type === 'tv';
            const decoded = decodeInstanceValue(instanceName, isTVShow ? 'sonarr' : 'radarr');
            const isTVHunt = decoded.appType === 'tv_hunt';
            const confirmUrl = isTVHunt ? './api/tv-hunt/import-media/confirm' : './api/movie-hunt/import-media/confirm';

            // Read current form selections so import uses the same settings
            const rootSelect = document.getElementById('modal-root-folder');
            const qualitySelect = document.getElementById('modal-quality-profile');
            const monitorSelect = document.getElementById('modal-monitor');
            const rootFolder = (rootSelect && rootSelect.value) ? rootSelect.value : (match.root_folder || '');
            const qualityProfile = qualitySelect ? qualitySelect.value : '';
            const monitor = monitorSelect ? monitorSelect.value : '';

            const body = {
                folder_path: match.folder_path,
                tmdb_id: data.tmdb_id,
                title: data.title || data.name || '',
                year: String(data.year || ''),
                poster_path: data.poster_path || '',
                root_folder: rootFolder,
                instance_id: decoded.name,
                quality_profile: qualityProfile,
                monitor: monitor,
            };
            // TV confirm expects 'name' field
            if (isTVHunt) {
                body.name = data.title || data.name || '';
                body.first_air_date = data.first_air_date || '';
            }

            const resp = await fetch(confirmUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const result = await resp.json();

            if (result.success) {
                if (importBtn) {
                    importBtn.innerHTML = '<i class="fas fa-check"></i> Imported';
                    importBtn.classList.add('success');
                }
                this.core.showNotification(result.message || 'Imported successfully', 'success');

                // Update status badge and card
                const container = document.getElementById('requestarr-modal-status-container');
                if (container) {
                    container.innerHTML = '<span class="mh-req-badge mh-req-badge-lib"><i class="fas fa-check-circle"></i> Already in library</span>';
                }
                const requestBtn = document.getElementById('modal-request-btn');
                if (requestBtn) {
                    requestBtn.disabled = true;
                    requestBtn.classList.add('disabled');
                    requestBtn.textContent = 'Already in library';
                }
                this._syncCardBadge(data.tmdb_id, true);

                // Notify detail page
                window.dispatchEvent(new CustomEvent('requestarr-request-success', {
                    detail: { tmdbId: data.tmdb_id, mediaType: isTVHunt ? 'tv' : 'movie', appType: decoded.appType, instanceName: decoded.name }
                }));

                setTimeout(() => this.closeModal(), 2000);
            } else {
                if (importBtn) {
                    importBtn.disabled = false;
                    importBtn.innerHTML = '<i class="fas fa-download"></i> Import Instead';
                }
                this.core.showNotification(result.message || 'Import failed', 'error');
            }
        } catch (err) {
            console.error('[RequestarrModal] Import error:', err);
            if (importBtn) {
                importBtn.disabled = false;
                importBtn.innerHTML = '<i class="fas fa-download"></i> Import Instead';
            }
            this.core.showNotification('Import failed: ' + (err.message || 'Unknown error'), 'error');
        }
    }

    _escBannerHtml(s) {
        if (!s) return '';
        const d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    }

    _escBannerAttr(s) {
        if (!s) return '';
        return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    /**
     * When selected instance is Movie Hunt or TV Hunt, show "Add to Library" and
     * the Start search checkbox + relevant fields. Otherwise "Request Movie" / "Request".
     */
    _applyMovieHuntModalMode(instanceValue, isTVShow, labelEl, requestBtn) {
        const wrapMin = document.getElementById('requestarr-modal-min-availability-wrap');
        const wrapStart = document.getElementById('requestarr-modal-start-search-wrap');
        const wrapMonitor = document.getElementById('requestarr-modal-monitor-wrap');
        const wrapMovieMonitor = document.getElementById('requestarr-modal-movie-monitor-wrap');
        const minSelect = document.getElementById('modal-minimum-availability');
        const startCb = document.getElementById('modal-start-search');
        const startLabel = wrapStart ? wrapStart.querySelector('span') : null;
        const decoded = instanceValue ? decodeInstanceValue(instanceValue, isTVShow ? 'sonarr' : 'radarr') : {};
        const isMovieHunt = !isTVShow && decoded.appType === 'movie_hunt';
        const isTVHunt = isTVShow && decoded.appType === 'tv_hunt';
        const isHuntInstance = isMovieHunt || isTVHunt;
        // Use class toggle — .mh-req-field has display:grid!important which overrides inline styles
        if (wrapMin) wrapMin.classList.toggle('mh-hidden', !isMovieHunt);
        if (wrapStart) wrapStart.classList.toggle('mh-hidden', !isHuntInstance);
        if (wrapMonitor) wrapMonitor.classList.toggle('mh-hidden', !isTVHunt);
        if (wrapMovieMonitor) wrapMovieMonitor.classList.toggle('mh-hidden', !isMovieHunt);
        
        // Update search label text for context
        if (startLabel) startLabel.textContent = isTVHunt ? 'Start search for missing episodes' : 'Start search for missing movie';
        
        // Use loaded preferences or defaults
        if (minSelect) minSelect.value = this.preferences?.minimum_availability || 'released';
        if (startCb) startCb.checked = this.preferences?.hasOwnProperty('start_search') ? this.preferences.start_search : true;
        
        if (labelEl) labelEl.textContent = isHuntInstance ? 'Add to Library' : (isTVShow ? 'Request Series' : 'Request Movie');
        if (requestBtn && !requestBtn.disabled) requestBtn.textContent = isHuntInstance ? 'Add to Library' : 'Request';
    }

    instanceChanged(instanceName) {
        this._clearImportBanner();
        const isTVShow = this.core.currentModalData.media_type === 'tv';

        // Save to server modal preferences
        if (isTVShow) {
            this.saveModalPreferences({ tv_instance: instanceName });
        } else {
            this.saveModalPreferences({ movie_instance: instanceName });
        }
        console.log('[RequestarrModal] Instance changed to:', instanceName);

        const labelEl = document.getElementById('requestarr-modal-label');
        const requestBtn = document.getElementById('modal-request-btn');
        this._applyMovieHuntModalMode(instanceName, isTVShow, labelEl, requestBtn);

        // Reload root folders
        this.loadModalRootFolders(instanceName, isTVShow);

        // Update quality profile dropdown
        const qualitySelect = document.getElementById('modal-quality-profile');
        if (qualitySelect) {
            const decoded = decodeInstanceValue(instanceName, isTVShow ? 'sonarr' : 'radarr');
            const profileKey = `${decoded.appType}-${decoded.name}`;
            const useHuntProfiles = decoded.appType === 'movie_hunt' || decoded.appType === 'tv_hunt';
            const profiles = this.core.qualityProfiles[profileKey] || [];

            if (profiles.length === 0 && instanceName) {
                qualitySelect.innerHTML = '<option value="">Loading profiles...</option>';
                this.core.loadQualityProfilesForInstance(decoded.appType, decoded.name).then(newProfiles => {
                    if (newProfiles && newProfiles.length > 0) {
                        this._populateQualityProfiles(qualitySelect, newProfiles, useHuntProfiles);
                    } else {
                        this._populateQualityProfiles(qualitySelect, [], useHuntProfiles);
                    }
                });
            } else {
                this._populateQualityProfiles(qualitySelect, profiles, useHuntProfiles);
            }
        }

        // Reload status
        if (isTVShow) {
            this.loadSeriesStatus(instanceName);
        } else {
            this.loadMovieStatus(instanceName);
        }
    }

    /**
     * Populate a quality profile dropdown, handling Movie Hunt vs Radarr/Sonarr differences.
     * Movie Hunt: no "Any" placeholder, pre-select the default profile.
     * Radarr/Sonarr: show "Any (Default)" as first option, no pre-selection.
     */
    _populateQualityProfiles(selectEl, profiles, isMovieHunt) {
        selectEl.innerHTML = '';
        
        if (isMovieHunt) {
            // Movie Hunt: list only real profiles, pre-select the default
            if (profiles.length === 0) {
                selectEl.innerHTML = '<option value="">No profiles configured</option>';
                return;
            }
            let defaultIdx = profiles.findIndex(p => p.is_default);
            if (defaultIdx === -1) defaultIdx = 0; // fallback to first
            
            profiles.forEach((profile, idx) => {
                const opt = document.createElement('option');
                opt.value = profile.id;
                opt.textContent = profile.name;
                if (idx === defaultIdx) opt.selected = true;
                selectEl.appendChild(opt);
            });
        } else {
            // Radarr / Sonarr: "Any (Default)" placeholder, then real profiles
            selectEl.innerHTML = '<option value="">Any (Default)</option>';
            profiles.forEach(profile => {
                if (profile.name.toLowerCase() !== 'any') {
                    const opt = document.createElement('option');
                    opt.value = profile.id;
                    opt.textContent = profile.name;
                    selectEl.appendChild(opt);
                }
            });
        }
    }

    async submitRequest() {
            const isOwner = window._huntarrUserRole === 'owner';
            const perms = window._huntarrUserPermissions || {};
            const requestBtn = document.getElementById('modal-request-btn');
            const instanceSelect = document.getElementById('modal-instance-select');

            if (!this.core.currentModalData) {
                this.core.showNotification('No media data available', 'error');
                return;
            }

            const isTVShow = this.core.currentModalData.media_type === 'tv';

            // Both owner and non-owner read instance from the dropdown (non-owner has it greyed out)
            if (!instanceSelect || !instanceSelect.value) {
                this.core.showNotification('No instance available for this request', 'error');
                return;
            }

            try {
                const decoded = decodeInstanceValue(instanceSelect.value, isTVShow ? 'sonarr' : 'radarr');
                const instanceName = decoded.name;
                const appType = decoded.appType;
                const isHuntApp = appType === 'movie_hunt' || appType === 'tv_hunt';

                // Determine if this user has auto-approve (owners always do)
                const hasAutoApprove = isOwner || (isTVShow
                    ? (perms.auto_approve || perms.auto_approve_tv)
                    : (perms.auto_approve || perms.auto_approve_movies));

                if (requestBtn) {
                    requestBtn.disabled = true;
                    requestBtn.classList.add('pressed');
                    requestBtn.textContent = hasAutoApprove
                        ? (isHuntApp ? 'Adding...' : 'Requesting...')
                        : 'Submitting...';
                }

                // ── Non-auto-approve path: only create a pending request record ──
                if (!hasAutoApprove) {
                    const trackResp = await fetch('./api/requestarr/requests', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            media_type: isTVShow ? 'tv' : 'movie',
                            tmdb_id: this.core.currentModalData.tmdb_id,
                            title: this.core.currentModalData.title || '',
                            year: String(this.core.currentModalData.year || ''),
                            poster_path: this.core.currentModalData.poster_path || '',
                            instance_name: instanceName,
                            app_type: appType,
                        })
                    });
                    const trackResult = await trackResp.json();

                    if (trackResp.ok && (trackResult.success || trackResult.request)) {
                        if (requestBtn) {
                            requestBtn.textContent = 'Submitted \u2713';
                            requestBtn.classList.add('success');
                        }
                        this.core.showNotification('Request submitted — awaiting owner approval.', 'success');

                        const tmdbId = this.core.currentModalData.tmdb_id;
                        const mediaType = this.core.currentModalData.media_type;
                        this._syncCardBadge(tmdbId, false, false, true);
                        window.dispatchEvent(new CustomEvent('requestarr-request-success', {
                            detail: { tmdbId, mediaType, appType, instanceName }
                        }));
                        if (window.huntarrUI && typeof window.huntarrUI._updatePendingRequestBadge === 'function') {
                            window.huntarrUI._updatePendingRequestBadge();
                        }
                        setTimeout(() => this.closeModal(), 2000);
                    } else {
                        const errorMsg = trackResult.error || trackResult.message || 'Failed to submit request';
                        this.core.showNotification(errorMsg, 'error');
                        if (requestBtn) {
                            requestBtn.disabled = false;
                            requestBtn.classList.remove('success', 'pressed');
                            requestBtn.textContent = 'Request';
                        }
                    }
                    return;
                }

                // ── Auto-approve / owner path: trigger the search pipeline ──
                const requestData = {
                    tmdb_id: this.core.currentModalData.tmdb_id,
                    media_type: this.core.currentModalData.media_type,
                    title: this.core.currentModalData.title,
                    year: this.core.currentModalData.year,
                    overview: this.core.currentModalData.overview || '',
                    poster_path: this.core.currentModalData.poster_path || '',
                    backdrop_path: this.core.currentModalData.backdrop_path || '',
                    instance: instanceName,
                    app_type: appType,
                };

                if (isOwner) {
                    // Owner sends full form data
                    const qualityProfileEl = document.getElementById('modal-quality-profile');
                    const rootFolderSelect = document.getElementById('modal-root-folder');
                    requestData.root_folder_path = (rootFolderSelect && rootFolderSelect.value) ? rootFolderSelect.value : undefined;
                    requestData.quality_profile = qualityProfileEl ? qualityProfileEl.value : '';
                    if (appType === 'movie_hunt') {
                        const startCb = document.getElementById('modal-start-search');
                        const minSelect = document.getElementById('modal-minimum-availability');
                        const movieMonitorSelect = document.getElementById('modal-movie-monitor');
                        requestData.start_search = startCb ? startCb.checked : true;
                        requestData.minimum_availability = (minSelect && minSelect.value) ? minSelect.value : 'released';
                        requestData.movie_monitor = (movieMonitorSelect && movieMonitorSelect.value) ? movieMonitorSelect.value : 'movie_only';
                    }
                    if (appType === 'tv_hunt') {
                        const monitorSelect = document.getElementById('modal-monitor');
                        const startCbTV = document.getElementById('modal-start-search');
                        requestData.monitor = (monitorSelect && monitorSelect.value) ? monitorSelect.value : 'all_episodes';
                        requestData.start_search = startCbTV ? startCbTV.checked : true;
                    }
                } else {
                    // Non-owner with auto-approve: sensible defaults
                    if (appType === 'movie_hunt') {
                        requestData.start_search = true;
                        requestData.minimum_availability = 'released';
                        requestData.movie_monitor = 'movie_only';
                    } else if (appType === 'tv_hunt') {
                        requestData.start_search = true;
                        requestData.monitor = 'all_episodes';
                    }
                }

                const response = await fetch('./api/requestarr/request', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(requestData)
                });

                const result = await response.json();

                if (result.success) {
                    if (requestBtn) {
                        requestBtn.textContent = isHuntApp ? 'Added \u2713' : 'Requested \u2713';
                        requestBtn.classList.add('success');
                    }

                    const successMsg = result.message || (isHuntApp ? 'Successfully added to library.' : `${isTVShow ? 'Series' : 'Movie'} requested successfully!`);
                    this.core.showNotification(successMsg, 'success');

                    // Create a request tracking record
                    try {
                        await fetch('./api/requestarr/requests', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                media_type: isTVShow ? 'tv' : 'movie',
                                tmdb_id: this.core.currentModalData.tmdb_id,
                                title: this.core.currentModalData.title || '',
                                year: String(this.core.currentModalData.year || ''),
                                poster_path: this.core.currentModalData.poster_path || '',
                                instance_name: instanceName,
                                app_type: appType,
                            })
                        });
                    } catch (trackErr) {
                        console.debug('[RequestarrModal] Request tracking record skipped:', trackErr);
                    }

                    const tmdbId = this.core.currentModalData.tmdb_id;
                    const mediaType = this.core.currentModalData.media_type;
                    this._syncCardBadge(tmdbId, false, true);

                    window.dispatchEvent(new CustomEvent('requestarr-request-success', {
                        detail: { tmdbId, mediaType, appType, instanceName }
                    }));

                    if (window.huntarrUI && typeof window.huntarrUI._updatePendingRequestBadge === 'function') {
                        window.huntarrUI._updatePendingRequestBadge();
                    }

                    setTimeout(() => { this._refreshCardStatusFromAPI(tmdbId); }, 3000);
                    setTimeout(() => { this._refreshCardStatusFromAPI(tmdbId); }, 8000);
                    setTimeout(() => this.closeModal(), 2000);
                } else {
                    const errorMsg = result.message || result.error || 'Request failed';
                    this.core.showNotification(errorMsg, 'error');
                    if (requestBtn) {
                        requestBtn.disabled = false;
                        requestBtn.classList.remove('success');
                        requestBtn.textContent = isHuntApp ? 'Add to Library' : 'Request';
                    }
                }
            } catch (error) {
                console.error('[RequestarrModal] Error submitting request:', error);
                this.core.showNotification(error.message || 'Request failed', 'error');
                if (requestBtn) {
                    requestBtn.disabled = false;
                    requestBtn.classList.remove('success');
                    requestBtn.textContent = 'Request';
                }
            }
        }

    /**
     * Sync Discover card badges to match the real status.
     * Called when the modal detects "Already in library", "Previously requested",
     * or after a successful request.
     *
     * @param {number|string} tmdbId
     * @param {boolean} inLibrary  - Movie is downloaded / fully available
     * @param {boolean} requested  - Movie is requested but not yet downloaded
     * @param {boolean} pending    - Request is pending approval (non-auto-approve user)
     */
    _syncCardBadge(tmdbId, inLibrary, requested, pending) {
        const cards = document.querySelectorAll(`.media-card[data-tmdb-id="${tmdbId}"]`);
        cards.forEach((card) => {
            const badge = card.querySelector('.media-card-status-badge');
            if (badge) {
                if (inLibrary) {
                    badge.className = 'media-card-status-badge complete';
                    badge.innerHTML = '<i class="fas fa-check"></i>';
                    card.classList.add('in-library');
                } else if (pending) {
                    badge.className = 'media-card-status-badge pending';
                    badge.innerHTML = '<i class="fas fa-clock"></i>';
                    // Do NOT add in-library class — pending is not in collection
                } else if (requested) {
                    badge.className = 'media-card-status-badge partial';
                    badge.innerHTML = '<i class="fas fa-bookmark"></i>';
                    card.classList.add('in-library');
                }
            }
            // If now in collection (either state), swap eye-slash → trash
            if (inLibrary || requested) {
                const hideBtn = card.querySelector('.media-card-hide-btn');
                if (hideBtn) {
                    hideBtn.className = 'media-card-delete-btn';
                    hideBtn.title = 'Remove / Delete';
                    hideBtn.innerHTML = '<i class="fas fa-trash-alt"></i>';
                }
                const requestBtn = card.querySelector('.media-card-request-btn');
                if (requestBtn) requestBtn.remove();
            }
        });
    }

    /**
     * After a delay, re-check the actual library status from the API and sync card badges.
     * Uses the currently selected instance so the backend knows which collection to check.
     */
    async _refreshCardStatusFromAPI(tmdbId) {
        try {
            const instanceSelect = document.getElementById('modal-instance-select');
            const instanceValue = instanceSelect ? instanceSelect.value : '';
            if (!instanceValue) return;

            const decoded = decodeInstanceValue(instanceValue);
            const appTypeParam = decoded.appType === 'movie_hunt' ? '&app_type=movie_hunt' : '';
            const resp = await fetch(`./api/requestarr/movie-status?tmdb_id=${tmdbId}&instance=${encodeURIComponent(decoded.name)}${appTypeParam}`);
            const data = await resp.json();

            this._syncCardBadge(tmdbId, data.in_library || false, data.previously_requested || data.monitored || false);
        } catch (err) {
            console.warn('[RequestarrModal] Failed to refresh card status from API:', err);
        }
    }

    closeModal() {
            const modal = document.getElementById('media-modal');
            if (modal) modal.style.display = 'none';
            this.core.currentModalData = null;
            this._clearImportBanner();
            // Reset fields visibility and instance select state for next open
            const fieldsContainer = document.querySelector('.mh-req-fields');
            if (fieldsContainer) fieldsContainer.style.display = '';
            const rootField = document.getElementById('modal-root-folder');
            const qualityField = document.getElementById('modal-quality-profile');
            if (rootField && rootField.closest('.mh-req-field')) rootField.closest('.mh-req-field').classList.remove('mh-hidden');
            if (qualityField && qualityField.closest('.mh-req-field')) qualityField.closest('.mh-req-field').classList.remove('mh-hidden');
            const instanceSelect = document.getElementById('modal-instance-select');
            if (instanceSelect) {
                instanceSelect.disabled = false;
                instanceSelect.style.opacity = '';
            }
            // Remove permissions row added by non-owner modal
            const permRow = document.getElementById('requestarr-modal-permissions-row');
            if (permRow) permRow.remove();
            // Reset actions margin
            const actionsArea = document.querySelector('.mh-req-actions');
            if (actionsArea) actionsArea.style.marginTop = '';
            document.body.classList.remove('requestarr-modal-open');
        }
}


/* === modules/features/requestarr/requestarr-core.js === */
/**
 * Requestarr Core - Main class, initialization, and view management
 */


/**
 * Encode a compound instance value: "appType:instanceName"
 */
function encodeInstanceValue(appType, name) {
    return `${appType}:${name}`;
}

/**
 * Decode a compound instance value back to { appType, name }.
 * Backward compat: values without ':' use defaultAppType (radarr for movies, sonarr for TV).
 */
function decodeInstanceValue(value, defaultAppType = 'radarr') {
    if (!value) return { appType: defaultAppType, name: '' };
    const idx = value.indexOf(':');
    if (idx === -1) return { appType: defaultAppType, name: value };
    return { appType: value.substring(0, idx), name: value.substring(idx + 1) };
}

class RequestarrDiscover {
    constructor() {
        this.currentView = 'discover';
        this.instances = { sonarr: [], radarr: [], movie_hunt: [], tv_hunt: [] };
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
        this.search.setupGlobalSearch();
        this.content.loadDiscoverContent();
    }

    async loadInstances() {
        try {
            const _ts = Date.now();
            const response = await fetch(`./api/requestarr/instances?t=${_ts}`, { cache: 'no-store' });
            const data = await response.json();
            
            if (data.sonarr || data.radarr || data.movie_hunt || data.tv_hunt) {
                this.instances = {
                    sonarr: data.sonarr || [],
                    radarr: data.radarr || [],
                    movie_hunt: data.movie_hunt || [],
                    tv_hunt: data.tv_hunt || []
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
            await this.loadQualityProfilesForInstance('radarr', instance.name);
        }
        
        // Load Sonarr quality profiles
        for (const instance of this.instances.sonarr) {
            await this.loadQualityProfilesForInstance('sonarr', instance.name);
        }
        
        // Load Movie Hunt quality profiles
        for (const instance of this.instances.movie_hunt) {
            await this.loadQualityProfilesForInstance('movie_hunt', instance.name);
        }
        
        // Load TV Hunt quality profiles
        for (const instance of this.instances.tv_hunt) {
            await this.loadQualityProfilesForInstance('tv_hunt', instance.name);
        }
    }

    async loadQualityProfilesForInstance(appType, instanceName) {
        try {
            const response = await fetch(`./api/requestarr/quality-profiles/${appType}/${encodeURIComponent(instanceName)}`);
            const data = await response.json();
            if (data.success) {
                this.qualityProfiles[`${appType}-${instanceName}`] = data.profiles;
                return data.profiles;
            }
        } catch (error) {
            console.error(`[RequestarrDiscover] Error loading quality profiles for ${appType}/${instanceName}:`, error);
        }
        return [];
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
            if (view === 'hidden' || view === 'settings' || view === 'smarthunt-settings' || view === 'users' || view === 'bundles' || view === 'requests' || view === 'global-blacklist') {
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
        
        // Hide all view headers, show the one for current view (settings/smarthunt have their own toolbar)
        document.querySelectorAll('.requestarr-view-header').forEach(el => {
            el.style.display = 'none';
        });
        // Hide the entire header bar when settings/smarthunt-settings have their own toolbar
        const headerBar = document.querySelector('.requestarr-header-bar');
        const contentEl = document.querySelector('.requestarr-content');
        if (view === 'settings' || view === 'smarthunt-settings') {
            if (headerBar) headerBar.style.display = 'none';
            // Allow dropdowns to overflow outside cards in settings view
            if (contentEl) contentEl.classList.add('settings-active');
        } else {
            // Non-owner users never see the header bar
            var isNonOwner = document.body.classList.contains('non-owner-mode');
            if (headerBar) headerBar.style.display = isNonOwner ? 'none' : '';
            if (contentEl) contentEl.classList.remove('settings-active');
            const headerEl = document.getElementById(`requestarr-header-${view}`);
            if (headerEl && !isNonOwner) {
                headerEl.style.display = '';
            }
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

        // Load content for view — always refresh on navigate to avoid stale cache
        switch (view) {
            case 'discover':
                this.content.loadDiscoverContent();
                break;
            case 'movies':
                // Always ensure instance selectors are populated before loading.
                // setupInstanceSelectors → loadMovieInstances short-circuits if already populated.
                this.content.setupInstanceSelectors().then(() => {
                    this.content.moviesPage = 1;
                    this.content.moviesHasMore = true;
                    this.content.loadMovies();
                    this.content.setupMoviesInfiniteScroll();
                });
                break;
            case 'tv':
                // Always ensure instance selectors are populated before loading.
                this.content.setupInstanceSelectors().then(() => {
                    this.content.tvPage = 1;
                    this.content.tvHasMore = true;
                    this.content.loadTV();
                    this.content.setupTVInfiniteScroll();
                });
                break;
            case 'hidden':
                this.settings.loadHiddenMedia();
                break;
            case 'settings':
                this.settings.loadSettings();
                break;
            case 'smarthunt-settings':
                this.settings.loadSmartHuntSettings();
                break;
            case 'users':
                if (window.RequestarrUsers && typeof window.RequestarrUsers.init === 'function') {
                    window.RequestarrUsers.init();
                }
                break;
            case 'bundles':
                if (window.RequestarrServices && typeof window.RequestarrServices.init === 'function') {
                    window.RequestarrServices.init();
                }
                break;
            case 'requests':
                if (window.RequestarrRequests && typeof window.RequestarrRequests.init === 'function') {
                    window.RequestarrRequests.init();
                }
                break;
            case 'global-blacklist':
                if (window.RequestarrRequests && typeof window.RequestarrRequests.initGlobalBlacklist === 'function') {
                    window.RequestarrRequests.initGlobalBlacklist();
                }
                break;
        }
    }

    setupCarouselArrows() {
        const arrows = document.querySelectorAll('.carousel-arrow');
        const carousels = new Set();
        /** Per-carousel: once user has scrolled right, left arrow stays visible (so they know they can scroll back). */
        const hasScrolledRight = {};
        
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
                const atStart = scrollLeft <= 5;
                const atEnd = maxScroll > 5 && scrollLeft >= maxScroll - 5;
                
                // Once user scrolls right, left arrow stays visible so they know they can scroll back
                if (!atStart) {
                    hasScrolledRight[carouselId] = true;
                }
                
                // Left arrow: hidden at start until user scrolls right; then always visible
                if (atStart && !hasScrolledRight[carouselId]) {
                    leftArrow.style.opacity = '0';
                    leftArrow.style.pointerEvents = 'none';
                } else {
                    leftArrow.style.opacity = '0.8';
                    leftArrow.style.pointerEvents = 'auto';
                }
                
                // Right arrow: always visible when there's more content (or content still loading); hide only at end
                if (atEnd) {
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
            // When carousel content loads (e.g. async), update arrows so right arrow becomes visible
            const observer = new MutationObserver(() => {
                updateArrowVisibility();
            });
            observer.observe(carousel, { childList: true, subtree: true });
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


/* === modules/features/requestarr/requestarr-smarthunt.js === */
/**
 * Smart Hunt — shared carousel component used on Home and Discover pages.
 *
 * Caching is handled entirely server-side (in-memory with configurable TTL).
 * No localStorage caching — every load hits the server API, which returns
 * cached or fresh results based on the user's cache_ttl_minutes setting.
 *
 * Usage:
 *   import { SmartHunt } from './requestarr-smarthunt.js';
 *   const sh = new SmartHunt({ carouselId: 'home-smarthunt-carousel', core: coreRef });
 *   sh.load();
 */

/**
 * @deprecated No-op — localStorage cache has been removed. Server-side only.
 * Kept so existing callers (settings save) don't throw.
 */
function invalidateSmartHuntCache() {
    // Clean up any legacy localStorage entries from before this change
    try {
        const prefix = 'huntarr-smarthunt-page-';
        for (let i = 1; i <= 5; i++) {
            localStorage.removeItem(`${prefix}${i}`);
        }
    } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------------------
// SmartHunt class
// ---------------------------------------------------------------------------

class SmartHunt {
    /**
     * @param {Object} opts
     * @param {string} opts.carouselId — DOM id of the .media-carousel container
     * @param {Object} opts.core       — RequestarrDiscover core reference (has .content.createMediaCard)
     * @param {Function} [opts.getMovieInstance] — returns compound movie instance value
     * @param {Function} [opts.getTVInstance]    — returns TV instance value
     */
    constructor(opts) {
        this.carouselId = opts.carouselId;
        this.core = opts.core || null;
        this.getMovieInstance = opts.getMovieInstance || (() => '');
        this.getTVInstance = opts.getTVInstance || (() => '');

        this.currentPage = 0;
        this.hasMore = true;
        this.isLoading = false;
        this._scrollHandler = null;
    }

    // ------------------------------------------------------------------
    // Public API
    // ------------------------------------------------------------------

    /** Load the first page and attach infinite-scroll. */
    load() {
        this.currentPage = 0;
        this.hasMore = true;
        const carousel = document.getElementById(this.carouselId);
        if (carousel) {
            carousel.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Loading Smart Hunt...</p></div>';
        }
        this._loadNextPage(false);
        this._attachInfiniteScroll();
    }

    /** Reload from scratch (e.g. after instance change). */
    reload() {
        this.load();
    }

    /** Tear down scroll listener. */
    destroy() {
        if (this._scrollHandler) {
            const carousel = document.getElementById(this.carouselId);
            if (carousel) carousel.removeEventListener('scroll', this._scrollHandler);
            this._scrollHandler = null;
        }
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    async _loadNextPage(append) {
        if (this.isLoading || !this.hasMore) return;
        this.isLoading = true;

        const page = this.currentPage + 1;

        try {
            const results = await this._fetchPage(page);
            this._render(results, append);
            this.currentPage = page;
            this.hasMore = page < 5 && results.length > 0;
        } catch (err) {
            console.error('[SmartHunt] Error loading page', page, err);
            if (!append) {
                const carousel = document.getElementById(this.carouselId);
                if (carousel) {
                    carousel.innerHTML = '<p style="color: #ef4444; text-align: center; width: 100%; padding: 40px;">Failed to load Smart Hunt results</p>';
                }
            }
        } finally {
            this.isLoading = false;
        }
    }

    async _fetchPage(page) {
        const movieInst = this.getMovieInstance();
        const tvInst = this.getTVInstance();

        let movieAppType = '';
        let movieName = '';
        if (movieInst && movieInst.includes(':')) {
            const idx = movieInst.indexOf(':');
            movieAppType = movieInst.substring(0, idx);
            movieName = movieInst.substring(idx + 1);
        } else {
            movieAppType = 'radarr';
            movieName = movieInst || '';
        }

        let tvAppType = '';
        let tvName = '';
        if (tvInst && tvInst.includes(':')) {
            const idx = tvInst.indexOf(':');
            tvAppType = tvInst.substring(0, idx);
            tvName = tvInst.substring(idx + 1);
        } else {
            tvAppType = 'sonarr';
            tvName = tvInst || '';
        }

        const params = new URLSearchParams({
            page: String(page),
            movie_app_type: movieAppType,
            movie_instance_name: movieName,
            tv_app_type: tvAppType,
            tv_instance_name: tvName,
        });

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);
        try {
            const resp = await fetch(`./api/requestarr/smarthunt?${params.toString()}`, {
                signal: controller.signal,
            });
            clearTimeout(timeoutId);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            if (data.error) throw new Error(data.error);
            return data.results || [];
        } catch (err) {
            clearTimeout(timeoutId);
            if (err.name === 'AbortError') throw new Error('Request timed out');
            throw err;
        }
    }

    _render(results, append) {
        const carousel = document.getElementById(this.carouselId);
        if (!carousel) return;

        if (!append) {
            carousel.innerHTML = '';
        }

        if (results.length === 0 && !append) {
            carousel.innerHTML = '<p style="color: #888; text-align: center; width: 100%; padding: 40px;">No Smart Hunt results available</p>';
            return;
        }

        results.forEach(item => {
            const suggestedInstance = item.media_type === 'movie'
                ? this.getMovieInstance()
                : this.getTVInstance();
            const card = this._createCard(item, suggestedInstance);
            if (card) carousel.appendChild(card);
        });
    }

    _createCard(item, suggestedInstance) {
        // Use the Requestarr core module's createMediaCard if available
        if (this.core && this.core.content && typeof this.core.content.createMediaCard === 'function') {
            return this.core.content.createMediaCard(item, suggestedInstance);
        }
        // Fallback: try global window.RequestarrDiscover
        if (window.RequestarrDiscover && window.RequestarrDiscover.content &&
            typeof window.RequestarrDiscover.content.createMediaCard === 'function') {
            return window.RequestarrDiscover.content.createMediaCard(item, suggestedInstance);
        }
        return null;
    }

    _attachInfiniteScroll() {
        const carousel = document.getElementById(this.carouselId);
        if (!carousel) return;

        // Remove existing handler
        if (this._scrollHandler) {
            carousel.removeEventListener('scroll', this._scrollHandler);
        }

        this._scrollHandler = () => {
            if (this.isLoading || !this.hasMore) return;
            // When within 300px of the right edge, load more
            const remaining = carousel.scrollWidth - carousel.scrollLeft - carousel.clientWidth;
            if (remaining < 300) {
                this._loadNextPage(true);
            }
        };

        carousel.addEventListener('scroll', this._scrollHandler, { passive: true });
    }
}

// ---------------------------------------------------------------------------
// Convenience: make SmartHunt available globally for non-module scripts
// ---------------------------------------------------------------------------
window.SmartHunt = SmartHunt;
window.invalidateSmartHuntCache = invalidateSmartHuntCache;


/* === modules/features/requestarr/requestarr-controller.js === */
/**
 * Requestarr Controller - Main entry point and global interface
 */
// RequestarrDiscover from requestarr-core.js (concatenated)
// Initialize the Requestarr Discover system (handle defer + DOMContentLoaded race)
function initRequestarrDiscover() {
    window.RequestarrDiscover = new RequestarrDiscover();
    console.log('[RequestarrController] Discover modules loaded successfully');
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initRequestarrDiscover);
} else {
    initRequestarrDiscover();
}

/**
 * Global HuntarrRequestarr interface for the main app (app.js)
 * This provides a bridge between the core orchestrator and the modular Requestarr system.
 */
window.HuntarrRequestarr = {
    /**
     * Wait for RequestarrDiscover to be initialized before executing a callback
     */
    runWhenRequestarrReady: function(actionName, callback) {
        if (window.RequestarrDiscover) {
            callback();
            return;
        }

        const startTime = Date.now();
        const checkInterval = setInterval(() => {
            if (window.RequestarrDiscover) {
                clearInterval(checkInterval);
                callback();
                return;
            }

            if (Date.now() - startTime > 2000) {
                clearInterval(checkInterval);
                console.warn(`[HuntarrRequestarr] RequestarrDiscover not ready for ${actionName} after 2s`);
            }
        }, 50);
    },

    /**
     * Expand the Requests group in the unified sidebar
     */
    showRequestarrSidebar: function() {
        if (typeof expandSidebarGroup === 'function') expandSidebarGroup('sidebar-group-requests');
        if (typeof setActiveNavItem === 'function') setActiveNavItem();
    },

    /**
     * Show a specific Requestarr view (home, discover, etc.)
     */
    showRequestarrView: function(view) {
        const homeView = document.getElementById('requestarr-home-view');
        if (homeView) homeView.style.display = view === 'home' ? 'block' : 'none';
        this.updateRequestarrNavigation(view);
    },

    /**
     * Update the active state of items in the Requests group
     */
    updateRequestarrSidebarActive: function() {
        if (typeof setActiveNavItem === 'function') setActiveNavItem();
    },

    /**
     * Delegate view switching to the RequestarrDiscover instance
     */
    updateRequestarrNavigation: function(view) {
        if (window.RequestarrDiscover && typeof window.RequestarrDiscover.switchView === 'function') {
            window.RequestarrDiscover.switchView(view);
        }
    },

    /**
     * Set up click handlers for Requestarr nav items (unified sidebar, hash links handle it)
     */
    setupRequestarrNavigation: function() {
        // Navigation handled by hash links in the unified sidebar
    }
};


/* === modules/features/requestarr/requestarr-home.js === */
/**
 * Requestarr Home - Smart Hunt carousel + global search for Home section
 *
 * The three rotating carousels (Trending / Movies / TV) have been replaced
 * with a single Smart Hunt carousel that uses the SmartHunt module.
 */

const HomeRequestarr = {
    core: null,
    searchTimeout: null,
    elements: {},
    defaultMovieInstance: null,
    defaultTVInstance: null,
    showTrending: true,

    /** SmartHunt instance (created after core is ready) */
    _smartHunt: null,

    // Helpers to encode/decode compound instance values (movie_hunt:Name or radarr:Name)
    _encodeInstance(appType, name) { return `${appType}:${name}`; },
    _decodeInstance(compound) {
        if (!compound || !compound.includes(':')) return { appType: 'radarr', name: compound || '' };
        const idx = compound.indexOf(':');
        return { appType: compound.substring(0, idx), name: compound.substring(idx + 1) };
    },

    init() {
        this.cacheElements();

        if (!this.elements.searchInput) {
            return;
        }

        // Make this module globally accessible for auto-save visibility updates
        window.HomeRequestarr = this;

        // Auto-refresh dropdowns when any instance is added/deleted/renamed anywhere in the app
        document.addEventListener('huntarr:instances-changed', () => {
            this._populateInstanceDropdowns();
        });

        // Force hide initially if we can't determine setting yet
        if (this.elements.discoverView) {
            this.elements.discoverView.style.setProperty('display', 'none', 'important');
        }

        // Load settings first to determine if Smart Hunt should be shown
        this.loadSettings()
            .then(() => {
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
                            this._initSmartHunt();
                        });
                    })
                    .catch(() => {
                        console.warn('[HomeRequestarr] Requestarr modules not ready within timeout');
                    });
            });
    },

    /**
     * Full refresh — called every time the user navigates to the Home page.
     * Re-fetches settings from the server and re-applies all visibility and data.
     */
    refresh() {
        this.loadSettings().then(() => {
            this.applyTrendingVisibility();

            if (this.showTrending) {
                if (this._smartHunt) {
                    // Smart Hunt already exists — reload instances + data
                    this.loadDefaultInstances().then(() => {
                        this._smartHunt.reload();
                    });
                } else {
                    // Smart Hunt was not yet created (e.g. was disabled on first load)
                    this.waitForCore().then((core) => {
                        this.core = core;
                        this.loadDefaultInstances().then(() => {
                            this._initSmartHunt();
                        });
                    }).catch(() => {
                        console.warn('[HomeRequestarr] Could not init SmartHunt on refresh');
                    });
                }
            }
        });
    },

    /** Create and load the SmartHunt carousel */
    _initSmartHunt() {
        const section = document.getElementById('home-smarthunt-section');
        if (section) section.style.display = 'block';

        if (!window.SmartHunt) {
            console.warn('[HomeRequestarr] SmartHunt class not available yet');
            return;
        }

        const self = this;
        this._smartHunt = new window.SmartHunt({
            carouselId: 'home-smarthunt-carousel',
            core: this.core,
            getMovieInstance: () => self.defaultMovieInstance || '',
            getTVInstance: () => self.defaultTVInstance || '',
        });

        this._smartHunt.load();
    },

    async loadSettings() {
        try {
            const response = await fetch('./api/settings');
            const data = await response.json();
            if (data && data.general) {
                const showPref = data.general.show_trending !== false;
                const requestsEnabled = data.general.enable_requestarr !== false;
                this.showTrending = showPref && requestsEnabled;
                console.log('[HomeRequestarr] Show Smart Hunt on Home:', this.showTrending, '(show_trending:', showPref, ', requests enabled:', requestsEnabled, ')');
            }
        } catch (error) {
            console.error('[HomeRequestarr] Error loading settings:', error);
            this.showTrending = true;
        }
    },

    applyTrendingVisibility() {
        const requestsEnabled = !!(window.huntarrUI && window.huntarrUI._enableRequestarr !== false);
        const card = this.elements.requestarrCard;
        if (card) {
            card.style.display = requestsEnabled ? '' : 'none';
        }
        const discoverView = this.elements.discoverView;
        if (discoverView) {
            const show = this.showTrending && requestsEnabled;
            if (show) {
                discoverView.style.setProperty('display', 'block', 'important');
            } else {
                discoverView.style.setProperty('display', 'none', 'important');
            }
        }
    },

    cacheElements() {
        this.elements.requestarrCard = document.querySelector('.requestarr-home-card');
        this.elements.searchInput = document.getElementById('home-requestarr-search-input');
        this.elements.searchResultsView = document.getElementById('home-search-results-view');
        this.elements.searchResultsGrid = document.getElementById('home-search-results-grid');
        this.elements.discoverView = document.getElementById('home-requestarr-discover-view');
        this.elements.smarthuntCarousel = document.getElementById('home-smarthunt-carousel');
        this.elements.instanceControls = document.getElementById('home-instance-controls');
        this.elements.movieInstanceSelect = document.getElementById('home-movie-instance-select');
        this.elements.tvInstanceSelect = document.getElementById('home-tv-instance-select');
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
            }
        } catch (error) {
            console.error('[HomeRequestarr] Error loading default instances:', error);
            this.defaultMovieInstance = null;
            this.defaultTVInstance = null;
        }
        await this._populateInstanceDropdowns();
    },

    async _populateInstanceDropdowns() {
            // Fetch bundle dropdown options once, then populate both selects
            try {
                const resp = await fetch(`./api/requestarr/bundles/dropdown?t=${Date.now()}`, { cache: 'no-store' });
                if (!resp.ok) throw new Error('Failed to fetch bundle dropdown');
                const data = await resp.json();
                this._bundleMovieOptions = data.movie_options || [];
                this._bundleTVOptions = data.tv_options || [];
            } catch (e) {
                console.warn('[HomeRequestarr] Error fetching bundle dropdown:', e);
                this._bundleMovieOptions = [];
                this._bundleTVOptions = [];
            }
            this._populateMovieInstanceDropdown();
            this._populateTVInstanceDropdown();
            if (this.elements.instanceControls) {
                this.elements.instanceControls.style.display = 'flex';
            }
        }
,

    async _populateMovieInstanceDropdown() {
            const select = this.elements.movieInstanceSelect;
            if (!select) return;

            const options = this._bundleMovieOptions || [];
            const previousValue = this.defaultMovieInstance || select.value || '';

            select.innerHTML = '';
            if (options.length === 0) {
                select.innerHTML = '<option value="">No movie instances</option>';
                return;
            }

            let matched = null;
            options.forEach(opt => {
                const el = document.createElement('option');
                const val = opt.is_bundle
                    ? this._encodeInstance(opt.primary_app_type, opt.primary_instance_name)
                    : opt.value;
                el.value = val;
                el.textContent = opt.label;
                if (previousValue && val === previousValue) {
                    el.selected = true;
                    matched = val;
                }
                select.appendChild(el);
            });

            if (!matched && options.length > 0) {
                select.options[0].selected = true;
                matched = select.options[0].value;
            }

            if (matched) this.defaultMovieInstance = matched;

            if (!select._homeChangeWired) {
                select._homeChangeWired = true;
                select.addEventListener('change', async () => {
                    this.defaultMovieInstance = select.value;
                    await this._saveServerDefaults();
                    this._syncRequestarrContent();
                    if (this._smartHunt) this._smartHunt.reload();
                });
            }
        }
,

    async _populateTVInstanceDropdown() {
            const select = this.elements.tvInstanceSelect;
            if (!select) return;

            const options = this._bundleTVOptions || [];
            const previousValue = this.defaultTVInstance || select.value || '';

            select.innerHTML = '';
            if (options.length === 0) {
                select.innerHTML = '<option value="">No TV instances</option>';
                return;
            }

            let matched = null;
            options.forEach(opt => {
                const el = document.createElement('option');
                const val = opt.is_bundle
                    ? this._encodeInstance(opt.primary_app_type, opt.primary_instance_name)
                    : opt.value;
                el.value = val;
                el.textContent = opt.label;
                if (previousValue && val === previousValue) {
                    el.selected = true;
                    matched = val;
                }
                select.appendChild(el);
            });

            if (!matched && options.length > 0) {
                select.options[0].selected = true;
                matched = select.options[0].value;
            }

            if (matched) this.defaultTVInstance = matched;

            if (!select._homeChangeWired) {
                select._homeChangeWired = true;
                select.addEventListener('change', async () => {
                    this.defaultTVInstance = select.value;
                    await this._saveServerDefaults();
                    this._syncRequestarrContent();
                    if (this._smartHunt) this._smartHunt.reload();
                });
            }
        }
,

    _saveServerDefaults() {
        return fetch('./api/requestarr/settings/default-instances', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                movie_instance: this.defaultMovieInstance || '',
                tv_instance: this.defaultTVInstance || ''
            })
        }).catch(e => console.warn('[HomeRequestarr] Failed to save defaults:', e));
    },

    _syncRequestarrContent() {
        if (this.core && this.core.content) {
            this.core.content.selectedMovieInstance = this.defaultMovieInstance;
            this.core.content.selectedTVInstance = this.defaultTVInstance;
            ['movies-instance-select', 'discover-movie-instance-select'].forEach(id => {
                const el = document.getElementById(id);
                if (el && el.value !== this.defaultMovieInstance) el.value = this.defaultMovieInstance;
            });
            ['tv-instance-select', 'discover-tv-instance-select'].forEach(id => {
                const el = document.getElementById(id);
                if (el && el.value !== this.defaultTVInstance) el.value = this.defaultTVInstance;
            });
        }
    },

    setupSearch() {
        this.elements.searchInput.addEventListener('input', (event) => {
            this.handleSearch(event.target.value);
        });
    },

    handleSearch(query) {
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
        this.showResults();

        if (!this.elements.searchResultsGrid) {
            return;
        }

        this.elements.searchResultsGrid.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Searching...</p></div>';

        try {
            // Ensure global blacklist is loaded for filtering
            if (this.core && this.core.content && typeof this.core.content.loadHiddenMediaIds === 'function' && !this.core.content.globalBlacklistSet) {
                await this.core.content.loadHiddenMediaIds();
            }

            const movieDecoded = this._decodeInstance(this.defaultMovieInstance);
            const tvDecoded = this._decodeInstance(this.defaultTVInstance);

            const [moviesResponse, tvResponse] = await Promise.all([
                fetch(`./api/requestarr/search?q=${encodeURIComponent(query)}&app_type=${encodeURIComponent(movieDecoded.appType)}&instance_name=${encodeURIComponent(movieDecoded.name)}`),
                fetch(`./api/requestarr/search?q=${encodeURIComponent(query)}&app_type=${encodeURIComponent(tvDecoded.appType)}&instance_name=${encodeURIComponent(tvDecoded.name)}`)
            ]);

            const moviesData = await moviesResponse.json();
            const tvData = await tvResponse.json();

            const allResults = [
                ...(moviesData.results || []),
                ...(tvData.results || [])
            ];

            allResults.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));

            if (allResults.length > 0) {
                this.elements.searchResultsGrid.innerHTML = '';
                allResults.forEach((item) => {
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


/* === modules/features/requestarr/requestarr-users.js === */
/**
 * Requestarr User Management Module
 * Handles user list, create/edit/delete, Plex import, and permissions.
 */

window.RequestarrUsers = {
    users: [],
    permissionLabels: {
        request_movies: 'Request Movies',
        request_tv: 'Request TV',
        auto_approve: 'Auto Approve All',
        auto_approve_movies: 'Auto Approve Movies',
        auto_approve_tv: 'Auto Approve TV',
        manage_requests: 'Manage Requests',
        manage_users: 'Manage Users',
        view_requests: 'View All Requests',
        hide_media_global: 'Hide Media (Global)',
        disable_chat: 'Disable Chat',
    },

    async init() {
        await this.loadUsers();
    },

    async loadUsers() {
        const container = document.getElementById('requestarr-users-view');
        if (!container) return;
        try {
            const resp = await fetch('./api/requestarr/users', { cache: 'no-store' });
            if (!resp.ok) throw new Error('Failed to load users');
            const data = await resp.json();
            this.users = data.users || [];
            this.render();
        } catch (e) {
            console.error('[RequestarrUsers] Error loading users:', e);
            this.renderError();
        }
    },

    render() {
        const container = document.getElementById('requsers-content');
        if (!container) return;

        const rows = this.users.map(u => {
            const initials = (u.username || '?').substring(0, 2).toUpperCase();
            const avatarHtml = u.avatar_url
                ? `<img src="${u.avatar_url}" alt="" onerror="this.style.display='none';this.parentElement.textContent='${initials}'">`
                : initials;
            const roleClass = `requsers-role-${u.role || 'user'}`;
            const joined = u.created_at ? new Date(u.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
            const isOwner = u.role === 'owner';

            return `<tr data-user-id="${u.id}">
                <td>
                    <div class="requsers-user-cell">
                        <div class="requsers-avatar">${avatarHtml}</div>
                        <div class="requsers-user-info">
                            <span class="requsers-user-name">${this._esc(u.username)}</span>
                            ${u.email ? `<span class="requsers-user-email">${this._esc(u.email)}</span>` : ''}
                        </div>
                    </div>
                </td>
                <td>${u.request_count || 0}</td>
                <td><span class="requsers-role-badge ${roleClass}">${u.role || 'user'}</span></td>
                <td>${joined}</td>
                <td>
                    <div class="requsers-actions">
                        <button class="requsers-btn requsers-btn-primary requsers-btn-sm" onclick="RequestarrUsers.openEditModal(${u.id})">Edit</button>
                        ${!isOwner ? `<button class="requsers-btn requsers-btn-danger requsers-btn-sm" onclick="RequestarrUsers.confirmDelete(${u.id}, '${this._esc(u.username)}')">Delete</button>` : ''}
                    </div>
                </td>
            </tr>`;
        }).join('');

        container.innerHTML = `
            <div class="requsers-table-wrap">
                <table class="requsers-table">
                    <thead>
                        <tr>
                            <th>User</th>
                            <th>Requests</th>
                            <th>Role</th>
                            <th>Joined</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>${rows || '<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--text-muted);">No users found</td></tr>'}</tbody>
                </table>
                <div class="requsers-pagination">
                    <span>Showing ${this.users.length} user${this.users.length !== 1 ? 's' : ''}</span>
                </div>
            </div>`;
    },

    renderError() {
        const container = document.getElementById('requsers-content');
        if (container) {
            container.innerHTML = '<p style="color:var(--error-color);padding:20px;">Failed to load users. Check your connection.</p>';
        }
    },

    // ── Create User Modal ────────────────────────────────────

    openCreateModal() {
        this._openModal('Create Local User', null);
    },

    openEditModal(userId) {
        const user = this.users.find(u => u.id === userId);
        if (!user) return;
        this._openModal('Edit User', user);
    },

    _openModal(title, user) {
        const isEdit = !!user;
        const isOwner = isEdit && user.role === 'owner';
        const perms = (user && typeof user.permissions === 'object') ? user.permissions : {};

        const permsHtml = Object.entries(this.permissionLabels).map(([key, label]) => {
            const checked = perms[key] ? 'checked' : '';
            const disabled = isOwner ? 'disabled' : '';
            // Hide disable_chat for owner — owner can never be chat-disabled
            if (key === 'disable_chat' && isOwner) return '';
            return `<label class="requsers-perm-item">
                <input type="checkbox" name="perm_${key}" ${checked} ${disabled}>
                <span>${label}</span>
            </label>`;
        }).join('');

        // Hide password field for owner
        const passwordFieldHtml = isOwner ? '' : `
                    <div class="requsers-field">
                        <label>${isEdit ? 'New Password (leave blank to keep)' : 'Password'}</label>
                        <input type="password" id="requsers-modal-password" placeholder="${isEdit ? '••••••••' : 'Min 8 characters'}" minlength="8" autocomplete="new-password">
                        <div class="requsers-field-hint"><a href="#" onclick="RequestarrUsers.fillGeneratedPassword();return false;">Generate random password</a></div>
                    </div>`;

        const html = `<div class="requsers-modal-overlay" id="requsers-modal-overlay" onclick="if(event.target===this)RequestarrUsers.closeModal()">
            <div class="requsers-modal">
                <div class="requsers-modal-header">
                    <h3 class="requsers-modal-title">${title}</h3>
                    <button class="requsers-modal-close" onclick="RequestarrUsers.closeModal()"><i class="fas fa-times"></i></button>
                </div>
                <div class="requsers-modal-body">
                    <div class="requsers-field">
                        <label>Username</label>
                        <input type="text" id="requsers-modal-username" value="${isEdit ? this._esc(user.username) : ''}" ${isOwner ? 'disabled' : ''} placeholder="Enter username" minlength="3">
                    </div>
                    <div class="requsers-field">
                        <label>Email (optional)</label>
                        <input type="email" id="requsers-modal-email" value="${isEdit ? this._esc(user.email || '') : ''}" placeholder="user@example.com">
                    </div>${passwordFieldHtml}
                    <div class="requsers-field">
                        <label>Role</label>
                        <select id="requsers-modal-role" ${isOwner ? 'disabled' : ''} onchange="RequestarrUsers.onRoleChange()">
                            <option value="user" ${(!isEdit || user.role === 'user') ? 'selected' : ''}>User</option>
                            ${isOwner ? '<option value="owner" selected>Owner</option>' : ''}
                        </select>
                    </div>
                    <div class="requsers-field">
                        <label>Permissions</label>
                        <div class="requsers-perms-grid" id="requsers-perms-grid">${permsHtml}</div>
                    </div>
                </div>
                <div class="requsers-modal-footer">
                    <button class="requsers-btn" style="background:var(--bg-tertiary);color:var(--text-secondary);" onclick="RequestarrUsers.closeModal()">Cancel</button>
                    <button class="requsers-btn requsers-btn-primary" id="requsers-modal-save" onclick="RequestarrUsers.saveUser(${isEdit ? user.id : 'null'})">${isEdit ? 'Save Changes' : 'Create User'}</button>
                </div>
            </div>
        </div>`;

        // Remove existing modal if any
        this.closeModal();
        document.body.insertAdjacentHTML('beforeend', html);
    },

    closeModal() {
        const overlay = document.getElementById('requsers-modal-overlay');
        if (overlay) overlay.remove();
        const plexOverlay = document.getElementById('requsers-plex-modal-overlay');
        if (plexOverlay) plexOverlay.remove();
    },

    async fillGeneratedPassword() {
        try {
            const resp = await fetch('./api/requestarr/users/generate-password');
            const data = await resp.json();
            const input = document.getElementById('requsers-modal-password');
            if (input && data.password) {
                input.type = 'text';
                input.value = data.password;
                // Copy to clipboard
                try { await navigator.clipboard.writeText(data.password); } catch (_) {}
                if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification('Password generated and copied to clipboard', 'success');
            }
        } catch (e) {
            console.error('[RequestarrUsers] Error generating password:', e);
        }
    },

    async onRoleChange() {
        // Load default permissions for the selected role
        try {
            const resp = await fetch('./api/requestarr/users/permissions-template');
            const templates = await resp.json();
            const role = document.getElementById('requsers-modal-role').value;
            const perms = templates[role] || {};
            const grid = document.getElementById('requsers-perms-grid');
            if (!grid) return;
            grid.querySelectorAll('input[type="checkbox"]').forEach(cb => {
                const key = cb.name.replace('perm_', '');
                cb.checked = !!perms[key];
            });
        } catch (_) {}
    },

    async saveUser(userId) {
        const username = (document.getElementById('requsers-modal-username').value || '').trim();
        const email = (document.getElementById('requsers-modal-email').value || '').trim();
        const passwordEl = document.getElementById('requsers-modal-password');
        const password = passwordEl ? passwordEl.value : '';
        const role = document.getElementById('requsers-modal-role').value;

        // Collect permissions
        const permissions = {};
        const grid = document.getElementById('requsers-perms-grid');
        if (grid) {
            grid.querySelectorAll('input[type="checkbox"]').forEach(cb => {
                const key = cb.name.replace('perm_', '');
                permissions[key] = cb.checked;
            });
        }

        if (!username || username.length < 3) {
            if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification('Username must be at least 3 characters', 'error');
            return;
        }

        const body = { username, email, role, permissions };
        if (password) body.password = password;

        const isEdit = userId !== null;
        if (!isEdit && (!password || password.length < 8)) {
            if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification('Password must be at least 8 characters', 'error');
            return;
        }

        const saveBtn = document.getElementById('requsers-modal-save');
        if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving...'; }

        try {
            const url = isEdit ? `./api/requestarr/users/${userId}` : './api/requestarr/users';
            const method = isEdit ? 'PUT' : 'POST';
            const resp = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const data = await resp.json();
            if (data.success) {
                this.closeModal();
                if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification(isEdit ? 'User updated' : 'User created', 'success');
                await this.loadUsers();
            } else {
                if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification(data.error || 'Failed to save user', 'error');
            }
        } catch (e) {
            console.error('[RequestarrUsers] Error saving user:', e);
            if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification('Failed to save user', 'error');
        } finally {
            if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = isEdit ? 'Save Changes' : 'Create User'; }
        }
    },

    confirmDelete(userId, username) {
        if (window.HuntarrConfirmModal && typeof window.HuntarrConfirmModal.show === 'function') {
            window.HuntarrConfirmModal.show({
                title: 'Delete User',
                message: `Are you sure you want to delete <strong>${this._esc(username)}</strong>? This cannot be undone.`,
                confirmText: 'Delete',
                confirmClass: 'danger',
                onConfirm: () => this.deleteUser(userId),
            });
        } else {
            if (confirm(`Delete user "${username}"? This cannot be undone.`)) {
                this.deleteUser(userId);
            }
        }
    },

    async deleteUser(userId) {
        try {
            const resp = await fetch(`./api/requestarr/users/${userId}`, { method: 'DELETE' });
            const data = await resp.json();
            if (data.success) {
                if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification('User deleted', 'success');
                await this.loadUsers();
            } else {
                if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification(data.error || 'Failed to delete user', 'error');
            }
        } catch (e) {
            console.error('[RequestarrUsers] Error deleting user:', e);
        }
    },

    // ── Plex Import ──────────────────────────────────────────

    async openPlexImportModal() {
        try {
            const resp = await fetch('./api/requestarr/users/plex/friends');
            const data = await resp.json();
            if (data.error) {
                if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification(data.error, 'error');
                return;
            }
            const friends = data.friends || [];
            if (!friends.length) {
                if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification('No Plex friends found', 'info');
                return;
            }

            const listHtml = friends.map(f => `
                <label class="requsers-plex-item">
                    <input type="checkbox" value="${f.id}" data-username="${this._esc(f.username)}">
                    ${f.thumb ? `<img class="requsers-plex-thumb" src="${f.thumb}" alt="">` : '<div class="requsers-avatar" style="width:32px;height:32px;font-size:0.7rem;">' + (f.username || '?').substring(0, 2).toUpperCase() + '</div>'}
                    <div class="requsers-user-info">
                        <span class="requsers-user-name">${this._esc(f.username)}</span>
                        ${f.email ? `<span class="requsers-user-email">${this._esc(f.email)}</span>` : ''}
                    </div>
                </label>
            `).join('');

            const html = `<div class="requsers-modal-overlay" id="requsers-plex-modal-overlay" onclick="if(event.target===this)RequestarrUsers.closeModal()">
                <div class="requsers-modal">
                    <div class="requsers-modal-header">
                        <h3 class="requsers-modal-title"><i class="fas fa-download" style="color:#e5a00d;margin-right:6px;"></i> Import Plex Users</h3>
                        <button class="requsers-modal-close" onclick="RequestarrUsers.closeModal()"><i class="fas fa-times"></i></button>
                    </div>
                    <div class="requsers-modal-body">
                        <p style="color:var(--text-muted);font-size:0.85rem;margin-bottom:12px;">Select friends to import as local users with the "User" role.</p>
                        <div class="requsers-plex-list">${listHtml}</div>
                    </div>
                    <div class="requsers-modal-footer">
                        <button class="requsers-btn" style="background:var(--bg-tertiary);color:var(--text-secondary);" onclick="RequestarrUsers.closeModal()">Cancel</button>
                        <button class="requsers-btn requsers-btn-plex" id="requsers-plex-import-btn" onclick="RequestarrUsers.doPlexImport()"><i class="fas fa-download"></i> Import Selected</button>
                    </div>
                </div>
            </div>`;

            this.closeModal();
            document.body.insertAdjacentHTML('beforeend', html);
        } catch (e) {
            console.error('[RequestarrUsers] Error opening Plex import:', e);
            if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification('Failed to load Plex friends', 'error');
        }
    },

    async doPlexImport() {
        const overlay = document.getElementById('requsers-plex-modal-overlay');
        if (!overlay) return;
        const checked = overlay.querySelectorAll('input[type="checkbox"]:checked');
        const friendIds = Array.from(checked).map(cb => parseInt(cb.value)).filter(v => !isNaN(v));
        if (!friendIds.length) {
            if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification('Select at least one friend to import', 'warning');
            return;
        }

        const btn = document.getElementById('requsers-plex-import-btn');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Importing...'; }

        try {
            const resp = await fetch('./api/requestarr/users/plex/import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ friend_ids: friendIds }),
            });
            const data = await resp.json();
            if (data.success) {
                const msg = `Imported ${data.imported.length} user${data.imported.length !== 1 ? 's' : ''}${data.skipped.length ? `, ${data.skipped.length} skipped` : ''}`;
                if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification(msg, 'success');
                this.closeModal();
                await this.loadUsers();
            } else {
                if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification(data.error || 'Import failed', 'error');
            }
        } catch (e) {
            console.error('[RequestarrUsers] Plex import error:', e);
            if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification('Import failed', 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-download"></i> Import Selected'; }
        }
    },

    _esc(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },
};


/* === modules/features/requestarr/requestarr-bundles.js === */
/**
 * Requestarr Services — Bundles page.
 * Instances are discovered automatically from Movie Hunt / TV Hunt / Radarr / Sonarr configs.
 * This page manages bundles (grouping instances for cascading requests).
 * Uses the same card-based design as the Sonarr/Radarr instance pages.
 */
const RequestarrServices = {
    bundles: [],
    available: { movies: [], tv: [] },

    async init() {
        await Promise.all([this.loadBundles(), this.loadAvailable()]);
        this.render();
    },

    async loadBundles() {
        try {
            const resp = await fetch('./api/requestarr/bundles', { cache: 'no-store' });
            if (!resp.ok) throw new Error('Failed');
            const data = await resp.json();
            this.bundles = data.bundles || [];
        } catch (e) {
            console.error('[RequestarrServices] Error loading bundles:', e);
        }
    },

    async loadAvailable() {
        try {
            const resp = await fetch('./api/requestarr/bundles/available', { cache: 'no-store' });
            if (!resp.ok) throw new Error('Failed');
            this.available = await resp.json();
        } catch (e) {
            console.error('[RequestarrServices] Error loading available instances:', e);
        }
    },

    _appLabel(at) {
        return {'radarr':'Radarr','sonarr':'Sonarr','movie_hunt':'Movie Hunt','tv_hunt':'TV Hunt'}[at] || at;
    },

    _appIcon(at) {
        return {'radarr':'fa-film','sonarr':'fa-tv','movie_hunt':'fa-film','tv_hunt':'fa-tv'}[at] || 'fa-layer-group';
    },

    render() {
        const container = document.getElementById('requestarr-bundles-content');
        if (!container) return;

        const movieBundles = this.bundles.filter(b => b.service_type === 'movies');
        const tvBundles = this.bundles.filter(b => b.service_type === 'tv');

        container.innerHTML =
            this._renderBundleGroup('Movie Bundles', movieBundles, 'movies') +
            this._renderBundleGroup('TV Bundles', tvBundles, 'tv');
        this._wireBundles();
    },

    _renderBundleGroup(title, bundles, type) {
        const cards = bundles.map(b => this._renderBundleCard(b)).join('');
        const addCard = `
            <div class="add-instance-card" onclick="RequestarrServices.openBundleModal(null,'${type}')">
                <div class="add-icon"><i class="fas fa-plus-circle"></i></div>
                <div class="add-text">Add Bundle</div>
            </div>`;

        return `
            <div class="settings-group">
                <h3>${title}</h3>
                <div class="instance-card-grid">
                    ${cards}
                    ${addCard}
                </div>
            </div>`;
    },

    _renderBundleCard(bundle) {
        const primaryLabel = `${this._appLabel(bundle.primary_app_type)} \u2013 ${bundle.primary_instance_name}`;
        const members = bundle.members || [];
        const memberCount = members.length;
        const allInstances = [
            { app_type: bundle.primary_app_type, instance_name: bundle.primary_instance_name },
            ...members
        ];

        const instanceTags = allInstances.map(inst =>
            `<span class="profile-quality-tag">${this._esc(this._appLabel(inst.app_type))} \u2013 ${this._esc(inst.instance_name)}</span>`
        ).join('');

        return `
            <div class="instance-card" data-bundle-id="${bundle.id}">
                <div class="instance-card-header">
                    <div class="instance-name instance-name-with-priority">
                        <i class="fas fa-layer-group"></i>
                        ${this._esc(bundle.name)}
                    </div>
                </div>
                <div class="instance-card-body">
                    <div class="instance-detail">
                        <i class="fas fa-star" style="color:#f59e0b;"></i>
                        <span>${this._esc(primaryLabel)}${memberCount > 0 ? ` + ${memberCount} more` : ''}</span>
                    </div>
                    <div class="profile-card-quality-tags" style="margin-top:8px;">
                        ${instanceTags}
                    </div>
                </div>
                <div class="instance-card-footer">
                    <button type="button" class="btn-card edit" onclick="RequestarrServices.openBundleModal(${bundle.id})">
                        <i class="fas fa-edit"></i> Edit
                    </button>
                    <button type="button" class="btn-card delete" onclick="RequestarrServices.deleteBundle(${bundle.id})">
                        <i class="fas fa-trash"></i> Delete
                    </button>
                </div>
            </div>`;
    },

    _wireBundles() {
        // onclick handlers are inline
    },

    openBundleModal(editBundleId, defaultType) {
        const existing = editBundleId ? this.bundles.find(b => b.id === editBundleId) : null;
        const isEdit = !!existing;
        const title = isEdit ? 'Edit Bundle' : 'Create Bundle';
        const bundleName = existing ? existing.name : '';
        const bundleType = existing ? existing.service_type : (defaultType || 'movies');
        const primaryKey = existing ? `${existing.primary_app_type}:${existing.primary_instance_name}` : '';
        const memberKeys = existing
            ? (existing.members || []).map(m => `${m.app_type}:${m.instance_name}`)
            : [];

        const typeOptions = isEdit
            ? `<input type="hidden" id="bundle-type-select" value="${bundleType}">
               <div class="modal-form-section">
                   <div class="modal-section-title">Type</div>
                   <input type="text" value="${bundleType === 'movies' ? 'Movies' : 'TV'}" disabled style="opacity:0.6;width:100%;padding:8px 12px;border-radius:6px;border:1px solid rgba(148,163,184,0.2);background:rgba(30,41,59,0.5);color:#cbd5e1;">
               </div>`
            : `<div class="modal-form-section">
                   <div class="modal-section-title">Type</div>
                   <select id="bundle-type-select" style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid rgba(148,163,184,0.2);background:rgba(30,41,59,0.5);color:#cbd5e1;">
                       <option value="movies"${bundleType === 'movies' ? ' selected' : ''}>Movies</option>
                       <option value="tv"${bundleType === 'tv' ? ' selected' : ''}>TV</option>
                   </select>
               </div>`;

        const html = `<div class="huntarr-modal-overlay active" id="bundle-modal-overlay" onclick="if(event.target===this)RequestarrServices.closeModal()">
            <div class="huntarr-modal" style="max-width:520px;">
                <div class="huntarr-modal-header">
                    <h3 class="huntarr-modal-title">${title}</h3>
                    <button class="huntarr-modal-close" onclick="RequestarrServices.closeModal()"><i class="fas fa-times"></i></button>
                </div>
                <div class="huntarr-modal-body">
                    ${typeOptions}
                    <div class="modal-form-section">
                        <div class="modal-section-title">Bundle Name</div>
                        <input type="text" id="bundle-name-input" value="${this._esc(bundleName)}" placeholder="e.g. All Movies" maxlength="50"
                            style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid rgba(148,163,184,0.2);background:rgba(30,41,59,0.5);color:#f8fafc;">
                    </div>
                    <div class="modal-form-section">
                        <div class="modal-section-title">Primary Instance</div>
                        <select id="bundle-primary-select" style="width:100%;padding:8px 12px;border-radius:6px;border:1px solid rgba(148,163,184,0.2);background:rgba(30,41,59,0.5);color:#cbd5e1;">
                            <option value="">Loading...</option>
                        </select>
                        <div style="font-size:11px;color:#64748b;margin-top:6px;">This is the instance you browse. Its library is what you see.</div>
                    </div>
                    <div class="modal-form-section">
                        <div class="modal-section-title">Bundled Instances</div>
                        <div id="bundle-members-list" style="display:flex;flex-direction:column;gap:8px;">Loading...</div>
                        <div style="font-size:11px;color:#64748b;margin-top:6px;">These instances will automatically receive the same requests as the primary.</div>
                    </div>
                </div>
                <div class="huntarr-modal-footer">
                    <button class="btn-modal btn-modal-secondary" onclick="RequestarrServices.closeModal()">Cancel</button>
                    <button class="btn-modal btn-modal-primary" id="bundle-save-btn"><i class="fas fa-save"></i> ${isEdit ? 'Save' : 'Create'}</button>
                </div>
            </div>
        </div>`;

        this.closeModal();
        document.body.insertAdjacentHTML('beforeend', html);

        const typeSelect = document.getElementById('bundle-type-select');
        this._populateBundleInstanceSelectors(bundleType, primaryKey, memberKeys);

        const primarySelect = document.getElementById('bundle-primary-select');
        primarySelect.addEventListener('change', () => {
            const currentMembers = Array.from(document.querySelectorAll('.bundle-member-cb:checked')).map(cb => cb.value);
            this._populateBundleMembers(
                document.getElementById('bundle-type-select')?.value || 'movies',
                primarySelect.value,
                currentMembers.filter(k => k !== primarySelect.value)
            );
        });

        if (!isEdit) {
            typeSelect.addEventListener('change', () => {
                this._populateBundleInstanceSelectors(typeSelect.value, '', []);
            });
        }

        document.getElementById('bundle-save-btn').addEventListener('click', () => {
            this._saveBundleFromModal(editBundleId);
        });
    },

    _populateBundleInstanceSelectors(serviceType, selectedPrimaryKey, selectedMemberKeys) {
        const instances = serviceType === 'movies'
            ? (this.available.movies || [])
            : (this.available.tv || []);

        const primarySelect = document.getElementById('bundle-primary-select');
        if (!primarySelect) return;

        if (instances.length === 0) {
            primarySelect.innerHTML = '<option value="">No instances available</option>';
            this._populateBundleMembers(serviceType, '', []);
            return;
        }

        primarySelect.innerHTML = instances.map(inst => {
            const key = `${inst.app_type}:${inst.instance_name}`;
            const label = `${this._appLabel(inst.app_type)} \u2013 ${inst.instance_name}`;
            const sel = key === selectedPrimaryKey ? ' selected' : '';
            return `<option value="${this._esc(key)}"${sel}>${this._esc(label)}</option>`;
        }).join('');

        const activePrimary = primarySelect.value || selectedPrimaryKey;
        this._populateBundleMembers(serviceType, activePrimary, selectedMemberKeys);
    },

    _populateBundleMembers(serviceType, primaryKey, selectedMemberKeys) {
        const instances = serviceType === 'movies'
            ? (this.available.movies || [])
            : (this.available.tv || []);

        const membersList = document.getElementById('bundle-members-list');
        if (!membersList) return;

        const filtered = instances.filter(inst => `${inst.app_type}:${inst.instance_name}` !== primaryKey);

        if (filtered.length === 0) {
            membersList.innerHTML = '<div style="color:#64748b;font-size:13px;">No other instances available</div>';
            return;
        }

        membersList.innerHTML = filtered.map(inst => {
            const key = `${inst.app_type}:${inst.instance_name}`;
            const label = `${this._appLabel(inst.app_type)} \u2013 ${inst.instance_name}`;
            const checked = selectedMemberKeys.includes(key) ? ' checked' : '';
            return `<label style="display:flex;align-items:center;gap:8px;padding:6px 0;color:#cbd5e1;font-size:13px;cursor:pointer;">
                <input type="checkbox" class="bundle-member-cb" value="${this._esc(key)}"${checked}>
                <span>${this._esc(label)}</span>
            </label>`;
        }).join('');
    },

    async _saveBundleFromModal(editBundleId) {
        const name = (document.getElementById('bundle-name-input')?.value || '').trim();
        const serviceType = document.getElementById('bundle-type-select')?.value || 'movies';
        const primaryKey = document.getElementById('bundle-primary-select')?.value || '';
        const memberCbs = document.querySelectorAll('.bundle-member-cb:checked');
        const memberKeys = Array.from(memberCbs).map(cb => cb.value);

        if (!name) { alert('Bundle name is required'); return; }
        if (!primaryKey) { alert('Primary instance is required'); return; }

        const parseCK = (ck) => {
            const idx = ck.indexOf(':');
            return { app_type: ck.substring(0, idx), instance_name: ck.substring(idx + 1) };
        };
        const primary = parseCK(primaryKey);
        const members = memberKeys.map(parseCK);

        const body = {
            name,
            service_type: serviceType,
            primary_app_type: primary.app_type,
            primary_instance_name: primary.instance_name,
            members,
        };

        try {
            const url = editBundleId
                ? `./api/requestarr/bundles/${editBundleId}`
                : './api/requestarr/bundles';
            const method = editBundleId ? 'PUT' : 'POST';
            const resp = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const data = await resp.json();
            if (data.success) {
                this.closeModal();
                await this.loadBundles();
                this.render();
                document.dispatchEvent(new CustomEvent('huntarr:instances-changed'));
            } else {
                alert(data.error || 'Failed to save bundle');
            }
        } catch (e) {
            console.error('[RequestarrServices] Error saving bundle:', e);
            alert('Failed to save bundle');
        }
    },

    async deleteBundle(bundleId) {
        const bundle = this.bundles.find(b => b.id === bundleId);
        const name = bundle ? bundle.name : `Bundle #${bundleId}`;
        if (window.HuntarrConfirm) {
            window.HuntarrConfirm.show({
                title: 'Delete Bundle',
                message: `Delete "${name}"? Instances will not be affected.`,
                confirmText: 'Delete',
                confirmClass: 'danger',
                onConfirm: () => this._doDeleteBundle(bundleId),
            });
        } else {
            if (confirm(`Delete bundle "${name}"?`)) {
                await this._doDeleteBundle(bundleId);
            }
        }
    },

    async _doDeleteBundle(bundleId) {
        try {
            const resp = await fetch(`./api/requestarr/bundles/${bundleId}`, { method: 'DELETE' });
            const data = await resp.json();
            if (data.success) {
                await this.loadBundles();
                this.render();
                document.dispatchEvent(new CustomEvent('huntarr:instances-changed'));
            }
        } catch (e) {
            console.error('[RequestarrServices] Error deleting bundle:', e);
        }
    },

    closeModal() {
        const overlay = document.getElementById('bundle-modal-overlay');
        if (overlay) overlay.remove();
    },

    _esc(str) {
        const d = document.createElement('div');
        d.textContent = str || '';
        return d.innerHTML;
    }
};

window.RequestarrServices = RequestarrServices;


/* === modules/features/requestarr/requestarr-requests.js === */
/**
 * Requestarr Requests Management Module
 * Admin view for listing, approving, denying, blacklisting, and deleting media requests.
 * Also handles the Global Blacklist page.
 */

window.RequestarrRequests = {
    requests: [],
    total: 0,
    // Global blacklist state
    _glBlacklistItems: [],
    _glBlacklistSearch: '',
    _glBlacklistTypeFilter: '',
    _glBlacklistPage: 1,
    _glBlacklistPageSize: 20,
    _glBlacklistInitialized: false,

    async init() {
        // For non-owner users, hide the filter controls (read-only view)
        if (window._huntarrUserRole && window._huntarrUserRole !== 'owner') {
            var filters = document.querySelector('.reqrequests-filters');
            if (filters) filters.style.display = 'none';
        }
        await this.loadRequests();
    },

    async loadRequests() {
        const container = document.getElementById('reqrequests-content');
        if (!container) return;

        const statusFilter = document.getElementById('reqrequests-status-filter');
        const typeFilter = document.getElementById('reqrequests-type-filter');
        const status = statusFilter ? statusFilter.value : '';
        const mediaType = typeFilter ? typeFilter.value : '';

        try {
            const params = new URLSearchParams();
            if (status) params.set('status', status);
            if (mediaType) params.set('media_type', mediaType);
            params.set('limit', '100');

            const resp = await fetch(`./api/requestarr/requests?${params}`, { cache: 'no-store' });
            if (!resp.ok) throw new Error('Failed to load requests');
            const data = await resp.json();
            this.requests = data.requests || [];
            this.total = data.total || 0;
            this.render();
        } catch (e) {
            console.error('[RequestarrRequests] Error:', e);
            container.innerHTML = '<p style="color:var(--error-color);padding:20px;">Failed to load requests.</p>';
        }
    },

    render() {
        const container = document.getElementById('reqrequests-content');
        if (!container) return;

        const isOwner = window._huntarrUserRole === 'owner';
        const emptyMsg = isOwner ? 'No requests found' : 'You haven\'t made any requests yet';

        if (!this.requests.length) {
            container.innerHTML = `<div class="reqrequests-empty">
                <i class="fas fa-inbox" style="font-size:2rem;color:var(--text-dim);margin-bottom:12px;"></i>
                <p style="color:var(--text-muted);">${emptyMsg}</p>
            </div>`;
            return;
        }

        const cards = this.requests.map(r => this._renderCard(r)).join('');
        container.innerHTML = `
            <div class="reqrequests-list">${cards}</div>
            <div class="requsers-pagination">
                <span>Showing ${this.requests.length} of ${this.total} request${this.total !== 1 ? 's' : ''}</span>
            </div>`;
    },

    _renderCard(req) {
        const posterUrl = req.poster_path
            ? (req.poster_path.startsWith('http') ? req.poster_path : `https://image.tmdb.org/t/p/w92${req.poster_path}`)
            : './static/images/blackout.jpg';
        const typeIcon = req.media_type === 'tv' ? 'fa-tv' : 'fa-film';
        const typeLabel = req.media_type === 'tv' ? 'TV' : 'Movie';
        const statusClass = `reqrequests-status-${req.status || 'pending'}`;
        const statusLabel = (req.status || 'pending').charAt(0).toUpperCase() + (req.status || 'pending').slice(1);
        const date = req.requested_at ? new Date(req.requested_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
        const respondedBy = req.responded_by ? `by ${this._esc(req.responded_by)}` : '';

        // Build additional requesters line
        let requestersHtml = '';
        if (req.all_requesters && req.all_requesters.length > 1) {
            const others = req.all_requesters
                .filter(r => r.username !== req.username)
                .map(r => this._esc(r.username));
            if (others.length > 0) {
                const demandLabel = req.all_requesters.length >= 3 ? ' <span class="reqrequests-demand">High demand</span>' : '';
                requestersHtml = `<div class="reqrequests-also"><i class="fas fa-users"></i> ${req.all_requesters.length} users requested${demandLabel} &mdash; also: ${others.join(', ')}</div>`;
            }
        }

        let actions = '';
        const isOwner = window._huntarrUserRole === 'owner';
        if (req.status === 'pending' && isOwner) {
            actions = `
                <button class="reqrequests-action-btn reqrequests-action-approve" onclick="RequestarrRequests.approveRequest(${req.id}, this)"><i class="fas fa-check"></i> Approve</button>
                <button class="reqrequests-action-btn reqrequests-action-deny" onclick="RequestarrRequests.denyRequest(${req.id}, this)"><i class="fas fa-times"></i> Deny</button>
                <button class="reqrequests-action-btn reqrequests-action-blacklist" onclick="RequestarrRequests.blacklistRequest(${req.id})" title="Blacklist"><i class="fas fa-ban"></i> Blacklist</button>`;
        }
        if (req.status === 'pending' && !isOwner) {
            actions = `<button class="reqrequests-action-btn reqrequests-action-withdraw" onclick="RequestarrRequests.withdrawRequest(${req.id}, this)"><i class="fas fa-undo"></i> Withdraw</button>`;
        }

        return `<div class="reqrequests-card" data-request-id="${req.id}">
            <img class="reqrequests-poster" src="${posterUrl}" alt="" onerror="this.src='./static/images/blackout.jpg'">
            <div class="reqrequests-info">
                <div class="reqrequests-title">${this._esc(req.title)}${req.year ? ` <span class="reqrequests-year">(${req.year})</span>` : ''}</div>
                <div class="reqrequests-meta">
                    <span class="reqrequests-type"><i class="fas ${typeIcon}"></i> ${typeLabel}</span>
                    <span class="reqrequests-user"><i class="fas fa-user"></i> ${this._esc(req.username || 'Unknown')}</span>
                    <span class="reqrequests-date"><i class="fas fa-clock"></i> ${date}</span>
                </div>
                ${requestersHtml}
                ${req.notes ? `<div class="reqrequests-notes"><i class="fas fa-comment"></i> ${this._esc(req.notes)}</div>` : ''}
            </div>
            <div class="reqrequests-right">
                <span class="reqrequests-status ${statusClass}">${statusLabel}${respondedBy ? ` ${respondedBy}` : ''}</span>
                <div class="reqrequests-actions">${actions}</div>
            </div>
        </div>`;
    },

    async approveRequest(requestId, btn) {
        // Instant feedback
        const card = document.querySelector(`.reqrequests-card[data-request-id="${requestId}"]`);
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Approving...'; }
        if (card) card.classList.add('reqrequests-card-processing');
        // Disable sibling buttons
        if (card) card.querySelectorAll('.reqrequests-action-btn').forEach(b => { if (b !== btn) b.disabled = true; });
        try {
            const resp = await fetch(`./api/requestarr/requests/${requestId}/approve`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });
            const data = await resp.json();
            if (data.success) {
                if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification('Request approved', 'success');
                await this.loadRequests();
                this._refreshBadge();
                // Sync card badges on discover/search pages — item is now in library
                const req = data.request;
                if (req && req.tmdb_id) {
                    const tmdbId = String(req.tmdb_id);
                    document.querySelectorAll(`.media-card[data-tmdb-id="${tmdbId}"]`).forEach(card => {
                        const badge = card.querySelector('.media-card-status-badge');
                        if (badge) {
                            badge.className = 'media-card-status-badge partial';
                            badge.innerHTML = '<i class="fas fa-bookmark"></i>';
                        }
                        card.classList.add('in-library');
                        // Swap hide → delete button
                        const hideBtn = card.querySelector('.media-card-hide-btn');
                        if (hideBtn) {
                            hideBtn.className = 'media-card-delete-btn';
                            hideBtn.title = 'Remove / Delete';
                            hideBtn.innerHTML = '<i class="fas fa-trash-alt"></i>';
                        }
                        const requestBtn = card.querySelector('.media-card-request-btn');
                        if (requestBtn) requestBtn.remove();
                    });
                }
            } else {
                if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification(data.error || 'Failed', 'error');
            }
        } catch (e) {
            console.error('[RequestarrRequests] Approve error:', e);
        }
    },

    async denyRequest(requestId, btn) {
        const notes = prompt('Reason for denial (optional):') || '';
        // Instant feedback
        const card = document.querySelector(`.reqrequests-card[data-request-id="${requestId}"]`);
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Denying...'; }
        if (card) card.classList.add('reqrequests-card-processing');
        if (card) card.querySelectorAll('.reqrequests-action-btn').forEach(b => { if (b !== btn) b.disabled = true; });
        try {
            const resp = await fetch(`./api/requestarr/requests/${requestId}/deny`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ notes })
            });
            const data = await resp.json();
            if (data.success) {
                if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification('Request denied', 'success');
                await this.loadRequests();
                this._refreshBadge();
            } else {
                if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification(data.error || 'Failed', 'error');
            }
        } catch (e) {
            console.error('[RequestarrRequests] Deny error:', e);
        }
    },

    async blacklistRequest(requestId) {
        const doBlacklist = async () => {
            try {
                const resp = await fetch(`./api/requestarr/requests/${requestId}/blacklist`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({})
                });
                const data = await resp.json();
                if (data.success) {
                    if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification('Request blacklisted — added to Global Blacklist', 'success');
                    await this.loadRequests();
                    this._refreshBadge();
                } else {
                    if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification(data.error || 'Failed', 'error');
                }
            } catch (e) {
                console.error('[RequestarrRequests] Blacklist error:', e);
            }
        };

        if (window.HuntarrConfirmModal && typeof window.HuntarrConfirmModal.show === 'function') {
            window.HuntarrConfirmModal.show({
                title: 'Blacklist Request',
                message: 'This will deny the request and add the media to the Global Blacklist. No user will be able to request it again.',
                confirmText: 'Blacklist',
                confirmClass: 'danger',
                onConfirm: () => doBlacklist(),
            });
        } else if (window.HuntarrConfirm && typeof window.HuntarrConfirm.show === 'function') {
            window.HuntarrConfirm.show({
                title: 'Blacklist Request',
                message: 'This will deny the request and add the media to the Global Blacklist.<br>No user will be able to request it again.',
                confirmLabel: 'Blacklist',
                onConfirm: () => doBlacklist(),
            });
        } else {
            if (confirm('Blacklist this request? No user will be able to request it again.')) await doBlacklist();
        }
    },

    async withdrawRequest(requestId, btn) {
        const card = document.querySelector(`.reqrequests-card[data-request-id="${requestId}"]`);
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Withdrawing...'; }
        if (card) card.classList.add('reqrequests-card-processing');
        try {
            const resp = await fetch(`./api/requestarr/requests/${requestId}/withdraw`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });
            const data = await resp.json();
            if (data.success) {
                if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification('Request withdrawn', 'success');
                await this.loadRequests();
                this._refreshBadge();
            } else {
                if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification(data.error || 'Failed', 'error');
            }
        } catch (e) {
            console.error('[RequestarrRequests] Withdraw error:', e);
        }
    },

    async deleteRequest(requestId) {
        if (window.HuntarrConfirmModal && typeof window.HuntarrConfirmModal.show === 'function') {
            window.HuntarrConfirmModal.show({
                title: 'Delete Request',
                message: 'Are you sure you want to delete this request?',
                confirmText: 'Delete',
                confirmClass: 'danger',
                onConfirm: () => this._doDelete(requestId),
            });
        } else {
            if (confirm('Delete this request?')) await this._doDelete(requestId);
        }
    },

    async _doDelete(requestId) {
        try {
            const resp = await fetch(`./api/requestarr/requests/${requestId}`, { method: 'DELETE' });
            const data = await resp.json();
            if (data.success) {
                if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification('Request deleted', 'success');
                await this.loadRequests();
                this._refreshBadge();
            } else {
                if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification(data.error || 'Failed', 'error');
            }
        } catch (e) {
            console.error('[RequestarrRequests] Delete error:', e);
        }
    },

    _refreshBadge() {
        if (window.huntarrUI && typeof window.huntarrUI._updatePendingRequestBadge === 'function') {
            window.huntarrUI._updatePendingRequestBadge();
        }
    },

    _esc(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },

    // ========================================
    // GLOBAL BLACKLIST PAGE
    // ========================================

    async initGlobalBlacklist() {
        if (!this._glBlacklistInitialized) {
            this._setupGlobalBlacklistControls();
            this._glBlacklistInitialized = true;
        }
        await this._loadGlobalBlacklist();
    },

    _setupGlobalBlacklistControls() {
        const searchInput = document.getElementById('global-blacklist-search');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                clearTimeout(this._glSearchTimeout);
                this._glSearchTimeout = setTimeout(() => {
                    this._glBlacklistSearch = (e.target.value || '').trim();
                    this._glBlacklistPage = 1;
                    this._renderGlobalBlacklistPage();
                }, 200);
            });
        }
        const typeFilter = document.getElementById('global-blacklist-type-filter');
        if (typeFilter) {
            typeFilter.addEventListener('change', () => {
                this._glBlacklistTypeFilter = typeFilter.value || '';
                this._glBlacklistPage = 1;
                this._glBlacklistFetchKey = null;
                this._loadGlobalBlacklist();
            });
        }
    },

    async _loadGlobalBlacklist() {
        const container = document.getElementById('global-blacklist-grid');
        if (!container) return;

        container.style.display = 'grid';
        container.style.alignItems = '';
        container.style.justifyContent = '';
        container.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Loading global blacklist...</p></div>';

        try {
            const params = new URLSearchParams();
            if (this._glBlacklistTypeFilter) params.set('media_type', this._glBlacklistTypeFilter);
            params.set('page', '1');
            params.set('page_size', '500');

            const resp = await fetch(`./api/requestarr/requests/global-blacklist?${params}`, { cache: 'no-store' });
            if (!resp.ok) throw new Error('Failed to load global blacklist');
            const data = await resp.json();
            this._glBlacklistItems = data.items || [];
            this._renderGlobalBlacklistPage();
        } catch (e) {
            console.error('[RequestarrRequests] Global blacklist error:', e);
            container.innerHTML = '<p style="color:var(--error-color);padding:20px;">Failed to load global blacklist.</p>';
        }
    },

    _getFilteredBlacklistItems() {
        const query = (this._glBlacklistSearch || '').toLowerCase();
        let items = this._glBlacklistItems.slice();
        if (query) {
            items = items.filter(i => (i.title || '').toLowerCase().includes(query));
        }
        items.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
        return items;
    },

    _renderGlobalBlacklistPage() {
        const container = document.getElementById('global-blacklist-grid');
        const paginationContainer = document.getElementById('global-blacklist-pagination');
        if (!container || !paginationContainer) return;

        const filtered = this._getFilteredBlacklistItems();
        const pageSize = this._glBlacklistPageSize;
        const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));

        if (this._glBlacklistPage > totalPages) this._glBlacklistPage = 1;

        const startIndex = (this._glBlacklistPage - 1) * pageSize;
        const pageItems = filtered.slice(startIndex, startIndex + pageSize);

        if (pageItems.length > 0) {
            container.style.display = 'grid';
            container.style.alignItems = '';
            container.style.justifyContent = '';
            container.innerHTML = '';
            pageItems.forEach(item => {
                container.appendChild(this._createBlacklistCard(item));
            });

            if (totalPages > 1) {
                paginationContainer.style.display = 'flex';
                document.getElementById('global-blacklist-page-info').textContent = `Page ${this._glBlacklistPage} of ${totalPages}`;
                document.getElementById('global-blacklist-prev-page').disabled = this._glBlacklistPage === 1;
                document.getElementById('global-blacklist-next-page').disabled = this._glBlacklistPage === totalPages;
            } else {
                paginationContainer.style.display = 'none';
            }
        } else {
            container.style.display = 'flex';
            container.style.alignItems = 'center';
            container.style.justifyContent = 'center';
            container.innerHTML = `
                <div style="text-align: center; color: #9ca3af; max-width: 600px;">
                    <i class="fas fa-ban" style="font-size: 64px; margin-bottom: 30px; opacity: 0.4; display: block;"></i>
                    <p style="font-size: 20px; margin-bottom: 15px; font-weight: 500; white-space: nowrap;">No Blacklisted Media</p>
                    <p style="font-size: 15px; line-height: 1.6; opacity: 0.8;">The global blacklist is empty. Blacklisted items cannot be requested by any user.</p>
                </div>
            `;
            paginationContainer.style.display = 'none';
        }

        this._setupGlobalBlacklistPagination(totalPages);
    },

    _setupGlobalBlacklistPagination(totalPages) {
        const prevBtn = document.getElementById('global-blacklist-prev-page');
        const nextBtn = document.getElementById('global-blacklist-next-page');
        if (!prevBtn || !nextBtn) return;

        prevBtn.onclick = () => {
            if (this._glBlacklistPage > 1) {
                this._glBlacklistPage -= 1;
                this._renderGlobalBlacklistPage();
            }
        };
        nextBtn.onclick = () => {
            if (this._glBlacklistPage < totalPages) {
                this._glBlacklistPage += 1;
                this._renderGlobalBlacklistPage();
            }
        };
    },

    _createBlacklistCard(item) {
        const card = document.createElement('div');
        card.className = 'media-card';
        card.setAttribute('data-tmdb-id', item.tmdb_id);
        card.setAttribute('data-media-type', item.media_type);

        const posterUrl = item.poster_path
            ? (item.poster_path.startsWith('http') ? item.poster_path : `https://image.tmdb.org/t/p/w185${item.poster_path}`)
            : './static/images/blackout.jpg';
        const typeBadgeLabel = item.media_type === 'tv' ? 'TV' : 'Movie';

        card.innerHTML = `
            <div class="media-card-poster">
                <button class="media-card-unhide-btn" title="Remove from Global Blacklist"><i class="fas fa-undo-alt"></i></button>
                <img src="${posterUrl}" alt="${this._esc(item.title)}" onerror="this.src='./static/images/blackout.jpg'">
                <span class="media-type-badge">${typeBadgeLabel}</span>
            </div>
        `;

        // Cache image in background
        if (posterUrl && !posterUrl.includes('./static/images/') && window.getCachedTMDBImage && window.tmdbImageCache) {
            const imgEl = card.querySelector('.media-card-poster img');
            if (imgEl) {
                window.getCachedTMDBImage(posterUrl, window.tmdbImageCache).then(cachedUrl => {
                    if (cachedUrl && cachedUrl !== posterUrl) imgEl.src = cachedUrl;
                }).catch(() => {});
            }
        }

        const removeBtn = card.querySelector('.media-card-unhide-btn');
        if (removeBtn) {
            removeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this._removeFromGlobalBlacklist(item.tmdb_id, item.media_type, item.title);
            });
        }

        return card;
    },

    async _removeFromGlobalBlacklist(tmdbId, mediaType, title) {
        const self = this;
        const doRemove = async () => {
            try {
                const resp = await fetch(`./api/requestarr/requests/global-blacklist/${tmdbId}/${mediaType}`, { method: 'DELETE' });
                const data = await resp.json();
                if (data.success) {
                    self._glBlacklistItems = self._glBlacklistItems.filter(i => !(i.tmdb_id === tmdbId && i.media_type === mediaType));
                    self._renderGlobalBlacklistPage();
                    if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification('Removed from Global Blacklist', 'success');
                } else {
                    if (window.HuntarrNotifications) window.HuntarrNotifications.showNotification(data.error || 'Failed', 'error');
                }
            } catch (e) {
                console.error('[RequestarrRequests] Remove blacklist error:', e);
            }
        };

        if (window.HuntarrConfirm && typeof window.HuntarrConfirm.show === 'function') {
            window.HuntarrConfirm.show({
                title: 'Remove from Global Blacklist',
                message: `Remove "${this._esc(title)}" from the Global Blacklist?<br><br>Users will be able to request this media again.`,
                confirmLabel: 'Remove',
                onConfirm: () => doRemove(),
            });
        } else {
            if (confirm(`Remove "${title}" from the Global Blacklist?`)) await doRemove();
        }
    },
};
