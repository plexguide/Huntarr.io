/**
 * TV Hunt Activity - Queue, History, Blocklist
 * Separate from Movie Hunt; unique to TV Hunt. Uses /api/tv-hunt/queue, history, blocklist.
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

    function getInstanceId() {
        var select = el('tv-hunt-activity-instance-select');
        if (!select || !select.value) return null;
        var n = parseInt(select.value, 10);
        return isNaN(n) ? null : n;
    }

    function showLoading(show) {
        var loading = el('tvHuntActivityLoading');
        if (loading) loading.style.display = show ? 'block' : 'none';
    }

    function showEmptyState(show, title, message) {
        var empty = el('tvHuntActivityEmptyState');
        var titleEl = el('tvHuntActivityEmptyTitle');
        var msgEl = el('tvHuntActivityEmptyMessage');
        if (empty) empty.style.display = show ? 'block' : 'none';
        if (titleEl && title) titleEl.textContent = title;
        if (msgEl && message) msgEl.textContent = message;
    }

    function hideAllViews() {
        ['tvHuntActivityQueueView', 'tvHuntActivityHistoryView', 'tvHuntActivityBlocklistView'].forEach(function(id) {
            var v = el(id);
            if (v) v.style.display = 'none';
        });
    }

    function switchView(view) {
        currentView = view;
        hideAllViews();
        var viewId = 'tvHuntActivity' + view.charAt(0).toUpperCase() + view.slice(1) + 'View';
        var viewEl = el(viewId);
        if (viewEl) viewEl.style.display = 'block';
        var removeBtn = el('tvHuntActivityRemoveSelectedButton');
        if (removeBtn) removeBtn.style.display = view === 'queue' ? '' : 'none';
        var toolbar = el('tvHuntActivityQueueToolbar');
        if (toolbar) toolbar.style.display = 'flex';
        currentPage = 1;
        loadData();
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

    function escapeHtml(s) {
        if (s == null) return '';
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function loadData() {
        if (isLoading) return;
        var instanceId = getInstanceId();
        if (instanceId == null) {
            showEmptyState(true, 'Select an instance', 'Choose a TV Hunt instance to view queue, history, or blocklist.');
            return;
        }
        isLoading = true;
        showLoading(true);
        showEmptyState(false);

        var params = new URLSearchParams({ instance_id: String(instanceId) });
        if (searchQuery) params.append('search', searchQuery);
        params.append('_t', Date.now());

        var endpoint = currentView === 'queue' ? 'queue' : currentView === 'history' ? 'history' : 'blocklist';
        var url = './api/tv-hunt/' + endpoint + '?' + params.toString();

        fetch(url, { cache: 'no-store' })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var items = [];
                var total = 0;
                if (currentView === 'queue') {
                    items = data.queue || [];
                    total = items.length;
                } else if (currentView === 'history') {
                    items = data.history || [];
                    total = items.length;
                } else {
                    items = data.items || [];
                    total = items.length;
                }

                if (searchQuery) {
                    var q = searchQuery.toLowerCase();
                    items = items.filter(function(item) {
                        var title = (item.show || item.series || item.movie || item.title || item.source_title || '').toString().toLowerCase();
                        return title.indexOf(q) >= 0;
                    });
                    total = items.length;
                }

                totalPages = pageSize > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1;
                var start = (currentPage - 1) * pageSize;
                var paged = items.slice(start, start + pageSize);

                var currentPageEl = el('tvHuntActivityCurrentPage');
                var totalPagesEl = el('tvHuntActivityTotalPages');
                if (currentPageEl) currentPageEl.textContent = currentPage;
                if (totalPagesEl) totalPagesEl.textContent = totalPages;

                var prevBtn = el('tvHuntActivityPrevPage');
                var nextBtn = el('tvHuntActivityNextPage');
                if (prevBtn) prevBtn.disabled = currentPage <= 1;
                if (nextBtn) nextBtn.disabled = currentPage >= totalPages;

                var tbodyId = 'tvHuntActivity' + (currentView === 'queue' ? 'Queue' : currentView === 'history' ? 'History' : 'Blocklist') + 'TableBody';
                var tbody = el(tbodyId);
                if (tbody) {
                    tbody.innerHTML = '';
                    if (paged.length === 0) {
                        showEmptyState(true, 'No items found', 'Items will appear here when available.');
                    } else {
                        paged.forEach(function(item) {
                            var row = createRow(item);
                            if (row) tbody.appendChild(row);
                        });
                    }
                }
                var selectAllCb = el('tvHuntActivityQueueSelectAll');
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

    function createRow(item) {
        var tr = document.createElement('tr');
        if (currentView === 'queue') {
            var canSelect = item.id != null && item.id !== '';
            var cb = canSelect
                ? '<td class="col-select"><input type="checkbox" class="tv-hunt-activity-queue-row-cb" data-id="' + escapeHtml(String(item.id)) + '"></td>'
                : '<td class="col-select"></td>';
            var showText = escapeHtml(item.show || item.series || item.title || '-');
            tr.innerHTML = cb +
                '<td class="col-show">' + showText + '</td>' +
                '<td class="col-languages">' + escapeHtml(item.languages || '-') + '</td>' +
                '<td class="col-quality">' + escapeHtml(item.quality || '-') + '</td>' +
                '<td class="col-formats">' + escapeHtml(item.formats || '-') + '</td>' +
                '<td class="col-scoring">' + escapeHtml(item.scoring != null ? item.scoring : '-') + '</td>' +
                '<td class="col-time-left">' + escapeHtml(item.time_left != null ? item.time_left : '-') + '</td>' +
                '<td class="col-progress">' + escapeHtml(item.progress != null ? item.progress : '-') + '</td>';
        } else if (currentView === 'history') {
            tr.innerHTML = '<td class="col-show">' + escapeHtml(item.show || item.series || item.title || '-') + '</td>' +
                '<td class="col-languages">' + escapeHtml(item.languages || '-') + '</td>' +
                '<td class="col-quality">' + escapeHtml(item.quality || '-') + '</td>' +
                '<td class="col-formats">' + escapeHtml(item.formats || '-') + '</td>' +
                '<td class="col-date">' + escapeHtml(item.date || item.added_at || '-') + '</td>';
        } else {
            var id = (item.id || '').toString();
            var sourceTitle = (item.source_title || '').trim() || '-';
            var dateText = escapeHtml(item.added_at || item.date || '-');
            var sourceTitleEsc = escapeAttr(sourceTitle);
            tr.innerHTML =
                '<td class="col-source">' + escapeHtml(sourceTitle) + '</td>' +
                '<td class="col-date">' + dateText + '</td>' +
                '<td class="col-actions">' +
                '<button type="button" class="tv-hunt-activity-blocklist-btn-info" title="Details" data-source-title="' + sourceTitleEsc + '" data-date="' + escapeAttr(item.added_at || '') + '" aria-label="Details"><i class="fas fa-info-circle"></i></button>' +
                '<button type="button" class="tv-hunt-activity-blocklist-btn-remove" title="Remove from blocklist" data-id="' + escapeAttr(id) + '" aria-label="Remove from blocklist"><i class="fas fa-times" style="color: #ef4444;"></i></button>' +
                '</td>';
            var infoBtn = tr.querySelector('.tv-hunt-activity-blocklist-btn-info');
            var removeBtn = tr.querySelector('.tv-hunt-activity-blocklist-btn-remove');
            if (infoBtn) infoBtn.addEventListener('click', function() { showBlocklistDetailsModal(this); });
            if (removeBtn) removeBtn.addEventListener('click', function() { removeBlocklistEntry(this.getAttribute('data-id')); });
        }
        return tr;
    }

    function showBlocklistDetailsModal(btn) {
        var modal = el('tvHuntActivityBlocklistDetailsModal');
        if (!modal) return;
        var titleEl = el('tvHuntActivityBlocklistModalSourceTitle');
        var dateEl = el('tvHuntActivityBlocklistModalDate');
        if (titleEl) titleEl.textContent = (btn.getAttribute('data-source-title') || '').trim() || '-';
        if (dateEl) dateEl.textContent = (btn.getAttribute('data-date') || '').trim() || '-';
        modal.style.display = 'flex';
    }

    function closeBlocklistDetailsModal() {
        var modal = el('tvHuntActivityBlocklistDetailsModal');
        if (modal) modal.style.display = 'none';
    }

    function removeBlocklistEntry(itemId) {
        if (!itemId || !itemId.trim()) return;
        var instanceId = getInstanceId();
        if (instanceId == null) {
            if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Select an instance first.', 'warning');
            return;
        }
        var msg = 'Remove this from the TV Hunt blocklist?';
        var doRemove = function() {
            var params = new URLSearchParams({ instance_id: String(instanceId) });
            fetch('./api/tv-hunt/blocklist/' + encodeURIComponent(itemId) + '?' + params.toString(), { method: 'DELETE' })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.success !== false) {
                        loadData();
                        if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification('Removed from blocklist.', 'success');
                    } else if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification(data.error || 'Failed to remove.', 'error');
                    }
                })
                .catch(function() {
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification('Failed to remove from blocklist.', 'error');
                    }
                });
        };
        if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
            window.HuntarrConfirm.show({ title: 'Remove from Blocklist', message: msg, confirmLabel: 'Remove', onConfirm: doRemove });
        } else {
            if (!window.confirm(msg)) return;
            doRemove();
        }
    }

    function performSearch() {
        var input = el('tvHuntActivitySearchInput');
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
        var checkboxes = document.querySelectorAll('#tvHuntActivityQueueTableBody .tv-hunt-activity-queue-row-cb:checked');
        if (!checkboxes || checkboxes.length === 0) {
            if (window.huntarrUI && window.huntarrUI.showNotification) {
                window.huntarrUI.showNotification('No items selected.', 'warning');
            }
            return;
        }
        if (window.huntarrUI && window.huntarrUI.showNotification) {
            window.huntarrUI.showNotification('Bulk remove from queue is not yet implemented for TV Hunt.', 'info');
        }
    }

    function init(view) {
        currentView = view || 'queue';
        currentPage = 1;
        totalPages = 1;
        searchQuery = '';
        var input = el('tvHuntActivitySearchInput');
        if (input) input.value = '';
        var pageSizeEl = el('tvHuntActivityPageSize');
        if (pageSizeEl) pageSize = parseInt(pageSizeEl.value, 10) || 20;

        var queueNav = el('tvHuntActivityQueueNav');
        var historyNav = el('tvHuntActivityHistoryNav');
        var blocklistNav = el('tvHuntActivityBlocklistNav');
        if (queueNav) queueNav.classList.toggle('active', currentView === 'queue');
        if (historyNav) historyNav.classList.toggle('active', currentView === 'history');
        if (blocklistNav) blocklistNav.classList.toggle('active', currentView === 'blocklist');

        switchView(currentView);

        if (window.TVHuntInstanceDropdown && window.TVHuntInstanceDropdown.attach) {
            var activitySelect = el('tv-hunt-activity-instance-select');
            if (activitySelect) {
                window.TVHuntInstanceDropdown.attach('tv-hunt-activity-instance-select', function() {
                    currentPage = 1;
                    loadData();
                });
            }
        }

        var searchBtn = el('tvHuntActivitySearchButton');
        if (searchBtn) searchBtn.onclick = performSearch;
        if (input) input.onkeypress = function(e) { if (e.key === 'Enter') performSearch(); };
        var refreshBtn = el('tvHuntActivityRefreshButton');
        if (refreshBtn) refreshBtn.onclick = refreshData;
        var removeSelectedBtn = el('tvHuntActivityRemoveSelectedButton');
        if (removeSelectedBtn) {
            removeSelectedBtn.onclick = removeSelected;
            removeSelectedBtn.style.display = currentView === 'queue' ? '' : 'none';
        }
        var selectAllCb = el('tvHuntActivityQueueSelectAll');
        if (selectAllCb) {
            selectAllCb.checked = false;
            selectAllCb.onclick = function() {
                var rowCbs = document.querySelectorAll('#tvHuntActivityQueueTableBody .tv-hunt-activity-queue-row-cb');
                for (var i = 0; i < rowCbs.length; i++) rowCbs[i].checked = selectAllCb.checked;
            };
        }
        var blocklistModal = el('tvHuntActivityBlocklistDetailsModal');
        if (blocklistModal) {
            var closeBtns = blocklistModal.querySelectorAll('.tv-hunt-activity-blocklist-modal-close, .activity-blocklist-modal-close-btn');
            for (var i = 0; i < closeBtns.length; i++) closeBtns[i].addEventListener('click', closeBlocklistDetailsModal);
            blocklistModal.addEventListener('click', function(e) { if (e.target === blocklistModal) closeBlocklistDetailsModal(); });
        }
        var prevBtn = el('tvHuntActivityPrevPage');
        var nextBtn = el('tvHuntActivityNextPage');
        if (prevBtn) prevBtn.onclick = function() { if (currentPage > 1) { currentPage--; loadData(); } };
        if (nextBtn) nextBtn.onclick = function() { if (currentPage < totalPages) { currentPage++; loadData(); } };
        if (pageSizeEl) pageSizeEl.onchange = function() { pageSize = parseInt(pageSizeEl.value, 10); currentPage = 1; loadData(); };
    }

    window.TVHuntActivityModule = {
        init: init,
        switchView: switchView,
        refresh: function() { loadData(); }
    };
})();
