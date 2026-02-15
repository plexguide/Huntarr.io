/**
 * Media Hunt – Root Folders for TV. File: media-hunt-root-folders.js.
 * Card grid, add via modal, browse, test, set default, delete. Uses /api/tv-hunt/root-folders; DOM IDs remain tv-hunt-*.
 */
(function() {
    'use strict';

    window.TVHuntRootFolders = {
        _browseTargetInput: null,

        refreshList: function() {
            if (window.TVHuntInstanceDropdown && document.getElementById('tv-hunt-settings-root-folders-instance-select') && !window.TVHuntRootFolders._instanceDropdownAttached) {
                window.TVHuntInstanceDropdown.attach('tv-hunt-settings-root-folders-instance-select', function() {
                    if (window.TVHuntRootFolders.refreshList) window.TVHuntRootFolders.refreshList();
                });
                window.TVHuntRootFolders._instanceDropdownAttached = true;
            }
            var gridEl = document.getElementById('tv-hunt-root-folders-grid');
            if (!gridEl) return;
            fetch('./api/tv-hunt/root-folders', { cache: 'no-store' })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    var folders = (data && data.root_folders) ? data.root_folders : [];
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
                        html += '<div class="root-folder-card instance-card' + defaultClass + '" data-index="' + idx + '" data-app-type="tv-hunt-root-folder">' +
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
                    html += '<div class="add-instance-card add-root-folder-card" id="tv-hunt-root-folders-add-card" data-app-type="tv-hunt-root-folder">' +
                        '<div class="add-icon"><i class="fas fa-plus-circle"></i></div>' +
                        '<div class="add-text">Add Root Folder</div></div>';
                    gridEl.innerHTML = html;
                    window.TVHuntRootFolders._bindCardButtons();
                })
                .catch(function() {
                    var addCard = '<div class="add-instance-card add-root-folder-card" id="tv-hunt-root-folders-add-card" data-app-type="tv-hunt-root-folder">' +
                        '<div class="add-icon"><i class="fas fa-plus-circle"></i></div>' +
                        '<div class="add-text">Add Root Folder</div></div>';
                    gridEl.innerHTML = '<p style="color: #ef4444; margin: 0 0 12px 0;">Failed to load TV Hunt root folders.</p>' + addCard;
                    window.TVHuntRootFolders._bindAddCard();
                });
        },

        _bindCardButtons: function() {
            var gridEl = document.getElementById('tv-hunt-root-folders-grid');
            if (!gridEl) return;
            gridEl.querySelectorAll('.root-folder-card [data-action="test"]').forEach(function(btn) {
                btn.onclick = function() {
                    var path = btn.getAttribute('data-path') || '';
                    if (path) window.TVHuntRootFolders.testPath(path);
                };
            });
            gridEl.querySelectorAll('.root-folder-card [data-action="set-default"]').forEach(function(btn) {
                btn.onclick = function() {
                    var idx = parseInt(btn.getAttribute('data-index'), 10);
                    if (!isNaN(idx)) window.TVHuntRootFolders.setDefault(idx);
                };
            });
            gridEl.querySelectorAll('.root-folder-card [data-action="delete"]').forEach(function(btn) {
                btn.onclick = function() {
                    var idx = parseInt(btn.getAttribute('data-index'), 10);
                    if (!isNaN(idx)) window.TVHuntRootFolders.deleteFolder(idx);
                };
            });
            window.TVHuntRootFolders._bindAddCard();
        },

        _bindAddCard: function() {
            var addCard = document.getElementById('tv-hunt-root-folders-add-card');
            if (addCard) {
                addCard.onclick = function() { window.TVHuntRootFolders.openAddModal(); };
            }
        },

        openAddModal: function() {
            var modal = document.getElementById('tv-hunt-root-folder-add-modal');
            var input = document.getElementById('tv-hunt-root-folder-add-path');
            if (modal && modal.parentNode !== document.body) {
                document.body.appendChild(modal);
            }
            if (modal) modal.style.display = 'flex';
            if (input) {
                input.value = '';
                setTimeout(function() { input.focus(); }, 100);
            }
            document.body.classList.add('tv-hunt-root-folder-add-modal-open');
        },

        closeAddModal: function() {
            var modal = document.getElementById('tv-hunt-root-folder-add-modal');
            if (modal) modal.style.display = 'none';
            document.body.classList.remove('tv-hunt-root-folder-add-modal-open');
        },

        setDefault: function(index) {
            if (typeof index !== 'number' || index < 0) return;
            fetch('./api/tv-hunt/root-folders/' + index + '/default', { method: 'PATCH' })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.success) {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification('Default TV Hunt root folder updated.', 'success');
                        }
                        window.TVHuntRootFolders.refreshList();
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
                var addInput = document.getElementById('tv-hunt-root-folder-add-path');
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
            var testBtn = document.getElementById('tv-hunt-root-folder-add-test-btn');
            if (testBtn) {
                testBtn.disabled = true;
                testBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Testing...';
            }
            fetch('./api/tv-hunt/root-folders/test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: path })
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
            var input = document.getElementById('tv-hunt-root-folder-add-path');
            var path = input ? (input.value || '').trim() : '';
            if (!path) {
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('Enter a path', 'error');
                }
                return;
            }
            var saveBtn = document.getElementById('tv-hunt-root-folder-add-modal-save');
            if (saveBtn) {
                saveBtn.disabled = true;
                saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Adding...';
            }
            fetch('./api/tv-hunt/root-folders', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: path })
            })
                .then(function(r) { return r.json().then(function(data) { return { ok: r.ok, data: data }; }); })
                .then(function(result) {
                    if (saveBtn) {
                        saveBtn.disabled = false;
                        saveBtn.innerHTML = '<i class="fas fa-plus"></i> Add';
                    }
                    if (result.ok && result.data && result.data.success) {
                        if (input) input.value = '';
                        window.TVHuntRootFolders.closeAddModal();
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification('TV Hunt root folder added.', 'success');
                        }
                        window.TVHuntRootFolders.refreshList();
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
            var deleteUrl = './api/tv-hunt/root-folders/' + index;
            var doDelete = function() {
                fetch(deleteUrl, { method: 'DELETE' })
                    .then(function(r) { return r.json(); })
                    .then(function(data) {
                        if (data.success) {
                            if (window.huntarrUI && window.huntarrUI.showNotification) {
                                window.huntarrUI.showNotification('TV Hunt root folder removed.', 'success');
                            }
                            window.TVHuntRootFolders.refreshList();
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
                    message: 'Remove this TV Hunt root folder?',
                    confirmLabel: 'OK',
                    onConfirm: doDelete
                });
            } else {
                if (!confirm('Remove this TV Hunt root folder?')) return;
                doDelete();
            }
        },

        openBrowseModal: function(sourceInput) {
            var modal = document.getElementById('tv-hunt-root-folders-browse-modal');
            var browsePathInput = document.getElementById('tv-hunt-root-folders-browse-path-input');
            window.TVHuntRootFolders._browseTargetInput = sourceInput || document.getElementById('tv-hunt-root-folder-add-path');
            if (!modal || !browsePathInput) return;
            if (modal.parentNode !== document.body) {
                document.body.appendChild(modal);
            }
            var startPath = (window.TVHuntRootFolders._browseTargetInput && window.TVHuntRootFolders._browseTargetInput.value) ? window.TVHuntRootFolders._browseTargetInput.value.trim() : '/';
            if (!startPath) startPath = '/';
            browsePathInput.value = startPath;
            modal.style.display = 'flex';
            document.body.classList.add('tv-hunt-root-folders-browse-modal-open');
            window.TVHuntRootFolders.loadBrowsePath(startPath);
        },

        closeBrowseModal: function() {
            var modal = document.getElementById('tv-hunt-root-folders-browse-modal');
            if (modal) {
                modal.style.display = 'none';
                document.body.classList.remove('tv-hunt-root-folders-browse-modal-open');
            }
        },

        confirmBrowseSelection: function() {
            var pathInput = document.getElementById('tv-hunt-root-folders-browse-path-input');
            var target = window.TVHuntRootFolders._browseTargetInput || document.getElementById('tv-hunt-root-folder-add-path');
            if (pathInput && target) {
                target.value = (pathInput.value || '').trim();
            }
            window.TVHuntRootFolders.closeBrowseModal();
        },

        goToParent: function() {
            var pathInput = document.getElementById('tv-hunt-root-folders-browse-path-input');
            if (!pathInput) return;
            var path = (pathInput.value || '').trim() || '/';
            var parent = path.replace(/\/+$/, '').split('/').slice(0, -1).join('/') || '/';
            if (parent === path) return;
            window.TVHuntRootFolders.loadBrowsePath(parent);
        },

        loadBrowsePath: function(path) {
            var listEl = document.getElementById('tv-hunt-root-folders-browse-list');
            var pathInput = document.getElementById('tv-hunt-root-folders-browse-path-input');
            var upBtn = document.getElementById('tv-hunt-root-folders-browse-up');
            if (!listEl || !pathInput) return;
            path = (path || pathInput.value || '/').trim() || '/';
            pathInput.value = path;
            if (upBtn) {
                var parent = path.replace(/\/+$/, '').split('/').slice(0, -1).join('/') || '/';
                upBtn.disabled = (parent === path || path === '/' || path === '');
            }
            listEl.innerHTML = '<div style="padding: 16px; color: #94a3b8;"><i class="fas fa-spinner fa-spin"></i> Loading...</div>';
            fetch('./api/tv-hunt/root-folders/browse?path=' + encodeURIComponent(path))
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
                        var name = (d.name || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
                        var p = (d.path || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
                        html += '<div class="root-folders-browse-item" data-path="' + p + '" title="' + p + '">' +
                            '<i class="fas fa-folder"></i>' +
                            '<span class="root-folders-browse-item-path">' + name + '</span>' +
                            '</div>';
                    }
                    listEl.innerHTML = html || '<div style="padding: 16px; color: #64748b;">No subdirectories</div>';
                    listEl.querySelectorAll('.root-folders-browse-item').forEach(function(el) {
                        el.onclick = function() {
                            var p = el.getAttribute('data-path') || '';
                            if (p) window.TVHuntRootFolders.loadBrowsePath(p);
                        };
                    });
                })
                .catch(function() {
                    listEl.innerHTML = '<div style="padding: 16px; color: #f87171;">Failed to load</div>';
                });
        },

        init: function() {
            var self = window.TVHuntRootFolders;
            var addBackdrop = document.getElementById('tv-hunt-root-folder-add-modal-backdrop');
            var addClose = document.getElementById('tv-hunt-root-folder-add-modal-close');
            var addCancel = document.getElementById('tv-hunt-root-folder-add-modal-cancel');
            var addSave = document.getElementById('tv-hunt-root-folder-add-modal-save');
            var addBrowseBtn = document.getElementById('tv-hunt-root-folder-add-browse-btn');
            var addTestBtn = document.getElementById('tv-hunt-root-folder-add-test-btn');
            var addPathInput = document.getElementById('tv-hunt-root-folder-add-path');
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
                    if (document.getElementById('tv-hunt-root-folder-add-modal') && document.getElementById('tv-hunt-root-folder-add-modal').style.display === 'flex') {
                        self.closeAddModal();
                    }
                    if (document.getElementById('tv-hunt-root-folders-browse-modal') && document.getElementById('tv-hunt-root-folders-browse-modal').style.display === 'flex') {
                        self.closeBrowseModal();
                    }
                }
            });
            var browseBackdrop = document.getElementById('tv-hunt-root-folders-browse-backdrop');
            var browseClose = document.getElementById('tv-hunt-root-folders-browse-close');
            var browseCancel = document.getElementById('tv-hunt-root-folders-browse-cancel');
            var browseOk = document.getElementById('tv-hunt-root-folders-browse-ok');
            var browsePathInput = document.getElementById('tv-hunt-root-folders-browse-path-input');
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
            var upBtn = document.getElementById('tv-hunt-root-folders-browse-up');
            if (upBtn) upBtn.onclick = function() { self.goToParent(); };
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() { window.TVHuntRootFolders.init(); });
    } else {
        window.TVHuntRootFolders.init();
    }
})();
