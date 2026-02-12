/**
 * Media Hunt Calendar – single implementation for Movie Hunt and TV Hunt.
 * Mode set by router via window._mediaHuntCalendarMode ('movie' | 'tv').
 * Movie: collection + Discover Upcoming tabs; TV: single episode calendar from collection.
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

    function getMode() {
        var m = (window._mediaHuntCalendarMode || 'movie').toLowerCase();
        return (m === 'tv') ? 'tv' : 'movie';
    }

    function getInstanceId() {
        var sel = document.getElementById('media-hunt-calendar-instance-select');
        return (sel && sel.value) ? sel.value : '';
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

        var instanceId = getInstanceId();
        var pastDays = daysPastForCurrentMonth();
        var url = './api/movie-hunt/calendar?days_past=' + pastDays + '&days_future=120';
        if (instanceId) url += '&instance_id=' + encodeURIComponent(instanceId);

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

        var instanceId = getInstanceId();
        if (!instanceId) {
            container.innerHTML = '<div class="mh-cal-empty"><i class="fas fa-calendar-times"></i><p>Select a TV Hunt instance to view the calendar.</p></div>';
            return;
        }

        fetch('./api/tv-hunt/collection?instance_id=' + instanceId)
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

    /* ── Init ────────────────────────────────────────────────── */

    function init() {
        var mode = getMode();

        var titleEl = document.getElementById('media-hunt-calendar-title');
        var tabsWrap = document.getElementById('media-hunt-calendar-tabs-wrap');
        var legendEl = document.getElementById('media-hunt-calendar-legend');
        var upcomingView = document.getElementById('media-hunt-calendar-upcoming-view');

        if (titleEl) titleEl.innerHTML = (mode === 'movie' ? '<i class="fas fa-calendar-alt"></i> Upcoming Releases' : '<i class="fas fa-calendar-alt"></i> TV Calendar');
        if (tabsWrap) tabsWrap.style.display = (mode === 'movie') ? 'flex' : 'none';
        if (legendEl) legendEl.style.display = (mode === 'movie') ? 'flex' : 'none';
        if (upcomingView) upcomingView.style.display = 'none';

        if (mode === 'movie') {
            if (window.MovieHuntInstanceDropdown) {
                window.MovieHuntInstanceDropdown.attach('media-hunt-calendar-instance-select', function() {
                    _collectionLoaded = false;
                    loadCollectionCalendar();
                });
            }
        } else {
            if (window.TVHuntInstanceDropdown) {
                window.TVHuntInstanceDropdown.attach('media-hunt-calendar-instance-select', function() {
                    loadTVCalendar();
                });
            }
        }

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

        if (mode === 'movie') {
            loadCollectionCalendar();
        } else {
            loadTVCalendar();
        }
    }

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
