/**
 * Movie Hunt Calendar – Modern list-style upcoming releases view.
 * Shows release dates for collection items and discovers upcoming movies.
 */
(function () {
    'use strict';

    var TMDB_IMG = 'https://image.tmdb.org/t/p/w92';
    var FALLBACK_POSTER = './static/images/blackout.jpg';
    var DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    var _initialized = false;
    var _currentTab = 'collection';
    var _collectionLoaded = false;
    var _upcomingLoaded = false;

    function getInstanceId() {
        var sel = document.getElementById('movie-hunt-calendar-instance-select');
        return (sel && sel.value) ? sel.value : '';
    }

    /** Calculate days from the 1st of the current month to today (so calendar starts at current month). */
    function daysPastForCurrentMonth() {
        var now = new Date();
        return now.getDate() - 1; // e.g. Feb 9 → 8 days back → starts Feb 1
    }

    /* ── Formatting helpers ───────────────────────────────── */

    function formatDateBadge(dateStr) {
        if (!dateStr) return null;
        var d = new Date(dateStr + 'T00:00:00');
        if (isNaN(d.getTime())) return null;
        var today = new Date();
        today.setHours(0, 0, 0, 0);
        var isToday = d.getTime() === today.getTime();
        return {
            day: DAY_NAMES[d.getDay()],
            num: d.getDate(),
            month: MONTH_NAMES[d.getMonth()],
            year: d.getFullYear(),
            isToday: isToday,
            isPast: d < today,
        };
    }

    function posterUrl(path) {
        if (!path) return FALLBACK_POSTER;
        if (path.startsWith('http')) return path;
        return TMDB_IMG + path;
    }

    /* ── Render helpers ────────────────────────────────────── */

    function renderEventCard(ev) {
        var poster = posterUrl(ev.poster_path);
        var typeClass = ev.event_type || 'unknown';
        var typeLabel = ev.event_label || 'Unknown';
        var statusHtml = '';
        if (ev.status) {
            var sClass = ev.status === 'available' ? 'available' : 'requested';
            statusHtml = '<span class="mh-cal-event-status ' + sClass + '">' + ev.status + '</span>';
        }
        var yearStr = ev.year ? ' (' + ev.year + ')' : '';
        
        // Use TMDB cache if available
        var imgSrc = poster;
        var isTmdbUrl = poster && !poster.includes('./static/images/');
        if (isTmdbUrl && window.tmdbImageCache && window.tmdbImageCache.enabled && window.tmdbImageCache.storage === 'server') {
            imgSrc = './api/tmdb/image?url=' + encodeURIComponent(poster);
        }

        var html = '<div class="mh-cal-event" data-tmdb-poster="' + (isTmdbUrl ? poster : '') + '">' +
            '<div class="mh-cal-event-poster"><img src="' + imgSrc + '" alt="" onerror="this.src=\'' + FALLBACK_POSTER + '\'"></div>' +
            '<div class="mh-cal-event-info">' +
            '<div class="mh-cal-event-title">' + escapeHtml(ev.title) + yearStr + '</div>' +
            '<div class="mh-cal-event-meta">' +
            '<span class="mh-cal-event-type ' + typeClass + '">' + escapeHtml(typeLabel) + '</span>' +
            statusHtml +
            (ev.minimum_availability ? '<span class="mh-cal-event-avail">Min: ' + formatAvailability(ev.minimum_availability) + '</span>' : '') +
            '</div>' +
            '</div>' +
            '</div>';
        
        return html;
    }
    
    /** Apply browser-side TMDB cache to images after render */
    function applyCacheToImages(container) {
        if (!window.getCachedTMDBImage || !window.tmdbImageCache || !window.tmdbImageCache.enabled || window.tmdbImageCache.storage !== 'browser') {
            return;
        }
        var events = container.querySelectorAll('.mh-cal-event[data-tmdb-poster]');
        events.forEach(function(event) {
            var posterUrl = event.getAttribute('data-tmdb-poster');
            if (!posterUrl) return;
            var img = event.querySelector('.mh-cal-event-poster img');
            if (!img) return;
            window.getCachedTMDBImage(posterUrl, window.tmdbImageCache).then(function(cachedUrl) {
                if (cachedUrl && cachedUrl !== posterUrl) {
                    img.src = cachedUrl;
                }
            }).catch(function() {});
        });
    }

    function formatAvailability(val) {
        if (val === 'inCinemas') return 'In Cinemas';
        if (val === 'released') return 'Released';
        if (val === 'announced') return 'Announced';
        return val;
    }

    function renderDateGroup(dateStr, events) {
        var badge = formatDateBadge(dateStr);
        if (!badge) return '';
        var todayClass = badge.isToday ? ' today' : '';
        var html = '<div class="mh-cal-date-group">' +
            '<div class="mh-cal-date-header">' +
            '<div class="mh-cal-date-badge' + todayClass + '">' +
            '<span class="mh-cal-date-day">' + badge.day + '</span>' +
            '<span class="mh-cal-date-num">' + badge.num + '</span>' +
            '</div>' +
            '<span class="mh-cal-date-month-year">' + badge.month + ' ' + badge.year + '</span>' +
            '<div class="mh-cal-date-line"></div>' +
            '</div>' +
            '<div class="mh-cal-events">';
        for (var i = 0; i < events.length; i++) {
            html += renderEventCard(events[i]);
        }
        html += '</div></div>';
        return html;
    }

    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    /* ── Collection tab ────────────────────────────────────── */

    function loadCollectionCalendar() {
        var container = document.getElementById('mh-calendar-timeline');
        if (!container) return;
        container.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Loading calendar...</p></div>';

        var instanceId = getInstanceId();
        var pastDays = daysPastForCurrentMonth();
        var url = './api/movie-hunt/calendar?days_past=' + pastDays + '&days_future=120';
        if (instanceId) url += '&instance_id=' + encodeURIComponent(instanceId);

        fetch(url)
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.success || !data.events || data.events.length === 0) {
                    container.innerHTML = '<div class="mh-cal-empty"><i class="fas fa-calendar-times"></i><p>No upcoming releases in your collection.<br>Add movies to your collection to see their release dates here.</p></div>';
                    return;
                }

                // Group events by date
                var dated = [];
                var tba = [];
                for (var i = 0; i < data.events.length; i++) {
                    var ev = data.events[i];
                    if (ev.date) {
                        dated.push(ev);
                    } else {
                        tba.push(ev);
                    }
                }

                // Group dated events by date
                var groups = {};
                var dateOrder = [];
                for (var j = 0; j < dated.length; j++) {
                    var d = dated[j].date;
                    if (!groups[d]) {
                        groups[d] = [];
                        dateOrder.push(d);
                    }
                    groups[d].push(dated[j]);
                }
                dateOrder.sort();

                var html = '';
                for (var m = 0; m < dateOrder.length; m++) {
                    var dt = dateOrder[m];
                    html += renderDateGroup(dt, groups[dt], false);
                }

                // TBA section
                if (tba.length > 0) {
                    html += '<div class="mh-cal-tba-section">';
                    html += '<div class="mh-cal-tba-header"><i class="fas fa-question-circle"></i> Date TBA (' + tba.length + ' movie' + (tba.length > 1 ? 's' : '') + ')</div>';
                    html += '<div class="mh-cal-tba-events">';
                    for (var n = 0; n < tba.length; n++) {
                        html += renderEventCard(tba[n]);
                    }
                    html += '</div></div>';
                }

                container.innerHTML = html;
                applyCacheToImages(container); // Apply browser-side TMDB cache
                _collectionLoaded = true;
            })
            .catch(function (err) {
                console.error('Calendar fetch error:', err);
                container.innerHTML = '<div class="mh-cal-empty"><i class="fas fa-exclamation-triangle"></i><p>Failed to load calendar data.</p></div>';
            });
    }

    /* ── Upcoming (TMDB discover) tab ──────────────────────── */

    function loadUpcomingCalendar() {
        var container = document.getElementById('mh-calendar-upcoming-timeline');
        if (!container) return;
        container.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Loading upcoming movies...</p></div>';

        fetch('./api/movie-hunt/calendar/upcoming?page=1')
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.success || !data.movies || data.movies.length === 0) {
                    container.innerHTML = '<div class="mh-cal-empty"><i class="fas fa-film"></i><p>No upcoming movies found.</p></div>';
                    return;
                }

                // Group by release_date
                var groups = {};
                var dateOrder = [];
                for (var i = 0; i < data.movies.length; i++) {
                    var m = data.movies[i];
                    var d = m.release_date || '';
                    if (!d) continue;
                    if (!groups[d]) {
                        groups[d] = [];
                        dateOrder.push(d);
                    }
                    groups[d].push({
                        title: m.title,
                        year: m.year,
                        tmdb_id: m.tmdb_id,
                        poster_path: m.poster_path,
                        event_type: 'inCinemas',
                        event_label: 'Theatrical Release',
                        status: '',
                        minimum_availability: '',
                    });
                }
                dateOrder.sort();

                var html = '';
                for (var j = 0; j < dateOrder.length; j++) {
                    html += renderDateGroup(dateOrder[j], groups[dateOrder[j]], false);
                }

                container.innerHTML = html;
                applyCacheToImages(container); // Apply browser-side TMDB cache
                _upcomingLoaded = true;
            })
            .catch(function (err) {
                console.error('Upcoming calendar error:', err);
                container.innerHTML = '<div class="mh-cal-empty"><i class="fas fa-exclamation-triangle"></i><p>Failed to load upcoming movies.</p></div>';
            });
    }

    /* ── Tab switching ─────────────────────────────────────── */

    function switchTab(tab) {
        _currentTab = tab;
        var collView = document.getElementById('mh-calendar-collection-view');
        var upView = document.getElementById('mh-calendar-upcoming-view');
        var tabs = document.querySelectorAll('.mh-calendar-tab');

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

    /* ── Init ──────────────────────────────────────────────── */

    function init() {
        // Use the shared instance dropdown module (fetches from API, saves current)
        if (window.MovieHuntInstanceDropdown) {
            window.MovieHuntInstanceDropdown.attach('movie-hunt-calendar-instance-select', function () {
                _collectionLoaded = false;
                loadCollectionCalendar();
            });
        }

        // Tab clicks (only wire once)
        if (!_initialized) {
            var tabs = document.querySelectorAll('.mh-calendar-tab');
            for (var i = 0; i < tabs.length; i++) {
                tabs[i].addEventListener('click', function () {
                    switchTab(this.getAttribute('data-tab'));
                });
            }
        }

        // Load default tab
        _collectionLoaded = false;
        _upcomingLoaded = false;
        loadCollectionCalendar();
        _initialized = true;
    }

    /* ── Public API ────────────────────────────────────────── */

    window.MovieHuntCalendar = {
        init: init,
        refresh: function () {
            _collectionLoaded = false;
            _upcomingLoaded = false;
            if (_currentTab === 'collection') {
                loadCollectionCalendar();
            } else {
                loadUpcomingCalendar();
            }
        }
    };
})();
