/**
 * Media Hunt Filters - Filter management for Media Hunt discover (movie mode).
 * Uses media-hunt-* element IDs; calls window.MediaHunt.loadMovies(1) on apply.
 * Exposed as MediaHuntFilters and MovieHuntFilters for compatibility.
 */
(function() {
    'use strict';

    const currentYear = new Date().getFullYear();
    const maxYear = currentYear + 3;
    const minYear = 1900;

    const activeFilters = {
        genres: [],
        yearMin: minYear,
        yearMax: maxYear,
        runtimeMin: 0,
        runtimeMax: 400,
        ratingMin: 0,
        ratingMax: 10,
        votesMin: 0,
        votesMax: 10000,
        hideAvailable: false
    };
    let genres = [];
    let inited = false;

    function el(id) {
        return document.getElementById(id);
    }

    function loadGenres() {
        return Promise.all([
            fetch('./api/requestarr/genres/movie'),
            fetch('./api/requestarr/settings/blacklisted-genres')
        ]).then(function(responses) {
            return Promise.all([responses[0].json(), responses[1].json()]);
        }).then(function(data) {
            const blacklistedIds = (data[1].blacklisted_movie_genres || []).map(function(id) { return parseInt(id, 10); });
            if (data[0].genres) {
                genres = data[0].genres.filter(function(g) { return blacklistedIds.indexOf(g.id) === -1; });
            } else {
                genres = [
                    { id: 28, name: 'Action' }, { id: 12, name: 'Adventure' }, { id: 16, name: 'Animation' },
                    { id: 35, name: 'Comedy' }, { id: 80, name: 'Crime' }, { id: 99, name: 'Documentary' },
                    { id: 18, name: 'Drama' }, { id: 10751, name: 'Family' }, { id: 14, name: 'Fantasy' },
                    { id: 36, name: 'History' }, { id: 27, name: 'Horror' }, { id: 10402, name: 'Music' },
                    { id: 9648, name: 'Mystery' }, { id: 10749, name: 'Romance' }, { id: 878, name: 'Science Fiction' },
                    { id: 10770, name: 'TV Movie' }, { id: 53, name: 'Thriller' }, { id: 10752, name: 'War' },
                    { id: 37, name: 'Western' }
                ];
            }
            populateGenresSelect();
        }).catch(function(err) {
            console.error('[MediaHuntFilters] Error loading genres:', err);
            genres = [
                { id: 28, name: 'Action' }, { id: 12, name: 'Adventure' }, { id: 35, name: 'Comedy' },
                { id: 18, name: 'Drama' }, { id: 27, name: 'Horror' }, { id: 10749, name: 'Romance' },
                { id: 878, name: 'Science Fiction' }, { id: 53, name: 'Thriller' }
            ];
            populateGenresSelect();
        });
    }

    function populateGenresSelect() {
        const list = el('media-hunt-genre-list');
        if (!list) return;
        list.innerHTML = '';
        genres.forEach(function(genre) {
            const item = document.createElement('div');
            item.className = 'genre-item';
            item.textContent = genre.name;
            item.dataset.genreId = genre.id;
            if (activeFilters.genres.indexOf(genre.id) !== -1) item.classList.add('selected');
            item.addEventListener('click', function() {
                const genreId = parseInt(item.dataset.genreId, 10);
                const idx = activeFilters.genres.indexOf(genreId);
                if (idx > -1) {
                    activeFilters.genres.splice(idx, 1);
                    item.classList.remove('selected');
                } else {
                    activeFilters.genres.push(genreId);
                    item.classList.add('selected');
                }
                renderSelectedGenres();
                updateModalFilterCount();
                autoApplyFilters();
                const dropdown = el('media-hunt-genre-dropdown');
                if (dropdown) dropdown.style.display = 'none';
            });
            list.appendChild(item);
        });
    }

    function renderSelectedGenres() {
        const container = el('media-hunt-selected-genres');
        if (!container) return;
        container.innerHTML = '';
        if (activeFilters.genres.length === 0) {
            container.style.display = 'none';
            return;
        }
        container.style.display = 'flex';
        activeFilters.genres.forEach(function(genreId) {
            const genre = genres.find(function(g) { return g.id === genreId; });
            if (!genre) return;
            const pill = document.createElement('div');
            pill.className = 'selected-genre-pill';
            const text = document.createElement('span');
            text.textContent = genre.name;
            const remove = document.createElement('span');
            remove.className = 'remove-genre';
            remove.innerHTML = '×';
            remove.addEventListener('click', function(e) {
                e.stopPropagation();
                const idx = activeFilters.genres.indexOf(genreId);
                if (idx > -1) activeFilters.genres.splice(idx, 1);
                renderSelectedGenres();
                updateModalFilterCount();
                autoApplyFilters();
                const items = document.querySelectorAll('#media-hunt-genre-list .genre-item');
                items.forEach(function(it) {
                    if (parseInt(it.dataset.genreId, 10) === genreId) it.classList.remove('selected');
                });
            });
            pill.appendChild(text);
            pill.appendChild(remove);
            container.appendChild(pill);
        });
    }

    function updateSliderRange(type, minInput, maxInput) {
        const rangeEl = el('media-hunt-' + type + '-range');
        if (!rangeEl) return;
        const min = parseFloat(minInput.value);
        const max = parseFloat(maxInput.value);
        const minVal = parseFloat(minInput.min);
        const maxVal = parseFloat(minInput.max);
        const percentMin = ((min - minVal) / (maxVal - minVal)) * 100;
        const percentMax = ((max - minVal) / (maxVal - minVal)) * 100;
        rangeEl.style.left = percentMin + '%';
        rangeEl.style.width = (percentMax - percentMin) + '%';
    }

    function updateYearDisplay() {
        const minInput = el('media-hunt-filter-year-min');
        const maxInput = el('media-hunt-filter-year-max');
        if (!minInput || !maxInput) return;
        let min = parseInt(minInput.value, 10);
        let max = parseInt(maxInput.value, 10);
        if (min > max) { var t = min; min = max; max = t; }
        const display = el('media-hunt-year-display');
        if (display) display.textContent = 'Movies from ' + min + ' to ' + max;
    }
    function updateRuntimeDisplay() {
        const minInput = el('media-hunt-filter-runtime-min');
        const maxInput = el('media-hunt-filter-runtime-max');
        if (!minInput || !maxInput) return;
        let min = parseInt(minInput.value, 10);
        let max = parseInt(maxInput.value, 10);
        if (min > max) { var t = min; min = max; max = t; }
        const display = el('media-hunt-runtime-display');
        if (display) display.textContent = min + '-' + max + ' minute runtime';
    }
    function updateRatingDisplay() {
        const minInput = el('media-hunt-filter-rating-min');
        const maxInput = el('media-hunt-filter-rating-max');
        if (!minInput || !maxInput) return;
        let min = parseFloat(minInput.value);
        let max = parseFloat(maxInput.value);
        if (min > max) { var t = min; min = max; max = t; }
        const display = el('media-hunt-rating-display');
        if (display) display.textContent = 'Ratings between ' + min.toFixed(1) + ' and ' + max.toFixed(1);
    }
    function updateVotesDisplay() {
        const minInput = el('media-hunt-filter-votes-min');
        const maxInput = el('media-hunt-filter-votes-max');
        if (!minInput || !maxInput) return;
        let min = parseInt(minInput.value, 10);
        let max = parseInt(maxInput.value, 10);
        if (min > max) { var t = min; min = max; max = t; }
        const display = el('media-hunt-votes-display');
        if (display) display.textContent = 'Number of votes between ' + min + ' and ' + max;
    }

    function updateFilterDisplay() {
        let count = 0;
        if (activeFilters.genres.length > 0) count++;
        if (activeFilters.yearMin > minYear || activeFilters.yearMax < maxYear) count++;
        if (activeFilters.runtimeMin > 0 || activeFilters.runtimeMax < 400) count++;
        if (activeFilters.ratingMin > 0 || activeFilters.ratingMax < 10) count++;
        if (activeFilters.votesMin > 0 || activeFilters.votesMax < 10000) count++;
        if (activeFilters.hideAvailable) count++;
        const countEl = el('media-hunt-filter-count');
        const text = count === 0 ? '0 Active Filters' : count === 1 ? '1 Active Filter' : count + ' Active Filters';
        if (countEl) countEl.textContent = text;
        updateModalFilterCount();
    }

    function updateModalFilterCount() {
        let count = 0;
        if (activeFilters.genres.length > 0) count++;
        if (activeFilters.yearMin > minYear || activeFilters.yearMax < maxYear) count++;
        if (activeFilters.runtimeMin > 0 || activeFilters.runtimeMax < 400) count++;
        if (activeFilters.ratingMin > 0 || activeFilters.ratingMax < 10) count++;
        if (activeFilters.votesMin > 0 || activeFilters.votesMax < 10000) count++;
        if (activeFilters.hideAvailable) count++;
        const countEl = el('media-hunt-filter-active-count');
        const text = count === 0 ? '0 Active Filters' : count === 1 ? '1 Active Filter' : count + ' Active Filters';
        if (countEl) countEl.textContent = text;
    }

    function loadFilterValues() {
        const yearMin = el('media-hunt-filter-year-min');
        const yearMax = el('media-hunt-filter-year-max');
        const runtimeMin = el('media-hunt-filter-runtime-min');
        const runtimeMax = el('media-hunt-filter-runtime-max');
        const ratingMin = el('media-hunt-filter-rating-min');
        const ratingMax = el('media-hunt-filter-rating-max');
        const votesMin = el('media-hunt-filter-votes-min');
        const votesMax = el('media-hunt-filter-votes-max');
        const hideAvailable = el('media-hunt-hide-available-movies');
        if (yearMin) yearMin.value = activeFilters.yearMin;
        if (yearMax) yearMax.value = activeFilters.yearMax;
        if (runtimeMin) runtimeMin.value = activeFilters.runtimeMin;
        if (runtimeMax) runtimeMax.value = activeFilters.runtimeMax;
        if (ratingMin) ratingMin.value = activeFilters.ratingMin;
        if (ratingMax) ratingMax.value = activeFilters.ratingMax;
        if (votesMin) votesMin.value = activeFilters.votesMin;
        if (votesMax) votesMax.value = activeFilters.votesMax;
        if (hideAvailable) hideAvailable.checked = activeFilters.hideAvailable;
        renderSelectedGenres();
        var items = document.querySelectorAll('#media-hunt-genre-list .genre-item');
        items.forEach(function(item) {
            var genreId = parseInt(item.dataset.genreId, 10);
            if (activeFilters.genres.indexOf(genreId) !== -1) item.classList.add('selected');
            else item.classList.remove('selected');
        });
        updateYearDisplay();
        updateRuntimeDisplay();
        updateRatingDisplay();
        updateVotesDisplay();
        updateModalFilterCount();
    }

    function autoApplyFilters() {
        var yearMinEl = el('media-hunt-filter-year-min');
        var yearMaxEl = el('media-hunt-filter-year-max');
        var runtimeMinEl = el('media-hunt-filter-runtime-min');
        var runtimeMaxEl = el('media-hunt-filter-runtime-max');
        var ratingMinEl = el('media-hunt-filter-rating-min');
        var ratingMaxEl = el('media-hunt-filter-rating-max');
        var votesMinEl = el('media-hunt-filter-votes-min');
        var votesMaxEl = el('media-hunt-filter-votes-max');
        var yearMin = yearMinEl ? parseInt(yearMinEl.value, 10) : minYear;
        var yearMax = yearMaxEl ? parseInt(yearMaxEl.value, 10) : maxYear;
        var runtimeMin = runtimeMinEl ? parseInt(runtimeMinEl.value, 10) : 0;
        var runtimeMax = runtimeMaxEl ? parseInt(runtimeMaxEl.value, 10) : 400;
        var ratingMin = ratingMinEl ? parseFloat(ratingMinEl.value) : 0;
        var ratingMax = ratingMaxEl ? parseFloat(ratingMaxEl.value) : 10;
        var votesMin = votesMinEl ? parseInt(votesMinEl.value, 10) : 0;
        var votesMax = votesMaxEl ? parseInt(votesMaxEl.value, 10) : 10000;
        if (yearMin > yearMax) { var t = yearMin; yearMin = yearMax; yearMax = t; }
        if (runtimeMin > runtimeMax) { var t = runtimeMin; runtimeMin = runtimeMax; runtimeMax = t; }
        if (ratingMin > ratingMax) { var t = ratingMin; ratingMin = ratingMax; ratingMax = t; }
        if (votesMin > votesMax) { var t = votesMin; votesMin = votesMax; votesMax = t; }
        activeFilters.yearMin = yearMin;
        activeFilters.yearMax = yearMax;
        activeFilters.runtimeMin = runtimeMin;
        activeFilters.runtimeMax = runtimeMax;
        activeFilters.ratingMin = ratingMin;
        activeFilters.ratingMax = ratingMax;
        activeFilters.votesMin = votesMin;
        activeFilters.votesMax = votesMax;
        updateFilterDisplay();
        if (window.MovieHunt && window.MediaHunt.loadMovies) {
            window.MovieHunt.page = 1;
            window.MovieHunt.hasMore = true;
            window.MediaHunt.loadMovies(1);
        }
    }

    function openFiltersModal() {
        var modal = el('media-hunt-filter-modal');
        if (!modal) return;
        // Move modal to body so it isn't clipped by #media-hunt-section (same as Requestarr / request modal)
        if (modal.parentNode !== document.body) {
            document.body.appendChild(modal);
        }
        loadFilterValues();
        modal.style.display = 'flex';
        setTimeout(function() { modal.classList.add('show'); }, 10);
        document.body.style.overflow = 'hidden';
    }

    function closeFiltersModal() {
        var modal = el('media-hunt-filter-modal');
        if (modal) {
            modal.classList.remove('show');
            setTimeout(function() {
                modal.style.display = 'none';
                document.body.style.overflow = '';
            }, 150);
        }
    }

    function clearFilters() {
        activeFilters.genres = [];
        activeFilters.yearMin = minYear;
        activeFilters.yearMax = maxYear;
        activeFilters.runtimeMin = 0;
        activeFilters.runtimeMax = 400;
        activeFilters.ratingMin = 0;
        activeFilters.ratingMax = 10;
        activeFilters.votesMin = 0;
        activeFilters.votesMax = 10000;
        activeFilters.hideAvailable = false;
        var sortSelect = el('media-hunt-sort');
        if (sortSelect) sortSelect.value = 'popularity.desc';
        updateFilterDisplay();
        loadFilterValues();
        closeFiltersModal();
        if (window.MovieHunt && window.MediaHunt.loadMovies) {
            window.MovieHunt.page = 1;
            window.MovieHunt.hasMore = true;
            window.MediaHunt.loadMovies(1);
        }
    }

    function getFilterParams() {
        var params = new URLSearchParams();
        var sortSelect = el('media-hunt-sort');
        params.append('sort_by', (sortSelect && sortSelect.value) ? sortSelect.value : 'popularity.desc');
        if (activeFilters.genres.length > 0) params.append('with_genres', activeFilters.genres.join(','));
        if (activeFilters.yearMin > minYear) params.append('release_date.gte', activeFilters.yearMin + '-01-01');
        if (activeFilters.yearMax < maxYear) params.append('release_date.lte', activeFilters.yearMax + '-12-31');
        if (activeFilters.runtimeMin > 0 || activeFilters.runtimeMax < 400) {
            params.append('with_runtime.gte', activeFilters.runtimeMin);
            params.append('with_runtime.lte', activeFilters.runtimeMax);
        }
        if (activeFilters.ratingMin > 0 || activeFilters.ratingMax < 10) {
            params.append('vote_average.gte', activeFilters.ratingMin);
            params.append('vote_average.lte', activeFilters.ratingMax);
        }
        if (activeFilters.votesMin > 0 || activeFilters.votesMax < 10000) {
            params.append('vote_count.gte', activeFilters.votesMin);
            params.append('vote_count.lte', activeFilters.votesMax);
        }
        if (activeFilters.hideAvailable) params.append('hide_available', 'true');
        return params.toString();
    }

    function setupEventListeners() {
        var backdrop = el('media-hunt-filter-backdrop');
        var closeBtn = el('media-hunt-filter-close');
        if (backdrop) backdrop.addEventListener('click', closeFiltersModal);
        if (closeBtn) closeBtn.addEventListener('click', closeFiltersModal);

        var hideAvailable = el('media-hunt-hide-available-movies');
        if (hideAvailable) {
            hideAvailable.addEventListener('change', function(e) {
                activeFilters.hideAvailable = e.target.checked;
                updateModalFilterCount();
                autoApplyFilters();
            });
        }

        var genreInput = el('media-hunt-genre-search-input');
        var genreDropdown = el('media-hunt-genre-dropdown');
        if (genreInput && genreDropdown) {
            genreInput.addEventListener('click', function(e) {
                e.stopPropagation();
                genreDropdown.style.display = genreDropdown.style.display === 'block' ? 'none' : 'block';
            });
            document.addEventListener('click', function(e) {
                if (!genreDropdown.contains(e.target) && e.target !== genreInput) genreDropdown.style.display = 'none';
            });
            genreDropdown.addEventListener('click', function(e) { e.stopPropagation(); });
        }

        function bindRange(type, updateDisplayFn) {
            var minInput = el('media-hunt-filter-' + type + '-min');
            var maxInput = el('media-hunt-filter-' + type + '-max');
            if (!minInput || !maxInput) return;
            minInput.addEventListener('input', function() {
                if (parseFloat(minInput.value) > parseFloat(maxInput.value)) minInput.value = maxInput.value;
                updateDisplayFn();
                updateModalFilterCount();
            });
            minInput.addEventListener('change', autoApplyFilters);
            maxInput.addEventListener('input', function() {
                if (parseFloat(maxInput.value) < parseFloat(minInput.value)) maxInput.value = minInput.value;
                updateDisplayFn();
                updateModalFilterCount();
            });
            maxInput.addEventListener('change', autoApplyFilters);
            updateSliderRange(type, minInput, maxInput);
        }
        bindRange('year', updateYearDisplay);
        bindRange('runtime', updateRuntimeDisplay);
        bindRange('rating', updateRatingDisplay);
        bindRange('votes', updateVotesDisplay);

        var yearMin = el('media-hunt-filter-year-min');
        var yearMax = el('media-hunt-filter-year-max');
        if (yearMin && yearMax) {
            yearMin.max = maxYear;
            yearMin.value = minYear;
            yearMax.max = maxYear;
            yearMax.value = maxYear;
            updateYearDisplay();
            updateSliderRange('year', yearMin, yearMax);
        }
    }

    function init() {
        if (inited) return;
        inited = true;
        loadGenres().then(function() {
            setupEventListeners();
            updateFilterDisplay();
        });
    }

    window.MovieHuntFilters = window.MediaHuntFilters = {
        init: init,
        openFiltersModal: openFiltersModal,
        closeFiltersModal: closeFiltersModal,
        getFilterParams: getFilterParams,
        updateFilterDisplay: updateFilterDisplay,
        clearFilters: clearFilters
    };
})();
