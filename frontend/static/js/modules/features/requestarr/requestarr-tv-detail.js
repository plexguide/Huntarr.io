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
        seriesStatus: null,  // { exists, seasons: [{ season_number, episodes: [{ episode_number, status }] }] }

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

            // Restore detail on refresh when URL has #requestarr-tv/ID
            const hash = window.location.hash || '';
            const m = hash.match(/^#requestarr-tv\/(\d+)$/);
            if (m) {
                const tmdbId = parseInt(m[1], 10);
                this.openDetail({ id: tmdbId, tmdb_id: tmdbId }, {}, true);
            }
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
                    await this.setupDetailInteractions();
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

            const seasonsHTML = this.renderSeasonsSection(details);

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
            const decoded = _decodeInstanceValue(this.selectedInstanceName || '');
            const isTVHunt = decoded.appType === 'tv_hunt';
            const seasons = details.seasons || [];
            // Sort newest first (by season number; specials last)
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
                const requestSeasonBtn = isTVHunt
                    ? '<div class="season-actions"><button class="season-action-btn request-season-btn" title="Request entire season"><i class="fas fa-download"></i> Request Season</button></div>'
                    : '';
                html += `
                    <div class="requestarr-tv-season-item" data-season="${season.season_number}" data-tmdb-id="${details.id}">
                        <span class="season-chevron"><i class="fas fa-chevron-right"></i></span>
                        <span class="season-name">${this.escapeHtml(name)}</span>
                        <span class="season-ep-count">${epCount} episodes</span>
                        ${requestSeasonBtn}
                    </div>
                `;
            });
            html += '</div></div>';
            return html;
        },

        async setupDetailInteractions() {
            const self = this;
            const backBtn = document.getElementById('requestarr-tv-detail-back');
            if (backBtn) backBtn.addEventListener('click', () => this.closeDetail());

            const instanceSelect = document.getElementById('requestarr-tv-detail-instance-select');
            if (instanceSelect) {
                instanceSelect.addEventListener('change', async () => {
                    this.selectedInstanceName = instanceSelect.value;
                    this.collapseExpandedSeasons();
                    await this.updateDetailInfoBar();
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

            // Must load series status first so buildEpisodeStatusMap has Sonarr/TV Hunt data for episode status and resolution
            await this.updateDetailInfoBar();

            const seasonItems = document.querySelectorAll('.requestarr-tv-season-item');
            seasonItems.forEach(item => {
                // Prevent expand when clicking Request Season button
                const requestSeasonBtn = item.querySelector('.request-season-btn');
                if (requestSeasonBtn) {
                    requestSeasonBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.requestSeason(item.dataset.tmdbId, parseInt(item.dataset.season, 10));
                    });
                }

                item.addEventListener('click', (e) => {
                    if (e.target.closest('.season-actions')) return;
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

                    const decoded = _decodeInstanceValue(this.selectedInstanceName || '');
                    const isTVHunt = decoded.appType === 'tv_hunt';

                    const runExpand = async () => {
                    const renderEpisodes = (eps) => {
                        // Status overlay: TV Hunt uses TV Hunt seriesStatus; Sonarr uses Sonarr seriesStatus
                        const epStatusMap = this.buildEpisodeStatusMap(seasonNum);
                        const sorted = [...eps].sort((a, b) => (b.episode_number ?? b.episodeNumber ?? 0) - (a.episode_number ?? a.episodeNumber ?? 0));
                        let tbl = '<table class="episode-table"><thead><tr><th>#</th><th>Title</th><th>Air Date</th><th>Status</th><th></th></tr></thead><tbody>';
                        sorted.forEach(ep => {
                            const epNum = ep.episode_number ?? ep.episodeNumber;
                            const title = ep.title || ep.name || '';
                            const ad = ep.air_date || ep.airDate || '';
                            const epInfo = epStatusMap[epNum];
                            const available = !!epInfo;
                            const quality = (epInfo && typeof epInfo === 'object' && epInfo.quality) ? epInfo.quality : null;
                            const statusBadge = available
                                ? '<span class="mh-ep-status mh-ep-status-ok">' + (quality ? this.escapeHtml(quality) : '<i class="fas fa-check-circle"></i> In Collection') + '</span>'
                                : '<span class="mh-ep-status mh-ep-status-warn">Missing</span>';
                            const requestBtn = (isTVHunt && !available) ? `<button class="ep-request-btn" data-season="${seasonNum}" data-episode="${epNum}" title="Request episode"><i class="fas fa-download"></i></button>` : '';
                            tbl += `<tr><td>${epNum || ''}</td><td>${this.escapeHtml(title)}</td><td>${ad}</td><td>${statusBadge}</td><td>${requestBtn}</td></tr>`;
                        });
                        tbl += '</tbody></table>';
                        episodesEl.innerHTML = tbl;
                        episodesEl.classList.add('expanded');
                        episodesEl.querySelectorAll('.ep-request-btn').forEach(btn => {
                            btn.addEventListener('click', (ev) => {
                                ev.stopPropagation();
                                this.requestEpisode(item.dataset.tmdbId, parseInt(btn.dataset.season, 10), parseInt(btn.dataset.episode, 10));
                            });
                        });
                    };

                    // Ensure Sonarr status is loaded before rendering (needed for episode status/resolution)
                    if (!isTVHunt && (!this.seriesStatus || !this.seriesStatus.seasons)) {
                        await this.updateDetailInfoBar();
                    }

                    // Always use TMDB (tv-hunt API) for episode list; status comes from Sonarr or TV Hunt via buildEpisodeStatusMap
                    try {
                        const seasonRes = await fetch(`./api/tv-hunt/series/${tmdbId}/season/${seasonNum}`);
                        const seasonData = await seasonRes.json();
                        const eps = seasonData.episodes || [];
                        renderEpisodes(eps);
                    } catch {
                        episodesEl.innerHTML = '<span style="color:#f87171;">Failed to load episodes</span>';
                    }
                    };
                    runExpand();
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
                this.seriesStatus = null;
                pathEl.textContent = '-';
                statusEl.innerHTML = '<span class="mh-badge mh-badge-warn">Not in Collection</span>';
                if (episodesEl) episodesEl.textContent = '-';
                return;
            }

            try {
                const data = await this.checkSeriesStatus(tmdbId, this.selectedInstanceName);
                this.seriesStatus = data;

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

        collapseExpandedSeasons() {
            const items = document.querySelectorAll('.requestarr-tv-season-item.expanded');
            items.forEach(item => {
                item.classList.remove('expanded');
                const body = item.nextElementSibling;
                if (body && body.classList.contains('requestarr-tv-season-episodes')) {
                    body.remove();
                }
            });
        },

        getTVHuntInstanceId() {
            const decoded = _decodeInstanceValue(this.selectedInstanceName || '');
            if (decoded.appType !== 'tv_hunt') return null;
            const inst = this.tvInstances.find(i => i.compoundValue === this.selectedInstanceName);
            return inst && inst.id ? String(inst.id) : null;
        },

        buildEpisodeStatusMap(seasonNum) {
            const map = {};
            if (!this.seriesStatus || !this.seriesStatus.exists || !this.seriesStatus.seasons) return map;
            const season = this.seriesStatus.seasons.find(s =>
                (s.season_number ?? s.seasonNumber) === seasonNum
            );
            if (!season) return map;
            const eps = season.episodes || [];
            eps.forEach(ep => {
                const epNum = ep.episode_number ?? ep.episodeNumber;
                const avail = (ep.status || '').toLowerCase() === 'available' || !!ep.file_path || !!ep.episodeFile;
                const quality = ep.quality || ep.file_quality || (ep.episodeFile && ep.episodeFile.quality && ep.episodeFile.quality.quality && ep.episodeFile.quality.quality.name);
                if (epNum != null && avail) map[epNum] = quality ? { quality } : true;
            });
            return map;
        },

        async requestSeason(tmdbId, seasonNum) {
            const instanceId = this.getTVHuntInstanceId();
            if (!instanceId) {
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('No TV Hunt instance selected.', 'error');
                }
                return;
            }
            const title = (this.currentSeries && (this.currentSeries.title || this.currentSeries.name)) || '';
            if (!title) return;
            try {
                const r = await fetch(`./api/tv-hunt/request?instance_id=${instanceId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        series_title: title,
                        season_number: seasonNum,
                        tmdb_id: tmdbId,
                        search_type: 'season',
                        instance_id: instanceId,
                    }),
                });
                const data = await r.json();
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification(data.success ? (data.message || 'Season search sent!') : (data.message || 'Request failed'), data.success ? 'success' : 'error');
                }
                if (data.success) this.updateDetailInfoBar();
            } catch (e) {
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('Request failed.', 'error');
                }
            }
        },

        async requestEpisode(tmdbId, seasonNum, episodeNum) {
            const instanceId = this.getTVHuntInstanceId();
            if (!instanceId) {
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('No TV Hunt instance selected.', 'error');
                }
                return;
            }
            const title = (this.currentSeries && (this.currentSeries.title || this.currentSeries.name)) || '';
            if (!title) return;
            try {
                const r = await fetch(`./api/tv-hunt/request?instance_id=${instanceId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        series_title: title,
                        season_number: seasonNum,
                        episode_number: episodeNum,
                        tmdb_id: tmdbId,
                        search_type: 'episode',
                        instance_id: instanceId,
                    }),
                });
                const data = await r.json();
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification(data.success ? (data.message || 'Episode search sent!') : (data.message || 'Request failed'), data.success ? 'success' : 'error');
                }
                if (data.success) this.updateDetailInfoBar();
            } catch (e) {
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('Request failed.', 'error');
                }
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
