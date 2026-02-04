/**
 * Movie Hunt Activity - Queue, History, Blocklist
 * Modern template (Hunt Manager style): search, clear, table. No app field.
 */
(function() {
    'use strict';

    var currentView = 'queue';
    var currentPage = 1;
    var totalPages = 1;
    var pageSize = 20;
    var searchQuery = '';
    var isLoading = false;

    function el(id) { return document.getElementById(id); }

    function showLoading(show) {
        var loading = el('activityLoading');
        if (loading) loading.style.display = show ? 'block' : 'none';
    }

    function showEmptyState(show, title, message) {
        var empty = el('activityEmptyState');
        var titleEl = el('activityEmptyTitle');
        var msgEl = el('activityEmptyMessage');
        if (empty) empty.style.display = show ? 'block' : 'none';
        if (titleEl && title) titleEl.textContent = title;
        if (msgEl && message) msgEl.textContent = message;
    }

    function hideAllViews() {
        ['activity-queue-view', 'activity-history-view', 'activity-blocklist-view'].forEach(function(id) {
            var v = el(id);
            if (v) v.style.display = 'none';
        });
    }

    function switchView(view) {
        currentView = view;
        hideAllViews();
        var viewId = 'activity-' + view + '-view';
        var viewEl = el(viewId);
        if (viewEl) viewEl.style.display = 'block';
        var removeBtn = el('activityRemoveSelectedButton');
        if (removeBtn) removeBtn.style.display = view === 'queue' ? '' : 'none';
        currentPage = 1;
        loadData();
    }

    function loadData() {
        if (isLoading) return;
        isLoading = true;
        showLoading(true);
        showEmptyState(false);

        var params = new URLSearchParams({ page: currentPage, page_size: pageSize });
        if (searchQuery) params.append('search', searchQuery);
        params.append('_t', Date.now()); // cache-bust so refresh always gets fresh stats

        var url = './api/activity/' + currentView + '?' + params.toString();
        fetch(url, { cache: 'no-store' })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var items = data.items || [];
                var total = data.total != null ? data.total : 0;
                totalPages = data.total_pages != null ? data.total_pages : (total ? Math.ceil(total / pageSize) : 1);
                if (totalPages < 1) totalPages = 1;
                currentPage = data.page != null ? data.page : 1;

                var currentPageEl = el('activityCurrentPage');
                var totalPagesEl = el('activityTotalPages');
                if (currentPageEl) currentPageEl.textContent = currentPage;
                if (totalPagesEl) totalPagesEl.textContent = totalPages;

                var prevBtn = el('activityPrevPage');
                var nextBtn = el('activityNextPage');
                if (prevBtn) prevBtn.disabled = currentPage <= 1;
                if (nextBtn) nextBtn.disabled = currentPage >= totalPages;

                var tbodyId = 'activity' + currentView.charAt(0).toUpperCase() + currentView.slice(1) + 'TableBody';
                var tbody = el(tbodyId);
                if (tbody) {
                    tbody.innerHTML = '';
                    if (items.length === 0) {
                        showEmptyState(true, 'No items found', 'Items will appear here when available.');
                    } else {
                        items.forEach(function(item) {
                            var row = createRow(item);
                            if (row) tbody.appendChild(row);
                        });
                    }
                }
                var selectAllCb = el('activityQueueSelectAll');
                if (selectAllCb) selectAllCb.checked = false;
            })
            .catch(function() {
                showEmptyState(true, 'Unable to load', 'Check connection and try again.');
            })
            .finally(function() {
                isLoading = false;
                showLoading(false);
            });
    }

    function escapeAttr(s) {
        if (s == null) return '';
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function formatScoringCell(scoring) {
        if (scoring == null || scoring === '') return escapeHtml('-');
        var s = String(scoring).trim();
        if (s === '') return escapeHtml('-');
        var paren = s.indexOf(' (');
        if (paren > 0) {
            var main = s.substring(0, paren).trim();
            var breakdown = s.substring(paren + 2).replace(/\)\s*$/, '').trim();
            return '<span class="activity-scoring-value" title="' + escapeAttr(breakdown) + '">' + escapeHtml(main) + '</span>';
        }
        return escapeHtml(s);
    }

    function createRow(item) {
        var tr = document.createElement('tr');
        if (currentView === 'queue') {
            var canSelect = item.id != null && item.id !== '';
            var cb = canSelect
                ? '<td class="col-select"><input type="checkbox" class="activity-queue-row-cb" data-id="' + escapeHtml(String(item.id)) + '" data-instance="' + escapeHtml(item.instance_name || 'Default') + '"></td>'
                : '<td class="col-select"></td>';
            var originalRelease = item.original_release || item.movie || '';
            var tooltip = originalRelease ? ('Original release: ' + escapeAttr(originalRelease)) : '';
            var movieText = escapeHtml(item.movie || item.title || '-');
            var movieCell = tooltip
                ? '<td class="col-movie"><span class="activity-queue-movie-title" title="' + tooltip + '">' + movieText + '</span></td>'
                : '<td class="col-movie">' + movieText + '</td>';
            tr.innerHTML = cb +
                movieCell +
                '<td class="col-languages">' + escapeHtml(item.languages || '-') + '</td>' +
                '<td class="col-quality">' + escapeHtml(item.quality || '-') + '</td>' +
                '<td class="col-formats">' + escapeHtml(item.formats || '-') + '</td>' +
                '<td class="col-scoring">' + formatScoringCell(item.scoring) + '</td>' +
                '<td class="col-time-left">' + escapeHtml(item.time_left != null ? item.time_left : '-') + '</td>' +
                '<td class="col-progress">' + escapeHtml((item.progress === '100%' ? 'Pending Import' : (item.progress != null ? item.progress : '-'))) + '</td>';
        } else if (currentView === 'history') {
            tr.innerHTML = '<td class="col-movie">' + escapeHtml(item.movie || item.title || '-') + '</td>' +
                '<td class="col-languages">' + escapeHtml(item.languages || '-') + '</td>' +
                '<td class="col-quality">' + escapeHtml(item.quality || '-') + '</td>' +
                '<td class="col-formats">' + escapeHtml(item.formats || '-') + '</td>' +
                '<td class="col-date">' + escapeHtml(item.date || '-') + '</td>';
        } else {
            tr.innerHTML = '<td class="col-movie">' + escapeHtml(item.movie || item.title || '-') + '</td>' +
                '<td class="col-source">' + escapeHtml(item.source_title || '-') + '</td>' +
                '<td class="col-languages">' + escapeHtml(item.languages || '-') + '</td>' +
                '<td class="col-quality">' + escapeHtml(item.quality || '-') + '</td>' +
                '<td class="col-formats">' + escapeHtml(item.formats || '-') + '</td>' +
                '<td class="col-date">' + escapeHtml(item.date || '-') + '</td>';
        }
        return tr;
    }

    function escapeHtml(s) {
        if (s == null) return '';
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function performSearch() {
        var input = el('activitySearchInput');
        searchQuery = input ? input.value.trim() : '';
        currentPage = 1;
        loadData();
    }

    function refreshData() {
        currentPage = 1;
        loadData();
        if (window.huntarrUI && window.huntarrUI.showNotification) {
            window.huntarrUI.showNotification('Data refreshed.', 'success');
        }
    }

    function removeSelected() {
        var checkboxes = document.querySelectorAll('#activityQueueTableBody .activity-queue-row-cb:checked');
        if (!checkboxes || checkboxes.length === 0) {
            if (window.huntarrUI && window.huntarrUI.showNotification) {
                window.huntarrUI.showNotification('No items selected.', 'warning');
            }
            return;
        }
        var items = [];
        for (var i = 0; i < checkboxes.length; i++) {
            var cb = checkboxes[i];
            items.push({ id: cb.getAttribute('data-id'), instance_name: cb.getAttribute('data-instance') || 'Default' });
        }
        fetch('./api/activity/queue', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: items })
        })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (data.success !== false) {
                    loadData();
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification('Selected items removed from queue.', 'success');
                    }
                } else if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification(data.error || 'Failed to remove.', 'error');
                }
            })
            .catch(function() {
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('Failed to remove selected.', 'error');
                }
            });
    }

    function init(view) {
        currentView = view || 'queue';
        currentPage = 1;
        totalPages = 1;
        searchQuery = '';
        var input = el('activitySearchInput');
        if (input) input.value = '';
        var pageSizeEl = el('activityPageSize');
        if (pageSizeEl) pageSize = parseInt(pageSizeEl.value, 10) || 20;

        var queueNav = el('movieHuntActivityQueueNav');
        var historyNav = el('movieHuntActivityHistoryNav');
        var blocklistNav = el('movieHuntActivityBlocklistNav');
        if (queueNav) queueNav.classList.toggle('active', currentView === 'queue');
        if (historyNav) historyNav.classList.toggle('active', currentView === 'history');
        if (blocklistNav) blocklistNav.classList.toggle('active', currentView === 'blocklist');

        switchView(currentView);

        var searchBtn = el('activitySearchButton');
        if (searchBtn) searchBtn.onclick = performSearch;
        if (input) input.onkeypress = function(e) { if (e.key === 'Enter') performSearch(); };
        var refreshBtn = el('activityRefreshButton');
        if (refreshBtn) refreshBtn.onclick = refreshData;
        var removeSelectedBtn = el('activityRemoveSelectedButton');
        if (removeSelectedBtn) {
            removeSelectedBtn.onclick = removeSelected;
            removeSelectedBtn.style.display = currentView === 'queue' ? '' : 'none';
        }
        var selectAllCb = el('activityQueueSelectAll');
        if (selectAllCb) {
            selectAllCb.checked = false;
            selectAllCb.onclick = function() {
                var rowCbs = document.querySelectorAll('#activityQueueTableBody .activity-queue-row-cb');
                for (var i = 0; i < rowCbs.length; i++) rowCbs[i].checked = selectAllCb.checked;
            };
        }
        var prevBtn = el('activityPrevPage');
        var nextBtn = el('activityNextPage');
        if (prevBtn) prevBtn.onclick = function() { if (currentPage > 1) { currentPage--; loadData(); } };
        if (nextBtn) nextBtn.onclick = function() { if (currentPage < totalPages) { currentPage++; loadData(); } };
        if (pageSizeEl) pageSizeEl.onchange = function() { pageSize = parseInt(pageSizeEl.value, 10); currentPage = 1; loadData(); };
    }

    window.ActivityModule = {
        init: init,
        switchView: switchView,
        refresh: loadData
    };
})();
