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

        const resp = await fetch(`./api/requestarr/smarthunt?${params.toString()}`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();

        return data.results || [];
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
