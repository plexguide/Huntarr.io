(function() {
    window.SettingsForms = window.SettingsForms || {};

    window.SettingsForms.generateLogsSettingsForm = function(container, settings = {}) {
        if (!settings || typeof settings !== "object") {
            settings = {};
        }

        container.setAttribute("data-app-type", "logs");

        container.innerHTML = `
            <!-- Two-column grid (header is in template) -->
            <div class="mset-grid">

                <!-- Log Rotation card -->
                <div class="mset-card">
                    <div class="mset-card-header">
                        <div class="mset-card-icon mset-icon-blue"><i class="fas fa-sync-alt"></i></div>
                        <h3>Log Rotation</h3>
                    </div>
                    <div class="mset-card-body">
                        <div class="setting-item">
                            <label for="log_rotation_enabled">Enable Log Rotation:</label>
                            <label class="toggle-switch">
                                <input type="checkbox" id="log_rotation_enabled" name="log_rotation_enabled" ${
                                  settings.log_rotation_enabled !== false ? "checked" : ""
                                }>
                                <span class="toggle-slider"></span>
                            </label>
                            <p class="setting-help">Automatically rotate log files when they reach a certain size</p>
                        </div>
                        <div class="setting-item">
                            <label for="log_max_size_mb">Max File Size:</label>
                            <div style="display: flex; align-items: center; gap: 10px;">
                                <input type="number" id="log_max_size_mb" name="log_max_size_mb" min="1" max="500" value="${
                                  settings.log_max_size_mb || 50
                                }" class="mset-input" style="width: 100px; max-width: 100px;">
                                <span style="color: #9ca3af; font-size: 13px;">MB</span>
                            </div>
                            <p class="setting-help">Maximum size before rotating to a new file</p>
                        </div>
                        <div class="setting-item">
                            <label for="log_backup_count">Backup Files to Keep:</label>
                            <input type="number" id="log_backup_count" name="log_backup_count" min="0" max="50" value="${
                              settings.log_backup_count || 5
                            }" class="mset-input" style="width: 100px; max-width: 100px;">
                            <p class="setting-help">Number of rotated log files to retain (0-50)</p>
                        </div>
                    </div>
                </div>

                <!-- Retention & Cleanup card -->
                <div class="mset-card">
                    <div class="mset-card-header">
                        <div class="mset-card-icon mset-icon-amber"><i class="fas fa-broom"></i></div>
                        <h3>Retention & Cleanup</h3>
                    </div>
                    <div class="mset-card-body">
                        <div class="setting-item">
                            <label for="log_retention_days">Retention Days:</label>
                            <input type="number" id="log_retention_days" name="log_retention_days" min="0" max="365" value="${
                              settings.log_retention_days || 30
                            }" class="mset-input" style="width: 100px; max-width: 100px;">
                            <p class="setting-help">Delete logs older than this many days (0 = unlimited)</p>
                        </div>
                        <div class="setting-item">
                            <label for="log_max_entries_per_app">Max DB Entries Per App:</label>
                            <input type="number" id="log_max_entries_per_app" name="log_max_entries_per_app" min="1000" max="100000" step="1000" value="${
                              settings.log_max_entries_per_app || 10000
                            }" class="mset-input" style="width: 120px; max-width: 120px;">
                            <p class="setting-help">Maximum database log entries to keep per app type. Oldest are pruned hourly.</p>
                        </div>
                        <div class="setting-item">
                            <label for="log_auto_cleanup">Auto-Cleanup on Startup:</label>
                            <label class="toggle-switch">
                                <input type="checkbox" id="log_auto_cleanup" name="log_auto_cleanup" ${
                                  settings.log_auto_cleanup !== false ? "checked" : ""
                                }>
                                <span class="toggle-slider"></span>
                            </label>
                            <p class="setting-help">Automatically clean up old logs when Huntarr starts and hourly while running</p>
                        </div>
                    </div>
                </div>

                <!-- Advanced Settings card -->
                <div class="mset-card">
                    <div class="mset-card-header">
                        <div class="mset-card-icon mset-icon-purple"><i class="fas fa-sliders-h"></i></div>
                        <h3>Advanced Settings</h3>
                    </div>
                    <div class="mset-card-body">
                        <div class="setting-item">
                            <label for="enable_debug_logs">Enable Debug Logs:</label>
                            <label class="toggle-switch">
                                <input type="checkbox" id="enable_debug_logs" name="enable_debug_logs" ${
                                  settings.enable_debug_logs !== false ? "checked" : ""
                                }>
                                <span class="toggle-slider"></span>
                            </label>
                            <p class="setting-help">Store and display DEBUG level logs. When disabled, DEBUG logs are not saved to the database and the Debug level filter is hidden in the log viewer.</p>
                        </div>
                        <div class="setting-item">
                            <label for="log_refresh_interval_seconds">Log Refresh Interval:</label>
                            <div style="display: flex; align-items: center; gap: 10px;">
                                <input type="number" id="log_refresh_interval_seconds" name="log_refresh_interval_seconds" min="5" max="300" value="${
                                  settings.log_refresh_interval_seconds || 30
                                }" class="mset-input" style="width: 100px; max-width: 100px;">
                                <span style="color: #9ca3af; font-size: 13px;">seconds</span>
                            </div>
                            <p class="setting-help">How often the log viewer polls for new entries</p>
                        </div>
                    </div>
                </div>

                <!-- Log Storage & Actions card -->
                <div class="mset-card">
                    <div class="mset-card-header">
                        <div class="mset-card-icon mset-icon-teal"><i class="fas fa-database"></i></div>
                        <h3>Log Storage</h3>
                    </div>
                    <div class="mset-card-body">
                        <div class="logset-stats">
                            <div class="logset-stat-row">
                                <span class="logset-stat-label"><i class="fas fa-hdd"></i> Log Files:</span>
                                <span id="logset-file-size" class="logset-stat-value">Loading...</span>
                            </div>
                            <div class="logset-stat-row">
                                <span class="logset-stat-label"><i class="fas fa-database"></i> Database:</span>
                                <span id="logset-db-size" class="logset-stat-value">Loading...</span>
                            </div>
                            <div class="logset-stat-row">
                                <span class="logset-stat-label"><i class="fas fa-list"></i> Total Entries:</span>
                                <span id="logset-total-entries" class="logset-stat-value">Loading...</span>
                            </div>
                        </div>
                        <div class="logset-actions">
                            <button type="button" id="logset-cleanup-btn" class="logset-action-btn logset-btn-amber">
                                <i class="fas fa-broom"></i> Clean Up Now
                            </button>
                            <button type="button" id="logset-clear-btn" class="logset-action-btn logset-btn-red">
                                <i class="fas fa-trash-alt"></i> Clear All Logs
                            </button>
                        </div>
                    </div>
                </div>

            </div>
        `;

        // Load storage stats
        _loadLogStats(container);

        // Wire action buttons
        const cleanupBtn = container.querySelector('#logset-cleanup-btn');
        if (cleanupBtn) {
            cleanupBtn.addEventListener('click', () => _runLogCleanup(container));
        }
        const clearBtn = container.querySelector('#logset-clear-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => _clearAllLogs(container));
        }

        if (window.SettingsForms.setupAppManualSave) {
            window.SettingsForms.setupAppManualSave(container, "general", settings, { section: "logs" });
        }
    };

    function _loadLogStats(container) {
        // Fetch both endpoints in parallel
        Promise.all([
            HuntarrUtils.fetchWithTimeout('./api/logs/usage').then(r => r.json()).catch(() => null),
            HuntarrUtils.fetchWithTimeout('./api/logs/stats').then(r => r.json()).catch(() => null)
        ]).then(([usage, stats]) => {
            const fileEl = container.querySelector('#logset-file-size');
            const dbEl = container.querySelector('#logset-db-size');
            const totalEl = container.querySelector('#logset-total-entries');

            if (usage && usage.success && fileEl) {
                fileEl.textContent = `${usage.total_size_formatted} (${usage.file_count} files)`;
            } else if (fileEl) {
                fileEl.textContent = 'Unavailable';
            }

            if (stats && stats.success) {
                if (dbEl) dbEl.textContent = stats.db_size_formatted || 'Unknown';
                if (totalEl) totalEl.textContent = (stats.total_logs || 0).toLocaleString() + ' entries';
            } else {
                if (dbEl) dbEl.textContent = 'Unavailable';
                if (totalEl) totalEl.textContent = 'Unavailable';
            }
        });
    }

    function _showNotif(msg, type) {
        if (window.huntarrUI && window.huntarrUI.showNotification) {
            window.huntarrUI.showNotification(msg, type);
        } else {
            alert(msg);
        }
    }

    function _runLogCleanup(container) {
        // Read current form values for retention
        const days = parseInt(container.querySelector('#log_retention_days')?.value || '30', 10);
        const maxEntries = parseInt(container.querySelector('#log_max_entries_per_app')?.value || '10000', 10);

        const btn = container.querySelector('#logset-cleanup-btn');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Cleaning...'; }

        HuntarrUtils.fetchWithTimeout('./api/logs/cleanup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ days_to_keep: days, max_entries_per_app: maxEntries })
        })
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                _showNotif(`Cleanup complete: removed ${data.deleted_count} entries`, 'success');
                _loadLogStats(container);
            } else {
                _showNotif('Cleanup failed: ' + (data.error || 'Unknown error'), 'error');
            }
        })
        .catch(err => {
            _showNotif('Cleanup failed: ' + err.message, 'error');
        })
        .finally(() => {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-broom"></i> Clean Up Now'; }
        });
    }

    function _clearAllLogs(container) {
        const doClear = function() {
            const btn = container.querySelector('#logset-clear-btn');
            if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Clearing...'; }

            HuntarrUtils.fetchWithTimeout('./api/logs/all/clear', {
                method: 'POST'
            })
            .then(r => r.json())
            .then(data => {
                if (data.success) {
                    _showNotif('All logs cleared', 'success');
                    _loadLogStats(container);
                } else {
                    _showNotif('Failed to clear logs: ' + (data.error || 'Unknown error'), 'error');
                }
            })
            .catch(err => {
                _showNotif('Failed to clear logs: ' + err.message, 'error');
            })
            .finally(() => {
                if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-trash-alt"></i> Clear All Logs'; }
            });
        };

        if (window.HuntarrConfirm && window.HuntarrConfirm.show) {
            window.HuntarrConfirm.show({
                title: 'Clear All Logs',
                message: 'Are you sure you want to delete all log entries from the database? This cannot be undone.',
                confirmLabel: 'Clear All',
                onConfirm: doClear
            });
        } else {
            if (confirm('Are you sure you want to clear all logs?')) doClear();
        }
    }
})();
