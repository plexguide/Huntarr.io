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

        var url = './api/activity/' + currentView + '?' + params.toString();
        fetch(url)
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
            })
            .catch(function() {
                showEmptyState(true, 'Unable to load', 'Check connection and try again.');
            })
            .finally(function() {
                isLoading = false;
                showLoading(false);
            });
    }

    function createRow(item) {
        var tr = document.createElement('tr');
        if (currentView === 'queue') {
            tr.innerHTML = '<td class="col-movie">' + escapeHtml(item.movie || item.title || '-') + '</td>' +
                '<td class="col-year">' + escapeHtml(item.year != null ? item.year : '-') + '</td>' +
                '<td class="col-languages">' + escapeHtml(item.languages || '-') + '</td>' +
                '<td class="col-quality">' + escapeHtml(item.quality || '-') + '</td>' +
                '<td class="col-formats">' + escapeHtml(item.formats || '-') + '</td>' +
                '<td class="col-time-left">' + escapeHtml(item.time_left != null ? item.time_left : '-') + '</td>' +
                '<td class="col-progress">' + escapeHtml(item.progress != null ? item.progress : '-') + '</td>';
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
