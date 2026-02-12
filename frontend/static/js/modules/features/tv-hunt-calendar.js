/**
 * TV Hunt Calendar – Episode air date calendar.
 * Shows upcoming episodes from the TV collection grouped by air date.
 */
(function() {
    'use strict';

    var DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var TMDB_IMG = 'https://image.tmdb.org/t/p/w92';
    var FALLBACK_POSTER = './static/images/blackout.jpg';
    var _initialized = false;

    function getInstanceId() {
        var sel = document.getElementById('tv-hunt-collection-instance-select');
        return (sel && sel.value) ? sel.value : '';
    }

    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
            statusHtml +
            '</div></div></div>';
    }

    function renderDateGroup(dateStr, episodes) {
        var badge = formatDateBadge(dateStr);
        if (!badge) return '';
        var todayClass = badge.isToday ? ' today' : '';
        var html = '<div class="mh-cal-date-group">' +
            '<div class="mh-cal-date-header">' +
            '<div class="mh-cal-date-badge' + todayClass + '"><span class="mh-cal-date-day">' + badge.day + '</span><span class="mh-cal-date-num">' + badge.num + '</span></div>' +
            '<span class="mh-cal-date-month-year">' + badge.month + ' ' + badge.year + '</span>' +
            '<div class="mh-cal-date-line"></div>' +
            '</div><div class="mh-cal-events">';
        for (var i = 0; i < episodes.length; i++) {
            html += renderEpisodeCard(episodes[i]);
        }
        html += '</div></div>';
        return html;
    }

    function loadCalendar() {
        var container = document.getElementById('tv-hunt-calendar-content');
        if (!container) return;
        container.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><p>Loading calendar...</p></div>';

        var instanceId = getInstanceId();
        if (!instanceId) {
            container.innerHTML = '<div class="mh-cal-empty"><i class="fas fa-calendar-times"></i><p>Select a TV Hunt instance to view the calendar.</p></div>';
            return;
        }

        // Build calendar from collection episodes
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

            // Group by date
            var groups = {};
            var dateOrder = [];
            events.forEach(function(ev) {
                if (!groups[ev.date]) { groups[ev.date] = []; dateOrder.push(ev.date); }
                groups[ev.date].push(ev);
            });
            dateOrder.sort();

            var html = '';
            dateOrder.forEach(function(d) { html += renderDateGroup(d, groups[d]); });
            container.innerHTML = html;
        })
        .catch(function() {
            container.innerHTML = '<div class="mh-cal-empty"><i class="fas fa-exclamation-triangle"></i><p>Failed to load calendar data.</p></div>';
        });
    }

    window.TVHuntCalendar = {
        init: function() {
            _initialized = true;
            loadCalendar();
        },
        refresh: function() { loadCalendar(); }
    };
})();
