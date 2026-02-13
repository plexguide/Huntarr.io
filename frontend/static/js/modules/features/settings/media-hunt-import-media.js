/**
 * Media Hunt Import Media — unified Movies/TV unmapped folder import.
 * Uses api/movie-hunt/import-media or api/tv-hunt/import-media based on mode.
 */
(function() {
    'use strict';

    var PREFIX = 'media-hunt-import-media';

    window.MediaHuntImportMedia = {
        items: [],
        mode: 'movie',
        pollInterval: null,
        currentSearchFolderPath: null,

        getApiBase: function() {
            return this.mode === 'tv' ? './api/tv-hunt' : './api/movie-hunt';
        },

        init: function() {
            var self = this;
            if (!document.getElementById(PREFIX + '-instance-select')) return;

            this.setupCombinedInstanceSelect();
            this.setupScanButton();
            this.setupImportAllButton();
            this.setupSearchModal();
            this.updateModeLabels();
            this.loadItems();
        },

        setupCombinedInstanceSelect: function() {
            var self = this;
            var select = document.getElementById(PREFIX + '-instance-select');
            if (!select) return;

            select.innerHTML = '<option value="">Loading...</option>';

            Promise.all([
                fetch('./api/movie-hunt/instances').then(function(r) { return r.json(); }),
                fetch('./api/tv-hunt/instances').then(function(r) { return r.json(); }),
                fetch('./api/movie-hunt/instances/current').then(function(r) { return r.json(); }),
                fetch('./api/tv-hunt/instances/current').then(function(r) { return r.json(); })
            ]).then(function(results) {
                var movieList = results[0].instances || [];
                var tvList = results[1].instances || [];
                var movieCurrent = results[2].current_instance_id != null ? Number(results[2].current_instance_id) : null;
                var tvCurrent = results[3].current_instance_id != null ? Number(results[3].current_instance_id) : null;

                select.innerHTML = '';
                var opts = [];
                movieList.forEach(function(inst) {
                    opts.push({ value: 'movie:' + inst.id, label: 'Movie - ' + (inst.name || 'Instance ' + inst.id), mode: 'movie' });
                });
                tvList.forEach(function(inst) {
                    opts.push({ value: 'tv:' + inst.id, label: 'TV - ' + (inst.name || 'Instance ' + inst.id), mode: 'tv' });
                });

                if (opts.length === 0) {
                    var o = document.createElement('option');
                    o.value = '';
                    o.textContent = 'No instances';
                    select.appendChild(o);
                    return;
                }

                opts.forEach(function(opt) {
                    var o = document.createElement('option');
                    o.value = opt.value;
                    o.textContent = opt.label;
                    select.appendChild(o);
                });

                var pref = (movieCurrent != null && movieList.length) ? 'movie:' + movieCurrent : (tvCurrent != null && tvList.length) ? 'tv:' + tvCurrent : opts[0].value;
                if (select.querySelector('option[value="' + pref + '"]')) {
                    select.value = pref;
                } else if (opts.length) {
                    select.value = opts[0].value;
                }
                self.applySelectedInstance();
            }).catch(function() {
                select.innerHTML = '<option value="">Failed to load</option>';
            });

            select.addEventListener('change', function() {
                self.applySelectedInstance();
            });
        },

        applySelectedInstance: function() {
            var select = document.getElementById(PREFIX + '-instance-select');
            if (!select || !select.value) return;
            var parts = (select.value || '').split(':');
            var mode = parts[0] || 'movie';
            var instanceId = parts[1] ? parseInt(parts[1], 10) : null;
            if (!instanceId) return;

            this.mode = mode;
            this.updateModeLabels();

            var apiBase = mode === 'tv' ? './api/tv-hunt' : './api/movie-hunt';
            fetch(apiBase + '/instances/current', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ instance_id: instanceId })
            }).then(function(r) { return r.json(); }).catch(function() {});

            if (typeof window.updateMovieHuntSettingsVisibility === 'function') window.updateMovieHuntSettingsVisibility();
            if (typeof window.updateTVHuntSettingsVisibility === 'function') window.updateTVHuntSettingsVisibility();

            this.loadItems();
        },

        updateModeLabels: function() {
            var help = document.getElementById(PREFIX + '-help');
            var headerInfo = document.getElementById(PREFIX + '-header-info');
            var searchTitle = document.getElementById(PREFIX + '-search-title');
            var empty = document.getElementById(PREFIX + '-empty');
            var searchInput = document.getElementById(PREFIX + '-search-input');

            if (this.mode === 'tv') {
                if (help) help.textContent = 'Import existing TV series from your root folders into your TV Collection. Unmapped series folders are automatically detected and matched to TMDB with smart confidence scoring (first air date, title, seasons).';
                if (headerInfo) headerInfo.textContent = 'SERIES / FOLDER INFORMATION';
                if (searchTitle) searchTitle.textContent = 'Find TV Series Match';
                if (empty) empty.innerHTML = '<i class="fas fa-tv"></i><p>Click <strong>Scan Folders</strong> to detect unmapped TV series in your root folders.</p>';
                if (searchInput) searchInput.placeholder = 'Series title...';
            } else {
                if (help) help.textContent = 'Import existing movies from your root folders into your Movie Collection. Unmapped folders are automatically detected and matched to TMDB.';
                if (headerInfo) headerInfo.textContent = 'FOLDER / FILE INFORMATION';
                if (searchTitle) searchTitle.textContent = 'Find Movie Match';
                if (empty) empty.innerHTML = '<i class="fas fa-folder-open"></i><p>Click <strong>Scan Folders</strong> to detect unmapped movies in your root folders.</p>';
                if (searchInput) searchInput.placeholder = 'Movie title...';
            }
        },


        setupScanButton: function() {
            var btn = document.getElementById(PREFIX + '-scan-btn');
            if (!btn) return;
            btn.onclick = (function(self) { return function() { self.triggerScan(); }; })(this);
        },

        setupImportAllButton: function() {
            var btn = document.getElementById(PREFIX + '-import-all-btn');
            if (!btn) return;
            btn.onclick = (function(self) { return function() { self.importAll(); }; })(this);
        },

        setupSearchModal: function() {
            var self = this;
            var backdrop = document.getElementById(PREFIX + '-search-backdrop');
            var closeBtn = document.getElementById(PREFIX + '-search-close');
            var searchBtn = document.getElementById(PREFIX + '-search-go-btn');
            var input = document.getElementById(PREFIX + '-search-input');

            if (backdrop) backdrop.onclick = function() { self.closeSearchModal(); };
            if (closeBtn) closeBtn.onclick = function() { self.closeSearchModal(); };
            if (searchBtn) searchBtn.onclick = function() { self.performManualSearch(); };
            if (input) {
                input.addEventListener('keydown', function(e) {
                    if (e.key === 'Enter') self.performManualSearch();
                });
            }
        },

        getInstanceParam: function() {
            var select = document.getElementById(PREFIX + '-instance-select');
            if (!select || !select.value) return '';
            var parts = (select.value || '').split(':');
            var instanceId = parts[1];
            return instanceId ? '&instance_id=' + encodeURIComponent(instanceId) : '';
        },

        loadItems: function() {
            var self = this;
            var listEl = document.getElementById(PREFIX + '-list');
            if (!listEl) return;

            var url = this.getApiBase() + '/import-media?' + this.getInstanceParam().replace('&', '');
            fetch(url)
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (!data.success) {
                        listEl.innerHTML = '<div class="import-media-empty"><i class="fas fa-exclamation-triangle"></i><p>Failed to load import media data.</p></div>';
                        return;
                    }

                    self.items = data.items || [];
                    self.updateStats(data);
                    self.renderItems();

                    if (data.scan_in_progress) {
                        self.startPolling();
                    } else {
                        self.stopPolling();
                    }
                })
                .catch(function(err) {
                    console.error('Import Media load error:', err);
                    listEl.innerHTML = '<div class="import-media-empty"><i class="fas fa-exclamation-triangle"></i><p>Error loading data.</p></div>';
                });
        },

        updateStats: function(data) {
            var items = data.items || [];
            var statsEl = document.getElementById(PREFIX + '-stats');
            var statusBar = document.getElementById(PREFIX + '-status-bar');
            var importAllBtn = document.getElementById(PREFIX + '-import-all-btn');

            var total = items.length;
            var matched = items.filter(function(i) { return i.status === 'matched'; }).length;
            var pending = items.filter(function(i) { return i.status === 'pending'; }).length;
            var noMatch = items.filter(function(i) { return i.status === 'no_match'; }).length;

            if (total > 0 && statsEl) {
                statsEl.style.display = 'flex';
                var set = function(id, val) { var el = document.getElementById(PREFIX + '-' + id); if (el) el.textContent = val; };
                set('stat-total', total);
                set('stat-matched', matched);
                set('stat-pending', pending);
                set('stat-nomatch', noMatch);

                var lastScanEl = document.getElementById(PREFIX + '-last-scan');
                if (lastScanEl && data.last_scan) {
                    try {
                        lastScanEl.textContent = 'Last scan: ' + new Date(data.last_scan).toLocaleString();
                    } catch (e) {
                        lastScanEl.textContent = '';
                    }
                }
            } else if (statsEl) {
                statsEl.style.display = 'none';
            }

            if (importAllBtn) importAllBtn.style.display = matched > 0 ? 'flex' : 'none';

            if (statusBar) {
                if (data.scan_in_progress) {
                    statusBar.style.display = 'flex';
                    var statusText = document.getElementById(PREFIX + '-status-text');
                    if (statusText) statusText.textContent = 'Scanning root folders and matching to TMDB... This may take a moment.';
                } else {
                    statusBar.style.display = 'none';
                }
            }
        },

        renderItems: function() {
            var self = this;
            var listEl = document.getElementById(PREFIX + '-list');
            if (!listEl) return;

            var emptyMsg = this.mode === 'tv'
                ? 'No unmapped series found. Click <strong>Scan Folders</strong> to detect TV series in your root folders that aren\'t in your TV Collection yet.'
                : 'No unmapped folders found. Click <strong>Scan Folders</strong> to detect movies in your root folders that aren\'t in your Movie Collection yet.';

            if (this.items.length === 0) {
                listEl.innerHTML = '<div class="import-media-empty"><i class="fas fa-folder-open"></i><p>' + emptyMsg + '</p></div>';
                return;
            }

            listEl.innerHTML = '';
            for (var i = 0; i < this.items.length; i++) {
                listEl.appendChild(self.createItemElement(this.items[i]));
            }
        },

        createItemElement: function(item) {
            var self = this;
            var div = document.createElement('div');
            div.className = 'import-media-item status-' + (item.status || 'pending');

            var posterUrl = './static/images/blackout.jpg';
            var matchHtml = '';
            var actionsHtml = '';

            if (item.status === 'matched' && item.best_match) {
                var m = item.best_match;
                if (m.poster_path) posterUrl = 'https://image.tmdb.org/t/p/w92' + m.poster_path;
                var scoreClass = m.score >= 70 ? 'high' : (m.score >= 40 ? 'medium' : 'low');
                matchHtml = '<div class="import-media-match-info">' +
                    '<div class="import-media-match-title">' + self.escapeHtml(m.title) + '</div>' +
                    '<div class="import-media-match-year">' + (m.year || '') + '</div>' +
                    '</div><div class="import-media-match-confidence">' +
                    '<div class="conf-label">Confidence</div>' +
                    '<div class="conf-value ' + scoreClass + '">' + m.score + '%</div></div>';
                actionsHtml = '<div class="import-media-actions">' +
                    '<button class="import-media-btn-confirm" data-path="' + self.escapeAttr(item.folder_path) + '"><i class="fas fa-check"></i> Import</button>' +
                    (item.matches && item.matches.length > 1 ? '<button class="import-media-btn-matches" data-path="' + self.escapeAttr(item.folder_path) + '"><i class="fas fa-list"></i></button>' : '') +
                    '<button class="import-media-btn-search" data-path="' + self.escapeAttr(item.folder_path) + '" data-title="' + self.escapeAttr(item.parsed_title) + '" data-year="' + self.escapeAttr(item.parsed_year) + '"><i class="fas fa-search"></i></button>' +
                    '<button class="import-media-btn-skip" data-path="' + self.escapeAttr(item.folder_path) + '"><i class="fas fa-times"></i></button></div>';
            } else if (item.status === 'no_match') {
                matchHtml = '<div class="import-media-match-info status-no-match-cell"><div class="import-media-no-match-text"><i class="fas fa-question-circle"></i> No match found</div></div><div class="import-media-match-confidence empty-cell"></div>';
                actionsHtml = '<div class="import-media-actions">' +
                    '<button class="import-media-btn-search" data-path="' + self.escapeAttr(item.folder_path) + '" data-title="' + self.escapeAttr(item.parsed_title) + '" data-year="' + self.escapeAttr(item.parsed_year) + '"><i class="fas fa-search"></i> Find</button>' +
                    '<button class="import-media-btn-skip" data-path="' + self.escapeAttr(item.folder_path) + '"><i class="fas fa-times"></i></button></div>';
            } else {
                matchHtml = '<div class="import-media-match-info status-pending-cell"><div class="import-media-pending-text"><i class="fas fa-hourglass-half"></i> Processing...</div></div><div class="import-media-match-confidence empty-cell"></div>';
                actionsHtml = '<div class="import-media-actions"></div>';
            }

            var sizeStr = item.file_size ? self.formatSize(item.file_size) : '';
            var qualityStr = item.parsed_quality || '';
            div.innerHTML = '<div class="import-media-poster"><img src="' + posterUrl + '" onerror="this.src=\'./static/images/blackout.jpg\'"></div>' +
                '<div class="import-media-info">' +
                '<div class="import-media-folder-name">' + self.escapeHtml(item.folder_name) + '</div>' +
                '<div class="import-media-folder-path">' + self.escapeHtml(item.root_folder) + '</div>' +
                '<div class="import-media-file-info">' +
                (sizeStr ? '<span><i class="fas fa-hdd"></i> ' + sizeStr + '</span>' : '') +
                (item.file_count ? '<span><i class="fas fa-file-video"></i> ' + item.file_count + ' file' + (item.file_count > 1 ? 's' : '') + '</span>' : '') +
                (qualityStr ? '<span><i class="fas fa-film"></i> ' + self.escapeHtml(qualityStr) + '</span>' : '') +
                '</div></div>' + matchHtml + actionsHtml;

            var confirmBtns = div.querySelectorAll('.import-media-btn-confirm');
            for (var j = 0; j < confirmBtns.length; j++) {
                confirmBtns[j].onclick = function() { self.confirmItem(this.getAttribute('data-path')); };
            }
            var searchBtns = div.querySelectorAll('.import-media-btn-search');
            for (var j = 0; j < searchBtns.length; j++) {
                searchBtns[j].onclick = function() {
                    self.openSearchModal(this.getAttribute('data-path'), this.getAttribute('data-title'), this.getAttribute('data-year'));
                };
            }
            var skipBtns = div.querySelectorAll('.import-media-btn-skip');
            for (var j = 0; j < skipBtns.length; j++) {
                skipBtns[j].onclick = function() { self.skipItem(this.getAttribute('data-path')); };
            }
            var matchBtns = div.querySelectorAll('.import-media-btn-matches');
            for (var j = 0; j < matchBtns.length; j++) {
                matchBtns[j].onclick = function(e) {
                    e.stopPropagation();
                    self.showAlternateMatches(this.getAttribute('data-path'), this);
                };
            }
            return div;
        },

        triggerScan: function() {
            var self = this;
            var btn = document.getElementById(PREFIX + '-scan-btn');
            if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Scanning...'; }

            var statusBar = document.getElementById(PREFIX + '-status-bar');
            if (statusBar) {
                statusBar.style.display = 'flex';
                var st = document.getElementById(PREFIX + '-status-text');
                if (st) st.textContent = 'Starting scan...';
            }

            fetch(this.getApiBase() + '/import-media/scan?' + this.getInstanceParam().replace('&', ''), { method: 'POST' })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.success) self.startPolling();
                    else {
                        if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification(data.message || 'Scan failed', 'error');
                        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-search"></i> Scan Folders'; }
                    }
                })
                .catch(function() {
                    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-search"></i> Scan Folders'; }
                });
        },

        startPolling: function() {
            var self = this;
            if (this.pollInterval) return;
            this.pollInterval = setInterval(function() { self.loadItems(); }, 2000);
        },

        stopPolling: function() {
            if (this.pollInterval) { clearInterval(this.pollInterval); this.pollInterval = null; }
            var btn = document.getElementById(PREFIX + '-scan-btn');
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-search"></i> Scan Folders'; }
        },

        confirmItem: function(folderPath) {
            var self = this;
            var item = this.findItemByPath(folderPath);
            if (!item || !item.best_match) return;
            var m = item.best_match;

            fetch(this.getApiBase() + '/import-media/confirm?' + this.getInstanceParam().replace('&', ''), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    folder_path: folderPath,
                    tmdb_id: m.tmdb_id,
                    title: m.title,
                    year: m.year || '',
                    poster_path: m.poster_path || '',
                    root_folder: item.root_folder || ''
                })
            })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.success) {
                        if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification(data.message || 'Imported!', 'success');
                        self.loadItems();
                    } else {
                        if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification(data.message || 'Import failed', data.already_exists ? 'info' : 'error');
                        if (data.already_exists) self.loadItems();
                    }
                });
        },

        importAll: function() {
            var self = this;
            var matched = this.items.filter(function(i) { return i.status === 'matched'; });
            if (matched.length === 0) return;
            var label = this.mode === 'tv' ? 'series' : 'movie';
            var plural = matched.length !== 1;

            if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
                window.HuntarrConfirm.show({
                    title: 'Import All Matched',
                    message: 'Import all ' + matched.length + ' matched ' + label + (plural ? 's' : '') + ' into your ' + (this.mode === 'tv' ? 'TV' : 'Movie') + ' Collection?\n\nItems already in your collection will be skipped.',
                    confirmLabel: 'Import All',
                    onConfirm: function() { self._doImportAll(); }
                });
            } else {
                if (!confirm('Import all ' + matched.length + ' matched ' + label + (plural ? 's' : '') + '?')) return;
                self._doImportAll();
            }
        },

        _doImportAll: function() {
            var self = this;
            fetch(this.getApiBase() + '/import-media/confirm-all?' + this.getInstanceParam().replace('&', ''), { method: 'POST' })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.success && window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification(data.message || 'All imported!', 'success');
                    else if (!data.success && window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification(data.message || 'Import failed', 'error');
                    self.loadItems();
                });
        },

        skipItem: function(folderPath) {
            var self = this;
            fetch(this.getApiBase() + '/import-media/skip?' + this.getInstanceParam().replace('&', ''), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ folder_path: folderPath })
            })
                .then(function(r) { return r.json(); })
                .then(function() { self.loadItems(); });
        },

        openSearchModal: function(folderPath, title, year) {
            this.currentSearchFolderPath = folderPath;
            var modal = document.getElementById(PREFIX + '-search-modal');
            if (!modal) return;
            if (modal.parentElement !== document.body) document.body.appendChild(modal);
            modal.style.display = 'flex';

            var folderLabel = document.getElementById(PREFIX + '-search-folder-name');
            if (folderLabel) {
                var item = this.findItemByPath(folderPath);
                folderLabel.textContent = item ? item.folder_name : folderPath;
            }

            var input = document.getElementById(PREFIX + '-search-input');
            var yearInput = document.getElementById(PREFIX + '-search-year');
            if (input) input.value = title || '';
            if (yearInput) yearInput.value = year || '';

            var results = document.getElementById(PREFIX + '-search-results');
            if (results) results.innerHTML = '<p class="import-media-search-hint">Search for the correct ' + (this.mode === 'tv' ? 'TV series' : 'movie') + ' title above.</p>';
            if (input) input.focus();
        },

        closeSearchModal: function() {
            var modal = document.getElementById(PREFIX + '-search-modal');
            if (modal) modal.style.display = 'none';
            this.currentSearchFolderPath = null;
        },

        performManualSearch: function() {
            var self = this;
            var input = document.getElementById(PREFIX + '-search-input');
            var yearInput = document.getElementById(PREFIX + '-search-year');
            var results = document.getElementById(PREFIX + '-search-results');
            if (!input || !results) return;
            var query = (input.value || '').trim();
            if (!query) return;
            var year = (yearInput && yearInput.value || '').trim();

            results.innerHTML = '<p class="import-media-search-hint"><i class="fas fa-spinner fa-spin"></i> Searching...</p>';

            var url = this.getApiBase() + '/import-media/search?q=' + encodeURIComponent(query);
            if (year) url += '&year=' + encodeURIComponent(year);

            fetch(url)
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (!data.success || !data.results || data.results.length === 0) {
                        results.innerHTML = '<p class="import-media-search-hint">No results found. Try a different title.</p>';
                        return;
                    }
                    results.innerHTML = '';
                    for (var i = 0; i < data.results.length; i++) {
                        var r = data.results[i];
                        var el = document.createElement('div');
                        el.className = 'import-media-search-result';
                        var posterUrl = r.poster_path ? 'https://image.tmdb.org/t/p/w92' + r.poster_path : './static/images/blackout.jpg';
                        var overview = (r.overview || '').substring(0, 120);
                        if (overview.length >= 120) overview += '...';
                        el.innerHTML = '<div class="import-media-search-result-poster"><img src="' + posterUrl + '" onerror="this.src=\'./static/images/blackout.jpg\'"></div>' +
                            '<div class="import-media-search-result-info">' +
                            '<div class="import-media-search-result-title">' + self.escapeHtml(r.title) + '</div>' +
                            '<div class="import-media-search-result-meta">' + (r.year || 'N/A') + ' &middot; ' + (r.vote_average || 0).toFixed(1) + ' <i class="fas fa-star" style="font-size:0.7em;color:#fbbf24;"></i></div>' +
                            (overview ? '<div class="import-media-search-result-overview">' + self.escapeHtml(overview) + '</div>' : '') +
                            '</div><button class="select-btn" data-tmdb-id="' + r.tmdb_id + '" data-title="' + self.escapeAttr(r.title) + '" data-year="' + self.escapeAttr(r.year || '') + '" data-poster="' + self.escapeAttr(r.poster_path || '') + '">Select</button>';
                        results.appendChild(el);
                    }
                    var selectBtns = results.querySelectorAll('.select-btn');
                    for (var j = 0; j < selectBtns.length; j++) {
                        selectBtns[j].onclick = function(e) {
                            e.stopPropagation();
                            self.selectSearchResult(parseInt(this.getAttribute('data-tmdb-id')), this.getAttribute('data-title'), this.getAttribute('data-year'), this.getAttribute('data-poster'));
                        };
                    }
                })
                .catch(function() {
                    results.innerHTML = '<p class="import-media-search-hint">Search failed. Please try again.</p>';
                });
        },

        selectSearchResult: function(tmdbId, title, year, posterPath) {
            var self = this;
            if (!this.currentSearchFolderPath) return;
            var item = this.findItemByPath(this.currentSearchFolderPath);
            if (!item) return;

            fetch(this.getApiBase() + '/import-media/confirm?' + this.getInstanceParam().replace('&', ''), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    folder_path: this.currentSearchFolderPath,
                    tmdb_id: tmdbId,
                    title: title,
                    year: year || '',
                    poster_path: posterPath || '',
                    root_folder: item.root_folder || ''
                })
            })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.success) {
                        if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification(data.message || 'Imported!', 'success');
                        self.closeSearchModal();
                        self.loadItems();
                    } else {
                        if (window.huntarrUI && window.huntarrUI.showNotification) window.huntarrUI.showNotification(data.message || 'Import failed', data.already_exists ? 'info' : 'error');
                        if (data.already_exists) { self.closeSearchModal(); self.loadItems(); }
                    }
                });
        },

        showAlternateMatches: function(folderPath, btnEl) {
            var self = this;
            var item = this.findItemByPath(folderPath);
            if (!item || !item.matches || item.matches.length < 2) return;

            var existing = document.querySelector('.import-media-matches-dropdown');
            if (existing) existing.remove();

            var dropdown = document.createElement('div');
            dropdown.className = 'import-media-matches-dropdown';
            for (var i = 1; i < item.matches.length; i++) {
                var m = item.matches[i];
                var el = document.createElement('div');
                el.className = 'import-media-matches-dropdown-item';
                var posterUrl = m.poster_path ? 'https://image.tmdb.org/t/p/w92' + m.poster_path : './static/images/blackout.jpg';
                el.innerHTML = '<div class="poster"><img src="' + posterUrl + '" onerror="this.src=\'./static/images/blackout.jpg\'"></div><div class="info"><div class="title">' + self.escapeHtml(m.title) + '</div><div class="year">' + (m.year || '') + ' &middot; ' + m.score + '%</div></div>';
                (function(match) {
                    el.onclick = function() {
                        item.best_match = match;
                        dropdown.remove();
                        self.renderItems();
                    };
                })(m);
                dropdown.appendChild(el);
            }
            var parent = btnEl.closest('.import-media-item');
            if (parent) { parent.style.position = 'relative'; parent.appendChild(dropdown); }
            setTimeout(function() {
                document.addEventListener('click', function closeDropdown(e) {
                    if (!dropdown.contains(e.target)) { dropdown.remove(); document.removeEventListener('click', closeDropdown); }
                });
            }, 10);
        },

        findItemByPath: function(path) {
            for (var i = 0; i < this.items.length; i++) {
                if (this.items[i].folder_path === path) return this.items[i];
            }
            return null;
        },

        formatSize: function(bytes) {
            if (!bytes) return '';
            if (bytes >= 1e12) return (bytes / 1e12).toFixed(1) + ' TB';
            if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + ' GB';
            if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + ' MB';
            return (bytes / 1e3).toFixed(0) + ' KB';
        },

        escapeHtml: function(str) {
            if (!str) return '';
            return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        },

        escapeAttr: function(str) {
            if (!str) return '';
            return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }
    };
})();
