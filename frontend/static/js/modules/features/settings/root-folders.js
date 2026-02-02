/**
 * Root Folders (Movie Hunt) - list, add, delete, and test root folder paths.
 * Attaches to window.RootFolders. Load after settings core.
 */
(function() {
    'use strict';

    window.RootFolders = {
        refreshList: function() {
            var listEl = document.getElementById('root-folders-list');
            if (!listEl) return;
            fetch('./api/movie-hunt/root-folders')
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    var folders = (data && data.root_folders) ? data.root_folders : [];
                    var html = '';
                    for (var i = 0; i < folders.length; i++) {
                        var path = (folders[i].path || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
                        var freeSpace = folders[i].freeSpace;
                        var spaceLabel = (freeSpace != null && !isNaN(freeSpace)) ? ' (' + Math.round(freeSpace / 1e9) + ' GB free)' : '';
                        var pathDisplay = path + spaceLabel;
                        var idx = folders[i].index !== undefined ? folders[i].index : i;
                        html += '<div class="root-folders-row" data-index="' + idx + '">' +
                            '<span class="root-folders-row-path">' + pathDisplay + '</span>' +
                            '<button type="button" class="btn-row-test" data-index="' + idx + '" data-path="' + (folders[i].path || '').replace(/"/g, '&quot;') + '"><i class="fas fa-vial"></i> Test</button>' +
                            '<button type="button" class="btn-root-folders-delete" data-index="' + idx + '"><i class="fas fa-trash"></i> Delete</button>' +
                            '</div>';
                    }
                    listEl.innerHTML = html || '<p style="color: #64748b; margin: 0;">No root folders added yet.</p>';
                    window.RootFolders._bindRowButtons();
                })
                .catch(function() {
                    listEl.innerHTML = '<p style="color: #ef4444; margin: 0;">Failed to load root folders.</p>';
                });
        },

        _bindRowButtons: function() {
            var listEl = document.getElementById('root-folders-list');
            if (!listEl) return;
            listEl.querySelectorAll('.btn-row-test').forEach(function(btn) {
                btn.onclick = function() {
                    var path = btn.getAttribute('data-path') || '';
                    if (path) window.RootFolders.testPath(path);
                };
            });
            listEl.querySelectorAll('.btn-root-folders-delete').forEach(function(btn) {
                btn.onclick = function() {
                    var idx = parseInt(btn.getAttribute('data-index'), 10);
                    if (!isNaN(idx)) window.RootFolders.deleteFolder(idx);
                };
            });
        },

        testPath: function(path) {
            if (!path || (typeof path !== 'string')) path = (document.getElementById('root-folder-path-input') || {}).value || '';
            path = String(path).trim();
            if (!path) {
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('Enter a path to test', 'error');
                }
                return;
            }
            var testBtn = document.getElementById('root-folder-test-btn');
            if (testBtn) {
                testBtn.disabled = true;
                testBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Testing...';
            }
            fetch('./api/movie-hunt/root-folders/test', {
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
            var input = document.getElementById('root-folder-path-input');
            var path = input ? (input.value || '').trim() : '';
            if (!path) {
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('Enter a path', 'error');
                }
                return;
            }
            var addBtn = document.getElementById('root-folder-add-btn');
            if (addBtn) {
                addBtn.disabled = true;
                addBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Adding...';
            }
            fetch('./api/movie-hunt/root-folders', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: path })
            })
                .then(function(r) { return r.json().then(function(data) { return { ok: r.ok, data: data }; }); })
                .then(function(result) {
                    if (addBtn) {
                        addBtn.disabled = false;
                        addBtn.innerHTML = '<i class="fas fa-plus"></i> Add';
                    }
                    if (result.ok && result.data && result.data.success) {
                        if (input) input.value = '';
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification('Root folder added.', 'success');
                        }
                        window.RootFolders.refreshList();
                    } else {
                        var msg = (result.data && result.data.message) ? result.data.message : 'Add failed';
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification(msg, 'error');
                        }
                    }
                })
                .catch(function(err) {
                    if (addBtn) {
                        addBtn.disabled = false;
                        addBtn.innerHTML = '<i class="fas fa-plus"></i> Add';
                    }
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification(err.message || 'Add failed', 'error');
                    }
                });
        },

        deleteFolder: function(index) {
            if (typeof index !== 'number' || index < 0) return;
            if (!confirm('Remove this root folder?')) return;
            fetch('./api/movie-hunt/root-folders/' + index, { method: 'DELETE' })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.success) {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification('Root folder removed.', 'success');
                        }
                        window.RootFolders.refreshList();
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
        },

        openBrowseModal: function() {
            var modal = document.getElementById('root-folders-browse-modal');
            var input = document.getElementById('root-folder-path-input');
            var browsePathInput = document.getElementById('root-folders-browse-path-input');
            if (!modal || !browsePathInput) return;
            var startPath = (input && input.value) ? input.value.trim() : '/';
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

        goToParent: function() {
            var pathInput = document.getElementById('root-folders-browse-path-input');
            if (!pathInput) return;
            var path = (pathInput.value || '').trim() || '/';
            var parent = path.replace(/\/+$/, '').split('/').slice(0, -1).join('/') || '/';
            if (parent === path) return;
            window.RootFolders.loadBrowsePath(parent);
        },

        loadBrowsePath: function(path) {
            var listEl = document.getElementById('root-folders-browse-list');
            var pathInput = document.getElementById('root-folders-browse-path-input');
            var upBtn = document.getElementById('root-folders-browse-up');
            if (!listEl || !pathInput) return;
            path = (path || pathInput.value || '/').trim() || '/';
            pathInput.value = path;
            if (upBtn) {
                var parent = path.replace(/\/+$/, '').split('/').slice(0, -1).join('/') || '/';
                upBtn.disabled = (parent === path || path === '/' || path === '');
            }
            listEl.innerHTML = '<div style="padding: 16px; color: #94a3b8;"><i class="fas fa-spinner fa-spin"></i> Loading...</div>';
            fetch('./api/movie-hunt/root-folders/browse?path=' + encodeURIComponent(path))
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    var dirs = (data && data.directories) ? data.directories : [];
                    var err = data && data.error;
                    if (err) {
                        listEl.innerHTML = '<div style="padding: 16px; color: #f87171;">' + (err.replace(/</g, '&lt;')) + '</div>';
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
                            if (p) window.RootFolders.loadBrowsePath(p);
                        };
                    });
                })
                .catch(function() {
                    listEl.innerHTML = '<div style="padding: 16px; color: #f87171;">Failed to load</div>';
                });
        },

        confirmBrowseSelection: function() {
            var pathInput = document.getElementById('root-folders-browse-path-input');
            var mainInput = document.getElementById('root-folder-path-input');
            if (pathInput && mainInput) {
                mainInput.value = (pathInput.value || '').trim();
            }
            window.RootFolders.closeBrowseModal();
        },

        init: function() {
            var self = window.RootFolders;
            var testBtn = document.getElementById('root-folder-test-btn');
            var addBtn = document.getElementById('root-folder-add-btn');
            var browseBtn = document.getElementById('root-folder-browse-btn');
            if (testBtn) testBtn.onclick = function() { self.testPath(); };
            if (addBtn) addBtn.onclick = function() { self.addFolder(); };
            if (browseBtn) browseBtn.onclick = function() { self.openBrowseModal(); };
            var modal = document.getElementById('root-folders-browse-modal');
            var backdrop = document.getElementById('root-folders-browse-backdrop');
            var closeBtn = document.getElementById('root-folders-browse-close');
            var cancelBtn = document.getElementById('root-folders-browse-cancel');
            var okBtn = document.getElementById('root-folders-browse-ok');
            var browsePathInput = document.getElementById('root-folders-browse-path-input');
            if (backdrop) backdrop.onclick = function() { self.closeBrowseModal(); };
            if (closeBtn) closeBtn.onclick = function() { self.closeBrowseModal(); };
            if (cancelBtn) cancelBtn.onclick = function() { self.closeBrowseModal(); };
            if (okBtn) okBtn.onclick = function() { self.confirmBrowseSelection(); };
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
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() { window.RootFolders.init(); });
    } else {
        window.RootFolders.init();
    }
})();
