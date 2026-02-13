/**
 * Requestarr TV Detail Page – TV Hunt (full page) + Sonarr (limited top bar)
 * Mirrors requestarr-detail.js behavior for movies
 */
(function() {
    'use strict';

    function _encodeInstanceValue(appType, name) {
        return window.MediaUtils ? window.MediaUtils.encodeInstanceValue(appType, name) : (appType + ':' + name);
    }
    function _decodeInstanceValue(value) {
        return window.MediaUtils ? window.MediaUtils.decodeInstanceValue(value, 'sonarr') : { appType: 'sonarr', name: (value || '').split(':')[1] || '' };
    }

    window.RequestarrTVDetail = {
        currentSeries: null,
        tvInstances: [],  // TV Hunt + Sonarr
        selectedInstanceName: null,

        init() {
            window.addEventListener('popstate', (e) => {
                if (e.state && e.state.requestarrTVDetail) {
                    this.openDetail(e.state.requestarrTVDetail, e.state.options || {}, true);
                } else {
                    this.closeDetail(true);
                }
            });

            window.addEventListener('hashchange', () => {
                if (!/^#requestarr-tv\//.test(window.location.hash || '')) {
                    this.closeDetail(true);
                }
            });
        },

        async openDetail(series, options = {}, fromHistory = false) {
            if (!series) return;

            this.currentSeries = series;
            this.options = options || {};
            const tmdbId = series.tmdb_id || series.id;

            if (this.tvInstances.length === 0) {
                await this.loadTVInstances();
            }

            let detailView = document.getElementById('requestarr-tv-detail-view');
            if (!detailView) {
                detailView = document.createElement('div');
                detailView.id = 'requestarr-tv-detail-view';
                detailView.className = 'movie-detail-view';
                document.body.appendChild(detailView);
            }

            detailView.innerHTML = this.getLoadingHTML();
            detailView.classList.add('active');

            if (!fromHistory) {
                const url = `${window.location.pathname}${window.location.search}#requestarr-tv/${tmdbId}`;
                history.pushState({ requestarrTVDetail: series, options: this.options }, series.title || series.name, url);
            }

            setTimeout(() => {
                const backBtn = document.getElementById('requestarr-tv-detail-back-loading');
                if (backBtn) backBtn.addEventListener('click', () => this.closeDetail());
            }, 0);

            try {
                const details = await this.fetchSeriesDetails(tmdbId);
                if (details) {
                    detailView.innerHTML = this.renderTVDetail(details, series);
                    this.setupDetailInteractions();
                } else {
                    detailView.innerHTML = this.getErrorHTML('Failed to load series details');
                    this.setupErrorBackButton();
                }
            } catch (error) {
                console.error('[RequestarrTVDetail] Error:', error);
                detailView.innerHTML = this.getErrorHTML('Failed to load series details');
                this.setupErrorBackButton();
            }
        },

        closeDetail(fromHistory = false) {
            const detailView = document.getElementById('requestarr-tv-detail-view');
            if (detailView) detailView.classList.remove('active');

            if (this._escHandler) {
                document.removeEventListener('keydown', this._escHandler);
                this._escHandler = null;
            }

            if (!fromHistory && /^#requestarr-tv\//.test(window.location.hash || '')) {
                history.back();
            }
        },

        async fetchSeriesDetails(tmdbId) {
            try {
                const response = await fetch(`./api/tv-hunt/series/${tmdbId}`);
                if (!response.ok) return null;
                return await response.json();
            } catch (e) {
                console.error('[RequestarrTVDetail] Fetch error:', e);
                return null;
            }
        },

        async loadTVInstances() {
            try {
                const [tvHuntRes, sonarrRes] = await Promise.all([
                    fetch('./api/requestarr/instances/tv_hunt'),
                    fetch('./api/requestarr/instances/sonarr')
                ]);
                const tvHuntData = await tvHuntRes.json();
                const sonarrData = await sonarrRes.json();

                const combined = [];
                if (tvHuntData.instances) {
                    tvHuntData.instances.forEach(inst => {
                        combined.push({
                            name: inst.name,
                            id: inst.id,
                            appType: 'tv_hunt',
                            compoundValue: _encodeInstanceValue('tv_hunt', inst.name),
                            label: 'TV Hunt – ' + inst.name
                        });
                    });
                }
                if (sonarrData.instances) {
                    sonarrData.instances.forEach(inst => {
                        combined.push({
                            name: inst.name,
                            appType: 'sonarr',
                            compoundValue: _encodeInstanceValue('sonarr', inst.name),
                            label: 'Sonarr – ' + inst.name
                        });
                    });
                }

                this.tvInstances = combined;

                if (combined.length > 0) {
                    this.selectedInstanceName = this.options.suggestedInstance || combined[0].compoundValue;
                } else {
                    this.selectedInstanceName = null;
                }
            } catch (e) {
                console.error('[RequestarrTVDetail] Load instances error:', e);
                this.tvInstances = [];
                this.selectedInstanceName = null;
            }
        },

        async checkSeriesStatus(tmdbId, instanceValue) {
            if (!instanceValue) return { exists: false, previously_requested: false };
            try {
                const decoded = _decodeInstanceValue(instanceValue);
                const appType = decoded.appType || 'sonarr';
                const response = await fetch(`./api/requestarr/series-status?tmdb_id=${tmdbId}&instance=${encodeURIComponent(decoded.name)}&app_type=${encodeURIComponent(appType)}`);
                return await response.json();
            } catch (e) {
                return { exists: false, previously_requested: false };
            }
        },

        escapeHtml(text) {
            if (!text) return '';
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        },

        renderTVDetail(details, originalSeries) {
            const decoded = _decodeInstanceValue(this.selectedInstanceName || '');
            const isTVHunt = decoded.appType === 'tv_hunt';

            const backdropUrl = details.backdrop_path
                ? `https://image.tmdb.org/t/p/original${details.backdrop_path}`
                : (details.poster_path ? `https://image.tmdb.org/t/p/original${details.poster_path}` : '');

            const posterUrl = details.poster_path
                ? `https://image.tmdb.org/t/p/w500${details.poster_path}`
                : './static/images/blackout.jpg';

            const title = details.name || details.title || 'Unknown';
            const year = details.first_air_date ? new Date(details.first_air_date).getFullYear() : 'N/A';
            const rating = details.vote_average ? Number(details.vote_average).toFixed(1) : 'N/A';
            const genres = details.genres && details.genres.length > 0
                ? details.genres.map(g => `<span class="mh-genre-tag">${this.escapeHtml(g.name)}</span>`).join('')
                : '<span class="mh-genre-tag">Unknown</span>';
            const overview = details.overview || 'No overview available.';

            const hasInstances = this.tvInstances.length > 0;
            const inLibrary = originalSeries.in_library || false;
            let actionButton = '';
            if (!hasInstances) {
                actionButton = '<button class="mh-btn" disabled style="background: rgba(55, 65, 81, 0.8); color: #9ca3af; cursor: not-allowed;"><i class="fas fa-server" style="margin-right: 8px;"></i> No Instance Configured</button>';
            } else if (inLibrary) {
                actionButton = '<button class="mh-btn mh-btn-success" disabled><i class="fas fa-check"></i> Already Available</button>';
            } else {
                actionButton = '<button class="mh-btn mh-btn-primary" id="requestarr-tv-detail-request-btn"><i class="fas fa-download"></i> Request Series</button>';
            }

            let instanceSelectorHTML = '';
            if (this.tvInstances.length > 0) {
                instanceSelectorHTML = `
                    <div class="mh-hero-instance">
                        <i class="fas fa-server"></i>
                        <select id="requestarr-tv-detail-instance-select">
                            ${this.tvInstances.map(inst => {
                                const selected = inst.compoundValue === this.selectedInstanceName ? 'selected' : '';
                                return `<option value="${this.escapeHtml(inst.compoundValue)}" ${selected}>${this.escapeHtml(inst.label)}</option>`;
                            }).join('')}
                        </select>
                    </div>
                `;
            }

            const toolbarHTML = isTVHunt
                ? `<div class="mh-toolbar" id="requestarr-tv-detail-toolbar">
                    <div class="mh-toolbar-left">
                        <button class="mh-tb" id="requestarr-tv-detail-back"><i class="fas fa-arrow-left"></i> <span>Back</span></button>
                    </div>
                    <div class="mh-toolbar-right"></div>
                </div>`
                : `<div class="mh-toolbar" id="requestarr-tv-detail-toolbar">
                    <div class="mh-toolbar-left">
                        <button class="mh-tb" id="requestarr-tv-detail-back"><i class="fas fa-arrow-left"></i> <span>Back</span></button>
                    </div>
                    <div class="mh-toolbar-right"></div>
                </div>`;

            const seasonsHTML = isTVHunt ? this.renderSeasonsSection(details) : '';

            return `
                ${toolbarHTML}
                <div class="mh-hero" style="background-image: url('${backdropUrl}');">
                    <div class="mh-hero-grad">
                        <div class="mh-hero-layout">
                            <div class="mh-hero-poster">
                                <img src="${posterUrl}" alt="${this.escapeHtml(title)}" onerror="this.src='./static/images/blackout.jpg'">
                            </div>
                            <div class="mh-hero-info">
                                <h1 class="mh-hero-title">${this.escapeHtml(title)}</h1>
                                <div class="mh-hero-meta">
                                    <span><i class="fas fa-calendar-alt"></i> ${year}</span>
                                    <span class="mh-star"><i class="fas fa-star"></i> ${rating}</span>
                                </div>
                                <div class="mh-hero-genres">${genres}</div>
                                ${instanceSelectorHTML}
                                <div class="mh-info-bar" id="requestarr-tv-detail-info-bar"${hasInstances ? '' : ' style="display:none"'}>
                                    <div class="mh-ib mh-ib-path">
                                        <div class="mh-ib-label">PATH</div>
                                        <div class="mh-ib-val" id="requestarr-tv-ib-path"><i class="fas fa-spinner fa-spin"></i></div>
                                    </div>
                                    <div class="mh-ib">
                                        <div class="mh-ib-label">STATUS</div>
                                        <div class="mh-ib-val" id="requestarr-tv-ib-status"><i class="fas fa-spinner fa-spin"></i></div>
                                    </div>
                                    <div class="mh-ib">
                                        <div class="mh-ib-label">EPISODES</div>
                                        <div class="mh-ib-val" id="requestarr-tv-ib-episodes"><i class="fas fa-spinner fa-spin"></i></div>
                                    </div>
                                </div>
                                <p class="mh-hero-overview">${this.escapeHtml(overview)}</p>
                                <div class="mh-hero-actions">${actionButton}</div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="mh-detail-body">
                    ${seasonsHTML}
                </div>
            `;
        },

        renderSeasonsSection(details) {
            const seasons = details.seasons || [];
            const sorted = [...seasons].sort((a, b) => {
                if (a.season_number === 0) return 1;
                if (b.season_number === 0) return -1;
                return b.season_number - a.season_number;
            });

            if (sorted.length === 0) return '';

            let html = '<div class="mh-section"><h2 class="mh-section-title"><i class="fas fa-layer-group"></i> Seasons</h2><div class="requestarr-tv-seasons-list">';
            sorted.forEach(season => {
                const name = season.name || ('Season ' + season.season_number);
                const epCount = season.episode_count != null ? season.episode_count : '?';
                html += `
                    <div class="requestarr-tv-season-item" data-season="${season.season_number}" data-tmdb-id="${details.id}">
                        <span class="season-chevron"><i class="fas fa-chevron-right"></i></span>
                        <span class="season-name">${this.escapeHtml(name)}</span>
                        <span class="season-ep-count">${epCount} episodes</span>
                    </div>
                `;
            });
            html += '</div></div>';
            return html;
        },

        setupDetailInteractions() {
            const self = this;
            const backBtn = document.getElementById('requestarr-tv-detail-back');
            if (backBtn) backBtn.addEventListener('click', () => this.closeDetail());

            const instanceSelect = document.getElementById('requestarr-tv-detail-instance-select');
            if (instanceSelect) {
                instanceSelect.addEventListener('change', () => {
                    this.selectedInstanceName = instanceSelect.value;
                    this.updateDetailInfoBar();
                });
            }

            const requestBtn = document.getElementById('requestarr-tv-detail-request-btn');
            if (requestBtn && this.currentSeries) {
                requestBtn.addEventListener('click', () => {
                    if (window.RequestarrDiscover && window.RequestarrDiscover.modal) {
                        window.RequestarrDiscover.modal.openModal(
                            this.currentSeries.tmdb_id || this.currentSeries.id,
                            'tv',
                            this.selectedInstanceName
                        );
                    }
                });
            }

            this.updateDetailInfoBar();

            const seasonItems = document.querySelectorAll('.requestarr-tv-season-item');
            seasonItems.forEach(item => {
                item.addEventListener('click', () => {
                    const seasonNum = parseInt(item.dataset.season, 10);
                    const tmdbId = item.dataset.tmdbId;
                    const body = item.nextElementSibling;
                    if (body && body.classList.contains('requestarr-tv-season-episodes')) {
                        item.classList.toggle('expanded');
                        body.classList.toggle('expanded');
                        return;
                    }
                    const episodesEl = document.createElement('div');
                    episodesEl.className = 'requestarr-tv-season-episodes';
                    episodesEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading episodes...';
                    item.after(episodesEl);
                    item.classList.add('expanded');

                    fetch(`./api/tv-hunt/series/${tmdbId}/season/${seasonNum}`)
                        .then(r => r.json())
                        .then(seasonData => {
                            const eps = seasonData.episodes || [];
                            let tbl = '<table class="episode-table"><thead><tr><th>#</th><th>Title</th><th>Air Date</th></tr></thead><tbody>';
                            eps.forEach(ep => {
                                const ad = ep.air_date || '';
                                tbl += `<tr><td>${ep.episode_number || ''}</td><td>${this.escapeHtml(ep.name || '')}</td><td>${ad}</td></tr>`;
                            });
                            tbl += '</tbody></table>';
                            episodesEl.innerHTML = tbl;
                            episodesEl.classList.add('expanded');
                        })
                        .catch(() => {
                            episodesEl.innerHTML = '<span style="color:#f87171;">Failed to load episodes</span>';
                        });
                });
            });

            if (this._escHandler) {
                document.removeEventListener('keydown', this._escHandler);
            }
            this._escHandler = (e) => {
                if (e.key === 'Escape') this.closeDetail();
            };
            document.addEventListener('keydown', this._escHandler);
        },

        async updateDetailInfoBar() {
            const pathEl = document.getElementById('requestarr-tv-ib-path');
            const statusEl = document.getElementById('requestarr-tv-ib-status');
            const episodesEl = document.getElementById('requestarr-tv-ib-episodes');
            if (!pathEl || !statusEl) return;

            const tmdbId = this.currentSeries && (this.currentSeries.tmdb_id || this.currentSeries.id);
            if (!tmdbId) return;

            const decoded = _decodeInstanceValue(this.selectedInstanceName || '');
            if (!decoded.name) {
                pathEl.textContent = '-';
                statusEl.innerHTML = '<span class="mh-badge mh-badge-warn">Not in Collection</span>';
                if (episodesEl) episodesEl.textContent = '-';
                return;
            }

            try {
                const data = await this.checkSeriesStatus(tmdbId, this.selectedInstanceName);

                if (data.exists) {
                    pathEl.textContent = data.path || data.root_folder_path || '-';
                    const avail = data.available_episodes ?? 0;
                    const total = data.total_episodes ?? 0;
                    const missing = data.missing_episodes ?? 0;

                    let statusClass = 'mh-badge-warn';
                    let statusLabel = 'Requested';
                    let statusIcon = 'fa-clock';
                    if (total > 0 && avail === total) {
                        statusClass = 'mh-badge-ok';
                        statusLabel = 'Complete';
                        statusIcon = 'fa-check-circle';
                    } else if (missing > 0) {
                        statusLabel = `${missing} missing`;
                    }
                    statusEl.innerHTML = `<span class="mh-badge ${statusClass}"><i class="fas ${statusIcon}"></i> ${statusLabel}</span>`;
                    if (episodesEl) episodesEl.textContent = `${avail} / ${total}`;
                } else {
                    pathEl.textContent = '-';
                    statusEl.innerHTML = '<span class="mh-badge mh-badge-warn">Not in Collection</span>';
                    if (episodesEl) episodesEl.textContent = '-';
                }
            } catch (e) {
                pathEl.textContent = '-';
                statusEl.innerHTML = '<span class="mh-badge mh-badge-warn">Error</span>';
                if (episodesEl) episodesEl.textContent = '-';
            }
        },

        setupErrorBackButton() {
            const btn = document.getElementById('requestarr-tv-detail-back-error');
            if (btn) btn.addEventListener('click', () => this.closeDetail());
        },

        getLoadingHTML() {
            return `
                <div class="mh-toolbar">
                    <div class="mh-toolbar-left">
                        <button class="mh-tb" id="requestarr-tv-detail-back-loading"><i class="fas fa-arrow-left"></i> <span>Back</span></button>
                    </div>
                    <div class="mh-toolbar-right"></div>
                </div>
                <div class="movie-detail-loading">
                    <i class="fas fa-spinner fa-spin"></i>
                    <p>Loading series details...</p>
                </div>
            `;
        },

        getErrorHTML(message) {
            return `
                <div class="mh-toolbar">
                    <div class="mh-toolbar-left">
                        <button class="mh-tb" id="requestarr-tv-detail-back-error"><i class="fas fa-arrow-left"></i> <span>Back</span></button>
                    </div>
                    <div class="mh-toolbar-right"></div>
                </div>
                <div class="movie-detail-loading">
                    <i class="fas fa-exclamation-triangle" style="color: #ef4444;"></i>
                    <p style="color: #ef4444;">${this.escapeHtml(message)}</p>
                </div>
            `;
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => window.RequestarrTVDetail.init());
    } else {
        window.RequestarrTVDetail.init();
    }
})();
