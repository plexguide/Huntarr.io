/**
 * Indexer Management – single view for Movie Hunt and TV Hunt. Combined instance dropdown
 * (Movie - X / TV - X, alphabetical). Each instance keeps its own indexers; same page linked from both sidebars.
 */
(function() {
    'use strict';
    if (typeof window.SettingsForms === 'undefined') return;

    const Forms = window.SettingsForms;
    Forms._indexersMode = 'movie';

    Forms.getIndexersApiBase = function() {
        return this._indexersMode === 'tv' ? './api/tv-hunt/indexers' : './api/indexers';
    };
    Forms.getIndexersInstanceApiBase = function(mode) {
        return mode === 'tv' ? './api/tv-hunt' : './api/movie-hunt';
    };

    Forms.renderIndexerCard = function(indexer, index) {
        const isDefault = index === 0;
        const isTV = Forms._indexersMode === 'tv';
        const indexerIdAttr = (isTV && indexer.id) ? ' data-indexer-id="' + String(indexer.id).replace(/"/g, '&quot;') + '"' : '';
        const headerName = indexer.name || 'Unnamed';
        const name = headerName.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const last4 = indexer.api_key_last4 || (indexer.api_key && indexer.api_key.slice(-4)) || '****';
        const preset = (indexer.preset || 'manual').replace(/"/g, '&quot;');
        const enabled = indexer.enabled !== false;
        const statusClass = enabled ? 'status-connected' : 'status-error';
        const statusIcon = enabled ? 'fa-check-circle' : 'fa-minus-circle';
        const isIH = !!(indexer.indexer_hunt_id);
        var urlDisplay = '';
        var rawUrl = indexer.url || indexer.api_url || '';
        if (!rawUrl && window.INDEXER_PRESET_META && window.INDEXER_PRESET_META[preset]) {
            rawUrl = window.INDEXER_PRESET_META[preset].url || '';
        }
        if (rawUrl) {
            var shortUrl = rawUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
            if (shortUrl.length > 30) shortUrl = shortUrl.substring(0, 28) + '\u2026';
            urlDisplay = '<div class="instance-detail"><i class="fas fa-link"></i><span>' + shortUrl.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span></div>';
        }
        // IH linked badge (movie only)
        var ihBadge = isIH && !isTV ? '<span style="font-size:0.65rem;background:rgba(99,102,241,0.15);color:#818cf8;padding:2px 6px;border-radius:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-left:6px;">Synced</span>' : '';

        return '<div class="instance-card ' + (isDefault ? 'default-instance' : '') + '" data-instance-index="' + index + '"' + indexerIdAttr + ' data-app-type="indexer" data-preset="' + preset + '" data-enabled="' + enabled + '" data-ih="' + (isIH ? '1' : '0') + '">' +
            '<div class="instance-card-header">' +
            '<div class="instance-name instance-name-with-priority"><i class="fas fa-server"></i><span>' + name + '</span>' + (isDefault ? '<span class="default-badge">Default</span>' : '') + ihBadge + '</div>' +
            '<div class="instance-status-icon ' + statusClass + '"><i class="fas ' + statusIcon + '"></i></div>' +
            '</div>' +
            '<div class="instance-card-body">' +
            urlDisplay +
            '<div class="instance-detail"><i class="fas fa-key"></i><span>\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' + last4 + '</span></div>' +
            '<div class="instance-detail"><i class="fas fa-sort-numeric-down"></i><span>Priority: ' + (indexer.priority || 50) + '</span></div>' +
            '</div>' +
            '<div class="instance-card-footer">' +
            '<button type="button" class="btn-card edit" data-app-type="indexer" data-instance-index="' + index + '"><i class="fas fa-edit"></i> Edit</button>' +
            '<button type="button" class="btn-card delete" data-app-type="indexer" data-instance-index="' + index + '"><i class="fas fa-trash"></i> Delete</button>' +
            '</div></div>';
    };

    Forms.setCurrentInstanceAndRefreshIndexers = function(mode, instanceId) {
        Forms._indexersMode = mode;
        var apiBase = Forms.getIndexersInstanceApiBase(mode);
        fetch(apiBase + '/instances/current', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ instance_id: parseInt(instanceId, 10) })
        }).then(function(r) { return r.json(); }).then(function() {
            Forms.refreshIndexersList();
        }).catch(function() {
            Forms.refreshIndexersList();
        });
    };

    Forms.populateCombinedIndexersDropdown = function(preferMode) {
        var selectEl = document.getElementById('settings-indexers-instance-select');
        if (!selectEl) return;
        selectEl.innerHTML = '<option value="">Loading...</option>';
        var ts = Date.now();
        Promise.all([
            fetch('./api/movie-hunt/instances?t=' + ts, { cache: 'no-store' }).then(function(r) { return r.json(); }),
            fetch('./api/tv-hunt/instances?t=' + ts, { cache: 'no-store' }).then(function(r) { return r.json(); }),
            fetch('./api/movie-hunt/instances/current?t=' + ts, { cache: 'no-store' }).then(function(r) { return r.json(); }),
            fetch('./api/tv-hunt/instances/current?t=' + ts, { cache: 'no-store' }).then(function(r) { return r.json(); })
        ]).then(function(results) {
            var movieList = (results[0].instances || []).map(function(inst) {
                return { value: 'movie:' + inst.id, label: 'Movie - ' + (inst.name || 'Instance ' + inst.id) };
            });
            var tvList = (results[1].instances || []).map(function(inst) {
                return { value: 'tv:' + inst.id, label: 'TV - ' + (inst.name || 'Instance ' + inst.id) };
            });
            var combined = movieList.concat(tvList);
            combined.sort(function(a, b) { return (a.label || '').localeCompare(b.label || '', undefined, { sensitivity: 'base' }); });
            var currentMovie = results[2].current_instance_id != null ? Number(results[2].current_instance_id) : null;
            var currentTv = results[3].current_instance_id != null ? Number(results[3].current_instance_id) : null;
            selectEl.innerHTML = '';
            if (combined.length === 0) {
                var emptyOpt = document.createElement('option');
                emptyOpt.value = '';
                emptyOpt.textContent = 'No Movie or TV Hunt instances';
                selectEl.appendChild(emptyOpt);
                return;
            }
            combined.forEach(function(item) {
                var opt = document.createElement('option');
                opt.value = item.value;
                opt.textContent = item.label;
                selectEl.appendChild(opt);
            });
            var saved = (typeof localStorage !== 'undefined' && localStorage.getItem('media-hunt-indexers-last-instance')) || '';
            var selected = '';
            if (preferMode === 'movie' && currentMovie != null) {
                selected = 'movie:' + currentMovie;
                if (!combined.some(function(i) { return i.value === selected; })) selected = combined[0].value;
            } else if (preferMode === 'tv' && currentTv != null) {
                selected = 'tv:' + currentTv;
                if (!combined.some(function(i) { return i.value === selected; })) selected = combined[0].value;
            } else if (saved && combined.some(function(i) { return i.value === saved; })) {
                selected = saved;
            } else if (currentMovie != null && combined.some(function(i) { return i.value === 'movie:' + currentMovie; })) {
                selected = 'movie:' + currentMovie;
            } else if (currentTv != null && combined.some(function(i) { return i.value === 'tv:' + currentTv; })) {
                selected = 'tv:' + currentTv;
            } else {
                selected = combined[0].value;
            }
            selectEl.value = selected;
            var parts = (selected || '').split(':');
            if (parts.length === 2) {
                var m = parts[0] === 'tv' ? 'tv' : 'movie';
                if (typeof localStorage !== 'undefined') localStorage.setItem('media-hunt-indexers-last-instance', selected);
                Forms.setCurrentInstanceAndRefreshIndexers(m, parts[1]);
            }
        }).catch(function() {
            selectEl.innerHTML = '<option value="">Failed to load instances</option>';
        });
    };

    Forms.onCombinedIndexersInstanceChange = function() {
        var selectEl = document.getElementById('settings-indexers-instance-select');
        var val = (selectEl && selectEl.value) ? selectEl.value.trim() : '';
        if (!val) return;
        var parts = val.split(':');
        if (parts.length !== 2) return;
        var mode = parts[0] === 'tv' ? 'tv' : 'movie';
        if (typeof localStorage !== 'undefined') localStorage.setItem('media-hunt-indexers-last-instance', val);
        Forms.setCurrentInstanceAndRefreshIndexers(mode, parts[1]);
    };

    Forms.initOrRefreshIndexers = function(preferMode) {
        var selectEl = document.getElementById('settings-indexers-instance-select');
        if (!selectEl) return;
        if (!selectEl._indexersChangeBound) {
            selectEl.addEventListener('change', function() { Forms.onCombinedIndexersInstanceChange(); });
            selectEl._indexersChangeBound = true;
        }
        Forms.populateCombinedIndexersDropdown(preferMode);
    };

    Forms.refreshIndexersList = function() {
        var unifiedGrid = document.getElementById('indexer-instances-grid-unified');
        var legacyGrid = document.getElementById('indexer-instances-grid');

        var apiBase = Forms.getIndexersApiBase();
        fetch(apiBase)
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var list = (data && data.indexers) ? data.indexers : [];
                window.SettingsForms._indexersList = list;

                // Unified grid: all indexers in one list with same sub-stats (API, key, priority)
                var allHtml = '';
                for (var i = 0; i < list.length; i++) {
                    allHtml += window.SettingsForms.renderIndexerCard(list[i], i);
                }
                allHtml += '<div class="add-instance-card" data-app-type="indexer" data-source="indexer-hunt"><div class="add-icon"><i class="fas fa-download" style="color: #6366f1;"></i></div><div class="add-text">Import from Index Master</div></div>';

                if (unifiedGrid) {
                    unifiedGrid.innerHTML = allHtml;
                }

                if (legacyGrid && !unifiedGrid) {
                    var legHtml = '';
                    for (var j = 0; j < list.length; j++) {
                        legHtml += window.SettingsForms.renderIndexerCard(list[j], j);
                    }
                    legHtml += '<div class="add-instance-card" data-app-type="indexer"><div class="add-icon"><i class="fas fa-plus-circle"></i></div><div class="add-text">Add Indexer</div></div>';
                    legacyGrid.innerHTML = legHtml;
                }
            })
            .catch(function() {
                if (unifiedGrid) unifiedGrid.innerHTML = '<div class="add-instance-card" data-app-type="indexer" data-source="indexer-hunt"><div class="add-icon"><i class="fas fa-download" style="color: #6366f1;"></i></div><div class="add-text">Import from Index Master</div></div>';
            });
    };

    function isIndexersUIVisible() {
        var settingsSection = document.getElementById('settingsIndexersSection');
        var indexMasterSection = document.getElementById('indexer-hunt-section');
        return (settingsSection && settingsSection.classList.contains('active')) ||
               (indexMasterSection && indexMasterSection.classList.contains('active'));
    }

    // Delegated Edit/Delete for instance indexer cards (unified and legacy grids)
    function onIndexerGridClick(e) {
        var grid = e.target.closest('#indexer-instances-grid-unified, #indexer-instances-grid');
        if (!grid) return;
        var editBtn = e.target.closest('.btn-card.edit[data-app-type="indexer"]');
        var deleteBtn = e.target.closest('.btn-card.delete[data-app-type="indexer"]');
        if (editBtn) {
            e.preventDefault();
            e.stopPropagation();
            var card = editBtn.closest('.instance-card');
            if (!card) return;
            var index = parseInt(card.getAttribute('data-instance-index'), 10);
            if (isNaN(index)) return;
            var list = window.SettingsForms._indexersList;
            if (!list || index < 0 || index >= list.length) return;
            if (window.SettingsForms.openIndexerEditor) {
                window.SettingsForms.openIndexerEditor(false, index, list[index]);
            }
            return;
        }
        if (deleteBtn) {
            e.preventDefault();
            e.stopPropagation();
            var card = deleteBtn.closest('.instance-card');
            if (!card) return;
            var index = parseInt(card.getAttribute('data-instance-index'), 10);
            if (isNaN(index)) return;
            var list = window.SettingsForms._indexersList;
            if (!list || index < 0 || index >= list.length) return;
            var indexer = list[index];
            var name = (indexer && indexer.name) ? indexer.name : 'Unnamed';
            var isTV = Forms._indexersMode === 'tv';
            var deleteId = isTV && indexer && indexer.id ? indexer.id : index;
            if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
                window.HuntarrConfirm.show({
                    title: 'Delete Indexer',
                    message: 'Are you sure you want to remove "' + name + '" from this instance? It will no longer be used for searches.',
                    confirmLabel: 'Delete',
                    onConfirm: function() {
                        var apiBase = Forms.getIndexersApiBase();
                        var url = apiBase + '/' + encodeURIComponent(String(deleteId));
                        fetch(url, { method: 'DELETE' })
                            .then(function(r) { return r.json(); })
                            .then(function(data) {
                                if (data.success !== false) {
                                    if (window.SettingsForms && window.SettingsForms.refreshIndexersList) {
                                        window.SettingsForms.refreshIndexersList();
                                    }
                                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                                        window.huntarrUI.showNotification('Indexer removed.', 'success');
                                    }
                                } else {
                                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                                        window.huntarrUI.showNotification(data.error || 'Failed to remove indexer.', 'error');
                                    }
                                }
                            })
                            .catch(function() {
                                if (window.huntarrUI && window.huntarrUI.showNotification) {
                                    window.huntarrUI.showNotification('Failed to remove indexer.', 'error');
                                }
                            });
                    }
                });
            }
        }
    }

    document.addEventListener('click', onIndexerGridClick, true);

    document.addEventListener('huntarr:instances-changed', function() {
        if (isIndexersUIVisible()) Forms.initOrRefreshIndexers();
    });
    document.addEventListener('huntarr:tv-hunt-instances-changed', function() {
        if (isIndexersUIVisible()) Forms.initOrRefreshIndexers();
    });
})();
