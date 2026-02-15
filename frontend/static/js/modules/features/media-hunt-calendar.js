/**
 * Media Hunt Calendar – Movie Hunt, Radarr, TV Hunt, Sonarr.
 * Unified dropdown; mode (movie/tv) derived from selected instance.
 */
(function() {
    'use strict';

    var TMDB_IMG = 'https://image.tmdb.org/t/p/w92';
    var FALLBACK_POSTER = './static/images/blackout.jpg';
    var DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    var _initialized = false;
    var _currentTab = 'collection';
    var _collectionLoaded = false;
    var _upcomingLoaded = false;

    function parseInstanceValue(val) {
        if (!val) return { appType: '', instance: '' };
        var idx = val.indexOf(':');
        if (idx === -1) return { appType: '', instance: val };
        return { appType: val.substring(0, idx), instance: val.substring(idx + 1) };
    }

    function getMode() {
        var val = getInstanceValue();
        var p = parseInstanceValue(val);
        return (p.appType === 'tv_hunt' || p.appType === 'sonarr') ? 'tv' : 'movie';
    }

    function getInstanceValue() {
        var sel = document.getElementById('media-hunt-calendar-instance-select');
        return (sel && sel.value) ? sel.value : '';
    }

    function getInstanceId() {
        return getInstanceValue();
    }

    function daysPastForCurrentMonth() {
        var now = new Date();
        return now.getDate() - 1;
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function formatDateBadge(dateStr) {
        if (!dateStr) return null;
        var d = new Date(dateStr + 'T00:00:00');
        if (isNaN(d.getTime())) return null;
        var today = new Date();
        today.setHours(0, 0, 0, 0);
        return {
            day: DAY_NAMES[d.getDay()],
            num: d.getDate(),
            month: MONTH_NAMES[d.getMonth()],
            year: d.getFullYear(),
            isToday: d.getTime() === today.getTime(),
            isPast: d < today,
        };
    }

    function posterUrl(path) {
        if (!path) return FALLBACK_POSTER;
        if (path.startsWith('http')) return path;
        return TMDB_IMG + path;
    }

    function formatAvailability(val) {
        if (val === 'inCinemas') return 'In Cinemas';
        if (val === 'released') return 'Released';
        if (val === 'announced') return 'Announced';
        return val;
    }

    /* ── Movie event card ───────────────────────────────────── */

    function renderMovieEventCard(ev) {
        var poster = posterUrl(ev.poster_path);
        var typeClass = ev.event_type || 'unknown';
        var typeLabel = ev.event_label || 'Unknown';
        var statusHtml = '';
        if (ev.status) {
            var sClass = ev.status === 'available' ? 'available' : 'requested';
            statusHtml = '<span class="mh-cal-event-status ' + sClass + '">' + ev.status + '</span>';
        }
        var yearStr = ev.year ? ' (' + ev.year + ')' : '';
        var isTmdbUrl = poster && !poster.includes('./static/images/');
        if (isTmdbUrl && window.tmdbImageCache && window.tmdbImageCache.enabled && window.tmdbImageCache.storage === 'server') {
            poster = './api/tmdb/image?url=' + encodeURIComponent(poster);
        }
        return '<div class="mh-cal-event" data-tmdb-poster="' + (isTmdbUrl ? posterUrl(ev.poster_path) : '') + '">' +
            '<div class="mh-cal-event-poster"><img src="' + poster + '" alt="" onerror="this.src=\'' + FALLBACK_POSTER + '\'"></div>' +
            '<div class="mh-cal-event-info">' +
            '<div class="mh-cal-event-title">' + escapeHtml(ev.title) + yearStr + '</div>' +
            '<div class="mh-cal-event-meta">' +
            '<span class="mh-cal-event-type ' + typeClass + '">' + escapeHtml(typeLabel) + '</span>' +
            statusHtml +
            (ev.minimum_availability ? '<span class="mh-cal-event-avail">Min: ' + formatAvailability(ev.minimum_availability) + '</span>' : '') +
            '</div></div></div>';
    }

    /* ── TV episode card ─────────────────────────────────────── */

    function renderEpisodeCard(ep) {
        var poster = posterUrl(ep.poster_path || ep.series_poster);
        var statusClass = ep.status === 'available' ? 'available' : (ep.status === 'missing' ? 'missing' : '');
        var statusHtml = ep.status ? '<span class="mh-cal-event-status ' + statusClass + '">' + ep.status + '</span>' : '';
        var epLabel = 'S' + String(ep.season_number || 0).padStart(2, '0') + 'E' + String(ep.episode_number || 0).padStart(2, '0');
        return '<div class="mh-cal-event">' +
            '<div class="mh-cal-event-poster"><img src="' + poster + '" alt="" onerror="this.src=\'' + FALLBACK_POSTER + '\'"></div>' +
            '<div class="mh-cal-event-info">' +
            '<div class="mh-cal-event-title">' + escapeHtml(ep.series_title || '') + '</div>' +
            '<div class="mh-cal-event-meta">' +
            '<span class="mh-cal-event-type inCinemas">' + epLabel + '</span>' +
            '<span style="color:#94a3b8;font-size:0.85em;">' + escapeHtml(ep.title || '') + '</span>' +
            statusHtml + '</div></div></div>';
    }

    function renderDateGroup(dateStr, events, isMovie) {
        var badge = formatDateBadge(dateStr);
        if (!badge) return '';
        var todayClass = badge.isToday ? ' today' : '';
        var html = '<div class="mh-cal-date-group">' +
            '<div class="mh-cal-date-header">' +
            '<div class="mh-cal-date-badge' + todayClass + '">' +
            '<span class="mh-cal-date-day">' + badge.day + '</span><span class="mh-cal-date-num">' + badge.num + '</span></div>' +
            '<span class="mh-cal-date-month-year">' + badge.month + ' ' + badge.year + '</span>' +
            '<div class="mh-cal-date-line"></div></div><div class="mh-cal-events">';
        for (var i = 0; i < events.length; i++) {
            html += isMovie ? renderMovieEventCard(events[i]) : renderEpisodeCard(events[i]);
        }
        html += '</div></div>';
        return html;
    }

    function applyCacheToImages(container) {
        if (!window.getCachedTMDBImage || !window.tmdbImageCache || !window.tmdbImageCache.enabled || window.tmdbImageCache.storage !== 'browser') return;
        var events = container.querySelectorAll('.mh-cal-event[data-tmdb-poster]');
        events.forEach(function(el) {
            var posterUrlVal = el.getAttribute('data-tmdb-poster');
            if (!posterUrlVal) return;
            var img = el.querySelector('.mh-cal-event-poster img');
            if (!img) return;
            window.getCachedTMDBImage(posterUrlVal, window.tmdbImageCache).then(function(cachedUrl) {
                if (cachedUrl && cachedUrl !== posterUrlVal) img.src = cachedUrl;
            }).catch(function() {});
        });
    }

    /* ── Movie: collection tab ──────────────────────────────── */

    function loadCollectionCalendar() {
        var container = document.getElementById('media-hunt-calendar-timeline');
        if (!container) return;
        container.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Loading calendar...</p></div>';

        var val = getInstanceValue();
        var p = parseInstanceValue(val);
        var pastDays = daysPastForCurrentMonth();
        var url;

        if (p.appType === 'movie_hunt' && p.instance) {
            url = './api/movie-hunt/calendar?days_past=' + pastDays + '&days_future=120&instance_id=' + encodeURIComponent(p.instance);
        } else if (p.appType === 'radarr' && p.instance) {
            url = './api/calendar?app_type=radarr&instance=' + encodeURIComponent(p.instance) + '&days_past=' + pastDays + '&days_future=120';
        } else {
            container.innerHTML = '<div class="mh-cal-empty"><i class="fas fa-calendar-times"></i><p>Select a Movie Hunt or Radarr instance.</p></div>';
            return;
        }

        fetch(url)
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (!data.success || !data.events || data.events.length === 0) {
                    container.innerHTML = '<div class="mh-cal-empty"><i class="fas fa-calendar-times"></i><p>No upcoming releases in your collection.<br>Add movies to your collection to see their release dates here.</p></div>';
                    return;
                }
                var dated = [], tba = [];
                for (var i = 0; i < data.events.length; i++) {
                    var ev = data.events[i];
                    if (ev.date) dated.push(ev); else tba.push(ev);
                }
                var groups = {}, dateOrder = [];
                for (var j = 0; j < dated.length; j++) {
                    var d = dated[j].date;
                    if (!groups[d]) { groups[d] = []; dateOrder.push(d); }
                    groups[d].push(dated[j]);
                }
                dateOrder.sort();
                var html = '';
                for (var m = 0; m < dateOrder.length; m++) html += renderDateGroup(dateOrder[m], groups[dateOrder[m]], true);
                if (tba.length > 0) {
                    html += '<div class="mh-cal-tba-section"><div class="mh-cal-tba-header"><i class="fas fa-question-circle"></i> Date TBA (' + tba.length + ' movie' + (tba.length > 1 ? 's' : '') + ')</div><div class="mh-cal-tba-events">';
                    for (var n = 0; n < tba.length; n++) html += renderMovieEventCard(tba[n]);
                    html += '</div></div>';
                }
                container.innerHTML = html;
                applyCacheToImages(container);
                _collectionLoaded = true;
            })
            .catch(function() {
                container.innerHTML = '<div class="mh-cal-empty"><i class="fas fa-exclamation-triangle"></i><p>Failed to load calendar data.</p></div>';
            });
    }

    /* ── Movie: upcoming tab ────────────────────────────────── */

    function loadUpcomingCalendar() {
        var container = document.getElementById('media-hunt-calendar-upcoming-timeline');
        if (!container) return;
        container.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Loading upcoming movies...</p></div>';

        fetch('./api/movie-hunt/calendar/upcoming?page=1')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (!data.success || !data.movies || data.movies.length === 0) {
                    container.innerHTML = '<div class="mh-cal-empty"><i class="fas fa-film"></i><p>No upcoming movies found.</p></div>';
                    return;
                }
                var groups = {}, dateOrder = [];
                for (var i = 0; i < data.movies.length; i++) {
                    var m = data.movies[i];
                    var d = m.release_date || '';
                    if (!d) continue;
                    if (!groups[d]) { groups[d] = []; dateOrder.push(d); }
                    groups[d].push({
                        title: m.title,
                        year: m.year,
                        poster_path: m.poster_path,
                        event_type: 'inCinemas',
                        event_label: 'Theatrical Release',
                        status: '',
                        minimum_availability: '',
                    });
                }
                dateOrder.sort();
                var html = '';
                for (var j = 0; j < dateOrder.length; j++) html += renderDateGroup(dateOrder[j], groups[dateOrder[j]], true);
                container.innerHTML = html;
                applyCacheToImages(container);
                _upcomingLoaded = true;
            })
            .catch(function() {
                container.innerHTML = '<div class="mh-cal-empty"><i class="fas fa-exclamation-triangle"></i><p>Failed to load upcoming movies.</p></div>';
            });
    }

    /* ── TV: single calendar from collection ─────────────────── */

    function loadTVCalendar() {
        var container = document.getElementById('media-hunt-calendar-timeline');
        if (!container) return;
        container.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Loading calendar...</p></div>';

        var val = getInstanceValue();
        var p = parseInstanceValue(val);
        if (!p.appType || !p.instance) {
            container.innerHTML = '<div class="mh-cal-empty"><i class="fas fa-calendar-times"></i><p>Select a TV Hunt or Sonarr instance to view the calendar.</p></div>';
            return;
        }

        if (p.appType === 'sonarr') {
            var pastDays = daysPastForCurrentMonth();
            fetch('./api/calendar?app_type=sonarr&instance=' + encodeURIComponent(p.instance) + '&days_past=' + pastDays + '&days_future=120')
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    var rawEvents = (data.events || []);
                    if (rawEvents.length === 0) {
                        container.innerHTML = '<div class="mh-cal-empty"><i class="fas fa-calendar-times"></i><p>No upcoming episodes in your Sonarr library.<br>Add TV shows to see episode air dates here.</p></div>';
                        return;
                    }
                    var groups = {}, dateOrder = [];
                    rawEvents.forEach(function(ev) {
                        var d = ev.date || '';
                        if (!groups[d]) { groups[d] = []; dateOrder.push(d); }
                        groups[d].push(ev);
                    });
                    dateOrder.sort();
                    var html = '';
                    dateOrder.forEach(function(d) { html += renderDateGroup(d, groups[d], false); });
                    container.innerHTML = html;
                })
                .catch(function() {
                    container.innerHTML = '<div class="mh-cal-empty"><i class="fas fa-exclamation-triangle"></i><p>Failed to load calendar data.</p></div>';
                });
            return;
        }

        fetch('./api/tv-hunt/collection?instance_id=' + p.instance)
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var series = data.series || [];
                var events = [];
                var now = new Date();
                var pastLimit = new Date();
                pastLimit.setDate(pastLimit.getDate() - 7);
                var futureLimit = new Date();
                futureLimit.setDate(futureLimit.getDate() + 90);

                series.forEach(function(s) {
                    (s.seasons || []).forEach(function(season) {
                        (season.episodes || []).forEach(function(ep) {
                            if (!ep.air_date) return;
                            var airDate = new Date(ep.air_date);
                            if (airDate < pastLimit || airDate > futureLimit) return;
                            events.push({
                                date: ep.air_date,
                                series_title: s.title,
                                series_poster: s.poster_path,
                                title: ep.title || ('Episode ' + ep.episode_number),
                                season_number: season.season_number,
                                episode_number: ep.episode_number,
                                status: ep.status || (airDate > now ? 'unaired' : 'missing'),
                                poster_path: s.poster_path,
                            });
                        });
                    });
                });

                if (events.length === 0) {
                    container.innerHTML = '<div class="mh-cal-empty"><i class="fas fa-calendar-times"></i><p>No upcoming episodes in your TV collection.<br>Add TV shows to see episode air dates here.</p></div>';
                    return;
                }
                var groups = {}, dateOrder = [];
                events.forEach(function(ev) {
                    if (!groups[ev.date]) { groups[ev.date] = []; dateOrder.push(ev.date); }
                    groups[ev.date].push(ev);
                });
                dateOrder.sort();
                var html = '';
                dateOrder.forEach(function(d) { html += renderDateGroup(d, groups[d], false); });
                container.innerHTML = html;
            })
            .catch(function() {
                container.innerHTML = '<div class="mh-cal-empty"><i class="fas fa-exclamation-triangle"></i><p>Failed to load calendar data.</p></div>';
            });
    }

    /* ── Tab switching (movie only) ──────────────────────────── */

    function switchTab(tab) {
        _currentTab = tab;
        var collView = document.getElementById('media-hunt-calendar-collection-view');
        var upView = document.getElementById('media-hunt-calendar-upcoming-view');
        var tabs = document.querySelectorAll('#mediaHuntCalendarSection .mh-calendar-tab');
        for (var i = 0; i < tabs.length; i++) {
            tabs[i].classList.toggle('active', tabs[i].getAttribute('data-tab') === tab);
        }
        if (tab === 'collection') {
            if (collView) collView.style.display = 'block';
            if (upView) upView.style.display = 'none';
            if (!_collectionLoaded) loadCollectionCalendar();
        } else {
            if (collView) collView.style.display = 'none';
            if (upView) upView.style.display = 'block';
            if (!_upcomingLoaded) loadUpcomingCalendar();
        }
    }

    function updateUIForMode(mode) {
        var titleEl = document.getElementById('media-hunt-calendar-title');
        var tabsWrap = document.getElementById('media-hunt-calendar-tabs-wrap');
        var legendEl = document.getElementById('media-hunt-calendar-legend');
        var upcomingView = document.getElementById('media-hunt-calendar-upcoming-view');
        if (titleEl) titleEl.innerHTML = (mode === 'movie' ? '<i class="fas fa-calendar-alt"></i> Upcoming Releases' : '<i class="fas fa-calendar-alt"></i> TV Calendar');
        if (tabsWrap) tabsWrap.style.display = (mode === 'movie') ? 'flex' : 'none';
        if (legendEl) legendEl.style.display = (mode === 'movie') ? 'flex' : 'none';
        if (upcomingView) upcomingView.style.display = 'none';
    }

    function safeJsonFetch(url, fallback) {
        return fetch(url, { cache: 'no-store' }).then(function(r) { return r.json(); }).catch(function() { return fallback || {}; });
    }

    function populateInstanceDropdown() {
        var sel = document.getElementById('media-hunt-calendar-instance-select');
        if (!sel) return;
        sel.innerHTML = '<option value="">Loading instances...</option>';
        var ts = Date.now();
        Promise.all([
            safeJsonFetch('./api/requestarr/instances/movie_hunt?t=' + ts, { instances: [] }),
            safeJsonFetch('./api/requestarr/instances/radarr?t=' + ts, { instances: [] }),
            safeJsonFetch('./api/requestarr/instances/tv_hunt?t=' + ts, { instances: [] }),
            safeJsonFetch('./api/requestarr/instances/sonarr?t=' + ts, { instances: [] }),
            safeJsonFetch('./api/indexer-hunt/indexers?t=' + ts, { indexers: [] }),
            safeJsonFetch('./api/movie-hunt/has-clients?t=' + ts, { has_clients: false })
        ]).then(function(results) {
            var mh = results[0].instances || [];
            var radarr = results[1].instances || [];
            var tvh = results[2].instances || [];
            var sonarr = results[3].instances || [];
            sel.innerHTML = '';
            var defaultMode = (window._mediaHuntCalendarMode || 'movie').toLowerCase();
            var preferred = null;
            mh.forEach(function(inst) {
                var v = 'movie_hunt:' + (inst.id != null ? inst.id : inst.name);
                var opt = document.createElement('option');
                opt.value = v;
                opt.textContent = 'Movie Hunt \u2013 ' + (inst.name || inst.id);
                sel.appendChild(opt);
                if (!preferred && defaultMode === 'movie') preferred = v;
            });
            radarr.forEach(function(inst) {
                var v = 'radarr:' + (inst.name || '');
                var opt = document.createElement('option');
                opt.value = v;
                opt.textContent = 'Radarr \u2013 ' + (inst.name || '');
                sel.appendChild(opt);
                if (!preferred && defaultMode === 'movie') preferred = v;
            });
            tvh.forEach(function(inst) {
                var v = 'tv_hunt:' + (inst.id != null ? inst.id : inst.name);
                var opt = document.createElement('option');
                opt.value = v;
                opt.textContent = 'TV Hunt \u2013 ' + (inst.name || inst.id);
                sel.appendChild(opt);
                if (!preferred && defaultMode === 'tv') preferred = v;
            });
            sonarr.forEach(function(inst) {
                var v = 'sonarr:' + (inst.name || '');
                var opt = document.createElement('option');
                opt.value = v;
                opt.textContent = 'Sonarr \u2013 ' + (inst.name || '');
                sel.appendChild(opt);
                if (!preferred && defaultMode === 'tv') preferred = v;
            });
            if (sel.options.length === 0) {
                var empty = document.createElement('option');
                empty.value = '';
                empty.textContent = 'No instances configured';
                sel.appendChild(empty);
                _collectionLoaded = false;
                _upcomingLoaded = false;
                return;
            }
            if (preferred) {
                sel.value = preferred;
            } else {
                sel.selectedIndex = 0;
            }
            _collectionLoaded = false;
            _upcomingLoaded = false;
            var mode = getMode();
            updateUIForMode(mode);
            if (mode === 'movie') {
                if (_currentTab === 'collection') loadCollectionCalendar();
                else loadUpcomingCalendar();
            } else {
                loadTVCalendar();
            }
        }).catch(function() {
            sel.innerHTML = '<option value="">Failed to load instances</option>';
        });
    }

    /* ── Init ────────────────────────────────────────────────── */

    function init() {
        var sel = document.getElementById('media-hunt-calendar-instance-select');
        if (!sel) return;
        populateInstanceDropdown();
        updateUIForMode(getMode());

        var onSelectChange = function() {
            _collectionLoaded = false;
            _upcomingLoaded = false;
            var mode = getMode();
            updateUIForMode(mode);
            if (mode === 'movie') {
                if (_currentTab === 'collection') loadCollectionCalendar();
                else loadUpcomingCalendar();
            } else {
                loadTVCalendar();
            }
        };

        sel.addEventListener('change', onSelectChange);

        if (!_initialized) {
            _initialized = true;
            var tabs = document.querySelectorAll('#mediaHuntCalendarSection .mh-calendar-tab');
            for (var i = 0; i < tabs.length; i++) {
                tabs[i].addEventListener('click', function() {
                    switchTab(this.getAttribute('data-tab'));
                });
            }
        }

        _collectionLoaded = false;
        _upcomingLoaded = false;
    }

    document.addEventListener('huntarr:instances-changed', function() { populateInstanceDropdown(); });
    document.addEventListener('huntarr:tv-hunt-instances-changed', function() { populateInstanceDropdown(); });

    window.MediaHuntCalendar = {
        init: init,
        refresh: function() {
            var mode = getMode();
            _collectionLoaded = false;
            _upcomingLoaded = false;
            if (mode === 'movie') {
                if (_currentTab === 'collection') loadCollectionCalendar();
                else loadUpcomingCalendar();
            } else {
                loadTVCalendar();
            }
        }
    };
})();
