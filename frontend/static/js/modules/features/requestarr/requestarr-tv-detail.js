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
                const hash = window.location.hash || '';
                const m = hash.match(/^#requestarr-tv\/(\d+)$/);
                if (m) {
                    const tmdbId = parseInt(m[1], 10);
                    this.openDetail({ id: tmdbId, tmdb_id: tmdbId }, {}, true);
                } else {
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
                    this.currentSeries = details; // Update to full TMDB details
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
                const response = await fetch(`./api/requestarr/series-status?tmdb_id=${tmdbId}&instance=${encodeURIComponent(decoded.name)}&app_type=${encodeURIComponent(appType)}&_=${Date.now()}`);
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
            const hasTVHuntInstances = this.tvInstances.some(inst => {
                const d = _decodeInstanceValue(inst.compoundValue);
                return d.appType === 'tv_hunt';
            });

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

            const toolbarHTML = `
                <div class="mh-toolbar" id="requestarr-tv-detail-toolbar">
                    <div class="mh-toolbar-left">
                        <button class="mh-tb" id="requestarr-tv-detail-back"><i class="fas fa-arrow-left"></i> <span>Back</span></button>
                        ${isTVHunt ? '<button class="mh-tb" id="requestarr-tv-search-monitored" style="display:none"><i class="fas fa-search"></i> <span>Search Monitored</span></button>' : ''}
                    </div>
                    <div class="mh-toolbar-right">
                        ${isTVHunt ? '<button class="mh-tb" id="requestarr-tv-detail-edit" title="Edit" style="display:none"><i class="fas fa-wrench"></i><span>Edit</span></button>' : ''}
                        ${isTVHunt ? '<button class="mh-tb mh-tb-danger" id="requestarr-tv-detail-delete" title="Delete" style="display:none"><i class="fas fa-trash-alt"></i></button>' : ''}
                    </div>
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
                                <div class="mh-hero-title-row">
                                    <h1 class="mh-hero-title">${this.escapeHtml(title)}</h1>
                                    ${hasTVHuntInstances ? '<div class="mh-hero-series-monitor" id="requestarr-tv-series-monitor-wrap" style="display:none;"><button type="button" class="mh-monitor-btn" id="requestarr-tv-series-monitor-btn" title="Toggle monitor series"><i class="fas fa-bookmark"></i></button></div>' : ''}
                                </div>
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
                                <div class="mh-hero-actions" id="requestarr-tv-detail-actions" style="${isTVHunt ? 'display:none' : ''}">${actionButton}</div>
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
            const seasonIcon = 'fa-download';
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
                const total = season.episode_count != null ? season.episode_count : 0;
                const monitorBtn = isTVHunt ? '<button type="button" class="mh-monitor-btn mh-monitor-season mh-tv-hunt-only" data-season="' + season.season_number + '" title="Toggle monitor season"><i class="fas fa-bookmark"></i></button>' : '';
                const requestSeasonBtn = '<div class="season-actions"><button class="season-action-btn request-season-btn request-season-btn-unknown" title="Request entire season" data-season="' + season.season_number + '" data-total="' + total + '"><i class="fas ' + seasonIcon + '"></i></button></div>';
                const badgeSpan = '<span class="season-count-badge season-count-badge-unknown" data-season="' + season.season_number + '" data-total="' + total + '">– / ' + total + '</span>';
                html += `
                    <div class="requestarr-tv-season-item" data-season="${season.season_number}" data-tmdb-id="${details.id}">
                        <span class="season-chevron"><i class="fas fa-chevron-right"></i></span>
                        ${monitorBtn}
                        <span class="season-name">${this.escapeHtml(name)}</span>
                        ${badgeSpan}
                        ${requestSeasonBtn}
                    </div>
                `;
            });
            html += '</div></div>';
            return html;
        },

        updateSeasonCountBadges() {
            const decoded = _decodeInstanceValue(this.selectedInstanceName || '');
            const isTVHunt = decoded.appType === 'tv_hunt';
            const seasonIcon = 'fa-download';
            document.querySelectorAll('.season-count-badge').forEach(el => {
                const seasonItem = el.closest('.requestarr-tv-season-item');
                const seasonNum = parseInt(el.dataset.season, 10);
                const total = parseInt(el.dataset.total, 10) || 0;
                const epMap = this.buildEpisodeStatusMap(seasonNum);
                const available = Object.keys(epMap).length;
                el.textContent = `${available} / ${total}`;
                el.classList.remove('season-count-badge-unknown', 'season-count-badge-empty', 'season-count-badge-partial', 'season-count-badge-complete');
                if (total === 0) {
                    el.classList.add('season-count-badge-unknown');
                } else if (available === 0) {
                    el.classList.add('season-count-badge-empty');
                } else if (available < total) {
                    el.classList.add('season-count-badge-partial');
                } else {
                    el.classList.add('season-count-badge-complete');
                }
                // Update season monitor bookmark (TV Hunt only)
                if (isTVHunt && seasonItem) {
                    const monBtn = seasonItem.querySelector('.mh-monitor-season');
                    if (monBtn) {
                        const seasonData = this.seriesStatus && this.seriesStatus.seasons
                            ? this.seriesStatus.seasons.find(s => (s.season_number ?? s.seasonNumber) === seasonNum)
                            : null;
                        const mon = seasonData ? !!seasonData.monitored : false;
                        monBtn.querySelector('i').className = mon ? 'fas fa-bookmark' : 'far fa-bookmark';
                    }
                }
                // Update Request Season button: icon, color state, disabled when full
                const btn = seasonItem && seasonItem.querySelector('.request-season-btn');
                if (btn) {
                    btn.querySelector('i').className = 'fas ' + seasonIcon;
                    btn.classList.remove('request-season-btn-unknown', 'request-season-btn-empty', 'request-season-btn-partial', 'request-season-btn-complete');
                    if (total === 0) {
                        btn.classList.add('request-season-btn-unknown');
                        btn.disabled = true;
                    } else if (available >= total) {
                        btn.classList.add('request-season-btn-complete');
                        btn.disabled = true;
                    } else if (available > 0) {
                        btn.classList.add('request-season-btn-partial');
                        btn.disabled = false;
                    } else {
                        btn.classList.add('request-season-btn-empty');
                        btn.disabled = false;
                    }
                }
            });
        },

        updateEpisodeMonitorIcons() {
            const decoded = _decodeInstanceValue(this.selectedInstanceName || '');
            if (decoded.appType !== 'tv_hunt') return;
            document.querySelectorAll('.requestarr-tv-season-episodes.expanded').forEach(episodesEl => {
                const seasonItem = episodesEl.previousElementSibling;
                if (!seasonItem || !seasonItem.classList.contains('requestarr-tv-season-item')) return;
                const seasonNum = parseInt(seasonItem.dataset.season, 10);
                const monMap = this.buildEpisodeMonitoredMap(seasonNum);
                episodesEl.querySelectorAll('.mh-monitor-episode').forEach(btn => {
                    const epNum = parseInt(btn.dataset.episode, 10);
                    const monitored = !!monMap[epNum];
                    const icon = btn.querySelector('i');
                    if (icon) icon.className = monitored ? 'fas fa-bookmark' : 'far fa-bookmark';
                });
            });
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

            const seriesMonitorBtn = document.getElementById('requestarr-tv-series-monitor-btn');
            if (seriesMonitorBtn) {
                const tmdbId = this.currentSeries.tmdb_id || this.currentSeries.id;
                seriesMonitorBtn.onclick = async () => {
                    await this.toggleMonitor(tmdbId, null, null);
                };
            }

            const searchMonitoredBtn = document.getElementById('requestarr-tv-search-monitored');
            if (searchMonitoredBtn) {
                searchMonitoredBtn.onclick = async () => {
                    await this.searchMonitoredEpisodes();
                };
            }

            const editBtn = document.getElementById('requestarr-tv-detail-edit');
            if (editBtn) editBtn.addEventListener('click', () => this.openEditModalForTVHunt());

            const deleteBtn = document.getElementById('requestarr-tv-detail-delete');
            if (deleteBtn) deleteBtn.addEventListener('click', () => this.openDeleteModalForTVHunt());

            // Must load series status first so buildEpisodeStatusMap has Sonarr/TV Hunt data for episode status and resolution
            await this.updateDetailInfoBar();

            const seasonItems = document.querySelectorAll('.requestarr-tv-season-item');
            seasonItems.forEach(item => {
                const requestSeasonBtn = item.querySelector('.request-season-btn');
                if (requestSeasonBtn) {
                    requestSeasonBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.requestSeason(item.dataset.tmdbId, parseInt(item.dataset.season, 10));
                    });
                }
                const monitorSeasonBtn = item.querySelector('.mh-monitor-season');
                if (monitorSeasonBtn) {
                    monitorSeasonBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.toggleMonitor(item.dataset.tmdbId, parseInt(item.dataset.season, 10), null);
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
                        const epStatusMap = this.buildEpisodeStatusMap(seasonNum);
                        const epMonitoredMap = isTVHunt ? this.buildEpisodeMonitoredMap(seasonNum) : {};
                        const sorted = [...eps].sort((a, b) => (b.episode_number ?? b.episodeNumber ?? 0) - (a.episode_number ?? a.episodeNumber ?? 0));
                        const monitorCol = isTVHunt ? '<th></th>' : '';
                        let tbl = '<table class="episode-table"><thead><tr>' + monitorCol + '<th>#</th><th>Title</th><th>Air Date</th><th>Availability</th><th></th></tr></thead><tbody>';
                        sorted.forEach(ep => {
                            const epNum = ep.episode_number ?? ep.episodeNumber;
                            const title = ep.title || ep.name || '';
                            const ad = ep.air_date || ep.airDate || '';
                            const epInfo = epStatusMap[epNum];
                            const available = !!epInfo;
                            const airDateObj = ad ? new Date(ad) : null;
                            const isFutureAirDate = airDateObj && !isNaN(airDateObj.getTime()) && airDateObj > new Date();
                            const quality = (epInfo && typeof epInfo === 'object' && epInfo.quality) ? epInfo.quality : null;
                            let statusBadge;
                            if (available) {
                                statusBadge = '<span class="mh-ep-status mh-ep-status-ok">' + (quality ? this.escapeHtml(quality) : '<i class="fas fa-check-circle"></i> In Library') + '</span>';
                            } else if (isFutureAirDate) {
                                statusBadge = '<span class="mh-ep-status mh-ep-status-notreleased">Not Released</span>';
                            } else {
                                statusBadge = '<span class="mh-ep-status mh-ep-status-warn">Missing</span>';
                            }
                            const epReqClass = isFutureAirDate ? 'ep-request-btn ep-request-notreleased' : 'ep-request-btn ep-request-missing';
                            const requestBtn = !available ? `<button class="${epReqClass}" data-season="${seasonNum}" data-episode="${epNum}" title="Request episode"><i class="fas fa-download"></i></button>` : '<span class="ep-request-inlibrary"><i class="fas fa-download"></i></span>';
                            const monCell = isTVHunt ? '<td><button type="button" class="mh-monitor-btn mh-monitor-episode" data-season="' + seasonNum + '" data-episode="' + epNum + '" title="Toggle monitor"><i class="' + (epMonitoredMap[epNum] ? 'fas' : 'far') + ' fa-bookmark"></i></button></td>' : '';
                            tbl += `<tr>${monCell}<td>${epNum || ''}</td><td>${this.escapeHtml(title)}</td><td>${ad}</td><td>${statusBadge}</td><td>${requestBtn}</td></tr>`;
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
                        if (isTVHunt) {
                            episodesEl.querySelectorAll('.mh-monitor-episode').forEach(btn => {
                                btn.addEventListener('click', (ev) => {
                                    ev.stopPropagation();
                                    this.toggleMonitor(item.dataset.tmdbId, parseInt(btn.dataset.season, 10), parseInt(btn.dataset.episode, 10));
                                });
                            });
                        }
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

        async searchMonitoredEpisodes() {
            if (!this.currentSeries) {
                console.error('[RequestarrTVDetail] No currentSeries for searchMonitored');
                return;
            }
            const tmdbId = this.currentSeries.id || this.currentSeries.tmdb_id;
            const title = this.currentSeries.name || this.currentSeries.title;
            const instanceId = this.getTVHuntInstanceId();
            
            console.log('[RequestarrTVDetail] searchMonitored:', { title, tmdbId, instanceId });

            if (!instanceId) {
                if (window.huntarrUI?.showNotification) window.huntarrUI.showNotification('Select a TV Hunt instance.', 'error');
                return;
            }

            if (!title) {
                if (window.huntarrUI?.showNotification) window.huntarrUI.showNotification('Series title not found.', 'error');
                return;
            }

            const btn = document.getElementById('requestarr-tv-search-monitored');
            if (btn) {
                btn.disabled = true;
                btn.dataset.oldHtml = btn.innerHTML;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> <span>Searching...</span>';
            }

            try {
                const r = await fetch(`./api/tv-hunt/request?instance_id=${instanceId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        series_title: title,
                        tmdb_id: parseInt(tmdbId, 10),
                        search_type: 'monitored',
                        instance_id: instanceId,
                    }),
                });
                const data = await r.json();
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification(data.message || (data.success ? 'Search completed' : 'Search failed'), data.success ? 'success' : 'error');
                }
            } catch (e) {
                console.error('[RequestarrTVDetail] searchMonitored error:', e);
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('Search failed.', 'error');
                }
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = btn.dataset.oldHtml || '<i class="fas fa-search"></i> <span>Search Monitored</span>';
                }
            }
        },

        async updateDetailInfoBar() {
            const pathEl = document.getElementById('requestarr-tv-ib-path');
            const statusEl = document.getElementById('requestarr-tv-ib-status');
            const episodesEl = document.getElementById('requestarr-tv-ib-episodes');
            if (!pathEl || !statusEl) return;

            const tmdbId = this.currentSeries && (this.currentSeries.tmdb_id || this.currentSeries.id);
            if (!tmdbId) return;

            const decoded = _decodeInstanceValue(this.selectedInstanceName || '');
            const isTVHuntInstance = decoded.appType === 'tv_hunt';
            document.querySelectorAll('.mh-tv-hunt-only').forEach(el => { el.style.display = isTVHuntInstance ? '' : 'none'; });
            const seriesMonitorWrap = document.getElementById('requestarr-tv-series-monitor-wrap');
            if (seriesMonitorWrap) seriesMonitorWrap.style.display = 'none';
            if (!decoded.name) {
                this.seriesStatus = null;
                pathEl.textContent = '-';
                statusEl.innerHTML = '<span class="mh-badge mh-badge-warn">Not in Collection</span>';
                if (episodesEl) episodesEl.textContent = '-';
                this.updateSeasonCountBadges();
                this.updateEpisodeMonitorIcons();
                return;
            }

            try {
                const data = await this.checkSeriesStatus(tmdbId, this.selectedInstanceName);
                this.seriesStatus = data;

                const actionsEl = document.getElementById('requestarr-tv-detail-actions');

                const isTVHunt = decoded.appType === 'tv_hunt';
                const editBtnEl = document.getElementById('requestarr-tv-detail-edit');
                const deleteBtnEl = document.getElementById('requestarr-tv-detail-delete');
                const searchMonBtnEl = document.getElementById('requestarr-tv-search-monitored');

                if (data.exists) {
                    if (actionsEl && !isTVHunt) {
                        actionsEl.style.display = 'none';
                    }
                    const seriesMonitorWrap = document.getElementById('requestarr-tv-series-monitor-wrap');
                    const seriesMonitorBtn = document.getElementById('requestarr-tv-series-monitor-btn');
                    if (isTVHunt && seriesMonitorWrap && seriesMonitorBtn) {
                        seriesMonitorWrap.style.display = '';
                        const monitored = !!data.monitored;
                        seriesMonitorBtn.classList.toggle('mh-monitor-on', monitored);
                        seriesMonitorBtn.classList.toggle('mh-monitor-off', !monitored);
                        seriesMonitorBtn.querySelector('i').className = monitored ? 'fas fa-bookmark' : 'far fa-bookmark';
                    }
                    // Build path: root_folder + series title
                    let displayPath = data.path || data.root_folder_path || '-';
                    if (displayPath && displayPath !== '-' && this.currentSeries) {
                        const seriesTitle = this.currentSeries.name || this.currentSeries.title || '';
                        if (seriesTitle && !displayPath.includes(seriesTitle)) {
                            displayPath = displayPath.replace(/\/+$/, '') + '/' + seriesTitle;
                        }
                    }
                    pathEl.textContent = displayPath;
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

                    // Show toolbar buttons for items in collection
                    if (editBtnEl && isTVHunt) editBtnEl.style.display = '';
                    if (deleteBtnEl && isTVHunt) deleteBtnEl.style.display = '';
                    if (searchMonBtnEl && isTVHunt) searchMonBtnEl.style.display = '';

                    this.updateSeasonCountBadges();
                    this.updateEpisodeMonitorIcons();
                } else {
                    if (actionsEl && !isTVHunt) actionsEl.style.display = '';
                    if (seriesMonitorWrap) seriesMonitorWrap.style.display = 'none';
                    pathEl.textContent = '-';
                    statusEl.innerHTML = '<span class="mh-badge mh-badge-warn">Not in Collection</span>';
                    if (episodesEl) episodesEl.textContent = '-';

                    // Hide toolbar buttons when not in collection
                    if (editBtnEl) editBtnEl.style.display = 'none';
                    if (deleteBtnEl) deleteBtnEl.style.display = 'none';
                    if (searchMonBtnEl) searchMonBtnEl.style.display = 'none';

                    this.updateSeasonCountBadges();
                    this.updateEpisodeMonitorIcons();
                }
            } catch (e) {
                const actionsEl = document.getElementById('requestarr-tv-detail-actions');
                if (actionsEl && decoded.appType !== 'tv_hunt') actionsEl.style.display = '';
                pathEl.textContent = '-';
                statusEl.innerHTML = '<span class="mh-badge mh-badge-warn">Error</span>';
                if (episodesEl) episodesEl.textContent = '-';
                this.updateSeasonCountBadges();
                this.updateEpisodeMonitorIcons();
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

        buildEpisodeMonitoredMap(seasonNum) {
            const map = {};
            if (!this.seriesStatus || !this.seriesStatus.exists || !this.seriesStatus.seasons) return map;
            const season = this.seriesStatus.seasons.find(s =>
                (s.season_number ?? s.seasonNumber) === seasonNum
            );
            if (!season) return map;
            (season.episodes || []).forEach(ep => {
                const epNum = ep.episode_number ?? ep.episodeNumber;
                if (epNum != null) map[epNum] = !!ep.monitored;
            });
            return map;
        },

        async requestSeason(tmdbId, seasonNum) {
            const decoded = _decodeInstanceValue(this.selectedInstanceName || '');
            if (!decoded.name) {
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('No instance selected.', 'error');
                }
                return;
            }
            if (decoded.appType === 'sonarr') {
                try {
                    const r = await fetch('./api/requestarr/sonarr/season-search', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ tmdb_id: tmdbId, instance: decoded.name, season_number: seasonNum }),
                    });
                    const data = await r.json();
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification(data.success ? (data.message || 'Season search started') : (data.message || 'Request failed'), data.success ? 'success' : 'error');
                    }
                    if (data.success) this.updateDetailInfoBar();
                } catch (e) {
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification('Request failed.', 'error');
                    }
                }
                return;
            }
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

        async toggleMonitor(tmdbId, seasonNum, episodeNum) {
            console.log('toggleMonitor called:', { tmdbId, seasonNum, episodeNum });
            const instanceId = this.getTVHuntInstanceId();
            if (!instanceId) {
                if (window.huntarrUI?.showNotification) {
                    window.huntarrUI.showNotification('Select a TV Hunt instance to toggle monitor.', 'error');
                }
                return;
            }

            // Ensure we have current status
            if (!this.seriesStatus) {
                console.log('No seriesStatus, fetching...');
                await this.updateDetailInfoBar();
            }
            if (!this.seriesStatus) {
                console.error('Failed to get seriesStatus for toggleMonitor');
                return;
            }

            const currentMonitored = (() => {
                if (seasonNum != null && episodeNum != null) {
                    const map = this.buildEpisodeMonitoredMap(seasonNum);
                    return !!map[episodeNum];
                }
                if (seasonNum != null) {
                    const season = this.seriesStatus.seasons
                        ? this.seriesStatus.seasons.find(s => (s.season_number ?? s.seasonNumber) === seasonNum)
                        : null;
                    return season ? !!season.monitored : false;
                }
                // Series level
                console.log('Series-level toggle, current monitored:', this.seriesStatus.monitored);
                return !!this.seriesStatus.monitored;
            })();

            const newMonitored = !currentMonitored;
            console.log('New monitored state will be:', newMonitored);
            
            // Optimistic UI update for the series button if it's a series-level toggle
            if (seasonNum == null && episodeNum == null) {
                const btn = document.getElementById('requestarr-tv-series-monitor-btn');
                if (btn) {
                    const icon = btn.querySelector('i');
                    if (icon) icon.className = newMonitored ? 'fas fa-bookmark' : 'far fa-bookmark';
                }
            }

            const body = { monitored: newMonitored, instance_id: instanceId };
            if (seasonNum !== undefined && seasonNum !== null) body.season_number = seasonNum;
            if (episodeNum !== undefined && episodeNum !== null) body.episode_number = episodeNum;

            try {
                const r = await fetch(`./api/tv-hunt/collection/${tmdbId}/monitor?instance_id=${instanceId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
                
                if (!r.ok) {
                    const errData = await r.json().catch(() => ({}));
                    throw new Error(errData.error || 'Update failed');
                }
                
                console.log('Monitor toggle success, refreshing info bar...');
                // Full refresh from server
                await this.updateDetailInfoBar();
                
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification(newMonitored ? 'Monitor on' : 'Monitor off', 'success');
                }
            } catch (e) {
                console.error('toggleMonitor error:', e);
                // Revert optimistic update on failure
                if (seasonNum == null && episodeNum == null) {
                    const btn = document.getElementById('requestarr-tv-series-monitor-btn');
                    if (btn) {
                        const icon = btn.querySelector('i');
                        if (icon) icon.className = currentMonitored ? 'fas fa-bookmark' : 'far fa-bookmark';
                    }
                }
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('Failed to update monitor: ' + e.message, 'error');
                }
            }
        },

        async requestEpisode(tmdbId, seasonNum, episodeNum) {
            const decoded = _decodeInstanceValue(this.selectedInstanceName || '');
            if (!decoded.name) {
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('No instance selected.', 'error');
                }
                return;
            }
            if (decoded.appType === 'sonarr') {
                try {
                    const r = await fetch('./api/requestarr/sonarr/episode-search', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ tmdb_id: tmdbId, instance: decoded.name, season_number: seasonNum, episode_number: episodeNum }),
                    });
                    const data = await r.json();
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification(data.success ? (data.message || 'Episode search started') : (data.message || 'Request failed'), data.success ? 'success' : 'error');
                    }
                    if (data.success) this.updateDetailInfoBar();
                } catch (e) {
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification('Request failed.', 'error');
                    }
                }
                return;
            }
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

        async openEditModalForTVHunt() {
            const decoded = _decodeInstanceValue(this.selectedInstanceName || '');
            if (decoded.appType !== 'tv_hunt' || !decoded.name) return;
            const instanceId = this.getTVHuntInstanceId();
            if (!instanceId) return;

            const series = this.currentSeries;
            const status = this.seriesStatus || null;
            if (!series) return;

            const title = this.escapeHtml(series.name || series.title || '');
            const tmdbId = series.tmdb_id || series.id;

            let profiles = [], rootFolders = [];
            try {
                const [profResp, rfResp] = await Promise.all([
                    fetch(`./api/tv-hunt/profiles?instance_id=${instanceId}`),
                    fetch(`./api/tv-hunt/root-folders?instance_id=${instanceId}`)
                ]);
                const profData = await profResp.json();
                profiles = profData.profiles || profData || [];
                const rfData = await rfResp.json();
                rootFolders = rfData.root_folders || rfData || [];
            } catch (err) {
                console.error('[RequestarrTVDetail] Edit modal fetch error:', err);
            }

            const currentProfile = (status && status.quality_profile) || '';
            const currentRoot = (status && (status.path || status.root_folder_path)) || '';

            const profileOpts = (Array.isArray(profiles) ? profiles : []).map(p => {
                const name = p.name || 'Unknown';
                const sel = name === currentProfile ? ' selected' : '';
                return `<option value="${this.escapeHtml(name)}"${sel}>${this.escapeHtml(name)}${p.is_default ? ' (Default)' : ''}</option>`;
            }).join('');

            const rfOpts = (Array.isArray(rootFolders) ? rootFolders : []).map(rf => {
                const path = rf.path || '';
                const sel = path === currentRoot ? ' selected' : '';
                return `<option value="${this.escapeHtml(path)}"${sel}>${this.escapeHtml(path)}${rf.is_default ? ' (Default)' : ''}</option>`;
            }).join('');

            const html =
                '<div class="mh-modal-backdrop" id="mh-edit-modal">' +
                    '<div class="mh-modal">' +
                        '<div class="mh-modal-header">' +
                            '<h3><i class="fas fa-wrench"></i> Edit \u2014 ' + title + '</h3>' +
                            '<button class="mh-modal-x" id="mh-edit-close">&times;</button>' +
                        '</div>' +
                        '<div class="mh-modal-body">' +
                            '<div class="mh-form-row"><label>Root Folder</label><select id="mh-edit-root-folder" class="mh-select">' + rfOpts + '</select></div>' +
                            '<div class="mh-form-row"><label>Quality Profile</label><select id="mh-edit-quality-profile" class="mh-select">' + profileOpts + '</select></div>' +
                        '</div>' +
                        '<div class="mh-modal-footer">' +
                            '<button class="mh-btn mh-btn-secondary" id="mh-edit-cancel">Cancel</button>' +
                            '<button class="mh-btn mh-btn-primary" id="mh-edit-save">Save</button>' +
                        '</div>' +
                    '</div>' +
                '</div>';

            const existing = document.getElementById('mh-edit-modal');
            if (existing) existing.remove();

            document.body.insertAdjacentHTML('beforeend', html);

            const self = this;
            document.getElementById('mh-edit-close').addEventListener('click', () => { document.getElementById('mh-edit-modal').remove(); });
            document.getElementById('mh-edit-cancel').addEventListener('click', () => { document.getElementById('mh-edit-modal').remove(); });
            document.getElementById('mh-edit-modal').addEventListener('click', (e) => {
                if (e.target.id === 'mh-edit-modal') document.getElementById('mh-edit-modal').remove();
            });
            document.getElementById('mh-edit-save').addEventListener('click', async () => {
                const rootFolder = document.getElementById('mh-edit-root-folder').value;
                const qualityProfile = document.getElementById('mh-edit-quality-profile').value;
                const saveBtn = document.getElementById('mh-edit-save');
                if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving...'; }
                try {
                    const resp = await fetch(`./api/tv-hunt/collection/update?instance_id=${instanceId}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ tmdb_id: tmdbId, root_folder: rootFolder, quality_profile: qualityProfile })
                    });
                    const data = await resp.json();
                    if (data.success) {
                        const modal = document.getElementById('mh-edit-modal');
                        if (modal) modal.remove();
                        self.updateDetailInfoBar();
                        if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Series updated successfully.', 'success');
                    } else {
                        if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Save failed: ' + (data.error || 'Unknown error'), 'error');
                        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
                    }
                } catch (err) {
                    if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Save failed: ' + err.message, 'error');
                    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
                }
            });
        },

        openDeleteModalForTVHunt() {
            const decoded = _decodeInstanceValue(this.selectedInstanceName || '');
            if (decoded.appType !== 'tv_hunt' || !decoded.name) return;
            const instanceId = this.getTVHuntInstanceId();
            if (!instanceId) return;

            const series = this.currentSeries;
            if (!series) return;
            const tmdbId = series.tmdb_id || series.id;
            const title = this.escapeHtml(series.name || series.title || '');
            const self = this;

            const html =
                '<div class="mh-modal-backdrop" id="mh-delete-modal">' +
                    '<div class="mh-modal">' +
                        '<div class="mh-modal-header">' +
                            '<h3><i class="fas fa-trash-alt" style="color:#ef4444;"></i> Delete \u2014 ' + title + '</h3>' +
                            '<button class="mh-modal-x" id="mh-delete-close">&times;</button>' +
                        '</div>' +
                        '<div class="mh-modal-body">' +
                            '<p>Are you sure you want to remove <strong>' + title + '</strong> from your TV Hunt collection?</p>' +
                            '<p style="color:#94a3b8;font-size:13px;">This will not delete any downloaded files.</p>' +
                        '</div>' +
                        '<div class="mh-modal-footer">' +
                            '<button class="mh-btn mh-btn-secondary" id="mh-delete-cancel">Cancel</button>' +
                            '<button class="mh-btn mh-btn-danger" id="mh-delete-confirm">Delete</button>' +
                        '</div>' +
                    '</div>' +
                '</div>';

            const existing = document.getElementById('mh-delete-modal');
            if (existing) existing.remove();

            document.body.insertAdjacentHTML('beforeend', html);

            document.getElementById('mh-delete-close').addEventListener('click', () => { document.getElementById('mh-delete-modal').remove(); });
            document.getElementById('mh-delete-cancel').addEventListener('click', () => { document.getElementById('mh-delete-modal').remove(); });
            document.getElementById('mh-delete-modal').addEventListener('click', (e) => {
                if (e.target.id === 'mh-delete-modal') document.getElementById('mh-delete-modal').remove();
            });
            document.getElementById('mh-delete-confirm').addEventListener('click', async () => {
                const confirmBtn = document.getElementById('mh-delete-confirm');
                if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = 'Deleting...'; }
                try {
                    const resp = await fetch(`./api/tv-hunt/collection/${tmdbId}?instance_id=${instanceId}`, {
                        method: 'DELETE'
                    });
                    const data = await resp.json();
                    if (data.success) {
                        const modal = document.getElementById('mh-delete-modal');
                        if (modal) modal.remove();
                        if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification(title + ' removed from collection.', 'success');
                        self.closeDetail();
                    } else {
                        if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Delete failed: ' + (data.error || 'Unknown error'), 'error');
                        if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = 'Delete'; }
                    }
                } catch (err) {
                    if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Delete failed: ' + err.message, 'error');
                    if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = 'Delete'; }
                }
            });
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
