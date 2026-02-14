/**
 * Indexer Hunt — Stats page module.
 * Displays aggregate and per-indexer statistics.
 */
(function() {
    'use strict';

    var Stats = window.IndexerHuntStats = {};

    Stats.init = function() {
        var noInstEl = document.getElementById('indexer-hunt-stats-no-instances');
        var wrapperEl = document.getElementById('indexer-hunt-stats-content-wrapper');
        var noIdxEl = document.getElementById('indexer-hunt-stats-no-indexers');
        var noCliEl = document.getElementById('indexer-hunt-stats-no-clients');
        Promise.all([
            fetch('./api/movie-hunt/instances', { cache: 'no-store' }).then(function(r) { return r.json(); }),
            fetch('./api/tv-hunt/instances', { cache: 'no-store' }).then(function(r) { return r.json(); }),
            fetch('./api/indexer-hunt/indexers', { cache: 'no-store' }).then(function(r) { return r.json(); }),
            fetch('./api/movie-hunt/has-clients', { cache: 'no-store' }).then(function(r) { return r.json(); })
        ]).then(function(results) {
            var movieCount = (results[0].instances || []).length;
            var tvCount = (results[1].instances || []).length;
            var indexerCount = (results[2].indexers || []).length;
            var hasClients = results[3].has_clients === true;
            if (movieCount === 0 && tvCount === 0) {
                if (noInstEl) noInstEl.style.display = '';
                if (noIdxEl) noIdxEl.style.display = 'none';
                if (noCliEl) noCliEl.style.display = 'none';
                if (wrapperEl) wrapperEl.style.display = 'none';
                return;
            }
            if (indexerCount === 0) {
                if (noInstEl) noInstEl.style.display = 'none';
                if (noIdxEl) noIdxEl.style.display = '';
                if (noCliEl) noCliEl.style.display = 'none';
                if (wrapperEl) wrapperEl.style.display = 'none';
                return;
            }
            if (!hasClients) {
                if (noInstEl) noInstEl.style.display = 'none';
                if (noIdxEl) noIdxEl.style.display = 'none';
                if (noCliEl) noCliEl.style.display = '';
                if (wrapperEl) wrapperEl.style.display = 'none';
                return;
            }
            if (noInstEl) noInstEl.style.display = 'none';
            if (noIdxEl) noIdxEl.style.display = 'none';
            if (noCliEl) noCliEl.style.display = 'none';
            if (wrapperEl) wrapperEl.style.display = '';
            _loadAggregateStats();
            _loadPerIndexerStats();
        }).catch(function() {
            if (noInstEl) noInstEl.style.display = 'none';
            if (noIdxEl) noIdxEl.style.display = 'none';
            if (noCliEl) noCliEl.style.display = 'none';
            if (wrapperEl) wrapperEl.style.display = '';
            _loadAggregateStats();
            _loadPerIndexerStats();
        });
    };

    function _loadAggregateStats() {
        fetch('./api/indexer-hunt/stats')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                _setVal('ih-stat-queries', data.total_queries || 0);
                _setVal('ih-stat-grabs', data.total_grabs || 0);
                _setVal('ih-stat-failures', data.total_failures || 0);
                var respEl = document.getElementById('ih-stat-response');
                if (respEl) respEl.innerHTML = (data.avg_response_ms || 0) + '<span class="ih-stat-unit">ms</span>';
                var rateEl = document.getElementById('ih-stat-failure-rate');
                if (rateEl) rateEl.innerHTML = (data.failure_rate || 0) + '<span class="ih-stat-unit">%</span>';
            })
            .catch(function(err) {
                console.error('[IndexerHuntStats] Aggregate load error:', err);
            });
    }

    function _loadPerIndexerStats() {
        fetch('./api/indexer-hunt/stats/per-indexer')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var indexers = data.indexers || [];
                var tbody = document.getElementById('ih-stats-table-body');
                var tableWrap = document.getElementById('ih-stats-table-wrap');
                var empty = document.getElementById('ih-stats-empty');
                if (!tbody) return;

                if (indexers.length === 0) {
                    if (tableWrap) tableWrap.style.display = 'none';
                    if (empty) empty.style.display = 'block';
                    return;
                }

                if (tableWrap) tableWrap.style.display = '';
                if (empty) empty.style.display = 'none';

                var html = '';
                indexers.forEach(function(idx) {
                    var statusHtml = idx.enabled
                        ? '<span class="ih-card-status enabled" style="font-size:0.7rem;"><i class="fas fa-check-circle"></i> Enabled</span>'
                        : '<span class="ih-card-status disabled" style="font-size:0.7rem;"><i class="fas fa-minus-circle"></i> Disabled</span>';
                    html += '<tr>'
                        + '<td><strong>' + _esc(idx.name) + '</strong></td>'
                        + '<td><span class="ih-card-priority-badge">' + (idx.priority || 50) + '</span></td>'
                        + '<td>' + (idx.searches || 0) + '</td>'
                        + '<td>' + (idx.grabs || 0) + '</td>'
                        + '<td>' + (idx.failures || 0) + '</td>'
                        + '<td>' + (idx.avg_response_ms || 0) + 'ms</td>'
                        + '<td>' + (idx.failure_rate || 0) + '%</td>'
                        + '<td>' + statusHtml + '</td>'
                        + '</tr>';
                });
                tbody.innerHTML = html;
            })
            .catch(function(err) {
                console.error('[IndexerHuntStats] Per-indexer load error:', err);
            });
    }

    function _setVal(id, val) {
        var el = document.getElementById(id);
        if (el) el.textContent = val;
    }

    function _esc(s) {
        if (!s) return '';
        var d = document.createElement('div');
        d.appendChild(document.createTextNode(s));
        return d.innerHTML;
    }

    document.addEventListener('huntarr:instances-changed', function() {
        if (document.getElementById('indexer-hunt-stats-content-wrapper') && window.huntarrUI && window.huntarrUI.currentSection === 'indexer-hunt-stats') {
            Stats.init();
        }
    });
    document.addEventListener('huntarr:tv-hunt-instances-changed', function() {
        if (document.getElementById('indexer-hunt-stats-content-wrapper') && window.huntarrUI && window.huntarrUI.currentSection === 'indexer-hunt-stats') {
            Stats.init();
        }
    });

})();
