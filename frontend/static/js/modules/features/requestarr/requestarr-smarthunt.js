/**
 * Smart Hunt — shared carousel component used on Home and Discover pages.
 *
 * Usage:
 *   import { SmartHunt } from './requestarr-smarthunt.js';
 *   const sh = new SmartHunt({ carouselId: 'home-smarthunt-carousel', core: coreRef });
 *   sh.load();
 */

// ---------------------------------------------------------------------------
// Cache helpers  (localStorage, 1-hour TTL — invalidated on settings save)
// ---------------------------------------------------------------------------

const SH_CACHE_PREFIX = 'huntarr-smarthunt-page-';
const SH_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function getCachedPage(page) {
    try {
        const raw = localStorage.getItem(`${SH_CACHE_PREFIX}${page}`);
        if (!raw) return null;
        const { results, timestamp } = JSON.parse(raw);
        if (Date.now() - (timestamp || 0) > SH_CACHE_TTL_MS) return null;
        return Array.isArray(results) ? results : null;
    } catch (e) {
        return null;
    }
}

function setCachedPage(page, results) {
    try {
        localStorage.setItem(
            `${SH_CACHE_PREFIX}${page}`,
            JSON.stringify({ results, timestamp: Date.now() }),
        );
    } catch (e) {
        // quota exceeded — ignore
    }
}

export function invalidateSmartHuntCache() {
    try {
        for (let i = 1; i <= 5; i++) {
            localStorage.removeItem(`${SH_CACHE_PREFIX}${i}`);
        }
    } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------------------
// SmartHunt class
// ---------------------------------------------------------------------------

export class SmartHunt {
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
        invalidateSmartHuntCache();
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

        // Try cache first
        const cached = getCachedPage(page);
        if (cached !== null) {
            this._render(cached, append);
            this.currentPage = page;
            this.hasMore = page < 5 && cached.length > 0;
            this.isLoading = false;
            // Background refresh
            this._fetchAndCache(page, append);
            return;
        }

        try {
            const results = await this._fetchPage(page);
            setCachedPage(page, results);
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

    async _fetchAndCache(page) {
        try {
            const results = await this._fetchPage(page);
            setCachedPage(page, results);
        } catch (e) {
            // background — ignore
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

        const params = new URLSearchParams({
            page: String(page),
            movie_app_type: movieAppType,
            movie_instance_name: movieName,
            tv_instance_name: tvInst || '',
        });

        const resp = await fetch(`./api/requestarr/smarthunt?${params.toString()}`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();

        if (data.enabled === false) {
            this.hasMore = false;
            return [];
        }

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
