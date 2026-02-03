/**
 * Remote Mappings (Movie Hunt) - table-based UI with edit modal
 * Attaches to window.RemoteMappings. Load after settings core.
 */
(function() {
    'use strict';

    window.RemoteMappings = {
        currentMappings: [],
        editingIndex: null,
        downloadClients: [],

        refreshList: function() {
            const tbody = document.getElementById('remote-mappings-table-body');
            if (!tbody) return;

            // Fetch mappings
            fetch('./api/movie-hunt/remote-mappings')
                .then(r => r.json())
                .then(data => {
                    this.currentMappings = (data && data.mappings) ? data.mappings : [];
                    
                    // Clear and rebuild table
                    tbody.innerHTML = '';
                    
                    if (this.currentMappings.length === 0) {
                        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 20px; color: #94a3b8;">No remote path mappings configured</td></tr>';
                        return;
                    }

                    this.currentMappings.forEach((mapping, idx) => {
                        const row = document.createElement('tr');
                        row.innerHTML = `
                            <td>${this.escapeHtml(mapping.host || '')}</td>
                            <td>${this.escapeHtml(mapping.remote_path || '')}</td>
                            <td>${this.escapeHtml(mapping.local_path || '')}</td>
                            <td class="remote-mappings-actions-col">
                                <button class="btn-edit-mapping" data-index="${idx}" title="Edit">
                                    <i class="fas fa-edit"></i>
                                </button>
                            </td>
                        `;
                        tbody.appendChild(row);
                    });
                })
                .catch(err => {
                    console.error('[RemoteMappings] Error loading mappings:', err);
                    tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 20px; color: #fca5a5;">Error loading remote path mappings</td></tr>';
                });
        },

        loadDownloadClients: function() {
            // Load download clients from the clients API
            fetch('./api/clients')
                .then(r => r.json())
                .then(data => {
                    this.downloadClients = (data && data.clients) ? data.clients : [];
                    this.populateHostDropdown();
                })
                .catch(err => {
                    console.error('[RemoteMappings] Error loading download clients:', err);
                    this.downloadClients = [];
                    this.populateHostDropdown();
                });
        },

        populateHostDropdown: function() {
            const hostSelect = document.getElementById('remote-mapping-host');
            if (!hostSelect) return;

            // Clear existing options except the first one
            hostSelect.innerHTML = '<option value="">Select a download client...</option>';

            // Add download clients
            this.downloadClients.forEach(client => {
                const host = `${client.host || ''}:${client.port || ''}`;
                const option = document.createElement('option');
                option.value = host;
                option.textContent = `${client.name || 'Unknown'} (${host})`;
                hostSelect.appendChild(option);
            });
        },

        openAddModal: function() {
            this.editingIndex = null;
            this.loadDownloadClients();
            
            const modal = document.getElementById('remote-mapping-edit-modal');
            const title = document.getElementById('remote-mapping-modal-title');
            const deleteBtn = document.getElementById('remote-mapping-modal-delete');
            const hostSelect = document.getElementById('remote-mapping-host');
            const remotePathInput = document.getElementById('remote-mapping-remote-path');
            const localPathInput = document.getElementById('remote-mapping-local-path');

            if (title) title.textContent = 'Add Remote Path Mapping';
            if (deleteBtn) deleteBtn.style.display = 'none';
            if (hostSelect) hostSelect.value = '';
            if (remotePathInput) remotePathInput.value = '';
            if (localPathInput) localPathInput.value = '';

            if (modal) {
                modal.style.display = 'flex';
                document.body.classList.add('remote-mapping-edit-modal-open');
            }
        },

        openEditModal: function(index) {
            if (index < 0 || index >= this.currentMappings.length) return;
            
            this.editingIndex = index;
            this.loadDownloadClients();
            
            const mapping = this.currentMappings[index];
            const modal = document.getElementById('remote-mapping-edit-modal');
            const title = document.getElementById('remote-mapping-modal-title');
            const deleteBtn = document.getElementById('remote-mapping-modal-delete');
            const hostSelect = document.getElementById('remote-mapping-host');
            const remotePathInput = document.getElementById('remote-mapping-remote-path');
            const localPathInput = document.getElementById('remote-mapping-local-path');

            if (title) title.textContent = 'Edit Remote Path Mapping';
            if (deleteBtn) deleteBtn.style.display = 'flex';
            if (hostSelect) hostSelect.value = mapping.host || '';
            if (remotePathInput) remotePathInput.value = mapping.remote_path || '';
            if (localPathInput) localPathInput.value = mapping.local_path || '';

            if (modal) {
                modal.style.display = 'flex';
                document.body.classList.add('remote-mapping-edit-modal-open');
            }
        },

        closeModal: function() {
            const modal = document.getElementById('remote-mapping-edit-modal');
            if (modal) {
                modal.style.display = 'none';
                document.body.classList.remove('remote-mapping-edit-modal-open');
            }
            this.editingIndex = null;
        },

        saveMapping: function() {
            const hostSelect = document.getElementById('remote-mapping-host');
            const remotePathInput = document.getElementById('remote-mapping-remote-path');
            const localPathInput = document.getElementById('remote-mapping-local-path');

            const host = (hostSelect && hostSelect.value) ? hostSelect.value.trim() : '';
            const remotePath = (remotePathInput && remotePathInput.value) ? remotePathInput.value.trim() : '';
            const localPath = (localPathInput && localPathInput.value) ? localPathInput.value.trim() : '';

            if (!host) {
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('Please select a host', 'error');
                } else {
                    alert('Please select a host');
                }
                return;
            }

            if (!remotePath) {
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('Remote path is required', 'error');
                } else {
                    alert('Remote path is required');
                }
                return;
            }

            if (!localPath) {
                if (window.huntarrUI && window.huntarrUI.showNotification) {
                    window.huntarrUI.showNotification('Local path is required', 'error');
                } else {
                    alert('Local path is required');
                }
                return;
            }

            const payload = {
                host: host,
                remote_path: remotePath,
                local_path: localPath
            };

            let url, method;
            if (this.editingIndex !== null) {
                // Update existing mapping
                url = `./api/movie-hunt/remote-mappings/${this.editingIndex}`;
                method = 'PUT';
            } else {
                // Add new mapping
                url = './api/movie-hunt/remote-mappings';
                method = 'POST';
            }

            fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })
                .then(r => r.json())
                .then(data => {
                    if (data.success) {
                        this.closeModal();
                        this.refreshList();
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification('Remote path mapping saved', 'success');
                        }
                    } else {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification(data.message || 'Failed to save mapping', 'error');
                        } else {
                            alert(data.message || 'Failed to save mapping');
                        }
                    }
                })
                .catch(err => {
                    console.error('[RemoteMappings] Save error:', err);
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification('Failed to save mapping', 'error');
                    } else {
                        alert('Failed to save mapping');
                    }
                });
        },

        deleteMapping: function() {
            if (this.editingIndex === null) return;

            const mapping = this.currentMappings[this.editingIndex];
            const confirmMsg = `Delete remote path mapping for ${mapping.host || 'this host'}?`;
            
            if (!confirm(confirmMsg)) return;

            fetch(`./api/movie-hunt/remote-mappings/${this.editingIndex}`, {
                method: 'DELETE'
            })
                .then(r => r.json())
                .then(data => {
                    if (data.success) {
                        this.closeModal();
                        this.refreshList();
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification('Remote path mapping deleted', 'success');
                        }
                    } else {
                        if (window.huntarrUI && window.huntarrUI.showNotification) {
                            window.huntarrUI.showNotification(data.message || 'Failed to delete mapping', 'error');
                        } else {
                            alert(data.message || 'Failed to delete mapping');
                        }
                    }
                })
                .catch(err => {
                    console.error('[RemoteMappings] Delete error:', err);
                    if (window.huntarrUI && window.huntarrUI.showNotification) {
                        window.huntarrUI.showNotification('Failed to delete mapping', 'error');
                    } else {
                        alert('Failed to delete mapping');
                    }
                });
        },

        escapeHtml: function(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        },

        init: function() {
            // Event listeners for table actions (edit buttons)
            const tbody = document.getElementById('remote-mappings-table-body');
            if (tbody) {
                tbody.addEventListener('click', (e) => {
                    const editBtn = e.target.closest('.btn-edit-mapping');
                    if (editBtn) {
                        const index = parseInt(editBtn.dataset.index, 10);
                        this.openEditModal(index);
                    }
                });
            }

            // Add button
            const addBtn = document.getElementById('add-remote-mapping-btn');
            if (addBtn) {
                addBtn.addEventListener('click', () => {
                    this.openAddModal();
                });
            }

            // Modal close buttons
            const closeBtn = document.getElementById('remote-mapping-edit-modal-close');
            const cancelBtn = document.getElementById('remote-mapping-modal-cancel');
            const backdrop = document.getElementById('remote-mapping-edit-modal-backdrop');
            
            if (closeBtn) {
                closeBtn.addEventListener('click', () => {
                    this.closeModal();
                });
            }
            if (cancelBtn) {
                cancelBtn.addEventListener('click', () => {
                    this.closeModal();
                });
            }
            if (backdrop) {
                backdrop.addEventListener('click', () => {
                    this.closeModal();
                });
            }

            // Save button
            const saveBtn = document.getElementById('remote-mapping-modal-save');
            if (saveBtn) {
                saveBtn.addEventListener('click', () => {
                    this.saveMapping();
                });
            }

            // Delete button
            const deleteBtn = document.getElementById('remote-mapping-modal-delete');
            if (deleteBtn) {
                deleteBtn.addEventListener('click', () => {
                    this.deleteMapping();
                });
            }

            // Browse folder buttons (placeholder - can be enhanced later)
            const browseFolderBtn = document.getElementById('remote-mapping-browse-folder-btn');
            const browseLocalBtn = document.getElementById('remote-mapping-browse-local-btn');
            
            if (browseFolderBtn) {
                browseFolderBtn.addEventListener('click', () => {
                    // TODO: Implement folder browser if needed
                    console.log('[RemoteMappings] Browse folder clicked');
                });
            }
            if (browseLocalBtn) {
                browseLocalBtn.addEventListener('click', () => {
                    // TODO: Implement folder browser if needed
                    console.log('[RemoteMappings] Browse local folder clicked');
                });
            }

            // ESC key to close modal
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    const modal = document.getElementById('remote-mapping-edit-modal');
                    if (modal && modal.style.display === 'flex') {
                        this.closeModal();
                    }
                }
            });
        }
    };

    // Initialize on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            window.RemoteMappings.init();
        });
    } else {
        window.RemoteMappings.init();
    }
})();
