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

        return '<div class="mh-cal-event">' +
            '<div class="mh-cal-event-poster"><img src="' + poster + '" alt="" onerror="this.src=\'' + FALLBACK_POSTER + '\'"></div>' +
            '<div class="mh-cal-event-info">' +
            '<div class="mh-cal-event-title">' + escapeHtml(ev.title) + yearStr + '</div>' +
            '<div class="mh-cal-event-meta">' +
            '<span class="mh-cal-event-type ' + typeClass + '">' + escapeHtml(typeLabel) + '</span>' +
            statusHtml +
            (ev.minimum_availability ? '<span class="mh-cal-event-avail">Min: ' + formatAvailability(ev.minimum_availability) + '</span>' : '') +
            '</div>' +
            '</div>' +
            '</div>';
    }

    function formatAvailability(val) {
        if (val === 'inCinemas') return 'In Cinemas';
        if (val === 'released') return 'Released';
        if (val === 'announced') return 'Announced';
        return val;
    }

    function renderDateGroup(dateStr, events, scrollTarget) {
        var badge = formatDateBadge(dateStr);
        if (!badge) return '';
        var todayClass = badge.isToday ? ' today' : '';
        var markerClass = scrollTarget ? ' mh-cal-today-marker' : '';
        var html = '<div class="mh-cal-date-group' + markerClass + '">' +
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
        var url = './api/movie-hunt/calendar?days_past=14&days_future=120';
        if (instanceId) url += '&instance_id=' + encodeURIComponent(instanceId);

        fetch(url)
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.success || !data.events || data.events.length === 0) {
                    container.innerHTML = '<div class="mh-cal-empty"><i class="fas fa-calendar-times"></i><p>No upcoming releases in your collection.<br>Add movies to your collection to see their release dates here.</p></div>';
                    return;
                }

                var today = data.today || new Date().toISOString().slice(0, 10);

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

                // Find the scroll target: today or next future date
                var scrollDate = '';
                for (var k = 0; k < dateOrder.length; k++) {
                    if (dateOrder[k] >= today) {
                        scrollDate = dateOrder[k];
                        break;
                    }
                }
                if (!scrollDate && dateOrder.length) {
                    scrollDate = dateOrder[dateOrder.length - 1];
                }

                var html = '';
                for (var m = 0; m < dateOrder.length; m++) {
                    var dt = dateOrder[m];
                    var isTarget = dt === scrollDate;
                    html += renderDateGroup(dt, groups[dt], isTarget);
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
                _collectionLoaded = true;

                // Scroll to the target date
                setTimeout(function () {
                    var marker = container.querySelector('.mh-cal-today-marker');
                    if (marker) {
                        marker.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }
                }, 150);
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

                var today = new Date().toISOString().slice(0, 10);

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

                var scrollDate = '';
                for (var k = 0; k < dateOrder.length; k++) {
                    if (dateOrder[k] >= today) {
                        scrollDate = dateOrder[k];
                        break;
                    }
                }

                var html = '';
                for (var j = 0; j < dateOrder.length; j++) {
                    html += renderDateGroup(dateOrder[j], groups[dateOrder[j]], dateOrder[j] === scrollDate);
                }

                container.innerHTML = html;
                _upcomingLoaded = true;

                setTimeout(function () {
                    var marker = container.querySelector('.mh-cal-today-marker');
                    if (marker) {
                        marker.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }
                }, 150);
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

    /* ── Instance dropdown ─────────────────────────────────── */

    function populateInstanceDropdown() {
        var sel = document.getElementById('movie-hunt-calendar-instance-select');
        if (!sel) return;

        // Copy options from the main Movie Hunt instance selector
        var mainSel = document.getElementById('movie-hunt-instance-select') ||
            document.getElementById('movie-hunt-collection-instance-select');
        if (mainSel && mainSel.options.length > 0) {
            sel.innerHTML = '';
            for (var i = 0; i < mainSel.options.length; i++) {
                var opt = document.createElement('option');
                opt.value = mainSel.options[i].value;
                opt.textContent = mainSel.options[i].textContent;
                sel.appendChild(opt);
            }
        } else {
            // Fetch instances directly
            fetch('./api/movie-hunt/instances')
                .then(function (r) { return r.json(); })
                .then(function (data) {
                    if (data && data.instances && data.instances.length > 0) {
                        sel.innerHTML = '';
                        for (var i = 0; i < data.instances.length; i++) {
                            var inst = data.instances[i];
                            var opt = document.createElement('option');
                            opt.value = inst.id != null ? inst.id : i;
                            opt.textContent = inst.name || ('Instance ' + (i + 1));
                            sel.appendChild(opt);
                        }
                    }
                })
                .catch(function () { /* keep loading text */ });
        }
    }

    /* ── Init ──────────────────────────────────────────────── */

    function init() {
        populateInstanceDropdown();

        // Tab clicks
        var tabs = document.querySelectorAll('.mh-calendar-tab');
        for (var i = 0; i < tabs.length; i++) {
            tabs[i].addEventListener('click', function () {
                switchTab(this.getAttribute('data-tab'));
            });
        }

        // Instance change
        var instSel = document.getElementById('movie-hunt-calendar-instance-select');
        if (instSel) {
            instSel.addEventListener('change', function () {
                _collectionLoaded = false;
                loadCollectionCalendar();
            });
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
