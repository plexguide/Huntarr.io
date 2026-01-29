(function() {
    window.SettingsForms = window.SettingsForms || {};

    window.SettingsForms.generateLogsSettingsForm = function(container, settings = {}) {
        if (!settings || typeof settings !== "object") {
            settings = {};
        }

        container.setAttribute("data-app-type", "logs");

        let logsSaveButtonHtml = `
            <div style="margin-bottom: 20px;">
                <button type="button" id="general-save-button" disabled style="
                    background: #6b7280;
                    color: #9ca3af;
                    border: 1px solid #4b5563;
                    padding: 8px 16px;
                    border-radius: 6px;
                    font-size: 14px;
                    font-weight: 500;
                    cursor: not-allowed;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    transition: all 0.2s ease;
                ">
                    <i class="fas fa-save"></i>
                    Save Changes
                </button>
            </div>
        `;

        let logsHtml = `
            <div class="settings-group">
                <h3>Log Rotation</h3>
                <div class="setting-item">
                    <label for="log_rotation_enabled">Enable Log Rotation:</label>
                    <label class="toggle-switch" style="width:40px; height:20px; display:inline-block; position:relative;">
                        <input type="checkbox" id="log_rotation_enabled" name="log_rotation_enabled" ${
                          settings.log_rotation_enabled !== false ? "checked" : ""
                        }>
                        <span class="toggle-slider" style="position:absolute; cursor:pointer; top:0; left:0; right:0; bottom:0; background-color:#3d4353; border-radius:20px; transition:0.4s;"></span>
                    </label>
                    <p class="setting-help">Automatically rotate log files when they reach a certain size</p>
                </div>
                <div class="setting-item">
                    <label for="log_max_size_mb">Max File Size:</label>
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <input type="number" id="log_max_size_mb" name="log_max_size_mb" min="1" max="100" value="${
                          settings.log_max_size_mb || 10
                        }" style="width: 100px;">
                        <span style="color: #9ca3af;">MB</span>
                    </div>
                    <p class="setting-help">Maximum size before rotating to a new file</p>
                </div>
                <div class="setting-item">
                    <label for="log_backup_count">Backup Files to Keep:</label>
                    <input type="number" id="log_backup_count" name="log_backup_count" min="0" max="50" value="${
                      settings.log_backup_count || 5
                    }" style="width: 100px;">
                    <p class="setting-help">Number of rotated log files to retain (0-50)</p>
                </div>
            </div>

            <div class="settings-group">
                <h3>Retention & Cleanup</h3>
                <div class="setting-item">
                    <label for="log_retention_days">Retention Days:</label>
                    <input type="number" id="log_retention_days" name="log_retention_days" min="0" max="365" value="${
                      settings.log_retention_days || 30
                    }" style="width: 100px;">
                    <p class="setting-help">Delete logs older than this many days (0 = unlimited)</p>
                </div>
                <div class="setting-item">
                    <label for="log_auto_cleanup">Auto-Cleanup on Startup:</label>
                    <label class="toggle-switch" style="width:40px; height:20px; display:inline-block; position:relative;">
                        <input type="checkbox" id="log_auto_cleanup" name="log_auto_cleanup" ${
                          settings.log_auto_cleanup !== false ? "checked" : ""
                        }>
                        <span class="toggle-slider" style="position:absolute; cursor:pointer; top:0; left:0; right:0; bottom:0; background-color:#3d4353; border-radius:20px; transition:0.4s;"></span>
                    </label>
                    <p class="setting-help">Automatically clean up old logs when Huntarr starts</p>
                </div>
            </div>
            
            <div class="settings-group">
                <h3>Advanced Settings</h3>
                <div class="setting-item">
                    <label for="log_refresh_interval_seconds">Log Refresh Interval:</label>
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <input type="number" id="log_refresh_interval_seconds" name="log_refresh_interval_seconds" min="5" max="300" value="${
                          settings.log_refresh_interval_seconds || 30
                        }" style="width: 100px;">
                        <span style="color: #9ca3af;">seconds</span>
                    </div>
                    <p class="setting-help">How often the log viewer checks for new logs</p>
                </div>
            </div>
        `;

        container.innerHTML = logsSaveButtonHtml + logsHtml;

        HuntarrUtils.fetchWithTimeout('./api/logs/usage')
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    const sizeEl = container.querySelector('#log-usage-size');
                    const filesEl = container.querySelector('#log-usage-files');
                    if (sizeEl) sizeEl.textContent = data.total_size_formatted;
                    if (filesEl) filesEl.textContent = `${data.file_count} files across log directory`;
                }
            })
            .catch(err => console.error('Error fetching log usage:', err));

        if (window.SettingsForms.setupAppManualSave) {
            window.SettingsForms.setupAppManualSave(container, "general", settings);
        }
    };
})();
