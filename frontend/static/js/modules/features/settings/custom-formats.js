/**
 * Custom Formats (Movie Hunt) - Radarr-style JSON. Pre-Format (dropdown) or Import (paste JSON).
 * Cards like Profiles; title editable, name auto from JSON.
 */
(function() {
    'use strict';

    window.CustomFormats = {
        _list: [],
        _editingIndex: null,
        _modalMode: null,

        refreshList: function() {
            var preformattedGrid = document.getElementById('custom-formats-preformatted-grid');
            var importedGrid = document.getElementById('custom-formats-imported-grid');
            if (!preformattedGrid || !importedGrid) return;
            
            fetch('./api/custom-formats')
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    var list = (data && data.custom_formats) ? data.custom_formats : [];
                    window.CustomFormats._list = list;
                    
                    var preformattedByGroup = {};
                    var importedItems = [];
                    var preformattedCount = 0;
                    var importedCount = 0;
                    
                    for (var i = 0; i < list.length; i++) {
                        var item = list[i];
                        var isPreformatted = (item.source || 'import').toLowerCase() === 'preformat';
                        
                        if (isPreformatted) {
                            var preformatId = item.preformat_id || '';
                            var groupKey = window.CustomFormats._getGroupFromPreformatId(preformatId);
                            if (!preformattedByGroup[groupKey]) {
                                preformattedByGroup[groupKey] = [];
                            }
                            preformattedByGroup[groupKey].push({item: item, index: i});
                            preformattedCount++;
                        } else {
                            importedItems.push({item: item, index: i});
                            importedCount++;
                        }
                    }
                    
                    var preformattedHtml = '';
                    var sortedGroups = Object.keys(preformattedByGroup).sort();
                    
                    for (var g = 0; g < sortedGroups.length; g++) {
                        var groupKey = sortedGroups[g];
                        var groupItems = preformattedByGroup[groupKey];
                        var groupName = window.CustomFormats._formatGroupName(groupKey);
                        
                        preformattedHtml += '<div class="custom-formats-group-header">' +
                            '<i class="fas fa-folder-open"></i> ' + groupName +
                            '</div>';
                        
                        for (var j = 0; j < groupItems.length; j++) {
                            var entry = groupItems[j];
                            var item = entry.item;
                            var i = entry.index;
                            var title = (item.title || item.name || 'Unnamed').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                            
                            preformattedHtml += '<div class="custom-format-card instance-card" data-index="' + i + '" data-app-type="custom-format">' +
                                '<div class="custom-format-card-header">' +
                                '<div class="custom-format-card-title"><i class="fas fa-code"></i><span>' + title + '</span></div>' +
                                '</div>' +
                                '<div class="custom-format-card-footer">' +
                                '<button type="button" class="btn-card view" data-index="' + i + '"><i class="fas fa-eye"></i> JSON</button>' +
                                '<button type="button" class="btn-card edit" data-index="' + i + '"><i class="fas fa-edit"></i> Edit</button>' +
                                '<button type="button" class="btn-card delete" data-index="' + i + '"><i class="fas fa-trash"></i> Delete</button>' +
                                '</div></div>';
                        }
                    }
                    
                    var importedHtml = '';
                    for (var k = 0; k < importedItems.length; k++) {
                        var entry = importedItems[k];
                        var item = entry.item;
                        var i = entry.index;
                        var title = (item.title || item.name || 'Unnamed').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                        
                        importedHtml += '<div class="custom-format-card instance-card" data-index="' + i + '" data-app-type="custom-format">' +
                            '<div class="custom-format-card-header">' +
                            '<div class="custom-format-card-title"><i class="fas fa-code"></i><span>' + title + '</span></div>' +
                            '</div>' +
                            '<div class="custom-format-card-footer">' +
                            '<button type="button" class="btn-card view" data-index="' + i + '"><i class="fas fa-eye"></i> JSON</button>' +
                            '<button type="button" class="btn-card edit" data-index="' + i + '"><i class="fas fa-edit"></i> Edit</button>' +
                            '<button type="button" class="btn-card delete" data-index="' + i + '"><i class="fas fa-trash"></i> Delete</button>' +
                            '</div></div>';
                    }
                    
                    preformattedGrid.innerHTML = preformattedHtml;
                    importedGrid.innerHTML = importedHtml;
                    
                    var deletePreBtn = document.getElementById('delete-all-preformatted');
                    var deleteImpBtn = document.getElementById('delete-all-imported');
                    if (deletePreBtn) deletePreBtn.disabled = preformattedCount === 0;
                    if (deleteImpBtn) deleteImpBtn.disabled = importedCount === 0;
                    
                    window.CustomFormats._bindCards();
                })
                .catch(function() {
                    preformattedGrid.innerHTML = '';
                    importedGrid.innerHTML = '';
                    window.CustomFormats._bindAddButtons();
                });
        },

        _getGroupFromPreformatId: function(preformatId) {
            if (!preformatId) return 'Other';
            var parts = preformatId.split('.');
            return parts[0] || 'Other';
        },

        _formatGroupName: function(groupKey) {
            if (!groupKey || groupKey === 'Other') return 'Other';
            var categoryNames = {
                'movie-versions': 'Movie Versions',
                'hdr-formats': 'HDR Formats',
                'audio-formats': 'Audio Formats',
                'audio-channels': 'Audio Channels',
                'audio-advanced': 'Audio Advanced',
                'movie-meta': 'Movie Metadata',
                'streaming-services': 'Streaming Services',
                'unwanted': 'Unwanted',
                'misc': 'Miscellaneous',
                'optional': 'Optional'
            };
            return categoryNames[groupKey] || groupKey.split('-').map(function(s) {
                return s.charAt(0).toUpperCase() + s.slice(1);
            }).join(' ');
        },

        _bindCards: function() {
            var allCards = document.querySelectorAll('.custom-format-card');
            allCards.forEach(function(card) {
                var viewBtn = card.querySelector('.btn-card.view');
                var editBtn = card.querySelector('.btn-card.edit');
                var deleteBtn = card.querySelector('.btn-card.delete');
                
                if (viewBtn) {
                    viewBtn.onclick = function(e) {
                        e.stopPropagation();
                        var idx = parseInt(viewBtn.getAttribute('data-index'), 10);
                        if (!isNaN(idx)) window.CustomFormats.openViewModal(idx);
                    };
                }
                if (editBtn) {
                    editBtn.onclick = function(e) {
                        e.stopPropagation();
                        var idx = parseInt(editBtn.getAttribute('data-index'), 10);
                        if (!isNaN(idx)) window.CustomFormats.openEditModal(idx);
                    };
                }
                if (deleteBtn) {
                    deleteBtn.onclick = function(e) {
                        e.stopPropagation();
                        var idx = parseInt(deleteBtn.getAttribute('data-index'), 10);
                        if (!isNaN(idx)) window.CustomFormats.deleteFormat(idx);
                    };
                }
            });
            window.CustomFormats._bindAddButtons();
        },

        _bindAddButtons: function() {
            var addPreformattedBtn = document.getElementById('add-preformatted-btn');
            var addImportedBtn = document.getElementById('add-imported-btn');
            if (addPreformattedBtn) {
                addPreformattedBtn.onclick = function() { 
                    window.CustomFormats.openAddModal('preformat'); 
                };
            }
            if (addImportedBtn) {
                addImportedBtn.onclick = function() { 
                    window.CustomFormats.openAddModal('import'); 
                };
            }
        },

        openViewModal: function(index) {
            var list = window.CustomFormats._list;
            if (index < 0 || index >= list.length) return;
            var item = list[index];
            var title = (item.title || item.name || 'Unnamed');
            document.getElementById('custom-format-view-modal-title').textContent = 'View JSON: ' + title;
            var jsonStr = item.custom_format_json || '{}';
            try {
                var parsed = JSON.parse(jsonStr);
                jsonStr = JSON.stringify(parsed, null, 2);
            } catch (e) {
                // If parse fails, show as-is
            }
            document.getElementById('custom-format-view-json').textContent = jsonStr;
            document.getElementById('custom-format-view-modal').style.display = 'flex';
            document.body.classList.add('custom-format-modal-open');
        },

        closeViewModal: function() {
            document.getElementById('custom-format-view-modal').style.display = 'none';
            document.body.classList.remove('custom-format-modal-open');
        },

        _generateRandomSuffix: function() {
            var chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
            var suffix = '';
            for (var i = 0; i < 4; i++) {
                suffix += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            return suffix;
        },

        _checkTitleCollision: function(title) {
            var list = window.CustomFormats._list || [];
            var preformattedTitles = {};
            for (var i = 0; i < list.length; i++) {
                if ((list[i].source || 'import').toLowerCase() === 'preformat') {
                    var t = (list[i].title || list[i].name || '').toLowerCase();
                    if (t) preformattedTitles[t] = true;
                }
            }
            var lowerTitle = title.toLowerCase();
            if (preformattedTitles[lowerTitle]) {
                return title + '-' + window.CustomFormats._generateRandomSuffix();
            }
            return title;
        },

        openAddModal: function(source) {
            window.CustomFormats._editingIndex = null;
            window.CustomFormats._modalMode = source;
            
            if (source === 'preformat') {
                document.getElementById('custom-format-modal-title').textContent = 'Add Pre-Formatted';
                document.getElementById('custom-format-preformat-area').style.display = 'block';
                var importArea = document.getElementById('custom-format-import-area');
                if (importArea) importArea.style.display = 'none';
                window.CustomFormats._loadPreformatTree();
            } else {
                document.getElementById('custom-format-modal-title').textContent = 'Add Imported';
                document.getElementById('custom-format-preformat-area').style.display = 'none';
                var importArea = document.getElementById('custom-format-import-area');
                if (importArea) importArea.style.display = 'block';
            }
            
            document.getElementById('custom-format-modal-save').innerHTML = '<i class="fas fa-plus"></i> Add';
            document.getElementById('custom-format-json-textarea').value = '';
            document.getElementById('custom-format-modal').style.display = 'flex';
            document.body.classList.add('custom-format-modal-open');
        },

        openEditModal: function(index) {
            var list = window.CustomFormats._list;
            if (index < 0 || index >= list.length) return;
            window.CustomFormats._editingIndex = index;
            var item = list[index];
            document.getElementById('custom-format-modal-title').textContent = 'Edit Custom Format';
            document.getElementById('custom-format-modal-save').innerHTML = '<i class="fas fa-save"></i> Save';
            document.getElementById('custom-format-source-import').checked = true;
            document.getElementById('custom-format-preformat-area').style.display = 'none';
            var importArea = document.getElementById('custom-format-import-area');
            if (importArea) importArea.style.display = 'block';
            document.getElementById('custom-format-json-textarea').value = item.custom_format_json || '{}';
            document.getElementById('custom-format-modal').style.display = 'flex';
            document.body.classList.add('custom-format-modal-open');
        },

        closeModal: function() {
            document.getElementById('custom-format-modal').style.display = 'none';
            document.body.classList.remove('custom-format-modal-open');
        },

        _buildPreformatId: function(catId, subId, fmtId) {
            if (subId) return catId + '.' + subId + '.' + fmtId;
            return catId + '.' + fmtId;
        },

        _loadPreformatTree: function() {
            var treeEl = document.getElementById('custom-format-preformat-tree');
            if (!treeEl) return;
            treeEl.innerHTML = '<span class="custom-format-loading">Loading…</span>';
            var existingIds = {};
            (window.CustomFormats._list || []).forEach(function(item) {
                if (item.preformat_id) existingIds[item.preformat_id] = true;
            });
            fetch('./api/custom-formats/preformats')
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    var categories = (data && data.categories) ? data.categories : [];
                    treeEl.innerHTML = '';
                    categories.forEach(function(cat) {
                        var catId = cat.id || '';
                        var catName = cat.name || catId;
                        var catDiv = document.createElement('div');
                        catDiv.className = 'custom-format-cat';
                        var header = document.createElement('div');
                        header.className = 'custom-format-cat-header';
                        header.innerHTML = '<i class="fas fa-chevron-down"></i><span>' + (catName.replace(/</g, '&lt;').replace(/>/g, '&gt;')) + '</span>';
                        var body = document.createElement('div');
                        body.className = 'custom-format-cat-body';
                        var subcats = cat.subcategories || [];
                        if (subcats.length > 0) {
                            subcats.forEach(function(sub) {
                                var subId = sub.id || '';
                                var subName = sub.name || subId;
                                var subDiv = document.createElement('div');
                                subDiv.className = 'custom-format-subcat';
                                var subLabel = document.createElement('div');
                                subLabel.className = 'custom-format-subcat-name';
                                subLabel.textContent = subName;
                                subDiv.appendChild(subLabel);
                                var fmtList = document.createElement('div');
                                fmtList.className = 'custom-format-format-list';
                                (sub.formats || []).forEach(function(fmt) {
                                    var fid = window.CustomFormats._buildPreformatId(catId, subId, fmt.id || '');
                                    var name = fmt.name || fid;
                                    var already = existingIds[fid];
                                    var label = document.createElement('label');
                                    label.className = 'custom-format-format-item';
                                    var cb = document.createElement('input');
                                    cb.type = 'checkbox';
                                    cb.setAttribute('data-preformat-id', fid);
                                    cb.setAttribute('data-format-name', name);
                                    if (already) { cb.checked = true; cb.disabled = true; }
                                    label.appendChild(cb);
                                    label.appendChild(document.createElement('span')).textContent = name;
                                    fmtList.appendChild(label);
                                });
                                subDiv.appendChild(fmtList);
                                body.appendChild(subDiv);
                            });
                        } else {
                            var fmtList = document.createElement('div');
                            fmtList.className = 'custom-format-format-list';
                            (cat.formats || []).forEach(function(fmt) {
                                var fid = window.CustomFormats._buildPreformatId(catId, null, fmt.id || '');
                                var name = fmt.name || fid;
                                var already = existingIds[fid];
                                var label = document.createElement('label');
                                label.className = 'custom-format-format-item';
                                var cb = document.createElement('input');
                                cb.type = 'checkbox';
                                cb.setAttribute('data-preformat-id', fid);
                                cb.setAttribute('data-format-name', name);
                                if (already) { cb.checked = true; cb.disabled = true; }
                                label.appendChild(cb);
                                label.appendChild(document.createElement('span')).textContent = name;
                                fmtList.appendChild(label);
                            });
                            body.appendChild(fmtList);
                        }
                        header.onclick = function() {
                            header.classList.toggle('collapsed');
                            body.classList.toggle('collapsed');
                        };
                        catDiv.appendChild(header);
                        catDiv.appendChild(body);
                        treeEl.appendChild(catDiv);
                    });
                })
                .catch(function() {
                    treeEl.innerHTML = '<span class="custom-format-loading" style="color:#f87171;">Failed to load formats.</span>';
                });
        },

        _nameFromJson: function(str) {
            if (!str || typeof str !== 'string') return '—';
            try {
                var obj = JSON.parse(str);
                return (obj && obj.name != null) ? String(obj.name).trim() || '—' : '—';
            } catch (e) { return '—'; }
        },

        _onSourceChange: function() {
            var isPre = document.getElementById('custom-format-source-preformat').checked;
            var preformatArea = document.getElementById('custom-format-preformat-area');
            var importArea = document.getElementById('custom-format-import-area');
            var jsonTa = document.getElementById('custom-format-json-textarea');
            if (preformatArea) preformatArea.style.display = isPre ? 'block' : 'none';
            if (importArea) importArea.style.display = isPre ? 'none' : 'block';
            if (isPre) {
                if (jsonTa) jsonTa.value = '';
                window.CustomFormats._loadPreformatTree();
            } else {
                if (window.CustomFormats._editingIndex != null) {
                    var list = window.CustomFormats._list;
                    var idx = window.CustomFormats._editingIndex;
                    if (list && idx >= 0 && idx < list.length && jsonTa) {
                        jsonTa.value = list[idx].custom_format_json || '{}';
                    }
                } else if (jsonTa) {
                    jsonTa.value = '';
                }
            }
        },

        saveModal: function() {
            var editing = window.CustomFormats._editingIndex;

            if (editing != null) {
                var jsonRaw = document.getElementById('custom-format-json-textarea').value.trim();
                if (!jsonRaw) {
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification('Paste valid JSON to edit.', 'error');
                    }
                    return;
                }
                try { JSON.parse(jsonRaw); } catch (e) {
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification('Invalid JSON.', 'error');
                    }
                    return;
                }
                var title = window.CustomFormats._nameFromJson(jsonRaw);
                if (title === '—') title = 'Unnamed';
                fetch('./api/custom-formats/' + editing, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title: title, custom_format_json: jsonRaw })
                })
                    .then(function(r) { return r.json(); })
                    .then(function(data) {
                        if (data.success) {
                            if (window.huntarrUI && window.huntarrUI.showNotification) {
                                window.huntarrUI.showNotification('Custom format updated.', 'success');
                            }
                            window.CustomFormats.closeModal();
                            window.CustomFormats.refreshList();
                        } else {
                            if (window.huntarrUI && window.huntarrUI.showNotification) {
                                window.huntarrUI.showNotification(data.message || data.error || 'Update failed', 'error');
                            }
                        }
                    })
                    .catch(function() {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification('Update failed', 'error');
                        }
                    });
                return;
            }

            var isPre = window.CustomFormats._modalMode === 'preformat';
            if (isPre) {
                var tree = document.getElementById('custom-format-preformat-tree');
                var checkboxes = tree ? tree.querySelectorAll('input[type="checkbox"][data-preformat-id]:checked:not(:disabled)') : [];
                var toAdd = [];
                checkboxes.forEach(function(cb) {
                    toAdd.push({ id: cb.getAttribute('data-preformat-id'), name: cb.getAttribute('data-format-name') || cb.getAttribute('data-preformat-id') });
                });
                if (toAdd.length === 0) {
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification('Check at least one format to add.', 'error');
                    }
                    return;
                }
                var done = 0;
                var failed = 0;
                var currentIndex = 0;
                
                function addNext() {
                    if (currentIndex >= toAdd.length) {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            if (failed === 0) {
                                window.huntarrUI.showNotification('Added ' + done + ' format(s).', 'success');
                            } else {
                                window.huntarrUI.showNotification('Added ' + done + ', failed ' + failed + '.', failed ? 'error' : 'success');
                            }
                        }
                        window.CustomFormats.closeModal();
                        window.CustomFormats.refreshList();
                        return;
                    }
                    
                    var item = toAdd[currentIndex];
                    currentIndex++;
                    
                    fetch('./api/custom-formats', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ source: 'preformat', preformat_id: item.id, title: item.name })
                    })
                        .then(function(r) { return r.json(); })
                        .then(function(data) {
                            if (data.success) done++; else failed++;
                            addNext();
                        })
                        .catch(function() {
                            failed++;
                            addNext();
                        });
                }
                
                addNext();
                return;
            }
            var jsonRaw = document.getElementById('custom-format-json-textarea').value.trim();
            if (!jsonRaw) {
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('Paste Custom Format JSON.', 'error');
                }
                return;
            }
            try { JSON.parse(jsonRaw); } catch (e) {
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('Invalid JSON.', 'error');
                }
                return;
            }
            var title = window.CustomFormats._nameFromJson(jsonRaw);
            if (title === '—') title = 'Unnamed';
            title = window.CustomFormats._checkTitleCollision(title);
            var body = { source: 'import', custom_format_json: jsonRaw, title: title };

            fetch('./api/custom-formats', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.success) {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification('Custom format added.', 'success');
                        }
                        window.CustomFormats.closeModal();
                        window.CustomFormats.refreshList();
                    } else {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification(data.message || data.error || 'Add failed', 'error');
                        }
                    }
                })
                .catch(function() {
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification('Add failed', 'error');
                    }
                });
        },

        deleteFormat: function(index) {
            if (!confirm('Remove this custom format?')) return;
            fetch('./api/custom-formats/' + index, { method: 'DELETE' })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.success) {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification('Custom format removed.', 'success');
                        }
                        window.CustomFormats.refreshList();
                    } else {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification(data.message || 'Delete failed', 'error');
                        }
                    }
                })
                .catch(function() {
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification('Delete failed', 'error');
                    }
                });
        },

        deleteAllByType: function(type) {
            var list = window.CustomFormats._list || [];
            var toDelete = [];
            
            for (var i = 0; i < list.length; i++) {
                var item = list[i];
                var isPreformatted = (item.source || 'import').toLowerCase() === 'preformat';
                if ((type === 'preformat' && isPreformatted) || (type === 'import' && !isPreformatted)) {
                    toDelete.push(i);
                }
            }
            
            if (toDelete.length === 0) {
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('No formats to delete.', 'info');
                }
                return;
            }
            
            var typeName = type === 'preformat' ? 'pre-formatted' : 'imported';
            var confirmMsg = 'Delete all ' + toDelete.length + ' ' + typeName + ' custom format(s)?\n\nThis action cannot be undone.';
            if (!confirm(confirmMsg)) return;
            
            var deleted = 0;
            var failed = 0;
            var currentIndex = toDelete.length - 1;
            
            function deleteNext() {
                if (currentIndex < 0) {
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        if (failed === 0) {
                            window.huntarrUI.showNotification('Deleted ' + deleted + ' format(s).', 'success');
                        } else {
                            window.huntarrUI.showNotification('Deleted ' + deleted + ', failed ' + failed + '.', failed > 0 ? 'error' : 'success');
                        }
                    }
                    window.CustomFormats.refreshList();
                    return;
                }
                
                var idx = toDelete[currentIndex];
                currentIndex--;
                
                fetch('./api/custom-formats/' + idx, { method: 'DELETE' })
                    .then(function(r) { return r.json(); })
                    .then(function(data) {
                        if (data.success) deleted++; else failed++;
                        deleteNext();
                    })
                    .catch(function() {
                        failed++;
                        deleteNext();
                    });
            }
            
            deleteNext();
        },

        init: function() {
            var self = window.CustomFormats;
            var modal = document.getElementById('custom-format-modal');
            var backdrop = document.getElementById('custom-format-modal-backdrop');
            var closeBtn = document.getElementById('custom-format-modal-close');
            var cancelBtn = document.getElementById('custom-format-modal-cancel');
            var saveBtn = document.getElementById('custom-format-modal-save');
            if (backdrop) backdrop.onclick = function() { self.closeModal(); };
            if (closeBtn) closeBtn.onclick = function() { self.closeModal(); };
            if (cancelBtn) cancelBtn.onclick = function() { self.closeModal(); };
            if (saveBtn) saveBtn.onclick = function() { self.saveModal(); };
            
            var viewModal = document.getElementById('custom-format-view-modal');
            var viewBackdrop = document.getElementById('custom-format-view-modal-backdrop');
            var viewCloseBtn = document.getElementById('custom-format-view-modal-close');
            var viewCloseBtnFooter = document.getElementById('custom-format-view-modal-close-btn');
            if (viewBackdrop) viewBackdrop.onclick = function() { self.closeViewModal(); };
            if (viewCloseBtn) viewCloseBtn.onclick = function() { self.closeViewModal(); };
            if (viewCloseBtnFooter) viewCloseBtnFooter.onclick = function() { self.closeViewModal(); };
            
            var deleteAllPreBtn = document.getElementById('delete-all-preformatted');
            var deleteAllImpBtn = document.getElementById('delete-all-imported');
            if (deleteAllPreBtn) {
                deleteAllPreBtn.onclick = function() { self.deleteAllByType('preformat'); };
            }
            if (deleteAllImpBtn) {
                deleteAllImpBtn.onclick = function() { self.deleteAllByType('import'); };
            }
            
            document.querySelectorAll('input[name="custom-format-source"]').forEach(function(radio) {
                radio.onchange = function() { self._onSourceChange(); };
            });
            var jsonTa = document.getElementById('custom-format-json-textarea');
            if (jsonTa) { /* title is derived from JSON on save */ }
            document.addEventListener('keydown', function(e) {
                if (e.key === 'Escape') {
                    if (viewModal && viewModal.style.display === 'flex') {
                        self.closeViewModal();
                    } else if (modal && modal.style.display === 'flex') {
                        self.closeModal();
                    }
                }
            });
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() { window.CustomFormats.init(); });
    } else {
        window.CustomFormats.init();
    }
})();
