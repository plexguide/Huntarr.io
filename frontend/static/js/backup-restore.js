/**
 * Backup and Restore functionality for Huntarr
 * Handles database backup creation, restoration, and management
 */

const BackupRestore = {
    initialized: false,
    backupSettings: {
        frequency: 3,
        retention: 3
    },

    initialize: function() {
        if (this.initialized) {
            console.log('[BackupRestore] Already initialized');
            return;
        }

        console.log('[BackupRestore] Initializing backup/restore functionality');
        
        this.bindEvents();
        this.loadSettings();
        this.loadBackupList();
        this.updateNextBackupTime();
        
        this.initialized = true;
        console.log('[BackupRestore] Initialization complete');
    },

    bindEvents: function() {
        // Backup frequency change
        const frequencyInput = document.getElementById('backup-frequency');
        if (frequencyInput) {
            frequencyInput.addEventListener('change', () => {
                this.backupSettings.frequency = parseInt(frequencyInput.value) || 3;
                this.saveSettings();
                this.updateNextBackupTime();
            });
        }

        // Backup retention change
        const retentionInput = document.getElementById('backup-retention');
        if (retentionInput) {
            retentionInput.addEventListener('change', () => {
                this.backupSettings.retention = parseInt(retentionInput.value) || 3;
                this.saveSettings();
            });
        }

        // Create manual backup
        const createBackupBtn = document.getElementById('create-backup-btn');
        if (createBackupBtn) {
            createBackupBtn.addEventListener('click', () => {
                this.createManualBackup();
            });
        }

        // Restore backup selection
        const restoreSelect = document.getElementById('restore-backup-select');
        if (restoreSelect) {
            restoreSelect.addEventListener('change', () => {
                this.handleRestoreSelection();
            });
        }

        // Restore confirmation input
        const restoreConfirmation = document.getElementById('restore-confirmation');
        if (restoreConfirmation) {
            restoreConfirmation.addEventListener('input', () => {
                this.validateRestoreConfirmation();
            });
        }

        // Restore button
        const restoreBtn = document.getElementById('restore-backup-btn');
        if (restoreBtn) {
            restoreBtn.addEventListener('click', () => {
                this.restoreBackup();
            });
        }

        // Delete confirmation input
        const deleteConfirmation = document.getElementById('delete-confirmation');
        if (deleteConfirmation) {
            deleteConfirmation.addEventListener('input', () => {
                this.validateDeleteConfirmation();
            });
        }

        // Delete database button
        const deleteBtn = document.getElementById('delete-database-btn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', () => {
                this.deleteDatabase();
            });
        }
    },

    loadSettings: function() {
        console.log('[BackupRestore] Loading backup settings');
        
        fetch('./api/backup/settings')
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    this.backupSettings = {
                        frequency: data.settings.frequency || 3,
                        retention: data.settings.retention || 3
                    };
                    
                    // Update UI
                    const frequencyInput = document.getElementById('backup-frequency');
                    const retentionInput = document.getElementById('backup-retention');
                    
                    if (frequencyInput) frequencyInput.value = this.backupSettings.frequency;
                    if (retentionInput) retentionInput.value = this.backupSettings.retention;
                    
                    this.updateNextBackupTime();
                }
            })
            .catch(error => {
                console.error('[BackupRestore] Error loading settings:', error);
                this.showError('Failed to load backup settings');
            });
    },

    saveSettings: function() {
        console.log('[BackupRestore] Saving backup settings', this.backupSettings);
        
        fetch('./api/backup/settings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(this.backupSettings)
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                console.log('[BackupRestore] Settings saved successfully');
                this.showSuccess('Backup settings saved');
            } else {
                throw new Error(data.error || 'Failed to save settings');
            }
        })
        .catch(error => {
            console.error('[BackupRestore] Error saving settings:', error);
            this.showError('Failed to save backup settings');
        });
    },

    loadBackupList: function() {
        console.log('[BackupRestore] Loading backup list');
        
        const listContainer = document.getElementById('backup-list-container');
        const restoreSelect = document.getElementById('restore-backup-select');
        
        if (listContainer) {
            listContainer.innerHTML = '<div class="backup-list-loading"><i class="fas fa-spinner fa-spin"></i> Loading backup list...</div>';
        }
        
        if (restoreSelect) {
            restoreSelect.innerHTML = '<option value="">Loading available backups...</option>';
        }
        
        fetch('./api/backup/list')
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    this.renderBackupList(data.backups);
                    this.populateRestoreSelect(data.backups);
                } else {
                    throw new Error(data.error || 'Failed to load backups');
                }
            })
            .catch(error => {
                console.error('[BackupRestore] Error loading backup list:', error);
                if (listContainer) {
                    listContainer.innerHTML = '<div class="backup-list-loading">Error loading backup list</div>';
                }
                if (restoreSelect) {
                    restoreSelect.innerHTML = '<option value="">Error loading backups</option>';
                }
            });
    },

    renderBackupList: function(backups) {
        const listContainer = document.getElementById('backup-list-container');
        if (!listContainer) return;

        if (!backups || backups.length === 0) {
            listContainer.innerHTML = '<div class="backup-list-loading">No backups available</div>';
            return;
        }

        let html = '';
        backups.forEach(backup => {
            const date = new Date(backup.timestamp);
            const formattedDate = date.toLocaleString();
            const size = this.formatFileSize(backup.size);
            
            html += `
                <div class="backup-item" data-backup-id="${backup.id}">
                    <div class="backup-info">
                        <div class="backup-name">${backup.name}</div>
                        <div class="backup-details">
                            Created: ${formattedDate} | Size: ${size} | Type: ${backup.type || 'Manual'}
                        </div>
                    </div>
                    <div class="backup-actions">
                        <button class="delete-backup-btn" onclick="BackupRestore.deleteBackup('${backup.id}')">
                            <i class="fas fa-trash"></i> Delete
                        </button>
                    </div>
                </div>
            `;
        });

        listContainer.innerHTML = html;
    },

    populateRestoreSelect: function(backups) {
        const restoreSelect = document.getElementById('restore-backup-select');
        if (!restoreSelect) return;

        if (!backups || backups.length === 0) {
            restoreSelect.innerHTML = '<option value="">No backups available</option>';
            return;
        }

        let html = '<option value="">Select a backup to restore...</option>';
        backups.forEach(backup => {
            const date = new Date(backup.timestamp);
            const formattedDate = date.toLocaleString();
            const size = this.formatFileSize(backup.size);
            
            html += `<option value="${backup.id}">${backup.name} - ${formattedDate} (${size})</option>`;
        });

        restoreSelect.innerHTML = html;
    },

    updateNextBackupTime: function() {
        const nextBackupElement = document.getElementById('next-backup-time');
        if (!nextBackupElement) return;

        fetch('./api/backup/next-scheduled')
            .then(response => response.json())
            .then(data => {
                if (data.success && data.next_backup) {
                    const nextDate = new Date(data.next_backup);
                    nextBackupElement.innerHTML = `<i class="fas fa-clock"></i> ${nextDate.toLocaleString()}`;
                } else {
                    nextBackupElement.innerHTML = '<i class="fas fa-clock"></i> Not scheduled';
                }
            })
            .catch(error => {
                console.error('[BackupRestore] Error getting next backup time:', error);
                nextBackupElement.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Error loading schedule';
            });
    },

    createManualBackup: function() {
        console.log('[BackupRestore] Creating manual backup');
        
        const createBtn = document.getElementById('create-backup-btn');
        const progressContainer = document.getElementById('backup-progress');
        const progressFill = document.querySelector('.progress-fill');
        const progressText = document.querySelector('.progress-text');
        
        if (createBtn) createBtn.disabled = true;
        if (progressContainer) progressContainer.style.display = 'block';
        if (progressText) progressText.textContent = 'Creating backup...';
        
        // Animate progress bar
        let progress = 0;
        const progressInterval = setInterval(() => {
            progress += Math.random() * 15;
            if (progress > 90) progress = 90;
            if (progressFill) progressFill.style.width = progress + '%';
        }, 200);

        fetch('./api/backup/create', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                type: 'manual',
                name: `Manual Backup ${new Date().toISOString().split('T')[0]}`
            })
        })
        .then(response => response.json())
        .then(data => {
            clearInterval(progressInterval);
            
            if (data.success) {
                if (progressFill) progressFill.style.width = '100%';
                if (progressText) progressText.textContent = 'Backup created successfully!';
                
                setTimeout(() => {
                    if (progressContainer) progressContainer.style.display = 'none';
                    if (progressFill) progressFill.style.width = '0%';
                }, 2000);
                
                this.showSuccess(`Backup created successfully: ${data.backup_name}`);
                this.loadBackupList(); // Refresh the list
            } else {
                throw new Error(data.error || 'Failed to create backup');
            }
        })
        .catch(error => {
            clearInterval(progressInterval);
            console.error('[BackupRestore] Error creating backup:', error);
            
            if (progressContainer) progressContainer.style.display = 'none';
            if (progressFill) progressFill.style.width = '0%';
            
            this.showError('Failed to create backup: ' + error.message);
        })
        .finally(() => {
            if (createBtn) createBtn.disabled = false;
        });
    },

    handleRestoreSelection: function() {
        const restoreSelect = document.getElementById('restore-backup-select');
        const confirmationGroup = document.getElementById('restore-confirmation-group');
        const actionGroup = document.getElementById('restore-action-group');
        
        if (!restoreSelect) return;
        
        if (restoreSelect.value) {
            if (confirmationGroup) confirmationGroup.style.display = 'block';
            if (actionGroup) actionGroup.style.display = 'block';
        } else {
            if (confirmationGroup) confirmationGroup.style.display = 'none';
            if (actionGroup) actionGroup.style.display = 'none';
        }
        
        this.validateRestoreConfirmation();
    },

    validateRestoreConfirmation: function() {
        const confirmationInput = document.getElementById('restore-confirmation');
        const restoreBtn = document.getElementById('restore-backup-btn');
        
        if (!confirmationInput || !restoreBtn) return;
        
        const isValid = confirmationInput.value.toUpperCase() === 'RESTORE';
        restoreBtn.disabled = !isValid;
        
        if (isValid) {
            restoreBtn.style.background = '#e74c3c';
            restoreBtn.style.cursor = 'pointer';
        } else {
            restoreBtn.style.background = '#6b7280';
            restoreBtn.style.cursor = 'not-allowed';
        }
    },

    restoreBackup: function() {
        const restoreSelect = document.getElementById('restore-backup-select');
        const confirmationInput = document.getElementById('restore-confirmation');
        
        if (!restoreSelect || !confirmationInput) return;
        
        const backupId = restoreSelect.value;
        const confirmation = confirmationInput.value.toUpperCase();
        
        if (!backupId || confirmation !== 'RESTORE') {
            this.showError('Please select a backup and type RESTORE to confirm');
            return;
        }

        // Final confirmation dialog
        if (!confirm('This will permanently overwrite your current database. Are you absolutely sure?')) {
            return;
        }

        console.log('[BackupRestore] Restoring backup:', backupId);
        
        const restoreBtn = document.getElementById('restore-backup-btn');
        if (restoreBtn) {
            restoreBtn.disabled = true;
            restoreBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Restoring...';
        }

        fetch('./api/backup/restore', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                backup_id: backupId
            })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                this.showSuccess('Database restored successfully! Reloading page...');
                
                // Reload the page after a short delay
                setTimeout(() => {
                    window.location.reload();
                }, 2000);
            } else {
                throw new Error(data.error || 'Failed to restore backup');
            }
        })
        .catch(error => {
            console.error('[BackupRestore] Error restoring backup:', error);
            this.showError('Failed to restore backup: ' + error.message);
        })
        .finally(() => {
            if (restoreBtn) {
                restoreBtn.disabled = false;
                restoreBtn.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Restore Database';
            }
        });
    },

    validateDeleteConfirmation: function() {
        const confirmationInput = document.getElementById('delete-confirmation');
        const actionGroup = document.getElementById('delete-action-group');
        const deleteBtn = document.getElementById('delete-database-btn');
        
        if (!confirmationInput || !actionGroup || !deleteBtn) return;
        
        const isValid = confirmationInput.value.toLowerCase() === 'huntarr';
        
        if (isValid) {
            actionGroup.style.display = 'block';
            deleteBtn.disabled = false;
            deleteBtn.style.background = '#e74c3c';
            deleteBtn.style.cursor = 'pointer';
        } else {
            actionGroup.style.display = 'none';
            deleteBtn.disabled = true;
        }
    },

    deleteDatabase: function() {
        const confirmationInput = document.getElementById('delete-confirmation');
        
        if (!confirmationInput || confirmationInput.value.toLowerCase() !== 'huntarr') {
            this.showError('Please type "huntarr" to confirm database deletion');
            return;
        }

        // Final confirmation dialog
        if (!confirm('This will PERMANENTLY DELETE your entire Huntarr database. This action CANNOT be undone. Are you absolutely sure?')) {
            return;
        }

        console.log('[BackupRestore] Deleting database');
        
        const deleteBtn = document.getElementById('delete-database-btn');
        if (deleteBtn) {
            deleteBtn.disabled = true;
            deleteBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Deleting...';
        }

        fetch('./api/backup/delete-database', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                this.showSuccess('Database deleted successfully! Redirecting to setup...');
                
                // Redirect to setup after a short delay
                setTimeout(() => {
                    window.location.href = './setup';
                }, 2000);
            } else {
                throw new Error(data.error || 'Failed to delete database');
            }
        })
        .catch(error => {
            console.error('[BackupRestore] Error deleting database:', error);
            this.showError('Failed to delete database: ' + error.message);
        })
        .finally(() => {
            if (deleteBtn) {
                deleteBtn.disabled = false;
                deleteBtn.innerHTML = '<i class="fas fa-trash-alt"></i> Delete Database';
            }
        });
    },

    deleteBackup: function(backupId) {
        if (!confirm('Are you sure you want to delete this backup? This action cannot be undone.')) {
            return;
        }

        console.log('[BackupRestore] Deleting backup:', backupId);

        fetch('./api/backup/delete', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                backup_id: backupId
            })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                this.showSuccess('Backup deleted successfully');
                this.loadBackupList(); // Refresh the list
            } else {
                throw new Error(data.error || 'Failed to delete backup');
            }
        })
        .catch(error => {
            console.error('[BackupRestore] Error deleting backup:', error);
            this.showError('Failed to delete backup: ' + error.message);
        });
    },

    formatFileSize: function(bytes) {
        if (bytes === 0) return '0 Bytes';
        
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    },

    showSuccess: function(message) {
        this.showNotification(message, 'success');
    },

    showError: function(message) {
        this.showNotification(message, 'error');
    },

    showNotification: function(message, type) {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `backup-notification ${type}`;
        notification.innerHTML = `
            <i class="fas ${type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle'}"></i>
            <span>${message}</span>
            <button onclick="this.parentElement.remove()">×</button>
        `;

        // Add styles
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${type === 'success' ? '#10b981' : '#e74c3c'};
            color: white;
            padding: 12px 16px;
            border-radius: 6px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            z-index: 10000;
            display: flex;
            align-items: center;
            gap: 8px;
            max-width: 400px;
            animation: slideIn 0.3s ease;
        `;

        // Add animation styles
        const style = document.createElement('style');
        style.textContent = `
            @keyframes slideIn {
                from { transform: translateX(100%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
            .backup-notification button {
                background: none;
                border: none;
                color: white;
                font-size: 18px;
                cursor: pointer;
                padding: 0;
                margin-left: auto;
            }
        `;
        document.head.appendChild(style);

        document.body.appendChild(notification);

        // Auto-remove after 5 seconds
        setTimeout(() => {
            if (notification.parentElement) {
                notification.remove();
            }
        }, 5000);
    }
};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    // Don't auto-initialize - let the main UI handle it
    console.log('[BackupRestore] Module loaded');
});