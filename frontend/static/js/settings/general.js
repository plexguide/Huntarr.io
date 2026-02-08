(function() {
    window.SettingsForms = window.SettingsForms || {};

    window.SettingsForms.generateGeneralForm = function(container, settings = {}) {
        if (!settings || typeof settings !== "object") {
            settings = {};
        }

        container.setAttribute("data-app-type", "general");

        const saveButtonTopHtml = `
            <div style="margin-bottom: 20px;">
                <button type="button" id="settings-save-button" disabled style="
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

        container.innerHTML = saveButtonTopHtml + `
            <div class="settings-group">
                <h3>System Settings</h3>
                <div class="setting-item">
                    <label for="show_trending"><a href="https://plexguide.github.io/Huntarr.io/settings/settings.html#show-trending" class="info-icon" title="Learn more about showing trending content on home page" target="_blank" rel="noopener"><i class="fas fa-info-circle"></i></a>Show Trending:</label>
                    <label class="toggle-switch" style="width:40px; height:20px; display:inline-block; position:relative;">
                        <input type="checkbox" id="show_trending" ${
                          settings.show_trending === true ? "checked" : ""
                        }>
                        <span class="toggle-slider" style="position:absolute; cursor:pointer; top:0; left:0; right:0; bottom:0; background-color:#3d4353; border-radius:20px; transition:0.4s;"></span>
                    </label>
                    <p class="setting-help" style="margin-left: -3ch !important;">Display "Trending This Week" section on the home page</p>
                </div>

                <div class="setting-item">
                    <label for="timezone"><a href="https://plexguide.github.io/Huntarr.io/settings/settings.html#timezone" class="info-icon" title="Set your timezone for accurate time display" target="_blank" rel="noopener"><i class="fas fa-info-circle"></i></a>Timezone:</label>
                    <select id="timezone" name="timezone" style="width: 300px; padding: 8px 12px; border-radius: 6px; cursor: pointer; border: 1px solid rgba(255, 255, 255, 0.1); background-color: #1f2937; color: #d1d5db;">
                        ${(() => {
                          const predefinedTimezones = [
                            "UTC", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Pacific/Honolulu",
                            "America/Toronto", "America/Vancouver", "America/Sao_Paulo", "America/Argentina/Buenos_Aires", "America/Mexico_City",
                            "Europe/London", "Europe/Paris", "Europe/Berlin", "Europe/Amsterdam", "Europe/Rome", "Europe/Madrid",
                            "Asia/Tokyo", "Asia/Seoul", "Asia/Shanghai", "Asia/Singapore", "Australia/Sydney", "Pacific/Auckland"
                          ];
                          const currentTimezone = settings.timezone;
                          if (currentTimezone && !predefinedTimezones.includes(currentTimezone)) {
                            return `<option value="${currentTimezone}" selected>${currentTimezone} (Custom)</option>`;
                          }
                          return "";
                        })()}
                        <option value="UTC" ${settings.timezone === "UTC" || !settings.timezone ? "selected" : ""}>UTC</option>
                        <option value="America/New_York" ${settings.timezone === "America/New_York" ? "selected" : ""}>Eastern Time</option>
                        <option value="America/Chicago" ${settings.timezone === "America/Chicago" ? "selected" : ""}>Central Time</option>
                        <option value="America/Denver" ${settings.timezone === "America/Denver" ? "selected" : ""}>Mountain Time</option>
                        <option value="America/Los_Angeles" ${settings.timezone === "America/Los_Angeles" ? "selected" : ""}>Pacific Time</option>
                        <option value="Europe/London" ${settings.timezone === "Europe/London" ? "selected" : ""}>UK Time</option>
                        <option value="Europe/Paris" ${settings.timezone === "Europe/Paris" ? "selected" : ""}>Central Europe</option>
                        <option value="Asia/Tokyo" ${settings.timezone === "Asia/Tokyo" ? "selected" : ""}>Japan</option>
                        <option value="Australia/Sydney" ${settings.timezone === "Australia/Sydney" ? "selected" : ""}>Australia East</option>
                    </select>
                    <p class="setting-help" style="margin-left: -3ch !important;">Set your timezone for accurate time display in logs and scheduling.</p>
                </div>
            </div>

            <div class="settings-group">
                <h3>Security</h3>
                <div class="setting-item">
                    <label for="auth_mode"><a href="https://plexguide.github.io/Huntarr.io/settings/settings.html#authentication-mode" class="info-icon" title="Learn more about authentication modes" target="_blank" rel="noopener"><i class="fas fa-info-circle"></i></a>Authentication Mode:</label>
                    <select id="auth_mode" name="auth_mode" style="width: 300px; padding: 8px 12px; border-radius: 6px; cursor: pointer; border: 1px solid rgba(255, 255, 255, 0.1); background-color: #1f2937; color: #d1d5db;">
                        <option value="login" ${
                          settings.auth_mode === "login" ||
                          (!settings.auth_mode && !settings.local_access_bypass && !settings.proxy_auth_bypass)
                            ? "selected" : ""
                        }>Login Mode</option>
                        <option value="local_bypass" ${
                          settings.auth_mode === "local_bypass" ||
                          (!settings.auth_mode && settings.local_access_bypass === true && !settings.proxy_auth_bypass)
                            ? "selected" : ""
                        }>Local Bypass Mode</option>
                        <option value="no_login" ${
                          settings.auth_mode === "no_login" ||
                          (!settings.auth_mode && settings.proxy_auth_bypass === true)
                            ? "selected" : ""
                        }>No Login Mode</option>
                    </select>
                    <p class="setting-help" style="margin-left: -3ch !important;">Login Mode: Standard login. Local Bypass: No login on local network. No Login: Completely open (use behind proxy).</p>
                </div>
                <div class="setting-item">
                    <label for="ssl_verify"><a href="https://plexguide.github.io/Huntarr.io/settings/settings.html#enable-ssl-verify" class="info-icon" title="Learn more about SSL verification" target="_blank" rel="noopener"><i class="fas fa-info-circle"></i></a>Enable SSL Verify:</label>
                    <label class="toggle-switch" style="width:40px; height:20px; display:inline-block; position:relative;">
                        <input type="checkbox" id="ssl_verify" ${
                          settings.ssl_verify === true ? "checked" : ""
                        }>
                        <span class="toggle-slider" style="position:absolute; cursor:pointer; top:0; left:0; right:0; bottom:0; background-color:#3d4353; border-radius:20px; transition:0.4s;"></span>
                    </label>
                    <p class="setting-help" style="margin-left: -3ch !important;">Disable SSL certificate verification when using self-signed certificates.</p>
                </div>
            </div>
            
            <div class="settings-group">
                <h3>Advanced Settings</h3>
                <div class="setting-item">
                    <label for="base_url">Base URL:</label>
                    <input type="text" id="base_url" value="${settings.base_url || ""}" placeholder="/huntarr">
                    <p class="setting-help" style="margin-left: -3ch !important;">Base URL path for reverse proxy. Requires restart.</p>
                </div>
                <div class="setting-item">
                    <label for="dev_key">Huntarr Dev Key:</label>
                    <input type="password" id="dev_key" value="${settings.dev_key || ""}" placeholder="Enter dev key" style="width: 300px; padding: 8px 12px; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.1); background-color: #1f2937; color: #d1d5db;">
                    <p class="setting-help" style="margin-left: -3ch !important;">Enter development key to enable dev mode (allows per-instance sleep down to 1 minute).</p>
                </div>
                <div class="setting-item" style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                    <span style="color: #94a3b8;">Dev mode:</span>
                    <span id="dev-mode-indicator" class="dev-mode-badge" style="
                        padding: 4px 12px;
                        border-radius: 6px;
                        font-size: 13px;
                        font-weight: 600;
                        ${(settings.dev_mode === true) ? "background: rgba(34, 197, 94, 0.2); color: #22c55e; border: 1px solid rgba(34, 197, 94, 0.4);" : "background: rgba(100, 116, 139, 0.2); color: #94a3b8; border: 1px solid rgba(100, 116, 139, 0.4);"}
                    ">${(settings.dev_mode === true) ? "ON" : "OFF"}</span>
                    <span class="setting-help" style="margin: 0; color: #64748b;">${(settings.dev_mode === true) ? "Allows per-instance sleep as low as 1 minute." : "Valid key + save to enable."}</span>
                </div>
            </div>

            <div class="settings-group">
                <h3>Display Settings</h3>
                <div class="setting-item">
                    <label for="display_community_resources">Display Resources:</label>
                    <label class="toggle-switch" style="width:40px; height:20px; display:inline-block; position:relative;">
                        <input type="checkbox" id="display_community_resources" ${
                          settings.display_community_resources !== false ? "checked" : ""
                        }>
                        <span class="toggle-slider" style="position:absolute; cursor:pointer; top:0; left:0; right:0; bottom:0; background-color:#3d4353; border-radius:20px; transition:0.4s;"></span>
                    </label>
                    <p class="setting-help" style="margin-left: -3ch !important;">Show or hide the Resources section on the home page</p>
                </div>
            </div>
        `;

        if (window.SettingsForms.setupSettingsManualSave) {
            window.SettingsForms.setupSettingsManualSave(container, settings);
        }
    };

    window.SettingsForms.setupSettingsManualSave = function(container, originalSettings = {}) {
        let saveButton = container.querySelector("#settings-save-button");
        if (!saveButton) saveButton = document.getElementById("settings-save-button");
        if (!saveButton) return;

        saveButton.disabled = true;
        saveButton.style.background = "#6b7280";
        saveButton.style.cursor = "not-allowed";

        let hasChanges = false;
        window.settingsUnsavedChanges = false;
        if (window.SettingsForms.removeUnsavedChangesWarning) {
            window.SettingsForms.removeUnsavedChangesWarning();
        }

        const getLiveSaveButton = () => container.querySelector("#settings-save-button") || document.getElementById("settings-save-button");
        const updateSaveButtonState = (changesDetected) => {
            hasChanges = changesDetected;
            window.settingsUnsavedChanges = changesDetected;
            const btn = getLiveSaveButton();
            if (!btn) return;
            if (hasChanges) {
                btn.disabled = false;
                btn.style.background = "#dc2626";
                btn.style.color = "#ffffff";
                btn.style.borderColor = "#b91c1c";
                btn.style.fontWeight = "600";
                btn.style.cursor = "pointer";
                if (window.SettingsForms.addUnsavedChangesWarning) {
                    window.SettingsForms.addUnsavedChangesWarning();
                }
            } else {
                btn.disabled = true;
                btn.style.background = "#6b7280";
                btn.style.color = "#9ca3af";
                btn.style.borderColor = "#4b5563";
                btn.style.fontWeight = "500";
                btn.style.cursor = "not-allowed";
                if (window.SettingsForms.removeUnsavedChangesWarning) {
                    window.SettingsForms.removeUnsavedChangesWarning();
                }
            }
        };

        container.addEventListener('input', () => updateSaveButtonState(true));
        container.addEventListener('change', () => updateSaveButtonState(true));

        const newSaveButton = saveButton.cloneNode(true);
        saveButton.parentNode.replaceChild(newSaveButton, saveButton);

        newSaveButton.addEventListener("click", () => {
            if (!hasChanges) return;
            const liveBtn = getLiveSaveButton();
            if (liveBtn) {
                liveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
                liveBtn.disabled = true;
            }

            const settings = { ...originalSettings };
            const trendingEl = document.getElementById("show_trending");
            settings.show_trending = trendingEl ? trendingEl.checked : false;

            const timezone = document.getElementById("timezone");
            if (timezone) settings.timezone = timezone.value;
            const authMode = document.getElementById("auth_mode");
            if (authMode) settings.auth_mode = authMode.value;
            const ssl = document.getElementById("ssl_verify");
            if (ssl) settings.ssl_verify = ssl.checked;
            const baseUrl = document.getElementById("base_url");
            if (baseUrl) settings.base_url = baseUrl.value;
            const devKey = document.getElementById("dev_key");
            if (devKey) settings.dev_key = (devKey.value || "").trim();
            const resources = document.getElementById("display_community_resources");
            if (resources) settings.display_community_resources = resources.checked;
            const support = document.getElementById("display_huntarr_support");
            if (support) settings.display_huntarr_support = support.checked;

            window.SettingsForms.saveAppSettings("general", settings, { section: "main" });

            if (liveBtn) liveBtn.innerHTML = '<i class="fas fa-save"></i> Save Changes';
            updateSaveButtonState(false);
        });
    };
})();
