/**
 * Indexer Hunt — Stats page module.
 * Displays aggregate and per-indexer statistics.
 */
(function() {
    'use strict';

    var Stats = window.IndexerHuntStats = {};

    Stats.init = function() {
        _loadAggregateStats();
        _loadPerIndexerStats();
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

})();
