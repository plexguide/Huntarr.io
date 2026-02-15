/**
 * Root Folders – single view for Movie Hunt and TV Hunt. Combined instance dropdown
 * (Movie - X / TV - X, alphabetical). Each instance keeps its own root folders; same page linked from both sidebars.
 */
(function() {
    'use strict';

    function _rebindBrowseItem(el) {
        el.querySelectorAll('.root-folders-browse-item-btn').forEach(function(btn) {
            btn.onclick = function(e) {
                e.stopPropagation();
                var action = btn.getAttribute('data-action');
                var p = el.getAttribute('data-path') || '';
                var name = el.getAttribute('data-name') || '';
                if (action === 'rename') window.RootFolders.browseRenameFolder(p, name, el);
                else if (action === 'delete') window.RootFolders.browseDeleteFolder(p, name);
            };
        });
    }

    function _showBrowseToast(msg, isError) {
        var container = document.querySelector('.root-folders-browse-body');
        if (!container) return;
        var toast = document.createElement('div');
        toast.style.cssText = 'padding:8px 14px;margin-bottom:8px;border-radius:6px;font-size:0.85rem;font-weight:500;' +
            (isError ? 'background:rgba(239,68,68,0.12);color:#f87171;border:1px solid rgba(239,68,68,0.3);'
                     : 'background:rgba(16,185,129,0.12);color:#6ee7b7;border:1px solid rgba(16,185,129,0.3);');
        toast.textContent = msg;
        container.insertBefore(toast, document.getElementById('root-folders-browse-list'));
        setTimeout(function() {
            toast.style.opacity = '0';
            toast.style.transition = 'opacity 0.3s ease';
            setTimeout(function() { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 300);
        }, 3000);
    }

    window.RootFolders = {
        _browseTargetInput: null,
        _rfMode: 'movie',

        getApiBase: function() {
            return this._rfMode === 'tv' ? './api/tv-hunt/root-folders' : './api/movie-hunt/root-folders';
        },

        getInstanceId: function() {
            var sel = document.getElementById('settings-root-folders-instance-select');
            var v = sel && sel.value ? sel.value : '';
            if (v && v.indexOf(':') >= 0) return v.split(':')[1] || '';
            return v || '';
        },

        _appendInstanceParam: function(url) {
            var id = this.getInstanceId();
            if (!id) return url;
            return url + (url.indexOf('?') >= 0 ? '&' : '?') + 'instance_id=' + encodeURIComponent(id);
        },

        _safeJsonFetch: function(url, fallback) {
            return fetch(url, { cache: 'no-store' }).then(function(r) { return r.json(); }).catch(function() { return fallback || {}; });
        },

        populateCombinedInstanceDropdown: function(preferMode) {
            var self = window.RootFolders;
            var selectEl = document.getElementById('settings-root-folders-instance-select');
            if (!selectEl) return;
            selectEl.innerHTML = '<option value="">Loading...</option>';
            var ts = Date.now();
            var sf = self._safeJsonFetch.bind(self);
            Promise.all([
                sf('./api/movie-hunt/instances?t=' + ts, { instances: [] }),
                sf('./api/tv-hunt/instances?t=' + ts, { instances: [] }),
                sf('./api/movie-hunt/instances/current?t=' + ts, { current_instance_id: null }),
                sf('./api/tv-hunt/instances/current?t=' + ts, { current_instance_id: null })
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
                    var wrapperEl = document.getElementById('settings-root-folders-content-wrapper');
                    if (wrapperEl) wrapperEl.style.display = '';
                    return;
                }
                combined.forEach(function(item) {
                    var opt = document.createElement('option');
                    opt.value = item.value;
                    opt.textContent = item.label;
                    selectEl.appendChild(opt);
                });
                var saved = (typeof localStorage !== 'undefined' && localStorage.getItem('media-hunt-root-folders-last-instance')) || '';
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
                self._applyRequestarrGotoInstance(selectEl);
                selected = selectEl.value || selected;
                var wrapperEl = document.getElementById('settings-root-folders-content-wrapper');
                if (wrapperEl) wrapperEl.style.display = '';
                var parts = (selected || '').split(':');
                if (parts.length === 2) {
                    self._rfMode = parts[0] === 'tv' ? 'tv' : 'movie';
                    if (typeof localStorage !== 'undefined') localStorage.setItem('media-hunt-root-folders-last-instance', selected);
                    self.refreshList();
                }
            }).catch(function() {
                selectEl.innerHTML = '<option value="">Failed to load instances</option>';
                var wrapperEl = document.getElementById('settings-root-folders-content-wrapper');
                if (wrapperEl) wrapperEl.style.display = '';
            });
        },

        _applyRequestarrGotoInstance: function(selectEl) {
            if (!selectEl) return;
            try {
                var goto = typeof sessionStorage !== 'undefined' && sessionStorage.getItem('requestarr-goto-root-instance');
                if (!goto) return;
                var payload = JSON.parse(goto);
                var wantApp = (payload.appType || '').indexOf('tv') >= 0 ? 'tv' : 'movie';
                var wantLabel = (wantApp === 'tv' ? 'TV - ' : 'Movie - ') + (payload.instanceName || '');
                for (var i = 0; i < selectEl.options.length; i++) {
                    var opt = selectEl.options[i];
                    if (opt.value && opt.textContent === wantLabel) {
                        selectEl.value = opt.value;
                        window.RootFolders._rfMode = wantApp;
                        if (typeof localStorage !== 'undefined') localStorage.setItem('media-hunt-root-folders-last-instance', opt.value);
                        break;
                    }
                }
                sessionStorage.removeItem('requestarr-goto-root-instance');
            } catch (e) {}
        },

        onCombinedInstanceChange: function() {
            var selectEl = document.getElementById('settings-root-folders-instance-select');
            if (!selectEl) return;
            var val = selectEl.value || '';
            var parts = val.split(':');
            if (parts.length === 2) {
                window.RootFolders._rfMode = parts[0] === 'tv' ? 'tv' : 'movie';
                if (typeof localStorage !== 'undefined') localStorage.setItem('media-hunt-root-folders-last-instance', val);
                window.RootFolders.refreshList();
            }
        },

        initOrRefresh: function(preferMode) {
            var self = window.RootFolders;
            self._rfMode = (preferMode === 'tv') ? 'tv' : 'movie';
            var selectEl = document.getElementById('settings-root-folders-instance-select');
            updateRootFoldersSetupBanner();
            if (selectEl && selectEl.options.length <= 1) {
                self.populateCombinedInstanceDropdown(preferMode);
            } else {
                var val = selectEl.value || '';
                var parts = val.split(':');
                if (parts.length === 2) self._rfMode = parts[0] === 'tv' ? 'tv' : 'movie';
                self._applyRequestarrGotoInstance(selectEl);
                self.refreshList();
            }
            if (selectEl && !selectEl._rfChangeBound) {
                selectEl._rfChangeBound = true;
                selectEl.addEventListener('change', function() { window.RootFolders.onCombinedInstanceChange(); });
            }
        },

        refreshList: function() {
            var gridEl = document.getElementById('root-folders-grid');
            if (!gridEl) return;
            var url = window.RootFolders._appendInstanceParam(window.RootFolders.getApiBase());
            fetch(url)
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    var folders = (data && data.root_folders) ? data.root_folders : [];
                    // Default root folder first (leftmost)
                    folders = folders.slice().sort(function(a, b) {
                        if (a.is_default) return -1;
                        if (b.is_default) return 1;
                        return 0;
                    });
                    var html = '';
                    for (var i = 0; i < folders.length; i++) {
                        var path = (folders[i].path || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
                        var freeSpace = folders[i].freeSpace;
                        var spaceLabel = (freeSpace != null && !isNaN(freeSpace)) ? Math.round(freeSpace / 1e9) + ' GB free' : '';
                        var idx = folders[i].index !== undefined ? folders[i].index : i;
                        var isDefault = !!folders[i].is_default;
                        var showSetDefault = folders.length > 1 && !isDefault;
                        var defaultClass = isDefault ? ' default-root-folder' : '';
                        html += '<div class="root-folder-card instance-card' + defaultClass + '" data-index="' + idx + '" data-app-type="root-folder">' +
                            '<div class="root-folder-card-header">' +
                            '<div class="root-folder-card-path">' +
                            '<i class="fas fa-folder"></i>' +
                            '<span>' + path + '</span>' +
                            (isDefault ? '<span class="root-folder-default-badge">Default</span>' : '') +
                            '</div></div>' +
                            '<div class="root-folder-card-body">' +
                            (spaceLabel ? '<span class="root-folder-free-space">' + spaceLabel + '</span>' : '') +
                            '</div>' +
                            '<div class="root-folder-card-footer">' +
                            '<button type="button" class="btn-card" data-index="' + idx + '" data-path="' + (folders[i].path || '').replace(/"/g, '&quot;') + '" data-action="test"><i class="fas fa-vial"></i> Test</button>' +
                            (showSetDefault ? '<button type="button" class="btn-card set-default" data-index="' + idx + '" data-action="set-default"><i class="fas fa-star"></i> Default</button>' : '') +
                            '<button type="button" class="btn-card delete" data-index="' + idx + '" data-action="delete"><i class="fas fa-trash"></i> Delete</button>' +
                            '</div></div>';
                    }
                    html += '<div class="add-instance-card add-root-folder-card" id="root-folders-add-card" data-app-type="root-folder">' +
                        '<div class="add-icon"><i class="fas fa-plus-circle"></i></div>' +
                        '<div class="add-text">Add Root Folder</div></div>';
                    gridEl.innerHTML = html;
                    window.RootFolders._bindCardButtons();
                    refreshInstanceStatusBanner();
                })
                .catch(function() {
                    var addCard = '<div class="add-instance-card add-root-folder-card" id="root-folders-add-card" data-app-type="root-folder">' +
                        '<div class="add-icon"><i class="fas fa-plus-circle"></i></div>' +
                        '<div class="add-text">Add Root Folder</div></div>';
                    gridEl.innerHTML = '<p style="color: #ef4444; margin: 0 0 12px 0;">Failed to load root folders.</p>' + addCard;
                    window.RootFolders._bindAddCard();
                });
        },

        _bindCardButtons: function() {
            var gridEl = document.getElementById('root-folders-grid');
            if (!gridEl) return;
            gridEl.querySelectorAll('.root-folder-card [data-action="test"]').forEach(function(btn) {
                btn.onclick = function() {
                    var path = btn.getAttribute('data-path') || '';
                    if (path) window.RootFolders.testPath(path);
                };
            });
            gridEl.querySelectorAll('.root-folder-card [data-action="set-default"]').forEach(function(btn) {
                btn.onclick = function() {
                    var idx = parseInt(btn.getAttribute('data-index'), 10);
                    if (!isNaN(idx)) window.RootFolders.setDefault(idx);
                };
            });
            gridEl.querySelectorAll('.root-folder-card [data-action="delete"]').forEach(function(btn) {
                btn.onclick = function() {
                    var idx = parseInt(btn.getAttribute('data-index'), 10);
                    if (!isNaN(idx)) window.RootFolders.deleteFolder(idx);
                };
            });
            window.RootFolders._bindAddCard();
        },

        _bindAddCard: function() {
            var addCard = document.getElementById('root-folders-add-card');
            if (addCard) {
                addCard.onclick = function() { window.RootFolders.openAddModal(); };
            }
        },

        openAddModal: function() {
            var modal = document.getElementById('root-folder-add-modal');
            var input = document.getElementById('root-folder-add-path');
            if (modal && modal.parentNode !== document.body) {
                document.body.appendChild(modal);
            }
            if (modal) modal.style.display = 'flex';
            if (input) {
                input.value = '';
                setTimeout(function() { input.focus(); }, 100);
            }
            document.body.classList.add('root-folder-add-modal-open');
        },

        closeAddModal: function() {
            var modal = document.getElementById('root-folder-add-modal');
            if (modal) modal.style.display = 'none';
            document.body.classList.remove('root-folder-add-modal-open');
        },

        setDefault: function(index) {
            if (typeof index !== 'number' || index < 0) return;
            var url = window.RootFolders.getApiBase() + '/' + index + '/default';
            url = window.RootFolders._appendInstanceParam(url);
            fetch(url, { method: 'PATCH' })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.success) {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification('Default root folder updated.', 'success');
                        }
                        window.RootFolders.refreshList();
                        if (window.updateMovieHuntSettingsVisibility) window.updateMovieHuntSettingsVisibility();
                    } else {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification(data.message || 'Failed to set default.', 'error');
                        }
                    }
                })
                .catch(function(err) {
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification(err.message || 'Failed to set default.', 'error');
                    }
                });
        },

        testPath: function(path) {
            if (!path || (typeof path !== 'string')) {
                var addInput = document.getElementById('root-folder-add-path');
                path = addInput ? (addInput.value || '').trim() : '';
            } else {
                path = String(path).trim();
            }
            if (!path) {
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('Enter a path to test', 'error');
                }
                return;
            }
            var testBtn = document.getElementById('root-folder-add-test-btn');
            if (testBtn) {
                testBtn.disabled = true;
                testBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Testing...';
            }
            var testUrl = window.RootFolders._appendInstanceParam(window.RootFolders.getApiBase() + '/test');
            var body = { path: path };
            var instId = window.RootFolders.getInstanceId();
            if (instId) body.instance_id = parseInt(instId, 10);
            fetch(testUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (testBtn) {
                        testBtn.disabled = false;
                        testBtn.innerHTML = '<i class="fas fa-vial"></i> Test';
                    }
                    if (data.success) {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification(data.message || 'Write and read test passed.', 'success');
                        }
                    } else {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification(data.message || 'Test failed', 'error');
                        }
                    }
                })
                .catch(function(err) {
                    if (testBtn) {
                        testBtn.disabled = false;
                        testBtn.innerHTML = '<i class="fas fa-vial"></i> Test';
                    }
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification(err.message || 'Test failed', 'error');
                    }
                });
        },

        addFolder: function() {
            var input = document.getElementById('root-folder-add-path');
            var path = input ? (input.value || '').trim() : '';
            if (!path) {
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('Enter a path', 'error');
                }
                return;
            }
            var saveBtn = document.getElementById('root-folder-add-modal-save');
            if (saveBtn) {
                saveBtn.disabled = true;
                saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Adding...';
            }
            var body = { path: path };
            var instId = window.RootFolders.getInstanceId();
            if (instId) body.instance_id = parseInt(instId, 10);
            var addUrl = window.RootFolders._appendInstanceParam(window.RootFolders.getApiBase());
            fetch(addUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            })
                .then(function(r) { return r.json().then(function(data) { return { ok: r.ok, data: data }; }); })
                .then(function(result) {
                    if (saveBtn) {
                        saveBtn.disabled = false;
                        saveBtn.innerHTML = '<i class="fas fa-plus"></i> Add';
                    }
                    if (result.ok && result.data && result.data.success) {
                        if (input) input.value = '';
                        window.RootFolders.closeAddModal();
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification('Root folder added.', 'success');
                        }
                        window.RootFolders.refreshList();
                        if (window.updateMovieHuntSettingsVisibility) window.updateMovieHuntSettingsVisibility();
                    } else {
                        var msg = (result.data && result.data.message) ? result.data.message : 'Add failed';
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification(msg, 'error');
                        }
                    }
                })
                .catch(function(err) {
                    if (saveBtn) {
                        saveBtn.disabled = false;
                        saveBtn.innerHTML = '<i class="fas fa-plus"></i> Add';
                    }
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification(err.message || 'Add failed', 'error');
                    }
                });
        },

        deleteFolder: function(index) {
            if (typeof index !== 'number' || index < 0) return;
            var deleteUrl = window.RootFolders.getApiBase() + '/' + index;
            deleteUrl = window.RootFolders._appendInstanceParam(deleteUrl);
            var doDelete = function() {
                fetch(deleteUrl, { method: 'DELETE' })
                    .then(function(r) { return r.json(); })
                    .then(function(data) {
                        if (data.success) {
                            if (window.huntarrUI && window.huntarrUI.showNotification) {
                                window.huntarrUI.showNotification('Root folder removed.', 'success');
                            }
                            window.RootFolders.refreshList();
                        if (window.updateMovieHuntSettingsVisibility) window.updateMovieHuntSettingsVisibility();
                        } else {
                            if (window.huntarrUI && window.huntarrUI.showNotification) {
                                window.huntarrUI.showNotification(data.message || 'Delete failed', 'error');
                            }
                        }
                    })
                    .catch(function(err) {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification(err.message || 'Delete failed', 'error');
                        }
                    });
            };
            if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
                window.HuntarrConfirm.show({
                    title: 'Remove Root Folder',
                    message: 'Remove this root folder?',
                    confirmLabel: 'OK',
                    onConfirm: doDelete
                });
            } else {
                if (!confirm('Remove this root folder?')) return;
                doDelete();
            }
        },

        openBrowseModal: function(sourceInput) {
            var modal = document.getElementById('root-folders-browse-modal');
            var browsePathInput = document.getElementById('root-folders-browse-path-input');
            window.RootFolders._browseTargetInput = sourceInput || document.getElementById('root-folder-add-path');
            if (!modal || !browsePathInput) return;
            // Move modal to body so it is visible when opened from other sections (e.g. Clients > Remote Mappings)
            if (modal.parentNode !== document.body) {
                document.body.appendChild(modal);
            }
            var startPath = (window.RootFolders._browseTargetInput && window.RootFolders._browseTargetInput.value) ? window.RootFolders._browseTargetInput.value.trim() : '/';
            if (!startPath) startPath = '/';
            browsePathInput.value = startPath;
            modal.style.display = 'flex';
            document.body.classList.add('root-folders-browse-modal-open');
            window.RootFolders.loadBrowsePath(startPath);
        },

        closeBrowseModal: function() {
            var modal = document.getElementById('root-folders-browse-modal');
            if (modal) {
                modal.style.display = 'none';
                document.body.classList.remove('root-folders-browse-modal-open');
            }
        },

        confirmBrowseSelection: function() {
            var pathInput = document.getElementById('root-folders-browse-path-input');
            var target = window.RootFolders._browseTargetInput || document.getElementById('root-folder-add-path');
            if (pathInput && target) {
                target.value = (pathInput.value || '').trim();
            }
            window.RootFolders.closeBrowseModal();
        },

        goToParent: function() {
            var pathInput = document.getElementById('root-folders-browse-path-input');
            if (!pathInput) return;
            var path = (pathInput.value || '').trim() || '/';
            var parent = path.replace(/\/+$/, '').split('/').slice(0, -1).join('/') || '/';
            if (parent === path) return;
            window.RootFolders.loadBrowsePath(parent);
        },

        browseCreateFolder: function() {
            var row = document.getElementById('root-folders-browse-new-folder-row');
            var input = document.getElementById('root-folders-browse-new-folder-input');
            var delRow = document.getElementById('root-folders-browse-delete-confirm-row');
            if (delRow) delRow.style.display = 'none';
            if (!row || !input) return;
            row.style.display = 'flex';
            input.value = '';
            setTimeout(function() { input.focus(); }, 50);
        },

        _doBrowseCreateFolder: function() {
            var input = document.getElementById('root-folders-browse-new-folder-input');
            var row = document.getElementById('root-folders-browse-new-folder-row');
            var pathInput = document.getElementById('root-folders-browse-path-input');
            var name = (input && input.value || '').trim();
            if (!name) { if (input) input.focus(); return; }
            var parent = (pathInput && pathInput.value || '').trim() || '/';
            var url = window.RootFolders.getApiBase() + '/browse/create';
            url = window.RootFolders._appendInstanceParam(url);
            fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ parent_path: parent, name: name })
            }).then(function(r) { return r.json(); }).then(function(data) {
                if (data.success) {
                    if (row) row.style.display = 'none';
                    window.RootFolders.loadBrowsePath(parent);
                } else {
                    if (input) { input.style.borderColor = '#f87171'; input.focus(); }
                    _showBrowseToast(data.error || 'Failed to create folder', true);
                }
            }).catch(function() { _showBrowseToast('Failed to create folder', true); });
        },

        _cancelBrowseCreateFolder: function() {
            var row = document.getElementById('root-folders-browse-new-folder-row');
            if (row) row.style.display = 'none';
        },

        browseRenameFolder: function(path, currentName, el) {
            var main = el && el.querySelector('.root-folders-browse-item-main');
            if (!main) return;
            var origHTML = main.innerHTML;
            main.innerHTML = '<i class="fas fa-folder" style="color:#818cf8;flex-shrink:0;"></i>' +
                '<input type="text" class="root-folders-browse-item-rename-input" value="' + (currentName || '').replace(/"/g, '&quot;') + '" />' +
                '<button type="button" class="root-folders-browse-inline-ok root-folders-rename-confirm"><i class="fas fa-check"></i></button>' +
                '<button type="button" class="root-folders-browse-inline-cancel root-folders-rename-cancel"><i class="fas fa-times"></i></button>';
            var inp = main.querySelector('input');
            if (inp) { inp.focus(); inp.select(); }
            main.onclick = null;
            var self = window.RootFolders;
            function doRename() {
                var name = (inp && inp.value || '').trim();
                if (!name || name === currentName) { revert(); return; }
                var url = self.getApiBase() + '/browse/rename';
                url = self._appendInstanceParam(url);
                fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: path, new_name: name })
                }).then(function(r) { return r.json(); }).then(function(data) {
                    if (data.success) {
                        var pathInput = document.getElementById('root-folders-browse-path-input');
                        var parent = path.replace(/\/+$/, '').split('/').slice(0, -1).join('/') || '/';
                        self.loadBrowsePath(parent || (pathInput && pathInput.value) || '/');
                    } else {
                        if (inp) { inp.style.borderColor = '#f87171'; inp.focus(); }
                        _showBrowseToast(data.error || 'Failed to rename', true);
                    }
                }).catch(function() { _showBrowseToast('Failed to rename folder', true); });
            }
            function revert() { main.innerHTML = origHTML; _rebindBrowseItem(el); }
            main.querySelector('.root-folders-rename-confirm').onclick = function(e) { e.stopPropagation(); doRename(); };
            main.querySelector('.root-folders-rename-cancel').onclick = function(e) { e.stopPropagation(); revert(); };
            if (inp) inp.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') { e.preventDefault(); doRename(); }
                if (e.key === 'Escape') { e.preventDefault(); revert(); }
            });
        },

        browseDeleteFolder: function(path, name) {
            var row = document.getElementById('root-folders-browse-delete-confirm-row');
            var nameEl = document.getElementById('root-folders-browse-delete-name');
            var newRow = document.getElementById('root-folders-browse-new-folder-row');
            if (newRow) newRow.style.display = 'none';
            if (!row) return;
            row.style.display = 'flex';
            if (nameEl) nameEl.textContent = 'Delete "' + (name || path) + '"?';
            window.RootFolders._pendingDeletePath = path;
        },

        _doBrowseDeleteFolder: function() {
            var path = window.RootFolders._pendingDeletePath;
            var row = document.getElementById('root-folders-browse-delete-confirm-row');
            if (!path) return;
            var url = window.RootFolders.getApiBase() + '/browse/delete';
            url = window.RootFolders._appendInstanceParam(url);
            fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: path })
            }).then(function(r) { return r.json(); }).then(function(data) {
                if (data.success) {
                    if (row) row.style.display = 'none';
                    var pathInput = document.getElementById('root-folders-browse-path-input');
                    var parent = path.replace(/\/+$/, '').split('/').slice(0, -1).join('/') || '/';
                    window.RootFolders.loadBrowsePath(parent);
                    _showBrowseToast('Folder deleted', false);
                } else {
                    _showBrowseToast(data.error || 'Folder may not be empty', true);
                }
            }).catch(function() { _showBrowseToast('Failed to delete folder', true); });
        },

        _cancelBrowseDeleteFolder: function() {
            var row = document.getElementById('root-folders-browse-delete-confirm-row');
            if (row) row.style.display = 'none';
            window.RootFolders._pendingDeletePath = null;
        },

        loadBrowsePath: function(path) {
            var listEl = document.getElementById('root-folders-browse-list');
            var pathInput = document.getElementById('root-folders-browse-path-input');
            var upBtn = document.getElementById('root-folders-browse-up');
            if (!listEl || !pathInput) return;
            // Hide inline rows on navigate
            var newRow = document.getElementById('root-folders-browse-new-folder-row');
            var delRow = document.getElementById('root-folders-browse-delete-confirm-row');
            if (newRow) newRow.style.display = 'none';
            if (delRow) delRow.style.display = 'none';
            path = (path || pathInput.value || '/').trim() || '/';
            pathInput.value = path;
            if (upBtn) {
                var parent = path.replace(/\/+$/, '').split('/').slice(0, -1).join('/') || '/';
                upBtn.disabled = (parent === path || path === '/' || path === '');
            }
            listEl.innerHTML = '<div style="padding: 16px; color: #94a3b8;"><i class="fas fa-spinner fa-spin"></i> Loading...</div>';
            var browseUrl = window.RootFolders.getApiBase() + '/browse?path=' + encodeURIComponent(path);
            browseUrl = window.RootFolders._appendInstanceParam(browseUrl);
            fetch(browseUrl)
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    var dirs = (data && data.directories) ? data.directories : [];
                    var err = data && data.error;
                    if (err) {
                        listEl.innerHTML = '<div style="padding: 16px; color: #f87171;">' + (String(err).replace(/</g, '&lt;')) + '</div>';
                        return;
                    }
                    if (pathInput) pathInput.value = data.path || path;
                    if (upBtn) {
                        var currentPath = (pathInput.value || '').trim() || '/';
                        var parent = currentPath.replace(/\/+$/, '').split('/').slice(0, -1).join('/') || '/';
                        upBtn.disabled = (parent === currentPath || currentPath === '/' || currentPath === '');
                    }
                    var html = '';
                    for (var i = 0; i < dirs.length; i++) {
                        var d = dirs[i];
                        var rawName = d.name || '';
                        var name = rawName.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
                        var p = (d.path || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
                        var nameAttr = rawName.replace(/"/g, '&quot;');
                        html += '<div class="root-folders-browse-item" data-path="' + p + '" data-name="' + nameAttr + '" title="' + p + '">' +
                            '<span class="root-folders-browse-item-main">' +
                            '<i class="fas fa-folder"></i>' +
                            '<span class="root-folders-browse-item-path">' + name + '</span>' +
                            '</span>' +
                            '<span class="root-folders-browse-item-actions">' +
                            '<button type="button" class="root-folders-browse-item-btn" data-action="rename" title="Rename"><i class="fas fa-pen"></i></button>' +
                            '<button type="button" class="root-folders-browse-item-btn" data-action="delete" title="Delete"><i class="fas fa-trash"></i></button>' +
                            '</span></div>';
                    }
                    listEl.innerHTML = html || '<div style="padding: 16px; color: #64748b;">No subdirectories</div>';
                    listEl.querySelectorAll('.root-folders-browse-item').forEach(function(el) {
                        var main = el.querySelector('.root-folders-browse-item-main');
                        if (main) {
                            main.onclick = function() {
                                var p = el.getAttribute('data-path') || '';
                                if (p) window.RootFolders.loadBrowsePath(p);
                            };
                        }
                        _rebindBrowseItem(el);
                    });
                })
                .catch(function() {
                    listEl.innerHTML = '<div style="padding: 16px; color: #f87171;">Failed to load</div>';
                });
        },

        _pendingDeletePath: null,

        init: function() {
            var self = window.RootFolders;
            // Add modal
            var addBackdrop = document.getElementById('root-folder-add-modal-backdrop');
            var addClose = document.getElementById('root-folder-add-modal-close');
            var addCancel = document.getElementById('root-folder-add-modal-cancel');
            var addSave = document.getElementById('root-folder-add-modal-save');
            var addBrowseBtn = document.getElementById('root-folder-add-browse-btn');
            var addTestBtn = document.getElementById('root-folder-add-test-btn');
            var addPathInput = document.getElementById('root-folder-add-path');
            if (addBackdrop) addBackdrop.onclick = function() { self.closeAddModal(); };
            if (addClose) addClose.onclick = function() { self.closeAddModal(); };
            if (addCancel) addCancel.onclick = function() { self.closeAddModal(); };
            if (addSave) addSave.onclick = function() { self.addFolder(); };
            if (addBrowseBtn && addPathInput) addBrowseBtn.onclick = function() { self.openBrowseModal(addPathInput); };
            if (addTestBtn) addTestBtn.onclick = function() { self.testPath(); };
            if (addPathInput) {
                addPathInput.addEventListener('keydown', function(e) {
                    if (e.key === 'Enter') { e.preventDefault(); self.addFolder(); }
                });
            }
            document.addEventListener('keydown', function(e) {
                if (e.key === 'Escape') {
                    if (document.getElementById('root-folder-add-modal').style.display === 'flex') {
                        self.closeAddModal();
                    }
                    if (document.getElementById('root-folders-browse-modal').style.display === 'flex') {
                        self.closeBrowseModal();
                    }
                }
            });
            // Browse modal
            var browseBackdrop = document.getElementById('root-folders-browse-backdrop');
            var browseClose = document.getElementById('root-folders-browse-close');
            var browseCancel = document.getElementById('root-folders-browse-cancel');
            var browseOk = document.getElementById('root-folders-browse-ok');
            var browsePathInput = document.getElementById('root-folders-browse-path-input');
            if (browseBackdrop) browseBackdrop.onclick = function() { self.closeBrowseModal(); };
            if (browseClose) browseClose.onclick = function() { self.closeBrowseModal(); };
            if (browseCancel) browseCancel.onclick = function() { self.closeBrowseModal(); };
            if (browseOk) browseOk.onclick = function() { self.confirmBrowseSelection(); };
            if (browsePathInput) {
                browsePathInput.addEventListener('keydown', function(e) {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        self.loadBrowsePath(browsePathInput.value);
                    }
                });
            }
            var upBtn = document.getElementById('root-folders-browse-up');
            if (upBtn) upBtn.onclick = function() { self.goToParent(); };
            var newFolderBtn = document.getElementById('root-folders-browse-new-folder');
            if (newFolderBtn) newFolderBtn.onclick = function() { self.browseCreateFolder(); };
            // Inline create folder confirm/cancel
            var createConfirm = document.getElementById('root-folders-browse-new-folder-confirm');
            var createCancel = document.getElementById('root-folders-browse-new-folder-cancel');
            var createInput = document.getElementById('root-folders-browse-new-folder-input');
            if (createConfirm) createConfirm.onclick = function() { self._doBrowseCreateFolder(); };
            if (createCancel) createCancel.onclick = function() { self._cancelBrowseCreateFolder(); };
            if (createInput) createInput.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') { e.preventDefault(); self._doBrowseCreateFolder(); }
                if (e.key === 'Escape') { e.preventDefault(); self._cancelBrowseCreateFolder(); }
            });
            // Inline delete confirm/cancel
            var deleteYes = document.getElementById('root-folders-browse-delete-yes');
            var deleteNo = document.getElementById('root-folders-browse-delete-no');
            if (deleteYes) deleteYes.onclick = function() { self._doBrowseDeleteFolder(); };
            if (deleteNo) deleteNo.onclick = function() { self._cancelBrowseDeleteFolder(); };
            document.addEventListener('huntarr:instances-changed', function() { if (self._rfMode === 'movie') self.populateCombinedInstanceDropdown('movie'); updateRootFoldersSetupBanner(); });
            document.addEventListener('huntarr:tv-hunt-instances-changed', function() { if (self._rfMode === 'tv') self.populateCombinedInstanceDropdown('tv'); updateRootFoldersSetupBanner(); });
            updateRootFoldersSetupBanner();
        }
    };

    function updateRootFoldersSetupBanner() {
        var banner = document.getElementById('root-folders-setup-wizard-continue-banner');
        var callout = document.getElementById('root-folders-instance-setup-callout');
        var statusArea = document.getElementById('root-folders-instance-status-area');
        // Show if user navigated here from the setup wizard.
        // Don't remove the flag — it needs to persist across re-renders during the wizard flow.
        var fromWizard = false;
        try { fromWizard = sessionStorage.getItem('setup-wizard-active-nav') === '1'; } catch (e) {}
        var showSetup = fromWizard;
        if (banner) banner.style.display = showSetup ? 'flex' : 'none';
        if (callout) callout.style.display = showSetup ? 'flex' : 'none';
        /* Status by instance: always visible (helps all users), not just during wizard */
        if (statusArea) {
            statusArea.style.display = 'block';
            refreshInstanceStatusBanner();
        }
    }

    function refreshInstanceStatusBanner() {
        var gridEl = document.getElementById('root-folders-instance-status-grid');
        if (!gridEl) return;
        gridEl.innerHTML = '<div style="padding: 12px; color: #94a3b8;"><i class="fas fa-spinner fa-spin"></i> Loading...</div>';
        var sf = window.RootFolders._safeJsonFetch.bind(window.RootFolders);
        var ts = '?t=' + Date.now();
        Promise.all([
            sf('./api/movie-hunt/instances' + ts, { instances: [] }),
            sf('./api/tv-hunt/instances' + ts, { instances: [] })
        ]).then(function(results) {
            var movieInstances = (results[0].instances || []).map(function(i) { return { value: 'movie:' + i.id, label: 'Movie - ' + (i.name || 'Instance ' + i.id), id: i.id, type: 'movie' }; });
            var tvInstances = (results[1].instances || []).map(function(i) { return { value: 'tv:' + i.id, label: 'TV - ' + (i.name || 'Instance ' + i.id), id: i.id, type: 'tv' }; });
            var all = movieInstances.concat(tvInstances);
            var statusArea = document.getElementById('root-folders-instance-status-area');
            if (all.length === 0) {
                gridEl.innerHTML = '';
                if (statusArea) statusArea.style.display = 'none';
                return;
            }
            if (statusArea) statusArea.style.display = 'block';
            var fetches = all.map(function(inst) {
                var url = inst.type === 'tv' ? './api/tv-hunt/root-folders' : './api/movie-hunt/root-folders';
                url += '?instance_id=' + encodeURIComponent(inst.id) + '&t=' + Date.now();
                return sf(url, { root_folders: [] }).then(function(d) {
                    var folders = d.root_folders || d.rootFolders || [];
                    return { label: inst.label, value: inst.value, hasRoots: folders.length > 0 };
                });
            });
            Promise.all(fetches).then(function(statuses) {
                var html = '';
                for (var i = 0; i < statuses.length; i++) {
                    var s = statuses[i];
                    var cardClass = s.hasRoots ? 'instance-complete' : 'instance-not-setup';
                    var iconClass = s.hasRoots ? 'fa-check-circle' : 'fa-folder-open';
                    var badgeText = s.hasRoots ? 'Root Instance Complete' : 'Not Setup';
                    var nameEsc = (s.label || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
                    html += '<div class="root-folders-instance-status-card ' + cardClass + '" data-value="' + (s.value || '').replace(/"/g, '&quot;') + '">' +
                        '<div class="instance-status-icon"><i class="fas ' + iconClass + '" aria-hidden="true"></i></div>' +
                        '<div class="instance-status-body">' +
                        '<div class="instance-status-name">' + nameEsc + '</div>' +
                        '<span class="instance-status-badge">' + badgeText + '</span>' +
                        '</div></div>';
                }
                gridEl.innerHTML = html;
                gridEl.querySelectorAll('.root-folders-instance-status-card').forEach(function(card) {
                    var val = card.getAttribute('data-value');
                    if (val) {
                        card.style.cursor = 'pointer';
                        card.addEventListener('click', function() {
                            var sel = document.getElementById('settings-root-folders-instance-select');
                            if (sel && val) { sel.value = val; window.RootFolders.onCombinedInstanceChange(); }
                        });
                    }
                });
            });
        }).catch(function() {
            gridEl.innerHTML = '';
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() { window.RootFolders.init(); });
    } else {
        window.RootFolders.init();
    }
})();
