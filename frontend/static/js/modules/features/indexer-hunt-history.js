/**
 * Indexer Hunt — History page module.
 * Displays paginated event history with filters.
 */
(function() {
    'use strict';

    var History = window.IndexerHuntHistory = {};
    var _currentPage = 1;
    var _totalPages = 1;
    var _initialized = false;

    History.init = function() {
        if (!_initialized) {
            _bindEvents();
            _loadIndexerFilter();
            _initialized = true;
        }
        var noInstEl = document.getElementById('indexer-hunt-history-no-instances');
        var wrapperEl = document.getElementById('indexer-hunt-history-content-wrapper');
        Promise.all([
            fetch('./api/movie-hunt/instances', { cache: 'no-store' }).then(function(r) { return r.json(); }),
            fetch('./api/tv-hunt/instances', { cache: 'no-store' }).then(function(r) { return r.json(); })
        ]).then(function(results) {
            var movieCount = (results[0].instances || []).length;
            var tvCount = (results[1].instances || []).length;
            if (movieCount === 0 && tvCount === 0) {
                if (noInstEl) noInstEl.style.display = '';
                if (wrapperEl) wrapperEl.style.display = 'none';
                return;
            }
            if (noInstEl) noInstEl.style.display = 'none';
            if (wrapperEl) wrapperEl.style.display = '';
            _currentPage = 1;
            _loadHistory();
        }).catch(function() {
            if (noInstEl) noInstEl.style.display = 'none';
            if (wrapperEl) wrapperEl.style.display = '';
            _currentPage = 1;
            _loadHistory();
        });
    };

    function _bindEvents() {
        var typeFilter = document.getElementById('ih-history-type-filter');
        if (typeFilter) typeFilter.addEventListener('change', function() { _currentPage = 1; _loadHistory(); });

        var indexerFilter = document.getElementById('ih-history-indexer-filter');
        if (indexerFilter) indexerFilter.addEventListener('change', function() { _currentPage = 1; _loadHistory(); });

        var prevBtn = document.getElementById('ih-history-prev-btn');
        if (prevBtn) prevBtn.addEventListener('click', function() {
            if (_currentPage > 1) { _currentPage--; _loadHistory(); }
        });

        var nextBtn = document.getElementById('ih-history-next-btn');
        if (nextBtn) nextBtn.addEventListener('click', function() {
            if (_currentPage < _totalPages) { _currentPage++; _loadHistory(); }
        });

        var clearBtn = document.getElementById('ih-history-clear-btn');
        if (clearBtn) clearBtn.addEventListener('click', function() {
            window.HuntarrConfirm.show({
                title: 'Clear History',
                message: 'Are you sure you want to clear all Index Master history and stats? This cannot be undone.',
                confirmLabel: 'Clear',
                onConfirm: function() {
                    fetch('./api/indexer-hunt/history', { method: 'DELETE' })
                        .then(function(r) { return r.json(); })
                        .then(function(data) {
                            if (data.success) {
                                _currentPage = 1;
                                _loadHistory();
                                if (window.huntarrUI) window.huntarrUI.showNotification('History cleared.', 'success');
                            }
                        });
                }
            });
        });
    }

    function _loadIndexerFilter() {
        fetch('./api/indexer-hunt/indexers')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var sel = document.getElementById('ih-history-indexer-filter');
                if (!sel) return;
                var firstOpt = sel.querySelector('option[value=""]');
                sel.innerHTML = '';
                if (firstOpt) sel.appendChild(firstOpt);
                else {
                    var opt = document.createElement('option');
                    opt.value = '';
                    opt.textContent = 'All Indexers';
                    sel.appendChild(opt);
                }
                (data.indexers || []).forEach(function(idx) {
                    var opt = document.createElement('option');
                    opt.value = idx.id;
                    opt.textContent = idx.name;
                    sel.appendChild(opt);
                });
            });
    }

    function _loadHistory() {
        var typeFilter = document.getElementById('ih-history-type-filter');
        var indexerFilter = document.getElementById('ih-history-indexer-filter');
        var eventType = typeFilter ? typeFilter.value : '';
        var indexerId = indexerFilter ? indexerFilter.value : '';

        var params = 'page=' + _currentPage + '&page_size=50';
        if (eventType) params += '&event_type=' + encodeURIComponent(eventType);
        if (indexerId) params += '&indexer_id=' + encodeURIComponent(indexerId);

        fetch('./api/indexer-hunt/history?' + params)
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var items = data.items || [];
                _totalPages = data.total_pages || 1;
                _currentPage = data.page || 1;
                _renderTable(items);
                _updatePagination(data.total || 0);
            })
            .catch(function(err) {
                console.error('[IndexerHuntHistory] Load error:', err);
            });
    }

    function _renderTable(items) {
        var tbody = document.getElementById('ih-history-table-body');
        var tableWrap = document.getElementById('ih-history-table-wrap');
        var empty = document.getElementById('ih-history-empty');
        if (!tbody) return;

        if (items.length === 0) {
            tbody.innerHTML = '';
            if (tableWrap) tableWrap.style.display = 'none';
            if (empty) empty.style.display = 'block';
            return;
        }

        if (tableWrap) tableWrap.style.display = '';
        if (empty) empty.style.display = 'none';

        var html = '';
        items.forEach(function(ev) {
            var date = ev.created_at || '';
            try {
                var d = new Date(date);
                if (!isNaN(d.getTime())) {
                    date = d.toLocaleString();
                }
            } catch(e) {}

            var typeClass = 'ih-event-' + (ev.event_type || 'search');
            var typeBadge = '<span class="ih-event-badge ' + typeClass + '">' + _esc(ev.event_type || 'unknown') + '</span>';
            var statusIcon = ev.success
                ? '<i class="fas fa-check-circle" style="color: #10b981;"></i>'
                : '<i class="fas fa-times-circle" style="color: #ef4444;"></i>';

            html += '<tr>'
                + '<td style="white-space: nowrap; font-size: 0.85rem; color: #94a3b8;">' + _esc(date) + '</td>'
                + '<td>' + typeBadge + '</td>'
                + '<td>' + _esc(ev.indexer_name || '\u2014') + '</td>'
                + '<td>' + _esc(ev.query || '\u2014') + '</td>'
                + '<td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">' + _esc(ev.result_title || '\u2014') + '</td>'
                + '<td>' + (ev.response_time_ms || 0) + 'ms</td>'
                + '<td>' + statusIcon + '</td>'
                + '</tr>';
        });
        tbody.innerHTML = html;
    }

    function _updatePagination(total) {
        var pagination = document.getElementById('ih-history-pagination');
        var pageInfo = document.getElementById('ih-history-page-info');
        var prevBtn = document.getElementById('ih-history-prev-btn');
        var nextBtn = document.getElementById('ih-history-next-btn');

        if (total <= 50) {
            if (pagination) pagination.style.display = 'none';
            return;
        }

        if (pagination) pagination.style.display = 'flex';
        if (pageInfo) pageInfo.textContent = 'Page ' + _currentPage + ' of ' + _totalPages;
        if (prevBtn) prevBtn.disabled = _currentPage <= 1;
        if (nextBtn) nextBtn.disabled = _currentPage >= _totalPages;
    }

    function _esc(s) {
        if (!s) return '';
        var d = document.createElement('div');
        d.appendChild(document.createTextNode(s));
        return d.innerHTML;
    }

    document.addEventListener('huntarr:instances-changed', function() {
        if (document.getElementById('indexer-hunt-history-content-wrapper') && window.huntarrUI && window.huntarrUI.currentSection === 'indexer-hunt-history') {
            History.init();
        }
    });
    document.addEventListener('huntarr:tv-hunt-instances-changed', function() {
        if (document.getElementById('indexer-hunt-history-content-wrapper') && window.huntarrUI && window.huntarrUI.currentSection === 'indexer-hunt-history') {
            History.init();
        }
    });

})();
