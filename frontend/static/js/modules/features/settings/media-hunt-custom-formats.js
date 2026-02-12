/**
 * Media Hunt – Custom Formats for TV (Sonarr-style JSON). Pre-Format (dropdown) or Import (paste JSON).
 * File: media-hunt-custom-formats.js. Uses /api/tv-hunt/ endpoints; DOM IDs remain tv-hunt-* for compatibility.
 */
(function() {
    'use strict';

    window.TVHuntCustomFormats = {
        _list: [],
        _editingIndex: null,
        _modalMode: null,
        _instanceDropdownAttached: false,

        refreshList: function() {
            if (window.TVHuntInstanceDropdown && document.getElementById('tv-hunt-settings-custom-formats-instance-select') && !window.TVHuntCustomFormats._instanceDropdownAttached) {
                window.TVHuntInstanceDropdown.attach('tv-hunt-settings-custom-formats-instance-select', function() { window.TVHuntCustomFormats.refreshList(); });
                window.TVHuntCustomFormats._instanceDropdownAttached = true;
            }
            var preformattedGrid = document.getElementById('tv-hunt-custom-formats-preformatted-grid');
            var importedGrid = document.getElementById('tv-hunt-custom-formats-imported-grid');
            if (!preformattedGrid || !importedGrid) return;
            
            fetch('./api/tv-hunt/custom-formats')
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    var list = (data && data.custom_formats) ? data.custom_formats : [];
                    window.TVHuntCustomFormats._list = list;
                    
                    var preformattedByGroup = {};
                    var importedItems = [];
                    var preformattedCount = 0;
                    var importedCount = 0;
                    
                    for (var i = 0; i < list.length; i++) {
                        var item = list[i];
                        var isPreformatted = (item.source || 'import').toLowerCase() === 'preformat';
                        
                        if (isPreformatted) {
                            var preformatId = item.preformat_id || '';
                            var groupKey = window.TVHuntCustomFormats._getGroupFromPreformatId(preformatId);
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
                        var groupName = window.TVHuntCustomFormats._formatGroupName(groupKey);
                        
                        preformattedHtml += '<div class="custom-formats-group-header">' +
                            '<i class="fas fa-folder-open"></i> ' + groupName +
                            '</div>';
                        
                        for (var j = 0; j < groupItems.length; j++) {
                            var entry = groupItems[j];
                            var item = entry.item;
                            var idx = entry.index;
                            var title = (item.title || item.name || 'Unnamed').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                            
                            preformattedHtml += '<div class="custom-format-card instance-card" data-index="' + idx + '" data-app-type="tv-hunt-custom-format">' +
                                '<div class="custom-format-card-header">' +
                                '<div class="custom-format-card-title"><i class="fas fa-code"></i><span>' + title + '</span></div>' +
                                '</div>' +
                                '<div class="custom-format-card-footer">' +
                                '<button type="button" class="btn-card view" data-index="' + idx + '"><i class="fas fa-eye"></i> JSON</button>' +
                                '<button type="button" class="btn-card delete" data-index="' + idx + '"><i class="fas fa-trash"></i> Delete</button>' +
                                '</div></div>';
                        }
                    }
                    
                    var importedHtml = '';
                    for (var k = 0; k < importedItems.length; k++) {
                        var entry = importedItems[k];
                        var item = entry.item;
                        var idx = entry.index;
                        var title = (item.title || item.name || 'Unnamed').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                        
                        importedHtml += '<div class="custom-format-card instance-card" data-index="' + idx + '" data-app-type="tv-hunt-custom-format">' +
                            '<div class="custom-format-card-header">' +
                            '<div class="custom-format-card-title"><i class="fas fa-code"></i><span>' + title + '</span></div>' +
                            '</div>' +
                            '<div class="custom-format-card-footer">' +
                            '<button type="button" class="btn-card view" data-index="' + idx + '"><i class="fas fa-eye"></i> JSON</button>' +
                            '<button type="button" class="btn-card edit" data-index="' + idx + '"><i class="fas fa-edit"></i> Edit</button>' +
                            '<button type="button" class="btn-card delete" data-index="' + idx + '"><i class="fas fa-trash"></i> Delete</button>' +
                            '</div></div>';
                    }
                    
                    preformattedGrid.innerHTML = preformattedHtml;
                    importedGrid.innerHTML = importedHtml;
                    
                    var deletePreBtn = document.getElementById('tv-hunt-delete-all-preformatted');
                    var deleteImpBtn = document.getElementById('tv-hunt-delete-all-imported');
                    if (deletePreBtn) deletePreBtn.disabled = preformattedCount === 0;
                    if (deleteImpBtn) deleteImpBtn.disabled = importedCount === 0;
                    
                    window.TVHuntCustomFormats._bindCards();
                })
                .catch(function() {
                    preformattedGrid.innerHTML = '';
                    importedGrid.innerHTML = '';
                    window.TVHuntCustomFormats._bindAddButtons();
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
                'audio-formats': 'Audio Formats',
                'audio-channels': 'Audio Channels',
                'hdr-formats': 'HDR Formats',
                'hdr-optional': 'HDR Optional',
                'series-versions': 'Series Versions',
                'unwanted': 'Unwanted',
                'hq-source-groups': 'HQ Source Groups',
                'streaming-services-general': 'General Streaming Services',
                'streaming-services-french': 'French Streaming Services',
                'streaming-services-asian': 'Asian Streaming Services',
                'streaming-services-dutch': 'Dutch Streaming Services',
                'streaming-services-uk': 'UK Streaming Services',
                'streaming-services-misc': 'Misc Streaming Services',
                'streaming-services-anime': 'Anime Streaming Services',
                'streaming-services-optional': 'Optional Streaming Services',
                'miscellaneous': 'Miscellaneous',
                'language-profiles': 'Language Profiles',
                'anime-source-groups-bd': 'Anime Source Groups (BD)',
                'anime-source-groups-web': 'Anime Source Groups (Web)',
                'anime-misc': 'Anime Misc',
                'anime-optional': 'Anime Optional',
                'german-source-groups': 'German Source Groups',
                'german-miscellaneous': 'German Miscellaneous',
                'french-source-groups': 'French Source Groups',
                'french-audio-version': 'French Audio Version'
            };
            return categoryNames[groupKey] || groupKey.split('-').map(function(s) {
                return s.charAt(0).toUpperCase() + s.slice(1);
            }).join(' ');
        },

        _bindCards: function() {
            var container = document.getElementById('tvHuntSettingsCustomFormatsSection');
            if (!container) return;
            var allCards = container.querySelectorAll('.custom-format-card');
            allCards.forEach(function(card) {
                var viewBtn = card.querySelector('.btn-card.view');
                var editBtn = card.querySelector('.btn-card.edit');
                var deleteBtn = card.querySelector('.btn-card.delete');
                
                if (viewBtn) {
                    viewBtn.onclick = function(e) {
                        e.stopPropagation();
                        var idx = parseInt(viewBtn.getAttribute('data-index'), 10);
                        if (!isNaN(idx)) window.TVHuntCustomFormats.openViewModal(idx);
                    };
                }
                if (editBtn) {
                    editBtn.onclick = function(e) {
                        e.stopPropagation();
                        var idx = parseInt(editBtn.getAttribute('data-index'), 10);
                        if (!isNaN(idx)) window.TVHuntCustomFormats.openEditModal(idx);
                    };
                }
                if (deleteBtn) {
                    deleteBtn.onclick = function(e) {
                        e.stopPropagation();
                        var idx = parseInt(deleteBtn.getAttribute('data-index'), 10);
                        if (!isNaN(idx)) window.TVHuntCustomFormats.deleteFormat(idx);
                    };
                }
            });
            window.TVHuntCustomFormats._bindAddButtons();
        },

        _bindAddButtons: function() {
            var addPreformattedBtn = document.getElementById('tv-hunt-add-preformatted-btn');
            var addImportedBtn = document.getElementById('tv-hunt-add-imported-btn');
            if (addPreformattedBtn) {
                addPreformattedBtn.onclick = function() { 
                    window.TVHuntCustomFormats.openAddModal('preformat'); 
                };
            }
            if (addImportedBtn) {
                addImportedBtn.onclick = function() { 
                    window.TVHuntCustomFormats.openAddModal('import'); 
                };
            }
        },

        openViewModal: function(index) {
            var list = window.TVHuntCustomFormats._list;
            if (index < 0 || index >= list.length) return;
            window.TVHuntCustomFormats._ensureViewModalInBody();
            var item = list[index];
            var title = (item.title || item.name || 'Unnamed');
            document.getElementById('tv-hunt-custom-format-view-modal-title').textContent = 'View JSON: ' + title;
            var jsonStr = item.custom_format_json || '{}';
            try {
                var parsed = JSON.parse(jsonStr);
                jsonStr = JSON.stringify(parsed, null, 2);
            } catch (e) { /* show as-is */ }
            document.getElementById('tv-hunt-custom-format-view-json').textContent = jsonStr;
            document.getElementById('tv-hunt-custom-format-view-modal').style.display = 'flex';
            document.body.classList.add('custom-format-modal-open');
        },

        closeViewModal: function() {
            var modal = document.getElementById('tv-hunt-custom-format-view-modal');
            if (modal) modal.style.display = 'none';
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
            var list = window.TVHuntCustomFormats._list || [];
            var preformattedTitles = {};
            for (var i = 0; i < list.length; i++) {
                if ((list[i].source || 'import').toLowerCase() === 'preformat') {
                    var t = (list[i].title || list[i].name || '').toLowerCase();
                    if (t) preformattedTitles[t] = true;
                }
            }
            var lowerTitle = title.toLowerCase();
            if (preformattedTitles[lowerTitle]) {
                return title + '-' + window.TVHuntCustomFormats._generateRandomSuffix();
            }
            return title;
        },

        _ensureAddModalInBody: function() {
            var modal = document.getElementById('tv-hunt-custom-format-modal');
            if (modal && modal.parentNode !== document.body) {
                document.body.appendChild(modal);
            }
        },
        _ensureViewModalInBody: function() {
            var modal = document.getElementById('tv-hunt-custom-format-view-modal');
            if (modal && modal.parentNode !== document.body) {
                document.body.appendChild(modal);
            }
        },

        openAddModal: function(source) {
            window.TVHuntCustomFormats._editingIndex = null;
            window.TVHuntCustomFormats._modalMode = source;
            window.TVHuntCustomFormats._ensureAddModalInBody();

            if (source === 'preformat') {
                document.getElementById('tv-hunt-custom-format-modal-title').textContent = 'Add Pre-Formatted';
                document.getElementById('tv-hunt-custom-format-preformat-area').style.display = 'block';
                var importArea = document.getElementById('tv-hunt-custom-format-import-area');
                if (importArea) importArea.style.display = 'none';
                window.TVHuntCustomFormats._loadPreformatTree();
            } else {
                document.getElementById('tv-hunt-custom-format-modal-title').textContent = 'Add Imported';
                document.getElementById('tv-hunt-custom-format-preformat-area').style.display = 'none';
                var importArea = document.getElementById('tv-hunt-custom-format-import-area');
                if (importArea) importArea.style.display = 'block';
            }

            document.getElementById('tv-hunt-custom-format-modal-save').innerHTML = '<i class="fas fa-plus"></i> Add';
            document.getElementById('tv-hunt-custom-format-json-textarea').value = '';
            document.getElementById('tv-hunt-custom-format-modal').style.display = 'flex';
            document.body.classList.add('custom-format-modal-open');
        },

        openEditModal: function(index) {
            var list = window.TVHuntCustomFormats._list;
            if (index < 0 || index >= list.length) return;
            window.TVHuntCustomFormats._ensureAddModalInBody();
            window.TVHuntCustomFormats._editingIndex = index;
            var item = list[index];
            document.getElementById('tv-hunt-custom-format-modal-title').textContent = 'Edit Custom Format';
            document.getElementById('tv-hunt-custom-format-modal-save').innerHTML = '<i class="fas fa-save"></i> Save';
            document.getElementById('tv-hunt-custom-format-source-import').checked = true;
            document.getElementById('tv-hunt-custom-format-preformat-area').style.display = 'none';
            var importArea = document.getElementById('tv-hunt-custom-format-import-area');
            if (importArea) importArea.style.display = 'block';
            document.getElementById('tv-hunt-custom-format-json-textarea').value = item.custom_format_json || '{}';
            document.getElementById('tv-hunt-custom-format-modal').style.display = 'flex';
            document.body.classList.add('custom-format-modal-open');
        },

        closeModal: function() {
            var modal = document.getElementById('tv-hunt-custom-format-modal');
            if (modal) modal.style.display = 'none';
            document.body.classList.remove('custom-format-modal-open');
        },

        _buildPreformatId: function(catId, subId, fmtId) {
            if (subId) return catId + '.' + subId + '.' + fmtId;
            return catId + '.' + fmtId;
        },

        _loadPreformatTree: function() {
            var treeEl = document.getElementById('tv-hunt-custom-format-preformat-tree');
            if (!treeEl) return;
            treeEl.innerHTML = '<span class="custom-format-loading">Loading\u2026</span>';
            var existingIds = {};
            (window.TVHuntCustomFormats._list || []).forEach(function(item) {
                if (item.preformat_id) existingIds[item.preformat_id] = true;
            });
            fetch('./api/tv-hunt/custom-formats/preformats')
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    var categories = (data && data.categories) ? data.categories : [];
                    treeEl.innerHTML = '';
                    if (categories.length === 0) {
                        var msg = document.createElement('div');
                        msg.className = 'custom-format-preformat-empty';
                        msg.innerHTML = 'Pre-formatted list is not available on this server. You can still add formats via <strong>Import</strong> by pasting JSON from <a href="https://trash-guides.info/Sonarr/sonarr-collection-of-custom-formats/" target="_blank" rel="noopener">TRaSH Guides (Sonarr)</a>.';
                        treeEl.appendChild(msg);
                        return;
                    }
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
                                    var fid = window.TVHuntCustomFormats._buildPreformatId(catId, subId, fmt.id || '');
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
                                var fid = window.TVHuntCustomFormats._buildPreformatId(catId, null, fmt.id || '');
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
            if (!str || typeof str !== 'string') return '\u2014';
            try {
                var obj = JSON.parse(str);
                return (obj && obj.name != null) ? String(obj.name).trim() || '\u2014' : '\u2014';
            } catch (e) { return '\u2014'; }
        },

        _onSourceChange: function() {
            var isPre = document.getElementById('tv-hunt-custom-format-source-preformat').checked;
            var preformatArea = document.getElementById('tv-hunt-custom-format-preformat-area');
            var importArea = document.getElementById('tv-hunt-custom-format-import-area');
            var jsonTa = document.getElementById('tv-hunt-custom-format-json-textarea');
            if (preformatArea) preformatArea.style.display = isPre ? 'block' : 'none';
            if (importArea) importArea.style.display = isPre ? 'none' : 'block';
            if (isPre) {
                if (jsonTa) jsonTa.value = '';
                window.TVHuntCustomFormats._loadPreformatTree();
            } else {
                if (window.TVHuntCustomFormats._editingIndex != null) {
                    var list = window.TVHuntCustomFormats._list;
                    var idx = window.TVHuntCustomFormats._editingIndex;
                    if (list && idx >= 0 && idx < list.length && jsonTa) {
                        jsonTa.value = list[idx].custom_format_json || '{}';
                    }
                } else if (jsonTa) {
                    jsonTa.value = '';
                }
            }
        },

        saveModal: function() {
            var editing = window.TVHuntCustomFormats._editingIndex;

            if (editing != null) {
                var jsonRaw = document.getElementById('tv-hunt-custom-format-json-textarea').value.trim();
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
                var title = window.TVHuntCustomFormats._nameFromJson(jsonRaw);
                if (title === '\u2014') title = 'Unnamed';
                fetch('./api/tv-hunt/custom-formats/' + editing, {
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
                            window.TVHuntCustomFormats.closeModal();
                            window.TVHuntCustomFormats.refreshList();
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

            var isPre = window.TVHuntCustomFormats._modalMode === 'preformat';
            if (isPre) {
                var tree = document.getElementById('tv-hunt-custom-format-preformat-tree');
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
                        window.TVHuntCustomFormats.closeModal();
                        window.TVHuntCustomFormats.refreshList();
                        return;
                    }
                    
                    var item = toAdd[currentIndex];
                    currentIndex++;
                    
                    fetch('./api/tv-hunt/custom-formats', {
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
            var jsonRaw = document.getElementById('tv-hunt-custom-format-json-textarea').value.trim();
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
            var title = window.TVHuntCustomFormats._nameFromJson(jsonRaw);
            if (title === '\u2014') title = 'Unnamed';
            title = window.TVHuntCustomFormats._checkTitleCollision(title);
            var body = { source: 'import', custom_format_json: jsonRaw, title: title };

            fetch('./api/tv-hunt/custom-formats', {
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
                        window.TVHuntCustomFormats.closeModal();
                        window.TVHuntCustomFormats.refreshList();
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
            var doDelete = function() {
                fetch('./api/tv-hunt/custom-formats/' + index, { method: 'DELETE' })
                    .then(function(r) { return r.json(); })
                    .then(function(data) {
                        if (data.success) {
                            if (window.huntarrUI && window.huntarrUI.showNotification) {
                                window.huntarrUI.showNotification('Custom format removed.', 'success');
                            }
                            window.TVHuntCustomFormats.refreshList();
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
            };
            if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
                window.HuntarrConfirm.show({
                    title: 'Remove Custom Format',
                    message: 'Remove this custom format?',
                    confirmLabel: 'Remove',
                    onConfirm: doDelete
                });
            } else {
                doDelete();
            }
        },

        deleteAllByType: function(type) {
            var list = window.TVHuntCustomFormats._list || [];
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
            var deleted = 0;
            var failed = 0;

            function runDeleteAll() {
                var currentIndex = toDelete.length - 1;
                deleted = 0;
                failed = 0;
                
                function deleteNext() {
                    if (currentIndex < 0) {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            if (failed === 0) {
                                window.huntarrUI.showNotification('Deleted ' + deleted + ' format(s).', 'success');
                            } else {
                                window.huntarrUI.showNotification('Deleted ' + deleted + ', failed ' + failed + '.', failed > 0 ? 'error' : 'success');
                            }
                        }
                        window.TVHuntCustomFormats.refreshList();
                        return;
                    }
                    
                    var idx = toDelete[currentIndex];
                    currentIndex--;
                    
                    fetch('./api/tv-hunt/custom-formats/' + idx, { method: 'DELETE' })
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
            }

            if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
                window.HuntarrConfirm.show({
                    title: 'Delete All ' + typeName.charAt(0).toUpperCase() + typeName.slice(1) + ' Custom Formats',
                    message: confirmMsg,
                    confirmLabel: 'Delete All',
                    onConfirm: runDeleteAll
                });
            } else {
                runDeleteAll();
            }
        },

        init: function() {
            var self = window.TVHuntCustomFormats;
            var modal = document.getElementById('tv-hunt-custom-format-modal');
            var backdrop = document.getElementById('tv-hunt-custom-format-modal-backdrop');
            var closeBtn = document.getElementById('tv-hunt-custom-format-modal-close');
            var cancelBtn = document.getElementById('tv-hunt-custom-format-modal-cancel');
            var saveBtn = document.getElementById('tv-hunt-custom-format-modal-save');
            if (backdrop) backdrop.onclick = function() { self.closeModal(); };
            if (closeBtn) closeBtn.onclick = function() { self.closeModal(); };
            if (cancelBtn) cancelBtn.onclick = function() { self.closeModal(); };
            if (saveBtn) saveBtn.onclick = function() { self.saveModal(); };
            
            var viewModal = document.getElementById('tv-hunt-custom-format-view-modal');
            var viewBackdrop = document.getElementById('tv-hunt-custom-format-view-modal-backdrop');
            var viewCloseBtn = document.getElementById('tv-hunt-custom-format-view-modal-close');
            var viewCloseBtnFooter = document.getElementById('tv-hunt-custom-format-view-modal-close-btn');
            if (viewBackdrop) viewBackdrop.onclick = function() { self.closeViewModal(); };
            if (viewCloseBtn) viewCloseBtn.onclick = function() { self.closeViewModal(); };
            if (viewCloseBtnFooter) viewCloseBtnFooter.onclick = function() { self.closeViewModal(); };
            
            var deleteAllPreBtn = document.getElementById('tv-hunt-delete-all-preformatted');
            var deleteAllImpBtn = document.getElementById('tv-hunt-delete-all-imported');
            if (deleteAllPreBtn) {
                deleteAllPreBtn.onclick = function() { self.deleteAllByType('preformat'); };
            }
            if (deleteAllImpBtn) {
                deleteAllImpBtn.onclick = function() { self.deleteAllByType('import'); };
            }
            
            document.querySelectorAll('input[name="tv-hunt-custom-format-source"]').forEach(function(radio) {
                radio.onchange = function() { self._onSourceChange(); };
            });
            
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
        document.addEventListener('DOMContentLoaded', function() { window.TVHuntCustomFormats.init(); });
    } else {
        window.TVHuntCustomFormats.init();
    }
})();
