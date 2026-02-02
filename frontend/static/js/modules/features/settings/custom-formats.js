/**
 * Custom Formats (Movie Hunt) - Radarr-style JSON. Pre-Format (dropdown) or Import (paste JSON).
 * Cards like Profiles; title editable, name auto from JSON.
 */
(function() {
    'use strict';

    window.CustomFormats = {
        _list: [],
        _editingIndex: null,

        refreshList: function() {
            var grid = document.getElementById('custom-formats-grid');
            if (!grid) return;
            fetch('./api/custom-formats')
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    var list = (data && data.custom_formats) ? data.custom_formats : [];
                    window.CustomFormats._list = list;
                    var html = '';
                    for (var i = 0; i < list.length; i++) {
                        var item = list[i];
                        var title = (item.title || item.name || 'Unnamed').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                        var sourceLabel = (item.source || 'import').toLowerCase() === 'preformat' ? 'Pre-Formatted' : 'Imported';
                        html += '<div class="custom-format-card instance-card" data-index="' + i + '" data-app-type="custom-format">' +
                            '<div class="custom-format-card-header">' +
                            '<div class="custom-format-card-title"><i class="fas fa-code"></i><span>' + title + '</span></div>' +
                            '</div>' +
                            '<div class="custom-format-card-body"><span class="custom-format-card-name">' + sourceLabel + '</span></div>' +
                            '<div class="custom-format-card-footer">' +
                            '<button type="button" class="btn-card edit" data-index="' + i + '"><i class="fas fa-edit"></i> Edit</button>' +
                            '<button type="button" class="btn-card delete" data-index="' + i + '"><i class="fas fa-trash"></i> Delete</button>' +
                            '</div></div>';
                    }
                    html += '<div class="add-instance-card" id="custom-formats-add-card" data-app-type="custom-format"><div class="add-icon"><i class="fas fa-plus-circle"></i></div><div class="add-text">Add Custom Format</div></div>';
                    grid.innerHTML = html;
                    window.CustomFormats._bindCards();
                })
                .catch(function() {
                    grid.innerHTML = '<div class="add-instance-card" id="custom-formats-add-card" data-app-type="custom-format"><div class="add-icon"><i class="fas fa-plus-circle"></i></div><div class="add-text">Add Custom Format</div></div>';
                    window.CustomFormats._bindAddCard();
                });
        },

        _bindCards: function() {
            var grid = document.getElementById('custom-formats-grid');
            if (!grid) return;
            grid.querySelectorAll('.custom-format-card .btn-card.edit').forEach(function(btn) {
                btn.onclick = function(e) {
                    e.stopPropagation();
                    var idx = parseInt(btn.getAttribute('data-index'), 10);
                    if (!isNaN(idx)) window.CustomFormats.openEditModal(idx);
                };
            });
            grid.querySelectorAll('.custom-format-card .btn-card.delete').forEach(function(btn) {
                btn.onclick = function(e) {
                    e.stopPropagation();
                    var idx = parseInt(btn.getAttribute('data-index'), 10);
                    if (!isNaN(idx)) window.CustomFormats.deleteFormat(idx);
                };
            });
            window.CustomFormats._bindAddCard();
        },

        _bindAddCard: function() {
            var addCard = document.getElementById('custom-formats-add-card');
            if (addCard) addCard.onclick = function() { window.CustomFormats.openAddModal(); };
        },

        openAddModal: function() {
            window.CustomFormats._editingIndex = null;
            document.getElementById('custom-format-modal-title').textContent = 'Add Custom Format';
            document.getElementById('custom-format-modal-save').innerHTML = '<i class="fas fa-plus"></i> Add';
            document.getElementById('custom-format-source-preformat').checked = true;
            document.getElementById('custom-format-preformat-select').value = '';
            document.getElementById('custom-format-json-textarea').value = '';
            document.getElementById('custom-format-title-input').value = '';
            document.getElementById('custom-format-preformat-area').style.display = 'block';
            document.getElementById('custom-format-import-area').style.display = 'none';
            window.CustomFormats._loadPreformatsDropdown();
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
            document.getElementById('custom-format-import-area').style.display = 'block';
            document.getElementById('custom-format-json-textarea').value = item.custom_format_json || '{}';
            document.getElementById('custom-format-title-input').value = (item.title || item.name || '').trim() || 'Unnamed';
            document.getElementById('custom-format-modal').style.display = 'flex';
            document.body.classList.add('custom-format-modal-open');
        },

        closeModal: function() {
            document.getElementById('custom-format-modal').style.display = 'none';
            document.body.classList.remove('custom-format-modal-open');
        },

        _loadPreformatsDropdown: function() {
            var sel = document.getElementById('custom-format-preformat-select');
            if (!sel) return;
            sel.innerHTML = '<option value="">Select a format...</option>';
            fetch('./api/custom-formats/preformats')
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    var pre = (data && data.preformats) ? data.preformats : [];
                    pre.forEach(function(p) {
                        var opt = document.createElement('option');
                        opt.value = p.id;
                        opt.textContent = p.name || p.id;
                        sel.appendChild(opt);
                    });
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
            document.getElementById('custom-format-preformat-area').style.display = isPre ? 'block' : 'none';
            document.getElementById('custom-format-import-area').style.display = isPre ? 'none' : 'block';
            if (!isPre) {
                var raw = document.getElementById('custom-format-json-textarea').value.trim();
                var name = window.CustomFormats._nameFromJson(raw);
                if (!document.getElementById('custom-format-title-input').value && name !== '—') {
                    document.getElementById('custom-format-title-input').value = name;
                }
            }
        },

        _onPreformatSelect: function() {
            var id = document.getElementById('custom-format-preformat-select').value;
            if (!id) {
                document.getElementById('custom-format-title-input').value = '';
                document.getElementById('custom-format-json-textarea').value = '';
                return;
            }
            fetch('./api/custom-formats/preformats/' + encodeURIComponent(id))
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.success) {
                        var name = data.name || '—';
                        document.getElementById('custom-format-title-input').value = name;
                        document.getElementById('custom-format-json-textarea').value = (data.custom_format_json || '').trim() || '';
                    }
                });
        },

        _onJsonInput: function() {
            var raw = document.getElementById('custom-format-json-textarea').value.trim();
            var name = window.CustomFormats._nameFromJson(raw);
            var titleEl = document.getElementById('custom-format-title-input');
            if (window.CustomFormats._editingIndex == null && name !== '—' && !titleEl.value) {
                titleEl.value = name;
            }
        },

        saveModal: function() {
            var editing = window.CustomFormats._editingIndex;
            var title = (document.getElementById('custom-format-title-input').value || '').trim() || 'Unnamed';

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

            var isPre = document.getElementById('custom-format-source-preformat').checked;
            var body = { title: title };
            if (isPre) {
                var preformatId = document.getElementById('custom-format-preformat-select').value;
                if (!preformatId) {
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification('Select a pre-made format.', 'error');
                    }
                    return;
                }
                body.source = 'preformat';
                body.preformat_id = preformatId;
            } else {
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
                body.source = 'import';
                body.custom_format_json = jsonRaw;
            }

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
            document.querySelectorAll('input[name="custom-format-source"]').forEach(function(radio) {
                radio.onchange = function() { self._onSourceChange(); };
            });
            var preformatSel = document.getElementById('custom-format-preformat-select');
            if (preformatSel) preformatSel.onchange = function() { self._onPreformatSelect(); };
            var jsonTa = document.getElementById('custom-format-json-textarea');
            if (jsonTa) {
                jsonTa.addEventListener('input', function() { self._onJsonInput(); });
                jsonTa.addEventListener('paste', function() { setTimeout(function() { self._onJsonInput(); }, 0); });
            }
            document.addEventListener('keydown', function(e) {
                if (e.key === 'Escape' && modal && modal.style.display === 'flex') {
                    self.closeModal();
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
