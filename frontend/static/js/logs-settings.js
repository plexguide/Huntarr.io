/**
 * Huntarr - Logs Settings Page
 * Handles log rotation and retention configuration
 */

(function() {
    'use strict';
    
    // Initialize unsaved changes flag
    window.logsUnsavedChanges = false;
    
    // Store original settings for change detection
    let originalSettings = {};
    
    // Wait for DOM to be ready
    document.addEventListener('DOMContentLoaded', function() {
        console.log('[LogsSettings] Page loaded');
        setupEventHandlers();
        loadLogSettings();
        setupChangeDetection();
    });
    
    // Setup all event handlers
    function setupEventHandlers() {
        const saveBtn = document.getElementById('saveLogSettings');
        if (saveBtn) {
            saveBtn.addEventListener('click', handleSaveLogSettings);
        }
        
        const cleanupBtn = document.getElementById('cleanupLogsNow');
        if (cleanupBtn) {
            cleanupBtn.addEventListener('click', handleCleanupLogsNow);
        }
    }
    
    // Load log settings and current usage stats
    async function loadLogSettings() {
        console.log('[LogsSettings] Loading log settings...');
        
        try {
            const response = await fetch('./api/logs/settings');
            const data = await response.json();
            
            if (data.success) {
                const settings = data.settings || {};
                
                console.log('[LogsSettings] Loaded settings:', settings);
                console.log('[LogsSettings] Log files:', data.log_files);
                console.log('[LogsSettings] Total size:', data.total_size_mb, 'MB');
                
                // Populate form fields
                const rotationEnabled = document.getElementById('rotationEnabled');
                if (rotationEnabled) {
                    rotationEnabled.checked = settings.rotation_enabled !== false;
                }
                
                const maxLogSize = document.getElementById('maxLogSize');
                if (maxLogSize) {
                    maxLogSize.value = settings.max_log_size_mb || 50;
                }
                
                const backupCount = document.getElementById('backupCount');
                if (backupCount) {
                    backupCount.value = settings.backup_count || 5;
                }
                
                const retentionDays = document.getElementById('retentionDays');
                if (retentionDays) {
                    retentionDays.value = settings.retention_days || 30;
                }
                
                const compressRotated = document.getElementById('compressRotated');
                if (compressRotated) {
                    compressRotated.checked = settings.compress_rotated !== false;
                }
                
                const logLevel = document.getElementById('logLevel');
                if (logLevel) {
                    logLevel.value = settings.log_level || 'INFO';
                }
                
                const autoCleanup = document.getElementById('autoCleanup');
                if (autoCleanup) {
                    autoCleanup.checked = settings.auto_cleanup_enabled !== false;
                }
                
                // Update log stats
                const totalLogSize = data.total_size_mb || 0;
                const fileCount = Object.keys(data.log_files || {}).length;
                const totalSizeElement = document.getElementById('totalLogSize');
                if (totalSizeElement) {
                    totalSizeElement.textContent = `${totalLogSize.toFixed(2)} MB across ${fileCount} files`;
                }
                
                // Store original settings for change detection
                originalSettings = {
                    rotation_enabled: settings.rotation_enabled !== false,
                    max_log_size_mb: settings.max_log_size_mb || 50,
                    backup_count: settings.backup_count || 5,
                    retention_days: settings.retention_days || 30,
                    compress_rotated: settings.compress_rotated !== false,
                    log_level: settings.log_level || 'INFO',
                    auto_cleanup_enabled: settings.auto_cleanup_enabled !== false
                };
                
                console.log('[LogsSettings] Settings loaded successfully');
            } else {
                console.error('[LogsSettings] Failed to load settings:', data.error);
                const totalSizeElement = document.getElementById('totalLogSize');
                if (totalSizeElement) {
                    totalSizeElement.textContent = 'Error loading log stats';
                }
            }
        } catch (error) {
            console.error('[LogsSettings] Error loading log settings:', error);
            const totalSizeElement = document.getElementById('totalLogSize');
            if (totalSizeElement) {
                totalSizeElement.textContent = 'Error loading log stats';
            }
        }
    }
    
    // Save log settings
    async function handleSaveLogSettings() {
        console.log('[LogsSettings] Saving log settings...');
        
        const statusElement = document.getElementById('logSettingsStatus');
        const saveBtn = document.getElementById('saveLogSettings');
        
        // Disable button during request
        if (saveBtn) saveBtn.disabled = true;
        
        try {
            const settings = {
                rotation_enabled: document.getElementById('rotationEnabled').checked,
                max_log_size_mb: parseInt(document.getElementById('maxLogSize').value),
                backup_count: parseInt(document.getElementById('backupCount').value),
                retention_days: parseInt(document.getElementById('retentionDays').value),
                compress_rotated: document.getElementById('compressRotated').checked,
                log_level: document.getElementById('logLevel').value,
                auto_cleanup_enabled: document.getElementById('autoCleanup').checked
            };
            
            console.log('[LogsSettings] Saving settings:', settings);
            
            const response = await fetch('./api/logs/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(settings)
            });
            
            const data = await response.json();
            
            if (data.success) {
                showStatus(statusElement, data.message || 'Settings saved successfully. Restart Huntarr for changes to take effect.', 'success');
                console.log('[LogsSettings] Settings saved successfully');
                
                // Clear unsaved changes flag
                window.logsUnsavedChanges = false;
                if (window.SettingsForms && typeof window.SettingsForms.removeUnsavedChangesWarning === 'function') {
                    window.SettingsForms.removeUnsavedChangesWarning();
                }
                
                // Reload stats after saving
                setTimeout(() => loadLogSettings(), 1500);
            } else {
                showStatus(statusElement, data.error || 'Failed to save settings', 'error');
                console.error('[LogsSettings] Failed to save settings:', data.error);
            }
        } catch (error) {
            console.error('[LogsSettings] Error saving log settings:', error);
            showStatus(statusElement, 'Error saving settings', 'error');
        } finally {
            // Re-enable button
            if (saveBtn) {
                setTimeout(() => {
                    saveBtn.disabled = false;
                }, 1000);
            }
        }
    }
    
    // Clean up old logs now
    async function handleCleanupLogsNow() {
        console.log('[LogsSettings] Manual cleanup triggered');
        
        const statusElement = document.getElementById('logSettingsStatus');
        const cleanupBtn = document.getElementById('cleanupLogsNow');
        
        if (!confirm('Are you sure you want to clean up old log files? This will delete logs older than the configured retention period. This action cannot be undone.')) {
            return;
        }
        
        // Disable button during request
        if (cleanupBtn) cleanupBtn.disabled = true;
        
        try {
            showStatus(statusElement, 'Cleaning up old logs...', 'success');
            
            const response = await fetch('./api/logs/cleanup-now', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            
            const data = await response.json();
            
            if (data.success) {
                showStatus(statusElement, data.message || 'Cleanup completed successfully', 'success');
                console.log('[LogsSettings] Cleanup completed:', data);
                
                // Reload stats after cleanup
                setTimeout(() => loadLogSettings(), 1500);
            } else {
                showStatus(statusElement, data.error || 'Failed to cleanup logs', 'error');
                console.error('[LogsSettings] Cleanup failed:', data.error);
            }
        } catch (error) {
            console.error('[LogsSettings] Error cleaning up logs:', error);
            showStatus(statusElement, 'Error cleaning up logs', 'error');
        } finally {
            // Re-enable button
            if (cleanupBtn) {
                setTimeout(() => {
                    cleanupBtn.disabled = false;
                }, 1000);
            }
        }
    }
    
    // Show status message
    function showStatus(element, message, type) {
        if (!element) return;
        
        element.textContent = message;
        element.className = `status-message ${type}`;
        element.style.display = 'block';
        
        // Hide after 10 seconds for success, 15 for errors
        const hideDelay = type === 'error' ? 15000 : 10000;
        setTimeout(() => {
            element.style.display = 'none';
        }, hideDelay);
    }
    
    // Setup change detection for all form fields
    function setupChangeDetection() {
        console.log('[LogsSettings] Setting up change detection');
        
        const formFields = [
            'rotationEnabled',
            'maxLogSize',
            'backupCount',
            'retentionDays',
            'compressRotated',
            'logLevel',
            'autoCleanup'
        ];
        
        formFields.forEach(fieldId => {
            const field = document.getElementById(fieldId);
            if (field) {
                field.addEventListener('change', checkForChanges);
                field.addEventListener('input', checkForChanges);
            }
        });
    }
    
    // Check if current form values differ from original settings
    function checkForChanges() {
        if (!originalSettings || Object.keys(originalSettings).length === 0) {
            return; // No original settings loaded yet
        }
        
        const currentSettings = {
            rotation_enabled: document.getElementById('rotationEnabled')?.checked || false,
            max_log_size_mb: parseInt(document.getElementById('maxLogSize')?.value) || 50,
            backup_count: parseInt(document.getElementById('backupCount')?.value) || 5,
            retention_days: parseInt(document.getElementById('retentionDays')?.value) || 30,
            compress_rotated: document.getElementById('compressRotated')?.checked || false,
            log_level: document.getElementById('logLevel')?.value || 'INFO',
            auto_cleanup_enabled: document.getElementById('autoCleanup')?.checked || false
        };
        
        // Compare current settings with original
        const hasChanges = JSON.stringify(currentSettings) !== JSON.stringify(originalSettings);
        
        if (hasChanges && !window.logsUnsavedChanges) {
            console.log('[LogsSettings] Changes detected - adding unsaved changes warning');
            window.logsUnsavedChanges = true;
            if (window.SettingsForms && typeof window.SettingsForms.addUnsavedChangesWarning === 'function') {
                window.SettingsForms.addUnsavedChangesWarning();
            }
        } else if (!hasChanges && window.logsUnsavedChanges) {
            console.log('[LogsSettings] Changes reverted - removing unsaved changes warning');
            window.logsUnsavedChanges = false;
            if (window.SettingsForms && typeof window.SettingsForms.removeUnsavedChangesWarning === 'function') {
                window.SettingsForms.removeUnsavedChangesWarning();
            }
        }
    }
})();
