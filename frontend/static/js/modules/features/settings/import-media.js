/**
 * Import Media — Unmapped folder import system for Movie Hunt.
 * Scans root folders, matches to TMDB, lets user confirm and import.
 */
(function() {
    'use strict';

    window.ImportMedia = {
        items: [],
        instanceId: null,
        pollInterval: null,
        currentSearchFolderPath: null,

        init: function() {
            var self = this;
            this.setupInstanceSelect();
            this.setupScanButton();
            this.setupImportAllButton();
            this.setupSearchModal();
            this.loadItems();
        },

        setupInstanceSelect: function() {
            var select = document.getElementById('import-media-instance-select');
            if (!select) return;
            if (window.MovieHuntInstanceDropdown && window.MovieHuntInstanceDropdown.attach) {
                window.MovieHuntInstanceDropdown.attach('import-media-instance-select', function() {
                    window.ImportMedia.loadItems();
                });
            } else {
                select.innerHTML = '<option value="1">Default Instance</option>';
            }
        },

        setupScanButton: function() {
            var btn = document.getElementById('import-media-scan-btn');
            if (!btn) return;
            btn.onclick = function() {
                window.ImportMedia.triggerScan();
            };
        },

        setupImportAllButton: function() {
            var btn = document.getElementById('import-media-import-all-btn');
            if (!btn) return;
            btn.onclick = function() {
                window.ImportMedia.importAll();
            };
        },

        setupSearchModal: function() {
            var self = this;
            var backdrop = document.getElementById('import-media-search-backdrop');
            var closeBtn = document.getElementById('import-media-search-close');
            var searchBtn = document.getElementById('import-media-search-go-btn');
            var input = document.getElementById('import-media-search-input');

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
            var select = document.getElementById('import-media-instance-select');
            return select && select.value ? '&instance_id=' + encodeURIComponent(select.value) : '';
        },

        loadItems: function() {
            var self = this;
            var listEl = document.getElementById('import-media-list');
            if (!listEl) return;

            fetch('./api/movie-hunt/import-media?' + self.getInstanceParam().replace('&', ''))
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (!data.success) {
                        listEl.innerHTML = '<div class="import-media-empty"><i class="fas fa-exclamation-triangle"></i><p>Failed to load import media data.</p></div>';
                        return;
                    }

                    self.items = data.items || [];
                    self.updateStats(data);
                    self.renderItems();

                    // If scan is in progress, start polling
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
            var statsEl = document.getElementById('import-media-stats');
            var statusBar = document.getElementById('import-media-status-bar');
            var importAllBtn = document.getElementById('import-media-import-all-btn');

            var total = items.length;
            var matched = items.filter(function(i) { return i.status === 'matched'; }).length;
            var pending = items.filter(function(i) { return i.status === 'pending'; }).length;
            var noMatch = items.filter(function(i) { return i.status === 'no_match'; }).length;

            if (total > 0 && statsEl) {
                statsEl.style.display = 'flex';
                var el;
                el = document.getElementById('import-media-stat-total');
                if (el) el.textContent = total;
                el = document.getElementById('import-media-stat-matched');
                if (el) el.textContent = matched;
                el = document.getElementById('import-media-stat-pending');
                if (el) el.textContent = pending;
                el = document.getElementById('import-media-stat-nomatch');
                if (el) el.textContent = noMatch;

                var lastScanEl = document.getElementById('import-media-last-scan');
                if (lastScanEl && data.last_scan) {
                    try {
                        var d = new Date(data.last_scan);
                        lastScanEl.textContent = 'Last scan: ' + d.toLocaleString();
                    } catch (e) {
                        lastScanEl.textContent = '';
                    }
                }
            } else if (statsEl) {
                statsEl.style.display = 'none';
            }

            // Show/hide import all button
            if (importAllBtn) {
                importAllBtn.style.display = matched > 0 ? 'flex' : 'none';
            }

            // Show/hide scan status
            if (statusBar) {
                if (data.scan_in_progress) {
                    statusBar.style.display = 'flex';
                    var statusText = document.getElementById('import-media-status-text');
                    if (statusText) statusText.textContent = 'Scanning root folders and matching to TMDB... This may take a moment.';
                } else {
                    statusBar.style.display = 'none';
                }
            }
        },

        renderItems: function() {
            var self = this;
            var listEl = document.getElementById('import-media-list');
            if (!listEl) return;

            if (this.items.length === 0) {
                listEl.innerHTML = '<div class="import-media-empty"><i class="fas fa-folder-open"></i>' +
                    '<p>No unmapped folders found. Click <strong>Scan Folders</strong> to detect movies in your root folders that aren\'t in your Media Collection yet.</p></div>';
                return;
            }

            listEl.innerHTML = '';

            for (var i = 0; i < this.items.length; i++) {
                var item = this.items[i];
                listEl.appendChild(self.createItemElement(item));
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
                if (m.poster_path) {
                    posterUrl = 'https://image.tmdb.org/t/p/w92' + m.poster_path;
                }

                var scoreClass = m.score >= 70 ? 'high' : (m.score >= 40 ? 'medium' : 'low');

                matchHtml = '<div class="import-media-match-info">' +
                    '<div class="import-media-match-title">' + self.escapeHtml(m.title) + '</div>' +
                    '<div class="import-media-match-year">' + (m.year || '') + '</div>' +
                    '</div>' +
                    '<div class="import-media-match-confidence">' +
                    '<div class="conf-label">Confidence</div>' +
                    '<div class="conf-value ' + scoreClass + '">' + m.score + '%</div>' +
                    '</div>';

                actionsHtml = '<div class="import-media-actions">' +
                    '<button class="import-media-btn-confirm" data-path="' + self.escapeAttr(item.folder_path) + '"><i class="fas fa-check"></i> Import</button>' +
                    (item.matches && item.matches.length > 1 ? '<button class="import-media-btn-matches" data-path="' + self.escapeAttr(item.folder_path) + '"><i class="fas fa-list"></i></button>' : '') +
                    '<button class="import-media-btn-search" data-path="' + self.escapeAttr(item.folder_path) + '" data-title="' + self.escapeAttr(item.parsed_title) + '" data-year="' + self.escapeAttr(item.parsed_year) + '"><i class="fas fa-search"></i></button>' +
                    '<button class="import-media-btn-skip" data-path="' + self.escapeAttr(item.folder_path) + '"><i class="fas fa-times"></i></button>' +
                    '</div>';
            } else if (item.status === 'no_match') {
                matchHtml = '<div class="import-media-match-info status-no-match-cell">' +
                    '<div class="import-media-no-match-text"><i class="fas fa-question-circle"></i> No match found</div>' +
                    '</div>' +
                    '<div class="import-media-match-confidence empty-cell"></div>';

                actionsHtml = '<div class="import-media-actions">' +
                    '<button class="import-media-btn-search" data-path="' + self.escapeAttr(item.folder_path) + '" data-title="' + self.escapeAttr(item.parsed_title) + '" data-year="' + self.escapeAttr(item.parsed_year) + '"><i class="fas fa-search"></i> Find</button>' +
                    '<button class="import-media-btn-skip" data-path="' + self.escapeAttr(item.folder_path) + '"><i class="fas fa-times"></i></button>' +
                    '</div>';
            } else {
                matchHtml = '<div class="import-media-match-info status-pending-cell">' +
                    '<div class="import-media-pending-text"><i class="fas fa-hourglass-half"></i> Processing...</div>' +
                    '</div>' +
                    '<div class="import-media-match-confidence empty-cell"></div>';
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
                '</div></div>' +
                matchHtml + actionsHtml;

            // Attach event handlers
            var confirmBtns = div.querySelectorAll('.import-media-btn-confirm');
            for (var j = 0; j < confirmBtns.length; j++) {
                confirmBtns[j].onclick = function() {
                    var path = this.getAttribute('data-path');
                    self.confirmItem(path);
                };
            }

            var searchBtns = div.querySelectorAll('.import-media-btn-search');
            for (var j = 0; j < searchBtns.length; j++) {
                searchBtns[j].onclick = function() {
                    var path = this.getAttribute('data-path');
                    var title = this.getAttribute('data-title');
                    var year = this.getAttribute('data-year');
                    self.openSearchModal(path, title, year);
                };
            }

            var skipBtns = div.querySelectorAll('.import-media-btn-skip');
            for (var j = 0; j < skipBtns.length; j++) {
                skipBtns[j].onclick = function() {
                    var path = this.getAttribute('data-path');
                    self.skipItem(path);
                };
            }

            var matchBtns = div.querySelectorAll('.import-media-btn-matches');
            for (var j = 0; j < matchBtns.length; j++) {
                matchBtns[j].onclick = function(e) {
                    e.stopPropagation();
                    var path = this.getAttribute('data-path');
                    self.showAlternateMatches(path, this);
                };
            }

            return div;
        },

        triggerScan: function() {
            var self = this;
            var btn = document.getElementById('import-media-scan-btn');
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Scanning...';
            }

            var statusBar = document.getElementById('import-media-status-bar');
            if (statusBar) {
                statusBar.style.display = 'flex';
                var statusText = document.getElementById('import-media-status-text');
                if (statusText) statusText.textContent = 'Starting scan...';
            }

            fetch('./api/movie-hunt/import-media/scan?' + self.getInstanceParam().replace('&', ''), {
                method: 'POST'
            })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.success) {
                        self.startPolling();
                    } else {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification(data.message || 'Scan failed', 'error');
                        }
                        if (btn) {
                            btn.disabled = false;
                            btn.innerHTML = '<i class="fas fa-search"></i> Scan Folders';
                        }
                    }
                })
                .catch(function(err) {
                    console.error('Scan trigger error:', err);
                    if (btn) {
                        btn.disabled = false;
                        btn.innerHTML = '<i class="fas fa-search"></i> Scan Folders';
                    }
                });
        },

        startPolling: function() {
            var self = this;
            if (this.pollInterval) return;
            this.pollInterval = setInterval(function() {
                self.loadItems();
            }, 3000);
        },

        stopPolling: function() {
            if (this.pollInterval) {
                clearInterval(this.pollInterval);
                this.pollInterval = null;
            }
            var btn = document.getElementById('import-media-scan-btn');
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-search"></i> Scan Folders';
            }
        },

        confirmItem: function(folderPath) {
            var self = this;
            var item = this.findItemByPath(folderPath);
            if (!item || !item.best_match) return;

            var m = item.best_match;
            fetch('./api/movie-hunt/import-media/confirm?' + self.getInstanceParam().replace('&', ''), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    folder_path: folderPath,
                    tmdb_id: m.tmdb_id,
                    title: m.title,
                    year: m.year || '',
                    poster_path: m.poster_path || '',
                    root_folder: item.root_folder || '',
                })
            })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.success) {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification(data.message || 'Imported!', 'success');
                        }
                        self.loadItems();
                    } else {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification(data.message || 'Import failed', data.already_exists ? 'info' : 'error');
                        }
                        if (data.already_exists) {
                            self.loadItems();
                        }
                    }
                })
                .catch(function(err) {
                    console.error('Confirm error:', err);
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification('Import failed', 'error');
                    }
                });
        },

        importAll: function() {
            var self = this;
            var matched = this.items.filter(function(i) { return i.status === 'matched'; });
            if (matched.length === 0) return;

            if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
                window.HuntarrConfirm.show({
                    title: 'Import All Matched',
                    message: 'Import all ' + matched.length + ' matched movie' + (matched.length !== 1 ? 's' : '') + ' into your Media Collection?\n\nMovies already in your collection will be skipped.',
                    confirmLabel: 'Import All',
                    onConfirm: function() { self._doImportAll(); }
                });
            } else {
                if (!confirm('Import all ' + matched.length + ' matched movies?')) return;
                self._doImportAll();
            }
        },

        _doImportAll: function() {
            var self = this;
            fetch('./api/movie-hunt/import-media/confirm-all?' + self.getInstanceParam().replace('&', ''), {
                method: 'POST'
            })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.success) {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification(data.message || 'All imported!', 'success');
                        }
                    } else {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification(data.message || 'Import failed', 'error');
                        }
                    }
                    self.loadItems();
                })
                .catch(function(err) {
                    console.error('Import all error:', err);
                });
        },

        skipItem: function(folderPath) {
            var self = this;
            fetch('./api/movie-hunt/import-media/skip?' + self.getInstanceParam().replace('&', ''), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ folder_path: folderPath })
            })
                .then(function(r) { return r.json(); })
                .then(function() { self.loadItems(); })
                .catch(function(err) { console.error('Skip error:', err); });
        },

        openSearchModal: function(folderPath, title, year) {
            this.currentSearchFolderPath = folderPath;
            var modal = document.getElementById('import-media-search-modal');
            if (!modal) return;

            // Move to body for proper z-index
            if (modal.parentElement !== document.body) {
                document.body.appendChild(modal);
            }

            modal.style.display = 'flex';
            var folderLabel = document.getElementById('import-media-search-folder-name');
            if (folderLabel) {
                var item = this.findItemByPath(folderPath);
                folderLabel.textContent = item ? item.folder_name : folderPath;
            }

            var input = document.getElementById('import-media-search-input');
            var yearInput = document.getElementById('import-media-search-year');
            if (input) input.value = title || '';
            if (yearInput) yearInput.value = year || '';

            var results = document.getElementById('import-media-search-results');
            if (results) results.innerHTML = '<p class="import-media-search-hint">Search for the correct movie title above.</p>';

            if (input) input.focus();
        },

        closeSearchModal: function() {
            var modal = document.getElementById('import-media-search-modal');
            if (modal) modal.style.display = 'none';
            this.currentSearchFolderPath = null;
        },

        performManualSearch: function() {
            var self = this;
            var input = document.getElementById('import-media-search-input');
            var yearInput = document.getElementById('import-media-search-year');
            var results = document.getElementById('import-media-search-results');
            if (!input || !results) return;

            var query = (input.value || '').trim();
            if (!query) return;
            var year = (yearInput && yearInput.value || '').trim();

            results.innerHTML = '<p class="import-media-search-hint"><i class="fas fa-spinner fa-spin"></i> Searching...</p>';

            var url = './api/movie-hunt/import-media/search?q=' + encodeURIComponent(query);
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
                            '</div>' +
                            '<button class="select-btn" data-tmdb-id="' + r.tmdb_id + '" data-title="' + self.escapeAttr(r.title) + '" data-year="' + self.escapeAttr(r.year || '') + '" data-poster="' + self.escapeAttr(r.poster_path || '') + '">Select</button>';

                        results.appendChild(el);
                    }

                    // Attach select handlers
                    var selectBtns = results.querySelectorAll('.select-btn');
                    for (var j = 0; j < selectBtns.length; j++) {
                        selectBtns[j].onclick = function(e) {
                            e.stopPropagation();
                            var tmdbId = parseInt(this.getAttribute('data-tmdb-id'));
                            var title = this.getAttribute('data-title');
                            var year = this.getAttribute('data-year');
                            var poster = this.getAttribute('data-poster');
                            self.selectSearchResult(tmdbId, title, year, poster);
                        };
                    }
                })
                .catch(function(err) {
                    console.error('Manual search error:', err);
                    results.innerHTML = '<p class="import-media-search-hint">Search failed. Please try again.</p>';
                });
        },

        selectSearchResult: function(tmdbId, title, year, posterPath) {
            var self = this;
            if (!this.currentSearchFolderPath) return;

            var folderPath = this.currentSearchFolderPath;
            var item = this.findItemByPath(folderPath);
            if (!item) return;

            // Import directly with the selected match
            fetch('./api/movie-hunt/import-media/confirm?' + self.getInstanceParam().replace('&', ''), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    folder_path: folderPath,
                    tmdb_id: tmdbId,
                    title: title,
                    year: year || '',
                    poster_path: posterPath || '',
                    root_folder: item.root_folder || '',
                })
            })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.success) {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification(data.message || 'Imported!', 'success');
                        }
                        self.closeSearchModal();
                        self.loadItems();
                    } else {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification(data.message || 'Import failed', data.already_exists ? 'info' : 'error');
                        }
                        if (data.already_exists) {
                            self.closeSearchModal();
                            self.loadItems();
                        }
                    }
                })
                .catch(function(err) {
                    console.error('Select result error:', err);
                });
        },

        showAlternateMatches: function(folderPath, btnEl) {
            var self = this;
            var item = this.findItemByPath(folderPath);
            if (!item || !item.matches || item.matches.length < 2) return;

            // Close any existing dropdown
            var existing = document.querySelector('.import-media-matches-dropdown');
            if (existing) existing.remove();

            var dropdown = document.createElement('div');
            dropdown.className = 'import-media-matches-dropdown';

            for (var i = 1; i < item.matches.length; i++) {
                var m = item.matches[i];
                var el = document.createElement('div');
                el.className = 'import-media-matches-dropdown-item';

                var posterUrl = m.poster_path ? 'https://image.tmdb.org/t/p/w92' + m.poster_path : './static/images/blackout.jpg';

                el.innerHTML = '<div class="poster"><img src="' + posterUrl + '" onerror="this.src=\'./static/images/blackout.jpg\'"></div>' +
                    '<div class="info"><div class="title">' + self.escapeHtml(m.title) + '</div><div class="year">' + (m.year || '') + ' &middot; ' + m.score + '%</div></div>';

                (function(match) {
                    el.onclick = function() {
                        // Switch best match
                        item.best_match = match;
                        dropdown.remove();
                        self.renderItems();
                    };
                })(m);

                dropdown.appendChild(el);
            }

            // Position near the button
            var parent = btnEl.closest('.import-media-item');
            if (parent) {
                parent.style.position = 'relative';
                parent.appendChild(dropdown);
            }

            // Close on outside click
            setTimeout(function() {
                document.addEventListener('click', function closeDropdown(e) {
                    if (!dropdown.contains(e.target)) {
                        dropdown.remove();
                        document.removeEventListener('click', closeDropdown);
                    }
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
